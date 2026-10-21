"""Generate the maintenance catalog through the staged upstream package's real loaders.

This adapter deliberately contains no impact equations or expected results. Its output contract is
the catalog schema consumed by packages/ecologits-core.
"""

from __future__ import annotations

import argparse
import dataclasses
import hashlib
import json
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


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def plain(value):
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if dataclasses.is_dataclass(value):
        return {key: plain(child) for key, child in dataclasses.asdict(value).items()}
    if isinstance(value, dict):
        return {key: plain(child) for key, child in value.items()}
    if isinstance(value, list):
        return [plain(child) for child in value]
    return value


def validate_raw(root: Path) -> tuple[dict, dict, dict]:
    raw_models = json.loads((root / "ecologits/data/models.json").read_text(encoding="utf-8"))
    raw_mixes = json.loads((root / "ecologits/data/electricity_mixes.json").read_text(encoding="utf-8"))
    raw_video = json.loads((root / "ecologits/data/video_models.json").read_text(encoding="utf-8"))
    if set(raw_models) != {"models", "aliases"}:
        raise ValueError(
            f"Unclassified model catalog keys: {sorted(set(raw_models) - {'models', 'aliases'})}"
        )
    if set(raw_mixes) != {"electricity_mixes"}:
        raise ValueError(
            f"Unclassified electricity catalog keys: {sorted(set(raw_mixes) - {'electricity_mixes'})}"
        )
    if set(raw_video) != {"models", "hardware_configurations", "provider_configurations"}:
        raise ValueError("Unclassified video catalog keys")
    model_keys: set[tuple[str, str]] = set()
    for model in raw_models["models"]:
        allowed = {"type", "provider", "name", "architecture", "warnings", "sources", "deployment"}
        unknown = set(model) - allowed
        if unknown:
            raise ValueError(f"Unclassified model fields for {model.get('name')}: {sorted(unknown)}")
        architecture = model.get("architecture", {})
        unknown_architecture = set(architecture) - {"type", "parameters", "active_parameters"}
        if unknown_architecture:
            raise ValueError(
                f"Unclassified architecture fields for {model.get('name')}: {sorted(unknown_architecture)}"
            )
        if "active_parameters" in architecture and model.get("name") != "command-a-plus-05-2026":
            raise ValueError(f"Unclassified ignored active_parameters field for {model.get('name')}")
        if architecture.get("type") not in {"dense", "moe"}:
            raise ValueError(
                f"Unclassified architecture type for {model.get('name')}: {architecture.get('type')}"
            )
        key = model.get("provider"), model.get("name")
        if key in model_keys:
            raise ValueError(f"Duplicate model: {key}")
        model_keys.add(key)
    alias_keys: set[tuple[str, str]] = set()
    for alias in raw_models["aliases"]:
        if set(alias) != {"type", "provider", "name", "alias"}:
            raise ValueError(f"Unclassified alias fields for {alias.get('name')}")
        key = alias["provider"], alias["name"]
        target = alias["provider"], alias["alias"]
        if key in alias_keys or key in model_keys:
            raise ValueError(f"Ambiguous alias: {key}")
        if target not in model_keys:
            raise ValueError(f"Alias target is missing: {target}")
        alias_keys.add(key)
    mix_names: set[str] = set()
    for mix in raw_mixes["electricity_mixes"]:
        unknown = set(mix) - {"name", "adpe", "pe", "gwp", "wue", "warnings"}
        if unknown:
            raise ValueError(f"Unclassified electricity fields for {mix.get('name')}: {sorted(unknown)}")
        if mix.get("name") in mix_names:
            raise ValueError(f"Duplicate electricity mix: {mix.get('name')}")
        mix_names.add(mix.get("name"))
        for field in ("adpe", "pe", "gwp", "wue"):
            value = mix.get(field)
            if not isinstance(value, (int, float)) or isinstance(value, bool) or value < 0:
                raise ValueError(f"Invalid electricity factor {field} for {mix.get('name')}")
    video_names: set[str] = set()
    for model in raw_video["models"]:
        if set(model) != {"provider", "model_name", "regression_parameters", "capabilities", "hardware"}:
            raise ValueError(f"Unclassified video model fields for {model.get('model_name')}")
        if set(model["regression_parameters"]) != {"n", "m", "n1", "m1", "n2", "m2", "g", "non_audio_weight"}:
            raise ValueError(f"Unclassified video regression fields for {model.get('model_name')}")
        if set(model["capabilities"]) != {"resolutions", "frames_count", "audio_generation"}:
            raise ValueError(f"Unclassified video capabilities for {model.get('model_name')}")
        if model["provider"] not in raw_video["provider_configurations"]:
            raise ValueError(f"Missing video provider configuration for {model.get('model_name')}")
        if model["hardware"] not in raw_video["hardware_configurations"]:
            raise ValueError(f"Missing video hardware for {model.get('model_name')}")
        if model["model_name"] in video_names:
            raise ValueError(f"Duplicate video model: {model.get('model_name')}")
        video_names.add(model["model_name"])
    for name, hardware in raw_video["hardware_configurations"].items():
        if set(hardware) != {
            "number_of_accelerators",
            "server_power",
            "server_embodied",
            "accelerator_embodied",
        }:
            raise ValueError(f"Unclassified hardware fields for {name}")
        if set(hardware["server_power"]) != {"p2_5", "mean", "p97_5"}:
            raise ValueError(f"Unclassified power fields for {name}")
        for phase in ("server_embodied", "accelerator_embodied"):
            if set(hardware[phase]) != {"gwp", "adpe", "pe"}:
                raise ValueError(f"Unclassified {phase} fields for {name}")
    for name, configuration in raw_video["provider_configurations"].items():
        if set(configuration) != {"datacenter_location", "datacenter_pue", "datacenter_wue"}:
            raise ValueError(f"Unclassified video provider defaults for {name}")
    return raw_models, raw_mixes, raw_video


def generate(root: Path, version: str, catalog_commit: str) -> dict:
    block_network()
    sys.path.insert(0, str(root))
    import ecologits  # pylint: disable=import-outside-toplevel
    from ecologits.electricity_mix_repository import electricity_mixes
    from ecologits.model_repository import models
    from ecologits.status_messages import _error_codes, _warning_codes
    from ecologits.tracers.utils import PROVIDER_CONFIG_MAP

    if ecologits.__version__ != version:
        raise ValueError(
            f"Candidate source version {ecologits.__version__} does not match requested {version}"
        )
    raw_models, raw_mixes, raw_video = validate_raw(root)
    model_path = root / "ecologits/data/models.json"
    mix_path = root / "ecologits/data/electricity_mixes.json"
    video_path = root / "ecologits/data/video_models.json"
    model_hash = sha(model_path)
    provenance = {}
    for index, model in enumerate(raw_models["models"]):
        provenance[f"{model['provider']}/{model['name']}"] = {
            "path": f"ecologits/data/models.json#/models/{index}",
            "source_sha256": model_hash,
            "raw_sources": model.get("sources", []),
        }
    for index, alias in enumerate(raw_models["aliases"]):
        provenance[f"{alias['provider']}/{alias['name']}"] = {
            "path": f"ecologits/data/models.json#/aliases/{index}",
            "source_sha256": model_hash,
            "alias_of": f"{alias['provider']}/{alias['alias']}",
        }
    return {
        "schema_version": "1",
        "upstream_version": version,
        "upstream_commit": catalog_commit,
        "models": [model.model_dump(mode="json") for model in models.list_models()],
        "aliases": raw_models["aliases"],
        "model_provenance": provenance,
        "electricity_mixes": [plain(mix) for mix in electricity_mixes.list_electricity_mixes()],
        "electricity_provenance": {
            mix["name"]: {
                "path": f"ecologits/data/electricity_mixes.json#/electricity_mixes/{index}",
                "source_sha256": sha(mix_path),
            }
            for index, mix in enumerate(raw_mixes["electricity_mixes"])
        },
        "provider_configurations": plain(PROVIDER_CONFIG_MAP),
        "video": raw_video,
        "video_provenance": {
            model["model_name"]: {
                "path": f"ecologits/data/video_models.json#/models/{index}",
                "source_sha256": sha(video_path),
            }
            for index, model in enumerate(raw_video["models"])
        },
        "warning_messages": {
            code: message().model_dump(mode="json") for code, message in _warning_codes.items()
        },
        "error_messages": {code: message().model_dump(mode="json") for code, message in _error_codes.items()},
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate", required=True, type=Path)
    parser.add_argument("--version", required=True)
    parser.add_argument("--catalog-commit", required=True)
    args = parser.parse_args()
    root = args.candidate.resolve(strict=True)
    output = generate(root, args.version, args.catalog_commit)
    encoded = (
        json.dumps(output, allow_nan=False, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    ).encode("utf-8")
    sys.stdout.buffer.write(encoded)


if __name__ == "__main__":
    main()
