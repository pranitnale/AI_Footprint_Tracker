import {
  CaptureError,
  boundedText,
  safeJson,
} from "@footprint/capture-core";
import { initialSnapshot, type Dispatch, type ProtocolSession, type Snapshot } from "./types";
import { fitGeneratedText } from "./generated-text";

/*
 * ChatGPT used without an account (seen live 20 Oct 2026 in a signed-out profile) is a page of
 * its own ("unauth-mweb"), with its own requests:
 *
 * - The send is POST /unauth-mweb/conversation/updates with a form body: `prompt`, the page's
 *   chat state (`conversationState`, JSON: `backendConversationId` once the chat exists,
 *   `parentMessageId`, "client-created-root" for a new chat), `userMessageId`,
 *   `imageAttachments` and sentinel tokens. No model is sent and the stream names none; the
 *   page's own telemetry calls it "auto".
 * - The reply is application/vnd.openai.conversation-source+ndjson: one object per line, each
 *   with `version: 1` and a `type`. `control` lines carry `detail.kind` (started,
 *   conversation-id, resume-token, assistant-content-started, terminal-received with
 *   `terminalKind` "complete"); `content` lines carry an answer message's markdown, a first
 *   `replace` at revision 1, then `append` lines that each name the revision they follow
 *   (`baseRevision`), the last one empty with `status: "complete"`; `shared` lines carry page
 *   markup, `state` lines the page's chat state; `end` ends the stream.
 * - Stop is POST /unauth-mweb/stop_conversation with {"conversationId": <chat>}, answered 200
 *   with {}; the page then aborts the reply's body.
 *
 * Since 21 Oct 2026 (live, two replies) every line has `version: 2` and the page's <html>
 * carries data-conversation-stream-protocol="2". The lines seen have the same types, control
 * kinds and content fields as version 1. Since 3 Nov 2026, `markdown` can stay empty while
 * `dil.fallbackMarkdown` carries the whole answer so far. Appends without a fallback keep
 * the last one; replacements without one clear it. The longer of fallback and joined
 * markdown counts once per message. Search status
 * `reasoning`, `turn-latency` and stream types "initial" and "followup" were also seen.
 * Other reasoning shapes, content fields or stream types leave the reply partly measured.
 */
export const CHATGPT_SIGNED_OUT_SEND_PATH = "/unauth-mweb/conversation/updates";
export const CHATGPT_SIGNED_OUT_STOP_PATH = "/unauth-mweb/stop_conversation";

export function isChatgptSignedOutSend(url: URL, method: string): boolean {
  return (
    method.toUpperCase() === "POST" &&
    url.pathname === CHATGPT_SIGNED_OUT_SEND_PATH
  );
}

export function isChatgptSignedOutStop(url: URL, method: string): boolean {
  return (
    method.toUpperCase() === "POST" &&
    url.pathname === CHATGPT_SIGNED_OUT_STOP_PATH
  );
}

/** The chat a signed-out stop request names, or null when the body does not name one. */
export function chatgptSignedOutStopConversation(body: string): string | null {
  try {
    const value = safeJson(body);
    return typeof value?.conversationId === "string" &&
      value.conversationId.length > 0 &&
      value.conversationId.length <= 256
      ? value.conversationId
      : null;
  } catch {
    return null;
  }
}

const id = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 && value.length <= 256
    ? value
    : null;

/** A field of the send form that holds JSON; a missing field is null, a broken one fails. */
function formJson(form: URLSearchParams, name: string): any {
  const raw = form.get(name);
  return raw === null ? null : safeJson(raw);
}

/** The dispatch of a signed-out send, from its form body. */
export function chatgptSignedOutDispatch(body: string, base: Dispatch): Dispatch {
  const form = new URLSearchParams(body);
  const prompt = form.get("prompt");
  const state = formJson(form, "conversationState");
  if (prompt === null || !state || typeof state !== "object" || Array.isArray(state))
    throw new CaptureError("unsupported_schema");
  const images = formJson(form, "imageAttachments");
  const pending = formJson(form, "pendingImageUploads");
  const dispatch: Dispatch = {
    ...base,
    action: "send",
    input: boundedText(prompt),
    conversationId: id(state.backendConversationId),
    parentId: id(state.parentMessageId),
    requestId: id(form.get("userMessageId")),
    // Nothing in the request or the reply names the model (live, 20 Oct 2026).
    model: null,
    attachments: Array.isArray(images) ? images.length : null,
  };
  // An uploaded image's size is not in the form, so only a send without one has known images.
  if (
    Array.isArray(images) &&
    images.length === 0 &&
    (pending === null || (Array.isArray(pending) && pending.length === 0))
  )
    dispatch.inputImages = [];
  return dispatch;
}

/** Control kinds that carry no output. */
const QUIET_CONTROLS: ReadonlySet<string> = new Set([
  "started",
  "conversation-id",
  "resume-token",
  "assistant-content-started",
  "terminal-received",
  "turn-latency",
]);

/** The stream versions this reader knows; another may give the fields other meanings. */
const VERSIONS: ReadonlySet<unknown> = new Set([1, 2]);

/**
 * The fields of a version 2 content line seen live (21 Oct and 3 Nov 2026). Text is in
 * `markdown` or `dil.fallbackMarkdown`; the rest of `dil` is the page's rendering program.
 * `references` can repeat that program with citation markup and is never counted. A field
 * not listed may hold text this reader misses.
 */
const V2_CONTENT_FIELDS: ReadonlySet<string> = new Set([
  "version",
  "type",
  "messageId",
  "revision",
  "mode",
  "baseRevision",
  "markdown",
  "references",
  "dil",
  "approvedUrls",
  "canonicalApprovedUrls",
  "deniedUrls",
  "status",
  "streamingParent",
  "conversationFollowupSuggestionsEligible",
]);

/** The most answer messages one reply may hold. */
const MESSAGES = 256;

/**
 * A `reasoning` line that only shows the web search's progress (live, 20 Oct 2026, two replies
 * with web search): `status` is null or the status the page shows, and `activity.records` are
 * the search's steps ("activity": "Searching the web", then how many sites it read, with the
 * sources' icons) and an empty recap at the end. These are the page's labels of a tool, not
 * model output, so nothing in them is counted. A record of another kind may hold model text,
 * so such a line leaves the reply partly measured.
 */
function searchStatus(line: any): boolean {
  const { status, activity } = line;
  if (status !== null && (typeof status !== "object" || Array.isArray(status))) return false;
  if (
    !activity ||
    typeof activity !== "object" ||
    !Array.isArray(activity.records) ||
    typeof activity.active !== "boolean"
  )
    return false;
  return activity.records.every(
    (record: any) =>
      record &&
      typeof record === "object" &&
      (record.kind === "activity" || record.kind === "recap") &&
      (record.text === undefined || typeof record.text === "string"),
  );
}

export class ChatgptSignedOutSession implements ProtocolSession {
  private state = initialSnapshot();
  /** Each answer message's text so far and the revision it reached, in arrival order. */
  private messages = new Map<
    string,
    { text: string; fallback: string; revision: number; complete: boolean }
  >();
  /** ChatGPT took the turn: its stream started. */
  private accepted = false;
  private terminal: string | null = null;
  private ended = false;
  /** A line or control this reader does not know was not counted (D7). */
  private unknown = false;
  /** The version of the stream's first line; every later line must have the same. */
  private version: 1 | 2 | null = null;

  line(value: unknown): void {
    const v = value as any;
    if (!v || typeof v !== "object" || Array.isArray(v))
      throw new CaptureError("unsupported_schema");
    // Another version may give these fields other meanings, and a stream that changes its
    // version mid-reply was never seen.
    if (!VERSIONS.has(v.version) || (this.version !== null && v.version !== this.version))
      throw new CaptureError("unsupported_schema");
    this.version = v.version;
    switch (v.type) {
      case "control":
        this.control(v.detail);
        return;
      case "content":
        this.content(v);
        return;
      // Page markup and the page's own chat state; neither carries model output.
      case "shared":
      case "state":
        return;
      case "reasoning":
        // The same search status shape was seen on version 2 on 3 Nov 2026.
        if (!searchStatus(v)) this.unknown = true;
        return;
      case "end":
        this.ended = true;
        return;
      default:
        this.unknown = true;
    }
  }

  private control(detail: any): void {
    if (!detail || typeof detail !== "object")
      throw new CaptureError("unsupported_schema");
    const conversation = id(detail.conversationId);
    if (conversation) this.state.conversationId = conversation;
    if (!QUIET_CONTROLS.has(detail.kind)) {
      this.unknown = true;
      return;
    }
    // Follow-ups use "followup" (live, 3 Nov 2026); an unseen stream may repeat or skip text.
    if (
      this.version === 2 &&
      detail.streamType !== "initial" &&
      detail.streamType !== "followup"
    )
      this.unknown = true;
    if (detail.kind === "started") this.accepted = true;
    if (detail.kind === "terminal-received") {
      this.terminal = typeof detail.terminalKind === "string" ? detail.terminalKind : null;
      // Only "complete" was seen; any other end leaves the reply unfinished and says so.
      if (this.terminal !== "complete") this.unknown = true;
    }
  }

  private content(v: any): void {
    const messageId = id(v.messageId);
    if (
      !messageId ||
      typeof v.markdown !== "string" ||
      !Number.isSafeInteger(v.revision)
    )
      throw new CaptureError("unsupported_schema");
    const known = this.messages.get(messageId);
    let text: string;
    if (v.mode === "replace") text = v.markdown;
    // An append continues the revision it names; a gap would lose text, so it fails closed.
    else if (v.mode === "append" && known && v.baseRevision === known.revision)
      text = known.text + v.markdown;
    else throw new CaptureError("unsupported_schema");
    if (!known && this.messages.size >= MESSAGES)
      throw new CaptureError("buffer_overflow");
    // On 3 Nov 2026 only fallbackMarkdown held text, and intermediate and final appends
    // often had no dil. It is cumulative, not another piece to append.
    const fallback =
      this.version === 2 && typeof v.dil?.fallbackMarkdown === "string"
        ? v.dil.fallbackMarkdown
        : v.mode === "replace"
          ? ""
          : (known?.fallback ?? "");
    this.messages.set(messageId, {
      text: boundedText(text),
      fallback: boundedText(fallback),
      revision: v.revision,
      complete: v.status === "complete",
    });
    if (v.status !== "complete" && v.status !== "streaming") this.unknown = true;
    if (this.version === 2 && Object.keys(v).some((key) => !V2_CONTENT_FIELDS.has(key)))
      this.unknown = true;
    this.state.started = true;
  }

  /** Only the answer text is kept; every line's metadata is dropped once read. */
  retainedBytes(): number {
    let characters = 0;
    for (const message of this.messages.values())
      characters += message.text.length + message.fallback.length;
    // A UTF-16 code unit takes two bytes in memory.
    return characters * 2;
  }

  stopped(): void {
    this.state.state = "cancelled";
    // As for a signed-in reply: a turn ChatGPT took and the person stopped ended by their
    // choice, with what was shown until then, even when nothing was written yet.
    if (this.accepted) this.state.started = true;
  }

  completionVerified(): boolean {
    return this.snapshot().state === "completed";
  }

  snapshot(): Snapshot {
    const messages = [...this.messages.entries()];
    const finished =
      this.terminal === "complete" &&
      messages.every(([, message]) => message.complete);
    const state =
      this.state.state === "cancelled"
        ? "cancelled"
        : finished
          ? "completed"
          : this.state.state;
    const started = this.state.started || finished;
    const answer = messages
      .map(([, message]) =>
        message.fallback.length > message.text.length ? message.fallback : message.text,
      )
      .join("\n\n");
    // Empty messages add separators, but no answer (3 Nov 2026: completed replies showed Out 0).
    const emptyCompletedAnswer =
      finished && messages.every(([, message]) => !message.text && !message.fallback);
    return {
      ...this.state,
      state,
      started,
      text: started ? boundedText(answer) : null,
      // The stream shows no thinking or tool work; every line was read, so they are zero.
      thinking: started ? "" : null,
      ...(started
        ? fitGeneratedText({ toolInput: "", intermediate: "", toolOutput: "" })
        : {}),
      outputId: messages.at(-1)?.[0] ?? null,
      // The first answer message names the turn; it stays the same while the turn grows.
      attemptId: messages[0]?.[0] ?? null,
      model: null,
      limitations: [
        ...this.state.limitations,
        ...(this.unknown || (this.ended && !this.terminal) || emptyCompletedAnswer
          ? ["unknown_event_observed"]
          : []),
      ],
    };
  }
}
