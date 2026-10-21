"""JSON protocol around an exact staged EcoLogits Python candidate."""

from __future__ import annotations

import argparse
import dataclasses
import json
import math
import sys
from pathlib import Path


def block_network() -> None:
    import socket

    class OfflineSocket(socket.socket):
        def connect(self, *_args, **_kwargs):
            raise RuntimeError("Network access is disabled during EcoLogits verification")

        def connect_ex(self, *_args, **_kwargs):
            raise RuntimeError("Network access is disabled during EcoLogits verification")

    socket.socket = OfflineSocket
    socket.create_connection = lambda *_args, **_kwargs: (_ for _ in ()).throw(
        RuntimeError("Network access is disabled during EcoLogits verification")
    )


def configure(root: Path):
    block_network()
    sys.path.insert(0, str(root))
    from ecologits.electricity_mix_repository import (
        ElectricityMix,
        ElectricityMixRepository,
        electricity_mixes,
    )
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

    return {
        "duration_to_frames": duration_to_frames,
        "parse_resolution": parse_resolution,
        "parse_value_or_range": parse_value_or_range,
        "video_impacts": video_impacts,
        "electricity_mixes": electricity_mixes,
        "ElectricityMix": ElectricityMix,
        "ElectricityMixRepository": ElectricityMixRepository,
        "llm": llm,
        "video": video,
        "ADPe": ADPe,
        "Energy": Energy,
        "GWP": GWP,
        "PE": PE,
        "WCF": WCF,
        "Alias": Alias,
        "Model": Model,
        "ModelRepository": ModelRepository,
        "models": models,
        "ErrorMessage": ErrorMessage,
        "WarningMessage": WarningMessage,
        "ImpactsOutput": ImpactsOutput,
        "llm_impacts": llm_impacts,
        "RangeValue": RangeValue,
    }


def decode(value, range_value, range_values=True):
    if isinstance(value, dict):
        if set(value) == {"$float"}:
            return float(value["$float"])
        if range_values and set(value) == {"min", "max"}:
            return range_value(**value)
        return {key: decode(child, range_value, range_values) for key, child in value.items()}
    if isinstance(value, list):
        return [decode(child, range_value, range_values) for child in value]
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
        return {key: encode(child) for key, child in value.items()}
    if isinstance(value, (tuple, list)):
        return [encode(child) for child in value]
    return value


def range_means(value, range_value, path=""):
    if isinstance(value, range_value):
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
            found.update(range_means(child, range_value, f"{path}.{key}"))
    return found


def execute(case, api):
    operation = case["op"]
    raw_operations = {
        "model_from_json",
        "repository",
        "electricity_from_json",
        "electricity_repository",
        "parse_value_or_range",
    }
    args = decode(
        case.get("args", {}),
        api["RangeValue"],
        range_values=operation not in raw_operations,
    )
    if operation == "llm":
        return api["llm"].compute_llm_impacts(**args)
    if operation == "llm_dag":
        return api["llm"].compute_llm_impacts_dag(**args)
    if operation == "llm_execute":
        return api["llm"].dag.execute(**args)
    if operation == "video":
        return api["video"].compute_video_impacts(**args)
    if operation == "video_dag":
        return api["video"].compute_video_impacts_dag(**args)
    if operation == "video_execute":
        return api["video"].dag.execute(**args)
    if operation == "llm_lookup":
        args.setdefault("request_latency", None)
        return api["llm_impacts"](**args)
    if operation == "video_lookup":
        return api["video_impacts"](**args)
    if operation == "model":
        return api["models"].find_model(**args)
    if operation == "mix":
        return api["electricity_mixes"].find_electricity_mix(**args)
    if operation == "status_from_code":
        status_type = api["WarningMessage"] if args["kind"] == "warning" else api["ErrorMessage"]
        return status_type.from_code(args["code"])
    if operation == "output_status":
        result = api["ImpactsOutput"]()
        for code in args["warnings"]:
            result.add_warning(api["WarningMessage"].from_code(code))
        for code in args["errors"]:
            result.add_errors(api["ErrorMessage"].from_code(code))
        return {"output": result, "has_warnings": result.has_warnings, "has_errors": result.has_errors}
    if operation == "electricity_from_json":
        return api["ElectricityMix"].from_json(args)
    if operation == "electricity_repository":
        mixes = [api["ElectricityMix"].from_json(mix) for mix in args["mixes"]]
        return api["ElectricityMixRepository"](mixes).list_electricity_mixes()
    if operation == "model_from_json":
        return api["Model"].from_json(args)
    if operation == "repository":
        models = [api["Model"].from_json(model) for model in args["models"]]
        aliases = [api["Alias"].model_validate(alias) for alias in args.get("aliases", [])]
        return api["ModelRepository"](models, aliases).list_models()
    if operation == "resolution":
        return api["parse_resolution"](args["resolution"])
    if operation == "frames":
        return api["duration_to_frames"](args["duration"])
    if operation == "gpu_count":
        return api["llm"].gpu_required_count(**args)
    if operation == "parse_value_or_range":
        return api["parse_value_or_range"](args["value"])
    if operation == "range":
        left, right = args["a"], args.get("b")
        actions = {
            "add": lambda: left + right,
            "multiply": lambda: left * right,
            "divide": lambda: left / right,
            "equal": lambda: left == right,
            "less": lambda: left < right,
            "lessEqual": lambda: left <= right,
            "greater": lambda: left > right,
            "greaterEqual": lambda: left >= right,
            "mean": lambda: left.mean,
        }
        return actions[args["action"]]()
    if operation == "impact_add":
        types = {
            "energy": api["Energy"],
            "gwp": api["GWP"],
            "adpe": api["ADPe"],
            "pe": api["PE"],
            "wcf": api["WCF"],
        }
        return types[args["left"]](value=args["a"]) + types[args["right"]](value=args["b"])
    if operation == "impact_compare":
        types = {
            "energy": api["Energy"],
            "gwp": api["GWP"],
            "adpe": api["ADPe"],
            "pe": api["PE"],
            "wcf": api["WCF"],
        }
        left = types[args["left"]](value=args["a"])
        right = types[args["right"]](value=args["b"])
        actions = {
            "equal": lambda: left == right,
            "less": lambda: left < right,
            "lessEqual": lambda: left <= right,
            "greater": lambda: left > right,
            "greaterEqual": lambda: left >= right,
        }
        return actions[args["action"]]()
    raise ValueError(f"Unknown operation {operation}")


def run(case, api):
    try:
        value = execute(case, api)
        return {
            "id": case["id"],
            "value": encode(value),
            "range_means": encode(range_means(value, api["RangeValue"])),
        }
    except Exception as error:  # The exception type is the cross-runtime contract.
        return {"id": case["id"], "error": {"pythonType": type(error).__name__}}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate", required=True, type=Path)
    args = parser.parse_args()
    root = args.candidate.resolve(strict=True)
    api = configure(root)
    cases = json.load(sys.stdin)
    json.dump([run(case, api) for case in cases], sys.stdout, allow_nan=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
