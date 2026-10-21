import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { Ledger } from "@footprint/ledger";
import { initialSnapshot, parseHistoryText } from "@footprint/adapters";
import { Coordinator } from "../lib/coordinator";
import { TRACKING_CONSENT_VERSION } from "../lib/tracking-consent";
import { countByTextLength } from "./counting-fixture";
import { HISTORY_CAPTURE_CHANNEL } from "../lib/history-capture";

// Reuse the actual-content harness without registering its separate test suite.
const harnessUrl = new URL("./conductor-content.test.ts", import.meta.url);
const harnessSource =
  readFileSync(harnessUrl, "utf8")
    .split("\ntest(")[0]!
    .replaceAll("import.meta.url", JSON.stringify(harnessUrl.href)) +
  "\nexport { contentHarness };";
const harnessModule: any = {};
new Function(
  "require",
  "exports",
  ts.transpileModule(harnessSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText,
)(createRequire(harnessUrl), harnessModule);
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 5));
async function until(check: () => boolean) {
  for (let step = 0; step < 300 && !check(); step++) await pause();
  assert.ok(check(), "Expected bounded asynchronous work to settle");
}

async function harness(t: test.TestContext, initialUrl?: string) {
  const conversationId = "00000000-0000-4000-8000-000000000042";
  const url = initialUrl ?? `https://claude.ai/chat/${conversationId}`;
  const db = await Ledger.open("native-history-" + crypto.randomUUID());
  const replies: any[] = [],
    confirmations: any[] = [];
  let receive: any, updated: any, removed: any;
  let permission = true,
    missingProof = false;
  let proofWait = async () => {};
  let countWait = async () => {};
  let proofReply: ((message: any) => Promise<any>) | undefined;
  let tab: any = { id: 99, url, status: "loading" };
  let sender: any = {
    id: "content-test-extension",
    frameId: 0,
    documentId: "native-document-one",
    documentLifecycle: "active",
    tab: { id: 99 },
    url,
  };
  let c!: Coordinator;
  const send = async (message: any, source = sender) => {
    const reply = await receive(message, source);
    replies.push({ message, reply });
    return reply;
  };
  const content = await harnessModule.contentHarness(false, {
    url,
    html: url.includes("chatgpt.com")
      ? '<main><form><textarea id="prompt-textarea" placeholder="Ask"></textarea></form></main>'
      : '<main><form><div class="ProseMirror" contenteditable="true" role="textbox"></div></form></main>',
    respond: async () => ({ code: "partial_capture" }),
    respondHistory: send,
    respondCapture: send,
  });
  let currentContent = content;
  const documents = [content];
  const browser: any = {
    runtime: {
      id: sender.id,
      getURL: (path: string) =>
        "chrome-extension://content-test-extension/" + path.replace(/^\//, ""),
      onMessage: {
        addListener(fn: any) {
          receive = fn;
        },
      },
    },
    permissions: {
      contains: async () => permission,
      onRemoved: { addListener() {} },
    },
    alarms: { onAlarm: { addListener() {} } },
    tabs: {
      get: async () => ({ ...tab }),
      query: async () => [],
      onUpdated: {
        addListener(fn: any) {
          updated = fn;
        },
      },
      onRemoved: {
        addListener(fn: any) {
          removed = fn;
        },
      },
      sendMessage: async (_id: number, message: any, options: any) => {
        confirmations.push({ message, options });
        await proofWait();
        if (missingProof) return undefined;
        return proofReply
          ? proofReply(message)
          : currentContent.deliver(message, { id: sender.id });
      },
    },
  };
  const backgroundUrl = new URL(
    "../entrypoints/background.ts",
    import.meta.url,
  );
  const require = createRequire(backgroundUrl);
  const overrides: any = {
    "wxt/utils/define-background": { defineBackground: (fn: any) => fn() },
    "wxt/browser": { browser },
    "@footprint/ledger": { Ledger: { open: async () => db } },
    "../lib/coordinator": {
      Coordinator: class {
        constructor(source: any, options: any) {
          c = new Coordinator(source, {
            ...options,
            count: async (job: any) => {
              await countWait();
              return countByTextLength(job);
            },
          });
          return c;
        }
      },
    },
    "../lib/platform": {
      scheduleSync: async () => {},
      hasCompanyConsent: async () => true,
      countLocally: countByTextLength,
    },
    "../lib/scope-notifications": {
      observeScopeChanges: async () => {},
      observeThreadInvalidations: async () => {},
    },
  };
  const backgroundSource = readFileSync(backgroundUrl, "utf8").replaceAll(
    "import.meta.env.BROWSER",
    '"chrome"',
  );
  new Function(
    "require",
    "exports",
    "globalThis",
    ts.transpileModule(backgroundSource, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
  )(
    (name: string) => overrides[name] ?? require(name),
    {},
    { addEventListener() {} },
  );
  await until(() => !!c);
  await c.whenReady();
  // The actual background tracks nothing before the agreement (lib/tracking-consent.ts).
  await c.setTrackingConsent({ agreed: true, version: TRACKING_CONSENT_VERSION });
  const fixture = JSON.parse(
    readFileSync(
      new URL(
        "../../../fixtures/history-observation-2026-09-14/claude-selected-history.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const observedAt = new Date().toISOString();
  const page = parseHistoryText("claude", fixture, conversationId, observedAt);
  const start = {
    channel: HISTORY_CAPTURE_CHANNEL,
    event: "start",
    id: crypto.randomUUID(),
    site: "claude",
    conversationId,
    observedAt,
    page: null,
  };
  t.after(() => {
    for (const document of documents) document.close();
    c.history.invalidate();
    c.engines.dispose();
    db.close();
  });
  return {
    content,
    c,
    db,
    replies,
    confirmations,
    page,
    start,
    async startImport() {
      content.postHistorical(start);
      await until(() =>
        replies.some((entry) => entry.message.message?.event === "start"),
      );
      assert.equal(
        replies.find((entry) => entry.message.message?.event === "start").reply
          .accepted,
        true,
      );
    },
    async finishImport() {
      content.postHistorical({ ...start, event: "page", page });
      await until(() =>
        replies.some((entry) => entry.message.message?.event === "page"),
      );
      return replies.find((entry) => entry.message.message?.event === "page")
        .reply;
    },
    update(change: any) {
      return updated(99, change);
    },
    remove() {
      removed(99);
    },
    setTab(value: any) {
      tab = { ...tab, ...value };
    },
    setCountWait(fn: () => Promise<void>) {
      countWait = fn;
    },
    setProofReply(fn: (message: any) => Promise<any>) {
      proofReply = fn;
    },
    async replaceDocument() {
      const nextSender = { ...sender, documentId: "native-document-two" };
      currentContent = await harnessModule.contentHarness(false, {
        url,
        html: '<main><form><div class="ProseMirror" contenteditable="true" role="textbox"></div></form></main>',
        respond: async () => ({ code: "partial_capture" }),
        respondHistory: (message: any) => send(message, nextSender),
      });
      documents.push(currentContent);
      return currentContent;
    },
    setProofWait(fn: () => Promise<void>) {
      proofWait = fn;
    },
    deny() {
      permission = false;
    },
    missing() {
      missingProof = true;
    },
  };
}

for (const event of ["control", "loading", "same-url"] as const) {
  test(`real background and history service retain current-document imports after ${event}`, async (t) => {
    const h = await harness(t);
    await h.startImport();
    if (event !== "control")
      await h.update(
        event === "loading"
          ? { status: "loading" }
          : { url: `https://claude.ai/chat/${h.page.conversationId}` },
      );
    const reply = await h.finishImport();
    assert.equal(reply.accepted, true);
    assert.equal((await h.db.all("history_records")).length, 2);
    assert.ok(
      h.confirmations.every(
        (entry) =>
          entry.options?.frameId === 0 &&
          entry.options.documentId === undefined,
      ),
    );
  });
}

test("actual content restores the exact selected capture after a transient ChatGPT WEB route", async (t) => {
  const content = await harnessModule.contentHarness(false, {
    url: "https://chatgpt.com/",
    respond: async () => ({ code: "partial_capture" }),
  });
  t.after(() => content.close());
  const shadow = content.render(null);
  const binding = content.currentCaptureBinding();
  const identity = { site: "chatgpt", conversationId: crypto.randomUUID() };
  content.deliverDisplay(binding, identity, "6");
  await content.navigate("/c/WEB:" + crypto.randomUUID());
  await content.navigate("/c/" + identity.conversationId);
  content.deliverDisplay(binding, identity, "7");
  assert.match(shadow.querySelector("[data-metrics]").textContent, /Req 7/);
});

for (const failure of [
  "new-document",
  "changed-url",
  "pending-url",
  "missing",
  "ambiguous",
  "permission",
  "closed",
] as const) {
  test(`native history fails closed for ${failure} evidence`, async (t) => {
    const h = await harness(t);
    await h.startImport();
    if (failure === "new-document") await h.replaceDocument();
    if (failure === "changed-url")
      h.setTab({ url: "https://claude.ai/chat/" + crypto.randomUUID() });
    if (failure === "pending-url")
      h.setTab({ pendingUrl: "https://claude.ai/chat/" + crypto.randomUUID() });
    if (failure === "missing") h.missing();
    if (failure === "ambiguous")
      h.setProofReply(async () => ({ current: true, extra: true }));
    if (failure === "permission") h.deny();
    if (failure === "closed") h.remove();
    else await h.update({ status: "loading" });
    const reply = await h.finishImport();
    assert.equal(reply.accepted, false);
    assert.notEqual(reply.error, "ledger_integrity_failed");
    assert.equal((await h.db.all("history_records")).length, 0);
  });
}

test("a loading hint during the first current-frame confirmation preserves an admitted start", async (t) => {
  const h = await harness(t);
  let first = true;
  h.setProofWait(async () => {
    if (first) {
      first = false;
      await h.update({ status: "loading" });
    }
  });
  await h.startImport();
  assert.equal((await h.finishImport()).accepted, true);
  assert.equal((await h.db.all("history_records")).length, 2);
});

test("a benign native hint during real history counting waits for proof without losing the page", async (t) => {
  const h = await harness(t);
  await h.startImport();
  let release!: () => void;
  const proof = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true,
    update: Promise<void> | undefined;
  h.setCountWait(async () => {
    if (first) {
      first = false;
      h.setProofWait(() => proof);
      update = h.update({ status: "loading" });
    }
  });
  const finish = h.finishImport();
  await until(() => !first);
  await pause();
  assert.equal((await h.db.all("history_records")).length, 0);
  release();
  await update;
  assert.equal((await finish).accepted, true);
  assert.equal((await h.db.all("history_records")).length, 2);
});

test("a delayed old-document proof cannot cancel a subsequently admitted new-document import", async (t) => {
  const h = await harness(t);
  await h.startImport();
  let release!: () => void,
    entered = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  h.setProofWait(async () => {
    if (!entered) {
      entered = true;
      await gate;
    }
  });
  const update = h.update({ status: "loading" });
  await until(() => entered);
  const next = await h.replaceDocument();
  const start = { ...h.start, id: crypto.randomUUID() };
  next.postHistorical(start);
  release();
  await update;
  await until(() =>
    h.replies.some((entry) => entry.message.message?.id === start.id),
  );
  assert.equal(
    h.replies.find((entry) => entry.message.message?.id === start.id).reply
      .accepted,
    true,
  );
  next.postHistorical({ ...start, event: "page", page: h.page });
  await until(() =>
    h.replies.some(
      (entry) =>
        entry.message.message?.id === start.id &&
        entry.message.message.event === "page",
    ),
  );
  assert.equal((await h.db.all("history_records")).length, 2);
});

test("a late positive proof cannot undo a newer navigation invalidation", async (t) => {
  const h = await harness(t);
  await h.startImport();
  let release!: () => void,
    entered = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  h.setProofReply(async (message) => {
    const result = await h.content.deliver(message, {
      id: "content-test-extension",
    });
    if (!entered) {
      entered = true;
      await gate;
    }
    return result;
  });
  const first = h.update({ status: "loading" });
  await until(() => entered);
  const other = "https://claude.ai/chat/" + crypto.randomUUID();
  h.setTab({ url: other });
  await h.update({ url: other });
  release();
  await first;
  assert.equal((await h.finishImport()).accepted, false);
  assert.equal((await h.db.all("history_records")).length, 0);
});

for (const loss of [
  "new-capture",
  "wrong-route",
  "known-route-detour",
  "scope",
  "permission",
  "expired",
] as const) {
  test(`transient capture promotion rejects ${loss}`, async (t) => {
    const content = await harnessModule.contentHarness(false, {
      url: "https://chatgpt.com/",
      respond: async () => ({ code: "partial_capture" }),
    });
    t.after(() => content.close());
    const shadow = content.render(null),
      binding = content.currentCaptureBinding();
    const identity = { site: "chatgpt", conversationId: crypto.randomUUID() };
    content.deliverDisplay(binding, identity, "6");
    await content.navigate("/c/WEB:" + crypto.randomUUID());
    if (loss === "new-capture") content.render(null, { requestCount: 2 });
    if (loss === "known-route-detour")
      await content.navigate("/c/" + crypto.randomUUID());
    if (loss === "scope")
      await content.deliver({ target: "footprint-scope-changed" });
    if (loss === "permission")
      await content.deliver({ target: "capture-permission-lost" });
    if (loss === "expired") {
      const clock = content.document.defaultView.Date.now() + 31000;
      t.mock.method(content.document.defaultView.Date, "now", () => clock);
    }
    await content.navigate(
      "/c/" +
        (loss === "wrong-route"
          ? crypto.randomUUID()
          : identity.conversationId),
    );
    content.deliverDisplay(binding, identity, "7");
    assert.doesNotMatch(
      shadow.querySelector("[data-metrics]").textContent,
      /Req 7/,
    );
  });
}

test("the final numeric display received only on an interim route is restored after exact identity proof", async (t) => {
  const content = await harnessModule.contentHarness(false, {
    url: "https://chatgpt.com/",
    respond: async () => ({ code: "partial_capture" }),
  });
  t.after(() => content.close());
  const shadow = content.render(null),
    binding = content.currentCaptureBinding();
  const identity = { site: "chatgpt", conversationId: crypto.randomUUID() };
  await content.navigate("/c/WEB:" + crypto.randomUUID());
  content.deliverDisplay(binding, identity, "7");
  assert.doesNotMatch(
    shadow.querySelector("[data-metrics]").textContent,
    /Req 7/,
  );
  await content.navigate("/c/" + identity.conversationId);
  assert.match(shadow.querySelector("[data-metrics]").textContent, /Req 7/);
});

test("real background keeps first-chat live publication through native WEB and final URL updates", async (t) => {
  const h = await harness(t, "https://chatgpt.com/");
  const id = crypto.randomUUID(),
    conversationId = crypto.randomUUID();
  const start = {
    channel: "ai-footprint-observation-v1",
    version: 1,
    id,
    revision: 1,
    event: "dispatch",
    site: "chatgpt",
    at: new Date().toISOString(),
    timing: null,
    failure: null,
    snapshot: initialSnapshot(),
    dispatch: {
      site: "chatgpt",
      action: "send",
      input: "synthetic",
      conversationId: null,
      parentId: null,
      requestId: crypto.randomUUID(),
      model: null,
      attachments: 0,
      imageEditParentId: null,
    },
  };
  const waitRevision = async (revision: number) => {
    await until(() =>
      h.replies.some(
        (row) =>
          row.message.payload?.id === id &&
          row.message.payload?.revision === revision,
      ),
    );
    assert.equal(
      h.replies.find(
        (row) =>
          row.message.payload?.id === id &&
          row.message.payload?.revision === revision,
      ).reply.ok,
      true,
    );
    await h.c.settleConversationDisplays();
  };
  h.content.postHistorical(start);
  await waitRevision(1);
  const progress = {
    ...start,
    dispatch: null,
    revision: 2,
    event: "progress",
    snapshot: {
      ...initialSnapshot(),
      conversationId,
      outputId: crypto.randomUUID(),
      text: "p",
      started: true,
    },
  };
  h.content.postHistorical(progress);
  await waitRevision(2);
  const interim = "/c/WEB:" + crypto.randomUUID();
  await h.content.navigate(interim);
  h.setTab({ url: "https://chatgpt.com" + interim });
  await h.update({ url: "https://chatgpt.com" + interim });
  await h.content.navigate("/c/" + conversationId);
  h.setTab({ url: "https://chatgpt.com/c/" + conversationId });
  await h.update({ url: "https://chatgpt.com/c/" + conversationId });
  h.content.postHistorical({
    ...progress,
    event: "end",
    revision: 3,
    snapshot: { ...progress.snapshot, text: "hello", state: "completed" },
  });
  await waitRevision(3);
  const host = h.content.document.querySelector(
    '[data-ai-footprint="information"]',
  );
  const shadow = h.content.shadowFor(host);
  assert.match(
    shadow.querySelector("[data-metrics]").textContent,
    /In\/Out tokens - [^·]*\/(?:≈ )?5/,
  );
  const scope = await h.c.currentScope();
  const attempt: any = (await h.db.rows(scope.namespace)).find(
    (row) => row.record.kind === "attempt",
  );
  assert.equal(attempt.record.tokens.answer_output.value, "5");
});

test("real background keeps showing the reply after ChatGPT read aloud, also after a URL update (G1)", async (t) => {
  const conversationId = crypto.randomUUID();
  const url = "https://chatgpt.com/c/" + conversationId;
  const h = await harness(t, url);
  h.setTab({ url, status: "complete" });
  const frame = (id: string, revision: number, event: string, rest: any) => ({
    channel: "ai-footprint-observation-v1",
    version: 1,
    id,
    revision,
    event,
    site: "chatgpt",
    at: new Date().toISOString(),
    timing: null,
    failure: null,
    ...rest,
  });
  const saved = async (id: string, revision: number) => {
    await until(() =>
      h.replies.some(
        (row) =>
          row.message.payload?.id === id &&
          row.message.payload?.revision === revision,
      ),
    );
    assert.equal(
      h.replies.find(
        (row) =>
          row.message.payload?.id === id &&
          row.message.payload?.revision === revision,
      ).reply.ok,
      true,
    );
    await h.c.settleConversationDisplays();
  };
  const reply = crypto.randomUUID();
  h.content.postHistorical(
    frame(reply, 1, "dispatch", {
      snapshot: initialSnapshot(),
      dispatch: {
        site: "chatgpt",
        action: "send",
        input: "synthetic",
        conversationId,
        parentId: null,
        requestId: crypto.randomUUID(),
        model: null,
        attachments: 0,
        imageEditParentId: null,
      },
    }),
  );
  await saved(reply, 1);
  h.content.postHistorical(
    frame(reply, 2, "end", {
      dispatch: null,
      snapshot: {
        ...initialSnapshot(),
        conversationId,
        outputId: crypto.randomUUID(),
        text: "hello",
        thinking: "",
        started: true,
        state: "completed",
      },
    }),
  );
  await saved(reply, 2);
  const shadow = h.content.shadowFor(
    h.content.document.querySelector('[data-ai-footprint="information"]'),
  );
  const metrics = () => shadow.querySelector("[data-metrics]").textContent;
  // In mWh; the bar changes to Wh from 100 mWh.
  const electricity = (text: string) => {
    const [, value, unit] = /Electricity ≈ ([0-9.]+) (mWh|Wh)/.exec(text)!;
    return Number(value) * (unit === "Wh" ? 1000 : 1);
  };
  const shown = metrics();
  assert.match(shown, /Req 1 · In\/Out tokens - ≈ 9\/5 · Electricity/);
  const readAloud = async (seconds: number) => {
    const id = crypto.randomUUID();
    h.content.postHistorical(
      frame(id, 1, "dispatch", {
        snapshot: initialSnapshot(),
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
      }),
    );
    await saved(id, 1);
    h.content.postHistorical(
      frame(id, 2, "end", {
        dispatch: null,
        snapshot: {
          ...initialSnapshot(),
          conversationId,
          text: "",
          thinking: "",
          toolInput: "",
          intermediate: "",
          toolOutput: "",
          started: true,
          state: "completed",
          media: [
            {
              kind: "speech",
              basis: "audio_frames",
              seconds,
              characters: null,
            },
          ],
        },
      }),
    );
    await saved(id, 2);
  };
  await readAloud(10.24);
  const first = metrics();
  // The bar keeps the reply, its tokens and its single request; the speech adds energy.
  assert.match(first, /Req 1 · In\/Out tokens - ≈ 9\/5 · Electricity/);
  assert.ok(electricity(first) > electricity(shown));
  // A URL update keeps the reply's display: the tab's capture is still the reply.
  await h.update({ url });
  await readAloud(20.48);
  const second = metrics();
  assert.match(second, /Req 1 · In\/Out tokens - ≈ 9\/5 · Electricity/);
  assert.ok(electricity(second) > electricity(first));
});

test("current-frame capture proof rejects foreign, malformed and replaced-document bindings", async (t) => {
  const make = () =>
    harnessModule.contentHarness(false, {
      url: "https://chatgpt.com/",
      respond: async () => ({ code: "partial_capture" }),
    });
  const old = await make(),
    fresh = await make();
  t.after(() => {
    old.close();
    fresh.close();
  });
  old.render(null);
  const binding = old.currentCaptureBinding(),
    conversationId = crypto.randomUUID();
  old.deliverDisplay(binding, { site: "chatgpt", conversationId }, "6");
  await old.navigate("/c/WEB:" + crypto.randomUUID());
  const probe = {
    target: "footprint-capture-current",
    binding,
    site: "chatgpt",
    conversationId,
    path: "/",
  };
  const sender = { id: "content-test-extension" };
  assert.equal((await old.deliver(probe, sender)).current, true);
  assert.equal(
    await old.deliver(probe, { id: "foreign-extension" }),
    undefined,
  );
  assert.equal(
    (
      await old.deliver(
        { ...probe, conversationId: crypto.randomUUID() },
        sender,
      )
    ).current,
    false,
  );
  assert.equal(
    (await old.deliver({ ...probe, extra: true }, sender)).current,
    false,
  );
  assert.equal(
    (await old.deliver({ ...probe, path: {} }, sender)).current,
    false,
  );
  assert.equal((await fresh.deliver(probe, sender)).current, false);
  const shadow = fresh.render(null);
  await fresh.navigate("/c/" + conversationId);
  fresh.deliverDisplay(binding, { site: "chatgpt", conversationId }, "7");
  assert.doesNotMatch(
    shadow.querySelector("[data-metrics]").textContent,
    /Req 7/,
  );
});
