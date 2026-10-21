import {
  touchInput,
  touchHistoryLinks,
  matchingLiveInput,
  estimationTransactionStores,
  storeOriginal,
  historyRowErased,
  checkedScope,
} from "./estimation-storage";
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
  mergeHistoryEvidence,
  mergeHistoryCoverage,
  compareHistoricalInstants,
  type HistoryMessage,
  type HistoryPage,
  type HistoryReceipt,
  HistorySummarySchema,
  HistoryResourcesSchema,
  type HistorySummary,
  type EstimationEnvelope,
  type HistoryCountBasis,
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
  historyCoverageChanged,
  checkedCountBases,
  checkedCompanyKeys,
  checkedCoworkCheckpoint,
  validCoworkAdvance,
  type CoworkAdvance,
  type CoworkCheckpoint,
  liveReplyContent,
  sortLiveReplyContents,
} from "./ledger-support";
import type {
  LiveReplyContent,
  TrackingCheckpoint,
} from "./repository-contracts";

/** Numeric history and its upload queue share the ledger transaction boundary. */
export class HistoryRepository {
  constructor(
    private readonly transaction: (
      stores: string | string[],
      mode: IDBTransactionMode,
    ) => IDBTransaction,
    private readonly readRouting: (tx: IDBTransaction) => Promise<any>,
  ) {}
  async commitHistory(
    scope: Scope,
    input: HistoryPage,
    expected: {
      authority: string;
      erasureVersion: number;
      estimates: Record<string, HistorySummary["resources"]>;
      envelopes?: Record<string, EstimationEnvelope>;
      healthCodes?: ReasonCode[];
      deferCoverage?: boolean;
      countBases?: Record<string, HistoryCountBasis>;
      companyKeys?: Record<string, string>;
      cowork?: CoworkAdvance;
    },
    validNow: () => boolean,
  ): Promise<void> {
    const page = HistoryPageSchema.parse(input);
    const bases = checkedCountBases(page, expected.countBases);
    const companyKeys = checkedCompanyKeys(page, expected.companyKeys);
    if (expected.cowork !== undefined && !validCoworkAdvance(expected.cowork))
      throw new Error("payload_rejected");
    const cowork = expected.cowork && structuredClone(expected.cowork);
    if (
      (expected.healthCodes?.length ?? 0) > 4 ||
      expected.healthCodes?.some(
        (code) =>
          ![
            "method_unsupported",
            "estimate_unavailable",
            "method_update_invalid",
            "historical_timing_conflict",
          ].includes(code),
      )
    )
      throw new Error("payload_rejected");
    if (new TextEncoder().encode(canonicalJson(page)).length > 262144)
      throw new Error("payload_rejected");
    const tx = this.transaction(
      [
        "policy",
        "history_records",
        "history_coverage",
        "history_outbox",
        "health",
        "deletion_markers",
        "dashboard_cache",
        ...(cowork ? ["cowork_checkpoints"] : []),
      ],
      "readwrite",
    );
    const done = completed(tx);
    try {
      const routing = await this.readRouting(tx);
      const settings = await request(tx.objectStore("policy").get("settings"));
      if (
        historyAuthority(routing) !== expected.authority ||
        routing.ownership?.scope?.namespace !== scope.namespace ||
        routing.ownership?.scope?.era !== scope.era ||
        (scope.mode === "company" && !routing.credentials?.device_id) ||
        (settings?.paused &&
          !(
            scope.mode === "company" &&
            routing.credentials?.policy?.pause_mode === "disabled_by_company"
          )) ||
        !(await derivedGuardCurrent(tx, scope.namespace, {
          erasureVersion: expected.erasureVersion,
          dependencies: [],
        })) ||
        !validNow()
      )
        throw new Error("policy_unavailable");
      const ranges = await request(
        tx
          .objectStore("deletion_markers")
          .getAll(
            IDBKeyRange.bound(
              `range:${scope.namespace}:`,
              `range:${scope.namespace}:\uffff`,
            ),
            1001,
          ),
      );
      if (ranges.length > 1000) throw new Error("policy_unavailable");
      if (cowork) {
        // Compare and set in the transaction of the replies it counts.
        const key = `${scope.namespace}:${page.conversation_key}`;
        const stored = await request(
          tx.objectStore("cowork_checkpoints").get(key),
        );
        const saved = stored
          ? checkedCoworkCheckpoint(stored, scope.namespace, page.conversation_key)
          : null;
        if ((saved?.sequence ?? null) !== cowork.base)
          throw new Error("cowork_checkpoint_stale");
        tx.objectStore("cowork_checkpoints").put({
          key,
          namespace: scope.namespace,
          conversation: page.conversation_key,
          checkpoint: cowork.next,
          at: Date.now(),
        });
      }
      let retained = 0;
      let committedRecords = 0;
      messages: for (const record of page.messages) {
        const observed = Date.parse(record.observed_at);
        if (
          observed < routing.ownership.start ||
          observed > Date.now() + 300000
        )
          throw new Error("policy_unavailable");
        const key = `${scope.namespace}:history:${record.message_key}`;
        for (const [kind, stable] of [
          ["request", record.provider_request_key],
          ["attempt", record.provider_attempt_key],
        ])
          if (
            stable &&
            (await request(
              tx
                .objectStore("deletion_markers")
                .get(`history-live:${scope.namespace}:${kind}:${stable}`),
            ))
          )
            continue messages;
        if (
          (await request(tx.objectStore("deletion_markers").get(key))) ||
          ranges.some(
            (marker) =>
              !marker.retention &&
              (record.occurred_at === null ||
                ((!marker.start ||
                  compareHistoricalInstants(record.occurred_at, marker.start) >=
                    0) &&
                  (!marker.end ||
                    compareHistoricalInstants(record.occurred_at, marker.end) <
                      0))),
          )
        )
          continue;
        retained++;
        const old = (await request(
          tx.objectStore("history_records").get(key),
        )) as HistoryRow | undefined;
        if (
          old &&
          (old.original.proposed_method_id !== record.proposed_method_id ||
            old.original.proposed_method_hash !== record.proposed_method_hash)
        )
          throw new Error("method_admission_conflict");
        const mode = old ? refineHistory(old.record, record) : "improved";
        if (
          old &&
          mode === "improved" &&
          historyNumericPayloadHash(
            mergeHistoryEvidence(old.record, record),
          ) !== historyNumericPayloadHash(record)
        )
          throw new Error("stale_estimation_result");
        // A conflict this browser found is cleared when a later read matches the saved
        // record: the read that disagreed was the exception (for example a count that
        // failed before 5 October 2026). A conflict the company server reported stays.
        const recovered =
          mode === "duplicate" &&
          old!.status === "conflict" &&
          !old!.serverConflict;
        if (
          mode === "duplicate" &&
          !recovered &&
          (old?.lastImportEra ?? old?.era) === scope.era
        ) {
          // Rows saved before count reuse gain their local basis without touching
          // the synced record, its hash or the summary version.
          const basis = bases[record.message_key];
          const updated: HistoryRow = { ...old! };
          if (
            basis &&
            old!.status === "current" &&
            canonicalJson(old!.countBasis ?? null) !== canonicalJson(basis)
          )
            updated.countBasis = basis;
          // A company key that arrives for an unchanged message is kept, and the message
          // is uploaded once more so the company counts it once (W11).
          const companyKey = old!.companyKey
            ? undefined
            : companyKeys[record.message_key];
          if (companyKey) updated.companyKey = companyKey;
          if (updated.countBasis !== old!.countBasis || companyKey)
            tx.objectStore("history_records").put(updated);
          if (companyKey && scope.mode === "company")
            tx.objectStore("history_outbox").put({
              key,
              namespace: scope.namespace,
              era: scope.era,
              deviceId: routing.credentials.device_id,
              hash: historyNumericPayloadHash(old!.record),
              record: old!.record,
              nextAt: 0,
            });
          continue;
        }
        const assessment = HistoryResourcesSchema.parse(
          expected.estimates[record.message_key],
        );
        if (
          assessment.some(
            (m) =>
              m.method_id !== record.proposed_method_id ||
              m.method_hash !== record.proposed_method_hash,
          )
        )
          throw new Error("method_update_invalid");
        const row: HistoryRow = {
          key,
          namespace: scope.namespace,
          era: old ? old.era : scope.era,
          lastImportEra: scope.era,
          record: mode === "conflict" ? old!.record : record,
          original: old?.original ?? record,
          hash:
            mode === "conflict" ? old!.hash : historyNumericPayloadHash(record),
          status:
            mode === "conflict"
              ? "conflict"
              : recovered
                ? "current"
                : (old?.status ?? "current"),
          estimate: mode === "conflict" ? old!.estimate : assessment,
          originalEstimate: old?.originalEstimate ?? assessment,
        };
        if (old?.serverConflict && row.status === "conflict")
          row.serverConflict = true;
        // The basis describes the saved record. A conflict keeps the older record,
        // and a changed record without a new basis must count again next time.
        const basis =
          mode === "conflict"
            ? old!.countBasis
            : (bases[record.message_key] ??
              (mode === "duplicate" ? old?.countBasis : undefined));
        if (basis) row.countBasis = basis;
        const companyKey = old?.companyKey ?? companyKeys[record.message_key];
        if (companyKey) row.companyKey = companyKey;
        tx.objectStore("history_records").put(row);
        committedRecords++;
        const sourceScope = { ...scope, era: row.era };
        if (
          row.record.role === "response" &&
          (mode !== "duplicate" || recovered)
        ) {
          await touchInput(tx, sourceScope, "history", row.record.message_key);
          await touchHistoryLinks(tx, sourceScope, row.record);
          if (old) await touchHistoryLinks(tx, sourceScope, old.record);
        }
        if (mode !== "conflict" && expected.envelopes?.[record.message_key])
          await storeOriginal(
            tx,
            sourceScope,
            expected.envelopes[record.message_key],
          );
        if (scope.mode === "company")
          tx.objectStore("history_outbox").put({
            key,
            namespace: scope.namespace,
            era: scope.era,
            deviceId: routing.credentials.device_id,
            hash: historyNumericPayloadHash(record),
            record,
            nextAt: 0,
          });
      }
      if (committedRecords)
        for (const code of new Set(expected.healthCodes ?? [])) {
          const key = `${scope.namespace}:${code}`,
            at = Date.now(),
            previous = await request(tx.objectStore("health").get(key));
          tx.objectStore("health").put({
            key,
            namespace: scope.namespace,
            code,
            at,
            firstAt: previous?.firstAt ?? previous?.at ?? at,
            lastAt: at,
            count: Math.min(
              Number.MAX_SAFE_INTEGER,
              (previous?.count ?? (previous ? 1 : 0)) + 1,
            ),
          });
        }
      const priorCoverage = await request(
        tx
          .objectStore("history_coverage")
          .get(`${scope.namespace}:${page.conversation_key}`),
      );
      let coverageChanged = false;
      // A non-final batch of a multi-batch import leaves existing coverage alone, so
      // readers keep one consistent selection until the final batch replaces it.
      if ((retained || priorCoverage) && !(expected.deferCoverage && priorCoverage)) {
        const coverage = {
          key: `${scope.namespace}:${page.conversation_key}`,
          namespace: scope.namespace,
          era: scope.era,
          deviceId:
            scope.mode === "company" ? routing.credentials.device_id : null,
          pending: scope.mode === "company" ? 1 : 0,
          page: mergeHistoryCoverage(priorCoverage?.page ?? null, {
            ...page,
            messages: [],
          }),
        };
        coverageChanged = historyCoverageChanged(priorCoverage, coverage);
        // Unchanged coverage keeps its stored row, so its upload flag and any
        // in-flight receipt stay valid and a reopen sends nothing new.
        if (coverageChanged) tx.objectStore("history_coverage").put(coverage);
      }
      if (!validNow()) throw new Error("policy_unavailable");
      // Reopening a chat re-imports unchanged messages. Leaving the epoch alone keeps
      // concurrent totals reads and calculation guards from retrying for no change.
      if (committedRecords || coverageChanged)
        await invalidateSummaries(tx, scope.namespace);
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
  historyPage(
    scope: Scope,
    conversation: string | undefined,
    after: string | null = null,
    limit = 100,
  ): Promise<HistoryRow[]> {
    return this.readPage(scope, conversation, after, limit, false);
  }
  async coworkCheckpoint(
    scope: Scope,
    conversationKey: string,
  ): Promise<CoworkCheckpoint | null> {
    if (typeof conversationKey !== "string" || !/^[a-f0-9]{64}$/.test(conversationKey))
      throw new Error("payload_rejected");
    const tx = this.transaction(["cowork_checkpoints"], "readonly"),
      done = completed(tx);
    const row = await request(
      tx
        .objectStore("cowork_checkpoints")
        .get(`${scope.namespace}:${conversationKey}`),
    );
    await done;
    return row
      ? checkedCoworkCheckpoint(row, scope.namespace, conversationKey)
      : null;
  }
  async liveReplyContents(
    scope: Scope,
    conversationKey: string,
  ): Promise<LiveReplyContent[]> {
    checkedScope(scope);
    if (typeof conversationKey !== "string" || !/^[a-f0-9]{64}$/.test(conversationKey))
      throw new Error("payload_rejected");
    const tx = this.transaction(
        ["requests", "provider_key_map", "history_records"],
        "readonly",
      ),
      done = completed(tx);
    const requests: RecordRow[] = await request(
      tx
        .objectStore("requests")
        .index("conversation")
        .getAll([scope.namespace, conversationKey]),
    );
    const replies: LiveReplyContent[] = [];
    for (const row of requests) {
      if (row.aliasOf || row.record.kind !== "request") continue;
      const jobs: TrackingCheckpoint[] = await request(
        tx
          .objectStore("provider_key_map")
          .index("parent")
          .getAll([scope.namespace, row.record.request_id]),
      );
      for (const job of jobs) {
        const reply = liveReplyContent(job);
        if (!reply) continue;
        const saved: HistoryRow[] = await request(
          tx
            .objectStore("history_records")
            .index("liveAttempt")
            .getAll([scope.namespace, reply.attemptKey]),
        );
        reply.linkedMessageKeys = saved
          .filter(
            (h) =>
              h.status === "current" &&
              h.record.role === "response" &&
              h.record.conversation_key === conversationKey,
          )
          .map((h) => h.record.message_key);
        replies.push(reply);
      }
    }
    await done;
    return sortLiveReplyContents(replies);
  }
  async requeueHistory(
    scope: Scope,
    messageKeys: string[],
    expected: { authority: string; erasureVersion: number },
    validNow: () => boolean,
  ): Promise<number> {
    if (
      !Array.isArray(messageKeys) ||
      messageKeys.length > 100 ||
      !messageKeys.every(
        (key) => typeof key === "string" && /^[a-f0-9]{64}$/.test(key),
      )
    )
      throw new Error("payload_rejected");
    if (scope.mode !== "company" || !messageKeys.length) return 0;
    const tx = this.transaction(
      [
        "policy",
        "history_records",
        "history_outbox",
        "deletion_markers",
        "dashboard_cache",
      ],
      "readwrite",
    );
    const done = completed(tx);
    try {
      const routing = await this.readRouting(tx);
      const settings = await request(tx.objectStore("policy").get("settings"));
      if (
        historyAuthority(routing) !== expected.authority ||
        routing.ownership?.scope?.namespace !== scope.namespace ||
        routing.ownership?.scope?.era !== scope.era ||
        !routing.credentials?.device_id ||
        (settings?.paused &&
          routing.credentials?.policy?.pause_mode !== "disabled_by_company") ||
        !(await derivedGuardCurrent(tx, scope.namespace, {
          erasureVersion: expected.erasureVersion,
          dependencies: [],
        })) ||
        !validNow()
      )
        throw new Error("policy_unavailable");
      let queued = 0;
      for (const messageKey of new Set(messageKeys)) {
        const key = `${scope.namespace}:history:${messageKey}`;
        const stored = await request(
          tx.objectStore("history_records").get(key),
        );
        if (!stored) continue;
        const row = checkedHistoryRow(stored);
        if (
          row.namespace !== scope.namespace ||
          (row.lastImportEra ?? row.era) === scope.era ||
          (await historyRowErased(tx, row))
        )
          continue;
        tx.objectStore("history_records").put({
          ...row,
          lastImportEra: scope.era,
        });
        tx.objectStore("history_outbox").put({
          key,
          namespace: scope.namespace,
          era: scope.era,
          deviceId: routing.credentials.device_id,
          hash: historyNumericPayloadHash(row.record),
          record: row.record,
          nextAt: 0,
        });
        queued++;
      }
      if (!validNow()) throw new Error("policy_unavailable");
      await done;
      return queued;
    } catch (error) {
      try {
        tx.abort();
      } catch {}
      await done.catch(() => {});
      throw error;
    }
  }
  /** Internal deletion scans must see rows already suppressed from ordinary readers. */
  erasurePage(
    scope: Scope,
    after: string | null = null,
    limit = 100,
  ): Promise<HistoryRow[]> {
    return this.readPage(scope, undefined, after, limit, true);
  }
  private async readPage(
    scope: Scope,
    conversation: string | undefined,
    after: string | null = null,
    limit = 100,
    includeErased = false,
  ): Promise<HistoryRow[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error("payload_rejected");
    const tx = this.transaction(
        ["history_records", "deletion_markers"],
        "readonly",
      ),
      done = completed(tx);
    if (!includeErased && (await hasPendingPurge(tx, scope.namespace))) {
      await done;
      return [];
    }
    const index = tx
      .objectStore("history_records")
      .index(conversation ? "conversation" : "namespace");
    const range = IDBKeyRange.only(
      conversation ? [scope.namespace, conversation] : scope.namespace,
    );
    const rows = await new Promise<HistoryRow[]>((resolve, reject) => {
      const result: HistoryRow[] = [];
      // Rows are collected up to the page size and their erasure markers are read
      // together; waiting for each row before moving the cursor made long chats slow.
      let batch: HistoryRow[] = [];
      const flush = async () => {
        const candidates = batch;
        batch = [];
        const erased = includeErased
          ? candidates.map(() => false)
          : await Promise.all(
              candidates.map((row) => historyRowErased(tx, row)),
            );
        candidates.forEach((row, index) => {
          if (!erased[index]) result.push(row);
        });
      };
      const cursor = index.openCursor(range);
      cursor.onerror = () => reject(cursor.error);
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (!entry) {
          flush().then(() => resolve(result), reject);
          return;
        }
        if (after && String(entry.primaryKey) < after) {
          entry.continuePrimaryKey(entry.key, after);
          return;
        }
        if (after && String(entry.primaryKey) === after) {
          entry.continue();
          return;
        }
        try {
          batch.push(checkedHistoryRow(entry.value));
        } catch (error) {
          reject(error);
          return;
        }
        if (result.length + batch.length < limit) {
          entry.continue();
          return;
        }
        flush().then(() => {
          if (result.length === limit) resolve(result);
          else entry.continue();
        }, reject);
      };
    });
    await done;
    return rows;
  }
  private async historyUploadDevice(
    tx: IDBTransaction,
    scope: Scope,
  ): Promise<string | null> {
    if (await hasPendingPurge(tx, scope.namespace)) return null;
    const routing = await this.readRouting(tx),
      c = routing.credentials;
    return scope.mode === "company" &&
      c?.namespace === scope.namespace &&
      c.enrollment_era?.id === scope.era &&
      routing.ownership?.scope.namespace === scope.namespace &&
      routing.ownership?.scope.era === scope.era &&
      !["revoked", "reconnect_needed"].includes(c.enrollment_state) &&
      typeof c.device_id === "string"
      ? c.device_id
      : null;
  }
  async pendingHistory(scope: Scope): Promise<HistoryRow[]> {
    const tx = this.transaction(
        ["policy", "history_outbox", "history_records", "deletion_markers"],
        "readonly",
      ),
      done = completed(tx);
    const device = await this.historyUploadDevice(tx, scope);
    if (!device) {
      await done;
      return [];
    }
    const queue = await request(
      tx
        .objectStore("history_outbox")
        .index("deviceEligible")
        .getAll(
          IDBKeyRange.bound(
            [scope.namespace, device, 0],
            [scope.namespace, device, Date.now()],
          ),
          100,
        ),
    );
    const rows: HistoryRow[] = [];
    for (const q of queue) {
      const row = await request(tx.objectStore("history_records").get(q.key));
      if (row && q.deviceId === device && !(await historyRowErased(tx, row)))
        rows.push({ ...row, record: q.record ?? row.record, hash: q.hash });
    }
    await done;
    return rows;
  }
  async acknowledgeHistory(
    scope: Scope,
    receipts: HistoryReceipt[],
    expected?: {
      authority: string;
      erasureVersion: number;
      coverageKey?: string;
      coverageHash?: string;
    },
    validNow: () => boolean = () => true,
  ) {
    if (receipts.length > 100) throw new Error("payload_rejected");
    const tx = this.transaction(
        [
          "policy",
          "history_outbox",
          "history_records",
          "history_coverage",
          "deletion_markers",
          "dashboard_cache",
        ],
        "readwrite",
      ),
      done = completed(tx);
    try {
      const device = await this.historyUploadDevice(tx, scope);
      if (
        !device ||
        !validNow() ||
        (expected &&
          (historyAuthority(await this.readRouting(tx)) !==
            expected.authority ||
            !(await derivedGuardCurrent(tx, scope.namespace, {
              erasureVersion: expected.erasureVersion,
              dependencies: [],
            }))))
      )
        throw new Error("policy_unavailable");
      for (const receipt of receipts) {
        const key = `${scope.namespace}:history:${receipt.message_key}`;
        const row = await request(tx.objectStore("history_records").get(key));
        const queued = await request(tx.objectStore("history_outbox").get(key));
        if (
          !row ||
          queued?.deviceId !== device ||
          queued.hash !== receipt.payload_hash
        )
          continue;
        if (receipt.status === "erased") {
          tx.objectStore("history_records").delete(key);
          await touchInput(
            tx,
            { ...scope, era: row.era },
            "history",
            row.record.message_key,
            true,
          );
          tx.objectStore("deletion_markers").put({
            key,
            namespace: scope.namespace,
            at: Date.now(),
          });
        } else if (receipt.status === "conflict") {
          tx.objectStore("history_records").put({
            ...row,
            status: "conflict",
            serverConflict: true,
          });
          // Only a reply is estimated; a prompt input would only count as unavailable.
          if (row.record.role === "response")
            await touchInput(
              tx,
              { ...scope, era: row.era },
              "history",
              row.record.message_key,
            );
        } else if (row.serverConflict) {
          // The server answers "conflict" while its copy stays one, so an accepted copy
          // means it counts the message again (since 15 October 2026), and so does this browser.
          const { serverConflict: _, ...released } = row;
          tx.objectStore("history_records").put({
            ...released,
            status: "current",
          });
          if (row.record.role === "response")
            await touchInput(
              tx,
              { ...scope, era: row.era },
              "history",
              row.record.message_key,
            );
        }
        if (
          receipt.status === "erased" ||
          receipt.status === "conflict" ||
          row.serverConflict
        )
          await touchHistoryLinks(tx, { ...scope, era: row.era }, row.record);
        tx.objectStore("history_outbox").delete(key);
      }
      if (expected?.coverageKey) {
        const coverage = await request(
          tx.objectStore("history_coverage").get(expected.coverageKey),
        );
        if (
          coverage?.deviceId === device &&
          payloadHash(coverage.page) === expected.coverageHash
        )
          tx.objectStore("history_coverage").put({ ...coverage, pending: 0 });
      }
      await invalidateSummaries(tx, scope.namespace);
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
  async historyQueued(scope: Scope, keys: string[]): Promise<Set<string>> {
    if (keys.length > 100) throw new Error("payload_rejected");
    const tx = this.transaction(
        ["policy", "history_outbox", "deletion_markers"],
        "readonly",
      ),
      done = completed(tx);
    const device = await this.historyUploadDevice(tx, scope);
    if (!device) {
      await done;
      return new Set();
    }
    const rows = await Promise.all(
      keys.map((key) => request(tx.objectStore("history_outbox").get(key))),
    );
    await done;
    return new Set(
      rows
        .filter(
          (row) =>
            row?.namespace === scope.namespace && row.deviceId === device,
        )
        .map((row) => row.key),
    );
  }
  async pendingHistoryCoverage(
    scope: Scope,
  ): Promise<Array<{ key: string; page: HistoryPage }>> {
    if (scope.mode !== "company") return [];
    const tx = this.transaction(
        ["policy", "history_coverage", "deletion_markers"],
        "readonly",
      ),
      done = completed(tx);
    const device = await this.historyUploadDevice(tx, scope);
    if (!device) {
      await done;
      return [];
    }
    const rows = await request(
      tx
        .objectStore("history_coverage")
        .index("devicePending")
        .getAll([scope.namespace, device, 1], 100),
    );
    await done;
    return rows.map((row) => ({
      key: row.key,
      page: HistoryPageSchema.parse(row.page),
    }));
  }
  async historyLiveOverlap(
    scope: Scope,
    row: HistoryMessage,
  ): Promise<boolean> {
    const tx = this.transaction(estimationTransactionStores, "readonly"),
      done = completed(tx);
    const match = await matchingLiveInput(tx, scope, row);
    await done;
    return match !== null;
  }
  async findHistoryMessages(
    scope: Scope,
    ids: string[],
  ): Promise<Array<HistoryRow | undefined>> {
    checkedScope(scope);
    if (
      !Array.isArray(ids) ||
      ids.length > 100 ||
      ids.some(
        (id) =>
          typeof id !== "string" || id.length !== 64 || !/^[a-f0-9]{64}$/.test(id),
      )
    )
      throw new Error("payload_rejected");
    if (!ids.length) return [];
    const tx = this.transaction("history_records", "readonly"),
      done = completed(tx),
      store = tx.objectStore("history_records");
    const rows: Array<HistoryRow | undefined> = await Promise.all(
      ids.map((id) => request(store.get(`${scope.namespace}:history:${id}`))),
    );
    await done;
    return rows.map((row, index) => {
      if (
        row &&
        (row.namespace !== scope.namespace ||
          row.record.message_key !== ids[index])
      )
        throw new Error("ledger_integrity_failed");
      return row ? checkedHistoryRow(row) : undefined;
    });
  }
  /** Same answers as `historyErased` plus `historyLiveOverlap`, in one read. */
  async historyRowFlags(
    scope: Scope,
    messages: HistoryMessage[],
  ): Promise<Array<{ erased: boolean; overlap: boolean }>> {
    if (!Array.isArray(messages) || messages.length > 100)
      throw new Error("payload_rejected");
    if (!messages.length) return [];
    const tx = this.transaction(estimationTransactionStores, "readonly"),
      done = completed(tx),
      markers = tx.objectStore("deletion_markers");
    // The rows are independent, so their reads are issued together in the one
    // transaction instead of waiting for each row in turn.
    try {
      const flags = await Promise.all(
        messages.map(async (message) => {
          const erased = await historyMarkersErased(markers, scope, message);
          return {
            erased,
            overlap:
              !erased && (await matchingLiveInput(tx, scope, message)) !== null,
          };
        }),
      );
      await done;
      return flags;
    } catch (error) {
      await done.catch(() => {});
      throw error;
    }
  }
}
