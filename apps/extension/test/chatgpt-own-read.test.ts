import { after, test as base } from "node:test";
import assert from "node:assert/strict";
import { parseHistoryText } from "@footprint/adapters";
import {
  CHATGPT_BATCH_PAUSE_MS,
  CHATGPT_PAGE_LIMIT,
  chatgptEarlierUrl,
  chatgptNewestUrl,
  chatgptOwnRead,
  chatgptPageInfo,
} from "../lib/chatgpt-own-read";
import { CHATGPT_DAY_PAGE_LIMIT } from "../lib/chatgpt-read-progress";
import { claudeOwnRead } from "../lib/claude-own-read";
import { historyReadKind, historyRequestConversation } from "../lib/history-route";
import { OWN_READ_CHANNEL } from "../lib/own-read";
import {
  OWN_READ_PAGE_SPACING_MS,
  OWN_READ_REQUESTS_PER_WINDOW,
  OWN_READ_TIMEOUT_MS,
  OWN_READ_WINDOW_MS,
} from "../lib/own-read-page";
import { channel, closePorts, json, pageWorld, recordingContext, tick } from "./own-read-fixture";

after(closePorts);

const test = (name: string, fn: () => unknown) =>
  base(name, { timeout: 20_000 }, fn as () => Promise<void>);

const CHAT = "00000000-0000-4000-8000-000000000701";
const OTHER = "00000000-0000-4000-8000-000000000702";
const ACCOUNT = "00000000-0000-4000-8000-0000000000dd";
const SYSTEM = "00000000-0000-4000-8000-0000000007ff";
// A synthetic stand-in for the session token; the test checks where it goes.
const TOKEN = "synthetic.session.token";
const SESSION_URL = "https://chatgpt.com/api/auth/session";
const NEWEST_URL = `https://chatgpt.com/backend-api/conversations/${CHAT}?num_turns=10&include_has_versions=true`;
const cursor = (page: number) =>
  `00000000-0000-4000-8000-${String(900 + page).padStart(12, "0")}`;
const earlierUrl = (page: number) =>
  `https://chatgpt.com/backend-api/conversations/${CHAT}/messages?before=${cursor(page)}&num_turns=10&include_has_versions=true`;
/** Page n's message time: newer pages have later times. */
const time = (page: number) => 2_000_000_000 - page * 100;

const session = () =>
  json(
    JSON.stringify({
      user: { id: "user-synthetic", email: "someone@example.com" },
      accessToken: TOKEN,
      account: { id: ACCOUNT, planType: "plus" },
      expires: "2026-11-14T00:00:00.000Z",
    }),
  );

/** One page of ten turns' messages: page 0 is the newest, each names the start of the next. */
function page(number: number, hasPrevious: boolean, conversationId = CHAT) {
  return JSON.stringify({
    ...(number === 0 ? { conversation_id: conversationId, current_node: cursor(0) } : {}),
    messages: [
      {
        id: cursor(number),
        author: { role: "user" },
        create_time: time(number),
        content: { parts: ["x"] },
      },
    ],
    page_info: {
      has_previous_page: hasPrevious,
      has_next_page: number !== 0,
      start_cursor: cursor(number),
      end_cursor: cursor(number),
    },
  });
}

/**
 * The chat's first page, as ChatGPT saves it since 12 Oct 2026: the first prompt, then the
 * hidden system message. Its read proves the chat's first request.
 */
function startPage(number: number) {
  return JSON.stringify({
    messages: [
      {
        id: cursor(number),
        author: { role: "user" },
        create_time: time(number),
        status: "finished_successfully",
        content: { content_type: "text", parts: ["synthetic first prompt"] },
        metadata: {},
      },
      {
        id: SYSTEM,
        author: { role: "system" },
        create_time: null,
        content: { content_type: "text", parts: [""] },
        metadata: { is_visually_hidden_from_conversation: true },
      },
    ],
    page_info: {
      has_previous_page: false,
      has_next_page: true,
      start_cursor: cursor(number),
      end_cursor: SYSTEM,
    },
  });
}

/** Answers by address: the session, then pages until `pages` were served. */
function chat(
  pages: number,
  overrides: Record<string, Response | Error> = {},
  options: { proving?: boolean } = {},
) {
  return (input: string) => {
    if (overrides[input]) return overrides[input]!;
    if (input === SESSION_URL) return session();
    if (input === NEWEST_URL) return json(page(0, pages > 1));
    for (let n = 0; n < pages; n++)
      if (input === earlierUrl(n))
        return json(
          options.proving && n + 2 === pages ? startPage(n + 1) : page(n + 1, n + 2 < pages),
        );
    return new Error(`unexpected ${input}`);
  };
}

function chatgptWorld(
  options: Parameters<typeof pageWorld>[3] & {
    delays?: number[];
    pauses?: number[];
    batches?: number[];
    /** The wait between two batches; none by default. */
    batchWait?: number;
  } = {},
) {
  const delays = options.delays ?? [];
  const pauses = options.pauses ?? [];
  const batches = options.batches ?? [];
  return pageWorld(
    chatgptOwnRead({
      origin: "https://chatgpt.com",
      pageDelay: () => {
        pauses.push(1);
        return delays.shift() ?? 0;
      },
      batchDelay: () => {
        batches.push(1);
        return options.batchWait ?? 0;
      },
    }),
    CHAT,
    `/c/${CHAT}`,
    options,
  );
}

const resume = (before: string | null, top: number | null, budget = CHATGPT_DAY_PAGE_LIMIT) => ({
  resume: { before, top, budget },
});

test("chatgpt own read: the pages are the page's own reads, and earlier pages are read kinds of their own", () => {
  assert.equal(chatgptNewestUrl("https://chatgpt.com", CHAT).href, NEWEST_URL);
  assert.equal(chatgptEarlierUrl("https://chatgpt.com", CHAT, cursor(0)).href, earlierUrl(0));
  assert.equal(historyRequestConversation("chatgpt", new URL(NEWEST_URL), "GET"), CHAT);
  assert.equal(historyRequestConversation("chatgpt", new URL(earlierUrl(0)), "GET"), CHAT);
  assert.equal(historyReadKind("chatgpt", new URL(earlierUrl(0))), `before:${cursor(0)}`);
  assert.equal(historyReadKind("chatgpt", new URL(NEWEST_URL)), "");
});

// Owner decision of 17 Oct 2026: earlier pages follow at a fixed 1 s, never a random wait, and
// still one at a time and in order.
test("chatgpt own read: earlier pages are read 1 s apart, in order, whatever Math.random returns", async () => {
  const random = Math.random;
  Math.random = () => 0.9999;
  try {
    const answers = chat(4);
    const run = recordingContext(CHAT, `/c/${CHAT}`, (url) => answers(url.href) as Response);
    assert.deepEqual(await chatgptOwnRead({ origin: "https://chatgpt.com" }).run(run.context), { kind: "read" });
    assert.equal(OWN_READ_PAGE_SPACING_MS, 1000);
    assert.deepEqual(run.pauses, [1000, 1000, 1000]);
    assert.deepEqual(run.urls, [SESSION_URL, NEWEST_URL, earlierUrl(0), earlierUrl(1), earlierUrl(2)]);
  } finally {
    Math.random = random;
  }
});

test("chatgpt own read: a page is read only when it is this chat's and says whether earlier turns exist", () => {
  assert.deepEqual(chatgptPageInfo(JSON.parse(page(0, true)), CHAT, false), {
    hasPrevious: true,
    cursor: cursor(0),
    earliest: time(0),
    latest: time(0),
  });
  assert.equal(chatgptPageInfo(JSON.parse(page(0, true, OTHER)), CHAT, false), null);
  assert.deepEqual(chatgptPageInfo(JSON.parse(page(3, false)), CHAT, true), {
    hasPrevious: false,
    cursor: cursor(3),
    earliest: time(3),
    latest: time(3),
  });
  // Messages without a time (the hidden system message) leave the page's times to the others.
  assert.deepEqual(chatgptPageInfo(JSON.parse(startPage(4)), CHAT, true), {
    hasPrevious: false,
    cursor: cursor(4),
    earliest: time(4),
    latest: time(4),
  });
  assert.equal(chatgptPageInfo({ messages: [], page_info: { has_previous_page: false } }, CHAT, true), null);
  assert.equal(chatgptPageInfo({ conversation_id: CHAT, messages: [{}] }, CHAT, false), null);
});

test("chatgpt own read page: the session token goes only into the chat requests, never to the history reader", async () => {
  const world = chatgptWorld({ responses: chat(1) });
  assert.deepEqual(await world.ask(), { kind: "read" });
  assert.deepEqual(world.fetches.map(({ input }) => input), [SESSION_URL, NEWEST_URL]);
  const [sessionRequest, newest] = world.fetches;
  assert.equal(sessionRequest!.init.method, "GET");
  assert.equal(sessionRequest!.init.credentials, "include");
  assert.equal(sessionRequest!.init.headers, undefined);
  assert.equal(newest!.init.method, "GET");
  assert.equal(newest!.init.credentials, "include");
  assert.deepEqual(newest!.init.headers, {
    authorization: `Bearer ${TOKEN}`,
    "chatgpt-account-id": ACCOUNT,
  });
  // Only the chat page reaches the history reader; the session answer and token do not.
  assert.equal(world.observed.length, 1);
  assert.equal(world.observed[0]!.url.href, NEWEST_URL);
  assert.equal(world.observed[0]!.body, undefined);
  assert.doesNotMatch(JSON.stringify(world.observed.map(({ url }) => url.href)), /synthetic\.session/);
});

test("chatgpt own read page: earlier pages follow one at a time with a pause, reporting progress", async () => {
  const world = chatgptWorld({ responses: chat(4), delays: [5, 5, 5] });
  const answer = world.ask();
  assert.deepEqual(await answer, { kind: "read" });
  assert.deepEqual(world.fetches.map(({ input }) => input), [
    SESSION_URL,
    NEWEST_URL,
    earlierUrl(0),
    earlierUrl(1),
    earlierUrl(2),
  ]);
  for (const { init } of world.fetches.slice(2))
    assert.equal((init.headers as Record<string, string>).authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(world.observed.map(({ url }) => url.href), [
    NEWEST_URL,
    earlierUrl(0),
    earlierUrl(1),
    earlierUrl(2),
  ]);
  // One progress message before each request after the session's (14 Oct 2026 review).
  assert.equal(answer.pending.length, 4, "one progress message before each later request");
  // After each page, how far the read got: the next page to ask for, the newest time and
  // the pages read; at the start, the `before` the first page was read with.
  assert.deepEqual(answer.reports, [
    { before: cursor(0), top: time(0), pages: 1 },
    { before: cursor(1), top: time(0), pages: 2 },
    { before: cursor(2), top: time(0), pages: 3 },
    { before: cursor(2), top: time(0), pages: 4 },
  ]);
});

test("chatgpt own read page: a chat of one page keeps no point to continue from", async () => {
  const world = chatgptWorld({ responses: chat(1) });
  const answer = world.ask();
  assert.deepEqual(await answer, { kind: "read" });
  assert.deepEqual(answer.reports, [{ before: null, top: null, pages: 1 }]);
});

test("chatgpt own read page: a read continues below the kept point, never reading the pages read before", async () => {
  const world = chatgptWorld({ responses: chat(9, {}, { proving: true }) });
  const answer = world.ask(CHAT, resume(cursor(5), time(0)));
  assert.deepEqual(await answer, { kind: "read" });
  assert.deepEqual(world.fetches.map(({ input }) => input), [
    SESSION_URL,
    NEWEST_URL,
    earlierUrl(5),
    earlierUrl(6),
    earlierUrl(7),
  ]);
  assert.deepEqual(answer.reports, [
    { before: cursor(5), top: time(0), pages: 1 },
    { before: cursor(6), top: time(0), pages: 2 },
    { before: cursor(7), top: time(0), pages: 3 },
    { before: cursor(7), top: time(0), pages: 4 },
  ]);
  // The last page is the chat's start; read by the history reader, it proves the first request.
  const last = world.observed.at(-1)!;
  assert.equal(last.url.href, earlierUrl(7));
  const parsed = parseHistoryText(
    "chatgpt",
    JSON.parse(await (await last.response).text()),
    CHAT,
    new Date().toISOString(),
    undefined,
    [],
    true,
  );
  assert.equal(parsed.firstRequestVerified, true);
  assert.equal(parsed.rootSourceId, cursor(8));
});

test("chatgpt own read page: turns added since the kept stretch are read before it continues below it", async () => {
  // The kept stretch began at page 2's time; pages 0 and 1 came later (another device).
  const world = chatgptWorld({ responses: chat(10) });
  const answer = world.ask(CHAT, resume(cursor(7), time(2)));
  assert.deepEqual(await answer, { kind: "read" });
  assert.deepEqual(world.fetches.map(({ input }) => input).slice(1), [
    NEWEST_URL,
    earlierUrl(0),
    earlierUrl(1),
    earlierUrl(7),
    earlierUrl(8),
  ]);
  // Until the read reaches the kept stretch, the kept point stays; then the stretch grows.
  assert.deepEqual(answer.reports, [
    { before: cursor(7), top: time(2), pages: 1 },
    { before: cursor(7), top: time(2), pages: 2 },
    { before: cursor(7), top: time(0), pages: 3 },
    { before: cursor(8), top: time(0), pages: 4 },
    { before: cursor(8), top: time(0), pages: 5 },
  ]);
});

test("chatgpt own read page: a kept stretch without a time continues at once below its point", async () => {
  const world = chatgptWorld({ responses: chat(5) });
  assert.deepEqual(await world.ask(CHAT, resume(cursor(2), null)), { kind: "read" });
  assert.deepEqual(world.fetches.map(({ input }) => input).slice(1), [
    NEWEST_URL,
    earlierUrl(2),
    earlierUrl(3),
  ]);
});

test("chatgpt own read page: a kept point ChatGPT no longer knows makes the next read start at the newest page", async () => {
  const world = chatgptWorld({
    responses: chat(9, { [earlierUrl(5)]: json('{"detail":"not found"}', 404) }),
  });
  const answer = world.ask(CHAT, resume(cursor(5), time(0)));
  assert.deepEqual(await answer, { kind: "http", status: 404, shouldRetry: true });
  assert.deepEqual(answer.reports.at(-1), { before: null, top: null, pages: 1 });
  // A failure that says nothing about the kept point keeps it.
  const busy = chatgptWorld({ responses: chat(9, { [earlierUrl(5)]: json("{}", 503) }) });
  const kept = busy.ask(CHAT, resume(cursor(5), time(0)));
  assert.deepEqual(await kept, { kind: "http", status: 503, shouldRetry: true });
  assert.deepEqual(kept.reports.at(-1), { before: cursor(5), top: time(0), pages: 1 });
});

test("chatgpt own read page: batches of 20 pages a pause apart, up to the day's page limit", async () => {
  const pauses: number[] = [];
  const batches: number[] = [];
  // The read's own waits at their shortest (3 s per page, a minute per batch) on a fake clock,
  // with the page world's request limit: the batches go on, paced by the limit when they
  // reach it, and never more than its requests in one window.
  const realSetTimeout = globalThis.setTimeout;
  let clock = 7_000_000;
  const times: number[] = [];
  globalThis.setTimeout = ((run: () => void, ms?: number) => {
    if (ms === OWN_READ_TIMEOUT_MS) return realSetTimeout(run, ms);
    clock += ms ?? 0;
    return realSetTimeout(run, 0);
  }) as typeof setTimeout;
  const pages = chat(CHATGPT_DAY_PAGE_LIMIT + 5);
  const world = chatgptWorld({
    responses: (input) => {
      times.push(clock);
      return pages(input);
    },
    pauses,
    batches,
    delays: Array(CHATGPT_DAY_PAGE_LIMIT).fill(OWN_READ_PAGE_SPACING_MS),
    batchWait: CHATGPT_BATCH_PAUSE_MS,
    now: () => clock,
  });
  const answer = world.ask();
  try {
    assert.deepEqual(await answer, { kind: "read_partly" });
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
  for (let i = 0; i + OWN_READ_REQUESTS_PER_WINDOW < times.length; i++)
    assert.ok(times[i + OWN_READ_REQUESTS_PER_WINDOW]! - times[i]! >= OWN_READ_WINDOW_MS);
  // A batch takes about two minutes, so about two and a half fit in a window.
  assert.ok(answer.pending.length > CHATGPT_DAY_PAGE_LIMIT);
  assert.equal(world.observed.length, CHATGPT_DAY_PAGE_LIMIT);
  assert.equal(world.fetches.length, CHATGPT_DAY_PAGE_LIMIT + 1);
  assert.equal(batches.length, CHATGPT_DAY_PAGE_LIMIT / CHATGPT_PAGE_LIMIT - 1);
  assert.equal(pauses.length, CHATGPT_DAY_PAGE_LIMIT - 1 - batches.length);
  assert.deepEqual(answer.reports.at(-1), {
    before: cursor(CHATGPT_DAY_PAGE_LIMIT - 1),
    top: time(0),
    pages: CHATGPT_DAY_PAGE_LIMIT,
  });
});

test("chatgpt own read page: the pages left today bound the read, and none left makes no request", async () => {
  const batches: number[] = [];
  const world = chatgptWorld({ responses: chat(40), batches });
  const answer = world.ask(CHAT, resume(cursor(3), time(0), 25));
  assert.deepEqual(await answer, { kind: "read_partly" });
  assert.equal(world.observed.length, 25);
  assert.equal(world.fetches.at(-1)!.input, earlierUrl(26));
  assert.equal(batches.length, 1, "one pause after the first batch of 20 pages");
  assert.equal(answer.reports.at(-1)!.pages, 25);
  const spent = chatgptWorld({ responses: chat(40) });
  assert.deepEqual(await spent.ask(CHAT, resume(cursor(3), time(0), 0)), { kind: "read_partly" });
  assert.equal(spent.fetches.length, 0);
});

test("chatgpt own read page: a malformed resume value is ignored, and other tools take none", async () => {
  const world = chatgptWorld({ responses: chat(3) });
  for (const value of [
    { before: "not-a-uuid", top: null, budget: 10 },
    { before: null, top: 5, budget: 10 },
    { before: cursor(1), top: null, budget: CHATGPT_DAY_PAGE_LIMIT + 1 },
    { before: cursor(1), top: null, budget: 10, extra: 1 },
    "resume",
  ]) {
    const ports = channel();
    assert.equal(
      world.page.receive(
        { channel: OWN_READ_CHANNEL, site: "chatgpt", conversationId: CHAT, resume: value },
        [ports.port2],
      ),
      true,
    );
    ports.port1.close();
  }
  await tick();
  assert.equal(world.fetches.length, 0);
  const claude = pageWorld(
    claudeOwnRead({ origin: "https://claude.ai", cookie: () => "" }),
    CHAT,
    `/chat/${CHAT}`,
    { responses: [] },
  );
  const ports = channel();
  claude.page.receive(
    {
      channel: OWN_READ_CHANNEL,
      site: "claude",
      conversationId: CHAT,
      resume: { before: null, top: null, budget: 1 },
    },
    [ports.port2],
  );
  ports.port1.close();
  await tick();
  assert.equal(claude.fetches.length, 0);
});

test("chatgpt own read page: a hidden tab holds the next page until it is visible", async () => {
  const world = chatgptWorld({ responses: chat(2) });
  const answer = world.ask();
  for (let i = 0; i < 50 && world.fetches.length < 2; i++) await tick();
  world.state.visible = false;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(world.fetches.length, 2, "no earlier page while hidden");
  world.show();
  assert.deepEqual(await answer, { kind: "read" });
  assert.equal(world.fetches.at(-1)!.input, earlierUrl(0));
});

test("chatgpt own read page: a hidden tab holds the next batch until it is visible", async () => {
  const world = chatgptWorld({ responses: chat(CHATGPT_PAGE_LIMIT + 3) });
  const answer = world.ask();
  for (let i = 0; i < 400 && world.fetches.length < CHATGPT_PAGE_LIMIT + 1; i++) await tick();
  world.state.visible = false;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(world.fetches.length, CHATGPT_PAGE_LIMIT + 1, "no page of the next batch while hidden");
  world.show();
  assert.deepEqual(await answer, { kind: "read" });
  assert.equal(world.observed.length, CHATGPT_PAGE_LIMIT + 3);
});

test("chatgpt own read page: leaving the chat during the pause stops the read", async () => {
  const world = chatgptWorld({ responses: chat(3), delays: [30] });
  const answer = world.ask();
  for (let i = 0; i < 50 && world.fetches.length < 2; i++) await tick();
  world.state.pathname = `/c/${OTHER}`;
  world.page.routeChanged();
  assert.deepEqual(await answer, { kind: "navigated" });
  assert.equal(world.fetches.length, 2);
});

test("chatgpt own read page: the person scrolling up stops the read; the page's newest read does not", async () => {
  let release!: (response: Response) => void;
  const world = chatgptWorld({
    responses: chat(3, {
      [earlierUrl(0)]: new Promise<Response>((resolve) => (release = resolve)) as unknown as Response,
    }),
  });
  const answer = world.ask();
  for (let i = 0; i < 50 && world.fetches.length < 3; i++) await tick();
  const signal = world.fetches[2]!.init.signal!;
  world.page.pageRead(new URL(NEWEST_URL), "GET");
  assert.equal(signal.aborted, false);
  world.page.pageRead(new URL(earlierUrl(0)), "GET");
  assert.equal(signal.aborted, true);
  release(json(page(1, true)));
  assert.deepEqual(await answer, { kind: "page_read" });
});

for (const [label, overrides, outcome, fetches] of [
  ["a signed-out session", { [SESSION_URL]: json("{}") }, { kind: "no_session" }, 1],
  ["a session without an account", { [SESSION_URL]: json(`{"accessToken":"${TOKEN}"}`) }, { kind: "no_session" }, 1],
  ["a refused session", { [SESSION_URL]: json("{}", 403) }, { kind: "http", status: 403, shouldRetry: true }, 1],
  ["a session network error", { [SESSION_URL]: new TypeError("Failed to fetch") }, { kind: "network" }, 1],
  ["401 on the chat", { [NEWEST_URL]: json("{}", 401) }, { kind: "http", status: 401, shouldRetry: true }, 2],
  ["404 on the chat", { [NEWEST_URL]: json('{"detail":"not found"}', 404) }, { kind: "http", status: 404, shouldRetry: true }, 2],
  ["429 on the chat", { [NEWEST_URL]: json("{}", 429) }, { kind: "http", status: 429, shouldRetry: true }, 2],
  ["another chat's page", { [NEWEST_URL]: json(page(0, false, OTHER)) }, { kind: "invalid" }, 2],
  ["invalid JSON", { [NEWEST_URL]: json("{not json") }, { kind: "invalid" }, 2],
  ["a 503 on an earlier page", { [earlierUrl(0)]: json("{}", 503) }, { kind: "http", status: 503, shouldRetry: true }, 3],
  ["an earlier page without a cursor", { [NEWEST_URL]: json(page(0, true).replace(`"start_cursor":"${cursor(0)}"`, '"start_cursor":null')) }, { kind: "invalid" }, 2],
] as const)
  test(`chatgpt own read page: ${label} ends the read without a retry`, async () => {
    const world = chatgptWorld({ responses: chat(3, overrides as Record<string, Response | Error>) });
    assert.deepEqual(await world.ask(), outcome);
    assert.equal(world.fetches.length, fetches, "no retry");
  });
