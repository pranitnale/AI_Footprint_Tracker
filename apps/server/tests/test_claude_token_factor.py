"""
Owner decision of 15 October 2026: every Claude count the tracker makes with its own o200k
tokenizer is multiplied by 1.56, part by part and rounded half up; counts a provider reports
stay. The server sums and estimates with the same rule as the extension.
"""

from copy import deepcopy
from datetime import UTC, datetime
from uuid import uuid4

from conftest import PERSON_ANALYTICS, connect, login
from footprint_contracts import compose_output_total
from test_analytics import observations, upload
from test_file_text_contract import component
from test_historical_usage import auth, message, page, paired, send

from aift import engine_adapter

REPORTED = {
    "value": "433",
    "evidence": "provider_reported",
    "scope": "provider_request",
    "completeness": "complete_for_scope",
    "profile_id": None,
    "reason": None,
}


def reply(now, site, model, count="500"):
    request, attempt = observations(now, count)
    request["site"] = site
    request["model_id"] = model
    request["model_evidence"] = "response_field" if model else "unknown"
    attempt["model_id"] = model
    attempt["model_evidence"] = "response_field" if model else "unknown"
    attempt["provider_attempt_key"] = uuid4().hex * 2
    return request, attempt


def main_output(definition, site, model, tokens=None):
    request, attempt = reply(datetime(2026, 10, 15, 12, tzinfo=UTC), site, model)
    if tokens:
        attempt["tokens"]["output_total"] = tokens
    result = engine_adapter.estimate(definition, attempt, request)
    return next(c for c in result["components"] if c["role"] == "main")["inputs"]["output_tokens"]


def test_the_packaged_method_names_the_factor():
    factor = engine_adapter.packaged_claude_token_factor()
    assert factor["factor"] == "1.56"
    assert factor["tokenizer_profile_id"] == "o200k-base-4.0.0-reference"
    assert factor["measured_on"] == "2026-10-15"


def test_server_estimates_use_the_factor_only_for_claude_text_and_only_under_its_method():
    definition = engine_adapter.packaged_definition()
    assert main_output(definition, "claude", "claude-opus-5-5") == "780"
    assert main_output(definition, "perplexity", "perplexity-claude-sonnet-5-5") == "780"
    assert main_output(definition, "perplexity", "perplexity-best") == "500"
    assert main_output(definition, "chatgpt", "chatgpt-gpt-5-5") == "500"
    # Cowork: Claude's own output count is estimated as reported.
    assert main_output(definition, "claude", "claude-opus-5-5", REPORTED) == "433"
    # A method saved before the factor (no claude_token_factor) keeps the tokenizer's count, and
    # it is another method.
    earlier = deepcopy(definition)
    del earlier["media"]["claude_token_factor"]
    assert engine_adapter.identity(earlier)["method_hash"] != engine_adapter.identity(definition)["method_hash"]
    assert main_output(earlier, "claude", "claude-opus-5-5") == "500"


@PERSON_ANALYTICS
def test_live_token_totals_and_request_figures_carry_the_factor(setup):
    app, admin, company, _, now, _ = setup
    login(app, admin)
    credentials, _ = connect(app, admin)
    claude = reply(now[0], "claude", "claude-opus-5-5")
    claude[1]["tokens"]["new_input_text"] = {**claude[1]["tokens"]["answer_output"], "value": "9"}
    claude[1]["tokens"]["visible_thinking"] = {**claude[1]["tokens"]["answer_output"], "value": "10"}
    claude[1]["tokens"]["output_total"] = compose_output_total(claude[1]["tokens"])
    # Text of a file sent to Claude, counted here: 100 -> 156.
    claude[0]["documents"].update(extracted_text=[component("100")], types=["text_pdf"], processing="opaque")
    chatgpt = reply(now[0], "chatgpt", "chatgpt-gpt-5-5")
    cowork = reply(now[0], "claude", "claude-opus-5-5")
    cowork[1]["tokens"]["output_total"] = REPORTED
    result = upload(admin, credentials, [*claude, *chatgpt, *cowork])
    assert all(row["status"] == "applied" for row in result.json()["results"]), result.text

    def series(site, quantity, evidence="heuristic_estimate"):
        body = admin.get("/v1/me/summary", params={"site": site}).json()
        rows = [
            t
            for t in body["tokens"]
            if t["quantity"] == quantity and t["measurement_group"]["evidence"] == evidence
        ]
        return [t["value"] for t in rows]

    # 500 -> 780 and 10 -> 16, each part rounded on its own; Out is their sum.
    assert series("claude", "answer_output") == ["1560"]
    assert series("claude", "visible_thinking") == ["16"]
    assert series("claude", "new_input_text") == ["14"]
    assert series("claude", "output_total") == ["796"]
    assert series("claude", "output_total", "provider_reported") == ["433"]
    assert series("chatgpt", "output_total") == ["500"]
    files = admin.get("/v1/me/summary", params={"site": "claude"}).json()["file_text"]
    assert [f["value"] for f in files] == ["156"]
    figures = {
        row["site"]: row["figures"]["tokens_out"]
        for row in admin.get("/v1/admin/requests").json()["items"]
        if row["site"] != "claude" or row["figures"]["tokens_in"] == "14"
    }
    assert figures == {"claude": "796", "chatgpt": "500"}


def test_saved_claude_messages_carry_the_factor_and_other_models_do_not(setup):
    app, client, company, member, now, c = paired(setup)
    records = [message(now[0], "a" * 64, "prompt"), message(now[0], "c" * 64)]
    for record in records:
        record["model_id"] = "perplexity-claude-sonnet-5-5"
    result = send(client, c, page(now[0], records))
    assert result.status_code == 200, result.text
    rows = {
        (t["role"], t["part"]): t["value"]
        for t in client.get("/v1/me/history/" + "b" * 64 + "/summary?period=all", headers=auth(c)).json()[
            "history"
        ]["tokens"]
    }
    # 33 -> 51 for the prompt and the reply (51.48).
    assert rows[("prompt", "total")] == rows[("response", "total")] == "51"
