"""JSON protocol around the actual locked EcoLogits package, never a formula adaptation."""
# ruff: noqa: E402

import dataclasses
import json
import math
import sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
from source_integrity import prepare_retained_oracle, verify_loaded_oracle

ORACLE_MANIFEST = prepare_retained_oracle()

from ecologits.electricity_mix_repository import ElectricityMix, ElectricityMixRepository, electricity_mixes
from ecologits.estimations.video import (
    duration_to_frames,
    parse_resolution,
    parse_value_or_range,
    video_impacts,
)
from ecologits.impacts import llm, video
from ecologits.impacts.modeling import GWP, PE, WCF, ADPe, Energy
from ecologits.model_repository import Alias, Model, ModelRepository, models
from ecologits.status_messages import ErrorMessage, WarningMessage
from ecologits.tracers.utils import ImpactsOutput, llm_impacts
from ecologits.utils.range_value import RangeValue

verify_loaded_oracle(ORACLE_MANIFEST)


def decode(value, *, range_values=True):
    if isinstance(value, dict):
        if set(value) == {"$float"}:
            return float(value["$float"])
        if range_values and set(value) == {"min", "max"}:
            return RangeValue(
                **{key: decode(child, range_values=range_values) for key, child in value.items()}
            )
        return {key: decode(child, range_values=range_values) for key, child in value.items()}
    if isinstance(value, list):
        return [decode(v, range_values=range_values) for v in value]
    return value


def encode(value):
    if hasattr(value, "model_dump"):
        return encode(value.model_dump(mode="python"))
    if dataclasses.is_dataclass(value):
        return encode(dataclasses.asdict(value))
    if hasattr(value, "value") and isinstance(value.value, str):
        return value.value
    if isinstance(value, float) and not math.isfinite(value):
        return {"$float": "NaN" if math.isnan(value) else "Infinity" if value > 0 else "-Infinity"}
    if isinstance(value, float) and value == 0 and math.copysign(1, value) < 0:
        return {"$float": "-0"}
    if isinstance(value, dict):
        return {k: encode(v) for k, v in value.items()}
    if isinstance(value, (tuple, list)):
        return [encode(v) for v in value]
    return value


def execute(case):
    op = case["op"]
    # Decode transport scalars for every operation; raw loaders must receive plain range dictionaries.
    raw_json = op in (
        "model_from_json",
        "repository",
        "electricity_from_json",
        "electricity_repository",
        "parse_value_or_range",
    )
    args = decode(case.get("args", {}), range_values=not raw_json)
    if op == "llm":
        return llm.compute_llm_impacts(**args)
    if op == "llm_dag":
        return llm.compute_llm_impacts_dag(**args)
    if op == "llm_execute":
        return llm.dag.execute(**args)
    if op == "video":
        return video.compute_video_impacts(**args)
    if op == "video_dag":
        return video.compute_video_impacts_dag(**args)
    if op == "video_execute":
        return video.dag.execute(**args)
    if op == "llm_lookup":
        args.setdefault("request_latency", None)
        return llm_impacts(**args)
    if op == "video_lookup":
        return video_impacts(**args)
    if op == "model":
        return models.find_model(**args)
    if op == "mix":
        return electricity_mixes.find_electricity_mix(**args)
    if op == "status_from_code":
        return (WarningMessage if args["kind"] == "warning" else ErrorMessage).from_code(args["code"])
    if op == "output_status":
        result = ImpactsOutput()
        for code in args["warnings"]:
            result.add_warning(WarningMessage.from_code(code))
        for code in args["errors"]:
            result.add_errors(ErrorMessage.from_code(code))
        return {"output": result, "has_warnings": result.has_warnings, "has_errors": result.has_errors}
    if op == "electricity_from_json":
        return ElectricityMix.from_json(args)
    if op == "electricity_repository":
        return ElectricityMixRepository(
            [ElectricityMix.from_json(m) for m in args["mixes"]]
        ).list_electricity_mixes()
    if op == "model_from_json":
        return Model.from_json(args)
    if op == "repository":
        return ModelRepository(
            [Model.from_json(m) for m in args["models"]],
            [Alias.model_validate(a) for a in args.get("aliases", [])],
        ).list_models()
    if op == "resolution":
        return parse_resolution(args["resolution"])
    if op == "frames":
        return duration_to_frames(args["duration"])
    if op == "parse_value_or_range":
        return parse_value_or_range(args["value"])
    if op == "gpu_count":
        return llm.gpu_required_count(**args)
    if op == "range":
        a, b = args["a"], args.get("b")
        actions = {
            "add": lambda: a + b,
            "multiply": lambda: a * b,
            "divide": lambda: a / b,
            "equal": lambda: a == b,
            "less": lambda: a < b,
            "lessEqual": lambda: a <= b,
            "greater": lambda: a > b,
            "greaterEqual": lambda: a >= b,
            "mean": lambda: a.mean,
        }
        return actions[args["action"]]()
    if op == "impact_add":
        types = {"energy": Energy, "gwp": GWP, "adpe": ADPe, "pe": PE, "wcf": WCF}
        return types[args["left"]](value=args["a"]) + types[args["right"]](value=args["b"])
    if op == "impact_compare":
        types = {"energy": Energy, "gwp": GWP, "adpe": ADPe, "pe": PE, "wcf": WCF}
        a, b = types[args["left"]](value=args["a"]), types[args["right"]](value=args["b"])
        actions = {
            "equal": lambda: a == b,
            "less": lambda: a < b,
            "lessEqual": lambda: a <= b,
            "greater": lambda: a > b,
            "greaterEqual": lambda: a >= b,
        }
        return actions[args["action"]]()
    raise ValueError(f"Unknown operation {op}")


def run(case):
    try:
        value = execute(case)
        return {"id": case["id"], "value": encode(value), "range_means": encode(range_means(value))}
    except Exception as error:
        return {"id": case["id"], "error": {"pythonType": type(error).__name__}}


def range_means(value, path=""):
    if isinstance(value, RangeValue):
        return {path: value.mean}
    if hasattr(value, "model_dump"):
        value = value.__dict__
    if dataclasses.is_dataclass(value):
        value = dataclasses.asdict(value)
    if isinstance(value, (tuple, list)):
        value = dict(enumerate(value))
    found = {}
    if isinstance(value, dict):
        for key, child in value.items():
            found.update(range_means(child, f"{path}.{key}"))
    return found


if __name__ == "__main__":
    cases = json.load(sys.stdin)
    json.dump([run(case) for case in cases], sys.stdout, allow_nan=False, separators=(",", ":"))
