"""Deterministically regenerate the adopted catalog and identity from locked retained source."""

from __future__ import annotations

import dataclasses
import hashlib
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "oracle"))
from source_integrity import (  # noqa: E402
    load_lock,
    prepare_retained_oracle,
    snapshot_path,
    verify_loaded_oracle,
)

RETAINED = prepare_retained_oracle()
SNAPSHOT = snapshot_path(ROOT, RETAINED)

from ecologits.electricity_mix_repository import electricity_mixes  # noqa: E402
from ecologits.model_repository import models  # noqa: E402
from ecologits.status_messages import _error_codes, _warning_codes  # noqa: E402
from ecologits.tracers.utils import PROVIDER_CONFIG_MAP  # noqa: E402

verify_loaded_oracle(RETAINED)


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


def encode(value) -> bytes:
    return (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode()


def generate() -> dict[Path, bytes]:
    configured_lock = load_lock()
    raw_models = json.loads((SNAPSHOT / "ecologits/data/models.json").read_text(encoding="utf8"))
    raw_mixes = json.loads((SNAPSHOT / "ecologits/data/electricity_mixes.json").read_text(encoding="utf8"))
    raw_video = json.loads((SNAPSHOT / "ecologits/data/video_models.json").read_text(encoding="utf8"))
    assert set(raw_models) == {"models", "aliases"}
    assert set(raw_mixes) == {"electricity_mixes"}
    assert set(raw_video) == {"models", "hardware_configurations", "provider_configurations"}
    for model in raw_models["models"]:
        assert set(model) <= {
            "type",
            "provider",
            "name",
            "architecture",
            "warnings",
            "sources",
            "deployment",
        }, model["name"]
        assert set(model["architecture"]) <= {"type", "parameters", "active_parameters"}
        if "active_parameters" in model["architecture"]:
            assert model["name"] == "command-a-plus-05-2026", "Unclassified ignored architecture field"
        assert model["architecture"]["type"] in ("dense", "moe")
    aliases = set()
    model_keys = {(model["provider"], model["name"]) for model in raw_models["models"]}
    for alias in raw_models["aliases"]:
        assert set(alias) == {"type", "provider", "name", "alias"}
        key = alias["provider"], alias["name"]
        assert key not in aliases and key not in model_keys, f"Ambiguous alias: {key}"
        aliases.add(key)
    for mix in raw_mixes["electricity_mixes"]:
        assert set(mix) <= {"name", "adpe", "pe", "gwp", "wue", "warnings"}
    for model in raw_video["models"]:
        assert set(model) == {"provider", "model_name", "regression_parameters", "capabilities", "hardware"}
        assert set(model["regression_parameters"]) == {
            "n",
            "m",
            "n1",
            "m1",
            "n2",
            "m2",
            "g",
            "non_audio_weight",
        }
        assert set(model["capabilities"]) == {"resolutions", "frames_count", "audio_generation"}
        assert model["provider"] in raw_video["provider_configurations"]
        assert model["hardware"] in raw_video["hardware_configurations"]
    assert len({model["model_name"] for model in raw_video["models"]}) == len(raw_video["models"])
    for hardware in raw_video["hardware_configurations"].values():
        assert set(hardware) == {
            "number_of_accelerators",
            "server_power",
            "server_embodied",
            "accelerator_embodied",
        }
        assert set(hardware["server_power"]) == {"p2_5", "mean", "p97_5"}
        for phase in ("server_embodied", "accelerator_embodied"):
            assert set(hardware[phase]) == {"gwp", "adpe", "pe"}
    for configuration in raw_video["provider_configurations"].values():
        assert set(configuration) == {"datacenter_location", "datacenter_pue", "datacenter_wue"}
    provenance = {}
    model_hash = sha(SNAPSHOT / "ecologits/data/models.json")
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
    version = RETAINED["upstream_version"]
    catalog_commit = configured_lock.get("catalog_commit", RETAINED["requested_git_commit"])
    catalog = {
        "schema_version": configured_lock["catalog_schema"],
        "upstream_version": version,
        "upstream_commit": catalog_commit,
        "models": [model.model_dump(mode="json") for model in models.list_models()],
        "aliases": raw_models["aliases"],
        "model_provenance": provenance,
        "electricity_mixes": [plain(mix) for mix in electricity_mixes.list_electricity_mixes()],
        "electricity_provenance": {
            mix["name"]: {
                "path": f"ecologits/data/electricity_mixes.json#/electricity_mixes/{index}",
                "source_sha256": sha(SNAPSHOT / "ecologits/data/electricity_mixes.json"),
            }
            for index, mix in enumerate(raw_mixes["electricity_mixes"])
        },
        "provider_configurations": plain(PROVIDER_CONFIG_MAP),
        "video": raw_video,
        "video_provenance": {
            model["model_name"]: {
                "path": f"ecologits/data/video_models.json#/models/{index}",
                "source_sha256": sha(SNAPSHOT / "ecologits/data/video_models.json"),
            }
            for index, model in enumerate(raw_video["models"])
        },
        "warning_messages": {
            code: message().model_dump(mode="json") for code, message in _warning_codes.items()
        },
        "error_messages": {code: message().model_dump(mode="json") for code, message in _error_codes.items()},
    }
    blob = encode(catalog)
    core_files = {
        path.relative_to(ROOT).as_posix(): sha(path) for path in sorted((ROOT / "src").glob("*.ts"))
    }
    retained_hashes = {path: entry["sha256"] for path, entry in RETAINED["retained_files"].items()}
    lock = dict(configured_lock)
    lock.update(
        {
            "upstream_version": version,
            "requested_git_commit": RETAINED["requested_git_commit"],
            "source_artifact": RETAINED["source_artifact"],
            "source_distribution": RETAINED["distribution"],
            "retained_source_manifest_sha256": sha(ROOT / "upstream/retained-source.json"),
            "catalog_sha256": hashlib.sha256(blob).hexdigest(),
            "core_sha256": hashlib.sha256(encode(core_files)).hexdigest(),
            "core_files": core_files,
            "oracle_lock_sha256": sha(ROOT / "oracle/uv.lock"),
            "files": retained_hashes,
            "counts": {
                "models": len(raw_models["models"]),
                "aliases": len(raw_models["aliases"]),
                "resolved_models": len(catalog["models"]),
                "electricity_mixes": len(catalog["electricity_mixes"]),
                "video_models": len(raw_video["models"]),
                "hardware_configurations": len(raw_video["hardware_configurations"]),
            },
        }
    )
    if "oracle_project_sha256" in lock:
        lock["oracle_project_sha256"] = sha(ROOT / "oracle/pyproject.toml")
    if "python_lock_sha256" in lock:
        lock["python_lock_sha256"] = lock["oracle_lock_sha256"]
    if "source_map_sha256" in lock:
        lock["source_map_sha256"] = sha(ROOT / "source-to-port-map.json")
    if "license_sha256" in lock:
        lock["license_sha256"] = sha(ROOT / "LICENSE")
    if "citation_sha256" in lock:
        lock["citation_sha256"] = sha(ROOT / "CITATION.cff")
    identity = {
        key: lock[key]
        for key in [
            "upstream_version",
            "requested_git_commit",
            "core_version",
            "core_sha256",
            "converter_version",
            "catalog_schema",
            "catalog_sha256",
        ]
    }
    identity["source_artifact_sha256"] = lock["source_artifact"]["sha256"]
    return {
        ROOT / "data/catalog.json": blob,
        ROOT / "upstream/lock.json": encode(lock),
        ROOT / "data/identity.json": encode(identity),
    }


if __name__ == "__main__":
    artifacts = generate()
    for path, content in artifacts.items():
        if "--check" in sys.argv:
            assert path.read_bytes() == content, f"Generated artifact drift: {path}"
        else:
            path.write_bytes(content)
    print("Catalog and lock verified." if "--check" in sys.argv else "Catalog and lock generated.")
