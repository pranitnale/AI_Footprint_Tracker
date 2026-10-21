"""
The administrator's overview for a one-member organization, shaped like production on 14 October
2026: one browser whose extension was updated during the month, so its live records and saved
history propose several EcoLogits releases (mixed_methods), and saved chats that partly overlap
the live records. The website showed "Not available" for electricity, carbon and water because it
would not add releases that differ only in model mappings, and it left the saved history of a
server summary out of every figure. These tests pin what the server returns for that case, which
the website's figures (apps/web/test/admin-overview-figures.test.tsx, whose fixture holds this
scenario's numbers and method identities) rely on:

- every resource row of every release carries the same EcoLogits core, catalog, environment
  policy and boundaries, so the rows add up under the contract's comparable-method rule;
- a saved reply linked to a live attempt counts once, through the live record; every saved
  message no live record matched counts once, from history. "Unresolved overlap" only counts the
  saved messages without such a link, and they stay in the totals;
- the tool and day splits hold the same live and saved rows as the whole summary.
"""

from datetime import timedelta
from decimal import Decimal

from conftest import connect, login
from footprint_contracts import canonical_json
from organization_dataset import auth, earlier_release, eco, key, refreshed
from test_analytics import observations, upload
from test_historical_usage import message, page, send

from aift import engine_adapter
from aift.db import get
from aift.historical_usage import reply_models
from aift.method_registry import MethodBundle
from aift.security import instant

QUANTITIES = ("energy", "carbon", "water_total")


def family(method):
    """The fields that decide whether two releases add (packages/ui/src/totals.ts methodFamily)."""
    return tuple(
        method[k]
        for k in (
            "engine_id",
            "implementation_version",
            "source_version",
            "source_commit",
            "catalog_hash",
            "environment_policy_hash",
            "product_scope",
        )
    )


def addable(row):
    """The comparable key of a live series (lineage in method_group) or a saved-history row."""
    lineage = row.get("method_group") or row
    boundaries = {k: v for k, v in lineage["comparability"].items() if k != "tokenizer_profile_id"}
    return (
        family(lineage["requested_method"]),
        family(lineage["effective_method"]),
        canonical_json(boundaries),
        row["unit"],
    )


def rows(summary, quantity):
    """The rows the website adds for one quantity: live series and available saved rows."""
    live = summary["resources"]
    saved = summary["history"]["resources"] if summary["history"]["status"] == "available" else []
    return [r for r in live + saved if r["quantity"] == quantity and r["value"] is not None]


def total(summary, quantity):
    return sum((Decimal(r["value"]) for r in rows(summary, quantity)), Decimal(0))


def organization(setup):
    """One administrator with one browser, connected 20 days before the clock's day."""
    app, admin, company, _, now, _ = setup
    end = now[0]
    previous = earlier_release()
    with app.state.db.transaction(scope="method-install") as session:
        session.add(
            MethodBundle(
                method_id=engine_adapter.identity(previous)["method_id"],
                method_hash=engine_adapter.identity(previous)["method_hash"],
                bundle=previous,
                approval={"trust": "packaged_release"},
                installed_at=instant(end - timedelta(days=30)),
            )
        )
    now[0] = end - timedelta(days=20)
    login(app, admin)
    credentials = connect(app, admin)[0]
    now[0] = end
    login(app, admin)
    return app, admin, refreshed(admin, credentials), end, (eco(), engine_adapter.identity(previous))


LIVE = (
    # (site, model, release index, hours before the clock's day)
    ("chatgpt", "chatgpt-gpt-5-6-luna", 0, 30),
    ("chatgpt", "chatgpt-gpt-5-6-luna", 1, 29),
    ("claude", "claude-opus-4-8", 1, 28),
    ("claude", "claude-opus-4-8", 0, 4),
)


def live_records(end, methods):
    records = []
    for n, (site, model, release, hours) in enumerate(LIVE):
        request, attempt = observations(end - timedelta(hours=hours), str(200 + 50 * n))
        request["site"] = site
        request["conversation_key"] = key("conversation", n)
        request["model_id"] = attempt["model_id"] = model
        request["model_evidence"] = attempt["model_evidence"] = "response_field"
        attempt["provider_attempt_key"] = key("attempt", n)
        attempt["proposed_method_id"] = methods[release]["method_id"]
        records += [request, attempt]
    return records


def saved(end, site, conversation, n, method, model, when, attempt=None):
    """A saved prompt and its reply; the reply names a live attempt when one sent it."""
    prompt = message(end, key("message", conversation, n, "prompt"), "prompt")
    reply = message(end, key("message", conversation, n, "reply"), "response")
    for record in (prompt, reply):
        record["site"] = site
        record["conversation_key"] = conversation
        record["occurred_at"] = instant(when)
    reply["parent_key"] = reply["prompt_key"] = prompt["message_key"]
    reply["model_id"] = model
    reply["proposed_method_id"] = method["method_id"]
    reply["proposed_method_hash"] = method["method_hash"]
    reply["provider_attempt_key"] = attempt
    return [prompt, reply]


def history_pages(end, methods):
    pages = []
    # The saved copies of live requests 0 and 2: each reply names the attempt that sent it.
    for n in (0, 2):
        site, model, release, hours = LIVE[n]
        when = end - timedelta(hours=hours)
        pages.append(
            (
                site,
                key("conversation", n),
                saved(end, site, key("conversation", n), 0, methods[release], model, when, key("attempt", n)),
            )
        )
    # A chat from before the browser connected, saved when the person reopened it: no live record
    # can match it, so it counts from history alone. Its replies were calculated with both releases.
    old = key("conversation", "before connecting")
    messages = []
    for n in range(3):
        messages += saved(
            end, "claude", old, n, methods[n % 2], "claude-opus-4-8", end - timedelta(days=25, hours=n)
        )
    pages.append(("claude", old, messages))
    return pages


def build(setup):
    app, admin, credentials, end, methods = organization(setup)
    result = upload(admin, credentials, live_records(end, methods))
    assert result.status_code == 200, result.text
    assert all(r["status"] == "applied" for r in result.json()["results"]), result.text
    for site, conversation, messages in history_pages(end, methods):
        body = page(end, messages)
        body["site"] = site
        body["conversation_key"] = conversation
        result = send(admin, credentials, body)
        assert result.status_code == 200, result.text
        assert all(r["status"] == "applied" for r in result.json()["results"]), result.text
    return app, admin, credentials, end, methods


def overview(admin, end):
    start = (end - timedelta(days=30)).date().isoformat()
    stop = (end + timedelta(days=1)).date().isoformat()
    response = admin.get("/v1/admin/summary", params={"period": "custom", "start": start, "end": stop})
    assert response.status_code == 200, response.text
    return response.json()


def test_mixed_releases_add_and_overlapping_history_counts_once(setup):
    app, admin, credentials, end, methods = build(setup)
    whole = overview(admin, end)
    assert whole["aggregate_status"] == "current"
    assert whole["request_count"] == "4" and whole["attempt_count"] == "4"
    # Two releases among the live records: the summary flags mixed methods.
    assert whole["mixed_methods"] is True
    assert whole["method_groups"] == sorted(m["method_id"] for m in methods)

    history = whole["history"]
    # The two saved copies of live requests (a prompt and a reply each) are matched and left
    # out; the six messages of the older chat could have had a live record but none matched.
    assert history["matched_live_message_count"] == "4"
    assert history["unresolved_overlap_message_count"] == "6"
    # Unresolved messages still count, once: three requests and three replies from history.
    assert (history["prompt_count"], history["response_count"]) == ("3", "3")
    assert history["calculated_message_count"] == "6"

    for quantity in QUANTITIES:
        found = rows(whole, quantity)
        # Live series of both releases and saved rows of both releases, each with a value...
        releases = {(r.get("method_group") or r)["requested_method"]["method_hash"] for r in found}
        assert len(releases) == 2, (quantity, releases)
        # ...that all share one EcoLogits core, catalog, environment policy and boundaries, so
        # the website adds them into one figure instead of showing "Not available".
        assert len({addable(r) for r in found}) == 1, quantity

    # The history part of the total is exactly the older chat: the matched saved replies of live
    # requests 0 and 2 are not added again.
    old = admin.get(
        "/v1/me/history/" + key("conversation", "before connecting") + "/summary",
        params={"period": "all"},
        headers=auth(credentials),
    )
    assert old.status_code == 200, old.text
    chat = old.json()["history"]
    assert chat["unresolved_overlap_message_count"] == "6"
    for quantity in QUANTITIES:
        saved_total = sum(
            (Decimal(r["value"]) for r in history["resources"] if r["quantity"] == quantity and r["value"]),
            Decimal(0),
        )
        chat_total = sum(
            (Decimal(r["value"]) for r in chat["resources"] if r["quantity"] == quantity and r["value"]),
            Decimal(0),
        )
        assert saved_total == chat_total > 0, quantity
    # The saved copies of live requests add no request and no resource of their own.
    for n in (0, 2):
        linked = admin.get(
            "/v1/me/history/" + key("conversation", n) + "/summary",
            params={"period": "all"},
            headers=auth(credentials),
        ).json()["history"]
        assert linked["matched_live_message_count"] == "2"
        assert (linked["prompt_count"], linked["response_count"]) == ("0", "0")
        assert all(r["value"] is None for r in linked["resources"]) or not linked["resources"]


def test_tool_and_day_splits_hold_the_whole_overview(setup):
    app, admin, credentials, end, methods = build(setup)
    whole = overview(admin, end)
    assert set(whole["sites"]) == {"chatgpt", "claude"}
    for quantity in QUANTITIES:
        figure = total(whole, quantity)
        assert figure > 0
        assert sum((total(part, quantity) for part in whole["sites"].values()), Decimal(0)) == figure
        assert sum((total(part, quantity) for part in whole["days"].values()), Decimal(0)) == figure
        for part in [*whole["sites"].values(), *whole["days"].values(), *whole["models"].values()]:
            assert len({addable(r) for r in rows(part, quantity)}) <= 1
    # Requests: live requests plus saved requests no live record matched, in every split.
    requests = int(whole["request_count"]) + int(whole["history"]["prompt_count"])
    assert requests == 7
    assert (
        sum(int(p["request_count"]) + int(p["history"]["prompt_count"]) for p in whole["sites"].values())
        == requests
    )
    assert (
        sum(int(p["request_count"]) + int(p["history"]["prompt_count"]) for p in whole["days"].values())
        == requests
    )


def test_model_split_counts_saved_prompts_for_the_model_of_their_reply(setup):
    # The saved prompts name no model; their replies do. Until 14 October 2026 the model split
    # counted only the replies, so a model's saved replies had no request and the website's
    # figures per request were inflated.
    app, admin, credentials, end, methods = build(setup)
    whole = overview(admin, end)
    claude = whole["models"]["claude-opus-4-8"]["history"]
    assert (claude["prompt_count"], claude["response_count"]) == ("3", "3")
    requests = int(whole["request_count"]) + int(whole["history"]["prompt_count"])
    assert (
        sum(int(p["request_count"]) + int(p["history"]["prompt_count"]) for p in whole["models"].values())
        == requests
    )
    with app.state.db.transaction(readonly=True) as session:
        company = get(session, "company", setup[2].id)
        history = app.state.service.analytics.history
        # A prompt counted for its reply's model is no longer a message of no model.
        unknown = history.summary(session, company, None, query={"period": "all", "model": "unknown"})
        assert unknown["observed_prompt_count"] == "0"
        assert unknown["observed_response_count"] == "0"
        other = history.summary(
            session, company, None, query={"period": "all", "model": "chatgpt-gpt-5-6-luna"}
        )
        # The saved copy of a ChatGPT request: its prompt and reply, both matched to live records.
        assert (other["observed_prompt_count"], other["observed_response_count"]) == ("1", "1")


def test_a_prompt_answered_by_several_models_counts_for_its_first_reply():
    def reply(key, model, at):
        return {
            "role": "response",
            "prompt_key": "p",
            "message_key": key,
            "model_id": model,
            "occurred_at": at,
        }

    # The earliest dated reply that names a model, undated replies last, the lower message key on
    # a tie, as replyFirst in apps/extension/lib/usage-breakdown.ts.
    replies = [
        reply("b", "gpt-5", "2026-10-13T10:00:05.000Z"),
        reply("a", "o3", None),
        reply("c", "gpt-4o", "2026-10-13T10:00:03.000Z"),
        reply("0", None, "2026-10-13T10:00:01.000Z"),
    ]
    assert reply_models(replies) == {"p": "gpt-4o"}
    tie = [reply("e", "gpt-5", "2026-10-13T10:00:05.000Z"), reply("d", "o3", "2026-10-13T10:00:05.000000Z")]
    assert reply_models(tie) == {"p": "o3"}
    assert reply_models([reply("a", "o3", None)]) == {"p": "o3"}


def test_a_saved_chatgpt_prompt_counts_for_the_reply_under_it_without_a_prompt_key(setup):
    # Live QA of 19 October 2026: a saved ChatGPT reply names its prompt only by parent_key when
    # the two carried no shared request id, and its prompt showed "without a named model".
    app, admin, credentials, end, methods = build(setup)
    conversation = key("conversation", "no prompt key")
    messages = saved(
        end, "chatgpt", conversation, 0, methods[0], "chatgpt-gpt-5-6-luna", end - timedelta(hours=10)
    )
    messages[1]["prompt_key"] = None
    body = page(end, messages)
    body["site"] = "chatgpt"
    body["conversation_key"] = conversation
    result = send(admin, credentials, body)
    assert result.status_code == 200, result.text
    assert all(r["status"] == "applied" for r in result.json()["results"]), result.text
    whole = overview(admin, end)
    # One more saved request in the totals, counted once and for the model of its reply.
    requests = int(whole["request_count"]) + int(whole["history"]["prompt_count"])
    assert requests == 8
    luna = whole["models"]["chatgpt-gpt-5-6-luna"]["history"]
    assert (luna["prompt_count"], luna["response_count"]) == ("1", "1")
    assert (
        sum(int(p["request_count"]) + int(p["history"]["prompt_count"]) for p in whole["models"].values())
        == requests
    )
    with app.state.db.transaction(readonly=True) as session:
        company = get(session, "company", setup[2].id)
        history = app.state.service.analytics.history
        unknown = history.summary(session, company, None, query={"period": "all", "model": "unknown"})
        assert unknown["observed_prompt_count"] == "0"
        named = history.summary(
            session, company, None, query={"period": "all", "model": "chatgpt-gpt-5-6-luna"}
        )
        # The saved copy of a live request (matched) and the new prompt and reply.
        assert (named["observed_prompt_count"], named["observed_response_count"]) == ("2", "2")
        assert named["prompt_count"] == "1"
