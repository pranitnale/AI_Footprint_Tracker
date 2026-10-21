"""CSV exports retain authoritative engine results and the selected historical view."""

import csv
import io
import json
from copy import deepcopy
from decimal import Decimal
from uuid import uuid4

import pytest
from conftest import PERSON_ANALYTICS, confirmed, connect, login
from footprint_contracts import canonical_json
from footprint_estimator import BASELINE_METHOD_ID
from sqlalchemy import select
from test_analytics import observations, upload
from test_historical_usage import message, page, send

from aift.db import HistoryObservation, Observation, get, put
from aift.engine_adapter import history_metrics, identity, packaged_definition, require_native
from aift.engine_history import selected_history
from aift.exports import RECORD_FIELDS, SUMMARY_FIELDS, csv_text
from aift.maintenance import run
from aift.method_history import resolve_estimate


@pytest.fixture
def export_data(setup):
    app, client, company, member, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    definition = packaged_definition()
    require_native(definition)
    engine = identity(definition)
    live = []
    for mode in ("original", "ecologits", "fallback", "unavailable"):
        request, attempt = observations(now[0], "0" if mode == "unavailable" else "500")
        if mode != "original":
            attempt["proposed_method_id"] = engine["method_id"]
        if mode == "fallback":
            request["site"] = "perplexity"
        elif mode != "original":
            request["model_id"] = attempt["model_id"] = "chatgpt-gpt-5-5"
        response = upload(client, credentials, [request, attempt])
        assert response.status_code == 200, response.text
        assert [r["status"] for r in response.json()["results"]] == ["applied", "applied"], response.text
        live.append((mode, attempt["attempt_id"]))
    historical = []
    for index, mode in enumerate(("original", "ecologits")):
        item = message(now[0], ("c" if index == 0 else "d") * 64)
        if mode == "ecologits":
            item.update(
                site="chatgpt",
                conversation_key="e" * 64,
                model_id="chatgpt-gpt-5-5",
                proposed_method_id=engine["method_id"],
                proposed_method_hash=engine["method_hash"],
            )
        body = page(now[0], [item])
        body.update(site=item["site"], conversation_key=item["conversation_key"])
        response = send(client, credentials, body)
        assert response.status_code == 200, response.text
        assert response.json()["results"][0]["status"] == "applied", response.text
        historical.append((mode, item["message_key"]))
    return app, client, company, member, engine, live, historical


def exported(client, report, **options):
    response = client.post(
        "/v1/admin/exports", json=confirmed(client, {"report": report, "period": "all", **options})
    )
    assert response.status_code == 200, response.text
    job = response.json()
    for _ in range(8):
        if job["status"] != "pending":
            break
        response = client.post(f"/v1/admin/exports/{job['export_id']}/advance", json={})
        assert response.status_code == 200, response.text
        job = response.json()
    assert job["status"] == "completed", job
    response = client.get(job["download_path"])
    assert response.status_code == 200, response.text
    reader = csv.DictReader(io.StringIO(response.text))
    assert len(reader.fieldnames) == len(set(reader.fieldnames))
    return list(reader), job


def recalculate(data):
    app, client, _, _, engine, _, _ = data
    response = client.post(
        "/v1/admin/recalculations", json={"method_id": engine["method_id"], "operation_id": str(uuid4())}
    )
    assert response.status_code == 200, response.text
    status = response.json()
    for _ in range(5):
        run(app.state.service)
        response = client.get("/v1/admin/recalculations/" + status["job_id"])
        assert response.status_code == 200, response.text
        status = response.json()
        if status["status"] == "completed":
            break
    assert status["status"] == "completed", status
    return {"calculation_view": "recalculated", "method_id": engine["method_id"]}


@PERSON_ANALYTICS
def test_mixed_live_and_history_records_keep_raw_originals_and_engine_identities(export_data):
    app, client, company, member, engine, live, historical = export_data
    rows, job = exported(client, "records")
    assert job["row_count"] == len(rows) == 10
    by_id = {row["record_id"]: row for row in rows}
    with app.state.db.transaction(readonly=True) as session:
        for mode, record_id in live:
            record = session.get(Observation, (company.id, member.id, "attempt", record_id))
            row = by_id[record_id]
            assert json.loads(row["estimate_json"]) == record.estimate
            assert json.loads(row["original_estimate_json"]) == record.estimate
            assert json.loads(row["observation_json"]) == record.payload
            assert row["calculation_view"] == "original"
            if mode == "original":
                assert row["requested_engine_id"] == row["effective_engine_id"] == "original"
                assert row["method_id"] == BASELINE_METHOD_ID
            else:
                result = record.estimate["result"]
                assert result["schema_version"] == row["result_schema_version"] == "3.0.0"
                assert row["requested_engine_id"] == "ecologits"
                assert row["requested_method_hash"] == engine["method_hash"]
                assert row["method_id"] == engine["method_id"]
                assert json.loads(row["metrics_json"]) == result["metrics"]
                assert json.loads(row["image_references_json"]) == result["image_references"]
                assert json.loads(row["requested_method_json"]) == result["requested_method"]
                assert json.loads(row["effective_method_json"]) == result["effective_method"]
                assert json.loads(row["comparability_json"]) == result["comparability"]
                assert row["result_status"] == result["status"]
                assert row["effective_engine_id"] == "ecologits"
                if mode == "fallback":
                    assert row["selection_kind"] == "provider_flagship"
                    assert row["effective_method_id"] == engine["method_id"]
                    assert row["selected_profile_provider"] == "openai"
                    assert row["selected_profile_model_name"] == "gpt-6.1-sol"
                elif mode == "unavailable":
                    assert row["result_status"] == "unavailable"
                    assert all(metric["value"] is None for metric in json.loads(row["metrics_json"]).values())
                else:
                    assert row["selected_profile_provider"] == "openai"
                    assert row["selected_profile_model_name"] == "gpt-5.5"
                    assert row["source_version"] == "0.11.2"
                    metric = json.loads(row["metrics_json"])["energy"]
                    assert metric["value_kind"] == "midpoint"
                    assert metric["interval_kind"] == "upstream_approximation"
                    assert metric["scenario_low"] is not None and metric["scenario_high"] is not None
        for mode, record_id in historical:
            record = session.get(HistoryObservation, (company.id, member.id, record_id))
            row = by_id[record_id]
            assert canonical_json(json.loads(row["estimate_json"])) == canonical_json(record.estimate)
            assert json.loads(row["original_estimate_json"]) == record.original_estimate
            assert json.loads(row["original_observation_json"]) == record.original
            assert row["record_kind"] == "history_message"
            assert row["requested_engine_id"] == mode
            if mode == "ecologits":
                metric = json.loads(row["metrics_json"])["energy"]
                assert metric == record.estimate["metrics"]["energy"]
                assert metric["value_kind"] == "midpoint"
                assert metric["scenario_low"] is not None and metric["scenario_high"] is not None


def test_original_summary_exports_separate_methods_and_midpoint_sums_with_scenario_sums(export_data):
    app, client, company, member, engine, _, _ = export_data
    rows, _ = exported(client, "summary")
    energy = [row for row in rows if row["quantity"] == "energy" and row["reference_only"] != "True"]
    assert {row["requested_engine_id"] for row in energy} == {"original", "ecologits"}
    assert {row["effective_engine_id"] for row in energy} == {"original", "ecologits"}
    assert all(row["calculation_view"] == "original" for row in energy)
    with app.state.db.transaction(readonly=True) as session:
        records = list(
            session.scalars(select(HistoryObservation).where(HistoryObservation.tenant == company.id))
        )
        expected = next(
            metric
            for record in records
            for metric in history_metrics(record.estimate)
            if metric["quantity"] == "energy" and metric["method_id"] == engine["method_id"]
        )
        summary = app.state.service.analytics.history.summary(session, company, None, query={"period": "all"})
        assert summary["schema_version"] == "3.0.0"
    historical = next(
        row
        for row in energy
        if row["scope"] == "historical_visible_response" and row["requested_engine_id"] == "ecologits"
    )
    assert historical["method_hash"] == expected["method_hash"]
    assert historical["value"] == expected["value"]
    assert expected["scenario_low"] is not None and expected["scenario_high"] is not None
    assert Decimal(historical["scenario_low"]) == Decimal(expected["scenario_low"])
    assert Decimal(historical["scenario_high"]) == Decimal(expected["scenario_high"])
    assert historical["interval_kind"] == ""
    assert historical["value_kind"] == "midpoint_sum"
    assert historical["phase"] == "usage"
    assert historical["known_message_count"] == "1"
    assert json.loads(historical["effective_method_json"]) == expected["effective_method"]
    ranged_energy = [row for row in energy if row["effective_engine_id"] == "ecologits" and row["value"]]
    assert len(ranged_energy) >= 2
    for row in ranged_energy:
        assert row["value_kind"] == "midpoint_sum"
        assert row["interval_kind"] == ""
        assert Decimal(row["scenario_low"]) <= Decimal(row["value"]) <= Decimal(row["scenario_high"])


@PERSON_ANALYTICS
def test_recalculated_records_select_history_overlays_and_preserve_originals(export_data):
    app, client, company, member, engine, live, historical = export_data
    options = recalculate(export_data)
    rows, _ = exported(client, "records", **options)
    by_id = {row["record_id"]: row for row in rows}
    with app.state.db.transaction(readonly=True) as session:
        for _, record_id in live:
            record = session.get(Observation, (company.id, member.id, "attempt", record_id))
            row = by_id[record_id]
            selected = resolve_estimate(session, record, engine["method_id"])
            assert json.loads(row["estimate_json"]) == selected
            assert json.loads(row["original_estimate_json"]) == record.estimate
            assert row["calculation_view"] == "recalculated"
            assert row["requested_method_id"] == engine["method_id"]
        for _, record_id in historical:
            record = session.get(HistoryObservation, (company.id, member.id, record_id))
            row = by_id[record_id]
            selected = selected_history(session, record, engine["method_id"])
            assert selected["schema_version"] == "3.0.0"
            assert json.loads(row["estimate_json"]) == selected
            assert json.loads(row["original_estimate_json"]) == record.original_estimate
            assert row["calculation_view"] == "recalculated"
            assert row["method_id"] == engine["method_id"]
            assert row["original_method_hash"] == record.original["proposed_method_hash"]


def test_recalculated_summary_uses_selected_history_method(export_data):
    app, client, company, member, engine, _, _ = export_data
    options = recalculate(export_data)
    rows, _ = exported(client, "summary", **options)
    history_rows = [row for row in rows if row["scope"] == "historical_visible_response"]
    assert history_rows and all(row["calculation_view"] == "recalculated" for row in history_rows)
    assert all(row["requested_method_id"] == engine["method_id"] for row in history_rows)
    with app.state.db.transaction(readonly=True) as session:
        summary = app.state.service.analytics.history.summary(
            session, company, None, query={"period": "all", **options}
        )
        assert summary["schema_version"] == "3.0.0"
        expected = summary["resources"]
    assert len(history_rows) == len(expected)
    for metric in expected:
        row = next(
            row
            for row in history_rows
            if row["quantity"] == metric["quantity"]
            and row["effective_method_hash"] == metric["effective_method"]["method_hash"]
            and row["selected_profile_id"] == (metric["selected_profile_id"] or "")
        )
        assert row["value"] == (metric["value"] or "")
        assert json.loads(row["comparability_json"]) == metric["comparability"]
        assert row["interval_kind"] == ""
        assert row["scenario_low"] == (metric["scenario_low"] or "")
        assert row["scenario_high"] == (metric["scenario_high"] or "")
        if metric["quantity"] == "energy" and metric["effective_method"]["engine_id"] == "ecologits":
            assert row["value_kind"] == "midpoint_sum"
    count_rows = [row for row in rows if row["scope"] == "loaded_history"]
    assert count_rows and all(row["method_id"] == "" for row in count_rows)


@PERSON_ANALYTICS
def test_record_export_resumes_multiple_pages_without_duplicating_or_losing_rows(export_data, monkeypatch):
    app, client, company, _, _, _, _ = export_data
    monkeypatch.setattr("aift.exports.PAGE_SIZE", 2)
    rows, job = exported(client, "records")
    with app.state.db.transaction(readonly=True) as session:
        expected = {
            (record.kind, record.id)
            for record in session.scalars(select(Observation).where(Observation.tenant == company.id))
        } | {
            ("history_message", record.message_key)
            for record in session.scalars(
                select(HistoryObservation).where(HistoryObservation.tenant == company.id)
            )
        }
    actual = [(row["record_kind"], row["record_id"]) for row in rows]
    assert len(actual) == len(set(actual)) == job["row_count"] == len(expected)
    assert set(actual) == expected
    assert job["integrity"]["chunk_count"] >= 5


def test_csv_additive_fields_preserve_formula_escaping_and_unique_headers():
    assert len(SUMMARY_FIELDS) == len(set(SUMMARY_FIELDS))
    assert len(RECORD_FIELDS) == len(set(RECORD_FIELDS))
    value = {"selected_profile_model_name": "=PRIVATE_FORMULA", "selection_json": {"reason": "=value"}}
    fields = list(value)
    row = next(csv.DictReader(io.StringIO(csv_text(fields, [deepcopy(value)]))))
    assert row["selected_profile_model_name"] == "'=PRIVATE_FORMULA"
    assert json.loads(row["selection_json"]) == value["selection_json"]


def test_a_records_export_is_withdrawn_while_person_analytics_is_off(export_data):
    """
    Owner decision of 18 October 2026: with person analytics off, exports are organization
    summaries. A per-record export made while it was on is cancelled if still running, and a
    finished one cannot be downloaded any more.
    """
    app, client, company, member, *_ = export_data
    rows, job = exported(client, "summary")
    assert rows and member.id not in json.dumps(rows)
    with app.state.db.transaction() as session:
        stored = get(session, "export", job["export_id"], company.id)
        stored.data = {**stored.data, "metadata": {**stored.data["metadata"], "report": "records"}}
        pending = put(
            session,
            "export",
            str(uuid4()),
            {**stored.data, "status": "pending", "chunk_count": 0},
            company.id,
            member.id,
        )
        pending_id = pending.id
    assert client.get(job["download_path"]).status_code == 404
    advanced = client.post(f"/v1/admin/exports/{pending_id}/advance", json={})
    assert advanced.status_code == 404
    run(app.state.service)
    with app.state.db.transaction(readonly=True) as session:
        row = get(session, "export", pending_id, company.id)
        assert row is None or row.data["status"] == "cancelled"
