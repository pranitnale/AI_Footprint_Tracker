import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { JSDOM } from "jsdom";
import * as core from "@footprint/capture-core";
import * as adapters from "@footprint/adapters";
import { parseDispatch, GeminiSession } from "@footprint/adapters";
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
import * as historyAdmission from "../lib/history-admission";
import { RouteAuthorities, type RouteGuard } from "../lib/route-authority";
import * as health from "../lib/health";
import { PACKAGED_COUNTING_RUNTIME } from "../lib/counting-config";
import * as fileOfferBridge from "../lib/file-offer-bridge";
import * as fileRelayProtocol from "../lib/file-relay-protocol";
import * as detailsOverview from "../lib/details-overview";
import * as ownRead from "../lib/own-read";
import * as chatgptReadProgress from "../lib/chatgpt-read-progress";
import * as ownReadPause from "../lib/own-read-pause";
import * as ownReadSettings from "../lib/own-read-settings";
import * as trackingConsent from "../lib/tracking-consent";
import * as longChatTip from "../lib/long-chat-tip";
import * as captureDelivery from "../lib/capture-delivery";
import * as fileGrantBroker from "../lib/file-grant-broker";
import { SummaryAccumulator } from "../lib/summary-scan";
const relation = JSON.parse(
  readFileSync(
    new URL(
      "../../../fixtures/provider-identity-2026-09-10.json",
      import.meta.url,
    ),
    "utf8",
  ),
).gemini;

test("verified Gemini route matches minimized history relation and existing dispatch/response identity", () => {
  const route = core.parseConversationRoute("gemini", relation.route)!;
  assert.equal(relation.rpc_id, "hNvQHb");
  assert.equal(relation.conversation_argument_index, 0);
  assert.equal(route.conversationId, relation.conversation_argument);
  const inner = [
    ["Synthetic relation input"],
    null,
    [relation.conversation_argument, "r_synthetic"],
  ];
  const body = new URLSearchParams({
    "f.req": JSON.stringify([null, JSON.stringify(inner)]),
  }).toString();
  const dispatch = parseDispatch(
    "gemini",
    new URL(
      "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate",
    ),
    body,
  );
  assert.equal(dispatch.conversationId, route.conversationId);
  const session = new GeminiSession();
  session.gemini([
    [
      "wrb.fr",
      null,
      JSON.stringify([
        null,
        [relation.conversation_argument, "r_synthetic"],
        null,
        null,
        [["rc_synthetic", ["Synthetic relation answer"]]],
      ]),
    ],
  ]);
  assert.equal(session.snapshot().conversationId, route.conversationId);
  assert.deepEqual(
    core.parseConversationRoute(
      "perplexity",
      "/search/00000000-0000-4000-8000-000000000001",
    ),
    {
      site: "perplexity",
      conversationId: "00000000-0000-4000-8000-000000000001",
    },
  );
});

test("shared route parser rejects unverified shapes without alternate ID aliases", () => {
  for (const path of [
    "/app/0123456789abcde",
    "/app/0123456789abcdef0",
    "/app/0123456789ABCDEF",
    "/app/c_0123456789abcdef",
    "/app/0123456789abcdef/",
    "/app/%30%31%32%33%34%35%36%37%38%39abcdef",
    "/app/../../app/0123456789abcdef",
    "/app/0123456789abcdef?x=1",
  ])
    assert.equal(core.parseConversationRoute("gemini", path), null, path);
  for (const site of ["chatgpt", "claude"] as const) {
    const prefix = site === "chatgpt" ? "c" : "chat";
    assert.equal(
      core.parseConversationRoute(site, `/${prefix}/${"-".repeat(36)}`),
      null,
    );
    assert.ok(
      core.parseConversationRoute(
        site,
        `/${prefix}/00000000-0000-4000-8000-000000000001`,
      ),
    );
  }
  assert.equal(core.isRouteConversationId("gemini", "0123456789abcdef"), false);
});

function backgroundHarness(
  openTabs: any[] = [],
  duringQuery: () => void = () => {},
) {
  let listener: any;
  const calls: any[] = [];
  const historyCalls: any[] = [];
  const historyInvalidations: any[] = [];
  let permission = true;
  let committed: any, currentTab: any;
  let confirm = async () => ({ current: true });
  let updated: (tabId: number, change: any) => void;
  let summaryWait = async () => {};
  let beforeWork = () => {};
  class BoundaryRoutes extends RouteAuthorities {
    override run<T>(
      sender: Parameters<RouteAuthorities["run"]>[0],
      binding: Parameters<RouteAuthorities["run"]>[1],
      site: Parameters<RouteAuthorities["run"]>[2],
      conversationId: Parameters<RouteAuthorities["run"]>[3],
      work: (
        guard: RouteGuard,
        currentSender: Parameters<RouteAuthorities["run"]>[0],
      ) => Promise<T>,
    ): Promise<T> {
      return super.run(
        sender,
        binding,
        site,
        conversationId,
        (guard, currentSender) => {
          beforeWork();
          return work(guard, currentSender);
        },
      );
    }
  }
  const historyPages: any[] = [];
  const threadRoutes: any[] = [];
  const tabAddresses: any[] = [];
  const browser: any = {
    runtime: {
      id: "route-extension",
      getURL: (p: string) =>
        "chrome-extension://route-extension/" + p.replace(/^\//, ""),
      onMessage: { addListener: (f: any) => (listener = f) },
    },
    permissions: {
      contains: async () => permission,
      onRemoved: { addListener() {} },
    },
    alarms: { onAlarm: { addListener() {} } },
    tabs: {
      onRemoved: { addListener() {} },
      onUpdated: {
        addListener(fn: typeof updated) {
          updated = fn;
        },
      },
      get: async () => committed ?? currentTab,
      query: async () => {
        duringQuery();
        return openTabs;
      },
      sendMessage: async () => confirm(),
    },
  };
  class Coordinator {
    history = {
      receive: async (message: any, binding: any, sender: any, guard: any) => {
        await guard.verify();
        historyPages.push({ message, binding, sender });
        return { accepted: true };
      },
      invalidate() {},
    };
    invalidateDisplay() {}
    threads = {
      receive: async (payload: any, binding: any, sender: any) => {
        historyCalls.push({ payload, binding, sender });
        return { observed: payload.event === "page" };
      },
      invalidate: (tabId: number, documentNonce?: string) => {
        historyInvalidations.push({ tabId, documentNonce });
      },
      invalidateAll() {},
    };
    async whenReady() {}
    async noteThreadRoute(...args: any[]) {
      threadRoutes.push(args);
    }
    noteTabAddress(...args: any[]) {
      tabAddresses.push(args);
    }
    async routeSummary(site: string, id: string, binding: any) {
      calls.push([site, id]);
      await summaryWait();
      return {
        target: "footprint-display",
        displayBinding: binding,
        conversationIdentity: { site, conversationId: id },
      };
    }
  }
  const imports: any = {
    "wxt/utils/define-background": { defineBackground: (f: any) => f() },
    "wxt/browser": { browser },
    "../lib/counting-config": { PACKAGED_COUNTING_RUNTIME },
    "@footprint/ledger": {
      Ledger: {
        open: async () => ({
          onRoutingChange: () => () => {},
          onHealthFailure() {},
        }),
      },
    },
    "../lib/server-summary": {},
    "../lib/scope-notifications": {
      observeScopeChanges: async () => ({}),
      observeThreadInvalidations: async () => ({}),
    },
    "../lib/coordinator": { Coordinator },
    "../lib/platform": { scheduleSync: async () => {} },
    "@footprint/file-text/types": {},
    "../lib/company": {},
    "../lib/health": health,
    "../lib/ownership": {},
    "../lib/own-read-pause": ownReadPause,
    "../lib/own-read-settings": ownReadSettings,
    "../lib/tracking-consent": trackingConsent,
    "@footprint/capture-core": core,
    "@footprint/adapters": adapters,
    "../lib/history-limits": historyLimits,
    "../lib/history-admission": historyAdmission,
    "../lib/route-authority": { RouteAuthorities: BoundaryRoutes },
    "../lib/bridge": bridge,
    "../lib/file-grant-broker": fileGrantBroker,
    "../lib/file-relay-protocol": fileRelayProtocol,
    "../lib/details-overview": detailsOverview,
  };
  const source = readFileSync(
    new URL("../entrypoints/background.ts", import.meta.url),
    "utf8",
  ).replaceAll("import.meta.env.BROWSER", '"chrome"');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  new Function("require", "exports", "globalThis", compiled)(
    (name: string) => {
      assert.ok(name in imports, name);
      return imports[name];
    },
    {},
    { addEventListener() {} },
  );
  return {
    calls,
    historyCalls,
    historyInvalidations,
    historyPages,
    threadRoutes,
    tabAddresses,
    setTab: (tab: any) => {
      committed = tab;
    },
    setConfirm: (fn: typeof confirm) => {
      confirm = fn;
    },
    setSummaryWait: (fn: typeof summaryWait) => {
      summaryWait = fn;
    },
    setBeforeWork: (fn: typeof beforeWork) => {
      beforeWork = fn;
    },
    navigate: (tab: any) => {
      committed = tab;
      updated(tab.id, { url: tab.url });
    },
    send: (body: any, sender: any) => {
      currentTab = { id: sender.tab?.id, url: sender.url };
      return listener(body, sender);
    },
    deny: () => (permission = false),
  };
}
for (const changed of [false, true]) {
  test(`summary read boundary ${changed ? "rejects a changed route" : "waits for a redundant native hint"}`, async () => {
    const h = backgroundHarness();
    const conversationId = crypto.randomUUID();
    const url = `https://claude.ai/chat/${conversationId}`;
    const binding = {
      documentNonce: crypto.randomUUID(),
      navigationNonce: crypto.randomUUID(),
      captureId: null,
    };
    const sender = {
      id: "route-extension",
      frameId: 0,
      documentId: "current-document",
      documentLifecycle: "active",
      tab: { id: 9 },
      url,
    };
    let release!: () => void;
    const proof = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.setBeforeWork(() => {
      h.setConfirm(async () => {
        await proof;
        return { current: true };
      });
      h.navigate({
        id: 9,
        url: changed ? `https://claude.ai/chat/${crypto.randomUUID()}` : url,
      });
      setTimeout(release, 5);
    });
    const result = await h.send(
      { target: "conversation-summary", binding, conversationId },
      sender,
    );
    if (changed) {
      assert.equal(result.code, "partial_capture");
      assert.equal(h.calls.length, 0);
    } else {
      assert.equal(result.target, "footprint-display");
      assert.equal(h.calls.length, 1);
    }
    // Only Perplexity threads take a reply sent from outside them.
    assert.equal(h.threadRoutes.length, 0);
  });
}

test("actual background accepts only ordered top-frame Perplexity history projections", async () => {
  const h = backgroundHarness();
  const threadId = "00000000-0000-4000-8000-000000000071";
  const id = "00000000-0000-4000-8000-000000000072";
  const binding = {
    documentNonce: "00000000-0000-4000-8000-000000000073",
    navigationNonce: "00000000-0000-4000-8000-000000000074",
    captureId: null,
  };
  const sender = {
    id: "route-extension",
    frameId: 0,
    tab: { id: 9 },
    url: `https://www.perplexity.ai/search/${threadId}`,
  };
  const start = {
    channel: adapters.THREAD_HISTORY_CHANNEL,
    event: "start",
    id,
    at: new Date().toISOString(),
    site: "perplexity",
    threadId,
    page: null,
  };
  const page = {
    ...start,
    event: "page",
    page: {
      requestIds: ["00000000-0000-4000-8000-000000000075"],
      hasNextPage: false,
    },
  };
  assert.deepEqual(
    await h.send({ target: "thread-history", binding, payload: start }, sender),
    { observed: false },
  );
  assert.deepEqual(
    await h.send({ target: "thread-history", binding, payload: page }, sender),
    { observed: true },
  );
  assert.equal(h.historyCalls.length, 2);
  await h.send({ target: "thread-history-invalidate", binding }, sender);
  assert.deepEqual(h.historyInvalidations, [
    { tabId: 9, documentNonce: binding.documentNonce },
  ]);
  assert.deepEqual(
    h.historyCalls.map((call) => call.payload.event),
    ["start", "page"],
  );
  for (const change of [{ frameId: 1 }, { id: "other-extension" }])
    assert.equal(
      await h.send(
        { target: "thread-history", binding, payload: start },
        { ...sender, ...change },
      ),
      undefined,
    );
  assert.equal(h.historyCalls.length, 2);
  h.deny();
  const deniedStart = {
    ...start,
    id: "00000000-0000-4000-8000-000000000076",
  };
  assert.deepEqual(
    await h.send(
      { target: "thread-history", binding, payload: deniedStart },
      sender,
    ),
    {
      error: "Recorded thread links are unavailable.",
      code: "history_unavailable",
    },
  );
  assert.equal(h.historyCalls.length, 2);
});

test("actual background resolves a cold SPA library document against the committed conversation for summaries and both history paths", async () => {
  const h = backgroundHarness(),
    conversationId = crypto.randomUUID();
  const binding = {
    documentNonce: crypto.randomUUID(),
    navigationNonce: crypto.randomUUID(),
    captureId: null,
  };
  const sender = {
    id: "route-extension",
    frameId: 0,
    documentId: "original-document",
    tab: { id: 9 },
    url: "https://www.perplexity.ai/library",
  };
  h.setTab({
    id: 9,
    url: `https://www.perplexity.ai/search/${conversationId}`,
    status: "loading",
  });
  assert.equal(
    (
      await h.send(
        { target: "conversation-summary", binding, conversationId },
        sender,
      )
    ).target,
    "footprint-display",
  );
  // The opened thread is noted for the tab and document that asked for its totals.
  assert.deepEqual(h.threadRoutes, [[9, "original-document", conversationId]]);
  const start = {
    channel: adapters.THREAD_HISTORY_CHANNEL,
    event: "start",
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    site: "perplexity",
    threadId: conversationId,
    page: null,
  };
  await h.send({ target: "thread-history", binding, payload: start }, sender);
  assert.equal(
    (
      await h.send(
        {
          target: "thread-history",
          binding,
          payload: {
            ...start,
            event: "page",
            page: { requestIds: [], hasNextPage: false },
          },
        },
        sender,
      )
    ).observed,
    true,
  );
  const historical = {
    channel: historyCapture.HISTORY_CAPTURE_CHANNEL,
    event: "start",
    id: crypto.randomUUID(),
    observedAt: new Date().toISOString(),
    site: "perplexity",
    conversationId,
    page: null,
  };
  assert.equal(
    (
      await h.send(
        { target: "history-observation", binding, message: historical },
        sender,
      )
    ).accepted,
    true,
  );
  assert.equal(
    (
      await h.send(
        {
          target: "history-observation",
          binding,
          message: { ...historical, event: "page", page: { messages: [] } },
        },
        sender,
      )
    ).accepted,
    true,
  );
  assert.equal(h.historyCalls.length, 2);
  assert.equal(h.historyPages.length, 2);
  assert.equal(h.historyPages[0].sender.documentId, "original-document");
  assert.equal(
    h.historyPages[0].sender.url,
    `https://www.perplexity.ai/search/${conversationId}`,
  );
});

test("actual background rejects foreign, pending, stale-document and mismatched committed routes before reading history or totals", async () => {
  for (const variant of [
    "origin",
    "tab",
    "frame",
    "extension",
    "pending",
    "route",
    "document",
    "lifecycle",
    "permission",
  ] as const) {
    const h = backgroundHarness(),
      conversationId = crypto.randomUUID();
    const binding = {
      documentNonce: crypto.randomUUID(),
      navigationNonce: crypto.randomUUID(),
      captureId: null,
    };
    const sender: any = {
      id: "route-extension",
      frameId: 0,
      tab: { id: 9 },
      url: "https://www.perplexity.ai/library",
    };
    const tab: any = {
      id: 9,
      url: `https://www.perplexity.ai/search/${conversationId}`,
    };
    if (variant === "origin")
      tab.url = `https://claude.ai/chat/${conversationId}`;
    if (variant === "tab") tab.id = 10;
    if (variant === "frame") sender.frameId = 1;
    if (variant === "extension") sender.id = "foreign";
    if (variant === "pending") tab.pendingUrl = tab.url;
    if (variant === "route")
      tab.url = `https://www.perplexity.ai/search/${crypto.randomUUID()}`;
    if (variant === "document") h.setConfirm(async () => ({ current: false }));
    if (variant === "lifecycle") sender.documentLifecycle = "cached";
    if (variant === "permission") h.deny();
    h.setTab(tab);
    await h.send(
      { target: "conversation-summary", binding, conversationId },
      sender,
    );
    await h.send(
      {
        target: "thread-history",
        binding,
        payload: {
          channel: adapters.THREAD_HISTORY_CHANNEL,
          event: "start",
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          site: "perplexity",
          threadId: conversationId,
          page: null,
        },
      },
      sender,
    );
    await h.send(
      {
        target: "history-observation",
        binding,
        message: { site: "perplexity", conversationId },
      },
      sender,
    );
    assert.equal(h.calls.length, 0, variant);
    assert.equal(h.historyCalls.length, 0, variant);
    assert.equal(h.historyPages.length, 0, variant);
  }
});

test("actual background rejects navigation during route verification and away-and-back summary reads", async () => {
  for (const during of ["verify", "summary"]) {
    const h = backgroundHarness(),
      conversationId = crypto.randomUUID();
    const binding = {
      documentNonce: crypto.randomUUID(),
      navigationNonce: crypto.randomUUID(),
      captureId: null,
    };
    const sender = {
      id: "route-extension",
      frameId: 0,
      tab: { id: 9 },
      url: "https://www.perplexity.ai/library",
    };
    const tab = {
      id: 9,
      url: `https://www.perplexity.ai/search/${conversationId}`,
    };
    h.setTab(tab);
    const navigate = () => {
      h.navigate({ id: 9, url: "https://www.perplexity.ai/library" });
      h.navigate(tab);
    };
    if (during === "verify")
      h.setConfirm(async () => {
        navigate();
        return { current: true };
      });
    else
      h.setSummaryWait(async () => {
        navigate();
      });
    const result = await h.send(
      { target: "conversation-summary", binding, conversationId },
      sender,
    );
    assert.equal(result.code, "partial_capture");
    assert.equal(result.target, undefined);
    assert.equal(h.calls.length, during === "verify" ? 0 : 1);
  }
});
test("actual background binds Gemini conversation query to exact top-frame sender route and site permission", async () => {
  const h = backgroundHarness();
  const body = {
    target: "conversation-summary",
    conversationId: relation.conversation_argument,
    binding: {
      documentNonce: "00000000-0000-4000-8000-000000000010",
      navigationNonce: "00000000-0000-4000-8000-000000000011",
      captureId: null,
    },
  };
  const sender = {
    id: "route-extension",
    frameId: 0,
    tab: { id: 4 },
    url: "https://gemini.google.com" + relation.route,
  };
  assert.equal((await h.send(body, sender)).target, "footprint-display");
  assert.deepEqual(h.calls, [["gemini", relation.conversation_argument]]);
  for (const change of [
    { conversationId: "c_fedcba9876543210" },
    { conversationId: "0123456789abcdef" },
    { company_id: "injected" },
  ])
    await h.send({ ...body, ...change }, sender);
  for (const change of [
    { id: "other-extension" },
    { frameId: 1 },
    { tab: undefined },
    { url: "http://gemini.google.com" + relation.route },
    { url: "https://gemini.google.com:444" + relation.route },
    { url: "https://gemini.google.com.evil.invalid" + relation.route },
    { url: "https://gemini.google.com/app/fedcba9876543210" },
    { url: "https://user:password@gemini.google.com" + relation.route },
    { url: "https://gemini.google.com/app/" },
  ])
    await h.send(body, { ...sender, ...change });
  assert.equal(h.calls.length, 1);
  h.deny();
  assert.ok((await h.send(body, sender)).error);
  assert.equal(h.calls.length, 1);
});

test("actual Gemini content route reopening only queries saved usage and discards stale navigation response", async () => {
  const dom = new JSDOM(
    '<main><form><rich-textarea><div contenteditable="true"></div></rich-textarea></form></main>',
    {
      url: "https://gemini.google.com" + relation.route,
      runScripts: "outside-only",
    },
  );
  dom.window.document.querySelector("form")!.getBoundingClientRect = () =>
    new dom.window.DOMRect(0, 500, 640, 80);
  const shadows: ShadowRoot[] = [];
  const attach = dom.window.Element.prototype.attachShadow;
  dom.window.Element.prototype.attachShadow = function (options) {
    const value = attach.call(this, options);
    shadows.push(value);
    return value;
  };
  const calls: any[] = [];
  let invalidate = () => {};
  let release!: (value: any) => void;
  const browser = {
    runtime: {
      id: "content-test-extension",
      getURL: (path: string) =>
        `chrome-extension://content-test-extension${path}`,
      onMessage: { addListener() {} },
      sendMessage: async (message: any) => {
        calls.push(message);
        return message.target === "conversation-summary"
          ? new Promise((resolve) => (release = resolve))
          : { enabled: false };
      },
    },
  };
  const imports: any = {
    "wxt/utils/define-content-script": { defineContentScript: (v: any) => v },
    "wxt/browser": { browser },
    "@footprint/capture-core": core,
    "@footprint/adapters": adapters,
    "@footprint/ui/formatters": formatters,
    "@footprint/ui/file-text": fileTextPresentation,
    "../lib/capture-watchdog": watchdog,
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
    "../lib/history-limits": historyLimits,
    "../lib/file-offer-bridge": fileOfferBridge,
    "../lib/file-relay-protocol": fileRelayProtocol,
    "../lib/details-overview": detailsOverview,
    // The content script's own-read scheduler (14 Oct 2026); its wait period outlasts this test.
    "../lib/own-read": ownRead,
    "../lib/chatgpt-read-progress": chatgptReadProgress,
    "../lib/own-read-pause": ownReadPause,
    "../lib/own-read-settings": ownReadSettings,
    "../lib/tracking-consent": trackingConsent,
    "../lib/long-chat-tip": longChatTip,
    "../lib/capture-delivery": captureDelivery,
  };
  const compiled = ts.transpileModule(
    readFileSync(
      new URL("../entrypoints/content.content.ts", import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const exported: any = {};
  new dom.window.Function("require", "exports", compiled)((name: string) => {
    assert.ok(name in imports, name);
    return imports[name];
  }, exported);
  try {
    exported.default.main({ onInvalidated: (fn: any) => (invalidate = fn) });
    dom.window.dispatchEvent(new dom.window.PopStateEvent("popstate"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const query = calls.find((c) => c.target === "conversation-summary");
    assert.equal(query.conversationId, relation.conversation_argument);
    assert.equal(query.binding.captureId, null);
    dom.window.history.pushState({}, "", "/app/fedcba9876543210");
    release({
      target: "footprint-display",
      displayBinding: query.binding,
      conversationIdentity: {
        site: "gemini",
        conversationId: relation.conversation_argument,
      },
      summary: { ...new SummaryAccumulator().result(), requests: 999 },
      mode: "personal",
      guidance: { show: false, state: { level: 0 } },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(shadows.every((s) => !s.textContent!.includes("999")));
    assert.ok(calls.every((c) => c.target !== "capture"));
  } finally {
    invalidate();
    dom.window.close();
  }
});

const perplexityThread = (n: number) =>
  `https://www.perplexity.ai/search/00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const settleBackground = async () => {
  for (let tick = 0; tick < 20; tick++)
    await new Promise((resolve) => setTimeout(resolve, 0));
};

test("a restarted background reads the open Perplexity tabs' addresses, and an older queued update does not replace them", async () => {
  // The tab moved to thread 72 before the restart and then to 73; the browser's 72
  // update is still queued when the startup read returns 73.
  const h = backgroundHarness([
    { id: 4, url: perplexityThread(73) },
    { id: 5 },
    { url: "https://www.perplexity.ai/" },
  ]);
  h.navigate({ id: 4, url: perplexityThread(72) });
  await settleBackground();
  assert.deepEqual(h.tabAddresses, [
    [4, perplexityThread(73)],
    [4, perplexityThread(73)],
  ]);
  // Later updates apply as they come.
  h.navigate({ id: 4, url: perplexityThread(74) });
  await settleBackground();
  assert.deepEqual(h.tabAddresses.at(-1), [4, perplexityThread(74)]);
});

test("an address update reported while the startup read runs is kept over the read", async () => {
  let h: ReturnType<typeof backgroundHarness>;
  h = backgroundHarness([{ id: 4, url: perplexityThread(75) }], () =>
    h.navigate({ id: 4, url: perplexityThread(76) }),
  );
  await settleBackground();
  assert.deepEqual(h.tabAddresses.at(-1), [4, perplexityThread(76)]);
  assert.ok(
    !h.tabAddresses.some(([, url]: any) => url === perplexityThread(75)),
  );
});
