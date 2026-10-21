import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Ledger } from "@footprint/ledger";
import { initialSnapshot, type Snapshot } from "@footprint/adapters";
import {
  unknownMeasurement,
  type AttemptObservation,
  type RequestObservation,
  type TokenMeasurement,
} from "@footprint/contracts";
import type { CountRequest } from "@footprint/tokenizers";
import { Coordinator } from "../lib/coordinator";
import { validateCapture } from "../lib/bridge";
import {
  applyProviderUsage,
  imageMedia,
  initialReplyTokens,
  retainedCount,
  snapshotMedia,
} from "../lib/reply-output";
import { emptyTokenFields } from "@footprint/contracts";
import { countByTextLength, unavailableCount } from "./counting-fixture";

const counted = (value: string): TokenMeasurement => ({
  value,
  evidence: "heuristic_estimate",
  scope: "observed_text",
  completeness: "complete_for_scope",
  profile_id: "o200k-base-4.0.0-reference",
  reason: "tokenizer_mapping_unverified",
});

test("X9 a failed or lower recount never erases or lowers a known count", () => {
  const known = counted("120");
  // A failed recount of unchanged text keeps the count as it was.
  assert.deepEqual(retainedCount(known, undefined, false), known);
  // A failed recount after the text grew keeps the value as a lower bound.
  assert.deepEqual(
    retainedCount(known, unknownMeasurement("tokenizer_unavailable"), true),
    { ...known, completeness: "partial", reason: "tokenizer_unavailable" },
  );
  // A lower count of the same profile keeps the higher one; a higher one replaces it.
  assert.deepEqual(retainedCount(known, counted("80"), true), known);
  assert.deepEqual(retainedCount(known, counted("150"), true), counted("150"));
  // Nothing known yet: the failure stays visible as unknown.
  assert.equal(
    retainedCount(unknownMeasurement(), undefined, true).reason,
    "tokenizer_unavailable",
  );
});

test("parts the adapter does not read stay unknown with their reason", () => {
  const tokens = initialReplyTokens(emptyTokenFields());
  assert.equal(tokens.visible_thinking.reason, "observed_text_only");
  assert.equal(tokens.tool_input.reason, "tool_work_unobserved");
  assert.equal(tokens.intermediate_output.reason, "observed_text_only");
  assert.equal(tokens.tool_output.reason, "tool_work_unobserved");
  assert.equal(tokens.answer_output.value, null);
});

test("provider usage gives exact totals, reasoning and the input split", () => {
  const tokens = applyProviderUsage(initialReplyTokens(emptyTokenFields()), {
    output: 500,
    input: 100,
    cacheRead: 50,
    cacheWrite: 10,
    reasoning: 120,
  });
  assert.equal(tokens.output_total.value, "500");
  assert.equal(tokens.output_total.scope, "provider_request");
  assert.equal(tokens.reported_reasoning.value, "120");
  assert.equal(tokens.input_uncached.value, "100");
  assert.equal(tokens.input_cache_read.value, "50");
  assert.equal(tokens.input_cache_write.value, "10");
  assert.equal(tokens.logical_input_total.value, "160");
  const partial = applyProviderUsage(emptyTokenFields(), {
    output: 7,
    input: 3,
    cacheRead: null,
    cacheWrite: null,
    reasoning: null,
  });
  // Without the cache split the logical input is not known exactly.
  assert.equal(partial.logical_input_total.value, null);
  assert.equal(partial.reported_reasoning.value, null);
});

test("D1 image operations become images per returned size, or one started image", () => {
  const labels = new Set<string>();
  const items = imageMedia(
    "perplexity",
    [
      {
        id: "a",
        parentId: null,
        kind: "text_to_image",
        requestedCount: 2,
        model: "nanobanana",
        outputs: [
          { id: "1", width: 1024, height: 1024 },
          { id: "2", width: 1024, height: 1024 },
          { id: "3", width: 1536, height: null },
        ],
        state: "completed",
      },
      {
        id: "b",
        parentId: null,
        kind: "text_to_image",
        requestedCount: null,
        model: "brand-new-image-model",
        outputs: [],
        state: "failed",
      },
    ],
    labels,
  );
  assert.deepEqual(items, [
    {
      kind: "image",
      model_id: "perplexity-nano-banana",
      count: "2",
      width: 1024,
      height: 1024,
      outcome: "returned",
    },
    {
      kind: "image",
      model_id: "perplexity-nano-banana",
      count: "1",
      width: null,
      height: null,
      outcome: "returned",
    },
    {
      kind: "image",
      model_id: null,
      count: "1",
      width: null,
      height: null,
      outcome: "started_not_returned",
    },
  ]);
  assert.deepEqual([...labels], ["brand-new-image-model"]);
});

test("D3 video and speech facts keep what the page shows and resolve video models", () => {
  const labels = new Set<string>();
  const media = snapshotMedia(
    "perplexity",
    [
      {
        kind: "video",
        model: "veo31",
        width: null,
        height: null,
        durationSeconds: 8,
        withAudio: null,
      },
      {
        kind: "video",
        model: "unheard-video-model",
        width: 1280,
        height: 720,
        durationSeconds: null,
        withAudio: false,
      },
      {
        kind: "speech",
        basis: "audio_frames",
        seconds: 24.576,
        characters: null,
      },
      { kind: "speech", basis: "characters", seconds: null, characters: 55 },
      { kind: "video_overview", durationSeconds: 86.83 },
    ],
    labels,
  );
  assert.deepEqual(media, [
    {
      kind: "video",
      model_id: "perplexity-veo-3-1",
      width: null,
      height: null,
      duration_seconds: "8",
      with_audio: null,
    },
    {
      kind: "video",
      model_id: "perplexity-video-unlisted",
      width: 1280,
      height: 720,
      duration_seconds: null,
      with_audio: false,
    },
    {
      kind: "speech",
      length_basis: "audio_frames",
      seconds: "24.576",
      characters: null,
    },
    {
      kind: "speech",
      length_basis: "characters",
      seconds: null,
      characters: "55",
    },
    { kind: "video_overview", duration_seconds: "86.83" },
  ]);
  assert.deepEqual([...labels], ["unheard-video-model"]);
});

const sender = {
  tab: { id: 7 },
  frameId: 0,
  documentId: "reply-output",
  url: "https://claude.ai/chat/fixture",
};
function frames(snapshot: Snapshot) {
  const id = crypto.randomUUID(),
    at = new Date().toISOString();
  const base: any = {
    channel: "ai-footprint-observation-v1",
    version: 1,
    id,
    site: "claude",
    at,
    failure: null,
    timing: null,
  };
  return {
    dispatch: {
      ...base,
      revision: 1,
      event: "dispatch",
      dispatch: {
        site: "claude",
        action: "send",
        input: "four",
        conversationId: crypto.randomUUID(),
        parentId: null,
        requestId: crypto.randomUUID(),
        model: "claude-opus-5-5",
        attachments: 0,
        imageEditParentId: null,
      },
      snapshot: initialSnapshot(),
    },
    progress: (revision: number, value: Snapshot) => ({
      ...base,
      revision,
      event: "progress",
      dispatch: null,
      snapshot: value,
    }),
    end: (revision: number, value: Snapshot = snapshot) => ({
      ...base,
      revision,
      event: "end",
      dispatch: null,
      snapshot: value,
    }),
  };
}
function reply(extra: Partial<Snapshot> = {}): Snapshot {
  return {
    ...initialSnapshot(),
    text: "hello",
    thinking: "think",
    outputId: crypto.randomUUID(),
    model: "claude-opus-5-5",
    started: true,
    state: "completed",
    ...extra,
  };
}
async function attemptAfter(
  count: (request: CountRequest) => Promise<any>,
  run: (coordinator: Coordinator) => Promise<void>,
): Promise<AttemptObservation> {
  const ledger = await Ledger.open("reply-output-" + crypto.randomUUID());
  try {
    const coordinator = new Coordinator(ledger, {
      hasConsent: async () => true,
      sendDisplay: async () => {},
      count,
    });
    await run(coordinator);
    const scope = await coordinator.currentScope();
    const row = (await ledger.rows(scope.namespace)).find(
      (item) => item.record.kind === "attempt",
    )!;
    return row.record as AttemptObservation;
  } finally {
    ledger.close();
  }
}

test("A1 D2 every generated part is counted and the total is their sum", async () => {
  const snapshot = reply({
    toolInput: "abc",
    intermediate: "",
    toolOutput: "xy",
    components: [
      {
        role: "side_calls",
        model: "claude-haiku-4-5",
        text: null,
        outputTokens: 40,
      },
      {
        role: "research",
        model: "claude-brand-new",
        text: "report",
        outputTokens: null,
      },
    ],
    media: [
      {
        kind: "speech",
        basis: "stored_length",
        seconds: 12.5,
        characters: null,
      },
    ],
  });
  const flow = frames(snapshot);
  const attempt = await attemptAfter(countByTextLength, async (coordinator) => {
    await coordinator.capture(flow.dispatch, sender);
    await coordinator.capture(flow.end(2), sender);
  });
  assert.equal(attempt.tokens.new_input_text.value, "4");
  assert.equal(attempt.tokens.answer_output.value, "5");
  assert.equal(attempt.tokens.visible_thinking.value, "5");
  assert.equal(attempt.tokens.tool_input.value, "3");
  assert.equal(attempt.tokens.intermediate_output.value, "0");
  assert.equal(attempt.tokens.tool_output.value, "2");
  assert.equal(attempt.tokens.output_total.value, "13");
  assert.equal(attempt.tokens.output_total.completeness, "complete_for_scope");
  assert.deepEqual(
    attempt.generation.text_components.map((c) => [
      c.role,
      c.model_id,
      c.tokens.value,
      c.tokens.evidence,
    ]),
    [
      ["side_calls", "claude-haiku-4-5", "40", "provider_reported"],
      ["research", "claude-unlisted", "6", "heuristic_estimate"],
    ],
  );
  assert.deepEqual(attempt.generation.media, [
    {
      kind: "speech",
      length_basis: "stored_length",
      seconds: "12.5",
      characters: null,
    },
  ]);
});

test("D2 a part the adapter does not read leaves the total partial, never lower", async () => {
  const flow = frames(reply());
  const attempt = await attemptAfter(countByTextLength, async (coordinator) => {
    await coordinator.capture(flow.dispatch, sender);
    await coordinator.capture(flow.end(2), sender);
  });
  assert.equal(attempt.tokens.tool_input.value, null);
  assert.equal(attempt.tokens.tool_input.reason, "tool_work_unobserved");
  assert.equal(attempt.tokens.output_total.value, "10");
  assert.equal(attempt.tokens.output_total.completeness, "partial");
});

test("A1 exact provider usage replaces counted totals and reconstructed input", async () => {
  const flow = frames(
    reply({
      usage: {
        output: 500,
        input: 100,
        cacheRead: 50,
        cacheWrite: 10,
        reasoning: 120,
      },
    }),
  );
  const attempt = await attemptAfter(countByTextLength, async (coordinator) => {
    await coordinator.capture(flow.dispatch, sender);
    await coordinator.capture(flow.end(2), sender);
  });
  assert.equal(attempt.execution_evidence, "usage_reported");
  assert.equal(attempt.tokens.output_total.value, "500");
  assert.equal(attempt.tokens.output_total.evidence, "provider_reported");
  assert.equal(attempt.tokens.reported_reasoning.value, "120");
  assert.equal(attempt.tokens.logical_input_total.value, "160");
  assert.equal(
    attempt.tokens.logical_input_total.evidence,
    "provider_reported",
  );
  assert.ok(!attempt.coverage_reasons.includes("provider_usage_unavailable"));
  // The visible parts are still counted for Details.
  assert.equal(attempt.tokens.answer_output.value, "5");
});

test("X9 a failed final count keeps the progress count as a lower bound", async () => {
  let calls = 0;
  const flaky = async (request: CountRequest) =>
    ++calls <= 2 ? countByTextLength(request) : unavailableCount(request);
  const flow = frames(reply());
  const attempt = await attemptAfter(flaky, async (coordinator) => {
    await coordinator.capture(flow.dispatch, sender);
    await coordinator.capture(
      flow.progress(2, { ...reply(), state: "generating" }),
      sender,
    );
    await coordinator.capture(
      flow.end(3, reply({ text: "hello world" })),
      sender,
    );
  });
  assert.equal(attempt.tokens.answer_output.value, "5");
  assert.equal(attempt.tokens.answer_output.completeness, "partial");
  assert.equal(attempt.tokens.answer_output.reason, "tokenizer_unavailable");
  // Unchanged thinking keeps its complete count.
  assert.equal(
    attempt.tokens.visible_thinking.completeness,
    "complete_for_scope",
  );
});

test("X9 generated text the adapter can no longer read keeps its earlier count as a lower bound", async () => {
  const flow = frames(reply());
  const attempt = await attemptAfter(countByTextLength, async (coordinator) => {
    await coordinator.capture(flow.dispatch, sender);
    await coordinator.capture(
      flow.progress(
        2,
        reply({ state: "generating", toolInput: "abc", intermediate: "" }),
      ),
      sender,
    );
    // The tool input grew past the field limit, so the adapter left it out.
    await coordinator.capture(
      flow.end(3, reply({ intermediate: "", toolOutput: "xy" })),
      sender,
    );
  });
  assert.equal(attempt.tokens.tool_input.value, "3");
  assert.equal(attempt.tokens.tool_input.completeness, "partial");
  assert.equal(attempt.tokens.tool_input.reason, "partial_capture");
  assert.equal(attempt.tokens.output_total.completeness, "partial");
  // A part never read stays unknown with its own reason; one read throughout is complete.
  assert.equal(
    attempt.tokens.intermediate_output.completeness,
    "complete_for_scope",
  );
  assert.equal(attempt.tokens.tool_output.value, "2");
});

test("D7 E1 unknown stream events and research runs become coverage reasons of the reply", async () => {
  const flow = frames(reply());
  const attempt = await attemptAfter(countByTextLength, async (coordinator) => {
    await coordinator.capture(flow.dispatch, sender);
    await coordinator.capture(
      flow.end(
        2,
        reply({
          limitations: [
            "hidden_reasoning_unknown",
            "unknown_event_observed",
            "research_work_unobserved",
          ],
        }),
      ),
      sender,
    );
  });
  assert.ok(attempt.coverage_reasons.includes("unknown_event_observed"));
  assert.ok(attempt.coverage_reasons.includes("research_work_unobserved"));
  // Other limitations stay snapshot facts, not reasons of the reply.
  assert.ok(
    !(attempt.coverage_reasons as string[]).includes(
      "hidden_reasoning_unknown",
    ),
  );
});

test("the bridge admits bounded generated text and rejects malformed fields", () => {
  const message = (snapshot: object) => ({
    channel: "ai-footprint-observation-v1",
    version: 1,
    id: crypto.randomUUID(),
    revision: 2,
    event: "progress",
    site: "claude",
    at: new Date().toISOString(),
    dispatch: null,
    snapshot: { ...initialSnapshot(), ...snapshot },
    failure: null,
    timing: null,
  });
  const valid = {
    toolInput: "abc",
    intermediate: "",
    toolOutput: "",
    usage: {
      output: 5,
      input: null,
      cacheRead: null,
      cacheWrite: null,
      reasoning: 2,
    },
    components: [
      { role: "storyboard", model: null, text: "x", outputTokens: null },
    ],
    media: [
      {
        kind: "video",
        model: null,
        width: null,
        height: null,
        durationSeconds: null,
        withAudio: null,
      },
      { kind: "speech", basis: "characters", seconds: null, characters: 55 },
      { kind: "video_overview", durationSeconds: 87 },
    ],
  };
  assert.ok(validateCapture(message(valid), "claude.ai"));
  for (const invalid of [
    { toolInput: 3 },
    {
      usage: {
        output: 5,
        input: null,
        cacheRead: null,
        cacheWrite: null,
        reasoning: 9,
      },
    },
    {
      components: [
        { role: "storyboard", model: null, text: "x", outputTokens: 4 },
      ],
    },
    {
      components: [
        { role: "summary", model: null, text: "x", outputTokens: null },
      ],
    },
    {
      media: [
        { kind: "speech", basis: "characters", seconds: 3, characters: 55 },
      ],
    },
    {
      media: [
        {
          kind: "speech",
          basis: "audio_frames",
          seconds: null,
          characters: null,
        },
      ],
    },
    {
      media: [
        {
          kind: "video",
          model: null,
          width: 1280,
          height: null,
          durationSeconds: null,
          withAudio: null,
        },
      ],
    },
    { media: [{ kind: "video_overview", durationSeconds: 0 }] },
    { media: [{ kind: "music", durationSeconds: 30 }] },
    { secret: "x" },
  ])
    assert.equal(
      validateCapture(message(invalid), "claude.ai"),
      false,
      JSON.stringify(invalid),
    );
  // Provider usage is read only on Claude.
  const chatgpt = { ...message({ usage: valid.usage }), site: "chatgpt" };
  assert.equal(validateCapture(chatgpt, "chatgpt.com"), false);
});

test("D6 each unknown raw label of a reply is kept, even when both map to one unlisted id", async () => {
  const ledger = await Ledger.open("reply-labels-" + crypto.randomUUID());
  try {
    const coordinator = new Coordinator(ledger, {
      hasConsent: async () => true,
      sendDisplay: async () => {},
      count: countByTextLength,
    });
    const flow = frames(reply());
    await coordinator.capture(flow.dispatch, sender);
    await coordinator.capture(
      flow.progress(
        2,
        reply({ model: "claude-brand-new-a", state: "generating" }),
      ),
      sender,
    );
    await coordinator.capture(
      flow.progress(
        3,
        reply({ model: "claude-brand-new-a", state: "generating" }),
      ),
      sender,
    );
    await coordinator.capture(
      flow.end(4, reply({ model: "claude-brand-new-b" })),
      sender,
    );
    const scope = await coordinator.currentScope();
    const labels = await ledger.list<{ label: string; count: number }>(
      "model_labels",
      scope.namespace,
      32,
    );
    assert.deepEqual(labels.map((item) => [item.label, item.count]).sort(), [
      ["claude-brand-new-a", 1],
      ["claude-brand-new-b", 1],
    ]);
  } finally {
    ledger.close();
  }
});

test("A7 uploaded images are priced for the model that answered", async () => {
  const flow = frames(reply({ model: "claude-opus-4-7" }));
  // The selected model reads images at standard resolution; the reply names a
  // high-resolution one. One image hides its size.
  flow.dispatch.dispatch.model = "claude-sonnet-4-6";
  flow.dispatch.dispatch.inputImages = [
    { width: 1920, height: 1080 },
    { width: null, height: null },
  ];
  const ledger = await Ledger.open("reply-output-" + crypto.randomUUID());
  try {
    const coordinator = new Coordinator(ledger, {
      hasConsent: async () => true,
      sendDisplay: async () => {},
      count: countByTextLength,
    });
    const read = async () => {
      const scope = await coordinator.currentScope();
      const rows = await ledger.rows(scope.namespace);
      return {
        request: rows.find((row) => row.record.kind === "request")!
          .record as RequestObservation,
        attempt: rows.find((row) => row.record.kind === "attempt")!
          .record as AttemptObservation,
      };
    };
    await coordinator.capture(flow.dispatch, sender);
    let { request, attempt } = await read();
    assert.ok(request.features.includes("image_input"));
    assert.deepEqual(
      request.media.input_images.map((image) => [
        image.origin,
        image.width,
        image.tokens.value,
        image.tokens.reason,
      ]),
      [
        ["new_upload", 1920, "1560", "image_settings_unknown"],
        ["new_upload", null, null, "image_dimensions_unknown"],
      ],
    );
    assert.equal(attempt.tokens.image_input_tokens.value, "1560");
    assert.equal(attempt.tokens.image_input_tokens.completeness, "partial");
    await coordinator.capture(flow.end(2), sender);
    ({ request, attempt } = await read());
    assert.deepEqual(
      request.media.input_images.map((image) => image.tokens.value),
      ["2691", null],
    );
    assert.equal(attempt.tokens.image_input_tokens.value, "2691");
    assert.equal(
      attempt.tokens.image_input_tokens.profile_id,
      "vendor-image-rules-1",
    );
  } finally {
    ledger.close();
  }
});

test("A7 an adapter that finds no uploaded images reports image input as not applicable", async () => {
  const flow = frames(reply());
  flow.dispatch.dispatch.inputImages = [];
  const attempt = await attemptAfter(countByTextLength, async (coordinator) => {
    await coordinator.capture(flow.dispatch, sender);
    await coordinator.capture(flow.end(2), sender);
  });
  assert.equal(attempt.tokens.image_input_tokens.evidence, "not_applicable");
  // An adapter that does not read attachments leaves image input unknown.
  const unread = await attemptAfter(countByTextLength, async (coordinator) => {
    const other = frames(reply());
    await coordinator.capture(other.dispatch, sender);
    await coordinator.capture(other.end(2), sender);
  });
  assert.equal(unread.tokens.image_input_tokens.evidence, "unknown");
});
