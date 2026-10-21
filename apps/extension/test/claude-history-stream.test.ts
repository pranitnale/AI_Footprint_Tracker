import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ClaudeHistoryStream } from "../lib/claude-history-stream";
import {
  validateClaudeStreamCapture,
  CLAUDE_STREAM_CHANNEL,
} from "../lib/claude-history-message";

const id = "00000000-0000-4000-8000-000000000042";
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

test("Claude parser emits bounded rows without retaining full response text", async () => {
  const body = fixture();
  const sample = body.chat_messages[0];
  body.chat_messages = Array.from({ length: 160 }, (_, index) => ({
    ...sample,
    uuid: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    parent_message_uuid: index
      ? `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
      : "00000000-0000-4000-8000-000000000000",
    index,
    sender: index % 2 ? "assistant" : "human",
    stop_reason: "end_turn",
    truncated: false,
    content: [{ type: "text", text: "small 🚲 message" }],
    attachments: [],
  }));
  body.current_leaf_message_uuid = body.chat_messages.at(-1).uuid;
  const batches: any[] = [];
  const parser = new ClaudeHistoryStream(async (rows) => {
    batches.push(rows);
  });
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  for (let i = 0; i < bytes.length; i += 17)
    await parser.write(bytes.subarray(i, i + 17));
  const end = await parser.finish(id);
  assert.deepEqual(end, {
    leafId: body.current_leaf_message_uuid,
    rowCount: 160,
    // History names only the chat's model, which every saved message gets (B5).
    model: "claude-fixture-model",
  });
  assert.ok(
    batches
      .flat()
      .every((row) => row.message.modelId === "claude-fixture-model"),
  );
  assert.equal(batches.flat().length, 160);
  assert.ok(batches.every((batch) => batch.length <= 50));
  assert.ok(
    batches.flat().every((row) => row.message.text === "small 🚲 message"),
  );
  assert.ok(
    batches.flat().every((row) => !Object.hasOwn(row, "ignored_metadata")),
  );
  for (const rows of batches)
    assert.ok(
      validateClaudeStreamCapture({
        channel: CLAUDE_STREAM_CHANNEL,
        id: crypto.randomUUID(),
        site: "claude",
        conversationId: id,
        observedAt: new Date().toISOString(),
        event: "batch",
        rows,
        leafId: null,
        rowCount: null,
        model: null,
      }),
    );
});

test("Claude parser rejects duplicate identities and incomplete JSON before finalization", async () => {
  const body = fixture();
  body.chat_messages.push({ ...body.chat_messages[0] });
  const parser = new ClaudeHistoryStream(async () => {});
  await assert.rejects(
    parser.write(new TextEncoder().encode(JSON.stringify(body))),
    /history_unsupported/,
  );
  const partial = new ClaudeHistoryStream(async () => {});
  await partial.write(
    new TextEncoder().encode(JSON.stringify(fixture()).slice(0, -4)),
  );
  await assert.rejects(partial.finish(id));
});

test("Claude stream has no whole-conversation byte, text, or message cutoff", async () => {
  const body = fixture();
  const sample = body.chat_messages[0];
  body.chat_messages = Array.from({ length: 4300 }, (_, index) => ({
    ...sample,
    uuid: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    parent_message_uuid: index
      ? `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
      : "00000000-0000-4000-8000-000000000000",
    index,
    sender: index % 2 ? "assistant" : "human",
    stop_reason: "end_turn",
    truncated: false,
    content: [{ type: "text", text: "x".repeat(1300) }],
    attachments: [],
    ignored_metadata: "m".repeat(800),
  }));
  body.current_leaf_message_uuid = body.chat_messages.at(-1).uuid;
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  assert.ok(bytes.length > 8 * 1024 * 1024);
  let batches = 0;
  let counted = 0;
  const parser = new ClaudeHistoryStream(async (rows) => {
    assert.ok(rows.length <= 50);
    counted += rows.length;
    batches++;
  });
  for (let offset = 0; offset < bytes.length; offset += 32768)
    await parser.write(bytes.subarray(offset, offset + 32768));
  assert.deepEqual(await parser.finish(id), {
    leafId: body.current_leaf_message_uuid,
    rowCount: 4300,
    model: "claude-fixture-model",
  });
  assert.equal(counted, 4300);
  assert.ok(batches >= 86);
});
