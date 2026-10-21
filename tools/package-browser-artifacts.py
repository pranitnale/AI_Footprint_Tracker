"""Create deterministic EcoLogits browser archives and matching source."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import stat
import zipfile
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath

try:
    from browser_inputs import input_fingerprint, load_contract, selected_files
except ModuleNotFoundError:
    from tools.browser_inputs import input_fingerprint, load_contract, selected_files

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads(
    (ROOT / "apps/extension/package.json").read_text(encoding="utf-8")
)["version"]
OUTPUT = ROOT / "artifacts/browser"
WEB_DOWNLOADS = ROOT / "apps/web/public/downloads"
CONTRACT = load_contract()
TARGETS = CONTRACT["targets"]
ENGINES = tuple(CONTRACT["engines"])
CONFIGURATION_PATH = ROOT / "config/estimation.build.json"
BUILD_CONFIGURATION = json.loads(CONFIGURATION_PATH.read_text(encoding="utf-8"))
DEFAULT_ENGINE = BUILD_CONFIGURATION.get("default_engine")
if DEFAULT_ENGINE not in ENGINES or BUILD_CONFIGURATION.get(
    "available_engines"
) != list(ENGINES):
    raise SystemExit("invalid checked-in browser default configuration")
VARIANTS = {
    f"{browser}-{engine}": {
        "browser": browser,
        "engine": engine,
        "folder": target["folder"],
        "manifest_version": target["manifest_version"],
    }
    for browser, target in TARGETS.items()
    for engine in ENGINES
}
SOURCE_EPOCH = int(os.environ.get("SOURCE_DATE_EPOCH", "1788998400"))
if SOURCE_EPOCH < 315532800:
    raise SystemExit("SOURCE_DATE_EPOCH predates the ZIP timestamp range")
FIXED_TIME = datetime.fromtimestamp(max(SOURCE_EPOCH, 315532800), UTC).timetuple()[:6]
SOURCE_FILES = CONTRACT["fixed_files"]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def record(path: Path) -> dict:
    return {"bytes": path.stat().st_size, "sha256": sha256(path)}


def archive(output: Path, files: list[tuple[Path, str]]) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as target:
        for source, name in sorted(files, key=lambda value: value[1].encode("utf-8")):
            info = zipfile.ZipInfo(name.replace("\\", "/"), FIXED_TIME)
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            target.writestr(
                info,
                source.read_bytes(),
                compress_type=zipfile.ZIP_DEFLATED,
                compresslevel=9,
            )


def source_files() -> list[tuple[Path, str]]:
    try:
        return selected_files(ROOT, CONTRACT)
    except ValueError as error:
        raise SystemExit(str(error)) from error


def safe_zip_inventory(path: Path) -> dict[str, dict]:
    result = {}
    with zipfile.ZipFile(path) as source:
        for entry in source.infolist():
            name = entry.orig_filename
            parsed = PurePosixPath(name)
            if (
                parsed.is_absolute()
                or ".." in parsed.parts
                or "\\" in name
                or ":" in name
            ):
                raise SystemExit("corresponding source contains an unsafe path")
            if stat.S_ISLNK(entry.external_attr >> 16):
                raise SystemExit("corresponding source contains a link")
            if entry.is_dir():
                continue
            if name in result:
                raise SystemExit("corresponding source contains a duplicate path")
            data = source.read(entry)
            result[name] = {
                "bytes": len(data),
                "sha256": hashlib.sha256(data).hexdigest(),
            }
    return result


def validate_notices(folder: Path, root: Path = ROOT) -> dict:
    inventory_path = folder / "licenses/inventory.json"
    if not inventory_path.is_file():
        raise SystemExit("browser build is missing its full license payload")
    inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
    files = inventory.get("files", [])
    names = {item["path"] for item in files}
    required = set(CONTRACT["required_variant_entries"]) - {
        "build-variant.json",
        "licenses/inventory.json",
    } | {"LICENSE", "THIRD-PARTY-NOTICES.md"}
    if not required.issubset(names):
        raise SystemExit(
            f"browser license inventory is incomplete: {sorted(required - names)}"
        )
    for item in files:
        target = (folder / item["path"]).resolve()
        if (
            not target.is_relative_to(folder.resolve())
            or not target.is_file()
            or target.is_symlink()
        ):
            raise SystemExit("invalid browser license path")
        if target.stat().st_size != item["bytes"] or sha256(target) != item["sha256"]:
            raise SystemExit("browser license payload hash mismatch")
    components = inventory.get("components", [])
    for component in components:
        if not component.get("notices") or not set(component["notices"]).issubset(
            names
        ):
            raise SystemExit("dependency is missing full upstream notices")
    ecologits_components = [
        item for item in components if item.get("license") == "MPL-2.0"
    ]
    if len(ecologits_components) != 1:
        raise SystemExit("browser build must contain one EcoLogits MPL component")
    identity = json.loads(
        (root / "packages/ecologits-core/data/identity.json").read_text(
            encoding="utf-8"
        )
    )
    lock = json.loads(
        (root / "packages/ecologits-core/upstream/lock.json").read_text(
            encoding="utf-8"
        )
    )
    ecologits = inventory.get("ecologits", {})
    if (
        ecologits.get("upstream_version") != identity["upstream_version"]
        or ecologits.get("core_sha256") != identity["core_sha256"]
        or ecologits.get("catalog_sha256") != identity["catalog_sha256"]
        or ecologits.get("retained_source_manifest_sha256")
        != lock["retained_source_manifest_sha256"]
    ):
        raise SystemExit("browser EcoLogits identity does not match accepted source")
    source_path = folder / "source/ecologits-source.zip"
    source = safe_zip_inventory(source_path)
    required_source = {
        "ECOLOGITS-SOURCE-README.md",
        "packages/ecologits-core/LICENSE",
        "packages/ecologits-core/NOTICE.md",
        "packages/ecologits-core/CITATION.cff",
        "packages/ecologits-core/source-to-port-map.json",
        "packages/ecologits-core/data/catalog.json",
        "packages/ecologits-core/data/identity.json",
        "packages/ecologits-core/upstream/lock.json",
        "packages/ecologits-core/upstream/retained-source.json",
        "tools/ecologits/README.md",
    }
    if not required_source.issubset(source):
        raise SystemExit(
            f"corresponding EcoLogits source is incomplete: {sorted(required_source - source.keys())}"
        )
    for path in source:
        lowered = path.lower()
        if (
            "/.git/" in f"/{lowered}"
            or "__pycache__" in lowered
            or lowered.endswith(".pyc")
        ):
            raise SystemExit("corresponding source contains private or generated files")
        if "packages/ecologits-core/upstream/" in lowered and (
            "/tests/" in lowered or "/docs/" in lowered or lowered.endswith(".tar.gz")
        ):
            raise SystemExit("corresponding source contains excluded upstream material")
    source_metadata = ecologits.get("corresponding_source", {})
    if source_metadata != {
        "path": "source/ecologits-source.zip",
        **record(source_path),
    }:
        raise SystemExit("corresponding source hash metadata mismatch")
    page = (folder / "licenses.html").read_text(encoding="utf-8")
    if (
        'href="source/ecologits-source.zip"' not in page
        or identity["catalog_sha256"] not in page
        or "10.21105/joss.07471" not in page
        or "MPL-2.0" not in page
    ):
        raise SystemExit(
            "browser license page is missing source, identity, license or citation"
        )
    return inventory


def validate_manifest(folder: Path, browser: str, engine: str) -> dict:
    if browser not in TARGETS or engine not in ENGINES:
        raise SystemExit("unsupported browser variant")
    if folder.is_symlink() or not (folder / "file-relay.html").is_file():
        raise SystemExit(f"{browser}-{engine} build is missing the private relay page")
    missing_variant_files = [
        path
        for path in CONTRACT["required_variant_entries"]
        if not (folder / path).is_file()
    ]
    if missing_variant_files:
        raise SystemExit(
            f"{browser}-{engine} build is missing required files: {missing_variant_files}"
        )
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    target = TARGETS[browser]
    if (
        manifest.get("manifest_version") != target["manifest_version"]
        or manifest.get("name") != "AI Footprint Tracker"
        or manifest.get("version") != VERSION
    ):
        raise SystemExit(f"{browser}-{engine} manifest identity/version mismatch")
    permissions = set(manifest.get("permissions", []))
    forbidden = permissions & {"debugger", "cookies", "history", "webRequestBlocking"}
    if forbidden:
        raise SystemExit(
            f"{browser}-{engine} package contains forbidden permissions: {sorted(forbidden)}"
        )
    providers = set(CONTRACT["provider_matches"])
    expected_resources = CONTRACT["web_accessible_resources"]
    if browser == "firefox":
        if "offscreen" in permissions or permissions != providers | {
            "storage",
            "alarms",
        }:
            raise SystemExit("firefox manifest permissions are not the reviewed set")
        if manifest.get("web_accessible_resources") != expected_resources:
            raise SystemExit(
                "firefox resource exposure is not the reviewed inert MV2 set"
            )
    else:
        if permissions != {"storage", "alarms", "offscreen"}:
            raise SystemExit(f"{browser} manifest permissions are not the reviewed set")
        if set(manifest.get("host_permissions", [])) != providers:
            raise SystemExit(
                f"{browser} host permissions are not the reviewed provider set"
            )
        war = manifest.get("web_accessible_resources")
        if (
            not isinstance(war, list)
            or len(war) != 1
            or not isinstance(war[0], dict)
            or set(war[0]) != {"resources", "matches"}
            or war[0]["resources"] != expected_resources
            or set(war[0]["matches"]) != providers
        ):
            raise SystemExit(
                f"{browser} resource exposure is not the reviewed provider-only set"
            )
    serialized_war = json.dumps(manifest.get("web_accessible_resources"))
    if any(
        private in serialized_war
        for private in (
            "licenses",
            "source/",
            "offscreen",
            "worker",
            "dashboard",
            "popup",
        )
    ):
        raise SystemExit(f"{browser} manifest exposes a private extension page")
    variant = json.loads((folder / "build-variant.json").read_text(encoding="utf-8"))
    if (
        variant.get("schema_version") != CONTRACT["variant_schema_version"]
        or variant.get("variant_id") != f"{browser}-{engine}"
        or variant.get("browser") != browser
        or variant.get("default_engine") != engine
        or variant.get("available_engines") != list(ENGINES)
        or variant.get("user_override_enabled") is not False
        or variant.get("build_status") != "release_candidate"
    ):
        raise SystemExit(
            f"{browser}-{engine} build variant metadata is invalid or intermediate"
        )
    validate_notices(folder)
    return variant


def built_files(folder: Path) -> list[tuple[Path, str]]:
    files = []
    for item in folder.rglob("*"):
        if item.is_symlink():
            raise SystemExit(
                f"browser build contains a symlink: {item.relative_to(folder).as_posix()}"
            )
        if item.is_file():
            files.append((item, item.relative_to(folder).as_posix()))
    return files


def variant_fingerprint(source_fingerprint: dict, variant: dict) -> dict:
    inputs = {
        "source": source_fingerprint,
        "browser": variant["browser"],
        "manifest_version": variant["manifest_version"],
        "default_engine": variant["default_engine"],
        "available_engines": variant["available_engines"],
        "configuration_sha256": variant["configuration_sha256"],
        "ecologits": variant["ecologits"],
        "source_date_epoch": variant["source_date_epoch"],
    }
    encoded = json.dumps(inputs, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return {
        "algorithm": "sha256",
        "sha256": hashlib.sha256(encoded).hexdigest(),
        "inputs": inputs,
    }


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    WEB_DOWNLOADS.mkdir(parents=True, exist_ok=True)
    source_fingerprint = input_fingerprint(ROOT, CONTRACT)
    artifacts = {}
    for variant_id, target in VARIANTS.items():
        folder = ROOT / "apps/extension/.output" / target["folder"]
        if not folder.is_dir():
            raise SystemExit(f"build release candidate {variant_id} first: {folder}")
        variant = validate_manifest(folder, target["browser"], target["engine"])
        path = (
            OUTPUT
            / target["browser"]
            / target["engine"]
            / f"ai-footprint-tracker-{VERSION}-{variant_id}.zip"
        )
        archive(path, built_files(folder))
        web_name = f"ai-footprint-tracker-{target['browser']}.zip"
        shutil.copyfile(path, WEB_DOWNLOADS / web_name)
        artifacts[variant_id] = {
            "path": f"/downloads/{web_name}",
            "archive": path.relative_to(ROOT).as_posix(),
            **record(path),
            "target": target["folder"],
            "browser": target["browser"],
            "default_engine": target["engine"],
            "available_engines": list(ENGINES),
            "build_variant": variant,
            "input_fingerprint": variant_fingerprint(source_fingerprint, variant),
        }
    sources = OUTPUT / f"ai-footprint-tracker-{VERSION}-sources.zip"
    archive(sources, source_files())
    with zipfile.ZipFile(sources) as source_archive:
        required = set(CONTRACT["required_source_entries"])
        if not required.issubset(source_archive.namelist()):
            raise SystemExit(
                f"source archive is missing required build inputs: {sorted(required - set(source_archive.namelist()))}"
            )
    artifacts["sources"] = {
        "archive": sources.relative_to(ROOT).as_posix(),
        **record(sources),
    }
    configuration_hashes = {
        artifacts[f"{browser}-{DEFAULT_ENGINE}"]["build_variant"][
            "configuration_sha256"
        ]
        for browser in TARGETS
    }
    if len(configuration_hashes) != 1:
        raise SystemExit(
            "default browser variants do not share one effective configuration"
        )
    aliases = {}
    for browser in TARGETS:
        variant_id = f"{browser}-{DEFAULT_ENGINE}"
        package = artifacts[variant_id]
        alias_name = f"ai-footprint-tracker-{browser}.zip"
        alias_path = WEB_DOWNLOADS / alias_name
        shutil.copyfile(ROOT / package["archive"], alias_path)
        aliases[browser] = {
            "path": f"/downloads/{alias_name}",
            "variant_id": variant_id,
            **record(alias_path),
        }
    default_selection = {
        "engine": DEFAULT_ENGINE,
        "source": CONFIGURATION_PATH.relative_to(ROOT).as_posix(),
        "source_sha256": sha256(CONFIGURATION_PATH),
        "effective_configuration_sha256": configuration_hashes.pop(),
        "source_input_sha256": source_fingerprint["sha256"],
    }
    manifest = {
        "schema_version": "2.0.0",
        "product": "ai-footprint-tracker",
        "version": VERSION,
        "source_date_epoch": SOURCE_EPOCH,
        "build_status": "release_candidate",
        "signing_status": "unsigned_manual_install",
        "input_fingerprint": source_fingerprint,
        "default_selection": default_selection,
        "aliases": aliases,
        "packages": artifacts,
    }
    text = json.dumps(manifest, indent=2, sort_keys=True) + "\n"
    (OUTPUT / "manifest.json").write_text(text, encoding="utf-8", newline="\n")
    (WEB_DOWNLOADS / "manifest.json").write_text(text, encoding="utf-8", newline="\n")
    print(text, end="")


if __name__ == "__main__":
    main()
