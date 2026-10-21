/**
 * Claude content shared by the live stream and saved history: decoded tool input, tool
 * results and reasoning summaries. Only text is returned; nothing here is kept.
 */

/**
 * The model-written text of a tool call: every string value in document order, plus
 * numbers and booleans as written (A1). Keys and JSON punctuation are protocol, not text
 * the model wrote for the user, so they are left out ("decoded" tool input, 1 Oct).
 * The walk uses its own stack, so input of any depth is decoded and none is dropped.
 * Fields the page attaches to a call are not the model's text and are left out: a
 * Research report's `artifacts` call carries its citation records (ids, titles, links and
 * positions, 35,320 of 41,967 characters in a test of 5 Oct 2026) and a version id at
 * the top of its input. Only there: another tool may use these names for its own input.
 */
const ATTACHED_FIELDS: ReadonlySet<string> = new Set([
  "md_citations",
  "version_uuid",
]);
const ATTACHING_TOOL = "artifacts";

export function decodedToolInput(input: unknown, tool?: string): string {
  const parts: string[] = [];
  const pending: unknown[] = [input];
  while (pending.length) {
    const value = pending.pop();
    if (typeof value === "string") parts.push(value);
    else if (typeof value === "number" || typeof value === "boolean")
      parts.push(String(value));
    else if (value && typeof value === "object") {
      const attached = tool === ATTACHING_TOOL && value === input;
      const items = Array.isArray(value)
        ? value
        : Object.entries(value)
            .filter(([key]) => !(attached && ATTACHED_FIELDS.has(key)))
            .map(([, item]) => item);
      // Children go on the stack last first, so they come off in document order.
      for (let index = items.length - 1; index >= 0; index--)
        pending.push(items[index]);
    }
  }
  return parts.join("\n");
}

/**
 * Tool input streamed as JSON fragments. A complete document is decoded; a fragment that
 * never completed (a stopped reply) still was generated, so its raw text counts.
 */
export function streamedToolInput(json: string, tool?: string): string {
  if (json === "") return "";
  try {
    return decodedToolInput(JSON.parse(json), tool);
  } catch {
    return json;
  }
}

/**
 * The text of a tool result as the page shows it: a plain string, or the text of each
 * content item. Titles, links and other metadata of source cards are not text the model
 * read in full, so they are not counted (A6).
 */
export function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((item) =>
      item &&
      typeof item === "object" &&
      typeof (item as { text?: unknown }).text === "string"
        ? [(item as { text: string }).text]
        : [],
    )
    .join("\n");
}

/** The reasoning summaries of a thinking block, joined in order. */
export function thinkingSummaries(summaries: unknown): string {
  if (!Array.isArray(summaries)) return "";
  return summaries
    .flatMap((entry) =>
      entry &&
      typeof entry === "object" &&
      typeof (entry as { summary?: unknown }).summary === "string"
        ? [(entry as { summary: string }).summary]
        : [],
    )
    .join("\n");
}

/**
 * Visible reasoning of one thinking block (A2): its thinking text when the site shows it,
 * otherwise the summaries it shows instead. Never both, so nothing counts twice.
 */
export function visibleThinking(thinking: string, summaries: string): string {
  return thinking !== "" ? thinking : summaries;
}

/**
 * Block types that carry a tool's result. The Messages API names server tool results
 * after their tool; only their text items count, as for `tool_result` (A6).
 */
export const CLAUDE_RESULT_BLOCKS: ReadonlySet<string> = new Set([
  "tool_result",
  "mcp_tool_result",
  "web_search_tool_result",
  "web_fetch_tool_result",
  "code_execution_tool_result",
  "bash_code_execution_tool_result",
  "text_editor_code_execution_tool_result",
]);

/** Stop reasons that end a reply because the user stopped it; any other reason completes it. */
/**
 * Stop reasons seen in claude.ai's code (30 Sep, C4). Every one ends a reply; only the
 * cancel reasons cancel it. Listed for the drift check, which shows new ones for review.
 */
export const CLAUDE_STOP_REASONS: readonly string[] = Object.freeze([
  "end_turn",
  "max_tokens",
  "stop_sequence",
  "tool_use",
  "pause_turn",
  "refusal",
  "prompt_injection_risk",
  "conversation_length_limit",
  "model_context_window_exceeded",
  "user_canceled",
  "user_canceled_for_queued_message",
]);
export const CLAUDE_CANCEL_REASONS: ReadonlySet<string> = new Set([
  "user_canceled",
  "user_canceled_for_queued_message",
]);
