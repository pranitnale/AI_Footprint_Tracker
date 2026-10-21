"""
A summary reads in bulk what it once read per saved message, with the same answers (14 October
2026). The administrator's 30-day summary took 5 to 37 s on production: each saved message was
matched to its live records with several queries, and each of the 42 day, tool and model splits
read and attributed its saved messages again. history_matching.prefetch now reads the live
records of all of a summary's messages at once, the splits take their rows from the period the
summary read (HistoricalUsage.period), and the distinct people and installations of every split
come from one read each. These tests compare that path with matching every message on its own,
and with the reference path without any request memo, on data with the cases matching treats
differently.
"""

from contextlib import contextmanager
from datetime import timedelta
from uuid import uuid4

from conftest import PERSON_ANALYTICS
from organization_dataset import build, eco, key
from sqlalchemy import select, update
from test_analytics import observations, upload
from test_historical_usage import message, page, send
from test_perplexity_identity import records_for, statuses
from test_summary_performance import MONTH, fetch, forget, unoptimised

from aift import history_matching
from aift.analytics import Analytics
from aift.db import DeletionTombstone, HistoryObservation, HistoryTombstone, Observation, put
from aift.historical_usage import HistoricalUsage
from aift.security import instant

CLAUDE_CHAT = key("conversation", 0, 1)
PROMPT_KEYED_CHAT = key("request keyed chat", 2)
BRANCH_CHAT = key("branch chat", 3)
REGENERATED, REGENERATED_LIVE = key("regenerated", 0), key("regenerated live", 0)
KEYED_PROMPT, KEYED_REPLY = key("keyed prompt", 2), key("keyed reply", 2)


@contextmanager
def row_by_row(monkeypatch):
    """The request memo without the bulk reads: every saved message is matched on its own and
    every split reads its own rows and counts its own people and installations."""
    with monkeypatch.context() as patch:
        patch.setattr(history_matching, "prefetch", lambda session, rows: None)
        patch.setattr(HistoricalUsage, "period", lambda self, *args: None)
        patch.setattr(Analytics, "active_users", lambda self, *args: None)
        patch.setattr(Analytics, "active_installations", lambda self, *args: None)
        yield


def saved_reply(end, message_key, conversation, prompt, attempt_key, when, site="claude", model="claude-opus-4-8"):
    record = message(end, message_key)
    method = eco()
    record.update(
        site=site,
        conversation_key=conversation,
        parent_key=prompt,
        prompt_key=prompt,
        provider_attempt_key=attempt_key,
        occurred_at=instant(when),
        model_id=model,
        proposed_method_id=method["method_id"],
        proposed_method_hash=method["method_hash"],
    )
    return record


def send_page(client, credentials, end, site, conversation, records, **coverage):
    body = page(end, records)
    body.update(site=site, conversation_key=conversation, **coverage)
    result = send(client, credentials, body)
    assert result.status_code == 200, result.text
    assert all(r["status"] == "applied" for r in result.json()["results"]), result.text


def enrich(setup, people):
    """
    Adds to the organization the cases matching treats differently: regenerated Claude replies
    (one recorded live), a saved prompt matched by its request key, a chat with a selected branch,
    copies another member's record counts, a conflicting row, explicit and retention erasures of
    saved and live records, and a retention cutoff between the live records saved replies name.
    Returns the saved messages whose matching the scenario decides.
    """
    app, _, company, _, now, _ = setup
    end = now[0]
    (admin, admin_keys), (person, person_keys), (third, third_keys) = people[0], people[2], people[3]
    owner = user_ids(setup, people)

    # Two more replies to the first prompt of a saved Claude chat, the second recorded live.
    request, attempt = observations(end - timedelta(days=2), "120")
    request.update(site="claude", conversation_key=CLAUDE_CHAT, model_id="claude-opus-4-8")
    request["model_evidence"] = "response_field"
    attempt["provider_attempt_key"] = key("regenerated attempt", 0)
    assert statuses(upload(admin, admin_keys, [request, attempt])) == ["applied", "applied"]
    prompt = key("message", 0, 1, 0)
    send_page(
        admin,
        admin_keys,
        end,
        "claude",
        CLAUDE_CHAT,
        [
            saved_reply(end, REGENERATED, CLAUDE_CHAT, prompt, key("never captured", 0), end - timedelta(days=3)),
            saved_reply(
                end, REGENERATED_LIVE, CLAUDE_CHAT, prompt, attempt["provider_attempt_key"], end - timedelta(days=2)
            ),
        ],
    )

    # A Perplexity prompt matched by its request key, and its reply by its attempt key.
    # Refreshed credentials carry no identity key; any key derives valid provider keys.
    hmac_key = {"user_hmac_key": "5" * 64}
    request, attempt = records_for(hmac_key, end - timedelta(days=4), str(uuid4()), str(uuid4()))
    assert statuses(upload(person, person_keys, [request, attempt])) == ["applied", "applied"]
    keyed_prompt = message(end, KEYED_PROMPT, "prompt")
    keyed_prompt.update(
        site="perplexity",
        conversation_key=PROMPT_KEYED_CHAT,
        provider_request_key=request["provider_request_key"],
        occurred_at=instant(end - timedelta(days=4)),
    )
    keyed_reply = saved_reply(
        end,
        KEYED_REPLY,
        PROMPT_KEYED_CHAT,
        KEYED_PROMPT,
        attempt["provider_attempt_key"],
        end - timedelta(days=4),
        site="perplexity",
        model=None,
    )
    keyed_reply["provider_request_key"] = request["provider_request_key"]
    send_page(person, person_keys, end, "perplexity", PROMPT_KEYED_CHAT, [keyed_prompt, keyed_reply])

    # A chat whose second prompt was edited: the selected branch ends at the edited reply.
    branch = []
    for name, parent, role in (
        ("p0", None, "prompt"),
        ("r1", "p0", "response"),
        ("p2", "r1", "prompt"),
        ("r3", "p2", "response"),
        ("p2b", "r1", "prompt"),
        ("r3b", "p2b", "response"),
    ):
        record = message(end, key("branch", name), role)
        record.update(
            site="chatgpt",
            conversation_key=BRANCH_CHAT,
            parent_key=key("branch", parent) if parent else None,
            occurred_at=instant(end - timedelta(days=3, minutes=len(branch))),
        )
        if role == "response":
            record["prompt_key"] = record["parent_key"]
            record["model_id"] = "chatgpt-gpt-5-6-sol"
        branch.append(record)
    send_page(
        third,
        third_keys,
        end,
        "chatgpt",
        BRANCH_CHAT,
        branch,
        branch_scope="selected_branch",
        selected_leaf_key=key("branch", "r3b"),
        root_message_key=key("branch", "p0"),
        first_request_verified=True,
    )

    with app.state.db.transaction(scope=company.id) as s:
        def attempt_record(index, n):
            return s.scalar(
                select(Observation).where(
                    Observation.tenant == company.id,
                    Observation.kind == "attempt",
                    Observation.stable_key == key("attempt", index, n),
                )
            )

        # Copies another member's record counts: left out of period figures, kept in chats.
        h = HistoryObservation
        s.execute(
            update(h)
            .where(h.owner == owner[2], h.message_key.in_([key("message", 2, 0, 3), key("message", 2, 0, 4)]))
            .values(company_shared=True)
        )
        shared = attempt_record(4, 3)
        s.execute(
            update(Observation)
            .where(Observation.owner == owner[4], Observation.id.in_([shared.id, shared.parent]))
            .values(company_shared=True)
        )
        s.execute(
            update(h).where(h.owner == owner[0], h.message_key == key("message", 0, 2, 3)).values(status="conflict")
        )
        # Erased live records: by record only, by provider key (which hides the saved reply too),
        # and by a retention purge (which keeps the saved reply visible but unmatched).
        for index, n, stable, reason in ((0, 2, False, "explicit"), (2, 2, True, "explicit"), (3, 2, True, "retention")):
            record = attempt_record(index, n)
            s.add(
                DeletionTombstone(
                    tenant=company.id,
                    owner=record.owner,
                    kind="attempt",
                    record_id=record.id,
                    epoch=0,
                    stable_key=record.stable_key if stable else None,
                    reason=reason,
                )
            )
        s.add(HistoryTombstone(tenant=company.id, owner=owner[3], message_key=key("message", 3, 2, 5), epoch=0))
        # An explicit range erasure of one person, and a retention one of another person.
        for person_id, start, stop, retention in (
            (owner[4], end - timedelta(days=23, hours=12), end - timedelta(days=22), False),
            (owner[3], end - timedelta(days=22, hours=6), end - timedelta(days=22), True),
        ):
            job = str(uuid4())
            marker = {
                "scope": "range",
                "user_id": person_id,
                "start": instant(start),
                "end": instant(stop),
                "epoch": 0,
                "created_at": instant(end),
                "record_ids": [],
                "record_owners": {},
                "job_id": job,
                **({"retention": True} if retention else {}),
            }
            put(s, "deletion", job, marker, company.id, person_id)
        # Live records before this cutoff no longer match: the first two days of linked replies.
        put(s, "retention", company.id, {"cutoff": instant(end - timedelta(days=23, hours=6))}, company.id)
    return {
        "matched": [(owner[0], REGENERATED_LIVE), (owner[2], KEYED_PROMPT), (owner[2], KEYED_REPLY)],
        "unmatched": [
            (owner[0], REGENERATED),
            # Before the retention cutoff.
            (owner[0], key("message", 0, 0, 1)),
            (owner[0], key("message", 0, 1, 1)),
            # The attempt was erased by record id, and by a retention purge.
            (owner[0], key("message", 0, 2, 1)),
            (owner[3], key("message", 3, 2, 1)),
            # Inside the explicit range erasure, and the retention one.
            (owner[4], key("message", 4, 2, 1)),
            (owner[3], key("message", 3, 3, 1)),
        ],
        "still matched": [(owner[0], key("message", 0, 3, 1)), (owner[2], key("message", 2, 3, 1))],
    }


def user_ids(setup, people):
    """Each installation's person: the owner of its first saved message. The administrator's
    second installation (index 1) saved none."""
    with setup[0].state.db.transaction(readonly=True) as s:
        owners = [
            s.scalar(select(HistoryObservation.owner).where(HistoryObservation.message_key == key("message", n, 0, 0)))
            for n in range(len(people))
        ]
    owners[1] = owners[0]
    return owners


def described(found):
    return None if found is None else (found[0].id, found[1].id if found[1] is not None else None)


def test_bulk_matching_resolves_every_saved_message_as_matching_it_alone_does(setup):
    admin, people = build(setup, live_per_member=16, conversations_per_member=4, messages=12)
    cases = enrich(setup, people)
    app, _, company, _, _, _ = setup
    visible = HistoricalUsage(None).visible(None)
    with app.state.db.transaction(readonly=True) as s:
        rows = list(s.scalars(select(HistoryObservation).order_by(HistoryObservation.message_key)))
        seen = {(r.owner, r.message_key) for r in s.scalars(select(HistoryObservation).where(visible))}
        shown = [r for r in rows if (r.owner, r.message_key) in seen]
        assert len(shown) < len(rows) and any(r.status == "conflict" for r in shown)
        alone = {(r.owner, r.message_key): described(history_matching.resolve_history_live(s, r)) for r in rows}
        # Both later replies to the chat's first prompt regenerated it; one was recorded live.
        regenerated = HistoricalUsage(None).regenerated(s, company, shown)
        assert {cases["matched"][0], cases["unmatched"][0]} <= regenerated
        answers = {}
        for bulk in (False, True):
            with history_matching.read_memo(s):
                history_matching.seed_visible_rows(s, shown)
                if bulk:
                    history_matching.prefetch(s, rows)
                answers[bulk] = {
                    (r.owner, r.message_key): described(history_matching.resolve_history_live(s, r)) for r in rows
                }
    assert answers[True] == alone and answers[False] == alone
    assert all(alone[case] is not None for case in cases["matched"] + cases["still matched"]), alone
    assert all(alone[case] is None for case in cases["unmatched"]), cases
    assert alone[cases["matched"][1]][1] is None and alone[cases["matched"][2]][1] is not None
    assert sum(found is not None for found in alone.values()) >= 5


@PERSON_ANALYTICS
def test_summaries_with_bulk_reads_equal_row_by_row_and_unoptimised_summaries(setup, monkeypatch):
    admin, people = build(setup, live_per_member=16, conversations_per_member=4, messages=12)
    enrich(setup, people)
    users = sorted(set(user_ids(setup, people)))
    member, member_keys = people[2]
    calls = {
        "admin, 30 days": (admin, "/v1/admin/summary", MONTH, None),
        "admin, this month": (admin, "/v1/admin/summary", {"period": "month"}, None),
        "admin, all time": (admin, "/v1/admin/summary", {"period": "all"}, None),
        "admin, one tool": (admin, "/v1/admin/summary", {**MONTH, "site": "claude"}, None),
        "admin, one model": (admin, "/v1/admin/summary", {**MONTH, "model": "claude-opus-4-8"}, None),
        "admin, no model": (admin, "/v1/admin/summary", {**MONTH, "model": "unknown"}, None),
        "member, organization": (member, "/v1/company/summary", MONTH, member_keys),
        **{
            f"admin, person {n}": (admin, "/v1/admin/summary", {**MONTH, "user_id": user}, None)
            for n, user in enumerate(users)
        },
        **{
            f"own, person {n}": (client, "/v1/me/summary", MONTH, credentials)
            for n, (client, credentials) in enumerate(people)
        },
        "own, one tool": (people[0][0], "/v1/me/summary", {**MONTH, "site": "claude"}, people[0][1]),
        "live chat": (
            people[0][0],
            "/v1/me/conversations/" + CLAUDE_CHAT + "/summary",
            {"period": "all"},
            people[0][1],
        ),
        **{
            f"saved chat {name}": (client, "/v1/me/history/" + chat + "/summary", {"period": "all"}, credentials)
            for name, (client, credentials), chat in (
                ("regenerated", people[0], CLAUDE_CHAT),
                ("request key", people[2], PROMPT_KEYED_CHAT),
                ("branch", people[3], BRANCH_CHAT),
                ("shared", people[2], key("conversation", 2, 0)),
            )
        },
    }
    with unoptimised(monkeypatch):
        expected = {name: fetch(*call) for name, call in calls.items()}
    with row_by_row(monkeypatch):
        alone = {name: fetch(*call) for name, call in calls.items()}
    forget()
    bulk = {name: fetch(*call) for name, call in calls.items()}
    for name in calls:
        assert alone[name] == expected[name], name
        assert bulk[name] == expected[name], name
    # The recalculated view is compared in test_summary_performance; the records added here
    # would wait for their recalculation.
    whole = expected["admin, 30 days"]
    assert len(whole["days"]) > 10 and whole["models"] and whole["retention_cutoff"]
    history = whole["history"]
    assert int(history["matched_live_message_count"]) > 0 and int(history["conflicting_message_count"]) > 0
    assert expected["saved chat branch"]["history"]["branch_scope"] == "selected_branch"
    assert expected["saved chat branch"]["history"]["observed_prompt_count"] == "2"
