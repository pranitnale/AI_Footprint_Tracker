import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Ledger } from "@footprint/ledger";
import { installCapture } from "../lib/capture-runtime";
import { Coordinator } from "../lib/coordinator";
import * as overview from "../lib/details-overview";
import { countByTextLength } from "./counting-fixture";

// Live, 19 Oct 2026 (test Chrome, build of 0a1754b2): in a NEW ChatGPT chat the person pressed
// Stop 1.8 to 3.9 s after sending, while the page still showed /c/local-chatgpt:<id>. The send
// (POST /backend-api/f/conversation, no conversation_id) had already been answered with the
// hand-over, which names the real chat (a uuid unlike the local id) and the socket topic. The
// Stop sent no POST /backend-api/stop_conversation at all: the page aborted the body before
// [DONE] and sent [{"id":n,"command":{"type":"unsubscribe","topic_id":<topic>}}] on the socket,
// which answered [{"id":n,"type":"reply","reply":{"type":"unsubscribe","topic_id":<topic>}}].
// The page stayed on the local address. The capture kept its dispatch state until the 60-minute
// limit and the bar showed "Waiting for your request". Leaving the running chat for a new one
// sent no unsubscribe and the reply went on; in a saved chat the Stop sends stop_conversation
// first and then the same unsubscribe. Structure only; synthetic ids and text.

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
const LOCAL = `/c/local-chatgpt%3A${uid(4)}`;
const event = (value: unknown, name?: string) =>
  `${name ? `event: ${name}\n` : ""}data: ${JSON.stringify(value)}\n\n`;
/** A new chat's body before the stop: the hand-over to the socket, without [DONE] yet. */
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
];
const turnStream = (item: object) => [
  {
    type: "message",
    topic_id: TOPIC,
    payload: {
      type: "conversation-turn-stream",
      payload: { conversation_id: CHAT, turn_id: TURN, ...item },
      metadata: {},
    },
    metadata: {},
    offset: "1-0",
  },
];
const unsubscribed = (topic: string) => [
  { id: 2, type: "reply", reply: { type: "unsubscribe", topic_id: topic } },
];

/**
 * The page side: a new chat sent from the start page moves to its local address, the body
 * hands the turn to the socket, the model thinks (heartbeats only), then the page ends it.
 * `route` is the address when the stop arrives; `topic` is the one the socket unsubscribes;
 * `turnEnded` sends the turn's end item first, as at a normal end.
 */
async function page(options: { route: string; topic: string; turnEnded?: boolean }) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
  });
  const stops: string[] = [];
  const win = new TestWindow((async (input: RequestInfo | URL) => {
    if (String(input).endsWith("/backend-api/stop_conversation")) {
      stops.push("stop");
      return new Response("{}");
    }
    return new Response(body, {
      headers: { "content-type": "text/event-stream; charset=utf-8" },
    });
  }) as typeof fetch);
  const saved = {
    window: (globalThis as any).window,
    location: (globalThis as any).location,
  };
  const location = {
    origin: "https://chatgpt.com",
    hostname: "chatgpt.com",
    href: "https://chatgpt.com/",
    pathname: "/",
  };
  const go = (path: string) => {
    location.pathname = path;
    location.href = `https://chatgpt.com${path}`;
  };
  Object.assign(globalThis, { window: win, location });
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
              content: { content_type: "text", parts: ["Synthetic new chat"] },
            },
          ],
          parent_message_id: "client-created-root",
          model: "gpt-6-pro",
        }),
      },
    );
    go(LOCAL);
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
    await frame([
      {
        id: 1,
        type: "reply",
        reply: { type: "subscribe", topic_id: TOPIC, recovered: false },
      },
    ]);
    await frame(turnStream({ type: "heartbeat", server_timestamp_ms: 1792360140100 }));
    if (options.turnEnded) await frame(turnStream({ type: "done" }));
    go(options.route);
    // The Stop: the page aborts the body before [DONE] and leaves the turn's socket topic.
    controller.error(
      new DOMException("BodyStreamBuffer was aborted", "AbortError"),
    );
    assert.equal(await pageRead, "AbortError");
    await frame(unsubscribed(options.topic));
    // Other chats keep the socket busy afterwards.
    await frame([{ id: 3, type: "reply", reply: { type: "ping" } }]);
    assert.equal(stops.length, 0, "no stop request on the local address");
  } finally {
    // Leaving the page ends a reply still running, as a reply not read to its end.
    win.dispatchEvent(new Event("pagehide"));
    Object.assign(globalThis, saved);
  }
  return win.messages.filter(
    (m) => m.channel === "ai-footprint-observation-v1" && m.event !== "health",
  );
}

/** The background side: the page's frames stored and published as the content script relays them. */
async function store(t: TestContext, frames: any[]) {
  const db = await Ledger.open(`chatgpt-local-stop-${crypto.randomUUID()}`);
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
    tab: { id: 42 },
    frameId: 0,
    documentId: `chatgpt-local-stop-${captureId}`,
    url: `https://chatgpt.com${LOCAL}`,
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

test("19 Oct 2026: a new ChatGPT chat stopped on its local address before ChatGPT named the page is cancelled with 0 output, and Details lists it as not estimated", async (t) => {
  const frames = await page({ route: LOCAL, topic: TOPIC });
  assert.ok(frames.every((m) => m.id === frames[0].id), "one capture");
  const ends = frames.filter((m) => m.event === "end");
  assert.equal(ends.length, 1, "the stop ends the capture once");
  const end = ends[0];
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
  assert.equal(summary.stoppedWithoutAnswer, 1);
  assert.equal(
    overview.stoppedRepliesStatus(summary.stoppedWithoutAnswer, "ChatGPT")?.chip,
    "Stopped reply not estimated",
  );
});

// Live, 20 Oct 2026 (test Chrome, build of d92082ab): in a new chat ChatGPT showed its Stop
// button (`button[aria-label="Stop"]`) 0.46 s after the send, before the send was answered.
// A trusted click on it made the page cancel the send at once (`cancelStream`, an
// AbortController.abort() without a reason), the send's fetch rejected with an AbortError
// 0.15 s after the click with no response, and nothing else was sent: no stop_conversation
// and, with no topic yet, no unsubscribe. The page was still at / and moved to its local
// address 1.5 s later. The capture had no topic and ended as a reply not read to its end
// (capture_interrupted), so the request was not counted as stopped. An abort without that
// click (the page leaving, a lost connection) is not a Stop.

/** A window that hands the test the capture's click listeners, so a click can be trusted. */
class ClickWindow extends TestWindow {
  clicks: ((event: any) => void)[] = [];
  override addEventListener(type: string, listener: any, options?: any) {
    if (type === "click" && typeof listener === "function") this.clicks.push(listener);
    super.addEventListener(type, listener, options);
  }
}
const stopButton = {
  closest: (selector: string) => (/aria-label="Stop"/.test(selector) ? stopButton : null),
};
const otherButton = { closest: () => null };

/**
 * A new chat's send that ChatGPT has not answered when the page cancels it. `click` is the
 * click before the cancel: a trusted click on Stop, an untrusted one, one on another control,
 * a Stop click before the send, or none. `sameTick` cancels before the capture read the send.
 */
async function cancelledSend(options: {
  click: "stop" | "untrusted" | "other" | "before-send" | null;
  sameTick?: boolean;
}) {
  const win = new ClickWindow(((_: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("signal is aborted without reason", "AbortError")),
      );
    })) as typeof fetch);
  const saved = {
    window: (globalThis as any).window,
    location: (globalThis as any).location,
  };
  const location = {
    origin: "https://chatgpt.com",
    hostname: "chatgpt.com",
    href: "https://chatgpt.com/",
    pathname: "/",
  };
  Object.assign(globalThis, { window: win, location });
  const click = (event: any) => win.clicks.forEach((listener) => listener(event));
  try {
    installCapture();
    if (options.click === "before-send") click({ isTrusted: true, target: stopButton });
    const controller = new AbortController();
    const send = win
      .fetch("https://chatgpt.com/backend-api/f/conversation", {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({
          action: "next",
          messages: [
            {
              id: uid(10),
              author: { role: "user" },
              content: { content_type: "text", parts: ["Synthetic new chat"] },
            },
          ],
          parent_message_id: "client-created-root",
          model: "gpt-6-pro",
        }),
      })
      .catch((error: any) => error?.name);
    if (!options.sameTick) await tick();
    if (options.click === "stop") click({ isTrusted: true, target: stopButton });
    if (options.click === "untrusted") click({ isTrusted: false, target: stopButton });
    if (options.click === "other") click({ isTrusted: true, target: otherButton });
    controller.abort();
    assert.equal(await send, "AbortError", "the page's own send ends as the page aborted it");
    await tick();
    await tick();
  } finally {
    win.dispatchEvent(new Event("pagehide"));
    Object.assign(globalThis, saved);
  }
  return win.messages.filter(
    (m) => m.channel === "ai-footprint-observation-v1" && m.event !== "health",
  );
}

test("20 Oct 2026: a new ChatGPT chat stopped before ChatGPT answered the send is counted as stopped with 0 output", async (t) => {
  for (const sameTick of [false, true]) {
    const frames = await cancelledSend({ click: "stop", sameTick });
    assert.ok(frames.length > 0, "the request is captured");
    assert.ok(frames.every((m) => m.id === frames[0].id), "one capture");
    assert.equal(frames[0].event, "dispatch");
    const ends = frames.filter((m) => m.event === "end");
    assert.equal(ends.length, 1, "the stop ends the capture once");
    const end = ends[0];
    assert.equal(end.failure, null, `sameTick ${sameTick}`);
    assert.equal(end.snapshot.state, "cancelled");
    assert.equal(end.snapshot.started, true);
    assert.equal(end.snapshot.text, "");

    const summary = await store(t, frames);
    assert.equal(summary.requests, 1);
    assert.equal(summary.outcomes.cancelled, 1);
    assert.equal(summary.outcomes.interrupted_unconfirmed, 0);
    assert.equal(summary.tokens.output.value, "0");
    assert.equal(summary.stoppedWithoutAnswer, 1);
    assert.equal(
      overview.stoppedRepliesStatus(summary.stoppedWithoutAnswer, "ChatGPT")?.chip,
      "Stopped reply not estimated",
    );
  }
});

test("a new ChatGPT send cancelled without a trusted click on Stop after it is not a Stop", async () => {
  for (const click of [null, "untrusted", "other", "before-send"] as const) {
    const frames = await cancelledSend({ click });
    const end = frames.find((m) => m.event === "end");
    assert.ok(end, String(click));
    assert.equal(end.failure, "capture_interrupted", String(click));
    assert.equal(end.snapshot.state, "interrupted_unconfirmed", String(click));
  }
});

test("on the local address, the socket leaving another topic does not end the new chat's reply", async () => {
  const frames = await page({
    route: LOCAL,
    topic: "conversation-turn-" + uid(5),
  });
  const end = frames.find((m) => m.event === "end");
  // Only leaving the page (pagehide in the harness) ends it, as a reply not read to its end.
  assert.ok(end);
  assert.equal(end.failure, "capture_interrupted");
  assert.equal(end.snapshot.state, "interrupted_unconfirmed");
});

test("on the local address, the socket leaving the topic after the turn's end item is no Stop", async () => {
  // The page leaves the topic after every turn's end too; a turn still waiting then (an async
  // job, images, or here a turn whose answer never arrived) must not read as stopped.
  const frames = await page({ route: LOCAL, topic: TOPIC, turnEnded: true });
  assert.ok(frames.every((m) => m.snapshot?.state !== "cancelled"));
  const end = frames.find((m) => m.event === "end");
  assert.ok(end);
  assert.equal(end.failure, "capture_interrupted");
});

test("in a saved chat the socket leaving the reply's topic alone does not end it: there a Stop is proven by stop_conversation", async () => {
  const frames = await page({ route: `/c/${CHAT}`, topic: TOPIC });
  const end = frames.find((m) => m.event === "end");
  assert.ok(end);
  assert.equal(end.failure, "capture_interrupted");
  assert.equal(end.snapshot.state, "interrupted_unconfirmed");
});
