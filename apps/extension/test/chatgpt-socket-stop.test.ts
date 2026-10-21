import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Ledger } from "@footprint/ledger";
import { installCapture } from "../lib/capture-runtime";
import { Coordinator } from "../lib/coordinator";
import * as overview from "../lib/details-overview";
import { countByTextLength } from "./counting-fixture";

// Live, 19 Oct 2026 (test Chrome, build of 8ed91e61): in an existing ChatGPT chat the person
// sent a follow-up to GPT-6 Pro and pressed Stop while it was still thinking. The page sent
// POST /backend-api/f/conversation, which handed the turn to the socket and was aborted
// (18 Oct 2026 hand-over), then POST /backend-api/stop_conversation (answered 200). No
// message reached the socket before the stop. The reply was stored as
// interrupted_unconfirmed with unknown output instead of cancelled with 0 output, so Details
// never listed "Stopped reply not estimated". Structure only; synthetic ids and text.

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
/** The body of a follow-up since 18 Oct 2026: only the hand-over to the socket. */
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
const turnStream = (payload: object) => [
  {
    type: "message",
    topic_id: TOPIC,
    payload: {
      type: "conversation-turn-stream",
      payload: { conversation_id: CHAT, turn_id: TURN, ...payload },
      metadata: {},
    },
    metadata: {},
    offset: "1-0",
  },
];

/**
 * The page side: a follow-up handed to the socket, its body aborted, heartbeats only, then
 * the person's Stop, or a reload of the page while the reply still runs.
 */
async function page(ending: "stop" | "reload") {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
  });
  const stops: string[] = [];
  const win = new TestWindow((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/backend-api/stop_conversation")) {
      stops.push(String(init?.body));
      return new Response(JSON.stringify({ success: true }), {
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(body, {
      headers: { "content-type": "text/event-stream; charset=utf-8" },
    });
  }) as typeof fetch);
  const saved = {
    window: (globalThis as any).window,
    location: (globalThis as any).location,
  };
  Object.assign(globalThis, {
    window: win,
    location: {
      origin: "https://chatgpt.com",
      hostname: "chatgpt.com",
      href: `https://chatgpt.com/c/${CHAT}`,
      pathname: `/c/${CHAT}`,
    },
  });
  let left = false;
  try {
    installCapture();
    const socket = new win.WebSocket("wss://ws.chatgpt.com/socket");
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
              content: { content_type: "text", parts: ["Synthetic follow-up"] },
            },
          ],
          conversation_id: CHAT,
          parent_message_id: uid(9),
          model: "gpt-6-pro",
        }),
      },
    );
    const reader = response.body!.getReader();
    const pageRead = (async () => {
      try {
        for (;;) if ((await reader.read()).done) return "ended";
      } catch (error: any) {
        return error?.name;
      }
    })();
    for (const text of handoff) controller.enqueue(new TextEncoder().encode(text));
    await tick();
    controller.error(
      new DOMException("BodyStreamBuffer was aborted", "AbortError"),
    );
    assert.equal(await pageRead, "AbortError");
    await tick();
    await frame([
      {
        id: 1,
        type: "reply",
        reply: { type: "subscribe", topic_id: TOPIC, recovered: false },
      },
    ]);
    // The model thinks without showing anything: only heartbeats arrive.
    await frame(turnStream({ type: "heartbeat", server_timestamp_ms: 1792360140100 }));
    await frame(turnStream({ type: "heartbeat", server_timestamp_ms: 1792360141100 }));
    if (ending === "stop") {
      const answer = await win.fetch(
        "https://chatgpt.com/backend-api/stop_conversation",
        {
          method: "POST",
          body: JSON.stringify({ conversation_id: CHAT }),
        },
      );
      assert.equal(answer.ok, true);
      await tick();
      // The socket ends the turn after the stop.
      await frame(turnStream({ type: "done" }));
    } else {
      // A reload while the reply still runs: the page goes away without a stop.
      win.dispatchEvent(new Event("pagehide"));
      left = true;
      await tick();
    }
    assert.equal(stops.length, ending === "stop" ? 1 : 0);
    return win.messages.filter(
      (m) => m.channel === "ai-footprint-observation-v1" && m.event !== "health",
    );
  } finally {
    if (!left) win.dispatchEvent(new Event("pagehide"));
    Object.assign(globalThis, saved);
  }
}

/** The background side: the page's frames stored and published as the content script relays them. */
async function store(t: TestContext, frames: any[]) {
  const db = await Ledger.open(`chatgpt-socket-stop-${crypto.randomUUID()}`);
  const displays: any[] = [];
  const c = new Coordinator(db, {
    count: countByTextLength,
    hasConsent: async () => true,
    hasSiteConsent: async () => true,
    sendDisplay: async (_, display) => {
      displays.push(display);
    },
    transport: async () => {
      throw new Error("Personal capture must remain local");
    },
  });
  t.after(() => {
    c.history.invalidate();
    c.engines.dispose();
    db.close();
  });
  await c.whenReady();
  const captureId = frames[0].id;
  const sender = {
    tab: { id: 41 },
    frameId: 0,
    documentId: `chatgpt-socket-stop-${captureId}`,
    url: `https://chatgpt.com/c/${CHAT}`,
  };
  const binding = {
    documentNonce: crypto.randomUUID(),
    navigationNonce: crypto.randomUUID(),
    captureId,
  };
  for (const frame of frames) await c.capture(frame, sender, binding);
  const last = displays.filter((display) => display.summary).at(-1);
  assert.ok(last, "the reply was published");
  return last.summary;
}

test("19 Oct 2026: a ChatGPT reply on the socket that the person stops before any answer is cancelled with 0 output, and Details lists it as not estimated", async (t) => {
  const frames = await page("stop");
  assert.ok(frames.every((m) => m.id === frames[0].id), "one capture");
  const end = frames.find((m) => m.event === "end");
  assert.ok(end, "the stop ends the capture");
  assert.equal(end.failure, null);
  assert.equal(end.snapshot.state, "cancelled");
  assert.equal(end.snapshot.started, true);
  assert.equal(end.snapshot.text, "");
  assert.equal(end.snapshot.conversationId, CHAT);

  const summary = await store(t, frames);
  assert.equal(summary.requests, 1);
  assert.equal(summary.outcomes.cancelled, 1);
  assert.equal(summary.outcomes.interrupted_unconfirmed, 0);
  assert.equal(summary.tokens.output.value, "0");
  assert.equal(summary.metrics.energy.value, null);
  assert.equal(summary.stoppedWithoutAnswer, 1);
  assert.equal(
    overview.stoppedRepliesStatus(summary.stoppedWithoutAnswer, "ChatGPT")?.chip,
    "Stopped reply not estimated",
  );
});

test("a ChatGPT reply on the socket cut off without a stop (a reload) stays a reply not read to its end", async (t) => {
  const frames = await page("reload");
  const end = frames.find((m) => m.event === "end");
  assert.ok(end, "leaving the page ends the capture");
  assert.equal(end.failure, "capture_interrupted");
  assert.equal(end.snapshot.state, "interrupted_unconfirmed");
  assert.equal(end.snapshot.started, false);
  assert.equal(end.snapshot.text, null);

  const summary = await store(t, frames);
  assert.equal(summary.requests, 1);
  assert.equal(summary.outcomes.cancelled, 0);
  assert.equal(summary.outcomes.interrupted_unconfirmed, 1);
  assert.notEqual(summary.tokens.output.value, "0");
  assert.equal(summary.stoppedWithoutAnswer, 0);
});
