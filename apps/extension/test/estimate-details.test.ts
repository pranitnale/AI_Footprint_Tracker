import assert from "node:assert/strict";
import test from "node:test";
import type { ComponentResult } from "@footprint/contracts";
import { formatInteger } from "@footprint/ui/formatters";
import {
  EstimateDetails,
  attachmentNote,
  countSourceNote,
  coverageNotes,
  estimateDetailLines,
  needsModelLabels,
} from "../lib/estimate-details";
import type { PresentedEstimate } from "../lib/estimate-presentation";

const inputs = (changes: Partial<ComponentResult["inputs"]> = {}) => ({
  output_tokens: null,
  latency_seconds: null,
  latency_basis: null,
  environment_provider: null,
  electricity_mix_zone: null,
  units: null,
  width: null,
  height: null,
  duration_seconds: null,
  with_audio: null,
  audio_seconds: null,
  defaults_applied: [],
  ...changes,
});
function component(
  role: ComponentResult["role"],
  kind: ComponentResult["kind"],
  changes: Partial<ComponentResult> & {
    model?: string | null;
    record?: [string, string] | null;
    basis?: string | null;
  } = {},
): ComponentResult {
  const { model = null, record = null, basis = null, ...rest } = changes;
  return {
    component_id: `${kind}_0`,
    kind,
    role,
    method_id: "ecologits-llm-0-11",
    selection:
      record || basis
        ? {
            kind: record ? "direct_mapping" : "unavailable",
            observed_model_id: model,
            profile: record
              ? { provider: record[0], model_name: record[1], workload: "text" }
              : null,
            reason: null,
            basis,
          }
        : null,
    inputs: inputs(),
    raw: null,
    status: "estimated",
    metrics: {} as ComponentResult["metrics"],
    reasons: [],
    ...rest,
  } as ComponentResult;
}
const envelope = (
  components: ComponentResult[],
  reasons: string[] = [],
): PresentedEstimate =>
  ({ schema_version: "3.0.0", components, reasons }) as never;

test("Details collect each model, other-model text and media with how they were estimated", () => {
  const details = new EstimateDetails();
  const main = component("main", "text", {
    model: "claude-opus-5-5",
    record: ["anthropic", "claude-opus-5-5"],
    basis: "exact_record",
    inputs: inputs({ output_tokens: "100" }),
  });
  details.add(envelope([main], ["research_work_unobserved"]));
  details.add(
    envelope(
      [
        { ...main, inputs: inputs({ output_tokens: "50" }) },
        component("side_calls", "text", {
          model: "claude-haiku-4-5",
          record: ["anthropic", "claude-haiku-4-5"],
          basis: "exact_record",
          inputs: inputs({ output_tokens: "19" }),
        }),
        component("generated_image", "image", {
          inputs: inputs({ units: "2" }),
        }),
        component("generated_speech", "speech", {
          basis: "model_not_named",
          record: ["openai", "gpt-4o-mini-tts"],
          inputs: inputs({ audio_seconds: "3.2352941176470589" }),
          reasons: ["speech_length_estimated"],
        }),
        component("generated_video", "video", {
          model: null,
          basis: "model_not_named",
          record: ["google", "veo-3.1"],
          inputs: inputs({
            duration_seconds: "10",
            defaults_applied: ["model", "resolution"],
          }),
        }),
      ],
      ["research_work_unobserved", "research_work_unobserved"],
    ),
  );
  // Older results carry no components and add nothing.
  details.add({ schema_version: "1.0.0" } as never);
  const result = details.result();
  assert.equal(result.reasons.research_work_unobserved, 2);
  const mainLine = result.lines.find((line) => line.role === "main")!;
  assert.equal(mainLine.count, 2);
  assert.equal(mainLine.tokens, "150");
  const lines = estimateDetailLines(result, []);
  assert.equal(
    lines[0],
    `Claude Opus 5.5: ${formatInteger(2)} replies, estimated with its own EcoLogits record (anthropic/claude-opus-5-5).`,
  );
  assert.match(
    lines[1]!,
    /^Side calls by claude-haiku-4-5: ≈ 19 tokens, estimated with its own EcoLogits record/,
  );
  assert.match(
    lines[2]!,
    /^Generated images: 2\. Each is estimated at 2\.9 Wh before data-centre overhead, from a published average for image models \(Luccioni et al\. 2024\)/,
  );
  assert.match(
    lines[3]!,
    /^Generated speech: 3[.,]2 s, estimated as audio tokens of OpenAI's gpt-4o-mini-tts record/,
  );
  assert.match(lines[3]!, /17 characters per second/);
  assert.match(
    lines[4]!,
    /^Generated videos: 1, 10 s in total, estimated with the EcoLogits video method for google\/veo-3\.1 as a stand-in, because the site does not name the model\. Where the page did not show them, defaults were used for: resolution\.$/,
  );
  assert.equal(needsModelLabels(result), false);
});

test("a model the library does not know names its family benchmark and the labels seen", () => {
  const details = new EstimateDetails();
  details.add(
    envelope([
      component("main", "text", {
        model: "claude-unlisted",
        record: ["anthropic", "claude-opus-5-5"],
        basis: "model_not_in_library",
      }),
      component("main", "text", {
        model: "claude-unlisted",
        record: ["anthropic", "claude-opus-5-5"],
        basis: "model_not_in_library",
        status: "unavailable",
      }),
    ]),
  );
  const result = details.result();
  assert.equal(needsModelLabels(result), true);
  const [line] = estimateDetailLines(result, ["claude-nova-9"]);
  assert.match(
    line!,
    /^Claude model not yet listed: 2 replies, estimated as Claude Opus 5\.5, the family benchmark, because the model is not in the library yet \(anthropic\/claude-opus-5-5\)\. Model names seen on this site that the library does not know: claude-nova-9\. 1 of these could not be estimated and are not in the totals\.$/,
  );
});

test("an unknown version of a known family names the family's stand-in, why, and the labels seen", () => {
  // Owner decision of 13 October 2026: Haiku 5.5 uses the newest Haiku record, not Opus 5.5.
  const details = new EstimateDetails();
  details.add(
    envelope([
      component("main", "text", {
        model: "claude-haiku-unlisted",
        record: ["anthropic", "claude-haiku-4-5"],
        basis: "model_family_stand_in",
      }),
    ]),
  );
  const result = details.result();
  assert.equal(needsModelLabels(result), true);
  const [line] = estimateDetailLines(result, ["claude-haiku-5-5"]);
  assert.match(
    line!,
    /^Claude Haiku, version not yet listed: 1 reply, estimated as Claude Haiku 4\.5, the newest model of the same family in the library, because this version is not in the library yet \(anthropic\/claude-haiku-4-5\)\. Model names seen on this site that the library does not know: claude-haiku-5-5\.$/,
  );
});

test("an unknown variant names the same variant's stand-in or the kind's, why, and the labels seen", () => {
  // Owner decision of 14 October 2026: GPT-7 Pro, a Pro without a known family, uses GPT-5.5
  // Pro (GPT-6 Sol Pro is GPT-6 Sol with Pro reasoning since the correction of that day), and a
  // Claude mini uses Claude Haiku because the library has no small Claude variant.
  const details = new EstimateDetails();
  details.add(
    envelope([
      component("main", "text", {
        model: "chatgpt-gpt-pro-unlisted",
        record: ["openai", "gpt-5.5-pro"],
        basis: "model_variant_stand_in",
      }),
      component("main", "text", {
        model: "claude-small-unlisted",
        record: ["anthropic", "claude-haiku-4-5"],
        basis: "model_kind_stand_in",
      }),
    ]),
  );
  const result = details.result();
  assert.equal(needsModelLabels(result), true);
  const [pro, small] = estimateDetailLines(result, ["gpt-7-pro"]);
  assert.equal(
    pro,
    "GPT Pro, version not yet listed: 1 reply, estimated as GPT-5.5 Pro, the newest version of the same variant in the library, because this model is not in the library yet (openai/gpt-5.5-pro). Model names seen on this site that the library does not know: gpt-7-pro.",
  );
  assert.equal(
    small,
    "Claude mini, nano or lite model, not yet listed: 1 reply, estimated as Claude Haiku 4.5, the newest model of the same kind from the same provider in the library, because the library has no version of this variant yet (anthropic/claude-haiku-4-5). Model names seen on this site that the library does not know: gpt-7-pro.",
  );
});

test("a site that names no model shows the stand-in it was estimated with", () => {
  const details = new EstimateDetails();
  details.add(
    envelope([
      component("main", "text", {
        model: "notebooklm-default",
        record: ["google_genai", "gemini-3-flash-preview"],
        basis: "model_not_named",
      }),
    ]),
  );
  // NotebookLM's stand-in is not Google's family benchmark (gemini-3.8-flash).
  assert.deepEqual(estimateDetailLines(details.result(), []), [
    "NotebookLM model: 1 reply. NotebookLM chose the model and did not say which one; estimated as Gemini 3 Flash Preview (google_genai/gemini-3-flash-preview).",
  ]);
});

test("Details name each model and its stand-in in plain words (owner decisions of 14 October 2026)", () => {
  const details = new EstimateDetails();
  details.add(
    envelope([
      // Perplexity Best names no model: Perplexity chose it.
      component("main", "text", {
        model: "perplexity-best",
        record: ["openai", "gpt-6.1-sol"],
        basis: "model_not_named",
      }),
      // o3-pro is o3 with Pro reasoning; the library has no o3, so GPT-6 Astra stands in.
      component("main", "text", {
        model: "chatgpt-o3-pro",
        record: ["openai", "gpt-6-astra"],
        basis: "nearest_record",
      }),
      // A reasoning word is a setting: Claude Haiku 6 Thinking is an unlisted Claude Haiku.
      component("main", "text", {
        model: "claude-haiku-unlisted",
        record: ["anthropic", "claude-haiku-4-5"],
        basis: "model_family_stand_in",
      }),
      // Nano Banana Pro is Gemini 3 Pro Image, the library's own record.
      component("main", "text", {
        model: "gemini-nano-banana-pro",
        record: ["google_genai", "gemini-3-pro-image-preview"],
        basis: "exact_record",
      }),
    ]),
  );
  assert.deepEqual(
    estimateDetailLines(details.result(), ["claude-haiku-6-thinking"]),
    [
      "Perplexity Best: 1 reply. Perplexity chose the model and did not say which one; estimated as GPT-6.1 Sol (openai/gpt-6.1-sol).",
      "o3 (Pro reasoning): 1 reply, estimated as GPT-6 Astra, the nearest EcoLogits record, as a stand-in (openai/gpt-6-astra).",
      "Claude Haiku, version not yet listed: 1 reply, estimated as Claude Haiku 4.5, the newest model of the same family in the library, because this version is not in the library yet (anthropic/claude-haiku-4-5). Model names seen on this site that the library does not know: Claude Haiku 6 (Thinking).",
      "Nano Banana Pro (Gemini 3 Pro Image): 1 reply, estimated with its own EcoLogits record (google_genai/gemini-3-pro-image-preview).",
    ],
  );
});

test("Details stay bounded and say when further parts are not listed", () => {
  const details = new EstimateDetails();
  for (let index = 0; index < 40; index++)
    details.add(
      envelope([
        component("main", "text", {
          model: `chatgpt-model-${index}`,
          record: ["openai", "gpt-6.1-sol"],
          basis: "family_benchmark",
        }),
      ]),
    );
  const result = details.result();
  assert.equal(result.lines.length, 32);
  assert.equal(result.omitted, 8);
  const lines = estimateDetailLines(result, []);
  assert.equal(
    lines.at(-1),
    "8 further estimated parts are counted in the totals but not listed here.",
  );
});

test("Cowork notes: exact usage reports, grouped earlier turns and Cowork's own limits (W5)", () => {
  const cowork = coverageNotes("cowork");
  assert.ok(cowork.some((note) => /system prompts, memory/.test(note)));
  assert.ok(
    cowork.some((note) =>
      /counted together in the first reply this browser saved\. Their prompts and tool results are not counted/.test(
        note,
      ),
    ),
  );
  assert.ok(cowork.some((note) => /never opened in this browser/.test(note)));
  assert.ok(cowork.some((note) => /not model work/.test(note)));
  assert.match(cowork.at(-1)!, /Hardware manufacturing, training/);
  assert.doesNotMatch(
    cowork.join(" "),
    /summary the site shows|safety checks are not counted|more than 16/,
  );
  assert.ok(
    coverageNotes("cowork", { side_calls_unobserved: 1 }).some((note) =>
      /more than 16 other models/.test(note),
    ),
  );
  assert.ok(
    coverageNotes("claude", { side_calls_unobserved: 1 }).some((note) =>
      /more than 16 other models/.test(note),
    ),
  );
  assert.match(countSourceNote("cowork"), /Claude's own usage report/);
  assert.match(
    countSourceNote("claude"),
    /^Token counts use a local reference tokenizer/,
  );
});

test("coverage notes follow the decided rules for each site and reason", () => {
  const claude = coverageNotes("claude");
  assert.match(
    claude[0]!,
    /summary the site shows\. The provider bills the full reasoning/,
  );
  assert.ok(claude.some((note) => /system prompts, memory/.test(note)));
  assert.ok(claude.some((note) => /Side calls/.test(note)));
  assert.match(claude.at(-1)!, /Hardware manufacturing, training/);
  assert.doesNotMatch(
    claude.join(" "),
    /Perplexity|Audio and Video Overviews|GLM/,
  );
  // Live QA of 19 Oct 2026: an attached image added no input and Details did not say why.
  // The note is shown under What was counted (attachmentNote), not in these notes.
  assert.match(attachmentNote("claude")!, /Images you attach .* not counted as input/);
  assert.equal(attachmentNote("cowork"), null);
  assert.doesNotMatch(claude.join(" "), /you attach/);
  // Exact provider reports (Cowork) count side calls; the note must not deny it.
  const reported = coverageNotes("claude", {}, ["main", "side_calls"]).join(
    " ",
  );
  assert.match(reported, /counted where the provider reports them/);
  assert.doesNotMatch(reported, /safety checks are not counted/);
  const perplexity = coverageNotes("perplexity", {
    environment_override: 1,
    file_size_estimated: 1,
  });
  // Shown thought steps are counted (W7); Perplexity rarely shows any.
  assert.equal(
    perplexity[0],
    "Reasoning: only reasoning the site shows is counted, and Perplexity usually shows none.",
  );
  assert.ok(perplexity.some((note) => /internal search pipeline/.test(note)));
  assert.ok(
    perplexity.some((note) => /video prompts its model wrote/.test(note)),
  );
  assert.ok(
    perplexity.some((note) =>
      /GLM models reached through Perplexity.*PUE 1\.09 to 1\.14.*WUE 0\.13 to 0\.99/.test(note),
    ),
  );
  assert.ok(perplexity.some((note) => /bytes divided by 4/.test(note)));
  // Owner decision of 14 Oct 2026: Computer files count from their content.
  assert.ok(
    perplexity.some((note) =>
      /Text and code files Perplexity Computer creates count from their content/.test(note),
    ),
  );
  const notebook = coverageNotes("notebooklm", { research_work_unobserved: 1 });
  assert.equal(
    notebook[0],
    "Reasoning: only reasoning the site shows is counted, and NotebookLM usually shows none.",
  );
  // W9: chats count when sent here and, since 14 Oct 2026, when the saved chat loads;
  // guides and suggestions are output, Studio items are requests.
  assert.ok(
    notebook.includes(
      "Chats count when they are sent in this browser and when the notebook loads its saved chat, each question and answer once. The notebook loads its newest messages first and older ones when you scroll up the chat. Suggested questions and the notebook guide written when a source is added count as output, not as requests.",
    ),
  );
  assert.ok(
    notebook.includes(
      "Each Studio item counts as a request when the notebook first lists it. Its instructions are not shown, so they are not counted. Studio content counts when the notebook loads it; flashcards, quizzes and mind maps count when opened. Titles are not counted.",
    ),
  );
  for (const site of ["chatgpt", "claude", "gemini", "perplexity"])
    assert.doesNotMatch(coverageNotes(site).join(" "), /Studio item/, site);
  assert.ok(
    notebook.some((note) =>
      /Audio and Video Overviews are not shown/.test(note),
    ),
  );
  assert.ok(
    notebook.some((note) => /research agents' own reasoning/.test(note)),
  );
});

test("W8.7 Gemini Details say when late results count and that the research log is not counted", () => {
  const gemini = coverageNotes("gemini", { research_work_unobserved: 1 });
  assert.match(
    gemini[0]!,
    /summary the site shows\. The provider bills the full reasoning/,
  );
  assert.ok(
    gemini.includes(
      "Gemini videos and Deep Research reports finish after the reply and count when the page loads them, for example when the chat is opened again. The research log shown during a run mixes the agents' notes with quoted sources and is not counted.",
    ),
  );
  assert.ok(gemini.some((note) => /research agents' own reasoning/.test(note)));
  assert.match(gemini.at(-1)!, /Hardware manufacturing, training/);
  for (const site of ["chatgpt", "claude", "perplexity", "notebooklm"])
    assert.doesNotMatch(coverageNotes(site).join(" "), /Gemini videos/, site);
});

test("P1-files Perplexity Details never claim files count by size unless an estimate says so", () => {
  // Since 14 Oct 2026 (owner decision) Computer files count from their content; only an
  // estimate that carries file_size_estimated describes the size rule. Attachments travel
  // as links without text or size, so they are not counted as input.
  const perplexity = coverageNotes("perplexity", {}, ["main"]);
  assert.doesNotMatch(perplexity.join(" "), /divided by 4|size in bytes/);
  assert.ok(
    perplexity.includes(
      "Text and code files Perplexity Computer creates count from their content, as output of the model that ran the request. Other files, such as images and PDFs, are not counted.",
    ),
  );
  assert.doesNotMatch(perplexity.join(" "), /so they are not counted/);
  assert.equal(
    attachmentNote("perplexity"),
    "Files and images you attach are sent as links, so their content is not counted as input.",
  );
  assert.match(perplexity.at(-1)!, /Hardware manufacturing, training/);
  for (const site of ["chatgpt", "claude", "gemini", "notebooklm", "cowork"]) {
    assert.doesNotMatch(
      coverageNotes(site).join(" "),
      /Perplexity Computer|you attach are sent as links/,
      site,
    );
    assert.doesNotMatch(attachmentNote(site) ?? "", /sent as links/, site);
  }
});

test("W6.9 ChatGPT Details explain thinking summaries, research and its speech rules", () => {
  const chatgpt = coverageNotes("chatgpt", { research_work_unobserved: 1 }, [
    "main",
    "research",
    "generated_speech",
  ]);
  // Thinking is counted from the summaries the page shows (A2).
  assert.match(
    chatgpt[0]!,
    /summary the site shows\. The provider bills the full reasoning/,
  );
  assert.ok(
    chatgpt.some((note) =>
      /research agents' own reasoning and drafts/.test(note),
    ),
  );
  const speech = chatgpt.find((note) => /^Voice replies/.test(note));
  assert.equal(
    speech,
    "Voice replies count as their transcript and as speech from it at 17 characters per second. Read aloud counts as speech timed by the audio the page received, or from the reply's text at 17 characters per second, and is not counted as a request.",
  );
  assert.match(chatgpt.at(-1)!, /Hardware manufacturing, training/);
  // Without speech, or on another site, the speech note is not shown.
  assert.doesNotMatch(
    coverageNotes("chatgpt", {}, ["main"]).join(" "),
    /Read aloud/,
  );
  assert.doesNotMatch(
    coverageNotes("notebooklm", {}, [
      "overview_narration",
      "generated_speech",
    ]).join(" "),
    /Read aloud/,
  );
});
