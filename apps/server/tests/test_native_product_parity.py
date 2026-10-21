"""Cross-runtime equality of product semantics, and predeclared tolerances for binary64 output."""

import json
import re
import subprocess
from datetime import UTC, datetime

import pytest
from test_analytics import observations, recompose
from test_ecologits_engine import calculation
from test_historical_usage import message, with_answer

from aift import engine_adapter

TYPESCRIPT = """
import fs from 'node:fs';
import {createMethodRegistry} from './packages/estimator/src/engines/methods.ts';
import {LocalEstimateExecutor} from './packages/estimator/src/engines/service.ts';
const registry=createMethodRegistry(JSON.parse(fs.readFileSync('config/estimation.build.json','utf8')),JSON.parse(fs.readFileSync('config/estimation.mappings.json','utf8')),JSON.parse(fs.readFileSync('config/estimation.media.json','utf8')));
const executor=new LocalEstimateExecutor(registry);
const results=[];
for(const input of JSON.parse(fs.readFileSync(0,'utf8'))) results.push(await executor.estimate(input,{methodId:registry.ecologits.method_id}));
process.stdout.write(JSON.stringify(results));
"""


def typescript_estimates(inputs):
    process = subprocess.run(
        ["node", "--import", "tsx", "--input-type=module", "-e", TYPESCRIPT],
        cwd=engine_adapter.ROOT,
        input=json.dumps(inputs),
        text=True,
        capture_output=True,
        timeout=60,
    )
    assert process.returncode == 0, process.stderr
    return json.loads(process.stdout)


def compare(left, right, path=""):
    if isinstance(left, dict):
        assert set(left) == set(right), path
        for key in left:
            if key != "execution_origin":
                compare(left[key], right[key], path + "." + key)
    elif isinstance(left, list):
        assert len(left) == len(right), path
        for a, b in zip(left, right):
            compare(a, b, path)
    elif (
        isinstance(left, str)
        and re.fullmatch(r"[0-9]+(?:\.[0-9]+)?(?:e[+-]?[0-9]+)?", left)
        and not path.endswith("hash")
    ):
        assert float(left) == pytest.approx(float(right), rel=1e-10, abs=1e-16), path
    else:
        assert left == right, path


def test_native_product_envelope_matches_typescript_semantics_and_numbers():
    inputs, expected = [], []
    for site, count in (
        ("chatgpt", "500"),
        ("claude", "23"),
        ("gemini", "1"),
        ("perplexity", "500"),
        ("chatgpt", "0"),
    ):
        value, request, attempt = calculation(count, site)
        inputs.append({"family": "live", "request": request, "attempt": attempt})
        expected.append(value)
    for site, role in (("chatgpt", "response"), ("perplexity", "response"), ("perplexity", "prompt")):
        record = message(datetime(2026, 9, 10, 12, tzinfo=UTC), role=role)
        record["site"] = site
        inputs.append({"family": "history", "record": record})
        expected.append(engine_adapter.estimate(engine_adapter.packaged_definition(), record))
    for model, profile in engine_adapter.packaged_definition()["mappings"]["bindings"].items():
        # Video records are estimated as media components (see the component test below).
        if profile["workload"] != "text":
            continue
        site = model.split("-", 1)[0]
        value, request, attempt = calculation("500", site, model)
        assert value["selection"]["kind"] == "direct_mapping"
        assert value["selection"]["profile"] == profile
        inputs.append({"family": "live", "request": request, "attempt": attempt})
        expected.append(value)
        record = message(datetime(2026, 9, 10, 12, tzinfo=UTC), role="response")
        record.update(site=site, model_id=model)
        value = engine_adapter.estimate(engine_adapter.packaged_definition(), record)
        assert value["selection"]["kind"] == "direct_mapping"
        inputs.append({"family": "history", "record": record})
        expected.append(value)
    compare(typescript_estimates(inputs), expected)



def test_claude_token_factor_is_applied_identically_by_both_runtimes():
    """Owner decision of 15 October 2026: Claude text is estimated from 1.56 times the count."""
    inputs, expected = [], []
    for site, model in (
        ("claude", "claude-opus-5-5"),
        ("perplexity", "perplexity-claude-sonnet-5-5"),
        ("perplexity", "perplexity-best"),
        ("chatgpt", "chatgpt-gpt-5-5"),
    ):
        value, request, attempt = calculation("500", site, model)
        inputs.append({"family": "live", "request": request, "attempt": attempt})
        expected.append(value)
    record = message(datetime(2026, 10, 15, 12, tzinfo=UTC), role="response")
    record.update(site="claude", model_id="claude-opus-5-5")
    inputs.append({"family": "history", "record": record})
    expected.append(engine_adapter.estimate(engine_adapter.packaged_definition(), record))
    main = [next(c for c in value["components"] if c["role"] == "main") for value in expected]
    assert [c["inputs"]["output_tokens"] for c in main] == ["780", "780", "500", "500", "51"]
    compare(typescript_estimates(inputs), expected)

def _measured(count):
    return {
        "value": count,
        "evidence": "heuristic_estimate",
        "scope": "observed_text",
        "completeness": "complete_for_scope",
        "profile_id": "o200k-base-4.0.0-reference",
        "reason": "tokenizer_mapping_unverified",
    }


def _live(site, model, answer, generation):
    request, attempt = observations(datetime(2026, 10, 4, 12, tzinfo=UTC), answer)
    request.update(site=site, model_id=model)
    attempt["model_id"] = model
    attempt["model_evidence"] = request["model_evidence"] = "unknown" if model is None else "response_field"
    for part in ("visible_thinking", "tool_input", "intermediate_output"):
        attempt["tokens"][part] = _measured("0")
    attempt["generation"] = generation
    recompose(attempt)
    return request, attempt


def _image(model, count="1", width=None, height=None, outcome="returned"):
    return {"kind": "image", "model_id": model, "count": count, "width": width, "height": height, "outcome": outcome}


def _video(model, width=None, height=None, duration=None, audio=None):
    return {
        "kind": "video",
        "model_id": model,
        "width": width,
        "height": height,
        "duration_seconds": duration,
        "with_audio": audio,
    }


def test_native_component_envelopes_match_typescript_methods():
    """Images, speech, video, NotebookLM overviews, other-model text and the GLM grid."""
    definition = engine_adapter.packaged_definition()
    timing = {
        "duration_seconds": "4.25",
        "source": "browser_request",
        "scope": "request",
        "completeness": "complete_for_scope",
        "profile_version": "timing-observation-1",
    }
    live_cases = [
        (
            "chatgpt",
            "chatgpt-gpt-5-5",
            "120",
            {
                "text_components": [],
                "media": [
                    _image("chatgpt-images-2-5", "2", 1024, 1536),
                    _image(None, "1", outcome="started_not_returned"),
                    {"kind": "speech", "length_basis": "characters", "seconds": None, "characters": "55"},
                    {"kind": "speech", "length_basis": "audio_frames", "seconds": "24.576", "characters": None},
                ],
            },
        ),
        ("perplexity", "perplexity-best", "60", {"text_components": [], "media": [_video("perplexity-veo-3-0-fast")]}),
        ("perplexity", None, "0", {"text_components": [], "media": [_image(None), _video("perplexity-sora-2-pro")]}),
        ("perplexity", "perplexity-glm-5-3", "500", {"text_components": [], "media": []}),
        ("perplexity", "perplexity-glm-5-2", "200", {"text_components": [], "media": []}),
        (
            "gemini",
            "gemini-omni",
            "0",
            {
                "text_components": [
                    {
                        "role": "storyboard",
                        "model_id": None,
                        "model_evidence": "unknown",
                        "tokens": _measured("954"),
                        "timing": None,
                    }
                ],
                "media": [_video("gemini-omni-video", 1280, 720, "10")],
            },
        ),
        (
            "gemini",
            "gemini-3-8-flash",
            "200",
            {"text_components": [], "media": [_video(None, 1280, 720, "8", True), _image("gemini-nano-banana-2")]},
        ),
        # ChatGPT has no video stand-in, so an unnamed video there stays unavailable.
        ("chatgpt", "chatgpt-gpt-5-5", "200", {"text_components": [], "media": [_video(None, 1280, 720, "8", True)]}),
        (
            "claude",
            "claude-opus-5-5",
            "300",
            {
                "text_components": [
                    {
                        "role": "side_calls",
                        "model_id": "claude-haiku-4-5",
                        "model_evidence": "response_field",
                        "tokens": _measured("80"),
                        "timing": timing,
                    },
                    {
                        "role": "research",
                        "model_id": "claude-unlisted",
                        "model_evidence": "response_field",
                        "tokens": _measured("40"),
                        "timing": {**timing, "completeness": "partial"},
                    },
                ],
                "media": [
                    _image(None),
                    {"kind": "speech", "length_basis": "stored_length", "seconds": "12.5", "characters": None},
                ],
            },
        ),
        # Unknown versions of a named family use the family's newest record (13 October 2026).
        ("claude", "claude-haiku-unlisted", "19724", {"text_components": [], "media": []}),
        ("perplexity", "perplexity-gemini-flash-lite-unlisted", "300", {"text_components": [], "media": []}),
        # Unknown variants use their variant's or kind's newest record (14 October 2026).
        ("chatgpt", "chatgpt-gpt-pro-unlisted", "300", {"text_components": [], "media": []}),
        ("claude", "claude-small-unlisted", "300", {"text_components": [], "media": []}),
    ]
    inputs, expected = [], []
    for site, model, answer, generation in live_cases:
        request, attempt = _live(site, model, answer, generation)
        inputs.append({"family": "live", "request": request, "attempt": attempt})
        expected.append(engine_adapter.estimate(definition, attempt, request))
    # A NotebookLM overview reply has no text of its own; its total stays its parts' sum.
    overview = with_answer(message(datetime(2026, 10, 4, 12, tzinfo=UTC)), **_measured("0"))
    overview.update(
        site="notebooklm",
        model_id="notebooklm-default",
        # Every NotebookLM saved row is a Studio item without a live request (W9).
        coverage_reasons=[*overview["coverage_reasons"], "no_live_request"],
        generation={
            "text_components": [],
            "media": [
                {"kind": "video_overview", "duration_seconds": "86.83"},
                {"kind": "speech", "length_basis": "stored_length", "seconds": "394.24", "characters": None},
                _image("notebooklm-image", "8", 1376, 768),
            ],
        },
    )
    method = engine_adapter.identity(definition)
    overview.update(proposed_method_id=method["method_id"], proposed_method_hash=method["method_hash"])
    inputs.append({"family": "history", "record": overview})
    expected.append(engine_adapter.estimate(definition, overview))
    actual = typescript_estimates(inputs)
    compare(actual, expected)
    # The cases reach every component kind and the unavailable path.
    kinds = {(c["kind"], c["role"]) for result in expected for c in result["components"]}
    assert {
        ("text", "main"),
        ("text", "storyboard"),
        ("text", "side_calls"),
        ("text", "research"),
        ("image", "generated_image"),
        ("image", "overview_illustrations"),
        ("speech", "generated_speech"),
        ("speech", "overview_narration"),
        ("video", "generated_video"),
    } <= kinds
    assert any("component_unavailable" in result["reasons"] for result in expected)
    unnamed = next(c for c in expected[6]["components"] if c["kind"] == "video")
    assert unnamed["status"] == "estimated"
    assert unnamed["selection"]["basis"] == "model_not_named"
    assert unnamed["inputs"]["defaults_applied"][0] == "model"
    glm = expected[3]["components"][0]
    assert glm["inputs"]["electricity_mix_zone"] == "USA"
    assert "environment_override" in glm["reasons"]
    _assert_glm_us_factors(expected[3], "zai-glm-5-3")
    _assert_glm_us_factors(expected[4], "zai-glm-5-2")
    stand_ins = expected[len(live_cases) - 4 : len(live_cases)]
    for result, record in zip(
        stand_ins,
        (
            ("claude-haiku-4-5", "model_family_stand_in"),
            ("gemini-3.5-flash-lite", "model_family_stand_in"),
            ("gpt-5.5-pro", "model_variant_stand_in"),
            ("claude-haiku-4-5", "model_kind_stand_in"),
        ),
        strict=True,
    ):
        selection = result["components"][0]["selection"]
        assert (selection["profile"]["model_name"], selection["basis"]) == record


def _assert_glm_us_factors(result, record):
    """GLM through Perplexity uses its zai record, the USA grid and EcoLogits' US multi-cloud
    PUE and WUE (its huggingface_hub configuration), not Mistral's (owner, 15 October 2026)."""
    from ecologits.electricity_mix_repository import electricity_mixes
    from ecologits.impacts.llm import compute_llm_impacts
    from ecologits.model_repository import models
    from ecologits.tracers.utils import PROVIDER_CONFIG_MAP, ImpactsOutput, llm_impacts

    component = result["components"][0]
    assert component["selection"]["profile"] == {"provider": "mistralai", "model_name": record, "workload": "text"}
    model = models.find_model(provider="mistralai", model_name=record)
    assert model.deployment is None or model.deployment.tps is None
    us, usa = PROVIDER_CONFIG_MAP["huggingface_hub"], electricity_mixes.find_electricity_mix(zone="USA")
    tokens = int(component["inputs"]["output_tokens"])
    latency = component["inputs"]["latency_seconds"]
    latency = None if latency is None else float(latency)
    impacts = compute_llm_impacts(
        model_active_parameter_count=model.architecture.parameters.active,
        model_total_parameter_count=model.architecture.parameters.total,
        output_token_count=tokens,
        request_latency=latency,
        if_electricity_mix_adpe=usa.adpe,
        if_electricity_mix_pe=usa.pe,
        if_electricity_mix_gwp=usa.gwp,
        if_electricity_mix_wue=usa.wue,
        datacenter_pue=us.datacenter_pue,
        datacenter_wue=us.datacenter_wue,
        tps=None,
        ttft=None,
    )
    expected = engine_adapter.serialize(ImpactsOutput.model_validate(impacts.model_dump()))
    for key in ("energy", "gwp", "wcf", "usage", "embodied"):
        assert component["raw"][key] == expected[key], key
    mistral = engine_adapter.serialize(llm_impacts("mistralai", record, tokens, latency, electricity_mix_zone="USA"))
    assert component["raw"]["usage"]["energy"] != mistral["usage"]["energy"]
    assert component["raw"]["wcf"] != mistral["wcf"]


def test_server_current_history_summaries_parse_with_shared_typescript_contract(setup):
    from test_historical_usage import auth, page, paired, send

    _, client, _, _, now, credentials = paired(setup)
    original = message(now[0])
    original["site"] = "chatgpt"
    body = {**page(now[0], [original]), "site": "chatgpt"}
    assert send(client, credentials, body).status_code == 200
    path = "/v1/me/history/" + "b" * 64 + "/summary"
    v1 = client.get(path, headers=auth(credentials)).json()["history"]
    native = message(now[0], "c" * 64)
    native["site"] = "chatgpt"
    method = engine_adapter.identity(engine_adapter.packaged_definition())
    native.update(proposed_method_id=method["method_id"], proposed_method_hash=method["method_hash"])
    unknown = {**message(now[0], "d" * 64), "site": "chatgpt", "proposed_method_id": "future-unknown"}
    assert (
        send(client, credentials, {**page(now[0], [native, unknown]), "site": "chatgpt"}).status_code == 200
    )
    response = client.get(path, headers=auth(credentials))
    assert response.status_code == 200, response.text
    v2 = response.json()["history"]
    assert v1["schema_version"] == "3.0.0" and v2["schema_version"] == "3.0.0"
    script = """
import fs from 'node:fs';
import {HistorySummarySchema} from './packages/contracts/src/index.ts';
for(const value of JSON.parse(fs.readFileSync(0,'utf8'))) HistorySummarySchema.parse(value);
"""
    process = subprocess.run(
        ["node", "--import", "tsx", "--input-type=module", "-e", script],
        cwd=engine_adapter.ROOT,
        input=json.dumps([v1, v2]),
        text=True,
        capture_output=True,
        timeout=30,
    )
    assert process.returncode == 0, process.stderr
