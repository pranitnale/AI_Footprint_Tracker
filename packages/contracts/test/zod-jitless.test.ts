import test from "node:test";
import assert from "node:assert/strict";

// Gemini and NotebookLM enforce Trusted Types, which blocks the Function constructor in the
// page world where the capture script runs; zod's probe for it showed as a console error
// on every page load (19 Oct 2026). The package must make no schema before zod is jitless.
test("the contracts never call the Function constructor, at import or when parsing", async () => {
  const native = globalThis.Function;
  let constructed = 0;
  globalThis.Function = new Proxy(native, {
    construct() {
      constructed++;
      throw new EvalError("blocked like a Trusted Types page");
    },
    apply() {
      constructed++;
      throw new EvalError("blocked like a Trusted Types page");
    },
  });
  try {
    const contracts = await import("../src/index");
    const { z, config } = await import("zod");
    assert.equal(config().jitless, true);
    // Object schemas made before and after the import parse without generated code.
    assert.equal(contracts.SCHEMA_VERSION, "3.0.0");
    const schema = z.object({ a: z.string(), b: z.number() });
    assert.deepEqual(schema.parse({ a: "x", b: 1 }), { a: "x", b: 1 });
    assert.equal(schema.safeParse({ a: 1 }).success, false);
    assert.equal(constructed, 0);
  } finally {
    globalThis.Function = native;
  }
});
