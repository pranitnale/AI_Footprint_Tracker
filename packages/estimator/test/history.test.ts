import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyGeneration,
  historyPromptParts,
  historyResponseParts, HistoryMessageSchema, canonicalJson } from "@footprint/contracts";
import {
  HistoryAccumulator,
  BASELINE_METHOD_ID,
  BASELINE_METHOD_HASH,
} from "../src/index";

const message = (known: boolean, id: string) =>
  HistoryMessageSchema.parse({ timing: null,
    schema_version: "3.0.0",
    kind: "history_message",
    message_key: id.repeat(64),
    role: "response",
    conversation_key: "c".repeat(64),
    key_version: "1",
    site: "claude",
    parent_key: null,
    prompt_key: null,
    provider_request_key: null,
    provider_attempt_key: null,
    occurred_at: "2020-01-01T00:00:00.000001Z",
    date_basis: "message_created",
    observed_at: "2026-09-14T16:00:00.000Z",
    model_id: null,
    proposed_method_id: BASELINE_METHOD_ID,
    company_dedup_key: null,
    proposed_method_hash: BASELINE_METHOD_HASH,
    tokens: {
      value: known ? "100" : null,
      evidence: known ? "heuristic_estimate" : "unknown",
      scope: "observed_text",
      completeness: known ? "complete_for_scope" : "unknown",
      profile_id: known ? "observed-text-v1" : null,
      reason: known ? "tokenizer_mapping_unverified" : "history_only",
    },
    inline_file_text: null,
    parts: historyResponseParts({ value: known ? "100" : null, evidence: known ? "heuristic_estimate" : "unknown", scope: "observed_text", completeness: known ? "complete_for_scope" : "unknown", profile_id: known ? "observed-text-v1" : null, reason: known ? "tokenizer_mapping_unverified" : "history_only", }),
    generation: emptyGeneration(),
    text_complete: known,
    coverage_reasons: ["history_only"],
  });
const sorted = (rows: unknown[]) => rows.map(canonicalJson).sort();

test("historical: resource totals and their scope metadata are independent of import order", () => {
  const unknown = message(false, "a"),
    known = message(true, "b");
  const forward = new HistoryAccumulator(),
    reverse = new HistoryAccumulator();
  forward.add(unknown);
  forward.add(known);
  reverse.add(known);
  reverse.add(unknown);
  assert.deepEqual(
    sorted(forward.summary.resources),
    sorted(reverse.summary.resources),
  );
  assert.ok(
    forward.summary.resources.some(
      (r) => r.value !== null && r.status === "partial_estimate",
    ),
  );
});

test("historical: proven live overlap stays observed but is excluded from imported numerical contributions", () => {
  const total = new HistoryAccumulator();
  total.add(message(true, "a"), { overlap: true });
  const result = total.summary as typeof total.summary & {
    observed_response_count: string;
  };
  assert.equal(result.observed_response_count, "1");
  assert.equal(result.matched_live_message_count, "1");
  assert.equal(result.response_count, "0");
  assert.equal(result.resources.length, 0);
  assert.equal(result.tokens.length, 0);
});

test("historical: token rows keep message totals apart from uploaded images and tool results", () => {
  const counted = (value: string, profile: string, scope = "observed_text") => ({
    value,
    evidence: "heuristic_estimate" as const,
    scope: scope as "observed_text" | "provider_defined_subset",
    completeness: "complete_for_scope" as const,
    profile_id: profile as "observed-text-v1",
    reason: null,
  });
  const reply = message(true, "a");
  const withTool = HistoryMessageSchema.parse({
    ...reply,
    parts: historyResponseParts(reply.tokens, {
      tool_output: counted("40", "observed-text-v1"),
    }),
  });
  const prompt = (id: string, images: boolean) =>
    HistoryMessageSchema.parse({
      ...reply,
      message_key: id.repeat(64),
      role: "prompt",
      parts: images
        ? historyPromptParts(
            counted("1120", "vendor-image-rules-1", "provider_defined_subset"),
          )
        : null,
    });
  const total = new HistoryAccumulator();
  total.add(withTool);
  total.add(prompt("b", true));
  // A prompt saved without parts: its page did not show uploads, so images are unknown.
  total.add(prompt("c", false));
  const row = (role: string, part: string, evidence = "heuristic_estimate") =>
    total.summary.tokens.find(
      (t) => t.role === role && t.part === part && t.evidence === evidence,
    );
  assert.equal(row("response", "total")!.value, "100");
  assert.equal(row("response", "tool_output")!.value, "40");
  assert.equal(row("prompt", "total")!.value, "200");
  assert.equal(row("prompt", "total")!.known_message_count, "2");
  assert.equal(row("prompt", "image_input_tokens")!.value, "1120");
  assert.equal(
    row("prompt", "image_input_tokens")!.profile_id,
    "vendor-image-rules-1",
  );
  assert.equal(row("prompt", "image_input_tokens", "unknown")!.value, null);
  assert.equal(
    row("prompt", "image_input_tokens", "unknown")!.unknown_message_count,
    "1",
  );
  // Each message is still counted once.
  assert.equal(total.summary.calculated_message_count, "3");
  assert.equal(total.summary.tokens.length, 5);
});

test("W9 Studio rows without a live request count without waiting for a live match", () => {
  const studio = HistoryMessageSchema.parse({
    ...message(true, "d"),
    site: "notebooklm",
    coverage_reasons: ["history_only", "no_live_request"],
  });
  const total = new HistoryAccumulator();
  total.add(studio);
  total.add(message(true, "e"));
  assert.equal(total.summary.response_count, "2");
  // Only the Claude row may still overlap a live capture; the Studio row cannot.
  assert.equal(total.summary.unresolved_overlap_message_count, "1");
  assert.equal(total.summary.matched_live_message_count, "0");
});
