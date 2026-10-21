"""Rebuild extracted source and compare every browser distribution entry."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import stat
import subprocess
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

try:
    from browser_inputs import input_fingerprint, load_contract, selected_files
except ModuleNotFoundError:
    from tools.browser_inputs import input_fingerprint, load_contract, selected_files

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = load_contract()
REPORT_PATH = ROOT / "artifacts/browser/source-verification.json"
ENGINES = tuple(CONTRACT["engines"])
VARIANTS = {
    f"{browser}-{engine}": {
        "browser": browser,
        "engine": engine,
        "folder": target["folder"],
    }
    for browser, target in CONTRACT["targets"].items()
    for engine in ENGINES
}


def record(data: bytes) -> dict:
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def archive_inventory(path: Path) -> dict:
    result = {}
    with zipfile.ZipFile(path) as archive:
        for entry in archive.infolist():
            name = entry.orig_filename
            parsed = PurePosixPath(name)
            if (
                parsed.is_absolute()
                or ".." in parsed.parts
                or "\\" in name
                or ":" in name
            ):
                raise ValueError("unsafe_archive_path")
            if stat.S_ISLNK(entry.external_attr >> 16):
                raise ValueError("archive_symlink_not_allowed")
            if entry.is_dir():
                continue
            if name in result:
                raise ValueError("duplicate_archive_entry")
            result[name] = record(archive.read(entry))
    return result


def directory_inventory(directory: Path) -> dict:
    return {
        path.relative_to(directory).as_posix(): record(path.read_bytes())
        for path in directory.rglob("*")
        if path.is_file()
    }


def compare(expected: dict, actual: dict) -> dict:
    missing = sorted(expected.keys() - actual.keys())
    extra = sorted(actual.keys() - expected.keys())
    changed = sorted(
        name
        for name in expected.keys() & actual.keys()
        if expected[name] != actual[name]
    )
    return {
        "matches": not (missing or extra or changed),
        "missing": missing,
        "extra": extra,
        "changed": changed,
    }


def run(command: list[str], directory: Path, environment: dict) -> None:
    executable = shutil.which(command[0])
    if not executable:
        raise SystemExit(f"required executable is unavailable: {command[0]}")
    subprocess.run(
        [executable, *command[1:]], cwd=directory, env=environment, check=True
    )


def compare_target_archives(
    paths: dict, directory: Path, contract: dict = CONTRACT
) -> tuple[dict, bool]:
    targets = {}
    matches = True
    variants = {
        f"{browser}-{engine}": target["folder"]
        for browser, target in contract["targets"].items()
        for engine in contract["engines"]
    }
    for variant, folder in variants.items():
        expected = archive_inventory(paths[variant])
        actual = directory_inventory(directory / "apps/extension/.output" / folder)
        comparison = compare(expected, actual)
        targets[variant] = {
            "expected_entries": len(expected),
            "rebuilt_entries": len(actual),
            **comparison,
        }
        matches = matches and comparison["matches"]
    return targets, matches


def invalidate_report(path: Path | None = None) -> None:
    (path or REPORT_PATH).unlink(missing_ok=True)


def validate_release_identity(
    manifest: dict, root: Path = ROOT, contract: dict = CONTRACT
) -> dict:
    if (
        manifest.get("schema_version") != "2.0.0"
        or manifest.get("product") != "ai-footprint-tracker"
        or manifest.get("build_status") != "release_candidate"
        or set(manifest.get("packages", {}))
        != {
            "sources",
            *(
                f"{browser}-{engine}"
                for browser in contract["targets"]
                for engine in contract["engines"]
            ),
        }
    ):
        raise SystemExit("unsupported browser release manifest")
    trusted_fingerprint = input_fingerprint(root, contract)
    if manifest.get("input_fingerprint") != trusted_fingerprint:
        raise SystemExit(
            "release manifest does not match the trusted current input contract"
        )
    configuration_path = root / "config/estimation.build.json"
    configuration = json.loads(configuration_path.read_text(encoding="utf-8"))
    default_engine = configuration.get("default_engine")
    selection = manifest.get("default_selection")
    if (
        default_engine not in contract.get("engines", [])
        or configuration.get("available_engines") != contract.get("engines")
        or not isinstance(selection, dict)
        or set(selection)
        != {
            "effective_configuration_sha256",
            "engine",
            "source",
            "source_input_sha256",
            "source_sha256",
        }
        or selection.get("engine") != default_engine
        or selection.get("source") != "config/estimation.build.json"
        or selection.get("source_sha256")
        != hashlib.sha256(configuration_path.read_bytes()).hexdigest()
        or selection.get("source_input_sha256") != trusted_fingerprint["sha256"]
    ):
        raise SystemExit("release manifest default selection is invalid")
    aliases = manifest.get("aliases")
    if not isinstance(aliases, dict) or set(aliases) != set(contract["targets"]):
        raise SystemExit("release manifest compatibility aliases are invalid")
    for browser in contract["targets"]:
        variant_id = f"{browser}-{default_engine}"
        package = manifest["packages"].get(variant_id, {})
        alias = aliases.get(browser)
        if (
            not isinstance(alias, dict)
            or set(alias) != {"bytes", "path", "sha256", "variant_id"}
            or alias.get("variant_id") != variant_id
            or alias.get("path") != f"/downloads/ai-footprint-tracker-{browser}.zip"
            or alias.get("bytes") != package.get("bytes")
            or alias.get("sha256") != package.get("sha256")
            or package.get("build_variant", {}).get("configuration_sha256")
            != selection.get("effective_configuration_sha256")
        ):
            raise SystemExit("release manifest compatibility aliases are invalid")
    return trusted_fingerprint


def validate_extracted_source(
    directory: Path,
    source_entries: set[str],
    manifest: dict,
    contract: dict = CONTRACT,
) -> dict:
    extracted_contract = load_contract(directory / "tools/browser-artifact-inputs.json")
    if extracted_contract != contract:
        raise SystemExit("source archive changed the trusted input contract")
    selected_names = {name for _, name in selected_files(directory, contract)}
    if source_entries != selected_names:
        raise SystemExit("source archive entries do not match the declared input set")
    extracted_fingerprint = input_fingerprint(directory, contract)
    if extracted_fingerprint != manifest.get("input_fingerprint"):
        raise SystemExit(
            "extracted source does not match the release input fingerprint"
        )
    return extracted_fingerprint


def main() -> None:
    invalidate_report()
    manifest_path = ROOT / "artifacts/browser/manifest.json"
    if not manifest_path.is_file():
        raise SystemExit("run package-browser-artifacts.py first")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    validate_release_identity(manifest)
    for browser, alias in manifest["aliases"].items():
        alias_path = ROOT / "apps/web/public" / alias["path"].lstrip("/")
        if (
            not alias_path.is_file()
            or alias_path.is_symlink()
            or record(alias_path.read_bytes())
            != {key: alias[key] for key in ("bytes", "sha256")}
        ):
            raise SystemExit(
                f"{browser} compatibility alias differs from its selected variant"
            )
    paths = {}
    for kind in ("sources", *VARIANTS):
        metadata = manifest["packages"][kind]
        if kind == "sources":
            expected_archive = f"artifacts/browser/ai-footprint-tracker-{manifest['version']}-sources.zip"
        else:
            variant = VARIANTS[kind]
            expected_archive = (
                f"artifacts/browser/{variant['browser']}/{variant['engine']}/"
                f"ai-footprint-tracker-{manifest['version']}-{kind}.zip"
            )
        if metadata.get("archive") != expected_archive:
            raise SystemExit(f"{kind} archive has an unexpected release path")
        path = (ROOT / metadata["archive"]).resolve()
        if not path.is_relative_to(ROOT / "artifacts/browser"):
            raise SystemExit("artifact path leaves the browser output directory")
        if record(path.read_bytes()) != {
            key: metadata[key] for key in ("bytes", "sha256")
        }:
            raise SystemExit(f"{kind} archive differs from its release manifest")
        paths[kind] = path
    source = archive_inventory(paths["sources"])
    source_package = "apps/extension/package.json"
    missing_source = set(CONTRACT["required_source_entries"]) - set(source)
    if missing_source:
        raise SystemExit(
            f"source archive is missing required inputs: {sorted(missing_source)}"
        )
    environment = {
        **os.environ,
        "SOURCE_DATE_EPOCH": str(manifest["source_date_epoch"]),
    }
    with tempfile.TemporaryDirectory(prefix="aift-source-verify-") as temporary:
        directory = Path(temporary)
        with zipfile.ZipFile(paths["sources"]) as archive:
            archive.extractall(directory)
        package = json.loads((directory / source_package).read_text(encoding="utf-8"))
        if package["version"] != manifest["version"]:
            raise SystemExit("source and distribution versions differ")
        extracted_fingerprint = validate_extracted_source(
            directory, set(source), manifest
        )
        run(["pnpm", "install", "--frozen-lockfile"], directory, environment)
        run(
            [
                "node",
                "--import",
                "tsx",
                "tools/refinement/build-variants.ts",
                "--release-candidate",
            ],
            directory,
            environment,
        )
        targets, matches = compare_target_archives(paths, directory)
        for variant in targets:
            targets[variant]["archive_sha256"] = manifest["packages"][variant]["sha256"]
        report = {
            "schema_version": "2.0.0",
            "version": manifest["version"],
            "source_archive_sha256": manifest["packages"]["sources"]["sha256"],
            "comparison": "uncompressed distribution paths, byte lengths and SHA-256 hashes",
            "input_fingerprint": extracted_fingerprint,
            "matches": matches,
            "targets": targets,
        }
        print(json.dumps(report, indent=2))
        if not matches:
            raise SystemExit(
                "Source rebuild differs from a matching browser ZIP. Check stale packages, build inputs and path/time/platform nondeterminism; no differences were normalized away."
            )
        REPORT_PATH.write_text(
            json.dumps(report, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
            newline="\n",
        )


if __name__ == "__main__":
    main()
