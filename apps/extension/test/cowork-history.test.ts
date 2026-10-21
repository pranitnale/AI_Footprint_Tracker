import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Ledger, type Scope } from "@footprint/ledger";
import type { CountRequest } from "@footprint/tokenizers";
import { Coordinator } from "../lib/coordinator";
import {
  COWORK_FRAME_LIMIT,
  CoworkFrames,
  createCoworkHistory,
} from "../lib/cowork-history";
import { createRouteWatch } from "../lib/history-route";
import {
  validateHistoryCapture,
  validHistoryTextPage,
  type HistoryCaptureMessage,
} from "../lib/history-capture";
import { createHistoryTextObserver } from "../lib/passive-history-text";
import { transitionOwnership, type OwnershipHistory } from "../lib/ownership";
import { countByTextLength } from "./counting-fixture";
import { claudeTokenCount } from "@footprint/contracts";
import { PACKAGED_CLAUDE_TOKEN_FACTOR } from "../lib/claude-token-factor";

/** A sum of Cowork text counted here: each count times the Claude token factor, rounded on its own. */
const claudeSum = (...counts: number[]) =>
  String(
    counts.reduce(
      (sum, n) => sum + Number(claudeTokenCount(String(n), PACKAGED_CLAUDE_TOKEN_FACTOR)),
      0,
    ),
  );

// Synthetic Cowork traffic in the shape seen on 1 Oct 2026 (structure only).
const SESSION = "cse_0123456789ABCDEFghijklmn";
const OTHER = "cse_ZYXWVUTSRQPONMLKjihgfedc";
const ORIGIN = "https://claude.ai";
const SONNET = "claude-sonnet-5-5";
const HAIKU = "claude-haiku-4-5-20251001";
const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const listUrl = (session = SESSION) =>
  new URL(`${ORIGIN}/v1/code/sessions/${session}/events?limit=100`);
const streamUrl = (session = SESSION) =>
  new URL(
    `${ORIGIN}/v1/code/sessions/${session}/events/stream?from_sequence_num=1`,
  );
const envelope = (sequence: number, payload: unknown) => ({
  event_id: crypto.randomUUID(),
  sequence_num: String(sequence),
  event_type: "client_event",
  source: "server",
  payload,
  created_at: `2026-10-01T10:${String(Math.floor(sequence / 60) % 60).padStart(2, "0")}:${String(sequence % 60).padStart(2, "0")}.000Z`,
});
const init = (sequence: number) =>
  envelope(sequence, { type: "system", subtype: "init", model: SONNET });
const user = (sequence: number, text = `synthetic prompt ${sequence}`) =>
  envelope(sequence, {
    type: "user",
    uuid: id(sequence),
    parent_tool_use_id: null,
    message: { role: "user", content: [{ type: "text", text }] },
  });
const result = (
  sequence: number,
  prompt: number,
  sonnet: [number, number],
  haiku: number,
  apiMs: number,
) =>
  envelope(sequence, {
    type: "result",
    subtype: "success",
    uuid: id(sequence),
    user_message_uuids: [id(prompt)],
    duration_api_ms: apiMs,
    result: `synthetic answer ${sequence}`,
    modelUsage: {
      [SONNET]: {
        outputTokens: sonnet[0],
        thinkingTokens: sonnet[1],
        inputTokens: 5,
      },
      [HAIKU]: { outputTokens: haiku, inputTokens: 2 },
    },
  });
const toolResult = (sequence: number, text: string) =>
  envelope(sequence, {
    type: "user",
    uuid: id(sequence),
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: `toolu_${sequence}`,
          content: text,
        },
      ],
    },
  });
const list = (...events: unknown[]) =>
  JSON.stringify({ data: [...events].reverse(), resume_cursor: null });
const sse = (event: unknown, name = "client_event") =>
  `event: ${name}\ndata: ${JSON.stringify(event)}\n\n`;

function controlledStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      cancelled = true;
    },
  });
  const encoder = new TextEncoder();
  return {
    response: new Response(body),
    push: (text: string) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
    cancelled: () => cancelled,
  };
}
const at = (path: string) =>
  Object.assign(globalThis, {
    location: {
      origin: ORIGIN,
      hostname: "claude.ai",
      pathname: path,
      href: ORIGIN + path,
    },
  });
const natives = {
  cloneResponse: Response.prototype.clone,
  getReader: ReadableStream.prototype.getReader,
  read: ReadableStreamDefaultReader.prototype.read,
  cancel: ReadableStreamDefaultReader.prototype.cancel,
  cancelStream: ReadableStream.prototype.cancel,
} as any;
const until = async (check: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};
function reader(
  t: TestContext,
  spacingMs = 0,
  routeWaitMs = 300,
  listHoldMs?: number,
) {
  const sent: HistoryCaptureMessage[] = [];
  let sends = 0;
  const routes = createRouteWatch();
  const cowork = createCoworkHistory(
    (message) => sent.push(structuredClone(message)),
    natives,
    routes,
    () => sends++,
    { routeWaitMs, spacingMs, listHoldMs },
  );
  t.after(() => {
    cowork.cancel();
    routes.clear();
  });
  const pages = () =>
    sent.filter((m) => m.event === "page").map((m) => m.page!);
  return { cowork, sent, pages, sends: () => sends };
}

test("Cowork frames: CRLF, comments, multi-line data and split chunks", () => {
  const frames: string[] = [];
  const parser = new CoworkFrames((data) => frames.push(data));
  const wire =
    ': keep-alive\r\nevent: session_update\r\ndata: {"a":\r\ndata: 1}\r\n\r\n' +
    'id: 7\nevent: client_event\ndata:{"b":2}\n\n' +
    "data: tail without end";
  for (const char of wire) parser.push(char);
  assert.deepEqual(frames, ['{"a":\n1}', '{"b":2}']);
  assert.equal(parser.open, true);
  parser.push("\n\n");
  assert.deepEqual(frames.at(-1), "tail without end");
  assert.equal(parser.open, false);
});

test("Cowork frames: an event over the limit is skipped whole and reading goes on", () => {
  const frames: string[] = [];
  let skips = 0;
  const parser = new CoworkFrames(
    (data) => frames.push(data),
    () => skips++,
  );
  const big = "x".repeat(COWORK_FRAME_LIMIT / 2);
  // Over the limit across several data lines.
  parser.push(`data: ${big}\ndata: ${big}\ndata: ${big}\n\n`);
  // Over the limit in one line, delivered in pieces.
  parser.push("data: ");
  for (let i = 0; i < 3; i++) parser.push(big);
  parser.push("\n\ndata: kept\n\n");
  assert.deepEqual(frames, ["kept"]);
  assert.equal(parser.skipped, 2);
  assert.equal(skips, 2);
});

test("a Cowork list becomes one page of its results and the prompts they name", async (t) => {
  at(`/cowork/${SESSION}`);
  const r = reader(t);
  assert.equal(
    r.cowork.observe(
      listUrl(),
      "GET",
      Promise.resolve(
        new Response(
          list(
            init(1),
            user(2),
            result(3, 2, [200, 30], 10, 2924),
            user(4),
            result(5, 4, [433, 80], 10, 7261),
          ),
        ),
      ),
    ),
    true,
  );
  await until(() => r.pages().length === 1);
  const [page] = r.pages();
  assert.ok(
    r.sent.every((message) => validateHistoryCapture(message, "claude.ai")),
  );
  assert.deepEqual(
    page!.messages.map((m) => [m.role, m.sourceId, m.cumulative?.sequence]),
    [
      ["prompt", id(2), undefined],
      ["response", id(3), 3],
      ["prompt", id(4), undefined],
      ["response", id(5), 5],
    ],
  );
  // The list holds every event from the session's first, so it proves the first prompt
  // and the bar does not show Partially loaded (6 Oct 2026).
  assert.equal(page!.firstRequestVerified, true);
  assert.equal(page!.rootSourceId, id(2));
  assert.equal(page!.hasEarlier, false);
  assert.equal(validHistoryTextPage(page), true);
  // A proven Cowork page must start with its root: an earlier message means an earlier
  // request (Codex review, 6 Oct).
  const [rootPrompt, firstReply, ...rest] = page!.messages;
  assert.equal(
    validHistoryTextPage({
      ...page!,
      messages: [rest[0]!, rootPrompt!, firstReply!, ...rest.slice(1)],
    }),
    false,
  );
  assert.equal(r.sent[0]!.event, "start");
  assert.equal(r.sent[1]!.id, r.sent[0]!.id);
  // Other requests are not Cowork reads.
  assert.equal(
    r.cowork.observe(new URL(`${ORIGIN}/api/organizations`), "GET", null),
    false,
  );
});

test("an empty Cowork list still reports a page, so the bar knows the session loaded", async (t) => {
  at(`/cowork/${SESSION}`);
  for (const body of [
    list(init(1), user(2)),
    JSON.stringify({ data: [], resume_cursor: null }),
  ]) {
    const r = reader(t);
    r.cowork.observe(listUrl(), "GET", Promise.resolve(new Response(body)));
    await until(() => r.pages().length === 1);
    assert.equal(r.pages()[0]!.status, "partial", body.slice(0, 40));
    assert.deepEqual(r.pages()[0]!.messages, []);
    r.cowork.cancel();
  }
});

test("a Cowork list in an unknown format is reported, never silently empty", async (t) => {
  at(`/cowork/${SESSION}`);
  for (const body of [
    JSON.stringify({ data: [{ id: 1 }, { id: 2 }] }),
    // Valid JSON without the known list: nothing may pass as an empty session.
    "{}",
    JSON.stringify({ data: null }),
    JSON.stringify({ events: [user(2), result(3, 2, [5, 0], 0, 10)] }),
    JSON.stringify({ data: [], padding: "x".repeat(70000) }),
    '{"data": [',
    JSON.stringify({
      data: [
        envelope(3, {
          type: "result",
          uuid: id(3),
          modelUsage: { [SONNET]: { outputTokens: "many" } },
        }),
      ],
    }),
  ]) {
    const r = reader(t);
    r.cowork.observe(listUrl(), "GET", Promise.resolve(new Response(body)));
    await until(() => r.pages().length === 1);
    assert.equal(r.pages()[0]!.status, "unsupported", body.slice(0, 40));
    assert.deepEqual(r.pages()[0]!.messages, []);
    r.cowork.cancel();
  }
});

test("a failed page request is reported as unreadable history and never escapes into the page", async (t) => {
  at("/new");
  const r = reader(t, 0, 200);
  const unhandled: unknown[] = [];
  const record = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", record);
  t.after(() => process.off("unhandledRejection", record));
  r.cowork.observe(listUrl(), "GET", Promise.reject(new Error("offline")));
  await new Promise((resolve) => setTimeout(resolve, 50));
  at(`/cowork/${SESSION}`);
  await until(() => r.pages().length === 1);
  assert.equal(r.pages()[0]!.status, "unsupported");
  assert.deepEqual(unhandled, []);
});

test("a read that starts before the address bar shows the session waits for it, briefly", async (t) => {
  at("/new");
  const r = reader(t, 0, 300);
  r.cowork.observe(
    listUrl(),
    "GET",
    Promise.resolve(new Response(list(user(2), result(3, 2, [5, 0], 0, 10)))),
  );
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(r.sent.length, 0);
  at(`/cowork/${SESSION}`);
  await until(() => r.pages().length === 1);
  // A read for a session the page never shows emits nothing and frees its clone.
  const stream = controlledStream();
  r.cowork.observe(streamUrl(OTHER), "GET", Promise.resolve(stream.response));
  await new Promise((resolve) => setTimeout(resolve, 450));
  assert.equal(r.pages().length, 1);
});

test("a new task's stream that starts on /new is kept, and its pages wait for the session's address", async (t) => {
  at("/new");
  const r = reader(t, 0, 100);
  const stream = controlledStream();
  r.cowork.observe(streamUrl(), "GET", Promise.resolve(stream.response));
  await new Promise((resolve) => setTimeout(resolve, 200));
  stream.push(sse(user(2)) + sse(result(3, 2, [200, 30], 10, 2924)));
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(r.sent.length, 0);
  at(`/cowork/${SESSION}`);
  await until(() => r.pages().length === 1);
  assert.deepEqual(
    r.pages()[0]!.messages.map((m) => m.sourceId),
    [id(2), id(3)],
  );
  // A stream for a session while another conversation is shown is not read.
  at(`/chat/${id(99)}`);
  r.cowork.cancel(true);
  const other = controlledStream();
  r.cowork.observe(streamUrl(OTHER), "GET", Promise.resolve(other.response));
  await new Promise((resolve) => setTimeout(resolve, 200));
  other.push(sse(user(5)) + sse(result(6, 5, [10, 0], 0, 100)));
  at(`/cowork/${OTHER}`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(r.pages().length, 1);
  stream.close();
  other.close();
});

test("a stream that starts on the session's page reports a page at once, so no earlier history is claimed missing", async (t) => {
  at(`/cowork/${SESSION}`);
  const r = reader(t);
  const stream = controlledStream();
  r.cowork.observe(streamUrl(), "GET", Promise.resolve(stream.response));
  await until(() => r.pages().length === 1);
  assert.equal(r.pages()[0]!.status, "partial");
  assert.deepEqual(r.pages()[0]!.messages, []);
  stream.close();
});

test("live stream results become their own pages, spaced, and wait for a list read in progress", async (t) => {
  at(`/cowork/${SESSION}`);
  const r = reader(t, 150);
  const stream = controlledStream();
  let finishList!: (response: Response) => void;
  r.cowork.observe(
    listUrl(),
    "GET",
    new Promise<Response>((resolve) => (finishList = resolve)),
  );
  r.cowork.observe(streamUrl(), "GET", Promise.resolve(stream.response));
  // A stream result before the list finished is held for the list's page.
  stream.push(sse(user(6)));
  const frame = sse(result(7, 6, [500, 90], 25, 9000));
  stream.push(frame.slice(0, 40));
  stream.push(frame.slice(40));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(r.sent.length, 0);
  finishList(
    new Response(list(init(1), user(2), result(3, 2, [200, 30], 10, 2924))),
  );
  await until(() => r.pages().length === 1);
  assert.deepEqual(
    r.pages()[0]!.messages.map((m) => m.sourceId),
    [id(2), id(3), id(6), id(7)],
  );
  // Two quick results: the second waits for the spacing and both are reported once.
  stream.push(sse(user(8)) + sse(result(9, 8, [600, 90], 25, 9500)));
  await until(() => r.pages().length === 2);
  const second = Date.now();
  stream.push(sse(user(10)) + sse(result(11, 10, [700, 95], 25, 9900)));
  await until(() => r.pages().length === 3);
  assert.ok(Date.now() - second >= 100);
  assert.deepEqual(
    r
      .pages()
      .slice(1)
      .map((page) => page.messages.map((m) => m.sourceId)),
    [
      [id(8), id(9)],
      [id(10), id(11)],
    ],
  );
  // Keep-alive comments, other events and non-JSON data change nothing.
  stream.push(": ping\n\nevent: ephemeral_event\ndata: not json\n\n");
  stream.push(sse(envelope(12, { type: "stream_event", event: {} })));
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(r.pages().length, 3);
  stream.close();
});

test("a list read that stalls holds stream results only for a while", async (t) => {
  at(`/cowork/${SESSION}`);
  const r = reader(t, 0, 300, 200);
  r.cowork.observe(listUrl(), "GET", new Promise<Response>(() => {}));
  const stream = controlledStream();
  r.cowork.observe(streamUrl(), "GET", Promise.resolve(stream.response));
  stream.push(sse(user(6)) + sse(result(7, 6, [500, 90], 25, 9000)));
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(r.pages().length, 0);
  await until(() => r.pages().some((page) => page.messages.length > 0));
  assert.deepEqual(
    r.pages().flatMap((page) => page.messages.map((m) => m.sourceId)),
    [id(6), id(7)],
  );
  stream.close();
});

test("navigation stops a read still waiting for its session's address, except on a new task's page", async (t) => {
  // On a new task's page the read goes on, as the session's address comes next (G2).
  at("/new");
  const kept = reader(t, 0, 300);
  const first = controlledStream();
  kept.cowork.observe(streamUrl(), "GET", Promise.resolve(first.response));
  await new Promise((resolve) => setTimeout(resolve, 50));
  kept.cowork.cancel(true);
  at(`/cowork/${SESSION}`);
  await until(() => kept.pages().length === 1);
  first.close();
  // Leaving for another page stops it at once, and its copy of the stream is cancelled.
  at("/new");
  const left = reader(t, 0, 5000);
  const second = controlledStream();
  left.cowork.observe(
    streamUrl(OTHER),
    "GET",
    Promise.resolve(second.response),
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  at("/recents");
  left.cowork.cancel(true);
  void second.response.body!.cancel();
  await until(() => second.cancelled(), 1000);
  at(`/cowork/${OTHER}`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(left.pages().length, 0);
});

test("results of a session the page never shows are dropped once no read is left", async (t) => {
  at("/new");
  const r = reader(t, 0, 150);
  const stream = controlledStream();
  r.cowork.observe(streamUrl(), "GET", Promise.resolve(stream.response));
  await new Promise((resolve) => setTimeout(resolve, 200));
  stream.push(sse(user(2)) + sse(result(3, 2, [200, 30], 10, 2924)));
  await new Promise((resolve) => setTimeout(resolve, 50));
  stream.close();
  await new Promise((resolve) => setTimeout(resolve, 400));
  // The session was let go: showing it later reports nothing from the old stream.
  at(`/cowork/${SESSION}`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(r.pages().length, 0);
});

test("a read stopped before its response arrives cancels its copy when it does", async (t) => {
  at(`/cowork/${SESSION}`);
  const r = reader(t);
  let respond!: (response: Response) => void;
  r.cowork.observe(
    streamUrl(),
    "GET",
    new Promise<Response>((resolve) => (respond = resolve)),
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  r.cowork.cancel();
  const stream = controlledStream();
  respond(stream.response);
  await new Promise((resolve) => setTimeout(resolve, 20));
  // The page's own branch ends; the source stops only if the reader's copy was cancelled.
  void stream.response.body!.cancel();
  await until(() => stream.cancelled(), 1000);
  assert.equal(r.pages().length, 0);
});

test("a reconnected stream replaces the old one; navigation away stops the session's readers", async (t) => {
  at(`/cowork/${SESSION}`);
  const r = reader(t);
  // The source stops only when both the page's branch and the reader's clone stop, so
  // the page's own branch is dropped here and a cancelled source means the clone stopped.
  const opened = async () => {
    const stream = controlledStream();
    r.cowork.observe(streamUrl(), "GET", Promise.resolve(stream.response));
    await new Promise((resolve) => setTimeout(resolve, 20));
    void stream.response.body!.cancel();
    return stream;
  };
  const first = await opened();
  assert.equal(first.cancelled(), false);
  const second = await opened();
  await until(() => first.cancelled());
  assert.equal(second.cancelled(), false);
  // A navigation reset on the same session keeps it.
  r.cowork.cancel(true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(second.cancelled(), false);
  at("/new");
  r.cowork.cancel(true);
  await until(() => second.cancelled());
  // Only the streams' empty announcements were reported, never a result.
  assert.ok(r.pages().every((page) => page.messages.length === 0));
});

test("the page's own Cowork send is reported for the capture watchdog", (t) => {
  at(`/cowork/${SESSION}`);
  const r = reader(t);
  assert.equal(
    r.cowork.observe(
      new URL(`${ORIGIN}/v1/code/sessions/${SESSION}/events`),
      "POST",
      Promise.resolve(new Response("{}")),
    ),
    true,
  );
  assert.equal(r.sends(), 1);
  // Creating a session may carry its first message.
  assert.equal(
    r.cowork.observe(
      new URL(`${ORIGIN}/v1/code/sessions`),
      "POST",
      Promise.resolve(new Response("{}")),
    ),
    true,
  );
  assert.equal(r.sends(), 2);
  assert.equal(
    r.cowork.observe(new URL(`${ORIGIN}/v1/code/sessions`), "GET", null),
    false,
  );
  assert.equal(r.sent.length, 0);
});

async function imported(t: TestContext) {
  at(`/cowork/${SESSION}`);
  let calls = 0;
  const db = await Ledger.open(`cowork-${crypto.randomUUID()}`);
  const coordinator = new Coordinator(db, {
    count: async (job: CountRequest) => {
      calls++;
      return countByTextLength(job);
    },
    hasConsent: async () => true,
    hasSiteConsent: async () => true,
    sendDisplay: async () => {},
    transport: async () => {
      throw new Error("unexpected network");
    },
  });
  await coordinator.whenReady();
  const binding = {
    documentNonce: crypto.randomUUID(),
    navigationNonce: crypto.randomUUID(),
    captureId: null,
  };
  const sender = {
    tab: { id: 802 },
    frameId: 0,
    documentId: "synthetic-cowork-document",
    url: `${ORIGIN}/cowork/${SESSION}`,
  };
  const results: Array<Promise<unknown>> = [];
  let started: Promise<unknown> = Promise.resolve();
  const observer = createHistoryTextObserver((event) => {
    if (event.event === "start")
      started = coordinator.history.receive(event, binding, sender);
    else
      results.push(
        started.then(() => coordinator.history.receive(event, binding, sender)),
      );
  });
  t.after(() => {
    observer.cancel();
    coordinator.history.invalidate();
    coordinator.engines.dispose();
    db.close();
  });
  const scope = await coordinator.currentScope();
  const settle = async (count: number) => {
    await until(() => results.length >= count, 5000);
    const outcomes = await Promise.all(results);
    await coordinator.engines.maintainLocal();
    return outcomes;
  };
  const replies = async () =>
    (await db.all<any>("history_records"))
      .map((row) => row.record)
      .filter((record) => record.role === "response")
      .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  // The summary's known figures: prompt text, reply totals and other models' output.
  const tokens = async () => {
    const view = await coordinator.routeSummary("claude", SESSION, binding);
    return Object.fromEntries(
      view.history.local.tokens
        .filter((row: any) => row.value !== null)
        .map((row: any) => [
          `${row.role}:${row.part}:${row.evidence}`,
          row.value,
        ]),
    );
  };
  return {
    coordinator,
    db,
    scope,
    observer,
    settle,
    replies,
    tokens,
    // Whether the summary shows the session's first message as loaded.
    firstVerified: async () =>
      (await coordinator.routeSummary("claude", SESSION, binding)).history.local
        .first_request_verified,
    calls: () => calls,
  };
}

test("Cowork turns import with exact counts, side calls and timing, and a reopen adds only new turns", async (t) => {
  const f = await imported(t);
  f.observer.observe(
    listUrl(),
    "GET",
    Promise.resolve(
      new Response(
        list(
          init(1),
          user(2),
          result(3, 2, [200, 30], 10, 2924),
          user(4),
          result(5, 4, [433, 80], 10, 7261),
        ),
      ),
    ),
    Date.now(),
  );
  assert.deepEqual(await f.settle(1), [{ accepted: true }]);
  let replies = await f.replies();
  assert.deepEqual(
    replies.map((r) => [
      r.tokens.value,
      r.tokens.evidence,
      r.timing?.duration_seconds,
    ]),
    [
      ["200", "provider_reported", "2.924"],
      ["233", "provider_reported", "4.337"],
    ],
  );
  assert.equal(replies[0].parts.reported_reasoning.value, "30");
  assert.equal(replies[1].parts.reported_reasoning.value, "50");
  assert.equal(replies[0].timing.source, "cowork_history");
  assert.deepEqual(
    replies.map((r) =>
      r.generation.text_components.map((c: any) => [c.role, c.tokens.value]),
    ),
    [[["side_calls", "10"]], []],
  );
  // The session's model names the replies.
  assert.ok(replies.every((r) => r.model_id !== null));
  // The list began at the session's first event, so no Partially loaded (6 Oct).
  assert.equal(await f.firstVerified(), true);
  assert.deepEqual(await f.tokens(), {
    // Prompts are counted here, so their sum carries the Claude token factor; the replies'
    // totals are Claude's own and stay as reported.
    "prompt:total:heuristic_estimate": claudeSum(
      "synthetic prompt 2".length,
      "synthetic prompt 4".length,
    ),
    "response:total:provider_reported": "433",
    // Both turns were read whole and called no tools.
    "response:tool_output:heuristic_estimate": "0",
    "response:other_models:provider_reported": "10",
  });

  // Reopening the session reads the same list plus a new turn: only the new turn is added.
  const before = await f.db.all<any>("history_records");
  f.observer.observe(
    listUrl(),
    "GET",
    Promise.resolve(
      new Response(
        list(
          init(1),
          user(2),
          result(3, 2, [200, 30], 10, 2924),
          user(4),
          result(5, 4, [433, 80], 10, 7261),
          user(6),
          result(7, 6, [500, 90], 25, 9000),
        ),
      ),
    ),
    Date.now(),
  );
  await f.settle(2);
  replies = await f.replies();
  assert.deepEqual(
    replies.map((r) => r.tokens.value),
    ["200", "233", "67"],
  );
  const kept = new Map(before.map((row: any) => [row.key, row.hash]));
  for (const row of await f.db.all<any>("history_records"))
    if (kept.has(row.key)) assert.equal(row.hash, kept.get(row.key));
  assert.deepEqual(await f.tokens(), {
    "prompt:total:heuristic_estimate": claudeSum(
      ...Array(3).fill("synthetic prompt 2".length),
    ),
    "response:total:provider_reported": "500",
    "response:tool_output:heuristic_estimate": "0",
    "response:other_models:provider_reported": "25",
  });
  assert.equal((await f.db.all<any>("cowork_checkpoints")).length, 1);
  assert.equal(await f.firstVerified(), true);
});

/** A company enrolment with a new era and device, as after connecting or reconnecting. */
async function connectCompany(db: Ledger, namespace?: string): Promise<Scope> {
  namespace ??= `company:${crypto.randomUUID()}:${crypto.randomUUID()}`;
  const era = crypto.randomUUID();
  const scope: Scope = { namespace, mode: "company", era };
  const history = (await db.get<OwnershipHistory>(
    "policy",
    "ownership-history",
  ))!;
  await db.policyTransaction([
    {
      key: "credentials",
      namespace,
      origin: "https://company.example",
      company_id: namespace.split(":")[1],
      user_id: namespace.split(":")[2],
      device_id: crypto.randomUUID(),
      access_token: "synthetic-access",
      refresh_token: "synthetic-refresh",
      user_hmac_key: "b".repeat(64),
      access_expires_at: new Date(Date.now() + 600000).toISOString(),
      enrollment_era: { id: era, start: new Date().toISOString(), end: null },
      policy: {
        policy_version: "1.0.0",
        pause_mode: "user_controlled",
        deletion_epoch: 0,
        timezone: "UTC",
      },
    },
    transitionOwnership(history, {
      scope,
      secret: "b".repeat(64),
      policyVersion: "1.0.0",
    }) as any,
  ]);
  return scope;
}

test("after a reconnection a reopened Cowork session queues its counted turns again without counting them twice", async (t) => {
  const f = await imported(t);
  const first = await connectCompany(f.db);
  f.coordinator.history.invalidate();
  const body = () =>
    Promise.resolve(
      new Response(list(init(1), user(2), result(3, 2, [200, 30], 10, 2924))),
    );
  f.observer.observe(listUrl(), "GET", body(), Date.now());
  await f.settle(1);
  const queued = (await f.db.pendingHistory(first)).map((row) => row.record);
  assert.deepEqual(queued.map((record) => record.role).sort(), [
    "prompt",
    "response",
  ]);
  // A new enrolment with a new device: the earlier queue is not its own.
  const next = await connectCompany(f.db, first.namespace);
  f.coordinator.history.invalidate();
  assert.deepEqual(await f.db.pendingHistory(next), []);
  f.observer.observe(listUrl(), "GET", body(), Date.now());
  await f.settle(2);
  const requeued = (await f.db.pendingHistory(next)).map((row) => row.record);
  assert.deepEqual(requeued.map((record) => record.role).sort(), [
    "prompt",
    "response",
  ]);
  assert.deepEqual(
    requeued.find((record) => record.role === "response"),
    queued.find((record) => record.role === "response"),
  );
  assert.deepEqual(
    (await f.replies()).map((reply) => reply.tokens.value),
    ["200"],
  );
});

test("Cowork tool results count as input for turns read whole, and stay unknown otherwise", async (t) => {
  const f = await imported(t);
  f.observer.observe(
    listUrl(),
    "GET",
    Promise.resolve(
      new Response(
        list(
          // The first turn's prompt is outside the loaded events.
          toolResult(2, "x".repeat(40)),
          result(3, 1, [200, 30], 10, 2924),
          user(4),
          toolResult(5, "y".repeat(25)),
          toolResult(6, "z".repeat(5)),
          result(7, 4, [433, 80], 10, 7261),
        ),
      ),
    ),
    Date.now(),
  );
  await f.settle(1);
  const replies = await f.replies();
  assert.deepEqual(
    replies.map((r) => [
      r.parts.tool_output.value,
      r.parts.tool_output.evidence,
    ]),
    [
      [null, "unknown"],
      [String(25 + 1 + 5), "heuristic_estimate"],
    ],
  );
  // The stored part stays the tokenizer's 31; the total carries the Claude token factor.
  assert.equal(
    (await f.tokens())["response:tool_output:heuristic_estimate"],
    claudeSum(31),
  );
});

test("a first Cowork read of a long session groups the turns the page did not load into its first reply", async (t) => {
  const f = await imported(t);
  // Only the newest events are loaded; the session's counters still hold the older turns.
  f.observer.observe(
    listUrl(),
    "GET",
    Promise.resolve(
      new Response(list(user(40), result(41, 40, [9000, 1200], 300, 600000))),
    ),
    Date.now(),
  );
  await f.settle(1);
  const [reply] = await f.replies();
  assert.equal(reply.tokens.value, "9000");
  assert.equal(reply.generation.text_components[0].tokens.value, "300");
  assert.equal(reply.timing.duration_seconds, "600");
});

test("concurrent Cowork pages of one session never count a turn twice", async (t) => {
  const f = await imported(t);
  const history = f.coordinator.history as any;
  // The checkpoint read of the first page is held until the second page also started.
  const read = history.ledger.coworkCheckpoint.bind(history.ledger);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let reads = 0;
  history.ledger.coworkCheckpoint = async (...args: any[]) => {
    if (++reads === 1) await gate;
    return read(...args);
  };
  const stream = controlledStream();
  f.observer.observe(
    listUrl(),
    "GET",
    Promise.resolve(
      new Response(list(user(2), result(3, 2, [200, 30], 10, 2924))),
    ),
    Date.now(),
  );
  f.observer.observe(
    streamUrl(),
    "GET",
    Promise.resolve(stream.response),
    Date.now(),
  );
  await until(() => reads === 1);
  stream.push(sse(user(4)) + sse(result(5, 4, [433, 80], 10, 7261)));
  await new Promise((resolve) => setTimeout(resolve, 3000));
  release();
  await f.settle(2);
  assert.deepEqual(
    (await f.replies()).map((r) => r.tokens.value),
    ["200", "233"],
  );
  stream.close();
});

test("a checkpoint that moved during an import makes the turn count again from the saved one", async (t) => {
  const f = await imported(t);
  f.observer.observe(
    listUrl(),
    "GET",
    Promise.resolve(
      new Response(list(user(2), result(3, 2, [200, 30], 10, 2924))),
    ),
    Date.now(),
  );
  await f.settle(1);
  const history = f.coordinator.history as any;
  const read = history.ledger.coworkCheckpoint.bind(history.ledger);
  let stale = true;
  // The first read misses the saved checkpoint, as if another import had not finished.
  history.ledger.coworkCheckpoint = async (...args: any[]) => {
    if (stale) {
      stale = false;
      return null;
    }
    return read(...args);
  };
  f.observer.observe(
    listUrl(),
    "GET",
    Promise.resolve(
      new Response(
        list(
          user(2),
          result(3, 2, [200, 30], 10, 2924),
          user(4),
          result(5, 4, [433, 80], 10, 7261),
        ),
      ),
    ),
    Date.now(),
  );
  await f.settle(2);
  assert.equal(stale, false);
  assert.deepEqual(
    (await f.replies()).map((r) => r.tokens.value),
    ["200", "233"],
  );
});
