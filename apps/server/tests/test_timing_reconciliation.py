from copy import deepcopy
from uuid import uuid4

import pytest
from conftest import PERSON_ANALYTICS, connect, login
from footprint_contracts import ContractError, payload_hash, validate_history_page, validate_observation
from footprint_estimator import BASELINE_METHOD_ID, baseline_bundle
from sqlalchemy import select
from test_analytics import observations, recompose, upload
from test_historical_usage import auth, message, page, send, with_answer

from aift import engine_adapter
from aift.db import HistoryObservation, Observation, get
from aift.engine_history import EngineEstimate, verify_overlay
from aift.history_matching import linked_history, resolve_history_live
from aift.maintenance import run
from aift.timing_evidence import merge_history_evidence, select_output, select_timing


def timer(source="browser_request", seconds="1.125"):
    return {
        "duration_seconds": seconds,
        "source": source,
        "scope": {
            "browser_request": "request",
            "chatgpt_history": "provider_message",
            "claude_history": "content_blocks",
            "perplexity_history": "workflow",
        }[source],
        "completeness": "complete_for_scope",
        "profile_version": "timing-observation-1",
    }


def paired(now):
    request, attempt = observations(now, "200")
    request["conversation_key"] = "b" * 64
    attempt["provider_attempt_key"] = "e" * 64
    attempt["coverage_reasons"] = ["partial_capture"]
    attempt["tokens"]["answer_output"]["completeness"] = "partial"
    recompose(attempt)
    attempt["timing"] = timer()
    history = message(now)
    history.update(site="chatgpt", provider_attempt_key="e" * 64, timing=timer("chatgpt_history", "3"))
    history["tokens"]["value"] = "500"
    body = page(now, [history])
    body["site"] = "chatgpt"
    return request, attempt, history, body


def test_exact_timing_validation_and_provider_completion(setup):
    now = setup[4][0]
    request, attempt, history, body = paired(now)
    validate_observation(attempt)
    validate_history_page(body)
    for value in ["0", "86400.000000000000001", "1e-999", "NaN"]:
        bad = deepcopy(attempt)
        bad["timing"]["duration_seconds"] = value
        with pytest.raises(ContractError):
            validate_observation(bad)
    for state in ["failed", "cancelled", "interrupted_unconfirmed", "generating"]:
        with pytest.raises(ContractError):
            validate_observation({**attempt, "state": state})
    for version in ["1.0.0", "1.1.0", "1.2.0"]:
        with pytest.raises(ContractError):
            validate_observation({**attempt, "schema_version": version})
        with pytest.raises(ContractError):
            validate_history_page({**body, "schema_version": version})


def test_historical_timing_conflict_flag_contract_and_refinement(setup):
    from aift.historical_usage import refine

    request, attempt, history, body = paired(setup[4][0])
    changed = {**history, "timing": timer("chatgpt_history", "4")}
    original = deepcopy(history)
    merged = merge_history_evidence(history, changed)
    assert refine(history, changed) == "improved"
    assert merged["timing"] is None and "historical_timing_conflict" in merged["coverage_reasons"]
    assert merged["tokens"] == history["tokens"] and history == original
    validate_history_page({**body, "messages": [merged]})
    for stale in (history, changed, {**history, "timing": None}):
        assert merge_history_evidence(merged, stale) == merged
        assert refine(merged, stale) == "duplicate"
    for completeness in ("partial", "unknown"):
        partial = {**history, "timing": {**timer("chatgpt_history", "1"), "completeness": completeness}}
        assert refine(partial, history) == "improved"
        assert refine(history, partial) == "duplicate"
        for reread_completeness in ("partial", "unknown", None):
            reread = {
                **history,
                "timing": {**timer("chatgpt_history", "9"), "completeness": reread_completeness}
                if reread_completeness
                else None,
            }
            assert merge_history_evidence(partial, reread) == partial
            assert refine(partial, reread) == "duplicate"
    established = {**history, "model_id": "chatgpt-gpt-5-6-sol"}
    recounted = with_answer(history, value="501", profile_id="cl100k-base-4.0.0-reference")
    for mutation in (
        {"message_key": "f" * 64},
        {"parts": recounted["parts"], "tokens": recounted["tokens"]},
    ):
        assert refine(established, {**changed, "model_id": established["model_id"], **mutation}) == "conflict"
    # A saved reply that grew after the stream ended is the newer state of the same reply;
    # a shorter reread keeps the stored count.
    grown = with_answer(established, value="501")
    assert refine(established, grown) == "improved"
    assert refine(grown, established) == "duplicate"
    assert refine(established, with_answer(established, value="499")) == "duplicate"
    # Sites other than Claude label each reply, so a newer label corrects the saved model.
    relabelled = {**established, "model_id": "chatgpt-gpt-5-5"}
    assert refine(established, relabelled) == "improved"
    assert merge_history_evidence(established, relabelled)["model_id"] == "chatgpt-gpt-5-5"
    # Claude history names only the chat's current model, so the first saved model stays.
    claude = {**established, "site": "claude", "model_id": "claude-opus-5-5"}
    assert refine(claude, {**claude, "model_id": "claude-haiku-4-5"}) == "duplicate"
    # A saved placeholder is corrected by a reread, never by a model of another family.
    unlisted = {**claude, "model_id": "claude-unlisted"}
    haiku = {**claude, "model_id": "claude-haiku-unlisted"}
    assert refine(unlisted, haiku) == "improved"
    assert merge_history_evidence(unlisted, haiku)["model_id"] == "claude-haiku-unlisted"
    assert merge_history_evidence(haiku, {**claude, "model_id": "claude-haiku-4-5"})["model_id"] == "claude-haiku-4-5"
    assert refine(haiku, {**claude, "model_id": "claude-opus-5-5"}) == "duplicate"
    assert refine(unlisted, {**claude, "model_id": "claude-opus-5-5"}) == "duplicate"
    assert refine(haiku, unlisted) == "duplicate"
    for invalid in (
        {**merged, "role": "prompt", "provider_attempt_key": None},
        {**merged, "timing": history["timing"]},
    ):
        with pytest.raises(ContractError):
            validate_history_page({**body, "messages": [invalid]})
    for live in (request, attempt):
        with pytest.raises(ContractError):
            validate_observation({**live, "coverage_reasons": ["historical_timing_conflict"]})
    assert select_timing(None, merged) is None
    assert select_timing(attempt, merged) == attempt["timing"]
    definition = engine_adapter.packaged_definition()
    live = engine_adapter.estimate(definition, attempt, request, history=merged)
    native, _ = engine_adapter.native_runtime()
    profile = live["selection"]["profile"]
    assert live["raw"]["result"] == engine_adapter.serialize(
        native(
            provider=profile["provider"],
            model_name=profile["model_name"],
            output_token_count=500,
            request_latency=1.125,
        )
    )


@pytest.mark.parametrize("engine", ["original", "ecologits"])
def test_changed_historical_duration_preserves_totals_original_and_modeled_estimate(setup, engine):
    from test_historical_usage import summary

    from aift.historical_usage import numeric_payload_hash

    app, client, company, member, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    _, _, first, body = paired(now[0])
    definition = engine_adapter.packaged_definition() if engine == "ecologits" else baseline_bundle()
    identity = engine_adapter.identity(definition)
    first.update(proposed_method_id=identity["method_id"], proposed_method_hash=identity["method_hash"])
    second = {**deepcopy(first), "message_key": "f" * 64, "provider_attempt_key": "d" * 64}
    initial = {**body, "messages": [first, second]}
    assert send(client, credentials, initial).status_code == 200
    before = summary(client, credentials)
    assert before["response_count"] == "2"
    assert before["tokens"][0]["value"] == "1000"
    with app.state.db.transaction(readonly=True) as session:
        saved = session.get(HistoryObservation, (company.id, member.id, first["message_key"]))
        original_result = deepcopy(saved.original_estimate)
    changed = {**deepcopy(first), "timing": timer("chatgpt_history", "4")}
    response = send(client, credentials, {**body, "messages": [changed]})
    receipt = response.json()["results"][0]
    assert receipt["status"] == "applied"
    assert receipt["payload_hash"] == numeric_payload_hash(changed)
    with app.state.db.transaction(readonly=True) as session:
        saved = session.get(HistoryObservation, (company.id, member.id, first["message_key"]))
        assert saved.status == "current"
        assert saved.payload["timing"] is None
        assert "historical_timing_conflict" in saved.payload["coverage_reasons"]
        assert saved.payload_hash == numeric_payload_hash(saved.payload) != receipt["payload_hash"]
        assert saved.original == first and saved.original_estimate == original_result
        assert saved.estimate["status"] == "estimated"
        if engine == "ecologits":
            native, _ = engine_adapter.native_runtime()
            profile = saved.estimate["selection"]["profile"]
            assert saved.estimate["raw"]["result"] == engine_adapter.serialize(
                native(
                    provider=profile["provider"],
                    model_name=profile["model_name"],
                    output_token_count=500,
                    request_latency=None,
                )
            )
    after = summary(client, credentials)
    assert after["response_count"] == "2" and after["conflicting_message_count"] == "0"
    assert after["tokens"][0]["value"] == "1000"
    assert after["tokens"][0]["known_message_count"] == "2"
    for stale in (first, changed, {**first, "timing": None}):
        assert (
            send(client, credentials, {**body, "messages": [stale]}).json()["results"][0]["status"]
            == "duplicate"
        )
    assert summary(client, credentials)["tokens"] == after["tokens"]


@pytest.mark.parametrize("completeness", ["partial", "unknown"])
def test_incomplete_timing_rereads_keep_first_evidence_and_valid_counts(setup, completeness):
    from test_historical_usage import summary

    app, client, company, member, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    _, _, first, body = paired(now[0])
    first["timing"]["completeness"] = completeness
    second = {**deepcopy(first), "message_key": "f" * 64, "provider_attempt_key": "d" * 64}
    assert send(client, credentials, {**body, "messages": [first, second]}).status_code == 200
    before = summary(client, credentials)
    assert before["tokens"][0]["value"] == "1000"
    for reread_completeness in ("partial", "unknown", None):
        reread = {
            **first,
            "timing": {**timer("chatgpt_history", "9"), "completeness": reread_completeness}
            if reread_completeness
            else None,
        }
        response = send(client, credentials, {**body, "messages": [reread]})
        assert response.json()["results"][0]["status"] == "duplicate"
        after = summary(client, credentials)
        assert after["response_count"] == "2" and after["conflicting_message_count"] == "0"
        assert after["tokens"] == before["tokens"] and after["resources"] == before["resources"]
        with app.state.db.transaction(readonly=True) as session:
            saved = session.get(HistoryObservation, (company.id, member.id, first["message_key"]))
            assert saved.status == "current" and saved.payload == first and saved.original == first


def test_native_uses_live_then_history_cap_and_preserves_original_numerics(setup):
    request, attempt, history, _ = paired(setup[4][0])
    definition = engine_adapter.packaged_definition()
    result = engine_adapter.estimate(definition, attempt, request, history=history)
    native, _ = engine_adapter.native_runtime()
    profile = result["selection"]["profile"]
    expected = engine_adapter.serialize(
        native(
            provider=profile["provider"],
            model_name=profile["model_name"],
            output_token_count=500,
            request_latency=1.125,
        )
    )
    assert result["raw"]["result"] == expected
    assert result["source"]["attempt_hash"] == payload_hash(attempt)
    assert result["source"]["history_binding"]["message_key"] == history["message_key"]
    fallback = engine_adapter.estimate(definition, {**attempt, "timing": None}, request, history=history)
    expected = engine_adapter.serialize(
        native(
            provider=profile["provider"],
            model_name=profile["model_name"],
            output_token_count=500,
            request_latency=3,
        )
    )
    assert fallback["raw"]["result"] == expected
    original = engine_adapter.estimate(baseline_bundle(), attempt, request, history=history)
    assert (
        original["source"]["attempt_hash"]
        == original["raw"]["result"]["observation_hash"]
        == payload_hash(attempt)
    )
    identified = {**history, "model_id": "chatgpt-gpt-5-5"}
    enriched = engine_adapter.estimate(baseline_bundle(), attempt, request, history=identified)
    assert enriched["raw"]["result"]["observed_model_key"] == "chatgpt-gpt-5-5"
    assert enriched["source"]["attempt_hash"] == payload_hash(attempt)
    complete = deepcopy(attempt)
    complete["coverage_reasons"] = []
    complete["tokens"]["answer_output"]["completeness"] = "complete_for_scope"
    recompose(complete)
    # A saved reply that grew after the stream ended replaces the shorter live count.
    assert select_output(complete, history)["value"] == "500"
    shorter = with_answer(history, value="150")
    assert select_output(complete, shorter)["value"] == "200"
    reported = deepcopy(attempt)
    reported["tokens"]["output_total"] = {
        **reported["tokens"]["answer_output"],
        "value": "900",
        "evidence": "provider_reported",
        "scope": "provider_request",
        "completeness": "complete_for_scope",
    }
    assert select_output(reported, history)["value"] == "900"


@pytest.mark.parametrize("history_first", [False, True])
@pytest.mark.parametrize("engine", ["original", "ecologits"])
def test_reopen_counts_once_enriches_selected_views_and_keeps_originals(setup, history_first, engine):
    app, client, company, member, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, attempt, history, body = paired(now[0])
    if history_first:
        assert send(client, credentials, body).status_code == 200
    assert upload(client, credentials, [request, attempt]).status_code == 200
    if not history_first:
        assert send(client, credentials, body).status_code == 200
    method = engine_adapter.identity(
        engine_adapter.packaged_definition() if engine == "ecologits" else baseline_bundle()
    )
    selection = client.put(
        "/v1/me/estimation-selection",
        headers=auth(credentials),
        json={
            "preference": engine,
            "selection_revision": 1,
            "method_id": method["method_id"],
            "method_hash": method["method_hash"],
            "operation_id": str(uuid4()),
        },
    )
    assert selection.status_code == 200, selection.text
    run(app.state.service)
    summary = client.get("/v1/me/summary?period=all", headers=auth(credentials))
    assert summary.status_code == 200, summary.text
    value = summary.json()
    assert value["request_count"] == "1" and value["attempt_count"] == "1"
    assert value["history"]["response_count"] == "0" and value["history"]["matched_live_message_count"] == "1"
    answers = [r for r in value["tokens"] if r["quantity"] == "answer_output"]
    assert len(answers) == 1 and answers[0]["value"] == "500"
    with app.state.db.transaction(readonly=True) as session:
        saved = session.get(Observation, (company.id, member.id, "attempt", attempt["attempt_id"]))
        assert saved.payload == attempt
        assert "history_binding" not in saved.estimate["result"]["source"]
        derived = session.scalar(
            select(EngineEstimate).where(
                EngineEstimate.family == "live", EngineEstimate.view == "recalculated"
            )
        )
        assert derived.history_payload == history and derived.history_hash
        verify_overlay(session, derived)
    repeated = send(client, credentials, body)
    assert repeated.json()["results"][0]["status"] == "duplicate"
    again = client.get("/v1/me/summary?period=all", headers=auth(credentials)).json()
    assert again["tokens"] == value["tokens"] and again["resources"] == value["resources"]


def test_history_refinement_invalidates_current_original_engine_and_preserves_timing(setup):
    app, client, company, member, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, attempt, history, body = paired(now[0])
    assert upload(client, credentials, [request, attempt]).status_code == 200
    partial = deepcopy(history)
    partial.update(text_complete=False, timing=None)
    partial["tokens"].update(value="200", completeness="partial")
    assert send(client, credentials, {**body, "messages": [partial]}).status_code == 200
    selection = client.put(
        "/v1/me/estimation-selection",
        headers=auth(credentials),
        json={
            "preference": "original",
            "selection_revision": 1,
            "method_id": BASELINE_METHOD_ID,
            "method_hash": payload_hash(baseline_bundle()),
            "operation_id": str(uuid4()),
        },
    )
    assert selection.status_code == 200
    run(app.state.service)
    with app.state.db.transaction(readonly=True) as session:
        before = session.scalar(
            select(EngineEstimate).where(
                EngineEstimate.family == "live", EngineEstimate.view == "recalculated"
            )
        )
        before_hash = before.estimate["input_hash"]
    assert send(client, credentials, body).json()["results"][0]["status"] == "applied"
    run(app.state.service)
    with app.state.db.transaction(readonly=True) as session:
        after = session.scalar(
            select(EngineEstimate).where(
                EngineEstimate.family == "live", EngineEstimate.view == "recalculated"
            )
        )
        assert after.estimate["input_hash"] != before_hash
        saved = session.get(HistoryObservation, (company.id, member.id, history["message_key"]))
        assert saved.original == partial and saved.payload == history
    assert (
        send(client, credentials, {**body, "messages": [partial]}).json()["results"][0]["status"]
        == "duplicate"
    )


def test_matching_rejects_unproven_conversation_and_distinct_responses(setup):
    app, client, company, member, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, attempt, history, body = paired(now[0])
    assert upload(client, credentials, [request, attempt]).status_code == 200
    assert send(client, credentials, body).status_code == 200
    with app.state.db.transaction() as session:
        row = session.get(HistoryObservation, (company.id, member.id, history["message_key"]))
        assert resolve_history_live(session, row)
        assert linked_history(session, company.id, "unrelated", attempt, request) is None
        conflicting = deepcopy(history)
        conflicting["conversation_key"] = "d" * 64
        from aift.security import Problem

        with pytest.raises(Problem):
            engine_adapter.estimate(
                engine_adapter.packaged_definition(), attempt, request, history=conflicting
            )


def test_claude_prompt_inference_and_ambiguous_history_stay_separate(setup):
    app, client, company, member, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, attempt, history, body = paired(now[0])
    request["site"] = history["site"] = body["site"] = "claude"
    history["timing"] = timer("claude_history")
    prompt = deepcopy(history)
    # A prompt has no reply parts.
    prompt.update(role="prompt", message_key="f" * 64, timing=None, provider_attempt_key=None, parts=None)
    history["prompt_key"] = prompt["message_key"]
    body["messages"] = [prompt, history]
    assert upload(client, credentials, [request, attempt]).status_code == 200
    assert send(client, credentials, body).status_code == 200
    with app.state.db.transaction(readonly=True) as session:
        p = session.get(HistoryObservation, (company.id, member.id, prompt["message_key"]))
        assert resolve_history_live(session, p)[0].id == request["request_id"]
    other = {**history, "message_key": "9" * 64}
    assert send(client, credentials, {**body, "messages": [other]}).status_code == 200
    with app.state.db.transaction(readonly=True) as session:
        p = session.get(HistoryObservation, (company.id, member.id, prompt["message_key"]))
        assert resolve_history_live(session, p) is None
        assert linked_history(session, company.id, member.id, attempt, request) is None


def test_historical_erasure_drops_linked_projection_but_keeps_live_evidence(setup):
    from aift.engine_history import lookup
    from aift.security import instant

    app, client, company, member, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, attempt, history, body = paired(now[0])
    assert upload(client, credentials, [request, attempt]).status_code == 200
    assert send(client, credentials, body).status_code == 200
    method_hash = payload_hash(baseline_bundle())
    selected = client.put(
        "/v1/me/estimation-selection",
        headers=auth(credentials),
        json={
            "preference": "original",
            "selection_revision": 1,
            "method_id": BASELINE_METHOD_ID,
            "method_hash": method_hash,
            "operation_id": str(uuid4()),
        },
    )
    assert selected.status_code == 200
    run(app.state.service)
    with app.state.db.transaction(scope=company.id) as session:
        tenant = get(session, "company", company.id)
        marker = {
            "scope": "range",
            "user_id": member.id,
            "start": "2019-01-01T00:00:00.000Z",
            "end": "2021-01-01T00:00:00.000Z",
            "epoch": 1,
            "retention": False,
        }
        for _ in range(5):
            if app.state.service.analytics.history.erase_page(session, tenant, marker) == 0:
                break
        assert session.get(HistoryObservation, (company.id, member.id, history["message_key"])) is None
        live = session.get(Observation, (company.id, member.id, "attempt", attempt["attempt_id"]))
        assert live.payload == attempt and live.payload["timing"] == timer()
        assert lookup(session, live, BASELINE_METHOD_ID) is None
    run(app.state.service)
    with app.state.db.transaction(readonly=True) as session:
        live = session.get(Observation, (company.id, member.id, "attempt", attempt["attempt_id"]))
        rebuilt = lookup(session, live, BASELINE_METHOD_ID)
        assert rebuilt is not None and "history_binding" not in rebuilt["source"]
    stale = {**body, "observed_at": instant(now[0])}
    assert send(client, credentials, stale).json()["results"][0]["status"] == "erased"


def test_generating_alias_later_completes_and_promotes_real_evidence_with_originals(setup):
    from aift.db import TABLES

    app, client, company, member, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, attempt = observations(now[0], "200")
    request["request_id"] = "00000000-0000-4000-8000-000000000001"
    request["provider_request_key"] = "f" * 64
    attempt.update(
        request_id=request["request_id"],
        attempt_id="00000000-0000-4000-8000-000000000011",
        provider_attempt_key="e" * 64,
        state="generating",
        ended_at=None,
    )
    attempt["tokens"]["answer_output"]["completeness"] = "partial"
    recompose(attempt)
    alias_request = {**request, "request_id": "00000000-0000-4000-8000-000000000002"}
    alias = deepcopy(attempt)
    alias.update(request_id=alias_request["request_id"], attempt_id="00000000-0000-4000-8000-000000000012")
    assert upload(client, credentials, [request, attempt]).status_code == 200
    initial = upload(client, credentials, [alias_request, alias])
    assert [r["status"] for r in initial.json()["results"]] == ["aliased", "aliased"], initial.text
    final = deepcopy(alias)
    final.update(revision=2, state="completed", ended_at=request["ended_at"], timing=timer())
    final["tokens"]["answer_output"].update(value="500", completeness="complete_for_scope")
    recompose(final)
    completed = upload(client, credentials, [final])
    assert completed.status_code == 200, completed.text
    ack = completed.json()["results"][0]
    assert ack["status"] == "applied" and ack["canonical_id"] == final["attempt_id"]
    totals = client.get("/v1/me/summary?period=all", headers=auth(credentials)).json()
    assert totals["attempt_count"] == "1" and totals["request_count"] == "1"
    answer = next(t for t in totals["tokens"] if t["quantity"] == "answer_output")
    assert answer["value"] == "500"
    with app.state.db.transaction(readonly=True) as session:
        old = session.get(Observation, (company.id, member.id, "attempt", attempt["attempt_id"]))
        selected = session.get(Observation, (company.id, member.id, "attempt", final["attempt_id"]))
        assert old.status == "aliased" and old.payload == attempt and old.stable_key is None
        assert selected.status == "current" and selected.payload == final
        originals = list(
            session.scalars(select(TABLES["revision"]).where(TABLES["revision"].tenant == company.id))
        )
        records = [row.data["record"] for row in originals]
        assert attempt in records and alias in records and final in records
    replay = upload(client, credentials, [attempt])
    assert replay.status_code == 200
    assert (
        client.get("/v1/me/summary?period=all", headers=auth(credentials)).json()["tokens"]
        == totals["tokens"]
    )


@PERSON_ANALYTICS
@pytest.mark.parametrize("mutation", ["erase", "refine"])
def test_history_mutation_invalidates_snapshots_from_former_canonical_aliases(setup, mutation):
    import json

    from footprint_contracts import canonical_json
    from test_engine_exports import exported

    from aift.engine_history import persist
    from aift.historical_usage import numeric_payload_hash
    from tools.verify_restore import verify_restored

    app, client, company, member, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, attempt, history, body = paired(now[0])
    attempt["timing"] = None
    history["timing"] = None
    assert upload(client, credentials, [request, attempt]).status_code == 200
    assert send(client, credentials, body).status_code == 200
    selected = client.put(
        "/v1/me/estimation-selection",
        headers=auth(credentials),
        json={
            "preference": "original",
            "selection_revision": 1,
            "method_id": BASELINE_METHOD_ID,
            "method_hash": payload_hash(baseline_bundle()),
            "operation_id": str(uuid4()),
        },
    )
    assert selected.status_code == 200, selected.text
    run(app.state.service)
    promoted = {**deepcopy(attempt), "attempt_id": str(uuid4()), "timing": timer()}
    response = upload(client, credentials, [promoted])
    assert response.json()["results"][0]["status"] == "applied", response.text
    run(app.state.service)
    with app.state.db.transaction(scope=company.id) as session:
        dependents = list(
            session.scalars(
                select(EngineEstimate).where(
                    EngineEstimate.family == "live", EngineEstimate.view == "recalculated"
                )
            )
        )
        assert {row.record_key for row in dependents} == {attempt["attempt_id"], promoted["attempt_id"]}
        assert all(
            row.history_payload == history and row.history_hash == numeric_payload_hash(history)
            for row in dependents
        )
        first = session.get(Observation, (company.id, member.id, "attempt", attempt["attempt_id"]))
        assert first.status == "aliased" and first.stable_key is None
        for identifier in (attempt["attempt_id"], promoted["attempt_id"]):
            record = session.get(Observation, (company.id, member.id, "attempt", identifier))
            persist(session, record, BASELINE_METHOD_ID, record.estimate["result"], "original")
        originals = {
            row.record_key: canonical_json(row.estimate)
            for row in session.scalars(
                select(EngineEstimate).where(
                    EngineEstimate.family == "live", EngineEstimate.view == "original"
                )
            )
        }
        assert len(originals) == 2
    if mutation == "erase":
        with app.state.db.transaction(scope=company.id) as session:
            tenant = get(session, "company", company.id)
            marker = {
                "scope": "range",
                "user_id": member.id,
                "start": "2019-01-01T00:00:00.000Z",
                "end": "2021-01-01T00:00:00.000Z",
                "epoch": 1,
                "retention": False,
            }
            for _ in range(5):
                if app.state.service.analytics.history.erase_page(session, tenant, marker) == 0:
                    break
            assert session.get(HistoryObservation, (company.id, member.id, history["message_key"])) is None
    else:
        refined = {**history, "timing": timer("chatgpt_history", "3")}
        response = send(client, credentials, {**body, "messages": [refined]})
        assert response.json()["results"][0]["status"] == "applied", response.text
    with app.state.db.transaction(readonly=True) as session:
        assert (
            list(
                session.scalars(
                    select(EngineEstimate).where(
                        EngineEstimate.family == "live", EngineEstimate.view == "recalculated"
                    )
                )
            )
            == []
        )
        retained = {
            row.record_key: canonical_json(row.estimate)
            for row in session.scalars(
                select(EngineEstimate).where(
                    EngineEstimate.family == "live", EngineEstimate.view == "original"
                )
            )
        }
        assert retained == originals
    run(app.state.service)
    with app.state.db.transaction(readonly=True) as session:
        overlays = list(session.scalars(select(EngineEstimate)))
        if mutation == "erase":
            assert all(row.history_payload is None and row.history_hash == "" for row in overlays)
            assert all("history_binding" not in row.estimate.get("source", {}) for row in overlays)
        else:
            current = [row for row in overlays if row.family == "live" and row.view == "recalculated"]
            assert len(current) == 1 and current[0].record_key == promoted["attempt_id"]
            assert current[0].history_payload == refined
            assert current[0].history_hash == numeric_payload_hash(refined) != numeric_payload_hash(history)
    if mutation == "erase":
        assert verify_restored(app.state.service)["status"] == "passed"
        rows, _ = exported(
            client,
            "records",
            calculation_view="recalculated",
            method_id=BASELINE_METHOD_ID,
            user_id=member.id,
        )
        assert history["message_key"] not in canonical_json(rows)
        for row in rows:
            result = json.loads(row["estimate_json"]).get("result")
            if result:
                assert "history_binding" not in result["source"]
        summary = client.get("/v1/me/summary?period=all", headers=auth(credentials))
        assert summary.status_code == 200, summary.text
        assert summary.json()["attempt_count"] == "1"
        assert summary.json()["history"]["observed_response_count"] == "0"
