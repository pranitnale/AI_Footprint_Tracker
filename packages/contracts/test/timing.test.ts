import assert from "node:assert/strict";
import test from "node:test";
import { pythonReference } from "../../../tools/python-reference.cjs";
import {
  AttemptObservationSchema,
  HistoryMessageSchema,
  HistoryPageSchema,
  HistorySummarySchema,
  TimingEvidenceSchema,
  EcoLogitsMethodDefinitionSchema,
  EstimateObservationSourceSchema,
  composeOutputTotal,
  emptyTokenFields,
  emptyGeneration,
  historyResponseParts,
  unknownMeasurement,
  emptyAttemptMedia,
  historyNumericPayloadHash,
  mergeHistoryEvidence,
  refineHistory,
  REASON_CODES,
  ERROR_CATALOG,
  type HistoryMessage,
  type TimingEvidence,
} from "../src/index";

const timing: TimingEvidence = {
  duration_seconds: "5.125",
  source: "browser_request",
  scope: "request",
  completeness: "complete_for_scope",
  profile_version: "timing-observation-1",
};
function history(): HistoryMessage {
  return HistoryMessageSchema.parse({
    schema_version: "3.0.0",
    kind: "history_message",
    message_key: "a".repeat(64),
    conversation_key: "b".repeat(64),
    key_version: "1",
    site: "chatgpt",
    role: "response",
    parent_key: null,
    prompt_key: null,
    provider_request_key: null,
    provider_attempt_key: null,
    occurred_at: null,
    date_basis: "unknown",
    observed_at: "2026-09-15T12:00:00.000Z",
    proposed_method_id: "test-method-1",
    company_dedup_key: null,
    proposed_method_hash: "c".repeat(64),
    model_id: null,
    tokens: {
      value: "500",
      evidence: "heuristic_estimate",
      scope: "observed_text",
      completeness: "complete_for_scope",
      profile_id: "observed-text-v1",
      reason: "tokenizer_mapping_unverified",
    },
    inline_file_text: null,
    parts: historyResponseParts({ value: "500", evidence: "heuristic_estimate", scope: "observed_text", completeness: "complete_for_scope", profile_id: "observed-text-v1", reason: "tokenizer_mapping_unverified", }),
    generation: emptyGeneration(),
    text_complete: true,
    coverage_reasons: [],
    timing: null,
  });
}
function attempt() {
  return {
    schema_version: "3.0.0",
    kind: "attempt",
    attempt_id: "00000000-0000-4000-8000-000000000002",
    request_id: "00000000-0000-4000-8000-000000000001",
    revision: 1,
    provider_attempt_key: null,
    key_version: "1",
    started_at: "2026-09-15T12:00:00.000Z",
    ended_at: "2026-09-15T12:00:06.000Z",
    state: "completed",
    execution_evidence: "content_observed",
    model_id: null,
    model_evidence: "unknown",
    tokens: emptyTokenFields(),
    media: emptyAttemptMedia(),
    generation: emptyGeneration(),
    coverage_reasons: [],
    tokenizer_profile_id: null,
    tokenizer_asset_hash: null,
    proposed_method_id: null,
    company_dedup_key: null,
    timing,
  };
}

test("timing accepts only bounded positive numerical evidence with matching source and scope", () => {
  for (const duration_seconds of ["0.000001", "5.125", "86400"])
    assert.ok(
      TimingEvidenceSchema.safeParse({ ...timing, duration_seconds }).success,
    );
  for (const duration_seconds of [
    null,
    5,
    "0",
    "-1",
    "86400.1",
    "86400.000000000000001",
    "8.6400000000000001e4",
    "NaN",
    "Infinity",
    "1e999",
    "1e-999",
    "01",
    "",
  ])
    assert.equal(
      TimingEvidenceSchema.safeParse({ ...timing, duration_seconds }).success,
      false,
    );
  for (const [source, scope] of [
    ["browser_request", "request"],
    ["chatgpt_history", "provider_message"],
    ["claude_history", "content_blocks"],
    ["perplexity_history", "workflow"],
  ]) {
    assert.ok(
      TimingEvidenceSchema.safeParse({ ...timing, source, scope }).success,
    );
    assert.equal(
      TimingEvidenceSchema.safeParse({
        ...timing,
        source,
        scope: "unsupported",
      }).success,
      false,
    );
  }
  for (const change of [
    { scope: "workflow" },
    { profile_version: "timing-observation-0" },
    { text: "PRIVATE_SENTINEL" },
    { completeness: "measured_inference" },
  ])
    assert.equal(
      TimingEvidenceSchema.safeParse({ ...timing, ...change }).success,
      false,
    );
});

test("live and historical timing enforce provider, role and completion boundaries", () => {
  assert.ok(AttemptObservationSchema.safeParse(attempt()).success);
  for (const state of [
    "generating",
    "dispatch_only",
    "cancelled",
    "failed",
    "interrupted_unconfirmed",
  ])
    assert.equal(
      AttemptObservationSchema.safeParse({ ...attempt(), state }).success,
      false,
    );
  assert.ok(
    AttemptObservationSchema.safeParse({
      ...attempt(),
      state: "cancelled",
      timing: { ...timing, completeness: "partial" },
    }).success,
  );
  assert.equal(
    AttemptObservationSchema.safeParse({
      ...attempt(),
      timing: {
        ...timing,
        source: "chatgpt_history",
        scope: "provider_message",
      },
    }).success,
    false,
  );
  const { timing: _omitted, ...missing } = attempt();
  assert.equal(AttemptObservationSchema.safeParse(missing).success, false);
  for (const [site, source, scope] of [
    ["chatgpt", "chatgpt_history", "provider_message"],
    ["claude", "claude_history", "content_blocks"],
    ["perplexity", "perplexity_history", "workflow"],
  ]) {
    const value = { ...history(), site, timing: { ...timing, source, scope } };
    assert.ok(HistoryMessageSchema.safeParse(value).success);
    for (const change of [
      { site: "gemini" },
      { role: "prompt" },
      { text_complete: false },
    ])
      assert.equal(
        HistoryMessageSchema.safeParse({ ...value, ...change }).success,
        false,
      );
    assert.ok(
      HistoryMessageSchema.safeParse({
        ...value,
        text_complete: false,
        timing: { ...value.timing, completeness: "partial" },
      }).success,
    );
  }
  assert.equal(
    HistoryMessageSchema.safeParse({ ...history(), timing }).success,
    false,
  );
});

test("timing refinements retain counts and make conflicting historical spans unavailable", () => {
  const old = history();
  const next = HistoryMessageSchema.parse({
    ...old,
    timing: { ...timing, source: "chatgpt_history", scope: "provider_message" },
  });
  assert.equal(refineHistory(old, next), "improved");
  assert.notEqual(
    historyNumericPayloadHash(old),
    historyNumericPayloadHash(next),
  );
  assert.deepEqual(mergeHistoryEvidence(next, old), next);
  assert.equal(refineHistory(next, old), "duplicate");
  assert.equal(old.timing, null);
  const changed = {
    ...next,
    timing: { ...next.timing!, duration_seconds: "6" },
  };
  const original = structuredClone(next);
  const merged = mergeHistoryEvidence(next, changed);
  assert.equal(refineHistory(next, changed), "improved");
  assert.equal(refineHistory(changed, next), "improved");
  assert.equal(merged.timing, null);
  assert.deepEqual(merged.tokens, next.tokens);
  assert.deepEqual(merged.coverage_reasons, ["historical_timing_conflict"]);
  assert.ok(HistoryMessageSchema.safeParse(merged).success);
  for (const reread of [next, changed, old]) {
    assert.deepEqual(mergeHistoryEvidence(merged, reread), merged);
    assert.equal(refineHistory(merged, reread), "duplicate");
  }
  assert.deepEqual(next, original);
  const established = { ...next, model_id: "chatgpt-gpt-5-6-sol" as const };
  assert.equal(
    refineHistory(established, {
      ...changed,
      model_id: established.model_id,
      message_key: "f".repeat(64),
    }),
    "conflict",
  );
  // A newer per-reply label is a registry correction and replaces the saved model.
  const relabelled = { ...established, model_id: "chatgpt-gpt-5-5" as const };
  assert.equal(refineHistory(established, relabelled), "improved");
  assert.equal(
    mergeHistoryEvidence(established, relabelled).model_id,
    "chatgpt-gpt-5-5",
  );
  // Claude history names only the chat's current model, so the first saved model stays.
  const claude = {
    ...old,
    site: "claude" as const,
    model_id: "claude-opus-5-5" as const,
  };
  assert.equal(
    refineHistory(claude, { ...claude, model_id: "claude-sonnet-5-5" }),
    "duplicate",
  );
  // A saved placeholder is corrected by a reread (13 Oct 2026: a Haiku 5.5 chat saved as
  // claude-unlisted kept the Opus stand-in): unlisted takes the family placeholder, and the
  // family placeholder takes a listed model of the same family, never one of another family.
  const unlisted = { ...claude, model_id: "claude-unlisted" as const };
  const haiku = { ...claude, model_id: "claude-haiku-unlisted" as const };
  assert.equal(refineHistory(unlisted, haiku), "improved");
  assert.equal(mergeHistoryEvidence(unlisted, haiku).model_id, "claude-haiku-unlisted");
  assert.equal(
    mergeHistoryEvidence(haiku, { ...claude, model_id: "claude-haiku-4-5" }).model_id,
    "claude-haiku-4-5",
  );
  assert.equal(refineHistory(haiku, { ...claude, model_id: "claude-opus-5-5" }), "duplicate");
  assert.equal(refineHistory(unlisted, { ...claude, model_id: "claude-opus-5-5" }), "duplicate");
  assert.equal(refineHistory(haiku, unlisted), "duplicate");
  // A larger complete count of the same reply is its newer state (research reports,
  // late results), with its own timing; the shorter reread then changes nothing.
  const grown = {
    ...changed,
    model_id: established.model_id,
    tokens: { ...next.tokens, value: "501" },
  };
  assert.equal(refineHistory(established, grown), "improved");
  assert.deepEqual(mergeHistoryEvidence(established, grown).timing, grown.timing);
  assert.equal(refineHistory(grown, established), "duplicate");
});

test("timing quality improvements and conflict normalization agree with Python", () => {
  const complete = HistoryMessageSchema.parse({
    ...history(),
    timing: { ...timing, source: "chatgpt_history", scope: "provider_message" },
  });
  const partial = {
    ...complete,
    timing: {
      ...complete.timing!,
      completeness: "partial" as const,
      duration_seconds: "1",
    },
  };
  const unknown = {
    ...partial,
    timing: { ...partial.timing, completeness: "unknown" as const },
  };
  const changed = {
    ...complete,
    timing: { ...complete.timing!, duration_seconds: "7" },
  };
  const conflicted = mergeHistoryEvidence(complete, changed);
  const cases = [
    [partial, complete],
    [unknown, complete],
    [complete, partial],
    [complete, unknown],
    [complete, changed],
    [conflicted, complete],
    [conflicted, history()],
    [
      partial,
      { ...partial, timing: { ...partial.timing, duration_seconds: "8" } },
    ],
    [partial, unknown],
    [unknown, partial],
    [
      unknown,
      { ...unknown, timing: { ...unknown.timing, duration_seconds: "8" } },
    ],
    [partial, history()],
    [unknown, history()],
  ];
  const expected = cases.map(([before, after]) => [
    mergeHistoryEvidence(before, after),
    refineHistory(before, after),
  ]);
  assert.deepEqual(
    expected.map(([, status]) => status),
    [
      "improved",
      "improved",
      "duplicate",
      "duplicate",
      "improved",
      "duplicate",
      "duplicate",
      "duplicate",
      "duplicate",
      "duplicate",
      "duplicate",
      "duplicate",
      "duplicate",
    ],
  );
  for (const [before, after] of cases.slice(7)) {
    const retained = mergeHistoryEvidence(before, after);
    assert.deepEqual(retained, before);
    assert.equal(retained.tokens.value, "500");
    assert.ok(HistoryMessageSchema.safeParse(retained).success);
  }
  const run = pythonReference(
    [
      "-c",
      [
        "import json,sys",
        "from aift.timing_evidence import merge_history_evidence",
        "from aift.historical_usage import refine",
        "print(json.dumps([[merge_history_evidence(a,b),refine(a,b)] for a,b in json.load(sys.stdin)]))",
      ].join("\n"),
    ],
    { input: JSON.stringify(cases) },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), expected);
});

test("historical timing conflict flag is restricted and has useful recovery copy", () => {
  const flagged = {
    ...history(),
    coverage_reasons: ["historical_timing_conflict"],
  };
  assert.ok(HistoryMessageSchema.safeParse(flagged).success);
  for (const change of [
    { role: "prompt" },
    {
      timing: {
        ...timing,
        source: "chatgpt_history",
        scope: "provider_message",
      },
    },
  ])
    assert.equal(
      HistoryMessageSchema.safeParse({ ...flagged, ...change }).success,
      false,
    );
  assert.equal(
    AttemptObservationSchema.safeParse({
      ...attempt(),
      coverage_reasons: flagged.coverage_reasons,
    }).success,
    false,
  );
  const reasons = REASON_CODES.filter(
    (r) => r !== "historical_timing_conflict",
  ).slice(0, 32);
  const first = {
    ...history(),
    coverage_reasons: reasons,
    timing: {
      ...timing,
      source: "chatgpt_history" as const,
      scope: "provider_message" as const,
    },
  };
  const merged = mergeHistoryEvidence(first, {
    ...first,
    timing: { ...first.timing, duration_seconds: "9" },
  });
  assert.equal(merged.coverage_reasons.length, 33);
  assert.ok(HistoryMessageSchema.safeParse(merged).success);
  const records = [
    merged,
    { ...merged, role: "prompt" },
    { ...merged, timing: first.timing },
    {
      ...merged,
      coverage_reasons: REASON_CODES.filter(
        (r) => r !== "historical_timing_conflict",
      ).slice(0, 33),
    },
  ];
  const pages = records.map((record) => ({
    schema_version: "3.0.0",
    site: record.site,
    conversation_key: record.conversation_key,
    observed_at: record.observed_at,
    deletion_epoch: 0,
    messages: [record],
    branch_scope: "loaded_messages",
    selected_leaf_key: null,
    branch_message_keys: null,
    root_message_key: null,
    first_request_verified: false,
    has_earlier: null,
    has_later: null,
  }));
  const expected = [true, false, false, false];
  assert.deepEqual(
    pages.map((page) => HistoryPageSchema.safeParse(page).success),
    expected,
  );
  const run = pythonReference(
    [
      "-c",
      [
        "import json,sys",
        "from footprint_contracts import validate_history_page,ContractError",
        "results=[]",
        "for page in json.load(sys.stdin):",
        " try:",
        "  validate_history_page(page)",
        "  results.append(True)",
        " except ContractError: results.append(False)",
        "print(json.dumps(results))",
      ].join("\n"),
    ],
    { input: JSON.stringify(pages) },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), expected);
  assert.match(
    JSON.stringify(ERROR_CATALOG.historical_timing_conflict),
    /Valid message and token counts are retained/,
  );
});

test("partial historical output improves only within a compatible profile and converges on stale rereads", () => {
  const complete = history();
  // A saved reply's total is always its parts' sum, so each variant changes the answer.
  const withAnswer = (
    base: HistoryMessage,
    change: Partial<HistoryMessage["tokens"]>,
    extra: Partial<HistoryMessage> = {},
  ): HistoryMessage => {
    const parts = {
      ...base.parts!,
      answer_output: { ...base.parts!.answer_output, ...change },
    };
    return { ...base, ...extra, parts, tokens: composeOutputTotal(parts) };
  };
  const partial = withAnswer(
    complete,
    { value: "200", completeness: "partial" },
    { text_complete: false },
  );
  assert.equal(refineHistory(partial, complete), "improved");
  assert.deepEqual(mergeHistoryEvidence(complete, partial), complete);
  assert.equal(refineHistory(complete, partial), "duplicate");
  for (const next of [
    withAnswer(complete, { value: "100" }),
    withAnswer(complete, { profile_id: "o200k-base-4.0.0-reference" }),
    withAnswer(complete, { completeness: "partial" }),
  ])
    assert.equal(refineHistory(partial, next), "conflict");
  const grown = withAnswer(complete, { value: "501" });
  assert.equal(refineHistory(complete, grown), "improved");
  assert.equal(refineHistory(grown, complete), "duplicate");
  // A larger count that is not complete is not a newer state of the reply.
  assert.equal(
    refineHistory(complete, withAnswer(grown, { completeness: "partial" })),
    "conflict",
  );
  // A reply whose parser cannot read tool input grows like a complete one, as long as
  // the same part stays unread and every part it reads is complete.
  const unread = (base: HistoryMessage, value: string) => {
    const parts = {
      ...base.parts!,
      answer_output: { ...base.parts!.answer_output, value },
      tool_input: unknownMeasurement("tool_work_unobserved"),
    };
    return { ...base, parts, tokens: composeOutputTotal(parts) };
  };
  assert.equal(unread(complete, "501").tokens.completeness, "partial");
  assert.equal(
    refineHistory(unread(complete, "500"), unread(complete, "501")),
    "improved",
  );
  assert.equal(
    refineHistory(unread(complete, "501"), unread(complete, "500")),
    "duplicate",
  );
  // A later read that also reads the formerly unread part is the fuller reply; the
  // reverse is a stale reread.
  assert.equal(refineHistory(unread(complete, "400"), complete), "improved");
  assert.equal(refineHistory(complete, unread(complete, "400")), "duplicate");
  assert.deepEqual(
    mergeHistoryEvidence(complete, { ...partial, message_key: "f".repeat(64) }),
    { ...partial, message_key: "f".repeat(64) },
  );
});

test("history binding is strict and old latency policies are rejected", () => {
  const value = {
    family: "live",
    request_id: attempt().request_id,
    request_revision: 1,
    request_hash: "a".repeat(64),
    attempt_id: attempt().attempt_id,
    attempt_revision: 1,
    attempt_hash: "b".repeat(64),
    history_binding: {
      message_key: "c".repeat(64),
      observation_hash: "d".repeat(64),
    },
  };
  assert.ok(EstimateObservationSourceSchema.safeParse(value).success);
  for (const history_binding of [
    { message_key: "c".repeat(64) },
    { ...value.history_binding, raw_text: "PRIVATE" },
    { ...value.history_binding, observation_hash: "invalid" },
  ])
    assert.equal(
      EstimateObservationSourceSchema.safeParse({ ...value, history_binding })
        .success,
      false,
    );
  assert.ok(
    EcoLogitsMethodDefinitionSchema.shape.latency_policy.safeParse(
      "observed-live-then-history-then-modeled-1",
    ).success,
  );
  assert.equal(
    EcoLogitsMethodDefinitionSchema.shape.latency_policy.safeParse(
      "profile-regression-without-measured-latency",
    ).success,
    false,
  );
});

test("history messages, pages and summaries accept only the current schema", () => {
  for (const schema_version of ["1.0.0", "1.1.0", "1.2.0"]) {
    assert.equal(
      HistoryMessageSchema.safeParse({ ...history(), schema_version }).success,
      false,
    );
    assert.equal(
      HistoryPageSchema.shape.schema_version.safeParse(schema_version).success,
      false,
    );
    assert.equal(
      HistorySummarySchema.shape.schema_version.safeParse(schema_version)
        .success,
      false,
    );
    assert.equal(
      AttemptObservationSchema.safeParse({ ...attempt(), schema_version })
        .success,
      false,
    );
  }
});
