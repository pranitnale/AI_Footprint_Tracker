"""Product admission and projection around the pinned native EcoLogits package."""

import hashlib
import importlib.metadata
import json
import math
import re
import sys
from functools import lru_cache
from pathlib import Path
from types import FunctionType

from footprint_contracts import claude_factor_for, claude_measurement, payload_hash
from footprint_estimator import (
    BASELINE_METHOD_HASH,
    BASELINE_METHOD_ID,
    RETIRED_IMAGE_REFERENCE_HASH,
    baseline_bundle,
    estimate_observation,
)

from . import engine_components
from .engine_components import ComponentEngine, decimal_string, sum_component_metrics
from .security import Problem

ROOT = Path(__file__).resolve().parents[3]
SUPPORTED_NATIVE_VERSION = "0.11.3"
MAX_SAFE_INTEGER = 9007199254740991
# Perplexity serves models of many vendors, so its replies name no provider by site.
PROVIDERS = {"chatgpt": "openai", "claude": "anthropic", "gemini": "google_genai", "notebooklm": "google_genai"}
QUANTITIES = ("energy", "carbon", "water_direct", "water_upstream", "water_total")
IMAGE_REFERENCE_HASH = RETIRED_IMAGE_REFERENCE_HASH
MISSING_ADMISSION_METHOD_ID = "unavailable-admission-v1"
CATALOG_FILES = frozenset(
    f"ecologits/data/{name}.json" for name in ("models", "electricity_mixes", "video_models")
)


@lru_cache(maxsize=1)
def packaged_definition():
    from estimation_contracts import validate_build_configuration, validate_method_definition

    build = validate_build_configuration(json.loads((ROOT / "config/estimation.build.json").read_text()))
    return validate_method_definition(
        {
            "schema_version": "1.0.0",
            "engine_id": "ecologits",
            "core": json.loads((ROOT / "packages/ecologits-core/data/identity.json").read_text()),
            "mappings": json.loads((ROOT / "config/estimation.mappings.json").read_text()),
            "fallback": build["ecologits_fallback"],
            "media": json.loads((ROOT / "config/estimation.media.json").read_text()),
            "product_policy": "operational-only-output-1",
            "latency_policy": "observed-live-then-history-then-modeled-1",
            "environment_policy": "upstream-provider-default-assumed",
            "water_total_policy": "upstream-wcf-1",
            "original_fallback": {"method_id": BASELINE_METHOD_ID, "method_hash": BASELINE_METHOD_HASH},
        }
    )


def packaged_claude_token_factor():
    """
    The Claude token factor of the packaged method (owner decision of 15 October 2026). Token
    figures always use it, as the extension's do; estimates use the factor of their own method.
    """
    return packaged_definition()["media"].get("claude_token_factor")


def identity(definition):
    hashed = payload_hash(definition)
    if definition.get("engine_id") != "ecologits":
        return {
            "engine_id": "original",
            "implementation_version": definition["equation_id"],
            "method_id": definition["method_id"],
            "method_hash": hashed,
            "source_version": None,
            "source_commit": None,
            "catalog_hash": payload_hash(definition["profiles"]),
            "profile_policy_hash": payload_hash(definition["profiles"]),
            "environment_policy_hash": payload_hash(definition["scenario"]),
            "product_scope": "operational-only",
        }
    core = definition["core"]
    return {
        "engine_id": "ecologits",
        "implementation_version": core["core_version"],
        "method_id": f"ecologits-{core['upstream_version']}-{hashed}",
        "method_hash": hashed,
        "source_version": core["upstream_version"],
        "source_commit": core["requested_git_commit"],
        "catalog_hash": core["catalog_sha256"],
        "profile_policy_hash": payload_hash(
            {"mappings": definition["mappings"], "fallback": definition["fallback"], "media": definition["media"]}
        ),
        "environment_policy_hash": payload_hash(
            {
                "catalog": core["catalog_sha256"],
                "environment": definition["environment_policy"],
                "water": definition["water_total_policy"],
            }
        ),
        "product_scope": "operational-only",
    }


def _source_bytes(root, relative):
    if (
        not isinstance(relative, str)
        or "\\" in relative
        or any(part in ("", ".", "..") for part in relative.split("/"))
    ):
        raise ValueError("Invalid native source path")
    path = root
    if root.is_symlink():
        raise ValueError("Invalid native source root")
    for part in relative.split("/"):
        path = path / part
        if path.is_symlink():
            raise ValueError("Invalid native source link")
    if not path.resolve().is_relative_to(root.resolve()) or not path.is_file():
        raise ValueError("Invalid native source file")
    return path.read_bytes()


def _native_source_data(installed):
    core_root = ROOT / "packages/ecologits-core"
    lock = json.loads(_source_bytes(core_root, "upstream/lock.json"))
    manifest_bytes = _source_bytes(core_root, "upstream/retained-source.json")
    if hashlib.sha256(manifest_bytes).hexdigest() != lock["retained_source_manifest_sha256"]:
        raise ValueError("Native source manifest changed")
    manifest = json.loads(manifest_bytes)
    if (
        manifest["schema_version"] != 1
        or manifest["distribution"] != "retained-source-subset"
        or lock["source_distribution"] != manifest["distribution"]
        or any(
            lock[field] != manifest[field]
            for field in ("upstream_version", "requested_git_commit", "source_artifact")
        )
        or lock["upstream_version"] != SUPPORTED_NATIVE_VERSION
    ):
        raise ValueError("Native source identity changed")
    core = packaged_definition()["core"]
    if (
        any(
            core[field] != lock[field]
            for field in (
                "upstream_version",
                "requested_git_commit",
                "core_version",
                "core_sha256",
                "catalog_schema",
                "catalog_sha256",
                "converter_version",
            )
        )
        or core["source_artifact_sha256"] != lock["source_artifact"]["sha256"]
    ):
        raise ValueError("Native source does not match the accepted method")
    catalog_bytes = _source_bytes(core_root, "data/catalog.json")
    if hashlib.sha256(catalog_bytes).hexdigest() != core["catalog_sha256"]:
        raise ValueError("Accepted native catalog changed")
    generated = json.loads(catalog_bytes)
    if (
        generated["schema_version"] != core["catalog_schema"]
        or generated["upstream_version"] != core["upstream_version"]
        or generated["upstream_commit"] != lock.get("catalog_commit", lock["requested_git_commit"])
    ):
        raise ValueError("Native catalog provenance changed")
    overlays = lock.get("catalog_overlay_files", [])
    if (
        not isinstance(overlays, list)
        or any(not isinstance(name, str) for name in overlays)
        or len(overlays) != len(set(overlays))
        or not set(overlays) <= CATALOG_FILES
        or (
            overlays
            and (
                lock.get("release_kind") != "qualified_combination"
                or lock.get("core_commit") != lock["requested_git_commit"]
                or not isinstance(lock.get("qualified_label"), str)
                or not lock["qualified_label"]
                or any(
                    not re.fullmatch(r"[a-f0-9]{40}", lock.get(field, ""))
                    for field in ("core_commit", "catalog_commit")
                )
            )
        )
    ):
        raise ValueError("Unqualified native catalog overlay")
    retained = manifest["retained_files"]
    if not retained or lock["files"] != {name: entry["sha256"] for name, entry in retained.items()}:
        raise ValueError("Native source lock changed")
    snapshot_name = manifest["snapshot_directory"]
    if (
        not isinstance(snapshot_name, str)
        or not snapshot_name
        or snapshot_name in (".", "..")
        or Path(snapshot_name).name != snapshot_name
        or "/" in snapshot_name
        or "\\" in snapshot_name
    ):
        raise ValueError("Invalid native snapshot")
    snapshot = core_root / "upstream" / snapshot_name
    data = {}
    for name, entry in retained.items():
        content = _source_bytes(snapshot, name)
        if len(content) != entry["size"] or hashlib.sha256(content).hexdigest() != entry["sha256"]:
            raise ValueError("Native retained source changed")
        if name.startswith("ecologits/") and name.endswith((".py", ".json")):
            if name not in overlays and content != _source_bytes(installed, name.removeprefix("ecologits/")):
                raise ValueError("Installed native source changed")
            if name in CATALOG_FILES:
                data[name] = json.loads(content)
    if set(data) != CATALOG_FILES:
        raise ValueError("Native catalog is incomplete")
    return lock, data, generated


class NativeRuntime:
    """Verified native functions bound to the accepted catalog data."""

    def __init__(self, llm, models, mixes, provider_configs, compute_llm, output_type, video, video_data):
        self.llm = llm
        self.models = models
        self.mixes = mixes
        self.provider_configs = provider_configs
        self.compute_llm = compute_llm
        self.output_type = output_type
        self.video = video
        self.video_data = video_data

    def provider_location(self, provider):
        config = self.provider_configs.get(provider)
        return (config.datacenter_location if config else None) or "WOR"

    def environment(self, provider):
        """The EcoLogits data-centre configuration of a provider with its grid factors."""
        config = self.provider_configs.get(provider)
        if config is None:
            return None
        mix = self.mixes.find_electricity_mix(zone=config.datacenter_location)
        if mix is None:
            return None
        return {
            "zone": config.datacenter_location,
            "datacenter_pue": config.datacenter_pue,
            "datacenter_wue": config.datacenter_wue,
            "gwp": mix.gwp,
            "wue": mix.wue,
        }

    def speech(self, profile, tokens, provider):
        """The speech model's own parameters with the site provider's data centre."""
        from ecologits.model_repository import ParametersMoE
        from ecologits.status_messages import ModelNotRegisteredError, ZoneNotRegisteredError

        model = self.models.find_model(provider=profile["provider"], model_name=profile["model_name"])
        if model is None:
            return self.output_type(errors=[ModelNotRegisteredError(message="Speech model is not registered.")])
        parameters = model.architecture.parameters
        if isinstance(parameters, ParametersMoE):
            total, active = parameters.total, parameters.active
        else:
            total, active = parameters, parameters
        config = self.provider_configs[provider]
        mix = self.mixes.find_electricity_mix(zone=config.datacenter_location)
        if mix is None:
            return self.output_type(errors=[ZoneNotRegisteredError(message="Speech zone is not registered.")])
        impacts = self.compute_llm(
            model_active_parameter_count=active,
            model_total_parameter_count=total,
            output_token_count=tokens,
            request_latency=None,
            if_electricity_mix_adpe=mix.adpe,
            if_electricity_mix_pe=mix.pe,
            if_electricity_mix_gwp=mix.gwp,
            if_electricity_mix_wue=mix.wue,
            datacenter_pue=config.datacenter_pue,
            datacenter_wue=config.datacenter_wue,
            tps=model.deployment.tps if model.deployment else None,
            ttft=model.deployment.ttft if model.deployment else None,
        )
        output = self.output_type.model_validate(impacts.model_dump())
        for warning in [*(model.warnings or []), *(mix.warnings or [])]:
            output.add_warning(warning)
        return output

    def llm_with_factors(self, provider, model_name, output_token_count, request_latency, **overrides):
        """llm_impacts with a model's own PUE and WUE in place of its provider's, as the
        estimator does for an environment override. Factors are the method's decimal strings."""
        from ecologits.model_repository import ParametersMoE
        from ecologits.status_messages import ModelNotRegisteredError, ZoneNotRegisteredError
        from ecologits.utils.range_value import RangeValue

        def factor(value):
            if isinstance(value, str):
                return float(value)
            return RangeValue(min=float(value["min"]), max=float(value["max"]))

        model = self.models.find_model(provider=provider, model_name=model_name)
        if model is None:
            message = f"Could not find model `{model_name}` for {provider} provider."
            return self.output_type(errors=[ModelNotRegisteredError(message=message)])
        parameters = model.architecture.parameters
        if isinstance(parameters, ParametersMoE):
            total, active = parameters.total, parameters.active
        else:
            total, active = parameters, parameters
        config = self.provider_configs[provider]
        zone = overrides.get("electricity_mix_zone") or config.datacenter_location or "WOR"
        mix = self.mixes.find_electricity_mix(zone=zone)
        if mix is None:
            message = f"Could not find electricity mix for `{zone}` zone."
            return self.output_type(errors=[ZoneNotRegisteredError(message=message)])
        pue, wue = overrides.get("datacenter_pue"), overrides.get("datacenter_wue")
        impacts = self.compute_llm(
            model_active_parameter_count=active,
            model_total_parameter_count=total,
            output_token_count=output_token_count,
            request_latency=request_latency,
            if_electricity_mix_adpe=mix.adpe,
            if_electricity_mix_pe=mix.pe,
            if_electricity_mix_gwp=mix.gwp,
            if_electricity_mix_wue=mix.wue,
            datacenter_pue=config.datacenter_pue if pue is None else factor(pue),
            datacenter_wue=config.datacenter_wue if wue is None else factor(wue),
            tps=model.deployment.tps if model.deployment else None,
            ttft=model.deployment.ttft if model.deployment else None,
        )
        output = self.output_type.model_validate(impacts.model_dump())
        for warning in [*(model.warnings or []), *(mix.warnings or [])]:
            output.add_warning(warning)
        return output

    def video_model(self, model_name):
        return next((m for m in self.video_data["models"] if m["model_name"] == model_name), None)

    def video_location(self, model_name):
        model = self.video_model(model_name)
        if model is None:
            return None
        zone = self.video_data["provider_configurations"][model["provider"]]["datacenter_location"]
        return zone if self.mixes.find_electricity_mix(zone=zone) is not None else None

    @staticmethod
    def valid_video(width, height, duration):
        """Mirrors validateVideoLookupInput: positive, finite and inside safe integers."""
        if not math.isfinite(duration) or duration <= 0:
            return False
        frames = math.trunc(duration * 24 + 1)
        for value in (width, height, frames):
            if not isinstance(value, int) or value <= 0 or value > MAX_SAFE_INTEGER:
                return False
        area = width * height
        return all(value <= MAX_SAFE_INTEGER for value in (area, area**2, area * frames, frames**2))


@lru_cache(maxsize=1)
def native_bundle():
    try:
        if importlib.metadata.version("ecologits") != SUPPORTED_NATIVE_VERSION:
            raise ImportError()
        installed = Path(importlib.metadata.distribution("ecologits").locate_file("ecologits"))
        lock, data, generated = _native_source_data(installed)
        from ecologits.electricity_mix_repository import ElectricityMix, ElectricityMixRepository
        from ecologits.estimations.video import video_impacts
        from ecologits.impacts.llm import compute_llm_impacts
        from ecologits.log import logger
        from ecologits.model_repository import Alias, Model, ModelRepository
        from ecologits.tracers.utils import PROVIDER_CONFIG_MAP, ImpactsOutput, llm_impacts

        for name, module in tuple(sys.modules.items()):
            if name == "ecologits" or name.startswith("ecologits."):
                path = Path(module.__file__).resolve()
                relative = "ecologits/" + path.relative_to(installed.resolve()).as_posix()
                if relative not in lock["files"]:
                    raise ImportError()
        catalog = data["ecologits/data/models.json"]
        models = ModelRepository(
            models=[Model.from_json(row) for row in catalog["models"]],
            aliases=[Alias.model_validate(row) for row in catalog.get("aliases") or []],
        )
        mixes = ElectricityMixRepository(
            [
                ElectricityMix.from_json(row)
                for row in data["ecologits/data/electricity_mixes.json"]["electricity_mixes"]
            ]
        )
        if not models.list_models() or not mixes.list_electricity_mixes():
            raise ValueError("Native catalog is empty")
        normalized_mixes = [
            {
                **{field: getattr(mix, field) for field in ("zone", "adpe", "pe", "gwp", "wue")},
                "warnings": [warning.model_dump(mode="json") for warning in mix.warnings],
            }
            for mix in mixes.list_electricity_mixes()
        ]
        video_data = data["ecologits/data/video_models.json"]
        if (
            generated["models"] != [model.model_dump(mode="json") for model in models.list_models()]
            or generated["aliases"] != (catalog.get("aliases") or [])
            or generated["electricity_mixes"] != normalized_mixes
            or generated["video"] != video_data
        ):
            raise ValueError("Native data does not match the accepted generated catalog")

        def bind(function, data_globals):
            # Keep the verified installed function body and bind exact retained data without changing upstream globals.
            bound = FunctionType(
                function.__code__,
                {**function.__globals__, **data_globals},
                function.__name__,
                function.__defaults__,
                function.__closure__,
            )
            bound.__kwdefaults__ = function.__kwdefaults__
            return bound

        native = bind(llm_impacts, {"models": models, "electricity_mixes": mixes})
        video = bind(
            video_impacts,
            {
                "electricity_mixes": mixes,
                "_HARDWARE_CONFIGURATIONS": video_data["hardware_configurations"],
                "_PROVIDER_CONFIGURATIONS": video_data["provider_configurations"],
                "_MODELS_INFO": {model["model_name"]: model for model in video_data["models"]},
            },
        )
        # The product persists sanitized status codes; upstream logs must not become a second data sink.
        logger.disabled = True
        return NativeRuntime(
            native, models, mixes, dict(PROVIDER_CONFIG_MAP), compute_llm_impacts, ImpactsOutput, video, video_data
        )
    except (ImportError, OSError, ValueError, KeyError, TypeError, AttributeError):
        raise Problem("engine_unavailable", 409, True) from None


def native_runtime():
    bundle = native_bundle()
    return bundle.llm, bundle.models


def _has_profile(runtime, profile):
    if profile["workload"] == "video":
        model = runtime.video_model(profile["model_name"])
        return model is not None and model["provider"] == profile["provider"]
    return runtime.models.find_model(provider=profile["provider"], model_name=profile["model_name"]) is not None


def require_native(definition):
    if (
        definition["core"] != packaged_definition()["core"]
        or definition["water_total_policy"] != packaged_definition()["water_total_policy"]
    ):
        raise Problem("engine_unavailable", 409, True)
    runtime = native_bundle()
    policy = definition["fallback"]
    if not all(provider in policy["provider_defaults"] for provider in PROVIDERS.values()):
        raise Problem("method_update_invalid", 422)
    references = list(definition["mappings"]["bindings"].values()) + [
        rule["profile"]
        for rule in [
            *policy["provider_defaults"].values(),
            *policy["model_overrides"].values(),
            policy["unknown_provider"],
        ]
        if "profile" in rule
    ]
    media = definition["media"]
    if (
        any(not _has_profile(runtime, reference) for reference in references)
        or not _has_profile(runtime, media["speech"]["profile"])
        or any(runtime.video_model(name) is None for name in media["video"]["model_defaults"])
    ):
        raise Problem("method_update_invalid", 422)
    return runtime.llm, runtime.models


def resolve_profile(definition, model_id, provider, workload):
    """Mirrors resolveModelProfile: no ranking and no switch to a different provider."""
    runtime = native_bundle()
    policy = definition["fallback"]

    def choose(profile, selection, basis):
        if profile["workload"] != workload:
            return {"kind": "unavailable", "reason": "unsupported_workload"}
        if provider is not None and profile["provider"] != provider:
            return {"kind": "unavailable", "reason": "model_provider_conflict"}
        if not _has_profile(runtime, profile):
            return {"kind": "unavailable", "reason": "profile_absent"}
        return {"kind": "upstream", "selection": selection, "profile": dict(profile), "basis": basis}

    # A family benchmark stands in for a model the site did not name, or for a label the
    # registry does not know yet; Details names which of the two applies.
    benchmark = "model_not_named" if model_id is None else "model_not_in_library"
    override = policy["model_overrides"].get(model_id) if model_id is not None else None
    if override:
        if override["strategy"] == "original_engine":
            return {"kind": "original", "reason": "model_override"}
        if override["strategy"] == "unavailable":
            return {"kind": "unavailable", "reason": "model_override"}
        return choose(override["profile"], "model_override", override["basis"])
    direct = definition["mappings"]["bindings"].get(model_id) if model_id is not None else None
    if direct and _has_profile(runtime, direct):
        return choose(direct, "direct_mapping", "exact_record")
    fallback = policy["provider_defaults"].get(provider) if provider is not None else None
    if fallback is None:
        unknown = policy["unknown_provider"]
        if unknown["strategy"] == "original_engine":
            return {"kind": "original", "reason": "unknown_provider_policy"}
        if unknown["strategy"] == "unavailable":
            return {"kind": "unavailable", "reason": "provider_unknown"}
        return choose(unknown["profile"], "provider_flagship", benchmark)
    if fallback["strategy"] == "original_engine":
        return {"kind": "original", "reason": "provider_policy"}
    if fallback["strategy"] == "unavailable":
        return {"kind": "unavailable", "reason": "provider_policy"}
    return choose(fallback["profile"], "provider_flagship", benchmark)


def select_profile(definition, site, model_id):
    """The reply's own text selection, as the extension records it."""
    require_native(definition)
    resolution = resolve_profile(definition, model_id, PROVIDERS.get(site), "text")
    if resolution["kind"] == "original":
        return {"kind": "original_fallback", "profile": None, "reason": resolution["reason"], "basis": None}
    if resolution["kind"] == "upstream":
        return {
            "kind": resolution["selection"],
            "profile": resolution["profile"],
            "reason": None if resolution["selection"] == "direct_mapping" else "model_proxy",
            "basis": resolution["basis"],
        }
    return {"kind": "unavailable", "profile": None, "reason": resolution["reason"], "basis": None}


def serialize(value):
    if hasattr(value, "model_dump"):
        value = value.model_dump(mode="json")
    if isinstance(value, dict):
        return {key: serialize(child) for key, child in value.items()}
    if isinstance(value, list):
        return [serialize(child) for child in value]
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return decimal_string(value)
    return value


def endpoints(value):
    return (
        (float(value["min"]), float(value["max"]))
        if isinstance(value, dict)
        else (float(value), float(value))
    )


def product_metric(value, quantity, scope, reasons, multiplier=1):
    low, high = endpoints(value) if value is not None else (None, None)
    ranged = isinstance(value, dict)
    return {
        "value": decimal_string((low * multiplier + high * multiplier) / 2 if ranged else low * multiplier)
        if low is not None
        else None,
        "unit": "kWh" if quantity == "energy" else "gCO2e" if quantity == "carbon" else "L",
        "status": "partial_estimate" if value is not None else "unavailable",
        "scope": scope,
        "phase": "usage",
        "scenario_low": decimal_string(low * multiplier) if ranged else None,
        "scenario_high": decimal_string(high * multiplier) if ranged else None,
        "interval_kind": "upstream_approximation" if ranged else None,
        "value_kind": "midpoint" if ranged else "scalar" if value is not None else "unavailable",
        "reasons": reasons,
    }


def validate_history_observation(record):
    from footprint_contracts import validate_history_page

    validate_history_page(
        {
            "schema_version": "3.0.0",
            "site": record["site"],
            "conversation_key": record["conversation_key"],
            "observed_at": record["observed_at"],
            "deletion_epoch": 0,
            "messages": [record],
            "branch_scope": "unknown",
            "selected_leaf_key": None,
            "branch_message_keys": None,
            "root_message_key": None,
            "first_request_verified": False,
            "has_earlier": None,
            "has_later": None,
        }
    )


def estimate(definition, observation, request=None, options=None, *, canonical_binding=None, history=None):
    from estimation_contracts import calculation_input_hash, validate_estimation_envelope
    from footprint_contracts import validate_observation

    from .historical_usage import estimate as original_history
    from .timing_evidence import (
        assert_linked_history,
        generation_covers,
        linked_reply_model,
        project_attempt,
        select_output,
        select_timing,
    )

    options = options or {}
    historical = "message_key" in observation
    if historical:
        validate_history_observation(observation)
    missing_original = options.get("originalMethodMissing", False)
    if observation.get("proposed_method_id") == MISSING_ADMISSION_METHOD_ID and not missing_original:
        raise Problem("method_update_invalid", 422)
    if (
        not isinstance(missing_original, bool)
        or (
            missing_original
            and (
                historical
                or observation.get("proposed_method_id") != MISSING_ADMISSION_METHOD_ID
                or options.get("view") != "recalculated"
                or options.get("originalMethodHash") is not None
                or not options.get("methodId")
            )
        )
        or (
            options.get("view") == "recalculated"
            and options.get("originalMethodHash") is None
            and not missing_original
        )
    ):
        raise Problem("method_update_invalid", 422)
    if not historical and request is None:
        raise Problem("estimation_input_unavailable", 409, True)
    if not historical:
        validate_observation(observation)
        validate_observation(request)
        if observation["kind"] != "attempt" or request["kind"] != "request":
            raise Problem("estimation_input_unavailable", 409, True)
    if not historical and request["request_id"] != observation["request_id"] and canonical_binding is None:
        raise Problem("estimation_input_unavailable", 409, True)
    if canonical_binding is not None:
        relation = {
            "kind": "canonical_request_alias",
            "observed_request_id": observation["request_id"],
            "canonical_request_id": request["request_id"],
        }
        if canonical_binding != {
            "observed_request_id": relation["observed_request_id"],
            "canonical_request_id": relation["canonical_request_id"],
            "relation_hash": payload_hash(relation),
        }:
            raise Problem("estimation_input_unavailable", 409, True)
    if history is not None:
        if historical:
            raise Problem("estimation_input_unavailable", 409, True)
        validate_history_observation(history)
        assert_linked_history(request, observation, history)
    selected_timing = select_timing(
        None if historical else observation, observation if historical else history
    )
    model_id = (
        observation["model_id"]
        if historical
        else linked_reply_model(observation, history)
    )
    source = (
        {
            "family": "history",
            "message_key": observation["message_key"],
            "observation_hash": payload_hash({k: v for k, v in observation.items() if k != "observed_at"}),
        }
        if historical
        else {
            "family": "live",
            "request_id": request["request_id"],
            "request_revision": request["revision"],
            "request_hash": payload_hash(request),
            "attempt_id": observation["attempt_id"],
            "attempt_revision": observation["revision"],
            "attempt_hash": payload_hash(observation),
        }
    )
    if history is not None:
        source["history_binding"] = {
            "message_key": history["message_key"],
            "observation_hash": payload_hash({k: v for k, v in history.items() if k != "observed_at"}),
        }
    requested = identity(definition)
    if missing_original and options["methodId"] != requested["method_id"]:
        raise Problem("method_update_invalid", 422)
    if canonical_binding is not None:
        source["canonical_request_binding"] = canonical_binding
    site = observation["site"] if historical else request["site"]
    selection = {
        **(
            select_profile(definition, site, model_id)
            if requested["engine_id"] == "ecologits"
            else {"kind": "legacy_reference", "profile": None, "reason": None, "basis": None}
        ),
        "observed_model_id": model_id,
    }
    scope = "historical_visible_response" if historical else "modeled_text_component"
    output = observation["tokens"] if historical else select_output(observation, history)
    # A saved reply can carry media or components the live stream never showed (late
    # images, research reports); the fuller of the two descriptions is used, never both.
    generation = (
        observation["generation"]
        if historical
        else history["generation"]
        if history is not None and generation_covers(history["generation"], observation["generation"])
        else observation["generation"]
    )
    reasons = list(
        dict.fromkeys(
            observation.get("coverage_reasons", [])
            + (history["coverage_reasons"] if history else [])
            + [
                "unvalidated_reference",
                "input_length_not_modelled",
                "hidden_reasoning_unobserved",
            ]
            + (["provider_environment_assumed"] if requested["engine_id"] == "ecologits" else [])
            + (["history_only"] if historical else [])
            + (["original_method_missing"] if missing_original else [])
        )
    )
    result = {
        "schema_version": "3.0.0",
        "source": source,
        "auxiliary_method_hashes": {"image_reference": IMAGE_REFERENCE_HASH},
        "requested_method": requested,
        "effective_method": requested,
        "execution_origin": "organization",
        "view": options.get("view", "original"),
        "original_method_hash": options.get("originalMethodHash"),
        "selection": selection,
        "raw": None,
        "components": [],
        "status": "unavailable",
        "metrics": {q: product_metric(None, q, scope, reasons) for q in QUANTITIES},
        "image_references": [],
        "reasons": reasons,
        "missing_components": baseline_bundle()["missing_components"]
        + (["provider_execution_unobserved"] if historical else []),
        "validation_state": "unvalidated_reference",
        "comparability": {
            "energy_boundary": "facility",
            "carbon_boundary": "lifecycle",
            "carbon_accounting": "location",
            "water_kind": "consumption",
            "direct_water_source": "unknown",
            "upstream_water_source": "all_source",
            "common_water_scope": None,
            "tokenizer_profile_id": output.get("profile_id"),
        },
    }
    if selection["kind"] in {"original_fallback", "legacy_reference"}:
        bundle = definition if requested["engine_id"] == "original" else baseline_bundle()
        if selection["kind"] == "original_fallback" and definition["original_fallback"] != {
            "method_id": bundle["method_id"],
            "method_hash": payload_hash(bundle),
        }:
            raise Problem("engine_unavailable", 409, True)
        raw = (
            original_history(observation, bundle)
            if historical
            else estimate_observation(
                project_attempt(observation, history),
                {**options, "methodId": bundle["method_id"]},
                bundle=bundle,
            )
        )
        if not historical:
            raw["observation_hash"] = payload_hash(observation)
        result["effective_method"] = identity(bundle)
        result["raw"] = {"engine_id": "original", "result": raw}
        original_reasons = (
            [
                "history_only",
                "unvalidated_reference",
                "input_length_not_modelled",
                "hidden_reasoning_unobserved",
            ]
            if historical
            else raw["reasons"]
        )
        result["reasons"] = list(
            dict.fromkeys(
                original_reasons
                + reasons
                + (["original_engine_fallback"] if selection["kind"] == "original_fallback" else [])
            )
        )
        result["missing_components"] = bundle["missing_components"] + (
            ["provider_execution_unobserved"] if historical else []
        )
        if historical:
            result["metrics"] = {q: product_metric(None, q, scope, original_reasons) for q in QUANTITIES}
        metrics = {m["quantity"]: m for m in raw} if historical else raw["metrics"]
        for q, metric in metrics.items():
            result["metrics"][q] = {
                **product_metric(metric["value"], q, scope, metric["reasons"]),
                "unit": metric["unit"],
                "value": metric["value"],
            }
        scenario = bundle["scenario"]
        result["comparability"].update(
            {
                k: scenario[k]
                for k in (
                    "carbon_boundary",
                    "carbon_accounting",
                    "water_kind",
                    "direct_water_source",
                    "upstream_water_source",
                    "common_water_scope",
                )
            }
        )
    else:
        result["reasons"], result["components"], result["raw"] = calculate_components(
            definition,
            site,
            historical,
            observation,
            history,
            output,
            selected_timing,
            generation,
            selection,
            reasons,
            scope,
        )
        if any(component["status"] == "estimated" for component in result["components"]):
            result["metrics"] = sum_component_metrics(result["components"], scope, result["reasons"])
    if result["effective_method"]["engine_id"] == "ecologits":
        result["missing_components"] = [
            component
            for component in result["missing_components"]
            if component != "compatible_total_water_scope"
        ]
    if result["effective_method"]["engine_id"] == "ecologits" and all(
        metric["value"] is None for metric in result["metrics"].values()
    ):
        result["metrics"] = {q: product_metric(None, q, scope, result["reasons"]) for q in QUANTITIES}
    result["status"] = (
        "estimated" if any(m["value"] is not None for m in result["metrics"].values()) else "unavailable"
    )
    if missing_original:
        result["reasons"] = list(dict.fromkeys(result["reasons"] + ["original_method_missing"]))
    result["input_hash"] = calculation_input_hash(result)
    return validate_estimation_envelope(result)


def calculate_components(
    definition, site, historical, observation, history, output, timing, generation, selection, reasons, scope
):
    """One result per generated component, as calculateEcoLogits. Returns reasons, components and raw."""
    execution_reason = (
        ("not_applicable" if observation["role"] != "response" else None)
        if historical
        else (
            "not_applicable"
            if observation["execution_evidence"] == "none" and not (history and history["text_complete"])
            else None
        )
    )
    if execution_reason:
        return engine_components.unique([*reasons, execution_reason]), [], None
    engine = ComponentEngine(
        definition,
        native_bundle(),
        serialize,
        lambda model_id, provider, workload: resolve_profile(definition, model_id, provider, workload),
    )
    components = []
    others = bool(generation["text_components"] or generation["media"])
    # Mirrors calculateEcoLogits: Claude text is estimated from Claude's own count, only under a
    # method whose definition names the factor (owner decision of 15 October 2026).
    factor = definition["media"].get("claude_token_factor")
    output = claude_measurement(output, claude_factor_for(site, selection["observed_model_id"], factor))
    # A reply that generated only media has no text to estimate; an unknown count still
    # appears so Details can say what is missing. Each component names its own stand-in, so
    # a media-only reply never reports the text model's proxy.
    if not (others and output["value"] == "0"):
        main_reasons = [*reasons, *(["model_proxy"] if selection["reason"] == "model_proxy" else [])]
        components.append(engine.text_component("text_0", "main", selection, output, timing, scope, main_reasons))
    for index, item in enumerate(generation["text_components"]):
        chosen = engine.text_selection(item["model_id"], PROVIDERS.get(site))
        complete = item["timing"] is not None and item["timing"]["completeness"] == "complete_for_scope"
        components.append(
            engine.text_component(
                f"text_{index + 1}",
                item["role"],
                chosen,
                claude_measurement(item["tokens"], claude_factor_for(site, item["model_id"], factor)),
                item["timing"] if complete else None,
                scope,
                [*reasons, *(["model_proxy"] if chosen["reason"] == "model_proxy" else [])],
            )
        )
    media_reasons = ["unvalidated_reference", "provider_environment_assumed", *(["history_only"] if historical else [])]
    components.extend(engine.media_components(site, generation["media"], media_reasons))
    unavailable = any(component["status"] == "unavailable" for component in components)
    # A stand-in is reported only when a component it estimated counts in the total.
    proxied = any(
        component["status"] == "estimated" and "model_proxy" in component["reasons"] for component in components
    )
    combined = [
        reason
        for reason in engine_components.unique(
            [
                *reasons,
                *(reason for component in components for reason in component["reasons"]),
                *(["component_unavailable"] if unavailable and len(components) > 1 else []),
            ]
        )
        if reason != "model_proxy" or proxied
    ]
    main = next((component for component in components if component["role"] == "main"), None)
    raw = None if main is None or main["raw"] is None else {"engine_id": "ecologits", "result": main["raw"]}
    return combined, components, raw


def projection(result):
    """Read-only summary adapter; persisted envelopes and legacy raw objects are never rewritten."""
    if result.get("schema_version") != "3.0.0":
        raise Problem("estimate_lineage_conflict", 503)
    requested, effective = result["requested_method"], result["effective_method"]
    profile = result["selection"]["profile"]
    legacy = result["raw"]["result"] if result["raw"] and result["raw"]["engine_id"] == "original" else None
    child = legacy if isinstance(legacy, dict) else legacy[0] if legacy else {}
    return {
        **result,
        "method_id": requested["method_id"],
        "method_hash": requested["method_hash"],
        "cohort_hash": effective["catalog_hash"],
        "cohort_id": effective["method_id"],
        "environment_scenario_id": effective["environment_policy_hash"],
        "selected_profile_id": f"{profile['provider']}/{profile['model_name']}"
        if profile
        else child.get("selected_profile_id"),
        "profile_selection": result["selection"]["kind"],
        "starting_energy_boundary": "facility",
        "result_scope": result["metrics"]["energy"]["scope"],
        "reference_only": False,
        "image_references": result["image_references"],
    }


def history_metrics(result, observation=None):
    if isinstance(result, list):
        return result
    if result.get("status") == "pending":
        if observation is None or observation["role"] != "response":
            return []
        reason = result.get("reason")
        if reason not in {"method_unsupported", "method_update_invalid"}:
            reason = "estimate_unavailable"
        return [
            {
                "quantity": q,
                "value": None,
                "unit": "kWh" if q == "energy" else "gCO2e" if q == "carbon" else "L",
                "scope": "historical_visible_response",
                "method_id": observation["proposed_method_id"],
                "method_hash": observation["proposed_method_hash"],
                "status": "unavailable",
                "validation_state": "unvalidated_reference",
                "profile_selection": "unavailable",
                "selected_profile_id": None,
                "reasons": ["history_only", reason],
                "missing_components": ["provider_execution_unobserved"],
                "known_message_count": "0",
                "unknown_message_count": "1",
            }
            for q in QUANTITIES
        ]
    p = projection(result)
    return [
        {
            "quantity": q,
            **m,
            "method_id": p["method_id"],
            "method_hash": p["method_hash"],
            "validation_state": p["validation_state"],
            "profile_selection": p["profile_selection"],
            "selected_profile_id": p["selected_profile_id"],
            "missing_components": p["missing_components"],
            "known_message_count": "1" if m["value"] is not None else "0",
            "unknown_message_count": "0" if m["value"] is not None else "1",
            "requested_method": p["requested_method"],
            "effective_method": p["effective_method"],
            "comparability": p["comparability"],
        }
        for q, m in p["metrics"].items()
    ]
