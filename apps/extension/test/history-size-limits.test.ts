import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HISTORY_LIMITS } from "@footprint/adapters";
import { LIMITS } from "@footprint/capture-core";
import {
  HISTORY_BASIS_FIELD_UNITS,
  HISTORY_BASIS_FILE_UNITS,
  HistoryCountBasisSchema,
} from "@footprint/contracts";
import { ClaudeHistoryStream } from "../lib/claude-history-stream";
import {
  CLAUDE_STREAM_CHANNEL,
  validateClaudeStreamCapture,
} from "../lib/claude-history-message";
import { ProviderHistoryStream } from "../lib/provider-history-stream";
import {
  PROVIDER_STREAM_CHANNEL,
  validateProviderStreamCapture,
} from "../lib/provider-history-message";
import { coverageNotes } from "../lib/estimate-details";

// History size limits (review H1, 14 October 2026): a saved chat counts the long replies a
// live capture counts, and a part past a limit is named, never dropped silently. Ids, text and
// sizes are synthetic.

const observedAt = "2026-10-14T10:00:00.000Z";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ROOT = "00000000-0000-4000-8000-000000000000";
const CHAT = id(900001);

/** One saved Claude reply after one prompt, read by the page's streamed reader. */
async function claudeReply(reply: Record<string, unknown>, prompt: Record<string, unknown> = {}) {
  const body = JSON.stringify({
    uuid: CHAT,
    model: null,
    current_leaf_message_uuid: id(2),
    chat_messages: [
      {
        uuid: id(1),
        parent_message_uuid: ROOT,
        index: 0,
        sender: "human",
        truncated: false,
        content: [{ type: "text", text: "Synthetic prompt" }],
        ...prompt,
      },
      {
        uuid: id(2),
        parent_message_uuid: id(1),
        index: 1,
        sender: "assistant",
        truncated: false,
        stop_reason: "end_turn",
        ...reply,
      },
    ],
  });
  const rows: any[] = [];
  const stream = new ClaudeHistoryStream(async (batch) => {
    // The content script's check of each batch.
    assert.equal(
      validateClaudeStreamCapture({
        channel: CLAUDE_STREAM_CHANNEL,
        id: crypto.randomUUID(),
        site: "claude",
        conversationId: CHAT,
        observedAt,
        event: "batch",
        rows: batch,
        leafId: null,
        rowCount: null,
        model: null,
      }),
      true,
    );
    rows.push(...batch);
  });
  const bytes = new TextEncoder().encode(body);
  for (let offset = 0; offset < bytes.length; offset += 65536)
    await stream.write(bytes.subarray(offset, offset + 65536));
  await stream.finish(CHAT);
  return { prompt: rows[0].message, reply: rows[1].message };
}

test("history limits: a saved reply as long as a live one counts in full", async () => {
  // Above the earlier history limit of 262,144 units per field, within the live limit.
  const long = "const value = compute(input);\n".repeat(25_000);
  assert.ok(long.length > 262_144 && long.length <= LIMITS.text);
  const { reply } = await claudeReply({ content: [{ type: "text", text: long }] });
  assert.equal(reply.text, long);
  assert.equal(reply.complete, true);
  assert.equal(reply.coverageReasons, undefined);
  // So does a reply of many blocks, above the earlier 256.
  const blocks = Array.from({ length: 600 }, (_, n) =>
    n % 2
      ? { type: "text", text: `part ${n}. ` }
      : { type: "tool_use", name: "bash_tool", input: { command: `echo ${n}` } },
  );
  const many = (await claudeReply({ content: blocks })).reply;
  assert.ok(HISTORY_LIMITS.blocks >= 600);
  assert.match(many.text!, /^part 1\. part 3\. /);
  assert.match(many.toolInput!, /echo 598/);
  assert.equal(many.complete, true);
});

test("history limits: a part past the limits is named on the message, not dropped silently", async () => {
  const over = "x".repeat(HISTORY_LIMITS.messageUnits + 1);
  const { reply } = await claudeReply({ content: [{ type: "text", text: over }] });
  assert.equal(reply.text, null);
  assert.equal(reply.complete, false);
  assert.deepEqual(reply.coverageReasons, ["capture_limit_exceeded"]);
  const tooMany = Array.from({ length: HISTORY_LIMITS.blocks + 1 }, () => ({
    type: "text",
    text: "a",
  }));
  const blocks = (await claudeReply({ content: tooMany })).reply;
  assert.equal(blocks.text, null);
  assert.deepEqual(blocks.coverageReasons, ["capture_limit_exceeded"]);
  const thinking = (
    await claudeReply({
      content: [
        { type: "thinking", thinking: over },
        { type: "text", text: "Answer" },
      ],
    })
  ).reply;
  assert.equal(thinking.text, "Answer");
  assert.equal(thinking.thinking, undefined);
  assert.ok(thinking.coverageReasons.includes("capture_limit_exceeded"));
  // An attached file keeps the counter's own limit for one file.
  const attachment = (text: string) => ({
    attachments: [
      { extracted_content: text, file_type: "text/plain", file_size: text.length },
    ],
  });
  const fits = (
    await claudeReply(
      { content: [{ type: "text", text: "Read it" }] },
      attachment("f".repeat(HISTORY_LIMITS.inlineFileUnits)),
    )
  ).prompt;
  assert.equal(fits.inlineFiles[0].text.length, HISTORY_LIMITS.inlineFileUnits);
  assert.equal(fits.coverageReasons, undefined);
  const large = (
    await claudeReply(
      { content: [{ type: "text", text: "Read it" }] },
      attachment("f".repeat(HISTORY_LIMITS.inlineFileUnits + 1)),
    )
  ).prompt;
  assert.equal(large.inlineFiles, null);
  assert.deepEqual(large.coverageReasons, ["capture_limit_exceeded"]);
});

test("history limits: a ChatGPT page with a long reply counts it", async () => {
  const source = JSON.parse(
    readFileSync(
      new URL("../../../fixtures/history-observation-2026-09-14/chatgpt-flat-page.json", import.meta.url),
      "utf8",
    ),
  );
  const long = "def step(x):\n    return x + 1\n".repeat(20_000);
  assert.ok(long.length > 524_288 && long.length <= LIMITS.text);
  source.messages = [
    source.messages[0],
    {
      id: id(10000),
      author: { role: "user" },
      channel: null,
      status: "finished_successfully",
      create_time: 1767261600,
      content: { content_type: "text", parts: ["Synthetic prompt"] },
      metadata: { request_id: id(3000), parent_id: source.messages[0].id },
    },
    {
      id: id(10001),
      author: { role: "assistant" },
      channel: "final",
      status: "finished_successfully",
      end_turn: true,
      create_time: 1767261601,
      content: { content_type: "text", parts: [long] },
      metadata: { request_id: id(3000), is_complete: true, parent_id: id(10000) },
    },
  ];
  source.current_node = id(10001);
  source.page_info = {
    start_cursor: source.messages[0].id,
    end_cursor: id(10001),
    has_previous_page: false,
    has_next_page: false,
  };
  const rows: any[] = [];
  const stream = new ProviderHistoryStream("chatgpt", source.conversation_id, observedAt, async (batch) => {
    assert.equal(
      validateProviderStreamCapture({
        channel: PROVIDER_STREAM_CHANNEL,
        id: crypto.randomUUID(),
        site: "chatgpt",
        conversationId: source.conversation_id,
        observedAt,
        event: "batch",
        rows: batch,
        meta: null,
      }),
      true,
    );
    rows.push(...batch);
  });
  await stream.write(new TextEncoder().encode(JSON.stringify(source)));
  await stream.finish();
  const reply = rows.find((row) => row.message.role === "response")!.message;
  assert.equal(reply.text, long);
  assert.equal(reply.coverageReasons, undefined);
});

test("history limits: Details names a part left out for its size", () => {
  const note = (reasons: Record<string, number>) =>
    coverageNotes("claude", reasons).some((line) => /longer than the tracker reads/.test(line));
  assert.equal(note({ capture_limit_exceeded: 1 }), true);
  assert.equal(note({}), false);
});

test("history limits: a saved count basis takes every length the history reader takes", () => {
  assert.equal(HISTORY_BASIS_FIELD_UNITS, HISTORY_LIMITS.messageUnits);
  assert.equal(HISTORY_BASIS_FILE_UNITS, HISTORY_LIMITS.inlineFileUnits);
  const measurement = {
    value: null,
    evidence: "unknown",
    scope: "observed_text",
    completeness: "unknown",
    profile_id: null,
    reason: "tokenizer_unavailable",
  };
  const basis = (units: number, part = units, file = 0) => ({
    units,
    fileUnits: [file],
    partUnits: { visible_thinking: part },
    partTokens: {},
    componentUnits: [part],
    componentTokens: [null],
    implementationId: "synthetic",
    profileId: "synthetic",
    assetHash: "synthetic",
    tokens: measurement,
    inlineFileComponents: null,
  });
  const max = HISTORY_LIMITS.messageUnits;
  const accepted = (value: unknown) => HistoryCountBasisSchema.safeParse(value).success;
  assert.equal(accepted(basis(max)), true);
  assert.equal(accepted(basis(max + 1, 0)), false);
  assert.equal(accepted(basis(0, max + 1)), false);
  assert.equal(accepted(basis(0, 0, HISTORY_LIMITS.inlineFileUnits)), true);
  assert.equal(accepted(basis(0, 0, HISTORY_LIMITS.inlineFileUnits + 1)), false);
});
