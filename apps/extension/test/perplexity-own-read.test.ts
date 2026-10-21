import { after, test as base } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ownReadConversation } from "../lib/own-read";
import {
  perplexityAccount,
  perplexityOwnRead,
  perplexityOwnReadUrl,
  readablePerplexityThread,
} from "../lib/perplexity-own-read";
import { historyRequestConversation } from "../lib/history-route";
import { closePorts, json, pageWorld, tick } from "./own-read-fixture";

after(closePorts);

const test = (name: string, fn: () => unknown) =>
  base(name, { timeout: 10_000 }, fn as () => Promise<void>);

const THREAD = "00000000-0000-4000-8000-000000000042";
const OTHER = "00000000-0000-4000-8000-000000000043";
const ACCOUNT = "00000000-0000-4000-8000-0000000000cc";
const EXACT_URL =
  `https://www.perplexity.ai/rest/thread/${THREAD}?with_parent_info=true&with_schematized_response=true&version=2.18&source=default&limit=20&offset=0&from_first=false&with_first_entry=true&with_latest_entry=false` +
  // The page's 26 block kinds in its own order, captured live on 14 October 2026.
  [
    "answer_modes", "media_items", "inline_entity_cards", "place_widgets", "finance_widgets",
    "news_widgets", "shopping_widgets", "search_result_widgets", "inline_images", "inline_assets",
    "placeholder_cards", "diff_blocks", "entity_group_v2", "refinement_filters", "canvas_mode",
    "maps_preview", "answer_tabs", "preserve_latex", "in_context_suggestions", "pending_followups",
    "inline_claims", "unified_assets", "workflow_steps", "workflow_widgets", "navigation_results",
    "background_agents",
  ]
    .map((useCase) => `&supported_block_use_cases=${useCase}`)
    .join("");
// A saved thread page as the page reads it (14 September 2026 capture).
const PAGE = readFileSync(
  new URL(
    "../../../fixtures/history-observation-2026-09-14/perplexity-workflow-page.json",
    import.meta.url,
  ),
  "utf8",
);

function perplexityWorld(
  options: Parameters<typeof pageWorld>[3] & {
    stored?: string | null;
    cookie?: string;
  } = {},
) {
  return pageWorld(
    perplexityOwnRead({
      origin: "https://www.perplexity.ai",
      storedAccount: () => (options.stored === undefined ? `"${ACCOUNT}"` : options.stored),
      cookie: () => options.cookie ?? "",
    }),
    THREAD,
    `/search/${THREAD}`,
    options,
  );
}

test("perplexity own read: the request is the page's own read of the thread's first page", () => {
  assert.equal(perplexityOwnReadUrl("https://www.perplexity.ai", THREAD)!.href, EXACT_URL);
  assert.equal(perplexityOwnReadUrl("https://www.perplexity.ai", "some-slug-abc"), null);
  assert.equal(
    historyRequestConversation("perplexity", new URL(EXACT_URL), "GET"),
    THREAD,
  );
  assert.equal(ownReadConversation("perplexity", `/search/${THREAD}`), THREAD);
  assert.equal(ownReadConversation("perplexity", "/discover"), null);
});

test("perplexity own read: the account comes from local storage, else the page's cookie", () => {
  assert.equal(perplexityAccount(`"${ACCOUNT}"`, ""), ACCOUNT);
  assert.equal(perplexityAccount(ACCOUNT, ""), ACCOUNT);
  assert.equal(
    perplexityAccount(null, `a=1; __Host-pplx-last-active-account=${encodeURIComponent(`"${ACCOUNT}"`)}; b=2`),
    ACCOUNT,
  );
  assert.equal(perplexityAccount("not-an-id", `__Host-pplx-last-active-account=${ACCOUNT}`), ACCOUNT);
  assert.equal(perplexityAccount(null, "pplx-last-active-account=" + ACCOUNT), null);
  assert.equal(perplexityAccount("%E0%A4%A", ""), null);
  assert.equal(perplexityAccount(null, ""), null);
});

test("perplexity own read: only a successful page with entries is readable", () => {
  assert.equal(readablePerplexityThread(JSON.parse(PAGE)), true);
  assert.equal(readablePerplexityThread({ ...JSON.parse(PAGE), entries: [] }), false);
  assert.equal(readablePerplexityThread({ ...JSON.parse(PAGE), status: "failed" }), false);
  assert.equal(readablePerplexityThread({ ...JSON.parse(PAGE), has_next_page: null }), false);
  assert.equal(readablePerplexityThread([]), false);
});

test("perplexity own read page: one GET with the page's API headers and account, answered into the history reader", async () => {
  const world = perplexityWorld({ responses: [json(PAGE)] });
  assert.deepEqual(await world.ask(), { kind: "read" });
  assert.equal(world.fetches.length, 1);
  const { input, init } = world.fetches[0]!;
  assert.equal(input, EXACT_URL);
  assert.equal(init.method, "GET");
  assert.equal(init.credentials, "same-origin");
  assert.deepEqual(init.headers, {
    "x-app-apiclient": "default",
    "x-app-apiversion": "2.18",
    "x-pplx-account": ACCOUNT,
  });
  assert.deepEqual(Object.keys(init).sort(), ["credentials", "headers", "method", "signal"]);
  assert.equal(world.observed.length, 1);
  assert.equal(world.observed[0]!.url.href, EXACT_URL);
  assert.equal(await (await world.observed[0]!.response).text(), PAGE);
});

test("perplexity own read page: no account means no request", async () => {
  const world = perplexityWorld({ stored: null, cookie: "" });
  assert.deepEqual(await world.ask(), { kind: "no_session" });
  assert.equal(world.fetches.length, 0);
});

for (const [label, response, outcome] of [
  ["404 THREAD_NOT_FOUND", json('{"status":"failed","error_code":"THREAD_NOT_FOUND"}', 404), { kind: "http", status: 404, shouldRetry: true }],
  ["403 VIEW_THREAD_NOT_ALLOWED", json('{"status":"failed","error_code":"VIEW_THREAD_NOT_ALLOWED"}', 403), { kind: "http", status: 403, shouldRetry: true }],
  ["429", json("{}", 429), { kind: "http", status: 429, shouldRetry: true }],
  ["502", json("{}", 502), { kind: "http", status: 502, shouldRetry: true }],
  ["network error", new TypeError("Failed to fetch"), { kind: "network" }],
  ["invalid JSON", json("{not json"), { kind: "invalid" }],
  ["an empty thread", json('{"status":"success","entries":[],"has_next_page":false}'), { kind: "invalid" }],
] as const)
  test(`perplexity own read page: ${label} is reported once and never reaches the history reader`, async () => {
    const world = perplexityWorld({ responses: [response as Response | Error] });
    assert.deepEqual(await world.ask(), outcome);
    assert.equal(world.fetches.length, 1, "no retry");
    assert.equal(world.observed.length, 0);
  });

test("perplexity own read page: the page's own thread read stops a running read and prevents the next", async () => {
  let release!: (response: Response) => void;
  const world = perplexityWorld({
    responses: [new Promise<Response>((resolve) => (release = resolve))],
  });
  const answer = world.ask();
  await tick();
  const signal = world.fetches[0]!.init.signal!;
  world.page.pageRead(
    new URL(`https://www.perplexity.ai/rest/thread/${THREAD}?version=2.18&limit=10`),
    "GET",
  );
  assert.equal(signal.aborted, true);
  release(json(PAGE));
  assert.deepEqual(await answer, { kind: "page_read" });
  assert.equal(world.observed.length, 0);
  assert.deepEqual(await world.ask(), { kind: "page_read" });
  assert.equal(world.fetches.length, 1);
});

test("perplexity own read page: a page read of another thread does not count; a hidden tab is declined", async () => {
  const world = perplexityWorld({ responses: [json(PAGE)] });
  world.page.pageRead(new URL(`https://www.perplexity.ai/rest/thread/${OTHER}`), "GET");
  assert.deepEqual(await world.ask(), { kind: "read" });
  const hidden = perplexityWorld({ visible: false });
  assert.deepEqual(await hidden.ask(), { kind: "declined" });
  assert.equal(hidden.fetches.length, 0);
});
