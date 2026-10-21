import test from "node:test";
import assert from "node:assert/strict";
import { installCapture } from "../lib/capture-runtime";
import {
  GEMINI_CHANNEL_ORIGIN,
  GEMINI_CHANNEL_PATH,
  GEMINI_CHANNEL_REOPEN_MS,
} from "../lib/gemini-channel";
import { validateCapture } from "../lib/bridge";
import {
  base64,
  channelMessage,
  pb,
  type Proto,
} from "../../../packages/adapters/test/gemini-channel-fixture";

// Gemini's session channel as seen live on 19 Oct 2026 (structure only): a new chat's send
// is a WebChannel session on another Google host, not StreamGenerate. Ids, text and tokens
// are synthetic.
const CHAT = "c_00000000000000a1";
const TURN = "r_00000000000000b1";
const REPLY = "rc_00000000000000c1";
const TOKEN = "AwAAAAAAAAAQANsyntheticTokn";
const CHANNEL = GEMINI_CHANNEL_ORIGIN + GEMINI_CHANNEL_PATH;

function environment() {
  class NativeXHR extends EventTarget {
    calls: unknown[][] = [];
    ready = 0;
    code = 0;
    value = "";
    url = "";
    onreadystatechange: (() => void) | null = null;
    get readyState() {
      return this.ready;
    }
    get status() {
      return this.code;
    }
    get responseType() {
      return "";
    }
    get responseText() {
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
      this.url = String(args[1]);
      this.ready = 1;
      this.value = "";
      return "native open";
    }
    send(...args: unknown[]) {
      this.calls.push(["send", ...args]);
      return "native send";
    }
    private event(name: string) {
      if (name === "readystatechange") this.onreadystatechange?.();
      this.dispatchEvent(new Event(name));
    }
    /** Data arrives: Chrome fires readystatechange for every chunk, progress at most every 50 ms. */
    receive(text: string, progress = true) {
      this.code = 200;
      this.value += text;
      this.ready = 3;
      this.event("readystatechange");
      if (progress) this.event("progress");
    }
    /** The page's abort: the response is gone before the events fire. */
    abort() {
      this.ready = 4;
      this.code = 0;
      this.value = "";
      this.event("readystatechange");
      this.event("abort");
      this.event("loadend");
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
  const original = {
    open: NativeXHR.prototype.open,
    send: NativeXHR.prototype.send,
  };
  Object.assign(globalThis, {
    window,
    location: {
      origin: "https://gemini.google.com",
      hostname: "gemini.google.com",
      href: "https://gemini.google.com/app",
      pathname: "/app",
    },
  });
  installCapture();
  let rid = 100;
  /** One session as the page opens it: the first post, then the back channel. */
  const session = (sid: string) => {
    const open = new NativeXHR();
    open.open("POST", `${CHANNEL}?VER=8&RID=${rid++}&CVER=22&X-HTTP-Session-Id=gsessionid&zx=a&t=1`);
    open.send("count=0");
    open.receive(`51\n[[0,["c","${sid}","",8,15,30000]]]\n`);
    const back = new NativeXHR();
    back.open("GET", `${CHANNEL}?gsessionid=g&VER=8&RID=rpc&SID=${sid}&AID=0&CI=0&TYPE=xmlhttp&zx=b&t=1`);
    back.send();
    let aid = 1;
    const deliver = (payload: string, progress = true) => {
      const json = JSON.stringify([[aid++, [payload]]]);
      back.receive(`${json.length}\n${json}`, progress);
    };
    deliver("noop");
    let offset = 0;
    const post = (message: Uint8Array) => {
      const xhr = new NativeXHR();
      xhr.open("POST", `${CHANNEL}?VER=8&gsessionid=g&SID=${sid}&RID=${rid++}&AID=0&zx=c&t=1`);
      const body = `count=1&ofs=${offset++}&req0___data__=${encodeURIComponent(base64(message))}`;
      assert.equal(xhr.send(body), "native send");
      // The page's request reaches the network unchanged.
      assert.deepEqual(xhr.calls.at(-1), ["send", body]);
      xhr.receive(`8\n[1,${aid},7]\n`);
    };
    return { back, deliver, post };
  };
  return {
    window,
    NativeXHR,
    original,
    session,
    observations: () =>
      window.messages.filter((m) => m.channel === "ai-footprint-observation-v1"),
    close: () => window.dispatchEvent(new Event("pagehide")),
  };
}

/** The send's setup: the chat and the previous turn's token at 1.8.5.1.72 (follow-ups). */
const setup = (chat?: Proto) => {
  const request: Proto = [
    [1, [[1, ""], [2, 0]]],
    [4, "synthetic"],
  ];
  if (chat) request.push([72, chat]);
  return pb([
    [
      1,
      [
        [1, [[1, 1], [2, "0000000000000000"]]],
        [2, 0],
        [8, [[5, [[1, request], [4, 1]]]]],
      ],
    ],
  ]);
};
const prompt = (text: string) => pb([[2, [[1, 1], [9, [[1, text]]]]]]);
const close = pb([[4, [[1, 1]]]]);
const ids = (turn = TURN): Proto => [[2, [[1, CHAT], [2, turn]]]];
const answer = (text: string, reply = REPLY, turn = TURN): Proto => [
  ...ids(turn),
  [5, [[1, reply], [2, [[1, text]]], [9, [[1, 1]]], [10, "en"], [13, [[8, ""]]], [38, ""]]],
  [25, [[5, [[1, [[1, "A category"], [2, { f32: 0.25 }]]]]]]],
  [43, "3.8 Thinking"],
];
const message = (seq: number, frame: Proto, final = false, turn = TURN) =>
  base64(channelMessage(seq, frame, final, turn));

test("GW1 a new Gemini chat sent over the session channel is captured as a StreamGenerate send, with the page's requests unchanged", () => {
  const env = environment();
  try {
    const s = env.session("SID-1");
    // The page's own listener sees every event and the full response.
    let pageEvents = 0;
    s.back.addEventListener("readystatechange", () => pageEvents++);
    s.post(setup());
    assert.equal(env.observations().length, 0);
    s.post(prompt("Test prompt"));
    const [dispatch] = env.observations();
    assert.equal(dispatch.event, "dispatch");
    assert.equal(dispatch.dispatch.input, "Test prompt");
    assert.equal(dispatch.dispatch.conversationId, null);
    assert.equal(dispatch.dispatch.parentId, null);
    s.deliver(message(1, [[2, [[1, CHAT], [2, ""]]]]));
    s.deliver(message(2, [...ids(), [18, TURN], [21, "synthetic"]]));
    s.deliver(message(3, answer("Soft")));
    // The last frames arrive within one progress interval before the page's abort, so
    // only their readystatechange events show them; an aborted XHR keeps no text.
    s.deliver(message(4, answer("Soft rain falls.")), false);
    s.deliver(message(5, answer("Soft rain falls."), true), false);
    s.deliver(message(6, [...ids(), [11, [[1, "A title"]]]]), false);
    s.deliver(message(7, [...ids(), [26, TOKEN]]), false);
    s.post(close);
    s.back.abort();
    const ends = env.observations().filter((m) => m.event === "end");
    assert.equal(ends.length, 1);
    const [end] = ends;
    assert.equal(end.failure, null);
    assert.equal(end.snapshot.state, "completed");
    assert.equal(end.snapshot.text, "Soft rain falls.");
    assert.equal(end.snapshot.model, "3.8 Thinking");
    assert.equal(end.snapshot.conversationId, CHAT);
    assert.equal(end.snapshot.providerRequestId, TURN);
    assert.equal(end.snapshot.outputId, REPLY);
    assert.ok(!end.snapshot.limitations.includes("unknown_event_observed"));
    assert.equal(end.timing?.source, "browser_request");
    for (const observation of env.observations())
      assert.equal(validateCapture(observation, "gemini.google.com"), true);
    assert.equal(pageEvents, 8);
    // Health problems would show as a tracking problem.
    assert.deepEqual(
      env.window.messages.filter((m) => m.event === "health"),
      [],
    );
  } finally {
    env.close();
  }
  // Leaving the page restores the page's own XHR.
  assert.equal(env.NativeXHR.prototype.open, env.original.open);
  assert.equal(env.NativeXHR.prototype.send, env.original.send);
});

test("GW2 a follow-up names the reply it continues by the previous turn's token; an unknown token keeps its context unknown", () => {
  const env = environment();
  try {
    const first = env.session("SID-1");
    first.post(setup());
    first.post(prompt("First"));
    first.deliver(message(1, answer("One."), true));
    // The page's close can overtake the turn's token, which arrives on the same millisecond.
    first.post(close);
    first.deliver(message(2, [...ids(), [26, TOKEN]]));
    first.back.abort();
    const next = env.session("SID-2");
    next.post(setup([[1, CHAT], [8, TOKEN]]));
    next.post(prompt("Second"));
    const dispatches = env.observations().filter((m) => m.event === "dispatch");
    assert.equal(dispatches.length, 2);
    assert.equal(dispatches[1].dispatch.input, "Second");
    assert.equal(dispatches[1].dispatch.conversationId, CHAT);
    assert.equal(dispatches[1].dispatch.parentId, REPLY);
    // A chat whose previous reply this page did not see: the token stands in, so the
    // context is unknown instead of starting a new chat.
    const other = env.session("SID-3");
    other.post(setup([[1, CHAT], [8, "AwAAAAAAAAAQANotSeenHereTkn"]]));
    other.post(prompt("Third"));
    const third = env.observations().filter((m) => m.event === "dispatch")[2];
    assert.equal(third.dispatch.conversationId, CHAT);
    assert.equal(third.dispatch.parentId, "AwAAAAAAAAAQANotSeenHereTkn");
  } finally {
    env.close();
  }
});

test("GW3 a reply the page closes before its last frame ends as stopped with its text; a resent post starts nothing", async () => {
  const env = environment();
  try {
    const s = env.session("SID-1");
    s.post(setup());
    s.post(prompt("Stop me"));
    s.deliver(message(1, answer("Half")));
    s.post(close);
    const [end] = env.observations().filter((m) => m.event === "end");
    assert.equal(end.snapshot.state, "cancelled");
    assert.equal(end.snapshot.text, "Half");
    assert.equal(end.failure, null);
    // The back channel closing alone waits for the page to open it again.
    const t = env.session("SID-2");
    t.post(setup());
    t.post(prompt("Long reply"));
    t.deliver(message(1, answer("Part", "rc_00000000000000c2", "r_00000000000000b2"), false, "r_00000000000000b2"));
    t.back.abort();
    const reopened = new env.NativeXHR();
    reopened.open("GET", `${CHANNEL}?gsessionid=g&VER=8&RID=rpc&SID=SID-2&AID=1&CI=0&TYPE=xmlhttp&zx=d&t=1`);
    reopened.send();
    await new Promise((resolve) => setTimeout(resolve, GEMINI_CHANNEL_REOPEN_MS + 200));
    assert.equal(env.observations().filter((m) => m.event === "end").length, 1);
    const json = JSON.stringify([[2, [message(2, answer("Part two.", "rc_00000000000000c2", "r_00000000000000b2"), true, "r_00000000000000b2")]]]);
    reopened.receive(`${json.length}\n${json}`);
    const ends = env.observations().filter((m) => m.event === "end");
    assert.equal(ends.length, 2);
    assert.equal(ends[1].snapshot.state, "completed");
    assert.equal(ends[1].snapshot.text, "Part two.");
    // A back channel closed without being opened again ends its reply as stopped.
    const u = env.session("SID-3");
    u.post(setup());
    u.post(prompt("Lost"));
    u.deliver(message(1, answer("Lo", "rc_00000000000000c3", "r_00000000000000b3"), false, "r_00000000000000b3"));
    u.back.abort();
    await new Promise((resolve) => setTimeout(resolve, GEMINI_CHANNEL_REOPEN_MS + 200));
    const last = env.observations().filter((m) => m.event === "end").at(-1);
    assert.equal(last.snapshot.state, "cancelled");
    assert.equal(last.snapshot.text, "Lo");
    // The same message posted again (the page retries a failed post) is not a new send.
    const v = env.session("SID-4");
    v.post(setup());
    const before = env.observations().filter((m) => m.event === "dispatch").length;
    const body = `count=1&ofs=1&req0___data__=${encodeURIComponent(base64(prompt("Once")))}`;
    for (let i = 0; i < 2; i++) {
      const xhr = new env.NativeXHR();
      xhr.open("POST", `${CHANNEL}?VER=8&gsessionid=g&SID=SID-4&RID=${900 + i}&AID=0&zx=e&t=1`);
      xhr.send(body);
    }
    assert.equal(env.observations().filter((m) => m.event === "dispatch").length, before + 1);
  } finally {
    env.close();
  }
});
