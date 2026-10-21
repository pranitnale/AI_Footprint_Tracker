"""Unavailable originals must not monopolize bounded recalculation work."""

from copy import deepcopy
from uuid import UUID, uuid4

import pytest
from conftest import connect, login
from footprint_contracts import canonical_json
from sqlalchemy import func, select
from test_analytics import observations, upload
from test_historical_usage import auth, message, page, send

from aift import engine_adapter, method_registry
from aift.db import HistoryObservation, Observation, get
from aift.engine_history import EngineEstimate
from aift.maintenance import run
from aift.method_history import PAGE_SIZE, RecalculationJob


def pending_population(setup, live_count, history_count, *, valid_tail=False):
    app, client, company, member, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, attempt = observations(now[0])
    records = [request]
    for index in range(live_count + int(valid_tail)):
        record = deepcopy(attempt)
        record["attempt_id"] = str(UUID(int=index + 1, version=4))
        if index < live_count:
            record["proposed_method_id"] = "not-installed-historical-method"
        records.append(record)
    for offset in range(0, len(records), 100):
        response = upload(client, credentials, records[offset : offset + 100])
        assert response.status_code == 200, response.text
        assert all(
            row["status"] in {"applied", "stored_pending_estimate"} for row in response.json()["results"]
        )
    historical = [message(now[0], f"{index + 1:064x}") for index in range(history_count)]
    for offset in range(0, len(historical), 100):
        response = send(client, credentials, page(now[0], historical[offset : offset + 100]))
        assert response.status_code == 200, response.text
    method = engine_adapter.identity(engine_adapter.packaged_definition())
    selected = client.put(
        "/v1/me/estimation-selection",
        headers=auth(credentials),
        json={
            "preference": "ecologits",
            "selection_revision": 1,
            "method_id": method["method_id"],
            "method_hash": method["method_hash"],
            "operation_id": str(uuid4()),
        },
    )
    assert selected.status_code == 200, selected.text
    return credentials, selected.json()["recalculation"]["job_id"], records[-1]["attempt_id"]


def original_snapshot(session):
    return canonical_json(
        {
            "live": [
                [row.id, row.payload, row.payload_hash, row.revision, row.estimate]
                for row in session.scalars(select(Observation).order_by(Observation.id))
            ],
            "history": [
                [row.message_key, row.payload, row.original, row.estimate, row.original_estimate]
                for row in session.scalars(
                    select(HistoryObservation).order_by(HistoryObservation.message_key)
                )
            ],
        }
    )


def test_unavailable_live_originals_do_not_starve_history_during_maintenance(setup):
    app, _, company, _, _, _ = setup
    _, identifier, _ = pending_population(setup, PAGE_SIZE, 1)
    with app.state.db.transaction(readonly=True) as session:
        originals = original_snapshot(session)
    for _ in range(4):
        run(app.state.service)
        with app.state.db.transaction(readonly=True) as session:
            job = session.get(RecalculationJob, identifier)
            assert job.data["status"] == "pending"
            assert job.data["completed_at"] is None
            assert job.data["error_code"] == "recalculation_pending"
            assert original_snapshot(session) == originals
            pending = list(
                session.scalars(
                    app.state.service.analytics.methods.missing(session, company, job.method_id, job.owner)
                )
            )
            assert len(pending) == PAGE_SIZE
            assert all(
                row.estimate["status"] == "pending" and row.estimate["reason"] == "method_unsupported"
                for row in pending
            )
    with app.state.db.transaction(readonly=True) as session:
        assert (
            session.scalar(
                select(func.count())
                .select_from(EngineEstimate)
                .where(EngineEstimate.family == "history", EngineEstimate.view == "recalculated")
            )
            == 1
        )
        assert session.get(RecalculationJob, identifier).data["processed"] == 1


@pytest.mark.parametrize("budget", [1, PAGE_SIZE])
def test_history_only_ticks_preserve_live_cursor_and_combined_work_budget(setup, monkeypatch, budget):
    app, _, company, _, _, _ = setup
    _, identifier, valid_id = pending_population(setup, budget, 2 * budget, valid_tail=True)
    methods = app.state.service.analytics.methods
    recover = methods.recover_original
    estimate_history = method_registry.estimate_history
    visited = []

    def visit_live(*args):
        visited.append("live")
        return recover(*args)

    def visit_history(*args):
        visited.append("history")
        return estimate_history(*args)

    monkeypatch.setattr(methods, "recover_original", visit_live)
    monkeypatch.setattr(method_registry, "estimate_history", visit_history)
    for _ in range(3):
        visited.clear()
        with app.state.db.transaction(scope=company.data["origin"]) as session:
            methods.advance(
                session,
                get(session, "company", company.id),
                session.get(RecalculationJob, identifier),
                budget,
            )
        assert len(visited) <= budget
    with app.state.db.transaction(readonly=True) as session:
        assert (
            session.scalar(
                select(EngineEstimate).where(
                    EngineEstimate.family == "live",
                    EngineEstimate.record_key == valid_id,
                    EngineEstimate.view == "recalculated",
                )
            )
            is not None
        )
        assert (
            session.scalar(
                select(func.count())
                .select_from(EngineEstimate)
                .where(EngineEstimate.family == "history", EngineEstimate.view == "recalculated")
            )
            == 2 * budget - 1
        )
        assert session.get(RecalculationJob, identifier).data["status"] == "pending"
