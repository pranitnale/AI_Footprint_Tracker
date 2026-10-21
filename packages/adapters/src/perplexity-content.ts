import { historyModelLabel, historyUUID } from "./history/common";
import { COMPUTER_FILES_PER_REPLY } from "./history/types";

/*
 * Perplexity entries shared by the live stream and saved threads (W7), so a reply is read
 * by one rule wherever it is seen. Shapes as seen on 9 Sep and 3 Oct 2026: thinking models
 * answer in `workflow_root` text items; Deep research and Best answer in the identical
 * `ask_text` and `ask_text_0_markdown` blocks; search steps hold the queries the model
 * wrote; a generated video names its prompt and model. Only text and counts are returned.
 * Shapes the evidence does not show are not counted and make the reply partial.
 */

const record = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/**
 * Bounds on how much of one entry is walked; past them the reply is partial. Media is
 * searched through objects only: an answer's thousands of string chunks cost no budget.
 */
const WALK = Object.freeze({
  items: 4096,
  depth: 4,
  objects: 50000,
  mediaDepth: 64,
});

/** Item types that carry nothing the model wrote for this reply. */
const SILENT_ITEMS = new Set([
  // Search results the model read: input, and not read here (tool results stay unknown).
  "WORKFLOW_ITEM_SOURCES",
  // Shown while a part is still being made; its content arrives in its own item.
  "WORKFLOW_ITEM_GENERATION_PLACEHOLDER",
  "WORKFLOW_ITEM_EMBEDDED_IFRAME",
  // The user's own answer to a question.
  "WORKFLOW_ITEM_USER_RESPONSE",
]);

// Only these two markdown usages were seen, always holding the same answer (3 Oct).
const isMarkdown = (usage: string) =>
  usage === "ask_text" || usage === "ask_text_0_markdown";
// Blocks of search results (9 Sep: `web_results`, a sources mode with a result count).
const isSearchResults = (usage: string) => /source|web_result/i.test(usage);
/**
 * Block usages seen on 9 Sep and 3 Oct (G7) that hold no answer text of their own: the plan
 * (its goal repeats the answer), sources and web results, answer tabs, suggested follow-ups
 * and media. Another usage may hold text in a shape not yet seen, so it makes the reply
 * partial.
 */
const OTHER_BLOCKS = new Set([
  "plan",
  "sources_answer_mode",
  "web_results",
  "answer_tabs",
  "pending_followups",
  "media_items",
  "answer_generated_video",
  // A generated image, repeated from the media block (5 Oct 2026).
  "answer_generated_image",
  "unified_assets",
  "assets_answer_mode",
]);
/** Block usages and workflow items this reader knows, for the drift check (W10). */
export const PERPLEXITY_BLOCK_USAGES: readonly string[] = Object.freeze([
  "workflow_root",
  "ask_text",
  "ask_text_0_markdown",
  ...OTHER_BLOCKS,
]);
export const PERPLEXITY_ITEMS: readonly string[] = Object.freeze([
  ...SILENT_ITEMS,
  "WORKFLOW_ITEM_TEXT",
  "WORKFLOW_ITEM_QUERIES",
  "WORKFLOW_ITEM_WORKFLOW",
]);
/** Whether a block usage is one this reader knows; other blocks are not read. */
export const knownPerplexityBlock = (usage: string) =>
  usage === "workflow_root" || isMarkdown(usage) || OTHER_BLOCKS.has(usage);

/** One entry's blocks: the answer blocks by intended usage, and every block as received. */
export interface PerplexityBlocks {
  /** `workflow_root` to its workflow, `ask_text*` to their markdown block. */
  answers: Map<string, unknown>;
  /** Every intended usage seen. */
  usages: Set<string>;
  /** The blocks that are read, searched for generated media. */
  all: unknown[];
  /** A block without a usage, or an answer block sent twice, was not read. */
  unknown: boolean;
}

export interface PerplexityEntry {
  /** The answer text, or null when the entry shows none yet. */
  answer: string | null;
  /** Reasoning text the page shows (`thought` items); "" when it shows none. */
  thinking: string;
  /** Text of worker steps. */
  intermediate: string;
  /**
   * Queries the model wrote and the prompts of its videos and images; undefined when a
   * query item was unreadable.
   */
  toolInput: string | undefined;
  /** Search results are not read: undefined when the reply has them, "" otherwise. */
  toolOutput: string | undefined;
  /** Queries read from the search steps; null when the reply has no readable search step. */
  searches: number | null;
  videos: Array<{ model: string | null }>;
  /** Generated images, with the size the entry names. */
  images: Array<{
    model: string | null;
    width: number | null;
    height: number | null;
  }>;
  /** Something the reader does not know was not counted. */
  unknown: boolean;
  /** The entry's `backend_uuid`: the same live and saved (F1), named by the next send. */
  replyId: string | null;
  /** The model that answered (`display_model`, B0). */
  model: string | null;
  /** Files Perplexity Computer created in this reply (`perplexityComputerFiles`). */
  files: PerplexityComputerFile[];
}

/**
 * A file Perplexity Computer created, as its asset describes it (seen 14 Oct 2026). The
 * page shows only its name and size; its content is behind a signed link.
 */
export interface PerplexityComputerFile {
  /** `root_asset_id`, else the asset's own id: the file across versions and rereads. */
  id: string;
  name: string;
  /** The size the asset names, in bytes. */
  bytes: number;
  /** A text or code file, by its media type or else its extension. */
  text: boolean;
  /** The asset's own https link to the file, never built by the reader; null without one. */
  url: string | null;
}

const ASSET_ID = /^[A-Za-z0-9_-]{1,128}$/;
const FILE_NAME_UNITS = 255;
/** Extensions of text and code files, for an asset that names no media type. */
const TEXT_EXTENSIONS = new Set(
  (
    "txt text md markdown rst csv tsv json jsonl ndjson xml yaml yml toml ini cfg conf env " +
    "log py pyi js mjs cjs ts tsx jsx html htm css scss sass less java kt kts c h cc cpp " +
    "cxx hpp cs go rs rb php pl pm swift scala sql sh bash zsh fish ps1 bat cmd r lua dart " +
    "vue svelte tex bib ipynb graphql gql proto dockerfile makefile gradle properties srt vtt"
  ).split(" "),
);

/** A media type of text: `text/*`, JSON, XML, YAML and script types, never an image. */
function textMediaType(type: string): boolean {
  const base = type.split(";")[0]!.trim().toLowerCase();
  if (base.startsWith("image/")) return false;
  return (
    base.startsWith("text/") ||
    /^application\/(?:json|xml|x-yaml|yaml|toml|sql|javascript|x-javascript|ecmascript|x-sh|x-python|x-ipynb\+json)$/.test(
      base,
    ) ||
    /^application\/[a-z0-9.+-]+\+(?:json|xml)$/.test(base)
  );
}

function textExtension(name: string): boolean {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  return TEXT_EXTENSIONS.has(dot >= 0 ? lower.slice(dot + 1) : lower);
}

/** An https link taken as the asset gives it; anything else is not a link to fetch. */
function httpsLink(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 8192) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

const fileSize = (value: unknown) =>
  Number.isSafeInteger(value) && (value as number) >= 0
    ? (value as number)
    : null;

/**
 * The files Perplexity Computer created, from the reply's `unified_assets` blocks (seen
 * 14 Oct 2026). Each file is listed twice: a preview while it is written (its id a tool
 * call id, with a media type but no size or link) and the final file
 * (`is_primary_asset`, `code_file.file_size` and `code_file.url`, repeated in
 * `download_info`). Only final files with a size count; a repeated id counts once. The
 * media type comes from the file's own preview of the same name; without one the
 * extension decides whether it is text.
 */
export function perplexityComputerFiles(blocks: readonly unknown[]): {
  files: PerplexityComputerFile[];
  unknown: boolean;
} {
  const files: PerplexityComputerFile[] = [];
  const ids = new Set<string>();
  let unknown = false;
  for (const block of blocks) {
    if (!record(block) || block.intended_usage !== "unified_assets") continue;
    const assets = block.unified_assets_block?.assets;
    if (assets === undefined) continue;
    if (!Array.isArray(assets)) {
      unknown = true;
      continue;
    }
    const types = new Map<string, string>();
    for (const asset of assets) {
      if (!record(asset) || !Array.isArray(asset.preview_info)) continue;
      for (const preview of asset.preview_info) {
        const handle = record(preview) ? preview.file_handle : null;
        if (
          typeof handle === "string" &&
          handle.startsWith("file:") &&
          typeof preview.media_type === "string"
        )
          types.set(handle.slice(5), preview.media_type);
      }
    }
    for (const asset of assets) {
      if (
        !record(asset) ||
        asset.asset_type !== "CODE_FILE" ||
        asset.is_primary_asset !== true ||
        !record(asset.code_file)
      )
        continue;
      const file = asset.code_file;
      const downloads = Array.isArray(asset.download_info)
        ? asset.download_info.filter(record)
        : [];
      const bytes = fileSize(file.file_size) ?? fileSize(downloads[0]?.size);
      const id =
        typeof asset.root_asset_id === "string" && ASSET_ID.test(asset.root_asset_id)
          ? asset.root_asset_id
          : typeof asset.uuid === "string" && ASSET_ID.test(asset.uuid)
            ? asset.uuid
            : null;
      if (bytes === null || id === null) {
        unknown = true;
        continue;
      }
      if (ids.has(id)) continue;
      if (files.length >= COMPUTER_FILES_PER_REPLY) {
        unknown = true;
        continue;
      }
      ids.add(id);
      const name = [file.filename, file.name, downloads[0]?.filename].find(
        (value): value is string =>
          typeof value === "string" &&
          value.length > 0 &&
          value.length <= FILE_NAME_UNITS &&
          !/[\u0000-\u001f\u007f]/.test(value),
      );
      const type = name ? types.get(name) : undefined;
      files.push({
        id,
        name: name ?? "file",
        bytes,
        text:
          type !== undefined
            ? textMediaType(type)
            : name !== undefined && textExtension(name),
        url:
          [file.url, ...downloads.map((item) => item.url)]
            .map(httpsLink)
            .find((url) => url !== null) ?? null,
      });
    }
  }
  return { files, unknown };
}

/** A text payload as text: the streamed chunks while streaming, then the final text. */
function textPayload(
  payload: unknown,
  streaming?: boolean,
): string | undefined {
  if (!record(payload)) return undefined;
  const chunks =
    Array.isArray(payload.chunks) &&
    payload.chunks.every((chunk: unknown) => typeof chunk === "string")
      ? (payload.chunks as string[]).join("")
      : undefined;
  if (streaming ?? payload.is_streaming === true) return chunks;
  if (typeof payload.text === "string") return payload.text;
  return chunks;
}

/**
 * The query strings of a search item. The 9 Sep audit saw one query string in its payload;
 * the field names were not recorded, so a list named `queries` (strings, or objects with a
 * string `query` or `text`) or strings named `query` are read. Undefined when none is found.
 */
function queryStrings(payload: unknown): string[] | undefined {
  let list: string[] | undefined;
  let unreadable = false;
  const single: string[] = [];
  const visit = (value: unknown, depth: number) => {
    if (list || unreadable || depth > 3 || !record(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "queries" && Array.isArray(child)) {
        const texts: string[] = [];
        for (const entry of child) {
          if (typeof entry === "string") texts.push(entry);
          else if (record(entry) && typeof entry.query === "string")
            texts.push(entry.query);
          else if (record(entry) && typeof entry.text === "string")
            texts.push(entry.text);
          else {
            unreadable = true;
            return;
          }
        }
        list = texts;
        return;
      }
      if (key === "query" && typeof child === "string") single.push(child);
      else visit(child, depth + 1);
    }
  };
  visit(payload, 0);
  if (unreadable) return undefined;
  // A search step without a query is a shape not yet seen, not a search of nothing.
  if (list) return list.length ? list : undefined;
  return single.length ? single : undefined;
}

/** A workflow nested in an item's payload: the first object with a `steps` list. */
function nestedWorkflow(payload: unknown): Record<string, any> | undefined {
  let found: Record<string, any> | undefined;
  const visit = (value: unknown, depth: number) => {
    if (found || depth > 3 || !record(value)) return;
    if (Array.isArray(value.steps)) {
      found = value;
      return;
    }
    for (const child of Object.values(value)) visit(child, depth + 1);
  };
  visit(payload, 0);
  return found;
}

interface Walk {
  answers: string[];
  thinking: string[];
  intermediate: string[];
  queries: string[];
  queriesUnreadable: boolean;
  searchSteps: boolean;
  sources: boolean;
  unknown: boolean;
  visited: number;
}

function readWorkflow(workflow: unknown, walk: Walk, depth: number) {
  if (!record(workflow) || !Array.isArray(workflow.steps)) {
    walk.unknown = true;
    return;
  }
  for (const step of workflow.steps) {
    if (!record(step) || !Array.isArray(step.items)) {
      walk.unknown = true;
      continue;
    }
    for (const item of step.items) {
      if (++walk.visited > WALK.items) {
        walk.unknown = true;
        return;
      }
      readItem(item, walk, depth);
    }
  }
}

function readItem(item: unknown, walk: Walk, depth: number) {
  if (!record(item) || typeof item.type !== "string") {
    walk.unknown = true;
    return;
  }
  if (SILENT_ITEMS.has(item.type)) {
    if (item.type === "WORKFLOW_ITEM_SOURCES") walk.sources = true;
    return;
  }
  if (item.type === "WORKFLOW_ITEM_TEXT") {
    const payload = item.payload?.text_payload;
    const text = textPayload(payload);
    // The item and its payload name the same variant; two different ones are not guessed.
    if (
      typeof item.variant === "string" &&
      typeof payload?.variant === "string" &&
      item.variant !== payload.variant
    ) {
      walk.unknown = true;
      return;
    }
    const variant = item.variant ?? payload?.variant;
    // A finished text repeats its streamed pieces exactly (9 and 14 Sep); when they differ,
    // the final text counts and the reply is partial.
    if (
      text !== undefined &&
      payload.is_streaming !== true &&
      textPayload(payload, true) !== undefined &&
      textPayload(payload, true) !== text
    )
      walk.unknown = true;
    if (text === undefined) walk.unknown = true;
    else if (variant === "answer" || variant === "text_final")
      walk.answers.push(text);
    else if (variant === "thought") walk.thinking.push(text);
    else if (variant === "worker") walk.intermediate.push(text);
    // Another text variant may repeat the answer, so it is not counted.
    else walk.unknown = true;
    return;
  }
  if (item.type === "WORKFLOW_ITEM_QUERIES") {
    walk.searchSteps = true;
    const queries = queryStrings(item.payload);
    if (queries) walk.queries.push(...queries);
    else walk.queriesUnreadable = walk.unknown = true;
    return;
  }
  if (item.type === "WORKFLOW_ITEM_WORKFLOW") {
    const nested = nestedWorkflow(item.payload);
    if (!nested || depth >= WALK.depth) walk.unknown = true;
    else readWorkflow(nested, walk, depth + 1);
    return;
  }
  // Tables, to-do lists, widgets, content items, questions to the user and new types may
  // hold generated text in shapes not yet seen.
  walk.unknown = true;
}

/**
 * Texts counted once, in order: an exact repeat or a prefix of another text is dropped.
 * Sorted, a text's longer versions follow it directly, so one pass finds every prefix.
 */
function distinct(texts: readonly string[]) {
  const sorted = [...new Set(texts)].sort();
  const prefixes = new Set<string>();
  for (let index = 0; index + 1 < sorted.length; index++)
    if (sorted[index + 1]!.startsWith(sorted[index]!))
      prefixes.add(sorted[index]!);
  const seen = new Set<string>();
  return texts.filter((text) => {
    if (prefixes.has(text) || seen.has(text)) return false;
    seen.add(text);
    return true;
  });
}

/**
 * Whether two copies of an answer agree: equal once the reply is finished, and while it
 * still streams one may be the start of the other.
 */
const sameText = (a: string, b: string, final: boolean) =>
  final ? a === b : a.startsWith(b) || b.startsWith(a);

/** The markdown answer: `ask_text`, else `ask_text_0_markdown`. */
function markdownAnswer(
  blocks: PerplexityBlocks,
  final: boolean,
): {
  text: string | undefined;
  present: boolean;
  differs: boolean;
} {
  const usages = [...blocks.answers.keys()]
    .filter(isMarkdown)
    .sort((a, b) => (a === "ask_text" ? -1 : b === "ask_text" ? 1 : 0));
  if (!usages.length)
    return { text: undefined, present: false, differs: false };
  const texts = usages.map((usage) => {
    const block = blocks.answers.get(usage);
    if (!record(block)) return undefined;
    return typeof block.answer === "string"
      ? block.answer
      : textPayload(block, true);
  });
  const text = texts[0];
  // The copies hold the same answer (3 Oct); another one is not added.
  const differs = texts
    .slice(1)
    .some(
      (other) =>
        other === undefined ||
        text === undefined ||
        !sameText(other, text, final),
    );
  return { text, present: true, differs };
}

const pixels = (value: unknown) =>
  Number.isInteger(value) && (value as number) > 0 && (value as number) <= 65536
    ? (value as number)
    : null;

/**
 * The model-written prompts and model labels of the videos and images an entry made
 * (G10): each `generated_media_metadata` found in its blocks, a repeated pair counted
 * once. An image names `medium: "image"` on the item that holds the metadata and is
 * listed up to three times, in the media block's two lists and in its own block (seen
 * 5 Oct 2026); any other item is a video, as the videos seen on 3 Oct named no medium.
 */
function generatedMedia(blocks: readonly unknown[]): {
  videos: Array<{ prompt: string; model: string | null }>;
  images: Array<{
    prompt: string;
    model: string | null;
    width: number | null;
    height: number | null;
  }>;
  unknown: boolean;
} {
  const seen = new Map<string, { prompt: string; model: string | null }>();
  const images = new Map<
    string,
    {
      prompt: string;
      model: string | null;
      width: number | null;
      height: number | null;
    }
  >();
  let unknown = false,
    objects = 0;
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== "object") return;
    if (++objects > WALK.objects || depth > WALK.mediaDepth) {
      unknown = true;
      return;
    }
    if (Array.isArray(value)) {
      for (const child of value) visit(child, depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key !== "generated_media_metadata") {
        visit(child, depth + 1);
        continue;
      }
      if (!record(child) || typeof child.prompt !== "string") {
        unknown = true;
        continue;
      }
      const model = historyModelLabel(child.model_str);
      const pair = JSON.stringify([child.prompt, model]);
      const item = value as Record<string, unknown>;
      if (item.medium === "image") {
        const known = images.get(pair);
        images.set(pair, {
          prompt: child.prompt,
          model,
          width: pixels(item.image_width) ?? known?.width ?? null,
          height: pixels(item.image_height) ?? known?.height ?? null,
        });
      } else seen.set(pair, { prompt: child.prompt, model });
    }
  };
  for (const block of blocks) visit(block, 0);
  return { videos: [...seen.values()], images: [...images.values()], unknown };
}

/**
 * One entry's reply from its root fields and blocks. Live and saved entries use this, so
 * both count the same text and name the same id and model. `final` says the reply is
 * finished, so copies of its answer must match exactly.
 */
export function perplexityEntry(
  entry: Record<string, any>,
  blocks: PerplexityBlocks,
  final: boolean,
): PerplexityEntry {
  const walk: Walk = {
    answers: [],
    thinking: [],
    intermediate: [],
    queries: [],
    queriesUnreadable: false,
    searchSteps: false,
    sources: false,
    unknown:
      blocks.unknown ||
      [...blocks.usages].some((usage) => !knownPerplexityBlock(usage)),
    visited: 0,
  };
  if (blocks.answers.has("workflow_root"))
    readWorkflow(blocks.answers.get("workflow_root"), walk, 0);
  const answers = distinct(walk.answers);
  const markdown = markdownAnswer(blocks, final);
  if (markdown.differs) walk.unknown = true;
  let answer: string | null = null;
  if (answers.length) {
    answer = answers.join("\n");
    // Both shapes hold the same answer when both appear; a different one is not added.
    if (
      markdown.present &&
      (markdown.text === undefined || !sameText(answer, markdown.text, final))
    )
      walk.unknown = true;
  } else if (markdown.text !== undefined) answer = markdown.text;
  else if (markdown.present) walk.unknown = true;
  // Worker steps are separate texts; one that only repeats the answer's start is counted
  // once, as the answer.
  const intermediate = walk.intermediate.filter(
    (text) => answer === null || !answer.startsWith(text),
  );
  const media = generatedMedia(blocks.all);
  const assets = perplexityComputerFiles(blocks.all);
  const searched =
    walk.sources ||
    walk.searchSteps ||
    [...blocks.usages].some(isSearchResults);
  return {
    answer,
    thinking: walk.thinking.join("\n"),
    intermediate: intermediate.join("\n"),
    toolInput: walk.queriesUnreadable
      ? undefined
      : [
          ...walk.queries,
          ...media.videos.map((video) => video.prompt),
          ...media.images.map((image) => image.prompt),
        ].join("\n"),
    toolOutput: searched ? undefined : "",
    searches:
      walk.searchSteps && !walk.queriesUnreadable ? walk.queries.length : null,
    videos: media.videos.map((video) => ({ model: video.model })),
    images: media.images.map(({ model, width, height }) => ({
      model,
      width,
      height,
    })),
    // A file still being written may list no size yet; a finished one must.
    unknown: walk.unknown || media.unknown || (final && assets.unknown),
    replyId: historyUUID(entry.backend_uuid) ? entry.backend_uuid : null,
    model: historyModelLabel(entry.display_model),
    files: assets.files,
  };
}

/**
 * A saved entry's blocks. A block without a usage, a usage this reader does not know, or
 * an answer block sent twice is not read, not even for media, and makes the reply partial;
 * the first answer block of a usage counts.
 */
export function perplexityBlocks(value: unknown[]): PerplexityBlocks {
  const blocks: PerplexityBlocks = {
    answers: new Map(),
    usages: new Set(),
    all: [],
    unknown: false,
  };
  for (const block of value) {
    if (!record(block) || typeof block.intended_usage !== "string") {
      blocks.unknown = true;
      continue;
    }
    const usage = block.intended_usage;
    blocks.usages.add(usage);
    if (blocks.answers.has(usage)) {
      blocks.unknown = true;
      continue;
    }
    if (!knownPerplexityBlock(usage)) continue;
    blocks.all.push(block);
    if (usage === "workflow_root")
      blocks.answers.set(usage, block.workflow_block);
    else if (isMarkdown(usage)) blocks.answers.set(usage, block.markdown_block);
  }
  return blocks;
}
