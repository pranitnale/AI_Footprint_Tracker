import { compareLiveEvidence } from "./live-history-link";
import {
  canonicalJson,
  payloadHash,
  parseObservation,
  EstimationEnvelopeSchema,
  OriginalEstimateResultSchema,
  ReasonCodeSchema,
  type Observation,
  type ReasonCode,
} from "@footprint/contracts";
import { INTERRUPTED_AFTER_MS } from "./repository-contracts";
import type {
  ApplicationRepository,
  CaptureCommit,
  StoredEstimate,
  RecordConsumer,
  PublicationSnapshot,
  CachedSummary,
  MonthlyViewClaimResult,
  RecordPeriod,
} from "./repository-contracts";
import type {
  Scope,
  RecordRow,
  DerivedEntry,
  DerivedSource,
  DerivedGuard,
} from "./ledger-support";
import { checkpointCompanyKey, checkpointContentKey } from "./ledger-support";
import {
  MemoryKernel,
  type MemoryOptions,
  type MemoryState,
  clone,
  same,
  recordId,
  recordKey,
  rowScope,
  checkedScope,
  limitOf,
  epoch,
  invalidate,
  routing,
  sourceCurrent,
  sourceFollows,
  guardCurrent,
  stateFor,
  inputKey,
  touch,
  touchObservation,
  storeOriginal,
  selectionCurrent,
  resolveRequest,
} from "./memory-core";
import { createMemoryEstimation } from "./memory-estimation";
import { createMemorySession } from "./memory-session";
import {
  createMemoryHistory,
  removeHistory,
  historyErased,
} from "./memory-history";

/** Whether a time is in a scan period, compared as strings like the summary filters. */
function inPeriod(at: string, period: RecordPeriod | undefined) {
  return (
    !period ||
    ((period.start === undefined || at >= period.start) &&
      (period.end === undefined || at < period.end))
  );
}
function checkedEstimate(value: unknown): StoredEstimate {
  const e = EstimationEnvelopeSchema.safeParse(value);
  if (e.success) return e.data;
  const original = OriginalEstimateResultSchema.safeParse(value);
  if (original.success) return original.data;
  throw new Error("ledger_integrity_failed");
}
function invalidateDerived(
  s: MemoryState,
  namespace: string,
  kind: Observation["kind"],
  id: string,
) {
  for (const store of [s.context, s.guidance])
    for (const [key, row] of store)
      if (
        row.namespace === namespace &&
        (kind === "request"
          ? row.source.requestId === id
          : row.source.attemptId === id)
      )
        store.delete(key);
}
function admission(
  s: MemoryState,
  scope: Scope,
  records: Observation[],
  now: number,
  checkpoint?: CaptureCommit["checkpoint"],
) {
  if (s.erasedNamespaces.has(scope.namespace)) throw new Error("record_erased");
  const parents = new Set(
    records.filter((r) => r.kind === "request").map((r) => r.request_id),
  );
  for (const record of records) {
    const key = recordKey(scope.namespace, record.kind, recordId(record)),
      hash = payloadHash(record);
    if (
      s.erasedRequests.has(`${scope.namespace}:${record.request_id}`) ||
      (record.kind === "attempt" &&
        s.erasedAttempts.has(`${scope.namespace}:${record.attempt_id}`))
    )
      throw new Error("record_erased");
    if (
      record.kind === "request" &&
      s.ranges.some(
        (r) =>
          r.scope.namespace === scope.namespace &&
          (!r.start || record.dispatched_at >= r.start) &&
          (!r.end || record.dispatched_at < r.end),
      )
    )
      throw new Error("record_erased");
    if (
      record.kind === "attempt" &&
      !parents.has(record.request_id) &&
      !s.records.has(recordKey(scope.namespace, "request", record.request_id))
    )
      throw new Error("dependency_missing");
    const old = s.records.get(key);
    if (old && old.era !== scope.era) throw new Error("policy_unavailable");
    if (old && old.record.revision > record.revision)
      throw new Error("revision_conflict");
    if (old?.record.revision === record.revision) {
      if (old.hash !== hash) throw new Error("revision_conflict");
      continue;
    }
    if (record.kind === "request") {
      for (const [relationKey, relation] of s.threads)
        if (
          relation.namespace === scope.namespace &&
          relation.requestId === record.request_id &&
          (record.site !== "perplexity" ||
            record.provider_request_key !== relation.providerRequestKey)
        )
          s.threads.delete(relationKey);
    }
    // A kept company key never changes: it names the prompt or reply itself (W11).
    const companyKey =
      old?.companyKey ?? checkpointCompanyKey(checkpoint, record);
    const row: RecordRow = {
      key,
      namespace: scope.namespace,
      era: scope.era,
      record,
      hash,
      ...(old?.aliasOf ? { aliasOf: old.aliasOf } : {}),
      ...(companyKey ? { companyKey } : {}),
    };
    if (old)
      invalidateDerived(s, scope.namespace, record.kind, recordId(record));
    s.records.set(key, row);
    touchObservation(s, scope, record);
    const revisionKey = `${key}:${record.revision}`;
    s.measurements.set(revisionKey, { ...row, key: revisionKey });
    if (scope.mode === "company")
      s.outbox.set(revisionKey, {
        key: revisionKey,
        namespace: scope.namespace,
        kind: record.kind,
        id: recordId(record),
        revision: record.revision,
        hash,
        createdAt: now,
        nextAt: 0,
        attempts: 0,
        quarantined: null,
        ...(companyKey ? { companyKey } : {}),
      });
  }
}
function commitCapture(s: MemoryState, command: CaptureCommit, now: number) {
  const scope = checkedScope(command.scope),
    records = command.observations.map(parseObservation),
    guard = command.guard;
  if (guard && !guardCurrent(s, scope.namespace, guard))
    throw new Error("derived_dependency_changed");
  const carriedGuidance = guard?.guidance
    ? clone(s.guidance.get(guard.guidance.key))
    : undefined;
  const fileDerived = new Map<string, DerivedEntry<unknown>>();
  if (guard?.requestFileMetadata) {
    const g = guard.requestFileMetadata,
      r = routing(s),
      record = records[0],
      old =
        record?.kind === "request"
          ? s.records.get(
              recordKey(scope.namespace, "request", record.request_id),
            )
          : undefined;
    if (
      records.length !== 1 ||
      record?.kind !== "request" ||
      !old ||
      old.aliasOf ||
      !r.ownership ||
      !g.validNow() ||
      !same(r.ownership.scope, scope) ||
      r.ownership.start !== g.ownershipStart ||
      r.ownership.end !== g.ownershipEnd ||
      (r.credentials?.device_id ?? null) !== g.deviceId ||
      (r.credentials?.enrollment_state ?? null) !== g.enrollmentState ||
      !same(guard.dependencies, [g.source]) ||
      old.hash !== g.source.requestHash ||
      (s.session.settings?.paused &&
        !(
          scope.mode === "company" &&
          r.credentials?.policy?.pause_mode === "disabled_by_company"
        )) ||
      command.originals?.length ||
      command.archivedEstimates?.length ||
      command.currentEstimate
    )
      throw new Error("derived_dependency_changed");
    if (
      old.record.kind !== "request" ||
      old.record.schema_version !== "3.0.0" ||
      record.schema_version !== "3.0.0" ||
      record.revision !== old.record.revision + 1
    )
      throw new Error("derived_dependency_changed");
    const strip = (value: typeof record) => ({
      ...value,
      revision: 0,
      documents: { ...value.documents, extracted_text: null },
      features: value.features.filter((f) => f !== "document"),
      coverage_reasons: value.coverage_reasons.filter(
        (r) => r !== "partial_capture",
      ),
    });
    if (
      (old.record.features.includes("document") &&
        !record.features.includes("document")) ||
      !same(strip(old.record), strip(record))
    )
      throw new Error("derived_dependency_changed");
    for (const [name, map] of [
      ["context", s.context],
      ["guidance", s.guidance],
    ] as const)
      for (const row of map.values())
        if (
          row.namespace === scope.namespace &&
          row.source.requestId === record.request_id &&
          row.erasureVersion === guard.erasureVersion &&
          sourceCurrent(s, scope.namespace, row.source)
        )
          fileDerived.set(`${name}:${row.key}`, clone(row));
  }
  if (command.checkpoint) {
    const c = command.checkpoint,
      r = parseObservation(c.request),
      a = parseObservation(c.attempt);
    if (
      c.namespace !== scope.namespace ||
      !same(c.scope, scope) ||
      r.kind !== "request" ||
      a.kind !== "attempt" ||
      a.request_id !== r.request_id ||
      typeof c.key !== "string" ||
      c.key.length < 1 ||
      c.key.length > 512
    )
      throw new Error("policy_unavailable");
    // Malformed company and content keys are rejected before anything is written.
    checkpointCompanyKey(c, r);
    checkpointContentKey(c);
  }
  admission(s, scope, records, now, command.checkpoint);
  if (guard?.requestFileMetadata && records[0])
    for (const [key, row] of fileDerived) {
      const map = key.startsWith("context:") ? s.context : s.guidance;
      map.set(row.key, {
        ...row,
        source: {
          ...row.source,
          requestRevision: records[0].revision,
          requestHash: payloadHash(records[0]),
        },
      });
    }
  if (
    carriedGuidance &&
    guard?.guidance &&
    guard.advanceGuidanceTo &&
    carriedGuidance.namespace === scope.namespace &&
    carriedGuidance.actionToken === guard.guidance.actionToken &&
    carriedGuidance.erasureVersion === guard.erasureVersion
  ) {
    const request = records.find(
      (r) =>
        r.kind === "request" &&
        r.request_id === guard.advanceGuidanceTo!.requestId,
    );
    const attempt = records.find(
      (r) =>
        r.kind === "attempt" &&
        r.attempt_id === guard.advanceGuidanceTo!.attemptId,
    );
    if (request && attempt) {
      const source = {
        requestId: guard.advanceGuidanceTo.requestId,
        attemptId: guard.advanceGuidanceTo.attemptId,
        requestRevision: request.revision,
        attemptRevision: attempt.revision,
        requestHash: payloadHash(request),
        attemptHash: payloadHash(attempt),
      };
      if (
        sourceCurrent(s, scope.namespace, source) &&
        sourceFollows(s, scope.namespace, source, carriedGuidance.source)
      )
        s.guidance.set(carriedGuidance.key, { ...carriedGuidance, source });
    }
  }
  if (command.checkpoint) {
    const checkpoint = command.checkpoint;
    const request = s.records.get(
      recordKey(scope.namespace, "request", checkpoint.request.request_id),
    );
    const attempt = s.records.get(
      recordKey(scope.namespace, "attempt", checkpoint.attempt.attempt_id),
    );
    if (
      !request ||
      !attempt ||
      request.era !== scope.era ||
      attempt.era !== scope.era ||
      request.hash !== payloadHash(checkpoint.request) ||
      attempt.hash !== payloadHash(checkpoint.attempt)
    )
      throw new Error("stale_estimation_result");
    s.checkpoints.set(checkpoint.key, clone(checkpoint));
  }
  for (const value of command.archivedEstimates ?? []) {
    const estimate = checkedEstimate(value);
    if (estimate.view !== "original") throw new Error("payload_rejected");
    if (estimate.schema_version === "3.0.0") {
      storeOriginal(s, scope, estimate);
      continue;
    }
    const key = `${scope.namespace}:${estimate.attempt_id}:${estimate.observation_revision}:${estimate.method_id}`;
    const old = s.legacyOriginals.get(key);
    if (old && !same(old, estimate)) throw new Error("revision_conflict");
    if (!old) s.legacyOriginals.set(key, estimate);
  }
  for (const original of command.originals ?? [])
    storeOriginal(s, scope, original);
  if (command.currentEstimate) {
    const { attemptId, estimate } = command.currentEstimate,
      key = `${scope.namespace}:${attemptId}`;
    const stored = s.records.get(
      recordKey(scope.namespace, "attempt", attemptId),
    );
    if (
      !stored ||
      stored.era !== scope.era ||
      payloadHash(stored.record) !== stored.hash
    )
      throw new Error("stale_estimation_result");
    if (estimate === null) s.estimates.set(key, null);
    else {
      const value = checkedEstimate(estimate);
      if (
        value.schema_version === "3.0.0"
          ? value.source.family !== "live" ||
            value.source.attempt_id !== attemptId
          : value.attempt_id !== attemptId
      )
        throw new Error("stale_estimation_result");
      const revision =
        value.schema_version === "3.0.0" && value.source.family === "live"
          ? value.source.attempt_revision
          : (value as ReturnType<typeof OriginalEstimateResultSchema.parse>)
              .observation_revision;
      const hash =
        value.schema_version === "3.0.0" && value.source.family === "live"
          ? value.source.attempt_hash
          : (value as ReturnType<typeof OriginalEstimateResultSchema.parse>)
              .observation_hash;
      if (stored.record.revision !== revision || stored.hash !== hash)
        throw new Error("stale_estimation_result");
      if ("schema_version" in value && value.schema_version === "3.0.0")
        storeOriginal(s, scope, value);
      s.estimates.set(key, value);
    }
  }
  invalidate(s, scope.namespace);
  if (guard?.requestFileMetadata && !guard.requestFileMetadata.validNow())
    throw new Error("derived_dependency_changed");
}
function eraseFamily(
  s: MemoryState,
  namespace: string,
  requestId: string,
  tombstone = true,
  retention = false,
): number {
  const root = s.records.get(recordKey(namespace, "request", requestId)),
    era = root?.era;
  const requests = new Set([requestId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of s.records.values())
      if (
        row.namespace === namespace &&
        row.record.kind === "request" &&
        (era === undefined || row.era === era) &&
        row.aliasOf &&
        requests.has(row.aliasOf) &&
        !requests.has(row.record.request_id)
      ) {
        requests.add(row.record.request_id);
        changed = true;
      }
  }
  const attempts = new Set<string>();
  for (const row of s.records.values())
    if (
      row.namespace === namespace &&
      row.record.kind === "attempt" &&
      requests.has(row.record.request_id)
    )
      attempts.add(row.record.attempt_id);
  changed = true;
  while (changed) {
    changed = false;
    for (const row of s.records.values())
      if (
        row.namespace === namespace &&
        row.record.kind === "attempt" &&
        (era === undefined || row.era === era) &&
        row.aliasOf &&
        attempts.has(row.aliasOf) &&
        !attempts.has(row.record.attempt_id)
      ) {
        attempts.add(row.record.attempt_id);
        changed = true;
      }
  }
  let count = 0;
  for (const [key, row] of s.records) {
    if (
      row.namespace !== namespace ||
      !(row.record.kind === "request"
        ? requests.has(row.record.request_id)
        : attempts.has(row.record.attempt_id))
    )
      continue;
    const stable =
      row.record.kind === "request"
        ? row.record.provider_request_key
        : row.record.provider_attempt_key;
    if (tombstone && stable && !retention)
      s.erasedProvider.add(`${namespace}:${row.record.kind}:${stable}`);
    s.records.delete(key);
    count++;
    if (row.record.kind === "attempt") {
      touch(s, rowScope(row), "live", row.record.attempt_id, true);
      s.estimates.delete(`${namespace}:${row.record.attempt_id}`);
      for (const key of s.legacyOriginals.keys())
        if (key.startsWith(`${namespace}:${row.record.attempt_id}:`))
          s.legacyOriginals.delete(key);
      if (tombstone)
        s.erasedAttempts.add(`${namespace}:${row.record.attempt_id}`);
    }
    invalidateDerived(s, namespace, row.record.kind, recordId(row.record));
  }
  if (tombstone)
    for (const id of requests) s.erasedRequests.add(`${namespace}:${id}`);
  for (const [key, row] of s.measurements)
    if (
      row.namespace === namespace &&
      (row.record.kind === "request"
        ? requests.has(row.record.request_id)
        : attempts.has(row.record.attempt_id))
    )
      s.measurements.delete(key);
  for (const [key, row] of s.outbox)
    if (
      row.namespace === namespace &&
      (row.kind === "request" ? requests.has(row.id) : attempts.has(row.id))
    )
      s.outbox.delete(key);
  for (const [key, row] of s.checkpoints)
    if (
      row.namespace === namespace &&
      (requests.has(row.request.request_id) ||
        attempts.has(row.attempt.attempt_id))
    )
      s.checkpoints.delete(key);
  for (const [key, row] of s.threads)
    if (row.namespace === namespace && requests.has(row.requestId))
      s.threads.delete(key);
  if (!retention)
    for (const row of s.histories.values())
      if (
        row.namespace === namespace &&
        historyErased(s, rowScope(row), row.record)
      ) {
        removeHistory(s, row, tombstone);
        count++;
      }
  invalidate(s, namespace, true);
  return count;
}
async function consumePages(rows: RecordRow[], consume: RecordConsumer) {
  for (let at = 0; at < rows.length; at += 100)
    await consume(rows.slice(at, at + 100));
}

/** A database-free backend using serialized domain transactions and isolated snapshots. */
export function createMemoryRepository(
  options: MemoryOptions = {},
): ApplicationRepository {
  const k = new MemoryKernel(options),
    session = createMemorySession(k),
    history = createMemoryHistory(k);
  const repository: ApplicationRepository = {
    ...session,
    ...history,
    estimation: createMemoryEstimation(k),
    capture: (scope, observations, originals) =>
      repository.commitCapture({ scope, observations, originals }),
    checkpoint: (id) => k.read((s) => s.checkpoints.get(id)),
    commitCapture: (command) => {
      const { guard, ...data } = command,
        copy = clone(data);
      const { requestFileMetadata, ...guardData } = guard ?? {};
      const capturedGuard = guard
        ? (clone(guardData) as DerivedGuard)
        : undefined;
      if (capturedGuard && requestFileMetadata) {
        const { validNow, ...fields } = requestFileMetadata;
        capturedGuard.requestFileMetadata = { ...clone(fields), validNow };
      }
      return k.mutate(
        "commitCapture",
        (s) => commitCapture(s, { ...copy, guard: capturedGuard }, k.now()),
        () => {
          if (
            capturedGuard?.requestFileMetadata &&
            !capturedGuard.requestFileMetadata.validNow()
          )
            throw new Error("derived_dependency_changed");
        },
      );
    },
    getRecord: (namespace, kind, id) =>
      k.read((s) => s.records.get(recordKey(namespace, kind, id))),
    scanRequests: async (namespace, consume, filter) => {
      filter = clone(filter);
      const rows = await k.read((s) =>
        [...s.records.values()]
          .filter(
            (r) =>
              r.namespace === namespace &&
              r.record.kind === "request" &&
              (filter?.threadKey ||
                filter?.conversationKey ||
                inPeriod(r.record.dispatched_at, filter?.between)) &&
              (filter?.threadKey ||
                !filter?.conversationKey ||
                r.record.conversation_key === filter.conversationKey) &&
              (!filter?.threadKey ||
                (!r.aliasOf &&
                  r.record.site === "perplexity" &&
                  [...s.threads.values()].some(
                    (t) =>
                      t.namespace === namespace &&
                      t.threadKey === filter.threadKey &&
                      t.requestId === r.record.request_id &&
                      r.record.kind === "request" &&
                      r.record.provider_request_key === t.providerRequestKey &&
                      !t.rejected,
                  ))),
          )
          .sort((a, b) => a.key.localeCompare(b.key)),
      );
      await consumePages(rows, consume);
    },
    scanAttempts: async (namespace, consume, filter) => {
      filter = clone(filter);
      const rows = await k.read((s) =>
        [...s.records.values()]
          .filter(
            (r) =>
              r.namespace === namespace &&
              r.record.kind === "attempt" &&
              (filter?.requestId
                ? r.record.request_id === filter.requestId
                : inPeriod(r.record.started_at, filter?.between)),
          )
          .sort((a, b) => a.key.localeCompare(b.key)),
      );
      await consumePages(rows, consume);
    },
    currentEstimate: (namespace, id) =>
      k.read((s) => s.estimates.get(`${namespace}:${id}`) ?? undefined),
    pendingRevision: (namespace, kind, id, revision) =>
      k.read((s) => {
        const row = s.outbox.get(`${recordKey(namespace, kind, id)}:${revision}`);
        return !!row && !row.quarantined;
      }),
    summaryVersion: (namespace) => k.read((s) => epoch(s, namespace)),
    readSummary: <T>(id: string) =>
      k.read((s) => s.summaries.get(id) as CachedSummary<T> | undefined),
    publicationSnapshot: <G>(
      namespace: string,
      source?: DerivedSource,
      guidance?: { key: string; actionToken: string },
      thread?: { key: string; providerRequestKey: string },
      selection?: { authorityScope: Scope; localSelectionToken: string },
    ) =>
      k.read((s) => {
        const r = routing(s),
          e = epoch(s, namespace),
          erasing = s.erasedNamespaces.has(namespace),
          valid = sourceCurrent(s, namespace, source),
          entry = guidance ? s.guidance.get(guidance.key) : undefined,
          relation = thread
            ? s.threads.get(`${namespace}:${thread.providerRequestKey}`)
            : undefined;
        return {
          ...r,
          ...e,
          erasing,
          sourceCurrent: valid && !erasing,
          calculationCurrent: selection
            ? selection.authorityScope.namespace === namespace &&
              selectionCurrent(
                s,
                selection.authorityScope,
                selection.localSelectionToken,
              )
            : true,
          trackingPaused:
            !!s.session.settings?.paused &&
            !(
              r.credentials?.namespace === namespace &&
              r.credentials?.policy?.pause_mode === "disabled_by_company"
            ),
          threadCurrent:
            !!thread &&
            valid &&
            !erasing &&
            relation?.namespace === namespace &&
            !relation.rejected &&
            relation.threadKey === thread.key &&
            relation.providerRequestKey === thread.providerRequestKey &&
            relation.requestId === source?.requestId,
          guidance:
            valid &&
            !erasing &&
            entry?.namespace === namespace &&
            entry.actionToken === guidance?.actionToken &&
            entry.erasureVersion === e.erasureVersion &&
            same(entry.source, source)
              ? entry
              : null,
        } as PublicationSnapshot<G>;
      }),
    cacheSummary: (namespace, id, summary, version, selection) => {
      selection = clone(selection);
      const value = clone(summary);
      return k.mutate("cacheSummary", (s) => {
        if (
          epoch(s, namespace).version !== version ||
          s.erasedNamespaces.has(namespace) ||
          (selection &&
            (selection.authorityScope.namespace !== namespace ||
              !selectionCurrent(
                s,
                selection.authorityScope,
                selection.localSelectionToken,
              )))
        )
          throw new Error("aggregate_inconsistent");
        s.summaries.set(id, {
          key: id,
          namespace,
          summary: value,
          version,
          generatedAt: k.now(),
          dirty: false,
          summaryFormatVersion: 3,
          ...(selection
            ? { calculationToken: selection.localSelectionToken }
            : {}),
        });
        const rows = [...s.summaries.values()]
          .filter((r) => r.namespace === namespace && !r.server)
          .sort((a, b) => a.generatedAt - b.generatedAt);
        for (const row of rows.slice(0, Math.max(0, rows.length - 16)))
          s.summaries.delete(row.key);
      });
    },
    serverSnapshot: <T>(
      namespace: string,
      id: string,
      deviceId: string,
      deletionEpoch: number,
      value?: T,
      expectedErasureVersion?: number,
    ) =>
      k.mutate("serverSnapshot", (s) => {
        const c = s.session.credentials;
        if (
          c?.namespace !== namespace ||
          c.device_id !== deviceId ||
          c.policy.deletion_epoch !== deletionEpoch ||
          (c.enrollment_state && c.enrollment_state !== "active") ||
          s.erasedNamespaces.has(namespace) ||
          (expectedErasureVersion !== undefined &&
            epoch(s, namespace).erasureVersion !== expectedErasureVersion)
        )
          return null;
        if (value !== undefined) {
          s.summaries.set(id, {
            key: id,
            namespace,
            summary: clone(value),
            generatedAt: k.now(),
            server: true,
            deletionEpoch,
          });
          const rows = [...s.summaries.values()]
            .filter((r) => r.namespace === namespace && r.server)
            .sort((a, b) => a.generatedAt - b.generatedAt);
          for (const row of rows.slice(0, Math.max(0, rows.length - 8)))
            s.summaries.delete(row.key);
        }
        const result = s.summaries.get(id);
        return result?.deletionEpoch === deletionEpoch
          ? (result as CachedSummary<T>)
          : null;
      }),
    lastClaimedMonth: (namespace) =>
      k.read((s) => s.monthly.get(namespace) ?? null),
    claimMonthlyView: (untrusted) => {
      const command = clone(untrusted);
      checkedScope(command.scope);
      if (
        !/^\d{4}-(0[1-9]|1[0-2])$/.test(command.month) ||
        command.month.length !== 7 ||
        typeof command.timezone !== "string" ||
        !command.timezone ||
        command.timezone.length > 128
      )
        throw new Error("payload_rejected");
      return k.mutate<MonthlyViewClaimResult>("claimMonthlyView", (s) => {
        const credentials = s.session.credentials,
          personal = s.session.personal,
          settings = s.session.settings;
        const sameScope = same(command.scope, command.selection.authorityScope);
        const validRouting =
          command.scope.mode === "company"
            ? !!command.company &&
              credentials?.namespace === command.scope.namespace &&
              credentials.device_id === command.company.deviceId &&
              credentials.enrollment_era?.id === command.scope.era &&
              credentials.policy?.deletion_epoch ===
                command.company.deletionEpoch &&
              credentials.policy?.timezone === command.timezone &&
              (!credentials.enrollment_state ||
                credentials.enrollment_state === "active")
            : command.company === null &&
              personal?.namespace === command.scope.namespace &&
              settings?.timezone === command.timezone;
        if (
          !sameScope ||
          !validRouting ||
          s.erasedNamespaces.has(command.scope.namespace) ||
          !selectionCurrent(
            s,
            command.scope,
            command.selection.localSelectionToken,
          )
        )
          return "stale";
        const previous = s.monthly.get(command.scope.namespace);
        if (previous && previous >= command.month) return "already_claimed";
        s.monthly.set(command.scope.namespace, command.month);
        (s.session.monthly ??= {})[command.scope.namespace] = {
          namespace: command.scope.namespace,
          month: command.month,
          claimedAt: k.now(),
        };
        return "claimed";
      });
    },
    pendingErasure: (_namespace) => Promise.resolve(false),
    readDerived: <C, G>(
      namespace: string,
      keys: { contextKey?: string; guidanceKey?: string },
    ) =>
      k.read((s) => {
        const read = <T>(map: Map<string, DerivedEntry<any>>, key?: string) => {
          const row = key ? map.get(key) : undefined;
          return row?.namespace === namespace &&
            row.value &&
            guardCurrent(s, namespace, {
              erasureVersion: row.erasureVersion,
              dependencies: [row.source],
            })
            ? (row as DerivedEntry<T>)
            : undefined;
        };
        return {
          erasureVersion: epoch(s, namespace).erasureVersion,
          context: read<C>(s.context, keys.contextKey),
          guidance: read<G>(s.guidance, keys.guidanceKey),
        };
      }),
    writeDerived: <C, G>(
      namespace: string,
      source: DerivedSource,
      guard: DerivedGuard,
      writes: {
        context?: { key: string; value: C };
        guidance?: { key: string; value: G };
      },
    ) => {
      const value = clone(writes);
      return k.mutate("writeDerived", (s) => {
        if (
          [value.context, value.guidance].some(
            (r) => r && !r.key.startsWith(namespace + ":"),
          )
        )
          return false;
        const valid =
            guardCurrent(s, namespace, guard) &&
            sourceCurrent(s, namespace, source),
          previous = value.guidance
            ? s.guidance.get(value.guidance.key)
            : undefined;
        const follows =
          !previous || sourceFollows(s, namespace, source, previous.source);
        const guidanceAllowed =
          valid &&
          (guard.guidance
            ? !!previous &&
              previous.actionToken === guard.guidance.actionToken &&
              sourceCurrent(s, namespace, previous.source) &&
              follows
            : !previous);
        if (valid)
          for (const [map, row, isGuidance] of [
            [s.context, value.context, false],
            [s.guidance, value.guidance, true],
          ] as const) {
            if (!row || (isGuidance && !guidanceAllowed)) continue;
            const body = clone(row.value) as any;
            if (
              isGuidance &&
              previous &&
              guard.guidance &&
              previous.actionRevision > guard.guidance.actionRevision
            )
              body.state = {
                ...body.state,
                dismissed: previous.value.state.dismissed,
                snoozedUntil: previous.value.state.snoozedUntil,
              };
            map.set(row.key, {
              key: row.key,
              namespace,
              source: clone(source),
              erasureVersion: guard.erasureVersion,
              value: body,
              actionToken:
                isGuidance && previous
                  ? previous.actionToken
                  : `${source.requestHash}.${source.attemptHash}`,
              actionRevision:
                isGuidance && previous ? previous.actionRevision : 0,
            });
          }
        return valid && (!value.guidance || guidanceAllowed);
      });
    },
    updateDerivedGuidance: (namespace, actionKey, action, now = k.now()) =>
      k.mutate("updateDerivedGuidance", (s) => {
        const at = actionKey.lastIndexOf("#");
        if (at < 0) return false;
        const key = actionKey.slice(0, at),
          token = actionKey.slice(at + 1),
          row = s.guidance.get(key);
        if (!row || row.namespace !== namespace) return false;
        const current = guardCurrent(s, namespace, {
          erasureVersion: row.erasureVersion,
          dependencies: [row.source],
        });
        if (!current) {
          s.guidance.delete(key);
          return false;
        }
        if (row.actionToken !== token) return false;
        row.actionRevision++;
        row.value = {
          ...row.value,
          state: {
            ...row.value.state,
            ...(action === "dismiss"
              ? { dismissed: true }
              : { snoozedUntil: now + 86400000 }),
          },
        };
        return true;
      }),
    queue: (namespace, now = k.now(), limit = 100) => {
      limitOf(limit, 1000);
      return k.read((s) =>
        s.erasedNamespaces.has(namespace)
          ? []
          : [...s.outbox.values()]
              .filter(
                (r) =>
                  r.namespace === namespace &&
                  !r.quarantined &&
                  r.nextAt <= now,
              )
              .sort((a, b) => a.nextAt - b.nextAt || a.key.localeCompare(b.key))
              .slice(0, 1000)
              .sort(
                (a, b) =>
                  (a.kind === "request" ? 0 : 1) -
                    (b.kind === "request" ? 0 : 1) ||
                  a.createdAt - b.createdAt ||
                  a.revision - b.revision,
              )
              .slice(0, limit),
      );
    },
    pending: (namespace) =>
      k.read((s) =>
        [...s.outbox.values()]
          .filter((r) => r.namespace === namespace)
          .sort((a, b) => a.key.localeCompare(b.key))
          .slice(0, 1000),
      ),
    pendingCount: (namespace) =>
      k.read(
        (s) =>
          [...s.outbox.values()].filter(
            (r) => r.namespace === namespace && !r.quarantined,
          ).length,
      ),
    refusedCount: (namespace) =>
      k.read(
        (s) =>
          [...s.outbox.values()].filter(
            (r) => r.namespace === namespace && r.quarantined,
          ).length,
      ),
    queuedRecord: (row) =>
      k.read((s) => {
        const value = s.measurements.get(row.key);
        if (
          !value ||
          value.hash !== row.hash ||
          payloadHash(value.record) !== row.hash
        )
          throw new Error("ledger_integrity_failed");
        return parseObservation(value.record);
      }),
    acknowledge: (namespace, batchId, acks, sent) => {
      const receipt = clone(acks),
        batch = clone(sent);
      return k.mutate("acknowledge", (s) => {
        const allowed = new Map(
          batch.map((r) => [`${r.kind}:${r.id}:${r.revision}`, r]),
        );
        let changed = false;
        for (const ack of receipt) {
          const row = allowed.get(`${ack.kind}:${ack.id}:${ack.revision}`),
            current = row ? s.outbox.get(row.key) : undefined;
          if (
            !row ||
            row.namespace !== namespace ||
            !current ||
            current.hash !== row.hash ||
            (ack.payload_hash !== row.hash && ack.status !== "rejected")
          )
            continue;
          if (
            ["applied", "duplicate", "stored_pending_estimate"].includes(
              ack.status,
            )
          ) {
            if (ack.server_record_version !== row.revision) continue;
            s.outbox.delete(row.key);
            s.receipts.set(row.key, {
              batchId,
              status: ack.status,
              at: k.now(),
              namespace,
            });
            changed = true;
          } else {
            const reason: ReasonCode =
              ack.status === "conflict"
                ? "revision_conflict"
                : ack.status === "rejected"
                  ? "payload_rejected"
                  : ack.status === "retention_expired"
                    ? "retention_expired"
                    : ack.status === "erased"
                      ? "record_erased"
                      : "aggregate_inconsistent";
            const parsed = ReasonCodeSchema.safeParse(ack.reason);
            current.quarantined = parsed.success ? parsed.data : reason;
            s.health.set(`${namespace}:${reason}`, {
              namespace,
              code: reason,
              at: k.now(),
            });
          }
        }
        if (changed) invalidate(s, namespace);
      });
    },
    retry: (rows, retryAfter = 0) => {
      const values = clone(rows);
      return k.mutate("retry", (s) => {
        for (const row of values) {
          const current = s.outbox.get(row.key);
          if (!current || current.hash !== row.hash) continue;
          current.attempts++;
          current.nextAt =
            k.now() +
            Math.max(
              retryAfter,
              Math.min(1800000, 1000 * 2 ** Math.min(current.attempts, 20)),
            );
        }
      });
    },
    reconcile: (
      namespace,
      untrusted,
      expectedHash,
      aliasId,
      sourceRevision,
      estimate,
    ) => {
      const record = parseObservation(untrusted),
        hash = payloadHash(record);
      if (hash !== expectedHash) throw new Error("ledger_integrity_failed");
      return k.mutate("reconcile", (s) => {
        const id = recordId(record),
          key = recordKey(namespace, record.kind, id),
          old = s.records.get(key),
          alias = aliasId
            ? s.records.get(recordKey(namespace, record.kind, aliasId))
            : undefined,
          scope: Scope = {
            namespace,
            mode: namespace.startsWith("company:") ? "company" : "personal",
            era: old?.era ?? alias?.era ?? null,
          };
        if (
          s.erasedNamespaces.has(namespace) ||
          s.erasedRequests.has(`${namespace}:${record.request_id}`) ||
          (record.kind === "attempt" &&
            s.erasedAttempts.has(`${namespace}:${record.attempt_id}`))
        )
          throw new Error("record_erased");
        if (old && alias && old.era !== alias.era)
          throw new Error("policy_unavailable");
        if (
          record.kind === "request" &&
          s.ranges.some(
            (r) =>
              r.scope.namespace === namespace &&
              (!r.start || record.dispatched_at >= r.start) &&
              (!r.end || record.dispatched_at < r.end),
          )
        )
          throw new Error("record_erased");
        if (old?.record.revision === record.revision && old.hash !== hash)
          throw new Error("revision_conflict");
        const apply = !old || old.record.revision <= record.revision;
        if (apply) {
          invalidateDerived(s, namespace, record.kind, id);
          s.records.set(key, {
            key,
            namespace,
            era: scope.era,
            record,
            hash,
            ...(old?.companyKey ? { companyKey: old.companyKey } : {}),
          });
        }
        s.measurements.set(`${key}:${record.revision}`, {
          key: `${key}:${record.revision}`,
          namespace,
          era: scope.era,
          record,
          hash,
        });
        if (alias && aliasId !== id) {
          alias.aliasOf = id;
          invalidateDerived(s, namespace, record.kind, aliasId!);
          if (record.kind === "request")
            for (const t of s.threads.values())
              if (t.namespace === namespace && t.requestId === aliasId)
                t.requestId = id;
        }
        for (const [key, row] of s.outbox)
          if (
            row.namespace === namespace &&
            row.kind === record.kind &&
            ((row.id === aliasId &&
              row.revision <= (sourceRevision ?? record.revision)) ||
              (row.id === id && row.revision <= record.revision))
          )
            s.outbox.delete(key);
        if (aliasId) {
          for (const row of s.records.values())
            if (row.namespace === namespace && row.record.kind === "attempt")
              touch(
                s,
                rowScope(row),
                "live",
                row.record.attempt_id,
                !!row.aliasOf,
                false,
              );
        } else if (apply && old?.hash !== hash)
          touchObservation(s, scope, record);
        if (estimate && record.kind === "attempt") {
          const value = checkedEstimate(estimate);
          if ("schema_version" in value && value.schema_version === "3.0.0")
            storeOriginal(s, scope, value);
          else {
            const key = `${namespace}:${record.attempt_id}:${value.observation_revision}:${value.method_id}`;
            const previous = s.legacyOriginals.get(key);
            if (previous && !same(previous, value))
              throw new Error("revision_conflict");
            s.legacyOriginals.set(key, value);
          }
          if (apply)
            s.estimates.set(`${namespace}:${record.attempt_id}`, value);
        }
        invalidate(s, namespace);
      });
    },
    completedAttempt: async (namespace, attemptKey) =>
      k.read((s) =>
        [...s.records.values()].some(
          (r) =>
            r.namespace === namespace &&
            r.record.kind === "attempt" &&
            r.record.provider_attempt_key === attemptKey &&
            r.record.state === "completed",
        ),
      ),
    coalesceProviderIdentity: (namespace, kind, providerKey) =>
      k.mutate("coalesceProviderIdentity", (s) => {
        const matches = [...s.records.values()]
          .filter(
            (r) =>
              r.namespace === namespace &&
              r.record.kind === kind &&
              (r.record.kind === "request"
                ? r.record.provider_request_key
                : r.record.provider_attempt_key) === providerKey,
          )
          .sort((a, b) => {
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
        if (matches.length > 100)
          throw new Error("conflicting_duplicate_identity");
        if (matches.length < 2) return;
        const groups = new Map<string, RecordRow[]>();
        for (const row of matches) {
          const parent =
            row.record.kind === "request"
              ? row
              : resolveRequest(s, namespace, row.record.request_id, row.era);
          if (!parent || parent.record.kind !== "request") continue;
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
          delete canonical.aliasOf;
          for (const row of group.slice(1)) {
            row.aliasOf = recordId(canonical.record);
            invalidateDerived(s, namespace, kind, recordId(row.record));
            if (kind === "request")
              for (const t of s.threads.values())
                if (
                  t.namespace === namespace &&
                  t.requestId === recordId(row.record)
                )
                  t.requestId = recordId(canonical.record);
          }
        }
        for (const row of s.records.values())
          if (row.namespace === namespace && row.record.kind === "attempt")
            touch(
              s,
              rowScope(row),
              "live",
              row.record.attempt_id,
              !!row.aliasOf,
              false,
            );
        invalidate(s, namespace);
      }),
    recoverInterrupted: async (
      scope,
      before = k.now() - INTERRUPTED_AFTER_MS,
    ) => {
      const jobs = await k.read((s) =>
        [...s.checkpoints.values()]
          .filter(
            (j) =>
              j.namespace === scope.namespace &&
              j.request.ended_at === null &&
              j.at <= before,
          )
          .slice(0, 1000),
      );
      let count = 0;
      for (const job of jobs) {
        const ended = new Date(k.now()).toISOString(),
          request = parseObservation({
            ...job.request,
            revision: job.request.revision + 1,
            state: "interrupted_unconfirmed",
            ended_at: ended,
          }),
          attempt = parseObservation({
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
          });
        if (request.kind !== "request" || attempt.kind !== "attempt")
          throw new Error("ledger_integrity_failed");
        await repository.commitCapture({
          scope: job.scope,
          observations: [request, attempt],
          checkpoint: { ...job, request, attempt },
        });
        count++;
      }
      return count;
    },
    eraseFamily: async (namespace, id, notify = true, retention = false) => {
      const count = await k.mutate("eraseFamily", (s) =>
        eraseFamily(s, namespace, id, true, retention),
      );
      if (notify)
        for (const l of k.routingListeners) {
          try {
            l();
          } catch {}
        }
      return count;
    },
    applyRange: async (scope, start, end, deletionEpoch, retention = false) => {
      checkedScope(scope);
      const count = await k.mutate("applyRange", (s) => {
        if (
          !Number.isInteger(deletionEpoch) ||
          deletionEpoch < 0 ||
          (start !== null && !Number.isFinite(Date.parse(start))) ||
          (end !== null && !Number.isFinite(Date.parse(end))) ||
          (start && end && start >= end)
        )
          throw new Error("payload_rejected");
        s.ranges.push({
          scope: clone(scope),
          start,
          end,
          epoch: deletionEpoch,
          retention,
        });
        let count = 0;
        const roots = [...s.records.values()].filter(
          (r) =>
            r.namespace === scope.namespace &&
            r.record.kind === "request" &&
            (!start || r.record.dispatched_at >= start) &&
            (!end || r.record.dispatched_at < end),
        );
        for (const row of roots)
          count += eraseFamily(
            s,
            scope.namespace,
            row.record.request_id,
            true,
            retention,
          );
        if (!retention)
          for (const row of s.histories.values())
            if (
              row.namespace === scope.namespace &&
              historyErased(s, scope, row.record)
            ) {
              removeHistory(s, row);
              count++;
            }
        invalidate(s, scope.namespace, true);
        return count;
      });
      for (const l of k.routingListeners) {
        try {
          l();
        } catch {}
      }
      return count;
    },
    eraseNamespace: async (namespace) => {
      const count = await k.mutate("eraseNamespace", (s) => {
        s.erasedNamespaces.add(namespace);
        // A fresh erasure is never released by an earlier full Personal erase.
        s.releasableNamespaces.delete(namespace);
        let count = 0;
        for (const row of [...s.records.values()])
          if (row.namespace === namespace && row.record.kind === "request")
            count += eraseFamily(s, namespace, row.record.request_id);
        for (const row of [...s.histories.values()])
          if (row.namespace === namespace) {
            removeHistory(s, row);
            count++;
          }
        for (const [key, row] of s.coverage)
          if (row.namespace === namespace) s.coverage.delete(key);
        for (const [key, row] of s.health)
          if (row.namespace === namespace) s.health.delete(key);
        s.catalogs.delete(namespace);
        s.monthly.delete(namespace);
        // Match namespace-index deletion, including retained aliases and scoped session records.
        for (const map of [
          s.records,
          s.measurements,
          s.checkpoints,
          s.outbox,
          s.coverage,
          s.health,
          s.modelLabels,
          s.coworkCheckpoints,
          s.threads,
          s.summaries,
          s.context,
          s.guidance,
          s.originals,
          s.results,
        ] as const)
          for (const [key, row] of map)
            if (row.namespace === namespace) map.delete(key);
        for (const [key, row] of s.historyQueue)
          if (row.row.namespace === namespace) s.historyQueue.delete(key);
        for (const [key, row] of s.inputs)
          if (row.scope.namespace === namespace) s.inputs.delete(key);
        for (const [key, row] of s.scopeStates)
          if (row.scope.namespace === namespace) s.scopeStates.delete(key);
        for (const [key, row] of s.jobs)
          if (row.scope.namespace === namespace) s.jobs.delete(key);
        for (const [key, row] of s.receipts)
          if ((row as { namespace?: string }).namespace === namespace)
            s.receipts.delete(key);
        for (const key of s.estimates.keys())
          if (key.slice(0, key.lastIndexOf(":")) === namespace)
            s.estimates.delete(key);
        for (const [key, value] of s.legacyOriginals)
          if (
            value.schema_version !== "3.0.0" &&
            key ===
              `${namespace}:${value.attempt_id}:${value.observation_revision}:${value.method_id}`
          )
            s.legacyOriginals.delete(key);
        for (const field of [
          "settings",
          "personal",
          "installation",
          "ownership",
          "credentials",
          "pendingConnection",
          "pendingPolicy",
          "refreshOperation",
        ])
          if (s.session[field]?.namespace === namespace)
            delete s.session[field];
        for (const field of [
          "reconnects",
          "deletionEpochs",
          "deletionReceipts",
          "monthly",
        ]) {
          const records = s.session[field];
          if (!records) continue;
          for (const [key, value] of Object.entries(records))
            if ((value as { namespace?: string })?.namespace === namespace)
              delete records[key];
        }
        s.threadCursors.delete(namespace);
        s.epochs.delete(namespace);
        return count;
      });
      for (const l of k.routingListeners) {
        try {
          l();
        } catch {}
      }
      return count;
    },
    flagOrganizationMarkers: () =>
      k.mutate("flagOrganizationMarkers", (s) => {
        const flagged = [...s.erasedNamespaces].filter((namespace) =>
          namespace.startsWith("company:"),
        );
        for (const namespace of flagged) s.releasableNamespaces.add(namespace);
        return flagged.sort();
      }),
    releaseFlaggedMarker: async (namespace) => {
      const released = await k.mutate("releaseFlaggedMarker", (s) => {
        if (!s.releasableNamespaces.has(namespace)) return false;
        s.releasableNamespaces.delete(namespace);
        return s.erasedNamespaces.delete(namespace);
      });
      if (released)
        for (const l of k.routingListeners) {
          try {
            l();
          } catch {}
        }
      return released;
    },
    resumePendingCleanup: (limit = 32) => {
      limitOf(limit, 32);
      return Promise.resolve({ processed: 0, pending: false });
    },
    linkRecordedThread: (
      scope,
      threadKey,
      providerKeys,
      erasureVersion,
      confirmation,
      current,
    ) => {
      scope = clone(scope);
      providerKeys = clone(providerKeys);
      confirmation = clone(confirmation);
      if (
        !/^[a-f0-9]{64}$/.test(threadKey) ||
        providerKeys.length > 100 ||
        new Set(providerKeys).size !== providerKeys.length ||
        !providerKeys.every((key) => /^[a-f0-9]{64}$/.test(key))
      )
        throw new Error("payload_rejected");
      return k.mutate(
        "linkRecordedThread",
        (s) => {
          if (
            !guardCurrent(s, scope.namespace, {
              erasureVersion,
              dependencies: [],
            })
          )
            throw new Error("deletion_in_progress");
          current?.();
          const matched: string[] = [];
          for (const providerKey of providerKeys) {
            const rows = [...s.records.values()].filter(
                (r) =>
                  r.namespace === scope.namespace &&
                  r.record.kind === "request" &&
                  r.record.provider_request_key === providerKey,
              ),
              candidates = rows.filter(
                (r) =>
                  !r.aliasOf &&
                  r.record.kind === "request" &&
                  r.record.site === "perplexity",
              );
            if (rows.length > 100 || candidates.length > 1)
              throw new Error("conflicting_duplicate_identity");
            const record = candidates[0];
            if (!record) continue;
            const key = `${scope.namespace}:${providerKey}`,
              old = s.threads.get(key),
              confirmed =
                confirmation?.keys.includes(providerKey) &&
                confirmation.versions[providerKey] ===
                  (old?.conflictVersion ?? 0);
            if (
              (old?.rejected && !confirmed) ||
              (old && !old.rejected && old.threadKey !== threadKey)
            )
              throw new Error("thread_relation_conflict");
            current?.();
            s.threads.set(key, {
              key,
              namespace: scope.namespace,
              threadKey,
              providerRequestKey: providerKey,
              requestId: record.record.request_id,
              pending: scope.mode === "company" ? (old?.pending ?? 1) : 0,
              nextAt: old?.nextAt ?? 0,
              rejected: false,
              conflictVersion: old?.conflictVersion ?? 0,
            });
            matched.push(providerKey);
          }
          if (matched.length) invalidate(s, scope.namespace);
          current?.();
          return matched;
        },
        () => {
          current?.();
        },
      );
    },
    pendingThreadLinks: (namespace, limit = 100) => {
      if (!Number.isInteger(limit) || limit < 1)
        throw new Error("payload_rejected");
      const maximum = Math.min(limit, 100);
      return k.mutate("pendingThreadLinks", (s) => {
        if (s.erasedNamespaces.has(namespace)) return [];
        const rows = [...s.threads.values()]
          .filter(
            (t) =>
              t.namespace === namespace &&
              t.pending === 1 &&
              t.nextAt <= k.now(),
          )
          .sort((a, b) => a.nextAt - b.nextAt || a.key.localeCompare(b.key));
        const erasureVersion = epoch(s, namespace).erasureVersion;
        let cursor = s.threadCursors.get(namespace);
        if (cursor?.erasureVersion !== erasureVersion) cursor = undefined;
        if (!cursor) {
          const last = rows.at(-1);
          if (!last) return [];
          cursor = {
            erasureVersion,
            after: null,
            end: { at: last.nextAt, key: last.key },
          };
        }
        const after = cursor.after,
          end = cursor.end;
        const candidates = rows.filter(
          (row) =>
            (!after ||
              row.nextAt > after.at ||
              (row.nextAt === after.at && row.key > after.key)) &&
            (row.nextAt < end.at ||
              (row.nextAt === end.at && row.key <= end.key)),
        );
        const links = candidates.slice(0, maximum),
          ready: typeof links = [];
        let finished = candidates.length <= maximum,
          advanced = after;
        for (const link of links) {
          const parent = s.records.get(
            recordKey(namespace, "request", link.requestId),
          );
          const eligible =
            !link.rejected &&
            parent &&
            !parent.aliasOf &&
            parent.record.kind === "request" &&
            parent.record.provider_request_key === link.providerRequestKey &&
            !s.outbox.has(`${parent.key}:${parent.record.revision}`);
          if (
            eligible &&
            ready.length &&
            ready[0]!.threadKey !== link.threadKey
          ) {
            finished = false;
            break;
          }
          advanced = { at: link.nextAt, key: link.key };
          if (eligible) ready.push(link);
        }
        if (finished) s.threadCursors.delete(namespace);
        else s.threadCursors.set(namespace, { ...cursor, after: advanced });
        return ready;
      });
    },
    acknowledgeThreadLinks: (namespace, threadKey, results, erasureVersion) =>
      k.mutate("acknowledgeThreadLinks", (s) => {
        if (!guardCurrent(s, namespace, { erasureVersion, dependencies: [] }))
          return;
        for (const result of results) {
          const row = s.threads.get(
            `${namespace}:${result.provider_request_key}`,
          );
          if (row && row.threadKey === threadKey && !row.rejected) {
            row.pending = result.status === "linked" ? 0 : 1;
            row.nextAt = k.now() + 60000;
          }
        }
      }),
    rejectThreadLinks: async (scope, threadKey, keys, expected) => {
      const changed = await k.mutate("rejectThreadLinks", (s) => {
        const c = s.session.credentials;
        if (
          scope.mode !== "company" ||
          c?.namespace !== scope.namespace ||
          c.device_id !== expected.deviceId ||
          c.enrollment_era?.id !== scope.era ||
          !guardCurrent(s, scope.namespace, {
            erasureVersion: expected.erasureVersion,
            dependencies: [],
          })
        )
          return false;
        let changed = false;
        for (const key of keys.slice(0, 100)) {
          const row = s.threads.get(`${scope.namespace}:${key}`),
            parent = row
              ? s.records.get(
                  recordKey(scope.namespace, "request", row.requestId),
                )
              : undefined;
          if (
            row?.threadKey === threadKey &&
            !row.rejected &&
            parent &&
            !parent.aliasOf &&
            parent.record.kind === "request" &&
            parent.record.provider_request_key === key
          ) {
            row.rejected = true;
            row.pending = 0;
            row.conflictVersion = (row.conflictVersion ?? 0) + 1;
            changed = true;
          }
        }
        if (changed) invalidate(s, scope.namespace, false, true);
        return changed;
      });
      if (changed)
        for (const listener of k.routingListeners) {
          try {
            listener();
          } catch {}
        }
      return changed;
    },
    threadRelationVersions: (namespace, keys) =>
      k.read((s) =>
        Object.fromEntries(
          keys
            .slice(0, 100)
            .map((key) => [
              key,
              s.threads.get(`${namespace}:${key}`)?.conflictVersion ?? 0,
            ]),
        ),
      ),
    threadAnswer: async (namespace, threadKey, attemptKey) => {
      if (
        !/^[a-f0-9]{64}$/.test(threadKey) ||
        !/^[a-f0-9]{64}$/.test(attemptKey)
      )
        throw new Error("payload_rejected");
      return k.read((s) => {
        for (const row of s.histories.values())
          if (
            row.namespace === namespace &&
            row.status === "current" &&
            row.record.role === "response" &&
            row.record.site === "perplexity" &&
            row.record.conversation_key === threadKey &&
            row.record.provider_attempt_key === attemptKey &&
            !historyErased(s, rowScope(row), row.record)
          )
            return true;
        for (const row of s.records.values()) {
          if (
            row.namespace !== namespace ||
            row.aliasOf ||
            row.record.kind !== "attempt" ||
            row.record.provider_attempt_key !== attemptKey
          )
            continue;
          const parent = s.records.get(
            recordKey(namespace, "request", row.record.request_id),
          );
          const providerKey =
            parent?.record.kind === "request" &&
            parent.record.site === "perplexity"
              ? parent.record.provider_request_key
              : null;
          const link = providerKey
            ? s.threads.get(`${namespace}:${providerKey}`)
            : undefined;
          if (link && !link.rejected && link.threadKey === threadKey)
            return true;
        }
        return false;
      });
    },
  };
  return repository;
}
