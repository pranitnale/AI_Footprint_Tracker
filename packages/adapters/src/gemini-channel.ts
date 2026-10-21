/*
 * Gemini's session channel, seen live on 19 Oct 2026 (structure only). A new chat no longer
 * sends StreamGenerate: the page opens a WebChannel session on
 * `geminiweb-pa.clients6.google.com/v1/processSession`, posts base64 protobuf messages to it
 * (`count=N&ofs=K&req0___data__=...`) and reads the reply from a long-poll GET of the same
 * session, framed as `<length>\n[[id,["<base64 protobuf>"]]]\n`.
 *
 * The protobuf messages are the JSON frames StreamGenerate sent, in binary: a field number
 * is the old array position plus one (the reply's ids at field 2, its candidates at field 5,
 * the mode label at field 43; in a candidate the reply id at 1, the answer at 2.1, thoughts
 * at 38). These functions turn the fields the Gemini reader reads back into that JSON
 * layout, so one reader reads both transports. Content in a field whose binary layout was
 * not seen (tool data, documents) is passed on as unreadable, which makes the reply partial
 * and leaves those parts to the saved chat.
 */

/** One field of a protobuf message: a number for varint and fixed fields, else bytes. */
interface ProtoField {
  field: number;
  wire: 0 | 1 | 2 | 5;
  number?: number;
  bytes?: Uint8Array;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** Bounds on one message, so a hostile or broken payload cannot run long. */
const PROTO_BOUNDS = Object.freeze({ fields: 4096, depth: 16 });

/** The fields of one protobuf message, or null when the bytes are not one. */
export function protoFields(bytes: Uint8Array): ProtoField[] | null {
  const fields: ProtoField[] = [];
  let offset = 0;
  const varint = (): number | null => {
    let value = 0,
      scale = 1;
    for (let i = 0; i < 10; i++) {
      if (offset >= bytes.length) return null;
      const byte = bytes[offset++]!;
      value += (byte & 0x7f) * scale;
      if (!(byte & 0x80)) return Number.isSafeInteger(value) ? value : null;
      scale *= 128;
    }
    return null;
  };
  while (offset < bytes.length) {
    if (fields.length >= PROTO_BOUNDS.fields) return null;
    const key = varint();
    if (key === null) return null;
    const field = Math.floor(key / 8),
      wire = key % 8;
    if (field < 1) return null;
    if (wire === 0) {
      const number = varint();
      if (number === null) return null;
      fields.push({ field, wire, number });
    } else if (wire === 1 || wire === 5) {
      const size = wire === 1 ? 8 : 4;
      if (offset + size > bytes.length) return null;
      fields.push({ field, wire, number: 0 });
      offset += size;
    } else if (wire === 2) {
      const length = varint();
      if (length === null || offset + length > bytes.length) return null;
      fields.push({ field, wire, bytes: bytes.subarray(offset, offset + length) });
      offset += length;
    } else return null;
  }
  return fields;
}

const text = (bytes: Uint8Array | undefined): string | null => {
  if (!bytes) return null;
  try {
    return utf8.decode(bytes);
  } catch {
    return null;
  }
};
const all = (fields: ProtoField[], field: number) =>
  fields.filter((item) => item.field === field);
const one = (fields: ProtoField[] | null, field: number) =>
  fields?.find((item) => item.field === field);
const message = (item: ProtoField | undefined) =>
  item?.bytes ? protoFields(item.bytes) : null;

/**
 * Whether a field holds text: a non-empty value that is not a message, or a message with
 * such a value somewhere. Numbers and empty strings are page state, not content, as in the
 * JSON reader.
 */
function content(bytes: Uint8Array, depth = 0): boolean {
  if (!bytes.length) return false;
  const fields = depth < PROTO_BOUNDS.depth ? protoFields(bytes) : null;
  if (!fields) return true;
  return fields.some((item) => !!item.bytes && content(item.bytes, depth + 1));
}

/** An id field; an empty one is absent, as JSON frames sent it. */
const id = (item: ProtoField | undefined) => {
  const value = text(item?.bytes);
  return value ? value : null;
};

/** A value the JSON reader cannot read: the part it stands for stays unknown. */
const UNREAD = "unread";

/**
 * The texts of a text message, whose strings are at field 1 (the JSON layout's
 * `[text, ...]`), or null when it holds anything else.
 */
function texts(bytes: Uint8Array | undefined): string[] | null {
  const fields = bytes ? protoFields(bytes) : null;
  if (!fields || !fields.every((f) => f.field === 1 && f.bytes)) return null;
  const values = fields.map((f) => text(f.bytes));
  return values.every((value) => value !== null) ? (values as string[]) : null;
}

function candidate(item: ProtoField): unknown[] {
  const fields = message(item);
  const value: unknown[] = [];
  if (!fields) return [UNREAD];
  value[0] = id(one(fields, 1));
  // The answer is a text message; anything else in it was not seen.
  const answer = all(fields, 2);
  if (answer.length === 1) value[1] = texts(answer[0]!.bytes) ?? UNREAD;
  else if (answer.length > 1) value[1] = UNREAD;
  const thoughts = all(fields, 38).filter((f) => f.bytes && content(f.bytes));
  if (thoughts.length === 1) {
    // Thoughts are `[[text], sections]` in JSON; only the shown text at field 1 is read,
    // whether it comes as a text message or as plain strings. Without it the reply is
    // partial, as a JSON frame without it was.
    const shown = all(message(thoughts[0]) ?? [], 1).map(
      (f) => texts(f.bytes) ?? (text(f.bytes) === null ? null : [text(f.bytes)!]),
    );
    value[37] = !shown.length
      ? [null]
      : shown.every((part) => part !== null)
        ? [shown.flat()]
        : UNREAD;
  } else if (thoughts.length > 1) value[37] = UNREAD;
  // Tool data and documents with content are not read from this transport.
  for (const [field, index] of [
    [13, 12],
    [31, 30],
  ] as const)
    if (all(fields, field).some((f) => f.bytes && content(f.bytes)))
      value[index] = UNREAD;
  return value;
}

/** One reply frame in StreamGenerate's JSON layout. */
function inner(fields: ProtoField[]): unknown[] {
  const value: unknown[] = [];
  const ids = message(one(fields, 2));
  if (one(fields, 2)) value[1] = ids ? [id(one(ids, 1)), id(one(ids, 2))] : UNREAD;
  const candidates = all(fields, 5);
  if (candidates.length) value[4] = candidates.map(candidate);
  // A job reply names its job at field 7, as JSON frames did at position 6 (G3).
  const job = text(one(message(one(fields, 7)), 1)?.bytes);
  if (job) value[6] = [job];
  const label = text(one(fields, 43)?.bytes);
  if (label !== null) value[42] = label;
  return value;
}

export interface GeminiChannelReply {
  /** The reply frame in StreamGenerate's JSON layout, or null for a frame without one. */
  inner: unknown[] | null;
  /** The provider marked this the reply's last frame. */
  final: boolean;
  /** The turn's own token, which the next send of the chat names (field 26). */
  turnToken: string | null;
}

/** Base64 as the channel sends it; null when it is not. */
export function base64Bytes(
  value: string,
  decode: (value: string) => string = atob,
): Uint8Array | null {
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(value) || value.length % 4 === 1)
    return null;
  try {
    const binary = decode(value.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * The replies one back-channel message carries: `.2.7.1` with the last-frame flag at 1 and
 * the reply frame at 4.4. Null when the message cannot be read at all; an empty list for
 * an acknowledgement.
 */
export function geminiChannelReplies(bytes: Uint8Array): GeminiChannelReply[] | null {
  const top = protoFields(bytes);
  if (!top) return null;
  const replies: GeminiChannelReply[] = [];
  for (const response of all(top, 2)) {
    const fields = message(response);
    if (!fields) return null;
    for (const result of all(fields, 7)) {
      for (const item of all(message(result) ?? [], 1)) {
        const reply = message(item);
        if (!reply) return null;
        const frame = message(one(message(one(reply, 4)), 4));
        replies.push({
          inner: frame ? inner(frame) : null,
          final: one(reply, 1)?.number === 1,
          turnToken: frame ? text(one(frame, 26)?.bytes) || null : null,
        });
      }
    }
  }
  return replies;
}

export type GeminiChannelSend =
  /** The send's setup: the chat it continues and the previous turn's token, when named. */
  | { kind: "setup"; conversationId: string | null; turnToken: string | null }
  | { kind: "prompt"; text: string }
  /** The page closes the session. */
  | { kind: "close" }
  | { kind: "other" };

/**
 * One message the page posts to the session: the setup (field 1, the chat at 1.8.5.1.72.1
 * and the previous turn's token at .8), the prompt (field 2, text at 2.9.1) or the close
 * (field 4). Unreadable messages are null.
 */
export function geminiChannelSend(bytes: Uint8Array): GeminiChannelSend | null {
  const top = protoFields(bytes);
  if (!top) return null;
  const prompt = one(message(one(top, 2)), 9);
  if (prompt) {
    const value = text(one(message(prompt), 1)?.bytes);
    return value === null ? null : { kind: "prompt", text: value };
  }
  const setup = one(top, 1);
  if (setup) {
    const request = message(one(message(one(message(one(message(setup), 8)), 5)), 1));
    const chat = message(one(request, 72));
    const conversationId = id(one(chat, 1));
    return {
      kind: "setup",
      conversationId:
        conversationId && /^c_[0-9a-f]{16}$/.test(conversationId)
          ? conversationId
          : null,
      turnToken: id(one(chat, 8)),
    };
  }
  if (one(top, 4)) return { kind: "close" };
  return { kind: "other" };
}

/**
 * A send in StreamGenerate's request layout (`f.req`), so the Gemini dispatch reader reads
 * it: the prompt, and the chat with the previous reply or, when that reply is unknown, the
 * previous turn's token in the turn's place.
 */
export function geminiChannelRequestBody(
  prompt: string,
  conversationId: string | null,
  parent: string | null,
): string {
  const previous = conversationId
    ? [
        conversationId,
        parent && !parent.startsWith("rc_") ? parent : "",
        parent?.startsWith("rc_") ? parent : "",
      ]
    : null;
  return new URLSearchParams({
    "f.req": JSON.stringify([null, JSON.stringify([[prompt], null, previous])]),
  }).toString();
}

const framed = (rows: unknown[]) => {
  const json = JSON.stringify(rows);
  return `${json.length + 2}\n${json}\n`;
};
/** One reply frame as StreamGenerate framed it: `<length>\n<json>\n`. */
export const geminiStreamFrame = (frame: unknown[]): string =>
  framed([["wrb.fr", null, JSON.stringify(frame)]]);
/** A row the Gemini reader does not know, which leaves the reply partial (D7). */
export const GEMINI_STREAM_UNREAD = framed([["unread"]]);
/** StreamGenerate's response prefix. */
export const GEMINI_STREAM_GUARD = ")]}'\n\n";
