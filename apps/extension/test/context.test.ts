import { test } from "node:test";
import assert from "node:assert/strict";
import { contextGuidance } from "../lib/context";
import { validateCapture } from "../lib/bridge";
test("Advice threshold/cooldown and unknown budgets preserve context semantics", () => {
  assert.equal(contextGuidance("49", 100, null as any).show, false);
  assert.equal(contextGuidance("50", 100, undefined).show, false);
  const crossed = contextGuidance("51", 100, undefined, 1000);
  assert.equal(crossed.show, true);
  assert.equal(crossed.state.level, 50);
  assert.equal(contextGuidance("81", 100, crossed.state, 2000).state.level, 80);
  const low = contextGuidance("45", 100, crossed.state, 3000);
  assert.equal(contextGuidance("60", 100, low.state, 4000).show, false);
  assert.equal(contextGuidance("60", 100, low.state, 86402000).show, true);
  assert.equal(contextGuidance("99", null, undefined).ratio, null);
  assert.equal(contextGuidance(null, 100, undefined).ratio, null);
});
test("Page bridge rejects arbitrary privilege fields, lookalikes and nonnumeric counters", () => {
  const m = { timing: null,
    channel: "ai-footprint-observation-v1",
    version: 1,
    id: crypto.randomUUID(),
    revision: 1,
    event: "dispatch",
    site: "claude",
    at: new Date().toISOString(),
    dispatch: {
      site: "claude",
      action: "send",
      input: "safe",
      conversationId: null,
      parentId: null,
      requestId: null,
      model: null,
      attachments: 0,
      imageEditParentId: null,
    },
    snapshot: null,
    failure: null,
  };
  assert.equal(validateCapture(m, "claude.ai"), true);
  assert.equal(
    validateCapture({ ...m, access_token: "secret" }, "claude.ai"),
    false,
  );
  assert.equal(validateCapture(m, "claude.ai.evil.test"), false);
  assert.equal(
    validateCapture({ ...m, revision: Infinity }, "claude.ai"),
    false,
  );
});
