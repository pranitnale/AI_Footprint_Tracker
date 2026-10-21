import {
  chatgptSignedOutStopConversation,
  claudeProxyDispatch,
  isChatgptSignedOutSend,
  isChatgptSignedOutStop,
  isClaudeProxy,
  PACKAGED_PROVIDER_ADAPTERS,
  type ProviderAdapterRegistry,
  type ProtocolSession,
  type Dispatch,
  type Snapshot,
} from "@footprint/adapters";
import {
  siteForHost,
  SseDecoder,
  GeminiDecoder,
  JsonLinesDecoder,
  JSON_LINE_LIMITS,
  safeJson,
  CaptureError,
  LIMITS,
  CAPTURE_TIMES,
  parseConversationRoute,
  isRouteConversationId,
  isProvisionalChatgptRoute,
  LiveRequestTimer,
  geminiRequestPath,
  GEMINI_STREAM_PATH,
} from "@footprint/capture-core";
import { CHANNEL, validateCapture, type CaptureMessage } from "./bridge";
import { createThreadHistoryObserver } from "./passive-thread-history";
import { createHistoryTextObserver } from "./passive-history-text";
import type { ClaudeStreamCapture } from "./claude-history-message";
import {
  validComputerFilesAnswer,
  type ProviderStreamCapture,
} from "./provider-history-message";
import { HISTORY_RESET_CHANNEL } from "./history-capture";
import {
  COWORK_SENT_CHANNEL,
  type CaptureInterception,
  type CaptureReady,
  type CoworkSent,
} from "./capture-watchdog";
import { XHRAbortError, type XHRTextObserver } from "./xhr-text-stream";
import { ProviderUploadObserver } from "./upload-observer";
import { uploadBodyReader } from "./upload-body";
import { FetchCoverageCheck } from "./capture-coverage";
import { createGeminiChannel } from "./gemini-channel";
import { installOwnRead } from "./own-read-runtime";
import { isOwnReadConnect } from "./own-read";
import {
  validFileUploadReset,
  validFileUploadPromote,
} from "./file-relay-protocol";

/**
 * How long a failed Claude read waits for the page's stop request. claude.ai aborts the
 * reply stream when the user presses stop and may send `stop_response` just after (N11).
 */
const CLAUDE_STOP_GRACE_MS = 2000;
/** How long a failed Claude read waits for the provider's answer to a stop request. */
const CLAUDE_STOP_ANSWER_MS = 10000;

/**
 * ChatGPT's Stop control: `button[aria-label="Stop"]` while a reply is sent or written (live,
 * 20 Oct 2026), and the labels the content script's activity check already knows.
 */
const CHATGPT_STOP_CONTROL =
  'button[aria-label="Stop"],[data-testid="stop-button"],button[aria-label="Stop generating"],button[aria-label="Stop response"]';
/**
 * How long after a Stop click the page's cancelled send still counts as stopped. Live the send
 * failed 0.15 s after the click (20 Oct 2026).
 */
const CHATGPT_STOP_CLICK_MS = 2000;

/** Only failed native reads may follow a successful provider terminal without a capture diagnostic. */
class TransportReadError extends Error {
  constructor(cause: unknown) {
    super("capture_transport_interrupted", { cause });
  }
}

export function installCapture(
  providers: ProviderAdapterRegistry = PACKAGED_PROVIDER_ADAPTERS,
) {
  const site = siteForHost(location.hostname);
  if (!site) return;
  const adapter = providers.get(site);
  if (!adapter || adapter.site !== site) return;
  // Gemini and NotebookLM stream over XMLHttpRequest with Google's batch framing.
  const googleFramed = adapter.responseFormat === "gemini";
  /**
   * A send's dispatch. NotebookLM's body names only the chat session, so its notebook is
   * the page's route when the request is sent (W9).
   */
  const dispatchFor = (url: URL, body: string): Dispatch => {
    const dispatch = adapter.parseDispatch(url, body);
    if (site === "notebooklm")
      dispatch.conversationId =
        parseConversationRoute(site, location.pathname)?.conversationId ??
        null;
    return dispatch;
  };
  const nativeBody = uploadBodyReader();
  const nativeCloneRequest = Request.prototype.clone;
  const nativeCloneResponse = Response.prototype.clone;
  const nativeCancelStream = ReadableStream.prototype.cancel;
  const uploads =
    site === "chatgpt" || site === "perplexity"
      ? new ProviderUploadObserver(site, location.origin, (value) =>
          window.postMessage(value, location.origin),
        )
      : null;
  uploads?.installXHR(window.XMLHttpRequest);
  const uploadIdentities = new Map<string, { id: string; expires: number }>();
  const sweepUploads = () => {
    uploads?.maintain();
    for (const [key, value] of uploadIdentities)
      if (value.expires <= Date.now()) uploadIdentities.delete(key);
  };
  const active = new Map<
    string,
    {
      session: ProtocolSession;
      dispatch: Dispatch | null;
      revision: number;
      last: number;
      at: string;
      reader?: ReadableStreamDefaultReader<Uint8Array>;
      stopXHR?: () => void;
      /**
       * The page asked the provider to stop this reply; "confirmed" once the provider
       * accepted it. A refused stop clears the mark.
       */
      stop?: "requested" | "confirmed";
      /**
       * The page stops this reply with a request of its own and then aborts its body:
       * claude.ai's stop_response (N11) and signed-out ChatGPT's stop_conversation (20 Oct
       * 2026). A failed read then waits for that request and its answer.
       */
      stopByRequest?: boolean;
      /** A failed read waiting for a possible stop request (N11). */
      stopGrace?: { timer: ReturnType<typeof setTimeout>; finish: () => void };
      bytes: number;
      /** When data for this capture last arrived, for the inactivity limit (X6). */
      dataAt: number;
      /** The last snapshot sent, which an end frame falls back to (X8). */
      sent?: Snapshot;
      completedAt?: number;
      completedPublished?: boolean;
      timing: LiveRequestTimer;
      /** The person's Stop clicks counted before this request was sent (ChatGPT). */
      stopClicksBefore?: number;
    }
  >();
  // Trusted clicks on ChatGPT's Stop control, the only proof of a Stop that ChatGPT has not
  // answered yet: the page then cancels its send and sends nothing else (live, 20 Oct 2026).
  // A page cannot fake isTrusted, and only the count and time are kept.
  let stopClicks = 0;
  let stopClickAt = 0;
  if (site === "chatgpt")
    window.addEventListener(
      "click",
      (event) => {
        if (!event.isTrusted) return;
        const target = event.target as { closest?: (selector: string) => unknown } | null;
        if (typeof target?.closest !== "function" || !target.closest(CHATGPT_STOP_CONTROL))
          return;
        stopClicks++;
        stopClickAt = Date.now();
      },
      true,
    );
  let enabled = true;
  let permissionStopped = false;
  let forwardingFetch: { url: string; body: string } | null = null;
  // The content script's latest probe nonce, which its Cowork send signal must carry.
  let probeNonce: string | null = null;
  let socketProxy: typeof WebSocket | null = null;
  const rawFetch = window.fetch;
  // fetch resolves relative addresses against the document's base address, which a <base>
  // element can change. The getter is taken now so a page override never runs.
  const baseURI =
    typeof Node === "undefined"
      ? undefined
      : Object.getOwnPropertyDescriptor(Node.prototype, "baseURI")?.get;
  const documentBase = () => {
    try {
      if (baseURI && typeof document !== "undefined")
        return Reflect.apply(baseURI, document, []) as string;
    } catch {}
    return location.href;
  };
  // Generation requests checked against the browser's timing list (12 October 2026).
  const coverage = new FetchCoverageCheck(
    location.origin,
    (url) =>
      adapter.generationRoute(url, "POST") ||
      adapter.generationRoute(url, "GET"),
  );
  const rawWebSocket = window.WebSocket;
  const history = createThreadHistoryObserver((message) =>
    window.postMessage(message, location.origin),
  );
  // Characters of ChatGPT answers this page showed, by message id, for read aloud whose
  // audio cannot be timed (owner, 3 Oct). Counts only; no text is kept.
  const answerCharacters = new Map<string, number>();
  const rememberAnswer = (
    ids: readonly (string | null | undefined)[],
    characters: number,
  ) => {
    if (!Number.isSafeInteger(characters) || characters <= 0) return;
    for (const id of ids) {
      if (!id) continue;
      answerCharacters.delete(id);
      answerCharacters.set(id, characters);
      if (answerCharacters.size > 512)
        answerCharacters.delete(answerCharacters.keys().next().value!);
    }
  };
  const historyText = createHistoryTextObserver(
    (message) => window.postMessage(message, location.origin),
    (message) => window.postMessage(message, location.origin),
    (message: ClaudeStreamCapture | ProviderStreamCapture, onProgress: () => void) =>
      new Promise<boolean>((resolve) => {
        const channel = new MessageChannel();
        let timer: ReturnType<typeof setTimeout> | null = null;
        const renew = () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            channel.port1.close();
            resolve(false);
          }, 30000);
        };
        renew();
        channel.port1.onmessage = (event) => {
          if (event.data?.pending === true) {
            onProgress();
            renew();
            return;
          }
          if (timer) clearTimeout(timer);
          channel.port1.close();
          resolve(event.data?.accepted === true);
        };
        try {
          window.postMessage(message, location.origin, [channel.port2]);
        } catch {
          if (timer) clearTimeout(timer);
          channel.port1.close();
          channel.port2.close();
          resolve(false);
        }
      }),
    () => {
      if (!probeNonce || !enabled) return;
      window.postMessage(
        {
          channel: COWORK_SENT_CHANNEL,
          nonce: probeNonce,
          at: new Date().toISOString(),
        } satisfies CoworkSent,
        location.origin,
      );
    },
    site === "chatgpt" ? rememberAnswer : undefined,
    site === "perplexity"
      ? {
          // Asked on the read's own channel, so the content script answers it in order
          // with the read's batches; an unanswered question downloads nothing.
          known: (message) =>
            new Promise((resolve) => {
              const channel = new MessageChannel();
              const timer = setTimeout(() => {
                channel.port1.close();
                resolve(null);
              }, 30000);
              channel.port1.onmessage = (event) => {
                if (event.data?.pending === true) return;
                clearTimeout(timer);
                channel.port1.close();
                resolve(
                  event.data?.accepted === true &&
                    validComputerFilesAnswer(event.data.known)
                    ? new Map(
                        event.data.known.map(
                          (item: { id: string; counted: "content" | "size" }) =>
                            [item.id, item.counted] as const,
                        ),
                      )
                    : null,
                );
              };
              try {
                window.postMessage(message, location.origin, [channel.port2]);
              } catch {
                clearTimeout(timer);
                channel.port1.close();
                channel.port2.close();
                resolve(null);
              }
            }),
          download: (link, bytes) =>
            ownRead
              ? ownRead.fetchFile(link, bytes)
              : Promise.resolve({ kind: "held" as const }),
        }
      : undefined,
  );
  const failures = new Set<string>();
  function health(failure: string) {
    if (failures.has(failure)) return;
    failures.add(failure);
    window.postMessage(
      {
        channel: CHANNEL,
        version: 1,
        id: crypto.randomUUID(),
        revision: 1,
        event: "health",
        site: site!,
        at: new Date().toISOString(),
        dispatch: null,
        snapshot: null,
        failure,
        timing: null,
      } satisfies CaptureMessage,
      location.origin,
    );
  }
  function emit(
    id: string,
    event: CaptureMessage["event"],
    failure: string | null = null,
  ) {
    const item = active.get(id);
    if (!item || !item.dispatch) return false;
    const dispatch = item.dispatch;
    const post = (read: Snapshot, failure: string | null) => {
      let snapshot = read;
      if (event === "end" && snapshot.state === "generating")
        snapshot = {
          ...snapshot,
          state: "interrupted_unconfirmed",
          imageOperations: snapshot.imageOperations.map((op) =>
            op.state === "generating"
              ? { ...op, state: "interrupted_unconfirmed" as const }
              : op,
          ),
        };
      const observation = {
        channel: CHANNEL,
        version: 1 as const,
        id,
        revision: ++item.revision,
        event,
        site: site!,
        at: item.at,
        dispatch: event === "dispatch" ? dispatch : null,
        snapshot,
        timing: snapshot.state === "completed" ? item.timing.evidence() : null,
        failure,
      } satisfies CaptureMessage;
      if (!validateCapture(observation, location.hostname))
        throw new CaptureError("unsupported_schema");
      window.postMessage(observation, location.origin);
      item.sent = read;
      return snapshot;
    };
    let sent = false;
    try {
      const snapshot = post(item.session.snapshot(), failure);
      sent = true;
      // A turn of several answers joins their text, so only a one-answer turn gives its
      // answer's length; saved history gives each answer its own (G1).
      if (
        site === "chatgpt" &&
        snapshot.text &&
        snapshot.outputId &&
        snapshot.attemptId === snapshot.outputId
      )
        rememberAnswer([snapshot.outputId], snapshot.text.length);
      const identity = snapshot.conversationId ?? dispatch.conversationId;
      if (uploads && identity && isRouteConversationId(site!, identity)) {
        if (uploadIdentities.size < 16 || uploadIdentities.has(id))
          uploadIdentities.set(id, {
            id: identity,
            expires: Date.now() + 300000,
          });
      }
    } catch (error) {
      const code =
        error instanceof CaptureError ? error.code : "unsupported_schema";
      health(code);
      // An end still reaches the ledger (X8): the last snapshot sent, with the failure, so
      // the reply is not left generating until the worker next starts.
      if (!sent && event === "end" && item.sent)
        try {
          post(item.sent, failure ?? code);
          sent = true;
        } catch {
          // The failure is reported above; the ledger's recovery ends the reply later.
        }
    }
    item.last = Date.now();
    return sent;
  }
  /**
   * Frees a slot for a new capture when all are taken (X7): the oldest verified-complete
   * capture first, then the oldest whose completed reply was already published. Both have
   * recorded their outcome, so retiring them changes no record.
   */
  function makeRoom(): boolean {
    if (active.size < LIMITS.sessions) return true;
    const finished = [...active]
      .filter(([, item]) => item.completedAt || item.completedPublished)
      .sort(
        ([, a], [, b]) =>
          Number(!a.completedAt) - Number(!b.completedAt) ||
          (a.completedAt ?? a.last) - (b.completedAt ?? b.last),
      )[0];
    if (finished) active.delete(finished[0]);
    return active.size < LIMITS.sessions;
  }
  /**
   * The page cancelled a new ChatGPT chat's send after the person clicked Stop: the read
   * failed as an abort, the reply has no socket topic yet, and a trusted Stop click came after
   * the send began and at most CHATGPT_STOP_CLICK_MS before. A lost connection fails with a
   * TypeError, and a page that leaves or aborts for its own reasons shows no such click.
   * Signed-out sends prove their Stop with stop_conversation instead (stopByRequest).
   */
  function stoppedBeforeTopic(
    item: NonNullable<ReturnType<typeof active.get>>,
    error: unknown,
  ) {
    if (site !== "chatgpt" || item.stopByRequest || item.stopClicksBefore === undefined)
      return false;
    const cause = error instanceof TransportReadError ? error.cause : error;
    if ((cause as { name?: unknown } | null)?.name !== "AbortError") return false;
    if (item.dispatch && item.dispatch.conversationId !== null) return false;
    try {
      if (item.session.snapshot().topic) return false;
    } catch {
      return false;
    }
    return (
      stopClicks > item.stopClicksBefore &&
      Date.now() - stopClickAt <= CHATGPT_STOP_CLICK_MS
    );
  }
  function fail(
    id: string,
    error: unknown,
    origin: "capture" | "lifecycle" = "capture",
    graceDone = false,
  ) {
    const item = active.get(id);
    if (!item) return;
    if (item.stopGrace && !graceDone) {
      // The page is going away or the capture ran out of time: the reply ends now with
      // what is known about the stop, as it would when the wait ends (W10 review).
      if (origin === "lifecycle") item.stopGrace.finish();
      return;
    }
    let completed = false;
    try {
      completed = item.session.completionVerified?.() === true;
    } catch {
      // Invalid protocol state must not prevent failure publication and reader cleanup.
    }
    // A reply the provider marked finished was already published as completed; only its
    // stream terminal is missing, which leaves its timing unknown. Running out of time or
    // leaving the page then retires it without a failure (X7).
    if (origin === "lifecycle" && !completed && item.completedPublished) {
      void item.reader?.cancel().catch(() => {});
      item.stopXHR?.();
      active.delete(id);
      return;
    }
    // A Stop in a new ChatGPT chat before the stream named its socket topic (live, 20 Oct
    // 2026): the page cancels its send, often before ChatGPT answered it, and sends no stop
    // request and no unsubscribe, so only the person's click on Stop just before proves it.
    // Like a turn stopped while thinking, it ends cancelled with nothing written (output 0).
    if (origin === "capture" && !completed && stoppedBeforeTopic(item, error)) {
      // The send itself is still being read; its dispatch comes first and ends it here again.
      if (!item.dispatch) return;
      try {
        if (item.session.stoppedBeforeAnswer) item.session.stoppedBeforeAnswer();
        else item.session.stopped();
      } catch {
        // A broken session still releases its slot below.
      }
      emit(id, "end");
      void item.reader?.cancel().catch(() => {});
      active.delete(id);
      return;
    }
    // A provider job that runs apart from the stream is read from the saved reply later,
    // so a capture that stops waiting for its end has not failed (W10). The page also
    // aborts a stream it has read to its end once the job runs (5 Oct 2026).
    let waiting = false;
    try {
      waiting =
        (origin === "lifecycle" || error instanceof TransportReadError) &&
        item.session.awaitingAsync?.() === true;
    } catch {
      // A broken session ends with its failure below.
    }
    // Stopping read aloud ends its audio early; the speech received until then was made, and
    // nothing failed (G1). A stop before the audio starts aborts the request itself, so its
    // error is not a read error. A lost connection rejects with a TypeError instead: that
    // read failed, so it keeps the speech received and reports the interruption.
    const cause = error instanceof TransportReadError ? error.cause : error;
    if (
      item.session.bytes &&
      item.dispatch &&
      origin === "capture" &&
      !(cause instanceof TypeError) &&
      (error instanceof TransportReadError ||
        (error instanceof Error && error.name === "AbortError"))
    ) {
      try {
        item.session.stopped();
      } catch {
        // A broken session still releases its slot below.
      }
      emit(id, "end");
      void item.reader?.cancel().catch(() => {});
      active.delete(id);
      return;
    }
    // Gemini's page aborts a request it no longer needs; the user's stop ends the request
    // normally instead (16 Sep). NotebookLM's requests use the same transport. Either way
    // the text received was made, and nothing failed, so the reply ends as cancelled.
    if (
      googleFramed &&
      item.dispatch &&
      origin === "capture" &&
      cause instanceof XHRAbortError
    ) {
      try {
        item.session.stopped();
      } catch {
        // A broken session still releases its slot below.
      }
      emit(id, "end");
      active.delete(id);
      return;
    }
    // The user's stop aborts an unfinished stream before or just after the stop request;
    // the reply then ended by the user's choice, and nothing failed (N11). A failed read
    // waits for the stop request and then for the provider's answer: a refused stop leaves
    // the failure in place, and a stop that was never answered keeps the user's choice.
    if (
      item.stopByRequest &&
      item.dispatch &&
      !completed &&
      error instanceof TransportReadError &&
      origin === "capture"
    ) {
      if (!graceDone && item.stop !== "confirmed") {
        const finish = () => {
          clearTimeout(item.stopGrace?.timer);
          fail(id, error, origin, true);
        };
        item.stopGrace = {
          timer: setTimeout(
            finish,
            item.stop === "requested"
              ? CLAUDE_STOP_ANSWER_MS
              : CLAUDE_STOP_GRACE_MS,
          ),
          finish,
        };
        return;
      }
      if (item.stop) {
        try {
          item.session.stopped();
        } catch {
          // A broken session still releases its slot below.
        }
        emit(id, "end");
        void item.reader?.cancel().catch(() => {});
        active.delete(id);
        return;
      }
    }
    if (item.dispatch)
      emit(
        id,
        "end",
        (completed &&
          (error instanceof TransportReadError || origin === "lifecycle")) ||
          waiting
          ? null
          : error instanceof CaptureError
            ? error.code
            : "capture_interrupted",
      );
    else
      health(
        error instanceof CaptureError ? error.code : "capture_interrupted",
      );
    void item.reader?.cancel().catch(() => {});
    item.stopXHR?.();
    active.delete(id);
  }
  const liveXHR: XHRTextObserver | undefined = googleFramed
    ? {
          matches: (url, method) =>
            enabled &&
            method === "POST" &&
            (site !== "gemini" ||
              geminiRequestPath(url.pathname) === GEMINI_STREAM_PATH) &&
            adapter.generationRoute(url, method),
          rejected: (error) =>
            health(
              error instanceof CaptureError
                ? error.code
                : "capture_interrupted",
            ),
          start(url, body, dispatchedAt, stop) {
            // A page fetch shim can synchronously delegate to XHR. Its fetch clone already owns that observation.
            if (
              !enabled ||
              (forwardingFetch?.url === url.href &&
                forwardingFetch.body === body)
            )
              return null;
            if (!makeRoom()) {
              health("buffer_overflow");
              return null;
            }
            const id = crypto.randomUUID();
            const item = {
              session: adapter.createSession(url),
              dispatch: null as Dispatch | null,
              revision: 0,
              last: 0,
              at: new Date().toISOString(),
              bytes: 0,
              dataAt: Date.now(),
              timing: new LiveRequestTimer(dispatchedAt),
              stopXHR: stop,
            };
            active.set(id, item);
            try {
              if (typeof body !== "string")
                throw new CaptureError("missing_body");
              if (body.length > LIMITS.frame)
                throw new CaptureError("buffer_overflow");
              item.dispatch = dispatchFor(url, body);
              if (!emit(id, "dispatch")) {
                active.delete(id);
                return null;
              }
            } catch (error) {
              item.dispatch = {
                site: site!,
                action: "send",
                input: null,
                conversationId: null,
                parentId: null,
                requestId: null,
                model: null,
                attachments: null,
                imageEditParentId: null,
              };
              emit(
                id,
                "dispatch",
                error instanceof CaptureError
                  ? error.code
                  : "unsupported_schema",
              );
              fail(id, error);
              return null;
            }
            let receivedAt = dispatchedAt;
            const decoder = new GeminiDecoder((value) => {
              item.session.gemini?.(value);
              item.timing.observe(
                item.session.completionVerified?.() === true,
                receivedAt,
              );
            });
            return {
              push(bytes, at) {
                if (!active.has(id)) return;
                receivedAt = at;
                item.dataAt = Date.now();
                item.bytes += bytes.length;
                if (
                  item.bytes > LIMITS.stream ||
                  [...active.values()].reduce(
                    (sum, entry) => sum + entry.bytes,
                    0,
                  ) > LIMITS.global
                )
                  throw new CaptureError("buffer_overflow");
                decoder.push(bytes);
                if (Date.now() - item.last > 750) emit(id, "progress");
              },
              finish(at) {
                if (!active.has(id)) return;
                receivedAt = at;
                decoder.finish();
                // The request ended normally, which completes a Gemini reply (M2).
                item.session.responseEnded?.();
                item.timing.observe(
                  item.session.completionVerified?.() === true,
                  at,
                );
                emit(id, "end");
                active.delete(id);
              },
              fail(error, origin) {
                fail(
                  id,
                  origin === "transport"
                    ? new TransportReadError(error)
                    : error,
                  origin === "lifecycle" ? "lifecycle" : "capture",
                );
              },
            };
          },
        }
      : undefined;
  // The one read the tracker may make itself when a page shows a chat without loading it
  // (owner decisions of 13 and 14 Oct 2026, lib/own-read.ts). It is installed before the XHR
  // reader so that page reads by XHR are seen too; its answers take the page read's path.
  const ownRead = installOwnRead({
    site,
    historyText,
    threadHistory: site === "perplexity" ? history : undefined,
    fetch: rawFetch,
    enabled: () => enabled,
  });
  // The content script hands over its private own-read port once. This listener is added
  // before any page script runs and listens in the capture phase, so it runs first and the
  // message never reaches the page's own listeners, which therefore never hold the port.
  if (ownRead)
    window.addEventListener(
      "message",
      (event: MessageEvent) => {
        if (
          event.source !== window ||
          event.origin !== location.origin ||
          !isOwnReadConnect(event.data)
        )
          return;
        event.stopImmediatePropagation();
        if (event.ports?.length === 1) ownRead.connect(event.ports[0]!);
      },
      true,
    );
  // Gemini's session channel (19 Oct 2026, lib/gemini-channel.ts). Its wrapper is installed
  // first, so the history reader's stays outermost and its direct check still holds.
  const geminiChannel =
    site === "gemini" && liveXHR
      ? createGeminiChannel(liveXHR, location.origin)
      : null;
  geminiChannel?.install(window.XMLHttpRequest);
  historyText.installXHR(window.XMLHttpRequest, liveXHR);
  async function bodyText(body: unknown, clone?: Request): Promise<string> {
    if (body == null && clone) {
      const raw = await readBounded(clone.body);
      return decodeBody(raw, clone.headers.get("content-encoding"));
    }
    if (typeof body === "string") {
      if (body.length > LIMITS.frame) throw new CaptureError("buffer_overflow");
      return body;
    }
    if (body instanceof URLSearchParams) return body.toString();
    if (body instanceof Blob) {
      if (body.size > LIMITS.frame) throw new CaptureError("buffer_overflow");
      return decodeBody(new Uint8Array(await body.arrayBuffer()), null);
    }
    if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
      const raw =
        body instanceof ArrayBuffer
          ? new Uint8Array(body)
          : new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
      if (raw.length > LIMITS.frame) throw new CaptureError("buffer_overflow");
      return decodeBody(raw, null);
    }
    throw new CaptureError("missing_body");
  }
  async function readBounded(
    stream: ReadableStream<Uint8Array> | null,
  ): Promise<Uint8Array> {
    if (!stream) throw new CaptureError("missing_body");
    const reader = stream.getReader();
    let size = 0;
    const parts: Uint8Array[] = [];
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > LIMITS.frame) throw new CaptureError("buffer_overflow");
        parts.push(value);
      }
    } catch (error) {
      void reader.cancel().catch(() => {});
      throw error;
    }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }
    return result;
  }
  async function decodeBody(
    raw: Uint8Array,
    encoding: string | null,
  ): Promise<string> {
    const gzip = encoding === "gzip" || (raw[0] === 31 && raw[1] === 139);
    if (gzip) {
      if (typeof DecompressionStream === "undefined")
        throw new CaptureError("unsupported_schema");
      const stream = new Blob([raw as BlobPart])
        .stream()
        .pipeThrough(new DecompressionStream("gzip"));
      raw = await readBounded(stream);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(raw);
  }
  async function observe(
    id: string,
    responsePromise: Promise<Response>,
    body: unknown,
    url: URL,
    clone?: Request,
    uploadContext?: string,
    method = "POST",
  ) {
    const item = active.get(id)!;
    const session = item.session;
    const consume = responsePromise.then(async (response) => {
      if (!active.has(id)) {
        void response.body?.cancel().catch(() => {});
        return;
      }
      item.dataAt = Date.now();
      if (!response.body) throw new CaptureError("missing_body");
      const reader = response.body.getReader();
      item.reader = reader;
      if (!response.ok) throw new CaptureError("capture_interrupted");
      let receivedAt = performance.now();
      const observeTiming = () =>
        item.timing.observe(
          session.completionVerified?.() === true,
          receivedAt,
        );
      // A route that answers with audio (read aloud, G1) is counted as it streams; none of
      // its bytes are kept, so the text limits do not apply.
      if (session.bytes) {
        for (;;) {
          let chunk: ReadableStreamReadResult<Uint8Array>;
          try {
            chunk = await reader.read();
          } catch (error) {
            throw new TransportReadError(error);
          }
          receivedAt = performance.now();
          item.dataAt = Date.now();
          if (chunk.done) break;
          if (!active.has(id)) {
            void reader.cancel().catch(() => {});
            return;
          }
          session.bytes(chunk.value);
          if (item.dispatch && Date.now() - item.last > 750) emit(id, "progress");
        }
        session.bytesEnded?.();
        const read = session.readMessageId
          ? answerCharacters.get(session.readMessageId)
          : undefined;
        if (read !== undefined) session.readCharacters?.(read);
        observeTiming();
        return;
      }
      // A route that answers with one JSON body (AI artifact runs, G3) is read whole.
      if (
        session.json &&
        /^application\/json\b/i.test(response.headers.get("content-type") ?? "")
      ) {
        const parts: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          let chunk: ReadableStreamReadResult<Uint8Array>;
          try {
            chunk = await reader.read();
          } catch (error) {
            throw new TransportReadError(error);
          }
          receivedAt = performance.now();
          item.dataAt = Date.now();
          if (chunk.done) break;
          size += chunk.value.length;
          item.bytes += chunk.value.length;
          if (size > LIMITS.frame) throw new CaptureError("buffer_overflow");
          parts.push(chunk.value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const part of parts) {
          bytes.set(part, offset);
          offset += part.length;
        }
        let text: string;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
          throw new CaptureError("malformed_frame");
        }
        session.json(safeJson(text));
        observeTiming();
        return;
      }
      // A reply the stream handed to the socket (ChatGPT's stream_handoff names its topic).
      const handedOff = () => {
        if (!session.socket) return false;
        try {
          return !!session.snapshot().topic;
        } catch {
          return false;
        }
      };
      // A route that answers with one JSON object per line (signed-out ChatGPT, 20 Oct 2026).
      const decoder = session.line
        ? new JsonLinesDecoder((value) => {
            session.line!(value);
            observeTiming();
          })
        : adapter!.responseFormat === "gemini"
          ? new GeminiDecoder((value) => {
              session.gemini?.(value);
              observeTiming();
            })
          : new SseDecoder((frame) => {
              session.frame?.(frame);
              observeTiming();
            });
      let lineBytes = 0;
      for (;;) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch (error) {
          // Since 18 Oct 2026 ChatGPT aborts the body of a reply it handed to the tab's
          // socket once it has read the handoff. The reply continues there under its topic,
          // as it does when the body ends normally after a handoff, so the cut body is
          // not a failed read. A frame cut in half still fails below.
          if (handedOff()) {
            item.dataAt = Date.now();
            break;
          }
          throw new TransportReadError(error);
        }
        receivedAt = performance.now();
        item.dataAt = Date.now();
        const { done, value } = chunk;
        if (done) break;
        if (!active.has(id)) {
          void reader.cancel().catch(() => {});
          return;
        }
        if (session.line) {
          // Each signed-out ChatGPT line repeats the page's metadata of the answer so far, so
          // a long answer streams tens of megabytes it does not keep. The raw stream has its
          // own bound; the stream limits count what the reader keeps (live, 20 Oct 2026).
          lineBytes += value.length;
          if (lineBytes > JSON_LINE_LIMITS.stream)
            throw new CaptureError("buffer_overflow");
          decoder.push(value);
          item.bytes = session.retainedBytes?.() ?? lineBytes;
        } else item.bytes += value.length;
        if (
          item.bytes > LIMITS.stream ||
          [...active.values()].reduce((sum, v) => sum + v.bytes, 0) >
            LIMITS.global
        )
          throw new CaptureError("buffer_overflow");
        if (!session.line) decoder.push(value);
        if (item.dispatch && Date.now() - item.last > 750) emit(id, "progress");
      }
      decoder.finish();
      // A protocol whose normal end is its completion completes here (Gemini, M2).
      if (session.responseEnded) {
        session.responseEnded();
        observeTiming();
      }
    });
    let consumeFailureHandled = false;
    void consume.catch((error) => {
      consumeFailureHandled = true;
      fail(id, error);
    });
    try {
      let observedBody: string | null;
      try {
        // A GET request (read aloud) has no body; its URL is the request.
        observedBody =
          method.toUpperCase() === "GET" ? "" : await bodyText(body, clone);
      } catch (error) {
        // An artifact run can send a whole app as its request. Too large to read keeps its
        // input unknown; the reply and the provider's exact usage are still captured (G3).
        if (
          !(
            site === "claude" &&
            isClaudeProxy(url) &&
            error instanceof CaptureError &&
            error.code === "buffer_overflow"
          )
        )
          throw error;
        observedBody = null;
      }
      const dispatch =
        observedBody === null
          ? claudeProxyDispatch(null)
          : dispatchFor(url, observedBody);
      if (!active.has(id)) return;
      item.dispatch = dispatch;
      if (!emit(id, "dispatch")) {
        // A rejected dispatch cannot leave later messages without a valid capture origin.
        active.delete(id);
        void item.reader?.cancel().catch(() => {});
        return;
      }
      if (uploadContext && observedBody !== null)
        uploads?.dispatch(id, url, observedBody, uploadContext);
      await consume;
      if (!active.has(id)) return;
      if (item.stop) session.stopped();
      if (session.snapshot().topic) {
        emit(id, "progress");
        return;
      }
      emit(id, "end");
      active.delete(id);
    } catch (error) {
      if (active.has(id)) {
        if (!item.dispatch) {
          item.dispatch = {
            site: site!,
            action: /\/retry_completion2?$/.test(url.pathname)
              ? "regenerate"
              : "send",
            input: null,
            conversationId: null,
            parentId: null,
            requestId: null,
            model: null,
            attachments: null,
            imageEditParentId: null,
          };
          emit(
            id,
            "dispatch",
            error instanceof CaptureError ? error.code : "capture_interrupted",
          );
        }
        fail(id, error);
      } else if (!consumeFailureHandled)
        health(
          error instanceof CaptureError ? error.code : "capture_interrupted",
        );
    }
  }
  const wrappedFetch: typeof fetch = function (this: Window, input, init) {
    const observedAt = Date.now(),
      uploadContext = uploads?.context();
    const network = nativeBody.request(input, init, location.href);
    let preparedUpload: ReturnType<ProviderUploadObserver["prepare"]> = null;
    try {
      preparedUpload = uploads?.prepare(network) ?? null;
    } catch {}
    const observeHistory =
      site === "perplexity" && enabled && network
        ? history.start(network.url.href, { method: network.method })
        : null;
    let target: URL | null = null;
    let clone: Request | undefined;
    try {
      for (const [id, item] of active)
        if (item.completedAt && Date.now() - item.completedAt > 10000)
          active.delete(id);
      target = network?.url ?? null;
      const method = network?.method ?? "GET";
      if (
        !target ||
        target.origin !== location.origin ||
        !adapter.generationRoute(target, method)
      )
        target = null;
      if (target && (!enabled || !makeRoom())) {
        health("buffer_overflow");
        target = null;
      }
      if (target && network?.nativeRequest && network.body == null)
        clone = Reflect.apply(nativeCloneRequest, network.nativeRequest, []);
    } catch {
      target = null;
    }
    // Since 19 Oct 2026 Google's pages send their batch reads as fetch(new Request(url,
    // {method, body})) with no second argument, so the body is only inside the Request.
    // A clone taken before the page's fetch reads it without touching the page's request.
    // Only Google's batch reads name their chat in a POST body; other sites' reads are GETs.
    let requestBody: Request | undefined;
    try {
      if (
        googleFramed &&
        enabled &&
        network?.nativeRequest &&
        network.body == null &&
        network.url.origin === location.origin &&
        network.method !== "GET" &&
        network.method !== "HEAD"
      )
        requestBody = Reflect.apply(nativeCloneRequest, network.nativeRequest, []);
    } catch {}
    // Return the original promise and response; measurement owns only a cloned branch.
    const dispatchedAt = performance.now();
    let result: Promise<Response>;
    const previousForward = forwardingFetch;
    if (target && typeof network?.body === "string")
      forwardingFetch = { url: target.href, body: network.body };
    try {
      coverage.passed(input, documentBase());
    } catch {}
    try {
      result = Reflect.apply(rawFetch, this, arguments);
    } finally {
      forwardingFetch = previousForward;
    }
    const observeRequest = (
      body: unknown,
      response: Promise<Response> = result,
      cloned = false,
    ) => {
      if (!enabled || !network) return;
      try {
        ownRead?.pageRequest(network.url, network.method, body);
      } catch {}
      try {
        return historyText.observe(
          network.url,
          network.method,
          response,
          observedAt,
          body,
          undefined,
          cloned,
        );
      } catch {}
    };
    if (requestBody) {
      // The page's own handlers of the response were registered by its fetch call, before
      // the body can be read, and may read the response first. So the response is cloned
      // now, ahead of them, and handed to the history reader as its own copy; a copy the
      // reader does not take is cancelled, since an unread copy holds the whole response.
      let early: Promise<Response> | null = null;
      try {
        early = result.then(
          (response) => Reflect.apply(nativeCloneResponse, response, []) as Response,
        );
        void early.catch(() => {});
      } catch {}
      // A body too large or not text is passed on as unknown, as before.
      void bodyText(null, requestBody)
        .catch(() => network?.body)
        .then((body) => {
          if (!early) return observeRequest(body);
          if (observeRequest(body, early, true) !== true)
            void early.then(
              (copy) =>
                copy.body &&
                Reflect.apply(nativeCancelStream, copy.body, []).catch(() => {}),
              () => {},
            );
        });
    } else observeRequest(network?.body);
    try {
      if (uploadContext)
        uploads?.fetch(preparedUpload, result, observedAt, uploadContext);
    } catch {}
    observeHistory?.(result);
    if (target) {
      try {
        const id = crypto.randomUUID();
        active.set(id, {
          session: adapter.createSession(target),
          dispatch: null,
          revision: 0,
          last: 0,
          at: new Date().toISOString(),
          bytes: 0,
          dataAt: Date.now(),
          timing: new LiveRequestTimer(dispatchedAt),
          stopByRequest:
            site === "claude" ||
            (site === "chatgpt" &&
              isChatgptSignedOutSend(target, network?.method ?? "POST")),
          ...(site === "chatgpt" ? { stopClicksBefore: stopClicks } : {}),
        });
        const measurement = result.then((response) => response.clone());
        void measurement.catch(() => {});
        void observe(
          id,
          measurement,
          network?.body,
          target,
          clone,
          // A Request clone can share mutable stream chunks with the host. Only an observed literal body proves these references.
          typeof network?.body === "string" ? uploadContext : undefined,
          network?.method,
        );
      } catch (error) {
        // An unavailable adapter must not replace the host's native fetch result.
        health(
          error instanceof CaptureError ? error.code : "unsupported_schema",
        );
      }
    }
    if (site === "claude" || site === "chatgpt") {
      try {
        const stopUrl = network?.url;
        // The chat a stop request names: claude.ai names it in the address, signed-out
        // ChatGPT in its JSON body (20 Oct 2026). Signed-in ChatGPT's stop is handled below.
        let conversationId: string | null = null;
        if (network && stopUrl && stopUrl.origin === location.origin) {
          if (
            site === "claude" &&
            /\/chat_conversations\/[^/]+\/stop_response$/.test(stopUrl.pathname)
          )
            conversationId = stopUrl.pathname.split("/")[5] ?? null;
          else if (
            site === "chatgpt" &&
            isChatgptSignedOutStop(stopUrl, network.method) &&
            typeof network.body === "string"
          )
            conversationId = chatgptSignedOutStopConversation(network.body);
        }
        // A new signed-out chat's send names no chat; its stream named it before the stop.
        const stops = (item: {
          dispatch: Dispatch | null;
          session: ProtocolSession;
          stopByRequest?: boolean;
        }) => {
          if (item.dispatch?.conversationId === conversationId) return true;
          if (site !== "chatgpt" || !item.stopByRequest) return false;
          try {
            return item.session.snapshot().conversationId === conversationId;
          } catch {
            return false;
          }
        };
        if (conversationId) {
          for (const item of active.values())
            if (stops(item)) {
              item.stop = "requested";
              // A failed read now waits for the provider's answer to the stop.
              if (item.stopGrace) {
                clearTimeout(item.stopGrace.timer);
                item.stopGrace.timer = setTimeout(
                  item.stopGrace.finish,
                  CLAUDE_STOP_ANSWER_MS,
                );
              }
            }
          const answered = (accepted: boolean) => {
            for (const [id, item] of active)
              if (stops(item) && item.stop === "requested") {
                if (!accepted) {
                  // The provider refused the stop, so the reply may still finish; a read
                  // that already failed is a real failure.
                  item.stop = undefined;
                  item.stopGrace?.finish();
                  continue;
                }
                item.stop = "confirmed";
                if (item.stopGrace) {
                  item.stopGrace.finish();
                  continue;
                }
                item.session.stopped();
                emit(id, "progress");
              }
          };
          void result.then(
            (response) => answered(response.ok),
            () => answered(false),
          );
        }
      } catch {}
    }
    if (site === "chatgpt") {
      try {
        const stopUrl = network?.url;
        if (
          stopUrl?.origin === location.origin &&
          stopUrl.pathname === "/backend-api/stop_conversation" &&
          typeof network?.body === "string"
        ) {
          const stop = safeJson(network.body);
          if (typeof stop.conversation_id === "string")
            void result
              .then((response) => {
                if (response.ok)
                  for (const [id, item] of active)
                    if (
                      item.dispatch?.conversationId === stop.conversation_id ||
                      item.session.snapshot().conversationId ===
                        stop.conversation_id
                    ) {
                      item.session.stopped();
                      emit(id, "end");
                      active.delete(id);
                    }
              })
              .catch(() => {});
        }
      } catch {}
    }
    return result;
  };
  window.fetch = wrappedFetch;
  // Fetch coverage as the content script's watchdog sees it. A wrapper installed after the
  // tracker's (for example the site's monitoring SDK) hides the tracker's identity; the
  // timing check then shows whether requests still reach it.
  const interception = (): CaptureInterception => {
    const checked = coverage.state();
    if (checked === "missed") return "missed";
    const xhrDirect = !googleFramed || historyText.xhrDirect();
    if (window.fetch === wrappedFetch && xhrDirect) return "direct";
    return xhrDirect && checked === "monitored" ? "monitored" : "unverified";
  };
  // A missed request is reported at once instead of at the next probe.
  coverage.observe(window.PerformanceObserver, () => {
    if (enabled && probeNonce)
      window.postMessage(
        {
          channel: "ai-footprint-ready-v1",
          nonce: probeNonce,
          interception: interception(),
        } satisfies CaptureReady,
        location.origin,
      );
  });
  if (site === "chatgpt") {
    const Socket = new Proxy(rawWebSocket, {
      construct(target, args, newTarget) {
        const socket = Reflect.construct(target, args, newTarget) as WebSocket;
        let targetUrl: URL;
        try {
          targetUrl = new URL(String(args[0]), location.href);
        } catch {
          return socket;
        }
        if (
          targetUrl.protocol !== "wss:" ||
          !["chatgpt.com", "ws.chatgpt.com"].includes(targetUrl.hostname)
        )
          return socket;
        socket.addEventListener("message", (event) => {
          const receivedAt = performance.now();
          if (!enabled) return;
          // Any message, readable or not, shows the socket is alive, so a reply waiting on
          // a job that sends nothing for minutes is not idle (W10).
          const now = Date.now();
          for (const item of active.values())
            try {
              if (item.session.snapshot().topic) item.dataAt = now;
            } catch {
              // A broken session ends through its own failure.
            }
          if (
            typeof event.data !== "string" ||
            event.data.length > LIMITS.frame
          ) {
            health("buffer_overflow");
            return;
          }
          queueMicrotask(() => {
            let value: unknown;
            try {
              value = safeJson(event.data);
            } catch {
              health("malformed_frame");
              return;
            }
            // A conversation's async status names no turn, so it ends a capture only while
            // that capture is the conversation's only one (G7); captures of other chats in
            // this tab do not matter.
            const conversations = new Map<string, number>();
            for (const [, other] of active)
              try {
                // Read aloud (an audio session) is not a turn and never takes a turn's
                // terminal (G1).
                if (other.session.bytes) continue;
                const conversation = other.session.snapshot().conversationId;
                if (conversation)
                  conversations.set(
                    conversation,
                    (conversations.get(conversation) ?? 0) + 1,
                  );
              } catch {}
            for (const [id, item] of active) {
              try {
                const before = item.session.snapshot();
                if (!before.topic) continue;
                const previousTiming =
                  item.timing.evidence()?.duration_seconds ?? null;
                const consumed = item.session.socket?.(value, {
                  allowConversationTerminal:
                    !!before.conversationId &&
                    conversations.get(before.conversationId) === 1,
                  // A new chat's Stop there sends no stop_conversation (live, 19 Oct 2026).
                  unsubscribeStops: isProvisionalChatgptRoute(location.pathname ?? ""),
                });
                // The socket carries every chat of the account; only this reply's items
                // are kept, so only they count toward its stream limit. Each delta comes
                // in its own envelope, so a long reply's messages hold far more than the
                // reader keeps (live, 20 Oct 2026); a reader that can say counts what it keeps.
                if (consumed) {
                  item.bytes =
                    item.session.retainedBytes?.() ??
                    item.bytes + event.data.length * 2;
                  if (item.bytes > LIMITS.stream)
                    throw new CaptureError("buffer_overflow");
                }
                const verifiedComplete =
                  item.session.completionVerified?.() === true;
                item.timing.observe(verifiedComplete, receivedAt);
                const snapshot = item.session.snapshot();
                if (
                  snapshot.state === "cancelled" ||
                  (snapshot.state === "completed" &&
                    verifiedComplete &&
                    snapshot.imageOperations.length > 0)
                ) {
                  emit(id, "end");
                  active.delete(id);
                } else if (snapshot.state === "completed") {
                  if (
                    !item.completedPublished ||
                    previousTiming !==
                      (item.timing.evidence()?.duration_seconds ?? null)
                  ) {
                    emit(id, "end");
                    item.completedPublished = true;
                  }
                  // A final text snapshot can precede the actual stream terminal by many seconds.
                  // Only verified completion starts the slot's short retirement grace period.
                  if (verifiedComplete) item.completedAt ??= Date.now();
                  else delete item.completedAt;
                } else {
                  const resumed = !!item.completedPublished;
                  delete item.completedAt;
                  delete item.completedPublished;
                  if (resumed || Date.now() - item.last > 750)
                    emit(id, "progress");
                }
              } catch (error) {
                fail(id, error);
              }
            }
          });
        });
        return socket;
      },
    });
    socketProxy = Socket;
    window.WebSocket = Socket;
  }
  /**
   * Retires finished captures and ends those without data for the idle limit or past the
   * total limit (X6). A page restored from the back-forward cache runs the same sweep.
   */
  const sweep = () => {
    sweepUploads();
    const now = Date.now();
    for (const [id, item] of active) {
      if (item.completedAt && now - item.completedAt > 10000) active.delete(id);
      else if (
        now - item.dataAt > CAPTURE_TIMES.idleMs ||
        now - Date.parse(item.at) > CAPTURE_TIMES.totalMs
      )
        fail(id, new CaptureError("capture_interrupted"), "lifecycle");
    }
  };
  let timer = setInterval(sweep, CAPTURE_TIMES.sweepMs);
  window.addEventListener("pagehide", () => {
    ownRead?.cancel();
    historyText.uninstallXHR();
    geminiChannel?.restore();
    uploads?.stop();
    uploadIdentities.clear();
    history.cancel();
    historyText.cancel();
    enabled = false;
    clearInterval(timer);
    for (const [id, item] of active) {
      if (item.completedAt) active.delete(id);
      else fail(id, new CaptureError("capture_interrupted"), "lifecycle");
    }
    if (window.fetch === wrappedFetch) window.fetch = rawFetch;
    if (socketProxy && window.WebSocket === socketProxy)
      window.WebSocket = rawWebSocket;
  });
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted || permissionStopped) return;
    enabled = true;
    uploads?.start();
    uploads?.installXHR(window.XMLHttpRequest);
    geminiChannel?.install(window.XMLHttpRequest);
    historyText.installXHR(window.XMLHttpRequest, liveXHR);
    // An outer host wrapper may still delegate; its identity alone cannot prove a capture gap.
    if (window.fetch === rawFetch) window.fetch = wrappedFetch;
    if (socketProxy && window.WebSocket === rawWebSocket)
      window.WebSocket = socketProxy;
    timer = setInterval(sweep, CAPTURE_TIMES.sweepMs);
  });
  window.addEventListener("message", (event) => {
    if (event.source === window && event.origin === location.origin) {
      if (
        event.data?.channel === HISTORY_RESET_CHANNEL &&
        Object.keys(event.data).length === 1
      ) {
        // A read for the chat now shown may still be waiting for this navigation.
        historyText.cancel(true);
        ownRead?.routeChanged();
        return;
      }
      if (validFileUploadReset(event.data)) {
        uploads?.reset();
        uploadIdentities.clear();
        return;
      }
      if (validFileUploadPromote(event.data)) {
        const route = parseConversationRoute(site!, location.pathname ?? ""),
          identity = uploadIdentities.get(event.data.captureId);
        if (
          !route ||
          !identity ||
          identity.expires <= Date.now() ||
          identity.id !== route.conversationId
        ) {
          uploads?.reset();
          uploadIdentities.clear();
        }
        return;
      }
      uploads?.receive(event.data, event.ports ?? []);
    }
    if (
      event.source === window &&
      event.origin === location.origin &&
      event.data?.channel === "ai-footprint-probe-v1" &&
      typeof event.data.nonce === "string" &&
      event.data.nonce.length === 36 &&
      enabled
    ) {
      probeNonce = event.data.nonce;
      window.postMessage(
        {
          channel: "ai-footprint-ready-v1",
          nonce: event.data.nonce,
          interception: interception(),
        } satisfies CaptureReady,
        location.origin,
      );
      return;
    }
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      event.data?.channel !== "ai-footprint-control-v1" ||
      event.data.action !== "stop"
    )
      return;
    permissionStopped = true;
    ownRead?.cancel();
    historyText.uninstallXHR();
    geminiChannel?.restore();
    uploads?.stop();
    uploadIdentities.clear();
    enabled = false;
    history.cancel();
    historyText.cancel();
    clearInterval(timer);
    for (const [id, item] of active) {
      if (item.completedAt) active.delete(id);
      else fail(id, new CaptureError("capture_interrupted"), "lifecycle");
    }
    if (window.fetch === wrappedFetch) window.fetch = rawFetch;
    if (socketProxy && window.WebSocket === socketProxy)
      window.WebSocket = rawWebSocket;
  });
}
