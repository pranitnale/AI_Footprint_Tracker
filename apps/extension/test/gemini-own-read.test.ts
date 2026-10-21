import { after, test as base } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ownReadConversation } from "../lib/own-read";
import {
  geminiOwnRead,
  geminiOwnReadRequest,
  readableGeminiChat,
  type GeminiPageValues,
} from "../lib/gemini-own-read";
import { historyRequestConversation } from "../lib/history-route";
import { closePorts, json, pageWorld, tick } from "./own-read-fixture";

after(closePorts);

const test = (name: string, fn: () => unknown) =>
  base(name, { timeout: 10_000 }, fn as () => Promise<void>);

// Synthetic page values in the shape of Gemini's `WIZ_global_data`.
const VALUES: GeminiPageValues = {
  cfb2h: "boq_assistant-bard-web-server_20261012.00_p0",
  FdrFJe: "-1234567890123456789",
  SNlM0e: "synthetic-token:1760000000000",
};
const CHAT = "c_0000000000000042";
const PATH = "/app/0000000000000042";
// The page's history answer for this chat, as captured on 14 September 2026.
const WIRE = readFileSync(
  new URL(
    "../../../fixtures/history-observation-2026-09-14/gemini-history-wire.txt",
    import.meta.url,
  ),
  "utf8",
);
// Google's batch error row for a chat that does not exist (HTTP 200, captured live on 14 October
// 2026): no payload, status 5 with a BardErrorInfo detail.
const NOT_FOUND = `)]}'\n\n188\n[["wrb.fr","hNvQHb",null,null,null,[5,null,[["type.googleapis.com/assistant.boq.bard.application.BardErrorInfo",[1167]]]],"generic"],["di",94],["af.httprm",93,"-6127900089282570210",25]]\n25\n[["e",4,null,null,224]]\n`;

const text = (body: string) =>
  new Response(body, {
    headers: { "content-type": "application/json; charset=utf-8" },
  });

function geminiWorld(
  options: Parameters<typeof pageWorld>[3] & {
    values?: GeminiPageValues | null;
    pathname?: string;
    language?: string;
  } = {},
) {
  let reads = 0;
  const world = pageWorld(
    geminiOwnRead({
      origin: "https://gemini.google.com",
      pageValues: () => {
        reads++;
        return options.values === undefined ? VALUES : options.values;
      },
      language: () => options.language ?? "de",
      random: () => 0.5,
    }),
    CHAT,
    options.pathname ?? PATH,
    options,
  );
  return Object.assign(world, { valueReads: () => reads });
}

test("gemini own read: the request is the page's own history read of the ten newest turns", () => {
  const request = geminiOwnReadRequest(
    "https://gemini.google.com",
    PATH,
    CHAT,
    VALUES,
    "de",
    550000,
  )!;
  assert.equal(
    request.url.href,
    "https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=hNvQHb&source-path=%2Fapp%2F0000000000000042&bl=boq_assistant-bard-web-server_20261012.00_p0&f.sid=-1234567890123456789&hl=de&_reqid=550000&rt=c",
  );
  const form = new URLSearchParams(request.body);
  assert.deepEqual([...form.keys()], ["f.req", "at"]);
  assert.equal(form.get("at"), VALUES.SNlM0e);
  assert.deepEqual(JSON.parse(form.get("f.req")!), [
    [["hNvQHb", `["${CHAT}",10,null,1,[1],[4],null,1]`, null, "generic"]],
  ]);
  assert.ok(request.body.endsWith("&"));
  // The history reader takes it for the same chat as the page's own read.
  assert.equal(historyRequestConversation("gemini", request.url, "POST", request.body), CHAT);
});

test("gemini own read: a secondary account keeps its /u/N prefix and a Gem its path", () => {
  for (const pathname of ["/u/3/app/0000000000000042", "/u/3/gem/abc_DEF-1/0000000000000042"]) {
    assert.equal(ownReadConversation("gemini", pathname), CHAT);
    const request = geminiOwnReadRequest(
      "https://gemini.google.com",
      pathname,
      CHAT,
      VALUES,
      "en",
      123456,
    )!;
    assert.equal(request.url.pathname, "/u/3/_/BardChatUi/data/batchexecute");
    assert.equal(request.url.searchParams.get("source-path"), pathname);
    assert.equal(historyRequestConversation("gemini", request.url, "POST", request.body), CHAT);
  }
});

test("gemini own read: missing page values or a malformed chat id send nothing", () => {
  for (const values of [
    null,
    {},
    { ...VALUES, SNlM0e: "" },
    { ...VALUES, cfb2h: 7 },
    { ...VALUES, FdrFJe: undefined },
    { ...VALUES, SNlM0e: "x".repeat(600) },
  ])
    assert.equal(
      geminiOwnReadRequest("https://gemini.google.com", PATH, CHAT, values as GeminiPageValues, "de", 1),
      null,
      JSON.stringify(values),
    );
  assert.equal(
    geminiOwnReadRequest("https://gemini.google.com", PATH, "0000000000000042", VALUES, "de", 1),
    null,
  );
  assert.equal(
    geminiOwnReadRequest("https://gemini.google.com", PATH, CHAT, VALUES, "", 1)!.url.searchParams.get("hl"),
    "en",
  );
});

test("gemini own read: the captured answer is readable only for its own chat", () => {
  assert.equal(readableGeminiChat(WIRE, CHAT), true);
  assert.equal(readableGeminiChat(WIRE, "c_0000000000000043"), false);
  assert.equal(readableGeminiChat(NOT_FOUND, CHAT), false);
  assert.equal(readableGeminiChat("<html></html>", CHAT), false);
});

test("gemini own read page: one POST with the login cookies and the page's form headers, answered into the history reader", async () => {
  const world = geminiWorld({ responses: [text(WIRE)] });
  assert.deepEqual(await world.ask(), { kind: "read" });
  assert.equal(world.fetches.length, 1);
  const { input, init } = world.fetches[0]!;
  const url = new URL(input);
  assert.equal(url.origin + url.pathname, "https://gemini.google.com/_/BardChatUi/data/batchexecute");
  assert.equal(url.searchParams.get("_reqid"), "550000");
  assert.equal(init.method, "POST");
  assert.equal(init.credentials, "include");
  assert.deepEqual(init.headers, {
    "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    "x-same-domain": "1",
  });
  assert.deepEqual(Object.keys(init).sort(), ["body", "credentials", "headers", "method", "signal"]);
  assert.equal(world.observed.length, 1);
  assert.equal(world.observed[0]!.method, "POST");
  assert.equal(world.observed[0]!.url.href, input);
  assert.equal(world.observed[0]!.body, init.body);
  assert.equal(await (await world.observed[0]!.response).text(), WIRE);
  // The page values are read when the request is made, not kept from an earlier time.
  assert.equal(world.valueReads(), 1);
});

test("gemini own read page: no page values means no request", async () => {
  const world = geminiWorld({ values: null });
  assert.deepEqual(await world.ask(), { kind: "no_session" });
  assert.equal(world.fetches.length, 0);
});

for (const [label, response, outcome] of [
  ["an unknown chat", text(NOT_FOUND), { kind: "not_found" }],
  ["another chat's turns", text(WIRE.replaceAll("c_0000000000000042", "c_0000000000000043")), { kind: "invalid" }],
  ["an HTML page", new Response("<html></html>", { headers: { "content-type": "text/html" } }), { kind: "invalid" }],
  ["401", json("{}", 401), { kind: "http", status: 401, shouldRetry: true }],
  ["403", json("{}", 403), { kind: "http", status: 403, shouldRetry: true }],
  ["429", json("{}", 429), { kind: "http", status: 429, shouldRetry: true }],
  ["500", json("{}", 500), { kind: "http", status: 500, shouldRetry: true }],
  ["network error", new TypeError("Failed to fetch"), { kind: "network" }],
] as const)
  test(`gemini own read page: ${label} is reported once and never reaches the history reader`, async () => {
    const world = geminiWorld({ responses: [response as Response | Error] });
    assert.deepEqual(await world.ask(), outcome);
    assert.equal(world.fetches.length, 1, "no retry");
    assert.equal(world.observed.length, 0);
  });

test("gemini own read page: the page's own history read stops a running read and prevents the next", async () => {
  let release!: (response: Response) => void;
  const world = geminiWorld({
    responses: [new Promise<Response>((resolve) => (release = resolve))],
  });
  const answer = world.ask();
  await tick();
  const signal = world.fetches[0]!.init.signal!;
  const own = geminiOwnReadRequest(
    "https://gemini.google.com",
    PATH,
    CHAT,
    VALUES,
    "de",
    222222,
  )!;
  world.page.pageRead(own.url, "POST", own.body);
  assert.equal(signal.aborted, true);
  release(text(WIRE));
  assert.deepEqual(await answer, { kind: "page_read" });
  assert.equal(world.observed.length, 0);
  assert.deepEqual(await world.ask(), { kind: "page_read" });
  assert.equal(world.fetches.length, 1);
});

test("gemini own read page: a page read of another chat, or another RPC, does not count", async () => {
  const world = geminiWorld({ responses: [text(WIRE)] });
  const other = geminiOwnReadRequest(
    "https://gemini.google.com",
    "/app/0000000000000043",
    "c_0000000000000043",
    VALUES,
    "de",
    1,
  )!;
  world.page.pageRead(other.url, "POST", other.body);
  world.page.pageRead(
    new URL("https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=MaZiqc"),
    "POST",
    "f.req=%5B%5D&at=x&",
  );
  assert.deepEqual(await world.ask(), { kind: "read" });
});

test("gemini own read page: a hidden tab is declined without a request", async () => {
  const world = geminiWorld({ visible: false });
  assert.deepEqual(await world.ask(), { kind: "declined" });
  assert.equal(world.fetches.length, 0);
  assert.equal(world.valueReads(), 0);
});
