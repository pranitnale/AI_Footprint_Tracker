"""
Production-size summaries stay fast and unchanged. On 14 October 2026 the administrator's
organization summary took 30 s to 10 min on about 1,000 saved messages: every day, tool and model
split matched each saved message to live records again, with several queries and schema checks
each, and every check of a stored estimate validated and hashed its method bundle again. The
worker repeated the same checks on every tick. On 15 October the request still took 5 to 37 s
on production: each saved message was still matched with several queries of its own, and every
split read its rows again (test_history_bulk_matching compares the bulk reads that replaced them).
"""

import re
import time
from contextlib import contextmanager

import estimation_contracts
from conftest import PERSON_ANALYTICS
from footprint_contracts import payload_hash
from organization_dataset import auth, build, eco, key
from sqlalchemy import event, select

from aift import engine_adapter, engine_history, historical_usage, history_matching, method_registry
from aift.db import HistoryObservation
from aift.maintenance import run

MONTH = {"period": "custom", "start": "2026-08-11", "end": "2026-09-11"}
# A generous wall-clock limit per summary: the unoptimised path took 22 s on a laptop.
HANG_SECONDS = 20
STATEMENTS = 150


def scrub(value):
    """A summary without the fields that name the snapshot rather than the figures."""
    if isinstance(value, dict):
        return {k: scrub(v) for k, v in value.items() if k not in {"snapshot_id", "generated_at"}}
    if isinstance(value, list):
        return [scrub(v) for v in value]
    return value


def requests(admin, people, person=False):
    """The summaries to time and compare; one person's administrator summary only with person analytics."""
    admin_id = admin.get("/v1/auth/session").json()["user_id"]
    owner, owner_credentials = people[0]
    member, member_credentials = people[2]
    saved = owner.get("/v1/me/history/export", headers=auth(owner_credentials)).json()["records"][0]
    return {
        "admin, 30 days": (admin, "/v1/admin/summary", MONTH, None),
        "admin, this month": (admin, "/v1/admin/summary", {"period": "month"}, None),
        **({"admin, one person": (admin, "/v1/admin/summary", {**MONTH, "user_id": admin_id}, None)} if person else {}),
        "admin, activity": (admin, "/v1/admin/activity", MONTH, None),
        "admin, all time": (admin, "/v1/admin/summary", {"period": "all"}, None),
        "member, organization": (member, "/v1/company/summary", MONTH, member_credentials),
        "member, own": (owner, "/v1/me/summary", MONTH, owner_credentials),
        "member, own recalculated": (
            owner,
            "/v1/me/summary",
            {**MONTH, "calculation_view": "recalculated", "method_id": eco()["method_id"]},
            owner_credentials,
        ),
        "member, live chat": (
            owner,
            "/v1/me/conversations/" + key("conversation", 0, 3) + "/summary",
            {"period": "all"},
            owner_credentials,
        ),
        "member, saved chat": (
            owner,
            "/v1/me/history/" + saved["observation"]["conversation_key"] + "/summary",
            {"period": "all"},
            owner_credentials,
        ),
    }


def fetch(client, path, params, credentials):
    response = client.get(path, params=params, headers=auth(credentials) if credentials else {})
    assert response.status_code == 200, response.text
    return scrub(response.json())


def forget():
    """Empties the process-wide caches of checked bundles, estimates and live records."""
    method_registry._CHECKED.clear()
    engine_history.validate_envelope.digests.clear()
    history_matching._validate_observation.digests.clear()


@contextmanager
def unoptimised(monkeypatch):
    """
    The reference path: no request memo, every saved message read with one full select, and
    nothing kept between checks of a method bundle or a stored estimate.
    """

    @contextmanager
    def no_memo(session):
        yield

    def direct_rows(s, conditions, order=(), limit=None):
        statement = select(HistoryObservation).where(*conditions).order_by(*order)
        return list(s.scalars(statement if limit is None else statement.limit(limit)))

    with monkeypatch.context() as patch:
        patch.setattr(history_matching, "read_memo", no_memo)
        patch.setattr(historical_usage, "load_rows", direct_rows)
        patch.setattr(method_registry, "_CHECKED_LIMIT", 0)
        for checks in (engine_history.validate_envelope, history_matching._validate_observation):
            patch.setattr(checks, "limit", 0)
        forget()
        yield


@contextmanager
def counted(monkeypatch, engine):
    """Counts bundle checks per bundle, method_bundles reads, estimates, envelope checks and
    database statements, the last also per table read, which names the read that grew when a
    limit fails."""
    counts = {
        "bundle_checks": {},
        "bundle_reads": 0,
        "estimates": 0,
        "envelope_checks": 0,
        "statements": 0,
        "tables": {},
    }

    def wrap(module, name, record):
        original = getattr(module, name)

        def wrapper(*args, **kwargs):
            record(*args)
            return original(*args, **kwargs)

        patch.setattr(module, name, wrapper)

    def bundle_check(bundle, *rest):
        key = payload_hash(bundle)
        counts["bundle_checks"][key] = counts["bundle_checks"].get(key, 0) + 1

    def estimate(*args):
        counts["estimates"] += 1

    def envelope(*args):
        counts["envelope_checks"] += 1

    def statement(conn, cursor, sql, parameters, context, executemany):
        counts["statements"] += 1
        if "FROM method_bundles" in sql:
            counts["bundle_reads"] += 1
        table = re.search(r"\bFROM (\w+)", sql)
        table = table.group(1) if table else sql.split(None, 1)[0]
        counts["tables"][table] = counts["tables"].get(table, 0) + 1

    with monkeypatch.context() as patch:
        wrap(estimation_contracts, "validate_method_definition", bundle_check)
        wrap(method_registry, "validate_method_bundle", bundle_check)
        wrap(estimation_contracts, "validate_estimation_envelope", envelope)
        for name in ("estimate", "estimate_history"):
            wrap(method_registry, name, estimate)
        wrap(engine_adapter, "estimate", estimate)
        event.listen(engine, "before_cursor_execute", statement)
        try:
            yield counts
        finally:
            event.remove(engine, "before_cursor_execute", statement)


@PERSON_ANALYTICS
def test_summaries_are_identical_to_the_unoptimised_path(setup, monkeypatch):
    # A smaller organization keeps the slow reference path short; every view is compared.
    admin, people = build(setup, live_per_member=16, conversations_per_member=4, messages=12)
    calls = requests(admin, people, person=True)
    with unoptimised(monkeypatch):
        expected = {name: fetch(*call) for name, call in calls.items()}
    whole = expected["admin, 30 days"]
    assert whole["request_count"] != "0" and whole["history"]["status"] == "available"
    assert len(whole["days"]) > 10 and len(whole["sites"]) == 4 and whole["models"]
    assert int(whole["history"]["matched_live_message_count"]) > 0
    assert expected["member, own recalculated"]["calculation_view"] == "recalculated"
    for attempt in ("cold", "warm"):
        if attempt == "cold":
            forget()
        for name, call in calls.items():
            assert fetch(*call) == expected[name], (attempt, name)


def test_production_size_summary_is_fast_and_worker_ticks_repeat_no_work(setup, monkeypatch):
    app = setup[0]
    admin, people = build(setup)
    calls = requests(admin, people)
    forget()
    with counted(monkeypatch, app.state.db.engine) as counts:
        started = time.perf_counter()
        whole = fetch(*calls["admin, 30 days"])
        elapsed = time.perf_counter() - started
    assert int(whole["history"]["observed_response_count"]) > 400 and len(whole["days"]) > 20
    # Before the fix this request took about 22 s on a laptop; now about 1 s. Wall-clock time
    # depends on the machine and its load (4.1 s on the busy production host on 14 October
    # 2026), so the operation counts below are the real guard and this bound only catches a hang.
    assert elapsed < HANG_SECONDS, elapsed
    assert all(n == 1 for n in counts["bundle_checks"].values()) and counts["bundle_reads"] <= 1, counts
    assert counts["estimates"] == 0, counts
    # Saved messages are matched to live records in bulk, and the splits share the period's rows
    # and its people and installation counts. On a copy of production (15 October 2026) this
    # request took 946 statements before and 70 after; most of the rest is one rollup read a part.
    assert counts["statements"] < STATEMENTS, counts
    # A chat's summary checks each stored estimate, many of them made with the earlier release
    # in method_bundles: that bundle is read and checked once in the whole request.
    forget()
    with counted(monkeypatch, app.state.db.engine) as counts:
        chat = fetch(*calls["member, live chat"])
    assert int(chat["attempt_count"]) > 2, chat
    assert list(counts["bundle_checks"].values()) == [1], counts
    assert counts["bundle_reads"] == 1 and counts["estimates"] == 0, counts

    # The worker's sweeps page through about 170 live attempts and the rollups 100 at a time. Its
    # own job calculates every record once with the packaged method, 100 a tick
    # (MethodHistory.keep_current), and is given the ticks to finish that first.
    methods, company = app.state.service.analytics.methods, setup[2]
    for _ in range(40):
        run(app.state.service)
        with app.state.db.transaction(readonly=True) as session:
            if methods.served(session, company, eco()["method_id"]):
                break
    with counted(monkeypatch, app.state.db.engine) as counts:
        started = time.perf_counter()
        for _ in range(3):
            run(app.state.service)
        elapsed = time.perf_counter() - started
    # Each tick reads the stored bundle's row in its own transaction, but checks nothing again.
    assert counts["bundle_checks"] == {} and counts["envelope_checks"] == 0, counts
    assert counts["estimates"] == 0, counts
    # Before the fix each tick took 6 to 10 s on a laptop under a profiler; now about 1 s. As
    # above, the counts are the guard and the time bound only catches a hang.
    assert elapsed < 3 * HANG_SECONDS, elapsed


def current_requests(app, company, admin, people):
    """The summaries in the server's method (calculation_view=current), once the worker's own job
    has calculated every record with that method, 100 a tick (MethodHistory.keep_current)."""
    owner, owner_credentials = people[0]
    member, member_credentials = people[2]
    current = {**MONTH, "calculation_view": "current"}
    for _ in range(40):
        run(app.state.service)
        with app.state.db.transaction(readonly=True) as session:
            if app.state.service.analytics.methods.served(session, company, eco()["method_id"]):
                break
    return {
        "admin, 30 days": (admin, "/v1/admin/summary", current, None),
        "admin, activity": (admin, "/v1/admin/activity", current, None),
        "member, organization": (member, "/v1/company/summary", current, member_credentials),
        "member, own": (owner, "/v1/me/summary", current, owner_credentials),
    }


def test_the_server_method_view_is_identical_to_the_unoptimised_path(setup, monkeypatch):
    # The day, tool and model parts take their records from one read of the period
    # (Analytics.period_records); without a read memo each part reads its own.
    admin, people = build(setup, live_per_member=16, conversations_per_member=4, messages=12)
    # The same figures asked for by naming the method, as the administrator website does.
    named = {**MONTH, "calculation_view": "recalculated", "method_id": eco()["method_id"]}
    calls = {
        **current_requests(setup[0], setup[2], admin, people),
        "admin, named method": (admin, "/v1/admin/summary", named, None),
        "admin, activity, named method": (admin, "/v1/admin/activity", named, None),
    }
    with unoptimised(monkeypatch):
        expected = {name: fetch(*call) for name, call in calls.items()}
    whole = expected["admin, 30 days"]
    assert whole["calculation_view"] == "recalculated" and whole["method_id"] == eco()["method_id"]
    assert whole["attempt_count"] != "0" and whole["resources"]
    assert whole["history"]["status"] == "available"
    assert int(whole["history"]["matched_live_message_count"]) > 0
    assert len(whole["days"]) > 10 and len(whole["sites"]) == 4 and whole["models"]
    assert expected["admin, named method"] == whole
    for attempt in ("cold", "warm"):
        if attempt == "cold":
            forget()
        for name, call in calls.items():
            assert fetch(*call) == expected[name], (attempt, name)


def test_the_organization_view_in_the_server_method_stays_within_the_limits(setup, monkeypatch):
    """calculation_view=current reads every record's stored estimate instead of the daily
    rollups, once for the whole summary and its day, tool and model parts."""
    app = setup[0]
    admin, people = build(setup)
    calls = current_requests(app, setup[2], admin, people)
    forget()
    statements, tables = {}, {}
    for name, call in calls.items():
        with counted(monkeypatch, app.state.db.engine) as counts:
            started = time.perf_counter()
            answer = fetch(*call)
            elapsed = time.perf_counter() - started
        assert answer["calculation_view"] == "recalculated", name
        assert answer["method_id"] == eco()["method_id"], name
        assert counts["estimates"] == 0, (name, counts)
        assert elapsed < HANG_SECONDS, (name, elapsed)
        statements[name] = counts["statements"]
        tables[name] = counts["tables"]
    whole = fetch(*calls["admin, 30 days"])
    assert len(whole["days"]) > 20 and len(whole["sites"]) == 4 and whole["models"]
    print("current view statements:", statements, tables)
    # On 23 November 2026 the three organization requests took 301 statements each: every part
    # read the period's records again and asked for the server's job again. With one read for
    # all parts they took 221, most of them for one linked saved reply at a time
    # (history_matching.prefetch_linked reads those together).
    assert all(count < STATEMENTS for count in statements.values()), (statements, tables)
    # The worker's job has calculated every record, so a further tick calculates nothing.
    with counted(monkeypatch, app.state.db.engine) as counts:
        run(app.state.service)
    assert counts["estimates"] == 0, counts
