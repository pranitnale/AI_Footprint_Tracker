"""Create an isolated public-source copy and a fresh ordinary pinned uv environment."""

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
retained = json.loads((root / "upstream/retained-source.json").read_text(encoding="utf8"))
scratch = root / ".test-runtime"
scratch.mkdir(exist_ok=True)
clean_root = Path(tempfile.mkdtemp(prefix="retained-source-", dir=scratch))
target = clean_root / "packages/ecologits-core"
target.mkdir(parents=True)
for directory in ("src", "data", "test", "tools"):
    shutil.copytree(root / directory, target / directory, ignore=shutil.ignore_patterns("__pycache__"))
shutil.copytree(root / "oracle", target / "oracle", ignore=shutil.ignore_patterns(".venv", "__pycache__"))
shutil.copytree(root / "upstream", target / "upstream")
for file in ("package.json", "tsconfig.json", "source-to-port-map.json", "LICENSE", "CITATION.cff"):
    shutil.copy2(root / file, target / file)
shutil.copy2(root.parents[1] / "tsconfig.base.json", clean_root / "tsconfig.base.json")
assert not (target / "upstream" / retained["source_artifact"]["filename"]).exists()
assert not (target / "oracle/.venv").exists()
commands = [
    ["uv", "sync", "--project", "oracle", "--frozen", "--offline"],
    ["node", str(root.parents[1] / "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"],
    [
        "node",
        "--import",
        "tsx",
        "--test",
        *[str(path.relative_to(target)) for path in sorted((target / "test").glob("*.test.ts"))],
    ],
]
evidence = []
for command in commands:
    result = subprocess.run(command, cwd=target, encoding="utf8", capture_output=True)
    evidence.append(
        {
            "command": command,
            "returncode": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
        }
    )
    if result.returncode:
        print(result.stdout)
        print(result.stderr)
        raise SystemExit(result.returncode)
report = {
    "public_source_copy": str(target.relative_to(root)),
    "fresh_uv_environment": True,
    "private_vendor_artifact_present": False,
    "dependency_setup": "normal frozen uv packages from the standard wheel cache; no live test fetch",
    "commands": evidence,
}
(scratch / "clean-source-result.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf8")
print(
    "PASS: clean retained-source copy, fresh pinned uv environment, typecheck and full tests; no private original artifact."
)
