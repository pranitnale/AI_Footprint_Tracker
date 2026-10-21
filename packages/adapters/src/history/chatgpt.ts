import { timingEvidence } from "@footprint/capture-core";
import {
  chatgptMessageModel,
  chatgptPromptText,
  chatgptTurn,
  chatgptUploadedImages,
  isChatgptAsyncJob,
  isChatgptFinal,
} from "../chatgpt-content";
import { ChatgptImages } from "../chatgpt-images";
import { GENERATED_TEXT_LIMITS } from "../generated-text";
import type { GeneratedComponent, GeneratedMedia } from "../types";
import {
  boundedText,
  finishHistoryPage,
  historyInstant,
  historyMessage,
  historyMessageUnits,
  historyModelLabel,
  historyPage,
  historyUUID,
  record,
} from "./common";
import {
  HISTORY_LIMITS,
  type HistoryCoverageReason,
  type HistoryTextMessage,
} from "./types";

/** A saved prompt or reply with its links: the request it answers and its parent message. */
export type ChatgptHistoryRow = {
  message: HistoryTextMessage;
  requestRef: string | null;
  /** The prompt or reply this message follows, already mapped from the saved rows. */
  parentRef: string | null;
};

const LATEST = 253402300799;
const storedTime = (value: unknown): number | null =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= LATEST
    ? value
    : null;
const hidden = (row: Record<string, any>) =>
  row.metadata?.is_visually_hidden_from_conversation === true;

/** A research time: epoch seconds or milliseconds, or an instant with its zone. */
function researchTime(value: unknown): number | null {
  if (typeof value === "number")
    return Number.isFinite(value) && value > 0
      ? value > 1e11
        ? value / 1000
        : value
      : null;
  const instant = historyInstant(value);
  return instant === null ? null : Date.parse(instant) / 1000;
}

type Research = {
  /**
   * The run shows its end: a report or a stop time. A state this reader cannot read counts
   * as ended, so the turn is still reported (partly read) instead of waiting forever.
   */
  done: boolean;
  /** Plan and report text; null when the state has a shape this reader does not know. */
  text: string | null;
  model: string | null;
  seconds: number | null;
};

/** The text of a research report message, or undefined for an unknown shape. */
function reportText(report: Record<string, any>): string | undefined {
  const content = report.content;
  if (record(content)) {
    if (
      Array.isArray(content.parts) &&
      content.parts.every((part: unknown) => typeof part === "string")
    )
      return (content.parts as string[]).join("");
    if (typeof content.text === "string") return content.text;
    return undefined;
  }
  if (typeof content === "string") return content;
  if (typeof report.text === "string") return report.text;
  return undefined;
}

/**
 * A ChatGPT Deep Research run as its tool message saves it (E1, seen 3 Oct): plan steps,
 * report and research times inside `metadata.chatgpt_sdk.widget_state`, a JSON text. Other
 * apps keep widget state too, so only a state naming a research start or a report is read.
 * The search results it may hold are tool results the page does not show in full (A6).
 */
function deepResearch(row: Record<string, any>): Research | null {
  const raw = row.metadata?.chatgpt_sdk?.widget_state;
  if (raw === undefined || raw === null) return null;
  let state: unknown = raw;
  if (typeof raw === "string")
    try {
      state = JSON.parse(raw);
    } catch {
      return raw.includes('"research_started_at"') ||
        raw.includes('"report_message"')
        ? { done: true, text: null, model: null, seconds: null }
        : null;
    }
  if (
    !record(state) ||
    (!("research_started_at" in state) && !("report_message" in state))
  )
    return null;
  const unknown: Research = {
    done: true,
    text: null,
    model: null,
    seconds: null,
  };
  const texts: string[] = [];
  const plan =
    state.plan === undefined || state.plan === null
      ? []
      : Array.isArray(state.plan)
        ? state.plan
        : record(state.plan) && Array.isArray(state.plan.steps)
          ? state.plan.steps
          : null;
  if (!plan) return unknown;
  for (const step of plan) {
    if (typeof step === "string") {
      if (step) texts.push(step);
      continue;
    }
    if (!record(step)) return unknown;
    // A step's title and the reason the research model gave for it are both its writing.
    for (const key of ["title", "text", "description", "reason"])
      if (typeof step[key] === "string" && step[key]) texts.push(step[key]);
  }
  const report = state.report_message;
  let model: string | null = null;
  let reported = false;
  if (report !== undefined && report !== null) {
    if (!record(report)) return unknown;
    const text = reportText(report);
    if (text === undefined) return unknown;
    if (text) texts.push(text);
    reported = true;
    model =
      chatgptMessageModel(report) ??
      historyModelLabel(report.resolved_model_slug) ??
      historyModelLabel(report.model_slug);
  }
  const started = researchTime(state.research_started_at),
    stopped = researchTime(state.research_stopped_at);
  const text = texts.join("\n");
  return {
    done: reported || stopped !== null,
    text: text.length <= HISTORY_LIMITS.textUnits ? text : null,
    model,
    seconds:
      started !== null && stopped !== null && stopped > started
        ? stopped - started
        : null,
  };
}

/** A stopped image job (I3): the tool's asynchronous message ends interrupted. */
const stoppedJob = (row: Record<string, any>) =>
  isChatgptAsyncJob(row) &&
  row.metadata?.finish_details?.type === "interrupted";

/**
 * Images of a saved turn (D1), as the live reply reports them: returned images by size and
 * unique generation id, and a job that started without returning one as one image. Null
 * when an image message has a shape the reader does not know. `done` when every job has
 * marked its images final.
 */
function turnImages(
  rows: readonly Record<string, any>[],
): { media: GeneratedMedia[]; running: boolean; done: boolean } | null {
  const images = new ChatgptImages();
  try {
    for (const row of rows) images.observe(row);
  } catch {
    return null;
  }
  const operations = images.snapshot();
  const media: GeneratedMedia[] = [];
  for (const operation of operations) {
    if (!operation.outputs.length) {
      media.push({
        kind: "image",
        model: null,
        count: 1,
        width: null,
        height: null,
        outcome: "started_not_returned",
      });
      continue;
    }
    const sizes = new Map<
      string,
      { width: number | null; height: number | null; count: number }
    >();
    for (const output of operation.outputs) {
      // A size is a pair; half a size is not a fact.
      const known = output.width !== null && output.height !== null;
      const width = known ? output.width : null,
        height = known ? output.height : null;
      const key = `${width}x${height}`;
      const size = sizes.get(key) ?? { width, height, count: 0 };
      size.count++;
      sizes.set(key, size);
    }
    for (const size of sizes.values())
      media.push({
        kind: "image",
        model: null,
        count: size.count,
        width: size.width,
        height: size.height,
        outcome: "returned",
      });
  }
  // Image jobs that report progress mark each step; one not yet marked final still runs.
  const running =
    rows.some((row) => row.metadata?.ghostrider?.status === "intermediate") &&
    operations.some((operation) => operation.state !== "completed") &&
    !rows.some(stoppedJob);
  const done =
    operations.length > 0 &&
    operations.every((operation) => operation.state === "completed");
  return { media, running, done };
}

/**
 * The time a saved reply took: from its first visible assistant message to the turn's
 * last update. The last answer (or, without one, the last assistant message) must show
 * when it finished; a missing or impossible time leaves the reply untimed, because a
 * shorter span would cap the estimate too low.
 */
function turnSpan(
  rows: readonly Record<string, any>[],
  lastFinal: Record<string, any> | undefined,
  attempt: Record<string, any>,
) {
  const anchor =
    lastFinal ??
    rows
      .filter((row) => row.author?.role === "assistant" && !hidden(row))
      .at(-1);
  if (!anchor || storedTime(anchor.update_time) === null) return null;
  let start = Infinity,
    end = -Infinity;
  for (const row of rows) {
    const created = storedTime(row.create_time);
    if (created === null) return null;
    let updated = created;
    if (row.update_time !== undefined && row.update_time !== null) {
      const stored = storedTime(row.update_time);
      if (stored === null || stored < created) return null;
      updated = stored;
    }
    // An image job that names the turn began it (isChatgptAsyncJob).
    if ((row.author?.role === "assistant" && !hidden(row)) || row === attempt)
      start = Math.min(start, created);
    end = Math.max(end, updated);
  }
  return Number.isFinite(start)
    ? timingEvidence(end - start, "chatgpt_history")
    : null;
}

type Group = {
  request: string | null;
  rows: Record<string, any>[];
  /** The turn began before the page's first prompt, so its start is on another page. */
  cut: boolean;
};

/**
 * Reads a saved ChatGPT page row by row (W6). Prompts are reported as they come. The rows
 * of one request (thoughts, tool calls and results, commentary, answers, images, research)
 * are one reply, reported when the next turn starts or the page ends, under the turn's
 * attempt id: the id the live capture keeps too, which stays the same while the turn grows.
 */
export class ChatgptTurns {
  constructor(
    /**
     * Each saved answer message's id and characters, for read aloud whose audio cannot be
     * timed (owner, 3 Oct). Counts only; the text stays here.
     */
    private onAnswer?: (ids: string[], characters: number) => void,
  ) {}
  private group: Group | null = null;
  /** Rows of reported replies, mapped to the reply that holds them. */
  private replyFor = new Map<string, string>();
  private prompts = new Set<string>();
  /** Each saved row's parent, so any row leads to the message it belongs under. */
  private parents = new Map<string, string | null>();
  /** Requests whose reply was reported; a request seen again would split one reply. */
  private reported = new Set<string>();
  private promptSeen = false;
  /** The latest visible prompt on the page, which the turn read next follows. */
  private lastPrompt: string | null = null;
  /** Each prompt's turn_exchange_id; null when two prompts share one. */
  private promptTurns = new Map<string, string | null>();

  /**
   * The prompt a reply's turn belongs to when its parent leads nowhere on the page. Since about
   * 18 Oct 2026 a chat's first reply has no request id and its first row's parent is a row the
   * page leaves out (live, 20 Oct 2026), while every row of the turn carries its prompt's
   * turn_exchange_id. The link is made only when the turn id is the prompt's alone and that
   * prompt is the one the turn follows on the page.
   */
  private turnPrompt(rows: Record<string, any>[]): string | null {
    const turn = rows[0]!.metadata?.turn_exchange_id;
    if (typeof turn !== "string" || !turn) return null;
    if (
      rows.some(
        (row) =>
          row.metadata?.turn_exchange_id !== undefined &&
          row.metadata.turn_exchange_id !== turn,
      )
    )
      return null;
    const prompt = this.promptTurns.get(turn);
    return prompt && prompt === this.lastPrompt ? prompt : null;
  }

  /**
   * The reported prompt or reply a saved row belongs to, else its nearest reported
   * ancestor. Hidden rows, tool rows and rows of a turn all lead to their message.
   */
  messageOf(id: string | null): string | null {
    for (let steps = 0; id !== null && steps <= this.parents.size; steps++) {
      if (this.prompts.has(id)) return id;
      const reply = this.replyFor.get(id);
      if (reply) return reply;
      id = this.parents.get(id) ?? null;
    }
    return null;
  }

  /** Reads one saved row; returns the messages it completes. */
  add(row: unknown): ChatgptHistoryRow[] {
    if (!record(row) || !historyUUID(row.id))
      throw new Error("history_unsupported");
    this.parents.set(
      row.id,
      historyUUID(row.metadata?.parent_id) ? row.metadata.parent_id : null,
    );
    const role = row.author?.role;
    const request = historyUUID(row.metadata?.request_id)
      ? row.metadata.request_id
      : null;
    if (role === "user") {
      if (hidden(row)) return [];
      // A prompt ends the turn before it.
      const out = this.flush(true);
      this.promptSeen = true;
      out.push(this.prompt(row, request));
      return out;
    }
    if (role !== "assistant" && role !== "tool") return [];
    const group = this.group;
    // Rows without a request belong to the turn they follow; another request starts a
    // new reply, such as a regenerated answer.
    if (
      group &&
      (request === null || group.request === null || group.request === request)
    ) {
      if (request !== null && group.request === null) {
        if (this.reported.has(request)) throw new Error("history_unsupported");
        group.request = request;
      }
      group.rows.push(row);
      return [];
    }
    const out = this.flush(true);
    if (request !== null && this.reported.has(request))
      throw new Error("history_unsupported");
    this.group = { request, rows: [row], cut: !this.promptSeen };
    return out;
  }

  /** Ends the page: the open turn is reported only if it shows its end. */
  finish(): ChatgptHistoryRow[] {
    return this.flush(false);
  }

  private prompt(
    row: Record<string, any>,
    request: string | null,
  ): ChatgptHistoryRow {
    const message = historyMessage(row.id, "prompt");
    message.requestId = row.id;
    const created = storedTime(row.create_time);
    if (created !== null) {
      message.occurredAt = new Date(created * 1000).toISOString();
      message.dateBasis = "message_created";
    }
    // Typed text or a voice transcript (A9).
    const text = chatgptPromptText(row.content);
    if (text !== null && boundedText(text)) message.text = text;
    message.complete =
      message.text !== null && row.status === "finished_successfully";
    // Uploaded image sizes (A7); a part of an unknown kind leaves them unknown.
    const images = chatgptUploadedImages(row.content);
    if (images && images.length <= GENERATED_TEXT_LIMITS.inputImages)
      message.inputImages = images;
    const parentRef = this.messageOf(
      historyUUID(row.metadata?.parent_id) ? row.metadata.parent_id : null,
    );
    this.prompts.add(row.id);
    this.lastPrompt = row.id;
    const turn = row.metadata?.turn_exchange_id;
    if (typeof turn === "string" && turn)
      this.promptTurns.set(turn, this.promptTurns.has(turn) ? null : row.id);
    return { message, requestRef: request, parentRef };
  }

  private flush(followed: boolean): ChatgptHistoryRow[] {
    const group = this.group;
    this.group = null;
    if (!group) return [];
    const { rows } = group;
    const turn = chatgptTurn(rows);
    // Hidden context alone is not a reply.
    if (!turn.attemptId) return [];
    const finals = rows.filter(isChatgptFinal);
    const lastFinal = finals.at(-1);
    const stopped = rows.some(stoppedJob);
    const images = turnImages(rows);
    // The turn's own end: its last answer ends the turn, or a turn without an answer
    // marks its end on another message, or its image job was stopped. An image turn
    // without an answer ends when its images are final: its last message, the "Thought
    // for" label, does not mark the end (5 Oct 2026).
    const finished =
      stopped ||
      (lastFinal
        ? lastFinal.end_turn === true
        : rows.some(
            (row) => row.author?.role === "assistant" && row.end_turn === true,
          ) || !!images?.done);
    const research = rows
      .map(deepResearch)
      .filter((run): run is Research => run !== null);
    const researchRunning = research.some((run) => !run.done);
    const running = !finished && (researchRunning || !!images?.running);
    const ended =
      followed || finished || (research.length > 0 && !researchRunning);
    // A turn without an answer is reported once it shows its end. While it runs (an image
    // or research in progress) a later read reports it whole, so no partial copy is kept
    // that the later read would contradict (N9).
    if (!lastFinal && !turn.answerUnreadable && !ended) return [];
    if (group.request) this.reported.add(group.request);
    const parentRef =
      this.messageOf(
        historyUUID(rows[0]!.metadata?.parent_id)
          ? rows[0]!.metadata.parent_id
          : null,
      ) ?? this.turnPrompt(rows);
    for (const row of rows) this.replyFor.set(row.id, turn.attemptId);
    if (this.onAnswer)
      for (const row of finals) {
        const own = chatgptTurn([row]).answer;
        if (own) this.onAnswer([row.id], own.length);
      }
    const attempt = rows.find((row) => row.id === turn.attemptId)!;
    const message = historyMessage(turn.attemptId, "response");
    message.liveAttemptId = turn.attemptId;
    message.modelId = turn.model;
    // The attempt message dates the reply; it stays the same while the turn grows.
    const created = storedTime(attempt.create_time);
    if (created !== null) {
      message.occurredAt = new Date(created * 1000).toISOString();
      message.dateBasis = "message_created";
    }
    if (!turn.answerUnreadable) {
      // An answer of a content type not yet seen is unknown, not zero.
      const answer = turn.answer ?? (turn.answerUnknown ? null : "");
      if (answer !== null && boundedText(answer)) message.text = answer;
    }
    message.complete =
      message.text !== null &&
      !running &&
      (lastFinal
        ? finals.every((row) => row.status === "finished_successfully") &&
          // Work answers carry no `is_complete` (N8); the end of the turn says the same.
          (lastFinal.metadata?.is_complete === true ||
            lastFinal.end_turn === true)
        : ended);
    const reasons = new Set<HistoryCoverageReason>();
    if (turn.unknown) reasons.add("unknown_event_observed");
    // A turn that began on an earlier page shows only part of its thinking, tool calls and
    // results, so those parts stay unknown; its answer is whole.
    if (!group.cut)
      for (const [key, text] of [
        ["thinking", turn.thinking],
        ["toolInput", turn.toolInput],
        ["intermediate", turn.intermediate],
        ["toolOutput", turn.toolOutput],
      ] as const)
        if (boundedText(text)) message[key] = text;
    const components: GeneratedComponent[] = [];
    if (research.length) reasons.add("research_work_unobserved");
    for (const run of research) {
      if (run.text === null) {
        reasons.add("unknown_event_observed");
        continue;
      }
      if (!run.text) continue;
      if (components.length === GENERATED_TEXT_LIMITS.components) {
        reasons.add("unknown_event_observed");
        break;
      }
      // The research model's own span (C1), shown once the run ended.
      const timing =
        run.done && run.seconds !== null
          ? timingEvidence(
              run.seconds,
              "chatgpt_history",
              "complete_for_scope",
              "research_task",
            )
          : null;
      components.push({
        role: "research",
        model: run.model,
        text: run.text,
        outputTokens: null,
        ...(timing ? { timing } : {}),
      });
    }
    if (components.length) message.components = components;
    let media: GeneratedMedia[] = images?.media ?? [];
    if (!images) reasons.add("unknown_event_observed");
    const speech = turn.speechCharacters > 0 ? 1 : 0;
    if (media.length + speech > GENERATED_TEXT_LIMITS.media) {
      media = [];
      reasons.add("unknown_event_observed");
    }
    // Voice replies keep no audio length; it follows from the transcript (EP1).
    if (speech)
      media.push({
        kind: "speech",
        basis: "characters",
        seconds: null,
        characters: turn.speechCharacters,
      });
    if (media.length) message.media = media;
    // One message fits one counting batch. Tool results go first, then intermediate text,
    // tool input and thinking; a part left out stays unknown.
    for (const key of [
      "toolOutput",
      "intermediate",
      "toolInput",
      "thinking",
    ] as const)
      if (
        message[key] &&
        historyMessageUnits(message) > HISTORY_LIMITS.textUnits
      ) {
        delete message[key];
        reasons.add("capture_limit_exceeded");
      }
    if (historyMessageUnits(message) > HISTORY_LIMITS.textUnits) {
      delete message.components;
      reasons.add("capture_limit_exceeded");
    }
    if (reasons.size) message.coverageReasons = [...reasons];
    const interrupted = finals.some(
      (row) =>
        row.metadata?.finish_details?.type === "interrupted" ||
        row.metadata?.finish_details?.reason === "client_stopped",
    );
    // A research turn is timed by its research span instead; a stopped turn is not timed,
    // nor a turn that began on an earlier page, whose start is not here.
    if (
      message.complete &&
      !interrupted &&
      !stopped &&
      !research.length &&
      !group.cut
    )
      message.timing = turnSpan(rows, lastFinal, attempt);
    return [{ message, requestRef: group.request, parentRef }];
  }
}

export function chatgptHistory(
  value: unknown,
  conversationId: string,
  observedAt: string,
  /** A page of turns before the first one the page showed; only its address names the chat. */
  earlier = false,
) {
  if (
    !record(value) ||
    (earlier
      ? "conversation_id" in value || "current_node" in value
      : value.conversation_id !== conversationId) ||
    !Array.isArray(value.messages)
  )
    throw new Error("history_unsupported");
  const page = historyPage("chatgpt", conversationId, observedAt);
  const turns = new ChatgptTurns();
  const ids = new Set<string>();
  const rows: ChatgptHistoryRow[] = [];
  for (const row of value.messages) {
    if (!record(row) || !historyUUID(row.id) || ids.has(row.id))
      throw new Error("history_unsupported");
    ids.add(row.id);
    rows.push(...turns.add(row));
  }
  rows.push(...turns.finish());
  // A reply names its prompt through their shared request; two prompts of one request
  // leave it unknown.
  const requestPrompts = new Map<string, string | null>();
  for (const { message, requestRef } of rows)
    if (message.role === "prompt" && requestRef)
      requestPrompts.set(
        requestRef,
        requestPrompts.has(requestRef) ? null : message.sourceId,
      );
  const roles = new Map(
    rows.map(({ message }) => [message.sourceId, message.role]),
  );
  for (const { message, requestRef, parentRef } of rows) {
    if (message.role === "response")
      message.promptSourceId = requestRef
        ? (requestPrompts.get(requestRef) ?? null)
        : null;
    const parentRole = parentRef ? (roles.get(parentRef) ?? null) : null;
    if (parentRole) {
      message.parentSourceId = parentRef;
      message.parentRole = parentRole;
    }
    page.messages.push(message);
  }
  if (record(value.page_info)) {
    page.hasEarlier =
      typeof value.page_info.has_previous_page === "boolean"
        ? value.page_info.has_previous_page
        : null;
    page.hasLater =
      typeof value.page_info.has_next_page === "boolean"
        ? value.page_info.has_next_page
        : null;
  }
  if (historyUUID(value.current_node))
    page.selectedLeafId = turns.messageOf(value.current_node);
  const firstPrompt = value.messages.findIndex(
    (row: any) => row.author?.role === "user" && !hidden(row),
  );
  // The page opens at the chat's first prompt, or at the hidden system message ChatGPT
  // saved before it until October 2026. Since then that message followed the first prompt
  // (seen 12 Oct 2026), Work chats (origin "tpp") never had one (5 Oct 2026) and chats begun
  // since 18 Oct 2026 have none at all. A page in the middle of a chat also opens at a
  // prompt, so only the page boundary checked below (nothing earlier, exact cursors) tells
  // the chat's start from the middle.
  const startsAtRoot =
    firstPrompt === 0 ||
    (firstPrompt === 1 &&
      value.messages[0].author?.role === "system" &&
      hidden(value.messages[0]));
  // This proves the first available request of the loaded page, not every branch or execution.
  if (
    startsAtRoot &&
    value.page_info?.has_previous_page === false &&
    value.page_info?.has_next_page === earlier &&
    value.page_info.start_cursor === value.messages[0].id &&
    value.page_info.end_cursor === value.messages.at(-1)?.id &&
    (earlier
      ? !("context_truncation_continuation" in value)
      : value.current_node === value.messages.at(-1)?.id &&
        value.context_truncation_continuation === null)
  ) {
    page.firstRequestVerified = true;
    page.rootSourceId = value.messages[firstPrompt].id;
  }
  return finishHistoryPage(page);
}
