"""Fail if a source symbol was changed or added without a disposition in the port map."""

import ast
import hashlib
import json
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
mapping = (
    json.load(sys.stdin)
    if "--stdin" in sys.argv
    else json.loads((root / "source-to-port-map.json").read_text(encoding="utf8"))
)
retained = json.loads((root / "upstream/retained-source.json").read_text(encoding="utf8"))
snapshot = root / "upstream" / retained["snapshot_directory"]
rows = mapping["functions_and_types"]
required_baseline_files = {
    "ecologits/impacts/llm.py",
    "ecologits/impacts/video.py",
    "ecologits/impacts/dag.py",
    "ecologits/impacts/modeling.py",
    "ecologits/utils/range_value.py",
    "ecologits/model_repository.py",
    "ecologits/electricity_mix_repository.py",
    "ecologits/tracers/utils.py",
    "ecologits/estimations/video.py",
    "ecologits/status_messages.py",
    "ecologits/exceptions.py",
}
required_files = {row["upstream_file"] for row in rows}
assert required_baseline_files <= required_files, "Missing required source file"
expected = {(row["upstream_file"], row["symbol"], row["line"]) for row in rows}
actual = set()
for file in sorted(required_files):
    source = (snapshot / file).resolve()
    assert source.is_relative_to(snapshot.resolve()) and file in retained["retained_files"], (
        f"Unsafe or unretained source: {file}"
    )
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    assert all(row["source_sha256"] == source_hash for row in rows if row["upstream_file"] == file), (
        f"Source hash mismatch: {file}"
    )
    tree = ast.parse(source.read_text(encoding="utf8"))

    def walk(nodes, parent=""):
        for node in nodes:
            if isinstance(node, (ast.ClassDef, ast.FunctionDef)):
                name = f"{parent}.{node.name}" if parent else node.name
                actual.add((file, name, node.lineno))
                if isinstance(node, ast.ClassDef) or name == "DAG.asset":
                    walk(node.body, name)

    walk(tree.body)
assert actual == expected, f"Unclassified source change: {actual ^ expected}"
assert len(expected) == len(rows), "Duplicate source map rows"
for row in rows:
    if row["upstream_file"] in {"ecologits/impacts/llm.py", "ecologits/impacts/video.py"}:
        assert row["disposition"] == "implemented", (
            "Required mathematical kernel cannot be excluded or relabeled"
        )
for row in rows:
    if row.get("port", "") and row["port"].endswith(".py"):
        target = (root / row["port"]).resolve()
        assert target.is_relative_to(root), "Implementation path escaped package"
        tree = ast.parse(target.read_text(encoding="utf8"))
        names = {node.name for node in ast.walk(tree) if isinstance(node, (ast.FunctionDef, ast.ClassDef))}
        assert row["implementation"] in names, f"Missing Python implementation: {row['implementation']}"
run = subprocess.run(
    ["node", "--import", "tsx", "tools/check_references.ts", "--stdin"],
    cwd=root,
    input=json.dumps(mapping),
    encoding="utf8",
    capture_output=True,
)
assert run.returncode == 0, run.stderr
print(f"Verified {len(actual)} source symbols and dispositions.")
