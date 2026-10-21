import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  ProviderUploadObserver,
  UPLOAD_OBSERVER_LIMITS,
} from "../lib/upload-observer";
import { uploadBodyReader } from "../lib/upload-body";
import { installCapture } from "../lib/capture-runtime";

const evidence = JSON.parse(
  readFileSync(
    new URL(
      "../../../fixtures/provider-uploads-2026-09-10.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function until(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await tick();
  }
  assert.ok(predicate(), "observation did not finish");
}
const identity = "file_" + "1".padStart(32, "0"),
  uploadUrl =
    "https://storage.example/private-upload?secret=PRIVATE_URL_MARKER";
const attachment = {
  ...evidence.chatgpt.generation.attachment,
  id: identity,
  name: "PRIVATE_FILENAME_MARKER",
};
const claimBody = () =>
  evidence.chatgpt.claim.events
    .map((event: string) =>
      JSON.stringify({
        file_id: identity,
        event,
        message: "PRIVATE_CLAIM_MARKER",
        extra: { private: "PRIVATE_EXTRA_MARKER" },
        progress: 1,
      }),
    )
    .join("\n");
const associations = (messages: any[]) =>
  messages.filter(
    (value) => value.channel === "ai-footprint-upload-association-v1",
  );
function xhrClass() {
  return class NativeXHR extends EventTarget {
    code = 0;
    opens: any[][] = [];
    sends: any[][] = [];
    throwSend = false;
    get status() {
      return this.code;
    }
    open(...args: any[]) {
      this.opens.push(args);
      return "native-open";
    }
    send(...args: any[]) {
      this.sends.push(args);
      if (this.throwSend) throw new Error("native-send-error");
      return "native-send";
    }
    finish(code = 201, abort = false) {
      this.code = code;
      if (abort) this.dispatchEvent(new Event("abort"));
      this.dispatchEvent(new Event("loadend"));
    }
  };
}
function setup(site: "chatgpt" | "perplexity" = "chatgpt") {
  const messages: any[] = [],
    origin =
      site === "chatgpt" ? "https://chatgpt.com" : "https://www.perplexity.ai",
    observer = new ProviderUploadObserver(site, origin, (value) =>
      messages.push(value),
    );
  const reader = uploadBodyReader(),
    XHR = xhrClass();
  observer.installXHR(XHR as any);
  const fetch = (
    path: string,
    body: unknown,
    response: Response | Promise<Response>,
    at = Date.now(),
  ) => {
    const request = reader.request(
      new URL(path, origin).href,
      { method: "POST", body },
      origin,
    )!;
    observer.fetch(
      observer.prepare(request),
      Promise.resolve(response),
      at,
      observer.context(),
    );
  };
  const dispatch = (
    refs: any[] = [attachment],
    captureId: string = crypto.randomUUID(),
  ) => {
    observer.dispatch(
      captureId,
      new URL(
        site === "chatgpt"
          ? evidence.chatgpt.generation.path
          : evidence.perplexity.generation.path,
        origin,
      ),
      JSON.stringify(
        site === "chatgpt"
          ? { messages: [{ metadata: { attachments: refs } }] }
          : { params: { attachments: refs } },
      ),
      observer.context(),
    );
    return captureId;
  };
  const reserve = () =>
    fetch(
      evidence.chatgpt.reservation.path,
      "{}",
      Response.json({
        eligible: true,
        reservation_id: identity,
        upload_url: uploadUrl,
      }),
    );
  const claim = () =>
    fetch(evidence.chatgpt.claim.path, "{}", new Response(claimBody()));
  return { observer, messages, origin, XHR, fetch, dispatch, reserve, claim };
}

test("ChatGPT native XHR is unchanged and only exact successful reservation/upload/claim permits safe original-capture association", async () => {
  const h = setup();
  try {
    h.reserve();
    await until(() => (h.observer as any).reservations.size === 1);
    const xhr = new h.XHR(),
      blob = new Blob(["PRIVATE_FILE_TEXT"], { type: "text/plain" });
    let overrides = 0;
    Object.defineProperty(xhr, "addEventListener", {
      value: () => {
        overrides++;
        throw new Error("instance override");
      },
    });
    Object.defineProperty(xhr, "removeEventListener", {
      value: () => {
        overrides++;
        throw new Error("instance override");
      },
    });
    assert.equal(
      xhr.open("PUT", uploadUrl, true, "unchanged-user", "unchanged-password"),
      "native-open",
    );
    assert.equal(xhr.send(blob), "native-send");
    assert.equal(xhr.sends[0][0], blob);
    const offer = h.messages[0];
    assert.equal(offer.channel, "ai-footprint-file-offer-v1");
    assert.equal(offer.size, 17);
    const capture = h.dispatch();
    assert.equal(associations(h.messages).at(-1).status, "unavailable");
    h.claim();
    await until(() => (h.observer as any).readers.size === 0);
    assert.equal(associations(h.messages).at(-1).status, "unavailable");
    xhr.finish();
    assert.equal(associations(h.messages).at(-1).status, "matched");
    assert.deepEqual(associations(h.messages).at(-1).files, [
      { fileHandle: offer.fileHandle, origin: "new_upload" },
    ]);
    h.dispatch([attachment], capture);
    assert.equal(associations(h.messages).at(-1).status, "matched");
    h.dispatch();
    assert.equal(associations(h.messages).at(-1).status, "unavailable");
    assert.equal(overrides, 0);
    for (const raw of [
      identity,
      uploadUrl,
      "PRIVATE_FILENAME_MARKER",
      "PRIVATE_FILE_TEXT",
      "PRIVATE_CLAIM_MARKER",
      "PRIVATE_EXTRA_MARKER",
    ])
      assert.ok(!JSON.stringify(h.messages).includes(raw));
  } finally {
    h.observer.stop();
  }
});

test("only omitted or literal true XHR async is observed; send failures and opaque bodies preserve native behavior", async () => {
  for (const async of [false, 0, null, "", 1, {}, undefined, true]) {
    const h = setup();
    try {
      h.reserve();
      await until(() => (h.observer as any).reservations.size === 1);
      const xhr = new h.XHR(),
        blob = new Blob(["x"], { type: "text/plain" });
      xhr.open("PUT", uploadUrl, async);
      assert.equal(xhr.send(blob), "native-send");
      assert.equal(
        h.messages.length,
        async === undefined || async === true ? 1 : 0,
      );
      assert.equal(xhr.opens[0][2], async);
    } finally {
      h.observer.stop();
    }
  }
  const h = setup();
  try {
    h.reserve();
    await until(() => (h.observer as any).reservations.size === 1);
    const xhr = new h.XHR();
    xhr.open("PUT", uploadUrl, true);
    xhr.throwSend = true;
    assert.throws(
      () => xhr.send(new Blob(["x"], { type: "text/plain" })),
      /native-send-error/,
    );
    assert.equal(h.messages.length, 0);
    xhr.throwSend = false;
    const buffer = new Uint8Array([1]);
    xhr.send(buffer);
    assert.equal(xhr.sends[1][0], buffer);
    assert.equal(buffer.byteLength, 1);
    assert.equal(h.messages.length, 0);
  } finally {
    h.observer.stop();
  }
});

test("one pending immutable upload survives reservation parsing lag, exact URL match and native start time stay required", async () => {
  const h = setup();
  let release!: (value: Response) => void;
  const pending = new Promise<Response>((resolve) => (release = resolve));
  try {
    h.fetch(evidence.chatgpt.reservation.path, "{}", pending);
    const xhr = new h.XHR(),
      at = Date.now();
    xhr.open("PUT", uploadUrl, true);
    xhr.send(new Blob(["x"], { type: "text/plain" }));
    xhr.finish();
    assert.equal(h.messages.length, 0);
    assert.equal((h.observer as any).candidates.size, 1);
    release(
      Response.json({
        eligible: true,
        reservation_id: identity,
        upload_url: uploadUrl,
      }),
    );
    await until(() => h.messages.length > 0);
    assert.ok(h.messages[0].observedAt >= at);
    h.claim();
    await until(() => (h.observer as any).readers.size === 0);
    h.dispatch();
    assert.equal(associations(h.messages).at(-1).status, "matched");
  } finally {
    h.observer.stop();
  }
});

test("reset invalidates pending reservations/native outcomes and physically outstanding response reads remain bounded", async () => {
  const h = setup();
  const releases: Array<(value: Response) => void> = [];
  try {
    for (let i = 0; i < 20; i++)
      h.fetch(
        evidence.chatgpt.reservation.path,
        "{}",
        new Promise<Response>((resolve) => releases.push(resolve)),
      );
    assert.equal(
      (h.observer as any).readers.size,
      UPLOAD_OBSERVER_LIMITS.readers,
    );
    h.observer.reset();
    h.reserve();
    await tick();
    assert.equal(h.messages.length, 0);
    assert.equal(
      (h.observer as any).readers.size,
      UPLOAD_OBSERVER_LIMITS.readers,
    );
    for (const release of releases)
      release(
        Response.json({
          eligible: true,
          reservation_id: identity,
          upload_url: uploadUrl,
        }),
      );
    await until(() => (h.observer as any).readers.size === 0);
    assert.equal(h.messages.length, 0);
    h.reserve();
    await until(() => (h.observer as any).reservations.size === 1);
    const xhr = new h.XHR();
    xhr.open("PUT", uploadUrl, true);
    xhr.send(new Blob(["x"], { type: "text/plain" }));
    h.observer.reset();
    xhr.finish();
    h.claim();
    await tick();
    h.dispatch();
    assert.equal(associations(h.messages).at(-1).status, "unavailable");
  } finally {
    h.observer.stop();
  }
});

test("claim response may finish before the delayed reservation clone, without losing exact upload prerequisites", async () => {
  const h = setup();
  let release!: (value: Response) => void;
  try {
    h.fetch(
      evidence.chatgpt.reservation.path,
      "{}",
      new Promise<Response>((resolve) => (release = resolve)),
    );
    const xhr = new h.XHR();
    xhr.open("PUT", uploadUrl, true);
    xhr.send(new Blob(["x"], { type: "text/plain" }));
    xhr.finish();
    h.claim();
    await until(() => (h.observer as any).pendingClaim !== null);
    const capture = h.dispatch();
    assert.equal(associations(h.messages).at(-1).status, "unavailable");
    release(
      Response.json({
        eligible: true,
        reservation_id: identity,
        upload_url: uploadUrl,
      }),
    );
    await until(() => associations(h.messages).at(-1)?.status === "matched");
    assert.equal(associations(h.messages).at(-1).captureId, capture);
    assert.equal((h.observer as any).pendingClaim, null);
  } finally {
    h.observer.stop();
  }
});

test("pending unknown upload expires and never adopts an unrelated or late reservation URL", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = setup();
  let release!: (value: Response) => void;
  try {
    h.fetch(
      evidence.chatgpt.reservation.path,
      "{}",
      new Promise<Response>((resolve) => (release = resolve)),
    );
    const xhr = new h.XHR();
    xhr.open("PUT", "https://different.example/unmatched", true);
    xhr.send(new Blob(["x"], { type: "text/plain" }));
    assert.equal((h.observer as any).candidates.size, 1);
    t.mock.timers.tick(30001);
    assert.equal((h.observer as any).candidates.size, 0);
    release(
      Response.json({
        eligible: true,
        reservation_id: identity,
        upload_url: uploadUrl,
      }),
    );
    await until(() => (h.observer as any).readers.size === 0);
    assert.equal(h.messages.length, 0);
  } finally {
    h.observer.stop();
  }
});

test("repeated native upload locator fails closed until an explicit lifecycle reset", async () => {
  const h = setup();
  try {
    h.reserve();
    await until(() => (h.observer as any).reservations.size === 1);
    const first = new h.XHR(),
      second = new h.XHR(),
      file = new Blob(["x"], { type: "text/plain" });
    first.open("PUT", uploadUrl, true);
    first.send(file);
    second.open("PUT", uploadUrl, true);
    second.send(file);
    first.finish();
    second.finish();
    const count = h.messages.length;
    h.reserve();
    h.claim();
    h.dispatch();
    await tick();
    assert.equal(h.messages.length, count);
    assert.equal((h.observer as any).invalidated, true);
    h.observer.reset();
    h.reserve();
    await until(() => (h.observer as any).reservations.size === 1);
    assert.equal((h.observer as any).invalidated, false);
  } finally {
    h.observer.stop();
  }
});

test("aborted upload and malformed claim never create a successful association; explicit empty differs from unknown references", async () => {
  for (const fail of ["abort", "claim"]) {
    const h = setup();
    try {
      h.reserve();
      await until(() => (h.observer as any).reservations.size === 1);
      const xhr = new h.XHR();
      xhr.open("PUT", uploadUrl, true);
      xhr.send(new Blob(["x"], { type: "text/plain" }));
      xhr.finish(201, fail === "abort");
      if (fail === "claim")
        h.fetch(
          evidence.chatgpt.claim.path,
          "{}",
          new Response(
            JSON.stringify({
              type: "file.processing.completed",
              data: { file_id: identity },
            }),
          ),
        );
      await until(() => (h.observer as any).readers.size === 0);
      h.dispatch();
      assert.equal(associations(h.messages).at(-1).status, "unavailable");
      h.dispatch([]);
      assert.equal(associations(h.messages).at(-1).status, "observed_empty");
      const count = h.messages.length;
      h.observer.dispatch(
        crypto.randomUUID(),
        new URL(evidence.chatgpt.generation.path, h.origin),
        JSON.stringify({
          messages: [{ content: { parts: ["not file text"] } }],
        }),
        h.observer.context(),
      );
      assert.equal(h.messages.length, count);
    } finally {
      h.observer.stop();
    }
  }
});

test("Perplexity proposed results-map contract uses exact native FormData File/key and observed 204 without reading host bytes", async () => {
  const h = setup("perplexity"),
    client = crypto.randomUUID(),
    id = crypto.randomUUID(),
    bucket = "https://ppl-ai-file-upload.s3.amazonaws.com/",
    key = `uploads/${id}/PRIVATE_FILENAME_MARKER.txt`,
    object = bucket + key;
  try {
    h.fetch(
      evidence.perplexity.reservation.path,
      JSON.stringify({ files: { [client]: {} } }),
      Response.json({
        results: {
          [client]: {
            file_uuid: id,
            s3_bucket_url: bucket,
            s3_object_url: object,
            fields: { key },
            rate_limited: false,
            error: null,
          },
        },
      }),
    );
    await until(() => (h.observer as any).reservations.size === 1);
    const form = new FormData(),
      file = new File(["PRIVATE_FILE_TEXT"], "PRIVATE_FILENAME_MARKER.txt", {
        type: "text/plain",
      });
    form.append("key", key);
    form.append("file", file);
    let release!: (value: Response) => void;
    const result = new Promise<Response>((resolve) => (release = resolve));
    h.fetch(bucket, form, result);
    assert.equal(h.messages[0].size, 17);
    assert.equal(form.get("file"), file);
    const capture = h.dispatch([object]);
    assert.equal(associations(h.messages).at(-1).status, "unavailable");
    release(new Response(null, { status: 204 }));
    await until(() => associations(h.messages).at(-1)?.status === "matched");
    h.dispatch([object], capture);
    assert.equal(associations(h.messages).at(-1).status, "matched");
    h.dispatch([object]);
    assert.equal(associations(h.messages).at(-1).status, "unavailable");
    for (const raw of [client, id, key, object, "PRIVATE_FILE_TEXT"])
      assert.ok(!JSON.stringify(h.messages).includes(raw));
  } finally {
    h.observer.stop();
  }
});

test("actual capture runtime preserves native fetch promise/args and rejects unsupported conversion without a second getter call", async () => {
  class TestWindow extends EventTarget {
    messages: any[] = [];
    WebSocket = class extends EventTarget {};
    XMLHttpRequest = xhrClass();
    constructor(public fetch: any) {
      super();
    }
    postMessage(value: any) {
      this.messages.push(value);
    }
  }
  let nativeCalls = 0,
    conversions = 0,
    received: any[] = [];
  const original = Promise.resolve(new Response("native host response"));
  const win = new TestWindow(function (...args: any[]) {
    nativeCalls++;
    received = args;
    String(args[0]);
    if (args[1]) void args[1].body;
    return original;
  });
  Object.assign(globalThis, {
    window: win,
    location: {
      origin: "https://chatgpt.com",
      hostname: "chatgpt.com",
      href: "https://chatgpt.com/",
      pathname: "/",
    },
  });
  installCapture();
  try {
    const url = new URL(
      "https://chatgpt.com/backend-api/files/upload_reservations",
    );
    Object.defineProperty(url, "toString", {
      value: () => {
        conversions++;
        return "https://elsewhere.example";
      },
    });
    const init = {
      method: "POST",
      get body() {
        conversions++;
        return "{}";
      },
    };
    assert.equal(win.fetch(url, init), original);
    assert.equal(nativeCalls, 1);
    assert.equal(conversions, 2);
    assert.equal(received[0], url);
    assert.equal(received[1], init);
    assert.equal(await (await original).text(), "native host response");
    await tick();
    assert.equal(win.messages.length, 0);
  } finally {
    win.dispatchEvent(new Event("pagehide"));
  }
});

test("actual runtime posts capture dispatch before association and preserves host response and controls", async () => {
  class TestWindow extends EventTarget {
    messages: any[] = [];
    WebSocket = class extends EventTarget {};
    XMLHttpRequest = xhrClass();
    constructor(public fetch: any) {
      super();
    }
    postMessage(value: any) {
      this.messages.push(value);
    }
  }
  const calls: any[][] = [];
  const native = function (...args: any[]) {
    calls.push(args);
    const path = new URL(args[0]).pathname;
    if (path === evidence.chatgpt.reservation.path)
      return Promise.resolve(
        Response.json({
          eligible: true,
          reservation_id: identity,
          upload_url: uploadUrl,
        }),
      );
    if (path === evidence.chatgpt.claim.path)
      return Promise.resolve(new Response(claimBody()));
    return Promise.resolve(new Response("data: [DONE]\n\n"));
  };
  const win = new TestWindow(native);
  Object.assign(globalThis, {
    window: win,
    location: {
      origin: "https://chatgpt.com",
      hostname: "chatgpt.com",
      href: "https://chatgpt.com/",
      pathname: "/",
    },
  });
  installCapture();
  try {
    const reservation = await win.fetch(
      "https://chatgpt.com" + evidence.chatgpt.reservation.path,
      { method: "POST", body: "{}" },
    );
    await reservation.json();
    // Let the bounded cloned response complete before exercising native upload.
    for (let i = 0; i < 8; i++) await tick();
    const xhr = new win.XMLHttpRequest();
    xhr.open("PUT", uploadUrl, true);
    const blob = new Blob(["x"], { type: "text/plain" });
    xhr.send(blob);
    xhr.finish();
    const claim = await win.fetch(
      "https://chatgpt.com" + evidence.chatgpt.claim.path,
      { method: "POST", body: "{}" },
    );
    assert.equal(await claim.text(), claimBody());
    for (let i = 0; i < 8; i++) await tick();
    const init = {
      method: "POST",
      body: JSON.stringify({
        messages: [
          {
            id: crypto.randomUUID(),
            author: { role: "user" },
            content: { parts: ["ordinary prompt"] },
            metadata: { attachments: [attachment] },
          },
        ],
      }),
    };
    const result = win.fetch(
      "https://chatgpt.com" + evidence.chatgpt.generation.path,
      init,
    );
    assert.equal(calls.at(-1)![1], init);
    assert.equal(await (await result).text(), "data: [DONE]\n\n");
    await until(() =>
      associations(win.messages).some((value) => value.status === "matched"),
    );
    const association = associations(win.messages).find(
      (value) => value.status === "matched",
    );
    const dispatchIndex = win.messages.findIndex(
        (value) =>
          value.event === "dispatch" && value.id === association.captureId,
      ),
      associationIndex = win.messages.indexOf(association);
    assert.ok(dispatchIndex >= 0 && associationIndex > dispatchIndex);
    assert.equal(win.messages[dispatchIndex].dispatch.input, "ordinary prompt");
    assert.equal(calls.length, 3);
    const event = new Event("message");
    Object.assign(event, {
      source: win,
      origin: "https://chatgpt.com",
      data: { channel: "ai-footprint-control-v1", action: "stop" },
    });
    win.dispatchEvent(event);
    assert.equal(win.fetch, native);
  } finally {
    win.dispatchEvent(new Event("pagehide"));
  }
});

test("native Request stream mutation never authorizes an upload association, while host promise and ordinary capture remain intact", async () => {
  const wire = (suffix: string) =>
    JSON.stringify({
      messages: [
        {
          id: "00000000-0000-4000-8000-000000000050",
          author: { role: "user" },
          content: { parts: [`file-${suffix}`] },
          metadata: {
            attachments: [
              {
                ...attachment,
                id: "file_" + (suffix === "a" ? "1" : "2").padStart(32, "0"),
              },
            ],
          },
        },
      ],
    });
  const originalText = wire("a"),
    changedText = wire("b"),
    chunk = new TextEncoder().encode(originalText);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(chunk);
      controller.close();
    },
  });
  const request = new Request(
    "https://chatgpt.com" + evidence.chatgpt.generation.path,
    { method: "POST", body: stream, duplex: "half" } as RequestInit,
  );
  // This independently delayed clone demonstrates that native Request cloning does not freeze queued chunks.
  const lateClone = request.clone();
  let hostText: string | null = null,
    hostPromise: Promise<Response> | null = null;
  const calls: unknown[][] = [];
  class TestWindow extends EventTarget {
    messages: any[] = [];
    WebSocket = class extends EventTarget {};
    XMLHttpRequest = xhrClass();
    constructor(public fetch: any) {
      super();
    }
    postMessage(value: any) {
      this.messages.push(value);
    }
  }
  const win = new TestWindow(function (...args: unknown[]) {
    calls.push(args);
    hostPromise = (args[0] as Request).arrayBuffer().then((bytes) => {
      hostText = new TextDecoder().decode(bytes);
      chunk.set(new TextEncoder().encode(changedText));
      return new Response("data: [DONE]\n\n");
    });
    return hostPromise;
  });
  Object.assign(globalThis, {
    window: win,
    location: {
      origin: "https://chatgpt.com",
      hostname: "chatgpt.com",
      href: "https://chatgpt.com/",
      pathname: "/",
    },
  });
  installCapture();
  try {
    const result: Promise<Response> = win.fetch(request);
    assert.ok(result);
    assert.equal(Object.is(result, hostPromise), true);
    assert.deepEqual(calls, [[request]]);
    assert.equal(await (await result).text(), "data: [DONE]\n\n");
    assert.equal(hostText, originalText);
    assert.equal(await lateClone.text(), changedText);
    await until(() => win.messages.some((value) => value.event === "end"));
    assert.ok(win.messages.some((value) => value.event === "dispatch"));
    assert.equal(associations(win.messages).length, 0);
  } finally {
    win.dispatchEvent(new Event("pagehide"));
  }
});
