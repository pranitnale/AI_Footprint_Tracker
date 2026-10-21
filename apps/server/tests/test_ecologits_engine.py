from copy import deepcopy
from datetime import UTC, datetime
from decimal import Decimal
from uuid import uuid4

import pytest
from conftest import connect, login
from footprint_contracts import ContractError, payload_hash
from footprint_estimator import BASELINE_METHOD_ID, estimate_observation
from sqlalchemy import func, select
from test_analytics import observations, recompose, upload
from test_historical_usage import auth, message, page, send

from aift import engine_adapter, method_registry
from aift.db import HistoryObservation, Observation, get
from aift.engine_history import EngineEstimate
from aift.maintenance import run
from aift.method_history import RecalculationJob, resolve_estimate


def eco():
    return engine_adapter.identity(engine_adapter.packaged_definition())


def calculation(count="500", site="chatgpt", model=None):
    request, attempt = observations(datetime(2026, 9, 10, 12, tzinfo=UTC), count)
    request["site"] = site
    attempt["model_id"] = model
    return engine_adapter.estimate(engine_adapter.packaged_definition(), attempt, request), request, attempt


@pytest.mark.parametrize(
    "site,provider", [("chatgpt", "openai"), ("claude", "anthropic"), ("gemini", "google_genai")]
)
def test_native_output_retains_raw_phases_and_operational_ranges(site, provider):
    result, _, _ = calculation(site=site)
    profile = result["selection"]["profile"]
    native, _ = engine_adapter.native_runtime()
    # Claude text is estimated from 1.56 times the tokenizer's count (owner decision, 15 Oct 2026).
    count = 780 if site == "claude" else 500
    expected = engine_adapter.serialize(
        native(
            provider=provider, model_name=profile["model_name"], output_token_count=count, request_latency=None
        )
    )
    assert result["raw"]["result"] == expected
    low, high = engine_adapter.endpoints(expected["usage"]["gwp"]["value"])
    assert float(result["metrics"]["carbon"]["value"]) == pytest.approx((low + high) / 2 * 1000)
    water = result["metrics"]["water_total"]
    raw_low, raw_high = engine_adapter.endpoints(expected["wcf"]["value"])
    assert float(water["value"]) == pytest.approx((raw_low + raw_high) / 2, rel=1e-12)
    assert float(water["scenario_low"]) == pytest.approx(raw_low, rel=1e-12)
    assert float(water["scenario_high"]) == pytest.approx(raw_high, rel=1e-12)
    assert "factor_incompatible" not in water["reasons"]
    assert "compatible_total_water_scope" not in result["missing_components"]
    for quantity in ("water_direct", "water_upstream"):
        assert result["metrics"][quantity]["value"] is None
        assert result["metrics"][quantity]["reasons"] == ["not_applicable"]
    assert "embodied" in expected and expected["embodied"]["gwp"] is not None
    assert result["selection"]["reason"] == "model_proxy"
    assert result["input_hash"] == payload_hash(
        {
            "schema_version": "3.0.0",
            "source": result["source"],
            "selection": result["selection"],
            "requested_method_hash": eco()["method_hash"],
            "effective_method_hash": eco()["method_hash"],
            "auxiliary_method_hashes": {"image_reference": engine_adapter.IMAGE_REFERENCE_HASH},
        }
    )


def legacy_definition():
    """Test-only policy; the shipped policy never routes to the original engine."""
    definition = deepcopy(engine_adapter.packaged_definition())
    definition["fallback"]["unknown_provider"] = {"strategy": "original_engine"}
    return definition


def test_direct_mapping_wins_and_unknown_provider_preserves_legacy_child_bytes():
    direct, _, _ = calculation(model="chatgpt-gpt-5-5")
    assert direct["selection"]["kind"] == "direct_mapping"
    assert direct["selection"]["reason"] is None
    _, request, attempt = calculation(site="perplexity")
    fallback = engine_adapter.estimate(legacy_definition(), attempt, request)
    assert fallback["raw"]["result"] == estimate_observation(attempt)
    assert fallback["requested_method"]["engine_id"] == "ecologits"
    assert fallback["effective_method"]["method_id"] == BASELINE_METHOD_ID
    assert fallback["selection"]["reason"] == "unknown_provider_policy"


@pytest.mark.parametrize(
    "model,kind,provider,expected",
    [
        ("perplexity-gpt-5-6-terra", "direct_mapping", "openai", "gpt-5.6-terra"),
        ("perplexity-gpt-5-6-sol", "direct_mapping", "openai", "gpt-5.6-sol"),
        ("perplexity-claude-sonnet-5", "direct_mapping", "anthropic", "claude-sonnet-5"),
        ("perplexity-claude-opus-5", "direct_mapping", "anthropic", "claude-opus-5"),
        ("perplexity-gemini-3-8-flash", "direct_mapping", "google_genai", "gemini-3.8-flash"),
        ("perplexity-gemini-3-7-flash", "direct_mapping", "google_genai", "gemini-3.7-flash"),
        ("perplexity-glm-5-3", "direct_mapping", "mistralai", "zai-glm-5-3"),
        ("perplexity-gemini-3-pro", "model_override", "google_genai", "gemini-3.1-pro-preview"),
        ("perplexity-best", "model_override", "openai", "gpt-6.1-sol"),
        ("perplexity-sonar-2", "model_override", "openai", "gpt-6.1-sol"),
        ("perplexity-kimi-k3", "model_override", "openai", "gpt-6.1-sol"),
        ("perplexity-grok-4-6", "model_override", "openai", "gpt-6.1-sol"),
        ("perplexity-nemotron-3-ultra", "model_override", "openai", "gpt-6.1-sol"),
        ("perplexity-unlisted-anthropic", "model_override", "anthropic", "claude-opus-5-5"),
        ("perplexity-unlisted", "provider_flagship", "openai", "gpt-6.1-sol"),
        (None, "provider_flagship", "openai", "gpt-6.1-sol"),
    ],
)
def test_perplexity_labels_use_own_records_stand_ins_or_the_family_benchmark(model, kind, provider, expected):
    result, _, _ = calculation(site="perplexity", model=model)
    assert result["status"] == "estimated"
    assert result["selection"]["kind"] == kind
    assert result["selection"]["observed_model_id"] == model
    assert result["selection"]["profile"] == {"provider": provider, "model_name": expected, "workload": "text"}
    assert result["selection"]["reason"] == (None if kind == "direct_mapping" else "model_proxy")
    assert result["requested_method"]["engine_id"] == result["effective_method"]["engine_id"] == "ecologits"
    assert result["raw"]["engine_id"] == "ecologits"
    assert ("model_proxy" in result["reasons"]) == (kind != "direct_mapping")
    assert "original_engine_fallback" not in result["reasons"]
    assert result["metrics"]["water_total"]["value"] is not None
    assert result["metrics"]["energy"]["value"] is not None


# Owner decision of 13 October 2026: an unknown version of a named family uses that family's
# newest catalog record. The extension sends the family's unlisted id, never the raw label.
@pytest.mark.parametrize(
    "site,model,provider,expected",
    [
        ("claude", "claude-haiku-unlisted", "anthropic", "claude-haiku-4-5"),
        ("claude", "claude-sonnet-unlisted", "anthropic", "claude-sonnet-5-5"),
        ("claude", "claude-opus-unlisted", "anthropic", "claude-opus-5-5"),
        ("claude", "claude-fable-unlisted", "anthropic", "claude-fable-5-1"),
        ("chatgpt", "chatgpt-gpt-sol-unlisted", "openai", "gpt-6.1-sol"),
        ("chatgpt", "chatgpt-gpt-astra-unlisted", "openai", "gpt-6-astra"),
        ("chatgpt", "chatgpt-gpt-luna-unlisted", "openai", "gpt-6-luna"),
        ("chatgpt", "chatgpt-gpt-terra-unlisted", "openai", "gpt-5.6-terra"),
        ("gemini", "gemini-flash-unlisted", "google_genai", "gemini-3.8-flash"),
        ("gemini", "gemini-flash-lite-unlisted", "google_genai", "gemini-3.5-flash-lite"),
        ("gemini", "gemini-pro-unlisted", "google_genai", "gemini-3.1-pro-preview"),
        ("perplexity", "perplexity-claude-haiku-unlisted", "anthropic", "claude-haiku-4-5"),
        ("perplexity", "perplexity-gpt-sol-unlisted", "openai", "gpt-6.1-sol"),
        ("perplexity", "perplexity-gemini-flash-lite-unlisted", "google_genai", "gemini-3.5-flash-lite"),
    ],
)
def test_unknown_versions_use_the_newest_record_of_their_family(site, model, provider, expected):
    result, _, _ = calculation(site=site, model=model)
    assert result["status"] == "estimated"
    assert result["selection"] == {
        "kind": "model_override",
        "observed_model_id": model,
        "profile": {"provider": provider, "model_name": expected, "workload": "text"},
        "reason": "model_proxy",
        "basis": "model_family_stand_in",
    }


# Owner decision of 14 October 2026: an unknown variant uses the same variant's newest record, or
# the newest model of its kind and vendor when the catalog has no version of the variant.
@pytest.mark.parametrize(
    "site,model,provider,expected,basis",
    [
        ("chatgpt", "chatgpt-gpt-pro-unlisted", "openai", "gpt-5.5-pro", "model_variant_stand_in"),
        ("chatgpt", "chatgpt-gpt-mini-unlisted", "openai", "gpt-5.4-mini", "model_variant_stand_in"),
        ("claude", "claude-small-unlisted", "anthropic", "claude-haiku-4-5", "model_kind_stand_in"),
        ("gemini", "gemini-pro-image-unlisted", "google_genai", "gemini-3-pro-image-preview", "model_variant_stand_in"),
        ("gemini", "gemini-image-unlisted", "google_genai", "gemini-3.1-flash-image-preview", "model_kind_stand_in"),
        ("perplexity", "perplexity-gpt-pro-unlisted", "openai", "gpt-5.5-pro", "model_variant_stand_in"),
        ("perplexity", "perplexity-claude-small-unlisted", "anthropic", "claude-haiku-4-5", "model_kind_stand_in"),
        (
            "perplexity",
            "perplexity-gemini-pro-image-unlisted",
            "google_genai",
            "gemini-3-pro-image-preview",
            "model_variant_stand_in",
        ),
    ],
)
def test_unknown_variants_use_the_newest_record_of_their_variant_or_kind(site, model, provider, expected, basis):
    result, _, _ = calculation(site=site, model=model)
    assert result["status"] == "estimated"
    assert result["selection"] == {
        "kind": "model_override",
        "observed_model_id": model,
        "profile": {"provider": provider, "model_name": expected, "workload": "text"},
        "reason": "model_proxy",
        "basis": basis,
    }


# Owner correction of 14 October 2026: a Pro after a GPT family name is that family model with
# Pro reasoning, not a Pro model, and OpenAI says GPT-6 Pro in ChatGPT is GPT-6 Astra with the Pro
# option. Listed versions use the family model's own record; unlisted ones the family's newest.
@pytest.mark.parametrize(
    "site,model,kind,expected,basis",
    [
        ("chatgpt", "chatgpt-gpt-6-pro", "direct_mapping", "gpt-6-astra", "exact_record"),
        ("chatgpt", "chatgpt-gpt-5-6-sol-pro", "direct_mapping", "gpt-5.6-sol", "exact_record"),
        ("chatgpt", "chatgpt-gpt-6-sol-pro", "direct_mapping", "gpt-6-sol", "exact_record"),
        ("chatgpt", "chatgpt-gpt-6-luna-pro", "direct_mapping", "gpt-6-luna", "exact_record"),
        ("perplexity", "perplexity-gpt-6-sol-pro", "direct_mapping", "gpt-6-sol", "exact_record"),
        ("chatgpt", "chatgpt-gpt-sol-pro-unlisted", "model_override", "gpt-6.1-sol", "model_family_stand_in"),
        ("chatgpt", "chatgpt-gpt-astra-pro-unlisted", "model_override", "gpt-6-astra", "model_family_stand_in"),
        ("perplexity", "perplexity-gpt-luna-pro-unlisted", "model_override", "gpt-6-luna", "model_family_stand_in"),
    ],
)
def test_gpt_pro_reasoning_uses_the_family_model(site, model, kind, expected, basis):
    result, _, _ = calculation(site=site, model=model)
    assert result["status"] == "estimated"
    assert result["selection"]["kind"] == kind
    assert result["selection"]["observed_model_id"] == model
    assert result["selection"]["profile"] == {"provider": "openai", "model_name": expected, "workload": "text"}
    assert result["selection"]["basis"] == basis


# Owner decision of 14 October 2026: Nano Banana Pro is Gemini 3 Pro Image, so both sites' ids
# use its own record instead of the Google benchmark (Gemini) or the unknown-provider one.
@pytest.mark.parametrize("site,model", [("gemini", "gemini-nano-banana-pro"), ("perplexity", "perplexity-nano-banana-pro")])
def test_nano_banana_pro_uses_the_gemini_3_pro_image_record(site, model):
    result, _, _ = calculation(site=site, model=model)
    assert result["status"] == "estimated"
    assert result["selection"]["kind"] == "direct_mapping"
    assert result["selection"]["observed_model_id"] == model
    assert result["selection"]["profile"] == {
        "provider": "google_genai",
        "model_name": "gemini-3-pro-image-preview",
        "workload": "text",
    }
    assert result["selection"]["basis"] == "exact_record"


def test_unknown_haiku_is_no_longer_estimated_as_the_anthropic_flagship():
    # The live chat of 13 October: claude-haiku-5-5 had become claude-unlisted and Opus 5.5.
    haiku, _, _ = calculation("19724", site="claude", model="claude-haiku-unlisted")
    flagship, _, _ = calculation("19724", site="claude", model="claude-unlisted")
    assert flagship["selection"]["kind"] == "provider_flagship"
    assert flagship["selection"]["profile"]["model_name"] == "claude-opus-5-5"
    assert flagship["selection"]["basis"] == "model_not_in_library"
    assert Decimal(haiku["metrics"]["energy"]["value"]) * 20 < Decimal(flagship["metrics"]["energy"]["value"])


def test_shipped_policy_never_routes_to_the_original_engine_implicitly():
    policy = engine_adapter.packaged_definition()["fallback"]
    rules = [*policy["provider_defaults"].values(), *policy["model_overrides"].values(), policy["unknown_provider"]]
    assert rules and all(rule["strategy"] != "original_engine" for rule in rules)
    assert policy["unknown_provider"]["strategy"] == "upstream_provider_flagship"


@pytest.mark.parametrize(
    "count,reason",
    [
        (None, "estimate_unavailable"),
        ("0", "estimate_unavailable"),
        ("9007199254740992", "numeric_domain_unsupported"),
    ],
)
def test_unknown_zero_and_unsafe_output_are_explicit(count, reason):
    result, _, _ = calculation(count)
    assert result["status"] == "unavailable" and result["raw"] is None
    assert reason in result["reasons"]
    assert result["selection"]["kind"] == "provider_flagship"
    assert all(metric["value"] is None for metric in result["metrics"].values())


def test_output_total_priority_and_no_timestamp_duration_cap():
    result, request, attempt = calculation()
    # A provider-reported total wins over the parts, which never add on top of it.
    attempt["tokens"]["output_total"] = {
        **attempt["tokens"]["answer_output"],
        "value": "750",
        "evidence": "provider_reported",
        "scope": "provider_request",
        "profile_id": None,
        "reason": None,
    }
    attempt["tokens"]["visible_thinking"] = {**attempt["tokens"]["answer_output"], "value": "99999"}
    selected = engine_adapter.estimate(engine_adapter.packaged_definition(), attempt, request)
    expected, _, _ = calculation("750")
    assert selected["raw"] == expected["raw"]
    assert float(result["metrics"]["energy"]["value"]) > 0
    assert request["dispatched_at"] == request["ended_at"]


def test_live_server_ingestion_mixed_groups_and_reversible_intervals(setup):
    app, client, company, member, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, attempt = observations(now[0])
    attempt["proposed_method_id"] = eco()["method_id"]
    legacy_request, legacy_attempt = observations(now[0])
    response = upload(client, credentials, [request, attempt, legacy_request, legacy_attempt])
    assert response.status_code == 200, response.text
    assert all(r["status"] == "applied" for r in response.json()["results"])
    summary = client.get("/v1/me/summary?period=all", headers=auth(credentials))
    assert summary.status_code == 200, summary.text
    resources = summary.json()["resources"]
    groups = [r for r in resources if r["quantity"] == "energy"]
    assert len(groups) == 2
    series = next(r for r in groups if r["method_group"]["method_id"] == eco()["method_id"])
    expected_metrics = engine_adapter.estimate(engine_adapter.packaged_definition(), attempt, request)["metrics"]
    # One ranged record: the group's scenario sums equal that record's endpoints and bracket its midpoint.
    assert Decimal(series["scenario_low"]) == Decimal(expected_metrics["energy"]["scenario_low"])
    assert Decimal(series["scenario_high"]) == Decimal(expected_metrics["energy"]["scenario_high"])
    assert Decimal(series["scenario_low"]) <= Decimal(series["value"]) <= Decimal(series["scenario_high"])
    assert series["interval_kind"] is None and series["value_kind"] == "midpoint_sum"
    water = next(
        r
        for r in resources
        if r["quantity"] == "water_total" and r["method_group"]["method_id"] == eco()["method_id"]
    )
    expected_water = expected_metrics["water_total"]
    assert Decimal(water["value"]) == Decimal(expected_water["value"])
    assert Decimal(water["scenario_low"]) == Decimal(expected_water["scenario_low"])
    assert Decimal(water["scenario_high"]) == Decimal(expected_water["scenario_high"])
    assert water["unknown_count"] == 0
    assert water["value_kind"] == "midpoint_sum"
    correction = deepcopy(attempt)
    correction["revision"] = 2
    correction["tokens"]["answer_output"]["value"] = "200"
    recompose(correction)
    response = upload(client, credentials, [correction])
    assert response.status_code == 200, response.text
    run(app.state.service)
    summary = client.get("/v1/me/summary?period=all", headers=auth(credentials))
    assert summary.status_code == 200, summary.text
    actual = next(
        r
        for r in summary.json()["resources"]
        if r["quantity"] == "energy" and r["method_group"]["method_id"] == eco()["method_id"]
    )
    with app.state.db.transaction(readonly=True) as session:
        row = session.get(Observation, (company.id, member.id, "attempt", attempt["attempt_id"]))
        expected = row.estimate["result"]["metrics"]["energy"]
    assert actual["value_kind"] == "midpoint_sum"
    assert Decimal(actual["value"]) == Decimal(expected["value"])
    assert expected["scenario_low"] is not None and expected["scenario_high"] is not None
    # The correction replaced the earlier revision, so the scenario sums follow the new record alone.
    assert Decimal(actual["scenario_low"]) == Decimal(expected["scenario_low"])
    assert Decimal(actual["scenario_high"]) == Decimal(expected["scenario_high"])


def test_self_recalculation_bounded_live_history_and_originals(setup):
    app, client, company, member, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, attempt = observations(now[0])
    assert upload(client, credentials, [request, attempt]).status_code == 200
    record = message(now[0])
    assert send(client, credentials, page(now[0], [record])).status_code == 200
    original = estimate_observation(attempt)
    selected = client.put(
        "/v1/me/estimation-selection",
        headers=auth(credentials),
        json={
            "preference": "ecologits",
            "selection_revision": 1,
            "method_id": eco()["method_id"],
            "method_hash": eco()["method_hash"],
            "operation_id": str(uuid4()),
        },
    )
    assert selected.status_code == 200, selected.text
    identifier = selected.json()["recalculation"]["job_id"]
    with app.state.db.transaction(scope=company.data["origin"]) as session:
        app.state.service.analytics.methods.advance(
            session, get(session, "company", company.id), session.get(RecalculationJob, identifier), budget=1
        )
        assert session.scalar(select(func.count()).select_from(EngineEstimate)) == 1
    state = client.get("/v1/me/recalculations/" + identifier, headers=auth(credentials)).json()
    assert state["status"] == "pending"
    run(app.state.service)
    state = client.get("/v1/me/recalculations/" + identifier, headers=auth(credentials)).json()
    assert state["status"] == "completed", state
    query = "?period=all&calculation_view=recalculated&method_id=" + eco()["method_id"]
    view = client.get("/v1/me/summary" + query, headers=auth(credentials))
    assert view.status_code == 200, view.text
    assert view.json()["history"]["resources"][0]["method_id"] == eco()["method_id"]
    default = client.get("/v1/me/summary?period=all", headers=auth(credentials))
    assert default.status_code == 200, default.text
    assert default.json()["calculation_view"] == "recalculated"
    assert default.json()["method_id"] == eco()["method_id"]
    retained = client.get("/v1/me/summary?period=all&calculation_view=original", headers=auth(credentials))
    assert retained.status_code == 200 and retained.json()["calculation_view"] == "original"
    with app.state.db.transaction(readonly=True) as session:
        live = session.get(Observation, (company.id, member.id, "attempt", attempt["attempt_id"]))
        assert resolve_estimate(session, live)["result"]["raw"]["result"] == original
        saved = session.get(HistoryObservation, (company.id, member.id, record["message_key"]))
        assert isinstance(saved.original_estimate["raw"]["result"], list)
        assert saved.original == record


def test_history_ecologits_pending_dependency_and_hash_conflict(setup, monkeypatch):
    app, client, _, _, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    record = message(now[0])
    record["proposed_method_id"], record["proposed_method_hash"] = eco()["method_id"], eco()["method_hash"]
    response = send(client, credentials, page(now[0], [record]))
    assert response.status_code == 200, response.text
    fetched = client.get("/v1/me/history/export", headers=auth(credentials)).json()["records"][0]
    # A Perplexity history record stays on the EcoLogits engine through the benchmark profile.
    assert fetched["resources"]["raw"]["engine_id"] == "ecologits"
    assert fetched["resources"]["selection"]["kind"] == "provider_flagship"
    wrong = message(now[0], "c" * 64)
    wrong["proposed_method_id"], wrong["proposed_method_hash"] = eco()["method_id"], "f" * 64
    assert send(client, credentials, page(now[0], [wrong])).status_code == 422
    unknown = message(now[0], "d" * 64)
    unknown["proposed_method_id"] = "ecologits-unavailable-release"
    response = send(client, credentials, page(now[0], [unknown]))
    assert response.status_code == 200, response.text
    fetched = client.get("/v1/me/history/export", headers=auth(credentials)).json()["records"]
    assert fetched[-1]["resources"] == {"status": "pending", "reason": "method_unsupported"}


def test_attempt_revisions_cannot_change_original_method(setup):
    app, client, _, _, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, attempt = observations(now[0])
    assert upload(client, credentials, [request, attempt]).status_code == 200
    changed = deepcopy(attempt)
    changed.update(revision=2, proposed_method_id=eco()["method_id"])
    response = upload(client, credentials, [changed])
    assert response.status_code == 200, response.text
    assert response.json()["results"][0]["error_code"] == "method_conflict"
    stored = client.get(
        "/v1/usage/records/attempt/" + attempt["attempt_id"], headers=auth(credentials)
    ).json()
    assert stored["record"] == attempt


def test_changed_parent_hash_recomputes_overlay_without_stale_totals(setup):
    app, client, company, member, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, attempt = observations(now[0])
    attempt["proposed_method_id"] = eco()["method_id"]
    assert upload(client, credentials, [request, attempt]).status_code == 200
    revised = deepcopy(request)
    revised["revision"] = 2
    revised["observed_search_operations"] = "1"
    response = upload(client, credentials, [revised])
    assert response.status_code == 200, response.text
    run(app.state.service)
    response = client.get("/v1/usage/records/attempt/" + attempt["attempt_id"], headers=auth(credentials))
    assert response.status_code == 200, response.text
    result = response.json()["estimate"]["result"]
    assert result["source"]["request_hash"] == payload_hash(revised)
    summary = client.get("/v1/me/summary?period=all", headers=auth(credentials)).json()
    assert summary["pending_estimates"] == "0"
    with app.state.db.transaction(readonly=True) as session:
        original = session.get(
            Observation, (company.id, member.id, "attempt", attempt["attempt_id"])
        ).estimate["result"]
        assert original["source"]["request_hash"] == payload_hash(request)


def test_recovered_original_overlay_survives_until_erasure_subtraction(setup, monkeypatch):
    from aift.security import Problem

    app, client, company, member, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, attempt = observations(now[0])
    attempt["proposed_method_id"] = eco()["method_id"]
    with monkeypatch.context() as patch:
        patch.setattr(
            engine_adapter,
            "require_native",
            lambda _: (_ for _ in ()).throw(Problem("engine_unavailable", 409)),
        )
        response = upload(client, credentials, [request, attempt])
        assert response.json()["results"][1]["status"] == "stored_pending_estimate"
    run(app.state.service)
    with app.state.db.transaction(scope=company.data["origin"]) as session:
        current_company = get(session, "company", company.id)
        record = session.get(Observation, (company.id, member.id, "attempt", attempt["attempt_id"]))
        assert resolve_estimate(session, record)["status"] == "available"
        for _ in range(10):
            done, _ = app.state.service.analytics.deletions._erase_record(
                session, current_company, record, 1, budget=1
            )
            if done:
                break
        assert done
        assert session.scalar(select(func.count()).select_from(EngineEstimate)) == 0


def test_restore_recomputes_overlays_instead_of_trusting_valid_input_hash(setup):
    from sqlalchemy import update

    from aift.engine_history import validate_binding
    from tools.verify_restore import RestoreVerificationError, verify_restored

    app, client, company, member, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, attempt = observations(now[0])
    assert upload(client, credentials, [request, attempt]).status_code == 200
    job = client.post(
        "/v1/me/recalculations",
        headers=auth(credentials),
        json={"method_id": eco()["method_id"], "operation_id": str(uuid4())},
    )
    assert job.status_code == 200
    run(app.state.service)
    assert verify_restored(app.state.service)["status"] == "passed"
    with app.state.db.transaction(scope=company.data["origin"]) as session:
        overlay = session.scalar(select(EngineEstimate).where(EngineEstimate.tenant == company.id))
        corrupted = deepcopy(overlay.estimate)
        # A total that disagrees with its components is rejected by the contract itself.
        metric = corrupted["metrics"]["energy"]
        metric["value"] = str(float(metric["value"]) * 1.00001)
        with pytest.raises(ContractError):
            validate_binding(session, corrupted, overlay.method_id, overlay.view, overlay.original_method_hash)
        # A consistent change to every figure passes the contract; only recomputation finds it.
        corrupted = deepcopy(overlay.estimate)
        for metric in [corrupted["metrics"]["energy"], *(c["metrics"]["energy"] for c in corrupted["components"])]:
            for key in ("value", "scenario_low", "scenario_high"):
                if metric[key] is not None:
                    metric[key] = str(float(metric[key]) * 1.00001)
        validate_binding(session, corrupted, overlay.method_id, overlay.view, overlay.original_method_hash)
        session.execute(
            update(EngineEstimate).where(EngineEstimate.tenant == company.id).values(estimate=corrupted)
        )
    with pytest.raises(RestoreVerificationError, match="restore_engine_estimate_inconsistent"):
        verify_restored(app.state.service)


def test_canonical_request_alias_is_bound_only_after_authenticated_lookup(setup):
    from aift.security import Problem

    app, client, company, member, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    canonical_request, attempt = observations(now[0])
    canonical_request["provider_request_key"] = "e" * 64
    assert upload(client, credentials, [canonical_request]).status_code == 200
    observed_request = {**canonical_request, "request_id": str(uuid4())}
    aliased = upload(client, credentials, [observed_request]).json()["results"][0]
    assert aliased["status"] == "aliased"
    attempt.update(request_id=observed_request["request_id"], proposed_method_id=eco()["method_id"])
    uploaded = upload(client, credentials, [attempt])
    assert uploaded.status_code == 200, uploaded.text
    assert uploaded.json()["results"][0]["status"] == "applied"
    result = client.get(
        "/v1/usage/records/attempt/" + attempt["attempt_id"], headers=auth(credentials)
    ).json()["estimate"]["result"]
    relation = {
        "kind": "canonical_request_alias",
        "observed_request_id": observed_request["request_id"],
        "canonical_request_id": canonical_request["request_id"],
    }
    assert result["source"]["canonical_request_binding"] == {
        k: v for k, v in relation.items() if k != "kind"
    } | {"relation_hash": payload_hash(relation)}
    assert result["source"]["attempt_hash"] == payload_hash(attempt)
    assert result["source"]["request_hash"] == payload_hash(canonical_request)
    with app.state.db.transaction(readonly=True) as session:
        with pytest.raises(Problem, match="estimation_input_unavailable"):
            method_registry.estimate(
                session, attempt, request=canonical_request, tenant=company.id, owner=str(uuid4())
            )
    forged = {**attempt, "canonical_request_binding": result["source"]["canonical_request_binding"]}
    rejected = upload(client, credentials, [forged])
    assert rejected.status_code == 200
    assert rejected.json()["results"][0]["status"] == "rejected"


def test_method_and_input_hashes_match_typescript_exactly():
    import json
    import subprocess

    result, request, attempt = calculation()
    script = """
import fs from 'node:fs';
import {createMethodRegistry} from './packages/estimator/src/engines/methods.ts';
import {prepareObservation,estimationInputHash} from './packages/estimator/src/engines/inputs.ts';
const v=JSON.parse(fs.readFileSync(0,'utf8'));
const registry=createMethodRegistry(JSON.parse(fs.readFileSync('config/estimation.build.json','utf8')),JSON.parse(fs.readFileSync('config/estimation.mappings.json','utf8')),JSON.parse(fs.readFileSync('config/estimation.media.json','utf8')));
const input=prepareObservation({family:'live',request:v.request,attempt:v.attempt});
process.stdout.write(JSON.stringify({method:registry.ecologits,source:input.source,input_hash:estimationInputHash(input,registry.ecologits,registry.ecologits,v.selection)}));
"""
    response = subprocess.run(
        ["node", "--import", "tsx", "--input-type=module", "-e", script],
        cwd=engine_adapter.ROOT,
        input=json.dumps({"request": request, "attempt": attempt, "selection": result["selection"]}),
        text=True,
        capture_output=True,
        timeout=30,
    )
    assert response.returncode == 0, response.stderr
    assert json.loads(response.stdout) == {
        "method": result["requested_method"],
        "source": result["source"],
        "input_hash": result["input_hash"],
    }


def test_history_recovery_cursor_does_not_starve_or_poison_tenant(setup):
    from test_method_history import install_bundle, replacement

    from aift.engine_history import recover_history, selected_history

    app, client, company, member, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    definition = replacement("future-reviewed-method")
    poisoned, eligible = message(now[0], "0" * 64), message(now[0], "1" * 64)
    for row in (poisoned, eligible):
        row["proposed_method_id"] = definition["method_id"]
    eligible["proposed_method_hash"] = payload_hash(definition)
    assert send(client, credentials, page(now[0], [poisoned, eligible])).status_code == 200
    install_bundle(app, now[0], definition)
    for _ in range(3):
        with app.state.db.transaction(scope=company.data["origin"]) as session:
            recover_history(
                app.state.service.analytics, session, get(session, "company", company.id), budget=1
            )
    run(app.state.service)
    with app.state.db.transaction(readonly=True) as session:
        first = session.get(HistoryObservation, (company.id, member.id, poisoned["message_key"]))
        second = session.get(HistoryObservation, (company.id, member.id, eligible["message_key"]))
        assert selected_history(session, first) == {"status": "pending", "reason": "method_update_invalid"}
        assert selected_history(session, second)["metrics"]["energy"]["value"] is not None
    summary = client.get("/v1/me/history/" + "b" * 64 + "/summary", headers=auth(credentials)).json()[
        "history"
    ]
    unknown = [r for r in summary["resources"] if "method_update_invalid" in r["reasons"]]
    assert len(unknown) == 5 and all(
        r["value"] is None and r["unknown_message_count"] == "1" for r in unknown
    )


def test_alias_keeps_archived_overlays_and_counts_one_canonical_attempt(setup):
    app, client, company, member, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, attempt = observations(now[0])
    other = {**deepcopy(attempt), "attempt_id": str(uuid4()), "provider_attempt_key": "c" * 64}
    assert upload(client, credentials, [request, attempt, other]).status_code == 200
    assert (
        client.post(
            "/v1/me/recalculations",
            headers=auth(credentials),
            json={"method_id": eco()["method_id"], "operation_id": str(uuid4())},
        ).status_code
        == 200
    )
    run(app.state.service)
    revised = {**deepcopy(attempt), "revision": 2, "provider_attempt_key": "c" * 64}
    response = upload(client, credentials, [revised])
    expected = min(attempt["attempt_id"], other["attempt_id"])
    assert response.status_code == 200, response.text
    assert response.json()["results"][0]["canonical_id"] == expected
    with app.state.db.transaction(readonly=True) as session:
        originals = list(session.scalars(select(Observation).where(Observation.kind == "attempt")))
        assert len(originals) == 2
        assert [row.id for row in originals if row.status == "current"] == [expected]
        assert sum(row.status == "aliased" for row in originals) == 1
        assert session.scalar(select(func.count()).select_from(EngineEstimate)) == 2
    totals = client.get("/v1/me/summary?period=all&calculation_view=original", headers=auth(credentials)).json()
    assert totals["attempt_count"] == "1"


def test_worker_archives_the_packaged_method_so_the_next_release_still_resolves_it(setup, monkeypatch):
    # 14 Oct 2026: worker recalculations stored estimates under a packaged method that was never
    # archived, and after the next deploy the server could not resolve them.
    app, client, *_ = setup
    login(app, client)
    packaged = method_registry.packaged_identity()[1]
    with app.state.db.transaction(readonly=True) as session:
        assert session.get(method_registry.MethodBundle, packaged["method_id"]) is None
    run(app.state.service)
    with app.state.db.transaction(readonly=True) as session:
        row = session.get(method_registry.MethodBundle, packaged["method_id"])
        assert row.method_hash == packaged["method_hash"]
        assert row.approval == {"trust": "packaged_release"}
    # The next release packages one more mapping, which gives it a different method id.
    following = deepcopy(engine_adapter.packaged_definition())
    mappings = following["mappings"]
    following["mappings"] = {**mappings, "next-release-model": next(iter(mappings.values()))}
    monkeypatch.setattr(engine_adapter, "packaged_definition", lambda: following)
    assert method_registry.packaged_identity()[1]["method_id"] != packaged["method_id"]
    with app.state.db.transaction(readonly=True) as session:
        assert method_registry.resolve_identity(session, packaged["method_id"])[1] == packaged


def test_history_recovery_skips_a_stored_estimate_whose_method_no_longer_resolves(setup):
    from test_method_history import install_bundle, replacement

    from aift.engine_history import recover_history

    app, client, company, member, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    definition = replacement("reviewed-then-unresolvable")
    row = message(now[0], "2" * 64)
    row["proposed_method_id"] = definition["method_id"]
    row["proposed_method_hash"] = payload_hash(definition)
    # The method is unknown at upload, so the record waits for recovery, as on 14 Oct 2026.
    assert send(client, credentials, page(now[0], [row])).status_code == 200
    install_bundle(app, now[0], definition)
    run(app.state.service)
    with app.state.db.transaction(scope="test-unresolvable") as session:
        stored = select(func.count()).select_from(EngineEstimate)
        assert session.scalar(stored.where(EngineEstimate.method_id == definition["method_id"])) == 1
        session.delete(session.get(method_registry.MethodBundle, definition["method_id"]))
    with app.state.db.transaction(scope=company.data["origin"]) as session:
        recover_history(app.state.service.analytics, session, get(session, "company", company.id))
    run(app.state.service)
