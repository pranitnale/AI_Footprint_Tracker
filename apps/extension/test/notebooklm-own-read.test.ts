import { after, test as base } from "node:test";
import assert from "node:assert/strict";
import {
  NOTEBOOKLM_PAGE_LIMIT,
  notebooklmOwnRead,
  notebooklmOwnReadRequest,
} from "../lib/notebooklm-own-read";
import { historyReadKind, historyRequestConversation } from "../lib/history-route";
import { ownReadNote } from "../lib/own-read";
import { closePorts, pageWorld, recordingContext, tick } from "./own-read-fixture";
import { OWN_READ_PAGE_SPACING_MS } from "../lib/own-read-page";

after(closePorts);

const test = (name: string, fn: () => unknown) =>
  base(name, { timeout: 10_000 }, fn as () => Promise<void>);

// Shapes as seen on 14 Oct 2026; ids, values and text are synthetic.
const NOTEBOOK = "f0000000-0000-4000-8000-0000000000a1";
const EARLIER = "f0000000-0000-4000-8000-0000000000b2";
const SESSION = "11111111-1111-4111-8111-111111111111";
const SECOND = "11111111-1111-4111-8111-111111111112";
const SOURCE = "33333333-3333-4333-8333-333333333333";
const ORIGIN = "https://notebook.google.com";
const PATH = `/notebook/${NOTEBOOK}`;
const VALUES = { cfb2h: "boq_labs-tailwind-frontend_20261012.00_p0", FdrFJe: "-987654321", SNlM0e: "synthetic-token:1" };
const CONTEXT = [2, null, null, [1, null, null, null, null, null, null, null, null, null, [1]], [[1, 4, 8, 10, 14, 2, 3, 6]]];

const pageUrl = (rpc: string, notebook = EARLIER) =>
  new URL(`${ORIGIN}/_/LabsTailwindUi/data/batchexecute?rpcids=${rpc}&source-path=${encodeURIComponent(`/notebook/${notebook}`)}&bl=x&f.sid=1&hl=en&authuser=3&_reqid=1&rt=c`);
const body = (rpc: string, args: unknown[]) =>
  new URLSearchParams({
    "f.req": JSON.stringify([[[rpc, JSON.stringify(args), null, "generic"]]]),
    at: "synthetic",
  }).toString();
const line = (rows: unknown[]) => {
  const text = JSON.stringify(rows);
  return `${text.length + 2}\n${text}\n`;
};
const wire = (rpc: string, payload: unknown) =>
  ")]}'\n\n" +
  line([["wrb.fr", rpc, JSON.stringify(payload), null, null, null, "generic"]]) +
  line([["e", 4, null, null, 300]]);
const turnTime = (n: number) => [Math.floor(Date.now() / 1000) - 3600 + n, 0];
const turnId = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const question = (n: number) => [turnId(n), turnTime(n), 1, `Question ${n}?`, null, 2];
const answer = (n: number) => [
  turnId(n),
  turnTime(n),
  2,
  null,
  [[`Answer ${n}.`, null, [SOURCE], null, [null, null, null, null, 1]], [[["a passage"]]], null, [["One?"]]],
  2,
];
/** A page of turns, newest first, with the older-page token when older turns exist. */
const chatPage = (n: number, older?: string) =>
  wire("khqZz", older === undefined ? [[answer(n + 1), question(n)]] : [[answer(n + 1), question(n)], older]);
const sessionList = (...sessions: string[]) =>
  wire("hPTbtc", [sessions.map((id) => [id, turnTime(0), turnTime(1)])]);

/** Teaches the provider the page's own reads of an earlier notebook in this tab. */
function learn(world: ReturnType<typeof pageWorld>) {
  world.page.pageRead(pageUrl("hPTbtc"), "POST", body("hPTbtc", [EARLIER, [2]]));
  world.page.pageRead(pageUrl("khqZz"), "POST", body("khqZz", [CONTEXT, null, null, SESSION, 20]));
}

type Reply = (rpc: string, args: unknown[]) => string | Response | Error;
function notebookWorld(reply: Reply, options: { visible?: boolean; values?: object | null } = {}) {
  const requests: Array<{ rpc: string; args: unknown[]; url: URL; init: RequestInit }> = [];
  const world = pageWorld(
    notebooklmOwnRead({
      origin: ORIGIN,
      pageValues: () => (options.values === undefined ? VALUES : (options.values as never)),
      language: () => "de",
      random: () => 0.5,
      pageDelay: () => 0,
    }),
    NOTEBOOK,
    PATH,
    {
      visible: options.visible,
      responses: (input, init) => {
        const url = new URL(input);
        const form = new URLSearchParams(String(init.body));
        const rpc = url.searchParams.get("rpcids")!;
        const args = JSON.parse(JSON.parse(form.get("f.req")!)[0][0][1]);
        requests.push({ rpc, args, url, init });
        const answered = reply(rpc, args);
        return typeof answered === "string" ? new Response(answered) : answered;
      },
    },
  );
  return Object.assign(world, { requests });
}

const oneSession: Reply = (rpc) => (rpc === "hPTbtc" ? sessionList(SESSION) : chatPage(1));

test("notebooklm own read: requests are the page's batch reads, with its account index", () => {
  const request = notebooklmOwnReadRequest(ORIGIN, PATH, "khqZz", [CONTEXT, null, null, SESSION, 20], VALUES, "de", "3", 550000)!;
  assert.equal(
    request.url.href,
    `${ORIGIN}/_/LabsTailwindUi/data/batchexecute?rpcids=khqZz&source-path=%2Fnotebook%2F${NOTEBOOK}&bl=boq_labs-tailwind-frontend_20261012.00_p0&f.sid=-987654321&hl=de&_reqid=550000&authuser=3&rt=c`,
  );
  assert.equal(historyRequestConversation("notebooklm", request.url, "POST", request.body), NOTEBOOK);
  assert.equal(historyReadKind("notebooklm", request.url, request.body), `khqZz:${SESSION}`);
  const form = new URLSearchParams(request.body);
  assert.equal(form.get("at"), VALUES.SNlM0e);
  assert.ok(request.body.endsWith("&"));
  assert.equal(
    notebooklmOwnReadRequest(ORIGIN, PATH, "khqZz", [], VALUES, "de", null, 1)!.url.searchParams.has("authuser"),
    false,
  );
  assert.equal(notebooklmOwnReadRequest(ORIGIN, PATH, "khqZz", [], { ...VALUES, SNlM0e: "" }, "de", null, 1), null);
});

// Owner decision of 17 Oct 2026: older pages follow at a fixed 1 s, never a random wait.
test("notebooklm own read: older pages are read 1 s apart, whatever Math.random returns", async () => {
  const random = Math.random;
  Math.random = () => 0.9999;
  try {
    const provider = notebooklmOwnRead({ origin: ORIGIN, pageValues: () => VALUES, language: () => "de" });
    provider.learn!(pageUrl("hPTbtc"), "POST", body("hPTbtc", [EARLIER, [2]]));
    provider.learn!(pageUrl("khqZz"), "POST", body("khqZz", [CONTEXT, null, null, SESSION, 20]));
    let pages = 0;
    const run = recordingContext(NOTEBOOK, PATH, (url) =>
      new Response(
        url.searchParams.get("rpcids") === "hPTbtc"
          ? sessionList(SESSION)
          : ++pages < 3
            ? chatPage(pages * 2, `older-${pages}`)
            : chatPage(pages * 2),
      ),
    );
    assert.deepEqual(await provider.run(run.context), { kind: "read" });
    assert.equal(pages, 3);
    assert.deepEqual(run.pauses, [OWN_READ_PAGE_SPACING_MS, OWN_READ_PAGE_SPACING_MS]);
    assert.equal(OWN_READ_PAGE_SPACING_MS, 1000);
  } finally {
    Math.random = random;
  }
});

test("notebooklm own read page: without the page's own chat reads in this tab nothing is sent, and Details says why", async () => {
  const world = notebookWorld(oneSession);
  assert.deepEqual(await world.ask(), { kind: "no_request" });
  assert.equal(world.fetches.length, 0);
  // Only the session list seen: the chat read's context is still unknown.
  const listOnly = notebookWorld(oneSession);
  listOnly.page.pageRead(pageUrl("hPTbtc"), "POST", body("hPTbtc", [EARLIER, [2]]));
  assert.deepEqual(await listOnly.ask(), { kind: "no_request" });
  assert.equal(listOnly.fetches.length, 0);
  assert.match(ownReadNote({ kind: "no_request" }, "notebooklm")!, /NotebookLM had not read a saved chat in this tab yet/);
});

test("notebooklm own read page: the session list and each session's turns are read with the page's shapes", async () => {
  const world = notebookWorld(oneSession);
  learn(world);
  // The page's own reads were of another notebook, so they do not count for this one.
  assert.deepEqual(await world.ask(), { kind: "read" });
  assert.deepEqual(
    world.requests.map(({ rpc, args }) => [rpc, args]),
    [
      ["hPTbtc", [NOTEBOOK, [2]]],
      ["khqZz", [CONTEXT, null, null, SESSION, 20]],
    ],
  );
  for (const { url, init } of world.requests) {
    assert.equal(url.searchParams.get("authuser"), "3");
    assert.equal(url.searchParams.get("source-path"), PATH);
    assert.equal(init.method, "POST");
    assert.equal(init.credentials, "include");
    assert.deepEqual(init.headers, {
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      "x-same-domain": "1",
    });
  }
  // Both answers take the page's history path: the list for the session proof, then turns.
  assert.deepEqual(
    world.observed.map(({ url }) => url.searchParams.get("rpcids")),
    ["hPTbtc", "khqZz"],
  );
  assert.equal(world.observed[1]!.body, world.requests[1]!.init.body);
});

test("notebooklm own read page: older pages follow their token, every session in turn, up to the page limit", async () => {
  const world = notebookWorld((rpc, args) =>
    rpc === "hPTbtc"
      ? sessionList(SESSION, SECOND)
      : args[3] === SESSION && args.length === 5
        ? chatPage(3, "older-token")
        : chatPage(1),
  );
  learn(world);
  const answered = world.ask();
  assert.deepEqual(await answered, { kind: "read" });
  assert.deepEqual(
    world.requests.slice(1).map(({ args }) => args.slice(3)),
    [[SESSION, 20], [SESSION, 20, "older-token"], [SECOND, 20]],
  );
  // Progress before each request after the session list (14 Oct 2026 review), so a long
  // first page does not run out the content script's wait.
  assert.equal(answered.pending.length, 3, "progress before each later request");
  const long = notebookWorld((rpc) => (rpc === "hPTbtc" ? sessionList(SESSION) : chatPage(3, "again")));
  learn(long);
  assert.deepEqual(await long.ask(), { kind: "read_partly" });
  assert.equal(long.requests.filter(({ rpc }) => rpc === "khqZz").length, NOTEBOOKLM_PAGE_LIMIT);
});

test("notebooklm own read page: a notebook without a chat is read with its empty list alone", async () => {
  const world = notebookWorld((rpc) => (rpc === "hPTbtc" ? wire("hPTbtc", []) : chatPage(1)));
  learn(world);
  assert.deepEqual(await world.ask(), { kind: "read" });
  assert.deepEqual(world.requests.map(({ rpc }) => rpc), ["hPTbtc"]);
});

for (const [label, reply, outcome] of [
  ["a refused list", () => new Response("", { status: 401 }), { kind: "http", status: 401, shouldRetry: true }],
  ["an unreadable list", () => wire("hPTbtc", [["not-an-id"]]), { kind: "invalid" }],
  ["a chat page of another shape", (rpc: string) => (rpc === "hPTbtc" ? sessionList(SESSION) : wire("khqZz", [[["x"]]])), { kind: "invalid" }],
  ["a network error", () => new TypeError("Failed to fetch"), { kind: "network" }],
] as const)
  test(`notebooklm own read page: ${label} ends the read`, async () => {
    const world = notebookWorld(reply as Reply);
    learn(world);
    assert.deepEqual(await world.ask(), outcome);
  });

test("notebooklm own read page: missing page values send nothing", async () => {
  const world = notebookWorld(oneSession, { values: null });
  learn(world);
  assert.deepEqual(await world.ask(), { kind: "no_session" });
  assert.equal(world.fetches.length, 0);
});

test("notebooklm own read page: the page's chat reads of this notebook stop the read; its Studio polls do not", async () => {
  let release!: (response: Response) => void;
  const world = notebookWorld((rpc) =>
    rpc === "hPTbtc"
      ? (new Promise<Response>((resolve) => (release = resolve)) as unknown as Response)
      : chatPage(1),
  );
  learn(world);
  const answered = world.ask();
  await tick();
  const signal = world.requests[0]!.init.signal!;
  world.page.pageRead(
    pageUrl("gArtLc", NOTEBOOK),
    "POST",
    body("gArtLc", [CONTEXT, NOTEBOOK, 'NOT artifact.status = "ARTIFACT_STATUS_SUGGESTED"']),
  );
  assert.equal(signal.aborted, false);
  world.page.pageRead(pageUrl("hPTbtc", NOTEBOOK), "POST", body("hPTbtc", [NOTEBOOK, [2]]));
  assert.equal(signal.aborted, true);
  release(new Response(sessionList(SESSION)));
  assert.deepEqual(await answered, { kind: "page_read" });
  assert.deepEqual(await world.ask(), { kind: "page_read" });
});

test("notebooklm own read page: a hidden tab is declined", async () => {
  const world = notebookWorld(oneSession, { visible: false });
  learn(world);
  assert.deepEqual(await world.ask(), { kind: "declined" });
  assert.equal(world.fetches.length, 0);
});
