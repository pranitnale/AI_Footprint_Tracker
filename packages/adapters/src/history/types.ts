import { LIMITS, type Site, type TimingEvidence } from "@footprint/capture-core";
import type { GeneratedText, InputImage } from "../types";

export const HISTORY_LIMITS = Object.freeze({
  /** Request bodies and small lists (NotebookLM's chat sessions) read whole. */
  responseBytes: 1048576,
  /**
   * Google batch responses (Gemini, NotebookLM) are decoded whole, so their bytes are held
   * at once; a body past this is refused as too large. JSON bodies of the other sites are
   * parsed as they stream and have no byte limit in the page's own reads.
   */
  wholeResponseBytes: 16 * 1048576,
  /**
   * Text of one saved message (all its parts together) and of one text field, the same as
   * a live reply (14 Oct 2026): a long reply with code saved in a chat counts as it did live.
   * A part past the limit is left out and the message names `capture_limit_exceeded`.
   */
  textUnits: 2 * LIMITS.text,
  messageUnits: LIMITS.text,
  messages: 1000,
  countBatch: 100,
  /** Content blocks of one saved reply, as many as a live frame may list. */
  blocks: LIMITS.items,
  inlineFiles: 16,
  /** One attached file's text, as the token counter takes it (`inlineFileTextUnits`). */
  inlineFileUnits: 262144,
  active: 2,
  readCalls: 8192,
  lifetimeMs: 30000,
});
/**
 * Why a saved message was read in part. Each becomes a coverage reason of the message,
 * which Details explains (S3.5); nothing else about the message changes.
 */
export const HISTORY_COVERAGE_REASONS = [
  "unknown_event_observed",
  "research_work_unobserved",
  "reasoning_summary_only",
  "side_calls_unobserved",
  "file_size_estimated",
  "content_not_opened",
  // A part of the message was longer than the reader takes (HISTORY_LIMITS), so it was left
  // out and is not counted.
  "capture_limit_exceeded",
  // A saved row no live capture can produce, such as a NotebookLM Studio item; it is
  // counted from history alone and never waits for a live match (W9).
  "no_live_request",
] as const;
export type HistoryCoverageReason = (typeof HISTORY_COVERAGE_REASONS)[number];
export interface HistoryTextMessage extends GeneratedText {
  sourceId: string;
  role: "prompt" | "response";
  promptSourceId: string | null;
  parentSourceId: string | null;
  parentRole: "prompt" | "response" | null;
  requestId: string | null;
  liveAttemptId: string | null;
  /**
   * NotebookLM chat answers: the id its live reply names it by (`notebooklmReplyId`), since
   * the saved answer keeps no id the stream named (16 Oct 2026). No other row sets it.
   */
  contentId?: string;
  timing: TimingEvidence | null;
  occurredAt: string | null;
  dateBasis: "message_created" | "entry_created" | "turn_created" | "unknown";
  /** Raw provider model label when the page exposes one; consumers normalize it via the registry. */
  modelId: string | null;
  text: string | null;
  /** Reasoning text the site shows for a reply; left out when the parser cannot read it. */
  thinking?: string;
  complete: boolean;
  inlineFiles: Array<{ text: string }> | null;
  /** Sizes of images uploaded with a prompt (A7). */
  inputImages?: InputImage[];
  /** Why parts of this message were not read; left out when none apply. */
  coverageReasons?: HistoryCoverageReason[];
  /**
   * The session's counters a Cowork result reports. The background turns them into this
   * reply's own counts; no other site sets this field.
   */
  cumulative?: CoworkCumulative;
  /**
   * Files Perplexity Computer created in this reply (owner decision of 14 Oct 2026). Text
   * and code files count as output of the reply's model; no other site sets this field.
   */
  computerFiles?: ComputerFileRow[];
}
/**
 * One file Perplexity Computer created. The reader lists it as `unread` (text and code
 * files) or `other`; the page world then downloads text files read-only and sets:
 * - `content`: counted from its content. `text` holds it when it was downloaded in this
 *   read; without `text` it was counted before and the saved count is used.
 * - `size`: it could not be downloaded, so it counts as its size in bytes divided by 4.
 * - `unread`: not downloaded in this read (hidden tab, a pause, a limit); not counted, and
 *   the reply's tool input stays partly measured until a later read.
 * - `other`: not a text or code file; never counted, and Details names it.
 * The file's link never leaves the page world, and its text is counted and dropped.
 */
export interface ComputerFileRow {
  /** The asset's root id; turned into a keyed hash before anything is stored. */
  id: string;
  name: string;
  bytes: number;
  kind: "text" | "other";
  state: "content" | "size" | "unread" | "other";
  text?: string;
}
/** Most Computer files one reply lists; more are not read and make it partial. */
export const COMPUTER_FILES_PER_REPLY = 64;
/** One model's exact counts so far in a Cowork session, as a result reports them. */
export interface CoworkModelCount {
  model: string;
  output: number;
  /** Thinking tokens included in `output`, when the result names them. */
  reasoning: number | null;
}
/**
 * The cumulative counters a Cowork result reports (owner, 2 Oct, question 14): output and
 * thinking per model, which include side calls and sub-agents, and the API time so far.
 */
export interface CoworkCumulative {
  /** The result's event sequence number in its session. */
  sequence: number;
  models: CoworkModelCount[];
  apiMs: number | null;
}
/** Provider identities and text are transient inputs, never durable telemetry. */
export interface HistoryTextPage {
  site: Site;
  conversationId: string;
  observedAt: string;
  messages: HistoryTextMessage[];
  firstRequestVerified: boolean;
  rootSourceId: string | null;
  selectedLeafId: string | null;
  branchSourceIds: string[] | null;
  branchScope: "selected_branch" | "loaded_messages" | "unknown";
  hasEarlier: boolean | null;
  hasLater: boolean | null;
  status: "partial" | "unsupported";
}
