import {
  COMPUTER_FILES_PER_REPLY,
  historyInstant,
  historyMessageUnits,
  notebooklmId,
  type HistoryTextPage,
} from "@footprint/adapters";
import type { ComputerFileQuery } from "./computer-files";
import { isRouteConversationId } from "@footprint/capture-core";
import {
  notebooklmRows,
  validHistoryTextPage,
  validStudioPrompts,
} from "./history-capture";
import {
  PROVIDER_STREAM_BATCH_MESSAGES,
  PROVIDER_STREAM_BATCH_TEXT_UNITS,
  type ProviderStreamMeta,
  type ProviderStreamRow,
  type StreamSite,
} from "./provider-history-stream";

export const PROVIDER_STREAM_CHANNEL = "ai-footprint-provider-history-stream-v1";
type Base = {
  channel: typeof PROVIDER_STREAM_CHANNEL;
  id: string;
  site: StreamSite;
  conversationId: string;
  observedAt: string;
};
export type ProviderStreamCapture = Base &
  (
    | { event: "batch"; rows: ProviderStreamRow[]; meta: null }
    | { event: "progress"; rows: null; meta: null }
    | { event: "finish"; rows: null; meta: ProviderStreamMeta }
    // Which Perplexity Computer files saved counts already hold, asked before the files
    // are downloaded (14 Oct 2026). The answer names them; nothing is stored.
    | { event: "files"; rows: null; meta: null; files: ComputerFileQuery[] }
  );
/** Most files one question names: every file of one batch of replies. */
export const PROVIDER_STREAM_FILE_QUERIES =
  PROVIDER_STREAM_BATCH_MESSAGES * COMPUTER_FILES_PER_REPLY;
const ASSET_ID = /^[A-Za-z0-9_-]{1,128}$/;
/** The answer to a `files` question: each counted file's id and how it was counted. */
export function validComputerFilesAnswer(
  value: unknown,
): value is Array<{ id: string; counted: "content" | "size" }> {
  return (
    Array.isArray(value) &&
    value.length <= PROVIDER_STREAM_FILE_QUERIES &&
    value.every(
      (item) =>
        !!item &&
        typeof item === "object" &&
        exact(item, ["id", "counted"]) &&
        typeof item.id === "string" &&
        ASSET_ID.test(item.id) &&
        (item.counted === "content" || item.counted === "size"),
    )
  );
}
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const exact = (value: object, keys: string[]) =>
  Object.keys(value).sort().join(",") === keys.sort().join(",");
const idFor = (site: StreamSite, value: unknown) =>
  site === "gemini"
    ? typeof value === "string" && /^r(?:c)?_[0-9a-f]{16}$/.test(value)
    : site === "notebooklm"
      ? notebooklmId(value)
      : uuid(value);

export function validateProviderStreamCapture(
  value: unknown,
): value is ProviderStreamCapture {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as ProviderStreamCapture;
  if (
    !exact(item, [
      "channel", "id", "site", "conversationId", "observedAt",
      "event", "rows", "meta",
      ...(item.event === "files" ? ["files"] : []),
    ]) ||
    item.channel !== PROVIDER_STREAM_CHANNEL ||
    !["chatgpt", "perplexity", "gemini", "notebooklm"].includes(item.site) ||
    !uuid(item.id) || item.id[14] !== "4" ||
    !isRouteConversationId(item.site, item.conversationId) ||
    typeof item.observedAt !== "string" ||
    item.observedAt.length !== 24 ||
    historyInstant(item.observedAt) !== item.observedAt
  ) return false;
  if (item.event === "progress")
    return item.rows === null && item.meta === null;
  if (item.event === "files")
    return (
      item.site === "perplexity" &&
      item.rows === null &&
      item.meta === null &&
      Array.isArray(item.files) &&
      item.files.length > 0 &&
      item.files.length <= PROVIDER_STREAM_FILE_QUERIES &&
      item.files.every(
        (file) =>
          !!file &&
          typeof file === "object" &&
          exact(file, ["reply", "id"]) &&
          uuid(file.reply) &&
          typeof file.id === "string" &&
          ASSET_ID.test(file.id),
      )
    );
  if (item.event === "finish") {
    const meta = item.meta;
    if (
      item.rows !== null || !meta || typeof meta !== "object" ||
      !exact(meta, [
        "messageCount", "firstRequestVerified", "rootSourceId",
        "selectedLeafId", "branchScope", "hasEarlier", "hasLater",
      ]) ||
      !Number.isSafeInteger(meta.messageCount) ||
      // A notebook's Studio list may be empty; every other read holds a message.
      meta.messageCount < (item.site === "notebooklm" ? 0 : 1) ||
      typeof meta.firstRequestVerified !== "boolean" ||
      (meta.rootSourceId !== null && !idFor(item.site, meta.rootSourceId)) ||
      (meta.selectedLeafId !== null && !idFor(item.site, meta.selectedLeafId)) ||
      (meta.rootSourceId !== null) !== meta.firstRequestVerified ||
      ![null, false, true].includes(meta.hasEarlier) ||
      ![null, false, true].includes(meta.hasLater) ||
      (meta.firstRequestVerified && meta.hasEarlier !== false) ||
      meta.branchScope !== (item.site === "gemini" ? "selected_branch" : "loaded_messages") ||
      (item.site === "gemini" && !meta.selectedLeafId) ||
      (item.site === "perplexity" && meta.selectedLeafId !== null) ||
      // NotebookLM chats have no branches and its reads name no newer page (W9). Whether a
      // read of Studio rows claims a first message is checked against its rows.
      (item.site === "notebooklm" &&
        (meta.selectedLeafId !== null || meta.hasLater !== null))
    ) return false;
    return true;
  }
  if (
    item.event !== "batch" || item.meta !== null ||
    !Array.isArray(item.rows) || !item.rows.length ||
    item.rows.length > PROVIDER_STREAM_BATCH_MESSAGES
  ) return false;
  for (const row of item.rows) {
    if (
      !row || typeof row !== "object" || Array.isArray(row) ||
      !exact(row, ["message", "requestRef", "parentRef"]) ||
      (row.requestRef !== null && (item.site !== "chatgpt" || !uuid(row.requestRef))) ||
      (row.parentRef !== null && (item.site !== "chatgpt" || !uuid(row.parentRef)))
    ) return false;
  }
  const page: HistoryTextPage = {
    site: item.site,
    conversationId: item.conversationId,
    observedAt: item.observedAt,
    messages: item.rows.map((row) => row.message),
    firstRequestVerified: false,
    rootSourceId: null,
    selectedLeafId: null,
    branchSourceIds: null,
    branchScope: "unknown",
    hasEarlier: null,
    hasLater: null,
    status: "partial",
  };
  if (
    !validHistoryTextPage(page) ||
    (item.site === "notebooklm" &&
      notebooklmRows(page.messages) !== "chat" &&
      !validStudioPrompts(page.messages))
  )
    return false;
  const units = page.messages.reduce(
    (sum, message) => sum + historyMessageUnits(message),
    0,
  );
  return units <= PROVIDER_STREAM_BATCH_TEXT_UNITS || item.rows.length === 1;
}
