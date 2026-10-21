"""
The People page counts each person's requests as the summaries do: live requests plus the requests
their saved history adds. Until 15 October 2026 it counted live requests only, so on production the
owner showed 22 requests there and 358 in the organization summary.
"""

from conftest import PERSON_ANALYTICS, connect, login
from organization_dataset import build
from test_analytics import observations, upload
from test_historical_usage import message, page, send

from aift.db import get
from aift.historical_usage import HistoricalUsage
from aift.security import instant

SINCE_SEPTEMBER = {"period": "custom", "start": "2026-09-01", "end": "2026-09-11"}


def total(summary):
    """Requests as the admin site shows them: live plus saved history while it is available."""
    saved = summary["history"]
    return int(summary["request_count"]) + (int(saved["prompt_count"]) if saved["status"] == "available" else 0)


@PERSON_ANALYTICS
def test_saved_history_requests_count_on_the_people_page(setup, monkeypatch):
    app, admin, _, _, now, _ = setup
    login(app, admin)
    credentials, _ = connect(app, admin)
    request, attempt = observations(now[0])
    assert upload(admin, credentials, [request, attempt]).status_code == 200
    dated = instant(now[0])
    first, reply, second, undated = (
        message(now[0], "1" * 64, "prompt"),
        message(now[0], "2" * 64, "response"),
        message(now[0], "3" * 64, "prompt"),
        message(now[0], "4" * 64, "prompt"),
    )
    for record in (first, reply, second):
        record["occurred_at"] = dated
    reply["prompt_key"] = first["message_key"]
    undated["occurred_at"], undated["date_basis"] = None, "unknown"
    result = send(admin, credentials, page(now[0], [first, reply, second, undated]))
    assert result.status_code == 200, result.text
    owner = admin.get("/v1/auth/session").json()["user_id"]
    # One live request, and two dated saved prompts in the period; an undated message belongs to no
    # period, so it counts only for all time. The count per person leaves it out in every period:
    # its only time comes from the browser, which cannot show it was saved after person analytics
    # was switched on (test_admin_privacy); the organization's figures keep it.
    for query, expected in ((SINCE_SEPTEMBER, 3), ({"period": "all"}, 4)):
        people = admin.get("/v1/admin/people", params=query).json()
        assert people["requests"] == {owner: "3"}, (query, people)
        assert people["median_requests"] == str(expected)
        summary = admin.get("/v1/admin/summary", params={**query, "splits": "none"}).json()
        assert total(summary) == expected

    # Over the saved-message limit of one summary, each person is counted on their own, as their
    # own summary counts them.
    original = HistoricalUsage.summary

    def over_the_limit(self, s, company, person, *args, **kwargs):
        if person is None and kwargs.get("requests_only"):
            return {"status": "unavailable"}
        return original(self, s, company, person, *args, **kwargs)

    monkeypatch.setattr(HistoricalUsage, "summary", over_the_limit)
    assert admin.get("/v1/admin/people", params=SINCE_SEPTEMBER).json()["requests"] == {owner: "3"}


@PERSON_ANALYTICS
def test_people_counts_add_up_to_the_organization_summary(setup):
    # Live records and saved chats of five installations over four weeks: saved replies linked to
    # live attempts (counted once), undated messages, regenerations, two estimation releases.
    admin, _ = build(setup, live_per_member=16, conversations_per_member=4, messages=12)
    queries = [
        {"period": "custom", "start": "2026-08-11", "end": "2026-09-11"},
        {"period": "custom", "start": "2026-08-20", "end": "2026-08-21"},
        {"period": "custom", "start": "2026-09-03", "end": "2026-09-10"},
        {"period": "month"},
        {"period": "all"},
    ]
    checked_history = False
    for query in queries:
        people = admin.get("/v1/admin/people", params=query)
        assert people.status_code == 200, people.text
        counts = {owner: int(n) for owner, n in people.json()["requests"].items()}
        whole = admin.get("/v1/admin/summary", params={**query, "splits": "none"}).json()
        assert sum(counts.values()) == total(whole), query
        checked_history |= whole["history"]["status"] == "available" and whole["history"]["prompt_count"] != "0"
        for owner, count in counts.items():
            single = admin.get("/v1/admin/summary", params={**query, "user_id": owner, "splits": "none"}).json()
            assert count == total(single), (query, owner)
    assert checked_history


def per_person(setup, query):
    """
    Each person's requests as the People page counts them, read inside the server: without person
    analytics the page returns aggregates only (owner decision of 18 October 2026).
    """
    app, company_id = setup[0], setup[2].id
    queries = app.state.service.analytics.admin_queries
    with app.state.db.transaction(readonly=True) as s:
        company = get(s, "company", company_id)
        _, interval = queries.filters(company, query, {"start", "end", "period"})
        counts = queries.request_counts(s, company, query, interval)
    return {owner: count for owner, count in counts.items() if count}


def own_total(setup, owner, query):
    """One person's requests as their own summary counts them (live plus saved history)."""
    app, company_id = setup[0], setup[2].id
    analytics = app.state.service.analytics
    with app.state.db.transaction(readonly=True) as s:
        company = get(s, "company", company_id)
        member = get(s, "member", owner, company.id)
        value = analytics.summary(s, company, member, query, personal=True)
        value["history"] = analytics.history.summary(s, company, owner, None, query)
    return total(value)


def test_saved_history_requests_count_in_the_people_aggregates(setup, monkeypatch):
    app, admin, _, _, now, _ = setup
    login(app, admin)
    credentials, _ = connect(app, admin)
    request, attempt = observations(now[0])
    assert upload(admin, credentials, [request, attempt]).status_code == 200
    dated = instant(now[0])
    first, reply, second, undated = (
        message(now[0], "1" * 64, "prompt"),
        message(now[0], "2" * 64, "response"),
        message(now[0], "3" * 64, "prompt"),
        message(now[0], "4" * 64, "prompt"),
    )
    for record in (first, reply, second):
        record["occurred_at"] = dated
    reply["prompt_key"] = first["message_key"]
    undated["occurred_at"], undated["date_basis"] = None, "unknown"
    result = send(admin, credentials, page(now[0], [first, reply, second, undated]))
    assert result.status_code == 200, result.text
    owner = admin.get("/v1/auth/session").json()["user_id"]
    # One live request, and two dated saved prompts in the period; an undated message belongs to no
    # period, so it counts only for all time.
    for query, expected in ((SINCE_SEPTEMBER, 3), ({"period": "all"}, 4)):
        people = admin.get("/v1/admin/people", params=query).json()
        assert per_person(setup, query) == {owner: expected}, query
        assert people["used"] == 1 and "requests" not in people
        assert people["median_requests"] == people["max_requests"] == str(expected)
        summary = admin.get("/v1/admin/summary", params={**query, "splits": "none"}).json()
        assert total(summary) == expected

    # Over the saved-message limit of one summary, each person is counted on their own, as their
    # own summary counts them.
    original = HistoricalUsage.summary

    def over_the_limit(self, s, company, person, *args, **kwargs):
        if person is None and kwargs.get("requests_only"):
            return {"status": "unavailable"}
        return original(self, s, company, person, *args, **kwargs)

    monkeypatch.setattr(HistoricalUsage, "summary", over_the_limit)
    assert per_person(setup, SINCE_SEPTEMBER) == {owner: 3}
    assert admin.get("/v1/admin/people", params=SINCE_SEPTEMBER).json()["max_requests"] == "3"


def test_people_aggregates_add_up_to_the_organization_summary(setup):
    # Live records and saved chats of five installations over four weeks: saved replies linked to
    # live attempts (counted once), undated messages, regenerations, two estimation releases.
    admin, _ = build(setup, live_per_member=16, conversations_per_member=4, messages=12)
    queries = [
        {"period": "custom", "start": "2026-08-11", "end": "2026-09-11"},
        {"period": "custom", "start": "2026-08-20", "end": "2026-08-21"},
        {"period": "custom", "start": "2026-09-03", "end": "2026-09-10"},
        {"period": "month"},
        {"period": "all"},
    ]
    checked_history = False
    for query in queries:
        people = admin.get("/v1/admin/people", params=query)
        assert people.status_code == 200, people.text
        counts = per_person(setup, query)
        whole = admin.get("/v1/admin/summary", params={**query, "splits": "none"}).json()
        assert sum(counts.values()) == total(whole), query
        checked_history |= whole["history"]["status"] == "available" and whole["history"]["prompt_count"] != "0"
        # The page's aggregates come from the same counts.
        ordered = sorted(counts.values())
        assert people.json()["used"] == len(ordered)
        assert people.json()["max_requests"] == (str(ordered[-1]) if ordered else None)
        for owner, count in counts.items():
            assert count == own_total(setup, owner, query), (query, owner)
    assert checked_history
