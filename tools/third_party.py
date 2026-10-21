"""Inventory, SBOM and notices rendering shared by generate-sbom.py and its consistency test.

THIRD-PARTY-INVENTORY.json is the single record. SBOM.cdx.json and THIRD-PARTY-NOTICES.md are
rendered from it, so neither can list a different component set, version or licence. Package
records come from the locks; everything a lock cannot know (bundled data sets, licence fields
that upstream metadata gets wrong, optional packages that never ship) comes from the reviewed
file tools/third-party-curation.json.
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CURATION_PATH = ROOT / "tools" / "third-party-curation.json"
TEMPLATE_PATH = ROOT / "tools" / "third-party-notices.template.md"
INVENTORY_PATH = ROOT / "THIRD-PARTY-INVENTORY.json"
SBOM_PATH = ROOT / "SBOM.cdx.json"
NOTICES_PATH = ROOT / "THIRD-PARTY-NOTICES.md"
SCHEMA_VERSION = "1.1.0"
SPDX_IDS = {
    "Apache-2.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "CC-BY-4.0",
    "ISC",
    "LGPL-3.0-only",
    "MIT",
    "MIT-0",
    "MPL-2.0",
    "OFL-1.1",
    "PSF-2.0",
}
SHIPPED_IN_LABELS = {
    "browser_extension": "Browser extension",
    "server": "Server",
    "website": "Website",
}


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def curate(components: list[dict], curation: dict) -> list[dict]:
    """Applies the reviewed corrections. Running it twice gives the same result."""
    excluded = tuple(curation.get("exclude_name_prefixes", []))
    corrections = {
        (item["ecosystem"], item["name"]): item for item in curation.get("license_corrections", [])
    }
    optional = {(item["ecosystem"], item["name"]): item for item in curation.get("not_shipped", [])}
    result = []
    for component in components:
        if component["name"].startswith(excluded):
            continue
        item = dict(component)
        key = (item["ecosystem"], item["name"])
        if key in corrections:
            item["license"] = corrections[key]["license"]
            # Windows-only packages are not installed on Linux, where their metadata is missing.
            if corrections[key].get("homepage"):
                item["homepage"] = corrections[key]["homepage"]
        if key in optional:
            item["scope"] = "optional_not_shipped"
            item.pop("browser_runtime", None)
        if not item.get("homepage"):
            item.pop("homepage", None)
        result.append(item)
    return sorted(result, key=lambda value: (value["ecosystem"], value["name"], value["version"]))


def inventory_document(components: list[dict], curation: dict) -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_from": [
            "pnpm-lock.yaml",
            "apps/server/uv.lock",
            "apps/extension/build/notices.ts",
            "tools/third-party-curation.json",
        ],
        "components": curate(components, curation),
        "data": sorted(curation.get("data", []), key=lambda value: value["name"]),
    }


def _licenses(expression: str) -> list[dict]:
    if expression == "NOASSERTION":
        return []
    if any(operator in expression for operator in (" OR ", " AND ", " WITH ")):
        return [{"expression": expression}]
    return [{"license": {"id" if expression in SPDX_IDS else "name": expression}}]


def sbom_document(inventory: dict) -> dict:
    components = []
    for item in inventory["components"]:
        component = {
            "type": "library",
            "name": item["name"],
            "version": item["version"],
            "licenses": _licenses(item["license"]),
            "properties": [{"name": "aift:scope", "value": item["scope"]}],
        }
        # The EcoLogits port is not a registry package, so it carries no purl rather than an
        # invalid one.
        if " " not in item["name"]:
            component["purl"] = f"pkg:{item['ecosystem']}/{item['name']}@{item['version']}"
        if item.get("homepage"):
            component["externalReferences"] = [{"type": "website", "url": item["homepage"]}]
        if item.get("browser_runtime"):
            component["properties"].append({"name": "aift:browser_runtime", "value": "true"})
        components.append(component)
    for item in inventory.get("data", []):
        properties = [{"name": "aift:license_status", "value": item["license_status"]}]
        properties += [{"name": "aift:shipped_in", "value": place} for place in item.get("shipped_in", [])]
        if item.get("part_of"):
            properties.append({"name": "aift:part_of", "value": item["part_of"]})
        component = {
            "type": "data",
            "name": item["name"],
            "version": item["version"],
            "licenses": _licenses(item["license"]),
            "externalReferences": [{"type": "website", "url": item["source"]}],
            "properties": properties,
        }
        if item.get("supplier"):
            component["supplier"] = {"name": item["supplier"]}
        components.append(component)
    fingerprint = json.dumps(components, sort_keys=True)
    return {
        "bomFormat": "CycloneDX",
        "specVersion": "1.6",
        "version": 1,
        "serialNumber": "urn:uuid:" + str(uuid.uuid5(uuid.NAMESPACE_URL, fingerprint)),
        "metadata": {
            "component": {"type": "application", "name": "AI Footprint Tracker", "version": "0.1.0"}
        },
        "components": components,
    }


def _cell(value: str) -> str:
    return value.replace("|", "\\|").replace("\n", " ")


def _table(header: list[str], rows: list[list[str]]) -> str:
    lines = ["| " + " | ".join(header) + " |", "| " + " | ".join("---" for _ in header) + " |"]
    lines.extend("| " + " | ".join(_cell(cell) for cell in row) + " |" for row in rows)
    return "\n".join(lines)


def _component_rows(components: list[dict]) -> list[list[str]]:
    return [[item["name"], item["version"], item["license"]] for item in components]


def render_notices(inventory: dict, template: str) -> str:
    components = inventory["components"]
    browser = [item for item in components if item.get("browser_runtime")]
    server = [
        item
        for item in components
        if item["ecosystem"] == "pypi" and item["scope"] == "runtime"
    ]
    other = [item for item in components if item not in browser and item not in server]
    data_rows = []
    for item in inventory.get("data", []):
        licence = item["license"]
        if item["license_status"] == "unverified":
            licence = f"Unverified ({licence})" if licence != "NOASSERTION" else "Unverified"
        used = ", ".join(SHIPPED_IN_LABELS[place] for place in item.get("shipped_in", [])) or "Credited source only"
        data_rows.append([item["name"], item["version"], licence, used, item["source"]])
    data_notes = "\n".join(
        f"- {item['name']}: {item['note']}" for item in inventory.get("data", []) if item.get("note")
    )
    sections = {
        "{{BROWSER_COMPONENTS}}": _table(["Component", "Version", "Licence"], _component_rows(browser)),
        "{{SERVER_COMPONENTS}}": _table(["Component", "Version", "Licence"], _component_rows(server)),
        "{{OTHER_COMPONENTS}}": _table(
            ["Component", "Version", "Licence", "Use"],
            [
                [item["name"], item["version"], item["license"], item["scope"].replace("_", " ")]
                for item in other
            ],
        ),
        "{{DATA}}": _table(["Data", "Version", "Licence", "Shipped in", "Source"], data_rows),
        "{{DATA_NOTES}}": data_notes,
    }
    text = template.replace("\r\n", "\n")
    for placeholder, value in sections.items():
        if text.count(placeholder) != 1:
            raise ValueError(f"notices template needs exactly one {placeholder}")
        text = text.replace(placeholder, value)
    return text


def rendered_outputs(inventory: dict) -> dict[Path, str]:
    """The files generated from one inventory, as they must appear on disk (LF endings)."""
    template = TEMPLATE_PATH.read_text(encoding="utf-8")
    return {
        INVENTORY_PATH: json.dumps(inventory, indent=2, sort_keys=True) + "\n",
        SBOM_PATH: json.dumps(sbom_document(inventory), indent=2, sort_keys=True) + "\n",
        NOTICES_PATH: render_notices(inventory, template),
    }


def write_outputs(inventory: dict) -> None:
    for path, text in rendered_outputs(inventory).items():
        path.write_text(text, encoding="utf-8", newline="\n")
