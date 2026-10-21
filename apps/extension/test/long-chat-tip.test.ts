import { archivedEstimation } from "./archived-engine-fixture";
import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { Ledger } from "@footprint/ledger";
import { Coordinator } from "../lib/coordinator";
import { memoryKeyValueArea } from "../lib/chatgpt-read-progress";
import {
  DEFAULT_TIP_REQUEST_LIMIT,
  longChatTipReason,
  longChatTipSettings,
  longChatTipText,
  parseLongChatTipState,
  tipOpen,
  tipRequestLimit,
  validTipRequestLimit,
} from "../lib/long-chat-tip";
import {
  LONG_CHAT_TIP_CHATS,
  LONG_CHAT_TIP_KEY,
  TIP_SNOOZE_MS,
  createLongChatTipStore,
} from "../lib/long-chat-tip-store";
import { validatedDashboard } from "../lib/dashboard/summary-validators";

const CHAT = "00000000-0000-4000-8000-000000000b01";
const OTHER = "00000000-0000-4000-8000-000000000b02";
const KEY = "a".repeat(64);
const NOW = Date.UTC(2026, 9, 16, 12);

test("long-chat tip settings: installations before 16 Oct 2026 migrate from the one switch", () => {
  const defaults = {
    contextTipRequests: true,
    contextTipRequestLimit: DEFAULT_TIP_REQUEST_LIMIT,
    contextTipTokens: false,
  };
  assert.equal(DEFAULT_TIP_REQUEST_LIMIT, 50);
  assert.deepEqual(longChatTipSettings({}), defaults, "absent meant on: the new defaults");
  assert.deepEqual(longChatTipSettings({ contextTip: true }), defaults);
  assert.deepEqual(
    longChatTipSettings({ contextTip: false }),
    { ...defaults, contextTipRequests: false, contextTipTokens: false },
    "a tip turned off stays off for both triggers",
  );
  assert.deepEqual(
    longChatTipSettings({
      contextTip: false,
      contextTipRequests: true,
      contextTipRequestLimit: 120,
      contextTipTokens: true,
    }),
    { contextTipRequests: true, contextTipRequestLimit: 120, contextTipTokens: true },
    "saved fields win over the old switch",
  );
  for (const bad of [0, -1, 1.5, 10_001, "50", null])
    assert.equal(longChatTipSettings({ contextTipRequestLimit: bad }).contextTipRequestLimit, 50);
  assert.equal(validTipRequestLimit(1), true);
  assert.equal(validTipRequestLimit(10_000), true);
  assert.equal(tipRequestLimit(defaults), 50);
  assert.equal(tipRequestLimit({ ...defaults, contextTipRequests: false }), null);
});

test("long-chat tip trigger: requests from exactly the limit, tokens only as decided, either one shows it", () => {
  const at = (requests: string | null, requestLimit: number | null, tokens = false) =>
    longChatTipReason({ requests, requestLimit, tokens });
  assert.equal(at("49", 50), null);
  assert.equal(at("50", 50), "requests");
  assert.equal(at("51", 50), "requests");
  assert.equal(at("5000", null), null, "Requests switched off");
  assert.equal(at(null, 50), null, "an unknown count shows nothing");
  assert.equal(at("abc", 50), null);
  assert.equal(at("3", 50, true), "tokens", "the token trigger alone");
  assert.equal(at("60", 50, true), "tokens", "both: the token wording");
  assert.equal(at("3", null, true), "tokens");
});

test("long-chat tip text names the requests in the existing tone, without a saving claim", () => {
  const tokens = longChatTipText("tokens", "60");
  assert.equal(tokens, "Long chat · for a new topic, consider a fresh conversation.");
  assert.equal(
    longChatTipText("requests", "50"),
    "Long chat (50 requests) · for a new topic, consider a fresh conversation.",
  );
  assert.equal(
    longChatTipText("requests", "1"),
    "Long chat (1 request) · for a new topic, consider a fresh conversation.",
  );
  assert.match(longChatTipText("requests", "12000", true), /^Long chat \(about 12\D?000 requests\) · /);
  for (const text of [tokens, longChatTipText("requests", "50")]) {
    assert.doesNotMatch(text, /—/);
    assert.doesNotMatch(text, /electricity|less|save/i);
  }
});

test("long-chat tip state: open, closed for good, snoozed for a day, and only valid replies", () => {
  assert.equal(tipOpen({ closed: false, snoozedUntil: null }, NOW), true);
  assert.equal(tipOpen({ closed: true, snoozedUntil: null }, NOW), false);
  assert.equal(tipOpen({ closed: false, snoozedUntil: NOW + 1 }, NOW), false);
  assert.equal(tipOpen({ closed: false, snoozedUntil: NOW }, NOW), true);
  assert.deepEqual(parseLongChatTipState({ closed: true, snoozedUntil: null }), {
    closed: true,
    snoozedUntil: null,
  });
  for (const bad of [null, undefined, { enabled: false }, { closed: "yes", snoozedUntil: null }, { closed: false, snoozedUntil: 1.5 }])
    assert.equal(parseLongChatTipState(bad), null);
});

test("long-chat tip store: a closed chat stays closed, other chats and scopes are unaffected, erase clears", async () => {
  const area = memoryKeyValueArea();
  let now = NOW;
  const store = createLongChatTipStore(area, () => now);
  const other = "b".repeat(64);
  assert.deepEqual(await store.read("personal:one", KEY), { closed: false, snoozedUntil: null });
  assert.deepEqual(await store.write("personal:one", KEY, "close"), { closed: true, snoozedUntil: null });
  assert.deepEqual(await store.read("personal:one", KEY), { closed: true, snoozedUntil: null });
  assert.deepEqual(await store.read("personal:one", other), { closed: false, snoozedUntil: null });
  now += 1000;
  assert.deepEqual(await store.write("personal:one", other, "snooze"), {
    closed: false,
    snoozedUntil: now + TIP_SNOOZE_MS,
  });
  assert.deepEqual(await store.read("personal:two", KEY), { closed: false, snoozedUntil: null });
  await assert.rejects(store.write("personal:one", "not-a-key", "close"), /payload_rejected/);
  await assert.rejects(store.write("personal:one", KEY, "open" as never), /payload_rejected/);
  // Another scope's erase leaves this scope's entry.
  await store.erase("personal:two");
  assert.deepEqual(await store.read("personal:one", KEY), { closed: true, snoozedUntil: null });
  await store.erase("personal:one");
  assert.equal(area.values.has(LONG_CHAT_TIP_KEY), false);
  assert.deepEqual(await store.read("personal:one", KEY), { closed: false, snoozedUntil: null });
  assert.ok(LONG_CHAT_TIP_CHATS >= 1000, "closed tips are kept for many chats");
});

async function setup(name = "long-chat-tip-" + crypto.randomUUID(), area = memoryKeyValueArea()) {
  const db = await Ledger.open(name);
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

test("coordinator: tip settings migrate on read, validate on save and are stored explicitly", async () => {
  const f = await setup();
  try {
    const fresh = await f.c.settings();
    assert.equal(fresh.contextTipRequests, true);
    assert.equal(fresh.contextTipRequestLimit, 50);
    assert.equal(fresh.contextTipTokens, false);
    const stored = (await f.db.get<any>("policy", "settings"))!;
    assert.equal(stored.contextTipRequests, true, "a new installation stores the fields");
    for (const [legacy, requests] of [
      [undefined, true],
      [true, true],
      [false, false],
    ] as const) {
      const { contextTipRequests: _r, contextTipRequestLimit: _l, contextTipTokens: _t, ...old } = stored;
      await f.db.put("policy", {
        ...old,
        key: "settings",
        budget: 250_000,
        ...(legacy === undefined ? {} : { contextTip: legacy }),
      });
      const read = await f.c.settings();
      assert.equal(read.contextTipRequests, requests, `contextTip ${legacy}`);
      assert.equal(read.contextTipRequestLimit, 50);
      assert.equal(read.contextTipTokens, false);
      assert.equal(read.budget, 250_000, "the custom token limit is kept");
      assert.equal("contextTip" in read, false);
    }
    // contextTip false is stored now; the first save writes explicit fields and drops it.
    await f.c.updateSettings({ contextTipTokens: true });
    const saved = (await f.db.get<any>("policy", "settings"))!;
    assert.equal("contextTip" in saved, false);
    assert.equal(saved.contextTipRequests, false);
    assert.equal(saved.contextTipRequestLimit, 50);
    assert.equal(saved.contextTipTokens, true);
    assert.equal(saved.budget, 250_000, "the token limit returns with Tokens");
    await f.c.updateSettings({ contextTipRequests: true, contextTipRequestLimit: 120 });
    assert.equal((await f.c.settings()).contextTipRequestLimit, 120);
    for (const bad of [0, 10_001, 2.5, "50"])
      await assert.rejects(
        f.c.updateSettings({ contextTipRequestLimit: bad as never }),
        /between 1 and 10,000 requests/,
      );
    await assert.rejects(f.c.updateSettings({ contextTipRequests: "no" as never }), /long-chat tip/);
    await assert.rejects(f.c.updateSettings({ contextTipTokens: 1 as never }), /long-chat tip/);
    assert.equal((await f.c.settings()).contextTipRequestLimit, 120, "a rejected change saves nothing");
    // The dashboard carries the fields and its validator accepts them, or older copies without.
    const dashboard = JSON.parse(JSON.stringify(await f.c.dashboard()));
    assert.equal(dashboard.settings.contextTipRequestLimit, 120);
    assert.doesNotThrow(() => validatedDashboard(dashboard));
    const { contextTipRequests: _a, contextTipRequestLimit: _b, contextTipTokens: _c, ...older } = dashboard.settings;
    assert.doesNotThrow(() => validatedDashboard({ ...dashboard, settings: { ...older, contextTip: false } }));
    assert.throws(() =>
      validatedDashboard({ ...dashboard, settings: { ...dashboard.settings, contextTipRequestLimit: 0 } }),
    );
    assert.throws(() =>
      validatedDashboard({ ...dashboard, settings: { ...dashboard.settings, contextTipTokens: "on" } }),
    );
  } finally {
    f.db.close();
  }
});

test("coordinator: a closed tip survives a restart for that chat only, and a full erase clears it", async () => {
  const name = "long-chat-tip-" + crypto.randomUUID();
  const area = memoryKeyValueArea();
  const f = await setup(name, area);
  try {
    assert.deepEqual(await f.c.longChatTip("chatgpt", CHAT), { closed: false, snoozedUntil: null });
    assert.deepEqual(await f.c.longChatTip("chatgpt", CHAT, "close"), { closed: true, snoozedUntil: null });
    // Stored under the keyed conversation, never the chat's address.
    assert.doesNotMatch(JSON.stringify([...area.values]), new RegExp(CHAT));
    const snoozed = await f.c.longChatTip("chatgpt", OTHER, "snooze");
    assert.ok(snoozed.snoozedUntil! > Date.now() + TIP_SNOOZE_MS - 60_000);
    await assert.rejects(f.c.longChatTip("chatgpt", "not-a-chat"), /payload_rejected/);
    await assert.rejects(f.c.longChatTip("chatgpt", CHAT, "open" as never), /payload_rejected/);

    // The service worker restarts: a new coordinator on the same records and storage.
    const restarted = new Coordinator(f.db, {
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
    await restarted.whenReady();
    assert.deepEqual(await restarted.longChatTip("chatgpt", CHAT), { closed: true, snoozedUntil: null });
    assert.equal((await restarted.longChatTip("claude", CHAT)).closed, false, "another site's chat");
    assert.equal(
      (await restarted.longChatTip("chatgpt", "00000000-0000-4000-8000-000000000b03")).closed,
      false,
      "another chat still shows its tip",
    );

    await restarted.clearPersonal();
    assert.equal(area.values.has(LONG_CHAT_TIP_KEY), false, "a full erase leaves no closed tip");
    assert.deepEqual(await restarted.longChatTip("chatgpt", CHAT), { closed: false, snoozedUntil: null });
  } finally {
    f.db.close();
  }
});
