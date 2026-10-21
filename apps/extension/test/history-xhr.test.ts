import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import { installCapture } from "../lib/capture-runtime";
import {
  HISTORY_CAPTURE_CHANNEL,
  HISTORY_DIAGNOSTIC_CHANNEL,
  validateHistoryDiagnostic,
  HISTORY_RESET_CHANNEL,
} from "../lib/history-capture";
import { CLAUDE_STREAM_CHANNEL } from "../lib/claude-history-message";
import { PROVIDER_STREAM_CHANNEL } from "../lib/provider-history-message";
const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(
        `../../../fixtures/history-observation-2026-09-14/${name}.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
const id = "00000000-0000-4000-8000-000000000042";
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5));
async function until(predicate: () => boolean) {
  for (let i = 0; i < 200 && !predicate(); i++) await tick();
  assert.ok(predicate());
}
function environment(site: "gemini" | "claude" | "chatgpt", type = "text") {
  const origin =
    site === "gemini"
      ? "https://gemini.google.com"
      : site === "claude"
        ? "https://claude.ai"
        : "https://chatgpt.com";
  const pathname =
    site === "gemini"
      ? "/app/0000000000000042"
      : site === "claude"
        ? `/chat/${id}`
        : `/c/${id}`;
  Object.assign(globalThis, {
    location: {
      origin,
      hostname: new URL(origin).hostname,
      pathname,
      href: origin + pathname,
    },
  });
  class NativeXHR extends EventTarget {
    calls: any[][] = [];
    abortions = 0;
    reads = 0;
    ready = 0;
    code = 0;
    mode = type;
    value: any;
    url = "";
    throwOnSend: Error | null = null;
    get readyState() {
      return this.ready;
    }
    get status() {
      return this.code;
    }
    get responseType() {
      return this.mode;
    }
    get responseText() {
      this.reads++;
      if (this.mode === "json") throw new Error("wrong response getter");
      return this.value;
    }
    get response() {
      this.reads++;
      return this.value;
    }
    get responseURL() {
      return this.url;
    }
    open(...args: any[]) {
      this.calls.push(["open", ...args]);
      this.url = new URL(args[1], origin).href;
      return "original-open-return";
    }
    send(...args: any[]) {
      this.calls.push(["send", ...args]);
      if (this.throwOnSend) throw this.throwOnSend;
      return "original-send-return";
    }
    abort() {
      this.abortions++;
      this.dispatchEvent(new Event("abort"));
    }
    finish(value: any, code = 200) {
      this.ready = 4;
      this.code = code;
      this.value = value;
      this.dispatchEvent(new Event("load"));
    }
  }
  const nativeOpen = NativeXHR.prototype.open,
    nativeSend = NativeXHR.prototype.send;
  class WindowDouble extends EventTarget {
    messages: any[] = [];
    fetchCalls = 0;
    XMLHttpRequest = NativeXHR as any;
    WebSocket = class {} as any;
    fetch = async () => {
      this.fetchCalls++;
      return new Response("unused");
    };
    postMessage(value: any, _origin?: string, ports?: MessagePort[]) {
      this.messages.push(value);
      if (value.channel === CLAUDE_STREAM_CHANNEL || value.channel === PROVIDER_STREAM_CHANNEL) {
        ports?.[0]?.postMessage({ accepted: true });
        ports?.[0]?.close();
      }
    }
  }
  const window = new WindowDouble();
  Object.assign(globalThis, { window });
  installCapture();
  return {
    window,
    NativeXHR,
    nativeOpen,
    nativeSend,
    close() {
      window.dispatchEvent(new Event("pagehide"));
    },
  };
}
test("actual Gemini XHR history preserves native constructor/open/send/response and never fetches", async () => {
  const env = environment("gemini");
  try {
    const fixtureBody = fixture("gemini-selected-history");
    const body = new URLSearchParams({
      "f.req": JSON.stringify([
        [
          [
            "hNvQHb",
            JSON.stringify(fixtureBody.request_arguments),
            null,
            "generic",
          ],
        ],
      ]),
    }).toString();
    const url =
      "https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=hNvQHb";
    const xhr = new env.NativeXHR();
    assert.equal(env.window.XMLHttpRequest, env.NativeXHR);
    assert.equal(xhr.open("POST", url, true), "original-open-return");
    assert.equal(xhr.send(body), "original-send-return");
    assert.deepEqual(xhr.calls, [
      ["open", "POST", url, true],
      ["send", body],
    ]);
    const wire = readFileSync(
      new URL(
        "../../../fixtures/history-observation-2026-09-14/gemini-history-wire.txt",
        import.meta.url,
      ),
      "utf8",
    );
    xhr.finish(wire);
    await until(() =>
      env.window.messages.some(
        (m) => m.channel === PROVIDER_STREAM_CHANNEL && m.event === "finish",
      ),
    );
    assert.equal(xhr.responseText, wire);
    assert.equal(env.window.fetchCalls, 0);
    const messages = env.window.messages;
    assert.deepEqual(
      messages.map((m) => m.event),
      ["start", "batch", "finish"],
    );
    assert.equal(messages[1].rows.length, 10);
    xhr.dispatchEvent(new Event("load"));
    await tick();
    assert.equal(env.window.messages.length, messages.length);
    assert.equal(xhr.abortions, 0);
  } finally {
    env.close();
  }
  assert.equal(env.NativeXHR.prototype.open, env.nativeOpen);
  assert.equal(env.NativeXHR.prototype.send, env.nativeSend);
});
test("Gemini XHR history sent before the address changes imports once the route matches", async () => {
  const env = environment("gemini");
  const route = location.pathname;
  Object.assign(location, { pathname: "/app" });
  try {
    const fixtureBody = fixture("gemini-selected-history");
    const body = new URLSearchParams({
      "f.req": JSON.stringify([
        [
          [
            "hNvQHb",
            JSON.stringify(fixtureBody.request_arguments),
            null,
            "generic",
          ],
        ],
      ]),
    }).toString();
    const xhr = new env.NativeXHR();
    xhr.open(
      "POST",
      "https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=hNvQHb",
      true,
    );
    xhr.send(body);
    await tick();
    assert.equal(env.window.messages.length, 0);
    Object.assign(location, { pathname: route });
    xhr.finish(
      readFileSync(
        new URL(
          "../../../fixtures/history-observation-2026-09-14/gemini-history-wire.txt",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await until(() =>
      env.window.messages.some(
        (m) => m.channel === PROVIDER_STREAM_CHANNEL && m.event === "finish",
      ),
    );
    assert.deepEqual(
      env.window.messages.map((m) => m.event),
      ["start", "batch", "finish"],
    );
    assert.equal(env.window.messages[0].conversationId, "c_0000000000000042");
  } finally {
    env.close();
  }
});
test("G17 Gemini history of a secondary account (/u/N/) imports like the first account's", async () => {
  const env = environment("gemini");
  Object.assign(location, {
    pathname: "/u/1/app/0000000000000042",
    href: "https://gemini.google.com/u/1/app/0000000000000042",
  });
  try {
    const fixtureBody = fixture("gemini-selected-history");
    const body = new URLSearchParams({
      "f.req": JSON.stringify([
        [
          [
            "hNvQHb",
            JSON.stringify(fixtureBody.request_arguments),
            null,
            "generic",
          ],
        ],
      ]),
    }).toString();
    const xhr = new env.NativeXHR();
    xhr.open(
      "POST",
      "https://gemini.google.com/u/1/_/BardChatUi/data/batchexecute?rpcids=hNvQHb&source-path=%2Fu%2F1%2Fapp%2F0000000000000042",
      true,
    );
    xhr.send(body);
    xhr.finish(
      readFileSync(
        new URL(
          "../../../fixtures/history-observation-2026-09-14/gemini-history-wire.txt",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await until(() =>
      env.window.messages.some(
        (m) => m.channel === PROVIDER_STREAM_CHANNEL && m.event === "finish",
      ),
    );
    assert.deepEqual(
      env.window.messages.map((m) => m.event),
      ["start", "batch", "finish"],
    );
    assert.equal(env.window.messages[0].conversationId, "c_0000000000000042");
    assert.equal(env.window.messages[1].rows.length, 10);
  } finally {
    env.close();
  }
  // Another path prefix is not a Google account and is not read.
  const other = environment("gemini");
  Object.assign(location, { pathname: "/v/1/app/0000000000000042" });
  try {
    const fixtureBody = fixture("gemini-selected-history");
    const xhr = new other.NativeXHR();
    xhr.open(
      "POST",
      "https://gemini.google.com/v/1/_/BardChatUi/data/batchexecute?rpcids=hNvQHb",
      true,
    );
    xhr.send(
      new URLSearchParams({
        "f.req": JSON.stringify([
          [["hNvQHb", JSON.stringify(fixtureBody.request_arguments), null, "generic"]],
        ]),
      }).toString(),
    );
    xhr.finish("unused");
    await tick();
    assert.equal(other.window.messages.length, 0);
  } finally {
    other.close();
  }
});

test("eligible native JSON history never invokes page serializers or accessors", async () => {
  const env = environment("claude", "json");
  try {
    const first = new env.NativeXHR();
    first.open(
      "GET",
      `https://claude.ai/api/organizations/00000000-0000-4000-8000-000000000011/chat_conversations/${id}`,
      true,
    );
    first.send();
    const value = fixture("claude-selected-history");
    first.finish(value);
    await until(() =>
      env.window.messages.some(
        (m) => m.channel === CLAUDE_STREAM_CHANNEL && m.event === "finish",
      ),
    );
    assert.equal(
      env.window.messages.find(
        (m) => m.channel === CLAUDE_STREAM_CHANNEL && m.event === "batch",
      ).rows.length,
      2,
    );
    assert.equal(first.response, value);
    let accessed = 0;
    const second = new env.NativeXHR();
    second.open("GET", first.url, true);
    second.send();
    const bad = fixture("claude-selected-history");
    Object.defineProperty(bad, "toJSON", {
      enumerable: true,
      get() {
        accessed++;
        throw new Error("page getter");
      },
    });
    second.finish(bad);
    await until(() =>
      env.window.messages.some(
        (m) => m.channel === HISTORY_CAPTURE_CHANNEL && m.event === "page",
      ),
    );
    assert.equal(accessed, 0);
    assert.equal(env.window.messages.at(-1).page.status, "unsupported");
  } finally {
    env.close();
  }
});
test("XHR history reset removes owned listeners without aborting host; async coercions remain unsupported", async () => {
  const env = environment("claude");
  try {
    const url = `https://claude.ai/api/organizations/00000000-0000-4000-8000-000000000011/chat_conversations/${id}`;
    for (const async of [false, 0, "", null]) {
      const xhr = new env.NativeXHR();
      xhr.open("GET", url, async);
      xhr.send();
      xhr.finish("{}");
    }
    assert.equal(env.window.messages.length, 0);
    const xhr = new env.NativeXHR();
    xhr.open("GET", url, true);
    xhr.send();
    const event = new Event("message");
    Object.assign(event, {
      source: env.window,
      origin: location.origin,
      data: { channel: HISTORY_RESET_CHANNEL },
    });
    env.window.dispatchEvent(event);
    xhr.finish(JSON.stringify(fixture("claude-selected-history")));
    await tick();
    await tick();
    assert.equal(xhr.reads, 0);
    assert.equal(xhr.abortions, 0);
    assert.equal(
      env.window.messages.filter((m) => m.event === "page").length,
      0,
    );
  } finally {
    env.close();
  }
});
test("history XHR wrappers compose with upload wrappers and preserve host send exceptions", async () => {
  const env = environment("chatgpt");
  try {
    const xhr = new env.NativeXHR(),
      error = new Error("native-send-error");
    xhr.open(
      "GET",
      `https://chatgpt.com/backend-api/conversations/${id}`,
      true,
    );
    xhr.throwOnSend = error;
    assert.throws(
      () => xhr.send(),
      (value) => value === error,
    );
    const next = new env.NativeXHR();
    next.open(
      "GET",
      `https://chatgpt.com/backend-api/conversations/${id}`,
      true,
    );
    next.send();
    next.finish(JSON.stringify(fixture("chatgpt-flat-page")));
    await until(() => env.window.messages.some((m) => m.channel === PROVIDER_STREAM_CHANNEL && m.event === "finish"));
    assert.equal(
      env.window.messages.find((m) => m.channel === PROVIDER_STREAM_CHANNEL && m.event === "batch").rows.length,
      4,
    );
  } finally {
    env.close();
  }
  assert.equal(env.NativeXHR.prototype.open, env.nativeOpen);
  assert.equal(env.NativeXHR.prototype.send, env.nativeSend);
});
test("XHR open metadata expires and a flood cannot accumulate unbounded unsent observations", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const env = environment("claude");
  const observations = () =>
    env.window.messages.filter((m) => m.channel === HISTORY_CAPTURE_CHANNEL);
  const diagnostics = () =>
    env.window.messages.filter((m) => m.channel === HISTORY_DIAGNOSTIC_CHANNEL);
  try {
    const url = `https://claude.ai/api/organizations/00000000-0000-4000-8000-000000000011/chat_conversations/${id}`;
    const old = new env.NativeXHR();
    old.open("GET", url, true);
    t.mock.timers.tick(30000);
    old.send();
    assert.equal(observations().length, 0);
    assert.equal(diagnostics().length, 1);
    assert.ok(validateHistoryDiagnostic(diagnostics()[0], "claude.ai"));
    const opened = Array.from({ length: 17 }, () => {
      const xhr = new env.NativeXHR();
      xhr.open("GET", url, true);
      return xhr;
    });
    opened[0]!.send();
    assert.equal(observations().length, 0);
    opened.at(-1)!.send();
    assert.equal(observations().length, 1);
    opened.at(-2)!.send();
    assert.equal(observations().length, 2);
    opened.at(-3)!.send();
    assert.equal(observations().length, 2);
    assert.equal(diagnostics().length, 1);
    assert.ok(opened.every((xhr) => xhr.abortions === 0));
  } finally {
    env.close();
    t.mock.timers.reset();
  }
});
test("unsupported XHR response types and oversized text fail only the observation", async () => {
  const env = environment("claude");
  try {
    const url = `https://claude.ai/api/organizations/00000000-0000-4000-8000-000000000011/chat_conversations/${id}`;
    const binary = new env.NativeXHR();
    binary.mode = "arraybuffer";
    binary.open("GET", url, true);
    binary.send();
    const bytes = new Uint8Array([1, 2]);
    binary.finish(bytes);
    await until(() => env.window.messages.some((m) => m.event === "page"));
    assert.equal(env.window.messages.at(-1).page.status, "unsupported");
    assert.equal(binary.reads, 0);
    assert.equal(binary.response, bytes);
    const large = new env.NativeXHR();
    large.open("GET", url, true);
    large.send();
    const text = "x".repeat(1048577);
    large.finish(text);
    await until(
      () => env.window.messages.filter((m) => m.event === "page").length === 2,
    );
    assert.equal(env.window.messages.at(-1).page.status, "unsupported");
    assert.equal(large.responseText, text);
  } finally {
    env.close();
  }
});
test("XHR saturation and native pending timeouts are visible without extra starts or premature physical reuse", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  const env = environment("claude");
  const observations = () =>
    env.window.messages.filter((m) => m.channel === HISTORY_CAPTURE_CHANNEL);
  const diagnostics = () =>
    env.window.messages.filter((m) => m.channel === HISTORY_DIAGNOSTIC_CHANNEL);
  try {
    const url = `https://claude.ai/api/organizations/00000000-0000-4000-8000-000000000011/chat_conversations/${id}`;
    const start = () => {
      const xhr = new env.NativeXHR();
      xhr.open("GET", url, true);
      xhr.send();
      return xhr;
    };
    const first = start(),
      second = start();
    for (let i = 0; i < 25; i++) start();
    assert.equal(observations().length, 2);
    assert.equal(diagnostics().length, 1);
    assert.equal(diagnostics()[0].reason, "history_limit");
    const ids = observations().map((m) => m.id);
    now += 30001;
    t.mock.timers.tick(30001);
    assert.deepEqual(
      diagnostics()
        .filter((m) => m.reason === "history_timeout")
        .map((m) => m.id),
      ids,
    );
    start();
    assert.equal(observations().length, 2);
    first.finish("DO_NOT_READ_EXPIRED_BODY");
    second.finish("DO_NOT_READ_EXPIRED_BODY");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(first.reads + second.reads, 0);
    const recovered = start();
    recovered.finish(JSON.stringify(fixture("claude-selected-history")));
    for (
      let i = 0;
      i < 1000 &&
      !env.window.messages.some(
        (m) => m.channel === CLAUDE_STREAM_CHANNEL && m.event === "finish",
      );
      i++
    )
      await setImmediate();
    assert.equal(
      env.window.messages.find(
        (m) => m.channel === CLAUDE_STREAM_CHANNEL && m.event === "batch",
      ).rows.length,
      2,
    );
    assert.ok(
      env.window.messages.some(
        (m) => m.channel === CLAUDE_STREAM_CHANNEL && m.event === "finish",
      ),
    );
    assert.equal(first.abortions + second.abortions, 0);
  } finally {
    env.close();
    Date.now = realNow;
    t.mock.timers.reset();
  }
});
test("metadata eviction reports one limit and a different route does not inherit its diagnostic", () => {
  const env = environment("claude");
  try {
    const url = `https://claude.ai/api/organizations/00000000-0000-4000-8000-000000000011/chat_conversations/${id}`;
    for (let i = 0; i < 100; i++) new env.NativeXHR().open("GET", url, true);
    const diagnostics = env.window.messages.filter(
      (m) => m.channel === HISTORY_DIAGNOSTIC_CHANNEL,
    );
    assert.equal(diagnostics.length, 1);
    assert.ok(validateHistoryDiagnostic(diagnostics[0], "claude.ai"));
    assert.equal(
      env.window.messages.filter((m) => m.channel === HISTORY_CAPTURE_CHANNEL)
        .length,
      0,
    );
    Object.assign(location, {
      pathname: "/chat/00000000-0000-4000-8000-000000000099",
    });
    new env.NativeXHR().open("GET", url, true);
    assert.equal(env.window.messages.length, 1);
  } finally {
    env.close();
  }
});
