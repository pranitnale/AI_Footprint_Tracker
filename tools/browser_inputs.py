"""One deterministic browser-source inclusion contract for release tools."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

CONTRACT_PATH = Path(__file__).with_name("browser-artifact-inputs.json")


def load_contract(path: Path = CONTRACT_PATH) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if (
        value.get("schema_version") != "1.0.0"
        or value.get("variant_schema_version") != "1.0.0"
        or value.get("path_order") != "utf8_bytes"
        or value.get("engines") != ["ecologits"]
    ):
        raise ValueError("unsupported_browser_input_contract")
    return value


def path_sort_key(name: str) -> bytes:
    """Order paths by their canonical UTF-8 bytes in every release runtime."""
    return name.encode("utf-8")


def selected_files(root: Path, contract: dict | None = None) -> list[tuple[Path, str]]:
    contract = contract or load_contract()
    excluded_parts = set(contract["excluded_parts"])
    excluded_suffixes = set(contract["excluded_suffixes"])
    selected: dict[str, Path] = {}
    for name in contract["fixed_files"]:
        path = root / name
        if unsafe_link(path):
            raise ValueError(f"source symlink is not allowed: {name}")
        if not path.is_file():
            raise ValueError(f"required source file is missing: {name}")
        selected[name] = path
    for root_name in contract["source_roots"]:
        source_root = root / root_name
        if unsafe_link(source_root) or not source_root.is_dir():
            raise ValueError(f"invalid source root: {root_name}")
        for current, directories, files in os.walk(
            source_root, topdown=True, followlinks=False
        ):
            current_path = Path(current)
            kept = []
            for name in directories:
                path = current_path / name
                if name in excluded_parts:
                    continue
                if unsafe_link(path):
                    relative = path.relative_to(root).as_posix()
                    raise ValueError(f"source symlink is not allowed: {relative}")
                kept.append(name)
            directories[:] = kept
            for name in files:
                path = current_path / name
                relative = path.relative_to(root)
                if set(relative.parts) & excluded_parts:
                    continue
                if unsafe_link(path):
                    raise ValueError(
                        f"source symlink is not allowed: {relative.as_posix()}"
                    )
                if path.suffix.lower() in excluded_suffixes or path.name.startswith(
                    ".env"
                ):
                    continue
                selected[relative.as_posix()] = path
    return [(selected[name], name) for name in sorted(selected, key=path_sort_key)]


def unsafe_link(path: Path) -> bool:
    return path.is_symlink() or (hasattr(path, "is_junction") and path.is_junction())


def input_fingerprint(root: Path, contract: dict | None = None) -> dict:
    records = []
    for path, name in selected_files(root, contract):
        data = path.read_bytes()
        records.append(
            {
                "path": name,
                "bytes": len(data),
                "sha256": hashlib.sha256(data).hexdigest(),
            }
        )
    encoded = json.dumps(records, ensure_ascii=False, separators=(",", ":")).encode(
        "utf-8"
    )
    return {
        "algorithm": "sha256",
        "files": len(records),
        "sha256": hashlib.sha256(encoded).hexdigest(),
    }
