import {
  base64Bytes,
  GEMINI_STREAM_GUARD,
  GEMINI_STREAM_UNREAD,
  geminiChannelReplies,
  geminiChannelRequestBody,
  geminiChannelSend,
  geminiStreamFrame,
} from "@footprint/adapters";
import {
  CaptureError,
  GEMINI_STREAM_PATH,
  LIMITS,
} from "@footprint/capture-core";
import {
  XHRAbortError,
  type XHRTextObserver,
  type XHRTextSink,
} from "./xhr-text-stream";

/**
 * Gemini's session channel (seen live on 19 Oct 2026): a new chat's send no longer uses
 * StreamGenerate but a WebChannel session on another Google host. The page posts its setup,
 * prompt and close to the session and reads the reply from a long-poll GET of the same
 * session (`packages/adapters/src/gemini-channel.ts` has the layout). This module watches
 * the page's own XHRs to that address, unchanged and undelayed, and hands each reply to the
 * live capture in StreamGenerate's layout, so a reply is captured, read and recorded as
 * one sent by StreamGenerate.
 */
export const GEMINI_CHANNEL_ORIGIN = "https://geminiweb-pa.clients6.google.com";
export const GEMINI_CHANNEL_PATH = "/v1/processSession";

/**
 * How long a reply waits for the page to open its session's back channel again before it
 * ends as stopped. WebChannel may reopen the GET during a long reply.
 */
export const GEMINI_CHANNEL_REOPEN_MS = 5000;
/** Sessions kept at once; the page opens one per send. */
const SESSIONS = 16;
/** Turn tokens remembered, each naming the reply a follow-up continues. */
const TOKENS = 64;
/** Messages one post may carry; the page sent one per post. */
const MESSAGES = 64;

interface Turn {
  sink: XHRTextSink;
  replyId: string | null;
  /** The provider marked the reply's last frame, or the capture ended. */
  done: boolean;
}
interface Session {
  conversationId: string | null;
  /** The reply the send continues, or the previous turn's token when that is unknown. */
  parent: string | null;
  /** The next message index not yet read; the page resends a failed post. */
  next: number;
  turn: Turn | null;
  backs: number;
  reopen: ReturnType<typeof setTimeout> | null;
}

type Getters = Record<"ready" | "status" | "type" | "text", () => unknown>;

export function createGeminiChannel(live: XHRTextObserver, origin: string) {
  // Captured now, so a page override never runs.
  const decode = globalThis.atob;
  const encoder = new TextEncoder();
  const sessions = new Map<string, Session>();
  const tokens = new Map<string, string>();
  let enabled = false;
  let restoreXHR: (() => void) | null = null;

  const session = (sid: string): Session => {
    let state = sessions.get(sid);
    if (state) return state;
    while (sessions.size >= SESSIONS) {
      const [oldest, old] = sessions.entries().next().value!;
      if (old.reopen) clearTimeout(old.reopen);
      if (old.turn && !old.turn.done) stop(old.turn);
      sessions.delete(oldest);
    }
    state = {
      conversationId: null,
      parent: null,
      next: 0,
      turn: null,
      backs: 0,
      reopen: null,
    };
    sessions.set(sid, state);
    return state;
  };
  /** The reply ended without its last frame: the user stopped it or the page let it go. */
  const stop = (turn: Turn) => {
    if (turn.done) return;
    turn.done = true;
    try {
      turn.sink.fail(new XHRAbortError(), "transport");
    } catch {}
  };
  const fail = (turn: Turn, error: unknown) => {
    if (turn.done) return;
    turn.done = true;
    try {
      turn.sink.fail(error, "capture");
    } catch {}
  };
  const push = (turn: Turn, text: string, at: number) => {
    if (turn.done) return;
    try {
      turn.sink.push(encoder.encode(text), at);
    } catch (error) {
      fail(turn, error);
    }
  };
  const remember = (token: string, replyId: string) => {
    tokens.delete(token);
    tokens.set(token, replyId);
    while (tokens.size > TOKENS) tokens.delete(tokens.keys().next().value!);
  };

  function start(state: Session, prompt: string, at: number) {
    if (state.turn) stop(state.turn);
    state.turn = null;
    const turn: Turn = { sink: null!, replyId: null, done: false };
    let sink: XHRTextSink | null = null;
    try {
      sink = live.start(
        new URL(GEMINI_STREAM_PATH, origin),
        geminiChannelRequestBody(prompt, state.conversationId, state.parent),
        at,
        // The capture ended on its own (time limits, page leaving).
        () => {
          turn.done = true;
        },
      );
    } catch {}
    if (!sink) return;
    turn.sink = sink;
    state.turn = turn;
    push(turn, GEMINI_STREAM_GUARD, at);
  }

  /** One post the page sends to a session; the setup and close name no reply. */
  function forward(url: URL, body: unknown, at: number) {
    const sid = url.searchParams.get("SID");
    // The session's first post (`count=0`) opens it and carries no message.
    if (!sid || typeof body !== "string" || body.length > LIMITS.frame) return;
    const form = new URLSearchParams(body);
    const count = Number(form.get("count")),
      offset = Number(form.get("ofs"));
    if (
      !Number.isSafeInteger(count) ||
      count < 1 ||
      count > MESSAGES ||
      !Number.isSafeInteger(offset) ||
      offset < 0
    )
      return;
    const state = session(sid);
    for (let index = 0; index < count; index++) {
      if (offset + index < state.next) continue;
      state.next = offset + index + 1;
      const data = form.get(`req${index}___data__`);
      const bytes = data === null ? null : base64Bytes(data, decode);
      const send = bytes ? geminiChannelSend(bytes) : null;
      if (!send) {
        // A message of a running reply that cannot be read leaves the reply partial.
        if (state.turn && !state.turn.done)
          push(state.turn, GEMINI_STREAM_UNREAD, at);
        continue;
      }
      if (send.kind === "setup") {
        state.conversationId = send.conversationId;
        state.parent = send.turnToken
          ? (tokens.get(send.turnToken) ?? send.turnToken)
          : null;
      } else if (send.kind === "prompt") start(state, send.text, at);
      else if (send.kind === "close") {
        // The session stays known: the turn's token can arrive just after the close.
        if (state.turn) stop(state.turn);
        if (state.reopen) clearTimeout(state.reopen);
        state.reopen = null;
      }
    }
  }

  /** One back-channel frame: `[[id, [payload]], ...]`. */
  function backChannel(sid: string, at: number, json: string) {
    const state = sessions.get(sid);
    let rows: unknown;
    try {
      rows = JSON.parse(json);
    } catch {
      if (state?.turn) fail(state.turn, new CaptureError("malformed_frame"));
      return;
    }
    if (!Array.isArray(rows)) {
      if (state?.turn) fail(state.turn, new CaptureError("malformed_frame"));
      return;
    }
    for (const row of rows) {
      // `[id, [payload]]`; a payload that is not a string is a channel control message.
      const items = Array.isArray(row) ? row[1] : null;
      if (!Array.isArray(items)) {
        if (state?.turn && !state.turn.done)
          push(state.turn, GEMINI_STREAM_UNREAD, at);
        continue;
      }
      for (const item of items) {
        if (typeof item !== "string" || item === "noop") continue;
        const bytes = base64Bytes(item, decode);
        const replies = bytes ? geminiChannelReplies(bytes) : null;
        if (!replies) {
          if (state?.turn && !state.turn.done)
            push(state.turn, GEMINI_STREAM_UNREAD, at);
          continue;
        }
        const turn = state?.turn;
        if (!turn) continue;
        for (const reply of replies) {
          if (reply.inner && !turn.done) {
            const candidate = (reply.inner[4] as unknown[] | undefined)?.[0];
            const id = Array.isArray(candidate) ? candidate[0] : null;
            if (typeof id === "string") turn.replyId = id;
            push(turn, geminiStreamFrame(reply.inner), at);
          }
          // The token comes after the last frame (19 Oct 2026); the next send names it.
          if (reply.turnToken && turn.replyId)
            remember(reply.turnToken, turn.replyId);
          if (reply.final && !turn.done) {
            turn.done = true;
            try {
              turn.sink.finish(at);
            } catch {}
          }
        }
      }
    }
  }

  /** Reads one back-channel GET as it arrives, without touching its events or data. */
  function watchBack(
    xhr: XMLHttpRequest,
    sid: string,
    getters: Getters,
  ): { detach: () => void } {
    const add = EventTarget.prototype.addEventListener,
      remove = EventTarget.prototype.removeEventListener;
    const state = session(sid);
    state.backs++;
    if (state.reopen) clearTimeout(state.reopen);
    state.reopen = null;
    let offset = 0,
      buffer = "",
      closed = false;
    const names = [
      "readystatechange",
      "progress",
      "load",
      "error",
      "abort",
      "timeout",
    ];
    const close = () => {
      if (closed) return;
      closed = true;
      for (const name of names)
        try {
          Reflect.apply(remove, xhr, [name, receive]);
        } catch {}
      state.backs--;
      const turn = state.turn;
      if (!turn || turn.done || state.backs > 0 || sessions.get(sid) !== state)
        return;
      state.reopen = setTimeout(() => {
        state.reopen = null;
        if (state.backs === 0 && state.turn === turn) stop(turn);
      }, GEMINI_CHANNEL_REOPEN_MS);
    };
    const read = (at: number) => {
      const ready = getters.ready(),
        status = getters.status();
      if (ready !== 3 && ready !== 4) return;
      if (typeof status !== "number" || status < 200 || status >= 300) return;
      const type = getters.type();
      if (type !== "" && type !== "text") throw new CaptureError("unsupported_schema");
      const value = getters.text();
      if (typeof value !== "string" || value.length < offset)
        throw new CaptureError("malformed_frame");
      if (value.length > LIMITS.stream) throw new CaptureError("buffer_overflow");
      buffer += value.slice(offset);
      offset = value.length;
      // Frames are `<length>\n<json>`, the length counting the JSON only (19 Oct 2026).
      for (;;) {
        buffer = buffer.replace(/^[\r\n]+/, "");
        const newline = buffer.indexOf("\n");
        if (newline < 0) break;
        const prefix = buffer.slice(0, newline);
        const size = Number(prefix);
        if (!/^\d{1,9}$/.test(prefix)) throw new CaptureError("malformed_frame");
        if (size > LIMITS.frame) throw new CaptureError("buffer_overflow");
        if (buffer.length < newline + 1 + size) break;
        const json = buffer.slice(newline + 1, newline + 1 + size);
        buffer = buffer.slice(newline + 1 + size);
        backChannel(sid, at, json);
      }
      if (buffer.length > LIMITS.frame) throw new CaptureError("buffer_overflow");
    };
    function receive(event: Event) {
      if (closed) return;
      const at = performance.now();
      try {
        // After an abort the response is gone; everything before it was read as it came.
        if (event.type !== "abort" && event.type !== "error" && event.type !== "timeout")
          read(at);
      } catch (error) {
        if (state.turn) fail(state.turn, error);
        close();
        return;
      }
      if (event.type !== "readystatechange" && event.type !== "progress") close();
    }
    try {
      for (const name of names) Reflect.apply(add, xhr, [name, receive]);
    } catch {
      close();
    }
    return { detach: close };
  }

  return {
    /** Wraps the page's XHR open and send. Install it before the history reader's wrapper. */
    install(XHR: typeof XMLHttpRequest) {
      if (restoreXHR || !XHR?.prototype) return;
      const prototype = XHR.prototype,
        open = prototype.open,
        send = prototype.send;
      const getter = (key: string) =>
        Object.getOwnPropertyDescriptor(prototype, key)?.get;
      const native = {
        ready: getter("readyState"),
        status: getter("status"),
        type: getter("responseType"),
        text: getter("responseText"),
      };
      if (Object.values(native).some((get) => !get)) return;
      const opened = new WeakMap<XMLHttpRequest, { url: URL; method: string }>();
      const wrappedOpen = function (this: XMLHttpRequest, ...args: any[]) {
        const result = Reflect.apply(open, this, args);
        opened.delete(this);
        try {
          if (
            enabled &&
            typeof args[0] === "string" &&
            typeof args[1] === "string" &&
            args[1].length <= 8192
          ) {
            const url = new URL(args[1], location.href);
            if (
              url.origin === GEMINI_CHANNEL_ORIGIN &&
              url.pathname === GEMINI_CHANNEL_PATH &&
              !url.username &&
              !url.password
            )
              opened.set(this, { url, method: args[0].toUpperCase() });
          }
        } catch {}
        return result;
      } as typeof prototype.open;
      const wrappedSend = function (this: XMLHttpRequest, ...args: any[]) {
        const request = opened.get(this);
        opened.delete(this);
        if (!request || !enabled) return Reflect.apply(send, this, args);
        const at = performance.now();
        let back: { detach: () => void } | null = null;
        try {
          const sid = request.url.searchParams.get("SID");
          if (
            request.method === "GET" &&
            sid &&
            request.url.searchParams.get("TYPE") === "xmlhttp"
          ) {
            const xhr = this;
            const getters = Object.fromEntries(
              Object.entries(native).map(([key, get]) => [
                key,
                () => Reflect.apply(get!, xhr, []),
              ]),
            ) as Getters;
            back = watchBack(this, sid, getters);
          }
        } catch {}
        let result;
        try {
          result = Reflect.apply(send, this, args);
        } catch (error) {
          back?.detach();
          throw error;
        }
        try {
          if (request.method === "POST") forward(request.url, args[0], at);
        } catch {}
        return result;
      } as typeof prototype.send;
      prototype.open = wrappedOpen;
      prototype.send = wrappedSend;
      enabled = true;
      restoreXHR = () => {
        if (prototype.open === wrappedOpen) prototype.open = open;
        if (prototype.send === wrappedSend) prototype.send = send;
      };
    },
    /** Stops watching. Captures still running end through the capture's own lifecycle. */
    restore() {
      enabled = false;
      restoreXHR?.();
      restoreXHR = null;
      for (const state of sessions.values())
        if (state.reopen) clearTimeout(state.reopen);
      sessions.clear();
    },
  };
}
