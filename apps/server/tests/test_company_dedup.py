"""Company deduplication (W11): one record counts each prompt or reply for the company.

Every test runs on SQLite, and on PostgreSQL when AIFT_POSTGRES_TEST_URL names an isolated
database (each test uses its own schema, dropped afterwards). Keys and records are synthetic.
"""

import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from conftest import connect, member_login
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from footprint_contracts import compose_output_total
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.engine import make_url
from test_analytics import observations
from test_completion import finish_job, reauth
from test_historical_usage import message, page

from aift import maintenance
from aift.company_dedup import live_rank, saved_rank, server_key
from aift.config import Settings
from aift.db import TABLES, HistoryObservation, Observation, get, put
from aift.main import create_app
from aift.security import canonical, digest, instant, token
from tools.verify_restore import RestoreVerificationError, verify_restored

CHAT = "c" * 64
PROMPT, REPLY, OTHER = ("%064x" % n for n in (1, 2, 3))


class World:
    def __init__(self, app, company, admin, now):
        self.app, self.company, self.admin, self.now = app, company, admin, now

    def member(self, email):
        client = TestClient(self.app, base_url=self.company.data["origin"])
        client.headers["Origin"] = self.company.data["origin"]
        member_login(self.app, client, email)
        credentials, _ = connect(self.app, client)
        return client, credentials


def settings_for(tmp_path):
    return Settings(
        database_url="sqlite:///" + (tmp_path / "server.db").as_posix(),
        environment="test",
        encryption_key=Fernet.generate_key().decode(),
        lookup_key=token(),
        mail_adapter="fake",
        member_capacity=50,
        domain_policy="one_active",
        routing_verified=True,
        operator_emails=("operator@example.org",),
        extension_origins=("chrome-extension://test-extension",),
        deletion_signing_key=token(),
        deletion_journal_path=str(tmp_path / "journal.jsonl"),
    )


@pytest.fixture(params=["sqlite", "postgresql"])
def world(request, tmp_path):
    now = [datetime(2026, 9, 10, 12, tzinfo=UTC)]
    settings = settings_for(tmp_path)
    cleanup = None
    if request.param == "postgresql":
        source = os.environ.get("AIFT_POSTGRES_TEST_URL")
        if not source:
            pytest.skip("Requires explicitly supplied isolated PostgreSQL")
        schema = "aift_test_" + uuid4().hex
        engine = create_engine(source)
        with engine.begin() as connection:
            connection.execute(text('CREATE SCHEMA "' + schema + '"'))
        scoped = make_url(source).update_query_dict({"options": "-csearch_path=" + schema})
        settings = replace(settings, database_url=scoped.render_as_string(hide_password=False))

        def cleanup():
            with engine.begin() as connection:
                connection.execute(text('DROP SCHEMA "' + schema + '" CASCADE'))
            engine.dispose()

    app = create_app(settings, initialize=True, clock=lambda: now[0])
    try:
        with app.state.db.transaction() as s:
            company = put(
                s,
                "company",
                str(uuid4()),
                {
                    "name": "Example",
                    "slug": "example",
                    "domain": "example.org",
                    "origin": "https://example.aifootprinttracker.com",
                    "status": "active",
                    "timezone": "Europe/Berlin",
                    "pause_mode": "user_controlled",
                    "company_sharing": "threshold",
                    "capacity": 50,
                    "retention_months": 6,
                    "policy_version": "1.0.0",
                    "epoch": 0,
                    "version": 1,
                    "plan_id": "free",
                    "plan_version": 1,
                },
            )
            admin = app.state.service.member(s, company, "admin@example.org", True)
        yield World(app, company, admin, now)
    finally:
        app.state.db.engine.dispose()
        if cleanup:
            cleanup()


def auth(credentials):
    return {"Authorization": "Bearer " + credentials["access_token"]}


def record_id(record):
    return record["request_id"] if record["kind"] == "request" else record["attempt_id"]


def live(client, credentials, records, keys=()):
    """Uploads live records with their company keys listed beside them."""
    body = {
        "schema_version": "3.0.0",
        "batch_id": str(uuid4()),
        "sent_at": records[0].get("dispatched_at", records[0].get("started_at")),
        "client_version": "0.1.0",
        "deletion_epoch": 0,
        "records": records,
    }
    if keys:
        body["company_dedup_keys"] = [
            {"kind": record["kind"], "record_id": record_id(record), "company_dedup_key": key}
            for record, key in keys
        ]
    return client.post("/v1/usage/batches", headers=auth(credentials), json=body)


def opened(now, complete=True):
    """A saved prompt and reply of the chat, as a member's browser reads them."""
    prompt, reply = message(now, uuid4().hex * 2, "prompt"), message(now, uuid4().hex * 2)
    for row in (prompt, reply):
        row.update(site="chatgpt", conversation_key=CHAT, occurred_at=instant(now))
        row["date_basis"] = "message_created"
    reply["prompt_key"] = reply["parent_key"] = prompt["message_key"]
    if not complete:
        reply["text_complete"] = False
        reply["coverage_reasons"] = ["history_only", "partial_capture"]
    return prompt, reply


def saved(client, credentials, now, rows, keys=()):
    body = page(now, rows)
    body.update(site="chatgpt", conversation_key=CHAT)
    if keys:
        body["company_dedup_keys"] = [
            {"message_key": row["message_key"], "company_dedup_key": key} for row, key in keys
        ]
    return client.post("/v1/me/history", headers=auth(credentials), json=body)


def sent(now, started=None):
    """A live prompt and reply of the chat, as the sender's browser captures them."""
    request, attempt = observations(now)
    if started is not None:
        attempt["started_at"] = attempt["ended_at"] = instant(started)
    return request, attempt


def measured_in_full(attempt):
    """The reply has no reasoning or tool text, so its answer is its whole output."""
    for part in ("visible_thinking", "tool_input", "intermediate_output"):
        attempt["tokens"][part] = {
            "value": None,
            "evidence": "not_applicable",
            "scope": "observed_text",
            "completeness": "unknown",
            "profile_id": None,
            "reason": "not_applicable",
        }
    attempt["tokens"]["output_total"] = compose_output_total(attempt["tokens"])
    assert attempt["tokens"]["output_total"]["completeness"] == "complete_for_scope"
    return attempt


def period(client):
    """A member's own period figures: live records and saved history."""
    response = client.get("/v1/me/summary?period=all")
    assert response.status_code == 200, response.text
    return response.json()


def company_totals(client):
    response = client.get("/v1/admin/summary?period=all")
    assert response.status_code == 200, response.text
    return response.json()


def chat(client, credentials):
    response = client.get("/v1/me/history/" + CHAT + "/summary?period=all", headers=auth(credentials))
    assert response.status_code == 200, response.text
    return response.json()["history"]


def counts(summary):
    history = summary["history"]
    return (
        summary["request_count"],
        summary["attempt_count"],
        history["prompt_count"],
        history["response_count"],
    )


def shared_flags(app, model):
    with app.state.db.transaction(readonly=True) as s:
        return sorted((row.owner, row.company_shared) for row in s.scalars(select(model)))


def statuses(response):
    assert response.status_code == 200, response.text
    return [result["status"] for result in response.json()["results"]]


def test_a_reply_opened_by_two_members_counts_once_and_stays_with_its_sender(world):
    admin, _ = world.member("admin@example.org")
    sender, sender_keys = world.member("sender@example.org")
    reader, reader_keys = world.member("reader@example.org")
    request, attempt = sent(world.now[0])
    assert statuses(live(sender, sender_keys, [request, attempt], [(request, PROMPT), (attempt, REPLY)])) == [
        "applied",
        "applied",
    ]
    prompt, reply = opened(world.now[0])
    assert statuses(
        saved(reader, reader_keys, world.now[0], [prompt, reply], [(prompt, PROMPT), (reply, REPLY)])
    ) == [
        "applied",
        "applied",
    ]
    # The company counts the prompt and the reply once, from the sender's live records.
    assert counts(company_totals(admin)) == ("1", "1", "0", "0")
    assert counts(period(sender)) == ("1", "1", "0", "0")
    # The reader's own period figures leave the shared reply to its sender.
    assert counts(period(reader)) == ("0", "0", "0", "0")
    # The reader's view of the chat still shows what the chat holds.
    view = chat(reader, reader_keys)
    assert (view["prompt_count"], view["response_count"]) == ("1", "1")
    with world.app.state.db.transaction(readonly=True) as s:
        rows = list(s.scalars(select(HistoryObservation)))
        assert {row.company_shared for row in rows} == {True}
        assert not any(record.company_shared for record in s.scalars(select(Observation)))
        stored = [row.company_key for row in rows] + [r.company_key for r in s.scalars(select(Observation))]
        # The server keeps only its own hash; the browser's key is nowhere in the database.
        company = get(s, "company", world.company.id)
        assert set(stored) == {server_key(world.app.state.service, company, k) for k in (PROMPT, REPLY)}
        dump = json.dumps(
            [row.payload for row in rows]
            + [record.payload for record in s.scalars(select(Observation))]
            + [company.data]
        )
        assert PROMPT not in dump and REPLY not in dump


def test_a_lone_members_keyed_requests_are_listed_and_counted_with_shared_false(world):
    """`company_shared` false means the record counts; the Activity page never filters on it.

    Live check of 14 Oct 2026: one member in organization mode, every row false. The member's own
    saved copy of the same reply, named by the same company key, does not take the request away.
    """
    admin, keys = world.member("admin@example.org")
    request, attempt = sent(world.now[0])
    live(admin, keys, [request, attempt], [(request, PROMPT), (attempt, REPLY)])
    prompt, reply = opened(world.now[0])
    saved(admin, keys, world.now[0], [prompt, reply], [(prompt, PROMPT), (reply, REPLY)])
    assert {flag for _, flag in shared_flags(world.app, Observation)} == {False}
    # The website asks for a calendar window like this one (period=custom, exclusive end date).
    listing = admin.get("/v1/admin/activity?period=custom&start=2026-08-12&end=2026-09-11")
    assert listing.status_code == 200, listing.text
    assert listing.json()["request_count"] == "1"
    assert counts(company_totals(admin))[:2] == ("1", "1")


def test_without_keys_each_members_copy_still_counts(world):
    admin, _ = world.member("admin@example.org")
    sender, sender_keys = world.member("sender@example.org")
    reader, reader_keys = world.member("reader@example.org")
    request, attempt = sent(world.now[0])
    live(sender, sender_keys, [request, attempt])
    prompt, reply = opened(world.now[0])
    saved(reader, reader_keys, world.now[0], [prompt, reply])
    # Records made before keys existed (or by an older extension) are never merged.
    assert counts(company_totals(admin)) == ("1", "1", "1", "1")
    assert counts(period(reader)) == ("0", "0", "1", "1")


def test_a_saved_copy_counted_first_hands_over_when_the_sender_uploads(world):
    admin, _ = world.member("admin@example.org")
    sender, sender_keys = world.member("sender@example.org")
    reader, reader_keys = world.member("reader@example.org")
    prompt, reply = opened(world.now[0])
    saved(reader, reader_keys, world.now[0], [prompt, reply], [(prompt, PROMPT), (reply, REPLY)])
    assert counts(period(reader)) == ("0", "0", "1", "1")
    request, attempt = sent(world.now[0])
    live(sender, sender_keys, [request, attempt], [(request, PROMPT), (attempt, REPLY)])
    assert counts(period(reader)) == ("0", "0", "0", "0")
    assert counts(period(sender)) == ("1", "1", "0", "0")
    assert counts(company_totals(admin)) == ("1", "1", "0", "0")


def test_an_unchanged_saved_copy_sent_again_with_its_keys_joins_the_count(world):
    admin, _ = world.member("admin@example.org")
    sender, sender_keys = world.member("sender@example.org")
    reader, reader_keys = world.member("reader@example.org")
    request, attempt = sent(world.now[0])
    live(sender, sender_keys, [request, attempt], [(request, PROMPT), (attempt, REPLY)])
    # Saved before the reader's browser had the company key: both copies count.
    prompt, reply = opened(world.now[0])
    assert statuses(saved(reader, reader_keys, world.now[0], [prompt, reply])) == ["applied", "applied"]
    assert counts(company_totals(admin)) == ("1", "1", "1", "1")
    # Reopened unchanged once the key arrived, the copies are sent again beside their keys.
    keys = [(prompt, PROMPT), (reply, REPLY)]
    assert statuses(saved(reader, reader_keys, world.now[0], [prompt, reply], keys)) == [
        "duplicate",
        "duplicate",
    ]
    assert counts(company_totals(admin)) == ("1", "1", "0", "0")
    assert counts(period(reader)) == ("0", "0", "0", "0")
    assert counts(period(sender)) == ("1", "1", "0", "0")


def test_without_a_live_copy_the_first_member_who_opened_a_complete_copy_counts_it(world):
    admin, _ = world.member("admin@example.org")
    first, first_keys = world.member("first@example.org")
    second, second_keys = world.member("second@example.org")
    world.now[0] += timedelta(minutes=1)
    # The first member opened the chat while the reply was still incomplete.
    early = opened(world.now[0], complete=False)
    saved(first, first_keys, world.now[0], list(early), [(early[0], PROMPT), (early[1], REPLY)])
    world.now[0] += timedelta(minutes=1)
    later = opened(world.now[0])
    saved(second, second_keys, world.now[0], list(later), [(later[0], PROMPT), (later[1], REPLY)])
    # The complete copy counts the reply; the prompt goes to the first who opened it.
    assert counts(period(first)) == ("0", "0", "1", "0")
    assert counts(period(second)) == ("0", "0", "0", "1")
    assert counts(company_totals(admin)) == ("0", "0", "1", "1")
    # Once the first member's copy is complete too, the first opener counts both.
    world.now[0] += timedelta(minutes=1)
    full = deepcopy(early[1])
    full["text_complete"] = True
    full["coverage_reasons"] = ["history_only"]
    full["observed_at"] = instant(world.now[0])
    assert statuses(saved(first, first_keys, world.now[0], [full], [(full, REPLY)])) == ["applied"]
    assert counts(period(first)) == ("0", "0", "1", "1")
    assert counts(period(second)) == ("0", "0", "0", "0")
    assert counts(company_totals(admin)) == ("0", "0", "1", "1")


def test_erasing_the_counted_copy_hands_the_reply_to_another_members_copy(world):
    admin, _ = world.member("admin@example.org")
    sender, sender_keys = world.member("sender@example.org")
    reader, reader_keys = world.member("reader@example.org")
    request, attempt = sent(world.now[0])
    live(sender, sender_keys, [request, attempt], [(request, PROMPT), (attempt, REPLY)])
    prompt, reply = opened(world.now[0])
    saved(reader, reader_keys, world.now[0], [prompt, reply], [(prompt, PROMPT), (reply, REPLY)])
    assert counts(company_totals(admin)) == ("1", "1", "0", "0")
    preview = admin.post(
        "/v1/admin/deletions/preview", json={"scope": "user", "user_id": sender_keys["user_id"]}
    )
    assert preview.status_code == 200, preview.text
    operation = str(uuid4())
    erased = admin.post(
        "/v1/admin/deletions",
        json={
            "preview_token": preview.json()["preview_token"],
            "idempotency_key": operation,
            "confirmed": True,
            "reauth_token": reauth(world.app, world.company, world.admin),
        },
    )
    assert erased.status_code == 200, erased.text
    finish_job(world.app, world.company, operation)
    # The reader's copy now counts the prompt and the reply, once.
    assert counts(period(reader)) == ("0", "0", "1", "1")
    assert counts(company_totals(admin)) == ("0", "0", "1", "1")
    assert shared_flags(world.app, HistoryObservation) == [
        (reader_keys["user_id"], False),
        (reader_keys["user_id"], False),
    ]


def test_erasing_a_live_reply_without_a_key_also_erases_its_saved_copy_and_hands_the_key_over(world):
    admin, _ = world.member("admin@example.org")
    sender, sender_keys = world.member("sender@example.org")
    reader, reader_keys = world.member("reader@example.org")
    sent_at = world.now[0]
    request, attempt = sent(sent_at)
    attempt["provider_attempt_key"] = "d" * 64
    # Sent before the sender's browser had the company key, so the live reply has none.
    assert statuses(live(sender, sender_keys, [request, attempt])) == ["applied", "applied"]
    # Minutes later both members open the chat; the sender's saved reply is that reply.
    world.now[0] += timedelta(minutes=6)
    _, reply = opened(world.now[0])
    reply["provider_attempt_key"] = "d" * 64
    assert statuses(saved(sender, sender_keys, world.now[0], [reply], [(reply, REPLY)])) == ["applied"]
    world.now[0] += timedelta(minutes=1)
    _, copy = opened(world.now[0])
    assert statuses(saved(reader, reader_keys, world.now[0], [copy], [(copy, REPLY)])) == ["applied"]
    assert shared_flags(world.app, HistoryObservation) == sorted(
        [(sender_keys["user_id"], False), (reader_keys["user_id"], True)]
    )
    # Erasing the sender's live records up to three minutes after the send also erases the
    # saved copy of the erased reply (the tombstone hides it), and the reader's copy counts.
    preview = admin.post(
        "/v1/admin/deletions/preview",
        json={
            "scope": "range",
            "user_id": sender_keys["user_id"],
            "start": instant(sent_at - timedelta(minutes=1)),
            "end": instant(sent_at + timedelta(minutes=3)),
        },
    )
    assert preview.status_code == 200, preview.text
    operation = str(uuid4())
    erased = admin.post(
        "/v1/admin/deletions",
        json={
            "preview_token": preview.json()["preview_token"],
            "idempotency_key": operation,
            "confirmed": True,
            "reauth_token": reauth(world.app, world.company, world.admin),
        },
    )
    assert erased.status_code == 200, erased.text
    finish_job(world.app, world.company, operation)
    assert shared_flags(world.app, HistoryObservation) == [(reader_keys["user_id"], False)]
    assert counts(company_totals(admin))[3] == "1"
    maintenance.run(world.app.state.service)
    assert verify_restored(world.app.state.service)["status"] == "passed"


def test_a_live_copy_that_loses_moves_its_rollup_contribution_both_ways(world):
    admin, _ = world.member("admin@example.org")
    one, one_keys = world.member("one@example.org")
    two, two_keys = world.member("two@example.org")
    early, late = world.now[0], world.now[0] + timedelta(seconds=5)
    # The first copy's reasoning was not read, so it measured the reply only in part.
    first_request, first_attempt = sent(world.now[0], started=early)
    assert first_attempt["tokens"]["output_total"]["completeness"] == "partial"
    second_request, second_attempt = sent(world.now[0], started=late)
    measured_in_full(second_attempt)
    live(one, one_keys, [first_request, first_attempt], [(first_attempt, REPLY)])
    assert counts(period(one)) == ("1", "1", "0", "0")
    # A complete measurement beats a partial one, even when it started later.
    live(two, two_keys, [second_request, second_attempt], [(second_attempt, REPLY)])
    assert counts(period(one)) == ("1", "0", "0", "0")
    assert counts(period(two)) == ("1", "1", "0", "0")
    assert counts(company_totals(admin)) == ("2", "1", "0", "0")
    # Measured in full later, the earlier copy wins back the reply.
    revised = measured_in_full(deepcopy(first_attempt))
    revised["revision"] = 2
    assert statuses(live(one, one_keys, [revised], [(revised, REPLY)])) == ["applied"]
    assert counts(period(one)) == ("1", "1", "0", "0")
    assert counts(period(two)) == ("1", "0", "0", "0")
    assert counts(company_totals(admin)) == ("2", "1", "0", "0")
    breakdown = admin.get("/v1/admin/breakdown?period=all&group_by=site").json()["items"]
    assert [(item["request_count"], item["attempt_count"]) for item in breakdown] == [("2", "1")]
    # Every daily rollup equals a fresh rebuild from the records, so nothing drifted.
    analytics = world.app.state.service.analytics
    with world.app.state.db.transaction(readonly=True) as s:
        company = get(s, "company", world.company.id)
        rollups = list(s.scalars(select(TABLES["rollup"])))
        assert rollups
        for rollup in rollups:
            owner = get(s, "member", rollup.owner, company.id)
            expected = analytics.day_value(s, company, owner, rollup.day, rollup.site, rollup.model)
            assert digest(canonical(expected)) == rollup.data["checksum"]


def test_copies_rank_by_evidence_then_live_before_saved_then_earliest():
    def attempt(state, total, at="2026-09-10T12:00:00.000Z", owner="b"):
        payload = {"state": state, "tokens": {"output_total": total}}
        return type(
            "Record",
            (),
            {"kind": "attempt", "payload": payload, "occurred_at": at, "owner": owner, "id": "1"},
        )

    def copy(total, complete=True, at="2026-09-10T11:00:00.000Z", owner="a", role="response"):
        payload = {"role": role, "text_complete": complete, "tokens": total}
        return type("Row", (), {"payload": payload, "observed_at": at, "owner": owner, "message_key": "k"})

    def total(value, evidence="heuristic_estimate", completeness="complete_for_scope"):
        return {"value": value, "evidence": evidence, "completeness": completeness}

    exact = total("9", "provider_reported", "partial")
    full, part, none = total("9"), total("5", completeness="partial"), total(None, "unknown", "unknown")
    order = [
        live_rank(attempt("completed", exact)),
        saved_rank(copy(exact)),
        live_rank(attempt("completed", full, at="2026-09-10T12:00:05.000Z")),
        live_rank(attempt("cancelled", full, at="2026-09-10T12:00:06.000Z")),
        # Cut off or still running: whatever was read is only part of the reply.
        live_rank(attempt("interrupted_unconfirmed", full)),
        live_rank(attempt("generating", full, at="2026-09-10T12:00:01.000Z")),
        live_rank(attempt("completed", part, at="2026-09-10T12:00:02.000Z")),
        # A measured live copy stays ahead of saved ones, so the sender keeps the reply.
        saved_rank(copy(full)),
        saved_rank(copy(full, complete=False)),
        saved_rank(copy(part, at="2026-09-10T11:00:01.000Z")),
        # A live copy that measured nothing gives way to any measured saved copy.
        live_rank(attempt("completed", none)),
        saved_rank(copy(none)),
    ]
    assert order == sorted(order)
    assert len(set(order)) == len(order)
    # A prompt sent live ranks as complete, ahead of any saved copy that is not exact.
    prompt = type(
        "Record", (), {"kind": "request", "payload": {}, "occurred_at": "x", "owner": "b", "id": "2"}
    )
    assert live_rank(prompt) < saved_rank(copy(total("4"), role="prompt"))


def test_a_live_copy_that_measured_nothing_gives_the_reply_to_a_measured_saved_copy(world):
    admin, _ = world.member("admin@example.org")
    sender, sender_keys = world.member("sender@example.org")
    reader, reader_keys = world.member("reader@example.org")
    request, attempt = sent(world.now[0])
    attempt["state"] = "failed"
    attempt["tokens"]["answer_output"] = {
        "value": None,
        "evidence": "unknown",
        "scope": "observed_text",
        "completeness": "unknown",
        "profile_id": None,
        "reason": "provider_usage_unavailable",
    }
    attempt["tokens"]["output_total"] = compose_output_total(attempt["tokens"])
    assert attempt["tokens"]["output_total"]["value"] is None
    live(sender, sender_keys, [request, attempt], [(request, PROMPT), (attempt, REPLY)])
    assert counts(period(sender)) == ("1", "1", "0", "0")
    prompt, reply = opened(world.now[0])
    saved(reader, reader_keys, world.now[0], [prompt, reply], [(prompt, PROMPT), (reply, REPLY)])
    # The sender keeps the prompt it sent; the reply counts from the copy that measured it.
    assert counts(period(sender)) == ("1", "0", "0", "0")
    assert counts(period(reader)) == ("0", "0", "0", "1")
    assert counts(company_totals(admin)) == ("1", "0", "0", "1")
    analytics = world.app.state.service.analytics
    with world.app.state.db.transaction(readonly=True) as s:
        company = get(s, "company", world.company.id)
        for rollup in s.scalars(select(TABLES["rollup"])):
            owner = get(s, "member", rollup.owner, company.id)
            expected = analytics.day_value(s, company, owner, rollup.day, rollup.site, rollup.model)
            assert digest(canonical(expected)) == rollup.data["checksum"]


def test_a_member_whose_records_all_count_elsewhere_needs_no_rollups_to_restore(world):
    admin, _ = world.member("admin@example.org")
    one, one_keys = world.member("one@example.org")
    two, two_keys = world.member("two@example.org")
    first = sent(world.now[0])
    second = sent(world.now[0] + timedelta(seconds=5))
    for client, keys, (request, attempt) in ((one, one_keys, first), (two, two_keys, second)):
        live(client, keys, [request, attempt], [(request, PROMPT), (attempt, REPLY)])
    # The earlier copies count; the second member keeps none in period totals.
    assert counts(period(one)) == ("1", "1", "0", "0")
    assert counts(period(two)) == ("0", "0", "0", "0")
    assert counts(company_totals(admin)) == ("1", "1", "0", "0")
    with world.app.state.db.transaction(readonly=True) as s:
        owners = {rollup.owner for rollup in s.scalars(select(TABLES["rollup"]))}
    assert owners == {one_keys["user_id"]}
    # The restore gate asks for rollups of counted records only. Maintenance first writes the
    # erasure journal the gate replays, as before any restore.
    maintenance.run(world.app.state.service)
    assert verify_restored(world.app.state.service)["status"] == "passed"


def test_the_restore_gate_checks_which_copy_counts_by_the_election_rules(world):
    one, one_keys = world.member("one@example.org")
    two, two_keys = world.member("two@example.org")
    first = sent(world.now[0])
    second = sent(world.now[0] + timedelta(seconds=5))
    for client, keys, (request, attempt) in ((one, one_keys, first), (two, two_keys, second)):
        live(client, keys, [request, attempt], [(request, PROMPT), (attempt, REPLY)])
    maintenance.run(world.app.state.service)
    assert verify_restored(world.app.state.service)["status"] == "passed"
    # A restore whose flags count both copies, or neither, with rollups rebuilt to agree.
    for shared in (False, True):
        with world.app.state.db.transaction() as s:
            for record in s.scalars(select(Observation)):
                record.company_shared = shared
            company = get(s, "company", world.company.id)
            company.data = {**company.data, "aggregate_status": "rebuilding"}
        with pytest.raises(RestoreVerificationError) as error:
            verify_restored(world.app.state.service)
        assert error.value.code == "restore_company_count_inconsistent"


def test_the_restore_gate_checks_company_keys_page_by_page(world, monkeypatch):
    one, one_keys = world.member("one@example.org")
    two, two_keys = world.member("two@example.org")
    first = sent(world.now[0])
    second = sent(world.now[0] + timedelta(seconds=5))
    for client, keys, (request, attempt) in ((one, one_keys, first), (two, two_keys, second)):
        live(client, keys, [request, attempt], [(request, PROMPT), (attempt, REPLY)])
    # Both members also opened a reply that only saved copies carry; the second member's
    # saved prompt carries a key that live records carry too.
    for client, keys, keyed in ((one, one_keys, (1,)), (two, two_keys, (0, 1))):
        world.now[0] += timedelta(minutes=1)
        rows = opened(world.now[0])
        saved(client, keys, world.now[0], list(rows), [(rows[i], (PROMPT, OTHER)[i]) for i in keyed])
    with world.app.state.db.transaction(readonly=True) as s:
        company = get(s, "company", world.company.id)
        prompt, other = (server_key(world.app.state.service, company, k) for k in (PROMPT, OTHER))
        last_live = max(
            s.scalars(select(Observation.company_key).where(Observation.company_key.is_not(None)))
        )
        assert sorted(
            r.company_shared
            for r in s.scalars(select(HistoryObservation).where(HistoryObservation.company_key == other))
        ) == [False, True]
    # One key per page, so the gate must turn pages to reach each wrong flag below.
    monkeypatch.setattr("tools.verify_restore.COMPANY_KEY_PAGE", 1)
    maintenance.run(world.app.state.service)
    assert verify_restored(world.app.state.service)["status"] == "passed"

    def flip(model, key):
        with world.app.state.db.transaction() as s:
            for record in s.scalars(select(model).where(model.company_key == key)):
                record.company_shared = not record.company_shared
            company = get(s, "company", world.company.id)
            company.data = {**company.data, "aggregate_status": "rebuilding"}

    # The last live key, a saved copy of a live key, and the key only saved rows carry.
    for model, key in ((Observation, last_live), (HistoryObservation, prompt), (HistoryObservation, other)):
        flip(model, key)
        with pytest.raises(RestoreVerificationError) as error:
            verify_restored(world.app.state.service)
        assert error.value.code == "restore_company_count_inconsistent"
        flip(model, key)
        assert verify_restored(world.app.state.service)["status"] == "passed"


@pytest.mark.parametrize("copy_first", [False, True], ids=["copy_aliased", "copy_promoted"])
def test_a_second_installation_of_the_sender_aliases_without_another_count(world, copy_first):
    admin, _ = world.member("admin@example.org")
    sender, sender_keys = world.member("sender@example.org")
    reader, reader_keys = world.member("reader@example.org")
    request, attempt = sent(world.now[0])
    request["provider_request_key"], attempt["provider_attempt_key"] = "e" * 64, "d" * 64
    # Identical copies tie on live evidence and the lower attempt id stays canonical, so
    # fixed ids decide whether the copy is aliased or promoted (as in test_completion.py).
    first, second = "00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"
    attempt["attempt_id"] = second if copy_first else first
    live(sender, sender_keys, [request, attempt], [(request, PROMPT), (attempt, REPLY)])
    prompt, reply = opened(world.now[0])
    saved(reader, reader_keys, world.now[0], [prompt, reply], [(prompt, PROMPT), (reply, REPLY)])
    # The sender's second browser records the same send and reply under its own ids.
    other, _ = connect(world.app, sender)
    copy_request, copy_attempt = sent(world.now[0])
    copy_request["provider_request_key"], copy_attempt["provider_attempt_key"] = "e" * 64, "d" * 64
    copy_attempt["attempt_id"] = first if copy_first else second
    keys = [(copy_request, PROMPT), (copy_attempt, REPLY)]
    expected = ["aliased", "applied"] if copy_first else ["aliased", "aliased"]
    assert statuses(live(sender, other, [copy_request, copy_attempt], keys)) == expected
    assert counts(company_totals(admin)) == ("1", "1", "0", "0")
    assert counts(period(sender)) == ("1", "1", "0", "0")
    assert counts(period(reader)) == ("0", "0", "0", "0")
    analytics = world.app.state.service.analytics
    with world.app.state.db.transaction(readonly=True) as s:
        company = get(s, "company", world.company.id)
        for rollup in s.scalars(select(TABLES["rollup"])):
            owner = get(s, "member", rollup.owner, company.id)
            expected_value = analytics.day_value(s, company, owner, rollup.day, rollup.site, rollup.model)
            assert digest(canonical(expected_value)) == rollup.data["checksum"]


def test_keys_travel_beside_records_and_name_only_records_of_the_upload(world):
    sender, keys = world.member("sender@example.org")
    request, attempt = sent(world.now[0])
    holding = {**request, "company_dedup_key": PROMPT}
    result = live(sender, keys, [holding])
    assert statuses(result) == ["rejected"]
    assert result.json()["results"][0]["error_code"] == "invalid_observation"
    stray = live(sender, keys, [request], [(attempt, REPLY)])
    assert stray.status_code == 422
    twice = live(sender, keys, [request], [(request, PROMPT), (request, OTHER)])
    assert twice.status_code == 422
    malformed = live(sender, keys, [request], [(request, "not-a-key")])
    assert malformed.status_code == 422
    prompt, reply = opened(world.now[0])
    inside = saved(sender, keys, world.now[0], [{**prompt, "company_dedup_key": PROMPT}])
    assert inside.status_code == 422
    unknown = saved(sender, keys, world.now[0], [prompt], [(reply, REPLY)])
    assert unknown.status_code == 422


def test_a_company_key_never_changes_once_recorded(world):
    sender, keys = world.member("sender@example.org")
    request, attempt = sent(world.now[0])
    live(sender, keys, [request, attempt], [(attempt, REPLY)])
    # A retry of the same revision naming another key is a conflict, not a duplicate.
    retried = live(sender, keys, [attempt], [(attempt, OTHER)]).json()["results"]
    assert [(r["status"], r["error_code"]) for r in retried] == [("conflict", "immutable_identity")]
    assert statuses(live(sender, keys, [attempt], [(attempt, REPLY)])) == ["duplicate"]
    assert statuses(live(sender, keys, [attempt])) == ["duplicate"]
    changed = deepcopy(attempt)
    changed["revision"] = 2
    result = live(sender, keys, [changed], [(changed, OTHER)])
    assert result.json()["results"][0]["error_code"] == "immutable_identity"
    # A later revision without its key keeps the recorded one.
    later = deepcopy(attempt)
    later["revision"] = 3
    assert statuses(live(sender, keys, [later])) == ["applied"]
    prompt, reply = opened(world.now[0])
    saved(sender, keys, world.now[0], [reply], [(reply, REPLY)])
    assert statuses(saved(sender, keys, world.now[0], [reply], [(reply, OTHER)])) == ["conflict"]
    with world.app.state.db.transaction(readonly=True) as s:
        company = get(s, "company", world.company.id)
        expected = server_key(world.app.state.service, company, REPLY)
        assert {
            r.company_key for r in s.scalars(select(Observation).where(Observation.kind == "attempt"))
        } == {expected}
        assert [row.company_key for row in s.scalars(select(HistoryObservation))] == [expected]


def test_readiness_names_the_schema_the_migrations_leave(world):
    client = TestClient(world.app, base_url=world.company.data["origin"])
    ready = client.get("/health/ready")
    assert ready.status_code == 200, ready.text
    assert ready.json() == {"status": "ready", "schema_version": 14}


def test_every_member_receives_the_same_company_key_at_enrolment_and_refresh(world):
    _, first = world.member("first@example.org")
    second_client, second = world.member("second@example.org")
    assert first["company_dedup_key"] == second["company_dedup_key"]
    assert len(first["company_dedup_key"]) >= 32
    refreshed = second_client.post(
        "/v1/auth/refresh", json={"refresh_token": second["refresh_token"], "operation_id": str(uuid4())}
    )
    assert refreshed.status_code == 200, refreshed.text
    assert refreshed.json()["company_dedup_key"] == first["company_dedup_key"]
    with world.app.state.db.transaction(readonly=True) as s:
        stored = get(s, "company", world.company.id).data["dedup_key"]
        assert first["company_dedup_key"] not in stored
        assert world.app.state.service.secrets.decrypt(stored) == first["company_dedup_key"]


def test_the_server_hash_is_scoped_to_its_company(world):
    service = world.app.state.service
    with world.app.state.db.transaction(readonly=True) as s:
        company = get(s, "company", world.company.id)
        other = type("Company", (), {"id": str(uuid4())})()
        assert server_key(service, company, REPLY) != server_key(service, other, REPLY)
        assert server_key(service, company, REPLY) != REPLY


def test_concurrent_uploads_of_one_reply_count_it_once(world):
    admin, _ = world.member("admin@example.org")
    sender, sender_keys = world.member("sender@example.org")
    reader, reader_keys = world.member("reader@example.org")
    request, attempt = sent(world.now[0])
    prompt, reply = opened(world.now[0])

    def upload_live():
        return statuses(live(sender, sender_keys, [request, attempt], [(request, PROMPT), (attempt, REPLY)]))

    def upload_saved():
        return statuses(
            saved(reader, reader_keys, world.now[0], [prompt, reply], [(prompt, PROMPT), (reply, REPLY)])
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = [executor.submit(upload_live), executor.submit(upload_saved)]
        assert [future.result() for future in results] == [["applied", "applied"], ["applied", "applied"]]
    assert counts(company_totals(admin)) == ("1", "1", "0", "0")
    assert counts(period(reader)) == ("0", "0", "0", "0")


@pytest.mark.skipif(
    not os.environ.get("AIFT_POSTGRES_TEST_URL"),
    reason="Requires explicitly supplied isolated PostgreSQL",
)
def test_postgresql_migrations_add_and_remove_the_company_columns(tmp_path):
    source = os.environ["AIFT_POSTGRES_TEST_URL"]
    schema = "aift_test_" + uuid4().hex
    engine = create_engine(source)
    with engine.begin() as connection:
        connection.execute(text('CREATE SCHEMA "' + schema + '"'))
    scoped = make_url(source).update_query_dict({"options": "-csearch_path=" + schema})
    settings = tmp_path / "settings.json"
    settings.write_text(
        json.dumps({"database_url": scoped.render_as_string(hide_password=False), "environment": "test"})
    )
    environment = {**os.environ, "AIFT_SETTINGS_FILE": str(settings)}
    workspace = Path(__file__).resolve().parents[1]

    def alembic(*arguments):
        run = subprocess.run(
            [sys.executable, "-m", "alembic", *arguments],
            cwd=workspace,
            env=environment,
            capture_output=True,
            text=True,
        )
        assert run.returncode == 0, run.stderr

    migrated = create_engine(scoped.render_as_string(hide_password=False))
    try:
        alembic("upgrade", "head")
        columns = {c["name"] for c in inspect(migrated).get_columns("canonical_observations")}
        assert {"company_key", "company_shared"} <= columns
        indexes = {i["name"] for i in inspect(migrated).get_indexes("historical_observations")}
        assert "ix_history_company_key" in indexes
        with migrated.connect() as connection:
            assert connection.execute(text("SELECT schema_version FROM transaction_guard")).scalar_one() == 14
        alembic("downgrade", "0011")
        columns = {c["name"] for c in inspect(migrated).get_columns("historical_observations")}
        assert "company_key" not in columns and "company_shared" not in columns
        alembic("upgrade", "head")
    finally:
        migrated.dispose()
        with engine.begin() as connection:
            connection.execute(text('DROP SCHEMA "' + schema + '" CASCADE'))
        engine.dispose()
