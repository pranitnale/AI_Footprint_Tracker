import {
  CLAUDE_HISTORY_ROOT,
  historyInstant,
  historyMessageUnits,
  historyModelLabel,
  type ClaudeHistoryRow,
  type HistoryTextPage,
} from "@footprint/adapters";
import { validHistoryTextPage } from "./history-capture";
import {
  CLAUDE_STREAM_BATCH_MESSAGES,
  CLAUDE_STREAM_BATCH_TEXT_UNITS,
} from "./claude-history-stream";

export const CLAUDE_STREAM_CHANNEL = "ai-footprint-claude-history-stream-v1";
type Base = {
  channel: typeof CLAUDE_STREAM_CHANNEL;
  id: string;
  site: "claude";
  conversationId: string;
  observedAt: string;
};
export type ClaudeStreamCapture = Base &
  (
    | {
        event: "batch";
        rows: ClaudeHistoryRow[];
        leafId: null;
        rowCount: null;
        model: null;
      }
    | {
        event: "progress";
        rows: null;
        leafId: null;
        rowCount: null;
        model: null;
      }
    | {
        event: "finish";
        rows: null;
        leafId: string;
        rowCount: number;
        /** The chat's model, which every saved message of the read gets (B5). */
        model: string | null;
      }
  );
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    value,
  );
const exact = (value: object, keys: string[]) =>
  Object.keys(value).sort().join(",") === keys.sort().join(",");

/** Only transient, provider-scoped text enters the private counting service. */
export function validateClaudeStreamCapture(
  value: unknown,
): value is ClaudeStreamCapture {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as ClaudeStreamCapture;
  if (
    !exact(item, [
      "channel",
      "id",
      "site",
      "conversationId",
      "observedAt",
      "event",
      "rows",
      "leafId",
      "rowCount",
      "model",
    ]) ||
    item.channel !== CLAUDE_STREAM_CHANNEL ||
    item.site !== "claude" ||
    !uuid(item.id) ||
    item.id[14] !== "4" ||
    !uuid(item.conversationId) ||
    typeof item.observedAt !== "string" ||
    item.observedAt.length !== 24 ||
    historyInstant(item.observedAt) !== item.observedAt
  )
    return false;
  if (item.event === "finish")
    return (
      item.rows === null &&
      uuid(item.leafId) &&
      typeof item.rowCount === "number" &&
      Number.isSafeInteger(item.rowCount) &&
      item.rowCount > 0 &&
      (item.model === null || historyModelLabel(item.model) === item.model)
    );
  if (item.model !== null) return false;
  if (item.event === "progress")
    return item.rows === null && item.leafId === null && item.rowCount === null;
  if (
    item.event !== "batch" ||
    item.leafId !== null ||
    item.rowCount !== null ||
    !Array.isArray(item.rows) ||
    !item.rows.length ||
    item.rows.length > CLAUDE_STREAM_BATCH_MESSAGES
  )
    return false;
  for (const row of item.rows) {
    if (
      !row ||
      typeof row !== "object" ||
      Array.isArray(row) ||
      !exact(row, ["message", "parentId", "index", "untruncated"]) ||
      (row.parentId !== CLAUDE_HISTORY_ROOT && !uuid(row.parentId)) ||
      (row.index !== null &&
        (!Number.isSafeInteger(row.index) || row.index < 0)) ||
      typeof row.untruncated !== "boolean"
    )
      return false;
  }
  const page: HistoryTextPage = {
    site: "claude",
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
  if (!validHistoryTextPage(page)) return false;
  const units = page.messages.reduce(
    (total, message) => total + historyMessageUnits(message),
    0,
  );
  // One source message cannot be split without changing its tokenizer context.
  return units <= CLAUDE_STREAM_BATCH_TEXT_UNITS || item.rows.length === 1;
}
