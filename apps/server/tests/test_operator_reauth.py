"""
Owner decision of 14 Oct 2026: the developer panel stays signed in for 7 days. It reaches every
organization, so each developer action that changes an organization's status or entitlement,
approves a domain or deletes data needs a fresh email code sent to the configured developer address.
"""

from datetime import timedelta
from uuid import uuid4

import pytest
from conftest import operator_code, operator_confirmed
from fastapi.testclient import TestClient
from test_completion import reauth
from test_contact import message, website
from test_entitlement_transitions import assign, detail, grant, plan
from test_restore_plans import operator_client

from aift.db import get, rows
from aift.maintenance import run
from aift.security import instant


def refused_without_a_fresh_code(response):
    return response.status_code == 403 and response.json()["error"]["code"] == "reauthentication_required"


def request_code(panel, email="operator@example.org"):
    return panel.post(
        "/v1/operator/auth/otp/request",
        json={"purpose": "operator_reauth", "email": email, "dispatch_id": str(uuid4())},
    )


def audit_actions(app):
    with app.state.db.transaction(readonly=True) as s:
        return [event.data["action"] for event in rows(s, "audit")]


def status_change(app, panel, company, now):
    def unchanged():
        with app.state.db.transaction(readonly=True) as s:
            assert get(s, "company", company.id).data["status"] == "active"

    body = {
        "expected_version": detail(panel, company)["version"],
        "status": "suspended",
        "reason": "Confirmed abuse report",
        "idempotency_key": str(uuid4()),
    }
    return "PUT", f"/v1/operator/organizations/{company.id}/status", body, unchanged


def plan_assignment(app, panel, company, now):
    plan(panel, "larger", 12, 75)

    def unchanged():
        assert detail(panel, company)["plan_id"] != "larger"

    body = {
        "expected_version": detail(panel, company)["version"],
        "plan_id": "larger",
        "plan_version": 1,
        "effective_at": instant(now[0]),
        "reason": "Reviewed plan assignment",
        "idempotency_key": str(uuid4()),
    }
    return "PUT", f"/v1/operator/organizations/{company.id}/entitlement", body, unchanged


def exception_grant(app, panel, company, now):
    def unchanged():
        assert detail(panel, company)["exceptions"] == []

    body = {
        "expected_version": detail(panel, company)["version"],
        "member_capacity": 100,
        "retention_months": 12,
        "effective_at": instant(now[0]),
        "expires_at": instant(now[0] + timedelta(days=30)),
        "reason": "Reviewed temporary expansion",
        "idempotency_key": str(uuid4()),
    }
    return "POST", f"/v1/operator/organizations/{company.id}/exceptions", body, unchanged


def exception_revocation(app, panel, company, now):
    # The exception keeps the current retention, so ending it needs no administrator acknowledgement.
    granted = panel.post(
        f"/v1/operator/organizations/{company.id}/exceptions",
        json=operator_confirmed(
            panel,
            {
                "expected_version": detail(panel, company)["version"],
                "member_capacity": 100,
                "retention_months": detail(panel, company)["retention_months"],
                "effective_at": instant(now[0]),
                "expires_at": instant(now[0] + timedelta(days=30)),
                "reason": "Temporary capacity increase",
                "idempotency_key": str(uuid4()),
            },
        ),
    ).json()

    def unchanged():
        [item] = detail(panel, company)["exceptions"]
        assert item["status"] == "active"

    body = {
        "expected_version": granted["version"],
        "reason": "End the temporary exception",
        "idempotency_key": str(uuid4()),
        "transition_acknowledgement": None,
    }
    return (
        "DELETE",
        f"/v1/operator/organizations/{company.id}/exceptions/{granted['exception_id']}",
        body,
        unchanged,
    )


def exception_replacement(app, panel, company, now):
    plan(panel, "replacement", 12, 75)
    exception = grant(panel, company, now[0], now[0] + timedelta(days=30))
    current = detail(panel, company)
    reversal = next(
        row for row in current["transitions"] if row["transition_id"] == exception["reversion_transition_id"]
    )

    def unchanged():
        [item] = detail(panel, company)["exceptions"]
        assert item["status"] == "active"

    body = {
        "expected_version": exception["version"],
        "expected_company_version": current["version"],
        "expected_transition_version": reversal["version"],
        "expected_entitlement_generation": current["entitlement_generation"],
        "plan_id": "replacement",
        "plan_version": 1,
        "confirmed": True,
        "reason": "Replace the temporary exception with a plan",
        "idempotency_key": str(uuid4()),
    }
    path = f"/v1/operator/organizations/{company.id}/exceptions/{exception['exception_id']}/replace"
    return "POST", path, body, unchanged


def transition_cancellation(app, panel, company, now):
    plan(panel, "later", 12, 75)
    identifier = assign(panel, company, "later", now[0] + timedelta(days=14)).json()["transition_id"]
    current = detail(panel, company)
    transition = next(row for row in current["transitions"] if row["transition_id"] == identifier)

    def unchanged():
        state = next(
            row for row in detail(panel, company)["transitions"] if row["transition_id"] == identifier
        )
        assert state["status"] == "pending"

    body = {
        "expected_version": transition["version"],
        "expected_company_version": current["version"],
        "confirmed": True,
        "reason": "Cancel the planned change",
        "idempotency_key": str(uuid4()),
    }
    return "POST", f"/v1/operator/organizations/{company.id}/transitions/{identifier}/cancel", body, unchanged


def transition_review(app, panel, company, now):
    plan(panel, "unverified", 12)
    identifier = assign(panel, company, "unverified", now[0] + timedelta(seconds=10)).json()["transition_id"]
    # A transition saved without its base entitlement waits for a developer review when it is due.
    with app.state.db.transaction() as s:
        legacy = get(s, "transition", identifier, company.id)
        legacy.data = {
            k: v for k, v in legacy.data.items() if k not in {"base_generation", "base_entitlement"}
        }
    now[0] += timedelta(seconds=11)
    run(app.state.service)
    current = detail(panel, company)
    transition = next(row for row in current["transitions"] if row["transition_id"] == identifier)
    assert transition["status"] == "review_required"

    def unchanged():
        state = next(
            row for row in detail(panel, company)["transitions"] if row["transition_id"] == identifier
        )
        assert state["status"] == "review_required"

    body = {
        "expected_version": transition["version"],
        "expected_company_version": current["version"],
        "confirmed": True,
        "reason": "Review against the current entitlement",
        "idempotency_key": str(uuid4()),
    }
    return "POST", f"/v1/operator/organizations/{company.id}/transitions/{identifier}/review", body, unchanged


def domain_approval(app, panel, company, now):
    def unchanged():
        with app.state.db.transaction(readonly=True) as s:
            assert rows(s, "domain_claim") == []

    body = {
        "domain": "example-group.org",
        "expected_version": 0,
        "reason": "Subsidiary of a registered organization",
        "expires_at": instant(now[0] + timedelta(days=7)),
        "idempotency_key": str(uuid4()),
    }
    return "POST", "/v1/operator/domain-claims", body, unchanged


def contact_deletion(app, panel, company, now):
    settings = app.state.service.settings
    assert website(app, settings).post("/v1/public/contact", json=message()).status_code == 200
    [item] = panel.get("/v1/operator/contacts").json()["items"]

    def unchanged():
        assert len(panel.get("/v1/operator/contacts").json()["items"]) == 1

    return "DELETE", f"/v1/operator/contacts/{item['id']}", {"idempotency_key": str(uuid4())}, unchanged


@pytest.mark.parametrize(
    "action",
    [
        status_change,
        plan_assignment,
        exception_grant,
        exception_revocation,
        exception_replacement,
        transition_cancellation,
        transition_review,
        domain_approval,
        contact_deletion,
    ],
)
def test_each_developer_action_that_changes_access_or_deletes_data_needs_a_fresh_code(setup, action):
    app, _, company, admin, now, settings = setup
    panel = operator_client(app, settings)
    method, path, body, unchanged = action(app, panel, company, now)
    before = audit_actions(app)
    missing = panel.request(method, path, json=body)
    assert missing.status_code == 422, missing.text
    assert refused_without_a_fresh_code(panel.request(method, path, json={**body, "reauth_token": "x" * 43}))
    # An administrator's code for the organization is not a developer code.
    assert refused_without_a_fresh_code(
        panel.request(method, path, json={**body, "reauth_token": reauth(app, company, admin)})
    )
    unchanged()
    assert audit_actions(app) == before
    proof = operator_code(panel)
    done = panel.request(method, path, json={**body, "reauth_token": proof})
    assert done.status_code == 200, done.text
    # A retry of the same action replays its answer; the used code is not asked for again.
    assert panel.request(method, path, json={**body, "reauth_token": "y" * 43}).json() == done.json()
    assert len(audit_actions(app)) == len(before) + 1


def test_reading_and_harmless_actions_need_no_code(setup):
    app, _, company, _, _, settings = setup
    panel = operator_client(app, settings)
    for path in (
        "/v1/operator/organizations",
        f"/v1/operator/organizations/{company.id}",
        "/v1/operator/exceptions",
        "/v1/operator/domain-claims",
        "/v1/operator/plans",
        "/v1/operator/contacts",
        "/v1/operator/health",
        "/v1/operator/audit",
        "/v1/operator/diagnostics",
    ):
        assert panel.get(path).status_code == 200, path
    assert website(app, settings).post("/v1/public/contact", json=message()).status_code == 200
    [item] = panel.get("/v1/operator/contacts").json()["items"]
    replied = panel.post(f"/v1/operator/contacts/{item['id']}", json={"status": "replied"})
    assert replied.status_code == 200 and replied.json()["status"] == "replied"
    # A plan version changes no organization until it is assigned, which needs a code.
    plan(panel, "catalog-only", 12)


def test_a_developer_code_goes_only_to_the_configured_address_of_the_signed_in_developer(setup):
    app, client, company, _, now, settings = setup
    panel = operator_client(app, settings)
    # Only case is ignored, as at sign-in; the code goes to the configured address.
    sent = request_code(panel, "Operator@Example.org")
    assert sent.status_code == 200, sent.text
    mailed = app.state.mail.messages[-1]
    assert mailed["recipient"] == "operator@example.org" and mailed["purpose"] == "operator_reauth"
    assert request_code(panel, "operator+x@example.org").json()["error"]["code"] == "identity_unavailable"
    assert request_code(panel, "admin@example.org").json()["error"]["code"] == "identity_unavailable"
    signed_out = TestClient(app, base_url=settings.operator_origin)
    signed_out.headers["Origin"] = settings.operator_origin
    assert request_code(signed_out).status_code == 401
    # An organization's site cannot ask for a developer code.
    refused = client.post(
        "/v1/auth/otp/request",
        json={"purpose": "operator_reauth", "email": "admin@example.org", "dispatch_id": str(uuid4())},
    )
    assert refused.status_code == 400
    # A resent code goes to the same address.
    now[0] += timedelta(seconds=61)
    resent = panel.post(
        "/v1/auth/otp/resend",
        json={"challenge_id": sent.json()["challenge_id"], "dispatch_id": str(uuid4())},
    )
    assert resent.status_code == 200, resent.text
    mailed = app.state.mail.messages[-1]
    assert mailed["recipient"] == "operator@example.org" and mailed["purpose"] == "operator_reauth"
    verification = {
        "challenge_id": resent.json()["challenge_id"],
        "code": mailed["code"],
        "verification_id": str(uuid4()),
    }
    verified = panel.post("/v1/operator/auth/otp/verify", json=verification)
    assert verified.status_code == 200, verified.text
    assert set(verified.json()) == {"reauth_token", "expires_at"}
    assert not any(value.startswith("__Host-aift") for value in verified.headers.get_list("set-cookie"))
    # A lost answer can be fetched again while the code is unused.
    assert panel.post("/v1/operator/auth/otp/verify", json=verification).json() == verified.json()
    method, path, body, _ = status_change(app, panel, company, now)
    proof = verified.json()["reauth_token"]
    done = panel.request(method, path, json={**body, "reauth_token": proof})
    assert done.status_code == 200, done.text
    assert panel.post("/v1/operator/auth/otp/verify", json=verification).status_code == 401
    # The code works once: restoring the service needs another one.
    restore = {
        **body,
        "status": "active",
        "expected_version": done.json()["version"],
        "idempotency_key": str(uuid4()),
    }
    assert refused_without_a_fresh_code(panel.request(method, path, json={**restore, "reauth_token": proof}))
    assert panel.request(method, path, json=operator_confirmed(panel, restore)).status_code == 200


def test_a_developer_sign_in_code_can_be_resent(setup):
    app, _, _, _, now, settings = setup
    panel = TestClient(app, base_url=settings.operator_origin)
    panel.headers["Origin"] = settings.operator_origin
    sent = panel.post(
        "/v1/operator/auth/otp/request",
        json={"purpose": "operator_login", "email": "operator@example.org", "dispatch_id": str(uuid4())},
    )
    assert sent.status_code == 200, sent.text
    now[0] += timedelta(seconds=61)
    resent = panel.post(
        "/v1/auth/otp/resend",
        json={"challenge_id": sent.json()["challenge_id"], "dispatch_id": str(uuid4())},
    )
    assert resent.status_code == 200, resent.text
    mailed = app.state.mail.messages[-1]
    assert mailed["recipient"] == "operator@example.org" and mailed["purpose"] == "operator_login"
    verification = {
        "challenge_id": resent.json()["challenge_id"],
        "code": mailed["code"],
        "verification_id": str(uuid4()),
    }
    verified = panel.post("/v1/operator/auth/otp/verify", json=verification)
    assert verified.status_code == 200 and verified.json()["destination"] == "/operator"
