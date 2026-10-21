import {
  boundedText,
  isNotebooklmChatPath,
  LIMITS,
  NOTEBOOKLM_BATCH_PATH,
  parseConversationRoute,
  safeJson,
} from "@footprint/capture-core";
import {
  initialSnapshot,
  type Dispatch,
  type ProtocolSession,
  type Snapshot,
} from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Batch envelope rows around the reply rows; they carry no reply content.
const ENVELOPE_ROWS: ReadonlySet<unknown> = new Set(["di", "af.httprm", "e"]);
// The answer row marks its kind at [4][4]: 1 an answer, 2 a thought (W9, from public
// reverse-engineering notes; only answers were seen on 1 and 3 Oct 2026).
const ANSWER = 1;
const THOUGHT = 2;
/** Most follow-up questions a reply may carry; three were always seen. */
const SUGGESTIONS = 8;
/** Most guide questions read; three were always seen. */
const GUIDE_QUESTIONS = 16;
const bounded = (text: string | null) =>
  text !== null && text.length <= LIMITS.text ? text : null;

/** The notebook guide call the page makes when a source is added or a notebook opens. */
export const NOTEBOOKLM_GUIDE_RPC = "VfAZjd";
/** Whether a NotebookLM batch request runs only the notebook guide RPC. */
export function isNotebooklmGuide(url: URL): boolean {
  const rpcs = url.searchParams.getAll("rpcids");
  return (
    url.pathname === NOTEBOOKLM_BATCH_PATH &&
    rpcs.length === 1 &&
    rpcs[0] === NOTEBOOKLM_GUIDE_RPC
  );
}

export function notebooklmGenerationRoute(url: URL): boolean {
  return isNotebooklmChatPath(url.pathname) || isNotebooklmGuide(url);
}

/**
 * A NotebookLM send. The chat body is `f.req=[null, params]` with the question at
 * params[1] (public notes, matching the observed body sizes). A body of another shape
 * leaves the question unknown instead of losing the reply. The body names only the chat
 * session, so the capture takes the notebook from the page's route. A guide is started
 * by the page itself: it has no prompt and is not a request the user sent.
 */
export function notebooklmDispatch(url: URL, body: string, base: Dispatch) {
  base.attachments = 0;
  base.inputImages = [];
  if (isNotebooklmGuide(url)) {
    base.action = "notebook_guide";
    base.input = "";
    // All guide calls of a notebook are one request, named before the reply arrives, so a
    // later read of a saved guide joins the first one wherever it is synced (5 Oct 2026).
    const notebook = sourceNotebook(url);
    if (notebook !== null) base.requestId = guideId(notebook);
    return base;
  }
  base.input = null;
  try {
    const encoded = new URLSearchParams(body).getAll("f.req");
    if (encoded.length !== 1) return base;
    const outer = safeJson(encoded[0]!);
    if (!Array.isArray(outer) || typeof outer[1] !== "string") return base;
    const params = safeJson(outer[1]);
    if (Array.isArray(params) && typeof params[1] === "string")
      base.input = boundedText(params[1]);
  } catch {
    // An unreadable body keeps the question unknown; the reply is still read.
  }
  return base;
}

/**
 * A reply's follow-up questions as a plain list of strings: undefined when the reply has
 * none, null when the list has a shape not seen. Live and saved replies read it alike.
 */
export function notebooklmSuggestions(
  plain: unknown,
): string[] | null | undefined {
  if (plain === undefined || plain === null) return undefined;
  return Array.isArray(plain) &&
    plain.length <= SUGGESTIONS &&
    plain.every((item) => typeof item === "string")
    ? (plain as string[])
    : null;
}

function readRows(value: unknown, frame: (row: unknown[]) => void): boolean {
  if (!Array.isArray(value)) return false;
  let known = true;
  for (const row of value) {
    if (!Array.isArray(row)) known = false;
    else if (row[0] === "wrb.fr") frame(row);
    else if (!ENVELOPE_ROWS.has(row[0])) known = false;
  }
  return known;
}

function payload(row: unknown[]): unknown {
  if (typeof row[2] !== "string") throw new Error("frame");
  return safeJson(row[2]);
}

/**
 * One NotebookLM chat reply (W9). Frames are cumulative; the last one is marked final and
 * carries the follow-up questions. Passages quoted from the sources are not read (A6).
 */
export class NotebooklmChatSession implements ProtocolSession {
  private state = initialSnapshot();
  private answer: string | null = null;
  private thought: string | null = null;
  private suggestions: string[] | null = null;
  private session: string | null = null;
  private turn: string | null = null;
  private final = false;
  /** A frame or field was not read: the reply is partial (D7). */
  private unknown = false;
  gemini(value: unknown): void {
    if (!readRows(value, (row) => this.readFrame(row))) this.unknown = true;
  }
  private readFrame(row: unknown[]): void {
    let inner: unknown;
    try {
      inner = payload(row);
    } catch {
      this.unknown = true;
      return;
    }
    // A frame after the final one is not part of this reply as seen.
    if (this.final || !Array.isArray(inner) || !Array.isArray(inner[0])) {
      this.unknown = true;
      return;
    }
    const answer = inner[0] as unknown[];
    const ids = answer[2];
    if (
      !Array.isArray(ids) ||
      typeof ids[0] !== "string" ||
      !UUID.test(ids[0]) ||
      typeof ids[1] !== "string" ||
      !UUID.test(ids[1]) ||
      (this.session !== null && this.session !== ids[0]) ||
      (this.turn !== null && this.turn !== ids[1])
    )
      this.unknown = true;
    else {
      this.session = ids[0];
      this.turn = ids[1];
    }
    const kind = Array.isArray(answer[4]) ? answer[4][4] : undefined;
    const text = answer[0];
    if (typeof text !== "string" || (kind !== ANSWER && kind !== THOUGHT))
      this.unknown = true;
    else if (kind === ANSWER) {
      // Frames carry the whole answer so far; one that does not extend the earlier answer
      // is a shape not seen, so the reply is partial (W9 review).
      if (this.answer !== null && !text.startsWith(this.answer))
        this.unknown = true;
      this.answer = text;
    } else {
      // Thoughts are read as cumulative text, like the answer.
      if (this.thought !== null && !text.startsWith(this.thought))
        this.unknown = true;
      this.thought = text;
    }
    this.state.started = true;
    if (inner[4] === true) {
      // The final frame ends the reply; a final frame without an answer is a shape not
      // seen, so the reply is partial rather than lost.
      this.final = true;
      this.suggestions = this.readSuggestions(inner);
      this.state.state = "completed";
      if (this.answer === null) this.unknown = true;
    } else if (
      inner[4] !== false &&
      inner[4] !== null &&
      inner[4] !== undefined
    )
      this.unknown = true;
  }
  /**
   * The follow-up questions of the final frame. Both of its lists named the same ones on
   * every reply seen; a missing, unreadable or differing list is a shape not seen, so the
   * reply is partial (W9 review).
   */
  private readSuggestions(inner: unknown[]): string[] | null {
    const rows = Array.isArray(inner[5]) ? inner[5][0] : undefined;
    const plain = Array.isArray(inner[3]) ? inner[3][0] : undefined;
    const fromRows =
      rows === undefined || rows === null
        ? undefined
        : Array.isArray(rows) &&
            rows.length <= SUGGESTIONS &&
            rows.every(
              (item) => Array.isArray(item) && typeof item[0] === "string",
            )
          ? rows.map((item) => item[0] as string)
          : null;
    const fromPlain = notebooklmSuggestions(plain);
    if (
      fromRows === null ||
      fromPlain === null ||
      (fromRows === undefined && fromPlain === undefined)
    ) {
      this.unknown = true;
      return null;
    }
    if (
      fromRows &&
      fromPlain &&
      (fromRows.length !== fromPlain.length ||
        fromRows.some((question, index) => question !== fromPlain[index]))
    )
      this.unknown = true;
    return fromRows ?? fromPlain!;
  }
  /**
   * The request ended normally. Only the final frame completes a reply; one that ended
   * before it was stopped, so the text received counts and the follow-ups stay unknown.
   */
  responseEnded(): void {
    if (this.state.state === "generating" && this.state.started)
      this.state.state = "cancelled";
  }
  stopped(): void {
    if (this.state.state === "generating") this.state.state = "cancelled";
  }
  completionVerified(): boolean {
    return this.state.state === "completed";
  }
  snapshot(): Snapshot {
    let unknown = this.unknown;
    const snapshot: Snapshot = {
      ...this.state,
      outputId: this.turn,
      limitations: [...this.state.limitations],
    };
    snapshot.text = bounded(this.answer);
    // The 1 Oct and 3 Oct replies showed no thoughts: none read means none shown.
    snapshot.thinking = this.thought === null ? "" : bounded(this.thought);
    if (
      (this.answer !== null && snapshot.text === null) ||
      (this.thought !== null && snapshot.thinking === null)
    )
      unknown = true;
    // Until the final frame the follow-up questions are not known.
    const intermediate =
      this.final && this.suggestions !== null
        ? this.suggestions.join("\n")
        : null;
    if (intermediate !== null && intermediate.length <= LIMITS.text)
      snapshot.intermediate = intermediate;
    else if (this.final) unknown = true;
    // Only the final frame's answer is the text the notebook saves.
    if (this.final && this.session !== null && snapshot.text !== null)
      snapshot.contentId = notebooklmReplyId(this.session, snapshot.text);
    if (!unknown) {
      snapshot.toolInput = "";
      snapshot.toolOutput = "";
    }
    if (unknown) snapshot.limitations.push("unknown_event_observed");
    return snapshot;
  }
}

/**
 * A notebook guide (W9): a summary and suggested questions with their prompts, all
 * model-written, counted as intermediate output (D2). The page asks for one twice when a
 * source is added, each time with new text (1 Oct). Since 5 Oct it also asks the first time
 * a notebook opens in a page, and that call returns the saved guide unchanged. A reply is
 * named by its notebook and text, so a saved guide read again is the same reply and counts
 * once, while a guide with new text is another reply.
 */
export class NotebooklmGuideSession implements ProtocolSession {
  private state = initialSnapshot();
  private text: string | null = null;
  private unknown = false;
  private readonly notebook: string | null;
  constructor(url?: URL) {
    this.notebook = url ? sourceNotebook(url) : null;
  }
  gemini(value: unknown): void {
    const known = readRows(value, (row) => {
      if (row[1] !== NOTEBOOKLM_GUIDE_RPC || this.text !== null) {
        this.unknown = true;
        return;
      }
      try {
        this.read(payload(row));
      } catch {
        this.unknown = true;
      }
    });
    if (!known) this.unknown = true;
  }
  private read(value: unknown): void {
    if (!Array.isArray(value)) throw new Error("guide");
    // The id after the guide changes with every call, even for an unchanged guide (5 Oct
    // 2026): it names neither the notebook nor the guide, so it is never an identity.
    if (typeof value[1] !== "string" || !UUID.test(value[1]))
      this.unknown = true;
    const guide = value[0];
    const parts: string[] = [];
    if (guide !== null && guide !== undefined) {
      if (!Array.isArray(guide)) throw new Error("guide");
      const summary = guide[0];
      if (Array.isArray(summary)) {
        for (const item of summary)
          if (typeof item === "string") parts.push(item);
          else if (item !== null) this.unknown = true;
      } else if (summary !== null && summary !== undefined) this.unknown = true;
      const questions = Array.isArray(guide[1]) ? guide[1][0] : guide[1];
      if (Array.isArray(questions) && questions.length <= GUIDE_QUESTIONS) {
        for (const pair of questions) {
          // Each suggestion is a short question and the longer prompt it sends. Another
          // shape counts those two and leaves the guide partial (W9 review).
          if (!Array.isArray(pair)) {
            this.unknown = true;
            continue;
          }
          if (pair.length !== 2) this.unknown = true;
          for (const item of pair.slice(0, 2))
            if (typeof item === "string") parts.push(item);
            else if (item !== null) this.unknown = true;
        }
      } else if (questions !== null && questions !== undefined)
        this.unknown = true;
    }
    this.text = parts.join("\n");
    this.state.started = true;
  }
  /** The batch request ended normally: the guide was read in full or not at all. */
  responseEnded(): void {
    if (this.state.state === "generating" && this.text !== null)
      this.state.state = "completed";
  }
  stopped(): void {
    if (this.state.state === "generating") this.state.state = "cancelled";
  }
  completionVerified(): boolean {
    return this.state.state === "completed";
  }
  snapshot(): Snapshot {
    let unknown = this.unknown;
    const snapshot: Snapshot = {
      ...this.state,
      limitations: [...this.state.limitations],
    };
    if (this.text !== null) {
      snapshot.text = "";
      snapshot.thinking = "";
      if (this.text.length <= LIMITS.text) {
        snapshot.intermediate = this.text;
        if (!unknown) {
          snapshot.toolInput = "";
          snapshot.toolOutput = "";
        }
      } else unknown = true;
      if (this.notebook !== null)
        snapshot.attemptId = guideId(this.notebook, this.text);
    }
    if (unknown) snapshot.limitations.push("unknown_event_observed");
    return snapshot;
  }
}

/** The notebook a batch request names as the page it was sent from (`source-path`). */
function sourceNotebook(url: URL): string | null {
  const paths = url.searchParams.getAll("source-path");
  return paths.length === 1
    ? (parseConversationRoute("notebooklm", paths[0]!)?.conversationId ?? null)
    : null;
}

/**
 * The id of a notebook's guide request, or of one guide text in it, in the form the
 * bridge accepts. A fast 64-bit digest is enough: the extension keys the id again before
 * saving it, and two different guides share one only by a one in 2^64 chance.
 */
function guideId(notebook: string, text?: string): string {
  return "g_" + digest(text === undefined ? notebook : notebook + "\n" + text);
}

/**
 * The id that links a chat reply recorded live to its saved copy: a digest of the chat
 * session and the final answer text. Seen live on 16 Oct 2026: the saved answer keeps
 * neither the turn id the stream named nor its number, only the session id, and its text
 * is the live final text byte for byte. The question is left out because the live reply
 * never sees it. Two replies of one session with the same answer share the id; the
 * extension links them in order, one saved answer to one live reply. The extension keys
 * the id again before saving it.
 */
export function notebooklmReplyId(session: string, answer: string): string {
  return "n_" + digest(session + "\n" + answer);
}

/** A fast 64-bit digest as 16 hex digits; never stored without being keyed again. */
function digest(value: string): string {
  let h1 = 0xdeadbeef ^ value.length;
  let h2 = 0x41c6ce57 ^ value.length;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return hex(h2) + hex(h1);
}
