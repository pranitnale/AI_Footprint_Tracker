import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initialSnapshot, parseHistoryText } from "@footprint/adapters";
import { timingEvidence } from "@footprint/capture-core";
import { CHANNEL, validateCapture } from "../lib/bridge";
import { validHistoryTextPage } from "../lib/history-capture";

test("live bridge requires latest timing field and rejects historical or incomplete timer claims", () => {
  const message = {
    channel: CHANNEL,
    version: 1,
    id: "00000000-0000-4000-8000-000000000001",
    revision: 1,
    event: "end",
    site: "claude",
    at: "2026-09-15T12:00:00.000Z",
    dispatch: null,
    snapshot: { ...initialSnapshot(), state: "completed" },
    failure: null,
    timing: timingEvidence(4.5, "browser_request"),
  };
  assert.equal(validateCapture(message, "claude.ai"), true);
  assert.equal(
    validateCapture({ ...message, timing: null }, "claude.ai"),
    true,
  );
  const { timing: _timing, ...old } = message;
  assert.equal(validateCapture(old, "claude.ai"), false);
  for (const timing of [
    timingEvidence(4.5, "claude_history"),
    timingEvidence(4.5, "browser_request", "partial"),
    { ...message.timing, duration_seconds: 4.5 },
    { ...message.timing, scope: "content_blocks" },
  ])
    assert.equal(validateCapture({ ...message, timing }, "claude.ai"), false);
  assert.equal(
    validateCapture({ ...message, snapshot: initialSnapshot() }, "claude.ai"),
    false,
  );
  assert.equal(
    validateCapture(
      {
        ...message,
        snapshot: {
          ...message.snapshot,
          providerRequestId: "r_0000000000000001",
        },
      },
      "claude.ai",
    ),
    false,
  );
  assert.equal(
    validateCapture(
      {
        ...message,
        site: "gemini",
        timing: null,
        snapshot: {
          ...message.snapshot,
          providerRequestId: "r_0000000000000001",
        },
      },
      "gemini.google.com",
    ),
    true,
  );
});

test("history bridge validates per-provider timing, exact identity types and required latest DTO fields", () => {
  const body = JSON.parse(
    readFileSync(
      new URL(
        "../../../fixtures/history-observation-2026-09-14/perplexity-workflow-page.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const page = parseHistoryText(
    "perplexity",
    body,
    "00000000-0000-4000-8000-000000000042",
    "2026-09-15T12:00:00.000Z",
  );
  assert.equal(validHistoryTextPage(page), true);
  for (const mutate of [
    (value: any) => delete value.messages[1].timing,
    (value: any) =>
      (value.messages[1].timing = timingEvidence(1, "browser_request")),
    (value: any) =>
      (value.messages[1].timing = timingEvidence(1, "claude_history")),
    (value: any) =>
      (value.messages[0].timing = timingEvidence(1, "perplexity_history")),
    (value: any) =>
      (value.messages[1].liveAttemptId = "unbounded undocumented identity"),
    (value: any) =>
      (value.messages[0].liveAttemptId = value.messages[1].liveAttemptId),
    (value: any) =>
      (value.messages[1].requestId = value.messages[1].liveAttemptId),
    (value: any) => (value.messages[1].complete = false),
  ]) {
    const changed = structuredClone(page);
    mutate(changed);
    assert.equal(validHistoryTextPage(changed), false);
  }
});
