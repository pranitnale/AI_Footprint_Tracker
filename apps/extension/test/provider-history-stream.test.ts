import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ProviderHistoryStream } from "../lib/provider-history-stream";
import {
  PROVIDER_STREAM_CHANNEL,
  validateProviderStreamCapture,
} from "../lib/provider-history-message";
import { geminiHistoryFrames, parseHistoryText } from "@footprint/adapters";

const observedAt = "2026-09-22T12:00:00.000Z";
const id = "00000000-0000-4000-8000-000000000042";
const fixture = (name: string) =>
  JSON.parse(readFileSync(
    new URL(`../../../fixtures/history-observation-2026-09-14/${name}.json`, import.meta.url),
    "utf8",
  ));
async function capture(
  site: "chatgpt" | "perplexity" | "gemini",
  conversationId: string,
  body: string,
) {
  const batches: any[][] = [];
  const parser = new ProviderHistoryStream(site, conversationId, observedAt, async (rows) => {
    assert.ok(rows.length <= 50);
    batches.push(rows);
  });
  const bytes = new TextEncoder().encode(body);
  for (let offset = 0; offset < bytes.length; offset += 32768)
    await parser.write(bytes.subarray(offset, offset + 32768));
  const meta = await parser.finish();
  for (const rows of batches)
    assert.equal(validateProviderStreamCapture({
      channel: PROVIDER_STREAM_CHANNEL,
      id: crypto.randomUUID(),
      site,
      conversationId,
      observedAt,
      event: "batch",
      rows,
      meta: null,
    }), true);
  assert.equal(validateProviderStreamCapture({
    channel: PROVIDER_STREAM_CHANNEL,
    id: crypto.randomUUID(),
    site,
    conversationId,
    observedAt,
    event: "finish",
    rows: null,
    meta,
  }), true);
  assert.equal(batches.flat().length, meta.messageCount);
  return { rows: batches.flat(), meta, batches, bytes };
}

test("ChatGPT history streams past old byte and message limits in bounded batches", async () => {
  const source = fixture("chatgpt-flat-page");
  source.messages = [source.messages[0]];
  for (let index = 0; index < 1100; index++) {
    const uuid = `00000000-0000-4000-8000-${String(index + 10000).padStart(12, "0")}`;
    source.messages.push({
      id: uuid,
      author: { role: index % 2 ? "assistant" : "user" },
      channel: index % 2 ? "final" : null,
      status: "finished_successfully",
      create_time: 1767261600 + index,
      update_time: 1767261601 + index,
      content: { content_type: "text", parts: ["x".repeat(1500)] },
      metadata: {
        request_id: `00000000-0000-4000-8000-${String(Math.floor(index / 2) + 3000).padStart(12, "0")}`,
        is_complete: true,
        parent_id: index
          ? `00000000-0000-4000-8000-${String(index + 9999).padStart(12, "0")}`
          : source.messages[0].id,
      },
    });
  }
  source.current_node = source.messages.at(-1).id;
  source.page_info = {
    has_previous_page: false,
    has_next_page: false,
    start_cursor: source.messages[0].id,
    end_cursor: source.current_node,
  };
  source.context_truncation_continuation = null;
  const result = await capture("chatgpt", source.conversation_id, JSON.stringify(source));
  assert.ok(result.bytes.length > 1048576);
  assert.equal(result.rows.length, 1100);
  assert.ok(result.batches.length > 20);
  assert.equal(result.meta.firstRequestVerified, true);
  assert.equal(result.meta.selectedLeafId, source.current_node);
  assert.equal(result.rows[1].requestRef, result.rows[0].requestRef);
});

test("a ChatGPT page that starts at its first prompt proves it, as the adapter does (Work 5 Oct, every chat 18 Oct 2026)", async () => {
  const work = () => {
    const body = fixture("chatgpt-flat-page");
    body.conversation_origin = "tpp";
    body.messages.shift();
    // Without the hidden system message after the first prompt as well: since October 2026
    // that message alone proves any chat's start (chatgpt-earlier-page.test.ts).
    body.messages.splice(1, 1);
    body.page_info.start_cursor = body.messages[0].id;
    return body;
  };
  const verified = async (body: any) => {
    const { meta } = await capture("chatgpt", body.conversation_id, JSON.stringify(body));
    assert.equal(
      meta.firstRequestVerified,
      parseHistoryText("chatgpt", body, body.conversation_id, observedAt).firstRequestVerified,
    );
    return meta;
  };
  const meta = await verified(work());
  assert.equal(meta.firstRequestVerified, true);
  assert.equal(meta.rootSourceId, work().messages[0].id);
  const usual = fixture("chatgpt-flat-page");
  usual.conversation_origin = "tpp";
  assert.equal((await verified(usual)).firstRequestVerified, true);
  // Chats begun since 18 Oct 2026 are saved without any system message, Work or not.
  for (const mutate of [
    (v: any) => delete v.conversation_origin,
    (v: any) => (v.conversation_origin = "other"),
  ]) {
    const body = work();
    mutate(body);
    const other = await verified(body);
    assert.equal(other.firstRequestVerified, true);
    assert.equal(other.rootSourceId, body.messages[0].id);
  }
  for (const mutate of [
    (v: any) => (v.page_info.has_previous_page = true),
    (v: any) => (v.page_info.start_cursor = v.messages[1].id),
  ]) {
    const body = work();
    mutate(body);
    assert.equal((await verified(body)).firstRequestVerified, false);
  }
});

test("Perplexity history streams entries past old limits in bounded batches", async () => {
  const source = fixture("perplexity-workflow-page");
  const sample = source.entries[0];
  source.entries = Array.from({ length: 600 }, (_, index) => ({
    ...sample,
    frontend_uuid: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    uuid: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    backend_uuid: index ? `00000000-0000-4000-8000-${String(index + 5000).padStart(12, "0")}` : id,
    entry_created_datetime: new Date(Date.UTC(2026, 0, 1, 10, 0, index)).toISOString(),
    entry_updated_datetime: new Date(Date.UTC(2026, 0, 1, 10, 0, index + 1)).toISOString(),
    query_str: "q".repeat(1200),
  }));
  source.first_entry = { ...source.entries[0] };
  const result = await capture("perplexity", id, JSON.stringify(source));
  assert.ok(result.bytes.length > 1048576);
  assert.equal(result.rows.length, 1200);
  assert.equal(result.meta.firstRequestVerified, true);
  assert.equal(result.rows[0].message.role, "prompt");
  assert.equal(result.rows[1].message.role, "response");
});

test("Perplexity history refuses two entries that name one reply", async () => {
  const source = fixture("perplexity-workflow-page");
  source.entries[1].backend_uuid = source.entries[0].backend_uuid;
  await assert.rejects(
    capture("perplexity", id, JSON.stringify(source)),
    /history_unsupported/,
  );
});

test("Gemini history frame is admitted without a conversation-wide response cap", async () => {
  const wire = readFileSync(
    new URL("../../../fixtures/history-observation-2026-09-14/gemini-history-wire.txt", import.meta.url),
    "utf8",
  );
  const result = await capture("gemini", "c_0000000000000042", wire);
  assert.ok(result.rows.length > 0);
  assert.equal(result.meta.branchScope, "selected_branch");
});

test("Gemini counts an observed page larger than the former response ceiling in batches", async () => {
  const source = fixture("gemini-selected-history");
  for (const row of source.response_payload[0]) {
    row[2][0] = ["p".repeat(115000)];
    const selected = row[3][0].find((candidate: any) => candidate[0] === row[3][3]);
    selected[1] = ["r".repeat(115000)];
  }
  const frame = JSON.stringify([["wrb.fr", "hNvQHb", JSON.stringify(source.response_payload), null, null]]);
  const wire = ")]}'\n" + (frame.length + 2) + "\n" + frame + "\n";
  const result = await capture("gemini", "c_0000000000000042", wire);
  assert.ok(result.bytes.length > 1048576);
  assert.equal(result.rows.length, 10);
  assert.ok(result.batches.length > 1);
  assert.equal(result.meta.firstRequestVerified, true);
});

test("streamed provider rows retain the same countable text and completeness as their adapters", async () => {
  const cases = [
    ["chatgpt", "chatgpt-flat-page", id],
    ["perplexity", "perplexity-workflow-page", id],
  ] as const;
  for (const [site, name, conversationId] of cases) {
    const source = fixture(name);
    const streamed = await capture(site, conversationId, JSON.stringify(source));
    const original = parseHistoryText(site, source, conversationId, observedAt);
    assert.equal(streamed.rows.length, original.messages.length);
    for (let index = 0; index < original.messages.length; index++) {
      const fromStream = streamed.rows[index].message;
      const fromAdapter = original.messages[index];
      for (const key of ["sourceId", "role", "text", "complete", "modelId", "timing"] as const)
        assert.deepEqual(fromStream[key], fromAdapter[key], `${site} ${index} ${key}`);
    }
  }
  const wire = readFileSync(
    new URL("../../../fixtures/history-observation-2026-09-14/gemini-history-wire.txt", import.meta.url),
    "utf8",
  );
  const streamed = await capture("gemini", "c_0000000000000042", wire);
  const original = parseHistoryText(
    "gemini", geminiHistoryFrames(wire), "c_0000000000000042", observedAt,
  );
  assert.deepEqual(streamed.rows.map((row) => row.message), original.messages);
});

test("cross-provider parser rejects duplicate source rows and unfinished responses", async () => {
  const chatgpt = fixture("chatgpt-flat-page");
  chatgpt.messages.push({ ...chatgpt.messages[1] });
  const duplicate = new ProviderHistoryStream("chatgpt", id, observedAt, async () => {});
  await assert.rejects(
    duplicate.write(new TextEncoder().encode(JSON.stringify(chatgpt))),
    /history_unsupported/,
  );
  const perplexity = fixture("perplexity-workflow-page");
  const incomplete = new ProviderHistoryStream("perplexity", id, observedAt, async () => {});
  const body = JSON.stringify(perplexity);
  await incomplete.write(new TextEncoder().encode(body.slice(0, -3)));
  await assert.rejects(incomplete.finish());
});
