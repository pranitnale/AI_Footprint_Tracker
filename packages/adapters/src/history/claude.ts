import { timingEvidence } from "@footprint/capture-core";
import {
  CLAUDE_RESULT_BLOCKS,
  decodedToolInput,
  thinkingSummaries,
  toolResultText,
  visibleThinking,
} from "../claude-content";
import {
  boundedFileText,
  boundedText,
  finishHistoryPage,
  historyInstant,
  historyMessage,
  historyModelLabel,
  historyPage,
  historySeconds,
  historySpan,
  historyUUID,
  record,
} from "./common";
import { HISTORY_LIMITS } from "./types";
import type { HistoryCoverageReason, HistoryTextMessage } from "./types";

const ROOT = "00000000-0000-4000-8000-000000000000";
export const CLAUDE_HISTORY_ROOT = ROOT;
export type ClaudeHistoryRow = {
  message: HistoryTextMessage;
  parentId: string;
  index: number | null;
  untruncated: boolean;
};

// Block types of a saved Claude message (C4). Display blocks carry no model text.
const TEXT_BLOCKS: ReadonlySet<string> = new Set(["text", "connector_text"]);
const THINKING_BLOCKS: ReadonlySet<string> = new Set([
  "thinking",
  "redacted_thinking",
]);
const TOOL_BLOCKS: ReadonlySet<string> = new Set([
  "tool_use",
  "server_tool_use",
  "mcp_tool_use",
]);
const KNOWN_BLOCKS: ReadonlySet<string> = new Set([
  ...TEXT_BLOCKS,
  ...THINKING_BLOCKS,
  ...TOOL_BLOCKS,
  ...CLAUDE_RESULT_BLOCKS,
  "flag",
  "token_budget",
  "process_group_marker",
]);
// Blocks the model wrote; their stored times bound the reply's generation.
const TIMED_BLOCKS: ReadonlySet<string> = new Set([
  ...TEXT_BLOCKS,
  ...THINKING_BLOCKS,
  ...TOOL_BLOCKS,
]);
/** The tool Claude Research calls with the model-written brief (E1). */
const RESEARCH_TOOL = "launch_extended_search_task";
const TASK_ID = /^wf-[A-Za-z0-9_-]{1,96}$/;
// Depth to search a status response for the agents' tool input; results nest below it.
const TASK_DEPTH = 12;
// Fields of a status response that hold what tools returned or describe the run, never
// the input an agent wrote; they are not searched.
const TASK_SKIPPED =
  /result|output|source|citation|description|summary|content/i;

/** A Claude Research run as the page's own task status poll showed it (E1). */
export type ClaudeResearchTask = {
  /** Task id from the status route, such as `wf-…`. */
  id: string;
  /** Search queries and other tool input the research agents wrote, or null if unread. */
  queries: string | null;
  /** Seconds from the task's start to its completion, or null when not shown. */
  seconds: number | null;
};

/**
 * Facts of a finished research task from the page's own status response: the agents'
 * tool input (their search queries) and the task span (C1). Results, sources and agent
 * descriptions are not read. An unfinished task or another shape gives null.
 */
export function claudeResearchTask(
  value: unknown,
  id: string,
): ClaudeResearchTask | null {
  if (!TASK_ID.test(id) || !record(value) || value.status !== "completed")
    return null;
  let queries: string | null = null;
  if (Array.isArray(value.agents) && value.agents.length <= 64) {
    const inputs: string[] = [];
    const walk = (node: unknown, depth: number) => {
      if (depth > TASK_DEPTH) return;
      if (Array.isArray(node)) {
        for (const item of node) walk(item, depth + 1);
      } else if (record(node))
        for (const [key, item] of Object.entries(node))
          if (key === "tool_input") inputs.push(decodedToolInput(item));
          else if (!TASK_SKIPPED.test(key)) walk(item, depth + 1);
    };
    walk(value.agents, 0);
    const text = inputs.filter(Boolean).join("\n");
    if (boundedText(text)) queries = text;
  }
  const seconds = historySeconds(value.started_at, value.completed_at);
  return {
    id,
    queries,
    seconds:
      seconds !== null && seconds > 0 && seconds <= 86400 ? seconds : null,
  };
}

/** True when `text` holds `id` as a whole token, not as part of a longer id. */
function holdsId(text: string, id: string): boolean {
  for (let at = text.indexOf(id); at >= 0; at = text.indexOf(id, at + 1)) {
    const before = text[at - 1] ?? "",
      after = text[at + id.length] ?? "";
    if (!/[A-Za-z0-9_-]/.test(before) && !/[A-Za-z0-9_-]/.test(after))
      return true;
  }
  return false;
}

/**
 * The research task of a reply that launched one. Its id appears in the launch call, its
 * result or both; it is matched as a whole string, so the shape of those blocks does not
 * matter. Unless exactly one known task matches, nothing is attached.
 */
function researchTaskOf(
  blocks: ReadonlyArray<Record<string, any>>,
  tasks: readonly ClaudeResearchTask[],
): ClaudeResearchTask | null {
  const launches = blocks.filter(
    (block) => TOOL_BLOCKS.has(block.type) && block.name === RESEARCH_TOOL,
  );
  const ids = new Set(launches.map((block) => block.id));
  const related = blocks.filter(
    (block) =>
      launches.includes(block) ||
      (CLAUDE_RESULT_BLOCKS.has(block.type) && ids.has(block.tool_use_id)),
  );
  let text: string;
  try {
    text = JSON.stringify(related);
  } catch {
    return null;
  }
  const matches = tasks.filter(
    (task) => holdsId(text, task.id) || holdsId(text, task.id.slice(3)),
  );
  return matches.length === 1 ? matches[0]! : null;
}

/** Compaction summary items (E4): none when absent, undefined in an unknown shape. */
function compactionItems(
  value: unknown,
): ReadonlyArray<Record<string, any>> | undefined {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) &&
    value.length <= HISTORY_LIMITS.blocks &&
    value.every(
      (item) =>
        record(item) && item.type === "text" && typeof item.text === "string",
    )
    ? value
    : undefined;
}

/** The stored generation span of a saved reply, or null when a block has no times. */
function generationSpan(blocks: ReadonlyArray<Record<string, any>>) {
  const spans = blocks.map((block) => ({
    start: historyInstant(block.start_timestamp),
    stop: historyInstant(block.stop_timestamp),
  }));
  if (
    !spans.length ||
    !spans.every(
      (span) =>
        span.start &&
        span.stop &&
        historySpan(span.start, span.stop, "claude_history"),
    )
  )
    return null;
  const ordered = (v: string) =>
    v.replace(/\.(\d+)Z$/, (_m, f: string) => "." + f.padEnd(6, "0") + "Z");
  const start = spans.map((span) => ordered(span.start!)).sort()[0];
  const stop = spans
    .map((span) => ordered(span.stop!))
    .sort()
    .at(-1);
  return historySpan(start, stop, "claude_history");
}

export type ClaudeHistoryOptions = {
  /** The chat's current model, the only model Claude history names (B5). */
  model?: string | null;
  /** Research runs of this conversation that the page's own polls showed (E1). */
  research?: readonly ClaudeResearchTask[];
};

/** Extract one provider row without retaining its other fields or conversation text. */
export function claudeHistoryRow(
  row: unknown,
  options: ClaudeHistoryOptions = {},
): ClaudeHistoryRow {
  if (
    !record(row) ||
    !historyUUID(row.uuid) ||
    !["human", "assistant"].includes(row.sender) ||
    (row.parent_message_uuid !== ROOT && !historyUUID(row.parent_message_uuid))
  )
    throw new Error("history_unsupported");
  const message = historyMessage(
    row.uuid,
    row.sender === "human" ? "prompt" : "response",
  );
  if (row.sender === "assistant") message.liveAttemptId = row.uuid;
  // Every saved message gets the chat's model; history names no per-reply model (B5).
  message.modelId = options.model ?? null;
  message.occurredAt = historyInstant(row.created_at);
  if (message.occurredAt) message.dateBasis = "message_created";
  // A part left out for its size is named on the message, never dropped silently.
  let limited =
    Array.isArray(row.content) && row.content.length > HISTORY_LIMITS.blocks;
  const blocks =
    Array.isArray(row.content) && row.content.length <= HISTORY_LIMITS.blocks
      ? (row.content as unknown[])
      : null;
  // Parts other than the answer are read only when every block names its type.
  const typed =
    blocks &&
    blocks.every((block) => record(block) && typeof block.type === "string")
      ? (blocks as Array<Record<string, any>>)
      : null;
  if (blocks) {
    const texts = blocks
      .filter((block: any) => TEXT_BLOCKS.has(block?.type))
      .map((block: any) =>
        // Connector text is answer text; its own field follows the block type's name.
        block.type === "connector_text"
          ? (block.text ?? block.connector_text)
          : block.text,
      );
    if (texts.length && texts.every((text) => boundedText(text))) {
      const text = texts.join("");
      if (boundedText(text)) message.text = text;
      else limited = true;
    } else if (
      texts.some((text) => typeof text === "string" && !boundedText(text))
    )
      limited = true;
    else if (
      !texts.length &&
      row.sender === "assistant" &&
      typed?.length &&
      (row.text === undefined || row.text === "")
    )
      // A reply stopped during thinking or one that only used tools has no answer text.
      message.text = "";
  }
  // Every stop reason ends a saved reply; a missing one means it may still be running (C6).
  message.complete =
    message.text !== null &&
    row.truncated === false &&
    (row.sender === "human" || typeof row.stop_reason === "string");
  if (row.sender === "assistant" && typed) {
    const reasons = new Set<HistoryCoverageReason>();
    if (typed.some((block) => !KNOWN_BLOCKS.has(block.type)))
      reasons.add("unknown_event_observed");
    // A part longer than one message field is left out, so it stays unknown. Empty
    // blocks add no separator.
    const part = (texts: string[]) => {
      const text = texts.filter(Boolean).join("\n");
      if (boundedText(text)) return text;
      limited = true;
      return undefined;
    };
    const thinking = part(
      typed
        .filter((block) => THINKING_BLOCKS.has(block.type))
        .map((block) =>
          visibleThinking(
            typeof block.thinking === "string" ? block.thinking : "",
            thinkingSummaries(block.summaries),
          ),
        ),
    );
    if (thinking !== undefined) message.thinking = thinking;
    const toolInput = part(
      typed
        .filter((block) => TOOL_BLOCKS.has(block.type))
        .map((block) =>
          decodedToolInput(
            block.input,
            typeof block.name === "string" ? block.name : undefined,
          ),
        ),
    );
    if (toolInput !== undefined) message.toolInput = toolInput;
    // Results the page shows in full count as input (A6).
    const toolOutput = part(
      typed
        .filter((block) => CLAUDE_RESULT_BLOCKS.has(block.type))
        .map((block) => toolResultText(block.content)),
    );
    if (toolOutput !== undefined) message.toolOutput = toolOutput;
    const compaction = compactionItems(row.compaction_summary);
    const summary = compaction && part(compaction.map((item) => item.text));
    if (summary !== undefined) message.intermediate = summary;
    let researchTiming = null;
    const research = typed.some(
      (block) => TOOL_BLOCKS.has(block.type) && block.name === RESEARCH_TOOL,
    );
    if (research) {
      reasons.add("research_work_unobserved");
      const task = researchTaskOf(typed, options.research ?? []);
      // The agents' queries are text the chat's model wrote for this reply (owner, 3 Oct).
      if (task?.queries)
        message.components = [
          {
            role: "research",
            model: options.model ?? null,
            text: task.queries,
            outputTokens: null,
          },
        ];
      if (task?.seconds)
        researchTiming = timingEvidence(
          task.seconds,
          "claude_history",
          "complete_for_scope",
          "research_task",
        );
    }
    if (reasons.size) message.coverageReasons = [...reasons];
    if (message.complete)
      // A research run is timed only by its own task span (C1). Its blocks span the wait
      // for the report, a different measure that would contradict the task span later.
      // A compaction summary in an unknown shape cannot be timed, so the span would be
      // too short; the reply then has no timing.
      message.timing = research
        ? researchTiming
        : compaction === undefined
          ? null
          : generationSpan([
              ...typed.filter((block) => TIMED_BLOCKS.has(block.type)),
              // Compaction summaries are generated text with their own stored times (E4).
              ...compaction,
            ]);
  }
  if (row.sender === "human") {
    const images = uploadedImages(row);
    if (images) message.inputImages = images;
  }
  const attachments = Array.isArray(row.attachments) ? row.attachments : null;
  // Attached text past the counter's limits is left out and named, like a long part.
  const oversized =
    !!attachments &&
    (attachments.length > HISTORY_LIMITS.inlineFiles ||
      attachments.some(
        (file: any) =>
          record(file) &&
          typeof file.extracted_content === "string" &&
          !boundedFileText(file.extracted_content),
      ));
  if (
    (oversized || limited) &&
    !message.coverageReasons?.includes("capture_limit_exceeded")
  )
    message.coverageReasons = [
      ...(message.coverageReasons ?? []),
      "capture_limit_exceeded",
    ];
  if (
    Array.isArray(row.attachments) &&
    row.attachments.length <= HISTORY_LIMITS.inlineFiles &&
    row.attachments.every(
      (file: any) =>
        record(file) &&
        boundedFileText(file.extracted_content) &&
        typeof file.file_type === "string" &&
        file.file_type.length <= 128 &&
        Number.isSafeInteger(file.file_size) &&
        file.file_size >= 0 &&
        file.file_size <= 25 * 1024 * 1024,
    )
  )
    message.inlineFiles = row.attachments.map((file: any) => ({
      text: file.extracted_content,
    }));
  return {
    message,
    parentId: row.parent_message_uuid,
    index: Number.isSafeInteger(row.index) ? row.index : null,
    untruncated: row.truncated === false,
  };
}

// File kinds claude.ai gives uploads; only images become image input (A7).
const FILE_KINDS: ReadonlySet<string> = new Set(["image", "document", "blob"]);

/**
 * Uploaded images of a saved prompt. Claude history does not show their pixel size, so
 * each image is known to exist but its tokens stay unknown. No files means no images; a
 * file of an unknown kind leaves the images unknown.
 */
function uploadedImages(row: Record<string, any>) {
  const lists = [row.files, row.files_v2].filter(
    (files) => files !== undefined,
  );
  if (!lists.length || !lists.every(Array.isArray)) return undefined;
  const files = (lists as unknown[][]).flat();
  if (files.length > 64) return undefined;
  const kinds = files.map((file) =>
    record(file) && typeof file.file_kind === "string" ? file.file_kind : null,
  );
  if (!kinds.every((kind) => kind !== null && FILE_KINDS.has(kind)))
    return undefined;
  // The same upload can be listed in both arrays; each file id counts once.
  const images = new Set<string>();
  files.forEach((file: any, index) => {
    if (kinds[index] === "image")
      images.add(
        typeof file.file_uuid === "string" ? file.file_uuid : `index:${index}`,
      );
  });
  return [...images].map(() => ({ width: null, height: null }));
}

export function claudeHistory(
  value: unknown,
  conversationId: string,
  observedAt: string,
  research: readonly ClaudeResearchTask[] = [],
) {
  if (
    !record(value) ||
    value.uuid !== conversationId ||
    !Array.isArray(value.chat_messages) ||
    !historyUUID(value.current_leaf_message_uuid)
  )
    throw new Error("history_unsupported");
  const page = historyPage("claude", conversationId, observedAt);
  const model = historyModelLabel(value.model);
  const rows = new Map<string, any>();
  for (const row of value.chat_messages) {
    if (
      !record(row) ||
      !historyUUID(row.uuid) ||
      rows.has(row.uuid) ||
      !["human", "assistant"].includes(row.sender) ||
      (row.parent_message_uuid !== ROOT &&
        !historyUUID(row.parent_message_uuid))
    )
      throw new Error("history_unsupported");
    rows.set(row.uuid, row);
  }
  const chain: any[] = [],
    seen = new Set<string>();
  let id: string = value.current_leaf_message_uuid;
  while (id !== ROOT && rows.has(id)) {
    if (seen.has(id)) throw new Error("history_unsupported");
    seen.add(id);
    const row = rows.get(id);
    chain.push(row);
    id = row.parent_message_uuid;
  }
  if (!chain.length) throw new Error("history_unsupported");
  chain.reverse();
  page.selectedLeafId = value.current_leaf_message_uuid;
  // Every branch is read (owner rule of 26 September 2026: Req counts every request in a
  // chat, including those on branches an edit or a regeneration replaced). A `tree=True` read
  // holds them all, so the page is the loaded messages, as on ChatGPT. The selected branch
  // still decides the selected leaf and the first-request proof below.
  page.branchScope = "loaded_messages";
  page.branchSourceIds = chain.map((row) => row.uuid);
  // A chain that reaches the root from a human message is the selected branch from its start,
  // whatever that message's index. Editing the first prompt starts a new branch whose first
  // message has index 2 (the original prompt and reply keep 0 and 1), so an index rule left
  // such chats "Partially loaded" for good (seen live, 13 October 2026).
  if (
    id === ROOT &&
    chain[0].sender === "human" &&
    chain.every((row) => row.truncated === false)
  ) {
    page.firstRequestVerified = true;
    page.rootSourceId = chain[0].uuid;
    page.hasEarlier = false;
  }
  // Each message once, in the order the chat lists them, linked to its own parent.
  for (const row of rows.values()) {
    const { message } = claudeHistoryRow(row, { model, research });
    const parent = rows.get(row.parent_message_uuid);
    if (parent) {
      message.parentSourceId = parent.uuid;
      message.parentRole = parent.sender === "human" ? "prompt" : "response";
    }
    if (row.sender === "assistant")
      message.promptSourceId = claudePromptOf(row.parent_message_uuid, (id) => {
        const ancestor = rows.get(id);
        return ancestor && { sender: ancestor.sender, parentId: ancestor.parent_message_uuid };
      });
    page.messages.push(message);
  }
  return finishHistoryPage(page);
}

/**
 * The prompt a reply answers: its nearest human ancestor, or null when the chain breaks or
 * loops. Replies on a replaced branch are reached only through their own parents, so the walk
 * is bounded by the rows it can visit.
 */
export function claudePromptOf(
  parentId: string,
  row: (id: string) => { sender: string; parentId: string } | undefined,
): string | null {
  const seen = new Set<string>();
  for (let id = parentId; id !== ROOT && !seen.has(id); ) {
    seen.add(id);
    const ancestor = row(id);
    if (!ancestor) return null;
    if (ancestor.sender === "human") return id;
    id = ancestor.parentId;
  }
  return null;
}
