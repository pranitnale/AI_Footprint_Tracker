import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseHistoryText,
  ChatgptSession,
  ClaudeSession,
  PerplexitySession,
  GeminiSession,
  parseDispatch,
} from "../src";

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(
        `../../../fixtures/history-observation-2026-09-14/${name}.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
const id = "00000000-0000-4000-8000-000000000042",
  at = "2026-09-15T12:00:00.000Z";
const frame = (value: unknown, event = "message") => ({
  value,
  event,
  data: JSON.stringify(value),
});

test("ChatGPT times a saved turn from its first assistant message to its last update and preserves exact identities", () => {
  const body = fixture("chatgpt-flat-page");
  const row = body.messages.find(
    (m: any) => m.author.role === "assistant" && m.channel === "final",
  );
  // The thinking label comes before the answer it summarises.
  const recap = body.messages.find(
    (m: any) =>
      m.author.role === "assistant" &&
      m.content.content_type === "reasoning_recap" &&
      m.metadata.request_id === row.metadata.request_id,
  );
  recap.create_time = row.create_time - 2;
  row.update_time = row.create_time + 5.5;
  const page = parseHistoryText("chatgpt", body, id, at);
  const response = page.messages.find((m) => m.sourceId === row.id)!;
  assert.equal(response.timing?.duration_seconds, "7.5");
  assert.equal(response.timing?.scope, "provider_message");
  const live = new ChatgptSession();
  live.frame(frame({ message: row }));
  assert.equal(live.snapshot().outputId, response.liveAttemptId);
  assert.equal(
    live.completionVerified(),
    false,
    "final message alone is not stream completion",
  );
  live.frame(frame({ type: "message_stream_complete" }));
  assert.equal(live.completionVerified(), true);
  live.frame(
    frame({ message: { ...row, status: "in_progress", end_turn: false } }),
  );
  assert.equal(live.completionVerified(), false);
  const prompt = body.messages.find((m: any) => m.author.role === "user");
  const dispatch = parseDispatch(
    "chatgpt",
    new URL("https://chatgpt.com/backend-api/conversation"),
    JSON.stringify({ messages: [prompt] }),
  );
  assert.equal(dispatch.requestId, page.messages[0]!.requestId);
  assert.notEqual(dispatch.requestId, prompt.metadata.request_id);
  // The answer must show when it finished; a missing or impossible time leaves the turn
  // untimed rather than too short.
  row.update_time = row.create_time;
  assert.equal(
    parseHistoryText("chatgpt", body, id, at).messages.find(
      (m) => m.sourceId === row.id,
    )!.timing?.duration_seconds,
    "2",
  );
  for (const end of [null, -1, row.create_time - 2, row.create_time + 86401]) {
    row.update_time = end;
    assert.equal(
      parseHistoryText("chatgpt", body, id, at).messages.find(
        (m) => m.sourceId === row.id,
      )!.timing,
      null,
    );
  }
  row.update_time = row.create_time + 5;
  row.metadata.finish_details = {
    type: "interrupted",
    reason: "client_stopped",
  };
  assert.equal(
    parseHistoryText("chatgpt", body, id, at).messages.find(
      (m) => m.sourceId === row.id,
    )!.timing,
    null,
  );
});

test("Claude spans exposed generated blocks without double-counting overlap or using parent age", () => {
  const body = fixture("claude-selected-history"),
    row = body.chat_messages[1];
  row.content[0].start_timestamp = "2026-09-15T12:00:00.000001Z";
  row.content[0].stop_timestamp = "2026-09-15T12:00:04.000002Z";
  row.content.push({
    type: "thinking",
    thinking: "synthetic",
    start_timestamp: "2026-09-15T11:59:59.000001Z",
    stop_timestamp: "2026-09-15T12:00:02.000001Z",
  });
  const response = parseHistoryText("claude", body, id, at).messages[1]!;
  assert.equal(response.timing?.duration_seconds, "5.000001");
  assert.equal(response.timing?.scope, "content_blocks");
  assert.equal(response.requestId, null);
  const live = new ClaudeSession();
  live.frame(
    frame({
      type: "message_start",
      message: { id: "synthetic-distinct-protocol-id", uuid: row.uuid },
    }),
  );
  assert.equal(live.snapshot().outputId, response.liveAttemptId);
  live.frame(
    frame({ type: "message_delta", delta: { stop_reason: "end_turn" } }),
  );
  assert.equal(live.completionVerified(), false);
  live.frame(frame({ type: "message_stop" }));
  assert.equal(live.completionVerified(), true);
  delete row.content[1].start_timestamp;
  assert.equal(
    parseHistoryText("claude", body, id, at).messages[1]!.timing,
    null,
  );
  row.stop_reason = "client_stopped";
  assert.equal(
    parseHistoryText("claude", body, id, at).messages[1]!.timing,
    null,
  );
});

test("Perplexity times a completed entry and names its reply by the entry's own id (F1)", () => {
  const body = fixture("perplexity-workflow-page"),
    entry = body.entries[0];
  const response = parseHistoryText("perplexity", body, id, at).messages[1]!;
  assert.equal(response.timing?.duration_seconds, "1");
  assert.equal(response.timing?.scope, "workflow");
  const live = new PerplexitySession();
  live.frame(
    frame({
      ...entry,
      final: true,
      final_sse_message: true,
      text_completed: true,
    }),
  );
  assert.equal(live.completionVerified(), true);
  assert.equal(live.snapshot().outputId, response.liveAttemptId);
  assert.notEqual(response.liveAttemptId, response.requestId);
  // The entry's own id names the reply, whatever its answer items (F1, W7).
  assert.equal(response.liveAttemptId, entry.backend_uuid);
  const items = entry.blocks[0].workflow_block.steps[0].items;
  items.push({
    ...items[0],
    id: "f".repeat(32),
    payload: {
      text_payload: {
        text: "second part",
        chunks: ["second part"],
        variant: "answer",
        is_streaming: false,
      },
    },
  });
  const several = parseHistoryText("perplexity", body, id, at).messages[1]!;
  assert.equal(several.liveAttemptId, entry.backend_uuid);
  assert.equal(several.text, response.text + "\nsecond part");
  assert.equal(several.timing?.duration_seconds, "1");
});

test("Gemini links selected candidate separately from turn and never invents a duration", () => {
  const body = fixture("gemini-selected-history");
  const page = parseHistoryText(
    "gemini",
    body.response_payload,
    body.request_arguments[0],
    at,
  );
  const response = page.messages.find((m) => m.role === "response" && m.text)!;
  const live = new GeminiSession();
  live.gemini([
    [
      "wrb.fr",
      null,
      JSON.stringify([
        null,
        [body.request_arguments[0], response.promptSourceId],
        null,
        null,
        [[response.sourceId, [response.text]]],
      ]),
    ],
  ]);
  assert.equal(live.snapshot().outputId, response.liveAttemptId);
  assert.equal(live.snapshot().providerRequestId, response.requestId);
  assert.notEqual(live.snapshot().outputId, live.snapshot().providerRequestId);
  assert.ok(page.messages.every((m) => m.timing === null));
  // The request's normal end completes the reply (M2); the stream carries no other end.
  assert.equal(live.completionVerified(), false);
  live.responseEnded();
  assert.equal(live.snapshot().state, "completed");
  assert.equal(live.completionVerified(), true);
});
