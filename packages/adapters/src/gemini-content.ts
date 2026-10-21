/*
 * Gemini replies shared by the live stream and saved history (W8), so a reply is read by
 * one rule wherever it is seen. Positions as seen on 1 and 3 Oct 2026 (G2 to G6, free and
 * paid accounts). Only text, counts, sizes and labels are returned. Shapes the evidence
 * does not show are not counted and make the reply partial.
 */

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/**
 * One field of a Gemini message, by array position. Google moves sparse fields into a
 * trailing object keyed by field number (position plus one): one candidate's tool data
 * came as `[null x7, []]`, `[{"8": [], "60": ...}]` and `[null x7, [], {"57": ...}]`.
 */
export function geminiField(message: unknown, index: number): unknown {
  if (!Array.isArray(message)) return undefined;
  const last = message[message.length - 1];
  const sparse = record(last) ? last : null;
  const positional = sparse ? message.length - 1 : message.length;
  const value = index < positional ? message[index] : undefined;
  if (value !== null && value !== undefined) return value;
  const key = String(index + 1);
  return sparse && Object.hasOwn(sparse, key) ? sparse[key] : value;
}

// Mirrors the contracts' label pattern, so a label read here is one history may keep.
const LABEL = /^[A-Za-z0-9][A-Za-z0-9 _.()/:+-]{0,79}$/;
/** A model label as the page shows it ("3.6 Thinking", "Nano Banana 2"), or null. */
export const geminiLabel = (value: unknown): string | null =>
  typeof value === "string" && LABEL.test(value) ? value : null;

// Links Google puts in the answer where its own player or panel shows the content: an
// image (`image_generation_content`, 1 Oct) or a video chip (3 Oct). Not model text.
const PLACEHOLDER = /\s*https?:\/\/googleusercontent\.com\/[a-z_]+\/\d+/g;

/** Positions in a candidate's tool data (`candidate[12]`) that this reader knows. */
const TOOL = Object.freeze({
  images: 7,
  plan: 55,
  document: 56,
  status: 57,
  video: 59,
  mode: 69,
});
const KNOWN_TOOLS: ReadonlySet<number> = new Set(Object.values(TOOL));
/** Bounds on how much of one reply is read; past them the reply is partial. */
const BOUNDS = Object.freeze({
  documents: 16,
  images: 64,
  videos: 64,
  researchSteps: 1024,
});

export interface GeminiImage {
  width: number | null;
  height: number | null;
}
export interface GeminiVideo {
  /** The generating model the record names (G3), or null. */
  model: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
}
export interface GeminiReply {
  /** The visible answer without Google's placeholder links; null when unreadable. */
  answer: string | null;
  /** The answer as stored was empty: a turn stopped before it answered (14 Sep). */
  empty: boolean;
  /** Thought summaries the page shows (A2); "" when it shows none, null when unreadable. */
  thinking: string | null;
  /** Canvas documents the model wrote, title and content (G19); undefined if unreadable. */
  toolInput: string | undefined;
  /** A Deep Research plan's title and steps (D2); undefined if unreadable. */
  intermediate: string | undefined;
  /** A Deep Research report, title and text, with the time it was stored (G4). */
  report: { text: string; storedAt: [number, number] | null } | null;
  /** The turn runs Deep Research, whose agents work out of sight (E1). */
  research: boolean;
  images: GeminiImage[];
  videos: GeminiVideo[];
  /** The longest storyboard written for the turn's videos (EP2), or null. */
  storyboard: string | null;
  /** A part was not read: the reply is partial. */
  unknown: boolean;
}

const strings = (value: unknown): string | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value.join("")
    : undefined;
const dimension = (value: unknown) =>
  Number.isInteger(value) && (value as number) > 0 && (value as number) <= 65536
    ? (value as number)
    : null;
/** A width and height read together: both known or neither. */
function pair(size: unknown, from = 0): GeminiImage {
  const width = dimension(geminiField(size, from)),
    height = dimension(geminiField(size, from + 1));
  return width && height ? { width, height } : { width: null, height: null };
}
/** A stored time `[seconds, nanoseconds]`, or null. */
export function geminiTime(value: unknown): [number, number] | null {
  return Array.isArray(value) &&
    Number.isSafeInteger(value[0]) &&
    value[0] >= 0 &&
    Number.isSafeInteger(value[1]) &&
    value[1] >= 0 &&
    value[1] < 1e9
    ? [value[0], value[1]]
    : null;
}
const absent = (value: unknown) =>
  value === null ||
  value === undefined ||
  (Array.isArray(value) && value.length === 0);
/** No content: flags and counts are page state, not generated text. */
const empty = (value: unknown) =>
  absent(value) ||
  value === "" ||
  typeof value === "number" ||
  typeof value === "boolean";

/** Whether tool data holds a field this reader does not know. */
function unknownTools(tools: unknown[]): boolean {
  const last = tools[tools.length - 1];
  const sparse = record(last) ? last : null;
  const positional = sparse ? tools.length - 1 : tools.length;
  for (let index = 0; index < positional; index++)
    if (!KNOWN_TOOLS.has(index) && !empty(tools[index])) return true;
  if (sparse)
    for (const [key, value] of Object.entries(sparse))
      if (!KNOWN_TOOLS.has(Number(key) - 1) && !empty(value)) return true;
  return false;
}

/** The plan's title and step texts; the time estimate and buttons are page text. */
function planText(plan: unknown): string | undefined {
  const title = geminiField(plan, 0);
  const steps = geminiField(plan, 1);
  if (typeof title !== "string" || !Array.isArray(steps)) return undefined;
  const parts = [title];
  for (const step of steps) {
    if (!Array.isArray(step)) return undefined;
    // A step is its number, its title and, for some, details (3 Oct).
    for (const value of step.slice(1))
      if (typeof value === "string") parts.push(value);
      else if (value !== null && value !== undefined) return undefined;
  }
  return parts.filter(Boolean).join("\n");
}

/**
 * The thoughts a Deep Research run shows in its thinking panel (seen 5 Oct 2026): its
 * status lists the run's steps after a progress label, each a thought (heading and text
 * at [5]) or a site it browsed ([4], a link and site name, not model text). A started
 * run shows only the label. Undefined when a step has another shape.
 */
function researchThoughts(status: unknown): string[] | undefined {
  const progress = geminiField(geminiField(status, 1), 4);
  if (empty(progress)) return [];
  if (!Array.isArray(progress)) return undefined;
  const steps = geminiField(progress, 2);
  if (empty(steps)) return [];
  if (!Array.isArray(steps) || steps.length > BOUNDS.researchSteps)
    return undefined;
  const thoughts: string[] = [];
  for (const step of steps) {
    const thought = geminiField(step, 5);
    // A thought's heading can be null; the last thoughts of the run had none.
    if (
      Array.isArray(thought) &&
      thought.every((v) => typeof v === "string" || v === null)
    )
      thoughts.push(thought.filter(Boolean).join("\n"));
    else if (
      !Array.isArray(step) ||
      !absent(thought) ||
      !site(geminiField(step, 4))
    )
      return undefined;
  }
  return thoughts.filter(Boolean);
}

/** A browsed site: a number, then a label, or the link, title and site name (5 Oct). */
const site = (value: unknown) =>
  typeof geminiField(value, 0) === "number" &&
  (typeof geminiField(value, 1) === "string" ||
    Array.isArray(geminiField(value, 2)));

/** Whether a document carries citations or sources, as a research report does (G4). */
const sourced = (document: unknown) =>
  [5, 8, 17].some((index) => {
    const value = geminiField(document, index);
    return Array.isArray(value) && value.length > 0;
  });

/** The videos and storyboard of a turn's video jobs (G3). */
function videoJobs(jobs: unknown, reply: GeminiReply): void {
  const list = geminiField(jobs, 0);
  if (!Array.isArray(list)) {
    reply.unknown = true;
    return;
  }
  const storyboards: string[] = [];
  for (const job of list) {
    if (!Array.isArray(job)) {
      reply.unknown = true;
      continue;
    }
    const generation = geminiField(job, 1);
    const model = geminiLabel(geminiField(geminiField(generation, 2), 2));
    // The storyboard and its shorter version, and their copy (3 Oct).
    for (const source of [
      geminiField(generation, 7),
      geminiField(geminiField(generation, 28), 0),
    ])
      if (Array.isArray(source))
        for (const text of source)
          if (typeof text === "string" && text) storyboards.push(text);
    const media = geminiField(job, 0);
    // A job without media made no video yet, or none at all (1 Oct, free account).
    if (media === null || media === undefined) continue;
    if (!Array.isArray(media)) {
      reply.unknown = true;
      continue;
    }
    for (const item of media) {
      const mime = geminiField(item, 11);
      const spec = geminiField(item, 17);
      if (
        !Array.isArray(item) ||
        (mime !== undefined &&
          mime !== null &&
          (typeof mime !== "string" || !mime.startsWith("video/")))
      ) {
        reply.unknown = true;
        continue;
      }
      const length = geminiTime(geminiField(spec, 0));
      const seconds = length ? length[0] + length[1] / 1e9 : null;
      reply.videos.push({
        model,
        ...pair(spec, 1),
        durationSeconds: seconds && seconds <= 86400 ? seconds : null,
      });
    }
  }
  reply.storyboard = storyboards.reduce<string | null>(
    (longest, text) =>
      longest === null || text.length > longest.length ? text : longest,
    null,
  );
}

/** One candidate's reply. */
export function geminiReply(candidate: unknown): GeminiReply {
  const reply: GeminiReply = {
    answer: null,
    empty: false,
    thinking: null,
    toolInput: "",
    intermediate: "",
    report: null,
    research: false,
    images: [],
    videos: [],
    storyboard: null,
    unknown: false,
  };
  const body = geminiField(candidate, 1);
  const raw = body === null || body === undefined ? "" : strings(body);
  if (raw === undefined) reply.unknown = true;
  else {
    reply.answer = raw.replace(PLACEHOLDER, "");
    reply.empty = raw === "";
  }
  const thoughts = geminiField(candidate, 37);
  if (absent(thoughts)) reply.thinking = "";
  else {
    const text = Array.isArray(thoughts) ? strings(thoughts[0]) : undefined;
    if (text === undefined) reply.unknown = true;
    else reply.thinking = text;
  }
  const tools = geminiField(candidate, 12);
  let entry: unknown = undefined;
  if (tools !== null && tools !== undefined) {
    if (!Array.isArray(tools)) {
      reply.unknown = true;
      reply.intermediate = undefined;
    } else {
      if (unknownTools(tools)) reply.unknown = true;
      const status = geminiField(tools, TOOL.status);
      reply.research = !empty(status);
      if (reply.research) {
        // The panel's thoughts are visible reasoning, counted with the turn's thoughts.
        // A thought the turn's own thoughts already hold is counted once.
        const thoughts = researchThoughts(status);
        if (thoughts === undefined) reply.unknown = true;
        else if (reply.thinking !== null) {
          const known = reply.thinking;
          const added = thoughts.filter((thought) => !known.includes(thought));
          reply.thinking = [known, ...added].filter(Boolean).join("\n");
        }
      }
      const plan = geminiField(tools, TOOL.plan);
      if (!empty(plan)) {
        reply.intermediate = planText(plan);
        if (reply.intermediate === undefined) reply.unknown = true;
      }
      entry = geminiField(geminiField(tools, TOOL.document), 0);
      const images = geminiField(tools, TOOL.images);
      const list = geminiField(images, 0);
      if (!empty(images) && !empty(list)) {
        if (!Array.isArray(list)) reply.unknown = true;
        else {
          if (list.length > BOUNDS.images) reply.unknown = true;
          for (const image of list.slice(0, BOUNDS.images)) {
            const stored = geminiField(geminiField(image, 0), 3);
            const mime = geminiField(stored, 11);
            // Each entry is one generated image (1 Oct); another kind is not counted.
            if (
              !Array.isArray(stored) ||
              typeof mime !== "string" ||
              !mime.startsWith("image/")
            ) {
              reply.unknown = true;
              continue;
            }
            reply.images.push(pair(geminiField(stored, 15)));
          }
        }
      }
      const video = geminiField(tools, TOOL.video);
      if (!empty(video)) videoJobs(video, reply);
      if (reply.videos.length > BOUNDS.videos) {
        reply.videos = reply.videos.slice(0, BOUNDS.videos);
        reply.unknown = true;
      }
    }
  }
  const documents = geminiField(candidate, 30);
  if (!empty(documents)) {
    if (!Array.isArray(documents) || documents.length > BOUNDS.documents) {
      reply.unknown = true;
      reply.toolInput = undefined;
    } else {
      const canvas: string[] = [];
      for (const document of documents) {
        const title = geminiField(document, 2);
        const content =
          geminiField(document, 4) ?? geminiField(geminiField(document, 14), 0);
        if (
          !Array.isArray(document) ||
          (title !== undefined &&
            title !== null &&
            typeof title !== "string") ||
          (content !== undefined &&
            content !== null &&
            typeof content !== "string")
        ) {
          reply.unknown = true;
          continue;
        }
        const text = [title, content]
          .filter(
            (value): value is string => typeof value === "string" && !!value,
          )
          .join("\n");
        // A research run stores its report as a document with sources; Canvas writes one
        // with a file name and its language, and no research status (3 Oct).
        if (reply.research || sourced(document)) {
          // The report appears once the run ends; until then the document holds no text.
          if (typeof content === "string" && content) {
            const stored =
              geminiField(entry, 1) === geminiField(document, 0)
                ? geminiTime(geminiField(entry, 5))
                : null;
            reply.report = reply.report
              ? { text: reply.report.text + "\n" + text, storedAt: null }
              : { text, storedAt: stored };
          }
          reply.research = true;
        } else canvas.push(text);
      }
      reply.toolInput = canvas.filter(Boolean).join("\n");
    }
  }
  return reply;
}
