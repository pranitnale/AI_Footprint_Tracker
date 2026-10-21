import {
  HISTORY_LIMITS,
  type HistoryTextMessage,
  type HistoryTextPage,
} from "./types";
import {
  timingEvidence,
  type Site,
  type TimingEvidence,
} from "@footprint/capture-core";

export const historyUUID = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    v,
  );
export const record = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export const boundedText = (v: unknown): v is string =>
  typeof v === "string" && v.length <= HISTORY_LIMITS.messageUnits;
/** An attached file's text within the counter's limit for one file. */
export const boundedFileText = (v: unknown): v is string =>
  typeof v === "string" && v.length <= HISTORY_LIMITS.inlineFileUnits;

const MODEL_LABEL = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
/** A raw model label as a page stores it; the consumer maps it through the registry. */
export const historyModelLabel = (value: unknown) =>
  typeof value === "string" && MODEL_LABEL.test(value) ? value : null;

/**
 * Text units a message adds to a counting batch: the answer, reasoning, generated text
 * and inline files. Batching and validation use this one rule so they always agree.
 */
export function historyMessageUnits(message: HistoryTextMessage): number {
  return (
    (message.text?.length ?? 0) +
    (message.thinking?.length ?? 0) +
    (message.toolInput?.length ?? 0) +
    (message.intermediate?.length ?? 0) +
    (message.toolOutput?.length ?? 0) +
    (message.components ?? []).reduce(
      (total, component) => total + (component.text?.length ?? 0),
      0,
    ) +
    (message.inlineFiles ?? []).reduce(
      (total, file) => total + file.text.length,
      0,
    ) +
    (message.computerFiles ?? []).reduce(
      (total, file) => total + (file.text?.length ?? 0),
      0,
    )
  );
}

/** Preserve source fractional precision and require an explicit timezone. */
export function historyInstant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m =
    /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,6}))?(Z|[+-]\d\d:\d\d)$/.exec(
      value,
    );
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  const local = new Date(
    Date.UTC(year!, month! - 1, day!, hour!, minute!, second!),
  );
  if (
    year! < 1970 ||
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() + 1 !== month ||
    local.getUTCDate() !== day ||
    hour! > 23 ||
    minute! > 59 ||
    second! > 59
  )
    return null;
  const zone = m[8]!;
  if (
    zone !== "Z" &&
    (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59)
  )
    return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return (
    new Date(time).toISOString().slice(0, 19) +
    "." +
    (m[7] ?? "").padEnd(3, "0") +
    "Z"
  );
}
export function historyPage(
  site: Site,
  conversationId: string,
  observedAt: string,
): HistoryTextPage {
  return {
    site,
    conversationId,
    observedAt,
    messages: [],
    firstRequestVerified: false,
    rootSourceId: null,
    selectedLeafId: null,
    branchSourceIds: null,
    branchScope: "loaded_messages",
    hasEarlier: null,
    hasLater: null,
    status: "partial",
  };
}
export function historyMessage(
  sourceId: string,
  role: HistoryTextMessage["role"],
): HistoryTextMessage {
  return {
    sourceId,
    role,
    promptSourceId: role === "prompt" ? sourceId : null,
    parentSourceId: null,
    parentRole: null,
    requestId: null,
    liveAttemptId: null,
    timing: null,
    occurredAt: null,
    dateBasis: "unknown",
    modelId: null,
    text: null,
    complete: false,
    inlineFiles: null,
  };
}
export function finishHistoryPage(page: HistoryTextPage): HistoryTextPage {
  const ids = new Set<string>();
  for (const m of page.messages) {
    const key = m.role + ":" + m.sourceId;
    if (ids.has(key)) throw new Error("history_unsupported");
    ids.add(key);
  }
  // Conversation-wide limits belong to the transport batch, not this page.
  return page;
}

/** Seconds between two stored instants at their stored precision, or null. */
export function historySeconds(start: unknown, end: unknown): number | null {
  const first = historyInstant(start),
    last = historyInstant(end);
  if (!first || !last) return null;
  const nanos = (value: string) => {
    const [whole, fraction] = value.slice(0, -1).split(".");
    return (
      BigInt(Date.parse(whole + "Z")) * 1000000n +
      BigInt((fraction ?? "").padEnd(9, "0"))
    );
  };
  return Number(nanos(last) - nanos(first)) / 1e9;
}

/** Envelope across exposed blocks, not their sum: overlapping intervals count once. */
export function historySpan(
  start: unknown,
  end: unknown,
  source: TimingEvidence["source"],
): TimingEvidence | null {
  const seconds = historySeconds(start, end);
  return seconds === null ? null : timingEvidence(seconds, source);
}
