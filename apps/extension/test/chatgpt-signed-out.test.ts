import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Ledger } from "@footprint/ledger";
import { installCapture } from "../lib/capture-runtime";
import { Coordinator } from "../lib/coordinator";
import * as overview from "../lib/details-overview";
import { countByTextLength } from "./counting-fixture";

// Live, 20 Oct 2026 (a signed-out Chrome profile, never signed in): ChatGPT used without an
// account sends POST /unauth-mweb/conversation/updates with a form body (URLSearchParams) and
// streams the reply as one JSON object per line. The page moves from / to /uc/<chat> once the
// stream names the chat. Stop sends POST /unauth-mweb/stop_conversation with
// {"conversationId": <chat>}, answered 200 with {}, and the page then aborts the reply's body.
// Before this, no capture existed for the signed-out page and nothing was counted. Structure
// only; ids and text are synthetic.

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
const CHAT = "6ad70000-0000-83ea-8000-000000000001";
const USER = "00000000-0000-4000-8000-000000000010";
const ANSWER = "00000000-0000-4000-8000-000000000011";
const OPERATION = "00000000-0000-4000-8000-000000000012";
const SEND = `https://chatgpt.com/unauth-mweb/conversation/updates?lightweight_authenticated=1&operationId=${OPERATION}`;
const STOP = "https://chatgpt.com/unauth-mweb/stop_conversation?lightweight_authenticated=1";

const line = (value: unknown) => JSON.stringify(value) + "\n";
const control = (kind: string, extra: Record<string, unknown> = {}) => ({
  version: 1,
  type: "control",
  detail: { operationId: OPERATION, streamType: "initial", kind, ...extra },
});
const content = (
  revision: number,
  markdown: string,
  status = "streaming",
  extra: Record<string, unknown> = {},
) => ({
  version: 1,
  type: "content",
  messageId: ANSWER,
  revision,
  ...(revision === 1 ? { mode: "replace" } : { mode: "append", baseRevision: revision - 1 }),
  markdown,
  status,
  ...extra,
});
const opening = [
  control("started"),
  { version: 1, type: "shared", html: "<template></template>" },
  { ...control("conversation-id", { conversationId: CHAT, canonicalPath: `/uc/${CHAT}` }), stopConduitToken: "synthetic" },
  control("resume-token", { conversationId: CHAT, resumeToken: "synthetic" }),
  content(1, "Synthetic answer "),
  control("assistant-content-started", { messageId: ANSWER }),
  content(2, "in two pieces."),
];
const closing = [
  content(3, "", "complete"),
  { version: 1, type: "state", conversationState: JSON.stringify({ backendConversationId: CHAT, messages: [], parentMessageId: ANSWER, userMessageCount: 1 }), safety: {} },
  control("terminal-received", { conversationId: CHAT, messageId: ANSWER, terminalKind: "complete", transportOnly: true }),
  { version: 1, type: "end" },
];

/**
 * The page side: a new signed-out chat's first send, then the reply's lines. The ending is the
 * reply's own end, the person's Stop (its answer before or after the page aborts the body), or
 * a body cut off without a stop.
 */
async function page(
  ending: "complete" | "stop" | "abort-before-answer" | "cut" | "long",
  waitMs = 0,
  // Since 21 Oct 2026 every line has version 2 (html[data-conversation-stream-protocol="2"]);
  // the lines are otherwise the same as in version 1.
  version: 1 | 2 = 1,
) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
  });
  const stops: string[] = [];
  let answerStop!: () => void;
  const stopAnswered = new Promise<void>((resolve) => (answerStop = resolve));
  const win = new TestWindow((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === STOP) {
      stops.push(String(init?.body));
      if (ending === "abort-before-answer") await stopAnswered;
      return new Response("{}", { headers: { "content-type": "application/json; charset=utf-8" } });
    }
    return new Response(body, {
      headers: { "content-type": "application/vnd.openai.conversation-source+ndjson; charset=utf-8" },
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
  Object.assign(globalThis, { window: win, location });
  try {
    installCapture();
    const send = (lines: any[]) =>
      controller.enqueue(
        new TextEncoder().encode(lines.map((value) => line({ ...value, version })).join("")),
      );
    const response = await win.fetch(SEND, {
      method: "POST",
      // The page sends the form as URLSearchParams, not as text.
      body: new URLSearchParams({
        conversationState: JSON.stringify({
          messages: [],
          parentMessageId: "client-created-root",
          safety: { dismissedInterventionIds: [] },
          userMessageCount: 0,
        }),
        prompt: "Synthetic first prompt",
        imageAttachments: "[]",
        pendingImageUploads: "[]",
        workModel: "",
        assistantMessageId: "pending-00000000-0000-4000-8000-000000000013",
        userMessageId: USER,
        chatRequirementsToken: "synthetic",
      }),
    });
    const reader = response.body!.getReader();
    const pageRead = (async () => {
      try {
        for (;;) if ((await reader.read()).done) return "ended";
      } catch (error: any) {
        return error?.name;
      }
    })();
    send(opening);
    await tick();
    // The page moves to the chat's address once the stream named it.
    location.pathname = `/uc/${CHAT}`;
    location.href = `https://chatgpt.com/uc/${CHAT}`;
    const abort = () =>
      controller.error(new DOMException("BodyStreamBuffer was aborted", "AbortError"));
    if (ending === "long") {
      // Each append repeats the page's metadata of the whole answer so far (sources, approved
      // links, its rendering program and the text again), so the stream grows much faster than
      // the answer (live, 20 Oct 2026: 27 MB for about 48,000 characters, lines up to 557 KB).
      for (let index = 0; index < LONG_PIECES; index++) {
        const repeated = "r".repeat(
          Math.min(LONG_PIECE_METADATA * (index + 1), 1_300_000),
        );
        send([
          content(3 + index, LONG_PIECE, "streaming", {
            references: [{ title: repeated }],
            approvedUrls: [],
            dil: { kind: "dil", fallbackMarkdown: repeated.slice(0, 1000) },
          }),
        ]);
        await new Promise((resolve) => setImmediate(resolve));
      }
      send([content(3 + LONG_PIECES, "", "complete"), ...closing.slice(1)]);
      controller.close();
      assert.equal(await pageRead, "ended");
    } else if (ending === "complete") {
      send(closing);
      controller.close();
      assert.equal(await pageRead, "ended");
    } else if (ending === "stop") {
      const answer = await win.fetch(STOP, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: CHAT }),
      });
      assert.equal(answer.ok, true);
      await tick();
      abort();
      assert.equal(await pageRead, "AbortError");
    } else if (ending === "abort-before-answer") {
      const answer = win.fetch(STOP, {
        method: "POST",
        body: JSON.stringify({ conversationId: CHAT }),
      });
      await tick();
      abort();
      assert.equal(await pageRead, "AbortError");
      await tick();
      answerStop();
      assert.equal((await answer).ok, true);
    } else {
      abort();
      assert.equal(await pageRead, "AbortError");
    }
    await tick();
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    assert.equal(stops.length, ending === "stop" || ending === "abort-before-answer" ? 1 : 0);
    return win.messages.filter(
      (m) => m.channel === "ai-footprint-observation-v1" && m.event !== "health",
    );
  } finally {
    win.dispatchEvent(new Event("pagehide"));
    Object.assign(globalThis, saved);
  }
}

const LONG_PIECES = 40;
const LONG_PIECE = " Another synthetic sentence of the long answer.";
const LONG_PIECE_METADATA = 32_768;

/** The background side: the page's frames stored and published as the content script relays them. */
async function store(t: TestContext, frames: any[]) {
  const db = await Ledger.open(`chatgpt-signed-out-${crypto.randomUUID()}`);
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
    documentId: `chatgpt-signed-out-${captureId}`,
    url: `https://chatgpt.com/uc/${CHAT}`,
  };
  const binding = {
    documentNonce: crypto.randomUUID(),
    navigationNonce: crypto.randomUUID(),
    captureId,
  };
  for (const frame of frames) await c.capture(frame, sender, binding);
  const last = displays.filter((display) => display.summary).at(-1);
  assert.ok(last, "the reply was published");
  return last;
}

test("20 Oct 2026: a signed-out ChatGPT reply is captured from its JSON lines and counted in its chat", async (t) => {
  const frames = await page("complete");
  assert.ok(frames.length >= 2, "the send and its reply are captured");
  assert.ok(frames.every((m) => m.id === frames[0].id), "one capture");
  const dispatch = frames.find((m) => m.event === "dispatch");
  assert.ok(dispatch, "the send is a dispatch");
  assert.equal(dispatch.failure, null);
  assert.equal(dispatch.dispatch.input, "Synthetic first prompt");
  assert.equal(dispatch.dispatch.conversationId, null);
  assert.equal(dispatch.dispatch.parentId, "client-created-root");
  assert.equal(dispatch.dispatch.requestId, USER);
  const end = frames.find((m) => m.event === "end");
  assert.ok(end, "the reply ends");
  assert.equal(end.failure, null);
  assert.equal(end.snapshot.state, "completed");
  assert.equal(end.snapshot.text, "Synthetic answer in two pieces.");
  assert.equal(end.snapshot.conversationId, CHAT);
  assert.equal(end.snapshot.outputId, ANSWER);
  assert.equal(end.snapshot.model, null);
  assert.ok(end.timing, "a reply read to its terminal has its timing");

  const display = await store(t, frames);
  assert.deepEqual(display.conversationIdentity, { site: "chatgpt", conversationId: CHAT });
  assert.equal(display.summary.requests, 1);
  assert.equal(display.summary.outcomes.completed, 1);
  assert.notEqual(display.summary.tokens.output.value, "0");
  assert.notEqual(display.summary.tokens.output.value, null);
  // The site names no model, so the OpenAI stand-in estimates it rather than leaving it unknown.
  assert.notEqual(display.summary.metrics.energy.value, null);
});

test("20 Oct 2026: a long signed-out ChatGPT reply whose lines repeat the page's metadata is read whole past 8 MB", async (t) => {
  const frames = await page("long");
  const end = frames.find((m) => m.event === "end");
  assert.ok(end, "the reply ends");
  // Before the fix the stream passed LIMITS.stream (8 MB) and later one line passed
  // LIMITS.frame (1 MB), so the capture ended with buffer_overflow and kept only the answer
  // written until then (live: about 25,000 of 47,500 characters), and Details listed "Too many
  // updates at once" under Page tracking health.
  assert.equal(end.failure, null);
  assert.equal(end.snapshot.state, "completed");
  assert.equal(
    end.snapshot.text,
    "Synthetic answer in two pieces." + LONG_PIECE.repeat(LONG_PIECES),
  );
  assert.ok(end.timing, "a reply read to its terminal has its timing");
  const display = await store(t, frames);
  assert.equal(display.summary.requests, 1);
  assert.equal(display.summary.outcomes.completed, 1);
  assert.equal(display.summary.outcomes.interrupted_unconfirmed, 0);
});

test("a signed-out ChatGPT reply the person stops ends cancelled with what was written, not as a failure", async (t) => {
  const frames = await page("stop");
  const end = frames.find((m) => m.event === "end");
  assert.ok(end, "the stop ends the capture");
  assert.equal(end.failure, null);
  assert.equal(end.snapshot.state, "cancelled");
  assert.equal(end.snapshot.text, "Synthetic answer in two pieces.");
  const display = await store(t, frames);
  assert.equal(display.summary.requests, 1);
  assert.equal(display.summary.outcomes.cancelled, 1);
  assert.equal(display.summary.outcomes.interrupted_unconfirmed, 0);
  assert.equal(display.summary.stoppedWithoutAnswer, 0);
  assert.equal(overview.stoppedRepliesStatus(display.summary.stoppedWithoutAnswer, "ChatGPT"), null);
});

test("a signed-out ChatGPT stop whose answer comes after the page aborted the body still ends cancelled", async () => {
  const frames = await page("abort-before-answer");
  const end = frames.find((m) => m.event === "end");
  assert.ok(end, "the stop ends the capture");
  assert.equal(end.failure, null);
  assert.equal(end.snapshot.state, "cancelled");
});

test("a signed-out ChatGPT reply cut off without a stop is a reply not read to its end", async () => {
  // The failed read waits for a possible stop request (2 s), as on claude.ai.
  const frames = await page("cut", 2300);
  const end = frames.find((m) => m.event === "end");
  assert.ok(end, "the cut ends the capture");
  assert.equal(end.failure, "capture_interrupted");
  assert.equal(end.snapshot.state, "interrupted_unconfirmed");
});

// Live, 21 Oct 2026: signed-out ChatGPT switched its reply stream to version 2 overnight (same
// content type, html[data-conversation-stream-protocol="2"]). The reader refused every line
// that was not version 1, so every reply ended as "Reply not counted" (protocol_unsupported)
// and the bar showed "No figures yet".
test("21 Oct 2026: a version 2 signed-out ChatGPT reply is captured and counted in its chat", async (t) => {
  const frames = await page("complete", 0, 2);
  const end = frames.find((m) => m.event === "end");
  assert.ok(end, "the reply ends");
  assert.equal(end.failure, null);
  assert.equal(end.snapshot.state, "completed");
  assert.equal(end.snapshot.text, "Synthetic answer in two pieces.");
  assert.equal(end.snapshot.conversationId, CHAT);
  assert.ok(!end.snapshot.limitations.includes("unknown_event_observed"));
  const display = await store(t, frames);
  assert.deepEqual(display.conversationIdentity, { site: "chatgpt", conversationId: CHAT });
  assert.equal(display.summary.requests, 1);
  assert.equal(display.summary.outcomes.completed, 1);
  assert.equal(display.summary.outcomes.interrupted_unconfirmed, 0);
  assert.notEqual(display.summary.metrics.energy.value, null);
});

test("21 Oct 2026: a long version 2 signed-out ChatGPT reply is read whole past 8 MB", async (t) => {
  const frames = await page("long", 0, 2);
  const end = frames.find((m) => m.event === "end");
  assert.ok(end, "the reply ends");
  assert.equal(end.failure, null);
  assert.equal(end.snapshot.state, "completed");
  assert.equal(
    end.snapshot.text,
    "Synthetic answer in two pieces." + LONG_PIECE.repeat(LONG_PIECES),
  );
  const display = await store(t, frames);
  assert.equal(display.summary.outcomes.completed, 1);
});

test("21 Oct 2026: a version 2 signed-out ChatGPT reply the person stops ends cancelled with what was written", async (t) => {
  // The stop request was not seen with version 2; this is the version 1 stop. A stop the
  // tracker does not see ends like the cut below, as a reply not read to its end.
  const frames = await page("stop", 0, 2);
  const end = frames.find((m) => m.event === "end");
  assert.ok(end, "the stop ends the capture");
  assert.equal(end.failure, null);
  assert.equal(end.snapshot.state, "cancelled");
  assert.equal(end.snapshot.text, "Synthetic answer in two pieces.");
  const display = await store(t, frames);
  assert.equal(display.summary.outcomes.cancelled, 1);
  assert.equal(display.summary.outcomes.interrupted_unconfirmed, 0);
});

test("21 Oct 2026: a version 2 signed-out ChatGPT reply cut off without a stop is a reply not read to its end", async () => {
  const frames = await page("cut", 2300, 2);
  const end = frames.find((m) => m.event === "end");
  assert.ok(end, "the cut ends the capture");
  assert.equal(end.failure, "capture_interrupted");
  assert.equal(end.snapshot.state, "interrupted_unconfirmed");
});
