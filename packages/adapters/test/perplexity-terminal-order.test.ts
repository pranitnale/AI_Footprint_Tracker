import assert from "node:assert/strict";
import test from "node:test";
import { LiveRequestTimer } from "@footprint/capture-core";
import { PerplexitySession } from "../src/perplexity";

const terminal = {
  final: true,
  final_sse_message: true,
  text_completed: true,
  status: "COMPLETED",
  blocks: [
    {
      intended_usage: "workflow_root",
      workflow_block: {
        steps: [
          {
            items: [
              {
                id: "synthetic-answer",
                type: "WORKFLOW_ITEM_TEXT",
                variant: "answer",
                payload: {
                  text_payload: {
                    text: "synthetic",
                    chunks: ["synthetic"],
                    is_streaming: false,
                  },
                },
              },
            ],
          },
        ],
      },
    },
  ],
};

test("Perplexity status-only resumption invalidates timing until the new genuine terminal", () => {
  const session = new PerplexitySession(),
    timer = new LiveRequestTimer(1000);
  const frame = (value: unknown, at: number) => {
    session.frame({ event: "message", data: JSON.stringify(value), value });
    timer.observe(session.completionVerified(), at);
  };
  frame(terminal, 4000);
  assert.equal(timer.evidence()?.duration_seconds, "3");
  frame({ status: "IN_PROGRESS" }, 5000);
  assert.equal(session.snapshot().state, "generating");
  assert.equal(timer.evidence(), null);
  frame(terminal, 9000);
  assert.equal(timer.evidence()?.duration_seconds, "8");
  session.stopped();
  assert.equal(session.completionVerified(), true);
});

test("Perplexity cancellation cannot be overwritten by resumption metadata or a late terminal", () => {
  const session = new PerplexitySession();
  session.stopped();
  session.frame({
    event: "message",
    data: "",
    value: { status: "IN_PROGRESS" },
  });
  session.frame({ event: "message", data: "", value: terminal });
  assert.equal(session.snapshot().state, "cancelled");
  assert.equal(session.completionVerified(), false);
});
