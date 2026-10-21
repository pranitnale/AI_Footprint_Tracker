import { CaptureError, LIMITS, CAPTURE_TIMES } from "@footprint/capture-core";

/**
 * Progress reads one live request may take. Browsers send progress at most every 50 ms, so
 * this covers the longest live capture (W10) with room to spare.
 */
const PROGRESS_READS = Math.ceil(CAPTURE_TIMES.totalMs / 40);

export type XHRTextSink = {
  push(bytes: Uint8Array, receivedAt: number): void;
  finish(receivedAt: number): void;
  fail(error: unknown, origin: "transport" | "capture" | "lifecycle"): void;
};
export type XHRTextObserver = {
  matches(url: URL, method: string): boolean;
  start(
    url: URL,
    body: unknown,
    dispatchedAt: number,
    stop: () => void,
  ): XHRTextSink | null;
  rejected(error: unknown): void;
};
/** The page aborted its own request; a lost connection or a timeout is not this. */
export class XHRAbortError extends Error {
  constructor() {
    super("request_aborted");
  }
}
export type XHRGetters = Record<
  "ready" | "status" | "type" | "text" | "json" | "url",
  (() => unknown) | undefined
>;

/** Observe native progress without replacing XHR events, response data or cancellation. */
export function sendObservedTextXHR(
  xhr: XMLHttpRequest,
  args: unknown[],
  url: URL,
  nativeSend: XMLHttpRequest["send"],
  getters: XHRGetters,
  listeners: Map<XMLHttpRequest, () => void>,
  observer: XHRTextObserver,
) {
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  const rejected = (error: unknown) => {
    try {
      observer.rejected(error);
    } catch {}
  };
  let sink: XHRTextSink | null = null;
  let stopped = false;
  let started = false;
  let offset = 0;
  let reads = 0;
  const earlyEvent: { value: { type: string; at: number } | null } = {
    value: null,
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearTimeout(timer);
    for (const name of ["progress", "load", "error", "abort", "timeout"])
      try {
        Reflect.apply(remove, xhr, [name, receive]);
      } catch {}
    listeners.delete(xhr);
    sink = null;
  };
  const fail = (
    error: unknown,
    origin: "transport" | "capture" | "lifecycle",
  ) => {
    if (stopped) return;
    try {
      sink?.fail(error, origin);
    } catch {
      /* Native event dispatch remains owned by the page. */
    } finally {
      cleanup();
    }
  };
  const read = (key: keyof XHRGetters) => Reflect.apply(getters[key]!, xhr, []);
  const process = (type: string, at: number) => {
    if (stopped) return;
    if (type !== "progress" && type !== "load") {
      fail(
        type === "abort"
          ? new XHRAbortError()
          : new CaptureError("capture_interrupted"),
        "transport",
      );
      return;
    }
    try {
      const responseType = read("type");
      if (responseType !== "" && responseType !== "text")
        throw new CaptureError("unsupported_schema");
      const ready = read("ready"),
        status = read("status"),
        responseUrl = read("url");
      if (
        (ready !== 3 && ready !== 4) ||
        typeof status !== "number" ||
        status < 200 ||
        status >= 300 ||
        (responseUrl && responseUrl !== url.href)
      )
        throw new CaptureError("capture_interrupted");
      const text = read("text");
      if (
        ++reads > PROGRESS_READS ||
        typeof text !== "string" ||
        text.length > LIMITS.stream ||
        text.length < offset
      )
        throw new CaptureError("buffer_overflow");
      let end = text.length;
      // A progress boundary can split a UTF-16 surrogate pair. Delay that code unit until its partner arrives.
      if (end > offset && /[\uD800-\uDBFF]/.test(text.charAt(end - 1))) {
        if (type === "load") throw new CaptureError("malformed_frame");
        end--;
      }
      if (end > offset) {
        const bytes = new TextEncoder().encode(text.slice(offset, end));
        offset = end;
        sink?.push(bytes, at);
      }
      if (type === "load" && !stopped) {
        sink?.finish(at);
        cleanup();
      }
    } catch (error) {
      fail(error, "capture");
    }
  };
  const receive = (event: Event) => {
    const at = performance.now();
    if (!started) {
      earlyEvent.value = { type: event.type, at };
      return;
    }
    process(event.type, at);
  };
  try {
    for (const name of ["progress", "load", "error", "abort", "timeout"])
      Reflect.apply(add, xhr, [name, receive]);
    listeners.set(xhr, () =>
      fail(new CaptureError("capture_interrupted"), "lifecycle"),
    );
  } catch (error) {
    cleanup();
    const result = Reflect.apply(nativeSend, xhr, args);
    rejected(error);
    return result;
  }
  const dispatchedAt = performance.now();
  let result;
  try {
    result = Reflect.apply(nativeSend, xhr, args);
  } catch (error) {
    cleanup();
    throw error;
  }
  // Native send can synchronously run host callbacks that reopen or cancel this observer.
  if (stopped) return result;
  try {
    sink = observer.start(url, args[0], dispatchedAt, cleanup);
    if (stopped) {
      const abandoned = sink;
      sink = null;
      abandoned?.fail(new CaptureError("capture_interrupted"), "lifecycle");
      return result;
    }
    started = true;
    if (!sink) cleanup();
    else {
      // The capture's own sweep ends a silent or overlong request first; this only stops
      // listening if that capture is gone.
      timer = setTimeout(
        () => fail(new CaptureError("capture_interrupted"), "lifecycle"),
        CAPTURE_TIMES.totalMs + 2 * CAPTURE_TIMES.sweepMs,
      );
      if (earlyEvent.value) process(earlyEvent.value.type, earlyEvent.value.at);
    }
  } catch (error) {
    cleanup();
    rejected(error);
  }
  return result;
}
