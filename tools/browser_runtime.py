"""One reviewed browser runtime component set for notices, SBOM and advisory checks."""

import hashlib
import json
import shutil
import subprocess
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]


def inventory():
    pnpm = shutil.which("pnpm")
    if not pnpm:
        raise RuntimeError("pnpm_required")
    result = subprocess.run(
        [pnpm, "--filter", "@footprint/extension", "exec", "tsx", "build/runtime-inventory.ts"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        encoding="utf-8",
    )
    data = json.loads(result.stdout)
    if not data.get("components"):
        raise RuntimeError("browser_runtime_inventory_empty")
    return data


def merge_components(components, browser):
    merged = {(item["ecosystem"], item["name"], item["version"]): dict(item) for item in components}
    for item in browser["components"]:
        key = ("npm", item["name"], item["version"])
        previous = merged.get(key, {})
        merged[key] = {
            **previous,
            "ecosystem": "npm",
            "name": item["name"],
            "version": item["version"],
            "license": item["license"],
            "scope": "runtime",
            "browser_runtime": True,
        }
    return list(merged.values())


def query_osv(queries):
    request = Request(
        "https://api.osv.dev/v1/querybatch",
        data=json.dumps({"queries": queries}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=60) as response:
        return json.load(response)


def audit(browser, query=query_osv):
    components = sorted(browser["components"], key=lambda item: (item["name"], item["version"]))
    queries = [
        {"package": {"ecosystem": "npm", "name": item["name"]}, "version": item["version"]}
        for item in components
    ]
    response = query(queries)
    results = response.get("results")
    if not isinstance(results, list) or len(results) != len(components):
        raise RuntimeError("advisory_response_incomplete")
    findings = []
    for item, result in zip(components, results):
        if not isinstance(result, dict) or set(result) - {"vulns", "next_page_token"}:
            raise RuntimeError("advisory_response_invalid")
        if result.get("next_page_token"):
            raise RuntimeError("advisory_response_truncated")
        vulnerabilities = result.get("vulns", [])
        if not isinstance(vulnerabilities, list):
            raise RuntimeError("advisory_response_invalid")
        for vulnerability in vulnerabilities:
            if not isinstance(vulnerability, dict) or not isinstance(vulnerability.get("id"), str):
                raise RuntimeError("advisory_response_invalid")
            findings.append({"name": item["name"], "version": item["version"], "id": vulnerability["id"]})
    return {
        "status": "findings" if findings else "no_known_vulnerabilities",
        "source": "https://api.osv.dev/v1/querybatch",
        "scope": "reviewed shipped browser runtime, regardless of dependency classification",
        "components": [{"name": item["name"], "version": item["version"]} for item in components],
        "component_set_sha256": hashlib.sha256(json.dumps(queries, sort_keys=True).encode()).hexdigest(),
        "findings": findings,
    }
