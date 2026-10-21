import assert from "node:assert/strict";
import test from "node:test";
import {
  createProviderAdapterRegistry,
  initialSnapshot,
  type Dispatch,
  type ProviderAdapter,
  type ProviderAdapterRegistry,
} from "@footprint/adapters";
import { installCapture } from "../lib/capture-runtime";
import { CHANNEL, validateCapture, type CaptureMessage } from "../lib/bridge";

class CaptureWindow extends EventTarget {
  messages: Array<{ value: CaptureMessage; origin: string }> = [];
  WebSocket = class extends EventTarget {} as unknown as typeof WebSocket;
  constructor(public fetch: typeof globalThis.fetch) {
    super();
  }
  postMessage(value: CaptureMessage, origin: string) {
    this.messages.push({ value, origin });
  }
}

function environment(
  t: test.TestContext,
  fetcher: typeof fetch,
  registry: ProviderAdapterRegistry,
  hostname = "claude.ai",
) {
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const savedLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  const window = new CaptureWindow(fetcher);
  Object.assign(globalThis, {
    window,
    location: {
      hostname,
      origin: `https://${hostname}`,
      href: `https://${hostname}/new`,
      pathname: "/new",
    },
  });
  t.after(() => {
    window.dispatchEvent(new Event("pagehide"));
    for (const [key, descriptor] of [
      ["window", savedWindow],
      ["location", savedLocation],
    ] as const) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  installCapture(registry);
  return window;
}

function fixtureAdapter() {
  const calls = { routes: 0, dispatches: 0, sessions: 0, frames: 0 };
  const dispatch: Dispatch = {
    site: "claude",
    action: "send",
    input: "fixture-only input",
    conversationId: "00000000-0000-4000-8000-000000000042",
    parentId: null,
    requestId: "fixture-request",
    model: null,
    attachments: 0,
    imageEditParentId: null,
  };
  const adapter: ProviderAdapter = {
    site: "claude",
    responseFormat: "sse",
    generationRoute(url, method) {
      calls.routes++;
      return url.pathname === "/fixture/generate" && method === "POST";
    },
    parseDispatch(_url, body) {
      calls.dispatches++;
      assert.equal(body, "fixture dispatch syntax");
      return { ...dispatch };
    },
    createSession() {
      calls.sessions++;
      const snapshot = initialSnapshot();
      return {
        frame(frame) {
          calls.frames++;
          assert.equal(frame.event, "fixture");
          snapshot.text = frame.value.answer;
          snapshot.outputId = "fixture-response";
          snapshot.conversationId = dispatch.conversationId;
          snapshot.started = true;
          snapshot.state = "completed";
        },
        snapshot: () => structuredClone(snapshot),
        stopped() {
          snapshot.state = "cancelled";
        },
      };
    },
  };
  return { adapter, calls, dispatch };
}

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 1500;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "capture did not settle");
    await new Promise(setImmediate);
  }
}

test("AR04 injected local adapter produces validated capture while preserving the exact native fetch", async (t) => {
  const fixture = fixtureAdapter();
  const registry = createProviderAdapterRegistry([fixture.adapter]);
  const wire = 'event: fixture\ndata: {"answer":"fixture-only output"}\n\n';
  const response = new Response(wire);
  const nativePromise = Promise.resolve(response);
  const invocations: unknown[][] = [];
  const native = function (this: unknown, ...args: unknown[]) {
    invocations.push([this, ...args]);
    return nativePromise;
  } as typeof fetch;
  const window = environment(t, native, registry);
  // The registry snapshots function identities before the caller can replace them.
  Object.assign(fixture.adapter, {
    createSession: () => assert.fail("mutable registration leaked"),
  });
  const url = "https://claude.ai/fixture/generate";
  const init = { method: "POST", body: "fixture dispatch syntax" };
  assert.equal(window.fetch(url, init), nativePromise);
  assert.equal(await nativePromise, response);
  assert.equal(await response.text(), wire);
  await waitFor(() =>
    window.messages.some(({ value }) => value.event === "end"),
  );
  assert.deepEqual(invocations, [[window, url, init]]);
  const captured = window.messages.filter(
    ({ value }) => value.channel === CHANNEL,
  );
  assert.ok(
    captured.every(
      ({ value, origin }) =>
        validateCapture(value, "claude.ai") && origin === "https://claude.ai",
    ),
  );
  assert.deepEqual(
    captured.find(({ value }) => value.event === "dispatch")?.value.dispatch,
    fixture.dispatch,
  );
  assert.equal(captured.at(-1)?.value.snapshot?.text, "fixture-only output");
  assert.equal(captured.at(-1)?.value.snapshot?.state, "completed");
  assert.equal(
    captured.filter(({ value }) => value.event === "health").length,
    0,
  );
  // One route check decides the capture; the passive coverage check asks once more (12 Oct 2026).
  assert.deepEqual(fixture.calls, {
    routes: 2,
    dispatches: 1,
    sessions: 1,
    frames: 1,
  });
});

test("an injected adapter cannot bypass origin or permission controls", async (t) => {
  const fixture = fixtureAdapter();
  let nativeCalls = 0;
  const window = environment(
    t,
    (() => {
      nativeCalls++;
      return Promise.resolve(new Response("native"));
    }) as typeof fetch,
    createProviderAdapterRegistry([fixture.adapter]),
  );
  await window.fetch("https://foreign.example/fixture/generate", {
    method: "POST",
  });
  assert.equal(fixture.calls.routes, 0);
  const control = (origin: string, source: unknown) => {
    const event = new Event("message");
    Object.assign(event, {
      source,
      origin,
      data: { channel: "ai-footprint-control-v1", action: "stop" },
    });
    window.dispatchEvent(event);
  };
  const installed = window.fetch;
  control("https://foreign.example", window);
  control("https://claude.ai", {});
  assert.equal(window.fetch, installed);
  control("https://claude.ai", window);
  assert.notEqual(window.fetch, installed);
  await window.fetch("https://claude.ai/fixture/generate", { method: "POST" });
  assert.equal(nativeCalls, 2);
  assert.equal(fixture.calls.sessions, 0);
});

test("adapter construction failure preserves native delivery", async (t) => {
  const fixture = fixtureAdapter();
  const response = Promise.resolve(new Response("native response"));
  const adapter = {
    ...fixture.adapter,
    createSession: () => {
      throw new Error("fixture unavailable");
    },
  };
  const window = environment(
    t,
    (() => response) as typeof fetch,
    createProviderAdapterRegistry([adapter]),
  );
  assert.equal(
    window.fetch("https://claude.ai/fixture/generate", { method: "POST" }),
    response,
  );
  assert.equal(await (await response).text(), "native response");
  assert.equal(
    window.messages.filter(({ value }) => value.event === "health").length,
    1,
  );
  assert.equal(
    window.messages.filter(({ value }) => value.event !== "health").length,
    0,
  );
});

test("the canonical capture validator rejects an injected cross-site dispatch", async (t) => {
  const fixture = fixtureAdapter();
  const wire = 'event: fixture\ndata: {"answer":"fixture-only output"}\n\n';
  const native = Promise.resolve(new Response(wire));
  const adapter: ProviderAdapter = {
    ...fixture.adapter,
    parseDispatch: () => ({ ...fixture.dispatch, site: "chatgpt" }),
  };
  const window = environment(
    t,
    (() => native) as typeof fetch,
    createProviderAdapterRegistry([adapter]),
  );
  assert.equal(
    window.fetch("https://claude.ai/fixture/generate", {
      method: "POST",
      body: "fixture dispatch syntax",
    }),
    native,
  );
  await waitFor(() =>
    window.messages.some(({ value }) => value.event === "health"),
  );
  assert.equal(await (await native).text(), wire);
  await new Promise(setImmediate);
  assert.ok(
    window.messages.every(
      ({ value }) =>
        value.event === "health" && value.failure === "unsupported_schema",
    ),
  );
});

test("a supported-site registry does not activate capture on an unknown host", (t) => {
  const fixture = fixtureAdapter();
  const native = (() =>
    Promise.resolve(new Response("native"))) as typeof fetch;
  const window = environment(
    t,
    native,
    createProviderAdapterRegistry([fixture.adapter]),
    "unrelated.example",
  );
  assert.equal(window.fetch, native);
  assert.equal(fixture.calls.routes, 0);
});
