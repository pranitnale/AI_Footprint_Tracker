"""
Owner decisions of 17 and 18 October 2026: by default organization administrators see organization
totals and aggregate figures only, never usage next to a name, email, member id or browser, and
never a request list per person. The server enforces it, so these tests call the API directly.
Small groups are not hidden. By default no connection address is collected; stored ones stay until
an explicit purge.

Two operator switches (person_analytics_enabled and ip_collection_enabled, both off by default)
bring the earlier per-person views and the address collection back. When person analytics is
switched on, usage recorded before that moment is never shown by person.
"""

import json
import os
import subprocess
import sys
from dataclasses import asdict, replace
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from conftest import PERSON_ANALYTICS, confirmed, connect, login, member_login, switch_person_analytics_since
from fastapi.testclient import TestClient
from footprint_estimator import BASELINE_METHOD_ID
from test_analytics import observations, upload
from test_completion import finish_job, reauth
from test_summary_splits import organization

from aift.config import Settings
from aift.db import NetworkObservation, get, put, rows
from aift.main import create_app
from aift.maintenance import purge_network_observations
from aift.method_history import RecalculationJob
from aift.security import instant, parse_time
from aift.service import PERSON_ANALYTICS_KEY

# A switch moment the day before the fixture's clock (10 September 2026, 12:00 UTC).
SWITCHED_ON = "2026-09-09T12:00:00.000Z"
# Without a backdated switch, the fixture records person analytics as switched on at its own start,
# which gives this per-person floor: the next midnight in Berlin.
FIXTURE_FLOOR = "2026-09-10T22:00:00.000Z"


def usage_on_both_sides_of_the_floor(app, client, now):
    """
    Connects a browser four minutes before FIXTURE_FLOOR and uploads one request with its attempt on
    each side of it. The server refuses usage from before a browser was connected, and access tokens
    last ten minutes, so the clock moves only five minutes between the two uploads.
    """
    now[0] = parse_time(FIXTURE_FLOOR) - timedelta(minutes=4)
    login(app, client)
    credentials, _ = connect(app, client)

    def send(records):
        results = upload(client, credentials, list(records)).json()["results"]
        assert [result["status"] for result in results] == ["applied", "applied"], results
        return records

    before = send(observations(now[0]))
    now[0] += timedelta(minutes=5)
    return credentials, before, send(observations(now[0]))


USAGE_READS = [
    ("/v1/admin/summary", {}),
    ("/v1/admin/summary", {"splits": "none"}),
    ("/v1/admin/summary", {"period": "all"}),
    ("/v1/admin/activity", {}),
    ("/v1/admin/activity", {"period": "all"}),
    ("/v1/admin/people", {}),
    ("/v1/admin/people", {"period": "all"}),
    ("/v1/admin/breakdown", {"group_by": "site_model"}),
    ("/v1/admin/breakdown", {"group_by": "site"}),
    ("/v1/admin/health", {}),
    ("/v1/admin/plan", {}),
]


def people_of(admin):
    """Every member's id and work email, as the access list gives them."""
    members = admin.get("/v1/admin/users").json()["items"]
    return [(m["user_id"], m["email"]) for m in members]


def production_settings(settings, **changes):
    """A complete production configuration with the test keys, for validate() only."""
    return Settings(
        database_url="postgresql://aift@db/aift",
        environment="production",
        encryption_key=settings.encryption_key,
        lookup_key=settings.lookup_key,
        deletion_signing_key=settings.deletion_signing_key,
        deletion_journal_path="/var/lib/aift/journal.jsonl",
        member_capacity=50,
        domain_policy="one_active",
        policy_confirmed=True,
        routing_verified=True,
        mail_privacy_verified=True,
        restore_journal_verified=True,
        support_contact="support@example.org",
        privacy_contact="privacy@example.org",
        security_contact="security@example.org",
        brevo_key="brevo-test-key",
        brevo_sender="sender@example.org",
        operator_risk_accepted=True,
        **changes,
    )


def test_no_admin_answer_puts_usage_next_to_a_person(setup):
    app, admin, *_ = setup
    organization(setup, ["chatgpt-gpt-5-6-sol", "chatgpt-gpt-5-6-sol", "chatgpt-gpt-5-6-luna"])
    members = people_of(admin)
    assert len(members) == 4
    for path, params in USAGE_READS:
        response = admin.get(path, params=params)
        assert response.status_code == 200, (path, params, response.text)
        for user_id, email in members:
            assert user_id not in response.text, (path, params)
            assert email not in response.text, (path, params)
        assert "user_id" not in response.text and "device_id" not in response.text, (path, params)
    # The access list names members, but carries no usage.
    for item in admin.get("/v1/admin/users").json()["items"]:
        assert set(item) == {"user_id", "email", "role", "status", "membership_version", "installations"}
    # A member's browsers say which are connected and since when, never when they were used.
    for user_id, _ in members:
        devices = admin.get(f"/v1/admin/users/{user_id}/devices")
        assert devices.status_code == 200, devices.text
        for item in devices.json()["items"]:
            assert set(item) == {"device_id", "browser_family", "status", "first_seen_at"}


def test_activity_gives_days_and_models_with_counts_of_people(setup):
    _, admin, *_ = setup
    organization(setup, ["chatgpt-gpt-5-6-sol", "chatgpt-gpt-5-6-sol", "chatgpt-gpt-5-6-luna"])
    whole = admin.get("/v1/admin/activity").json()
    assert whole["aggregate_status"] == "current" and whole["request_count"] == "3"
    assert sum(int(day["request_count"]) for day in whole["days"].values()) == 3
    models = {model: (part["request_count"], part["active_users"]) for model, part in whole["models"].items()}
    # A model used by one person still shows (no small-group hiding), as a count of people.
    assert models == {"chatgpt-gpt-5-6-sol": ("2", "2"), "chatgpt-gpt-5-6-luna": ("1", "1")}
    assert whole["models"]["chatgpt-gpt-5-6-sol"]["site"] == "chatgpt"
    # It is the administrator summary with its day and model splits: the same figures.
    summary = admin.get("/v1/admin/summary").json()
    for key in ("request_count", "attempt_count", "resources", "tokens"):
        assert whole[key] == summary[key], key
    for refused in ({"site": "chatgpt"}, {"model": "chatgpt-gpt-5-6-sol"}, {"limit": "5"}):
        response = admin.get("/v1/admin/activity", params=refused)
        assert response.status_code == 422 and response.json()["error"]["code"] == "unsupported_filter"


def test_activity_counts_requests_without_a_named_model_under_their_tool(setup):
    """
    Perplexity often names no model. Before 19 October 2026 the Activity page listed models only,
    so such requests were missing from its table by tool and model and the rows fell short of the
    total the Overview shows.
    """
    app, admin, company, _, now, _ = setup
    organization(setup, ["chatgpt-gpt-5-6-sol", "chatgpt-gpt-5-6-luna"])
    person = TestClient(app, base_url=company.origin)
    person.headers["Origin"] = company.origin
    member_login(app, person, "unnamed@example.org")
    credentials, _ = connect(app, person)
    request, attempt = observations(now[0])
    request["site"] = "perplexity"
    assert upload(person, credentials, [request, attempt]).status_code == 200
    whole = admin.get("/v1/admin/activity").json()
    assert whole["request_count"] == "3"
    tools = {site: (part["request_count"], part["active_users"]) for site, part in whole["sites"].items()}
    assert tools == {"chatgpt": ("2", "2"), "perplexity": ("1", "1")}
    assert sum(int(part["request_count"]) for part in whole["sites"].values()) == 3
    # The request names no model, so only its tool's part counts it.
    assert {part["site"] for part in whole["models"].values()} == {"chatgpt"}
    for user_id, email in people_of(admin):
        assert user_id not in json.dumps(whole) and email not in json.dumps(whole)


def test_every_admin_read_and_action_refuses_a_person(setup):
    app, admin, company, member, *_ = setup
    login(app, admin)
    person = member.id
    for path, params in USAGE_READS:
        if path == "/v1/admin/plan":
            continue
        response = admin.get(path, params={**params, "user_id": person})
        assert response.status_code == 400, (path, response.text)
        assert response.json()["error"]["code"] == "person_analytics_disabled", path
    export = admin.post("/v1/admin/exports", json=confirmed(admin, {"period": "all", "user_id": person}))
    assert export.status_code == 400, export.text
    records = admin.post("/v1/admin/exports", json=confirmed(admin, {"period": "all", "report": "records"}))
    assert records.status_code == 400, records.text
    recalculation = admin.post(
        "/v1/admin/recalculations",
        json={"method_id": BASELINE_METHOD_ID, "operation_id": str(uuid4()), "user_id": person},
    )
    assert recalculation.status_code == 400, recalculation.text
    for path in ("/v1/admin/requests", f"/v1/admin/users/{person}/requests/{uuid4()}", "/v1/admin/network"):
        assert admin.get(path).status_code == 404, path


@PERSON_ANALYTICS
def test_activity_takes_no_person_even_with_person_analytics_on(setup):
    app, admin, company, member, *_ = setup
    login(app, admin)
    response = admin.get("/v1/admin/activity", params={"user_id": member.id})
    assert response.status_code == 422 and response.json()["error"]["code"] == "unsupported_filter"


def test_admins_cannot_read_the_progress_of_one_persons_recalculation(setup):
    app, admin, company, member, now, _ = setup
    login(app, admin)
    identifiers = {}
    with app.state.db.transaction() as session:
        for name, owner in (("personal", member.id), ("organization", None)):
            identifiers[name] = str(uuid4())
            session.add(
                RecalculationJob(
                    id=identifiers[name],
                    tenant=company.id,
                    owner=owner,
                    actor=member.id,
                    method_id=BASELINE_METHOD_ID,
                    data={
                        "status": "pending",
                        "created_at": instant(now[0]),
                        "processed": 7,
                        "completed_at": None,
                        "error_code": None,
                        "deletion_epoch": company.data["epoch"],
                    },
                )
            )
    assert admin.get("/v1/admin/recalculations/" + identifiers["personal"]).status_code == 404
    assert admin.get("/v1/admin/recalculations/" + identifiers["organization"]).status_code == 200


def test_deleting_one_persons_records_says_what_goes_without_counting_them(setup):
    app, admin, company, member, now, _ = setup
    _, people = organization(setup, ["chatgpt-gpt-5-6-sol"] * 2)
    person = people[0].get("/v1/auth/session").json()["user_id"]
    preview = admin.post("/v1/admin/deletions/preview", json={"scope": "user", "user_id": person})
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["state"] == "ready" and body["counts_shown"] is False
    for key in ("request_count", "record_count", "historical_message_count", "undated_historical_message_count"):
        assert body[key] is None, key
    assert body["contribution_dates"] == [] and body["contribution_date_range"] == {"start": None, "end": None}
    assert body["deletes"] and all(isinstance(line, str) for line in body["deletes"])
    # A deletion of the whole organization's range still counts what it removes.
    whole = admin.post(
        "/v1/admin/deletions/preview",
        json={
            "scope": "range",
            "start": instant(now[0] - timedelta(days=1)),
            "end": instant(now[0] + timedelta(days=1)),
        },
    ).json()
    assert whole["counts_shown"] is True and whole["request_count"] == "2" and whole["deletes"] is None
    operation = str(uuid4())
    erased = admin.post(
        "/v1/admin/deletions",
        json={
            "preview_token": body["preview_token"],
            "idempotency_key": operation,
            "confirmed": True,
            "reauth_token": reauth(app, company, member),
        },
    )
    assert erased.status_code == 200, erased.text
    assert erased.json()["records_erased"] is None
    finish_job(app, company, operation)
    assert admin.get("/v1/admin/summary").json()["request_count"] == "1"


def test_the_purge_command_counts_then_deletes_every_stored_address(setup):
    app, client, company, member, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, attempt = observations(now[0])
    assert upload(client, credentials, [request, attempt]).status_code == 200
    with app.state.db.transaction() as session:
        for index in range(3):
            put(
                session,
                "network",
                str(uuid4()),
                {
                    "observed_at": instant(now[0] - timedelta(days=index)),
                    "device_id": credentials["device_id"],
                    "address": "stored while IP collection was on",
                    "equality": "e" * 64,
                    "source_quality": "server_observed",
                    "accepted_record_count": 1,
                },
                company.id,
                member.id,
            )
    service = app.state.service
    assert purge_network_observations(service) == {"network_observations": 3, "deleted": 0, "mode": "count"}
    with app.state.db.transaction(readonly=True) as session:
        assert len(rows(session, "network", company.id)) == 3
    result = purge_network_observations(service, confirm=True, page=2)
    assert result == {"network_observations": 3, "deleted": 3, "mode": "deleted"}
    with app.state.db.transaction(readonly=True) as session:
        # The table stays; only its rows are gone.
        assert session.query(NetworkObservation).count() == 0
    # Usage is untouched.
    assert client.get("/v1/me/summary").json()["request_count"] == "1"


def test_settings_written_for_earlier_releases_still_start(setup, tmp_path):
    app, admin, company, _, now, settings = setup
    legacy = {
        "ip_key": "short",
        "ip_keys": {"x": "not a key"},
        "active_ip_key_version": "9",
        "ip_restore_required_until": {"9": "never"},
        "ip_retention_days": 30,
    }
    production = production_settings(settings)
    # While IP collection is off the IP keys are not required, and present ones are ignored,
    # valid or not.
    production.validate()
    replace(production, **legacy).validate()
    started = create_app(replace(settings, **legacy), clock=lambda: now[0])
    assert started.state.service.settings.ip_retention_days == 30
    # Extensions released before the change require an integer; the server says zero days.
    login(app, admin)
    config = admin.get("/v1/config").json()
    assert config["ip_retention_days"] == 0 and config["policy"]["ip_retention_days"] == 0


def test_ip_collection_needs_its_keys_and_retention_again(setup):
    *_, settings = setup
    with pytest.raises(ValueError, match="production release essentials"):
        production_settings(settings, ip_collection_enabled=True).validate()
    with pytest.raises(ValueError, match="IP retention|production release essentials"):
        production_settings(settings, ip_collection_enabled=True, ip_key="k" * 43).validate()
    production_settings(settings, ip_collection_enabled=True, ip_key="k" * 43, ip_retention_days=30).validate()
    # Development settings follow the same key rules once collection is on.
    with pytest.raises(ValueError, match="IP keyring|active IP key version"):
        replace(settings, ip_collection_enabled=True).validate()
    with pytest.raises(ValueError, match="feature switches"):
        replace(settings, person_analytics_enabled="yes").validate()


def test_config_shows_both_switches_off_outside_the_policy(setup):
    app, admin, company, *_ = setup
    login(app, admin)
    config = admin.get("/v1/config").json()
    assert config["features"] == {"person_analytics": False, "ip_collection": False}
    # The switches are not part of the policy, so changing them never makes members accept a new
    # policy version.
    assert "features" not in config["policy"]
    with app.state.db.transaction(readonly=True) as session:
        assert get(session, "company", company.id).data["policy_version"] == config["policy_version"]


@PERSON_ANALYTICS
def test_config_shows_both_switches_on_and_the_address_retention(setup):
    app, admin, *_ = setup
    login(app, admin)
    config = admin.get("/v1/config").json()
    assert config["features"] == {"person_analytics": True, "ip_collection": True}
    assert config["ip_retention_days"] == 30


def test_the_switch_records_when_person_analytics_was_last_turned_on(setup):
    app, _, _, _, now, settings = setup

    def switch():
        with app.state.db.transaction(readonly=True) as session:
            row = get(session, "maintenance_cursor", PERSON_ANALYTICS_KEY)
            return row.data if row else None

    # Never switched on: nothing is recorded.
    assert switch() is None
    first = now[0]
    create_app(replace(settings, person_analytics_enabled=True), clock=lambda: first)
    assert switch() == {"enabled": True, "since": instant(first)}
    # Starting again with it still on keeps the first moment.
    create_app(replace(settings, person_analytics_enabled=True), clock=lambda: first + timedelta(days=3))
    assert switch()["since"] == instant(first)
    # Off and on again starts a new period, so nothing from the off time is shown by person.
    create_app(settings, clock=lambda: first + timedelta(days=4))
    assert switch()["enabled"] is False
    later = first + timedelta(days=5)
    create_app(replace(settings, person_analytics_enabled=True), clock=lambda: later)
    assert switch() == {"enabled": True, "since": instant(later)}


@pytest.mark.features(person_analytics=True, ip_collection=True, backdate=False)
def test_per_person_views_show_only_usage_after_person_analytics_was_switched_on(setup):
    """
    Person analytics counts as switched on at 12:00 UTC on 10 September 2026 (14:00 in Berlin), so
    per-person views start with 11 September in Berlin (22:00 UTC on the 10th). Usage from 23:56
    on the 10th in Berlin counts for the organization but is never shown by person.
    """
    app, client, company, admin, now, _ = setup
    credentials, before, after = usage_on_both_sides_of_the_floor(app, client, now)
    owner = credentials["user_id"]

    def person(path, **params):
        response = client.get(path, params={"period": "all", **params})
        assert response.status_code == 200, (path, response.text)
        return response.json()

    single = person("/v1/admin/summary", user_id=owner)
    assert single["request_count"] == "1" and single["person_analytics_since"] == FIXTURE_FLOOR
    assert person("/v1/admin/summary")["request_count"] == "2"
    people = person("/v1/admin/people")
    assert people["requests"] == {owner: "1"} and people["person_analytics_since"] == FIXTURE_FLOOR
    # The aggregates are the organization's and keep everything.
    assert people["used"] == 1 and people["max_requests"] == "2"
    requests = person("/v1/admin/requests")
    # The list says where it starts, since the period's totals also count the days before.
    assert requests["person_analytics_since"] == FIXTURE_FLOOR
    listed = requests["items"]
    assert [row["request_id"] for row in listed] == [after[0]["request_id"]]
    assert client.get(f"/v1/admin/users/{owner}/requests/{before[0]['request_id']}").status_code == 404
    assert client.get(f"/v1/admin/users/{owner}/requests/{after[0]['request_id']}").status_code == 200
    breakdown = person("/v1/admin/breakdown", group_by="site", user_id=owner)["items"]
    assert [row["request_count"] for row in breakdown] == ["1"]
    preview = client.post("/v1/admin/deletions/preview", json={"scope": "user", "user_id": owner}).json()
    assert preview["counts_shown"] is False and preview["request_count"] is None
    exported = client.post("/v1/admin/exports", json=confirmed(client, {"report": "records", "period": "all"}))
    assert exported.status_code == 200, exported.text
    job = exported.json()
    while job["status"] == "pending":
        job = client.post(job["status_path"] + "/advance", json={}).json()
    text = client.get(job["download_path"]).text
    assert after[0]["request_id"] in text and before[0]["request_id"] not in text


@pytest.mark.features(person_analytics=True, ip_collection=True, backdate=False)
def test_browser_times_from_before_the_floor_stay_hidden(setup):
    """Switched on at the fixture's start (14:00 in Berlin), the floor is the next midnight there."""
    app, client, company, admin, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    owner = credentials["user_id"]
    assert upload(client, credentials, list(observations(now[0]))).status_code == 200
    health = client.get("/v1/admin/health").json()
    assert [browser["last_reporting_at"] for browser in health["browsers"]] == [None]
    devices = client.get(f"/v1/admin/users/{owner}/devices").json()["items"]
    assert [item["last_seen_at"] for item in devices] == [None]
    # Had it been on since the day before, the same upload would show.
    switch_person_analytics_since(app, SWITCHED_ON)
    health = client.get("/v1/admin/health").json()
    assert [browser["last_reporting_at"] for browser in health["browsers"]] == [instant(now[0])]


@PERSON_ANALYTICS
def test_per_person_exports_are_withdrawn_when_person_analytics_is_switched_off(setup):
    app, client, company, admin, now, settings = setup
    login(app, client)
    credentials, _ = connect(app, client)
    assert upload(client, credentials, list(observations(now[0]))).status_code == 200
    person = client.post(
        "/v1/admin/exports", json=confirmed(client, {"period": "all", "user_id": credentials["user_id"]})
    ).json()
    whole = client.post("/v1/admin/exports", json=confirmed(client, {"period": "all"})).json()
    assert client.get(person["download_path"]).status_code == 200
    # The operator switches person analytics off and restarts the server.
    restarted = create_app(replace(settings, person_analytics_enabled=False), clock=lambda: now[0])
    other = TestClient(restarted, base_url=company.data["origin"])
    other.headers["Origin"] = company.data["origin"]
    login(restarted, other)
    assert other.get(person["download_path"]).status_code == 404
    assert other.get(whole["download_path"]).status_code == 200
    # Switching it on again later starts a new period; the old file stays withdrawn.
    again = create_app(settings, clock=lambda: now[0] + timedelta(days=1))
    third = TestClient(again, base_url=company.data["origin"])
    third.headers["Origin"] = company.data["origin"]
    login(again, third)
    assert third.get(person["download_path"]).status_code == 404


@pytest.mark.features(person_analytics=True, ip_collection=True, backdate=False)
def test_with_person_analytics_on_admins_read_only_their_own_later_jobs_for_one_person(setup):
    """
    Person analytics was first seen on at the fixture's start. A job for one person from before
    then, or one the member started for themselves, stays hidden; a later administrator job shows
    its state but not its count, which covers records from before the switch too.
    """
    app, admin, company, member, now, _ = setup
    login(app, admin)
    identifiers = {}
    with app.state.db.transaction() as session:
        for name, owner, created, by_admin in (
            ("earlier", member.id, now[0] - timedelta(days=1), True),
            ("member", member.id, now[0] + timedelta(hours=1), False),
            ("later", member.id, now[0] + timedelta(hours=1), True),
            ("organization", None, now[0] - timedelta(days=1), True),
        ):
            identifiers[name] = str(uuid4())
            session.add(
                RecalculationJob(
                    id=identifiers[name],
                    tenant=company.id,
                    owner=owner,
                    actor=member.id,
                    method_id=BASELINE_METHOD_ID,
                    data={
                        "status": "pending",
                        "created_at": instant(created),
                        "processed": 7,
                        "completed_at": None,
                        "error_code": None,
                        "deletion_epoch": company.data["epoch"],
                        **({"admin_requested": True} if by_admin else {}),
                    },
                )
            )
    for name in ("earlier", "member"):
        assert admin.get("/v1/admin/recalculations/" + identifiers[name]).status_code == 404, name
    later = admin.get("/v1/admin/recalculations/" + identifiers["later"])
    assert later.status_code == 200 and later.json()["processed_estimates"] is None
    whole = admin.get("/v1/admin/recalculations/" + identifiers["organization"])
    assert whole.status_code == 200 and whole.json()["processed_estimates"] == 7


@pytest.mark.features(person_analytics=True, ip_collection=True, backdate=False)
def test_request_details_leave_out_shared_attempts_from_before_the_switch(setup):
    """A later request that shares an attempt started before the person floor neither lists nor counts it."""
    from aift.db import RequestAttemptLink

    app, client, company, _, now, _ = setup
    credentials, (_, early_attempt), (request, attempt) = usage_on_both_sides_of_the_floor(app, client, now)
    owner = credentials["user_id"]
    with app.state.db.transaction() as session:
        session.add(
            RequestAttemptLink(
                tenant=company.id, owner=owner, request_id=request["request_id"], attempt_id=early_attempt["attempt_id"]
            )
        )
    detail = client.get(f"/v1/admin/users/{owner}/requests/{request['request_id']}")
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert body["attempt_count"] == "1"
    assert [item["attempt_id"] for item in body["attempts"]] == [attempt["attempt_id"]]
    listed = client.get("/v1/admin/requests", params={"period": "all"}).json()["items"]
    assert [(row["attempt_count"], row["shared_attempt_count"]) for row in listed] == [("1", "0")]


@pytest.mark.features(person_analytics=True, ip_collection=True, backdate=False)
def test_undated_saved_messages_never_appear_per_person(setup):
    """
    An undated saved message carries only the time its browser reported, which cannot show that it
    was not saved while person analytics was off, so per-person views leave it out even with a
    recent observed_at. Organization totals keep it.
    """
    from test_historical_usage import auth, message, page, send

    app, client, company, _, now, _ = setup
    switch_person_analytics_since(app, SWITCHED_ON)
    login(app, client)
    credentials, _ = connect(app, client)
    owner = credentials["user_id"]
    undated = message(now[0], "a" * 64, "prompt")
    undated.update(occurred_at=None, date_basis="unknown")
    dated = message(now[0], "c" * 64, "prompt")
    dated["occurred_at"] = instant(now[0])
    assert send(client, credentials, page(now[0], [undated, dated])).status_code == 200
    own = client.get("/v1/me/summary?period=all", headers=auth(credentials)).json()["history"]
    assert own["prompt_count"] == "2"
    whole = client.get("/v1/admin/summary", params={"period": "all", "splits": "none"}).json()["history"]
    assert whole["prompt_count"] == "2"
    single = client.get("/v1/admin/summary", params={"period": "all", "splits": "none", "user_id": owner})
    assert single.status_code == 200, single.text
    assert single.json()["history"]["prompt_count"] == "1"
    assert client.get("/v1/admin/people", params={"period": "all"}).json()["requests"] == {owner: "1"}
    exported = client.post("/v1/admin/exports", json=confirmed(client, {"report": "records", "period": "all"}))
    assert exported.status_code == 200, exported.text
    job = exported.json()
    while job["status"] == "pending":
        job = client.post(job["status_path"] + "/advance", json={}).json()
    text = client.get(job["download_path"]).text
    assert "c" * 64 in text and "a" * 64 not in text
    # A person's deletion preview counts undated messages as possibly older, so it shows no counts;
    # the deletion itself still removes them.
    preview = client.post("/v1/admin/deletions/preview", json={"scope": "user", "user_id": owner}).json()
    assert preview["counts_shown"] is False


def test_key_rotation_refuses_to_run_while_ip_collection_is_off(setup, tmp_path):
    _, _, company, _, _, settings = setup
    path = tmp_path / "protected-settings.json"
    path.write_text(json.dumps(asdict(settings)))
    root = Path(__file__).resolve().parents[3]
    environment = {
        **os.environ,
        "AIFT_SETTINGS_FILE": str(path),
        "PYTHONPATH": os.pathsep.join(
            [str(root / "packages/contracts/python"), str(root / "packages/estimator/python")]
        ),
    }
    result = subprocess.run(
        [sys.executable, "-m", "aift.ip_rotation", "--tenant", company.id],
        cwd=root / "apps/server",
        env=environment,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 1, result.stderr
    assert json.loads(result.stdout) == {"error_code": "ip_collection_disabled", "configuration_changed": False}
