"""Per-component EcoLogits estimates; mirrors packages/estimator/src/engines/components.ts.

Every list and field follows the TypeScript order, so both runtimes produce the same
envelope for the same observation (the parity test compares them element by element).
"""

import math
from decimal import Decimal

MAX_SAFE_INTEGER = 9007199254740991
TEXT_METHOD_ID = "ecologits-llm-0-11"
QUANTITIES = ("energy", "carbon", "water_direct", "water_upstream", "water_total")
UNITS = {"energy": "kWh", "carbon": "gCO2e", "water_direct": "L", "water_upstream": "L", "water_total": "L"}


def decimal_string(value):
    """The shortest round-trip digits in JavaScript's Number#toString layout, so both
    runtimes write the same decimal strings for the same binary64 value."""
    number = float(value)
    if not math.isfinite(number) or number < 0:
        raise ValueError("numeric_domain_unsupported")
    if number == 0:
        return "0"
    _, digits, exponent = Decimal(repr(number)).normalize().as_tuple()
    text = "".join(map(str, digits))
    k = len(text)
    n = exponent + k
    if k <= n <= 21:
        return text + "0" * (n - k)
    if 0 < n <= 21:
        return text[:n] + "." + text[n:]
    if -6 < n <= 0:
        return "0." + "0" * -n + text
    power = n - 1
    mantissa = text[0] + ("." + text[1:] if k > 1 else "")
    return f"{mantissa}e{'+' if power > 0 else '-'}{abs(power)}"


def unique(values):
    return list(dict.fromkeys(values))


def empty_inputs():
    return {
        "output_tokens": None,
        "latency_seconds": None,
        "latency_basis": None,
        "environment_provider": None,
        "electricity_mix_zone": None,
        "units": None,
        "width": None,
        "height": None,
        "duration_seconds": None,
        "with_audio": None,
        "audio_seconds": None,
        "defaults_applied": [],
    }


def unavailable_metric(quantity, scope, reasons):
    return {
        "value": None,
        "unit": UNITS[quantity],
        "scope": scope,
        "status": "unavailable",
        "phase": "usage",
        "scenario_low": None,
        "scenario_high": None,
        "interval_kind": None,
        "value_kind": "unavailable",
        "reasons": list(reasons),
    }


def unavailable_metrics(scope, reasons):
    return {
        q: unavailable_metric(q, scope, ["not_applicable"] if q in ("water_direct", "water_upstream") else reasons)
        for q in QUANTITIES
    }


def _is_range(value):
    return isinstance(value, dict) or hasattr(value, "min")


def _low(value):
    return float(value["min"] if isinstance(value, dict) else value.min) if _is_range(value) else float(value)


def _high(value):
    return float(value["max"] if isinstance(value, dict) else value.max) if _is_range(value) else float(value)


def add(a, b):
    """Range arithmetic of the TypeScript core: endpoints add separately."""
    if _is_range(a) or _is_range(b):
        return {"min": _low(a) + _low(b), "max": _high(a) + _high(b)}
    return a + b


def multiply(a, b):
    if _is_range(a) or _is_range(b):
        return {"min": _low(a) * _low(b), "max": _high(a) * _high(b)}
    return a * b


def project_value(value, quantity, scope, reasons, scale=1):
    """Same projection as projectImpactValue: scalars stay scalar, ranges show their midpoint."""
    if not _is_range(value):
        return {
            **unavailable_metric(quantity, scope, reasons),
            "value": decimal_string(float(value) * scale),
            "status": "partial_estimate",
            "value_kind": "scalar",
        }
    lower = _low(value) * scale
    upper = _high(value) * scale
    return {
        "value": decimal_string((lower + upper) / 2),
        "unit": UNITS[quantity],
        "scope": scope,
        "status": "partial_estimate",
        "phase": "usage",
        "scenario_low": decimal_string(lower),
        "scenario_high": decimal_string(upper),
        "interval_kind": "upstream_approximation",
        "value_kind": "midpoint",
        "reasons": list(reasons),
    }


def _raw_value(value):
    """Serialized impact values are decimal strings or {min, max} of decimal strings."""
    if isinstance(value, dict):
        return {"min": float(value["min"]), "max": float(value["max"])}
    return float(value)


def impact_metrics(energy, gwp, wcf, scope, reasons):
    return {
        "energy": project_value(energy, "energy", scope, reasons),
        "carbon": project_value(gwp, "carbon", scope, reasons, 1000),
        "water_direct": unavailable_metric("water_direct", scope, ["not_applicable"]),
        "water_upstream": unavailable_metric("water_upstream", scope, ["not_applicable"]),
        "water_total": project_value(wcf, "water_total", scope, reasons),
    }


def unavailable_component(base, selection, inputs, scope, reasons, raw=None):
    return {
        **base,
        "selection": selection,
        "inputs": inputs,
        "raw": raw,
        "status": "unavailable",
        "metrics": unavailable_metrics(scope, reasons),
        "reasons": unique(reasons),
    }


def impact_component(base, selection, inputs, scope, reasons, raw):
    """`raw` is the serialized native output."""
    if raw["errors"] is not None or raw["usage"] is None or raw["wcf"] is None:
        return unavailable_component(base, selection, inputs, scope, [*reasons, "source_error"], raw)
    final = unique([*reasons, *(["source_warning"] if raw["warnings"] else [])])
    return {
        **base,
        "selection": selection,
        "inputs": inputs,
        "raw": raw,
        "status": "estimated",
        "metrics": impact_metrics(
            _raw_value(raw["usage"]["energy"]["value"]),
            _raw_value(raw["usage"]["gwp"]["value"]),
            _raw_value(raw["wcf"]["value"]),
            scope,
            final,
        ),
        "reasons": final,
    }


def admit_token_count(value):
    if not isinstance(value, str) or not value.isdigit() or (len(value) > 1 and value[0] == "0"):
        return None
    if len(value) > 16 or int(value) > MAX_SAFE_INTEGER:
        return None
    return int(value)


def latency_basis(timing):
    if timing is None:
        return "modeled"
    if timing["scope"] == "research_task":
        return "research_task"
    return "measured" if timing["source"] == "browser_request" else "history"


class ComponentEngine:
    """Binds the verified native functions and the method definition for one estimate."""

    def __init__(self, definition, native, serialize, resolve):
        self.definition = definition
        self.media = definition["media"]
        self.native = native
        self.serialize = serialize
        # resolve(model_id, provider, workload) -> resolution dict, as resolveModelProfile.
        self.resolve = resolve

    # Text -----------------------------------------------------------------

    def text_selection(self, model_id, provider):
        resolution = self.resolve(model_id, provider, "text")
        if resolution["kind"] == "upstream":
            return {
                "kind": resolution["selection"],
                "observed_model_id": model_id,
                "profile": resolution["profile"],
                "reason": None if resolution["selection"] == "direct_mapping" else "model_proxy",
                "basis": resolution["basis"],
            }
        # A component never switches engines; the original method is only a whole-reply choice.
        return {
            "kind": "unavailable",
            "observed_model_id": model_id,
            "profile": None,
            "reason": "original_engine_fallback" if resolution["kind"] == "original" else resolution["reason"],
            "basis": None,
        }

    def text_component(self, component_id, role, selection, output, timing, scope, reasons):
        base = {"component_id": component_id, "kind": "text", "role": role, "method_id": TEXT_METHOD_ID}
        latency = None if timing is None else float(timing["duration_seconds"])
        observed = selection["observed_model_id"]
        overrides = self.media["environment_overrides"]
        override = overrides[observed] if observed is not None and observed in overrides else None
        inputs = {
            **empty_inputs(),
            "output_tokens": output["value"],
            "latency_seconds": None if latency is None else decimal_string(latency),
            "latency_basis": latency_basis(timing),
            "environment_provider": selection["profile"]["provider"] if selection["profile"] else None,
            "electricity_mix_zone": override["electricity_mix_zone"] if override else None,
        }
        reasons = [*reasons, *(["environment_override"] if override else [])]
        profile = selection["profile"]
        if profile is None:
            return unavailable_component(
                base, selection, inputs, scope, [*reasons, selection["reason"] or "estimate_unavailable"]
            )
        if output["value"] is None or output["value"] == "0":
            return unavailable_component(base, selection, inputs, scope, [*reasons, "estimate_unavailable"])
        count = admit_token_count(output["value"])
        if count is None:
            return unavailable_component(base, selection, inputs, scope, [*reasons, "numeric_domain_unsupported"])
        zone = override["electricity_mix_zone"] if override else None
        lookup = {
            "provider": profile["provider"],
            "model_name": profile["model_name"],
            "output_token_count": count,
            "request_latency": latency,
            **({"electricity_mix_zone": zone} if zone else {}),
        }
        # Upstream llm_impacts takes no PUE or WUE, so an override with factors computes directly.
        factors = {key: value for key, value in (override or {}).items() if key in ("datacenter_pue", "datacenter_wue")}
        raw = self.serialize(
            self.native.llm_with_factors(**lookup, **factors) if factors else self.native.llm(**lookup)
        )
        if raw["errors"] is None:
            inputs["electricity_mix_zone"] = zone or self.native.provider_location(profile["provider"])
        return impact_component(base, selection, inputs, scope, reasons, raw)

    # Images ---------------------------------------------------------------

    def _image_provider(self, site, model_id):
        image = self.media["image"]
        if model_id is not None and model_id in image["model_providers"]:
            return image["model_providers"][model_id]
        return image["site_providers"].get(site)

    def image_component(self, component_id, role, site, model_id, count, width, height, reasons):
        scope = "modeled_image_component"
        image = self.media["image"]
        base = {"component_id": component_id, "kind": "image", "role": role, "method_id": image["method_id"]}
        provider = self._image_provider(site, model_id)
        inputs = {
            **empty_inputs(),
            "units": count,
            "width": width,
            "height": height,
            "environment_provider": provider,
        }
        environment = None if provider is None else self.native.environment(provider)
        if environment is None:
            return unavailable_component(base, None, inputs, scope, [*reasons, "factor_unavailable"])
        inputs["electricity_mix_zone"] = environment["zone"]
        units = int(count) if isinstance(count, str) and count.isdigit() else -1
        if units < 1 or units > MAX_SAFE_INTEGER:
            return unavailable_component(base, None, inputs, scope, [*reasons, "numeric_domain_unsupported"])
        it_kwh = units * float(image["it_energy_wh_per_image"]) / 1000
        pue, wue = environment["datacenter_pue"], environment["datacenter_wue"]
        energy = multiply(pue, it_kwh)
        gwp = multiply(energy, environment["gwp"])
        wcf = multiply(it_kwh, add(wue, multiply(pue, environment["wue"])))
        final = unique(reasons)
        return {
            **base,
            "selection": None,
            "inputs": inputs,
            "raw": None,
            "status": "estimated",
            "metrics": impact_metrics(energy, gwp, wcf, scope, final),
            "reasons": final,
        }

    # Speech ---------------------------------------------------------------

    def speech_component(self, component_id, role, site, seconds, reasons):
        scope = "modeled_speech_component"
        speech = self.media["speech"]
        base = {"component_id": component_id, "kind": "speech", "role": role, "method_id": speech["method_id"]}
        provider = speech["site_providers"].get(site)
        rate = (
            float(speech["tokens_per_second"][provider])
            if provider is not None and provider in speech["tokens_per_second"]
            else None
        )
        selection = {
            "kind": "model_override",
            "observed_model_id": None,
            "profile": dict(speech["profile"]),
            "reason": "model_proxy",
            "basis": "model_not_named",
        }
        reasons = [*reasons, "model_proxy"]
        inputs = {
            **empty_inputs(),
            "audio_seconds": decimal_string(seconds),
            "environment_provider": provider,
            "latency_basis": "modeled",
        }
        environment = None if provider is None else self.native.environment(provider)
        if rate is None or environment is None or not seconds > 0:
            return unavailable_component(base, selection, inputs, scope, [*reasons, "factor_unavailable"])
        inputs["electricity_mix_zone"] = environment["zone"]
        # Rounded half up, as in the extension; a reply always carries at least one token.
        tokens = max(1, math.floor(seconds * rate + 0.5))
        inputs["output_tokens"] = str(tokens)
        raw = self.serialize(self.native.speech(speech["profile"], tokens, provider))
        return impact_component(base, selection, inputs, scope, reasons, raw)

    # Video ----------------------------------------------------------------

    def video_component(self, component_id, site, item, reasons):
        scope = "modeled_video_component"
        video = self.media["video"]
        base = {
            "component_id": component_id,
            "kind": "video",
            "role": "generated_video",
            "method_id": video["method_id"],
        }
        # A video the page shows without naming its model uses the site's stand-in model.
        named = item["model_id"]
        resolution = self.resolve(named if named is not None else video["site_models"].get(site), None, "video")
        inputs = empty_inputs()
        if resolution["kind"] != "upstream":
            return unavailable_component(
                base,
                {
                    "kind": "unavailable",
                    "observed_model_id": named,
                    "profile": None,
                    "reason": "original_engine_fallback" if resolution["kind"] == "original" else resolution["reason"],
                    "basis": None,
                },
                inputs,
                scope,
                [*reasons, "estimate_unavailable"],
            )
        profile = resolution["profile"]
        selection = {
            "kind": resolution["selection"],
            "observed_model_id": named,
            "profile": profile,
            "reason": None if resolution["selection"] == "direct_mapping" and named is not None else "model_proxy",
            "basis": "model_not_named" if named is None else resolution["basis"],
        }
        fallback = video["site_defaults"].get(site) or video["model_defaults"].get(profile["model_name"])
        applied = ["model"] if named is None else []
        width, height = item["width"], item["height"]
        if width is None or height is None:
            width = fallback["width"] if fallback else None
            height = fallback["height"] if fallback else None
            applied.append("resolution")
        duration = None if item["duration_seconds"] is None else float(item["duration_seconds"])
        if duration is None:
            duration = float(fallback["duration_seconds"]) if fallback else None
            applied.append("duration")
        audio = item["with_audio"]
        if audio is None:
            audio = fallback["with_audio"] if fallback else None
            applied.append("audio")
        inputs.update(
            width=width,
            height=height,
            duration_seconds=None if duration is None else decimal_string(duration),
            with_audio=audio,
            defaults_applied=applied,
            environment_provider=profile["provider"],
        )
        reasons = [
            *reasons,
            *(["model_proxy"] if selection["reason"] == "model_proxy" else []),
            *(["media_default_assumed"] if applied else []),
        ]
        if width is None or height is None or duration is None or audio is None:
            return unavailable_component(base, selection, inputs, scope, [*reasons, "estimate_unavailable"])
        if not self.native.valid_video(width, height, duration):
            return unavailable_component(base, selection, inputs, scope, [*reasons, "numeric_domain_unsupported"])
        zone = self.native.video_location(profile["model_name"])
        if zone is not None:
            inputs["electricity_mix_zone"] = zone
        raw = self.serialize(
            self.native.video(
                model_name=profile["model_name"],
                resolution=f"{width}x{height}",
                duration=duration,
                with_audio=audio,
                datacenter_location=None,
            )
        )
        return impact_component(base, selection, inputs, scope, reasons, raw)

    # All media ------------------------------------------------------------

    def speech_seconds(self, item):
        if item["length_basis"] == "characters":
            if item["characters"] is None:
                return None
            return int(item["characters"]) / float(self.media["speech"]["characters_per_second"])
        return None if item["seconds"] is None else float(item["seconds"])

    def media_components(self, site, media, reasons):
        results = []
        counters = {"image": 0, "video": 0, "speech": 0}

        def next_id(kind):
            value = f"{kind}_{counters[kind]}"
            counters[kind] += 1
            return value

        for item in media:
            if item["kind"] == "image":
                results.append(
                    self.image_component(
                        next_id("image"),
                        "generated_image",
                        site,
                        item["model_id"],
                        item["count"],
                        item["width"],
                        item["height"],
                        reasons,
                    )
                )
            elif item["kind"] == "video":
                results.append(self.video_component(next_id("video"), site, item, reasons))
            elif item["kind"] == "speech":
                seconds = self.speech_seconds(item)
                results.append(
                    self.speech_component(
                        next_id("speech"),
                        "generated_speech",
                        site,
                        seconds if seconds is not None else 0,
                        [*reasons, *(["speech_length_estimated"] if item["length_basis"] == "characters" else [])],
                    )
                )
            else:
                # NotebookLM Video Overview: illustrations at the image figure plus narration.
                seconds = float(item["duration_seconds"])
                illustrations = math.ceil(seconds / float(self.media["overview"]["seconds_per_illustration"]))
                results.append(
                    self.image_component(
                        next_id("image"),
                        "overview_illustrations",
                        site,
                        None,
                        str(max(1, illustrations)),
                        None,
                        None,
                        reasons,
                    )
                )
                results.append(self.speech_component(next_id("speech"), "overview_narration", site, seconds, reasons))
        return results


def _sum(values):
    # Plain left-to-right addition, as in JavaScript; Python's sum() compensates rounding.
    total = 0.0
    for value in values:
        total += value
    return total


def sum_component_metrics(components, scope, reasons):
    """Adds component metrics; a range keeps its endpoints and a scalar counts as both."""
    estimated = [component for component in components if component["status"] == "estimated"]
    result = {}
    for name in QUANTITIES:
        metrics = [c["metrics"][name] for c in estimated if c["metrics"][name]["value"] is not None]
        if not metrics:
            result[name] = unavailable_metric(
                name, scope, ["not_applicable"] if name in ("water_direct", "water_upstream") else reasons
            )
            continue
        # Mirror of sumComponentMetrics: a point estimate is a range of zero width, so every
        # EcoLogits total is a range and totals add endpoint by endpoint.
        low = _sum(float(m["scenario_low"] if m["scenario_low"] is not None else m["value"]) for m in metrics)
        high = _sum(float(m["scenario_high"] if m["scenario_high"] is not None else m["value"]) for m in metrics)
        result[name] = {
            "value": decimal_string((low + high) / 2),
            "unit": UNITS[name],
            "scope": scope,
            "status": "partial_estimate",
            "phase": "usage",
            "scenario_low": decimal_string(low),
            "scenario_high": decimal_string(high),
            "interval_kind": "upstream_approximation",
            "value_kind": "midpoint",
            "reasons": list(reasons),
        }
    return result
