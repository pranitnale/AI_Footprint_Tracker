import { test } from "node:test";
import assert from "node:assert/strict";
import { installCapture } from "../lib/capture-runtime";
import { readFileSync } from "node:fs";
import { CaptureWatchdog, validateCaptureReady } from "../lib/capture-watchdog";
import { LIMITS } from "@footprint/capture-core";
import { gzipSync } from "node:zlib";
class TestWindow extends EventTarget {
  messages: any[] = [];
  fetch: typeof fetch;
  WebSocket: any;
  constructor(fetcher: typeof fetch) {
    super();
    this.fetch = fetcher;
    this.WebSocket = class extends EventTarget {};
  }
  postMessage(value: any) {
    this.messages.push(value);
  }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
function environment(fetcher: typeof fetch, timingObserver?: unknown) {
  const win = new TestWindow(fetcher);
  if (timingObserver)
    Object.assign(win, { PerformanceObserver: timingObserver });
  Object.assign(globalThis, {
    window: win,
    location: {
      origin: "https://claude.ai",
      hostname: "claude.ai",
      href: "https://claude.ai/new",
    },
  });
  installCapture();
  return win;
}
const endpoint =
  "https://claude.ai/api/organizations/o/chat_conversations/c/completion";
const body = JSON.stringify({ prompt: "safe", attachments: [], files: [] });

test("successive gzip Claude requests with deep tool schemas emit completed live captures without reload", async () => {
  const wire = [
    { type: "message_start", message: { id: "synthetic-answer" } },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "Synthetic reply" },
    },
    { type: "message_delta", delta: { stop_reason: "end_turn" } },
    { type: "message_stop" },
  ]
    .map((value) => `data: ${JSON.stringify(value)}\n\n`)
    .join("");
  const win = environment((() =>
    Promise.resolve(new Response(wire))) as typeof fetch);
  let schema: unknown = { type: "string" };
  for (let depth = 0; depth < 20; depth++) schema = { properties: schema };
  try {
    for (let index = 1; index <= 3; index++) {
      const prompt = `Synthetic prompt ${index}`;
      const compressed = new Uint8Array(
        gzipSync(
          JSON.stringify({
            prompt,
            tools: [schema],
            attachments: [],
            files: [],
            completion_request_id: `synthetic-request-${index}`,
          }),
        ),
      );
      const response = await win.fetch(endpoint, {
        method: "POST",
        body: compressed,
      });
      assert.equal(
        await response.text(),
        wire,
        "Host receives its unchanged response",
      );
      for (
        let attempt = 0;
        attempt < 100 &&
        win.messages.filter((m) => m.event === "end").length < index;
        attempt++
      )
        await tick();
      const ends = win.messages.filter((m) => m.event === "end");
      assert.equal(ends.length, index);
      assert.equal(ends.at(-1).snapshot.state, "completed");
      assert.equal(ends.at(-1).snapshot.text, "Synthetic reply");
      assert.equal(ends.at(-1).failure, null);
      assert.equal(
        win.messages.filter((m) => m.event === "dispatch").at(-1).dispatch
          .input,
        prompt,
      );
    }
    assert.equal(
      new Set(win.messages.filter((m) => m.event === "end").map((m) => m.id))
        .size,
      3,
    );
  } finally {
    win.dispatchEvent(new Event("pagehide"));
  }
});

test("a Claude reply whose thinking shows only a summary counts the summary without a tracking failure", async () => {
  const wire = [
    { type: "message_start", message: { id: "synthetic-answer" } },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "thinking", thinking: "", summaries: [] },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: {
        type: "thinking_summary_delta",
        summary: { summary: "SUMMARY_MARKER" },
      },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_cut_off_delta", cut_off: false },
    },
    { type: "content_block_stop", index: 0 },
    {
      type: "content_block_start",
      index: 1,
      content_block: { type: "text", text: "" },
    },
    {
      type: "content_block_delta",
      index: 1,
      delta: { type: "text_delta", text: "Synthetic reply" },
    },
    { type: "content_block_stop", index: 1 },
    { type: "message_delta", delta: { stop_reason: "end_turn" } },
    { type: "message_stop" },
  ]
    .map((value) => `data: ${JSON.stringify(value)}\n\n`)
    .join("");
  const win = environment((() =>
    Promise.resolve(new Response(wire))) as typeof fetch);
  try {
    const response = await win.fetch(endpoint, { method: "POST", body });
    assert.equal(await response.text(), wire);
    for (
      let attempt = 0;
      attempt < 100 && !win.messages.some((m) => m.event === "end");
      attempt++
    )
      await tick();
    const end = win.messages.find((m) => m.event === "end");
    assert.equal(end.failure, null);
    assert.equal(end.snapshot.state, "completed");
    assert.equal(end.snapshot.text, "Synthetic reply");
    // The summary is the reasoning the page shows, so it counts as visible thinking (A2).
    assert.equal(end.snapshot.thinking, "SUMMARY_MARKER");
    assert.ok(!win.messages.some((m) => m.event === "health" || m.failure));
  } finally {
    win.dispatchEvent(new Event("pagehide"));
  }
});

test("live timing uses monotonic terminal receipt and keeps successful Claude completion after transport abort", async (t) => {
  let clock = 1000;
  t.mock.method(performance, "now", () => clock);
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
  });
  const response = new Response(stream),
    original = Promise.resolve(response);
  const win = environment((() => original) as typeof fetch);
  const push = (value: unknown) =>
    controller.enqueue(
      new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`),
    );
  try {
    const result = win.fetch(endpoint, { method: "POST", body });
    assert.equal(result, original);
    clock = 2000;
    push({ type: "message_start", message: { id: "a" } });
    push({
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "one" },
    });
    await tick();
    assert.ok(
      win.messages
        .filter((m) => m.channel === "ai-footprint-observation-v1")
        .every((m) => m.timing === null),
    );
    clock = 5250;
    push({ type: "message_delta", delta: { stop_reason: "end_turn" } });
    push({ type: "message_stop" });
    await tick();
    clock = 19000;
    controller.error(new DOMException("net::ERR_ABORTED", "AbortError"));
    await tick();
    const end = win.messages.find((m) => m.event === "end");
    assert.equal(end.snapshot.state, "completed");
    assert.equal(end.failure, null);
    assert.equal(end.timing.duration_seconds, "4.25");
    assert.ok(!win.messages.some((m) => m.event === "health"));
  } finally {
    win.dispatchEvent(new Event("pagehide"));
  }
});

test("an interrupted stream without provider completion never acquires usable live timing", async () => {
  const wire = 'data: {"type":"message_start","message":{"id":"a"}}\n\n';
  const win = environment((() =>
    Promise.resolve(new Response(wire))) as typeof fetch);
  try {
    await win.fetch(endpoint, { method: "POST", body });
    await tick();
    const end = win.messages.find((m) => m.event === "end");
    assert.equal(end.snapshot.state, "interrupted_unconfirmed");
    assert.equal(end.timing, null);
  } finally {
    win.dispatchEvent(new Event("pagehide"));
  }
});

for (const failure of ["malformed_frame", "buffer_overflow"] as const) {
  test(`post-terminal ${failure} remains visible without erasing completed Claude timing`, async (t) => {
    let clock = 1000;
    t.mock.method(performance, "now", () => clock);
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
        },
      }),
    );
    const original = Promise.resolve(response);
    const win = environment((() => original) as typeof fetch);
    const push = (wire: string) =>
      controller.enqueue(new TextEncoder().encode(wire));
    const terminal = [
      { type: "message_start", message: { id: "synthetic" } },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "synthetic" },
      },
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
      { type: "message_stop" },
    ]
      .map((value) => `data: ${JSON.stringify(value)}\n\n`)
      .join("");
    const corrupt =
      failure === "malformed_frame"
        ? "data: {broken}\n\n"
        : "data: " + "x".repeat(LIMITS.frame + 1);
    try {
      assert.equal(win.fetch(endpoint, { method: "POST", body }), original);
      clock = 4000;
      push(terminal);
      await tick();
      clock = 9000;
      push(corrupt);
      controller.close();
      assert.equal(await response.text(), terminal + corrupt);
      await tick();
      const end = win.messages.findLast((m) => m.event === "end");
      assert.equal(end.snapshot.state, "completed");
      assert.equal(end.timing.duration_seconds, "3");
      assert.equal(end.failure, failure);
      assert.equal(win.messages.filter((m) => m.failure === failure).length, 1);
    } finally {
      win.dispatchEvent(new Event("pagehide"));
    }
  });
}

for (const cleanup of ["pagehide", "permission", "timeout"] as const) {
  for (const completed of [false, true]) {
    test(`Claude ${cleanup} cleanup ${completed ? "preserves verified completion" : "reports an interrupted stream"}`, async (t) => {
      let clock = 1000;
      const wall = Date.now(),
        nativeSetInterval = setInterval;
      t.mock.method(performance, "now", () => clock);
      t.mock.method(Date, "now", () => wall + clock);
      let maintenance: (() => void) | undefined;
      t.mock.method(
        globalThis,
        "setInterval",
        (handler: () => void, timeout?: number) => {
          if (timeout === 30000) maintenance = handler;
          return nativeSetInterval(handler, timeout);
        },
      );
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      const response = new Response(
        new ReadableStream<Uint8Array>({
          start(value) {
            controller = value;
          },
        }),
      );
      const win = environment((() =>
        Promise.resolve(response)) as typeof fetch);
      const values: unknown[] = [
        { type: "message_start", message: { id: "synthetic" } },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "synthetic" },
        },
      ];
      if (completed)
        values.push(
          { type: "message_delta", delta: { stop_reason: "end_turn" } },
          { type: "message_stop" },
        );
      const wire = values
        .map((value) => `data: ${JSON.stringify(value)}\n\n`)
        .join("");
      try {
        assert.equal(
          await win.fetch(endpoint, { method: "POST", body }),
          response,
        );
        clock = 4000;
        controller.enqueue(new TextEncoder().encode(wire));
        await tick();
        if (cleanup === "pagehide") win.dispatchEvent(new Event("pagehide"));
        else if (cleanup === "permission") {
          const event = new Event("message");
          Object.assign(event, {
            source: win,
            origin: "https://claude.ai",
            data: { channel: "ai-footprint-control-v1", action: "stop" },
          });
          win.dispatchEvent(event);
        } else {
          clock = 601000;
          assert.ok(maintenance);
          maintenance();
        }
        await tick();
        const end = win.messages.findLast((m) => m.event === "end");
        assert.equal(
          end.snapshot.state,
          completed ? "completed" : "interrupted_unconfirmed",
        );
        assert.equal(
          end.timing?.duration_seconds ?? null,
          completed ? "3" : null,
        );
        assert.equal(end.failure, completed ? null : "capture_interrupted");
        assert.ok(!win.messages.some((m) => m.event === "health"));
        controller.close();
        assert.equal(
          await response.text(),
          wire,
          "measurement cleanup preserves host stream contents",
        );
      } finally {
        win.dispatchEvent(new Event("pagehide"));
      }
    });
  }
}

test("a failed ChatGPT completion cannot throw from failure cleanup or consume capture capacity", async () => {
  const final = (id: string, parts: unknown[] = ["synthetic"]) =>
    `data: ${JSON.stringify({
      message: {
        id,
        author: { role: "assistant" },
        channel: "final",
        end_turn: true,
        status: "finished_successfully",
        content: { content_type: "text", parts },
      },
    })}\n\n`;
  const terminal = 'data: {"type":"message_stream_complete"}\n\n';
  // An answer whose parts are not text fails the reply closed (D7).
  const ambiguous = final("one") + final("two", [{}]) + terminal;
  let wire = ambiguous;
  const win = new TestWindow((() =>
    Promise.resolve(new Response(wire))) as typeof fetch);
  Object.assign(globalThis, {
    window: win,
    location: {
      origin: "https://chatgpt.com",
      hostname: "chatgpt.com",
      href: "https://chatgpt.com/",
    },
  });
  installCapture();
  const init = {
    method: "POST",
    body: JSON.stringify({
      messages: [
        {
          id: "prompt",
          author: { role: "user" },
          content: { parts: ["synthetic"] },
        },
      ],
    }),
  };
  try {
    for (let i = 0; i < 4; i++) {
      const response = await win.fetch(
        "https://chatgpt.com/backend-api/conversation",
        init,
      );
      assert.equal(await response.text(), ambiguous);
      await tick();
    }
    wire = final("valid") + terminal;
    const response = await win.fetch(
      "https://chatgpt.com/backend-api/conversation",
      init,
    );
    assert.equal(await response.text(), wire);
    await tick();
    assert.ok(
      win.messages.some(
        (m) => m.event === "health" && m.failure === "unsupported_schema",
      ),
    );
    assert.ok(!win.messages.some((m) => m.failure === "buffer_overflow"));
    assert.ok(
      win.messages.some(
        (m) =>
          m.event === "end" &&
          m.snapshot?.outputId === "valid" &&
          m.snapshot.state === "completed",
      ),
    );
  } finally {
    win.dispatchEvent(new Event("pagehide"));
  }
});

test("ChatGPT handoff survives a delayed terminal and unrelated fetch, then invalidates resumed generation", async (t) => {
  let clock = 1000;
  const wall = Date.now();
  t.mock.method(performance, "now", () => clock);
  t.mock.method(Date, "now", () => wall + clock);
  const response = new Response(
    'event: stream_handoff\ndata: {"options":[{"type":"subscribe_ws_topic","topic_id":"topic"}]}\n\n',
  );
  const win = new TestWindow((() => Promise.resolve(response)) as typeof fetch);
  Object.assign(globalThis, {
    window: win,
    location: {
      origin: "https://chatgpt.com",
      hostname: "chatgpt.com",
      href: "https://chatgpt.com/",
    },
  });
  installCapture();
  const socket = new win.WebSocket("wss://ws.chatgpt.com/socket");
  const send = async (payload: unknown) => {
    socket.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          topic_id: "topic",
          payload: { type: "conversation-turn-stream", payload },
        }),
      }),
    );
    await tick();
  };
  let index = 0;
  const message = (state: "in_progress" | "finished_successfully") => ({
    type: "stream-item",
    stream_item_id: String(++index),
    encoded_item: `data: ${JSON.stringify({ message: { id: "a", author: { role: "assistant" }, channel: "final", content: { content_type: "text", parts: ["one"] }, status: state, end_turn: state === "finished_successfully" } })}\n\n`,
  });
  try {
    await win.fetch("https://chatgpt.com/backend-api/conversation", {
      method: "POST",
      body: JSON.stringify({
        messages: [
          { id: "p", author: { role: "user" }, content: { parts: ["safe"] } },
        ],
      }),
    });
    await tick();
    clock = 3000;
    await send(message("finished_successfully"));
    assert.equal(win.messages.at(-1).timing, null);
    const interimEnds = win.messages.filter((m) => m.event === "end").length;
    await send(message("finished_successfully"));
    assert.equal(
      win.messages.filter((m) => m.event === "end").length,
      interimEnds,
    );
    clock = 16000;
    await win.fetch("https://chatgpt.com/backend-api/accounts/check");
    clock = 17000;
    await send({ type: "conversation-turn-complete" });
    assert.equal(win.messages.at(-1).timing.duration_seconds, "16");
    clock = 18000;
    await send(message("in_progress"));
    assert.equal(win.messages.at(-1).timing, null);
    assert.equal(win.messages.at(-1).snapshot.state, "generating");
    clock = 20000;
    await send(message("finished_successfully"));
    clock = 21000;
    await send({ type: "conversation-turn-complete" });
    assert.equal(win.messages.at(-1).timing.duration_seconds, "20");
  } finally {
    win.dispatchEvent(new Event("pagehide"));
  }
});

for (const stopBeforeTerminal of [true, false]) {
  test(`Claude native stop response race preserves ${stopBeforeTerminal ? "cancellation" : "verified completion"}`, async (t) => {
    let clock = 1000;
    t.mock.method(performance, "now", () => clock);
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
        },
      }),
    );
    const win = environment(((url) =>
      Promise.resolve(
        String(url).endsWith("/stop_response") ? new Response("{}") : response,
      )) as typeof fetch);
    const push = (value: unknown) =>
      controller.enqueue(
        new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`),
      );
    try {
      assert.equal(
        await win.fetch(endpoint, { method: "POST", body }),
        response,
      );
      clock = 2000;
      push({ type: "message_start", message: { id: "synthetic" } });
      push({ type: "message_delta", delta: { stop_reason: "end_turn" } });
      await tick();
      if (stopBeforeTerminal) {
        await win.fetch(endpoint.replace(/\/completion$/, "/stop_response"), {
          method: "POST",
        });
        await tick();
      }
      clock = 4000;
      push({ type: "message_stop" });
      await tick();
      if (!stopBeforeTerminal) {
        clock = 9000;
        await win.fetch(endpoint.replace(/\/completion$/, "/stop_response"), {
          method: "POST",
        });
        await tick();
      }
      controller.error(new DOMException("net::ERR_ABORTED", "AbortError"));
      await tick();
      const end = win.messages.findLast((m) => m.event === "end");
      assert.equal(
        end.snapshot.state,
        stopBeforeTerminal ? "cancelled" : "completed",
      );
      assert.equal(
        end.timing?.duration_seconds ?? null,
        stopBeforeTerminal ? null : "3",
      );
      if (!stopBeforeTerminal) assert.equal(end.failure, null);
    } finally {
      win.dispatchEvent(new Event("pagehide"));
    }
  });
}

for (const stopRequest of [true, false]) {
  test(`a Claude stream aborted during thinking ${stopRequest ? "before the stop request ends as stopped" : "without a stop request is a capture problem"}`, async () => {
    // claude.ai aborts the reply stream when the user presses stop and can send the stop
    // request just after the abort (N11).
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
        },
      }),
    );
    const win = environment(((url) =>
      Promise.resolve(
        String(url).endsWith("/stop_response") ? new Response("{}") : response,
      )) as typeof fetch);
    const push = (value: unknown) =>
      controller.enqueue(
        new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`),
      );
    try {
      await win.fetch(endpoint, { method: "POST", body });
      push({ type: "message_start", message: { id: "synthetic" } });
      push({
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "" },
      });
      push({
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "Partial reasoning" },
      });
      await tick();
      controller.error(new DOMException("net::ERR_ABORTED", "AbortError"));
      await tick();
      assert.ok(!win.messages.some((m) => m.event === "end"));
      if (stopRequest) {
        await win.fetch(endpoint.replace(/\/completion$/, "/stop_response"), {
          method: "POST",
        });
        await tick();
      } else await new Promise((resolve) => setTimeout(resolve, 2100));
      const end = win.messages.find((m) => m.event === "end");
      assert.equal(
        end.snapshot.state,
        stopRequest ? "cancelled" : "interrupted_unconfirmed",
      );
      assert.equal(end.snapshot.thinking, "Partial reasoning");
      assert.equal(end.failure, stopRequest ? null : "capture_interrupted");
      assert.equal(win.messages.filter((m) => m.event === "end").length, 1);
    } finally {
      win.dispatchEvent(new Event("pagehide"));
    }
  });
}

test("N11 a stop the provider refuses leaves the failed read a capture problem", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    }),
  );
  const win = environment(((url) =>
    Promise.resolve(
      String(url).endsWith("/stop_response")
        ? new Response("{}", { status: 409 })
        : response,
    )) as typeof fetch);
  const push = (value: unknown) =>
    controller.enqueue(
      new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`),
    );
  try {
    await win.fetch(endpoint, { method: "POST", body });
    push({ type: "message_start", message: { id: "synthetic" } });
    push({
      type: "content_block_start",
      index: 0,
      content_block: { type: "thinking", thinking: "" },
    });
    await tick();
    controller.error(new DOMException("net::ERR_ABORTED", "AbortError"));
    await tick();
    await win.fetch(endpoint.replace(/\/completion$/, "/stop_response"), {
      method: "POST",
    });
    for (
      let attempt = 0;
      attempt < 100 && !win.messages.some((m) => m.event === "end");
      attempt++
    )
      await tick();
    const end = win.messages.find((m) => m.event === "end");
    assert.equal(end.snapshot.state, "interrupted_unconfirmed");
    assert.equal(end.failure, "capture_interrupted");
    assert.equal(win.messages.filter((m) => m.event === "end").length, 1);
  } finally {
    win.dispatchEvent(new Event("pagehide"));
  }
});

test("G3 an AI artifact run's JSON response is captured with its exact usage", async () => {
  const reply = JSON.stringify({
    id: "msg_synthetic",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    content: [{ type: "text", text: "Four" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 4098, output_tokens: 4 },
  });
  const response = new Response(reply, {
    headers: { "content-type": "application/json" },
  });
  const win = environment((() => Promise.resolve(response)) as typeof fetch);
  try {
    const result = await win.fetch(
      "https://claude.ai/api/organizations/o/proxy/v1/messages",
      {
        method: "POST",
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          messages: [{ role: "user", content: "Count to four" }],
        }),
      },
    );
    // The page still reads its own response.
    assert.equal(await result.text(), reply);
    for (
      let attempt = 0;
      attempt < 100 && !win.messages.some((m) => m.event === "end");
      attempt++
    )
      await tick();
    const dispatch = win.messages.find((m) => m.event === "dispatch");
    assert.equal(dispatch.dispatch.input, "Count to four");
    assert.equal(dispatch.dispatch.conversationId, null);
    const end = win.messages.find((m) => m.event === "end");
    assert.equal(end.failure, null);
    assert.equal(end.snapshot.state, "completed");
    assert.equal(end.snapshot.model, "claude-sonnet-4-6");
    assert.deepEqual(end.snapshot.usage, {
      output: 4,
      input: 4098,
      cacheRead: null,
      cacheWrite: null,
      reasoning: null,
    });
  } finally {
    win.dispatchEvent(new Event("pagehide"));
  }
});

test("G3 an artifact run whose request is too large to read keeps its exact usage", async () => {
  const reply = JSON.stringify({
    id: "msg_large",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    content: [{ type: "text", text: "Done" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 300000, output_tokens: 2 },
  });
  const win = environment((() =>
    Promise.resolve(
      new Response(reply, { headers: { "content-type": "application/json" } }),
    )) as typeof fetch);
  try {
    await win.fetch("https://claude.ai/api/organizations/o/proxy/v1/messages", {
      method: "POST",
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        messages: [{ role: "user", content: "x".repeat(1_048_577) }],
      }),
    });
    for (
      let attempt = 0;
      attempt < 100 && !win.messages.some((m) => m.event === "end");
      attempt++
    )
      await tick();
    const dispatch = win.messages.find((m) => m.event === "dispatch");
    assert.equal(dispatch.dispatch.input, null);
    assert.equal(dispatch.failure ?? null, null);
    const end = win.messages.find((m) => m.event === "end");
    assert.equal(end.failure, null);
    assert.equal(end.snapshot.usage.output, 2);
  } finally {
    win.dispatchEvent(new Event("pagehide"));
  }
});

test("Perplexity capture clears timing on status-only resumption and publishes the later terminal duration", async (t) => {
  let clock = 1000;
  const wall = Date.now();
  t.mock.method(performance, "now", () => clock);
  t.mock.method(Date, "now", () => wall + clock);
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    }),
  );
  const win = new TestWindow((() => Promise.resolve(response)) as typeof fetch);
  Object.assign(globalThis, {
    window: win,
    location: {
      origin: "https://www.perplexity.ai",
      hostname: "www.perplexity.ai",
      href: "https://www.perplexity.ai/",
    },
  });
  installCapture();
  const entry = JSON.parse(
    readFileSync(
      new URL(
        "../../../fixtures/history-observation-2026-09-14/perplexity-workflow-page.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ).entries[0];
  const terminal = {
    ...entry,
    final: true,
    final_sse_message: true,
    text_completed: true,
  };
  const push = (value: unknown) =>
    controller.enqueue(
      new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`),
    );
  const latest = () =>
    win.messages.findLast((m) => m.channel === "ai-footprint-observation-v1");
  try {
    assert.equal(
      await win.fetch("https://www.perplexity.ai/rest/sse/perplexity_ask", {
        method: "POST",
        body: JSON.stringify({
          query_str: "synthetic",
          params: { frontend_uuid: entry.frontend_uuid },
        }),
      }),
      response,
    );
    clock = 4000;
    push(terminal);
    await tick();
    assert.equal(latest().timing.duration_seconds, "3");
    clock = 5000;
    push({ status: "IN_PROGRESS" });
    await tick();
    assert.equal(latest().snapshot.state, "generating");
    assert.equal(latest().timing, null);
    clock = 9000;
    push(terminal);
    await tick();
    clock = 14000;
    controller.error(new DOMException("net::ERR_ABORTED", "AbortError"));
    await tick();
    assert.equal(latest().event, "end");
    assert.equal(latest().timing.duration_seconds, "8");
    assert.equal(latest().failure, null);
    assert.ok(!win.messages.some((m) => m.event === "health"));
  } finally {
    win.dispatchEvent(new Event("pagehide"));
  }
});
function readiness(win: TestWindow) {
  const event = new Event("message");
  Object.assign(event, {
    source: win,
    origin: "https://claude.ai",
    data: { channel: "ai-footprint-probe-v1", nonce: "a".repeat(36) },
  });
  win.dispatchEvent(event);
  return win.messages.at(-1);
}
test("A11 readiness handshake observes the installed hook and site revocation removes it", () => {
  const win = environment((() =>
    Promise.resolve(new Response("ok"))) as typeof fetch);
  const probe = () => {
    const event = new Event("message");
    Object.assign(event, {
      source: win,
      origin: "https://claude.ai",
      data: { channel: "ai-footprint-probe-v1", nonce: "a".repeat(36) },
    });
    win.dispatchEvent(event);
  };
  probe();
  assert.equal(win.messages.at(-1).channel, "ai-footprint-ready-v1");
  assert.equal(win.messages.at(-1).interception, "direct");
  const count = win.messages.length,
    event = new Event("message");
  Object.assign(event, {
    source: win,
    origin: "https://claude.ai",
    data: { channel: "ai-footprint-control-v1", action: "stop" },
  });
  win.dispatchEvent(event);
  probe();
  assert.equal(win.messages.length, count);
  win.dispatchEvent(new Event("pagehide"));
});
test("delegating outer fetch wrapper preserves one capture and unchanged host delivery while coverage remains unverified", async () => {
  const wire =
    'event: message_start\ndata: {"type":"message_start","message":{"id":"a"}}\n\nevent: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"one"}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n';
  const response = new Response(wire, {
      headers: { "Content-Type": "text/event-stream" },
    }),
    original = Promise.resolve(response);
  let calls = 0,
    seen: any[] = [];
  const native = function (this: unknown, ...args: any[]) {
    calls++;
    seen = [this, ...args];
    return original;
  } as typeof fetch;
  const win = environment(native),
    inner = win.fetch;
  const outer = function (this: Window, ...args: Parameters<typeof fetch>) {
    return Reflect.apply(inner, this, args);
  } as typeof fetch;
  win.fetch = outer;
  try {
    const ready = readiness(win);
    assert.equal(validateCaptureReady(ready, "a".repeat(36)), true);
    assert.equal(ready.interception, "unverified");
    assert.equal(calls, 0, "readiness never performs a fetch");
    const init = { method: "POST", body, headers: { "X-Test": "unchanged" } };
    const result = win.fetch(endpoint, init);
    assert.equal(result, original);
    assert.equal(await result, response);
    assert.equal(await (await result).text(), wire);
    await tick();
    assert.equal(calls, 1);
    assert.equal(seen[0], win);
    assert.equal(seen[1], endpoint);
    assert.equal(seen[2], init);
    assert.equal(win.messages.filter((m) => m.event === "dispatch").length, 1);
    assert.equal(win.messages.filter((m) => m.event === "end").length, 1);
    assert.equal(readiness(win).interception, "unverified");
    win.dispatchEvent(new Event("pagehide"));
    const shown = new Event("pageshow");
    Object.defineProperty(shown, "persisted", { value: true });
    win.dispatchEvent(shown);
    assert.equal(win.fetch, outer);
    assert.equal(readiness(win).interception, "unverified");
    assert.deepEqual(
      win.messages.filter((m) => m.event === "health").map((m) => m.failure),
      [],
    );
  } finally {
    win.dispatchEvent(new Event("pagehide"));
  }
});
class TimingObserver {
  static last: TimingObserver | null = null;
  constructor(
    public callback: (list: {
      getEntries(): { name: string; initiatorType: string }[];
    }) => void,
  ) {
    TimingObserver.last = this;
  }
  observe() {}
  finished(name: string) {
    this.callback({ getEntries: () => [{ name, initiatorType: "fetch" }] });
  }
}
test("an outer fetch wrapper is monitored through the browser's timing list and a request that skips the tracker is reported at once", async () => {
  const wire =
    'event: message_start\ndata: {"type":"message_start","message":{"id":"a"}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n';
  let calls = 0;
  const native = function () {
    calls++;
    return Promise.resolve(
      new Response(wire, { headers: { "Content-Type": "text/event-stream" } }),
    );
  } as typeof fetch;
  const win = environment(native, TimingObserver),
    timing = TimingObserver.last!,
    inner = win.fetch;
  win.fetch = function (this: Window, ...args: Parameters<typeof fetch>) {
    return Reflect.apply(inner, this, args);
  } as typeof fetch;
  try {
    assert.equal(readiness(win).interception, "monitored");
    await (await win.fetch(endpoint, { method: "POST", body })).text();
    await tick();
    timing.finished(endpoint);
    assert.equal(readiness(win).interception, "monitored");
    assert.equal(win.messages.filter((m) => m.event === "dispatch").length, 1);
    const before = win.messages.length;
    // A script that kept the browser's own fetch sends past the tracker.
    await native(endpoint, { method: "POST", body });
    timing.finished(endpoint);
    assert.equal(win.messages.length, before + 1, "reported without a probe");
    assert.deepEqual(win.messages.at(-1), {
      channel: "ai-footprint-ready-v1",
      nonce: "a".repeat(36),
      interception: "missed",
    });
    assert.equal(validateCaptureReady(win.messages.at(-1), "a".repeat(36)), true);
    assert.equal(readiness(win).interception, "missed");
    assert.equal(calls, 2, "the check never sends a request");
  } finally {
    win.dispatchEvent(new Event("pagehide"));
  }
});
test("a relative chat request under a <base> element is matched at the address fetch used", async () => {
  // A stand-in document whose base address differs from the page address (Codex review, 12 Oct).
  class StandInNode {
    get baseURI() {
      return "https://claude.ai/api/organizations/o/chat_conversations/c/";
    }
  }
  Object.assign(globalThis, { Node: StandInNode, document: new StandInNode() });
  const native = (() =>
    Promise.resolve(new Response("host result"))) as typeof fetch;
  const win = environment(native, TimingObserver),
    timing = TimingObserver.last!,
    inner = win.fetch;
  win.fetch = function (this: Window, ...args: Parameters<typeof fetch>) {
    return Reflect.apply(inner, this, args);
  } as typeof fetch;
  try {
    readiness(win);
    await win.fetch("completion", { method: "POST", body });
    timing.finished(endpoint);
    assert.equal(readiness(win).interception, "monitored");
  } finally {
    win.dispatchEvent(new Event("pagehide"));
    Reflect.deleteProperty(globalThis, "Node");
    Reflect.deleteProperty(globalThis, "document");
  }
});
test("the tracker's own fetch wrapper stays direct while the timing list agrees", async () => {
  const native = (() =>
    Promise.resolve(new Response("host result"))) as typeof fetch;
  const win = environment(native, TimingObserver),
    timing = TimingObserver.last!;
  try {
    assert.equal(readiness(win).interception, "direct");
    await win.fetch(endpoint, { method: "POST", body });
    timing.finished(endpoint);
    assert.equal(readiness(win).interception, "direct");
  } finally {
    win.dispatchEvent(new Event("pagehide"));
  }
});
test("watchdog: a missed request is one capture failure; a gap behind a monitored wrapper is a missing hook", () => {
  const missed = new CaptureWatchdog(0);
  missed.ready(1, "missed");
  assert.equal(missed.check(2, true), "capture_hook_missing");
  assert.equal(missed.check(3, true), null, "reported once");
  missed.ready(4, "missed");
  assert.equal(missed.check(5, true), null);
  const monitored = new CaptureWatchdog(0);
  monitored.ready(1, "monitored");
  assert.equal(monitored.check(2, true), null);
  monitored.sent(11000);
  monitored.activity(12000);
  assert.equal(monitored.check(26000, true), "capture_hook_missing");
  const direct = new CaptureWatchdog(0);
  direct.ready(1, "direct");
  direct.sent(11000);
  direct.activity(12000);
  assert.equal(direct.check(26000, true), "protocol_unsupported");
});
test("nondelegating replacement keeps an active listener visibly unverified and missed activity becomes a failure", async () => {
  let calls = 0;
  const native = (() => {
    calls++;
    return Promise.resolve(new Response("host result"));
  }) as typeof fetch;
  const win = environment(native);
  win.fetch = native;
  try {
    const ready = readiness(win),
      watchdog = new CaptureWatchdog(0);
    watchdog.ready(1, ready.interception);
    assert.equal(ready.interception, "unverified");
    assert.equal(calls, 0);
    assert.equal(watchdog.check(10001, true), null);
    watchdog.sent(11000);
    watchdog.activity(12000);
    assert.equal(
      await (await win.fetch(endpoint, { method: "POST", body })).text(),
      "host result",
    );
    await tick();
    assert.equal(win.messages.filter((m) => m.event === "dispatch").length, 0);
    assert.equal(watchdog.check(26000, true), "capture_hook_missing");
    watchdog.ready(27000, readiness(win).interception);
    assert.equal(watchdog.status(27000).activityGap, true);
    assert.equal(watchdog.status(27000).interception, "unverified");
    assert.equal(calls, 1);
  } finally {
    win.dispatchEvent(new Event("pagehide"));
  }
});
test("IM06 native fetch plus observed socket image lifecycle retains one edit and preserves host delivery", async () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL(
        "../../../fixtures/browser-audit-2026-09-10/chatgpt-image-structure.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const wire = `event: stream_handoff\ndata: ${JSON.stringify(fixture.edit.handoff)}\n\n`;
  const original = Promise.resolve(new Response(wire));
  const win = new TestWindow((() => original) as typeof fetch);
  Object.assign(globalThis, {
    window: win,
    location: {
      origin: "https://chatgpt.com",
      hostname: "chatgpt.com",
      href: "https://chatgpt.com/",
    },
  });
  installCapture();
  const socket = new win.WebSocket("wss://ws.chatgpt.com/socket");
  let hostFrames = 0;
  socket.addEventListener("message", () => hostFrames++);
  const result = win.fetch("https://chatgpt.com" + fixture.edit.path, {
    method: "POST",
    body: JSON.stringify(fixture.edit.request),
  });
  assert.equal(result, original);
  assert.equal(await (await result).text(), wire);
  await tick();
  const frame = async (data: any) => {
    socket.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(data) }),
    );
    await tick();
  };
  const status = (value: number) => ({
    type: "conversation-update",
    payload: {
      conversation_id: "conversation-fixture",
      update_type: "set-conversation-async-status",
      update_content: {
        conversation_async_status: value,
        is_async_correction: false,
      },
    },
    metadata: null,
  });
  await frame(status(5));
  await frame({
    topic_id: "topic-edit",
    payload: {
      type: "conversation-turn-stream",
      payload: { type: "conversation-turn-complete" },
    },
  });
  for (const update of fixture.edit.updates) await frame(update);
  assert.ok(
    !win.messages.some(
      (m) => m.event === "end" && m.snapshot?.state === "completed",
    ),
  );
  await frame(status(4));
  const final = win.messages.find(
    (m) => m.event === "end" && m.snapshot?.state === "completed",
  );
  assert.ok(final);
  assert.equal(final.snapshot.imageOperations.length, 1);
  assert.equal(final.snapshot.imageOperations[0].outputs.length, 1);
  assert.equal(final.snapshot.imageOperations[0].kind, "image_edit");
  assert.equal(hostFrames, fixture.edit.updates.length + 3);
  const count = win.messages.length;
  win.dispatchEvent(new Event("pagehide"));
  assert.equal(win.messages.length, count);
});
test("G7 an async ChatGPT turn ends with its own conversation's status while another chat's turn runs", async () => {
  const handoff = (conversation: string) =>
    `event: stream_handoff\ndata: ${JSON.stringify({
      type: "stream_handoff",
      conversation_id: conversation,
      turn_exchange_id: `turn-${conversation}`,
      options: [
        { type: "subscribe_ws_topic", topic_id: `topic-${conversation}` },
      ],
    })}\n\n`;
  const win = new TestWindow(((_input: unknown, init: any) =>
    Promise.resolve(
      new Response(handoff(JSON.parse(init.body).conversation_id)),
    )) as typeof fetch);
  Object.assign(globalThis, {
    window: win,
    location: {
      origin: "https://chatgpt.com",
      hostname: "chatgpt.com",
      href: "https://chatgpt.com/",
    },
  });
  installCapture();
  // Cleanup runs even when an assertion fails, so a failure never leaves timers running.
  try {
    const socket = new win.WebSocket("wss://ws.chatgpt.com/socket");
    const send = (conversation: string) =>
      win.fetch("https://chatgpt.com/backend-api/f/conversation", {
        method: "POST",
        body: JSON.stringify({
          action: "next",
          conversation_id: conversation,
          parent_message_id: `parent-${conversation}`,
          model: "gpt-6-astra-wm",
          messages: [
            {
              id: `user-${conversation}`,
              author: { role: "user" },
              content: { content_type: "text", parts: ["Synthetic Work task"] },
            },
          ],
        }),
      });
    await (await send("conv-a")).text();
    await (await send("conv-b")).text();
    await tick();
    const frame = async (data: any) => {
      socket.dispatchEvent(
        new MessageEvent("message", { data: JSON.stringify(data) }),
      );
      await tick();
    };
    const status = (conversation: string, value: number) => ({
      type: "conversation-update",
      payload: {
        conversation_id: conversation,
        update_type: "set-conversation-async-status",
        update_content: {
          conversation_async_status: value,
          is_async_correction: false,
        },
      },
    });
    await frame(status("conv-a", 5));
    await frame(status("conv-b", 5));
    await frame({
      topic_id: "topic-conv-a",
      payload: {
        type: "conversation-turn-stream",
        payload: {
          type: "stream-item",
          stream_item_id: "a-1",
          encoded_item: `event: delta\ndata: ${JSON.stringify({
            p: "",
            o: "add",
            v: {
              conversation_id: "conv-a",
              message: {
                id: "answer-a",
                author: { role: "assistant" },
                channel: "final",
                recipient: "all",
                content: { content_type: "text", parts: ["Done"] },
                status: "finished_successfully",
                end_turn: true,
                metadata: { model_slug: "gpt-6-astra-wm" },
              },
            },
          })}\n\n`,
        },
      },
    });
    const completed = (conversation: string) =>
      win.messages.some(
        (m) =>
          m.event === "end" &&
          m.snapshot?.state === "completed" &&
          m.snapshot.conversationId === conversation,
      );
    // The answer alone does not end an asynchronous turn.
    assert.equal(completed("conv-a"), false);
    await frame(status("conv-a", 4));
    assert.equal(completed("conv-a"), true);
    assert.equal(completed("conv-b"), false);
  } finally {
    win.dispatchEvent(new Event("pagehide"));
  }
});
test("G7 a read aloud of the same chat never holds back the turn's async terminal (G1)", async () => {
  const audio = new ReadableStream<Uint8Array>({ start() {} });
  const win = new TestWindow(((input: unknown) =>
    Promise.resolve(
      String(input).includes("/backend-api/synthesize")
        ? new Response(audio)
        : new Response(
            `event: stream_handoff\ndata: ${JSON.stringify({
              type: "stream_handoff",
              conversation_id: "conv-a",
              turn_exchange_id: "turn-conv-a",
              options: [
                { type: "subscribe_ws_topic", topic_id: "topic-conv-a" },
              ],
            })}\n\n`,
          ),
    )) as typeof fetch);
  Object.assign(globalThis, {
    window: win,
    location: {
      origin: "https://chatgpt.com",
      hostname: "chatgpt.com",
      href: "https://chatgpt.com/",
    },
  });
  installCapture();
  try {
    const socket = new win.WebSocket("wss://ws.chatgpt.com/socket");
    const sent = await win.fetch(
      "https://chatgpt.com/backend-api/f/conversation",
      {
        method: "POST",
        body: JSON.stringify({
          action: "next",
          conversation_id: "conv-a",
          parent_message_id: "parent-conv-a",
          messages: [
            {
              id: "user-conv-a",
              author: { role: "user" },
              content: { content_type: "text", parts: ["Draw a cat"] },
            },
          ],
        }),
      },
    );
    await sent.text();
    await tick();
    const frame = async (data: any) => {
      socket.dispatchEvent(
        new MessageEvent("message", { data: JSON.stringify(data) }),
      );
      await tick();
    };
    const status = (value: number) => ({
      type: "conversation-update",
      payload: {
        conversation_id: "conv-a",
        update_type: "set-conversation-async-status",
        update_content: {
          conversation_async_status: value,
          is_async_correction: false,
        },
      },
    });
    await frame(status(5));
    // The user reads an earlier answer aloud while the turn waits for its image.
    await win.fetch(
      "https://chatgpt.com/backend-api/synthesize?message_id=older&conversation_id=conv-a&voice=ember&format=aac",
    );
    await tick();
    await frame({
      topic_id: "topic-conv-a",
      payload: {
        type: "conversation-turn-stream",
        payload: {
          type: "stream-item",
          stream_item_id: "a-1",
          encoded_item: `event: delta\ndata: ${JSON.stringify({
            p: "",
            o: "add",
            v: {
              conversation_id: "conv-a",
              message: {
                id: "answer-a",
                author: { role: "assistant" },
                channel: "final",
                recipient: "all",
                content: { content_type: "text", parts: ["Here it is"] },
                status: "finished_successfully",
                end_turn: true,
              },
            },
          })}\n\n`,
        },
      },
    });
    const completed = () =>
      win.messages.some(
        (m) =>
          m.event === "end" &&
          m.snapshot?.state === "completed" &&
          m.snapshot.text === "Here it is",
      );
    // The answer alone does not end an asynchronous turn; its status does.
    assert.equal(completed(), false);
    await frame(status(4));
    assert.equal(completed(), true);
  } finally {
    win.dispatchEvent(new Event("pagehide"));
  }
});
test("H01 capture returns original promise and preserves untouched provider body", async () => {
  const wire =
    'event: message_start\ndata: {"type":"message_start","message":{"id":"a"}}\n\nevent: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"one"}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n';
  const response = new Response(wire, {
    headers: { "Content-Type": "text/event-stream" },
  });
  const original = Promise.resolve(response);
  let called: any;
  const native = ((...args: any[]) => {
    called = args;
    return original;
  }) as typeof fetch;
  const win = environment(native);
  const init = { method: "POST", body, headers: { "X-Test": "unchanged" } };
  const result = win.fetch(endpoint, init);
  assert.equal(result, original);
  assert.equal(called[1], init);
  assert.equal(await (await result).text(), wire);
  await tick();
  assert.ok(
    win.messages.some((m) => m.event === "end" && m.snapshot.text === "one"),
  );
  win.dispatchEvent(new Event("pagehide"));
  assert.equal(win.fetch, native);
});
test("H02 a dispatch over the slot limit does not clone and malformed input cancels measurement branch", async () => {
  let clones = 0,
    cancelled = 0;
  const responses: Response[] = [];
  const native = ((..._args: any[]) => {
    const original = new Response("host body");
    original.clone = () => {
      clones++;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(":keepalive\n\n"));
          },
          cancel() {
            cancelled++;
          },
        }),
      );
    };
    responses.push(original);
    return Promise.resolve(original);
  }) as typeof fetch;
  const win = environment(native);
  for (let i = 0; i <= LIMITS.sessions; i++)
    void win.fetch(endpoint, { method: "POST", body });
  await tick();
  assert.equal(clones, LIMITS.sessions);
  assert.ok(win.messages.some((m) => m.failure === "buffer_overflow"));
  win.dispatchEvent(new Event("pagehide"));
  await tick();
  assert.equal(cancelled, LIMITS.sessions);
  const win2 = environment(native);
  void win2.fetch(endpoint, { method: "POST", body: "malformed" });
  await tick();
  assert.equal(cancelled, LIMITS.sessions + 1);
  assert.equal(await responses.at(-1)!.text(), "host body");
  win2.dispatchEvent(new Event("pagehide"));
});
test("H03 bfcache return reinstalls only owned hooks", async () => {
  const native = (() => Promise.resolve(new Response(""))) as typeof fetch;
  const win = environment(native);
  const owned = win.fetch;
  win.dispatchEvent(new Event("pagehide"));
  assert.equal(win.fetch, native);
  const pageshow = new Event("pageshow");
  Object.defineProperty(pageshow, "persisted", { value: true });
  win.dispatchEvent(pageshow);
  assert.equal(win.fetch, owned);
  const other = (() => Promise.resolve(new Response("other"))) as typeof fetch;
  win.fetch = other;
  win.dispatchEvent(new Event("pagehide"));
  assert.equal(win.fetch, other);
});
