import { FileGrantBroker } from "../lib/file-grant-broker";
import * as ownReadPause from "../lib/own-read-pause";
import * as ownReadSettings from "../lib/own-read-settings";
import * as trackingConsent from "../lib/tracking-consent";
import * as fileRelayProtocol from "../lib/file-relay-protocol";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import * as fileTypes from "@footprint/file-text/types";
import * as adapters from "@footprint/adapters";
import { HistoryAdmission } from "../lib/history-admission";
import { RouteAuthorities } from "../lib/route-authority";
import * as bridge from "../lib/bridge";
import { countAccessibleFile } from "@footprint/file-text";
import * as tokenizers from "@footprint/tokenizers";
import * as countingConfig from "../lib/counting-config";

test("Firefox private client times out if background transport never replies", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let cancellations = 0;
  const client = await evaluate(
    "../lib/file-client.ts",
    {
      "wxt/browser": {
        browser: {
          runtime: {
            sendMessage(message: any) {
              if (message.target === "cancel-accessible-file-count") {
                cancellations++;
                return Promise.resolve({ cancelled: true });
              }
              return new Promise(() => {});
            },
          },
        },
      },
      "@footprint/file-text/types": fileTypes,
    },
    {},
    "firefox",
  );
  const result = client.countAccessibleBlob(
    new Blob(["private timeout"]),
    "text",
  );
  await new Promise(setImmediate);
  context.mock.timers.tick(fileTypes.FILE_LIMITS.timeoutMs + 2000);
  assert.equal((await result).reason, "timeout");
  assert.equal(cancellations, 1);
});

async function evaluate(
  path: string,
  imports: Record<string, unknown>,
  globals: any,
  family: string,
) {
  const source = (
    await readFile(new URL(path, import.meta.url), "utf8")
  ).replaceAll("import.meta.env.BROWSER", JSON.stringify(family));
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exported: any = {};
  new Function("require", "exports", "globalThis", "navigator", compiled)(
    (name: string) => {
      if (name === "@footprint/tokenizers/metadata") return tokenizers;
      if (name === "./counting-config" || name === "../lib/counting-config")
        return countingConfig;
      assert.ok(name in imports, `Unexpected transport dependency: ${name}`);
      return imports[name];
    },
    exported,
    globals,
    globals.navigator,
  );
  return exported;
}

async function harness(family: "chrome" | "firefox") {
  const root = `${family === "firefox" ? "moz" : "chrome"}-extension://file-extension/`;
  let backgroundMessage: any,
    serviceMessage: any,
    offscreenMessage: any,
    counted = 0;
  const ownSender = { id: "file-extension", url: root + "dashboard.html" };
  const browser: any = {
    runtime: {
      id: "file-extension",
      getURL: (path: string) => root + path.replace(/^\//, ""),
      getManifest: () => ({ background: { service_worker: "background.js" } }),
      onMessage: {
        addListener: (listener: any) => {
          backgroundMessage = listener;
        },
      },
      getContexts: async () => [{ documentUrl: root + "offscreen.html" }],
      sendMessage: (message: unknown) =>
        Promise.resolve(backgroundMessage(message, ownSender)),
    },
    alarms: { onAlarm: { addListener() {} }, create: async () => {} },
    permissions: { onRemoved: { addListener() {} } },
    tabs: { onRemoved: { addListener() {} }, onUpdated: { addListener() {} } },
    offscreen: {},
  };
  class Host {
    abort: AbortController | null = null;
    async countFile(job: fileTypes.AccessibleFileJob, signal?: AbortSignal) {
      counted++;
      this.abort = new AbortController();
      signal?.addEventListener("abort", () => this.abort?.abort(), {
        once: true,
      });
      return countAccessibleFile(job, { signal: this.abort.signal });
    }
    cancelFile() {
      this.abort?.abort();
    }
  }
  const common = {
    "wxt/browser": { browser },
    "./count-host": { CountHost: Host },
    "@footprint/file-text/types": fileTypes,
  };
  const backgroundGlobal: any = {
    addEventListener: (_: string, listener: any) => {
      serviceMessage = listener;
    },
    clients: {
      matchAll: async () => [
        {
          url: root + "offscreen.html",
          postMessage: (data: unknown, transfer: Transferable[]) => {
            const cloned = structuredClone(
              {
                data,
                ports: transfer.filter((value) => value instanceof MessagePort),
              },
              { transfer },
            );
            offscreenMessage({
              ...cloned,
              source: { scriptURL: root + "background.js" },
            });
          },
        },
      ],
    },
  };
  const platform = await evaluate(
    "../lib/platform.ts",
    common,
    backgroundGlobal,
    family,
  );
  await evaluate(
    "../lib/offscreen-entry.ts",
    {
      ...common,
      "wxt/browser": {
        browser: {
          ...browser,
          runtime: { ...browser.runtime, onMessage: { addListener() {} } },
        },
      },
    },
    {
      navigator: {
        serviceWorker: {
          addEventListener: (_: string, listener: any) => {
            offscreenMessage = listener;
          },
        },
      },
    },
    family,
  );
  await evaluate(
    "../entrypoints/background.ts",
    {
      "wxt/utils/define-background": {
        defineBackground: (run: () => void) => run(),
      },
      "wxt/browser": { browser },
      "@footprint/ledger": { Ledger: { open: () => new Promise(() => {}) } },
      "../lib/server-summary": {},
      "../lib/scope-notifications": {
        observeScopeChanges: async () => ({}),
        observeThreadInvalidations: async () => ({}),
      },
      "../lib/history-admission": { HistoryAdmission },
      "../lib/route-authority": { RouteAuthorities },
      "../lib/bridge": bridge,
      "../lib/file-grant-broker": { FileGrantBroker },
      "../lib/file-relay-protocol": fileRelayProtocol,
      "../lib/coordinator": {},
      "../lib/platform": platform,
      "../lib/company": {},
      "../lib/health": { HealthReporter: class {} },
      "../lib/ownership": {},
      "../lib/own-read-pause": ownReadPause,
      "../lib/own-read-settings": ownReadSettings,
      "../lib/tracking-consent": trackingConsent,
      "@footprint/capture-core": {},
      "@footprint/adapters": adapters,
      "@footprint/file-text/types": fileTypes,
    },
    backgroundGlobal,
    family,
  );
  const clientGlobal = {
    navigator: {
      serviceWorker: {
        getRegistration: async () => ({
          active: {
            postMessage: (data: unknown, transfer: Transferable[]) => {
              const cloned = structuredClone(
                {
                  data,
                  ports: transfer.filter(
                    (value) => value instanceof MessagePort,
                  ),
                },
                { transfer },
              );
              serviceMessage({ ...cloned, source: { url: ownSender.url } });
            },
          },
        }),
      },
    },
  };
  const client = await evaluate(
    "../lib/file-client.ts",
    { "wxt/browser": { browser }, "@footprint/file-text/types": fileTypes },
    clientGlobal,
    family,
  );
  return {
    client,
    backgroundMessage,
    serviceMessage,
    offscreenMessage,
    root,
    counted: () => counted,
  };
}

for (const family of ["chrome", "firefox"] as const)
  test(`${family} private transport executes actual client/platform/handler code with structured bytes`, async () => {
    const value = await harness(family);
    const blob = new Blob(["Private file transport marker"], {
      type: "text/plain",
    });
    const result = await value.client.countAccessibleBlob(blob, "text");
    assert.equal(result.status, "counted", JSON.stringify(result));
    assert.equal(result.inputBytes, blob.size);
    assert.equal(result.scope, "extracted_file_text");
    assert.equal(
      JSON.stringify(result).includes("Private file transport marker"),
      false,
    );
    assert.equal(await blob.text(), "Private file transport marker");
    assert.equal(value.counted(), 1);
    const job = {
      jobId: crypto.randomUUID(),
      revision: 1,
      kind: "text",
      bytes: new ArrayBuffer(2),
    };
    if (family === "firefox") {
      await value.backgroundMessage(
        { target: "accessible-file-count", job },
        { id: "file-extension", url: "https://claude.ai/" },
      );
      await value.backgroundMessage(
        { target: "accessible-file-count", job },
        {
          id: "file-extension",
          url: value.root + "file-relay.html",
          tab: { id: 3 },
          frameId: 4,
        },
      );
    } else {
      const channel = new MessageChannel();
      value.serviceMessage({
        source: { url: "https://claude.ai/" },
        data: { target: "accessible-file-count", job },
        ports: [channel.port2],
      });
      value.serviceMessage({
        source: {
          url: value.root + "file-relay.html",
          id: "unregistered-relay",
        },
        data: { target: "accessible-file-count", job },
        ports: [channel.port2],
      });
      value.offscreenMessage({
        source: { scriptURL: "https://invalid.example/worker.js" },
        data: { target: "accessible-file-count", job },
        ports: [channel.port2],
      });
      channel.port1.close();
      channel.port2.close();
    }
    assert.equal(
      value.counted(),
      1,
      "provider pages cannot reach the private file worker",
    );
  });

test("strict physical transport waits for offscreen cancellation acknowledgement rather than freeing its slot on abort", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let reply: MessagePort | undefined,
    cancellations = 0;
  const root = "chrome-extension://physical/";
  const browser: any = {
    runtime: {
      getURL: (path: string) => root + path.replace(/^\//, ""),
      getContexts: async () => [{}],
    },
    offscreen: {},
  };
  const platform = await evaluate(
    "../lib/platform.ts",
    {
      "wxt/browser": { browser },
      "./count-host": { CountHost: class {} },
      "@footprint/file-text/types": fileTypes,
    },
    {
      clients: {
        matchAll: async () => [
          {
            url: root + "offscreen.html",
            postMessage: (_data: any, transfer: any[]) => {
              reply = transfer[0];
              reply!.onmessage = () => {
                cancellations++;
              };
              reply!.start();
            },
          },
        ],
      },
    },
    "chrome",
  );
  const job = {
      jobId: crypto.randomUUID(),
      revision: 1,
      kind: "text",
      bytes: new ArrayBuffer(2),
    },
    abort = new AbortController();
  let settled = false;
  const work = platform
    .countFileLocally(job, abort.signal, true)
    .then((result: any) => {
      settled = true;
      return result;
    });
  while (!reply) await new Promise(setImmediate);
  abort.abort();
  await new Promise(setImmediate);
  assert.equal(settled, false);
  context.mock.timers.tick(fileTypes.FILE_LIMITS.timeoutMs + 1001);
  await new Promise(setImmediate);
  assert.equal(settled, false);
  assert.ok(cancellations >= 1);
  reply.postMessage(fileTypes.unavailable(job as any, "cancelled"));
  const result = await work;
  assert.equal(result.reason, "cancelled");
  reply.close();
});

for (const phase of ["host", "clients"] as const)
  test(`aborting while ${phase} resolution is pending starts no private file worker or byte transfer`, async () => {
    let entered!: () => void,
      release!: () => void,
      posts = 0,
      clientReads = 0;
    const enteredPromise = new Promise<void>((r) => (entered = r)),
      gate = new Promise<void>((r) => (release = r));
    const root = "chrome-extension://deferred/";
    const browser: any = {
      runtime: {
        getURL: (path: string) => root + path.replace(/^\//, ""),
        getContexts: async () => (phase === "host" ? [] : [{}]),
      },
      offscreen: {
        createDocument: async () => {
          entered();
          await gate;
        },
      },
    };
    const platform = await evaluate(
      "../lib/platform.ts",
      {
        "wxt/browser": { browser },
        "./count-host": { CountHost: class {} },
        "@footprint/file-text/types": fileTypes,
      },
      {
        clients: {
          matchAll: async () => {
            clientReads++;
            if (phase === "clients") {
              entered();
              await gate;
            }
            return [
              { url: root + "offscreen.html", postMessage: () => posts++ },
            ];
          },
        },
      },
      "chrome",
    );
    const abort = new AbortController(),
      job = {
        jobId: crypto.randomUUID(),
        revision: 1,
        kind: "text",
        bytes: new ArrayBuffer(5),
      };
    const pending = platform.countFileLocally(job, abort.signal, true);
    await enteredPromise;
    abort.abort();
    release();
    const result = await pending;
    assert.equal(result.reason, "cancelled");
    assert.equal(posts, 0);
    assert.equal(job.bytes.byteLength, 5);
    if (phase === "host") assert.equal(clientReads, 0);
  });
