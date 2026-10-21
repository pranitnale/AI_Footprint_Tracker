import test from "node:test";
import assert from "node:assert/strict";
import {
  NotebooklmChatSession,
  NotebooklmGuideSession,
  PACKAGED_PROVIDER_ADAPTERS,
  notebooklmGenerationRoute,
  parseDispatch,
  parseHistoryText,
} from "../src";
import {
  notebooklmHistoryFrames,
  type NotebooklmHistoryRead,
} from "../src/history";

// Shapes as seen on 1 and 3 Oct 2026 (W9 design); ids and text are synthetic.
const NOTEBOOK = "f0000000-0000-4000-8000-0000000000a1";
const SESSION = "11111111-1111-4111-8111-111111111111";
const TURN = "22222222-2222-4222-8222-222222222222";
const SOURCE = "33333333-3333-4333-8333-333333333333";
const at = "2026-10-04T12:00:00.000Z";
const CHAT_URL = new URL(
  "https://notebook.google.com/_/LabsTailwindUi/data/google.internal.labs.tailwind.orchestration.v1.LabsTailwindOrchestrationService/GenerateFreeFormStreamed?bl=x&authuser=3",
);
const batchUrl = (rpc: string, path = `/notebook/${NOTEBOOK}`) =>
  new URL(
    `https://notebook.google.com/_/LabsTailwindUi/data/batchexecute?rpcids=${rpc}&source-path=${encodeURIComponent(path)}&rt=c`,
  );
const unknown = (limitations: readonly string[] | undefined) =>
  !!limitations?.includes("unknown_event_observed");

/** One cumulative chat frame: the answer row, echoed passages and, last, the follow-ups. */
function chatFrame(
  text: string,
  options: {
    kind?: unknown;
    final?: boolean;
    suggestions?: string[];
    session?: string;
    turn?: string;
  } = {},
) {
  const answer = [
    text,
    null,
    [options.session ?? SESSION, options.turn ?? TURN, 1],
    null,
    [null, null, null, null, options.kind ?? 1],
  ];
  const suggestions = options.suggestions ?? ["One?", "Two?", "Three?"];
  return [
    answer,
    [[["an echoed passage from the source"]]],
    null,
    options.final ? [suggestions] : null,
    options.final ? true : null,
    options.final ? [suggestions.map((question) => [question, 1])] : null,
  ];
}
const rows = (...frames: unknown[]) =>
  frames.map((frame) => ["wrb.fr", null, JSON.stringify(frame)]);
function chat(...frames: unknown[]) {
  const session = new NotebooklmChatSession();
  for (const frame of frames) session.gemini(rows(frame));
  return session;
}

test("W9 a NotebookLM send reads the question from the chat body and names the guide", () => {
  const body = new URLSearchParams({
    "f.req": JSON.stringify([
      null,
      JSON.stringify([
        [[[SOURCE]]],
        "What is new?",
        null,
        [2, null, [1]],
        SESSION,
      ]),
    ]),
    at: "token",
  }).toString();
  const dispatch = parseDispatch("notebooklm", CHAT_URL, body);
  assert.equal(dispatch.site, "notebooklm");
  assert.equal(dispatch.input, "What is new?");
  assert.equal(dispatch.attachments, 0);
  assert.deepEqual(dispatch.inputImages, []);
  assert.equal(dispatch.action, "send");
  // A body of another shape keeps the question unknown; the reply is still read.
  assert.equal(
    parseDispatch("notebooklm", CHAT_URL, "f.req=%5B1%5D").input,
    null,
  );
  assert.equal(parseDispatch("notebooklm", CHAT_URL, "%%%").input, null);
  const guide = parseDispatch("notebooklm", batchUrl("VfAZjd"), "f.req=x");
  assert.equal(guide.action, "notebook_guide");
  assert.equal(guide.input, "");
});

test("W9 only the chat stream and the guide are NotebookLM generation routes", () => {
  assert.equal(notebooklmGenerationRoute(CHAT_URL), true);
  assert.equal(notebooklmGenerationRoute(batchUrl("VfAZjd")), true);
  for (const rpc of ["gArtLc", "v9rmvd", "R7cb6c", "VfAZjd,gArtLc", "khqZz"])
    assert.equal(notebooklmGenerationRoute(batchUrl(rpc)), false, rpc);
  assert.equal(
    notebooklmGenerationRoute(
      new URL(
        "https://notebook.google.com/_/LabsTailwindUi/data/x/GenerateOther",
      ),
    ),
    false,
  );
  const adapter = PACKAGED_PROVIDER_ADAPTERS.get("notebooklm")!;
  assert.equal(adapter.responseFormat, "gemini");
  assert.equal(adapter.generationRoute(CHAT_URL, "POST"), true);
  assert.equal(adapter.generationRoute(CHAT_URL, "GET"), false);
  assert.ok(
    adapter.createSession(batchUrl("VfAZjd")) instanceof NotebooklmGuideSession,
  );
  assert.ok(adapter.createSession(CHAT_URL) instanceof NotebooklmChatSession);
});

test("W9 a NotebookLM reply counts its answer and the follow-up questions once", () => {
  const session = chat(
    chatFrame("Part"),
    chatFrame("Part of the answer"),
    chatFrame("Part of the answer.", { final: true }),
  );
  const snapshot = session.snapshot();
  assert.equal(snapshot.state, "completed");
  assert.equal(session.completionVerified(), true);
  assert.equal(snapshot.text, "Part of the answer.");
  // No thoughts were streamed: none shown, none counted.
  assert.equal(snapshot.thinking, "");
  assert.equal(snapshot.intermediate, "One?\nTwo?\nThree?");
  assert.equal(snapshot.toolInput, "");
  assert.equal(snapshot.toolOutput, "");
  assert.equal(snapshot.outputId, TURN);
  assert.equal(unknown(snapshot.limitations), false);
  // Before the last frame the follow-ups are not known.
  const early = chat(chatFrame("Part")).snapshot();
  assert.equal(early.state, "generating");
  assert.equal(early.intermediate, undefined);
});

test("W9 streamed NotebookLM thoughts count as visible thinking", () => {
  const snapshot = chat(
    chatFrame("Thinking about", { kind: 2 }),
    chatFrame("Thinking about the sources", { kind: 2 }),
    chatFrame("Answer.", { final: true }),
  ).snapshot();
  assert.equal(snapshot.thinking, "Thinking about the sources");
  assert.equal(snapshot.text, "Answer.");
  assert.equal(unknown(snapshot.limitations), false);
  // A thought that does not extend the earlier one is a shape not seen.
  const odd = chat(
    chatFrame("First thought", { kind: 2 }),
    chatFrame("Other thought", { kind: 2 }),
    chatFrame("Answer.", { final: true }),
  ).snapshot();
  assert.equal(unknown(odd.limitations), true);
});

test("W9 a NotebookLM reply with an unknown frame or field is partial, never lost", () => {
  const cases: Array<[string, unknown[]]> = [
    [
      "unknown row kind",
      [chatFrame("A", { kind: 7 }), chatFrame("A.", { final: true })],
    ],
    [
      "turn changes",
      [chatFrame("A"), chatFrame("A.", { final: true, turn: SOURCE })],
    ],
    ["bad session id", [chatFrame("A.", { final: true, session: "s1" })]],
    [
      "frame after final",
      [chatFrame("A.", { final: true }), chatFrame("A. B")],
    ],
    ["final without answer", [chatFrame("T", { kind: 2, final: true })]],
  ];
  for (const [name, frames] of cases) {
    const snapshot = chat(...frames).snapshot();
    assert.equal(unknown(snapshot.limitations), true, name);
    assert.equal(snapshot.toolInput, undefined, name);
  }
  const envelope = new NotebooklmChatSession();
  envelope.gemini([
    ...rows(chatFrame("A.", { final: true })),
    ["di", 12],
    ["af.httprm", 11, "x", 1],
  ]);
  assert.equal(unknown(envelope.snapshot().limitations), false);
  const other = new NotebooklmChatSession();
  other.gemini([...rows(chatFrame("A.", { final: true })), ["zz", 1]]);
  assert.equal(unknown(other.snapshot().limitations), true);
  // Stopped before the last frame: cancelled, not failed.
  const stopped = chat(chatFrame("Part"));
  stopped.stopped();
  assert.equal(stopped.snapshot().state, "cancelled");
  // A request that ends before the last frame was stopped: its text counts, its
  // follow-ups stay unknown, and it is not complete.
  const ended = chat(chatFrame("Part"));
  ended.responseEnded();
  assert.equal(ended.snapshot().state, "cancelled");
  assert.equal(ended.snapshot().text, "Part");
  assert.equal(ended.snapshot().intermediate, undefined);
  assert.equal(ended.completionVerified(), false);
  // A finished reply stays complete, and a request without any frame stays unended.
  const done = chat(chatFrame("A.", { final: true }));
  done.responseEnded();
  assert.equal(done.snapshot().state, "completed");
  const nothing = new NotebooklmChatSession();
  nothing.responseEnded();
  assert.equal(nothing.snapshot().state, "generating");
});

test("W9 a notebook guide counts its summary, questions and prompts as output once", () => {
  const guide = [
    [
      ["Summary one.", "Summary two."],
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
    NOTEBOOK,
  ];
  const session = new NotebooklmGuideSession(batchUrl("VfAZjd"));
  session.gemini([
    ["wrb.fr", "VfAZjd", JSON.stringify(guide)],
    ["di", 5],
  ]);
  assert.equal(session.snapshot().state, "generating");
  session.responseEnded();
  const snapshot = session.snapshot();
  assert.equal(snapshot.state, "completed");
  // The notebook is the page's, named by the dispatch, never the id after the guide.
  assert.equal(snapshot.conversationId, null);
  assert.equal(snapshot.text, "");
  assert.equal(snapshot.thinking, "");
  assert.equal(
    snapshot.intermediate,
    "Summary one.\nSummary two.\nQ1?\nPrompt 1\nQ2?\nPrompt 2\nQ3?\nPrompt 3",
  );
  assert.equal(unknown(snapshot.limitations), false);
  // Another RPC in the response, or a second guide, is a shape not seen.
  const other = new NotebooklmGuideSession();
  other.gemini([["wrb.fr", "gArtLc", "[]"]]);
  other.responseEnded();
  assert.equal(other.snapshot().state, "generating");
  assert.equal(unknown(other.snapshot().limitations), true);
  const twice = new NotebooklmGuideSession();
  twice.gemini([
    ["wrb.fr", "VfAZjd", JSON.stringify(guide)],
    ["wrb.fr", "VfAZjd", JSON.stringify(guide)],
  ]);
  assert.equal(unknown(twice.snapshot().limitations), true);
});

test("W9 a guide is named by its notebook and text, so a saved guide read again is the same reply", () => {
  // Seen on 5 Oct 2026: the page asks for the guide the first time a notebook opens and
  // gets the saved guide back unchanged, followed by an id that is not the notebook's.
  const read = (
    summary: string,
    after: string = SOURCE,
    url: URL = batchUrl("VfAZjd"),
  ) => {
    const session = new NotebooklmGuideSession(url);
    session.gemini([
      [
        "wrb.fr",
        "VfAZjd",
        JSON.stringify([[[summary], [[["Q?", "Prompt"]]]], after]),
      ],
    ]);
    session.responseEnded();
    return session.snapshot();
  };
  const first = read("Summary.");
  assert.match(first.attemptId!, /^g_[0-9a-f]{16}$/);
  assert.equal(first.providerRequestId, undefined);
  assert.equal(first.conversationId, null);
  assert.equal(unknown(first.limitations), false);
  // Every guide call of a notebook is one request, named at its dispatch.
  const request = (url: URL) => parseDispatch("notebooklm", url, "").requestId;
  assert.match(request(batchUrl("VfAZjd"))!, /^g_[0-9a-f]{16}$/);
  assert.equal(request(batchUrl("VfAZjd")), request(batchUrl("VfAZjd")));
  assert.notEqual(request(batchUrl("VfAZjd")), first.attemptId);
  assert.notEqual(
    request(
      batchUrl("VfAZjd", "/notebook/f0000000-0000-4000-8000-0000000000b2"),
    ),
    request(batchUrl("VfAZjd")),
  );
  // The same guide read again, whatever id follows it, is the same reply.
  assert.equal(read("Summary.").attemptId, first.attemptId);
  assert.equal(read("Summary.", NOTEBOOK).attemptId, first.attemptId);
  // New text, or the same text in another notebook, is another guide.
  assert.notEqual(read("Summary, rewritten.").attemptId, first.attemptId);
  const elsewhere = read(
    "Summary.",
    SOURCE,
    batchUrl("VfAZjd", "/notebook/f0000000-0000-4000-8000-0000000000b2"),
  );
  assert.notEqual(elsewhere.attemptId, first.attemptId);
  // A request that does not name exactly one notebook gets no ids: each read counts, as
  // before, rather than joining guides of different notebooks.
  for (const url of [
    batchUrl("VfAZjd", "/"),
    new URL(
      "https://notebook.google.com/_/LabsTailwindUi/data/batchexecute?rpcids=VfAZjd&rt=c",
    ),
    new URL(
      `${batchUrl("VfAZjd").href}&source-path=${encodeURIComponent("/notebook/" + NOTEBOOK)}`,
    ),
  ]) {
    const snapshot = read("Summary.", SOURCE, url);
    assert.equal(snapshot.attemptId, undefined);
    assert.equal(snapshot.intermediate, "Summary.\nQ?\nPrompt");
    assert.equal(request(url), null);
  }
  // The created session takes its notebook from the request.
  const created = PACKAGED_PROVIDER_ADAPTERS.get("notebooklm")!.createSession(
    batchUrl("VfAZjd"),
  );
  created.gemini([
    [
      "wrb.fr",
      "VfAZjd",
      JSON.stringify([[["Summary."], [[["Q?", "Prompt"]]]], SOURCE]),
    ],
  ]);
  created.responseEnded();
  assert.equal(created.snapshot().attemptId, first.attemptId);
});

// A Studio list row (3 Oct): id, title, type, sources, status, times at 10 and 15.
const CREATED: [number, number] = [1790876680, 18019000];
const FINISHED: [number, number] = [1790876695, 739509000];
function studio(
  id: string,
  type: number,
  status: number,
  fields: Record<number, unknown> = {},
) {
  const row: unknown[] = Array(38).fill(null);
  row[0] = id;
  row[1] = "A title the user can rename";
  row[2] = type;
  row[3] = [[[SOURCE], null, 4]];
  row[4] = status;
  row[10] = FINISHED;
  row[15] = CREATED;
  row[17] = [null, null, null, null, true];
  row[19] = 1;
  row[21] = "t".repeat(28);
  row[37] = [true];
  for (const [index, value] of Object.entries(fields))
    row[Number(index)] = value;
  return row;
}
const item = (n: number) =>
  `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const doc = (blocks: unknown[]) => [[[blocks], null, null, null, 1]];
const REPORT = doc([
  [null, null, [[[null, null, ["Heading"]]], [null, 5]]],
  [0, 10, [[[0, 10, ["0123456789"]]], [null, 6]]],
  [
    10,
    15,
    [[[10, 15, ["abcde"]]], [null, 1], null, [null, null, 0, { "101": "%0." }]],
  ],
]);
const TABLE = [
  doc([
    [
      0,
      9,
      null,
      null,
      [
        2,
        2,
        [
          [
            0,
            4,
            [
              [0, 2, ["ab"]],
              [2, 4, ["cd"]],
            ],
          ],
          [
            4,
            9,
            [
              [4, 6, ["ef"]],
              [6, 9, ["ghi"]],
            ],
          ],
        ],
      ],
    ],
  ])[0],
  [null, "en"],
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
const list = (...items: unknown[]): NotebooklmHistoryRead => ({
  rpc: "gArtLc",
  value: [items],
});
const created =
  new Date(CREATED[0] * 1000).toISOString().slice(0, 19) + ".018019Z";
function read(value: NotebooklmHistoryRead) {
  let failure: string | undefined;
  const page = parseHistoryText("notebooklm", value, NOTEBOOK, at, (reason) => {
    failure = reason;
  });
  return { page, failure };
}

test("W9 the Studio list counts each item as a request, with the content of ready items", () => {
  const { page } = read(
    list(
      studio(item(1), 11, 3, { 34: REPORT }),
      studio(item(2), 9, 3, { 18: TABLE }),
      studio(item(3), 7, 3, {
        14: [
          [null, "en", null, 1, 1, 1],
          "A title the user can rename",
          [
            [
              "A title the user can rename",
              ["https://lh3.example/i", 2752, 1536],
              "Alt text.",
              "Long text.",
            ],
          ],
        ],
      }),
      studio(item(4), 8, 3, {
        16: [
          [null, "en", 2, 2],
          "A title the user can rename",
          [
            [["https://lh3.example/1", 1376, 768], "Slide one", "Body one"],
            [["https://lh3.example/2", 1376, 768], "Slide two", "Body two"],
          ],
          "https://lh3.example/pdf",
          "https://lh3.example/pptx",
        ],
      }),
      studio(item(5), 1, 3, {
        6: [
          null,
          [null, 1, null, [[SOURCE]], "en", true, 1],
          "https://a",
          "https://b",
          true,
          [["https://b", 4, "audio/mp4"]],
          [394, 239999000],
          null,
          [1, 2],
        ],
      }),
      studio(item(6), 3, 3, {
        8: [
          null,
          "https://v",
          [[[SOURCE]], "en", null, null, 4, null, null, 3],
          "https://w",
          [["https://v", 1, "video/mp4"]],
          [86, 833333000],
          [1, 2],
        ],
      }),
      // Flashcards, quizzes and mind maps carry no content in the list.
      studio(item(7), 4, 3, {
        9: ["", [2, null, null, "en", null, null, null, [2, 2], true]],
      }),
      // An item still generating is a request without a reply yet.
      studio(item(8), 11, 2),
    ),
  );
  assert.equal(page.status, "partial");
  assert.equal(page.branchScope, "loaded_messages");
  assert.equal(page.firstRequestVerified, false);
  const byId = (id: string, role: "prompt" | "response") =>
    page.messages.find((m) => m.sourceId === id && m.role === role);
  assert.equal(page.messages.filter((m) => m.role === "prompt").length, 8);
  assert.equal(page.messages.filter((m) => m.role === "response").length, 6);
  for (const message of page.messages) {
    assert.ok(message.coverageReasons?.includes("no_live_request"));
    assert.equal(message.requestId, null);
    assert.equal(message.liveAttemptId, null);
    assert.equal(message.occurredAt, created);
    assert.equal(message.dateBasis, "entry_created");
    assert.equal(message.modelId, null);
  }
  const prompt = byId(item(1), "prompt")!;
  // The request's own instructions are not shown: read in part at zero.
  assert.equal(prompt.text, "");
  assert.equal(prompt.complete, false);
  assert.deepEqual(prompt.coverageReasons, ["no_live_request"]);
  const report = byId(item(1), "response")!;
  assert.equal(report.text, "Heading\n0123456789\nabcde");
  assert.equal(report.complete, true);
  assert.deepEqual(report.coverageReasons, ["no_live_request"]);
  assert.equal(report.promptSourceId, item(1));
  assert.equal(report.parentSourceId, item(1));
  assert.equal(report.parentRole, "prompt");
  assert.equal(report.timing?.source, "notebooklm_history");
  assert.equal(report.timing?.scope, "provider_message");
  assert.equal(report.timing?.completeness, "complete_for_scope");
  assert.equal(report.timing?.duration_seconds, "15.72149");
  assert.equal(byId(item(2), "response")!.text, "ab\ncd\nef\nghi");
  const infographic = byId(item(3), "response")!;
  assert.equal(infographic.text, "Alt text.\nLong text.");
  assert.deepEqual(infographic.media, [
    {
      kind: "image",
      count: 1,
      width: 2752,
      height: 1536,
      model: "notebooklm-image",
      outcome: "returned",
    },
  ]);
  const slides = byId(item(4), "response")!;
  assert.equal(slides.text, "Slide one\nBody one\nSlide two\nBody two");
  assert.deepEqual(slides.media, [
    {
      kind: "image",
      count: 2,
      width: 1376,
      height: 768,
      model: "notebooklm-image",
      outcome: "returned",
    },
  ]);
  const audio = byId(item(5), "response")!;
  // The script is not shown (D6): no text, the stored length as speech (D4).
  assert.equal(audio.text, "");
  assert.equal(audio.complete, true);
  assert.deepEqual(audio.media, [
    {
      kind: "speech",
      basis: "stored_length",
      seconds: 394.239999,
      characters: null,
    },
  ]);
  assert.deepEqual(byId(item(6), "response")!.media, [
    { kind: "video_overview", durationSeconds: 86.833333 },
  ]);
  assert.equal(byId(item(7), "response"), undefined);
  assert.equal(byId(item(8), "response"), undefined);
  // A reply follows its own request.
  const order = page.messages.map((m) => `${m.role}:${m.sourceId.slice(-2)}`);
  assert.deepEqual(order.slice(0, 4), [
    "prompt:01",
    "response:01",
    "prompt:02",
    "response:02",
  ]);
});

test("W9 an opened flashcard set, quiz or mind map counts its content; other opened items do not", () => {
  const quiz = studio(item(9), 4, 3, {
    9: ["<html>app</html>", [2, null, null, "en"], null, QUIZ],
  });
  const { page } = read({ rpc: "v9rmvd", value: [quiz] });
  assert.deepEqual(
    page.messages.map((m) => m.role),
    ["prompt", "response"],
  );
  const reply = page.messages[1]!;
  // String values only, keys and flags are not text; the page around it is not counted.
  assert.equal(reply.text, "Q?\nA\nR\nH\nT");
  assert.deepEqual(reply.coverageReasons, ["no_live_request"]);
  assert.equal(reply.timing?.duration_seconds, "15.72149");
  // The list supplies every other type's reply, so an opened report adds only its request.
  const report = read({
    rpc: "v9rmvd",
    value: [studio(item(1), 11, 3, { 34: REPORT })],
  });
  assert.deepEqual(
    report.page.messages.map((m) => m.role),
    ["prompt"],
  );
  // Content that cannot be read keeps the request and leaves the reply partial.
  const broken = read({
    rpc: "v9rmvd",
    value: [studio(item(9), 4, 3, { 9: ["", [2], null, "{not json"] })],
  }).page.messages[1]!;
  assert.equal(broken.text, null);
  assert.equal(broken.complete, false);
  assert.deepEqual(broken.coverageReasons, [
    "no_live_request",
    "unknown_event_observed",
  ]);
  assert.equal(broken.timing?.completeness, "partial");
});

test("W9 Studio items of a shape not seen keep the request and leave the reply partial", () => {
  const { page } = read(
    list(
      studio(item(1), 11, 3, {
        34: doc([[0, 10, [[[0, 10, ["short"]]]]]]),
      }),
      studio(item(2), 12, 3),
      studio(item(3), 11, 5),
      studio(item(4), 1, 3),
    ),
  );
  const replies = page.messages.filter((m) => m.role === "response");
  // A range the text does not fill: the text still counts, the layout is unverified.
  assert.equal(replies[0]!.text, "short");
  assert.equal(replies[0]!.complete, true);
  assert.deepEqual(replies[0]!.coverageReasons, [
    "no_live_request",
    "unknown_event_observed",
  ]);
  // A type or a status not seen: the reply is unread, not zero.
  for (const reply of replies.slice(1, 3)) {
    assert.equal(reply.text, null);
    assert.deepEqual(reply.coverageReasons, [
      "no_live_request",
      "unknown_event_observed",
    ]);
  }
  // An audio item without its length: no speech, and the reply is partial.
  assert.equal(replies[3]!.text, "");
  assert.equal(replies[3]!.media, undefined);
  assert.ok(replies[3]!.coverageReasons?.includes("unknown_event_observed"));
  assert.equal(page.messages.filter((m) => m.role === "prompt").length, 4);
});

test("W9 an empty Studio list is a complete read; malformed reads are unsupported", () => {
  for (const value of [[[]], [null], []]) {
    const { page } = read({ rpc: "gArtLc", value });
    assert.equal(page.status, "partial");
    assert.equal(page.messages.length, 0);
  }
  const bad = [
    list(studio("not-an-id", 11, 3)),
    list("row"),
    { rpc: "v9rmvd", value: [] },
    { rpc: "gArtLc", value: ["rows"] },
  ] as NotebooklmHistoryRead[];
  for (const value of bad) {
    const { page, failure } = read(value);
    assert.equal(
      page.status,
      "unsupported",
      JSON.stringify(value).slice(0, 60),
    );
    assert.equal(failure, "history_unsupported");
  }
  // The notebook id must be one: another conversation id is unsupported.
  assert.equal(
    parseHistoryText("notebooklm", list(), "c_00000000000000a1", at).status,
    "unsupported",
  );
});

test("W9 a Studio batch response holds one reply row of the Studio list or an opened item", () => {
  const line = (rows: unknown[]) => {
    const text = JSON.stringify(rows);
    return `${text.length + 2}\n${text}\n`;
  };
  const body = (...lines: string[]) => ")]}'\n\n" + lines.join("");
  const payload = JSON.stringify([[studio(item(1), 11, 2)]]);
  const read = notebooklmHistoryFrames(
    body(
      line([["wrb.fr", "gArtLc", payload, null, null, null, "generic"]]),
      line([
        ["di", 21],
        ["af.httprm", 20, "x", 2],
      ]),
      line([["e", 4, null, null, 99]]),
    ),
  );
  assert.equal(read.rpc, "gArtLc");
  assert.deepEqual(read.value, JSON.parse(payload));
  assert.equal(
    notebooklmHistoryFrames(body(line([["wrb.fr", "v9rmvd", "[[]]"]]))).rpc,
    "v9rmvd",
  );
  for (const bad of [
    body(line([["wrb.fr", "hNvQHb", "[]"]])),
    body(
      line([
        ["wrb.fr", "gArtLc", "[]"],
        ["wrb.fr", "gArtLc", "[]"],
      ]),
    ),
    body(line([["wrb.fr", "gArtLc", null]])),
    body(line([["er", 3]])),
    body('9\n[["di",1]]\n'),
    "[[]]",
  ])
    assert.throws(
      () => notebooklmHistoryFrames(bad),
      /history_unsupported|JSON/,
    );
});

test("W9 review: a cumulative answer that does not extend the earlier one is partial", () => {
  const shrunk = chat(
    chatFrame("A much longer answer"),
    chatFrame("A", { final: true }),
  ).snapshot();
  assert.equal(shrunk.text, "A");
  assert.equal(unknown(shrunk.limitations), true);
  const grown = chat(
    chatFrame("A"),
    chatFrame("A longer answer", { final: true }),
  ).snapshot();
  assert.equal(unknown(grown.limitations), false);
});

test("W9 review: missing or differing follow-up lists leave the reply partial", () => {
  const final = (three: unknown, five: unknown) => {
    const frame: unknown[] = chatFrame("Answer.", { final: true });
    frame[3] = three;
    frame[5] = five;
    return chat(frame).snapshot();
  };
  const same = final(
    [["One?", "Two?"]],
    [
      [
        ["One?", 1],
        ["Two?", 1],
      ],
    ],
  );
  assert.equal(same.intermediate, "One?\nTwo?");
  assert.equal(unknown(same.limitations), false);
  // One list alone names the questions.
  const plain = final([["One?"]], null);
  assert.equal(plain.intermediate, "One?");
  assert.equal(unknown(plain.limitations), false);
  // Neither list: the questions are unknown, not none.
  const missing = final(null, null);
  assert.equal(missing.intermediate, undefined);
  assert.equal(unknown(missing.limitations), true);
  // Lists that disagree: the questions count, the reply is partial.
  const differing = final(
    [["One?", "Two?"]],
    [
      [
        ["One?", 1],
        ["Other?", 1],
      ],
    ],
  );
  assert.equal(differing.intermediate, "One?\nOther?");
  assert.equal(unknown(differing.limitations), true);
  const shorter = final(
    [["One?"]],
    [
      [
        ["One?", 1],
        ["Two?", 1],
      ],
    ],
  );
  assert.equal(unknown(shorter.limitations), true);
});

test("W9 re-review: a fourth follow-up question counts; only a list past the bound is partial", () => {
  // Three questions were always seen, yet a fourth is still generated text, so it counts.
  const four = ["One?", "Two?", "Three?", "Four?"];
  const counted = chat(
    chatFrame("Answer.", { final: true, suggestions: four }),
  ).snapshot();
  assert.equal(counted.intermediate, four.join("\n"));
  assert.equal(unknown(counted.limitations), false);
  // A list longer than any follow-up list is not read as questions.
  const many = Array.from({ length: 9 }, (_, i) => `Question ${i}?`);
  const unread = chat(
    chatFrame("Answer.", { final: true, suggestions: many }),
  ).snapshot();
  assert.equal(unread.intermediate, undefined);
  assert.equal(unknown(unread.limitations), true);
});

test("W9 review: a guide suggestion is exactly a question and its prompt", () => {
  const guide = (questions: unknown[]) => {
    const session = new NotebooklmGuideSession();
    session.gemini([
      [
        "wrb.fr",
        "VfAZjd",
        JSON.stringify([[["Summary."], [questions]], NOTEBOOK]),
      ],
    ]);
    session.responseEnded();
    return session.snapshot();
  };
  const exact = guide([
    ["Q?", "Prompt"],
    ["R?", null],
  ]);
  assert.equal(exact.intermediate, "Summary.\nQ?\nPrompt\nR?");
  assert.equal(unknown(exact.limitations), false);
  // A third field is a shape not seen: it is not counted and the guide is partial.
  const extra = guide([["Q?", "Prompt", "metadata"]]);
  assert.equal(extra.intermediate, "Summary.\nQ?\nPrompt");
  assert.equal(unknown(extra.limitations), true);
  const short = guide([["Q?"]]);
  assert.equal(unknown(short.limitations), true);
  const odd = guide([["Q?", 5]]);
  assert.equal(odd.intermediate, "Summary.\nQ?");
  assert.equal(unknown(odd.limitations), true);
});

test("W9 review: an opened item of another kind keeps its request and leaves the reply unread", () => {
  for (const kind of [1, 2, 4])
    assert.equal(
      read({
        rpc: "v9rmvd",
        value: [studio(item(9), 4, 3, { 9: ["", [kind], null, QUIZ] })],
      }).page.messages[1]!.text,
      "Q?\nA\nR\nH\nT",
      String(kind),
    );
  for (const options of [[7], [], null, "x"]) {
    const reply = read({
      rpc: "v9rmvd",
      value: [studio(item(9), 4, 3, { 9: ["", options, null, QUIZ] })],
    }).page.messages[1]!;
    assert.equal(reply.text, null, JSON.stringify(options));
    assert.equal(reply.complete, false);
    assert.deepEqual(reply.coverageReasons, [
      "no_live_request",
      "unknown_event_observed",
    ]);
  }
});
