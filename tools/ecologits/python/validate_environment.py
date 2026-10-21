"""Check that the frozen uv lock can run the selected staged candidate dependencies."""

from __future__ import annotations

import argparse
import json
import re
import sys
import tomllib
from pathlib import Path

from packaging.requirements import Requirement


def normalized(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate", required=True, type=Path)
    parser.add_argument("--lock", required=True, type=Path)
    parser.add_argument("--version", required=True)
    parser.add_argument("--artifact-sha256", required=True)
    args = parser.parse_args()
    project = tomllib.loads((args.candidate / "pyproject.toml").read_text(encoding="utf-8"))["project"]
    lock = tomllib.loads(args.lock.read_text(encoding="utf-8"))
    oracle_project = tomllib.loads((args.lock.parent / "pyproject.toml").read_text(encoding="utf-8"))[
        "project"
    ]
    locked = {normalized(package["name"]): package for package in lock.get("package", [])}
    issues = []
    ecologits = locked.get("ecologits")
    if not ecologits or ecologits.get("version") != args.version:
        issues.append(
            {
                "dependency": "ecologits",
                "reason": "locked oracle package version does not match the selected candidate",
            }
        )
    if oracle_project.get("dependencies") != [f"ecologits=={args.version}"]:
        issues.append(
            {
                "dependency": "ecologits",
                "reason": "oracle project must pin exactly the selected EcoLogits version",
            }
        )
    if ecologits and ecologits.get("sdist", {}).get("hash") != f"sha256:{args.artifact_sha256}":
        issues.append(
            {
                "dependency": "ecologits",
                "reason": "locked oracle source artifact does not match the staged candidate package",
            }
        )
    for text in project.get("dependencies", []):
        requirement = Requirement(text)
        if requirement.marker and not requirement.marker.evaluate():
            continue
        package = locked.get(normalized(requirement.name))
        if not package:
            issues.append({"dependency": text, "reason": "missing from frozen lock"})
        elif requirement.url:
            issues.append(
                {"dependency": text, "reason": "direct URL requirements need a separate source review"}
            )
        elif package.get("version") not in requirement.specifier:
            issues.append(
                {
                    "dependency": text,
                    "reason": f"locked version {package.get('version')} is outside the candidate requirement",
                }
            )
    json.dump({"valid": not issues, "issues": issues}, sys.stdout, sort_keys=True)


if __name__ == "__main__":
    main()
