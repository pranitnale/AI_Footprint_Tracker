import test from "node:test";
import assert from "node:assert/strict";
import {
  CoworkEvents,
  coworkRequest,
  validCoworkCumulative,
} from "../src/history";

// Synthetic Cowork events in the shape seen on 1 Oct 2026 (structure only).
const SESSION = "cse_0123456789ABCDEFghijklmn";
const OBSERVED = "2026-10-04T12:00:00.000Z";
const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const envelope = (sequence: number | string, payload: unknown) => ({
  event_id: crypto.randomUUID(),
  sequence_num: String(sequence),
  event_type: "client_event",
  source: "server",
  payload,
  created_at: `2026-10-01T10:00:${String(Number(sequence) % 60).padStart(2, "0")}.000Z`,
});
const init = (model: string) => ({
  type: "system",
  subtype: "init",
  model,
  session_id: "synthetic",
});
const user = (n: number, content: unknown, extra: object = {}) => ({
  type: "user",
  uuid: id(n),
  parent_tool_use_id: null,
  message: { role: "user", content },
  ...extra,
});
const usage = (output: number, thinking?: number) => ({
  inputTokens: 3,
  outputTokens: output,
  ...(thinking === undefined ? {} : { thinkingTokens: thinking }),
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  costUSD: 0.01,
});
const result = (
  n: number,
  prompts: number[],
  modelUsage: unknown,
  extra: object = {},
) => ({
  type: "result",
  subtype: "success",
  uuid: id(n),
  user_message_uuids: prompts.map(id),
  duration_api_ms: n * 1000,
  duration_ms: 900,
  result: `Synthetic answer ${n}`,
  modelUsage,
  ...extra,
});

test("Cowork requests: the events list, the live stream and the page's send", () => {
  const url = (path: string) => new URL(`https://claude.ai${path}`);
  assert.deepEqual(
    coworkRequest(url(`/v1/code/sessions/${SESSION}/events?limit=100`), "GET"),
    { session: SESSION, kind: "events" },
  );
  assert.deepEqual(
    coworkRequest(
      url(`/v1/code/sessions/${SESSION}/events/stream?from_sequence_num=7`),
      "GET",
    ),
    { session: SESSION, kind: "stream" },
  );
  assert.deepEqual(
    coworkRequest(url(`/v1/code/sessions/${SESSION}/events`), "POST"),
    { session: SESSION, kind: "send" },
  );
  for (const [path, method] of [
    [`/v1/code/sessions/${SESSION}/events`, "PUT"],
    [`/v1/code/sessions/${SESSION}/events/stream`, "POST"],
    [`/v1/code/sessions/${SESSION}`, "GET"],
    ["/v1/code/sessions?tags=cowork-remote", "GET"],
    [`/v1/code/sessions/cse_short/events`, "GET"],
    [`/api/v1/code/sessions/${SESSION}/events`, "GET"],
  ])
    assert.equal(coworkRequest(url(path), method), null, `${method} ${path}`);
});

test("a Cowork list becomes prompts and replies in event order with each result's counters", () => {
  const events = new CoworkEvents();
  // The list arrives newest first.
  const list = [
    envelope(
      9,
      result(
        9,
        [8],
        {
          "claude-sonnet-5-5": usage(300, 40),
          "claude-haiku-4-5-20251001": usage(10),
        },
        { result: undefined },
      ),
    ),
    envelope(8, user(8, "Second synthetic prompt")),
    envelope(
      7,
      result(7, [2], {
        "claude-sonnet-5-5": usage(200, 30),
        "claude-haiku-4-5-20251001": usage(10),
      }),
    ),
    envelope(
      6,
      user(6, [{ type: "tool_result", tool_use_id: "t", content: "x" }]),
    ),
    envelope(5, { type: "assistant", message: { content: [] } }),
    envelope(
      4,
      user(4, [{ type: "text", text: "to a sub-agent" }], {
        parent_tool_use_id: "toolu_1",
      }),
    ),
    envelope(3, { type: "stream_event", event: {} }),
    envelope(
      2,
      user(2, [
        { type: "text", text: "First synthetic prompt" },
        { type: "image", source: { type: "base64", data: "AAAA" } },
      ]),
    ),
    envelope(1, init("claude-sonnet-5-5")),
  ];
  for (const item of list) assert.equal(events.add(item), true);
  assert.equal(events.pending, true);
  const page = events.page(SESSION, OBSERVED);
  assert.equal(page.status, "partial");
  assert.equal(page.site, "claude");
  assert.equal(page.conversationId, SESSION);
  assert.deepEqual(
    page.messages.map((m) => [m.role, m.sourceId]),
    [
      ["prompt", id(2)],
      ["response", id(7)],
      ["prompt", id(8)],
      ["response", id(9)],
    ],
  );
  const [first, reply, , last] = page.messages;
  assert.equal(first!.text, "First synthetic prompt");
  assert.equal(first!.complete, true);
  assert.deepEqual(first!.inputImages, [{ width: null, height: null }]);
  assert.equal(first!.dateBasis, "message_created");
  assert.equal(reply!.promptSourceId, id(2));
  assert.equal(reply!.parentSourceId, id(2));
  assert.equal(reply!.parentRole, "prompt");
  assert.equal(reply!.modelId, "claude-sonnet-5-5");
  assert.equal(reply!.text, "Synthetic answer 7");
  assert.equal(reply!.complete, true);
  assert.deepEqual(reply!.cumulative, {
    sequence: 7,
    models: [
      { model: "claude-sonnet-5-5", output: 200, reasoning: 30 },
      { model: "claude-haiku-4-5-20251001", output: 10, reasoning: null },
    ],
    apiMs: 7000,
  });
  // A result without its final text wrote none.
  assert.equal(last!.text, "");
  assert.equal(last!.complete, true);
  assert.equal(validCoworkCumulative(reply!.cumulative), true);
  // Results are reported once; the named prompts are used up.
  assert.equal(events.pending, false);
  assert.deepEqual(events.page(SESSION, OBSERVED).messages, []);
  assert.throws(
    () => events.page("00000000-0000-4000-8000-000000000001", OBSERVED),
    /history_unsupported/,
  );
});

test("a Cowork read of every event from the session's start proves its first request (6 Oct)", () => {
  // Seen live on 6 Oct 2026: events number from 1; a hidden first user message is
  // answered by a result with empty counters (no model ran), and the user's own first
  // prompt follows it.
  const session = [
    envelope(1, { type: "env_manager_log" }),
    envelope(2, user(2, "hidden setup message")),
    envelope(3, user(3, "First synthetic prompt")),
    envelope(4, init("claude-sonnet-5-5")),
    envelope(5, result(5, [2], {})),
    envelope(6, init("claude-sonnet-5-5")),
    envelope(7, result(7, [3], { "claude-sonnet-5-5": usage(21) })),
    envelope(8, user(8, "Second synthetic prompt")),
    envelope(9, result(9, [8], { "claude-sonnet-5-5": usage(41) })),
  ];
  const read = (envelopes: unknown[]) => {
    const events = new CoworkEvents();
    for (const item of envelopes) events.add(item);
    return { events, page: events.page(SESSION, OBSERVED) };
  };
  // Oldest first, as the page reads now, or newest first, as it read on 1 Oct.
  for (const order of [session, [...session].reverse()]) {
    const { events, page } = read(order);
    assert.equal(page.firstRequestVerified, true);
    assert.equal(page.rootSourceId, id(3));
    assert.equal(page.hasEarlier, false);
    assert.equal(page.branchScope, "loaded_messages");
    assert.deepEqual(
      page.messages.map((m) => [m.role, m.sourceId]),
      [
        ["prompt", id(3)],
        ["response", id(7)],
        ["prompt", id(8)],
        ["response", id(9)],
      ],
    );
    // A later result of the live stream proves nothing more; the saved proof stays.
    events.add(envelope(10, user(10, "Third synthetic prompt")));
    events.add(
      envelope(11, result(11, [10], { "claude-sonnet-5-5": usage(9) })),
    );
    const later = events.page(SESSION, OBSERVED);
    assert.equal(later.firstRequestVerified, false);
    assert.equal(later.rootSourceId, null);
    assert.equal(later.hasEarlier, null);
  }
  // Only a read that saw every event up to the first counted result proves the start:
  // not one that began later, missed an event before it, or lacks the result's prompt.
  for (const [label, envelopes] of [
    ["no first event", session.slice(1)],
    ["a missing event", session.filter((_, i) => i !== 5)],
    ["no prompt", session.filter((_, i) => i !== 2)],
    [
      "one of two prompts",
      session.map((item, i) =>
        i === 6
          ? envelope(
              7,
              result(7, [3, 12], { "claude-sonnet-5-5": usage(21) }),
            )
          : item,
      ),
    ],
  ] as const) {
    const { page } = read(envelopes);
    assert.equal(page.firstRequestVerified, false, label);
    assert.equal(page.rootSourceId, null, label);
  }
  // An event skipped as too large before the first result leaves the start unproven.
  const skipped = new CoworkEvents();
  for (const item of session.slice(0, 3)) skipped.add(item);
  skipped.gap();
  for (const item of session.slice(3)) skipped.add(item);
  assert.equal(skipped.page(SESSION, OBSERVED).firstRequestVerified, false);
  // A missing event after the first counted result does not touch its proof.
  assert.equal(
    read(session.filter((_, i) => i !== 7)).page.firstRequestVerified,
    true,
  );
  // A result that could not be read may be the first request, so a later read that
  // repeats only the results after it proves nothing (Codex review, 6 Oct).
  const unread = new CoworkEvents();
  for (const item of [
    envelope(1, { type: "env_manager_log" }),
    // Its prompt was not loaded, so only the unread result shows an earlier request.
    envelope(3, result(3, [2], undefined)),
    envelope(2, { type: "env_manager_log" }),
    envelope(4, user(4, "Second synthetic prompt")),
    envelope(5, result(5, [4], { "claude-sonnet-5-5": usage(21) })),
  ])
    unread.add(item);
  assert.equal(unread.page(SESSION, OBSERVED).status, "unsupported");
  unread.add(envelope(4, user(4, "Second synthetic prompt")));
  unread.add(envelope(5, result(5, [4], { "claude-sonnet-5-5": usage(21) })));
  const after = unread.page(SESSION, OBSERVED);
  assert.equal(after.status, "partial");
  assert.equal(after.firstRequestVerified, false);
  // So does a result whose position could not be read.
  const unplaced = new CoworkEvents();
  for (const item of session) unplaced.add(item);
  unplaced.add({
    ...envelope(1, result(30, [3], { "claude-sonnet-5-5": usage(5) })),
    sequence_num: "first",
  });
  assert.equal(unplaced.page(SESSION, OBSERVED).status, "unsupported");
  for (const item of session) unplaced.add(item);
  assert.equal(unplaced.page(SESSION, OBSERVED).firstRequestVerified, false);
  // A prompt answered after a later one is still the earlier request: the first result's
  // prompt is no proof while an earlier prompt is on the page.
  const queued = read([
    envelope(1, { type: "env_manager_log" }),
    envelope(2, user(2, "First synthetic prompt")),
    envelope(3, user(3, "Second synthetic prompt")),
    envelope(4, result(4, [3], { "claude-sonnet-5-5": usage(21) })),
    envelope(5, result(5, [2], { "claude-sonnet-5-5": usage(30) })),
  ]).page;
  assert.equal(queued.messages[0]!.sourceId, id(2));
  assert.equal(queued.firstRequestVerified, false);
  assert.equal(queued.rootSourceId, null);
  // A result saved before its own prompt does not start the page with that prompt.
  const reversed = read([
    envelope(1, { type: "env_manager_log" }),
    envelope(2, result(2, [3], { "claude-sonnet-5-5": usage(21) })),
    envelope(3, user(3, "First synthetic prompt")),
  ]).page;
  assert.deepEqual(
    reversed.messages.map((m) => m.role),
    ["response", "prompt"],
  );
  assert.equal(reversed.firstRequestVerified, false);
  // An earlier prompt whose answer comes on a later page is an earlier request too: the
  // page with only the later prompt's answer proves nothing.
  const split = new CoworkEvents();
  for (const item of [
    envelope(1, { type: "env_manager_log" }),
    envelope(2, user(2, "First synthetic prompt")),
    envelope(3, user(3, "Second synthetic prompt")),
    envelope(4, result(4, [3], { "claude-sonnet-5-5": usage(21) })),
  ])
    split.add(item);
  const early = split.page(SESSION, OBSERVED);
  assert.deepEqual(
    early.messages.map((m) => m.sourceId),
    [id(3), id(4)],
  );
  assert.equal(early.firstRequestVerified, false);
  split.add(envelope(5, result(5, [2], { "claude-sonnet-5-5": usage(30) })));
  assert.equal(split.page(SESSION, OBSERVED).firstRequestVerified, false);
  // A replayed window without the earlier prompt does not forget it (Codex review).
  split.add(envelope(3, user(3, "Second synthetic prompt")));
  split.add(envelope(4, result(4, [3], { "claude-sonnet-5-5": usage(21) })));
  split.add(envelope(5, result(5, [2], { "claude-sonnet-5-5": usage(30) })));
  assert.equal(split.page(SESSION, OBSERVED).firstRequestVerified, false);
  // Before the first request, an event this reader cannot read could be a request: a
  // user message of another shape or without an id, or a result that ran no model whose
  // prompts cannot all be read.
  const unreadPrompts = Array.from({ length: 17 }, (_, k) => 40 + k);
  for (const [label, odd] of [
    ["user without id", user(2, "First synthetic prompt", { uuid: "x" })],
    [
      "user of another role",
      { ...user(2, "First synthetic prompt"), message: { role: "admin" } },
    ],
    ["idle result with a bad id", result(2, [2], {}, { user_message_uuids: [id(2), "bad"] })],
    ["idle result with too many prompts", result(2, unreadPrompts, {})],
  ] as const) {
    const page = read([
      envelope(1, { type: "env_manager_log" }),
      envelope(2, odd),
      envelope(3, user(3, "Second synthetic prompt")),
      envelope(4, result(4, [3], { "claude-sonnet-5-5": usage(21) })),
    ]).page;
    assert.equal(page.firstRequestVerified, false, label);
  }
  // A result answers only prompts before it, and a prompt that cannot be placed, or is
  // placed before the session's first event, may be the first request (Codex review).
  for (const [label, events] of [
    [
      "idle result before its prompt",
      [
        envelope(1, { type: "env_manager_log" }),
        envelope(2, result(2, [3], {})),
        envelope(3, user(3, "First synthetic prompt")),
        envelope(4, user(4, "Second synthetic prompt")),
        envelope(5, result(5, [4], { "claude-sonnet-5-5": usage(21) })),
      ],
    ],
    [
      "unplaced prompt",
      [
        ...session,
        { ...envelope(0, user(20, "Unplaced prompt")), sequence_num: "x" },
      ],
    ],
    ["prompt at 0", [envelope(0, user(20, "Early prompt")), ...session]],
    ["event of no kind at 0", [envelope(0, {}), ...session]],
    [
      "unplaced event of no kind",
      [{ ...envelope(0, {}), sequence_num: "unplaced" }, ...session],
    ],
    [
      "unplaced event without a readable payload",
      [{ ...envelope(0, null), sequence_num: "unplaced" }, ...session],
    ],
  ] as const) {
    assert.equal(read([...events]).page.firstRequestVerified, false, label);
  }
  // Many prompts answered without a model before the first request leave it provable.
  const idleFirst: unknown[] = [envelope(1, { type: "env_manager_log" })];
  for (let k = 0; k < 6; k++)
    idleFirst.push(
      envelope(2 + 2 * k, user(2 + 2 * k, `Hidden message ${k}`)),
      envelope(3 + 2 * k, result(3 + 2 * k, [2 + 2 * k], {})),
    );
  idleFirst.push(
    envelope(14, user(14, "First synthetic prompt")),
    envelope(15, result(15, [14], { "claude-sonnet-5-5": usage(21) })),
  );
  const idleRead = read(idleFirst).page;
  assert.equal(idleRead.firstRequestVerified, true);
  assert.equal(idleRead.rootSourceId, id(14));
  // A prompt answered first without a model and later by a model is reported before the
  // root on the page, so the page proves nothing.
  const again = read([
    envelope(1, { type: "env_manager_log" }),
    envelope(2, user(2, "First synthetic prompt")),
    envelope(3, result(3, [2], {})),
    envelope(4, user(4, "Second synthetic prompt")),
    envelope(5, result(5, [4], { "claude-sonnet-5-5": usage(21) })),
    envelope(6, result(6, [2], { "claude-sonnet-5-5": usage(9) })),
  ]).page;
  assert.equal(again.messages[0]!.sourceId, id(2));
  assert.equal(again.firstRequestVerified, false);
  // The first prompt stays known when many prompts follow it before its result.
  const late = [
    envelope(1, { type: "env_manager_log" }),
    envelope(2, user(2, "First synthetic prompt")),
  ];
  for (let k = 0; k < 70; k++)
    late.push(envelope(3 + k, user(3 + k, `Queued prompt ${k}`)));
  late.push(envelope(73, result(73, [2], { "claude-sonnet-5-5": usage(21) })));
  const lateRead = read(late).page;
  assert.equal(lateRead.firstRequestVerified, true);
  assert.equal(lateRead.rootSourceId, id(2));
  // Events skipped after the first result leave its proof alone, however many there are.
  const skippedLater = new CoworkEvents();
  for (const item of session.slice(0, 7)) skippedLater.add(item);
  for (let k = 0; k < 70; k++) {
    skippedLater.add(envelope(8 + k, { type: "env_manager_log" }));
    skippedLater.gap();
  }
  assert.equal(skippedLater.page(SESSION, OBSERVED).firstRequestVerified, true);
  // A long session read oldest first keeps its first prompt past the bound of kept prompts.
  const long = [
    envelope(1, { type: "env_manager_log" }),
    envelope(2, user(2, "First synthetic prompt")),
    envelope(3, result(3, [2], { "claude-sonnet-5-5": usage(21) })),
  ];
  for (let k = 0; k < 80; k++)
    long.push(
      envelope(4 + 2 * k, user(4 + 2 * k, `Prompt ${k}`)),
      envelope(
        5 + 2 * k,
        result(5 + 2 * k, [4 + 2 * k], { "claude-sonnet-5-5": usage(5) }),
      ),
    );
  const whole = read(long).page;
  assert.equal(whole.firstRequestVerified, true);
  assert.equal(whole.rootSourceId, id(2));
  assert.deepEqual(
    whole.messages.slice(0, 2).map((m) => [m.role, m.sourceId]),
    [
      ["prompt", id(2)],
      ["response", id(3)],
    ],
  );
});

// Envelope types seen before the first counted result in the owner's sessions of August
// and September (read-only capture, 14 Oct 2026). Only the structure is kept.
const FILLERS: unknown[] = [
  { type: "env_manager_log" },
  { type: "system", subtype: "status" },
  { type: "system", subtype: "hook_started" },
  { type: "system", subtype: "hook_response" },
  { type: "system", subtype: "commands_changed" },
  { type: "active_goal" },
  { type: "assistant", message: { role: "assistant", content: [] } },
  { type: "autocompact_state" },
  { type: "control_request" },
  { type: "control_response" },
  { type: "rate_limit_event" },
  { type: "tool_progress" },
  { type: "system", subtype: "task_summary" },
  { type: "system", subtype: "post_turn_summary" },
  { type: "system", subtype: "turn_handoff_available" },
];
/** A session of `length` events numbered from 1, with fillers between the given events. */
const coworkSession = (length: number, events: Record<number, unknown>) =>
  Array.from({ length }, (_, k) =>
    envelope(
      k + 1,
      events[k + 1] ??
        (k === 1 ? init("claude-sonnet-5-5") : FILLERS[k % FILLERS.length]),
    ),
  );
/**
 * A result that ran no model, with zero output of its own. `prompts` null leaves out the
 * field that names user messages, as the sessions before mid September did.
 */
const emptyResult = (
  n: number,
  prompts: number[] | null,
  extra: object = {},
) => {
  const { user_message_uuids, ...rest } = result(
    n,
    prompts ?? [],
    {},
    {
      usage: { input_tokens: 0, output_tokens: 0 },
      ...extra,
    },
  );
  return prompts === null ? rest : { ...rest, user_message_uuids };
};
const ranResult = (n: number, prompts: number[], output: number) =>
  result(
    n,
    prompts,
    { "claude-sonnet-5-5": usage(output) },
    {
      usage: { input_tokens: 3, output_tokens: output },
    },
  );
const toolResults = (from: number, to: number) =>
  Object.fromEntries(
    Array.from({ length: to - from + 1 }, (_, k) => [
      from + k,
      user(from + k, [
        {
          type: "tool_result",
          tool_use_id: `toolu_${from + k}`,
          content: `synthetic tool output ${from + k}`,
        },
      ]),
    ]),
  );

// The sessions of the 14 Oct capture, up to the first result that ran a model. A to D
// (12 Aug to 1 Sep) answer the hidden first message with an empty result that names no
// user message; E (23 Sep) names it, as described for 6 Oct; F has no request yet.
const OLD_SESSIONS = {
  A: {
    events: coworkSession(47, {
      17: user(17, "hidden setup message"),
      18: user(18, "First synthetic prompt"),
      24: emptyResult(24, null),
      35: ranResult(35, [18], 245),
    }),
    root: 18,
    first: 35,
    output: 245,
  },
  B: {
    events: coworkSession(500, {
      2: user(2, "hidden setup message"),
      3: user(3, "First synthetic prompt"),
      20: emptyResult(20, null),
      ...toolResults(30, 75),
      81: ranResult(81, [3], 19990),
    }),
    root: 3,
    first: 81,
    output: 19990,
  },
  C: {
    events: coworkSession(75, {
      15: user(15, "hidden setup message"),
      16: user(16, "First synthetic prompt"),
      22: emptyResult(22, null),
      27: user(27, [{ type: "text", text: "Synthetic prompt again" }]),
      28: emptyResult(28, null, {
        subtype: "error_during_execution",
        result: undefined,
      }),
      31: user(31, "Synthetic prompt named by no result"),
      34: user(34, "Synthetic prompt answered"),
      43: ranResult(43, [34], 692),
    }),
    root: 34,
    first: 43,
    output: 692,
  },
  D: {
    events: coworkSession(443, {
      15: user(15, "hidden setup message"),
      16: user(16, "First synthetic prompt"),
      24: emptyResult(24, null),
      ...toolResults(40, 190),
      195: ranResult(195, [16], 54594),
    }),
    root: 16,
    first: 195,
    output: 54594,
  },
  E: {
    events: coworkSession(88, {
      12: user(12, "hidden setup message"),
      13: user(13, "First synthetic prompt"),
      16: emptyResult(16, [12]),
      ...toolResults(20, 46),
      48: user(48, [{ type: "text", text: "Synthetic prompt queued" }]),
      ...toolResults(50, 70),
      72: ranResult(72, [13], 5230),
    }),
    root: 13,
    first: 72,
    output: 5230,
  },
} as const;

test("sessions that answered their hidden first message without naming it prove their start (14 Oct)", () => {
  const read = (envelopes: readonly unknown[]) => {
    const events = new CoworkEvents();
    for (const item of envelopes) assert.equal(events.add(item), true);
    return events.page(SESSION, OBSERVED);
  };
  for (const [name, session] of Object.entries(OLD_SESSIONS)) {
    // Oldest first, as the page and the own read load the list, and newest first.
    for (const order of [session.events, [...session.events].reverse()]) {
      const page = read(order);
      assert.equal(page.status, "partial", name);
      assert.equal(page.firstRequestVerified, true, name);
      assert.equal(page.rootSourceId, id(session.root), name);
      assert.equal(page.hasEarlier, false, name);
      // The figures do not move: an empty result is never a request, and only the first
      // counted result and its prompt are reported.
      assert.deepEqual(
        page.messages.map((m) => [m.role, m.sourceId]),
        [
          ["prompt", id(session.root)],
          ["response", id(session.first)],
        ],
        name,
      );
      assert.deepEqual(
        page.messages[1]!.cumulative,
        {
          sequence: session.first,
          models: [
            {
              model: "claude-sonnet-5-5",
              output: session.output,
              reasoning: null,
            },
          ],
          apiMs: session.first * 1000,
        },
        name,
      );
    }
  }
  // F: no request yet, so nothing to report and nothing proven.
  const empty = read(coworkSession(13, {}));
  assert.deepEqual(empty.messages, []);
  assert.equal(empty.firstRequestVerified, false);
});

test("an old session's start stays unproven past a gap, an unknown event or an earlier request", () => {
  const read = (envelopes: readonly unknown[], gapAfter?: number) => {
    const events = new CoworkEvents();
    for (const item of envelopes) {
      events.add(item);
      if ((item as { sequence_num: string }).sequence_num === String(gapAfter))
        events.gap();
    }
    return events.page(SESSION, OBSERVED);
  };
  const { A, C, E } = OLD_SESSIONS;
  const replace = (
    envelopes: readonly unknown[],
    sequence: number,
    payload: unknown,
  ) =>
    envelopes.map((item, i) =>
      i === sequence - 1 ? envelope(sequence, payload) : item,
    );
  for (const [label, envelopes] of [
    ["first event above 1", A.events.slice(1)],
    [
      "missing event before the hidden message",
      A.events.filter((_, i) => i !== 9),
    ],
    [
      "missing event before the first result",
      C.events.filter((_, i) => i !== 39),
    ],
    ["missing empty result", A.events.filter((_, i) => i !== 23)],
    ["payload without a type", replace(C.events, 30, { subtype: "status" })],
    ["payload of a type that is no string", replace(C.events, 30, { type: 7 })],
    [
      "user message of another role",
      replace(C.events, 31, {
        ...user(31, "Synthetic prompt named by no result"),
        message: { role: "admin" },
      }),
    ],
    [
      "user message without an id",
      replace(A.events, 17, user(17, "hidden setup message", { uuid: "x" })),
    ],
    [
      "empty result whose prompts cannot be read",
      replace(
        A.events,
        24,
        emptyResult(24, [], { user_message_uuids: ["bad"] }),
      ),
    ],
    // Prompts the first counted result does not name are earlier requests when nothing
    // shows the session answered a message without naming it.
    [
      "unanswered prompt in a session that names its answers",
      replace(E.events, 10, user(10, "Synthetic prompt not answered")),
    ],
    // A prompt a counted result names later was a request of its own.
    [
      "prompt answered later by a model",
      replace(C.events, 60, ranResult(60, [31], 12)),
    ],
  ] as const)
    assert.equal(read(envelopes).firstRequestVerified, false, label);
  // An event skipped unread before the first counted result.
  assert.equal(read(C.events, 30).firstRequestVerified, false);
  assert.equal(read(C.events, 50).firstRequestVerified, true);
  // Read newest first over two pages, a later answer to the earlier prompt arrives on the
  // page before the first counted result and still keeps the start unproven.
  const later = replace(C.events, 60, ranResult(60, [31], 12));
  const events = new CoworkEvents();
  for (const item of later.slice(43).reverse()) events.add(item);
  const newer = events.page(SESSION, OBSERVED);
  assert.deepEqual(
    newer.messages.map((m) => [m.role, m.sourceId]),
    [["response", id(60)]],
  );
  for (const item of later.slice(0, 43).reverse()) events.add(item);
  const older = events.page(SESSION, OBSERVED);
  assert.deepEqual(
    older.messages.map((m) => [m.role, m.sourceId]),
    [
      ["prompt", id(34)],
      ["response", id(43)],
    ],
  );
  assert.equal(older.firstRequestVerified, false);
});

test("Cowork prompts survive many tool results, and a prompt the page did not load stays a link", () => {
  const events = new CoworkEvents();
  events.add(envelope(1, user(1, "Prompt before a long turn")));
  for (let n = 2; n < 300; n++)
    events.add(
      envelope(
        n,
        user(n, [{ type: "tool_result", tool_use_id: `t${n}`, content: "x" }]),
      ),
    );
  events.add(
    envelope(300, result(300, [1], { "claude-sonnet-5-5": usage(5) })),
  );
  events.add(
    envelope(301, result(301, [250], { "claude-sonnet-5-5": usage(9) })),
  );
  const page = events.page(SESSION, OBSERVED);
  assert.deepEqual(
    page.messages.map((m) => [m.role, m.sourceId]),
    [
      ["prompt", id(1)],
      ["response", id(300)],
      ["response", id(301)],
    ],
  );
  assert.equal(page.messages[2]!.promptSourceId, id(250));
  assert.equal(page.messages[2]!.parentRole, "prompt");
});

test("Cowork counters: model ids, canonical names for suffixed ids, sums and unknown thinking", () => {
  const events = new CoworkEvents();
  events.add(
    envelope(
      2,
      result(
        2,
        [],
        {
          "claude-opus-5-5[1m]": {
            ...usage(50, 5),
            canonicalModel: "claude-opus-5-5",
          },
          "claude-opus-5-5": usage(25, 5),
          "claude-haiku-4-5-20251001": usage(7),
        },
        { duration_api_ms: undefined },
      ),
    ),
  );
  const [reply] = events.page(SESSION, OBSERVED).messages;
  assert.deepEqual(reply!.cumulative, {
    sequence: 2,
    models: [
      { model: "claude-opus-5-5", output: 75, reasoning: 10 },
      { model: "claude-haiku-4-5-20251001", output: 7, reasoning: null },
    ],
    apiMs: null,
  });
  assert.equal(reply!.promptSourceId, null);
  assert.equal(reply!.parentRole, null);
  assert.equal(reply!.modelId, null);
});

test("a result with empty counters is left out; missing counters or counters in an unknown shape are reported", () => {
  const events = new CoworkEvents();
  // A turn that ran no model has empty counters, with or without its own zero count.
  events.add(envelope(1, result(1, [], {})));
  events.add(envelope(2, result(2, [], {}, { usage: { output_tokens: 0 } })));
  assert.equal(events.pending, false);
  for (const bad of [
    // Missing counters, and empty ones beside a turn reporting output of its own, mean
    // the counters moved: a format change, never a result left out silently.
    result(3, [], undefined),
    result(3, [], {}, { usage: { output_tokens: 7 } }),
    result(3, [], { "claude-sonnet-5-5": { outputTokens: "12" } }),
    result(3, [], { "claude-sonnet-5-5": usage(5, 6) }),
    result(3, [], { "bad label": usage(5) }),
    result(3, [], { "claude-sonnet-5-5": usage(5) }, { uuid: "not-a-uuid" }),
    result(3, [], { "claude-sonnet-5-5": usage(5) }, { duration_api_ms: -1 }),
    result(
      3,
      [],
      { "claude-sonnet-5-5": usage(5) },
      { user_message_uuids: ["x"] },
    ),
    result(3, [], [usage(5)]),
  ]) {
    events.add(envelope(3, bad));
    assert.equal(events.pending, true);
    const page = events.page(SESSION, OBSERVED);
    assert.equal(page.status, "unsupported", JSON.stringify(bad).slice(0, 80));
    assert.deepEqual(page.messages, []);
    assert.equal(page.branchScope, "unknown");
  }
  // An unreadable sequence on a result is a format change too.
  assert.equal(
    events.add({
      ...envelope(4, result(4, [], { m: usage(1) })),
      sequence_num: "x",
    }),
    false,
  );
  assert.equal(events.page(SESSION, OBSERVED).status, "unsupported");
  // Other envelopes in an unknown shape are not results; the reader decides about them.
  assert.equal(events.add({ payload: "x" }), false);
  assert.equal(events.add(envelope(5, { kind: "x" })), false);
  assert.equal(events.pending, false);
  events.fail();
  assert.equal(events.page(SESSION, OBSERVED).status, "unsupported");
  // After a reported page the reader continues normally.
  events.add(envelope(6, result(6, [], { "claude-sonnet-5-5": usage(5) })));
  assert.equal(events.page(SESSION, OBSERVED).messages.length, 1);
});

test("Cowork answers and prompts of unknown shape stay unknown instead of empty", () => {
  const events = new CoworkEvents();
  events.add(envelope(1, user(1, [{ type: "text" }])));
  events.add(envelope(2, user(2, [{ type: "text", text: "a" }, "loose"])));
  events.add(envelope(3, user(3, { not: "content" })));
  events.add(
    envelope(
      4,
      result(4, [1, 2, 3], { "claude-sonnet-5-5": usage(5) }, { result: 42 }),
    ),
  );
  const page = events.page(SESSION, OBSERVED);
  assert.deepEqual(
    page.messages.map((m) => [m.role, m.text, m.complete, m.inputImages]),
    [
      ["prompt", null, false, undefined],
      ["prompt", null, false, undefined],
      ["prompt", null, false, undefined],
      ["response", null, false, undefined],
    ],
  );
});

const toolResult = (n: number, content: unknown, extra: object = {}) =>
  user(n, [{ type: "tool_result", tool_use_id: `toolu_${n}`, content }], extra);

test("tool results of a turn the reader saw whole count as input (A6)", () => {
  const events = new CoworkEvents();
  events.add(envelope(1, user(1, "First prompt")));
  events.add(envelope(2, toolResult(2, "file text")));
  events.add(
    envelope(
      3,
      toolResult(3, [
        { type: "text", text: "search hit" },
        { type: "image", source: { type: "base64", data: "AAAA" } },
      ]),
    ),
  );
  // A sub-agent's tool result is input to a model of the turn too.
  events.add(
    envelope(
      4,
      toolResult(4, "sub-agent read", { parent_tool_use_id: "toolu_9" }),
    ),
  );
  events.add(envelope(5, result(5, [1], { "claude-sonnet-5-5": usage(50) })));
  // A turn without tool calls read none.
  events.add(envelope(6, user(6, "Second prompt")));
  events.add(envelope(7, result(7, [6], { "claude-sonnet-5-5": usage(60) })));
  const replies = events
    .page(SESSION, OBSERVED)
    .messages.filter((m) => m.role === "response");
  assert.deepEqual(
    replies.map((m) => m.toolOutput),
    ["file text\nsearch hit\nsub-agent read", ""],
  );
});

test("tool results stay unknown when the turn's start, a result or an event is missing", () => {
  const events = new CoworkEvents();
  // The prompt was not loaded: the turn may have read more than this reader saw.
  events.add(envelope(2, toolResult(2, "seen")));
  events.add(envelope(3, result(3, [1], { "claude-sonnet-5-5": usage(5) })));
  // A tool result in an unknown shape.
  events.add(envelope(4, user(4, "Prompt")));
  events.add(envelope(5, toolResult(5, { not: "content" })));
  events.add(envelope(6, result(6, [4], { "claude-sonnet-5-5": usage(9) })));
  // An event skipped unread during the turn.
  events.add(envelope(7, user(7, "Prompt")));
  events.add(envelope(8, toolResult(8, "before the gap")));
  events.gap();
  events.add(envelope(10, result(10, [7], { "claude-sonnet-5-5": usage(12) })));
  // A turn after the gap is whole again.
  events.add(envelope(11, user(11, "Prompt")));
  events.add(envelope(12, toolResult(12, "after the gap")));
  events.add(
    envelope(13, result(13, [11], { "claude-sonnet-5-5": usage(15) })),
  );
  const replies = events
    .page(SESSION, OBSERVED)
    .messages.filter((m) => m.role === "response");
  assert.deepEqual(
    replies.map((m) => [
      m.sourceId,
      Object.hasOwn(m, "toolOutput") ? m.toolOutput : "unknown",
    ]),
    [
      [id(3), "unknown"],
      [id(6), "unknown"],
      [id(10), "unknown"],
      [id(13), "after the gap"],
    ],
  );
});

test("every skipped event leaves the turns spanning it unknown, however many wait for a page", () => {
  const events = new CoworkEvents();
  events.add(envelope(1, user(1, "Prompt")));
  events.gap();
  events.add(envelope(3, result(3, [1], { "claude-sonnet-5-5": usage(5) })));
  events.add(envelope(4, user(4, "Prompt")));
  events.gap();
  events.add(envelope(6, result(6, [4], { "claude-sonnet-5-5": usage(9) })));
  events.add(envelope(7, user(7, "Prompt")));
  events.add(envelope(8, toolResult(8, "whole")));
  events.add(envelope(9, result(9, [7], { "claude-sonnet-5-5": usage(12) })));
  const known = (events: CoworkEvents) =>
    events
      .page(SESSION, OBSERVED)
      .messages.filter((m) => m.role === "response")
      .map((m) => [
        m.sourceId,
        Object.hasOwn(m, "toolOutput") ? m.toolOutput : "unknown",
      ]);
  assert.deepEqual(known(events), [
    [id(3), "unknown"],
    [id(6), "unknown"],
    [id(9), "whole"],
  ]);
  // A skipped event before any event was read cannot be placed: no turn is known whole.
  const early = new CoworkEvents();
  early.gap();
  early.add(envelope(1, user(1, "Prompt")));
  early.add(envelope(2, toolResult(2, "seen")));
  early.add(envelope(3, result(3, [1], { "claude-sonnet-5-5": usage(5) })));
  assert.deepEqual(known(early), [[id(3), "unknown"]]);
  // Past the bound of kept positions, a turn that started before a dropped one is unknown;
  // a later turn is not.
  const many = new CoworkEvents();
  many.add(envelope(1, user(1, "Prompt")));
  many.gap();
  many.add(envelope(3, result(3, [1], { "claude-sonnet-5-5": usage(5) })));
  many.add(envelope(4, user(4, "Prompt")));
  many.add(envelope(5, toolResult(5, "kept")));
  many.add(envelope(6, result(6, [4], { "claude-sonnet-5-5": usage(9) })));
  for (let n = 10; n < 10 + 64; n++) {
    many.add(envelope(n, init("claude-sonnet-5-5")));
    many.gap();
  }
  assert.deepEqual(known(many), [
    [id(3), "unknown"],
    [id(6), "kept"],
  ]);
});

test("tool results stay unknown unless the reader saw every prompt the result names", () => {
  const events = new CoworkEvents();
  // The turn's first prompt was not loaded; a queued later one was.
  events.add(envelope(5, user(5, "Queued prompt")));
  events.add(envelope(6, toolResult(6, "after the queued prompt")));
  events.add(envelope(7, result(7, [4, 5], { "claude-sonnet-5-5": usage(9) })));
  // Both prompts were seen.
  events.add(envelope(8, user(8, "First")));
  events.add(envelope(9, toolResult(9, "one")));
  events.add(envelope(10, user(10, "Second")));
  events.add(envelope(11, toolResult(11, "two")));
  events.add(
    envelope(12, result(12, [8, 10], { "claude-sonnet-5-5": usage(12) })),
  );
  // More prompts than the reader keeps for one result.
  const named = Array.from({ length: 17 }, (_, index) => 20 + index);
  for (const n of named) events.add(envelope(n, user(n, "Prompt")));
  events.add(
    envelope(40, result(40, named, { "claude-sonnet-5-5": usage(15) })),
  );
  const replies = events
    .page(SESSION, OBSERVED)
    .messages.filter((m) => m.role === "response");
  assert.deepEqual(
    replies.map((m) => [
      m.sourceId,
      Object.hasOwn(m, "toolOutput") ? m.toolOutput : "unknown",
    ]),
    [
      [id(7), "unknown"],
      [id(12), "one\ntwo"],
      [id(40), "unknown"],
    ],
  );
});

test("tool results without text count against a bound, and a turn that lost some stays unknown", () => {
  const events = new CoworkEvents();
  events.add(envelope(1, user(1, "Prompt")));
  for (let n = 2; n < 2 + 4097; n++) events.add(envelope(n, toolResult(n, "")));
  events.add(
    envelope(5000, result(5000, [1], { "claude-sonnet-5-5": usage(5) })),
  );
  const reply = events.page(SESSION, OBSERVED).messages.at(-1)!;
  assert.equal(reply.role, "response");
  assert.equal(Object.hasOwn(reply, "toolOutput"), false);
});

test("tool results of the running turn wait for its result; used ones are dropped", () => {
  const events = new CoworkEvents();
  events.add(envelope(1, user(1, "Prompt")));
  events.add(envelope(2, toolResult(2, "first")));
  events.add(envelope(3, result(3, [1], { "claude-sonnet-5-5": usage(5) })));
  events.add(envelope(4, user(4, "Next prompt")));
  events.add(envelope(5, toolResult(5, "running turn")));
  assert.equal(
    events.page(SESSION, OBSERVED).messages.at(-1)!.toolOutput,
    "first",
  );
  events.add(envelope(6, toolResult(6, "more")));
  events.add(envelope(7, result(7, [4], { "claude-sonnet-5-5": usage(9) })));
  const page = events.page(SESSION, OBSERVED);
  assert.deepEqual(
    page.messages.map((m) => [m.role, m.toolOutput]),
    [
      ["prompt", undefined],
      ["response", "running turn\nmore"],
    ],
  );
});

test("validCoworkCumulative accepts only the counters the reader builds", () => {
  const valid = {
    sequence: 3,
    models: [{ model: "claude-sonnet-5-5", output: 10, reasoning: 2 }],
    apiMs: 120,
  };
  assert.equal(validCoworkCumulative(valid), true);
  assert.equal(validCoworkCumulative({ ...valid, apiMs: null }), true);
  for (const bad of [
    null,
    [],
    { ...valid, extra: 1 },
    { ...valid, sequence: -1 },
    { ...valid, sequence: "3" },
    { ...valid, apiMs: 1.5 },
    { ...valid, models: [] },
    { ...valid, models: [valid.models[0], valid.models[0]] },
    { ...valid, models: [{ ...valid.models[0], reasoning: 11 }] },
    { ...valid, models: [{ ...valid.models[0], model: "bad label" }] },
    { ...valid, models: [{ ...valid.models[0], extra: 1 }] },
    { ...valid, models: [{ ...valid.models[0], output: 2_000_000_000 }] },
  ])
    assert.equal(validCoworkCumulative(bad), false, JSON.stringify(bad));
});
