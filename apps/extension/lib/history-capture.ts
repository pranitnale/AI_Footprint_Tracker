import {
  COMPUTER_FILES_PER_REPLY,
  HISTORY_COVERAGE_REASONS,
  HISTORY_LIMITS,
  generatedTextKeys,
  historyInstant,
  historyMessageUnits,
  notebooklmId,
  validCoworkCumulative,
  validGeneratedText,
  validInputImages,
  type ComputerFileRow,
  type HistoryTextPage,
  type HistoryTextMessage,
} from "@footprint/adapters";
import {
  siteForHost,
  isCoworkSessionId,
  isRouteConversationId,
  isTimingEvidence,
} from "@footprint/capture-core";
import {
  MODEL_LABEL_PATTERN,
  TokenMeasurementSchema,
  providerMeasurement,
  unknownMeasurement,
  type ReplyTextPart,
  type TokenMeasurement,
  type ExtractedFileTextComponent,
} from "@footprint/contracts";
import type { GeneratedComponent } from "@footprint/adapters";
import { inlineFileComponents, knownCount } from "./inline-file-components";
import {
  snapshotCountingRuntime,
  validCountResponse,
  type CountingRuntime,
  type CountField,
  type CountRequest,
  type CountResponse,
} from "@footprint/tokenizers/metadata";
import { PACKAGED_COUNTING_RUNTIME } from "./counting-config";

export const HISTORY_CAPTURE_CHANNEL = "ai-footprint-history-observation-v1";
export const HISTORY_RESET_CHANNEL = "ai-footprint-history-reset-v1";
export const HISTORY_DIAGNOSTIC_CHANNEL = "ai-footprint-history-diagnostic-v1";
export interface HistoryDiagnostic {
  channel: typeof HISTORY_DIAGNOSTIC_CHANNEL;
  site: HistoryTextPage["site"];
  conversationId: string;
  observedAt: string;
  id: string | null;
  reason:
    | "history_limit"
    | "history_timeout"
    | "history_response_limit"
    | "history_text_limit"
    | "history_message_limit"
    | NotebooklmChatProblem;
}
/**
 * Why a page of a notebook's saved chat was not counted: passed by while other reads of the
 * notebook were loading, not finished in time, or not readable or not accepted. NotebookLM
 * reads its saved chat once per document, so the reason stays in Details for the navigation
 * instead of being cleared by the next Studio read (14 Oct 2026).
 */
export type NotebooklmChatProblem =
  | "notebooklm_chat_busy"
  | "notebooklm_chat_timeout"
  | "notebooklm_chat_unread";
export const NOTEBOOKLM_CHAT_PROBLEMS: ReadonlySet<string> = new Set([
  "notebooklm_chat_busy",
  "notebooklm_chat_timeout",
  "notebooklm_chat_unread",
]);
export interface HistoryCaptureMessage {
  channel: typeof HISTORY_CAPTURE_CHANNEL;
  event: "start" | "page";
  id: string;
  site: HistoryTextPage["site"];
  conversationId: string;
  observedAt: string;
  page: HistoryTextPage | null;
}
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    v,
  );
const sourceId = (site: string, v: unknown, role?: string) =>
  site === "gemini"
    ? typeof v === "string" &&
      (role === "prompt"
        ? /^r_[0-9a-f]{16}$/
        : role === "response"
          ? /^rc_[0-9a-f]{16}$/
          : /^r(?:c)?_[0-9a-f]{16}$/
      ).test(v)
    : site === "notebooklm"
      ? notebooklmId(v)
      : uuid(v);
const nullableId = (site: string, v: unknown, role?: string) =>
  v === null || sourceId(site, v, role);
const exact = (v: unknown, keys: string[]): v is Record<string, any> =>
  !!v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).sort().join(",") === [...keys].sort().join(",");
// Fields a parser adds only when it reads them: reasoning, generated text, upload sizes,
// the reasons a message was read in part and a Cowork result's counters.
const optionalMessageKeys = (m: object) => [
  ...generatedTextKeys(m),
  ...[
    "thinking",
    "inputImages",
    "coverageReasons",
    "cumulative",
    "computerFiles",
    "contentId",
  ].filter((key) => Object.hasOwn(m, key)),
];
const ASSET_ID = /^[A-Za-z0-9_-]{1,128}$/;
/**
 * The largest size a Perplexity Computer text file may state, and the largest the text
 * files of one reply may state together, to be counted: 32 MiB, the most the tracker reads
 * of any one response body. The sizes come from the page world, which page scripts can
 * reach, so a file past the limit is not counted at all (Details names it and the reply
 * stays partly measured). Clamping it would turn a forged size into a plausible figure.
 * A count never exceeds the bytes it came from, so one reply's files add at most this
 * many tokens.
 */
export const COMPUTER_FILE_LIMIT_BYTES = 32 * 1048576;
/**
 * The ids of a reply's text files past COMPUTER_FILE_LIMIT_BYTES, alone or added to the
 * files listed before them. Every text file takes its place in the sum whatever its state,
 * so each read of the reply rejects the same files.
 */
export function computerFilesOverLimit(
  files: readonly ComputerFileRow[] | undefined,
): Set<string> {
  const over = new Set<string>();
  let total = 0;
  for (const file of files ?? []) {
    if (file.kind !== "text") continue;
    if (file.bytes > COMPUTER_FILE_LIMIT_BYTES - total) over.add(file.id);
    else total += file.bytes;
  }
  return over;
}
/**
 * The files Perplexity Computer created in a saved reply: names and sizes, and the text
 * of a text or code file only once it was downloaded to be counted (14 Oct 2026).
 */
function validComputerFiles(site: string, m: Record<string, any>): boolean {
  const files = m.computerFiles;
  if (
    site !== "perplexity" ||
    m.role !== "response" ||
    !Array.isArray(files) ||
    !files.length ||
    files.length > COMPUTER_FILES_PER_REPLY
  )
    return false;
  const ids = new Set<string>();
  for (const file of files) {
    if (
      !exact(file, [
        "id",
        "name",
        "bytes",
        "kind",
        "state",
        ...(Object.hasOwn(file, "text") ? ["text"] : []),
      ]) ||
      typeof file.id !== "string" ||
      !ASSET_ID.test(file.id) ||
      ids.has(file.id) ||
      typeof file.name !== "string" ||
      !file.name.length ||
      file.name.length > 255 ||
      /[\u0000-\u001f\u007f]/.test(file.name) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      !(file.kind === "text"
        ? ["content", "size", "unread"].includes(file.state)
        : file.kind === "other" && file.state === "other") ||
      (Object.hasOwn(file, "text") &&
        (file.state !== "content" ||
          typeof file.text !== "string" ||
          file.text.length > HISTORY_LIMITS.messageUnits))
    )
      return false;
    ids.add(file.id);
  }
  return true;
}
/**
 * Generated text belongs to replies and uploaded images to prompts. Each text field is
 * bounded like the answer text.
 */
function validMessageExtras(site: string, m: Record<string, any>): boolean {
  if (
    m.role === "prompt" &&
    (generatedTextKeys(m).length > 0 || Object.hasOwn(m, "thinking"))
  )
    return false;
  if (m.role === "response" && Object.hasOwn(m, "inputImages")) return false;
  if (
    Object.hasOwn(m, "thinking") &&
    (typeof m.thinking !== "string" ||
      m.thinking.length > HISTORY_LIMITS.messageUnits)
  )
    return false;
  for (const key of ["toolInput", "intermediate", "toolOutput"])
    if (
      Object.hasOwn(m, key) &&
      (typeof m[key] !== "string" || m[key].length > HISTORY_LIMITS.messageUnits)
    )
      return false;
  if (Object.hasOwn(m, "inputImages") && !validInputImages(m.inputImages))
    return false;
  if (Object.hasOwn(m, "computerFiles") && !validComputerFiles(site, m))
    return false;
  // A component's own time comes from the same saved page as the reply.
  if (
    Array.isArray(m.components) &&
    m.components.some(
      (component: unknown) =>
        !!component &&
        typeof component === "object" &&
        Object.hasOwn(component, "timing") &&
        (component as { timing?: { source?: unknown } }).timing?.source !==
          site + "_history",
    )
  )
    return false;
  if (
    Object.hasOwn(m, "coverageReasons") &&
    (!Array.isArray(m.coverageReasons) ||
      !m.coverageReasons.length ||
      new Set(m.coverageReasons).size !== m.coverageReasons.length ||
      !m.coverageReasons.every((reason: unknown) =>
        (HISTORY_COVERAGE_REASONS as readonly unknown[]).includes(reason),
      ))
  )
    return false;
  // Only NotebookLM's Studio rows have no live request (W9). Its saved chat turns wait for
  // a live match, and a saved row that skipped live matching elsewhere would count twice.
  if (site !== "notebooklm" && studioRow(m)) return false;
  // Only a saved NotebookLM chat answer names its live reply by content (16 Oct 2026).
  if (
    Object.hasOwn(m, "contentId") &&
    (site !== "notebooklm" ||
      m.role !== "response" ||
      studioRow(m) ||
      typeof m.contentId !== "string" ||
      !/^n_[0-9a-f]{16}$/.test(m.contentId))
  )
    return false;
  return validGeneratedText(m, site);
}
/** A NotebookLM Studio row: no live capture ever sees its request (W9). */
const studioRow = (m: unknown) =>
  !!m &&
  typeof m === "object" &&
  Array.isArray((m as { coverageReasons?: unknown }).coverageReasons) &&
  (m as { coverageReasons: unknown[] }).coverageReasons.includes(
    "no_live_request",
  );
/**
 * A NotebookLM read holds Studio rows or saved chat turns, never both: the Studio list and
 * opened items have no live request, while chat turns wait for their live match. Null for
 * a read that mixes them.
 */
export function notebooklmRows(
  messages: ReadonlyArray<unknown>,
): "studio" | "chat" | null {
  const studio = messages.filter(studioRow).length;
  return studio === messages.length ? "studio" : studio ? null : "chat";
}
export function validateHistoryDiagnostic(
  value: unknown,
  host: string,
): value is HistoryDiagnostic {
  if (
    !exact(value, [
      "channel",
      "site",
      "conversationId",
      "observedAt",
      "id",
      "reason",
    ]) ||
    value.channel !== HISTORY_DIAGNOSTIC_CHANNEL ||
    value.site !== siteForHost(host) ||
    !isRouteConversationId(value.site, value.conversationId) ||
    typeof value.observedAt !== "string" ||
    value.observedAt.length !== 24 ||
    historyInstant(value.observedAt) !== value.observedAt
  )
    return false;
  if (NOTEBOOKLM_CHAT_PROBLEMS.has(value.reason))
    return value.site === "notebooklm" && value.id === null;
  return [
    "history_limit",
    "history_response_limit",
    "history_text_limit",
    "history_message_limit",
  ].includes(value.reason)
    ? value.id === null
    : value.reason === "history_timeout" &&
        uuid(value.id) &&
        value.id[14] === "4";
}
const pageKeys = [
  "site",
  "conversationId",
  "observedAt",
  "messages",
  "firstRequestVerified",
  "rootSourceId",
  "selectedLeafId",
  "branchSourceIds",
  "branchScope",
  "hasEarlier",
  "hasLater",
  "status",
];
const messageKeys = [
  "sourceId",
  "role",
  "promptSourceId",
  "parentSourceId",
  "parentRole",
  "requestId",
  "liveAttemptId",
  "timing",
  "occurredAt",
  "dateBasis",
  "modelId",
  "text",
  "complete",
  "inlineFiles",
];

function validLiveAttempt(site: string, m: Record<string, any>): boolean {
  if (m.liveAttemptId === null) return true;
  if (m.role !== "response" || (site === "notebooklm" && studioRow(m)))
    return false;
  if (site === "perplexity")
    return (
      typeof m.liveAttemptId === "string" &&
      (/^[0-9a-f]{32}$/.test(m.liveAttemptId) || uuid(m.liveAttemptId))
    );
  return (
    sourceId(site, m.liveAttemptId, "response") &&
    m.liveAttemptId === m.sourceId
  );
}
function validRequestIdentity(site: string, m: Record<string, any>): boolean {
  if (site === "perplexity") return m.requestId === m.sourceId;
  if (site === "gemini") return m.requestId === m.promptSourceId;
  if (site === "chatgpt")
    return m.requestId === (m.role === "prompt" ? m.sourceId : null);
  return m.requestId === null;
}

export function validHistoryTextPage(value: unknown): value is HistoryTextPage {
  if (
    !exact(value, pageKeys) ||
    !["chatgpt", "claude", "perplexity", "gemini", "notebooklm"].includes(
      value.site,
    ) ||
    // Studio reads are not a chat: no first message or selected branch (W9). A saved chat
    // has no branches; its oldest page proves its first message.
    (value.site === "notebooklm" &&
      (value.branchScope === "selected_branch" ||
        !Array.isArray(value.messages) ||
        notebooklmRows(value.messages) === null ||
        (value.firstRequestVerified &&
          notebooklmRows(value.messages) !== "chat"))) ||
    !isRouteConversationId(value.site, value.conversationId) ||
    typeof value.observedAt !== "string" ||
    historyInstant(value.observedAt) !== value.observedAt ||
    value.observedAt.length !== 24 ||
    !Array.isArray(value.messages) ||
    (value.site !== "claude" &&
      value.messages.length > HISTORY_LIMITS.messages) ||
    typeof value.firstRequestVerified !== "boolean" ||
    !nullableId(value.site, value.rootSourceId, "prompt") ||
    !nullableId(value.site, value.selectedLeafId) ||
    !["selected_branch", "loaded_messages", "unknown"].includes(
      value.branchScope,
    ) ||
    !["partial", "unsupported"].includes(value.status) ||
    ![null, false, true].includes(value.hasEarlier) ||
    ![null, false, true].includes(value.hasLater)
  )
    return false;
  if (
    value.branchSourceIds !== null &&
    (!Array.isArray(value.branchSourceIds) ||
      (value.site !== "claude" &&
        value.branchSourceIds.length > HISTORY_LIMITS.messages) ||
      !value.branchSourceIds.every((id: unknown) => sourceId(value.site, id)) ||
      new Set(value.branchSourceIds).size !== value.branchSourceIds.length)
  )
    return false;
  let units = 0;
  const ids = new Set<string>();
  // Every Cowork reply carries its result's counters; nothing else may (W5).
  const cowork =
    value.site === "claude" && isCoworkSessionId(value.conversationId);
  for (const m of value.messages) {
    if (
      !exact(m, [...messageKeys, ...optionalMessageKeys(m)]) ||
      !validMessageExtras(value.site, m) ||
      (Object.hasOwn(m, "cumulative")
        ? !cowork ||
          m.role !== "response" ||
          !validCoworkCumulative(m.cumulative)
        : cowork && m.role === "response") ||
      !sourceId(value.site, m.sourceId, m.role) ||
      !["prompt", "response"].includes(m.role) ||
      !nullableId(value.site, m.promptSourceId, "prompt") ||
      (m.role === "prompt" && m.promptSourceId !== m.sourceId) ||
      !nullableId(value.site, m.parentSourceId, m.parentRole) ||
      ![null, "prompt", "response"].includes(m.parentRole) ||
      (m.parentSourceId === null) !== (m.parentRole === null) ||
      !nullableId(value.site, m.requestId) ||
      !validLiveAttempt(value.site, m) ||
      !validRequestIdentity(value.site, m) ||
      (m.timing !== null &&
        (!isTimingEvidence(m.timing) ||
          m.role !== "response" ||
          m.timing.source !==
            (cowork ? "cowork_history" : value.site + "_history") ||
          value.site === "gemini" ||
          (m.timing.completeness === "complete_for_scope" && !m.complete))) ||
      (m.occurredAt !== null &&
        historyInstant(m.occurredAt) !== m.occurredAt) ||
      !["message_created", "entry_created", "turn_created", "unknown"].includes(
        m.dateBasis,
      ) ||
      (m.occurredAt === null) !== (m.dateBasis === "unknown") ||
      // Every site may name a model (Perplexity prompts carry the selection); labels
      // follow the local label rule.
      (m.modelId !== null &&
        (typeof m.modelId !== "string" ||
          !MODEL_LABEL_PATTERN.test(m.modelId))) ||
      typeof m.complete !== "boolean" ||
      (m.text !== null &&
        (typeof m.text !== "string" ||
          m.text.length > HISTORY_LIMITS.messageUnits)) ||
      (m.complete && m.text === null)
    )
      return false;
    const key = m.role + ":" + m.sourceId;
    if (ids.has(key)) return false;
    ids.add(key);
    if (m.inlineFiles !== null) {
      if (
        !Array.isArray(m.inlineFiles) ||
        m.inlineFiles.length > HISTORY_LIMITS.inlineFiles
      )
        return false;
      for (const file of m.inlineFiles) {
        if (
          !exact(file, ["text"]) ||
          typeof file.text !== "string" ||
          file.text.length > HISTORY_LIMITS.inlineFileUnits
        )
          return false;
      }
    }
    units += historyMessageUnits(m as HistoryTextMessage);
  }
  if (value.site !== "claude" && units > HISTORY_LIMITS.textUnits) return false;
  if (
    value.firstRequestVerified &&
    (!value.rootSourceId ||
      (value.branchScope !== "selected_branch" &&
        !(
          // A Claude chat holds every branch; its selected branch proves the start (14 Oct).
          (["chatgpt", "perplexity", "notebooklm", "claude"].includes(value.site) ||
            // A Cowork session has no branches; its events prove its start (6 Oct).
            isCoworkSessionId(value.conversationId)) &&
          value.branchScope === "loaded_messages"
        )) ||
      !value.messages.some(
        (m: HistoryTextMessage) =>
          m.sourceId === value.rootSourceId && m.role === "prompt",
      ) ||
      // Cowork pages hold messages in event order, so the first request comes first.
      (isCoworkSessionId(value.conversationId) &&
        (value.messages[0]?.sourceId !== value.rootSourceId ||
          value.messages[0]?.role !== "prompt")) ||
      value.hasEarlier !== false)
  )
    return false;
  if (!value.firstRequestVerified && value.rootSourceId !== null) return false;
  if (
    value.branchScope === "selected_branch" &&
    (!value.selectedLeafId ||
      !value.branchSourceIds?.length ||
      value.branchSourceIds.at(-1) !== value.selectedLeafId ||
      value.messages.some(
        (m: HistoryTextMessage) => !value.branchSourceIds.includes(m.sourceId),
      ))
  )
    return false;
  return (
    value.status !== "unsupported" ||
    (!value.messages.length && !value.firstRequestVerified)
  );
}
/**
 * A Studio item's reply follows its own request; a request may stand alone while its item
 * generates or until a flashcard set, quiz or mind map is opened (W9).
 */
export function validStudioPairs(
  messages: ReadonlyArray<
    Pick<
      HistoryTextMessage,
      "sourceId" | "role" | "promptSourceId" | "parentSourceId" | "parentRole"
    >
  >,
): boolean {
  return messages.every((row, index) => {
    const prompt = index ? messages[index - 1]! : null;
    return row.role === "prompt"
      ? row.parentSourceId === null && row.promptSourceId === row.sourceId
      : !!prompt &&
          prompt.role === "prompt" &&
          prompt.sourceId === row.sourceId &&
          row.promptSourceId === row.sourceId &&
          row.parentSourceId === row.sourceId &&
          row.parentRole === "prompt";
  });
}
/**
 * Studio requests show no text of their own: their instructions are hidden and titles are
 * never counted, so each prompt row holds no text and is read in part (W9 review).
 */
export function validStudioPrompts(
  messages: ReadonlyArray<Pick<HistoryTextMessage, "role" | "text" | "complete">>,
): boolean {
  return messages.every(
    (row) => row.role !== "prompt" || (row.text === "" && !row.complete),
  );
}
/** Isolated/background callers validate this transient family separately from live CaptureMessage. */
export function validateHistoryCapture(
  value: unknown,
  host: string,
): value is HistoryCaptureMessage {
  if (
    !exact(value, [
      "channel",
      "event",
      "id",
      "site",
      "conversationId",
      "observedAt",
      "page",
    ]) ||
    value.channel !== HISTORY_CAPTURE_CHANNEL ||
    !uuid(value.id) ||
    value.id[14] !== "4" ||
    value.site !== siteForHost(host) ||
    !isRouteConversationId(value.site, value.conversationId) ||
    typeof value.observedAt !== "string" ||
    value.observedAt.length !== 24 ||
    historyInstant(value.observedAt) !== value.observedAt
  )
    return false;
  if (value.event === "start") return value.page === null;
  return (
    value.event === "page" &&
    validHistoryTextPage(value.page) &&
    (value.site !== "notebooklm" ||
      notebooklmRows(value.page.messages) === "chat" ||
      (validStudioPairs(value.page.messages) &&
        validStudioPrompts(value.page.messages))) &&
    value.page.site === value.site &&
    value.page.conversationId === value.conversationId &&
    value.page.observedAt === value.observedAt
  );
}
/** A reply's text parts besides the answer: message field, count field and token part. */
export const HISTORY_REPLY_PARTS = [
  ["thinking", "thinking", "visible_thinking"],
  ["toolInput", "tool_input", "tool_input"],
  ["intermediate", "intermediate", "intermediate_output"],
  ["toolOutput", "tool_output", "tool_output"],
] as const satisfies ReadonlyArray<
  readonly [keyof HistoryTextMessage, CountField, ReplyTextPart]
>;
/** Text that is counted and then dropped; it never leaves countHistoryPage. */
type CountedText =
  | "text"
  | "inlineFiles"
  | "thinking"
  | "toolInput"
  | "intermediate"
  | "toolOutput"
  | "components"
  | "computerFiles";
/**
 * A Perplexity Computer file's count, kept in the reply's local count basis under a keyed
 * hash of its id so a later read neither downloads nor counts it again (14 Oct 2026).
 */
export type SavedComputerFile = { tokens: string; basis: "content" | "size" };
/** A counted Computer file: its raw id (hashed before it is stored) and its count. */
export type CountedComputerFile = SavedComputerFile & { id: string };
export type CountedHistoryMessage = Omit<HistoryTextMessage, CountedText> & {
  /** The prompt's input or the reply's answer. */
  tokens: TokenMeasurement;
  /** Counts of the reply's other text parts; a part the parser does not read is absent. */
  partTokens: Partial<Record<ReplyTextPart, TokenMeasurement>>;
  /** Other-model text as raw label, count and its own time when shown, never text. */
  components: Array<{
    role: GeneratedComponent["role"];
    model: string | null;
    tokens: TokenMeasurement;
    timing?: GeneratedComponent["timing"] | null;
  }>;
  inlineFileComponents: Array<
    Omit<ExtractedFileTextComponent, "component_id">
  > | null;
  /**
   * The reply's text and code files Perplexity Computer created, each counted once and
   * added to its tool input; absent when it lists none or one was not read.
   */
  computerFileTokens?: CountedComputerFile[];
};
export type CountedHistoryPage = Omit<HistoryTextPage, "messages"> & {
  messages: CountedHistoryMessage[];
};
/** A saved count for a message whose text is unchanged, so it is not counted again. */
export type ReusedHistoryCount = Pick<
  CountedHistoryMessage,
  "tokens" | "partTokens" | "inlineFileComponents"
> & {
  /** Counted other-model text in order; null where the provider reported the count. */
  componentTokens: Array<TokenMeasurement | null>;
};
export type HistoryCounter = (
  job: CountRequest,
  signal?: AbortSignal,
) => Promise<CountResponse>;

/**
 * History counts kept in flight together. The tokenizer worker stays serial, so this
 * overlaps only message-passing latency. Live counts share the worker's 16 slots.
 */
export const HISTORY_COUNT_WINDOW = 4;

/** One FIFO limit shared by every import, so several open chats cannot fill the worker queue. */
export function sharedCountLimit(
  count: HistoryCounter,
  limit = HISTORY_COUNT_WINDOW,
): HistoryCounter {
  let running = 0;
  const waiting: Array<{ start: () => void; signal?: AbortSignal }> = [];
  const next = () => {
    while (running < limit && waiting.length) {
      const item = waiting.shift()!;
      if (!item.signal?.aborted) item.start();
    }
  };
  return (job, signal) =>
    new Promise<CountResponse>((resolve, reject) => {
      const start = () => {
        running++;
        signal?.removeEventListener("abort", cancel);
        count(job, signal)
          .then(resolve, reject)
          .finally(() => {
            running--;
            next();
          });
      };
      const cancel = () => {
        const index = waiting.findIndex((item) => item.start === start);
        if (index >= 0) waiting.splice(index, 1);
        reject(new Error("history_cancelled"));
      };
      if (signal?.aborted) return cancel();
      signal?.addEventListener("abort", cancel, { once: true });
      waiting.push({ start, signal });
      next();
    });
}

/** A message without the text it was counted from. */
function countedIdentity(
  source: HistoryTextMessage,
): Omit<HistoryTextMessage, CountedText> {
  const {
    text: _text,
    inlineFiles: _files,
    thinking: _thinking,
    toolInput: _toolInput,
    intermediate: _intermediate,
    toolOutput: _toolOutput,
    components: _components,
    computerFiles: _computerFiles,
    ...identity
  } = source;
  return identity;
}
/** Releases counted text at once, so a long history never holds two copies. */
function dropText(source: HistoryTextMessage) {
  source.text = null;
  source.inlineFiles = null;
  delete source.thinking;
  delete source.toolInput;
  delete source.intermediate;
  delete source.toolOutput;
  delete source.components;
  delete source.computerFiles;
}

/**
 * Counts the text and code files Perplexity Computer created in one reply (owner decision
 * of 14 Oct 2026), each with the normal tokenizer on its own, as output of the reply's
 * model. A file downloaded now is counted from its text; one counted before keeps its
 * saved count; one that could not be downloaded counts as its size in bytes divided by 4.
 * `uncounted` says a file was not counted in this read: not read yet, or past
 * COMPUTER_FILE_LIMIT_BYTES. `failed` says a count failed.
 */
async function countComputerFiles(
  source: HistoryTextMessage,
  saved: ReadonlyMap<string, SavedComputerFile> | undefined,
  count: HistoryCounter,
  counting: ReturnType<typeof snapshotCountingRuntime>,
  signal: AbortSignal,
): Promise<{
  tokens: bigint;
  files: CountedComputerFile[];
  uncounted: boolean;
  failed: boolean;
  estimated: boolean;
}> {
  const result = {
    tokens: 0n,
    files: [] as CountedComputerFile[],
    uncounted: false,
    failed: false,
    estimated: false,
  };
  const over = computerFilesOverLimit(source.computerFiles);
  const limit = BigInt(COMPUTER_FILE_LIMIT_BYTES);
  for (const file of source.computerFiles ?? []) {
    if (file.kind !== "text") continue;
    if (over.has(file.id)) {
      result.uncounted = true;
      continue;
    }
    const kept = saved?.get(file.id);
    let counted: SavedComputerFile | null = null;
    if (file.state === "content" && file.text !== undefined) {
      const jobId = crypto.randomUUID();
      const job: CountRequest = {
        jobId,
        revision: 1,
        modelId: null,
        ...counting.selection,
        fields: { tool_input: file.text },
      };
      const response = await count(job, signal).catch(() => undefined);
      const measured =
        response &&
        validCountResponse(response, job, counting.manifest) &&
        response.status === "counted"
          ? response.counts.tool_input
          : undefined;
      if (
        knownCount(
          measured,
          { jobId: `${jobId}:tool_input`, revision: 1 },
          new TextEncoder().encode(file.text).byteLength,
          counting.manifest,
        )
      )
        counted = { tokens: String(measured.measurement.value), basis: "content" };
      else result.failed = true;
    } else if (file.state === "content" && kept?.basis === "content")
      counted = kept;
    else if (file.state === "size")
      counted =
        kept?.basis === "size"
          ? kept
          : { tokens: String(Math.ceil(file.bytes / 4)), basis: "size" };
    else result.uncounted = true;
    if (!counted) continue;
    // The stated sizes are within the limit, but a file's text or saved count need not
    // match its stated size, so the sum is checked on the counts themselves too.
    if (result.tokens + BigInt(counted.tokens) > limit) {
      result.uncounted = true;
      continue;
    }
    if (counted.basis === "size") result.estimated = true;
    result.tokens += BigInt(counted.tokens);
    result.files.push({ id: file.id, ...counted });
  }
  return result;
}

/** Counting runs through the extension's existing private worker. MAIN never supplies trusted numerical results. */
export async function countHistoryPage(
  input: HistoryTextPage,
  count: HistoryCounter,
  options: {
    signal?: AbortSignal;
    validNow?: () => boolean;
    offset?: number;
    limit?: number;
    counting?: CountingRuntime;
    concurrency?: number;
    /** Aligned with the counted slice; an entry replaces that message's count. */
    reused?: ReadonlyArray<ReusedHistoryCount | undefined>;
    /** Aligned with the counted slice: each reply's saved Computer file counts by id. */
    computerFiles?: ReadonlyArray<
      ReadonlyMap<string, SavedComputerFile> | undefined
    >;
  } = {},
): Promise<CountedHistoryPage> {
  if (!validHistoryTextPage(input)) throw new Error("payload_rejected");
  const counting = snapshotCountingRuntime(
    options.counting ?? PACKAGED_COUNTING_RUNTIME,
  );
  const offset = options.offset ?? 0,
    limit = options.limit ?? HISTORY_LIMITS.countBatch;
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > input.messages.length ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > HISTORY_LIMITS.countBatch
  )
    throw new Error("payload_rejected");
  // Keep only the current count batch in the worker-facing snapshot. Cloning the
  // full history for every 100 messages multiplied memory use for long chats.
  const page = structuredClone({
    ...input,
    messages: input.messages.slice(offset, offset + limit),
  });
  const messages: CountedHistoryMessage[] = [];
  const deadline = Date.now() + HISTORY_LIMITS.lifetimeMs;
  const current = () => {
    if (
      options.signal?.aborted ||
      options.validNow?.() === false ||
      Date.now() >= deadline
    )
      throw new Error("history_cancelled");
  };
  // Aborting on any early exit cancels queued worker jobs and frees their slots.
  const local = new AbortController();
  const forward = () => local.abort();
  options.signal?.addEventListener("abort", forward, { once: true });
  const stopped = new Promise<never>((_, reject) =>
    local.signal.addEventListener(
      "abort",
      () => reject(new Error("history_cancelled")),
      { once: true },
    ),
  );
  stopped.catch(() => {});
  // Navigation or a lost lease must also release queued worker jobs, not only a signal.
  const watch = setInterval(() => {
    try {
      current();
    } catch {
      local.abort();
    }
  }, 250);
  const window = Math.max(1, options.concurrency ?? HISTORY_COUNT_WINDOW);
  const jobs: Array<{
    countJob: CountRequest;
    field: "input" | "answer";
    result: Promise<CountResponse["counts"] | undefined>;
  }> = [];
  const startJob = (index: number) => {
    const source = page.messages[index]!;
    const jobId = crypto.randomUUID(),
      field = source.role === "prompt" ? "input" : "answer";
    const fields: CountRequest["fields"] = {};
    if (options.reused?.[index]) {
      jobs[index] = {
        countJob: { jobId, revision: 1, modelId: null, ...counting.selection, fields },
        field,
        result: Promise.resolve(undefined),
      };
      return;
    }
    if (source.text !== null) fields[field] = source.text;
    if (source.role === "response") {
      for (const [key, countField] of HISTORY_REPLY_PARTS) {
        const text = source[key];
        if (typeof text === "string") fields[countField] = text;
      }
      source.components?.forEach((component, i) => {
        if (component.text !== null) fields[`component_${i}`] = component.text;
      });
    }
    for (const [i, file] of (source.inlineFiles ?? []).entries())
      fields[`file_${i}`] = file.text;
    const countJob: CountRequest = {
      jobId,
      revision: 1,
      modelId: null,
      ...counting.selection,
      fields,
    };
    const result = Object.keys(fields).length
      ? count(countJob, local.signal).then(
          (response) =>
            validCountResponse(response, countJob, counting.manifest) &&
            (response.status === "counted" || response.status === "partial")
              ? response.counts
              : undefined,
          // The numeric record below explicitly marks missing counts; raw input is never persisted.
          () => undefined,
        )
      : Promise.resolve(undefined);
    jobs[index] = { countJob, field, result };
  };
  try {
    for (const [index, source] of page.messages.entries()) {
      current();
      for (
        let ahead = index;
        ahead < Math.min(page.messages.length, index + window);
        ahead++
      )
        if (!jobs[ahead]) {
          if (ahead > index) current();
          startJob(ahead);
        }
      const { countJob, field } = jobs[index]!;
      const jobId = countJob.jobId;
      const fields = countJob.fields;
      const result = await Promise.race([jobs[index]!.result, stopped]);
      current();
      const reused = options.reused?.[index];
      const savedFiles = options.computerFiles?.[index];
      if (reused) {
        // A reused count already holds the reply's files, each counted before.
        const files = (source.computerFiles ?? []).flatMap((file) => {
          const kept = file.kind === "text" ? savedFiles?.get(file.id) : undefined;
          return kept ? [{ id: file.id, ...kept }] : [];
        });
        const estimated = files.some((file) => file.basis === "size");
        messages.push({
          ...countedIdentity(source),
          ...(estimated
            ? {
                coverageReasons: [
                  ...new Set([
                    ...(source.coverageReasons ?? []),
                    "file_size_estimated" as const,
                  ]),
                ],
              }
            : {}),
          ...structuredClone({
            tokens: reused.tokens,
            partTokens: reused.partTokens,
            inlineFileComponents: reused.inlineFileComponents,
          }),
          ...(files.length ? { computerFileTokens: files } : {}),
          components: (source.components ?? []).map((component, i) => ({
            role: component.role,
            model: component.model,
            tokens:
              component.outputTokens !== null
                ? providerMeasurement(component.outputTokens)
                : structuredClone(reused.componentTokens[i]!),
            timing: component.timing ?? null,
          })),
        });
        dropText(source);
        continue;
      }
      let tokens: TokenMeasurement = {
        value: null,
        evidence: "unknown",
        scope: "observed_text",
        completeness: "unknown",
        profile_id: null,
        reason:
          source.text === null ? "partial_capture" : "tokenizer_unavailable",
      };
      const measured = result?.[field];
      if (
        source.text !== null &&
        knownCount(
          measured,
          { jobId: `${jobId}:${field}`, revision: 1 },
          new TextEncoder().encode(source.text).byteLength,
          counting.manifest,
        )
      )
        tokens = TokenMeasurementSchema.parse({
          ...measured.measurement,
          completeness: source.complete ? "complete_for_scope" : "partial",
        });
      const files = inlineFileComponents(
        source.inlineFiles?.map((file) => file.text) ?? null,
        result,
        null,
        [],
        countJob,
        counting.manifest,
      );
      // Parts of a reply count like its answer; a failed count stays visibly unknown.
      const measure = (countField: CountField, text: string) => {
        const part = result?.[countField];
        return knownCount(
          part,
          { jobId: `${jobId}:${countField}`, revision: 1 },
          new TextEncoder().encode(text).byteLength,
          counting.manifest,
        )
          ? TokenMeasurementSchema.parse({
              ...part.measurement,
              completeness: source.complete ? "complete_for_scope" : "partial",
            })
          : unknownMeasurement("tokenizer_unavailable");
      };
      const partTokens: CountedHistoryMessage["partTokens"] = {};
      if (source.role === "response")
        for (const [key, countField, part] of HISTORY_REPLY_PARTS) {
          const text = source[key];
          if (typeof text === "string") partTokens[part] = measure(countField, text);
        }
      // Files Perplexity Computer created are model-written tool input of the reply
      // (owner decision of 14 Oct 2026). A size estimate joins the counted part without
      // changing its evidence: a saved part replaces its live copy, and a reread keeps or
      // grows it, only when both were measured the same way (selectPartMeasurement,
      // grownHistoryTokens), so another evidence would drop the files from a linked reply.
      // The message's file_size_estimated reason names the estimate in Details instead.
      let computerFileTokens: CountedComputerFile[] | undefined;
      let coverageReasons = source.coverageReasons;
      const toolInput = partTokens.tool_input;
      if (
        source.role === "response" &&
        source.computerFiles?.length &&
        toolInput?.value != null
      ) {
        const files = await countComputerFiles(
          source,
          savedFiles,
          count,
          counting,
          local.signal,
        );
        current();
        partTokens.tool_input = files.failed
          ? unknownMeasurement("tokenizer_unavailable")
          : TokenMeasurementSchema.parse({
              ...toolInput,
              value: (BigInt(toolInput.value) + files.tokens).toString(),
              ...(files.uncounted
                ? { completeness: "partial", reason: "partial_capture" }
                : {}),
            });
        if (!files.failed && !files.uncounted && files.files.length)
          computerFileTokens = files.files;
        if (files.estimated)
          coverageReasons = [
            ...new Set([...(coverageReasons ?? []), "file_size_estimated" as const]),
          ];
      }
      messages.push({
        ...countedIdentity(source),
        ...(coverageReasons ? { coverageReasons } : {}),
        ...(computerFileTokens ? { computerFileTokens } : {}),
        tokens,
        partTokens,
        components: (source.components ?? []).map((component, i) => ({
          role: component.role,
          model: component.model,
          tokens:
            component.outputTokens !== null
              ? providerMeasurement(component.outputTokens)
              : measure(`component_${i}`, component.text!),
          timing: component.timing ?? null,
        })),
        inlineFileComponents:
          files?.map(({ component_id: _id, ...file }) => file) ?? null,
      });
      dropText(source);
      for (const key of Object.keys(fields) as CountField[]) delete fields[key];
    }
  } finally {
    clearInterval(watch);
    options.signal?.removeEventListener("abort", forward);
    local.abort();
  }
  const { messages: _messages, ...metadata } = page;
  return { ...metadata, messages };
}
