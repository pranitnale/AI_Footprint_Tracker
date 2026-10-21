import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  createProviderAdapterRegistry,
  initialSnapshot,
  type ProviderAdapter,
} from "@footprint/adapters";
import { CAPTURE_TIMES, CaptureError, LIMITS } from "@footprint/capture-core";
import { INTERRUPTED_AFTER_MS } from "@footprint/ledger";
import { installCapture } from "../lib/capture-runtime";
import { CAPTURE_SILENT_MS } from "../lib/bridge";

// W10: a live capture ends when its data stops, not at a fixed age; finished replies free
// their slots; an end frame reaches the ledger even when the reply cannot be read again.
// Time is a fake clock: setInterval and Date move only when a test ticks them.

const T0 = Date.parse("2026-10-04T10:00:00.000Z");
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

class TestWindow extends EventTarget {
  messages: any[] = [];
  WebSocket: any = class extends EventTarget {};
  constructor(public fetch: typeof globalThis.fetch) {
    super();
  }
  postMessage(value: any) {
    this.messages.push(value);
  }
}
function install(
  t: TestContext,
  fetcher: typeof fetch,
  host: "claude.ai" | "chatgpt.com",
  registry?: Parameters<typeof installCapture>[0],
) {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: T0 });
  const win = new TestWindow(fetcher);
  Object.assign(globalThis, {
    window: win,
    location: {
      origin: `https://${host}`,
      hostname: host,
      href: `https://${host}/`,
      pathname: "/",
    },
  });
  installCapture(registry);
  t.after(() => win.dispatchEvent(new Event("pagehide")));
  return {
    win,
    ends: () => win.messages.filter((m) => m.event === "end"),
    failures: () => win.messages.filter((m) => m.failure),
  };
}
/** A Claude reply whose stream the test writes. */
function claude(t: TestContext) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
  });
  const env = install(
    t,
    (() => Promise.resolve(new Response(stream))) as typeof fetch,
    "claude.ai",
  );
  const push = (text: string) =>
    controller.enqueue(new TextEncoder().encode(text));
  const frame = (value: unknown) => push(`data: ${JSON.stringify(value)}\n\n`);
  return {
    ...env,
    async send() {
      void env.win.fetch(
        "https://claude.ai/api/organizations/o/chat_conversations/c/completion",
        { method: "POST", body: JSON.stringify({ prompt: "safe" }) },
      );
      await tick();
      frame({ type: "message_start", message: { id: "a" } });
      frame({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "Partial" },
      });
      await tick();
    },
    push,
    frame,
    close: () => controller.close(),
    fail: (error: unknown) => controller.error(error),
  };
}
/** Advances the fake clock in steps, writing a keep-alive comment after each. */
async function keepAlive(
  t: TestContext,
  env: { push(text: string): void },
  total: number,
  step = 200_000,
) {
  for (let elapsed = 0; elapsed < total; elapsed += step) {
    t.mock.timers.tick(step);
    env.push(": ping\n\n");
    await tick();
  }
}

test("W10 a reply that keeps receiving data runs past ten minutes and ends normally", async (t) => {
  const env = claude(t);
  await env.send();
  // Twenty minutes of keep-alive comments: the old fixed limit ended it at ten.
  await keepAlive(t, env, 1_200_000);
  assert.equal(env.ends().length, 0);
  env.frame({
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text: " and the rest" },
  });
  env.frame({ type: "message_delta", delta: { stop_reason: "end_turn" } });
  env.frame({ type: "message_stop" });
  env.close();
  await tick();
  await tick();
  const [end] = env.ends();
  assert.equal(end.failure, null);
  assert.equal(end.snapshot.state, "completed");
  assert.equal(end.snapshot.text, "Partial and the rest");
  assert.equal(env.failures().length, 0);
});

test("W10 a reply without data for the idle limit ends as interrupted with what was read", async (t) => {
  const env = claude(t);
  await env.send();
  t.mock.timers.tick(CAPTURE_TIMES.idleMs - CAPTURE_TIMES.sweepMs);
  await tick();
  assert.equal(env.ends().length, 0);
  t.mock.timers.tick(2 * CAPTURE_TIMES.sweepMs);
  await tick();
  const [end] = env.ends();
  assert.equal(end.failure, "capture_interrupted");
  assert.equal(end.snapshot.state, "interrupted_unconfirmed");
  assert.equal(end.snapshot.text, "Partial");
});

test("W10 a reply that keeps receiving data ends at the latest after an hour", async (t) => {
  const env = claude(t);
  await env.send();
  await keepAlive(t, env, CAPTURE_TIMES.totalMs);
  assert.equal(env.ends().length, 0);
  t.mock.timers.tick(2 * CAPTURE_TIMES.sweepMs);
  await tick();
  const [end] = env.ends();
  assert.equal(end.failure, "capture_interrupted");
  assert.equal(end.snapshot.text, "Partial");
});

/** ChatGPT sends whose replies continue on the tab's socket under their own topics. */
function chatgpt(t: TestContext) {
  const handoff = (conversation: string) =>
    `event: stream_handoff\ndata: ${JSON.stringify({
      type: "stream_handoff",
      conversation_id: conversation,
      turn_exchange_id: `turn-${conversation}`,
      options: [
        { type: "subscribe_ws_topic", topic_id: `topic-${conversation}` },
      ],
    })}\n\n`;
  const env = install(
    t,
    ((_input: unknown, init: any) =>
      Promise.resolve(
        new Response(handoff(JSON.parse(init.body).conversation_id)),
      )) as typeof fetch,
    "chatgpt.com",
  );
  const socket = new env.win.WebSocket("wss://ws.chatgpt.com/socket");
  let item = 0;
  const frame = async (data: unknown) => {
    socket.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(data) }),
    );
    await tick();
  };
  return {
    ...env,
    async send(conversation: string) {
      const response = await env.win.fetch(
        "https://chatgpt.com/backend-api/f/conversation",
        {
          method: "POST",
          body: JSON.stringify({
            action: "next",
            conversation_id: conversation,
            parent_message_id: `parent-${conversation}`,
            messages: [
              {
                id: `user-${conversation}`,
                author: { role: "user" },
                content: { content_type: "text", parts: ["Synthetic"] },
              },
            ],
          }),
        },
      );
      await response.text();
      await tick();
    },
    /** The finished answer, without the stream terminal that verifies it. */
    finished(conversation: string) {
      return frame({
        topic_id: `topic-${conversation}`,
        payload: {
          type: "conversation-turn-stream",
          payload: {
            type: "stream-item",
            stream_item_id: String(++item),
            encoded_item: `event: delta\ndata: ${JSON.stringify({
              p: "",
              o: "add",
              v: {
                conversation_id: conversation,
                message: {
                  id: `answer-${conversation}`,
                  author: { role: "assistant" },
                  channel: "final",
                  recipient: "all",
                  content: { content_type: "text", parts: ["Done"] },
                  status: "finished_successfully",
                  end_turn: true,
                },
              },
            })}\n\n`,
          },
        },
      });
    },
    asyncPending(conversation: string) {
      return frame({
        type: "conversation-update",
        payload: {
          conversation_id: conversation,
          update_type: "set-conversation-async-status",
          update_content: {
            conversation_async_status: 5,
            is_async_correction: false,
          },
        },
      });
    },
    dispatched: (conversation: string) =>
      env.win.messages.some(
        (m) =>
          m.event === "dispatch" && m.dispatch?.conversationId === conversation,
      ),
    overflow: () =>
      env.win.messages.filter(
        (m) => m.event === "health" && m.failure === "buffer_overflow",
      ).length,
  };
}

test("W10 replies already published as completed free their slots for a new send", async (t) => {
  const env = chatgpt(t);
  for (let i = 0; i < LIMITS.sessions; i++) await env.send(`conv-${i}`);
  // Each answer finished, but the socket never sent the turn's terminal.
  for (let i = 0; i < LIMITS.sessions; i++) await env.finished(`conv-${i}`);
  assert.equal(env.ends().length, LIMITS.sessions);
  await env.send("conv-next");
  assert.equal(env.dispatched("conv-next"), true);
  assert.equal(env.overflow(), 0);
  // Retiring a finished reply changes none of its records.
  assert.equal(env.ends().length, LIMITS.sessions);
  assert.equal(env.failures().length, 0);
});

test("W10 a finished reply whose stream terminal never comes retires without a tracking problem", async (t) => {
  const env = chatgpt(t);
  await env.send("conv-a");
  await env.finished("conv-a");
  assert.equal(env.ends().length, 1);
  assert.equal(env.ends()[0].snapshot.state, "completed");
  t.mock.timers.tick(700_000);
  await tick();
  assert.equal(env.ends().length, 1);
  assert.equal(env.failures().length, 0);
});

test("W10 a reply waiting on a provider job ends without a failure when the wait runs out", async (t) => {
  const env = chatgpt(t);
  await env.send("conv-a");
  await env.asyncPending("conv-a");
  // The answer alone does not end an asynchronous turn.
  await env.finished("conv-a");
  assert.equal(env.ends().length, 0);
  t.mock.timers.tick(CAPTURE_TIMES.idleMs + 2 * CAPTURE_TIMES.sweepMs);
  await tick();
  const [end] = env.ends();
  assert.equal(end.failure, null);
  assert.equal(end.snapshot.state, "interrupted_unconfirmed");
  assert.equal(end.snapshot.text, "Done");
  assert.equal(env.failures().length, 0);
});

/**
 * A ChatGPT send whose stream the page aborts after reading it to the end. Live shape of
 * 5 Oct 2026 for an image job: one assistant message, still in progress, then the stream's
 * completion; the page then polls the saved chat.
 */
async function abortedAfterCompletion(t: TestContext, asynchronous: boolean) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const env = install(
    t,
    (() =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(value) {
              controller = value;
            },
          }),
        ),
      )) as typeof fetch,
    "chatgpt.com",
  );
  void env.win.fetch("https://chatgpt.com/backend-api/f/conversation", {
    method: "POST",
    body: JSON.stringify({
      action: "next",
      conversation_id: "conv-a",
      parent_message_id: "parent-a",
      messages: [
        {
          id: "user-a",
          author: { role: "user" },
          content: { content_type: "text", parts: ["Synthetic"] },
        },
      ],
    }),
  });
  await tick();
  const push = (text: string) =>
    controller.enqueue(new TextEncoder().encode(text));
  push(
    `event: delta\ndata: ${JSON.stringify({
      p: "",
      o: "add",
      v: {
        conversation_id: "conv-a",
        message: {
          id: "job-a",
          author: { role: "assistant" },
          recipient: "all",
          content: { content_type: "thoughts", thoughts: [] },
          status: "in_progress",
          end_turn: false,
          metadata: asynchronous ? { async_source: "image-job" } : {},
        },
      },
    })}\n\n`,
  );
  push(
    `data: ${JSON.stringify({ type: "message_stream_complete", conversation_id: "conv-a" })}\n\n`,
  );
  push("data: [DONE]\n\n");
  await tick();
  controller.error(
    new DOMException("The user aborted a request.", "AbortError"),
  );
  await tick();
  return env.ends();
}

test("W10 a ChatGPT image job that runs apart from the stream ends without a failure when the page aborts the finished stream", async (t) => {
  const [end] = await abortedAfterCompletion(t, true);
  assert.equal(end.failure, null);
  assert.equal(end.snapshot.state, "interrupted_unconfirmed");
  // Saved history gives the job's tool message this id, so the saved images join this reply.
  assert.equal(end.snapshot.attemptId, "job-a");
});

test("W10 a ChatGPT stream cut while its reply runs, without a job, is a failed read", async (t) => {
  const [end] = await abortedAfterCompletion(t, false);
  assert.equal(end.failure, "capture_interrupted");
});

test("W10 an end whose snapshot cannot be read still reaches the ledger with the last one sent", async (t) => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
  });
  const adapter: ProviderAdapter = {
    site: "claude",
    responseFormat: "sse",
    generationRoute: (url, method) =>
      url.pathname === "/fixture/generate" && method === "POST",
    parseDispatch: () => ({
      site: "claude",
      action: "send",
      input: "fixture",
      conversationId: "00000000-0000-4000-8000-000000000042",
      parentId: null,
      requestId: null,
      model: null,
      attachments: 0,
      imageEditParentId: null,
    }),
    createSession: () => {
      let text = "";
      let broken = false;
      return {
        frame({ value }) {
          if (typeof value?.text === "string") text += value.text;
          if (value?.broken === true) broken = true;
        },
        snapshot() {
          if (broken) throw new CaptureError("unsupported_schema");
          return { ...initialSnapshot(), started: true, text };
        },
        stopped() {},
      };
    },
  };
  const env = install(
    t,
    (() => Promise.resolve(new Response(stream))) as typeof fetch,
    "claude.ai",
    createProviderAdapterRegistry([adapter]),
  );
  const push = (value: unknown) =>
    controller.enqueue(
      new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`),
    );
  void env.win.fetch("https://claude.ai/fixture/generate", {
    method: "POST",
    body: "fixture",
  });
  await tick();
  push({ text: "Kept" });
  await tick();
  // A progress frame sends the text read so far.
  t.mock.timers.tick(1000);
  push({ text: "" });
  await tick();
  assert.equal(env.win.messages.at(-1).snapshot.text, "Kept");
  push({ broken: true });
  controller.close();
  await tick();
  await tick();
  const [end] = env.ends();
  assert.ok(end, "an end frame is sent");
  assert.equal(end.failure, "unsupported_schema");
  assert.equal(end.snapshot.text, "Kept");
  assert.equal(end.snapshot.state, "interrupted_unconfirmed");
});

test("W10 review: socket messages of other chats keep a waiting reply alive without using up its stream limit", async (t) => {
  const env = chatgpt(t);
  await env.send("conv-a");
  const socket = new env.win.WebSocket("wss://ws.chatgpt.com/socket");
  // Five large items of another chat, minutes apart: more than the 8 MiB stream limit.
  for (let i = 0; i < 5; i++) {
    t.mock.timers.tick(120_000);
    socket.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          topic_id: "topic-other",
          payload: {
            type: "conversation-turn-stream",
            payload: {
              type: "stream-item",
              stream_item_id: String(i),
              encoded_item: "x".repeat(900_000),
            },
          },
        }),
      }),
    );
    await tick();
  }
  assert.equal(env.overflow(), 0);
  assert.equal(env.ends().length, 0);
  await env.finished("conv-a");
  const [end] = env.ends();
  assert.equal(end.failure, null);
  assert.equal(end.snapshot.text, "Done");
  assert.equal(env.failures().length, 0);
});

test("W10 review: a socket message that is not readable still keeps a waiting reply alive", async (t) => {
  const env = chatgpt(t);
  await env.send("conv-a");
  const socket = new env.win.WebSocket("wss://ws.chatgpt.com/socket");
  // Ten minutes of messages the reader cannot parse, one a minute.
  for (let i = 0; i < 10; i++) {
    t.mock.timers.tick(60_000);
    socket.dispatchEvent(new MessageEvent("message", { data: "keep-alive" }));
    await tick();
  }
  assert.equal(env.ends().length, 0);
  // Without any message the idle limit still ends it.
  t.mock.timers.tick(CAPTURE_TIMES.idleMs + 2 * CAPTURE_TIMES.sweepMs);
  await tick();
  const [end] = env.ends();
  assert.equal(end.failure, "capture_interrupted");
});

test("W10 review: leaving the page ends a reply that waits for a stop answer at once", async (t) => {
  const env = claude(t);
  await env.send();
  // The stream breaks; the capture waits briefly for a stop request before deciding.
  env.fail(new Error("synthetic network failure"));
  await tick();
  assert.equal(env.ends().length, 0);
  env.win.dispatchEvent(new Event("pagehide"));
  await tick();
  const [end] = env.ends();
  assert.equal(end.failure, "capture_interrupted");
  assert.equal(end.snapshot.state, "interrupted_unconfirmed");
  assert.equal(end.snapshot.text, "Partial");
});

test("W10 time limits agree: a live capture ends before recovery or the page treats it as gone", () => {
  // The worker never marks a running reply interrupted while its page still captures.
  assert.ok(
    INTERRUPTED_AFTER_MS > CAPTURE_TIMES.totalMs + CAPTURE_TIMES.sweepMs,
  );
  // The page keeps a capture's binding for longer than a capture can be silent.
  assert.ok(CAPTURE_SILENT_MS > CAPTURE_TIMES.idleMs + CAPTURE_TIMES.sweepMs);
  assert.ok(CAPTURE_TIMES.idleMs < CAPTURE_TIMES.totalMs);
  // The accepted values themselves (W10 design), so a change cannot pass by accident.
  assert.deepEqual(
    { ...CAPTURE_TIMES },
    { idleMs: 300_000, totalMs: 3_600_000, sweepMs: 30_000 },
  );
  assert.equal(LIMITS.sessions, 8);
  assert.equal(INTERRUPTED_AFTER_MS, 3_900_000);
});
