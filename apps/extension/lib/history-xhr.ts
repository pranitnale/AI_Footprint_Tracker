import { HISTORY_LIMITS } from "@footprint/adapters";
import { geminiRequestPath, siteForHost } from "@footprint/capture-core";
import { sendObservedTextXHR, type XHRTextObserver } from "./xhr-text-stream";
import {
  GEMINI_HISTORY_PATH,
  historyRequestConversation,
  notebooklmHistoryRpc,
} from "./history-route";

/**
 * Reads of different kinds that the history reader keeps waiting for a slot at once
 * (`passive-history-text.ts`); past this many it drops the oldest and reports it.
 */
export const HISTORY_WAITING_KINDS = 8;
/**
 * NotebookLM reads still receiving their response that are taken at once. A notebook opened
 * by a full page load asks for its Studio list, its chat session list and its chat turns
 * together, and the Studio list of a notebook with audio or video items is large (14 Oct
 * 2026). With only the two reading slots, the third read was passed by unread and its chat
 * was never counted. Each read is a different kind, which the history reader keeps waiting
 * one per kind, so they are taken up to the reads it can run and keep.
 */
export const NOTEBOOKLM_RECEIVING_READS =
  HISTORY_LIMITS.active + HISTORY_WAITING_KINDS;

/** Copy only native JSON data properties. Page-added getters or serializers are unsupported. */
function nativeJSON(value: unknown, responseLimit: number): string {
  let units = 0,
    nodes = 0;
  const visit = (v: unknown, depth: number): any => {
    nodes++;
    if ((Number.isFinite(responseLimit) && nodes > 100000) || depth > 32)
      throw new Error("history_limit");
    if (
      v === null ||
      typeof v === "boolean" ||
      (typeof v === "number" && Number.isFinite(v))
    )
      return v;
    if (typeof v === "string") {
      units += v.length;
      if (units > responseLimit) throw new Error("history_response_limit");
      return v;
    }
    if (
      !v ||
      typeof v !== "object" ||
      ![null, Object.prototype, Array.prototype].includes(
        Object.getPrototypeOf(v),
      )
    )
      throw new Error("history_unsupported");
    const descriptors = Object.getOwnPropertyDescriptors(v),
      array = Array.isArray(v);
    if (
      array &&
      Number.isFinite(responseLimit) &&
      (v as unknown[]).length > 100000
    )
      throw new Error("history_limit");
    const out: any = array ? [] : Object.create(null);
    for (const [key, property] of Object.entries(descriptors)) {
      if (array && key === "length") continue;
      if (
        !Object.hasOwn(property, "value") ||
        !property.enumerable ||
        (array && !/^(0|[1-9][0-9]*)$/.test(key))
      )
        throw new Error("history_unsupported");
      units += key.length;
      if (units > responseLimit) throw new Error("history_response_limit");
      out[key] = visit(property.value, depth + 1);
    }
    return out;
  };
  const text = JSON.stringify(visit(value, 0));
  if (
    Number.isFinite(responseLimit) &&
    new TextEncoder().encode(text).length > responseLimit
  )
    throw new Error("history_response_limit");
  return text;
}

export function installHistoryXHR(
  XHR: typeof XMLHttpRequest,
  observe: (
    url: URL,
    method: string,
    promise: Promise<Response>,
    observedAt: number,
    body?: unknown,
  ) => boolean | undefined,
  rejected: (
    url: URL,
    method: string,
    observedAt: number,
    body?: unknown,
    metadata?: boolean,
  ) => void = () => {},
  stream?: XHRTextObserver,
) {
  if (!XHR?.prototype)
    return { cancel() {}, restore() {}, direct: () => false };
  const prototype = XHR.prototype,
    open = prototype.open,
    send = prototype.send;
  const descriptor = (key: string) =>
    Object.getOwnPropertyDescriptor(prototype, key)?.get;
  const getters = {
    ready: descriptor("readyState"),
    status: descriptor("status"),
    type: descriptor("responseType"),
    text: descriptor("responseText"),
    json: descriptor("response"),
    url: descriptor("responseURL"),
  };
  if (Object.values(getters).some((get) => !get))
    return { cancel() {}, restore() {}, direct: () => false };
  const add = EventTarget.prototype.addEventListener,
    remove = EventTarget.prototype.removeEventListener;
  const requests = new Map<
    XMLHttpRequest,
    { url: URL; method: string; observedAt: number; live: boolean }
  >();
  const rejectMetadata = (request: {
    url: URL;
    method: string;
    observedAt: number;
    live: boolean;
  }) => {
    try {
      if (request.live) {
        stream?.rejected(new Error("capture_interrupted"));
        return;
      }
      rejected(
        request.url,
        request.method,
        request.observedAt,
        undefined,
        true,
      );
    } catch {}
  };
  let requestTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Map<XMLHttpRequest, () => void>();
  /**
   * Reads still receiving their response. A read whose response has fully arrived no
   * longer takes a slot, even before its load listener runs: the page's own handlers run
   * first and may send the next read from there (NotebookLM sends its chat turns right
   * after the session list, 14 Oct 2026).
   */
  const busyReads = () => {
    let busy = 0;
    for (const xhr of listeners.keys()) {
      try {
        if (Reflect.apply(getters.ready!, xhr, []) !== 4) busy++;
      } catch {
        busy++;
      }
    }
    return busy;
  };
  const streamListeners = new Map<XMLHttpRequest, () => void>();
  let enabled = true;
  const opened = function (this: XMLHttpRequest, ...args: any[]) {
    // A rejected native open leaves the previous request running and observable.
    const result = Reflect.apply(open, this, args);
    listeners.get(this)?.();
    streamListeners.get(this)?.();
    requests.delete(this);
    try {
      if (
        !enabled ||
        typeof args[0] !== "string" ||
        typeof args[1] !== "string" ||
        args[1].length > 8192 ||
        args.length > 3 ||
        (args.length >= 3 && args[2] !== undefined && args[2] !== true)
      )
        return result;
      const method = args[0].toUpperCase(),
        url = new URL(args[1], location.href);
      const site = siteForHost(location.hostname);
      if (
        url.protocol !== "https:" ||
        url.origin !== location.origin ||
        url.username ||
        url.password ||
        url.hash
      )
        return result;
      const live = stream?.matches(url, method) === true;
      // The request names its conversation; the route may change just after it starts.
      const eligible =
        live ||
        (!!site &&
          ((method === "GET" &&
            historyRequestConversation(site, url, method) !== null) ||
            (site === "gemini" &&
              method === "POST" &&
              geminiRequestPath(url.pathname) === GEMINI_HISTORY_PATH) ||
            // The Studio list and opened items (W9); the body names the notebook.
            (site === "notebooklm" &&
              method === "POST" &&
              notebooklmHistoryRpc(url))));
      if (eligible) {
        if (requests.size >= 16) {
          const oldest = requests.keys().next().value!;
          rejectMetadata(requests.get(oldest)!);
          requests.delete(oldest);
        }
        requests.set(this, { url, method, observedAt: Date.now(), live });
        requestTimer ??= setTimeout(() => {
          for (const request of requests.values()) rejectMetadata(request);
          requests.clear();
          requestTimer = undefined;
        }, HISTORY_LIMITS.lifetimeMs);
      }
    } catch {}
    return result;
  } as typeof prototype.open;
  const sent = function (this: XMLHttpRequest, ...args: any[]) {
    let request = requests.get(this);
    requests.delete(this);
    if (!requests.size && requestTimer) {
      clearTimeout(requestTimer);
      requestTimer = undefined;
    }
    if (!enabled || !request) return Reflect.apply(send, this, args);
    if (request.live && stream)
      return sendObservedTextXHR(
        this,
        args,
        request.url,
        send,
        getters,
        streamListeners,
        stream,
      );
    const observedAt = Date.now();
    if (
      busyReads() >=
        (siteForHost(location.hostname) === "notebooklm"
          ? NOTEBOOKLM_RECEIVING_READS
          : HISTORY_LIMITS.active) ||
      (request.method !== "GET" && typeof args[0] !== "string")
    ) {
      const result = Reflect.apply(send, this, args);
      try {
        rejected(request.url, request.method, observedAt, args[0]);
      } catch {}
      return result;
    }
    let started = false,
      loaded = false,
      settled = false,
      expired = false;
    let resolve!: (value: Response) => void, reject!: (reason: Error) => void;
    const promise = new Promise<Response>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    void promise.catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      for (const name of ["load", "error", "abort", "timeout", "progress"]) {
        try {
          Reflect.apply(remove, this, [
            name,
            name === "load" ? complete : name === "progress" ? progressed : failed,
          ]);
        } catch {}
      }
      listeners.delete(this);
    };
    const failure = (
      reason:
        "history_unsupported" | "history_timeout" | "history_response_limit",
    ) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(reason));
    };
    const failed = () => failure("history_unsupported");
    const progressed = () => {
      if (settled || expired) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        expired = true;
        request = undefined;
      }, HISTORY_LIMITS.lifetimeMs);
    };
    const complete = () => {
      loaded = true;
      if (!started || settled) return;
      if (expired) {
        failure("history_timeout");
        return;
      }
      try {
        const read = (name: keyof typeof getters) =>
          Reflect.apply(getters[name]!, this, []);
        if (
          read("ready") !== 4 ||
          read("status") < 200 ||
          read("status") >= 300 ||
          (read("url") && read("url") !== request!.url.href)
        )
          throw new Error("history_unsupported");
        const responseLimit = Infinity;
        const type = read("type");
        const text =
          type === "json"
            ? nativeJSON(read("json"), responseLimit)
            : type === "" || type === "text"
              ? read("text")
              : null;
        if (typeof text !== "string") throw new Error("history_unsupported");
        if (
          text.length > responseLimit ||
          (Number.isFinite(responseLimit) &&
            new TextEncoder().encode(text).length > responseLimit)
        )
          throw new Error("history_response_limit");
        settled = true;
        cleanup();
        resolve(new Response(text));
      } catch (error) {
        failure(
          error instanceof Error && error.message === "history_response_limit"
            ? "history_response_limit"
            : "history_unsupported",
        );
      }
    };
    try {
      for (const name of ["load", "error", "abort", "timeout", "progress"])
        Reflect.apply(add, this, [name, name === "load" ? complete : name === "progress" ? progressed : failed]);
      listeners.set(this, failed);
      // The shared observer reports the deadline. Keep only terminal listeners until the native request settles.
      timer = setTimeout(() => {
        expired = true;
        request = undefined;
      }, HISTORY_LIMITS.lifetimeMs);
    } catch {
      failed();
    }
    let result;
    try {
      result = Reflect.apply(send, this, args);
    } catch (error) {
      failed();
      throw error;
    }
    if (!settled) {
      try {
        started =
          observe(
            request!.url,
            request!.method,
            promise,
            observedAt,
            args[0],
          ) === true;
        if (!started) failed();
        else if (loaded) complete();
      } catch {
        failed();
      }
    } else failed();
    return result;
  } as typeof prototype.send;
  prototype.open = opened;
  prototype.send = sent;
  const cancelPending = (includeLive = false) => {
    for (const [xhr, request] of requests)
      if (includeLive || !request.live) requests.delete(xhr);
    if (!requests.size && requestTimer) clearTimeout(requestTimer);
    if (!requests.size) requestTimer = undefined;
    for (const stop of [...listeners.values()]) stop();
    if (includeLive) for (const stop of [...streamListeners.values()]) stop();
  };
  return {
    cancel: cancelPending,
    direct: () =>
      enabled && prototype.open === opened && prototype.send === sent,
    restore() {
      enabled = false;
      cancelPending(true);
      if (prototype.open === opened) prototype.open = open;
      if (prototype.send === sent) prototype.send = send;
    },
  };
}
