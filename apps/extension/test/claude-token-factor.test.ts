import assert from "node:assert/strict";
import { test } from "node:test";
import {
  composeOutputTotal,
  emptyGeneration,
  historyPromptParts,
  historyResponseParts,
  notApplicableMeasurement,
  payloadHash,
  providerMeasurement,
  type HistoryMessage,
  type AttemptObservation,
  type RequestObservation,
  type Site,
  type TokenMeasurement,
} from "@footprint/contracts";
import {
  BASELINE_METHOD_HASH,
  BASELINE_METHOD_ID,
  HistoryAccumulator,
} from "@footprint/estimator";
import { records, scope } from "../../../packages/ledger/test/factory";
import type { RecordRow } from "@footprint/ledger";
import { summarize } from "../lib/summary";
import { SummaryAccumulator } from "../lib/summary-scan";
import { FileTextAccumulator } from "../lib/file-text-summary";
import {
  countedContext,
  PACKAGED_CLAUDE_TOKEN_FACTOR,
} from "../lib/claude-token-factor";
import { countSourceNote } from "../lib/estimate-details";

// Owner decision of 15 October 2026: every Claude count the tracker makes with its own
// o200k tokenizer is multiplied by 1.56, part by part, rounded half up.
const counted = (value: string): TokenMeasurement => ({
  value,
  evidence: "heuristic_estimate",
  scope: "observed_text",
  completeness: "complete_for_scope",
  profile_id: "o200k-base-4.0.0-reference",
  reason: "tokenizer_mapping_unverified",
});

function reply(
  site: Site,
  model: string | null,
): [RequestObservation, AttemptObservation] {
  const [request, attempt] = records();
  request.site = site;
  request.model_id = model as RequestObservation["model_id"];
  attempt.model_id = model as AttemptObservation["model_id"];
  attempt.state = "completed";
  attempt.tokens.new_input_text = counted("9");
  attempt.tokens.answer_output = counted("100");
  attempt.tokens.visible_thinking = counted("10");
  attempt.tokens.output_total = composeOutputTotal(attempt.tokens);
  return [request, attempt];
}
const row = (record: RecordRow["record"]): RecordRow => ({
  key: record.kind,
  namespace: scope.namespace,
  era: scope.era,
  hash: payloadHash(record),
  record,
});
const totals = (pair: [RequestObservation, AttemptObservation]) => {
  const summary = summarize(pair.map(row), []);
  return [summary.tokens.input.value, summary.tokens.output.value];
};

test("packaged figures use the method's factor of 1.56", () => {
  assert.equal(PACKAGED_CLAUDE_TOKEN_FACTOR.factor, "1.56");
});

test("a live Claude reply's In and Out carry the factor; Out is the sum of its corrected parts", () => {
  // In: 9 -> 14. Out: 100 -> 156 and 10 -> 16, each part rounded on its own, then added.
  assert.deepEqual(totals(reply("claude", "claude-opus-5-5")), ["14", "172"]);
  const accumulator = new SummaryAccumulator();
  const [request, attempt] = reply("claude", "claude-opus-5-5");
  accumulator.request(request);
  accumulator.attempt(attempt, request, undefined);
  const result = accumulator.result();
  assert.equal(result.tokens.input.value, "14");
  assert.equal(result.tokens.output.value, "172");
  assert.equal(result.tokens.answer.value, "156");
  assert.equal(result.tokens.thinking.value, "16");
});

test("Perplexity replies by Claude models carry the factor; Best and other models do not", () => {
  assert.deepEqual(
    totals(reply("perplexity", "perplexity-claude-sonnet-5-5")),
    ["14", "172"],
  );
  assert.deepEqual(totals(reply("perplexity", "perplexity-best")), ["9", "110"]);
  assert.deepEqual(totals(reply("perplexity", "perplexity-gpt-5-5")), ["9", "110"]);
});

test("ChatGPT counts are untouched", () => {
  assert.deepEqual(totals(reply("chatgpt", "chatgpt-gpt-5-5")), ["9", "110"]);
});

test("a Cowork reply keeps Claude's own counts; text counted here gets the factor", () => {
  const [request, attempt] = reply("claude", "claude-opus-5-5");
  attempt.tokens.output_total = providerMeasurement("433");
  attempt.tokens.reported_reasoning = providerMeasurement("30");
  attempt.generation.text_components = [
    {
      role: "side_calls",
      model_id: "claude-haiku-4-5",
      model_evidence: "response_field",
      tokens: providerMeasurement("10"),
      timing: null,
    },
  ];
  const summary = summarize([request, attempt].map(row), []);
  assert.equal(summary.tokens.input.value, "14");
  assert.equal(summary.tokens.output.value, "443");
  assert.equal(summary.tokens.reasoning.value, "30");
  assert.equal(summary.tokens.otherModels.value, "10");
});

test("file text sent to Claude carries the factor", () => {
  const file = (site: Site) => {
    const [request] = reply(site, null);
    request.documents.extracted_text = [
      {
        component_id: crypto.randomUUID(),
        origin: "new_upload",
        extraction_profile_id: "local-file-text-utf8-pdfjs6.3.289-opc-v1",
        page_count: 1,
        tokens: {
          value: "100",
          evidence: "heuristic_estimate",
          scope: "extracted_file_text",
          completeness: "complete_for_scope",
          profile_id: "o200k-base-4.0.0-reference",
          reason: "tokenizer_mapping_unverified",
        },
        missing: [],
      },
    ];
    const accumulator = new FileTextAccumulator();
    accumulator.request(request);
    return accumulator.result().file_text[0]!.value;
  };
  assert.equal(file("claude"), "156");
  assert.equal(file("chatgpt"), "100");
});

const historyRecord = () => ({
  schema_version: "3.0.0",
  kind: "history_message",
  message_key: crypto.randomUUID().replaceAll("-", "").padEnd(64, "0"),
  conversation_key: "c".repeat(64),
  key_version: "1",
  parent_key: null,
  prompt_key: null,
  provider_request_key: null,
  provider_attempt_key: null,
  occurred_at: "2026-10-15T10:00:00.000Z",
  date_basis: "message_created",
  observed_at: "2026-10-15T10:00:01.000Z",
  proposed_method_id: BASELINE_METHOD_ID,
  proposed_method_hash: BASELINE_METHOD_HASH,
  company_dedup_key: null,
  inline_file_text: null,
  generation: emptyGeneration(),
  text_complete: true,
  timing: null,
  coverage_reasons: ["history_only"],
});

test("saved Claude messages carry the factor in the history totals", () => {
  const message = (site: Site, model: string | null, role: "prompt" | "response") => {
    const parts = historyResponseParts(counted("100"), {
      visible_thinking: counted("10"),
      tool_output: counted("7"),
    });
    return {
      ...historyRecord(),
      site,
      model_id: model,
      role,
      parts: role === "response" ? parts : historyPromptParts(notApplicableMeasurement()),
      tokens: role === "response" ? composeOutputTotal(parts) : counted("9"),
    } as HistoryMessage;
  };
  const sums = (accumulator: HistoryAccumulator) =>
    Object.fromEntries(
      accumulator.summary.tokens.map((row) => [`${row.role}:${row.part}`, row.value]),
    );
  const corrected = new HistoryAccumulator(PACKAGED_CLAUDE_TOKEN_FACTOR);
  const chatgpt = new HistoryAccumulator(PACKAGED_CLAUDE_TOKEN_FACTOR);
  for (const role of ["prompt", "response"] as const) {
    corrected.add(message("claude", "claude-opus-5-5", role));
    chatgpt.add(message("chatgpt", "chatgpt-gpt-5-5", role));
  }
  // 156 + 16 for the reply's output, 7 -> 11 for tool results, 9 -> 14 for the prompt.
  assert.deepEqual(sums(corrected), {
    "prompt:total": "14",
    "response:total": "172",
    "response:tool_output": "11",
  });
  assert.deepEqual(sums(chatgpt), {
    "prompt:total": "9",
    "response:total": "110",
    "response:tool_output": "7",
  });
});

test("context advice reads the Claude context with the factor", () => {
  const [, attempt] = reply("claude", "claude-opus-5-5");
  attempt.tokens.logical_input_total = {
    ...counted("1000"),
    scope: "reconstructed_context",
    completeness: "partial",
    reason: "context_unobserved",
  };
  // 1000 -> 1560 and 100 -> 156.
  assert.equal(countedContext("claude", attempt.model_id, attempt.tokens), "1716");
  assert.equal(countedContext("chatgpt", "chatgpt-gpt-5-5", attempt.tokens), "1100");
});

test("Details says how Claude counts are made, without touching the bar", () => {
  const sentence =
    "Claude counts use our tokenizer times 1.56, measured against Anthropic's own counter on 15 October 2026.";
  assert.ok(countSourceNote("claude").includes(sentence));
  assert.ok(countSourceNote("cowork").includes(sentence));
  assert.match(
    countSourceNote("perplexity"),
    /For replies by Claude models, the counts use our tokenizer times 1\.56, measured against Anthropic's own counter on 15 October 2026\./,
  );
  assert.doesNotMatch(countSourceNote("chatgpt"), /1\.56/);
  assert.doesNotMatch(countSourceNote("gemini"), /1\.56/);
});
