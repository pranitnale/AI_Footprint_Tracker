import { LIMITS, isCoworkSessionId } from "@footprint/capture-core";
import {
  boundedText,
  historyInstant,
  historyMessage,
  historyModelLabel,
  historyPage,
  historyUUID,
  record,
} from "./common";
import type {
  CoworkCumulative,
  CoworkModelCount,
  HistoryTextMessage,
  HistoryTextPage,
} from "./types";

/*
 * Claude Cowork sessions (D9). Opening a session makes the page load its newest events
 * (`GET /v1/code/sessions/{id}/events`) and follow its live stream (`.../events/stream`);
 * it sends with `POST .../events`. Each event is an envelope `{event_id, sequence_num,
 * event_type, source, payload, created_at}` around a Claude Agent SDK message (seen on
 * 1 Oct 2026). Only results, the user messages they name, tool results and the session's
 * model are read; nothing else of an event is kept.
 */

const SESSION = "(cse_[A-Za-z0-9]{16,64})";
const EVENTS_PATH = new RegExp("^/v1/code/sessions/" + SESSION + "/events$");
const STREAM_PATH = new RegExp(
  "^/v1/code/sessions/" + SESSION + "/events/stream$",
);

/** The Cowork session a page request belongs to, and what the request does. */
export function coworkRequest(
  url: URL,
  method: string,
): { session: string; kind: "events" | "stream" | "send" } | null {
  const stream = STREAM_PATH.exec(url.pathname);
  if (stream)
    return method === "GET" ? { session: stream[1]!, kind: "stream" } : null;
  const events = EVENTS_PATH.exec(url.pathname);
  if (!events) return null;
  return method === "GET"
    ? { session: events[1]!, kind: "events" }
    : method === "POST"
      ? { session: events[1]!, kind: "send" }
      : null;
}

// Bounds of what one reader keeps. A turn names few user messages and a session uses few
// models; tool results and sub-agent messages are never kept as prompts.
const PROMPTS_PER_RESULT = 16;
const MODELS_PER_RESULT = 32;
const KEPT_PROMPTS = 64;
const KEPT_MODELS = 64;
const COUNT_LIMIT = 1_000_000_000;
// Tool result text waiting for its turn's result. Older results are dropped past these
// bounds, and a turn that needed them leaves its tool results unknown. Results without
// text count against the second bound, so a long turn cannot grow the map without limit.
const KEPT_TOOL_UNITS = 2 * LIMITS.text;
const KEPT_TOOL_RESULTS = 4096;
// Positions of skipped stream events. Past this bound the oldest is dropped, and every
// turn that started at or before it leaves its tool results unknown.
const KEPT_GAPS = 64;
// The session's first events, as far as they show whether the reader saw its start, and
// the full prompts among them kept to report the first one. A session whose first request
// comes later is not proven to start on the page.
const START_EVENTS = 2048;
const START_PROMPTS = 4;

const count = (value: unknown) =>
  Number.isSafeInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= COUNT_LIMIT
    ? (value as number)
    : null;

function sequenceOf(value: unknown): number | null {
  if (typeof value === "number") return count(value);
  return typeof value === "string" && /^(0|[1-9][0-9]{0,14})$/.test(value)
    ? count(Number(value))
    : null;
}

/** Whether a value is a Cowork result's counters as this reader builds them. */
export function validCoworkCumulative(
  value: unknown,
): value is CoworkCumulative {
  if (
    !record(value) ||
    Object.keys(value).sort().join(",") !== "apiMs,models,sequence" ||
    count(value.sequence) === null ||
    (value.apiMs !== null && count(value.apiMs) === null) ||
    !Array.isArray(value.models) ||
    !value.models.length ||
    value.models.length > MODELS_PER_RESULT
  )
    return false;
  const models = new Set<unknown>();
  for (const model of value.models) {
    if (
      !record(model) ||
      Object.keys(model).sort().join(",") !== "model,output,reasoning" ||
      historyModelLabel(model.model) !== model.model ||
      models.has(model.model) ||
      count(model.output) === null ||
      (model.reasoning !== null &&
        (count(model.reasoning) === null || model.reasoning > model.output))
    )
      return false;
    models.add(model.model);
  }
  return true;
}

/**
 * Per-model counters of a result, or null when an entry is not in the known shape. The
 * entry's key is the model id; its canonical name stands in when the key carries a suffix
 * the label rule does not take. Entries that share a name add up.
 */
function modelCounts(
  value: Record<string, unknown>,
): CoworkModelCount[] | null {
  const entries = Object.entries(value);
  if (!entries.length || entries.length > MODELS_PER_RESULT) return null;
  const models = new Map<string, CoworkModelCount>();
  for (const [key, usage] of entries) {
    if (!record(usage)) return null;
    const model =
      historyModelLabel(key) ?? historyModelLabel(usage.canonicalModel);
    const output = count(usage.outputTokens);
    if (!model || output === null) return null;
    const thinking = usage.thinkingTokens;
    const reasoning = thinking === undefined ? null : count(thinking);
    if (thinking !== undefined && (reasoning === null || reasoning > output))
      return null;
    const known = models.get(model);
    if (!known) {
      models.set(model, { model, output, reasoning });
      continue;
    }
    known.output += output;
    known.reasoning =
      known.reasoning === null || reasoning === null
        ? null
        : known.reasoning + reasoning;
    if (known.output > COUNT_LIMIT) return null;
  }
  return [...models.values()];
}

type CoworkResult = {
  id: string;
  sequence: number;
  occurredAt: string | null;
  prompts: string[];
  /** Whether `prompts` holds every user message the result names. */
  allPrompts: boolean;
  answer: string | null;
  cumulative: CoworkCumulative;
};
/**
 * What one of the session's first events tells about its start: nothing (other), an event
 * of a known kind this reader could not read (unknown), a prompt, a result that ran no
 * model (idle), or a result that ran one, with every prompt it names (counted).
 */
type StartEvent =
  | { kind: "other" }
  | { kind: "unknown" }
  | { kind: "prompt"; id: string }
  | { kind: "idle"; prompts: string[] }
  | { kind: "counted"; id: string; prompts: string[] };
type CoworkPrompt = {
  id: string;
  sequence: number;
  occurredAt: string | null;
  text: string | null;
  images: number | null;
};

/**
 * The text items of a user message's tool results (A6, owner 2 Oct, question 9): what the
 * model read. Null when the message holds no tool result, undefined when a result's shape
 * is unknown.
 */
function toolResultText(content: unknown): string | null | undefined {
  if (!Array.isArray(content)) return null;
  const results = content.filter(
    (block) => record(block) && block.type === "tool_result",
  );
  if (!results.length) return null;
  const texts: string[] = [];
  for (const block of results) {
    const value = block.content;
    if (value === undefined || value === null) continue;
    if (typeof value === "string") texts.push(value);
    else if (Array.isArray(value)) {
      for (const item of value) {
        if (!record(item) || typeof item.type !== "string") return undefined;
        if (item.type !== "text") continue;
        if (typeof item.text !== "string") return undefined;
        texts.push(item.text);
      }
    } else return undefined;
  }
  return texts.join("\n");
}

/**
 * The text and inline image count of a user message, as far as its shape is known, or
 * null when it carries neither (tool results arrive as user messages too).
 */
function userContent(
  content: unknown,
): { text: string | null; images: number | null } | null {
  if (typeof content === "string")
    return { text: boundedText(content) ? content : null, images: 0 };
  if (!Array.isArray(content)) return { text: null, images: null };
  const blocks = content.filter(record);
  const typed =
    blocks.length === content.length &&
    blocks.every((block) => typeof block.type === "string");
  const texts = blocks.filter((block) => block.type === "text");
  const images = blocks.filter((block) => block.type === "image").length;
  if (typed && !texts.length && !images) return null;
  const text = texts.every((block) => typeof block.text === "string")
    ? texts.map((block) => block.text as string).join("\n")
    : null;
  return {
    text: typed && text !== null && boundedText(text) ? text : null,
    images: typed ? images : null,
  };
}

/**
 * Facts of Cowork events: results with their cumulative counters, the user messages that
 * may be their prompts, and the model each `system:init` names. A result with empty
 * counters ran no model since they began and is left out. A result without counters, or
 * with counters in an unknown shape, makes the next page unsupported, so a format change
 * is never silent.
 */
export class CoworkEvents {
  private results = new Map<string, CoworkResult>();
  private prompts = new Map<string, CoworkPrompt>();
  private models: Array<{ sequence: number; model: string }> = [];
  private unreadable = false;
  /** Tool result text by sequence; null where a result could not be read. */
  private tools = new Map<number, string | null>();
  private toolUnits = 0;
  /** Tool results at or before this sequence were dropped to stay within the bound. */
  private toolsDroppedThrough = -1;
  /**
   * Skipped events, each as the newest sequence read before it: a turn spanning one
   * leaves its tool results unknown. Turns that started at or before a dropped position
   * stay unknown too.
   */
  private gaps: number[] = [];
  private gapsDroppedThrough = -1;
  private newest = -1;
  /**
   * The session's first events by position, from sequence 1 (seen 6 Oct 2026), so the
   * page that reports the first request can prove the reader saw the session from its
   * start, in whatever order the page loads them. Read again, an event is classed again.
   */
  private start = new Map<number, StartEvent>();
  /** The earliest prompts among them, kept whole while later prompts are dropped. */
  private startPrompts = new Map<string, CoworkPrompt>();
  /** A result without a readable position may be anywhere, the start included. */
  private startLost = false;
  /** The newest position read before the earliest event skipped unread. */
  private earliestGap = Infinity;

  /**
   * Reads one event envelope. Returns whether it has the known envelope shape, so a reader
   * can tell a format change from a session without results.
   */
  add(envelope: unknown): boolean {
    if (!record(envelope)) return false;
    const payload = envelope.payload;
    const sequence = sequenceOf(envelope.sequence_num);
    const kind =
      record(payload) && typeof payload.type === "string" ? payload.type : null;
    // Sessions number their events from 1, so an event before that is a shape not yet seen.
    if (sequence !== null && sequence < 1) this.startLost = true;
    // An event that cannot be placed may be anywhere, the start included, when it is a
    // prompt or result or its kind cannot be read. A frame without a payload is no event.
    if (
      sequence === null &&
      payload !== undefined &&
      (kind === null || kind === "user" || kind === "result")
    )
      this.startLost = true;
    if (!record(payload)) return false;
    if (sequence === null || kind === null) {
      if (payload.type === "result") this.unreadable = true;
      return false;
    }
    const occurredAt = historyInstant(envelope.created_at);
    this.newest = Math.max(this.newest, sequence);
    this.mark(sequence, { kind: "other" });
    if (payload.type === "result") this.result(payload, sequence, occurredAt);
    else if (payload.type === "user") this.user(payload, sequence, occurredAt);
    else if (payload.type === "system" && payload.subtype === "init") {
      const model = historyModelLabel(payload.model);
      if (model) {
        this.models.push({ sequence, model });
        if (this.models.length > KEPT_MODELS) this.models.shift();
      }
    }
    return true;
  }

  private mark(sequence: number, event: StartEvent) {
    if (sequence >= 1 && sequence <= START_EVENTS) this.start.set(sequence, event);
  }

  /**
   * The session's first request, when this reader read every event before the first
   * result that ran a model (R), understood each of them and skipped none, and R's prompts
   * all come before it. Its root is the earliest of R's prompts; every prompt before the
   * root must be answered by a result that ran no model, or it was an earlier request.
   * Prompts between the root and R are later requests queued meanwhile. Null otherwise.
   *
   * Sessions created before mid September 2026 (seen 14 Oct) answer the hidden first
   * message with a result that ran no model and names no user message. Such a result
   * answers every prompt before it. It also shows that the session's results do not name
   * every message they settle: one session held a prompt, between such results and the
   * root, that no result named. So once one appears before R, a prompt before the root
   * that no counted result among the first events names cost nothing either.
   */
  private firstRequest(): { result: string; root: CoworkPrompt } | null {
    if (this.startLost) return null;
    const idle = new Set<string>();
    const prompts: string[] = [];
    let unnamed = false;
    for (let sequence = 1; sequence <= START_EVENTS; sequence++) {
      const event = this.start.get(sequence);
      if (!event || event.kind === "unknown") return null;
      if (event.kind === "prompt") prompts.push(event.id);
      else if (event.kind === "idle") {
        // A result answers only prompts that came before it.
        if (!event.prompts.length) unnamed = true;
        for (const id of event.prompts.length ? event.prompts : prompts)
          if (prompts.includes(id)) idle.add(id);
      } else if (event.kind === "counted") {
        const named = new Set(event.prompts);
        const first = prompts.findIndex((id) => named.has(id));
        // A prompt a counted result names, even one read on another page or after R, was
        // a request of its own.
        const requested = new Set<string>();
        if (unnamed)
          for (const later of this.start.values())
            if (later.kind === "counted")
              for (const id of later.prompts) requested.add(id);
        if (
          this.earliestGap < sequence ||
          first < 0 ||
          prompts.filter((id) => named.has(id)).length !== named.size ||
          prompts
            .slice(0, first)
            .some((id) => !idle.has(id) && (!unnamed || requested.has(id)))
        )
          return null;
        const root =
          this.startPrompts.get(prompts[first]!) ??
          this.prompts.get(prompts[first]!);
        return root ? { result: event.id, root } : null;
      }
    }
    return null;
  }

  /** Marks the events unreadable, so the next page reports the format change. */
  fail(): void {
    this.unreadable = true;
  }

  /** An event was skipped unread: tool results of a turn spanning it stay unknown. */
  gap(): void {
    // Before any event was read the skipped one cannot be placed, so no turn of this
    // reader can show that it saw all of its tool results.
    if (this.newest < 0) {
      this.gapsDroppedThrough = Infinity;
      this.earliestGap = 0;
      return;
    }
    this.earliestGap = Math.min(this.earliestGap, this.newest);
    if (this.gaps.at(-1) === this.newest) return;
    this.gaps.push(this.newest);
    if (this.gaps.length > KEPT_GAPS)
      this.gapsDroppedThrough = Math.max(
        this.gapsDroppedThrough,
        this.gaps.shift()!,
      );
  }

  private result(
    payload: Record<string, any>,
    sequence: number,
    occurredAt: string | null,
  ) {
    const usage = payload.modelUsage;
    const listed = Array.isArray(payload.user_message_uuids)
      ? payload.user_message_uuids
      : payload.user_message_uuid !== undefined
        ? [payload.user_message_uuid]
        : [];
    // The prompts a result names, for the session's start: only when they are few and all
    // readable, so an unreadable result is never taken as evidence.
    const named =
      historyUUID(payload.uuid) &&
      listed.length <= PROMPTS_PER_RESULT &&
      listed.every(historyUUID)
        ? [...new Set<string>(listed)]
        : null;
    this.mark(sequence, { kind: "unknown" });
    if (record(usage) && !Object.keys(usage).length) {
      // Empty counters: no model ran since they began, as in a turn that failed before
      // its first call, so there is nothing to count. A turn that reports output of its
      // own with empty counters means the counters moved elsewhere: an unknown shape.
      const own = record(payload.usage)
        ? payload.usage.output_tokens
        : undefined;
      if (own !== undefined && own !== 0) this.unreadable = true;
      else if (named) this.mark(sequence, { kind: "idle", prompts: named });
      return;
    }
    // Missing counters are an unknown shape too, never a result to leave out silently.
    const models = record(usage) ? modelCounts(usage) : null;
    const apiMs = payload.duration_api_ms;
    if (
      !historyUUID(payload.uuid) ||
      !models ||
      (apiMs !== undefined && count(apiMs) === null) ||
      !listed.every(historyUUID)
    ) {
      this.unreadable = true;
      return;
    }
    if (named)
      this.mark(sequence, { kind: "counted", id: payload.uuid, prompts: named });
    const answer = payload.result;
    this.results.set(payload.uuid, {
      id: payload.uuid,
      sequence,
      occurredAt,
      prompts: [...new Set<string>(listed)].slice(0, PROMPTS_PER_RESULT),
      allPrompts: new Set<string>(listed).size <= PROMPTS_PER_RESULT,
      // A result without its final text (an error) wrote none; other shapes stay unknown.
      answer:
        answer === undefined
          ? ""
          : typeof answer === "string" && boundedText(answer)
            ? answer
            : null,
      cumulative: {
        sequence,
        models,
        apiMs: apiMs === undefined ? null : count(apiMs),
      },
    });
  }

  private user(
    payload: Record<string, any>,
    sequence: number,
    occurredAt: string | null,
  ) {
    if (!record(payload.message) || payload.message.role !== "user") {
      this.mark(sequence, { kind: "unknown" });
      return;
    }
    // Every tool result the session's models read counts as input, sub-agents' included.
    const tool = toolResultText(payload.message.content);
    if (tool !== null) {
      this.tool(sequence, tool === undefined ? null : tool);
      return;
    }
    // Messages to sub-agents are model-written tool traffic, not the user's prompts.
    if (payload.parent_tool_use_id) return;
    // A user message without an id or readable content may still be a request.
    const content = historyUUID(payload.uuid)
      ? userContent(payload.message.content)
      : null;
    if (!content) {
      this.mark(sequence, { kind: "unknown" });
      return;
    }
    const prompt = { id: payload.uuid, sequence, occurredAt, ...content };
    this.prompts.delete(payload.uuid);
    this.prompts.set(payload.uuid, prompt);
    if (sequence <= START_EVENTS) {
      this.mark(sequence, { kind: "prompt", id: prompt.id });
      this.keepStartPrompt(prompt);
    }
    while (this.prompts.size > KEPT_PROMPTS)
      this.prompts.delete(this.prompts.keys().next().value!);
  }

  private keepStartPrompt(prompt: CoworkPrompt) {
    this.startPrompts.set(prompt.id, prompt);
    if (this.startPrompts.size <= START_PROMPTS) return;
    let latest = prompt;
    for (const kept of this.startPrompts.values())
      if (kept.sequence > latest.sequence) latest = kept;
    this.startPrompts.delete(latest.id);
  }

  private tool(sequence: number, text: string | null) {
    if (this.tools.has(sequence) || sequence <= this.toolsDroppedThrough)
      return;
    const kept = text !== null && text.length <= LIMITS.text ? text : null;
    this.tools.set(sequence, kept);
    this.toolUnits += kept?.length ?? 0;
    while (
      this.toolUnits > KEPT_TOOL_UNITS ||
      this.tools.size > KEPT_TOOL_RESULTS
    ) {
      const oldest = Math.min(...this.tools.keys());
      this.toolUnits -= this.tools.get(oldest)?.length ?? 0;
      this.tools.delete(oldest);
      this.toolsDroppedThrough = Math.max(this.toolsDroppedThrough, oldest);
    }
  }

  /**
   * The tool results a turn read, when this reader saw the whole turn: its prompt and every
   * event after it. Otherwise undefined, so the part stays unknown.
   */
  private turnTools(promptSequence: number | null, resultSequence: number) {
    if (
      promptSequence === null ||
      promptSequence <= this.toolsDroppedThrough ||
      promptSequence <= this.gapsDroppedThrough ||
      this.gaps.some((gap) => gap >= promptSequence && gap < resultSequence)
    )
      return undefined;
    const texts: string[] = [];
    for (const [sequence, text] of [...this.tools].sort(
      (a, b) => a[0] - b[0],
    )) {
      if (sequence <= promptSequence || sequence >= resultSequence) continue;
      if (text === null) return undefined;
      texts.push(text);
    }
    const joined = texts.join("\n");
    return joined.length <= LIMITS.text ? joined : undefined;
  }

  /** Whether a page is waiting: results to report or a result that could not be read. */
  get pending(): boolean {
    return this.results.size > 0 || this.unreadable;
  }

  /**
   * The results read so far as one history page, with the user messages they name that
   * this reader saw, in event order. The results are then dropped, so a live stream reports
   * each one once; user messages and models stay for the results that follow.
   */
  page(conversationId: string, observedAt: string): HistoryTextPage {
    if (!isCoworkSessionId(conversationId))
      throw new Error("history_unsupported");
    const page = historyPage("claude", conversationId, observedAt);
    const results = [...this.results.values()].sort(
      (a, b) => a.sequence - b.sequence,
    );
    this.results.clear();
    if (this.unreadable) {
      this.unreadable = false;
      return { ...page, status: "unsupported", branchScope: "unknown" };
    }
    // The page that reports the session's first request proves its start (6 Oct 2026);
    // the saved coverage keeps the proof for the pages after it.
    const first = this.firstRequest();
    const root =
      first && results.some((result) => result.id === first.result)
        ? first.root
        : null;
    const named = new Set<string>();
    const messages: Array<[number, HistoryTextMessage]> = [];
    for (const result of results) {
      const message = historyMessage(result.id, "response");
      // The reply links to its first prompt even when the page did not load it.
      const promptId = result.prompts[0] ?? null;
      message.promptSourceId = promptId;
      message.parentSourceId = promptId;
      message.parentRole = promptId ? "prompt" : null;
      message.occurredAt = result.occurredAt;
      if (result.occurredAt) message.dateBasis = "message_created";
      // The session's model when the turn started; the background checks it against the
      // models the result reports.
      message.modelId =
        this.models.filter((entry) => entry.sequence <= result.sequence).at(-1)
          ?.model ?? null;
      message.text = result.answer;
      message.complete = result.answer !== null;
      message.cumulative = result.cumulative;
      // The reader saw the turn from its start only when it saw every prompt the result
      // names; a missing one may hold earlier tool results of the turn.
      const seen = result.prompts.map((id) => this.prompts.get(id)?.sequence);
      const tools = this.turnTools(
        result.allPrompts &&
          seen.length &&
          seen.every((sequence) => sequence !== undefined)
          ? Math.min(...(seen as number[]))
          : null,
        result.sequence,
      );
      if (tools !== undefined) message.toolOutput = tools;
      messages.push([result.sequence, message]);
      for (const id of result.prompts) {
        // The first prompt is reported even when later prompts pushed it out.
        const prompt = this.prompts.get(id) ?? (id === root?.id ? root : null);
        if (!prompt || named.has(id)) continue;
        named.add(id);
        const promptMessage = historyMessage(prompt.id, "prompt");
        promptMessage.occurredAt = prompt.occurredAt;
        if (prompt.occurredAt) promptMessage.dateBasis = "message_created";
        promptMessage.text = prompt.text;
        promptMessage.complete = prompt.text !== null;
        if (prompt.images)
          promptMessage.inputImages = Array.from(
            { length: Math.min(prompt.images, 32) },
            () => ({ width: null, height: null }),
          );
        messages.push([prompt.sequence, promptMessage]);
        this.prompts.delete(id);
      }
    }
    // Tool results before the newest reported result are used or belong to no loaded turn.
    const last = results.at(-1)?.sequence;
    if (last !== undefined)
      for (const [sequence, text] of [...this.tools])
        if (sequence < last) {
          this.toolUnits -= text?.length ?? 0;
          this.tools.delete(sequence);
        }
    page.messages = messages
      .sort((a, b) => a[0] - b[0])
      .map(([, message]) => message);
    // Messages come in event order, so the first request comes first.
    if (
      root &&
      page.messages[0]?.sourceId === root.id &&
      page.messages[0]?.role === "prompt"
    ) {
      page.firstRequestVerified = true;
      page.rootSourceId = root.id;
      page.hasEarlier = false;
      // The saved coverage keeps the proof; a list read again keeps its prompts again.
      this.startPrompts.clear();
    }
    return page;
  }
}
