import assert from "node:assert/strict";
import test from "node:test";
import type {
  CoworkCumulative,
  HistoryTextMessage,
  HistoryTextPage,
} from "@footprint/adapters";
import {
  coworkCheckpointAfter,
  coworkCounted,
  coworkHandedOver,
  coworkTurns,
} from "../lib/cowork-turns";
import { validHistoryTextPage } from "../lib/history-capture";

const SESSION = "cse_0123456789ABCDEFghijklmn";
const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const SONNET = "claude-sonnet-5-5";
const HAIKU = "claude-haiku-4-5-20251001";

function reply(
  n: number,
  cumulative: CoworkCumulative,
  modelId: string | null = SONNET,
): HistoryTextMessage {
  return {
    sourceId: id(n),
    role: "response",
    promptSourceId: id(n - 1),
    parentSourceId: id(n - 1),
    parentRole: "prompt",
    requestId: null,
    liveAttemptId: null,
    timing: null,
    occurredAt: "2026-10-01T10:00:00.000Z",
    dateBasis: "message_created",
    modelId,
    text: `answer ${n}`,
    complete: true,
    inlineFiles: null,
    cumulative,
  };
}
function prompt(n: number): HistoryTextMessage {
  return {
    sourceId: id(n),
    role: "prompt",
    promptSourceId: id(n),
    parentSourceId: null,
    parentRole: null,
    requestId: null,
    liveAttemptId: null,
    timing: null,
    occurredAt: "2026-10-01T10:00:00.000Z",
    dateBasis: "message_created",
    modelId: null,
    text: `prompt ${n}`,
    complete: true,
    inlineFiles: null,
  };
}
const counters = (
  sequence: number,
  sonnet: [number, number | null],
  haiku: [number, number | null] | null,
  apiMs: number | null,
): CoworkCumulative => ({
  sequence,
  models: [
    { model: SONNET, output: sonnet[0], reasoning: sonnet[1] },
    ...(haiku ? [{ model: HAIKU, output: haiku[0], reasoning: haiku[1] }] : []),
  ],
  apiMs,
});
const page = (messages: HistoryTextMessage[]): HistoryTextPage => ({
  site: "claude",
  conversationId: SESSION,
  observedAt: "2026-10-04T12:00:00.000Z",
  messages,
  firstRequestVerified: false,
  rootSourceId: null,
  selectedLeafId: null,
  branchSourceIds: null,
  branchScope: "loaded_messages",
  hasEarlier: null,
  hasLater: null,
  status: "partial",
});

test("each Cowork turn gets the difference of the session's counters, split by model", () => {
  const first = counters(4, [200, 30], [10, null], 2924);
  const second = counters(9, [433, 80], [10, null], 7261);
  const input = page([prompt(3), reply(4, first), prompt(8), reply(9, second)]);
  const out = coworkTurns(input, null);
  assert.equal(validHistoryTextPage(out), true);
  assert.deepEqual(
    out.messages.map((m) => [m.role, m.sourceId]),
    input.messages.map((m) => [m.role, m.sourceId]),
  );
  const [, a, , b] = out.messages;
  // Without a checkpoint the first turn carries everything before it.
  assert.deepEqual(a!.usage, {
    output: 200,
    input: null,
    cacheRead: null,
    cacheWrite: null,
    reasoning: 30,
  });
  assert.deepEqual(a!.components, [
    { role: "side_calls", model: HAIKU, text: null, outputTokens: 10 },
  ]);
  assert.equal(a!.modelId, SONNET);
  assert.deepEqual(a!.timing, {
    duration_seconds: "2.924",
    source: "cowork_history",
    scope: "provider_message",
    completeness: "complete_for_scope",
    profile_version: "timing-observation-1",
  });
  assert.equal(b!.usage!.output, 233);
  assert.equal(b!.usage!.reasoning, 50);
  // A model that wrote nothing new in this turn adds no component.
  assert.deepEqual(b!.components, []);
  assert.equal(b!.timing!.duration_seconds, "4.337");
  // The counters stay on the reply; they become the checkpoint once it is saved.
  assert.deepEqual(b!.cumulative, second);
  assert.deepEqual(coworkCheckpointAfter(out.messages), second);
  assert.equal(coworkCheckpointAfter([]), null);
  // The input page is not changed.
  assert.equal(input.messages[1]!.usage, undefined);
});

test("results at or before the checkpoint are already counted and leave the page; prompts stay", () => {
  const saved = counters(9, [433, 80], [10, null], 7261);
  const out = coworkTurns(
    page([
      prompt(3),
      reply(4, counters(4, [200, 30], [10, null], 2924)),
      prompt(8),
      reply(9, saved),
      prompt(11),
      reply(12, counters(12, [500, 80], [25, null], 9000)),
    ]),
    saved,
  );
  assert.deepEqual(
    out.messages.map((m) => [m.role, m.sourceId]),
    [
      ["prompt", id(3)],
      ["prompt", id(8)],
      ["prompt", id(11)],
      ["response", id(12)],
    ],
  );
  const turn = out.messages[3]!;
  assert.equal(turn.usage!.output, 67);
  assert.equal(turn.usage!.reasoning, 0);
  assert.deepEqual(turn.components, [
    { role: "side_calls", model: HAIKU, text: null, outputTokens: 15 },
  ]);
  assert.equal(turn.timing!.duration_seconds, "1.739");
});

// Live check of 23 Nov 2026: a result in which no model ran (after a Research report note)
// repeated the session's counters with a lower API time. It was taken for a restart and
// counted from zero, which added the whole session a second time (Out 10,459 for 5,235).
// A session's counters never restart, so nothing is counted from zero once a checkpoint exists.
test("a result in which no model wrote since the checkpoint adds no row, and nothing is ever counted from zero again", () => {
  const saved = counters(9, [433, 80], [10, null], 7261);
  const idle = counters(12, [433, 80], [10, null], 0);
  // The result and the prompt it names add nothing, and the checkpoint stays.
  const alone = coworkTurns(page([prompt(11), reply(12, idle)]), saved);
  assert.deepEqual(alone.messages, []);
  assert.equal(coworkCheckpointAfter(alone.messages), null);
  // The same within one read, after the result it repeats.
  const first = counters(4, [200, 30], [10, null], 2924);
  const whole = coworkTurns(
    page([prompt(3), reply(4, first), prompt(11), reply(12, { ...first, sequence: 12, apiMs: 0 })]),
    null,
  );
  assert.deepEqual(
    whole.messages.map((m) => [m.role, m.sourceId]),
    [
      ["prompt", id(3)],
      ["response", id(4)],
    ],
  );
  assert.deepEqual(coworkCheckpointAfter(whole.messages), first);
  // The result after it is measured from the checkpoint, as if the idle one were not there.
  const next = counters(14, [500, 90], [25, null], 9000);
  const after = coworkTurns(
    page([prompt(11), reply(12, idle), prompt(13), reply(14, next)]),
    saved,
  );
  assert.deepEqual(
    after.messages.map((m) => [m.role, m.sourceId]),
    [
      ["prompt", id(13)],
      ["response", id(14)],
    ],
  );
  assert.equal(after.messages[1]!.usage!.output, 67);
  assert.equal(after.messages[1]!.usage!.reasoning, 10);
  assert.equal(after.messages[1]!.timing!.duration_seconds, "1.739");
  assert.deepEqual(coworkCheckpointAfter(after.messages), next);
  // A prompt that a counted reply also names stays.
  const shared = coworkTurns(
    page([prompt(11), reply(12, idle), { ...reply(14, next), promptSourceId: id(11) }]),
    saved,
  );
  assert.deepEqual(
    shared.messages.map((m) => [m.role, m.sourceId]),
    [
      ["prompt", id(11)],
      ["response", id(14)],
    ],
  );
  // Counters below the checkpoint's were never seen. They add nothing where they are lower,
  // never the session again, and what cannot be a count stays unknown.
  const turn = (current: CoworkCumulative) =>
    coworkTurns(page([prompt(11), reply(12, current)]), saved).messages[1];
  assert.equal(turn(counters(12, [50, 5], [10, null], 9000)), undefined);
  const lessThinking = turn(counters(12, [500, 5], [10, null], 9000))!;
  assert.equal(lessThinking.usage!.output, 67);
  assert.equal(lessThinking.usage!.reasoning, null);
  const modelGone = turn(counters(12, [500, 90], null, 9000))!;
  assert.equal(modelGone.usage!.output, 67);
  assert.deepEqual(modelGone.components, []);
  const lessTime = turn(counters(12, [500, 90], [10, null], 1000))!;
  assert.equal(lessTime.usage!.output, 67);
  assert.equal(lessTime.timing, null);
});

test("the main model is the session's model, matched without date suffixes, else the largest writer", () => {
  const cumulative: CoworkCumulative = {
    sequence: 5,
    models: [
      { model: "claude-sonnet-5-5-20260901", output: 40, reasoning: null },
      { model: HAIKU, output: 90, reasoning: null },
    ],
    apiMs: 1000,
  };
  const named = coworkTurns(
    page([reply(5, cumulative, "claude-sonnet-5-5")]),
    null,
  ).messages[0]!;
  assert.equal(named.modelId, "claude-sonnet-5-5-20260901");
  assert.equal(named.usage!.output, 40);
  assert.deepEqual(named.components, [
    { role: "side_calls", model: HAIKU, text: null, outputTokens: 90 },
  ]);
  const unnamed = coworkTurns(page([reply(5, cumulative, null)]), null)
    .messages[0]!;
  assert.equal(unnamed.modelId, HAIKU);
  assert.equal(unnamed.usage!.output, 90);
  const other = coworkTurns(
    page([reply(5, cumulative, "claude-opus-5-5")]),
    null,
  ).messages[0]!;
  assert.equal(other.modelId, HAIKU);
});

test("thinking stays unknown where either counter lacks it, and timing needs both API times", () => {
  const saved = counters(4, [100, null], null, null);
  const [turn] = coworkTurns(
    page([reply(9, counters(9, [150, 20], null, 5000))]),
    saved,
  ).messages;
  assert.equal(turn!.usage!.output, 50);
  assert.equal(turn!.usage!.reasoning, null);
  assert.equal(turn!.timing, null);
  // An incomplete answer has no complete timing.
  const incomplete = {
    ...reply(5, counters(5, [10, 1], null, 800)),
    complete: false,
    text: null,
  };
  assert.equal(coworkTurns(page([incomplete]), null).messages[0]!.timing, null);
  // No new API time means no timing.
  const same = counters(9, [150, 20], null, 5000);
  const [still] = coworkTurns(
    page([reply(10, counters(10, [160, 20], null, 5000))]),
    same,
  ).messages;
  assert.equal(still!.usage!.output, 10);
  assert.equal(still!.timing, null);
});

test("only Cowork replies carry counters, and only Cowork pages carry Cowork timing", () => {
  const cumulative = counters(4, [200, 30], [10, null], 2924);
  const cowork = page([prompt(3), reply(4, cumulative)]);
  assert.equal(validHistoryTextPage(cowork), true);
  // A Cowork reply without counters, counters on a prompt or in another shape fail.
  const { cumulative: _drop, ...bare } = reply(4, cumulative);
  assert.equal(validHistoryTextPage(page([bare as HistoryTextMessage])), false);
  assert.equal(
    validHistoryTextPage(page([{ ...prompt(3), cumulative }])),
    false,
  );
  assert.equal(
    validHistoryTextPage(page([reply(4, { ...cumulative, models: [] })])),
    false,
  );
  // A Claude chat never carries counters or Cowork timing.
  const chat = (messages: HistoryTextMessage[]) => ({
    ...page(messages),
    conversationId: "00000000-0000-4000-8000-000000000042",
  });
  assert.equal(validHistoryTextPage(chat([reply(4, cumulative)])), false);
  const timed = coworkTurns(cowork, null).messages[1]!;
  assert.equal(timed.timing!.source, "cowork_history");
  const { cumulative: _c, ...plain } = timed;
  assert.equal(
    validHistoryTextPage(chat([plain as HistoryTextMessage])),
    false,
  );
  assert.equal(
    validHistoryTextPage(
      page([
        prompt(3),
        {
          ...timed,
          timing: {
            ...timed.timing!,
            source: "claude_history",
            scope: "content_blocks",
          },
        },
      ]),
    ),
    false,
  );
});

test("more than 16 other models are counted as far as listed and the rest is noted", () => {
  const models = [
    { model: SONNET, output: 100, reasoning: null },
    ...Array.from({ length: 18 }, (_, i) => ({
      model: `side-model-${i}`,
      output: i + 1,
      reasoning: null,
    })),
  ];
  const [turn] = coworkTurns(
    page([reply(5, { sequence: 5, models: models.slice(0, 19), apiMs: 1 })]),
    null,
  ).messages;
  assert.equal(turn!.components!.length, 16);
  // The largest side calls are kept.
  assert.equal(turn!.components![0]!.outputTokens, 18);
  assert.deepEqual(turn!.coverageReasons, ["side_calls_unobserved"]);
});

// Owner decision of 23 Nov 2026: a turn's input is everything Claude processed in it, the
// difference of the session's three input counters between two results.
test("a turn's exact input is the difference of the three input counters, or unknown", () => {
  const withInputs = (
    cumulative: CoworkCumulative,
    fresh: number,
    cacheWrite: number,
    cacheRead: number,
  ): CoworkCumulative => ({
    ...cumulative,
    inputs: { fresh, cacheWrite, cacheRead },
  });
  const first = withInputs(counters(4, [200, 30], null, 2924), 100, 2000, 0);
  const second = withInputs(
    counters(9, [433, 80], null, 7261),
    130,
    2500,
    4000,
  );
  const exact = (message: HistoryTextMessage | undefined) => [
    message!.usage!.input,
    message!.usage!.cacheWrite,
    message!.usage!.cacheRead,
  ];
  const turn = (current: CoworkCumulative, saved: CoworkCumulative | null) =>
    coworkTurns(page([prompt(8), reply(9, current)]), saved).messages[1];
  const out = coworkTurns(
    page([prompt(3), reply(4, first), prompt(8), reply(9, second)]),
    null,
  );
  assert.equal(validHistoryTextPage(out), true);
  // Without a checkpoint the first turn carries everything before it, as its output does.
  assert.deepEqual(exact(out.messages[1]), [100, 2000, 0]);
  assert.deepEqual(exact(out.messages[3]), [30, 500, 4000]);
  assert.deepEqual(coworkCheckpointAfter(out.messages), second);
  // From a saved checkpoint that holds the counters: the difference to it.
  assert.deepEqual(exact(turn(second, first)), [30, 500, 4000]);
  // A checkpoint saved before 23 Nov 2026 has no input counters. That turn's input stays
  // unknown and its output is exact as before.
  const old = counters(4, [200, 30], null, 2924);
  assert.deepEqual(exact(turn(second, old)), [null, null, null]);
  assert.equal(turn(second, old)!.usage!.output, 233);
  // A result without the counters leaves its turn's input unknown.
  assert.deepEqual(
    exact(turn(counters(9, [433, 80], null, 7261), first)),
    [null, null, null],
  );
  // A counter below the checkpoint's, in a session that did not restart, is no count.
  assert.deepEqual(
    exact(
      turn(withInputs(counters(9, [433, 80], null, 7261), 130, 1999, 4000), first),
    ),
    [null, null, null],
  );
  // The same counters again, as a result in which no model ran reports them, add no row.
  assert.equal(turn({ ...first, sequence: 9, apiMs: 0 }, first), undefined);
});

// Live probe of 23 Nov 2026: a turn that creates an artifact in an old chat moves the chat
// into a session mid-turn. Its result counts only the part after the handoff, while the
// chat's saved reply holds the whole reply and is counted by its text (owner decision of
// 23 Nov 2026: count that reply once, by text).
test("the converting turn adds no reply and no request, and the next turn counts only its own output", () => {
  const handed = { ...reply(4, counters(4, [300, 40], [10, null], 3000)), handoff: true as const };
  const next = reply(9, counters(9, [433, 80], [10, null], 7261));
  const input = page([prompt(3), handed, prompt(8), next]);
  // The adapter proved the session's start from the handed prompt.
  input.firstRequestVerified = true;
  input.rootSourceId = id(3);
  input.hasEarlier = false;
  const out = coworkTurns(input, null);
  assert.equal(validHistoryTextPage(out), true);
  assert.deepEqual(
    out.messages.map((m) => [m.role, m.sourceId]),
    [
      ["prompt", id(8)],
      ["response", id(9)],
    ],
  );
  assert.equal(out.messages[1]!.usage!.output, 133);
  assert.equal(out.messages[1]!.usage!.reasoning, 40);
  // The handed prompt is no row, so it cannot prove the start; the saved chat proves it.
  assert.equal(out.firstRequestVerified, false);
  assert.equal(out.rootSourceId, null);
  // The checkpoint moves past the converting turn even when nothing else is saved.
  const alone = coworkTurns(page([prompt(3), handed]), null);
  assert.deepEqual(alone.messages, []);
  assert.equal(validHistoryTextPage(alone), true);
  assert.deepEqual(coworkHandedOver(input, null), handed.cumulative);
  assert.equal(coworkHandedOver(input, handed.cumulative!), null);
  // Read again after it was saved, it stays out and is not queued as a counted reply.
  const again = coworkTurns(input, next.cumulative!);
  assert.deepEqual(
    again.messages.map((m) => [m.role, m.sourceId]),
    [["prompt", id(8)]],
  );
  assert.deepEqual(coworkCounted(input, next.cumulative!), [id(9)]);
});
