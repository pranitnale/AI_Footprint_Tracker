import {
  canonicalJson,
  payloadHash,
  HistoryPageSchema,
  HistoryMessageSchema,
  HistoryResourcesSchema,
  historyNumericPayloadHash,
  refineHistory,
  mergeHistoryEvidence,
  mergeHistoryCoverage,
  compareHistoricalInstants,
  type HistoryMessage,
} from "@footprint/contracts";
import type {
  HistoryStorageRepository,
  LiveReplyContent,
} from "./repository-contracts";
import {
  historyCoverageChanged,
  checkedCountBases,
  checkedCompanyKeys,
  checkedCoworkCheckpoint,
  validCoworkAdvance,
  liveReplyContent,
  sortLiveReplyContents,
  recordKey,
  type Scope,
  type HistoryRow,
} from "./ledger-support";
import {
  MemoryKernel,
  type MemoryState,
  clone,
  checkedScope,
  limitOf,
  routing,
  historyAuthority,
  guardCurrent,
  invalidate,
  touch,
  touchHistoryLinks,
  matchingLiveInput,
  storeOriginal,
  scopedRead,
  rowScope,
  resolveRequest,
} from "./memory-core";

export function historyErased(
  s: MemoryState,
  scope: Scope,
  row: HistoryMessage,
): boolean {
  return (
    s.erasedNamespaces.has(scope.namespace) ||
    s.erasedHistory.has(`${scope.namespace}:history:${row.message_key}`) ||
    (!!row.provider_request_key &&
      s.erasedProvider.has(
        `${scope.namespace}:request:${row.provider_request_key}`,
      )) ||
    (!!row.provider_attempt_key &&
      s.erasedProvider.has(
        `${scope.namespace}:attempt:${row.provider_attempt_key}`,
      )) ||
    s.ranges.some(
      (r) =>
        r.scope.namespace === scope.namespace &&
        !r.retention &&
        (row.occurred_at === null ||
          ((!r.start ||
            compareHistoricalInstants(row.occurred_at, r.start) >= 0) &&
            (!r.end || compareHistoricalInstants(row.occurred_at, r.end) < 0))),
    )
  );
}
function uploadDevice(s: MemoryState, scope: Scope): string | null {
  const r = routing(s),
    c = r.credentials;
  return !s.erasedNamespaces.has(scope.namespace) &&
    scope.mode === "company" &&
    c?.namespace === scope.namespace &&
    c.enrollment_era?.id === scope.era &&
    r.ownership?.scope.namespace === scope.namespace &&
    r.ownership?.scope.era === scope.era &&
    (!c.enrollment_state || c.enrollment_state === "active") &&
    typeof c.device_id === "string"
    ? c.device_id
    : null;
}
function checkedRow(row: HistoryRow): HistoryRow {
  const record = HistoryMessageSchema.parse(row.record),
    original = HistoryMessageSchema.parse(row.original),
    estimate = HistoryResourcesSchema.parse(row.estimate),
    originalEstimate = HistoryResourcesSchema.parse(row.originalEstimate);
  if (
    row.hash !== historyNumericPayloadHash(record) ||
    row.key !== `${row.namespace}:history:${record.message_key}` ||
    original.message_key !== record.message_key ||
    !["current", "conflict"].includes(row.status) ||
    (row.serverConflict !== undefined &&
      (row.serverConflict !== true || row.status !== "conflict"))
  )
    throw new Error("ledger_integrity_failed");
  for (const [source, metrics] of [
    [record, estimate],
    [original, originalEstimate],
  ] as const)
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
  return { ...row, record, original, estimate, originalEstimate };
}
export function removeHistory(
  s: MemoryState,
  row: HistoryRow,
  tombstone = true,
) {
  s.histories.delete(row.key);
  touchHistoryLinks(s, rowScope(row), row.record);
  s.historyQueue.delete(row.key);
  touch(s, rowScope(row), "history", row.record.message_key, true);
  if (tombstone) {
    s.erasedHistory.add(row.key);
  }
}
function validMessageKey(id: unknown): id is string {
  return typeof id === "string" && id.length === 64 && /^[a-f0-9]{64}$/.test(id);
}
function storedHistory(s: MemoryState, scope: Scope, id: string) {
  const row = s.histories.get(`${scope.namespace}:history:${id}`);
  if (
    row &&
    (row.namespace !== scope.namespace || row.record.message_key !== id)
  )
    throw new Error("ledger_integrity_failed");
  return row ? checkedRow(row) : undefined;
}
export function createMemoryHistory(k: MemoryKernel): HistoryStorageRepository {
  return {
    findHistoryMessage: (scope, id) => {
      scope = clone(checkedScope(scope));
      if (!validMessageKey(id)) throw new Error("payload_rejected");
      return k.read((s) => storedHistory(s, scope, id));
    },
    findHistoryMessages: (scope, ids) => {
      scope = clone(checkedScope(scope));
      if (
        !Array.isArray(ids) ||
        ids.length > 100 ||
        !ids.every(validMessageKey)
      )
        throw new Error("payload_rejected");
      const keys = [...ids];
      return k.read((s) => keys.map((id) => storedHistory(s, scope, id)));
    },
    historyCoverage: (scope, id) =>
      k.read((s) => s.coverage.get(`${scope.namespace}:${id}`)),
    coworkCheckpoint: async (scope, conversationKey) => {
      scope = clone(checkedScope(scope));
      if (!validMessageKey(conversationKey)) throw new Error("payload_rejected");
      return k.read((s) => {
        const row = s.coworkCheckpoints.get(
          `${scope.namespace}:${conversationKey}`,
        );
        return row
          ? checkedCoworkCheckpoint(row, scope.namespace, conversationKey)
          : null;
      });
    },
    liveReplyContents: async (scope, conversationKey) => {
      scope = clone(checkedScope(scope));
      if (!validMessageKey(conversationKey)) throw new Error("payload_rejected");
      return k.read((s) => {
        const replies: LiveReplyContent[] = [];
        for (const job of s.checkpoints.values()) {
          if (job.namespace !== scope.namespace) continue;
          const request = s.records.get(
            recordKey(scope.namespace, "request", job.request.request_id),
          );
          const reply = liveReplyContent(job);
          if (
            !reply ||
            !request ||
            request.aliasOf ||
            request.record.kind !== "request" ||
            request.record.conversation_key !== conversationKey
          )
            continue;
          reply.linkedMessageKeys = [...s.histories.values()]
            .filter(
              (h) =>
                h.namespace === scope.namespace &&
                h.status === "current" &&
                h.record.role === "response" &&
                h.record.conversation_key === conversationKey &&
                h.record.provider_attempt_key === reply.attemptKey,
            )
            .map((h) => h.record.message_key);
          replies.push(clone(reply));
        }
        return sortLiveReplyContents(replies);
      });
    },
    commitHistory: (scope, input, expected, validNow) => {
      scope = clone(checkedScope(scope));
      const page = HistoryPageSchema.parse(input),
        guard = clone(expected);
      const bases = checkedCountBases(page, guard.countBases);
      const companyKeys = checkedCompanyKeys(page, guard.companyKeys);
      if (guard.cowork !== undefined && !validCoworkAdvance(guard.cowork))
        throw new Error("payload_rejected");
      if (
        new TextEncoder().encode(canonicalJson(page)).length > 262144 ||
        (guard.healthCodes?.length ?? 0) > 4 ||
        guard.healthCodes?.some(
          (c) =>
            ![
              "method_unsupported",
              "estimate_unavailable",
              "method_update_invalid",
              "historical_timing_conflict",
            ].includes(c),
        )
      )
        throw new Error("payload_rejected");
      return k.mutate(
        "commitHistory",
        (s) => {
          const r = routing(s);
          if (
            historyAuthority(s) !== guard.authority ||
            r.ownership?.scope.namespace !== scope.namespace ||
            r.ownership.scope.era !== scope.era ||
            (scope.mode === "company" && !r.credentials?.device_id) ||
            (s.session.settings?.paused &&
              !(
                scope.mode === "company" &&
                r.credentials?.policy?.pause_mode === "disabled_by_company"
              )) ||
            !guardCurrent(s, scope.namespace, {
              erasureVersion: guard.erasureVersion,
              dependencies: [],
            }) ||
            !validNow()
          )
            throw new Error("policy_unavailable");
          if (
            s.ranges.filter((v) => v.scope.namespace === scope.namespace)
              .length > 1000
          )
            throw new Error("policy_unavailable");
          if (guard.cowork) {
            const key = `${scope.namespace}:${page.conversation_key}`,
              stored = s.coworkCheckpoints.get(key),
              saved = stored
                ? checkedCoworkCheckpoint(
                    stored,
                    scope.namespace,
                    page.conversation_key,
                  )
                : null;
            if ((saved?.sequence ?? null) !== guard.cowork.base)
              throw new Error("cowork_checkpoint_stale");
            s.coworkCheckpoints.set(key, {
              key,
              namespace: scope.namespace,
              conversation: page.conversation_key,
              checkpoint: clone(guard.cowork.next),
              at: k.now(),
            });
          }
          let retained = 0,
            committed = 0;
          for (const record of page.messages) {
            const observed = Date.parse(record.observed_at);
            if (observed < r.ownership.start || observed > k.now() + 300000)
              throw new Error("policy_unavailable");
            if (historyErased(s, scope, record)) continue;
            retained++;
            const key = `${scope.namespace}:history:${record.message_key}`,
              old = s.histories.get(key);
            if (
              old &&
              (old.original.proposed_method_id !== record.proposed_method_id ||
                old.original.proposed_method_hash !==
                  record.proposed_method_hash)
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
            // A conflict this browser found is cleared when a later read matches the
            // saved record; one the company server reported stays (as in the IndexedDB
            // ledger).
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
              // A company key that arrives for an unchanged message is kept, and the
              // message is uploaded once more so the company counts it once (W11).
              const companyKey = old!.companyKey
                ? undefined
                : companyKeys[record.message_key];
              if (companyKey) updated.companyKey = companyKey;
              if (updated.countBasis !== old!.countBasis || companyKey)
                s.histories.set(key, updated);
              if (companyKey && scope.mode === "company") {
                const { countBasis: _local, ...queued } = updated;
                s.historyQueue.set(key, {
                  row: {
                    ...queued,
                    hash: historyNumericPayloadHash(updated.record),
                  },
                  era: scope.era,
                  deviceId: r.credentials!.device_id,
                });
              }
              continue;
            }
            const estimate = HistoryResourcesSchema.parse(
              guard.estimates[record.message_key],
            );
            if (
              estimate.some(
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
                mode === "conflict"
                  ? old!.hash
                  : historyNumericPayloadHash(record),
              status:
                mode === "conflict"
                  ? "conflict"
                  : recovered
                    ? "current"
                    : (old?.status ?? "current"),
              estimate: mode === "conflict" ? old!.estimate : estimate,
              originalEstimate: old?.originalEstimate ?? estimate,
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
            const companyKey =
              old?.companyKey ?? companyKeys[record.message_key];
            if (companyKey) row.companyKey = companyKey;
            s.histories.set(key, row);
            committed++;
            const sourceScope = rowScope(row);
            if (
              row.record.role === "response" &&
              (mode !== "duplicate" || recovered)
            ) {
              touch(s, sourceScope, "history", row.record.message_key);
              touchHistoryLinks(s, sourceScope, row.record);
              if (old) touchHistoryLinks(s, sourceScope, old.record);
            }
            if (mode !== "conflict" && guard.envelopes?.[record.message_key])
              storeOriginal(
                s,
                sourceScope,
                guard.envelopes[record.message_key],
              );
            if (scope.mode === "company") {
              const { countBasis: _local, ...queued } = row;
              s.historyQueue.set(key, {
                row: {
                  ...queued,
                  record,
                  hash: historyNumericPayloadHash(record),
                },
                era: scope.era,
                deviceId: r.credentials!.device_id,
              });
            }
          }
          if (committed)
            for (const code of new Set(guard.healthCodes ?? [])) {
              const key = `${scope.namespace}:${code}`,
                old = s.health.get(key),
                at = k.now();
              s.health.set(key, {
                namespace: scope.namespace,
                code,
                at,
                firstAt: old?.firstAt ?? old?.at ?? at,
                lastAt: at,
                count: Math.min(
                  Number.MAX_SAFE_INTEGER,
                  (old?.count ?? (old ? 1 : 0)) + 1,
                ),
              });
            }
          const coverageKey = `${scope.namespace}:${page.conversation_key}`,
            prior = s.coverage.get(coverageKey);
          let coverageChanged = false;
          // A non-final batch of a multi-batch import leaves existing coverage alone, so
          // readers keep one consistent selection until the final batch replaces it.
          if ((retained || prior) && !(guard.deferCoverage && prior)) {
            const next = {
              key: coverageKey,
              namespace: scope.namespace,
              era: scope.era,
              deviceId:
                scope.mode === "company" ? r.credentials!.device_id : null,
              pending: scope.mode === "company" ? 1 : 0,
              page: mergeHistoryCoverage(prior?.page ?? null, {
                ...page,
                messages: [],
              }),
            };
            coverageChanged = historyCoverageChanged(prior, next);
            // Unchanged coverage keeps its stored row, so its upload flag and any
            // in-flight receipt stay valid and a reopen sends nothing new.
            if (coverageChanged) s.coverage.set(coverageKey, next);
          }
          // Reopening a chat re-imports unchanged messages. Leaving the epoch alone keeps
          // concurrent totals reads and calculation guards from retrying for no change.
          if (committed || coverageChanged) invalidate(s, scope.namespace);
          if (!validNow()) throw new Error("policy_unavailable");
        },
        () => {
          if (!validNow()) throw new Error("policy_unavailable");
        },
      );
    },
    requeueHistory: async (scope, ids, expected, validNow) => {
      scope = clone(checkedScope(scope));
      if (
        !Array.isArray(ids) ||
        ids.length > 100 ||
        !ids.every(validMessageKey)
      )
        throw new Error("payload_rejected");
      if (scope.mode !== "company" || !ids.length) return 0;
      const keys = [...new Set(ids)],
        guard = clone(expected);
      return k.mutate(
        "requeueHistory",
        (s) => {
          const r = routing(s);
          if (
            historyAuthority(s) !== guard.authority ||
            r.ownership?.scope.namespace !== scope.namespace ||
            r.ownership.scope.era !== scope.era ||
            !r.credentials?.device_id ||
            (s.session.settings?.paused &&
              r.credentials?.policy?.pause_mode !== "disabled_by_company") ||
            !guardCurrent(s, scope.namespace, {
              erasureVersion: guard.erasureVersion,
              dependencies: [],
            }) ||
            !validNow()
          )
            throw new Error("policy_unavailable");
          let queued = 0;
          for (const id of keys) {
            const row = storedHistory(s, scope, id);
            if (
              !row ||
              (row.lastImportEra ?? row.era) === scope.era ||
              historyErased(s, scope, row.record)
            )
              continue;
            const next: HistoryRow = { ...row, lastImportEra: scope.era };
            s.histories.set(row.key, next);
            const { countBasis: _local, ...queuedRow } = next;
            s.historyQueue.set(row.key, {
              row: queuedRow,
              era: scope.era,
              deviceId: r.credentials!.device_id,
            });
            queued++;
          }
          return queued;
        },
        () => {
          if (!validNow()) throw new Error("policy_unavailable");
        },
      );
    },
    historyPage: (scope, conversation, after = null, limit = 100) => {
      checkedScope(scope);
      limitOf(limit);
      return k.read((s) =>
        [...s.histories.values()]
          .filter(
            (row) =>
              row.namespace === scope.namespace &&
              (!conversation || row.record.conversation_key === conversation) &&
              (!after || row.key > after) &&
              !historyErased(s, scope, row.record),
          )
          .sort((a, b) => a.key.localeCompare(b.key))
          .slice(0, limit)
          .map(checkedRow),
      );
    },
    pendingHistory: (scope) =>
      k.read((s) => {
        const device = uploadDevice(s, scope);
        if (!device) return [];
        return [...s.historyQueue.values()]
          .filter(
            (q) =>
              q.deviceId === device &&
              q.row.namespace === scope.namespace &&
              s.histories.has(q.row.key) &&
              !historyErased(s, scope, q.row.record),
          )
          .slice(0, 100)
          .map((q) => checkedRow(q.row));
      }),
    acknowledgeHistory: (scope, receipts, expected, validNow = () => true) => {
      scope = clone(scope);
      if (receipts.length > 100) throw new Error("payload_rejected");
      const values = clone(receipts),
        guard = clone(expected);
      return k.mutate(
        "acknowledgeHistory",
        (s) => {
          const device = uploadDevice(s, scope);
          if (
            !device ||
            !validNow() ||
            (guard &&
              (historyAuthority(s) !== guard.authority ||
                !guardCurrent(s, scope.namespace, {
                  erasureVersion: guard.erasureVersion,
                  dependencies: [],
                })))
          )
            throw new Error("policy_unavailable");
          for (const receipt of values) {
            const key = `${scope.namespace}:history:${receipt.message_key}`,
              row = s.histories.get(key),
              q = s.historyQueue.get(key);
            if (
              !row ||
              q?.deviceId !== device ||
              q.row.hash !== receipt.payload_hash
            )
              continue;
            if (receipt.status === "erased") removeHistory(s, row);
            else if (receipt.status === "conflict") {
              row.status = "conflict";
              row.serverConflict = true;
              touchHistoryLinks(s, rowScope(row), row.record);
              // Only a reply is estimated; a prompt input would only count as unavailable.
              if (row.record.role === "response")
                touch(s, rowScope(row), "history", row.record.message_key);
            } else if (row.serverConflict) {
              // As acknowledgeHistory in history-repository.ts: the server counts it again.
              row.status = "current";
              delete row.serverConflict;
              touchHistoryLinks(s, rowScope(row), row.record);
              if (row.record.role === "response")
                touch(s, rowScope(row), "history", row.record.message_key);
            }
            s.historyQueue.delete(key);
          }
          if (guard?.coverageKey) {
            const coverage = s.coverage.get(guard.coverageKey);
            if (
              coverage?.deviceId === device &&
              payloadHash(coverage.page) === guard.coverageHash
            )
              coverage.pending = 0;
          }
          invalidate(s, scope.namespace);
          if (!validNow()) throw new Error("policy_unavailable");
        },
        () => {
          if (!validNow()) throw new Error("policy_unavailable");
        },
      );
    },
    historyQueued: (scope, keys) => {
      if (keys.length > 100) throw new Error("payload_rejected");
      return k.read((s) => {
        const device = uploadDevice(s, scope);
        return new Set(
          device
            ? keys.filter((key) => {
                const q = s.historyQueue.get(key);
                return (
                  q?.row.namespace === scope.namespace && q.deviceId === device
                );
              })
            : [],
        );
      });
    },
    pendingHistoryCoverage: (scope) =>
      k.read((s) => {
        const device = uploadDevice(s, scope);
        return device
          ? [...s.coverage.values()]
              .filter(
                (r) =>
                  r.namespace === scope.namespace &&
                  r.deviceId === device &&
                  r.pending === 1,
              )
              .slice(0, 100)
              .map((r) => ({
                key: r.key,
                page: HistoryPageSchema.parse(r.page),
              }))
          : [];
      }),
    historyLiveOverlap: (scope, message) =>
      k.read((s) => matchingLiveInput(s, scope, message) !== null),
    historyErased: (scope, message) =>
      k.read((s) => historyErased(s, scope, message)),
    historyRowFlags: (scope, messages) => {
      if (!Array.isArray(messages) || messages.length > 100)
        throw new Error("payload_rejected");
      const rows = clone(messages);
      return k.read((s) =>
        rows.map((message) => {
          const erased = historyErased(s, scope, message);
          return {
            erased,
            overlap: !erased && matchingLiveInput(s, scope, message) !== null,
          };
        }),
      );
    },
  };
}
