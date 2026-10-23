import { invalidateEstimationJobs } from "./estimation-storage";
import {
  canonicalJson,
  payloadHash,
  parseObservation,
  ReasonCodeSchema,
  type Observation,
  type ReasonCode,
  HistoryPageSchema,
  HistoryMessageSchema,
  historyNumericPayloadHash,
  refineHistory,
  mergeHistoryCoverage,
  compareHistoricalInstants,
  type HistoryMessage,
  type HistoryPage,
  type HistoryReceipt,
  HistorySummarySchema,
  HistoryResourcesSchema,
  type HistorySummary,
  HistoryCountBasisSchema,
  type HistoryCountBasis,
} from "@footprint/contracts";
import type {
  LiveReplyContent,
  TrackingCheckpoint,
} from "./repository-contracts";

export const STORES = [
  "requests",
  "attempts",
  "measurements",
  "local_estimates",
  "provider_key_map",
  "outbox",
  "sync_receipts",
  "health",
  "policy",
  "deletion_markers",
  "dashboard_cache",
  "context_snapshots",
  "guidance_preferences",
  "schema_migrations",
  "thread_relations",
  "method_catalogs",
  "history_records",
  "history_coverage",
  "history_outbox",
  "estimation_inputs",
  "estimation_state",
  "estimation_jobs",
  "estimation_results",
  "estimation_originals",
  "engine_preferences",
  "model_labels",
  "cowork_checkpoints",
] as const;
export type Scope = {
  namespace: string;
  mode: "personal" | "company";
  era: string | null;
};
export type HistoryRow = {
  key: string;
  namespace: string;
  era: string | null;
  lastImportEra?: string | null;
  record: HistoryMessage;
  original: HistoryMessage;
  hash: string;
  status: "current" | "conflict";
  /**
   * The company server reported the conflict. Only a conflict this browser found itself
   * is cleared when a later read matches the saved record again.
   */
  serverConflict?: true;
  estimate: HistorySummary["resources"];
  originalEstimate: HistorySummary["resources"];
  /** Local-only lengths and counts for reusing an unchanged message's count. */
  countBasis?: HistoryCountBasis;
  /**
   * The message's company key (W11). It travels beside the message when it is uploaded,
   * never inside it, and once kept it never changes.
   */
  companyKey?: string;
};
/**
 * The counters of the latest Cowork result saved for a session (W5). Local only: the
 * next result's own counts are the difference to it, so it must change together with the
 * saved replies.
 */
export type CoworkCheckpoint = {
  sequence: number;
  models: Array<{ model: string; output: number; reasoning: number | null }>;
  apiMs: number | null;
};
/** The checkpoint a Cowork batch was calculated from and the one it leaves behind. */
export type CoworkAdvance = { base: number | null; next: CoworkCheckpoint };
const COWORK_COUNT_LIMIT = 1_000_000_000;
const COWORK_MODEL_LABEL = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const coworkCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= COWORK_COUNT_LIMIT;
const exactKeys = (value: object, keys: string) =>
  Object.keys(value).sort().join(",") === keys;
export function validCoworkCheckpoint(
  value: unknown,
): value is CoworkCheckpoint {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as CoworkCheckpoint;
  return (
    exactKeys(v, "apiMs,models,sequence") &&
    coworkCount(v.sequence) &&
    (v.apiMs === null || coworkCount(v.apiMs)) &&
    Array.isArray(v.models) &&
    v.models.length <= 32 &&
    new Set(v.models.map((m) => m?.model)).size === v.models.length &&
    v.models.every(
      (m) =>
        !!m &&
        typeof m === "object" &&
        exactKeys(m, "model,output,reasoning") &&
        typeof m.model === "string" &&
        COWORK_MODEL_LABEL.test(m.model) &&
        coworkCount(m.output) &&
        (m.reasoning === null ||
          (coworkCount(m.reasoning) && m.reasoning <= m.output)),
    )
  );
}
export function validCoworkAdvance(value: unknown): value is CoworkAdvance {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as CoworkAdvance;
  return (
    exactKeys(v, "base,next") &&
    (v.base === null || coworkCount(v.base)) &&
    validCoworkCheckpoint(v.next) &&
    (v.base === null || v.next.sequence > v.base)
  );
}
/** A stored checkpoint row, checked against the key it was read under. */
export function checkedCoworkCheckpoint(
  row: unknown,
  namespace: string,
  conversationKey: string,
): CoworkCheckpoint {
  const v = row as Record<string, unknown> | null;
  if (
    !v ||
    typeof v !== "object" ||
    !exactKeys(v, "at,checkpoint,conversation,key,namespace") ||
    v.key !== `${namespace}:${conversationKey}` ||
    v.namespace !== namespace ||
    v.conversation !== conversationKey ||
    !Number.isSafeInteger(v.at) ||
    !validCoworkCheckpoint(v.checkpoint)
  )
    throw new Error("ledger_integrity_failed");
  return structuredClone(v.checkpoint);
}
/**
 * Whether an erasure marker covers a saved message this browser read at `observedAt`. An
 * erasure is a clean slate when it is applied (owner decision of 22 Oct 2026): it covers the
 * messages read before it, and a chat read again afterwards counts again. A message the server
 * refused (`refused`) stays out. Markers written before 22 Oct 2026 carry no time: the erasure
 * that wrote them already removed what it covered, so they cover nothing read since.
 */
export function erasedWhenRead(
  marker: { at?: unknown; refused?: unknown } | null | undefined,
  observedAt: string,
): boolean {
  if (!marker) return false;
  if (marker.refused === true) return true;
  return typeof marker.at === "number" && Date.parse(observedAt) <= marker.at;
}
/** Whether a range erasure covers a saved message; see erasedWhenRead. */
export function rangeErasesHistory(
  marker: {
    start?: string | null;
    end?: string | null;
    retention?: unknown;
    at?: unknown;
  },
  record: Pick<HistoryMessage, "occurred_at" | "observed_at">,
): boolean {
  return (
    !marker.retention &&
    erasedWhenRead(marker, record.observed_at) &&
    (record.occurred_at === null ||
      ((!marker.start ||
        compareHistoricalInstants(record.occurred_at, marker.start) >= 0) &&
        (!marker.end ||
          compareHistoricalInstants(record.occurred_at, marker.end) < 0)))
  );
}
/** Namespace, message and linked live-request markers. Range markers are applied by page readers. */
export async function historyMarkersErased(
  store: IDBObjectStore,
  scope: Scope,
  row: HistoryMessage,
): Promise<boolean> {
  if (await request(store.get(scope.namespace))) return true;
  const keys = [
    `${scope.namespace}:history:${row.message_key}`,
    ...(row.provider_request_key
      ? [`history-live:${scope.namespace}:request:${row.provider_request_key}`]
      : []),
    ...(row.provider_attempt_key
      ? [`history-live:${scope.namespace}:attempt:${row.provider_attempt_key}`]
      : []),
  ];
  const markers = await Promise.all(keys.map((key) => request(store.get(key))));
  return markers.some((marker) => erasedWhenRead(marker, row.observed_at));
}
/**
 * Whether a coverage write changes what a totals read can see. The sync-only `pending`
 * flag and the observation time are excluded: each reopen observes the page again.
 */
export function historyCoverageChanged(
  prior:
    | { era?: string | null; deviceId?: string | null; page: HistoryPage }
    | null
    | undefined,
  next: { era: string | null; deviceId: string | null; page: HistoryPage },
): boolean {
  const readable = ({ observed_at: _observed, ...page }: HistoryPage) => page;
  return (
    !prior ||
    (prior.era ?? null) !== next.era ||
    (prior.deviceId ?? null) !== next.deviceId ||
    payloadHash(readable(prior.page)) !== payloadHash(readable(next.page))
  );
}
/** Count bases may describe only messages on the committed page. */
export function checkedCountBases(
  page: HistoryPage,
  bases: Record<string, unknown> | undefined,
): Record<string, HistoryCountBasis> {
  const checked: Record<string, HistoryCountBasis> = Object.create(null);
  if (!bases) return checked;
  const keys = new Set(page.messages.map((message) => message.message_key));
  const entries = Object.entries(bases);
  if (entries.length > keys.size) throw new Error("payload_rejected");
  for (const [key, value] of entries) {
    const parsed = HistoryCountBasisSchema.safeParse(value);
    if (!keys.has(key) || !parsed.success) throw new Error("payload_rejected");
    checked[key] = parsed.data;
  }
  return checked;
}
const COMPANY_KEY = /^[0-9a-f]{64}$/;
/**
 * Company keys of a page's messages (W11), checked like count bases: each names one
 * message of the page.
 */
export function checkedCompanyKeys(
  page: HistoryPage,
  keys: Record<string, unknown> | undefined,
): Record<string, string> {
  const checked: Record<string, string> = Object.create(null);
  if (!keys) return checked;
  const messages = new Set(page.messages.map((message) => message.message_key));
  for (const [key, value] of Object.entries(keys)) {
    if (
      !messages.has(key) ||
      typeof value !== "string" ||
      !COMPANY_KEY.test(value)
    )
      throw new Error("payload_rejected");
    checked[key] = value;
  }
  return checked;
}
/**
 * The company key a capture's checkpoint holds for one of its records (W11). A malformed
 * key is rejected, never stored.
 */
export function checkpointCompanyKey(
  checkpoint:
    | {
        request: { request_id: string };
        attempt: { attempt_id: string };
        companyKeys?: { request?: string; attempt?: string };
      }
    | undefined,
  record: Observation,
): string | undefined {
  const keys: unknown = checkpoint?.companyKeys;
  if (keys === undefined) return undefined;
  if (
    typeof keys !== "object" ||
    keys === null ||
    Object.entries(keys).some(
      ([kind, value]) =>
        (kind !== "request" && kind !== "attempt") ||
        (value !== undefined &&
          (typeof value !== "string" || !COMPANY_KEY.test(value))),
    )
  )
    throw new Error("payload_rejected");
  const named =
    record.kind === "request"
      ? checkpoint!.request.request_id === record.request_id
      : checkpoint!.attempt.attempt_id === record.attempt_id;
  return named ? checkpoint!.companyKeys![record.kind] : undefined;
}
/** A malformed content key is rejected before anything is written. */
export function checkpointContentKey(checkpoint: { contentKey?: unknown }) {
  if (
    checkpoint.contentKey !== undefined &&
    (typeof checkpoint.contentKey !== "string" ||
      !COMPANY_KEY.test(checkpoint.contentKey))
  )
    throw new Error("payload_rejected");
}
/** A checkpoint's reply as saved history can link to it by content, or null. */
export function liveReplyContent(
  job: TrackingCheckpoint,
): LiveReplyContent | null {
  const attemptKey = job.attempt?.provider_attempt_key;
  if (typeof job.contentKey !== "string" || typeof attemptKey !== "string")
    return null;
  return {
    contentKey: job.contentKey,
    attemptKey,
    companyAttemptKey: job.companyKeys?.attempt ?? null,
    startedAt: job.attempt.started_at,
    linkedMessageKeys: [],
  };
}
/** Oldest first, so both repositories link replies with the same content in one order. */
export function sortLiveReplyContents(
  replies: LiveReplyContent[],
): LiveReplyContent[] {
  const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return replies.sort(
    (a, b) =>
      order(a.startedAt, b.startedAt) || order(a.attemptKey, b.attemptKey),
  );
}
export function checkedHistoryRow(value: HistoryRow): HistoryRow {
  const record = HistoryMessageSchema.parse(value.record),
    original = HistoryMessageSchema.parse(value.original);
  const estimate = HistoryResourcesSchema.parse(value.estimate),
    originalEstimate = HistoryResourcesSchema.parse(value.originalEstimate);
  if (
    value.hash !== historyNumericPayloadHash(record) ||
    value.key !== `${value.namespace}:history:${record.message_key}` ||
    original.message_key !== record.message_key ||
    !["current", "conflict"].includes(value.status) ||
    (value.serverConflict !== undefined &&
      (value.serverConflict !== true || value.status !== "conflict")) ||
    (value.companyKey !== undefined &&
      (typeof value.companyKey !== "string" ||
        !COMPANY_KEY.test(value.companyKey)))
  )
    throw new Error("ledger_integrity_failed");
  for (const [source, metrics] of [
    [record, estimate],
    [original, originalEstimate],
  ] as const) {
    if (
      metrics.length !== (source.role === "response" ? 5 : 0) ||
      new Set(metrics.map((m) => m.quantity)).size !== metrics.length ||
      metrics.some(
        (m) =>
          m.method_id !== source.proposed_method_id ||
          m.method_hash !== source.proposed_method_hash,
      )
    )
      throw new Error("ledger_integrity_failed");
  }
  const row: HistoryRow = {
    ...value,
    record,
    original,
    estimate,
    originalEstimate,
  };
  // An unreadable count basis only means the next import counts again.
  if (value.countBasis !== undefined) {
    const basis = HistoryCountBasisSchema.safeParse(value.countBasis);
    if (basis.success) row.countBasis = basis.data;
    else delete row.countBasis;
  }
  return row;
}
export function historyAuthority(state: any): string {
  return payloadHash({
    ownership: state.ownership ?? null,
    device: state.credentials?.device_id ?? null,
    namespace:
      state.credentials?.namespace ?? state.personal?.namespace ?? null,
    era: state.credentials?.enrollment_era?.id ?? null,
    status: state.credentials?.enrollment_state ?? null,
  });
}
/** Access-token refresh is not a trust rotation; installation, enrollment and method key are. */
export function methodTrustIdentity(state: {
  credentials?: any;
  ownership?: any;
}): string {
  const c = state.credentials;
  return canonicalJson({
    namespace: c?.namespace ?? null,
    origin: c?.origin ?? null,
    device: c?.device_id ?? null,
    era: c?.enrollment_era?.id ?? null,
    publicKey: c?.method_public_key ?? null,
    state: c?.enrollment_state ?? "active",
  });
}
export type ThreadRelation = {
  key: string;
  namespace: string;
  threadKey: string;
  providerRequestKey: string;
  requestId: string;
  pending: 0 | 1;
  nextAt: number;
  rejected?: boolean;
  conflictVersion?: number;
};
export type RecordRow = {
  key: string;
  namespace: string;
  era: string | null;
  record: Observation;
  hash: string;
  aliasOf?: string;
  /** The record's company key (W11), kept beside it; once kept it never changes. */
  companyKey?: string;
};
export type DerivedSource = {
  requestId: string;
  requestRevision: number;
  requestHash: string;
  attemptId: string;
  attemptRevision: number;
  attemptHash: string;
};
export type DerivedEntry<T> = {
  key: string;
  namespace: string;
  source: DerivedSource;
  erasureVersion: number;
  value: T;
  actionToken: string;
  actionRevision: number;
};
export type DerivedGuard = {
  erasureVersion: number;
  dependencies: DerivedSource[];
  guidance?: { key: string; actionToken: string; actionRevision: number };
  advanceGuidanceTo?: { requestId: string; attemptId: string };
  requestFileMetadata?: {
    source: DerivedSource;
    ownershipStart: number;
    ownershipEnd: number | null;
    deviceId: string | null;
    enrollmentState: string | null;
    validNow: () => boolean;
  };
};
export const derivedStores = [
  "context_snapshots",
  "guidance_preferences",
] as const;
export type OutboxRow = {
  key: string;
  namespace: string;
  kind: Observation["kind"];
  id: string;
  revision: number;
  hash: string;
  createdAt: number;
  nextAt: number;
  attempts: number;
  quarantined: ReasonCode | null;
  /** The record's company key, uploaded beside it (W11). */
  companyKey?: string;
};
export type Ack = {
  kind: Observation["kind"];
  id: string;
  revision: number;
  payload_hash: string;
  server_record_version: number | null;
  status:
    | "applied"
    | "duplicate"
    | "stale"
    | "stored_pending_estimate"
    | "rejected"
    | "conflict"
    | "aliased"
    | "erased"
    | "retention_expired";
  reason?: ReasonCode;
  canonical_id?: string;
};
export const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
export const completed = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("storage_write_failed"));
    tx.onerror = () => reject(tx.error ?? new Error("storage_write_failed"));
  });
export async function hasPendingPurge(
  tx: IDBTransaction,
  namespace: string,
): Promise<boolean> {
  const history = await request(
    tx
      .objectStore("deletion_markers")
      .openCursor(
        IDBKeyRange.bound(
          `history-cleanup:${namespace}:`,
          `history-cleanup:${namespace}:\uffff`,
        ),
      ),
  );
  if (history) return true;
  return new Promise((resolve, reject) => {
    const cursor = tx
      .objectStore("deletion_markers")
      .openCursor(
        IDBKeyRange.bound(`range:${namespace}:`, `range:${namespace}:\uffff`),
      );
    cursor.onerror = () => reject(cursor.error);
    cursor.onsuccess = () => {
      const entry = cursor.result;
      if (!entry) return resolve(false);
      if (entry.value.status === "purging") return resolve(true);
      entry.continue();
    };
  });
}
export async function invalidateSummaries(
  tx: IDBTransaction,
  namespace: string,
  purge = false,
  threadRejection = false,
) {
  if (purge) await invalidateEstimationJobs(tx, namespace);
  const store = tx.objectStore("dashboard_cache");
  const caches = await request(store.index("namespace").getAll(namespace, 32));
  const epoch = caches.find((cache) => cache.key === `epoch:${namespace}`);
  store.put({
    key: `epoch:${namespace}`,
    namespace,
    version: (epoch?.version ?? 0) + 1,
    erasureVersion: (epoch?.erasureVersion ?? 0) + (purge ? 1 : 0),
    threadRejectionVersion: purge
      ? 0
      : (epoch?.threadRejectionVersion ?? 0) + (threadRejection ? 1 : 0),
  });
  for (const cache of caches)
    if (cache.key !== `epoch:${namespace}`) {
      if (purge) store.delete(cache.key);
      else store.put({ ...cache, dirty: true });
    }
}
export const attemptErasureKey = (namespace: string, id: string) =>
  `attempt-erased:${namespace}:${id}`;
export const recordId = (r: Observation) =>
  r.kind === "request" ? r.request_id : r.attempt_id;
export const recordKey = (
  namespace: string,
  kind: Observation["kind"],
  id: string,
) => `${namespace}:${kind}:${id}`;
export async function sourceCurrent(
  tx: IDBTransaction,
  namespace: string,
  source?: DerivedSource,
) {
  if (
    !source ||
    typeof source.requestId !== "string" ||
    typeof source.attemptId !== "string" ||
    !Number.isSafeInteger(source.requestRevision) ||
    !Number.isSafeInteger(source.attemptRevision) ||
    !/^[a-f0-9]{64}$/.test(source.requestHash) ||
    !/^[a-f0-9]{64}$/.test(source.attemptHash)
  )
    return false;
  const [parent, attempt] = await Promise.all([
    request(
      tx
        .objectStore("requests")
        .get(recordKey(namespace, "request", source.requestId)),
    ),
    request(
      tx
        .objectStore("attempts")
        .get(recordKey(namespace, "attempt", source.attemptId)),
    ),
  ]);
  return (
    !!parent &&
    !parent.aliasOf &&
    parent.hash === source.requestHash &&
    parent.record.revision === source.requestRevision &&
    !!attempt &&
    !attempt.aliasOf &&
    attempt.hash === source.attemptHash &&
    attempt.record.revision === source.attemptRevision &&
    attempt.record.request_id === source.requestId
  );
}
export async function invalidateDerived(
  tx: IDBTransaction,
  namespace: string,
  kind: Observation["kind"],
  id: string,
) {
  for (const store of derivedStores)
    await new Promise<void>((resolve, reject) => {
      const cursor = tx
        .objectStore(store)
        .index(kind === "request" ? "basisRequest" : "basisAttempt")
        .openCursor([namespace, id]);
      cursor.onerror = () => reject(cursor.error);
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return resolve();
        row.delete();
        row.continue();
      };
    });
}
export function sameRequestExceptFiles(
  old: Observation,
  next: Observation,
): boolean {
  if (
    old.kind !== "request" ||
    next.kind !== "request" ||
    old.schema_version !== "3.0.0" ||
    next.schema_version !== "3.0.0" ||
    next.revision !== old.revision + 1
  )
    return false;
  const strip = (record: typeof next) => ({
    ...record,
    revision: 0,
    documents: { ...record.documents, extracted_text: null },
    features: record.features.filter((feature) => feature !== "document"),
    coverage_reasons: record.coverage_reasons.filter(
      (reason) => reason !== "partial_capture",
    ),
  });
  return (
    (!old.features.includes("document") ||
      next.features.includes("document")) &&
    canonicalJson(strip(old)) === canonicalJson(strip(next))
  );
}
export async function carryFileMetadataSources(
  tx: IDBTransaction,
  namespace: string,
  old: RecordRow,
  next: RecordRow,
  erasureVersion: number,
) {
  for (const store of derivedStores)
    await new Promise<void>((resolve, reject) => {
      const cursor = tx
        .objectStore(store)
        .index("basisRequest")
        .openCursor([namespace, recordId(old.record)]);
      cursor.onerror = () => reject(cursor.error);
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return resolve();
        void (async () => {
          const value = row.value as DerivedEntry<unknown>;
          if (
            value.erasureVersion === erasureVersion &&
            value.source.requestRevision === old.record.revision &&
            value.source.requestHash === old.hash &&
            (await sourceCurrent(tx, namespace, value.source))
          )
            row.update({
              ...value,
              source: {
                ...value.source,
                requestRevision: next.record.revision,
                requestHash: next.hash,
              },
            });
          else row.delete();
          row.continue();
        })().catch(reject);
      };
    });
}
export async function redirectThreadRelation(
  tx: IDBTransaction,
  namespace: string,
  sourceId: string,
  targetId: string,
) {
  const store = tx.objectStore("thread_relations");
  const rows = await request(
    store.index("request").getAll([namespace, sourceId]),
  );
  for (const row of rows) store.put({ ...row, requestId: targetId });
}
export async function validateThreadIdentity(
  tx: IDBTransaction,
  namespace: string,
  record: Observation,
) {
  if (record.kind !== "request") return;
  const store = tx.objectStore("thread_relations");
  const links = await request(
    store.index("request").getAll([namespace, record.request_id]),
  );
  for (const link of links)
    if (
      record.site !== "perplexity" ||
      record.provider_request_key !== link.providerRequestKey
    )
      store.delete(link.key);
}
export async function sourceFollows(
  tx: IDBTransaction,
  namespace: string,
  next: DerivedSource,
  previous: DerivedSource,
) {
  const [nr, pr, na, pa] = await Promise.all([
    request(
      tx
        .objectStore("requests")
        .get(recordKey(namespace, "request", next.requestId)),
    ),
    request(
      tx
        .objectStore("requests")
        .get(recordKey(namespace, "request", previous.requestId)),
    ),
    request(
      tx
        .objectStore("attempts")
        .get(recordKey(namespace, "attempt", next.attemptId)),
    ),
    request(
      tx
        .objectStore("attempts")
        .get(recordKey(namespace, "attempt", previous.attemptId)),
    ),
  ]);
  if (!nr || !pr || !na || !pa) return false;
  if (next.requestId !== previous.requestId)
    return nr.record.dispatched_at > pr.record.dispatched_at;
  if (next.attemptId !== previous.attemptId)
    return na.record.started_at > pa.record.started_at;
  return (
    next.requestRevision >= previous.requestRevision &&
    next.attemptRevision >= previous.attemptRevision
  );
}
export async function derivedGuardCurrent(
  tx: IDBTransaction,
  namespace: string,
  guard: DerivedGuard,
) {
  const [epoch, erased, purging] = await Promise.all([
    request(tx.objectStore("dashboard_cache").get(`epoch:${namespace}`)),
    request(tx.objectStore("deletion_markers").get(namespace)),
    hasPendingPurge(tx, namespace),
  ]);
  return (
    !erased &&
    !purging &&
    guard.erasureVersion === (epoch?.erasureVersion ?? 0) &&
    guard.dependencies.length <= 2 &&
    (
      await Promise.all(
        guard.dependencies.map((source) =>
          sourceCurrent(tx, namespace, source),
        ),
      )
    ).every(Boolean)
  );
}
export async function digest(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(value)),
  );
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
