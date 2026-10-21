import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseHistoryText,
  geminiHistoryFrames,
  historyInstant,
  HISTORY_LIMITS,
} from "../src/history";

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
const id = "00000000-0000-4000-8000-000000000042";
const at = "2026-09-14T12:00:00.000Z";

test("flat ChatGPT selects only two prompts and two final visible answers with narrow first-available root proof", () => {
  const page = parseHistoryText(
    "chatgpt",
    fixture("chatgpt-flat-page"),
    id,
    at,
  );
  assert.equal(page.status, "partial");
  assert.deepEqual(
    page.messages.map((m) => m.role),
    ["prompt", "response", "prompt", "response"],
  );
  assert.ok(
    page.messages.every((m) => m.text?.startsWith("Synthetic historical")),
  );
  assert.equal(page.firstRequestVerified, true);
  assert.equal(page.branchSourceIds, null);
  assert.ok(
    page.messages.every(
      (m) => m.liveAttemptId === (m.role === "response" ? m.sourceId : null),
    ),
  );
  assert.equal(page.messages[0]!.occurredAt, "2026-01-01T10:00:00.000Z");
  assert.ok(!JSON.stringify(page).includes("recap"));
});
test("a ChatGPT page that starts at its first prompt proves that prompt, in Work chats (5 Oct 2026) and in every chat since 18 Oct 2026", () => {
  // A Work page with the usual hidden system message still proves its first prompt.
  const usual = fixture("chatgpt-flat-page");
  usual.conversation_origin = "tpp";
  assert.equal(
    parseHistoryText("chatgpt", usual, id, at).firstRequestVerified,
    true,
  );
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
  const page = parseHistoryText("chatgpt", work(), id, at);
  assert.equal(page.firstRequestVerified, true);
  assert.equal(page.rootSourceId, work().messages[0].id);
  assert.deepEqual(
    page.messages.map((m) => m.role),
    ["prompt", "response", "prompt", "response"],
  );
  // Chats begun since 18 Oct 2026 are saved without any system message, Work or not.
  for (const mutate of [
    (v: any) => delete v.conversation_origin,
    (v: any) => (v.conversation_origin = "other"),
  ]) {
    const body = work();
    mutate(body);
    const other = parseHistoryText("chatgpt", body, id, at);
    assert.equal(other.firstRequestVerified, true);
    assert.equal(other.rootSourceId, body.messages[0].id);
  }
  for (const mutate of [
    (v: any) => (v.page_info.has_previous_page = true),
    (v: any) => (v.page_info.start_cursor = v.messages[1].id),
    (v: any) => (v.context_truncation_continuation = {}),
  ]) {
    const body = work();
    mutate(body);
    assert.equal(
      parseHistoryText("chatgpt", body, id, at).firstRequestVerified,
      false,
    );
  }
});
test("ChatGPT ambiguous request grouping, duplicate source IDs and unsupported parts cannot invent identities or text", () => {
  const body = fixture("chatgpt-flat-page");
  const prompt = body.messages.find((m: any) => m.author.role === "user");
  body.messages.push({ ...prompt, id: "00000000-0000-4000-8000-000000000099" });
  const page = parseHistoryText("chatgpt", body, id, at);
  assert.equal(
    page.messages.find((m) => m.role === "response")!.requestId,
    null,
  );
  body.messages.push(prompt);
  assert.equal(parseHistoryText("chatgpt", body, id, at).status, "unsupported");
  const opaque = fixture("chatgpt-flat-page");
  opaque.messages.find((m: any) => m.author.role === "user").content.parts = [
    { text: "must not inspect" },
  ];
  assert.equal(
    parseHistoryText("chatgpt", opaque, id, at).messages[0]!.text,
    null,
  );
});
test("Perplexity counts canonical answer once and keeps capability/context/thread metadata out", () => {
  const page = parseHistoryText(
    "perplexity",
    fixture("perplexity-workflow-page"),
    id,
    at,
  );
  assert.equal(page.messages.length, 4);
  assert.equal(page.messages[1]!.text, "Synthetic historical answer 1.");
  assert.equal(page.messages[0]!.occurredAt, "2026-01-01T10:00:00.000001Z");
  assert.equal(page.messages[1]!.occurredAt, "2026-01-01T10:00:00.000001Z");
  assert.equal(page.messages[1]!.dateBasis, "entry_created");
  assert.equal(page.firstRequestVerified, true);
  assert.equal(page.rootSourceId, page.messages[0]!.sourceId);
  assert.equal(page.branchScope, "loaded_messages");
  assert.equal(page.branchSourceIds, null);
  assert.equal(page.selectedLeafId, null);
  assert.ok(!JSON.stringify(page).includes("SYNTHETIC_CAPABILITY"));
  assert.ok(!JSON.stringify(page).includes("context_uuid"));
});
test("Perplexity first-available pointer must match the unique primary root, dates and canonical query", () => {
  const other = "00000000-0000-4000-8000-000000000099";
  for (const mutate of [
    (v: any) => delete v.first_entry,
    (v: any) => (v.first_entry.thread_url_slug = other),
    (v: any) => (v.first_entry.backend_uuid = other),
    (v: any) => (v.first_entry.uuid = other),
    (v: any) => {
      v.first_entry.uuid = other;
      v.first_entry.frontend_uuid = other;
    },
    (v: any) =>
      (v.first_entry.entry_created_datetime =
        "2026-01-01T10:00:00.000002+00:00"),
    (v: any) => (v.first_entry.query_str = "different query"),
    (v: any) => {
      v.first_entry.entry_created_datetime = "unavailable";
      v.entries[0].entry_created_datetime = "unavailable";
    },
    (v: any) => (v.entries[0].backend_uuid = other),
    (v: any) => (v.entries[1].backend_uuid = id),
    (v: any) => v.entries.push(structuredClone(v.entries[0])),
    (v: any) => v.entries.reverse(),
    (v: any) =>
      (v.entries[1].entry_created_datetime =
        v.entries[0].entry_created_datetime),
    (v: any) => (v.first_entry = structuredClone(v.entries[1])),
  ]) {
    const body = fixture("perplexity-workflow-page");
    mutate(body);
    const page = parseHistoryText("perplexity", body, id, at);
    assert.equal(page.firstRequestVerified, false);
    assert.equal(page.rootSourceId, null);
  }
  const more = fixture("perplexity-workflow-page");
  more.has_next_page = true;
  const page = parseHistoryText("perplexity", more, id, at);
  assert.equal(page.firstRequestVerified, true);
  assert.equal(page.hasLater, true);
  assert.equal(page.messages.length, 4);
  assert.equal(Object.hasOwn(page, "provider_history_complete"), false);
});
test("Perplexity counts each answer once, and a saved answer that disagrees with its pieces is partial (W7)", () => {
  const plain = fixture("perplexity-workflow-page");
  const expected =
    plain.entries[0].blocks[0].workflow_block.steps[0].items[0].payload
      .text_payload.text;
  for (const mode of ["chunks", "repeat", "streaming"]) {
    const body = fixture("perplexity-workflow-page");
    const items = body.entries[0].blocks[0].workflow_block.steps[0].items;
    if (mode === "chunks") items[0].payload.text_payload.chunks = ["different"];
    // The same answer in a second item counts once (A1).
    if (mode === "repeat") items.push(structuredClone(items[0]));
    if (mode === "streaming") items[0].payload.text_payload.is_streaming = true;
    const response = parseHistoryText("perplexity", body, id, at).messages[1]!;
    if (mode === "streaming") {
      // Still streaming when saved: its pieces are the text so far.
      assert.equal(
        response.text,
        items[0].payload.text_payload.chunks.join(""),
      );
      assert.equal(response.coverageReasons, undefined);
    } else {
      assert.equal(response.text, expected, mode);
      assert.deepEqual(
        response.coverageReasons,
        mode === "chunks" ? ["unknown_event_observed"] : undefined,
        mode,
      );
    }
  }
});
// Req counts every request, branches an edit or a regeneration replaced included (owner
// rule of 26 Sep 2026); the selected chain still proves the start (14 Oct 2026).
test("Claude reads every branch once, proves the start from the selected chain, reads content blocks and separately scopes inline files", () => {
  const body = fixture("claude-selected-history");
  const other = "00000000-0000-4000-8000-000000000099";
  body.chat_messages.push({
    ...body.chat_messages[1],
    uuid: other,
    content: [{ type: "text", text: "OTHER_BRANCH_REPLY" }],
  });
  const page = parseHistoryText("claude", body, id, at);
  assert.equal(page.messages.length, 3);
  assert.equal(page.branchScope, "loaded_messages");
  assert.deepEqual(page.branchSourceIds, [
    body.chat_messages[0].uuid,
    body.chat_messages[1].uuid,
  ]);
  assert.equal(page.selectedLeafId, body.current_leaf_message_uuid);
  assert.equal(page.firstRequestVerified, true);
  assert.equal(page.rootSourceId, body.chat_messages[0].uuid);
  assert.equal(page.messages[0]!.inlineFiles![0]!.text, "SYNTHETIC-MARKER-042");
  assert.equal(
    page.messages[0]!.text,
    "Read the synthetic marker from the attached file.",
  );
  assert.equal(page.messages[1]!.parentRole, "prompt");
  // The regenerated reply answers the same prompt.
  const regenerated = page.messages.find((m) => m.sourceId === other)!;
  assert.equal(regenerated.text, "OTHER_BRANCH_REPLY");
  assert.equal(regenerated.parentSourceId, body.chat_messages[0].uuid);
  assert.equal(regenerated.promptSourceId, body.chat_messages[0].uuid);
  assert.equal(regenerated.liveAttemptId, other);
  assert.ok(!JSON.stringify(page).includes("synthetic-marker.txt"));
  assert.equal(page.messages[0]!.requestId, null);
});
test("Claude missing parent retains partial selected suffix while cycles and duplicate IDs reject", () => {
  const body = fixture("claude-selected-history");
  body.chat_messages.shift();
  const suffix = parseHistoryText("claude", body, id, at);
  assert.equal(suffix.messages.length, 1);
  assert.equal(suffix.firstRequestVerified, false);
  body.chat_messages[0].parent_message_uuid = body.chat_messages[0].uuid;
  assert.equal(parseHistoryText("claude", body, id, at).status, "unsupported");
  const duplicate = fixture("claude-selected-history");
  duplicate.chat_messages.push(duplicate.chat_messages[0]);
  assert.equal(
    parseHistoryText("claude", duplicate, id, at).status,
    "unsupported",
  );
});
test("Gemini selects the explicit candidate and linked root, with thoughts apart from the answer and no duplicate rich text", () => {
  const body = fixture("gemini-selected-history");
  const page = parseHistoryText(
    "gemini",
    body.response_payload,
    body.request_arguments[0],
    at,
  );
  assert.equal(page.messages.length, 10);
  assert.equal(page.firstRequestVerified, true);
  const responses = page.messages.filter((m) => m.role === "response");
  // The stopped turn stored an empty answer: no answer text, and not complete (14 Sep).
  const stopped = responses.filter((m) => m.text === "");
  assert.equal(stopped.length, 1);
  assert.equal(stopped[0]!.complete, false);
  assert.ok(responses.every((m) => m.text !== null));
  // Thought summaries the page shows count as thinking, never as the answer (A2).
  const reasoning = "Synthetic reasoning excluded from visible-answer totals.";
  assert.equal(responses.filter((m) => m.thinking === reasoning).length, 4);
  assert.equal(responses.filter((m) => m.thinking === "").length, 1);
  assert.ok(responses.every((m) => !m.text!.includes("reasoning")));
  assert.ok(responses.every((m) => m.toolOutput === ""));
  assert.ok(!JSON.stringify(page).includes("REASONING"));
  assert.ok(!JSON.stringify(page).includes("RICH"));
  assert.ok(
    page.messages.every(
      (m) =>
        m.requestId === m.promptSourceId &&
        m.liveAttemptId === (m.role === "response" ? m.sourceId : null),
    ),
  );
  const reversed = structuredClone(body.response_payload);
  reversed[0].reverse();
  assert.deepEqual(
    parseHistoryText("gemini", reversed, body.request_arguments[0], at),
    page,
  );
});
test("Gemini branch mismatch, selected candidate ambiguity and submicrosecond timestamps fail conservatively", () => {
  const body = fixture("gemini-selected-history");
  body.response_payload[0][0][1][2] = "rc_0000000000009999";
  assert.equal(
    parseHistoryText(
      "gemini",
      body.response_payload,
      body.request_arguments[0],
      at,
    ).status,
    "unsupported",
  );
  const ambiguous = fixture("gemini-selected-history");
  ambiguous.response_payload[0][0][3][0].push(
    ambiguous.response_payload[0][0][3][0][0],
  );
  assert.equal(
    parseHistoryText(
      "gemini",
      ambiguous.response_payload,
      ambiguous.request_arguments[0],
      at,
    ).status,
    "unsupported",
  );
  const date = fixture("gemini-selected-history");
  date.response_payload[0][0][4][1] = 1;
  assert.equal(
    parseHistoryText(
      "gemini",
      date.response_payload,
      date.request_arguments[0],
      at,
    ).messages.at(-2)!.occurredAt,
    null,
  );
});
test("source dates require a timezone, preserve microseconds and reject rolled calendar dates", () => {
  assert.equal(
    historyInstant("2026-01-01T12:00:00.123456+02:00"),
    "2026-01-01T10:00:00.123456Z",
  );
  for (const date of [
    "2026-02-31T00:00:00Z",
    "2026-01-01T12:00:00",
    "2026-01-01T25:00:00Z",
    "not a timestamp",
  ])
    assert.equal(historyInstant(date), null);
});
test("ChatGPT first-available proof requires exact complete boundary and hidden-system prefix", () => {
  for (const mutate of [
    (v: any) => delete v.page_info.has_previous_page,
    (v: any) => (v.page_info.has_previous_page = true),
    (v: any) => (v.page_info.has_next_page = true),
    (v: any) => (v.page_info.start_cursor = crypto.randomUUID()),
    (v: any) => (v.page_info.end_cursor = crypto.randomUUID()),
    (v: any) => (v.current_node = crypto.randomUUID()),
    (v: any) => (v.context_truncation_continuation = "another-page"),
    (v: any) => (v.messages[0].author.role = "tool"),
    (v: any) =>
      (v.messages[0].metadata.is_visually_hidden_from_conversation = false),
  ]) {
    const body = fixture("chatgpt-flat-page");
    mutate(body);
    assert.equal(
      parseHistoryText("chatgpt", body, id, at).firstRequestVerified,
      false,
    );
  }
  const page = parseHistoryText(
    "chatgpt",
    fixture("chatgpt-flat-page"),
    id,
    at,
  );
  assert.ok(
    page.messages.every(
      (m) =>
        m.requestId === (m.role === "prompt" ? m.sourceId : null) &&
        m.liveAttemptId === (m.role === "response" ? m.sourceId : null),
    ),
  );
  assert.equal(page.messages[1]!.promptSourceId, page.messages[0]!.sourceId);
});
test("limits and wrong conversation yield explicit unsupported pages rather than zero complete history", () => {
  const body = fixture("claude-selected-history");
  body.chat_messages[0].content[0].text = "x".repeat(
    HISTORY_LIMITS.messageUnits + 1,
  );
  assert.equal(
    parseHistoryText("claude", body, id, at).messages[0]!.text,
    null,
  );
  assert.equal(
    parseHistoryText("claude", body, "00000000-0000-4000-8000-000000000043", at)
      .status,
    "unsupported",
  );
});
test("Gemini normalized frame lengths count UTF16 plus two and reject malformed/truncated framing", () => {
  const body = fixture("gemini-selected-history");
  const line = JSON.stringify([
    ["wrb.fr", "hNvQHb", JSON.stringify(body.response_payload)],
    ["di", "café 😀"],
  ]);
  const wire = ")]}'\n\n" + (line.length + 2) + "\n" + line + "\n";
  assert.deepEqual(geminiHistoryFrames(wire), body.response_payload);
  assert.throws(() => geminiHistoryFrames(wire.slice(0, -3)));
  assert.throws(() =>
    geminiHistoryFrames(
      wire.replace(String(line.length + 2), String(line.length)),
    ),
  );
  const saved = readFileSync(
    new URL(
      "../../../fixtures/history-observation-2026-09-14/gemini-history-wire.txt",
      import.meta.url,
    ),
    "utf8",
  );
  assert.deepEqual(geminiHistoryFrames(saved), body.response_payload);
});

test("Perplexity carries the raw selected and displayed model labels per role and drops malformed labels", () => {
  const body = fixture("perplexity-workflow-page");
  body.entries[0].user_selected_model = "pplx_pro";
  body.entries[0].display_model = "gpt56_terra";
  body.entries[1].user_selected_model = { nested: "gpt56_terra" };
  body.entries[1].display_model = "x".repeat(65);
  const page = parseHistoryText("perplexity", body, id, at);
  assert.equal(page.messages[0]!.modelId, "pplx_pro");
  assert.equal(page.messages[1]!.modelId, "gpt56_terra");
  assert.equal(page.messages[2]!.modelId, null);
  assert.equal(page.messages[3]!.modelId, null);
  assert.equal(
    parseHistoryText("perplexity", fixture("perplexity-workflow-page"), id, at)
      .messages[1]!.modelId,
    null,
  );
});
