import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { FileOfferBridge } from "../lib/file-offer-bridge";
import { FileGrantBroker } from "../lib/file-grant-broker";
import type {
  FileBinding,
  FileGrantRequest,
  FileOffer,
} from "../lib/file-relay-protocol";

const ids = {
  capture: "00000000-0000-4000-8000-000000000001",
  document: "00000000-0000-4000-8000-000000000002",
  file: "00000000-0000-4000-8000-000000000003",
  grant: "00000000-0000-4000-8000-000000000004",
  navigation: "00000000-0000-4000-8000-000000000005",
  nextNavigation: "00000000-0000-4000-8000-000000000006",
  offer: "00000000-0000-4000-8000-000000000007",
};

const later = () => new Promise<void>((resolve) => setImmediate(resolve));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function offer(overrides: Partial<FileOffer> = {}): FileOffer {
  return {
    channel: "ai-footprint-file-offer-v1",
    fileHandle: ids.file,
    kind: "pdf",
    observedAt: Date.now(),
    offerId: ids.offer,
    size: 128,
    ...overrides,
  };
}

function setup(
  runtimeSend: (message: any) => Promise<unknown>,
  captureCurrent = () => true,
) {
  const dom = new JSDOM("<!doctype html><body></body>", {
    url: "https://chatgpt.com/",
  });
  let binding: FileBinding = {
    captureId: null,
    documentNonce: ids.document,
    navigationNonce: ids.navigation,
  };
  let siteAccess = true;
  const pageMessages: Array<{ message: any; ports: Transferable[] }> = [];
  dom.window.postMessage = ((
    message: any,
    _target: string,
    ports: Transferable[] = [],
  ) => {
    pageMessages.push({ message, ports });
  }) as typeof dom.window.postMessage;
  const bridge = new FileOfferBridge({
    binding: () => binding,
    captureBinding: (captureId) => ({
      captureId,
      documentNonce: ids.document,
      navigationNonce: ids.navigation,
    }),
    captureCurrent,
    document: dom.window.document,
    extensionId: "extension-id",
    extensionOrigin: "chrome-extension://extension-id",
    pageOrigin: dom.window.location.origin,
    relayUrl: "chrome-extension://extension-id/file-relay.html",
    runtimeSend,
    siteAccess: () => siteAccess,
    window: dom.window as unknown as Window,
  });
  const event = (data: unknown, changes: Partial<MessageEvent> = {}) =>
    ({
      data,
      origin: dom.window.location.origin,
      ports: [],
      source: dom.window,
      ...changes,
    }) as unknown as MessageEvent;
  return {
    bridge,
    dom,
    event,
    pageMessages,
    setBinding(value: FileBinding) {
      binding = value;
    },
    removeAccess() {
      siteAccess = false;
    },
  };
}

test("an authorized offer gets a private relay port only after the relay is ready", async () => {
  const runtime: unknown[] = [];
  const offered = offer();
  const value = setup(async (message) => {
    runtime.push(message);
    return {
      status: "granted",
      grant: ids.grant,
      expiresAt: Date.now() + 10000,
    };
  });
  assert.equal(
    value.bridge.handleWindowMessage(
      value.event(offer(), { origin: "https://invalid.example" }),
    ),
    false,
  );
  assert.equal(value.bridge.handleWindowMessage(value.event(offered)), true);
  await later();
  assert.equal((runtime[0] as FileGrantRequest).observedAt, offered.observedAt);
  assert.equal(value.pageMessages.length, 0);
  const iframe = value.dom.window.document.querySelector("iframe");
  assert.ok(iframe?.contentWindow);
  assert.equal(iframe.src, "chrome-extension://extension-id/file-relay.html");
  assert.equal(iframe.outerHTML.includes(ids.grant), false);
  let relayBind: any;
  let relayPort: MessagePort | null = null;
  iframe.contentWindow.postMessage = ((
    message: any,
    target: string,
    ports: MessagePort[],
  ) => {
    relayBind = { message, target };
    relayPort = ports[0] ?? null;
  }) as typeof iframe.contentWindow.postMessage;
  iframe.dispatchEvent(new value.dom.window.Event("load"));
  assert.equal(relayBind.target, "chrome-extension://extension-id");
  assert.deepEqual(relayBind.message, {
    target: "file-relay-bind",
    grant: ids.grant,
  });
  relayPort!.postMessage({ target: "file-relay-status", status: "ready" });
  await later();
  assert.equal(value.pageMessages.length, 1);
  assert.deepEqual(value.pageMessages[0]!.message, {
    channel: "ai-footprint-file-port-v1",
    offerId: ids.offer,
    fileHandle: ids.file,
    status: "ready",
  });
  assert.equal(value.pageMessages[0]!.ports.length, 1);
  assert.equal(JSON.stringify(value.pageMessages).includes(ids.grant), false);
  assert.equal(
    value.bridge.handleWindowMessage(
      value.event({
        channel: "ai-footprint-file-complete-v1",
        offerId: ids.offer,
        fileHandle: ids.file,
        status: "complete",
      }),
    ),
    true,
  );
  assert.equal(value.dom.window.document.querySelector("iframe"), null);
  assert.equal(
    runtime.some((message: any) => message.target === "file-grant-cancel"),
    false,
    "completion retires the byte relay without deleting the bounded receipt",
  );
  value.bridge.destroy();
});

test("an unresolved physical grant keeps admission closed after logical invalidation", async () => {
  const pending = deferred<unknown>();
  const runtime: any[] = [];
  const value = setup(async (message) => {
    runtime.push(message);
    if (
      message.target === "file-grant" &&
      runtime.filter((item) => item.target === "file-grant").length === 1
    )
      return pending.promise;
    if (message.target === "file-grant")
      return { status: "unavailable", code: "file_busy" };
    return { cancelled: true };
  });
  value.bridge.handleWindowMessage(value.event(offer()));
  value.bridge.invalidate();
  value.bridge.handleWindowMessage(
    value.event(
      offer({
        fileHandle: "00000000-0000-4000-8000-000000000008",
        offerId: "00000000-0000-4000-8000-000000000009",
      }),
    ),
  );
  await later();
  assert.equal(
    runtime.filter((message) => message.target === "file-grant").length,
    1,
  );
  assert.equal(
    value.pageMessages.some(
      ({ message }) =>
        message.offerId === "00000000-0000-4000-8000-000000000009" &&
        message.status === "unavailable",
    ),
    true,
  );
  pending.resolve({
    status: "granted",
    grant: ids.grant,
    expiresAt: Date.now() + 10000,
  });
  await later();
  assert.equal(
    runtime.filter((message) => message.target === "file-grant-cancel").length,
    2,
    "abandonment and a late grant both revoke the broker capability",
  );
  assert.equal(value.dom.window.document.querySelector("iframe"), null);
  value.bridge.destroy();
});

test("receipt binding waits for the durable capture and survives only proved promotion", async () => {
  const committed = deferred<boolean>();
  const runtime: any[] = [];
  const value = setup(async (message) => {
    runtime.push(message);
    return message.target === "file-grant"
      ? {
          status: "granted",
          grant: ids.grant,
          expiresAt: Date.now() + 10000,
        }
      : message.target === "file-receipt-bind"
        ? { bound: true }
        : message.target === "file-capture-association"
          ? { accepted: true }
          : { ok: true };
  });
  value.bridge.handleWindowMessage(value.event(offer()));
  await later();
  value.setBinding({
    captureId: null,
    documentNonce: ids.document,
    navigationNonce: ids.nextNavigation,
  });
  value.bridge.promoteCapture(ids.capture);
  assert.equal(
    value.bridge.bindAssociation(
      {
        channel: "ai-footprint-upload-association-v1",
        captureId: ids.capture,
        files: [{ fileHandle: ids.file, origin: "new_upload" }],
        status: "matched",
        unmatchedReferenceCount: 0,
      },
      committed.promise,
    ),
    true,
  );
  assert.equal(
    runtime.some((message) => message.target === "file-receipt-bind"),
    false,
  );
  committed.resolve(true);
  await later();
  await later();
  const bind = runtime.find(
    (message) => message.target === "file-receipt-bind",
  );
  assert.deepEqual(bind, {
    target: "file-receipt-bind",
    binding: {
      captureId: null,
      documentNonce: ids.document,
      navigationNonce: ids.navigation,
    },
    fileHandle: ids.file,
    captureId: ids.capture,
  });
  assert.equal(
    value.pageMessages.some(
      ({ message }) =>
        message.channel === "ai-footprint-file-promote-v1" &&
        message.captureId === ids.capture,
    ),
    true,
  );
  assert.deepEqual(
    value.bridge.handleGrantCheck(
      {
        target: "file-grant-check",
        binding: bind.binding,
        fileHandle: ids.file,
        captureId: ids.capture,
      },
      { id: "extension-id" },
    ),
    { current: true },
  );
  const forwarded = runtime.find(
    (message) => message.target === "file-capture-association",
  );
  assert.equal(forwarded.binding.captureId, ids.capture);
  assert.equal(forwarded.association.status, "matched");
  value.bridge.bindAssociation(
    {
      channel: "ai-footprint-upload-association-v1",
      captureId: "00000000-0000-4000-8000-000000000042",
      files: [{ fileHandle: ids.file, origin: "new_upload" }],
      status: "matched",
      unmatchedReferenceCount: 0,
    },
    Promise.resolve(true),
  );
  await later();
  assert.equal(
    runtime.filter((message) => message.target === "file-capture-association")
      .length,
    1,
    "one file handle cannot be rebound to another capture",
  );
  value.bridge.destroy();
});

test("permission loss invalidates grants, resets MAIN and rejects stale checks", async () => {
  const runtime: any[] = [];
  const value = setup(async (message) => {
    runtime.push(message);
    return {
      status: "granted",
      grant: ids.grant,
      expiresAt: Date.now() + 10000,
    };
  });
  value.bridge.handleWindowMessage(value.event(offer()));
  await later();
  value.removeAccess();
  value.bridge.invalidate();
  assert.equal(value.dom.window.document.querySelector("iframe"), null);
  assert.equal(
    value.pageMessages.some(
      ({ message }) => message.channel === "ai-footprint-file-reset-v1",
    ),
    true,
  );
  assert.deepEqual(
    value.bridge.handleGrantCheck(
      {
        target: "file-grant-check",
        binding: {
          captureId: null,
          documentNonce: ids.document,
          navigationNonce: ids.navigation,
        },
        fileHandle: ids.file,
        captureId: null,
      },
      { id: "extension-id" },
    ),
    { current: false },
  );
  assert.equal(
    value.bridge.handleGrantCheck(
      {
        target: "file-grant-check",
        binding: {
          captureId: null,
          documentNonce: ids.document,
          navigationNonce: ids.navigation,
        },
        fileHandle: ids.file,
        captureId: null,
      },
      { id: "page", tab: {} },
    ),
    undefined,
  );
  assert.equal(
    runtime.some((message) => message.target === "file-grant-cancel"),
    true,
  );
  value.bridge.destroy();
});

test("offer admission rejects ports, replays and more than four starts per window", async () => {
  const runtime: any[] = [];
  const value = setup(async (message) => {
    runtime.push(message);
    return { status: "unavailable", code: "file_busy" };
  });
  const channel = new MessageChannel();
  assert.equal(
    value.bridge.handleWindowMessage(
      value.event(offer(), { ports: [channel.port1] }),
    ),
    false,
  );
  channel.port1.close();
  channel.port2.close();
  for (let index = 0; index < 6; index++) {
    const suffix = String(30 + index).padStart(12, "0");
    value.bridge.handleWindowMessage(
      value.event(
        offer({
          fileHandle: `00000000-0000-4000-8000-${suffix}`,
          offerId: `00000000-0000-4000-9000-${suffix}`,
        }),
      ),
    );
    await later();
  }
  assert.equal(
    runtime.filter((message) => message.target === "file-grant").length,
    4,
  );
  const replies = value.pageMessages.length;
  value.bridge.handleWindowMessage(
    value.event(
      offer({
        fileHandle: "00000000-0000-4000-8000-000000000030",
        offerId: "00000000-0000-4000-9000-000000000030",
      }),
    ),
  );
  await later();
  assert.equal(value.pageMessages.length, replies, "replays get no new reply");
  value.bridge.destroy();
});

test("the real broker can verify the provisional offer before issuing its grant", async () => {
  const extensionId = "extension-id";
  const relayUrl = "chrome-extension://extension-id/file-relay.html";
  let bridge!: FileOfferBridge;
  const sender = {
    id: extensionId,
    tab: { id: 7 },
    frameId: 0,
    documentId: "provider-document",
    url: "https://chatgpt.com/",
  };
  const broker = new FileGrantBroker({
    extensionId,
    relayUrl,
    snapshot: async () => "stable-scope",
    parentCurrent: async (parent) =>
      bridge.handleGrantCheck(
        {
          target: "file-grant-check",
          binding: parent.binding,
          fileHandle: parent.fileHandle,
          captureId: parent.captureId,
        },
        { id: extensionId },
      )?.current === true,
    count: async () => {
      throw new Error("count is not reached while issuing a grant");
    },
  });
  const value = setup(async (message) => {
    if (message.target === "file-grant") return broker.issue(message, sender);
    if (message.target === "file-grant-cancel") {
      broker.cancel(message, sender);
      return { cancelled: true };
    }
    return { bound: false };
  });
  bridge = value.bridge;
  value.bridge.handleWindowMessage(value.event(offer()));
  await later();
  assert.ok(
    value.dom.window.document.querySelector("iframe"),
    "the broker-issued grant reaches relay preparation",
  );
  assert.equal(
    value.pageMessages.some(({ message }) => message.status === "unavailable"),
    false,
  );
  value.bridge.destroy();
});

test("an association arriving before the grant survives delayed capture commit and proved promotion", async () => {
  const grant = deferred<unknown>();
  const commit = deferred<boolean>();
  const runtime: any[] = [];
  const value = setup(async (message) => {
    runtime.push(message);
    if (message.target === "file-grant") return grant.promise;
    if (message.target === "file-receipt-bind") return { bound: true };
    if (message.target === "file-capture-association")
      return { accepted: true };
    return { cancelled: true };
  });
  value.bridge.handleWindowMessage(value.event(offer()));
  assert.equal(
    value.bridge.bindAssociation(
      {
        channel: "ai-footprint-upload-association-v1",
        captureId: ids.capture,
        files: [{ fileHandle: ids.file, origin: "new_upload" }],
        status: "matched",
        unmatchedReferenceCount: 0,
      },
      commit.promise,
    ),
    true,
  );
  value.setBinding({
    captureId: null,
    documentNonce: ids.document,
    navigationNonce: ids.nextNavigation,
  });
  value.bridge.promoteCapture(ids.capture);
  grant.resolve({
    status: "granted",
    grant: ids.grant,
    expiresAt: Date.now() + 10000,
  });
  await later();
  assert.ok(value.dom.window.document.querySelector("iframe"));
  assert.equal(
    runtime.some((message) => message.target === "file-receipt-bind"),
    false,
  );
  commit.resolve(true);
  await later();
  await later();
  assert.equal(
    runtime.find((message) => message.target === "file-receipt-bind")
      ?.captureId,
    ids.capture,
  );
  assert.equal(
    value.pageMessages.some(
      ({ message }) =>
        message.channel === "ai-footprint-file-promote-v1" &&
        message.captureId === ids.capture,
    ),
    true,
  );
  assert.equal(
    runtime.find((message) => message.target === "file-capture-association")
      ?.binding.captureId,
    ids.capture,
  );
  value.bridge.destroy();
});

test("safe unavailable and expanded partial associations are coalesced behind one runtime call", async () => {
  const first = deferred<unknown>();
  const runtime: any[] = [];
  const value = setup(async (message) => {
    runtime.push(message);
    if (message.target !== "file-capture-association") return { bound: false };
    if (
      runtime.filter((item) => item.target === "file-capture-association")
        .length === 1
    )
      return first.promise;
    return { accepted: true };
  });
  const unavailable = {
    channel: "ai-footprint-upload-association-v1",
    captureId: ids.capture,
    files: [],
    status: "unavailable",
    unmatchedReferenceCount: 1,
  } as const;
  const partial = {
    channel: "ai-footprint-upload-association-v1",
    captureId: ids.capture,
    files: [
      {
        fileHandle: "00000000-0000-4000-8000-000000000041",
        origin: "new_upload",
      },
    ],
    status: "partial",
    unmatchedReferenceCount: 1,
  } as const;
  value.bridge.bindAssociation(unavailable, Promise.resolve(true));
  await later();
  value.bridge.bindAssociation(partial, Promise.resolve(true));
  await later();
  assert.equal(
    runtime.filter((message) => message.target === "file-capture-association")
      .length,
    1,
  );
  first.resolve({ accepted: true });
  await later();
  await later();
  const forwarded = runtime.filter(
    (message) => message.target === "file-capture-association",
  );
  assert.equal(forwarded.length, 2);
  assert.deepEqual(forwarded[0]!.association, unavailable);
  assert.deepEqual(forwarded[1]!.association, partial);
  value.bridge.bindAssociation(partial, Promise.resolve(true));
  await later();
  assert.equal(
    runtime.filter((message) => message.target === "file-capture-association")
      .length,
    2,
    "an unchanged expanded association is not forwarded again",
  );
  assert.equal(
    runtime.some((message) => message.target === "file-receipt-bind"),
    false,
  );
  value.bridge.destroy();
});
