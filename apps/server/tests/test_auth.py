from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import timedelta
from uuid import uuid4

import pytest
from conftest import connect, login
from fastapi.testclient import TestClient
from test_completion import reauth

from aift.db import get, rows
from aift.main import create_app
from aift.security import normalize_email, token


def test_same_email_and_separate_installations(setup):
    app, client, company, admin, _, _ = setup
    login(app, client)
    first, _ = connect(app, client)
    second, _ = connect(app, client)
    assert first["user_id"] == second["user_id"] == admin.id
    assert first["device_id"] != second["device_id"]
    assert first["user_hmac_key"] == second["user_hmac_key"]
    assert first["refresh_token"] != second["refresh_token"]


def test_otp_one_use_five_attempts_and_no_secret_errors(setup):
    app, client, *_ = setup
    request = {
        "purpose": "login",
        "email": "secret-marker@example.org",
        "dispatch_id": str(uuid4()),
        "registration_id": None,
    }
    challenge = client.post("/v1/auth/otp/request", json=request).json()["challenge_id"]
    code = app.state.mail.messages[-1]["code"]
    bad = "999999" if code != "999999" else "888888"
    for _ in range(5):
        result = client.post(
            "/v1/auth/otp/verify",
            json={"challenge_id": challenge, "code": bad, "verification_id": str(uuid4())},
        )
        assert result.status_code == 401
        assert "secret-marker" not in result.text and code not in result.text
    result = client.post(
        "/v1/auth/otp/verify", json={"challenge_id": challenge, "code": code, "verification_id": str(uuid4())}
    )
    assert result.status_code == 401


def test_parallel_otp_redemption_only_one_session(setup):
    app, client, *_ = setup
    challenge = client.post(
        "/v1/auth/otp/request",
        json={"purpose": "login", "email": "admin@example.org", "dispatch_id": str(uuid4())},
    ).json()["challenge_id"]
    payload = {
        "challenge_id": challenge,
        "code": app.state.mail.messages[-1]["code"],
        "verification_id": str(uuid4()),
    }

    def redeem(_):
        with TestClient(app, base_url=str(client.base_url)) as other:
            return other.post(
                "/v1/auth/otp/verify",
                json={**payload, "verification_id": str(uuid4())},
                headers={"Origin": str(client.base_url).rstrip("/")},
            ).status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(redeem, range(2))) == [200, 401]


def test_dispatch_retry_and_failed_delivery_honest(setup):
    app, client, *_ = setup
    payload = {"purpose": "login", "email": "new@example.org", "dispatch_id": str(uuid4())}
    app.state.mail.fail = True
    first = client.post("/v1/auth/otp/request", json=payload)
    assert first.json()["delivery_state"] == "failed"
    assert first.json()["error_code"] == "email_service_unavailable"
    app.state.mail.fail = False
    second = client.post("/v1/auth/otp/request", json=payload)
    assert second.json() == first.json()
    assert not app.state.mail.messages


def test_connection_exchange_restart_replay_and_proof(setup):
    app, client, _, _, now, settings = setup
    login(app, client)
    credentials, payload = connect(app, client)
    assert client.post("/v1/connections/exchange", json=payload).json() == credentials
    wrong = {**payload, "exchange_id": str(uuid4())}
    assert client.post("/v1/connections/exchange", json=wrong).status_code == 403
    wrong = {**payload, "verifier": token()}
    assert client.post("/v1/connections/exchange", json=wrong).status_code == 403
    restarted = create_app(settings, clock=lambda: now[0])
    with TestClient(restarted, base_url=str(client.base_url)) as other:
        result = other.post(
            "/v1/connections/exchange", json=payload, headers={"Origin": str(client.base_url).rstrip("/")}
        )
        assert result.json() == credentials


def test_refresh_retry_and_reuse_revokes_family(setup):
    app, client, *_ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    payload = {"refresh_token": credentials["refresh_token"], "operation_id": str(uuid4())}
    rotated = client.post("/v1/auth/refresh", json=payload)
    assert rotated.status_code == 200
    assert client.post("/v1/auth/refresh", json=payload).json() == rotated.json()
    assert client.post("/v1/auth/refresh", json={**payload, "operation_id": str(uuid4())}).status_code == 403
    result = client.get("/v1/config", headers={"Authorization": "Bearer " + rotated.json()["access_token"]})
    assert result.status_code == 403


def test_csrf_sibling_tenant_and_cookie_ambiguity(setup):
    app, client, company, *_ = setup
    login(app, client)
    payload = {
        "expected_version": "1.0.0",
        "timezone": "UTC",
        "pause_mode": "user_controlled",
        "company_sharing": "disabled",
    }
    assert (
        client.put(
            "/v1/admin/policy", json=payload, headers={"Origin": "https://sibling.aifootprinttracker.com"}
        ).status_code
        == 403
    )
    assert client.put("/v1/admin/policy", json=payload, headers={"X-CSRF-Token": token()}).status_code == 403
    cookie = client.cookies.get("__Host-aift")
    assert (
        client.get(
            "/v1/auth/session", headers={"Cookie": f"__Host-aift={cookie}; __Host-aift=attacker"}
        ).status_code
        == 403
    )


def test_last_admin_role_current_checks_and_tenant_isolation(setup):
    app, client, company, admin, *_ = setup
    login(app, client)
    assert (
        client.put(
            f"/v1/admin/users/{admin.id}/role",
            json={
                "role": "user",
                "expected_version": 1,
                "idempotency_key": str(uuid4()),
                "reauth_token": reauth(app, company, admin),
            },
        ).status_code
        == 409
    )
    with app.state.db.transaction() as s:
        member = app.state.service.member(s, get(s, "company", company.id), "employee@example.org")
    response = client.put(
        f"/v1/admin/users/{member.id}/role",
        json={
            "role": "admin",
            "expected_version": 1,
            "idempotency_key": str(uuid4()),
            "reauth_token": reauth(app, company, admin),
        },
    )
    assert response.status_code == 200
    assert (
        client.put(
            f"/v1/admin/users/{admin.id}/role",
            json={
                "role": "user",
                "expected_version": 1,
                "idempotency_key": str(uuid4()),
                "reauth_token": reauth(app, company, admin),
            },
        ).status_code
        == 200
    )
    assert client.get("/v1/admin/users").status_code == 401
    # A former administrator is a member now, and members do not sign in on the website.
    challenge = client.post(
        "/v1/auth/otp/request",
        json={"purpose": "login", "email": "admin@example.org", "dispatch_id": str(uuid4())},
    ).json()["challenge_id"]
    refused = client.post(
        "/v1/auth/otp/verify",
        json={"challenge_id": challenge, "code": app.state.mail.messages[-1]["code"], "verification_id": str(uuid4())},
    )
    assert refused.status_code == 403 and refused.json()["error"]["code"] == "admin_required"
    assert "__Host-aift" not in refused.headers.get("set-cookie", "")
    assert client.get("/v1/admin/users").status_code == 401


def test_reconnect_same_installation_preserves_eras(setup):
    app, client, company, _, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    result = client.post(
        "/v1/connections/disconnect",
        json={},
        headers={"Authorization": "Bearer " + credentials["access_token"]},
    )
    assert result.status_code == 200
    now[0] += timedelta(minutes=5)
    renewed, _ = connect(app, client, resume=credentials)
    assert renewed["device_id"] == credentials["device_id"]
    with app.state.db.transaction() as s:
        eras = rows(s, "era", company.id)
        assert len(eras) == 2 and sum(r.data["end"] is None for r in eras) == 1


def test_email_canonicalization_preserves_local_part():
    assert normalize_email(" User.Name+tag@EXAMPLE.org ") == "User.Name+tag@example.org"
    assert normalize_email("User@example.org") != normalize_email("user@example.org")


def test_production_fails_closed(setup):
    settings = setup[-1]
    with pytest.raises(ValueError, match="configuration_required"):
        create_app(replace(settings, environment="production"))


def test_ingress_rejects_duplicate_and_marker_fields(setup):
    _, client, *_ = setup
    result = client.post(
        "/v1/auth/otp/request",
        content='{"email":"private-marker@example.org","email":"different@example.org"}',
        headers={"Content-Type": "application/json"},
    )
    assert result.status_code == 422 and "private-marker" not in result.text
    result = client.post("/v1/connections", json={"prompt": "PRIVATE-MARKER"})
    assert result.status_code == 422 and "PRIVATE-MARKER" not in result.text
    assert client.post("/v1/connections", content="a" * 524289).status_code == 413
