import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installCapture } from "../lib/capture-runtime";
import {
  createProviderAdapterRegistry,
  PACKAGED_PROVIDER_ADAPTERS,
  type ProviderAdapterRegistry,
} from "@footprint/adapters";
import { CAPTURE_TIMES, LIMITS } from "@footprint/capture-core";
import { HISTORY_RESET_CHANNEL } from "../lib/history-capture";

const endpoint =
  "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";
const body = new URLSearchParams({
  "f.req": JSON.stringify([
    null,
    JSON.stringify([
      ["safe prompt"],
      null,
      ["c_0000000000000042", "r_0000000000000041"],
    ]),
  ]),
}).toString();
function frame(text: string) {
  const inner: unknown[] = [
    null,
    ["c_0000000000000042", "r_0000000000000042"],
    null,
    null,
    [["rc_0000000000000042", [text]]],
  ];
  const payload = JSON.stringify([["wrb.fr", null, JSON.stringify(inner)]]);
  return `${payload.length + 2}\n${payload}\n`;
}
function environment(
  providers?: ProviderAdapterRegistry,
  fetchFactory?: (XHR: any) => typeof fetch,
) {
  class NativeXHR extends EventTarget {
    calls: unknown[][] = [];
    ready = 1;
    code = 200;
    mode = "";
    value = "";
    url = "";
    throwOnSend: Error | null = null;
    throwOnOpen: Error | null = null;
    duringSend: (() => void) | null = null;
    textReads = 0;
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
      this.textReads++;
      return this.value;
    }
    get response() {
      return this.value;
    }
    get responseURL() {
      return this.url;
    }
    open(...args: unknown[]) {
      this.calls.push(["open", ...args]);
      if (this.throwOnOpen) throw this.throwOnOpen;
      this.url = String(args[1]);
      this.ready = 1;
      this.value = "";
      return "native open";
    }
    send(...args: unknown[]) {
      this.calls.push(["send", ...args]);
      if (this.throwOnSend) throw this.throwOnSend;
      this.duringSend?.();
      return "native send";
    }
    append(text: string) {
      this.value += text;
      this.ready = 3;
      this.dispatchEvent(new Event("progress"));
    }
    finish() {
      this.ready = 4;
      this.dispatchEvent(new Event("load"));
      this.dispatchEvent(new Event("loadend"));
    }
    abort() {
      this.dispatchEvent(new Event("abort"));
      this.dispatchEvent(new Event("loadend"));
    }
  }
  class WindowDouble extends EventTarget {
    messages: any[] = [];
    XMLHttpRequest = NativeXHR as any;
    WebSocket = class {} as any;
    fetch: typeof fetch = async () => new Response("unused");
    postMessage(value: unknown) {
      this.messages.push(value);
    }
  }
  const window = new WindowDouble();
  if (fetchFactory) window.fetch = fetchFactory(NativeXHR);
  const original = {
    open: NativeXHR.prototype.open,
    send: NativeXHR.prototype.send,
  };
  Object.assign(globalThis, {
    window,
    location: {
      origin: "https://gemini.google.com",
      hostname: "gemini.google.com",
      href: "https://gemini.google.com/app/0000000000000042",
      pathname: "/app/0000000000000042",
    },
  });
  installCapture(providers);
  return {
    window,
    NativeXHR,
    original,
    observations: () =>
      window.messages.filter(
        (m) => m.channel === "ai-footprint-observation-v1",
      ),
    close: () => window.dispatchEvent(new Event("pagehide")),
  };
}

test("Gemini live XHR records the actual generation route while preserving native calls and Unicode", () => {
  const env = environment();
  try {
    const xhr = new env.NativeXHR();
    assert.equal(xhr.open("POST", endpoint, true), "native open");
    assert.equal(xhr.send(body), "native send");
    const wire = ")]}'\n\n" + frame("safe 🍀 response");
    for (const codeUnit of wire.split("")) xhr.append(codeUnit);
    xhr.finish();
    const observations = env.observations();
    assert.equal(observations.filter((m) => m.event === "dispatch").length, 1);
    const end = observations.find((m) => m.event === "end");
    assert.equal(end?.snapshot.text, "safe 🍀 response");
    assert.equal(end?.snapshot.providerRequestId, "r_0000000000000042");
    // The request's normal end completes the reply and times it (M2, G18).
    assert.equal(end?.snapshot.state, "completed");
    assert.equal(end?.timing?.source, "browser_request");
    assert.equal(end?.failure, null);
    assert.deepEqual(xhr.calls, [
      ["open", "POST", endpoint, true],
      ["send", body],
    ]);
    assert.equal(xhr.value, wire);
  } finally {
    env.close();
  }
  assert.equal(env.NativeXHR.prototype.open, env.original.open);
  assert.equal(env.NativeXHR.prototype.send, env.original.send);
});

test("G17 a secondary Google account's live Gemini request (/u/N/) is captured and completes", () => {
  const env = environment();
  try {
    const xhr = new env.NativeXHR();
    const account = endpoint.replace(
      "https://gemini.google.com/",
      "https://gemini.google.com/u/2/",
    );
    xhr.open("POST", account + "?bl=boq&_reqid=1&rt=c", true);
    xhr.send(body);
    xhr.append(")]}'\n\n" + frame("from the second account"));
    xhr.finish();
    const observations = env.observations();
    assert.equal(observations.filter((m) => m.event === "dispatch").length, 1);
    const end = observations.find((m) => m.event === "end");
    assert.equal(end?.snapshot.text, "from the second account");
    assert.equal(end?.snapshot.state, "completed");
    assert.equal(end?.failure, null);
    // Another prefix is a different path and is not read.
    const other = new env.NativeXHR();
    other.open(
      "POST",
      endpoint.replace("https://gemini.google.com/", "https://gemini.google.com/v/2/"),
      true,
    );
    other.send(body);
    assert.equal(
      env.observations().filter((m) => m.event === "dispatch").length,
      1,
    );
  } finally {
    env.close();
  }
});

test("Gemini XHR abort by the page keeps the text received, ends as cancelled once and fails nothing", () => {
  const env = environment();
  try {
    const xhr = new env.NativeXHR();
    xhr.open("POST", endpoint, true);
    xhr.send(body);
    xhr.append(")]}'\n\n" + frame("partial"));
    xhr.abort();
    xhr.finish();
    const ends = env.observations().filter((m) => m.event === "end");
    assert.equal(ends.length, 1);
    assert.equal(ends[0].snapshot.text, "partial");
    assert.equal(ends[0].snapshot.state, "cancelled");
    assert.equal(ends[0].timing, null);
    assert.equal(ends[0].failure, null);
  } finally {
    env.close();
  }
});

test("a lost Gemini connection or a timeout stays an interruption", () => {
  for (const type of ["error", "timeout"]) {
    const env = environment();
    try {
      const xhr = new env.NativeXHR();
      xhr.open("POST", endpoint, true);
      xhr.send(body);
      xhr.append(")]}'\n\n" + frame("partial"));
      xhr.dispatchEvent(new Event(type));
      xhr.dispatchEvent(new Event("loadend"));
      const ends = env.observations().filter((m) => m.event === "end");
      assert.equal(ends.length, 1, type);
      assert.equal(ends[0].snapshot.text, "partial", type);
      assert.equal(ends[0].snapshot.state, "interrupted_unconfirmed", type);
      assert.equal(ends[0].failure, "capture_interrupted", type);
    } finally {
      env.close();
    }
  }
});

test("Gemini XHR reusing a native instance isolates old and new attempt identities", () => {
  const env = environment();
  try {
    const xhr = new env.NativeXHR();
    xhr.open("POST", endpoint, true);
    xhr.send(body);
    xhr.append(")]}'\n\n" + frame("first"));
    xhr.open("POST", endpoint, true);
    xhr.send(body);
    xhr.append(")]}'\n\n" + frame("second"));
    xhr.finish();
    const dispatches = env.observations().filter((m) => m.event === "dispatch");
    const ends = env.observations().filter((m) => m.event === "end");
    assert.equal(dispatches.length, 2);
    assert.equal(ends.length, 2);
    assert.notEqual(dispatches[0].id, dispatches[1].id);
    assert.deepEqual(
      ends.map((m) => m.snapshot.text),
      ["first", "second"],
    );
    assert.deepEqual(
      ends.map((m) => m.id),
      dispatches.map((m) => m.id),
    );
  } finally {
    env.close();
  }
});

test("native XHR open/send exceptions preserve identity and leave no measurement listeners", () => {
  const env = environment();
  try {
    const xhr = new env.NativeXHR(),
      error = new Error("native failure");
    xhr.throwOnOpen = error;
    assert.throws(
      () => xhr.open("POST", endpoint, true),
      (e) => e === error,
    );
    xhr.throwOnOpen = null;
    xhr.open("POST", endpoint, true);
    xhr.throwOnSend = error;
    assert.throws(
      () => xhr.send(body),
      (e) => e === error,
    );
    xhr.append(")]}'\n\n" + frame("no dispatch"));
    xhr.finish();
    assert.equal(env.observations().length, 0);
    xhr.throwOnSend = null;
    xhr.open("POST", endpoint, true);
    xhr.send(body);
    xhr.append(")]}'\n\n" + frame("new request"));
    xhr.finish();
    assert.equal(env.observations().filter((m) => m.event === "end").length, 1);
  } finally {
    env.close();
  }
});

test("a failed native reopen leaves the current Gemini request observable", () => {
  const env = environment();
  try {
    const xhr = new env.NativeXHR();
    xhr.open("POST", endpoint, true);
    xhr.send(body);
    xhr.append(")]}'\n\n" + frame("first"));
    xhr.throwOnOpen = new Error("native rejected open");
    assert.throws(
      () => xhr.open("POST", endpoint, true),
      (e) => e === xhr.throwOnOpen,
    );
    xhr.append(frame("final"));
    xhr.finish();
    const ends = env.observations().filter((m) => m.event === "end");
    assert.equal(ends.length, 1);
    assert.equal(ends[0].snapshot.text, "final");
  } finally {
    env.close();
  }
});

test("Gemini live XHR observes only exact same-origin async POST and reports unsupported response types", () => {
  const env = environment();
  try {
    for (const [method, url, async] of [
      ["GET", endpoint, true],
      ["POST", endpoint + "/other", true],
      ["POST", endpoint.replace("gemini.google.com", "example.org"), true],
      ["POST", endpoint, false],
    ] as const) {
      const xhr = new env.NativeXHR();
      xhr.open(method, url, async);
      xhr.send(body);
      xhr.append("unused");
      xhr.finish();
      assert.equal(xhr.textReads, 0);
    }
    assert.equal(env.observations().length, 0);
    const xhr = new env.NativeXHR();
    xhr.mode = "arraybuffer";
    xhr.open("POST", endpoint, true);
    xhr.send(body);
    xhr.append("native remains unchanged");
    xhr.finish();
    assert.equal(
      env.observations().find((m) => m.event === "end")?.failure,
      "unsupported_schema",
    );
    assert.equal(xhr.textReads, 0);
    assert.equal(xhr.value, "native remains unchanged");
  } finally {
    env.close();
  }
});

test("malformed and oversized Gemini XHR streams fail visibly after retaining valid partial output", () => {
  for (const tail of ["bad\n", "x".repeat(LIMITS.stream)]) {
    const env = environment();
    try {
      const xhr = new env.NativeXHR();
      xhr.open("POST", endpoint, true);
      xhr.send(body);
      xhr.append(")]}'\n\n" + frame("valid partial"));
      xhr.append(tail);
      xhr.finish();
      const ends = env.observations().filter((m) => m.event === "end");
      assert.equal(ends.length, 1);
      assert.equal(ends[0].snapshot.text, "valid partial");
      assert.equal(ends[0].timing, null);
      assert.equal(
        ends[0].failure,
        tail === "bad\n" ? "malformed_frame" : "buffer_overflow",
      );
      assert.ok(xhr.value.endsWith(tail));
    } finally {
      env.close();
    }
  }
});

test("Gemini XHR concurrency is bounded and a finished slot can be reused", () => {
  const env = environment();
  try {
    const requests = Array.from(
      { length: LIMITS.sessions + 1 },
      () => new env.NativeXHR(),
    );
    for (const xhr of requests) {
      xhr.open("POST", endpoint, true);
      xhr.send(body);
    }
    assert.equal(
      env.observations().filter((m) => m.event === "dispatch").length,
      LIMITS.sessions,
    );
    assert.equal(
      env
        .observations()
        .filter((m) => m.event === "health" && m.failure === "buffer_overflow")
        .length,
      1,
    );
    for (const [i, xhr] of requests.entries()) {
      xhr.append(")]}'\n\n" + frame(`response ${i}`));
      xhr.finish();
    }
    assert.equal(
      env.observations().filter((m) => m.event === "end").length,
      LIMITS.sessions,
    );
    const next = new env.NativeXHR();
    next.open("POST", endpoint, true);
    next.send(body);
    next.append(")]}'\n\n" + frame("next"));
    next.finish();
    assert.equal(
      env.observations().filter((m) => m.event === "end").length,
      LIMITS.sessions + 1,
    );
  } finally {
    env.close();
  }
});

test("history reset does not cancel live XHR and pagehide removes its observers", () => {
  const env = environment();
  try {
    const xhr = new env.NativeXHR();
    xhr.open("POST", endpoint, true);
    xhr.send(body);
    const event = new Event("message");
    Object.assign(event, {
      source: env.window,
      origin: "https://gemini.google.com",
      data: { channel: HISTORY_RESET_CHANNEL },
    });
    env.window.dispatchEvent(event);
    xhr.append(")]}'\n\n" + frame("still active"));
    xhr.finish();
    assert.equal(
      env.observations().find((m) => m.event === "end")?.snapshot.text,
      "still active",
    );
    const active = new env.NativeXHR();
    active.open("POST", endpoint, true);
    active.send(body);
    env.close();
    const count = env.observations().length;
    active.append(")]}'\n\n" + frame("after pagehide"));
    active.finish();
    assert.equal(env.observations().length, count);
    const restored = new Event("pageshow");
    Object.assign(restored, { persisted: true });
    env.window.dispatchEvent(restored);
    const next = new env.NativeXHR();
    next.open("POST", endpoint, true);
    next.send(body);
    next.append(")]}'\n\n" + frame("restored"));
    next.finish();
    assert.equal(
      env
        .observations()
        .filter((m) => m.event === "end" && m.snapshot.text === "restored")
        .length,
      1,
    );
  } finally {
    env.close();
  }
});

test("XHR timing uses verified adapter terminal receipt, with transport failure afterward preserving completion", (t) => {
  let clock = 1000;
  t.mock.method(performance, "now", () => clock);
  const original = PACKAGED_PROVIDER_ADAPTERS.get("gemini")!;
  const providers = createProviderAdapterRegistry([
    {
      ...original,
      createSession() {
        const session = original.createSession();
        let complete = false;
        return {
          gemini(value: any) {
            session.gemini!(value);
            if (value.some((row: any) => row[0] === "e")) complete = true;
          },
          stopped() {
            session.stopped();
          },
          snapshot() {
            const state = session.snapshot();
            return complete ? { ...state, state: "completed" as const } : state;
          },
          completionVerified: () => complete,
        };
      },
    },
  ]);
  const env = environment(providers);
  try {
    const xhr = new env.NativeXHR();
    xhr.open("POST", endpoint, true);
    xhr.send(body);
    clock = 2000;
    xhr.append(")]}'\n\n" + frame("final"));
    const terminal = JSON.stringify([["e"]]);
    clock = 5250;
    xhr.append(`${terminal.length + 2}\n${terminal}\n`);
    clock = 12000;
    xhr.abort();
    const end = env.observations().find((m) => m.event === "end");
    assert.equal(end?.snapshot.state, "completed");
    assert.equal(end?.timing.duration_seconds, "4.25");
    assert.equal(end?.failure, null);
  } finally {
    env.close();
  }
});

test("XHR synchronous host event callbacks do not replace native send results", () => {
  const env = environment();
  try {
    const xhr = new env.NativeXHR();
    xhr.open("POST", endpoint, true);
    xhr.duringSend = () => {
      xhr.append(")]}'\n\n" + frame("already delivered"));
      xhr.finish();
    };
    assert.equal(xhr.send(body), "native send");
    assert.equal(
      env.observations().find((m) => m.event === "end")?.snapshot.text,
      "already delivered",
    );
  } finally {
    env.close();
  }
});

test("a synchronous host callback reusing XHR cannot restart the replaced observer", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const env = environment();
  try {
    const xhr = new env.NativeXHR();
    xhr.open("POST", endpoint, true);
    xhr.duringSend = () => {
      xhr.duringSend = null;
      xhr.open("POST", endpoint, true);
      assert.equal(xhr.send(body), "native send");
    };
    assert.equal(xhr.send(body), "native send");
    xhr.append(")]}'\n\n" + frame("replacement response"));
    xhr.finish();
    assert.equal(xhr.calls.filter((call) => call[0] === "send").length, 2);
    assert.equal(
      env.observations().filter((m) => m.event === "dispatch").length,
      1,
    );
    assert.equal(env.observations().filter((m) => m.event === "end").length, 1);
    assert.equal(
      env.observations().find((m) => m.event === "end")?.snapshot.text,
      "replacement response",
    );
    env.close();
    const count = env.observations().length;
    // Past the observer's own deadline, which backs up the capture's sweep (W10).
    t.mock.timers.tick(CAPTURE_TIMES.totalMs + 2 * CAPTURE_TIMES.sweepMs + 1);
    assert.equal(env.observations().length, count);
  } finally {
    env.close();
  }
});

test("cleanup during dispatch publication cannot allocate a later XHR deadline", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const nativeSet = globalThis.setTimeout,
    nativeClear = globalThis.clearTimeout;
  const pending = new Set<ReturnType<typeof setTimeout>>();
  t.mock.method(
    globalThis,
    "setTimeout",
    (...args: Parameters<typeof setTimeout>) => {
      const handle = Reflect.apply(nativeSet, globalThis, args);
      pending.add(handle);
      return handle;
    },
  );
  t.mock.method(
    globalThis,
    "clearTimeout",
    (handle: ReturnType<typeof setTimeout>) => {
      pending.delete(handle);
      return Reflect.apply(nativeClear, globalThis, [handle]);
    },
  );
  const env = environment();
  const post = env.window.postMessage.bind(env.window);
  env.window.postMessage = (message: any) => {
    post(message);
    if (message.event === "dispatch") env.close();
  };
  try {
    const xhr = new env.NativeXHR();
    xhr.open("POST", endpoint, true);
    assert.equal(xhr.send(body), "native send");
    assert.equal(pending.size, 0);
    assert.equal(
      env.observations().filter((m) => m.event === "dispatch").length,
      1,
    );
    assert.equal(env.observations().filter((m) => m.event === "end").length, 1);
  } finally {
    env.close();
  }
});

test("a synchronous fetch-to-XHR shim contributes only one generation observation", async () => {
  const wire = ")]}'\n\n" + frame("one response");
  let nativePromise: Promise<Response> | undefined;
  const env = environment(undefined, (XHR) => (_input, init) => {
    const xhr = new XHR();
    xhr.open("POST", endpoint, true);
    xhr.send(init!.body);
    xhr.append(wire);
    xhr.finish();
    nativePromise = Promise.resolve(new Response(wire));
    return nativePromise;
  });
  try {
    const result = env.window.fetch(endpoint, { method: "POST", body });
    assert.equal(result, nativePromise);
    await result;
    for (
      let i = 0;
      i < 20 && !env.observations().some((m) => m.event === "end");
      i++
    )
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(
      env.observations().filter((m) => m.event === "dispatch").length,
      1,
    );
    assert.equal(env.observations().filter((m) => m.event === "end").length, 1);
    assert.equal(
      env.observations().find((m) => m.event === "end")?.snapshot.text,
      "one response",
    );
  } finally {
    env.close();
  }
});

test("Gemini XHR terminal paths remove every extension-owned event listener", (t) => {
  const env = environment();
  const add = EventTarget.prototype.addEventListener,
    remove = EventTarget.prototype.removeEventListener;
  let added = 0,
    removed = 0;
  t.mock.method(
    EventTarget.prototype,
    "addEventListener",
    function (this: EventTarget, ...args: Parameters<typeof add>) {
      if (this instanceof env.NativeXHR) added++;
      return Reflect.apply(add, this, args);
    },
  );
  t.mock.method(
    EventTarget.prototype,
    "removeEventListener",
    function (this: EventTarget, ...args: Parameters<typeof remove>) {
      if (this instanceof env.NativeXHR) removed++;
      return Reflect.apply(remove, this, args);
    },
  );
  try {
    for (const ending of ["load", "abort", "malformed", "pagehide"]) {
      const xhr = new env.NativeXHR();
      xhr.open("POST", endpoint, true);
      xhr.send(body);
      xhr.append(")]}'\n\n" + frame("safe"));
      if (ending === "load") xhr.finish();
      else if (ending === "abort") xhr.abort();
      else if (ending === "malformed") xhr.append("broken\n");
      else env.close();
      assert.equal(added, removed);
    }
    assert.equal(added, 20);
  } finally {
    env.close();
  }
});

test("actual natural and UI-stopped Gemini terminal shapes both complete with timing at the request's normal end", () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL(
          "./fixtures/gemini-xhr-lifecycle-2026-09-16.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const encode = (rows: unknown[]) => {
    const payload = JSON.stringify(rows);
    return `${payload.length + 2}\n${payload}\n`;
  };
  for (const example of fixture.cases) {
    const env = environment();
    try {
      const xhr = new env.NativeXHR();
      xhr.open("POST", endpoint, true);
      xhr.send(body);
      xhr.append(")]}'\n\n");
      for (const sample of example.content_frames) {
        const inner = Array(sample.inner_length).fill(null),
          candidate = Array(9).fill(null);
        candidate[0] = "rc_0000000000000042";
        candidate[1] = [sample.text];
        candidate[8] = sample.candidate_8;
        inner[1] = ["c_0000000000000042", "r_0000000000000042"];
        inner[4] = [candidate];
        inner[14] = sample.inner_14;
        xhr.append(encode([["wrb.fr", null, JSON.stringify(inner)]]));
      }
      for (const row of example.tail_row_types)
        xhr.append(
          encode([
            row === "wrb.fr" ? [row, null, JSON.stringify([null])] : [row],
          ]),
        );
      // Both native requests ended normally, including the one visibly stopped by the user.
      xhr.finish();
      const end = env.observations().find((m) => m.event === "end");
      assert.equal(
        end?.snapshot.text,
        example.content_frames.at(-1).text,
        example.name,
      );
      // A stop cannot be told apart from a finished reply (16 Sep): both count the text
      // received and the time spent (M2, G18).
      assert.equal(end?.snapshot.state, "completed", example.name);
      assert.ok(
        !end?.snapshot.limitations.includes("unknown_event_observed"),
        example.name,
      );
      assert.equal(end?.timing?.source, "browser_request", example.name);
      assert.equal(end?.failure, null, example.name);
    } finally {
      env.close();
    }
  }
});

test("W10 a Google-framed reply past 16,384 progress reads and ten minutes still completes", (t) => {
  t.mock.timers.enable({
    apis: ["setTimeout", "setInterval", "Date"],
    now: Date.parse("2026-10-04T10:00:00.000Z"),
  });
  const env = environment();
  try {
    const xhr = new env.NativeXHR();
    xhr.open("POST", endpoint, true);
    xhr.send(body);
    xhr.append(")]}'\n\n" + frame("start"));
    // Browsers send progress at most every 50 ms; these carry no new data.
    for (let i = 0; i < 16_400; i++) xhr.dispatchEvent(new Event("progress"));
    // Fifteen minutes with data every 200 s.
    for (let i = 0; i < 5; i++) {
      t.mock.timers.tick(200_000);
      xhr.append(frame(`more ${i}`));
    }
    xhr.append(frame("final"));
    xhr.finish();
    const ends = env.observations().filter((m) => m.event === "end");
    assert.equal(ends.length, 1);
    assert.equal(ends[0].failure, null);
    assert.equal(ends[0].snapshot.text, "final");
  } finally {
    env.close();
  }
});

test("W10 a Google-framed reply silent for the idle limit ends and stops listening", (t) => {
  t.mock.timers.enable({
    apis: ["setTimeout", "setInterval", "Date"],
    now: Date.parse("2026-10-04T10:00:00.000Z"),
  });
  const env = environment();
  try {
    const xhr = new env.NativeXHR();
    xhr.open("POST", endpoint, true);
    xhr.send(body);
    xhr.append(")]}'\n\n" + frame("partial"));
    t.mock.timers.tick(CAPTURE_TIMES.idleMs - CAPTURE_TIMES.sweepMs);
    assert.equal(
      env.observations().filter((m) => m.event === "end").length,
      0,
    );
    t.mock.timers.tick(2 * CAPTURE_TIMES.sweepMs);
    const ends = env.observations().filter((m) => m.event === "end");
    assert.equal(ends.length, 1);
    assert.equal(ends[0].failure, "capture_interrupted");
    assert.equal(ends[0].snapshot.text, "partial");
    // Its listeners are gone, so later data is not read.
    const count = env.observations().length;
    xhr.append(frame("late"));
    xhr.finish();
    assert.equal(env.observations().length, count);
  } finally {
    env.close();
  }
});
