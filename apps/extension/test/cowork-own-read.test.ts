import { after, test as base } from "node:test";
import assert from "node:assert/strict";
import {
  COWORK_PAGE_EVENTS,
  COWORK_PAGE_LIMIT,
  coworkEventsPage,
  coworkEventsUrl,
  coworkListSession,
} from "../lib/cowork-own-read";
import { claudeOwnRead } from "../lib/claude-own-read";
import { ownReadConversation } from "../lib/own-read";
import { closePorts, json, pageWorld, recordingContext, tick } from "./own-read-fixture";
import { OWN_READ_PAGE_SPACING_MS } from "../lib/own-read-page";

after(closePorts);

const test = (name: string, fn: () => unknown) =>
  base(name, { timeout: 10_000 }, fn as () => Promise<void>);

// Synthetic Cowork events in the shape seen in October 2026 (structure only).
const SESSION = "cse_0123456789ABCDEFghijklmn";
const OTHER = "cse_ZYXWVUTSRQPONMLKjihgfedc";
const ORIGIN = "https://claude.ai";
const firstUrl = `${ORIGIN}/v1/code/sessions/${SESSION}/events?limit=500&sort_order=asc`;
const laterUrl = (cursor: number) => `${firstUrl}&cursor=${cursor}`;
const envelope = (sequence: number) => ({
  event_id: crypto.randomUUID(),
  sequence_num: String(sequence),
  event_type: "client_event",
  source: "server",
  payload: { type: "system", subtype: "status" },
  created_at: "2026-10-14T10:00:00.000Z",
});
/** Events `from` to `to`, oldest first, as one page of the list. */
const events = (from: number, to: number) =>
  JSON.stringify({
    data: Array.from({ length: to - from + 1 }, (_, i) => envelope(from + i)),
    resume_cursor: null,
  });

function coworkWorld(
  respond: (input: string) => Response | Error | Promise<Response>,
  options: { visible?: boolean } = {},
) {
  return pageWorld(
    claudeOwnRead({ origin: ORIGIN, cookie: () => "", pageDelay: () => 0 }),
    SESSION,
    `/cowork/${SESSION}`,
    { ...options, responses: (input) => respond(input) },
  );
}

test("cowork own read: the page's list request, oldest first, with the cursor of the last event", () => {
  assert.equal(ownReadConversation("claude", `/cowork/${SESSION}`), SESSION);
  assert.equal(coworkEventsUrl(ORIGIN, SESSION)!.href, firstUrl);
  assert.equal(coworkEventsUrl(ORIGIN, SESSION, 500)!.href, laterUrl(500));
  assert.equal(coworkEventsUrl(ORIGIN, "cse_short"), null);
  assert.equal(coworkListSession(new URL(firstUrl), "GET"), SESSION);
  assert.equal(coworkListSession(new URL(`${ORIGIN}/v1/code/sessions/${SESSION}/events/stream`), "GET"), null);
  assert.equal(coworkListSession(new URL(firstUrl), "POST"), null);
});

// Owner decision of 17 Oct 2026: later pages follow at a fixed 1 s, never a random wait.
test("cowork own read: later pages are read 1 s apart, whatever Math.random returns", async () => {
  const random = Math.random;
  Math.random = () => 0.9999;
  try {
    const run = recordingContext(SESSION, `/cowork/${SESSION}`, (url) => {
      const cursor = Number(url.searchParams.get("cursor") ?? 0);
      return json(cursor < 1000 ? events(cursor + 1, cursor + 500) : events(1001, 1003));
    });
    const provider = claudeOwnRead({ origin: ORIGIN, cookie: () => "" });
    assert.deepEqual(await provider.run(run.context), { kind: "read" });
    assert.deepEqual(run.urls, [firstUrl, laterUrl(500), laterUrl(1000)]);
    assert.deepEqual(run.pauses, [1000, 1000]);
    assert.equal(OWN_READ_PAGE_SPACING_MS, 1000);
  } finally {
    Math.random = random;
  }
});

test("cowork own read: a page is taken only with events in order after the cursor", () => {
  assert.deepEqual(coworkEventsPage(JSON.parse(events(1, 3)), null), { events: 3, last: 3 });
  assert.deepEqual(coworkEventsPage(JSON.parse(events(4, 5)), 3), { events: 2, last: 5 });
  assert.deepEqual(coworkEventsPage({ data: [] }, null), { events: 0, last: null });
  assert.equal(coworkEventsPage(JSON.parse(events(3, 4)), 3), null, "repeats the cursor");
  assert.equal(coworkEventsPage({ data: [envelope(2), envelope(1)] }, null), null, "newest first");
  assert.equal(coworkEventsPage({ data: [{ sequence_num: "x" }] }, null), null);
  assert.equal(coworkEventsPage({ data: {} }, null), null);
  assert.equal(coworkEventsPage([], null), null);
});

test("cowork own read page: one GET with the API version header, answered into the history reader", async () => {
  const world = coworkWorld(() => json(events(1, 12)));
  assert.deepEqual(await world.ask(), { kind: "read" });
  assert.equal(world.fetches.length, 1);
  const { input, init } = world.fetches[0]!;
  assert.equal(input, firstUrl);
  assert.equal(init.method, "GET");
  assert.equal(init.credentials, "include");
  assert.deepEqual(init.headers, { "anthropic-version": "2023-06-01" });
  assert.equal(world.observed.length, 1);
  assert.equal(world.observed[0]!.url.href, firstUrl);
  assert.equal(world.observed[0]!.method, "GET");
});

test("cowork own read page: full pages are followed by their last sequence number until a short page", async () => {
  const world = coworkWorld((input) =>
    input === firstUrl
      ? json(events(1, 500))
      : input === laterUrl(500)
        ? json(events(501, 1000))
        : input === laterUrl(1000)
          ? json(events(1001, 1003))
          : new Error(`unexpected ${input}`),
  );
  const answer = world.ask();
  assert.deepEqual(await answer, { kind: "read" });
  assert.deepEqual(world.fetches.map(({ input }) => input), [firstUrl, laterUrl(500), laterUrl(1000)]);
  assert.equal(world.observed.length, 3);
  assert.equal(answer.pending.length, 2);
});

test("cowork own read page: the page limit stops a very long session as read partly", async () => {
  const world = coworkWorld((input) => {
    const cursor = Number(new URL(input).searchParams.get("cursor") ?? 0);
    return json(events(cursor + 1, cursor + COWORK_PAGE_EVENTS));
  });
  assert.deepEqual(await world.ask(), { kind: "read_partly" });
  assert.equal(world.fetches.length, COWORK_PAGE_LIMIT);
});

for (const [label, response, outcome] of [
  ["404", json('{"error":{"type":"not_found_error"}}', 404), { kind: "http", status: 404, shouldRetry: true }],
  ["400", json("{}", 400), { kind: "http", status: 400, shouldRetry: true }],
  ["429", json("{}", 429), { kind: "http", status: 429, shouldRetry: true }],
  ["network error", new TypeError("Failed to fetch"), { kind: "network" }],
  ["invalid JSON", json("{not json"), { kind: "invalid" }],
  ["events out of order", json(JSON.stringify({ data: [envelope(2), envelope(1)] })), { kind: "invalid" }],
] as const)
  test(`cowork own read page: ${label} ends the read without a retry`, async () => {
    const world = coworkWorld(() => response as Response | Error);
    assert.deepEqual(await world.ask(), outcome);
    assert.equal(world.fetches.length, 1);
    assert.equal(world.observed.length, 0);
  });

test("cowork own read page: the page's own events list stops the read; its live stream does not", async () => {
  let release!: (response: Response) => void;
  const world = coworkWorld(() => new Promise<Response>((resolve) => (release = resolve)));
  const answer = world.ask();
  await tick();
  const signal = world.fetches[0]!.init.signal!;
  world.page.pageRead(new URL(`${ORIGIN}/v1/code/sessions/${SESSION}/events/stream?from_sequence_num=1`), "GET");
  world.page.pageRead(new URL(`${ORIGIN}/v1/code/sessions/${OTHER}/events?limit=500&sort_order=asc`), "GET");
  assert.equal(signal.aborted, false);
  world.page.pageRead(new URL(`${ORIGIN}/v1/code/sessions/${SESSION}/events?limit=500&sort_order=asc`), "GET");
  assert.equal(signal.aborted, true);
  release(json(events(1, 3)));
  assert.deepEqual(await answer, { kind: "page_read" });
});

test("cowork own read page: a hidden tab is declined", async () => {
  const hidden = coworkWorld(() => json(events(1, 2)), { visible: false });
  assert.deepEqual(await hidden.ask(), { kind: "declined" });
  assert.equal(hidden.fetches.length, 0);
});
