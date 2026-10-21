import test from "node:test";
import assert from "node:assert/strict";
import * as adapters from "../src/index";
import { generationRoute, parseDispatch, PACKAGED_PROVIDER_ADAPTERS } from "../src/index";

// ChatGPT used without an account (live, 20 Oct 2026, a signed-out Chrome profile). The page
// sends POST /unauth-mweb/conversation/updates with a form body and reads the reply as one JSON
// object per line (application/vnd.openai.conversation-source+ndjson). Structure and labels as
// seen; ids and text are synthetic.
const api = adapters as any;
const CHAT = "6ad70000-0000-83ea-8000-000000000001";
const USER = "00000000-0000-4000-8000-000000000010";
const ANSWER = "00000000-0000-4000-8000-000000000011";
const OPERATION = "00000000-0000-4000-8000-000000000012";
const SEND = new URL(
  `https://chatgpt.com/unauth-mweb/conversation/updates?lightweight_authenticated=1&operationId=${OPERATION}`,
);

/** The form the page sends: prompt, the page's chat state and its sentinel tokens. */
function form(
  prompt: string,
  state: Record<string, unknown>,
  extra: Record<string, string> = {},
) {
  return new URLSearchParams({
    conversationState: JSON.stringify(state),
    messageMetadata: "{}",
    "oai-session-id": "00000000-0000-4000-8000-000000000099",
    imageAttachments: "[]",
    pendingImageUploads: "[]",
    prompt,
    conversationRetryOwner: JSON.stringify({ mode: "anonymous", sessionEpoch: null }),
    workOrigin: "",
    workModel: "",
    workEffort: "",
    workTier: "",
    assistantMessageId: `pending-${"0".repeat(8)}-0000-4000-8000-000000000013`,
    userMessageId: USER,
    chatRequirementsToken: "synthetic",
    proofToken: "synthetic",
    turnstileToken: "synthetic",
    ...extra,
  }).toString();
}
const control = (kind: string, extra: Record<string, unknown> = {}) => ({
  version: 1,
  type: "control",
  detail: { operationId: OPERATION, streamType: "initial", kind, ...extra },
});
const content = (
  revision: number,
  markdown: string,
  extra: Record<string, unknown> = {},
) => ({
  version: 1,
  type: "content",
  messageId: ANSWER,
  revision,
  ...(revision === 1
    ? { mode: "replace" }
    : { mode: "append", baseRevision: revision - 1 }),
  markdown,
  status: "streaming",
  streamingParent: { metadata: { streaming_parent_id: USER, streaming_parent_revision: 1 } },
  ...extra,
});
/** A whole reply in the order seen live, its answer in three pieces. */
const reply = (pieces: string[]) => [
  control("started"),
  { version: 1, type: "shared", html: "<template data-web-mobile-dpu-apply></template>" },
  {
    ...control("conversation-id", {
      conversationId: CHAT,
      canonicalPath: `/uc/${CHAT}`,
    }),
    stopConduitToken: "synthetic",
  },
  control("resume-token", { conversationId: CHAT, resumeToken: "synthetic" }),
  content(1, pieces[0]!, { references: [], dil: { kind: "dil", fallbackMarkdown: pieces[0] } }),
  control("assistant-content-started", { messageId: ANSWER }),
  ...pieces.slice(1).map((piece, index) => content(index + 2, piece)),
  content(pieces.length + 1, "", { status: "complete" }),
  {
    version: 1,
    type: "state",
    conversationState: JSON.stringify({
      backendConversationId: CHAT,
      messages: [],
      parentMessageId: ANSWER,
      userMessageCount: 1,
    }),
    safety: {},
  },
  control("terminal-received", {
    conversationId: CHAT,
    messageId: ANSWER,
    terminalKind: "complete",
    transportOnly: true,
  }),
  { version: 1, type: "end" },
];
const session = () => {
  assert.equal(typeof api.ChatgptSignedOutSession, "function");
  return new api.ChatgptSignedOutSession();
};

test("signed-out ChatGPT: the send is a generation route and nothing else on /unauth-mweb is", () => {
  assert.equal(generationRoute("chatgpt", SEND, "POST"), true);
  assert.equal(generationRoute("chatgpt", SEND, "GET"), false);
  for (const path of [
    "/unauth-mweb/conversation/prepare",
    "/unauth-mweb/stop_conversation",
    "/unauth-mweb/sentinel/chat-requirements/prepare",
    "/unauth-mweb/conversation/updates/extra",
  ])
    assert.equal(
      generationRoute("chatgpt", new URL(`https://chatgpt.com${path}`), "POST"),
      false,
      path,
    );
  // Only ChatGPT has it.
  assert.equal(generationRoute("claude", SEND, "POST"), false);
  // Signed-in sends are unchanged.
  assert.equal(
    generationRoute("chatgpt", new URL("https://chatgpt.com/backend-api/f/conversation"), "POST"),
    true,
  );
  assert.ok(
    PACKAGED_PROVIDER_ADAPTERS.get("chatgpt")!.createSession(SEND) instanceof
      api.ChatgptSignedOutSession,
  );
  assert.ok(
    !(
      PACKAGED_PROVIDER_ADAPTERS.get("chatgpt")!.createSession(
        new URL("https://chatgpt.com/backend-api/f/conversation"),
      ) instanceof api.ChatgptSignedOutSession
    ),
  );
});

test("signed-out ChatGPT: a new chat's form names the prompt, the root and the user message", () => {
  const dispatch = parseDispatch(
    "chatgpt",
    SEND,
    form("Synthetic first prompt", {
      messages: [],
      parentMessageId: "client-created-root",
      safety: { dismissedInterventionIds: [] },
      userMessageCount: 0,
    }),
  );
  assert.deepEqual(
    { ...dispatch },
    {
      site: "chatgpt",
      action: "send",
      input: "Synthetic first prompt",
      conversationId: null,
      parentId: "client-created-root",
      requestId: USER,
      // The page sends no model and the stream names none; ChatGPT picks it ("auto").
      model: null,
      attachments: 0,
      imageEditParentId: null,
      inputImages: [],
    },
  );
});

test("signed-out ChatGPT: a follow-up names its chat and the answer it follows", () => {
  const dispatch = parseDispatch(
    "chatgpt",
    SEND,
    form("Synthetic follow-up", {
      backendConversationId: CHAT,
      messages: [],
      parentMessageId: ANSWER,
      userMessageCount: 1,
    }),
  );
  assert.equal(dispatch.conversationId, CHAT);
  assert.equal(dispatch.parentId, ANSWER);
  assert.equal(dispatch.input, "Synthetic follow-up");
});

test("signed-out ChatGPT: an attached image is counted as an attachment of unknown size", () => {
  const dispatch = parseDispatch(
    "chatgpt",
    SEND,
    form(
      "Synthetic prompt with an image",
      { messages: [], parentMessageId: "client-created-root", userMessageCount: 0 },
      { imageAttachments: JSON.stringify([{ id: "file-synthetic" }]) },
    ),
  );
  assert.equal(dispatch.attachments, 1);
  assert.equal(dispatch.inputImages, undefined);
});

test("signed-out ChatGPT: a form without a prompt or a readable chat state fails closed", () => {
  const body = new URLSearchParams(form("x", { parentMessageId: "client-created-root" }));
  body.delete("prompt");
  assert.throws(() => parseDispatch("chatgpt", SEND, body.toString()), /unsupported_schema/);
  const broken = new URLSearchParams(form("x", {}));
  broken.set("conversationState", "{not json");
  assert.throws(() => parseDispatch("chatgpt", SEND, broken.toString()), /malformed_frame/);
});

test("signed-out ChatGPT: a reply streamed as JSON lines is read whole and completes at its terminal", () => {
  const reader = session();
  const lines = reply(["Synthetic ", "answer in ", "three pieces."]);
  const terminal = lines.findIndex(
    (line: any) => line.detail?.kind === "terminal-received",
  );
  for (const line of lines.slice(0, terminal)) reader.line(line);
  let snapshot = reader.snapshot();
  assert.equal(snapshot.state, "generating");
  assert.equal(snapshot.text, "Synthetic answer in three pieces.");
  assert.equal(snapshot.conversationId, CHAT);
  assert.equal(reader.completionVerified(), false);
  for (const line of lines.slice(terminal)) reader.line(line);
  snapshot = reader.snapshot();
  assert.equal(snapshot.state, "completed");
  assert.equal(reader.completionVerified(), true);
  assert.equal(snapshot.started, true);
  assert.equal(snapshot.text, "Synthetic answer in three pieces.");
  assert.equal(snapshot.thinking, "");
  assert.equal(snapshot.toolInput, "");
  assert.equal(snapshot.intermediate, "");
  assert.equal(snapshot.outputId, ANSWER);
  assert.equal(snapshot.attemptId, ANSWER);
  assert.equal(snapshot.model, null);
  assert.equal(snapshot.topic, null);
  assert.ok(!snapshot.limitations.includes("unknown_event_observed"));
});

test("signed-out ChatGPT: before any answer the reply has no text; a stop after the turn started counts 0", () => {
  const reader = session();
  reader.line(control("started"));
  let snapshot = reader.snapshot();
  assert.equal(snapshot.started, false);
  assert.equal(snapshot.text, null);
  reader.stopped();
  snapshot = reader.snapshot();
  assert.equal(snapshot.state, "cancelled");
  assert.equal(snapshot.started, true);
  assert.equal(snapshot.text, "");
});

test("signed-out ChatGPT: a stopped reply keeps what was written until the stop", () => {
  const reader = session();
  for (const line of reply(["Part one, ", "part two."]).slice(0, 7)) reader.line(line);
  reader.stopped();
  const snapshot = reader.snapshot();
  assert.equal(snapshot.state, "cancelled");
  assert.equal(snapshot.text, "Part one, part two.");
});

test("signed-out ChatGPT: an append that does not follow the known revision fails closed", () => {
  const reader = session();
  reader.line(content(1, "First"));
  assert.throws(
    () => reader.line({ ...content(3, " lost"), baseRevision: 2 }),
    /unsupported_schema/,
  );
  const other = session();
  assert.throws(() => other.line(content(2, " no start")), /unsupported_schema/);
  const unreadable = session();
  assert.throws(
    () => unreadable.line({ ...content(1, "x"), markdown: { kind: "image" } }),
    /unsupported_schema/,
  );
  // Only versions 1 and 2 are known (version 2 since 21 Oct 2026).
  assert.throws(() => session().line({ version: 3, type: "end" }), /unsupported_schema/);
  assert.throws(() => session().line({ type: "end" }), /unsupported_schema/);
});

test("signed-out ChatGPT: an unknown line or control leaves the reply partly measured", () => {
  const reader = session();
  for (const line of reply(["Synthetic answer."])) {
    reader.line(line);
    if ((line as any).type === "shared")
      reader.line({ version: 1, type: "new-kind", value: 1 });
  }
  reader.line(control("new-control-kind"));
  const snapshot = reader.snapshot();
  assert.equal(snapshot.state, "completed");
  assert.ok(snapshot.limitations.includes("unknown_event_observed"));
});

// A reply with web search (live, 20 Oct 2026, two signed-out replies): before the answer the
// page streams `reasoning` lines. They carry only the search tool's status, the same labels
// the page shows while it searches ("Searching the web", then a count of the sites it read),
// the sources' icons, and at the end a recap with no text (recapType "hide_all"). No model
// text appeared in them. Structure as seen; labels and links are synthetic.
const SEARCH = "00000000-0000-4000-8000-000000000020";
const SEARCH_TWO = "00000000-0000-4000-8000-000000000021";
const icon = (n: number) => `https://icons.example/site-${n}.png`;
const searchStatus = (texts: string[], icons: string[], active = SEARCH) => ({
  active: true,
  text: texts.at(-1),
  ...(texts.length === 1 ? { transient: true } : {}),
  items: texts.slice(0, -1),
  itemIcons: texts.slice(0, -1).map(() => ["globe"]),
  toolIcons: icons,
  reasoning: {
    id: SEARCH,
    activeItem: { id: active, kind: active === SEARCH ? 0 : 2, texts: [texts.at(-1)], toolIcons: icons },
    items: texts.map((text, index) => ({
      id: index ? SEARCH_TWO : SEARCH,
      kind: 0,
      text,
      toolIcons: index ? icons : ["globe"],
    })),
    status: 0,
  },
});
const searchRecords = (texts: string[], icons: string[], done = false) => [
  ...texts.map((text, index) => ({
    sourceId: SEARCH,
    kind: "activity",
    text,
    ...(index ? { items: [text] } : {}),
    toolIcons: index ? icons : ["globe"],
  })),
  ...(done ? [{ sourceId: SEARCH, kind: "recap", text: "", recapType: "hide_all" }] : []),
];
const SITES = [icon(1), icon(2), icon(3)];
const searchLines = [
  {
    version: 1,
    type: "reasoning",
    status: searchStatus(["Searching the web"], ["globe"]),
    activity: { records: searchRecords(["Searching the web"], SITES), active: true },
  },
  {
    version: 1,
    type: "reasoning",
    status: searchStatus(["Searching the web", "Searched 3 sites"], SITES, SEARCH_TWO),
    activity: {
      records: searchRecords(["Searching the web", "Searched 3 sites"], SITES),
      active: true,
    },
  },
  {
    version: 1,
    type: "reasoning",
    status: null,
    activity: {
      records: searchRecords(["Searching the web", "Searched 3 sites"], SITES, true),
      active: false,
    },
  },
];

test("20 Oct 2026: a signed-out reply with web search reads its search status lines as known and counts none of them", () => {
  const reader = session();
  const lines = reply(["Synthetic answer ", "with sources."]);
  // The search runs after the turn started and before the answer.
  const started = lines.findIndex((line: any) => line.detail?.kind === "resume-token");
  for (const [index, line] of lines.entries()) {
    reader.line(line);
    if (index === started) for (const search of searchLines) reader.line(search);
  }
  const snapshot = reader.snapshot();
  assert.equal(snapshot.state, "completed");
  assert.equal(snapshot.text, "Synthetic answer with sources.");
  // The labels are the page's own status of the search tool, not model output.
  assert.equal(snapshot.thinking, "");
  assert.equal(snapshot.intermediate, "");
  assert.ok(
    !snapshot.limitations.includes("unknown_event_observed"),
    "a reply with web search is measured whole",
  );
});

test("signed-out ChatGPT: a reasoning line of an unknown shape still leaves the reply partly measured", () => {
  for (const odd of [
    // A record kind not seen, which may hold model text.
    {
      version: 1,
      type: "reasoning",
      status: null,
      activity: {
        records: [{ sourceId: SEARCH, kind: "thought", text: "Synthetic thought" }],
        active: false,
      },
    },
    // No activity at all.
    { version: 1, type: "reasoning", status: null },
    // A status of another shape.
    { version: 1, type: "reasoning", status: "searching", activity: { records: [], active: true } },
  ]) {
    const reader = session();
    for (const line of reply(["Synthetic answer."])) {
      reader.line(line);
      if ((line as any).type === "shared") reader.line(odd);
    }
    const snapshot = reader.snapshot();
    assert.equal(snapshot.state, "completed");
    assert.ok(snapshot.limitations.includes("unknown_event_observed"), JSON.stringify(odd));
  }
});

test("signed-out ChatGPT: a terminal other than complete does not complete the reply", () => {
  const reader = session();
  const lines = reply(["Synthetic answer."]).map((line: any) =>
    line.detail?.kind === "terminal-received"
      ? { ...line, detail: { ...line.detail, terminalKind: "error" } }
      : line,
  );
  for (const line of lines) reader.line(line);
  const snapshot = reader.snapshot();
  assert.equal(snapshot.state, "generating");
  assert.ok(snapshot.limitations.includes("unknown_event_observed"));
  assert.equal(reader.completionVerified(), false);
});

test("signed-out ChatGPT: the stop request names the chat it stops", () => {
  assert.equal(typeof api.isChatgptSignedOutStop, "function");
  const stop = new URL(
    "https://chatgpt.com/unauth-mweb/stop_conversation?lightweight_authenticated=1",
  );
  assert.equal(api.isChatgptSignedOutStop(stop, "POST"), true);
  assert.equal(api.isChatgptSignedOutStop(stop, "GET"), false);
  assert.equal(api.isChatgptSignedOutStop(SEND, "POST"), false);
  assert.equal(
    api.chatgptSignedOutStopConversation(JSON.stringify({ conversationId: CHAT })),
    CHAT,
  );
  for (const body of ["{}", "not json", JSON.stringify({ conversationId: 7 })])
    assert.equal(api.chatgptSignedOutStopConversation(body), null, body);
});

// Version 2 (live, 21 Oct 2026, two signed-out replies; the page's <html> carries
// data-conversation-stream-protocol="2"): every line has `version: 2`, with the same types,
// control kinds and content fields as version 1. `markdown` is the text: revision 1 replaces,
// each later revision appends to the one it names. `dil` is the page's rendering program (code
// and constants) and `dil.fallbackMarkdown` the text so far; neither is read. Lengths as seen
// (the answer 3 + 49 + 45 characters, page markup 94, 196, 810 and 5,097, the chat state 156);
// the text is synthetic.
const fill = (length: number, letter = "x") => letter.repeat(length);
const v2Control = (kind: string, extra: Record<string, unknown> = {}) => ({
  version: 2,
  type: "control",
  detail: { operationId: OPERATION, streamType: "initial", kind, ...extra },
});
const v2Shared = (length: number) => ({
  version: 2,
  type: "shared",
  html: `<template data-synthetic>${fill(length - 36, "h")}</template>`.padEnd(length, " "),
});
const PARENT = { metadata: { streaming_parent_id: USER, streaming_parent_revision: 1 } };
const dil = (constants: Record<string, string>, fallbackMarkdown: string) => ({
  kind: "dil",
  renderer: "dil-v2",
  status: "pending",
  code: fill(232, "c"),
  constants,
  appData: {
    opGenui: { componentResults: {}, interactionSurface: "mainline", modelDataBindings: {} },
  },
  fallbackMarkdown,
  viewState: {},
});
/** The first content line: revision 1 sets the text. */
const v2First = (markdown: string, fallback = markdown) => ({
  version: 2,
  type: "content",
  messageId: ANSWER,
  revision: 1,
  mode: "replace",
  markdown,
  references: [],
  dil: dil({ 0: fill(3, "k") }, fallback),
  approvedUrls: [],
  canonicalApprovedUrls: [],
  deniedUrls: [],
  status: "streaming",
  streamingParent: PARENT,
});
/** A later content line: it appends to the revision before it. */
const v2Append = (revision: number, markdown: string, fallback: string) => ({
  version: 2,
  type: "content",
  messageId: ANSWER,
  revision,
  mode: "append",
  baseRevision: revision - 1,
  markdown,
  dil: dil({ 0: fill(14, "k"), 1: fill(36 + revision, "k") }, fallback),
  status: "streaming",
  streamingParent: PARENT,
});
const v2Complete = (revision: number) => ({
  version: 2,
  type: "content",
  messageId: ANSWER,
  revision,
  mode: "append",
  baseRevision: revision - 1,
  markdown: "",
  status: "complete",
  conversationFollowupSuggestionsEligible: true,
  streamingParent: PARENT,
});
const v2State = (safety: Record<string, unknown>) => ({
  version: 2,
  type: "state",
  conversationState: fill(156, "s"),
  safety,
});
/** A whole version 2 reply in the order seen live. */
function v2Reply(pieces: string[], fallbacks?: string[]) {
  let sum = "";
  const cumulative = pieces.map((piece) => (sum += piece));
  const fallback = (index: number) => fallbacks?.[index] ?? cumulative[index]!;
  return [
    v2Control("started"),
    v2Shared(94),
    {
      ...v2Control("conversation-id", {
        conversationId: CHAT,
        canonicalPath: `/uc/${CHAT}`.padEnd(40, "0"),
      }),
      stopConduitToken: fill(350, "t"),
    },
    v2Control("resume-token", { conversationId: CHAT, resumeToken: fill(419, "r") }),
    v2Shared(196),
    v2First(pieces[0]!, fallback(0)),
    v2Control("assistant-content-started", { messageId: ANSWER }),
    ...pieces.slice(1).map((piece, index) => v2Append(index + 2, piece, fallback(index + 1))),
    v2Complete(pieces.length + 1),
    v2State({}),
    v2Shared(810),
    v2State({ dismissedInterventionIds: [] }),
    v2Control("terminal-received", {
      conversationId: CHAT,
      messageId: ANSWER,
      terminalKind: "complete",
      transportOnly: true,
    }),
    v2Shared(5097),
    { version: 2, type: "end" },
  ];
}
const V2_PIECES = [
  "One",
  " synthetic sentence of the second record, ok.".padEnd(49, "."),
  " and a third record of the test reply text.".padEnd(45, "."),
];
const V2_TEXT = V2_PIECES.join("");

test("21 Oct 2026: a version 2 signed-out reply is read from its markdown and completes at its terminal", () => {
  assert.deepEqual(V2_PIECES.map((piece) => piece.length), [3, 49, 45]);
  const reader = session();
  const lines = v2Reply(V2_PIECES);
  assert.equal(lines.length, 16, "the 16 lines seen live");
  const terminal = lines.findIndex((line: any) => line.detail?.kind === "terminal-received");
  for (const line of lines.slice(0, terminal)) reader.line(line);
  let snapshot = reader.snapshot();
  assert.equal(snapshot.state, "generating");
  assert.equal(snapshot.text, V2_TEXT);
  assert.equal(snapshot.conversationId, CHAT);
  assert.equal(reader.completionVerified(), false);
  for (const line of lines.slice(terminal)) reader.line(line);
  snapshot = reader.snapshot();
  assert.equal(snapshot.state, "completed");
  assert.equal(reader.completionVerified(), true);
  // Only the 97 characters of markdown count: not the rendering program, its constants, the
  // repeated text in fallbackMarkdown, the page markup, the chat state or the tokens.
  assert.equal(snapshot.text, V2_TEXT);
  assert.equal(snapshot.text.length, 97);
  assert.equal(reader.retainedBytes(), 97 * 2);
  assert.equal(snapshot.thinking, "");
  assert.equal(snapshot.toolInput, "");
  assert.equal(snapshot.intermediate, "");
  assert.equal(snapshot.outputId, ANSWER);
  assert.equal(snapshot.attemptId, ANSWER);
  assert.equal(snapshot.model, null);
  assert.ok(!snapshot.limitations.includes("unknown_event_observed"));
});

test("21 Oct 2026: a version 2 reply's fallbackMarkdown is not read, even when it leads or trails the markdown", () => {
  // Live, fallbackMarkdown matched the text so far (1, 57, 149 and 3, 52, 97); a page that
  // renders ahead or behind must not change the count.
  for (const fallbacks of [
    [V2_PIECES[0]!, V2_TEXT.slice(0, 40), V2_TEXT + " extra"],
    ["", "", ""],
  ]) {
    const reader = session();
    for (const line of v2Reply(V2_PIECES, fallbacks)) reader.line(line);
    const snapshot = reader.snapshot();
    assert.equal(snapshot.state, "completed");
    assert.equal(snapshot.text, V2_TEXT);
    assert.ok(!snapshot.limitations.includes("unknown_event_observed"));
  }
});

test("21 Oct 2026: a long version 2 reply across many append lines is read whole", () => {
  const pieces = [
    "Start.",
    ...Array.from({ length: 400 }, (_, index) => ` Synthetic sentence number ${index + 1}.`),
  ];
  const reader = session();
  for (const line of v2Reply(pieces)) reader.line(line);
  const snapshot = reader.snapshot();
  assert.equal(snapshot.state, "completed");
  assert.equal(snapshot.text, pieces.join(""));
  assert.ok(!snapshot.limitations.includes("unknown_event_observed"));
});

test("21 Oct 2026: a stopped version 2 reply keeps what was written until the stop", () => {
  const lines = v2Reply(V2_PIECES);
  const second = lines.findIndex((line: any) => line.revision === 2);
  const reader = session();
  for (const line of lines.slice(0, second + 1)) reader.line(line);
  reader.stopped();
  let snapshot = reader.snapshot();
  assert.equal(snapshot.state, "cancelled");
  assert.equal(snapshot.text, V2_PIECES[0]! + V2_PIECES[1]!);
  // A stop after the turn started and before any answer counts an empty answer.
  const early = session();
  early.line(v2Control("started"));
  early.stopped();
  snapshot = early.snapshot();
  assert.equal(snapshot.state, "cancelled");
  assert.equal(snapshot.started, true);
  assert.equal(snapshot.text, "");
});

test("21 Oct 2026: a version 2 terminal other than complete does not complete the reply", () => {
  for (const terminalKind of ["stopped", "cancelled", "error", undefined]) {
    const reader = session();
    for (const line of v2Reply(V2_PIECES))
      reader.line(
        (line as any).detail?.kind === "terminal-received"
          ? { ...line, detail: { ...(line as any).detail, terminalKind } }
          : line,
      );
    const snapshot = reader.snapshot();
    assert.equal(snapshot.state, "generating", String(terminalKind));
    assert.equal(reader.completionVerified(), false);
    assert.ok(snapshot.limitations.includes("unknown_event_observed"), String(terminalKind));
  }
});

test("21 Oct 2026: a version 2 line not seen live leaves the reply partly measured", () => {
  const SEARCH_LINE = {
    status: null,
    activity: {
      records: [{ sourceId: SEARCH, kind: "activity", text: "Searching the web" }],
      active: false,
    },
  };
  const odd: [string, (line: any) => any[]][] = [
    ["an unknown control kind", (line) => [line, v2Control("new-control-kind")]],
    [
      "a stream type other than initial",
      (line) =>
        line.detail?.kind === "resume-token"
          ? [{ ...line, detail: { ...line.detail, streamType: "resume" } }]
          : [line],
    ],
    ["an unknown line type", (line) => [line, { version: 2, type: "new-kind", value: 1 }]],
    // Version 1 search status lines were seen; their version 2 shape was not.
    ["a reasoning line", (line) => [line, { version: 2, type: "reasoning", ...SEARCH_LINE }]],
    [
      "a content line with a field not seen",
      (line) =>
        line.revision === 2 ? [{ ...line, reasoningMarkdown: "Synthetic thought" }] : [line],
    ],
    [
      "a content status not seen",
      (line) => (line.revision === 2 ? [{ ...line, status: "paused" }] : [line]),
    ],
  ];
  for (const [name, change] of odd) {
    const reader = session();
    for (const line of v2Reply(V2_PIECES)) for (const each of change(line)) reader.line(each);
    const snapshot = reader.snapshot();
    assert.equal(snapshot.text, V2_TEXT, name);
    assert.ok(snapshot.limitations.includes("unknown_event_observed"), name);
  }
});

test("21 Oct 2026: a version 2 append that does not follow, an unknown mode or a change of version fails closed", () => {
  const first = v2First("Abc");
  let reader = session();
  reader.line(first);
  assert.throws(() => reader.line(v2Append(3, " lost", "")), /unsupported_schema/);
  assert.throws(() => session().line(v2Append(2, " no start", "")), /unsupported_schema/);
  for (const mode of ["patch", "prepend", undefined]) {
    reader = session();
    reader.line(first);
    assert.throws(
      () => reader.line({ ...v2Append(2, " more", ""), mode }),
      /unsupported_schema/,
      String(mode),
    );
  }
  // A stream keeps the version it started with; a line of the other version may mean
  // something else.
  reader = session();
  reader.line(v2Control("started"));
  assert.throws(() => reader.line(control("conversation-id")), /unsupported_schema/);
  reader = session();
  reader.line(control("started"));
  assert.throws(() => reader.line(v2First("Abc")), /unsupported_schema/);
});

test("signed-out ChatGPT: version 1 lines keep their rules after version 2 was added", () => {
  // A version 1 search status line is still known, and a content field not listed for
  // version 2 does not mark a version 1 reply.
  const reader = session();
  for (const line of reply(["Synthetic answer."])) {
    reader.line((line as any).type === "content" ? { ...line, extraField: true } : line);
    if ((line as any).detail?.kind === "resume-token")
      for (const search of searchLines) reader.line(search);
  }
  const snapshot = reader.snapshot();
  assert.equal(snapshot.state, "completed");
  assert.equal(snapshot.text, "Synthetic answer.");
  assert.ok(!snapshot.limitations.includes("unknown_event_observed"));
});
