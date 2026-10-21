"""
Every summary answers byte for byte as the reference path does (15 October 2026). The reference is
the code without a read memo: every split reads its own rollups, every stored estimate is read on
its own and every saved message's parts are worked out again. The faster path shares these reads
inside one request. The organization covers several tools, models and days, records on both sides
of a local midnight, saved chats linked to live replies, a conflicting saved message, a stored
retention cutoff inside the period, recalculated views (a finished job and an EcoLogits choice in
settings), organization totals not shared with members, and erased people and ranges.
"""

import json
from datetime import UTC, datetime
from uuid import uuid4

from conftest import PERSON_ANALYTICS
from organization_dataset import auth, build, choose_ecologits, eco, key
from sqlalchemy import select
from test_analytics import observations, upload
from test_completion import finish_job, reauth
from test_historical_usage import message, page, send
from test_summary_performance import forget, scrub, unoptimised

from aift.db import HistoryObservation, Observation, get, put
from aift.security import instant

MONTH = {"period": "custom", "start": "2026-08-11", "end": "2026-09-11"}
# Europe/Berlin is two hours ahead in September: these instants are 23:59 and 00:01 local time.
BEFORE_MIDNIGHT = datetime(2026, 9, 2, 21, 59, tzinfo=UTC)
AFTER_MIDNIGHT = datetime(2026, 9, 2, 22, 1, tzinfo=UTC)


def calls(admin, people):
    admin_id = admin.get("/v1/auth/session").json()["user_id"]
    owner, owner_credentials = people[0]
    member, member_credentials = people[2]
    selector, selector_credentials = people[3]
    saved = owner.get("/v1/me/history/export", headers=auth(owner_credentials)).json()["records"][0]
    recalculated = {"calculation_view": "recalculated", "method_id": eco()["method_id"]}
    boundary = {"period": "custom", "start": "2026-09-02", "end": "2026-09-04"}
    return {
        "admin, 30 days": (admin, "/v1/admin/summary", MONTH, None),
        "admin, 30 days without splits": (admin, "/v1/admin/summary", {**MONTH, "splits": "none"}, None),
        "admin, around a midnight": (admin, "/v1/admin/summary", boundary, None),
        "admin, this month": (admin, "/v1/admin/summary", {"period": "month"}, None),
        "admin, this week": (admin, "/v1/admin/summary", {"period": "week"}, None),
        "admin, all time": (admin, "/v1/admin/summary", {"period": "all"}, None),
        "admin, activity": (admin, "/v1/admin/activity", MONTH, None),
        "admin, one person": (admin, "/v1/admin/summary", {**MONTH, "user_id": admin_id}, None),
        "admin, one person recalculated": (
            admin,
            "/v1/admin/summary",
            {**MONTH, "user_id": admin_id, **recalculated},
            None,
        ),
        "admin, people": (admin, "/v1/admin/people", MONTH, None),
        "admin, people all time": (admin, "/v1/admin/people", {"period": "all"}, None),
        "member, organization": (member, "/v1/company/summary", MONTH, member_credentials),
        "member, organization around a midnight": (member, "/v1/company/summary", boundary, member_credentials),
        "member, organization without splits": (
            member,
            "/v1/company/summary",
            {**MONTH, "splits": "none"},
            member_credentials,
        ),
        "member, own": (member, "/v1/me/summary", MONTH, member_credentials),
        "member, own around a midnight": (member, "/v1/me/summary", boundary, member_credentials),
        "owner, own": (owner, "/v1/me/summary", MONTH, owner_credentials),
        "owner, own recalculated": (owner, "/v1/me/summary", {**MONTH, **recalculated}, owner_credentials),
        "owner, own all time recalculated": (
            owner,
            "/v1/me/summary",
            {"period": "all", **recalculated},
            owner_credentials,
        ),
        "EcoLogits chosen, own": (selector, "/v1/me/summary", MONTH, selector_credentials),
        "EcoLogits chosen, own all time": (selector, "/v1/me/summary", {"period": "all"}, selector_credentials),
        "owner, live chat": (
            owner,
            "/v1/me/conversations/" + key("conversation", 0, 3) + "/summary",
            {"period": "all"},
            owner_credentials,
        ),
        "owner, saved chat": (
            owner,
            "/v1/me/history/" + saved["observation"]["conversation_key"] + "/summary",
            {"period": "all"},
            owner_credentials,
        ),
    }


def answer(client, path, params, credentials):
    response = client.get(path, params=params, headers=auth(credentials) if credentials else {})
    body = scrub(response.json())
    if "error" in body:
        # A refusal names its request; the rest of it must match.
        body["error"].pop("correlation_id", None)
    # The text keeps key order, so equal text is the same answer byte for byte.
    return response.status_code, json.dumps(body, ensure_ascii=False, separators=(",", ":"))


def compare(monkeypatch, requests, expect_ok=()):
    with unoptimised(monkeypatch):
        expected = {name: answer(*call) for name, call in requests.items()}
    for name in expect_ok:
        assert expected[name][0] == 200, (name, expected[name])
    for attempt in ("cold", "warm"):
        if attempt == "cold":
            forget()
        for name, call in requests.items():
            assert answer(*call) == expected[name], (attempt, name)
    return {name: json.loads(text) for name, (_, text) in expected.items()}


def around_midnight(member, credentials):
    records = []
    for n, when in enumerate((BEFORE_MIDNIGHT, AFTER_MIDNIGHT)):
        request, attempt = observations(when, str(200 + n))
        request["site"] = "claude"
        request["model_id"], request["model_evidence"] = "claude-opus-4-8", "response_field"
        request["conversation_key"] = key("midnight", n)
        attempt["provider_attempt_key"] = key("midnight attempt", n)
        records += [request, attempt]
    result = upload(member, credentials, records)
    assert all(r["status"] == "applied" for r in result.json()["results"]), result.text
    saved = []
    for n, when in enumerate((BEFORE_MIDNIGHT, AFTER_MIDNIGHT)):
        prompt, reply = message(when, key("midnight prompt", n), "prompt"), message(when, key("midnight reply", n))
        for record in (prompt, reply):
            record["occurred_at"] = instant(when)
        reply["prompt_key"] = prompt["message_key"]
        saved += [prompt, reply]
    result = send(member, credentials, page(AFTER_MIDNIGHT, saved))
    assert result.status_code == 200, result.text


def erase(app, company, admin_member, admin, body):
    preview = admin.post("/v1/admin/deletions/preview", json=body)
    assert preview.status_code == 200, preview.text
    operation = str(uuid4())
    erased = admin.post(
        "/v1/admin/deletions",
        json={
            "preview_token": preview.json()["preview_token"],
            "idempotency_key": operation,
            "confirmed": True,
            "reauth_token": reauth(app, company, admin_member),
        },
    )
    assert erased.status_code == 200, erased.text
    finish_job(app, company, operation)


@PERSON_ANALYTICS
def test_every_summary_matches_the_reference_path(setup, monkeypatch):
    app, _, company, admin_member, now, _ = setup
    admin, people = build(setup, live_per_member=16, conversations_per_member=4, messages=12)
    member, member_credentials = people[2]
    around_midnight(member, member_credentials)
    choose_ecologits(app, *people[3])
    with app.state.db.transaction() as s:
        # One saved message whose reads disagree, and a stored retention cutoff inside the period.
        h = HistoryObservation
        row = s.scalars(
            select(h)
            .where(h.tenant == company.id, h.role == "prompt")
            .where(h.occurred_at >= "2026-08-20", h.occurred_at < "2026-09-10")
            .order_by(h.owner, h.message_key)
            .limit(1)
        ).one()
        row.status = "conflict"
        put(s, "retention", company.id, {"cutoff": "2026-08-17T00:00:00.000Z"}, company.id)
    requests = calls(admin, people)
    first = compare(
        monkeypatch,
        requests,
        expect_ok=[name for name in requests if "recalculated" in name or "EcoLogits" in name or "people" in name],
    )
    whole = first["admin, 30 days"]
    assert whole["retention_cutoff"] == "2026-08-17T00:00:00.000Z"
    assert int(whole["history"]["conflicting_message_count"]) == 1
    assert int(whole["history"]["matched_live_message_count"]) > 0
    assert len(whole["sites"]) == 4 and whole["models"] and len(whole["days"]) > 10
    assert first["EcoLogits chosen, own"]["calculation_view"] == "recalculated"
    assert {"2026-09-02", "2026-09-03"} <= set(first["member, organization around a midnight"]["days"])

    # Organization totals not shared with members.
    with app.state.db.transaction() as s:
        stored = get(s, "company", company.id)
        stored.data = {**stored.data, "company_sharing": "disabled"}
    suppressed = compare(monkeypatch, {k: v for k, v in requests.items() if k.startswith("member")})
    assert suppressed["member, organization"]["suppressed"] is True

    # One person erased, and an hour of another person's usage around the midnight.
    def user_id(index):
        # The owner of the installation's first chat in organization_dataset.build.
        chat = key("conversation", index, 0)
        with app.state.db.transaction(readonly=True) as s:
            return s.scalars(select(Observation.owner).where(Observation.conversation == chat).limit(1)).one()

    erase(app, company, admin_member, admin, {"scope": "user", "user_id": user_id(4)})
    erase(
        app,
        company,
        admin_member,
        admin,
        {
            "scope": "range",
            "user_id": user_id(2),
            "start": instant(BEFORE_MIDNIGHT.replace(minute=30)),
            "end": instant(AFTER_MIDNIGHT.replace(minute=30)),
        },
    )
    compare(monkeypatch, requests)
