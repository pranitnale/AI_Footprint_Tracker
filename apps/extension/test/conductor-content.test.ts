import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { JSDOM } from "jsdom";
import ts from "typescript";
import * as captureCore from "@footprint/capture-core";
import * as adapters from "@footprint/adapters";
import * as formatters from "@footprint/ui/formatters";
import * as fileTextPresentation from "@footprint/ui/file-text";
import * as watchdog from "../lib/capture-watchdog";
import * as bar from "../lib/conversation-bar";
import * as displayScenario from "../lib/display-scenario";
import * as computerFileDetails from "../lib/computer-file-details";
import * as bridge from "../lib/bridge";
import * as placement from "../lib/content-placement";
import * as presentation from "../lib/conversation-display";
import * as historyPresentation from "../lib/history-presentation";
import * as historyCapture from "../lib/history-capture";
import * as claudeHistoryMessage from "../lib/claude-history-message";
import * as providerHistoryMessage from "../lib/provider-history-message";
import * as historyLimits from "../lib/history-limits";
import * as fileOfferBridge from "../lib/file-offer-bridge";
import * as fileRelayProtocol from "../lib/file-relay-protocol";
import * as detailsOverview from "../lib/details-overview";
import * as ownReadModule from "../lib/own-read";
import * as chatgptReadProgress from "../lib/chatgpt-read-progress";
import * as ownReadPause from "../lib/own-read-pause";
import * as longChatTip from "../lib/long-chat-tip";
import * as trackingConsent from "../lib/tracking-consent";
import * as captureDelivery from "../lib/capture-delivery";
import { SummaryAccumulator } from "../lib/summary-scan";

/**
 * Statuses the person cannot act on leave the bar for Details (owner, 13 Oct 2026). The bar
 * label keeps them in data-details, which Details reads; tests read them there.
 */
function detailsOnly(shadow: ParentNode) {
  return shadow.querySelector<HTMLElement>("[data-status]")!.dataset.details ?? "";
}

/**
 * The statuses Details opens with: those with an action (named in brackets) and progress.
 * Since 14 Oct 2026 the bar shows none of them (owner), so the visible label must be empty.
 */
function barState(shadow: ParentNode) {
  const label = shadow.querySelector<HTMLElement>("[data-status]")!;
  assert.equal(label.textContent, "", "the bar shows no status");
  return [label.dataset.actionable ?? "", label.dataset.progress ?? ""]
    .filter(Boolean)
    .join(" · ");
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

// Execute the actual content entrypoint. Only extension transport and its entry wrapper are doubles.
async function contentHarness(
  observedComposer = false,
  route?: {
    url: string;
    respond: (message: any, call: number) => unknown | Promise<unknown>;
    respondCapture?: (message: any) => unknown | Promise<unknown>;
    respondThread?: (message: any) => unknown | Promise<unknown>;
    respondHistory?: (message: any) => unknown | Promise<unknown>;
    respondFile?: (message: any) => unknown | Promise<unknown>;
    respondComparison?: (message: any) => unknown | Promise<unknown>;
    respondProgress?: (message: any) => unknown | Promise<unknown>;
    respondOwnReadPause?: (message: any) => unknown | Promise<unknown>;
    /** "Load full chat history" for the asked switch; on when absent. */
    respondOwnReadSetting?: (message: any) => unknown | Promise<unknown>;
    respondTip?: (message: any) => unknown | Promise<unknown>;
    /** Whether the person agreed to tracking; unanswered (as before the step) when absent. */
    respondTrackingState?: (message: any) => unknown | Promise<unknown>;
    historyLifecycleMs?: number;
    html?: string;
    watchdogModule?: typeof watchdog;
    captureGraceTimers?: boolean;
    captureScanTimer?: boolean;
    /**
     * The waits before a capture frame is sent again (lib/capture-delivery.ts). Tests that do
     * not set it send each frame once, so its first answer is the last one.
     */
    captureRetryDelays?: number[];
  },
) {
  const source = await readFile(
    new URL("../entrypoints/content.content.ts", import.meta.url),
    "utf8",
  );
  const dom = new JSDOM(
    route?.html ??
      '<main><div style="display:flex;flex-direction:column"><div style="display:contents"><form><textarea id="prompt-textarea" placeholder="Ask"></textarea></form></div></div></main>',
    { url: route?.url ?? "https://chatgpt.com/", runScripts: "outside-only" },
  );
  const postedMessages: unknown[] = [];
  // Ports sent with a message, which JSDOM's postMessage drops (the Claude own read's reply port).
  const postedPorts: Array<{ message: unknown; ports: MessagePort[] }> = [];
  const intervalCallbacks: Array<() => void> = [];
  const nativePostMessage = dom.window.postMessage.bind(dom.window);
  const nativeSetInterval = dom.window.setInterval.bind(dom.window);
  (dom.window as any).postMessage = (
    message: unknown,
    targetOrigin: string,
    transfer?: Transferable[],
  ) => {
    postedMessages.push(message);
    // The own read's private port: its requests, each with its answer port, are what the
    // page world would receive (14 Oct 2026).
    if (ownReadModule.isOwnReadConnect(message) && transfer?.length === 1) {
      (transfer[0] as MessagePort).onmessage = (event: MessageEvent) =>
        postedPorts.push({ message: event.data, ports: [...event.ports] });
    } else if (transfer?.length)
      postedPorts.push({ message, ports: transfer as MessagePort[] });
    return transfer === undefined
      ? nativePostMessage(message, targetOrigin)
      : nativePostMessage(message, targetOrigin, transfer);
  };
  (dom.window as any).setInterval = (
    handler: TimerHandler,
    timeout?: number,
    ...args: unknown[]
  ) => {
    if (typeof handler === "function")
      intervalCallbacks.push(() => handler(...args));
    return nativeSetInterval(handler, timeout, ...args);
  };
  // The earlier-history grace periods (4 s and 6 s) and the 15 s hold of a display
  // waiting for recalculation can be fired by the test.
  const graceTimers: Array<() => void> = [];
  if (route?.captureGraceTimers) {
    const nativeSetTimeout = dom.window.setTimeout.bind(dom.window);
    let fakeId = 0;
    (dom.window as any).setTimeout = (
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      if (
        (timeout === 4000 || timeout === 6000 || timeout === 15000) &&
        typeof handler === "function"
      ) {
        graceTimers.push(() => handler(...args));
        return --fakeId;
      }
      return nativeSetTimeout(handler, timeout, ...args);
    };
  }
  // The composer scan that page mutations schedule after 500 ms is run by the test
  // (runComposerScan). A wall-clock wait just past 500 ms raced it on a loaded machine.
  const scanTimers = new Map<number, () => void>();
  if (route?.captureScanTimer) {
    const nativeSetTimeout = dom.window.setTimeout.bind(dom.window);
    const nativeClearTimeout = dom.window.clearTimeout.bind(dom.window);
    let fakeId = -1000000;
    (dom.window as any).setTimeout = (
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      if (timeout === 500 && typeof handler === "function") {
        const id = --fakeId;
        scanTimers.set(id, () => handler(...args));
        return id;
      }
      return nativeSetTimeout(handler, timeout, ...args);
    };
    (dom.window as any).clearTimeout = (id?: number) => {
      if (id !== undefined && scanTimers.delete(id)) return;
      nativeClearTimeout(id);
    };
  }
  // The waits before a capture frame is sent again are fired by the test (fireRetryTimers).
  const retryTimers: Array<() => void> = [];
  if (route?.captureRetryDelays?.length) {
    const nativeSetTimeout = dom.window.setTimeout.bind(dom.window);
    const delays = new Set(route.captureRetryDelays);
    let fakeId = -2000000;
    (dom.window as any).setTimeout = (
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      if (
        timeout !== undefined &&
        delays.has(timeout) &&
        typeof handler === "function"
      ) {
        retryTimers.push(() => handler(...args));
        return --fakeId;
      }
      return nativeSetTimeout(handler, timeout, ...args);
    };
  }
  // JSDOM has no layout engine; provide the visible native composer geometry explicitly.
  const composerAnchors = dom.window.document.querySelectorAll(
    'form, fieldset[data-perf-region="composer"][data-cds-dock-group], [data-test-composer-bounds]',
  );
  assert.ok(composerAnchors.length);
  for (const composerAnchor of composerAnchors)
    composerAnchor.getBoundingClientRect = () =>
      observedComposer
        ? new dom.window.DOMRect(0, 644, 640, 52)
        : new dom.window.DOMRect(0, 500, 640, 80);
  if (observedComposer)
    Object.defineProperty(dom.window, "innerHeight", { value: 720 });
  const documentListeners: Array<{
    type: string;
    signal: AbortSignal | null;
  }> = [];
  const addDocumentListener = dom.window.document.addEventListener.bind(
    dom.window.document,
  );
  (dom.window.document as any).addEventListener = (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) => {
    if (type === "keydown" || type === "pointerdown")
      documentListeners.push({
        type,
        signal:
          typeof options === "object" && options.signal
            ? (options.signal as AbortSignal)
            : null,
      });
    return addDocumentListener(type, listener as EventListener, options);
  };
  const documentQueries = new Map<string, number>();
  const queryDocument = dom.window.document.querySelectorAll.bind(
    dom.window.document,
  );
  (dom.window.document as any).querySelectorAll = (selector: string) => {
    documentQueries.set(selector, (documentQueries.get(selector) ?? 0) + 1);
    return queryDocument(selector);
  };
  const shadows = new Map<Element, ShadowRoot>();
  const attach = dom.window.Element.prototype.attachShadow;
  dom.window.Element.prototype.attachShadow = function (options) {
    const shadow = attach.call(this, options);
    shadows.set(this, shadow);
    return shadow;
  };
  let receiver:
    | ((message: unknown, sender?: { id?: string; tab?: unknown }) => unknown)
    | undefined;
  let invalidate = () => {};
  let runtimeInvalidated = false;
  const calls: any[] = [];
  let conversationCalls = 0;
  let captureCounter = 0;
  let captureBinding: any = null;
  const browser = {
    runtime: {
      id: "content-test-extension",
      getURL: (path: string) => {
        if (runtimeInvalidated)
          throw new Error("Extension context invalidated.");
        return `chrome-extension://content-test-extension${path}`;
      },
      sendMessage: (message: any) => {
        if (runtimeInvalidated)
          throw new Error("Extension context invalidated.");
        return (async () => {
          calls.push(message);
          if (message?.target === "capture") {
            captureBinding = message.binding;
            if (route?.respondCapture) return route.respondCapture(message);
            return { ok: true };
          }
          if (message?.target === "conversation-summary" && route) {
            const response: any = await route.respond(
              message,
              ++conversationCalls,
            );
            const routeSite = captureCore.siteForHost(
              dom.window.location.hostname,
            );
            return response?.target === "footprint-display"
              ? {
                  ...response,
                  displayBinding: message.binding,
                  conversationIdentity: {
                    site: routeSite,
                    conversationId: message.conversationId,
                  },
                }
              : response;
          }
          if (message?.target === "thread-history" && route?.respondThread)
            return route.respondThread(message);
          if (message?.target === "history-observation")
            return route?.respondHistory
              ? route.respondHistory(message)
              : { accepted: true };
          if (message?.target?.startsWith("file-") && route?.respondFile)
            return route.respondFile(message);
          // An unanswered comparison is the background still reading; tests that need it reply.
          if (message?.target === "chatgpt-read-progress" && route?.respondProgress)
            return route.respondProgress(message);
          if (message?.target === "own-read-pause" && route?.respondOwnReadPause)
            return route.respondOwnReadPause(message);
          if (message?.target === "own-read-setting")
            return route?.respondOwnReadSetting
              ? route.respondOwnReadSetting(message)
              : { on: true };
          if (message?.target === "long-chat-tip" && route?.respondTip)
            return route.respondTip(message);
          if (message?.target === "tracking-state" && route?.respondTrackingState)
            return route.respondTrackingState(message);
          if (message?.target === "chat-comparison")
            return route?.respondComparison
              ? route.respondComparison(message)
              : new Promise(() => {});
          return { enabled: false };
        })();
      },
      onMessage: {
        addListener(
          callback: (
            message: unknown,
            sender?: { id?: string; tab?: unknown },
          ) => unknown,
        ) {
          receiver = callback;
        },
      },
    },
  };
  const imports: Record<string, unknown> = {
    "wxt/utils/define-content-script": {
      defineContentScript: (value: unknown) => value,
    },
    "wxt/browser": { browser },
    "@footprint/capture-core": captureCore,
    "@footprint/adapters": adapters,
    "@footprint/ui/formatters": formatters,
    "@footprint/ui/file-text": fileTextPresentation,
    "../lib/capture-watchdog": route?.watchdogModule ?? watchdog,
    "../lib/conversation-bar": bar,
    "../lib/display-scenario": displayScenario,
    "../lib/computer-file-details": computerFileDetails,
    "../lib/bridge": bridge,
    "../lib/content-placement": placement,
    "../lib/conversation-display": presentation,
    "../lib/history-presentation": historyPresentation,
    "../lib/history-capture": historyCapture,
    "../lib/claude-history-message": claudeHistoryMessage,
    "../lib/provider-history-message": providerHistoryMessage,
    "../lib/history-limits": {
      HISTORY_LIMITS: {
        ...historyLimits.HISTORY_LIMITS,
        lifecycleMs:
          route?.historyLifecycleMs ?? historyLimits.HISTORY_LIMITS.lifecycleMs,
      },
    },
    "../lib/file-offer-bridge": fileOfferBridge,
    "../lib/file-relay-protocol": fileRelayProtocol,
    "../lib/details-overview": detailsOverview,
    // No wait once the grace period passed, as in the scheduler (own-read.test.ts).
    "../lib/own-read": {
      ...ownReadModule,
      createOwnReadScheduler: (
        env: Parameters<typeof ownReadModule.createOwnReadScheduler>[0],
      ) => ownReadModule.createOwnReadScheduler({ ...env, delay: () => 0 }),
    },
    "../lib/chatgpt-read-progress": chatgptReadProgress,
    "../lib/own-read-pause": ownReadPause,
    "../lib/long-chat-tip": longChatTip,
    "../lib/tracking-consent": trackingConsent,
    "../lib/capture-delivery": {
      ...captureDelivery,
      CAPTURE_RETRY_DELAYS_MS: route?.captureRetryDelays ?? [],
    },
  };
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exported: any = {};
  new dom.window.Function("require", "exports", compiled)((name: string) => {
    assert.ok(name in imports, `Unexpected content dependency: ${name}`);
    return imports[name];
  }, exported);
  exported.default.main({
    onInvalidated(callback: () => void) {
      invalidate = callback;
    },
  });
  assert.ok(receiver);
  return {
    deliver(message: unknown, sender?: { id?: string; tab?: unknown }) {
      return receiver!(message, sender);
    },
    render(
      conversation: unknown,
      options: {
        guidanceShow?: boolean;
        requestCount?: number;
        /** The display's Requests trigger of the long-chat tip; absent as in older displays. */
        tipRequestLimit?: number | null;
        summary?: any;
        recordedThread?: any;
        history?: any;
        calculationPending?: boolean;
        sharingPaused?: boolean;
        state?: string;
      } = {},
    ) {
      const currentSite = captureCore.siteForHost(
        dom.window.location.hostname,
      )!;
      const parsed = captureCore.parseConversationRoute(
        currentSite,
        dom.window.location.pathname,
      );
      const captureId = `00000000-0000-4000-8000-${String(
        ++captureCounter,
      ).padStart(12, "0")}`;
      dom.window.dispatchEvent(
        new dom.window.MessageEvent("message", {
          source: dom.window as unknown as Window,
          origin: dom.window.location.origin,
          data: {
            timing: null,
            channel: "ai-footprint-observation-v1",
            version: 1,
            id: captureId,
            revision: 1,
            event: "dispatch",
            site: currentSite,
            at: new Date().toISOString(),
            dispatch: {
              action: "send",
              attachments: null,
              conversationId: parsed?.conversationId ?? null,
              imageEditParentId: null,
              input: "synthetic test input",
              model: null,
              parentId: null,
              requestId: null,
              site: currentSite,
            },
            snapshot: null,
            failure: null,
          },
        }),
      );
      receiver!({
        target: "footprint-display",
        displayBinding: captureBinding,
        conversationIdentity: parsed,
        mode: "company",
        // The request's final figures; a dispatch or progress display stays off the bar
        // while its request is pending (owner decision 1a of 14 Oct 2026).
        state: options.state ?? "completed",
        summary:
          options.summary ??
          ({
            ...new SummaryAccumulator().result(),
            requests: options.requestCount ?? 0,
          } as any),
        conversation,
        recordedThread: options.recordedThread ?? null,
        history: options.history,
        ...(options.calculationPending !== undefined
          ? { calculationPending: options.calculationPending }
          : {}),
        ...(options.sharingPaused !== undefined
          ? { sharingPaused: options.sharingPaused }
          : {}),
        ...(options.tipRequestLimit !== undefined
          ? { tipRequestLimit: options.tipRequestLimit }
          : {}),
        queueCount: 0,
        activeContext: null,
        budget: null,
        budgetBasis: null,
        guidance: {
          show: options.guidanceShow ?? false,
          ratio: null,
          state: { level: options.guidanceShow ? 80 : 0 },
          key: options.guidanceShow ? "test-guidance" : null,
        },
      });
      const host = dom.window.document.querySelector(
        '[data-ai-footprint="information"]',
      );
      assert.ok(host, "The actual entrypoint must mount the information bar");
      const shadow = shadows.get(host);
      assert.ok(shadow);
      return shadow;
    },
    adviceShadow() {
      const host = dom.window.document.querySelector(
        '[data-ai-footprint="context-advice"]',
      );
      assert.ok(host);
      const shadow = shadows.get(host);
      assert.ok(shadow);
      return shadow;
    },
    focusEditor() {
      const editor =
        dom.window.document.querySelector<HTMLTextAreaElement>(
          "#prompt-textarea",
        );
      editor?.focus();
      return editor;
    },
    activeElement() {
      return dom.window.document.activeElement;
    },
    document: dom.window.document,
    ownReadRequests() {
      return postedPorts.filter(
        ({ message }: any) =>
          message?.channel === ownReadModule.OWN_READ_CHANNEL,
      );
    },
    setVisibility(state: "visible" | "hidden") {
      Object.defineProperty(dom.window.document, "visibilityState", {
        configurable: true,
        get: () => state,
      });
      dom.window.document.dispatchEvent(
        new dom.window.Event("visibilitychange"),
      );
    },
    historyResetCount() {
      return postedMessages.filter(
        (message: any) =>
          message.channel === historyCapture.HISTORY_RESET_CHANNEL,
      ).length;
    },
    shadowFor(host: Element) {
      return shadows.get(host) ?? null;
    },
    activeDocumentListeners(type: string) {
      return documentListeners.filter(
        (listener) =>
          listener.type === type && listener.signal?.aborted !== true,
      ).length;
    },
    documentQueryCount(selector: string) {
      return documentQueries.get(selector) ?? 0;
    },
    resetDocumentQueryCounts() {
      documentQueries.clear();
    },
    async loadRoute() {
      dom.window.dispatchEvent(new dom.window.PopStateEvent("popstate"));
      await new Promise((resolve) => setTimeout(resolve, 0));
      const host = dom.window.document.querySelector(
        '[data-ai-footprint="information"]',
      );
      assert.ok(host, "The actual entrypoint must mount the information bar");
      const shadow = shadows.get(host);
      assert.ok(shadow);
      return shadow;
    },
    async popstate() {
      dom.window.dispatchEvent(new dom.window.PopStateEvent("popstate"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    async navigate(path: string) {
      dom.window.history.pushState({}, "", path);
      dom.window.dispatchEvent(new dom.window.PopStateEvent("popstate"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    postThreadHistory(message: unknown) {
      dom.window.dispatchEvent(
        new dom.window.MessageEvent("message", {
          source: dom.window as unknown as Window,
          origin: dom.window.location.origin,
          data: message,
        }),
      );
    },
    postHistorical(message: unknown, ports: MessagePort[] = []) {
      dom.window.dispatchEvent(
        new dom.window.MessageEvent("message", {
          source: dom.window as unknown as Window,
          origin: dom.window.location.origin,
          data: message,
          ports,
        }),
      );
    },
    probeNonce() {
      const probe = postedMessages.findLast(
        (message: any) => message?.channel === "ai-footprint-probe-v1",
      ) as { nonce?: unknown } | undefined;
      assert.equal(typeof probe?.nonce, "string");
      return probe!.nonce as string;
    },
    captureReady(interception: "direct" | "monitored" | "unverified" | "missed") {
      const probe = postedMessages.findLast(
        (message: any) => message?.channel === "ai-footprint-probe-v1",
      ) as { nonce?: unknown } | undefined;
      assert.equal(typeof probe?.nonce, "string");
      dom.window.dispatchEvent(
        new dom.window.MessageEvent("message", {
          source: dom.window as unknown as Window,
          origin: dom.window.location.origin,
          data: {
            channel: "ai-footprint-ready-v1",
            nonce: probe!.nonce,
            interception,
          },
        }),
      );
    },
    tickIntervals() {
      intervalCallbacks.forEach((callback) => callback());
    },
    fireGraceTimers() {
      for (const callback of graceTimers.splice(0)) callback();
    },
    /** Waits before a capture frame is sent again that have not run yet (needs captureRetryDelays). */
    pendingRetryTimers() {
      return retryTimers.length;
    },
    fireRetryTimers() {
      for (const callback of retryTimers.splice(0)) callback();
    },
    /** Runs the composer scan the latest page mutations scheduled (needs captureScanTimer). */
    async runComposerScan() {
      // Mutation observers report at the next microtask checkpoint, then schedule the scan.
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(scanTimers.size, 1, "the page change schedules one composer scan");
      const callbacks = [...scanTimers.values()];
      scanTimers.clear();
      for (const callback of callbacks) callback();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    postFileMessage(message: unknown) {
      dom.window.dispatchEvent(
        new dom.window.MessageEvent("message", {
          source: dom.window as unknown as Window,
          origin: dom.window.location.origin,
          data: message,
        }),
      );
    },
    currentCaptureBinding() {
      return captureBinding ? { ...captureBinding } : null;
    },
    deliverDisplay(
      binding: any,
      conversationIdentity: any,
      requestCount: string,
      live: {
        state?: string;
        calculationPending?: boolean;
        input?: string | null;
        output?: string | null;
        /** A whole summary in place of the empty one with requestCount. */
        summary?: any;
      } = {},
    ) {
      const summary: any = live.summary ?? {
        ...new SummaryAccumulator().result(),
        requests: Number(requestCount),
      };
      if (live.input !== undefined || live.output !== undefined)
        summary.tokens = {
          ...summary.tokens,
          input: { ...summary.tokens.input, value: live.input ?? null },
          output: { ...summary.tokens.output, value: live.output ?? null },
        };
      receiver!({
        target: "footprint-display",
        displayBinding: binding,
        conversationIdentity,
        mode: "personal",
        // A display after the reply's end, with its estimate: its final figures.
        state: live.state ?? "completed",
        ...(live.calculationPending !== undefined
          ? { calculationPending: live.calculationPending }
          : {}),
        summary,
        conversation: null,
        queueCount: 0,
        activeContext: null,
        budget: null,
        budgetBasis: null,
        guidance: {
          show: false,
          ratio: null,
          state: { level: 0 },
          key: null,
        },
      });
    },
    calls,
    window: dom.window,
    invalidateRuntime(notify = true) {
      runtimeInvalidated = true;
      if (notify) invalidate();
    },
    close() {
      try {
        invalidate();
      } finally {
        dom.window.close();
      }
    },
  };
}

function fileSeries(
  extractionProfile: string,
  origin: "new_upload" | "retained_context" | "unknown_origin",
  value: string | null,
  partial = 0,
) {
  return {
    quantity: "extracted_file_text",
    scope: "extracted_file_text",
    unit: "tokens",
    additive: false,
    value,
    measurement_group: {
      origin,
      extraction_profile_id: extractionProfile,
      evidence: value === null ? "unknown" : "heuristic_estimate",
      profile_id: value === null ? null : "o200k-base-4.0.0-reference",
    },
    applicable_count: 1,
    contributing_component_count: value === null ? 0 : 1,
    unknown_count: value === null ? 1 : 0,
    partial_count: partial,
    unvalidated_count: value === null ? 0 : 1,
    reason_counts: {
      [value === null
        ? "tokenizer_unavailable"
        : "tokenizer_mapping_unverified"]: 1,
    },
    missing_counts: {
      provider_processing: 1,
      ocr: 1,
      retrieval_selection: 1,
    },
  };
}

function historicalSummary(overrides: Record<string, unknown> = {}): any {
  return {
    schema_version: "3.0.0",
    scope: "loaded_history",
    status: "available",
    observed_prompt_count: "2",
    observed_response_count: "2",
    prompt_count: "2",
    response_count: "2",
    dated_message_count: "3",
    undated_message_count: "1",
    calculated_message_count: "3",
    uncalculated_message_count: "1",
    matched_live_message_count: "0",
    unresolved_overlap_message_count: "1",
    conflicting_message_count: "0",
    first_request_verified: false,
    branch_scope: "selected_branch",
    provider_history_complete: false,
    file_text: [
      {
        quantity: "extracted_file_text",
        scope: "extracted_file_text",
        unit: "tokens",
        additive: false,
        value: "7",
        measurement_group: {
          origin: "unknown_origin",
          extraction_profile_id: "observed-inline-file-text-v1",
          evidence: "heuristic_estimate",
          profile_id: "o200k-base-4.0.0-reference",
        },
        applicable_count: 1,
        contributing_component_count: 1,
        unknown_count: 0,
        partial_count: 1,
        unvalidated_count: 1,
        reason_counts: { tokenizer_mapping_unverified: 1 },
        missing_counts: { provider_processing: 1, ocr: 1 },
      },
    ],
    file_text_coverage: {
      observed_message_count: "1",
      unknown_message_count: "0",
      scope: "extracted_file_text",
      additive: false,
    },
    tokens: [
      {
        role: "prompt",
        part: "total",
        profile_id: "o200k-base-4.0.0-reference",
        evidence: "heuristic_estimate",
        value: "17",
        known_message_count: "2",
        unknown_message_count: "0",
      },
      {
        role: "response",
        part: "total",
        profile_id: null,
        evidence: "unknown",
        value: null,
        known_message_count: "1",
        unknown_message_count: "1",
      },
    ],
    resources: [
      {
        quantity: "energy",
        value: "0.00041",
        unit: "kWh",
        scope: "historical_visible_response",
        method_id: "baseline-public-v1",
        method_hash: "a".repeat(64),
        status: "partial_estimate",
        validation_state: "unvalidated_reference",
        profile_selection: "highest_comparable",
        selected_profile_id: "synthetic-profile",
        reasons: ["partial_capture"],
        missing_components: [
          "provider_execution_unobserved",
          "hidden_reasoning_unobserved",
        ],
        known_message_count: "1",
        unknown_message_count: "1",
      },
    ],
    ...overrides,
  };
}

function historicalView(local: any, overrides: Record<string, unknown> = {}) {
  return {
    local,
    pending: null,
    server: null,
    server_status: "personal",
    coverage: "partial_loaded_history",
    ...overrides,
  };
}

function historicalRouteDisplay(history: any) {
  return {
    target: "footprint-display",
    mode: "personal",
    state: "dispatch_only",
    summary: new SummaryAccumulator().result(),
    conversation: null,
    recordedThread: null,
    history,
    queueCount: 0,
    activeContext: null,
    budget: null,
    budgetBasis: null,
    guidance: { show: false, ratio: null, state: { level: 0 }, key: null },
  };
}

function historicalMessages(
  conversationId: string,
  observationId: string,
  options: { first?: boolean; suffix?: string } = {},
) {
  const suffix = options.suffix ?? "201",
    promptId = `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`,
    responseId = `00000000-0000-4000-8000-${String(Number(suffix) + 1).padStart(
      12,
      "0",
    )}`,
    observedAt = "2026-09-14T12:00:00.000Z";
  const start = {
    channel: historyCapture.HISTORY_CAPTURE_CHANNEL,
    event: "start",
    id: observationId,
    site: "chatgpt",
    conversationId,
    observedAt,
    page: null,
  };
  return {
    start,
    page: {
      ...start,
      event: "page",
      page: {
        site: "chatgpt",
        conversationId,
        observedAt,
        messages: [
          {
            timing: null,
            sourceId: promptId,
            role: "prompt",
            promptSourceId: promptId,
            parentSourceId: null,
            parentRole: null,
            requestId: promptId,
            liveAttemptId: null,
            occurredAt: "2024-01-02T03:04:05.000Z",
            dateBasis: "message_created",
            modelId: null,
            text: "synthetic prompt",
            complete: true,
            inlineFiles: null,
          },
          {
            timing: null,
            sourceId: responseId,
            role: "response",
            promptSourceId: promptId,
            parentSourceId: promptId,
            parentRole: "prompt",
            requestId: null,
            liveAttemptId: responseId,
            occurredAt: null,
            dateBasis: "unknown",
            modelId: null,
            text: "synthetic response",
            complete: true,
            inlineFiles: null,
          },
        ],
        firstRequestVerified: options.first ?? false,
        rootSourceId: options.first ? promptId : null,
        selectedLeafId: responseId,
        branchSourceIds: [promptId, responseId],
        branchScope: "selected_branch",
        hasEarlier: options.first ? false : true,
        hasLater: false,
        status: "partial",
      },
    },
  };
}

test("sidebar-style navigation clears old figures immediately and rejects a late different-chat summary", async () => {
  const ids = [291, 292, 293].map(
    (id) => `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
  );
  const delayed = deferred<any>();
  const display = (count: number) => {
    const value = historicalRouteDisplay(null);
    value.summary.requests = count;
    return value;
  };
  const queried: string[] = [];
  const harness = await contentHarness(false, {
    url: `https://claude.ai/chat/${ids[0]}`,
    html: '<main><form><div class="ProseMirror" contenteditable="true" role="textbox"></div></form></main>',
    respond: (message) => {
      queried.push(message.conversationId);
      return message.conversationId === ids[1]
        ? delayed.promise
        : display(message.conversationId === ids[0] ? 6 : 23);
    },
  });
  const navigate = async (id: string) => {
    harness.document.defaultView!.history.pushState({}, "", `/chat/${id}`);
    harness.document.body.append(harness.document.createElement("div"));
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  try {
    const shadow = await harness.loadRoute();
    assert.match(shadow.querySelector("[data-metrics]")!.textContent!, /Req 6/);
    await navigate(ids[1]!);
    assert.doesNotMatch(
      shadow.querySelector("[data-metrics]")!.textContent!,
      /Req 6/,
    );
    for (let i = 0; i < 40 && !queried.includes(ids[1]!); i++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(queried.includes(ids[1]!));
    await navigate(ids[2]!);
    for (
      let i = 0;
      i < 40 &&
      !shadow.querySelector("[data-metrics]")!.textContent!.includes("Req 23");
      i++
    )
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.match(
      shadow.querySelector("[data-metrics]")!.textContent!,
      /Req 23/,
    );
    delayed.resolve(display(11));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(
      shadow.querySelector("[data-metrics]")!.textContent!,
      /Req 23/,
    );
    assert.doesNotMatch(
      shadow.querySelector("[data-metrics]")!.textContent!,
      /Req (6|11)\b/,
    );
  } finally {
    delayed.resolve(display(11));
    harness.close();
  }
});

for (const notified of [true, false])
  test(`invalidated extension clears old totals when ${notified ? "cleanup is notified" : "navigation discovers a synchronous transport failure"}`, async () => {
    const first = "00000000-0000-4000-8000-000000000291";
    const next = "00000000-0000-4000-8000-000000000292";
    const harness = await contentHarness(false, {
      url: `https://chatgpt.com/c/${first}`,
      respond: () => historicalRouteDisplay(null),
    });
    try {
      const shadow = harness.render(null, { requestCount: 6 });
      const oldBinding = harness.currentCaptureBinding();
      assert.match(
        shadow.querySelector("[data-metrics]")!.textContent!,
        /Req 6/,
      );
      assert.doesNotThrow(() => harness.invalidateRuntime(notified));
      if (!notified) await harness.navigate(`/c/${next}`);
      assert.doesNotMatch(
        shadow.querySelector("[data-metrics]")!.textContent!,
        /Req 6/,
      );
      // The person can fix it, so the bar names the action (owner, 13 Oct 2026).
      assert.equal(
        barState(shadow),
        "Reload required (reload page)",
      );
      // Nothing shows on the bar (owner, 14 Oct 2026); Details opens with the reload action.
      assert.equal(
        shadow.querySelector("[data-metrics]")!.textContent,
        bar.BAR_NO_FIGURES,
      );
      const first = shadow.querySelector<HTMLElement>("[data-body] .dt-status")!;
      assert.match(first.textContent!, /Reload the page/);
      assert.ok(first.querySelector(".dt-reload"));
      harness.deliverDisplay(
        oldBinding,
        { site: "chatgpt", conversationId: first },
        "99",
      );
      assert.doesNotMatch(
        shadow.querySelector("[data-metrics]")!.textContent!,
        /Req (6|99)/,
      );
      assert.doesNotThrow(() => harness.invalidateRuntime());
    } finally {
      harness.close();
    }
  });

test("the bar shows no status or hover guidance; Details opens with Retry, which reads saved totals only", async () => {
  // Owner, 14 Oct 2026: the bar shows only figures and the Details control.
  const harness = await contentHarness(false, {
    url: "https://chatgpt.com/c/00000000-0000-4000-8000-000000000001",
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    captureGraceTimers: true,
  });
  try {
    const shadow = await harness.loadRoute();
    // The page's own read of the chat may still arrive during the grace period.
    assert.equal(shadow.querySelector("[data-metrics]")!.textContent, bar.BAR_PROCESSING);
    harness.fireGraceTimers();
    const label = shadow.querySelector<HTMLElement>("[data-status]")!;
    // The state element is hidden and has no role, tooltip or hover help (owner, 14 Oct 2026).
    assert.equal(label.textContent, "");
    assert.equal(label.hidden, true);
    assert.equal(label.hasAttribute("role"), false);
    assert.equal(label.hasAttribute("tabindex"), false);
    assert.equal(shadow.querySelector("[data-status-help], [role=tooltip], .status-wrap"), null);
    assert.equal(shadow.querySelector(".bar [role=status]"), null);
    assert.equal(shadow.querySelector("[data-route-retry]"), null);
    assert.equal(shadow.querySelector("[data-metrics]")!.textContent, bar.BAR_NO_FIGURES);
    // The state still reaches Details, at the top, with its action.
    assert.match(barState(shadow), /Conversation totals unavailable \(retry\)/);
    const first = [
      ...shadow.querySelectorAll<HTMLElement>("[data-body] .dt-status"),
    ].find((node) => /Totals unavailable/.test(node.textContent!))!;
    assert.ok(first);
    const callsBefore = harness.calls.filter(
      (call) => call.target === "conversation-summary",
    ).length;
    first.querySelector<HTMLButtonElement>(".dt-retry")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(
      harness.calls.filter((call) => call.target === "conversation-summary").length,
      callsBefore + 1,
    );
    assert.ok(harness.calls.every((call) => call.target !== "capture"));
  } finally {
    harness.close();
  }
});

test("organization sync state is a Details icon and never a bar status or hover guidance", async () => {
  // Owner, 13 Oct 2026: organization mode is local-first and sync runs in the background.
  const harness = await contentHarness();
  try {
    const shadow = harness.render({ offline: true });
    const label = shadow.querySelector<HTMLElement>("[data-status]")!;
    const sync = () =>
      shadow.querySelector<HTMLElement>("[data-sync-row] .dt-sync");
    assert.equal(label.textContent, "");
    assert.equal(shadow.querySelector("[data-status-help]"), null);
    assert.equal(label.hasAttribute("tabindex"), false);
    assert.doesNotMatch(
      shadow.querySelector("[data-metrics]")!.textContent!,
      /Company server|browser profile only|synced|snapshot/i,
    );
    assert.equal(sync()!.dataset.sync, "offline");
    assert.match(sync()!.getAttribute("aria-label")!, /cannot be reached/);
    // A current synced copy that adds a request from another browser is shown, still with
    // no sync label on the bar.
    harness.render({
      server: { request_count: "1", tokens: [], resources: [] },
      offline: false,
      source: "server",
    });
    assert.match(shadow.querySelector("[data-metrics]")!.textContent!, /^Req 1 · /);
    assert.equal(label.textContent, "");
    assert.equal(label.hasAttribute("aria-describedby"), false);
    assert.equal(sync()!.dataset.sync, "synced");
    assert.equal(sync()!.getAttribute("title"), "Synced with your organization.");
    // An organization that paused sharing says so, instead of Offline or Syncing.
    harness.render(
      { server: null, offline: false, source: "local" },
      { sharingPaused: true },
    );
    assert.equal(sync()!.dataset.sync, "paused");
    assert.match(sync()!.getAttribute("aria-label")!, /Your organization paused sharing/);
  } finally {
    harness.close();
  }
});

test("conductor: the actual entrypoint accepts the observed ChatGPT composer with a 24px footer gap", async () => {
  // Read-only in-app inspection on 10 September 2026: 1280x720, form bottom 696, display:contents parent.
  const harness = await contentHarness(true);
  try {
    const shadow = harness.render(
      {
        source: "local",
        server: null,
        pending: new SummaryAccumulator().result(),
        pendingObservationCount: 0,
        cachedAt: null,
        offline: true,
      },
      { state: "dispatch_only" },
    );
    // A request is on its way and has no figures yet: Processing, never Req 0 (owner, 14 Oct
    // 2026, afternoon).
    assert.equal(shadow.querySelector("[data-metrics]")!.textContent!, bar.BAR_PROCESSING);
  } finally {
    harness.close();
  }
});

test("conductor: open Details follows viewport and anchor movement without clipping its header", async () => {
  const harness = await contentHarness();
  try {
    const shadow = harness.render(null, { requestCount: 1 });
    const host = harness.document.querySelector<HTMLElement>(
      '[data-ai-footprint="information"]',
    )!;
    const view = harness.document.defaultView!;
    Object.defineProperty(view, "innerHeight", {
      value: 900,
      configurable: true,
    });
    let anchorRect = { top: 600, bottom: 640 };
    host.getBoundingClientRect = () => anchorRect as DOMRect;
    const detailsLink =
      shadow.querySelector<HTMLAnchorElement>("a[data-open]")!;
    assert.equal(detailsLink.textContent, "Details");
    assert.equal(shadow.querySelector("button[data-open]"), null);
    const click = new view.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    detailsLink.dispatchEvent(click);
    assert.equal(click.defaultPrevented, true);
    const panel = shadow.querySelector<HTMLElement>(".panel")!;
    assert.equal(detailsLink.getAttribute("href"), `#${panel.id}`);
    assert.equal(detailsLink.getAttribute("aria-expanded"), "true");
    assert.equal(panel.dataset.placement, "above");
    assert.equal(
      panel.style.getPropertyValue("--aft-panel-max-height"),
      "460px",
    );

    Object.defineProperty(view, "innerHeight", {
      value: 700,
      configurable: true,
    });
    anchorRect = { top: 367.825, bottom: 652.025 };
    view.dispatchEvent(new view.Event("resize"));
    await new Promise((resolve) => setTimeout(resolve, 5));
    const narrowHeight = Number.parseFloat(
      panel.style.getPropertyValue("--aft-panel-max-height"),
    );
    assert.ok(anchorRect.top - 6 - narrowHeight >= 12);
    assert.equal(panel.hidden, false);

    anchorRect = { top: 50, bottom: 300 };
    harness.document
      .querySelector("form")!
      .setAttribute("style", "padding:1px");
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(panel.dataset.placement, "below");
    assert.equal(
      panel.style.getPropertyValue("--aft-panel-max-height"),
      "382px",
    );
    assert.equal(
      shadow.querySelector<HTMLButtonElement>("[aria-label='Close details']")!
        .disabled,
      false,
    );
  } finally {
    harness.close();
  }
});

test("conductor: Claude mounts around the semantic no-form composer after an eligibility attribute change", async () => {
  const harness = await contentHarness(false, {
    url: "https://claude.ai/",
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    captureScanTimer: true,
    html: `<main>
      <fieldset style="display:none" data-perf-region="composer" data-cds-dock-group>
        <button data-testid="chat-input-attach">Attach</button>
        <button data-testid="model-selector-dropdown">Model</button>
        <div contenteditable="true" class="ProseMirror" data-testid="chat-input"></div>
        <button data-testid="chat-input-send">Send</button>
      </fieldset>
    </main>`,
  });
  try {
    await harness.popstate();
    assert.equal(
      harness.document.querySelector('[data-ai-footprint="information"]'),
      null,
    );

    const fieldset = harness.document.querySelector("fieldset")!;
    fieldset.removeAttribute("style");
    await harness.runComposerScan();

    const advice = harness.document.querySelector(
      '[data-ai-footprint="context-advice"]',
    );
    const information = harness.document.querySelector(
      '[data-ai-footprint="information"]',
    );
    assert.ok(advice);
    assert.ok(information);
    assert.equal(fieldset.previousElementSibling, advice);
    assert.equal(fieldset.nextElementSibling, information);
    assert.equal(fieldset.querySelectorAll("button").length, 3);
    assert.equal(
      harness.document.querySelectorAll('[data-ai-footprint="information"]')
        .length,
      1,
    );
  } finally {
    harness.close();
  }
});

test("conductor: mounted Claude hosts follow the unique eligible composer without touching native nodes", async () => {
  const harness = await contentHarness(false, {
    url: "https://claude.ai/",
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    captureScanTimer: true,
    html: `<main>
      <button id="native-navigation">Native navigation</button>
      <span id="unrelated"></span>
      <fieldset id="old" data-perf-region="composer" data-cds-dock-group>
        <div id="old-editor" contenteditable="true" class="ProseMirror"></div>
        <button data-testid="chat-input-send">Send</button>
      </fieldset>
      <fieldset id="next" style="display:none" data-perf-region="composer" data-cds-dock-group>
        <div id="next-editor" contenteditable="true" class="ProseMirror"></div>
        <button data-testid="chat-input-send">Send</button>
      </fieldset>
    </main>`,
  });
  const document = harness.document;
  const oldComposer = document.querySelector<HTMLElement>("#old")!;
  const nextComposer = document.querySelector<HTMLElement>("#next")!;
  const oldEditor = document.querySelector("#old-editor")!;
  const nextEditor = document.querySelector("#next-editor")!;
  try {
    await harness.popstate();
    assert.equal(
      oldComposer.nextElementSibling?.getAttribute("data-ai-footprint"),
      "information",
    );
    assert.equal(harness.activeDocumentListeners("pointerdown"), 1);
    assert.equal(harness.activeDocumentListeners("keydown"), 2);

    harness.resetDocumentQueryCounts();
    const unrelated = document.querySelector<HTMLElement>("#unrelated")!;
    for (let index = 0; index < 1000; index++)
      unrelated.className = `provider-churn-${index}`;
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(
      harness.documentQueryCount('[contenteditable="true"].ProseMirror'),
      1,
    );

    const nativeNavigation =
      document.querySelector<HTMLButtonElement>("#native-navigation")!;
    nativeNavigation.focus();
    harness.resetDocumentQueryCounts();
    const oldHost = oldComposer.nextElementSibling as HTMLElement;
    for (let index = 0; index < 1000; index++) {
      unrelated.className = `mixed-provider-churn-${index}`;
      oldHost.style.opacity = index % 2 ? "1" : "0.99";
    }
    oldComposer.style.display = "none";
    nextComposer.style.display = "block";
    await harness.runComposerScan();
    assert.equal(
      nextComposer.nextElementSibling?.getAttribute("data-ai-footprint"),
      "information",
    );
    assert.equal(document.activeElement, nativeNavigation);
    assert.ok(oldComposer.contains(oldEditor));
    assert.ok(nextComposer.contains(nextEditor));
    assert.equal(
      document.querySelectorAll('[data-ai-footprint="information"]').length,
      1,
    );
    assert.equal(harness.activeDocumentListeners("pointerdown"), 1);
    assert.equal(harness.activeDocumentListeners("keydown"), 2);
    assert.ok(
      harness.documentQueryCount('[contenteditable="true"].ProseMirror') <= 2,
    );

    oldComposer.style.display = "block";
    await harness.runComposerScan();
    assert.equal(
      document.querySelectorAll('[data-ai-footprint="information"]').length,
      0,
    );
    assert.equal(harness.activeDocumentListeners("pointerdown"), 0);
    assert.equal(harness.activeDocumentListeners("keydown"), 1);

    oldComposer.style.display = "none";
    await harness.runComposerScan();
    assert.equal(
      document.querySelectorAll('[data-ai-footprint="information"]').length,
      1,
    );
    assert.equal(harness.activeDocumentListeners("pointerdown"), 1);
    assert.equal(harness.activeDocumentListeners("keydown"), 2);

    nextComposer.remove();
    await harness.runComposerScan();
    assert.equal(
      document.querySelectorAll('[data-ai-footprint="information"]').length,
      0,
    );
    assert.equal(harness.activeDocumentListeners("pointerdown"), 0);
    assert.equal(harness.activeDocumentListeners("keydown"), 1);
    document.querySelector("main")!.append(nextComposer);
    await harness.runComposerScan();
    assert.equal(
      nextComposer.nextElementSibling?.getAttribute("data-ai-footprint"),
      "information",
    );
    assert.equal(
      document.querySelectorAll('[data-ai-footprint="information"]').length,
      1,
    );
    assert.equal(harness.activeDocumentListeners("pointerdown"), 1);
    assert.equal(harness.activeDocumentListeners("keydown"), 2);
  } finally {
    harness.close();
  }
});

test("conductor: Perplexity mounts outside the safe wrapper after exact editor eligibility changes", async () => {
  const harness = await contentHarness(false, {
    url: "https://www.perplexity.ai/",
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    captureScanTimer: true,
    html: `<main>
      <span style="display:block;position:static;overflow:visible">
        <div id="wrapper" data-test-composer-bounds style="display:block;position:relative;overflow:visible">
          <div data-test-composer-bounds style="display:grid;grid-template-columns:640px;overflow:visible">
            <div style="display:contents">
              <div style="display:grid;grid-template-columns:640px">
                <div id="ask-input" role="textbox" data-lexical-editor="true"></div>
                <button type="button" aria-label="Add files or tools">Add</button>
                <button type="button" aria-label="Submit" disabled>Submit</button>
              </div>
            </div>
          </div>
          <div aria-hidden="true">Decoration</div>
        </div>
      </span>
    </main>`,
  });
  try {
    await harness.popstate();
    assert.equal(
      harness.document.querySelector('[data-ai-footprint="information"]'),
      null,
    );

    harness.document
      .querySelector("#ask-input")!
      .setAttribute("contenteditable", "true");
    await harness.runComposerScan();

    const wrapper = harness.document.querySelector("#wrapper")!;
    const advice = harness.document.querySelector(
      '[data-ai-footprint="context-advice"]',
    );
    const information = harness.document.querySelector(
      '[data-ai-footprint="information"]',
    );
    assert.ok(advice);
    assert.ok(information);
    assert.equal(wrapper.previousElementSibling, advice);
    assert.equal(wrapper.nextElementSibling, information);
    assert.equal(wrapper.querySelectorAll("button").length, 2);
  } finally {
    harness.close();
  }
});

test("conductor: file receipts wait for capture commit and survive only proved route promotion", async () => {
  const captureAck = deferred<{ ok: boolean }>();
  const fileCalls: any[] = [];
  const promotedConversation = "00000000-0000-4000-8000-000000000024";
  const harness = await contentHarness(false, {
    url: "https://chatgpt.com/",
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    respondCapture: () => captureAck.promise,
    respondFile: (message) => {
      fileCalls.push(message);
      return message.target === "file-grant"
        ? {
            status: "granted",
            grant: "00000000-0000-4000-8000-000000000021",
            expiresAt: Date.now() + 10000,
          }
        : message.target === "file-receipt-bind"
          ? { bound: true }
          : message.target === "file-capture-association"
            ? { accepted: true }
            : { ok: true };
    },
  });
  const fileHandle = "00000000-0000-4000-8000-000000000022";
  try {
    harness.postFileMessage({
      channel: "ai-footprint-file-offer-v1",
      fileHandle,
      kind: "pdf",
      observedAt: Date.now(),
      offerId: "00000000-0000-4000-8000-000000000023",
      size: 256,
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(fileCalls[0]?.target, "file-grant");
    harness.render(null);
    const captureId = harness.currentCaptureBinding()!.captureId;
    harness.postFileMessage({
      channel: "ai-footprint-upload-association-v1",
      captureId,
      files: [{ fileHandle, origin: "new_upload" }],
      status: "matched",
      unmatchedReferenceCount: 0,
    });
    assert.equal(
      fileCalls.some((message) => message.target === "file-receipt-bind"),
      false,
    );
    harness.deliverDisplay(
      harness.currentCaptureBinding(),
      { site: "chatgpt", conversationId: promotedConversation },
      "1",
    );
    await harness.navigate(`/c/${promotedConversation}`);
    captureAck.resolve({ ok: true });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    const receipt = fileCalls.find(
      (message) => message.target === "file-receipt-bind",
    );
    assert.equal(receipt.captureId, captureId);
    assert.equal(receipt.fileHandle, fileHandle);
    const association = fileCalls.find(
      (message) => message.target === "file-capture-association",
    );
    assert.equal(association.binding.captureId, captureId);
    assert.equal(association.association.files[0].fileHandle, fileHandle);
    assert.deepEqual(
      harness.deliver(
        {
          target: "file-grant-check",
          binding: receipt.binding,
          fileHandle,
          captureId,
        },
        { id: "content-test-extension" },
      ),
      { current: true },
    );
    await harness.navigate("/c/00000000-0000-4000-8000-000000000025");
    assert.deepEqual(
      harness.deliver(
        {
          target: "file-grant-check",
          binding: receipt.binding,
          fileHandle,
          captureId,
        },
        { id: "content-test-extension" },
      ),
      { current: false },
    );
    assert.equal(
      fileCalls.some((message) => message.target === "file-grant-cancel"),
      true,
    );
  } finally {
    harness.close();
  }
});

test("conductor: malformed capture acknowledgement cannot bind or forward a file association", async () => {
  const fileCalls: any[] = [];
  const harness = await contentHarness(false, {
    url: "https://chatgpt.com/",
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    respondCapture: () => ({}),
    respondFile: (message) => {
      fileCalls.push(message);
      return message.target === "file-grant"
        ? {
            status: "granted",
            grant: "00000000-0000-4000-8000-000000000026",
            expiresAt: Date.now() + 10000,
          }
        : { accepted: true, bound: true };
    },
  });
  const fileHandle = "00000000-0000-4000-8000-000000000027";
  try {
    harness.postFileMessage({
      channel: "ai-footprint-file-offer-v1",
      fileHandle,
      kind: "pdf",
      observedAt: Date.now(),
      offerId: "00000000-0000-4000-8000-000000000028",
      size: 256,
    });
    await new Promise((resolve) => setImmediate(resolve));
    harness.render(null);
    const captureId = harness.currentCaptureBinding()!.captureId;
    harness.postFileMessage({
      channel: "ai-footprint-upload-association-v1",
      captureId,
      files: [{ fileHandle, origin: "new_upload" }],
      status: "matched",
      unmatchedReferenceCount: 0,
    });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      fileCalls.some((message) => message.target === "file-receipt-bind"),
      false,
    );
    assert.equal(
      fileCalls.some(
        (message) => message.target === "file-capture-association",
      ),
      false,
    );
    assert.equal(
      fileCalls.some((message) => message.target === "file-grant-cancel"),
      true,
    );
  } finally {
    harness.close();
  }
});

test("conductor: a different new-chat route resets the offered file before a late capture acknowledgement", async () => {
  const captureAck = deferred<{ ok: boolean }>();
  const fileCalls: any[] = [];
  const conversationA = "00000000-0000-4000-8000-000000000031";
  const conversationB = "00000000-0000-4000-8000-000000000032";
  const harness = await contentHarness(false, {
    url: "https://chatgpt.com/",
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    respondCapture: () => captureAck.promise,
    respondFile: (message) => {
      fileCalls.push(message);
      return message.target === "file-grant"
        ? {
            status: "granted",
            grant: "00000000-0000-4000-8000-000000000033",
            expiresAt: Date.now() + 10000,
          }
        : { accepted: true, bound: true };
    },
  });
  const fileHandle = "00000000-0000-4000-8000-000000000034";
  try {
    harness.postFileMessage({
      channel: "ai-footprint-file-offer-v1",
      fileHandle,
      kind: "pdf",
      observedAt: Date.now(),
      offerId: "00000000-0000-4000-8000-000000000035",
      size: 256,
    });
    await new Promise((resolve) => setImmediate(resolve));
    harness.render(null);
    const binding = harness.currentCaptureBinding()!;
    harness.postFileMessage({
      channel: "ai-footprint-upload-association-v1",
      captureId: binding.captureId,
      files: [{ fileHandle, origin: "new_upload" }],
      status: "matched",
      unmatchedReferenceCount: 0,
    });
    harness.deliverDisplay(
      binding,
      { site: "chatgpt", conversationId: conversationA },
      "1",
    );
    await harness.navigate(`/c/${conversationB}`);
    captureAck.resolve({ ok: true });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      fileCalls.some((message) => message.target === "file-receipt-bind"),
      false,
    );
    assert.equal(
      fileCalls.some(
        (message) => message.target === "file-capture-association",
      ),
      false,
    );
    assert.equal(
      fileCalls.some((message) => message.target === "file-grant-cancel"),
      true,
    );
    assert.deepEqual(
      harness.deliver(
        {
          target: "file-grant-check",
          binding: {
            ...binding,
            captureId: null,
          },
          fileHandle,
          captureId: null,
        },
        { id: "content-test-extension" },
      ),
      { current: false },
    );
  } finally {
    harness.close();
  }
});

test("conductor: actual company content shows an unconfirmed queued update even with zero usage", async () => {
  const harness = await contentHarness();
  try {
    const conversation = {
      source: "server",
      offline: false,
      cachedAt: Date.now(),
      server: { request_count: "99", tokens: [], resources: [] },
      pending: new SummaryAccumulator().result(),
      pendingObservationCount: 1,
    };
    const pending = harness.render(conversation);
    // With no request in this browser, the member's synced requests show instead of zero,
    // and sync state is a Details icon, never bar text (owner, 13 Oct 2026).
    assert.match(
      pending.querySelector("[data-metrics]")!.textContent!,
      /^Req 99 · /,
    );
    assert.doesNotMatch(
      pending.querySelector("[data-metrics]")!.textContent!,
      /synced|waiting/i,
    );
    assert.equal(pending.querySelector(".bar [role=status]"), null);
    assert.equal(pending.querySelector<HTMLElement>("[data-status]")!.textContent, "");
    const sync = () =>
      pending.querySelector<HTMLElement>("[data-sync-row] .dt-sync")!.dataset
        .sync;
    assert.equal(sync(), "syncing");
    (pending.querySelector("[data-open]") as HTMLElement).click();
    assert.equal(
      (pending.querySelector(".panel") as HTMLElement).hidden,
      false,
    );
    assert.match(
      pending.querySelector("[data-body]")!.textContent!,
      /1 measurement update is waiting/,
    );
    assert.match(
      pending.querySelector("[data-body]")!.textContent!,
      /your records from paired browsers for this conversation/,
    );

    const acknowledged = harness.render({
      ...conversation,
      pendingObservationCount: 0,
    });
    assert.equal(sync(), "synced");
    assert.doesNotMatch(
      acknowledged.querySelector("[data-body]")!.textContent!,
      /Waiting to synchronize/,
    );
  } finally {
    harness.close();
  }
});

test("conductor: synced compact totals keep unavailable water compact and list its parts in Details", async () => {
  const harness = await contentHarness();
  try {
    const shadow = harness.render({
      source: "server",
      offline: false,
      cachedAt: Date.now(),
      server: {
        request_count: "2",
        tokens: [],
        resources: [
          {
            quantity: "water_total",
            value: null,
            unit: "L",
            unknown_count: "1",
          },
          {
            quantity: "water_direct",
            value: "1",
            unit: "L",
            unknown_count: "0",
          },
          {
            quantity: "water_upstream",
            value: "2",
            unit: "L",
            unknown_count: "0",
          },
        ],
      },
      pending: null,
      pendingObservationCount: 0,
    });
    const text = shadow.querySelector("[data-metrics]")!.textContent!;
    assert.match(text, /Water Unknown/);
    assert.doesNotMatch(text, /Combined water|Direct water|Electricity-supply/);
    assert.doesNotMatch(text, /Water ≈ 3 L/, "parts are never summed");
    const details = shadow.querySelector("[data-body]")!.textContent!;
    assert.match(details, /Direct cooling water/);
    assert.match(details, /Electricity-supply water/);
  } finally {
    harness.close();
  }
});

test("conductor: in-chat Details keeps inline and local file-text profiles separate from main totals", async () => {
  const harness = await contentHarness();
  try {
    const base = new SummaryAccumulator().result();
    const shadow = harness.render(
      {
        source: "local",
        server: null,
        pending: null,
        pendingObservationCount: 0,
        cachedAt: null,
        offline: false,
      },
      {
        summary: {
          ...base,
          requests: 2,
          file_text: [
            fileSeries(
              "local-file-text-utf8-pdfjs6.3.289-opc-v1",
              "new_upload",
              "9223372036854775807",
            ),
            fileSeries(
              "observed-inline-file-text-v1",
              "unknown_origin",
              "7",
              1,
            ),
          ],
          file_text_coverage: {
            observed_request_count: "9223372036854775807",
            unknown_request_count: "1",
            scope: "extracted_file_text",
            additive: false,
          },
        },
      },
    );
    const metrics = shadow.querySelector("[data-metrics]")!.textContent!;
    assert.doesNotMatch(metrics, /Extracted file text|extracted-file tokens/);
    const trigger = shadow.querySelector<HTMLElement>("[data-open]")!;
    trigger.focus();
    trigger.click();
    const details = shadow.querySelector("[data-body]")!.textContent!;
    assert.match(details, /Local Extracted file text/);
    assert.match(details, /Locally extracted file text · New upload/);
    assert.match(details, /Observed inline file text · Unknown origin/);
    assert.ok(
      details.includes(formatters.formatInteger("9223372036854775807")),
    );
    assert.match(details, /7 observed inline file-text tokens/);
    assert.match(details, /Partial1/);
    assert.match(details, /Requests with unknown extraction state1/);
    assert.match(details, /original file fidelity/);
    assert.match(details, /provider OCR, retrieval or processing/);
    assert.doesNotMatch(details, /9223372036854775814/);
    shadow.querySelector<HTMLButtonElement>("[data-close]")!.click();
    assert.equal(shadow.activeElement, trigger);
  } finally {
    harness.close();
  }
});

// The image benchmark data was removed on 20 October 2026. Results saved before then can still
// hold its references; Details no longer shows them.
test("conductor: in-chat Details do not list image benchmark references of saved results", async () => {
  const harness = await contentHarness();
  try {
    const reference = (cohort_id: string, width: number | null) => ({
      profile_selection: "reference_only",
      reference_only: true,
      gpu_kwh: null,
      cohort_id,
      known_settings: { width, height: width },
    });
    const shadow = harness.render(
      {
        source: "local",
        server: null,
        pending: null,
        pendingObservationCount: 0,
        cachedAt: null,
        offline: false,
      },
      {
        summary: {
          ...new SummaryAccumulator().result(),
          requests: 2,
          estimate: {
            requested_method: { method_id: "synthetic" },
            image_references: [reference("first-reply-cohort", 512)],
          },
        },
      },
    );
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    const details = shadow.querySelector("[data-body]")!.textContent!;
    assert.doesNotMatch(details, /image benchmark/i);
    assert.doesNotMatch(details, /first-reply-cohort/);
  } finally {
    harness.close();
  }
});

test("conductor: the NotebookLM bar sits below the rounded query box in the query field's font", async () => {
  // The layout seen on 5 October 2026, reduced to the boxes that decide the placement.
  const harness = await contentHarness(false, {
    url: "https://notebook.google.com/notebook/00000000-0000-4000-8000-000000000501",
    html: `<main><div class="query-box" style="display:flex;flex-direction:column"><div class="input-group" data-test-composer-bounds style="display:flex;flex-direction:row"><form style="display:flex;flex-direction:column"><textarea class="query-box-input" aria-label="Query box" style="font-family:'Google Sans Flex'"></textarea><button type="button" aria-label="Submit">Send</button></form></div></div><div class="disclaimer">NotebookLM can be inaccurate.</div></main>`,
    respond: () => historicalRouteDisplay(null),
  });
  try {
    harness.render({
      source: "local",
      server: null,
      pending: null,
      pendingObservationCount: 0,
      cachedAt: null,
      offline: false,
    });
    const document = harness.document;
    const bar = document.querySelector<HTMLElement>(
      '[data-ai-footprint="information"]',
    )!;
    const advice = document.querySelector<HTMLElement>(
      '[data-ai-footprint="context-advice"]',
    )!;
    const group = document.querySelector(".input-group")!;
    assert.equal(bar.previousElementSibling, group);
    assert.equal(bar.parentElement, document.querySelector(".query-box"));
    assert.equal(advice.nextElementSibling, group);
    // The rounded box has no font of its own; the query field has the site's.
    assert.match(bar.style.fontFamily, /Google Sans Flex/);
    assert.match(advice.style.fontFamily, /Google Sans Flex/);
  } finally {
    harness.close();
  }
});

test("conductor: synced and waiting file-text sections remain separate and missing coverage is unknown", async () => {
  const harness = await contentHarness();
  try {
    const pending = {
      ...new SummaryAccumulator().result(),
      file_text: [
        fileSeries(
          "local-file-text-utf8-pdfjs6.3.289-opc-v1",
          "retained_context",
          "5",
        ),
      ],
      file_text_coverage: {
        observed_request_count: "1",
        unknown_request_count: "0",
        scope: "extracted_file_text",
        additive: false,
      },
    };
    const shadow = harness.render({
      source: "server",
      offline: false,
      cachedAt: Date.now(),
      server: {
        request_count: "3",
        tokens: [],
        resources: [],
        file_text: [
          fileSeries("observed-inline-file-text-v1", "unknown_origin", "12", 1),
        ],
        file_text_coverage: {
          observed_request_count: "3",
          unknown_request_count: "1",
          scope: "extracted_file_text",
          additive: false,
        },
      },
      pending,
      pendingObservationCount: 1,
    });
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    const details = shadow.querySelector("[data-body]")!.textContent!;
    assert.match(details, /Synced Extracted file text/);
    assert.match(details, /12 observed inline file-text tokens/);
    assert.match(details, /Waiting local Extracted file text/);
    assert.match(details, /5 locally extracted tokens/);
    assert.match(details, /Retained conversation context/);
    assert.match(details, /not added to matched or synced totals/);
    assert.doesNotMatch(
      details,
      /17 (?:extracted-file|locally extracted|observed inline file-text) tokens/,
    );

    const missing = harness.render({
      source: "server",
      offline: false,
      cachedAt: null,
      server: { request_count: "1", tokens: [], resources: [] },
      pending: null,
      pendingObservationCount: 0,
    });
    (missing.querySelector("[data-open]") as HTMLElement).click();
    assert.match(
      missing.querySelector("[data-body]")!.textContent!,
      /Document text extraction is unknown for this view/,
    );
    assert.doesNotMatch(
      missing.querySelector("[data-body]")!.textContent!,
      /zero provider file processing[^.]*\b0\b/,
    );
  } finally {
    harness.close();
  }
});

test("conductor: actual company content shows an uncached network failure in Details, not on the bar", async () => {
  // Owner, 13 Oct 2026: local-first, with the sync state as a Details icon.
  const harness = await contentHarness();
  try {
    const shadow = harness.render({
      source: "local",
      server: null,
      pending: new SummaryAccumulator().result(),
      pendingObservationCount: 0,
      cachedAt: null,
      offline: true,
    });
    assert.equal(shadow.querySelector(".bar [role=status]"), null);
    assert.equal(shadow.querySelector<HTMLElement>("[data-status]")!.textContent, "");
    assert.doesNotMatch(
      shadow.querySelector("[data-metrics]")!.textContent!,
      /Company server|browser profile only/,
    );
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    assert.match(
      shadow.querySelector("[data-body]")!.textContent!,
      /cover this browser profile only/,
    );
    const sync = shadow.querySelector<HTMLElement>("[data-sync-row] .dt-sync")!;
    assert.equal(sync.dataset.sync, "offline");
    assert.equal(sync.textContent, "Offline");
  } finally {
    harness.close();
  }
});

test("conductor: route-summary failure is visible and retries safely on the same route", async () => {
  const routeUrl = "https://chatgpt.com/c/00000000-0000-4000-8000-000000000001";
  const success = {
    target: "footprint-display",
    mode: "personal",
    state: "dispatch_only",
    summary: { ...new SummaryAccumulator().result(), requests: 4 },
    conversation: null,
    queueCount: 0,
    activeContext: null,
    budget: null,
    budgetBasis: null,
    guidance: { show: false, ratio: null, state: { level: 0 }, key: null },
  };
  const harness = await contentHarness(false, {
    url: routeUrl,
    respond: (_message, call) =>
      call < 3
        ? { error: "Recorded conversation totals are unavailable." }
        : success,
    captureGraceTimers: true,
  });
  try {
    const shadow = await harness.loadRoute();
    // Once the wait for the page's own read of the chat ends, nothing more is pending.
    harness.fireGraceTimers();
    assert.equal(
      barState(shadow),
      // Both offer Retry, named once (owner, 13 Oct 2026).
      "Tracking problem · Conversation totals unavailable (retry)",
    );
    assert.equal(
      shadow.querySelector("[data-metrics]")!.textContent!,
      bar.BAR_NO_FIGURES,
    );
    const retry = () =>
      shadow.querySelector<HTMLButtonElement>("[data-body] .dt-retry");
    assert.ok(retry());
    retry()!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(
      harness.calls.filter((call) => call.target === "conversation-summary")
        .length,
      2,
    );

    await harness.popstate();
    assert.equal(
      harness.calls.filter((call) => call.target === "conversation-summary")
        .length,
      3,
    );
    assert.match(shadow.querySelector("[data-metrics]")!.textContent!, /^Req 4 · /);
    assert.equal(retry(), null);
    assert.ok(harness.calls.every((call) => call.target !== "capture"));
  } finally {
    harness.close();
  }
});

test("conductor: loading and failed saved totals retain page diagnostics and unverified coverage", async () => {
  const routeResult = deferred<unknown>();
  const harness = await contentHarness(false, {
    url: "https://chatgpt.com/",
    respond: () => routeResult.promise,
    respondCapture: () => ({
      ok: false,
      code: "storage_write_failed",
    }),
  });
  try {
    harness.captureReady("unverified");
    harness.render(null, { requestCount: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    await harness.navigate("/c/00000000-0000-4000-8000-000000000102");
    const host = harness.document.querySelector(
      '[data-ai-footprint="information"]',
    )!;
    const shadow = harness.shadowFor(host)!;
    // Loading is progress at the bottom of Details; the problem opens Details with its fix.
    const label = shadow.querySelector<HTMLElement>("[data-status]")!;
    assert.equal(label.textContent, "");
    assert.equal(label.dataset.actionable, "Tracking problem (free browser storage)");
    assert.equal(label.dataset.progress, "Loading conversation totals");
    assert.equal(
      shadow.querySelector("[data-progress-line]")!.textContent,
      "Loading saved totals",
    );
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    assert.match(
      shadow.querySelector("[data-body]")!.textContent!,
      /Capture coverage unverified.*Page tracking health/,
    );

    routeResult.resolve({
      error: "Recorded conversation totals are unavailable.",
      code: "ledger_integrity_failed",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(
      barState(shadow),
      /Tracking problem.*Conversation totals unavailable/,
    );
    const details = shadow.querySelector("[data-body]")!.textContent!;
    assert.match(details, /Reading saved conversation totals/);
    assert.match(details, /Page observation/);
  } finally {
    harness.close();
  }
});

test("conductor: a capture rejection is current until a later capture succeeds, then stays in Details", async () => {
  let captureCalls = 0;
  const harness = await contentHarness(false, {
    url: "https://chatgpt.com/",
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    respondCapture: () =>
      ++captureCalls === 1
        ? { ok: false, code: "storage_write_failed" }
        : { ok: true },
  });
  try {
    const shadow = harness.render(null, { requestCount: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(
      barState(shadow),
      /Tracking problem/,
    );
    harness.render(null, { requestCount: 2 });
    await new Promise((resolve) => setImmediate(resolve));
    // D7: the problem was genuine while it lasted; once capture works again it is an
    // earlier incident, listed in Details with its cause and times.
    assert.doesNotMatch(
      barState(shadow),
      /Tracking problem/,
    );
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    const details = shadow.querySelector("[data-body]")!.textContent!;
    assert.match(details, /Page tracking health/);
    assert.match(details, /Earlier problem/);
    assert.match(details, /storage_write_failed/);
    assert.match(details, /One or more observations could not be saved/);
    assert.doesNotMatch(details, /Some observations could not be saved/);
    assert.match(details, /Occurrences1/);
    assert.match(details, /First detected/);
    assert.match(details, /Last detected/);
  } finally {
    harness.close();
  }
});

test("conductor: a late save of an earlier frame does not clear a newer capture failure", async () => {
  const earlier = deferred<{ ok: boolean }>();
  const replies: Array<() => unknown> = [
    () => earlier.promise,
    () => ({ ok: false, code: "storage_write_failed" }),
    () => ({ ok: true }),
  ];
  const harness = await contentHarness(false, {
    url: "https://chatgpt.com/",
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    respondCapture: () => replies.shift()!(),
  });
  try {
    const shadow = harness.render(null, { requestCount: 1 });
    harness.render(null, { requestCount: 2 });
    await new Promise((resolve) => setImmediate(resolve));
    const status = () => barState(shadow);
    assert.match(status(), /Tracking problem/);
    // The first frame was received before the failure, so its save proves nothing new.
    earlier.resolve({ ok: true });
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(status(), /Tracking problem/);
    harness.render(null, { requestCount: 3 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.doesNotMatch(status(), /Tracking problem/);
  } finally {
    harness.close();
  }
});

test("conductor: Details explain how each part was estimated and what is left out, never on the bar", async () => {
  const harness = await contentHarness(false, {
    url: "https://chatgpt.com/",
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    respondCapture: () => ({ ok: true }),
  });
  try {
    const empty = new SummaryAccumulator().result();
    const summary = {
      ...empty,
      requests: 1,
      tokens: {
        ...empty.tokens,
        newInput: { ...empty.tokens.newInput, unknown: 1 },
        imageInput: { ...empty.tokens.imageInput, notApplicable: 1 },
      },
      estimation: {
        lines: [
          {
            role: "main",
            kind: "text",
            model: "chatgpt-gpt-6-astra",
            record: "openai/gpt-6-astra",
            basis: "exact_record",
            count: 1,
            unavailable: 0,
            tokens: "40",
            units: null,
            seconds: null,
            defaults: [],
            lengthFromText: false,
          },
        ],
        reasons: {},
        omitted: 0,
      },
    };
    const shadow = harness.render(null, { requestCount: 1, summary });
    await new Promise((resolve) => setImmediate(resolve));
    const bar = shadow.querySelector("[data-metrics]")!.textContent!;
    assert.doesNotMatch(bar, /EcoLogits|Not included|Partly measured/);
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    const details = shadow.querySelector("[data-body]")!.textContent!;
    assert.match(details, /How this was estimated/);
    assert.match(
      details,
      /GPT-6 Astra: 1 reply, estimated with its own EcoLogits record \(openai\/gpt-6-astra\)\./,
    );
    assert.match(details, /Not included/);
    assert.match(details, /The provider bills the full reasoning/);
    // Every token part is listed, and parts that were not read say so.
    assert.match(details, /Partly measured\. Not read: typed text/);
  } finally {
    harness.close();
  }
});

test("conductor: a Cowork send counts as observed for the capture watchdog (W5)", async () => {
  const session = "cse_0123456789ABCDEFghijklmn";
  const captured: number[] = [];
  class RecordingWatchdog extends watchdog.CaptureWatchdog {
    override captured(now: number) {
      captured.push(now);
      super.captured(now);
    }
  }
  const harness = await contentHarness(false, {
    url: `https://claude.ai/cowork/${session}`,
    html: '<main><form><div class="ProseMirror" contenteditable="true" role="textbox"></div></form></main>',
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    watchdogModule: {
      ...watchdog,
      CaptureWatchdog: RecordingWatchdog,
    } as unknown as typeof watchdog,
  });
  try {
    const nonce = harness.probeNonce();
    const at = new Date().toISOString();
    for (const data of [
      { channel: "ai-footprint-cowork-sent-v1", nonce: "x".repeat(36), at },
      {
        channel: "ai-footprint-cowork-sent-v1",
        nonce,
        at: new Date(Date.now() - 120000).toISOString(),
      },
      { channel: "ai-footprint-cowork-sent-v1", nonce, at, extra: 1 },
      { channel: "ai-footprint-cowork-sent-v1", nonce, at: "2026-10-04" },
    ])
      harness.postFileMessage(data);
    assert.deepEqual(captured, []);
    harness.postFileMessage({
      channel: "ai-footprint-cowork-sent-v1",
      nonce,
      at,
    });
    assert.deepEqual(captured, [Date.parse(at)]);
  } finally {
    harness.close();
  }
});

test("conductor: Details on a Cowork page name the provider's usage report and Cowork's own limits (W5)", async () => {
  const session = "cse_0123456789ABCDEFghijklmn";
  const harness = await contentHarness(false, {
    url: `https://claude.ai/cowork/${session}`,
    html: '<main><form><div class="ProseMirror" contenteditable="true" role="textbox"></div></form></main>',
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    respondCapture: () => ({ ok: true }),
  });
  try {
    const empty = new SummaryAccumulator().result();
    const summary = {
      ...empty,
      requests: 1,
      estimation: {
        lines: [
          {
            role: "main",
            kind: "text",
            model: "claude-sonnet-5-5",
            record: "anthropic/claude-sonnet-5-5",
            basis: "exact_record",
            count: 1,
            unavailable: 0,
            tokens: "433",
            units: null,
            seconds: null,
            defaults: [],
            lengthFromText: false,
          },
          {
            role: "side_calls",
            kind: "text",
            model: "claude-haiku-4-5",
            record: "anthropic/claude-haiku-4-5",
            basis: "exact_record",
            count: 1,
            unavailable: 0,
            tokens: "10",
            units: null,
            seconds: null,
            defaults: [],
            lengthFromText: false,
          },
        ],
        reasons: {},
        omitted: 0,
      },
    };
    const shadow = harness.render(null, { requestCount: 1, summary });
    await new Promise((resolve) => setImmediate(resolve));
    const bar = shadow.querySelector("[data-metrics]")!.textContent!;
    assert.doesNotMatch(bar, /usage report|Not included|first reply/);
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    const details = shadow.querySelector("[data-body]")!.textContent!;
    assert.match(
      details,
      /Output, reasoning and model names come from Claude's own usage report for the session/,
    );
    assert.match(details, /counted together in the first reply this browser saved/);
    assert.match(details, /Cowork sessions never opened in this browser are not counted/);
    assert.match(details, /not model work and are not counted/);
    assert.doesNotMatch(details, /The provider bills the full reasoning/);
    assert.doesNotMatch(details, /safety checks are not counted/);
  } finally {
    harness.close();
  }
});

test("conductor: saved conversation failure exposes its sanitized backend code and bounded retry effect", async () => {
  const harness = await contentHarness(false, {
    url: "https://www.perplexity.ai/search/00000000-0000-4000-8000-000000000099",
    respond: () => ({
      error: "The operation could not be completed.",
      code: "protocol_unsupported",
    }),
  });
  try {
    const shadow = await harness.loadRoute();
    assert.match(
      barState(shadow),
      /Conversation totals unavailable/,
    );
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    const details = shadow.querySelector("[data-body]")!.textContent!;
    assert.match(details, /Saved conversation totals unavailable/);
    assert.match(details, /protocol_unsupported/);
    assert.match(details, /Reading saved conversation totals/);
    assert.match(details, /does not indicate that new activity failed to save/);
    assert.match(details, /does not create an AI request/);
    assert.doesNotMatch(details, /00000000-0000-4000-8000-000000000099/);
  } finally {
    harness.close();
  }
});

test("conductor: route freshness challenge returns only scoped current state", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000100";
  const harness = await contentHarness(false, {
    url: `https://chatgpt.com/c/${conversationId}`,
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
  });
  try {
    await harness.loadRoute();
    const binding = harness.calls.find(
      (call) => call.target === "conversation-summary",
    )!.binding;
    const challenge = {
      target: "footprint-route-current",
      binding,
      conversationId,
      site: "chatgpt",
    };
    assert.equal(
      (
        (await harness.deliver(challenge, {
          id: "content-test-extension",
        })) as { current: boolean }
      ).current,
      true,
    );
    assert.equal(
      await harness.deliver(challenge, { id: "another-extension" }),
      undefined,
    );
    assert.equal(
      (
        (await harness.deliver(
          { ...challenge, extra: true },
          { id: "content-test-extension" },
        )) as { current: boolean }
      ).current,
      false,
    );
    await harness.navigate("/c/00000000-0000-4000-8000-000000000101");
    assert.equal(
      (
        (await harness.deliver(challenge, {
          id: "content-test-extension",
        })) as { current: boolean }
      ).current,
      false,
    );
    assert.equal(
      JSON.stringify(
        await harness.deliver(challenge, { id: "content-test-extension" }),
      ).includes(conversationId),
      false,
    );
  } finally {
    harness.close();
  }
});

test("conductor: route permission loss is visible and does not retry", async () => {
  let release!: (value: unknown) => void;
  const harness = await contentHarness(false, {
    url: "https://chatgpt.com/c/00000000-0000-4000-8000-000000000002",
    respond: () => new Promise((resolve) => (release = resolve)),
  });
  try {
    const shadow = await harness.loadRoute();
    harness.render({
      source: "server",
      server: { request_count: "99", tokens: [], resources: [] },
      pending: null,
      pendingObservationCount: 0,
      cachedAt: null,
      offline: false,
    });
    release({ error: "Site access was removed." });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(
      barState(shadow),
      "Site access removed (allow access)",
    );
    assert.equal(
      shadow.querySelector("[data-metrics]")!.textContent!,
      bar.BAR_NO_FIGURES,
    );
    assert.match(
      shadow.querySelector("[data-body]")!.textContent!,
      /Allow the extension on this site, then reload/,
    );
    assert.equal(shadow.querySelector("[data-body] .dt-retry"), null);
    await harness.popstate();
    assert.equal(
      harness.calls.filter((call) => call.target === "conversation-summary")
        .length,
      1,
    );
    const capturesBeforeDelayedDisplay = harness.calls.filter(
      (call) => call.target === "capture",
    ).length;
    harness.render({
      source: "server",
      server: { request_count: "100", tokens: [], resources: [] },
      pending: null,
      pendingObservationCount: 0,
      cachedAt: null,
      offline: false,
    });
    assert.equal(
      shadow.querySelector("[data-metrics]")!.textContent!,
      bar.BAR_NO_FIGURES,
    );
    assert.equal(
      harness.calls.filter((call) => call.target === "capture").length,
      capturesBeforeDelayedDisplay,
    );
  } finally {
    harness.close();
  }
});

test("conductor: capture permission loss rejects a delayed display until reload", async () => {
  const harness = await contentHarness();
  try {
    const shadow = harness.render({
      source: "local",
      server: null,
      pending: null,
      pendingObservationCount: 0,
      cachedAt: null,
      offline: false,
    });
    harness.deliver({ target: "capture-permission-lost" });
    harness.render({
      source: "server",
      server: { request_count: "101", tokens: [], resources: [] },
      pending: null,
      pendingObservationCount: 0,
      cachedAt: null,
      offline: false,
    });
    assert.equal(
      barState(shadow),
      "Site access removed (allow access)",
    );
    assert.equal(
      shadow.querySelector("[data-metrics]")!.textContent!,
      bar.BAR_NO_FIGURES,
    );
    assert.match(
      shadow.querySelector("[data-body]")!.textContent!,
      /Allow the extension on this site, then reload/,
    );
  } finally {
    harness.close();
  }
});

test("conductor: known-route display rejects late conversation and wrong-document replies", async () => {
  const conversationA = "00000000-0000-4000-8000-000000000020";
  const conversationB = "00000000-0000-4000-8000-000000000021";
  const harness = await contentHarness(false, {
    url: "https://chatgpt.com/",
    respond: () => ({
      target: "footprint-display",
      mode: "personal",
      state: "dispatch_only",
      summary: { ...new SummaryAccumulator().result(), requests: 5 },
      conversation: null,
      queueCount: 0,
      activeContext: null,
      budget: null,
      budgetBasis: null,
      guidance: { show: false, ratio: null, state: { level: 0 }, key: null },
    }),
  });
  try {
    const shadow = harness.render({
      source: "local",
      server: null,
      pending: null,
      pendingObservationCount: 0,
      cachedAt: null,
      offline: false,
    });
    const bindingA = harness.currentCaptureBinding();
    assert.ok(bindingA);
    await harness.navigate(`/c/${conversationB}`);
    assert.match(shadow.querySelector("[data-metrics]")!.textContent!, /5/);

    harness.deliverDisplay(
      bindingA,
      { site: "chatgpt", conversationId: conversationA },
      "99",
    );
    assert.doesNotMatch(
      shadow.querySelector("[data-metrics]")!.textContent!,
      /99/,
    );

    harness.deliverDisplay(
      {
        ...bindingA,
        documentNonce: "00000000-0000-4000-8000-000000000099",
      },
      { site: "chatgpt", conversationId: conversationB },
      "100",
    );
    assert.doesNotMatch(
      shadow.querySelector("[data-metrics]")!.textContent!,
      /100/,
    );
  } finally {
    harness.close();
  }
});

test("conductor: new-chat promotion accepts only the matching observed identity", async () => {
  const conversation = "00000000-0000-4000-8000-000000000030";
  const harness = await contentHarness(false, {
    url: "https://chatgpt.com/",
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
  });
  try {
    const shadow = harness.render({
      source: "local",
      server: null,
      pending: null,
      pendingObservationCount: 0,
      cachedAt: null,
      offline: false,
    });
    const binding = harness.currentCaptureBinding();
    assert.ok(binding);
    harness.deliverDisplay(
      binding,
      { site: "chatgpt", conversationId: conversation },
      "6",
    );
    await harness.navigate(`/c/${conversation}`);
    harness.deliverDisplay(
      binding,
      { site: "chatgpt", conversationId: conversation },
      "7",
    );
    assert.match(shadow.querySelector("[data-metrics]")!.textContent!, /7/);
    assert.doesNotMatch(
      shadow.querySelector("[data-metrics]")!.textContent!,
      /Recorded conversation totals are unavailable/,
    );
  } finally {
    harness.close();
  }
});

test("conductor: a new-chat route without a previously validated identity cannot promote the capture", async () => {
  const conversation = "00000000-0000-4000-8000-000000000036";
  const harness = await contentHarness(false, {
    url: "https://chatgpt.com/",
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
  });
  try {
    const shadow = harness.render({
      source: "local",
      server: null,
      pending: null,
      pendingObservationCount: 0,
      cachedAt: null,
      offline: false,
    });
    const binding = harness.currentCaptureBinding();
    assert.ok(binding);
    await harness.navigate(`/c/${conversation}`);
    harness.deliverDisplay(
      binding,
      { site: "chatgpt", conversationId: conversation },
      "77",
    );
    assert.doesNotMatch(
      shadow.querySelector("[data-metrics]")!.textContent!,
      /77/,
    );
  } finally {
    harness.close();
  }
});

// Gemini's composer container centres its text, which the bar inherited (12 Oct 2026).
test("conductor: the bar starts at its own edge and spans its column whatever the page's alignment", async () => {
  const harness = await contentHarness();
  try {
    const shadow = harness.render(null, { requestCount: 1 });
    assert.match(
      shadow.querySelector("style")!.textContent!,
      /:host\{[^}]*text-align:start/,
    );
    // Perplexity's home column centres its children, which shrank the bar (12 Oct 2026).
    for (const kind of ["information", "context-advice"])
      assert.equal(
        harness.document.querySelector<HTMLElement>(
          `[data-ai-footprint="${kind}"]`,
        )!.style.alignSelf,
        "stretch",
      );
  } finally {
    harness.close();
  }
});

// Owner, 12 Oct 2026: problems and coverage notes come at the end of Details, after every section.
test("conductor: Details lists the coverage note and problems after every section", async () => {
  const harness = await contentHarness();
  try {
    harness.captureReady("unverified");
    const shadow = harness.render(null, { requestCount: 1 });
    shadow.querySelector<HTMLElement>("[data-open]")!.click();
    const body = shadow.querySelector("[data-body]")!;
    const problems = body.querySelector(".dt-problems")!;
    assert.match(problems.textContent!, /Capture coverage unverified/);
    assert.match(problems.textContent!, /monitoring script or another extension/);
    const sections = [...body.querySelectorAll(".dt-section")];
    assert.ok(sections.length >= 3);
    for (const section of sections)
      assert.ok(
        section.compareDocumentPosition(problems) &
          harness.document.defaultView!.Node.DOCUMENT_POSITION_FOLLOWING,
        `${section.getAttribute("data-section")} comes before the problems`,
      );
    assert.equal(body.lastElementChild, problems);
    assert.equal(problems.closest(".dt-section"), null, "never inside a closed section");
  } finally {
    harness.close();
  }
});

// The site's monitoring SDK wraps fetch after the tracker; the browser's timing list shows
// whether requests still reach it (12 Oct 2026).
test("conductor: a monitored wrapper shows no coverage note and a missed request is a current problem", async () => {
  const state = {
    listener: "starting" as "starting" | "active" | "missing",
    interception: "unverified" as "direct" | "monitored" | "unverified" | "missed",
    lastCapturedAt: null as number | null,
    activityGap: false,
  };
  let reported = false;
  // The real watchdog's missed rule is covered in capture.test.ts; this one reports it the same way.
  class MissWatchdog {
    ready(_now: number, interception: typeof state.interception) {
      state.listener = "active";
      state.interception = interception;
    }
    sent() {}
    activity() {}
    captured() {}
    status() {
      return { ...state };
    }
    poll() {
      return { probe: false, refreshStatus: false };
    }
    check() {
      if (state.interception !== "missed" || reported) return null;
      reported = true;
      return "capture_hook_missing";
    }
  }
  const harness = await contentHarness(false, {
    url: "https://chatgpt.com/",
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    watchdogModule: {
      ...watchdog,
      CaptureWatchdog: MissWatchdog,
    } as unknown as typeof watchdog,
  });
  try {
    // The popup asks the tab itself; only the extension may ask (owner, 12 Oct 2026).
    // Answers come from the page realm; compare them by value.
    const ask = async () =>
      JSON.parse(
        JSON.stringify(
          await harness.deliver({ target: "page-health" }, { id: "content-test-extension" }),
        ),
      );
    assert.deepEqual(await ask(), { target: "page-health", problems: [] });
    assert.equal(
      harness.deliver({ target: "page-health" }, { id: "another-extension" }),
      undefined,
    );
    harness.captureReady("monitored");
    harness.tickIntervals();
    const shadow = harness.render(null, { requestCount: 1 });
    shadow.querySelector<HTMLElement>("[data-open]")!.click();
    let details = shadow.querySelector("[data-body]")!.textContent!;
    assert.doesNotMatch(details, /Capture coverage|Page tracking health/);
    assert.doesNotMatch(barState(shadow), /Tracking problem/);

    harness.captureReady("missed");
    harness.tickIntervals();
    harness.captureReady("missed");
    harness.tickIntervals();
    details = shadow.querySelector("[data-body]")!.textContent!;
    assert.match(details, /Capture coverage failed/);
    assert.match(details, /Current problem. A chat request on this page reached the network without passing the tracker/);
    assert.match(details, /capture_hook_missing/);
    assert.doesNotMatch(details, /Capture coverage unverified/);
    assert.match(barState(shadow), /Tracking problem/);

    // A later reply that is captured does not bring back the missed one (Codex review, 12 Oct).
    harness.render(null, { requestCount: 2 });
    details = shadow.querySelector("[data-body]")!.textContent!;
    assert.match(details, /Current problem. A chat request on this page reached the network/);
    assert.match(barState(shadow), /Tracking problem/);
    assert.deepEqual(await ask(), {
      target: "page-health",
      problems: [{ code: "capture_hook_missing", count: 1 }],
    });
  } finally {
    harness.close();
  }
});

// Gemini insets its narrow composer with side margins; the bar ran to the window edges (12 Oct 2026).
test("conductor: the bar and notice take the side margins of the composer they follow", async () => {
  const harness = await contentHarness(false, {
    url: "https://chatgpt.com/",
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    html: '<main><div style="display:flex;flex-direction:column"><form style="margin-left:16px;margin-right:12px"><textarea id="prompt-textarea" placeholder="Ask"></textarea></form></div></main>',
  });
  try {
    harness.render(null, { requestCount: 1 });
    for (const kind of ["information", "context-advice"]) {
      const host = harness.document.querySelector<HTMLElement>(
        `[data-ai-footprint="${kind}"]`,
      )!;
      assert.equal(host.style.marginLeft, "16px");
      assert.equal(host.style.marginRight, "12px");
    }
  } finally {
    harness.close();
  }
});

// The composers of ChatGPT and Perplexity have layers that Details opened underneath (12 Oct 2026).
test("conductor: Details rises above the composer only while it is open", async () => {
  const harness = await contentHarness();
  try {
    const shadow = harness.render(null, { requestCount: 1 });
    const host = harness.document.querySelector<HTMLElement>(
      '[data-ai-footprint="information"]',
    )!;
    const anchor = host.previousElementSibling as HTMLElement;
    anchor.style.position = "relative";
    anchor.style.zIndex = "30";
    const open = shadow.querySelector<HTMLElement>("[data-open]")!;
    assert.equal(host.style.zIndex, "1");
    open.click();
    assert.equal(host.style.zIndex, "2147483000");
    open.click();
    assert.equal(host.style.zIndex, "1", "menus that open over a closed bar stay on top");
    open.click();
    shadow.querySelector<HTMLButtonElement>("[data-close]")!.click();
    assert.equal(host.style.zIndex, "1");
  } finally {
    harness.close();
  }
});

// Since October 2026 a new ChatGPT chat opens at a provisional /c/local-chatgpt:<id>
// address and moves to /c/<uuid> before the reply's first frame names that chat (seen live
// 12 Oct 2026). The reply waits, bounded, for a display whose identity is the new route.
const LOCAL_CHATGPT = "/c/local-chatgpt%3A00000000-0000-4000-8000-0000000000a0";
test("conductor: a new ChatGPT chat shows the reply once its identity is the chat, after the provisional local address", async () => {
  const conversation = "00000000-0000-4000-8000-0000000000a1";
  const harness = await contentHarness(false, {
    url: "https://chatgpt.com/",
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
  });
  try {
    const shadow = harness.render(null, { requestCount: 1 });
    const binding = harness.currentCaptureBinding();
    assert.ok(binding);
    await harness.navigate(LOCAL_CHATGPT);
    await harness.navigate(`/c/${conversation}`);
    harness.deliverDisplay(binding, null, "5");
    assert.doesNotMatch(
      shadow.querySelector("[data-metrics]")!.textContent!,
      /Req 5/,
    );
    harness.deliverDisplay(
      binding,
      { site: "chatgpt", conversationId: conversation },
      "7",
    );
    assert.match(shadow.querySelector("[data-metrics]")!.textContent!, /Req 7/);
  } finally {
    harness.close();
  }
});

test("conductor: a new ChatGPT chat after the local address never shows a reply proven in another chat", async () => {
  const conversation = "00000000-0000-4000-8000-0000000000a2";
  const harness = await contentHarness(false, {
    url: "https://chatgpt.com/",
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
  });
  try {
    const shadow = harness.render(null, { requestCount: 1 });
    const binding = harness.currentCaptureBinding();
    await harness.navigate(LOCAL_CHATGPT);
    await harness.navigate(`/c/${conversation}`);
    harness.deliverDisplay(
      binding,
      {
        site: "chatgpt",
        conversationId: "00000000-0000-4000-8000-0000000000a3",
      },
      "8",
    );
    harness.deliverDisplay(
      binding,
      { site: "chatgpt", conversationId: conversation },
      "9",
    );
    assert.doesNotMatch(
      shadow.querySelector("[data-metrics]")!.textContent!,
      /Req [89]/,
    );
  } finally {
    harness.close();
  }
});

// Live, 19 Oct 2026: a new ChatGPT chat stopped before ChatGPT named the page stays on its
// local address. Its capture now ends as a stopped reply in the chat the hand-over named, so
// the bar shows the request instead of Waiting for your request, which the owner keeps for a
// chat where nothing was sent, and Details says why its figures are unknown.
test("conductor: a new ChatGPT chat stopped on its local address shows Req 1 and the stopped reply in Details", async () => {
  const conversation = "00000000-0000-4000-8000-0000000000a6";
  const harness = await contentHarness(false, {
    url: "https://chatgpt.com/",
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    respondCapture: () => ({ ok: true }),
  });
  try {
    const shadow = harness.render(null, { state: "dispatched" });
    const binding = harness.currentCaptureBinding();
    assert.ok(binding);
    await harness.navigate(LOCAL_CHATGPT);
    const empty = new SummaryAccumulator().result();
    const known = (value: string) => ({ ...empty.tokens.output, value, known: 1 });
    harness.deliverDisplay(binding, { site: "chatgpt", conversationId: conversation }, "1", {
      state: "cancelled",
      summary: {
        ...empty,
        requests: 1,
        attempts: 1,
        tokens: { ...empty.tokens, input: known("12"), output: known("0") },
        outcomes: { ...empty.outcomes, cancelled: 1 },
        metrics: {
          energy: { ...empty.metrics.energy, unknown: 1 },
          carbon: { ...empty.metrics.carbon, unknown: 1 },
          waterDirect: { ...empty.metrics.waterDirect, unknown: 1 },
          waterUpstream: { ...empty.metrics.waterUpstream, unknown: 1 },
          water: { ...empty.metrics.water, unknown: 1 },
        },
        stoppedWithoutAnswer: 1,
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    const bar = shadow.querySelector("[data-metrics]")!.textContent!;
    assert.match(bar, /^Req 1 · /);
    assert.doesNotMatch(bar, /Waiting for your request/);
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    assert.match(
      shadow.querySelector("[data-body]")!.textContent!,
      /Stopped reply not estimated/,
    );
    // Should ChatGPT still move the page to the chat's own address, the figures stay.
    await harness.navigate(`/c/${conversation}`);
    assert.match(shadow.querySelector("[data-metrics]")!.textContent!, /^Req 1 · /);
  } finally {
    harness.close();
  }
});

// A new chat's reply can run longer than the bounded promotion at its local address (a model
// that thinks for minutes). It stays current there, and its figures stay through the later
// move to the chat's own address.
test("conductor: a new ChatGPT chat's reply shown at its local address keeps its figures through the move after 30 s", async () => {
  const conversation = "00000000-0000-4000-8000-0000000000a7";
  const harness = await contentHarness(false, {
    url: "https://chatgpt.com/",
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    respondCapture: () => ({ ok: true }),
  });
  const clock = harness.window.Date;
  const realNow = clock.now;
  try {
    const shadow = harness.render(null, { state: "dispatched" });
    const binding = harness.currentCaptureBinding();
    assert.ok(binding);
    await harness.navigate(LOCAL_CHATGPT);
    harness.deliverDisplay(binding, { site: "chatgpt", conversationId: conversation }, "1");
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(shadow.querySelector("[data-metrics]")!.textContent!, /^Req 1 · /);
    const later = realNow.call(clock) + 31_000;
    clock.now = () => later;
    const current = (
      (await harness.deliver(
        {
          target: "footprint-capture-current",
          binding,
          conversationId: null,
          path: LOCAL_CHATGPT,
          site: "chatgpt",
        },
        { id: "content-test-extension" },
      )) as { current: boolean }
    ).current;
    assert.equal(current, true);
    await harness.navigate(`/c/${conversation}`);
    assert.match(shadow.querySelector("[data-metrics]")!.textContent!, /^Req 1 · /);
  } finally {
    clock.now = realNow;
    harness.close();
  }
});

// The background can ask before the page has handled the move (pushState has no event,
// and the page's own check waits for DOM changes). The reply must stay bound across both
// moves, and only for the new chat.
test("conductor: a new ChatGPT chat's waiting reply stays current across the local address, and only for that chat", async () => {
  const conversation = "00000000-0000-4000-8000-0000000000a4";
  const harness = await contentHarness(false, {
    url: "https://chatgpt.com/",
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
  });
  try {
    harness.render(null, { requestCount: 1 });
    const binding = harness.currentCaptureBinding();
    assert.ok(binding);
    const current = async (
      conversationId: string | null,
      captureBinding: unknown = binding,
    ) =>
      (
        (await harness.deliver(
          {
            target: "footprint-capture-current",
            binding: captureBinding,
            conversationId,
            path: "/",
            site: "chatgpt",
          },
          { id: "content-test-extension" },
        )) as { current: boolean }
      ).current;
    const history = harness.document.defaultView!.history;
    history.pushState({}, "", LOCAL_CHATGPT);
    assert.equal(await current(null), true);
    history.pushState({}, "", `/c/${conversation}`);
    assert.equal(await current(null), true);
    assert.equal(await current(conversation), true);
    assert.equal(
      await current("00000000-0000-4000-8000-0000000000a5"),
      false,
    );
    assert.equal(
      await current(null, { ...binding, captureId: crypto.randomUUID() }),
      false,
    );
  } finally {
    harness.close();
  }
});

// A new Perplexity thread opens at its first answer's id, and the background can prove
// the answer is in it only after that (owner, 5 Oct 2026).
for (const provisional of [true, false])
  test(`conductor: a new Perplexity thread shows the reply sent outside it once its identity is the thread${provisional ? " (after a provisional address)" : ""}`, async () => {
    const thread = "00000000-0000-4000-8000-000000000037";
    const harness = await contentHarness(false, {
      url: "https://www.perplexity.ai/",
      respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    });
    try {
      const shadow = harness.render(null, { requestCount: 1 });
      const binding = harness.currentCaptureBinding();
      assert.ok(binding);
      if (provisional)
        await harness.navigate("/search/new/00000000-0000-4000-8000-000000000038");
      await harness.navigate(`/search/${thread}`);
      // Displays before the link carry no identity and are not shown on the thread.
      harness.deliverDisplay(binding, null, "5");
      assert.doesNotMatch(
        shadow.querySelector("[data-metrics]")!.textContent!,
        /Req 5/,
      );
      harness.deliverDisplay(
        binding,
        { site: "perplexity", conversationId: thread },
        "7",
      );
      assert.match(
        shadow.querySelector("[data-metrics]")!.textContent!,
        /Req 7/,
      );
    } finally {
      harness.close();
    }
  });

test("conductor: a new Perplexity thread never shows a reply proven in another thread", async () => {
  const thread = "00000000-0000-4000-8000-000000000039";
  const harness = await contentHarness(false, {
    url: "https://www.perplexity.ai/",
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
  });
  try {
    const shadow = harness.render(null, { requestCount: 1 });
    const binding = harness.currentCaptureBinding();
    await harness.navigate(`/search/${thread}`);
    harness.deliverDisplay(
      binding,
      {
        site: "perplexity",
        conversationId: "00000000-0000-4000-8000-000000000040",
      },
      "8",
    );
    harness.deliverDisplay(
      binding,
      { site: "perplexity", conversationId: thread },
      "9",
    );
    assert.doesNotMatch(
      shadow.querySelector("[data-metrics]")!.textContent!,
      /Req [89]/,
    );
  } finally {
    harness.close();
  }
});

// The background asks whether a reply is still current when the browser reports a new
// address. A new Perplexity thread's reply that waits for its proof must stay bound, or
// its live figures are dropped (seen 5 Oct 2026).
test("conductor: a new Perplexity thread's waiting reply stays current while the thread opens, and only for that thread", async () => {
  const thread = "00000000-0000-4000-8000-000000000041";
  const harness = await contentHarness(false, {
    url: "https://www.perplexity.ai/",
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
  });
  try {
    harness.render(null, { requestCount: 1 });
    const binding = harness.currentCaptureBinding();
    assert.ok(binding);
    await harness.navigate(`/search/${thread}`);
    const current = async (
      conversationId: string | null,
      captureBinding: unknown = binding,
    ) =>
      (
        (await harness.deliver(
          {
            target: "footprint-capture-current",
            binding: captureBinding,
            conversationId,
            path: `/search/${thread}`,
            site: "perplexity",
          },
          { id: "content-test-extension" },
        )) as { current: boolean }
      ).current;
    assert.equal(await current(null), true);
    // A check that names another thread is not answered for this one.
    assert.equal(
      await current("00000000-0000-4000-8000-000000000042"),
      false,
    );
    // Nor is another capture's binding.
    assert.equal(
      await current(null, { ...binding, captureId: crypto.randomUUID() }),
      false,
    );
  } finally {
    harness.close();
  }
});

test("conductor: an older capture cannot replace the selected capture", async () => {
  const harness = await contentHarness();
  try {
    const shadow = harness.render({
      source: "server",
      server: { request_count: "1", tokens: [], resources: [] },
      pending: null,
      pendingObservationCount: 0,
      cachedAt: null,
      offline: false,
    });
    const older = harness.currentCaptureBinding();
    harness.render({
      source: "server",
      server: { request_count: "2", tokens: [], resources: [] },
      pending: null,
      pendingObservationCount: 0,
      cachedAt: null,
      offline: false,
    });
    harness.deliverDisplay(older, null, "88");
    assert.match(shadow.querySelector("[data-metrics]")!.textContent!, /Req 2/);
    assert.doesNotMatch(
      shadow.querySelector("[data-metrics]")!.textContent!,
      /88/,
    );
  } finally {
    harness.close();
  }
});

// ChatGPT read aloud (G1): its own capture, which speaks a reply already shown.
function readAloudFrames(conversationId: string) {
  const base = {
    timing: null,
    channel: "ai-footprint-observation-v1",
    version: 1,
    id: "00000000-0000-4000-8000-0000000000a1",
    site: "chatgpt",
    failure: null,
  };
  return {
    dispatch: {
      ...base,
      revision: 1,
      event: "dispatch",
      at: new Date().toISOString(),
      dispatch: {
        site: "chatgpt",
        action: "read_aloud",
        input: "",
        conversationId,
        parentId: null,
        requestId: null,
        model: null,
        attachments: 0,
        imageEditParentId: null,
        inputImages: [],
      },
      snapshot: null,
    },
    end: {
      ...base,
      revision: 2,
      event: "end",
      at: new Date().toISOString(),
      dispatch: null,
      snapshot: {
        ...adapters.initialSnapshot(),
        text: "",
        thinking: "",
        toolInput: "",
        intermediate: "",
        toolOutput: "",
        started: true,
        state: "completed",
        conversationId,
        media: [
          { kind: "speech", basis: "audio_frames", seconds: 10.24, characters: null },
        ],
      },
    },
  };
}
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

test("conductor: read aloud never replaces the reply the bar shows (G1)", async () => {
  const conversation = "00000000-0000-4000-8000-000000000051";
  const identity = { site: "chatgpt", conversationId: conversation };
  const harness = await contentHarness(false, {
    url: `https://chatgpt.com/c/${conversation}`,
    respond: () => historicalRouteDisplay(undefined),
  });
  try {
    await harness.loadRoute();
    const shadow = harness.render(null, { requestCount: 1 });
    const reply = harness.currentCaptureBinding();
    const reads = () =>
      harness.calls.filter((call) => call.target === "conversation-summary").length;
    const before = reads();
    const frames = readAloudFrames(conversation);
    harness.postThreadHistory(frames.dispatch);
    harness.postThreadHistory(frames.end);
    await settle();
    // Both frames are saved under the read aloud's own binding.
    const saved = harness.calls.filter((call) => call.target === "capture");
    assert.deepEqual(
      saved.slice(-2).map((call) => [call.payload.event, call.binding.captureId]),
      [
        ["dispatch", frames.dispatch.id],
        ["end", frames.dispatch.id],
      ],
    );
    // The reply stays selected: the background shows it again with the new totals.
    harness.deliverDisplay(reply, identity, "7");
    assert.match(shadow.querySelector("[data-metrics]")!.textContent!, /Req 7/);
    // A display bound to the read aloud is never shown, and the live reply is not
    // replaced by a read of saved totals.
    harness.deliverDisplay(harness.currentCaptureBinding(), identity, "88");
    assert.doesNotMatch(shadow.querySelector("[data-metrics]")!.textContent!, /88/);
    assert.equal(reads(), before);
  } finally {
    harness.close();
  }
});

test("conductor: read aloud on saved totals reads them again once its speech is saved (G1)", async () => {
  const conversation = "00000000-0000-4000-8000-000000000052";
  const harness = await contentHarness(false, {
    url: `https://chatgpt.com/c/${conversation}`,
    respond: (_message, call) => ({
      ...historicalRouteDisplay(undefined),
      summary: { ...new SummaryAccumulator().result(), requests: 3 + call },
    }),
  });
  try {
    const shadow = await harness.loadRoute();
    const reads = () =>
      harness.calls.filter((call) => call.target === "conversation-summary").length;
    assert.equal(reads(), 1);
    assert.match(shadow.querySelector("[data-metrics]")!.textContent!, /Req 4/);
    const frames = readAloudFrames(conversation);
    harness.postThreadHistory(frames.dispatch);
    await settle();
    // Nothing is read again until the speech is saved.
    assert.equal(reads(), 1);
    harness.postThreadHistory(frames.end);
    await settle();
    assert.equal(reads(), 2);
    assert.match(shadow.querySelector("[data-metrics]")!.textContent!, /Req 5/);
  } finally {
    harness.close();
  }
});

test("conductor: scope change clears old display and advice before a fresh route query", async () => {
  const conversation = "00000000-0000-4000-8000-000000000040";
  const harness = await contentHarness(false, {
    url: `https://chatgpt.com/c/${conversation}`,
    respond: () => ({
      target: "footprint-display",
      mode: "personal",
      state: "dispatch_only",
      summary: { ...new SummaryAccumulator().result(), requests: 3 },
      conversation: null,
      queueCount: 0,
      activeContext: null,
      budget: null,
      budgetBasis: null,
      guidance: { show: false, ratio: null, state: { level: 0 }, key: null },
    }),
  });
  try {
    const shadow = harness.render(
      {
        source: "server",
        server: { request_count: "9", tokens: [], resources: [] },
        pending: null,
        pendingObservationCount: 0,
        cachedAt: null,
        offline: false,
      },
      { guidanceShow: true },
    );
    const oldBinding = harness.currentCaptureBinding();
    const advice = harness.adviceShadow();
    // The tip waits for this chat's closed state from the background before it shows.
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(advice.querySelector<HTMLElement>(".notice")!.hidden, false);
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    assert.equal(shadow.querySelector<HTMLElement>(".panel")!.hidden, false);
    const editor = harness.focusEditor();

    harness.deliver({ target: "footprint-scope-changed" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(advice.querySelector<HTMLElement>(".notice")!.hidden, true);
    assert.equal(shadow.querySelector<HTMLElement>(".panel")!.hidden, true);
    assert.equal(harness.activeElement(), editor);
    assert.match(shadow.querySelector("[data-metrics]")!.textContent!, /3/);
    assert.doesNotMatch(
      shadow.querySelector("[data-metrics]")!.textContent!,
      /Req 9/,
    );

    harness.deliverDisplay(
      oldBinding,
      { site: "chatgpt", conversationId: conversation },
      "99",
    );
    assert.doesNotMatch(
      shadow.querySelector("[data-metrics]")!.textContent!,
      /99/,
    );
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    assert.equal(shadow.querySelector<HTMLElement>(".panel")!.hidden, false);
  } finally {
    harness.close();
  }
});

test("conductor: Perplexity history pages stay ordered and refresh a separately labelled matched subset", async () => {
  const threadId = "00000000-0000-4000-8000-000000000081";
  const observationId = "00000000-0000-4000-8000-000000000082";
  let routeCalls = 0;
  let releaseStart!: (value: unknown) => void;
  const threadCalls: any[] = [];
  const empty = new SummaryAccumulator().result();
  const harness = await contentHarness(false, {
    url: `https://www.perplexity.ai/search/${threadId}`,
    respond: () => {
      routeCalls++;
      if (routeCalls === 1)
        return {
          target: "footprint-display",
          mode: "company",
          state: "dispatch_only",
          summary: empty,
          conversation: {
            source: "local",
            server: null,
            pending: null,
            pendingObservationCount: 0,
            cachedAt: null,
            offline: false,
          },
          recordedThread: {
            status: "unavailable",
            providerHistoryComplete: false,
            observedPageRequests: null,
            unmatchedPageRequests: null,
            hasNextPage: null,
            coverageAfterRestart: "saved_links_only",
          },
          queueCount: 0,
          activeContext: null,
          budget: null,
          budgetBasis: null,
          guidance: {
            show: false,
            ratio: null,
            state: { level: 0 },
            key: null,
          },
        };
      return {
        target: "footprint-display",
        mode: "company",
        state: "dispatch_only",
        summary: { ...empty, requests: 2 },
        conversation: {
          source: "server",
          server: {
            request_count: "4",
            generated_at: "2026-09-10T10:00:00.000Z",
            tokens: [],
            resources: [],
          },
          pending: empty,
          pendingObservationCount: 1,
          cachedAt: null,
          offline: false,
        },
        recordedThread: {
          status: "matched_recorded_subset",
          providerHistoryComplete: false,
          observedPageRequests: 6,
          unmatchedPageRequests: 2,
          hasNextPage: true,
          coverageAfterRestart: "observed_page",
        },
        queueCount: 1,
        activeContext: null,
        budget: null,
        budgetBasis: null,
        guidance: { show: false, ratio: null, state: { level: 0 }, key: null },
      };
    },
    respondThread: (message) => {
      threadCalls.push(message);
      return message.payload.event === "start"
        ? new Promise((resolve) => (releaseStart = resolve))
        : { observed: true };
    },
  });
  try {
    const shadow = await harness.loadRoute();
    const at = "2026-09-10T10:00:00.000Z";
    const start = {
      channel: adapters.THREAD_HISTORY_CHANNEL,
      event: "start",
      id: observationId,
      at,
      site: "perplexity",
      threadId,
      page: null,
    };
    harness.postThreadHistory(start);
    harness.postThreadHistory({
      ...start,
      event: "page",
      page: {
        requestIds: ["00000000-0000-4000-8000-000000000083"],
        hasNextPage: true,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(threadCalls.length, 1, "page waits for the start RPC");
    releaseStart({ observed: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(
      threadCalls.map((call) => call.payload.event),
      ["start", "page"],
    );
    assert.deepEqual(threadCalls[0].binding, threadCalls[1].binding);
    assert.equal(threadCalls[0].binding.captureId, null);
    assert.equal(routeCalls, 2);
    // A matched thread shows the bar every chat shows; Details explains the match. The
    // bar is local-first: the synced copy lacks the update still waiting to upload, so this
    // browser's figures show, with no sync wording (owner, 13 Oct 2026).
    assert.match(shadow.querySelector("[data-metrics]")!.textContent!, /^Req 2 · /);
    assert.doesNotMatch(
      shadow.querySelector("[data-metrics]")!.textContent!,
      /Matched|synced|waiting/i,
    );
    assert.equal(
      shadow.querySelector<HTMLElement>("[data-sync-row] .dt-sync")!.dataset.sync,
      "syncing",
    );
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    const details = shadow.querySelector("[data-body]")!.textContent!;
    assert.match(
      details,
      /does not establish complete provider or account history/,
    );
    assert.match(details, /Request IDs on latest observed page6/);
    assert.match(details, /without a saved match2/);
    assert.match(details, /Provider reported another pageYes/);
    assert.match(details, /1 measurement update is waiting/);
    assert.doesNotMatch(details, /4 requests.*1 measurement update/s);
    assert.ok(
      harness.calls.every(
        (call) =>
          call.target !== "capture" || call.payload?.site !== "perplexity",
      ),
    );
  } finally {
    harness.close();
  }
});

test("conductor: an authoritative thread conflict clears only its unchanged matched view", async () => {
  const threadId = "00000000-0000-4000-8000-000000000085";
  const empty = new SummaryAccumulator().result();
  let routeCalls = 0;
  const harness = await contentHarness(false, {
    url: `https://www.perplexity.ai/search/${threadId}`,
    respond: () => ({
      target: "footprint-display",
      mode: "personal",
      state: "dispatch_only",
      summary: {
        ...empty,
        requests: routeCalls++ === 0 ? 4 : 0,
      },
      conversation: {
        source: "local",
        server: null,
        pending: null,
        pendingObservationCount: 0,
        cachedAt: null,
        offline: false,
      },
      recordedThread: {
        status: routeCalls === 1 ? "matched_recorded_subset" : "unavailable",
        providerHistoryComplete: false,
        observedPageRequests: null,
        unmatchedPageRequests: null,
        hasNextPage: null,
        coverageAfterRestart: "saved_links_only",
      },
      queueCount: 0,
      activeContext: null,
      budget: null,
      budgetBasis: null,
      guidance: {
        show: routeCalls === 1,
        ratio: null,
        state: { level: routeCalls === 1 ? 80 : 0 },
        key: routeCalls === 1 ? "g" : null,
      },
    }),
    respondThread: (message) =>
      message.payload.event === "start"
        ? { observed: false }
        : {
            error: "Recorded thread links conflict with company records.",
            code: "thread_relation_conflict",
          },
  });
  try {
    const shadow = await harness.loadRoute();
    assert.match(shadow.querySelector("[data-metrics]")!.textContent!, /4/);
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    assert.equal(shadow.querySelector<HTMLElement>(".panel")!.hidden, false);
    const advice = harness.adviceShadow();
    assert.equal(advice.querySelector<HTMLElement>(".notice")!.hidden, false);
    const start = {
      channel: adapters.THREAD_HISTORY_CHANNEL,
      event: "start",
      id: "00000000-0000-4000-8000-000000000086",
      at: "2026-09-10T10:00:00.000Z",
      site: "perplexity",
      threadId,
      page: null,
    };
    harness.postThreadHistory(start);
    harness.postThreadHistory({
      ...start,
      event: "page",
      page: { requestIds: [], hasNextPage: false },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(routeCalls, 2);
    assert.equal(shadow.querySelector<HTMLElement>(".panel")!.hidden, true);
    assert.equal(advice.querySelector<HTMLElement>(".notice")!.hidden, true);
    assert.match(
      detailsOnly(shadow),
      /Recorded match changed · History match unavailable/,
    );
    assert.equal(
      shadow.querySelector("[data-metrics]")!.textContent!,
      bar.BAR_NO_FIGURES,
    );
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    assert.match(
      shadow.querySelector("[data-body]")!.textContent!,
      /Conflicting saved matches were removed/,
    );
  } finally {
    harness.close();
  }
});

test("conductor: ordinary history errors retain a valid saved match and a delayed conflict cannot clear a newer capture", async () => {
  const threadId = "00000000-0000-4000-8000-000000000087";
  const empty = new SummaryAccumulator().result();
  let pageCalls = 0;
  let releaseConflict!: (value: unknown) => void;
  const harness = await contentHarness(false, {
    url: `https://www.perplexity.ai/search/${threadId}`,
    respond: () => ({
      target: "footprint-display",
      mode: "personal",
      state: "dispatch_only",
      summary: { ...empty, requests: 4 },
      conversation: {
        source: "local",
        server: null,
        pending: null,
        pendingObservationCount: 0,
        cachedAt: null,
        offline: false,
      },
      recordedThread: {
        status: "matched_recorded_subset",
        providerHistoryComplete: false,
        observedPageRequests: null,
        unmatchedPageRequests: null,
        hasNextPage: null,
        coverageAfterRestart: "saved_links_only",
      },
      queueCount: 0,
      activeContext: null,
      budget: null,
      budgetBasis: null,
      guidance: { show: false, ratio: null, state: { level: 0 }, key: null },
    }),
    respondThread: (message) => {
      if (message.payload.event === "start") return { observed: false };
      pageCalls++;
      return pageCalls === 1
        ? { error: "Recorded thread links are unavailable." }
        : new Promise((resolve) => (releaseConflict = resolve));
    },
  });
  const pair = (id: string) => {
    const start = {
      channel: adapters.THREAD_HISTORY_CHANNEL,
      event: "start",
      id,
      at: "2026-09-10T10:00:00.000Z",
      site: "perplexity",
      threadId,
      page: null,
    };
    return [
      start,
      {
        ...start,
        event: "page",
        page: { requestIds: [], hasNextPage: false },
      },
    ];
  };
  try {
    const shadow = await harness.loadRoute();
    const [ordinaryStart, ordinaryPage] = pair(
      "00000000-0000-4000-8000-000000000088",
    );
    harness.postThreadHistory(ordinaryStart);
    harness.postThreadHistory(ordinaryPage);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(shadow.querySelector("[data-metrics]")!.textContent!, /4/);

    const [lateStart, latePage] = pair("00000000-0000-4000-8000-000000000089");
    harness.postThreadHistory(lateStart);
    harness.postThreadHistory(latePage);
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.render(
      {
        source: "local",
        server: null,
        pending: null,
        pendingObservationCount: 0,
        cachedAt: null,
        offline: false,
      },
      { requestCount: 9 },
    );
    releaseConflict({
      error: "Recorded thread links conflict with company records.",
      code: "thread_relation_conflict",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(shadow.querySelector("[data-metrics]")!.textContent!, /Req 9/);
    assert.doesNotMatch(
      bar.detailsStatusText(shadow.querySelector<HTMLElement>("[data-status]")!),
      /Recorded match changed/,
    );
  } finally {
    harness.close();
  }
});

test("conductor: a saved Perplexity match is local in personal mode and page facts remain unknown after restart", async () => {
  const empty = new SummaryAccumulator().result();
  const harness = await contentHarness(false, {
    url: "https://www.perplexity.ai/search/00000000-0000-4000-8000-000000000091",
    respond: () => ({
      target: "footprint-display",
      mode: "personal",
      state: "dispatch_only",
      summary: { ...empty, requests: 2 },
      conversation: {
        source: "local",
        server: null,
        pending: null,
        pendingObservationCount: 0,
        cachedAt: null,
        offline: false,
      },
      recordedThread: {
        status: "matched_recorded_subset",
        providerHistoryComplete: false,
        observedPageRequests: null,
        unmatchedPageRequests: null,
        hasNextPage: null,
        coverageAfterRestart: "saved_links_only",
      },
      queueCount: 0,
      activeContext: null,
      budget: null,
      budgetBasis: null,
      guidance: { show: false, ratio: null, state: { level: 0 }, key: null },
    }),
  });
  try {
    const shadow = await harness.loadRoute();
    // The bar stays compact: no match labels beside the figures or as a status.
    assert.doesNotMatch(
      barState(shadow),
      /Matched/,
    );
    assert.doesNotMatch(
      shadow.querySelector("[data-metrics]")!.textContent!,
      /Matched|browser profile/,
    );
    assert.doesNotMatch(
      shadow.querySelector("[data-metrics]")!.textContent!,
      /synced/i,
    );
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    const details = shadow.querySelector("[data-body]")!.textContent!;
    assert.match(details, /Saved matches can cover pages observed earlier/);
    assert.match(details, /Current page coverageUnavailable after restart/);
    assert.doesNotMatch(details, /Request IDs on latest observed page/);
  } finally {
    harness.close();
  }
});

test("conductor: an unmatched Perplexity thread reports unknown usage rather than zero", async () => {
  const harness = await contentHarness(false, {
    url: "https://www.perplexity.ai/search/00000000-0000-4000-8000-000000000095",
    respond: () => ({
      target: "footprint-display",
      mode: "personal",
      state: "dispatch_only",
      summary: new SummaryAccumulator().result(),
      conversation: {
        source: "local",
        server: null,
        pending: null,
        pendingObservationCount: 0,
        cachedAt: null,
        offline: false,
      },
      recordedThread: {
        status: "unavailable",
        providerHistoryComplete: false,
        observedPageRequests: 0,
        unmatchedPageRequests: 0,
        hasNextPage: false,
        coverageAfterRestart: "observed_page",
      },
      queueCount: 0,
      activeContext: null,
      budget: null,
      budgetBasis: null,
      guidance: { show: false, ratio: null, state: { level: 0 }, key: null },
    }),
    captureGraceTimers: true,
  });
  try {
    const shadow = await harness.loadRoute();
    // No read of the thread arrived in the grace period, so nothing is pending any more.
    harness.fireGraceTimers();
    // The person cannot act on it, so Details explains it (owner, 13 Oct 2026).
    assert.equal(barState(shadow), "");
    assert.equal(detailsOnly(shadow), "History match unavailable");
    assert.equal(
      shadow.querySelector("[data-metrics]")!.textContent,
      bar.BAR_NO_FIGURES,
    );
    assert.doesNotMatch(
      shadow.querySelector("[data-metrics]")!.textContent!,
      /Req 0/,
    );
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    assert.match(
      shadow.querySelector("[data-body]")!.textContent!,
      /does not mean the provider performed zero work/,
    );
  } finally {
    harness.close();
  }
});

test("conductor: unresolved company identity without matched records shows Usage unknown only", async () => {
  const empty = new SummaryAccumulator().result();
  const harness = await contentHarness(false, {
    url: "https://www.perplexity.ai/search/00000000-0000-4000-8000-000000000097",
    respond: () => ({
      target: "footprint-display",
      mode: "company",
      state: "dispatch_only",
      summary: { ...empty, requests: 1 },
      conversation: {
        source: "local",
        server: null,
        pending: empty,
        pendingObservationCount: 0,
        cachedAt: null,
        offline: false,
      },
      recordedThread: {
        status: "unavailable",
        providerHistoryComplete: false,
        observedPageRequests: null,
        unmatchedPageRequests: null,
        hasNextPage: null,
        coverageAfterRestart: "saved_links_only",
        serverUnavailableReason: "unresolved_identity",
      },
      queueCount: 0,
      activeContext: null,
      budget: null,
      budgetBasis: null,
      guidance: { show: false, ratio: null, state: { level: 0 }, key: null },
    }),
    captureGraceTimers: true,
  });
  try {
    const shadow = await harness.loadRoute();
    harness.fireGraceTimers();
    assert.equal(barState(shadow), "");
    assert.equal(detailsOnly(shadow), "Synced matching unavailable");
    const metrics = shadow.querySelector("[data-metrics]")!.textContent!;
    assert.equal(metrics, bar.BAR_NO_FIGURES);
  } finally {
    harness.close();
  }
});

test("conductor: unresolved company identity keeps matched local and pending records separate", async () => {
  const empty = new SummaryAccumulator().result();
  const harness = await contentHarness(false, {
    url: "https://www.perplexity.ai/search/00000000-0000-4000-8000-000000000096",
    respond: () => ({
      target: "footprint-display",
      mode: "company",
      state: "dispatch_only",
      summary: { ...empty, requests: 2 },
      conversation: {
        source: "local",
        server: null,
        pending: empty,
        pendingObservationCount: 1,
        cachedAt: null,
        offline: false,
      },
      recordedThread: {
        status: "matched_recorded_subset",
        providerHistoryComplete: false,
        observedPageRequests: null,
        unmatchedPageRequests: null,
        hasNextPage: null,
        coverageAfterRestart: "saved_links_only",
        serverUnavailableReason: "unresolved_identity",
      },
      queueCount: 1,
      activeContext: null,
      budget: null,
      budgetBasis: null,
      guidance: { show: false, ratio: null, state: { level: 0 }, key: null },
    }),
  });
  try {
    const shadow = await harness.loadRoute();
    assert.equal(barState(shadow), "");
    assert.equal(detailsOnly(shadow), "Synced matching unavailable");
    // The reason is on hover and in Details, not beside the figures.
    assert.doesNotMatch(
      shadow.querySelector("[data-metrics]")!.textContent!,
      /identity is unresolved|browser profile/,
    );
    // Waiting updates are shown by the Details sync icon (owner, 13 Oct 2026).
    assert.doesNotMatch(
      shadow.querySelector("[data-metrics]")!.textContent!,
      /waiting/,
    );
    assert.equal(
      shadow.querySelector<HTMLElement>("[data-sync-row] .dt-sync")!.dataset.sync,
      "syncing",
    );
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    const details = shadow.querySelector("[data-body]")!.textContent!;
    assert.match(details, /Matched records in this browser profile/);
    assert.match(details, /request identity is unresolved/);
    assert.match(details, /1 measurement update is waiting/);
    assert.doesNotMatch(details, /synced snapshot/i);
  } finally {
    harness.close();
  }
});

test("conductor: committed recorded-thread invalidation clears only the current passive route view", async () => {
  const threadId = "00000000-0000-4000-8000-000000000097";
  const empty = new SummaryAccumulator().result();
  let routeCalls = 0;
  let releaseRefresh!: (value: unknown) => void;
  const unavailable = {
    target: "footprint-display",
    mode: "personal",
    state: "dispatch_only",
    summary: empty,
    conversation: {
      source: "local",
      server: null,
      pending: null,
      pendingObservationCount: 0,
      cachedAt: null,
      offline: false,
    },
    recordedThread: {
      status: "unavailable",
      providerHistoryComplete: false,
      observedPageRequests: null,
      unmatchedPageRequests: null,
      hasNextPage: null,
      coverageAfterRestart: "saved_links_only",
      serverUnavailableReason: null,
    },
    queueCount: 0,
    activeContext: null,
    budget: null,
    budgetBasis: null,
    guidance: { show: false, ratio: null, state: { level: 0 }, key: null },
  };
  const harness = await contentHarness(false, {
    url: `https://www.perplexity.ai/search/${threadId}`,
    respond: () => {
      routeCalls++;
      return routeCalls === 1
        ? {
            ...unavailable,
            summary: { ...empty, requests: 5 },
            recordedThread: {
              ...unavailable.recordedThread,
              status: "matched_recorded_subset",
            },
          }
        : new Promise((resolve) => (releaseRefresh = resolve));
    },
  });
  try {
    const shadow = await harness.loadRoute();
    assert.match(shadow.querySelector("[data-metrics]")!.textContent!, /5/);
    harness.deliver({
      target: "footprint-recorded-thread-invalidated",
      company: "untrusted-extra",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(routeCalls, 1);

    harness.deliver({ target: "footprint-recorded-thread-invalidated" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(routeCalls, 2);
    assert.equal(barState(shadow), "");
    assert.equal(detailsOnly(shadow), "Recorded match changed");
    // The saved totals are read again, so the cleared bar shows Processing.
    assert.equal(
      shadow.querySelector("[data-metrics]")!.textContent!,
      bar.BAR_PROCESSING,
    );
    releaseRefresh(unavailable);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(
      detailsOnly(shadow),
      /Recorded match changed · History match unavailable/,
    );

    harness.render(
      {
        source: "local",
        server: null,
        pending: null,
        pendingObservationCount: 0,
        cachedAt: null,
        offline: false,
      },
      { requestCount: 9 },
    );
    harness.deliver({ target: "footprint-recorded-thread-invalidated" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(routeCalls, 2);
    assert.match(shadow.querySelector("[data-metrics]")!.textContent!, /Req 9/);
  } finally {
    harness.close();
  }
});

test("conductor: committed rejection clears the exact active Perplexity match and coalesces its saved refresh", async () => {
  const threadId = "00000000-0000-4000-8000-000000000098";
  const oldQuery = deferred<unknown>();
  const refreshedQuery = deferred<unknown>();
  const empty = new SummaryAccumulator().result();
  let routeCalls = 0;
  const matched = {
    status: "matched_recorded_subset",
    providerHistoryComplete: false,
    observedPageRequests: 1,
    unmatchedPageRequests: 0,
    hasNextPage: false,
    coverageAfterRestart: "observed_page",
    serverUnavailableReason: null,
  };
  const unavailable = {
    target: "footprint-display",
    mode: "personal",
    state: "dispatch_only",
    summary: empty,
    conversation: {
      source: "local",
      server: null,
      pending: null,
      pendingObservationCount: 0,
      cachedAt: null,
      offline: false,
    },
    recordedThread: { ...matched, status: "unavailable" },
    queueCount: 0,
    activeContext: null,
    budget: null,
    budgetBasis: null,
    guidance: { show: false, ratio: null, state: { level: 0 }, key: null },
  };
  const harness = await contentHarness(false, {
    url: `https://www.perplexity.ai/search/${threadId}`,
    respond: () => {
      routeCalls++;
      if (routeCalls === 1) return oldQuery.promise;
      if (routeCalls === 2) return refreshedQuery.promise;
      return { ...unavailable, recordedThread: null };
    },
  });
  try {
    // The saved-totals read starts before the live display, so its late result
    // must not overwrite the refreshed one.
    await harness.loadRoute();
    const shadow = harness.render(
      {
        source: "local",
        server: null,
        pending: null,
        pendingObservationCount: 0,
        cachedAt: null,
        offline: false,
      },
      { requestCount: 6, recordedThread: matched, guidanceShow: true },
    );
    const advice = harness.adviceShadow();
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    const close = shadow.querySelector<HTMLButtonElement>("[data-close]")!;
    close.focus();
    assert.equal(shadow.activeElement, close);

    harness.deliver({ target: "footprint-recorded-thread-invalidated" });
    harness.deliver({ target: "footprint-recorded-thread-invalidated" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(routeCalls, 2);
    assert.equal(shadow.querySelector<HTMLElement>(".panel")!.hidden, true);
    assert.equal(advice.querySelector<HTMLElement>(".notice")!.hidden, true);
    assert.equal(
      harness.activeElement(),
      harness.document.querySelector("textarea"),
    );
    // The refreshed saved-totals read is still running.
    assert.equal(
      shadow.querySelector("[data-metrics]")!.textContent!,
      bar.BAR_PROCESSING,
    );

    oldQuery.resolve({
      ...unavailable,
      summary: { ...empty, requests: 99 },
      recordedThread: matched,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.doesNotMatch(
      shadow.querySelector("[data-metrics]")!.textContent!,
      /99/,
    );

    refreshedQuery.resolve(unavailable);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(
      detailsOnly(shadow),
      /Recorded match changed · History match unavailable/,
    );

    harness.deliver({ target: "footprint-recorded-thread-invalidated" });
    harness.deliver({ target: "footprint-recorded-thread-invalidated" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(routeCalls, 3);
    harness.deliver({ target: "footprint-recorded-thread-invalidated" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(routeCalls, 3);

    harness.render(null, { requestCount: 7, recordedThread: matched });
    const nativeButton = harness.document.createElement("button");
    nativeButton.textContent = "Native navigation";
    harness.document.querySelector("main")!.append(nativeButton);
    nativeButton.focus();
    harness.deliver({ target: "footprint-recorded-thread-invalidated" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(routeCalls, 4);
    assert.equal(harness.activeElement(), nativeButton);
  } finally {
    harness.close();
  }
});

test("conductor: recorded-thread invalidation ignores a newer ordinary capture and a changed route", async () => {
  const firstThread = "00000000-0000-4000-8000-000000000099";
  const secondThread = "00000000-0000-4000-8000-000000000100";
  const routeRefresh = deferred<unknown>();
  let routeCalls = 0;
  const matched = {
    status: "matched_recorded_subset",
    providerHistoryComplete: false,
    observedPageRequests: null,
    unmatchedPageRequests: null,
    hasNextPage: null,
    coverageAfterRestart: "saved_links_only",
    serverUnavailableReason: null,
  };
  const harness = await contentHarness(false, {
    url: `https://www.perplexity.ai/search/${firstThread}`,
    respond: () => {
      routeCalls++;
      return routeRefresh.promise;
    },
  });
  try {
    const shadow = harness.render(null, {
      requestCount: 4,
      recordedThread: matched,
    });
    harness.render(null, { requestCount: 8, recordedThread: null });
    harness.deliver({ target: "footprint-recorded-thread-invalidated" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Only the start-up read was sent; a live display makes later reads pointless.
    assert.equal(routeCalls, 1);
    assert.match(shadow.querySelector("[data-metrics]")!.textContent!, /Req 8/);

    await harness.navigate(`/search/${secondThread}`);
    assert.equal(routeCalls, 2);
    harness.deliver({ target: "footprint-recorded-thread-invalidated" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(routeCalls, 2);
    routeRefresh.resolve({
      error: "Recorded conversation totals are unavailable.",
    });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    harness.close();
  }
});

test("conductor: Perplexity page membership cannot cross navigation, scope or permission invalidation", async () => {
  const firstThread = "00000000-0000-4000-8000-000000000101";
  const secondThread = "00000000-0000-4000-8000-000000000102";
  const threadCalls: any[] = [];
  const empty = new SummaryAccumulator().result();
  const harness = await contentHarness(false, {
    url: `https://www.perplexity.ai/search/${firstThread}`,
    respond: () => ({
      target: "footprint-display",
      mode: "personal",
      state: "dispatch_only",
      summary: empty,
      conversation: {
        source: "local",
        server: null,
        pending: null,
        pendingObservationCount: 0,
        cachedAt: null,
        offline: false,
      },
      recordedThread: {
        status: "unavailable",
        providerHistoryComplete: false,
        observedPageRequests: null,
        unmatchedPageRequests: null,
        hasNextPage: null,
        coverageAfterRestart: "saved_links_only",
      },
      queueCount: 0,
      activeContext: null,
      budget: null,
      budgetBasis: null,
      guidance: { show: false, ratio: null, state: { level: 0 }, key: null },
    }),
    respondThread: (message) => {
      threadCalls.push(message);
      return { observed: message.payload.event === "page" };
    },
  });
  const historyPair = (threadId: string, id: string) => {
    const start = {
      channel: adapters.THREAD_HISTORY_CHANNEL,
      event: "start",
      id,
      at: "2026-09-10T10:00:00.000Z",
      site: "perplexity",
      threadId,
      page: null,
    };
    return [
      start,
      {
        ...start,
        event: "page",
        page: { requestIds: [], hasNextPage: false },
      },
    ];
  };
  try {
    await harness.loadRoute();
    const [firstStart, firstPage] = historyPair(
      firstThread,
      "00000000-0000-4000-8000-000000000103",
    );
    harness.postThreadHistory(firstStart);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await harness.navigate(`/search/${secondThread}`);
    harness.postThreadHistory(firstPage);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(
      threadCalls.map((call) => call.payload.event),
      ["start"],
    );

    const [secondStart, secondPage] = historyPair(
      secondThread,
      "00000000-0000-4000-8000-000000000104",
    );
    harness.postThreadHistory(secondStart);
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.deliver({ target: "footprint-scope-changed" });
    harness.postThreadHistory(secondPage);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(
      threadCalls.map((call) => call.payload.event),
      ["start", "start"],
    );
    const [thirdStart, thirdPage] = historyPair(
      secondThread,
      "00000000-0000-4000-8000-000000000105",
    );
    harness.postThreadHistory(thirdStart);
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.deliver({ target: "capture-permission-lost" });
    harness.postThreadHistory(thirdPage);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(
      threadCalls.map((call) => call.payload.event),
      ["start", "start", "start"],
    );
    assert.ok(
      harness.calls.every((call) => call.target !== "capture"),
      "passive history membership must not become a usage capture",
    );
  } finally {
    harness.close();
  }
});

test("conductor: history flooding admits two lifecycles and cannot block ordinary captures", async () => {
  const threadId = "00000000-0000-4000-8000-000000000111";
  const threadCalls: any[] = [];
  const harness = await contentHarness(false, {
    url: `https://www.perplexity.ai/search/${threadId}`,
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    respondThread: (message) => {
      threadCalls.push(message);
      return new Promise(() => {});
    },
  });
  try {
    const shadow = await harness.loadRoute();
    const starts: any[] = [];
    for (let index = 0; index < 50; index++) {
      const start = {
        channel: adapters.THREAD_HISTORY_CHANNEL,
        event: "start",
        id: crypto.randomUUID(),
        at: "2026-09-10T10:00:00.000Z",
        site: "perplexity",
        threadId,
        page: null,
      };
      starts.push(start);
      harness.postThreadHistory(start);
    }
    harness.postThreadHistory(starts[0]);
    harness.postThreadHistory({
      ...starts[10],
      event: "page",
      page: { requestIds: [], hasNextPage: false },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(threadCalls.length, 2);
    assert.ok(threadCalls.every((call) => call.payload.event === "start"));

    harness.render(
      {
        source: "local",
        server: null,
        pending: null,
        pendingObservationCount: 0,
        cachedAt: null,
        offline: false,
      },
      { requestCount: 7 },
    );
    assert.equal(
      harness.calls.filter((call) => call.target === "capture").length,
      1,
      "history admission is independent from ordinary capture transport",
    );
  } finally {
    harness.close();
  }
});

test("conductor: history errors release transport while logical expiry retains unresolved physical capacity", async () => {
  const threadId = "00000000-0000-4000-8000-000000000112";
  const threadCalls: any[] = [];
  let keepPending = false;
  const harness = await contentHarness(false, {
    url: `https://www.perplexity.ai/search/${threadId}`,
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    historyLifecycleMs: 10,
    respondThread: (message) => {
      threadCalls.push(message);
      return keepPending
        ? new Promise(() => {})
        : { error: "Recorded thread links are unavailable." };
    },
  });
  const start = () => ({
    channel: adapters.THREAD_HISTORY_CHANNEL,
    event: "start",
    id: crypto.randomUUID(),
    at: "2026-09-10T10:00:00.000Z",
    site: "perplexity",
    threadId,
    page: null,
  });
  try {
    await harness.loadRoute();
    harness.postThreadHistory(start());
    harness.postThreadHistory(start());
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(threadCalls.length, 2);
    harness.postThreadHistory(start());
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(threadCalls.length, 3, "resolved errors release admission");

    keepPending = true;
    harness.postThreadHistory(start());
    harness.postThreadHistory(start());
    await new Promise((resolve) => setTimeout(resolve, 20));
    harness.postThreadHistory(start());
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(
      threadCalls.length,
      5,
      "logical expiry cannot release unresolved physical RPC capacity",
    );
    harness.postThreadHistory(start());
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(
      threadCalls.length,
      5,
      "repeated expiry cannot accumulate unresolved runtime calls",
    );
  } finally {
    harness.close();
  }
});

test("conductor: deferred history starts recheck navigation and permission before transport", async () => {
  const firstThread = "00000000-0000-4000-8000-000000000114";
  const secondThread = "00000000-0000-4000-8000-000000000115";
  const threadCalls: any[] = [];
  const harness = await contentHarness(false, {
    url: `https://www.perplexity.ai/search/${firstThread}`,
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    respondThread: (message) => {
      threadCalls.push(message);
      return { observed: false };
    },
  });
  const start = (threadId: string) => ({
    channel: adapters.THREAD_HISTORY_CHANNEL,
    event: "start",
    id: crypto.randomUUID(),
    at: "2026-09-10T10:00:00.000Z",
    site: "perplexity",
    threadId,
    page: null,
  });
  try {
    await harness.loadRoute();
    harness.postThreadHistory(start(firstThread));
    await harness.navigate(`/search/${secondThread}`);
    assert.equal(threadCalls.length, 0);

    harness.postThreadHistory(start(secondThread));
    harness.deliver({ target: "capture-permission-lost" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(threadCalls.length, 0);
  } finally {
    harness.close();
  }
});

test("conductor: a late start acknowledgement cannot send its page after logical expiry", async () => {
  const threadId = "00000000-0000-4000-8000-000000000116";
  const threadCalls: any[] = [];
  let releaseStart!: (value: unknown) => void;
  const harness = await contentHarness(false, {
    url: `https://www.perplexity.ai/search/${threadId}`,
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    historyLifecycleMs: 10,
    respondThread: (message) => {
      threadCalls.push(message);
      return new Promise((resolve) => (releaseStart = resolve));
    },
  });
  try {
    await harness.loadRoute();
    const start = {
      channel: adapters.THREAD_HISTORY_CHANNEL,
      event: "start",
      id: crypto.randomUUID(),
      at: "2026-09-10T10:00:00.000Z",
      site: "perplexity",
      threadId,
      page: null,
    };
    harness.postThreadHistory(start);
    harness.postThreadHistory({
      ...start,
      event: "page",
      page: { requestIds: [], hasNextPage: false },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    releaseStart({ observed: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(
      threadCalls.map((call) => call.payload.event),
      ["start"],
    );
  } finally {
    harness.close();
  }
});

test("conductor: completed history lifecycles retain a separate eight-start rate window", async () => {
  const threadId = "00000000-0000-4000-8000-000000000113";
  const threadCalls: any[] = [];
  const harness = await contentHarness(false, {
    url: `https://www.perplexity.ai/search/${threadId}`,
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    respondThread: (message) => {
      threadCalls.push(message);
      return { observed: message.payload.event === "page" };
    },
  });
  try {
    await harness.loadRoute();
    for (let index = 0; index < 9; index++) {
      const start = {
        channel: adapters.THREAD_HISTORY_CHANNEL,
        event: "start",
        id: crypto.randomUUID(),
        at: "2026-09-10T10:00:00.000Z",
        site: "perplexity",
        threadId,
        page: null,
      };
      harness.postThreadHistory(start);
      harness.postThreadHistory({
        ...start,
        event: "page",
        page: { requestIds: [], hasNextPage: false },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert.equal(threadCalls.length, 16);
    assert.equal(
      threadCalls.filter((call) => call.payload.event === "start").length,
      8,
    );
    assert.equal(
      threadCalls.filter((call) => call.payload.event === "page").length,
      8,
    );
  } finally {
    harness.close();
  }
});

test("conductor: an old conversation shows independently available imported history when recorded totals are absent", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000201";
  const history = historicalView(historicalSummary());
  const harness = await contentHarness(false, {
    url: `https://chatgpt.com/c/${conversationId}`,
    respond: () => historicalRouteDisplay(history),
  });
  try {
    const shadow = await harness.loadRoute();
    // The start of the chat could not be read: no action, so it is listed with what could
    // not be counted, and the bar shows only the figures.
    assert.equal(barState(shadow), "");
    assert.equal(detailsOnly(shadow), "Partially loaded");
    assert.match(
      shadow.querySelector('[data-section="not-counted"]')!.textContent!,
      /Some earlier messages missing/,
    );
    assert.match(
      shadow.querySelector("[data-metrics]")!.textContent!,
      /Req 2 · In\/Out tokens/,
    );
    assert.match(
      shadow.querySelector("[data-metrics]")!.textContent!,
      /In\/Out tokens - ≈ 17\/Unknown.*Electricity/,
    );
    assert.doesNotMatch(
      shadow.querySelector("[data-metrics]")!.textContent!,
      /Req 0|Waiting for an observed request/,
    );

    const open = shadow.querySelector<HTMLElement>("[data-open]")!;
    open.focus();
    open.click();
    const body = shadow.querySelector("[data-body]")!.textContent!;
    assert.match(body, /Messages with an unknown date1/);
    assert.match(body, /Messages with unverified matching1/);
    assert.match(body, /provider execution unobserved/);
    assert.match(body, /7 observed inline file-text tokens/);
    assert.match(body, /baseline-public-v1/);
    assert.match(body, new RegExp("a{64}"));
    assert.match(body, /First messageNot verified/);
    assert.equal(detailsOnly(shadow), "Partially loaded");
    assert.match(
      shadow.querySelector<HTMLAnchorElement>("[data-body] a")!.href,
      /methodology-reference.html#method-history$/,
    );
    assert.equal(
      shadow.querySelector<HTMLDetailsElement>("[data-body] details")!.open,
      false,
    );
    assert.doesNotMatch(
      shadow.querySelector("[data-metrics]")!.textContent!,
      /Imported|Calculated messages|Historical/,
    );
    harness.document.dispatchEvent(
      new shadow.ownerDocument.defaultView!.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
      }),
    );
    assert.equal(shadow.querySelector<HTMLElement>(".panel")!.hidden, true);
    assert.equal(shadow.activeElement, open);
  } finally {
    harness.close();
  }
});

test("capture failures remain visible over saved history even when their storage receipt succeeds", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000247";
  const harness = await contentHarness(false, {
    url: `https://chatgpt.com/c/${conversationId}`,
    respond: () => historicalRouteDisplay(historicalView(historicalSummary())),
    respondCapture: () => ({ ok: true }),
  });
  try {
    const shadow = await harness.loadRoute();
    const before = shadow.querySelector("[data-metrics]")!.textContent;
    harness.postHistorical({
      channel: bridge.CHANNEL,
      version: 1,
      id: crypto.randomUUID(),
      revision: 1,
      event: "dispatch",
      site: "chatgpt",
      at: new Date().toISOString(),
      dispatch: {
        site: "chatgpt",
        action: "send",
        input: null,
        conversationId: null,
        parentId: null,
        requestId: null,
        model: null,
        attachments: null,
        imageEditParentId: null,
      },
      snapshot: adapters.initialSnapshot(),
      timing: null,
      failure: "buffer_overflow",
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(
      shadow.querySelector("[data-metrics]")!.textContent!.startsWith(before!),
    );
    assert.match(
      barState(shadow),
      /Tracking problem/,
    );
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    assert.match(
      shadow.querySelector("[data-body]")!.textContent!,
      /buffer_overflow/,
    );
  } finally {
    harness.close();
  }
});

test("conductor: unverified capture coverage and real page failures survive history-only presentation independently", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000247";
  const history = historicalView(historicalSummary());
  const harness = await contentHarness(false, {
    url: `https://chatgpt.com/c/${conversationId}`,
    respond: () => historicalRouteDisplay(history),
    respondCapture: () => ({
      ok: false,
      code: "storage_write_failed",
    }),
  });
  try {
    harness.captureReady("unverified");
    const shadow = await harness.loadRoute();
    assert.match(
      detailsOnly(shadow),
      /Partially loaded/,
    );
    assert.doesNotMatch(
      barState(shadow),
      /Tracking problem/,
    );
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    let details = shadow.querySelector("[data-body]")!.textContent!;
    assert.match(details, /Capture coverage unverified/);
    assert.doesNotMatch(
      shadow.querySelector(".bar")!.textContent!,
      /Estimated|Capture coverage unverified|listener is active|future live request/,
    );
    assert.match(details, /Capture listenerActive/);
    assert.match(details, /Live operation observedNo/);
    assert.match(details, /coverage uncertainty, not a recording failure/);

    harness.render(null, { requestCount: 0, history });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(barState(shadow), "Tracking problem (free browser storage)");
    assert.match(detailsOnly(shadow), /Partially loaded/);
    // The fix Details offers follows the bracketed action: freeing storage, not a reload.
    const problem = [
      ...shadow.querySelectorAll<HTMLElement>("[data-body] .dt-status"),
    ].find((node) => /Reply not counted/.test(node.textContent!))!;
    assert.match(problem.textContent!, /Free some browser storage/);
    assert.equal(problem.querySelector(".dt-reload"), null);
    details = shadow.querySelector("[data-body]")!.textContent!;
    assert.match(details, /Live operation observedYes/);
    assert.match(details, /Page tracking health/);
    assert.match(details, /storage_write_failed/);

    harness.captureReady("direct");
    assert.match(barState(shadow), /Tracking problem/);
    assert.match(detailsOnly(shadow), /Partially loaded/);
    assert.doesNotMatch(
      barState(shadow),
      /Capture coverage unverified/,
    );
    details = shadow.querySelector("[data-body]")!.textContent!;
    assert.doesNotMatch(details, /Capture coverage unverified/);
    assert.match(details, /Page tracking health/);
    assert.match(details, /storage_write_failed/);
  } finally {
    harness.close();
  }
});

test("conductor: readiness recovers a listener outage but not an active missed-operation gap", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000248";
  const history = historicalView(historicalSummary());
  let nextFailure: "capture_hook_missing" | null = null;
  const state = {
    listener: "starting" as "starting" | "active" | "missing",
    interception: "unverified" as "direct" | "unverified",
    lastCapturedAt: null as number | null,
    activityGap: false,
  };
  class ControlledWatchdog {
    ready(_now: number, interception: "direct" | "unverified") {
      state.listener = "active";
      state.interception = interception;
    }
    sent() {}
    activity() {}
    captured(now: number) {
      state.lastCapturedAt = now;
      state.activityGap = false;
    }
    status() {
      return { ...state };
    }
    poll() {
      return { probe: false, refreshStatus: false };
    }
    check() {
      const failure = nextFailure;
      nextFailure = null;
      return failure;
    }
  }
  const harness = await contentHarness(false, {
    url: `https://chatgpt.com/c/${conversationId}`,
    respond: () => historicalRouteDisplay(history),
    watchdogModule: {
      ...watchdog,
      CaptureWatchdog: ControlledWatchdog,
    } as unknown as typeof watchdog,
  });
  try {
    harness.captureReady("unverified");
    const shadow = await harness.loadRoute();
    state.listener = "missing";
    nextFailure = "capture_hook_missing";
    harness.tickIntervals();
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    assert.match(
      shadow.querySelector("[data-body]")!.textContent!,
      /Current problem.*capture_hook_missing/,
    );

    harness.captureReady("direct");
    assert.match(
      shadow.querySelector("[data-body]")!.textContent!,
      /Earlier problem.*capture_hook_missing/,
    );

    state.activityGap = true;
    nextFailure = "capture_hook_missing";
    harness.tickIntervals();
    harness.captureReady("direct");
    assert.match(
      shadow.querySelector("[data-body]")!.textContent!,
      /Current problem.*capture_hook_missing/,
    );

    harness.render(null, { requestCount: 0, history });
    assert.match(
      shadow.querySelector("[data-body]")!.textContent!,
      /Earlier problem.*capture_hook_missing/,
    );
    // An earlier problem stays in Details; the status names only current ones (D7).
    assert.doesNotMatch(
      barState(shadow),
      /Tracking problem/,
    );
    assert.match(
      detailsOnly(shadow),
      /Partially loaded/,
    );
    assert.doesNotMatch(
      barState(shadow),
      /Capture coverage unverified/,
    );
    // The popup asks this tab; a recovered problem is not reported as current.
    const answer = await harness.deliver(
      { target: "page-health" },
      { id: "content-test-extension" },
    );
    assert.equal(JSON.stringify(answer), JSON.stringify({ target: "page-health", problems: [] }));
  } finally {
    harness.close();
  }
});

for (const site of ["claude", "chatgpt"] as const)
  test(`${site} old-chat history arriving before the navigation scan calculates without reload`, async () => {
    const from = "00000000-0000-4000-8000-000000000281";
    const to = "00000000-0000-4000-8000-000000000282";
    const prefix = site === "claude" ? "/chat/" : "/c/";
    let imported = false;
    const relayed: any[] = [];
    const harness = await contentHarness(false, {
      url: `https://${site === "claude" ? "claude.ai" : "chatgpt.com"}${prefix}${from}`,
      ...(site === "claude"
        ? {
            html: '<main><form><div class="ProseMirror" contenteditable="true" role="textbox"></div></form></main>',
          }
        : {}),
      respond: () =>
        historicalRouteDisplay(
          historicalView(
            historicalSummary(
              imported
                ? {
                    first_request_verified: true,
                    prompt_count: "1",
                    response_count: "1",
                  }
                : {
                    status: "empty",
                    prompt_count: "0",
                    response_count: "0",
                    tokens: [],
                    resources: [],
                  },
            ),
          ),
        ),
      respondHistory: (message) => {
        relayed.push(message);
        if (message.message.event === "page") imported = true;
        return { accepted: true };
      },
    });
    try {
      await harness.loadRoute();
      const resets = harness.historyResetCount();
      const messages = historicalMessages(to, crypto.randomUUID(), {
        first: true,
      });
      messages.start.site = site;
      messages.page.site = site;
      messages.page.page.site = site;
      if (site === "claude")
        for (const message of messages.page.page.messages)
          message.requestId = null;
      assert.equal(
        historyCapture.validHistoryTextPage(messages.page.page),
        true,
      );
      // pushState does not emit popstate; provider history can start before the
      // mutation observer's delayed route scan notices the new conversation.
      harness.document.defaultView!.history.pushState({}, "", prefix + to);
      harness.postHistorical(messages.start);
      await new Promise((resolve) => setImmediate(resolve));
      await harness.popstate();
      harness.postHistorical(messages.page);
      for (let attempt = 0; attempt < 30 && !imported; attempt++)
        await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(
        imported,
        true,
        "The newly visible conversation's history must finish importing",
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      const shadow = await harness.loadRoute();
      assert.match(
        shadow.querySelector("[data-metrics]")!.textContent!,
        /^Req 1 ·/,
      );
      assert.doesNotMatch(
        barState(shadow),
        /History update problem|Partially loaded/,
      );
      assert.deepEqual(
        relayed.map((message) => message.message.event),
        ["start", "page"],
      );
      assert.deepEqual(relayed[0].binding, relayed[1].binding);
      assert.equal(
        harness.historyResetCount(),
        resets,
        "Route synchronization must not cancel the current provider response",
      );
      assert.ok(harness.calls.every((call) => call.target !== "capture"));
    } finally {
      harness.close();
    }
  });

// Live QA of 19 October 2026: a ChatGPT project chat opened by full load moves from
// /g/g-p-<id>/c/<chat> to the project's named address while its history loads. The move
// ended the read, so the bar stayed on Processing, then showed No figures yet and a
// History update problem until a reload.
test("a ChatGPT project chat keeps its history read when the page moves to the project's named address", async () => {
  const chat = "00000000-0000-4000-8000-000000000283";
  const project = "g-p-67a1b2c3d4e5f60718293a4b5c6d7e8f";
  let imported = false;
  const relayed: any[] = [];
  const harness = await contentHarness(false, {
    url: `https://chatgpt.com/g/${project}/c/${chat}`,
    respond: () =>
      historicalRouteDisplay(
        historicalView(
          historicalSummary(
            imported
              ? {
                  first_request_verified: true,
                  prompt_count: "1",
                  response_count: "1",
                }
              : {
                  status: "empty",
                  prompt_count: "0",
                  response_count: "0",
                  tokens: [],
                  resources: [],
                },
          ),
        ),
      ),
    respondHistory: (message) => {
      relayed.push(message);
      if (message.message.event === "page") imported = true;
      return { accepted: true };
    },
  });
  try {
    await harness.loadRoute();
    const resets = harness.historyResetCount();
    const messages = historicalMessages(chat, crypto.randomUUID(), {
      first: true,
    });
    harness.postHistorical(messages.start);
    await new Promise((resolve) => setImmediate(resolve));
    harness.document.defaultView!.history.replaceState(
      {},
      "",
      `/g/${project}-energy-study/c/${chat}`,
    );
    await harness.popstate();
    harness.postHistorical(messages.page);
    for (let attempt = 0; attempt < 30 && !imported; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(imported, true, "the chat's saved messages must be imported");
    assert.deepEqual(
      relayed.map((message) => message.message.event),
      ["start", "page"],
    );
    assert.deepEqual(relayed[0].binding, relayed[1].binding);
    assert.equal(
      harness.historyResetCount(),
      resets,
      "a new address of the same chat must not cancel its read",
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const shadow = await harness.loadRoute();
    assert.match(
      shadow.querySelector("[data-metrics]")!.textContent!,
      /^Req 1 ·/,
    );
    assert.doesNotMatch(barState(shadow), /History update problem/);
  } finally {
    harness.close();
  }
});

test("conductor: accepted historical pages refresh progressively, deduplicate repeated loads, and bound first-request wording", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000211";
  let current = historicalView(
    historicalSummary({
      prompt_count: "1",
      response_count: "1",
      observed_prompt_count: "1",
      observed_response_count: "1",
      calculated_message_count: "2",
      uncalculated_message_count: "0",
      first_request_verified: false,
    }),
  );
  let routeCalls = 0;
  const seenPages = new Set<string>();
  const historyCalls: any[] = [];
  const harness = await contentHarness(false, {
    url: `https://chatgpt.com/c/${conversationId}`,
    respond: () => {
      routeCalls++;
      return historicalRouteDisplay(current);
    },
    respondHistory: (message) => {
      historyCalls.push(message);
      if (message.message.event === "page") {
        const pageKey = message.message.page.messages
          .map((item: any) => item.sourceId)
          .join(":");
        if (!seenPages.has(pageKey)) {
          seenPages.add(pageKey);
          const count = seenPages.size + 1;
          current = historicalView(
            historicalSummary({
              prompt_count: String(count),
              response_count: String(count),
              observed_prompt_count: String(count),
              observed_response_count: String(count),
              calculated_message_count: String(count * 2),
              uncalculated_message_count: "0",
              first_request_verified: message.message.page.firstRequestVerified,
            }),
          );
        }
      }
      return { accepted: true };
    },
  });
  const postLifecycle = async (id: string, first: boolean, suffix: string) => {
    const messages = historicalMessages(conversationId, id, {
      first,
      suffix,
    });
    harness.postHistorical(messages.start);
    harness.postHistorical(messages.page);
    for (let index = 0; index < 20; index++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (
        historyCalls.filter((call) => call.message.event === "page").length >=
        seenPages.size
      )
        break;
    }
  };
  try {
    const shadow = await harness.loadRoute();
    await postLifecycle("00000000-0000-4000-8000-000000000212", false, "221");
    assert.match(
      shadow.querySelector("[data-metrics]")!.textContent!,
      /Req 2 · In\/Out tokens/,
    );

    await postLifecycle("00000000-0000-4000-8000-000000000213", false, "221");
    assert.match(
      shadow.querySelector("[data-metrics]")!.textContent!,
      /Req 2 · In\/Out tokens/,
    );

    await postLifecycle("00000000-0000-4000-8000-000000000214", true, "223");
    assert.match(
      shadow.querySelector("[data-metrics]")!.textContent!,
      /Req 3 · In\/Out tokens/,
    );
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    const details = shadow.querySelector("[data-body]")!.textContent!;
    assert.match(details, /First messageLoaded/);
    assert.doesNotMatch(
      barState(shadow),
      /Partially loaded|Scroll to the first message/,
    );
    assert.equal(routeCalls, 4);
    const relayed = historyCalls.filter(
      (call) => call.target === "history-observation",
    );
    assert.deepEqual(
      relayed.map((call) => call.message.event),
      ["start", "page", "start", "page", "start", "page"],
    );
    for (let index = 0; index < relayed.length; index += 2) {
      assert.deepEqual(relayed[index].binding, relayed[index + 1].binding);
      assert.equal(relayed[index].binding.captureId, null);
    }
    assert.ok(
      harness.calls.every((call) => call.target !== "capture"),
      "passive historical text must not become an observed execution",
    );
  } finally {
    harness.close();
  }
});

test("conductor: a failed historical page retains previously accepted numeric history", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000231";
  const previous = historicalView(
    historicalSummary({
      prompt_count: "9",
      response_count: "8",
      observed_prompt_count: "9",
      observed_response_count: "8",
      calculated_message_count: "16",
    }),
  );
  const harness = await contentHarness(false, {
    url: `https://chatgpt.com/c/${conversationId}`,
    respond: () => historicalRouteDisplay(previous),
    respondHistory: (message) =>
      message.message.event === "start"
        ? { accepted: true }
        : { accepted: false, error: "tokenizer_unavailable" },
  });
  try {
    const shadow = await harness.loadRoute();
    const messages = historicalMessages(
      conversationId,
      "00000000-0000-4000-8000-000000000232",
      { suffix: "233" },
    );
    harness.postHistorical(messages.start);
    harness.postHistorical(messages.page);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(
      shadow.querySelector("[data-metrics]")!.textContent!,
      /Req 9 · In\/Out tokens/,
    );
    assert.match(
      shadow.querySelector("[data-body]")!.textContent!,
      /latest loaded history could not be counted/,
    );
    assert.match(
      barState(shadow),
      /History update problem/,
    );
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    assert.match(
      shadow.querySelector("[data-body]")!.textContent!,
      /Previously accepted numeric history remains visible and separate/,
    );
    assert.equal(
      harness.calls.filter((call) => call.target === "conversation-summary")
        .length,
      1,
      "a rejected page must not replace the last valid numerical view",
    );
  } finally {
    harness.close();
  }
});

test("conductor: a failed refresh after accepted history keeps and labels the last snapshot", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000234";
  let routeCalls = 0;
  const previous = historicalView(historicalSummary());
  const harness = await contentHarness(false, {
    url: `https://chatgpt.com/c/${conversationId}`,
    respond: () =>
      ++routeCalls === 1
        ? historicalRouteDisplay(previous)
        : { error: "Recorded conversation totals are unavailable." },
    respondHistory: () => ({ accepted: true }),
  });
  try {
    const shadow = await harness.loadRoute();
    const messages = historicalMessages(
      conversationId,
      "00000000-0000-4000-8000-000000000235",
      { suffix: "236" },
    );
    harness.postHistorical(messages.start);
    harness.postHistorical(messages.page);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(
      shadow.querySelector("[data-metrics]")!.textContent!,
      /Req 2 · In\/Out tokens/,
    );
    assert.match(
      barState(shadow),
      /Saved totals refresh problem/,
    );
    assert.ok(shadow.querySelector("[data-body] .dt-retry"));
    assert.equal(routeCalls, 2);
  } finally {
    harness.close();
  }
});

test("conductor: a historical start without a page becomes visibly unavailable at its deadline", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000235";
  const previous = historicalView(historicalSummary());
  const harness = await contentHarness(false, {
    url: `https://chatgpt.com/c/${conversationId}`,
    respond: () => historicalRouteDisplay(previous),
    respondHistory: () => ({ accepted: true }),
    historyLifecycleMs: 10,
  });
  try {
    const shadow = await harness.loadRoute();
    harness.postHistorical(
      historicalMessages(
        conversationId,
        "00000000-0000-4000-8000-000000000236",
        { suffix: "237" },
      ).start,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.match(
      barState(shadow),
      /History update problem/,
    );
    assert.match(
      shadow.querySelector("[data-metrics]")!.textContent!,
      /Req 2 · In\/Out tokens/,
    );
    assert.equal(
      harness.calls.filter((call) => call.target === "conversation-summary")
        .length,
      1,
    );
  } finally {
    harness.close();
  }
});

test("conductor: historical timeout and admission diagnostics affect only the current route", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000238";
  const otherConversation = "00000000-0000-4000-8000-000000000239";
  const historyCalls: any[] = [];
  const harness = await contentHarness(false, {
    url: `https://chatgpt.com/c/${conversationId}`,
    respond: () => historicalRouteDisplay(historicalView(historicalSummary())),
    respondHistory: (message) => {
      historyCalls.push(message);
      return { accepted: true };
    },
  });
  try {
    const shadow = await harness.loadRoute();
    const messages = historicalMessages(
      conversationId,
      "00000000-0000-4000-8000-000000000240",
      { suffix: "241" },
    );
    harness.postHistorical(messages.start);
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.postHistorical({
      channel: historyCapture.HISTORY_DIAGNOSTIC_CHANNEL,
      site: "chatgpt",
      conversationId: otherConversation,
      observedAt: messages.start.observedAt,
      id: null,
      reason: "history_limit",
    });
    assert.doesNotMatch(
      barState(shadow),
      /History update problem/,
    );
    harness.postHistorical({
      channel: historyCapture.HISTORY_DIAGNOSTIC_CHANNEL,
      site: "chatgpt",
      conversationId,
      observedAt: messages.start.observedAt,
      id: messages.start.id,
      reason: "history_timeout",
    });
    assert.match(
      barState(shadow),
      /History update problem/,
    );
    harness.postHistorical(messages.page);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(
      historyCalls.map((call) => call.message.event),
      ["start"],
      "a timed-out lifecycle cannot relay a late page",
    );

    await harness.navigate(`/c/${otherConversation}`);
    harness.postHistorical({
      channel: historyCapture.HISTORY_DIAGNOSTIC_CHANNEL,
      site: "chatgpt",
      conversationId: otherConversation,
      observedAt: "2026-09-14T12:00:00.000Z",
      id: null,
      reason: "history_limit",
    });
    assert.match(
      barState(shadow),
      /History update problem/,
    );
  } finally {
    harness.close();
  }
});

test("conductor: an oversized history gets a compact reason without false scroll guidance", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000341";
  const history = historicalView(
    historicalSummary({
      status: "empty",
      prompt_count: "0",
      response_count: "0",
      tokens: [],
      resources: [],
    }),
  );
  const harness = await contentHarness(false, {
    url: `https://chatgpt.com/c/${conversationId}`,
    respond: () => historicalRouteDisplay(history),
  });
  try {
    const shadow = await harness.loadRoute();
    harness.postHistorical({
      channel: historyCapture.HISTORY_DIAGNOSTIC_CHANNEL,
      site: "chatgpt",
      conversationId,
      observedAt: new Date().toISOString(),
      id: null,
      reason: "history_response_limit",
    });
    // Nothing the person does changes the limit, so Details explains it and the bar keeps
    // only the figures (owner, 13 Oct 2026).
    assert.equal(barState(shadow), "");
    assert.equal(detailsOnly(shadow), "History too large");
    assert.doesNotMatch(detailsOnly(shadow), /Partially loaded|Scroll/);
    assert.doesNotMatch(
      shadow.querySelector("[data-metrics]")!.textContent!,
      /Req 0|latest loaded history/,
    );
    assert.equal(
      shadow.querySelector("[data-metrics]")!.textContent!,
      bar.BAR_NO_FIGURES,
    );
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    assert.match(
      shadow.querySelector("[data-body]")!.textContent!,
      /Scrolling or refreshing cannot reduce the response/,
    );
    const section = shadow.querySelector<HTMLElement>(
      '[data-section="not-counted"]',
    )!;
    assert.equal(section.dataset.tone, "warn");
    assert.match(section.textContent!, /Not everything could be counted/);
    assert.match(section.textContent!, /Chat too long to read in full/);
    assert.equal(
      shadow.querySelector("[data-status]")!.hasAttribute("tabindex"),
      false,
    );
  } finally {
    harness.close();
  }
});

test("conductor: Claude stream batches acknowledge counting before replacing empty history", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000351";
  const promptId = "00000000-0000-4000-8000-000000000352";
  const responseId = "00000000-0000-4000-8000-000000000353";
  let imported = false;
  const calls: any[] = [];
  const harness = await contentHarness(false, {
    url: `https://claude.ai/chat/${conversationId}`,
    html: '<main><form><div class="ProseMirror" contenteditable="true" role="textbox"></div></form></main>',
    respond: () =>
      historicalRouteDisplay(
        historicalView(
          historicalSummary(
            imported
              ? {
                  first_request_verified: true,
                  prompt_count: "1",
                  response_count: "1",
                }
              : {
                  status: "empty",
                  prompt_count: "0",
                  response_count: "0",
                  tokens: [],
                  resources: [],
                },
          ),
        ),
      ),
    respondHistory: (request) => {
      calls.push(request.message.event);
      if (request.message.event === "finish") imported = true;
      return { accepted: true };
    },
  });
  try {
    const shadow = await harness.loadRoute();
    const common = {
      id: crypto.randomUUID(),
      site: "claude" as const,
      conversationId,
      observedAt: new Date().toISOString(),
    };
    harness.postHistorical({
      ...common,
      channel: historyCapture.HISTORY_CAPTURE_CHANNEL,
      event: "start",
      page: null,
    });
    const rows = [
      adapters.claudeHistoryRow({
        uuid: promptId,
        parent_message_uuid: "00000000-0000-4000-8000-000000000000",
        index: 0,
        sender: "human",
        truncated: false,
        content: [{ type: "text", text: "synthetic prompt" }],
      }),
      adapters.claudeHistoryRow({
        uuid: responseId,
        parent_message_uuid: promptId,
        index: 1,
        sender: "assistant",
        truncated: false,
        stop_reason: "end_turn",
        content: [{ type: "text", text: "synthetic response" }],
      }),
    ];
    const send = async (event: "batch" | "finish") => {
      const channel = new MessageChannel();
      const acknowledgement = new Promise<any>((resolve) => {
        channel.port1.onmessage = (reply) => resolve(reply.data);
      });
      harness.postHistorical(
        {
          ...common,
          channel: claudeHistoryMessage.CLAUDE_STREAM_CHANNEL,
          event,
          rows: event === "batch" ? rows : null,
          leafId: event === "finish" ? responseId : null,
          rowCount: event === "finish" ? 2 : null,
          model: null,
        },
        [channel.port2],
      );
      const result = await acknowledgement;
      channel.port1.close();
      assert.deepEqual(result, { accepted: true });
    };
    await send("batch");
    assert.equal(imported, false);
    await send("finish");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(calls, ["start", "batch", "finish"]);
    assert.equal(imported, true);
    assert.doesNotMatch(
      barState(shadow),
      /History update problem/,
    );
  } finally {
    harness.close();
  }
});

test("conductor: an older accepted page cannot clear a newer historical warning", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000242";
  let releaseFirstPage!: (value: unknown) => void;
  let holdFirstPage = true;
  const harness = await contentHarness(false, {
    url: `https://chatgpt.com/c/${conversationId}`,
    respond: () => historicalRouteDisplay(historicalView(historicalSummary())),
    respondHistory: (message) => {
      if (message.message.event === "page" && holdFirstPage) {
        holdFirstPage = false;
        return new Promise((resolve) => (releaseFirstPage = resolve));
      }
      return { accepted: true };
    },
  });
  const post = (id: string, suffix: string) => {
    const messages = historicalMessages(conversationId, id, { suffix });
    harness.postHistorical(messages.start);
    harness.postHistorical(messages.page);
  };
  try {
    const shadow = await harness.loadRoute();
    post("00000000-0000-4000-8000-000000000243", "244");
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.postHistorical({
      channel: historyCapture.HISTORY_DIAGNOSTIC_CHANNEL,
      site: "chatgpt",
      conversationId,
      observedAt: "2026-09-14T12:00:00.000Z",
      id: null,
      reason: "history_limit",
    });
    releaseFirstPage({ accepted: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(
      barState(shadow),
      /History update problem/,
    );

    post("00000000-0000-4000-8000-000000000245", "246");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.doesNotMatch(
      barState(shadow),
      /History update problem/,
    );
  } finally {
    harness.close();
  }
});

test("conductor: unresolved historical counting is capped while ordinary capture remains responsive", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000241";
  const historyCalls: any[] = [];
  const harness = await contentHarness(false, {
    url: `https://chatgpt.com/c/${conversationId}`,
    respond: () =>
      historicalRouteDisplay(
        historicalView(
          historicalSummary({
            status: "unavailable",
            tokens: [],
            resources: [],
          }),
        ),
      ),
    respondHistory: (message) => {
      historyCalls.push(message);
      return new Promise(() => {});
    },
  });
  try {
    const shadow = await harness.loadRoute();
    for (let index = 0; index < 50; index++) {
      harness.postHistorical(
        historicalMessages(
          conversationId,
          `00000000-0000-4000-8000-${String(300 + index).padStart(12, "0")}`,
          { suffix: String(400 + index * 2) },
        ).start,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(historyCalls.length, 2);
    assert.match(
      barState(shadow),
      /History update problem/,
    );
    harness.render(null, { requestCount: 1 });
    assert.equal(
      harness.calls.filter((call) => call.target === "capture").length,
      1,
    );
  } finally {
    harness.close();
  }
});

test("a genuine history conflict shows Matching incomplete and explains why on hover", async () => {
  const history = historicalView(
    historicalSummary({ conflicting_message_count: "1" }),
  );
  const harness = await contentHarness(false, {
    url: "https://chatgpt.com/c/00000000-0000-4000-8000-000000000291",
    respond: () => historicalRouteDisplay(history),
  });
  try {
    const shadow = await harness.loadRoute();
    // The person cannot fix a conflict, so it leaves the bar for Details, under a warning
    // header that says what was not counted and why (owner, 13 Oct 2026).
    assert.doesNotMatch(
      barState(shadow),
      /Matching incomplete/,
    );
    assert.match(detailsOnly(shadow), /Matching incomplete/);
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    const section = shadow.querySelector<HTMLElement>(
      '[data-section="not-counted"]',
    )!;
    assert.match(section.textContent!, /Not all records linked/);
    assert.match(section.textContent!, /could not be linked/);
    // It sits with the problems at the end of Details, before page health notes.
    assert.equal(
      section.nextElementSibling?.classList.contains("dt-problems"),
      true,
    );
    const toggle = section.querySelector<HTMLButtonElement>(".dt-disc")!;
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    toggle.click();
    assert.equal(toggle.getAttribute("aria-expanded"), "true");
    assert.match(section.textContent!, /Counted: Req 2 · /);
    assert.match(
      shadow.querySelector("[data-body]")!.textContent!,
      /Matching incomplete:.*Conflicting records are excluded/,
    );
  } finally {
    harness.close();
  }
});

test("conductor: new and earlier requests render once under the same Requests label", async () => {
  const history = historicalView(historicalSummary());
  const display = historicalRouteDisplay(history);
  display.summary.requests = 3;
  const harness = await contentHarness(false, {
    url: "https://chatgpt.com/c/00000000-0000-4000-8000-000000000291",
    respond: () => display,
  });
  try {
    const shadow = await harness.loadRoute();
    const text = shadow.querySelector("[data-metrics]")!.textContent!;
    assert.match(text, /^Req ≈ 5 · In\/Out tokens/);
    assert.equal((text.match(/Req/g) ?? []).length, 1);
    assert.doesNotMatch(text, /Imported|Historical|Calculated messages/);
    assert.match(
      detailsOnly(shadow),
      /Partially loaded/,
    );
    assert.doesNotMatch(
      shadow.querySelector(".bar")!.textContent!,
      /Matching incomplete/,
    );
    assert.match(
      shadow.querySelector("[data-body]")!.textContent!,
      /not itself a tracking failure.*may include overlap/,
    );
    assert.match(
      shadow.querySelector("[data-body]")!.textContent!,
      /New requests3/,
    );
  } finally {
    harness.close();
  }
});

test("conductor: an unsaved old chat shows a loading label, then History not loaded when no history arrives", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000301";
  const harness = await contentHarness(false, {
    url: `https://chatgpt.com/c/${conversationId}`,
    respond: () =>
      historicalRouteDisplay(
        historicalView(historicalSummary({ status: "empty" })),
      ),
    captureGraceTimers: true,
  });
  try {
    const shadow = await harness.loadRoute();
    const metrics = () => shadow.querySelector("[data-metrics]")!.textContent!;
    const status = () => barState(shadow);
    // Waiting for the page's read of the chat is work in progress (owner, 14 Oct 2026).
    assert.equal(metrics(), bar.BAR_PROCESSING);
    assert.equal(status(), "Loading earlier messages");
    assert.equal(
      shadow.querySelector("[data-progress-line]")!.textContent,
      "Reading earlier messages",
    );
    harness.setVisibility("visible");
    harness.fireGraceTimers();
    // The tracker first reads the chat itself; when that fails, only a reload counts it,
    // so Details opens with that action (owner, 14 Oct 2026).
    assert.equal(status(), "Loading earlier messages");
    await settleOwnRead();
    harness.ownReadRequests()[0]!.ports[0]!.postMessage({
      outcome: { kind: "http", status: 404, shouldRetry: false },
    });
    for (let i = 0; i < 40 && status() !== "History not loaded (reload page)"; i++)
      await settleOwnRead(1);
    assert.equal(metrics(), bar.BAR_NO_FIGURES);
    assert.equal(status(), "History not loaded (reload page)");
    assert.doesNotMatch(
      metrics() + status(),
      /Req 0|Partly measured|Partially loaded|Scroll/,
    );
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    // Details opens with the state and a reload button, as reloading is the fix.
    const first = shadow.querySelector<HTMLElement>("[data-body] .dt-status")!;
    assert.match(first.textContent!, /Earlier messages not loaded/);
    assert.ok(first.querySelector(".dt-reload"));
    assert.match(
      shadow.querySelector("[data-body]")!.textContent!,
      /ChatGPT did not load this chat's messages again.*Reload the page to count earlier messages/,
    );
    // A request sent in this view is measured activity, never a missing-history state.
    harness.render(null, { requestCount: 1 });
    assert.match(metrics(), /Req 1/);
    assert.doesNotMatch(status(), /History not loaded/);
  } finally {
    harness.close();
  }
});

// The Claude own read (owner decision of 13 Oct 2026): the content script asks the page
// world for one read when claude.ai showed a cached chat without loading it.
async function claudeOwnReadHarness(
  conversationId: string,
  visibility: "visible" | "hidden" = "visible",
  respondOwnReadPause?: (message: any) => unknown,
  respondOwnReadSetting?: (message: any) => unknown,
) {
  const state = { imported: false };
  const historyEvents: string[] = [];
  const harness = await contentHarness(false, {
    url: `https://claude.ai/chat/${conversationId}`,
    html: '<main><form><div class="ProseMirror" contenteditable="true" role="textbox"></div></form></main>',
    respond: () =>
      historicalRouteDisplay(
        historicalView(
          state.imported
            ? historicalSummary({ first_request_verified: true })
            : historicalSummary({
                status: "empty",
                prompt_count: "0",
                response_count: "0",
                tokens: [],
                resources: [],
              }),
        ),
      ),
    respondHistory: (request) => {
      historyEvents.push(request.message.event);
      if (request.message.event === "finish") state.imported = true;
      return { accepted: true };
    },
    respondOwnReadPause,
    respondOwnReadSetting,
    captureGraceTimers: true,
  });
  harness.setVisibility(visibility);
  return { harness, state, historyEvents };
}

/** What the page world's history reader posts for one read of a two-message chat. */
async function postClaudeImport(
  harness: Awaited<ReturnType<typeof contentHarness>>,
  conversationId: string,
  suffix: number,
) {
  const promptId = `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
  const responseId = `00000000-0000-4000-8000-${String(suffix + 1).padStart(12, "0")}`;
  const common = {
    id: crypto.randomUUID(),
    site: "claude" as const,
    conversationId,
    observedAt: new Date().toISOString(),
  };
  const start = () =>
    harness.postHistorical({
      ...common,
      channel: historyCapture.HISTORY_CAPTURE_CHANNEL,
      event: "start",
      page: null,
    });
  const send = async (event: "batch" | "finish") => {
    const channel = new MessageChannel();
    const acknowledgement = new Promise<any>((resolve) => {
      channel.port1.onmessage = (reply) => resolve(reply.data);
    });
    harness.postHistorical(
      {
        ...common,
        channel: claudeHistoryMessage.CLAUDE_STREAM_CHANNEL,
        event,
        rows:
          event === "batch"
            ? [
                adapters.claudeHistoryRow({
                  uuid: promptId,
                  parent_message_uuid: "00000000-0000-4000-8000-000000000000",
                  index: 0,
                  sender: "human",
                  truncated: false,
                  content: [{ type: "text", text: "synthetic prompt" }],
                }),
                adapters.claudeHistoryRow({
                  uuid: responseId,
                  parent_message_uuid: promptId,
                  index: 1,
                  sender: "assistant",
                  truncated: false,
                  stop_reason: "end_turn",
                  content: [{ type: "text", text: "synthetic response" }],
                }),
              ]
            : null,
        leafId: event === "finish" ? responseId : null,
        rowCount: event === "finish" ? 2 : null,
        model: null,
      },
      [channel.port2],
    );
    const result = await acknowledgement;
    channel.port1.close();
    return result;
  };
  return { start, send };
}

const settleOwnRead = async (rounds = 3) => {
  for (let i = 0; i < rounds; i++)
    await new Promise((resolve) => setTimeout(resolve, 0));
};

test("conductor: a cached Claude chat with no page read gets one own read after the grace period and shows figures", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000501";
  const { harness, historyEvents } = await claudeOwnReadHarness(conversationId);
  try {
    const shadow = await harness.loadRoute();
    const metrics = () => shadow.querySelector("[data-metrics]")!.textContent!;
    const status = () => barState(shadow);
    assert.equal(metrics(), bar.BAR_PROCESSING);
    assert.equal(harness.ownReadRequests().length, 0, "no read during the grace period");
    harness.fireGraceTimers();
    // The bar stays on Processing instead of No figures yet while the read is due.
    assert.equal(metrics(), bar.BAR_PROCESSING);
    assert.doesNotMatch(status(), /History not loaded/);
    await settleOwnRead();
    const requests = harness.ownReadRequests();
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0]!.message, {
      channel: ownReadModule.OWN_READ_CHANNEL,
      site: "claude",
      conversationId,
    });
    assert.equal(requests[0]!.ports.length, 1);
    // The page world hands the answer to the history reader, then replies.
    const read = await postClaudeImport(harness, conversationId, 502);
    read.start();
    assert.deepEqual(await read.send("batch"), { accepted: true });
    requests[0]!.ports[0]!.postMessage({ outcome: { kind: "read" } });
    assert.deepEqual(await read.send("finish"), { accepted: true });
    for (let i = 0; i < 40 && !/Req 2/.test(metrics()); i++) await settleOwnRead(1);
    assert.match(metrics(), /Req 2 · In\/Out tokens/);
    assert.doesNotMatch(status(), /History not loaded|History update problem/);
    assert.deepEqual(historyEvents, ["start", "batch", "finish"]);
    assert.match(
      shadow.querySelector("[data-body]")!.textContent!,
      /read the chat from Claude once to count it/,
    );
    harness.fireGraceTimers();
    await settleOwnRead();
    assert.equal(harness.ownReadRequests().length, 1, "one read per navigation");
  } finally {
    harness.close();
  }
});

test("conductor: a Claude chat the page reads within the grace period gets no own read", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000511";
  const { harness } = await claudeOwnReadHarness(conversationId);
  try {
    const shadow = await harness.loadRoute();
    const read = await postClaudeImport(harness, conversationId, 512);
    read.start();
    await settleOwnRead();
    harness.fireGraceTimers();
    await settleOwnRead();
    assert.equal(harness.ownReadRequests().length, 0);
    // The page's read is still being imported.
    assert.equal(
      shadow.querySelector("[data-metrics]")!.textContent!,
      bar.BAR_PROCESSING,
    );
  } finally {
    harness.close();
  }
});

test("conductor: a page read that starts while the own read is due cancels it", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000515";
  const { harness } = await claudeOwnReadHarness(conversationId, "hidden");
  try {
    await harness.loadRoute();
    harness.fireGraceTimers();
    await settleOwnRead();
    // The page reads the chat before the tab is shown, so the own read is not sent.
    const read = await postClaudeImport(harness, conversationId, 516);
    read.start();
    await settleOwnRead();
    harness.setVisibility("visible");
    await settleOwnRead();
    assert.equal(harness.ownReadRequests().length, 0);
  } finally {
    harness.close();
  }
});

for (const [label, outcome, reason] of [
  ["404", { kind: "http", status: 404, shouldRetry: false }, /Claude did not find the chat \(status 404\)/],
  ["403", { kind: "http", status: 403, shouldRetry: true }, /Claude refused the read \(status 403\)/],
  ["429", { kind: "http", status: 429, shouldRetry: true }, /Claude asked for fewer requests \(status 429\)/],
  ["network error", { kind: "network" }, /the request did not reach Claude/],
  ["invalid JSON", { kind: "invalid" }, /Claude's answer could not be read/],
] as const)
  test(`conductor: a failed Claude own read (${label}) falls back to History not loaded with the reason in Details`, async () => {
    const conversationId = "00000000-0000-4000-8000-000000000521";
    const { harness, historyEvents } =
      await claudeOwnReadHarness(conversationId);
    try {
      const shadow = await harness.loadRoute();
      harness.fireGraceTimers();
      await settleOwnRead();
      const requests = harness.ownReadRequests();
      assert.equal(requests.length, 1);
      requests[0]!.ports[0]!.postMessage({ outcome });
      await settleOwnRead(5);
      assert.equal(
        shadow.querySelector("[data-metrics]")!.textContent!,
        bar.BAR_NO_FIGURES,
      );
      const status = barState(shadow);
      assert.equal(status, "History not loaded (reload page)", "no new bar error");
      const body = shadow.querySelector("[data-body]")!.textContent!;
      assert.match(body, /Reload the page to count earlier messages/);
      assert.match(body, reason);
      assert.deepEqual(historyEvents, [], "nothing reached the history import");
      harness.fireGraceTimers();
      await settleOwnRead();
      assert.equal(harness.ownReadRequests().length, 1, "no retry in this navigation");
    } finally {
      harness.close();
    }
  });

// A 429 or 5xx pause is shared with the site's other tabs through the background (14 Oct 2026,
// lib/own-read-pause.ts): the tab asks for the site's pause and reports its own.
test("conductor: a Claude own read asks the background for the site's pause and reports a 429 pause to it", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000526";
  const messages: any[] = [];
  const { harness } = await claudeOwnReadHarness(conversationId, "visible", (message) => {
    messages.push(message);
    return null;
  });
  try {
    await harness.loadRoute();
    harness.fireGraceTimers();
    await settleOwnRead();
    const requests = harness.ownReadRequests();
    assert.equal(requests.length, 1, "no pause stored, so the read is made");
    assert.ok(messages.length > 0);
    for (const message of messages)
      assert.deepEqual(message, { target: "own-read-pause", site: "claude" });
    const before = messages.length;
    requests[0]!.ports[0]!.postMessage({
      outcome: { kind: "http", status: 429, shouldRetry: true },
    });
    const stored = () => messages.slice(before).filter((message) => "until" in message);
    for (let i = 0; i < 40 && stored().length === 0; i++) await settleOwnRead(1);
    await settleOwnRead();
    assert.equal(stored().length, 1);
    const [pause] = stored();
    assert.deepEqual(Object.keys(pause).sort(), ["site", "target", "until"]);
    assert.equal(pause.site, "claude");
    assert.ok(pause.until > Date.now(), "the end of the pause, a time only");
  } finally {
    harness.close();
  }
});

test("conductor: a pause another Claude tab started holds this tab's own read", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000527";
  const { harness } = await claudeOwnReadHarness(conversationId, "visible", () =>
    Date.now() + 60_000,
  );
  try {
    const shadow = await harness.loadRoute();
    await settleOwnRead();
    harness.fireGraceTimers();
    await settleOwnRead(5);
    assert.equal(harness.ownReadRequests().length, 0);
    assert.match(
      shadow.querySelector("[data-body]")!.textContent!,
      /refused or limited an earlier read/,
    );
  } finally {
    harness.close();
  }
});

test("conductor: a page read the history reader refuses gets one own read, marked as such", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000531";
  const historyEvents: string[] = [];
  const harness = await contentHarness(false, {
    url: `https://claude.ai/chat/${conversationId}`,
    html: '<main><form><div class="ProseMirror" contenteditable="true" role="textbox"></div></form></main>',
    respond: () =>
      historicalRouteDisplay(
        historicalView(historicalSummary({ status: "empty", prompt_count: "0", response_count: "0", tokens: [], resources: [] })),
      ),
    // The page's read reaches the history reader, which refuses it.
    respondHistory: (request) => {
      historyEvents.push(request.message.event);
      return { accepted: false };
    },
    captureGraceTimers: true,
  });
  try {
    harness.setVisibility("visible");
    const shadow = await harness.loadRoute();
    const read = await postClaudeImport(harness, conversationId, 532);
    read.start();
    await read.send("batch");
    for (let i = 0; i < 40 && !/History update problem/.test(barState(shadow)); i++)
      await settleOwnRead(1);
    assert.match(barState(shadow), /History update problem/);
    await settleOwnRead();
    const requests = harness.ownReadRequests();
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0]!.message, {
      channel: ownReadModule.OWN_READ_CHANNEL,
      site: "claude",
      conversationId,
      rejected: true,
    });
    // The page world found the same request as the page's and skipped it: nothing changes.
    requests[0]!.ports[0]!.postMessage({ outcome: { kind: "page_read" } });
    await settleOwnRead(5);
    harness.fireGraceTimers();
    await settleOwnRead();
    assert.equal(harness.ownReadRequests().length, 1, "once per navigation");
    assert.match(barState(shadow), /History update problem/);
  } finally {
    harness.close();
  }
});

test("conductor: a hidden Claude tab makes its own read only once it is visible", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000531";
  const { harness } = await claudeOwnReadHarness(conversationId, "hidden");
  try {
    const shadow = await harness.loadRoute();
    harness.fireGraceTimers();
    await settleOwnRead();
    assert.equal(harness.ownReadRequests().length, 0);
    // The read waits for the tab to be shown, so the chat is still being read.
    assert.equal(
      shadow.querySelector("[data-metrics]")!.textContent!,
      bar.BAR_PROCESSING,
    );
    harness.setVisibility("visible");
    await settleOwnRead();
    assert.equal(harness.ownReadRequests().length, 1);
  } finally {
    harness.close();
  }
});

test("conductor: a Gemini chat shown without its history read gets one own read", async () => {
  const harness = await contentHarness(false, {
    url: "https://gemini.google.com/u/2/app/0000000000000042",
    html: '<main><form><rich-textarea><div contenteditable="true"></div></rich-textarea></form></main>',
    respond: () =>
      historicalRouteDisplay(
        historicalView(historicalSummary({ status: "empty" })),
      ),
    captureGraceTimers: true,
  });
  try {
    harness.setVisibility("visible");
    const shadow = await harness.loadRoute();
    assert.equal(harness.ownReadRequests().length, 0, "no read during the grace period");
    harness.fireGraceTimers();
    await settleOwnRead();
    const requests = harness.ownReadRequests();
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0]!.message, {
      channel: ownReadModule.OWN_READ_CHANNEL,
      site: "gemini",
      conversationId: "c_0000000000000042",
    });
    assert.doesNotMatch(barState(shadow), /History not loaded/);
  } finally {
    harness.close();
  }
});

test("conductor: a Perplexity thread shown without its thread read gets one own read", async () => {
  const threadId = "00000000-0000-4000-8000-000000000561";
  const harness = await contentHarness(false, {
    url: `https://www.perplexity.ai/search/${threadId}`,
    respond: () =>
      historicalRouteDisplay(
        historicalView(historicalSummary({ status: "empty" })),
      ),
    captureGraceTimers: true,
  });
  try {
    harness.setVisibility("visible");
    const shadow = await harness.loadRoute();
    assert.equal(harness.ownReadRequests().length, 0, "no read during the grace period");
    harness.fireGraceTimers();
    await settleOwnRead();
    const requests = harness.ownReadRequests();
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0]!.message, {
      channel: ownReadModule.OWN_READ_CHANNEL,
      site: "perplexity",
      conversationId: threadId,
    });
    assert.doesNotMatch(barState(shadow), /History not loaded/);
  } finally {
    harness.close();
  }
});

test("conductor: a Perplexity Computer task is a thread and gets one own read", async () => {
  // Live bug of 14 Oct 2026: /computer/tasks/<id> was no route, so the task was never
  // counted and the bar stayed at "Waiting for your request".
  const taskId = "00000000-0000-4000-8000-000000000562";
  const harness = await contentHarness(false, {
    url: `https://www.perplexity.ai/computer/tasks/${taskId}`,
    respond: () =>
      historicalRouteDisplay(
        historicalView(historicalSummary({ status: "empty" })),
      ),
    captureGraceTimers: true,
  });
  try {
    harness.setVisibility("visible");
    await harness.loadRoute();
    harness.fireGraceTimers();
    await settleOwnRead();
    const requests = harness.ownReadRequests();
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0]!.message, {
      channel: ownReadModule.OWN_READ_CHANNEL,
      site: "perplexity",
      conversationId: taskId,
    });
  } finally {
    harness.close();
  }
});

test("conductor: a thread link that lands after a newer totals read still refreshes the totals", async () => {
  // Live finding of 14 Oct 2026 on a Perplexity Computer task: the own read's thread page
  // linked the task's recorded request, but a totals read made while the link was saved
  // (the text import's refresh) counted as newer, so the link's refresh was dropped and the
  // bar stayed on No figures yet until the next navigation.
  const threadId = "00000000-0000-4000-8000-000000000563";
  let routeCalls = 0;
  let releasePage = null as ((value: unknown) => void) | null;
  const harness = await contentHarness(false, {
    url: `https://www.perplexity.ai/computer/tasks/${threadId}`,
    respond: () => {
      routeCalls++;
      return {
        ...historicalRouteDisplay(
          historicalView(historicalSummary({ status: "unavailable", resources: [] })),
        ),
        calculationPending: routeCalls === 1,
      };
    },
    respondThread: (message) =>
      message.payload.event === "start"
        ? { observed: false }
        : new Promise((resolve) => (releasePage = resolve)),
  });
  const ticks = async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  };
  try {
    await harness.loadRoute();
    assert.equal(routeCalls, 1);
    const start = {
      channel: adapters.THREAD_HISTORY_CHANNEL,
      event: "start",
      id: "00000000-0000-4000-8000-000000000564",
      at: new Date().toISOString(),
      site: "perplexity",
      threadId,
      page: null,
    };
    harness.postThreadHistory(start);
    harness.postThreadHistory({
      ...start,
      event: "page",
      page: {
        requestIds: ["00000000-0000-4000-8000-000000000565"],
        hasNextPage: false,
      },
    });
    await ticks();
    assert.ok(releasePage, "the page link was sent");
    // A newer totals read while the link is being saved.
    harness.deliver(
      { target: "footprint-calculation-updated" },
      { id: "content-test-extension" },
    );
    await ticks();
    assert.equal(routeCalls, 2);
    releasePage!({ observed: true });
    await ticks();
    assert.equal(routeCalls, 3, "the totals are read again after the link");
  } finally {
    harness.close();
  }
});

test("conductor: No figures yet always names its reason in Details", async () => {
  // Live finding of 14 Oct 2026: a Perplexity Computer task's saved messages all matched the
  // request recorded when the task was sent, which was not linked to the task yet. The bar
  // showed No figures yet and Details named no reason.
  const threadId = "00000000-0000-4000-8000-000000000566";
  const harness = await contentHarness(false, {
    url: `https://www.perplexity.ai/computer/tasks/${threadId}`,
    respond: () =>
      historicalRouteDisplay(
        historicalView(
          historicalSummary({
            observed_prompt_count: "1",
            observed_response_count: "1",
            prompt_count: "0",
            response_count: "0",
            dated_message_count: "2",
            undated_message_count: "0",
            calculated_message_count: "0",
            uncalculated_message_count: "0",
            matched_live_message_count: "2",
            unresolved_overlap_message_count: "0",
            first_request_verified: true,
          }),
        ),
      ),
    captureGraceTimers: true,
  });
  try {
    const shadow = await harness.loadRoute();
    harness.fireGraceTimers();
    await settleOwnRead();
    assert.equal(harness.ownReadRequests().length, 0);
    assert.equal(
      shadow.querySelector("[data-metrics]")!.textContent,
      bar.BAR_NO_FIGURES,
    );
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    const details = shadow.querySelector("[data-body]")!.textContent!;
    assert.match(details, /Not everything could be counted/);
    assert.match(details, /Requests not linked to this chat/);
    assert.match(
      details,
      /match requests the tracker recorded when they were sent, but those requests are not linked to this chat yet/,
    );
  } finally {
    harness.close();
  }
});

test("conductor: a Computer task counted only from saved history lists its files in What was counted", async () => {
  // Live finding of 14 Oct 2026 on a full load in a fresh profile: both files of the task
  // were downloaded and counted (tool input 133 + 54 tokens), but no request was recorded
  // for the task, so the recorded thread was "unavailable" and Details showed no Files line,
  // which was only added to the explanation of recorded or synced totals.
  const threadId = "00000000-0000-4000-8000-000000000568";
  const harness = await contentHarness(false, {
    url: `https://www.perplexity.ai/computer/tasks/${threadId}`,
    respond: () => ({
      ...historicalRouteDisplay(
        historicalView(
          historicalSummary({
            observed_prompt_count: "1",
            observed_response_count: "1",
            prompt_count: "1",
            response_count: "1",
            dated_message_count: "2",
            undated_message_count: "0",
            calculated_message_count: "2",
            uncalculated_message_count: "0",
            unresolved_overlap_message_count: "0",
            first_request_verified: true,
          }),
          { computer_files: { content: 2, size: 0 } },
        ),
      ),
      recordedThread: {
        status: "unavailable",
        providerHistoryComplete: false,
        observedPageRequests: 1,
        unmatchedPageRequests: 1,
        hasNextPage: false,
        coverageAfterRestart: "observed_page",
      },
    }),
  });
  try {
    const shadow = await harness.loadRoute();
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    const counted = shadow.querySelector('[data-section="counted"]')!.textContent!;
    assert.match(counted, /Files created: 2 \(counted from their content\)\./);
    const details = shadow.querySelector("[data-body]")!.textContent!;
    assert.equal(details.split("Files created:").length, 2, "listed once");
  } finally {
    harness.close();
  }
});

// Live QA of 19 Oct 2026: a new Claude chat with an attached image counted the prompt only, and
// Details nowhere said why. The note sat in the explanation of the recorded totals, inside a
// closed section, instead of with what was counted.
test("conductor: a live Claude chat says under What was counted why an attached image adds no input", async () => {
  const chat = "00000000-0000-4000-8000-000000000c21";
  const harness = await contentHarness(false, {
    url: `https://claude.ai/chat/${chat}`,
    html: '<main><form><div class="ProseMirror" contenteditable="true" role="textbox"></div></form></main>',
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
  });
  try {
    await harness.loadRoute();
    const shadow = harness.render(null, { requestCount: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    const counted = shadow.querySelector('[data-section="counted"]')!.textContent!;
    assert.match(
      counted,
      /Images you attach are sent as file references without their size, so their tokens are not counted as input\./,
    );
    const details = shadow.querySelector("[data-body]")!.textContent!;
    assert.equal(details.split("Images you attach").length, 2, "listed once");
  } finally {
    harness.close();
  }
});

test("conductor: No figures yet without a known cause still names a reason", async () => {
  const threadId = "00000000-0000-4000-8000-000000000567";
  const harness = await contentHarness(false, {
    url: `https://www.perplexity.ai/computer/tasks/${threadId}`,
    respond: () =>
      historicalRouteDisplay(
        historicalView(
          historicalSummary({
            observed_prompt_count: "0",
            observed_response_count: "0",
            prompt_count: "0",
            response_count: "0",
            dated_message_count: "0",
            undated_message_count: "0",
            calculated_message_count: "0",
            uncalculated_message_count: "0",
            conflicting_message_count: "0",
            unresolved_overlap_message_count: "0",
            first_request_verified: true,
          }),
        ),
      ),
    captureGraceTimers: true,
  });
  try {
    const shadow = await harness.loadRoute();
    harness.fireGraceTimers();
    await settleOwnRead();
    assert.equal(
      shadow.querySelector("[data-metrics]")!.textContent,
      bar.BAR_NO_FIGURES,
    );
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    const details = shadow.querySelector("[data-body]")!.textContent!;
    assert.match(details, /Not everything could be counted/);
    assert.match(details, /No request counted/);
    assert.doesNotMatch(details, /Requests not linked to this chat/);
  } finally {
    harness.close();
  }
});

// Live QA of 19 Oct 2026: a ChatGPT Pro reply stopped while ChatGPT was still thinking showed
// Req 1, In/Out 24/0 and Unknown electricity, carbon and water, and Details gave no reason.
test("conductor: a reply stopped before any answer says under Not everything could be counted why its figures are unknown", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000c31";
  const stoppedSummary = (stopped: number, output: string) => {
    const empty = new SummaryAccumulator().result();
    const known = (value: string) => ({ ...empty.tokens.output, value, known: 1 });
    return {
      ...empty,
      requests: 1,
      attempts: 1,
      tokens: { ...empty.tokens, input: known("24"), output: known(output) },
      outcomes: { ...empty.outcomes, cancelled: 1 },
      metrics: {
        energy: { ...empty.metrics.energy, unknown: 1 },
        carbon: { ...empty.metrics.carbon, unknown: 1 },
        waterDirect: { ...empty.metrics.waterDirect, unknown: 1 },
        waterUpstream: { ...empty.metrics.waterUpstream, unknown: 1 },
        water: { ...empty.metrics.water, unknown: 1 },
      },
      stoppedWithoutAnswer: stopped,
    };
  };
  const open = async (summary: unknown) => {
    const harness = await contentHarness(false, {
      url: `https://chatgpt.com/c/${conversationId}`,
      respond: () => ({ error: "Recorded conversation totals are unavailable." }),
      respondCapture: () => ({ ok: true }),
    });
    await harness.loadRoute();
    const shadow = harness.render(null, { requestCount: 1, summary });
    await new Promise((resolve) => setImmediate(resolve));
    const barText = shadow.querySelector("[data-metrics]")!.textContent!;
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    return {
      harness,
      barText,
      details: shadow.querySelector("[data-body]")!.textContent!,
      section: shadow.querySelector<HTMLElement>('[data-section="not-counted"]'),
    };
  };
  const stopped = await open(stoppedSummary(1, "0"));
  try {
    // The bar keeps its figures only.
    assert.equal(
      stopped.barText,
      "Req 1 · In/Out tokens - ≈ 24/0 · Electricity Unknown · Carbon Unknown · Water Unknown",
    );
    assert.ok(stopped.section, "the collapsible section is shown");
    assert.equal(stopped.section!.dataset.tone, "warn");
    assert.match(stopped.details, /Not everything could be counted/);
    assert.match(stopped.details, /Stopped reply not estimated/);
    assert.match(
      stopped.details,
      /A reply was stopped before any answer was written, so it has no output tokens to estimate from\. The model may already have been thinking, but ChatGPT does not show that work, so the tracker cannot estimate it either\. The reply's electricity, carbon and water are left out of the figures, not counted as zero\./,
    );
    assert.equal(stopped.details.split("Stopped reply not estimated").length, 3, "chip in the header and the list");
  } finally {
    stopped.harness.close();
  }
  // An ordinary reply with figures gets no such entry.
  const ordinary = await open(stoppedSummary(0, "40"));
  try {
    assert.doesNotMatch(ordinary.details, /Stopped repl/);
    assert.doesNotMatch(ordinary.details, /stopped before any answer/);
    assert.equal(ordinary.section, null);
  } finally {
    ordinary.harness.close();
  }
});

test("conductor: a ChatGPT chat the page never read gets one own read", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000541";
  const chatgpt = await contentHarness(false, {
    url: `https://chatgpt.com/c/${conversationId}`,
    respond: () =>
      historicalRouteDisplay(
        historicalView(historicalSummary({ status: "empty" })),
      ),
    captureGraceTimers: true,
  });
  try {
    chatgpt.setVisibility("visible");
    const shadow = await chatgpt.loadRoute();
    chatgpt.fireGraceTimers();
    await settleOwnRead();
    const requests = chatgpt.ownReadRequests();
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0]!.message, {
      channel: ownReadModule.OWN_READ_CHANNEL,
      site: "chatgpt",
      conversationId,
    });
    assert.doesNotMatch(barState(shadow), /History not loaded/);
  } finally {
    chatgpt.close();
  }
});

// Live, 20 Oct 2026: ChatGPT used without an account moves a new chat from / to /uc/<id> about
// 1 to 2 s after the send, once its stream names the chat, often before a display of the reply
// names it. The chat is never saved: reloading /uc/<id> opens an empty chat at / and nothing
// reads it back. So the reply must stay selected across the move, the tracker must never wait
// for or ask for a saved copy, and Details must say plainly when earlier messages were missed.
const UNSAVED_CHAT = "6ad70000-0000-83ea-8000-0000000000c1";
const notSavedText = /ChatGPT does not save chats made without an account/;

// Live, 20 Oct 2026: on the first loads of signed-out ChatGPT, the bar and the advice host placed
// next to the composer form before the page finished its own setup made the page draw the
// composer again without its text box (the same happens without the extension when two empty
// divs are added there). The page marks the end of its setup with
// html[data-octane-home-behavior-ready]; the tracker now places its hosts only after that.
test("conductor: the signed-out ChatGPT bar waits until the page marks its composer set up, then appears", async () => {
  const harness = await contentHarness(false, {
    url: "https://chatgpt.com/",
    respond: () =>
      historicalRouteDisplay(historicalView(historicalSummary({ status: "empty" }))),
    captureScanTimer: true,
    html: `<main><div data-composer-dock><div>
      <form data-landing data-logged-out data-mobile-composer>
        <div data-composer-wrap-outer><div data-composer-wrap-inner><div data-composer-primary>
          <div data-composer-editor-host><textarea id="mobile-composer-prompt" data-mobile-composer-prompt name="prompt"></textarea></div>
        </div></div></div>
        <button type="submit" aria-label="Send message" data-composer-submit></button>
      </form>
    </div></div></main>`,
  });
  try {
    await harness.popstate();
    const form = harness.document.querySelector("form[data-mobile-composer]")!;
    assert.equal(
      harness.document.querySelector("[data-ai-footprint]"),
      null,
      "nothing is placed next to the composer while the page sets it up",
    );
    assert.equal(form.parentElement!.children.length, 1);
    harness.document.documentElement.setAttribute("data-octane-home-behavior-ready", "");
    await harness.runComposerScan();
    assert.equal(form.nextElementSibling?.getAttribute("data-ai-footprint"), "information");
    assert.equal(form.previousElementSibling?.getAttribute("data-ai-footprint"), "context-advice");
  } finally {
    harness.close();
  }
});

test("conductor: a new signed-out ChatGPT chat keeps its reply across the move to /uc/<id> and needs no saved copy", async () => {
  const harness = await contentHarness(false, {
    url: "https://chatgpt.com/",
    respond: () =>
      historicalRouteDisplay(historicalView(historicalSummary({ status: "empty" }))),
    respondCapture: () => ({ ok: true }),
    captureGraceTimers: true,
  });
  try {
    harness.setVisibility("visible");
    const shadow = harness.render(null, { state: "dispatched" });
    const binding = harness.currentCaptureBinding();
    assert.ok(binding);
    // The page moves before any display named the chat.
    await harness.navigate(`/uc/${UNSAVED_CHAT}`);
    harness.deliverDisplay(binding, { site: "chatgpt", conversationId: UNSAVED_CHAT }, "1");
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(shadow.querySelector("[data-metrics]")!.textContent!, /^Req 1 · /);
    harness.fireGraceTimers();
    await settleOwnRead();
    assert.equal(harness.ownReadRequests().length, 0, "no own read of an unsaved chat");
    assert.ok(
      !harness.calls.some((call: any) => call?.target === "chatgpt-read-progress"),
      "no read progress for an unsaved chat",
    );
    assert.match(shadow.querySelector("[data-metrics]")!.textContent!, /^Req 1 · /);
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    const details = shadow.querySelector("[data-body]")!.textContent!;
    assert.doesNotMatch(details, notSavedText, "every message of this chat was seen");
    assert.doesNotMatch(details, /Earlier messages not loaded|History not loaded/);
    assert.doesNotMatch(detailsOnly(shadow), /Earlier messages not saved/);
  } finally {
    harness.close();
  }
});

test("conductor: a signed-out ChatGPT chat whose start this page missed shows No figures yet, no own read, and says why in Details", async () => {
  const harness = await contentHarness(false, {
    url: `https://chatgpt.com/uc/${UNSAVED_CHAT}`,
    respond: () =>
      historicalRouteDisplay(historicalView(historicalSummary({ status: "empty" }))),
    captureGraceTimers: true,
  });
  try {
    harness.setVisibility("visible");
    const shadow = await harness.loadRoute();
    harness.fireGraceTimers();
    await settleOwnRead();
    assert.equal(harness.ownReadRequests().length, 0, "no own read of an unsaved chat");
    assert.ok(!harness.calls.some((call: any) => call?.target === "chatgpt-read-progress"));
    assert.equal(shadow.querySelector("[data-metrics]")!.textContent, "No figures yet");
    // Nothing to act on: no reload loop, the status is listed in Details only.
    assert.equal(barState(shadow), "");
    assert.match(detailsOnly(shadow), /Earlier messages not saved/);
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    const details = shadow.querySelector("[data-body]")!.textContent!;
    assert.match(details, /Not everything could be counted/);
    assert.match(details, notSavedText);
    assert.doesNotMatch(details, /History not loaded|Earlier messages not loaded|Earlier messages not read/);
    const buttons = [...shadow.querySelectorAll<HTMLElement>(".panel button")].map(
      (button) => button.textContent,
    );
    assert.ok(!buttons.includes("Reload page"), "reloading would open an empty chat");
  } finally {
    harness.close();
  }
});

test("conductor: a signed-out ChatGPT chat counted only from a later message lists the unsaved earlier messages in Details", async () => {
  const harness = await contentHarness(false, {
    url: `https://chatgpt.com/uc/${UNSAVED_CHAT}`,
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    respondCapture: () => ({ ok: true }),
  });
  try {
    await harness.loadRoute();
    // A follow-up sent after tracking started names the chat; its start was not seen here.
    const shadow = harness.render(null, { requestCount: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(shadow.querySelector("[data-metrics]")!.textContent!, /^Req 1 · /);
    assert.match(detailsOnly(shadow), /Earlier messages not saved/);
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    assert.match(shadow.querySelector("[data-body]")!.textContent!, notSavedText);
  } finally {
    harness.close();
  }
});

test("conductor: a partly loaded ChatGPT chat gets one own read after the page's import", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000542";
  const chatgpt = await contentHarness(false, {
    url: `https://chatgpt.com/c/${conversationId}`,
    respond: () =>
      historicalRouteDisplay(
        historicalView(historicalSummary({ first_request_verified: false })),
      ),
    captureGraceTimers: true,
  });
  try {
    chatgpt.setVisibility("visible");
    const shadow = await chatgpt.loadRoute();
    assert.match(shadow.querySelector("[data-metrics]")!.textContent!, /^Req \d/);
    await settleOwnRead();
    assert.equal(chatgpt.ownReadRequests().length, 0, "no read during the grace period");
    chatgpt.fireGraceTimers();
    await settleOwnRead();
    const requests = chatgpt.ownReadRequests();
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0]!.message, {
      channel: ownReadModule.OWN_READ_CHANNEL,
      site: "chatgpt",
      conversationId,
    });
    requests[0]!.ports[0]!.postMessage({ outcome: { kind: "read_partly" } });
    for (let i = 0; i < 40 && !/page limit/.test(shadow.querySelector("[data-body]")!.textContent!); i++)
      await settleOwnRead(1);
    assert.match(shadow.querySelector("[data-body]")!.textContent!, /stopped at its page limit/);
    chatgpt.fireGraceTimers();
    await settleOwnRead();
    assert.equal(chatgpt.ownReadRequests().length, 1, "one read per navigation");
  } finally {
    chatgpt.close();
  }
});

// "Load full chat history automatically" (owner decision of 17 Oct 2026): with the site's switch
// off nothing is requested, Details says what works instead and offers to turn it on, and
// turning it on reads the chat without a reload.
const statusRows = (shadow: ParentNode) =>
  [...shadow.querySelectorAll<HTMLElement>("[data-body] .dt-status")].map((row) => ({
    text: row.textContent!,
    buttons: [...row.querySelectorAll("button")].map((button) => button.textContent!),
    row,
  }));

test("conductor: with Load full chat history off for Claude nothing is read, Details offers Reload page and the switch, and turning it on reads", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000591";
  let on = false;
  const { harness } = await claudeOwnReadHarness(conversationId, "visible", undefined, () => ({ on }));
  try {
    const shadow = await harness.loadRoute();
    harness.fireGraceTimers();
    await settleOwnRead(5);
    assert.equal(harness.ownReadRequests().length, 0, "nothing is asked of claude.ai");
    assert.ok(
      harness.calls.some((m: any) => m?.target === "own-read-setting" && m.key === "claude"),
      "the switch was asked for",
    );
    assert.equal(shadow.querySelector("[data-metrics]")!.textContent, bar.BAR_NO_FIGURES);
    assert.equal(barState(shadow), "History not loaded (reload page)", "nothing new on the bar");
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    const rows = statusRows(shadow);
    const reload = rows.find((row) => /Earlier messages not loaded/.test(row.text))!;
    assert.deepEqual(reload.buttons, ["Reload page"]);
    const off = rows.find((row) => /Full chat history is not loaded automatically/.test(row.text))!;
    assert.match(off.text, /did not ask Claude for this chat's missing messages/);
    assert.deepEqual(off.buttons, ["Turn on Load full chat history for Claude"], "one Reload page button only");
    off.row.querySelector("button")!.click();
    await settleOwnRead();
    assert.ok(harness.calls.some((m: any) => m?.target === "open-settings" && Object.keys(m).length === 1));
    // The person turns it on in Settings; the background tells the tab.
    on = true;
    harness.deliver({ target: "footprint-own-read-setting" }, { id: "content-test-extension" });
    for (let i = 0; i < 40 && harness.ownReadRequests().length === 0; i++) await settleOwnRead(1);
    assert.equal(harness.ownReadRequests().length, 1, "read once the switch is on, without a reload");
    assert.equal((harness.ownReadRequests()[0]!.message as any).conversationId, conversationId);
  } finally {
    harness.close();
  }
});

test("conductor: turning Load full chat history off stops a running own read", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000592";
  let on = true;
  const { harness } = await claudeOwnReadHarness(conversationId, "visible", undefined, () => ({ on }));
  try {
    const shadow = await harness.loadRoute();
    harness.fireGraceTimers();
    await settleOwnRead(5);
    const [request] = harness.ownReadRequests();
    assert.ok(request);
    const received: unknown[] = [];
    request.ports[0]!.onmessage = (event: MessageEvent) => received.push(event.data);
    on = false;
    harness.deliver({ target: "footprint-own-read-setting" }, { id: "content-test-extension" });
    for (let i = 0; i < 40 && !received.length; i++) await settleOwnRead(1);
    assert.deepEqual(received, [{ cancel: true }], "the page world stops and requests nothing more");
    // A notice from anyone but this extension is ignored.
    harness.deliver({ target: "footprint-own-read-setting" }, { id: "another-extension" });
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    assert.ok(statusRows(shadow).some((row) => /Full chat history is not loaded automatically/.test(row.text)));
  } finally {
    harness.close();
  }
});

test("conductor: a long ChatGPT chat with Load full chat history off says to scroll to the first message", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000593";
  const chatgpt = await contentHarness(false, {
    url: `https://chatgpt.com/c/${conversationId}`,
    respond: () =>
      historicalRouteDisplay(historicalView(historicalSummary({ first_request_verified: false }))),
    respondOwnReadSetting: (message) => ({ on: message.key !== "chatgpt" }),
    captureGraceTimers: true,
  });
  try {
    chatgpt.setVisibility("visible");
    const shadow = await chatgpt.loadRoute();
    chatgpt.fireGraceTimers();
    await settleOwnRead(5);
    assert.equal(chatgpt.ownReadRequests().length, 0);
    assert.match(shadow.querySelector("[data-metrics]")!.textContent!, /^Req \d/, "the figures stay");
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    const off = statusRows(shadow).find((row) => /Full chat history is not loaded automatically/.test(row.text))!;
    assert.match(off.text, /Scroll to the first message to count it\./);
    assert.deepEqual(off.buttons, ["Turn on Load full chat history for ChatGPT"]);
    assert.match(shadow.querySelector("[data-body]")!.textContent!, /Some earlier messages missing/);
  } finally {
    chatgpt.close();
  }
});

// Live QA of 19 Oct 2026: with the main switch off, Details offered the ChatGPT switch, which
// was already ticked and could not be changed. It now names the main switch.
test("conductor: with the main Load full chat history switch off, Details points to the main switch", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000595";
  const chatgpt = await contentHarness(false, {
    url: `https://chatgpt.com/c/${conversationId}`,
    respond: () =>
      historicalRouteDisplay(historicalView(historicalSummary({ first_request_verified: false }))),
    respondOwnReadSetting: () => ({ on: false, cause: "main" }),
    captureGraceTimers: true,
  });
  try {
    chatgpt.setVisibility("visible");
    const shadow = await chatgpt.loadRoute();
    chatgpt.fireGraceTimers();
    await settleOwnRead(5);
    assert.equal(chatgpt.ownReadRequests().length, 0);
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    const off = statusRows(shadow).find((row) => /Full chat history is not loaded automatically/.test(row.text))!;
    assert.match(off.text, /Load full chat history automatically is off for every site/);
    assert.doesNotMatch(off.text, /off for ChatGPT/);
    assert.deepEqual(off.buttons, ["Turn on Load full chat history automatically"]);
  } finally {
    chatgpt.close();
  }
});

// Until 17 Oct 2026 Perplexity sent a thread's messages only when the thread was opened inside
// the page. Since 19 Oct 2026 a full page load sends them too, so Details says a reload usually
// counts them; the entry stays a note without a Reload page button.
for (const [label, setting, outcome] of [
  ["Load full chat history off", false, null],
  ["the own read refused", true, { kind: "http", status: 403, shouldRetry: true }],
] as const)
  test(`conductor: a Perplexity thread without its messages (${label}) offers no Reload page button`, async () => {
    const threadId = "00000000-0000-4000-8000-000000000594";
    const harness = await contentHarness(false, {
      url: `https://www.perplexity.ai/search/${threadId}`,
      respond: () =>
        historicalRouteDisplay(historicalView(historicalSummary({ status: "empty" }))),
      respondOwnReadSetting: () => ({ on: setting }),
      captureGraceTimers: true,
    });
    try {
      harness.setVisibility("visible");
      const shadow = await harness.loadRoute();
      harness.fireGraceTimers();
      await settleOwnRead(5);
      if (outcome) {
        const [request] = harness.ownReadRequests();
        assert.ok(request);
        request.ports[0]!.postMessage({ outcome });
        for (let i = 0; i < 40 && !shadow.querySelector("[data-metrics]")!.textContent!.includes(bar.BAR_NO_FIGURES); i++)
          await settleOwnRead(1);
      } else assert.equal(harness.ownReadRequests().length, 0);
      assert.equal(shadow.querySelector("[data-metrics]")!.textContent, bar.BAR_NO_FIGURES);
      assert.doesNotMatch(barState(shadow), /reload page/);
      (shadow.querySelector("[data-open]") as HTMLElement).click();
      const body = shadow.querySelector("[data-body]")!;
      const buttons = [...body.querySelectorAll("button")].map((button) => button.textContent);
      assert.ok(!buttons.includes("Reload page"), "no Reload page button");
      assert.doesNotMatch(body.textContent!, /Reload the page to count/);
      assert.match(body.textContent!, /reloading the page usually counts them/);
      assert.doesNotMatch(body.textContent!, /Library/);
      assert.equal(
        buttons.includes("Turn on Load full chat history for Perplexity"),
        !setting,
        "the switch is offered only when it is the reason",
      );
    } finally {
      harness.close();
    }
  });

// A long ChatGPT chat is read over several openings (14 Oct 2026): the own read continues
// below the oldest page an earlier one read, and each page it reports is kept.
test("conductor: a partly loaded ChatGPT chat's own read continues from the kept progress and keeps how far it got", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000543";
  const day = Math.floor(Date.now() / 86_400_000);
  const kept = {
    before: "00000000-0000-4000-8000-000000000990",
    top: 1_700_000_000,
    day,
    pages: 30,
  };
  const progressCalls: any[] = [];
  const chatgpt = await contentHarness(false, {
    url: `https://chatgpt.com/c/${conversationId}`,
    respond: () =>
      historicalRouteDisplay(
        historicalView(historicalSummary({ first_request_verified: false })),
      ),
    respondProgress: (message) => {
      progressCalls.push(JSON.parse(JSON.stringify(message)));
      return message.progress ?? kept;
    },
    captureGraceTimers: true,
  });
  try {
    chatgpt.setVisibility("visible");
    await chatgpt.loadRoute();
    chatgpt.fireGraceTimers();
    await settleOwnRead();
    assert.deepEqual(progressCalls, [
      { target: "chatgpt-read-progress", conversationId },
    ]);
    const requests = chatgpt.ownReadRequests();
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0]!.message, {
      channel: ownReadModule.OWN_READ_CHANNEL,
      site: "chatgpt",
      conversationId,
      resume: { before: kept.before, top: kept.top, budget: 170 },
    });
    const port = requests[0]!.ports[0]!;
    port.postMessage({ resume: { before: "not-a-point", top: null, pages: 1 } });
    port.postMessage({
      resume: {
        before: "00000000-0000-4000-8000-000000000991",
        top: 1_700_000_500,
        pages: 4,
      },
    });
    for (let i = 0; i < 40 && progressCalls.length < 2; i++) await settleOwnRead(1);
    assert.deepEqual(progressCalls.slice(1), [
      {
        target: "chatgpt-read-progress",
        conversationId,
        progress: {
          before: "00000000-0000-4000-8000-000000000991",
          top: 1_700_000_500,
          day,
          pages: 34,
        },
      },
    ]);
  } finally {
    chatgpt.close();
  }
});

test("conductor: a reopened notebook gets one own read of its saved chat, and a failed one names its reason in Details", async () => {
  const notebook = "f0000000-0000-4000-8000-0000000000a1";
  const harness = await contentHarness(false, {
    url: `https://notebook.google.com/notebook/${notebook}?authuser=3`,
    html: '<main><div data-test-composer-bounds><div><textarea class="query-box-input" aria-label="Query box"></textarea></div><button type="button" aria-label="Submit">Send</button></div></main>',
    respond: () =>
      historicalRouteDisplay(
        historicalView(
          historicalSummary({
            branch_scope: "loaded_messages",
            unresolved_overlap_message_count: "0",
          }),
        ),
      ),
    captureGraceTimers: true,
  });
  try {
    harness.setVisibility("visible");
    const shadow = await harness.loadRoute();
    await settleOwnRead();
    assert.equal(harness.ownReadRequests().length, 0, "no read during the grace period");
    harness.fireGraceTimers();
    await settleOwnRead();
    const requests = harness.ownReadRequests();
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0]!.message, {
      channel: ownReadModule.OWN_READ_CHANNEL,
      site: "notebooklm",
      conversationId: notebook,
    });
    requests[0]!.ports[0]!.postMessage({ outcome: { kind: "no_request" } });
    const details = () => shadow.querySelector("[data-body]")!.textContent!;
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    for (let i = 0; i < 40 && !/no request to copy/.test(details()); i++)
      await settleOwnRead(1);
    assert.match(details(), /NotebookLM had not read a saved chat in this tab yet/);
    assert.match(shadow.querySelector("[data-metrics]")!.textContent!, /Req 2/);
    harness.fireGraceTimers();
    await settleOwnRead();
    assert.equal(harness.ownReadRequests().length, 1, "one read per navigation");
  } finally {
    harness.close();
  }
});

for (const [label, summary] of [
  ["the page never read", { status: "empty" }],
  ["whose start the page's reads did not show", { first_request_verified: false }],
] as const)
  test(`conductor: a Cowork session ${label} gets one own read`, async () => {
    const session = "cse_0123456789abcdefABCDEF01";
    const cowork = await contentHarness(false, {
      url: `https://claude.ai/cowork/${session}`,
      html: '<main><form><div class="ProseMirror" contenteditable="true" role="textbox"></div></form></main>',
      respond: () =>
        historicalRouteDisplay(historicalView(historicalSummary(summary))),
      captureGraceTimers: true,
    });
    try {
      cowork.setVisibility("visible");
      await cowork.loadRoute();
      await settleOwnRead();
      assert.equal(cowork.ownReadRequests().length, 0, "no read during the grace period");
      cowork.fireGraceTimers();
      await settleOwnRead();
      const requests = cowork.ownReadRequests();
      assert.equal(requests.length, 1);
      assert.deepEqual(requests[0]!.message, {
        channel: ownReadModule.OWN_READ_CHANNEL,
        site: "claude",
        conversationId: session,
      });
    } finally {
      cowork.close();
    }
  });

test("conductor: a partly loaded Claude chat makes no own read", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000551";
  const partly = await contentHarness(false, {
    url: `https://claude.ai/chat/${conversationId}`,
    html: '<main><form><div class="ProseMirror" contenteditable="true" role="textbox"></div></form></main>',
    respond: () =>
      historicalRouteDisplay(
        historicalView(historicalSummary({ first_request_verified: false })),
      ),
    captureGraceTimers: true,
  });
  try {
    partly.setVisibility("visible");
    await partly.loadRoute();
    partly.fireGraceTimers();
    await settleOwnRead();
    assert.equal(partly.ownReadRequests().length, 0);
  } finally {
    partly.close();
  }
});

test("conductor: a running import keeps the loading label past the grace period until its figures arrive", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000302";
  let current = historicalView(historicalSummary({ status: "empty" }));
  const page = deferred<unknown>();
  const harness = await contentHarness(false, {
    url: `https://chatgpt.com/c/${conversationId}`,
    respond: () => historicalRouteDisplay(current),
    respondHistory: (message) =>
      message.message.event === "page" ? page.promise : { accepted: true },
    captureGraceTimers: true,
  });
  try {
    const shadow = await harness.loadRoute();
    const metrics = () => shadow.querySelector("[data-metrics]")!.textContent!;
    const messages = historicalMessages(
      conversationId,
      "00000000-0000-4000-8000-000000000312",
      { first: true, suffix: "321" },
    );
    harness.postHistorical(messages.start);
    harness.postHistorical(messages.page);
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.fireGraceTimers();
    // The import is still running past the grace period: Processing, then the figures.
    assert.equal(metrics(), bar.BAR_PROCESSING);
    current = historicalView(
      historicalSummary({ first_request_verified: true }),
    );
    page.resolve({ accepted: true });
    for (let i = 0; i < 20 && !/Req 2/.test(metrics()); i++)
      await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(metrics(), /Req 2 · In\/Out tokens/);
    assert.doesNotMatch(
      barState(shadow),
      /History not loaded|Partially loaded/,
    );
  } finally {
    harness.close();
  }
});

test("conductor: history waiting for recalculation shows a calculating state and refreshes when the result publishes", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000303";
  let pending = true;
  let routeCalls = 0;
  const harness = await contentHarness(false, {
    url: `https://chatgpt.com/c/${conversationId}`,
    respond: () => {
      routeCalls++;
      return {
        ...historicalRouteDisplay(
          historicalView(
            pending
              ? historicalSummary({ status: "unavailable", resources: [] })
              : historicalSummary({ first_request_verified: true }),
          ),
        ),
        calculationPending: pending,
      };
    },
  });
  try {
    const shadow = await harness.loadRoute();
    const metrics = () => shadow.querySelector("[data-metrics]")!.textContent!;
    const status = () => barState(shadow);
    assert.equal(metrics(), bar.BAR_PROCESSING);
    assert.equal(status(), "Calculating earlier messages");
    assert.equal(
      shadow.querySelector("[data-progress-line]")!.textContent,
      "Calculating earlier messages",
    );
    assert.doesNotMatch(status(), /Earlier activity unavailable/);
    pending = false;
    const before = routeCalls;
    harness.deliver(
      { target: "footprint-calculation-updated" },
      { id: "content-test-extension" },
    );
    for (let i = 0; i < 20 && !/Req 2/.test(metrics()); i++)
      await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(routeCalls, before + 1);
    assert.match(metrics(), /Req 2 · In\/Out tokens/);
    // A settled display ignores later notices, so other open tabs do no extra reads.
    harness.deliver(
      { target: "footprint-calculation-updated" },
      { id: "content-test-extension" },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(routeCalls, before + 1);
  } finally {
    harness.close();
  }
});

test("conductor: unavailable history without a pending calculation still reports Earlier activity unavailable", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000304";
  const harness = await contentHarness(false, {
    url: `https://chatgpt.com/c/${conversationId}`,
    respond: () => ({
      ...historicalRouteDisplay(
        historicalView(
          historicalSummary({ status: "unavailable", resources: [] }),
        ),
      ),
      calculationPending: false,
    }),
  });
  try {
    const shadow = await harness.loadRoute();
    // Reported in Details only: the person cannot act on it (owner, 13 Oct 2026).
    assert.equal(barState(shadow), "");
    assert.match(detailsOnly(shadow), /Earlier activity unavailable/);
  } finally {
    harness.close();
  }
});

test("conductor: organization mode keeps a locally imported chat's figures while the server has no history for it", async () => {
  // Live, 13 Oct 2026: after connecting, an imported chat showed "Your synced conversation ·
  // Req 0" and Unknown figures from the server's empty copy until the upload landed.
  const conversationId = "00000000-0000-4000-8000-000000000311";
  const none = {
    status: "empty",
    observed_prompt_count: "0",
    observed_response_count: "0",
    prompt_count: "0",
    response_count: "0",
    dated_message_count: "0",
    undated_message_count: "0",
    calculated_message_count: "0",
    uncalculated_message_count: "0",
    unresolved_overlap_message_count: "0",
    file_text: [],
    tokens: [],
    resources: [],
  };
  const harness = await contentHarness(false, {
    url: `https://chatgpt.com/c/${conversationId}`,
    respond: () => ({
      ...historicalRouteDisplay(
        historicalView(historicalSummary({ first_request_verified: true }), {
          server: historicalSummary(none),
          server_status: "current",
          models: ["chatgpt-gpt-5-6-sol"],
        }),
      ),
      mode: "company",
      conversation: {
        source: "server",
        server: {
          request_count: "0",
          generated_at: "2026-10-13T20:58:00.000Z",
          tokens: [],
          resources: [],
        },
        pending: null,
        pendingObservationCount: 0,
        cachedAt: null,
        offline: false,
      },
      queueCount: 4,
    }),
  });
  try {
    const shadow = await harness.loadRoute();
    const metrics = shadow.querySelector("[data-metrics]")!.textContent!;
    assert.match(metrics, /^Req 2 · In\/Out tokens - ≈ 17\//);
    assert.doesNotMatch(metrics, /synced|snapshot|Unknown · Carbon Unknown/i);
    assert.equal(barState(shadow), "");
    assert.equal(detailsOnly(shadow), "");
    // The imported history waits to upload: Details shows Syncing as a small icon.
    assert.equal(
      shadow.querySelector<HTMLElement>("[data-sync-row] .dt-sync")!.dataset.sync,
      "syncing",
    );
    // Details names the model saved history recorded, not "Model not named".
    assert.match(shadow.querySelector("[data-sub]")!.textContent!, /GPT-5\.6/);
    const estimated = shadow.querySelector('[data-section="estimated"]')!;
    assert.doesNotMatch(estimated.textContent!, /Model not named/);
    assert.match(estimated.textContent!, /GPT-5\.6/);
  } finally {
    harness.close();
  }
});

test("conductor: a tracking problem the person cannot fix is explained in Details, not on the bar", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000312";
  const harness = await contentHarness(false, {
    url: `https://chatgpt.com/c/${conversationId}`,
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    respondCapture: () => ({ ok: false, code: "ledger_integrity_failed" }),
  });
  try {
    const shadow = harness.render(null, { requestCount: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    const label = shadow.querySelector<HTMLElement>("[data-status]")!;
    // Its only advice is to check tracking health, which is not a fix (owner, 13 Oct 2026).
    assert.equal(label.textContent, "");
    assert.match(detailsOnly(shadow), /Tracking problem/);
    assert.doesNotMatch(
      shadow.querySelector("[data-metrics]")!.textContent!,
      /Page tracking issues/,
    );
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    const section = shadow.querySelector<HTMLElement>(
      '[data-section="not-counted"]',
    )!;
    assert.match(section.textContent!, /Not everything could be counted/);
    assert.match(section.textContent!, /Reply not counted/);
    assert.equal(section.querySelector(".dt-reload"), null);
    assert.match(
      shadow.querySelector("[data-body]")!.textContent!,
      /Page tracking health/,
    );
  } finally {
    harness.close();
  }
});

function activeDisplay(
  binding: any,
  conversationId: string,
  options: {
    requests: number;
    history?: any;
    calculationPending?: boolean;
    state?: string;
    recordedThread?: any;
  },
) {
  return {
    target: "footprint-display",
    displayBinding: binding,
    conversationIdentity: { site: "chatgpt", conversationId },
    mode: "company",
    state: options.state ?? "completed",
    summary: {
      ...new SummaryAccumulator().result(),
      requests: options.requests,
    },
    conversation: null,
    recordedThread: options.recordedThread ?? null,
    history: options.history,
    ...(options.calculationPending !== undefined
      ? { calculationPending: options.calculationPending }
      : {}),
    queueCount: 0,
    activeContext: null,
    budget: null,
    budgetBasis: null,
    guidance: { show: false, ratio: null, state: { level: 0 }, key: null },
  };
}

test("conductor: a display waiting for recalculation keeps the previous whole-chat figures with Updating until settled figures arrive", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000401";
  const harness = await contentHarness(false, {
    url: `https://chatgpt.com/c/${conversationId}`,
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    captureGraceTimers: true,
  });
  try {
    const ready = historicalView(historicalSummary());
    const waiting = historicalView(
      historicalSummary({ status: "unavailable", resources: [] }),
    );
    const shadow = harness.render(null, {
      requestCount: 1,
      history: ready,
      calculationPending: false,
    });
    const metrics = () => shadow.querySelector("[data-metrics]")!.textContent!;
    // Updating is explained in Details only (owner, 13 Oct 2026); status() reads the bar
    // label and the statuses it keeps for Details.
    const label = shadow.querySelector<HTMLElement>("[data-status]")!;
    const status = () => bar.detailsStatusText(label);
    const details = () => shadow.querySelector("[data-body]")!.textContent!;
    const before = metrics();
    assert.match(before, /^Req /);
    const binding = harness.currentCaptureBinding();
    harness.deliver(
      activeDisplay(binding, conversationId, {
        requests: 2,
        history: waiting,
        calculationPending: true,
      }),
    );
    assert.equal(metrics(), before, "the complete figures stay on screen");
    assert.match(status(), /Updating/);
    assert.doesNotMatch(label.textContent!, /Updating/);
    assert.doesNotMatch(status(), /Earlier activity unavailable|Partly measured|Tracking problem/);
    assert.match(details(), /A newer observation is being calculated/);
    harness.deliver(
      activeDisplay(binding, conversationId, {
        requests: 2,
        history: ready,
        calculationPending: false,
      }),
    );
    assert.notEqual(metrics(), before);
    assert.doesNotMatch(status(), /Updating/);
    assert.doesNotMatch(details(), /A newer observation is being calculated/);
    // The released hold timer never applies an older display later.
    harness.fireGraceTimers();
    assert.doesNotMatch(status(), /Updating/);
  } finally {
    harness.close();
  }
});

test("conductor: a held display applies after its time limit with Updating instead of an error", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000402";
  const harness = await contentHarness(false, {
    url: `https://chatgpt.com/c/${conversationId}`,
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    captureGraceTimers: true,
  });
  try {
    const shadow = harness.render(null, {
      requestCount: 1,
      history: historicalView(historicalSummary()),
      calculationPending: false,
    });
    const metrics = () => shadow.querySelector("[data-metrics]")!.textContent!;
    // Updating is explained in Details only (owner, 13 Oct 2026).
    const status = () =>
      bar.detailsStatusText(shadow.querySelector<HTMLElement>("[data-status]")!);
    const binding = harness.currentCaptureBinding();
    harness.deliver(
      activeDisplay(binding, conversationId, {
        requests: 3,
        history: historicalView(
          historicalSummary({ status: "unavailable", resources: [] }),
        ),
        calculationPending: true,
      }),
    );
    assert.doesNotMatch(metrics(), /Req 3/);
    harness.fireGraceTimers();
    assert.match(metrics(), /Req 3/);
    assert.match(status(), /Updating/);
    assert.doesNotMatch(status(), /Earlier activity unavailable|Partly measured/);
  } finally {
    harness.close();
  }
});

test("conductor: a held display is dropped on navigation and never applied to the next chat", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000403";
  const next = "00000000-0000-4000-8000-000000000404";
  const harness = await contentHarness(false, {
    url: `https://chatgpt.com/c/${conversationId}`,
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    captureGraceTimers: true,
  });
  try {
    const shadow = harness.render(null, {
      requestCount: 1,
      history: historicalView(historicalSummary()),
      calculationPending: false,
    });
    const binding = harness.currentCaptureBinding();
    harness.deliver(
      activeDisplay(binding, conversationId, {
        requests: 5,
        history: historicalView(
          historicalSummary({ status: "unavailable", resources: [] }),
        ),
        calculationPending: true,
      }),
    );
    await harness.navigate(`/c/${next}`);
    harness.fireGraceTimers();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.doesNotMatch(shadow.querySelector("[data-metrics]")!.textContent!, /Req 5/);
    assert.doesNotMatch(barState(shadow), /Updating/);
  } finally {
    harness.close();
  }
});

test("conductor: a first display waiting for recalculation reads Updating, not Partly measured", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000405";
  const harness = await contentHarness(false, {
    url: `https://chatgpt.com/c/${conversationId}`,
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
  });
  try {
    const shadow = harness.render(null, {
      requestCount: 1,
      history: historicalView(
        historicalSummary({ status: "unavailable", resources: [] }),
      ),
      calculationPending: true,
    });
    // Updating is explained in Details only (owner, 13 Oct 2026).
    const label = shadow.querySelector<HTMLElement>("[data-status]")!;
    assert.equal(label.textContent, "");
    const status = bar.detailsStatusText(label);
    assert.match(status, /Updating/);
    assert.doesNotMatch(status, /Partly measured|Earlier activity unavailable/);
    assert.equal(status.split("Updating").length, 2, "Updating appears once");
  } finally {
    harness.close();
  }
});

test("conductor: recorded-thread displays are never held", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000406";
  const harness = await contentHarness(false, {
    url: `https://chatgpt.com/c/${conversationId}`,
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    captureGraceTimers: true,
  });
  try {
    const shadow = harness.render(null, {
      requestCount: 1,
      history: historicalView(historicalSummary()),
      calculationPending: false,
      recordedThread: { status: "matched_recorded_subset" },
    });
    harness.deliver(
      activeDisplay(harness.currentCaptureBinding(), conversationId, {
        requests: 4,
        history: historicalView(
          historicalSummary({ status: "unavailable", resources: [] }),
        ),
        calculationPending: true,
        recordedThread: { status: "matched_recorded_subset" },
      }),
    );
    assert.match(shadow.querySelector("[data-metrics]")!.textContent!, /4/);
  } finally {
    harness.close();
  }
});

test("conductor: an import finishing during the first saved-totals read shows that read, then refreshes once", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000407";
  const first = deferred<unknown>();
  let routeCalls = 0;
  const harness = await contentHarness(false, {
    url: `https://chatgpt.com/c/${conversationId}`,
    respond: () => {
      routeCalls++;
      if (routeCalls === 1) return first.promise;
      return historicalRouteDisplay(
        historicalView(historicalSummary({ prompt_count: "3" })),
      );
    },
  });
  try {
    const shadow = await harness.loadRoute();
    assert.equal(routeCalls, 1);
    const messages = historicalMessages(conversationId, crypto.randomUUID());
    harness.postHistorical(messages.start);
    harness.postHistorical(messages.page);
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(routeCalls, 1, "the running read is kept, not replaced");
    first.resolve(historicalRouteDisplay(historicalView(historicalSummary())));
    for (let i = 0; i < 20 && routeCalls < 2; i++)
      await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(routeCalls, 2, "exactly one refresh follows");
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(routeCalls, 2);
    assert.match(shadow.querySelector("[data-metrics]")!.textContent!, /Req 0|In\/Out/);
    assert.doesNotMatch(
      barState(shadow),
      /Tracking problem|totals unavailable/,
    );
  } finally {
    harness.close();
  }
});

test("conductor: a superseded capture reply does not clear a current capture problem", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000408";
  const replies: Array<() => unknown> = [
    () => {
      throw new Error("worker unavailable");
    },
    () => ({ ok: true, superseded: true }),
    () => ({ ok: true }),
  ];
  const harness = await contentHarness(false, {
    url: `https://chatgpt.com/c/${conversationId}`,
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    respondCapture: () => (replies.shift() ?? (() => ({ ok: true })))(),
  });
  try {
    const shadow = harness.render(null, { requestCount: 1 });
    const details = () => shadow.querySelector("[data-body]")!.textContent!;
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.render(null, { requestCount: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(details(), /1 current tracking problem/);
    harness.render(null, { requestCount: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.doesNotMatch(details(), /current tracking problem/);
  } finally {
    harness.close();
  }
});

test("conductor: a stale display notice is shown until the next display clears it", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000409";
  const harness = await contentHarness(false, {
    url: `https://chatgpt.com/c/${conversationId}`,
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
  });
  try {
    const shadow = harness.render(null, { requestCount: 1 });
    const status = () => barState(shadow);
    const binding = harness.currentCaptureBinding();
    harness.deliver(
      { target: "footprint-display-stale", displayBinding: binding, conversationIdentity: null },
      { id: "another-extension" },
    );
    assert.doesNotMatch(status(), /Tracking problem/, "only this extension may send it");
    harness.deliver(
      { target: "footprint-display-stale", displayBinding: { ...binding, captureId: crypto.randomUUID() }, conversationIdentity: null },
      { id: "content-test-extension" },
    );
    assert.doesNotMatch(status(), /Tracking problem/, "only for the shown capture");
    harness.deliver(
      { target: "footprint-display-stale", displayBinding: binding, conversationIdentity: null },
      { id: "content-test-extension" },
    );
    assert.match(status(), /Tracking problem/);
    harness.deliver(
      activeDisplay(binding, conversationId, { requests: 1, calculationPending: false }),
    );
    assert.doesNotMatch(status(), /Tracking problem/);
  } finally {
    harness.close();
  }
});

test("W9 conductor: an empty or Studio-only NotebookLM notebook shows no earlier-history or partial-load states", async () => {
  const url =
    "https://notebook.google.com/notebook/f0000000-0000-4000-8000-0000000000a1?authuser=3";
  const html =
    '<main><div data-test-composer-bounds><div><textarea class="query-box-input" aria-label="Query box"></textarea></div><button type="button" aria-label="Submit">Send</button></div></main>';
  // No chat and no Studio item: a notebook may be empty, so an empty notebook is not
  // reported as history the page did not load.
  const empty = await contentHarness(false, {
    url,
    html,
    respond: () =>
      historicalRouteDisplay(
        historicalView(historicalSummary({ status: "empty" })),
      ),
    captureGraceTimers: true,
  });
  try {
    const shadow = await empty.loadRoute();
    empty.fireGraceTimers();
    const shown = () =>
      shadow.querySelector("[data-metrics]")!.textContent! +
      " " +
      barState(shadow);
    assert.doesNotMatch(
      shown(),
      /Earlier messages not counted|History not loaded|Loading earlier messages|Partially loaded/,
    );
    // An empty notebook has nothing to count yet, never "Req 0" (owner, 14 Oct 2026,
    // afternoon), also while the tracker checks whether it has a saved chat.
    assert.equal(
      shadow.querySelector("[data-metrics]")!.textContent!,
      bar.BAR_WAITING,
    );
  } finally {
    empty.close();
  }
  // Studio items are not a paged chat: no partial-load hint and no first-message row.
  const studio = await contentHarness(false, {
    url,
    html,
    respond: () =>
      historicalRouteDisplay(
        historicalView(
          historicalSummary({
            branch_scope: "loaded_messages",
            unresolved_overlap_message_count: "0",
          }),
        ),
      ),
  });
  try {
    const shadow = await studio.loadRoute();
    assert.match(shadow.querySelector("[data-metrics]")!.textContent!, /Req 2/);
    assert.doesNotMatch(
      barState(shadow),
      /Partially loaded/,
    );
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    const details = shadow.querySelector("[data-body]")!.textContent!;
    assert.doesNotMatch(details, /First message/);
    assert.match(details, /Each Studio item counts as a request/);
  } finally {
    studio.close();
  }
});

test("NB11 conductor: a notebook whose saved chat loaded shows its figures, and a missing start only in Details", async () => {
  const url =
    "https://notebook.google.com/notebook/f0000000-0000-4000-8000-0000000000a1?authuser=3";
  const html =
    '<main><div data-test-composer-bounds><div><textarea class="query-box-input" aria-label="Query box"></textarea></div><button type="button" aria-label="Submit">Send</button></div></main>';
  // Saved chat turns (14 Oct 2026) wait for a live match; two were sent elsewhere.
  const chat = (first: boolean) =>
    historicalRouteDisplay(
      historicalView(
        historicalSummary({
          branch_scope: "loaded_messages",
          matched_live_message_count: "0",
          unresolved_overlap_message_count: "4",
          first_request_verified: first,
        }),
      ),
    );
  const partial = await contentHarness(false, {
    url,
    html,
    respond: () => chat(false),
  });
  try {
    const shadow = await partial.loadRoute();
    assert.match(shadow.querySelector("[data-metrics]")!.textContent!, /^Req 2 · /);
    // Off ChatGPT, scrolling is not the fix shown on the bar: Details says it.
    assert.doesNotMatch(
      shadow.querySelector("[data-status]")!.textContent!,
      /Partially loaded/,
    );
    assert.match(detailsOnly(shadow), /Partially loaded/);
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    const details = shadow.querySelector("[data-body]")!.textContent!;
    assert.match(details, /First messageNot verified/);
    assert.match(details, /earlier chat not loaded/);
    assert.match(details, /when the notebook loads its saved chat/);
  } finally {
    partial.close();
  }
  const complete = await contentHarness(false, {
    url,
    html,
    respond: () => chat(true),
  });
  try {
    const shadow = await complete.loadRoute();
    assert.match(shadow.querySelector("[data-metrics]")!.textContent!, /^Req 2 · /);
    assert.doesNotMatch(detailsOnly(shadow), /Partially loaded/);
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    const details = shadow.querySelector("[data-body]")!.textContent!;
    assert.match(details, /First messageLoaded/);
    assert.doesNotMatch(details, /earlier chat not loaded/);
  } finally {
    complete.close();
  }
});

const NB_NOTEBOOK = "f0000000-0000-4000-8000-0000000000a1";
const NB_SESSION = "11111111-1111-4111-8111-111111111111";
const OTHER_NOTEBOOK = "f0000000-0000-4000-8000-0000000000b2";
const nbTurn = (n: number) =>
  `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** A page of a notebook's saved chat: one question and its answer, newest first. */
const NB_CHAT = [
  [
    [nbTurn(2), [1790876690, 0], 2, null, [["Answer."], null, null, [["One?"]]], 2],
    [nbTurn(1), [1790876680, 0], 1, "Question?", null, 2],
  ],
];

function notebookHarness() {
  return contentHarness(false, {
    url: `https://notebook.google.com/notebook/${NB_NOTEBOOK}?authuser=3`,
    html: '<main><div data-test-composer-bounds><div><textarea class="query-box-input" aria-label="Query box"></textarea></div><button type="button" aria-label="Submit">Send</button></div></main>',
    respond: () =>
      historicalRouteDisplay(
        historicalView(
          historicalSummary({
            branch_scope: "loaded_messages",
            unresolved_overlap_message_count: "0",
          }),
        ),
      ),
    captureGraceTimers: true,
  });
}

/**
 * A read of the notebook as the page world relays it, a Studio list or a page of its saved
 * chat: `start` sends its start and returns the steps that send its rows and its end.
 */
async function notebookRead(
  harness: Awaited<ReturnType<typeof contentHarness>>,
  value: unknown,
  rpc: "gArtLc" | "khqZz",
  notebook = NB_NOTEBOOK,
) {
  const common = {
    id: crypto.randomUUID(),
    site: "notebooklm" as const,
    conversationId: notebook,
    observedAt: new Date().toISOString(),
  };
  harness.postHistorical({
    ...common,
    channel: historyCapture.HISTORY_CAPTURE_CHANNEL,
    event: "start",
    page: null,
  });
  await settleOwnRead();
  const page = adapters.parseHistoryText(
    "notebooklm",
    rpc === "khqZz"
      ? { rpc, value, session: NB_SESSION, sessions: [NB_SESSION] }
      : { rpc, value },
    notebook,
    common.observedAt,
  );
  const post = async (event: "batch" | "finish") => {
    const channel = new MessageChannel();
    const reply = new Promise<any>((resolve) => {
      channel.port1.onmessage = (message) => resolve(message.data);
    });
    harness.postHistorical(
      {
        ...common,
        channel: providerHistoryMessage.PROVIDER_STREAM_CHANNEL,
        event,
        rows:
          event === "batch"
            ? page.messages.map((message) => ({
                message,
                requestRef: null,
                parentRef: null,
              }))
            : null,
        meta:
          event === "finish"
            ? {
                messageCount: page.messages.length,
                firstRequestVerified: page.firstRequestVerified,
                rootSourceId: page.rootSourceId,
                selectedLeafId: null,
                branchScope: "loaded_messages",
                hasEarlier: page.hasEarlier,
                hasLater: null,
              }
            : null,
      },
      [channel.port2],
    );
    const result = await reply;
    channel.port1.close();
    assert.deepEqual(result, { accepted: true });
    await settleOwnRead();
  };
  return {
    rows: async () => {
      if (page.messages.length) await post("batch");
    },
    finish: () => post("finish"),
  };
}

test("NotebookLM: a directly loaded notebook stays on Waiting for your request while its reads find nothing, and shows Processing once they find content (finding 6)", async () => {
  const totals = deferred<unknown>();
  const harness = await contentHarness(false, {
    url: `https://notebook.google.com/notebook/${NB_NOTEBOOK}?authuser=3`,
    html: '<main><div data-test-composer-bounds><div><textarea class="query-box-input" aria-label="Query box"></textarea></div><button type="button" aria-label="Submit">Send</button></div></main>',
    respond: () => totals.promise,
    captureGraceTimers: true,
  });
  try {
    const shadow = await harness.loadRoute();
    const metrics = () => shadow.querySelector("[data-metrics]")!.textContent!;
    // The saved-totals read is still running and the page reads the notebook.
    assert.equal(metrics(), bar.BAR_WAITING);
    const studio = await notebookRead(harness, [[]], "gArtLc");
    await settle();
    assert.equal(metrics(), bar.BAR_WAITING);
    await studio.rows();
    await settle();
    assert.equal(metrics(), bar.BAR_WAITING);
    // The notebook has a saved chat: its turns are counted, so the bar shows Processing.
    const chat = await notebookRead(harness, NB_CHAT, "khqZz");
    await chat.rows();
    assert.equal(metrics(), bar.BAR_PROCESSING);
    totals.resolve({ error: "Recorded conversation totals are unavailable." });
  } finally {
    harness.close();
  }
});

const NB_GUIDE_URL = `https://notebook.google.com/_/LabsTailwindUi/data/batchexecute?rpcids=VfAZjd&source-path=${encodeURIComponent(`/notebook/${NB_NOTEBOOK}`)}&authuser=3&rt=c`;

/** A notebook guide's capture frames as the page world relays them (W9). */
function guideFrames(id: string, summary = "Summary of the source.") {
  const frame = (event: "dispatch" | "end", revision: number, snapshot: any) => ({
    timing: null,
    channel: "ai-footprint-observation-v1",
    version: 1,
    id,
    revision,
    event,
    site: "notebooklm",
    at: new Date().toISOString(),
    dispatch:
      event === "dispatch"
        ? {
            action: "notebook_guide",
            attachments: 0,
            conversationId: NB_NOTEBOOK,
            imageEditParentId: null,
            input: "",
            model: null,
            parentId: null,
            requestId: adapters.parseDispatch("notebooklm", new URL(NB_GUIDE_URL), "")
              .requestId,
            site: "notebooklm",
            inputImages: [],
          }
        : null,
    snapshot,
    failure: null,
  });
  const session = new adapters.NotebooklmGuideSession(new URL(NB_GUIDE_URL));
  session.gemini([
    [
      "wrb.fr",
      "VfAZjd",
      JSON.stringify([
        summary ? [[summary], [[["Q?", "Prompt"]]]] : null,
        "e0000000-0000-4000-8000-0000000000c3",
      ]),
    ],
  ]);
  session.responseEnded();
  return {
    dispatch: frame("dispatch", 1, null),
    end: frame("end", 2, { ...session.snapshot(), conversationId: NB_NOTEBOOK }),
  };
}

/**
 * Saved totals of a notebook whose only counted work is its guide, as the coordinator returns
 * them (notebooklm.test.ts W9): no request, one attempt, the guide's text as output.
 */
function guideOnlyDisplay(overrides: Record<string, unknown> = {}) {
  const summary: any = new SummaryAccumulator().result();
  return {
    ...historicalRouteDisplay(null),
    state: "completed",
    summary: {
      ...summary,
      requests: 0,
      attempts: 1,
      tokens: {
        ...summary.tokens,
        output: { ...summary.tokens.output, value: "33" },
      },
    },
    ...overrides,
  };
}

test("NotebookLM: a notebook whose only counted work is its guide shows the guide's figures with Req 0, not Waiting for your request (owner, 16 Oct 2026)", async () => {
  const shownFor = async (url: string, display: unknown) => {
    const harness = await contentHarness(false, {
      url,
      html: url.includes("notebook.google.com")
        ? '<main><div data-test-composer-bounds><div><textarea class="query-box-input" aria-label="Query box"></textarea></div><button type="button" aria-label="Submit">Send</button></div></main>'
        : undefined,
      respond: () => display,
      captureGraceTimers: true,
    });
    try {
      const shadow = await harness.loadRoute();
      await settle();
      harness.fireGraceTimers();
      await settle();
      const metrics = shadow.querySelector("[data-metrics]")!.textContent!;
      (shadow.querySelector("[data-open]") as HTMLElement).click();
      return { metrics, details: shadow.querySelector(".panel")!.textContent! };
    } finally {
      harness.close();
    }
  };
  const notebook = `https://notebook.google.com/notebook/${NB_NOTEBOOK}?authuser=3`;
  // Req as the totals and Details count it: a guide is not a request.
  const guide = await shownFor(notebook, guideOnlyDisplay());
  assert.match(guide.metrics, /^Req 0 · In\/Out tokens - [^·]*\/≈ 33 · Electricity /);
  assert.doesNotMatch(guide.metrics, /Waiting|Processing|No figures yet/);
  assert.match(guide.details, /0 requests/);
  // A guide still being estimated shows Processing until its figures are calculated.
  const pending = await shownFor(notebook, guideOnlyDisplay({ calculationPending: true }));
  assert.equal(pending.metrics, bar.BAR_PROCESSING);
  // Nothing counted at all, or a guide that wrote nothing: still Waiting for your request.
  const empty = await shownFor(notebook, historicalRouteDisplay(null));
  assert.equal(empty.metrics, bar.BAR_WAITING);
  const blank = guideOnlyDisplay();
  blank.summary.tokens.output.value = "0";
  assert.equal((await shownFor(notebook, blank)).metrics, bar.BAR_WAITING);
  // Other sites are unchanged: work that is not a request shows no figures.
  const chatgpt = await shownFor(
    "https://chatgpt.com/c/00000000-0000-4000-8000-000000000c01",
    guideOnlyDisplay(),
  );
  assert.doesNotMatch(chatgpt.metrics, /^Req/);
});

test("NotebookLM: a guide written after a source is added shows Processing, then its figures, also when the notebook has no figures yet (owner, 16 Oct 2026)", async () => {
  for (const unread of [false, true]) {
    let display: unknown = historicalRouteDisplay(null);
    const harness = await contentHarness(false, {
      url: `https://notebook.google.com/notebook/${NB_NOTEBOOK}?authuser=3`,
      html: '<main><div data-test-composer-bounds><div><textarea class="query-box-input" aria-label="Query box"></textarea></div><button type="button" aria-label="Submit">Send</button></div></main>',
      respond: () => display,
      captureGraceTimers: true,
    });
    try {
      const shadow = await harness.loadRoute();
      const metrics = () => shadow.querySelector("[data-metrics]")!.textContent!;
      await settle();
      harness.fireGraceTimers();
      await settle();
      assert.equal(metrics(), bar.BAR_WAITING);
      if (unread) {
        // A read of the notebook that could not be counted: No figures yet until the guide.
        harness.postHistorical({
          channel: historyCapture.HISTORY_DIAGNOSTIC_CHANNEL,
          site: "notebooklm",
          conversationId: NB_NOTEBOOK,
          observedAt: new Date().toISOString(),
          id: null,
          reason: "history_limit",
        });
        await settle();
        assert.equal(metrics(), bar.BAR_NO_FIGURES);
      }
      const frames = guideFrames("00000000-0000-4000-8000-000000000c11");
      harness.postThreadHistory(frames.dispatch);
      await settle();
      assert.equal(metrics(), bar.BAR_PROCESSING, `guide written, unread=${unread}`);
      // The guide ended; its figures come with the saved totals read again for it.
      display = guideOnlyDisplay({ calculationPending: true });
      harness.postThreadHistory(frames.end);
      await settle();
      assert.equal(metrics(), bar.BAR_PROCESSING, `guide estimated, unread=${unread}`);
      display = guideOnlyDisplay();
      harness.deliver(
        { target: "footprint-calculation-updated" },
        { id: "content-test-extension" },
      );
      await settle();
      assert.match(metrics(), /^Req 0 · /, `guide figures, unread=${unread}`);
    } finally {
      harness.close();
    }
  }
});

test("NotebookLM: a guide that wrote nothing, as for a notebook without sources, leaves Waiting for your request", async () => {
  const harness = await contentHarness(false, {
    url: `https://notebook.google.com/notebook/${NB_NOTEBOOK}?authuser=3`,
    html: '<main><div data-test-composer-bounds><div><textarea class="query-box-input" aria-label="Query box"></textarea></div><button type="button" aria-label="Submit">Send</button></div></main>',
    respond: () => historicalRouteDisplay(null),
    captureGraceTimers: true,
  });
  try {
    const shadow = await harness.loadRoute();
    const metrics = () => shadow.querySelector("[data-metrics]")!.textContent!;
    await settle();
    harness.fireGraceTimers();
    await settle();
    const frames = guideFrames("00000000-0000-4000-8000-000000000c12", "");
    assert.equal(frames.end.snapshot.intermediate, "");
    harness.postThreadHistory(frames.dispatch);
    await settle();
    assert.equal(metrics(), bar.BAR_PROCESSING);
    harness.postThreadHistory(frames.end);
    await settle();
    assert.equal(metrics(), bar.BAR_WAITING);
  } finally {
    harness.close();
  }
});

test("NotebookLM: a read that finds both import slots taken waits for one instead of failing, as on the first load after the extension restarts (finding 7)", async () => {
  // A cold background takes long to accept the first read, which then holds its slot.
  const slowStart = deferred<unknown>();
  let starts = 0;
  const harness = await contentHarness(false, {
    url: `https://notebook.google.com/notebook/${NB_NOTEBOOK}?authuser=3`,
    html: '<main><div data-test-composer-bounds><div><textarea class="query-box-input" aria-label="Query box"></textarea></div><button type="button" aria-label="Submit">Send</button></div></main>',
    respond: () =>
      historicalRouteDisplay(
        historicalView(
          historicalSummary({
            branch_scope: "loaded_messages",
            unresolved_overlap_message_count: "0",
          }),
        ),
      ),
    respondHistory: (message) =>
      message.message.event === "start" && ++starts === 1
        ? slowStart.promise
        : { accepted: true },
    captureGraceTimers: true,
  });
  try {
    const shadow = await harness.loadRoute();
    const failed = () =>
      /History update problem|History calculation unavailable/.test(
        barState(shadow) + " " + detailsOnly(shadow),
      );
    const first = await notebookRead(harness, [[]], "gArtLc");
    const second = await notebookRead(harness, NB_CHAT, "khqZz");
    // The page world starts a third read once its own slots free, before the
    // background has finished with the first.
    const third = await notebookRead(harness, [[]], "gArtLc");
    assert.equal(failed(), false);
    slowStart.resolve({ accepted: true });
    await first.finish();
    await second.rows();
    await second.finish();
    // The waiting read starts once a slot is free and is accepted.
    await third.finish();
    assert.equal(failed(), false);
    assert.equal(
      harness.calls.filter(
        (call) =>
          call.target === "history-observation" && call.message.event === "start",
      ).length,
      3,
    );
  } finally {
    harness.close();
  }
});

test("NB14 conductor: a saved chat that was not counted names its reason in Details until a chat read counts, and only it asks for the tracker's read", async () => {
  const notebook = NB_NOTEBOOK;
  const harness = await notebookHarness();
  const diagnostic = (reason: string) =>
    harness.postHistorical({
      channel: historyCapture.HISTORY_DIAGNOSTIC_CHANNEL,
      site: "notebooklm",
      conversationId: notebook,
      observedAt: new Date().toISOString(),
      id: null,
      reason,
    });
  const read = async (value: unknown, rpc: "gArtLc" | "khqZz") => {
    const steps = await notebookRead(harness, value, rpc);
    await steps.rows();
    await steps.finish();
  };
  const chat = NB_CHAT;
  try {
    harness.setVisibility("visible");
    const shadow = await harness.loadRoute();
    // A Studio read passed by while the notebook loads (14 Oct 2026) is no reason to read
    // the saved chat, which the page reads itself: the second request seen live.
    diagnostic("history_limit");
    await settleOwnRead();
    assert.equal(harness.ownReadRequests().length, 0);
    await read([[]], "gArtLc");
    harness.fireGraceTimers();
    await settleOwnRead();
    assert.equal(harness.ownReadRequests().length, 1);
    assert.equal(
      (harness.ownReadRequests()[0]!.message as any).rejected,
      undefined,
    );
    harness.ownReadRequests()[0]!.ports[0]!.postMessage({
      outcome: { kind: "page_read" },
    });
    await settleOwnRead(10);
    // The page's chat read was passed by: Details names it under what was not counted.
    diagnostic("notebooklm_chat_busy");
    await settleOwnRead();
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    const details = () => shadow.querySelector("[data-body]")!.textContent!;
    assert.match(details(), /Not everything could be counted/);
    assert.match(details(), /Saved chat not counted/);
    assert.match(
      details(),
      /while the tracker was still reading other parts of the notebook/,
    );
    assert.equal(barState(shadow), "", "nothing on the bar");
    // The tracker reads the chat once itself, although the page had just read it.
    assert.equal(harness.ownReadRequests().length, 2);
    assert.equal((harness.ownReadRequests()[1]!.message as any).rejected, true);
    harness.ownReadRequests()[1]!.ports[0]!.postMessage({
      outcome: { kind: "invalid" },
    });
    await settleOwnRead(10);
    // A later Studio read of the notebook does not count its chat, so the reason stays.
    await read([[]], "gArtLc");
    assert.match(details(), /Saved chat not counted/);
    // A chat page that counts answers it.
    await read(chat, "khqZz");
    assert.doesNotMatch(details(), /Saved chat not counted/);
    assert.equal(harness.ownReadRequests().length, 2, "one tracker read after the refusal");
  } finally {
    harness.close();
  }
});

test("NB16 conductor: a notebook whose page read its saved chat asks for no tracker read, however long the import took", async () => {
  // Seen 14 Oct 2026 on direct loads: a second chat read after the page's own. The page
  // world skips the tracker's read for 30 s after the page sent its chat read; an import that
  // ends later must not open that window again.
  const harness = await notebookHarness();
  try {
    harness.setVisibility("visible");
    await harness.loadRoute();
    const chat = await notebookRead(harness, NB_CHAT, "khqZz");
    await chat.rows();
    harness.fireGraceTimers();
    await settleOwnRead();
    assert.equal(harness.ownReadRequests().length, 0, "not while the import runs");
    await chat.finish();
    harness.fireGraceTimers();
    await settleOwnRead(10);
    assert.equal(harness.ownReadRequests().length, 0);
    // A notebook whose page read only its Studio list still gets the one read.
    await harness.navigate(`/notebook/${OTHER_NOTEBOOK}?authuser=3`);
    const studio = await notebookRead(harness, [[]], "gArtLc", OTHER_NOTEBOOK);
    await studio.rows();
    await studio.finish();
    harness.fireGraceTimers();
    await settleOwnRead(10);
    assert.equal(harness.ownReadRequests().length, 1);
  } finally {
    harness.close();
  }
});

function liveFrame(id: string, event: string, revision: number) {
  return {
    channel: bridge.CHANNEL,
    version: 1,
    id,
    revision,
    event,
    site: "chatgpt",
    at: new Date().toISOString(),
    dispatch:
      event === "dispatch"
        ? {
            site: "chatgpt",
            action: "send",
            input: null,
            conversationId: null,
            parentId: null,
            requestId: null,
            model: null,
            attachments: null,
            imageEditParentId: null,
          }
        : null,
    snapshot: adapters.initialSnapshot(),
    timing: null,
    failure: null,
  };
}

test("W10 conductor: progress over the rate limit is held and sent, never dropped; dispatch and end always pass", async () => {
  const harness = await contentHarness();
  try {
    const a = crypto.randomUUID(),
      b = crypto.randomUUID();
    const sent = () =>
      harness.calls
        .filter((call) => call.target === "capture")
        .map((call) => [call.payload.id, call.payload.event, call.payload.revision]);
    harness.postHistorical(liveFrame(a, "dispatch", 1));
    harness.postHistorical(liveFrame(b, "dispatch", 1));
    for (let revision = 2; revision <= 15; revision++)
      harness.postHistorical(liveFrame(a, "progress", revision));
    // Over 16 frames a second, progress waits: the newest of each capture.
    for (let revision = 2; revision <= 5; revision++)
      harness.postHistorical(liveFrame(b, "progress", revision));
    harness.postHistorical(liveFrame(a, "progress", 16));
    // An end always passes and replaces its capture's waiting progress.
    harness.postHistorical(liveFrame(a, "end", 17));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(sent().length, 17);
    assert.deepEqual(sent().at(-1), [a, "end", 17]);
    assert.ok(!sent().some(([id, event]) => id === b && event === "progress"));
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.deepEqual(
      sent().filter(([id, event]) => id === b && event === "progress"),
      [[b, "progress", 5]],
    );
    assert.ok(!sent().some(([id, , revision]) => id === a && revision === 16));
  } finally {
    harness.close();
  }
});

test("W10 review: progress of a capture the page never bound is dropped over the rate limit, not held", async () => {
  const harness = await contentHarness();
  try {
    const shadow = await harness.loadRoute();
    // The page clock stands still during the flood, so every frame falls in one second
    // however slowly the test machine runs.
    const clock = harness.window.Date as DateConstructor;
    const start = clock.now();
    let offset = 0;
    clock.now = () => start + offset;
    // A bound capture uses the second's sixteen frames.
    const bound = crypto.randomUUID();
    harness.postHistorical(liveFrame(bound, "dispatch", 1));
    for (let revision = 2; revision <= 16; revision++)
      harness.postHistorical(liveFrame(bound, "progress", revision));
    // A flood of new ids: none of them could be relayed, so none may wait.
    for (let i = 0; i < 200; i++)
      harness.postHistorical(liveFrame(crypto.randomUUID(), "progress", 2));
    // The next second: held frames would be relayed now.
    offset = 1100;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    const details = shadow.querySelector("[data-body]")!.textContent!;
    assert.match(details, /capture_limit_exceeded/);
    // Held frames would be relayed after the second turns and fail to match.
    assert.doesNotMatch(details, /request_identity_ambiguous/);
  } finally {
    harness.close();
  }
});

test("W10 conductor: a capture silent longer than any live capture frees its binding", async () => {
  const harness = await contentHarness();
  try {
    const clock = harness.window.Date as DateConstructor;
    const real = clock.now.bind(clock);
    let offset = 0;
    clock.now = () => real() + offset;
    const sent = (id: string, event = "dispatch") =>
      harness.calls.some(
        (call) =>
          call.target === "capture" &&
          call.payload.id === id &&
          call.payload.event === event,
      );
    // Thirty-two replies whose end never came hold every binding.
    const ids = Array.from({ length: 33 }, () => crypto.randomUUID());
    for (const id of ids) harness.postHistorical(liveFrame(id, "dispatch", 1));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(sent(ids[31]!), true);
    assert.equal(sent(ids[32]!), false);
    // Once they have been silent longer than a live capture can be, a new reply is kept.
    offset = bridge.CAPTURE_SILENT_MS + 1000;
    const next = crypto.randomUUID();
    harness.postHistorical(liveFrame(next, "dispatch", 1));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(sent(next), true);
    // A late frame of a capture whose binding was kept still reaches the ledger.
    harness.postHistorical(liveFrame(ids[31]!, "end", 2));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(sent(ids[31]!, "end"), true);
  } finally {
    harness.close();
  }
});

test("conductor: Details open with figures, everyday terms and closed sections that stay open while figures update", async () => {
  let comparisons = 0;
  const harness = await contentHarness(false, {
    url: "https://chatgpt.com/c/00000000-0000-4000-8000-000000000abc",
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    respondCapture: () => ({ ok: true }),
    respondComparison: (message) => {
      comparisons++;
      assert.deepEqual(Object.keys(message).sort(), ["conversationId", "target"]);
      assert.equal(message.conversationId, "00000000-0000-4000-8000-000000000abc");
      return { chats: 12, thisChat: 9, smallerShare: 0.72, averageWh: 5.62, todayShare: 0.24, bins: [1, 2, 3, 2, 1, 1, 1, 0, 0, 0, 1, 0], thisBin: 6, scenario: "minimum" };
    },
  });
  try {
    const empty = new SummaryAccumulator().result();
    const ranged = (low: string, mid: string, high: string, unit: string) => ({ value: mid, unit, value_kind: "midpoint_sum", scenario_low: low, scenario_high: high, known: 1, unknown: 0, groups: [] });
    const summary = (requests: number) => ({
      ...empty,
      requests,
      tokens: { ...empty.tokens, input: { ...empty.tokens.input, value: "9860", known: 1 }, output: { ...empty.tokens.output, value: "2150", known: 1 } },
      metrics: {
        ...empty.metrics,
        energy: ranged("0.00899", "0.013", "0.0171", "kWh"),
        carbon: ranged("3.46", "5", "6.55", "gCO2e"),
        water: ranged("0.0292", "0.048", "0.0683", "L"),
      },
      estimation: {
        lines: [{ role: "main", kind: "text", model: "chatgpt-gpt-6-astra", record: "openai/gpt-6-astra", basis: "exact_record", count: requests, unavailable: 0, tokens: "2150", units: null, seconds: null, defaults: [], lengthFromText: false }],
        reasons: {},
        omitted: 0,
      },
    });
    const shadow = harness.render(null, { requestCount: 4, summary: summary(4) });
    await new Promise((resolve) => setImmediate(resolve));
    // The bar keeps its own look; Details adds the summary.
    assert.doesNotMatch(shadow.querySelector("[data-metrics]")!.textContent!, /everyday|LED|Compared/);
    assert.ok(["light", "dark"].includes((shadow.host as HTMLElement).dataset.aftTheme!));
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(comparisons, 1);
    const text = () => shadow.querySelector("[data-body]")!.textContent!;
    assert.equal(shadow.querySelector("h2")!.textContent, "This chat");
    assert.match(shadow.querySelector("[data-sub]")!.textContent!, /^4 requests · GPT-6 Astra$/);
    // Details open at the default scenario, Midpoint since 12 Oct 2026 (owner).
    assert.match(text(), /Electricity13 Wh/);
    // The tiles show one figure; the range sits under How this was estimated (owner, 12 Oct 2026).
    const tiles = shadow.querySelector(".dt-tiles")!;
    assert.equal(tiles.querySelector(".dt-meter, .dt-tile-range"), null);
    assert.doesNotMatch(tiles.textContent!, / to /);
    assert.match(text(), /Electricity, minimum to maximum8\.99 to 17\.1 Wh/);
    assert.match(text(), /In everyday termsat Midpoint/);
    assert.match(text(), /8 W LED bulb/);
    assert.match(text(), /driven by car/);
    assert.match(text(), /9,860read, in/);
    assert.match(text(), /2,150written, out/);
    assert.match(text(), /Bigger than 72% of your chats · last 30 days/);
    assert.match(text(), /Everything ChatGPT shows\. ChatGPT hides 1 part\./);
    assert.match(text(), /GPT-6 Astra · EcoLogits · Midpoint/);
    // The sections start closed, and the earlier full explanation stays inside "How this was estimated".
    const section = (id: string) => shadow.querySelector<HTMLElement>(`[data-section="${id}"]`)!;
    for (const id of ["compared", "counted", "estimated"]) {
      assert.equal(section(id).querySelector("button")!.getAttribute("aria-expanded"), "false", id);
      assert.equal(section(id).querySelector<HTMLElement>(".dt-disc-body")!.hidden, true, id);
    }
    assert.match(section("estimated").textContent!, /The provider bills the full reasoning/);
    section("counted").querySelector("button")!.click();
    assert.equal(section("counted").querySelector<HTMLElement>(".dt-disc-body")!.hidden, false);
    assert.match(section("counted").textContent!, /Side calls: titles, safety checksnot shown by ChatGPT/);
    // A live update re-renders Details; the opened section stays open.
    harness.render(null, { requestCount: 5, summary: summary(5) });
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(shadow.querySelector("[data-sub]")!.textContent!, /^5 requests/);
    assert.equal(section("counted").querySelector("button")!.getAttribute("aria-expanded"), "true");
    assert.equal(section("compared").querySelector("button")!.getAttribute("aria-expanded"), "false");
    // Closing resets the sections; opening again reads the comparison again.
    shadow.querySelector<HTMLButtonElement>("[data-close]")!.click();
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(comparisons, 2);
    assert.equal(section("counted").querySelector("button")!.getAttribute("aria-expanded"), "false");
    const credit = shadow.querySelector<HTMLAnchorElement>(".dt-credit a")!;
    assert.equal(credit.href, "https://www.linkedin.com/in/pranitnale/");
    assert.equal(credit.rel, "noopener noreferrer");
  } finally {
    harness.close();
  }
});

test("conductor: a comparison that never answers is shown as unavailable after the timeout", async (t) => {
  const harness = await contentHarness(false, {
    url: "https://chatgpt.com/c/00000000-0000-4000-8000-000000000abe",
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    respondCapture: () => ({ ok: true }),
  });
  try {
    const empty = new SummaryAccumulator().result();
    const shadow = harness.render(null, { requestCount: 1, summary: { ...empty, requests: 1 } });
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.enable({ apis: ["setTimeout"] });
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(shadow.querySelector("[data-body]")!.textContent!, /Comparing with your other chats/);
    t.mock.timers.tick(10_000);
    t.mock.timers.reset();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(shadow.querySelector("[data-body]")!.textContent!, /The comparison is not available right now/);
    assert.doesNotMatch(shadow.querySelector("[data-body]")!.textContent!, /Comparing with your other chats/);
  } finally {
    harness.close();
  }
});

test("conductor: a malformed comparison reply shows the comparison as unavailable", async () => {
  const harness = await contentHarness(false, {
    url: "https://chatgpt.com/c/00000000-0000-4000-8000-000000000abd",
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    respondCapture: () => ({ ok: true }),
    respondComparison: () => ({ chats: 3, thisChat: 2, smallerShare: 7, averageWh: 1, todayShare: null, bins: [1], thisBin: 0 }),
  });
  try {
    const empty = new SummaryAccumulator().result();
    const shadow = harness.render(null, { requestCount: 1, summary: { ...empty, requests: 1 } });
    await new Promise((resolve) => setImmediate(resolve));
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(shadow.querySelector("[data-body]")!.textContent!, /The comparison is not available right now/);
    // Unknown figures say so instead of showing zero.
    assert.match(shadow.querySelector("[data-body]")!.textContent!, /ElectricityUnknown/);
  } finally {
    harness.close();
  }
});

// The bar's state before a chat has figures (owner decision of 14 Oct 2026, afternoon):
// Waiting for your request, Processing, or No figures yet, and never the figure labels.
function chatgptFrame(
  id: string,
  event: "dispatch" | "end",
  conversationId: string | null = null,
) {
  return {
    timing: null,
    channel: "ai-footprint-observation-v1",
    version: 1,
    id,
    revision: event === "dispatch" ? 1 : 2,
    event,
    site: "chatgpt",
    at: new Date().toISOString(),
    dispatch:
      event === "dispatch"
        ? {
            action: "send",
            attachments: null,
            conversationId,
            imageEditParentId: null,
            input: "synthetic test input",
            model: null,
            parentId: null,
            requestId: null,
            site: "chatgpt",
          }
        : null,
    snapshot:
      event === "end"
        ? {
            ...adapters.initialSnapshot(),
            text: "synthetic reply",
            started: true,
            state: "completed",
            conversationId,
          }
        : null,
    failure: null,
  };
}

/** Every text the bar's figures slot showed, in order, from now on. */
function barTexts(shadow: ParentNode, window: Window) {
  const metrics = shadow.querySelector("[data-metrics]")!;
  const seen: string[] = [metrics.textContent!];
  const observer = new (window as any).MutationObserver(() => {
    if (seen.at(-1) !== metrics.textContent) seen.push(metrics.textContent!);
  });
  observer.observe(metrics, { childList: true, characterData: true, subtree: true });
  return {
    seen,
    async flush() {
      // MutationObserver callbacks run as microtasks.
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    stop: () => observer.disconnect(),
  };
}

test("bar state: a new chat waits for a request, shows Processing once it is sent and the figures once they publish", async () => {
  const harness = await contentHarness(false, {
    url: "https://chatgpt.com/",
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
  });
  try {
    const shadow = await harness.loadRoute();
    const metrics = () => shadow.querySelector("[data-metrics]")!.textContent!;
    assert.equal(metrics(), bar.BAR_WAITING);
    // Plain text in the bar's figures slot: no live region, role or hover help.
    const slot = shadow.querySelector<HTMLElement>("[data-metrics]")!;
    assert.equal(slot.hasAttribute("role"), false);
    assert.equal(shadow.querySelector(".bar [aria-live], .bar [role=status]"), null);
    assert.equal(shadow.querySelector<HTMLElement>("[data-status]")!.textContent, "");
    const id = "00000000-0000-4000-8000-000000000b01";
    harness.postThreadHistory(chatgptFrame(id, "dispatch"));
    await settle();
    assert.equal(metrics(), bar.BAR_PROCESSING);
    const binding = harness.currentCaptureBinding();
    assert.equal(binding?.captureId, id);
    // The reply ended; its figures are still being counted.
    harness.postThreadHistory(chatgptFrame(id, "end"));
    await settle();
    assert.equal(metrics(), bar.BAR_PROCESSING);
    harness.deliverDisplay(binding, null, "1");
    assert.match(metrics(), /^Req 1 · In\/Out tokens/);
    assert.doesNotMatch(metrics(), /…|Processing|Waiting/);
  } finally {
    harness.close();
  }
});

test("bar state: a reply whose figures cannot be saved ends on No figures yet instead of Processing", async () => {
  const harness = await contentHarness(false, {
    url: "https://chatgpt.com/",
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    respondCapture: (message) =>
      message.payload.event === "end"
        ? { ok: false, code: "storage_write_failed" }
        : { ok: true },
  });
  try {
    const shadow = await harness.loadRoute();
    const metrics = () => shadow.querySelector("[data-metrics]")!.textContent!;
    const id = "00000000-0000-4000-8000-000000000b02";
    harness.postThreadHistory(chatgptFrame(id, "dispatch"));
    await settle();
    assert.equal(metrics(), bar.BAR_PROCESSING);
    harness.postThreadHistory(chatgptFrame(id, "end"));
    await settle();
    assert.equal(metrics(), bar.BAR_NO_FIGURES);
    // The reason and its action are in Details, not on the bar.
    assert.match(barState(shadow), /Tracking problem \(free browser storage\)/);
  } finally {
    harness.close();
  }
});

test("bar state: a chat with figures keeps them while a new request is processed", async () => {
  const harness = await contentHarness(false, {
    url: "https://chatgpt.com/",
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
  });
  try {
    const shadow = harness.render(null, { requestCount: 3 });
    const metrics = () => shadow.querySelector("[data-metrics]")!.textContent!;
    assert.match(metrics(), /^Req 3 · /);
    const texts = barTexts(shadow, harness.window as unknown as Window);
    const id = "00000000-0000-4000-8000-000000000b03";
    harness.postThreadHistory(chatgptFrame(id, "dispatch"));
    await settle();
    harness.postThreadHistory(chatgptFrame(id, "end"));
    await settle();
    assert.match(metrics(), /^Req 3 · /);
    harness.deliverDisplay(harness.currentCaptureBinding(), null, "4");
    await texts.flush();
    assert.match(metrics(), /^Req 4 · /);
    texts.stop();
    assert.ok(texts.seen.every((text) => /^Req [34] · /.test(text)), texts.seen.join(" | "));
  } finally {
    harness.close();
  }
});

test("bar state: the first history batch replaces Processing and a later batch updates the figures in place", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000b04";
  let current = historicalView(historicalSummary({ status: "empty" }));
  const secondPage = deferred<unknown>();
  let pages = 0;
  const harness = await contentHarness(false, {
    url: `https://chatgpt.com/c/${conversationId}`,
    respond: () => historicalRouteDisplay(current),
    respondHistory: (message) =>
      message.message.event === "page" && ++pages === 2
        ? secondPage.promise
        : { accepted: true },
    captureGraceTimers: true,
  });
  try {
    const shadow = await harness.loadRoute();
    const metrics = () => shadow.querySelector("[data-metrics]")!.textContent!;
    assert.equal(metrics(), bar.BAR_PROCESSING);
    const first = historicalMessages(conversationId, "00000000-0000-4000-8000-000000000b14", {
      suffix: "611",
    });
    current = historicalView(historicalSummary());
    harness.postHistorical(first.start);
    harness.postHistorical(first.page);
    for (let i = 0; i < 20 && !/Req 2/.test(metrics()); i++) await settle();
    assert.match(metrics(), /^Req 2 · In\/Out tokens/);
    const texts = barTexts(shadow, harness.window as unknown as Window);
    // A second batch is imported: the figures stay until the larger ones publish.
    const second = historicalMessages(conversationId, "00000000-0000-4000-8000-000000000b15", {
      first: true,
      suffix: "621",
    });
    harness.postHistorical(second.start);
    harness.postHistorical(second.page);
    harness.fireGraceTimers();
    await settle();
    assert.match(metrics(), /^Req 2 · /);
    current = historicalView(
      historicalSummary({ prompt_count: "4", response_count: "4", first_request_verified: true }),
    );
    secondPage.resolve({ accepted: true });
    for (let i = 0; i < 20 && !/Req 4/.test(metrics()); i++) await settle();
    await texts.flush();
    texts.stop();
    assert.match(metrics(), /^Req 4 · /);
    assert.ok(
      texts.seen.every((text) => /^Req [24] · /.test(text)),
      `never back to a state: ${texts.seen.join(" | ")}`,
    );
  } finally {
    harness.close();
  }
});

test("bar state: a refused history read shows Processing during the tracker's read, then No figures yet with the reason in Details", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000b05";
  const harness = await contentHarness(false, {
    url: `https://claude.ai/chat/${conversationId}`,
    html: '<main><form><div class="ProseMirror" contenteditable="true" role="textbox"></div></form></main>',
    respond: () =>
      historicalRouteDisplay(
        historicalView(
          historicalSummary({
            status: "empty",
            prompt_count: "0",
            response_count: "0",
            tokens: [],
            resources: [],
          }),
        ),
      ),
    respondHistory: () => ({ accepted: false }),
    captureGraceTimers: true,
  });
  try {
    harness.setVisibility("visible");
    const shadow = await harness.loadRoute();
    const metrics = () => shadow.querySelector("[data-metrics]")!.textContent!;
    assert.equal(metrics(), bar.BAR_PROCESSING);
    const read = await postClaudeImport(harness, conversationId, 541);
    read.start();
    await read.send("batch");
    for (let i = 0; i < 40 && !/History update problem/.test(barState(shadow)); i++)
      await settleOwnRead(1);
    await settleOwnRead();
    // The tracker reads the chat itself once: still Processing.
    assert.equal(harness.ownReadRequests().length, 1);
    assert.equal(metrics(), bar.BAR_PROCESSING);
    harness.ownReadRequests()[0]!.ports[0]!.postMessage({
      outcome: { kind: "http", status: 403, shouldRetry: false },
    });
    for (let i = 0; i < 40 && metrics() !== bar.BAR_NO_FIGURES; i++) await settleOwnRead(1);
    harness.fireGraceTimers();
    await settleOwnRead();
    assert.equal(metrics(), bar.BAR_NO_FIGURES);
    assert.match(barState(shadow), /History update problem \(reload page\)/);
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    const body = shadow.querySelector("[data-body]")!.textContent!;
    assert.match(body, /Claude refused the read \(status 403\)/);
    assert.ok(shadow.querySelector("[data-body] .dt-reload"));
  } finally {
    harness.close();
  }
});

test("bar state: moving between chats in one tab resets the state and never shows the previous chat's figures", async () => {
  const counted = "00000000-0000-4000-8000-000000000b06";
  const failing = "00000000-0000-4000-8000-000000000b07";
  const harness = await contentHarness(false, {
    url: `https://chatgpt.com/c/${counted}`,
    respond: (message) =>
      message.conversationId === counted
        ? historicalRouteDisplay(historicalView(historicalSummary()))
        : { error: "Recorded conversation totals are unavailable." },
    captureGraceTimers: true,
  });
  try {
    const shadow = await harness.loadRoute();
    const metrics = () => shadow.querySelector("[data-metrics]")!.textContent!;
    for (let i = 0; i < 20 && !/Req 2/.test(metrics()); i++) await settle();
    assert.match(metrics(), /^Req 2 · /);
    await harness.navigate("/");
    assert.equal(metrics(), bar.BAR_WAITING);
    await harness.navigate(`/c/${failing}`);
    // The new chat is read: Processing, without the previous figures.
    assert.equal(metrics(), bar.BAR_PROCESSING);
    await settle();
    harness.fireGraceTimers();
    await settle();
    assert.equal(metrics(), bar.BAR_NO_FIGURES);
    await harness.navigate(`/c/${counted}`);
    assert.doesNotMatch(metrics(), /No figures yet/);
    for (let i = 0; i < 20 && !/Req 2/.test(metrics()); i++) await settle();
    assert.match(metrics(), /^Req 2 · /);
  } finally {
    harness.close();
  }
});

test("bar state: a new ChatGPT chat goes from Waiting to Processing to its figures across the local address, without No figures yet", async () => {
  const conversation = "00000000-0000-4000-8000-000000000b08";
  const harness = await contentHarness(false, {
    url: "https://chatgpt.com/",
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    captureGraceTimers: true,
  });
  try {
    const shadow = await harness.loadRoute();
    const metrics = () => shadow.querySelector("[data-metrics]")!.textContent!;
    assert.equal(metrics(), bar.BAR_WAITING);
    const texts = barTexts(shadow, harness.window as unknown as Window);
    const id = "00000000-0000-4000-8000-000000000b18";
    harness.postThreadHistory(chatgptFrame(id, "dispatch"));
    await settle();
    const binding = harness.currentCaptureBinding();
    assert.equal(metrics(), bar.BAR_PROCESSING);
    await harness.navigate(LOCAL_CHATGPT);
    assert.equal(metrics(), bar.BAR_PROCESSING);
    await harness.navigate(`/c/${conversation}`);
    await settle();
    // The saved totals of the new chat are unavailable and the grace period ends, but the
    // reply is still on its way.
    harness.fireGraceTimers();
    await settle();
    assert.equal(metrics(), bar.BAR_PROCESSING);
    harness.deliverDisplay(binding, { site: "chatgpt", conversationId: conversation }, "1");
    await texts.flush();
    texts.stop();
    assert.match(metrics(), /^Req 1 · /);
    assert.deepEqual(
      texts.seen.map((text) => (text.startsWith("Req ") ? "figures" : text)),
      [bar.BAR_WAITING, bar.BAR_PROCESSING, "figures"],
    );
  } finally {
    harness.close();
  }
});

// Live findings of 14 Oct 2026: while a request is pending (its capture runs, or its estimate
// has not published yet) the bar shows the open chat's last complete figures, or Processing
// when it has none, and never a display mixing the new request's partial values with older
// ones (owner decision 1a).
function requestFrame(
  site: "chatgpt" | "claude" | "gemini" | "perplexity",
  id: string,
  event: "dispatch" | "progress" | "end",
  revision: number,
  conversationId: string | null = null,
) {
  return {
    timing: null,
    channel: "ai-footprint-observation-v1",
    version: 1,
    id,
    revision,
    event,
    site,
    at: new Date().toISOString(),
    dispatch:
      event === "dispatch"
        ? {
            action: "send",
            attachments: null,
            conversationId,
            imageEditParentId: null,
            input: "synthetic test input",
            model: null,
            parentId: null,
            requestId: null,
            site,
          }
        : null,
    snapshot:
      event === "dispatch"
        ? null
        : {
            ...adapters.initialSnapshot(),
            text: event === "end" ? "synthetic reply" : "synth",
            started: true,
            state: event === "end" ? "completed" : "generating",
            conversationId,
          },
    failure: null,
  };
}

const figuresOnly = (seen: string[]) =>
  seen.map((text) => (text.startsWith("Req ") ? "figures" : text));

test("bar during a request: a new chat stays on Processing through the dispatch, progress and unestimated end displays (finding 1)", async () => {
  const harness = await contentHarness(false, {
    url: "https://claude.ai/new",
    html: '<main><form><div class="ProseMirror" contenteditable="true" role="textbox"></div></form></main>',
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
  });
  try {
    const shadow = await harness.loadRoute();
    const metrics = () => shadow.querySelector("[data-metrics]")!.textContent!;
    assert.equal(metrics(), bar.BAR_WAITING);
    const texts = barTexts(shadow, harness.window as unknown as Window);
    const id = "00000000-0000-4000-8000-000000000c01";
    harness.postThreadHistory(requestFrame("claude", id, "dispatch", 1));
    await settle();
    const binding = harness.currentCaptureBinding();
    // The dispatch display has the prompt's input and nothing else yet.
    harness.deliverDisplay(binding, null, "1", { state: "dispatch_only", input: "16", output: null });
    await texts.flush();
    assert.equal(metrics(), bar.BAR_PROCESSING);
    harness.postThreadHistory(requestFrame("claude", id, "progress", 2));
    await settle();
    harness.deliverDisplay(binding, null, "1", { state: "generating", input: "16", output: "1" });
    await texts.flush();
    assert.equal(metrics(), bar.BAR_PROCESSING);
    harness.postThreadHistory(requestFrame("claude", id, "end", 3));
    await settle();
    // The end is saved but its estimate is still being calculated.
    harness.deliverDisplay(binding, null, "1", {
      state: "completed",
      calculationPending: true,
      input: "16",
      output: "20",
    });
    await texts.flush();
    assert.equal(metrics(), bar.BAR_PROCESSING);
    harness.deliverDisplay(binding, null, "1", {
      state: "completed",
      calculationPending: false,
      input: "16",
      output: "20",
    });
    await texts.flush();
    texts.stop();
    assert.match(metrics(), /^Req 1 · In\/Out tokens - ≈ 16\/20 /);
    assert.deepEqual(figuresOnly(texts.seen), [bar.BAR_WAITING, bar.BAR_PROCESSING, "figures"]);
  } finally {
    harness.close();
  }
});

// Live QA of 19 Oct 2026: on claude.ai/new the bar showed "Req 1 · ≈ 27/Unknown" with Unknown
// resources for about 3 s during the first reply. claude.ai moved to the chat's address before
// the reply's first display named the chat, the move dropped the reply, and the saved totals read
// for the new address showed the pending request's partial figures.
test("bar during a request: a new Claude chat that moves to its address before its first display stays on Processing", async () => {
  const chat = "00000000-0000-4000-8000-000000000c11";
  const identity = { site: "claude", conversationId: chat };
  const empty = new SummaryAccumulator().result();
  const harness = await contentHarness(false, {
    url: "https://claude.ai/new",
    html: '<main><form><div class="ProseMirror" contenteditable="true" role="textbox"></div></form></main>',
    // The new chat's saved totals while its reply streams: the prompt and no output yet.
    respond: () => ({
      ...historicalRouteDisplay(null),
      summary: {
        ...empty,
        requests: 1,
        tokens: {
          ...empty.tokens,
          input: { ...empty.tokens.input, value: "27" },
          output: { ...empty.tokens.output, value: null },
        },
      },
    }),
  });
  try {
    const shadow = await harness.loadRoute();
    const metrics = () => shadow.querySelector("[data-metrics]")!.textContent!;
    assert.equal(metrics(), bar.BAR_WAITING);
    const texts = barTexts(shadow, harness.window as unknown as Window);
    const id = "00000000-0000-4000-8000-000000000c12";
    harness.postThreadHistory(requestFrame("claude", id, "dispatch", 1, chat));
    await settle();
    const binding = harness.currentCaptureBinding();
    await harness.navigate(`/chat/${chat}`);
    await settle();
    await texts.flush();
    assert.equal(metrics(), bar.BAR_PROCESSING, "the pending request's saved totals stay off the bar");
    harness.deliverDisplay(binding, identity, "1", { state: "dispatch_only", input: "27", output: null });
    await texts.flush();
    assert.equal(metrics(), bar.BAR_PROCESSING);
    harness.postThreadHistory(requestFrame("claude", id, "progress", 2, chat));
    await settle();
    harness.deliverDisplay(binding, identity, "1", { state: "generating", input: "27", output: "5" });
    await texts.flush();
    assert.equal(metrics(), bar.BAR_PROCESSING);
    harness.postThreadHistory(requestFrame("claude", id, "end", 3, chat));
    await settle();
    harness.deliverDisplay(binding, identity, "1", {
      state: "completed",
      calculationPending: false,
      input: "27",
      output: "120",
    });
    await texts.flush();
    texts.stop();
    assert.match(metrics(), /^Req 1 · In\/Out tokens - ≈ 27\/120 /);
    assert.deepEqual(figuresOnly(texts.seen), [bar.BAR_WAITING, bar.BAR_PROCESSING, "figures"]);
  } finally {
    harness.close();
  }
});

test("bar during a request: a chat with figures keeps them until the new request is fully estimated, then shows all new figures at once (findings 2 and 3)", async () => {
  const harness = await contentHarness(false, {
    url: "https://chatgpt.com/",
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
  });
  try {
    const shadow = await harness.loadRoute();
    const metrics = () => shadow.querySelector("[data-metrics]")!.textContent!;
    const first = "00000000-0000-4000-8000-000000000c02";
    harness.postThreadHistory(requestFrame("chatgpt", first, "dispatch", 1));
    await settle();
    harness.postThreadHistory(requestFrame("chatgpt", first, "end", 2));
    await settle();
    harness.deliverDisplay(harness.currentCaptureBinding(), null, "1", {
      state: "completed",
      input: "16",
      output: "14",
    });
    assert.match(metrics(), /^Req 1 · In\/Out tokens - ≈ 16\/14 /);
    const before = metrics();
    const texts = barTexts(shadow, harness.window as unknown as Window);
    const second = "00000000-0000-4000-8000-000000000c03";
    harness.postThreadHistory(requestFrame("chatgpt", second, "dispatch", 1));
    await settle();
    const binding = harness.currentCaptureBinding();
    assert.equal(binding.captureId, second);
    // New Req and In next to the old Out and energy: never shown.
    harness.deliverDisplay(binding, null, "2", { state: "dispatch_only", input: "25", output: "14" });
    await texts.flush();
    assert.equal(metrics(), before);
    // A mid-stream estimate: never shown.
    harness.postThreadHistory(requestFrame("chatgpt", second, "progress", 2));
    await settle();
    harness.deliverDisplay(binding, null, "2", { state: "generating", input: "25", output: "15" });
    await texts.flush();
    assert.equal(metrics(), before);
    harness.postThreadHistory(requestFrame("chatgpt", second, "end", 3));
    await settle();
    assert.equal(metrics(), before);
    harness.deliverDisplay(binding, null, "2", { state: "completed", input: "25", output: "24" });
    await texts.flush();
    assert.match(metrics(), /^Req 2 · In\/Out tokens - ≈ 25\/24 /);
    // A correction after the request finished updates the figures in place.
    harness.deliverDisplay(binding, null, "2", { state: "completed", input: "25", output: "26" });
    await texts.flush();
    texts.stop();
    assert.match(metrics(), /^Req 2 · In\/Out tokens - ≈ 25\/26 /);
    assert.deepEqual(texts.seen.map((text) => /≈ \d+\/\d+/.exec(text)?.[0]), [
      "≈ 16/14",
      "≈ 25/24",
      "≈ 25/26",
    ]);
  } finally {
    harness.close();
  }
});

test("bar during a request: a request that finished without an estimate shows its Unknown figures as its result", async () => {
  const harness = await contentHarness(false, {
    url: "https://chatgpt.com/",
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
  });
  try {
    const shadow = await harness.loadRoute();
    const metrics = () => shadow.querySelector("[data-metrics]")!.textContent!;
    const id = "00000000-0000-4000-8000-000000000c04";
    harness.postThreadHistory(requestFrame("chatgpt", id, "dispatch", 1));
    await settle();
    const binding = harness.currentCaptureBinding();
    harness.postThreadHistory(requestFrame("chatgpt", id, "end", 2));
    await settle();
    assert.equal(metrics(), bar.BAR_PROCESSING);
    harness.deliverDisplay(binding, null, "1", {
      state: "interrupted_unconfirmed",
      input: "16",
      output: null,
    });
    assert.match(metrics(), /^Req 1 · .*Unknown/);
  } finally {
    harness.close();
  }
});

/**
 * Dispatches an event the content script sees as the person's own (isTrusted), as a real
 * click or key press would be. JSDOM marks every script-dispatched event untrusted, so this
 * goes through JSDOM's internal dispatch, as its own user-agent events do.
 */
const jsdomRequire = createRequire(import.meta.url);
const jsdomUtils = jsdomRequire(
  path.join(path.dirname(jsdomRequire.resolve("jsdom")), "generated/idl/utils.js"),
);
function dispatchTrusted(target: EventTarget, event: Event) {
  const impl = jsdomUtils.implForWrapper(event);
  impl.isTrusted = true;
  jsdomUtils.implForWrapper(target)._dispatch(impl);
}

const GEMINI_COMPOSER =
  '<main><form><rich-textarea><div contenteditable="true" role="textbox"></div></rich-textarea><button type="button" aria-label="Send message">Send</button></form></main>';

test("bar during a request: a Gemini send shows Processing at once and keeps it across the new chat's address until the final figures (finding 4)", async () => {
  const harness = await contentHarness(false, {
    url: "https://gemini.google.com/app",
    html: GEMINI_COMPOSER,
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    captureGraceTimers: true,
  });
  try {
    const shadow = await harness.loadRoute();
    const metrics = () => shadow.querySelector("[data-metrics]")!.textContent!;
    assert.equal(metrics(), bar.BAR_WAITING);
    const texts = barTexts(shadow, harness.window as unknown as Window);
    const window = harness.window;
    // The person clicks Send; the page's request reaches the tracker only later.
    dispatchTrusted(
      harness.document.querySelector("button")!,
      new window.MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    await texts.flush();
    assert.equal(metrics(), bar.BAR_PROCESSING);
    const id = "00000000-0000-4000-8000-000000000c05";
    const chat = "c_0123456789abcdef";
    harness.postThreadHistory(requestFrame("gemini", id, "dispatch", 1));
    await settle();
    const binding = harness.currentCaptureBinding();
    harness.deliverDisplay(binding, null, "1", { state: "dispatch_only", input: "16", output: null });
    harness.postThreadHistory(requestFrame("gemini", id, "progress", 2, chat));
    await settle();
    const identity = { site: "gemini", conversationId: chat };
    harness.deliverDisplay(binding, identity, "1", { state: "generating", input: "16", output: "1" });
    await texts.flush();
    assert.equal(metrics(), bar.BAR_PROCESSING);
    // Gemini gives the new chat its address while the reply streams.
    await harness.navigate("/app/0123456789abcdef");
    await settle();
    assert.equal(metrics(), bar.BAR_PROCESSING);
    // The reply keeps its capture across the move, so its displays still apply.
    harness.deliverDisplay(binding, identity, "1", { state: "generating", input: "16", output: "1" });
    await texts.flush();
    assert.equal(metrics(), bar.BAR_PROCESSING);
    harness.postThreadHistory(requestFrame("gemini", id, "end", 3, chat));
    await settle();
    harness.deliverDisplay(binding, identity, "1", { state: "completed", input: "16", output: "15" });
    await texts.flush();
    texts.stop();
    assert.match(metrics(), /^Req 1 · In\/Out tokens - ≈ 16\/15 /);
    assert.deepEqual(figuresOnly(texts.seen), [bar.BAR_WAITING, bar.BAR_PROCESSING, "figures"]);
  } finally {
    harness.close();
  }
});

test("bar during a request: a new Perplexity search stays on Processing across its new address until the final figures (finding 5)", async () => {
  const thread = "00000000-0000-4000-8000-000000000c06";
  const harness = await contentHarness(false, {
    url: "https://www.perplexity.ai/",
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    captureGraceTimers: true,
  });
  try {
    const shadow = await harness.loadRoute();
    const metrics = () => shadow.querySelector("[data-metrics]")!.textContent!;
    const texts = barTexts(shadow, harness.window as unknown as Window);
    const id = "00000000-0000-4000-8000-000000000c07";
    harness.postThreadHistory(requestFrame("perplexity", id, "dispatch", 1));
    await settle();
    const binding = harness.currentCaptureBinding();
    await harness.navigate("/search/new/00000000-0000-4000-8000-000000000c08");
    await harness.navigate(`/search/${thread}`);
    harness.fireGraceTimers();
    await settle();
    assert.equal(metrics(), bar.BAR_PROCESSING);
    const identity = { site: "perplexity", conversationId: thread };
    harness.postThreadHistory(requestFrame("perplexity", id, "progress", 2));
    await settle();
    harness.deliverDisplay(binding, identity, "1", { state: "generating", input: "16", output: "16" });
    await texts.flush();
    assert.equal(metrics(), bar.BAR_PROCESSING);
    harness.postThreadHistory(requestFrame("perplexity", id, "end", 3));
    await settle();
    harness.deliverDisplay(binding, identity, "1", { state: "completed", input: "16", output: "35" });
    await texts.flush();
    texts.stop();
    assert.match(metrics(), /^Req 1 · In\/Out tokens - ≈ 16\/35 /);
    assert.deepEqual(figuresOnly(texts.seen), [bar.BAR_WAITING, bar.BAR_PROCESSING, "figures"]);
  } finally {
    harness.close();
  }
});

test("bar during a request: Enter in an empty composer does not show Processing", async () => {
  const harness = await contentHarness(false, {
    url: "https://chatgpt.com/",
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
  });
  try {
    const shadow = await harness.loadRoute();
    const metrics = () => shadow.querySelector("[data-metrics]")!.textContent!;
    const window = harness.window;
    const editor =harness.document.querySelector<HTMLTextAreaElement>("#prompt-textarea")!;
    const enter = () =>
      dispatchTrusted(
        editor,
        new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    enter();
    await settle();
    assert.equal(metrics(), bar.BAR_WAITING);
    editor.value = "synthetic test input";
    enter();
    await settle();
    assert.equal(metrics(), bar.BAR_PROCESSING);
  } finally {
    harness.close();
  }
});

test("Details opens at its top even when its panel kept a scroll offset (15 October 2026)", async () => {
  // Live, the panel opened at its bottom, with the figures and everyday terms out of view.
  const harness = await contentHarness();
  try {
    const shadow = harness.render(null, { requestCount: 1 });
    const panel = shadow.querySelector<HTMLElement>(".panel")!;
    let top = 287;
    Object.defineProperty(panel, "scrollTop", {
      configurable: true,
      get: () => top,
      set: (value: number) => {
        top = value;
      },
    });
    shadow.querySelector<HTMLElement>("[data-open]")!.click();
    assert.equal(panel.hidden, false);
    assert.equal(top, 0);
    shadow.querySelector<HTMLButtonElement>("[data-close]")!.click();
    top = 150;
    shadow.querySelector<HTMLElement>("[data-open]")!.click();
    assert.equal(top, 0);
  } finally {
    harness.close();
  }
});

test("the bar and Details follow claude.ai and Perplexity theme changes without a reload (15 October 2026)", async () => {
  // claude.ai marks its theme with data-mode and Perplexity with data-color-scheme; neither was
  // watched, so an appearance change kept the old colours until the page was reloaded.
  const harness = await contentHarness();
  try {
    const shadow = harness.render(null, { requestCount: 1 });
    const host = shadow.host as HTMLElement;
    const html = harness.document.documentElement;
    const anchors = [...harness.document.querySelectorAll<HTMLElement>("form, fieldset, [data-test-composer-bounds]")];
    const switchTo = async (dark: boolean, attribute: string, value: string) => {
      for (const anchor of anchors) anchor.style.color = dark ? "rgb(240, 240, 240)" : "rgb(20, 20, 20)";
      html.setAttribute(attribute, value);
      await new Promise((resolve) => setImmediate(resolve));
    };
    await switchTo(false, "data-mode", "light");
    assert.equal(host.dataset.aftTheme, "light");
    await switchTo(true, "data-mode", "dark");
    assert.equal(host.dataset.aftTheme, "dark");
    await switchTo(false, "data-color-scheme", "light");
    assert.equal(host.dataset.aftTheme, "light");
    await switchTo(true, "data-color-scheme", "dark");
    assert.equal(host.dataset.aftTheme, "dark");
  } finally {
    harness.close();
  }
});

// Capture delivery retries (16 Oct 2026). The waits are fired by the test, so a frame's
// tries are counted exactly.
const RETRY_DELAYS = [1111, 3333];

function deliveryFrame(
  site: "chatgpt" | "claude",
  id: string,
  event: "dispatch" | "progress" | "end",
  conversationId: string | null = null,
) {
  return {
    timing: null,
    channel: "ai-footprint-observation-v1",
    version: 1,
    id,
    revision: event === "dispatch" ? 1 : event === "progress" ? 2 : 3,
    event,
    site,
    at: new Date().toISOString(),
    dispatch:
      event === "dispatch"
        ? {
            action: "send",
            attachments: null,
            conversationId,
            imageEditParentId: null,
            input: "synthetic test input",
            model: null,
            parentId: null,
            requestId: null,
            site,
          }
        : null,
    snapshot:
      event === "dispatch"
        ? null
        : {
            ...adapters.initialSnapshot(),
            text: "synthetic reply",
            started: true,
            state: event === "end" ? "completed" : "generating",
            conversationId,
          },
    failure: null,
  };
}

/** The capture frames sent to the background, in order, as event:revision. */
const captureSends = (
  harness: Awaited<ReturnType<typeof contentHarness>>,
  id?: string,
) =>
  harness.calls
    .filter(
      (message) =>
        message?.target === "capture" &&
        (id === undefined || message.payload.id === id),
    )
    .map((message) => `${message.payload.event}:${message.payload.revision}`);

test("capture delivery: a frame the background was not ready for is sent again and a recovered delivery leaves no problem", async () => {
  let call = 0;
  const harness = await contentHarness(false, {
    url: "https://chatgpt.com/",
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    respondCapture: () =>
      ++call === 1 ? { ok: false, code: "storage_write_failed" } : { ok: true },
    captureRetryDelays: RETRY_DELAYS,
  });
  try {
    const shadow = await harness.loadRoute();
    const metrics = () => shadow.querySelector("[data-metrics]")!.textContent!;
    const id = "00000000-0000-4000-8000-000000000d01";
    harness.postThreadHistory(deliveryFrame("chatgpt", id, "dispatch"));
    await settle();
    // While the frame waits to be sent again the bar stays on Processing and no problem
    // is recorded.
    assert.deepEqual(captureSends(harness), ["dispatch:1"]);
    assert.equal(harness.pendingRetryTimers(), 1);
    assert.equal(metrics(), bar.BAR_PROCESSING);
    assert.doesNotMatch(barState(shadow), /Tracking problem/);
    harness.fireRetryTimers();
    await settle();
    assert.deepEqual(captureSends(harness), ["dispatch:1", "dispatch:1"]);
    harness.postThreadHistory(deliveryFrame("chatgpt", id, "end"));
    await settle();
    assert.deepEqual(captureSends(harness), ["dispatch:1", "dispatch:1", "end:3"]);
    assert.equal(harness.pendingRetryTimers(), 0);
    harness.deliverDisplay(harness.currentCaptureBinding(), null, "1");
    assert.match(metrics(), /^Req 1 · /);
    assert.doesNotMatch(barState(shadow), /Tracking problem/);
    assert.doesNotMatch(detailsOnly(shadow), /Tracking problem/);
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    assert.doesNotMatch(
      shadow.querySelector("[data-body]")!.textContent!,
      /storage_write_failed|current tracking problem/,
    );
  } finally {
    harness.close();
  }
});

for (const answer of [
  { ok: false, code: "payload_rejected" },
  { ok: false, code: "capture_hook_missing" },
  { ok: false, code: "request_identity_ambiguous" },
  { ok: false, code: "policy_unavailable" },
  { ok: false, code: "deletion_in_progress" },
  {},
])
  test(`capture delivery: a refusal (${answer.code ?? "malformed answer"}) is never sent again`, async () => {
    const harness = await contentHarness(false, {
      url: "https://chatgpt.com/",
      respond: () => ({ error: "Recorded conversation totals are unavailable." }),
      respondCapture: () => answer,
      captureRetryDelays: RETRY_DELAYS,
    });
    try {
      await harness.loadRoute();
      const id = "00000000-0000-4000-8000-000000000d11";
      harness.postThreadHistory(deliveryFrame("chatgpt", id, "dispatch"));
      await settle();
      harness.postThreadHistory(deliveryFrame("chatgpt", id, "end"));
      await settle();
      assert.equal(harness.pendingRetryTimers(), 0);
      assert.deepEqual(captureSends(harness), ["dispatch:1", "end:3"]);
    } finally {
      harness.close();
    }
  });

test("capture delivery: a frame still not delivered after its last try records the problem once", async () => {
  const harness = await contentHarness(false, {
    url: "https://chatgpt.com/",
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    respondCapture: () => ({ ok: false, code: "storage_write_failed" }),
    captureRetryDelays: RETRY_DELAYS,
  });
  try {
    const shadow = await harness.loadRoute();
    const id = "00000000-0000-4000-8000-000000000d21";
    harness.postThreadHistory(deliveryFrame("chatgpt", id, "dispatch"));
    await settle();
    harness.fireRetryTimers();
    await settle();
    assert.equal(harness.pendingRetryTimers(), 1, "a third try is due");
    assert.doesNotMatch(barState(shadow), /Tracking problem/);
    harness.fireRetryTimers();
    await settle();
    assert.equal(harness.pendingRetryTimers(), 0);
    assert.deepEqual(captureSends(harness), [
      "dispatch:1",
      "dispatch:1",
      "dispatch:1",
    ]);
    assert.match(barState(shadow), /Tracking problem \(free browser storage\)/);
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    const details = shadow.querySelector("[data-body]")!.textContent!;
    assert.match(details, /storage_write_failed/);
    assert.match(details, /Occurrences1/);
  } finally {
    harness.close();
  }
});

test("capture delivery: later frames wait behind a frame sent again, and a frame that may have run first follows it once more", async () => {
  const sends = new Map<string, number>();
  const harness = await contentHarness(false, {
    url: "https://chatgpt.com/",
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    // Each capture's first frame finds the background not ready; every later send works.
    respondCapture: (message) => {
      const count = (sends.get(message.payload.id) ?? 0) + 1;
      sends.set(message.payload.id, count);
      return count === 1 ? { ok: false, code: "buffer_overflow" } : { ok: true };
    },
    captureRetryDelays: RETRY_DELAYS,
  });
  try {
    await harness.loadRoute();
    // Frames that arrive while the dispatch waits are held, and the end replaces the
    // progress frame before it, so the end never reaches the background before the dispatch.
    const held = "00000000-0000-4000-8000-000000000d31";
    harness.postThreadHistory(deliveryFrame("chatgpt", held, "dispatch"));
    await settle();
    harness.postThreadHistory(deliveryFrame("chatgpt", held, "progress"));
    harness.postThreadHistory(deliveryFrame("chatgpt", held, "end"));
    await settle();
    assert.deepEqual(captureSends(harness, held), ["dispatch:1"]);
    harness.fireRetryTimers();
    await settle();
    assert.deepEqual(captureSends(harness, held), [
      "dispatch:1",
      "dispatch:1",
      "end:3",
    ]);
    // An end sent before the dispatch's failure was known may have run before it, so it
    // is sent once more after the dispatch; the background skips it if it already has it.
    const raced = "00000000-0000-4000-8000-000000000d32";
    harness.postThreadHistory(deliveryFrame("chatgpt", raced, "dispatch"));
    harness.postThreadHistory(deliveryFrame("chatgpt", raced, "end"));
    await settle();
    assert.deepEqual(captureSends(harness, raced), ["dispatch:1", "end:3"]);
    harness.fireRetryTimers();
    await settle();
    assert.deepEqual(captureSends(harness, raced), [
      "dispatch:1",
      "end:3",
      "dispatch:1",
      "end:3",
    ]);
    assert.equal(harness.pendingRetryTimers(), 0);
  } finally {
    harness.close();
  }
});

/** A Claude chat the page has read (empty so far), with live captures answered by `respondCapture`. */
async function claudeLiveHarness(
  conversationId: string,
  respondCapture: (message: any) => unknown,
) {
  const state = { finishes: 0 };
  const harness = await contentHarness(false, {
    url: `https://claude.ai/chat/${conversationId}`,
    html: '<main><form><div class="ProseMirror" contenteditable="true" role="textbox"></div></form></main>',
    // The chat's saved totals have figures once a second read of it was imported.
    respond: () =>
      historicalRouteDisplay(
        historicalView(
          state.finishes >= 2
            ? historicalSummary({ first_request_verified: true })
            : historicalSummary({
                status: "empty",
                prompt_count: "0",
                response_count: "0",
                tokens: [],
                resources: [],
              }),
        ),
      ),
    respondHistory: (request) => {
      if (request.message.event === "finish") state.finishes++;
      return { accepted: true };
    },
    respondCapture,
    captureGraceTimers: true,
    captureRetryDelays: RETRY_DELAYS,
  });
  harness.setVisibility("visible");
  const shadow = await harness.loadRoute();
  // The page read the chat when it opened, so the tracker has no reason to read it.
  const page = await postClaudeImport(harness, conversationId, 801);
  page.start();
  assert.deepEqual(await page.send("batch"), { accepted: true });
  assert.deepEqual(await page.send("finish"), { accepted: true });
  await settleOwnRead();
  assert.equal(harness.ownReadRequests().length, 0);
  return { harness, shadow };
}

test("capture delivery: a reply whose end frame could not be delivered is read once from the chat's saved history", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000d41";
  const { harness, shadow } = await claudeLiveHarness(conversationId, (message) =>
    message.payload.event === "end"
      ? { ok: false, code: "storage_write_failed" }
      : { ok: true },
  );
  try {
    const metrics = () => shadow.querySelector("[data-metrics]")!.textContent!;
    const id = "00000000-0000-4000-8000-000000000d42";
    harness.postThreadHistory(deliveryFrame("claude", id, "dispatch", conversationId));
    harness.postThreadHistory(deliveryFrame("claude", id, "end", conversationId));
    await settle();
    harness.fireRetryTimers();
    await settle();
    assert.equal(harness.ownReadRequests().length, 0, "not while the end can still arrive");
    assert.equal(metrics(), bar.BAR_PROCESSING);
    harness.fireRetryTimers();
    await settleOwnRead();
    assert.deepEqual(captureSends(harness, id), ["dispatch:1", "end:3", "end:3", "end:3"]);
    // The bar waits on Processing for the read instead of No figures yet.
    assert.equal(metrics(), bar.BAR_PROCESSING);
    const requests = harness.ownReadRequests();
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0]!.message, {
      channel: ownReadModule.OWN_READ_CHANNEL,
      site: "claude",
      conversationId,
    });
    // The page world hands the saved chat to the history reader, which counts the reply.
    const read = await postClaudeImport(harness, conversationId, 803);
    read.start();
    assert.deepEqual(await read.send("batch"), { accepted: true });
    requests[0]!.ports[0]!.postMessage({ outcome: { kind: "read" } });
    assert.deepEqual(await read.send("finish"), { accepted: true });
    for (let i = 0; i < 40 && !/Req 2/.test(metrics()); i++) await settleOwnRead(1);
    assert.match(metrics(), /^Req 2 · In\/Out tokens/);
    // Another lost reply in the same visit is not read again (one read per navigation).
    const again = "00000000-0000-4000-8000-000000000d43";
    harness.postThreadHistory(deliveryFrame("claude", again, "dispatch", conversationId));
    harness.postThreadHistory(deliveryFrame("claude", again, "end", conversationId));
    await settle();
    harness.fireRetryTimers();
    await settle();
    harness.fireRetryTimers();
    await settleOwnRead();
    assert.equal(harness.ownReadRequests().length, 1);
  } finally {
    harness.close();
  }
});

test("capture delivery: a reply whose dispatch could not be delivered is read once its end arrives", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000d51";
  const { harness } = await claudeLiveHarness(conversationId, (message) =>
    message.payload.event === "dispatch"
      ? { ok: false, code: "ledger_integrity_failed" }
      : { ok: true },
  );
  try {
    const id = "00000000-0000-4000-8000-000000000d52";
    harness.postThreadHistory(deliveryFrame("claude", id, "dispatch", conversationId));
    await settle();
    harness.fireRetryTimers();
    await settle();
    harness.fireRetryTimers();
    await settleOwnRead();
    // The reply is still running, so its saved copy would not have it yet.
    assert.equal(harness.ownReadRequests().length, 0);
    harness.postThreadHistory(deliveryFrame("claude", id, "end", conversationId));
    await settleOwnRead();
    assert.deepEqual(captureSends(harness, id), [
      "dispatch:1",
      "dispatch:1",
      "dispatch:1",
      "end:3",
    ]);
    assert.equal(harness.ownReadRequests().length, 1);
  } finally {
    harness.close();
  }
});

test("capture delivery: a refused reply and a reply delivered on a later try are not read from saved history", async () => {
  const conversationId = "00000000-0000-4000-8000-000000000d61";
  const sends = new Map<string, number>();
  const refused = "00000000-0000-4000-8000-000000000d62";
  const { harness } = await claudeLiveHarness(conversationId, (message) => {
    const count = (sends.get(message.payload.id) ?? 0) + 1;
    sends.set(message.payload.id, count);
    if (message.payload.id === refused)
      return message.payload.event === "end"
        ? { ok: false, code: "payload_rejected" }
        : { ok: true };
    return count === 2 ? { ok: false, code: "storage_write_failed" } : { ok: true };
  });
  try {
    harness.postThreadHistory(deliveryFrame("claude", refused, "dispatch", conversationId));
    harness.postThreadHistory(deliveryFrame("claude", refused, "end", conversationId));
    await settleOwnRead();
    assert.equal(harness.pendingRetryTimers(), 0);
    assert.equal(harness.ownReadRequests().length, 0);
    const recovered = "00000000-0000-4000-8000-000000000d63";
    harness.postThreadHistory(deliveryFrame("claude", recovered, "dispatch", conversationId));
    await settle();
    harness.postThreadHistory(deliveryFrame("claude", recovered, "end", conversationId));
    await settle();
    harness.fireRetryTimers();
    await settleOwnRead();
    assert.deepEqual(captureSends(harness, recovered), ["dispatch:1", "end:3", "end:3"]);
    assert.equal(harness.ownReadRequests().length, 0);
  } finally {
    harness.close();
  }
});

// The long-chat tip by requests (owner decision of 16 October 2026): it shows once the chat's
// Req reaches the limit, names the count, and its cross closes it for that chat for good.
function tipHarness(url: string, closed: Set<string>, asked: any[]) {
  return contentHarness(false, {
    url,
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    respondTip: (message) => {
      // A plain copy: the message comes from the page's realm, which deepEqual tells apart.
      asked.push(JSON.parse(JSON.stringify(message)));
      if (message.action === "close") closed.add(message.conversationId);
      return { closed: closed.has(message.conversationId), snoozedUntil: null };
    },
  });
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("conductor: the long-chat tip shows from the request limit, names the requests and its cross closes it for good", async () => {
  const chat = "00000000-0000-4000-8000-000000000a61";
  const closed = new Set<string>();
  const asked: any[] = [];
  const harness = await tipHarness(`https://chatgpt.com/c/${chat}`, closed, asked);
  try {
    harness.render(null, { requestCount: 49, tipRequestLimit: 50 });
    await tick();
    const advice = harness.adviceShadow();
    const notice = advice.querySelector<HTMLElement>(".notice")!;
    assert.equal(notice.hidden, true, "below the limit there is no tip");
    assert.equal(asked.length, 0, "nothing is asked before a trigger is met");

    const shadow = harness.render(null, { requestCount: 50, tipRequestLimit: 50 });
    assert.equal(notice.hidden, true, "hidden until the chat's closed state is known");
    await tick();
    assert.equal(notice.hidden, false, "at exactly the limit the tip shows");
    assert.equal(
      notice.querySelector("span")!.textContent,
      "Long chat (50 requests) · for a new topic, consider a fresh conversation.",
    );
    assert.doesNotMatch(notice.textContent!, /—/);
    assert.deepEqual(asked, [{ target: "long-chat-tip", conversationId: chat }]);

    const cross = advice.querySelector<HTMLButtonElement>("[data-dismiss]")!;
    assert.equal(cross.tagName, "BUTTON");
    assert.equal(cross.type, "button");
    assert.equal(cross.getAttribute("aria-label"), "Close tip");
    assert.equal(cross.hasAttribute("tabindex"), false, "reachable with the keyboard");
    // Nothing the person does on the cross reaches the site's own handlers.
    const host = harness.document.querySelector('[data-ai-footprint="context-advice"]')!;
    const reached: string[] = [];
    const types = ["pointerdown", "mousedown", "mouseup", "click", "keydown", "keyup"];
    for (const type of types) {
      host.addEventListener(type, () => reached.push("host " + type));
      harness.document.addEventListener(type, () => reached.push("document " + type));
    }
    const window = harness.window;
    cross.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
    cross.dispatchEvent(new window.KeyboardEvent("keyup", { key: "Enter", bubbles: true, composed: true }));
    cross.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, composed: true }));
    cross.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, composed: true }));
    cross.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true, composed: true }));
    cross.focus();
    cross.click();
    assert.deepEqual(reached, []);
    assert.equal(notice.hidden, true, "one click closes it");
    assert.ok(
      shadow.activeElement === shadow.querySelector("[data-open]"),
      "keyboard focus moves to the bar's Details",
    );
    await tick();
    assert.deepEqual(asked.at(-1), { target: "long-chat-tip", conversationId: chat, action: "close" });

    harness.render(null, { requestCount: 60, tipRequestLimit: 50 });
    await tick();
    assert.equal(notice.hidden, true, "the closed tip stays closed for this chat");
  } finally {
    harness.close();
  }
});

test("conductor: a closed tip stays closed after a reload, other chats still show theirs, and a scope change asks again", async () => {
  const first = "00000000-0000-4000-8000-000000000a62";
  const second = "00000000-0000-4000-8000-000000000a63";
  const closed = new Set([first]);
  const asked: any[] = [];
  const harness = await tipHarness(`https://chatgpt.com/c/${first}`, closed, asked);
  try {
    harness.render(null, { requestCount: 80, tipRequestLimit: 50 });
    const notice = harness.adviceShadow().querySelector<HTMLElement>(".notice")!;
    assert.equal(notice.hidden, true, "no flash before the closed state arrives");
    await tick();
    assert.equal(notice.hidden, true, "closed in an earlier visit");

    await harness.navigate(`/c/${second}`);
    harness.render(null, { requestCount: 50, tipRequestLimit: 50 });
    await tick();
    assert.equal(notice.hidden, false, "another chat shows its tip");

    // An erase or another scope has its own closed tips, so the page asks again.
    const before = asked.length;
    closed.add(second);
    harness.deliver({ target: "footprint-scope-changed" });
    await tick();
    harness.render(null, { requestCount: 50, tipRequestLimit: 50 });
    await tick();
    assert.equal(asked.length, before + 1);
    assert.equal(notice.hidden, true);
  } finally {
    harness.close();
  }
});

test("conductor: the tip follows only switched-on triggers and keeps the token wording", async () => {
  const chat = "00000000-0000-4000-8000-000000000a64";
  const harness = await tipHarness(`https://chatgpt.com/c/${chat}`, new Set(), []);
  try {
    harness.render(null, { requestCount: 500, tipRequestLimit: null });
    await tick();
    const notice = harness.adviceShadow().querySelector<HTMLElement>(".notice")!;
    assert.equal(notice.hidden, true, "Requests off: no tip at any count");
    harness.render(null, { requestCount: 500 });
    await tick();
    assert.equal(notice.hidden, true, "a display without the field has no request trigger");
    harness.render(null, { requestCount: 3, tipRequestLimit: 50, guidanceShow: true });
    await tick();
    assert.equal(notice.hidden, false, "the token trigger alone shows it");
    assert.equal(
      notice.querySelector("span")!.textContent,
      "Long chat · for a new topic, consider a fresh conversation.",
    );
    harness.render(null, { requestCount: 1, tipRequestLimit: 1 });
    await tick();
    assert.equal(
      notice.querySelector("span")!.textContent,
      "Long chat (1 request) · for a new topic, consider a fresh conversation.",
    );
  } finally {
    harness.close();
  }
});

// The agreement before tracking (owner decisions of 17 and 18 Oct 2026, lib/tracking-consent.ts):
// before the person agrees the bar shows only Tracking is off with Set up, and nothing the page
// world observed reaches the background; agreeing in another tab restores the bar without a reload.
async function consentHarness(state: { consent: "agreed" | "required"; organization: string | null }) {
  const chat = "00000000-0000-4000-8000-000000000c01";
  const harness = await contentHarness(false, {
    url: `https://chatgpt.com/c/${chat}`,
    respond: async () => ({ code: "partial_capture" }),
    respondTrackingState: () => ({ ...state }),
  });
  const shadow = await harness.loadRoute();
  for (let i = 0; i < 5; i++) await tick();
  return { harness, shadow, chat };
}

test("conductor: before the person agrees the bar shows only Tracking is off with Set up and passes nothing on", async () => {
  const state = { consent: "required" as const, organization: null };
  const { harness, shadow, chat } = await consentHarness(state);
  try {
    assert.ok(harness.calls.some((m: any) => m?.target === "tracking-state" && Object.keys(m).length === 1));
    assert.equal(shadow.querySelector("[data-metrics]")!.textContent, bar.BAR_TRACKING_OFF);
    const setUp = shadow.querySelector<HTMLAnchorElement>("[data-setup]")!;
    assert.equal(setUp.hidden, false);
    assert.equal(setUp.textContent, "Set up");
    assert.equal(shadow.querySelector<HTMLElement>("a[data-open]")!.hidden, true, "no Details control");
    assert.equal(barState(shadow), "");
    // A live reply and a history read the page world reports are not passed on.
    harness.render(null, { requestCount: 2 });
    harness.postHistorical({
      channel: historyCapture.HISTORY_CAPTURE_CHANNEL,
      event: "start",
      id: crypto.randomUUID(),
      site: "chatgpt",
      conversationId: chat,
      observedAt: new Date().toISOString(),
      page: null,
    });
    const channel = new MessageChannel();
    const answer = new Promise<unknown>((resolve) => {
      channel.port1.onmessage = (event) => resolve(event.data);
    });
    harness.postHistorical(
      {
        channel: providerHistoryMessage.PROVIDER_STREAM_CHANNEL,
        event: "progress",
        id: crypto.randomUUID(),
        site: "chatgpt",
        conversationId: chat,
        observedAt: new Date().toISOString(),
        rows: null,
        meta: null,
      },
      [channel.port2],
    );
    // The page world's read is told at once that it was not taken, so it does not wait.
    assert.deepEqual(await answer, { accepted: false });
    for (let i = 0; i < 5; i++) await tick();
    for (const target of ["capture", "history-observation", "thread-history", "own-read-setting"])
      assert.equal(harness.calls.some((m: any) => m?.target === target), false, target);
    assert.equal(shadow.querySelector("[data-metrics]")!.textContent, bar.BAR_TRACKING_OFF, "a display does not replace it");
    assert.equal(harness.ownReadRequests().length, 0, "no own read");
    channel.port1.close();
    setUp.click();
    await tick();
    assert.ok(harness.calls.some((m: any) => m?.target === "open-welcome" && Object.keys(m).length === 1));
  } finally {
    harness.close();
  }
});

// QA of 19 Oct 2026: the bar could show Waiting for your request for a moment before Tracking is
// off, while the background had not answered yet. Before the agreement the first state the
// person sees must be Tracking is off with Set up.
for (const consent of ["required", "agreed"] as const)
  test(`conductor: no bar state shows before the background answers, then ${consent === "required" ? "Tracking is off with Set up" : "the usual state"}`, async () => {
    let answer!: (value: unknown) => void;
    const harness = await contentHarness(false, {
      url: "https://chatgpt.com/",
      respond: async () => ({ code: "partial_capture" }),
      respondTrackingState: () => new Promise((resolve) => (answer = resolve)),
    });
    try {
      const shadow = await harness.loadRoute();
      for (let i = 0; i < 5; i++) await tick();
      const row = shadow.querySelector<HTMLElement>(".bar")!;
      const metrics = shadow.querySelector("[data-metrics]")!;
      const shown = () => (row.hidden ? null : metrics.textContent);
      assert.equal(shown(), null, "nothing is shown while the answer is pending");
      answer({ consent, organization: null });
      for (let i = 0; i < 5; i++) await tick();
      if (consent === "required") {
        assert.equal(shown(), bar.BAR_TRACKING_OFF);
        assert.equal(shadow.querySelector<HTMLElement>("[data-setup]")!.hidden, false);
        assert.equal(shadow.querySelector<HTMLElement>("a[data-open]")!.hidden, true);
      } else {
        assert.equal(shown(), bar.BAR_WAITING);
        assert.equal(shadow.querySelector<HTMLElement>("[data-setup]")!.hidden, true);
      }
    } finally {
      harness.close();
    }
  });

test("conductor: agreeing in another tab brings back the bar and passes the next reply on, without a reload", async () => {
  const state: { consent: "agreed" | "required"; organization: string | null } = { consent: "required", organization: null };
  const { harness, shadow } = await consentHarness(state);
  try {
    assert.equal(shadow.querySelector("[data-metrics]")!.textContent, bar.BAR_TRACKING_OFF);
    state.consent = "agreed";
    harness.deliver({ target: "footprint-tracking-state" }, { id: "content-test-extension" });
    for (let i = 0; i < 5; i++) await tick();
    assert.notEqual(shadow.querySelector("[data-metrics]")!.textContent, bar.BAR_TRACKING_OFF);
    assert.equal(shadow.querySelector<HTMLElement>("[data-setup]")!.hidden, true);
    assert.equal(shadow.querySelector<HTMLElement>("a[data-open]")!.hidden, false, "Details is back");
    harness.render(null, { requestCount: 1 });
    await tick();
    assert.ok(harness.calls.some((m: any) => m?.target === "capture"), "the next reply is passed on");
    // Turning tracking off again in Settings brings back the off state.
    state.consent = "required";
    harness.deliver({ target: "footprint-tracking-state" }, { id: "content-test-extension" });
    for (let i = 0; i < 5; i++) await tick();
    assert.equal(shadow.querySelector("[data-metrics]")!.textContent, bar.BAR_TRACKING_OFF);
  } finally {
    harness.close();
  }
});

// Live QA of 19 Oct 2026: a reply arriving when tracking was turned off kept its partial
// figures after agreeing again, until a reload read the saved chat.
for (const arriving of [true, false])
  test(`conductor: agreeing again ${arriving ? "reads the open chat once when a reply was arriving at the withdrawal" : "reads nothing more when no reply was arriving"}`, async () => {
    const state: { consent: "agreed" | "required"; organization: string | null } = { consent: "agreed", organization: null };
    const { harness, chat } = await consentHarness(state);
    try {
      harness.setVisibility("visible");
      if (arriving) harness.render(null, { requestCount: 1, state: "generating" });
      await tick();
      state.consent = "required";
      harness.deliver({ target: "footprint-tracking-state" }, { id: "content-test-extension" });
      for (let i = 0; i < 5; i++) await tick();
      state.consent = "agreed";
      harness.deliver({ target: "footprint-tracking-state" }, { id: "content-test-extension" });
      for (let i = 0; i < 5; i++) await tick();
      await settleOwnRead(10);
      const requests = harness.ownReadRequests();
      if (!arriving) {
        assert.equal(requests.length, 0);
        return;
      }
      assert.equal(requests.length, 1);
      assert.deepEqual(requests[0]!.message, {
        channel: ownReadModule.OWN_READ_CHANNEL,
        site: "chatgpt",
        conversationId: chat,
        // The page's reads of the chat while tracking was off were refused (19 Oct 2026).
        uncounted: true,
      });
    } finally {
      harness.close();
    }
  });

// Live QA of 19 Oct 2026: whether a reply was arriving is decided when tracking is turned off.
// Decided only when the person agreed again, a reply silent by then for longer than any live
// capture runs no longer looked cut off, nothing was read and the bar kept its partial figures.
// Live QA of 19 Oct 2026 (14:51): tracking was agreed again while the cut-off Claude reply was
// still being written. The own read made then failed (Claude's answer could not be read), and
// claude.ai read the chat itself when the reply ended, so the figures were complete. Details
// still said "Earlier messages not read" until a reload. A failure nothing answered stays.
for (const pageReadAfter of [true, false])
  test(`conductor: a failed own read after agreeing again ${pageReadAfter ? "is not listed once the page's read of the chat was counted" : "stays listed when nothing counted the chat"}`, async () => {
    const chat = "00000000-0000-4000-8000-000000000c31";
    const state: { consent: "agreed" | "required"; organization: string | null } = { consent: "agreed", organization: null };
    const imported = { done: false };
    const harness = await contentHarness(false, {
      url: `https://claude.ai/chat/${chat}`,
      html: '<main><form><div class="ProseMirror" contenteditable="true" role="textbox"></div></form></main>',
      respond: () =>
        historicalRouteDisplay(
          historicalView(
            imported.done
              ? historicalSummary({ first_request_verified: true })
              : historicalSummary({
                  status: "empty",
                  prompt_count: "0",
                  response_count: "0",
                  tokens: [],
                  resources: [],
                }),
          ),
        ),
      respondHistory: (request) => {
        if (request.message.event === "finish") imported.done = true;
        return { accepted: true };
      },
      respondTrackingState: () => ({ ...state }),
      captureGraceTimers: true,
    });
    try {
      const shadow = await harness.loadRoute();
      for (let i = 0; i < 5; i++) await tick();
      harness.setVisibility("visible");
      harness.render(null, { requestCount: 1, state: "generating" });
      await tick();
      state.consent = "required";
      harness.deliver({ target: "footprint-tracking-state" }, { id: "content-test-extension" });
      for (let i = 0; i < 5; i++) await tick();
      state.consent = "agreed";
      harness.deliver({ target: "footprint-tracking-state" }, { id: "content-test-extension" });
      for (let i = 0; i < 5; i++) await tick();
      await settleOwnRead(10);
      const requests = harness.ownReadRequests();
      assert.equal(requests.length, 1);
      // The reply was still being written, so Claude's answer did not hold it yet.
      requests[0]!.ports[0]!.postMessage({ outcome: { kind: "invalid" } });
      await settleOwnRead(5);
      if (pageReadAfter) {
        // claude.ai reads the chat itself when the reply ends; tracking is on again.
        const read = await postClaudeImport(harness, chat, 3100);
        read.start();
        assert.deepEqual(await read.send("batch"), { accepted: true });
        assert.deepEqual(await read.send("finish"), { accepted: true });
        for (let i = 0; i < 20; i++) await settleOwnRead(1);
      }
      (shadow.querySelector("[data-open]") as HTMLElement).click();
      const body = shadow.querySelector("[data-body]")!.textContent!;
      if (pageReadAfter) {
        assert.doesNotMatch(body, /Earlier messages not read/);
        assert.doesNotMatch(body, /answer could not be read/);
      } else assert.match(body, /Claude's answer could not be read/);
    } finally {
      harness.close();
    }
  });

test("conductor: agreeing again long after the withdrawal still reads the open chat once for the reply it cut off", async () => {
  const state: { consent: "agreed" | "required"; organization: string | null } = { consent: "agreed", organization: null };
  const { harness, chat } = await consentHarness(state);
  const clock = harness.window.Date as unknown as { now: () => number };
  const realNow = clock.now.bind(clock);
  try {
    harness.setVisibility("visible");
    harness.render(null, { requestCount: 1, state: "generating" });
    await tick();
    state.consent = "required";
    harness.deliver({ target: "footprint-tracking-state" }, { id: "content-test-extension" });
    for (let i = 0; i < 5; i++) await tick();
    // The person agrees again an hour later; the cut-off reply sent nothing since.
    clock.now = () => realNow() + 60 * 60_000;
    state.consent = "agreed";
    harness.deliver({ target: "footprint-tracking-state" }, { id: "content-test-extension" });
    for (let i = 0; i < 5; i++) await tick();
    await settleOwnRead(10);
    const requests = harness.ownReadRequests();
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0]!.message, {
      channel: ownReadModule.OWN_READ_CHANNEL,
      site: "chatgpt",
      conversationId: chat,
      uncounted: true,
    });
  } finally {
    clock.now = realNow;
    harness.close();
  }
});

test("conductor: Details ends with one line saying the figures were calculated on this computer", async () => {
  const state: { consent: "agreed" | "required"; organization: string | null } = { consent: "agreed", organization: null };
  const { harness, shadow } = await consentHarness(state);
  try {
    harness.render(null, { requestCount: 1 });
    await tick();
    (shadow.querySelector("[data-open]") as HTMLElement).click();
    await tick();
    const line = shadow.querySelector<HTMLElement>("[data-local-line]")!;
    assert.equal(line.textContent, "Calculated on your computer. Nothing from this chat was sent to us.");
    assert.equal(line.querySelector("b")!.textContent, "Calculated on your computer.");
    assert.ok(line.closest(".panel"), "in Details, not on the bar");
    state.organization = "Example Consulting";
    harness.deliver({ target: "footprint-scope-changed" });
    for (let i = 0; i < 5; i++) await tick();
    harness.render(null, { requestCount: 1 });
    await tick();
    assert.equal(line.textContent, "Calculated on your computer. Only numbers are shared with Example Consulting.");
  } finally {
    harness.close();
  }
});

test("conductor: the agreement is asked once and kept, not once per captured frame", async () => {
  const state: { consent: "agreed" | "required"; organization: string | null } = { consent: "agreed", organization: null };
  const { harness } = await consentHarness(state);
  try {
    const asked = () => harness.calls.filter((m: any) => m?.target === "tracking-state").length;
    assert.equal(asked(), 1);
    for (let reply = 1; reply <= 6; reply++) {
      harness.render(null, { requestCount: reply });
      await tick();
    }
    assert.ok(harness.calls.filter((m: any) => m?.target === "capture").length >= 6, "every frame is passed on");
    assert.equal(asked(), 1, "no round trip per frame");
    // Only a change notice, or a scope change, asks again.
    harness.deliver({ target: "footprint-tracking-state" }, { id: "content-test-extension" });
    await tick();
    assert.equal(asked(), 2);
  } finally {
    harness.close();
  }
});

test("conductor: an erase or scope change while tracking is off keeps Tracking is off", async () => {
  const state: { consent: "agreed" | "required"; organization: string | null } = { consent: "required", organization: null };
  const { harness, shadow } = await consentHarness(state);
  try {
    assert.equal(shadow.querySelector("[data-metrics]")!.textContent, bar.BAR_TRACKING_OFF);
    // Erase local records and connecting both send the scope change to open tabs.
    harness.deliver({ target: "footprint-scope-changed" });
    for (let i = 0; i < 5; i++) await tick();
    assert.equal(shadow.querySelector("[data-metrics]")!.textContent, bar.BAR_TRACKING_OFF);
    assert.equal(shadow.querySelector<HTMLElement>("[data-setup]")!.hidden, false);
    assert.equal(shadow.querySelector<HTMLElement>("a[data-open]")!.hidden, true);
    harness.render(null, { requestCount: 1 });
    await tick();
    assert.equal(harness.calls.some((m: any) => m?.target === "capture"), false, "still nothing passed on");
    assert.equal(harness.ownReadRequests().length, 0);
  } finally {
    harness.close();
  }
});

// Live, 21 Oct 2026: with tracking paused in Settings, a ChatGPT reply showed Processing for about
// 30 s, then No figures yet. Nothing was recorded, which is right, but Processing says the tracker
// is counting. While paused the bar shows what it shows for a chat with nothing counted: the
// chat's earlier figures, Waiting for your request or No figures yet, and Details says why.
type PauseState = { consent: "agreed"; organization: null; paused: boolean };
async function pauseHarness(state: PauseState, url = "https://chatgpt.com/") {
  const harness = await contentHarness(false, {
    url,
    respond: () => ({ error: "Recorded conversation totals are unavailable." }),
    respondTrackingState: () => ({ ...state }),
    captureGraceTimers: true,
  });
  const shadow = await harness.loadRoute();
  for (let i = 0; i < 5; i++) await tick();
  const metrics = () => shadow.querySelector("[data-metrics]")!.textContent!;
  const changed = async () => {
    harness.deliver({ target: "footprint-tracking-state" }, { id: "content-test-extension" });
    for (let i = 0; i < 5; i++) await tick();
  };
  const reply = async (id: string, end = true) => {
    harness.postThreadHistory(requestFrame("chatgpt", id, "dispatch", 1));
    await settle();
    harness.postThreadHistory(requestFrame("chatgpt", id, "progress", 2));
    await settle();
    if (end) {
      harness.postThreadHistory(requestFrame("chatgpt", id, "end", 3));
      await settle();
    }
  };
  const details = () => {
    const open = shadow.querySelector<HTMLElement>("[data-open]")!;
    if (open.getAttribute("aria-expanded") !== "true") open.click();
    return shadow.querySelector("[data-body]")!.textContent!;
  };
  return { harness, shadow, metrics, changed, reply, details };
}

test("bar while paused: a reply never shows Processing, ends on No figures yet, and Details says tracking is paused", async () => {
  const { harness, shadow, metrics, reply, details } = await pauseHarness({
    consent: "agreed",
    organization: null,
    paused: true,
  });
  try {
    assert.equal(metrics(), bar.BAR_WAITING);
    const texts = barTexts(shadow, harness.window as unknown as Window);
    await reply("00000000-0000-4000-8000-000000000d01");
    await texts.flush();
    texts.stop();
    assert.equal(metrics(), bar.BAR_NO_FIGURES);
    assert.deepEqual(texts.seen, [bar.BAR_WAITING, bar.BAR_NO_FIGURES], "never Processing");
    const body = details();
    assert.match(body, /Tracking paused/);
    assert.match(body, /Tracking is paused, so nothing sent in this chat while it is paused is counted/);
    assert.doesNotMatch(body, /A request sent here, or the chat's saved messages once the tracker reads them, will be counted/);
  } finally {
    harness.close();
  }
});

test("bar while paused: resuming shows Processing then figures for the next reply at once", async () => {
  const state: PauseState = { consent: "agreed", organization: null, paused: true };
  const { harness, shadow, metrics, changed, reply, details } = await pauseHarness(state);
  try {
    await reply("00000000-0000-4000-8000-000000000d02");
    assert.equal(metrics(), bar.BAR_NO_FIGURES);
    state.paused = false;
    await changed();
    // The reply sent while paused was not recorded, so nothing waits for its figures.
    assert.equal(metrics(), bar.BAR_NO_FIGURES);
    assert.doesNotMatch(details(), /Tracking paused/);
    const texts = barTexts(shadow, harness.window as unknown as Window);
    const id = "00000000-0000-4000-8000-000000000d03";
    harness.postThreadHistory(requestFrame("chatgpt", id, "dispatch", 1));
    await settle();
    await texts.flush();
    assert.equal(metrics(), bar.BAR_PROCESSING);
    const binding = harness.currentCaptureBinding();
    assert.equal(binding.captureId, id);
    harness.postThreadHistory(requestFrame("chatgpt", id, "end", 2));
    await settle();
    assert.equal(metrics(), bar.BAR_PROCESSING);
    harness.deliverDisplay(binding, null, "1", { state: "completed", input: "16", output: "14" });
    await texts.flush();
    texts.stop();
    assert.match(metrics(), /^Req 1 · In\/Out tokens - ≈ 16\/14 /);
    assert.deepEqual(figuresOnly(texts.seen), [bar.BAR_NO_FIGURES, bar.BAR_PROCESSING, "figures"]);
  } finally {
    harness.close();
  }
});

test("bar while paused: a chat with figures keeps them through a reply sent while paused", async () => {
  const state: PauseState = { consent: "agreed", organization: null, paused: false };
  const { harness, shadow, metrics, changed, reply, details } = await pauseHarness(state);
  try {
    const first = "00000000-0000-4000-8000-000000000d04";
    await reply(first);
    harness.deliverDisplay(harness.currentCaptureBinding(), null, "1", {
      state: "completed",
      input: "16",
      output: "14",
    });
    await settle();
    assert.match(metrics(), /^Req 1 · In\/Out tokens - ≈ 16\/14 /);
    const before = metrics();
    state.paused = true;
    await changed();
    const texts = barTexts(shadow, harness.window as unknown as Window);
    await reply("00000000-0000-4000-8000-000000000d05");
    await texts.flush();
    texts.stop();
    assert.deepEqual(texts.seen, [before], "the earlier figures stay, never Processing");
    assert.match(details(), /Tracking is paused/);
  } finally {
    harness.close();
  }
});

test("bar while paused: pausing while a reply arrives leaves Processing at once", async () => {
  const state: PauseState = { consent: "agreed", organization: null, paused: false };
  const { harness, metrics, changed, reply } = await pauseHarness(state);
  try {
    await reply("00000000-0000-4000-8000-000000000d06", false);
    assert.equal(metrics(), bar.BAR_PROCESSING);
    state.paused = true;
    await changed();
    assert.equal(metrics(), bar.BAR_NO_FIGURES);
  } finally {
    harness.close();
  }
});

test("bar while paused: an opened chat shows No figures yet, not Processing for a history read that is not counted", async () => {
  const chat = "00000000-0000-4000-8000-000000000d07";
  const { harness, metrics, details } = await pauseHarness(
    { consent: "agreed", organization: null, paused: true },
    `https://chatgpt.com/c/${chat}`,
  );
  try {
    // The grace period for the page's read of the chat is still running (captureGraceTimers).
    assert.equal(metrics(), bar.BAR_NO_FIGURES);
    assert.match(details(), /Tracking is paused/);
    harness.fireGraceTimers();
    await settle();
    assert.equal(metrics(), bar.BAR_NO_FIGURES);
  } finally {
    harness.close();
  }
});

test("bar while not paused: an opened chat still shows Processing while its history read may come", async () => {
  const chat = "00000000-0000-4000-8000-000000000d08";
  const { harness, metrics, details } = await pauseHarness(
    { consent: "agreed", organization: null, paused: false },
    `https://chatgpt.com/c/${chat}`,
  );
  try {
    assert.equal(metrics(), bar.BAR_PROCESSING);
    assert.doesNotMatch(details(), /Tracking paused/);
    harness.fireGraceTimers();
    await settle();
    assert.equal(metrics(), bar.BAR_NO_FIGURES);
  } finally {
    harness.close();
  }
});
