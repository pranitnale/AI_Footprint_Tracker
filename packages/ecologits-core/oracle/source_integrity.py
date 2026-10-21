"""Validate and activate the exact retained EcoLogits oracle selected by its manifests."""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
import os
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_manifest(root: Path = ROOT) -> dict:
    return json.loads((root / "upstream/retained-source.json").read_text(encoding="utf8"))


def load_lock(root: Path = ROOT) -> dict:
    return json.loads((root / "upstream/lock.json").read_text(encoding="utf8"))


def snapshot_path(root: Path, manifest: dict) -> Path:
    name = manifest["snapshot_directory"]
    assert isinstance(name, str) and name and Path(name).name == name, "Invalid snapshot directory"
    snapshot = (root / "upstream" / name).resolve()
    assert (
        snapshot.is_relative_to((root / "upstream").resolve()) and not (root / "upstream" / name).is_symlink()
    )
    return snapshot


def _locked_package(root: Path) -> tuple[dict, dict]:
    lock = tomllib.loads((root / "oracle/uv.lock").read_text(encoding="utf8"))
    package = next(package for package in lock["package"] if package["name"] == "ecologits")
    project = tomllib.loads((root / "oracle/pyproject.toml").read_text(encoding="utf8"))
    return package, project


def verify_retained_source(
    root: Path = ROOT, manifest: dict | None = None, installed: Path | None = None
) -> dict:
    supplied_manifest = manifest is not None
    manifest = manifest or load_manifest(root)
    lock = load_lock(root)
    assert manifest["schema_version"] == 1
    assert manifest["distribution"] == "retained-source-subset"
    assert lock["source_distribution"] == manifest["distribution"]
    assert lock["upstream_version"] == manifest["upstream_version"]
    assert lock["requested_git_commit"] == manifest["requested_git_commit"]
    assert lock["source_artifact"] == manifest["source_artifact"]
    if not supplied_manifest:
        assert sha(root / "upstream/retained-source.json") == lock["retained_source_manifest_sha256"]
    retained = manifest["retained_files"]
    excluded = manifest["excluded_files"]
    assert retained and not (set(retained) & set(excluded)), "Retained/excluded overlap"
    assert len(retained) + len(excluded) == manifest["original_file_count"]
    assert lock["files"] == {path: entry["sha256"] for path, entry in retained.items()}
    snapshot = snapshot_path(root, manifest)
    actual = set()
    for directory, directories, filenames in os.walk(snapshot, followlinks=False):
        directory_path = Path(directory)
        for name in directories:
            assert not (directory_path / name).is_symlink(), "Symlink directory in retained source"
        for name in filenames:
            path = directory_path / name
            assert path.is_file() and not path.is_symlink(), "Invalid retained source entry"
            actual.add(path.relative_to(snapshot).as_posix())
    assert actual == set(retained), f"Retained allowlist mismatch: {actual ^ set(retained)}"
    catalog_overlays = set(lock.get("catalog_overlay_files", []))
    if catalog_overlays:
        assert lock.get("release_kind") == "qualified_combination"
        assert catalog_overlays <= {
            "ecologits/data/models.json",
            "ecologits/data/electricity_mixes.json",
            "ecologits/data/video_models.json",
        }
    for relative, entry in retained.items():
        source = (snapshot / relative).resolve()
        assert source.is_relative_to(snapshot) and not (snapshot / relative).is_symlink(), (
            "Invalid retained path"
        )
        data = source.read_bytes()
        assert len(data) == entry["size"] and hashlib.sha256(data).hexdigest() == entry["sha256"], (
            f"Retained hash mismatch: {relative}"
        )
        if installed is not None and relative.startswith("ecologits/") and relative not in catalog_overlays:
            dependency = installed / relative.removeprefix("ecologits/")
            assert dependency.is_file() and not dependency.is_symlink(), (
                f"Installed oracle file missing: {relative}"
            )
            assert data == dependency.read_bytes(), f"Installed oracle mismatch: {relative}"
    package, project = _locked_package(root)
    assert package["version"] == manifest["upstream_version"]
    assert package["sdist"]["hash"] == "sha256:" + manifest["source_artifact"]["sha256"]
    assert project["project"]["dependencies"] == [f"ecologits=={manifest['upstream_version']}"]
    metadata_path = root / "upstream" / f"pypi-{manifest['upstream_version']}.json"
    if metadata_path.exists():
        metadata = json.loads(metadata_path.read_text(encoding="utf8"))
        artifact = next(
            item for item in metadata["urls"] if item["filename"] == manifest["source_artifact"]["filename"]
        )
        assert artifact["digests"]["sha256"] == manifest["source_artifact"]["sha256"]
    else:
        assert manifest["source_artifact"]["origin"] == "developer-supplied-local-artifact"
    assert sha(root / "oracle/uv.lock") == lock["oracle_lock_sha256"]
    if "oracle_project_sha256" in lock:
        assert sha(root / "oracle/pyproject.toml") == lock["oracle_project_sha256"]
    return manifest


def installed_source_root() -> Path:
    distribution = importlib.metadata.distribution("ecologits")
    return Path(distribution.locate_file("ecologits")).resolve()


def prepare_retained_oracle(root: Path = ROOT) -> dict:
    assert not any(name == "ecologits" or name.startswith("ecologits.") for name in sys.modules), (
        "EcoLogits must not be imported before retained source activation"
    )
    manifest = verify_retained_source(root=root, installed=installed_source_root())
    sys.path.insert(0, str(snapshot_path(root, manifest)))
    return manifest


def verify_loaded_oracle(manifest: dict, root: Path = ROOT) -> dict:
    import ecologits

    assert ecologits.__version__ == manifest["upstream_version"], "Wrong retained oracle version"
    snapshot = snapshot_path(root, manifest)
    for name, module in tuple(sys.modules.items()):
        if name == "ecologits" or name.startswith("ecologits."):
            assert getattr(module, "__file__", None), f"Oracle module has no file: {name}"
            path = Path(module.__file__).resolve()
            assert path.is_relative_to(snapshot), f"Oracle module loaded outside retained snapshot: {name}"
            relative = path.relative_to(snapshot).as_posix()
            assert relative in manifest["retained_files"], f"Unretained loaded oracle module: {relative}"
    return manifest


def verify_installed_oracle() -> dict:
    """Compatibility wrapper for callers that already activated and imported retained source."""
    manifest = load_manifest()
    verify_retained_source(installed=installed_source_root())
    return verify_loaded_oracle(manifest)
