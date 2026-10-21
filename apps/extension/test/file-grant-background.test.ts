import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { unavailableCount } from "./counting-fixture";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { Ledger } from "@footprint/ledger";
import * as adapters from "@footprint/adapters";
import * as capture from "@footprint/capture-core";
import * as fileTypes from "@footprint/file-text/types";
import { countAccessibleFile } from "@footprint/file-text";
import { Coordinator } from "../lib/coordinator";
import { PACKAGED_COUNTING_RUNTIME } from "../lib/counting-config";
import { FileGrantBroker } from "../lib/file-grant-broker";
import * as protocol from "../lib/file-relay-protocol";
import * as ownership from "../lib/ownership";
import * as ownReadPause from "../lib/own-read-pause";
import * as ownReadSettings from "../lib/own-read-settings";
import * as trackingConsent from "../lib/tracking-consent";
import * as health from "../lib/health";
import { HistoryAdmission } from "../lib/history-admission";
import { RouteAuthorities } from "../lib/route-authority";
import * as bridge from "../lib/bridge";
async function harness(
  policy: "user_controlled" | "disabled_by_company" | null,
  paused: boolean,
  family: "chrome" | "firefox" = "firefox",
  /** DOMException name that Ledger.open rejects with, or null for working storage. */
  startupStorageError: string | null = null,
  /** Builds the coordinator as the background does, requiring the agreement to tracking. */
  requireTrackingConsent = false,
) {
  const db = await Ledger.open("file-pause-" + crypto.randomUUID());
  const c = new Coordinator(db, {
    hasConsent: async () => true,
    count: unavailableCount,
    sendDisplay: async () => {},
    requireTrackingConsent,
  });
  await c.whenReady();
  if (policy) {
    const scope = {
      namespace: "company:" + crypto.randomUUID() + ":" + crypto.randomUUID(),
      mode: "company" as const,
      era: crypto.randomUUID(),
    };
    const credentials = {
      key: "credentials",
      namespace: scope.namespace,
      device_id: crypto.randomUUID(),
      enrollment_era: { id: scope.era },
      origin: "https://company.example",
      policy: { pause_mode: policy, deletion_epoch: 0 },
    };
    const history = await db.get<ownership.OwnershipHistory>(
      "policy",
      "ownership-history",
    );
    await db.policyTransaction([
      credentials,
      ownership.transitionOwnership(history!, {
        scope,
        secret: "a".repeat(64),
        policyVersion: "1.0.0",
      }) as any,
    ]);
  }
  await db.put("policy", { ...(await c.settings()), paused });
  let listener: any,
    broker!: FileGrantBroker,
    countCalls = 0,
    release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let block = false;
  const root = `${family === "chrome" ? "chrome" : "moz"}-extension://pause/`;
  let serviceMessage: ((event: any) => void) | undefined;
  let reporter!: health.HealthReporter;
  let permission = true,
    removed!: () => void;
  const badges: string[] = [];
  let currentTab = { id: 2, url: "https://chatgpt.com/" };
  // Provider tabs the background notifies (none unless a test opens one) and what it sent them.
  let providerTabs: Array<{ id: number }> = [];
  const tabMessages: unknown[] = [];
  const session = new Map<string, unknown>();
  const browser: any = {
    storage: {
      session: {
        get: async (key: string) =>
          session.has(key) ? { [key]: session.get(key) } : {},
        set: async (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items)) session.set(key, value);
        },
      },
    },
    runtime: {
      id: "pause",
      getURL: (path: string) => root + path.replace(/^\//, ""),
      onMessage: { addListener: (fn: any) => (listener = fn) },
    },
    permissions: {
      contains: async () => permission,
      onRemoved: {
        addListener(fn: () => void) {
          removed = fn;
        },
      },
    },
    tabs: {
      get: async () => currentTab,
      onUpdated: { addListener() {} },
      sendMessage: async (_tabId: number, message: unknown) => {
        tabMessages.push(message);
        return { current: true };
      },
      query: async () => providerTabs,
      onRemoved: { addListener() {} },
    },
    alarms: { onAlarm: { addListener() {} } },
    action: {
      setBadgeText: async ({ text }: { text: string }) => {
        badges.push(text);
      },
      setBadgeBackgroundColor: async () => {},
    },
  };
  const modules: Record<string, any> = {
    "wxt/utils/define-background": { defineBackground: (fn: any) => fn() },
    "wxt/browser": { browser },
    "../lib/counting-config": { PACKAGED_COUNTING_RUNTIME },
    "@footprint/ledger": {
      Ledger: {
        open: async () => {
          if (startupStorageError)
            throw new DOMException(
              "PRIVATE_STORAGE_ERROR",
              startupStorageError,
            );
          return db;
        },
      },
    },
    "../lib/coordinator": {
      Coordinator: class {
        constructor() {
          return c;
        }
      },
    },
    "../lib/file-grant-broker": {
      FileGrantBroker: class {
        constructor(options: any) {
          broker = new FileGrantBroker(options);
          return broker;
        }
      },
    },
    "../lib/file-relay-protocol": protocol,
    "../lib/history-admission": { HistoryAdmission },
    "../lib/route-authority": { RouteAuthorities },
    "../lib/bridge": bridge,
    "../lib/scope-notifications": {
      observeScopeChanges: async () => ({}),
      observeThreadInvalidations: async () => ({}),
    },
    "../lib/platform": {
      hasCompanyConsent: async () => permission,
      scheduleSync: async () => {},
      countFileLocally: async (job: any) => {
        countCalls++;
        if (block) {
          await gate;
          return fileTypes.unavailable(job, "cancelled");
        }
        return countAccessibleFile(job);
      },
    },
    "../lib/server-summary": {},
    "../lib/company": {},
    "../lib/health": {
      ...health,
      HealthReporter: class extends health.HealthReporter {
        constructor(badge: () => Promise<unknown>) {
          super(badge);
          reporter = this;
        }
      },
    },
    "../lib/ownership": ownership,
    "../lib/own-read-pause": ownReadPause,
    "../lib/own-read-settings": ownReadSettings,
    "../lib/tracking-consent": trackingConsent,
    "@footprint/adapters": adapters,
    "@footprint/capture-core": capture,
    "@footprint/file-text/types": fileTypes,
  };
  const source = readFileSync(
    new URL("../entrypoints/background.ts", import.meta.url),
    "utf8",
  ).replaceAll("import.meta.env.BROWSER", JSON.stringify(family));
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  new Function("require", "exports", "globalThis", compiled)(
    (name: string) => {
      assert.ok(name in modules, name);
      return modules[name];
    },
    {},
    {
      addEventListener: (_name: string, listener: any) => {
        serviceMessage = listener;
      },
    },
  );
  const sender = {
    id: "pause",
    url: "https://chatgpt.com/",
    tab: { id: 2 },
    frameId: 0,
    documentId: "parent",
  };
  const request = {
    target: "file-grant",
    binding: {
      documentNonce: crypto.randomUUID(),
      navigationNonce: crypto.randomUUID(),
      captureId: null,
    },
    fileHandle: crypto.randomUUID(),
    kind: "text",
    size: 5,
    observedAt: Date.now(),
  };
  return {
    db,
    c,
    health: () => reporter,
    removePermission: () => {
      permission = false;
      removed();
    },
    broker,
    sender,
    request,
    listener,
    serviceMessage,
    root,
    setTab: (url: string) => {
      currentTab = { ...currentTab, url };
    },
    block: () => {
      block = true;
    },
    release,
    countCalls: () => countCalls,
    badges: () => [...badges],
    openProviderTab: () => {
      providerTabs = [{ id: 2 }];
    },
    tabMessages,
    session,
    close: () => {
      release();
      broker.invalidate();
      db.close();
    },
  };
}
test("actual background reports a failed diagnostic write once across scoped fallback and outer capture catch", async () => {
  const f = await harness(null, false);
  try {
    const ui = { id: "pause", url: f.root + "popup.html" };
    await f.listener({ target: "ui", action: "tracking-health" }, ui);
    const scope = await f.c.currentScope();
    f.c.capture = async () => {
      await f.db.health(scope.namespace, "partial_capture");
      return "processed" as const;
    };
    f.db.close();
    const id = crypto.randomUUID();
    const message = {
      target: "capture",
      payload: { id },
      binding: { ...f.request.binding, captureId: id },
    };
    const result = await f.listener(message, f.sender);
    assert.equal(result.code, "storage_write_failed");
    const issues = f.health().list(scope.namespace);
    assert.deepEqual(
      issues.map((issue) => [issue.code, issue.scope, issue.count]),
      [
        ["partial_capture", "current", 1],
        ["storage_write_failed", "current", 1],
      ],
    );
    assert.deepEqual(f.health().list(), []);
    f.c.capture = async () => {
      throw new DOMException("PRIVATE_NEW_FAILURE", "InvalidStateError");
    };
    await f.listener(message, f.sender);
    assert.deepEqual(
      f
        .health()
        .list()
        .map((issue) => [issue.code, issue.count]),
      [["storage_write_failed", 1]],
    );
    assert.ok(!JSON.stringify(f.health().list()).includes("PRIVATE"));
  } finally {
    f.close();
  }
});
for (const company of [false, true])
  test(`permission failure records one durable ${company ? "company" : "site"} diagnostic without duplicating it in memory`, async () => {
    const f = await harness(company ? "user_controlled" : null, false);
    try {
      await f.listener(
        { target: "ui", action: "tracking-health" },
        { id: "pause", url: f.root + "popup.html" },
      );
      const scope = await f.c.currentScope();
      if (!company) await f.listener({ target: "capture-status" }, f.sender);
      let saved!: () => void;
      const written = new Promise<void>((resolve) => {
        saved = resolve;
      });
      const original = f.db.health.bind(f.db);
      f.db.health = async (...args) => {
        await original(...args);
        saved();
      };
      f.removePermission();
      await written;
      const persisted = await f.db.list<any>("health", scope.namespace);
      assert.deepEqual(
        persisted.map((issue) => [issue.code, issue.count]),
        [[company ? "policy_unavailable" : "capture_hook_missing", 1]],
      );
      assert.deepEqual(f.health().list(scope.namespace), []);
    } finally {
      f.close();
    }
  });
test("conversation summary returns its sanitized cause without exposing route or exception data", async () => {
  const f = await harness(null, false);
  try {
    const conversationId = crypto.randomUUID();
    const sender = {
      ...f.sender,
      url: `https://www.perplexity.ai/search/${conversationId}`,
    };
    f.setTab(sender.url);
    f.c.routeSummary = async () => {
      throw new Error("protocol_unsupported");
    };
    const request = {
      target: "conversation-summary",
      conversationId,
      binding: f.request.binding,
    };
    assert.equal(
      (await f.listener(request, sender)).code,
      "protocol_unsupported",
    );
    f.c.routeSummary = async () => {
      throw new Error("PRIVATE_PROVIDER_TEXT");
    };
    const result = await f.listener(request, sender);
    assert.equal(result.code, "ledger_integrity_failed");
    assert.ok(!JSON.stringify(result).includes("PRIVATE_PROVIDER_TEXT"));
    assert.ok(!JSON.stringify(result).includes(conversationId));
  } finally {
    f.close();
  }
});
test("actual background keeps the own-read pause per site in session storage for that site's pages only", async () => {
  const f = await harness(null, false, "chrome");
  try {
    const until = Date.now() + 60_000;
    const claude = { ...f.sender, url: "https://claude.ai/chat/x" };
    const message = { target: "own-read-pause", site: "claude", until };
    assert.equal(await f.listener(message, f.sender), undefined, "a ChatGPT page cannot set Claude's pause");
    assert.equal(await f.listener(message, { ...claude, frameId: 1 }), undefined);
    assert.equal(f.session.size, 0);
    assert.equal(await f.listener(message, claude), until);
    assert.deepEqual([...f.session], [["own-read-pause:claude", until]]);
    assert.equal(
      await f.listener({ target: "own-read-pause", site: "claude" }, claude),
      until,
    );
    assert.equal(
      await f.listener({ target: "own-read-pause", site: "chatgpt" }, f.sender),
      null,
    );
  } finally {
    f.close();
  }
});
test("actual background keeps no bar placement problem before the person agreed to tracking", async () => {
  const f = await harness(null, false, "chrome", null, true);
  try {
    const namespace = async () => (await f.c.currentScope()).namespace;
    // Before the agreement nothing is recorded, not even a health receipt (lib/tracking-consent.ts).
    await f.listener({ target: "placement-health" }, f.sender);
    assert.deepEqual(await f.c.ledger.listHealth(await namespace()), []);
    await f.c.setTrackingConsent({ agreed: true, version: trackingConsent.TRACKING_CONSENT_VERSION });
    await f.listener({ target: "placement-health" }, f.sender);
    assert.deepEqual(
      (await f.c.ledger.listHealth(await namespace())).map((row: any) => row.code),
      ["composer_anchor_missing"],
      "once agreed the bar's placement problem is kept as before",
    );
  } finally {
    f.close();
  }
});
// Live, 21 Oct 2026: with tracking paused the bar showed Processing for about 30 s for a reply
// that was not recorded. Open provider tabs learn at once when Pause changes, and ask the
// tracking state, which says whether tracking is paused.
test("actual background tells open provider tabs when Pause changes and answers the tracking state with it", async () => {
  const f = await harness(null, false, "chrome");
  try {
    f.openProviderTab();
    const ui = { id: "pause", url: f.root + "dashboard.html" };
    const settle = async () => {
      for (let i = 0; i < 10; i++) await new Promise(setImmediate);
    };
    const notices = () =>
      f.tabMessages.filter(
        (message: any) => message?.target === trackingConsent.TRACKING_STATE_CHANGED,
      ).length;
    const state = () =>
      f.listener({ target: trackingConsent.TRACKING_STATE_TARGET }, f.sender);
    assert.deepEqual(await state(), { consent: "agreed", organization: null, paused: false });
    await f.listener({ target: "ui", action: "settings", changes: { paused: true } }, ui);
    await settle();
    assert.equal(notices(), 1, "pausing tells open tabs");
    assert.deepEqual(await state(), { consent: "agreed", organization: null, paused: true });
    // A page saves its whole copy of the settings; an unchanged Pause sends no notice.
    await f.listener(
      { target: "ui", action: "settings", changes: { ...(await f.c.settings()), timezone: "Europe/Berlin" } },
      ui,
    );
    await settle();
    assert.equal(notices(), 1);
    await f.listener({ target: "ui", action: "settings", changes: { paused: false } }, ui);
    await settle();
    assert.equal(notices(), 2, "resuming tells open tabs");
    assert.deepEqual(await state(), { consent: "agreed", organization: null, paused: false });
  } finally {
    f.close();
  }
});
for (const policy of ["user_controlled", "disabled_by_company"] as const)
  test(`actual background reports a saved Pause as ${policy === "disabled_by_company" ? "not paused when the organization requires tracking" : "paused under an organization that allows it"}`, async () => {
    const f = await harness(policy, true, "chrome");
    try {
      const answer = await f.listener({ target: trackingConsent.TRACKING_STATE_TARGET }, f.sender);
      assert.equal(answer.paused, policy === "user_controlled");
    } finally {
      f.close();
    }
  });
test("actual background starts on a fresh, empty ledger without a tracking problem or badge", async () => {
  const f = await harness(null, false, "chrome");
  try {
    const ui = { id: "pause", url: f.root + "popup.html" };
    const engine = await f.listener(
      { target: "ui", action: "engine-status" },
      ui,
    );
    assert.equal(engine.code, undefined);
    assert.ok(engine.effectiveEngine);
    const tracking = await f.listener(
      { target: "ui", action: "tracking-health" },
      ui,
    );
    assert.equal(tracking.status, "available");
    assert.deepEqual(tracking.health, []);
    const dashboard = await f.listener(
      { target: "ui", action: "dashboard", filters: {} },
      ui,
    );
    assert.equal(dashboard.summary.requests, 0);
    assert.deepEqual(f.health().list(), []);
    assert.deepEqual(f.badges(), []);
  } finally {
    f.close();
  }
});
// Chrome rejects the first open with UnknownError when it cannot create the
// database files, for example when a Windows profile folder path is too long.
// That is a storage failure, not a ledger integrity problem.
for (const errorName of ["InvalidStateError", "UnknownError"])
  test(`background health RPC remains available with safe memory diagnostics when startup storage fails with ${errorName}`, async () => {
    const f = await harness(null, false, "firefox", errorName);
    try {
      const ui = { id: "pause", url: f.root + "popup.html" };
      const result = await f.listener(
        { target: "ui", action: "tracking-health" },
        ui,
      );
      assert.equal(result.status, "unavailable");
      assert.ok(
        result.health.some(
          (issue: any) =>
            issue.code === "storage_write_failed" &&
            issue.persistence === "memory" &&
            issue.scope === "extension",
        ),
      );
      assert.ok(
        !result.health.some(
          (issue: any) => issue.code === "ledger_integrity_failed",
        ),
      );
      assert.ok(!JSON.stringify(result).includes("PRIVATE_STORAGE_ERROR"));
      const engine = await f.listener(
        { target: "ui", action: "engine-status" },
        ui,
      );
      assert.equal(engine.code, "storage_write_failed");
      assert.ok(f.badges().length > 0);
      assert.ok(f.badges().every((text) => text === "!"));
      for (let retry = 0; retry < 5; retry++) {
        const repeated = await f.listener(
          { target: "ui", action: "tracking-health" },
          ui,
        );
        assert.equal(
          repeated.health.find(
            (issue: any) => issue.code === "storage_write_failed",
          ).count,
          1,
        );
      }
      assert.equal(
        await f.listener({ target: "ui", action: "tracking-health" }, f.sender),
        undefined,
      );
    } finally {
      f.close();
    }
  });
for (const policy of [null, "user_controlled", "disabled_by_company"] as const)
  test(`actual background applies effective file pause for ${policy ?? "personal"}`, async () => {
    const f = await harness(policy, true);
    try {
      const result = await f.listener(f.request, f.sender);
      assert.equal(
        result.status,
        policy === "disabled_by_company" ? "granted" : "unavailable",
      );
      assert.equal(f.countCalls(), 0);
    } finally {
      f.close();
    }
  });
test("acknowledged pause then resume cannot revive in-flight file work or release its physical slot early", async () => {
  const f = await harness(null, false);
  try {
    f.block();
    const grant = await f.listener(f.request, f.sender);
    assert.equal(grant.status, "granted");
    const relaySender = {
        id: "pause",
        url: f.root + "file-relay.html",
        tab: { id: 2 },
        frameId: 8,
        documentId: "relay",
      },
      nonce = crypto.randomUUID();
    const redeemed = await f.listener(
      {
        target: "file-relay-redeem",
        grant: grant.grant,
        parentOrigin: "https://chatgpt.com",
        relayNonce: nonce,
      },
      relaySender,
    );
    assert.equal(redeemed.status, "redeemed");
    const work = f.listener(
      {
        target: "file-relay-count",
        token: redeemed.token,
        relayNonce: nonce,
        job: {
          jobId: redeemed.spec.jobId,
          revision: 1,
          kind: "text",
          bytes: new TextEncoder().encode("hello").buffer,
        },
      },
      relaySender,
    );
    while (!f.countCalls()) await new Promise(setImmediate);
    const ui = { id: "pause", url: f.root + "dashboard.html" };
    assert.deepEqual(
      await f.listener(
        { target: "ui", action: "settings", changes: { paused: true } },
        ui,
      ),
      { ok: true },
    );
    assert.deepEqual(
      await f.listener(
        { target: "ui", action: "settings", changes: { paused: false } },
        ui,
      ),
      { ok: true },
    );
    assert.equal((await work).status, "unavailable");
    assert.equal(
      (
        await f.listener(
          {
            ...f.request,
            fileHandle: crypto.randomUUID(),
            observedAt: Date.now(),
          },
          f.sender,
        )
      ).code,
      "file_busy",
    );
    f.release();
    await new Promise(setImmediate);
    await new Promise(setImmediate);
    assert.equal(
      await (f.broker as any).getUnassociated(f.request.fileHandle),
      null,
    );
  } finally {
    f.close();
  }
});

for (const terminal of ["complete", "cancel"] as const)
  test(`raw service-worker relay events retain bounded waitUntil through ${terminal}`, async (t) => {
    const f = await harness(null, false, "chrome");
    if (terminal === "cancel") t.mock.timers.enable({ apis: ["setTimeout"] });
    const ports: MessagePort[] = [];
    const reply = (port: MessagePort) =>
      new Promise<any>((resolve) => {
        port.addEventListener("message", (event) => resolve(event.data), {
          once: true,
        });
        port.start();
      });
    try {
      const grant = await f.listener(f.request, f.sender);
      const relaySender = {
          id: "pause",
          url: f.root + "file-relay.html",
          tab: { id: 2 },
          frameId: 8,
          documentId: "relay",
        },
        nonce = crypto.randomUUID();
      const redeemed = await f.listener(
        {
          target: "file-relay-redeem",
          grant: grant.grant,
          parentOrigin: "https://chatgpt.com",
          relayNonce: nonce,
        },
        relaySender,
      );
      const source = { url: relaySender.url, id: "actual-sw-client" };
      const registration = new MessageChannel();
      ports.push(registration.port1, registration.port2);
      let held: Promise<void> | undefined;
      const registered = reply(registration.port1);
      f.serviceMessage!({
        source,
        data: {
          target: "file-relay-register",
          token: redeemed.token,
          relayNonce: nonce,
        },
        ports: [registration.port2],
        waitUntil: (work: Promise<void>) => {
          held = work;
        },
      });
      assert.ok(held, "waitUntil is called synchronously");
      assert.deepEqual(await registered, { status: "ready" });
      await held;
      if (terminal === "cancel") f.block();
      const channel = new MessageChannel();
      ports.push(channel.port1, channel.port2);
      const received = reply(channel.port1);
      held = undefined;
      f.serviceMessage!({
        source,
        data: {
          target: "file-relay-count",
          token: redeemed.token,
          relayNonce: nonce,
          job: {
            jobId: redeemed.spec.jobId,
            revision: 1,
            kind: "text",
            bytes: new TextEncoder().encode("hello").buffer,
          },
        },
        ports: [channel.port2],
        waitUntil: (work: Promise<void>) => {
          held = work;
        },
      });
      assert.ok(held);
      while (!f.countCalls()) await new Promise(setImmediate);
      if (terminal === "cancel") t.mock.timers.tick(30000);
      assert.equal(
        (await received).status,
        terminal === "complete" ? "complete" : "unavailable",
      );
      await held;
      if (terminal === "cancel") {
        assert.equal(
          f.broker.isBusy(),
          true,
          "logical event lifetime ends before unresolved physical work",
        );
        f.release();
        await new Promise(setImmediate);
        assert.equal(f.broker.isBusy(), false);
      }
    } finally {
      for (const port of ports) port.close();
      f.close();
    }
  });
