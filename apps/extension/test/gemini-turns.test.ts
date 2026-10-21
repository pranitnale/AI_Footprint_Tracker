import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Ledger } from "@footprint/ledger";
import type { HistoryMessage } from "@footprint/contracts";
import { initialSnapshot } from "@footprint/adapters";
import { timingEvidence } from "@footprint/capture-core";
import { Coordinator } from "../lib/coordinator";
import { createHistoryTextObserver } from "../lib/passive-history-text";
import { countByTextLength } from "./counting-fixture";

// W8 end to end: a Gemini chat of a secondary account (/u/3/) with a video turn, a Deep
// Research run, a Canvas page and generated images. Shapes as seen on 1 and 3 Oct 2026;
// ids and text are synthetic.
const hex = "00000000000000a7";
const chat = `c_${hex}`;
const origin = "https://gemini.google.com";
const path = `/u/3/app/${hex}`;
const turnId = (n: number) => `r_00000000000000b${n}`;
const replyId = (n: number) => `rc_00000000000000c${n}`;

function candidate(n: number, fields: Record<number, unknown>) {
  const value: unknown[] = Array(38).fill(null);
  value[0] = replyId(n);
  for (const [index, field] of Object.entries(fields))
    value[Number(index)] = field;
  return value;
}
function turn(
  n: number,
  reply: unknown[],
  label: string,
  time: [number, number],
  prompt: unknown[] = [`prompt ${n}`],
) {
  const response: unknown[] = Array(26).fill(null);
  response[0] = [reply];
  response[3] = reply[0];
  response[21] = label;
  const record: unknown[] = Array(11).fill(null);
  record[0] = prompt;
  return [
    [chat, turnId(n)],
    n > 1 ? [chat, turnId(n - 1), replyId(n - 1)] : null,
    record,
    response,
    time,
  ];
}
/** The history RPC's wire form: XSSI prefix, then length-prefixed JSON lines. */
function wire(turns: unknown[]) {
  const payload = JSON.stringify([turns, null, null, []]);
  const line = JSON.stringify([
    ["wrb.fr", "hNvQHb", payload, null, null, null, "generic"],
  ]);
  return `)]}'\n\n${line.length + 2}\n${line}\n`;
}

/** A failed job keeps its generation record and storyboard but no media (G6, 5 Oct). */
function videoJob(failed = false) {
  const media: unknown[] = Array(25).fill(null);
  media[2] = "video.mp4";
  media[11] = "video/mp4";
  media[17] = [[9, 999999000], 1280, 720];
  media[24] = 1812069;
  const generation: unknown[] = Array(29).fill(null);
  generation[0] = "Make a video of a red ball.";
  generation[2] = [null, null, "models/omni_1p2_pro_gemini_app", 1, 14, 1];
  generation[7] = ["A red ball bounces on a white floor.", null, "A ball.", ""];
  return [failed ? null : [media], generation];
}
function researchDocument(report: string) {
  const value: unknown[] = Array(18).fill(null);
  value[0] = "im_34b2f39e8e72ad53";
  value[2] = "Wind Report";
  value[4] = report;
  value[5] = [{ "44": [[[" [cite: 1]"], []]] }];
  value[8] = [[[null, 1]]];
  value[17] = [[null, 1]];
  return value;
}
function imageEntry(width: number, height: number) {
  const record: unknown[] = Array(16).fill(null);
  record[11] = "image/png";
  record[15] = [width, height, 1000];
  return [[null, null, null, record]];
}

const pages = {
  video: (failed = false) =>
    wire([
      turn(
        1,
        candidate(1, {
          1: [
            "Your video is ready!\n\nhttp://googleusercontent.com/video_gen_chip/123",
          ],
          12: [{ "8": [], "60": [[videoJob(failed)]] }],
        }),
        "Gemini Omni 1.1 Flash",
        [1791056900, 0],
        ["Make a video of a red ball.", 1, null, [[null, 4]]],
      ),
    ]),
  tools: () =>
    wire(
      [
        turn(
          4,
          candidate(4, {
            1: ["http://googleusercontent.com/image_generation_content/0"],
            12: [
              {
                "8": [
                  [imageEntry(1024, 1024), imageEntry(1024, 1024)],
                  null,
                  [true],
                ],
              },
            ],
          }),
          "Nano Banana 2",
          [1791058100, 0],
        ),
        turn(
          3,
          candidate(3, {
            1: ["Here is your page."],
            30: [
              (() => {
                const doc: unknown[] = Array(17).fill(null);
                doc[0] = "c3f0a1b2c3d4e5f6";
                doc[2] = "Page";
                doc[4] = "<p>Hi</p>";
                doc[9] = "index.html";
                doc[14] = ["<p>Hi</p>", "html"];
                return doc;
              })(),
            ],
            12: [
              {
                "8": [],
                "57": [
                  [
                    ["Writing"],
                    "c3f0a1b2c3d4e5f6",
                    null,
                    "Page",
                    null,
                    [1791058001, 0],
                    null,
                    2,
                  ],
                ],
              },
            ],
          }),
          "3.6 Thinking",
          [1791058000, 0],
        ),
        turn(
          2,
          candidate(2, {
            1: ["I've completed your research."],
            37: [["Planning the run."]],
            12: [
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
                    "Wind",
                    "Wind Report",
                    null,
                    [1791057802, 500000000],
                    null,
                    3,
                  ],
                ],
                "58": [
                  "Wind",
                  [null, null, null, null, ["Researching websites..."]],
                ],
                "70": 3,
              },
            ],
            30: [researchDocument("Wind supplied much of the power.")],
          }),
          "3.6 Thinking",
          [1791057693, 472416000],
        ),
        turn(
          1,
          candidate(1, {
            1: ["Here's a research plan."],
            12: [
              {
                "8": [],
                "56": [
                  "Wind share",
                  [
                    [1, "Research Websites", "Find the share."],
                    [2, "Create Report"],
                  ],
                  "Ready in a few mins",
                ],
                "70": 2,
              },
            ],
          }),
          "3.6 Thinking",
          [1791057668, 650213000],
        ),
      ].reverse(),
    ),
};

async function setup(t: TestContext) {
  Object.assign(globalThis, {
    location: {
      origin,
      hostname: "gemini.google.com",
      pathname: path,
      href: origin + path,
    },
  });
  const db = await Ledger.open(`gemini-turns-${crypto.randomUUID()}`);
  const coordinator = new Coordinator(db, {
    count: countByTextLength,
    hasConsent: async () => true,
    hasSiteConsent: async () => true,
    sendDisplay: async () => {},
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
    tab: { id: 803 },
    frameId: 0,
    documentId: "synthetic-gemini-turns",
    url: origin + path,
  };
  const reopen = async (body: string) => {
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
        new URL(`${origin}/u/3/_/BardChatUi/data/batchexecute?rpcids=hNvQHb`),
        "POST",
        Promise.resolve(new Response(body)),
        Date.now(),
        new URLSearchParams({
          "f.req": JSON.stringify([
            [
              [
                "hNvQHb",
                JSON.stringify([chat, 10, null, 1, [1], [4], null, 1]),
                null,
                "generic",
              ],
            ],
          ]),
        }).toString(),
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
  return { coordinator, db, sender, reopen, records };
}

const capture = (
  id: string,
  revision: number,
  event: "dispatch" | "end",
  snapshot: ReturnType<typeof initialSnapshot>,
  timing: unknown = null,
): any => ({
  channel: "ai-footprint-observation-v1",
  version: 1,
  id,
  revision,
  event,
  site: "gemini",
  at: new Date().toISOString(),
  dispatch:
    event === "dispatch"
      ? {
          site: "gemini",
          action: "send",
          input: "Make a video of a red ball.",
          conversationId: chat,
          parentId: null,
          requestId: null,
          model: null,
          attachments: null,
          imageEditParentId: null,
        }
      : null,
  snapshot,
  failure: null,
  timing,
});

test("W8 a live Gemini video turn completes without reply text or a problem; its saved turn adds the video and storyboard once", async (t) => {
  const f = await setup(t);
  const id = crypto.randomUUID();
  await f.coordinator.capture(
    capture(id, 1, "dispatch", initialSnapshot()),
    f.sender,
  );
  // The job reply shows no candidate: no reply text and no reply id (G3).
  await f.coordinator.capture(
    capture(
      id,
      2,
      "end",
      {
        ...initialSnapshot(),
        state: "completed",
        started: true,
        conversationId: chat,
        providerRequestId: turnId(1),
        model: "Gemini Omni 1.1 Flash",
      },
      timingEvidence(3.2, "browser_request"),
    ),
    f.sender,
  );
  const attempts = (await f.db.all<any>("attempts")).map((row) => row.record);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].state, "completed");
  assert.equal(attempts[0].provider_attempt_key, null);
  for (const reason of ["partial_capture", "unknown_terminal_state"])
    assert.ok(!attempts[0].coverage_reasons.includes(reason), reason);
  await f.reopen(pages.video());
  const saved = await f.records();
  assert.equal(saved.length, 2);
  const reply = saved.find((m) => m.role === "response");

  // Labels resolve through the registry; every Gemini video uses the Omni stand-in.
  assert.equal(reply!.model_id, "gemini-omni");
  assert.deepEqual(
    reply!.generation.media.map((item: any) => [
      item.kind,
      item.model_id,
      item.width,
      item.height,
    ]),
    [["video", "gemini-omni-video", 1280, 720]],
  );
  assert.deepEqual(
    reply!.generation.text_components.map((item) => [item.role, item.model_id]),
    [["storyboard", null]],
  );
  // The live reply had no text, so the saved reply's answer, storyboard and video count.
  assert.equal(
    reply!.parts!.answer_output.value,
    String("Your video is ready!".length),
  );
  assert.equal(reply!.text_complete, true);
  const view: any = await f.coordinator.routeSummary("gemini", chat);
  // The saved prompt is the live request's, by its turn id: one request, not two.
  assert.equal(view.summary.requests, 1);
  assert.equal(view.history.local.prompt_count, "0");
  assert.equal(view.history.local.matched_live_message_count, "1");
  assert.equal(view.history.local.response_count, "1");
  // The live reply's output is unknown, not zero; the saved reply carries the energy.
  assert.equal(view.summary.tokens.output.value, null);
  assert.equal(view.summary.metrics.energy.value, null);
  const energy = view.history.local.resources.find(
    (row: any) => row.quantity === "energy",
  );
  assert.ok(energy && Number(energy.value) > 0);
});

for (const failed of [false, true])
  test(`a live Gemini video reply that names its reply links to its saved copy, whose label names the video model${failed ? ", also when the job failed" : ""} (5 Oct 2026)`, async (t) => {
    const f = await setup(t);
    const id = crypto.randomUUID();
    await f.coordinator.capture(
      capture(id, 1, "dispatch", initialSnapshot()),
      f.sender,
    );
    // Since 5 Oct the live job reply names its candidate and carries a thought summary,
    // under the label of the chat's mode; the saved turn names the video model.
    await f.coordinator.capture(
      capture(
        id,
        2,
        "end",
        {
          ...initialSnapshot(),
          state: "completed",
          started: true,
          conversationId: chat,
          providerRequestId: turnId(1),
          outputId: replyId(1),
          model: "3.6 Thinking",
          text: "",
          thinking: "Planning the video.",
        },
        timingEvidence(3.2, "browser_request"),
      ),
      f.sender,
    );
    const attempts = (await f.db.all<any>("attempts")).map((row) => row.record);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].model_evidence, "response_field");
    assert.notEqual(attempts[0].model_id, "gemini-omni");
    assert.ok(attempts[0].provider_attempt_key);
    await f.reopen(pages.video(failed));
    const reply = (await f.records()).find((m) => m.role === "response")!;
    assert.equal(reply.model_id, "gemini-omni");
    assert.equal(reply.generation.media.length, failed ? 0 : 1);
    assert.equal(reply.provider_attempt_key, attempts[0].provider_attempt_key);
    const view: any = await f.coordinator.routeSummary("gemini", chat);
    // Both saved messages belong to the live request and reply, so nothing counts twice.
    assert.equal(view.summary.requests, 1);
    assert.equal(view.history.local.matched_live_message_count, "2");
    assert.equal(view.history.local.prompt_count, "0");
    assert.equal(view.history.local.response_count, "0");
    assert.equal(view.history.local.unresolved_overlap_message_count, "0");
    // The linked reply carries the saved video's energy in the live figures.
    assert.ok(Number(view.summary.metrics.energy.value) > 0);
  });

test("W8 a saved Gemini chat counts the research plan, the report with its run time, a Canvas page and images", async (t) => {
  const f = await setup(t);
  await f.reopen(pages.tools());
  const records = await f.records();
  assert.equal(records.length, 8);
  const replies = records.filter((m) => m.role === "response");
  const byAnswer = (text: string) => {
    const found = replies.filter(
      (m) => m.parts?.answer_output.value === String(text.length),
    );
    assert.equal(found.length, 1, text);
    return found[0]!;
  };
  // The plan's title and step texts count as intermediate output (D2).
  const plan = byAnswer("Here's a research plan.");
  assert.equal(
    plan.parts!.intermediate_output.value,
    String(
      "Wind share\nResearch Websites\nFind the share.\nCreate Report".length,
    ),
  );
  assert.ok(!plan.coverage_reasons.includes("research_work_unobserved"));
  const research = byAnswer("I've completed your research.");
  const component = research.generation.text_components[0]!;
  assert.equal(component.role, "research");
  assert.equal(component.model_id, "gemini-3-6-thinking");
  assert.equal(component.timing?.scope, "research_task");
  assert.equal(component.timing?.source, "gemini_history");
  assert.equal(component.timing?.duration_seconds, "109.027584");
  assert.ok(research.coverage_reasons.includes("research_work_unobserved"));
  assert.equal(
    research.parts!.visible_thinking.value,
    String("Planning the run.".length),
  );
  const canvas = byAnswer("Here is your page.");
  assert.equal(
    canvas.parts!.tool_input.value,
    String("Page\n<p>Hi</p>".length),
  );
  assert.equal(canvas.generation.text_components.length, 0);
  // The placeholder link is not answer text.
  const images = byAnswer("");
  assert.deepEqual(images.generation.media, [
    {
      kind: "image",
      model_id: "gemini-nano-banana-2",
      count: "2",
      width: 1024,
      height: 1024,
      outcome: "returned",
    },
  ]);
  assert.equal(images.text_complete, true);
  // Counts only: no saved text leaves the parser.
  const stored = JSON.stringify(await f.db.all("history_records"));
  for (const words of [
    "Wind supplied",
    "Planning the run",
    "<p>Hi</p>",
    "red ball",
  ])
    assert.equal(stored.includes(words), false, words);
});

test("W8 a live Deep Research start counts its report once the saved chat shows it, through the same reply", async (t) => {
  const f = await setup(t);
  const id = crypto.randomUUID();
  await f.coordinator.capture(
    capture(id, 1, "dispatch", initialSnapshot()),
    f.sender,
  );
  // The start turn's own stream: a short answer, no report yet (G4).
  await f.coordinator.capture(
    capture(
      id,
      2,
      "end",
      {
        ...initialSnapshot(),
        state: "completed",
        started: true,
        text: "I've completed your research.",
        thinking: "Planning the run.",
        toolInput: "",
        intermediate: "",
        toolOutput: "",
        conversationId: chat,
        providerRequestId: turnId(2),
        outputId: replyId(2),
        model: "3.6 Thinking",
        limitations: [
          ...initialSnapshot().limitations,
          "research_work_unobserved",
        ],
      },
      timingEvidence(5, "browser_request"),
    ),
    f.sender,
  );
  await f.coordinator.engines.maintainLocal();
  const before: any = await f.coordinator.routeSummary("gemini", chat);
  const energy = (view: any) => Number(view.summary.metrics.energy.value);
  assert.ok(energy(before) > 0);
  await f.reopen(pages.tools());
  const after: any = await f.coordinator.routeSummary("gemini", chat);
  // The saved start turn is the live reply (same reply id): it is matched, not added.
  assert.equal(after.summary.requests, 1);
  assert.equal(after.history.local.matched_live_message_count, "2");
  assert.equal(after.history.local.prompt_count, "3");
  // The live reply now carries the report and the run's time from its saved copy.
  assert.ok(
    energy(after) > energy(before),
    `${energy(after)} > ${energy(before)}`,
  );
});
