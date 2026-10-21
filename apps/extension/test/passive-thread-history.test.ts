import test from "node:test";
import assert from "node:assert/strict";
import { createThreadHistoryObserver } from "../lib/passive-thread-history";
import { validateThreadHistory } from "@footprint/adapters";

const threadId = "00000000-0000-4000-8000-000000000042";

test("Perplexity recorded membership streams a large host page without a whole-response limit", async () => {
  const origin = "https://www.perplexity.ai";
  Object.assign(globalThis, {
    location: {
      origin,
      href: `${origin}/search/${threadId}`,
      pathname: `/search/${threadId}`,
    },
  });
  const entries = Array.from({ length: 240 }, (_, index) => {
    const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    return {
      frontend_uuid: id,
      uuid: id,
      thread_url_slug: threadId,
      unrelated_text: "x".repeat(5000),
    };
  });
  const body = JSON.stringify({ entries, has_next_page: false });
  assert.ok(new TextEncoder().encode(body).length > 1048576);
  const events: any[] = [];
  const observer = createThreadHistoryObserver((event) => events.push(event));
  const complete = observer.start(`${origin}/rest/thread/${threadId}`);
  assert.ok(complete);
  complete!(Promise.resolve(new Response(body)));
  for (let attempt = 0; attempt < 300 && events.length < 2; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(events.length, 2);
  assert.equal(events[1].event, "page");
  assert.equal(events[1].page.requestIds.length, 240);
  assert.equal(events[1].page.hasNextPage, false);
  assert.equal(validateThreadHistory(events[1]), true);
  observer.cancel();
});

test("a Perplexity thread read started before the address changes binds to the new route", async () => {
  const origin = "https://www.perplexity.ai";
  Object.assign(globalThis, {
    location: { origin, href: `${origin}/`, pathname: "/" },
  });
  const entry = {
    frontend_uuid: "00000000-0000-4000-8000-000000000001",
    uuid: "00000000-0000-4000-8000-000000000001",
    thread_url_slug: threadId,
  };
  const events: any[] = [];
  const observer = createThreadHistoryObserver((event) => events.push(event));
  const complete = observer.start(`${origin}/rest/thread/${threadId}`);
  assert.ok(complete);
  complete!(
    Promise.resolve(
      new Response(JSON.stringify({ entries: [entry], has_next_page: false })),
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(events.length, 0, "nothing is emitted for another route");
  Object.assign(location, {
    pathname: `/search/${threadId}`,
    href: `${origin}/search/${threadId}`,
  });
  for (let attempt = 0; attempt < 100 && events.length < 2; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(
    events.map((event) => event.event),
    ["start", "page"],
  );
  assert.equal(events[0].id, events[1].id);
  // A read that never becomes current emits nothing and releases its slot.
  const other = observer.start(
    `${origin}/rest/thread/00000000-0000-4000-8000-000000000099`,
  );
  other!(Promise.resolve(new Response("{}")));
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(events.length, 2);
  observer.cancel();
});
