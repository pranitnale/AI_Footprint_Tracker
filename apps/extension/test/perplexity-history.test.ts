import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  parsePerplexityHistory,
  validateThreadHistory,
} from "@footprint/adapters";
import { installCapture } from "../lib/capture-runtime";
import { PROVIDER_STREAM_CHANNEL } from "../lib/provider-history-message";
const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../../../fixtures/provider-identity-2026-09-10.json",
      import.meta.url,
    ),
    "utf8",
  ),
).perplexity;
const threadId = fixture.route.split("/").at(-1)!;
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
type Fetcher = typeof globalThis.fetch;
class TestWindow extends EventTarget {
  messages: any[] = [];
  WebSocket = class extends EventTarget {};
  constructor(public fetch: Fetcher) {
    super();
  }
  postMessage(value: any, _origin?: string, ports?: MessagePort[]) {
    this.messages.push(value);
    if (value.channel === PROVIDER_STREAM_CHANNEL) {
      ports?.[0]?.postMessage({ accepted: true });
      ports?.[0]?.close();
    }
  }
}
function environment(fetcher: typeof fetch) {
  const win = new TestWindow(fetcher);
  Object.assign(globalThis, {
    window: win,
    location: {
      origin: "https://www.perplexity.ai",
      hostname: "www.perplexity.ai",
      href: "https://www.perplexity.ai" + fixture.route,
      pathname: fixture.route,
    },
  });
  installCapture();
  return win;
}
test("history parser projects only verified frontend request membership and explicit page incompleteness", () => {
  const body = {
    entries: fixture.entries,
    has_next_page: false,
    thread_metadata: { private: "PRIVATE_HISTORY_MARKER" },
  };
  const page = parsePerplexityHistory(body, threadId)!;
  assert.equal(page.requestIds.length, 6);
  assert.equal(page.hasNextPage, false);
  assert.ok(!JSON.stringify(page).includes("PRIVATE_HISTORY_MARKER"));
  for (const field of ["context_uuid", "frontend_context_uuid", "backend_uuid"])
    assert.ok(!Object.hasOwn(page, field));
  assert.equal(
    parsePerplexityHistory(
      {
        ...body,
        entries: [{ ...fixture.entries[0], uuid: fixture.entries[1].uuid }],
      },
      threadId,
    ),
    null,
  );
  assert.equal(
    parsePerplexityHistory(
      {
        ...body,
        entries: [
          {
            ...fixture.entries[0],
            thread_url_slug: fixture.entries[0].context_uuid,
          },
        ],
      },
      threadId,
    ),
    null,
  );
  assert.deepEqual(
    parsePerplexityHistory(
      { ...body, entries: Array(101).fill(fixture.entries[0]) },
      threadId,
    ),
    { requestIds: [fixture.entries[0].frontend_uuid], hasNextPage: false },
  );
  assert.equal(
    parsePerplexityHistory({ ...body, has_next_page: null }, threadId),
    null,
  );
  assert.deepEqual(
    parsePerplexityHistory(
      {
        ...body,
        entries: [fixture.entries[0], fixture.entries[0]],
        has_next_page: true,
      },
      threadId,
    ),
    { requestIds: [fixture.entries[0].frontend_uuid], hasNextPage: true },
  );
});
test("actual fetch hook returns original promise/body and emits only a separate bounded history projection", async () => {
  const body = JSON.stringify({
    entries: fixture.entries,
    has_next_page: true,
    text: "PRIVATE_HISTORY_MARKER",
  });
  const original = Promise.resolve(new Response(body));
  let actualArgs: unknown[] = [],
    calls = 0;
  const win = environment(function (...args: any[]) {
    actualArgs = args;
    calls++;
    return original;
  } as typeof fetch);
  const url =
      "https://www.perplexity.ai" + fixture.history_path + "?limit=6&offset=0",
    init = { method: "GET", headers: { "X-Test": "same" } };
  try {
    const result = win.fetch(url, init);
    assert.equal(result, original);
    assert.equal(actualArgs[0], url);
    assert.equal(actualArgs[1], init);
    assert.equal(await (await result).text(), body);
    await tick();
    assert.equal(calls, 1);
    const membership = win.messages.filter(
      (m) => m.channel === "ai-footprint-thread-history-v1",
    );
    assert.equal(membership.length, 2);
    assert.ok(membership.every(validateThreadHistory));
    assert.deepEqual(
      membership.map((m) => m.event),
      ["start", "page"],
    );
    assert.equal(membership[1].page!.requestIds.length, 6);
    assert.equal(membership[1].id, membership[0].id);
    assert.ok(!JSON.stringify(win.messages).includes("PRIVATE_HISTORY_MARKER"));
    assert.ok(
      win.messages.every(
        (m) => String(m.channel) !== "ai-footprint-observation-v1",
      ),
    );
  } finally {
    win.dispatchEvent(new Event("pagehide"));
  }
});
for (const change of [
  "navigation",
  "pagehide",
  "permission",
  "mismatched_membership",
] as const)
  test(`passive history ${change} cancels only measurement and emits no membership page`, async () => {
    let resolve!: (r: Response) => void;
    const original = new Promise<Response>((done) => {
      resolve = done;
    });
    const win = environment((() => original) as typeof fetch);
    try {
      const result = win.fetch(
        "https://www.perplexity.ai" + fixture.history_path,
      );
      if (change === "navigation")
        (globalThis.location as any).pathname =
          "/search/00000000-0000-4000-8000-000000000099";
      if (change === "pagehide") win.dispatchEvent(new Event("pagehide"));
      if (change === "permission") {
        const event = new Event("message");
        Object.assign(event, {
          source: win,
          origin: location.origin,
          data: { channel: "ai-footprint-control-v1", action: "stop" },
        });
        win.dispatchEvent(event);
      }
      const body = JSON.stringify({
        entries:
          change === "mismatched_membership"
            ? [
                {
                  ...fixture.entries[0],
                  thread_url_slug: fixture.entries[0].context_uuid,
                },
              ]
            : fixture.entries,
        has_next_page: false,
        text: "host response",
      });
      resolve(new Response(body));
      assert.equal(await (await result).text(), body);
      await tick();
      assert.equal(
        win.messages.filter(
          (m) =>
            m.channel === "ai-footprint-thread-history-v1" &&
            m.event === "page",
        ).length,
        0,
      );
    } finally {
      win.dispatchEvent(new Event("pagehide"));
    }
  });
