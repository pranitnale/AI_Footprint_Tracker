import test from "node:test";
import assert from "node:assert/strict";
import { LIMITS } from "@footprint/capture-core";
import {
  ClaudeProxySession,
  PACKAGED_PROVIDER_ADAPTERS,
  generationRoute,
  parseDispatch,
} from "../src/index";

const proxy = new URL(
  "https://claude.ai/api/organizations/00000000-0000-4000-8000-000000000001/proxy/v1/messages",
);
const frame = (value: any) => ({ event: "message", data: "", value });
// Shape of the response seen on 3 Oct (G3); text and ids are synthetic.
const body = {
  id: "msg_synthetic",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-4-6",
  content: [
    { type: "text", text: "Four" },
    { type: "tool_use", id: "t", name: "lookup", input: { query: "Weather" } },
  ],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: {
    input_tokens: 4098,
    output_tokens: 4,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 12,
  },
};

test("G3 an AI artifact run gives the answering model and the provider's exact usage", () => {
  const session = new ClaudeProxySession();
  session.json(body);
  const result = session.snapshot();
  assert.equal(result.state, "completed");
  assert.equal(result.text, "Four");
  assert.equal(result.toolInput, "Weather");
  assert.equal(result.model, "claude-sonnet-4-6");
  assert.equal(result.outputId, "msg_synthetic");
  assert.equal(result.conversationId, null);
  assert.deepEqual(result.usage, {
    output: 4,
    input: 4098,
    cacheRead: 12,
    cacheWrite: 0,
    reasoning: null,
  });
  // Server tool results are tool results, not unknown blocks; only their text counts.
  const searched = new ClaudeProxySession();
  searched.json({
    ...body,
    content: [
      {
        type: "server_tool_use",
        id: "s",
        name: "web_search",
        input: { query: "Q" },
      },
      {
        type: "web_search_tool_result",
        tool_use_id: "s",
        content: [
          {
            type: "web_search_result",
            url: "https://example.invalid",
            title: "T",
          },
        ],
      },
      { type: "text", text: "Done" },
    ],
  });
  assert.equal(searched.snapshot().toolOutput, "");
  assert.equal(searched.snapshot().toolInput, "Q");
  assert.ok(
    !searched.snapshot().limitations.includes("unknown_event_observed"),
  );
  // An error body ends the run as failed; another shape fails closed.
  const failed = new ClaudeProxySession();
  failed.json({ type: "error", error: { type: "overloaded_error" } });
  assert.equal(failed.snapshot().state, "failed");
  assert.equal(Object.hasOwn(failed.snapshot(), "usage"), false);
  assert.throws(
    () => new ClaudeProxySession().json({ type: "message", content: [] }),
    /unsupported_schema/,
  );
});

test("G3 a streamed artifact run takes the final cumulative output count once it completes", () => {
  const session = new ClaudeProxySession();
  session.frame(
    frame({
      type: "message_start",
      message: {
        id: "msg_stream",
        model: "claude-sonnet-4-6",
        usage: { input_tokens: 30, output_tokens: 1 },
      },
    }),
  );
  session.frame(
    frame({
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    }),
  );
  session.frame(
    frame({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Hi there" },
    }),
  );
  // Usage of an unfinished run is not exact for the reply, so none is reported yet.
  assert.equal(Object.hasOwn(session.snapshot(), "usage"), false);
  session.frame(
    frame({
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 9 },
    }),
  );
  session.frame(frame({ type: "message_stop" }));
  assert.deepEqual(session.snapshot().usage, {
    output: 9,
    input: 30,
    cacheRead: null,
    cacheWrite: null,
    reasoning: null,
  });
  // The start count is a placeholder: a completed run whose final delta reports no
  // usage has no exact output, and the reply keeps its counted text instead.
  const unreported = new ClaudeProxySession();
  unreported.frame(
    frame({
      type: "message_start",
      message: {
        id: "msg_unreported",
        model: "claude-sonnet-4-6",
        usage: { input_tokens: 30, output_tokens: 1 },
      },
    }),
  );
  unreported.frame(
    frame({
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "A long reply" },
    }),
  );
  unreported.frame(
    frame({ type: "message_delta", delta: { stop_reason: "end_turn" } }),
  );
  unreported.frame(frame({ type: "message_stop" }));
  assert.equal(unreported.snapshot().state, "completed");
  assert.equal(Object.hasOwn(unreported.snapshot(), "usage"), false);
});

test("G3 artifact runs are generation routes with their newest user message as input", () => {
  assert.equal(generationRoute("claude", proxy, "POST"), true);
  assert.equal(generationRoute("claude", proxy, "GET"), false);
  const run = parseDispatch(
    "claude",
    proxy,
    JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [
        { role: "user", content: "Earlier" },
        { role: "assistant", content: "Reply" },
        {
          role: "user",
          content: [
            { type: "text", text: "Newest" },
            { type: "image", source: { type: "base64", data: "AAAA" } },
          ],
        },
      ],
    }),
  );
  assert.equal(run.input, "Newest");
  assert.equal(run.model, "claude-sonnet-4-6");
  assert.equal(run.conversationId, null);
  assert.deepEqual(run.inputImages, [{ width: null, height: null }]);
  const plain = parseDispatch(
    "claude",
    proxy,
    JSON.stringify({ model: "m", messages: [{ role: "user", content: "Hi" }] }),
  );
  assert.deepEqual(plain.inputImages, []);
  // Tool schemas nested deeper than the frame limit do not fail a run.
  const nested = (depth: number): unknown =>
    depth ? { properties: nested(depth - 1) } : { type: "string" };
  assert.equal(
    parseDispatch(
      "claude",
      proxy,
      JSON.stringify({
        model: "m",
        tools: [{ name: "t", input_schema: nested(LIMITS.depth + 8) }],
        messages: [{ role: "user", content: "Deep" }],
      }),
    ).input,
    "Deep",
  );
  // A body past the frame limit keeps its text unknown instead of failing the run.
  const large = parseDispatch(
    "claude",
    proxy,
    JSON.stringify({
      messages: [{ role: "user", content: "x".repeat(LIMITS.frame) }],
    }),
  );
  assert.equal(large.input, null);
  assert.equal(Object.hasOwn(large, "inputImages"), false);
  // The registry gives artifact runs their own parser and chats the stream parser.
  const adapter = PACKAGED_PROVIDER_ADAPTERS.get("claude")!;
  assert.ok(adapter.createSession(proxy) instanceof ClaudeProxySession);
  assert.ok(
    !(
      adapter.createSession(
        new URL(
          "https://claude.ai/api/organizations/o/chat_conversations/c/completion",
        ),
      ) instanceof ClaudeProxySession
    ),
  );
});
