import assert from "node:assert/strict";
import test from "node:test";
import { pythonReference } from "../../../tools/python-reference.cjs";
import {
  AttemptObservationSchema,
  GenerationSchema,
  HistoryMessageSchema,
  TimingEvidenceSchema,
  composeOutputTotal,
  emptyAttemptMedia,
  emptyGeneration,
  emptyTokenFields,
  generationCovers,
  historyModelConflicts,
  historyPromptParts,
  linkedReplyModel,
  historyTokenParts,
  mergeHistoryEvidence,
  notApplicableMeasurement,
  projectAttemptEvidence,
  refineHistory,
  selectOutputMeasurement,
  selectTimingEvidence,
  unknownMeasurement,
  type AttemptObservation,
  type Generation,
  type HistoryMessage,
  type MediaOutput,
  type TokenMeasurement,
} from "../src/index";

const counted = (value: string): TokenMeasurement => ({
  value,
  evidence: "heuristic_estimate",
  scope: "observed_text",
  completeness: "complete_for_scope",
  profile_id: "o200k-base-4.0.0-reference",
  reason: "tokenizer_mapping_unverified",
});

function parts(answer: string, thinking: string, tool: string) {
  return {
    answer_output: counted(answer),
    visible_thinking: counted(thinking),
    tool_input: counted(tool),
    intermediate_output: counted("0"),
  };
}

function attempt(tokens = emptyTokenFields()): AttemptObservation {
  return {
    schema_version: "3.0.0",
    kind: "attempt",
    attempt_id: "00000000-0000-4000-8000-000000000002",
    request_id: "00000000-0000-4000-8000-000000000001",
    revision: 1,
    provider_attempt_key: "e".repeat(64),
    key_version: "1",
    started_at: "2026-10-04T12:00:00.000Z",
    ended_at: "2026-10-04T12:00:05.000Z",
    state: "completed",
    execution_evidence: "content_observed",
    model_id: null,
    model_evidence: "unknown",
    tokens,
    timing: null,
    media: emptyAttemptMedia(),
    generation: emptyGeneration(),
    coverage_reasons: [],
    tokenizer_profile_id: null,
    tokenizer_asset_hash: null,
    proposed_method_id: null,
    company_dedup_key: null,
  };
}

function withParts(answer: string, thinking: string, tool: string) {
  const tokens = { ...emptyTokenFields(), ...parts(answer, thinking, tool) };
  tokens.output_total = composeOutputTotal(tokens);
  return attempt(tokens);
}

function history(
  overrides: Partial<HistoryMessage> = {},
): HistoryMessage {
  const p = {
    ...parts("100", "50", "80"),
    reported_reasoning: notApplicableMeasurement(),
    tool_output: notApplicableMeasurement(),
    image_input_tokens: notApplicableMeasurement(),
  };
  return {
    schema_version: "3.0.0",
    kind: "history_message",
    message_key: "a".repeat(64),
    role: "response",
    conversation_key: "b".repeat(64),
    key_version: "1",
    site: "claude",
    parent_key: null,
    prompt_key: null,
    provider_request_key: null,
    provider_attempt_key: "e".repeat(64),
    occurred_at: null,
    date_basis: "unknown",
    observed_at: "2026-10-04T12:00:00.000Z",
    proposed_method_id: "test-method-1",
    proposed_method_hash: "c".repeat(64),
    model_id: null,
    tokens: composeOutputTotal(p),
    parts: p,
    generation: emptyGeneration(),
    inline_file_text: null,
    timing: null,
    text_complete: true,
    coverage_reasons: [],
    company_dedup_key: null,
    ...overrides,
  };
}

test("saved replies add a token row for each output of another model (D3), TS and Python", () => {
  const side = (value: string | null) => ({
    role: "side_calls" as const,
    model_id: null,
    model_evidence: "unknown" as const,
    tokens:
      value === null
        ? unknownMeasurement("provider_usage_unavailable")
        : {
            value,
            evidence: "provider_reported" as const,
            scope: "provider_request" as const,
            completeness: "complete_for_scope" as const,
            profile_id: null,
            reason: null,
          },
    timing: null,
  });
  const reply = history({
    generation: { text_components: [side("10"), side(null)], media: [] },
  });
  const prompt = history({
    role: "prompt",
    provider_attempt_key: null,
    tokens: counted("12"),
    parts: historyPromptParts(counted("1296")),
  });
  const plain = history();
  const cases = [reply, prompt, plain];
  const rows = cases.map((message) =>
    historyTokenParts(message).map(([part, measured]) => [part, measured.value]),
  );
  assert.deepEqual(rows, [
    [
      ["total", "230"],
      ["other_models", "10"],
      ["other_models", null],
    ],
    [
      ["total", "12"],
      ["image_input_tokens", "1296"],
    ],
    [["total", "230"]],
  ]);
  const run = pythonReference(
    [
      "-c",
      [
        "import json,sys",
        "from footprint_contracts import history_token_parts",
        "print(json.dumps([[[p,m['value']] for p,m in history_token_parts(c)] for c in json.load(sys.stdin)]))",
      ].join("\n"),
    ],
    { input: JSON.stringify(cases) },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), rows);
});

test("the output total adds every generated part and never reads a missing part as zero", () => {
  assert.equal(composeOutputTotal(parts("100", "50", "80")).value, "230");
  assert.equal(
    composeOutputTotal(parts("100", "50", "80")).completeness,
    "complete_for_scope",
  );
  const missing = {
    ...parts("100", "50", "80"),
    tool_input: unknownMeasurement("tokenizer_unavailable"),
  };
  assert.deepEqual(composeOutputTotal(missing), {
    ...counted("150"),
    completeness: "partial",
    reason: "tokenizer_unavailable",
  });
  const skipped = { ...missing, tool_input: notApplicableMeasurement() };
  assert.equal(composeOutputTotal(skipped).completeness, "complete_for_scope");
  assert.equal(composeOutputTotal(skipped).value, "150");
  assert.equal(
    composeOutputTotal({
      answer_output: unknownMeasurement("partial_capture"),
      visible_thinking: notApplicableMeasurement(),
      tool_input: notApplicableMeasurement(),
      intermediate_output: notApplicableMeasurement(),
    }).value,
    null,
  );
});

test("attempts must carry the composite total unless the provider reports one", () => {
  assert.ok(AttemptObservationSchema.safeParse(withParts("1", "2", "3")).success);
  const forged = withParts("1", "2", "3");
  forged.tokens.output_total = counted("6000");
  assert.equal(AttemptObservationSchema.safeParse(forged).success, false);
  const reported = withParts("1", "2", "3");
  reported.tokens.output_total = {
    value: "4521",
    evidence: "provider_reported",
    scope: "provider_request",
    completeness: "complete_for_scope",
    profile_id: null,
    reason: null,
  };
  assert.ok(AttemptObservationSchema.safeParse(reported).success);
  assert.equal(selectOutputMeasurement(reported).value, "4521");
});

test("a saved reply that grew replaces the shorter live part, a stopped part is completed", () => {
  const live = withParts("100", "50", "10");
  const saved = history();
  assert.ok(HistoryMessageSchema.safeParse(saved).success);
  // Tool input grew from 10 to 80 after the stream (a research report).
  assert.equal(selectOutputMeasurement(live, saved).value, "230");
  const larger = withParts("100", "50", "900");
  assert.equal(selectOutputMeasurement(larger, saved).value, "1050");
});

test("history parts, provider totals and generation follow the role rules", () => {
  const value = history();
  assert.ok(HistoryMessageSchema.safeParse(value).success);
  assert.equal(
    HistoryMessageSchema.safeParse({ ...value, tokens: counted("1") }).success,
    false,
  );
  const cowork = history({
    tokens: {
      value: "433",
      evidence: "provider_reported",
      scope: "provider_request",
      completeness: "complete_for_scope",
      profile_id: null,
      reason: null,
    },
  });
  assert.ok(HistoryMessageSchema.safeParse(cowork).success);
  assert.equal(
    HistoryMessageSchema.safeParse({ ...cowork, role: "prompt" }).success,
    false,
  );
  const prompt = history({
    role: "prompt",
    provider_attempt_key: null,
    tokens: counted("12"),
    parts: historyPromptParts(counted("1296")),
  });
  assert.ok(HistoryMessageSchema.safeParse(prompt).success);
  assert.equal(
    HistoryMessageSchema.safeParse({
      ...prompt,
      generation: {
        text_components: [],
        media: [
          {
            kind: "image",
            model_id: null,
            count: "1",
            width: null,
            height: null,
            outcome: "returned",
          },
        ],
      },
    }).success,
    false,
  );
  const speech = history({
    generation: {
      text_components: [],
      media: [
        {
          kind: "speech",
          length_basis: "characters",
          seconds: null,
          characters: "55",
        },
      ],
    },
  });
  assert.ok(HistoryMessageSchema.safeParse(speech).success);
  assert.equal(
    HistoryMessageSchema.safeParse({
      ...speech,
      generation: {
        text_components: [],
        media: [
          {
            kind: "speech",
            length_basis: "audio_frames",
            seconds: null,
            characters: "55",
          },
        ],
      },
    }).success,
    false,
  );
});

test("timing scopes per source, Cowork timing on Claude and research spans", () => {
  const timing = {
    duration_seconds: "231.7",
    source: "claude_history",
    scope: "research_task",
    completeness: "complete_for_scope",
    profile_version: "timing-observation-1",
  } as const;
  assert.ok(TimingEvidenceSchema.safeParse(timing).success);
  for (const [source, scope, valid] of [
    ["gemini_history", "research_task", true],
    ["gemini_history", "provider_message", false],
    ["cowork_history", "provider_message", true],
    ["notebooklm_history", "provider_message", true],
    ["perplexity_history", "research_task", false],
    ["browser_request", "research_task", false],
  ] as const)
    assert.equal(
      TimingEvidenceSchema.safeParse({ ...timing, source, scope }).success,
      valid,
      `${source} ${scope}`,
    );
  const cowork = history({
    timing: { ...timing, source: "cowork_history", scope: "provider_message" },
  });
  assert.ok(HistoryMessageSchema.safeParse(cowork).success);
  assert.equal(
    HistoryMessageSchema.safeParse({ ...cowork, site: "chatgpt" }).success,
    false,
  );
  // A research span beats the short launching stream; other saved timing does not.
  const live = {
    ...withParts("100", "50", "80"),
    timing: {
      duration_seconds: "8",
      source: "browser_request",
      scope: "request",
      completeness: "complete_for_scope",
      profile_version: "timing-observation-1",
    } as const,
  };
  assert.equal(
    selectTimingEvidence(live, history({ timing }))?.duration_seconds,
    "231.7",
  );
  assert.equal(
    selectTimingEvidence(
      live,
      history({
        timing: { ...timing, scope: "content_blocks" },
      }),
    )?.duration_seconds,
    "8",
  );
});

const reportedTotal = (value: string): TokenMeasurement => ({
  value,
  evidence: "provider_reported",
  scope: "provider_request",
  completeness: "complete_for_scope",
  profile_id: null,
  reason: null,
});

test("a provider total is the request's own count, live or saved, and wins over parts", () => {
  const observedScope = withParts("1", "2", "3");
  observedScope.tokens.output_total = {
    ...reportedTotal("999"),
    scope: "observed_text",
  };
  assert.equal(AttemptObservationSchema.safeParse(observedScope).success, false);
  // A linked saved reply with the provider's exact total (Cowork) beats counted parts.
  const live = withParts("100", "50", "80");
  const saved = history({ site: "claude", tokens: reportedTotal("433") });
  assert.ok(HistoryMessageSchema.safeParse(saved).success);
  assert.equal(selectOutputMeasurement(live, saved).value, "433");
  const projected = projectAttemptEvidence(live, saved);
  assert.equal(projected.tokens.output_total.value, "433");
  assert.ok(AttemptObservationSchema.safeParse(projected).success);
  // The live report still wins over a saved one.
  const reported = withParts("100", "50", "80");
  reported.tokens.output_total = reportedTotal("500");
  assert.equal(selectOutputMeasurement(reported, saved).value, "500");
});

const speech = (
  length_basis: "audio_frames" | "stored_length" | "characters",
  seconds: string | null,
  characters: string | null,
): MediaOutput => ({ kind: "speech", length_basis, seconds, characters });
const image = (
  model_id: "perplexity-nano-banana" | null,
  size: number | null,
  outcome: "returned" | "started_not_returned",
  count = "1",
): MediaOutput => ({
  kind: "image",
  model_id,
  count,
  width: size,
  height: size,
  outcome,
});
const media = (...items: MediaOutput[]): Generation => ({
  text_components: [],
  media: items,
});
const MEDIA_RULES: Array<[MediaOutput, boolean]> = [
  [speech("audio_frames", "3.2", null), true],
  [speech("stored_length", "12", null), true],
  [speech("characters", null, "55"), true],
  [speech("audio_frames", null, null), false],
  [speech("stored_length", null, "55"), false],
  [speech("audio_frames", "3.2", "55"), false],
  [speech("characters", "3.2", "55"), false],
  [speech("characters", null, "0"), false],
  [speech("characters", null, null), false],
  [image(null, null, "started_not_returned"), true],
  [image(null, null, "started_not_returned", "2"), false],
  [image(null, 1024, "returned", "4"), true],
  [image(null, 1024, "returned", "0"), false],
];

test("speech lengths match their basis and a started image job counts once", () => {
  for (const [item, valid] of MEDIA_RULES)
    assert.equal(
      GenerationSchema.safeParse(media(item)).success,
      valid,
      JSON.stringify(item),
    );
});

test("a poorer reread never replaces fuller media facts", () => {
  const named = media(image("perplexity-nano-banana", 1024, "returned"));
  const poorer = media(image(null, null, "started_not_returned"));
  assert.equal(generationCovers(poorer, named), false);
  assert.equal(generationCovers(named, poorer), true);
  // More images that keep every earlier fact are a fuller read.
  assert.equal(
    generationCovers(
      media(image("perplexity-nano-banana", 1024, "returned", "2")),
      named,
    ),
    true,
  );
  assert.equal(
    generationCovers(
      media(image(null, null, "returned"), image(null, null, "returned")),
      named,
    ),
    false,
  );
  // One grouped entry covers the same images listed one by one, and the reverse.
  const pair = media(image(null, 1024, "returned"), image(null, 1024, "returned"));
  const grouped = media(image(null, 1024, "returned", "2"));
  assert.equal(generationCovers(grouped, pair), true);
  assert.equal(generationCovers(pair, grouped), true);
  // Measured audio is not replaced by the reading-rate rule.
  assert.equal(
    generationCovers(
      media(speech("characters", null, "55")),
      media(speech("audio_frames", "3.2", null)),
    ),
    false,
  );
  // A research component never stands in for a side-call component.
  const component = (role: "side_calls" | "research") => ({
    role,
    model_id: null,
    model_evidence: "unknown" as const,
    tokens: counted("10"),
    timing: null,
  });
  assert.equal(
    generationCovers(
      { text_components: [component("research")], media: [] },
      { text_components: [component("side_calls")], media: [] },
    ),
    false,
  );
  // A reread that names the size but loses the model is not fuller, and neither is the
  // reverse: each read keeps a fact the other lacks.
  const sized = media(image(null, 1024, "returned"));
  const modelOnly = media(image("perplexity-nano-banana", null, "returned"));
  assert.equal(generationCovers(sized, modelOnly), false);
  assert.equal(generationCovers(modelOnly, sized), false);
  // One read item cannot stand in for two saved items with different facts.
  assert.equal(
    generationCovers(
      media(
        image("perplexity-nano-banana", 1024, "returned"),
        image(null, null, "started_not_returned"),
      ),
      media(modelOnly.media[0]!, sized.media[0]!),
    ),
    false,
  );
  assert.equal(
    generationCovers(
      media(
        image("perplexity-nano-banana", 1024, "returned"),
        image("perplexity-nano-banana", 1024, "returned"),
      ),
      media(modelOnly.media[0]!, sized.media[0]!),
    ),
    true,
  );
  const old = history({ site: "perplexity", generation: named });
  const reread = history({
    site: "perplexity",
    generation: poorer,
    observed_at: "2026-10-04T13:00:00.000Z",
  });
  assert.deepEqual(mergeHistoryEvidence(old, reread).generation, named);
});

test("Python accepts and rejects the same 3.0.0 output records", () => {
  const good = history();
  const cases = [
    { kind: "history", value: good, valid: true },
    { kind: "history", value: { ...good, tokens: counted("1") }, valid: false },
    {
      kind: "history",
      value: history({
        role: "prompt",
        provider_attempt_key: null,
        tokens: counted("12"),
        parts: historyPromptParts(counted("1296")),
      }),
      valid: true,
    },
    { kind: "attempt", value: withParts("1", "2", "3"), valid: true },
    {
      kind: "attempt",
      value: (() => {
        const forged = withParts("1", "2", "3");
        forged.tokens.output_total = counted("6000");
        return forged;
      })(),
      valid: false,
    },
    {
      kind: "attempt",
      value: (() => {
        const forged = withParts("1", "2", "3");
        forged.tokens.output_total = {
          ...reportedTotal("999"),
          scope: "observed_text",
        };
        return forged;
      })(),
      valid: false,
    },
    {
      kind: "attempt",
      value: (() => {
        const reported = withParts("1", "2", "3");
        reported.tokens.output_total = reportedTotal("999");
        return reported;
      })(),
      valid: true,
    },
    ...MEDIA_RULES.map(([item, valid]) => ({
      kind: "attempt",
      value: { ...withParts("1", "2", "3"), generation: media(item) },
      valid,
    })),
  ];
  for (const item of cases)
    assert.equal(
      item.kind === "history"
        ? HistoryMessageSchema.safeParse(item.value).success
        : AttemptObservationSchema.safeParse(item.value).success,
      item.valid,
    );
  const code = [
    "import json,sys",
    "from footprint_contracts import validate_history_page,validate_observation,ContractError",
    "out=[]",
    "for case in json.load(sys.stdin):",
    "  try:",
    "    if case['kind']=='history':",
    "      v=case['value']",
    "      validate_history_page({'schema_version':'3.0.0','site':v['site'],'conversation_key':v['conversation_key'],'observed_at':v['observed_at'],'deletion_epoch':0,'messages':[v],'branch_scope':'unknown','selected_leaf_key':None,'branch_message_keys':None,'root_message_key':None,'first_request_verified':False,'has_earlier':None,'has_later':None})",
    "    else:",
    "      validate_observation(case['value'])",
    "    out.append(True)",
    "  except ContractError:",
    "    out.append(False)",
    "print(json.dumps(out))",
  ].join("\n");
  const run = pythonReference(["-c", code], { input: JSON.stringify(cases) });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(
    JSON.parse(run.stdout),
    cases.map((item) => item.valid),
  );
});

test("a reread never erases or lowers a known count outside the output total", () => {
  const later = "2026-10-04T13:00:00.000Z";
  const withSide = (
    part: "tool_output" | "reported_reasoning" | "image_input_tokens",
    value: TokenMeasurement,
    overrides: Partial<HistoryMessage> = {},
  ) => {
    const base = history(overrides);
    return { ...base, parts: { ...base.parts!, [part]: value } };
  };
  const old = withSide("tool_output", counted("40"));
  const cases: Array<[HistoryMessage, HistoryMessage]> = [
    // A later view that cannot read tool results keeps the saved count.
    [old, withSide("tool_output", unknownMeasurement("tool_work_unobserved"), { observed_at: later })],
    // A truncated view keeps the higher count of the same measure; a fuller one replaces it.
    [old, withSide("tool_output", counted("10"), { observed_at: later })],
    [old, withSide("tool_output", counted("90"), { observed_at: later })],
    // A count measured another way cannot replace the saved one.
    [
      old,
      withSide(
        "tool_output",
        { ...counted("40"), profile_id: "cl100k-base-4.0.0-reference" },
        { observed_at: later },
      ),
    ],
    // A shorter reread is replaced by the saved state, but its differently measured
    // part is still a conflict.
    (() => {
      const shorter = {
        ...old.parts!,
        ...parts("90", "50", "80"),
        tool_output: {
          ...counted("40"),
          profile_id: "cl100k-base-4.0.0-reference" as const,
        },
      };
      return [
        old,
        history({
          observed_at: later,
          parts: shorter,
          tokens: composeOutputTotal(shorter),
        }),
      ] as [HistoryMessage, HistoryMessage];
    })(),
    // Uploaded image tokens on a prompt follow the same rule.
    [
      history({
        role: "prompt",
        provider_attempt_key: null,
        tokens: counted("12"),
        parts: historyPromptParts(counted("1296")),
      }),
      history({
        role: "prompt",
        provider_attempt_key: null,
        tokens: counted("12"),
        parts: historyPromptParts(unknownMeasurement("image_dimensions_unknown")),
        observed_at: later,
      }),
    ],
  ];
  const expected = cases.map(([before, after]) => [
    mergeHistoryEvidence(before, after),
    refineHistory(before, after),
  ]);
  assert.deepEqual(
    expected.map(([, status]) => status),
    ["duplicate", "duplicate", "improved", "conflict", "conflict", "duplicate"],
  );
  assert.equal(
    (expected[0]![0] as HistoryMessage).parts!.tool_output.value,
    "40",
  );
  assert.equal(
    (expected[5]![0] as HistoryMessage).parts!.image_input_tokens.value,
    "1296",
  );
  for (const [merged] of expected)
    assert.ok(HistoryMessageSchema.safeParse(merged).success);
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

test("B5 a Claude reply's chat-level saved model never breaks its live link; other sites' answering models do", () => {
  type Evidence = AttemptObservation["model_evidence"];
  const cases: Array<[string, string | null, string | null, Evidence, boolean, string | null]> = [
    ["claude", "claude-opus-5-5", "claude-sonnet-5-5", "response_field", false, "claude-sonnet-5-5"],
    ["claude", "claude-opus-5-5", "claude-sonnet-5-5", "request_field", false, "claude-sonnet-5-5"],
    ["chatgpt", "gpt-6-astra", "gpt-6-1-sol", "response_field", true, "gpt-6-1-sol"],
    // A model taken from the request was asked for; the saved reply names the one that
    // answered (5 Oct 2026).
    ["chatgpt", "gpt-6-astra", "gpt-6-1-sol", "request_field", false, "gpt-6-astra"],
    ["gemini", "gemini-3-8-flash", "gemini-3-8-pro", "ui_selection", false, "gemini-3-8-flash"],
    ["perplexity", "gpt-6-astra", "gpt-6-astra", "response_field", false, "gpt-6-astra"],
    ["gemini", null, "gemini-3-8-flash", "request_field", false, "gemini-3-8-flash"],
    ["chatgpt", "gpt-6-astra", null, "unknown", false, "gpt-6-astra"],
  ];
  const expected = cases.map(([site, saved, live, evidence]) => {
    const history = { site: site as HistoryMessage["site"], model_id: saved as never };
    const attempt = { model_id: live as never, model_evidence: evidence };
    return [
      historyModelConflicts(history, attempt),
      linkedReplyModel(attempt, history),
    ];
  });
  assert.deepEqual(
    expected,
    cases.map((item) => [item[4], item[5]]),
  );
  // Without a saved copy the live model stands.
  assert.equal(
    linkedReplyModel({
      model_id: "gpt-6-1-sol" as never,
      model_evidence: "request_field",
    }),
    "gpt-6-1-sol",
  );
  const run = pythonReference(
    [
      "-c",
      [
        "import json,sys",
        "from aift.timing_evidence import history_model_conflicts, linked_reply_model",
        "print(json.dumps([[history_model_conflicts({'site':s,'model_id':h},{'model_id':a,'model_evidence':e}),linked_reply_model({'model_id':a,'model_evidence':e},{'site':s,'model_id':h})] for s,h,a,e,_,_m in json.load(sys.stdin)]))",
      ].join("\n"),
    ],
    { input: JSON.stringify(cases) },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), expected);
});

test("a Gemini turn's saved label neither breaks its live link nor yields to the live mode label, TS and Python", () => {
  const video = {
    text_components: [],
    media: [
      {
        kind: "video",
        model_id: "gemini-omni-video",
        width: "1280",
        height: "720",
        duration_seconds: null,
        with_audio: null,
      },
    ],
  };
  const image = {
    text_components: [],
    media: [
      {
        kind: "image",
        model_id: null,
        count: "1",
        width: "1024",
        height: "1024",
        outcome: "returned",
      },
    ],
  };
  // [site, saved model, saved generation, live model, live evidence, conflict, linked model]
  const cases: Array<
    [string, string, unknown, string, AttemptObservation["model_evidence"], boolean, string]
  > = [
    ["gemini", "gemini-omni", video, "gemini-3-6-thinking", "response_field", false, "gemini-omni"],
    // A video job that failed leaves no video but keeps the video model's label (G6).
    ["gemini", "gemini-omni", { text_components: [], media: [] }, "gemini-3-6-thinking", "response_field", false, "gemini-omni"],
    ["gemini", "nano-banana-2", image, "gemini-3-6-thinking", "response_field", false, "nano-banana-2"],
    ["gemini", "gemini-3-6-thinking", { text_components: [], media: [] }, "gemini-3-6-thinking", "response_field", false, "gemini-3-6-thinking"],
    // Only Gemini: another site's answering models keep their check.
    ["chatgpt", "gpt-6-astra", video, "gpt-6-1-sol", "response_field", true, "gpt-6-1-sol"],
    ["perplexity", "gpt-6-astra", image, "gpt-6-1-sol", "response_field", true, "gpt-6-1-sol"],
  ];
  const expected = cases.map(([site, saved, generation, live, evidence]) => {
    const history = {
      site: site as HistoryMessage["site"],
      model_id: saved as never,
      generation: generation as never,
    };
    const attempt = { model_id: live as never, model_evidence: evidence };
    return [
      historyModelConflicts(history, attempt),
      linkedReplyModel(attempt, history),
    ];
  });
  assert.deepEqual(
    expected,
    cases.map((item) => [item[5], item[6]]),
  );
  const run = pythonReference(
    [
      "-c",
      [
        "import json,sys",
        "from aift.timing_evidence import history_model_conflicts, linked_reply_model",
        "print(json.dumps([[history_model_conflicts({'site':s,'model_id':h,'generation':g},{'model_id':a,'model_evidence':e}),linked_reply_model({'model_id':a,'model_evidence':e},{'site':s,'model_id':h,'generation':g})] for s,h,g,a,e,_,_m in json.load(sys.stdin)]))",
      ].join("\n"),
    ],
    { input: JSON.stringify(cases) },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), expected);
});

test("W9 review: only NotebookLM saved rows lack a live request, TS and Python", () => {
  const studio = ["no_live_request" as const];
  const cases = [
    { kind: "history", valid: true, value: history({ site: "notebooklm", coverage_reasons: studio }) },
    // A saved NotebookLM chat turn (since 14 Oct 2026) waits for a live match.
    { kind: "history", valid: true, value: history({ site: "notebooklm" }) },
    // Elsewhere the reason would exempt a row from live matching and hide a double count.
    { kind: "history", valid: false, value: history({ site: "claude", coverage_reasons: studio }) },
    { kind: "history", valid: false, value: history({ site: "perplexity", coverage_reasons: studio }) },
    { kind: "history", valid: true, value: history({ site: "claude" }) },
    // A live record is a live request.
    { kind: "attempt", valid: false, value: { ...attempt(), coverage_reasons: studio } },
    { kind: "attempt", valid: true, value: attempt() },
  ];
  for (const item of cases)
    assert.equal(
      item.kind === "history"
        ? HistoryMessageSchema.safeParse(item.value).success
        : AttemptObservationSchema.safeParse(item.value).success,
      item.valid,
      JSON.stringify([item.kind, (item.value as { site?: string }).site]),
    );
  const code = [
    "import json,sys",
    "from footprint_contracts import validate_history_page,validate_observation,ContractError",
    "out=[]",
    "for case in json.load(sys.stdin):",
    "  try:",
    "    if case['kind']=='history':",
    "      v=case['value']",
    "      validate_history_page({'schema_version':'3.0.0','site':v['site'],'conversation_key':v['conversation_key'],'observed_at':v['observed_at'],'deletion_epoch':0,'messages':[v],'branch_scope':'unknown','selected_leaf_key':None,'branch_message_keys':None,'root_message_key':None,'first_request_verified':False,'has_earlier':None,'has_later':None})",
    "    else:",
    "      validate_observation(case['value'])",
    "    out.append(True)",
    "  except ContractError:",
    "    out.append(False)",
    "print(json.dumps(out))",
  ].join("\n");
  const run = pythonReference(["-c", code], { input: JSON.stringify(cases) });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(
    JSON.parse(run.stdout),
    cases.map((item) => item.valid),
  );
});
