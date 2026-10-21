"""Independent Decimal reference and server estimator using the shared immutable bundle."""

from __future__ import annotations

import json
from decimal import ROUND_HALF_EVEN, Decimal, localcontext
from pathlib import Path

from footprint_contracts import payload_hash, validate_observation

_DATA = Path(__file__).resolve().parents[1] / "data"
_BASELINE = json.loads((_DATA / "baseline.json").read_text(encoding="utf-8-sig"))
BASELINE_METHOD_ID = _BASELINE["method_id"]
BASELINE_METHOD_HASH = payload_hash(_BASELINE)
# Identity of the image benchmark data removed on 20 October 2026 (ML.ENERGY figures without a
# licence). Estimates keep naming it because the calculation input hash covers it; no image
# references are produced any more.
RETIRED_IMAGE_REFERENCE_HASH = "6ffd40d42b09cd20fab2aa2be60a12d9428ec400ae11a43cf5de2ade4cdad76a"
_BUNDLES = {BASELINE_METHOD_ID: _BASELINE}
D = Decimal


def fixed(value):
    if value is None:
        return None
    if not value.is_finite() or value < 0 or value >= D("1e20"):
        raise ValueError("estimate_unavailable")
    return (
        format(value.quantize(D("0.000000000000000001"), rounding=ROUND_HALF_EVEN), "f")
        .rstrip("0")
        .rstrip(".")
        or "0"
    )


def validate_method_bundle(bundle):
    from jsonschema import Draft202012Validator

    schema = json.loads((_DATA / "bundle.schema.json").read_text())
    if not Draft202012Validator(schema).is_valid(bundle):
        raise ValueError("method_update_invalid")
    if bundle["scenario"]["pue"] is not None and D(bundle["scenario"]["pue"]) < 1:
        raise ValueError("method_update_invalid")
    for value in (bundle["scenario"][key] for key in ("pue", "carbon", "direct_water", "upstream_water")):
        if value is not None and not D(0) <= D(value) < D("1e9"):
            raise ValueError("method_update_invalid")
    profiles = bundle["profiles"]
    if len({p["id"] for p in profiles}) != len(profiles) or any(
        not D(0) < D(p["activeBillions"]) < D("1e9")
        or not D(0) < D(p["totalBillions"]) <= 200
        or D(p["activeBillions"]) > D(p["totalBillions"])
        for p in profiles
    ):
        raise ValueError("method_update_invalid")
    for parent in (bundle["coefficients"], bundle["settings"]):
        for key, value in parent.items():
            if key != "energyBeta" and not D(0) < D(value) < D("1e9"):
                raise ValueError("method_update_invalid")
    if bundle["equation_id"] == "test-linear-v1" and not bundle["method_id"].startswith("test-"):
        raise ValueError("method_update_invalid")
    return json.loads(json.dumps(bundle))


def baseline_bundle():
    return json.loads(json.dumps(_BASELINE))


def register_method_bundle(bundle):
    bundle = validate_method_bundle(bundle)
    old = _BUNDLES.get(bundle["method_id"])
    if old is not None and payload_hash(old) != payload_hash(bundle):
        raise ValueError("method_update_invalid")
    if len(_BUNDLES) >= 32 and old is None:
        raise ValueError("method_update_invalid")
    _BUNDLES[bundle["method_id"]] = json.loads(json.dumps(bundle))
    return payload_hash(bundle)


def text_energy(n, profile, bundle):
    c, s = bundle["coefficients"], bundle["settings"]
    if bundle["equation_id"] == "test-linear-v1":
        return D(n) * D(c["energyAlpha"]) * D(profile["activeBillions"])
    active = D(profile["activeBillions"])
    batch = D(s["batchSize"])
    required = (
        D(profile["totalBillions"])
        * D(s["memoryMultiplier"])
        * D(s["precisionBits"])
        / 8
        / D(s["gpuMemoryGb"])
    ).to_integral_value(rounding="ROUND_CEILING")
    g = D(1)
    while g < required:
        g *= 2
    gpu = (
        D(n)
        * (D(c["energyAlpha"]) * (D(c["energyBeta"]) * batch).exp() * active + D(c["energyGamma"]))
        * g
        / 1000
    )
    seconds = D(n) * (D(c["latencyAlpha"]) * active + D(c["latencyBeta"]) * batch + D(c["latencyGamma"]))
    host = seconds / 3600 * D(s["hostPowerKw"]) * (g / D(s["serverGpuCount"])) / batch
    return gpu + host


def environmental_allocation(value, boundary, scenario):
    from jsonschema import Draft202012Validator

    scenario_schema = json.loads((_DATA / "bundle.schema.json").read_text())["properties"]["scenario"]
    if not Draft202012Validator(scenario_schema).is_valid(scenario):
        raise ValueError("factor_incompatible")
    if (
        boundary not in ("gpu", "it", "facility")
        or scenario["water_kind"] != "consumption"
        or scenario["direct_denominator"] not in ("it", "facility")
    ):
        raise ValueError("factor_incompatible")
    for key in ("pue", "carbon", "direct_water", "upstream_water"):
        if scenario[key] is not None and (
            not isinstance(scenario[key], str)
            or not D(scenario[key]).is_finite()
            or not D(0) <= D(scenario[key]) < D("1e9")
        ):
            raise ValueError("factor_incompatible")
    if scenario["pue"] is not None and D(scenario["pue"]) < 1:
        raise ValueError("factor_incompatible")
    kwh = D(value)
    if not kwh.is_finite() or kwh < 0:
        raise ValueError("factor_incompatible")
    pue = None if scenario["pue"] is None else D(scenario["pue"])
    it = (None if pue is None else kwh / pue) if boundary == "facility" else kwh
    facility = kwh if boundary == "facility" else (None if pue is None else kwh * pue)
    carbon = None if facility is None or scenario["carbon"] is None else facility * D(scenario["carbon"])
    water_base = it if scenario["direct_denominator"] == "it" else facility
    direct = (
        None
        if water_base is None or scenario["direct_water"] is None
        else water_base * D(scenario["direct_water"])
    )
    upstream = (
        None
        if facility is None or scenario["upstream_water"] is None
        else facility * D(scenario["upstream_water"])
    )
    compatible = (
        scenario["direct_water_source"] != "unknown"
        and scenario["direct_water_source"] == scenario["upstream_water_source"]
        and scenario["common_water_scope"] == scenario["direct_water_source"] + "_consumption"
    )
    total = None if direct is None or upstream is None or not compatible else direct + upstream
    return {
        "it": it,
        "facility": facility,
        "carbon": carbon,
        "direct": direct,
        "upstream": upstream,
        "total": total,
    }


def _metric(value, unit, reasons):
    return {
        "value": fixed(value),
        "unit": unit,
        "status": "unavailable" if value is None else "partial_estimate",
        "scope": "modeled_text_component",
        "scenario_low": None,
        "scenario_high": None,
        "reasons": reasons + (["factor_unavailable"] if value is None else []),
    }


def estimate_observation(observation, options=None, *, bundle=None):
    a = validate_observation(observation)
    if a["kind"] != "attempt":
        return None
    options = options or {}
    missing_original = options.get("originalMethodMissing", False)
    if (
        (a["proposed_method_id"] == "unavailable-admission-v1" and not missing_original)
        or not isinstance(missing_original, bool)
        or (
            missing_original
            and (
                options.get("view") != "recalculated"
                or options.get("originalMethodHash") is not None
                or not options.get("methodId")
                or a["proposed_method_id"] != "unavailable-admission-v1"
            )
        )
    ):
        raise ValueError("method_update_invalid")
    method_id = options.get("methodId") or a["proposed_method_id"] or BASELINE_METHOD_ID
    b = validate_method_bundle(bundle) if bundle is not None else _BUNDLES.get(method_id)
    if b is None:
        raise ValueError("method_unsupported")
    if b["method_id"] != method_id:
        raise ValueError("method_update_invalid")
    if (
        options.get("view") == "recalculated"
        and not options.get("originalMethodHash")
        and not missing_original
    ):
        raise ValueError("method_update_invalid")
    with localcontext() as ctx:
        ctx.prec = 48
        ctx.rounding = ROUND_HALF_EVEN
        output = (
            a["tokens"]["output_total"]
            if a["tokens"]["output_total"]["value"] is not None
            else a["tokens"]["answer_output"]
        )
        usable = a["execution_evidence"] != "none" and output["value"] is not None and D(output["value"]) > 0
        candidates = [(p, text_energy(output["value"], p, b)) for p in b["profiles"]] if usable else []
        candidates.sort(key=lambda item: (-item[1], item[0]["id"]))
        winner = candidates[0] if candidates else None
        allocation = environmental_allocation(winner[1], "it", b["scenario"]) if winner else {}
        reasons = list(
            dict.fromkeys(
                a["coverage_reasons"]
                + ["unvalidated_reference", "input_length_not_modelled", "hidden_reasoning_unobserved"]
                + ([] if winner else ["estimate_unavailable"])
                + (["original_method_missing"] if missing_original else [])
            )
        )
        cohort_hash = payload_hash(b["profiles"])
        signature = payload_hash(
            {
                "work_units": output["value"],
                "count_scope": output["scope"],
                "scenario_hash": payload_hash(b["scenario"]),
                "cohort_hash": cohort_hash,
                "method_hash": payload_hash(b),
            }
        )
        result = {
            "schema_version": "1.0.0",
            "attempt_id": a["attempt_id"],
            "observation_revision": a["revision"],
            "observation_hash": payload_hash(a),
            "method_id": method_id,
            "method_hash": payload_hash(b),
            "view": options.get("view", "original"),
            "original_method_hash": options.get("originalMethodHash"),
            "observed_model_key": a["model_id"],
            "model_evidence": a["model_evidence"],
            "profile_selection": "highest_comparable" if winner else "unavailable",
            "selected_profile_id": winner[0]["id"] if winner else None,
            "cohort_id": b["method_id"] + "-text",
            "cohort_hash": cohort_hash,
            "eligible_candidate_count": len(candidates),
            "eligibility_signature": signature,
            "environment_scenario_id": b["scenario"]["id"],
            "factor_provenance_status": "source_snapshot_original_year_unknown",
            "starting_energy_boundary": "it",
            "result_scope": "modeled_text_component",
            "reference_only": False,
            "validation_state": "unvalidated_reference",
            "known_settings": {
                "output_tokens": output["value"] if output["value"] is not None else "unknown",
                "output_scope": output["scope"],
            },
            "assumed_settings": dict(b["settings"], duration_strategy="regression_uncapped_reference"),
            "selection_reason": "unknown_model" if a["model_id"] is None else "profile_absent",
            "included_components": ["observed_output_surrogate", "allocated_host", "allocated_facility"]
            if winner
            else [],
            "missing_components": b["missing_components"],
            "reasons": reasons,
            "metrics": {
                "energy": _metric(allocation.get("facility"), "kWh", reasons),
                "carbon": _metric(
                    allocation.get("carbon"),
                    "gCO2" if b["scenario"]["carbon_gas"] == "CO2" else "gCO2e",
                    reasons,
                ),
                "water_direct": _metric(allocation.get("direct"), "L", reasons),
                "water_upstream": _metric(allocation.get("upstream"), "L", reasons),
                "water_total": _metric(allocation.get("total"), "L", reasons),
            },
            "image_references": [],
            "provenance": b["provenance"],
            "environment_provenance": b["scenario"],
        }
        return json.loads(json.dumps(result))


if __name__ == "__main__":
    import sys

    command = json.load(sys.stdin)
    for bundle in command.get("bundles", []):
        register_method_bundle(bundle)
    print(
        json.dumps(estimate_observation(command["observation"], command.get("options")), ensure_ascii=False)
    )
