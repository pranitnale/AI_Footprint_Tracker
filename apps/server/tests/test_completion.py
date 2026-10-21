from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import timedelta
from threading import Barrier
from uuid import uuid4

import pytest
from conftest import confirmed, connect, login
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from test_analytics import observations, upload

from aift.db import TABLES, DeletionTombstone, Observation, get, put, rows
from aift.main import create_app
from aift.maintenance import run
from aift.security import digest, instant, token


def reauth(app, company, admin):
    proof = token()
    with app.state.db.transaction() as session:
        put(
            session,
            "reauth",
            digest(proof),
            {"expires": app.state.service.expires(300), "used": False},
            company.id,
            admin.id,
        )
    return proof


def finish_job(app, company, job_id, ticks=30):
    for _ in range(ticks):
        run(app.state.service)
        with app.state.db.transaction(readonly=True) as session:
            job = get(session, "deletion_job", job_id, company.id)
            if job is None:
                from aift.db import TABLES

                job = session.scalar(
                    select(TABLES["deletion_job"]).where(
                        TABLES["deletion_job"].tenant == company.id,
                        TABLES["deletion_job"].data["operation_id"].as_string() == job_id,
                    )
                )
            if job.data["status"] == "completed":
                return job
            assert job.data["status"] != "failed", job.data
    pytest.fail("bounded worker did not finish the persisted job")


def test_large_deletion_is_bounded_resumable_complete_and_receipts_independent(setup, monkeypatch):
    app, client, company, admin, now, settings = setup
    login(app, client)
    credentials, _ = connect(app, client)
    payloads = []
    for _ in range(103):
        payloads.extend(observations(now[0]))
    for offset in range(0, len(payloads), 100):
        assert upload(client, credentials, payloads[offset : offset + 100]).status_code == 200
    preview = client.post(
        "/v1/admin/deletions/preview",
        json={
            "scope": "range",
            "start": instant(now[0] - timedelta(seconds=1)),
            "end": instant(now[0] + timedelta(seconds=1)),
        },
    ).json()
    assert preview["state"] == "pending" and preview["counts_complete"] is False
    assert preview["request_count"] == "100" and preview["record_count"] == "200"
    run(app.state.service)
    ready = client.get(preview["status_path"]).json()
    assert ready["state"] == "ready" and ready["request_count"] == "103" and ready["record_count"] == "206"
    body = {
        "preview_token": ready["preview_token"],
        "idempotency_key": str(uuid4()),
        "confirmed": True,
        "reauth_token": reauth(app, company, admin),
    }
    created = client.post("/v1/admin/deletions", json=body)
    assert created.status_code == 200, created.text
    assert created.json()["status"] == "applying" and created.json()["records_erased"] <= 100
    assert client.get("/v1/me/summary").json()["aggregate_status"] == "rebuilding"
    changed = deepcopy(payloads[0])
    changed["revision"] += 1
    changed["dispatched_at"] = instant(now[0] + timedelta(seconds=2))
    changed["ended_at"] = changed["dispatched_at"]
    assert upload(client, credentials, [changed], 1).json()["results"][0]["status"] == "erased"
    original = app.state.service.analytics.deletions._erase_record

    def crash(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError("simulated process boundary failure")

    monkeypatch.setattr(app.state.service.analytics.deletions, "_erase_record", crash)
    run(app.state.service)
    with app.state.db.transaction(readonly=True) as session:
        failed = get(session, "deletion_job", created.json()["job_id"], company.id)
        assert failed.data["status"] == "failed"
        assert failed.data["records_erased"] == created.json()["records_erased"]
    restarted = create_app(settings, clock=lambda: now[0])
    job = finish_job(restarted, company, created.json()["job_id"])
    assert job.data["records_erased"] == 206
    with restarted.state.db.transaction(readonly=True) as session:
        assert (
            session.scalar(
                select(func.count()).select_from(Observation).where(Observation.tenant == company.id)
            )
            == 0
        )
        assert (
            session.scalar(
                select(func.count())
                .select_from(DeletionTombstone)
                .where(DeletionTombstone.tenant == company.id)
            )
            == 206
        )
        status = restarted.state.service.analytics.deletions.job_result(
            session, get(session, "company", company.id), job
        )
        assert status["active_database_verified"] is True and status["device_receipts"] == {
            "total": 1,
            "acknowledged": 0,
            "pending": 1,
        }
    receipt = {
        "device_id": credentials["device_id"],
        "credential": credentials["deletion_receipt_credential"],
        "last_epoch": 1,
        "purged": True,
    }
    assert client.post("/v1/deletions/ack", json=receipt).status_code == 200
    final = client.get("/v1/admin/deletions/" + created.json()["job_id"]).json()
    assert final["device_acknowledgement_complete"] is True


def test_policy_history_acknowledgements_repeated_changes_and_queue_eras(setup):
    app, client, company, _, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    first, _ = observations(now[0])
    auth = {"Authorization": "Bearer " + credentials["access_token"]}
    now[0] += timedelta(seconds=10)
    assert (
        client.put(
            "/v1/admin/policy",
            json=confirmed(
                client,
                {
                    "expected_version": "1.0.0",
                    "timezone": "Europe/Berlin",
                    "pause_mode": "disabled_by_company",
                    "company_sharing": "threshold",
                },
            ),
        ).status_code
        == 200
    )
    offline_old, _ = observations(now[0])
    now[0] += timedelta(seconds=10)
    assert client.get("/v1/config", headers=auth).json()["policy"]["policy_version"] == "1.0.1"
    ack1 = client.post("/v1/config/acknowledge", json={"policy_version": "1.0.1"}, headers=auth).json()
    assert (
        client.post("/v1/config/acknowledge", json={"policy_version": "1.0.1"}, headers=auth).json() == ack1
    )
    middle, _ = observations(now[0])
    middle["policy_version"] = "1.0.1"
    now[0] += timedelta(seconds=10)
    assert (
        client.put(
            "/v1/admin/policy",
            json=confirmed(
                client,
                {
                    "expected_version": "1.0.1",
                    "timezone": "Europe/Berlin",
                    "pause_mode": "user_controlled",
                    "company_sharing": "threshold",
                },
            ),
        ).status_code
        == 200
    )
    now[0] += timedelta(seconds=10)
    client.get("/v1/config", headers=auth)
    assert (
        client.post("/v1/config/acknowledge", json={"policy_version": "1.0.2"}, headers=auth).status_code
        == 200
    )
    current, _ = observations(now[0])
    current["policy_version"] = "1.0.2"
    result = upload(client, credentials, [first, offline_old, middle, current])
    assert [r["status"] for r in result.json()["results"]] == ["applied"] * 4
    wrong = {**current, "request_id": str(uuid4()), "policy_version": "1.0.0"}
    assert upload(client, credentials, [wrong]).json()["results"][0]["error_code"] == "policy_mismatch"
    with app.state.db.transaction() as session:
        versions = rows(session, "policy", company.id)
        assert len(versions) == 3
    with pytest.raises(ValueError, match="immutable_policy_history"):
        with app.state.db.transaction() as session:
            version = rows(session, "policy", company.id)[0]
            version.data = {**version.data, "hash": "tampered"}


def test_cross_installation_same_execution_and_distinct_dispatch_links(setup):
    app, client, company, _, now, _ = setup
    login(app, client)
    first_device, _ = connect(app, client)
    second_device, _ = connect(app, client)
    request, attempt = observations(now[0])
    request["provider_request_key"] = "b" * 64
    attempt["provider_attempt_key"] = "c" * 64
    # The copy below ties with this attempt in live_evidence_order, which then prefers the lower
    # attempt id. Fixed ids keep the original canonical, so the copy is aliased on every run.
    attempt["attempt_id"] = "00000000-0000-4000-8000-000000000001"
    assert upload(client, first_device, [request, attempt]).status_code == 200
    copied_request = {**request, "request_id": str(uuid4())}
    copied_attempt = {
        **attempt,
        "request_id": copied_request["request_id"],
        "attempt_id": "00000000-0000-4000-8000-000000000002",
    }
    duplicate = upload(client, second_device, [copied_request, copied_attempt])
    assert [row["status"] for row in duplicate.json()["results"]] == ["aliased", "aliased"]
    assert client.get("/v1/me/summary").json()["request_count"] == "1"
    distinct_request = {**request, "request_id": str(uuid4()), "provider_request_key": "d" * 64}
    shared_attempt = {**attempt, "attempt_id": str(uuid4()), "request_id": distinct_request["request_id"]}
    assert [
        r["status"]
        for r in upload(client, second_device, [distinct_request, shared_attempt]).json()["results"]
    ] == ["applied", "aliased"]
    summary = client.get("/v1/me/summary").json()
    assert summary["request_count"] == "2" and summary["attempt_count"] == "1"
    bad_revision = {**attempt, "revision": 2}
    assert (
        upload(client, second_device, [bad_revision]).json()["results"][0]["error_code"]
        == "ownership_conflict"
    )
    ambiguous = {**request, "request_id": str(uuid4()), "provider_request_key": None}
    contested = {**attempt, "request_id": ambiguous["request_id"], "attempt_id": str(uuid4())}
    assert (
        upload(client, second_device, [ambiguous, contested]).json()["results"][1]["error_code"]
        == "request_identity_ambiguous"
    )
    summary = client.get("/v1/me/summary").json()
    assert (
        summary["request_count"] == "2"
        and summary["unresolved_request_count"] == "1"
        and summary["attempt_count"] == "1"
    )


def test_stable_csrf_overlapping_reads_and_atomic_activity_update(setup, monkeypatch):
    app, client, company, admin, now, _ = setup
    login(app, client)
    original = app.state.service.principal
    barrier = Barrier(2)

    def concurrent_principal(session, ctx, *args, **kwargs):
        value = original(session, ctx, *args, **kwargs)
        if ctx["method"] == "GET":
            barrier.wait(timeout=5)
        return value

    monkeypatch.setattr(app.state.service, "principal", concurrent_principal)
    cookie = client.cookies.get("__Host-aift")

    def read(path):
        with TestClient(app, base_url=str(client.base_url)) as other:
            return other.get(
                path, headers={"Cookie": "__Host-aift=" + cookie, "Origin": company.data["origin"]}
            )

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(read, path) for path in ("/v1/auth/session", "/v1/admin/users")]
        restored, users = [future.result() for future in futures]
    assert restored.status_code == users.status_code == 200
    assert restored.json()["csrf_token"] == client.headers["X-CSRF-Token"]
    result = client.put(
        f"/v1/admin/users/{admin.id}/role",
        json={
            "role": "user",
            "expected_version": 1,
            "idempotency_key": str(uuid4()),
            "reauth_token": reauth(app, company, admin),
        },
        headers={"X-CSRF-Token": restored.json()["csrf_token"]},
    )
    assert result.status_code == 409 and result.json()["error"]["code"] == "last_admin"


def test_admin_keyset_pagination_and_bounded_protocol_worker(setup):
    app, client, company, _, _, _ = setup
    login(app, client)
    with app.state.db.transaction() as session:
        tenant = get(session, "company", company.id)
        tenant.data = {**tenant.data, "capacity": 500}
        for number in range(205):
            app.state.service.member(session, tenant, f"member{number}@example.org")
            put(
                session,
                "reauth",
                f"bounded-{number:04}",
                {"expires": "2020-01-01T00:00:00.000Z", "used": False},
                company.id,
            )
    result = client.get("/v1/admin/users?limit=17").json()
    seen = [row["user_id"] for row in result["items"]]
    while result["next_cursor"]:
        result = client.get("/v1/admin/users", params={"limit": 17, "cursor": result["next_cursor"]}).json()
        seen.extend(row["user_id"] for row in result["items"])
    assert len(seen) == len(set(seen)) == 206
    run(app.state.service)
    with app.state.db.transaction(readonly=True) as session:
        remaining = session.scalar(select(func.count()).select_from(TABLES["reauth"]))
        assert remaining == 105
    run(app.state.service)
    run(app.state.service)
    with app.state.db.transaction(readonly=True) as session:
        assert session.scalar(select(func.count()).select_from(TABLES["reauth"])) == 0


def test_firefox_profile_origins_and_absent_origin_never_authorize_web_session(setup):
    app, client, company, _, _, _ = setup
    login(app, client)
    profile_origin = "moz-extension://" + str(uuid4())
    requested = client.post(
        "/v1/connections/otp/request",
        json={"email": "admin@example.org", "dispatch_id": str(uuid4())},
        headers={"Origin": profile_origin},
    )
    assert requested.status_code == 200, requested.text
    verifier = token()
    pending = client.post(
        "/v1/connections",
        json={
            "verifier_challenge": digest(verifier),
            "challenge_method": "S256",
            "browser_family": "firefox",
            "protocol_version": "1.0.0",
            "operation_id": str(uuid4()),
            "challenge_id": requested.json()["challenge_id"],
            "code": app.state.mail.messages[-1]["code"],
        },
        headers={"Origin": profile_origin},
    )
    assert pending.status_code == 200 and pending.headers["Access-Control-Allow-Origin"] == profile_origin
    assert "Access-Control-Allow-Credentials" not in pending.headers
    # The web session's cookie travels with the request, but an extension origin never uses it.
    assert (
        client.put(
            "/v1/admin/policy",
            json={
                "expected_version": "1.0.0",
                "timezone": "UTC",
                "pause_mode": "user_controlled",
                "company_sharing": "disabled",
            },
            headers={"Origin": profile_origin},
        ).status_code
        == 403
    )
    credentials, _ = connect(app, client)
    with TestClient(app, base_url=company.data["origin"]) as privileged:
        assert (
            privileged.get(
                "/v1/config", headers={"Authorization": "Bearer " + credentials["access_token"]}
            ).status_code
            == 200
        )
        assert (
            privileged.post(
                "/v1/auth/otp/request",
                json={"purpose": "login", "email": "admin@example.org", "dispatch_id": str(uuid4())},
            ).status_code
            == 403
        )
