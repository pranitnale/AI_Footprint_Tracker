import assert from "node:assert/strict";
import test from "node:test";
import {
  AttemptObservationSchema,
  HistoryMessageSchema,
  RequestObservationSchema,
  emptyGeneration,
  historyResponseParts,
  emptyAttemptMedia,
  emptyRequestMedia,
  composeOutputTotal,
  emptyTokenFields,
  payloadHash,
  type TimingEvidence,
  type TokenFields,
  type TokenMeasurement,
} from "@footprint/contracts";
import * as core from "@footprint/ecologits-core";
import configuration from "../../../config/estimation.build.json";
import mappings from "../../../config/estimation.mappings.json";
import media from "../../../config/estimation.media.json";
import {
  createMethodRegistry,
  LocalEstimateExecutor,
  prepareObservation,
  projectAttemptEvidence,
  estimateAttempt,
} from "../src/index";
import { serializeEcoLogitsOutput } from "../src/engines/projection";

const methods = createMethodRegistry(configuration, mappings, media);
const executor = new LocalEstimateExecutor(methods);
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const measurement = (value: string): TokenMeasurement => ({
  value,
  evidence: "heuristic_estimate",
  scope: "observed_text",
  completeness: "complete_for_scope",
  profile_id: "o200k-base-4.0.0-reference",
  reason: "tokenizer_mapping_unverified",
});
/** 3.0.0 attempts carry the composite of their parts as the output total. */
const withOutputTotal = (tokens: TokenFields): TokenFields => ({
  ...tokens,
  output_total: composeOutputTotal(tokens),
});
function timing(seconds: string, live = true): TimingEvidence {
  return {
    duration_seconds: seconds,
    source: live ? "browser_request" : "claude_history",
    scope: live ? "request" : "content_blocks",
    completeness: "complete_for_scope",
    profile_version: "timing-observation-1",
  };
}
function observations(count = "2084") {
  const request = RequestObservationSchema.parse({
    schema_version: "3.0.0",
    kind: "request",
    request_id: id(1),
    revision: 1,
    conversation_key: "a".repeat(64),
    key_version: "1",
    provider_request_key: "c".repeat(64),
    site: "claude",
    adapter_version: "0.1.0",
    action: "send",
    dispatched_at: "2026-09-15T12:00:00.000Z",
    ended_at: "2026-09-15T12:00:06.000Z",
    state: "completed",
    model_id: "claude-opus-4-8",
    model_evidence: "response_field",
    features: ["text"],
    observed_search_operations: null,
    documents: {
      upload_count: null,
      types: [],
      processing: "unknown",
      extracted_text: null,
    },
    media: emptyRequestMedia(),
    coverage_reasons: [],
    policy_version: "0.1.0",
    company_dedup_key: null,
  });
  const attempt = AttemptObservationSchema.parse({
    schema_version: "3.0.0",
    kind: "attempt",
    attempt_id: id(2),
    request_id: id(1),
    revision: 1,
    provider_attempt_key: "b".repeat(64),
    key_version: "1",
    started_at: request.dispatched_at,
    ended_at: request.ended_at,
    timing: null,
    state: "completed",
    execution_evidence: "content_observed",
    model_id: request.model_id,
    model_evidence: "response_field",
    tokens: withOutputTotal({
      ...emptyTokenFields(),
      answer_output: measurement(count),
    }),
    media: emptyAttemptMedia(),
    generation: emptyGeneration(),
    coverage_reasons: [],
    tokenizer_profile_id: null,
    tokenizer_asset_hash: null,
    proposed_method_id: methods.ecologits.method_id,
    company_dedup_key: null,
  });
  const history = HistoryMessageSchema.parse({
    schema_version: "3.0.0",
    kind: "history_message",
    message_key: "d".repeat(64),
    role: "response",
    conversation_key: request.conversation_key,
    key_version: "1",
    site: "claude",
    parent_key: null,
    prompt_key: "e".repeat(64),
    provider_request_key: request.provider_request_key,
    provider_attempt_key: attempt.provider_attempt_key,
    occurred_at: request.dispatched_at,
    date_basis: "message_created",
    observed_at: "2026-09-15T13:00:00.000Z",
    proposed_method_id: methods.ecologits.method_id,
    company_dedup_key: null,
    proposed_method_hash: methods.ecologits.method_hash,
    model_id: request.model_id,
    tokens: measurement(count),
    inline_file_text: null,
    parts: historyResponseParts(measurement(count)),
    generation: emptyGeneration(),
    text_complete: true,
    timing: timing("4", false),
    coverage_reasons: ["history_only"],
  });
  return { family: "live" as const, request, attempt, history };
}

// The reply's 2,084 counted tokens are Claude text, so the estimate uses them times the
// Claude token factor, rounded half up (owner decision of 15 October 2026).
const CLAUDE_OUTPUT = 3251;

test("live and historical caps reach the unchanged core exactly, including water and embodied results", async () => {
  for (const liveSeconds of [null, "1.5", "50"]) {
    const input = observations();
    input.attempt.timing = liveSeconds === null ? null : timing(liveSeconds);
    const result = await executor.estimate(input);
    const expectedSeconds = liveSeconds === null ? 4 : Number(liveSeconds);
    const expected = core.llmImpacts({
      provider: "anthropic",
      model_name: "claude-opus-4-8",
      output_token_count: CLAUDE_OUTPUT,
      request_latency: expectedSeconds,
    });
    assert.equal(result.raw?.engine_id, "ecologits");
    assert.deepEqual(result.raw?.result, serializeEcoLogitsOutput(expected));
    assert.equal(
      prepareObservation(input).timing?.duration_seconds,
      String(expectedSeconds),
    );
  }
});

test("null timing retains modeled time and does not change the chosen engine", async () => {
  const input = observations();
  input.history.timing = null;
  const result = await executor.estimate(input);
  assert.equal(prepareObservation(input).timing, null);
  assert.equal(result.effective_method.engine_id, "ecologits");
  assert.deepEqual(
    result.raw?.result,
    serializeEcoLogitsOutput(
      core.llmImpacts({
        provider: "anthropic",
        model_name: "claude-opus-4-8",
        output_token_count: CLAUDE_OUTPUT,
        request_latency: null,
      }),
    ),
  );
});

test("historical-only observations use their admitted scoped timing", async () => {
  const { history } = observations();
  const result = await executor.estimate({
    family: "history",
    record: history,
  });
  assert.deepEqual(
    result.raw?.result,
    serializeEcoLogitsOutput(
      core.llmImpacts({
        provider: "anthropic",
        model_name: "claude-opus-4-8",
        output_token_count: CLAUDE_OUTPUT,
        request_latency: 4,
      }),
    ),
  );
});

/** Sets a saved reply's answer; its total is always the sum of its parts. */
function setSavedAnswer(
  input: ReturnType<typeof observations>,
  answer: TokenMeasurement,
) {
  input.history.parts = historyResponseParts(answer);
  input.history.tokens = composeOutputTotal(input.history.parts);
}

test("fuller compatible history improves partial live text without modifying observations", async () => {
  const input = observations("200");
  input.attempt.state = "interrupted_unconfirmed";
  input.attempt.timing = { ...timing("2"), completeness: "partial" };
  setSavedAnswer(input, measurement("500"));
  const before = payloadHash(input);
  const prepared = prepareObservation(input);
  assert.equal(prepared.output.value, "500");
  assert.equal(prepared.timing?.duration_seconds, "4");
  assert.equal(
    projectAttemptEvidence(input.attempt, input.history).tokens.answer_output
      .value,
    "500",
  );
  assert.equal(payloadHash(input), before);
  const result = await executor.estimate(input, {
    methodId: methods.original.method_id,
  });
  const expected = estimateAttempt(
    {
      ...input.attempt,
      tokens: withOutputTotal({
        ...input.attempt.tokens,
        answer_output: measurement("500"),
      }),
    },
    { methodId: methods.original.method_id },
  );
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(result.metrics).map(([k, v]) => [k, v.value]),
    ),
    Object.fromEntries(
      Object.entries(expected.metrics).map(([k, v]) => [k, v.value]),
    ),
  );
  assert.equal(result.source.family, "live");
  if (result.source.family !== "live") throw new Error("live source expected");
  assert.equal(result.source.attempt_hash, payloadHash(input.attempt));
  assert.equal(
    result.source.history_binding?.message_key,
    input.history.message_key,
  );
});

test("provider output totals and complete live measurements retain their scopes", () => {
  const input = observations("200");
  setSavedAnswer(input, measurement("150"));
  // A shorter saved reply never replaces a larger live count.
  assert.equal(prepareObservation(input).output.value, "200");
  // A saved reply that grew after the stream ended replaces the shorter live count.
  setSavedAnswer(input, measurement("500"));
  assert.equal(prepareObservation(input).output.value, "500");
  input.attempt.state = "interrupted_unconfirmed";
  input.attempt.tokens.output_total = {
    ...measurement("1000"),
    evidence: "provider_reported",
    scope: "provider_request",
    profile_id: null,
    reason: null,
  };
  assert.equal(prepareObservation(input).output.value, "1000");
  assert.equal(
    projectAttemptEvidence(input.attempt, input.history).tokens.answer_output
      .value,
    "500",
  );
  input.attempt.tokens.output_total = composeOutputTotal(input.attempt.tokens);
  // A different counting profile never replaces the live count.
  setSavedAnswer(input, {
    ...measurement("500"),
    profile_id: "cl100k-base-4.0.0-reference",
  });
  assert.equal(prepareObservation(input).output.value, "200");
});

test("history changes bind a new input hash while the stronger live duration survives", async () => {
  const input = observations();
  input.attempt.timing = timing("6");
  const old = await executor.estimate(input);
  input.history.timing = timing("5", false);
  const next = await executor.estimate(input);
  assert.notEqual(old.input_hash, next.input_hash);
  assert.deepEqual(old.metrics, next.metrics);
  assert.equal(prepareObservation(input).timing?.duration_seconds, "6");
});

test("different attempts, conversations and known models cannot be joined", () => {
  for (const mutate of [
    (input: ReturnType<typeof observations>) => {
      input.history.provider_attempt_key = "f".repeat(64);
    },
    (input: ReturnType<typeof observations>) => {
      input.history.conversation_key = "f".repeat(64);
    },
    (input: ReturnType<typeof observations>) => {
      input.request.coverage_reasons = ["request_identity_ambiguous"];
    },
  ]) {
    const input = observations();
    mutate(input);
    assert.throws(() => prepareObservation(input));
  }
  // Claude history names only the chat's current model (B5), so a reply answered by
  // another model is still the same reply, estimated with its live model.
  const claude = observations();
  claude.history.model_id =
    "claude-sonnet-4-6" as typeof claude.history.model_id;
  assert.equal(prepareObservation(claude).modelId, claude.attempt.model_id);
  // Other sites label each saved reply, so a different model is another reply.
  const other = () => {
    const input = observations();
    const model = "chatgpt-gpt-5-5" as typeof input.request.model_id;
    input.request.site = "chatgpt";
    input.history.site = "chatgpt";
    input.request.model_id = model;
    input.attempt.model_id = model;
    input.history.model_id = model;
    // The fixture's saved timing comes from Claude history.
    input.history.timing = null;
    return input;
  };
  assert.doesNotThrow(() => prepareObservation(other()));
  const switched = other();
  switched.history.model_id =
    "chatgpt-gpt-5-6-sol" as typeof switched.history.model_id;
  assert.throws(() => prepareObservation(switched), /dependency_missing/);
});

test("timing changes do not change Original formula numbers", async () => {
  const input = observations();
  const old = await executor.estimate(input, {
    methodId: methods.original.method_id,
  });
  input.attempt.timing = timing("1.5");
  const next = await executor.estimate(input, {
    methodId: methods.original.method_id,
  });
  assert.deepEqual(old.metrics, next.metrics);
  assert.notEqual(old.input_hash, next.input_hash);
});

test("a linked historical model enriches Original provenance without rewriting its live source", async () => {
  const input = observations();
  input.attempt.model_id = null;
  input.attempt.model_evidence = "unknown";
  const result = await executor.estimate(input, {
    methodId: methods.original.method_id,
  });
  assert.equal(result.selection.observed_model_id, input.history.model_id);
  assert.equal(result.raw?.engine_id, "original");
  if (result.raw?.engine_id !== "original" || Array.isArray(result.raw.result))
    throw new Error("live Original result expected");
  assert.equal(result.raw.result.observed_model_key, input.history.model_id);
  assert.equal(result.raw.result.selection_reason, "profile_absent");
  assert.equal(result.raw.result.observation_hash, payloadHash(input.attempt));
  assert.equal(input.attempt.model_id, null);
});
