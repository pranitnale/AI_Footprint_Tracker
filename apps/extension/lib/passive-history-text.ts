import {
  HISTORY_LIMITS,
  NOTEBOOKLM_CHAT_RPC,
  parseHistoryText,
  geminiHistoryFrames,
} from "@footprint/adapters";
import {
  geminiRequestPath,
  parseConversationRoute,
  siteForHost,
} from "@footprint/capture-core";
import {
  HISTORY_CAPTURE_CHANNEL,
  HISTORY_DIAGNOSTIC_CHANNEL,
  type HistoryDiagnostic,
  type HistoryCaptureMessage,
} from "./history-capture";
import { HISTORY_WAITING_KINDS, installHistoryXHR } from "./history-xhr";
import { ClaudeHistoryStream } from "./claude-history-stream";
import { createClaudeResearchStatus } from "./claude-research-status";
import {
  CLAUDE_STREAM_CHANNEL,
  type ClaudeStreamCapture,
} from "./claude-history-message";
import {
  notebooklmRead,
  ProviderHistoryStream,
} from "./provider-history-stream";
import {
  PROVIDER_STREAM_CHANNEL,
  type ProviderStreamCapture,
} from "./provider-history-message";
import type {
  ComputerFileCounted,
  ComputerFileDeps,
} from "./computer-files";
import type { ComputerFileDownload } from "./own-read-page";
import type { XHRTextObserver } from "./xhr-text-stream";
import { createCoworkHistory } from "./cowork-history";
import {
  GEMINI_HISTORY_PATH,
  chatgptEarlierPage,
  createRouteWatch,
  geminiHistoryRpc,
  historyReadKind,
  historyRequestConversation,
  notebooklmChatSession,
  notebooklmHistoryRpc,
} from "./history-route";
import { createNotebooklmChatSessions } from "./notebooklm-chat-sessions";

// A provider can request a chat just before its address bar changes (measured
// 3-6 ms on Claude). Wait at most this long for the route to match; a read that
// never becomes current, such as a hover prefetch, emits nothing and uses no budget.
const PENDING_LIMIT = 4;
const PENDING_MAX_MS = 5000;
const PENDING_AFTER_RESPONSE_MS = 1000;
/** Reads of different kinds that may wait for a slot at once (W9: opened Studio items). */
const WAITING_LIMIT = HISTORY_WAITING_KINDS;

/**
 * Whether a read is a page of a notebook's saved chat. Each one that is passed by or fails
 * is reported as such, because a later Studio read of the notebook does not count its chat
 * (14 Oct 2026: a chat passed by unread left no reason in Details).
 */
const notebookChatRead = (site: HistoryDiagnostic["site"], kind: string) =>
  site === "notebooklm" && kind.split(":")[0] === NOTEBOOKLM_CHAT_RPC;

/** Observe one bounded clone of a host-issued response. No fetch, scroll or history navigation is initiated here. */
export function createHistoryTextObserver(
  emit: (message: HistoryCaptureMessage) => void,
  diagnostic: (message: HistoryDiagnostic) => void = () => {},
  sendClaudeBatch?: (
    message: ClaudeStreamCapture | ProviderStreamCapture,
    onProgress: () => void,
  ) => Promise<boolean>,
  /** The page sent a message in a Cowork session (W5). */
  coworkSent?: () => void,
  /** Saved ChatGPT answers' ids and characters, for read aloud (G1). */
  chatgptAnswer?: (ids: string[], characters: number) => void,
  /**
   * The page world's side of counting Perplexity Computer files (14 Oct 2026): the question
   * which files saved counts hold, and the read-only download of a file.
   */
  computerFiles?: {
    known(
      message: Extract<ProviderStreamCapture, { event: "files" }>,
    ): Promise<ReadonlyMap<string, ComputerFileCounted> | null>;
    download(link: string, bytes: number): Promise<ComputerFileDownload>;
  },
) {
  const cloneResponse = Response.prototype.clone;
  const getReader = ReadableStream.prototype.getReader;
  const read = ReadableStreamDefaultReader.prototype.read;
  const cancel = ReadableStreamDefaultReader.prototype.cancel;
  const cancelStream = ReadableStream.prototype.cancel;
  const active = new Map<string, { stop: () => void }>();
  const pending = new Map<
    string,
    { conversationId: string; drop: () => void }
  >();
  const routes = createRouteWatch();
  const research = createClaudeResearchStatus();
  const notebooklmChats = createNotebooklmChatSessions();
  let generation = 0;
  let xhr: ReturnType<typeof installHistoryXHR> | null = null;
  let recent: number[] = [];
  /**
   * The newest read of the open chat that waits for a free slot. A page polls its own chat
   * while a reply is made (images, research), and each response holds the whole saved
   * chat, so a newer poll replaces an older one that still waits, and none fails (X9).
   */
  const waiting = new Map<
    string,
    {
      conversationId: string;
      kind: string;
      start: () => void;
      drop: () => void;
    }
  >();
  let waitTimer: ReturnType<typeof setTimeout> | null = null;
  let lastLimit: {
    at: number;
    generation: number;
    site: HistoryDiagnostic["site"];
    conversationId: string;
  } | null = null;
  const report = (
    base: Pick<HistoryCaptureMessage, "site" | "conversationId" | "observedAt">,
    reason: HistoryDiagnostic["reason"],
    id: string | null,
  ) => {
    const route = parseConversationRoute(base.site, location.pathname);
    if (
      siteForHost(location.hostname) !== base.site ||
      route?.conversationId !== base.conversationId
    )
      return;
    if (reason === "history_limit") {
      const now = Date.now();
      // Coalescing belongs to this route and ownership lifecycle, not a previous view's failure.
      if (
        lastLimit &&
        lastLimit.generation === generation &&
        lastLimit.site === base.site &&
        lastLimit.conversationId === base.conversationId &&
        now >= lastLimit.at &&
        now - lastLimit.at < 10000
      )
        return;
      lastLimit = {
        at: now,
        generation,
        site: base.site,
        conversationId: base.conversationId,
      };
    }
    try {
      diagnostic({
        channel: HISTORY_DIAGNOSTIC_CHANNEL,
        site: base.site,
        conversationId: base.conversationId,
        observedAt: base.observedAt,
        id,
        reason,
      });
    } catch {}
  };
  const send = (message: HistoryCaptureMessage) => {
    try {
      emit(message);
    } catch {}
  };
  const cowork = createCoworkHistory(
    send,
    { cloneResponse, getReader, read, cancel, cancelStream },
    routes,
    coworkSent,
  );
  const observer = {
    observe(
      url: URL,
      method: string,
      promise: Promise<Response> | null,
      observedAt: number,
      body?: unknown,
      rejected?: "admission" | "metadata",
      /**
       * The response is already the reader's private clone: the page's fetch of a request
       * whose body is read after it was sent (`capture-runtime.ts`, 19 Oct 2026).
       */
      cloned = false,
    ) {
      const site = siteForHost(location.hostname);
      if (
        !site ||
        url.origin !== location.origin ||
        url.username ||
        url.password ||
        url.hash ||
        !Number.isFinite(observedAt)
      )
        return;
      // Cowork sessions have their own event reader (W5).
      if (site === "claude" && !rejected && cowork.observe(url, method, promise))
        return;
      // Research status polls are kept for the conversation reload that follows (E1).
      if (site === "claude" && !rejected && research.observe(url, method, promise))
        return;
      // A notebook's chat session list is kept for the pages of turns that follow; a list
      // the page could not hand over only leaves a first message unproven.
      if (
        site === "notebooklm" &&
        notebooklmChats.observe(url, method, rejected ? null : promise, body, cloned)
      )
        return rejected || !promise ? undefined : true;
      const route = parseConversationRoute(site, location.pathname);
      // A metadata-only rejection of a Google batch read has no body, so only the open chat
      // or notebook applies.
      const requested =
        rejected === "metadata" &&
        method === "POST" &&
        ((site === "gemini" &&
          geminiRequestPath(url.pathname) === GEMINI_HISTORY_PATH &&
          geminiHistoryRpc(url)) ||
          (site === "notebooklm" && notebooklmHistoryRpc(url)))
          ? (route?.conversationId ?? null)
          : historyRequestConversation(site, url, method, body);
      if (!requested) return;
      const kind = historyReadKind(site, url, body);
      if (route?.conversationId === requested)
        return begin(site, requested, url, promise, observedAt, rejected, cloned, kind);
      // Another chat is never reported; it can only become current by navigation.
      if (rejected || !promise) return;
      return pend(site, requested, url, promise, observedAt, kind, cloned);
    },
    rejected(
      url: URL,
      method: string,
      observedAt: number,
      body?: unknown,
      metadata = false,
    ) {
      observer.observe(
        url,
        method,
        null,
        observedAt,
        body,
        metadata ? "metadata" : "admission",
      );
    },
    installXHR(XHR: typeof XMLHttpRequest, stream?: XHRTextObserver) {
      xhr?.restore();
      xhr = installHistoryXHR(XHR, observer.observe, observer.rejected, stream);
    },
    uninstallXHR() {
      xhr?.restore();
      xhr = null;
    },
    xhrDirect: () => xhr?.direct() === true,
    /** A navigation reset keeps waiting reads for the chat now shown; every other cancel drops them. */
    cancel(keepCurrentRoute = false) {
      generation++;
      lastLimit = null;
      cowork.cancel(keepCurrentRoute);
      for (const value of active.values()) value.stop();
      const site = siteForHost(location.hostname);
      const current =
        keepCurrentRoute && site
          ? parseConversationRoute(site, location.pathname)
          : null;
      for (const item of [...pending.values()])
        if (item.conversationId !== current?.conversationId) item.drop();
      for (const item of [...waiting.values()])
        if (item.conversationId !== current?.conversationId) item.drop();
      xhr?.cancel();
      // An unsettled physical read retains its slot until its promise settles.
    },
  };
  /** Hold a clone of a read that the next navigation may make current. It emits nothing until then. */
  function pend(
    site: HistoryDiagnostic["site"],
    conversationId: string,
    url: URL,
    promise: Promise<Response>,
    observedAt: number,
    kind: string,
    cloned = false,
  ) {
    while (pending.size >= PENDING_LIMIT)
      pending.values().next().value!.drop();
    const key = crypto.randomUUID(),
      startedAt = Date.now();
    let settledAt: number | null = null;
    // Clone before the host's own reader can consume the body.
    const early = promise.then(
      (response) => {
        settledAt = Date.now();
        return cloned
          ? response
          : (Reflect.apply(cloneResponse, response, []) as Response);
      },
      (error) => {
        settledAt = Date.now();
        throw error;
      },
    );
    void early.catch(() => {});
    let unwatch = () => {};
    const release = () => {
      pending.delete(key);
      unwatch();
    };
    const drop = () => {
      release();
      // An unread clone buffers the whole response, so cancel it explicitly.
      void early.then(
        (clone) => {
          if (clone.body)
            void Reflect.apply(cancelStream, clone.body, []).catch(() => {});
        },
        () => {},
      );
    };
    const check = () => {
      if (!pending.has(key)) return;
      if (
        parseConversationRoute(site, location.pathname)?.conversationId ===
        conversationId
      ) {
        release();
        if (
          begin(site, conversationId, url, early, observedAt, undefined, true, kind) !==
          true
        )
          drop();
        return;
      }
      const deadline = Math.min(
        startedAt + PENDING_MAX_MS,
        (settledAt ?? startedAt + PENDING_MAX_MS) + PENDING_AFTER_RESPONSE_MS,
      );
      if (Date.now() >= deadline) drop();
    };
    pending.set(key, { conversationId, drop });
    unwatch = routes.watch(check);
    void early.then(check, check);
    return true;
  }
  /** Starts the waiting read once a slot and the rate window allow it. */
  function scheduleWaiting() {
    if (waitTimer !== null || !waiting.size) return;
    // The read that ends frees the slot and schedules again.
    if (active.size >= HISTORY_LIMITS.active) return;
    const now = Date.now();
    recent = recent.filter((at) => now - at < 10000);
    const wait = recent.length >= 8 ? 10000 - (now - recent[0]!) + 1 : 0;
    waitTimer = setTimeout(() => {
      waitTimer = null;
      for (const item of [...waiting.values()]) {
        if (active.size >= HISTORY_LIMITS.active) break;
        item.start();
      }
      scheduleWaiting();
    }, wait);
  }
  /** Keeps a private clone of a read of the open chat until a slot is free. */
  function wait(
    site: HistoryDiagnostic["site"],
    conversationId: string,
    url: URL,
    promise: Promise<Response>,
    observedAt: number,
    cloned: boolean,
    kind: string,
  ) {
    // Reads of one kind hold the same saved state, so the newest replaces an older one;
    // NotebookLM's Studio list and each opened item are different kinds (W9).
    const key = site + ":" + conversationId + (kind ? ":" + kind : "");
    waiting.get(key)?.drop();
    // Each waiting read holds a whole response. Past this many kinds the oldest is dropped
    // and reported, so a lost read is never silent.
    while (waiting.size >= WAITING_LIMIT) {
      const oldest = waiting.values().next().value!;
      oldest.drop();
      report(
        {
          site,
          conversationId: oldest.conversationId,
          observedAt: new Date(observedAt).toISOString(),
        },
        notebookChatRead(site, oldest.kind)
          ? "notebooklm_chat_busy"
          : "history_limit",
        null,
      );
    }
    // Clone before the host's own reader can consume the body.
    const early = cloned
      ? promise
      : promise.then(
          (response) => Reflect.apply(cloneResponse, response, []) as Response,
        );
    void early.catch(() => {});
    const item = {
      conversationId,
      kind,
      drop: () => {
        if (waiting.get(key) === item) waiting.delete(key);
        // An unread clone buffers the whole response, so cancel it explicitly.
        void early.then(
          (clone) => {
            if (clone.body)
              void Reflect.apply(cancelStream, clone.body, []).catch(() => {});
          },
          () => {},
        );
      },
      start: () => {
        if (waiting.get(key) !== item) return;
        waiting.delete(key);
        // Only the chat still shown is read, as for a read held during navigation.
        if (
          parseConversationRoute(site, location.pathname)?.conversationId !==
            conversationId ||
          begin(site, conversationId, url, early, observedAt, undefined, true, kind) !==
            true
        )
          item.drop();
      },
    };
    waiting.set(key, item);
    scheduleWaiting();
  }
  function begin(
    site: HistoryDiagnostic["site"],
    conversationId: string,
    url: URL,
    promise: Promise<Response> | null,
    observedAt: number,
    rejected?: "admission" | "metadata",
    cloned = false,
    kind = "",
  ): true | undefined {
    {
      const now = Date.now();
      recent = recent.filter((at) => now - at < 10000);
      const id = crypto.randomUUID(),
        epoch = generation;
      let state: {
        base: Omit<HistoryCaptureMessage, "event" | "page">;
        pathname: string;
        expectedUrl: string;
      } | null = {
        base: {
          channel: HISTORY_CAPTURE_CHANNEL,
          id,
          site,
          conversationId,
          observedAt: new Date(observedAt).toISOString(),
        },
        pathname: location.pathname,
        expectedUrl: url.href,
      };
      if (
        rejected ||
        active.size >= HISTORY_LIMITS.active ||
        recent.length >= 8
      ) {
        // The newest read of the open chat waits; it holds one clone and no queued text work.
        if (!rejected && promise) {
          wait(site, conversationId, url, promise, observedAt, cloned, kind);
          return true;
        }
        report(
          state.base,
          notebookChatRead(site, kind) ? "notebooklm_chat_busy" : "history_limit",
          null,
        );
        return;
      }
      if (!promise) return;
      recent.push(now);
      // A page of saved NotebookLM turns is read with its session and, when it finishes,
      // the notebook's session list as the page last read it.
      const chatSession =
        site === "notebooklm" ? notebooklmChatSession(kind) : null;
      const notebooklmChat = chatSession
        ? () => ({
            session: chatSession,
            sessions: notebooklmChats.sessions(conversationId),
          })
        : undefined;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
        stopped = false;
      let deadline = now + HISTORY_LIMITS.lifetimeMs;
      // The read belongs to its chat, not to one spelling of the chat's address: a ChatGPT
      // project chat opened by full load moves from /g/g-p-<id>/c/<chat> to the project's
      // named address while its saved messages load (live QA, 19 Oct 2026). A move to another
      // chat still ends the read, and so does the content script's reset (generation).
      const current = () =>
        !stopped &&
        state !== null &&
        epoch === generation &&
        (location.pathname === state.pathname ||
          parseConversationRoute(site, location.pathname)?.conversationId ===
            conversationId);
      const valid = () => {
        if (!current()) return false;
        if (Date.now() >= deadline) {
          timeout();
          return false;
        }
        return true;
      };
      const stop = () => {
        stopped = true;
        state = null;
        if (reader) void Reflect.apply(cancel, reader, []).catch(() => {});
      };
      active.set(id, { stop });
      const chatRead = notebookChatRead(site, kind);
      const timeout = () => {
        if (current()) {
          report(state!.base, "history_timeout", id);
          if (chatRead) report(state!.base, "notebooklm_chat_timeout", null);
        }
        stop();
      };
      let timer = setTimeout(timeout, HISTORY_LIMITS.lifetimeMs);
      const renew = () => {
        if (!sendClaudeBatch) return;
        deadline = Date.now() + HISTORY_LIMITS.lifetimeMs;
        clearTimeout(timer);
        timer = setTimeout(timeout, HISTORY_LIMITS.lifetimeMs);
      };
      send({ ...state.base, event: "start", page: null });
      // A read held while the route caught up is already a private clone.
      let unread: ReadableStream<Uint8Array> | null = null;
      void promise
        .then(async (response) => {
          if (cloned) unread = response.body;
          if (!valid()) return;
          if (
            !response.ok ||
            !response.body ||
            (response.url && new URL(response.url).href !== state!.expectedUrl)
          )
            throw new Error("history_unsupported");
          const clone = cloned
            ? response
            : Reflect.apply(cloneResponse, response, []);
          unread = null;
          reader = Reflect.apply(
            getReader,
            clone.body!,
            [],
          ) as ReadableStreamDefaultReader<Uint8Array>;
          if (site === "claude" && sendClaudeBatch) {
            const base = state!.base;
            let lastAccepted = Date.now();
            const send = async (
              detail: Pick<
                ClaudeStreamCapture,
                "event" | "rows" | "leafId" | "rowCount" | "model"
              >,
            ) => {
              if (!valid()) throw new Error("history_cancelled");
              const accepted = await sendClaudeBatch(
                {
                  channel: CLAUDE_STREAM_CHANNEL,
                  id: base.id,
                  site: "claude",
                  conversationId: base.conversationId,
                  observedAt: base.observedAt,
                  ...detail,
                } as ClaudeStreamCapture,
                renew,
              );
              if (!accepted || !valid()) throw new Error("history_unavailable");
              lastAccepted = Date.now();
              renew();
            };
            const parser = new ClaudeHistoryStream(
              (rows) =>
                send({
                  event: "batch",
                  rows,
                  leafId: null,
                  rowCount: null,
                  model: null,
                }),
              research.tasks(base.conversationId),
            );
            for (;;) {
              if (!valid()) return;
              const part = await Reflect.apply(read, reader, []);
              if (!valid()) return;
              if (part.done) {
                const { leafId, rowCount, model } = await parser.finish(
                  base.conversationId,
                );
                await send({
                  event: "finish",
                  rows: null,
                  leafId,
                  rowCount,
                  model,
                });
                return;
              }
              if (!(part.value instanceof Uint8Array))
                throw new Error("history_unsupported");
              renew();
              await parser.write(part.value);
              renew();
              if (Date.now() - lastAccepted >= 10000)
                await send({
                  event: "progress",
                  rows: null,
                  leafId: null,
                  rowCount: null,
                  model: null,
                });
            }
          }
          if (site && site !== "claude" && sendClaudeBatch) {
            const base = state!.base;
            let lastAccepted = Date.now();
            const send = async (detail: Pick<ProviderStreamCapture, "event" | "rows" | "meta">) => {
              if (!valid()) throw new Error("history_cancelled");
              const accepted = await sendClaudeBatch(
                {
                  channel: PROVIDER_STREAM_CHANNEL,
                  id: base.id,
                  site,
                  conversationId: base.conversationId,
                  observedAt: base.observedAt,
                  ...detail,
                } as ProviderStreamCapture,
                renew,
              );
              if (!accepted || !valid()) throw new Error("history_unavailable");
              lastAccepted = Date.now();
              renew();
            };
            const files: ComputerFileDeps | undefined =
              site === "perplexity" && computerFiles
                ? {
                    known: async (list) => {
                      if (!valid()) throw new Error("history_cancelled");
                      const answer = await computerFiles.known({
                        channel: PROVIDER_STREAM_CHANNEL,
                        id: base.id,
                        site,
                        conversationId: base.conversationId,
                        observedAt: base.observedAt,
                        event: "files",
                        rows: null,
                        meta: null,
                        files: list,
                      });
                      if (!valid()) throw new Error("history_cancelled");
                      renew();
                      return answer;
                    },
                    download: (link, bytes) => computerFiles.download(link, bytes),
                    pause: (ms) =>
                      new Promise<boolean>((resolve) =>
                        setTimeout(() => resolve(valid()), ms),
                      ),
                    progress: () =>
                      send({ event: "progress", rows: null, meta: null }),
                  }
                : undefined;
            const parser = new ProviderHistoryStream(
              site,
              base.conversationId,
              base.observedAt,
              (rows) => send({ event: "batch", rows, meta: null }),
              site === "chatgpt" ? chatgptAnswer : undefined,
              site === "chatgpt" && chatgptEarlierPage(url),
              notebooklmChat,
              files,
            );
            for (;;) {
              if (!valid()) return;
              const part = await Reflect.apply(read, reader, []);
              if (!valid()) return;
              if (part.done) {
                const meta = await parser.finish();
                await send({ event: "finish", rows: null, meta });
                return;
              }
              if (!(part.value instanceof Uint8Array))
                throw new Error("history_unsupported");
              renew();
              await parser.write(part.value);
              renew();
              if (Date.now() - lastAccepted >= 10000)
                await send({ event: "progress", rows: null, meta: null });
            }
          }
          const responseLimit =
            site === "claude" ? Infinity : HISTORY_LIMITS.responseBytes;
          let buffer = new Uint8Array(Math.min(65536, responseLimit));
          let size = 0;
          for (let reads = 0; reads < HISTORY_LIMITS.readCalls; reads++) {
            if (!valid()) return;
            if (reads && reads % 64 === 0)
              await new Promise<void>((resolve) => setTimeout(resolve, 0));
            if (!valid()) return;
            const part = await Reflect.apply(read, reader!, []);
            if (!valid()) return;
            if (part.done) {
              const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
                buffer.subarray(0, size),
              );
              const payload = site === "gemini"
                ? geminiHistoryFrames(decoded)
                : site === "notebooklm"
                  ? notebooklmRead(decoded, notebooklmChat)
                  : JSON.parse(decoded);
              const page = parseHistoryText(
                site,
                payload,
                state!.base.conversationId,
                state!.base.observedAt,
                (reason) => {
                  if (
                    reason === "history_text_limit" ||
                    reason === "history_message_limit"
                  )
                    report(state!.base, reason, null);
                },
                site === "claude"
                  ? research.tasks(state!.base.conversationId)
                  : [],
                site === "chatgpt" && chatgptEarlierPage(url),
              );
              if (valid()) send({ ...state!.base, event: "page", page });
              return;
            }
            if (!(part.value instanceof Uint8Array))
              throw new Error("history_unsupported");
            if (part.value.length > responseLimit - size)
              throw new Error("history_response_limit");
            if (part.value.length > buffer.length - size) {
              const next = new Uint8Array(
                Math.min(
                  responseLimit,
                  Math.max(buffer.length * 2, size + part.value.length),
                ),
              );
              next.set(buffer.subarray(0, size));
              buffer = next;
            }
            buffer.set(part.value, size);
            size += part.value.length;
          }
          throw new Error("history_limit");
        })
        .catch((error) => {
          if (error instanceof Error && error.message === "history_timeout") {
            timeout();
            return;
          }
          if (
            error instanceof Error &&
            error.message === "history_response_limit" &&
            valid()
          )
            report(state!.base, "history_response_limit", null);
          if (chatRead && valid())
            report(state!.base, "notebooklm_chat_unread", null);
          if (valid())
            send({
              ...state!.base,
              event: "page",
              page: parseHistoryText(
                site,
                null,
                state!.base.conversationId,
                state!.base.observedAt,
              ),
            });
        })
        .finally(() => {
          clearTimeout(timer);
          stop();
          active.delete(id);
          if (unread)
            void Reflect.apply(cancelStream, unread, []).catch(() => {});
          scheduleWaiting();
        });
      return true;
    }
  }
  return observer;
}
