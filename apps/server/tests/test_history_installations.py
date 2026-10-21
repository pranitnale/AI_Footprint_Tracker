"""
Saved messages that two installations of one member upload under different estimation releases.

Production, 14 October 2026: a member's main browser uploaded a Perplexity Computer task's prompt
and reply under the release it had. A second browser of the same member, with a newer release,
uploaded the same saved messages later. The server treated the proposed method as part of the
message, answered "conflict" and marked its own copies as conflicts, so the task left every
organization total and both browsers' synced views.
"""

import pytest
from conftest import connect
from organization_dataset import earlier_release, eco
from sqlalchemy import select
from test_historical_usage import message, page, paired, send, summary, with_answer

from aift import engine_adapter
from aift.db import HistoryObservation
from aift.method_registry import MethodBundle
from aift.security import instant


def releases(app, now):
    """The earlier release the first browser had (archived, as the server keeps it) and the current one."""
    previous = earlier_release()
    method = engine_adapter.identity(previous)
    with app.state.db.transaction(scope="method-install") as session:
        session.add(
            MethodBundle(
                method_id=method["method_id"],
                method_hash=method["method_hash"],
                bundle=previous,
                approval={"trust": "packaged_release"},
                installed_at=instant(now),
            )
        )
    return method, eco()


def task(now, method, count="244"):
    """A saved prompt and its reply, read by a browser whose release proposes method."""
    prompt = message(now, "a" * 64, "prompt")
    reply = with_answer(message(now, "c" * 64), value=count)
    reply["parent_key"] = reply["prompt_key"] = prompt["message_key"]
    for record in (prompt, reply):
        record["proposed_method_id"] = method["method_id"]
        record["proposed_method_hash"] = method["method_hash"]
    return [prompt, reply]


def statuses(response):
    assert response.status_code == 200, response.text
    return [r["status"] for r in response.json()["results"]]


def reply_total(totals):
    """The reply's count in the summary's original view, which keeps the first receipt."""
    return next(t for t in totals["tokens"] if t["role"] == "response" and t["part"] == "total")["value"]


def stored(app):
    with app.state.db.transaction(readonly=True) as s:
        return {
            r.message_key: (r.status, r.payload["proposed_method_id"], r.payload["tokens"]["value"])
            for r in s.scalars(select(HistoryObservation))
        }


@pytest.mark.parametrize(
    "count, status, kept",
    [
        # The same read under another release adds nothing.
        ("244", "duplicate", "244"),
        # A newer release that counts more of a finished reply raises the count, as a reread does.
        ("245", "applied", "245"),
        # A lower count never lowers the stored one.
        ("243", "duplicate", "244"),
    ],
)
def test_a_second_browser_with_another_release_counts_the_saved_task_once(setup, count, status, kept):
    app, client, company, member, now, first = paired(setup)
    earlier, current = releases(app, now[0])
    assert statuses(send(client, first, page(now[0], task(now[0], earlier)))) == ["applied", "applied"]
    second, _ = connect(app, client)
    assert statuses(send(client, second, page(now[0], task(now[0], current, count)))) == ["duplicate", status]
    totals = summary(client, first)
    assert totals["conflicting_message_count"] == "0"
    assert totals["prompt_count"] == totals["response_count"] == "1"
    assert reply_total(totals) == "244"
    # The stored copies keep the first browser's method, which the server can still resolve.
    assert stored(app) == {
        "a" * 64: ("current", earlier["method_id"], "33"),
        "c" * 64: ("current", earlier["method_id"], kept),
    }


def test_a_method_only_conflict_kept_before_the_fix_clears_when_the_second_browser_sends_again(setup):
    app, client, company, member, now, first = paired(setup)
    earlier, current = releases(app, now[0])
    assert statuses(send(client, first, page(now[0], task(now[0], earlier)))) == ["applied", "applied"]
    second, _ = connect(app, client)
    # The state production kept on 14 October: the server marked both stored copies as conflicts.
    with app.state.db.transaction(scope=company.id) as s:
        for row in s.scalars(select(HistoryObservation)):
            row.status = "conflict"
    totals = summary(client, first)
    assert totals["conflicting_message_count"] == "2"
    assert totals["prompt_count"] == totals["response_count"] == "0"
    # The browser that stored the copies agreeing with itself proves nothing: they stay conflicts.
    assert statuses(send(client, first, page(now[0], task(now[0], earlier)))) == ["conflict", "conflict"]
    # The second browser sends its copies once more (ledger version 19) and the task counts again.
    assert statuses(send(client, second, page(now[0], task(now[0], current, "245")))) == [
        "duplicate",
        "applied",
    ]
    totals = summary(client, first)
    assert totals["conflicting_message_count"] == "0"
    assert totals["prompt_count"] == totals["response_count"] == "1"
    assert reply_total(totals) == "244"
    assert stored(app) == {
        "a" * 64: ("current", earlier["method_id"], "33"),
        "c" * 64: ("current", earlier["method_id"], "245"),
    }


@pytest.mark.parametrize(
    "contradict",
    [
        # A count from another counting profile is a different measurement.
        lambda reply: with_answer(reply, value="99", profile_id="cl100k-base-4.0.0-reference"),
        # A reply under another prompt is another message.
        lambda reply: {**reply, "parent_key": "d" * 64},
    ],
)
def test_a_real_conflict_between_two_browsers_stays_until_the_other_browser_agrees(setup, contradict):
    app, client, company, member, now, first = paired(setup)
    earlier, current = releases(app, now[0])
    assert statuses(send(client, first, page(now[0], task(now[0], earlier)))) == ["applied", "applied"]
    second, _ = connect(app, client)
    prompt, reply = task(now[0], current)
    contradicting = [prompt, contradict(reply)]
    for _ in range(2):
        assert statuses(send(client, second, page(now[0], contradicting))) == ["duplicate", "conflict"]
    totals = summary(client, first)
    assert totals["conflicting_message_count"] == "1"
    assert totals["response_count"] == "0"
    # The first browser's grown reread updates the stored copy, but the reply stays a conflict and
    # the first browser is told so.
    assert statuses(send(client, first, page(now[0], task(now[0], earlier, "300")))) == [
        "duplicate",
        "conflict",
    ]
    assert stored(app)["c" * 64] == ("conflict", earlier["method_id"], "300")
    # A later read of the second browser that agrees with the stored copy clears the conflict.
    assert statuses(send(client, second, page(now[0], task(now[0], current, "300")))) == [
        "duplicate",
        "duplicate",
    ]
    totals = summary(client, first)
    assert totals["conflicting_message_count"] == "0"
    assert totals["response_count"] == "1"
    assert stored(app)["c" * 64] == ("current", earlier["method_id"], "300")
