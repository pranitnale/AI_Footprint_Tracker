"""Inventory candidate Python semantics and dependency metadata without executing it."""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import sys
import tomllib
from pathlib import Path


def digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def inventory_file(path: Path) -> dict:
    source = path.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(path))
    symbols = {}
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            symbols[node.name] = {
                "kind": "class" if isinstance(node, ast.ClassDef) else "function",
                "semantic_sha256": digest(ast.dump(node, annotate_fields=True, include_attributes=False)),
            }
            if isinstance(node, ast.ClassDef):
                for child in node.body:
                    if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        symbols[f"{node.name}.{child.name}"] = {
                            "kind": "method",
                            "semantic_sha256": digest(
                                ast.dump(child, annotate_fields=True, include_attributes=False)
                            ),
                        }
    assignments = [
        ast.dump(node, annotate_fields=True, include_attributes=False)
        for node in tree.body
        if isinstance(node, (ast.Assign, ast.AnnAssign))
    ]
    return {
        "file_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "module_semantic_sha256": digest(ast.dump(tree, annotate_fields=True, include_attributes=False)),
        "assignment_semantic_sha256": digest("\n".join(assignments)),
        "symbols": symbols,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate", required=True, type=Path)
    args = parser.parse_args()
    root = args.candidate.resolve(strict=True)
    pyproject = tomllib.loads((root / "pyproject.toml").read_text(encoding="utf-8"))
    files = {}
    for path in sorted((root / "ecologits").rglob("*.py")):
        files[path.relative_to(root).as_posix()] = inventory_file(path)
    project = pyproject.get("project", {})
    output = {
        "project": {
            "name": project.get("name"),
            "version": project.get("version"),
            "license": project.get("license"),
            "dependencies": project.get("dependencies", []),
            "optional_dependencies": project.get("optional-dependencies", {}),
            "requires_python": project.get("requires-python"),
            "urls": {
                key: project.get(key)
                for key in ("homepage", "repository", "documentation")
                if project.get(key)
            },
        },
        "files": files,
    }
    json.dump(output, sys.stdout, allow_nan=False, ensure_ascii=False, indent=2, sort_keys=True)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
