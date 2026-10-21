from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from conftest import confirmed, connect, login, operator_confirmed
from test_analytics import observations, upload
from test_restore_plans import operator_client

from aift.db import get
from aift.maintenance import run
from aift.security import instant


def plan(operator, name, months, capacity=75):
    response = operator.post(
        "/v1/operator/plans",
        json={
            "plan_id": name,
            "version": 1,
            "member_capacity": capacity,
            "retention_months": months,
            "idempotency_key": str(uuid4()),
        },
    )
    assert response.status_code == 200, response.text


def detail(operator, company):
    response = operator.get(f"/v1/operator/organizations/{company.id}")
    assert response.status_code == 200, response.text
    return response.json()


def assign(operator, company, name, effective, reason="Reviewed planned assignment"):
    current = detail(operator, company)
    return operator.put(
        f"/v1/operator/organizations/{company.id}/entitlement",
        json=operator_confirmed(
            operator,
            {
                "expected_version": current["version"],
                "plan_id": name,
                "plan_version": 1,
                "effective_at": instant(effective),
                "reason": reason,
                "idempotency_key": str(uuid4()),
            },
        ),
    )


def grant(operator, company, now, expires):
    response = operator.post(
        f"/v1/operator/organizations/{company.id}/exceptions",
        json=operator_confirmed(
            operator,
            {
                "expected_version": detail(operator, company)["version"],
                "member_capacity": 100,
                "retention_months": 12,
                "effective_at": instant(now),
                "expires_at": instant(expires),
                "reason": "Reviewed temporary expansion",
                "idempotency_key": str(uuid4()),
            },
        ),
    )
    assert response.status_code == 200, response.text
    return response.json()


def ack(client, transition):
    return client.post(
        "/v1/admin/plan-transition/acknowledge",
        json=confirmed(
            client,
            {
                "transition_id": transition["transition_id"],
                "expected_version": transition["version"],
                "confirmed": True,
            },
        ),
    )


def replace_exception(operator, company, identifier, plan_id):
    current = detail(operator, company)
    exception = next(row for row in current["exceptions"] if row["exception_id"] == identifier)
    transition = next(
        row for row in current["transitions"] if row["transition_id"] == exception["reversion_transition_id"]
    )
    body = {
        "expected_version": exception["version"],
        "expected_company_version": current["version"],
        "expected_transition_version": transition["version"],
        "expected_entitlement_generation": current["entitlement_generation"],
        "plan_id": plan_id,
        "plan_version": 1,
        "confirmed": True,
        "reason": "Replace the temporary exception without an intermediate retention reduction",
        "idempotency_key": str(uuid4()),
    }
    response = operator.post(
        f"/v1/operator/organizations/{company.id}/exceptions/{identifier}/replace",
        json=operator_confirmed(operator, body),
    )
    return response, body


def cancel(operator, company, identifier):
    current = detail(operator, company)
    transition = next(row for row in current["transitions"] if row["transition_id"] == identifier)
    body = {
        "expected_version": transition["version"],
        "expected_company_version": current["version"],
        "confirmed": True,
        "reason": "Cancel superseded planned change after reviewing its impact",
        "idempotency_key": str(uuid4()),
    }
    response = operator.post(
        f"/v1/operator/organizations/{company.id}/transitions/{identifier}/cancel",
        json=operator_confirmed(operator, body),
    )
    return response, body


def test_active_exception_requires_atomic_reviewed_replacement_and_never_briefly_shortens_retention(setup):
    app, client, company, _, now, settings = setup
    now[0] = datetime(2026, 1, 10, 12, tzinfo=timezone.utc)
    login(app, client)
    credentials, _ = connect(app, client)
    assert upload(client, credentials, list(observations(now[0]))).status_code == 200
    operator = operator_client(app, settings)
    exception = grant(operator, company, now[0], datetime(2026, 9, 11, 12, tzinfo=timezone.utc))
    now[0] = datetime(2026, 9, 10, 12, tzinfo=timezone.utc)
    login(app, client)
    login(app, operator, "operator@example.org", operator=True)
    plan(operator, "extended", 12, 75)
    reversal = next(
        row
        for row in detail(operator, company)["transitions"]
        if row["transition_id"] == exception["reversion_transition_id"]
    )
    assert reversal["retention_preview"]["request_count"] == "1"
    assert ack(client, reversal).status_code == 200
    rejected = assign(operator, company, "extended", now[0])
    assert rejected.status_code == 409 and rejected.json()["error"]["code"] == "entitlement_conflict"
    cannot_cancel, _ = cancel(operator, company, reversal["transition_id"])
    assert (
        cannot_cancel.status_code == 409
        and cannot_cancel.json()["error"]["code"] == "exception_reversion_required"
    )
    response, body = replace_exception(operator, company, exception["exception_id"], "extended")
    assert response.status_code == 200 and response.json()["status"] == "assigned", response.text
    retry = operator.post(
        f"/v1/operator/organizations/{company.id}/exceptions/{exception['exception_id']}/replace",
        json=operator_confirmed(operator, body),
    )
    assert retry.json() == response.json()
    current = detail(operator, company)
    assert current["capacity"] == 75 and current["retention_months"] == 12
    assert (
        next(row for row in current["transitions"] if row["transition_id"] == reversal["transition_id"])[
            "status"
        ]
        == "superseded"
    )
    now[0] += timedelta(days=2)
    for _ in range(4):
        run(app.state.service)
    login(app, client)
    assert client.get("/v1/me/summary?period=all").json()["request_count"] == "1"
    assert client.get("/v1/admin/plan").json()["usage_retention_months"] == 12


def test_out_of_order_future_assignments_require_cancel_and_old_ack_never_reactivates_them(setup):
    app, client, company, _, now, settings = setup
    now[0] = datetime(2026, 5, 10, 12, tzinfo=timezone.utc)
    login(app, client)
    credentials, _ = connect(app, client)
    upload(client, credentials, list(observations(now[0])))
    now[0] = datetime(2026, 9, 10, 12, tzinfo=timezone.utc)
    login(app, client)
    operator = operator_client(app, settings)
    plan(operator, "older-short", 3)
    plan(operator, "newer-long", 12)
    first = assign(operator, company, "older-short", now[0] + timedelta(days=14))
    assert first.status_code == 200
    old_id = first.json()["transition_id"]
    original = next(row for row in detail(operator, company)["transitions"] if row["transition_id"] == old_id)
    assert original["retention_preview"]["request_count"] == "1"
    assert ack(client, original).status_code == 200
    second = assign(operator, company, "newer-long", now[0] + timedelta(days=7))
    assert second.status_code == 409 and second.json()["error"]["code"] == "entitlement_conflict"
    cancelled, body = cancel(operator, company, old_id)
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "cancelled"
    assert (
        operator.post(
            f"/v1/operator/organizations/{company.id}/transitions/{old_id}/cancel",
            json=operator_confirmed(operator, body),
        ).json()
        == cancelled.json()
    )
    assert ack(client, cancelled.json()).status_code == 409
    second = assign(operator, company, "newer-long", now[0] + timedelta(days=7))
    assert second.status_code == 200, second.text
    new_id = second.json()["transition_id"]
    transition = next(
        row for row in detail(operator, company)["transitions"] if row["transition_id"] == new_id
    )
    assert ack(client, transition).status_code == 200
    generation = detail(operator, company)["entitlement_generation"]
    for status in ["suspended", "active"]:
        current = detail(operator, company)
        changed = operator.put(
            f"/v1/operator/organizations/{company.id}/status",
            json=operator_confirmed(
                operator,
                {
                    "expected_version": current["version"],
                    "status": status,
                    "reason": "Unrelated service status review",
                    "idempotency_key": str(uuid4()),
                },
            ),
        )
        assert changed.status_code == 200
    assert detail(operator, company)["entitlement_generation"] == generation
    now[0] += timedelta(days=8)
    for _ in range(3):
        run(app.state.service)
    login(app, client)
    assert client.get("/v1/admin/plan").json()["plan_id"] == "newer-long"
    now[0] += timedelta(days=7)
    for _ in range(3):
        run(app.state.service)
    login(app, client)
    assert client.get("/v1/admin/plan").json()["usage_retention_months"] == 12
    assert client.get("/v1/me/summary?period=all").json()["request_count"] == "1"


def test_net_shortening_replacement_holds_current_values_and_cancel_restores_unacknowledged_exception(setup):
    app, client, company, _, now, settings = setup
    login(app, client)
    operator = operator_client(app, settings)
    plan(operator, "shorter", 3)
    plan(operator, "equal", 12)
    exception = grant(operator, company, now[0], now[0] + timedelta(days=2))
    response, _ = replace_exception(operator, company, exception["exception_id"], "shorter")
    assert response.status_code == 200 and response.json()["status"] == "retention_transition_pending"
    replacement = response.json()["transition_id"]
    for _ in range(3):
        run(app.state.service)
    assert detail(operator, company)["retention_months"] == 12
    assert assign(operator, company, "equal", now[0]).status_code == 409
    cancelled, _ = cancel(operator, company, replacement)
    assert (
        cancelled.status_code == 200
        and cancelled.json()["restored_reversion_id"] == exception["reversion_transition_id"]
    )
    current = detail(operator, company)
    reversal = next(
        row for row in current["transitions"] if row["transition_id"] == exception["reversion_transition_id"]
    )
    assert reversal["acknowledged"] is False and reversal["status"] == "pending"
    assert (
        next(row for row in current["exceptions"] if row["exception_id"] == exception["exception_id"])[
            "status"
        ]
        == "active"
    )
    response, _ = replace_exception(operator, company, exception["exception_id"], "equal")
    assert response.status_code == 200 and response.json()["status"] == "assigned"
    now[0] += timedelta(days=3)
    for _ in range(3):
        run(app.state.service)
    login(app, client)
    assert client.get("/v1/admin/plan").json()["usage_retention_months"] == 12


def test_unverified_legacy_transition_is_blocked_until_operator_review_and_fresh_admin_ack(setup):
    app, client, company, _, now, settings = setup
    login(app, client)
    operator = operator_client(app, settings)
    plan(operator, "reviewed", 3)
    created = assign(operator, company, "reviewed", now[0])
    identifier = created.json()["transition_id"]
    original = next(
        row for row in detail(operator, company)["transitions"] if row["transition_id"] == identifier
    )
    assert ack(client, original).status_code == 200
    with app.state.db.transaction() as session:
        legacy = get(session, "transition", identifier, company.id)
        legacy.data = {
            key: value
            for key, value in legacy.data.items()
            if key not in {"base_generation", "base_entitlement"}
        }
    run(app.state.service)
    current = detail(operator, company)
    blocked = next(row for row in current["transitions"] if row["transition_id"] == identifier)
    assert blocked["status"] == "review_required" and blocked["acknowledged"] is False
    assert current["retention_months"] == 6
    assert ack(client, blocked).status_code == 409
    reviewed = operator.post(
        f"/v1/operator/organizations/{company.id}/transitions/{identifier}/review",
        json=operator_confirmed(
            operator,
            {
                "expected_version": blocked["version"],
                "expected_company_version": current["version"],
                "confirmed": True,
                "reason": "Revalidated current effective entitlement and resulting retention preview",
                "idempotency_key": str(uuid4()),
            },
        ),
    )
    assert reviewed.status_code == 200 and reviewed.json()["acknowledged"] is False, reviewed.text
    assert ack(client, reviewed.json()).status_code == 200
    run(app.state.service)
    assert client.get("/v1/admin/plan").json()["usage_retention_months"] == 3


def test_shorter_atomic_replacement_requires_its_own_ack_and_terminal_changes_cannot_be_replayed(setup):
    app, client, company, _, now, settings = setup
    login(app, client)
    operator = operator_client(app, settings)
    plan(operator, "short-replacement", 3)
    exception = grant(operator, company, now[0], now[0] + timedelta(days=2))
    original = next(
        row
        for row in detail(operator, company)["transitions"]
        if row["transition_id"] == exception["reversion_transition_id"]
    )
    assert ack(client, original).status_code == 200
    response, body = replace_exception(operator, company, exception["exception_id"], "short-replacement")
    assert response.status_code == 200 and response.json()["status"] == "retention_transition_pending"
    identifier = response.json()["transition_id"]
    pending = next(
        row for row in detail(operator, company)["transitions"] if row["transition_id"] == identifier
    )
    assert not pending["acknowledged"] and pending["retention_shortened"]
    assert pending["current_entitlement"]["retention_months"] == 12
    assert pending["target_entitlement"]["retention_months"] == 3
    assert pending["target_entitlement"]["plan_id"] == "short-replacement"
    run(app.state.service)
    assert detail(operator, company)["retention_months"] == 12
    assert ack(client, pending).status_code == 200
    run(app.state.service)
    assert detail(operator, company)["retention_months"] == 3
    cannot_cancel, _ = cancel(operator, company, identifier)
    assert cannot_cancel.status_code == 409 and cannot_cancel.json()["error"]["code"] == "transition_terminal"
    forged = {**body, "idempotency_key": str(uuid4()), "effective_at": instant(now[0] + timedelta(days=5))}
    assert (
        operator.post(
            f"/v1/operator/organizations/{company.id}/exceptions/{exception['exception_id']}/replace",
            json=operator_confirmed(operator, forged),
        ).status_code
        == 422
    )
    now[0] += timedelta(days=3)
    for _ in range(3):
        run(app.state.service)
    login(app, client)
    assert client.get("/v1/admin/plan").json()["usage_retention_months"] == 3


def test_cancellation_racing_due_worker_never_reports_cancelled_then_applies(setup):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    app, client, company, _, now, settings = setup
    login(app, client)
    operator = operator_client(app, settings)
    plan(operator, "raced-short", 3)
    created = assign(operator, company, "raced-short", now[0])
    identifier = created.json()["transition_id"]
    transition = next(
        row for row in detail(operator, company)["transitions"] if row["transition_id"] == identifier
    )
    assert ack(client, transition).status_code == 200
    current = detail(operator, company)
    transition = next(row for row in current["transitions"] if row["transition_id"] == identifier)
    body = {
        "expected_version": transition["version"],
        "expected_company_version": current["version"],
        "confirmed": True,
        "reason": "Review cancellation while the due worker may be active",
        "idempotency_key": str(uuid4()),
    }
    barrier = Barrier(2)

    def cancel_now():
        barrier.wait()
        return operator.post(
            f"/v1/operator/organizations/{company.id}/transitions/{identifier}/cancel",
            json=operator_confirmed(operator, body),
        )

    def work_now():
        barrier.wait()
        run(app.state.service)

    with ThreadPoolExecutor(2) as pool:
        future = pool.submit(cancel_now)
        worker = pool.submit(work_now)
        response = future.result()
        worker.result()
    assert response.status_code in {200, 409}, response.text
    for _ in range(3):
        run(app.state.service)
    current = detail(operator, company)
    state = next(row for row in current["transitions"] if row["transition_id"] == identifier)["status"]
    if response.status_code == 200:
        assert state == "cancelled" and current["retention_months"] == 6
    else:
        assert state == "applied" and current["retention_months"] == 3


def test_exception_revocation_is_audited_and_cannot_skip_shortening_acknowledgement(setup):
    app, client, company, _, now, settings = setup
    login(app, client)
    operator = operator_client(app, settings)
    exception = grant(operator, company, now[0], now[0] + timedelta(days=1))
    path = f"/v1/operator/organizations/{company.id}/exceptions/{exception['exception_id']}"
    body = {
        "expected_version": exception["version"],
        "reason": "End the temporary exception after reviewing the original plan",
        "idempotency_key": str(uuid4()),
        "transition_acknowledgement": None,
    }
    assert (
        operator.request(
            "DELETE", path, json=operator_confirmed(operator, {**body, "reason": "   "})
        ).status_code
        == 422
    )
    assert operator.request("DELETE", path, json=operator_confirmed(operator, body)).status_code == 409
    reversal = next(
        row
        for row in detail(operator, company)["transitions"]
        if row["transition_id"] == exception["reversion_transition_id"]
    )
    assert ack(client, reversal).status_code == 200
    body["transition_acknowledgement"] = reversal["transition_id"]
    response = operator.request("DELETE", path, json=operator_confirmed(operator, body))
    assert response.status_code == 200 and response.json()["status"] == "revocation_scheduled", response.text
    run(app.state.service)
    current = detail(operator, company)
    assert current["retention_months"] == 6
    assert (
        next(row for row in current["exceptions"] if row["exception_id"] == exception["exception_id"])[
            "status"
        ]
        == "revoked"
    )
    events = operator.get("/v1/operator/audit").json()["items"]
    event = next(row for row in events if row["action"] == "exception_revocation_scheduled")
    assert event["details"]["reason"] == body["reason"] and event["actor_kind"] == "operator"


def test_backdated_assignment_cannot_understate_the_current_shortening_preview(setup):
    app, client, company, _, now, settings = setup
    now[0] = datetime(2026, 5, 10, 12, tzinfo=timezone.utc)
    login(app, client)
    credentials, _ = connect(app, client)
    assert upload(client, credentials, list(observations(now[0]))).status_code == 200
    now[0] = datetime(2026, 9, 10, 12, tzinfo=timezone.utc)
    operator = operator_client(app, settings)
    plan(operator, "backdated-short", 3)
    response = assign(operator, company, "backdated-short", datetime(2026, 1, 1, 12, tzinfo=timezone.utc))
    assert response.status_code == 200
    transition = next(
        row
        for row in detail(operator, company)["transitions"]
        if row["transition_id"] == response.json()["transition_id"]
    )
    assert transition["effective_at"] == instant(now[0])
    assert transition["retention_preview"]["request_count"] == "1" and not transition["acknowledged"]


def test_capacity_only_exception_expires_at_boundary_without_admin_acknowledgement(setup):
    app, client, company, _, now, settings = setup
    login(app, client)
    operator = operator_client(app, settings)
    expires = now[0] + timedelta(seconds=10)
    granted = operator.post(
        f"/v1/operator/organizations/{company.id}/exceptions",
        json=operator_confirmed(
            operator,
            {
                "expected_version": detail(operator, company)["version"],
                "member_capacity": 100,
                "retention_months": 6,
                "effective_at": instant(now[0]),
                "expires_at": instant(expires),
                "reason": "Temporary capacity increase with unchanged retention",
                "idempotency_key": str(uuid4()),
            },
        ),
    )
    assert granted.status_code == 200, granted.text
    identifier = granted.json()["reversion_transition_id"]
    pending = next(
        row for row in detail(operator, company)["transitions"] if row["transition_id"] == identifier
    )
    assert pending["acknowledgement_required"] is False and pending["acknowledged"] is False
    now[0] = expires - timedelta(milliseconds=1)
    run(app.state.service)
    assert detail(operator, company)["capacity"] == 100
    now[0] = expires
    run(app.state.service)
    current = detail(operator, company)
    assert current["capacity"] == 50 and current["retention_months"] == 6
    applied = next(row for row in current["transitions"] if row["transition_id"] == identifier)
    assert applied["status"] == "applied" and applied["acknowledged"] is False
    assert current["exceptions"][0]["status"] == "expired"


def test_future_upgrade_applies_when_due_without_admin_acknowledgement(setup):
    app, client, company, _, now, settings = setup
    login(app, client)
    operator = operator_client(app, settings)
    plan(operator, "automatic-upgrade", 12, 75)
    effective = now[0] + timedelta(seconds=30)
    created = assign(operator, company, "automatic-upgrade", effective)
    assert created.status_code == 200
    identifier = created.json()["transition_id"]
    pending = next(
        row for row in detail(operator, company)["transitions"] if row["transition_id"] == identifier
    )
    assert not pending["acknowledgement_required"] and not pending["acknowledged"]
    now[0] = effective - timedelta(milliseconds=1)
    run(app.state.service)
    assert detail(operator, company)["retention_months"] == 6
    now[0] = effective
    run(app.state.service)
    current = detail(operator, company)
    assert current["retention_months"] == 12 and current["capacity"] == 75
    assert (
        next(row for row in current["transitions"] if row["transition_id"] == identifier)["acknowledged"]
        is False
    )
    assert operator.get("/v1/operator/health").json()["retention_transitions_requiring_action"] == 0


def test_unverified_nonshortening_transition_still_requires_operator_review(setup):
    app, client, company, _, now, settings = setup
    login(app, client)
    operator = operator_client(app, settings)
    plan(operator, "unverified-upgrade", 12)
    created = assign(operator, company, "unverified-upgrade", now[0] + timedelta(seconds=10))
    identifier = created.json()["transition_id"]
    with app.state.db.transaction() as session:
        legacy = get(session, "transition", identifier, company.id)
        legacy.data = {
            key: value
            for key, value in legacy.data.items()
            if key not in {"base_generation", "base_entitlement"}
        }
    now[0] += timedelta(seconds=11)
    run(app.state.service)
    current = detail(operator, company)
    transition = next(row for row in current["transitions"] if row["transition_id"] == identifier)
    assert current["retention_months"] == 6 and transition["status"] == "review_required"
    assert not transition["acknowledgement_required"]
    reviewed = operator.post(
        f"/v1/operator/organizations/{company.id}/transitions/{identifier}/review",
        json=operator_confirmed(
            operator,
            {
                "expected_version": transition["version"],
                "expected_company_version": current["version"],
                "confirmed": True,
                "reason": "Review the verified current policy before automatic upgrade",
                "idempotency_key": str(uuid4()),
            },
        ),
    )
    assert reviewed.status_code == 200 and not reviewed.json()["acknowledgement_required"]
    run(app.state.service)
    assert detail(operator, company)["retention_months"] == 12


@pytest.mark.parametrize("target_months,current_months,requires_ack", [(12, 18, True), (3, 1, False)])
def test_review_recomputes_net_shortening_and_ack_requirement_from_current_policy(
    setup, target_months, current_months, requires_ack
):
    app, client, company, _, now, settings = setup
    login(app, client)
    operator = operator_client(app, settings)
    plan(operator, "review-target", target_months)
    plan(operator, "legacy-current", current_months)
    created = assign(operator, company, "review-target", now[0] + timedelta(seconds=10))
    identifier = created.json()["transition_id"]
    # Model a restored pre-guard deployment where another assignment changed the effective
    # entitlement while this transition remained queued. The new worker must not apply it.
    with app.state.db.transaction() as session:
        current = get(session, "company", company.id)
        current.data = {
            **current.data,
            "plan_id": "legacy-current",
            "plan_version": 1,
            "capacity": 75,
            "retention_months": current_months,
        }
        app.state.service.advance_entitlement(current)
    now[0] += timedelta(seconds=11)
    run(app.state.service)
    current = detail(operator, company)
    transition = next(row for row in current["transitions"] if row["transition_id"] == identifier)
    assert transition["status"] == "review_required" and current["retention_months"] == current_months
    reviewed = operator.post(
        f"/v1/operator/organizations/{company.id}/transitions/{identifier}/review",
        json=operator_confirmed(
            operator,
            {
                "expected_version": transition["version"],
                "expected_company_version": current["version"],
                "confirmed": True,
                "reason": "Recompute the reviewed policy change against the restored current plan",
                "idempotency_key": str(uuid4()),
            },
        ),
    )
    assert reviewed.status_code == 200, reviewed.text
    assert (
        reviewed.json()["acknowledgement_required"] is requires_ack
        and reviewed.json()["acknowledged"] is False
    )
    run(app.state.service)
    if requires_ack:
        assert detail(operator, company)["retention_months"] == current_months
        assert ack(client, reviewed.json()).status_code == 200
        run(app.state.service)
    current = detail(operator, company)
    assert current["retention_months"] == target_months
    applied = next(row for row in current["transitions"] if row["transition_id"] == identifier)
    assert applied["status"] == "applied" and applied["acknowledged"] is requires_ack


def test_cancel_reviewed_replacement_restores_effective_exception_before_recomputing_reversion(setup):
    app, client, company, _, now, settings = setup
    login(app, client)
    operator = operator_client(app, settings)
    plan(operator, "cancel-review-target", 3)
    plan(operator, "legacy-lower", 1)
    exception = grant(operator, company, now[0], now[0] + timedelta(seconds=10))
    replacement, _ = replace_exception(operator, company, exception["exception_id"], "cancel-review-target")
    identifier = replacement.json()["transition_id"]
    with app.state.db.transaction() as session:
        current = get(session, "company", company.id)
        current.data = {
            **current.data,
            "plan_id": "legacy-lower",
            "plan_version": 1,
            "capacity": 75,
            "retention_months": 1,
        }
        app.state.service.advance_entitlement(current)
    run(app.state.service)
    current = detail(operator, company)
    transition = next(row for row in current["transitions"] if row["transition_id"] == identifier)
    reviewed = operator.post(
        f"/v1/operator/organizations/{company.id}/transitions/{identifier}/review",
        json=operator_confirmed(
            operator,
            {
                "expected_version": transition["version"],
                "expected_company_version": current["version"],
                "confirmed": True,
                "reason": "Review legacy policy before choosing to restore the prior exception",
                "idempotency_key": str(uuid4()),
            },
        ),
    )
    assert reviewed.status_code == 200 and reviewed.json()["acknowledgement_required"] is False
    cancelled, _ = cancel(operator, company, identifier)
    assert cancelled.status_code == 200
    current = detail(operator, company)
    assert current["retention_months"] == 12 and current["capacity"] == 100
    reversal = next(
        row for row in current["transitions"] if row["transition_id"] == exception["reversion_transition_id"]
    )
    assert reversal["acknowledgement_required"] is True and reversal["acknowledged"] is False
    now[0] += timedelta(seconds=11)
    run(app.state.service)
    assert detail(operator, company)["retention_months"] == 12
