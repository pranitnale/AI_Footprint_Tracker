import { after, test as base } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OWN_READ_CHANNEL, type OwnReadSite } from "../lib/own-read";
import { installCapture } from "../lib/capture-runtime";
import { HISTORY_CAPTURE_CHANNEL } from "../lib/history-capture";
import { askOverLink, closePorts, connectPage, json, ORIGINS } from "./own-read-fixture";

after(closePorts);

const test = (name: string, fn: () => unknown) =>
  base(name, { timeout: 10_000 }, fn as () => Promise<void>);

// The installed page capture for each provider: the tracker's own read reaches the same
// history reader as the page's read. Ids, values and text are synthetic.

class PageWindow extends EventTarget {
  messages: any[] = [];
  WebSocket: any = class extends EventTarget {};
  WIZ_global_data = {
    cfb2h: "boq_synthetic_20261012.00_p0",
    FdrFJe: "-1234567890",
    SNlM0e: "synthetic-token:1",
  };
  constructor(public fetch: typeof globalThis.fetch) {
    super();
  }
  postMessage(value: any, _origin?: string, transfer?: MessagePort[]) {
    this.messages.push(value);
    // The content script accepts each batch of a saved chat.
    if (transfer?.[0]) {
      transfer[0].postMessage({ accepted: true });
      transfer[0].close();
    }
  }
}

async function until(predicate: () => boolean) {
  for (let i = 0; i < 400 && !predicate(); i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(predicate());
}

function installPage(
  site: OwnReadSite,
  pathname: string,
  conversationId: string,
  answer: (input: string, init?: RequestInit) => Response,
) {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const win = new PageWindow(((input: string | Request, init?: RequestInit) => {
    const address = input instanceof Request ? input.url : String(input);
    calls.push({ input: address, init });
    return Promise.resolve(answer(address, init));
  }) as typeof fetch);
  const origin = ORIGINS[site];
  Object.assign(globalThis, {
    window: win,
    location: {
      origin,
      hostname: new URL(origin).hostname,
      pathname,
      href: origin + pathname,
    },
  });
  installCapture();
  const link = connectPage(win, origin);
  const ask = () => askOverLink(link, { site, conversationId });
  const starts = () =>
    win.messages.filter(
      (m) =>
        m?.channel === HISTORY_CAPTURE_CHANNEL &&
        m.event === "start" &&
        m.conversationId === conversationId,
    );
  const finishes = () => win.messages.filter((m) => m?.event === "finish");
  const problems = () =>
    win.messages.filter((m) => m?.event === "error" || m?.event === "failed" || m?.reason);
  return { win, calls, ask, starts, finishes, problems };
}

const fixture = (name: string) =>
  readFileSync(
    new URL(`../../../fixtures/history-observation-2026-09-14/${name}`, import.meta.url),
    "utf8",
  );

test("own read capture: Gemini's answer takes the page's history path", async () => {
  const page = installPage(
    "gemini",
    "/u/3/app/0000000000000042",
    "c_0000000000000042",
    () => new Response(fixture("gemini-history-wire.txt")),
  );
  try {
    assert.deepEqual(await page.ask(), { kind: "read" });
    assert.equal(page.calls.length, 1);
    assert.match(page.calls[0]!.input, /^https:\/\/gemini\.google\.com\/u\/3\/_\/BardChatUi\/data\/batchexecute\?rpcids=hNvQHb&/);
    await until(() => page.finishes().length > 0);
    assert.equal(page.starts().length, 1);
    assert.deepEqual(page.problems(), []);
  } finally {
    page.win.dispatchEvent(new Event("pagehide"));
  }
});

test("own read capture: Perplexity's answer reaches its thread reader with the stored account", async () => {
  const thread = "00000000-0000-4000-8000-000000000042";
  const account = "00000000-0000-4000-8000-0000000000cc";
  class FakeStorage {
    getItem(key: string) {
      return key === "pplx-last-active-account" ? `"${account}"` : null;
    }
  }
  Object.assign(globalThis, { Storage: FakeStorage });
  const page = installPage(
    "perplexity",
    `/search/${thread}`,
    thread,
    () => json(fixture("perplexity-workflow-page.json")),
  );
  Object.assign(page.win, { localStorage: new FakeStorage() });
  try {
    assert.deepEqual(await page.ask(), { kind: "read" });
    assert.equal(page.calls.length, 1);
    assert.equal(new URL(page.calls[0]!.input).pathname, `/rest/thread/${thread}`);
    assert.equal(
      (page.calls[0]!.init?.headers as Record<string, string>)["x-pplx-account"],
      account,
    );
    await until(() =>
      page.win.messages.some((m) => m?.threadId === thread && m.event === "start"),
    );
  } finally {
    page.win.dispatchEvent(new Event("pagehide"));
    delete (globalThis as { Storage?: unknown }).Storage;
  }
});

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const chatgptRow = (n: number, role: string) => ({
  id: uid(n),
  author: { role },
  create_time: 1767261600 + n,
  update_time: role === "assistant" ? 1767261600 + n + 0.5 : null,
  content: { content_type: "text", parts: [role === "system" ? "" : `Synthetic ${role} ${n}`] },
  status: "finished_successfully",
  end_turn: role === "assistant" ? true : null,
  weight: 1,
  metadata: {
    request_id: uid(9000 + Math.ceil(n / 2)),
    ...(role === "system" ? { is_visually_hidden_from_conversation: true } : {}),
    ...(role === "assistant"
      ? { is_complete: true, model_slug: "gpt-5-6", resolved_model_slug: "gpt-5-6" }
      : {}),
  },
  recipient: "all",
  channel: role === "assistant" ? "final" : null,
});
const pageInfo = (rows: any[], previous: boolean, next: boolean) => ({
  start_cursor: rows[0].id,
  end_cursor: rows.at(-1).id,
  has_previous_page: previous,
  has_next_page: next,
});

test("own read capture: ChatGPT's newest and earlier pages take the page's history path", async () => {
  const chat = uid(77);
  const newest = [chatgptRow(4, "user"), chatgptRow(5, "assistant")];
  const earlier = [chatgptRow(1, "system"), chatgptRow(2, "user"), chatgptRow(3, "assistant")];
  const page = installPage("chatgpt", `/c/${chat}`, chat, (input) => {
    if (input.endsWith("/api/auth/session"))
      return json(JSON.stringify({ accessToken: "synthetic.token", account: { id: uid(88) } }));
    if (input.includes("/messages?before="))
      return json(
        JSON.stringify({
          messages: earlier,
          safe_urls: [],
          blocked_urls: [],
          page_info: pageInfo(earlier, false, true),
        }),
      );
    return json(
      JSON.stringify({
        conversation_id: chat,
        conversation_origin: null,
        messages: newest,
        current_node: newest.at(-1)!.id,
        page_info: pageInfo(newest, true, false),
        context_truncation_continuation: null,
      }),
    );
  });
  // The earlier page follows after 3 to 6 s; this test skips the wait.
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((run: () => void, ms?: number) =>
    realSetTimeout(run, ms !== undefined && ms >= 3000 && ms < 6000 ? 0 : ms)) as typeof setTimeout;
  try {
    assert.deepEqual(await page.ask(), { kind: "read" });
    assert.deepEqual(
      page.calls.map(({ input }) => new URL(input).pathname),
      [
        "/api/auth/session",
        `/backend-api/conversations/${chat}`,
        `/backend-api/conversations/${chat}/messages`,
      ],
    );
    await until(() => page.finishes().length >= 2);
    assert.equal(page.starts().length, 2);
    // The session answer never reaches the history reader.
    assert.doesNotMatch(JSON.stringify(page.win.messages), /synthetic\.token/);
  } finally {
    globalThis.setTimeout = realSetTimeout;
    page.win.dispatchEvent(new Event("pagehide"));
  }
});

test("own read capture: NotebookLM's session list and turns take the page's history path", async () => {
  const notebook = "f0000000-0000-4000-8000-0000000000a1";
  const earlierNotebook = "f0000000-0000-4000-8000-0000000000b2";
  const session = "11111111-1111-4111-8111-111111111111";
  const context = [2, null, null, [1, null, null, null, null, null, null, null, null, null, [1]], [[1, 4, 8]]];
  const line = (rows: unknown[]) => {
    const text = JSON.stringify(rows);
    return `${text.length + 2}\n${text}\n`;
  };
  const wire = (rpc: string, payload: unknown) =>
    ")]}'\n\n" + line([["wrb.fr", rpc, JSON.stringify(payload), null, null, null, "generic"]]);
  const time = (n: number) => [Math.floor(Date.now() / 1000) - 3600 + n, 0];
  const turn = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const turns = [
    [turn(2), time(2), 2, null, [["Answer.", null, [], null, [null, null, null, null, 1]], [[["a passage"]]], null, [["One?"]]], 2],
    [turn(1), time(1), 1, "Question?", null, 2],
  ];
  const answer = (input: string) =>
    new Response(
      new URL(input).searchParams.get("rpcids") === "hPTbtc"
        ? wire("hPTbtc", [[[session, time(0), time(1)]]])
        : wire("khqZz", [turns]),
    );
  const page = installPage("notebooklm", `/notebook/${notebook}`, notebook, answer);
  const body = (rpc: string, args: unknown[]) =>
    new URLSearchParams({
      "f.req": JSON.stringify([[[rpc, JSON.stringify(args), null, "generic"]]]),
      at: "synthetic",
    }).toString();
  const batch = (rpc: string) =>
    `https://notebook.google.com/_/LabsTailwindUi/data/batchexecute?rpcids=${rpc}&source-path=${encodeURIComponent(`/notebook/${earlierNotebook}`)}&authuser=3&rt=c`;
  try {
    // The page opened another notebook earlier in this tab and read its chat by fetch:
    // with the body in the second argument, and since 19 Oct 2026 as a Request built
    // with its body. Either way the tracker learns the page's request.
    await page.win.fetch(batch("hPTbtc"), { method: "POST", body: body("hPTbtc", [earlierNotebook, [2]]) });
    await page.win.fetch(batch("khqZz"), { method: "POST", body: body("khqZz", [context, null, null, session, 20]) });
    await assertOwnRead(page);
  } finally {
    page.win.dispatchEvent(new Event("pagehide"));
  }
  const requestPage = installPage("notebooklm", `/notebook/${notebook}`, notebook, answer);
  try {
    await requestPage.win.fetch(
      new Request(batch("hPTbtc"), { method: "POST", body: body("hPTbtc", [earlierNotebook, [2]]) }),
    );
    await requestPage.win.fetch(
      new Request(batch("khqZz"), { method: "POST", body: body("khqZz", [context, null, null, session, 20]) }),
    );
    // The body is read from a clone of the page's request, after the page's call.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await assertOwnRead(requestPage);
  } finally {
    requestPage.win.dispatchEvent(new Event("pagehide"));
  }
});

/** The tracker's read of the notebook copies the page's earlier requests and is read. */
async function assertOwnRead(page: ReturnType<typeof installPage>) {
  const before = page.calls.length;
  assert.deepEqual(await page.ask(), { kind: "read" });
  const own = page.calls.slice(before);
  assert.deepEqual(
    own.map(({ input }) => new URL(input).searchParams.get("rpcids")),
    ["hPTbtc", "khqZz"],
  );
  assert.ok(own.every(({ input }) => new URL(input).searchParams.get("authuser") === "3"));
  await until(() => page.finishes().length >= 1);
  assert.ok(page.starts().length >= 1);
}

test("own read capture: a Cowork session's events take the page's Cowork reader", async () => {
  const session = "cse_0123456789ABCDEFghijklmn";
  const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
  const envelope = (sequence: number, payload: unknown) => ({
    event_id: id(1000 + sequence),
    sequence_num: String(sequence),
    event_type: "client_event",
    source: "server",
    payload,
    created_at: `2026-10-14T10:00:0${sequence}.000Z`,
  });
  const body = JSON.stringify({
    data: [
      envelope(1, { type: "system", subtype: "init", model: "claude-sonnet-5-5" }),
      envelope(2, {
        type: "user",
        uuid: id(2),
        parent_tool_use_id: null,
        message: { role: "user", content: [{ type: "text", text: "synthetic prompt" }] },
      }),
      envelope(3, {
        type: "result",
        subtype: "success",
        uuid: id(3),
        user_message_uuids: [id(2)],
        duration_api_ms: 1200,
        result: "synthetic answer",
        modelUsage: { "claude-sonnet-5-5": { outputTokens: 4, inputTokens: 5 } },
      }),
    ],
    resume_cursor: null,
  });
  const page = installPage("claude", `/cowork/${session}`, session, () => json(body));
  try {
    assert.deepEqual(await page.ask(), { kind: "read" });
    assert.deepEqual(page.calls.map(({ input }) => input), [
      `https://claude.ai/v1/code/sessions/${session}/events?limit=500&sort_order=asc`,
    ]);
    assert.deepEqual(page.calls[0]!.init?.headers, { "anthropic-version": "2023-06-01" });
    const emitted = () =>
      page.win.messages.find((m) => m?.event === "page" && m.conversationId === session);
    await until(() => !!emitted());
    assert.equal(emitted().page.firstRequestVerified, true);
  } finally {
    page.win.dispatchEvent(new Event("pagehide"));
  }
});
