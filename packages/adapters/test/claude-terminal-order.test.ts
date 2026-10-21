import assert from "node:assert/strict";
import test from "node:test";
import { LiveRequestTimer } from "@footprint/capture-core";
import { ClaudeSession } from "../src/claude";

function session() {
  const result = new ClaudeSession();
  const frame = (value: unknown) =>
    result.frame({ value } as Parameters<ClaudeSession["frame"]>[0]);
  frame({ type: "message_start", message: { id: "synthetic-live-id" } });
  frame({ type: "message_delta", delta: { stop_reason: "end_turn" } });
  return { result, frame };
}

test("Claude cancellation before message_stop cannot become completed timing", () => {
  const { result, frame } = session();
  const timer = new LiveRequestTimer(0);
  result.stopped();
  frame({ type: "message_stop" });
  timer.observe(result.completionVerified(), 4000);
  assert.equal(result.snapshot().state, "cancelled");
  assert.equal(result.completionVerified(), false);
  assert.equal(timer.evidence(), null);
});

test("Claude stop cleanup after verified completion retains the terminal result", () => {
  const { result, frame } = session();
  frame({ type: "message_stop" });
  result.stopped();
  assert.equal(result.snapshot().state, "completed");
  assert.equal(result.completionVerified(), true);
});
