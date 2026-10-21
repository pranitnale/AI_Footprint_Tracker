"""Strict engine contracts with the refinements omitted by generated JSON Schema.

Calculation hashes bind the envelope's numerical dependencies and choices. The
registry and adapter authenticate the method and observation content behind them.
Validation errors never contain submitted data.
"""

from __future__ import annotations

import json
import math
import re
from calendar import monthrange
from pathlib import Path

from footprint_contracts import MAX_COUNTER, ContractError, canonical_json, payload_hash
from jsonschema import Draft202012Validator, FormatChecker

_ROOT = Path(__file__).resolve().parents[1] / "schema"
_FORMATS = FormatChecker()


@_FORMATS.checks("date")
def _calendar_date(value):
    # JavaScript's calendar includes year zero; datetime.date does not.
    if not isinstance(value, str):
        return True
    if re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value) is None:
        return False
    year, month, day = map(int, value.split("-"))
    return 1 <= month <= 12 and 1 <= day <= monthrange(year, month)[1]


_VALIDATORS = {
    name: Draft202012Validator(
        json.loads((_ROOT / f"{name}-{version}.schema.json").read_text(encoding="utf-8")),
        format_checker=_FORMATS,
    )
    for name, version in (
        ("engine-build-configuration", "1.0.0"),
        ("engine-preference", "1.0.0"),
        ("ecologits-method-definition", "1.0.0"),
        ("estimation-envelope", "3.0.0"),
    )
}
_ZERO = re.compile(r"^-?0(\.0+)?(e[+-]?[0-9]{1,3})?$")
_QUANTITIES = ("energy", "carbon", "water_direct", "water_upstream", "water_total")
_UPSTREAM_FIELDS = ("energy", "gwp", "adpe", "pe", "wcf", "usage", "embodied")
_PROFILE_SELECTIONS = ("direct_mapping", "model_override", "provider_flagship")


def _schema(name, value):
    if not _VALIDATORS[name].is_valid(value):
        raise ContractError()
    # All persisted engine records must also fit the shared canonical hash domain.
    canonical_json(value)


def _finite_decimal(value):
    numeric = float(value)
    if (
        not math.isfinite(numeric)
        or numeric < 0
        or (numeric == 0 and (math.copysign(1, numeric) < 0 or not _ZERO.fullmatch(value)))
    ):
        raise ContractError()
    return numeric


def _impact(value):
    if isinstance(value, str):
        _finite_decimal(value)
    elif _finite_decimal(value["min"]) > _finite_decimal(value["max"]):
        raise ContractError()


def _policy(value):
    if len(value["provider_defaults"]) > 64 or len(value["model_overrides"]) > 4096:
        raise ContractError()
    for provider, fallback in value["provider_defaults"].items():
        if (
            fallback["strategy"] == "upstream_provider_flagship"
            and fallback["profile"]["provider"] != provider
        ):
            raise ContractError()


def validate_build_configuration(value):
    _schema("engine-build-configuration", value)
    _policy(value["ecologits_fallback"])
    return value


def _media_policy(value):
    for coefficient in (
        value["image"]["it_energy_wh_per_image"],
        value["speech"]["characters_per_second"],
        value["overview"]["seconds_per_illustration"],
        *value["speech"]["tokens_per_second"].values(),
        *(settings["duration_seconds"] for settings in value["video"]["site_defaults"].values()),
        *(settings["duration_seconds"] for settings in value["video"]["model_defaults"].values()),
        *([value["claude_token_factor"]["factor"]] if "claude_token_factor" in value else []),
    ):
        if not float(coefficient) > 0:
            raise ContractError()
    # Mirrors the TypeScript refinements the JSON schema cannot express.
    for override in value["environment_overrides"].values():
        for key in ("datacenter_pue", "datacenter_wue"):
            factor = override.get(key)
            if factor is None:
                continue
            low, high = (factor, factor) if isinstance(factor, str) else (factor["min"], factor["max"])
            if not 0 < float(low) <= float(high) or (key == "datacenter_pue" and float(low) < 1):
                raise ContractError()


def validate_method_definition(value):
    _schema("ecologits-method-definition", value)
    _policy(value["fallback"])
    _media_policy(value["media"])
    if len(value["mappings"]["bindings"]) > 4096:
        raise ContractError()
    return value


def validate_engine_preference(value):
    _schema("engine-preference", value)
    instant = value["updated_at"]
    if (
        not _calendar_date(instant[:10])
        or re.fullmatch(r"[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z", instant[11:]) is None
        or int(instant[11:13]) > 23
        or int(instant[14:16]) > 59
        or int(instant[17:19]) > 59
    ):
        raise ContractError()
    return value


def _product_metric(value):
    absent = value["value"] is None
    low, high = value["scenario_low"], value["scenario_high"]
    interval = low is not None and high is not None
    if (
        absent != (value["status"] == "unavailable")
        or absent != (value["value_kind"] == "unavailable")
        or interval != (value["value_kind"] == "midpoint")
        or interval != (value["interval_kind"] is not None)
        or (low is None) != (high is None)
    ):
        raise ContractError()
    if not absent:
        numeric = _finite_decimal(value["value"])
        if interval and not _finite_decimal(low) <= numeric <= _finite_decimal(high):
            raise ContractError()


def _upstream(value):
    if value["errors"] is None:
        if any(value[field] is None for field in _UPSTREAM_FIELDS):
            raise ContractError()
        for field in _UPSTREAM_FIELDS:
            metric_or_phase = value[field]
            if field in ("usage", "embodied"):
                for name, metric in metric_or_phase.items():
                    if name not in ("type", "name"):
                        _impact(metric["value"])
            else:
                _impact(metric_or_phase["value"])
    elif any(value[field] is not None for field in _UPSTREAM_FIELDS):
        raise ContractError()


def _legacy_decimal(value):
    if value is not None and len(value.replace(".", "")) > 38:
        raise ContractError()


def _counter(value):
    if value is not None and int(value) > MAX_COUNTER:
        raise ContractError()


def _image_references(values):
    for image in values:
        _legacy_decimal(image["gpu_kwh"])
        _counter(image["generated_image_count"])


def _original(value, source, method, status, observed_model_id):
    if isinstance(value, list):
        if (
            source["family"] != "history"
            or len(value) not in (0, 5)
            or len({metric["quantity"] for metric in value}) != len(value)
            or (not value and status == "estimated")
        ):
            raise ContractError()
        for metric in value:
            if metric["method_id"] != method["method_id"] or metric["method_hash"] != method["method_hash"]:
                raise ContractError()
            _legacy_decimal(metric["value"])
            _counter(metric["known_message_count"])
            _counter(metric["unknown_message_count"])
        return

    if (
        source["family"] != "live"
        or value["observation_hash"] != source["attempt_hash"]
        or value["observation_revision"] != source["attempt_revision"]
        or value["attempt_id"] != source["attempt_id"]
        or value["method_hash"] != method["method_hash"]
        or value["method_id"] != method["method_id"]
        or value["observed_model_key"] != observed_model_id
    ):
        raise ContractError()
    for metric in value["metrics"].values():
        _legacy_decimal(metric["value"])
    _image_references(value["image_references"])
    scenario = value["environment_provenance"]
    for name in ("pue", "carbon", "direct_water", "upstream_water"):
        if scenario[name] is not None and not float(scenario[name]) < 1e9:
            raise ContractError()
    if scenario["pue"] is not None and float(scenario["pue"]) < 1:
        raise ContractError()


def _canonical_request_binding(source):
    if "canonical_request_binding" not in source:
        return
    binding = source["canonical_request_binding"]
    if (
        source["family"] != "live"
        or binding["canonical_request_id"] != source["request_id"]
        or binding["observed_request_id"] == binding["canonical_request_id"]
        or binding["relation_hash"]
        != payload_hash(
            {
                "kind": "canonical_request_alias",
                "observed_request_id": binding["observed_request_id"],
                "canonical_request_id": binding["canonical_request_id"],
            }
        )
    ):
        raise ContractError()


def calculation_input_hash(value):
    return payload_hash(
        {
            "schema_version": "3.0.0",
            "source": value["source"],
            "requested_method_hash": value["requested_method"]["method_hash"],
            "effective_method_hash": value["effective_method"]["method_hash"],
            "selection": value["selection"],
            "auxiliary_method_hashes": value["auxiliary_method_hashes"],
        }
    )


def _valid_engine_selection(requested, effective, selection):
    if selection == "original_fallback":
        return requested == "ecologits" and effective == "original"
    if selection == "legacy_reference":
        return requested == effective == "original"
    if selection in _PROFILE_SELECTIONS:
        return requested == effective == "ecologits"
    return selection == "unavailable" and requested == effective


def _close_to(actual, expected):
    # Both runtimes add component values in binary floating point; see closeTo.
    if actual is None:
        return False
    value = float(actual)
    return abs(value - expected) <= 1e-9 * max(abs(value), abs(expected))


def _metrics_match_components(metrics, components):
    """Mirror of metricsMatchComponents: top-level metrics are the component sums."""
    estimated = [component for component in components if component["status"] == "estimated"]
    for name, top in metrics.items():
        parts = [c["metrics"][name] for c in estimated if c["metrics"][name]["value"] is not None]
        if not parts:
            if top["value"] is not None:
                return False
            continue
        # A total may show point estimates as a range of zero width; a scalar total needs
        # scalar parts.
        if top["value_kind"] == "scalar":
            total = 0.0
            for metric in parts:
                total += float(metric["value"])
            if any(metric["value_kind"] == "midpoint" for metric in parts) or not _close_to(top["value"], total):
                return False
            continue
        low = high = 0.0
        for metric in parts:
            low += float(metric["scenario_low"] if metric["scenario_low"] is not None else metric["value"])
            high += float(metric["scenario_high"] if metric["scenario_high"] is not None else metric["value"])
        if (
            top["value_kind"] != "midpoint"
            or not _close_to(top["scenario_low"], low)
            or not _close_to(top["scenario_high"], high)
            or not _close_to(top["value"], (low + high) / 2)
        ):
            return False
    return True


def validate_estimation_envelope(value):
    _schema("estimation-envelope", value)
    _canonical_request_binding(value["source"])
    _image_references(value["image_references"])
    raw = value["raw"]
    requested, effective = value["requested_method"], value["effective_method"]
    selection = value["selection"]
    if (
        (
            requested["engine_id"] == effective["engine_id"]
            and payload_hash(requested) != payload_hash(effective)
        )
        or value["input_hash"] != calculation_input_hash(value)
        or any(
            reference["cohort_hash"] != value["auxiliary_method_hashes"]["image_reference"]
            for reference in value["image_references"]
        )
        or not _valid_engine_selection(requested["engine_id"], effective["engine_id"], selection["kind"])
        or (selection["kind"] in _PROFILE_SELECTIONS) != (selection["profile"] is not None)
    ):
        raise ContractError()
    metrics = value["metrics"]
    for metric in metrics.values():
        _product_metric(metric)
    components = value["components"]
    if len({component["component_id"] for component in components}) != len(components) or (
        effective["engine_id"] == "original" and components
    ):
        raise ContractError()
    for component in components:
        for metric in component["metrics"].values():
            _product_metric(metric)
        available = any(metric["value"] is not None for metric in component["metrics"].values())
        chosen = component["selection"]
        if (
            available != (component["status"] == "estimated")
            or (
                chosen is not None
                and (chosen["kind"] in _PROFILE_SELECTIONS) != (chosen["profile"] is not None)
            )
            or (component["raw"] is not None and component["raw"]["errors"] and component["status"] == "estimated")
        ):
            raise ContractError()
        if component["raw"] is not None:
            _upstream(component["raw"])
        _counter(component["inputs"]["output_tokens"])
        _counter(component["inputs"]["units"])
    component_evidence = any(component["status"] == "estimated" for component in components)
    if (component_evidence or effective["engine_id"] == "ecologits") and not _metrics_match_components(
        metrics, components
    ):
        raise ContractError()
    # The top-level raw output is a copy of the main text's, so a stored result cannot
    # show one upstream output while its figures come from another.
    mains = [component for component in components if component["role"] == "main"]
    if effective["engine_id"] == "ecologits" and (
        len(mains) > 1
        or canonical_json(raw)
        != canonical_json(
            {"engine_id": "ecologits", "result": mains[0]["raw"]} if mains and mains[0]["raw"] is not None else None
        )
    ):
        raise ContractError()
    missing_original = "original_method_missing" in value["reasons"]
    # The executor and storage boundary verify the source admission marker.
    if (
        missing_original
        and (
            value["view"] != "recalculated"
            or value["source"]["family"] != "live"
            or value["original_method_hash"] is not None
        )
    ) or (value["view"] == "recalculated" and value["original_method_hash"] is None and not missing_original):
        raise ContractError()
    if (
        metrics["energy"]["unit"] != "kWh"
        or metrics["carbon"]["unit"] not in ("gCO2e", "gCO2")
        or any(metrics[name]["unit"] != "L" for name in _QUANTITIES[2:])
        or (raw is not None and raw["engine_id"] != effective["engine_id"])
    ):
        raise ContractError()
    if value["status"] == "unavailable" and any(metric["value"] is not None for metric in metrics.values()):
        raise ContractError()
    if value["status"] == "estimated" and (
        (raw is None and not component_evidence)
        or all(metric["value"] is None for metric in metrics.values())
        or (
            raw is not None
            and raw["engine_id"] == "ecologits"
            and raw["result"]["errors"] is not None
            and not component_evidence
        )
    ):
        raise ContractError()
    if raw is not None:
        if raw["engine_id"] == "ecologits":
            _upstream(raw["result"])
        else:
            _original(
                raw["result"],
                value["source"],
                effective,
                value["status"],
                selection["observed_model_id"],
            )
    return value
