import { FileGrantBroker } from "../lib/file-grant-broker";
import * as ownReadPause from "../lib/own-read-pause";
import * as ownReadSettings from "../lib/own-read-settings";
import * as trackingConsent from "../lib/tracking-consent";
import * as fileRelayProtocol from "../lib/file-relay-protocol";
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { unavailableCount } from "./counting-fixture";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { Ledger } from "@footprint/ledger";
import * as adapters from "@footprint/adapters";
import * as capture from "@footprint/capture-core";
import { HistoryAdmission } from "../lib/history-admission";
import { RouteAuthorities } from "../lib/route-authority";
import * as bridge from "../lib/bridge";
import { HISTORY_LIMITS } from "../lib/history-limits";
import { Coordinator } from "../lib/coordinator";
import { PACKAGED_COUNTING_RUNTIME } from "../lib/counting-config";
const binding = () => ({
  documentNonce: crypto.randomUUID(),
  navigationNonce: crypto.randomUUID(),
  captureId: null,
});
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("acknowledged history batches renew an idle lease without a conversation deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  const gate = new HistoryAdmission();
  const doc = binding();
  const id = crypto.randomUUID();
  try {
    await gate.run(gate.admit("start", id, doc, 1)!, "start", async () => true);
    for (let index = 0; index < 6; index++) {
      t.mock.timers.tick(HISTORY_LIMITS.lifecycleMs - 100);
      const event = index % 2 ? "progress" : "batch";
      await gate.run(gate.admit(event, id, doc, 1)!, event, async () => true);
    }
    await gate.run(
      gate.admit("finish", id, doc, 1)!,
      "finish",
      async () => true,
    );
  } finally {
    gate.invalidateAll();
    t.mock.timers.reset();
  }
});
function start(): adapters.ThreadHistoryMessage {
  return {
    channel: adapters.THREAD_HISTORY_CHANNEL,
    event: "start",
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    site: "perplexity",
    threadId: "00000000-0000-4000-8000-000000000001",
    page: null,
  };
}

for (const phase of ["start", "page"] as const)
  test(`expiry bounds ${phase} waits while unresolved physical operations retain the two-slot ceiling`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
    const gate = new HistoryAdmission(),
      doc = binding();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const aid = crypto.randomUUID(),
      bid = crypto.randomUUID();
    const a = gate.admit("start", aid, doc, 1)!,
      b = gate.admit("start", bid, doc, 1)!;
    if (phase === "page") {
      await gate.run(a, "start", async () => true);
      await gate.run(b, "start", async () => true);
      gate.admit("page", aid, doc, 1);
      gate.admit("page", bid, doc, 1);
    }
    const first = assert.rejects(
      gate.run(a, phase, () => blocked),
      /history_unavailable/,
    );
    const second = assert.rejects(
      gate.run(b, phase, () => blocked),
      /history_unavailable/,
    );
    await tick();
    assert.throws(
      () => gate.admit("start", crypto.randomUUID(), binding(), 1),
      /history_rate_limited/,
    );
    t.mock.timers.tick(HISTORY_LIMITS.lifecycleMs + 1);
    await first;
    await second;
    assert.throws(
      () => gate.admit("start", crypto.randomUUID(), binding(), 1),
      /history_rate_limited/,
    );
    release();
    await tick();
    const fresh = gate.admit("start", crypto.randomUUID(), binding(), 1)!;
    await gate.run(fresh, "start", async () => true);
    gate.invalidateAll();
  });

test("worker startup delay cannot extend a history lifecycle beyond its original start deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 50000 });
  const gate = new HistoryAdmission(),
    doc = binding();
  assert.throws(
    () => gate.admit("start", crypto.randomUUID(), doc, 1, 20000),
    /history_unavailable/,
  );
  const lease = gate.admit("start", crypto.randomUUID(), doc, 1, 20001)!;
  await gate.run(lease, "start", async () => true);
  t.mock.timers.tick(2);
  assert.equal(lease.valid, false);
  assert.equal((gate as any).leases.size, 0);
});

test("history start rate and completed-ID replay protection are independent of active slot release", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  const gate = new HistoryAdmission(),
    doc = binding();
  let previousId = "";
  for (let i = 0; i < HISTORY_LIMITS.startsPerWindow; i++) {
    previousId = crypto.randomUUID();
    const lease = gate.admit("start", previousId, doc, 1)!;
    await gate.run(lease, "start", async () => true);
    await gate.run(
      gate.admit("page", previousId, doc, 1)!,
      "page",
      async () => true,
    );
  }
  assert.equal(gate.admit("start", previousId, doc, 1), null);
  assert.throws(
    () => gate.admit("start", crypto.randomUUID(), doc, 1),
    /history_rate_limited/,
  );
  t.mock.timers.tick(HISTORY_LIMITS.windowMs + 1);
  const next = gate.admit("start", crypto.randomUUID(), doc, 1)!;
  await gate.run(next, "start", async () => true);
  gate.invalidateAll();
});

test("RecordedThreads rejects a spoof flood before ownership reads and normal generation capture still progresses", async () => {
  const db = await Ledger.open("history-admission-" + crypto.randomUUID());
  const c = new Coordinator(db, {
    hasConsent: async () => true,
    count: unavailableCount,
    sendDisplay: async () => {},
    transport: (() => {
      throw new Error("unexpected network");
    }) as any,
  });
  await c.whenReady();
  let release!: () => void,
    reads = 0;
  const blocked = new Promise<void>((resolve) => {
      release = resolve;
    }),
    get = db.get.bind(db);
  db.get = async (...args) => {
    if (args[0] === "policy" && args[1] === "ownership-history" && ++reads <= 2)
      await blocked;
    return get(...args) as any;
  };
  const doc = binding(),
    sender = { tab: { id: 1 }, documentId: "doc" };
  const work = Array.from({ length: 50 }, () =>
    c.threads.receive(start(), doc, sender).catch((error) => error.message),
  );
  await tick();
  assert.equal(reads, 2);
  await c.capture(
    {
      timing: null,
      channel: "ai-footprint-observation-v1",
      version: 1,
      id: crypto.randomUUID(),
      revision: 1,
      event: "dispatch",
      site: "claude",
      at: new Date().toISOString(),
      dispatch: {
        site: "claude",
        action: "send",
        input: "Synthetic input",
        conversationId: null,
        parentId: null,
        requestId: null,
        model: null,
        attachments: 0,
        imageEditParentId: null,
      },
      snapshot: adapters.initialSnapshot(),
      failure: null,
    },
    {
      tab: { id: 1 },
      documentId: "doc",
      frameId: 0,
      url: "https://claude.ai/new",
    },
  );
  assert.equal((await db.rows((await c.currentScope()).namespace)).length, 2);
  c.threads.invalidateAll();
  release();
  const results = await Promise.all(work);
  for (
    let turn = 0;
    turn < 20 && (c.threads as any).admission.leases.size;
    turn++
  )
    await tick();
  assert.equal(
    results.filter((value) => value === "history_rate_limited").length,
    48,
  );
  assert.equal((c.threads as any).pending.size, 0);
  assert.equal((c.threads as any).admission.leases.size, 0);
  db.close();
});

test("invalidation during the ownership snapshot cannot repopulate a late start", async () => {
  const db = await Ledger.open("history-snapshot-" + crypto.randomUUID());
  const c = new Coordinator(db, {
    hasConsent: async () => true,
    count: unavailableCount,
    sendDisplay: async () => {},
  });
  await c.whenReady();
  let release!: () => void, entered!: () => void;
  const blocked = new Promise<void>((resolve) => {
      release = resolve;
    }),
    reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
  const snapshot = db.publicationSnapshot.bind(db);
  db.publicationSnapshot = async (...args) => {
    const result = await snapshot(...args);
    entered();
    await blocked;
    return result;
  };
  const doc = binding();
  const work = assert.rejects(
    c.threads.receive(start(), doc, { tab: { id: 1 } }),
    /history_unavailable/,
  );
  await reached;
  c.threads.invalidate(1, doc.documentNonce);
  await work;
  release();
  await tick();
  await tick();
  assert.equal((c.threads as any).pending.size, 0);
  db.close();
});

/** Runs the real background entry point against a mock coordinator; returns its listener. */
function actualBackground(
  MockCoordinator: unknown,
  open: () => Promise<unknown>,
  contains: () => Promise<boolean> = async () => true,
  /** The address a tab shows now, as the browser reports it. */
  tabAddress: (tabId: number) => string | undefined = () => undefined,
) {
  let listener: any;
  const browser: any = {
    runtime: {
      id: "extension",
      getURL: () => "chrome-extension://extension/",
      onMessage: {
        addListener: (fn: any) => {
          listener = fn;
        },
      },
    },
    tabs: {
      onUpdated: { addListener() {} },
      onRemoved: { addListener() {} },
      query: async () => [],
      sendMessage: async () => {},
      get: async (id: number) => ({ id, url: tabAddress(id) }),
    },
    permissions: { onRemoved: { addListener() {} }, contains },
    alarms: { onAlarm: { addListener() {} } },
  };
  const modules: Record<string, unknown> = {
    "wxt/utils/define-background": {
      defineBackground: (run: () => void) => run(),
    },
    "wxt/browser": { browser },
    "@footprint/ledger": { Ledger: { open } },
    "../lib/coordinator": { Coordinator: MockCoordinator },
    "../lib/counting-config": { PACKAGED_COUNTING_RUNTIME },
    "../lib/history-admission": { HistoryAdmission },
    "../lib/route-authority": { RouteAuthorities },
    "../lib/bridge": bridge,
    "../lib/file-grant-broker": { FileGrantBroker },
    "../lib/file-relay-protocol": fileRelayProtocol,
    "../lib/scope-notifications": {
      observeScopeChanges: async () => ({}),
      observeThreadInvalidations: async () => ({}),
    },
    "@footprint/adapters": adapters,
    "@footprint/capture-core": capture,
    "../lib/server-summary": {},
    "../lib/platform": { scheduleSync: async () => {} },
    "@footprint/file-text/types": {},
    "../lib/company": {},
    "../lib/ownership": {},
    "../lib/own-read-pause": ownReadPause,
    "../lib/own-read-settings": ownReadSettings,
    "../lib/tracking-consent": trackingConsent,
    "../lib/health": { HealthReporter: class {} },
  };
  const source = readFileSync(
    new URL("../entrypoints/background.ts", import.meta.url),
    "utf8",
  ).replaceAll("import.meta.env.BROWSER", '"firefox"');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  new Function("require", "exports", compiled)((name: string) => {
    assert.ok(Object.hasOwn(modules, name), name);
    return modules[name];
  }, {});
  return (message: unknown, sender: unknown) => listener(message, sender);
}

test("actual background reserves only two history lifecycles before startup and permission awaits", async () => {
  let release!: () => void,
    received = 0,
    permissionChecks = 0;
  const startup = new Promise<void>((resolve) => {
    release = resolve;
  });
  const application = {};
  class MockCoordinator {
    constructor(repository: unknown, dependencies: { counting: unknown }) {
      assert.equal(repository, application);
      assert.equal(dependencies.counting, PACKAGED_COUNTING_RUNTIME);
    }
    threads = {
      receive: async () => {
        received++;
        return { observed: false };
      },
      invalidate() {},
      invalidateAll() {},
    };
    async whenReady() {}
    currentScope() {
      return {};
    }
  }
  const listener = actualBackground(
    MockCoordinator,
    () =>
      startup.then(() => ({
        application,
        onRoutingChange: () => () => {},
        onHealthFailure() {},
      })),
    async () => {
      permissionChecks++;
      return true;
    },
  );
  const doc = binding(),
    sender = {
      id: "extension",
      tab: { id: 1 },
      frameId: 0,
      documentId: "doc",
      url: "https://www.perplexity.ai/search/00000000-0000-4000-8000-000000000001",
    };
  const work = Array.from({ length: 50 }, () =>
    listener(
      { target: "thread-history", binding: doc, payload: start() },
      sender,
    ),
  );
  await tick();
  assert.equal(permissionChecks, 0);
  assert.equal(received, 0);
  const invalidated = listener(
    { target: "thread-history-invalidate", binding: doc },
    sender,
  );
  release();
  await invalidated;
  const results = await Promise.all(work);
  assert.equal(
    results.filter((result) => result.code === "history_rate_limited").length,
    48,
  );
  assert.equal(received, 0);
  assert.equal(permissionChecks, 0);
});

// The background trusts nothing a page could forge: a session link is taken only from the top
// frame of a claude.ai tab that shows the chat the link names, and a session's page shown at a
// chat's address only in the shape the content script sends (18 Nov 2026 merged app).
test("actual background refuses forged Claude session links and linked session pages", async () => {
  const chat = "00000000-0000-4000-8000-0000000000c1";
  const session = "cse_0123456789ABCDEFghijklmn";
  const links: unknown[][] = [];
  let pages = 0;
  class MockCoordinator {
    threads = { receive: async () => ({ observed: false }), invalidate() {}, invalidateAll() {} };
    history = {
      receive: async () => {
        pages++;
        return { accepted: true };
      },
      receiveStream: async () => {
        pages++;
        return { accepted: true };
      },
      invalidate() {},
    };
    async whenReady() {}
    currentScope() {
      return {};
    }
    async claudeSessionLink(...link: unknown[]) {
      links.push(link);
      return { kept: true, after: null, counted: null, text: false };
    }
  }
  const shown = `https://claude.ai/chat/${chat}`;
  // The address the tab shows now. The sender's address is the page's first one.
  let address: string | undefined = shown;
  const listener = actualBackground(
    MockCoordinator,
    async () => ({
      application: {},
      onRoutingChange: () => () => {},
      onHealthFailure() {},
    }),
    undefined,
    () => address,
  );
  const sender = {
    id: "extension",
    tab: { id: 1 },
    frameId: 0,
    documentId: "doc",
    url: shown,
  };
  const link = { target: "claude-session-link", chat, session, totals: null };
  for (const [message, from, tab] of [
    [link, { ...sender, id: "another-extension" }, shown],
    [link, { ...sender, frameId: 1 }, shown],
    [link, { ...sender, url: `http://claude.ai/chat/${chat}` }, shown],
    [link, { ...sender, url: `https://claude.ai:8443/chat/${chat}` }, shown],
    [link, { ...sender, url: `https://user@claude.ai/chat/${chat}` }, shown],
    [link, { ...sender, url: `https://chatgpt.com/c/${chat}` }, shown],
    // The tab shows another chat, no chat, another site, or its address cannot be read.
    [link, sender, "https://claude.ai/chat/00000000-0000-4000-8000-0000000000c2"],
    [link, sender, "https://claude.ai/new"],
    [link, sender, `https://chatgpt.com/c/${chat}`],
    [link, sender, undefined],
    [{ ...link, title: "a chat title" }, sender, shown],
    [{ target: "claude-session-link", chat, session }, sender, shown],
    // Only `proven: false` is a confirmation; a proven link carries no such key.
    [{ ...link, proven: true }, sender, shown],
    [{ ...link, proven: "false" }, sender, shown],
  ] as const) {
    address = tab;
    await listener(message, from);
    await tick();
    assert.equal(links.length, 0, JSON.stringify([message, from, tab]));
  }
  address = shown;
  assert.deepEqual(await listener(link, sender), {
    kept: true,
    after: null,
    counted: null,
    text: false,
  });
  assert.deepEqual(links, [[chat, session, null, true]]);
  await listener({ ...link, proven: false }, sender);
  assert.deepEqual(links[1], [chat, session, null, false]);
  // Live check of 23 Nov 2026: Chrome keeps the sender's first loaded address after in-page
  // navigation. A chat started at /new, or opened from the sidebar of another chat, is the
  // chat the tab shows now, so its link is kept.
  for (const first of [
    "https://claude.ai/new",
    "https://claude.ai/chat/00000000-0000-4000-8000-0000000000c2",
  ]) {
    links.length = 0;
    assert.deepEqual(await listener(link, { ...sender, url: first }), {
      kept: true,
      after: null,
      counted: null,
      text: false,
    });
    assert.deepEqual(links, [[chat, session, null, true]], first);
  }

  const page = {
    target: "history-observation",
    binding: binding(),
    message: { site: "claude", conversationId: session, event: "start" },
    linkedRoute: chat,
  };
  for (const [message, from] of [
    [page, { ...sender, id: "another-extension" }],
    [page, { ...sender, frameId: 1 }],
    [{ ...page, text: "hello" }, sender],
    // Only a Claude session's page names a chat it is shown at, and that chat is no session.
    [{ ...page, message: { ...page.message, site: "chatgpt" } }, sender],
    [{ ...page, message: { ...page.message, conversationId: chat } }, sender],
    [{ ...page, linkedRoute: session }, sender],
    [{ ...page, linkedRoute: "not-a-chat" }, sender],
    [{ ...page, linkedRoute: null }, sender],
  ] as const)
    assert.deepEqual(
      await listener(message, from),
      { accepted: false, error: "payload_rejected" },
      JSON.stringify(message),
    );
  assert.equal(pages, 0);
});
