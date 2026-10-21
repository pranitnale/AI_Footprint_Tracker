import shutil
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import timedelta
from uuid import uuid4

import pytest
from conftest import connect, login, member_login, restore_pre_0007_schema
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from test_analytics import observations, upload
from test_completion import finish_job, reauth

from aift.db import TABLES, Observation, get, put
from aift.main import create_app
from aift.maintenance import replay_journal
from aift.policies import retention_preview
from aift.security import Problem, instant


def test_two_tenants_same_deletion_operation_survive_retry_and_restore(setup, tmp_path):
    app, first, company, admin, now, settings = setup
    with app.state.db.transaction() as session:
        second_company = put(
            session,
            "company",
            str(uuid4()),
            {
                **company.data,
                "slug": "second",
                "domain": "second.org",
                "origin": "https://second.aifootprinttracker.com",
            },
        )
        second_admin = app.state.service.member(session, second_company, "admin@second.org", True)
    second = TestClient(app, base_url=second_company.origin)
    second.headers["Origin"] = second_company.origin
    states = []
    for client, tenant, actor, email in [
        (first, company, admin, "admin@example.org"),
        (second, second_company, second_admin, "admin@second.org"),
    ]:
        login(app, client, email)
        credentials, _ = connect(app, client)
        pair = observations(now[0])
        assert upload(client, credentials, list(pair)).json()["results"][0]["status"] == "applied"
        states.append((client, tenant, actor, credentials, pair))
    backup = tmp_path / "before-erasure.db"
    with sqlite3.connect(app.state.db.engine.url.database) as source, sqlite3.connect(backup) as target:
        source.backup(target)
    operation = str(uuid4())
    jobs = []
    for client, tenant, actor, credentials, pair in states:
        preview = client.post(
            "/v1/admin/deletions/preview",
            json={
                "scope": "range",
                "start": instant(now[0] - timedelta(seconds=1)),
                "end": instant(now[0] + timedelta(seconds=1)),
            },
        ).json()
        body = {
            "preview_token": preview["preview_token"],
            "idempotency_key": operation,
            "confirmed": True,
            "reauth_token": reauth(app, tenant, actor),
        }
        result = client.post("/v1/admin/deletions", json=body)
        assert result.status_code == 200, result.text
        job = result.json()["job_id"]
        jobs.append(job)
        finish_job(app, tenant, job)
        assert client.post("/v1/admin/deletions", json=body).json()["job_id"] == job
        assert client.get("/v1/admin/deletions/" + job).status_code == 200
        fresh, _ = observations(now[0])
        assert upload(client, credentials, [fresh], 1).json()["results"][0]["status"] == "erased"
    assert jobs[0] != jobs[1]
    with app.state.db.transaction(readonly=True) as session:
        for job, (_, tenant, _, _, _) in zip(jobs, states):
            assert get(session, "deletion", job).tenant == tenant.id
            assert get(session, "deletion_job", job).tenant == tenant.id
    app.state.db.engine.dispose()
    shutil.copyfile(backup, app.state.db.engine.url.database)
    restored = create_app(settings, clock=lambda: now[0])
    replay_journal(restored.state.service)
    for _, tenant, _, credentials, _ in states:
        client = TestClient(restored, base_url=tenant.origin)
        fresh, _ = observations(now[0])
        assert upload(client, credentials, [fresh], 1).json()["results"][0]["status"] == "erased"


def test_put_rejects_scope_overwrite_even_when_key_is_caller_controlled(setup):
    app, _, company, admin, _, _ = setup
    with app.state.db.transaction() as session:
        put(session, "role_operation", "same-key", {"safe": 1}, company.id, admin.id)
    for tenant, owner in [(str(uuid4()), admin.id), (company.id, str(uuid4()))]:
        with pytest.raises(Problem, match="state_scope_conflict"):
            with app.state.db.transaction() as session:
                put(session, "role_operation", "same-key", {"safe": 2}, tenant, owner)
    with app.state.db.transaction(readonly=True) as session:
        assert get(session, "role_operation", "same-key").data == {"safe": 1}


def test_otp_same_operation_replays_one_session_after_lost_response_restart_and_revocation(setup):
    app, client, company, _, now, settings = setup
    challenge = client.post(
        "/v1/auth/otp/request",
        json={"purpose": "login", "email": "admin@example.org", "dispatch_id": str(uuid4())},
    ).json()["challenge_id"]
    body = {
        "challenge_id": challenge,
        "code": app.state.mail.messages[-1]["code"],
        "verification_id": str(uuid4()),
    }

    def redeem(_):
        other = TestClient(app, base_url=company.origin)
        return other.post("/v1/auth/otp/verify", json=body, headers={"Origin": company.origin})

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(redeem, range(2)))
    assert all(result.status_code == 200 for result in results)
    assert results[0].headers["set-cookie"] == results[1].headers["set-cookie"]
    assert results[0].json() == results[1].json()
    with app.state.db.transaction(readonly=True) as session:
        assert session.scalar(select(func.count()).select_from(TABLES["session"])) == 1
        row = get(session, "otp", challenge)
        assert body["code"] not in str(row.data) and "admin@example.org" not in str(row.data)
    restarted = create_app(settings, clock=lambda: now[0])
    other = TestClient(restarted, base_url=company.origin)
    other.headers["Origin"] = company.origin
    replay = other.post("/v1/auth/otp/verify", json=body)
    assert replay.status_code == 200 and replay.json() == results[0].json()
    assert (
        other.post("/v1/auth/otp/verify", json={**body, "verification_id": str(uuid4())}).status_code == 401
    )
    assert other.post("/v1/auth/otp/verify", json={**body, "code": "bad000"}).status_code == 422
    other.headers["X-CSRF-Token"] = replay.json()["csrf_token"]
    assert other.delete("/v1/auth/session").status_code == 200
    assert other.post("/v1/auth/otp/verify", json=body).status_code == 401
    now[0] += timedelta(minutes=6)
    assert other.post("/v1/auth/otp/verify", json=body).status_code == 401


def test_conversation_promotion_and_observed_model_update_preserve_identity(setup):
    app, client, company, _, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, attempt = observations(now[0])
    assert upload(client, credentials, [request, attempt]).status_code == 200
    hostile = {**request, "revision": 2, "site": "claude", "conversation_key": "b" * 64}
    assert upload(client, credentials, [hostile]).json()["results"][0]["error_code"] == "immutable_identity"
    promoted = {**request, "revision": 2, "conversation_key": "b" * 64}
    updated = {
        **attempt,
        "revision": 2,
        "model_id": "chatgpt-gpt-5-6-sol",
        "model_evidence": "response_field",
    }
    result = upload(client, credentials, [promoted, updated])
    assert all(row["status"] == "applied" for row in result.json()["results"]), result.text
    with app.state.db.transaction(readonly=True) as session:
        rows = list(session.scalars(select(Observation).where(Observation.tenant == company.id)))
        assert {row.conversation for row in rows} == {"b" * 64}
        assert {row.site for row in rows} == {"chatgpt"}
        child = next(row for row in rows if row.kind == "attempt")
        assert child.model == updated["model_id"] == child.payload["model_id"]
    assert client.get("/v1/me/conversations/" + "a" * 64 + "/summary").json()["attempt_count"] == "0"
    assert client.get("/v1/me/conversations/" + "b" * 64 + "/summary").json()["attempt_count"] == "1"
    assert client.get("/v1/me/summary", params={"model": updated["model_id"]}).json()["attempt_count"] == "1"
    now[0] += timedelta(days=220)
    login(app, client)
    assert client.get("/v1/usage/records/request/" + request["request_id"]).status_code == 404


def test_retention_preview_matches_parent_owner_with_reused_uuid(setup):
    app, client, company, _, now, _ = setup
    login(app, client)
    first, _ = connect(app, client)
    request, attempt = observations(now[0])
    upload(client, first, [request, attempt])
    now[0] += timedelta(days=35)
    employee = TestClient(app, base_url=company.origin)
    employee.headers["Origin"] = company.origin
    member_login(app, employee, "employee@example.org")
    second, _ = connect(app, employee)
    request2, attempt2 = observations(now[0])
    request2["request_id"] = request["request_id"]
    attempt2["request_id"] = request["request_id"]
    upload(employee, second, [request2, attempt2])
    with app.state.db.transaction(readonly=True) as session:
        preview = retention_preview(app.state.service, session, company, 1, now[0])
        assert preview["request_count"] == "1" and preview["attempt_count"] == "1"


def test_original_company_resource_and_token_subgroups_are_shared(setup):
    app, client, company, _, now, _ = setup
    for index in range(5):
        employee = TestClient(app, base_url=company.origin)
        employee.headers["Origin"] = company.origin
        member_login(app, employee, f"person{index}@example.org")
        credentials, _ = connect(app, employee)
        request, attempt = observations(now[0], "500" if index < 4 else "0")
        upload(employee, credentials, [request, attempt])
    result = employee.get("/v1/company/summary").json()
    login(app, client)
    private = client.get("/v1/admin/summary").json()
    assert private["suppressed"] is False and private["attempt_count"] == "5"
    # One person's zero-token subgroup no longer hides the members' totals (13 October 2026).
    assert result["suppressed"] is False and result["attempt_count"] == "5"
    assert result["resources"] == private["resources"] and result["tokens"] == private["tokens"]


def test_search_partial_reasons_and_image_counts_are_reversible_and_separate(setup):
    app, client, _, _, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, attempt = observations(now[0])
    request.update(features=["text", "search"], observed_search_operations="3")
    operation = {
        "operation_key": "b" * 64,
        "kind": "text_to_image",
        "requested_count": "2",
        "returned_count": "2",
        "state": "completed",
        "execution_evidence": "content_observed",
        "settings": {
            "width": None,
            "height": None,
            "steps": None,
            "precision": "unknown",
            "architecture": "unknown",
        },
        "model_id": None,
        "model_evidence": "unknown",
    }
    attempt["media"]["image_operations"] = [operation]
    result = upload(client, credentials, [request, attempt])
    assert all(row["status"] == "applied" for row in result.json()["results"]), result.text
    summary = client.get("/v1/me/summary").json()
    assert summary["observed_search_operations"] == "3" and summary["search_known_request_count"] == "1"
    energy = next(row for row in summary["resources"] if row["quantity"] == "energy")
    assert energy["partial_count"] == 1 and energy["reason_counts"]["unvalidated_reference"] == 1
    # The image benchmark data was removed on 20 October 2026, so no reference figure is
    # produced; the image itself is still counted below.
    assert summary["image_references"] == []
    assert (
        next(row for row in summary["media_counts"] if row["quantity"] == "image_returned_outputs")["value"]
        == "2"
    )
    correction = deepcopy(attempt)
    correction["revision"] = 2
    correction["media"]["image_operations"][0]["returned_count"] = "1"
    request["revision"], request["observed_search_operations"] = 2, "1"
    assert all(
        row["status"] == "applied"
        for row in upload(client, credentials, [request, correction]).json()["results"]
    )
    corrected = client.get("/v1/me/summary").json()
    assert corrected["observed_search_operations"] == "1"
    assert (
        next(row for row in corrected["resources"] if row["quantity"] == "energy")["reason_counts"][
            "unvalidated_reference"
        ]
        == 1
    )
    assert (
        next(row for row in corrected["media_counts"] if row["quantity"] == "image_returned_outputs")["value"]
        == "1"
    )
    assert corrected["resources"] == summary["resources"]


def test_operator_otp_replay_never_recreates_revoked_grant(setup):
    from dataclasses import replace

    app, _, _, _, _, settings = setup
    operator = TestClient(app, base_url=settings.operator_origin)
    operator.headers["Origin"] = settings.operator_origin
    challenge = operator.post(
        "/v1/operator/auth/otp/request",
        json={"purpose": "operator_login", "email": "operator@example.org", "dispatch_id": str(uuid4())},
    ).json()["challenge_id"]
    body = {
        "challenge_id": challenge,
        "code": app.state.mail.messages[-1]["code"],
        "verification_id": str(uuid4()),
    }
    first = operator.post("/v1/operator/auth/otp/verify", json=body)
    operator.cookies.clear()
    repeated = operator.post("/v1/operator/auth/otp/verify", json=body)
    assert first.status_code == repeated.status_code == 200 and first.json() == repeated.json()
    app.state.service.settings = replace(settings, operator_emails=())
    assert operator.post("/v1/operator/auth/otp/verify", json=body).status_code == 403


def test_coverage_upgrade_hides_legacy_totals_until_bounded_rebuild(setup, tmp_path, monkeypatch):
    import json
    from dataclasses import asdict
    from pathlib import Path

    from alembic import command
    from alembic.config import Config

    from aift.maintenance import run

    app, client, company, _, now, settings = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, attempt = observations(now[0])
    request["observed_search_operations"] = "3"
    upload(client, credentials, [request, attempt])
    with app.state.db.transaction() as session:
        for row in session.scalars(select(TABLES["rollup"])):
            legacy = {
                key: value
                for key, value in row.data["value"].items()
                if key
                not in {
                    "observed_search_operations",
                    "search_known_request_count",
                    "search_unknown_request_count",
                    "media_counts",
                    "image_references",
                }
            }
            row.data = {**row.data, "value": legacy}
    settings_file = tmp_path / "upgrade-settings.json"
    settings_file.write_text(json.dumps(asdict(settings)))
    monkeypatch.setenv("AIFT_SETTINGS_FILE", str(settings_file))
    server = Path(__file__).resolve().parents[1]
    config = Config(str(server / "alembic.ini"))
    config.set_main_option("script_location", str(server / "migrations"))
    with app.state.db.engine.begin() as connection:
        restore_pre_0007_schema(connection, 3)
    command.stamp(config, "0003")
    command.upgrade(config, "head")
    assert client.get("/v1/me/summary").json()["aggregate_status"] == "rebuilding"
    assert upload(client, credentials, [request]).status_code == 409
    for _ in range(4):
        run(app.state.service)
    summary = client.get("/v1/me/summary").json()
    assert summary["aggregate_status"] == "current" and summary["observed_search_operations"] == "0"
    assert summary["resources"] == []
