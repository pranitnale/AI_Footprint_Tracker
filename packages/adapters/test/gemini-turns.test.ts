import test from "node:test";
import assert from "node:assert/strict";
import { LIMITS } from "@footprint/capture-core";
import { GeminiSession, parseDispatch, parseHistoryText } from "../src";
import { geminiField, geminiReply } from "../src/gemini-content";
import { HISTORY_LIMITS } from "../src/history";

// Shapes as seen on 1 and 3 Oct 2026 (G2 to G6); ids and text are synthetic.
const CHAT = "c_00000000000000a1";
const TURN = "r_00000000000000b1";
const REPLY = "rc_00000000000000c1";
const at = "2026-10-04T12:00:00.000Z";

function candidate(fields: Record<number, unknown>, id = REPLY) {
  const value: unknown[] = Array(38).fill(null);
  value[0] = id;
  for (const [index, field] of Object.entries(fields))
    value[Number(index)] = field;
  return value;
}
function inner(fields: {
  candidates?: unknown[];
  label?: string;
  job?: unknown;
}) {
  const value: unknown[] = Array(43).fill(null);
  value[1] = [CHAT, TURN];
  if (fields.candidates) value[4] = fields.candidates;
  if (fields.job) value[6] = fields.job;
  value[42] = fields.label ?? "3.6 Thinking";
  return value;
}
const rows = (...frames: unknown[]) =>
  frames.map((frame) => ["wrb.fr", null, JSON.stringify(frame)]);
function live(...frames: unknown[]) {
  const session = new GeminiSession();
  session.gemini(rows(...frames));
  return session;
}
const unknown = (limitations: readonly string[] | undefined) =>
  !!limitations?.includes("unknown_event_observed");

/** A saved turn: ids, prior turn, prompt record, response record and stored time. */
function savedTurn(
  index: number,
  reply: unknown[],
  options: {
    prior?: [string, string, string] | null;
    label?: string | null;
    time?: [number, number];
    prompt?: unknown[];
    others?: unknown[];
  } = {},
) {
  const response: unknown[] = Array(26).fill(null);
  response[0] = [reply, ...(options.others ?? [])];
  response[3] = reply[0];
  response[21] = options.label === undefined ? "3.6 Thinking" : options.label;
  const prompt: unknown[] = Array(11).fill(null);
  prompt[0] = options.prompt ?? [`prompt ${index}`];
  return [
    [CHAT, `r_00000000000000b${index}`],
    options.prior ?? null,
    prompt,
    response,
    options.time ?? [1791057693, 472416000],
  ];
}
function history(...turns: unknown[]) {
  return parseHistoryText("gemini", [turns, null, null, []], CHAT, at);
}
function savedReply(fields: Record<number, unknown>, options = {}) {
  const page = history(savedTurn(1, candidate(fields), options));
  assert.notEqual(page.status, "unsupported");
  return page.messages[1]!;
}

test("geminiField reads a field by position or from the trailing object of sparse fields", () => {
  assert.equal(geminiField(["a", "b"], 1), "b");
  // Sparse fields are keyed by field number, the position plus one.
  assert.equal(geminiField([null, [], { "57": "entry" }], 56), "entry");
  assert.equal(geminiField([null, { "1": "first" }], 0), "first");
  assert.deepEqual(geminiField([{ "8": [], "60": "video" }], 7), []);
  assert.equal(geminiField([{ "8": [], "60": "video" }], 59), "video");
  assert.equal(geminiField(["a", { "2": "b" }], 1), "b");
  assert.equal(geminiField(["a"], 5), undefined);
  assert.equal(geminiField("not a message", 0), undefined);
  assert.equal(geminiField(null, 0), undefined);
});

test("Gemini status frames name the chat and turn; content frames add the reply, label and thoughts", () => {
  const session = new GeminiSession();
  // A status frame: ids, then the turn again in a sparse field (3 Oct).
  session.gemini(rows([null, [CHAT, TURN], { "18": TURN, "44": true }]));
  let snapshot = session.snapshot();
  assert.equal(snapshot.conversationId, CHAT);
  assert.equal(snapshot.providerRequestId, TURN);
  assert.equal(snapshot.started, false);
  assert.equal(snapshot.text, null);
  session.gemini(
    rows(
      inner({
        candidates: [
          candidate({
            1: ["The answer."],
            37: [["Thinking about it."], [[["Thinking about it."], "", ""]]],
          }),
        ],
      }),
    ),
  );
  snapshot = session.snapshot();
  assert.equal(snapshot.text, "The answer.");
  assert.equal(snapshot.thinking, "Thinking about it.");
  assert.equal(snapshot.model, "3.6 Thinking");
  assert.equal(snapshot.outputId, REPLY);
  assert.equal(snapshot.started, true);
  // A fully read reply: no tool input, plan or shown results, all read as empty.
  assert.equal(snapshot.toolInput, "");
  assert.equal(snapshot.intermediate, "");
  assert.equal(snapshot.toolOutput, "");
  assert.ok(!unknown(snapshot.limitations));
  assert.equal(session.completionVerified(), false);
  session.responseEnded();
  assert.equal(session.snapshot().state, "completed");
  assert.equal(session.completionVerified(), true);
  // A stop after the end changes nothing.
  session.stopped();
  assert.equal(session.snapshot().state, "completed");
});

test("Gemini thoughts: none shown reads as empty, an unreadable shape stays unknown", () => {
  for (const thoughts of [null, []])
    assert.equal(
      geminiReply(candidate({ 1: ["a"], 37: thoughts })).thinking,
      "",
    );
  for (const thoughts of [[[1]], "text", 5, [null]]) {
    const reply = geminiReply(candidate({ 1: ["a"], 37: thoughts }));
    assert.equal(reply.thinking, null, JSON.stringify(thoughts));
    assert.equal(reply.unknown, true, JSON.stringify(thoughts));
  }
  const session = live(
    inner({ candidates: [candidate({ 1: ["a"], 37: [[1]] })] }),
  );
  assert.equal(session.snapshot().thinking, null);
  assert.ok(unknown(session.snapshot().limitations));
});

test("links Google shows its own image or video player in are not answer text", () => {
  const video = geminiReply(
    candidate({
      1: [
        "Your video is ready!\n\nhttp://googleusercontent.com/video_gen_chip/16841147095918590003",
      ],
    }),
  );
  assert.equal(video.answer, "Your video is ready!");
  assert.equal(video.empty, false);
  const image = geminiReply(
    candidate({
      1: ["http://googleusercontent.com/image_generation_content/0"],
    }),
  );
  assert.equal(image.answer, "");
  // The answer was not empty as stored: the turn is not a stopped one.
  assert.equal(image.empty, false);
  for (const text of [
    "See https://googleusercontent.com/profile/picture",
    "https://example.com/image_generation_content/0",
    "https://googleusercontent.com.evil.test/image_generation_content/0",
  ])
    assert.equal(geminiReply(candidate({ 1: [text] })).answer, text);
  // Answer text in several strings is joined in order.
  assert.equal(
    geminiReply(candidate({ 1: ["one ", "two"] })).answer,
    "one two",
  );
  const empty = geminiReply(candidate({ 1: [""] }));
  assert.equal(empty.answer, "");
  assert.equal(empty.empty, true);
});

/** A Canvas document as stored on 3 Oct: file name, content again with its language. */
function canvasDocument(title: string, content: string) {
  const value: unknown[] = Array(17).fill(null);
  value[0] = "c3f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5";
  value[2] = title;
  value[4] = content;
  value[7] = [[1791057962, 667031000], null, 1, false, false];
  value[9] = "index.html";
  value[10] = 2;
  value[12] = false;
  value[14] = [
    content,
    "html",
    null,
    false,
    true,
    null,
    null,
    [["v1", [1, 2]]],
  ];
  value[16] = true;
  return value;
}
const canvasTools = [
  {
    "8": [],
    "57": [
      [
        ["Creating the page"],
        "c3f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5",
        null,
        "Hello AIFT",
        null,
        [1791057961, 743202459],
        null,
        2,
      ],
    ],
  },
];

test("Canvas documents count once as tool input, with their title (G19)", () => {
  const html = "<html><body>Hello</body></html>";
  const fields = {
    1: ["Here is your page."],
    12: canvasTools,
    30: [canvasDocument("Hello AIFT", html)],
  };
  const snapshot = live(inner({ candidates: [candidate(fields)] })).snapshot();
  assert.equal(snapshot.toolInput, `Hello AIFT\n${html}`);
  assert.equal(snapshot.components, undefined);
  assert.ok(!snapshot.limitations.includes("research_work_unobserved"));
  assert.ok(!unknown(snapshot.limitations));
  const saved = savedReply(fields);
  assert.equal(saved.toolInput, `Hello AIFT\n${html}`);
  assert.equal(saved.text, "Here is your page.");
  assert.equal(saved.coverageReasons, undefined);
  assert.equal(saved.complete, true);
  // A document list that cannot be read leaves tool input unknown, not empty.
  const unreadable = geminiReply(candidate({ 1: ["a"], 30: "document" }));
  assert.equal(unreadable.toolInput, undefined);
  assert.equal(unreadable.unknown, true);
  const savedUnreadable = savedReply({ 1: ["a"], 30: "document" });
  assert.equal(savedUnreadable.toolInput, undefined);
  assert.ok(unknown(savedUnreadable.coverageReasons));
});

const plan = [
  "Germany wind energy share",
  [
    [
      1,
      "Research Websites",
      "(1) Find the share of wind in German generation.",
    ],
    [2, "Analyze Results"],
    [3, "Create Report"],
  ],
  "Ready in a few mins",
  ["Start research"],
  ["Not part of the plan text", 0],
  ["Edit plan", [null, null, null, "Edit the research plan"]],
];

test("a Deep Research plan counts as intermediate text; the plan turn has no hidden research", () => {
  const fields = {
    1: ["Here's a research plan."],
    12: [{ "8": [], "56": plan, "70": 2 }],
  };
  const expected = [
    "Germany wind energy share",
    "Research Websites",
    "(1) Find the share of wind in German generation.",
    "Analyze Results",
    "Create Report",
  ].join("\n");
  const snapshot = live(inner({ candidates: [candidate(fields)] })).snapshot();
  assert.equal(snapshot.intermediate, expected);
  assert.ok(!snapshot.limitations.includes("research_work_unobserved"));
  assert.ok(!unknown(snapshot.limitations));
  const saved = savedReply(fields);
  assert.equal(saved.intermediate, expected);
  assert.equal(saved.coverageReasons, undefined);
  // A plan in a shape not seen leaves the intermediate part unknown.
  const odd = geminiReply(
    candidate({ 1: ["a"], 12: [{ "56": ["Title", [[1, { step: 1 }]]] }] }),
  );
  assert.equal(odd.intermediate, undefined);
  assert.equal(odd.unknown, true);
  // Tool data that cannot be read leaves it unknown too.
  const tools = geminiReply(candidate({ 1: ["a"], 12: "tools" }));
  assert.equal(tools.intermediate, undefined);
  assert.equal(tools.unknown, true);
});

/** The research document entry (field 57) and status (field 58) of a started run. */
function researchTools(stored: [number, number]) {
  return [
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    [],
    {
      "57": [
        [
          ["Researching"],
          "im_34b2f39e8e72ad53",
          "Germany wind energy share",
          "Germany wind energy share",
          null,
          stored,
          null,
          3,
        ],
      ],
      "58": [
        "Germany wind energy share",
        [null, null, null, null, ["Researching websites..."]],
        [null, []],
        null,
        [null, null, null, null, [null, null, 5]],
      ],
      "70": 3,
    },
  ];
}
function researchDocument(report: string | null) {
  const value: unknown[] = Array(18).fill(null);
  value[0] = "im_34b2f39e8e72ad53";
  value[2] = "Germany 2025 Wind Energy Share";
  value[3] = "Germany wind energy share";
  value[4] = report;
  if (report !== null) {
    value[5] = [{ "44": [[[" [cite: 1]"], [[null, null, null, [["a"], 1]]]]] }];
    value[8] = [[[null, 1]]];
    value[9] = "im_34b2f39e8e72ad53";
    value[10] = 3;
    value[17] = [[null, 1]];
  }
  return value;
}

test("a started Deep Research run marks hidden research work; its report counts once stored, with the run's time (G4)", () => {
  const start = {
    1: ["I've started the research."],
    12: researchTools([1791057693, 968215000]),
    30: [researchDocument(null)],
  };
  const snapshot = live(inner({ candidates: [candidate(start)] })).snapshot();
  assert.ok(snapshot.limitations.includes("research_work_unobserved"));
  assert.equal(snapshot.components, undefined);
  assert.equal(snapshot.toolInput, "");
  assert.ok(!unknown(snapshot.limitations));
  // Saved after the run: the report document and its stored time (G4: 109 s).
  const report = "Wind supplied a large share of German electricity in 2025.";
  const saved = savedReply(
    {
      1: ["I've completed your research."],
      12: researchTools([1791057802, 500000000]),
      30: [researchDocument(report)],
    },
    { time: [1791057693, 472416000] },
  );
  assert.deepEqual(saved.components, [
    {
      role: "research",
      model: "3.6 Thinking",
      text: `Germany 2025 Wind Energy Share\n${report}`,
      outputTokens: null,
      timing: {
        duration_seconds: "109.027584",
        source: "gemini_history",
        scope: "research_task",
        completeness: "complete_for_scope",
        profile_version: "timing-observation-1",
      },
    },
  ]);
  assert.deepEqual(saved.coverageReasons, ["research_work_unobserved"]);
  assert.equal(saved.toolInput, "");
  assert.equal(saved.complete, true);
  // Without a stored time the report counts without a duration.
  const untimed = savedReply({
    1: ["Done."],
    12: [{ "8": [], "58": ["Germany wind energy share"], "70": 3 }],
    30: [researchDocument(report)],
  });
  assert.equal(untimed.components?.[0]?.timing, undefined);
  assert.equal(
    untimed.components?.[0]?.text,
    `Germany 2025 Wind Energy Share\n${report}`,
  );
  // A document with sources is a report even without the status field.
  const sourced = geminiReply(
    candidate({ 1: ["Done."], 30: [researchDocument(report)] }),
  );
  assert.equal(sourced.research, true);
  assert.equal(
    sourced.report?.text,
    `Germany 2025 Wind Energy Share\n${report}`,
  );
  assert.equal(sourced.toolInput, "");
  // A live report, when the stream carries one, counts without the run's time.
  const liveReport = live(
    inner({
      candidates: [
        candidate({
          1: ["Done."],
          12: researchTools([1791057802, 500000000]),
          30: [researchDocument(report)],
        }),
      ],
    }),
  ).snapshot();
  assert.deepEqual(liveReport.components, [
    {
      role: "research",
      model: "3.6 Thinking",
      text: `Germany 2025 Wind Energy Share\n${report}`,
      outputTokens: null,
    },
  ]);
});

test("a finished Deep Research run counts the thoughts its panel shows, not the sites it browsed (5 Oct 2026)", () => {
  // As saved on 5 Oct 2026 (values synthetic): after the progress label, the status lists
  // the run's steps, a thought ([5], heading and text, the heading sometimes null) or a
  // site it browsed ([4], a link, title and site name).
  const site = (url: string) => [
    null,
    null,
    null,
    null,
    [1, null, [url, "Page title", "example.invalid", null, []]],
  ];
  const thought = (heading: string | null, text: string) => [
    null,
    null,
    null,
    null,
    null,
    [heading, text],
  ];
  const withSteps = (steps: unknown[]) => {
    const tools = researchTools([1791057802, 500000000]);
    const fields = tools[8] as Record<string, unknown[]>;
    fields["58"] = [
      "Germany wind energy share",
      [null, null, null, null, ["Researching websites...", null, steps]],
      [null, []],
      null,
      [null, null, null, null, [null, null, 5]],
    ];
    return tools;
  };
  const report = "Wind supplied a large share of German electricity in 2025.";
  const steps = [
    [null, null, null, null, [1, "Researching websites", null, []]],
    thought("Defining the scope", "I am looking for the 2025 share."),
    site("https://example.invalid/a"),
    site("https://example.invalid/b"),
    thought(null, "The figures agree."),
  ];
  const saved = savedReply({
    1: ["I've completed your research."],
    12: withSteps(steps),
    30: [researchDocument(report)],
  });
  assert.equal(
    saved.thinking,
    "Defining the scope\nI am looking for the 2025 share.\nThe figures agree.",
  );
  assert.deepEqual(saved.coverageReasons, ["research_work_unobserved"]);
  // The same reply read live counts the same thoughts.
  const snapshot = live(
    inner({
      candidates: [
        candidate({
          1: ["Done."],
          12: withSteps(steps),
          30: [researchDocument(report)],
        }),
      ],
    }),
  ).snapshot();
  assert.equal(snapshot.thinking, saved.thinking);
  // A step of another shape is not guessed at: the reply is partial.
  const odd = geminiReply(
    candidate({
      1: ["Done."],
      12: withSteps([...steps, [null, null, null, null, null, [1]]]),
    }),
  );
  assert.equal(odd.unknown, true);
  assert.equal(odd.thinking, "");
  // So is a site step of another shape; the reply's other parts stay readable.
  const oddSite = geminiReply(
    candidate({
      1: ["Done."],
      12: withSteps([...steps, [null, null, null, null, ["future-kind"]]]),
    }),
  );
  assert.equal(oddSite.unknown, true);
  assert.equal(oddSite.answer, "Done.");
  // A thought the turn's own thoughts already hold is counted once.
  const both = geminiReply(
    candidate({
      1: ["Done."],
      37: [["Defining the scope\nI am looking for the 2025 share."]],
      12: withSteps(steps),
    }),
  );
  assert.equal(
    both.thinking,
    "Defining the scope\nI am looking for the 2025 share.\nThe figures agree.",
  );
  assert.equal(both.unknown, false);
});

/** A saved video job (G3): media with size and length, and the generation record. */
function videoJob(media: unknown[] | null) {
  const generation: unknown[] = Array(29).fill(null);
  generation[0] = "Generate a short video of a red ball.";
  generation[2] = [null, null, "models/omni_1p2_pro_gemini_app", 1, 14, 1];
  generation[7] = [
    "A red ball bounces on a white floor, shot from a low angle, in soft light.",
    null,
    "A red ball bounces.",
    "",
  ];
  generation[9] = 35;
  generation[28] = [
    [
      "A red ball bounces on a white floor, shot from a low angle, in soft light.",
      null,
      "A red ball bounces.",
      "",
    ],
  ];
  return [media, generation];
}
function videoMedia(spec: unknown, mime = "video/mp4") {
  const value: unknown[] = Array(25).fill(null);
  value[1] = 2;
  value[2] = "video.mp4";
  value[8] = 2;
  value[9] = [1791056932, 538124183];
  value[11] = mime;
  value[17] = spec;
  value[24] = 1812069;
  return value;
}

test("saved videos count their size, length and model, and the longest storyboard once without a model (G3, EP2)", () => {
  const saved = savedReply(
    {
      1: [
        "Your video is ready!\n\nhttp://googleusercontent.com/video_gen_chip/16841147095918590003",
      ],
      12: [
        {
          "8": [],
          "60": [[videoJob([videoMedia([[9, 999999000], 1280, 720])])]],
        },
      ],
    },
    { label: "Gemini Omni 1.1 Flash" },
  );
  assert.equal(saved.text, "Your video is ready!");
  assert.deepEqual(saved.media, [
    {
      kind: "video",
      model: "models/omni_1p2_pro_gemini_app",
      width: 1280,
      height: 720,
      durationSeconds: 9.999999,
      withAudio: null,
    },
  ]);
  assert.deepEqual(saved.components, [
    {
      role: "storyboard",
      model: null,
      text: "A red ball bounces on a white floor, shot from a low angle, in soft light.",
      outputTokens: null,
    },
  ]);
  assert.equal(saved.coverageReasons, undefined);
  // A job without media made no video (1 Oct, free account); its storyboard was written.
  const failed = savedReply({
    1: ["I couldn't make that video."],
    12: [{ "8": [], "60": [[videoJob(null)]] }],
  });
  assert.equal(failed.media, undefined);
  assert.equal(failed.components?.[0]?.role, "storyboard");
  assert.equal(failed.coverageReasons, undefined);
  // A size or length the record does not show stays unknown; a non-video item is not read.
  const partial = geminiReply(
    candidate({
      1: ["a"],
      12: [
        {
          "60": [
            [
              videoJob([
                videoMedia([null, 1280]),
                videoMedia([[0, 0], 1280, 720]),
                videoMedia([[5, 0], 640, 360], "image/png"),
              ]),
            ],
          ],
        },
      ],
    }),
  );
  assert.deepEqual(
    partial.videos.map((video) => [
      video.width,
      video.height,
      video.durationSeconds,
    ]),
    [
      [null, null, null],
      [1280, 720, null],
    ],
  );
  assert.equal(partial.unknown, true);
  // Live, a finished video found in the stream becomes media too.
  const snapshot = live(
    inner({
      candidates: [
        candidate({
          1: ["Your video is ready!"],
          12: [{ "60": [[videoJob([videoMedia([[8, 0], 1280, 720])])]] }],
        }),
      ],
    }),
  ).snapshot();
  assert.deepEqual(snapshot.media, [
    {
      kind: "video",
      model: "models/omni_1p2_pro_gemini_app",
      width: 1280,
      height: 720,
      durationSeconds: 8,
      withAudio: null,
    },
  ]);
  assert.equal(snapshot.components?.[0]?.role, "storyboard");
});

test("a live video turn shows a job reply without a candidate: no reply text or id, completed at the request's end (G3)", () => {
  const session = live(
    [null, [CHAT, TURN], { "18": TURN }],
    inner({
      job: [
        "I'm generating your video. Check back to see when your video is ready.",
        ["video_generation", null, 1],
      ],
    }),
  );
  let snapshot = session.snapshot();
  assert.equal(snapshot.started, true);
  assert.equal(snapshot.text, null);
  assert.equal(snapshot.outputId, null);
  assert.equal(snapshot.providerRequestId, TURN);
  assert.ok(!unknown(snapshot.limitations));
  session.responseEnded();
  snapshot = session.snapshot();
  assert.equal(snapshot.state, "completed");
  // A request that ended with nothing shown stays generating; the runtime decides.
  const nothing = live([null, [CHAT, TURN], { "18": TURN }]);
  nothing.responseEnded();
  assert.equal(nothing.snapshot().state, "generating");
});

/** A generated image entry (1 Oct): MIME type and `[width, height, bytes]`. */
function imageEntry(width: number, height: number, mime = "image/png") {
  const record: unknown[] = Array(16).fill(null);
  record[11] = mime;
  record[15] = [width, height, 123456];
  return [[null, null, null, record]];
}

test("generated images count by size under the turn's label; live as one image operation (D1)", () => {
  const fields = {
    1: ["http://googleusercontent.com/image_generation_content/0"],
    12: [
      {
        "8": [
          [
            imageEntry(1024, 1024),
            imageEntry(1024, 1024),
            imageEntry(896, 1152),
          ],
          null,
          [true],
        ],
      },
    ],
  };
  const saved = savedReply(fields, { label: "Nano Banana 2" });
  assert.equal(saved.text, "");
  assert.equal(saved.complete, true);
  assert.deepEqual(saved.media, [
    {
      kind: "image",
      count: 2,
      width: 1024,
      height: 1024,
      model: "Nano Banana 2",
      outcome: "returned",
    },
    {
      kind: "image",
      count: 1,
      width: 896,
      height: 1152,
      model: "Nano Banana 2",
      outcome: "returned",
    },
  ]);
  const session = live(
    inner({ label: "Nano Banana 2", candidates: [candidate(fields)] }),
  );
  session.responseEnded();
  const snapshot = session.snapshot();
  assert.equal(snapshot.media, undefined);
  assert.deepEqual(snapshot.imageOperations, [
    {
      id: `gemini-images:${REPLY}`,
      parentId: null,
      model: "Nano Banana 2",
      kind: "unknown",
      requestedCount: null,
      outputs: [
        { id: `${REPLY}:0`, width: 1024, height: 1024 },
        { id: `${REPLY}:1`, width: 1024, height: 1024 },
        { id: `${REPLY}:2`, width: 896, height: 1152 },
      ],
      state: "completed",
    },
  ]);
  // An entry of another kind is not counted as an image, and the reply is partial.
  const other = geminiReply(
    candidate({
      1: ["a"],
      12: [
        { "8": [[imageEntry(10, 10, "video/mp4"), [[null]]], null, [true]] },
      ],
    }),
  );
  assert.equal(other.images.length, 0);
  assert.equal(other.unknown, true);
  // No images: the empty list of every other turn (G2).
  const none = geminiReply(
    candidate({ 1: ["a"], 12: [null, null, null, null, null, null, null, []] }),
  );
  assert.deepEqual(none.images, []);
  assert.equal(none.unknown, false);
});

test("unknown rows, unreadable frames and unknown tool fields make a live reply partial instead of failing it", () => {
  const answer = inner({ candidates: [candidate({ 1: ["kept"] })] });
  for (const extra of [
    ["unknown-row"],
    "not a row",
    ["wrb.fr", null, "{not json"],
    ["wrb.fr", null, 42],
    ["wrb.fr", null, JSON.stringify("not a frame")],
  ]) {
    const session = new GeminiSession();
    session.gemini([["wrb.fr", null, JSON.stringify(answer)], extra]);
    assert.equal(session.snapshot().text, "kept", JSON.stringify(extra));
    assert.ok(unknown(session.snapshot().limitations), JSON.stringify(extra));
  }
  const notRows = new GeminiSession();
  notRows.gemini("not rows");
  assert.ok(unknown(notRows.snapshot().limitations));
  // Batch envelope rows carry no reply content.
  const envelope = new GeminiSession();
  envelope.gemini([
    ["wrb.fr", null, JSON.stringify(answer)],
    ["di", 120],
    ["af.httprm", 119, "-1", 2],
    ["e", 4, null, null, 500],
  ]);
  assert.ok(!unknown(envelope.snapshot().limitations));
  // A tool field not seen before may hold generated content: partial. Flags do not.
  for (const [tools, partial] of [
    [[{ "99": ["new content"] }], true],
    [[null, ["positional content"]], true],
    [[{ "8": [], "70": 2, "71": true }], false],
  ] as const) {
    const session = live(
      inner({ candidates: [candidate({ 1: ["a"], 12: tools })] }),
    );
    assert.equal(
      unknown(session.snapshot().limitations),
      partial,
      JSON.stringify(tools),
    );
  }
  // Conflicting turn ids in one stream: partial.
  const conflicting = new GeminiSession();
  conflicting.gemini(rows(answer, [null, [CHAT, "r_00000000000000ff"]]));
  assert.ok(unknown(conflicting.snapshot().limitations));
});

test("a live Gemini reply without readable chat and turn ids is partial, since its saved copy could not be linked", () => {
  const withIds = (ids: unknown, fields: Parameters<typeof inner>[0]) => {
    const frame = inner(fields);
    frame[1] = ids;
    return frame;
  };
  const reply = { candidates: [candidate({ 1: ["a"] })] };
  for (const ids of [
    null,
    [null, null],
    [CHAT, null],
    [null, TURN],
    ["c_bad", TURN],
    [CHAT, "r_bad"],
    "not ids",
  ]) {
    const session = live(withIds(ids, reply));
    assert.equal(session.snapshot().text, "a", JSON.stringify(ids));
    assert.ok(unknown(session.snapshot().limitations), JSON.stringify(ids));
    // The reply still ends normally; it is partial, not failed.
    session.responseEnded();
    assert.equal(session.snapshot().state, "completed");
  }
  // A video job reply without ids is partial as well.
  const job = live(
    withIds(null, { job: ["Generating your video", ["video_generation"]] }),
  );
  assert.ok(unknown(job.snapshot().limitations));
  // Ids named by an earlier frame of the stream are enough.
  const earlier = new GeminiSession();
  earlier.gemini(
    rows([null, [CHAT, TURN], { "18": TURN }], withIds(null, reply)),
  );
  assert.equal(earlier.snapshot().conversationId, CHAT);
  assert.ok(!unknown(earlier.snapshot().limitations));
  // A chat id that changes within one reply is partial.
  const changed = new GeminiSession();
  changed.gemini(rows(inner(reply), [null, ["c_00000000000000ff", TURN]]));
  assert.ok(unknown(changed.snapshot().limitations));
});

test("a live frame past the frame bound keeps the reply as last read and makes it partial", () => {
  const session = live(
    inner({ candidates: [candidate({ 1: ["kept"], 37: [["short"]] })] }),
  );
  session.gemini(
    rows(
      inner({
        candidates: [candidate({ 1: ["x".repeat(LIMITS.frame + 1)] })],
      }),
    ),
  );
  const snapshot = session.snapshot();
  assert.equal(snapshot.text, "kept");
  assert.equal(snapshot.thinking, "short");
  assert.ok(unknown(snapshot.limitations));
});

test("saved Gemini turns: several candidates count the selected one and are partial; unreadable content leaves the reply partial, not the page unsupported", () => {
  const page = history(
    savedTurn(2, candidate({ 1: ["second"] }, "rc_00000000000000c2"), {
      prior: [CHAT, "r_00000000000000b1", REPLY],
      others: [candidate({ 1: ["draft"] }, "rc_00000000000000d2")],
    }),
    savedTurn(1, candidate({ 1: [7] })),
  );
  assert.notEqual(page.status, "unsupported");
  const [prompt1, reply1, prompt2, reply2] = page.messages;
  assert.equal(prompt1!.text, "prompt 1");
  assert.equal(reply1!.text, null);
  assert.equal(reply1!.complete, false);
  assert.ok(unknown(reply1!.coverageReasons));
  assert.equal(reply1!.toolOutput, undefined);
  assert.equal(prompt2!.parentSourceId, REPLY);
  assert.equal(reply2!.text, "second");
  assert.equal(reply2!.complete, true);
  assert.ok(unknown(reply2!.coverageReasons));
  assert.ok(!JSON.stringify(page).includes("draft"));
  // The turn's label names the model for both its prompt and its reply (M3).
  assert.equal(prompt2!.modelId, "3.6 Thinking");
  assert.equal(reply2!.modelId, "3.6 Thinking");
  // Ids stay required: a turn without its own id makes the page unsupported.
  const broken = savedTurn(1, candidate({ 1: ["a"] }));
  (broken[0] as unknown[])[1] = "not-a-turn";
  assert.equal(history(broken).status, "unsupported");
});

test("saved Gemini prompts read the canonical text, or the first string of a tool turn's record", () => {
  const canonical = history(
    savedTurn(1, candidate({ 1: ["a"] }), { prompt: ["Hello ", "there"] }),
  );
  assert.equal(canonical.messages[0]!.text, "Hello there");
  // A video turn's prompt record holds more fields after its text (3 Oct).
  const tool = history(
    savedTurn(1, candidate({ 1: ["a"] }), {
      prompt: ["Make a video of a red ball.", 1, null, [[null, 4]], "en"],
    }),
  );
  assert.equal(tool.messages[0]!.text, "Make a video of a red ball.");
  assert.equal(tool.messages[0]!.complete, true);
  const unreadable = history(
    savedTurn(1, candidate({ 1: ["a"] }), { prompt: [[1], "text"] }),
  );
  assert.equal(unreadable.messages[0]!.text, null);
  assert.equal(unreadable.messages[0]!.complete, false);
});

test("a saved Gemini reply too long for one count drops tool input before thinking and is partial", () => {
  // 200,000 units against the limits of 13 October, scaled to today's.
  const part = "y".repeat((200_000 * HISTORY_LIMITS.messageUnits) / 262144);
  const saved = savedReply({
    1: [part],
    37: [[part]],
    12: canvasTools,
    30: [canvasDocument("Long page", part)],
  });
  assert.equal(saved.text, part);
  assert.equal(saved.thinking, part);
  assert.equal(saved.toolInput, undefined);
  assert.ok(saved.coverageReasons?.includes("capture_limit_exceeded"));
  assert.ok(
    saved.text!.length + saved.thinking!.length <= HISTORY_LIMITS.textUnits,
  );
});

test("a Gemini follow-up names the previous reply as its parent; without it the previous turn stays", () => {
  const url = new URL(
    "https://gemini.google.com/u/1/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate",
  );
  const send = (previous: unknown) =>
    parseDispatch(
      "gemini",
      url,
      new URLSearchParams({
        "f.req": JSON.stringify([
          null,
          JSON.stringify([["Next question"], null, previous]),
        ]),
      }).toString(),
    );
  const followUp = send([CHAT, TURN, REPLY]);
  assert.equal(followUp.input, "Next question");
  assert.equal(followUp.conversationId, CHAT);
  assert.equal(followUp.parentId, REPLY);
  assert.equal(send([CHAT, TURN, "not-a-reply"]).parentId, TURN);
  assert.equal(send([CHAT, TURN]).parentId, TURN);
  const first = send(null);
  assert.equal(first.conversationId, null);
  assert.equal(first.parentId, null);
});
