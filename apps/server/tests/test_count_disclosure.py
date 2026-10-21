"""
Members see the organization's totals whatever the group size while sharing is on (owner decision of
13 October 2026). Turning sharing off is the only way to hide them from members.
"""

from copy import deepcopy
from datetime import timedelta
from uuid import uuid4

import pytest
from conftest import confirmed, connect, login, member_login
from fastapi.testclient import TestClient
from test_analytics import observations, upload
from test_method_history import install_bundle
from test_summary_splits import organization

from aift.db import get
from aift.maintenance import run

SHARED_COUNTS = (
    "request_count",
    "attempt_count",
    "unconfirmed_attempt_count",
    "unresolved_request_count",
    "pending_estimates",
    "observed_search_operations",
    "outcomes",
    "active_users",
    "active_installations",
)


def seed(setup, category, everyone=False):
    app, admin, company, _, now, _ = setup
    login(app, admin)
    employees = []
    for index in range(5):
        employee = TestClient(app, base_url=company.origin)
        employee.headers["Origin"] = company.origin
        member_login(app, employee, f"person{index}@example.org")
        credentials, _ = connect(app, employee)
        request, attempt = observations(now[0])
        attempt["provider_attempt_key"] = str(index) * 64
        selected = everyone or index == 0
        if category.startswith("outcome:") and selected:
            request["state"] = category.split(":")[1]
            attempt["state"] = request["state"]
        if category == "search":
            request["observed_search_operations"] = "3" if selected else "0"
        result = upload(employee, credentials, [request, attempt])
        assert all(row["status"] == "applied" for row in result.json()["results"]), result.text
        if selected and category in {"unconfirmed", "pending", "reason_complement"}:
            extra = deepcopy(attempt)
            extra["attempt_id"] = str(uuid4())
            extra["provider_attempt_key"] = None
            if category == "unconfirmed":
                extra["execution_evidence"] = "none"
                extra["state"] = "dispatch_only"
            elif category == "pending":
                extra["proposed_method_id"] = "unknown-reference-v99"
            else:
                extra["tokens"]["answer_output"]["reason"] = None
            accepted = upload(employee, credentials, [extra])
            assert accepted.json()["results"][0]["status"] in {"applied", "stored_pending_estimate"}, (
                accepted.text
            )
        if selected and category == "unresolved":
            ambiguous, duplicate = observations(now[0])
            duplicate["provider_attempt_key"] = attempt["provider_attempt_key"]
            result = upload(employee, credentials, [ambiguous, duplicate])
            assert [row["status"] for row in result.json()["results"]] == ["applied", "conflict"], result.text
            assert result.json()["results"][1]["error_code"] == "request_identity_ambiguous"
        employees.append((employee, credentials))
    return app, admin, company, now, employees


def assert_shared(response, administrative):
    """The member's organization summary carries the same figures the administrators see."""
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["suppressed"] is False and result["aggregate_status"] == "current", result
    for field in SHARED_COUNTS:
        assert result[field] == administrative[field], field
    for field in ("coverage", "tokens", "resources", "media_counts", "image_references"):
        assert field in result
    return result


@pytest.mark.parametrize(
    "category",
    [
        "outcome:cancelled",
        "outcome:failed",
        "unconfirmed",
        "pending",
        "unresolved",
        "search",
        "reason_complement",
    ],
)
def test_one_persons_count_subgroup_is_shared_in_original_and_recalculated_views(setup, category):
    app, admin, company, now, employees = seed(setup, category)
    employee, credentials = employees[-1]
    administrative = admin.get("/v1/admin/summary").json()
    shared = assert_shared(employee.get("/v1/company/summary"), administrative)
    assert shared["request_count"] == "5"
    if category.startswith("outcome:"):
        assert shared["outcomes"][category.split(":")[1]] == "1"
    elif category == "pending":
        assert shared["pending_estimates"] == shared["coverage"]["resource_unknown_count"] == "1"
    elif category in {"unconfirmed", "unresolved"}:
        field = "unconfirmed_attempt_count" if category == "unconfirmed" else "unresolved_request_count"
        assert shared[field] == "1"
    elif category == "search":
        assert shared["observed_search_operations"] == "3"
    else:
        output = next(row for row in shared["tokens"] if row["quantity"] == "answer_output")
        assert (
            output["applicable_count"] == 6 and output["reason_counts"]["tokenizer_mapping_unverified"] == 5
        )
    # The record-level summary behind the recalculated view shares the same figures.
    with app.state.db.transaction(readonly=True) as session:
        tenant = get(session, "company", company.id)
        member = get(session, "member", credentials["user_id"], company.id)
        canonical = app.state.service.analytics._canonical_summary(session, tenant, member, {}, private=True)
        assert canonical["suppressed"] is False and canonical["request_count"] == "5", canonical
    run(app.state.service)
    bundle = install_bundle(app, now[0])
    created = admin.post(
        "/v1/admin/recalculations", json={"method_id": bundle["method_id"], "operation_id": str(uuid4())}
    )
    assert created.status_code == 200, created.text
    for _ in range(3):
        run(app.state.service)
    options = {"calculation_view": "recalculated", "method_id": bundle["method_id"]}
    recalculated = employee.get("/v1/company/summary", params=options)
    if category == "pending":
        # Recalculation requires the unavailable original method's provenance. Until it is
        # installed, readiness blocks both roles and exposes no count payload.
        assert (
            recalculated.status_code == 409
            and recalculated.json()["error"]["code"] == "recalculation_pending"
        )
        assert admin.get("/v1/admin/summary", params=options).status_code == 409
        return
    recalculated_admin = admin.get("/v1/admin/summary", params=options)
    assert recalculated_admin.status_code == 200, recalculated_admin.text
    assert_shared(recalculated, recalculated_admin.json())


@pytest.mark.parametrize(
    "category", ["outcome:cancelled", "unconfirmed", "pending", "unresolved", "search", "reason_complement"]
)
def test_five_distinct_contributors_release_all_normative_count_fields(setup, category):
    _, _, _, _, employees = seed(setup, category, everyone=True)
    result = employees[-1][0].get("/v1/company/summary")
    assert result.status_code == 200 and result.json()["suppressed"] is False, result.text
    for field in (
        "request_count",
        "outcomes",
        "unconfirmed_attempt_count",
        "unresolved_request_count",
        "pending_estimates",
        "coverage",
        "active_users",
        "active_installations",
    ):
        assert field in result.json()


def test_days_with_one_contributor_per_count_are_shared(setup):
    app, _, company, now, employees = seed(setup, "baseline")
    # On each of five days a different single person cancels a request.
    for day in range(5):
        now[0] += timedelta(days=1)
        for index, (employee, credentials) in enumerate(employees):
            request, attempt = observations(now[0])
            if index == day:
                request["state"] = attempt["state"] = "cancelled"
            refreshed = employee.post(
                "/v1/auth/refresh",
                json={"refresh_token": credentials["refresh_token"], "operation_id": str(uuid4())},
            )
            assert refreshed.status_code == 200
            credentials.update(refreshed.json())
            result = upload(employee, credentials, [request, attempt])
            assert all(row["status"] == "applied" for row in result.json()["results"]), result.text
    employee, credentials = employees[-1]
    member_login(app, employee, "person4@example.org")
    result = employee.get("/v1/company/summary", params={"period": "all"}).json()
    assert result["suppressed"] is False and result["outcomes"]["cancelled"] == "5", result
    with app.state.db.transaction(readonly=True) as session:
        canonical = app.state.service.analytics._canonical_summary(
            session,
            get(session, "company", company.id),
            get(session, "member", credentials["user_id"], company.id),
            {"period": "all"},
            private=True,
        )
        assert canonical["suppressed"] is False and canonical["outcomes"]["cancelled"] == "5"


def test_one_persons_usage_appears_in_the_member_company_summary(setup):
    _, people = organization(setup, ["chatgpt-gpt-5-6-sol"])
    result = people[0].get("/v1/company/summary")
    assert result.status_code == 200, result.text
    whole = result.json()
    assert whole["aggregate_status"] == "current" and whole["suppressed"] is False, whole
    assert whole["request_count"] == "1" and whole["active_users"] == "1"
    assert "safe_message" not in whole
    # The charts' splits show the one person's day, tool and model as well.
    assert whole["sites"]["chatgpt"]["request_count"] == "1"
    assert [day["request_count"] for day in whole["days"].values()] == ["1"]
    assert whole["models"]["chatgpt-gpt-5-6-sol"]["request_count"] == "1"
    assert whole["history"]["status"] in {"empty", "available"}


def test_turning_sharing_off_still_hides_organization_totals_from_members(setup):
    app, admin, *_ = setup
    _, people = organization(setup, ["chatgpt-gpt-5-6-sol"])
    login(app, admin)
    policy = admin.get("/v1/config").json()
    changed = admin.put(
        "/v1/admin/policy",
        json=confirmed(
            admin,
            {
                **{k: policy[k] for k in ("timezone", "pause_mode")},
                "company_sharing": "disabled",
                "expected_version": policy["policy_version"],
            },
        ),
    )
    assert changed.status_code == 200, changed.text
    hidden = people[0].get("/v1/company/summary").json()
    assert hidden["aggregate_status"] == "policy_disabled" and hidden["suppressed"] is True, hidden
    for field in (
        "request_count",
        "active_users",
        "tokens",
        "resources",
        "sites",
        "days",
        "models",
        "history",
    ):
        assert field not in hidden
    # Administrators keep their own view of the organization.
    assert admin.get("/v1/admin/summary").json()["request_count"] == "1"


def test_a_range_without_usage_is_a_current_summary_of_zeros(setup):
    app, _, company, *_ = setup
    member = TestClient(app, base_url=company.origin)
    member.headers["Origin"] = company.origin
    member_login(app, member, "nobody@example.org")
    connect(app, member)
    result = member.get("/v1/company/summary")
    assert result.status_code == 200, result.text
    empty = result.json()
    assert empty["aggregate_status"] == "current" and empty["suppressed"] is False, empty
    assert empty["request_count"] == empty["attempt_count"] == empty["active_users"] == "0"
    assert empty["tokens"] == [] and empty["resources"] == []
    # Unused tools and days are left out of the charts rather than shown as rows of zeros.
    assert empty["sites"] == {} and empty.get("days", {}) == {} and "models" not in empty


def test_operator_audit_uses_distinct_authenticated_pseudonyms_and_rejects_body_authority(setup):
    from dataclasses import replace

    from sqlalchemy import select

    from aift.db import TABLES
    from aift.main import create_app

    original, _, _, _, now, settings = setup
    original.state.db.engine.dispose()
    emails = ("operator@example.org", "second.operator@example.org")
    app = create_app(replace(settings, operator_emails=emails), clock=lambda: now[0])
    actors = []
    for index, email in enumerate(emails):
        operator = TestClient(app, base_url=settings.operator_origin)
        operator.headers["Origin"] = settings.operator_origin
        login(app, operator, email, operator=True)
        body = {
            "plan_id": f"actor-test-{index}",
            "version": 1,
            "member_capacity": 50,
            "retention_months": 6,
            "idempotency_key": str(uuid4()),
        }
        denied = operator.post("/v1/operator/plans", json={**body, "actor": "attacker-chosen-author"})
        assert denied.status_code == 422
        created = operator.post("/v1/operator/plans", json=body)
        assert created.status_code == 200, created.text
        cookie = operator.cookies.get("__Host-aift-operator")
        from aift.security import digest

        with app.state.db.transaction(readonly=True) as session:
            actors.append(get(session, "session", digest(cookie)).owner)
        audit = operator.get("/v1/operator/audit").json()
        row = next(item for item in audit["items"] if item["target"] == f"actor-test-{index}:1")
        assert row["actor"] == actors[-1] and row["actor_kind"] == "operator"
        assert not any(email in str(audit) for email in emails)
        assert "attacker-chosen-author" not in str(audit)
    assert actors[0] != actors[1]
    with app.state.db.transaction(readonly=True) as session:
        rows = list(
            session.scalars(
                select(TABLES["audit"]).where(TABLES["audit"].data["action"].as_string() == "plan_created")
            )
        )
        assert {row.data["actor"] for row in rows} == set(actors)
