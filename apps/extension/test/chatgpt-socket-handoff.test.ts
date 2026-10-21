import { test } from "node:test";
import assert from "node:assert/strict";
import { installCapture } from "../lib/capture-runtime";

// ChatGPT's live reply in the shapes seen on 18 Oct 2026 (structure only; synthetic text and
// ids). POST /backend-api/f/conversation now sends only delta_encoding,
// resume_conversation_token, stream_handoff and [DONE]; the page then aborts the body and
// reads the reply from the tab's socket, where each frame is an array of envelopes:
// [{type: "message", topic_id, payload: {type: "conversation-turn-stream", payload:
// {type: "stream-item", conversation_id, turn_id, encoded_item, stream_item_id,
// parent_stream_item_id, server_timestamp_ms}, metadata}, offset}]. encoded_item holds the
// same server-sent events the body used to carry. A heartbeat item keeps the stream alive,
// "done" ends it, and conversation-turn-complete follows on the "conversations" topic.

class TestWindow extends EventTarget {
  messages: any[] = [];
  fetch: typeof fetch;
  WebSocket: any = class extends EventTarget {};
  constructor(fetcher: typeof fetch) {
    super();
    this.fetch = fetcher;
  }
  postMessage(value: any) {
    this.messages.push(value);
  }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CHAT = uid(1);
const TURN = uid(2);
const TOPIC = "conversation-turn-" + uid(3);
const event = (value: unknown, name?: string) =>
  `${name ? `event: ${name}\n` : ""}data: ${JSON.stringify(value)}\n\n`;
const assistant = (id: number, content: unknown, extra: object = {}) => ({
  id: uid(id),
  author: { role: "assistant" },
  content,
  status: "finished_successfully",
  end_turn: false,
  recipient: "all",
  channel: null,
  metadata: { model_slug: "gpt-6-pro", resolved_model_slug: "gpt-6-pro" },
  ...extra,
});
/** The reply's events: thoughts, a reasoning recap and the answer, in message slots. */
const reply = [
  event("v1", "delta_encoding"),
  event({
    type: "input_message",
    input_message: { id: uid(10), author: { role: "user" } },
    conversation_id: CHAT,
  }),
  event(
    {
      p: "",
      o: "add",
      c: 0,
      v: {
        conversation_id: CHAT,
        message: assistant(
          11,
          {
            content_type: "thoughts",
            thoughts: [
              { summary: "", content: "Synthetic step", finished: false },
            ],
            source_analysis_msg_id: uid(19),
          },
          { status: "in_progress" },
        ),
      },
    },
    "delta",
  ),
  event(
    {
      c: 0,
      o: "patch",
      v: [
        {
          p: "/message/content/thoughts/0/summary",
          o: "replace",
          v: "Synthetic plan",
        },
        { p: "/message/content/thoughts/0/finished", o: "replace", v: true },
        { p: "/message/status", o: "replace", v: "finished_successfully" },
      ],
    },
    "delta",
  ),
  event(
    {
      p: "",
      o: "add",
      c: 1,
      v: {
        conversation_id: CHAT,
        message: assistant(12, {
          content_type: "reasoning_recap",
          content: "Thought for 4s",
        }),
      },
    },
    "delta",
  ),
  event(
    {
      p: "",
      o: "add",
      c: 2,
      v: {
        conversation_id: CHAT,
        message: assistant(
          13,
          { content_type: "text", parts: [""] },
          { status: "in_progress", channel: "final" },
        ),
      },
    },
    "delta",
  ),
  event(
    {
      c: 2,
      o: "patch",
      v: [{ p: "/message/content/parts/0", o: "append", v: "Synthetic " }],
    },
    "delta",
  ),
  event(
    { v: [{ p: "/message/content/parts/0", o: "append", v: "answer" }] },
    "delta",
  ),
  event(
    {
      v: [
        { p: "/message/status", o: "replace", v: "finished_successfully" },
        { p: "/message/end_turn", o: "replace", v: true },
      ],
    },
    "delta",
  ),
  event({
    type: "server_ste_metadata",
    metadata: { model_slug: "gpt-6-pro" },
    conversation_id: CHAT,
  }),
  event({ type: "message_stream_complete", conversation_id: CHAT }),
];
const handoff = [
  event("v1", "delta_encoding"),
  event({
    type: "resume_conversation_token",
    kind: "topic",
    token: "synthetic-token",
    conversation_id: CHAT,
  }),
  event({
    type: "stream_handoff",
    conversation_id: CHAT,
    turn_exchange_id: TURN,
    options: [
      { type: "resume_sse_endpoint", topic_id: TOPIC },
      { type: "subscribe_ws_topic", topic_id: TOPIC },
    ],
  }),
  "data: [DONE]\n\n",
];
const envelope = (payload: unknown, topic = TOPIC) => [
  { type: "message", topic_id: topic, payload, metadata: {}, offset: "1-0" },
];
const turnStream = (payload: object) =>
  envelope({
    type: "conversation-turn-stream",
    payload: { conversation_id: CHAT, turn_id: TURN, ...payload },
    metadata: {},
  });

type Delivery =
  /** The whole reply in the body, as before any handoff. */
  | "body"
  /** Handed to the socket, the body ending normally (September 2026). */
  | "handoff"
  /** Handed to the socket, the page aborting the body after [DONE] (18 Oct 2026). */
  | "handoff-aborted"
  /** The page aborts the body before the stream names a topic. */
  | "aborted-before-handoff"
  /** An image job's finished body, which the page aborts and then polls (5 Oct 2026). */
  | "image-job-aborted";

/** An image turn since 5 Oct 2026: one asynchronous placeholder, then the stream's end. */
const imageJob = [
  event("v1", "delta_encoding"),
  event(
    {
      p: "",
      o: "add",
      v: {
        conversation_id: CHAT,
        message: assistant(
          20,
          { content_type: "thoughts", thoughts: [] },
          {
            status: "in_progress",
            metadata: { async_source: "synthetic-job" },
          },
        ),
      },
    },
    "delta",
  ),
  event({ type: "message_stream_complete", conversation_id: CHAT }),
  "data: [DONE]\n\n",
];

/**
 * A long reply: `pieces` more answer deltas, `perFrame` stream items to a socket frame, and
 * `padding` characters of envelope metadata on each item (the socket's own data, not output).
 */
type Long = { pieces: number; perFrame: number; padding: number };
const LONG_PIECE = " more";

async function send(delivery: Delivery, long?: Long) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
  });
  const win = new TestWindow((() =>
    Promise.resolve(
      new Response(body, {
        headers: { "content-type": "text/event-stream; charset=utf-8" },
      }),
    )) as typeof fetch);
  Object.assign(globalThis, {
    window: win,
    location: {
      origin: "https://chatgpt.com",
      hostname: "chatgpt.com",
      href: "https://chatgpt.com/",
      pathname: "/",
    },
  });
  installCapture();
  try {
    // The page created its socket before the send.
    const socket = new win.WebSocket("wss://ws.chatgpt.com/socket");
    let pageFrames = 0;
    socket.addEventListener("message", () => pageFrames++);
    const frame = async (data: unknown) => {
      socket.dispatchEvent(
        new MessageEvent("message", { data: JSON.stringify(data) }),
      );
      await tick();
    };
    const response = await win.fetch(
      "https://chatgpt.com/backend-api/f/conversation",
      {
        method: "POST",
        body: JSON.stringify({
          action: "next",
          messages: [
            {
              id: uid(10),
              author: { role: "user" },
              content: { content_type: "text", parts: ["Synthetic prompt"] },
            },
          ],
          parent_message_id: "client-created-root",
          model: "gpt-6-pro",
        }),
      },
    );
    const page = response.body!.getReader();
    const push = (text: string) =>
      controller.enqueue(new TextEncoder().encode(text));
    const pageRead = (async () => {
      try {
        for (;;) if ((await page.read()).done) return "ended";
      } catch (error: any) {
        return error?.name;
      }
    })();
    if (delivery === "body") {
      for (const text of reply) push(text);
      push("data: [DONE]\n\n");
      controller.close();
    } else if (
      delivery === "aborted-before-handoff" ||
      delivery === "image-job-aborted"
    ) {
      if (delivery === "image-job-aborted") for (const text of imageJob) push(text);
      else push(handoff[0]!);
      await tick();
      controller.error(
        new DOMException("BodyStreamBuffer was aborted", "AbortError"),
      );
    } else {
      for (const text of handoff) push(text);
      await tick();
      if (delivery === "handoff") controller.close();
      else
        controller.error(
          new DOMException("BodyStreamBuffer was aborted", "AbortError"),
        );
    }
    const pageOutcome = await pageRead;
    await tick();
    if (delivery === "handoff" || delivery === "handoff-aborted") {
      await frame([
        {
          id: 1,
          type: "reply",
          reply: { type: "subscribe", topic_id: TOPIC, recovered: false },
        },
      ]);
      let parent: string | null = null;
      if (long) {
        // The answer's last append is followed by the long reply's deltas, then its end.
        const items = [
          ...reply.slice(0, 8),
          ...Array.from({ length: long.pieces }, () =>
            event(
              { v: [{ p: "/message/content/parts/0", o: "append", v: LONG_PIECE }] },
              "delta",
            ),
          ),
          ...reply.slice(8),
        ];
        for (let start = 0; start < items.length; start += long.perFrame)
          await frame(
            items.slice(start, start + long.perFrame).map((text, offset) => {
              const index = start + offset;
              const id = uid(100 + index);
              const item = {
                type: "message",
                topic_id: TOPIC,
                payload: {
                  type: "conversation-turn-stream",
                  payload: {
                    conversation_id: CHAT,
                    turn_id: TURN,
                    type: "stream-item",
                    encoded_item: text,
                    stream_item_id: id,
                    parent_stream_item_id: parent,
                    server_timestamp_ms: 1792360140000 + index,
                  },
                  metadata: {},
                },
                metadata: { trace: "t".repeat(long.padding) },
                offset: `${index + 1}-0`,
              };
              parent = id;
              return item;
            }),
          );
      } else
      for (const [index, text] of reply.entries()) {
        const id = uid(100 + index);
        await frame(
          turnStream({
            type: "stream-item",
            encoded_item: text,
            stream_item_id: id,
            parent_stream_item_id: parent,
            server_timestamp_ms: 1792360140000 + index,
          }),
        );
        parent = id;
        if (index === 4)
          await frame(
            turnStream({ type: "heartbeat", server_timestamp_ms: 1792360140100 }),
          );
      }
      await frame(turnStream({ type: "done" }));
      await frame([
        {
          id: 2,
          type: "reply",
          reply: { type: "unsubscribe", topic_id: TOPIC },
        },
      ]);
      await frame(
        envelope(
          {
            type: "conversation-created",
            payload: { conversation_id: CHAT },
          },
          "conversations",
        ),
      );
      await frame(
        envelope(
          {
            type: "conversation-turn-complete",
            payload: { conversation_id: CHAT, current_message_id: uid(13) },
          },
          "conversations",
        ),
      );
    }
    const captures = win.messages.filter(
      (m) => m.channel === "ai-footprint-observation-v1",
    );
    return {
      pageOutcome,
      pageFrames,
      ends: captures.filter((m) => m.event === "end"),
      failures: win.messages.filter((m) => m.failure),
    };
  } finally {
    win.dispatchEvent(new Event("pagehide"));
  }
}

/** The fields a reply's record is made of; timing differs by transport, so it is left out. */
const record = (end: any) => {
  const { state, text, thinking, toolInput, intermediate, toolOutput } =
    end.snapshot;
  return {
    state,
    text,
    thinking,
    toolInput,
    intermediate,
    toolOutput,
    outputId: end.snapshot.outputId,
    attemptId: end.snapshot.attemptId,
    conversationId: end.snapshot.conversationId,
    model: end.snapshot.model,
    started: end.snapshot.started,
    limitations: end.snapshot.limitations,
    imageOperations: end.snapshot.imageOperations,
    searchOperations: end.snapshot.searchOperations,
  };
};

test("18 Oct 2026: a ChatGPT reply handed to the socket whose body the page aborts is captured from the socket like the old body", async () => {
  const old = await send("body");
  assert.equal(old.failures.length, 0);
  const expected = record(old.ends.at(-1));
  assert.equal(expected.state, "completed");
  assert.equal(expected.text, "Synthetic answer");
  assert.equal(expected.thinking, "Synthetic plan\nSynthetic step");
  assert.equal(expected.attemptId, uid(13));
  assert.equal(expected.model, "gpt-6-pro");
  assert.ok(!expected.limitations.includes("unknown_event_observed"));

  const live = await send("handoff-aborted");
  // The page's own read ends with its abort, unchanged by the capture.
  assert.equal(live.pageOutcome, "AbortError");
  assert.equal(live.failures.length, 0, JSON.stringify(live.failures));
  assert.ok(live.ends.length >= 1);
  assert.ok(live.ends.every((end) => end.failure === null));
  assert.deepEqual(record(live.ends.at(-1)), expected);
  // Every socket frame still reaches the page: the reply's items, the heartbeat, done, both
  // subscription replies and the two "conversations" messages.
  assert.equal(live.pageFrames, reply.length + 6);
});

// A long GPT-6 Pro reply on the socket (live, 20 Oct 2026): one stream item per delta, so a
// reply of about 6,200 output tokens passed LIMITS.items, and each item comes in its own
// envelope, so a long reply's socket data grows past the stream limit although the reply
// keeps far less. The live capture of that reply ended as buffer_overflow after 4 minutes.
test("20 Oct 2026: a long ChatGPT socket reply with more stream items than LIMITS.items is read whole", async () => {
  const pieces = 5000;
  const live = await send("handoff-aborted", { pieces, perFrame: 100, padding: 0 });
  assert.equal(
    live.failures.length,
    0,
    JSON.stringify(live.failures.map((m) => m.failure)),
  );
  const end = live.ends.at(-1);
  assert.equal(end.snapshot.state, "completed");
  assert.equal(end.snapshot.text, "Synthetic answer" + LONG_PIECE.repeat(pieces));
});

test("20 Oct 2026: a ChatGPT socket reply whose socket data passes the stream limit is read whole", async () => {
  const pieces = 400;
  const live = await send("handoff-aborted", { pieces, perFrame: 4, padding: 12_000 });
  assert.equal(
    live.failures.length,
    0,
    JSON.stringify(live.failures.map((m) => m.failure)),
  );
  const end = live.ends.at(-1);
  assert.equal(end.snapshot.state, "completed");
  assert.equal(end.snapshot.text, "Synthetic answer" + LONG_PIECE.repeat(pieces));
});

test("a ChatGPT reply handed to the socket whose body ends normally still ends the same (September 2026 path)", async () => {
  const expected = record((await send("body")).ends.at(-1));
  const handed = await send("handoff");
  assert.equal(handed.pageOutcome, "ended");
  assert.equal(handed.failures.length, 0);
  assert.deepEqual(record(handed.ends.at(-1)), expected);
});

test("a ChatGPT body aborted before it names a socket topic is still a failed read", async () => {
  const cut = await send("aborted-before-handoff");
  assert.equal(cut.pageOutcome, "AbortError");
  const [end] = cut.ends;
  assert.equal(end.failure, "capture_interrupted");
  assert.equal(end.snapshot.state, "interrupted_unconfirmed");
});

test("a ChatGPT image job whose finished body the page aborts still ends without a failure, named by its job", async () => {
  const job = await send("image-job-aborted");
  assert.equal(job.pageOutcome, "AbortError");
  assert.equal(job.failures.length, 0);
  const [end] = job.ends;
  assert.equal(end.failure, null);
  assert.equal(end.snapshot.state, "interrupted_unconfirmed");
  // Saved history gives the job's tool message this id, so the saved images join this reply.
  assert.equal(end.snapshot.attemptId, uid(20));
});
