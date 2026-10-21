import assert from "node:assert/strict";
import test from "node:test";
import { uploadBodyReader } from "../lib/upload-body";
import { UploadFileOffers } from "../lib/upload-file-offers";
import { FILE_RELAY_LIMITS } from "../lib/file-relay-protocol";
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("native Blob/File brand checks ignore instance getters and overrides, reject mutable or opaque bodies", async () => {
  const reader = uploadBodyReader(),
    original = new Blob(["private synthetic file"], { type: "text/plain" });
  let touched = 0;
  Object.defineProperties(original, {
    size: {
      get() {
        touched++;
        throw new Error("unexpected getter");
      },
    },
    arrayBuffer: {
      get() {
        touched++;
        throw new Error("unexpected getter");
      },
    },
  });
  const snapshot = reader.blob(original)!;
  assert.ok(snapshot);
  assert.equal(
    new TextDecoder().decode(await reader.read(snapshot)),
    "private synthetic file",
  );
  assert.equal(touched, 0);
  for (const unsupported of [
    new Uint8Array([1]),
    new ArrayBuffer(1),
    new ReadableStream(),
    "text",
    {
      size: 4,
      type: "text/plain",
      arrayBuffer: async () => new ArrayBuffer(4),
    },
    new Blob(["x"], { type: "application/octet-stream" }),
  ])
    assert.equal(reader.blob(unsupported), null);
  const form = new FormData(),
    file = new File(["original"], "PRIVATE_NAME.txt", { type: "text/plain" });
  form.append("key", "opaque/form/key");
  form.append("file", file);
  Object.defineProperty(form, "getAll", {
    get() {
      touched++;
      throw new Error("unexpected getter");
    },
  });
  const selected = reader.multipart(form)!;
  assert.ok(selected);
  form.set("file", new File(["changed"], "other.txt", { type: "text/plain" }));
  assert.equal(
    new TextDecoder().decode(await reader.read(selected.file)),
    "original",
  );
  assert.equal(touched, 0);
  form.append("file", file);
  assert.equal(reader.multipart(form), null);
  const flood = new FormData();
  for (let i = 0; i < 33; i++) flood.append("unused", String(i));
  flood.append("key", "k");
  flood.append("file", file);
  assert.equal(reader.multipart(flood), null);
});

test("request option accessors and opaque URLs are not executed by observation", () => {
  const reader = uploadBodyReader();
  let calls = 0;
  const init = {
    method: "POST",
    get body() {
      calls++;
      return new Blob(["x"]);
    },
  };
  assert.equal(
    reader.request(
      "https://chatgpt.com/backend-api/files/upload_reservations",
      init,
      "https://chatgpt.com",
    ),
    null,
  );
  assert.equal(
    reader.request(
      {
        toString() {
          calls++;
          return "https://chatgpt.com";
        },
      },
      { method: "POST" },
      "https://chatgpt.com",
    ),
    null,
  );
  assert.equal(calls, 0);
});

test("custom URL conversions, subclasses and inherited RequestInit accessors remain unsupported without extra reads", () => {
  const reader = uploadBodyReader(),
    base = "https://chatgpt.com";
  let calls = 0;
  for (const key of ["toString", Symbol.toPrimitive]) {
    const url = new URL(base);
    Object.defineProperty(url, key, {
      get() {
        calls++;
        return () => base;
      },
    });
    assert.equal(reader.request(url, { method: "POST" }, base), null);
  }
  class CustomURL extends URL {
    override toString() {
      calls++;
      return "https://other.example";
    }
  }
  assert.equal(reader.request(new CustomURL(base), {}, base), null);
  for (const key of ["body", "headers", "signal"]) {
    const init = {};
    Object.defineProperty(init, key, {
      get() {
        calls++;
        return undefined;
      },
    });
    assert.equal(reader.request(base, init, base), null);
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      get() {
        calls++;
        return undefined;
      },
    });
    try {
      assert.equal(reader.request(base, {}, base), null);
    } finally {
      delete (Object.prototype as any)[key];
    }
  }
  assert.equal(calls, 0);
  assert.equal(reader.request(new URL(base), {}, base)?.url.origin, base);
  const request = new Request(base, { method: "POST", body: "native" });
  Object.defineProperty(request, "url", {
    get() {
      calls++;
      return "bad";
    },
  });
  assert.equal(
    reader.request(request, undefined, base)?.nativeRequest,
    request,
  );
  assert.equal(calls, 0);
});

test("multipart observation rejects header conversion callbacks without invoking them", () => {
  const reader = uploadBodyReader(),
    body = new FormData();
  body.append("key", "k");
  body.append("file", new File(["x"], "x.txt", { type: "text/plain" }));
  let calls = 0;
  const headers: any[] = [];
  Object.defineProperty(headers, "0", {
    enumerable: true,
    get() {
      calls++;
      return ["a", "b"];
    },
  });
  for (const init of [
    { body, headers },
    {
      body,
      headers: {
        get x() {
          calls++;
          return "x";
        },
      },
    },
    {
      body,
      credentials: {
        toString() {
          calls++;
          body.delete("file");
          return "omit";
        },
      },
    },
  ])
    assert.equal(
      reader.request(
        "https://example.com",
        { method: "POST", ...init },
        "https://example.com",
      ),
      null,
    );
  assert.equal(calls, 0);
  assert.ok(reader.multipart(body));
});

test("private bytes are read only after the exact ready reply and transferred without detaching the original Blob", async () => {
  const reader = uploadBodyReader(),
    blob = new Blob(["private bytes"], { type: "text/plain" }),
    messages: any[] = [];
  let reads = 0;
  const offers = new UploadFileOffers(
    (value) => messages.push(value),
    (file) => {
      reads++;
      return reader.read(file);
    },
  );
  const channel = new MessageChannel(),
    got = new Promise<ArrayBuffer>((resolve) => {
      channel.port2.onmessage = (event) => resolve(event.data.bytes);
    });
  try {
    assert.equal(
      offers.offer(crypto.randomUUID(), reader.blob(blob)!, Date.now()),
      true,
    );
    const offer = messages[0];
    assert.equal(reads, 0);
    offers.receive(
      {
        channel: "ai-footprint-file-port-v1",
        offerId: crypto.randomUUID(),
        fileHandle: offer.fileHandle,
        status: "ready",
      },
      [channel.port1],
    );
    await tick();
    assert.equal(reads, 0);
    offers.receive(
      {
        channel: "ai-footprint-file-port-v1",
        offerId: offer.offerId,
        fileHandle: offer.fileHandle,
        status: "ready",
      },
      [channel.port1],
    );
    const bytes = await got;
    assert.equal(new TextDecoder().decode(bytes), "private bytes");
    assert.equal(await blob.text(), "private bytes");
    assert.equal(reads, 1);
    channel.port2.postMessage({
      target: "file-relay-status",
      status: "complete",
    });
    await tick();
    await tick();
    assert.equal(messages.at(-1).channel, "ai-footprint-file-complete-v1");
    assert.equal(messages.at(-1).status, "complete");
    assert.ok(!JSON.stringify(messages).includes("private bytes"));
  } finally {
    offers.reset();
    channel.port1.close();
    channel.port2.close();
  }
});

test("timeout/reset keep one physical read admitted until it settles and discard its late private copy", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const reader = uploadBodyReader(),
    file = reader.blob(new Blob(["late"], { type: "text/plain" }))!,
    messages: any[] = [];
  let release!: (bytes: ArrayBuffer) => void,
    reads = 0;
  const pending = new Promise<ArrayBuffer>((resolve) => (release = resolve));
  const offers = new UploadFileOffers(
    (value) => messages.push(value),
    () => {
      reads++;
      return pending;
    },
  );
  const channel = new MessageChannel();
  let delivered = 0;
  channel.port2.onmessage = () => delivered++;
  try {
    offers.offer(crypto.randomUUID(), file, Date.now());
    const offer = messages[0];
    offers.receive(
      {
        channel: "ai-footprint-file-port-v1",
        offerId: offer.offerId,
        fileHandle: offer.fileHandle,
        status: "ready",
      },
      [channel.port1],
    );
    await tick();
    assert.equal(reads, 1);
    t.mock.timers.tick(FILE_RELAY_LIMITS.timeoutMs + 1);
    offers.reset();
    assert.equal(offers.offer(crypto.randomUUID(), file, Date.now()), false);
    const copy = new TextEncoder().encode("late").buffer;
    release(copy);
    await tick();
    await tick();
    assert.equal(delivered, 0);
    assert.ok(new Uint8Array(copy).every((value) => value === 0));
    assert.equal(offers.offer(crypto.randomUUID(), file, Date.now()), true);
  } finally {
    offers.reset();
    channel.port1.close();
    channel.port2.close();
  }
});

test("reset immediately after ready prevents starting even a scheduled byte read", async () => {
  const reader = uploadBodyReader(),
    file = reader.blob(new Blob(["x"], { type: "text/plain" }))!,
    messages: any[] = [];
  let reads = 0;
  const offers = new UploadFileOffers(
    (value) => messages.push(value),
    async () => {
      reads++;
      return new ArrayBuffer(1);
    },
  );
  const channel = new MessageChannel();
  offers.offer(crypto.randomUUID(), file, Date.now());
  const offer = messages[0];
  offers.receive(
    {
      channel: "ai-footprint-file-port-v1",
      offerId: offer.offerId,
      fileHandle: offer.fileHandle,
      status: "ready",
    },
    [channel.port1],
  );
  offers.reset();
  await tick();
  assert.equal(reads, 0);
  channel.port2.close();
});

test("read failures and oversized native files report unavailable without a byte response", async () => {
  const reader = uploadBodyReader(),
    messages: any[] = [],
    file = reader.blob(new Blob(["x"], { type: "text/plain" }))!;
  assert.equal(
    reader.blob(
      new Blob([new Uint8Array(FILE_RELAY_LIMITS.inputBytes + 1)], {
        type: "text/plain",
      }),
    ),
    null,
  );
  const offers = new UploadFileOffers(
    (value) => messages.push(value),
    async () => {
      throw new Error("synthetic read failure");
    },
  );
  const channel = new MessageChannel();
  let bytes = 0;
  channel.port2.onmessage = () => bytes++;
  try {
    offers.offer(crypto.randomUUID(), file, Date.now());
    const offer = messages[0];
    offers.receive(
      {
        channel: "ai-footprint-file-port-v1",
        offerId: offer.offerId,
        fileHandle: offer.fileHandle,
        status: "ready",
      },
      [channel.port1],
    );
    await tick();
    await tick();
    assert.equal(bytes, 0);
    assert.equal(messages.at(-1).status, "unavailable");
    assert.equal(messages.at(-1).channel, "ai-footprint-file-complete-v1");
  } finally {
    offers.reset();
    channel.port2.close();
  }
});
