import { archivedEstimation } from "./archived-engine-fixture";
import "fake-indexeddb/auto";
import { after, test as base } from "node:test";
import assert from "node:assert/strict";
import { Ledger } from "@footprint/ledger";
import { Coordinator } from "../lib/coordinator";
import { memoryKeyValueArea } from "../lib/chatgpt-read-progress";
import {
  OWN_READ_COOLDOWN_MS,
  OWN_READ_PAUSE_MAX_MS,
  ownReadSettingKey,
  validOwnReadOutcome,
  type OwnReadOutcome,
} from "../lib/own-read";
import {
  OWN_READ_SETTING_KEYS,
  ownReadAllowed,
  ownReadMainSwitchOff,
  ownReadSettingAnswer,
  ownReadSettingKeys,
  ownReadSettings,
  validOwnReadSites,
} from "../lib/own-read-settings";
import { httpOutcome, retryAfterMs } from "../lib/own-read-page";
import { claudeOwnRead } from "../lib/claude-own-read";
import { chatgptOwnRead } from "../lib/chatgpt-own-read";
import { validatedDashboard } from "../lib/dashboard/summary-validators";
import { closePorts, json, pageWorld, recordingContext, scheduler, tick } from "./own-read-fixture";

after(closePorts);

const test = (name: string, fn: () => unknown) =>
  base(name, { timeout: 10_000 }, fn as () => Promise<void>);

const ORG = "00000000-0000-4000-8000-0000000000aa";
const CHAT = "00000000-0000-4000-8000-000000000c01";
const OTHER_CHAT = "00000000-0000-4000-8000-000000000c02";
const COWORK = "cse_0123456789ABCDEFghijklmn";

async function until(predicate: () => boolean) {
  for (let i = 0; i < 200 && !predicate(); i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(predicate());
}

// ---------------------------------------------------------------------------------------
// The setting (owner decision of 17 Oct 2026)

test("load full chat history: absent or older settings read as on, per site and overall", () => {
  const all = Object.fromEntries(OWN_READ_SETTING_KEYS.map((key) => [key, true]));
  assert.deepEqual(ownReadSettings({}), { ownRead: true, ownReadSites: all });
  assert.deepEqual(ownReadSettings({ ownRead: "no", ownReadSites: "x" }), { ownRead: true, ownReadSites: all });
  const some = ownReadSettings({ ownReadSites: { perplexity: false, other: false } });
  assert.equal(ownReadAllowed(some, "perplexity"), false);
  assert.equal(ownReadAllowed(some, "chatgpt"), true);
  const off = ownReadSettings({ ownRead: false });
  for (const key of OWN_READ_SETTING_KEYS) assert.equal(ownReadAllowed(off, key), false, key);
  assert.deepEqual(OWN_READ_SETTING_KEYS, ["chatgpt", "claude", "cowork", "gemini", "perplexity", "notebooklm"]);
  assert.equal(validOwnReadSites({ chatgpt: false, cowork: true }), true);
  for (const bad of [null, [], { other: true }, { chatgpt: "no" }, "chatgpt"])
    assert.equal(validOwnReadSites(bad), false, JSON.stringify(bad));
  // claude.ai carries two switches: its chats and its Cowork sessions.
  assert.deepEqual(ownReadSettingKeys("claude"), ["claude", "cowork"]);
  assert.deepEqual(ownReadSettingKeys("perplexity"), ["perplexity"]);
  assert.deepEqual(ownReadSettingKeys("cowork"), ["cowork"]);
  assert.deepEqual(ownReadSettingKeys("example"), []);
  assert.equal(ownReadSettingKey("claude", CHAT), "claude");
  assert.equal(ownReadSettingKey("claude", COWORK), "cowork");
  assert.equal(ownReadSettingKey("gemini", "c_0123456789abcdef"), "gemini");
  assert.equal(ownReadSettingAnswer({ on: true }), true);
  assert.equal(ownReadSettingAnswer({ on: false }), false);
  for (const bad of [undefined, null, { enabled: false }, { on: "yes" }, { on: true, extra: 1 }])
    assert.equal(ownReadSettingAnswer(bad), null);
  // Off because of the main switch (live QA, 19 Oct 2026): Details then points to that switch.
  assert.equal(ownReadSettingAnswer({ on: false, cause: "main" }), false);
  assert.equal(ownReadMainSwitchOff({ on: false, cause: "main" }), true);
  assert.equal(ownReadMainSwitchOff({ on: false }), false);
  for (const bad of [{ on: true, cause: "main" }, { on: false, cause: "site" }])
    assert.equal(ownReadSettingAnswer(bad), null, JSON.stringify(bad));
});

async function coordinator() {
  const db = await Ledger.open("own-read-settings-" + crypto.randomUUID());
  const c = new Coordinator(db, {
    estimation: archivedEstimation,
    count: async () => ({}) as any,
    hasConsent: async () => true,
    hasSiteConsent: async () => true,
    sendDisplay: async () => {},
    transport: async () => {
      throw new TypeError("synthetic offline");
    },
    progressStorage: memoryKeyValueArea(),
  });
  await c.whenReady();
  return { db, c };
}

test("coordinator: load full chat history is on by default, also for an older installation, and saves per site", async () => {
  const { db, c } = await coordinator();
  try {
    const fresh = await c.settings();
    assert.equal(fresh.ownRead, true);
    assert.deepEqual(Object.values(fresh.ownReadSites), Array(6).fill(true));
    const stored = (await db.get<any>("policy", "settings"))!;
    assert.equal(stored.ownRead, true, "a new installation stores the field");
    // An installation from before 17 Oct 2026 has neither field: it reads as on.
    const { ownRead: _o, ownReadSites: _s, ...older } = stored;
    await db.put("policy", { ...older, key: "settings" });
    assert.equal((await c.settings()).ownRead, true);
    assert.deepEqual(await c.ownReadSetting("perplexity"), { on: true });

    assert.deepEqual(await c.updateSettings({ ownReadSites: { perplexity: false } }), { ownReadChanged: true });
    assert.deepEqual(await c.ownReadSetting("perplexity"), { on: false });
    assert.deepEqual(await c.ownReadSetting("chatgpt"), { on: true }, "other sites keep theirs");
    assert.deepEqual(await c.updateSettings({ ownReadSites: { cowork: false } }), { ownReadChanged: true });
    assert.deepEqual(await c.ownReadSetting("cowork"), { on: false });
    assert.deepEqual(await c.ownReadSetting("perplexity"), { on: false }, "a later save keeps earlier sites");
    assert.deepEqual(await c.ownReadSetting("claude"), { on: true }, "Cowork has its own switch");
    assert.deepEqual(await c.updateSettings({ timezone: "Europe/Berlin" }), { ownReadChanged: false });
    assert.deepEqual(await c.updateSettings({ ownRead: false }), { ownReadChanged: true });
    for (const key of OWN_READ_SETTING_KEYS)
      assert.deepEqual(await c.ownReadSetting(key), { on: false, cause: "main" }, key);
    // With the main switch off a site's choice changes nothing that applies now.
    assert.deepEqual(await c.updateSettings({ ownReadSites: { chatgpt: false } }), { ownReadChanged: false });
    assert.deepEqual(await c.updateSettings({ ownRead: true }), { ownReadChanged: true });
    assert.deepEqual(await c.ownReadSetting("gemini"), { on: true });
    assert.deepEqual(await c.ownReadSetting("chatgpt"), { on: false });

    await assert.rejects(c.updateSettings({ ownRead: "no" as never }), /full chat history/);
    for (const bad of [{ other: true }, { chatgpt: "yes" }, []])
      await assert.rejects(c.updateSettings({ ownReadSites: bad as never }), /full chat history/);
    assert.deepEqual(await c.ownReadSetting("chatgpt"), { on: false }, "a rejected change saves nothing");

    // The dashboard carries the fields and its validator accepts them, or older copies without.
    const dashboard = JSON.parse(JSON.stringify(await c.dashboard()));
    assert.equal(dashboard.settings.ownRead, true);
    assert.equal(dashboard.settings.ownReadSites.chatgpt, false);
    assert.doesNotThrow(() => validatedDashboard(dashboard));
    const { ownRead: _a, ownReadSites: _b, ...copy } = dashboard.settings;
    assert.doesNotThrow(() => validatedDashboard({ ...dashboard, settings: copy }));
    assert.throws(() => validatedDashboard({ ...dashboard, settings: { ...copy, ownRead: "on" } }));
    assert.throws(() => validatedDashboard({ ...dashboard, settings: { ...copy, ownReadSites: { other: true } } }));
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------------------
// The scheduler asks for the switch before every read

const claude = (allowed: (key: string) => Promise<boolean | null>, path = (id: string) => `/chat/${id}`) =>
  scheduler("claude", path, { random: 0, allowed: allowed as never });

test("own read: with Load full chat history off nothing is requested and the bar does not wait", async () => {
  const asked: string[] = [];
  const s = claude(async (key) => {
    asked.push(key);
    return false;
  });
  try {
    await tick();
    assert.deepEqual(asked.sort(), ["claude", "cowork"], "claude.ai's switches are read at once");
    assert.equal(s.request("nav-1", CHAT, { mode: "missing" }), false, "History not loaded at once");
    s.advance(60_000);
    await tick();
    assert.equal(s.posted.length, 0);
    assert.deepEqual(s.read.off("nav-1"), { key: "claude", mode: "missing" });
    assert.equal(s.read.note("nav-1"), null, "Details shows its own entry, not a failure note");
    assert.equal(s.read.off("nav-2"), null);
  } finally {
    s.close();
  }
});

test("own read: the switch is asked again right before the read goes out", async () => {
  let on = true;
  const s = claude(async () => on);
  try {
    await tick();
    assert.equal(s.request("nav-1", CHAT, { mode: "after_import" }), true);
    on = false;
    s.advance(0);
    await until(() => s.changes > 0);
    assert.equal(s.posted.length, 0, "turned off after the read was scheduled");
    assert.deepEqual(s.read.off("nav-1"), { key: "claude", mode: "after_import" });
    assert.equal(s.request("nav-1", CHAT), false);
  } finally {
    s.close();
  }
});

test("own read: an unreadable setting sends nothing", async () => {
  const s = claude(async () => null);
  try {
    await tick();
    assert.equal(s.request("nav-1", CHAT), true);
    s.advance(0);
    await until(() => s.changes > 0);
    assert.equal(s.posted.length, 0);
    assert.equal(s.read.off("nav-1"), null);
    assert.match(s.read.note("nav-1")!.text, /could not make the request/);
  } finally {
    s.close();
  }
});

test("own read: turning the switch off stops a running read at once; turning it on reads again", async () => {
  let on = true;
  const s = claude(async () => on);
  try {
    await tick();
    s.request("nav-1", CHAT);
    s.advance(0);
    await until(() => s.posted.length === 1);
    const received: unknown[] = [];
    s.posted[0]!.port.onmessage = (event) => received.push(event.data);
    on = false;
    s.read.settingChanged();
    await until(() => received.length > 0);
    assert.deepEqual(received, [{ cancel: true }], "the page world stops and sends nothing more");
    assert.deepEqual(s.read.off("nav-1"), { key: "claude", mode: "missing" });
    assert.equal(s.request("nav-1", CHAT), false);
    const before = s.changes;
    on = true;
    s.read.settingChanged();
    await until(() => s.changes > before);
    assert.equal(s.request("nav-1", CHAT), true, "the held read is asked for again");
    s.advance(0);
    await until(() => s.posted.length === 2);
    assert.equal(s.read.off("nav-1"), null);
  } finally {
    s.close();
  }
});

test("own read: a long read checks the switch again with each progress report", async () => {
  let on = true;
  const s = scheduler("chatgpt", (id) => `/c/${id}`, { random: 0, allowed: async () => on });
  try {
    await tick();
    s.request("nav-1", CHAT, { mode: "after_import" });
    s.advance(0);
    await until(() => s.posted.length === 1);
    const received: unknown[] = [];
    s.posted[0]!.port.onmessage = (event) => received.push(event.data);
    on = false;
    // No change notice reached this tab; the next page's progress report finds the switch off.
    s.posted[0]!.port.postMessage({ pending: true });
    await until(() => received.length > 0);
    assert.deepEqual(received, [{ cancel: true }]);
    assert.deepEqual(s.read.off("nav-1"), { key: "chatgpt", mode: "after_import" });
  } finally {
    s.close();
  }
});

test("own read: a Cowork session follows its own switch", async () => {
  const off = new Set(["cowork"]);
  const s = claude(async (key) => !off.has(key), (id) => (id.startsWith("cse_") ? `/cowork/${id}` : `/chat/${id}`));
  try {
    await tick();
    assert.equal(s.request("nav-1", COWORK), false);
    assert.deepEqual(s.read.off("nav-1"), { key: "cowork", mode: "missing" });
    assert.equal(s.request("nav-2", CHAT), true, "Claude chats are still read");
    s.advance(0);
    await until(() => s.posted.length === 1);
    assert.equal(s.posted[0]!.message.conversationId, CHAT);
  } finally {
    s.close();
  }
});

test("own read: a pause another open tab started holds the read even when its answer comes after the switch's", async () => {
  // Since 17 Oct 2026 a read goes out at once after the grace period, with no random wait, so
  // the shared pause asked for with the request can answer after the switch did. A Retry-After
  // can hold reads for up to a day, so this tab must not send before it knows.
  let calls = 0;
  const pauseFor = 60 * 60_000;
  const s = scheduler("claude", (id) => `/chat/${id}`, {
    random: 0,
    allowed: async () => true,
    sharedPause: {
      get: () => {
        calls++;
        // The first question, when the tab opened, found no pause; another tab's 429 came later.
        if (calls === 1) return Promise.resolve(null);
        return new Promise((resolve) => setTimeout(() => resolve(1_000_000 + pauseFor), 30));
      },
      set: () => {},
    },
  });
  try {
    await tick();
    assert.equal(s.request("nav-1", CHAT), true);
    s.advance(0);
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(s.posted.length, 0, "held by the other tab's pause");
    assert.match(s.read.note("nav-1")!.text, /refused or limited an earlier read/);
  } finally {
    s.close();
  }
});

// ---------------------------------------------------------------------------------------
// Retry-After (owner decision of 17 Oct 2026)

test("retry-after: delay seconds and HTTP dates, never negative, at most a day", () => {
  const now = Date.UTC(2026, 9, 17, 12);
  assert.equal(retryAfterMs("120", now), 120_000);
  assert.equal(retryAfterMs(" 0 ", now), 0);
  assert.equal(retryAfterMs(new Date(now + 90_000).toUTCString(), now), 90_000);
  assert.equal(retryAfterMs(new Date(now - 90_000).toUTCString(), now), 0, "a past date is no wait");
  assert.equal(retryAfterMs("99999999", now), OWN_READ_PAUSE_MAX_MS);
  for (const bad of [null, "", "soon", "-5", "1.5", "2026-10-17"])
    assert.equal(retryAfterMs(bad, now), null, String(bad));
  const headers = (value: string) => new Headers({ "retry-after": value });
  assert.deepEqual(httpOutcome(429, headers("30"), now), { kind: "http", status: 429, shouldRetry: true, retryAfter: 30_000 });
  assert.deepEqual(httpOutcome(503, headers("30"), now), { kind: "http", status: 503, shouldRetry: true, retryAfter: 30_000 });
  // Only a 429 or 503 names a wait; other answers keep the usual pause.
  assert.deepEqual(httpOutcome(500, headers("30"), now), { kind: "http", status: 500, shouldRetry: true });
  assert.deepEqual(httpOutcome(429, new Headers(), now), { kind: "http", status: 429, shouldRetry: true });
  assert.equal(validOwnReadOutcome({ kind: "http", status: 429, shouldRetry: true, retryAfter: 30_000 }), true);
  assert.equal(validOwnReadOutcome({ kind: "http", status: 429, shouldRetry: true, retryAfter: -1 }), false);
  assert.equal(validOwnReadOutcome({ kind: "http", status: 429, shouldRetry: true, retryAfter: OWN_READ_PAUSE_MAX_MS + 1 }), false);
});

test("retry-after: the page world reports the wait a 429 or 503 asked for", async () => {
  const now = Date.UTC(2026, 9, 17, 12);
  for (const [response, retryAfter] of [
    [json("{}", 429, { "retry-after": "600" }), 600_000],
    [json("{}", 503, { "retry-after": new Date(now + 120_000).toUTCString() }), 120_000],
  ] as const) {
    const world = pageWorld(
      claudeOwnRead({ origin: "https://claude.ai", cookie: () => `lastActiveOrg=${ORG}` }),
      CHAT,
      `/chat/${CHAT}`,
      { responses: [response], now: () => now },
    );
    assert.deepEqual(await world.ask(), {
      kind: "http",
      status: response.status,
      shouldRetry: true,
      retryAfter,
    });
    assert.equal(world.observed.length, 0);
  }
  // ChatGPT's session read is the first request of its read; its wait counts the same.
  const run = recordingContext(CHAT, `/c/${CHAT}`, () => json("{}", 429, { "retry-after": "30" }));
  assert.deepEqual(await chatgptOwnRead({ origin: "https://chatgpt.com" }).run(run.context), {
    kind: "http",
    status: 429,
    shouldRetry: true,
    retryAfter: 30_000,
  });
});

test("retry-after: the site's next own read waits at least as long, in this tab and the others", async () => {
  const stored: number[] = [];
  const s = scheduler("claude", (id) => `/chat/${id}`, {
    random: 0,
    sharedPause: { get: () => Promise.resolve(null), set: (until) => stored.push(until) },
  });
  const wait = 20 * 60_000;
  try {
    s.request("nav-1", CHAT);
    s.advance(0);
    const at = 1_000_000;
    await s.reply({ kind: "http", status: 429, shouldRetry: true, retryAfter: wait } as OwnReadOutcome);
    assert.deepEqual(stored, [at + wait], "the other tabs of the site wait as long");
    s.advance(OWN_READ_COOLDOWN_MS);
    assert.equal(s.request("nav-2", OTHER_CHAT), false, "the usual five minutes are not enough");
    assert.match(s.read.note("nav-2")!.text, /refused or limited an earlier read/);
    s.advance(wait - OWN_READ_COOLDOWN_MS - 1);
    assert.equal(s.request("nav-2", OTHER_CHAT), false);
    s.advance(1);
    assert.equal(s.request("nav-2", OTHER_CHAT), true);
    s.advance(0);
    assert.equal(s.posted.at(-1)!.message.conversationId, OTHER_CHAT);
  } finally {
    s.close();
  }
  // A shorter Retry-After never shortens the usual pause.
  const short = scheduler("claude", (id) => `/chat/${id}`, { random: 0 });
  try {
    short.request("nav-1", CHAT);
    short.advance(0);
    await short.reply({ kind: "http", status: 429, shouldRetry: true, retryAfter: 1000 } as OwnReadOutcome);
    short.advance(OWN_READ_COOLDOWN_MS - 1);
    assert.equal(short.request("nav-2", OTHER_CHAT), false);
  } finally {
    short.close();
  }
});
