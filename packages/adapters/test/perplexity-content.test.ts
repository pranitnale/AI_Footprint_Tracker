import assert from "node:assert/strict";
import test from "node:test";
import { safeJson } from "@footprint/capture-core";
import {
  GENERATED_TEXT_LIMITS,
  HISTORY_LIMITS,
  parseDispatch,
  parseHistoryText,
  PerplexitySession,
} from "../src";
import { LIMITS } from "@footprint/capture-core";

// Synthetic entries in the shapes seen on 9 Sep, 14 Sep and 3 Oct 2026 (W7).
const reply = "11111111-1111-4111-8111-111111111111";
const request = "22222222-2222-4222-8222-222222222222";
const thread = "33333333-3333-4333-8333-333333333333";
const at = "2026-10-04T12:00:00.000Z";
const frame = (value: unknown, event = "message") => ({
  value,
  event,
  data: JSON.stringify(value),
});
const text = (variant: string, value: string, streaming = false) => ({
  id: `${variant}-${value.length}`,
  type: "WORKFLOW_ITEM_TEXT",
  variant,
  payload: {
    text_payload: {
      text: streaming ? "" : value,
      chunks: [value],
      variant,
      is_streaming: streaming,
    },
  },
});
const queries = (...values: unknown[]) => ({
  id: "queries",
  type: "WORKFLOW_ITEM_QUERIES",
  payload: { queries: values },
});
const sources = { id: "sources", type: "WORKFLOW_ITEM_SOURCES", payload: {} };
const workflow = (...items: unknown[]) => ({
  steps: [{ id: "step", status: "WORKFLOW_COMPLETED", items }],
});
const terminal = {
  status: "COMPLETED",
  final: true,
  final_sse_message: true,
  text_completed: true,
};
/** A saved thread of one entry holding these blocks. */
const saved = (blocks: unknown[], status = "COMPLETED") => ({
  status: "success",
  entries: [
    {
      uuid: request,
      frontend_uuid: request,
      backend_uuid: reply,
      thread_url_slug: thread,
      status,
      query_str: "Synthetic question",
      display_model: "gpt6_1_sol",
      user_selected_model: "gpt6_1_sol",
      entry_created_datetime: "2026-10-04T11:59:50.000001+00:00",
      entry_updated_datetime: "2026-10-04T11:59:58.000001+00:00",
      blocks,
    },
  ],
});
const savedReply = (blocks: unknown[], status?: string) =>
  parseHistoryText("perplexity", saved(blocks, status), thread, at)
    .messages[1]!;
/** Whether a live reply is marked partial; snapshots also carry standing limitations. */
const partial = (session: PerplexitySession) =>
  session.snapshot().limitations.includes("unknown_event_observed");

test("Perplexity reads a thinking model's workflow live and saved by one rule", () => {
  const final = workflow(
    queries("first query", { query: "second query" }),
    sources,
    text("worker", "Checking the sources"),
    text("thought", "A shown thought"),
    text("answer", "The answer"),
  );
  const session = new PerplexitySession();
  // The first workflow arrives as a root replace (9 Sep), then grows by patches.
  session.frame(
    frame({
      backend_uuid: reply,
      uuid: request,
      status: "PENDING",
      display_model: "gpt6_1_sol",
      blocks: [
        {
          intended_usage: "workflow_root",
          diff_block: {
            field: "workflow_block",
            patches: [
              {
                op: "replace",
                path: "",
                value: workflow(text("answer", "The ", true)),
              },
            ],
          },
        },
      ],
    }),
  );
  assert.equal(session.snapshot().text, "The ");
  assert.equal(session.snapshot().outputId, reply);
  session.frame(
    frame({
      blocks: [
        {
          intended_usage: "workflow_root",
          diff_block: {
            field: "workflow_block",
            patches: [
              {
                op: "add",
                path: "/steps/0/items/0/payload/text_payload/chunks/1",
                value: "answer",
              },
            ],
          },
        },
      ],
    }),
  );
  assert.equal(session.snapshot().text, "The answer");
  session.frame(
    frame({
      ...terminal,
      blocks: [
        { intended_usage: "workflow_root", workflow_block: final },
        // The plan's goal repeats the answer and is not counted.
        { intended_usage: "plan", plan_block: { goal: "The answer" } },
        { intended_usage: "sources_answer_mode", sources_mode_block: {} },
      ],
    }),
  );
  const live = session.snapshot();
  assert.equal(live.state, "completed");
  assert.equal(live.text, "The answer");
  assert.equal(live.thinking, "A shown thought");
  assert.equal(live.intermediate, "Checking the sources");
  assert.equal(live.toolInput, "first query\nsecond query");
  // Search results are not read, so they stay unknown rather than zero.
  assert.equal(live.toolOutput, undefined);
  assert.equal(live.searchOperations, 2);
  assert.equal(live.model, "gpt6_1_sol");
  assert.equal(partial(session), false);
  const history = savedReply([
    { intended_usage: "workflow_root", workflow_block: final },
    { intended_usage: "plan", plan_block: { goal: "The answer" } },
  ]);
  assert.equal(history.text, live.text);
  assert.equal(history.thinking, live.thinking);
  assert.equal(history.intermediate, live.intermediate);
  assert.equal(history.toolInput, live.toolInput);
  assert.equal(history.toolOutput, undefined);
  assert.equal(history.liveAttemptId, live.outputId);
  assert.equal(history.modelId, "gpt6_1_sol");
  assert.equal(history.complete, true);
  assert.equal(history.timing?.duration_seconds, "8");
  assert.equal(history.coverageReasons, undefined);
});

test("Perplexity without search counts no tool results and shows no thinking as empty", () => {
  const blocks = [
    {
      intended_usage: "workflow_root",
      workflow_block: workflow(text("answer", "Plain")),
    },
  ];
  const session = new PerplexitySession();
  session.frame(frame({ ...terminal, backend_uuid: reply, blocks }));
  const live = session.snapshot();
  assert.equal(live.toolOutput, "");
  assert.equal(live.toolInput, "");
  assert.equal(live.intermediate, "");
  assert.equal(live.thinking, "");
  assert.equal(live.searchOperations, null);
  const history = savedReply(blocks);
  assert.equal(history.toolOutput, "");
  assert.equal(history.thinking, "");
  // A web results block alone also means the model read search results.
  const searched = new PerplexitySession();
  searched.frame(
    frame({
      ...terminal,
      blocks: [...blocks, { intended_usage: "web_results", web: [] }],
    }),
  );
  assert.equal(searched.snapshot().toolOutput, undefined);
});

test("Perplexity Deep research and Best answers in identical markdown blocks count once", () => {
  const markdown = (answer: string) => [
    { intended_usage: "ask_text_0_markdown", markdown_block: { answer } },
    { intended_usage: "ask_text", markdown_block: { answer } },
  ];
  const session = new PerplexitySession();
  session.frame(
    frame({
      backend_uuid: reply,
      blocks: [
        {
          intended_usage: "ask_text_0_markdown",
          markdown_block: { chunks: ["Rep"] },
        },
      ],
    }),
  );
  assert.equal(session.snapshot().text, "Rep");
  session.frame(
    frame({
      blocks: [
        {
          intended_usage: "ask_text_0_markdown",
          diff_block: {
            field: "markdown_block",
            patches: [{ op: "add", path: "/chunks/1", value: "ort" }],
          },
        },
      ],
    }),
  );
  assert.equal(session.snapshot().text, "Report");
  session.frame(frame({ ...terminal, blocks: markdown("Report") }));
  assert.equal(session.snapshot().text, "Report");
  assert.equal(partial(session), false);
  assert.equal(savedReply(markdown("Report")).text, "Report");
  assert.equal(savedReply(markdown("Report")).coverageReasons, undefined);
  // A copy that disagrees is not added; the reply is partial.
  const differs = [
    { intended_usage: "ask_text", markdown_block: { answer: "Report" } },
    {
      intended_usage: "ask_text_0_markdown",
      markdown_block: { answer: "Other" },
    },
  ];
  assert.equal(savedReply(differs).text, "Report");
  assert.deepEqual(savedReply(differs).coverageReasons, [
    "unknown_event_observed",
  ]);
  // Both shapes with the same answer count it once; a different one is partial.
  const both = (answer: string) => [
    {
      intended_usage: "workflow_root",
      workflow_block: workflow(text("answer", "Report")),
    },
    { intended_usage: "ask_text", markdown_block: { answer } },
  ];
  assert.equal(savedReply(both("Report")).text, "Report");
  assert.equal(savedReply(both("Report")).coverageReasons, undefined);
  assert.equal(savedReply(both("Else")).text, "Report");
  assert.deepEqual(savedReply(both("Else")).coverageReasons, [
    "unknown_event_observed",
  ]);
});

test("Perplexity counts what it knows and marks unknown items, variants and frames partial", () => {
  const known = text("answer", "Counted");
  for (const extra of [
    { id: "t", type: "WORKFLOW_ITEM_TABLE", payload: {} },
    { id: "q", type: "WORKFLOW_ITEM_USER_QUESTIONS", payload: {} },
    text("summary", "Unknown variant"),
    { id: "n", type: "WORKFLOW_ITEM_NEW_KIND" },
    "not an item",
  ]) {
    const blocks = [
      {
        intended_usage: "workflow_root",
        workflow_block: workflow(known, extra),
      },
    ];
    const session = new PerplexitySession();
    session.frame(frame({ ...terminal, blocks }));
    assert.equal(session.snapshot().text, "Counted");
    assert.equal(partial(session), true);
    assert.equal(savedReply(blocks).text, "Counted");
    assert.deepEqual(savedReply(blocks).coverageReasons, [
      "unknown_event_observed",
    ]);
  }
  // A frame of an unknown shape is not a failure.
  const session = new PerplexitySession();
  session.frame(frame({ something: "new" }));
  session.frame(
    frame({
      ...terminal,
      blocks: [
        {
          intended_usage: "workflow_root",
          workflow_block: workflow(known),
        },
      ],
    }),
  );
  assert.equal(session.snapshot().text, "Counted");
  assert.equal(partial(session), true);
  // Silent items carry nothing the model wrote.
  const silent = [
    {
      intended_usage: "workflow_root",
      workflow_block: workflow(
        known,
        { id: "p", type: "WORKFLOW_ITEM_GENERATION_PLACEHOLDER" },
        { id: "f", type: "WORKFLOW_ITEM_EMBEDDED_IFRAME" },
        { id: "u", type: "WORKFLOW_ITEM_USER_RESPONSE" },
      ),
    },
  ];
  assert.equal(savedReply(silent).coverageReasons, undefined);
});

test("Perplexity reads nested workflows to a bounded depth", () => {
  const nested = (depth: number): unknown =>
    depth === 0
      ? text("answer", "Deep")
      : {
          id: `w${depth}`,
          type: "WORKFLOW_ITEM_WORKFLOW",
          payload: { workflow: workflow(nested(depth - 1)) },
        };
  const blocks = (depth: number) => [
    {
      intended_usage: "workflow_root",
      workflow_block: workflow(nested(depth)),
    },
  ];
  assert.equal(savedReply(blocks(2)).text, "Deep");
  assert.equal(savedReply(blocks(2)).coverageReasons, undefined);
  const deep = savedReply(blocks(6));
  assert.equal(deep.text, null);
  // A workflow item without steps holds a shape not yet seen.
  const empty = [
    {
      intended_usage: "workflow_root",
      workflow_block: workflow(text("answer", "Top"), {
        id: "w",
        type: "WORKFLOW_ITEM_WORKFLOW",
        payload: {},
      }),
    },
  ];
  assert.deepEqual(savedReply(empty).coverageReasons, [
    "unknown_event_observed",
  ]);
});

test("A nested workflow sent whole as a root replace passes the frame limits", () => {
  const value = {
    blocks: [
      {
        intended_usage: "workflow_root",
        diff_block: {
          field: "workflow_block",
          patches: [
            {
              op: "replace",
              path: "",
              value: workflow({
                id: "w",
                type: "WORKFLOW_ITEM_WORKFLOW",
                payload: { workflow: workflow(text("answer", "Deep")) },
              }),
            },
          ],
        },
      },
    ],
  };
  const session = new PerplexitySession();
  session.frame({
    event: "message",
    data: "",
    value: safeJson(JSON.stringify(value)),
  });
  assert.equal(session.snapshot().text, "Deep");
  assert.equal(partial(session), false);
});

test("Perplexity search queries are tool input only when every query item is readable", () => {
  const blocks = (...items: unknown[]) => [
    {
      intended_usage: "workflow_root",
      workflow_block: workflow(...items, text("answer", "Found")),
    },
  ];
  const nestedQuery = {
    id: "q2",
    type: "WORKFLOW_ITEM_QUERIES",
    payload: { search: { query: "nested query" } },
  };
  const readable = savedReply(blocks(queries("a", { text: "b" }), nestedQuery));
  assert.equal(readable.toolInput, "a\nb\nnested query");
  for (const unreadable of [
    queries(42),
    { id: "q", type: "WORKFLOW_ITEM_QUERIES", payload: { other: 1 } },
  ]) {
    const session = new PerplexitySession();
    session.frame(frame({ ...terminal, blocks: blocks(unreadable) }));
    const live = session.snapshot();
    assert.equal(live.toolInput, undefined);
    assert.equal(live.searchOperations, null);
    assert.equal(live.text, "Found");
    assert.equal(savedReply(blocks(unreadable)).toolInput, undefined);
  }
});

test("Perplexity videos count their prompt as tool input once and carry the video model", () => {
  const metadata = (prompt: unknown, model = "veo3_fast") => ({
    generated_media_metadata: { prompt, model_str: model },
  });
  const answer = {
    intended_usage: "workflow_root",
    workflow_block: workflow(text("answer", "Here is the video")),
  };
  const session = new PerplexitySession();
  session.frame(
    frame({
      backend_uuid: reply,
      blocks: [
        answer,
        {
          intended_usage: "media_items",
          media_block: { items: [metadata("A cat")] },
        },
      ],
    }),
  );
  // Another block names the same video, and a third video arrives only as a patch.
  session.frame(
    frame({
      ...terminal,
      blocks: [
        { intended_usage: "answer_generated_video", video: metadata("A cat") },
        {
          intended_usage: "unified_assets",
          diff_block: {
            field: "assets_block",
            patches: [
              { op: "replace", path: "", value: metadata("A dog", "sora2") },
            ],
          },
        },
      ],
    }),
  );
  const live = session.snapshot();
  assert.equal(live.toolInput, "A cat\nA dog");
  assert.deepEqual(
    live.media?.map((item) => [
      item.kind,
      item.model,
      item.width,
      item.durationSeconds,
      item.withAudio,
    ]),
    [
      ["video", "veo3_fast", null, null, null],
      ["video", "sora2", null, null, null],
    ],
  );
  assert.equal(partial(session), false);
  const history = savedReply([
    answer,
    {
      intended_usage: "media_items",
      media_block: { items: [metadata("A cat")] },
    },
    { intended_usage: "answer_generated_video", video: metadata("A cat") },
  ]);
  assert.equal(history.toolInput, "A cat");
  assert.deepEqual(history.media, [
    {
      kind: "video",
      model: "veo3_fast",
      width: null,
      height: null,
      durationSeconds: null,
      withAudio: null,
    },
  ]);
  // Metadata without a prompt is a shape not yet seen.
  const odd = savedReply([
    answer,
    { intended_usage: "media_items", media_block: metadata(null) },
  ]);
  assert.equal(odd.media, undefined);
  assert.deepEqual(odd.coverageReasons, ["unknown_event_observed"]);
});

test("Perplexity keeps a block whose patch cannot be applied partial until it arrives whole", () => {
  const session = new PerplexitySession();
  session.frame(
    frame({
      blocks: [
        {
          intended_usage: "workflow_root",
          workflow_block: workflow(text("answer", "Start ", true)),
        },
      ],
    }),
  );
  session.frame(
    frame({
      blocks: [
        {
          intended_usage: "workflow_root",
          diff_block: {
            field: "workflow_block",
            patches: [{ op: "move", path: "/steps/0", value: null }],
          },
        },
      ],
    }),
  );
  assert.equal(session.snapshot().text, "Start ");
  assert.equal(partial(session), true);
  // Later patches of the broken block are not applied to stale content.
  session.frame(
    frame({
      blocks: [
        {
          intended_usage: "workflow_root",
          diff_block: {
            field: "workflow_block",
            patches: [
              {
                op: "add",
                path: "/steps/0/items/0/payload/text_payload/chunks/1",
                value: "more",
              },
            ],
          },
        },
      ],
    }),
  );
  assert.equal(session.snapshot().text, "Start ");
  session.frame(
    frame({
      ...terminal,
      blocks: [
        {
          intended_usage: "workflow_root",
          workflow_block: workflow(text("answer", "Start and end")),
        },
      ],
    }),
  );
  assert.equal(session.snapshot().text, "Start and end");
  assert.equal(partial(session), false);
  // A patch of another block that cannot be applied may hide a video: partial too.
  const other = new PerplexitySession();
  other.frame(
    frame({
      ...terminal,
      blocks: [
        {
          intended_usage: "workflow_root",
          workflow_block: workflow(text("answer", "Done")),
        },
        {
          intended_usage: "media_items",
          diff_block: {
            field: "media_block",
            patches: [{ op: "add", path: "/x/y", value: 1 }],
          },
        },
      ],
    }),
  );
  assert.equal(other.snapshot().text, "Done");
  assert.equal(partial(other), true);
});

test("Perplexity block fields never reach an object's prototype", () => {
  const session = new PerplexitySession();
  const value = JSON.parse(
    '{"blocks":[{"intended_usage":"media_items","__proto__":{"polluted":true}},' +
      '{"intended_usage":"plan","diff_block":{"field":"__proto__","patches":[{"op":"add","path":"/polluted","value":true}]}}]}',
  );
  session.frame({ event: "message", data: "", value });
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(partial(session), true);
});

test("Perplexity saved replies stay incomplete until the entry is completed, and over-long parts stay unknown", () => {
  const blocks = (...items: unknown[]) => [
    {
      intended_usage: "workflow_root",
      workflow_block: workflow(...items, text("answer", "Text")),
    },
  ];
  const pending = savedReply(blocks(), "PENDING");
  assert.equal(pending.text, "Text");
  assert.equal(pending.complete, false);
  assert.equal(pending.timing, null);
  const long = "q".repeat(HISTORY_LIMITS.messageUnits + 1);
  const overLong = savedReply(blocks(queries(long)));
  assert.equal(overLong.text, "Text");
  assert.equal(overLong.toolInput, undefined);
  // A part left out for its size is named as such (14 Oct 2026).
  assert.deepEqual(overLong.coverageReasons, ["capture_limit_exceeded"]);
  // Parts that together pass one counting batch drop worker text before tool input.
  const worker = "w".repeat(HISTORY_LIMITS.messageUnits - 144);
  const query = "x".repeat(HISTORY_LIMITS.messageUnits - 144);
  const crowded = savedReply(
    blocks(
      text("worker", worker),
      queries(query),
      text("thought", "t".repeat(1000)),
    ),
  );
  assert.ok(worker.length + query.length + 1004 > HISTORY_LIMITS.textUnits);
  assert.equal(crowded.intermediate, undefined);
  assert.equal(crowded.toolInput, query);
  assert.equal(crowded.thinking, "t".repeat(1000));
  assert.deepEqual(crowded.coverageReasons, ["capture_limit_exceeded"]);
});

test("Perplexity review: unknown blocks mark the reply partial; the blocks seen on the page do not", () => {
  const answer = {
    intended_usage: "workflow_root",
    workflow_block: workflow(text("answer", "Known")),
  };
  const others = [
    "plan",
    "sources_answer_mode",
    "web_results",
    "answer_tabs",
    "pending_followups",
    "media_items",
    "answer_generated_video",
    "unified_assets",
    "assets_answer_mode",
  ].map((usage) => ({ intended_usage: usage, other_block: {} }));
  assert.equal(savedReply([answer, ...others]).coverageReasons, undefined);
  const future = {
    intended_usage: "future_answer",
    future_block: { text: "hidden output" },
  };
  const saved = savedReply([answer, future]);
  assert.equal(saved.text, "Known");
  assert.deepEqual(saved.coverageReasons, ["unknown_event_observed"]);
  const session = new PerplexitySession();
  session.frame(frame({ ...terminal, blocks: [answer, future] }));
  assert.equal(session.snapshot().text, "Known");
  assert.equal(partial(session), true);
  // A block without a usage, or an answer block sent twice, is not read.
  for (const odd of [{ workflow_block: {} }, answer])
    assert.deepEqual(savedReply([answer, odd]).coverageReasons, [
      "unknown_event_observed",
    ]);
});

test("Perplexity review: worker steps are separate texts, and finished copies must match exactly", () => {
  const steps = savedReply([
    {
      intended_usage: "workflow_root",
      workflow_block: workflow(
        text("worker", "Search"),
        text("worker", "Search more"),
        text("answer", "Answer"),
      ),
    },
  ]);
  assert.equal(steps.intermediate, "Search\nSearch more");
  const copies = (markdown: string) => [
    {
      intended_usage: "workflow_root",
      workflow_block: workflow(text("answer", "Report")),
    },
    { intended_usage: "ask_text", markdown_block: { answer: markdown } },
  ];
  // Saved and finished: a longer copy disagrees.
  const finished = savedReply(copies("Report complete"));
  assert.equal(finished.text, "Report");
  assert.deepEqual(finished.coverageReasons, ["unknown_event_observed"]);
  // Still streaming, one copy may run ahead of the other.
  const streaming = new PerplexitySession();
  streaming.frame(
    frame({ status: "PENDING", blocks: copies("Report complete") }),
  );
  assert.equal(partial(streaming), false);
  streaming.frame(frame({ ...terminal, blocks: copies("Report complete") }));
  assert.equal(streaming.snapshot().text, "Report");
  assert.equal(partial(streaming), true);
  // Not yet completed when saved: the same tolerance as live.
  assert.equal(
    savedReply(copies("Report complete"), "PENDING").coverageReasons,
    undefined,
  );
});

test("Perplexity review: a search step without a query and conflicting variants leave parts unknown", () => {
  const empty = savedReply([
    {
      intended_usage: "workflow_root",
      workflow_block: workflow(queries(), text("answer", "Found")),
    },
  ]);
  assert.equal(empty.toolInput, undefined);
  assert.deepEqual(empty.coverageReasons, ["unknown_event_observed"]);
  const session = new PerplexitySession();
  session.frame(
    frame({
      ...terminal,
      blocks: [
        {
          intended_usage: "workflow_root",
          workflow_block: workflow(queries(), text("answer", "Found")),
        },
      ],
    }),
  );
  assert.equal(session.snapshot().searchOperations, null);
  assert.equal(session.snapshot().toolInput, undefined);
  assert.equal(partial(session), true);
  const conflict = text("answer", "Which is it");
  conflict.payload.text_payload.variant = "thought";
  const mixed = savedReply([
    {
      intended_usage: "workflow_root",
      workflow_block: workflow(conflict, text("answer", "Kept")),
    },
  ]);
  assert.equal(mixed.text, "Kept");
  assert.equal(mixed.thinking, "");
  assert.deepEqual(mixed.coverageReasons, ["unknown_event_observed"]);
});

test("Perplexity review: a saved entry keeps its reply id, its first blocks and a unique id", () => {
  // Without its own id a reply cannot meet its live copy, so it is not counted here.
  const body = saved([
    {
      intended_usage: "workflow_root",
      workflow_block: workflow(text("answer", "Orphan")),
    },
  ]);
  delete (body.entries[0] as any).backend_uuid;
  const orphan = parseHistoryText("perplexity", body, thread, at).messages[1]!;
  assert.equal(orphan.text, null);
  assert.equal(orphan.liveAttemptId, null);
  assert.deepEqual(orphan.coverageReasons, ["unknown_event_observed"]);
  // Past the block bound the first blocks still count; the reply is partial.
  const many = savedReply([
    {
      intended_usage: "workflow_root",
      workflow_block: workflow(text("answer", "First block")),
    },
    ...Array.from({ length: HISTORY_LIMITS.blocks }, () => ({
      intended_usage: "plan",
      plan_block: {},
    })),
  ]);
  assert.equal(many.text, "First block");
  assert.equal(many.liveAttemptId, reply);
  assert.deepEqual(many.coverageReasons, ["capture_limit_exceeded"]);
  // Two entries naming one reply are not a thread this reader knows.
  const twice = saved([
    {
      intended_usage: "workflow_root",
      workflow_block: workflow(text("answer", "One")),
    },
  ]);
  twice.entries.push({
    ...twice.entries[0]!,
    uuid: "44444444-4444-4444-8444-444444444444",
    frontend_uuid: "44444444-4444-4444-8444-444444444444",
    entry_created_datetime: "2026-10-04T11:59:59.000001+00:00",
  });
  assert.equal(
    parseHistoryText("perplexity", twice, thread, at).status,
    "unsupported",
  );
});

test("Perplexity review: live parts past their bounds stay unknown instead of failing the reply", () => {
  const video = (index: number) => ({
    intended_usage: "media_items",
    media_block: {
      items: Array.from(
        { length: GENERATED_TEXT_LIMITS.media + 1 },
        (_, at) => ({
          generated_media_metadata: {
            prompt: `Video ${index}-${at}`,
            model_str: "veo3_fast",
          },
        }),
      ),
    },
  });
  const many = new PerplexitySession();
  many.frame(
    frame({
      ...terminal,
      blocks: [
        {
          intended_usage: "workflow_root",
          workflow_block: workflow(text("answer", "Videos")),
        },
        video(1),
      ],
    }),
  );
  assert.equal(many.snapshot().media?.length, GENERATED_TEXT_LIMITS.media);
  assert.equal(partial(many), true);
  const long = new PerplexitySession();
  long.frame(
    frame({
      ...terminal,
      blocks: [
        {
          intended_usage: "workflow_root",
          workflow_block: workflow(text("answer", "a".repeat(LIMITS.text + 1))),
        },
      ],
    }),
  );
  assert.equal(long.snapshot().text, null);
  assert.equal(partial(long), true);
});

test("Perplexity review: counting each answer once stays fast for many items", () => {
  // Items that share a long opening make each prefix check walk that opening.
  const opening = "The same opening of every part, kept under bounds.";
  const items = Array.from({ length: 4000 }, (_, index) =>
    text("answer", `${opening}${index}.`),
  );
  const started = performance.now();
  const reply = savedReply([
    { intended_usage: "workflow_root", workflow_block: workflow(...items) },
  ]);
  assert.ok(performance.now() - started < 1000);
  assert.equal(reply.text!.split("\n").length, 4000);
  // A prefix of another answer item still counts once.
  const prefix = savedReply([
    {
      intended_usage: "workflow_root",
      workflow_block: workflow(
        text("answer", "Partial"),
        text("answer", "Partial answer"),
        text("answer", "Partial answer"),
      ),
    },
  ]);
  assert.equal(prefix.text, "Partial answer");
});

test("Perplexity re-review: only the markdown usages seen are answers", () => {
  const unseen = savedReply([
    {
      intended_usage: "ask_text_1_markdown",
      markdown_block: { answer: "Unobserved shape" },
    },
  ]);
  assert.equal(unseen.text, null);
  assert.deepEqual(unseen.coverageReasons, ["unknown_event_observed"]);
  const seen = savedReply([
    { intended_usage: "ask_text", markdown_block: { answer: "Seen" } },
    {
      intended_usage: "ask_text_0_markdown",
      markdown_block: { answer: "Seen" },
    },
  ]);
  assert.equal(seen.text, "Seen");
  assert.equal(seen.coverageReasons, undefined);
});

test("Perplexity re-review: a saved reply keeps its id when its answer lies past the block bound", () => {
  const late = savedReply([
    ...Array.from({ length: HISTORY_LIMITS.blocks }, () => ({
      intended_usage: "plan",
      plan_block: {},
    })),
    {
      intended_usage: "workflow_root",
      workflow_block: workflow(text("answer", "Late answer")),
    },
  ]);
  assert.equal(late.text, null);
  assert.equal(late.liveAttemptId, reply);
  assert.deepEqual(late.coverageReasons, ["capture_limit_exceeded"]);
  // A reply that shows no answer yet keeps its id and needs no partial mark.
  const pending = savedReply([], "PENDING");
  assert.equal(pending.text, null);
  assert.equal(pending.liveAttemptId, reply);
  assert.equal(pending.coverageReasons, undefined);
});

test("Perplexity re-review: blocks that are not read give no videos", () => {
  const answer = {
    intended_usage: "workflow_root",
    workflow_block: workflow(text("answer", "Here is your video")),
  };
  const media = {
    generated_media_metadata: {
      prompt: "A bouncing ball",
      model_str: "veo3_fast",
    },
  };
  for (const odd of [
    { media_block: media },
    { intended_usage: "future_media", media_block: media },
  ]) {
    const saved = savedReply([answer, odd]);
    assert.equal(saved.media, undefined);
    assert.equal(saved.toolInput, "");
    assert.deepEqual(saved.coverageReasons, ["unknown_event_observed"]);
  }
  const live = new PerplexitySession();
  live.frame(
    frame({
      ...terminal,
      blocks: [answer, { intended_usage: "future_media", media_block: media }],
    }),
  );
  assert.equal(live.snapshot().media, undefined);
  assert.equal(live.snapshot().toolInput, "");
  assert.equal(partial(live), true);
  // The same metadata in a known media block counts.
  const known = savedReply([
    answer,
    { intended_usage: "media_items", media_block: media },
  ]);
  assert.equal(known.media?.length, 1);
  assert.equal(known.toolInput, "A bouncing ball");
});

test("Perplexity sends name their parent reply, and a send without attachments uploads no images", () => {
  const url = new URL("https://www.perplexity.ai/rest/sse/perplexity_ask");
  const send = (params: Record<string, unknown>) =>
    parseDispatch(
      "perplexity",
      url,
      JSON.stringify({ query_str: "Follow-up", params }),
    );
  const plain = send({
    last_backend_uuid: reply,
    frontend_uuid: request,
    attachments: [],
  });
  assert.equal(plain.parentId, reply);
  assert.equal(plain.requestId, request);
  assert.deepEqual(plain.inputImages, []);
  // Attachments travel as links without a size, so images stay unknown.
  const attached = send({ attachments: ["https://example.invalid/a.png"] });
  assert.equal(attached.attachments, 1);
  assert.equal(attached.inputImages, undefined);
  assert.equal(send({}).inputImages, undefined);
});

test("a Perplexity image counts once as an image with its size and prompt, live and saved, also without answer text (5 Oct 2026)", () => {
  // As seen live: the image is listed in the media block twice and in its own block, the
  // workflow has one image step and no answer text. Values are synthetic.
  const image = (status?: string) => ({
    medium: "image",
    url: "https://example.invalid/image.png",
    name: "image.png",
    source: "ask_engine",
    ...(status ? { status } : {}),
    generated_media_metadata: {
      prompt: "A red bicycle against a white wall",
      model_str: "gpt-4o-image",
    },
    image_width: 1536,
    image_height: 1024,
  });
  const blocks = [
    {
      intended_usage: "answer_tabs",
      answer_tabs_block: { modes: [{ answer_mode_type: "ANSWER" }] },
    },
    {
      intended_usage: "media_items",
      media_block: {
        media_items: [image()],
        generated_media_items: [image("COMPLETED")],
      },
    },
    {
      intended_usage: "answer_generated_image",
      inline_entity_block: {
        media_block: {
          media_items: [],
          generated_media_items: [image("COMPLETED")],
          progress: "DONE",
        },
      },
    },
    {
      intended_usage: "pending_followups",
      pending_followups_block: { followups: [] },
    },
    {
      intended_usage: "workflow_root",
      workflow_block: {
        steps: [
          {
            id: "step",
            status: "WORKFLOW_COMPLETED",
            tool_name: "generate_image",
            items: [sources],
          },
        ],
      },
    },
  ];
  const session = new PerplexitySession();
  session.frame(frame({ ...terminal, backend_uuid: reply, blocks }));
  const live = session.snapshot();
  // Not a video: no video estimate, one image of the stated size.
  assert.equal(live.media, undefined);
  assert.deepEqual(
    live.imageOperations.map((operation) => [
      operation.model,
      operation.outputs.map((output) => [output.width, output.height]),
    ]),
    [["gpt-4o-image", [[1536, 1024]]]],
  );
  assert.equal(live.toolInput, "A red bicycle against a white wall");
  assert.equal(live.started, true);
  assert.equal(partial(session), false);
  const history = savedReply(blocks);
  assert.equal(history.text, "");
  assert.equal(history.toolInput, "A red bicycle against a white wall");
  assert.deepEqual(history.media, [
    {
      kind: "image",
      model: "gpt-4o-image",
      count: 1,
      width: 1536,
      height: 1024,
      outcome: "returned",
    },
  ]);
  assert.equal(history.coverageReasons, undefined);
  // A video named without a medium stays a video (3 Oct shape).
  const video = savedReply([
    {
      intended_usage: "workflow_root",
      workflow_block: workflow(text("answer", "Here is the video")),
    },
    {
      intended_usage: "media_items",
      media_block: {
        items: [
          {
            generated_media_metadata: {
              prompt: "A cat",
              model_str: "veo3_fast",
            },
          },
        ],
      },
    },
  ]);
  assert.deepEqual(
    video.media?.map((item) => item.kind),
    ["video"],
  );
  // An unfinished entry without answer text still keeps nothing.
  assert.equal(savedReply(blocks, "PENDING").media, undefined);
  // An answer block it cannot read may hold the answer: no empty answer that would count
  // as a complete zero, only the partial marker.
  const unreadable = savedReply(
    blocks.map((block) =>
      block.intended_usage === "workflow_root"
        ? { ...block, workflow_block: {} }
        : block,
    ),
  );
  assert.equal(unreadable.text, null);
  assert.deepEqual(unreadable.coverageReasons, ["unknown_event_observed"]);
});

test("live and saved Perplexity replies apply one media bound to images and videos together", () => {
  const limit = GENERATED_TEXT_LIMITS.media;
  const items = (count: number, medium: string | null) =>
    Array.from({ length: count }, (_, index) => ({
      ...(medium ? { medium } : {}),
      generated_media_metadata: {
        prompt: `${medium ?? "video"} ${index}`,
        model_str: medium ? "gpt-4o-image" : "veo3_fast",
      },
    }));
  // With answer text, and with the media alone (an image request's shape).
  for (const answered of [true, false]) {
    const blocks = [
      {
        intended_usage: "workflow_root",
        workflow_block: answered
          ? workflow(text("answer", "Here they are"))
          : {
              steps: [
                {
                  id: "step",
                  status: "WORKFLOW_COMPLETED",
                  tool_name: "generate_image",
                  items: [sources],
                },
              ],
            },
      },
      {
        intended_usage: "media_items",
        media_block: {
          media_items: [...items(40, "image"), ...items(40, null)],
        },
      },
    ];
    const session = new PerplexitySession();
    session.frame(frame({ ...terminal, backend_uuid: reply, blocks }));
    const live = session.snapshot();
    const liveImages = live.imageOperations.flatMap(
      (operation) => operation.outputs,
    );
    assert.equal(liveImages.length, 40);
    assert.equal(live.media?.length, limit - 40);
    assert.equal(partial(session), true);
    const history = savedReply(blocks);
    assert.deepEqual(
      [
        history.media?.filter((item) => item.kind === "image").length,
        history.media?.filter((item) => item.kind === "video").length,
      ],
      [40, limit - 40],
    );
    assert.equal(history.text, answered ? "Here they are" : "");
    assert.equal(history.complete, true);
    assert.notEqual(history.coverageReasons, undefined);
  }
});
