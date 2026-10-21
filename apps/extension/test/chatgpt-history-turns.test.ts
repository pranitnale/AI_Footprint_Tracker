import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { Ledger } from "@footprint/ledger";
import type { HistoryMessage } from "@footprint/contracts";
import { parseHistoryText } from "@footprint/adapters";
import { ProviderHistoryStream } from "../lib/provider-history-stream";
import {
  PROVIDER_STREAM_CHANNEL,
  validateProviderStreamCapture,
} from "../lib/provider-history-message";
import { createHistoryTextObserver } from "../lib/passive-history-text";
import { Coordinator } from "../lib/coordinator";
import { countByTextLength } from "./counting-fixture";

// A synthetic saved ChatGPT page with every part W6 reads: thinking, tool calls and shown
// results, an image, a Deep Research run, a voice turn and an uploaded image.
const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const conversation = uid(42);
const observedAt = "2026-10-04T12:00:00.000Z";
const request = (n: number) => uid(9000 + n);
const row = (n: number, role: string, content: any, options: any = {}) => {
  const { req, parent, metadata, ...rest } = options;
  return {
    id: uid(n),
    author: { role },
    create_time: 1767261600 + n,
    update_time: role === "assistant" ? 1767261600 + n + 0.5 : null,
    content,
    status: "finished_successfully",
    end_turn: null,
    recipient: "all",
    channel: null,
    ...rest,
    metadata: {
      ...(req ? { request_id: request(req) } : {}),
      ...(parent ? { parent_id: uid(parent) } : {}),
      ...metadata,
    },
  };
};
const text = (...parts: unknown[]) => ({ content_type: "text", parts });
const final = (n: number, body: string, options: any = {}) =>
  row(n, "assistant", text(body), {
    channel: "final",
    end_turn: true,
    ...options,
    metadata: { is_complete: true, model_slug: "gpt-5-5", ...options.metadata },
  });
function source() {
  const rows = [
    row(1, "system", text(""), {
      metadata: { is_visually_hidden_from_conversation: true },
    }),
    row(
      2,
      "user",
      {
        content_type: "multimodal_text",
        parts: [
          {
            content_type: "image_asset_pointer",
            asset_pointer: "file-service://a",
            width: 800,
            height: 600,
          },
          "What is shown?",
        ],
      },
      { req: 1, parent: 1 },
    ),
    row(
      3,
      "assistant",
      {
        content_type: "thoughts",
        thoughts: [{ summary: "Look", content: "A chart" }],
      },
      { req: 1, parent: 2 },
    ),
    row(
      4,
      "assistant",
      { content_type: "code", text: "print(2 + 2)" },
      { req: 1, parent: 3, recipient: "python" },
    ),
    row(
      5,
      "tool",
      { content_type: "execution_output", text: "4" },
      { req: 1, parent: 4 },
    ),
    final(6, "A chart of four bars.", { req: 1, parent: 5 }),
    row(7, "user", text("Draw it"), { req: 2, parent: 6 }),
    row(
      8,
      "assistant",
      { content_type: "code", text: '{"prompt":"bars"}' },
      { req: 2, parent: 7, recipient: "t2uay3k.sj1i4kz" },
    ),
    row(
      9,
      "tool",
      {
        content_type: "multimodal_text",
        parts: [
          {
            content_type: "image_asset_pointer",
            asset_pointer: "file-service://bars",
            width: 1024,
            height: 1024,
            metadata: {
              generation: {
                gen_id: "gen-bars",
                parent_gen_id: null,
                width: 1024,
                height: 1024,
              },
              dalle: { gen_id: "gen-bars", parent_gen_id: null, edit_op: null },
            },
          },
        ],
      },
      {
        req: 2,
        parent: 8,
        author: { role: "tool", name: "t2uay3k.sj1i4kz" },
        metadata: { ghostrider: { status: "final" } },
      },
    ),
    final(10, "Here it is.", { req: 2, parent: 9 }),
    row(11, "user", text("Research heat pumps"), { req: 3, parent: 10 }),
    row(
      12,
      "assistant",
      { content_type: "code", text: '{"topic":"heat pumps"}' },
      { req: 3, parent: 11, recipient: "api_tool.call_tool" },
    ),
    row(13, "tool", text("{}"), {
      req: 3,
      parent: 12,
      author: { role: "tool", name: "api_tool.call_tool" },
      metadata: {
        chatgpt_sdk: {
          widget_state: JSON.stringify({
            plan: [{ title: "Find sources", reason: "Facts first" }],
            research_started_at: 1767261700,
            research_stopped_at: 1767261790,
            report_message: {
              content: { content_type: "text", parts: ["Report body"] },
              metadata: { resolved_model_slug: "gpt-5-thinking" },
            },
          }),
        },
      },
    }),
    row(
      14,
      "user",
      {
        content_type: "multimodal_text",
        parts: [
          {
            content_type: "audio_transcription",
            text: "Thanks",
            direction: "in",
          },
        ],
      },
      { req: 4, parent: 13 },
    ),
    row(
      15,
      "assistant",
      {
        content_type: "multimodal_text",
        parts: [
          {
            content_type: "audio_transcription",
            text: "You are welcome",
            direction: "out",
          },
        ],
      },
      { req: 4, parent: 14, end_turn: true, metadata: { model_slug: "bidi" } },
    ),
  ];
  return {
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
  };
}

test("W6 the streamed reader gives the same saved ChatGPT turns as the page parser", async () => {
  const body = source();
  const batches: any[][] = [];
  const parser = new ProviderHistoryStream(
    "chatgpt",
    conversation,
    observedAt,
    async (rows) => {
      batches.push(rows);
    },
  );
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  // Small writes split rows across reads, as a slow network would.
  for (let offset = 0; offset < bytes.length; offset += 97)
    await parser.write(bytes.subarray(offset, offset + 97));
  const meta = await parser.finish();
  for (const rows of batches)
    assert.equal(
      validateProviderStreamCapture({
        channel: PROVIDER_STREAM_CHANNEL,
        id: crypto.randomUUID(),
        site: "chatgpt",
        conversationId: conversation,
        observedAt,
        event: "batch",
        rows,
        meta: null,
      }),
      true,
    );
  const page = parseHistoryText("chatgpt", body, conversation, observedAt);
  const streamed = batches.flat();
  assert.equal(page.status, "partial");
  assert.deepEqual(
    page.messages.map((m) => [m.role, m.sourceId]),
    [
      ["prompt", uid(2)],
      ["response", uid(6)],
      ["prompt", uid(7)],
      ["response", uid(10)],
      ["prompt", uid(11)],
      ["response", uid(12)],
      ["prompt", uid(14)],
      ["response", uid(15)],
    ],
  );
  // Links resolve in the background; the rest of each message is the same.
  for (const [index, message] of page.messages.entries()) {
    const { parentSourceId, parentRole, promptSourceId, ...rest } = message;
    const {
      parentSourceId: _p,
      parentRole: _r,
      promptSourceId: _s,
      ...fromStream
    } = streamed[index].message;
    assert.deepEqual(fromStream, rest, `message ${index}`);
    assert.equal(streamed[index].parentRef, parentSourceId, `parent ${index}`);
  }
  assert.equal(meta.selectedLeafId, page.selectedLeafId);
  assert.equal(meta.selectedLeafId, uid(15));
  assert.equal(meta.firstRequestVerified, true);
  assert.deepEqual(page.messages[0]!.inputImages, [
    { width: 800, height: 600 },
  ]);
  assert.equal(page.messages[1]!.thinking, "Look\nA chart");
  assert.equal(page.messages[1]!.toolOutput, "4");
  assert.equal(page.messages[3]!.media?.[0]?.kind, "image");
  assert.equal(
    page.messages[5]!.components?.[0]?.timing?.duration_seconds,
    "90",
  );
  assert.equal(page.messages[6]!.text, "Thanks");
  assert.deepEqual(page.messages[7]!.media, [
    { kind: "speech", basis: "characters", seconds: null, characters: 15 },
  ]);
});

test("W6 a streamed ChatGPT page saves each turn once with its parts, images, research time and speech", async () => {
  const db = await Ledger.open("chatgpt-turns-" + crypto.randomUUID());
  const coordinator = new Coordinator(db, {
    count: countByTextLength,
    hasConsent: async () => true,
    hasSiteConsent: async () => true,
    sendDisplay: async () => {},
    transport: async () => {
      throw new Error("unexpected network");
    },
  });
  const binding = {
    documentNonce: crypto.randomUUID(),
    navigationNonce: crypto.randomUUID(),
    captureId: null,
  };
  const sender = {
    tab: { id: 801 },
    frameId: 0,
    documentId: "synthetic-chatgpt-turns",
    url: `https://chatgpt.com/c/${conversation}`,
  };
  Object.assign(globalThis, {
    location: {
      origin: "https://chatgpt.com",
      hostname: "chatgpt.com",
      pathname: `/c/${conversation}`,
      href: `https://chatgpt.com/c/${conversation}`,
    },
  });
  let started: Promise<unknown> = Promise.resolve();
  let resolveFinish!: (accepted: boolean) => void;
  const finished = new Promise<boolean>((resolve) => {
    resolveFinish = resolve;
  });
  const observer = createHistoryTextObserver(
    (event) => {
      if (event.event === "start")
        started = coordinator.history.receive(event, binding, sender);
    },
    () => {},
    async (event) => {
      await started;
      const result = await coordinator.history.receiveStream(
        event,
        binding,
        sender,
      );
      if (event.event === "finish") resolveFinish(result.accepted);
      return result.accepted;
    },
  );
  try {
    await coordinator.whenReady();
    observer.observe(
      new URL(`https://chatgpt.com/backend-api/conversations/${conversation}`),
      "GET",
      Promise.resolve(new Response(JSON.stringify(source()))),
      Date.now(),
    );
    assert.equal(
      await Promise.race([
        finished,
        new Promise<boolean>((_, reject) =>
          setTimeout(() => reject(new Error("stream timeout")), 15000),
        ),
      ]),
      true,
    );
    const records = (
      await db.all<{ record: HistoryMessage }>("history_records")
    ).map((row) => row.record);
    assert.equal(records.length, 8);
    const replies = records.filter((m) => m.role === "response");
    assert.equal(replies.length, 4);
    const byParts = (predicate: (m: HistoryMessage) => boolean) => {
      const found = replies.filter(predicate);
      assert.equal(found.length, 1);
      return found[0]!;
    };
    const tools = byParts((m) => m.parts?.tool_output.value === "1");
    // Thinking (12 characters) and tool input (12) count as output with the answer (21).
    assert.equal(tools.parts!.visible_thinking.value, "12");
    assert.equal(tools.parts!.tool_input.value, "12");
    assert.equal(tools.tokens.value, String(21 + 12 + 12));
    const image = byParts((m) =>
      m.generation.media.some((item) => item.kind === "image"),
    );
    assert.deepEqual(image.generation.media, [
      {
        kind: "image",
        model_id: null,
        count: "1",
        width: 1024,
        height: 1024,
        outcome: "returned",
      },
    ]);
    const research = byParts((m) => m.generation.text_components.length > 0);
    assert.equal(research.generation.text_components[0]!.role, "research");
    assert.equal(
      research.generation.text_components[0]!.timing?.scope,
      "research_task",
    );
    assert.equal(
      research.generation.text_components[0]!.timing?.duration_seconds,
      "90",
    );
    assert.ok(research.coverage_reasons.includes("research_work_unobserved"));
    const voice = byParts((m) =>
      m.generation.media.some((item) => item.kind === "speech"),
    );
    assert.deepEqual(voice.generation.media, [
      {
        kind: "speech",
        length_basis: "characters",
        seconds: null,
        characters: "15",
      },
    ]);
    // Counts only: no saved text leaves the parser.
    const stored = JSON.stringify(await db.all("history_records"));
    for (const words of [
      "A chart of four bars",
      "Report body",
      "You are welcome",
    ])
      assert.equal(stored.includes(words), false, words);
  } finally {
    observer.cancel();
    coordinator.history.invalidate();
    coordinator.engines.dispose();
    db.close();
  }
});
