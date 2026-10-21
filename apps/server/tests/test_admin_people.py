"""The administrators' People summary and the admin summary's splits for the redesigned admin site."""

from uuid import uuid4

from conftest import PERSON_ANALYTICS
from test_summary_splits import organization


@PERSON_ANALYTICS
def test_people_summary_counts_requests_per_person_with_the_spread_and_median(setup):
    app, admin, *_ = setup
    _, people = organization(setup, ["chatgpt-gpt-5-6-sol"] * 3)
    result = admin.get("/v1/admin/people")
    assert result.status_code == 200, result.text
    body = result.json()
    assert body["used"] == 3
    assert sorted(body["requests"].values()) == ["1", "1", "1"]
    assert body["median_requests"] == "1"
    # Each of the three sent one request, so all sit in the first bin.
    assert [b["people"] for b in body["bins"]] == [3, 0, 0, 0, 0, 0]
    assert [(b["from"], b["to"]) for b in body["bins"]][-1] == (1000, None)
    # The admin and the three people are members; only the admin is an administrator.
    assert body["members"] == 4 and body["administrators"] == 1
    assert body["capacity"] >= body["members"]
    assert admin.get("/v1/admin/people", params={"site": "chatgpt"}).status_code == 422
    # A member cannot read it.
    assert people[0].get("/v1/admin/people").status_code in {401, 403, 404}


@PERSON_ANALYTICS
def test_admin_summary_carries_splits_for_a_small_group(setup):
    _, admin, *_ = setup
    organization(setup, ["chatgpt-gpt-5-6-sol"] * 2 + ["chatgpt-gpt-5-6-luna"])
    whole = admin.get("/v1/admin/summary").json()
    assert whole["request_count"] == "3"
    assert set(whole["sites"]) == {"chatgpt"} and whole["sites"]["chatgpt"]["request_count"] == "3"
    assert len(whole["days"]) == 1 and next(iter(whole["days"].values()))["request_count"] == "3"
    assert {k: v["request_count"] for k, v in whole["models"].items()} == {
        "chatgpt-gpt-5-6-sol": "2",
        "chatgpt-gpt-5-6-luna": "1",
    }
    # One person's summary splits only that person's figures.
    people = admin.get("/v1/admin/people").json()["requests"]
    person = next(owner for owner, count in people.items() if count == "1")
    single = admin.get("/v1/admin/summary", params={"user_id": person}).json()
    assert single["request_count"] == "1"
    assert single["sites"]["chatgpt"]["request_count"] == "1"
    assert sum(int(v["request_count"]) for v in single["models"].values()) == 1
    assert sum(int(v["request_count"]) for v in single["days"].values()) == 1
    assert single["history"]["status"] in {"empty", "available"}


def test_session_names_the_signed_in_work_email(setup):
    app, admin, *_ = setup
    from conftest import login

    login(app, admin)
    session = admin.get("/v1/auth/session").json()
    assert session["email"] == "admin@example.org"
    assert session["role"] == "admin"


@PERSON_ANALYTICS
def test_request_rows_carry_the_tokens_and_electricity_details_adds_up(setup):
    _, admin, *_ = setup
    organization(setup, ["chatgpt-gpt-5-6-sol"] * 2)
    rows = admin.get("/v1/admin/requests").json()["items"]
    assert len(rows) == 2
    for row in rows:
        detail = admin.get(row["detail_path"]).json()
        own = [a for a in detail["attempts"] if a["contribution"] == "originating"]

        def side(fields):
            values = [
                a["tokens"][f]["value"]
                for a in own
                for f in fields
                if a["tokens"].get(f, {}).get("value") is not None
            ]
            return str(sum(int(v) for v in values)) if values else None

        figures = row["figures"]
        assert figures["tokens_in"] == side(("new_input_text", "tool_output", "image_input_tokens"))
        assert figures["tokens_out"] == side(("output_total", "other_model_output"))
        energy = [a["estimate"].get("result", {}).get("metrics", {}).get("energy") for a in own]
        if figures["energy_status"] == "available":
            from decimal import Decimal

            assert Decimal(figures["energy"]["value"]) == sum(Decimal(m["value"]) for m in energy)
        else:
            assert figures["energy"] is None


def test_administrators_can_keep_usage_for_a_shorter_period_but_not_beyond_the_plan(setup):
    app, admin, company, *_ = setup
    from conftest import confirmed, login

    from aift.db import get as get_row

    login(app, admin)
    policy = admin.get("/v1/config").json()
    base = {k: policy[k] for k in ("timezone", "pause_mode", "company_sharing")}
    # The test plan keeps usage for 6 months.
    assert policy["usage_retention_months"] == 6

    def put_policy(version, choice=None):
        body = {**base, "expected_version": version, **({"usage_retention": choice} if choice else {})}
        return admin.put("/v1/admin/policy", json=confirmed(admin, body))

    for longer in ("until_deleted", "12", "24"):
        refused = put_policy(policy["policy_version"], longer)
        assert refused.status_code == 422 and refused.json()["error"]["code"] == "retention_above_plan"
    shorter = put_policy(policy["policy_version"], "3")
    assert shorter.status_code == 200, shorter.text
    assert shorter.json()["usage_retention_months"] == 3
    # The plan stays as assigned; only the kept period is shorter, and the cutoff follows it.
    assert admin.get("/v1/admin/plan").json()["usage_retention_months"] == 6
    assert admin.get("/v1/admin/summary").json()["retention_cutoff"].startswith("2026-06-")
    # Leaving the choice out keeps it.
    kept = put_policy(shorter.json()["policy_version"])
    assert kept.status_code == 200 and kept.json()["usage_retention_months"] == 3
    # Without a plan limit, usage can be kept until an administrator deletes it.
    with app.state.db.transaction() as s:
        row = get_row(s, "company", company.id)
        row.data = {**row.data, "retention_months": None}
    assert admin.get("/v1/config").json()["usage_retention_months"] == 3
    until = put_policy(kept.json()["policy_version"], "until_deleted")
    assert until.status_code == 200 and until.json()["usage_retention_months"] is None


@PERSON_ANALYTICS
def test_health_lists_each_connected_browser_with_its_last_upload(setup):
    _, admin, *_ = setup
    organization(setup, ["chatgpt-gpt-5-6-sol"] * 2)
    body = admin.get("/v1/admin/health").json()
    assert "items" in body
    assert len(body["browsers"]) == 2
    for browser in body["browsers"]:
        assert browser["browser_family"] in {"chrome", "edge", "firefox"}
        # Each browser uploaded one request in organization(), so its last upload is known.
        assert browser["last_reporting_at"] is not None


def test_the_developer_panel_lists_each_organization_with_its_active_members(setup):
    app, admin, company, *_ = setup
    from test_contact import developer

    organization(setup, ["chatgpt-gpt-5-6-sol"] * 2)
    panel = developer(app, app.state.service.settings)
    items = panel.get("/v1/operator/organizations").json()["items"]
    mine = next(item for item in items if item["company_id"] == company.id)
    # The admin and the two people in organization().
    assert mine["members"] == 3
    assert mine["retention_choice"] is None


def test_the_developer_panel_shows_the_developer_their_own_email_but_keeps_audit_pseudonyms(setup):
    app, _, company, *_ = setup
    from conftest import operator_confirmed
    from test_contact import developer

    panel = developer(app, app.state.service.settings)
    assert panel.get("/v1/operator/auth/session").json()["email"] == "operator@example.org"
    org = next(
        i for i in panel.get("/v1/operator/organizations").json()["items"] if i["company_id"] == company.id
    )
    changed = panel.put(
        f"/v1/operator/organizations/{company.id}/status",
        json=operator_confirmed(
            panel,
            {
                "expected_version": org["version"],
                "status": "suspended",
                "reason": "Asked in writing",
                "idempotency_key": str(uuid4()),
            },
        ),
    )
    assert changed.status_code == 200, changed.text
    entry = next(
        i for i in panel.get("/v1/operator/audit").json()["items"] if i["action"] == "service_status_changed"
    )
    # The audit log names developers only by a keyed pseudonym (test_count_disclosure).
    assert "actor_email" not in entry and "@" not in entry["actor"]
    assert entry["company_id"] == company.id


def test_the_developer_panel_lists_every_organizations_exceptions_with_their_acknowledgement_state(setup):
    app, _, company, _, now, _ = setup
    from datetime import timedelta

    from conftest import operator_confirmed
    from test_contact import developer

    from aift.security import instant

    panel = developer(app, app.state.service.settings)
    assert panel.get("/v1/operator/exceptions").json()["items"] == []
    plans_before = panel.get("/v1/operator/plans").json()["items"]
    granted = panel.post(
        f"/v1/operator/organizations/{company.id}/exceptions",
        json=operator_confirmed(
            panel,
            {
                "expected_version": 1,
                "member_capacity": 80,
                "retention_months": 12,
                "effective_at": instant(now[0]),
                "expires_at": instant(now[0] + timedelta(days=30)),
                "reason": "Second department joins",
                "idempotency_key": str(uuid4()),
            },
        ),
    )
    assert granted.status_code == 200, granted.text
    [item] = panel.get("/v1/operator/exceptions").json()["items"]
    assert item["company_id"] == company.id and item["company_name"] == company.data["name"]
    assert item["member_capacity"] == 80 and item["status"] == "active"
    # The fixture plan keeps 6 months, so ending the 12-month exception shortens retention.
    assert item["retention_shortened"] is True and item["acknowledged"] is False
    assert "request_hash" not in item and "reviewer_id" not in item
    # The exception's private copy of the plan to return to is not offered as a plan.
    assert panel.get("/v1/operator/plans").json()["items"] == plans_before


def test_people_summary_gives_the_spread_and_median_without_naming_anyone(setup):
    app, admin, *_ = setup
    _, people = organization(setup, ["chatgpt-gpt-5-6-sol"] * 3)
    result = admin.get("/v1/admin/people")
    assert result.status_code == 200, result.text
    body = result.json()
    assert body["used"] == 3
    # Aggregates only (owner decision of 18 October 2026): no requests per member id.
    assert "requests" not in body
    for person in people:
        assert person.get("/v1/auth/session").json()["user_id"] not in result.text
    assert body["median_requests"] == body["average_requests"] == body["max_requests"] == "1"
    # Each of the three sent one request, so all sit in the first bin.
    assert [b["people"] for b in body["bins"]] == [3, 0, 0, 0, 0, 0]
    assert [(b["from"], b["to"]) for b in body["bins"]][-1] == (1000, None)
    # The admin and the three people are members; only the admin is an administrator.
    assert body["members"] == 4 and body["administrators"] == 1
    assert body["capacity"] >= body["members"]
    assert admin.get("/v1/admin/people", params={"site": "chatgpt"}).status_code == 422
    assert admin.get("/v1/admin/people", params={"user_id": str(uuid4())}).status_code == 400
    # A member cannot read it.
    assert people[0].get("/v1/admin/people").status_code in {401, 403, 404}


def test_admin_summary_without_person_analytics_refuses_one_person(setup):
    _, admin, *_ = setup
    organization(setup, ["chatgpt-gpt-5-6-sol"] * 2 + ["chatgpt-gpt-5-6-luna"])
    whole = admin.get("/v1/admin/summary").json()
    assert whole["request_count"] == "3"
    assert set(whole["sites"]) == {"chatgpt"} and whole["sites"]["chatgpt"]["request_count"] == "3"
    assert len(whole["days"]) == 1 and next(iter(whole["days"].values()))["request_count"] == "3"
    assert {k: v["request_count"] for k, v in whole["models"].items()} == {
        "chatgpt-gpt-5-6-sol": "2",
        "chatgpt-gpt-5-6-luna": "1",
    }
    # The luna model was used by one person; its part still shows, with that count of people.
    assert whole["models"]["chatgpt-gpt-5-6-luna"]["active_users"] == "1"
    # Without person analytics there is no summary of one person: the server refuses the filter.
    person = admin.get("/v1/admin/users").json()["items"][-1]["user_id"]
    single = admin.get("/v1/admin/summary", params={"user_id": person})
    assert single.status_code == 400 and single.json()["error"]["code"] == "person_analytics_disabled"


def test_health_counts_browsers_without_listing_them(setup):
    app, admin, company, _, now, _ = setup
    from datetime import timedelta

    from sqlalchemy import select

    from aift.db import Device, put
    from aift.security import instant

    _, people = organization(setup, ["chatgpt-gpt-5-6-sol"] * 2)
    result = admin.get("/v1/admin/health")
    assert result.status_code == 200, result.text
    body = result.json()
    # Counts only (owner decision of 18 October 2026): no browser, member or upload time.
    assert body == {
        "browsers_connected": 2,
        "browsers_synced_last_day": 2,
        "browsers_not_synced_3_days": 0,
        "problems": [],
    }
    for person in people:
        assert person.get("/v1/auth/session").json()["user_id"] not in result.text
    # One browser reports a sync failure; four days later neither has uploaded again.
    with app.state.db.transaction() as s:
        device = s.scalars(select(Device).where(Device.tenant == company.id).order_by(Device.id)).first()
        report = {"code": "sync_failed", "site": "chatgpt", "count": 3, "client_version": "1.0.0"}
        put(s, "health", device.id, {**report, "at": instant(now[0])}, company.id, device.owner)
    now[0] += timedelta(days=4)
    body = admin.get("/v1/admin/health").json()
    assert body["browsers_synced_last_day"] == 0 and body["browsers_not_synced_3_days"] == 2
    assert body["problems"] == [{"code": "sync_failed", "site": "chatgpt", "browsers": 1}]
    assert admin.get("/v1/admin/health", params={"user_id": str(uuid4())}).status_code == 400
