import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLAUDE_BLOCK_TYPES,
  CLAUDE_DELTAS,
  CLAUDE_EVENTS,
  CLAUDE_IGNORED_EVENTS,
  ClaudeSession,
  ChatgptSession,
  GeminiSession,
  PerplexitySession,
  parseDispatch,
  generationRoute,
} from "../src/index";
import { SseDecoder } from "@footprint/capture-core";
const frame = (value: any, event = "message") => ({
  event,
  data: JSON.stringify(value),
  value,
});
test("Perplexity undocumented ID aliases are not promoted to stable conversation identity", () => {
  const value = parseDispatch(
    "perplexity",
    new URL("https://www.perplexity.ai/rest/sse/perplexity_ask"),
    JSON.stringify({
      query_str: "Synthetic input",
      params: {
        last_backend_uuid: "previous-response",
        frontend_uuid: "request-like",
        conversation_uuid: "unverified-conversation",
        thread_uuid: "unverified-thread",
        frontend_context_uuid: "unverified-context",
        attachments: [],
      },
    }),
  );
  assert.equal(value.conversationId, null);
  assert.equal(value.requestId, null);
  assert.equal(value.parentId, "previous-response");
  assert.equal(value.input, "Synthetic input");
});
test("ChatGPT partial status is not normal completion, and several finals answer one turn (G8)", () => {
  const session = new ChatgptSession();
  const message = {
    id: "answer-one",
    author: { role: "assistant" },
    channel: "final",
    recipient: "all",
    content: { content_type: "text", parts: ["Observed text"] },
    status: "finished_partial",
    end_turn: true,
  };
  session.frame(frame({ message }));
  assert.notEqual(session.snapshot().state, "completed");
  assert.equal(session.snapshot().text, "Observed text");
  session.frame(
    frame({
      message: {
        ...message,
        id: "answer-two",
        status: "finished_successfully",
      },
    }),
  );
  // Both finals are the turn's answer; the partial one keeps the turn from completing.
  assert.equal(session.snapshot().text, "Observed text\nObserved text");
  assert.notEqual(session.snapshot().state, "completed");
  assert.equal(session.snapshot().outputId, "answer-two");
  assert.equal(session.snapshot().attemptId, "answer-one");
});
const socket = (id: string, value: any) => ({
  topic_id: "owned",
  payload: {
    type: "conversation-turn-stream",
    payload: {
      type: "stream-item",
      stream_item_id: id,
      encoded_item: "event: delta\ndata: " + JSON.stringify(value) + "\n\n",
    },
  },
});

test("Claude full blocks count answer, thinking, decoded tool input and shown results", () => {
  const s = new ClaudeSession();
  const events = [
    {
      type: "message_start",
      message: {
        id: "assistant-1",
        model: "claude-opus",
        role: "assistant",
        content: [],
        stop_reason: null,
      },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "thinking", thinking: "", summaries: [] },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_delta", thinking: "Visible only" },
    },
    { type: "content_block_stop", index: 0 },
    {
      type: "content_block_start",
      index: 1,
      content_block: {
        type: "tool_use",
        id: "search-1",
        name: "web_search",
        input: {},
      },
    },
    {
      type: "content_block_delta",
      index: 1,
      delta: {
        type: "input_json_delta",
        partial_json: '{"query":"PRIVATE_MARKER"}',
      },
    },
    {
      type: "content_block_start",
      index: 2,
      content_block: {
        type: "tool_result",
        tool_use_id: "search-1",
        content: [{ url: "https://private.invalid", text: "not answer" }],
      },
    },
    {
      type: "content_block_start",
      index: 3,
      content_block: { type: "text", text: "" },
    },
    {
      type: "content_block_delta",
      index: 3,
      delta: { type: "text_delta", text: "é 🌿 answer" },
    },
    { type: "message_limit", message_limit: { utilization: 999999 } },
    { type: "message_delta", delta: { stop_reason: "end_turn" } },
    { type: "message_stop" },
  ];
  for (const event of events) s.frame(frame(event));
  const result = s.snapshot();
  assert.equal(result.text, "é 🌿 answer");
  assert.equal(result.thinking, "Visible only");
  // The model wrote the query, so it counts as tool input (A1); the result the page
  // shows counts as input, but not the link of its source card (A6).
  assert.equal(result.toolInput, "PRIVATE_MARKER");
  assert.equal(result.toolOutput, "not answer");
  assert.ok(!JSON.stringify(result).includes("private.invalid"));
  assert.equal(result.searchOperations, 1);
  assert.equal(result.state, "completed");
  assert.ok(!result.limitations.includes("unknown_event_observed"));
});
test("Claude summary-only thinking counts its summary and tool display updates count nothing", () => {
  // Shape observed in Claude.ai history on 26 September 2026: a thinking block with one
  // summary and empty thinking text, followed by the answer.
  const s = new ClaudeSession();
  const events = [
    {
      type: "message_start",
      message: { id: "assistant-2", model: "claude-opus" },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: {
        type: "thinking",
        thinking: "",
        summaries: [],
        cut_off: false,
      },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: {
        type: "thinking_summary_delta",
        summary: { summary: "SUMMARY_MARKER" },
      },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_cut_off_delta", cut_off: false },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "signature_delta", signature: "s" },
    },
    { type: "content_block_stop", index: 0 },
    {
      type: "content_block_start",
      index: 1,
      content_block: {
        type: "tool_use",
        id: "tool-1",
        name: "other_tool",
        input: {},
      },
    },
    {
      type: "content_block_delta",
      index: 1,
      delta: {
        type: "tool_use_block_update_delta",
        message: "DISPLAY_MARKER",
        display_content: { text: "DISPLAY_MARKER" },
      },
    },
    { type: "content_block_stop", index: 1 },
    {
      type: "content_block_start",
      index: 2,
      content_block: { type: "text", text: "" },
    },
    {
      type: "content_block_delta",
      index: 2,
      delta: { type: "text_delta", text: "Short answer" },
    },
    { type: "content_block_stop", index: 2 },
    { type: "message_delta", delta: { stop_reason: "end_turn" } },
    { type: "message_stop" },
  ];
  for (const event of events) s.frame(frame(event));
  const result = s.snapshot();
  assert.equal(result.state, "completed");
  assert.equal(result.text, "Short answer");
  // The summary is the reasoning the page shows (A2).
  assert.equal(result.thinking, "SUMMARY_MARKER");
  assert.equal(result.toolInput, "");
  assert.equal(result.searchOperations, null);
  assert.ok(!JSON.stringify(result).includes("DISPLAY_MARKER"));
});
test("Claude display deltas are accepted only on the block type they describe", () => {
  const start = (type: string) => {
    const s = new ClaudeSession();
    s.frame(frame({ type: "message_start", message: { id: "assistant-3" } }));
    s.frame(
      frame({
        type: "content_block_start",
        index: 0,
        content_block: { type, text: "", thinking: "" },
      }),
    );
    return s;
  };
  const delta = (type: string) =>
    frame({ type: "content_block_delta", index: 0, delta: { type } });
  for (const [block, type] of [
    ["text", "thinking_summary_delta"],
    ["text", "thinking_cut_off_delta"],
    ["thinking", "tool_use_block_update_delta"],
    ["text", "tool_use_block_update_delta"],
    ["text", "connector_text_delta"],
    ["thinking", "voice_note_delta"],
    ["text", "flag_delta"],
  ])
    assert.throws(
      () => start(block).frame(delta(type)),
      /unsupported_schema/,
      `${type} on ${block}`,
    );
  const orphan = new ClaudeSession();
  orphan.frame(
    frame({ type: "message_start", message: { id: "assistant-4" } }),
  );
  assert.throws(
    () => orphan.frame(delta("thinking_summary_delta")),
    /unsupported_schema/,
  );
});
test("Claude connector text is answer text and a malformed text delta fails closed", () => {
  const s = new ClaudeSession();
  s.frame(frame({ type: "message_start", message: { id: "assistant-5" } }));
  s.frame(
    frame({
      type: "content_block_start",
      index: 0,
      content_block: { type: "connector_text", connector_text: "One " },
    }),
  );
  s.frame(
    frame({
      type: "content_block_delta",
      index: 0,
      delta: { type: "connector_text_delta", connector_text: "two" },
    }),
  );
  assert.equal(s.snapshot().text, "One two");
  // Unknown content inside a known text block would silently lower the answer (D7).
  assert.throws(
    () =>
      s.frame(
        frame({
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: 7 },
        }),
      ),
    /unsupported_schema/,
  );
});
test("Claude thinking text wins over its summaries; summaries count only without it", () => {
  const s = new ClaudeSession();
  s.frame(frame({ type: "message_start", message: { id: "assistant-6" } }));
  s.frame(
    frame({
      type: "content_block_start",
      index: 0,
      content_block: {
        type: "thinking",
        thinking: "",
        summaries: [{ summary: "First summary" }],
      },
    }),
  );
  assert.equal(s.snapshot().thinking, "First summary");
  s.frame(
    frame({
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_delta", thinking: "Full reasoning" },
    }),
  );
  assert.equal(s.snapshot().thinking, "Full reasoning");
  const plain = new ClaudeSession();
  plain.frame(frame({ type: "message_start", message: { id: "a7" } }));
  // A started reply without thinking blocks shows no thinking; nothing is unknown.
  assert.equal(plain.snapshot().thinking, "");
  assert.equal(new ClaudeSession().snapshot().thinking, null);
});
test("Claude tool input is decoded, a stopped fragment counts raw, and results count as input", () => {
  const s = new ClaudeSession();
  s.frame(frame({ type: "message_start", message: { id: "assistant-8" } }));
  s.frame(
    frame({
      type: "content_block_start",
      index: 0,
      content_block: {
        type: "tool_use",
        id: "t1",
        name: "create_file",
        input: {},
      },
    }),
  );
  for (const partial_json of ['{"path":"a.md",', '"content":"Line one"}'])
    s.frame(
      frame({
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json },
      }),
    );
  s.frame(
    frame({
      type: "content_block_start",
      index: 1,
      content_block: {
        type: "tool_result",
        tool_use_id: "t1",
        content: [{ type: "text", text: "Created" }, { type: "image" }],
      },
    }),
  );
  s.frame(
    frame({
      type: "content_block_start",
      index: 2,
      content_block: {
        type: "mcp_tool_use",
        id: "t2",
        name: "lookup",
        input: { query: "Weather", limit: 3, exact: true },
      },
    }),
  );
  s.frame(
    frame({
      type: "content_block_start",
      index: 3,
      content_block: { type: "server_tool_use", id: "t3", input: {} },
    }),
  );
  s.frame(
    frame({
      type: "content_block_delta",
      index: 3,
      delta: { type: "input_json_delta", partial_json: '{"query":"unfinis' },
    }),
  );
  const result = s.snapshot();
  // Keys and JSON punctuation are protocol; string, number and boolean values are text.
  assert.equal(
    result.toolInput,
    'a.md\nLine one\nWeather\n3\ntrue\n{"query":"unfinis',
  );
  assert.equal(result.toolOutput, "Created");
  assert.equal(result.intermediate, "");
  assert.throws(
    () =>
      s.frame(
        frame({
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: { query: 1 } },
        }),
      ),
    /unsupported_schema/,
  );
});
test("Claude tool input past the field limit stays unknown without failing the reply", () => {
  const s = new ClaudeSession();
  s.frame(frame({ type: "message_start", message: { id: "assistant-9" } }));
  s.frame(
    frame({
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "t", name: "x", input: {} },
    }),
  );
  s.frame(
    frame({
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: '{"a":"' },
    }),
  );
  assert.equal(s.snapshot().toolInput, '{"a":"');
  const chunk = "x".repeat(1_048_576);
  for (let i = 0; i < 3; i++)
    s.frame(
      frame({
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: chunk },
      }),
    );
  s.frame(
    frame({
      type: "content_block_start",
      index: 1,
      content_block: { type: "text", text: "Answer" },
    }),
  );
  s.frame(frame({ type: "message_delta", delta: { stop_reason: "end_turn" } }));
  s.frame(frame({ type: "message_stop" }));
  const result = s.snapshot();
  assert.equal(result.state, "completed");
  assert.equal(result.text, "Answer");
  assert.equal(Object.hasOwn(result, "toolInput"), false);
  assert.equal(result.toolOutput, "");
});
test("Claude retract and a second message keep every generated block under the final model", () => {
  const s = new ClaudeSession();
  const events = [
    {
      type: "message_start",
      message: { id: "first", model: "claude-opus-5-5" },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "Draft answer" },
    },
    { type: "content_block_retract", from_index: 0 },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: " Retry" },
    },
    { type: "model_fallback", model: "claude-sonnet-5-5" },
    { type: "message_delta", delta: { stop_reason: "end_turn" } },
    { type: "message_stop" },
    { type: "message_start", message: { id: "second" } },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: " More" },
    },
    { type: "compaction_status", status: "done" },
    { type: "cache_performance", hit: true },
    { type: "conversation_ready" },
    { type: "message_delta", delta: { stop_reason: "end_turn" } },
    { type: "message_stop" },
  ];
  for (const event of events) s.frame(frame(event));
  const result = s.snapshot();
  // Retracted text was generated, so it stays in the answer it was part of.
  assert.equal(result.text, "Draft answer Retry More");
  assert.equal(result.model, "claude-sonnet-5-5");
  assert.equal(result.outputId, "second");
  assert.equal(result.state, "completed");
  assert.ok(!result.limitations.includes("unknown_event_observed"));
});
test("Claude stop reasons end a reply: a user stop cancels, any other reason completes", () => {
  const end = (reason: string | null) => {
    const s = new ClaudeSession();
    s.frame(frame({ type: "message_start", message: { id: "r" } }));
    s.frame(frame({ type: "message_delta", delta: { stop_reason: reason } }));
    s.frame(frame({ type: "message_stop" }));
    return s.snapshot().state;
  };
  for (const reason of ["user_canceled", "user_canceled_for_queued_message"])
    assert.equal(end(reason), "cancelled", reason);
  for (const reason of [
    "end_turn",
    "stop_sequence",
    "max_tokens",
    "tool_use_limit",
    "pause_turn",
    "compaction",
    "refusal",
    "prompt_injection_risk",
    "conversation_length_limit",
    "model_context_window_exceeded",
    "a_future_reason",
  ])
    assert.equal(end(reason), "completed", reason);
  assert.equal(end(null), "generating");
});
test("Claude unknown events and blocks are counted around and marked, compaction text is other output", () => {
  const s = new ClaudeSession();
  const events = [
    { type: "message_start", message: { id: "u" } },
    { type: "bell", ring: true },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "voice_note", title: "VOICE_MARKER" },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "voice_note_delta", text: "VOICE_MARKER" },
    },
    {
      type: "content_block_start",
      index: 1,
      content_block: { type: "compaction", text: "" },
    },
    {
      type: "content_block_delta",
      index: 1,
      delta: { type: "compaction_delta", text: "Summary of earlier turns" },
    },
    {
      type: "content_block_start",
      index: 2,
      content_block: { type: "text", text: "Answer" },
    },
    { type: "message_delta", delta: { stop_reason: "end_turn" } },
    { type: "message_stop" },
  ];
  for (const event of events) s.frame(frame(event));
  const result = s.snapshot();
  assert.equal(result.state, "completed");
  assert.equal(result.text, "Answer");
  assert.equal(result.intermediate, "Summary of earlier turns");
  assert.ok(result.limitations.includes("unknown_event_observed"));
  assert.ok(!JSON.stringify(result).includes("VOICE_MARKER"));
  // A compaction delta in a shape the tracker does not know leaves the part unknown.
  s.frame(
    frame({
      type: "content_block_delta",
      index: 1,
      delta: { type: "compaction_delta", content: [] },
    }),
  );
  assert.equal(Object.hasOwn(s.snapshot(), "intermediate"), false);
});
test("Claude retry is a dispatch with empty new text and unknown retained context", () => {
  const url = new URL(
    "https://claude.ai/api/organizations/o/chat_conversations/c/retry_completion",
  );
  const d = parseDispatch(
    "claude",
    url,
    JSON.stringify({
      prompt: "",
      parent_message_uuid: "human-old",
      completion_request_id: "retry-new",
      model: "unknown",
      attachments: [],
      files: [],
    }),
  );
  assert.equal(d.action, "regenerate");
  assert.equal(d.input, "");
  assert.equal(d.parentId, "human-old");
  assert.equal(d.conversationId, "c");
  assert.equal(
    generationRoute(
      "claude",
      new URL("https://claude.ai/api/organizations/o/chat_conversations/c"),
      "GET",
    ),
    false,
  );
});
test("ChatGPT handoff is not completion; private patches inherit and catchups deduplicate", () => {
  const s = new ChatgptSession();
  s.frame(
    frame(
      { options: [{ type: "subscribe_ws_topic", topic_id: "owned" }] },
      "stream_handoff",
    ),
  );
  s.frame({ event: "message", data: "[DONE]", value: null });
  assert.equal(s.snapshot().state, "generating");
  const root = socket("1", {
    p: "",
    o: "add",
    v: {
      message: {
        id: "answer",
        author: { role: "assistant" },
        channel: "final",
        content: { content_type: "text", parts: [""] },
        status: "in_progress",
        end_turn: false,
        metadata: {},
      },
    },
  });
  const append = socket("2", {
    p: "/message/content/parts/0",
    o: "append",
    v: "one ",
  });
  s.socket([
    { reply: { catchups: [root, append] } },
    append,
    socket("3", { v: "two" }),
  ]);
  s.socket(
    socket("4", {
      p: "",
      o: "patch",
      v: [
        { p: "/message/end_turn", o: "replace", v: true },
        { p: "/message/status", o: "replace", v: "finished_successfully" },
        {
          p: "/message/metadata",
          o: "append",
          v: { finish_details: { type: "stop", stop_tokens: [999999] } },
        },
      ],
    }),
  );
  assert.equal(s.snapshot().text, "one two");
  assert.equal(s.snapshot().state, "completed");
  // The whole reply was read and showed no thoughts.
  assert.equal(s.snapshot().thinking, "");
  assert.throws(
    () => s.socket(socket("3", { v: "different" })),
    /conflicting_duplicate/,
  );
});
// A long GPT-6 Pro reply on the socket sends one stream item per delta, so it passes
// LIMITS.items (live, 20 Oct 2026: a reply of about 6,200 output tokens failed with
// buffer_overflow after 4 minutes and its live count was lost).
test("20 Oct 2026: a ChatGPT socket reply reads more stream items than LIMITS.items, within its own bound", async () => {
  const { LIMITS } = await import("@footprint/capture-core");
  const { CHATGPT_STREAM_ITEMS } = (await import("../src/index")) as any;
  assert.ok(
    Number.isSafeInteger(CHATGPT_STREAM_ITEMS) &&
      CHATGPT_STREAM_ITEMS > LIMITS.items,
    "a socket reply has its own stream item bound",
  );
  const s = new ChatgptSession();
  s.frame(
    frame(
      { options: [{ type: "subscribe_ws_topic", topic_id: "owned" }] },
      "stream_handoff",
    ),
  );
  s.socket(
    socket("root", {
      p: "",
      o: "add",
      v: {
        message: {
          id: "answer",
          author: { role: "assistant" },
          channel: "final",
          content: { content_type: "text", parts: [""] },
          status: "in_progress",
          end_turn: false,
          metadata: {},
        },
      },
    }),
  );
  const pieces = LIMITS.items + 100;
  for (let start = 0; start < pieces; start += 500)
    s.socket(
      Array.from({ length: Math.min(500, pieces - start) }, (_, i) =>
        socket("piece-" + (start + i), {
          p: "/message/content/parts/0",
          o: "append",
          v: "x",
        }),
      ),
    );
  s.socket(
    socket("end", {
      p: "",
      o: "patch",
      v: [
        { p: "/message/end_turn", o: "replace", v: true },
        { p: "/message/status", o: "replace", v: "finished_successfully" },
      ],
    }),
  );
  assert.equal(s.snapshot().text, "x".repeat(pieces));
  assert.equal(s.snapshot().state, "completed");
  // A resent item is still checked against what was read.
  assert.throws(
    () => s.socket(socket("piece-7", { v: "different" })),
    /conflicting_duplicate/,
  );
  // The bound still ends a stream that never stops sending new items.
  const known = (id: string) => ({
    topic_id: "owned",
    payload: {
      type: "conversation-turn-stream",
      payload: {
        type: "stream-item",
        stream_item_id: id,
        encoded_item: 'event: delta_encoding\ndata: "v1"\n\n',
      },
    },
  });
  assert.throws(() => {
    for (let n = 0; n < CHATGPT_STREAM_ITEMS; n += 1000)
      s.socket(Array.from({ length: 1000 }, (_, i) => known("fill-" + (n + i))));
  }, /buffer_overflow/);
});
test("ChatGPT stop requires the explicit client stop reason", () => {
  const s = new ChatgptSession();
  s.frame(
    frame({
      message: {
        id: "answer",
        author: { role: "assistant" },
        channel: "final",
        content: { content_type: "text", parts: ["partial"] },
        status: "in_progress",
        end_turn: false,
        metadata: {
          finish_details: { type: "interrupted", reason: "client_stopped" },
        },
      },
    }),
  );
  assert.equal(s.snapshot().state, "cancelled");
  assert.equal(s.snapshot().text, "partial");
});
test("Gemini duplicate snapshots replace output; several or changed candidates make the reply partial", () => {
  const wrap = (text: string, candidates?: unknown[]) => [
    [
      "wrb.fr",
      null,
      JSON.stringify([
        null,
        ["c_0000000000000001", "r_0000000000000001"],
        null,
        null,
        candidates ?? [["rc_0000000000000001", [text]]],
      ]),
    ],
  ];
  const s = new GeminiSession();
  s.gemini(wrap("one"));
  s.gemini(wrap("one two"));
  s.gemini(wrap("one two"));
  assert.equal(s.snapshot().text, "one two");
  assert.equal(s.snapshot().state, "generating");
  assert.ok(!s.snapshot().limitations.includes("unknown_event_observed"));
  // Only one candidate was ever seen; the first of several is read and the reply is
  // partial instead of failed (W8.3).
  s.gemini(
    wrap("", [
      ["rc_0000000000000001", ["one two three"]],
      ["rc_0000000000000002", ["other"]],
    ]),
  );
  assert.equal(s.snapshot().text, "one two three");
  assert.ok(s.snapshot().limitations.includes("unknown_event_observed"));
  const changed = new GeminiSession();
  changed.gemini(wrap("one"));
  changed.gemini(wrap("", [["rc_0000000000000003", ["two"]]]));
  assert.equal(changed.snapshot().outputId, "rc_0000000000000003");
  assert.ok(changed.snapshot().limitations.includes("unknown_event_observed"));
});
test("Perplexity final canonical answer replaces chunks and ignores sources", () => {
  const s = new PerplexitySession();
  const workflow = {
    steps: [
      {
        id: "step",
        items: [
          {
            id: "answer",
            type: "WORKFLOW_ITEM_TEXT",
            variant: "answer",
            payload: {
              text_payload: { text: "", chunks: ["one "], is_streaming: true },
            },
          },
        ],
      },
    ],
  };
  s.frame(
    frame({
      blocks: [{ intended_usage: "workflow_root", workflow_block: workflow }],
    }),
  );
  s.frame(
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
                value: "two",
              },
            ],
          },
        },
      ],
    }),
  );
  workflow.steps[0]!.items[0]!.payload.text_payload = {
    text: "canonical",
    chunks: ["one ", "two"],
    is_streaming: false,
  };
  s.frame(
    frame({
      status: "COMPLETED",
      final: true,
      final_sse_message: true,
      text_completed: true,
      structured_answer_block_usages: ["not tokens"],
      blocks: [
        { intended_usage: "workflow_root", workflow_block: workflow },
        { intended_usage: "sources_answer_mode", result_count: 1000 },
      ],
    }),
  );
  assert.equal(s.snapshot().text, "canonical");
  assert.equal(s.snapshot().searchOperations, null);
  assert.equal(s.snapshot().state, "completed");
});
test("Unrelated POSTs never mint dispatches", () => {
  for (const route of [
    "/backend-api/f/conversation/prepare",
    "/backend-api/sentinel/check",
    "/backend-api/conversation/experimental/generate_autocompletions",
  ])
    assert.equal(
      generationRoute(
        "chatgpt",
        new URL("https://chatgpt.com" + route),
        "POST",
      ),
      false,
    );
});

test("Perplexity reports the displayed model label on the snapshot and ignores malformed labels", () => {
  const s = new PerplexitySession();
  s.frame(frame({ status: "IN_PROGRESS", display_model: { bad: true } }));
  assert.equal(s.snapshot().model, null);
  s.frame(frame({ status: "IN_PROGRESS", display_model: "gpt56_terra" }));
  assert.equal(s.snapshot().model, "gpt56_terra");
  s.frame(
    frame({
      display_model: "x".repeat(65),
      blocks: [
        {
          intended_usage: "workflow_root",
          workflow_block: {
            steps: [
              {
                id: "step",
                items: [
                  {
                    id: "answer",
                    type: "WORKFLOW_ITEM_TEXT",
                    variant: "answer",
                    payload: {
                      text_payload: {
                        text: "done",
                        chunks: ["done"],
                        is_streaming: false,
                      },
                    },
                  },
                ],
              },
            ],
          },
        },
      ],
    }),
  );
  const snapshot = s.snapshot();
  assert.equal(snapshot.model, "gpt56_terra");
  assert.equal(snapshot.text, "done");
});

test("W10 a ChatGPT event or turn item not seen before leaves the reply partial, never failed", () => {
  const handoff = () => {
    const s = new ChatgptSession();
    s.frame(
      frame(
        { options: [{ type: "subscribe_ws_topic", topic_id: "owned" }] },
        "stream_handoff",
      ),
    );
    return s;
  };
  const unknown = (s: ChatgptSession) =>
    s.snapshot().limitations.includes("unknown_event_observed");
  const s = handoff();
  // Known events stay quiet.
  s.frame(frame("v1", "delta_encoding"));
  s.frame(frame({ type: "title_generation", title: "synthetic" }));
  assert.equal(unknown(s), false);
  s.frame(frame({ anything: true }, "brand_new_event"));
  assert.equal(unknown(s), true);
  // The answer still counts in full.
  s.socket(
    socket("1", {
      p: "",
      o: "add",
      v: {
        message: {
          id: "answer",
          author: { role: "assistant" },
          channel: "final",
          content: { content_type: "text", parts: ["Done"] },
          status: "finished_successfully",
          end_turn: true,
          metadata: {},
        },
      },
    }),
  );
  assert.equal(s.snapshot().text, "Done");
  assert.equal(s.snapshot().state, "completed");
  const item = (payload: unknown) => ({
    topic_id: "owned",
    payload: { type: "conversation-turn-stream", payload },
  });
  const other = handoff();
  other.socket(item({ type: "brand-new-item" }));
  assert.equal(unknown(other), true);
  // A stream item that cannot be read may hold answer text, so it still fails closed.
  assert.throws(
    () => other.socket(item({ type: "stream-item", stream_item_id: "2" })),
    /unsupported_schema/,
  );
});

test("W10 review: an unknown ChatGPT event that carries a message is read and leaves the reply partial", () => {
  const message = {
    id: "answer",
    author: { role: "assistant" },
    channel: "final",
    content: { content_type: "text", parts: ["Done"] },
    status: "finished_successfully",
    end_turn: true,
    metadata: {},
  };
  const unknown = (s: ChatgptSession) =>
    s.snapshot().limitations.includes("unknown_event_observed");
  const odd = new ChatgptSession();
  odd.frame(frame({ message, more_output: "synthetic" }, "brand_new_event"));
  assert.equal(odd.snapshot().text, "Done");
  assert.equal(unknown(odd), true);
  // The same message in an event the reader knows stays quiet.
  const known = new ChatgptSession();
  known.frame(frame({ message }));
  assert.equal(known.snapshot().text, "Done");
  assert.equal(unknown(known), false);
});

test("W10 review: only socket items of the reply count toward its stream limit", () => {
  const s = new ChatgptSession();
  s.frame(
    frame(
      { options: [{ type: "subscribe_ws_topic", topic_id: "owned" }] },
      "stream_handoff",
    ),
  );
  const item = (topic: string) => ({
    topic_id: topic,
    payload: {
      type: "conversation-turn-stream",
      payload: { type: "conversation-turn-complete" },
    },
  });
  assert.equal(s.socket(item("other")), false);
  assert.equal(s.socket({ type: "presence", payload: {} }), false);
  assert.equal(s.socket(item("owned")), true);
  assert.equal(s.socket([item("other"), item("owned")]), true);
});

test("W10 the Claude names the drift check uses are the ones the reader handles", () => {
  const unknown = (s: ClaudeSession) =>
    s.snapshot().limitations.includes("unknown_event_observed");
  const started = (
    block: Record<string, unknown> = { type: "text", text: "" },
  ) => {
    const s = new ClaudeSession();
    s.frame(frame({ type: "message_start", message: { id: "a" } }));
    s.frame(
      frame({ type: "content_block_start", index: 0, content_block: block }),
    );
    return s;
  };
  const events: Record<string, Record<string, unknown>> = {
    message_start: { message: { id: "b" } },
    content_block_start: {
      index: 1,
      content_block: { type: "text", text: "" },
    },
    content_block_delta: { index: 0, delta: { type: "text_delta", text: "x" } },
    content_block_stop: { index: 0 },
    content_block_retract: { from_index: 0 },
    model_fallback: { model: "claude-synthetic" },
    model_update: { model: "claude-synthetic" },
    message_delta: { delta: { stop_reason: "end_turn" } },
    message_stop: {},
    error: {},
  };
  assert.deepEqual(Object.keys(events).sort(), [...CLAUDE_EVENTS].sort());
  for (const [type, payload] of Object.entries(events)) {
    const s = started();
    s.frame(frame({ type, ...payload }));
    assert.equal(unknown(s), false, type);
  }
  for (const type of CLAUDE_IGNORED_EVENTS) {
    const s = started();
    s.frame(frame({ type }));
    assert.equal(unknown(s), false, type);
  }
  const odd = started();
  odd.frame(frame({ type: "brand_new_event" }));
  assert.equal(unknown(odd), true);
  for (const type of CLAUDE_BLOCK_TYPES)
    assert.equal(unknown(started({ type })), false, type);
  // Each delta on a block it belongs to is read, never failed.
  const blockFor: Record<string, Record<string, unknown>> = {
    thinking_delta: { type: "thinking", thinking: "" },
    thinking_summary_delta: { type: "thinking", thinking: "" },
    thinking_cut_off_delta: { type: "thinking", thinking: "" },
    signature_delta: { type: "thinking", thinking: "" },
    input_json_delta: { type: "tool_use", name: "synthetic", input: {} },
    tool_use_block_update_delta: {
      type: "tool_use",
      name: "synthetic",
      input: {},
    },
    compaction_delta: { type: "compaction" },
  };
  for (const type of CLAUDE_DELTAS) {
    const s = started(blockFor[type]);
    s.frame(
      frame({
        type: "content_block_delta",
        index: 0,
        delta: {
          type,
          text: "x",
          thinking: "x",
          partial_json: "{}",
          summary: { summary: "x" },
        },
      }),
    );
    assert.equal(unknown(s), false, type);
  }
});
