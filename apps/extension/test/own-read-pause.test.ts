import { after, test as base } from "node:test";
import assert from "node:assert/strict";
import { OWN_READ_COOLDOWN_MS, OWN_READ_PAUSE_MAX_MS, type OwnReadSite } from "../lib/own-read";
import {
  OWN_READ_PAUSE_TARGET,
  createOwnReadPauses,
  ownReadSharedPause,
} from "../lib/own-read-pause";
import { ORIGINS, closePorts, scheduler, tick } from "./own-read-fixture";

after(closePorts);

// A read that never answers would otherwise hold the test run open.
const test = (name: string, fn: () => unknown) =>
  base(name, { timeout: 10_000 }, fn as () => Promise<void>);

const RUNTIME = "pause-test-extension";
const CHAT = "00000000-0000-4000-8000-000000000701";
const OTHER_CHAT = "00000000-0000-4000-8000-000000000702";
const PATHS: Partial<Record<OwnReadSite, (id: string) => string>> = {
  claude: (id) => `/chat/${id}`,
  chatgpt: (id) => `/c/${id}`,
};

/** Session storage as a map, with the writes it took. */
function sessionStorage() {
  const values = new Map<string, unknown>();
  const writes: Array<Record<string, unknown>> = [];
  return {
    values,
    writes,
    fail: false,
    async get(key: string) {
      if (this.fail) throw new Error("storage unavailable");
      return values.has(key) ? { [key]: values.get(key) } : {};
    },
    async set(items: Record<string, unknown>) {
      if (this.fail) throw new Error("storage unavailable");
      writes.push(items);
      for (const [key, value] of Object.entries(items)) values.set(key, value);
    },
  };
}

function background(now: () => number) {
  const storage = sessionStorage();
  const pauses = createOwnReadPauses({
    storage: () => storage,
    runtimeId: RUNTIME,
    now,
  });
  const sender = (url: string, extra: Record<string, unknown> = {}) => ({
    id: RUNTIME,
    url,
    tab: { id: 7 },
    frameId: 0,
    ...extra,
  });
  return { storage, pauses, sender };
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await tick();
};

test("own read pause: a 429 in one tab holds the read in another tab of the site, not of another site", async () => {
  let clock = 1_001_000;
  const bg = background(() => clock);
  // A tab's messages reach the background as `browser.runtime.sendMessage` would carry them.
  const tab = (site: OwnReadSite) =>
    scheduler(site, PATHS[site]!, {
      random: 0,
      sharedPause: ownReadSharedPause(site, (message) =>
        Promise.resolve(
          bg.pauses.answer(message, bg.sender(ORIGINS[site] + PATHS[site]!(CHAT))),
        ),
      ),
    });
  const first = tab("claude");
  const second = tab("claude");
  const chatgpt = tab("chatgpt");
  try {
    first.request("nav-1", CHAT);
    first.advance(1000);
    await first.reply({ kind: "http", status: 429, shouldRetry: true });
    await settle();
    assert.deepEqual(
      [...bg.storage.values.keys()],
      ["own-read-pause:claude"],
      "one time for the site, no chat id",
    );
    assert.equal(typeof bg.storage.values.get("own-read-pause:claude"), "number");

    // The tab learns of the pause while its read waits for its delay, and holds it.
    second.request("nav-1", OTHER_CHAT);
    await settle();
    second.advance(1000);
    assert.equal(second.posted.length, 0, "held by the other tab's pause");
    assert.match(second.read.note("nav-1")!.text, /refused or limited an earlier read/);
    assert.equal(second.request("nav-2", OTHER_CHAT), false);
    second.advance(10_000);
    assert.equal(second.posted.length, 0);

    assert.equal(chatgpt.request("nav-1", CHAT), true, "another site reads as usual");
    chatgpt.advance(1000);
    assert.equal(chatgpt.posted.length, 1);

    // Once the pause passed, the second tab reads.
    clock += OWN_READ_COOLDOWN_MS;
    second.advance(OWN_READ_COOLDOWN_MS);
    assert.equal(second.request("nav-2", OTHER_CHAT), true);
    second.advance(1000);
    assert.equal(second.posted.length, 1);
  } finally {
    first.close();
    second.close();
    chatgpt.close();
  }
});

test("own read pause: a failed message leaves the read to the tab's own pause", async () => {
  const failing = scheduler("claude", PATHS.claude!, {
    random: 0,
    sharedPause: ownReadSharedPause("claude", () =>
      Promise.reject(new Error("Could not establish connection")),
    ),
  });
  const throwing = scheduler("claude", PATHS.claude!, {
    random: 0,
    sharedPause: ownReadSharedPause("claude", () => {
      throw new Error("Extension context invalidated.");
    }),
  });
  try {
    for (const tab of [failing, throwing]) {
      await settle();
      assert.equal(tab.request("nav-1", CHAT), true);
      tab.advance(1000);
      assert.equal(tab.posted.length, 1);
      await tab.reply({ kind: "http", status: 503, shouldRetry: true });
      await settle();
      assert.equal(tab.request("nav-2", OTHER_CHAT), false, "the tab's own pause still holds");
    }
  } finally {
    failing.close();
    throwing.close();
  }
});

test("own read pause: the background answers only the top frame of an HTTPS page of the named site", async () => {
  const now = 5_000_000;
  const bg = background(() => now);
  const until = now + 60_000;
  const message = { target: OWN_READ_PAUSE_TARGET, site: "claude", until };
  const page = "https://claude.ai/chat/" + CHAT;
  for (const [sender, body] of [
    [bg.sender("https://chatgpt.com/c/" + CHAT), message],
    [bg.sender("https://claude.ai.evil.invalid/chat/" + CHAT), message],
    [bg.sender("http://claude.ai/chat/" + CHAT), message],
    [bg.sender("https://claude.ai:444/chat/" + CHAT), message],
    [bg.sender("https://user:secret@claude.ai/chat/" + CHAT), message],
    [bg.sender(page, { frameId: 1 }), message],
    [bg.sender(page, { tab: undefined }), message],
    [bg.sender(page, { id: "other-extension" }), message],
    [bg.sender(page, { url: undefined }), message],
    [bg.sender(page), { ...message, site: "example" }],
    [bg.sender(page), { ...message, until: String(until) }],
    [bg.sender(page), { ...message, conversationId: CHAT }],
  ] as const)
    assert.equal(bg.pauses.answer(body, sender as any), undefined, JSON.stringify(sender));
  assert.equal(bg.storage.writes.length, 0);
  assert.equal(await bg.pauses.answer(message, bg.sender(page)), until);
  assert.equal(
    await bg.pauses.answer({ target: OWN_READ_PAUSE_TARGET, site: "claude" }, bg.sender(page)),
    until,
  );
  assert.equal(
    await bg.pauses.answer(
      { target: OWN_READ_PAUSE_TARGET, site: "chatgpt" },
      bg.sender("https://chatgpt.com/"),
    ),
    null,
    "each site has its own pause",
  );
});

test("own read pause: the background clamps a far-future time, ignores a past one and keeps the later", async () => {
  let now = 5_000_000;
  const bg = background(() => now);
  const sender = bg.sender("https://gemini.google.com/app/0123456789abcdef");
  const set = (until: number) =>
    bg.pauses.answer({ target: OWN_READ_PAUSE_TARGET, site: "gemini", until }, sender);
  const get = () =>
    bg.pauses.answer({ target: OWN_READ_PAUSE_TARGET, site: "gemini" }, sender);

  assert.equal(await set(now - 1), null, "a time in the past is not stored");
  assert.equal(await set(now), null);
  assert.equal(bg.storage.writes.length, 0);

  assert.equal(await set(now + 100 * OWN_READ_PAUSE_MAX_MS), now + OWN_READ_PAUSE_MAX_MS);
  assert.equal(bg.storage.values.get("own-read-pause:gemini"), now + OWN_READ_PAUSE_MAX_MS);
  assert.equal(await get(), now + OWN_READ_PAUSE_MAX_MS);

  // An earlier time does not shorten the stored pause; a past one leaves it alone.
  assert.equal(await set(now + 1000), now + OWN_READ_PAUSE_MAX_MS);
  assert.equal(await set(now - 1000), now + OWN_READ_PAUSE_MAX_MS);
  assert.equal(bg.storage.values.get("own-read-pause:gemini"), now + OWN_READ_PAUSE_MAX_MS);

  // Two tabs storing at once: the later time stays.
  now += OWN_READ_PAUSE_MAX_MS / 2;
  const [a, b] = await Promise.all([
    set(now + OWN_READ_PAUSE_MAX_MS),
    set(now + 1000),
  ]);
  assert.equal(a, now + OWN_READ_PAUSE_MAX_MS);
  assert.equal(b, now + OWN_READ_PAUSE_MAX_MS);
  assert.equal(await get(), now + OWN_READ_PAUSE_MAX_MS);

  // A stored value that is not a time, or that passed, holds nothing.
  bg.storage.values.set("own-read-pause:gemini", "soon");
  assert.equal(await get(), null);
  now += 2 * OWN_READ_PAUSE_MAX_MS;
  bg.storage.values.set("own-read-pause:gemini", now - 1);
  assert.equal(await get(), null);
  // A wrong stored time far ahead holds at most the longest pause.
  bg.storage.values.set("own-read-pause:gemini", now + 100 * OWN_READ_PAUSE_MAX_MS);
  assert.equal(await get(), now + OWN_READ_PAUSE_MAX_MS);

  // Without session storage the answer is empty and the tab pauses alone.
  bg.storage.fail = true;
  assert.equal(await get(), null);
  assert.equal(await set(now + 1000), null);
  bg.storage.fail = false;
  assert.equal(await set(now + 1000), now + OWN_READ_PAUSE_MAX_MS, "later messages still work");
});
