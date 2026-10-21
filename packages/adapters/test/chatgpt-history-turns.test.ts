import test from "node:test";
import assert from "node:assert/strict";
import {
  HISTORY_LIMITS,
  historyMessageUnits,
  parseHistoryText,
} from "../src/history";

// Synthetic saved ChatGPT pages in the row shapes seen on 14 Sep, 1 Oct and 3 Oct 2026.
const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const conversation = uid(42);
const at = "2026-10-04T12:00:00.000Z";
const R1 = uid(9001),
  R2 = uid(9002),
  R0 = uid(9000);
type Row = Record<string, any>;
const row = (n: number, role: string, content: Row, options: Row = {}): Row => {
  const { request, parent, metadata, ...rest } = options;
  return {
    id: uid(n),
    author: { role },
    create_time: 1767261600 + n,
    content,
    status: "finished_successfully",
    end_turn: null,
    recipient: "all",
    channel: null,
    ...rest,
    metadata: {
      ...(request ? { request_id: request } : {}),
      ...(parent ? { parent_id: uid(parent) } : {}),
      ...metadata,
    },
  };
};
const text = (...parts: unknown[]) => ({ content_type: "text", parts });
const root = () =>
  row(1, "system", text(""), {
    metadata: { is_visually_hidden_from_conversation: true },
  });
const page = (rows: Row[], extra: Row = {}) => ({
  conversation_id: conversation,
  messages: rows,
  current_node: rows.at(-1)!.id,
  page_info: {
    start_cursor: rows[0]!.id,
    end_cursor: rows.at(-1)!.id,
    has_previous_page: false,
    has_next_page: false,
  },
  context_truncation_continuation: null,
  ...extra,
});
const parse = (body: unknown) =>
  parseHistoryText("chatgpt", body, conversation, at);
const final = (n: number, body: string, options: Row = {}) =>
  row(n, "assistant", text(body), {
    channel: "final",
    end_turn: true,
    update_time: 1767261600 + n + 1,
    ...options,
    metadata: { is_complete: true, ...options.metadata },
  });

test("a saved ChatGPT turn is one reply with its thinking, tool calls, results and answer", () => {
  const body = page([
    root(),
    row(2, "user", text("Question"), { request: R1, parent: 1 }),
    row(
      3,
      "assistant",
      {
        content_type: "thoughts",
        thoughts: [{ summary: "Plan", content: "Steps" }],
      },
      { request: R1, parent: 2, update_time: 1767261604 },
    ),
    row(
      4,
      "assistant",
      { content_type: "code", text: '{"q":"x"}' },
      {
        request: R1,
        parent: 3,
        recipient: "web.run",
      },
    ),
    row(
      5,
      "tool",
      { content_type: "tether_browsing_display", result: "Found" },
      {
        request: R1,
        parent: 4,
      },
    ),
    row(6, "assistant", text("Checking"), {
      request: R1,
      parent: 5,
      channel: "commentary",
    }),
    row(
      7,
      "assistant",
      { content_type: "reasoning_recap", content: "Thought" },
      {
        request: R1,
        parent: 6,
      },
    ),
    final(8, "Answer", {
      request: R1,
      parent: 7,
      update_time: 1767261614,
      metadata: {
        model_slug: "gpt-5",
        resolved_model_slug: "gpt-5-4-thinking",
      },
    }),
  ]);
  const result = parse(body);
  assert.equal(result.status, "partial");
  assert.equal(result.firstRequestVerified, true);
  assert.deepEqual(
    result.messages.map((m) => [m.role, m.sourceId]),
    [
      ["prompt", uid(2)],
      ["response", uid(8)],
    ],
  );
  const reply = result.messages[1]!;
  assert.equal(reply.liveAttemptId, uid(8));
  assert.equal(reply.text, "Answer");
  assert.equal(reply.thinking, "Plan\nSteps");
  assert.equal(reply.toolInput, "x");
  assert.equal(reply.intermediate, "Checking");
  assert.equal(reply.toolOutput, "Found");
  assert.equal(reply.modelId, "gpt-5-4-thinking");
  assert.equal(reply.complete, true);
  // From the first assistant message (thinking) to the turn's last update.
  assert.equal(reply.timing?.duration_seconds, "11");
  assert.equal(
    reply.occurredAt,
    new Date((1767261600 + 8) * 1000).toISOString(),
  );
  assert.equal(reply.parentSourceId, uid(2));
  assert.equal(reply.parentRole, "prompt");
  assert.equal(reply.promptSourceId, uid(2));
  assert.equal(result.selectedLeafId, uid(8));
  assert.equal(reply.coverageReasons, undefined);
});

test("several answers of a Work turn are one reply; it completes when the last answer ends the turn", () => {
  const rows = [
    root(),
    row(2, "user", text("Task"), { request: R1, parent: 1 }),
    // Work answers carry no `is_complete` (N8).
    final(3, "One", {
      request: R1,
      parent: 2,
      end_turn: false,
      metadata: { is_complete: undefined },
    }),
    row(
      4,
      "assistant",
      { content_type: "code", text: "ls" },
      {
        request: R1,
        parent: 3,
        recipient: "container.exec",
      },
    ),
    final(5, "Two", {
      request: R1,
      parent: 4,
      metadata: { is_complete: undefined },
    }),
  ];
  const running = parse(page(rows.slice(0, 3)));
  const early = running.messages[1]!;
  assert.equal(early.sourceId, uid(3));
  assert.equal(early.complete, false);
  assert.equal(early.timing, null);
  const done = parse(page(rows)).messages[1]!;
  assert.equal(done.sourceId, uid(3));
  assert.equal(done.text, "One\nTwo");
  assert.equal(done.toolInput, "ls");
  assert.equal(done.complete, true);
  assert.ok(done.timing);
});

test("an image turn is reported once it ends, with each image once by its generation id", () => {
  const image = (n: number, status: string, extra: Row = {}) =>
    row(
      n,
      "tool",
      {
        content_type: "multimodal_text",
        parts:
          status === "intermediate-empty"
            ? []
            : [
                {
                  content_type: "image_asset_pointer",
                  asset_pointer: "file-service://asset",
                  width: 1024,
                  height: 1024,
                  metadata: {
                    generation: {
                      gen_id: "gen-1",
                      parent_gen_id: null,
                      width: 1024,
                      height: 1024,
                    },
                    dalle: {
                      gen_id: "gen-1",
                      parent_gen_id: null,
                      edit_op: null,
                    },
                  },
                },
              ],
      },
      {
        request: R1,
        parent: 3,
        author: { role: "tool", name: "t2uay3k.sj1i4kz" },
        ...extra,
        metadata: {
          ghostrider: {
            status: status === "intermediate-empty" ? "intermediate" : status,
          },
          ...extra.metadata,
        },
      },
    );
  const start = [
    root(),
    row(2, "user", text("Draw"), { request: R1, parent: 1 }),
    row(
      3,
      "assistant",
      { content_type: "code", text: '{"prompt":"a cat"}' },
      {
        request: R1,
        parent: 2,
        recipient: "t2uay3k.sj1i4kz",
      },
    ),
  ];
  // While the image is made, the page holds no reply that a later read would contradict.
  const generating = parse(page([...start, image(4, "intermediate-empty")]));
  assert.deepEqual(
    generating.messages.map((m) => m.role),
    ["prompt"],
  );
  // A later prompt ends the turn as the user saw it; the image counts as started.
  const followed = parse(
    page([
      ...start,
      image(4, "intermediate-empty"),
      row(9, "user", text("Next"), { request: R2, parent: 4 }),
    ]),
  );
  const stopped = followed.messages[1]!;
  assert.equal(stopped.complete, false);
  assert.deepEqual(stopped.media, [
    {
      kind: "image",
      model: null,
      count: 1,
      width: null,
      height: null,
      outcome: "started_not_returned",
    },
  ]);
  assert.equal(followed.messages[2]!.parentSourceId, stopped.sourceId);
  const done = parse(
    page([
      ...start,
      image(4, "final"),
      // A hidden copy of the same image is the same image (fixture of 10 Sep).
      image(5, "intermediate", {
        channel: "commentary",
        metadata: {
          is_visually_hidden_from_conversation: true,
          ghostrider: undefined,
        },
      }),
      final(6, "Here it is", { request: R1, parent: 5 }),
    ]),
  );
  const reply = done.messages[1]!;
  assert.equal(reply.sourceId, uid(6));
  assert.equal(reply.text, "Here it is");
  assert.equal(reply.toolInput, "a cat");
  assert.equal(reply.complete, true);
  assert.deepEqual(reply.media, [
    {
      kind: "image",
      model: null,
      count: 1,
      width: 1024,
      height: 1024,
      outcome: "returned",
    },
  ]);
});

test("a stopped image job ends its turn and counts as one started image (I3)", () => {
  const result = parse(
    page([
      root(),
      row(2, "user", text("Draw"), { request: R1, parent: 1 }),
      row(
        3,
        "assistant",
        { content_type: "code", text: '{"prompt":"a cat"}' },
        {
          request: R1,
          parent: 2,
          recipient: "t2uay3k.sj1i4kz",
          update_time: 1767261604,
        },
      ),
      row(
        4,
        "tool",
        { content_type: "multimodal_text", parts: [] },
        {
          request: R1,
          parent: 3,
          author: { role: "tool", name: "t2uay3k.sj1i4kz" },
          metadata: {
            async_source: "image-job",
            finish_details: { type: "interrupted" },
          },
        },
      ),
    ]),
  );
  const reply = result.messages[1]!;
  assert.equal(reply.sourceId, uid(3));
  assert.equal(reply.text, "");
  assert.equal(reply.complete, true);
  assert.equal(reply.timing, null);
  assert.deepEqual(reply.media, [
    {
      kind: "image",
      model: null,
      count: 1,
      width: null,
      height: null,
      outcome: "started_not_returned",
    },
  ]);
});

test("an image turn that starts with its job is named by the job, as the live reply is, and ends when its image is final (I4, 5 Oct)", () => {
  // Saved shape of 5 Oct: the job's tool message, which keeps the id of the one message
  // the live stream showed, then the "Thought for" label under another request.
  const job = (status: string, extra: Row = {}) =>
    row(
      3,
      "tool",
      {
        content_type: "multimodal_text",
        parts:
          status === "intermediate"
            ? []
            : [
                {
                  content_type: "image_asset_pointer",
                  asset_pointer: "file-service://asset",
                  width: 1254,
                  height: 1254,
                  metadata: {
                    generation: {
                      gen_id: "gen-5",
                      parent_gen_id: null,
                      width: 1254,
                      height: 1254,
                    },
                    dalle: {
                      gen_id: "gen-5",
                      parent_gen_id: null,
                      edit_op: null,
                    },
                  },
                },
              ],
      },
      {
        parent: 2,
        channel: "final",
        update_time: 1767261620,
        author: { role: "tool", name: "t2uay3k.sj1i4kz" },
        ...extra,
        metadata: {
          async_source: "image-job",
          ghostrider: { status },
          image_gen_title: "Shape",
        },
      },
    );
  const label = row(
    4,
    "assistant",
    { content_type: "reasoning_recap", content: "Thought for 10s" },
    {
      request: R2,
      parent: 77,
      end_turn: false,
      update_time: 1767261625,
    },
  );
  const prompt = row(2, "user", text("Draw"), { request: R1 });
  // While the job runs, the page holds no reply that a later read would contradict.
  assert.deepEqual(
    parse(page([root(), prompt, job("intermediate")])).messages.map(
      (m) => m.role,
    ),
    ["prompt"],
  );
  const done = parse(page([root(), prompt, job("final"), label]));
  const reply = done.messages[1]!;
  assert.equal(reply.role, "response");
  assert.equal(reply.sourceId, uid(3));
  assert.equal(reply.liveAttemptId, uid(3));
  assert.equal(reply.parentSourceId, uid(2));
  assert.equal(reply.text, "");
  assert.equal(reply.complete, true);
  // From the job's start to the label's last update.
  assert.equal(reply.timing?.duration_seconds, "22");
  assert.deepEqual(reply.media, [
    {
      kind: "image",
      model: null,
      count: 1,
      width: 1254,
      height: 1254,
      outcome: "returned",
    },
  ]);
  assert.equal(done.selectedLeafId, uid(3));
  // A turn ends only once every job's images are final.
  const second = row(
    5,
    "tool",
    { content_type: "multimodal_text", parts: [] },
    {
      parent: 3,
      channel: "final",
      author: { role: "tool", name: "t2uay3k.sj1i4kz" },
      metadata: {
        async_source: "image-job",
        ghostrider: { status: "intermediate" },
      },
    },
  );
  assert.deepEqual(
    parse(page([root(), prompt, job("final"), second])).messages.map(
      (m) => m.role,
    ),
    ["prompt"],
  );
  // An answer after the job does not rename the turn the live capture named by the job.
  const answered = parse(
    page([
      root(),
      prompt,
      job("final"),
      final(5, "Here it is", { request: R2, parent: 3 }),
    ]),
  ).messages[1]!;
  assert.equal(answered.sourceId, uid(3));
  assert.equal(answered.text, "Here it is");
  // While that answer is still written the reply is incomplete, although its image is
  // final; the next read completes it.
  const writing = parse(
    page([
      root(),
      prompt,
      job("final"),
      final(5, "Here it", {
        request: R2,
        parent: 3,
        end_turn: false,
        status: "in_progress",
        metadata: { is_complete: false },
      }),
    ]),
  ).messages[1]!;
  assert.equal(writing.sourceId, uid(3));
  assert.equal(writing.complete, false);
  // A connector call is not an image job and never names a turn.
  const connector = parse(
    page([
      root(),
      prompt,
      job("final", { author: { role: "tool", name: "api_tool.call_tool" } }),
      label,
    ]),
  );
  assert.deepEqual(
    connector.messages.map((m) => m.role),
    ["prompt"],
  );
});

test("Deep Research counts its plan and report under the research model with the research span (E1)", () => {
  const state = (value: unknown) => ({
    chatgpt_sdk: { widget_state: JSON.stringify(value) },
  });
  const research = (widget: Row) => [
    root(),
    row(2, "user", text("Research this"), { request: R1, parent: 1 }),
    row(
      3,
      "assistant",
      { content_type: "code", text: '{"topic":"heat pumps"}' },
      {
        request: R1,
        parent: 2,
        recipient: "api_tool.call_tool",
        update_time: 1767261604,
      },
    ),
    row(4, "tool", text("{}"), {
      request: R1,
      parent: 3,
      author: { role: "tool", name: "api_tool.call_tool" },
      metadata: widget,
    }),
  ];
  const finished = {
    plan: [{ title: "Find sources", reason: "Facts first" }, "Compare"],
    research_started_at: 1767261700,
    research_stopped_at: 1767261760.5,
    report_message: {
      content: { content_type: "text", parts: ["Report ", "body"] },
      metadata: { resolved_model_slug: "gpt-5-thinking" },
    },
  };
  const reply = parse(page(research(state(finished)))).messages[1]!;
  assert.equal(reply.sourceId, uid(3));
  assert.equal(reply.text, "");
  assert.equal(reply.toolInput, "heat pumps");
  assert.equal(reply.complete, true);
  // The research model's span times its component; the reply itself is not timed.
  assert.equal(reply.timing, null);
  assert.deepEqual(reply.components, [
    {
      role: "research",
      model: "gpt-5-thinking",
      text: "Find sources\nFacts first\nCompare\nReport body",
      outputTokens: null,
      timing: {
        duration_seconds: "60.5",
        source: "chatgpt_history",
        scope: "research_task",
        completeness: "complete_for_scope",
        profile_version: "timing-observation-1",
      },
    },
  ]);
  assert.deepEqual(reply.coverageReasons, ["research_work_unobserved"]);
  // A run still in progress is read again once it ends.
  const runningPage = parse(
    page(
      research(
        state({ plan: ["Find sources"], research_started_at: 1767261700 }),
      ),
    ),
  );
  assert.deepEqual(
    runningPage.messages.map((m) => m.role),
    ["prompt"],
  );
  // A research state in an unknown shape leaves the reply partial, never guessed.
  const odd = parse(page(research(state({ ...finished, report_message: 5 }))))
    .messages[1]!;
  assert.equal(odd.components, undefined);
  assert.deepEqual([...odd.coverageReasons!].sort(), [
    "research_work_unobserved",
    "unknown_event_observed",
  ]);
  // Another app's widget state is not research.
  const other = parse(
    page([
      ...research(state({ track: "x" })),
      final(5, "Done", { request: R1, parent: 4 }),
    ]),
  ).messages[1]!;
  assert.equal(other.components, undefined);
  assert.equal(other.coverageReasons, undefined);
});

test("voice turns count their transcripts, and a voice reply's speech follows its characters (A9, EP1)", () => {
  const transcript = (words: string, direction: string) => ({
    content_type: "multimodal_text",
    parts: [
      { content_type: "audio_transcription", text: words, direction },
      {
        content_type: "audio_asset_pointer",
        asset_pointer: "sediment://audio",
      },
    ],
  });
  const result = parse(
    page([
      root(),
      row(2, "user", transcript("Hello", "in"), { request: R1, parent: 1 }),
      row(3, "assistant", transcript("Hi there friend", "out"), {
        request: R1,
        parent: 2,
        end_turn: true,
        update_time: 1767261606,
        metadata: { model_slug: "bidi" },
      }),
    ]),
  );
  const [prompt, reply] = result.messages;
  assert.equal(prompt!.text, "Hello");
  assert.deepEqual(prompt!.inputImages, []);
  assert.equal(reply!.text, "Hi there friend");
  assert.equal(reply!.modelId, "bidi");
  assert.deepEqual(reply!.media, [
    { kind: "speech", basis: "characters", seconds: null, characters: 15 },
  ]);
});

test("uploaded images keep their sizes on the prompt, and an unknown part leaves them unknown (A7)", () => {
  const prompt = (parts: unknown[]) =>
    parse(
      page([
        root(),
        row(
          2,
          "user",
          { content_type: "multimodal_text", parts },
          { request: R1, parent: 1 },
        ),
        final(3, "Seen", { request: R1, parent: 2 }),
      ]),
    ).messages[0]!;
  const sized = prompt([
    {
      content_type: "image_asset_pointer",
      asset_pointer: "file-service://a",
      width: 800,
      height: 600,
    },
    { content_type: "image_asset_pointer", asset_pointer: "file-service://b" },
    "Describe",
  ]);
  assert.equal(sized.text, "Describe");
  assert.deepEqual(sized.inputImages, [
    { width: 800, height: 600 },
    { width: null, height: null },
  ]);
  const odd = prompt([{ content_type: "new_kind" }, "Describe"]);
  assert.equal(odd.inputImages, undefined);
  assert.equal(odd.text, null);
});

test("a turn cut by the page's start keeps its answer and leaves its other parts unknown", () => {
  const rows = [
    row(
      3,
      "assistant",
      { content_type: "thoughts", thoughts: [{ summary: "Late" }] },
      { request: R0 },
    ),
    row(
      4,
      "tool",
      { content_type: "execution_output", text: "partial" },
      { request: R0, parent: 3 },
    ),
    final(5, "Earlier answer", { request: R0, parent: 4 }),
    row(6, "user", text("Next"), { request: R1, parent: 5 }),
    final(7, "Reply", { request: R1, parent: 6 }),
  ];
  const result = parse(
    page(rows, {
      page_info: {
        start_cursor: rows[0]!.id,
        end_cursor: rows.at(-1)!.id,
        has_previous_page: true,
        has_next_page: false,
      },
    }),
  );
  assert.equal(result.hasEarlier, true);
  const cut = result.messages[0]!;
  assert.equal(cut.sourceId, uid(5));
  assert.equal(cut.text, "Earlier answer");
  // Its start is on the earlier page, so its span here would be too short.
  assert.equal(cut.timing, null);
  assert.ok(result.messages[2]!.timing);
  for (const key of [
    "thinking",
    "toolInput",
    "intermediate",
    "toolOutput",
  ] as const)
    assert.equal(Object.hasOwn(cut, key), false, key);
  assert.equal(result.messages[1]!.parentSourceId, uid(5));
  assert.equal(result.messages[1]!.parentRole, "response");
});

test("rows without a request join their turn, regenerated answers are separate, a repeated request fails", () => {
  const grouped = parse(
    page([
      root(),
      row(2, "user", text("Q"), { request: R1, parent: 1 }),
      row(
        3,
        "assistant",
        { content_type: "thoughts", thoughts: [{ summary: "S" }] },
        { parent: 2 },
      ),
      final(4, "A", { request: R1, parent: 3 }),
      // A regenerated answer is its own reply under the same prompt.
      final(5, "B", { request: R2, parent: 2 }),
    ]),
  );
  assert.deepEqual(
    grouped.messages.map((m) => [m.role, m.sourceId, m.text]),
    [
      ["prompt", uid(2), "Q"],
      ["response", uid(4), "A"],
      ["response", uid(5), "B"],
    ],
  );
  assert.equal(grouped.messages[1]!.thinking, "S");
  assert.equal(grouped.messages[1]!.promptSourceId, uid(2));
  assert.equal(grouped.messages[2]!.parentSourceId, uid(2));
  assert.equal(grouped.messages[2]!.promptSourceId, null);
  // A request whose reply was already reported would split one reply in two.
  assert.equal(
    parse(
      page([
        root(),
        row(2, "user", text("Q"), { request: R1, parent: 1 }),
        final(3, "A", { request: R1, parent: 2 }),
        row(4, "user", text("Q2"), { request: R2, parent: 3 }),
        final(5, "B", { request: R2, parent: 4 }),
        final(6, "late", { request: R1, parent: 5 }),
      ]),
    ).status,
    "unsupported",
  );
});

// Saved chats begun since about 18 Oct 2026 (live, 20 Oct 2026, the test account's GPT-6 Pro
// chats): the first prompt has a request id and no parent, its reply's rows have no request id,
// and the first reply row's parent is a row the page does not include. Every row of the turn
// carries the turn_exchange_id of its prompt. The reply then named neither its prompt nor its
// parent, so the prompt counted "without a named model".
test("20 Oct 2026: a saved first reply whose parent is off the page names the prompt of its turn", () => {
  const T1 = uid(7001),
    T2 = uid(7002);
  const turn = (id: string) => ({ turn_exchange_id: id, working_turn_id: id });
  const rows = [
    row(2, "user", text("Q"), { request: R1, metadata: turn(T1) }),
    row(
      3,
      "assistant",
      { content_type: "thoughts", thoughts: [{ summary: "S" }] },
      { parent: 99, metadata: { ...turn(T1), model_slug: "gpt-6-pro" } },
    ),
    row(4, "assistant", { content_type: "reasoning_recap", content: "Thought for 4s" }, {
      parent: 3,
      metadata: { ...turn(T1), model_slug: "gpt-6-pro" },
    }),
    final(5, "A", { parent: 4, metadata: { ...turn(T1), model_slug: "gpt-6-pro" } }),
    row(6, "user", text("Q2"), { request: R2, parent: 5, metadata: turn(T2) }),
    final(7, "B", { parent: 6, metadata: { ...turn(T2), model_slug: "gpt-6-pro" } }),
  ];
  const linked = parse(page(rows));
  assert.deepEqual(
    linked.messages.map((m) => [m.role, m.sourceId, m.text, m.parentSourceId, m.parentRole]),
    [
      ["prompt", uid(2), "Q", null, null],
      ["response", uid(5), "A", uid(2), "prompt"],
      ["prompt", uid(6), "Q2", uid(5), "response"],
      ["response", uid(7), "B", uid(6), "prompt"],
    ],
  );
  // Only the link is new: without the turn ids every message and figure is the same.
  const plain = parse(
    page(rows.map((r) => ({ ...r, metadata: { ...r.metadata, turn_exchange_id: undefined } }))),
  );
  assert.equal(plain.messages[1]!.parentSourceId, null, "without the turn id it stays unlinked");
  const figures = (result: typeof linked) =>
    result.messages.map(({ parentSourceId, parentRole, ...rest }) => rest);
  assert.deepEqual(figures(linked), figures(plain));
  assert.equal(linked.firstRequestVerified, plain.firstRequestVerified);

  // A reply of another turn than the prompt before it is not linked to that prompt.
  const other = parse(
    page([
      row(2, "user", text("Q"), { request: R1, metadata: turn(T1) }),
      final(5, "A", { parent: 99, metadata: turn(T2) }),
    ]),
  );
  assert.equal(other.messages[1]!.parentSourceId, null);
  // Nor is a reply whose prompt is not on the page.
  const cut = parse(
    page([final(5, "A", { parent: 99, metadata: turn(T1) })], {
      page_info: {
        start_cursor: uid(5),
        end_cursor: uid(5),
        has_previous_page: true,
        has_next_page: false,
      },
    }),
  );
  assert.equal(cut.messages[0]!.parentSourceId, null);
  // Two prompts with the same turn id leave it unknown.
  const twice = parse(
    page([
      row(2, "user", text("Q"), { request: R1, metadata: turn(T1) }),
      final(3, "A", { request: R1, parent: 2, metadata: turn(T1) }),
      row(4, "user", text("Q2"), { request: R2, parent: 3, metadata: turn(T1) }),
      final(5, "B", { parent: 99, metadata: turn(T1) }),
    ]),
  );
  assert.equal(twice.messages[3]!.parentSourceId, null);
});

test("hidden context alone is no reply, and the selected row maps to the message that holds it", () => {
  const result = parse(
    page([
      root(),
      row(
        2,
        "assistant",
        { content_type: "model_editable_context", model_set_context: "" },
        {
          request: R1,
          parent: 1,
          metadata: { is_visually_hidden_from_conversation: true },
        },
      ),
      row(3, "user", text("Q"), { request: R1, parent: 2 }),
      final(4, "A", { request: R1, parent: 3 }),
      row(5, "system", text(""), {
        request: R1,
        parent: 4,
        metadata: { is_visually_hidden_from_conversation: true },
      }),
    ]),
  );
  assert.deepEqual(
    result.messages.map((m) => m.role),
    ["prompt", "response"],
  );
  assert.equal(result.messages[0]!.parentSourceId, null);
  assert.equal(result.selectedLeafId, uid(4));
});

test("a long reply fits one counting batch: tool results go first, and a part left out stays unknown", () => {
  // Sizes in units of the limits of 13 October (262,144 per field), scaled to today's.
  const scale = HISTORY_LIMITS.messageUnits / 262144;
  const big = (n: number) => "x".repeat(n * scale);
  const reply = parse(
    page([
      root(),
      row(2, "user", text("Q"), { request: R1, parent: 1 }),
      row(
        3,
        "assistant",
        { content_type: "thoughts", thoughts: [{ content: big(200000) }] },
        {
          request: R1,
          parent: 2,
        },
      ),
      row(
        4,
        "assistant",
        { content_type: "code", text: big(200000) },
        {
          request: R1,
          parent: 3,
          recipient: "container.exec",
        },
      ),
      row(
        5,
        "tool",
        { content_type: "execution_output", text: big(100000) },
        { request: R1, parent: 4 },
      ),
      row(
        6,
        "tool",
        { content_type: "execution_output", text: big(300000) },
        { request: R1, parent: 5 },
      ),
      final(7, big(150000), { request: R1, parent: 6 }),
    ]),
  ).messages[1]!;
  // Tool results above one field's limit are unknown on their own.
  assert.equal(Object.hasOwn(reply, "toolOutput"), false);
  // An empty part costs nothing and stays known.
  assert.equal(reply.intermediate, "");
  assert.equal(Object.hasOwn(reply, "toolInput"), false);
  assert.equal(reply.thinking!.length, 200000 * scale);
  assert.equal(reply.text!.length, 150000 * scale);
  assert.ok(historyMessageUnits(reply) <= HISTORY_LIMITS.textUnits);
  // The parts left out are named, never dropped silently.
  assert.ok(reply.coverageReasons?.includes("capture_limit_exceeded"));
});

test("a saved message that ends the turn on another channel names the turn with unknown text", () => {
  const result = parse(
    page([
      root(),
      row(2, "user", text("Question"), { request: R1, parent: 1 }),
      row(3, "assistant", text("Looking"), {
        request: R1,
        parent: 2,
        channel: "commentary",
      }),
      row(
        4,
        "assistant",
        { content_type: "new_kind" },
        {
          request: R1,
          parent: 3,
          channel: "analysis",
          end_turn: true,
          update_time: 1767261605,
          metadata: { is_complete: true },
        },
      ),
      row(5, "user", text("Next"), { request: R2, parent: 4 }),
      final(6, "Reply", { request: R2, parent: 5 }),
    ]),
  );
  const reply = result.messages[1]!;
  assert.equal(reply.sourceId, uid(4));
  assert.equal(reply.text, null);
  assert.equal(reply.complete, false);
  assert.deepEqual(reply.coverageReasons, ["unknown_event_observed"]);
  assert.equal(result.messages[2]!.parentSourceId, uid(4));
});

test("a saved final of a content type not yet seen ends its turn with unknown text", () => {
  const unseen = row(
    4,
    "assistant",
    { content_type: "new_kind" },
    {
      request: R1,
      parent: 3,
      channel: "final",
      end_turn: true,
      update_time: 1767261605,
      metadata: { is_complete: true },
    },
  );
  const result = parse(
    page([
      root(),
      row(2, "user", text("Question"), { request: R1, parent: 1 }),
      row(3, "assistant", text("Looking"), {
        request: R1,
        parent: 2,
        channel: "commentary",
      }),
      unseen,
      row(5, "user", text("Next"), { request: R2, parent: 4 }),
      final(6, "Reply", { request: R2, parent: 5 }),
    ]),
  );
  const reply = result.messages[1]!;
  assert.equal(reply.sourceId, uid(4));
  assert.equal(reply.liveAttemptId, uid(4));
  // Unknown, not zero, and so not complete.
  assert.equal(reply.text, null);
  assert.equal(reply.complete, false);
  assert.deepEqual(reply.coverageReasons, ["unknown_event_observed"]);
  // The next prompt names the unseen final as its parent.
  assert.equal(result.messages[2]!.parentSourceId, uid(4));
});
