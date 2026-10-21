import json
from copy import deepcopy
from pathlib import Path

import pytest
from estimation_contracts import (
    calculation_input_hash,
    validate_build_configuration,
    validate_engine_preference,
    validate_estimation_envelope,
    validate_method_definition,
)
from footprint_contracts import ContractError, canonical_json, history_response_parts, payload_hash

ROOT = Path(__file__).resolve().parents[3]
FROZEN = json.loads((ROOT / "packages/estimator/test/fixtures/legacy-refinement.json").read_text())
BUILD = json.loads((ROOT / "config/estimation.build.json").read_text())
BASELINE = json.loads((ROOT / "packages/estimator/data/baseline.json").read_text())
CORE = json.loads((ROOT / "packages/ecologits-core/data/identity.json").read_text())
MAPPINGS = json.loads((ROOT / "config/estimation.mappings.json").read_text())
MEDIA = json.loads((ROOT / "config/estimation.media.json").read_text())
# Results saved before the image benchmark data was removed on 20 October 2026 may still hold
# references; this record (without figures) keeps them readable.
RETIRED_REFERENCE = FROZEN["retired_image_reference"]
IMAGE_HASH = RETIRED_REFERENCE["cohort_hash"]


def definition():
    return deepcopy(
        {
            "schema_version": "1.0.0",
            "engine_id": "ecologits",
            "core": CORE,
            "mappings": MAPPINGS,
            "fallback": BUILD["ecologits_fallback"],
            "media": MEDIA,
            "product_policy": "operational-only-output-1",
            "latency_policy": "observed-live-then-history-then-modeled-1",
            "environment_policy": "upstream-provider-default-assumed",
            "water_total_policy": "upstream-wcf-1",
            "original_fallback": {
                "method_id": FROZEN["provenance"]["method_id"],
                "method_hash": FROZEN["provenance"]["method_hash"],
            },
        }
    )


def identity(engine="ecologits"):
    method = definition()
    return {
        "engine_id": engine,
        "implementation_version": CORE["core_version"] if engine == "ecologits" else BASELINE["equation_id"],
        "method_id": f"ecologits-{CORE['upstream_version']}-{payload_hash(method)}"
        if engine == "ecologits"
        else BASELINE["method_id"],
        "method_hash": payload_hash(method) if engine == "ecologits" else payload_hash(BASELINE),
        "source_version": CORE["upstream_version"] if engine == "ecologits" else None,
        "source_commit": CORE["requested_git_commit"] if engine == "ecologits" else None,
        "catalog_hash": CORE["catalog_sha256"],
        "profile_policy_hash": payload_hash(
            {"mappings": method["mappings"], "fallback": method["fallback"], "media": method["media"]}
        ),
        "environment_policy_hash": payload_hash(
            {
                "catalog": CORE["catalog_sha256"],
                "environment": method["environment_policy"],
                "water": method["water_total_policy"],
            }
        ),
        "product_scope": "operational-only",
    }


def product_metric(name, value="1", scope="modeled_text_component"):
    return {
        "value": value,
        "unit": "kWh" if name == "energy" else "gCO2e" if name == "carbon" else "L",
        "status": "unavailable" if value is None else "partial_estimate",
        "scope": scope,
        "phase": "usage",
        "scenario_low": None,
        "scenario_high": None,
        "interval_kind": None,
        "value_kind": "unavailable" if value is None else "scalar",
        "reasons": [],
    }


def upstream():
    metrics = {
        key: {"type": kind, "name": name, "unit": unit, "value": "1"}
        for key, kind, name, unit in (
            ("energy", "energy", "Energy", "kWh"),
            ("gwp", "GWP", "Global Warming Potential", "kgCO2eq"),
            ("adpe", "ADPe", "Abiotic Depletion Potential (elements)", "kgSbeq"),
            ("pe", "PE", "Primary Energy", "MJ"),
            ("wcf", "WCF", "Water Consumption Footprint", "L"),
        )
    }
    return {
        **deepcopy(metrics),
        "usage": {"type": "usage", "name": "Usage", **deepcopy(metrics)},
        "embodied": {
            "type": "embodied",
            "name": "Embodied",
            **{key: deepcopy(metrics[key]) for key in ("gwp", "adpe", "pe")},
        },
        "warnings": None,
        "errors": None,
    }


def rehash(value):
    value["input_hash"] = payload_hash(
        {
            "schema_version": "3.0.0",
            "source": value["source"],
            "requested_method_hash": value["requested_method"]["method_hash"],
            "effective_method_hash": value["effective_method"]["method_hash"],
            "selection": value["selection"],
            "auxiliary_method_hashes": value["auxiliary_method_hashes"],
        }
    )
    return value


def envelope():
    source = {
        "family": "live",
        "request_id": "00000000-0000-4000-8000-000000000001",
        "request_revision": 1,
        "request_hash": "a" * 64,
        "attempt_id": "00000000-0000-4000-8000-000000000002",
        "attempt_revision": 1,
        "attempt_hash": "b" * 64,
    }
    result = {
        "schema_version": "3.0.0",
        "source": source,
        "auxiliary_method_hashes": {"image_reference": IMAGE_HASH},
        "requested_method": identity(),
        "effective_method": identity(),
        "execution_origin": "organization",
        "view": "original",
        "original_method_hash": None,
        "selection": {
            "kind": "direct_mapping",
            "observed_model_id": "chatgpt-gpt-5-5",
            "profile": {"provider": "openai", "model_name": "gpt-5.5", "workload": "text"},
            "reason": None,
            "basis": "exact_record",
        },
        "raw": {"engine_id": "ecologits", "result": upstream()},
        # An EcoLogits total is the sum of its components, so the fixture carries the
        # main text component that the top-level figures add up from.
        "components": [
            {
                "component_id": "text_0",
                "kind": "text",
                "role": "main",
                "method_id": identity()["method_id"],
                "selection": {
                    "kind": "direct_mapping",
                    "observed_model_id": "chatgpt-gpt-5-5",
                    "profile": {"provider": "openai", "model_name": "gpt-5.5", "workload": "text"},
                    "reason": None,
                    "basis": "exact_record",
                },
                "inputs": {
                    "output_tokens": "100",
                    "latency_seconds": "1",
                    "latency_basis": "measured",
                    "environment_provider": "openai",
                    "electricity_mix_zone": None,
                    "units": None,
                    "width": None,
                    "height": None,
                    "duration_seconds": None,
                    "with_audio": None,
                    "audio_seconds": None,
                    "defaults_applied": [],
                },
                "raw": upstream(),
                "status": "estimated",
                "metrics": {
                    name: product_metric(name, None if name == "water_total" else "1")
                    for name in ("energy", "carbon", "water_direct", "water_upstream", "water_total")
                },
                "reasons": [],
            }
        ],
        "image_references": [],
        "status": "estimated",
        "metrics": {
            name: product_metric(name, None if name == "water_total" else "1")
            for name in ("energy", "carbon", "water_direct", "water_upstream", "water_total")
        },
        "reasons": [],
        "missing_components": ["hidden_reasoning"],
        "validation_state": "unvalidated_reference",
        "comparability": {
            "energy_boundary": "facility",
            "carbon_boundary": "unknown",
            "carbon_accounting": "location",
            "water_kind": "consumption",
            "direct_water_source": "unknown",
            "upstream_water_source": "unknown",
            "common_water_scope": None,
            "tokenizer_profile_id": None,
        },
    }
    return rehash(result)


def set_energy(result, **updates):
    """Changes the energy figure of the main component and the total that sums it."""
    for metric in (result["metrics"]["energy"], result["components"][0]["metrics"]["energy"]):
        metric.update(updates)


def raws(value):
    """The top-level raw output and the main component's, which must stay identical."""
    return (value["raw"]["result"], value["components"][0]["raw"])


def original_envelope(entry, family):
    result = envelope()
    result["requested_method"] = identity("original")
    result["effective_method"] = identity("original")
    result["selection"].update(kind="legacy_reference", profile=None, basis=None)
    # The original engine has no components; its figures are the frozen legacy ones.
    result["components"] = []
    original = deepcopy(entry["expected"])
    result["selection"]["observed_model_id"] = entry["observation"].get("model_id")
    if family == "history":
        result["source"] = {"family": "history", "message_key": "a" * 64, "observation_hash": "b" * 64}
        legacy = {metric["quantity"]: metric for metric in original}
    else:
        result["source"].update(
            attempt_hash=original["observation_hash"],
            attempt_id=original["attempt_id"],
            attempt_revision=original["observation_revision"],
        )
        legacy = original["metrics"]
        result["selection"]["observed_model_id"] = original["observed_model_key"]
    result["metrics"] = {
        name: product_metric(
            name,
            legacy.get(name, {}).get("value"),
            "historical_visible_response" if family == "history" else "modeled_text_component",
        )
        for name in result["metrics"]
    }
    result["raw"] = {"engine_id": "original", "result": original}
    result["image_references"] = [] if family == "history" else deepcopy(original["image_references"])
    result["status"] = (
        "estimated" if any(m["value"] is not None for m in result["metrics"].values()) else "unavailable"
    )
    return rehash(result)


def set_path(value, path, replacement):
    target = value
    for field in path[:-1]:
        target = target[field]
    target[path[-1]] = replacement


def rejected(value, validator=validate_estimation_envelope):
    with pytest.raises(ContractError) as error:
        validator(value)
    assert str(error.value) == error.value.code == "payload_rejected"


@pytest.mark.parametrize("family", ["live", "history"])
def test_frozen_legacy_results_keep_original_canonical_bytes(family):
    for entry in FROZEN[family]:
        value = original_envelope(entry, family)
        before = canonical_json(value)
        assert validate_estimation_envelope(value) is value, entry["name"]
        assert canonical_json(value) == before
        assert canonical_json(value["raw"]["result"]) == canonical_json(entry["expected"])


def test_shipping_policy_definition_and_hashes_survive_validation():
    build, method, result = deepcopy(BUILD), definition(), envelope()
    assert validate_build_configuration(build) is build
    before = payload_hash(method)
    assert validate_method_definition(method) is method
    assert payload_hash(method) == before == payload_hash(dict(reversed(list(method.items()))))
    assert result["requested_method"]["method_hash"] == before
    assert validate_estimation_envelope(result) is result
    changed = deepcopy(method)
    changed["original_fallback"]["method_hash"] = "0" * 64
    assert payload_hash(validate_method_definition(changed)) != before


def test_environment_override_accepts_pue_and_wue_like_the_typescript_contract():
    # The shipped GLM overrides carry EcoLogits' US multi-cloud ranges (owner, 15 October 2026).
    assert MEDIA["environment_overrides"]["perplexity-glm-5-3"] == {
        "electricity_mix_zone": "USA",
        "datacenter_pue": {"min": "1.09", "max": "1.14"},
        "datacenter_wue": {"min": "0.13", "max": "0.99"},
    }
    for override in (
        {"electricity_mix_zone": "USA"},
        {"electricity_mix_zone": "USA", "datacenter_pue": "1.2", "datacenter_wue": {"min": "0.13", "max": "0.99"}},
    ):
        method = definition()
        method["media"]["environment_overrides"] = {"test-model": override}
        assert validate_method_definition(method) is method


@pytest.mark.parametrize(
    "override",
    [
        {"datacenter_pue": "1.1"},
        {"electricity_mix_zone": "USA", "datacenter_location": "USA"},
        {"electricity_mix_zone": "USA", "gwp": "0.4"},
        {"electricity_mix_zone": "USA", "datacenter_pue": 1.1},
        {"electricity_mix_zone": "USA", "datacenter_pue": "0.9"},
        {"electricity_mix_zone": "USA", "datacenter_pue": {"min": "0.95", "max": "1.1"}},
        {"electricity_mix_zone": "USA", "datacenter_wue": {"min": "0.99", "max": "0.13"}},
        {"electricity_mix_zone": "USA", "datacenter_wue": {"min": "0.13"}},
        {"electricity_mix_zone": "USA", "datacenter_wue": {"min": "0.13", "max": "0.99", "mean": "0.5"}},
        {"electricity_mix_zone": "USA", "datacenter_wue": "0"},
        {"electricity_mix_zone": "USA", "datacenter_wue": "-1"},
    ],
)
def test_environment_override_rejects_unknown_keys_and_invalid_factors(override):
    method = definition()
    method["media"]["environment_overrides"] = {"test-model": override}
    rejected(method, validate_method_definition)


@pytest.mark.parametrize("field", ["provider_defaults", "model_overrides", "bindings"])
def test_policy_map_boundaries(field):
    method = definition()
    mapping = method["mappings"] if field == "bindings" else method["fallback"]
    maximum = 64 if field == "provider_defaults" else 4096
    entry = (
        {"provider": "openai", "model_name": "gpt-5.5", "workload": "text"}
        if field == "bindings"
        else {"strategy": "unavailable"}
    )
    mapping[field] = {f"entry{n}": entry for n in range(maximum)}
    assert validate_method_definition(method) is method
    mapping[field]["overflow"] = entry
    rejected(method, validate_method_definition)


def test_provider_flagship_cannot_cross_provider_and_unknown_cannot_invent_profile():
    build = deepcopy(BUILD)
    build["ecologits_fallback"]["provider_defaults"]["openai"]["profile"]["provider"] = "anthropic"
    rejected(build, validate_build_configuration)
    method = definition()
    method["fallback"] = build["ecologits_fallback"]
    rejected(method, validate_method_definition)
    build = deepcopy(BUILD)
    build["ecologits_fallback"]["unknown_provider"] = build["ecologits_fallback"]["provider_defaults"][
        "openai"
    ]
    assert validate_build_configuration(build) is build
    profile = build["ecologits_fallback"]["unknown_provider"]["profile"]
    for unknown in (
        {"strategy": "upstream_provider_flagship"},
        {"strategy": "upstream_profile", "profile": profile},
        {"strategy": "original_engine", "profile": profile},
    ):
        broken = deepcopy(BUILD)
        broken["ecologits_fallback"]["unknown_provider"] = unknown
        rejected(broken, validate_build_configuration)


@pytest.mark.parametrize("revision", [True, 0, -1, 1.5, 2147483648, "1", 9007199254740992])
def test_selection_counter_rejects_unsafe_or_coerced_values(revision):
    value = {
        "schema_version": "1.0.0",
        "preference": "ecologits",
        "selection_revision": revision,
        "updated_at": "2026-09-14T12:00:00.000Z",
    }
    rejected(value, validate_engine_preference)
    result = envelope()
    result["source"]["attempt_revision"] = revision
    rejected(result)


@pytest.mark.parametrize(
    "instant",
    [
        "2026-02-29T12:00:00.000Z",
        "2026-09-31T12:00:00.000Z",
        "2026-09-14T24:00:00.000Z",
        "2026-09-14T12:00:00Z",
        "2026-09-14T12:00:00.000+00:00",
    ],
)
def test_preference_requires_real_canonical_instant(instant):
    value = {
        "schema_version": "1.0.0",
        "preference": "build_default",
        "selection_revision": 1,
        "updated_at": instant,
    }
    rejected(value, validate_engine_preference)


@pytest.mark.parametrize("day", ["2024-02-29", "0000-02-29", "9999-12-31"])
def test_preference_accepts_calendar_domain_and_maximum_selection_revision(day):
    value = {
        "schema_version": "1.0.0",
        "preference": "original",
        "selection_revision": 2147483647,
        "updated_at": day + "T12:00:00.000Z",
    }
    assert validate_engine_preference(value) is value


@pytest.mark.parametrize("day", ["2026-02-29", "2026-13-01", "2026-09-31", "2026-01-00"])
def test_review_dates_reject_impossible_calendar_days(day):
    value = definition()
    value["fallback"]["review_date"] = day
    rejected(value, validate_method_definition)
    value = definition()
    value["mappings"]["review_date"] = day
    rejected(value, validate_method_definition)


def test_review_date_allows_year_zero_like_the_typescript_contract():
    value = definition()
    value["fallback"]["review_date"] = "0000-02-29"
    value["mappings"]["review_date"] = "0000-02-29"
    assert validate_method_definition(value) is value


@pytest.mark.parametrize(
    "number",
    [
        "-1",
        "-0",
        "-0.0e+3",
        "1e999",
        "1e-999",
        "1e-324",
        "NaN",
        "Infinity",
        "01",
        "1E2",
        "1." + "0" * 96,
        1.0,
        None,
    ],
)
@pytest.mark.parametrize(
    "path",
    [
        ("metrics", "energy", "value"),
        ("raw", "result", "usage", "energy", "value"),
        ("raw", "result", "embodied", "gwp", "value"),
        ("raw", "result", "wcf", "value"),
    ],
)
def test_all_numeric_phases_reject_invalid_decimal_domain(number, path):
    value = envelope()
    set_path(value, path, number)
    rejected(value)


@pytest.mark.parametrize("number", ["0", "0.0e-999", "5e-324", "1.7976931348623157e+308"])
def test_binary64_domain_includes_zero_subnormal_and_finite_maximum(number):
    value = envelope()
    set_energy(value, value=number)
    for raw in raws(value):
        raw["usage"]["energy"]["value"] = number
    assert validate_estimation_envelope(value) is value


@pytest.mark.parametrize("low,high", [("2", "1"), ("-1", "2"), ("0", "1e999"), ("1e-999", "2")])
def test_raw_ranges_reject_reversal_and_invalid_endpoints(low, high):
    value = envelope()
    for raw in raws(value):
        raw["usage"]["energy"]["value"] = {"min": low, "max": high}
    rejected(value)


@pytest.mark.parametrize(
    "updates",
    [
        {"status": "unavailable"},
        {"value_kind": "unavailable"},
        {"scenario_low": "0"},
        {"interval_kind": "scenario"},
        {"value_kind": "midpoint"},
        {
            "value": "3",
            "scenario_low": "1",
            "scenario_high": "2",
            "value_kind": "midpoint",
            "interval_kind": "upstream_approximation",
        },
    ],
)
def test_product_interval_and_availability_are_consistent(updates):
    value = envelope()
    set_energy(value, **updates)
    rejected(value)


def test_degenerate_and_non_degenerate_intervals_remain_intact():
    for low, high in [("1", "1"), ("0", "2")]:
        value = envelope()
        set_energy(
            value,
            scenario_low=low,
            scenario_high=high,
            value_kind="midpoint",
            interval_kind="upstream_approximation",
        )
        for raw in raws(value):
            raw["usage"]["energy"]["value"] = {"min": low, "max": high}
        assert validate_estimation_envelope(value) is value


@pytest.mark.parametrize(
    "path,replacement",
    [
        (("raw", "result", "usage", "gwp", "unit"), "gCO2e"),
        (("raw", "result", "usage", "type"), "embodied"),
        (("metrics", "energy", "unit"), "L"),
        (("metrics", "carbon", "unit"), "kWh"),
        (("metrics", "water_direct", "unit"), "gCO2"),
        (("metrics", "energy", "phase"), "embodied"),
        (("input_hash",), "G" * 64),
        (("source", "attempt_hash"), "abc"),
        (("effective_method", "method_hash"), "PRIVATE_SECRET"),
        (("requested_method", "source_commit"), "g" * 40),
        (("view",), "recalculated"),
        (("raw",), None),
        (("status",), "unavailable"),
    ],
)
def test_units_phase_lineage_hashes_and_success_evidence_are_strict(path, replacement):
    value = envelope()
    set_path(value, path, replacement)
    rejected(value)


def test_upstream_error_result_has_only_null_impacts_and_unavailable_metrics():
    value = envelope()
    value["status"] = "unavailable"
    main = value["components"][0]
    main["status"] = "unavailable"
    for figures in (value, main):
        figures["metrics"] = {name: product_metric(name, None) for name in figures["metrics"]}
    for raw in raws(value):
        raw.update({name: None for name in ("energy", "gwp", "adpe", "pe", "wcf", "usage", "embodied")})
        raw["errors"] = [{"code": "model_not_found", "message": "Model not found"}]
    assert validate_estimation_envelope(value) is value
    for raw in raws(value):
        raw["energy"] = upstream()["energy"]
    rejected(value)
    value = envelope()
    for raw in raws(value):
        raw["usage"] = None
    rejected(value)
    value = envelope()
    for raw in raws(value):
        raw["errors"] = [{"code": "source_error", "message": "Unavailable"}]
    rejected(value)
    # The top-level raw output cannot differ from the main component's.
    value = envelope()
    value["raw"]["result"]["usage"]["energy"]["value"] = "2"
    rejected(value)
    # Two halves add up to the total, but only one text component is the main reply.
    value = envelope()
    second = {**deepcopy(value["components"][0]), "component_id": "text_1", "role": "side_calls"}
    value["components"].append(second)
    for component in value["components"]:
        component["metrics"] = {
            name: product_metric(name, None if name == "water_total" else "0.5")
            for name in component["metrics"]
        }
    assert validate_estimation_envelope(value) is value
    second["role"] = "main"
    rejected(value)


def test_original_fallback_preserves_parent_child_identity_and_raw_bytes():
    value = original_envelope(FROZEN["live"][1], "live")
    raw_hash = payload_hash(value["raw"]["result"])
    value["requested_method"] = identity()
    value["selection"]["kind"] = "original_fallback"
    rehash(value)
    assert validate_estimation_envelope(value) is value
    assert payload_hash(value["raw"]["result"]) == raw_hash
    value["selection"]["kind"] = "provider_flagship"
    rehash(value)
    rejected(value)
    value = envelope()
    value["requested_method"] = identity("original")
    rehash(value)
    rejected(value)
    value = envelope()
    value["effective_method"] = identity("original")
    value["selection"]["kind"] = "original_fallback"
    rehash(value)
    rejected(value)


@pytest.mark.parametrize(
    "field,replacement",
    [
        ("observation_hash", "c" * 64),
        ("observation_revision", 2),
        ("attempt_id", "00000000-0000-4000-8000-000000000009"),
        ("method_hash", "c" * 64),
        ("method_id", "other-method"),
    ],
)
def test_live_original_raw_binding_cannot_be_replayed_against_another_source(field, replacement):
    value = original_envelope(FROZEN["live"][1], "live")
    value["raw"]["result"][field] = replacement
    rejected(value)


def request_alias(source):
    relation = {
        "kind": "canonical_request_alias",
        "observed_request_id": "00000000-0000-4000-8000-000000000099",
        "canonical_request_id": source["request_id"],
    }
    return {
        "observed_request_id": relation["observed_request_id"],
        "canonical_request_id": relation["canonical_request_id"],
        "relation_hash": payload_hash(relation),
    }


@pytest.mark.parametrize("engine", ["original", "ecologits"])
def test_live_canonical_request_alias_retains_attempt_hash_and_exact_raw_output(engine):
    value = original_envelope(FROZEN["live"][1], "live") if engine == "original" else envelope()
    before = canonical_json(value["raw"])
    attempt_hash = value["source"]["attempt_hash"]
    value["source"]["canonical_request_binding"] = request_alias(value["source"])
    rehash(value)
    assert validate_estimation_envelope(value) is value
    assert canonical_json(value["raw"]) == before
    assert value["source"]["attempt_hash"] == attempt_hash
    if engine == "original":
        assert value["raw"]["result"]["observation_hash"] == attempt_hash
        value["raw"]["result"]["observation_hash"] = "f" * 64
        rejected(value)


@pytest.mark.parametrize(
    "changed",
    [
        "canonical_request",
        "same_request",
        "hash",
        "hash_domain",
        "missing",
        "extra",
        "invalid_uuid",
        "source_request",
    ],
)
def test_canonical_request_alias_rejects_wrong_identity_or_relation_hash(changed):
    value = envelope()
    binding = request_alias(value["source"])
    value["source"]["canonical_request_binding"] = binding
    if changed == "canonical_request":
        binding["canonical_request_id"] = "00000000-0000-4000-8000-000000000077"
    elif changed == "same_request":
        binding["observed_request_id"] = binding["canonical_request_id"]
    if changed in {"canonical_request", "same_request"}:
        binding["relation_hash"] = payload_hash(
            {
                "kind": "canonical_request_alias",
                "observed_request_id": binding["observed_request_id"],
                "canonical_request_id": binding["canonical_request_id"],
            }
        )
    elif changed == "hash":
        binding["relation_hash"] = "f" * 64
    elif changed == "hash_domain":
        binding["relation_hash"] = payload_hash(
            {
                "kind": "another_relation",
                "observed_request_id": binding["observed_request_id"],
                "canonical_request_id": binding["canonical_request_id"],
            }
        )
    elif changed == "missing":
        del binding["relation_hash"]
    elif changed == "extra":
        binding["tenant_id"] = "PRIVATE_SECRET"
    elif changed == "invalid_uuid":
        binding["observed_request_id"] = "not-a-uuid"
    elif changed == "source_request":
        value["source"]["request_id"] = "00000000-0000-4000-8000-000000000077"
    rehash(value)
    rejected(value)


def test_canonical_request_alias_is_not_a_history_source_field():
    value = original_envelope(FROZEN["history"][1], "history")
    value["source"]["canonical_request_binding"] = request_alias(envelope()["source"])
    rehash(value)
    rejected(value)


def test_original_history_rejects_incomplete_duplicate_and_wrong_method_metrics():
    entry = next(item for item in FROZEN["history"] if len(item["expected"]) == 5)
    for change in ("missing", "duplicate", "method_hash", "method_id", "counter", "decimal"):
        value = original_envelope(entry, "history")
        raw = value["raw"]["result"]
        if change == "missing":
            raw.pop()
        elif change == "duplicate":
            raw[1] = deepcopy(raw[0])
        elif change == "counter":
            raw[0]["known_message_count"] = "9223372036854775808"
        elif change == "decimal":
            raw[0]["value"] = "1" * 39
        else:
            raw[0][change] = "f" * 64 if change == "method_hash" else "wrong-method"
        rejected(value)


def test_original_family_and_legacy_factor_domains_are_validated():
    value = original_envelope(FROZEN["live"][1], "live")
    value["source"] = {"family": "history", "message_key": "a" * 64, "observation_hash": "b" * 64}
    rehash(value)
    rejected(value)
    for name, number in [
        ("pue", "0.99"),
        ("carbon", "1000000000"),
        ("direct_water", "1" * 400),
        ("upstream_water", "1000000000"),
    ]:
        value = original_envelope(FROZEN["live"][1], "live")
        value["raw"]["result"]["environment_provenance"][name] = number
        rejected(value)
    value = original_envelope(FROZEN["live"][1], "live")
    value["raw"]["result"]["metrics"]["energy"]["value"] = "1" * 39
    rejected(value)


def test_original_image_counter_and_energy_keep_legacy_decimal_limits():
    entry = deepcopy(FROZEN["live"][1])
    entry["expected"]["image_references"] = [deepcopy(RETIRED_REFERENCE)]
    assert validate_estimation_envelope(original_envelope(entry, "live"))
    for field, replacement in [("generated_image_count", "9223372036854775808"), ("gpu_kwh", "1" * 39)]:
        value = original_envelope(entry, "live")
        value["raw"]["result"]["image_references"][0][field] = replacement
        rejected(value)
    value = original_envelope(entry, "live")
    value["raw"]["result"]["eligible_candidate_count"] = 9007199254740992
    rejected(value)


@pytest.mark.parametrize(
    "field,replacement",
    [
        ("generated_image_count", "9223372036854775808"),
        ("gpu_kwh", "1" * 39),
        ("starting_energy_boundary", "facility"),
        ("eligible_candidate_count", 9007199254740992),
    ],
)
def test_outer_image_references_keep_legacy_scope_and_numeric_refinements(field, replacement):
    value = envelope()
    value["image_references"] = [deepcopy(RETIRED_REFERENCE)]
    assert validate_estimation_envelope(value) is value
    value["image_references"][0][field] = replacement
    rejected(value)


def test_outer_image_references_are_bounded_and_keep_raw_upstream_unchanged():
    value = envelope()
    raw = canonical_json(value["raw"])
    value["image_references"] = [deepcopy(RETIRED_REFERENCE) for _ in range(100)]
    assert validate_estimation_envelope(value) is value
    assert canonical_json(value["raw"]) == raw
    value["image_references"].append(deepcopy(value["image_references"][0]))
    rejected(value)


@pytest.mark.parametrize("value", [None, [], "PRIVATE_SECRET", 1, True, {}])
@pytest.mark.parametrize(
    "validator",
    [
        validate_build_configuration,
        validate_method_definition,
        validate_estimation_envelope,
        validate_engine_preference,
    ],
)
def test_invalid_root_has_only_sanitized_contract_error(value, validator):
    rejected(value, validator)


@pytest.mark.parametrize(
    "validator,factory",
    [
        (validate_build_configuration, lambda: deepcopy(BUILD)),
        (validate_method_definition, definition),
        (validate_estimation_envelope, envelope),
    ],
)
def test_extra_fields_cannot_smuggle_client_payload_or_credentials(validator, factory):
    value = factory()
    value["prompt"] = "PRIVATE_SECRET"
    rejected(value, validator)


@pytest.mark.parametrize(
    "path,replacement",
    [
        (("source", "request_hash"), "c" * 64),
        (("source", "attempt_hash"), "c" * 64),
        (("source", "request_revision"), 2),
        (("requested_method", "method_hash"), "c" * 64),
        (("effective_method", "method_hash"), "c" * 64),
        (("selection", "reason"), "provider_policy"),
        (("selection", "profile", "model_name"), "gpt-5.5-pro"),
        (("auxiliary_method_hashes", "image_reference"), "c" * 64),
    ],
)
def test_input_hash_binds_each_numerical_dependency_and_choice(path, replacement):
    value = envelope()
    original_hash = value["input_hash"]
    assert calculation_input_hash(value) == original_hash
    set_path(value, path, replacement)
    assert calculation_input_hash(value) != original_hash
    rejected(value)
    rehash(value)
    if path[0] in {"requested_method", "effective_method"}:
        rejected(value)
        other = "effective_method" if path[0] == "requested_method" else "requested_method"
        value[other][path[1]] = replacement
        rehash(value)
    assert validate_estimation_envelope(value) is value


def test_input_hash_is_exact_and_does_not_include_view_or_execution_location():
    value = envelope()
    original_hash = value["input_hash"]
    value["input_hash"] = "f" * 64
    rejected(value)
    rehash(value)
    value.update(execution_origin="local", view="recalculated", original_method_hash="c" * 64)
    assert calculation_input_hash(value) == original_hash
    assert validate_estimation_envelope(value) is value


@pytest.mark.parametrize("change", ["missing", "null", "extra", "malformed_hash"])
def test_auxiliary_method_identity_is_required_and_strict(change):
    value = envelope()
    if change == "missing":
        del value["auxiliary_method_hashes"]
    elif change == "null":
        value["auxiliary_method_hashes"] = None
    elif change == "extra":
        value["auxiliary_method_hashes"]["other_method"] = "c" * 64
    else:
        value["auxiliary_method_hashes"]["image_reference"] = "not-a-hash"
    rejected(value)


@pytest.mark.parametrize("changed", ["reference", "auxiliary"])
def test_outer_image_cohort_must_match_auxiliary_identity_even_after_rehash(changed):
    value = envelope()
    value["image_references"] = [deepcopy(RETIRED_REFERENCE)]
    assert validate_estimation_envelope(value) is value
    if changed == "reference":
        value["image_references"][0]["cohort_hash"] = "c" * 64
    else:
        value["auxiliary_method_hashes"]["image_reference"] = "c" * 64
    rehash(value)
    rejected(value)


def unavailable_selection(requested, effective, selection):
    value = envelope()
    value["requested_method"] = identity(requested)
    value["effective_method"] = identity(effective)
    value["selection"]["kind"] = selection
    if selection not in {"direct_mapping", "model_override", "provider_flagship"}:
        value["selection"]["profile"] = None
    value["raw"] = None
    value["components"] = []
    value["status"] = "unavailable"
    value["metrics"] = {name: product_metric(name, None) for name in value["metrics"]}
    return rehash(value)


@pytest.mark.parametrize("requested", ["original", "ecologits"])
@pytest.mark.parametrize("effective", ["original", "ecologits"])
@pytest.mark.parametrize(
    "selection",
    [
        "legacy_reference",
        "direct_mapping",
        "model_override",
        "provider_flagship",
        "original_fallback",
        "unavailable",
    ],
)
def test_selection_label_matches_requested_and_effective_engines_even_when_unavailable(
    requested, effective, selection
):
    accepted = {
        ("original", "original", "legacy_reference"),
        ("original", "original", "unavailable"),
        ("ecologits", "ecologits", "direct_mapping"),
        ("ecologits", "ecologits", "model_override"),
        ("ecologits", "ecologits", "provider_flagship"),
        ("ecologits", "ecologits", "unavailable"),
        ("ecologits", "original", "original_fallback"),
    }
    value = unavailable_selection(requested, effective, selection)
    if (requested, effective, selection) in accepted:
        assert validate_estimation_envelope(value) is value
    else:
        rejected(value)


@pytest.mark.parametrize(
    "selection",
    [
        "legacy_reference",
        "direct_mapping",
        "model_override",
        "provider_flagship",
        "original_fallback",
        "unavailable",
    ],
)
def test_selection_requires_profile_exactly_for_upstream_profile_choices(selection):
    requested = "original" if selection == "legacy_reference" else "ecologits"
    effective = "original" if selection in {"legacy_reference", "original_fallback"} else "ecologits"
    value = unavailable_selection(requested, effective, selection)
    assert validate_estimation_envelope(value) is value
    value["selection"]["profile"] = (
        envelope()["selection"]["profile"] if value["selection"]["profile"] is None else None
    )
    rehash(value)
    rejected(value)


@pytest.mark.parametrize("changed", ["raw", "selection"])
def test_original_observed_model_must_match_selection_even_with_valid_input_hash(changed):
    value = original_envelope(FROZEN["live"][1], "live")
    assert validate_estimation_envelope(value) is value
    if changed == "raw":
        value["raw"]["result"]["observed_model_key"] = "another-model"
    else:
        value["selection"]["observed_model_id"] = "another-model"
    rehash(value)
    rejected(value)


@pytest.fixture(scope="module")
def native_identity_envelopes():
    from datetime import UTC, datetime

    from footprint_estimator import baseline_bundle
    from test_analytics import observations

    from aift.engine_adapter import estimate, identity, packaged_definition

    definition = packaged_definition()
    request, attempt = observations(datetime(2026, 9, 15, 12, tzinfo=UTC))
    request["model_id"] = attempt["model_id"] = "chatgpt-gpt-5-5"
    direct = estimate(definition, attempt, request)

    proxy_request, proxy_attempt = deepcopy(request), deepcopy(attempt)
    proxy_request["model_id"] = proxy_attempt["model_id"] = "chatgpt-unlisted"
    proxy = estimate(definition, proxy_attempt, proxy_request)

    override_definition = deepcopy(definition)
    override_definition["fallback"]["model_overrides"]["chatgpt-gpt-5-5"] = {
        "strategy": "upstream_profile",
        "profile": definition["mappings"]["bindings"]["chatgpt-gpt-5-5"],
        "basis": "nearest_record",
    }
    override = estimate(override_definition, attempt, request)

    unavailable_definition = deepcopy(definition)
    unavailable_definition["fallback"]["unknown_provider"] = {"strategy": "unavailable"}
    opaque_request, opaque_attempt = deepcopy(request), deepcopy(attempt)
    opaque_request.update(site="perplexity", model_id=None)
    opaque_attempt["model_id"] = None
    unavailable = estimate(unavailable_definition, opaque_attempt, opaque_request)

    original = original_envelope(next(row for row in FROZEN["live"] if row["name"] == "output-500"), "live")
    original["requested_method"] = identity(baseline_bundle())
    original["effective_method"] = deepcopy(original["requested_method"])
    rehash(original)

    history = deepcopy(next(row["observation"] for row in FROZEN["history"] if row["name"] == "response-100"))
    # The frozen corpus keeps its 2.0.0 records; 3.0.0 adds parts, generation and the company key.
    history.update(
        schema_version="3.0.0",
        parts=history_response_parts(history["tokens"]),
        generation={"text_components": [], "media": []},
        company_dedup_key=None,
    )
    history.update(site="chatgpt", model_id="chatgpt-gpt-5-5")
    historical = estimate(definition, history)
    fallback_source = {**history, "site": "perplexity", "model_id": None}
    legacy_definition = deepcopy(definition)
    legacy_definition["fallback"]["unknown_provider"] = {"strategy": "original_engine"}
    fallback = estimate(legacy_definition, fallback_source)
    fixtures = {
        "direct_mapping": direct,
        "provider_flagship": proxy,
        "model_override": override,
        "unavailable": unavailable,
        "legacy_reference": original,
        "history": historical,
        "original_fallback": fallback,
    }
    for selection, result in fixtures.items():
        assert validate_estimation_envelope(result) is result
        assert result["selection"]["kind"] == ("direct_mapping" if selection == "history" else selection)
    return fixtures


@pytest.mark.parametrize(
    "selection",
    ["direct_mapping", "provider_flagship", "model_override", "unavailable", "legacy_reference", "history"],
)
@pytest.mark.parametrize(
    "field,replacement",
    [
        ("implementation_version", "forged-core-version"),
        ("method_id", "forged-method"),
        ("method_hash", "f" * 64),
        ("source_version", "forged-source-version"),
        ("source_commit", "f" * 40),
        ("catalog_hash", None),
        ("profile_policy_hash", "f" * 64),
        ("environment_policy_hash", "f" * 64),
    ],
)
def test_same_engine_rejects_complete_identity_mutations_with_valid_input_hash(
    native_identity_envelopes, selection, field, replacement
):
    # The native adapter can share these dictionaries; JSON transport cannot.
    value = json.loads(canonical_json(native_identity_envelopes[selection]))
    assert validate_estimation_envelope(value) is value
    assert value["requested_method"]["engine_id"] == value["effective_method"]["engine_id"]
    requested_before = canonical_json(value["requested_method"])
    assert value["effective_method"][field] != replacement
    value["effective_method"][field] = replacement
    assert canonical_json(value["requested_method"]) == requested_before
    rehash(value)
    assert value["input_hash"] == calculation_input_hash(value)
    rejected(value)


def test_native_historical_rows_keep_full_method_identity_and_original_fallback_stays_distinct(
    native_identity_envelopes,
):
    from aift.engine_adapter import history_metrics

    historical = deepcopy(native_identity_envelopes["history"])
    assert validate_estimation_envelope(historical) is historical
    resources = history_metrics(historical)
    assert len(resources) == 5
    for resource in resources:
        assert canonical_json(resource["requested_method"]) == canonical_json(resource["effective_method"])
        assert resource["method_id"] == historical["requested_method"]["method_id"]
        assert resource["method_hash"] == historical["requested_method"]["method_hash"]

    fallback = deepcopy(native_identity_envelopes["original_fallback"])
    raw_before = canonical_json(fallback["raw"])
    assert fallback["source"]["family"] == "history"
    assert fallback["requested_method"]["engine_id"] == "ecologits"
    assert fallback["effective_method"]["engine_id"] == "original"
    assert payload_hash(fallback["requested_method"]) != payload_hash(fallback["effective_method"])
    assert validate_estimation_envelope(fallback) is fallback
    assert canonical_json(fallback["raw"]) == raw_before
    for resource in history_metrics(fallback):
        assert resource["profile_selection"] == "original_fallback"
        assert resource["requested_method"] == fallback["requested_method"]
        assert resource["effective_method"] == fallback["effective_method"]


@pytest.mark.parametrize("selection", ["direct_mapping", "legacy_reference"])
def test_explicit_missing_original_lineage_allows_live_recalculation_without_changing_raw_bytes(
    native_identity_envelopes, selection
):
    value = json.loads(canonical_json(native_identity_envelopes[selection]))
    assert validate_estimation_envelope(value) is value
    raw_before, input_hash = canonical_json(value["raw"]), value["input_hash"]
    value.update(view="recalculated", original_method_hash=None)
    value["reasons"].append("original_method_missing")
    assert validate_estimation_envelope(value) is value
    assert value["input_hash"] == input_hash == calculation_input_hash(value)
    assert canonical_json(value["raw"]) == raw_before


@pytest.mark.parametrize("family", ["live", "history"])
@pytest.mark.parametrize("view", ["original", "recalculated"])
@pytest.mark.parametrize("original_hash", [None, "c" * 64])
@pytest.mark.parametrize("missing_reason", [False, True])
def test_missing_original_lineage_exception_is_limited_to_its_declared_context(
    native_identity_envelopes, family, view, original_hash, missing_reason
):
    selected = "history" if family == "history" else "direct_mapping"
    value = json.loads(canonical_json(native_identity_envelopes[selected]))
    assert validate_estimation_envelope(value) is value
    value.update(view=view, original_method_hash=original_hash)
    if missing_reason:
        value["reasons"].append("original_method_missing")
    rehash(value)
    allowed = (
        view == "recalculated" and family == "live" and original_hash is None
        if missing_reason
        else view == "original" or original_hash is not None
    )
    if allowed:
        assert validate_estimation_envelope(value) is value
    else:
        rejected(value)


@pytest.mark.parametrize("channel", ["selection", "metric", "raw_warning", "missing_component"])
def test_only_the_wrapper_reason_can_explain_missing_original_lineage(native_identity_envelopes, channel):
    value = json.loads(canonical_json(native_identity_envelopes["direct_mapping"]))
    value.update(view="recalculated", original_method_hash=None)
    if channel == "selection":
        value["selection"]["reason"] = "original_method_missing"
    elif channel == "metric":
        value["metrics"]["energy"]["reasons"].append("original_method_missing")
    elif channel == "raw_warning":
        value["raw"]["result"]["warnings"] = [{"code": "original_method_missing", "message": "No lineage"}]
    else:
        value["missing_components"].append("original_method_missing")
    rehash(value)
    rejected(value)


def test_nulling_known_original_hash_is_not_accepted_without_explicit_wrapper_reason(
    native_identity_envelopes,
):
    value = json.loads(canonical_json(native_identity_envelopes["direct_mapping"]))
    value.update(view="recalculated", original_method_hash="c" * 64)
    assert validate_estimation_envelope(value) is value
    preserved = canonical_json(value)
    value["reasons"].append("original_method_missing")
    rejected(value)
    value = json.loads(preserved)
    value["original_method_hash"] = None
    rejected(value)


def test_forged_historical_source_cannot_reuse_live_missing_lineage_exception(native_identity_envelopes):
    value = json.loads(canonical_json(native_identity_envelopes["direct_mapping"]))
    value.update(view="recalculated", original_method_hash=None)
    value["reasons"].append("original_method_missing")
    assert validate_estimation_envelope(value) is value
    value["source"] = deepcopy(native_identity_envelopes["history"]["source"])
    rehash(value)
    assert value["input_hash"] == calculation_input_hash(value)
    rejected(value)
