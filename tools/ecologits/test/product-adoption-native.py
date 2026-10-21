"""Exercise the copied native adapter after a verified isolated catalog adoption."""

import json
import sys
from pathlib import Path

root, workspace = map(Path, sys.argv[1:3])
sys.dont_write_bytecode = True
sys.path[:0] = [
    str(root / "apps/server"),
    str(root / "packages/estimator/python"),
    str(workspace / "packages/contracts/python"),
]
from aift import engine_adapter  # noqa: E402

value = json.load(sys.stdin)
result = engine_adapter.estimate(
    engine_adapter.packaged_definition(),
    value["input"]["attempt"],
    request=value["input"]["request"],
    options={"view": "recalculated", "originalMethodHash": value["original_method_hash"]},
)
print(json.dumps(result, sort_keys=True))
