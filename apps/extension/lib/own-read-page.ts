import { HISTORY_LIMITS } from "@footprint/adapters";
import {
  OWN_READ_CHANNEL,
  OWN_READ_COOLDOWN_MS,
  OWN_READ_PAUSE_MAX_MS,
  ownReadConversation,
  type OwnReadOutcome,
  type OwnReadSite,
} from "./own-read";

/** Each request is abandoned after this long, including reading its body. */
export const OWN_READ_TIMEOUT_MS = 30_000;
/** A chat the page itself read this recently is never read by the tracker. */
export const PAGE_READ_RECENT_MS = 30_000;
/**
 * Provider requests this page may send for own reads in one window, whatever asks for them.
 * A read that reaches the limit waits for the oldest request to leave the window, so a long
 * ChatGPT read (batches of 20 pages a minute apart) is paced rather than stopped. A new read
 * is declined while the window is full.
 */
export const OWN_READ_REQUESTS_PER_WINDOW = 60;
export const OWN_READ_WINDOW_MS = 5 * 60_000;
/** A read waiting for the request limit tells the content script it goes on this often. */
const BUDGET_STEP_MS = 15_000;
/**
 * The fixed wait between two pages of one read (ChatGPT, NotebookLM, Cowork), owner decision
 * of 17 October 2026. Pages are still read one at a time and in order; the request limit
 * above (60 per 5 minutes, an average of one every 5 s) and ChatGPT's batches of 20 pages a
 * minute apart already bound how much a long read asks, so this only keeps a short gap
 * between consecutive requests.
 */
export const OWN_READ_PAGE_SPACING_MS = 1000;

/**
 * The wait a 429 or 503 asks for in its Retry-After header, in milliseconds: delay seconds or
 * an HTTP date (RFC 9110, section 10.2.3). Null when the header is absent or unreadable; a
 * date in the past is no wait. Longer than `OWN_READ_PAUSE_MAX_MS` reads as that maximum.
 */
export function retryAfterMs(value: string | null, now: number): number | null {
  const text = value?.trim() ?? "";
  if (!text) return null;
  let ms: number;
  if (/^\d+$/.test(text)) ms = Number(text) * 1000;
  else {
    const at = Date.parse(text);
    if (!Number.isFinite(at) || !/[A-Za-z]/.test(text)) return null;
    ms = at - now;
  }
  if (!Number.isFinite(ms)) return null;
  return Math.min(Math.max(0, Math.ceil(ms)), OWN_READ_PAUSE_MAX_MS);
}

/** The outcome of a refused or failed answer, with the wait it asked for when it named one. */
export function httpOutcome(
  status: number,
  headers: Headers,
  now: number,
): Extract<OwnReadOutcome, { kind: "http" }> {
  const outcome: Extract<OwnReadOutcome, { kind: "http" }> = {
    kind: "http",
    status,
    shouldRetry: headers.get("x-should-retry") !== "false",
  };
  if (status === 429 || status === 503) {
    const retryAfter = retryAfterMs(headers.get("retry-after"), now);
    if (retryAfter !== null) outcome.retryAfter = retryAfter;
  }
  return outcome;
}
/** The session answer ChatGPT's read needs is small; a larger one is not read. */
export const OWN_READ_PRIVATE_BYTES = 65_536;
/**
 * The own read holds a body whole: the provider checks it before the history reader gets a
 * copy. Google batch bodies have the history reader's own limit. The other sites' bodies are
 * parsed as they stream when the page reads them and have no byte limit there; the own read
 * stops at this size and says so in Details.
 */
export const OWN_READ_STREAMED_BYTES = 32 * 1048576;

/**
 * The largest Perplexity Computer file the tracker downloads to count (owner decision of
 * 14 Oct 2026). A larger file, like one that cannot be downloaded, counts by its size.
 */
export const COMPUTER_FILE_BYTES = 2 * 1048576;
/**
 * A file download's time limit, body included. It is shorter than the history read's own
 * 30 s limit, which the download renews just before it starts.
 */
export const COMPUTER_FILE_TIMEOUT_MS = 20_000;

/**
 * What a file download gave: the file's text, a failure that makes the file count by its
 * size, or `held` when it was not tried now (tracker stopped, hidden tab, the request limit
 * or a pause after a 429 or 5xx) and a later read may try again.
 */
export type ComputerFileDownload =
  | { kind: "text"; text: string }
  | { kind: "failed" }
  | { kind: "held" };

export function ownReadByteLimit(site: OwnReadSite): number {
  return site === "gemini" || site === "notebooklm"
    ? HISTORY_LIMITS.wholeResponseBytes
    : OWN_READ_STREAMED_BYTES;
}

/** Query values that change with every request or session, not with what is read. */
const VOLATILE_QUERY = new Set(["_reqid", "bl", "f.sid", "hl", "rt"]);

/** The `f.req` of a batch body, or the whole body; tokens such as `at` are left out. */
function requestBody(body: unknown): string | null {
  if (typeof body !== "string") return null;
  try {
    const form = new URLSearchParams(body);
    if (form.has("f.req")) return form.getAll("f.req").join("\n");
  } catch {}
  return body;
}

/**
 * Whether two requests read the same thing: same path, the same query apart from
 * per-request values, and the same batch request. A read the page made and the history reader
 * refused is not repeated with the same request (owner decision of 14 Oct 2026).
 */
export function sameRequest(
  a: { url: URL; body?: unknown },
  b: { url: URL; body?: unknown },
): boolean {
  const query = (url: URL) =>
    [...url.searchParams]
      .filter(([key]) => !VOLATILE_QUERY.has(key))
      .map(([key, value]) => `${key}=${value}`)
      .sort()
      .join("&");
  return (
    a.url.origin === b.url.origin &&
    a.url.pathname === b.url.pathname &&
    query(a.url) === query(b.url) &&
    requestBody(a.body) === requestBody(b.body)
  );
}

/** What a provider decides about one answer before it reaches the history reader. */
export type OwnReadCheck<T> =
  | { ok: true; info: T }
  | { ok: false; outcome: OwnReadOutcome };

/** A private answer (ChatGPT's session): its status and, when it was read, its text. */
export interface OwnReadPrivateAnswer {
  status: number;
  headers: Headers;
  /** The body, when the status was 2xx and the body fit the limit and decoded. */
  text: string | null;
}

/** The tools a provider's read gets for one run. */
export interface OwnReadContext {
  conversationId: string;
  /** The page address when the read started, as the page's own requests name it. */
  pathname: string;
  /**
   * Makes one request. A failed status ends with an `http` outcome and a body past the
   * site's limit with `too_large`; otherwise the body is checked and, when the check passes,
   * a copy goes to the history reader.
   */
  read<T>(
    url: URL,
    init: RequestInit,
    check: (text: string, response: Response) => OwnReadCheck<T>,
  ): Promise<OwnReadCheck<T>>;
  /**
   * Makes a request whose answer is used only inside the read and never reaches the
   * history reader (ChatGPT's session). The body is read within the request's time limit.
   * An outcome when it failed or the read was stopped.
   */
  fetchPrivate(url: URL, init: RequestInit): Promise<OwnReadPrivateAnswer | OwnReadOutcome>;
  /** Waits, then until the tab is visible; false once the read was stopped. */
  pause(ms: number): Promise<boolean>;
  /** Tells the content script a long read is still going. */
  progress(): void;
  /**
   * Where the content script asked the read to continue (ChatGPT's kept progress), checked
   * by the provider's `resume`; undefined when it named none.
   */
  resume: unknown;
  /** Tells the content script how far the read got, so it can keep it (ChatGPT). */
  report(value: unknown): void;
  /** Whether the read may go on: not stopped, same chat shown, tracker enabled. */
  active(): boolean;
}

export interface OwnReadProvider {
  site: OwnReadSite;
  /**
   * Learns from a request the page sent itself, before it is observed (Claude's
   * organization, NotebookLM's request shapes). Values stay in memory in this page.
   */
  learn?(url: URL, method: string, body?: unknown): void;
  /** The conversation a page history read names, when the history reader's rule differs. */
  pageReadConversation?(url: URL, method: string, body?: unknown): string | null;
  /**
   * Whether a history read the page made makes the tracker's read unnecessary. By default
   * every read of the chat does; ChatGPT's newest page does not, only its earlier pages.
   */
  pageReadCounts?(url: URL, body?: unknown): boolean;
  /**
   * Whether a request's `resume` value is one this provider reads. Without this check a
   * request that names one is ignored, like any other malformed request.
   */
  resume?(value: unknown): boolean;
  run(context: OwnReadContext): Promise<OwnReadOutcome>;
}

/** Whether a port message from the content script asks the running read to stop. */
const isCancel = (value: unknown) =>
  !!value &&
  typeof value === "object" &&
  Object.keys(value).join(",") === "cancel" &&
  (value as { cancel?: unknown }).cancel === true;

/**
 * Runs the tracker's own read in the page world, where a request is the page's own: same
 * origin, the person's login cookies and only the headers the provider requires.
 */
export function createOwnReadPage(deps: {
  provider: OwnReadProvider;
  origin: string;
  /** The browser's fetch from before any page wrapper, so the read is not seen as the page's. */
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  /** The page read's own history path (text reader, and Perplexity's thread reader). */
  observe: (
    url: URL,
    method: string,
    response: Promise<Response>,
    observedAt: number,
    body?: string,
  ) => void;
  /** The conversation a page request reads, as the history reader recognizes it. */
  readConversation: (url: URL, method: string, body?: unknown) => string | null;
  pathname: () => string;
  visible: () => boolean;
  /** Calls back once the tab is visible again; returns a function that stops waiting. */
  whenVisible: (callback: () => void) => () => void;
  enabled: () => boolean;
  now?: () => number;
  /** The largest body a read holds; the site's limit by default. */
  byteLimit?: number;
}) {
  const { provider } = deps;
  const now = deps.now ?? Date.now;
  const byteLimit = deps.byteLimit ?? ownReadByteLimit(provider.site);
  // Taken now so later page overrides never run inside the read.
  const NativeResponse = Response;
  const getReader = ReadableStream.prototype.getReader;
  const readChunk = ReadableStreamDefaultReader.prototype.read;
  const cancelReader = ReadableStreamDefaultReader.prototype.cancel;
  const cancelStream = ReadableStream.prototype.cancel;
  const discard = (response: Response) => {
    if (response.body)
      void Reflect.apply(cancelStream, response.body, []).catch(() => {});
  };
  /**
   * The body's bytes, or null past `limit`; a larger body is cancelled at once instead of
   * being held. Throws when the stream fails or the request is aborted.
   */
  const readBounded = async (
    response: Response,
    limit: number,
  ): Promise<Uint8Array<ArrayBuffer> | null> => {
    if (!response.body) return new Uint8Array(0);
    const reader = Reflect.apply(getReader, response.body, []) as ReadableStreamDefaultReader<Uint8Array>;
    const parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const part = (await Reflect.apply(readChunk, reader, [])) as ReadableStreamReadResult<Uint8Array>;
      if (part.done) break;
      if (!(part.value instanceof Uint8Array)) throw new Error("not bytes");
      size += part.value.length;
      if (size > limit) {
        void Reflect.apply(cancelReader, reader, []).catch(() => {});
        return null;
      }
      parts.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    return bytes;
  };
  /** When the page last read each chat in a way that makes the tracker's read unnecessary. */
  const pageReads = new Map<string, number>();
  /** The page's latest history request for each chat that the history reader read. */
  const lastRequests = new Map<string, { url: URL; body?: unknown }>();
  /** When each provider request of an own read was sent, for the request limit. */
  let sent: number[] = [];
  const windowFull = (at: number) => {
    sent = sent.filter((time) => at - time < OWN_READ_WINDOW_MS);
    return sent.length >= OWN_READ_REQUESTS_PER_WINDOW;
  };
  type Flight = {
    conversationId: string;
    /** Why the read was stopped; it replaces the outcome the run reports. */
    stopped: OwnReadOutcome | null;
    /**
     * The page's read the history reader refused; the first request is compared with it and
     * not sent when it is the same.
     */
    refused: { url: URL; body?: unknown } | null;
    controllers: Set<AbortController>;
    wakes: Set<() => void>;
    /** Answers the content script once; later calls do nothing. */
    answer: (outcome: OwnReadOutcome) => void;
  };
  let flight: Flight | null = null;
  /** Until when a 429 or 5xx from a file host holds further file downloads. */
  let filesPausedUntil = 0;
  /** The private port the content script sends its requests on (`connect`). */
  let link: MessagePort | null = null;

  // A stopped read answers at once and frees the page for another read, even when its
  // request or body never settles.
  const stop = (outcome: OwnReadOutcome, current: Flight | null = flight) => {
    if (!current || current.stopped) return;
    current.stopped = outcome;
    if (flight === current) flight = null;
    for (const controller of current.controllers) controller.abort();
    for (const wake of [...current.wakes]) wake();
    current.answer(outcome);
  };

  function context(
    current: Flight,
    port: {
      progress: () => void;
      receiving: () => void;
      report: (value: unknown) => void;
    },
    resume: unknown,
  ): OwnReadContext {
    const active = () =>
      flight === current &&
      !current.stopped &&
      deps.enabled() &&
      ownReadConversation(provider.site, deps.pathname()) ===
        current.conversationId;
    // One request with its own time limit, which covers its body; a stop aborts it.
    const request = () => {
      const controller = new AbortController();
      current.controllers.add(controller);
      const timer = setTimeout(() => {
        controller.abort();
        stop({ kind: "timeout" }, current);
      }, OWN_READ_TIMEOUT_MS);
      return {
        signal: controller.signal,
        done: () => {
          clearTimeout(timer);
          current.controllers.delete(controller);
        },
      };
    };
    const stoppedOr = (outcome: OwnReadOutcome) => current.stopped ?? outcome;
    const pause = (ms: number) =>
      new Promise<boolean>((resolve) => {
        let unlisten = () => {};
        let timer: ReturnType<typeof setTimeout> | null = null;
        const finish = () => {
          if (timer) clearTimeout(timer);
          unlisten();
          current.wakes.delete(finish);
          resolve(active());
        };
        current.wakes.add(finish);
        timer = setTimeout(() => {
          timer = null;
          // Reads are made only for a chat open in front of the person: a hidden tab waits
          // until it is shown again.
          if (!active() || deps.visible()) finish();
          else unlisten = deps.whenVisible(finish);
        }, ms);
      });
    // Takes one place in the request limit, waiting while the window is full.
    const slot = async () => {
      for (;;) {
        if (!active()) return false;
        const at = now();
        if (!windowFull(at)) {
          sent.push(at);
          return true;
        }
        port.progress();
        const wait = Math.max(
          1,
          Math.min(BUDGET_STEP_MS, sent[0]! + OWN_READ_WINDOW_MS - at),
        );
        if (!(await pause(wait))) return false;
      }
    };
    return {
      conversationId: current.conversationId,
      pathname: deps.pathname(),
      active,
      progress: port.progress,
      resume,
      report: (value) => {
        if (flight === current && !current.stopped) port.report(value);
      },
      pause,
      async fetchPrivate(url, init) {
        if (!(await slot())) return stoppedOr({ kind: "navigated" });
        const { signal, done } = request();
        try {
          const response = await deps.fetch(url.href, { ...init, signal });
          if (!response.ok) {
            discard(response);
            return { status: response.status, headers: response.headers, text: null };
          }
          const bytes = await readBounded(response, OWN_READ_PRIVATE_BYTES);
          let text: string | null = null;
          try {
            if (bytes) text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          } catch {}
          return current.stopped ?? { status: response.status, headers: response.headers, text };
        } catch {
          return stoppedOr({ kind: "network" });
        } finally {
          done();
        }
      },
      async read(url, init, check) {
        if (!active())
          return { ok: false, outcome: stoppedOr({ kind: "navigated" }) };
        const refused = current.refused;
        current.refused = null;
        if (refused && sameRequest(refused, { url, body: init.body }))
          return { ok: false, outcome: { kind: "page_read" } };
        if (!(await slot()))
          return { ok: false, outcome: stoppedOr({ kind: "navigated" }) };
        const observedAt = now();
        const { signal, done } = request();
        try {
          let response: Response;
          let bytes: Uint8Array<ArrayBuffer> | null;
          try {
            response = await deps.fetch(url.href, { ...init, signal });
            if (!response.ok) {
              discard(response);
              return {
                ok: false,
                outcome: stoppedOr(httpOutcome(response.status, response.headers, now())),
              };
            }
            port.receiving();
            // Read within the request's time limit and the site's byte limit, so a stalled
            // or oversized body ends the read instead of holding it.
            bytes = await readBounded(response, byteLimit);
          } catch {
            return { ok: false, outcome: stoppedOr({ kind: "network" }) };
          }
          if (!bytes) return { ok: false, outcome: stoppedOr({ kind: "too_large" }) };
          // The answer is checked first, so one the reader would refuse falls back instead of
          // raising a history problem.
          let checked: OwnReadCheck<any>;
          try {
            const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
            checked = check(text, response);
          } catch {
            checked = { ok: false, outcome: { kind: "invalid" } };
          }
          if (!checked.ok || !active()) {
            return {
              ok: false,
              outcome: stoppedOr(
                !checked.ok
                  ? checked.outcome
                  : deps.enabled()
                    ? { kind: "navigated" }
                    : { kind: "declined" },
              ),
            };
          }
          // The history reader gets its own copy of the bytes already read.
          const copy = new NativeResponse(bytes, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
          deps.observe(
            url,
            String(init.method ?? "GET"),
            Promise.resolve(copy),
            observedAt,
            typeof init.body === "string" ? init.body : undefined,
          );
          return checked;
        } finally {
          done();
        }
      },
    };
  }

  /** Handles one read request from the content script; true when the message was one. */
  function receive(data: unknown, ports: readonly MessagePort[]): boolean {
    if (
      !data ||
      typeof data !== "object" ||
      (data as { channel?: unknown }).channel !== OWN_READ_CHANNEL
    )
      return false;
    const port = ports.length === 1 ? ports[0]! : null;
    const message = data as {
      site?: unknown;
      conversationId?: unknown;
      rejected?: unknown;
      resume?: unknown;
      uncounted?: unknown;
    };
    const conversationId = message.conversationId;
    // `rejected`, `resume` and `uncounted` are optional; every other key makes the request
    // malformed.
    const named = Object.keys(data);
    const keys = named
      .filter((key) => key !== "rejected" && key !== "resume" && key !== "uncounted")
      .sort()
      .join(",");
    const hasResume = named.includes("resume");
    if (
      !port ||
      keys !== "channel,conversationId,site" ||
      (named.includes("rejected") && message.rejected !== true) ||
      (named.includes("uncounted") && message.uncounted !== true) ||
      (hasResume && provider.resume?.(message.resume) !== true) ||
      message.site !== provider.site ||
      typeof conversationId !== "string"
    ) {
      for (const unused of ports) unused.close();
      return true;
    }
    const post = (value: unknown) => {
      try {
        port.postMessage(value);
      } catch {}
    };
    let answered = false;
    const answer = (outcome: OwnReadOutcome) => {
      if (answered) return;
      answered = true;
      post({ outcome });
      port.onmessage = null;
      port.close();
    };
    const at = now();
    // After the history reader refused the page's read, the page's recent read is the
    // reason to read, not a reason to skip. So it is when the content script says the page's
    // recent reads were not counted (`uncounted`: tracking was off then). claude.ai reads the
    // saved chat about 0.1 s after every reply ends; with tracking off that read went nowhere,
    // yet it skipped the read made after agreeing again (live QA, 19 Oct 2026). Unlike
    // `rejected`, the same request may be sent: it was turned away unread, not refused.
    const pageRead = pageReads.get(conversationId);
    if (
      message.rejected !== true &&
      message.uncounted !== true &&
      pageRead !== undefined &&
      at - pageRead < PAGE_READ_RECENT_MS
    ) {
      answer({ kind: "page_read" });
      return true;
    }
    if (
      !deps.enabled() ||
      flight ||
      windowFull(at) ||
      ownReadConversation(provider.site, deps.pathname()) !== conversationId ||
      !deps.visible()
    ) {
      answer({ kind: "declined" });
      return true;
    }
    const current: Flight = {
      conversationId,
      stopped: null,
      refused:
        message.rejected === true ? (lastRequests.get(conversationId) ?? null) : null,
      controllers: new Set(),
      wakes: new Set(),
      answer,
    };
    flight = current;
    // The content script gave up waiting (its reply time ran out): the read stops, so
    // nothing more is requested or handed to the history reader.
    port.onmessage = (event: MessageEvent) => {
      if (isCancel(event.data)) stop({ kind: "declined" }, current);
    };
    let receiving = false;
    void provider
      .run(
        context(
          current,
          {
            progress: () => {
              if (!current.stopped) post({ pending: true });
            },
            receiving: () => {
              if (receiving || current.stopped) return;
              receiving = true;
              post({ stage: "receiving" });
            },
            report: (value) => post({ resume: value }),
          },
          // A posted message is a structured copy, so the value checked is the one read.
          hasResume ? message.resume : undefined,
        ),
      )
      .catch((): OwnReadOutcome => ({ kind: "invalid" }))
      .then((outcome) => {
        if (flight === current) flight = null;
        answer(current.stopped ?? outcome);
      });
    return true;
  }

  return {
    /**
     * Downloads one file Perplexity Computer created, to count its text (owner decision of
     * 14 Oct 2026). Only the https link the file's own asset gave is used, without the
     * person's cookies, within the own reads' request limit and time limit, and only while
     * the tab is shown. The text is handed back to be counted and is never kept here.
     */
    async fetchFile(link: string, bytes: number): Promise<ComputerFileDownload> {
      let url: URL;
      try {
        url = new URL(link);
      } catch {
        return { kind: "failed" };
      }
      if (url.protocol !== "https:" || url.username || url.password)
        return { kind: "failed" };
      if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > COMPUTER_FILE_BYTES)
        return { kind: "failed" };
      const at = now();
      if (!deps.enabled() || !deps.visible() || at < filesPausedUntil || windowFull(at))
        return { kind: "held" };
      sent.push(at);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), COMPUTER_FILE_TIMEOUT_MS);
      try {
        const response = await deps.fetch(url.href, {
          method: "GET",
          credentials: "omit",
          signal: controller.signal,
        });
        if (response.status === 429 || response.status >= 500) {
          discard(response);
          filesPausedUntil = now() + OWN_READ_COOLDOWN_MS;
          return { kind: "held" };
        }
        if (!response.ok) {
          discard(response);
          return { kind: "failed" };
        }
        const body = await readBounded(response, COMPUTER_FILE_BYTES);
        // The asset names the file's size; another length is not the file it describes.
        if (!body || body.length !== bytes) return { kind: "failed" };
        return {
          kind: "text",
          text: new TextDecoder("utf-8", { fatal: true }).decode(body),
        };
      } catch {
        // A network error, the time limit or text that is not UTF-8.
        return { kind: "failed" };
      } finally {
        clearTimeout(timer);
      }
    },
    /** A request the page sent itself, before it is observed. */
    pageRequest(url: URL, method: string, body?: unknown) {
      if (url.origin === deps.origin) provider.learn?.(url, method, body);
    },
    /**
     * A history read the page made itself. It makes the tracker's read of that chat
     * unnecessary, and stops one that is running. A read the history reader turned away
     * unread (`unread`: its read slots were busy) did neither: it only means the next
     * request of the same shape is not a repeat of a refused one.
     */
    pageRead(url: URL, method: string, body?: unknown, unread = false) {
      if (url.origin !== deps.origin) return;
      provider.learn?.(url, method, body);
      const chat = provider.pageReadConversation
        ? provider.pageReadConversation(url, method, body)
        : deps.readConversation(url, method, body);
      if (!chat) return;
      lastRequests.delete(chat);
      if (unread) return;
      lastRequests.set(chat, { url, body });
      while (lastRequests.size > 64)
        lastRequests.delete(lastRequests.keys().next().value!);
      if (provider.pageReadCounts && !provider.pageReadCounts(url, body)) return;
      pageReads.delete(chat);
      pageReads.set(chat, now());
      while (pageReads.size > 64) pageReads.delete(pageReads.keys().next().value!);
      if (flight?.conversationId === chat) stop({ kind: "page_read" });
    },
    /**
     * The content script's private port (`OWN_READ_CHANNEL` with `connect`). Read requests
     * arrive only on it and are answered on the port each request carries, so a page script
     * listening to window messages never sees a request or holds a port to answer it. A
     * newer port replaces the old one (a content script started again).
     */
    connect(port: MessagePort) {
      if (link && link !== port) {
        link.onmessage = null;
        link.close();
      }
      link = port;
      port.onmessage = (event: MessageEvent) => {
        receive(event.data, event.ports ?? []);
      };
    },
    receive,
    /** The address changed; a read for a chat no longer shown is stopped. */
    routeChanged() {
      if (
        flight &&
        ownReadConversation(provider.site, deps.pathname()) !== flight.conversationId
      )
        stop({ kind: "navigated" });
    },
    cancel() {
      stop({ kind: "declined" });
    },
  };
}
