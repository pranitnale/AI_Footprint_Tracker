export type Site =
  "chatgpt" | "claude" | "gemini" | "perplexity" | "notebooklm";
export {
  isTimingEvidence,
  timingEvidence,
  LiveRequestTimer,
  type TimingEvidence,
} from "./timing";
export type CaptureFailure =
  | "malformed_frame"
  | "unsupported_schema"
  | "buffer_overflow"
  | "conflicting_duplicate"
  | "missing_body"
  | "ambiguous_candidate"
  | "capture_interrupted";
export const LIMITS = Object.freeze({
  frame: 1_048_576,
  text: 2_097_152,
  // Bounds recursion over a frame, not its size. A JSON-patch frame sits several levels
  // deeper than the block it patches (Perplexity sends a whole workflow as a root
  // replace), so a nested item must not turn into a failed reply.
  depth: 32,
  items: 4096,
  // Live captures can last up to an hour, so a tab may hold several at once; memory stays
  // bounded by `global`.
  sessions: 8,
  stream: 8_388_608,
  global: 33_554_432,
});

/**
 * How long a live capture may run (W10). It ends after `idleMs` without received data, and
 * at the latest `totalMs` after its request; a sweep checks every `sweepMs`. Replies can
 * think or wait on a research job for minutes without sending text, while a dead stream
 * normally fails with a network error long before the idle limit.
 */
export const CAPTURE_TIMES = Object.freeze({
  idleMs: 300_000,
  totalMs: 3_600_000,
  sweepMs: 30_000,
});

export class CaptureError extends Error {
  constructor(public readonly code: CaptureFailure) {
    super(code);
  }
}

/** Protocol data stays in memory. Reject unsafe keys before applying private patches. */
export function safeJson(text: string): any {
  if (text.length > LIMITS.frame) throw new CaptureError("buffer_overflow");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CaptureError("malformed_frame");
  }
  validateTree(value);
  return value;
}

export function validateTree(value: unknown, depth = 0): void {
  if (depth > LIMITS.depth) throw new CaptureError("buffer_overflow");
  if (value && typeof value === "object") {
    if (Object.keys(value).length > LIMITS.items)
      throw new CaptureError("buffer_overflow");
    for (const [key, child] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(key))
        throw new CaptureError("malformed_frame");
      validateTree(child, depth + 1);
    }
  }
}

/**
 * About how many bytes a parsed JSON value holds in memory: two per UTF-16 code unit of its
 * strings and keys, and a few for every other value. The capture limits use it for what a
 * reader keeps, which a stream that repeats or wraps its content can far exceed.
 */
export function retainedSize(value: unknown, depth = 0): number {
  if (typeof value === "string") return value.length * 2 + 8;
  if (!value || typeof value !== "object" || depth > LIMITS.depth) return 8;
  let size = 16;
  for (const [key, child] of Object.entries(value))
    size += key.length * 2 + retainedSize(child, depth + 1);
  return size;
}

export function boundedText(value: unknown): string {
  if (typeof value !== "string") throw new CaptureError("unsupported_schema");
  if (value.length > LIMITS.text) throw new CaptureError("buffer_overflow");
  return value;
}

export type SseFrame = { event: string; data: string; value: any };
export class SseDecoder {
  private buffer = "";
  private decoder = new TextDecoder("utf-8", { fatal: true });
  constructor(private consume: (frame: SseFrame) => void) {}
  push(bytes: Uint8Array): void {
    try {
      this.pushText(this.decoder.decode(bytes, { stream: true }));
    } catch (error) {
      if (error instanceof CaptureError) throw error;
      throw new CaptureError("malformed_frame");
    }
  }
  pushText(text: string): void {
    for (let offset = 0; offset < text.length; offset += 65536)
      this.consumeText(text.slice(offset, offset + 65536));
  }
  private consumeText(text: string): void {
    this.buffer += text;
    if (this.buffer.length > LIMITS.frame)
      throw new CaptureError("buffer_overflow");
    let separator: RegExpExecArray | null;
    while ((separator = /\r?\n\r?\n/.exec(this.buffer))) {
      const raw = this.buffer.slice(0, separator.index);
      this.buffer = this.buffer.slice(separator.index + separator[0].length);
      let event = "message";
      const data: string[] = [];
      for (const line of raw.split(/\r?\n/)) {
        if (line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const key = colon < 0 ? line : line.slice(0, colon);
        const val = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (key === "event") event = val;
        if (key === "data") data.push(val);
      }
      if (!data.length) continue;
      const joined = data.join("\n");
      this.consume({
        event,
        data: joined,
        value: joined === "[DONE]" ? null : safeJson(joined),
      });
    }
  }
  finish(): void {
    this.pushText(this.decoder.decode());
    if (this.buffer.trim()) throw new CaptureError("capture_interrupted");
  }
}

/**
 * Bounds of a JSON-lines reply stream. Each signed-out ChatGPT line repeats the page's metadata
 * of the whole answer so far (its sources, approved links, rendering program and the text
 * again), so the stream grows with the square of the answer: live on 20 Oct 2026 an answer of
 * about 48,000 characters streamed 27 MB in lines of up to 557 KB. LIMITS.frame and
 * LIMITS.stream would cut such a reply short, so a line may be up to `line` long (30 times the
 * longest seen) and the raw stream up to `stream` (40 times the largest seen). These bound a
 * runaway stream only: every line is read and dropped at once, and what a reader keeps is
 * counted against LIMITS.stream and LIMITS.global as for any reply.
 */
export const JSON_LINE_LIMITS = Object.freeze({
  line: 16_777_216,
  stream: 1_073_741_824,
});

/**
 * One JSON value per line, as signed-out ChatGPT streams a reply
 * (application/vnd.openai.conversation-source+ndjson, seen 20 Oct 2026). Blank lines are
 * skipped. A last line without its newline counts when it is whole JSON; a cut one fails.
 */
export class JsonLinesDecoder {
  private buffer = "";
  private decoder = new TextDecoder("utf-8", { fatal: true });
  constructor(private consume: (value: any) => void) {}
  private parse(line: string): unknown {
    if (line.length > JSON_LINE_LIMITS.line)
      throw new CaptureError("buffer_overflow");
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new CaptureError("malformed_frame");
    }
    validateTree(value);
    return value;
  }
  push(bytes: Uint8Array): void {
    let text: string;
    try {
      text = this.decoder.decode(bytes, { stream: true });
    } catch {
      throw new CaptureError("malformed_frame");
    }
    this.pushText(text);
  }
  pushText(text: string): void {
    for (let offset = 0; offset < text.length; offset += 65536)
      this.consumeText(text.slice(offset, offset + 65536));
  }
  private consumeText(text: string): void {
    // Only the new text can hold a newline, so a long line is not searched again per chunk.
    let from = this.buffer.length;
    this.buffer += text;
    let newline: number;
    while ((newline = this.buffer.indexOf("\n", from)) >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      from = 0;
      if (line.trim()) this.consume(this.parse(line));
    }
    if (this.buffer.length > JSON_LINE_LIMITS.line)
      throw new CaptureError("buffer_overflow");
  }
  finish(): void {
    let rest: string;
    try {
      rest = this.decoder.decode();
    } catch {
      throw new CaptureError("malformed_frame");
    }
    this.pushText(rest);
    const last = this.buffer.trim();
    this.buffer = "";
    if (!last) return;
    let value: unknown;
    try {
      value = JSON.parse(last);
    } catch {
      throw new CaptureError("capture_interrupted");
    }
    validateTree(value);
    this.consume(value);
  }
}

/** Lengths in this observed protocol include boundary LF and use UTF-16 units. */
export class GeminiDecoder {
  private buffer = "";
  private guarded = false;
  private decoder = new TextDecoder("utf-8", { fatal: true });
  constructor(private consume: (value: any) => void) {}
  push(bytes: Uint8Array): void {
    let text: string;
    try {
      text = this.decoder.decode(bytes, { stream: true });
    } catch {
      throw new CaptureError("malformed_frame");
    }
    for (let offset = 0; offset < text.length; offset += 65536) {
      this.buffer += text.slice(offset, offset + 65536);
      this.drain();
    }
  }
  private drain(): void {
    if (this.buffer.length > LIMITS.frame)
      throw new CaptureError("buffer_overflow");
    const guard = ")]}'\n\n";
    if (!this.guarded) {
      if (this.buffer.length < guard.length) return;
      if (!this.buffer.startsWith(guard))
        throw new CaptureError("unsupported_schema");
      this.buffer = this.buffer.slice(guard.length);
      this.guarded = true;
    }
    for (;;) {
      this.buffer = this.buffer.replace(/^[\r\n]+/, "");
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) return;
      const prefix = this.buffer.slice(0, newline);
      const size = Number(prefix);
      if (!/^\d+$/.test(prefix) || !Number.isSafeInteger(size) || size < 2)
        throw new CaptureError("malformed_frame");
      if (size > LIMITS.frame) throw new CaptureError("buffer_overflow");
      if (this.buffer.length < newline + size) return;
      const payload = this.buffer.slice(newline, newline + size);
      if (!payload.endsWith("\n")) throw new CaptureError("malformed_frame");
      this.consume(safeJson(payload));
      this.buffer = this.buffer.slice(newline + size);
    }
  }
  finish(): void {
    this.buffer += this.decoder.decode();
    this.drain();
    if (!this.guarded || this.buffer.trim())
      throw new CaptureError("capture_interrupted");
  }
}

export function patchAt(
  root: any,
  path: unknown,
  operation: unknown,
  value: any,
): any {
  if (!["add", "replace", "append", "remove"].includes(String(operation)))
    throw new CaptureError("unsupported_schema");
  if (path === "") {
    if (operation !== "add" && operation !== "replace")
      throw new CaptureError("unsupported_schema");
    validateTree(value);
    return structuredClone(value);
  }
  if (
    typeof path !== "string" ||
    !path.startsWith("/") ||
    /~(?![01])/.test(path)
  )
    throw new CaptureError("malformed_frame");
  const parts = path
    .slice(1)
    .split("/")
    .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  if (
    parts.length > LIMITS.depth ||
    parts.some((p) => ["__proto__", "constructor", "prototype"].includes(p))
  )
    throw new CaptureError("malformed_frame");
  // The value sits at the path's depth, so the patched tree keeps the frame bounds.
  validateTree(value, parts.length);
  let parent = root;
  for (const key of parts.slice(0, -1)) {
    if (!parent || !Object.hasOwn(parent, key))
      throw new CaptureError("unsupported_schema");
    parent = parent[key];
  }
  const key = parts.at(-1)!;
  if (!parent || typeof parent !== "object")
    throw new CaptureError("unsupported_schema");
  if (operation !== "add" && !Object.hasOwn(parent, key))
    throw new CaptureError("unsupported_schema");
  if (Array.isArray(parent)) {
    if (!/^(0|[1-9]\d*)$/.test(key)) throw new CaptureError("malformed_frame");
    const index = Number(key);
    if (index > parent.length) throw new CaptureError("unsupported_schema");
    if (operation === "add") {
      if (parent.length >= LIMITS.items)
        throw new CaptureError("buffer_overflow");
      parent.splice(index, 0, structuredClone(value));
      return root;
    }
    if (operation === "remove") {
      parent.splice(index, 1);
      return root;
    }
  }
  if (operation === "append") {
    const old = parent[key];
    if (typeof old === "string" && typeof value === "string")
      parent[key] = boundedText(old + value);
    else if (Array.isArray(old) && Array.isArray(value)) {
      if (old.length + value.length > LIMITS.items)
        throw new CaptureError("buffer_overflow");
      parent[key] = old.concat(structuredClone(value));
    } else if (
      old &&
      value &&
      typeof old === "object" &&
      typeof value === "object" &&
      !Array.isArray(old) &&
      !Array.isArray(value)
    ) {
      const merged = { ...old, ...structuredClone(value) };
      if (Object.keys(merged).length > LIMITS.items)
        throw new CaptureError("buffer_overflow");
      parent[key] = merged;
    } else throw new CaptureError("unsupported_schema");
  } else if (operation === "remove") delete parent[key];
  else {
    if (
      !Object.hasOwn(parent, key) &&
      Object.keys(parent).length >= LIMITS.items
    )
      throw new CaptureError("buffer_overflow");
    parent[key] = structuredClone(value);
  }
  return root;
}

export function siteForHost(host: string): Site | null {
  if (host === "chatgpt.com" || host === "chat.openai.com") return "chatgpt";
  if (host === "claude.ai") return "claude";
  if (host === "gemini.google.com") return "gemini";
  if (host === "www.perplexity.ai" || host === "perplexity.ai")
    return "perplexity";
  // notebooklm.google.com only redirects here (1 Oct 2026); no page runs on it.
  if (host === "notebook.google.com") return "notebooklm";
  return null;
}

export {
  parseConversationRoute,
  isRouteConversationId,
  isCoworkSessionId,
  geminiRequestPath,
  GEMINI_STREAM_PATH,
  NOTEBOOKLM_BATCH_PATH,
  isNotebooklmChatPath,
  isProvisionalChatgptRoute,
  isUnsavedChatgptRoute,
  type RouteSite,
} from "./routes";

export {
  isDisplayBinding,
  isConversationIdentity,
  matchesDisplayContext,
  type DisplayBinding,
  type ConversationIdentity,
  type DisplayContext,
} from "./display-binding";
