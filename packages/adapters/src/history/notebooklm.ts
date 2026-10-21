import { timingEvidence } from "@footprint/capture-core";
import {
  boundedText,
  finishHistoryPage,
  historyMessage,
  historyPage,
} from "./common";
import { notebooklmReplyId, notebooklmSuggestions } from "../notebooklm";
import {
  HISTORY_LIMITS,
  type HistoryTextMessage,
  type HistoryTextPage,
} from "./types";
import { geminiField, geminiTime } from "../gemini-content";
import { GENERATED_TEXT_LIMITS } from "../generated-text";
import type { GeneratedMedia } from "../types";

/** The notebook's Studio list, which the page loads when a notebook opens and polls. */
export const NOTEBOOKLM_STUDIO_RPC = "gArtLc";
/** One Studio item, which the page loads when the user opens it. */
export const NOTEBOOKLM_ITEM_RPC = "v9rmvd";
/**
 * The notebook's chat sessions. The page lists them the first time a notebook opens in a
 * document, before it reads the turns (14 Oct 2026).
 */
export const NOTEBOOKLM_SESSIONS_RPC = "hPTbtc";
/**
 * One page of a chat session's saved turns, newest first: the newest page when a notebook
 * opens, and older pages when the user scrolls up the chat (14 Oct 2026).
 */
export const NOTEBOOKLM_CHAT_RPC = "khqZz";
export type NotebooklmHistoryRead = {
  rpc:
    | typeof NOTEBOOKLM_STUDIO_RPC
    | typeof NOTEBOOKLM_ITEM_RPC
    | typeof NOTEBOOKLM_CHAT_RPC;
  value: unknown;
  /** The chat session a page of turns belongs to, as its request names it. */
  session?: string | null;
  /** The notebook's chat sessions as the page listed them; null or absent when not seen. */
  sessions?: readonly string[] | null;
};

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Notebook, Studio item, session and turn ids are lowercase UUIDs; their version is not fixed. */
export const notebooklmId = (value: unknown): value is string =>
  typeof value === "string" && ID.test(value);

// Studio item types, from the page's create requests (1 Oct 2026).
const AUDIO = 1;
const VIDEO = 3;
/** Flashcards, quizzes and mind maps: their content loads only when the user opens them. */
const OPENED = 4;
/** Kinds of opened item, at `[9][1][0]`: flashcards 1, quiz 2, mind map 4 (1 Oct 2026). */
const OPENED_KINDS: ReadonlySet<unknown> = new Set([1, 2, 4]);
const INFOGRAPHIC = 7;
const SLIDES = 8;
const TABLE = 9;
const REPORT = 11;
const TYPES: ReadonlySet<unknown> = new Set([
  AUDIO,
  VIDEO,
  OPENED,
  INFOGRAPHIC,
  SLIDES,
  TABLE,
  REPORT,
]);
const GENERATING = 2;
const READY = 3;
/** Most strings read from one item; a larger item is a shape not seen. */
const STRINGS = 8192;
/** The Studio item model behind generated images (D1). */
const IMAGE_MODEL = "notebooklm-image";

const HISTORY_RPCS: ReadonlySet<unknown> = new Set([
  NOTEBOOKLM_STUDIO_RPC,
  NOTEBOOKLM_ITEM_RPC,
  NOTEBOOKLM_CHAT_RPC,
]);

/** The one reply row of a batch response; the response holds no other reply. */
export function notebooklmHistoryFrames(body: string): NotebooklmHistoryRead {
  return batchFrame(body, HISTORY_RPCS) as NotebooklmHistoryRead;
}

/**
 * The chat session ids a session list names, or null for a list of a shape not seen. Each
 * row is `[sessionId, [sec, nanos], [sec, nanos]]`; a notebook without a chat may send no
 * list at all, since Google drops empty trailing fields.
 */
export function notebooklmChatSessions(body: string): string[] | null {
  try {
    const { value } = batchFrame(body, new Set([NOTEBOOKLM_SESSIONS_RPC]));
    if (!Array.isArray(value)) return null;
    const rows = geminiField(value, 0);
    if (rows === null || rows === undefined) return [];
    if (!Array.isArray(rows) || rows.length > 64) return null;
    const ids: string[] = [];
    for (const row of rows) {
      const id = geminiField(row, 0);
      if (!notebooklmId(id) || ids.includes(id)) return null;
      ids.push(id);
    }
    return ids;
  } catch {
    return null;
  }
}

function batchFrame(
  body: string,
  rpcs: ReadonlySet<unknown>,
): { rpc: string; value: unknown } {
  if (!body.startsWith(")]}'")) throw new Error("history_unsupported");
  const lines = body.slice(4).split(/\r?\n/);
  let read: { rpc: string; value: unknown } | null = null;
  for (let index = 0; index < lines.length;) {
    if (lines[index] === "") {
      index++;
      continue;
    }
    const size = lines[index++],
      line = lines[index++];
    if (
      !size ||
      !/^[1-9][0-9]*$/.test(size) ||
      line === undefined ||
      Number(size) !== line.length + 2
    )
      throw new Error("history_unsupported");
    const rows = JSON.parse(line);
    if (!Array.isArray(rows)) throw new Error("history_unsupported");
    for (const row of rows)
      if (Array.isArray(row) && row[0] === "wrb.fr") {
        if (read || !rpcs.has(row[1]) || typeof row[2] !== "string")
          throw new Error("history_unsupported");
        read = { rpc: row[1] as string, value: JSON.parse(row[2]) };
      }
  }
  if (!read) throw new Error("history_unsupported");
  return read;
}

/** A stored `[seconds, nanoseconds]` as an instant, kept to the microsecond. */
function instant(pair: [number, number] | null): string | null {
  if (!pair || pair[0] > 253402300799) return null;
  return (
    new Date(pair[0] * 1000).toISOString().slice(0, 19) +
    "." +
    String(Math.floor(pair[1] / 1000)).padStart(6, "0") +
    "Z"
  );
}

const link = /^(?:https?:|data:)/i;
/**
 * Strings of a Google array in reading order. Ids and links are not text, and values in
 * objects are numbered formatting fields, not text.
 */
function arrayStrings(value: unknown, out: string[], depth = 0): boolean {
  if (depth > 32 || out.length > STRINGS) return false;
  if (typeof value === "string") {
    if (!notebooklmId(value) && !link.test(value)) out.push(value);
    return true;
  }
  return Array.isArray(value)
    ? value.every((item) => arrayStrings(item, out, depth + 1))
    : true;
}
/** String values of the JSON an opened item carries; keys are names, not text. */
function jsonStrings(value: unknown, out: string[], depth = 0): boolean {
  if (depth > 32 || out.length > STRINGS) return false;
  if (typeof value === "string") {
    if (!notebooklmId(value) && !link.test(value)) out.push(value);
    return true;
  }
  if (Array.isArray(value))
    return value.every((item) => jsonStrings(item, out, depth + 1));
  return value !== null && typeof value === "object"
    ? Object.values(value).every((item) => jsonStrings(item, out, depth + 1))
    : true;
}
const units = (parts: readonly string[]) =>
  parts.reduce((sum, part) => sum + part.length, 0);
const points = (parts: readonly string[]) =>
  parts.reduce((sum, part) => sum + [...part].length, 0);

/**
 * A report's or table's text (3 Oct): blocks that each name the range of the document's
 * text they hold. A block whose strings do not fill its range has a layout not seen, so
 * the reply is read in part. Blocks without a range are counted as they are.
 */
function documentText(field: unknown): { text: string; known: boolean } | null {
  const blocks = geminiField(geminiField(geminiField(field, 0), 0), 0);
  if (!Array.isArray(blocks) || !blocks.length) return null;
  const parts: string[] = [];
  let known = true;
  for (const block of blocks) {
    if (!Array.isArray(block)) return null;
    const start = block[0],
      end = block[1];
    const own: string[] = [];
    if (!arrayStrings(block, own)) return null;
    parts.push(...own);
    if (start === null && end === null) continue;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      (start as number) < 0 ||
      (end as number) < (start as number)
    )
      return null;
    const length = (end as number) - (start as number);
    // The page may count its ranges in UTF-16 units or in characters.
    if (units(own) !== length && points(own) !== length) known = false;
  }
  return { text: parts.join("\n"), known };
}

/** A stored image `[url, width, height]`; a size that cannot be read stays unknown. */
function image(
  value: unknown,
): { width: number | null; height: number | null } | null {
  if (!Array.isArray(value) || typeof value[0] !== "string") return null;
  const size = (n: unknown) =>
    Number.isInteger(n) && (n as number) > 0 && (n as number) <= 65536;
  return size(value[1]) && size(value[2])
    ? { width: value[1] as number, height: value[2] as number }
    : { width: null, height: null };
}
/** Images grouped by size, each group one media item (D1). */
function imageMedia(
  images: ReadonlyArray<{ width: number | null; height: number | null }>,
): GeneratedMedia[] {
  const groups = new Map<string, GeneratedMedia & { kind: "image" }>();
  for (const item of images) {
    const key = `${item.width}x${item.height}`;
    const group = groups.get(key);
    if (group) group.count++;
    else
      groups.set(key, {
        kind: "image",
        count: 1,
        width: item.width,
        height: item.height,
        model: IMAGE_MODEL,
        outcome: "returned",
      });
  }
  return [...groups.values()];
}

/**
 * Panels or slides: text after the image of each, and the image with its size. An
 * infographic panel starts with the item's title, which the user can rename, so it is
 * not counted; a slide starts with its image.
 */
function panels(
  list: unknown,
  imageAt: number,
  textFrom: number,
): { parts: string[]; media: GeneratedMedia[]; known: boolean } | null {
  if (!Array.isArray(list) || !list.length || list.length > 256) return null;
  const parts: string[] = [];
  const images: Array<{ width: number | null; height: number | null }> = [];
  let known = true;
  for (const panel of list) {
    if (!Array.isArray(panel)) return null;
    const picture = image(panel[imageAt]);
    if (picture) images.push(picture);
    else known = false;
    for (const item of panel.slice(textFrom))
      if (typeof item === "string") {
        if (!link.test(item)) parts.push(item);
      } else if (item !== null && item !== undefined) known = false;
  }
  const media = imageMedia(images);
  if (media.some((item) => item.kind === "image" && item.count > 100))
    return null;
  return { parts, media, known };
}

/** A stored media length `[seconds, nanoseconds]` in seconds. */
function length(value: unknown): number | null {
  const pair = geminiTime(value);
  if (!pair) return null;
  const seconds = pair[0] + pair[1] / 1e9;
  return seconds > 0 && seconds <= GENERATED_TEXT_LIMITS.seconds
    ? seconds
    : null;
}

/** What a ready item holds, by type; unknown parts leave the reply partial. */
function readContent(
  row: unknown[],
  type: number,
  response: HistoryTextMessage,
): boolean {
  const text = (value: string) => {
    if (value.length > HISTORY_LIMITS.messageUnits) return false;
    response.text = value;
    return true;
  };
  if (type === REPORT || type === TABLE) {
    const document = documentText(geminiField(row, type === REPORT ? 34 : 18));
    return !!document && text(document.text) && document.known;
  }
  if (type === INFOGRAPHIC || type === SLIDES) {
    const read =
      type === INFOGRAPHIC
        ? panels(geminiField(geminiField(row, 14), 2), 1, 2)
        : panels(geminiField(geminiField(row, 16), 2), 0, 1);
    if (!read) return false;
    response.media = read.media;
    return text(read.parts.join("\n")) && read.known;
  }
  if (type === AUDIO || type === VIDEO) {
    // The scripts behind Audio and Video Overviews are not shown (D6): their text is none.
    response.text = "";
    const seconds = length(
      geminiField(
        geminiField(row, type === AUDIO ? 6 : 8),
        type === AUDIO ? 6 : 5,
      ),
    );
    if (seconds === null) return false;
    response.media = [
      type === AUDIO
        ? {
            kind: "speech",
            basis: "stored_length",
            seconds,
            characters: null,
          }
        : { kind: "video_overview", durationSeconds: seconds },
    ];
    return true;
  }
  // An opened flashcard set, quiz or mind map keeps its content as JSON (1 Oct: a quiz's
  // questions, options, rationales and hints). The page around it is not counted. Another
  // kind of opened item is a shape not seen, so its reply stays unread (W9 review).
  const opened = geminiField(row, 9);
  if (!OPENED_KINDS.has(geminiField(geminiField(opened, 1), 0))) return false;
  const data = geminiField(opened, 3);
  if (typeof data !== "string") return false;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return false;
  }
  const parts: string[] = [];
  return (
    value !== null &&
    typeof value === "object" &&
    jsonStrings(value, parts) &&
    parts.length > 0 &&
    text(parts.join("\n"))
  );
}

/**
 * One Studio item as a request and, once ready, its reply (W9). The request counts when the
 * list first shows the item; its own text (custom instructions) is not shown, so it is read
 * in part at zero. Both are dated when the item was created, and the reply is timed from
 * then to its finish. No live capture ever sees these requests, so their saved rows never
 * wait for one (`no_live_request`). The list carries every type's content except
 * flashcards, quizzes and mind maps, which only an opened item carries; each reply is read
 * from one of the two reads only, so they never disagree.
 */
function readItem(row: unknown, opened: boolean): HistoryTextMessage[] {
  if (!Array.isArray(row)) throw new Error("history_unsupported");
  const id = geminiField(row, 0);
  if (!notebooklmId(id)) throw new Error("history_unsupported");
  const type = geminiField(row, 2);
  const status = geminiField(row, 4);
  const created = geminiTime(geminiField(row, 15));
  const occurredAt = instant(created);
  const prompt = historyMessage(id, "prompt");
  prompt.text = "";
  prompt.occurredAt = occurredAt;
  prompt.dateBasis = occurredAt ? "entry_created" : "unknown";
  prompt.coverageReasons = ["no_live_request"];
  if (status === GENERATING) return [prompt];
  const known = TYPES.has(type);
  // A reply comes from the read that carries its content: the opened item for type 4,
  // the list for every other type, and the list for a type or status not seen.
  if (known && (type === OPENED) !== opened) return [prompt];
  if (!known && opened) return [prompt];
  const response = historyMessage(id, "response");
  response.promptSourceId = id;
  response.parentSourceId = id;
  response.parentRole = "prompt";
  response.occurredAt = occurredAt;
  response.dateBasis = prompt.dateBasis;
  // A status or type not seen keeps the request and leaves the reply unread (D7).
  let read =
    known && status === READY && readContent(row, type as number, response);
  if (response.media && response.media.length > GENERATED_TEXT_LIMITS.media) {
    response.media = response.media.slice(0, GENERATED_TEXT_LIMITS.media);
    read = false;
  }
  // Text that was read counts even when another part of the item was not.
  response.complete = response.text !== null;
  response.coverageReasons = read
    ? ["no_live_request"]
    : ["no_live_request", "unknown_event_observed"];
  if (status === READY) {
    const finished = geminiTime(geminiField(row, 10));
    const seconds =
      created && finished
        ? finished[0] - created[0] + (finished[1] - created[1]) / 1e9
        : null;
    if (seconds !== null && seconds > 0)
      response.timing = timingEvidence(
        seconds,
        "notebooklm_history",
        response.complete ? "complete_for_scope" : "partial",
      );
  }
  return [prompt, response];
}

/** A saved turn's role at `[2]`: the user's question or the notebook's answer (14 Oct 2026). */
const QUESTION = 1;
const ANSWER = 2;

/**
 * One page of a chat session's saved turns (14 Oct 2026). The page holds
 * `[turns, continuation]`, turns newest first, each
 * `[turnId, [sec, nanos], role, question | null, answer | null, ...]`, with the answer's
 * text at `answer[0][0]` and its follow-up questions at `answer[3][0]`, as in the live
 * stream's final frame. Passages quoted from the sources are not read (A6).
 *
 * A continuation means older turns exist, so only a page without one, whose oldest turn is
 * a question, can prove the chat's first request, and only when the notebook's session
 * list names this session alone: another session's turns would not have been read.
 *
 * Linking (seen live on 16 Oct 2026): the live stream names its reply by the turn id at
 * `frame[0][2][1]`, which appears nowhere in the saved page. The saved answer has its own
 * turn id, and `answer[0][2]` holds the session id twice and another number. Only the
 * session id and the answer text are the same on both sides, so a saved answer carries
 * `contentId`, a digest of its session and text that the live reply computes too, and the
 * extension links the two by it. `liveAttemptId` stays the saved turn's own id, which
 * names the answer for an organization when no live reply links to it. A question links
 * through its answer, as on Claude.
 */
function notebooklmChat(
  read: NotebooklmHistoryRead,
  notebookId: string,
  observedAt: string,
): HistoryTextPage {
  const page = historyPage("notebooklm", notebookId, observedAt);
  const value = read.value;
  const session = read.session;
  if (!Array.isArray(value) || !notebooklmId(session))
    throw new Error("history_unsupported");
  const list = geminiField(value, 0);
  const turns = list === null || list === undefined ? [] : list;
  if (!Array.isArray(turns) || turns.length > HISTORY_LIMITS.messages)
    throw new Error("history_unsupported");
  const continuation = geminiField(value, 1);
  const older = continuation !== null && continuation !== undefined;
  const ids = new Set<string>();
  const rows = turns.map((turn) => {
    const id = geminiField(turn, 0);
    const role = geminiField(turn, 2);
    if (
      !Array.isArray(turn) ||
      !notebooklmId(id) ||
      ids.has(id) ||
      (role !== QUESTION && role !== ANSWER)
    )
      throw new Error("history_unsupported");
    ids.add(id);
    return { id, role, turn };
  });
  // Turns arrive newest first; history keeps them in the order they were sent.
  rows.reverse();
  let previous: HistoryTextMessage | null = null;
  for (const [index, { id, role, turn }] of rows.entries()) {
    const occurredAt = instant(geminiTime(geminiField(turn, 1)));
    if (role === QUESTION) {
      const prompt = historyMessage(id, "prompt");
      const text = geminiField(turn, 3);
      prompt.text = boundedText(text) ? text : null;
      prompt.complete = prompt.text !== null;
      if (previous) {
        prompt.parentSourceId = previous.sourceId;
        prompt.parentRole = previous.role;
      }
      prompt.occurredAt = occurredAt;
      prompt.dateBasis = occurredAt ? "message_created" : "unknown";
      page.messages.push(prompt);
      previous = prompt;
      continue;
    }
    // Two answers in a row were never seen. The oldest turn of an older page may be an
    // answer whose question is on the next older page; it is read without its question.
    if (previous ? previous.role !== "prompt" : index !== 0)
      throw new Error("history_unsupported");
    const response = historyMessage(id, "response");
    if (previous) {
      response.promptSourceId = previous.sourceId;
      response.parentSourceId = previous.sourceId;
      response.parentRole = "prompt";
    }
    response.liveAttemptId = id;
    response.occurredAt = occurredAt;
    response.dateBasis = occurredAt ? "message_created" : "unknown";
    readAnswer(geminiField(turn, 4), response);
    if (response.text !== null)
      response.contentId = notebooklmReplyId(session, response.text);
    page.messages.push(response);
    previous = response;
  }
  const first = page.messages[0];
  if (
    !older &&
    first?.role === "prompt" &&
    read.sessions?.length === 1 &&
    read.sessions[0] === read.session
  ) {
    page.firstRequestVerified = true;
    page.rootSourceId = first.sourceId;
    page.hasEarlier = false;
  } else if (older) page.hasEarlier = true;
  return finishHistoryPage(page);
}

/** A saved answer's text and follow-up questions; other parts make it partial. */
function readAnswer(answer: unknown, response: HistoryTextMessage) {
  const row = geminiField(answer, 0);
  const text = geminiField(row, 0);
  let unknown = false;
  if (boundedText(text)) response.text = text;
  else unknown = true;
  const suggestions = notebooklmSuggestions(
    geminiField(geminiField(answer, 3), 0),
  );
  if (suggestions === null) unknown = true;
  else if (suggestions) {
    const joined = suggestions.join("\n");
    if (boundedText(joined)) response.intermediate = joined;
    else unknown = true;
  }
  // NotebookLM showed no thoughts and runs no tools in a chat (1 and 3 Oct), as live.
  if (!unknown) {
    response.toolInput = "";
    response.toolOutput = "";
  } else response.coverageReasons = ["unknown_event_observed"];
  response.complete = response.text !== null;
}

/**
 * A notebook's Studio list, one opened item, or one page of its saved chat (W9). The
 * notebook comes from the request, which names it (list) or is sent from its page (opened
 * item, chat page); the rows do not repeat it.
 */
export function notebooklmHistory(
  read: NotebooklmHistoryRead,
  notebookId: string,
  observedAt: string,
): HistoryTextPage {
  if (read.rpc === NOTEBOOKLM_CHAT_RPC)
    return notebooklmChat(read, notebookId, observedAt);
  const page = historyPage("notebooklm", notebookId, observedAt);
  const rows = geminiField(read.value, 0);
  const items =
    read.rpc === NOTEBOOKLM_ITEM_RPC
      ? [rows]
      : rows === null || rows === undefined
        ? []
        : rows;
  if (
    !Array.isArray(items) ||
    items.length > HISTORY_LIMITS.messages / 2 ||
    (read.rpc === NOTEBOOKLM_ITEM_RPC && !Array.isArray(rows))
  )
    throw new Error("history_unsupported");
  for (const row of items)
    page.messages.push(...readItem(row, read.rpc === NOTEBOOKLM_ITEM_RPC));
  return finishHistoryPage(page);
}
