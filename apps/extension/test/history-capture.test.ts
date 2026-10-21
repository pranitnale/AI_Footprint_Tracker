import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import "fake-indexeddb/auto";
import { Ledger } from "@footprint/ledger";
import { parseHistoryText, HISTORY_LIMITS } from "@footprint/adapters";
import {
  countHistoryPage,
  sharedCountLimit,
  validHistoryTextPage,
  validateHistoryCapture,
  HISTORY_CAPTURE_CHANNEL,
  HISTORY_COUNT_WINDOW,
} from "../lib/history-capture";
import { CLAUDE_STREAM_CHANNEL } from "../lib/claude-history-message";
import { PROVIDER_STREAM_CHANNEL } from "../lib/provider-history-message";
import { createHistoryTextObserver } from "../lib/passive-history-text";
import { installCapture } from "../lib/capture-runtime";
import { Coordinator } from "../lib/coordinator";
import { unavailableCount } from "./counting-fixture";
import type { CountRequest, CountResponse } from "@footprint/tokenizers";
const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(
        `../../../fixtures/history-observation-2026-09-14/${name}.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
const id = "00000000-0000-4000-8000-000000000042",
  at = "2026-09-14T12:00:00.000Z";
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 5));
async function until(predicate: () => boolean) {
  for (let i = 0; i < 400 && !predicate(); i++) await pause();
  assert.ok(predicate());
}
function locationFor(site = "claude") {
  const origin =
    site === "claude"
      ? "https://claude.ai"
      : site === "gemini"
        ? "https://gemini.google.com"
        : site === "chatgpt"
          ? "https://chatgpt.com"
        : "https://www.perplexity.ai";
  const pathname =
    site === "claude"
      ? `/chat/${id}`
      : site === "gemini"
        ? "/app/0000000000000042"
        : site === "chatgpt"
          ? `/c/${id}`
        : `/search/${id}`;
  Object.assign(globalThis, {
    location: {
      origin,
      hostname: new URL(origin).hostname,
      pathname,
      href: origin + pathname,
    },
  });
  return new URL(
    origin +
      (site === "claude"
        ? `/api/organizations/00000000-0000-4000-8000-000000000011/chat_conversations/${id}?tree=True`
        : site === "chatgpt"
          ? `/backend-api/conversations/${id}`
        : `/rest/thread/${id}`),
  );
}
function workerCounter() {
  const require = createRequire(import.meta.url);
  const worker = new Worker(
    `require(${JSON.stringify(require.resolve("tsx/cjs"))});const {parentPort}=require('node:worker_threads');global.self=globalThis;self.postMessage=v=>parentPort.postMessage(v);require(${JSON.stringify(fileURLToPath(new URL("../lib/count.worker.ts", import.meta.url)))});parentPort.on('message',data=>self.onmessage({data}));`,
    { eval: true },
  );
  const pending = new Map<
    string,
    { resolve: (v: CountResponse) => void; reject: (e: Error) => void }
  >();
  worker.on("message", (m) => {
    const item = pending.get(m.jobId);
    if (item) {
      pending.delete(m.jobId);
      item.resolve(m);
    }
  });
  worker.on("error", (e) => {
    for (const item of pending.values()) item.reject(e);
    pending.clear();
  });
  return {
    count: (job: CountRequest) =>
      new Promise<CountResponse>((resolve, reject) => {
        pending.set(job.jobId, { resolve, reject });
        worker.postMessage({ type: "count", request: job });
      }),
    close: () => worker.terminate(),
  };
}
test("real private count worker handles each provider and never returns raw message/file metadata", async () => {
  const worker = workerCounter();
  try {
    for (const [site, name] of [
      ["chatgpt", "chatgpt-flat-page"],
      ["claude", "claude-selected-history"],
      ["perplexity", "perplexity-workflow-page"],
      ["gemini", "gemini-selected-history"],
    ] as const) {
      const f = fixture(name),
        // Exercise the provider's populated model fields, not only legacy nulls.
        populated =
          site === "perplexity"
            ? {
                ...f,
                entries: f.entries.map((entry: any) => ({
                  ...entry,
                  user_selected_model: "pplx_pro",
                  display_model: "gpt56_terra",
                })),
              }
            : f,
        page = parseHistoryText(
          site,
          site === "gemini" ? f.response_payload : populated,
          site === "gemini" ? f.request_arguments[0] : id,
          at,
        );
      assert.equal(validHistoryTextPage(page), true);
      const before = structuredClone(page),
        counted = await countHistoryPage(page, worker.count);
      assert.deepEqual(page, before);
      assert.equal(counted.messages.length, page.messages.length);
      for (let i = 0; i < page.messages.length; i++) {
        const raw = page.messages[i]!,
          numeric = counted.messages[i]!;
        assert.equal(numeric.sourceId, raw.sourceId);
        if (raw.text === null) assert.equal(numeric.tokens.value, null);
        else assert.ok(numeric.tokens.value !== null);
        assert.equal(Object.hasOwn(numeric, "text"), false);
        assert.equal(Object.hasOwn(numeric, "inlineFiles"), false);
        if (raw.text)
          assert.equal(JSON.stringify(counted).includes(raw.text), false);
      }
      if (site === "claude") {
        assert.equal(counted.messages[0]!.inlineFileComponents!.length, 1);
        assert.equal(
          counted.messages[0]!.inlineFileComponents![0]!.extraction_profile_id,
          "observed-inline-file-text-v1",
        );
        assert.equal(JSON.stringify(counted).includes("component_id"), false);
        assert.equal(
          JSON.stringify(counted).includes("SYNTHETIC-MARKER"),
          false,
        );
      }
    }
  } finally {
    await worker.close();
  }
});

test("history bridge accepts bounded model labels on every site and rejects arbitrary metadata", () => {
  const page = parseHistoryText(
    "perplexity",
    fixture("perplexity-workflow-page"),
    id,
    at,
  );
  for (const model of [
    "pplx_pro",
    "gpt56_terra",
    "claude-sonnet-4.5",
    "Gemini 3.5 Flash",
    "x".repeat(80),
  ]) {
    page.messages[1]!.modelId = model;
    assert.equal(validHistoryTextPage(page), true, model);
  }
  for (const model of [
    "",
    "x".repeat(81),
    " leading",
    "a\nb",
    "<script>",
    42,
    {},
  ]) {
    (page.messages[1] as any).modelId = model;
    assert.equal(validHistoryTextPage(page), false, String(model));
  }
  // Claude, ChatGPT and Gemini pages may name models too (S3.3).
  const claude = parseHistoryText(
    "claude",
    fixture("claude-selected-history"),
    id,
    at,
  );
  claude.messages[0]!.modelId = "claude-opus-5-5";
  assert.equal(validHistoryTextPage(claude), true);
});
test("whole envelope corruption and mismatched worker provenance become explicit unknowns, not zero", async () => {
  const worker = workerCounter();
  try {
    for (const mutate of [
      (r: any) => null,
      (r: any) => ({
        ...r,
        counts: {
          ...r.counts,
          input: { ...r.counts.input, jobId: crypto.randomUUID() },
        },
      }),
      (r: any) => ({
        ...r,
        counts: {
          ...r.counts,
          input: {
            ...r.counts.input,
            measurement: {
              ...r.counts.input.measurement,
              value: "999999999",
            },
          },
        },
      }),
    ]) {
      const page = parseHistoryText(
        "claude",
        fixture("claude-selected-history"),
        id,
        at,
      );
      const counted = await countHistoryPage(page, async (job) =>
        mutate(await worker.count(job)),
      );
      assert.equal(counted.messages[0]!.tokens.value, null);
      assert.equal(counted.messages[0]!.tokens.evidence, "unknown");
    }
  } finally {
    await worker.close();
  }
});
test("count snapshot resists input mutation and cancellation prevents subsequent physical jobs", async () => {
  const page = parseHistoryText(
      "claude",
      fixture("claude-selected-history"),
      id,
      at,
    ),
    original = page.messages[0]!.sourceId;
  const started = Math.min(HISTORY_COUNT_WINDOW, page.messages.length);
  let calls = 0;
  const signals: AbortSignal[] = [];
  const abort = new AbortController();
  const work = countHistoryPage(
    page,
    (_job, signal) => {
      calls++;
      signals.push(signal!);
      // Never answered: cancellation must not wait for a worker reply.
      return new Promise<CountResponse>(() => {});
    },
    { signal: abort.signal },
  );
  await until(() => calls === started);
  page.messages[0]!.sourceId = crypto.randomUUID();
  abort.abort();
  await assert.rejects(work, /history_cancelled/);
  await pause();
  assert.equal(calls, started, "no job starts after cancellation");
  assert.ok(signals.every((signal) => signal.aborted));
  const immutable = parseHistoryText(
    "claude",
    fixture("claude-selected-history"),
    id,
    at,
  );
  const second = countHistoryPage(immutable, async (job) => {
    immutable.messages[0]!.sourceId = crypto.randomUUID();
    return unavailableCount(job);
  });
  assert.equal((await second).messages[0]!.sourceId, original);
});
test("history counts overlap in a bounded window and keep message order", async () => {
  const f = fixture("claude-selected-history"),
    template = f.chat_messages[0];
  f.chat_messages = Array.from({ length: 12 }, (_, index) => ({
    ...template,
    uuid: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    parent_message_uuid: index
      ? `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
      : "00000000-0000-4000-8000-000000000000",
    index,
    sender: index % 2 ? "assistant" : "human",
    stop_reason: "end_turn",
    attachments: [],
    content: [{ type: "text", text: "word ".repeat(index + 1) }],
  }));
  f.current_leaf_message_uuid = f.chat_messages.at(-1).uuid;
  const page = parseHistoryText("claude", f, id, at);
  const worker = workerCounter();
  let inFlight = 0,
    peak = 0;
  try {
    const counted = await countHistoryPage(page, async (job) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      // Answer later jobs first to prove results are matched to their messages.
      await new Promise((r) => setTimeout(r, 30 - Number(job.fields.input?.length ?? job.fields.answer?.length ?? 0) / 5));
      try {
        return await worker.count(job);
      } finally {
        inFlight--;
      }
    });
    assert.equal(peak, HISTORY_COUNT_WINDOW);
    assert.deepEqual(
      counted.messages.map((m) => m.sourceId),
      page.messages.map((m) => m.sourceId),
    );
    const serial = await countHistoryPage(page, worker.count, {
      concurrency: 1,
    });
    assert.deepEqual(
      counted.messages.map((m) => m.tokens),
      serial.messages.map((m) => m.tokens),
    );
    assert.ok(counted.messages.every((m) => m.tokens.value !== null));
  } finally {
    await worker.close();
  }
});
test("one shared count limit bounds every concurrent import together", async () => {
  let inFlight = 0,
    peak = 0;
  const limited = sharedCountLimit(async (job) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await pause();
    inFlight--;
    return unavailableCount(job);
  });
  const page = () =>
    parseHistoryText("claude", fixture("claude-selected-history"), id, at);
  await Promise.all(
    Array.from({ length: 3 }, () => countHistoryPage(page(), limited)),
  );
  assert.ok(peak <= HISTORY_COUNT_WINDOW);
  const abort = new AbortController();
  const blocked = sharedCountLimit(() => new Promise<CountResponse>(() => {}), 1);
  void blocked({} as CountRequest).catch(() => {});
  const waiting = blocked({} as CountRequest, abort.signal);
  abort.abort();
  await assert.rejects(waiting, /history_cancelled/);
});
test("transient bridge rejects raw extras, forged numeric data, inconsistent roots and over-budget text", () => {
  const page = parseHistoryText(
    "claude",
    fixture("claude-selected-history"),
    id,
    at,
  );
  const value: any = {
    channel: HISTORY_CAPTURE_CHANNEL,
    event: "page",
    id: crypto.randomUUID(),
    site: "claude",
    conversationId: id,
    observedAt: at,
    page,
  };
  assert.equal(validateHistoryCapture(value, "claude.ai"), true);
  assert.equal(validateHistoryCapture(value, "chatgpt.com"), false);
  for (const mutate of [
    (v: any) => (v.page.messages[0].tokens = { value: "9" }),
    (v: any) =>
      (v.page.messages[0].text = "x".repeat(HISTORY_LIMITS.messageUnits + 1)),
    (v: any) => (v.page.rootSourceId = null),
    (v: any) => (v.page.messages[0].filename = "private.txt"),
  ]) {
    const bad = structuredClone(value);
    mutate(bad);
    assert.equal(validateHistoryCapture(bad, "claude.ai"), false);
  }
});
test("long selected history is counted in bounded chunks beyond the first hundred messages", async () => {
  const f = fixture("claude-selected-history"),
    template = f.chat_messages[0];
  f.chat_messages = Array.from({ length: 301 }, (_, index) => ({
    ...template,
    uuid: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    parent_message_uuid: index
      ? `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
      : "00000000-0000-4000-8000-000000000000",
    index,
    sender: index % 2 ? "assistant" : "human",
    stop_reason: "end_turn",
    attachments: [],
    content: [{ type: "text", text: "Synthetic message" }],
  }));
  f.current_leaf_message_uuid = f.chat_messages.at(-1).uuid;
  const page = parseHistoryText("claude", f, id, at);
  assert.equal(page.messages.length, 301);
  assert.equal(page.firstRequestVerified, true);
  const captured = [],
    sizes = [];
  for (let offset = 0; offset < page.messages.length; offset += 100) {
    let calls = 0;
    const part = await countHistoryPage(
      page,
      async (job) => {
        calls++;
        return unavailableCount(job);
      },
      { offset, limit: 100 },
    );
    assert.ok(calls <= 100);
    sizes.push(part.messages.length);
    captured.push(...part.messages);
  }
  assert.deepEqual(sizes, [100, 100, 100, 1]);
  assert.equal(new Set(captured.map((m) => m.sourceId)).size, 301);
  assert.equal(captured.at(-1)!.sourceId, f.current_leaf_message_uuid);
});

test("large Claude history imports through bounded reads and private 100-message count batches", async () => {
  const source = fixture("claude-selected-history");
  const template = source.chat_messages[0];
  source.chat_messages = Array.from({ length: 534 }, (_, index) => ({
    ...template,
    uuid: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    parent_message_uuid: index
      ? `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
      : "00000000-0000-4000-8000-000000000000",
    index,
    sender: index % 2 ? "assistant" : "human",
    stop_reason: "end_turn",
    truncated: false,
    content: [{ type: "text", text: "x".repeat(1100) }],
    attachments:
      index === 0
        ? [
            {
              extracted_content: "f".repeat(35235),
              file_type: "text/plain",
              file_size: 35235,
            },
          ]
        : [],
    ignored_metadata: "m".repeat(1300),
  }));
  source.current_leaf_message_uuid = source.chat_messages.at(-1).uuid;
  const body = JSON.stringify(source);
  assert.ok(
    new TextEncoder().encode(body).length > HISTORY_LIMITS.responseBytes,
  );
  const events: any[] = [],
    diagnostics: any[] = [];
  const observer = createHistoryTextObserver(
    (event) => events.push(event),
    (message) => diagnostics.push(message),
  );
  const response = new Response(body);
  const url = locationFor();
  observer.observe(url, "GET", Promise.resolve(response), Date.now());
  await until(() => events.some((event) => event.event === "page"));
  const page = events.find((event) => event.event === "page")!.page;
  assert.equal(page.status, "partial");
  assert.equal(page.messages.length, 534);
  assert.equal(page.firstRequestVerified, true);
  assert.equal(validHistoryTextPage(page), true);
  assert.equal(diagnostics.length, 0);
  assert.equal(await response.text(), body);
  const worker = workerCounter();
  try {
    let counted = 0;
    let input = 0;
    let output = 0;
    for (let offset = 0; offset < page.messages.length; offset += 100) {
      const batch = await countHistoryPage(page, worker.count, {
        offset,
        limit: 100,
      });
      assert.ok(batch.messages.length <= 100);
      for (const message of batch.messages) {
        assert.equal(Object.hasOwn(message, "text"), false);
        assert.ok(message.tokens.value !== null);
        counted++;
        if (message.role === "prompt") input += Number(message.tokens.value);
        else output += Number(message.tokens.value);
      }
    }
    assert.equal(counted, 534);
    assert.ok(input > 0);
    assert.ok(output > 0);
  } finally {
    observer.cancel();
    await worker.close();
  }
});

test("streamed 534-message Claude history commits every branch without a conversation cap", async () => {
  const source = fixture("claude-selected-history");
  const template = source.chat_messages[0];
  source.chat_messages = Array.from({ length: 534 }, (_, index) => ({
    ...template,
    uuid: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    parent_message_uuid: index
      ? `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
      : "00000000-0000-4000-8000-000000000000",
    index,
    sender: index % 2 ? "assistant" : "human",
    stop_reason: "end_turn",
    truncated: false,
    content: [{ type: "text", text: "synthetic countable text ".repeat(52) }],
    attachments: [],
    ignored_metadata: "m".repeat(1300),
  }));
  source.current_leaf_message_uuid = source.chat_messages.at(-1).uuid;
  source.chat_messages.push({
    ...template,
    uuid: "00000000-0000-4000-8000-000000000535",
    parent_message_uuid: source.chat_messages[0].uuid,
    index: 534,
    sender: "assistant",
    stop_reason: "end_turn",
    truncated: false,
    content: [{ type: "text", text: "abandoned branch response" }],
    attachments: [],
  });
  const body = JSON.stringify(source);
  assert.ok(
    new TextEncoder().encode(body).length > HISTORY_LIMITS.responseBytes,
  );
  const worker = workerCounter();
  const db = await Ledger.open("claude-stream-" + crypto.randomUUID());
  const coordinator = new Coordinator(db, {
    count: worker.count,
    hasConsent: async () => true,
    hasSiteConsent: async () => true,
    sendDisplay: async () => {},
    transport: async () => {
      throw new Error("unexpected network");
    },
  });
  const binding = {
    documentNonce: crypto.randomUUID(),
    navigationNonce: crypto.randomUUID(),
    captureId: null,
  };
  const sender = {
    tab: { id: 754 },
    frameId: 0,
    documentId: "synthetic-claude-stream",
    url: `https://claude.ai/chat/${id}`,
  };
  let started: Promise<unknown> = Promise.resolve();
  let finish!: (value: boolean) => void;
  let fail!: (error: unknown) => void;
  const finished = new Promise<boolean>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  const observer = createHistoryTextObserver(
    (event) => {
      if (event.event === "start")
        started = coordinator.history.receive(event, binding, sender);
    },
    () => {},
    async (event) => {
      try {
        await started;
        const result = await coordinator.history.receiveStream(
          event,
          binding,
          sender,
        );
        if (event.event === "finish") finish(result.accepted);
        return result.accepted;
      } catch (error) {
        // A failed start or batch fails the test at once instead of waiting for the deadline.
        fail(error);
        throw error;
      }
    },
  );
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await coordinator.whenReady();
    const url = locationFor();
    observer.observe(
      url,
      "GET",
      Promise.resolve(new Response(body)),
      Date.now(),
    );
    // The deadline only catches a stream that never finishes. Committing 535 records and
    // recalculating 268 replies is long work: about 2.5 s alone on the laptop and about 20 s
    // with six copies and ten busy processes on 8 cores (14 Oct 2026). A 30 s deadline
    // failed this test on the loaded VPS.
    assert.equal(
      await Promise.race([
        finished,
        new Promise<boolean>((_, reject) => {
          deadline = setTimeout(
            () => reject(new Error("stream timeout")),
            180000,
          );
        }),
      ]),
      true,
    );
    const view = await coordinator.routeSummary("claude", id, binding);
    assert.equal(view.history.local.first_request_verified, true);
    // The reply on the replaced branch counts too (owner rule of 26 Sep 2026, 14 Oct 2026).
    // It is a second reply to the first prompt, a regeneration, so it is a request of its own.
    assert.equal(view.history.local.prompt_count, "268");
    assert.equal(view.history.local.observed_prompt_count, "267");
    assert.equal(view.history.local.response_count, "268");
    assert.equal((await db.all("history_records")).length, 535);
    assert.equal((await db.all("requests")).length, 0);
    assert.equal(
      JSON.stringify(await db.all("history_records")).includes(
        "synthetic countable text",
      ),
      false,
    );
  } finally {
    if (deadline) clearTimeout(deadline);
    observer.cancel();
    coordinator.history.invalidate();
    db.close();
    await worker.close();
  }
});
test("ChatGPT, Perplexity and Gemini streamed history commits provider-specific numeric records", async () => {
  for (const site of ["chatgpt", "perplexity", "gemini"] as const) {
    const worker = workerCounter();
    const db = await Ledger.open("provider-stream-" + site + "-" + crypto.randomUUID());
    const coordinator = new Coordinator(db, {
      count: worker.count,
      hasConsent: async () => true,
      hasSiteConsent: async () => true,
      sendDisplay: async () => {},
      transport: async () => { throw new Error("unexpected network"); },
    });
    const binding = {
      documentNonce: crypto.randomUUID(),
      navigationNonce: crypto.randomUUID(),
      captureId: null,
    };
    const conversationId = site === "gemini" ? "c_0000000000000042" : id;
    const sender = {
      tab: { id: 800 }, frameId: 0,
      documentId: "synthetic-" + site,
      url: site === "chatgpt"
        ? `https://chatgpt.com/c/${id}`
        : site === "perplexity"
          ? `https://www.perplexity.ai/search/${id}`
          : "https://gemini.google.com/app/0000000000000042",
    };
    let started: Promise<unknown> = Promise.resolve();
    let resolveFinish!: (accepted: boolean) => void;
    const finished = new Promise<boolean>((resolve) => { resolveFinish = resolve; });
    const observer = createHistoryTextObserver(
      (event) => {
        if (event.event === "start")
          started = coordinator.history.receive(event, binding, sender);
      },
      () => {},
      async (event) => {
        await started;
        const result = await coordinator.history.receiveStream(event, binding, sender);
        if (event.event === "finish") resolveFinish(result.accepted);
        return result.accepted;
      },
    );
    try {
      await coordinator.whenReady();
      const url = locationFor(site);
      const body = site === "chatgpt"
        ? JSON.stringify(fixture("chatgpt-flat-page"))
        : site === "perplexity"
          ? JSON.stringify(fixture("perplexity-workflow-page"))
          : readFileSync(
              new URL("../../../fixtures/history-observation-2026-09-14/gemini-history-wire.txt", import.meta.url),
              "utf8",
            );
      observer.observe(
        site === "gemini"
          ? new URL("https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=hNvQHb")
          : url,
        site === "gemini" ? "POST" : "GET",
        Promise.resolve(new Response(body)),
        Date.now(),
        site === "gemini"
          ? new URLSearchParams({
              "f.req": JSON.stringify([[[
                "hNvQHb",
                JSON.stringify(fixture("gemini-selected-history").request_arguments),
                null,
                "generic",
              ]]]),
            }).toString()
          : undefined,
      );
      assert.equal(await Promise.race([
        finished,
        new Promise<boolean>((_, reject) => setTimeout(() => reject(new Error("stream timeout")), 10000)),
      ]), true, site);
      const view = await coordinator.routeSummary(site, conversationId, binding);
      assert.equal(view.history.local.first_request_verified, true, site);
      assert.equal(view.history.local.prompt_count, site === "gemini" ? "5" : "2", site);
      assert.equal(view.history.local.response_count, site === "gemini" ? "5" : "2", site);
      assert.equal((await db.all("history_records")).length, site === "gemini" ? 10 : 4, site);
      assert.equal((await db.all("requests")).length, 0, site);
      assert.equal(JSON.stringify(await db.all("history_records")).includes("Synthetic historical prompt"), false, site);
    } finally {
      observer.cancel();
      coordinator.history.invalidate();
      db.close();
      await worker.close();
    }
  }
});
test("actual capture entrypoint returns exact original host promise/response/args before history start", async () => {
  const url = locationFor(),
    events: any[] = [];
  const body = JSON.stringify(fixture("claude-selected-history"));
  let observedArgs: IArguments | undefined,
    called = false;
  const response = new Response(body),
    promise = Promise.resolve(response);
  const native = function () {
    observedArgs = arguments;
    called = true;
    return promise;
  } as any;
  class WindowDouble extends EventTarget {
    fetch = native;
    WebSocket = class {} as any;
    postMessage(v: any, _origin?: string, ports?: MessagePort[]) {
      assert.equal(called, true);
      events.push(v);
      if (v.channel === CLAUDE_STREAM_CHANNEL) {
        ports?.[0]?.postMessage({ accepted: true });
        ports?.[0]?.close();
      }
    }
  }
  const win = new WindowDouble();
  Object.assign(globalThis, { window: win });
  installCapture();
  try {
    const init = { method: "GET", headers: { Accept: "application/json" } };
    const got = win.fetch(url.href, init);
    assert.equal(got, promise);
    assert.equal(observedArgs![0], url.href);
    assert.equal(observedArgs![1], init);
    assert.equal(await got, response);
    assert.equal(await response.text(), body);
    await until(() =>
      events.some(
        (v) => v.channel === CLAUDE_STREAM_CHANNEL && v.event === "finish",
      ),
    );
    assert.deepEqual(
      events
        .filter((v) => v.channel === HISTORY_CAPTURE_CHANNEL)
        .map((v) => v.event),
      ["start"],
    );
    assert.deepEqual(
      events
        .filter((v) => v.channel === CLAUDE_STREAM_CHANNEL)
        .map((v) => v.event),
      ["batch", "finish"],
    );
  } finally {
    win.dispatchEvent(new Event("pagehide"));
  }
});
test("observer limits two unsettled requests and reset invalidates late callbacks without freeing physical slots", async () => {
  const url = locationFor(),
    events: any[] = [];
  const observer = createHistoryTextObserver((v) => events.push(v));
  const count = (event: string) =>
    events.filter((v) => v.event === event).length;
  let release!: (r: Response) => void;
  const pending = new Promise<Response>((r) => (release = r));
  observer.observe(url, "GET", pending, Date.now());
  observer.observe(url, "GET", pending, Date.now());
  // A third read of the open chat waits for a slot instead of failing (X9).
  observer.observe(url, "GET", pending, Date.now());
  assert.equal(events.length, 2);
  observer.cancel();
  // The reset drops the waiting read. A new read still waits: the reset reads keep their
  // physical slots until their promises settle.
  observer.observe(url, "GET", pending, Date.now());
  assert.equal(events.length, 2);
  release(Response.json(fixture("claude-selected-history")));
  await until(() => count("page") > 0);
  await pause();
  await pause();
  // The reset reads end silently; only the read made after the reset is read.
  assert.equal(count("start"), 3);
  assert.equal(count("page"), 1);
  observer.observe(
    url,
    "GET",
    Promise.resolve(Response.json(fixture("claude-selected-history"))),
    Date.now(),
  );
  await until(() => count("page") === 2);
  observer.cancel();
});
test("actual Gemini RPC observation preserves literal host body and uses only the selected history frame", async () => {
  locationFor("gemini");
  const evidence = fixture("gemini-selected-history");
  const wire = readFileSync(
    new URL(
      "../../../fixtures/history-observation-2026-09-14/gemini-history-wire.txt",
      import.meta.url,
    ),
    "utf8",
  );
  const messages: any[] = [],
    calls: any[] = [];
  const native = function (...args: any[]) {
    calls.push(args);
    return Promise.resolve(new Response(wire));
  };
  class WindowDouble extends EventTarget {
    fetch = native;
    WebSocket = class {} as any;
    postMessage(value: any, _origin?: string, ports?: MessagePort[]) {
      messages.push(value);
      if (value.channel === PROVIDER_STREAM_CHANNEL) {
        ports?.[0]?.postMessage({ accepted: true });
        ports?.[0]?.close();
      }
    }
  }
  const win = new WindowDouble();
  Object.assign(globalThis, { window: win });
  installCapture();
  try {
    const body = new URLSearchParams({
      "f.req": JSON.stringify([
        [
          [
            "hNvQHb",
            JSON.stringify(evidence.request_arguments),
            null,
            "generic",
          ],
        ],
      ]),
    }).toString();
    const init = { method: "POST", body };
    const response = await win.fetch(
      "https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=hNvQHb",
      init,
    );
    assert.equal(await response.text(), wire);
    assert.equal(calls[0][1], init);
    await until(() =>
      messages.some(
        (m) => m.channel === PROVIDER_STREAM_CHANNEL && m.event === "finish",
      ),
    );
    const rows = messages.filter((m) => m.channel === PROVIDER_STREAM_CHANNEL && m.event === "batch").flatMap((m) => m.rows);
    const meta = messages.find((m) => m.channel === PROVIDER_STREAM_CHANNEL && m.event === "finish").meta;
    assert.equal(rows.length, 10);
    assert.equal(meta.firstRequestVerified, true);
    assert.equal(rows[1].message.dateBasis, "turn_created");
    assert.ok(
      rows.every(
        ({ message: m }: any) =>
          m.requestId === m.promptSourceId &&
          m.liveAttemptId === (m.role === "response" ? m.sourceId : null),
      ),
    );
    const count = messages.length;
    await win.fetch(
      "https://gemini.google.com/_/BardChatUi/data/batchexecute",
      { method: "POST", body: body.replace("hNvQHb", "otherRPC") },
    );
    await pause();
    assert.equal(messages.length, count);
    assert.equal(calls.length, 2);
  } finally {
    win.dispatchEvent(new Event("pagehide"));
  }
});
test("a Gemini history read sent as fetch(new Request(url, {method, body})) is read from a clone of the request (19 Oct 2026)", async () => {
  locationFor("gemini");
  const evidence = fixture("gemini-selected-history");
  const wire = readFileSync(
    new URL(
      "../../../fixtures/history-observation-2026-09-14/gemini-history-wire.txt",
      import.meta.url,
    ),
    "utf8",
  );
  const messages: any[] = [],
    calls: any[][] = [],
    sentBodies: string[] = [];
  // The network answers as soon as the request body was sent, and the page reads the
  // response at once: its handlers were registered before the tracker could read the
  // request body, so the tracker must have copied the response before them.
  const native = async (...args: any[]) => {
    calls.push(args);
    sentBodies.push(await (args[0] as Request).text());
    return new Response(wire);
  };
  class WindowDouble extends EventTarget {
    fetch = native;
    WebSocket = class {} as any;
    postMessage(value: any, _origin?: string, ports?: MessagePort[]) {
      messages.push(value);
      if (value.channel === PROVIDER_STREAM_CHANNEL) {
        ports?.[0]?.postMessage({ accepted: true });
        ports?.[0]?.close();
      }
    }
  }
  const win = new WindowDouble();
  Object.assign(globalThis, { window: win });
  installCapture();
  const finishes = () =>
    messages.filter(
      (m) => m.channel === PROVIDER_STREAM_CHANNEL && m.event === "finish",
    );
  try {
    const body = new URLSearchParams({
      "f.req": JSON.stringify([
        [["hNvQHb", JSON.stringify(evidence.request_arguments), null, "generic"]],
      ]),
      at: "synthetic",
    }).toString();
    const url =
      "https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=hNvQHb&rt=c";
    // The page's shape since 19 Oct 2026 (no second argument), and a second argument
    // without a body.
    for (const [index, extra] of [[], [{ credentials: "include" }]].entries()) {
      const request = new Request(url, { method: "POST", body });
      const response = await win.fetch(request, ...(extra as [RequestInit?]));
      // The page's own request reaches the network unchanged, body included.
      assert.equal(calls[index]!.length, 1 + extra.length);
      assert.equal(calls[index]![0], request);
      assert.equal(calls[index]![1], extra[0]);
      assert.equal(sentBodies[index], body);
      assert.equal(await response.text(), wire);
      await until(() => finishes().length === index + 1);
    }
    const rows = messages
      .filter((m) => m.channel === PROVIDER_STREAM_CHANNEL && m.event === "batch")
      .flatMap((m) => m.rows);
    assert.equal(rows.length, 20);
    assert.ok(finishes().every((m) => m.meta.firstRequestVerified === true));
    // Another RPC sent the same way is still not a history read.
    const count = messages.length;
    await win.fetch(
      new Request(url.replace("hNvQHb", "otherRPC"), {
        method: "POST",
        body: body.replace("hNvQHb", "otherRPC"),
      }),
    );
    await pause();
    await pause();
    assert.equal(messages.length, count);
  } finally {
    win.dispatchEvent(new Event("pagehide"));
  }
});
test("host accessors execute only in the original call and cannot authorize history observation", async () => {
  const url = locationFor(),
    messages: any[] = [];
  let reads = 0;
  const native = (_url: any, init: any) => {
    assert.equal(init.method, "GET");
    return Promise.resolve(new Response("{}"));
  };
  class WindowDouble extends EventTarget {
    fetch = native;
    WebSocket = class {} as any;
    postMessage(value: any) {
      messages.push(value);
    }
  }
  const win = new WindowDouble();
  Object.assign(globalThis, { window: win });
  installCapture();
  try {
    await win.fetch(url.href, {
      get method() {
        reads++;
        return "GET";
      },
    });
    await pause();
    assert.equal(reads, 1);
    assert.equal(messages.length, 0);
  } finally {
    win.dispatchEvent(new Event("pagehide"));
  }
});
test("only exact current same-origin history route is observed; malformed responses remain explicitly unsupported", async () => {
  const url = locationFor(),
    events: any[] = [];
  const observer = createHistoryTextObserver((v) => events.push(v));
  for (const target of [
    new URL(url.href.replace("claude.ai", "other.example")),
    new URL(url.href.replace(id, crypto.randomUUID())),
    new URL(url.origin + url.pathname + "/other"),
  ])
    observer.observe(
      target,
      "GET",
      Promise.resolve(new Response("{}")),
      Date.now(),
    );
  observer.observe(
    url,
    "POST",
    Promise.resolve(new Response("{}")),
    Date.now(),
  );
  assert.equal(events.length, 0);
  observer.observe(url, "GET", Promise.resolve(new Response("{")), Date.now());
  await until(() => events.length === 2);
  assert.equal(events[1].page.status, "unsupported");
  observer.cancel();
});
test("a history read that starts just before the address changes binds once the route matches", async () => {
  for (const site of ["claude", "chatgpt", "perplexity"] as const) {
    const url = locationFor(site);
    const route = location.pathname;
    // Measured on Claude: the chat request starts 3-6 ms before pushState.
    Object.assign(location, { pathname: "/recents" });
    const events: any[] = [];
    const observer = createHistoryTextObserver((v) => events.push(v));
    const body =
      site === "claude"
        ? JSON.stringify(fixture("claude-selected-history"))
        : "{";
    assert.equal(
      observer.observe(
        url,
        "GET",
        Promise.resolve(new Response(body)),
        Date.now(),
      ),
      true,
    );
    await pause();
    assert.equal(events.length, 0, `${site} waits silently for the route`);
    Object.assign(location, { pathname: route });
    await until(() => events.length === 2);
    assert.equal(events[0].event, "start");
    assert.equal(events[0].conversationId, id);
    if (site === "claude") assert.ok(events[1].page.messages.length > 0);
    else assert.equal(events[1].page.status, "unsupported");
    observer.cancel();
  }
});
test("a ChatGPT project chat read survives the page's move to the project's named address", async () => {
  const url = locationFor("chatgpt");
  // Live QA of 19 October 2026: a project chat opened by full load at /g/g-p-<id>/c/<chat>
  // moves to /g/g-p-<id>-<name>/c/<chat> while its saved messages load.
  const project = "g-p-67a1b2c3d4e5f60718293a4b5c6d7e8f";
  Object.assign(location, { pathname: `/g/${project}/c/${id}` });
  const events: any[] = [];
  const observer = createHistoryTextObserver((v) => events.push(v));
  let respond!: (response: Response) => void;
  const response = new Promise<Response>((resolve) => {
    respond = resolve;
  });
  try {
    assert.equal(observer.observe(url, "GET", response, Date.now()), true);
    await until(() => events.length === 1);
    assert.equal(events[0].event, "start");
    Object.assign(location, { pathname: `/g/${project}-energy-study/c/${id}` });
    respond(new Response(JSON.stringify(fixture("chatgpt-flat-page"))));
    await until(() => events.length === 2);
    assert.equal(events[1].event, "page");
    assert.ok(events[1].page.messages.length > 0);
    // A move to another chat still ends a read.
    const other = crypto.randomUUID();
    const late: any[] = [];
    const second = createHistoryTextObserver((v) => late.push(v));
    let answer!: (response: Response) => void;
    second.observe(
      url,
      "GET",
      new Promise<Response>((resolve) => {
        answer = resolve;
      }),
      Date.now(),
    );
    await until(() => late.length === 1);
    Object.assign(location, { pathname: `/g/${project}-energy-study/c/${other}` });
    answer(new Response(JSON.stringify(fixture("chatgpt-flat-page"))));
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(late.length, 1);
    second.cancel();
  } finally {
    observer.cancel();
  }
});
test("reads for chats that never open emit nothing, leave the budget and cancel their clones", async () => {
  const url = locationFor();
  let cancelled = 0;
  const original = ReadableStream.prototype.cancel;
  ReadableStream.prototype.cancel = function (this: ReadableStream, reason) {
    cancelled++;
    return Reflect.apply(original, this, [reason]);
  };
  const events: any[] = [];
  let observer!: ReturnType<typeof createHistoryTextObserver>;
  try {
    // The observer keeps the cancel function it finds at creation.
    observer = createHistoryTextObserver((v) => events.push(v));
  } finally {
    ReadableStream.prototype.cancel = original;
  }
  for (let i = 0; i < 6; i++)
    observer.observe(
      new URL(url.href.replace(id, crypto.randomUUID())),
      "GET",
      Promise.resolve(new Response("{}")),
      Date.now(),
    );
  // Six prefetches never block the chat being shown.
  observer.observe(url, "GET", Promise.resolve(new Response("{")), Date.now());
  await until(() => events.length === 2);
  assert.equal(events[0].conversationId, id);
  // Two are evicted by the cap at once; the rest expire a second after their response.
  await until(() => cancelled >= 6);
  await pause();
  assert.equal(events.length, 2);
  observer.cancel();
});
test("a navigation reset keeps a read waiting for the chat now shown, while a full cancel drops it", async () => {
  const url = locationFor();
  const route = location.pathname;
  for (const keep of [true, false]) {
    Object.assign(location, { pathname: "/new" });
    const events: any[] = [];
    const observer = createHistoryTextObserver((v) => events.push(v));
    observer.observe(url, "GET", Promise.resolve(new Response("{")), Date.now());
    Object.assign(location, { pathname: route });
    // The content script's route scan can reset before the next route check.
    observer.cancel(keep);
    if (keep) await until(() => events.length === 2);
    else {
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.equal(events.length, 0);
    }
    observer.cancel();
  }
});
test("empty chunk flood is bounded and canceling observed clone preserves original response text", async () => {
  const url = locationFor(),
    events: any[] = [];
  let pulls = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      pulls++;
      if (pulls < 9000) c.enqueue(new Uint8Array());
      else {
        c.enqueue(new TextEncoder().encode("{}"));
        c.close();
      }
    },
  });
  const original = new Response(stream),
    observer = createHistoryTextObserver((v) => events.push(v));
  observer.observe(url, "GET", Promise.resolve(original), Date.now());
  assert.equal(await original.text(), "{}");
  await until(() => events.some((v) => v.event === "page"));
  assert.equal(events.at(-1).page.status, "unsupported");
  observer.cancel();
});
test("coherent Perplexity first-entry proof survives private worker and HistoryService admission without counting the pointer twice", async () => {
  const worker = workerCounter(),
    db = await Ledger.open("pplx-first-available-" + crypto.randomUUID());
  let calls = 0;
  const coordinator = new Coordinator(db, {
    count: worker.count,
    hasConsent: async () => true,
    hasSiteConsent: async () => true,
    sendDisplay: async () => {},
    transport: async () => {
      calls++;
      throw new Error("unexpected personal network");
    },
  });
  try {
    await coordinator.whenReady();
    const populated = fixture("perplexity-workflow-page");
    for (const entry of populated.entries) {
      entry.user_selected_model = "pplx_pro";
      entry.display_model = "gpt56_terra";
    }
    const page = parseHistoryText(
      "perplexity",
      populated,
      id,
      new Date().toISOString(),
    );
    assert.ok(validHistoryTextPage(page));
    const binding = {
      documentNonce: crypto.randomUUID(),
      navigationNonce: crypto.randomUUID(),
      captureId: null,
    };
    const sender = {
      tab: { id: 74 },
      frameId: 0,
      documentId: "synthetic-pplx-history-document",
      url: `https://www.perplexity.ai/search/${id}`,
    };
    const common = {
      channel: HISTORY_CAPTURE_CHANNEL,
      id: crypto.randomUUID(),
      site: page.site,
      conversationId: id,
      observedAt: page.observedAt,
    } as const;
    assert.deepEqual(
      await coordinator.history.receive(
        { ...common, event: "start", page: null },
        binding,
        sender,
      ),
      { accepted: true },
    );
    assert.deepEqual(
      await coordinator.history.receive(
        { ...common, event: "page", page },
        binding,
        sender,
      ),
      { accepted: true },
    );
    const view = await coordinator.routeSummary("perplexity", id, binding);
    assert.equal(view.history.local.first_request_verified, true);
    assert.equal(view.history.local.branch_scope, "loaded_messages");
    assert.equal(view.history.local.prompt_count, "2");
    assert.equal(view.history.local.response_count, "2");
    assert.equal(view.history.local.provider_history_complete, false);
    assert.equal(calls, 0);
    assert.equal((await db.all("requests")).length, 0);
    assert.equal((await db.all("attempts")).length, 0);
  } finally {
    coordinator.history.invalidate();
    db.close();
    await worker.close();
  }
});
