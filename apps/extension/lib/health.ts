import { REASON_CODES, type ReasonCode } from "@footprint/contracts";
const MESSAGES: Partial<Record<ReasonCode, string>> = {
  capture_hook_missing:
    "Site capture is unavailable. Restore site access and reload the AI page.",
  storage_write_failed:
    "This browser could not save usage. Recent observations may be missing. Free local storage and restart the extension.",
  auth_reconnect_required:
    "Your company connection needs renewal. Recorded usage remains on this device.",
  enrollment_revoked:
    "Company access was revoked. Recorded usage remains on this device.",
  policy_unavailable:
    "Company permissions or policy could not be verified. Check the connection before sharing resumes.",
  sync_delayed: "Usage is waiting to sync. Check the connection and try again.",
};
// IndexedDB raises UnknownError when the browser cannot use its backing files,
// for example when a Windows profile folder path is too long for Chrome to
// create the database on first open. No stored observation was read, so this
// is a storage failure rather than evidence of an inconsistent ledger.
const STORAGE_FAILURES = [
  "QuotaExceededError",
  "InvalidStateError",
  "AbortError",
  "UnknownError",
];
export function failureCode(error: unknown): ReasonCode {
  if (error instanceof DOMException && STORAGE_FAILURES.includes(error.name))
    return "storage_write_failed";
  const value =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : "";
  return REASON_CODES.includes(value as ReasonCode)
    ? (value as ReasonCode)
    : "ledger_integrity_failed";
}
/**
 * The error's class and message, short, for the dashboard to show under its plain message. It stays
 * in the browser: a person can include it in a screenshot, which is how the "Illegal invocation"
 * fault of 13 Oct 2026 would have been found at once. Addresses are cut, since a message may quote one.
 */
export function technicalDetail(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const text = `${error.name}: ${error.message}`
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[address]")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 160 ? text.slice(0, 159) + "\u2026" : text;
}
export const failureMessage = (code: ReasonCode) =>
  MESSAGES[code] ??
  "The operation could not be completed. Recorded data was kept. Check tracking health and retry.";
/**
 * Problems an AI page reported about one moment. Whether one still applies is known only to
 * the open tab, which the toolbar popup asks (owner, 12 October 2026), so the dashboard lists
 * them under Earlier problems even before a later reply closes them.
 */
const PAGE_EVENT_CODES: ReadonlySet<string> = new Set([
  "capture_hook_missing",
  "protocol_unsupported",
  "composer_anchor_missing",
]);
export const isPageEvent = (issue: { code: string }) =>
  PAGE_EVENT_CODES.has(issue.code);
/**
 * Facts about something that already happened, which nothing in this browser can fix: the
 * server kept an earlier version of a reply, dropped records by its retention rules, or a saved
 * message carried conflicting times. They are never open problems; the dashboard lists them
 * under Earlier problems for support (owner decision of 16 October 2026, evening).
 */
const NOTE_CODES: ReadonlySet<string> = new Set([
  "revision_conflict",
  "retention_expired",
  "historical_timing_conflict",
]);
export const isNote = (issue: { code: string }) => NOTE_CODES.has(issue.code);
/**
 * The work whose success shows that a saved problem is solved (owner decision of 16 October
 * 2026: a problem closes as soon as the same kind of work succeeds again).
 */
export type HealthSuccess =
  /** A live reply's end frame was read and saved without a capture failure. */
  | "reply_read"
  /** That reply's text was counted by the tokenizer. */
  | "reply_counted"
  /** An estimate was made and saved: a live reply, or saved history estimated afresh. */
  | "estimate_made"
  /** Usage records were saved: a live reply or a page of saved history. */
  | "record_saved"
  /** The dashboard's totals were built and saved. */
  | "totals_built"
  /** An organization sync finished: the upload was answered, or nothing was waiting. */
  | "synced"
  /** The organization's rules were read again. */
  | "policy_checked"
  /** The organization's server accepted a signed-in request. */
  | "connected"
  /** Every waiting deletion instruction was applied. */
  | "deletions_applied";
/**
 * Each code with the success that closes it, from the places that write it (ledger.health,
 * company sync and history commits). Every other code, apart from the notes above and the
 * bar's composer check (composer_anchor_missing, which reports failures only), closes when a
 * later reply is read and saved without it (owner decision of 16 October 2026, evening: when
 * the tracker works again, nothing stays open). Any code also closes when not seen for
 * OPEN_PROBLEM_MS.
 */
export const SOLVED_BY: Readonly<Partial<Record<ReasonCode, HealthSuccess>>> =
  Object.freeze({
    // Written by the page watchdog, the capture bridge and site access checks.
    capture_hook_missing: "reply_read",
    protocol_unsupported: "reply_read",
    malformed_frame: "reply_read",
    buffer_overflow: "reply_read",
    capture_body_missing: "reply_read",
    provider_selection_unverified: "reply_read",
    conflicting_duplicate_identity: "reply_read",
    partial_capture: "reply_read",
    clock_skew: "reply_read",
    tokenizer_unavailable: "reply_counted",
    // Written when the estimator could not run, for live replies and saved history.
    estimate_unavailable: "estimate_made",
    method_unsupported: "estimate_made",
    method_update_invalid: "estimate_made",
    storage_write_failed: "record_saved",
    // Written when the dashboard's totals or a chat comparison could not be built.
    aggregate_inconsistent: "totals_built",
    ledger_integrity_failed: "totals_built",
    sync_delayed: "synced",
    // A later upload the server took without refusing records in that form.
    payload_rejected: "synced",
    policy_unavailable: "policy_checked",
    auth_reconnect_required: "connected",
    enrollment_revoked: "connected",
    deletion_in_progress: "deletions_applied",
  });
const CODES_BY_SUCCESS = new Map<HealthSuccess, ReasonCode[]>();
for (const [code, success] of [
  ...(Object.entries(SOLVED_BY) as [ReasonCode, HealthSuccess][]),
  ...REASON_CODES.filter(
    (code) =>
      !(code in SOLVED_BY) &&
      !NOTE_CODES.has(code) &&
      code !== "composer_anchor_missing",
  ).map((code) => [code, "reply_read"] as const),
])
  CODES_BY_SUCCESS.set(success, [
    ...(CODES_BY_SUCCESS.get(success) ?? []),
    code,
  ]);
export const codesSolvedBy = (success: HealthSuccess): readonly ReasonCode[] =>
  CODES_BY_SUCCESS.get(success) ?? [];
/** A problem not seen for this long moves to Earlier problems, solved or not. */
export const OPEN_PROBLEM_MS = 3 * 24 * 60 * 60 * 1000;
/**
 * Records that the work behind each success succeeded, so its open problems close, in one
 * read. It never fails that work: a lost marker only leaves the problem open until it is not
 * seen for OPEN_PROBLEM_MS. Codes in except were reported by the same work and stay open.
 */
export async function solveHealth(
  repository: {
    resolveHealth?: (
      namespace: string,
      codes: readonly ReasonCode[],
    ) => Promise<unknown>;
  },
  namespace: string,
  successes: HealthSuccess | readonly HealthSuccess[],
  except: readonly ReasonCode[] = [],
): Promise<void> {
  const codes = (typeof successes === "string" ? [successes] : successes)
    .flatMap(codesSolvedBy)
    .filter((code) => !except.includes(code));
  // Test doubles and older callers may not offer resolution; the problem then closes by time.
  if (!codes.length || typeof repository.resolveHealth !== "function") return;
  try {
    await repository.resolveHealth(namespace, codes);
  } catch {
    // A failed read or write keeps the problem open, which is the safe side.
  }
}
export interface TrackingHealthIssue {
  code: ReasonCode;
  at: number;
  firstAt: number;
  lastAt: number;
  count: number;
  persistence: "persisted" | "memory";
  scope: "current" | "extension";
  /** When the same kind of work last succeeded after the problem, or null. */
  resolvedAt: number | null;
  /**
   * unresolved: open, seen within OPEN_PROBLEM_MS and not solved since. resolved: the same
   * kind of work succeeded after its last occurrence. inactive: not seen for OPEN_PROBLEM_MS.
   */
  state: "unresolved" | "resolved" | "inactive";
}
export function problemState(
  issue: Pick<TrackingHealthIssue, "lastAt" | "resolvedAt">,
  now: number,
): TrackingHealthIssue["state"] {
  if (issue.resolvedAt !== null && issue.resolvedAt >= issue.lastAt)
    return "resolved";
  return now - issue.lastAt > OPEN_PROBLEM_MS ? "inactive" : "unresolved";
}
export const isOpenProblem = (issue: Pick<TrackingHealthIssue, "state">) =>
  issue.state === "unresolved";
/** An open problem the Tracking page lists under Open problems and the sidebar counts. */
export const isActionable = (issue: Pick<TrackingHealthIssue, "code" | "state">) =>
  !isPageEvent(issue) && !isNote(issue) && isOpenProblem(issue);
const timestamp = (value: unknown, fallback: number) =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= 8640000000000000
    ? value
    : fallback;
export function persistedHealth(
  rows: unknown[],
  now = Date.now(),
): TrackingHealthIssue[] {
  return rows.flatMap((row) => {
    const value = row as Partial<
      Omit<TrackingHealthIssue, "resolvedAt"> & { resolvedAt: unknown }
    > | null;
    if (!value || !REASON_CODES.includes(value.code as ReasonCode)) return [];
    const at = timestamp(value.at, 0);
    const issue = {
      code: value.code!,
      at,
      firstAt: timestamp(value.firstAt, at),
      lastAt: timestamp(value.lastAt, at),
      count:
        typeof value.count === "number" &&
        Number.isSafeInteger(value.count) &&
        value.count > 0
          ? value.count
          : 1,
      persistence: "persisted" as const,
      scope: "current" as const,
      resolvedAt:
        value.resolvedAt === undefined ? null : timestamp(value.resolvedAt, 0),
    };
    return [{ ...issue, state: problemState(issue, now) }];
  });
}
export function combineHealth(
  ...groups: TrackingHealthIssue[][]
): TrackingHealthIssue[] {
  return combineHealthAt(Date.now(), ...groups);
}
/** Joins the saved and in-memory copies of a problem; its state follows the joined times. */
export function combineHealthAt(
  now: number,
  ...groups: TrackingHealthIssue[][]
): TrackingHealthIssue[] {
  const issues = new Map<string, TrackingHealthIssue>();
  for (const issue of groups.flat()) {
    const key = `${issue.scope}:${issue.code}`,
      previous = issues.get(key);
    issues.set(
      key,
      previous
        ? {
            ...issue,
            at: Math.max(previous.at, issue.at),
            firstAt: Math.min(previous.firstAt, issue.firstAt),
            lastAt: Math.max(previous.lastAt, issue.lastAt),
            count: Math.min(
              Number.MAX_SAFE_INTEGER,
              previous.count + issue.count,
            ),
            persistence:
              previous.persistence === "memory" ? "memory" : issue.persistence,
            resolvedAt:
              previous.resolvedAt === null
                ? issue.resolvedAt
                : issue.resolvedAt === null
                  ? previous.resolvedAt
                  : Math.max(previous.resolvedAt, issue.resolvedAt),
          }
        : { ...issue },
    );
  }
  return [...issues.values()].map((issue) => ({
    ...issue,
    state: problemState(issue, now),
  }));
}
/** A read gave up because the calculation changed on every attempt (`resolveCalculation`). */
const CALCULATION_CHANGES: readonly ReasonCode[] = ["aggregate_inconsistent"];
/** In-memory health remains available when persistence itself has failed. */
export class HealthReporter {
  private reportedErrors = new WeakSet<object>();
  private records = new Map<
    string,
    TrackingHealthIssue & { namespace?: string }
  >();
  constructor(private badge: () => Promise<unknown>) {}
  report(error: unknown, namespace?: string): ReasonCode {
    const code = failureCode(error);
    if (
      error !== null &&
      typeof error === "object" &&
      this.reportedErrors.has(error)
    ) {
      this.notify();
      return code;
    }
    this.markReported(error);
    const key = JSON.stringify([namespace ?? null, code]);
    if (
      !this.records.has(key) &&
      this.records.size >= 255 &&
      (code !== "capture_limit_exceeded" || namespace !== undefined)
    ) {
      this.report("capture_limit_exceeded");
      return code;
    }
    const previous = this.records.get(key),
      at = Date.now();
    this.records.set(key, {
      code,
      at,
      firstAt: previous?.firstAt ?? at,
      lastAt: at,
      count: Math.min(Number.MAX_SAFE_INTEGER, (previous?.count ?? 0) + 1),
      persistence: "memory",
      scope: namespace === undefined ? "extension" : "current",
      resolvedAt: null,
      state: "unresolved",
      namespace,
    });
    this.notify();
    return code;
  }
  /**
   * The same kind of work succeeded in namespace (HealthRepository.onHealthResolved), so the
   * matching problems kept here for that namespace close too. A problem reported without a
   * namespace came from any failing message handler, which this success does not prove
   * fixed, so it closes only by time.
   */
  resolve(namespace: string, codes: readonly ReasonCode[]) {
    const at = Date.now();
    for (const record of this.records.values())
      if (
        record.namespace === namespace &&
        codes.includes(record.code) &&
        problemState(record, at) !== "resolved"
      )
        record.resolvedAt = Math.max(at, record.lastAt);
  }
  /**
   * A later read that checks the calculation is current answered, so the saving that made an
   * earlier read give up (aggregate_inconsistent: replies and imports saved while it read) is
   * over. Those problems kept without a namespace close too; until 19 Oct 2026
   * one such moment stayed open on the Tracking page for three days. Other problems a failing
   * handler reported still close only by time.
   */
  resolveCalculation() {
    const at = Date.now();
    let closed = false;
    for (const record of this.records.values())
      if (
        record.namespace === undefined &&
        CALCULATION_CHANGES.includes(record.code) &&
        problemState(record, at) !== "resolved"
      ) {
        record.resolvedAt = Math.max(at, record.lastAt);
        closed = true;
      }
    if (closed) this.notify();
  }
  markReported(error: unknown) {
    if (error !== null && typeof error === "object")
      this.reportedErrors.add(error);
  }
  notify() {
    void this.badge().catch(() => {});
  }
  list(namespace?: string): TrackingHealthIssue[] {
    const now = Date.now();
    return [...this.records.values()]
      .filter(
        (record) =>
          record.namespace === undefined || record.namespace === namespace,
      )
      .map(({ namespace: _namespace, ...record }) => ({
        ...record,
        state: problemState(record, now),
      }));
  }
}
