import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  claudeHistoryRow,
  claudeResearchTask,
  HISTORY_LIMITS,
  parseHistoryText,
  type ClaudeResearchTask,
} from "../src/history";
import { decodedToolInput } from "../src/claude-content";

const id = "00000000-0000-4000-8000-000000000042";
const at = "2026-10-04T12:00:00.000Z";
const fixture = () =>
  JSON.parse(
    readFileSync(
      new URL(
        "../../../fixtures/history-observation-2026-09-14/claude-selected-history.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
const block = (value: Record<string, unknown>, start = 0, seconds = 1) => ({
  start_timestamp: new Date(Date.UTC(2026, 9, 4, 12, 0, start)).toISOString(),
  stop_timestamp: new Date(
    Date.UTC(2026, 9, 4, 12, 0, start + seconds),
  ).toISOString(),
  ...value,
});
const reply = (content: unknown[], changes: Record<string, unknown> = {}) => {
  const body = fixture();
  Object.assign(body.chat_messages[1], { content, ...changes });
  return body;
};
const saved = (body: unknown, research: ClaudeResearchTask[] = []) =>
  parseHistoryText("claude", body, id, at, undefined, research).messages;

test("a saved Claude reply counts visible thinking, decoded tool input, shown results and compaction text", () => {
  const body = reply(
    [
      block({
        type: "thinking",
        thinking: "",
        summaries: [{ summary: "Checked the sources" }],
      }),
      block({ type: "redacted_thinking", data: "opaque" }, 1),
      block({ type: "thinking", thinking: "Full visible reasoning" }, 2),
      block(
        {
          type: "tool_use",
          id: "t1",
          name: "create_file",
          input: { path: "notes.md", content: "Line one", overwrite: false },
        },
        3,
      ),
      block(
        {
          type: "tool_result",
          tool_use_id: "t1",
          content: [{ type: "text", text: "Created" }, { type: "image" }],
        },
        4,
      ),
      block(
        {
          type: "server_tool_use",
          id: "t2",
          name: "web_search",
          input: { query: "Weather" },
        },
        5,
      ),
      block(
        { type: "mcp_tool_use", id: "t3", name: "lookup", input: { limit: 3 } },
        6,
      ),
      block({ type: "flag", flag: "DISPLAY_ONLY" }, 7),
      block({ type: "text", text: "The answer." }, 8),
    ],
    {
      stop_reason: "compaction",
      compaction_summary: [
        block(
          { type: "text", text: "Summary of earlier turns", citations: [] },
          9,
          3,
        ),
      ],
    },
  );
  const response = saved(body)[1]!;
  assert.equal(response.text, "The answer.");
  // Thinking text wins over summaries; a summary-only block counts its summary (A2).
  assert.equal(
    response.thinking,
    "Checked the sources\nFull visible reasoning",
  );
  // Keys and JSON punctuation are protocol, not model text (A1).
  assert.equal(response.toolInput, "notes.md\nLine one\nfalse\nWeather\n3");
  assert.equal(response.toolOutput, "Created");
  assert.equal(response.intermediate, "Summary of earlier turns");
  // Every stop reason ends a saved reply (C6); compaction is timed with the blocks (E4).
  assert.equal(response.complete, true);
  assert.equal(response.timing?.duration_seconds, "12");
  assert.equal(response.timing?.scope, "content_blocks");
  assert.equal(Object.hasOwn(response, "coverageReasons"), false);
  assert.ok(!JSON.stringify(response).includes("DISPLAY_ONLY"));
});

test("a saved Claude reply without parts reads zero, unknown blocks are marked and long parts stay unknown", () => {
  const plain = saved(fixture())[1]!;
  assert.equal(plain.thinking, "");
  assert.equal(plain.toolInput, "");
  assert.equal(plain.toolOutput, "");
  assert.equal(plain.intermediate, "");
  const unknown = saved(
    reply([
      block({ type: "voice_note", title: "VOICE" }),
      block({ type: "text", text: "Answer" }, 1),
    ]),
  )[1]!;
  assert.deepEqual(unknown.coverageReasons, ["unknown_event_observed"]);
  assert.equal(unknown.text, "Answer");
  const long = saved(
    reply([
      block({
        type: "tool_use",
        id: "t",
        name: "create_file",
        input: { content: "x".repeat(HISTORY_LIMITS.messageUnits + 1) },
      }),
      block({ type: "text", text: "Done" }, 1),
    ]),
  )[1]!;
  assert.equal(Object.hasOwn(long, "toolInput"), false);
  assert.equal(long.toolOutput, "");
  // An untyped block leaves every part other than the answer unknown.
  const untyped = saved(
    reply([{ text: "x" }, block({ type: "text", text: "A" })]),
  )[1]!;
  assert.equal(untyped.text, "A");
  assert.equal(Object.hasOwn(untyped, "thinking"), false);
  // A compaction summary in an unknown shape is not read and cannot be timed, so the
  // reply's span would be too short: it has no timing.
  const unreadCompaction = saved(
    reply([block({ type: "text", text: "Answer" })], {
      stop_reason: "compaction",
      compaction_summary: [{ type: "text", text: 7 }],
    }),
  )[1]!;
  assert.equal(unreadCompaction.complete, true);
  assert.equal(Object.hasOwn(unreadCompaction, "intermediate"), false);
  assert.equal(unreadCompaction.timing, null);
});

test("tool input of any depth is decoded in document order", () => {
  const nested = (depth: number): unknown =>
    depth ? { before: `level ${depth}`, next: nested(depth - 1) } : "bottom";
  const decoded = decodedToolInput(nested(200)).split("\n");
  assert.equal(decoded.length, 201);
  assert.equal(decoded[0], "level 200");
  assert.equal(decoded.at(-1), "bottom");
  assert.equal(
    decodedToolInput({ a: ["x", 1, true, null, { b: "y" }], c: "z" }),
    "x\n1\ntrue\ny\nz",
  );
  // A Research report's artifact as saved on 5 Oct 2026 (values synthetic): the model
  // wrote the command, id, title, type and report; the page attached the citations and
  // the version id, which are not counted.
  const report = {
    command: "create",
    id: "wind_report",
    title: "Wind report",
    type: "text/markdown",
    language: null,
    content: "# Wind\nWind supplied a large share.",
    md_citations: [
      {
        uuid: "00000000-0000-4000-8000-000000000001",
        title: "Source",
        url: "https://example.invalid/a",
        metadata: { icon_url: "https://example.invalid/i.png" },
        sources: [{ title: "Source", url: "https://example.invalid/a" }],
        start_index: 0,
        end_index: 10,
      },
    ],
    source: "c",
    version_uuid: "00000000-0000-4000-8000-000000000002",
  };
  const written =
    "create\nwind_report\nWind report\ntext/markdown\n# Wind\nWind supplied a large share.\nc";
  assert.equal(decodedToolInput(report, "artifacts"), written);
  // Another tool, or the same names deeper in the input, are the model's own values.
  const all = decodedToolInput(report, "mcp_tool");
  assert.ok(
    all.includes("example.invalid") && all.includes("-8000-000000000002"),
  );
  assert.equal(
    decodedToolInput(
      { query: "draft", nested: { version_uuid: "v1" } },
      "artifacts",
    ),
    "draft\nv1",
  );
});

test("saved Claude stop reasons, empty answers and the chat model follow the decided rules", () => {
  const stopped = saved(
    reply([block({ type: "thinking", thinking: "Partial" })], {
      stop_reason: "user_canceled",
    }),
  )[1]!;
  // A reply stopped during thinking has no answer text, and its saved text is all there is.
  assert.equal(stopped.text, "");
  assert.equal(stopped.complete, true);
  const running = saved(
    reply([block({ type: "text", text: "So far" })], { stop_reason: null }),
  )[1]!;
  assert.equal(running.complete, false);
  assert.equal(running.timing, null);
  const body = fixture();
  body.model = "claude-opus-5-5";
  // History names only the chat's model; every message gets it (B5).
  assert.deepEqual(
    saved(body).map((message) => message.modelId),
    ["claude-opus-5-5", "claude-opus-5-5"],
  );
  body.model =
    "bad label with spaces and more than enough characters to fail { }";
  assert.deepEqual(
    saved(body).map((message) => message.modelId),
    [null, null],
  );
});

test("a Claude chat whose first prompt was edited proves its start from the selected branch", () => {
  // Editing the first prompt keeps the original prompt and reply (index 0 and 1) on the
  // replaced branch; the selected branch starts at the root with index 2 (live, 13 Oct 2026).
  const body = fixture();
  const [prompt, answer] = body.chat_messages;
  const edited = {
    ...prompt,
    uuid: "00000000-0000-4000-8000-000000000103",
    index: 2,
  };
  const editedAnswer = {
    ...answer,
    uuid: "00000000-0000-4000-8000-000000000104",
    index: 3,
    parent_message_uuid: edited.uuid,
  };
  body.chat_messages.push(edited, editedAnswer);
  body.current_leaf_message_uuid = editedAnswer.uuid;
  const page = parseHistoryText("claude", body, id, at);
  assert.equal(page.firstRequestVerified, true);
  assert.equal(page.rootSourceId, edited.uuid);
  assert.equal(page.selectedLeafId, editedAnswer.uuid);
  assert.deepEqual(page.branchSourceIds, [edited.uuid, editedAnswer.uuid]);
  // The replaced branch's prompt and reply are read too, each once and linked by parent
  // (owner rule of 26 Sep 2026: Req counts them).
  assert.equal(page.branchScope, "loaded_messages");
  assert.deepEqual(
    page.messages.map((m) => [m.sourceId, m.role, m.parentSourceId, m.promptSourceId]),
    [
      [prompt.uuid, "prompt", null, prompt.uuid],
      [answer.uuid, "response", prompt.uuid, prompt.uuid],
      [edited.uuid, "prompt", null, edited.uuid],
      [editedAnswer.uuid, "response", edited.uuid, edited.uuid],
    ],
  );
  // A loop among replaced rows is never followed forever; its reply names no prompt.
  const looped = fixture();
  const [, first] = looped.chat_messages;
  const loopA = { ...first, uuid: "00000000-0000-4000-8000-000000000106", parent_message_uuid: "00000000-0000-4000-8000-000000000107" };
  const loopB = { ...first, uuid: "00000000-0000-4000-8000-000000000107", parent_message_uuid: loopA.uuid };
  looped.chat_messages.push(loopA, loopB);
  const loopedPage = parseHistoryText("claude", looped, id, at);
  assert.equal(loopedPage.firstRequestVerified, true);
  assert.equal(loopedPage.messages.find((m) => m.sourceId === loopA.uuid)!.promptSourceId, null);
  // The proof still needs the root: a chain whose earliest prompt has a parent the page did
  // not send is not the start, even at index 0.
  const tail = fixture();
  tail.chat_messages[0].parent_message_uuid =
    "00000000-0000-4000-8000-000000000105";
  assert.equal(parseHistoryText("claude", tail, id, at).firstRequestVerified, false);
  // A truncated message on the selected branch still leaves the start unproven.
  body.chat_messages[2].truncated = true;
  assert.equal(parseHistoryText("claude", body, id, at).firstRequestVerified, false);
});

test("saved Claude prompts know whether images were uploaded but not their size", () => {
  const prompt = (changes: Record<string, unknown>) => {
    const body = fixture();
    Object.assign(body.chat_messages[0], changes);
    return saved(body)[0]!;
  };
  assert.deepEqual(prompt({ files: [] }).inputImages, []);
  assert.deepEqual(
    prompt({
      files: [
        { file_kind: "image", file_uuid: "f1" },
        { file_kind: "document", file_uuid: "f2" },
      ],
      files_v2: [{ file_kind: "image", file_uuid: "f1" }],
    }).inputImages,
    [{ width: null, height: null }],
  );
  // A file of an unknown kind, or ids alone, leave the images unknown.
  assert.equal(
    Object.hasOwn(
      prompt({ files: [{ file_kind: "spreadsheet" }] }),
      "inputImages",
    ),
    false,
  );
  assert.equal(Object.hasOwn(prompt({ files: ["f1"] }), "inputImages"), false);
  const body = fixture();
  delete body.chat_messages[0].files;
  assert.equal(Object.hasOwn(saved(body)[0]!, "inputImages"), false);
  assert.equal(Object.hasOwn(saved(fixture())[1]!, "inputImages"), false);
});

test("a Claude Research task reads only the agents' tool input and its own span", () => {
  const status = {
    status: "completed",
    started_at: "2026-10-04T12:00:00.000Z",
    completed_at: "2026-10-04T12:03:51.700Z",
    finished_at: "2026-10-04T12:03:55.700Z",
    model: null,
    thinking_blocks: [],
    agents: [
      {
        name: "AGENT_NAME",
        description: "AGENT_DESCRIPTION",
        calls: [
          {
            name: "web_search",
            tool_input: { query: "first query" },
            result: {
              title: "RESULT_TITLE",
              text: "RESULT_TEXT",
              tool_input: { query: "RESULT_QUERY" },
            },
            sources: [{ tool_input: { query: "SOURCE_QUERY" } }],
          },
          {
            name: "web_fetch",
            tool_input: { url: "https://example.invalid/a" },
          },
        ],
      },
      { name: "second", calls: [{ tool_input: { query: "second query" } }] },
    ],
  };
  const task = claudeResearchTask(status, "wf-abc123")!;
  assert.equal(
    task.queries,
    "first query\nhttps://example.invalid/a\nsecond query",
  );
  assert.equal(task.seconds, 231.7);
  for (const hidden of [
    "AGENT_NAME",
    "AGENT_DESCRIPTION",
    "RESULT_TITLE",
    "RESULT_TEXT",
    "RESULT_QUERY",
    "SOURCE_QUERY",
  ])
    assert.ok(!JSON.stringify(task).includes(hidden), hidden);
  assert.equal(
    claudeResearchTask({ ...status, status: "searching" }, "wf-abc123"),
    null,
  );
  assert.equal(claudeResearchTask(status, "not-a-task"), null);
  assert.equal(
    claudeResearchTask({ ...status, completed_at: null }, "wf-abc123")!.seconds,
    null,
  );
});

test("a saved Research reply carries the agents' queries under the chat model and the task span", () => {
  const launch = [
    block({
      type: "tool_use",
      id: "launch",
      name: "launch_extended_search_task",
      input: { command: "Research brief" },
    }),
    block(
      {
        type: "tool_result",
        tool_use_id: "launch",
        content: [{ type: "text", text: '{"task_id":"wf-abc123"}' }],
      },
      1,
    ),
    block({ type: "text", text: "Report follows." }, 600),
  ];
  const tasks: ClaudeResearchTask[] = [
    { id: "wf-abc123", queries: "first query", seconds: 231.7 },
    { id: "wf-abc1234", queries: "other run", seconds: 10 },
  ];
  const body = reply(launch);
  body.model = "claude-opus-5-5";
  const response = saved(body, tasks)[1]!;
  assert.deepEqual(response.coverageReasons, ["research_work_unobserved"]);
  assert.equal(response.toolInput, "Research brief");
  assert.deepEqual(response.components, [
    {
      role: "research",
      model: "claude-opus-5-5",
      text: "first query",
      outputTokens: null,
    },
  ]);
  assert.equal(response.timing?.duration_seconds, "231.7");
  assert.equal(response.timing?.scope, "research_task");
  // Without the page's own poll the run's span is unknown; its blocks span the wait.
  const unseen = saved(reply(launch))[1]!;
  assert.equal(unseen.timing, null);
  assert.equal(Object.hasOwn(unseen, "components"), false);
  assert.deepEqual(unseen.coverageReasons, ["research_work_unobserved"]);
  // Two runs named in the same reply cannot be told apart, so neither is attached.
  const both = reply([
    ...launch,
    block(
      {
        type: "tool_result",
        tool_use_id: "launch",
        content: [{ type: "text", text: "wf-abc1234" }],
      },
      2,
    ),
  ]);
  assert.equal(Object.hasOwn(saved(both, tasks)[1]!, "components"), false);
});

test("the streamed row parser takes the chat model and research runs as options", () => {
  const body = reply([block({ type: "text", text: "Hello" })]);
  const row = claudeHistoryRow(body.chat_messages[1], {
    model: "claude-sonnet-5-5",
  });
  assert.equal(row.message.modelId, "claude-sonnet-5-5");
  assert.equal(claudeHistoryRow(body.chat_messages[1]).message.modelId, null);
});

test("a saved Research report leaves out the citations the page attached to its artifact", () => {
  const input = {
    command: "create",
    content: "# Wind",
    md_citations: [{ title: "Source", url: "https://example.invalid/a" }],
    version_uuid: "00000000-0000-4000-8000-000000000003",
  };
  const body = reply([
    block({ type: "tool_use", id: "a1", name: "artifacts", input }),
    block({ type: "tool_use", id: "m1", name: "mcp_tool", input }, 1),
    block({ type: "text", text: "Done." }, 2),
  ]);
  const response = saved(body)[1]!;
  // The artifacts call drops both attached fields; another tool keeps them as its own input.
  assert.equal(
    response.toolInput,
    "create\n# Wind\ncreate\n# Wind\nSource\nhttps://example.invalid/a\n00000000-0000-4000-8000-000000000003",
  );
});
