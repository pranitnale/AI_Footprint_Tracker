import test from "node:test";
import assert from "node:assert/strict";
import { LiveRequestTimer, timingEvidence, isTimingEvidence } from "../src";

test("live timer measures dispatch to first verified receipt, invalidates resumed work and rejects invalid bounds", () => {
  const timer = new LiveRequestTimer(1000);
  timer.observe(false, 2000);
  assert.equal(timer.evidence(), null);
  timer.observe(true, 3500);
  assert.equal(timer.evidence()?.duration_seconds, "2.5");
  timer.observe(true, 9000);
  assert.equal(timer.evidence()?.duration_seconds, "2.5");
  timer.observe(false, 10000);
  assert.equal(timer.evidence(), null);
  timer.observe(true, 12000);
  assert.equal(timer.evidence()?.duration_seconds, "11");
  for (const duration of [0, -1, NaN, Infinity, 86401])
    assert.equal(timingEvidence(duration, "browser_request"), null);
  assert.equal(
    timingEvidence(86400, "browser_request")?.duration_seconds,
    "86400",
  );
});

test("Cowork history timing covers one provider message", () => {
  const cowork = timingEvidence(2.924, "cowork_history")!;
  assert.equal(cowork.scope, "provider_message");
  assert.equal(isTimingEvidence(cowork), true);
  assert.equal(isTimingEvidence({ ...cowork, scope: "content_blocks" }), false);
  assert.equal(isTimingEvidence({ ...cowork, scope: "research_task" }), false);
});

test("timing boundary rejects extra keys, wrong source scope, numeric JSON and exponent strings", () => {
  const valid = timingEvidence(1.123456789, "claude_history")!;
  assert.equal(isTimingEvidence(valid), true);
  for (const patch of [
    { scope: "request" },
    { extra: 1 },
    { duration_seconds: 1 },
    { duration_seconds: "1e2" },
    { duration_seconds: "01" },
    { duration_seconds: "0" },
    { completeness: "complete" },
    { source: "gemini_history" },
    { profile_version: "timing-observation-0" },
  ])
    assert.equal(isTimingEvidence({ ...valid, ...patch }), false);
});

test("Gemini history times only a research run, by the span to its stored report (G4)", () => {
  const research = timingEvidence(109.027584, "gemini_history");
  assert.deepEqual(research, {
    duration_seconds: "109.027584",
    source: "gemini_history",
    scope: "research_task",
    completeness: "complete_for_scope",
    profile_version: "timing-observation-1",
  });
  assert.equal(isTimingEvidence(research), true);
  for (const scope of [
    "request",
    "provider_message",
    "content_blocks",
    "workflow",
  ] as const)
    assert.equal(
      timingEvidence(5, "gemini_history", "complete_for_scope", scope),
      null,
      scope,
    );
});

test("NotebookLM history times a Studio item from its creation to its finish (W9)", () => {
  const timing = timingEvidence(14.5, "notebooklm_history");
  assert.deepEqual(timing, {
    duration_seconds: "14.5",
    source: "notebooklm_history",
    scope: "provider_message",
    completeness: "complete_for_scope",
    profile_version: "timing-observation-1",
  });
  assert.equal(isTimingEvidence({ ...timing, scope: "research_task" }), false);
  assert.equal(isTimingEvidence({ ...timing, scope: "request" }), false);
});
