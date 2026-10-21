import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import ts from "typescript";
import { resolveBuildVariant, variantOutputTemplate } from "../build/variant";
import { FileGrantBroker } from "../lib/file-grant-broker";
import * as protocol from "../lib/file-relay-protocol";
const require = createRequire(import.meta.url);
const relaySource = readFileSync(
  new URL("../lib/file-relay.ts", import.meta.url),
  "utf8",
);
function actualWorker() {
  const source = readFileSync(
    new URL("../lib/file.worker.ts", import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const worker = new Worker(
    `require(${JSON.stringify(require.resolve("tsx/cjs"))});const {parentPort}=require('node:worker_threads');global.self=globalThis;self.postMessage=value=>parentPort.postMessage(value);const r=require('node:module').createRequire(${JSON.stringify(import.meta.url)});new Function('require','exports',${JSON.stringify(compiled)})(name=>name==='@footprint/file-text/pdf-worker?worker&url'?{default:''}:r(name==='./counting-worker-config'?'../lib/counting-worker-config.ts':name),{});parentPort.on('message',data=>self.onmessage({data}));`,
    { eval: true },
  );
  return {
    count: (job: any) =>
      new Promise<any>((resolve, reject) => {
        worker.once("message", resolve);
        worker.once("error", reject);
        const bytes = job.bytes.slice(0);
        worker.postMessage({ ...job, bytes }, [bytes]);
      }),
    close: () => worker.terminate(),
  };
}
function receipt(port: MessagePort) {
  return new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("relay_test_timeout")), 5000);
    port.addEventListener(
      "message",
      (message) => {
        clearTimeout(timer);
        resolve(message.data);
      },
      { once: true },
    );
    port.start();
  });
}
for (const family of ["chrome", "firefox"] as const)
  test(`${family} actual relay transfers a private buffer through authenticated broker into the real file worker`, async () => {
    const root = `${family === "firefox" ? "moz" : "chrome"}-extension://synthetic/`,
      url = root + "file-relay.html";
    const text =
      "AI Footprint Tracker synthetic attachment test.\nThe only test marker is FERN-ATTACHMENT-042.\nThis file contains no personal, customer or company information.\n";
    const privateBytes = new TextEncoder().encode(text).buffer;
    const worker = actualWorker();
    let countCalls = 0;
    const broker = new FileGrantBroker({
      extensionId: "synthetic",
      relayUrl: url,
      snapshot: async () => "scope",
      parentCurrent: async () => true,
      count: async (job) => {
        countCalls++;
        return worker.count(job);
      },
    });
    const request = {
      target: "file-grant",
      binding: {
        documentNonce: crypto.randomUUID(),
        navigationNonce: crypto.randomUUID(),
        captureId: null,
      },
      fileHandle: crypto.randomUUID(),
      kind: "text",
      size: privateBytes.byteLength,
      observedAt: Date.now(),
    };
    const parentSender = {
      id: "synthetic",
      url: "https://chatgpt.com/",
      tab: { id: 3 },
      frameId: 0,
      documentId: "parent",
    };
    const relaySender = {
      id: "synthetic",
      url,
      tab: { id: 3 },
      frameId: 4,
      documentId: "relay",
    };
    const client = { id: "authenticated-client", url };
    const grant = await broker.issue(request, parentSender);
    if (grant.status !== "granted") throw Error();
    let receive!: (event: any) => Promise<void>,
      redeems = 0;
    const parentWindow = {};
    const windowMock = {
      addEventListener: (name: string, listener: any) => {
        if (name === "message") receive = listener;
      },
      removeEventListener() {},
    };
    const calls: string[] = [];
    const browser = {
      runtime: {
        getURL: (path: string) => root + path.replace(/^\//, ""),
        sendMessage: async (message: any) => {
          calls.push(message.target);
          if (message.target === "file-relay-redeem") {
            redeems++;
            return broker.redeem(message, relaySender);
          }
          if (message.target === "file-relay-count")
            return broker.submit(structuredClone(message), relaySender, true);
          broker.cancel(message, relaySender);
          return { cancelled: true };
        },
      },
    };
    const navigatorMock = {
      serviceWorker: {
        getRegistration: async () => ({
          active: {
            postMessage: (message: any, transfer: any[]) => {
              const cloned = structuredClone(
                { data: message, port: transfer[0] },
                { transfer },
              );
              calls.push(message.target);
              const result =
                message.target === "file-relay-register"
                  ? broker.register(cloned.data, client)
                  : broker.submit(cloned.data, client);
              void result.then((value) => {
                cloned.port.postMessage(value);
                cloned.port.close();
              });
            },
          },
        }),
      },
    };
    const compiled = ts.transpileModule(
      relaySource.replaceAll("import.meta.env.BROWSER", JSON.stringify(family)),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText;
    const exported: any = {};
    new Function(
      "require",
      "exports",
      "window",
      "parent",
      "location",
      "navigator",
      compiled,
    )(
      (name: string) => (name === "wxt/browser" ? { browser } : protocol),
      exported,
      windowMock,
      parentWindow,
      { href: url },
      navigatorMock,
    );
    const stop = exported.startFileRelay();
    const channel = new MessageChannel();
    try {
      await receive({
        source: {},
        origin: "https://chatgpt.com",
        data: { target: "file-relay-bind", grant: grant.grant },
        ports: [],
      });
      assert.equal(redeems, 0);
      await receive({
        source: parentWindow,
        origin: "https://invalid.example",
        data: { target: "file-relay-bind", grant: grant.grant },
        ports: [],
      });
      assert.equal(redeems, 0);
      const ready = receipt(channel.port1);
      await receive({
        source: parentWindow,
        origin: "https://chatgpt.com",
        data: { target: "file-relay-bind", grant: grant.grant },
        ports: [channel.port2],
      });
      assert.deepEqual(await ready, {
        target: "file-relay-status",
        status: "ready",
      });
      const finished = receipt(channel.port1);
      channel.port1.postMessage(
        { target: "file-relay-bytes", bytes: privateBytes },
        [privateBytes],
      );
      assert.equal(privateBytes.byteLength, 0);
      assert.deepEqual(await finished, {
        target: "file-relay-status",
        status: "complete",
      });
      assert.equal(countCalls, 1);
      assert.equal(redeems, 1);
      const result = await (broker as any).getUnassociated(request.fileHandle);
      assert.equal(result.tokens, "33");
      assert.equal(result.association, "unassociated");
      assert.equal(result.telemetryAllowed, false);
      assert.ok(!JSON.stringify(result).includes("FERN-ATTACHMENT"));
      assert.equal(calls.includes("file-relay-register"), family === "chrome");
    } finally {
      stop();
      channel.port1.close();
      channel.port2.close();
      broker.invalidate();
      await worker.close();
    }
  });

test("relay manifest exposes only inert HTML and preserves private extraction resources", () => {
  const html = readFileSync(
    new URL("../entrypoints/file-relay.html", import.meta.url),
    "utf8",
  );
  assert.ok(!/grant=|token=|iframe|input|form/i.test(html));
  const source = readFileSync(
    new URL("../wxt.config.ts", import.meta.url),
    "utf8",
  );
  const exported: any = {};
  const compiled = ts.transpileModule(
    source.replaceAll(
      "import.meta.url",
      JSON.stringify(new URL("../wxt.config.ts", import.meta.url).href),
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  new Function("require", "exports", compiled)((name: string) => {
    if (name === "wxt") return { defineConfig: (value: any) => value };
    if (name === "node:url") return require("node:url");
    if (name === "./build/notices") return { writeBrowserNotices() {} };
    if (name === "./build/source-package")
      return {
        reviewSourcePackage: () => ({}),
        keepTestSources: (patterns: string[]) => patterns,
      };
    if (name === "./build/tokenizer-boundary")
      return require("../build/tokenizer-boundary.ts");
    if (name === "./build/release-metadata") return { bundledNotices: {} };
    if (name === "./build/variant")
      return {
        resolveBuildVariant,
        variantOutputTemplate,
        writeBuildVariantMetadata() {},
      };
    throw new Error(`Unexpected WXT config import: ${name}`);
  }, exported);
  const chrome = exported.default.manifest({ browser: "chrome" }),
    firefox = exported.default.manifest({ browser: "firefox" });
  assert.deepEqual(firefox.web_accessible_resources, [
    "file-relay.html",
    "methodology-reference.html",
  ]);
  assert.deepEqual(chrome.web_accessible_resources[0].resources, [
    "file-relay.html",
    "methodology-reference.html",
  ]);
  assert.ok(
    chrome.web_accessible_resources[0].matches.every(
      (origin: string) =>
        origin.startsWith("https://") && !origin.includes("<all_urls>"),
    ),
  );
  assert.ok(
    !JSON.stringify(chrome.web_accessible_resources).includes("offscreen"),
  );
  assert.ok(
    !JSON.stringify(chrome.web_accessible_resources).includes("worker"),
  );
  assert.ok(
    !JSON.stringify(chrome.web_accessible_resources).includes("licenses"),
  );
  assert.ok(
    !JSON.stringify(chrome.web_accessible_resources).includes("source/"),
  );
});

test("real isolated helper and broker complete grant, relay, worker and capture-bound receipt without a provisional-receipt deadlock", async () => {
  const { JSDOM } = await import("jsdom");
  const { FileOfferBridge } = await import("../lib/file-offer-bridge");
  const dom = new JSDOM("<!doctype html><body></body>", {
      url: "https://chatgpt.com/",
    }),
    worker = actualWorker();
  const root = "chrome-extension://integration/",
    relayUrl = root + "file-relay.html",
    captureId = crypto.randomUUID(),
    fileHandle = crypto.randomUUID(),
    offerId = crypto.randomUUID();
  const binding = {
    documentNonce: crypto.randomUUID(),
    navigationNonce: crypto.randomUUID(),
    captureId: null,
  };
  const parentSender = {
      id: "integration",
      url: dom.window.location.href,
      tab: { id: 7 },
      frameId: 0,
      documentId: "parent",
    },
    relaySender = {
      id: "integration",
      url: relayUrl,
      tab: { id: 7 },
      frameId: 6,
      documentId: "relay",
    },
    client = { url: relayUrl, id: "actual-client" };
  const basis = {
    scope: { namespace: "personal:integration", mode: "personal", era: null },
    erasureVersion: 0,
    ownershipStart: 0,
    ownershipEnd: null,
    deviceId: null,
    enrollmentState: null,
  };
  let bridge: InstanceType<typeof FileOfferBridge>,
    checks = 0;
  const broker = new FileGrantBroker({
    extensionId: "integration",
    relayUrl,
    snapshot: async () => JSON.stringify(basis),
    parentCurrent: async (p) => {
      checks++;
      return (
        bridge.handleGrantCheck(
          {
            target: "file-grant-check",
            binding: p.binding,
            fileHandle: p.fileHandle,
            captureId: p.captureId,
          },
          { id: "integration" },
        )?.current === true
      );
    },
    count: async (job) => worker.count(job),
  });
  let privateGrant = "",
    mainPort: MessagePort | undefined;
  const messages: any[] = [];
  dom.window.postMessage = ((
    message: any,
    _origin: string,
    ports: Transferable[] = [],
  ) => {
    const value = structuredClone({ message, ports }, { transfer: ports });
    messages.push(value.message);
    if (
      value.message.channel === "ai-footprint-file-port-v1" &&
      value.message.status === "ready"
    )
      mainPort = value.ports[0] as MessagePort;
  }) as any;
  bridge = new FileOfferBridge({
    binding: () => binding,
    captureCurrent: (id, b) =>
      id === captureId && JSON.stringify(b) === JSON.stringify(binding),
    captureBinding: (id) =>
      id === captureId ? { ...binding, captureId } : null,
    document: dom.window.document,
    extensionId: "integration",
    extensionOrigin: "chrome-extension://integration",
    pageOrigin: dom.window.location.origin,
    relayUrl,
    siteAccess: () => true,
    window: dom.window as unknown as Window,
    runtimeSend: async (message: any) => {
      if (message.target === "file-grant") {
        const value = await broker.issue(message, parentSender);
        if (value.status === "granted") privateGrant = value.grant;
        return value;
      }
      if (message.target === "file-receipt-bind")
        return broker.bind(message, parentSender);
      if (message.target === "file-capture-association")
        return { accepted: true };
      broker.cancel(message, parentSender);
      return { cancelled: true };
    },
  });
  let receive!: (event: any) => Promise<void>;
  const relayWindow = {
    addEventListener: (name: string, listener: any) => {
      if (name === "message") receive = listener;
    },
    removeEventListener() {},
  };
  const relayBrowser = {
    runtime: {
      getURL: (path: string) => root + path.replace(/^\//, ""),
      sendMessage: async (message: any) => {
        if (message.target === "file-relay-redeem")
          return broker.redeem(message, relaySender);
        broker.cancel(message, relaySender);
        return { cancelled: true };
      },
    },
  };
  const nav = {
    serviceWorker: {
      getRegistration: async () => ({
        active: {
          postMessage: (message: any, transfer: any[]) => {
            const value = structuredClone(
              { message, port: transfer[0] },
              { transfer },
            );
            const work =
              message.target === "file-relay-register"
                ? broker.register(value.message, client)
                : broker.submit(value.message, client);
            void work.then((reply) => {
              value.port.postMessage(reply);
              value.port.close();
            });
          },
        },
      }),
    },
  };
  const compiled = ts.transpileModule(
    relaySource.replaceAll("import.meta.env.BROWSER", '"chrome"'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const exported: any = {};
  new Function(
    "require",
    "exports",
    "window",
    "parent",
    "location",
    "navigator",
    compiled,
  )(
    (name: string) =>
      name === "wxt/browser" ? { browser: relayBrowser } : protocol,
    exported,
    relayWindow,
    dom.window,
    { href: relayUrl },
    nav,
  );
  const stop = exported.startFileRelay();
  const event = (data: any) =>
    ({
      source: dom.window,
      origin: dom.window.location.origin,
      ports: [],
      data,
    }) as unknown as MessageEvent;
  try {
    bridge.handleWindowMessage(
      event({
        channel: "ai-footprint-file-offer-v1",
        offerId,
        fileHandle,
        kind: "text",
        size: 5,
        observedAt: Date.now(),
      }),
    );
    for (let i = 0; i < 50 && !dom.window.document.querySelector("iframe"); i++)
      await new Promise(setImmediate);
    const frame = dom.window.document.querySelector("iframe");
    assert.ok(
      frame?.contentWindow,
      "initial grant must validate the active unbound offer",
    );
    assert.ok(checks > 0);
    frame.contentWindow.postMessage = ((
      message: any,
      _origin: string,
      ports: MessagePort[],
    ) => {
      void receive({
        source: dom.window,
        origin: dom.window.location.origin,
        data: message,
        ports,
      });
    }) as any;
    frame.dispatchEvent(new dom.window.Event("load"));
    for (let i = 0; i < 50 && !mainPort; i++) await new Promise(setImmediate);
    assert.ok(mainPort);
    const completed = receipt(mainPort),
      bytes = new TextEncoder().encode("hello").buffer;
    mainPort.postMessage({ target: "file-relay-bytes", bytes }, [bytes]);
    assert.equal(bytes.byteLength, 0);
    assert.deepEqual(await completed, {
      target: "file-relay-status",
      status: "complete",
    });
    bridge.handleWindowMessage(
      event({
        channel: "ai-footprint-file-complete-v1",
        offerId,
        fileHandle,
        status: "complete",
      }),
    );
    bridge.bindAssociation(
      {
        channel: "ai-footprint-upload-association-v1",
        captureId,
        status: "matched",
        unmatchedReferenceCount: 0,
        files: [{ fileHandle, origin: "new_upload" }],
      },
      Promise.resolve(true),
    );
    let result: any;
    for (let i = 0; i < 30; i++) {
      await new Promise(setImmediate);
      result = await broker.readReceipt(
        { binding, fileHandle, captureId },
        parentSender,
      );
      if (result.status === "complete") break;
    }
    assert.equal(result.status, "complete");
    assert.equal(result.result.tokens, "1");
    assert.equal(result.result.association, "unassociated");
    assert.deepEqual(result.basis, basis);
    assert.equal(dom.window.document.querySelector("iframe"), null);
    assert.ok(!JSON.stringify(messages).includes(privateGrant));
    assert.ok(!JSON.stringify(messages).includes("tokens"));
  } finally {
    bridge.destroy();
    stop();
    mainPort?.close();
    broker.invalidate();
    await worker.close();
    dom.window.close();
  }
});
