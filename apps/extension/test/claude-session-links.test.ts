import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Ledger } from "@footprint/ledger";
import type { CountRequest } from "@footprint/tokenizers";
import { Coordinator } from "../lib/coordinator";
import {
  CLAUDE_LINK_CHANNEL,
  CLAUDE_LINKS_KEPT,
  CLAUDE_LINKS_KEY,
  CLAUDE_RESEARCH_SETTLED_MS,
  createClaudeLinkStore,
  createClaudeSessionLinks,
  validateClaudeLinkFacts,
  type ClaudeLinkFacts,
} from "../lib/claude-session-links";
import { memoryKeyValueArea } from "../lib/chatgpt-read-progress";
import {
  HISTORY_CAPTURE_CHANNEL,
  validateHistoryCapture,
  type HistoryCaptureMessage,
} from "../lib/history-capture";
import { savedCompanyId } from "../lib/company-identity";
import { historyPage } from "./history-fixture";
import { createHistoryTextObserver } from "../lib/passive-history-text";
import { countByTextLength } from "./counting-fixture";

// Synthetic answers in the shapes seen on 18 and 22 Nov 2026 (structure only).
const ORIGIN = "https://claude.ai";
const ORG = "7b7d8ded-0000-4000-8000-000000000001";
const SESSION = "cse_0123456789ABCDEFghijklmn";
const OTHER = "cse_ZYXWVUTSRQPONMLKjihgfedc";
const SONNET = "claude-sonnet-5-5";
const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const CHAT = id(0xc1);
const OTHER_CHAT = id(0xc2);
const NONCE = "11111111-2222-4333-8444-555555555555";
const TOTALS = { output: 581, input: 12, cacheRead: 150000, cacheWrite: 3000 };
const listUrl = () =>
  new URL(
    `${ORIGIN}/api/organizations/${ORG}/chat_conversations_v2?limit=30&offset=0`,
  );
const sessionUrl = (session = SESSION) =>
  new URL(`${ORIGIN}/v1/code/sessions/${session}?omit_bound_device=true`);
const eventsUrl = (session = SESSION) =>
  new URL(
    `${ORIGIN}/v1/code/sessions/${session}/events?limit=500&sort_order=asc`,
  );
const sessionObject = (chat: string | null = CHAT) => ({
  response_shape: {
    id: SESSION,
    tags: ["cowork-remote", ...(chat ? [`bard-conversation:${chat}`] : [])],
    external_metadata: {
      usage: {
        input_tokens: TOTALS.input,
        output_tokens: TOTALS.output,
        cache_read_tokens: TOTALS.cacheRead,
        cache_write_tokens: TOTALS.cacheWrite,
      },
    },
  },
});
const json = (value: unknown) =>
  Promise.resolve(new Response(JSON.stringify(value)));
const envelope = (sequence: number, payload: unknown) => ({
  event_id: crypto.randomUUID(),
  sequence_num: String(sequence),
  event_type: "client_event",
  source: "server",
  payload,
  created_at: `2026-11-18T10:00:${String(sequence % 60).padStart(2, "0")}.000Z`,
});
/** `turn`: more keys of the user event; `later`: events after the first result. */
const events = (turn: object = {}, later: unknown[] = []) => ({
  data: [
    envelope(1, { type: "system", subtype: "init", model: SONNET }),
    envelope(2, {
      type: "user",
      uuid: id(2),
      parent_tool_use_id: null,
      message: { role: "user", content: [{ type: "text", text: "synthetic prompt" }] },
      ...turn,
    }),
    envelope(3, {
      type: "result",
      subtype: "success",
      uuid: id(3),
      user_message_uuids: [id(2)],
      duration_api_ms: 2924,
      result: "synthetic answer",
      modelUsage: { [SONNET]: { outputTokens: 247, thinkingTokens: 0 } },
    }),
    ...later,
  ],
});
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
const facts = (value: Partial<ClaudeLinkFacts>) => ({
  channel: CLAUDE_LINK_CHANNEL,
  nonce: NONCE,
  links: [],
  totals: null,
  ...value,
});

test("link facts: only the exact shape with the content script's nonce is taken", () => {
  const link = { chat: CHAT, session: SESSION };
  const totals = { session: SESSION, ...TOTALS };
  assert.equal(validateClaudeLinkFacts(facts({ links: [link] }), NONCE), true);
  assert.equal(validateClaudeLinkFacts(facts({ totals }), NONCE), true);
  assert.equal(
    validateClaudeLinkFacts(
      facts({ links: [link], totals: { ...totals, input: null } }),
      NONCE,
    ),
    true,
  );
  for (const value of [
    facts({ links: [link], nonce: "another-nonce" }),
    // Nothing to say is not a message.
    facts({}),
    facts({ links: [{ chat: SESSION, session: SESSION }] }),
    facts({ links: [{ chat: CHAT, session: CHAT }] }),
    facts({ links: [{ ...link, title: "a chat title" } as any] }),
    facts({ links: Array(CLAUDE_LINKS_KEPT + 1).fill(link) }),
    facts({ totals: { ...totals, output: -1 } }),
    facts({ totals: { ...totals, session: CHAT } }),
    facts({ totals: { ...totals, cost: 1 } as any }),
    { ...facts({ links: [link] }), text: "hello" },
    { ...facts({ links: [link] }), channel: "ai-footprint-cowork-sent-v1" },
    null,
    "facts",
  ])
    assert.equal(validateClaudeLinkFacts(value, NONCE), false, JSON.stringify(value));
});

test("page links: the page's chat list and session object are posted as link facts; other requests are left alone", async () => {
  at(`/chat/${CHAT}`);
  const posted: Array<Pick<ClaudeLinkFacts, "links" | "totals">> = [];
  const links = createClaudeSessionLinks((message) => {
    posted.push(structuredClone(message));
    return true;
  }, natives);
  links.observe(
    listUrl(),
    "GET",
    json([
      { uuid: CHAT, workspace_upgraded: true, workspace_session_id: SESSION },
      { uuid: id(0xc3), workspace_upgraded: false },
    ]),
  );
  await until(() => posted.length === 1);
  assert.deepEqual(posted[0], {
    links: [{ chat: CHAT, session: SESSION }],
    totals: null,
  });
  links.observe(sessionUrl(), "GET", json(sessionObject()));
  await until(() => posted.length === 2);
  assert.deepEqual(posted[1], {
    links: [{ chat: CHAT, session: SESSION }],
    totals: { session: SESSION, ...TOTALS },
  });
  // A session without the chat's tag gives its totals and no link.
  links.observe(
    sessionUrl(OTHER),
    "GET",
    json({ id: OTHER, tags: ["cowork-remote"], external_metadata: { usage: { output_tokens: 63 } } }),
  );
  await until(() => posted.length === 3);
  assert.deepEqual(posted[2], {
    links: [],
    totals: { session: OTHER, output: 63, input: null, cacheRead: null, cacheWrite: null },
  });
  // Events, sends, failed answers and unreadable bodies say nothing.
  links.observe(eventsUrl(), "GET", json(events()));
  links.observe(sessionUrl(), "POST", json(sessionObject()));
  links.observe(sessionUrl(), "GET", Promise.resolve(new Response("{}", { status: 404 })));
  links.observe(sessionUrl(), "GET", Promise.resolve(new Response("not json")));
  links.observe(sessionUrl(), "GET", Promise.reject(new Error("offline")));
  links.observe(sessionUrl(), "GET", null);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(posted.length, 3);
});

test("page links: a session is shown at the address of the chat a proof links it to, and nowhere else", async () => {
  const links = createClaudeSessionLinks(() => true, natives);
  at(`/chat/${CHAT}`);
  // The session's own address always shows it; a chat address only once a proof was seen.
  assert.equal(links.shows(`/cowork/${SESSION}`, SESSION), true);
  assert.equal(links.shows(`/chat/${CHAT}`, SESSION), false);
  // A session object without the chat's tag proves nothing, even while the chat is shown.
  links.observe(sessionUrl(), "GET", json(sessionObject(null)));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(links.shows(`/chat/${CHAT}`, SESSION), false);
  links.observe(sessionUrl(), "GET", json(sessionObject()));
  await until(() => links.shows(`/chat/${CHAT}`, SESSION));
  assert.equal(links.shows(`/chat/${CHAT}`, OTHER), false);
  assert.equal(links.shows(`/chat/${OTHER_CHAT}`, SESSION), false);
  assert.equal(links.shows("/new", SESSION), false);
  assert.equal(links.shows(`/chat/${CHAT}`, CHAT), true);
});

// A Cowork session from before the merge is linked by the page's own ReadCoworkSession call
// when it is opened from the list; after a reload only the content script's word, which the
// background's kept link backs, shows it at its chat address again.
test("page links: a ReadCoworkSession call links an old Cowork session, and the content script's word does after a reload", async () => {
  at(`/cowork/${SESSION}`);
  const address = "8ee80eda-0000-8000-8000-0000000000c8";
  const ascii = (text: string) => [...text].map((letter) => letter.charCodeAt(0));
  const request = new Uint8Array([0x0a, SESSION.length, ...ascii(SESSION), 0x18, 1, 0x20, 1]);
  const answer = () =>
    Promise.resolve(
      new Response(
        new Uint8Array([0x1a, 2, 0x10, 1, 0x22, 38, ...ascii(`c_${address}`), 0x28, 1]),
      ),
    );
  const readUrl = new URL(
    "/claudeai-rpc/anthropic.bard.api.v1alpha.ConversationService/ReadCoworkSession",
    ORIGIN,
  );
  const posted: Array<Pick<ClaudeLinkFacts, "links" | "totals">> = [];
  const links = createClaudeSessionLinks((message) => {
    posted.push(structuredClone(message));
    return true;
  }, natives);
  // A request whose body is not bytes names no session.
  links.observe(readUrl, "POST", answer(), "not bytes");
  links.observe(readUrl, "POST", answer());
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(posted.length, 0);
  links.observe(readUrl, "POST", answer(), request);
  await until(() => posted.length === 1);
  assert.deepEqual(posted[0], { links: [{ chat: address, session: SESSION }], totals: null });
  assert.equal(links.shows(`/chat/${address}`, SESSION), true);
  // After a reload nothing is proven; the content script's read request vouches for the link.
  const reloaded = createClaudeSessionLinks(() => true, natives);
  assert.equal(reloaded.shows(`/chat/${address}`, SESSION), false);
  reloaded.trust(`/chat/${address}`, CHAT);
  reloaded.trust(`/cowork/${OTHER}`, SESSION);
  assert.equal(reloaded.shows(`/chat/${address}`, SESSION), false);
  reloaded.trust(`/chat/${address}`, SESSION);
  assert.equal(reloaded.shows(`/chat/${address}`, SESSION), true);
  assert.equal(reloaded.shows(`/chat/${CHAT}`, SESSION), false);
});

test("page links: facts the content script could not be told yet are announced once it introduces itself", async () => {
  at(`/chat/${CHAT}`);
  let listening = false;
  const posted: Array<Pick<ClaudeLinkFacts, "links" | "totals">> = [];
  const links = createClaudeSessionLinks((message) => {
    if (listening) posted.push(structuredClone(message));
    return listening;
  }, natives);
  links.observe(sessionUrl(), "GET", json(sessionObject()));
  await until(() => links.shows(`/chat/${CHAT}`, SESSION));
  assert.equal(posted.length, 0);
  listening = true;
  links.announce();
  assert.deepEqual(posted, [
    { links: [{ chat: CHAT, session: SESSION }], totals: null },
    { links: [], totals: { session: SESSION, ...TOTALS } },
  ]);
});

test("link store: kept per namespace and chat, totals survive a list row, erased with the namespace", async () => {
  const area = memoryKeyValueArea();
  let now = 1000;
  const store = createClaudeLinkStore(area, () => now++);
  const chat = "a".repeat(64);
  const session = "b".repeat(64);
  const other = "c".repeat(64);
  assert.equal(await store.read("personal:1", chat), null);
  await store.write("personal:1", chat, session, TOTALS);
  assert.deepEqual(await store.read("personal:1", chat), { session, totals: TOTALS });
  // A list row names the link again without totals: the session object's totals stay.
  await store.write("personal:1", chat, session, null);
  assert.deepEqual(await store.read("personal:1", chat), { session, totals: TOTALS });
  // Another session for the chat is a new link; the old session's totals do not carry over.
  await store.write("personal:1", chat, other, null);
  assert.deepEqual(await store.read("personal:1", chat), { session: other, totals: null });
  // Another namespace finds nothing, and its erase leaves this one alone.
  assert.equal(await store.read("personal:2", chat), null);
  await store.erase("personal:2");
  assert.notEqual(await store.read("personal:1", chat), null);
  // Keyed identities and counts only.
  await assert.rejects(store.write("personal:1", CHAT, session, null), /payload_rejected/);
  await assert.rejects(store.write("personal:1", chat, SESSION, null), /payload_rejected/);
  await assert.rejects(
    store.write("personal:1", chat, session, { ...TOTALS, output: -1 }),
    /payload_rejected/,
  );
  await store.erase("personal:1");
  assert.equal(await store.read("personal:1", chat), null);
  assert.equal(area.values.has(CLAUDE_LINKS_KEY), false);
  // A stored value of another shape reads as nothing.
  area.values.set(CLAUDE_LINKS_KEY, { namespace: "personal:1", chats: { [chat]: { session } } });
  assert.equal(await store.read("personal:1", chat), null);
});

test("link store: a session backs one chat, so a later chat's link replaces the earlier one", async () => {
  const store = createClaudeLinkStore(memoryKeyValueArea());
  const [first, second, session] = ["a", "c", "b"].map((letter) => letter.repeat(64));
  await store.write("personal:1", first!, session!, TOTALS);
  await store.write("personal:1", second!, session!, null);
  // The session's pages are admitted at one address only.
  assert.equal(await store.read("personal:1", first!), null);
  assert.deepEqual(await store.read("personal:1", second!), { session, totals: null });
});

// The report of a Research task is written into the chat's saved reply after the session's
// result, for minutes. So the saved copy stays due until it is read an hour or more after the
// launch was counted.
test("link store: a Research launch stays due until the saved copy is read an hour or more after it", async () => {
  const store = createClaudeLinkStore(memoryKeyValueArea());
  const chat = "a".repeat(64);
  const session = "b".repeat(64);
  const read = () => store.read("personal:1", chat);
  // Without a kept link there is nothing to mark.
  await store.research("personal:1", chat, 1000);
  assert.equal(await read(), null);
  await store.write("personal:1", chat, session, TOTALS);
  assert.deepEqual(await read(), { session, totals: TOTALS });
  await store.research("personal:1", chat, 1000);
  assert.deepEqual(await read(), { session, totals: TOTALS, research: 1000 });
  // The link confirmed again keeps the mark; a later launch moves it.
  await store.write("personal:1", chat, session, null);
  assert.equal((await read())!.research, 1000);
  await store.research("personal:1", chat, 5000);
  await store.textRead("personal:1", chat, 5000 + CLAUDE_RESEARCH_SETTLED_MS - 1);
  assert.equal((await read())!.research, 5000);
  await store.textRead("personal:1", chat, 5000 + CLAUDE_RESEARCH_SETTLED_MS);
  assert.deepEqual(await read(), { session, totals: TOTALS });
  // A read of a chat without a mark, or without a link, changes nothing.
  await store.textRead("personal:1", chat, 9e12);
  await store.textRead("personal:1", "c".repeat(64), 9e12);
  assert.deepEqual(await read(), { session, totals: TOTALS });
  // Another session for the chat is a new link without the mark.
  await store.research("personal:1", chat, 7000);
  await store.write("personal:1", chat, "d".repeat(64), null);
  assert.deepEqual(await read(), { session: "d".repeat(64), totals: null });
});

async function tracker(
  t: TestContext,
  kept: { name?: string; storage?: ReturnType<typeof memoryKeyValueArea> } = {},
) {
  const db = await Ledger.open(kept.name ?? `claude-links-${crypto.randomUUID()}`);
  const coordinator = new Coordinator(db, {
    count: async (job: CountRequest) => countByTextLength(job),
    hasConsent: async () => true,
    hasSiteConsent: async () => true,
    sendDisplay: async () => {},
    transport: async () => {
      throw new Error("unexpected network");
    },
    ...(kept.storage ? { progressStorage: kept.storage } : {}),
  });
  await coordinator.whenReady();
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    coordinator.history.invalidate();
    coordinator.engines.dispose();
    db.close();
  };
  t.after(close);
  const binding = () => ({
    documentNonce: crypto.randomUUID(),
    navigationNonce: crypto.randomUUID(),
    captureId: null,
  });
  const sender = (path: string, tab: number) => ({
    tab: { id: tab },
    frameId: 0,
    documentId: `synthetic-document-${tab}`,
    url: ORIGIN + path,
  });
  /** One session page, as the page world reads it at the linked chat's address. */
  const capture = async (list: unknown = events()) => {
    at(`/chat/${CHAT}`);
    const messages: HistoryCaptureMessage[] = [];
    const observer = createHistoryTextObserver((message) =>
      messages.push(structuredClone(message)),
    );
    t.after(() => observer.cancel());
    observer.observe(sessionUrl(), "GET", json(sessionObject()), Date.now());
    await new Promise((resolve) => setTimeout(resolve, 30));
    observer.observe(eventsUrl(), "GET", json(list), Date.now());
    await until(() => messages.length === 2);
    return messages;
  };
  /** Hands the page to the background as a tab at `path` would, naming `linkedRoute`. */
  const read = async (
    path: string,
    tab: number,
    linkedRoute?: string,
    list?: unknown,
  ) => {
    const messages = await capture(list);
    const from = sender(path, tab);
    const tabBinding = binding();
    const outcomes = [];
    for (const message of messages)
      outcomes.push(
        // The page after a refused start is refused before any promise is made.
        await (async () =>
          coordinator.history.receive(
            message,
            tabBinding,
            from,
            undefined,
            linkedRoute,
          ))().catch((error: Error) => error.message),
      );
    await coordinator.engines.maintainLocal();
    return { messages, outcomes };
  };
  /** The chat's saved copy, read by text at the chat's own address: prompt id(1), reply id(2). */
  const text = async (tab: number) => {
    const page = { ...historyPage(), conversationId: CHAT };
    const common = {
      channel: HISTORY_CAPTURE_CHANNEL as typeof HISTORY_CAPTURE_CHANNEL,
      id: crypto.randomUUID(),
      site: "claude" as const,
      conversationId: CHAT,
      observedAt: page.observedAt,
    };
    const from = sender(`/chat/${CHAT}`, tab);
    const tabBinding = binding();
    const outcomes = [
      await coordinator.history.receive(
        { ...common, event: "start", page: null },
        tabBinding,
        from,
      ),
      await coordinator.history.receive(
        { ...common, event: "page", page },
        tabBinding,
        from,
      ),
    ];
    await coordinator.engines.maintainLocal();
    return outcomes;
  };
  return { coordinator, db, capture, read, text, close };
}

test("events of a session shown at its chat's address are read as that session's page", async (t) => {
  const f = await tracker(t);
  await f.coordinator.claudeSessionLink(CHAT, SESSION, TOTALS);
  const { messages, outcomes } = await f.read(`/chat/${CHAT}`, 811, CHAT);
  // The page belongs to the session's own conversation, as on a Cowork address.
  assert.deepEqual(
    messages.map((message) => [message.event, message.conversationId]),
    [
      ["start", SESSION],
      ["page", SESSION],
    ],
  );
  assert.deepEqual(outcomes, [{ accepted: true }, { accepted: true }]);
  const rows = (await f.db.all<any>("history_records")).map((row) => row.record);
  assert.deepEqual(
    rows
      .filter((record) => record.role === "response")
      .map((record) => [record.tokens.value, record.tokens.evidence]),
    [["247", "provider_reported"]],
  );
  assert.equal(new Set(rows.map((record) => record.conversation_key)).size, 1);
  assert.equal((await f.db.all<any>("cowork_checkpoints")).length, 1);
});

test("a session page is accepted on its linked chat route and refused on another", async (t) => {
  const f = await tracker(t);
  // No link kept yet: the page names the chat, but nothing proves the session is its own.
  assert.deepEqual((await f.read(`/chat/${CHAT}`, 821, CHAT)).outcomes[0], "payload_rejected");
  await f.coordinator.claudeSessionLink(CHAT, SESSION, null);
  // Without naming the chat a session's page does not match a chat address.
  assert.deepEqual((await f.read(`/chat/${CHAT}`, 822)).outcomes[0], "payload_rejected");
  // Another chat's address, named truthfully or not.
  assert.deepEqual(
    (await f.read(`/chat/${OTHER_CHAT}`, 823, OTHER_CHAT)).outcomes[0],
    "payload_rejected",
  );
  assert.deepEqual(
    (await f.read(`/chat/${OTHER_CHAT}`, 824, CHAT)).outcomes[0],
    "payload_rejected",
  );
  // Another session kept for the chat.
  await f.coordinator.claudeSessionLink(CHAT, OTHER, null);
  assert.deepEqual((await f.read(`/chat/${CHAT}`, 825, CHAT)).outcomes[0], "payload_rejected");
  assert.equal((await f.db.all<any>("history_records")).length, 0);
  await f.coordinator.claudeSessionLink(CHAT, SESSION, null);
  assert.deepEqual((await f.read(`/chat/${CHAT}`, 826, CHAT)).outcomes, [
    { accepted: true },
    { accepted: true },
  ]);
});

// The background's service worker stops when idle. The link is kept in the extension's own
// storage, so the next worker admits the session's pages without a new proof from the page.
test("a kept link still admits the session's page after the background restarted", async (t) => {
  const kept = {
    name: `claude-links-${crypto.randomUUID()}`,
    storage: memoryKeyValueArea(),
  };
  const first = await tracker(t, kept);
  await first.coordinator.claudeSessionLink(CHAT, SESSION, TOTALS);
  first.close();
  const second = await tracker(t, kept);
  assert.deepEqual((await second.read(`/chat/${CHAT}`, 841, CHAT)).outcomes, [
    { accepted: true },
    { accepted: true },
  ]);
});

test("a kept link takes ids of the right kinds only, and a full erase removes it", async (t) => {
  const f = await tracker(t);
  for (const [chat, session, totals] of [
    [SESSION, SESSION, null],
    [CHAT, CHAT, null],
    ["not-a-chat", SESSION, null],
    [CHAT, SESSION, { output: "581" }],
  ] as const)
    await assert.rejects(
      f.coordinator.claudeSessionLink(chat, session, totals),
      /payload_rejected/,
    );
  assert.deepEqual(await f.coordinator.claudeSessionLink(CHAT, SESSION, TOTALS), {
    kept: true,
    after: null,
    counted: null,
    text: false,
  });
  assert.deepEqual((await f.read(`/chat/${CHAT}`, 831, CHAT)).outcomes[0], {
    accepted: true,
  });
  await f.coordinator.clearPersonal();
  assert.deepEqual((await f.read(`/chat/${CHAT}`, 832, CHAT)).outcomes[0], "payload_rejected");
});

// The chat keeps its own conversation; its totals add the rows saved for its session.
test("a linked chat's totals add its session's rows once, and the link answer says what is counted", async (t) => {
  const f = await tracker(t);
  const history = async (chat: string) =>
    ((await f.coordinator.routeSummary("claude", chat)) as any).history.local;
  await f.coordinator.claudeSessionLink(CHAT, SESSION, TOTALS);
  assert.equal((await history(CHAT)).response_count, "0");
  assert.deepEqual((await f.read(`/chat/${CHAT}`, 841, CHAT)).outcomes, [
    { accepted: true },
    { accepted: true },
  ]);
  const linked = await history(CHAT);
  assert.deepEqual(
    [linked.prompt_count, linked.response_count, linked.first_request_verified],
    ["1", "1", true],
  );
  // The session read again brings no second copy.
  await f.read(`/chat/${CHAT}`, 842, CHAT);
  assert.equal((await history(CHAT)).response_count, "1");
  // Another chat, and the session's own conversation, are unchanged.
  assert.equal((await history(OTHER_CHAT)).response_count, "0");
  assert.equal(
    ((await f.coordinator.routeSummary("claude", SESSION)) as any).history.local
      .response_count,
    "1",
  );
  // The position of the counted result and the output counted up to it: Claude's own total
  // is 581 here, so the page would read on from event 3.
  assert.deepEqual(await f.coordinator.claudeSessionLink(CHAT, SESSION, TOTALS), {
    kept: true,
    after: 3,
    counted: 247,
    text: true,
  });
  // A link to another session no longer adds these rows.
  await f.coordinator.claudeSessionLink(CHAT, OTHER, null);
  assert.equal((await history(CHAT)).response_count, "0");
});

// The chat's saved copy was counted by text, as the 0.1.0 build does and as happens before a
// link is known. The session's exact rows of the same turn replace those text rows, once.
test("text rows of a session-backed chat are replaced once by the exact rows that name them", async (t) => {
  const f = await tracker(t);
  const accepted = [{ accepted: true }, { accepted: true }];
  const counts = async () => {
    const local = ((await f.coordinator.routeSummary("claude", CHAT)) as any).history
      .local;
    return [local.prompt_count, local.response_count];
  };
  const rows = async () =>
    (await f.db.all<any>("history_records")).map((row) => row.record);
  const turn = { bard_message_id: id(1), bard_assistant_message_id: id(2) };
  assert.deepEqual(await f.text(851), accepted);
  assert.deepEqual(await counts(), ["1", "1"]);
  const textKeys = (await rows()).map((record) => record.message_key).sort();
  await f.coordinator.claudeSessionLink(CHAT, SESSION, TOTALS);
  const exact = await f.read(`/chat/${CHAT}`, 852, CHAT, events(turn));
  assert.deepEqual(exact.outcomes, accepted);
  // The turn counts once, and what is left are the session's rows.
  assert.deepEqual(await counts(), ["1", "1"]);
  const kept = await rows();
  assert.equal(kept.length, 2);
  assert.ok(kept.every((record) => !textKeys.includes(record.message_key)));
  // The saved copy read again, and the session read again: nothing comes back or doubles.
  assert.deepEqual(await f.text(853), accepted);
  await f.read(`/chat/${CHAT}`, 854, CHAT, events(turn));
  assert.deepEqual(await counts(), ["1", "1"]);
  assert.equal((await rows()).length, 2);
  // A full erase is a clean slate: the saved copy counts by text again.
  await f.coordinator.clearPersonal();
  assert.deepEqual(await f.text(855), accepted);
  assert.deepEqual(await counts(), ["1", "1"]);
  assert.equal((await rows()).length, 2);
});

test("only a session's event page names the saved messages a turn stands for, as two different ids", async (t) => {
  const f = await tracker(t);
  const turn = { bard_message_id: id(1), bard_assistant_message_id: id(2) };
  const page = (await f.capture(events(turn)))[1]! as any;
  assert.deepEqual(
    page.page.messages.map((message: any) => message.chat),
    [
      { prompt: id(1), reply: id(2) },
      { prompt: id(1), reply: id(2) },
    ],
  );
  assert.equal(validateHistoryCapture(page, "claude.ai"), true);
  for (const chat of [
    { prompt: id(1), reply: id(1) },
    { prompt: id(1), reply: id(2), more: 1 },
    { prompt: id(1) },
    { prompt: "bmsg_0123456789abcdef", reply: id(2) },
    null,
  ]) {
    const changed = structuredClone(page);
    changed.page.messages[0].chat = chat;
    assert.equal(validateHistoryCapture(changed, "claude.ai"), false, JSON.stringify(chat));
  }
  // A page of the chat's own saved copy never names one.
  const saved = { ...historyPage(), conversationId: CHAT };
  const text = {
    ...page,
    conversationId: CHAT,
    observedAt: saved.observedAt,
    page: saved,
  } as any;
  assert.equal(validateHistoryCapture(text, "claude.ai"), true);
  text.page.messages[0].chat = { prompt: id(1), reply: id(2) };
  assert.equal(validateHistoryCapture(text, "claude.ai"), false);
});

test("a turn that names no saved message replaces nothing", async (t) => {
  const f = await tracker(t);
  const rows = async () => (await f.db.all<any>("history_records")).length;
  await f.text(861);
  await f.coordinator.claudeSessionLink(CHAT, SESSION, TOTALS);
  // The turn names no saved message: both parts are saved.
  await f.read(`/chat/${CHAT}`, 862, CHAT);
  assert.equal(await rows(), 4);
});

test("a chat turn's exact rows take the company keys of the saved messages they replace", () => {
  const chat = { prompt: id(1), reply: id(2) };
  const row = (role: "prompt" | "response", sourceId: string) => ({
    role,
    sourceId,
    requestId: null,
    liveAttemptId: null,
  });
  assert.deepEqual(
    savedCompanyId("claude", true, { ...row("prompt", id(12)), chat }),
    savedCompanyId("claude", false, row("prompt", id(1))),
  );
  // The chat's text reader names a saved reply as its own live attempt
  // (packages/adapters/src/history/claude.ts), so the exact reply gets a key of that kind.
  assert.deepEqual(
    savedCompanyId("claude", true, { ...row("response", id(13)), chat }),
    savedCompanyId("claude", false, { ...row("response", id(2)), liveAttemptId: id(2) }),
  );
  assert.deepEqual(savedCompanyId("claude", true, { ...row("response", id(13)), chat }), {
    kind: "company-attempt",
    id: id(2),
  });
  // A Cowork result that stands for no chat message gets no key, as before.
  assert.equal(savedCompanyId("claude", true, row("response", id(13))), null);
  assert.equal(savedCompanyId("claude", true, row("prompt", id(12))), null);
});

// A full erase is a clean slate: the link, the rows and what was counted of the session are
// gone, so the link is reported again and the session is read and counted from its first event.
test("after a full erase the session is linked, read and counted again", async (t) => {
  const f = await tracker(t);
  const accepted = [{ accepted: true }, { accepted: true }];
  const link = () => f.coordinator.claudeSessionLink(CHAT, SESSION, TOTALS);
  const replies = async () =>
    (await f.db.all<any>("history_records"))
      .map((row) => row.record)
      .filter((record) => record.role === "response")
      .map((record) => record.tokens.value);
  await link();
  assert.deepEqual((await f.read(`/chat/${CHAT}`, 861, CHAT)).outcomes, accepted);
  const before = await link();
  assert.ok(before.kept && before.after !== null && before.counted === 247);
  await f.coordinator.clearPersonal();
  // Without a new report the session's page is no longer admitted (tested above); with it,
  // nothing is counted yet.
  assert.deepEqual(await link(), { kept: true, after: null, counted: null, text: false });
  assert.deepEqual((await f.read(`/chat/${CHAT}`, 862, CHAT)).outcomes, accepted);
  assert.deepEqual(await link(), before);
  assert.deepEqual(await replies(), ["247"]);
});

// Chief's check of 22 Nov 2026: a range erasure removes saved rows but leaves the session's
// checkpoint. The next turn must still count its own tokens, not the erased ones again.
test("a turn after a range erasure counts its own tokens", async (t) => {
  const f = await tracker(t);
  const replies = async () =>
    (await f.db.all<any>("history_records"))
      .map((row) => row.record)
      .filter((record) => record.role === "response")
      .map((record) => record.tokens.value);
  await f.coordinator.claudeSessionLink(CHAT, SESSION, TOTALS);
  await f.read(`/chat/${CHAT}`, 871, CHAT);
  assert.deepEqual(await replies(), ["247"]);
  const scope = await (f.coordinator as any).currentScope();
  await f.db.applyRange(scope, null, null, 1);
  assert.deepEqual(await replies(), []);
  // A later read is observed after the erasure.
  await new Promise((resolve) => setTimeout(resolve, 20));
  const second = [
    envelope(4, {
      type: "user",
      uuid: id(4),
      parent_tool_use_id: null,
      message: { role: "user", content: [{ type: "text", text: "synthetic second prompt" }] },
    }),
    envelope(5, {
      type: "result",
      subtype: "success",
      uuid: id(5),
      user_message_uuids: [id(4)],
      duration_api_ms: 4000,
      result: "synthetic second answer",
      modelUsage: { [SONNET]: { outputTokens: 300, thinkingTokens: 0 } },
    }),
  ];
  await f.read(`/chat/${CHAT}`, 872, CHAT, events({}, second));
  assert.deepEqual(await replies(), ["53"]);
});

// A chat Claude moved into a session later holds earlier turns only in its saved copy. The
// link answer asks for one text read of it once the session is counted; a new chat, whose
// session starts with the chat's first message, never gets that read.
test("a chat whose session does not start it asks for one text read of its saved copy", async (t) => {
  const moved = await tracker(t);
  const text = async (f: typeof moved) =>
    ((await f.coordinator.claudeSessionLink(CHAT, SESSION, TOTALS)) as any).text;
  assert.equal(await text(moved), false, "nothing is asked for before the session is read");
  await moved.read(`/chat/${CHAT}`, 881, CHAT);
  assert.equal(await text(moved), true);
  await moved.text(882);
  assert.equal(await text(moved), false, "the saved copy was read");
  const fresh = await tracker(t);
  await fresh.coordinator.claudeSessionLink(CHAT, SESSION, TOTALS);
  await fresh.read(
    `/chat/${CHAT}`,
    883,
    CHAT,
    events({ bard_message_id: id(1), bard_assistant_message_id: id(2) }),
  );
  assert.equal(await text(fresh), false);
  // The address of a Cowork session from before the merge (a version 8 uuid) has no saved
  // chat, so nothing is asked for.
  const old = await tracker(t);
  const address = "8ee80eda-0000-8000-8000-0000000000c8";
  await old.coordinator.claudeSessionLink(address, SESSION, TOTALS);
  await old.read(`/chat/${address}`, 884, address);
  const answer = await old.coordinator.claudeSessionLink(address, SESSION, TOTALS);
  assert.ok(answer.kept && answer.after !== null && answer.text === false);
});

// Live check of 23 Nov 2026: a chat Claude moved into a session later was read by text from
// its first message, then by its session's events, whose own start could not be proven. The
// chat showed "First message: Not verified". The chat's saved copy read from its first message
// proves the chat's start, whatever the session's events say.
test("a linked chat whose saved copy was read from its first message has a proven start", async (t) => {
  const f = await tracker(t);
  const history = async () =>
    ((await f.coordinator.routeSummary("claude", CHAT)) as any).history.local;
  // The session's first event was not read, so its own start is not proven.
  const later = events();
  later.data.shift();
  await f.coordinator.claudeSessionLink(CHAT, SESSION, TOTALS);
  assert.deepEqual((await f.read(`/chat/${CHAT}`, 911, CHAT, later)).outcomes, [
    { accepted: true },
    { accepted: true },
  ]);
  // The session alone does not prove the chat's start.
  assert.equal((await history()).first_request_verified, false);
  assert.deepEqual(await f.text(912), [{ accepted: true }, { accepted: true }]);
  const linked = await history();
  assert.deepEqual(
    [linked.prompt_count, linked.response_count, linked.first_request_verified],
    ["2", "2", true],
  );
});

// Live check of 23 Nov 2026: a chat backed by its session from its first message, with a
// Research report counted from its saved copy. The copy was read from the first message, but
// the session's exact prompt had replaced that message's text row, so the chat showed "First
// message: Not verified". A first message the session's exact prompt replaced is proven too.
test("a linked chat whose first message the session's exact prompt replaced has a proven start", async (t) => {
  const f = await tracker(t);
  const history = async () =>
    ((await f.coordinator.routeSummary("claude", CHAT)) as any).history.local;
  // The session names the chat's first turn; its own start is not proven.
  const named = events({ bard_message_id: id(1), bard_assistant_message_id: id(2) });
  named.data.shift();
  await f.coordinator.claudeSessionLink(CHAT, SESSION, TOTALS);
  await f.read(`/chat/${CHAT}`, 921, CHAT, named);
  assert.equal((await history()).first_request_verified, false);
  // The saved copy, read from its first message, adds the turn after it (as a Research
  // report is), and its first turn stays counted once, by the session.
  const page = { ...historyPage(4), conversationId: CHAT };
  const common = {
    channel: HISTORY_CAPTURE_CHANNEL as typeof HISTORY_CAPTURE_CHANNEL,
    id: crypto.randomUUID(),
    site: "claude" as const,
    conversationId: CHAT,
    observedAt: page.observedAt,
  };
  const binding = {
    documentNonce: crypto.randomUUID(),
    navigationNonce: crypto.randomUUID(),
    captureId: null,
  };
  const from = {
    tab: { id: 922 },
    frameId: 0,
    documentId: "synthetic-document-922",
    url: `${ORIGIN}/chat/${CHAT}`,
  };
  await f.coordinator.history.receive({ ...common, event: "start", page: null }, binding, from);
  await f.coordinator.history.receive({ ...common, event: "page", page }, binding, from);
  await f.coordinator.engines.maintainLocal();
  const linked = await history();
  assert.deepEqual(
    [linked.prompt_count, linked.response_count, linked.first_request_verified],
    ["2", "2", true],
  );
});

// Claude Research in a chat with a session: the session counts the launch, the report is only
// in the chat's saved reply. The exact launch reply stays beside the text reply, and the link
// answer asks for the saved copy while the report may still be written.
test("a Research launch keeps the chat's text reply and asks for its saved copy", async (t) => {
  const f = await tracker(t);
  const accepted = [{ accepted: true }, { accepted: true }];
  const text = async () =>
    ((await f.coordinator.claudeSessionLink(CHAT, SESSION, TOTALS)) as any).text;
  const saved = async () =>
    (await f.db.all<any>("history_records")).map((row) => row.record);
  const research = {
    data: [
      envelope(1, { type: "system", subtype: "init", model: SONNET }),
      envelope(2, {
        type: "user",
        uuid: id(2),
        parent_tool_use_id: null,
        message: { role: "user", content: [{ type: "text", text: "synthetic prompt" }] },
        bard_message_id: id(1),
        bard_assistant_message_id: id(2),
      }),
      envelope(3, {
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_synthetic",
              name: "mcp__claude_ai__launch_extended_search_task",
              input: {},
            },
          ],
        },
      }),
      envelope(4, {
        type: "result",
        subtype: "success",
        uuid: id(4),
        user_message_uuids: [id(2)],
        duration_api_ms: 11600,
        result: "synthetic launch",
        modelUsage: { [SONNET]: { outputTokens: 573, thinkingTokens: 51 } },
      }),
    ],
  };
  // The chat's saved copy was counted by text: prompt id(1), reply id(2).
  assert.deepEqual(await f.text(901), accepted);
  const textRows = await saved();
  await f.coordinator.claudeSessionLink(CHAT, SESSION, TOTALS);
  const page = (await f.capture(research))[1]! as any;
  assert.equal(validateHistoryCapture(page, "claude.ai"), true);
  // Only the reply of a session's event page carries the mark, and only as true.
  for (const change of [
    (messages: any[]) => (messages[0].research = true),
    (messages: any[]) => (messages[1].research = false),
  ]) {
    const changed = structuredClone(page);
    change(changed.page.messages);
    assert.equal(validateHistoryCapture(changed, "claude.ai"), false);
  }
  assert.deepEqual((await f.read(`/chat/${CHAT}`, 902, CHAT, research)).outcomes, accepted);
  const rows = await saved();
  // The exact prompt replaced the text prompt; the text reply stays beside the exact launch.
  assert.deepEqual(rows.map((record) => record.role).sort(), ["prompt", "response", "response"]);
  const kept = rows.filter((record) =>
    textRows.some((row) => row.message_key === record.message_key),
  );
  assert.deepEqual(
    kept.map((record) => record.role),
    ["response"],
  );
  assert.deepEqual(
    rows
      .filter((record) => record.role === "response" && !kept.includes(record))
      .map((record) => [record.tokens.value, record.tokens.evidence]),
    [["573", "provider_reported"]],
  );
  // The saved copy is due, and a read of it right away keeps it due and brings back nothing.
  assert.equal(await text(), true);
  assert.deepEqual(await f.text(903), accepted);
  assert.equal(await text(), true);
  assert.equal((await saved()).length, 3);
  // The same events read again mark nothing anew and double nothing.
  await f.read(`/chat/${CHAT}`, 904, CHAT, research);
  assert.equal((await saved()).length, 3);
});

// A reload proves nothing again. The content script then asks whether the link of the session
// the page loaded is the kept one; nothing is written for a link that is not.
test("a link the page did not prove is only confirmed against the kept one", async (t) => {
  const f = await tracker(t);
  const unproven = (chat: string, session: string) =>
    f.coordinator.claudeSessionLink(chat, session, null, false);
  assert.deepEqual(await unproven(CHAT, SESSION), { kept: false });
  assert.deepEqual((await f.read(`/chat/${CHAT}`, 891, CHAT)).outcomes[0], "payload_rejected");
  await f.coordinator.claudeSessionLink(CHAT, SESSION, TOTALS);
  assert.deepEqual(await unproven(CHAT, SESSION), {
    kept: true,
    after: null,
    counted: null,
    text: false,
  });
  // Another session for the chat, or the session for another chat, is not the kept link.
  assert.deepEqual(await unproven(CHAT, OTHER), { kept: false });
  assert.deepEqual(await unproven(OTHER_CHAT, SESSION), { kept: false });
  assert.deepEqual((await f.read(`/chat/${CHAT}`, 892, CHAT)).outcomes, [
    { accepted: true },
    { accepted: true },
  ]);
});
