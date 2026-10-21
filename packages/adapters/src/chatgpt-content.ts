import { streamedToolInput } from "./claude-content";
import { historyModelLabel } from "./history/common";

/*
 * ChatGPT message content shared by the live stream and saved history (W6), so a reply is
 * read by one rule wherever it is seen. Only text and counts are returned; nothing is kept.
 * Message shapes as seen on 9 Sep, 1 Oct and 3 Oct 2026: `thoughts` items with `summary`,
 * `content`, `chunks` and `finished`; `code` messages to tools; `execution_output` and
 * `tether_browsing_display` tool results; voice transcripts as `audio_transcription` parts.
 */

const record = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** A message's parts as text, or undefined when a part is not text. */
function textParts(content: Record<string, any>): string | undefined {
  return Array.isArray(content.parts) &&
    content.parts.every((part: unknown) => typeof part === "string")
    ? (content.parts as string[]).join("")
    : undefined;
}

/**
 * The visible reasoning of a `thoughts` message (A2): each item's heading and text. Chunks
 * are the streamed pieces of the same text and are read only when the text is missing, so
 * nothing counts twice. Undefined when an item has another shape.
 */
function thoughtsText(content: Record<string, any>): string | undefined {
  if (!Array.isArray(content.thoughts)) return undefined;
  const parts: string[] = [];
  for (const item of content.thoughts) {
    if (!record(item)) return undefined;
    const { summary, content: body, chunks } = item;
    if (
      summary !== undefined &&
      summary !== null &&
      typeof summary !== "string"
    )
      return undefined;
    if (body !== undefined && body !== null && typeof body !== "string")
      return undefined;
    if (summary) parts.push(summary);
    if (typeof body === "string") {
      if (body) parts.push(body);
    } else if (chunks !== undefined && chunks !== null) {
      if (
        !Array.isArray(chunks) ||
        !chunks.every((chunk: unknown) => typeof chunk === "string")
      )
        return undefined;
      const joined = chunks.join("");
      if (joined) parts.push(joined);
    }
  }
  return parts.join("\n");
}

/**
 * A voice mode message (A9, G16): the text of its `audio_transcription` parts. Undefined
 * when a part has another shape; null when the message holds no transcript.
 */
export function chatgptTranscript(
  content: unknown,
): { text: string; direction: string | null } | null | undefined {
  if (
    !record(content) ||
    content.content_type !== "multimodal_text" ||
    !Array.isArray(content.parts)
  )
    return null;
  const transcripts = content.parts.filter(
    (part: unknown) =>
      record(part) && part.content_type === "audio_transcription",
  );
  if (!transcripts.length) return null;
  const texts: string[] = [];
  let direction: string | null = null;
  for (const part of content.parts) {
    if (!record(part)) return undefined;
    // Audio pointers carry no text; the page stores no audio for voice mode (G16).
    if (part.content_type === "audio_asset_pointer") continue;
    if (part.content_type !== "audio_transcription") return undefined;
    if (typeof part.text !== "string") return undefined;
    texts.push(part.text);
    if (typeof part.direction === "string") direction = part.direction;
  }
  return { text: texts.join("\n"), direction };
}

/** Sizes of the images a user message uploaded (A7); undefined when a part is unknown. */
export function chatgptUploadedImages(
  content: unknown,
): Array<{ width: number | null; height: number | null }> | undefined {
  if (!record(content)) return undefined;
  if (content.content_type === "text") return [];
  if (
    content.content_type !== "multimodal_text" ||
    !Array.isArray(content.parts)
  )
    return undefined;
  const size = (value: unknown) =>
    Number.isInteger(value) &&
    (value as number) > 0 &&
    (value as number) <= 65536
      ? (value as number)
      : null;
  const images: Array<{ width: number | null; height: number | null }> = [];
  for (const part of content.parts) {
    if (typeof part === "string") continue;
    if (!record(part)) return undefined;
    if (part.content_type === "image_asset_pointer") {
      const width = size(part.width),
        height = size(part.height);
      images.push(
        width !== null && height !== null
          ? { width, height }
          : { width: null, height: null },
      );
    } else if (
      part.content_type !== "audio_transcription" &&
      part.content_type !== "audio_asset_pointer"
    )
      return undefined;
  }
  return images;
}

/** The text a user message carries: its text parts or its voice transcript. */
export function chatgptPromptText(content: unknown): string | null {
  if (!record(content)) return null;
  if (content.content_type === "text") return textParts(content) ?? null;
  if (content.content_type !== "multimodal_text") return null;
  const transcript = chatgptTranscript(content);
  if (transcript === undefined) return null;
  if (transcript) return transcript.text;
  if (!Array.isArray(content.parts)) return null;
  const texts: string[] = [];
  for (const part of content.parts) {
    if (typeof part === "string") texts.push(part);
    else if (!record(part) || part.content_type !== "image_asset_pointer")
      return null;
  }
  return texts.join("\n");
}

/**
 * A tool message of an image job that runs apart from the stream. Since 5 Oct 2026 the live
 * stream of such a turn ends at the job's start with one assistant message, and saved
 * history keeps that message, under the same id, as this tool message. Connector and
 * research calls (`api_tool`) are not image jobs.
 */
export function isChatgptAsyncJob(message: unknown): boolean {
  return (
    record(message) &&
    message.author?.role === "tool" &&
    typeof message.metadata?.async_source === "string" &&
    !String(message.author?.name ?? "").startsWith("api_tool")
  );
}

/** The model that answered: the served slug, else the slug the message names (B0). */
export function chatgptMessageModel(message: unknown): string | null {
  if (!record(message) || !record(message.metadata)) return null;
  return (
    historyModelLabel(message.metadata.resolved_model_slug) ??
    historyModelLabel(message.metadata.model_slug)
  );
}

/**
 * Whether a message is a visible answer: final channel, to everyone. One of a content type
 * not yet seen still ends and names the turn; its text stays unknown.
 */
export function isChatgptFinal(message: unknown): boolean {
  if (!record(message) || message.author?.role !== "assistant") return false;
  const kind = assistantPart(message).kind;
  return (
    kind === "answer" ||
    kind === "unreadable_answer" ||
    kind === "unknown_answer"
  );
}

type Part =
  | { kind: "answer"; text: string; speech: number | null }
  | { kind: "thinking"; text: string }
  | { kind: "intermediate"; text: string }
  | { kind: "toolInput"; text: string }
  | { kind: "ignored" }
  | { kind: "unknown" }
  | { kind: "unreadable_answer" }
  | { kind: "unknown_answer" };

// Content types that carry no text the model wrote for this reply: the "Thought for N s"
// label (not counted, A1) and saved memory or instructions, which are input.
const IGNORED_ASSISTANT = new Set([
  "reasoning_recap",
  "model_editable_context",
  "user_editable_context",
  "system_error",
]);

/** What one assistant message adds to its reply. */
function assistantPart(message: Record<string, any>): Part {
  const content = record(message.content) ? message.content : null;
  const type = content?.content_type;
  if (!content || typeof type !== "string") return { kind: "unknown" };
  if (IGNORED_ASSISTANT.has(type)) return { kind: "ignored" };
  if (type === "thoughts") {
    const text = thoughtsText(content);
    return text === undefined
      ? { kind: "unknown" }
      : { kind: "thinking", text };
  }
  const recipient = message.recipient ?? "all";
  if (typeof recipient !== "string") return { kind: "unknown" };
  if (recipient === "all") {
    if (message.metadata?.is_visually_hidden_from_conversation === true)
      return { kind: "ignored" };
    if (message.channel === "final" || message.channel == null) {
      if (type === "text") {
        const text = textParts(content);
        return text === undefined
          ? { kind: "unreadable_answer" }
          : { kind: "answer", text, speech: null };
      }
      const transcript = chatgptTranscript(content);
      if (transcript && transcript.direction === "out")
        // A voice reply is its transcript; the speech follows the reading rate (EP1).
        return {
          kind: "answer",
          text: transcript.text,
          speech: transcript.text.length,
        };
      // A content type not yet seen on the final channel, or ending the turn, is still the
      // turn's answer: it ends and names the turn while its text stays unknown.
      return message.channel === "final" || message.end_turn === true
        ? { kind: "unknown_answer" }
        : { kind: "unknown" };
    }
    if (message.channel === "commentary" && type === "text") {
      const text = textParts(content);
      return text === undefined
        ? { kind: "unknown" }
        : { kind: "intermediate", text };
    }
    // A message on another channel that ends the turn still ends and names it; its text
    // stays unknown.
    return message.end_turn === true
      ? { kind: "unknown_answer" }
      : { kind: "unknown" };
  }
  // Text addressed to a tool is tool input, except turn plans, which are intermediate (D2).
  const kind = recipient.startsWith("turn_plan.")
    ? "intermediate"
    : "toolInput";
  if (type === "code")
    return typeof content.text === "string"
      ? { kind, text: streamedToolInput(content.text) }
      : { kind: "unknown" };
  if (type === "text") {
    const text = textParts(content);
    return text === undefined ? { kind: "unknown" } : { kind, text };
  }
  return { kind: "unknown" };
}

/**
 * The text of a tool result the page shows in full (A6), or null for any other message.
 * Undefined when a result of a kind the page shows has no readable text.
 */
function toolResult(message: Record<string, any>): string | null | undefined {
  if (message.metadata?.is_visually_hidden_from_conversation === true)
    return null;
  const content = message.content;
  if (!record(content)) return null;
  if (content.content_type === "execution_output")
    return typeof content.text === "string" ? content.text : undefined;
  if (content.content_type === "tether_browsing_display")
    return typeof content.result === "string" ? content.result : undefined;
  return null;
}

export interface ChatgptTurn {
  /** Final answer text, several finals joined; null when the turn has none. */
  answer: string | null;
  /** A final's text could not be read, so the answer is unknown. */
  answerUnreadable: boolean;
  /** A final of a content type not yet seen: the turn ends, but its text is unknown. */
  answerUnknown: boolean;
  thinking: string;
  intermediate: string;
  toolInput: string;
  /** Undefined when a result the page shows could not be read. */
  toolOutput: string | undefined;
  /** Characters of voice replies, read at 17 characters per second (EP1). */
  speechCharacters: number;
  /** An assistant message of an unknown kind was not counted. */
  unknown: boolean;
  /**
   * The id saved history keeps for the reply: the image job that starts the turn, else
   * the turn's first answer message, else its first assistant message that counts. It
   * stays the same while the turn grows, and a turn with one answer keeps that answer's
   * id, as replies saved earlier did.
   */
  attemptId: string | null;
  /**
   * `attemptId` names a message that is neither an image job nor an answer, so the turn's
   * first answer renames the turn once one follows.
   */
  attemptIdProvisional: boolean;
  /** The turn's last final message: the id the next request names as its parent. */
  outputId: string | null;
  model: string | null;
  /** Assistant messages addressed to web search. */
  searches: number;
}

/**
 * One turn's reply from its messages in order: the answer, visible thinking, intermediate
 * text, tool input and the tool results shown in full. Live and saved replies use this, so
 * both count the same text and name the same ids and model.
 */
export function chatgptTurn(messages: readonly unknown[]): ChatgptTurn {
  const pieces = {
    answer: [] as string[],
    thinking: [] as string[],
    intermediate: [] as string[],
    toolInput: [] as string[],
    toolOutput: [] as string[],
  };
  const turn: ChatgptTurn = {
    answer: null,
    answerUnreadable: false,
    answerUnknown: false,
    thinking: "",
    intermediate: "",
    toolInput: "",
    toolOutput: "",
    speechCharacters: 0,
    unknown: false,
    attemptId: null,
    attemptIdProvisional: false,
    outputId: null,
    model: null,
    searches: 0,
  };
  let firstFinalModel: string | null | undefined;
  let firstFinal: string | null = null,
    firstCounted: string | null = null,
    firstJob: string | null = null;
  let lastModel: string | null = null;
  let toolOutputUnread = false;
  for (const message of messages) {
    if (!record(message)) continue;
    const role = message.author?.role;
    if (role === "tool") {
      // The live capture of a turn that starts with an image job sees only the job's
      // message, so the job names the turn whatever follows it.
      if (
        firstCounted === null &&
        typeof message.id === "string" &&
        isChatgptAsyncJob(message)
      )
        firstJob ??= message.id;
      const result = toolResult(message);
      if (result === undefined) {
        turn.unknown = true;
        toolOutputUnread = true;
      } else if (result) pieces.toolOutput.push(result);
      continue;
    }
    if (role !== "assistant") continue;
    const model = chatgptMessageModel(message);
    if (model) lastModel = model;
    if (message.recipient === "web.run") turn.searches++;
    const part = assistantPart(message);
    if (typeof message.id === "string") {
      // Hidden context and labels are not part of the reply, so they never name it.
      if (part.kind !== "ignored") firstCounted ??= message.id;
      if (
        part.kind === "answer" ||
        part.kind === "unreadable_answer" ||
        part.kind === "unknown_answer"
      )
        firstFinal ??= message.id;
    }
    if (part.kind === "unknown") turn.unknown = true;
    else if (part.kind === "unreadable_answer") turn.answerUnreadable = true;
    else if (part.kind === "unknown_answer") {
      // Not counted, yet it is the turn's last answer so far: the next request names it.
      turn.unknown = turn.answerUnknown = true;
      if (typeof message.id === "string") turn.outputId = message.id;
      if (firstFinalModel === undefined) firstFinalModel = model;
    } else if (part.kind === "answer") {
      pieces.answer.push(part.text);
      if (part.speech) turn.speechCharacters += part.speech;
      if (typeof message.id === "string") turn.outputId = message.id;
      if (firstFinalModel === undefined) firstFinalModel = model;
    } else if (part.kind !== "ignored" && part.text)
      pieces[part.kind].push(part.text);
  }
  if (pieces.answer.length) turn.answer = pieces.answer.join("\n");
  turn.thinking = pieces.thinking.join("\n");
  turn.intermediate = pieces.intermediate.join("\n");
  turn.toolInput = pieces.toolInput.join("\n");
  turn.toolOutput = toolOutputUnread ? undefined : pieces.toolOutput.join("\n");
  turn.model = firstFinalModel ?? lastModel;
  turn.attemptId = firstJob ?? firstFinal ?? firstCounted;
  turn.attemptIdProvisional =
    firstJob === null && firstFinal === null && firstCounted !== null;
  return turn;
}
