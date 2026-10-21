import {
  EstimationEnvelopeSchema,
  EngineMethodIdentitySchema,
  EnginePreferenceRecordSchema,
  EnginePreferenceSchema,
  EstimateObservationSourceSchema,
  OriginalEstimateResultSchema,
  parseObservation,
  payloadHash,
  type EstimateObservationSource,
} from "@footprint/contracts";
import type { Scope } from "./ledger-support";
import type {
  EstimationRepository,
  EstimationViewRow,
} from "./estimation-contracts";
import {
  MemoryKernel,
  type MemoryState,
  type MemoryJob,
  type MemoryInput,
  same,
  clone,
  checkedScope,
  limitOf,
  scopeKey,
  inputKey,
  rowScope,
  recordKey,
  authority,
  allowed,
  scopedRead,
  preferenceState,
  selectionRevision,
  stateFor,
  uniformOriginalMethodHash,
  publicJob,
  active,
  resolveInput,
  matchingLiveInput,
  admitMethod,
  localSelection,
  selectionCurrent,
  legacyOriginal,
} from "./memory-core";

const resultKey = (hash: string, key: string) => `${hash}:${key}`;
function sourceRow(
  s: MemoryState,
  scope: Scope,
  source: Pick<EstimateObservationSource, "family"> & {
    attempt_id?: string;
    message_key?: string;
  },
): MemoryInput | null {
  if (!allowed(s, scope, true)) return null;
  const id =
    source.family === "live" ? source.attempt_id! : source.message_key!;
  const stored =
    source.family === "live"
      ? s.records.get(recordKey(scope.namespace, "attempt", id))
      : s.histories.get(`${scope.namespace}:history:${id}`);
  if (!stored) return null;
  const actual = rowScope(stored);
  if (
    !(same(scope, actual)
      ? allowed(s, actual, true)
      : scopedRead(s, scope, actual))
  )
    return null;
  return s.inputs.get(inputKey(actual, source.family, id)) ?? null;
}
function resultIn(
  s: MemoryState,
  scope: Scope,
  source: EstimateObservationSource,
  methodHash: string,
  selectedFor: (scope: Scope) => ReturnType<typeof state>["selected"] = (
    value,
  ) => state(s, value).selected,
) {
  const row = sourceRow(s, scope, source),
    input = row ? resolveInput(s, row) : null;
  if (!row || !input || !same(input.source, source)) return null;
  const selected = selectedFor(row.scope);
  if (
    selected?.target.method_hash === methodHash &&
    row.sequence <= selected.watermark
  ) {
    const r = s.results.get(resultKey(methodHash, row.key));
    if (r?.sequence === row.sequence && r.result && same(r.result.source, source))
      return r.result;
  }
  return (
    s.originals.get(`${row.key}:${payloadHash(source)}:${methodHash}`)
      ?.result ?? null
  );
}
function jobInputs(s: MemoryState, job: MemoryJob) {
  return [...s.inputs.values()]
    .filter(
      (i) =>
        same(i.scope, job.scope) &&
        i.sequence > job.baseWatermark &&
        i.sequence <= job.watermark,
    )
    .sort((a, b) => a.sequence - b.sequence);
}
function advance(s: MemoryState, job: MemoryJob) {
  for (const row of jobInputs(s, job)
    .filter((i) => i.sequence > job.cursor)
    .slice(0, 100)) {
    if (
      s.results.get(resultKey(job.target.method_hash, row.key))?.sequence !==
      row.sequence
    )
      break;
    job.cursor = row.sequence;
  }
}
function state(s: MemoryState, scope: Scope) {
  checkedScope(scope);
  const st = stateFor(s, scope);
  if (!allowed(s, scope, true))
    return {
      active: null,
      selected: null,
      pending: 0,
      publicationVersion: st.publicationVersion,
    };
  const selected = st.selectedJob ? s.jobs.get(st.selectedJob) : null,
    valid =
      selected?.status === "complete" &&
      selected.selectionRevision === selectionRevision(s)
        ? selected
        : null;
  const pending = [...s.inputs.values()].filter(
    (i) => same(i.scope, scope) && (!valid || i.sequence > valid.watermark),
  ).length;
  const running = st.activeJob ? active(s, st.activeJob) : null;
  return {
    active: running ? publicJob(running) : null,
    selected: valid ? { ...publicJob(valid), pending } : null,
    pending,
    publicationVersion: st.publicationVersion,
    inputCount: st.inputCount,
    uniformOriginalMethodHash: uniformOriginalMethodHash(st),
    originalEvidenceCurrent: st.originalEvidenceCurrentCount === st.inputCount,
  };
}
function writePreference(s: MemoryState, value: unknown) {
  const record = EnginePreferenceRecordSchema.parse(value);
  s.preference = record;
  s.preferenceFloor = record.selection_revision;
  for (const j of s.jobs.values())
    if (j.status === "running") {
      j.status = "superseded";
      for (const [key, r] of s.results)
        if (r.jobId === j.id) s.results.delete(key);
    }
  for (const st of s.scopeStates.values()) {
    st.activeJob = null;
    st.generation++;
    st.publicationVersion++;
  }
}
export function liveOverlap(
  s: MemoryState,
  input: ReturnType<typeof resolveInput>,
): boolean {
  return (
    input?.family === "history" &&
    matchingLiveInput(s, input.scope, input.history) !== null
  );
}
function originalForLive(
  s: MemoryState,
  scope: Scope,
  source: { attemptId: string; attemptRevision: number; attemptHash: string },
) {
  checkedScope(scope);
  const row = sourceRow(s, scope, {
    family: "live",
    attempt_id: source.attemptId,
  });
  if (!row) return null;
  const input = resolveInput(s, row);
  if (
    input?.family !== "live" ||
    input.source.attempt_revision !== source.attemptRevision ||
    input.source.attempt_hash !== source.attemptHash
  )
    return null;
  const chain = [] as Array<typeof input.request>;
  const seen = new Set<string>();
  let requestId = input.attempt.request_id;
  let completeChain = false;
  for (let depth = 0; depth < 64; depth++) {
    if (
      seen.has(requestId) ||
      s.erasedRequests.has(`${scope.namespace}:${requestId}`)
    )
      return null;
    seen.add(requestId);
    const key = recordKey(scope.namespace, "request", requestId);
    const current = s.records.get(key);
    if (!current) return null;
    const observation = parseObservation(current.record);
    if (
      current.key !== key ||
      current.namespace !== scope.namespace ||
      current.era !== row.scope.era ||
      observation.kind !== "request" ||
      observation.request_id !== requestId ||
      payloadHash(observation) !== current.hash
    )
      throw new Error("ledger_integrity_failed");
    chain.push(observation);
    if (current.aliasOf === undefined) {
      completeChain = true;
      break;
    }
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        current.aliasOf,
      ) ||
      current.aliasOf.length !== 36
    )
      throw new Error("ledger_integrity_failed");
    requestId = current.aliasOf;
  }
  if (!completeChain) return null;
  const candidates = [...s.originals.values()].filter(
    (o) =>
      o.inputKey === row.key &&
      o.result.source.family === "live" &&
      o.result.source.attempt_revision === source.attemptRevision &&
      o.result.source.attempt_hash === source.attemptHash,
  );
  const pointer = s.estimates.get(`${scope.namespace}:${source.attemptId}`),
    preferred =
      pointer &&
      "schema_version" in pointer &&
      pointer.schema_version === "3.0.0"
        ? candidates.find((o) => same(o.result, pointer))
        : undefined;
  if (!preferred && candidates.length !== 1) return null;
  const result = EstimationEnvelopeSchema.parse(
    (preferred ?? candidates[0])!.result,
  );
  if (result.source.family !== "live") return null;
  const proof = result.source,
    request = s.measurements.get(
      `${recordKey(scope.namespace, "request", proof.request_id)}:${proof.request_revision}`,
    ),
    attempt = s.measurements.get(
      `${recordKey(scope.namespace, "attempt", proof.attempt_id)}:${proof.attempt_revision}`,
    );
  if (!request || !attempt) return null;
  if (
    request.record.kind !== "request" ||
    attempt.record.kind !== "attempt" ||
    request.era !== row.scope.era ||
    attempt.era !== row.scope.era ||
    request.hash !== proof.request_hash ||
    attempt.hash !== proof.attempt_hash ||
    payloadHash(request.record) !== proof.request_hash ||
    payloadHash(attempt.record) !== proof.attempt_hash
  )
    throw new Error("ledger_integrity_failed");
  if (
    !chain.some((entry) => entry.request_id === proof.request_id) ||
    s.erasedRequests.has(`${scope.namespace}:${proof.request_id}`) ||
    s.ranges.some(
      (r) =>
        r.scope.namespace === scope.namespace &&
        [...chain, request.record].some(
          (observation) =>
            observation.kind === "request" &&
            (!r.start || observation.dispatched_at >= r.start) &&
            (!r.end || observation.dispatched_at < r.end),
        ),
    )
  )
    return null;
  return { result, request: request.record, attempt: attempt.record };
}
export function createMemoryEstimation(k: MemoryKernel): EstimationRepository {
  return {
    localSelectionState: (scope) => k.read((s) => localSelection(s, scope)),
    localSelectionCurrent: (scope, token) =>
      k.read((s) => selectionCurrent(s, scope, token)),
    state: (scope) => k.read((s) => state(s, scope)),
    liveInput: (scope, attemptId) =>
      k.read((s) => {
        checkedScope(scope);
        const row = sourceRow(s, scope, {
            family: "live",
            attempt_id: attemptId,
          }),
          input = row ? resolveInput(s, row) : null;
        return input?.family === "live" ? input : null;
      }),
    originalForLive: (scope, source) => {
      scope = clone(scope);
      source = clone(source);
      return k.read((s) => originalForLive(s, scope, source));
    },
    readPreference: () =>
      k.read((s) => {
        const p = preferenceState(s);
        if (p.status === "invalid")
          throw new Error("engine_preference_invalid");
        return p.status === "valid" ? p.record : null;
      }),
    readPreferenceState: () => k.read(preferenceState),
    compareAndSetPreference: (expected, next) => {
      const record = EnginePreferenceRecordSchema.parse(next);
      if (
        (expected !== null && (!Number.isInteger(expected) || expected < 1)) ||
        record.selection_revision !== (expected ?? 0) + 1
      )
        throw new Error("revision_conflict");
      return k.mutate("compareAndSetPreference", (s) => {
        const old = preferenceState(s);
        if (old.status === "invalid" || old.revision !== expected) return false;
        writePreference(s, record);
        return true;
      });
    },
    repairPreference: (expected, value) => {
      const preference = EnginePreferenceSchema.parse(value);
      return k.mutate("repairPreference", (s) => {
        const old = preferenceState(s);
        if (old.status !== "invalid" || old.revision !== expected) return null;
        const floor = Math.max(
          old.revision ?? 0,
          s.preferenceFloor,
          ...[...s.jobs.values()].map((j) => j.selectionRevision),
        );
        if (floor >= 2147483647) throw new Error("revision_conflict");
        const record = {
          schema_version: "1.0.0" as const,
          preference,
          selection_revision: floor + 1,
          updated_at: new Date(k.now()).toISOString(),
        };
        writePreference(s, record);
        return record;
      });
    },
    start: (options) => {
      const scope = clone(checkedScope(options.scope)),
        target = EngineMethodIdentitySchema.parse(options.target),
        fallbackMethod = options.fallbackMethod
          ? EngineMethodIdentitySchema.parse(options.fallbackMethod)
          : undefined;
      if (
        fallbackMethod &&
        (target.engine_id !== "ecologits" ||
          fallbackMethod.engine_id !== "original")
      )
        throw new Error("method_update_invalid");
      return k.mutate("startRecalculation", (s) => {
        if (!allowed(s, scope) || selectionRevision(s) === null)
          throw new Error("policy_unavailable");
        if (selectionRevision(s) !== options.selectionRevision)
          throw new Error("revision_conflict");
        admitMethod(s, target);
        if (fallbackMethod) admitMethod(s, fallbackMethod);
        const st = stateFor(s, scope),
          old = st.activeJob ? active(s, st.activeJob) : null;
        if (
          old &&
          same(old.target, target) &&
          same(old.fallbackMethod ?? null, fallbackMethod ?? null) &&
          old.selectionRevision === options.selectionRevision
        )
          return publicJob(old);
        for (const [id, j] of s.jobs)
          if (same(j.scope, scope) && id !== st.selectedJob) {
            for (const [key, r] of s.results)
              if (r.jobId === id) s.results.delete(key);
            s.jobs.delete(id);
          }
        const selected = st.selectedJob ? s.jobs.get(st.selectedJob) : null,
          baseWatermark =
            selected?.status === "complete" &&
            same(selected.target, target) &&
            same(selected.fallbackMethod ?? null, fallbackMethod ?? null)
              ? selected.watermark
              : 0;
        if (
          selected?.target.method_hash === target.method_hash &&
          !same(selected.fallbackMethod ?? null, fallbackMethod ?? null)
        )
          for (const [key, r] of s.results)
            if (
              s.inputs.get(r.inputKey)?.scope.namespace === scope.namespace &&
              key.startsWith(`${target.method_hash}:${scopeKey(scope)}:`)
            )
              s.results.delete(key);
        const job: MemoryJob = {
          id: k.id(),
          scope,
          target,
          ...(fallbackMethod ? { fallbackMethod } : {}),
          selectionRevision: options.selectionRevision,
          generation: st.generation + 1,
          authority: authority(s).fingerprint,
          status: "running",
          watermark: st.sequence,
          cursor: baseWatermark,
          baseWatermark,
          snapshotTotal: [...s.inputs.values()].filter(
            (i) => same(i.scope, scope) && i.sequence > baseWatermark,
          ).length,
          processed: 0,
          unavailable: 0,
          pending: 0,
        };
        s.jobs.set(job.id, job);
        st.generation = job.generation;
        st.activeJob = job.id;
        return publicJob(job);
      });
    },
    resume: (scope) =>
      k.read((s) => {
        checkedScope(scope);
        const id = stateFor(s, scope).activeJob,
          j = id ? active(s, id) : null;
        return j ? publicJob(j) : null;
      }),
    page: (id, limit = 100) => {
      limitOf(limit);
      return k.mutate("pageRecalculation", (s) => {
        const job = active(s, id);
        if (!job) throw new Error("stale_estimation_result");
        advance(s, job);
        const inputs: ReturnType<typeof resolveInput>[] = [],
          unavailable: Array<{
            key: string;
            sequence: number;
            reason: "dependency_missing" | "ledger_integrity_failed";
          }> = [];
        for (const row of jobInputs(s, job)
          .filter((i) => i.sequence > job.cursor)
          .slice(0, limit)) {
          if (
            s.results.get(resultKey(job.target.method_hash, row.key))
              ?.sequence === row.sequence
          )
            continue;
          let input: ReturnType<typeof resolveInput> = null,
            reason: "dependency_missing" | "ledger_integrity_failed" =
              "dependency_missing";
          try {
            input = resolveInput(s, row);
          } catch {
            reason = "ledger_integrity_failed";
          }
          if (input) inputs.push(input);
          else {
            s.results.set(resultKey(job.target.method_hash, row.key), {
              namespace: row.scope.namespace,
              inputKey: row.key,
              jobId: id,
              sequence: row.sequence,
              result: null,
              reason,
            });
            job.processed++;
            job.unavailable++;
            unavailable.push({ key: row.key, sequence: row.sequence, reason });
          }
        }
        advance(s, job);
        return {
          job: publicJob(job),
          inputs: inputs.filter((i) => i !== null),
          unavailable,
          done: job.processed === job.snapshotTotal,
        };
      });
    },
    commitResult: (options) => {
      const result = EstimationEnvelopeSchema.parse(options.result);
      return k.mutate("commitEstimationResult", (s) => {
        const job = active(s, options.jobId);
        if (!job) return "stale";
        if (
          result.view !== "recalculated" ||
          result.execution_origin !== "local" ||
          !same(result.requested_method, job.target) ||
          (result.effective_method.engine_id === job.target.engine_id &&
            !same(result.effective_method, job.target))
        )
          throw new Error("method_update_invalid");
        const row = s.inputs.get(options.inputKey);
        if (
          !row ||
          !same(row.scope, job.scope) ||
          row.sequence !== options.sequence ||
          row.sequence > job.watermark
        )
          return "stale";
        const input = resolveInput(s, row);
        if (!input || !same(input.source, result.source)) return "stale";
        if (
          (input.originalMethodHash === null &&
            (input.originalMethodState !== "not_admitted" ||
              !result.reasons.includes("original_method_missing"))) ||
          result.original_method_hash !== input.originalMethodHash
        )
          throw new Error("method_update_invalid");
        if (
          result.effective_method.engine_id !== job.target.engine_id &&
          (!job.fallbackMethod ||
            !same(result.effective_method, job.fallbackMethod))
        )
          throw new Error("method_update_invalid");
        admitMethod(s, result.effective_method);
        const key = resultKey(job.target.method_hash, row.key),
          old = s.results.get(key);
        if (old) {
          if (old.sequence === row.sequence && same(old.result, result))
            return "duplicate";
          throw new Error("revision_conflict");
        }
        s.results.set(key, {
          namespace: row.scope.namespace,
          inputKey: row.key,
          jobId: job.id,
          sequence: row.sequence,
          result,
        });
        job.processed++;
        if (result.status === "unavailable") job.unavailable++;
        advance(s, job);
        return "applied";
      });
    },
    markUnavailable: (options) => {
      if (
        ![
          "dependency_missing",
          "ledger_integrity_failed",
          "original_method_missing",
          "method_unsupported",
        ].includes(options.reason)
      )
        throw new Error("payload_rejected");
      return k.mutate("markEstimationUnavailable", (s) => {
        const job = active(s, options.jobId),
          row = s.inputs.get(options.inputKey);
        if (
          !job ||
          !row ||
          !same(row.scope, job.scope) ||
          row.sequence !== options.sequence ||
          row.sequence > job.watermark
        )
          return "stale";
        const key = resultKey(job.target.method_hash, row.key),
          old = s.results.get(key);
        if (old) {
          if (
            old.sequence === row.sequence &&
            !old.result &&
            old.reason === options.reason
          )
            return "duplicate";
          throw new Error("revision_conflict");
        }
        s.results.set(key, {
          namespace: row.scope.namespace,
          inputKey: row.key,
          jobId: job.id,
          sequence: row.sequence,
          result: null,
          reason: options.reason,
        });
        job.processed++;
        job.unavailable++;
        advance(s, job);
        return "applied";
      });
    },
    resultFor: (scope, untrusted, methodHash) => {
      const source = EstimateObservationSourceSchema.parse(untrusted);
      return k.read((s) => {
        checkedScope(scope);
        return resultIn(s, scope, source, methodHash);
      });
    },
    resultsFor: (scope, untrusted, methodHash) => {
      if (!Array.isArray(untrusted) || untrusted.length > 100)
        throw new Error("payload_rejected");
      const sources = untrusted.map((value) =>
        EstimateObservationSourceSchema.parse(value),
      );
      return k.read((s) => {
        checkedScope(scope);
        // Selection state scans every input, so read it once per source scope.
        const selected = new Map<string, ReturnType<typeof state>["selected"]>();
        const selectedFor = (value: Scope) => {
          const key = scopeKey(value);
          if (!selected.has(key)) selected.set(key, state(s, value).selected);
          return selected.get(key)!;
        };
        return sources.map((source) =>
          resultIn(s, scope, source, methodHash, selectedFor),
        );
      });
    },
    promote: (id) =>
      k.mutate("promoteRecalculation", (s) => {
        const job = active(s, id);
        if (!job) throw new Error("stale_estimation_result");
        if (
          job.processed !== job.snapshotTotal ||
          [...s.results.values()].filter((r) => r.jobId === job.id).length !==
            job.processed
        )
          throw new Error("recalculation_incomplete");
        const st = stateFor(s, job.scope),
          old = st.selectedJob ? s.jobs.get(st.selectedJob) : null;
        job.pending = [...s.inputs.values()].filter(
          (i) => same(i.scope, job.scope) && i.sequence > job.watermark,
        ).length;
        job.status = "complete";
        st.selectedJob = id;
        st.activeJob = null;
        st.publicationVersion++;
        if (old && old.id !== id) {
          if (old.target.method_hash !== job.target.method_hash)
            for (const [key] of s.results)
              if (
                key.startsWith(
                  `${old.target.method_hash}:${scopeKey(job.scope)}:`,
                )
              )
                s.results.delete(key);
          s.jobs.delete(old.id);
        }
        return publicJob(job);
      }),
    cancel: (id) =>
      k.mutate("cancelRecalculation", (s) => {
        const job = s.jobs.get(id);
        if (!job || job.status === "cancelled") return;
        const st = stateFor(s, job.scope);
        job.status = "cancelled";
        if (st.selectedJob === id && st.activeJob) {
          const candidate = s.jobs.get(st.activeJob);
          if (candidate?.target.method_hash === job.target.method_hash) {
            candidate.status = "superseded";
            st.activeJob = null;
            st.generation++;
          }
        }
        for (const [key, r] of s.results)
          if (
            st.selectedJob === id
              ? key.startsWith(
                  `${job.target.method_hash}:${scopeKey(job.scope)}:`,
                )
              : r.jobId === id
          )
            s.results.delete(key);
        if (st.activeJob === id) st.activeJob = null;
        if (st.selectedJob === id) st.selectedJob = null;
        st.publicationVersion++;
      }),
    viewPage: (options) => {
      options = clone(options);
      const scope = checkedScope(options.scope),
        limit = limitOf(options.limit ?? 100),
        prefix = scopeKey(scope) + ":";
      if (options.after && !options.after.startsWith(prefix))
        throw new Error("payload_rejected");
      return k.read((s) => {
        if (!allowed(s, scope, true)) return { rows: [], after: null };
        const sourceRows = [...s.inputs.values()]
            .filter(
              (i) =>
                same(i.scope, scope) &&
                (!options.after || i.key > options.after),
            )
            .sort((a, b) => a.key.localeCompare(b.key))
            .slice(0, limit),
          selected = state(s, scope).selected;
        const rows: EstimationViewRow[] = sourceRows.map((row) => {
          let input: ReturnType<typeof resolveInput> = null;
          try {
            input = resolveInput(s, row);
          } catch {}
          const candidates = [...s.originals.values()].filter(
              (o) =>
                o.inputKey === row.key &&
                input &&
                same(o.result.source, input.source),
            ),
            originalAuthority =
              scope.mode === "personal"
                ? scope
                : (authority(s).current ?? scope),
            envelope =
              input?.family === "live"
                ? (originalForLive(s, originalAuthority, {
                    attemptId: input.attempt.attempt_id,
                    attemptRevision: input.attempt.revision,
                    attemptHash: input.source.attempt_hash,
                  })?.result ?? null)
                : candidates.length === 1
                  ? candidates[0]!.result
                  : null,
            original = envelope
              ? envelope
              : row.family === "history"
                ? (s.histories.get(`${scope.namespace}:history:${row.id}`)
                    ?.originalEstimate ?? null)
                : input?.family === "live"
                  ? legacyOriginal(s, row, input.source.attempt_hash)
                  : null;
          let result =
            original &&
            "schema_version" in original &&
            original.schema_version === "3.0.0"
              ? original
              : null;
          let status: EstimationViewRow["state"] = input
            ? "original"
            : "unavailable";
          if (options.view === "selected") {
            const r = selected
              ? s.results.get(resultKey(selected.target.method_hash, row.key))
              : null;
            result =
              input &&
              selected &&
              row.sequence <= selected.watermark &&
              r?.sequence === row.sequence
                ? r.result && same(r.result.source, input.source)
                  ? r.result
                  : null
                : null;
            status = !input
              ? "unavailable"
              : !selected || row.sequence > selected.watermark
                ? "pending"
                : result
                  ? "selected"
                  : r?.sequence === row.sequence && !r.result
                    ? "unavailable"
                    : "pending";
          }
          return {
            key: row.key,
            sequence: row.sequence,
            input,
            result,
            original,
            contributes: !!input && !liveOverlap(s, input),
            state: status,
          };
        });
        return {
          rows,
          after: sourceRows.length === limit ? sourceRows.at(-1)!.key : null,
        };
      });
    },
  };
}
