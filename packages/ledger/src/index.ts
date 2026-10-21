import { HistoryRepository } from "./history-repository";
import { compareLiveEvidence } from "./live-history-link";
import { IndexedDbEstimationRepository } from "./estimation-repository";
import { resumePendingCleanup as recoverPendingCleanup } from "./cleanup-recovery";
import { localSelectionCurrent, readLocalAuthority } from "./local-selection";
import { createIndexedDbRepository } from "./indexeddb-repository";
import type { ApplicationRepository } from "./repository-contracts";
import { INTERRUPTED_AFTER_MS } from "./repository-contracts";
import type {
  MonthlyViewClaim,
  MonthlyViewClaimResult,
} from "./repository-contracts";
import { claimMonthlyView as claimGuardedMonthlyView } from "./monthly-claim";
import {
  validateCaptureMetadata,
  type CaptureMetadataGuard,
} from "./capture-validation";
import {
  estimationTransactionStores,
  touchInput,
  refreshOriginalEvidence,
  refreshHistoryAuthority,
  touchObservation,
  touchAliases,
  storeOriginal,
  writable,
  eachCursor,
  checkedScope,
  historyRowErased,
} from "./estimation-storage";
import type { EstimationEnvelope } from "@footprint/contracts";
export * from "./estimation-contracts";
export * from "./repository-contracts";
export * from "./session-contracts";
import {
  MODEL_LABEL_LIMIT,
  MODEL_LABEL_PATTERN,
  healthSolved,
  type StoredHealth,
} from "./session-contracts";
export { createIndexedDbRepository } from "./indexeddb-repository";
export { createMemoryRepository } from "./memory-repository";
import { openDatabase } from "./database";
import {
  canonicalJson,
  payloadHash,
  parseObservation,
  ReasonCodeSchema,
  SiteSchema,
  type Observation,
  type ReasonCode,
  type Site,
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
} from "@footprint/contracts";

import {
  STORES,
  type Scope,
  type HistoryRow,
  checkedHistoryRow,
  historyAuthority,
  methodTrustIdentity,
  type ThreadRelation,
  type RecordRow,
  type DerivedSource,
  type DerivedEntry,
  type DerivedGuard,
  derivedStores,
  type OutboxRow,
  type Ack,
  request,
  completed,
  hasPendingPurge,
  invalidateSummaries,
  recordId,
  recordKey,
  attemptErasureKey,
  sourceCurrent,
  invalidateDerived,
  sameRequestExceptFiles,
  carryFileMetadataSources,
  redirectThreadRelation,
  validateThreadIdentity,
  sourceFollows,
  derivedGuardCurrent,
  digest,
  historyMarkersErased,
  checkpointCompanyKey,
} from "./ledger-support";
export {
  checkedHistoryRow,
  historyAuthority,
  methodTrustIdentity,
  recordId,
  digest,
} from "./ledger-support";
export type {
  Scope,
  HistoryRow,
  ThreadRelation,
  RecordRow,
  DerivedSource,
  DerivedEntry,
  DerivedGuard,
  OutboxRow,
  Ack,
  CoworkAdvance,
  CoworkCheckpoint,
} from "./ledger-support";

/** All writes are numeric/categorical observations validated at the persistence boundary. */
export class Ledger {
  private applicationRepository?: ApplicationRepository;
  get application(): ApplicationRepository {
    return (this.applicationRepository ??= createIndexedDbRepository(this));
  }
  claimMonthlyView(command: MonthlyViewClaim): Promise<MonthlyViewClaimResult> {
    return claimGuardedMonthlyView(this.db, command);
  }
  private healthFailureListeners = new Set<
    (namespace: string, code: ReasonCode, error: unknown) => void
  >();
  onHealthFailure(
    listener: (namespace: string, code: ReasonCode, error: unknown) => void,
  ): () => void {
    this.healthFailureListeners.add(listener);
    return () => this.healthFailureListeners.delete(listener);
  }
  private healthResolvedListeners = new Set<
    (namespace: string, codes: readonly ReasonCode[]) => void
  >();
  onHealthResolved(
    listener: (namespace: string, codes: readonly ReasonCode[]) => void,
  ): () => void {
    this.healthResolvedListeners.add(listener);
    return () => this.healthResolvedListeners.delete(listener);
  }
  readonly estimation: IndexedDbEstimationRepository;
  readonly history: HistoryRepository;
  resumePendingCleanup(
    limit = 32,
  ): Promise<{ processed: number; pending: boolean }> {
    return recoverPendingCleanup(
      this.db,
      {
        eraseFamily: (namespace, id) => this.eraseFamily(namespace, id),
        eraseAttemptAliases: (namespace, id, era) =>
          this.eraseAttemptAliases(namespace, id, era, false, new Set()),
      },
      limit,
    );
  }
  private constructor(private db: IDBDatabase) {
    this.estimation = new IndexedDbEstimationRepository(db);
    this.history = new HistoryRepository(
      (stores, mode) => this.transaction(stores, mode),
      (tx) => this.readRouting(tx),
    );
  }
  private transaction(
    stores: string | string[],
    mode: IDBTransactionMode,
  ): IDBTransaction {
    const names = typeof stores === "string" ? [stores] : stores;
    return this.db.transaction(
      mode === "readwrite"
        ? [...new Set([...names, ...estimationTransactionStores])]
        : names,
      mode,
    );
  }
  async capture(
    scope: Scope,
    records: unknown[],
    results: EstimationEnvelope[] = [],
  ): Promise<void> {
    await this.commit(
      scope,
      records,
      results.map((estimate) => ({
        store: "estimation_originals" as const,
        value: { key: "validated-original", estimate },
      })),
    );
  }
  static async open(name = "ai-footprint-tracker-v1"): Promise<Ledger> {
    const db = await openDatabase(name);
    return new Ledger(db);
  }
  private routingListeners = new Set<() => void>();
  onRoutingChange(listener: () => void): () => void {
    this.routingListeners.add(listener);
    return () => this.routingListeners.delete(listener);
  }
  private routingChanged(keys: string[]) {
    if (
      !keys.some((key) =>
        [
          "credentials",
          "personal",
          "ownership-history",
          "committed-erasure",
          "committed-thread-rejection",
        ].includes(key),
      )
    )
      return;
    for (const listener of this.routingListeners) {
      try {
        listener();
      } catch {}
    }
  }
  close(): void {
    this.routingListeners.clear();
    this.db.close();
  }
  async commit(
    scope: Scope,
    inputs: unknown[],
    metadata: Array<{
      store: (typeof STORES)[number];
      value: { key: string; [key: string]: unknown };
    }> = [],
    derivedGuard?: DerivedGuard,
    captureMetadata?: CaptureMetadataGuard,
  ): Promise<void> {
    checkedScope(scope);
    const records = inputs.map(parseObservation);
    const hashes = await Promise.all(records.map(digest));
    if (
      !/^(personal|company):[a-z0-9:-]{1,160}$/.test(scope.namespace) ||
      (scope.mode === "company" && !scope.era)
    )
      throw new Error("policy_unavailable");
    const tx = this.transaction(
      [
        ...new Set([
          "requests",
          "attempts",
          "measurements",
          "outbox",
          "deletion_markers",
          "dashboard_cache",
          ...derivedStores,
          "thread_relations",
          ...metadata.map((m) => m.store),
          ...(derivedGuard?.requestFileMetadata ? ["policy"] : []),
        ]),
      ],
      "readwrite",
    );
    const done = completed(tx);
    try {
      if (metadata.some((entry) => derivedStores.includes(entry.store as any)))
        throw new Error("derived_write_requires_guard");
      if (
        derivedGuard &&
        !(await derivedGuardCurrent(tx, scope.namespace, derivedGuard))
      )
        throw new Error("derived_dependency_changed");
      if (derivedGuard?.requestFileMetadata) {
        const guard = derivedGuard.requestFileMetadata,
          routing = await this.readRouting(tx),
          settings = await request(tx.objectStore("policy").get("settings"));
        if (
          records.length !== 1 ||
          records[0]!.kind !== "request" ||
          !routing.ownership ||
          !guard.validNow() ||
          canonicalJson(routing.ownership.scope) !== canonicalJson(scope) ||
          routing.ownership.start !== guard.ownershipStart ||
          routing.ownership.end !== guard.ownershipEnd ||
          (routing.credentials?.device_id ?? null) !== guard.deviceId ||
          (routing.credentials?.enrollment_state ?? null) !==
            guard.enrollmentState ||
          canonicalJson(derivedGuard.dependencies) !==
            canonicalJson([guard.source]) ||
          metadata.some(
            (item) =>
              item.store !== "provider_key_map" ||
              item.value.namespace !== scope.namespace,
          ) ||
          (settings?.paused &&
            !(
              scope.mode === "company" &&
              routing.credentials?.namespace === scope.namespace &&
              routing.credentials?.policy.pause_mode === "disabled_by_company"
            ))
        )
          throw new Error("derived_dependency_changed");
      }
      let carriedGuidance: DerivedEntry<any> | undefined;
      if (derivedGuard?.guidance) {
        const row = await request(
          tx.objectStore("guidance_preferences").get(derivedGuard.guidance.key),
        );
        if (
          row?.namespace === scope.namespace &&
          row.actionToken === derivedGuard.guidance.actionToken &&
          row.erasureVersion === derivedGuard.erasureVersion &&
          (await sourceCurrent(tx, scope.namespace, row.source))
        )
          carriedGuidance = row;
      }
      if (
        await request(tx.objectStore("deletion_markers").get(scope.namespace))
      )
        throw new Error("record_erased");
      const parentIds = new Set(
        records.filter((r) => r.kind === "request").map((r) => r.request_id),
      );
      const ranges = await request(
        tx
          .objectStore("deletion_markers")
          .getAll(
            IDBKeyRange.bound(
              `range:${scope.namespace}:`,
              `range:${scope.namespace}:\uffff`,
            ),
          ),
      );
      for (let i = 0; i < records.length; i++) {
        const record = records[i]!;
        const hash = hashes[i]!;
        const key = recordKey(scope.namespace, record.kind, recordId(record));
        if (
          record.kind === "attempt" &&
          (await request(
            tx
              .objectStore("deletion_markers")
              .get(attemptErasureKey(scope.namespace, record.attempt_id)),
          ))
        )
          throw new Error("record_erased");
        if (
          await request(
            tx
              .objectStore("deletion_markers")
              .get(`${scope.namespace}:${record.request_id}`),
          )
        )
          throw new Error("record_erased");
        if (
          record.kind === "request" &&
          ranges.some(
            (marker) =>
              (!marker.start || record.dispatched_at >= marker.start) &&
              (!marker.end || record.dispatched_at < marker.end),
          )
        )
          throw new Error("record_erased");
        if (
          record.kind === "attempt" &&
          !parentIds.has(record.request_id) &&
          !(await request(
            tx
              .objectStore("requests")
              .get(recordKey(scope.namespace, "request", record.request_id)),
          ))
        )
          throw new Error("dependency_missing");
        const store = record.kind === "request" ? "requests" : "attempts";
        const old = (await request(tx.objectStore(store).get(key))) as
          RecordRow | undefined;
        if (old && old.era !== scope.era) throw new Error("policy_unavailable");
        if (old && old.record.revision > record.revision)
          throw new Error("revision_conflict");
        if (old && old.record.revision === record.revision) {
          if (old.hash !== hash) throw new Error("revision_conflict");
          continue;
        }
        // A kept company key never changes: it names the prompt or reply itself (W11).
        const companyKey =
          old?.companyKey ??
          checkpointCompanyKey(captureMetadata?.checkpoint, record);
        const row: RecordRow = {
          key,
          namespace: scope.namespace,
          era: scope.era,
          record,
          hash,
          ...(old?.aliasOf ? { aliasOf: old.aliasOf } : {}),
          ...(companyKey ? { companyKey } : {}),
        };
        const revisionKey = `${key}:${record.revision}`;
        if (derivedGuard?.requestFileMetadata) {
          if (
            !old ||
            old.aliasOf ||
            !sameRequestExceptFiles(old.record, record) ||
            old.hash !== derivedGuard.requestFileMetadata.source.requestHash ||
            recordId(old.record) !==
              derivedGuard.requestFileMetadata.source.requestId
          )
            throw new Error("derived_dependency_changed");
          await carryFileMetadataSources(
            tx,
            scope.namespace,
            old,
            row,
            derivedGuard.erasureVersion,
          );
        } else if (old)
          await invalidateDerived(
            tx,
            scope.namespace,
            record.kind,
            recordId(record),
          );
        await validateThreadIdentity(tx, scope.namespace, record);
        tx.objectStore(store).put(row);
        await touchObservation(tx, scope, record);
        tx.objectStore("measurements").put({ ...row, key: revisionKey });
        if (scope.mode === "company")
          tx.objectStore("outbox").put({
            key: revisionKey,
            namespace: scope.namespace,
            kind: record.kind,
            id: recordId(record),
            revision: record.revision,
            hash,
            createdAt: Date.now(),
            nextAt: 0,
            attempts: 0,
            quarantined: null,
            ...(companyKey ? { companyKey } : {}),
          } satisfies OutboxRow);
      }
      if (carriedGuidance && derivedGuard?.advanceGuidanceTo) {
        const ri = records.findIndex(
          (r) =>
            r.kind === "request" &&
            r.request_id === derivedGuard.advanceGuidanceTo!.requestId,
        );
        const ai = records.findIndex(
          (r) =>
            r.kind === "attempt" &&
            r.attempt_id === derivedGuard.advanceGuidanceTo!.attemptId,
        );
        if (ri >= 0 && ai >= 0) {
          const source = {
            requestId: derivedGuard.advanceGuidanceTo.requestId,
            requestRevision: records[ri]!.revision,
            requestHash: hashes[ri]!,
            attemptId: derivedGuard.advanceGuidanceTo.attemptId,
            attemptRevision: records[ai]!.revision,
            attemptHash: hashes[ai]!,
          };
          if (
            (await sourceCurrent(tx, scope.namespace, source)) &&
            (await sourceFollows(
              tx,
              scope.namespace,
              source,
              carriedGuidance.source,
            ))
          )
            tx.objectStore("guidance_preferences").put({
              ...carriedGuidance,
              source,
            });
        }
      }
      if (captureMetadata)
        await validateCaptureMetadata(tx, scope, captureMetadata);
      for (const item of metadata) {
        if (
          item.store === "estimation_originals" ||
          (item.store === "local_estimates" &&
            (item.value.estimate as any)?.schema_version === "3.0.0")
        ) {
          await storeOriginal(tx, scope, item.value.estimate);
          if (item.store === "local_estimates") {
            if (item.value.namespace !== scope.namespace)
              throw new Error("policy_unavailable");
            const previous = await request(
              tx.objectStore("local_estimates").get(item.value.key),
            );
            if (
              item.value.selection !== "current" &&
              previous &&
              canonicalJson(previous) !== canonicalJson(item.value)
            )
              throw new Error("revision_conflict");
            tx.objectStore("local_estimates").put(item.value);
          }
        } else if (
          item.store.startsWith("estimation_") ||
          item.store === "engine_preferences"
        )
          throw new Error("typed_repository_required");
        else tx.objectStore(item.store).put(item.value);
      }
      await invalidateSummaries(tx, scope.namespace);
      if (
        derivedGuard?.requestFileMetadata &&
        !derivedGuard.requestFileMetadata.validNow()
      )
        throw new Error("derived_dependency_changed");
      await done;
    } catch (error) {
      try {
        tx.abort();
      } catch {}
      await done.catch(() => {});
      throw error;
    }
  }
  async write(
    scope: Scope,
    input: unknown,
  ): Promise<"applied" | "duplicate" | "stale"> {
    checkedScope(scope);
    const record = parseObservation(input);
    if (
      !/^(personal|company):[a-z0-9:-]{1,160}$/.test(scope.namespace) ||
      (scope.mode === "company" && !scope.era)
    )
      throw new Error("policy_unavailable");
    const hash = await digest(record);
    const store = record.kind === "request" ? "requests" : "attempts";
    const key = recordKey(scope.namespace, record.kind, recordId(record));
    const tx = this.transaction(
      [
        ...new Set([
          store,
          "requests",
          "measurements",
          "outbox",
          "deletion_markers",
          "dashboard_cache",
          ...derivedStores,
          "thread_relations",
        ]),
      ],
      "readwrite",
    );
    const done = completed(tx);
    try {
      if (
        record.kind === "attempt" &&
        (await request(
          tx
            .objectStore("deletion_markers")
            .get(attemptErasureKey(scope.namespace, record.attempt_id)),
        ))
      )
        throw new Error("record_erased");
      const erased = await request(
        tx.objectStore("deletion_markers").get(scope.namespace),
      );
      if (erased) {
        tx.abort();
        await done.catch(() => {});
        throw new Error("record_erased");
      }
      if (
        await request(
          tx
            .objectStore("deletion_markers")
            .get(`${scope.namespace}:${record.request_id}`),
        )
      ) {
        tx.abort();
        await done.catch(() => {});
        throw new Error("record_erased");
      }
      if (record.kind === "request") {
        const ranges = await request(
          tx
            .objectStore("deletion_markers")
            .getAll(
              IDBKeyRange.bound(
                `range:${scope.namespace}:`,
                `range:${scope.namespace}:\uffff`,
              ),
            ),
        );
        if (
          ranges.some(
            (marker) =>
              (!marker.start || record.dispatched_at >= marker.start) &&
              (!marker.end || record.dispatched_at < marker.end),
          )
        ) {
          tx.abort();
          await done.catch(() => {});
          throw new Error("record_erased");
        }
      }
      if (
        record.kind === "attempt" &&
        !(await request(
          tx
            .objectStore("requests")
            .get(recordKey(scope.namespace, "request", record.request_id)),
        ))
      ) {
        tx.abort();
        await done.catch(() => {});
        throw new Error("dependency_missing");
      }
      const previous = (await request(tx.objectStore(store).get(key))) as
        RecordRow | undefined;
      if (previous && previous.era !== scope.era)
        throw new Error("policy_unavailable");
      if (previous && previous.record.revision > record.revision) {
        await done;
        return "stale";
      }
      if (previous && previous.record.revision === record.revision) {
        if (previous.hash !== hash) {
          tx.abort();
          await done.catch(() => {});
          throw new Error("revision_conflict");
        }
        await done;
        return "duplicate";
      }
      const row: RecordRow = {
        key,
        namespace: scope.namespace,
        era: scope.era,
        record,
        hash,
        ...(previous?.aliasOf ? { aliasOf: previous.aliasOf } : {}),
        ...(previous?.companyKey ? { companyKey: previous.companyKey } : {}),
      };
      if (previous)
        await invalidateDerived(
          tx,
          scope.namespace,
          record.kind,
          recordId(record),
        );
      await validateThreadIdentity(tx, scope.namespace, record);
      tx.objectStore(store).put(row);
      await touchObservation(tx, scope, record);
      const revKey = `${key}:${record.revision}`;
      tx.objectStore("measurements").put({ ...row, key: revKey });
      if (scope.mode === "company")
        tx.objectStore("outbox").put({
          key: revKey,
          namespace: scope.namespace,
          kind: record.kind,
          id: recordId(record),
          revision: record.revision,
          hash,
          createdAt: Date.now(),
          nextAt: 0,
          attempts: 0,
          quarantined: null,
          ...(row.companyKey ? { companyKey: row.companyKey } : {}),
        } satisfies OutboxRow);
      await invalidateSummaries(tx, scope.namespace);
      await done;
      return "applied";
    } catch (error) {
      try {
        tx.abort();
      } catch {}
      await done.catch(() => {});
      throw error;
    }
  }
  async rows(namespace: string): Promise<RecordRow[]> {
    const tx = this.transaction(["requests", "attempts"], "readonly");
    const done = completed(tx);
    const [requests, attempts] = await Promise.all([
      request(
        tx.objectStore("requests").index("namespace").getAll(namespace, 10001),
      ),
      request(
        tx.objectStore("attempts").index("namespace").getAll(namespace, 10001),
      ),
    ]);
    await done;
    if (requests.length > 10000 || attempts.length > 10000)
      throw new Error(
        "Select a shorter period to view more than 10,000 records.",
      );
    return [...requests, ...attempts];
  }
  /** Pages leave the IDB transaction before consumers await work, with at most 200 rows resident. */
  async scanRecords(
    namespace: string,
    kind: Observation["kind"],
    consume: (rows: RecordRow[]) => Promise<void> | void,
  ): Promise<number> {
    const store = kind === "request" ? "requests" : "attempts";
    const prefix = `${namespace}:${kind}:`;
    let after: string | null = null;
    let total = 0;
    for (;;) {
      const tx = this.transaction(store, "readonly");
      const done = completed(tx);
      const page: RecordRow[] = [];
      await new Promise<void>((resolve, reject) => {
        const cursor = tx
          .objectStore(store)
          .openCursor(
            IDBKeyRange.bound(
              after ?? prefix,
              prefix + "\uffff",
              after !== null,
              false,
            ),
          );
        cursor.onerror = () => reject(cursor.error);
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (!c || page.length >= 200) {
            resolve();
            return;
          }
          page.push(c.value);
          c.continue();
        };
      });
      await done;
      if (!page.length) break;
      total += page.length;
      after = page.at(-1)!.key;
      await consume(page);
      if (page.length < 200) break;
    }
    return total;
  }
  /**
   * `scanRecords` for the rows of a period only: a request's `dispatched_at` or an attempt's
   * `started_at` at or after `start` and before `end`. The time index gives the period's keys,
   * which are then read in key order, 200 per transaction like `scanRecords`, so a 30-day total
   * of a long history reads the month instead of every reply (16 Oct 2026).
   */
  async scanRecordsBetween(
    namespace: string,
    kind: Observation["kind"],
    between: { start?: string; end?: string },
    consume: (rows: RecordRow[]) => Promise<void> | void,
  ): Promise<number> {
    const store = kind === "request" ? "requests" : "attempts";
    const index = kind === "request" ? "occurred" : "started";
    const { start, end } = between;
    if (
      (start !== undefined && typeof start !== "string") ||
      (end !== undefined && typeof end !== "string")
    )
      throw new Error("payload_rejected");
    // An empty period (IDBKeyRange.bound refuses a lower bound above the upper one).
    if (start !== undefined && end !== undefined && start >= end) return 0;
    const keys = await (async () => {
      const tx = this.transaction(store, "readonly");
      const done = completed(tx);
      // Strings sort before arrays, so [namespace, []] is above every time of the namespace.
      const found = await request(
        tx
          .objectStore(store)
          .index(index)
          .getAllKeys(
            IDBKeyRange.bound(
              [namespace, start ?? ""],
              [namespace, end ?? []],
              false,
              true,
            ),
          ),
      );
      await done;
      // The default sort compares UTF-16 code units, as IndexedDB orders string keys.
      return (found as string[]).sort();
    })();
    let total = 0;
    for (let offset = 0; offset < keys.length; offset += 200) {
      const tx = this.transaction(store, "readonly");
      const done = completed(tx);
      const rows = await Promise.all(
        keys
          .slice(offset, offset + 200)
          .map((key) =>
            request<RecordRow | undefined>(tx.objectStore(store).get(key)),
          ),
      );
      await done;
      // A row deleted since its key was read is left out, as a cursor would not reach it.
      const page = rows.filter((row): row is RecordRow => row !== undefined);
      if (!page.length) continue;
      total += page.length;
      await consume(page);
    }
    return total;
  }
  getRecord(namespace: string, kind: Observation["kind"], id: string) {
    return this.get<RecordRow>(
      kind === "request" ? "requests" : "attempts",
      recordKey(namespace, kind, id),
    );
  }
  /** A summary scan reads each page's parent requests with one read instead of one per reply. */
  async getRecords(
    namespace: string,
    kind: Observation["kind"],
    ids: string[],
  ): Promise<Array<RecordRow | undefined>> {
    if (!Array.isArray(ids) || ids.length > 200)
      throw new Error("payload_rejected");
    if (!ids.length) return [];
    const store = kind === "request" ? "requests" : "attempts";
    const tx = this.transaction(store, "readonly");
    const done = completed(tx);
    const rows = await Promise.all(
      ids.map((id) =>
        request<RecordRow | undefined>(
          tx.objectStore(store).get(recordKey(namespace, kind, id)),
        ),
      ),
    );
    await done;
    return rows;
  }
  async linkRecordedThread(
    scope: Scope,
    threadKey: string,
    providerKeys: string[],
    erasureVersion: number,
    confirmation?: { keys: string[]; versions: Record<string, number> },
    current?: () => void,
  ) {
    if (
      !/^[a-f0-9]{64}$/.test(threadKey) ||
      providerKeys.length > 100 ||
      new Set(providerKeys).size !== providerKeys.length ||
      !providerKeys.every((key) => /^[a-f0-9]{64}$/.test(key))
    )
      throw new Error("payload_rejected");
    const tx = this.transaction(
      ["requests", "deletion_markers", "dashboard_cache", "thread_relations"],
      "readwrite",
    );
    const done = completed(tx),
      matched: string[] = [];
    try {
      if (
        !(await derivedGuardCurrent(tx, scope.namespace, {
          erasureVersion,
          dependencies: [],
        }))
      )
        throw new Error("deletion_in_progress");
      const links = tx.objectStore("thread_relations");
      current?.();
      for (const providerKey of providerKeys) {
        const rows = await request(
          tx
            .objectStore("requests")
            .index("provider")
            .getAll([scope.namespace, providerKey], 101),
        );
        const candidates = rows.filter(
          (row) => !row.aliasOf && row.record.site === "perplexity",
        );
        if (rows.length > 100 || candidates.length > 1)
          throw new Error("conflicting_duplicate_identity");
        const record = candidates[0];
        if (!record) continue;
        const key = `${scope.namespace}:${providerKey}`,
          old = await request(links.get(key));
        const confirmed =
          confirmation?.keys.includes(providerKey) &&
          confirmation.versions[providerKey] === (old?.conflictVersion ?? 0);
        if (old?.rejected && !confirmed)
          throw new Error("thread_relation_conflict");
        if (old && !old.rejected && old.threadKey !== threadKey)
          throw new Error("thread_relation_conflict");
        current?.();
        links.put({
          key,
          namespace: scope.namespace,
          threadKey,
          providerRequestKey: providerKey,
          requestId: record.record.request_id,
          pending: scope.mode === "company" ? (old?.pending ?? 1) : 0,
          nextAt: old?.nextAt ?? 0,
          rejected: false,
          conflictVersion: old?.conflictVersion ?? 0,
        } satisfies ThreadRelation);
        matched.push(providerKey);
      }
      if (matched.length) await invalidateSummaries(tx, scope.namespace);
      current?.();
      await done;
      return matched;
    } catch (error) {
      try {
        tx.abort();
      } catch {}
      await done.catch(() => {});
      throw error;
    }
  }
  async scanThreadRequests(
    namespace: string,
    threadKey: string,
    consume: (rows: RecordRow[]) => Promise<void> | void,
  ) {
    await this.scanIndex(
      "thread_relations",
      "thread",
      [namespace, threadKey],
      async (links) => {
        const rows: RecordRow[] = [];
        for (const link of links as unknown as ThreadRelation[]) {
          const row = await this.getRecord(
            namespace,
            "request",
            link.requestId,
          );
          if (
            !link.rejected &&
            row &&
            !row.aliasOf &&
            row.record.kind === "request" &&
            row.record.site === "perplexity" &&
            row.record.provider_request_key === link.providerRequestKey
          )
            rows.push(row);
        }
        await consume(rows);
      },
    );
  }
  async pendingThreadLinks(
    namespace: string,
    limit = 100,
  ): Promise<ThreadRelation[]> {
    if (!Number.isInteger(limit) || limit < 1)
      throw new Error("payload_rejected");
    const maximum = Math.min(limit, 100);
    type Position = { at: number; key: string };
    type ScanCursor = {
      key: string;
      namespace: string;
      erasureVersion: number;
      after: Position | null;
      end: Position;
    };
    const cursorKey = `thread-queue-cursor:${namespace}`;
    const tx = this.transaction(
        ["thread_relations", "requests", "outbox", "policy", "dashboard_cache"],
        "readwrite",
      ),
      done = completed(tx);
    const index = tx.objectStore("thread_relations").index("pending"),
      policy = tx.objectStore("policy");
    const epoch = await request(
      tx.objectStore("dashboard_cache").get(`epoch:${namespace}`),
    );
    const erasureVersion: number = epoch?.erasureVersion ?? 0;
    let cursor = (await request(policy.get(cursorKey))) as
      ScanCursor | undefined;
    const valid = (position: Position | null) =>
      position === null ||
      (!!position &&
        Number.isSafeInteger(position.at) &&
        position.at >= 0 &&
        typeof position.key === "string" &&
        position.key.startsWith(namespace + ":"));
    if (
      cursor &&
      (cursor.namespace !== namespace ||
        cursor.erasureVersion !== erasureVersion ||
        !valid(cursor.after) ||
        !cursor.end ||
        !valid(cursor.end))
    )
      cursor = undefined;
    if (!cursor) {
      const last = await request(
        index.openCursor(
          IDBKeyRange.bound([namespace, 1, 0], [namespace, 1, Date.now()]),
          "prev",
        ),
      );
      if (last)
        cursor = {
          key: cursorKey,
          namespace,
          erasureVersion,
          after: null,
          end: {
            at: Number((last.key as IDBValidKey[])[2]),
            key: String(last.primaryKey),
          },
        };
    }
    if (!cursor) {
      policy.delete(cursorKey);
      await done;
      return [];
    }
    // Each cycle has a fixed upper bound so new work cannot indefinitely postpone a wrap.
    const { after, end } = cursor;
    const links: ThreadRelation[] = [];
    let finished = false;
    await new Promise<void>((resolve, reject) => {
      const scan = index.openCursor(
        IDBKeyRange.bound(
          [namespace, 1, after?.at ?? 0],
          [namespace, 1, end.at],
        ),
      );
      scan.onerror = () => reject(scan.error);
      scan.onsuccess = () => {
        const row = scan.result;
        if (
          !row ||
          (Number((row.key as IDBValidKey[])[2]) === end.at &&
            String(row.primaryKey) > end.key)
        ) {
          finished = true;
          resolve();
          return;
        }
        const at = Number((row.key as IDBValidKey[])[2]);
        if (after && at === after.at && String(row.primaryKey) <= after.key) {
          if (String(row.primaryKey) < after.key)
            row.continuePrimaryKey(row.key, after.key);
          else row.continue();
          return;
        }
        if (links.length >= maximum) {
          resolve();
          return;
        }
        links.push(row.value);
        row.continue();
      };
    });
    const ready: ThreadRelation[] = [];
    let advanced = after;
    for (const link of links) {
      const parent = await request(
        tx
          .objectStore("requests")
          .get(recordKey(namespace, "request", link.requestId)),
      );
      const eligible =
        !link.rejected &&
        parent &&
        !parent.aliasOf &&
        parent.record.provider_request_key === link.providerRequestKey &&
        !(await request(
          tx
            .objectStore("outbox")
            .get(`${parent.key}:${parent.record.revision}`),
        ));
      // The caller sends one thread per batch. Leave the next eligible thread for the next tick.
      if (eligible && ready.length && ready[0]!.threadKey !== link.threadKey) {
        finished = false;
        break;
      }
      advanced = { at: link.nextAt, key: link.key };
      if (eligible) ready.push(link);
    }
    if (finished) policy.delete(cursorKey);
    else policy.put({ ...cursor, after: advanced });
    await done;
    return ready;
  }
  async acknowledgeThreadLinks(
    namespace: string,
    threadKey: string,
    results: {
      provider_request_key: string;
      status: "linked" | "not_recorded";
    }[],
    erasureVersion: number,
  ) {
    const tx = this.transaction(
        ["thread_relations", "requests", "dashboard_cache", "deletion_markers"],
        "readwrite",
      ),
      done = completed(tx);
    if (
      await derivedGuardCurrent(tx, namespace, {
        erasureVersion,
        dependencies: [],
      })
    ) {
      const store = tx.objectStore("thread_relations");
      for (const result of results) {
        const row = await request(
          store.get(`${namespace}:${result.provider_request_key}`),
        );
        if (!row || row.rejected || row.threadKey !== threadKey) continue;
        const parent = await request(
          tx
            .objectStore("requests")
            .get(recordKey(namespace, "request", row.requestId)),
        );
        if (
          parent &&
          !parent.aliasOf &&
          parent.record.provider_request_key === row.providerRequestKey
        )
          store.put({
            ...row,
            pending: result.status === "linked" ? 0 : 1,
            nextAt: Date.now() + 60000,
          });
      }
    }
    await done;
  }
  async rejectThreadLinks(
    scope: Scope,
    threadKey: string,
    keys: string[],
    expected: { erasureVersion: number; deviceId: string },
  ) {
    const namespace = scope.namespace;
    const tx = this.transaction(
        [
          "thread_relations",
          "dashboard_cache",
          "policy",
          "deletion_markers",
          "requests",
        ],
        "readwrite",
      ),
      done = completed(tx);
    const credentials = await request(
      tx.objectStore("policy").get("credentials"),
    );
    if (
      scope.mode !== "company" ||
      credentials?.namespace !== namespace ||
      credentials.device_id !== expected.deviceId ||
      credentials.enrollment_era?.id !== scope.era ||
      !(await derivedGuardCurrent(tx, namespace, {
        erasureVersion: expected.erasureVersion,
        dependencies: [],
      }))
    ) {
      await done;
      return false;
    }
    let changed = false;
    for (const key of keys.slice(0, 100)) {
      const row = await request(
        tx.objectStore("thread_relations").get(`${namespace}:${key}`),
      );
      if (row?.threadKey === threadKey && !row.rejected) {
        const parent = await request(
          tx
            .objectStore("requests")
            .get(recordKey(namespace, "request", row.requestId)),
        );
        if (
          !parent ||
          parent.aliasOf ||
          parent.record.provider_request_key !== key
        )
          continue;
        // A confirmed contradiction requires a fresh positive server result before local reuse.
        tx.objectStore("thread_relations").put({
          ...row,
          rejected: true,
          pending: 0,
          conflictVersion: (row.conflictVersion ?? 0) + 1,
        });
        changed = true;
      }
    }
    if (changed) await invalidateSummaries(tx, namespace, false, true);
    await done;
    if (changed) this.routingChanged(["committed-thread-rejection"]);
    return changed;
  }
  async threadRelationVersions(namespace: string, keys: string[]) {
    const tx = this.transaction("thread_relations", "readonly"),
      done = completed(tx);
    const result: Record<string, number> = {};
    for (const key of keys.slice(0, 100)) {
      const row = await request(
        tx.objectStore("thread_relations").get(`${namespace}:${key}`),
      );
      result[key] = row?.conflictVersion ?? 0;
    }
    await done;
    return result;
  }
  async threadAnswer(namespace: string, threadKey: string, attemptKey: string) {
    if (!/^[a-f0-9]{64}$/.test(threadKey) || !/^[a-f0-9]{64}$/.test(attemptKey))
      throw new Error("payload_rejected");
    const tx = this.transaction(
      [
        "history_records",
        "deletion_markers",
        "attempts",
        "requests",
        "thread_relations",
      ],
      "readonly",
    );
    const done = completed(tx);
    let found = false;
    const saved: HistoryRow[] = await request(
      tx
        .objectStore("history_records")
        .index("liveAttempt")
        .getAll([namespace, attemptKey], 101),
    );
    for (const row of saved)
      if (
        !found &&
        row.status === "current" &&
        row.record.role === "response" &&
        row.record.site === "perplexity" &&
        row.record.conversation_key === threadKey &&
        !(await historyRowErased(tx, row))
      )
        found = true;
    if (!found) {
      const attempts: RecordRow[] = await request(
        tx
          .objectStore("attempts")
          .index("provider")
          .getAll([namespace, attemptKey], 101),
      );
      for (const row of attempts) {
        if (found || row.aliasOf || row.record.kind !== "attempt") continue;
        const parent: RecordRow | undefined = await request(
          tx
            .objectStore("requests")
            .get(recordKey(namespace, "request", row.record.request_id)),
        );
        const providerKey =
          parent?.record.kind === "request" &&
          parent.record.site === "perplexity"
            ? parent.record.provider_request_key
            : null;
        if (!providerKey) continue;
        const link: ThreadRelation | undefined = await request(
          tx.objectStore("thread_relations").get(`${namespace}:${providerKey}`),
        );
        if (link && !link.rejected && link.threadKey === threadKey)
          found = true;
      }
    }
    await done;
    return found;
  }
  async providerRecord(
    namespace: string,
    kind: Observation["kind"],
    key: string,
  ): Promise<RecordRow | undefined> {
    const tx = this.transaction(
      kind === "request" ? "requests" : "attempts",
      "readonly",
    );
    const done = completed(tx);
    const result = await request(
      tx
        .objectStore(kind === "request" ? "requests" : "attempts")
        .index("provider")
        .get([namespace, key]),
    );
    await done;
    return result;
  }
  async completedAttempt(namespace: string, key: string): Promise<boolean> {
    const tx = this.transaction("attempts", "readonly");
    const done = completed(tx);
    const rows = (await request(
      tx.objectStore("attempts").index("provider").getAll([namespace, key], 101),
    )) as RecordRow[];
    await done;
    return rows.some(
      (row) => row.record.kind === "attempt" && row.record.state === "completed",
    );
  }
  async coalesceProviderIdentity(
    namespace: string,
    kind: Observation["kind"],
    key: string,
  ): Promise<void> {
    const store = kind === "request" ? "requests" : "attempts";
    const tx = this.transaction(
      [store, "dashboard_cache", ...derivedStores, "thread_relations"],
      "readwrite",
    );
    const done = completed(tx);
    const rows = (await request(
      tx.objectStore(store).index("provider").getAll([namespace, key], 101),
    )) as RecordRow[];
    if (rows.length > 100) {
      tx.abort();
      await done.catch(() => {});
      throw new Error("conflicting_duplicate_identity");
    }
    rows.sort((a, b) => {
      const evidence = compareLiveEvidence(a.record, b.record);
      if (evidence !== 0) return evidence;
      const at =
        a.record.kind === "request"
          ? a.record.dispatched_at
          : a.record.started_at;
      const bt =
        b.record.kind === "request"
          ? b.record.dispatched_at
          : b.record.started_at;
      return at.localeCompare(bt) || a.key.localeCompare(b.key);
    });
    const groups = new Map<string, RecordRow[]>();
    for (const row of rows) {
      const parent: RecordRow | undefined =
        row.record.kind === "request"
          ? row
          : await request(
              tx
                .objectStore("requests")
                .get(recordKey(namespace, "request", row.record.request_id)),
            );
      if (!parent || parent.era !== row.era || parent.record.kind !== "request")
        continue;
      const groupKey = canonicalJson([
        row.era,
        parent.record.site,
        parent.record.conversation_key,
      ]);
      const group = groups.get(groupKey) ?? [];
      group.push(row);
      groups.set(groupKey, group);
    }
    for (const group of groups.values()) {
      const canonical = group[0]!;
      if (canonical.aliasOf) {
        const { aliasOf: _, ...selected } = canonical;
        tx.objectStore(store).put(selected);
      }
      for (const row of group.slice(1)) {
        if (kind === "request")
          await redirectThreadRelation(
            tx,
            namespace,
            recordId(row.record),
            recordId(canonical.record),
          );
        await invalidateDerived(tx, namespace, kind, recordId(row.record));
        tx.objectStore(store).put({
          ...row,
          aliasOf: recordId(canonical.record),
        });
      }
    }
    if (rows.length > 1) {
      await touchAliases(tx, namespace);
      await invalidateSummaries(tx, namespace);
    }
    await done;
  }
  async markAlias(
    namespace: string,
    kind: Observation["kind"],
    sourceId: string,
    canonicalId: string,
  ): Promise<void> {
    if (sourceId === canonicalId) return;
    const store = kind === "request" ? "requests" : "attempts";
    const tx = this.transaction(
      [store, "dashboard_cache", ...derivedStores, "thread_relations"],
      "readwrite",
    );
    const done = completed(tx);
    const source = await request(
      tx.objectStore(store).get(recordKey(namespace, kind, sourceId)),
    );
    const target = await request(
      tx.objectStore(store).get(recordKey(namespace, kind, canonicalId)),
    );
    if (!source || !target || source.era !== target.era) {
      tx.abort();
      await done.catch(() => {});
      throw new Error("ledger_integrity_failed");
    }
    await invalidateDerived(tx, namespace, kind, sourceId);
    if (kind === "request")
      await redirectThreadRelation(tx, namespace, sourceId, canonicalId);
    tx.objectStore(store).put({ ...source, aliasOf: canonicalId });
    await touchAliases(tx, namespace);
    await invalidateSummaries(tx, namespace);
    await done;
  }
  async scanIndex(
    store: "requests" | "attempts" | "thread_relations",
    index: "conversation" | "parent" | "thread",
    indexKey: string[],
    consume: (rows: RecordRow[]) => Promise<void> | void,
  ): Promise<void> {
    let after: string | null = null;
    for (;;) {
      const tx = this.transaction(store, "readonly");
      const done = completed(tx);
      const page: RecordRow[] = [];
      await new Promise<void>((resolve, reject) => {
        const r = tx
          .objectStore(store)
          .index(index)
          .openCursor(IDBKeyRange.only(indexKey));
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const c = r.result;
          if (!c || page.length >= 200) {
            resolve();
            return;
          }
          if (after !== null && String(c.primaryKey) <= after) {
            if (String(c.primaryKey) < after)
              c.continuePrimaryKey(indexKey, after);
            else c.continue();
            return;
          }
          page.push(c.value);
          c.continue();
        };
      });
      await done;
      if (!page.length) return;
      after = page.at(-1)!.key;
      await consume(page);
      if (page.length < 200) return;
    }
  }
  async cacheSummary(
    namespace: string,
    key: string,
    summary: unknown,
    version: number,
    selection?: { authorityScope: Scope; localSelectionToken: string },
  ): Promise<void> {
    const calculation = selection ? structuredClone(selection) : undefined;
    const tx = this.transaction(
      ["dashboard_cache", "deletion_markers"],
      "readwrite",
    );
    const done = completed(tx);
    const erasing = await hasPendingPurge(tx, namespace);
    if (erasing) {
      tx.abort();
      await done.catch(() => {});
      throw new Error("deletion_in_progress");
    }
    const epoch = await request(
      tx.objectStore("dashboard_cache").get(`epoch:${namespace}`),
    );
    if (
      (epoch?.version ?? 0) !== version ||
      (calculation &&
        (calculation.authorityScope.namespace !== namespace ||
          !(await localSelectionCurrent(
            tx,
            calculation.authorityScope,
            calculation.localSelectionToken,
          ))))
    ) {
      tx.abort();
      await done.catch(() => {});
      throw new Error("aggregate_inconsistent");
    }
    tx.objectStore("dashboard_cache").put({
      key,
      namespace,
      summary,
      summaryFormatVersion: 3,
      generatedAt: Date.now(),
      version,
      dirty: false,
      ...(calculation
        ? { calculationToken: calculation.localSelectionToken }
        : {}),
    });
    const cached = (
      await request(
        tx.objectStore("dashboard_cache").index("namespace").getAll(namespace),
      )
    ).filter((row) => row.key !== `epoch:${namespace}`);
    cached.sort((a, b) => (a.generatedAt ?? 0) - (b.generatedAt ?? 0));
    for (const row of cached.slice(0, Math.max(0, cached.length - 16)))
      if (row.key !== key) tx.objectStore("dashboard_cache").delete(row.key);
    await done;
  }
  async pendingErasure(namespace: string): Promise<boolean> {
    const tx = this.transaction("deletion_markers", "readonly"),
      done = completed(tx);
    const pending = await hasPendingPurge(tx, namespace);
    await done;
    return pending;
  }
  async queue(
    namespace: string,
    now = Date.now(),
    limit = 100,
  ): Promise<OutboxRow[]> {
    const tx = this.transaction("outbox", "readonly");
    const done = completed(tx);
    const rows = (await request(
      tx
        .objectStore("outbox")
        .index("eligible")
        .getAll(IDBKeyRange.bound([namespace, 0], [namespace, now]), 1000),
    )) as OutboxRow[];
    await done;
    return rows
      .filter(
        (r) => r.namespace === namespace && !r.quarantined && r.nextAt <= now,
      )
      .sort(
        (a, b) =>
          (a.kind === "request" ? 0 : 1) - (b.kind === "request" ? 0 : 1) ||
          a.createdAt - b.createdAt ||
          a.revision - b.revision,
      )
      .slice(0, limit);
  }
  async pending(namespace: string): Promise<OutboxRow[]> {
    return this.list<OutboxRow>("outbox", namespace, 1000);
  }
  /**
   * Revisions still to upload. A revision the server refused for good stays in the outbox,
   * quarantined, and is counted by `refusedCount` instead: counting it here kept a browser
   * "waiting to sync" forever (14 Oct 2026).
   */
  async pendingCount(namespace: string): Promise<number> {
    return (await this.outboxCounts(namespace)).pending;
  }
  /** Revisions the organization server refused, kept on this device and never resent. */
  async refusedCount(namespace: string): Promise<number> {
    return (await this.outboxCounts(namespace)).refused;
  }
  /**
   * Counted on the indexes, without loading the rows. A refusal reason is a non-empty reason
   * code, so the strings of the "refused" index are exactly the rows with a truthy
   * `quarantined` (arrays sort after every string, so `[namespace, []]` ends the range).
   */
  private async outboxCounts(namespace: string) {
    const tx = this.transaction("outbox", "readonly");
    const done = completed(tx);
    const store = tx.objectStore("outbox");
    const [total, refused] = await Promise.all([
      request(store.index("namespace").count(namespace)),
      request(
        store
          .index("refused")
          .count(IDBKeyRange.bound([namespace, ""], [namespace, []], false, true)),
      ),
    ]);
    await done;
    return { pending: total - refused, refused };
  }
  async queuedRecord(row: OutboxRow): Promise<Observation> {
    const result = await this.get<RecordRow>("measurements", row.key);
    if (!result || result.hash !== row.hash)
      throw new Error("ledger_integrity_failed");
    return parseObservation(result.record);
  }
  async acknowledge(
    namespace: string,
    batchId: string,
    acks: Ack[],
    sent: OutboxRow[],
  ): Promise<void> {
    const allowed = new Map(
      sent.map((r) => [`${r.kind}:${r.id}:${r.revision}`, r]),
    );
    const tx = this.transaction(
      ["outbox", "sync_receipts", "health", "dashboard_cache"],
      "readwrite",
    );
    const done = completed(tx);
    let changed = false;
    for (const ack of acks) {
      const row = allowed.get(`${ack.kind}:${ack.id}:${ack.revision}`);
      if (
        !row ||
        row.namespace !== namespace ||
        (ack.payload_hash !== row.hash && ack.status !== "rejected")
      )
        continue;
      if (
        ["applied", "duplicate", "stored_pending_estimate"].includes(ack.status)
      ) {
        if (ack.server_record_version !== row.revision) continue;
        tx.objectStore("outbox").delete(row.key);
        changed = true;
        tx.objectStore("sync_receipts").put({
          key: row.key,
          batchId,
          status: ack.status,
          at: Date.now(),
          namespace,
        });
      } else {
        // Aliases, stale records and erasures require explicit reconciliation before local totals change.
        const reason =
          ack.status === "conflict"
            ? "revision_conflict"
            : ack.status === "rejected"
              ? "payload_rejected"
              : ack.status === "retention_expired"
                ? "retention_expired"
                : ack.status === "erased"
                  ? "record_erased"
                  : "aggregate_inconsistent";
        const validated = ReasonCodeSchema.safeParse(ack.reason);
        tx.objectStore("outbox").put({
          ...row,
          quarantined: validated.success ? validated.data : reason,
        });
        tx.objectStore("health").put({
          key: `${namespace}:${reason}`,
          namespace,
          code: reason,
          at: Date.now(),
        });
      }
    }
    if (changed) await invalidateSummaries(tx, namespace);
    await done;
  }
  async retry(
    rows: OutboxRow[],
    retryAfterMs = 0,
    random = Math.random,
  ): Promise<void> {
    const tx = this.transaction("outbox", "readwrite");
    const done = completed(tx);
    for (const row of rows) {
      const current = await request(tx.objectStore("outbox").get(row.key));
      if (!current) continue;
      const attempts = current.attempts + 1;
      const delay = Math.max(
        retryAfterMs,
        random() * Math.min(1_800_000, 1000 * 2 ** Math.min(attempts, 20)),
      );
      tx.objectStore("outbox").put({
        ...current,
        attempts,
        nextAt: Date.now() + delay,
      });
    }
    await done;
  }
  async get<T>(
    store: (typeof STORES)[number],
    key: string,
  ): Promise<T | undefined> {
    const tx = this.transaction(store, "readonly");
    const done = completed(tx);
    const value = await request(tx.objectStore(store).get(key));
    await done;
    // Older local summary caches predate explicit file coverage or per-reply image
    // benchmark references and must be rebuilt.
    if (
      store === "dashboard_cache" &&
      value?.summary &&
      !value.server &&
      value.summaryFormatVersion !== 3
    )
      return undefined;
    return value;
  }
  async put(
    store: (typeof STORES)[number],
    value: { key: string; [key: string]: unknown },
  ): Promise<void> {
    if (derivedStores.includes(store as any))
      throw new Error("derived_write_requires_guard");
    if (
      store.startsWith("estimation_") ||
      [
        "engine_preferences",
        "requests",
        "attempts",
        "measurements",
        "history_records",
      ].includes(store)
    )
      throw new Error("typed_repository_required");
    if (
      store === "local_estimates" &&
      (value.estimate as any)?.schema_version === "3.0.0"
    )
      throw new Error("typed_repository_required");
    if (store === "policy") return this.policyTransaction([value]);
    const tx = this.transaction(store, "readwrite");
    const done = completed(tx);
    tx.objectStore(store).put(value);
    await done;
  }
  private async readRouting(tx: IDBTransaction) {
    const store = tx.objectStore("policy");
    const [credentials, personal, history] = await Promise.all([
      request(store.get("credentials")),
      request(store.get("personal")),
      request(store.get("ownership-history")),
    ]);
    return { credentials, personal, ownership: history?.eras?.at(-1) ?? null };
  }
  /** Read the ownership boundary atomically before/after an asynchronous permission check. */
  async routingSnapshot() {
    const tx = this.transaction("policy", "readonly");
    const done = completed(tx);
    const result = await this.readRouting(tx);
    await done;
    return result;
  }
  private derivedTransaction() {
    return this.transaction(
      [
        "requests",
        "attempts",
        "deletion_markers",
        "dashboard_cache",
        ...derivedStores,
      ],
      "readwrite",
    );
  }
  /** Cache values are reusable only with a current canonical source and the same erasure generation. */
  async readDerived<C, G>(
    namespace: string,
    keys: { contextKey?: string; guidanceKey?: string },
  ) {
    const tx = this.derivedTransaction(),
      done = completed(tx);
    const epoch = await request(
      tx.objectStore("dashboard_cache").get(`epoch:${namespace}`),
    );
    const erasureVersion: number = epoch?.erasureVersion ?? 0;
    const read = async <T>(
      store: (typeof derivedStores)[number],
      key?: string,
    ): Promise<DerivedEntry<T> | undefined> => {
      if (!key) return;
      const row = await request(tx.objectStore(store).get(key));
      if (!row) return;
      if (
        row.namespace === namespace &&
        row.value &&
        row.erasureVersion === erasureVersion &&
        (await derivedGuardCurrent(tx, namespace, {
          erasureVersion,
          dependencies: [row.source],
        }))
      )
        return row;
      if (row.namespace === namespace) tx.objectStore(store).delete(key);
    };
    const [context, guidance] = await Promise.all([
      read<C>("context_snapshots", keys.contextKey),
      read<G>("guidance_preferences", keys.guidanceKey),
    ]);
    await done;
    return { erasureVersion, context, guidance };
  }
  async writeDerived<C, G>(
    namespace: string,
    source: DerivedSource,
    guard: DerivedGuard,
    writes: {
      context?: { key: string; value: C };
      guidance?: { key: string; value: G };
    },
  ): Promise<boolean> {
    if (
      [writes.context, writes.guidance].some(
        (row) => row && !row.key.startsWith(namespace + ":"),
      )
    )
      return false;
    const tx = this.derivedTransaction(),
      done = completed(tx);
    const allowed =
      (await derivedGuardCurrent(tx, namespace, guard)) &&
      (await sourceCurrent(tx, namespace, source));
    const previous = writes.guidance
      ? await request(
          tx.objectStore("guidance_preferences").get(writes.guidance.key),
        )
      : undefined;
    let guidanceAllowed = allowed;
    if (guard.guidance)
      guidanceAllowed =
        allowed &&
        !!previous &&
        previous.namespace === namespace &&
        previous.actionToken === guard.guidance.actionToken &&
        (await sourceCurrent(tx, namespace, previous.source)) &&
        (await sourceFollows(tx, namespace, source, previous.source));
    else if (previous) guidanceAllowed = false;
    if (allowed)
      for (const [store, value] of [
        ["context_snapshots", writes.context],
        ["guidance_preferences", writes.guidance],
      ] as const) {
        if (value) {
          if (store === "guidance_preferences" && !guidanceAllowed) continue;
          const body = structuredClone(value.value) as any;
          if (
            store === "guidance_preferences" &&
            previous &&
            guard.guidance &&
            previous.actionRevision > guard.guidance.actionRevision
          ) {
            // User actions committed after the read win over a delayed calculation.
            body.state = {
              ...body.state,
              dismissed: previous.value.state.dismissed,
              snoozedUntil: previous.value.state.snoozedUntil,
            };
          }
          tx.objectStore(store).put({
            ...value,
            value: body,
            namespace,
            source,
            erasureVersion: guard.erasureVersion,
            actionToken:
              store === "guidance_preferences" && previous
                ? previous.actionToken
                : `${source.requestHash}.${source.attemptHash}`,
            actionRevision:
              store === "guidance_preferences" && previous
                ? previous.actionRevision
                : 0,
          });
        }
      }
    await done;
    return allowed && (!writes.guidance || guidanceAllowed);
  }
  async updateDerivedGuidance(
    namespace: string,
    actionKey: string,
    action: "dismiss" | "snooze",
    now = Date.now(),
  ): Promise<boolean> {
    const delimiter = actionKey.lastIndexOf("#");
    if (delimiter < 0) return false;
    const key = actionKey.slice(0, delimiter),
      token = actionKey.slice(delimiter + 1);
    const tx = this.derivedTransaction(),
      done = completed(tx);
    const store = tx.objectStore("guidance_preferences"),
      row = await request(store.get(key));
    const current =
      !!row &&
      row.namespace === namespace &&
      row.value &&
      (await derivedGuardCurrent(tx, namespace, {
        erasureVersion: row.erasureVersion,
        dependencies: [row.source],
      }));
    const allowed = current && row.actionToken === token;
    if (allowed)
      store.put({
        ...row,
        actionRevision: (row.actionRevision ?? 0) + 1,
        value: {
          ...row.value,
          state: {
            ...row.value.state,
            ...(action === "dismiss"
              ? { dismissed: true }
              : { snoozedUntil: now + 86400000 }),
          },
        },
      });
    else if (row && row.namespace === namespace && !current) store.delete(key);
    await done;
    return allowed;
  }
  /** Publication checks ownership, canonical revision and erasure state in one read transaction. */
  async publicationSnapshot(
    namespace: string,
    source?: DerivedSource,
    guidance?: { key: string; actionToken: string },
    thread?: { key: string; providerRequestKey: string },
    selection?: { authorityScope: Scope; localSelectionToken: string },
  ) {
    const tx = this.transaction(
      [
        "policy",
        "dashboard_cache",
        "deletion_markers",
        "requests",
        "attempts",
        "guidance_preferences",
        "thread_relations",
        ...estimationTransactionStores.filter(
          (name) =>
            ![
              "policy",
              "dashboard_cache",
              "deletion_markers",
              "requests",
              "attempts",
            ].includes(name),
        ),
      ],
      "readonly",
    );
    const done = completed(tx);
    const [
      routing,
      epoch,
      purging,
      erased,
      validSource,
      currentGuidance,
      relation,
      settings,
      calculationCurrent,
    ] = await Promise.all([
      this.readRouting(tx),
      request(tx.objectStore("dashboard_cache").get(`epoch:${namespace}`)),
      hasPendingPurge(tx, namespace),
      request(tx.objectStore("deletion_markers").get(namespace)),
      sourceCurrent(tx, namespace, source),
      guidance
        ? request(tx.objectStore("guidance_preferences").get(guidance.key))
        : undefined,
      thread
        ? request(
            tx
              .objectStore("thread_relations")
              .get(`${namespace}:${thread.providerRequestKey}`),
          )
        : undefined,
      request(tx.objectStore("policy").get("settings")),
      selection
        ? selection.authorityScope.namespace === namespace &&
          localSelectionCurrent(
            tx,
            selection.authorityScope,
            selection.localSelectionToken,
          )
        : true,
    ]);
    await done;
    return {
      ...routing,
      calculationCurrent,
      version: epoch?.version ?? 0,
      erasureVersion: epoch?.erasureVersion ?? 0,
      threadRejectionVersion: epoch?.threadRejectionVersion ?? 0,
      erasing: purging || !!erased,
      sourceCurrent: validSource && !purging && !erased,
      trackingPaused:
        !!settings?.paused &&
        !(
          routing.credentials?.namespace === namespace &&
          routing.credentials?.policy?.pause_mode === "disabled_by_company"
        ),
      threadCurrent:
        !!thread &&
        validSource &&
        !purging &&
        !erased &&
        relation?.namespace === namespace &&
        !relation.rejected &&
        relation.threadKey === thread.key &&
        relation.providerRequestKey === thread.providerRequestKey &&
        relation.requestId === source?.requestId,
      guidance:
        validSource &&
        !purging &&
        !erased &&
        currentGuidance?.namespace === namespace &&
        currentGuidance.actionToken === guidance?.actionToken &&
        currentGuidance.erasureVersion === (epoch?.erasureVersion ?? 0) &&
        canonicalJson(currentGuidance.source) === canonicalJson(source)
          ? currentGuidance
          : null,
    };
  }
  async commitMethodCatalog(
    namespace: string,
    value: { key: string; namespace: string; [key: string]: unknown },
    expected: {
      trust: string;
      erasureVersion: number;
      previousHash: string | null;
      ownershipStart: number | null;
    },
    validNow: () => boolean,
  ) {
    value = JSON.parse(canonicalJson(value));
    expected = { ...expected };
    if (
      value.key !== namespace ||
      value.namespace !== namespace ||
      new TextEncoder().encode(canonicalJson(value)).length > 8 * 1024 * 1024
    )
      throw new Error("method_update_invalid");
    const tx = this.transaction(
      ["policy", "method_catalogs", "deletion_markers", "dashboard_cache"],
      "readwrite",
    );
    const done = completed(tx);
    try {
      const routing = await this.readRouting(tx);
      const old = await request(
        tx.objectStore("method_catalogs").get(namespace),
      );
      if (
        methodTrustIdentity(routing) !== expected.trust ||
        (routing.ownership?.start ?? null) !== expected.ownershipStart ||
        routing.credentials?.namespace !== namespace ||
        (routing.credentials?.enrollment_state &&
          routing.credentials.enrollment_state !== "active") ||
        (old ? payloadHash(old) : null) !== expected.previousHash ||
        !(await derivedGuardCurrent(tx, namespace, {
          erasureVersion: expected.erasureVersion,
          dependencies: [],
        })) ||
        !validNow()
      )
        throw new Error("policy_unavailable");
      tx.objectStore("method_catalogs").put(value);
      await invalidateSummaries(tx, namespace);
      if (!validNow()) throw new Error("policy_unavailable");
      await done;
    } catch (error) {
      try {
        tx.abort();
      } catch {}
      await done.catch(() => {});
      throw error;
    }
  }
  async policyTransaction(
    put: Array<{ key: string; [key: string]: unknown }>,
    remove: string[] = [],
    expected?: { deviceId: string | null; refreshToken?: string },
  ): Promise<void> {
    const tx = this.transaction("policy", "readwrite");
    const done = completed(tx);
    const oldAuthority = await readLocalAuthority(tx);
    if (expected) {
      const current = await request(
        tx.objectStore("policy").get("credentials"),
      );
      if (
        (current?.device_id ?? null) !== expected.deviceId ||
        (expected.refreshToken !== undefined &&
          current?.refresh_token !== expected.refreshToken)
      ) {
        tx.abort();
        await done.catch(() => {});
        throw new Error("auth_reconnect_required");
      }
    }
    for (const value of put) tx.objectStore("policy").put(value);
    for (const key of remove) tx.objectStore("policy").delete(key);
    if (oldAuthority.fingerprint !== (await readLocalAuthority(tx)).fingerprint)
      await refreshHistoryAuthority(tx);
    await done;
    this.routingChanged([...put.map((value) => value.key), ...remove]);
  }
  async serverSnapshot(
    namespace: string,
    key: string,
    deviceId: string,
    deletionEpoch: number,
    value?: unknown,
    expectedErasureVersion?: number,
  ): Promise<any | null> {
    const tx = this.transaction(
      ["dashboard_cache", "policy", "deletion_markers"],
      "readwrite",
    );
    const done = completed(tx);
    const credentials = await request(
      tx.objectStore("policy").get("credentials"),
    );
    const erasing = await hasPendingPurge(tx, namespace);
    const localEpoch = await request(
      tx.objectStore("dashboard_cache").get(`epoch:${namespace}`),
    );
    if (
      credentials?.namespace !== namespace ||
      credentials.device_id !== deviceId ||
      credentials.policy.deletion_epoch !== deletionEpoch ||
      (credentials.enrollment_state &&
        credentials.enrollment_state !== "active") ||
      erasing ||
      (expectedErasureVersion !== undefined &&
        (localEpoch?.erasureVersion ?? 0) !== expectedErasureVersion)
    ) {
      await done;
      return null;
    }
    const store = tx.objectStore("dashboard_cache");
    if (value !== undefined) {
      store.put({
        key,
        namespace,
        summary: value,
        generatedAt: Date.now(),
        server: true,
        deletionEpoch,
      });
      const rows = (await request(store.index("namespace").getAll(namespace)))
        .filter((row) => row.server)
        .sort((a, b) => a.generatedAt - b.generatedAt);
      for (const row of rows.slice(0, Math.max(0, rows.length - 8)))
        store.delete(row.key);
    }
    const result = await request(store.get(key));
    await done;
    return result?.deletionEpoch === deletionEpoch ? result : null;
  }
  async claimMonthly(
    namespace: string,
    month: string,
    deviceId: string,
    deletionEpoch: number,
  ): Promise<boolean> {
    const tx = this.transaction(["policy", "deletion_markers"], "readwrite"),
      done = completed(tx);
    const store = tx.objectStore("policy"),
      credentials = await request(store.get("credentials"));
    const key = `monthly:${namespace}`;
    const previous = await request(store.get(key));
    const erasing = await hasPendingPurge(tx, namespace);
    const allowed =
      credentials?.namespace === namespace &&
      credentials.device_id === deviceId &&
      credentials.policy.deletion_epoch === deletionEpoch &&
      (!credentials.enrollment_state ||
        credentials.enrollment_state === "active") &&
      (!previous?.month || previous.month < month) &&
      !erasing;
    if (allowed) store.put({ key, namespace, month, claimedAt: Date.now() });
    await done;
    return allowed;
  }
  async claimPersonalMonthly(
    namespace: string,
    month: string,
  ): Promise<boolean> {
    const tx = this.transaction(["policy", "deletion_markers"], "readwrite"),
      done = completed(tx);
    const store = tx.objectStore("policy"),
      personal = await request(store.get("personal"));
    const key = `monthly:${namespace}`;
    const previous = await request(store.get(key));
    const erasing = await hasPendingPurge(tx, namespace);
    const allowed =
      personal?.namespace === namespace &&
      (!previous?.month || previous.month < month) &&
      !erasing;
    if (allowed) store.put({ key, namespace, month, claimedAt: Date.now() });
    await done;
    return allowed;
  }
  async list<T>(
    store: (typeof STORES)[number],
    namespace: string,
    limit = 1000,
  ): Promise<T[]> {
    const tx = this.transaction(store, "readonly");
    const done = completed(tx);
    const rows = await request(
      tx.objectStore(store).index("namespace").getAll(namespace, limit),
    );
    await done;
    return rows;
  }
  async currentEstimates<T>(namespace: string): Promise<T[]> {
    const tx = this.transaction("local_estimates", "readonly");
    const done = completed(tx);
    const rows = await request(
      tx
        .objectStore("local_estimates")
        .index("selection")
        .getAll([namespace, "current"], 10001),
    );
    await done;
    if (rows.length > 10000)
      throw new Error("Select a shorter recorded period.");
    return rows;
  }
  async recoverInterrupted(
    scope: Scope,
    before = Date.now() - INTERRUPTED_AFTER_MS,
  ): Promise<number> {
    const jobs = await this.list<any>(
      "provider_key_map",
      scope.namespace,
      1000,
    );
    let count = 0;
    for (const job of jobs) {
      if (
        !job.request ||
        !job.attempt ||
        job.request.ended_at !== null ||
        job.at > before
      )
        continue;
      const ended = new Date().toISOString();
      const requestRecord = {
        ...job.request,
        revision: job.request.revision + 1,
        state: "interrupted_unconfirmed",
        ended_at: ended,
      };
      const attemptRecord = {
        ...job.attempt,
        revision: job.attempt.revision + 1,
        state: "interrupted_unconfirmed",
        ended_at: ended,
        coverage_reasons: [
          ...new Set([
            ...job.attempt.coverage_reasons,
            "unknown_terminal_state",
          ]),
        ],
      };
      await this.commit(
        job.scope,
        [requestRecord, attemptRecord],
        [
          {
            store: "provider_key_map",
            value: { ...job, request: requestRecord, attempt: attemptRecord },
          },
        ],
      );
      count++;
    }
    return count;
  }
  async applyRange(
    scope: Scope,
    start: string | null,
    end: string | null,
    epoch: number,
    retention = false,
  ): Promise<number> {
    const proofRefresh = new Set<string>();
    const markerKey = `range:${scope.namespace}:${epoch}:${start ?? "all"}:${end ?? "all"}${retention ? ":retention" : ""}`;
    const existing = await this.get<{ status?: string }>(
      "deletion_markers",
      markerKey,
    );
    if (existing && existing.status !== "purging") return 0;
    const marking = this.transaction(
      ["deletion_markers", "dashboard_cache", "policy"],
      "readwrite",
    );
    const marked = completed(marking);
    marking
      .objectStore("policy")
      .delete(`thread-queue-cursor:${scope.namespace}`);
    marking.objectStore("deletion_markers").put({
      key: markerKey,
      namespace: scope.namespace,
      start,
      end,
      epoch,
      range: true,
      retention,
      status: "purging",
    });
    await invalidateSummaries(marking, scope.namespace, true);
    await marked;
    this.routingChanged(["committed-erasure"]);
    let count = 0;
    if (!retention) {
      let after: string | null = null;
      for (;;) {
        const rows = await this.history.erasurePage(scope, after);
        if (!rows.length) break;
        const tx = this.transaction(
          [
            "history_records",
            "history_outbox",
            "history_coverage",
            "deletion_markers",
          ],
          "readwrite",
        );
        const done = completed(tx);
        for (const row of rows)
          if (
            row.record.occurred_at === null ||
            ((!start ||
              compareHistoricalInstants(row.record.occurred_at, start) >= 0) &&
              (!end ||
                compareHistoricalInstants(row.record.occurred_at, end) < 0))
          ) {
            const dependentKeys = await request(
              tx
                .objectStore("estimation_inputs")
                .index("dependency")
                .getAllKeys(
                  `history:${scope.namespace}:${row.record.message_key}`,
                ),
            );
            for (const key of dependentKeys) proofRefresh.add(String(key));
            tx.objectStore("history_records").delete(row.key);
            await touchInput(
              tx,
              { ...scope, era: row.era },
              "history",
              row.record.message_key,
              true,
            );
            tx.objectStore("history_outbox").delete(row.key);
            tx.objectStore("history_coverage").delete(
              `${scope.namespace}:${row.record.conversation_key}`,
            );
            tx.objectStore("deletion_markers").put({
              key: row.key,
              namespace: scope.namespace,
              at: Date.now(),
            });
            count++;
          }
        await done;
        after = rows.at(-1)!.key;
      }
    }
    await this.scanRecords(scope.namespace, "request", async (rows) => {
      for (const row of rows)
        if (
          row.record.kind === "request" &&
          (!start || row.record.dispatched_at >= start) &&
          (!end || row.record.dispatched_at < end)
        )
          count += await this.eraseFamily(
            scope.namespace,
            row.record.request_id,
            false,
            retention,
          );
    });
    await this.put("deletion_markers", {
      key: markerKey,
      namespace: scope.namespace,
      start,
      end,
      epoch,
      range: true,
      retention,
      status: "complete",
    });
    // Recheck only surviving inputs whose history was removed while the purge blocked reads.
    const refreshKeys = [...proofRefresh];
    for (let offset = 0; offset < refreshKeys.length; offset += 100) {
      const tx = this.transaction(estimationTransactionStores, "readwrite"),
        done = completed(tx);
      for (const key of refreshKeys.slice(offset, offset + 100))
        await refreshOriginalEvidence(tx, key);
      await done;
    }
    this.routingChanged(["committed-erasure"]);
    return count;
  }
  commitHistory(
    ...args: Parameters<HistoryRepository["commitHistory"]>
  ): ReturnType<HistoryRepository["commitHistory"]> {
    return this.history.commitHistory(...args);
  }
  coworkCheckpoint(
    ...args: Parameters<HistoryRepository["coworkCheckpoint"]>
  ): ReturnType<HistoryRepository["coworkCheckpoint"]> {
    return this.history.coworkCheckpoint(...args);
  }
  liveReplyContents(
    ...args: Parameters<HistoryRepository["liveReplyContents"]>
  ): ReturnType<HistoryRepository["liveReplyContents"]> {
    return this.history.liveReplyContents(...args);
  }
  requeueHistory(
    ...args: Parameters<HistoryRepository["requeueHistory"]>
  ): ReturnType<HistoryRepository["requeueHistory"]> {
    return this.history.requeueHistory(...args);
  }
  historyPage(
    ...args: Parameters<HistoryRepository["historyPage"]>
  ): ReturnType<HistoryRepository["historyPage"]> {
    return this.history.historyPage(...args);
  }
  pendingHistory(
    ...args: Parameters<HistoryRepository["pendingHistory"]>
  ): ReturnType<HistoryRepository["pendingHistory"]> {
    return this.history.pendingHistory(...args);
  }
  acknowledgeHistory(
    ...args: Parameters<HistoryRepository["acknowledgeHistory"]>
  ): ReturnType<HistoryRepository["acknowledgeHistory"]> {
    return this.history.acknowledgeHistory(...args);
  }
  historyQueued(
    ...args: Parameters<HistoryRepository["historyQueued"]>
  ): ReturnType<HistoryRepository["historyQueued"]> {
    return this.history.historyQueued(...args);
  }
  pendingHistoryCoverage(
    ...args: Parameters<HistoryRepository["pendingHistoryCoverage"]>
  ): ReturnType<HistoryRepository["pendingHistoryCoverage"]> {
    return this.history.pendingHistoryCoverage(...args);
  }
  historyLiveOverlap(
    ...args: Parameters<HistoryRepository["historyLiveOverlap"]>
  ): ReturnType<HistoryRepository["historyLiveOverlap"]> {
    return this.history.historyLiveOverlap(...args);
  }
  findHistoryMessages(
    ...args: Parameters<HistoryRepository["findHistoryMessages"]>
  ): ReturnType<HistoryRepository["findHistoryMessages"]> {
    return this.history.findHistoryMessages(...args);
  }
  historyRowFlags(
    ...args: Parameters<HistoryRepository["historyRowFlags"]>
  ): ReturnType<HistoryRepository["historyRowFlags"]> {
    return this.history.historyRowFlags(...args);
  }
  async reconcile(
    namespace: string,
    canonical: Observation,
    expectedHash: string,
    aliasId?: string,
    sourceRevision?: number,
    estimate?: unknown,
  ): Promise<void> {
    const record = parseObservation(canonical);
    const hash = await digest(record);
    if (hash !== expectedHash) throw new Error("ledger_integrity_failed");
    const store = record.kind === "request" ? "requests" : "attempts";
    const tx = this.transaction(
      [
        store,
        "outbox",
        "measurements",
        "local_estimates",
        "provider_key_map",
        "dashboard_cache",
        ...derivedStores,
        "thread_relations",
      ],
      "readwrite",
    );
    const done = completed(tx);
    try {
      const key = recordKey(namespace, record.kind, recordId(record));
      const aliasRow: RecordRow | undefined = aliasId
        ? await request(
            tx
              .objectStore(store)
              .get(recordKey(namespace, record.kind, aliasId)),
          )
        : undefined;
      const current = (await request(tx.objectStore(store).get(key))) as
        RecordRow | undefined;
      if (
        record.kind === "attempt" &&
        (await request(
          tx
            .objectStore("deletion_markers")
            .get(attemptErasureKey(namespace, record.attempt_id)),
        ))
      )
        throw new Error("record_erased");
      const reconcileScope: Scope = {
        namespace,
        mode: namespace.startsWith("company:") ? "company" : "personal",
        era: current?.era ?? aliasRow?.era ?? null,
      };
      if (
        !(await writable(tx, reconcileScope)) ||
        (await request(
          tx
            .objectStore("deletion_markers")
            .get(`${namespace}:${record.request_id}`),
        ))
      )
        throw new Error("record_erased");
      if (current && aliasRow && current.era !== aliasRow.era)
        throw new Error("policy_unavailable");
      if (record.kind === "request") {
        let erased = false;
        await eachCursor(
          tx.objectStore("deletion_markers"),
          IDBKeyRange.bound(`range:${namespace}:`, `range:${namespace}:\uffff`),
          (marker) => {
            if (
              (!marker.start || record.dispatched_at >= marker.start) &&
              (!marker.end || record.dispatched_at < marker.end)
            )
              erased = true;
          },
        );
        if (erased) throw new Error("record_erased");
      }
      if (
        current?.record.revision === record.revision &&
        current.hash !== hash
      ) {
        tx.abort();
        await done.catch(() => {});
        throw new Error("revision_conflict");
      }
      const applyCanonical =
        !current || current.record.revision <= record.revision;
      if (applyCanonical) {
        if (current && current.hash !== hash)
          await invalidateDerived(tx, namespace, record.kind, recordId(record));
        await validateThreadIdentity(tx, namespace, record);
        tx.objectStore(store).put({
          key,
          namespace,
          era: current?.era ?? aliasRow?.era ?? null,
          record,
          hash,
          ...(current?.companyKey ? { companyKey: current.companyKey } : {}),
        });
      }
      tx.objectStore("measurements").put({
        key: `${key}:${record.revision}`,
        namespace,
        era: current?.era ?? aliasRow?.era ?? null,
        record,
        hash,
      });
      if (aliasId && aliasId !== recordId(record)) {
        const aliasKey = recordKey(namespace, record.kind, aliasId);
        const old = await request(tx.objectStore(store).get(aliasKey));
        if (old) {
          await invalidateDerived(tx, namespace, record.kind, aliasId);
          if (record.kind === "request")
            await redirectThreadRelation(
              tx,
              namespace,
              aliasId,
              recordId(record),
            );
          tx.objectStore(store).put({ ...old, aliasOf: recordId(record) });
        }
      }
      const queue = await request(
        tx.objectStore("outbox").index("namespace").getAll(namespace),
      );
      for (const row of queue)
        if (
          row.kind === record.kind &&
          ((row.id === aliasId &&
            row.revision <= (sourceRevision ?? record.revision)) ||
            (row.id === recordId(record) && row.revision <= record.revision))
        )
          tx.objectStore("outbox").delete(row.key);
      if (aliasId) await touchAliases(tx, namespace);
      else if (applyCanonical && current?.hash !== hash)
        await touchObservation(tx, reconcileScope, record);
      if (
        estimate &&
        record.kind === "attempt" &&
        (estimate as any).schema_version === "3.0.0"
      ) {
        await storeOriginal(tx, reconcileScope, estimate);
        const envelope = estimate as EstimationEnvelope;
        if (applyCanonical)
          tx.objectStore("local_estimates").put({
            key: `current:${namespace}:${record.attempt_id}`,
            namespace,
            selection: "current",
            estimate,
          });
        const originalKey = `${namespace}:${record.attempt_id}:${record.revision}:${envelope.requested_method.method_id}:original`;
        const previousOriginal = await request(
          tx.objectStore("local_estimates").get(originalKey),
        );
        if (
          previousOriginal &&
          canonicalJson(previousOriginal.estimate) !== canonicalJson(estimate)
        )
          throw new Error("revision_conflict");
        if (!previousOriginal)
          tx.objectStore("local_estimates").put({
            key: originalKey,
            namespace,
            estimate,
          });
      } else if (estimate && record.kind === "attempt") {
        if (applyCanonical)
          tx.objectStore("local_estimates").put({
            key: `current:${namespace}:${record.attempt_id}`,
            namespace,
            selection: "current",
            estimate,
          });
        tx.objectStore("local_estimates").put({
          key: `${namespace}:${record.attempt_id}:${record.revision}:${(estimate as any).method_id}:original`,
          namespace,
          estimate,
        });
      }
      await invalidateSummaries(tx, namespace);
      await done;
    } catch (error) {
      try {
        tx.abort();
      } catch {}
      await done.catch(() => {});
      throw error;
    }
  }
  async historyErased(scope: Scope, row: HistoryMessage): Promise<boolean> {
    const tx = this.transaction("deletion_markers", "readonly"),
      done = completed(tx);
    const erased = await historyMarkersErased(
      tx.objectStore("deletion_markers"),
      scope,
      row,
    );
    await done;
    return erased;
  }
  async eraseFamily(
    namespace: string,
    requestId: string,
    notify = true,
    retention = false,
  ): Promise<number> {
    const tx = this.transaction([...STORES], "readwrite");
    const done = completed(tx);
    try {
      const pendingHistoryKey = `history-cleanup:${namespace}:request:${requestId}`;
      const pendingHistory = await request(
        tx.objectStore("deletion_markers").get(pendingHistoryKey),
      );
      const preserveHistory = retention && !pendingHistory;
      const priorErasure = await request(
        tx.objectStore("deletion_markers").get(`${namespace}:${requestId}`),
      );
      tx.objectStore("policy").delete(`thread-queue-cursor:${namespace}`);
      let count = 0;
      const links = await request(
        tx
          .objectStore("thread_relations")
          .index("request")
          .getAllKeys([namespace, requestId]),
      );
      for (const key of links) {
        tx.objectStore("thread_relations").delete(key);
        count++;
      }
      const attempts = await request(
        tx
          .objectStore("attempts")
          .index("parent")
          .getAll([namespace, requestId]),
      );
      const erasedAttempts = new Map<string, string | null>(
        attempts.map((row) => [row.record.attempt_id, row.era]),
      );
      await eachCursor(
        tx.objectStore("deletion_markers"),
        IDBKeyRange.bound(
          `attempt-erased:${namespace}:`,
          `attempt-erased:${namespace}:\uffff`,
        ),
        (marker) => {
          if (
            marker.requestId === requestId &&
            typeof marker.attemptId === "string"
          )
            erasedAttempts.set(marker.attemptId, marker.era);
        },
      );
      await eachCursor(
        tx.objectStore("estimation_inputs").index("dependency"),
        IDBKeyRange.only(`${namespace}:${requestId}`),
        async (dependent) => {
          await touchInput(
            tx,
            {
              namespace,
              mode: namespace.startsWith("company:") ? "company" : "personal",
              era: dependent.era,
            },
            "live",
            dependent.id,
            true,
          );
          await eachCursor(
            tx.objectStore("local_estimates").index("envelopeAttempt"),
            IDBKeyRange.only([namespace, dependent.id]),
            (row) => {
              tx.objectStore("local_estimates").delete(row.key);
            },
          );
        },
      );
      const parent = await request(
        tx
          .objectStore("requests")
          .get(recordKey(namespace, "request", requestId)),
      );
      const erasedEra = parent ? parent.era : priorErasure?.era;
      const stableKeys: Array<["request" | "attempt", string]> = [
        ...(pendingHistory?.keys ?? []),
        ...(parent?.record.provider_request_key
          ? [
              ["request", parent.record.provider_request_key] as [
                "request",
                string,
              ],
            ]
          : []),
        ...attempts
          .filter((row) => row.record.provider_attempt_key)
          .map(
            (row) =>
              ["attempt", row.record.provider_attempt_key] as [
                "attempt",
                string,
              ],
          ),
      ];
      if (!preserveHistory)
        tx.objectStore("deletion_markers").put({
          key: pendingHistoryKey,
          namespace,
          era: erasedEra,
          keys: stableKeys,
        });
      if (!preserveHistory)
        for (const [kind, key] of stableKeys)
          tx.objectStore("deletion_markers").put({
            key: `history-live:${namespace}:${kind}:${key}`,
            namespace,
          });
      tx.objectStore("requests").delete(
        recordKey(namespace, "request", requestId),
      );
      count++;
      for (const attempt of attempts) {
        tx.objectStore("attempts").delete(attempt.key);
        tx.objectStore("deletion_markers").put({
          key: attemptErasureKey(namespace, attempt.record.attempt_id),
          namespace,
          attemptId: attempt.record.attempt_id,
          requestId,
          era: attempt.era,
          ...(attempt.aliasOf ? { canonicalAttemptId: attempt.aliasOf } : {}),
        });
        await touchInput(
          tx,
          {
            namespace,
            mode: namespace.startsWith("company:") ? "company" : "personal",
            era: attempt.era,
          },
          "live",
          attempt.record.attempt_id,
          true,
        );
        count++;
      }
      for (const store of ["measurements", "provider_key_map"] as const) {
        const rows = await request(
          tx.objectStore(store).index("parent").getAll([namespace, requestId]),
        );
        for (const row of rows) {
          tx.objectStore(store).delete(row.key);
          count++;
        }
      }
      for (const [kind, id] of [
        ["request", requestId],
        ...attempts.map((row) => ["attempt", row.record.attempt_id]),
      ] as Array<[Observation["kind"], string]>) {
        const prefix = recordKey(namespace, kind, id) + ":";
        for (const store of ["outbox", "sync_receipts"] as const) {
          const keys = await request(
            tx
              .objectStore(store)
              .getAllKeys(IDBKeyRange.bound(prefix, prefix + "\uffff")),
          );
          for (const key of keys) {
            tx.objectStore(store).delete(key);
            count++;
          }
        }
        if (kind === "attempt") {
          const rows = await request(
            tx
              .objectStore("local_estimates")
              .index("attempt")
              .getAll([namespace, id]),
          );
          const envelopes = await request(
            tx
              .objectStore("local_estimates")
              .index("envelopeAttempt")
              .getAll([namespace, id]),
          );
          for (const row of [...rows, ...envelopes]) {
            tx.objectStore("local_estimates").delete(row.key);
            count++;
          }
        }
      }
      for (const store of [
        "context_snapshots",
        "guidance_preferences",
      ] as const) {
        const keys = await request(
          tx.objectStore(store).index("namespace").getAllKeys(namespace),
        );
        for (const key of keys) {
          tx.objectStore(store).delete(key);
          count++;
        }
      }
      tx.objectStore("deletion_markers").put({
        key: `${namespace}:${requestId}`,
        namespace,
        requestId,
        ...(erasedEra !== undefined ? { era: erasedEra } : {}),
        at: Date.now(),
      });
      await invalidateSummaries(tx, namespace, true);
      await done;
      if (notify) this.routingChanged(["committed-erasure"]);
      // Aliased originals remain archived, so erase every stored request alias that resolves through this family.
      await this.scanRecords(namespace, "request", async (rows) => {
        for (const row of rows)
          if (
            row.aliasOf === requestId &&
            row.era === erasedEra &&
            row.record.kind === "request"
          )
            count += await this.eraseFamily(
              namespace,
              row.record.request_id,
              false,
              preserveHistory,
            );
      });
      const visitedAttempts = new Set<string>();
      for (const [attemptId, era] of erasedAttempts)
        count += await this.eraseAttemptAliases(
          namespace,
          attemptId,
          era,
          preserveHistory,
          visitedAttempts,
        );
      // Range purges publish their own start and completion boundaries.
      if (!preserveHistory) {
        count += await this.eraseHistoryLinks(namespace, stableKeys);
        await this.remove("deletion_markers", pendingHistoryKey);
        if (notify) this.routingChanged(["committed-erasure"]);
      }
      return count;
    } catch (error) {
      try {
        tx.abort();
      } catch {}
      await done.catch(() => {});
      throw error;
    }
  }
  private async eraseAttemptAliases(
    namespace: string,
    canonicalAttemptId: string,
    era: string | null,
    retention: boolean,
    visited: Set<string>,
  ): Promise<number> {
    if (visited.has(canonicalAttemptId)) return 0;
    visited.add(canonicalAttemptId);
    let count = 0;
    const pendingKey = `history-cleanup:${namespace}:attempt:${canonicalAttemptId}`;
    const pending = await this.get<{
      keys: Array<["request" | "attempt", string]>;
    }>("deletion_markers", pendingKey);
    if (pending) {
      count += await this.eraseHistoryLinks(namespace, pending.keys);
      await this.remove("deletion_markers", pendingKey);
    }
    const descendants = new Set<string>();
    await this.scanRecords(namespace, "attempt", async (rows) => {
      for (const row of rows) {
        if (
          row.record.kind !== "attempt" ||
          row.aliasOf !== canonicalAttemptId ||
          row.era !== era
        )
          continue;
        const tx = this.transaction([...STORES], "readwrite"),
          done = completed(tx);
        let stable: string | null = null;
        try {
          const current: RecordRow | undefined = await request(
            tx.objectStore("attempts").get(row.key),
          );
          if (
            !current ||
            current.record.kind !== "attempt" ||
            current.aliasOf !== canonicalAttemptId ||
            current.era !== era
          ) {
            await done;
            continue;
          }
          const id = current.record.attempt_id;
          descendants.add(id);
          stable = current.record.provider_attempt_key;
          if (!retention && stable)
            tx.objectStore("deletion_markers").put({
              key: `history-cleanup:${namespace}:attempt:${id}`,
              namespace,
              era,
              keys: [["attempt", stable]],
            });
          tx.objectStore("deletion_markers").put({
            key: attemptErasureKey(namespace, id),
            namespace,
            attemptId: id,
            requestId: current.record.request_id,
            canonicalAttemptId,
            era,
          });
          tx.objectStore("attempts").delete(current.key);
          count++;
          await touchInput(
            tx,
            {
              namespace,
              mode: namespace.startsWith("company:") ? "company" : "personal",
              era,
            },
            "live",
            id,
            true,
          );
          const prefix = `${namespace}:attempt:${id}:`;
          for (const name of [
            "measurements",
            "outbox",
            "sync_receipts",
          ] as const)
            await eachCursor(
              tx.objectStore(name),
              IDBKeyRange.bound(prefix, prefix + "\uffff"),
              (value) => {
                tx.objectStore(name).delete(value.key);
                count++;
              },
            );
          for (const index of ["attempt", "envelopeAttempt"])
            await eachCursor(
              tx.objectStore("local_estimates").index(index),
              IDBKeyRange.only([namespace, id]),
              (value) => {
                tx.objectStore("local_estimates").delete(value.key);
                count++;
              },
            );
          await eachCursor(
            tx.objectStore("provider_key_map").index("namespace"),
            IDBKeyRange.only(namespace),
            (value) => {
              if (value.attempt?.attempt_id === id) {
                tx.objectStore("provider_key_map").delete(value.key);
                count++;
              }
            },
          );
          for (const name of derivedStores)
            await eachCursor(
              tx.objectStore(name).index("basisAttempt"),
              IDBKeyRange.only([namespace, id]),
              (value) => {
                tx.objectStore(name).delete(value.key);
                count++;
              },
            );
          if (!retention && stable)
            tx.objectStore("deletion_markers").put({
              key: `history-live:${namespace}:attempt:${stable}`,
              namespace,
            });
          await invalidateSummaries(tx, namespace, true);
          await done;
        } catch (error) {
          try {
            tx.abort();
          } catch {}
          await done.catch(() => {});
          throw error;
        }
        if (!retention && stable) {
          count += await this.eraseHistoryLinks(namespace, [
            ["attempt", stable],
          ]);
          await this.remove(
            "deletion_markers",
            `history-cleanup:${namespace}:attempt:${row.record.attempt_id}`,
          );
        }
      }
    });
    // Tombstones retain reverse edges so retries finish an interrupted transitive cleanup.
    const tx = this.transaction("deletion_markers", "readonly"),
      done = completed(tx);
    await eachCursor(
      tx.objectStore("deletion_markers"),
      IDBKeyRange.bound(
        `attempt-erased:${namespace}:`,
        `attempt-erased:${namespace}:\uffff`,
      ),
      (marker) => {
        if (
          marker.canonicalAttemptId === canonicalAttemptId &&
          marker.era === era
        )
          descendants.add(marker.attemptId);
      },
    );
    await done;
    for (const id of descendants)
      count += await this.eraseAttemptAliases(
        namespace,
        id,
        era,
        retention,
        visited,
      );
    return count;
  }
  private async eraseHistoryLinks(
    namespace: string,
    stableKeys: Array<["request" | "attempt", string]>,
  ): Promise<number> {
    let count = 0;
    for (const [kind, stable] of stableKeys) {
      for (;;) {
        const cleanup = this.transaction(
            [
              "history_records",
              "history_outbox",
              "history_coverage",
              "deletion_markers",
            ],
            "readwrite",
          ),
          finished = completed(cleanup);
        const history = cleanup.objectStore("history_records");
        const rows = await request(
          history
            .index(kind === "request" ? "liveRequest" : "liveAttempt")
            .getAll([namespace, stable], 100),
        );
        for (const row of rows) {
          history.delete(row.key);
          await touchInput(
            cleanup,
            {
              namespace,
              mode: namespace.startsWith("company:") ? "company" : "personal",
              era: row.era,
            },
            "history",
            row.record.message_key,
            true,
          );
          cleanup.objectStore("history_outbox").delete(row.key);
          cleanup
            .objectStore("history_coverage")
            .delete(`${namespace}:${row.record.conversation_key}`);
          cleanup
            .objectStore("deletion_markers")
            .put({ key: row.key, namespace });
          count++;
        }
        await finished;
        if (rows.length < 100) break;
      }
    }
    return count;
  }
  async remove(store: (typeof STORES)[number], key: string): Promise<void> {
    if (
      store.startsWith("estimation_") ||
      [
        "engine_preferences",
        "requests",
        "attempts",
        "measurements",
        "history_records",
      ].includes(store)
    )
      throw new Error("typed_repository_required");
    if (store === "policy") return this.policyTransaction([], [key]);
    const tx = this.transaction(store, "readwrite");
    const done = completed(tx);
    tx.objectStore(store).delete(key);
    await done;
  }
  async all<T>(store: (typeof STORES)[number]): Promise<T[]> {
    const tx = this.transaction(store, "readonly");
    const done = completed(tx);
    const rows = await request(tx.objectStore(store).getAll());
    await done;
    return rows;
  }
  async health(namespace: string, code: ReasonCode): Promise<void> {
    ReasonCodeSchema.parse(code);
    let done: Promise<void> | undefined;
    try {
      const tx = this.transaction("health", "readwrite");
      done = completed(tx);
      const store = tx.objectStore("health"),
        key = `${namespace}:${code}`,
        previous = await request(store.get(key)),
        at = Date.now();
      store.put({
        key,
        namespace,
        code,
        at,
        firstAt: previous?.firstAt ?? previous?.at ?? at,
        lastAt: at,
        count: Math.min(
          Number.MAX_SAFE_INTEGER,
          (previous?.count ?? (previous ? 1 : 0)) + 1,
        ),
      });
      await done;
    } catch (error) {
      await done?.catch(() => {});
      for (const listener of this.healthFailureListeners) {
        try {
          listener(namespace, code, error);
        } catch {}
      }
      throw error;
    }
  }
  /** See HealthRepository.resolveHealth. */
  async resolveHealth(
    namespace: string,
    codes: readonly ReasonCode[],
  ): Promise<ReasonCode[]> {
    const unique = [...new Set(codes)].map((code) =>
      ReasonCodeSchema.parse(code),
    );
    for (const listener of this.healthResolvedListeners) {
      try {
        listener(namespace, unique);
      } catch {}
    }
    if (!unique.length) return [];
    // Successes are frequent and problems rare, so a read-only check comes first and the
    // store is written only when something is open.
    const read = this.transaction("health", "readonly");
    const checked = completed(read);
    const rows: (StoredHealth | undefined)[] = await Promise.all(
      unique.map((code) =>
        request(read.objectStore("health").get(`${namespace}:${code}`)),
      ),
    );
    await checked;
    const open = new Map<ReasonCode, number>();
    unique.forEach((code, index) => {
      const row = rows[index];
      if (row && !healthSolved(row)) open.set(code, row.lastAt ?? row.at);
    });
    if (!open.size) return [];
    const tx = this.transaction("health", "readwrite");
    const done = completed(tx);
    const store = tx.objectStore("health"),
      at = Date.now(),
      closed: ReasonCode[] = [];
    for (const [code, seen] of open) {
      const row = await request(store.get(`${namespace}:${code}`));
      // A failure written since the check came after this success, so it stays open.
      if (!row || healthSolved(row) || (row.lastAt ?? row.at) !== seen) continue;
      store.put({ ...row, resolvedAt: Math.max(at, seen) });
      closed.push(code);
    }
    await done;
    return closed;
  }
  async recordModelLabel(
    namespace: string,
    site: Site,
    label: string,
  ): Promise<void> {
    SiteSchema.parse(site);
    if (!MODEL_LABEL_PATTERN.test(label)) throw new Error("payload_rejected");
    const tx = this.transaction("model_labels", "readwrite");
    const done = completed(tx);
    const store = tx.objectStore("model_labels"),
      key = `${namespace}:${site}:${label}`,
      previous = await request(store.get(key)),
      at = Date.now();
    if (!previous) {
      const rows: { key: string; lastAt: number }[] = await request(
        store.index("namespace").getAll(namespace),
      );
      rows.sort((a, b) => a.lastAt - b.lastAt || a.key.localeCompare(b.key));
      for (const row of rows.slice(
        0,
        Math.max(0, rows.length - MODEL_LABEL_LIMIT + 1),
      ))
        store.delete(row.key);
    }
    store.put({
      key,
      namespace,
      site,
      label,
      firstAt: previous?.firstAt ?? at,
      lastAt: at,
      count: Math.min(Number.MAX_SAFE_INTEGER, (previous?.count ?? 0) + 1),
    });
    await done;
  }
  /** A full erase is a clean slate: nothing about the erased messages survives it. */
  async eraseNamespace(namespace: string): Promise<number> {
    const tx = this.transaction(["deletion_markers", "policy"], "readwrite");
    const done = completed(tx);
    let count = 0;
    tx.objectStore("deletion_markers").put({
      key: namespace,
      namespace,
      at: Date.now(),
    });
    // Earlier versions kept per-message re-import markers and a secret; remove any leftovers.
    await new Promise<void>((resolve, reject) => {
      const cursor = tx
        .objectStore("deletion_markers")
        .openCursor(
          IDBKeyRange.bound(
            "history-personal-erased:",
            "history-personal-erased:\uffff",
          ),
        );
      cursor.onerror = () => reject(cursor.error);
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (!entry) return resolve();
        entry.delete();
        entry.continue();
      };
    });
    tx.objectStore("policy").delete("history-erasure-secret");
    await done;
    this.routingChanged(["committed-erasure"]);
    for (const store of STORES) {
      if (store === "deletion_markers" || store === "schema_migrations")
        continue;
      for (;;) {
        const cleanup = this.transaction(
            [store, "deletion_markers"],
            "readwrite",
          ),
          finished = completed(cleanup);
        const rows = await request(
          cleanup.objectStore(store).index("namespace").getAll(namespace, 100),
        );
        for (const row of rows) {
          cleanup.objectStore(store).delete(row.key);
          count++;
        }
        await finished;
        if (rows.length < 100) break;
      }
    }
    this.routingChanged(["committed-erasure"]);
    return count;
  }
  /**
   * Flags every organization namespace marker (`company:<organization>:<person>`) left in
   * this browser so that a later connection the server confirms for that same membership
   * may remove it (owner decision of 20 Oct 2026). Only a full Personal erase calls this.
   * Range, request and attempt markers are never flagged, and a later erasure of the
   * namespace writes a fresh marker without the flag. Returns the flagged namespaces.
   */
  async flagOrganizationMarkers(): Promise<string[]> {
    const tx = this.transaction(["deletion_markers"], "readwrite");
    const done = completed(tx);
    const flagged: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const cursor = tx
        .objectStore("deletion_markers")
        .openCursor(IDBKeyRange.bound("company:", "company:￿"));
      cursor.onerror = () => reject(cursor.error);
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (!entry) return resolve();
        const marker = entry.value;
        // A namespace marker is keyed by the namespace itself; request markers of the
        // same namespace share the prefix but carry a longer key.
        if (marker?.key === marker?.namespace) {
          if (marker.releaseOnActiveMembership !== true)
            entry.update({ ...marker, releaseOnActiveMembership: true });
          flagged.push(marker.namespace);
        }
        entry.continue();
      };
    });
    await done;
    return flagged;
  }
  /**
   * Removes the namespace marker of `namespace` when, and only when, a full Personal erase
   * flagged it. The caller has just received credentials for this membership from the
   * server, which confirms it is active. The erased range, request and attempt markers of
   * the namespace stay, so erased records cannot return. Returns whether a marker went.
   */
  async releaseFlaggedMarker(namespace: string): Promise<boolean> {
    const tx = this.transaction(["deletion_markers"], "readwrite");
    const done = completed(tx);
    const marker = await request(
      tx.objectStore("deletion_markers").get(namespace),
    );
    const release =
      marker?.key === namespace &&
      marker?.namespace === namespace &&
      marker?.releaseOnActiveMembership === true;
    if (release) tx.objectStore("deletion_markers").delete(namespace);
    await done;
    if (release) this.routingChanged(["committed-erasure"]);
    return release;
  }
}
