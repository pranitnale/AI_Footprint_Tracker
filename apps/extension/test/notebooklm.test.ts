import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Ledger } from "@footprint/ledger";
import type { HistoryMessage } from "@footprint/contracts";
import {
  initialSnapshot,
  NotebooklmChatSession,
  NotebooklmGuideSession,
  parseDispatch,
} from "@footprint/adapters";
import { timingEvidence } from "@footprint/capture-core";
import { installCapture } from "../lib/capture-runtime";
import { Coordinator } from "../lib/coordinator";
import { createHistoryTextObserver } from "../lib/passive-history-text";
import { combinedUsage } from "../lib/history-presentation";
import {
  historyReadKind,
  historyRequestConversation,
} from "../lib/history-route";
import {
  HISTORY_CAPTURE_CHANNEL,
  HISTORY_DIAGNOSTIC_CHANNEL,
  validateHistoryCapture,
  validateHistoryDiagnostic,
  validHistoryTextPage,
  validStudioPairs,
} from "../lib/history-capture";
import { CHANNEL, validateCapture } from "../lib/bridge";
import {
  PROVIDER_STREAM_CHANNEL,
  validateProviderStreamCapture,
} from "../lib/provider-history-message";
import { summarize } from "../lib/summary";
import { savedCompanyId } from "../lib/company-identity";
import { countByTextLength, unavailableCount } from "./counting-fixture";

// W9 NotebookLM, shapes as seen on 1 and 3 Oct 2026; ids and text are synthetic.
const NOTEBOOK = "f0000000-0000-4000-8000-0000000000a1";
const OTHER = "f0000000-0000-4000-8000-0000000000b2";
const SESSION = "11111111-1111-4111-8111-111111111111";
const TURN = "22222222-2222-4222-8222-222222222222";
const SOURCE = "33333333-3333-4333-8333-333333333333";
const origin = "https://notebook.google.com";
const path = `/notebook/${NOTEBOOK}`;
const CHAT =
  origin +
  "/_/LabsTailwindUi/data/google.internal.labs.tailwind.orchestration.v1.LabsTailwindOrchestrationService/GenerateFreeFormStreamed?bl=boq&authuser=3&_reqid=1&rt=c";
const batch = (rpc: string, sourcePath: string | null = path) =>
  `${origin}/_/LabsTailwindUi/data/batchexecute?rpcids=${rpc}${
    sourcePath === null ? "" : "&source-path=" + encodeURIComponent(sourcePath)
  }&authuser=3&rt=c`;
const FILTER = 'NOT artifact.status = "ARTIFACT_STATUS_SUGGESTED"';
const CONTEXT = [
  2,
  null,
  null,
  [1, null, null, null, null, null, null, null, null, null, [1]],
  [[1, 4, 8, 10, 14, 2, 3, 6]],
];
const request = (rpc: string, args: unknown[]) =>
  new URLSearchParams({
    "f.req": JSON.stringify([[[rpc, JSON.stringify(args), null, "generic"]]]),
    at: "synthetic",
  }).toString();
const listBody = (notebook = NOTEBOOK, filter = FILTER) =>
  request("gArtLc", [CONTEXT, notebook, filter]);
// An opened item's read as the page sends it since 5 Oct 2026: the id, then client options.
const ITEM_OPTIONS = [
  2,
  null,
  null,
  [1, null, null, null, null, null, null, null, null, null, [1]],
  [[1, 4, 8, 10, 14, 2, 3, 6, 7]],
];
const itemBody = (id: string) => request("v9rmvd", [id, ITEM_OPTIONS]);
const chatBody = new URLSearchParams({
  "f.req": JSON.stringify([
    null,
    JSON.stringify([
      [[[SOURCE]]],
      "What changed?",
      null,
      [2, null, [1]],
      SESSION,
    ]),
  ]),
  at: "synthetic",
}).toString();
const line = (rows: unknown[]) => {
  const text = JSON.stringify(rows);
  return `${text.length + 2}\n${text}\n`;
};
const wire = (rpc: string | null, payload: unknown) =>
  ")]}'\n\n" +
  line([
    ["wrb.fr", rpc, JSON.stringify(payload), null, null, null, "generic"],
  ]) +
  line([
    ["di", 40],
    ["af.httprm", 39, "-1", 7],
  ]) +
  line([["e", 4, null, null, 300]]);
function chatFrame(text: string, final = false) {
  const suggestions = ["One?", "Two?", "Three?"];
  return [
    [text, null, [SESSION, TURN, 1], null, [null, null, null, null, 1]],
    [[["an echoed source passage"]]],
    null,
    final ? [suggestions] : null,
    final ? true : null,
    final ? [suggestions.map((q) => [q, 1])] : null,
  ];
}
const frameLine = (inner: unknown) =>
  line([["wrb.fr", null, JSON.stringify(inner)]]);
const GUIDE = [
  [
    ["Summary of the source."],
    [
      [
        ["Q1?", "Prompt 1"],
        ["Q2?", "Prompt 2"],
        ["Q3?", "Prompt 3"],
      ],
    ],
    null,
    null,
    null,
    [
      [
        ["Q1?", 9],
        ["Q2?", 9],
        ["Q3?", 9],
      ],
    ],
  ],
  // On 5 Oct the id after the guide was not the notebook's id.
  "e0000000-0000-4000-8000-0000000000c3",
];
const CREATED: [number, number] = [1790876680, 18019000];
const FINISHED: [number, number] = [1790876695, 739509000];
const item = (n: number) =>
  `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function studio(
  id: string,
  type: number,
  status: number,
  fields: Record<number, unknown> = {},
) {
  const row: unknown[] = Array(38).fill(null);
  Object.assign(row, {
    0: id,
    1: "A title",
    2: type,
    3: [[[SOURCE], null, 4]],
    4: status,
    10: FINISHED,
    15: CREATED,
    17: [null, null, null, null, true],
    19: 1,
    21: "t".repeat(28),
    37: [true],
  });
  for (const [index, value] of Object.entries(fields))
    row[Number(index)] = value;
  return row;
}
const REPORT = [
  [[[[0, 12, [[[0, 12, ["Report text."]]], [null, 6]]]]], null, null, null, 1],
];
const QUIZ = JSON.stringify({
  quiz: [
    {
      question: "Q?",
      answerOptions: [{ text: "A", rationale: "R", isCorrect: true }],
      hint: "H",
    },
  ],
  topics: ["T"],
});
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5));
async function until(predicate: () => boolean) {
  for (let i = 0; i < 400 && !predicate(); i++) await tick();
  assert.ok(predicate());
}

/** A notebook page with the capture runtime installed; stream batches are accepted. */
function environment(
  pathname = path,
  pageFetch: typeof fetch = async () => new Response("unused"),
) {
  Object.assign(globalThis, {
    location: {
      origin,
      hostname: "notebook.google.com",
      pathname,
      href: origin + pathname + "?authuser=3",
    },
  });
  class NativeXHR extends EventTarget {
    ready = 1;
    code = 200;
    mode = "";
    value = "";
    url = "";
    get readyState() {
      return this.ready;
    }
    get status() {
      return this.code;
    }
    get responseType() {
      return this.mode;
    }
    get responseText() {
      return this.value;
    }
    get response() {
      return this.value;
    }
    get responseURL() {
      return this.url;
    }
    open(...args: unknown[]) {
      this.url = new URL(String(args[1]), origin).href;
      this.ready = 1;
      this.value = "";
    }
    send(..._args: unknown[]) {}
    append(text: string) {
      this.value += text;
      this.ready = 3;
      this.dispatchEvent(new Event("progress"));
    }
    finish(text?: string) {
      if (text !== undefined) this.value = text;
      this.ready = 4;
      this.dispatchEvent(new Event("load"));
      this.dispatchEvent(new Event("loadend"));
    }
    abort() {
      this.dispatchEvent(new Event("abort"));
      this.dispatchEvent(new Event("loadend"));
    }
  }
  class WindowDouble extends EventTarget {
    messages: any[] = [];
    XMLHttpRequest = NativeXHR as any;
    WebSocket = class {} as any;
    fetch: typeof fetch = pageFetch;
    /** While set, stream batches wait for their answer, so their reads hold a slot. */
    hold = false;
    held: MessagePort[] = [];
    postMessage(value: any, _origin?: string, ports?: MessagePort[]) {
      this.messages.push(value);
      const port = ports?.[0];
      if (value.channel !== PROVIDER_STREAM_CHANNEL || !port) return;
      if (this.hold) this.held.push(port);
      else {
        port.postMessage({ accepted: true });
        port.close();
      }
    }
    release() {
      this.hold = false;
      for (const port of this.held.splice(0)) {
        port.postMessage({ accepted: true });
        port.close();
      }
    }
  }
  const window = new WindowDouble();
  Object.assign(globalThis, { window });
  installCapture();
  return {
    window,
    NativeXHR,
    observations: () =>
      window.messages.filter(
        (m) => m.channel === "ai-footprint-observation-v1",
      ),
    history: () =>
      window.messages.filter(
        (m) =>
          m.channel === HISTORY_CAPTURE_CHANNEL ||
          m.channel === PROVIDER_STREAM_CHANNEL,
      ),
    close: () => window.dispatchEvent(new Event("pagehide")),
  };
}

test("W9 a NotebookLM chat send is captured in its notebook and completes with timing", () => {
  const env = environment();
  try {
    const xhr = new env.NativeXHR();
    xhr.open("POST", CHAT, true);
    xhr.send(chatBody);
    xhr.append(")]}'\n\n" + frameLine(chatFrame("Part")));
    xhr.append(frameLine(chatFrame("Part of the answer.", true)));
    xhr.finish();
    const [dispatch] = env.observations().filter((m) => m.event === "dispatch");
    // The body names only the chat session, so the notebook comes from the page's route.
    assert.equal(dispatch.dispatch.conversationId, NOTEBOOK);
    assert.equal(dispatch.dispatch.input, "What changed?");
    assert.equal(dispatch.dispatch.action, "send");
    const ends = env.observations().filter((m) => m.event === "end");
    assert.equal(ends.length, 1);
    assert.equal(ends[0].failure, null);
    assert.equal(ends[0].snapshot.state, "completed");
    assert.equal(ends[0].snapshot.text, "Part of the answer.");
    assert.equal(ends[0].snapshot.intermediate, "One?\nTwo?\nThree?");
    assert.equal(ends[0].timing?.source, "browser_request");
    // No saved read began: a chat is not history.
    assert.equal(env.history().length, 0);
  } finally {
    env.close();
  }
});

test("W9 a stopped NotebookLM reply is cancelled, not a tracking problem", () => {
  const env = environment();
  try {
    const xhr = new env.NativeXHR();
    xhr.open("POST", CHAT, true);
    xhr.send(chatBody);
    xhr.append(")]}'\n\n" + frameLine(chatFrame("Part")));
    xhr.abort();
    const [end] = env.observations().filter((m) => m.event === "end");
    assert.equal(end.snapshot.state, "cancelled");
    assert.equal(end.snapshot.text, "Part");
    assert.equal(end.failure, null);
    assert.equal(end.timing, null);
    // A request that ends normally before the last frame is a stop as well.
    const ended = new env.NativeXHR();
    ended.open("POST", CHAT, true);
    ended.send(chatBody);
    ended.append(")]}'\n\n" + frameLine(chatFrame("Half")));
    ended.finish();
    const last = env
      .observations()
      .filter((m) => m.event === "end")
      .at(-1);
    assert.equal(last.snapshot.state, "cancelled");
    assert.equal(last.snapshot.text, "Half");
    assert.equal(last.failure, null);
  } finally {
    env.close();
  }
});

test("W9 a notebook guide is captured as output of its notebook, not as a request", () => {
  const env = environment();
  try {
    const xhr = new env.NativeXHR();
    xhr.open("POST", batch("VfAZjd"), true);
    xhr.send(request("VfAZjd", [[2], NOTEBOOK]));
    xhr.finish(wire("VfAZjd", GUIDE));
    const [dispatch] = env.observations().filter((m) => m.event === "dispatch");
    assert.equal(dispatch.dispatch.action, "notebook_guide");
    assert.equal(dispatch.dispatch.input, "");
    assert.equal(dispatch.dispatch.conversationId, NOTEBOOK);
    // Every guide call of a notebook is one request, named before the reply arrives.
    assert.match(dispatch.dispatch.requestId, /^g_[0-9a-f]{16}$/);
    const [end] = env.observations().filter((m) => m.event === "end");
    assert.equal(end.failure, null);
    assert.equal(end.snapshot.state, "completed");
    assert.equal(end.snapshot.text, "");
    assert.equal(
      end.snapshot.intermediate,
      "Summary of the source.\nQ1?\nPrompt 1\nQ2?\nPrompt 2\nQ3?\nPrompt 3",
    );
    // The reply keeps the page's notebook and is named by its text.
    assert.equal(end.snapshot.conversationId, null);
    assert.match(end.snapshot.attemptId, /^g_[0-9a-f]{16}$/);
    assert.notEqual(end.snapshot.attemptId, dispatch.dispatch.requestId);
    assert.equal(validateCapture(dispatch, "notebook.google.com"), true);
    assert.equal(validateCapture(end, "notebook.google.com"), true);
    assert.equal(env.history().length, 0);
  } finally {
    env.close();
  }
  const summary = summarize(
    ["send", "notebook_guide"].map((action, index) => ({
      key: String(index),
      era: 1,
      record: {
        kind: "request",
        request_id: String(index),
        site: "notebooklm",
        action,
        model_id: null,
        dispatched_at: "2026-10-04T10:00:00.000Z",
        documents: {
          extracted_text: null,
          upload_count: null,
          types: [],
          processing: "none",
        },
        media: {
          input_images: [],
          requested_operations: [],
          coverage_reasons: [],
        },
      },
    })) as any,
    [],
  );
  assert.equal(summary.requests, 1);
  assert.equal(summary.tools.notebooklm, 1);
});

test("W9 the Studio list and opened items are read for the notebook they belong to", async () => {
  const env = environment();
  try {
    const list = new env.NativeXHR();
    list.open("POST", batch("gArtLc"), true);
    list.send(listBody());
    list.finish(
      wire("gArtLc", [
        [studio(item(1), 11, 3, { 34: REPORT }), studio(item(2), 4, 3)],
      ]),
    );
    await until(() => env.history().some((m) => m.event === "finish"));
    const events = env.history();
    assert.deepEqual(
      events.map((m) => m.event),
      ["start", "batch", "finish"],
    );
    assert.equal(events[0].conversationId, NOTEBOOK);
    assert.deepEqual(
      events[1].rows.map((row: any) => [
        row.message.role,
        row.message.sourceId,
      ]),
      [
        ["prompt", item(1)],
        ["response", item(1)],
        ["prompt", item(2)],
      ],
    );
    assert.equal(events[2].meta.messageCount, 3);
    for (const event of events.slice(1))
      assert.equal(validateProviderStreamCapture(event), true);
    // An opened quiz binds to the page it was sent from. Its read also carries the page
    // that shows the item, about 1.4 MB on 5 Oct 2026, which is not counted.
    const before = env.history().length;
    const opened = new env.NativeXHR();
    opened.open("POST", batch("v9rmvd"), true);
    opened.send(itemBody(item(2)));
    const viewer = `<html>${"x".repeat(1_400_000)}</html>`;
    opened.finish(
      wire("v9rmvd", [studio(item(2), 4, 3, { 9: [viewer, [2], null, QUIZ] })]),
    );
    await until(
      () => env.history().filter((m) => m.event === "finish").length === 2,
    );
    const rows = env
      .history()
      .slice(before)
      .find((m) => m.event === "batch").rows;
    assert.equal(rows[1].message.text, "Q?\nA\nR\nH\nT");
    // An empty Studio list is a complete read that adds nothing.
    const empty = new env.NativeXHR();
    empty.open("POST", batch("gArtLc"), true);
    empty.send(listBody());
    empty.finish(wire("gArtLc", [[]]));
    await until(
      () => env.history().filter((m) => m.event === "finish").length === 3,
    );
    const finish = env.history().at(-1);
    assert.equal(finish.meta.messageCount, 0);
    assert.equal(validateProviderStreamCapture(finish), true);
  } finally {
    env.close();
  }
});

test("W9 Studio reads of another notebook, filter or shape are not read", async () => {
  const env = environment();
  try {
    const cases: Array<[string, string]> = [
      [batch("gArtLc"), listBody(OTHER)],
      [batch("gArtLc"), listBody(NOTEBOOK, "")],
      [batch("gArtLc,wXbhsf"), listBody()],
      // An opened item without its page, or sent from another notebook.
      [batch("v9rmvd", null), itemBody(item(2))],
      [batch("v9rmvd", `/notebook/${OTHER}`), itemBody(item(2))],
      [batch("v9rmvd"), itemBody("not-an-id")],
      // Saved chat pages are read since 14 Oct 2026, but only in the shape the page sends.
      [batch("khqZz"), request("khqZz", [[2], null, null, "not-an-id", 20])],
      [batch("khqZz"), request("khqZz", [[2], null, null, SESSION])],
      [batch("khqZz", null), request("khqZz", [[2], null, null, SESSION, 20])],
    ];
    for (const [url, body] of cases) {
      const xhr = new env.NativeXHR();
      xhr.open("POST", url, true);
      xhr.send(body);
      xhr.finish(wire("gArtLc", [[studio(item(1), 11, 2)]]));
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.deepEqual(env.history(), []);
    assert.deepEqual(env.observations(), []);
  } finally {
    env.close();
  }
  const url = new URL(batch("v9rmvd"));
  assert.equal(
    historyRequestConversation("notebooklm", url, "POST", itemBody(item(2))),
    NOTEBOOK,
  );
  assert.equal(
    historyRequestConversation("notebooklm", url, "GET", itemBody(item(2))),
    null,
  );
  // The page now sends client options after the item's id (5 Oct 2026); any other extra
  // argument is a request shape not seen.
  assert.equal(
    historyRequestConversation(
      "notebooklm",
      url,
      "POST",
      request("v9rmvd", [item(2)]),
    ),
    NOTEBOOK,
  );
  for (const args of [
    [item(2), "options"],
    [item(2), ITEM_OPTIONS, null],
    [ITEM_OPTIONS, item(2)],
  ])
    assert.equal(
      historyRequestConversation(
        "notebooklm",
        url,
        "POST",
        request("v9rmvd", args),
      ),
      null,
    );
  assert.equal(
    historyReadKind("notebooklm", url, itemBody(item(2))),
    `v9rmvd:${item(2)}`,
  );
  assert.equal(
    historyReadKind("notebooklm", new URL(batch("gArtLc")), listBody()),
    "gArtLc",
  );
  assert.equal(historyReadKind("gemini", url, itemBody(item(2))), "");
});

test("W9 a waiting Studio list poll never replaces a waiting opened item", async () => {
  const env = environment();
  const read = (url: string, body: string, response: string) => {
    const xhr = new env.NativeXHR();
    xhr.open("POST", url, true);
    xhr.send(body);
    xhr.finish(response);
  };
  try {
    // Two reads hold both slots while their rows are counted.
    env.window.hold = true;
    for (const id of [item(7), item(8)])
      read(batch("v9rmvd"), itemBody(id), wire("v9rmvd", [studio(id, 11, 3)]));
    await until(() => env.window.held.length === 2);
    read(
      batch("v9rmvd"),
      itemBody(item(9)),
      wire("v9rmvd", [studio(item(9), 4, 3, { 9: ["", [2], null, QUIZ] })]),
    );
    for (let poll = 0; poll < 2; poll++)
      read(
        batch("gArtLc"),
        listBody(),
        wire("gArtLc", [[studio(item(1), 11, 2)]]),
      );
    await tick();
    assert.equal(env.history().filter((m) => m.event === "start").length, 2);
    env.window.release();
    await until(
      () => env.history().filter((m) => m.event === "finish").length === 4,
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    // Both busy reads, the opened quiz and the newest list poll; the older poll is replaced.
    assert.equal(env.history().filter((m) => m.event === "start").length, 4);
    const quiz = env
      .history()
      .filter((m) => m.event === "batch")
      .flatMap((m) => m.rows)
      .find((row: any) => row.message.role === "response");
    assert.equal(quiz.message.sourceId, item(9));
  } finally {
    env.close();
  }
});

test("W9 a Studio read the page opens but never sends is reported as a limit, never lost silently", () => {
  const env = environment();
  try {
    for (let i = 0; i < 20; i++)
      new env.NativeXHR().open("POST", batch("gArtLc"), true);
    const diagnostics = env.window.messages.filter(
      (m) => m.channel === HISTORY_DIAGNOSTIC_CHANNEL,
    );
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].conversationId, NOTEBOOK);
    assert.equal(diagnostics[0].reason, "history_limit");
    assert.ok(validateHistoryDiagnostic(diagnostics[0], "notebook.google.com"));
  } finally {
    env.close();
  }
});

test("W9 NotebookLM Studio rows have no live request, and no other site's row may skip live matching", () => {
  const prompt = {
    sourceId: item(1),
    role: "prompt",
    promptSourceId: item(1),
    parentSourceId: null,
    parentRole: null,
    requestId: null,
    liveAttemptId: null,
    timing: null,
    occurredAt: null,
    dateBasis: "unknown",
    modelId: null,
    text: "",
    complete: false,
    inlineFiles: null,
    coverageReasons: ["no_live_request"],
  };
  const response = {
    ...prompt,
    role: "response",
    parentSourceId: item(1),
    parentRole: "prompt",
    text: "Report text.",
    complete: true,
    timing: timingEvidence(15.7, "notebooklm_history"),
  };
  const page = (
    messages: unknown[],
    site = "notebooklm",
    conversationId = NOTEBOOK,
  ) => ({
    site,
    conversationId,
    observedAt: "2026-10-04T12:00:00.000Z",
    messages,
    firstRequestVerified: false,
    rootSourceId: null,
    selectedLeafId: null,
    branchSourceIds: null,
    branchScope: "loaded_messages",
    hasEarlier: null,
    hasLater: null,
    status: "partial",
  });
  assert.equal(validHistoryTextPage(page([prompt, response])), true);
  // A NotebookLM row without the reason is a saved chat turn (14 Oct 2026), which waits for
  // a live match; one read never mixes the two. No other site's row may skip live matching.
  const { coverageReasons: _reasons, ...plain } = prompt;
  assert.equal(validHistoryTextPage(page([plain])), true);
  assert.equal(validHistoryTextPage(page([plain, response])), false);
  assert.equal(
    validHistoryTextPage(
      page(
        [{ ...prompt, sourceId: SESSION, promptSourceId: SESSION }],
        "perplexity",
        SESSION,
      ),
    ),
    false,
  );
  // Studio rows never name a live attempt or a branch.
  assert.equal(
    validHistoryTextPage(
      page([prompt, { ...response, liveAttemptId: item(1) }]),
    ),
    false,
  );
  assert.equal(
    validHistoryTextPage({
      ...page([prompt]),
      firstRequestVerified: true,
      rootSourceId: item(1),
      hasEarlier: false,
    }),
    false,
  );
  assert.equal(validStudioPairs([prompt, response] as any), true);
  assert.equal(validStudioPairs([response] as any), false);
  assert.equal(
    validStudioPairs([
      prompt,
      {
        ...response,
        sourceId: item(2),
        promptSourceId: item(2),
        parentSourceId: item(2),
      },
    ] as any),
    false,
  );
  // An empty list may finish only for NotebookLM.
  const finish = (
    site: string,
    conversationId: string,
    meta: Record<string, unknown> = {},
  ) =>
    validateProviderStreamCapture({
      channel: PROVIDER_STREAM_CHANNEL,
      id: crypto.randomUUID(),
      site,
      conversationId,
      observedAt: "2026-10-04T12:00:00.000Z",
      event: "finish",
      rows: null,
      meta: {
        messageCount: 0,
        firstRequestVerified: false,
        rootSourceId: null,
        selectedLeafId: null,
        branchScope: "loaded_messages",
        hasEarlier: null,
        hasLater: null,
        ...meta,
      },
    });
  assert.equal(finish("notebooklm", NOTEBOOK), true);
  assert.equal(finish("perplexity", SESSION), false);
  assert.equal(finish("notebooklm", NOTEBOOK, { hasLater: false }), false);
  assert.equal(finish("notebooklm", NOTEBOOK, { messageCount: -1 }), false);
});

test("W9 review: Studio prompts hold no text, and side captures claim no prompt", () => {
  const prompt = {
    sourceId: item(1),
    role: "prompt",
    promptSourceId: item(1),
    parentSourceId: null,
    parentRole: null,
    requestId: null,
    liveAttemptId: null,
    timing: null,
    occurredAt: null,
    dateBasis: "unknown",
    modelId: null,
    text: "",
    complete: false,
    inlineFiles: null,
    coverageReasons: ["no_live_request"],
  };
  const titled = { ...prompt, text: "A renamed title", complete: true };
  const observedAt = "2026-10-04T12:00:00.000Z";
  const page = (messages: unknown[]) =>
    validateHistoryCapture(
      {
        channel: HISTORY_CAPTURE_CHANNEL,
        event: "page",
        id: crypto.randomUUID(),
        site: "notebooklm",
        conversationId: NOTEBOOK,
        observedAt,
        page: {
          site: "notebooklm",
          conversationId: NOTEBOOK,
          observedAt,
          messages,
          firstRequestVerified: false,
          rootSourceId: null,
          selectedLeafId: null,
          branchSourceIds: null,
          branchScope: "loaded_messages",
          hasEarlier: null,
          hasLater: null,
          status: "partial",
        },
      },
      "notebook.google.com",
    );
  assert.equal(page([prompt]), true);
  // A title is never counted as a Studio request's text.
  assert.equal(page([titled]), false);
  assert.equal(page([{ ...prompt, text: "A renamed title" }]), false);
  assert.equal(page([{ ...prompt, complete: true }]), false);
  const batch = (message: unknown) =>
    validateProviderStreamCapture({
      channel: PROVIDER_STREAM_CHANNEL,
      id: crypto.randomUUID(),
      site: "notebooklm",
      conversationId: NOTEBOOK,
      observedAt,
      event: "batch",
      rows: [{ message, requestRef: null, parentRef: null }],
      meta: null,
    });
  assert.equal(batch(prompt), true);
  assert.equal(batch(titled), false);
  // A side capture sends no prompt, attaches nothing and joins no turn.
  const dispatch = (site: "notebooklm" | "chatgpt", changes = {}) =>
    validateCapture(
      {
        channel: CHANNEL,
        version: 1,
        id: crypto.randomUUID(),
        revision: 1,
        event: "dispatch",
        site,
        at: observedAt,
        dispatch: {
          site,
          action: site === "notebooklm" ? "notebook_guide" : "read_aloud",
          input: "",
          conversationId: site === "notebooklm" ? NOTEBOOK : SESSION,
          parentId: null,
          requestId: null,
          model: null,
          attachments: 0,
          imageEditParentId: null,
          inputImages: [],
          ...changes,
        },
        snapshot: initialSnapshot(),
        failure: null,
        timing: null,
      },
      site === "notebooklm" ? "notebook.google.com" : "chatgpt.com",
    );
  for (const site of ["notebooklm", "chatgpt"] as const) {
    assert.equal(dispatch(site), true, site);
    for (const changes of [
      { input: "A fabricated prompt" },
      { attachments: 1 },
      { attachments: null },
      { parentId: SESSION },
      { requestId: SESSION },
      { model: "notebooklm-default" },
      { imageEditParentId: SESSION },
      { inputImages: [{ width: null, height: null }] },
    ])
      assert.equal(
        dispatch(site, changes),
        false,
        JSON.stringify([site, changes]),
      );
  }
  for (const site of ["notebooklm", "chatgpt"] as const)
    assert.equal(dispatch(site, { input: null }), false, site);
  // The one request id a side capture may carry names a notebook's guide request.
  const guideRequest = { requestId: "g_0123456789abcdef" };
  assert.equal(dispatch("notebooklm", guideRequest), true);
  assert.equal(dispatch("chatgpt", guideRequest), false);
  assert.equal(
    dispatch("notebooklm", { requestId: "g_0123456789ABCDEF" }),
    false,
  );
});

async function setup(
  t: TestContext,
  count: typeof countByTextLength = countByTextLength,
) {
  Object.assign(globalThis, {
    location: {
      origin,
      hostname: "notebook.google.com",
      pathname: path,
      href: origin + path,
    },
  });
  const db = await Ledger.open(`notebooklm-${crypto.randomUUID()}`);
  const displays: any[] = [];
  const coordinator = new Coordinator(db, {
    count,
    hasConsent: async () => true,
    hasSiteConsent: async () => true,
    sendDisplay: async (_tab: unknown, message: any) => {
      displays.push(message);
    },
    transport: async () => {
      throw new Error("unexpected network");
    },
  });
  t.after(() => {
    coordinator.history.invalidate();
    coordinator.engines.dispose();
    db.close();
  });
  await coordinator.whenReady();
  const binding = {
    documentNonce: crypto.randomUUID(),
    navigationNonce: crypto.randomUUID(),
    captureId: null,
  };
  const sender = {
    tab: { id: 909 },
    frameId: 0,
    documentId: "synthetic-notebooklm",
    url: origin + path,
  };
  const reopen = async (rpc: string, body: string, response: string) => {
    let started: Promise<unknown> = Promise.resolve();
    let finish!: (accepted: boolean) => void;
    const finished = new Promise<boolean>((resolve) => (finish = resolve));
    const observer = createHistoryTextObserver(
      (event) => {
        if (event.event === "start")
          started = coordinator.history.receive(event, binding, sender);
      },
      () => {},
      async (event) => {
        await started;
        const result = await coordinator.history.receiveStream(
          event,
          binding,
          sender,
        );
        if (event.event === "finish") finish(result.accepted);
        return result.accepted;
      },
    );
    try {
      observer.observe(
        new URL(batch(rpc)),
        "POST",
        Promise.resolve(new Response(response)),
        Date.now(),
        body,
      );
      assert.equal(
        await Promise.race([
          finished,
          new Promise<boolean>((_, reject) =>
            setTimeout(() => reject(new Error("history timeout")), 15000),
          ),
        ]),
        true,
      );
    } finally {
      observer.cancel();
    }
    await coordinator.engines.maintainLocal();
  };
  const records = async () =>
    (await db.all<{ record: HistoryMessage }>("history_records")).map(
      (row) => row.record,
    );
  return { coordinator, db, sender, binding, displays, reopen, records };
}

const capture = (
  id: string,
  revision: number,
  event: "dispatch" | "end",
  action: "send" | "notebook_guide",
  snapshot: ReturnType<typeof initialSnapshot>,
  timing: unknown = null,
): any => ({
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
          site: "notebooklm",
          action,
          input: action === "send" ? "What changed?" : "",
          conversationId: NOTEBOOK,
          parentId: null,
          // A guide's request is named by its notebook, as the adapter names it.
          requestId:
            action === "notebook_guide"
              ? parseDispatch("notebooklm", new URL(batch("VfAZjd")), "")
                  .requestId
              : null,
          model: null,
          attachments: 0,
          imageEditParentId: null,
          inputImages: [],
        }
      : null,
  snapshot,
  failure: null,
  timing,
});

/** A guide end as the page's session reports it: named by its text, not by its notebook. */
function guideRead(summary: string) {
  const session = new NotebooklmGuideSession(new URL(batch("VfAZjd")));
  session.gemini([
    [
      "wrb.fr",
      "VfAZjd",
      JSON.stringify([
        [[summary], [[["Q?", "Prompt"]]]],
        "e0000000-0000-4000-8000-0000000000c3",
      ]),
    ],
  ]);
  session.responseEnded();
  return session.snapshot();
}

test("W9 a saved guide the page reads again counts once, in its notebook", async (t) => {
  // Seen on 5 Oct 2026: the page asks for the guide the first time a notebook opens in a
  // page and gets the saved guide back unchanged. Each read counted as a new guide, under
  // an id that is not the notebook's, so the notebook's bar never showed it.
  const f = await setup(t);
  const read = async (summary: string) => {
    const id = crypto.randomUUID();
    await f.coordinator.capture(
      capture(id, 1, "dispatch", "notebook_guide", initialSnapshot()),
      f.sender,
    );
    await f.coordinator.capture(
      capture(id, 2, "end", "notebook_guide", guideRead(summary)),
      f.sender,
    );
  };
  const view = async () =>
    (await f.coordinator.routeSummary("notebooklm", NOTEBOOK)) as any;
  const output = (summary: string) => `${summary}\nQ?\nPrompt`.length;
  const saved = "Summary of the source.";
  await read(saved);
  let shown = await view();
  assert.equal(shown.summary.requests, 0);
  assert.equal(shown.summary.attempts, 1);
  assert.equal(shown.summary.tokens.output.value, String(output(saved)));
  const energy = shown.summary.metrics.energy.value;
  assert.ok(Number(energy) > 0);
  // The notebook opens in another page: the same guide is read and joins the first.
  // Live QA of 19 Oct 2026: each reread stored another request and attempt (six in five
  // minutes for one notebook). An unchanged guide now stores nothing.
  const rows = async (store: "requests" | "attempts") =>
    (await f.db.all<any>(store)).length;
  const aliased = async (store: "requests" | "attempts") =>
    (await f.db.all<any>(store)).filter((row) => row.aliasOf).length;
  for (let reopened = 0; reopened < 3; reopened++) await read(saved);
  shown = await view();
  assert.equal(shown.summary.attempts, 1);
  assert.equal(shown.summary.tokens.output.value, String(output(saved)));
  assert.equal(shown.summary.metrics.energy.value, energy);
  assert.equal(await rows("requests"), 1);
  assert.equal(await rows("attempts"), 1);
  assert.equal(await aliased("requests"), 0);
  assert.equal(await aliased("attempts"), 0);
  // A source is added and the page writes a new guide: another reply of the notebook's
  // one guide request, so it counts as well.
  const rewritten = "Summary of both sources.";
  await read(rewritten);
  shown = await view();
  assert.equal(shown.summary.attempts, 2);
  assert.equal(
    shown.summary.tokens.output.value,
    String(output(saved) + output(rewritten)),
  );
  assert.equal(shown.summary.requests, 0);
  assert.equal(await aliased("requests"), 1);
  assert.equal(await aliased("attempts"), 0);
  assert.equal(await rows("attempts"), 2);
});

test("W9 a notebook counts its live chats, guides and Studio items once, with exact request counts", async (t) => {
  const f = await setup(t);
  const chat = crypto.randomUUID();
  await f.coordinator.capture(
    capture(chat, 1, "dispatch", "send", initialSnapshot()),
    f.sender,
  );
  await f.coordinator.capture(
    capture(
      chat,
      2,
      "end",
      "send",
      {
        ...initialSnapshot(),
        text: "Part of the answer.",
        thinking: "",
        intermediate: "One?\nTwo?\nThree?",
        toolInput: "",
        toolOutput: "",
        state: "completed",
        started: true,
        conversationId: NOTEBOOK,
        outputId: TURN,
      },
      timingEvidence(4.1, "browser_request"),
    ),
    f.sender,
  );
  // The guide the page writes when a source is added adds output, never a request.
  const guide = crypto.randomUUID();
  await f.coordinator.capture(
    capture(guide, 1, "dispatch", "notebook_guide", initialSnapshot()),
    f.sender,
  );
  await f.coordinator.capture(
    capture(guide, 2, "end", "notebook_guide", {
      ...initialSnapshot(),
      text: "",
      thinking: "",
      intermediate: "Summary of the source.\nQ1?\nPrompt 1",
      toolInput: "",
      toolOutput: "",
      state: "completed",
      started: true,
      conversationId: NOTEBOOK,
    }),
    f.sender,
  );
  const requests = (await f.db.all<any>("requests")).map((row) => row.record);
  const saved = requests.find((r) => r.action === "notebook_guide");
  assert.deepEqual(saved.features, ["text"]);
  // The tab keeps showing the chat reply, never the guide.
  assert.ok(f.displays.every((d) => d.displayBinding?.captureId !== guide));
  // Studio: a ready report and an item still generating.
  await f.reopen(
    "gArtLc",
    listBody(),
    wire("gArtLc", [
      [studio(item(1), 11, 3, { 34: REPORT }), studio(item(2), 11, 2)],
    ]),
  );
  let view: any = await f.coordinator.routeSummary("notebooklm", NOTEBOOK);
  assert.equal(view.summary.requests, 1);
  assert.equal(view.history.local.prompt_count, "2");
  assert.equal(view.history.local.response_count, "1");
  // Studio rows never wait for a live match: the request count is exact.
  assert.equal(view.history.local.unresolved_overlap_message_count, "0");
  const combined = combinedUsage(view.summary, view.history)!;
  assert.equal(combined.matchingIncomplete, false);
  assert.equal(combined.requests, "3");
  const rows = await f.records();
  const report = rows.find((m) => m.role === "response")!;
  // A Studio request's instructions are not shown: zero tokens, read in part.
  for (const prompt of rows.filter((m) => m.role === "prompt")) {
    assert.equal(prompt.tokens.value, "0");
    assert.equal(prompt.tokens.completeness, "partial");
    assert.equal(prompt.text_complete, false);
  }
  assert.equal(
    report.parts!.answer_output.value,
    String("Report text.".length),
  );
  assert.equal(report.timing?.source, "notebooklm_history");
  assert.ok(report.coverage_reasons.includes("no_live_request"));
  assert.equal(report.model_id, "notebooklm-default");
  // A poll after the second item finished adds its reply; nothing counts twice.
  await f.reopen(
    "gArtLc",
    listBody(),
    wire("gArtLc", [
      [
        studio(item(1), 11, 3, { 34: REPORT }),
        studio(item(2), 11, 3, { 34: REPORT }),
      ],
    ]),
  );
  view = await f.coordinator.routeSummary("notebooklm", NOTEBOOK);
  assert.equal(view.history.local.prompt_count, "2");
  assert.equal(view.history.local.response_count, "2");
  assert.equal(view.history.local.conflicting_message_count, "0");
  const energy = view.history.local.resources.find(
    (row: any) => row.quantity === "energy",
  );
  assert.ok(energy && Number(energy.value) > 0);
});

test("W9 a guide in a notebook with no chat adds its output and energy to the bar", async (t) => {
  // Seen on 5 October 2026: with Studio items saved and no chat sent, the bar left the
  // guide out of Out and Electricity, because live figures counted only after a request.
  const f = await setup(t);
  const guide = crypto.randomUUID();
  const written = "Summary of the source.\nQ?\nPrompt";
  await f.coordinator.capture(
    capture(guide, 1, "dispatch", "notebook_guide", initialSnapshot()),
    f.sender,
  );
  await f.coordinator.capture(
    capture(
      guide,
      2,
      "end",
      "notebook_guide",
      guideRead("Summary of the source."),
    ),
    f.sender,
  );
  await f.reopen(
    "gArtLc",
    listBody(),
    wire("gArtLc", [[studio(item(1), 11, 3, { 34: REPORT })]]),
  );
  const view: any = await f.coordinator.routeSummary("notebooklm", NOTEBOOK);
  assert.equal(view.summary.requests, 0);
  const combined = combinedUsage(view.summary, view.history)!;
  assert.equal(combined.requests, "1");
  assert.equal(
    combined.output.value,
    String(written.length + "Report text.".length),
  );
  const live = Number(view.summary.metrics.energy.value);
  const saved = Number(
    view.history.local.resources.find((row: any) => row.quantity === "energy")
      .value,
  );
  assert.ok(live > 0 && saved > 0);
  assert.ok(Math.abs(Number(combined.energy.value) - (live + saved)) < 1e-12);
});

test("W9 a Studio reread whose count failed keeps every Studio request, and stuck rows heal", async (t) => {
  // Seen on 5 October 2026: a notebook reread just after the extension restarted showed
  // Req 0. Replies reuse their saved counts; the Studio prompts, read in part at zero, are
  // counted again, and that count failed.
  let counter: typeof countByTextLength = countByTextLength;
  const f = await setup(t, (request) => counter(request));
  const list = wire("gArtLc", [
    [
      studio(item(1), 11, 3, { 34: REPORT }),
      studio(item(2), 11, 3, { 34: REPORT }),
    ],
  ]);
  const local = async () =>
    (await f.coordinator.routeSummary("notebooklm", NOTEBOOK)).history.local;
  await f.reopen("gArtLc", listBody(), list);
  counter = unavailableCount;
  await f.reopen("gArtLc", listBody(), list);
  let view: any = await local();
  assert.equal(view.prompt_count, "2");
  assert.equal(view.response_count, "2");
  assert.equal(view.conflicting_message_count, "0");
  const input = view.tokens.find(
    (row: any) => row.role === "prompt" && row.part === "total",
  );
  assert.equal(input?.value, "0");
  assert.equal(input?.known_message_count, "2");
  // Rows an earlier build already marked as conflicts count again once a read matches.
  const raw = (f.db as unknown as { db: IDBDatabase }).db;
  await new Promise<void>((resolve, reject) => {
    const tx = raw.transaction("history_records", "readwrite");
    const store = tx.objectStore("history_records");
    const all = store.getAll();
    all.onsuccess = () => {
      for (const row of all.result)
        if (row.record.role === "prompt")
          store.put({ ...row, status: "conflict" });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  view = await local();
  assert.equal(view.prompt_count, "0");
  assert.equal(view.conflicting_message_count, "2");
  counter = countByTextLength;
  await f.reopen("gArtLc", listBody(), list);
  view = await local();
  assert.equal(view.prompt_count, "2");
  assert.equal(view.conflicting_message_count, "0");
});

// Saved chats, shapes as seen on 14 Oct 2026; ids and text are synthetic.
const turnId = (n: number) =>
  `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const turnTime = (n: number): [number, number] => [
  Math.floor(Date.now() / 1000) - 3600 + n,
  0,
];
const savedQuestion = (n: number) => [
  turnId(n),
  turnTime(n),
  1,
  `Question ${n}?`,
  null,
  2,
];
const savedAnswer = (n: number) => [
  turnId(n),
  turnTime(n),
  2,
  null,
  [
    [`Answer ${n}.`, null, [SOURCE], null, [null, null, null, null, 1]],
    [[["a quoted source passage"]]],
    null,
    [["One?", "Two?"]],
  ],
  2,
];
/** A page of turns as the page receives it: newest first, then any older-page token. */
const chatPage = (turns: unknown[][], older?: string) =>
  wire("khqZz", older === undefined ? [[...turns].reverse()] : [[...turns].reverse(), older]);
const chatRequest = (older?: string) =>
  request(
    "khqZz",
    older === undefined
      ? [CONTEXT, null, null, SESSION, 20]
      : [CONTEXT, null, null, SESSION, 20, older],
  );
const sessionsRequest = () => request("hPTbtc", [NOTEBOOK, [2]]);
const sessionList = (...sessions: string[]) =>
  wire("hPTbtc", [sessions.map((id) => [id, turnTime(0), turnTime(1)])]);

test("NB7 the page's session list is kept, and saved chat pages are read for their notebook", async () => {
  const env = environment();
  const read = (url: string, body: string, response: string) => {
    const xhr = new env.NativeXHR();
    xhr.open("POST", url, true);
    xhr.send(body);
    xhr.finish(response);
  };
  const finishes = () => env.history().filter((m) => m.event === "finish");
  try {
    read(batch("hPTbtc"), sessionsRequest(), sessionList(SESSION));
    await tick();
    // The session list is not a page of history: nothing is reported for it.
    assert.deepEqual(env.history(), []);
    read(
      batch("khqZz"),
      chatRequest(),
      chatPage([savedQuestion(1), savedAnswer(2)]),
    );
    await until(() => finishes().length === 1);
    const events = env.history();
    assert.deepEqual(
      events.map((m) => m.event),
      ["start", "batch", "finish"],
    );
    assert.equal(events[0].conversationId, NOTEBOOK);
    for (const event of events.slice(1))
      assert.equal(validateProviderStreamCapture(event), true);
    assert.deepEqual(
      events[1].rows.map((row: any) => [
        row.message.role,
        row.message.sourceId,
        row.message.liveAttemptId,
      ]),
      [
        ["prompt", turnId(1), null],
        ["response", turnId(2), turnId(2)],
      ],
    );
    // The oldest page of the notebook's one session proves its first message.
    assert.equal(events[2].meta.firstRequestVerified, true);
    assert.equal(events[2].meta.rootSourceId, turnId(1));
    assert.equal(events[2].meta.hasEarlier, false);
    // An older page the user scrolls to is read as well, and its token keeps it apart.
    read(
      batch("khqZz"),
      chatRequest("older-token"),
      chatPage([savedQuestion(3), savedAnswer(4)], "oldest-token"),
    );
    await until(() => finishes().length === 2);
    assert.equal(finishes()[1].meta.firstRequestVerified, false);
    assert.equal(finishes()[1].meta.hasEarlier, true);
    // A chat request answered by another read is refused, never read as Studio rows.
    const before = env.history().length;
    read(
      batch("khqZz"),
      chatRequest(),
      wire("gArtLc", [[studio(item(1), 11, 3, { 34: REPORT })]]),
    );
    await until(() => env.history().length > before + 1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(
      env
        .history()
        .slice(before)
        .every((m) => m.event !== "batch" && m.event !== "finish"),
    );
  } finally {
    env.close();
  }
  const url = new URL(batch("khqZz"));
  assert.equal(
    historyRequestConversation("notebooklm", url, "POST", chatRequest()),
    NOTEBOOK,
  );
  assert.equal(historyReadKind("notebooklm", url, chatRequest()), `khqZz:${SESSION}`);
  const older = historyReadKind("notebooklm", url, chatRequest("token-a"));
  assert.match(older, new RegExp(`^khqZz:${SESSION}:[0-9a-f]+$`));
  assert.notEqual(older, historyReadKind("notebooklm", url, chatRequest("token-b")));
  // A session list that does not name the page's notebook is not this notebook's.
  assert.equal(
    historyRequestConversation(
      "notebooklm",
      new URL(batch("hPTbtc")),
      "POST",
      request("hPTbtc", [OTHER, [2]]),
    ),
    null,
  );
});

/** Reads a notebook's session list and then pages of its saved chat, as the page does. */
async function readChat(
  f: Awaited<ReturnType<typeof setup>>,
  sessions: string | null,
  pages: Array<{ body: string; response: string }>,
) {
  let started: Promise<unknown> = Promise.resolve();
  const finished: boolean[] = [];
  const observer = createHistoryTextObserver(
    (event) => {
      if (event.event === "start")
        started = f.coordinator.history.receive(event, f.binding, f.sender);
    },
    () => {},
    async (event) => {
      await started;
      const result = await f.coordinator.history.receiveStream(
        event,
        f.binding,
        f.sender,
      );
      if (event.event === "finish") finished.push(result.accepted);
      return result.accepted;
    },
  );
  try {
    if (sessions !== null) {
      observer.observe(
        new URL(batch("hPTbtc")),
        "POST",
        Promise.resolve(new Response(sessions)),
        Date.now(),
        sessionsRequest(),
      );
      await tick();
    }
    for (const [index, page] of pages.entries()) {
      observer.observe(
        new URL(batch("khqZz")),
        "POST",
        Promise.resolve(new Response(page.response)),
        Date.now(),
        page.body,
      );
      for (let i = 0; i < 3000 && finished.length <= index; i++) await tick();
      assert.deepEqual(finished.slice(index), [true]);
    }
  } finally {
    observer.cancel();
  }
  await f.coordinator.engines.maintainLocal();
}

/**
 * A live frame as seen on 16 Oct 2026: `[sessionId, turnId, <number>]` at `[0][2]` from
 * the first frame; the last frame is final and carries the follow-up questions.
 */
const liveFrame = (text: string, turn: string, final: boolean) => [
  [text, null, [SESSION, turn, 2748674754], null, [null, null, null, null, 1]],
  [[["an echoed source passage"]]],
  null,
  final ? [["One?", "Two?"]] : null,
  final ? true : null,
  final ? [[["One?", 1], ["Two?", 1]]] : null,
];
/**
 * A chat send recorded live, its reply read by the page's own stream reader. The stream
 * names its reply by a turn id the saved page never shows (16 Oct 2026).
 */
async function sendLive(
  f: Awaited<ReturnType<typeof setup>>,
  answer: string,
  turn: string = crypto.randomUUID(),
) {
  const live = new NotebooklmChatSession();
  // Frames are cumulative: the answer grows, then the final frame ends it.
  for (const [index, size] of [1, 3, answer.length].entries())
    live.gemini([
      [
        "wrb.fr",
        null,
        JSON.stringify(liveFrame(answer.slice(0, size), turn, index === 2)),
      ],
    ]);
  const id = crypto.randomUUID();
  await f.coordinator.capture(
    capture(id, 1, "dispatch", "send", initialSnapshot()),
    f.sender,
  );
  await f.coordinator.capture(
    capture(
      id,
      2,
      "end",
      "send",
      live.snapshot(),
      timingEvidence(4.1, "browser_request"),
    ),
    f.sender,
  );
}

test("NB8 a saved chat turn recorded live counts once, and reading the page again adds nothing", async (t) => {
  const f = await setup(t);
  await sendLive(f, "Answer 2.");
  const view = async () =>
    (await f.coordinator.routeSummary("notebooklm", NOTEBOOK)) as any;
  const live = await view();
  assert.equal(live.summary.requests, 1);
  const liveOutput = live.summary.tokens.output.value;
  const liveEnergy = live.summary.metrics.energy.value;
  const page = {
    body: chatRequest(),
    response: chatPage([savedQuestion(1), savedAnswer(2)]),
  };
  for (let read = 0; read < 2; read++) {
    await readChat(f, sessionList(SESSION), [page]);
    const shown = await view();
    const local = shown.history.local;
    // The question and answer match the live request and reply: neither counts again.
    assert.equal(local.matched_live_message_count, "2", `read ${read}`);
    assert.equal(local.unresolved_overlap_message_count, "0");
    assert.equal(local.prompt_count, "0");
    assert.equal(local.response_count, "0");
    assert.equal(local.first_request_verified, true);
    const combined = combinedUsage(shown.summary, shown.history)!;
    assert.equal(combined.requests, "1");
    assert.equal(combined.matchingIncomplete, false);
    assert.equal(combined.loading, null);
    assert.equal(combined.output.value, liveOutput);
    assert.equal(shown.summary.metrics.energy.value, liveEnergy);
  }
  const rows = await f.records();
  assert.equal(rows.length, 2);
  // Only numbers are kept: no question or answer text is stored.
  const stored = JSON.stringify(rows);
  assert.doesNotMatch(stored, /Question 1|Answer 2|One\?/);
  for (const row of rows) {
    assert.equal(row.model_id, "notebooklm-default");
    assert.ok(!row.coverage_reasons.includes("no_live_request"));
  }
  // Without a live reply an organization names a saved answer by its own turn id (W11); a
  // linked one takes its live capture's key instead (`notebookReplyLinks`).
  assert.deepEqual(
    savedCompanyId("notebooklm", false, {
      role: "response",
      sourceId: turnId(2),
      requestId: null,
      liveAttemptId: turnId(2),
    }),
    { kind: "company-attempt", id: turnId(2) },
  );
});

test("NB9 saved turns not sent here count from history, older pages complete the chat, rereads add nothing", async (t) => {
  const f = await setup(t);
  const local = async () =>
    ((await f.coordinator.routeSummary("notebooklm", NOTEBOOK)) as any).history
      .local;
  const newest = {
    body: chatRequest(),
    response: chatPage([savedQuestion(3), savedAnswer(4)], "older-token"),
  };
  const oldest = {
    body: chatRequest("older-token"),
    response: chatPage([savedQuestion(1), savedAnswer(2)]),
  };
  await readChat(f, sessionList(SESSION), [newest]);
  let view = await local();
  assert.equal(view.prompt_count, "1");
  assert.equal(view.response_count, "1");
  // The chat's start was not loaded: "Partially loaded", shown in Details only off ChatGPT.
  assert.equal(view.first_request_verified, false);
  const shown = (await f.coordinator.routeSummary("notebooklm", NOTEBOOK)) as any;
  assert.equal(combinedUsage(shown.summary, shown.history)!.loading, "Partially loaded");
  await readChat(f, sessionList(SESSION), [oldest, newest, oldest]);
  view = await local();
  assert.equal(view.prompt_count, "2");
  assert.equal(view.response_count, "2");
  assert.equal(view.first_request_verified, true);
  // Nothing was sent here, so nothing waits for a live match on the bar.
  assert.equal(view.unresolved_overlap_message_count, "4");
  const all = (await f.coordinator.routeSummary("notebooklm", NOTEBOOK)) as any;
  const combined = combinedUsage(all.summary, all.history)!;
  assert.equal(combined.requests, "2");
  assert.equal(combined.matchingIncomplete, false);
  assert.equal(combined.loading, null);
  const output = view.tokens.find(
    (row: any) => row.role === "response" && row.part === "total",
  );
  assert.equal(
    output.value,
    String(2 * ("Answer 2.".length + "One?\nTwo?".length)),
  );
  assert.equal((await f.records()).length, 4);
});

test("NB10 without the notebook's session list a saved chat counts but its start stays unproven", async (t) => {
  const f = await setup(t);
  const page = {
    body: chatRequest(),
    response: chatPage([savedQuestion(1), savedAnswer(2)]),
  };
  await readChat(f, null, [page]);
  let view = ((await f.coordinator.routeSummary("notebooklm", NOTEBOOK)) as any)
    .history.local;
  assert.equal(view.prompt_count, "1");
  assert.equal(view.first_request_verified, false);
  // Two sessions: the other one's turns were not read.
  await readChat(f, sessionList(SESSION, OTHER), [page]);
  view = ((await f.coordinator.routeSummary("notebooklm", NOTEBOOK)) as any)
    .history.local;
  assert.equal(view.first_request_verified, false);
  await readChat(f, sessionList(SESSION), [page]);
  view = ((await f.coordinator.routeSummary("notebooklm", NOTEBOOK)) as any)
    .history.local;
  assert.equal(view.first_request_verified, true);
  assert.equal(view.prompt_count, "1");
});

test("NB12 a chat page sent from the page's own handler of the session list is read while the Studio list still loads", async () => {
  const env = environment();
  try {
    // The Studio list is still arriving and holds one read slot.
    const list = new env.NativeXHR();
    list.open("POST", batch("gArtLc"), true);
    list.send(listBody());
    // The page asks for the chat turns from its own handler of the session list, which
    // runs before the tracker's listener on the same response.
    const sessions = new env.NativeXHR();
    sessions.addEventListener("load", () => {
      const chat = new env.NativeXHR();
      chat.open("POST", batch("khqZz"), true);
      chat.send(chatRequest());
      chat.finish(chatPage([savedQuestion(1), savedAnswer(2)]));
    });
    sessions.open("POST", batch("hPTbtc"), true);
    sessions.send(sessionsRequest());
    sessions.finish(sessionList(SESSION));
    await until(() => env.history().some((m) => m.event === "finish"));
    assert.deepEqual(
      env.window.messages.filter((m) => m.channel === HISTORY_DIAGNOSTIC_CHANNEL),
      [],
    );
    const rows = env
      .history()
      .filter((m) => m.event === "batch")
      .flatMap((m) => m.rows);
    assert.deepEqual(
      rows.map((row: any) => row.message.sourceId),
      [turnId(1), turnId(2)],
    );
    list.finish(wire("gArtLc", [[]]));
  } finally {
    env.close();
  }
});

/**
 * A saved answer of the size seen on 14 Oct 2026: about 4,100 characters, with many quoted
 * source passages, which are not read but make the response large.
 */
const longAnswer = (n: number) => [
  turnId(n),
  turnTime(n),
  2,
  null,
  [
    [`Answer ${n}. ${"Long answer text. ".repeat(225)}`, null, [SOURCE], null, [null, null, null, null, 1]],
    Array.from({ length: 165 }, (_, k) => [
      [[`quoted passage ${k} `.repeat(40)]],
      [SOURCE, k],
      [0, 100],
    ]),
    null,
    [["One?", "Two?"]],
  ],
  2,
];

test("NB13 a large saved chat is read when a full page load asks for it while the session and Studio lists still load", async () => {
  // Seen 14 Oct 2026: a notebook opened by a full page load asks for its chat session list,
  // its Studio list (large with audio and video items) and its chat turns together. The
  // chat page of 924,742 characters was passed by unread, with no reason in Details.
  const env = environment();
  const send = (rpc: string, body: string) => {
    const xhr = new env.NativeXHR();
    xhr.open("POST", batch(rpc), true);
    xhr.send(body);
    return xhr;
  };
  const turns: unknown[][] = [];
  for (let n = 1; n <= 20; n += 2) turns.push(savedQuestion(n), longAnswer(n + 1));
  const page = chatPage(turns, "older-token");
  assert.ok(page.length > 900_000, `a synthetic page of ${page.length} characters`);
  try {
    const sessions = send("hPTbtc", sessionsRequest());
    const list = send("gArtLc", listBody());
    list.append(")]}'\n");
    const chat = send("khqZz", chatRequest());
    const again = send("gArtLc", listBody());
    for (let i = 0; i < page.length; i += 65536)
      chat.append(page.slice(i, i + 65536));
    sessions.finish(sessionList(SESSION));
    list.finish(wire("gArtLc", [[]]));
    chat.finish(page);
    again.finish(wire("gArtLc", [[]]));
    await until(() => env.history().filter((m) => m.event === "finish").length === 3);
    assert.deepEqual(
      env.window.messages.filter((m) => m.channel === HISTORY_DIAGNOSTIC_CHANNEL),
      [],
    );
    const rows = env
      .history()
      .filter((m) => m.event === "batch")
      .flatMap((m) => m.rows);
    assert.deepEqual(
      rows.map((row: any) => row.message.sourceId),
      Array.from({ length: 20 }, (_, k) => turnId(k + 1)),
    );
    assert.ok(rows.every((row: any) => row.message.complete));
  } finally {
    env.close();
  }
});

test("NB15 a saved chat page passed by, not readable or not finished is reported as the chat's, other reads as before", async (t) => {
  const diagnostics = (env: ReturnType<typeof environment>) =>
    env.window.messages.filter((m) => m.channel === HISTORY_DIAGNOSTIC_CHANNEL);
  const send = (env: ReturnType<typeof environment>, rpc: string, body: string) => {
    const xhr = new env.NativeXHR();
    xhr.open("POST", batch(rpc), true);
    xhr.send(body);
    return xhr;
  };
  // Every reading and waiting place is taken by opened Studio items still loading.
  const busy = environment();
  try {
    for (let n = 1; n <= 10; n++) send(busy, "v9rmvd", itemBody(item(n)));
    assert.deepEqual(diagnostics(busy), []);
    send(busy, "khqZz", chatRequest());
    send(busy, "gArtLc", listBody());
    assert.deepEqual(
      diagnostics(busy).map((m) => m.reason),
      ["notebooklm_chat_busy", "history_limit"],
    );
    for (const message of diagnostics(busy))
      assert.equal(validateHistoryDiagnostic(message, "notebook.google.com"), true);
  } finally {
    busy.close();
  }
  // A page of turns in a shape not seen is not counted, and Details says so.
  const unread = environment();
  try {
    const chat = send(unread, "khqZz", chatRequest());
    chat.finish(chatPage([[turnId(1), turnTime(1), 7, "Question?", null, 2]]));
    await until(() => diagnostics(unread).length > 0);
    assert.deepEqual(
      diagnostics(unread).map((m) => [m.reason, m.id]),
      [["notebooklm_chat_unread", null]],
    );
    assert.ok(!unread.history().some((m) => m.event === "batch"));
  } finally {
    unread.close();
  }
  // A page of turns that never finishes arriving is reported as the chat's too.
  const late = environment();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    send(late, "khqZz", chatRequest());
    t.mock.timers.tick(30001);
    assert.deepEqual(
      diagnostics(late).map((m) => m.reason),
      ["history_timeout", "notebooklm_chat_timeout"],
    );
  } finally {
    t.mock.timers.reset();
    late.close();
  }
  // Only a notebook's diagnostic may name its chat.
  assert.equal(
    validateHistoryDiagnostic(
      {
        channel: HISTORY_DIAGNOSTIC_CHANNEL,
        site: "gemini",
        conversationId: "c_0123456789abcdef",
        observedAt: "2026-10-14T12:00:00.000Z",
        id: null,
        reason: "notebooklm_chat_busy",
      },
      "gemini.google.com",
    ),
    false,
  );
});

// Shapes of the live check of 16 Oct 2026; ids, numbers and text are synthetic.
const LIVE_TURN = "39a01db2-0000-4000-8000-000000000001";
const ANSWER_TURN = "852ef1d5-0000-4000-8000-000000000002";
const QUESTION_TURN = "7d3c9e10-0000-4000-8000-000000000003";
const ANSWER = "The source names two causes and one remedy for the delay.";
/** A saved answer as `khqZz` returns it: `answer[0][2]` holds the session twice. */
const savedAnswerOf = (id: string, at: number, text: string) => [
  id,
  turnTime(at),
  2,
  null,
  [
    [text, null, [SESSION, SESSION, 543618897], null, [null, null, null, null, 1]],
    [[["a quoted source passage"]]],
    null,
    [["One?", "Two?"]],
  ],
  2,
];
const savedQuestionOf = (id: string, at: number) => [
  id,
  turnTime(at),
  1,
  "What changed?",
  null,
  2,
];
const chatView = async (f: Awaited<ReturnType<typeof setup>>) => {
  const shown = (await f.coordinator.routeSummary("notebooklm", NOTEBOOK)) as any;
  return {
    local: shown.history.local,
    combined: combinedUsage(shown.summary, shown.history)!,
    shown,
  };
};

test("NB17 a reply sent here links to its saved copy, which keeps no id the stream named, and counts once", async (t) => {
  // Seen live on 16 Oct 2026: after one question the bar showed Req 1, and in a new tab
  // Req ≈ 2. The saved answer had its own turn id and none of the live ids apart from the
  // session; its text was the live final text byte for byte.
  const f = await setup(t);
  await sendLive(f, ANSWER, LIVE_TURN);
  const live = await chatView(f);
  assert.equal(live.shown.summary.requests, 1);
  const page = {
    body: chatRequest(),
    response: chatPage([
      savedQuestionOf(QUESTION_TURN, 1),
      savedAnswerOf(ANSWER_TURN, 2, ANSWER),
    ]),
  };
  for (let read = 0; read < 2; read++) {
    await readChat(f, sessionList(SESSION), [page]);
    const { local, combined } = await chatView(f);
    assert.equal(local.matched_live_message_count, "2", `read ${read}`);
    assert.equal(local.unresolved_overlap_message_count, "0");
    assert.equal(local.prompt_count, "0");
    assert.equal(local.response_count, "0");
    assert.equal(combined.requests, "1");
    assert.equal(combined.matchingIncomplete, false);
    assert.equal(
      combined.output.value,
      live.shown.summary.tokens.output.value,
    );
  }
  // The saved answer takes the live reply's key; nothing is a conflict.
  const attempts = (await f.db.all<any>("attempts")).map((row) => row.record);
  const rows = await f.db.all<any>("history_records");
  const answer = rows.find((row) => row.record.role === "response")!;
  assert.equal(answer.status, "current");
  assert.equal(
    answer.record.provider_attempt_key,
    attempts[0].provider_attempt_key,
  );
  // Only keyed digests are kept: no question, answer or provider id in any record.
  const jobs = await f.db.all<any>("provider_key_map");
  assert.equal(jobs.length, 1);
  assert.match(jobs[0].contentKey, /^[0-9a-f]{64}$/);
  const stored = JSON.stringify([rows, jobs, attempts]);
  for (const secret of [ANSWER, "What changed?", LIVE_TURN, ANSWER_TURN, SESSION])
    assert.ok(!stored.includes(secret), secret);
  assert.doesNotMatch(stored, /"n_[0-9a-f]{16}"/);
  // A full erase leaves nothing to link by; the saved chat then counts from history.
  await f.coordinator.clearPersonal();
  assert.ok(
    (await f.db.all<any>("provider_key_map")).every((job) => !job.contentKey),
  );
  await readChat(f, sessionList(SESSION), [page]);
  const after = await chatView(f);
  assert.equal(after.local.prompt_count, "1");
  assert.equal(after.local.response_count, "1");
  assert.equal(after.combined.requests, "1");
});

test("NB18 replies with the same answer link in order, one saved answer to one live reply", async (t) => {
  const same = "Not in the sources.";
  const page = {
    body: chatRequest(),
    response: chatPage([
      savedQuestion(1),
      savedAnswerOf(turnId(2), 2, same),
      savedQuestion(3),
      savedAnswerOf(turnId(4), 4, same),
    ]),
  };
  // Both were sent here: each live reply links to one of them and Req stays exact.
  const both = await setup(t);
  await sendLive(both, same);
  await sendLive(both, same);
  for (let read = 0; read < 2; read++) {
    await readChat(both, sessionList(SESSION), [page]);
    const { local, combined } = await chatView(both);
    assert.equal(local.matched_live_message_count, "4", `read ${read}`);
    assert.equal(combined.requests, "2");
    assert.equal(combined.matchingIncomplete, false);
  }
  const keys = (await both.db.all<any>("history_records"))
    .filter((row) => row.record.role === "response")
    .map((row) => row.record.provider_attempt_key);
  assert.equal(new Set(keys).size, 2);
  // Only one was sent here: it links to the first, the other counts from history and
  // shows as unverified matching. Neither is left unlinked by sharing one live reply.
  const one = await setup(t);
  await sendLive(one, same);
  await readChat(one, sessionList(SESSION), [page]);
  const { local, combined } = await chatView(one);
  assert.equal(local.matched_live_message_count, "2");
  assert.equal(local.prompt_count, "1");
  assert.equal(local.response_count, "1");
  assert.equal(combined.requests, "≈ 2");
  assert.equal(combined.matchingIncomplete, true);
  const rows = await one.db.all<any>("history_records");
  const [attempt] = (await one.db.all<any>("attempts")).map((row) => row.record);
  const linked = rows.filter(
    (row) => row.record.provider_attempt_key === attempt.provider_attempt_key,
  );
  assert.equal(linked.length, 1);
  assert.ok(rows.every((row) => row.status === "current"));
});

test("NB19 a saved answer stored before its live reply keeps its key, so a reread is never a conflict", async (t) => {
  // A saved page read in another tab before the live reply ended keeps the turn's own key.
  // Changing it on a later read would make the saved row a conflict (`refineHistory`).
  const f = await setup(t);
  const page = {
    body: chatRequest(),
    response: chatPage([
      savedQuestionOf(QUESTION_TURN, 1),
      savedAnswerOf(ANSWER_TURN, 2, ANSWER),
    ]),
  };
  await readChat(f, sessionList(SESSION), [page]);
  const before = (await f.db.all<any>("history_records")).find(
    (row) => row.record.role === "response",
  )!;
  await sendLive(f, ANSWER, LIVE_TURN);
  await readChat(f, sessionList(SESSION), [page]);
  const rows = await f.db.all<any>("history_records");
  assert.ok(rows.every((row) => row.status === "current"));
  const answer = rows.find((row) => row.record.role === "response")!;
  assert.equal(
    answer.record.provider_attempt_key,
    before.record.provider_attempt_key,
  );
  const { combined } = await chatView(f);
  assert.equal(combined.requests, "≈ 2");
  assert.equal(combined.matchingIncomplete, true);
});

test("NB20 only a finished NotebookLM reply and a saved chat answer carry a content id", () => {
  const env = environment();
  let end: any;
  try {
    const xhr = new env.NativeXHR();
    xhr.open("POST", CHAT, true);
    xhr.send(chatBody);
    xhr.append(")]}'\n\n" + frameLine(chatFrame("Part")));
    xhr.append(frameLine(chatFrame("Part of the answer.", true)));
    xhr.finish();
    end = env.observations().find((m) => m.event === "end");
    assert.match(end.snapshot.contentId, /^n_[0-9a-f]{16}$/);
  } finally {
    env.close();
  }
  const host = "notebook.google.com";
  assert.equal(validateCapture(end, host), true);
  assert.equal(
    validateCapture({ ...end, snapshot: { ...end.snapshot, contentId: "n_1" } }, host),
    false,
  );
  assert.equal(
    validateCapture(
      { ...end, snapshot: { ...end.snapshot, contentId: TURN } },
      host,
    ),
    false,
  );
  const answer = {
    sourceId: turnId(2),
    role: "response",
    promptSourceId: null,
    parentSourceId: null,
    parentRole: null,
    requestId: null,
    liveAttemptId: turnId(2),
    contentId: end.snapshot.contentId,
    timing: null,
    occurredAt: null,
    dateBasis: "unknown",
    modelId: null,
    text: "Part of the answer.",
    complete: true,
    inlineFiles: null,
  };
  const page = (messages: unknown[]) => ({
    site: "notebooklm",
    conversationId: NOTEBOOK,
    observedAt: "2026-10-16T12:00:00.000Z",
    messages,
    firstRequestVerified: false,
    rootSourceId: null,
    selectedLeafId: null,
    branchSourceIds: null,
    branchScope: "loaded_messages",
    hasEarlier: null,
    hasLater: null,
    status: "partial",
  });
  assert.equal(validHistoryTextPage(page([answer])), true);
  // Not on a question, a Studio row or with another id.
  const { contentId, ...plain } = answer;
  const question = { ...plain, role: "prompt", promptSourceId: turnId(2), liveAttemptId: null };
  const studioRow = { ...plain, liveAttemptId: null, coverageReasons: ["no_live_request"] };
  for (const row of [question, studioRow]) {
    assert.equal(validHistoryTextPage(page([row])), true);
    assert.equal(validHistoryTextPage(page([{ ...row, contentId }])), false);
  }
  assert.equal(
    validHistoryTextPage(page([{ ...answer, contentId: "g_0123456789abcdef" }])),
    false,
  );
});

test("NB21 a live reply whose final frame comes as progress is admitted frame by frame and links to its saved copy", async (t) => {
  // As seen live on 16 Oct 2026: the page sends the final frame (content id, follow-ups,
  // completed) as a progress frame and then the end frame. Every frame goes through the
  // bridge check and the coordinator; a refused one would be a payload_rejected problem.
  const f = await setup(t);
  const env = environment();
  const now = Date.now;
  let skew = 0;
  let frames: any[];
  try {
    Date.now = () => now() + skew;
    const xhr = new env.NativeXHR();
    xhr.open("POST", CHAT, true);
    xhr.send(chatBody);
    const sizes = [10, 31, ANSWER.length];
    for (const [index, size] of sizes.entries()) {
      // Frames arrive more than 750 ms apart, so each one is sent as progress.
      skew += 1000;
      xhr.append(
        (index === 0 ? ")]}'\n\n" : "") +
          frameLine(liveFrame(ANSWER.slice(0, size), LIVE_TURN, index === 2)),
      );
    }
    skew += 20;
    xhr.finish();
    frames = env.observations();
  } finally {
    Date.now = now;
    env.close();
  }
  assert.deepEqual(
    frames.map((m) => m.event),
    ["dispatch", "progress", "progress", "progress", "end"],
  );
  const [last, end] = frames.slice(-2);
  assert.equal(last.snapshot.state, "completed");
  assert.match(last.snapshot.contentId, /^n_[0-9a-f]{16}$/);
  assert.equal(last.snapshot.intermediate, "One?\nTwo?");
  assert.equal(end.snapshot.contentId, last.snapshot.contentId);
  for (const frame of frames.slice(0, 3))
    assert.ok(!Object.hasOwn(frame.snapshot, "contentId"));
  const host = "notebook.google.com";
  const binding = { ...f.binding, captureId: frames[0].id };
  // Delivered as the page sends them, before the earlier ones have been stored.
  const outcomes = await Promise.allSettled(
    frames.map((frame) => {
      assert.equal(validateCapture(frame, host), true, `frame ${frame.revision}`);
      return f.coordinator.capture(structuredClone(frame), f.sender, binding);
    }),
  );
  assert.deepEqual(
    outcomes.map((outcome) =>
      outcome.status === "fulfilled" ? "accepted" : String(outcome.reason),
    ),
    frames.map(() => "accepted"),
  );
  const health = JSON.stringify(await f.db.all<any>("health"));
  assert.doesNotMatch(health, /payload_rejected/);
  const [attempt] = (await f.db.all<any>("attempts")).map((row) => row.record);
  assert.equal(attempt.state, "completed");
  const [job] = await f.db.all<any>("provider_key_map");
  assert.match(job.contentKey, /^[0-9a-f]{64}$/);
  const live = await chatView(f);
  assert.equal(live.shown.summary.requests, 1);
  // The saved copy is admitted by the history check and links to the live reply.
  await readChat(f, sessionList(SESSION), [
    {
      body: chatRequest(),
      response: chatPage([
        savedQuestionOf(QUESTION_TURN, 1),
        savedAnswerOf(ANSWER_TURN, 2, ANSWER),
      ]),
    },
  ]);
  const { local, combined } = await chatView(f);
  assert.equal(local.matched_live_message_count, "2");
  assert.equal(combined.requests, "1");
  assert.equal(combined.matchingIncomplete, false);
  assert.doesNotMatch(
    JSON.stringify(await f.db.all<any>("health")),
    /payload_rejected/,
  );
});

test("NB22 saved chats and the Studio list the page reads by fetch(new Request(...)) are read as before (19 Oct 2026)", async () => {
  const answers: Record<string, string> = {
    hPTbtc: sessionList(SESSION),
    khqZz: chatPage([savedQuestion(1), savedAnswer(2)]),
    gArtLc: wire("gArtLc", [[studio(item(1), 11, 3, { 34: REPORT })]]),
  };
  const sent: Array<{ request: unknown; args: number; body: string }> = [];
  // The network answers after the request body was sent, as a real request does.
  const env = environment(path, (async (...args: unknown[]) => {
    const request = args[0] as Request;
    sent.push({ request, args: args.length, body: await request.text() });
    await tick();
    return new Response(answers[new URL(request.url).searchParams.get("rpcids")!]);
  }) as typeof fetch);
  const finishes = () => env.history().filter((m) => m.event === "finish");
  // Since 19 Oct 2026 every batch RPC is a Request built with its body, with no second
  // argument to fetch.
  const read = async (rpc: string, body: string) => {
    const request = new Request(batch(rpc), { method: "POST", body });
    const response = await env.window.fetch(request);
    // The page's own request reaches the network unchanged, body included.
    assert.equal(sent.at(-1)!.request, request);
    assert.equal(sent.at(-1)!.args, 1);
    assert.equal(sent.at(-1)!.body, body);
    assert.equal(await response.text(), answers[rpc]);
  };
  try {
    await read("hPTbtc", sessionsRequest());
    await tick();
    assert.deepEqual(env.history(), []);
    await read("khqZz", chatRequest());
    await until(() => finishes().length === 1);
    const events = env.history();
    assert.deepEqual(
      events.map((m) => m.event),
      ["start", "batch", "finish"],
    );
    assert.equal(events[0].conversationId, NOTEBOOK);
    assert.deepEqual(
      events[1].rows.map((row: any) => [row.message.role, row.message.sourceId]),
      [
        ["prompt", turnId(1)],
        ["response", turnId(2)],
      ],
    );
    // The session list was kept, so the oldest page proves the first message.
    assert.equal(events[2].meta.firstRequestVerified, true);
    await read("gArtLc", listBody());
    await until(() => finishes().length === 2);
    const studioRows = env
      .history()
      .slice(events.length)
      .find((m) => m.event === "batch").rows;
    assert.deepEqual(
      studioRows.map((row: any) => [row.message.role, row.message.sourceId]),
      [
        ["prompt", item(1)],
        ["response", item(1)],
      ],
    );
  } finally {
    env.close();
  }
});
