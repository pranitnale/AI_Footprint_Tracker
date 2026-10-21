const { test } = require("node:test");
const assert = require("node:assert/strict");
const { resolve } = require("node:path");
const { pythonReference, pythonExecutable } = require("./python-reference.cjs");

test("Python references use the synchronized project environment and ignore ambient package paths", () => {
  const previous = process.env.PYTHONPATH;
  process.env.PYTHONPATH = resolve("ignored-ad-hoc-packages");
  try {
    const run = pythonReference(
      [
        "-c",
        "import json,sys,jsonschema,sqlalchemy;from footprint_contracts import payload_hash;from aift.file_text import coverage;print(json.dumps([sys.executable,sys.path,json.load(sys.stdin)]))",
      ],
      { input: '{"synthetic":true}' },
    );
    assert.equal(run.status, 0, run.stderr);
    const [executable, paths, input] = JSON.parse(run.stdout);
    assert.equal(resolve(executable), pythonExecutable());
    assert.ok(!paths.includes(process.env.PYTHONPATH));
    assert.deepEqual(input, { synthetic: true });
  } finally {
    if (previous === undefined) delete process.env.PYTHONPATH;
    else process.env.PYTHONPATH = previous;
  }
});

test("missing Python setup fails with the frozen synchronization command", () => {
  assert.throws(
    () => pythonExecutable(resolve("nonexistent-" + crypto.randomUUID())),
    /uv sync --project apps\/server --frozen --group dev --python 3\.13\.15/,
  );
});
