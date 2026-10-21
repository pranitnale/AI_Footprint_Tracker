import {
  boundedText,
  CaptureError,
  LIMITS,
  type SseFrame,
} from "@footprint/capture-core";
import { initialSnapshot, type ProtocolSession, type Snapshot } from "./types";
import {
  CLAUDE_CANCEL_REASONS,
  CLAUDE_RESULT_BLOCKS,
  decodedToolInput,
  streamedToolInput,
  thinkingSummaries,
  toolResultText,
  visibleThinking,
} from "./claude-content";
import { fitGeneratedText } from "./generated-text";

/** The tool Claude Research calls with the model-written brief (E1). */
const RESEARCH_TOOL = "launch_extended_search_task";

/** Events this reader handles; the drift check compares them with the site's code (W10). */
export const CLAUDE_EVENTS: readonly string[] = Object.freeze([
  "message_start",
  "content_block_start",
  "content_block_delta",
  "content_block_stop",
  "content_block_retract",
  "model_fallback",
  "model_update",
  "message_delta",
  "message_stop",
  "error",
]);
// Events that carry no generated output: display, telemetry, quota and approval notices.
export const CLAUDE_IGNORED_EVENTS: ReadonlySet<string> = new Set([
  "ping",
  "conversation_ready",
  "message_limit",
  "compaction_status",
  "cache_performance",
  "tool_approval",
  "mcp_auth_required",
  "mcp_elicitation",
  "mcp_elicitation_complete",
  "composer_notice",
  "notice_poll_hint",
  "melange_edit_result",
]);

type Kind =
  | "text"
  | "thinking"
  | "tool"
  | "result"
  | "compaction"
  | "display"
  | "unknown";
// Block types claude.ai streams. Display blocks are interface markers without model text.
const BLOCK_KINDS: Readonly<Record<string, Kind>> = {
  text: "text",
  connector_text: "text",
  thinking: "thinking",
  redacted_thinking: "thinking",
  tool_use: "tool",
  server_tool_use: "tool",
  mcp_tool_use: "tool",
  ...Object.fromEntries(
    [...CLAUDE_RESULT_BLOCKS].map((type) => [type, "result"]),
  ),
  compaction: "compaction",
  flag: "display",
  token_budget: "display",
  process_group_marker: "display",
};
// Deltas that change no counted text, accepted only on the block kinds they describe.
const DISPLAY_DELTAS: Readonly<Partial<Record<Kind, readonly string[]>>> = {
  text: ["citations_delta", "citation_start_delta", "citation_end_delta"],
  thinking: ["thinking_cut_off_delta"],
  tool: ["tool_use_block_update_delta"],
};
/** Block types and deltas this reader knows, for the drift check (W10). */
export const CLAUDE_BLOCK_TYPES: readonly string[] = Object.freeze(
  Object.keys(BLOCK_KINDS),
);
export const CLAUDE_DELTAS: readonly string[] = Object.freeze([
  "text_delta",
  "connector_text_delta",
  "thinking_delta",
  "thinking_summary_delta",
  "input_json_delta",
  "compaction_delta",
  "signature_delta",
  ...Object.values(DISPLAY_DELTAS).flat(),
]);

type Block = {
  type: string;
  kind: Kind;
  name?: string;
  text: string;
  thinking: string;
  summaries: string[];
  /** Tool input as streamed JSON fragments, or the complete input the block started with. */
  json: string;
  input: unknown;
  result: string;
  decoded?: string;
  /**
   * Tool or compaction text that could not be read in full: longer than one text field,
   * or in a shape the tracker does not know. Its part stays unknown instead of lower.
   */
  unread?: boolean;
};

const textOf = (value: unknown) =>
  typeof value === "string" ? boundedText(value) : "";

/** Adds tool or compaction text; text past the field limit marks the block unread. */
function append(block: Block, key: "json" | "text" | "result", value: string) {
  if (block.unread) return;
  if (block[key].length + value.length > LIMITS.text) {
    block.unread = true;
    block[key] = "";
  } else block[key] += value;
}

export class ClaudeSession implements ProtocolSession {
  private blocks = new Map<number, Block>();
  /**
   * Blocks that no longer hold an index: those of earlier messages in the same stream and
   * retracted ones. They were generated, so each still counts in its own part. Moving
   * retracted text to another part would count it twice, because a lower recount of the
   * answer keeps the higher count (X9).
   */
  private settled: Block[] = [];
  private state = initialSnapshot();
  private stopReason: string | null = null;
  private messages = 0;
  private unknownEvents = false;
  private search = new Set<string>();
  frame({ value: v }: SseFrame): void {
    if (!v) return;
    switch (v.type) {
      case "message_start":
        this.messageStart(v);
        break;
      case "content_block_start":
        this.blockStart(v);
        break;
      case "content_block_delta":
        this.blockDelta(v);
        break;
      case "content_block_retract": {
        // Retract removes blocks from the visible reply from an index onward, so later
        // blocks can reuse those indexes. The removed text was still generated.
        const from = Number.isInteger(v.from_index) ? v.from_index : v.index;
        if (!Number.isInteger(from) || from < 0) {
          this.unknownEvents = true;
          break;
        }
        for (const [index, block] of [...this.blocks].sort(([a], [b]) => a - b))
          if (index >= from) {
            this.settled.push(block);
            this.blocks.delete(index);
          }
        break;
      }
      case "model_fallback":
      case "model_update":
        // The site switched models; later output comes from the model it names.
        if (typeof v.model === "string" && v.model.length <= 256)
          this.state.model = v.model;
        break;
      case "message_delta":
        if (v.delta && Object.hasOwn(v.delta, "stop_reason"))
          this.stopReason =
            typeof v.delta.stop_reason === "string"
              ? v.delta.stop_reason
              : null;
        break;
      case "message_stop":
        // Every stop reason ends the reply: a user stop cancels it, any other completes it.
        if (this.state.state === "generating" && this.stopReason !== null)
          this.state.state = CLAUDE_CANCEL_REASONS.has(this.stopReason)
            ? "cancelled"
            : "completed";
        break;
      case "error":
        this.state.state = "failed";
        break;
      case "content_block_stop":
        break;
      default:
        // A new kind of event: count the reply from what is known and say so in
        // Details (D7). Unknown content inside a known block still fails below.
        if (!CLAUDE_IGNORED_EVENTS.has(v.type)) this.unknownEvents = true;
    }
  }
  private messageStart(v: any) {
    if (typeof v.message?.id !== "string")
      throw new CaptureError("unsupported_schema");
    if (
      v.message.uuid !== undefined &&
      (typeof v.message.uuid !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          v.message.uuid,
        ))
    )
      throw new CaptureError("unsupported_schema");
    // A second message in one stream (a rotated or fallback model) is more output of the
    // same reply. Its blocks restart at index 0, so the earlier ones are set aside.
    if (this.messages++ > 0) {
      this.settled.push(...this.ordered());
      this.blocks.clear();
      if (this.state.state === "completed") this.state.state = "generating";
    }
    this.stopReason = null;
    this.state.started = true;
    // Consumer history preserves uuid; the protocol id identifies a different object.
    this.state.outputId = v.message.uuid ?? v.message.id;
    this.state.parentId =
      typeof v.message.parent_uuid === "string" ? v.message.parent_uuid : null;
    if (typeof v.message.model === "string") this.state.model = v.message.model;
  }
  private blockStart(v: any) {
    if (
      !Number.isInteger(v.index) ||
      v.index < 0 ||
      v.index > 256 ||
      typeof v.content_block?.type !== "string"
    )
      throw new CaptureError("unsupported_schema");
    if (this.blocks.has(v.index))
      throw new CaptureError("conflicting_duplicate");
    const b = v.content_block;
    const kind = BLOCK_KINDS[b.type] ?? "unknown";
    if (kind === "unknown") this.unknownEvents = true;
    const block: Block = {
      type: b.type,
      kind,
      name: typeof b.name === "string" ? b.name : undefined,
      // Connector text is answer text; its own field follows the block type's name.
      text: kind === "text" ? textOf(b.text ?? b.connector_text) : "",
      thinking: kind === "thinking" ? textOf(b.thinking) : "",
      summaries: [],
      json: "",
      input: kind === "tool" ? b.input : undefined,
      result: "",
    };
    if (kind === "thinking") {
      const summaries = thinkingSummaries(b.summaries);
      if (summaries) block.summaries.push(boundedText(summaries));
    } else if (kind === "result")
      append(block, "result", toolResultText(b.content));
    else if (kind === "compaction") {
      const text = b.text ?? b.summary;
      if (typeof text === "string") append(block, "text", text);
      else if (text !== undefined) block.unread = true;
    }
    this.blocks.set(v.index, block);
    if (kind === "tool" && b.name === "web_search" && typeof b.id === "string")
      this.search.add(b.id);
  }
  private blockDelta(v: any) {
    const block = this.blocks.get(v.index);
    if (!block) throw new CaptureError("unsupported_schema");
    const type = v.delta?.type;
    // Interface and unknown blocks carry nothing to count; their updates are skipped.
    if (block.kind === "display" || block.kind === "unknown") return;
    if (type === "signature_delta") return;
    if (DISPLAY_DELTAS[block.kind]?.includes(type)) return;
    // Unknown or malformed content inside a known text, thinking or tool block fails
    // closed (D7): counting around it would silently lower the reply.
    if (block.kind === "text" && type === "text_delta")
      block.text = boundedText(block.text + boundedText(v.delta.text));
    else if (block.kind === "text" && type === "connector_text_delta")
      block.text = boundedText(
        block.text + boundedText(v.delta.text ?? v.delta.connector_text),
      );
    else if (block.kind === "thinking" && type === "thinking_delta")
      block.thinking = boundedText(
        block.thinking + boundedText(v.delta.thinking),
      );
    else if (block.kind === "thinking" && type === "thinking_summary_delta")
      // Each summary delta is one whole summary of the hidden reasoning (A2).
      block.summaries.push(boundedText(v.delta.summary?.summary));
    else if (block.kind === "tool" && type === "input_json_delta") {
      if (typeof v.delta.partial_json !== "string")
        throw new CaptureError("unsupported_schema");
      append(block, "json", v.delta.partial_json);
      block.decoded = undefined;
    } else if (block.kind === "compaction" && type === "compaction_delta") {
      // A live compaction stream was not observed yet (E4). Text in another shape leaves
      // the summary unknown; saved history counts it later.
      const text = v.delta.text ?? v.delta.summary;
      if (typeof text === "string") append(block, "text", text);
      else block.unread = true;
    } else throw new CaptureError("unsupported_schema");
  }
  private ordered(): Block[] {
    return [...this.blocks].sort(([a], [b]) => a - b).map(([, block]) => block);
  }
  private static toolText(block: Block): string {
    block.decoded ??=
      block.json !== ""
        ? streamedToolInput(block.json, block.name)
        : decodedToolInput(block.input, block.name);
    return block.decoded;
  }
  stopped(): void {
    // A stop before provider completion is final; cleanup after completion cannot undo it.
    if (this.state.state === "generating") this.state.state = "cancelled";
  }
  completionVerified(): boolean {
    return this.state.state === "completed";
  }
  snapshot(): Snapshot {
    const blocks = [...this.settled, ...this.ordered()];
    const of = (kind: Kind) => blocks.filter((b) => b.kind === kind);
    const texts = of("text");
    const thinking = of("thinking");
    const field = (kind: Kind, text: (block: Block) => string) => {
      const selected = of(kind);
      return selected.some((block) => block.unread)
        ? undefined
        : selected.map(text).filter(Boolean).join("\n");
    };
    // Fields that do not fit are left out and stay unknown rather than failing the reply.
    const fitted = fitGeneratedText({
      toolInput: field("tool", ClaudeSession.toolText),
      intermediate: field("compaction", (block) => block.text),
      toolOutput: field("result", (block) => block.result),
    });
    return {
      ...this.state,
      text: texts.length
        ? boundedText(texts.map((b) => b.text).join(""))
        : this.state.started
          ? ""
          : null,
      // The whole reply is read, so a reply without thinking blocks shows none.
      thinking: thinking.length
        ? boundedText(
            thinking
              .map((b) => visibleThinking(b.thinking, b.summaries.join("\n")))
              .filter(Boolean)
              .join("\n"),
          )
        : this.state.started
          ? ""
          : null,
      ...(this.state.started ? fitted : {}),
      searchOperations: this.search.size || null,
      limitations: [
        ...this.state.limitations,
        ...(this.unknownEvents ? ["unknown_event_observed"] : []),
        // Research agents work after this stream ends; only their brief is shown here (E1).
        ...(of("tool").some((block) => block.name === RESEARCH_TOOL)
          ? ["research_work_unobserved"]
          : []),
      ],
    };
  }
}
