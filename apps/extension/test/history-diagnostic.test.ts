import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import { createHistoryTextObserver } from "../lib/passive-history-text";
import {
  HISTORY_DIAGNOSTIC_CHANNEL,
  validateHistoryDiagnostic,
} from "../lib/history-capture";

const id = "00000000-0000-4000-8000-000000000042";
const body = readFileSync(
  new URL(
    "../../../fixtures/history-observation-2026-09-14/claude-selected-history.json",
    import.meta.url,
  ),
  "utf8",
);
function locationFor() {
  Object.assign(globalThis, {
    location: {
      origin: "https://claude.ai",
      hostname: "claude.ai",
      pathname: `/chat/${id}`,
      href: `https://claude.ai/chat/${id}`,
    },
  });
  return new URL(
    `https://claude.ai/api/organizations/00000000-0000-4000-8000-000000000011/chat_conversations/${id}`,
  );
}
async function until(check: () => boolean) {
  for (let i = 0; i < 1000 && !check(); i++) await setImmediate();
  assert.ok(check());
  await setImmediate();
}

test("X9 a ninth read in ten seconds waits for the window, only the newest waiting read is taken, and nothing fails", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  const url = locationFor(),
    events: any[] = [],
    diagnostics: any[] = [];
  const observer = createHistoryTextObserver(
    (m) => events.push(m),
    (m) => diagnostics.push(m),
  );
  try {
    for (let i = 1; i <= 8; i++) {
      observer.observe(url, "GET", Promise.resolve(new Response(body)), now);
      await until(() => events.filter((m) => m.event === "page").length === i);
    }
    // The page polls its chat; each response holds the whole chat, so the newest is enough.
    for (let i = 0; i < 100; i++)
      observer.observe(url, "GET", Promise.resolve(new Response(body)), now);
    for (let i = 0; i < 10; i++) await setImmediate();
    assert.equal(events.length, 16);
    assert.equal(diagnostics.length, 0);
    now += 10001;
    t.mock.timers.tick(10001);
    await until(() => events.length === 18);
    assert.equal(events.at(-1).page.messages.length, 2);
    for (let i = 0; i < 10; i++) await setImmediate();
    assert.equal(events.length, 18);
    observer.observe(url, "GET", Promise.resolve(new Response(body)), now);
    await until(() => events.length === 20);
    assert.equal(diagnostics.length, 0);
  } finally {
    observer.cancel();
    Date.now = realNow;
    t.mock.timers.reset();
  }
});
test("two blocked slots get exact timeout terminals and retain physical capacity until settlement", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  const url = locationFor(),
    events: any[] = [],
    diagnostics: any[] = [];
  const observer = createHistoryTextObserver(
    (m) => events.push(m),
    (m) => diagnostics.push(m),
  );
  let release!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => (release = resolve));
  try {
    observer.observe(url, "GET", pending, now);
    observer.observe(url, "GET", pending, now);
    const ids = events.map((m) => m.id);
    now += 30001;
    t.mock.timers.tick(30001);
    assert.deepEqual(
      diagnostics.map((m) => m.id),
      ids,
    );
    assert.ok(
      diagnostics.every(
        (m) =>
          m.reason === "history_timeout" &&
          validateHistoryDiagnostic(m, "claude.ai"),
      ),
    );
    // A read while both slots are held waits; it is not a failure.
    observer.observe(url, "GET", Promise.resolve(new Response(body)), now);
    assert.equal(events.length, 2);
    assert.equal(diagnostics.length, 2);
    release(new Response(body));
    await setImmediate();
    await setImmediate();
    assert.equal(events.length, 2);
    // The settled slots free the waiting read.
    t.mock.timers.tick(0);
    await until(() => events.length === 4);
    assert.equal(diagnostics.length, 2);
    assert.equal(
      diagnostics.filter((m) => m.reason === "history_timeout").length,
      2,
    );
  } finally {
    observer.cancel();
    Date.now = realNow;
    t.mock.timers.reset();
  }
});
test("X9 a newer poll replaces an older waiting one, and a waiting read is dropped when the user leaves the chat", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const url = locationFor(),
    events: any[] = [],
    diagnostics: any[] = [];
  const observer = createHistoryTextObserver(
    (m) => events.push(m),
    (m) => diagnostics.push(m),
  );
  const pages = () => events.filter((m) => m.event === "page").length;
  const hold = () => {
    let release!: (response: Response) => void;
    const promise = new Promise<Response>((resolve) => (release = resolve));
    return { promise, release: () => release(new Response(body)) };
  };
  try {
    const first = hold(),
      second = hold();
    observer.observe(url, "GET", first.promise, Date.now());
    observer.observe(url, "GET", second.promise, Date.now());
    observer.observe(
      url,
      "GET",
      Promise.resolve(new Response(body)),
      Date.now(),
    );
    observer.observe(
      url,
      "GET",
      Promise.resolve(new Response(body)),
      Date.now(),
    );
    first.release();
    second.release();
    await until(() => pages() === 2);
    t.mock.timers.tick(0);
    await until(() => pages() === 3);
    for (let i = 0; i < 10; i++) await setImmediate();
    // Only the newest waiting read was taken.
    assert.equal(pages(), 3);
    const third = hold(),
      fourth = hold();
    observer.observe(url, "GET", third.promise, Date.now());
    observer.observe(url, "GET", fourth.promise, Date.now());
    observer.observe(
      url,
      "GET",
      Promise.resolve(new Response(body)),
      Date.now(),
    );
    const starts = events.filter((m) => m.event === "start").length;
    Object.assign(location, {
      pathname: "/chat/00000000-0000-4000-8000-000000000099",
    });
    third.release();
    fourth.release();
    for (let i = 0; i < 10; i++) await setImmediate();
    t.mock.timers.tick(0);
    for (let i = 0; i < 10; i++) await setImmediate();
    assert.equal(events.filter((m) => m.event === "start").length, starts);
    assert.equal(diagnostics.length, 0);
  } finally {
    observer.cancel();
    t.mock.timers.reset();
  }
});
test("intentional scope cancellation and route changes never produce timeout failures", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const url = locationFor(),
    diagnostics: any[] = [];
  const observer = createHistoryTextObserver(
    () => {},
    (m) => diagnostics.push(m),
  );
  observer.observe(url, "GET", new Promise(() => {}), Date.now());
  observer.cancel();
  t.mock.timers.tick(30001);
  assert.equal(diagnostics.length, 0);
  const other = createHistoryTextObserver(
    () => {},
    (m) => diagnostics.push(m),
  );
  other.observe(url, "GET", new Promise(() => {}), Date.now());
  Object.assign(location, {
    pathname: "/chat/00000000-0000-4000-8000-000000000099",
  });
  t.mock.timers.tick(30001);
  assert.equal(diagnostics.length, 0);
  other.cancel();
  t.mock.timers.reset();
});
test("diagnostics have a strict categorical boundary and never accept a count or arbitrary reason", () => {
  const value = {
    channel: HISTORY_DIAGNOSTIC_CHANNEL,
    site: "claude",
    conversationId: id,
    observedAt: "2026-09-14T12:00:00.000Z",
    id: null,
    reason: "history_limit",
  };
  assert.ok(validateHistoryDiagnostic(value, "claude.ai"));
  for (const v of [
    { ...value, tokens: "33" },
    { ...value, reason: "private-text" },
    { ...value, reason: "history_timeout" },
    { ...value, id: crypto.randomUUID() },
    { ...value, observedAt: "bad" },
  ])
    assert.equal(validateHistoryDiagnostic(v, "claude.ai"), false);
  assert.equal(validateHistoryDiagnostic(value, "chatgpt.com"), false);
});
test("a new route or same-route ownership lifecycle receives its first limit without freeing old physical slots", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const urlA = locationFor(),
    events: any[] = [],
    diagnostics: any[] = [];
  const observer = createHistoryTextObserver(
    (m) => events.push(m),
    (m) => diagnostics.push(m),
  );
  const pending = new Promise<Response>(() => {});
  const now = Date.now();
  try {
    observer.observe(urlA, "GET", pending, now);
    observer.observe(urlA, "GET", pending, now);
    // With both slots held, a third read waits instead of failing.
    observer.observe(urlA, "GET", pending, now);
    assert.equal(diagnostics.length, 0);
    // A read the page refused to share is the limit that is reported.
    observer.rejected(urlA, "GET", now);
    assert.deepEqual(
      diagnostics.map((m) => m.conversationId),
      [id],
    );
    observer.rejected(urlA, "GET", now);
    observer.cancel();
    assert.equal(diagnostics.length, 1);
    const idB = "00000000-0000-4000-8000-000000000099";
    Object.assign(location, {
      pathname: `/chat/${idB}`,
      href: `https://claude.ai/chat/${idB}`,
    });
    const urlB = new URL(urlA.href.replace(id, idB));
    observer.rejected(urlB, "GET", now);
    assert.deepEqual(
      diagnostics.map((m) => m.conversationId),
      [id, idB],
    );
    for (let i = 0; i < 100; i++) observer.rejected(urlB, "GET", now);
    assert.equal(diagnostics.length, 2);
    observer.cancel();
    observer.rejected(urlB, "GET", now);
    assert.equal(diagnostics.length, 3);
    observer.rejected(urlA, "GET", now);
    assert.equal(diagnostics.length, 3);
    Object.assign(location, {
      pathname: `/chat/${id}`,
      href: `https://claude.ai/chat/${id}`,
    });
    observer.rejected(urlA, "GET", now);
    assert.equal(diagnostics.length, 4);
    observer.rejected(urlA, "GET", now);
    assert.equal(diagnostics.length, 4);
    // The old slots stay held until their reads settle; no waiting read started.
    assert.equal(events.length, 2);
    observer.cancel();
    t.mock.timers.tick(30001);
    assert.ok(diagnostics.every((m) => m.reason === "history_limit"));
    assert.equal(diagnostics.length, 4);
  } finally {
    observer.cancel();
    t.mock.timers.reset();
  }
});
