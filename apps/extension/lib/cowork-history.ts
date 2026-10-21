import { JSONParser } from "@streamparser/json";
import { CoworkEvents, coworkRequest } from "@footprint/adapters";
import { parseConversationRoute } from "@footprint/capture-core";
import {
  HISTORY_CAPTURE_CHANNEL,
  type HistoryCaptureMessage,
} from "./history-capture";
import type { createRouteWatch } from "./history-route";

// The page asks for 100 events per list (seen 1 Oct 2026). Newer events come first, so a
// longer list is read up to this bound; older results stay inside a later result's counts.
export const COWORK_LIST_EVENTS = 1000;
// One stream event, in characters, which bounds the memory it takes. A larger one, such as
// a long tool result, is skipped without parsing; results are small, and the next
// result's counters hold any counts it carried.
export const COWORK_FRAME_LIMIT = 8 * 1048576;
// A read can start just before the address bar shows the session.
export const COWORK_ROUTE_WAIT_MS = 5000;
// Results wait for a list being read, so the list's results form one page. A list read
// that stalls holds them no longer than this.
export const COWORK_LIST_HOLD_MS = 15000;
// A list without events is only ever this small; a larger one without events is a format
// the reader does not know.
const EMPTY_LIST_BYTES = 65536;
// Pages of one session are spaced, so the content script never runs more than two history
// reads at once. Results wait in the parser meanwhile; none is lost.
export const COWORK_EMIT_SPACING_MS = 2500;

export interface CoworkNatives {
  cloneResponse: (this: Response) => Response;
  getReader: (
    this: ReadableStream<Uint8Array>,
  ) => ReadableStreamDefaultReader<Uint8Array>;
  read: (
    this: ReadableStreamDefaultReader<Uint8Array>,
  ) => Promise<ReadableStreamReadResult<Uint8Array>>;
  cancel: (this: ReadableStreamDefaultReader<Uint8Array>) => Promise<void>;
  cancelStream: (this: ReadableStream<Uint8Array>) => Promise<void>;
}

/**
 * Splits a server-sent event stream into the data of each event. An event over the frame
 * limit is skipped whole, and reading continues with the next one.
 */
export class CoworkFrames {
  private data: string[] = [];
  private size = 0;
  private line = "";
  private skipping = false;
  private skippingLine = false;
  skipped = 0;
  constructor(
    private frame: (data: string) => void,
    private onSkip: () => void = () => {},
  ) {}

  /** Whether an event was started but not finished, as when the stream breaks off. */
  get open(): boolean {
    return (
      this.data.length > 0 ||
      this.line.length > 0 ||
      this.skippingLine ||
      this.skipping
    );
  }

  push(text: string): void {
    let start = 0;
    for (;;) {
      const end = text.indexOf("\n", start);
      if (end < 0) {
        this.extend(text.slice(start));
        return;
      }
      this.extend(text.slice(start, end));
      const line = this.line.endsWith("\r")
        ? this.line.slice(0, -1)
        : this.line;
      const skipped = this.skippingLine;
      this.line = "";
      this.skippingLine = false;
      start = end + 1;
      if (skipped) this.skip();
      else this.field(line);
    }
  }

  private extend(text: string) {
    if (this.skippingLine) return;
    if (this.line.length + text.length > COWORK_FRAME_LIMIT) {
      this.line = "";
      this.skippingLine = true;
      return;
    }
    this.line += text;
  }

  private skip() {
    if (!this.skipping) {
      this.skipped++;
      this.onSkip();
    }
    this.skipping = true;
    this.data = [];
    this.size = 0;
  }

  private field(line: string) {
    if (line === "") {
      if (!this.skipping && this.data.length) this.frame(this.data.join("\n"));
      this.data = [];
      this.size = 0;
      this.skipping = false;
      return;
    }
    if (this.skipping || line.startsWith(":")) return;
    const colon = line.indexOf(":");
    if ((colon < 0 ? line : line.slice(0, colon)) !== "data") return;
    const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
    this.size += value.length + 1;
    if (this.size > COWORK_FRAME_LIMIT) {
      this.skip();
      return;
    }
    this.data.push(value);
  }
}

type Session = {
  id: string;
  events: CoworkEvents;
  /** Lists being read, with their start; pages wait a while for them. */
  lists: Set<{ at: number }>;
  readers: Set<() => void>;
  timer: ReturnType<typeof setTimeout> | null;
  lastEmit: number;
  /**
   * A list was read or a stream started. A page is sent even without results, so the bar
   * knows the session loaded and does not report earlier messages as not counted.
   */
  announce: boolean;
  /** Stops waiting for the address bar to show the session. */
  unwatch: (() => void) | null;
  /** Since when pages wait for the address bar with no read of the session left. */
  idleSince: number | null;
};

/** Whether a list body without events is the known empty list, `{"data": []}`. */
function emptyList(chunks: Uint8Array[], size: number): boolean {
  if (size > EMPTY_LIST_BYTES) return false;
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    return (
      !!value &&
      typeof value === "object" &&
      Array.isArray(value.data) &&
      value.data.length === 0
    );
  } catch {
    return false;
  }
}

/**
 * Reads the Cowork session shown on the page from the page's own requests (W5): the events
 * list it loads when the session opens and the live event stream it follows. Each new
 * result becomes a history page with the session's counters; the background turns them
 * into the turn's own counts. Nothing is fetched, scrolled or sent here.
 */
export function createCoworkHistory(
  send: (message: HistoryCaptureMessage) => void,
  natives: CoworkNatives,
  routes: ReturnType<typeof createRouteWatch>,
  sent: () => void = () => {},
  timings: {
    routeWaitMs?: number;
    spacingMs?: number;
    listHoldMs?: number;
  } = {},
) {
  const timing = {
    routeWaitMs: timings.routeWaitMs ?? COWORK_ROUTE_WAIT_MS,
    spacingMs: timings.spacingMs ?? COWORK_EMIT_SPACING_MS,
    listHoldMs: timings.listHoldMs ?? COWORK_LIST_HOLD_MS,
  };
  let session: Session | null = null;
  // Stop functions of stream readers, so a reconnected stream replaces the old one.
  const streams = new Set<() => void>();
  // Reads still waiting for the address bar to show their session; navigation stops them.
  const waits = new Set<{ id: string; stop: () => void }>();
  const shown = (id: string) =>
    parseConversationRoute("claude", location.pathname)?.conversationId === id;

  const stopSession = () => {
    if (!session) return;
    for (const stop of [...session.readers]) stop();
    if (session.timer) clearTimeout(session.timer);
    session.unwatch?.();
    session = null;
  };
  const sessionFor = (id: string) => {
    if (session?.id !== id) {
      stopSession();
      session = {
        id,
        events: new CoworkEvents(),
        lists: new Set(),
        readers: new Set(),
        timer: null,
        lastEmit: -Infinity,
        announce: false,
        unwatch: null,
        idleSince: null,
      };
    }
    return session;
  };

  const waiting = (s: Session) => s.events.pending || s.announce;
  const emit = (s: Session) => {
    s.timer = null;
    if (session !== s || !waiting(s)) return;
    const now = Date.now();
    const held = [...s.lists]
      .map((list) => list.at + timing.listHoldMs - now)
      .filter((left) => left > 0);
    if (held.length) {
      s.timer = setTimeout(() => emit(s), Math.min(...held));
      return;
    }
    if (!shown(s.id)) {
      // Pages wait until the address bar shows the session, as after a new task's send.
      // With no read of the session left, the wait ends after a while: a session the page
      // never showed cannot be saved, and its watcher must not run on.
      s.unwatch ??= routes.watch(() => {
        if (session !== s || shown(s.id)) {
          s.unwatch?.();
          s.unwatch = null;
          s.idleSince = null;
          if (session === s) schedule(s);
        } else if (s.readers.size === 0) {
          s.idleSince ??= Date.now();
          if (Date.now() - s.idleSince >= timing.routeWaitMs) stopSession();
        } else s.idleSince = null;
      });
      return;
    }
    const wait = s.lastEmit + timing.spacingMs - Date.now();
    if (wait > 0) {
      s.timer = setTimeout(() => emit(s), wait);
      return;
    }
    s.lastEmit = Date.now();
    s.announce = false;
    const observedAt = new Date().toISOString();
    const base = {
      channel: HISTORY_CAPTURE_CHANNEL as typeof HISTORY_CAPTURE_CHANNEL,
      id: crypto.randomUUID(),
      site: "claude" as const,
      conversationId: s.id,
      observedAt,
    };
    const page = s.events.page(s.id, observedAt);
    try {
      send({ ...base, event: "start", page: null });
      send({ ...base, event: "page", page });
    } catch {}
  };
  const schedule = (s: Session) => {
    if (!s.timer && waiting(s)) s.timer = setTimeout(() => emit(s), 0);
  };

  /** Waits until the page shows the session, at most a few seconds or until stopped. */
  const routed = (id: string, stopped: () => boolean) =>
    new Promise<boolean>((resolve) => {
      if (shown(id)) return resolve(true);
      const started = Date.now();
      const unwatch = routes.watch(() => {
        if (stopped()) {
          unwatch();
          resolve(false);
        } else if (shown(id)) {
          unwatch();
          resolve(true);
        } else if (Date.now() - started >= timing.routeWaitMs) {
          unwatch();
          resolve(false);
        }
      });
    });

  async function read(
    id: string,
    kind: "events" | "stream",
    promise: Promise<Response>,
  ) {
    let clone: Response | null = null;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let stopped = false;
    // An unread copy of a response would hold every byte the page receives, so each copy
    // this reader does not read to its end is cancelled.
    const discard = (response: Response | null) => {
      if (response?.body)
        void Reflect.apply(natives.cancelStream, response.body, []).catch(
          () => {},
        );
    };
    const stop = () => {
      stopped = true;
      if (reader)
        void Reflect.apply(natives.cancel, reader, []).catch(() => {});
      else discard(clone);
    };
    // Clone before the page's own reader can take the body.
    const early = promise.then((response) => {
      clone = Reflect.apply(natives.cloneResponse, response, []) as Response;
      if (stopped) discard(clone);
      return clone;
    });
    // A failed page request must not surface in the page while the route is awaited.
    void early.catch(() => {});
    const wait = { id, stop };
    waits.add(wait);
    const routedNow = await routed(id, () => stopped);
    waits.delete(wait);
    // A new task on /new streams its pre-created session before the address bar shows it
    // (seen 3 Oct), so a stream is read unless the page shows another conversation.
    if (
      stopped ||
      (!routedNow &&
        (kind === "events" ||
          parseConversationRoute("claude", location.pathname) !== null))
    ) {
      stopped = true;
      void early.then(discard, () => {});
      return;
    }
    const s = sessionFor(id);
    s.readers.add(stop);
    const list = kind === "events" ? { at: Date.now() } : null;
    if (list) s.lists.add(list);
    else
      // A new stream replaces the old one; the page reconnects after a drop.
      for (const other of [...s.readers])
        if (other !== stop && streams.has(other)) other();
    if (kind === "stream") streams.add(stop);
    let failed = false;
    try {
      const response = await early;
      if (stopped || session !== s) {
        discard(response);
        return;
      }
      if (!response.ok || !response.body) {
        discard(response);
        throw new Error("history_unsupported");
      }
      reader = Reflect.apply(
        natives.getReader,
        response.body,
        [],
      ) as ReadableStreamDefaultReader<Uint8Array>;
      if (kind === "events") {
        await readList(s, reader, () => stopped);
        if (!stopped && session === s) s.announce = true;
      } else {
        s.announce = true;
        schedule(s);
        await readStream(s, reader, () => stopped);
      }
    } catch {
      // A read cut short by navigation is not a failure; a broken body or format is.
      failed = !stopped && session === s && shown(id);
    } finally {
      s.readers.delete(stop);
      streams.delete(stop);
      // A read that broke off leaves no unread copy behind; a finished one is unaffected.
      if (reader)
        void Reflect.apply(natives.cancel, reader, []).catch(() => {});
      if (list) {
        s.lists.delete(list);
        // A page held for this list goes out now rather than when the hold ends.
        if (s.timer) {
          clearTimeout(s.timer);
          s.timer = null;
        }
      }
      if (failed && kind === "events") s.events.fail();
      if (session === s) schedule(s);
    }
  }

  async function readList(
    s: Session,
    reader: ReadableStreamDefaultReader<Uint8Array>,
    stopped: () => boolean,
  ) {
    const parser = new JSONParser({
      paths: ["$.data.*"],
      keepStack: false,
      stringBufferSize: 65536,
    });
    let envelopes = 0,
      known = 0,
      full = false;
    // The start of the body, kept while no envelope was seen, to tell an empty list from
    // an unknown format.
    const head: Uint8Array[] = [];
    let headSize = 0;
    parser.onValue = ({ value }) => {
      if (full) return;
      if (++envelopes > COWORK_LIST_EVENTS) {
        full = true;
        return;
      }
      if (s.events.add(value)) known++;
    };
    let total = 0;
    for (;;) {
      if (stopped() || session !== s) return;
      const part = await Reflect.apply(natives.read, reader, []);
      if (stopped() || session !== s) return;
      if (part.done) break;
      if (!(part.value instanceof Uint8Array))
        throw new Error("history_unsupported");
      for (
        let offset = 0;
        offset < part.value.length && !full;
        offset += 65536
      ) {
        const slice = part.value.subarray(offset, offset + 65536);
        if (!envelopes && headSize <= EMPTY_LIST_BYTES) {
          head.push(slice.slice());
          headSize += slice.length;
        }
        parser.write(slice);
        total += Math.min(65536, part.value.length - offset);
        // Long lists yield so the page can handle input between slices.
        if (total % (65536 * 8) < 65536)
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      if (full) {
        void Reflect.apply(natives.cancel, reader, []).catch(() => {});
        break;
      }
    }
    // The parser ends itself after the top-level value; a body cut short ends it here.
    if (!full && !parser.isEnded) parser.end();
    // Envelopes none of which has the known shape mean the format changed, and so does a
    // body without envelopes that is not the empty list.
    if (envelopes ? !known : !emptyList(head, headSize)) s.events.fail();
  }

  async function readStream(
    s: Session,
    reader: ReadableStreamDefaultReader<Uint8Array>,
    stopped: () => boolean,
  ) {
    const decoder = new TextDecoder();
    const frames = new CoworkFrames(
      (data) => {
        let envelope: unknown;
        try {
          envelope = JSON.parse(data);
        } catch {
          // Keep-alive and other non-JSON data carry no events.
          return;
        }
        if (s.events.add(envelope)) schedule(s);
      },
      // A skipped event may have been a tool result of the running turn.
      () => s.events.gap(),
    );
    for (;;) {
      if (stopped() || session !== s) return;
      const part = await Reflect.apply(natives.read, reader, []);
      if (stopped() || session !== s) return;
      if (part.done) {
        frames.push(decoder.decode());
        // An event cut off by the end of the stream is never parsed; the page asks for
        // it again when it reconnects.
        if (frames.open) s.events.gap();
        return;
      }
      if (!(part.value instanceof Uint8Array))
        throw new Error("history_unsupported");
      frames.push(decoder.decode(part.value, { stream: true }));
    }
  }

  return {
    /** Takes a Cowork request of the page. Returns false for any other request. */
    observe(
      url: URL,
      method: string,
      promise: Promise<Response> | null,
    ): boolean {
      // A new session may start with its first message; the path is not verified yet.
      const creates = method === "POST" && url.pathname === "/v1/code/sessions";
      const request = creates ? null : coworkRequest(url, method);
      if (!request && !creates) return false;
      if (!request || request.kind === "send") {
        // The page's own send: the capture watchdog sees it as observed (W5).
        try {
          sent();
        } catch {}
        return true;
      }
      if (promise) void read(request.session, request.kind, promise);
      return true;
    },
    /** A navigation reset keeps the session now shown; every other cancel stops it. */
    cancel(keepCurrentRoute = false) {
      // A read still waiting for its session's address goes on only while the page shows
      // that session or a new task's page, which shows it next (G2).
      for (const wait of [...waits])
        if (
          !keepCurrentRoute ||
          !(shown(wait.id) || location.pathname === "/new")
        )
          wait.stop();
      if (!session) return;
      if (keepCurrentRoute && shown(session.id)) return;
      stopSession();
    },
  };
}
