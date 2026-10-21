"""Generate the path-free dependency inventory, CycloneDX SBOM and notices from frozen locks."""

from __future__ import annotations

import importlib.metadata
import json
import shutil
import subprocess
import tomllib

from browser_runtime import inventory as browser_inventory
from browser_runtime import merge_components
from third_party import CURATION_PATH, ROOT, inventory_document, load_json, write_outputs


def javascript_components() -> list[dict]:
    pnpm = shutil.which("pnpm")
    if not pnpm:
        raise SystemExit("pnpm is required to generate the JavaScript inventory")
    result = subprocess.run(
        [pnpm, "licenses", "list", "--prod", "--json"],
        cwd=ROOT,
        check=True,
        text=True,
        encoding="utf-8",
        capture_output=True,
    )
    groups = json.loads(result.stdout)
    components = []
    for license_id, packages in groups.items():
        for package in packages:
            for version in package["versions"]:
                components.append(
                    {
                        "ecosystem": "npm",
                        "name": package["name"],
                        "version": version,
                        "license": license_id,
                        "homepage": package.get("homepage"),
                        "scope": "runtime",
                    }
                )
    return components


def python_components() -> list[dict]:
    lock = tomllib.loads((ROOT / "apps/server/uv.lock").read_text(encoding="utf-8"))
    packages = {package["name"]: package for package in lock["package"]}
    runtime, pending = set(), [dependency["name"] for dependency in packages["aift-server"]["dependencies"]]
    while pending:
        name = pending.pop()
        if name in runtime:
            continue
        runtime.add(name)
        pending.extend(dependency["name"] for dependency in packages[name].get("dependencies", []))
    components = []
    for package in lock["package"]:
        if package["name"] == "aift-server" or "registry" not in package.get("source", {}):
            continue
        try:
            metadata = importlib.metadata.metadata(package["name"])
            license_id = metadata.get("License-Expression") or metadata.get("License") or "NOASSERTION"
            homepage = next(
                (value.split(", ", 1)[1] for value in metadata.get_all("Project-URL", []) if ", " in value),
                None,
            )
        except importlib.metadata.PackageNotFoundError:
            license_id, homepage = "NOASSERTION", None
        components.append(
            {
                "ecosystem": "pypi",
                "name": package["name"],
                "version": package["version"],
                "license": license_id,
                "homepage": homepage,
                "scope": "runtime" if package["name"] in runtime else "development",
            }
        )
    return components


if __name__ == "__main__":
    package_components = merge_components(
        javascript_components() + python_components(), browser_inventory()
    )
    inventory = inventory_document(package_components, load_json(CURATION_PATH))
    write_outputs(inventory)
    print(
        f"wrote {len(inventory['components'])} dependency records and {len(inventory['data'])} data records"
    )
