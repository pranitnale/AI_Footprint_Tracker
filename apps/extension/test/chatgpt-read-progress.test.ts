import { archivedEstimation } from "./archived-engine-fixture";
import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { Ledger } from "@footprint/ledger";
import type { HistoryTextPage } from "@footprint/adapters";
import { Coordinator } from "../lib/coordinator";
import { HISTORY_CAPTURE_CHANNEL } from "../lib/history-capture";
import {
  CHATGPT_DAY_PAGE_LIMIT,
  CHATGPT_PROGRESS_CHATS,
  CHATGPT_PROGRESS_KEY,
  chatgptDay,
  chatgptProgressAfter,
  chatgptResume,
  createChatgptProgressStore,
  memoryKeyValueArea,
  validChatgptReadProgress,
} from "../lib/chatgpt-read-progress";
import { historyBinding, historyPage } from "./history-fixture";

const CHAT = "00000000-0000-4000-8000-000000000a01";
const NOW = Date.UTC(2026, 9, 14, 12);
const KEY = "a".repeat(64);
const OTHER_KEY = "b".repeat(64);
const point = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("chatgpt read progress: a run continues from the kept point with the pages left today", () => {
  assert.equal(chatgptResume(null, NOW), null, "nothing kept: the newest page, the whole day");
  const kept = { before: point(5), top: 1_700_000_000, day: chatgptDay(NOW), pages: 60 };
  assert.deepEqual(chatgptResume(kept, NOW), {
    before: point(5),
    top: 1_700_000_000,
    budget: CHATGPT_DAY_PAGE_LIMIT - 60,
  });
  // A new day gives the whole allowance again.
  assert.deepEqual(chatgptResume(kept, NOW + 86_400_000), {
    before: point(5),
    top: 1_700_000_000,
    budget: CHATGPT_DAY_PAGE_LIMIT,
  });
  // Pages read today without a point to continue from still bound the day.
  assert.deepEqual(chatgptResume({ before: null, top: null, day: chatgptDay(NOW), pages: 200 }, NOW), {
    before: null,
    top: null,
    budget: 0,
  });
  assert.deepEqual(
    chatgptProgressAfter({ before: point(9), top: 1_700_000_100, pages: 15 }, 60, NOW),
    { before: point(9), top: 1_700_000_100, day: chatgptDay(NOW), pages: 75 },
  );
  assert.deepEqual(
    chatgptProgressAfter({ before: null, top: null, pages: 1 }, 199, NOW),
    { before: null, top: null, day: chatgptDay(NOW), pages: 200 },
  );
  for (const value of [
    { before: "x", top: null, day: 1, pages: 1 },
    { before: null, top: 5, day: 1, pages: 1 },
    { before: point(1), top: null, day: 1, pages: CHATGPT_DAY_PAGE_LIMIT + 1 },
    { before: point(1), top: null, day: 1, pages: 1, text: "hello" },
  ])
    assert.equal(validChatgptReadProgress(value), false);
});

test("chatgpt read progress store: kept per namespace and chat, erased with the namespace", async () => {
  const area = memoryKeyValueArea();
  let clock = 1;
  const store = createChatgptProgressStore(area, () => clock++);
  const progress = { before: point(5), top: null, day: 1, pages: 3 };
  await store.write("personal:one", KEY, progress);
  assert.deepEqual(await store.read("personal:one", KEY), progress);
  assert.equal(await store.read("personal:one", OTHER_KEY), null);
  assert.equal(await store.read("personal:two", KEY), null, "another scope reads nothing");
  // Only ids and numbers are stored.
  assert.doesNotMatch(JSON.stringify([...area.values]), /hello|text/);
  await assert.rejects(store.write("personal:one", "not-a-key", progress), /payload_rejected/);
  await assert.rejects(
    store.write("personal:one", KEY, { ...progress, before: "<script>" }),
    /payload_rejected/,
  );
  // Erasing another namespace keeps this one; erasing this one removes it.
  await store.erase("personal:two");
  assert.deepEqual(await store.read("personal:one", KEY), progress);
  await store.erase("personal:one");
  assert.equal(await store.read("personal:one", KEY), null);
  assert.equal(area.values.has(CHATGPT_PROGRESS_KEY), false);
  // A new namespace replaces the old entry on its first write.
  await store.write("personal:one", KEY, progress);
  await store.write("personal:two", OTHER_KEY, progress);
  assert.equal(await store.read("personal:one", KEY), null);
  assert.deepEqual(await store.read("personal:two", OTHER_KEY), progress);
});

test("chatgpt read progress store: the least recently read chats are dropped past the limit", async () => {
  const area = memoryKeyValueArea();
  let clock = 1;
  const store = createChatgptProgressStore(area, () => clock++);
  const key = (n: number) => n.toString(16).padStart(64, "0");
  const progress = { before: point(1), top: null, day: 1, pages: 1 };
  await Promise.all(
    Array.from({ length: CHATGPT_PROGRESS_CHATS + 2 }, (_, n) =>
      store.write("personal:one", key(n), progress),
    ),
  );
  assert.equal(await store.read("personal:one", key(0)), null);
  assert.equal(await store.read("personal:one", key(1)), null);
  assert.deepEqual(await store.read("personal:one", key(2)), progress);
  assert.deepEqual(await store.read("personal:one", key(CHATGPT_PROGRESS_CHATS + 1)), progress);
});

async function setup() {
  const db = await Ledger.open("chatgpt-progress-" + crypto.randomUUID());
  const area = memoryKeyValueArea();
  const c = new Coordinator(db, {
    estimation: archivedEstimation,
    count: async () => ({}) as any,
    hasConsent: async () => true,
    hasSiteConsent: async () => true,
    sendDisplay: async () => {},
    transport: async () => {
      throw new TypeError("synthetic offline");
    },
    progressStorage: area,
  });
  await c.whenReady();
  return { db, c, area };
}

/** A saved ChatGPT page with prompts `point(1)` and `point(3)`. */
function chatgptPage(): HistoryTextPage {
  const page = historyPage(4);
  return {
    ...page,
    site: "chatgpt",
    conversationId: CHAT,
    messages: page.messages.map((message) => ({
      ...message,
      requestId: message.role === "prompt" ? message.sourceId : null,
      liveAttemptId: message.role === "response" ? message.sourceId : null,
    })),
    branchScope: "loaded_messages",
    selectedLeafId: null,
    branchSourceIds: null,
    firstRequestVerified: false,
    rootSourceId: null,
    hasEarlier: true,
  };
}

async function receive(c: Coordinator, page: HistoryTextPage) {
  const binding = historyBinding();
  const sender = {
    tab: { id: 7 },
    frameId: 0,
    documentId: "synthetic-history-document",
    url: `https://chatgpt.com/c/${CHAT}`,
  };
  const common = {
    channel: HISTORY_CAPTURE_CHANNEL,
    id: crypto.randomUUID(),
    site: page.site,
    conversationId: page.conversationId,
    observedAt: page.observedAt,
  } as const;
  assert.deepEqual(
    await c.history.receive({ ...common, event: "start", page: null }, binding, sender),
    { accepted: true },
  );
  assert.deepEqual(
    await c.history.receive({ ...common, event: "page", page }, binding, sender),
    { accepted: true },
  );
}

test("chatgpt read progress: the kept point counts only while its saved prompt exists, and a full erase removes it", async () => {
  const f = await setup();
  try {
    const day = chatgptDay(Date.now());
    const kept = { before: point(3), top: 1_700_000_000, day, pages: 12 };
    // Before the page with that prompt was imported, the point is not trusted; the day's
    // page count still is.
    assert.deepEqual(await f.c.chatgptReadProgress(CHAT, kept), kept);
    assert.deepEqual(await f.c.chatgptReadProgress(CHAT), {
      before: null,
      top: null,
      day,
      pages: 12,
    });
    await receive(f.c, chatgptPage());
    assert.deepEqual(await f.c.chatgptReadProgress(CHAT), kept);
    // A reply's id is not a prompt that starts a page.
    await f.c.chatgptReadProgress(CHAT, { ...kept, before: point(4) });
    assert.equal((await f.c.chatgptReadProgress(CHAT))!.before, null);
    await f.c.chatgptReadProgress(CHAT, kept);
    // Stored under the keyed conversation, never the chat's address.
    assert.doesNotMatch(JSON.stringify([...f.area.values]), new RegExp(CHAT));
    await assert.rejects(f.c.chatgptReadProgress("not-a-chat", kept), /payload_rejected/);
    await assert.rejects(
      f.c.chatgptReadProgress(CHAT, { ...kept, pages: -1 }),
      /payload_rejected/,
    );
    await f.c.clearPersonal();
    assert.equal(await f.c.chatgptReadProgress(CHAT), null);
    assert.equal(f.area.values.has(CHATGPT_PROGRESS_KEY), false);
  } finally {
    f.c.history.invalidate();
    f.c.engines.dispose();
    f.db.close();
  }
});
