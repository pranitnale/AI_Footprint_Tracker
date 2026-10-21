"""
Owner decision of 14 Oct 2026: an organization administrator and the developer panel stay signed
in on the website for 7 days. Every action that changes who has access needs a fresh email code, so
a long session alone cannot remove or promote anyone (developer actions: test_operator_reauth.py).
"""

from dataclasses import replace
from datetime import timedelta
from urllib.parse import urlsplit
from uuid import uuid4

from conftest import PERSON_ANALYTICS, login, register
from fastapi.testclient import TestClient
from test_completion import reauth
from test_restore_plans import operator_client

from aift.db import get, rows
from aift.maintenance import run
from aift.security import parse_time

SEVEN_DAYS = 7 * 86400


def cookie(response, name):
    """The Set-Cookie header for one cookie name, so a test can read its Max-Age."""
    return next(value for value in response.headers.get_list("set-cookie") if value.startswith(name + "="))


def second_admin(app, company, client_origin, email="second@example.org"):
    """A second administrator, signed in on their own client."""
    with app.state.db.transaction() as s:
        member = app.state.service.member(s, get(s, "company", company.id), email)
        member.data = {**member.data, "role": "admin"}
    other = TestClient(app, base_url=client_origin)
    other.headers["Origin"] = client_origin
    login(app, other, email)
    return other, member


def test_an_administrator_session_lasts_seven_days_without_activity(setup):
    app, client, company, admin, now, _ = setup
    signed_in_at = now[0]
    requested = client.post(
        "/v1/auth/otp/request",
        json={"purpose": "login", "email": "admin@example.org", "dispatch_id": str(uuid4())},
    )
    verified = client.post(
        "/v1/auth/otp/verify",
        json={
            "challenge_id": requested.json()["challenge_id"],
            "code": app.state.mail.messages[-1]["code"],
            "verification_id": str(uuid4()),
        },
    )
    assert verified.status_code == 200, verified.text
    assert f"Max-Age={SEVEN_DAYS}" in cookie(verified, "__Host-aift")
    client.headers["X-CSRF-Token"] = verified.json()["csrf_token"]
    session = client.get("/v1/auth/session").json()
    assert parse_time(session["expires_at"]) == signed_in_at + timedelta(seconds=SEVEN_DAYS)
    # No request at all for almost 7 days: still signed in, and the read does not extend the end.
    now[0] = signed_in_at + timedelta(days=6, hours=23)
    assert client.get("/v1/admin/users").status_code == 200
    assert client.get("/v1/auth/session").json()["expires_at"] == session["expires_at"]
    now[0] = signed_in_at + timedelta(days=7)
    assert client.get("/v1/admin/users").status_code == 401
    assert client.get("/v1/auth/session").status_code == 401


def test_the_developer_panel_stays_signed_in_for_seven_days_without_activity(setup):
    app, _, _, _, now, settings = setup
    signed_in_at = now[0]
    panel = TestClient(app, base_url=settings.operator_origin)
    panel.headers["Origin"] = settings.operator_origin
    requested = panel.post(
        "/v1/operator/auth/otp/request",
        json={"purpose": "operator_login", "email": "operator@example.org", "dispatch_id": str(uuid4())},
    )
    verified = panel.post(
        "/v1/operator/auth/otp/verify",
        json={
            "challenge_id": requested.json()["challenge_id"],
            "code": app.state.mail.messages[-1]["code"],
            "verification_id": str(uuid4()),
        },
    )
    assert verified.status_code == 200, verified.text
    assert f"Max-Age={SEVEN_DAYS}" in cookie(verified, "__Host-aift-operator")
    panel.headers["X-CSRF-Token"] = verified.json()["csrf_token"]
    with app.state.db.transaction(readonly=True) as s:
        stored = next(row for row in rows(s, "session") if row.data["purpose"] == "operator")
        assert parse_time(stored.data["expires"]) == signed_in_at + timedelta(seconds=SEVEN_DAYS)
    # No request at all for almost 7 days: still signed in, and a read does not extend the end.
    now[0] = signed_in_at + timedelta(days=6, hours=23)
    assert panel.get("/v1/operator/organizations").status_code == 200
    assert panel.get("/v1/operator/auth/session").status_code == 200
    now[0] = signed_in_at + timedelta(days=7)
    assert panel.get("/v1/operator/organizations").status_code == 401
    assert panel.get("/v1/operator/auth/session").status_code == 401


def test_signing_out_or_removing_the_developer_address_ends_a_six_day_developer_session(setup):
    app, _, _, _, now, settings = setup
    panel = operator_client(app, settings)
    other = operator_client(app, settings)
    cookie_value = panel.cookies.get("__Host-aift-operator")
    now[0] += timedelta(days=6)
    assert panel.get("/v1/operator/organizations").status_code == 200
    assert panel.delete("/v1/operator/auth/session").status_code == 200
    panel.cookies.set(
        "__Host-aift-operator", cookie_value, domain=urlsplit(settings.operator_origin).hostname
    )
    assert panel.get("/v1/operator/organizations").status_code == 401
    assert panel.get("/v1/operator/auth/session").status_code == 401
    # Removing the address from the settings refuses its other session at once.
    assert other.get("/v1/operator/organizations").status_code == 200
    app.state.service.settings = replace(settings, operator_emails=())
    refused = other.get("/v1/operator/organizations")
    assert refused.status_code == 403 and refused.json()["error"]["code"] == "operator_grant_revoked"
    # Maintenance then deletes it, so adding the address back does not bring the session back.
    run(app.state.service)
    app.state.service.settings = settings
    assert other.get("/v1/operator/organizations").status_code == 401
    with app.state.db.transaction(readonly=True) as s:
        assert not any(row.data["purpose"] == "operator" for row in rows(s, "session"))


def test_registration_hands_over_a_seven_day_session_and_keeps_its_own_cookie_short(setup):
    app, _, _, _, _, settings = setup
    _, verified, _ = register(app, settings)
    assert f"Max-Age={SEVEN_DAYS}" in cookie(verified, "__Host-aift")
    assert "Max-Age=86400" in cookie(verified, "__Host-aift-registration")
    with app.state.db.transaction(readonly=True) as s:
        lifetimes = {row.data["purpose"]: row.data["expires"] for row in rows(s, "session")}
    now = app.state.service.now()
    assert parse_time(lifetimes["tenant"]) == now + timedelta(seconds=SEVEN_DAYS)
    assert parse_time(lifetimes["registration"]) == now + timedelta(days=1)


def test_a_role_change_needs_a_fresh_email_code(setup):
    app, client, company, admin, _, _ = setup
    login(app, client)
    with app.state.db.transaction() as s:
        member = app.state.service.member(s, get(s, "company", company.id), "employee@example.org")
    path = f"/v1/admin/users/{member.id}/role"
    body = {"role": "admin", "expected_version": 1, "idempotency_key": str(uuid4())}
    missing = client.put(path, json=body)
    assert missing.status_code == 422
    refused = client.put(path, json={**body, "reauth_token": "x" * 43})
    assert refused.status_code == 403 and refused.json()["error"]["code"] == "reauthentication_required"
    with app.state.db.transaction(readonly=True) as s:
        assert get(s, "member", member.id, company.id).data["role"] == "user"
    promoted = client.put(path, json={**body, "reauth_token": reauth(app, company, admin)})
    assert promoted.status_code == 200 and promoted.json()["role"] == "admin"
    # A retry of the same change replays its answer; the used code is not asked for again.
    assert client.put(path, json={**body, "reauth_token": "y" * 43}).json() == promoted.json()
    with app.state.db.transaction(readonly=True) as s:
        assert any(event.data["action"] == "role_changed" for event in rows(s, "audit", company.id))


def test_signing_out_ends_a_seven_day_session_at_once(setup):
    app, client, _, _, now, _ = setup
    login(app, client)
    cookie_value = client.cookies.get("__Host-aift")
    now[0] += timedelta(days=6)
    assert client.delete("/v1/auth/session").status_code == 200
    client.cookies.set("__Host-aift", cookie_value, domain="example.aifootprinttracker.com")
    assert client.get("/v1/auth/session").status_code == 401
    assert client.get("/v1/admin/users").status_code == 401


def test_suspension_and_demotion_end_a_seven_day_session(setup):
    app, client, company, admin, now, _ = setup
    login(app, client)
    origin = company.data["origin"]
    suspended, first = second_admin(app, company, origin)
    demoted, second = second_admin(app, company, origin, "third@example.org")
    now[0] += timedelta(days=6)
    assert suspended.get("/v1/admin/users").status_code == 200
    assert demoted.get("/v1/admin/users").status_code == 200
    users = {item["user_id"]: item for item in client.get("/v1/admin/users").json()["items"]}
    result = client.put(
        f"/v1/admin/users/{first.id}/status",
        json={
            "status": "suspended",
            "expected_version": users[first.id]["membership_version"],
            "reauth_token": reauth(app, company, admin),
        },
    )
    assert result.status_code == 200, result.text
    assert suspended.get("/v1/admin/users").status_code == 401
    result = client.put(
        f"/v1/admin/users/{second.id}/role",
        json={
            "role": "user",
            "expected_version": users[second.id]["membership_version"],
            "idempotency_key": str(uuid4()),
            "reauth_token": reauth(app, company, admin),
        },
    )
    assert result.status_code == 200, result.text
    assert demoted.get("/v1/admin/users").status_code == 401
    assert demoted.get("/v1/auth/session").status_code == 401
    with app.state.db.transaction(readonly=True) as s:
        assert rows(s, "session", company.id, first.id) == []
        assert rows(s, "session", company.id, second.id) == []


def refused_without_a_fresh_code(response):
    return response.status_code == 403 and response.json()["error"]["code"] == "reauthentication_required"


def test_a_policy_change_needs_a_fresh_email_code(setup):
    app, client, company, admin, _, _ = setup
    login(app, client)
    body = {
        "expected_version": "1.0.0",
        "timezone": "Europe/Berlin",
        "pause_mode": "user_controlled",
        "company_sharing": "disabled",
        # A shorter usage retention deletes older usage for good, so it is covered too.
        "usage_retention": "3",
        "idempotency_key": str(uuid4()),
    }
    assert client.put("/v1/admin/policy", json=body).status_code == 422
    assert refused_without_a_fresh_code(
        client.put("/v1/admin/policy", json={**body, "reauth_token": "x" * 43})
    )
    with app.state.db.transaction(readonly=True) as s:
        unchanged = get(s, "company", company.id).data
        assert unchanged["policy_version"] == "1.0.0" and unchanged.get("retention_choice") is None
    saved = client.put("/v1/admin/policy", json={**body, "reauth_token": reauth(app, company, admin)})
    assert saved.status_code == 200, saved.text
    assert saved.json()["policy_version"] == "1.0.1" and saved.json()["usage_retention_months"] == 3
    # A retry of the same change replays its answer; the used code is not asked for again.
    assert client.put("/v1/admin/policy", json={**body, "reauth_token": "y" * 43}).json() == saved.json()
    changed = {**body, "company_sharing": "threshold", "reauth_token": reauth(app, company, admin)}
    assert client.put("/v1/admin/policy", json=changed).json()["error"]["code"] == "idempotency_conflict"
    with app.state.db.transaction(readonly=True) as s:
        assert get(s, "company", company.id).data["policy_version"] == "1.0.1"
        assert [e.data["action"] for e in rows(s, "audit", company.id)].count("policy_changed") == 1


def test_an_export_needs_a_fresh_email_code_and_only_its_creator_reads_it(setup):
    app, client, company, admin, _, _ = setup
    login(app, client)
    body = {"report": "summary", "period": "all", "idempotency_key": str(uuid4())}
    assert client.post("/v1/admin/exports", json=body).status_code == 422
    assert refused_without_a_fresh_code(
        client.post("/v1/admin/exports", json={**body, "reauth_token": "x" * 43})
    )
    with app.state.db.transaction(readonly=True) as s:
        assert rows(s, "export", company.id) == []
    created = client.post("/v1/admin/exports", json={**body, "reauth_token": reauth(app, company, admin)})
    assert created.status_code == 200, created.text
    assert client.post("/v1/admin/exports", json={**body, "reauth_token": "y" * 43}).json() == created.json()
    with app.state.db.transaction(readonly=True) as s:
        assert len(rows(s, "export", company.id)) == 1
    assert client.get(created.json()["download_path"]).status_code == 200
    # The export's id is in the audit log every administrator sees, but only its creator opens it.
    other, _ = second_admin(app, company, company.data["origin"])
    audit = other.get("/v1/admin/audit").json()["items"]
    assert any(event["target"] == created.json()["export_id"] for event in audit)
    for path in (created.json()["status_path"], created.json()["download_path"]):
        refused = other.get(path)
        assert refused.status_code == 404 and refused.json()["error"]["code"] == "export_unavailable"


def test_acknowledging_a_plan_change_needs_a_fresh_email_code(setup):
    from test_entitlement_transitions import assign, detail, plan

    app, client, company, admin, now, settings = setup
    login(app, client)
    operator = operator_client(app, settings)
    plan(operator, "shorter", 3)
    scheduled = assign(operator, company, "shorter", now[0] + timedelta(days=14))
    assert scheduled.status_code == 200, scheduled.text
    transition = next(
        row
        for row in detail(operator, company)["transitions"]
        if row["transition_id"] == scheduled.json()["transition_id"]
    )
    body = {
        "transition_id": transition["transition_id"],
        "expected_version": transition["version"],
        "confirmed": True,
        "idempotency_key": str(uuid4()),
    }
    path = "/v1/admin/plan-transition/acknowledge"
    assert client.post(path, json=body).status_code == 422
    assert refused_without_a_fresh_code(client.post(path, json={**body, "reauth_token": "x" * 43}))
    with app.state.db.transaction(readonly=True) as s:
        assert not get(s, "transition", transition["transition_id"], company.id).data.get("acknowledged")
    acknowledged = client.post(path, json={**body, "reauth_token": reauth(app, company, admin)})
    assert acknowledged.status_code == 200, acknowledged.text
    assert acknowledged.json() == {"acknowledged": True, "transition_id": transition["transition_id"]}
    assert client.post(path, json={**body, "reauth_token": "y" * 43}).json() == acknowledged.json()
    with app.state.db.transaction(readonly=True) as s:
        assert get(s, "transition", transition["transition_id"], company.id).data["acknowledged"] is True
        actions = [event.data["action"] for event in rows(s, "audit", company.id)]
        assert actions.count("retention_transition_acknowledged") == 1


@PERSON_ANALYTICS
def test_connection_addresses_open_only_after_a_fresh_email_code(setup):
    app, client, company, admin, now, _ = setup
    login(app, client)
    assert refused_without_a_fresh_code(client.get("/v1/admin/network"))
    assert client.post("/v1/admin/network/access", json={}).status_code == 422
    assert refused_without_a_fresh_code(
        client.post("/v1/admin/network/access", json={"reauth_token": "x" * 43})
    )
    assert refused_without_a_fresh_code(client.get("/v1/admin/network"))
    proof = reauth(app, company, admin)
    opened = client.post("/v1/admin/network/access", json={"reauth_token": proof})
    assert opened.status_code == 200, opened.text
    assert parse_time(opened.json()["expires_at"]) == now[0] + timedelta(minutes=15)
    # The code is single use; the opened session keeps the addresses for 15 minutes.
    assert refused_without_a_fresh_code(client.post("/v1/admin/network/access", json={"reauth_token": proof}))
    assert client.get("/v1/admin/network").status_code == 200
    # Another session of the same administrator, such as a browser left open elsewhere, stays closed.
    elsewhere = TestClient(app, base_url=company.data["origin"])
    elsewhere.headers["Origin"] = company.data["origin"]
    login(app, elsewhere)
    assert refused_without_a_fresh_code(elsewhere.get("/v1/admin/network"))
    now[0] += timedelta(minutes=15)
    assert refused_without_a_fresh_code(client.get("/v1/admin/network"))
