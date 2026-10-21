import type { ComponentResult, SelectionBasis } from "@footprint/contracts";
import { formatDecimal, formatInteger } from "@footprint/ui/formatters";
import { sumFixed } from "@footprint/ui/totals";
import {
  isEstimationEnvelope,
  type PresentedEstimate,
} from "./estimate-presentation";
import { labelName, modelName, recordName } from "./ui/model-names";
import media from "../../../config/estimation.media.json";

/**
 * One kind of estimated work in a conversation: the replies of one model, text written by
 * another model, or one kind of generated media, with how it was estimated.
 */
export type EstimateLine = {
  role: ComponentResult["role"];
  kind: ComponentResult["kind"];
  model: string | null;
  record: string | null;
  basis: SelectionBasis | null;
  count: number;
  unavailable: number;
  tokens: string | null;
  units: string | null;
  seconds: string | null;
  defaults: string[];
  /** The speech length came from the text at the reading rate (D4). */
  lengthFromText: boolean;
};
export type EstimateDetailSummary = {
  lines: EstimateLine[];
  /** How many estimates carried each reason, for the coverage notes. */
  reasons: Record<string, number>;
  /** Lines beyond the bound, so Details can say that more exist. */
  omitted: number;
};
const LINE_LIMIT = 32;

/** Collects the components of each counted estimate; older results carry none. */
export class EstimateDetails {
  private lines = new Map<string, EstimateLine>();
  private reasons = new Map<string, number>();
  private omitted = 0;
  add(estimate: PresentedEstimate) {
    if (!isEstimationEnvelope(estimate)) return;
    for (const reason of new Set(estimate.reasons))
      this.reasons.set(reason, (this.reasons.get(reason) ?? 0) + 1);
    for (const component of estimate.components) {
      const profile = component.selection?.profile ?? null;
      const record = profile
        ? `${profile.provider}/${profile.model_name}`
        : null;
      const model = component.selection?.observed_model_id ?? null;
      const basis = component.selection?.basis ?? null;
      const key = JSON.stringify([
        component.role,
        component.kind,
        model,
        record,
        basis,
      ]);
      let line = this.lines.get(key);
      if (!line) {
        if (this.lines.size >= LINE_LIMIT) {
          this.omitted++;
          continue;
        }
        line = {
          role: component.role,
          kind: component.kind,
          model,
          record,
          basis,
          count: 0,
          unavailable: 0,
          tokens: null,
          units: null,
          seconds: null,
          defaults: [],
          lengthFromText: false,
        };
        this.lines.set(key, line);
      }
      line.count++;
      if (component.status === "unavailable") line.unavailable++;
      const inputs = component.inputs;
      if (component.kind === "text" && inputs.output_tokens !== null)
        line.tokens = (
          BigInt(line.tokens ?? "0") + BigInt(inputs.output_tokens)
        ).toString();
      if (inputs.units !== null)
        line.units = (
          BigInt(line.units ?? "0") + BigInt(inputs.units)
        ).toString();
      const seconds =
        component.kind === "speech"
          ? inputs.audio_seconds
          : inputs.duration_seconds;
      if (seconds !== null)
        line.seconds = sumFixed([line.seconds ?? "0", seconds]);
      for (const name of inputs.defaults_applied)
        if (!line.defaults.includes(name)) line.defaults.push(name);
      if (component.reasons.includes("speech_length_estimated"))
        line.lengthFromText = true;
    }
  }
  result(): EstimateDetailSummary {
    return {
      lines: [...this.lines.values()],
      reasons: Object.fromEntries(this.reasons),
      omitted: this.omitted,
    };
  }
}

const BASIS_TEXT: Record<SelectionBasis, string> = {
  exact_record: "its own EcoLogits record",
  nearest_record: "the nearest EcoLogits record as a stand-in",
  family_benchmark: "the family benchmark",
  // Not always the family benchmark: NotebookLM's stand-in is a named Gemini record.
  model_not_named: "a stand-in, because the site does not name the model",
  model_not_in_library:
    "the family benchmark, because the model is not in the library yet",
  // Owner decision of 13 October 2026: the family's newest record, not the provider flagship.
  model_family_stand_in:
    "the newest model of the same family in the library as a stand-in, because this version is not in the library yet",
  // Owner decision of 14 October 2026: an unknown variant (GPT Pro, Gemini Pro Image) uses the
  // same variant's newest record, or the newest model of its kind when the library has none.
  model_variant_stand_in:
    "the newest version of the same variant in the library as a stand-in, because this model is not in the library yet",
  model_kind_stand_in:
    "the newest model of the same kind from the same provider in the library as a stand-in, because the library has no version of this variant yet",
};

// Why a reply's stand-in record was used, after "estimated as <record name>". Owner decision of
// 14 October 2026: Details names the model and its stand-in in plain words ("o3 (Pro
// reasoning): 1 reply, estimated as GPT-6 Astra, ...").
const STAND_IN_TEXT: Partial<Record<SelectionBasis, string>> = {
  nearest_record: "the nearest EcoLogits record, as a stand-in",
  family_benchmark: "the family benchmark",
  model_not_in_library:
    "the family benchmark, because the model is not in the library yet",
  model_family_stand_in:
    "the newest model of the same family in the library, because this version is not in the library yet",
  model_variant_stand_in:
    "the newest version of the same variant in the library, because this model is not in the library yet",
  model_kind_stand_in:
    "the newest model of the same kind from the same provider in the library, because the library has no version of this variant yet",
};
const SITE_NAMES: Readonly<Record<string, string>> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  perplexity: "Perplexity",
  notebooklm: "NotebookLM",
};

/** The main replies of one model: its name, then the record and why it stands in. */
function replyLine(line: EstimateLine, replies: string, via: string): string {
  const name = line.model ? modelName(line.model) : "Model not named";
  const record = line.record ? recordName(line.record) : null;
  // Owner decision of 14 October 2026: an automatic route such as Perplexity Best says plainly
  // that the site chose the model and did not name it.
  if (line.basis === "model_not_named" && record) {
    const site = SITE_NAMES[line.model?.split("-")[0] ?? ""] ?? "The site";
    return `${name}: ${replies}. ${site} chose the model and did not say which one; estimated as ${record} (${line.record}).`;
  }
  const why = line.basis ? STAND_IN_TEXT[line.basis] : undefined;
  return why && record
    ? `${name}: ${replies}, estimated as ${record}, ${why} (${line.record}).`
    : `${name}: ${replies}, estimated with ${via}.`;
}

// A missing video model is said by the stand-in wording, not in this list.
const DEFAULT_TEXT: Record<string, string> = {
  resolution: "resolution",
  duration: "length",
  audio: "audio",
  length: "length",
};
const VIDEO_BASIS_TEXT: Partial<Record<SelectionBasis, string>> = {
  nearest_record: " as a stand-in",
  family_benchmark: " as a stand-in",
  model_not_named: " as a stand-in, because the site does not name the model",
  model_not_in_library:
    " as a stand-in, because the model is not in the library yet",
  model_family_stand_in:
    " as a stand-in of the same family, because this version is not in the library yet",
};

/** Bases of models the library does not know, whose raw labels Details names. */
const UNKNOWN_MODEL_BASES: ReadonlySet<SelectionBasis | null> = new Set<
  SelectionBasis | null
>([
  "model_not_in_library",
  "model_family_stand_in",
  "model_variant_stand_in",
  "model_kind_stand_in",
]);

/** Whether Details should name the raw labels of models the library does not know. */
export function needsModelLabels(
  details: EstimateDetailSummary | null | undefined,
) {
  return !!details?.lines.some((line) => UNKNOWN_MODEL_BASES.has(line.basis));
}

/**
 * Details lines saying how each part of the conversation was estimated: the model and the
 * record behind it, text from other models, and generated media with its method and source.
 * Labels are the raw names of models not in the library, kept only in this browser.
 */
export function estimateDetailLines(
  details: EstimateDetailSummary | null | undefined,
  labels: readonly string[],
): string[] {
  if (!details) return [];
  const format = formatInteger;
  const count = (n: number, one: string, many: string) =>
    `${format(n)} ${n === 1 ? one : many}`;
  const lines = details.lines.map((line) => {
    const via = line.basis
      ? `${BASIS_TEXT[line.basis]}${line.record ? ` (${line.record})` : ""}`
      : line.record
        ? `the ${line.record} record`
        : "";
    const tokens = line.tokens ? `≈ ${format(line.tokens)} tokens` : "";
    const seconds = line.seconds ? `${formatDecimal(line.seconds, 1)} s` : "";
    const defaults = line.defaults.flatMap((name) =>
      DEFAULT_TEXT[name] ? [DEFAULT_TEXT[name]] : [],
    );
    const assumed = defaults.length
      ? ` Where the page did not show them, defaults were used for: ${defaults.join(", ")}.`
      : "";
    let text: string;
    switch (line.role) {
      case "main":
        text = replyLine(line, count(line.count, "reply", "replies"), via);
        if (UNKNOWN_MODEL_BASES.has(line.basis) && labels.length)
          text += ` Model names seen on this site that the library does not know: ${labels.map(labelName).join(", ")}.`;
        break;
      case "side_calls":
      case "research":
      case "storyboard": {
        const label =
          line.role === "side_calls"
            ? "Side calls"
            : line.role === "research"
              ? "Research plan and report"
              : "Video storyboard";
        text = `${label}${line.model ? ` by ${line.model}` : ""}: ${tokens || count(line.count, "part", "parts")}, estimated with ${via}.`;
        break;
      }
      case "generated_image":
        text = `Generated images: ${format(line.units ?? line.count)}. Each is estimated at 2.9 Wh before data-centre overhead, from a published average for image models (Luccioni et al. 2024). The provider's own image model can differ.`;
        break;
      case "generated_video":
        text = `Generated videos: ${format(line.units ?? line.count)}${seconds ? `, ${seconds} in total` : ""}, estimated with the EcoLogits video method${line.record ? ` for ${line.record}${(line.basis && VIDEO_BASIS_TEXT[line.basis]) ?? ""}` : ""}.${assumed}`;
        break;
      case "generated_speech":
        text = `Generated speech: ${seconds || count(line.count, "reply", "replies")}, estimated as audio tokens of OpenAI's gpt-4o-mini-tts record, which stands in for every vendor's speech model.${line.lengthFromText ? " The length was estimated from the text at 17 characters per second." : ""}`;
        break;
      case "overview_illustrations":
        text = `Video Overview illustrations: ${format(line.units ?? line.count)}, one per 10 seconds of video, each estimated like a generated image.`;
        break;
      case "overview_narration":
        text = `Video Overview narration: ${seconds || count(line.count, "overview", "overviews")}, estimated like generated speech.`;
        break;
    }
    return line.unavailable
      ? `${text} ${format(line.unavailable)} of these could not be estimated and are not in the totals.`
      : text;
  });
  if (details.omitted)
    lines.push(
      `${format(details.omitted)} further estimated parts are counted in the totals but not listed here.`,
    );
  return lines;
}

const HIDDEN_INPUT =
  "Hidden input such as system prompts, memory, project knowledge and retrieved sources is not shown by the site and is not counted. Reading input adds no energy in the EcoLogits method.";
const OUTSIDE_SCOPE =
  "Hardware manufacturing, training, network use and your device are outside these figures.";
const UNLISTED_SIDE_CALLS =
  "Side calls by more than 16 other models in one reply are not listed and not counted.";

/**
 * Why files or images a person attaches add no input on a site whose sends name them without
 * their content or size (A7), or null. Details lists it under What was counted, which every chat
 * shows: in the notes of the totals' explanation it sat in a closed section that a live chat
 * never showed, so an attached image added no input without a word why (live QA, 19 Oct 2026).
 */
export function attachmentNote(site: string | null): string | null {
  // A Perplexity send lists its attachments only as upload links. Text the extension extracts
  // from a local file is a separate diagnostic, never input.
  if (site === "perplexity")
    return "Files and images you attach are sent as links, so their content is not counted as input.";
  // claude.ai sends an attached image as a file id without its size, so its tokens cannot be
  // worked out; the image is noted as unknown input. A Cowork session ("cowork") reports
  // exact usage instead.
  if (site === "claude")
    return "Images you attach are sent as file references without their size, so their tokens are not counted as input.";
  return null;
}

/**
 * What the figures leave out, from the decided coverage rules: always-hidden work first,
 * then notes that apply to this site or to reasons the estimates carry. A Claude Cowork
 * session passes the surface "cowork": its usage report is exact (W5).
 */
export function coverageNotes(
  site: string | null,
  reasons: Readonly<Record<string, number>> = {},
  roles: readonly EstimateLine["role"][] = [],
): string[] {
  if (site === "cowork")
    return [
      HIDDEN_INPUT,
      "Turns the page did not load, such as the older turns of a long session, are counted together in the first reply this browser saved. Their prompts and tool results are not counted.",
      "Cowork sessions never opened in this browser are not counted.",
      "Tools that ran in the session's environment are not model work and are not counted.",
      ...(reasons.side_calls_unobserved ? [UNLISTED_SIDE_CALLS] : []),
      OUTSIDE_SCOPE,
    ];
  const notes = [
    site === "notebooklm"
      ? "Reasoning: only reasoning the site shows is counted, and NotebookLM usually shows none."
      : site === "perplexity"
        ? "Reasoning: only reasoning the site shows is counted, and Perplexity usually shows none."
        : "Reasoning is counted from the summary the site shows. The provider bills the full reasoning, which is longer.",
    HIDDEN_INPUT,
    // Only exact provider reports name side calls (Cowork); chat sites never show them.
    roles.includes("side_calls")
      ? "Side calls such as titles and suggestions are counted where the provider reports them, as listed above."
      : "Side calls such as titles, suggestions and safety checks are not counted.",
  ];
  if (site === "perplexity")
    notes.push(
      "Perplexity's internal search pipeline is not shown. Its visible steps and answers, and the search queries and video prompts its model wrote, are counted.",
    );
  // Gemini delivers these after the reply's own request ends (G20). Its research log
  // interleaves the agents' notes with quoted source text, which no field separates.
  if (site === "gemini")
    notes.push(
      "Gemini videos and Deep Research reports finish after the reply and count when the page loads them, for example when the chat is opened again. The research log shown during a run mixes the agents' notes with quoted sources and is not counted.",
    );
  // NotebookLM's saved chats are imported since 14 October 2026 (owner decision), and
  // Studio items since W9.
  if (site === "notebooklm")
    notes.push(
      "Chats count when they are sent in this browser and when the notebook loads its saved chat, each question and answer once. The notebook loads its newest messages first and older ones when you scroll up the chat. Suggested questions and the notebook guide written when a source is added count as output, not as requests.",
      "Each Studio item counts as a request when the notebook first lists it. Its instructions are not shown, so they are not counted. Studio content counts when the notebook loads it; flashcards, quizzes and mind maps count when opened. Titles are not counted.",
      "The scripts behind Audio and Video Overviews are not shown, so they are not counted as text.",
    );
  // ChatGPT keeps no audio length for voice replies (EP1); read aloud audio is timed (G1).
  if (site === "chatgpt" && roles.includes("generated_speech"))
    notes.push(
      "Voice replies count as their transcript and as speech from it at 17 characters per second. Read aloud counts as speech timed by the audio the page received, or from the reply's text at 17 characters per second, and is not counted as a request.",
    );
  if (reasons.research_work_unobserved)
    notes.push(
      "Research: the visible plan, brief and report are counted, and the agents' search queries where the page showed them. The research agents' own reasoning and drafts are not shown, so they are not counted.",
    );
  // Owner decision of 14 October 2026 (replaces the size rule of 3 October): text and code
  // files Perplexity Computer makes count from their content, downloaded read-only from
  // the file's own link, as output of the model that ran the request. Only a file that
  // cannot be downloaded counts by its size, and its estimate carries file_size_estimated.
  if (site === "perplexity")
    notes.push(
      "Text and code files Perplexity Computer creates count from their content, as output of the model that ran the request. Other files, such as images and PDFs, are not counted.",
    );
  if (reasons.file_size_estimated)
    notes.push(
      "Some files could not be downloaded, so each counts as its size in bytes divided by 4.",
    );
  if (reasons.environment_override)
    notes.push(
      "GLM models reached through Perplexity are estimated for US data centres: the United States electricity mix and EcoLogits' US cloud range for energy overhead (PUE 1.09 to 1.14) and on-site water use (WUE 0.13 to 0.99 L/kWh), instead of the Swedish data centres of the record's host.",
    );
  if (reasons.capture_limit_exceeded)
    notes.push(
      "Some messages hold a part longer than the tracker reads (about 2 million characters of text, 4,096 content blocks, or 262,144 characters of one attached file). That part is not counted, and the message shows as partly measured.",
    );
  if (reasons.side_calls_unobserved) notes.push(UNLISTED_SIDE_CALLS);
  notes.push(OUTSIDE_SCOPE);
  return notes;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
/**
 * How Claude counts are made (owner decision of 15 October 2026), from the packaged
 * method's `claude_token_factor`, so the sentence follows the factor the figures use.
 */
export function claudeFactorNote(
  factor: { factor: string; measured_on: string } = media.claude_token_factor,
): string {
  const [year, month, day] = factor.measured_on.split("-").map(Number);
  return `Claude counts use our tokenizer times ${factor.factor}, measured against Anthropic's own counter on ${day} ${MONTHS[month! - 1]} ${year}.`;
}

/** Where the counts in Details come from, for the surface of the page. */
export function countSourceNote(surface: string | null): string {
  return surface === "cowork"
    ? `Output, reasoning and model names come from Claude's own usage report for the session, including side calls and sub-agents. Prompt and answer text counts use a local reference tokenizer with an unverified model mapping. ${claudeFactorNote()} A missing value is not zero work.`
    : surface === "claude"
      ? `Token counts use a local reference tokenizer with an unverified model mapping. ${claudeFactorNote()} A missing value is not zero work.`
      : surface === "perplexity"
        ? `Token counts use a local reference tokenizer with an unverified model mapping. For replies by Claude models, ${claudeFactorNote().replace(/^Claude counts/, "the counts")} A missing value is not zero work.`
        : "Token counts use a local reference tokenizer with an unverified model mapping. A missing value is not zero work.";
}
