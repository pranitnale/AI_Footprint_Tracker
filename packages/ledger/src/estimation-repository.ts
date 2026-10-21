import { matchingLiveInput } from "./estimation-storage";
import {
  canonicalJson,
  payloadHash,
  EngineMethodIdentitySchema,
  EnginePreferenceRecordSchema,
  EnginePreferenceSchema,
  SelectionRevisionSchema,
  type EnginePreference,
  EstimationEnvelopeSchema,
  EstimateObservationSourceSchema,
  type EnginePreferenceRecord,
  type EngineMethodIdentity,
  type EstimationEnvelope,
  type EstimateObservationSource,
} from "@footprint/contracts";
import { completed, request, type Scope } from "./ledger-support";
import {
  checkedScope,
  admitMethodIdentity,
  eachCursor,
  estimationTransactionStores,
  inputKey,
  legacyOriginal,
  originalForSource,
  resolveInput,
  resultKey,
  scopeKey,
  stateFor,
  type InputRow,
  type JobRow,
  type ResultRow,
} from "./estimation-storage";
import type {
  EstimationRepository,
  EstimationInput,
  RecalculationJob,
  EstimationPage,
  EstimationViewRow,
  UnavailableReason,
  EnginePreferenceState,
} from "./estimation-contracts";
import {
  readLocalAuthority,
  localMemberAllowed,
  localReadMemberAllowed,
  localScopeAllowed,
  readLocalSelection,
  localSelectionCurrent,
  readPreferenceState,
} from "./local-selection";
import { originalForLive } from "./original-live";
import { uniformOriginalMethodHash } from "./original-method-proof";

const limitOf = (limit: number) => {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("payload_rejected");
  return limit;
};
const publicJob = ({
  key: _,
  namespace: __,
  scopeKey: ___,
  authority: ____,
  baseWatermark: _____,
  ...job
}: JobRow): RecalculationJob => job;
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

/** The repository validates and persists results. Executors supply all numerical calculations. */
export class IndexedDbEstimationRepository implements EstimationRepository {
  constructor(private readonly db: IDBDatabase) {}
  private async transaction<T>(
    mode: IDBTransactionMode,
    work: (tx: IDBTransaction) => Promise<T>,
  ): Promise<T> {
    const tx = this.db.transaction(estimationTransactionStores, mode),
      done = completed(tx);
    try {
      const value = await work(tx);
      await done;
      return value;
    } catch (error) {
      try {
        tx.abort();
      } catch {}
      await done.catch(() => {});
      throw error;
    }
  }
  private async authority(tx: IDBTransaction): Promise<string> {
    return (await readLocalAuthority(tx)).fingerprint;
  }
  localSelectionState(authorityScope: Scope) {
    return this.transaction("readonly", (tx) =>
      readLocalSelection(tx, authorityScope),
    );
  }
  localSelectionCurrent(authorityScope: Scope, token: string) {
    return this.transaction("readonly", (tx) =>
      localSelectionCurrent(tx, authorityScope, token),
    );
  }
  originalForLive(
    authorityScope: Scope,
    source: { attemptId: string; attemptRevision: number; attemptHash: string },
  ) {
    return this.transaction("readonly", (tx) =>
      originalForLive(tx, authorityScope, source),
    );
  }
  private async preference(
    tx: IDBTransaction,
  ): Promise<EnginePreferenceRecord | null> {
    const row = await request(
      tx.objectStore("engine_preferences").get("installation"),
    );
    return row ? EnginePreferenceRecordSchema.parse(row.record) : null;
  }
  private async preferenceState(
    tx: IDBTransaction,
  ): Promise<EnginePreferenceState> {
    return readPreferenceState(tx);
  }
  private async selectionRevision(tx: IDBTransaction): Promise<number | null> {
    const state = await this.preferenceState(tx);
    return state.status === "missing"
      ? 1
      : state.status === "valid"
        ? state.revision
        : null;
  }
  readPreferenceState(): Promise<EnginePreferenceState> {
    return this.transaction("readonly", (tx) => this.preferenceState(tx));
  }
  private async writePreference(
    tx: IDBTransaction,
    record: EnginePreferenceRecord,
  ): Promise<void> {
    tx.objectStore("engine_preferences").put({ key: "installation", record });
    tx.objectStore("policy").put({
      key: "engine-preference-revision",
      revision: record.selection_revision,
    });
    await eachCursor(
      tx.objectStore("estimation_jobs"),
      null,
      async (job: JobRow) => {
        if (job.status === "running") {
          tx.objectStore("estimation_jobs").put({
            ...job,
            status: "superseded",
          });
          await this.deleteResults(tx, job.id);
        }
      },
    );
    await eachCursor(tx.objectStore("estimation_state"), null, (row) => {
      tx.objectStore("estimation_state").put({
        ...row,
        activeJob: null,
        generation: row.generation + 1,
        publicationVersion: (row.publicationVersion ?? 0) + 1,
      });
    });
  }
  async repairPreference(
    expectedRevision: number | null,
    preference: EnginePreference,
  ): Promise<EnginePreferenceRecord | null> {
    const choice = EnginePreferenceSchema.parse(preference);
    if (expectedRevision !== null)
      SelectionRevisionSchema.parse(expectedRevision);
    return this.transaction("readwrite", async (tx) => {
      const current = await this.preferenceState(tx);
      if (current.status !== "invalid" || current.revision !== expectedRevision)
        return null;
      let floor = current.revision ?? 0;
      const saved = await request(
        tx.objectStore("policy").get("engine-preference-revision"),
      );
      const previous = SelectionRevisionSchema.safeParse(saved?.revision);
      if (previous.success) floor = Math.max(floor, previous.data);
      await eachCursor(tx.objectStore("estimation_jobs"), null, (job) => {
        const revision = SelectionRevisionSchema.safeParse(
          job.selectionRevision,
        );
        if (revision.success) floor = Math.max(floor, revision.data);
      });
      const next = SelectionRevisionSchema.safeParse(floor + 1);
      if (!next.success) throw new Error("revision_conflict");
      const record = EnginePreferenceRecordSchema.parse({
        schema_version: "1.0.0",
        preference: choice,
        selection_revision: next.data,
        updated_at: new Date().toISOString(),
      });
      await this.writePreference(tx, record);
      return record;
    });
  }
  async state(scope: Scope): Promise<{
    active: RecalculationJob | null;
    selected: RecalculationJob | null;
    pending: number;
    publicationVersion: number;
    inputCount?: number;
    uniformOriginalMethodHash?: string | null;
    originalEvidenceCurrent?: boolean;
  }> {
    checkedScope(scope);
    return this.transaction("readonly", async (tx) => {
      if (!(await localReadMemberAllowed(tx, scope)))
        return {
          active: null,
          selected: null,
          pending: 0,
          publicationVersion: 0,
        };
      const state = await stateFor(tx, scope),
        preferenceRevision = await this.selectionRevision(tx);
      const active = state.activeJob
        ? await this.active(tx, state.activeJob)
        : null;
      const saved: JobRow | undefined = state.selectedJob
        ? await request(
            tx.objectStore("estimation_jobs").get(state.selectedJob),
          )
        : undefined;
      const selected =
        saved?.status === "complete" &&
        saved.scopeKey === scopeKey(scope) &&
        saved.selectionRevision === preferenceRevision
          ? saved
          : null;
      const inputCount = await request(
        tx
          .objectStore("estimation_inputs")
          .index("scope")
          .count(scopeKey(scope)),
      );
      const originalHashProof = await uniformOriginalMethodHash(
        tx,
        scopeKey(scope),
        inputCount,
      );
      const pending = selected
        ? await request(
            tx
              .objectStore("estimation_inputs")
              .index("sequence")
              .count(
                IDBKeyRange.bound(
                  [scopeKey(scope), selected.watermark],
                  [scopeKey(scope), Number.MAX_SAFE_INTEGER],
                  true,
                ),
              ),
          )
        : inputCount;
      return {
        active: active ? publicJob(active) : null,
        selected: selected ? publicJob({ ...selected, pending }) : null,
        pending,
        publicationVersion: state.publicationVersion,
        inputCount,
        uniformOriginalMethodHash: originalHashProof,
        originalEvidenceCurrent:
          (await request(
            tx
              .objectStore("estimation_inputs")
              .index("originalEvidence")
              .count([state.key, 1]),
          )) === inputCount,
      };
    });
  }
  async liveResult(
    scope: Scope,
    attemptId: string,
    methodHash: string,
  ): Promise<{
    input: Extract<EstimationInput, { family: "live" }>;
    result: EstimationEnvelope | null;
  } | null> {
    checkedScope(scope);
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        attemptId,
      )
    )
      throw new Error("payload_rejected");
    return this.transaction("readonly", (tx) =>
      this.liveResultIn(tx, scope, attemptId, methodHash),
    );
  }
  async liveResults(
    scope: Scope,
    attemptIds: string[],
    methodHash: string,
  ): Promise<
    Array<{
      input: Extract<EstimationInput, { family: "live" }>;
      result: EstimationEnvelope | null;
    } | null>
  > {
    checkedScope(scope);
    if (
      !Array.isArray(attemptIds) ||
      attemptIds.length > 200 ||
      attemptIds.some(
        (id) =>
          typeof id !== "string" ||
          !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
            id,
          ),
      )
    )
      throw new Error("payload_rejected");
    if (!attemptIds.length) return [];
    // Each attempt is read independently, so the reads run together in one transaction.
    return this.transaction("readonly", (tx) =>
      Promise.all(
        attemptIds.map((id) => this.liveResultIn(tx, scope, id, methodHash)),
      ),
    );
  }
  private async liveResultIn(
    tx: IDBTransaction,
    scope: Scope,
    attemptId: string,
    methodHash: string,
  ) {
    const row = await this.sourceRow(tx, scope, "live", attemptId);
    if (!row) return null;
    const input = await resolveInput(tx, row);
    if (input?.family !== "live") return null;
    return {
      input,
      result: await this.resultOf(tx, scope, row, input.source, methodHash),
    };
  }
  async liveInput(
    scope: Scope,
    attemptId: string,
  ): Promise<Extract<EstimationInput, { family: "live" }> | null> {
    checkedScope(scope);
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        attemptId,
      )
    )
      throw new Error("payload_rejected");
    return this.transaction("readonly", async (tx) => {
      const row = await this.sourceRow(tx, scope, "live", attemptId);
      if (!row) return null;
      const input = await resolveInput(tx, row);
      return input?.family === "live" ? input : null;
    });
  }
  private async sourceRow(
    tx: IDBTransaction,
    scope: Scope,
    family: "live" | "history",
    id: string,
  ): Promise<InputRow | null> {
    if (!(await localReadMemberAllowed(tx, scope))) return null;
    const stored = await request(
      tx
        .objectStore(family === "live" ? "attempts" : "history_records")
        .get(
          `${scope.namespace}:${family === "live" ? "attempt" : "history"}:${id}`,
        ),
    );
    if (!stored || stored.namespace !== scope.namespace) return null;
    const actualScope = { ...scope, era: stored.era ?? null };
    if (
      !(same(scope, actualScope)
        ? await localReadMemberAllowed(tx, actualScope)
        : await localScopeAllowed(tx, scope, actualScope))
    )
      return null;
    return (
      (await request(
        tx
          .objectStore("estimation_inputs")
          .get(inputKey(actualScope, family, id)),
      )) ?? null
    );
  }
  readPreference() {
    return this.transaction("readonly", (tx) => this.preference(tx));
  }
  async compareAndSetPreference(
    expectedRevision: number | null,
    next: EnginePreferenceRecord,
  ): Promise<boolean> {
    const record = EnginePreferenceRecordSchema.parse(next);
    if (
      (expectedRevision !== null &&
        (!Number.isInteger(expectedRevision) || expectedRevision < 1)) ||
      record.selection_revision !== (expectedRevision ?? 0) + 1
    )
      throw new Error("revision_conflict");
    return this.transaction("readwrite", async (tx) => {
      const old = await this.preferenceState(tx);
      if (old.status === "invalid" || old.revision !== expectedRevision)
        return false;
      await this.writePreference(tx, record);
      return true;
    });
  }
  private async allowed(tx: IDBTransaction, scope: Scope): Promise<boolean> {
    return localMemberAllowed(tx, scope);
  }
  private async active(tx: IDBTransaction, id: string): Promise<JobRow | null> {
    const job: JobRow | undefined = await request(
      tx.objectStore("estimation_jobs").get(id),
    );
    if (!job || job.status !== "running") return null;
    const state = await stateFor(tx, job.scope),
      preferenceRevision = await this.selectionRevision(tx);
    return state.activeJob === id &&
      state.generation === job.generation &&
      job.authority === (await this.authority(tx)) &&
      preferenceRevision === job.selectionRevision &&
      (await this.allowed(tx, job.scope))
      ? job
      : null;
  }
  private async deleteResults(tx: IDBTransaction, jobId: string) {
    await eachCursor(
      tx.objectStore("estimation_results").index("job"),
      IDBKeyRange.only(jobId),
      (row) => {
        tx.objectStore("estimation_results").delete(row.key);
      },
    );
  }
  async start(options: {
    scope: Scope;
    target: EngineMethodIdentity;
    fallbackMethod?: EngineMethodIdentity;
    selectionRevision: number;
  }): Promise<RecalculationJob> {
    const scope = structuredClone(checkedScope(options.scope)),
      target = EngineMethodIdentitySchema.parse(options.target);
    const fallbackMethod = options.fallbackMethod
      ? EngineMethodIdentitySchema.parse(options.fallbackMethod)
      : undefined;
    if (
      fallbackMethod &&
      (target.engine_id !== "ecologits" ||
        fallbackMethod.engine_id !== "original")
    )
      throw new Error("method_update_invalid");
    return this.transaction("readwrite", async (tx) => {
      if (!(await this.allowed(tx, scope)))
        throw new Error("policy_unavailable");
      const preferenceRevision = await this.selectionRevision(tx);
      if (preferenceRevision === null) throw new Error("policy_unavailable");
      if (options.selectionRevision !== preferenceRevision)
        throw new Error("revision_conflict");
      await admitMethodIdentity(tx, target);
      if (fallbackMethod) await admitMethodIdentity(tx, fallbackMethod);
      const state = await stateFor(tx, scope);
      if (state.activeJob) {
        const previous: JobRow | undefined = await request(
          tx.objectStore("estimation_jobs").get(state.activeJob),
        );
        if (
          previous &&
          previous.status === "running" &&
          previous.authority === (await this.authority(tx)) &&
          same(previous.target, target) &&
          same(previous.fallbackMethod ?? null, fallbackMethod ?? null) &&
          previous.selectionRevision === options.selectionRevision
        )
          return publicJob(previous);
      }
      // Retain one published generation and one active generation per ownership scope.
      await eachCursor(
        tx.objectStore("estimation_jobs").index("namespace"),
        IDBKeyRange.only(scope.namespace),
        async (job: JobRow) => {
          if (
            job.scopeKey === scopeKey(scope) &&
            job.id !== state.selectedJob
          ) {
            await this.deleteResults(tx, job.id);
            tx.objectStore("estimation_jobs").delete(job.id);
          }
        },
      );
      const id = crypto.randomUUID();
      const selected: JobRow | undefined = state.selectedJob
        ? await request(
            tx.objectStore("estimation_jobs").get(state.selectedJob),
          )
        : undefined;
      const baseWatermark =
        selected?.status === "complete" &&
        same(selected.target, target) &&
        same(selected.fallbackMethod ?? null, fallbackMethod ?? null)
          ? selected.watermark
          : 0;
      if (
        selected &&
        selected.target.method_hash === target.method_hash &&
        !same(selected.fallbackMethod ?? null, fallbackMethod ?? null)
      )
        await eachCursor(
          tx.objectStore("estimation_results").index("method"),
          IDBKeyRange.only([scopeKey(scope), target.method_hash]),
          (row) => {
            tx.objectStore("estimation_results").delete(row.key);
          },
        );
      const snapshotTotal = await request(
        tx
          .objectStore("estimation_inputs")
          .index("sequence")
          .count(
            IDBKeyRange.bound(
              [scopeKey(scope), baseWatermark],
              [scopeKey(scope), Number.MAX_SAFE_INTEGER],
              true,
            ),
          ),
      );
      const job: JobRow = {
        key: id,
        id,
        namespace: scope.namespace,
        scopeKey: scopeKey(scope),
        scope,
        target,
        ...(fallbackMethod ? { fallbackMethod } : {}),
        selectionRevision: options.selectionRevision,
        generation: state.generation + 1,
        authority: await this.authority(tx),
        status: "running",
        watermark: state.sequence,
        cursor: baseWatermark,
        baseWatermark,
        snapshotTotal,
        processed: 0,
        unavailable: 0,
        pending: 0,
      };
      tx.objectStore("estimation_jobs").put(job);
      tx.objectStore("estimation_state").put({
        ...state,
        generation: job.generation,
        activeJob: id,
      });
      return publicJob(job);
    });
  }
  resume(scope: Scope): Promise<RecalculationJob | null> {
    checkedScope(scope);
    return this.transaction("readonly", async (tx) => {
      const state = await stateFor(tx, scope);
      if (!state.activeJob) return null;
      const job = await this.active(tx, state.activeJob);
      return job ? publicJob(job) : null;
    });
  }
  private async advance(tx: IDBTransaction, job: JobRow) {
    const rows: InputRow[] = await request(
      tx
        .objectStore("estimation_inputs")
        .index("sequence")
        .getAll(
          IDBKeyRange.bound(
            [job.scopeKey, job.cursor],
            [job.scopeKey, job.watermark],
            true,
          ),
          100,
        ),
    );
    for (const row of rows) {
      const result: ResultRow | undefined = await request(
        tx
          .objectStore("estimation_results")
          .get(resultKey(job.target.method_hash, row.key)),
      );
      if (!result || result.sequence !== row.sequence) break;
      job.cursor = row.sequence;
    }
    tx.objectStore("estimation_jobs").put(job);
  }
  async page(jobId: string, limit = 100): Promise<EstimationPage> {
    limitOf(limit);
    return this.transaction("readwrite", async (tx) => {
      const job = await this.active(tx, jobId);
      if (!job) throw new Error("stale_estimation_result");
      if (job.cursor < job.watermark) await this.advance(tx, job);
      const rows: InputRow[] =
        job.cursor < job.watermark
          ? await request(
              tx
                .objectStore("estimation_inputs")
                .index("sequence")
                .getAll(
                  IDBKeyRange.bound(
                    [job.scopeKey, job.cursor],
                    [job.scopeKey, job.watermark],
                    true,
                  ),
                  limit,
                ),
            )
          : [];
      const inputs: EstimationPage["inputs"] = [],
        unavailable: EstimationPage["unavailable"] = [];
      for (const row of rows) {
        const cached: ResultRow | undefined = await request(
          tx
            .objectStore("estimation_results")
            .get(resultKey(job.target.method_hash, row.key)),
        );
        if (cached?.sequence === row.sequence) continue;
        let input,
          reason: "dependency_missing" | "ledger_integrity_failed" =
            "dependency_missing";
        try {
          input = await resolveInput(tx, row);
        } catch {
          reason = "ledger_integrity_failed";
        }
        if (input) {
          if (input.family === "live") {
            const dependencies = [
              ...row.dependencies,
              `${row.namespace}:${input.attempt.request_id}`,
              `${row.namespace}:${input.request.request_id}`,
            ];
            tx.objectStore("estimation_inputs").put({
              ...row,
              dependencies: [...new Set(dependencies)],
            });
          }
          inputs.push(input);
        } else {
          const result: ResultRow = {
            key: resultKey(job.target.method_hash, row.key),
            namespace: row.namespace,
            inputKey: row.key,
            jobId,
            scopeKey: job.scopeKey,
            methodHash: job.target.method_hash,
            sequence: row.sequence,
            result: null,
            reason,
          };
          tx.objectStore("estimation_results").put(result);
          job.processed++;
          job.unavailable++;
          unavailable.push({ key: row.key, sequence: row.sequence, reason });
        }
      }
      if (job.cursor < job.watermark) await this.advance(tx, job);
      else tx.objectStore("estimation_jobs").put(job);
      return {
        job: publicJob(job),
        inputs,
        unavailable,
        done: job.processed === job.snapshotTotal,
      };
    });
  }
  async commitResult(options: {
    jobId: string;
    inputKey: string;
    sequence: number;
    result: EstimationEnvelope;
  }): Promise<"applied" | "duplicate" | "stale"> {
    const result = EstimationEnvelopeSchema.parse(options.result);
    return this.transaction("readwrite", async (tx) => {
      const job = await this.active(tx, options.jobId);
      if (!job) return "stale";
      if (
        result.view !== "recalculated" ||
        result.execution_origin !== "local" ||
        !same(result.requested_method, job.target)
      )
        throw new Error("method_update_invalid");
      if (
        result.effective_method.engine_id === job.target.engine_id &&
        !same(result.effective_method, job.target)
      )
        throw new Error("method_update_invalid");
      const row: InputRow | undefined = await request(
        tx.objectStore("estimation_inputs").get(options.inputKey),
      );
      if (
        !row ||
        row.scopeKey !== job.scopeKey ||
        row.sequence !== options.sequence ||
        row.sequence > job.watermark
      )
        return "stale";
      const input = await resolveInput(tx, row);
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
      await admitMethodIdentity(tx, result.effective_method);
      const key = resultKey(job.target.method_hash, row.key),
        old: ResultRow | undefined = await request(
          tx.objectStore("estimation_results").get(key),
        );
      if (old) {
        if (old.sequence === row.sequence && same(old.result, result))
          return "duplicate";
        throw new Error("revision_conflict");
      }
      tx.objectStore("estimation_results").put({
        key,
        namespace: row.namespace,
        inputKey: row.key,
        jobId: job.id,
        scopeKey: job.scopeKey,
        methodHash: job.target.method_hash,
        sequence: row.sequence,
        result,
      } satisfies ResultRow);
      job.processed++;
      if (result.status === "unavailable") job.unavailable++;
      if (job.cursor < job.watermark) await this.advance(tx, job);
      else tx.objectStore("estimation_jobs").put(job);
      return "applied";
    });
  }
  async markUnavailable(options: {
    jobId: string;
    inputKey: string;
    sequence: number;
    reason: UnavailableReason;
  }): Promise<"applied" | "duplicate" | "stale"> {
    if (
      ![
        "dependency_missing",
        "ledger_integrity_failed",
        "original_method_missing",
        "method_unsupported",
      ].includes(options.reason)
    )
      throw new Error("payload_rejected");
    return this.transaction("readwrite", async (tx) => {
      const job = await this.active(tx, options.jobId);
      if (!job) return "stale";
      const row: InputRow | undefined = await request(
        tx.objectStore("estimation_inputs").get(options.inputKey),
      );
      if (
        !row ||
        row.scopeKey !== job.scopeKey ||
        row.sequence !== options.sequence ||
        row.sequence > job.watermark
      )
        return "stale";
      const key = resultKey(job.target.method_hash, row.key),
        old = await request(tx.objectStore("estimation_results").get(key));
      if (old) {
        if (
          old.sequence === row.sequence &&
          !old.result &&
          old.reason === options.reason
        )
          return "duplicate";
        throw new Error("revision_conflict");
      }
      tx.objectStore("estimation_results").put({
        key,
        namespace: row.namespace,
        inputKey: row.key,
        jobId: job.id,
        scopeKey: job.scopeKey,
        methodHash: job.target.method_hash,
        sequence: row.sequence,
        result: null,
        reason: options.reason,
      } satisfies ResultRow);
      job.processed++;
      job.unavailable++;
      if (job.cursor < job.watermark) await this.advance(tx, job);
      else tx.objectStore("estimation_jobs").put(job);
      return "applied";
    });
  }
  async resultFor(
    scope: Scope,
    source: EstimateObservationSource,
    methodHash: string,
  ): Promise<EstimationEnvelope | null> {
    checkedScope(scope);
    source = EstimateObservationSourceSchema.parse(source);
    return this.transaction("readonly", (tx) =>
      this.resultIn(tx, scope, source, methodHash),
    );
  }
  async resultsFor(
    scope: Scope,
    sources: EstimateObservationSource[],
    methodHash: string,
  ): Promise<Array<EstimationEnvelope | null>> {
    checkedScope(scope);
    if (!Array.isArray(sources) || sources.length > 100)
      throw new Error("payload_rejected");
    const parsed = sources.map((source) =>
      EstimateObservationSourceSchema.parse(source),
    );
    if (!parsed.length) return [];
    // Each source is read independently, so the reads run together in one transaction.
    return this.transaction("readonly", (tx) =>
      Promise.all(
        parsed.map((source) => this.resultIn(tx, scope, source, methodHash)),
      ),
    );
  }
  private async resultIn(
    tx: IDBTransaction,
    scope: Scope,
    source: EstimateObservationSource,
    methodHash: string,
  ): Promise<EstimationEnvelope | null> {
    const row = await this.sourceRow(
      tx,
      scope,
      source.family,
      source.family === "live" ? source.attempt_id : source.message_key,
    );
    if (!row) return null;
    const input = await resolveInput(tx, row);
    if (!input || !same(input.source, source)) return null;
    return this.resultOf(tx, scope, row, source, methodHash);
  }
  /** The result for an input `resultIn` or `liveResult` has resolved and matched to `source`. */
  private async resultOf(
    tx: IDBTransaction,
    scope: Scope,
    row: InputRow,
    source: EstimateObservationSource,
    methodHash: string,
  ): Promise<EstimationEnvelope | null> {
    const key = row.key;
    const state = await stateFor(tx, { ...scope, era: row.era }),
      preferenceRevision = await this.selectionRevision(tx);
    if (state.selectedJob) {
      const selected: JobRow | undefined = await request(
        tx.objectStore("estimation_jobs").get(state.selectedJob),
      );
      if (
        selected?.status === "complete" &&
        selected.target.method_hash === methodHash &&
        selected.selectionRevision === preferenceRevision
      ) {
        const result: ResultRow | undefined = await request(
          tx
            .objectStore("estimation_results")
            .get(resultKey(selected.target.method_hash, key)),
        );
        if (
          result?.sequence === row.sequence &&
          row.sequence <= selected.watermark &&
          result.result &&
          same(result.result.source, source)
        )
          return result.result;
      }
    }
    const original = await request(
      tx
        .objectStore("estimation_originals")
        .get(`${key}:${payloadHash(source)}:${methodHash}`),
    );
    return original ? EstimationEnvelopeSchema.parse(original.result) : null;
  }
  promote(jobId: string): Promise<RecalculationJob> {
    return this.transaction("readwrite", async (tx) => {
      const job = await this.active(tx, jobId);
      if (!job) throw new Error("stale_estimation_result");
      if (
        job.processed !== job.snapshotTotal ||
        (await request(
          tx.objectStore("estimation_results").index("job").count(job.id),
        )) !== job.processed
      )
        throw new Error("recalculation_incomplete");
      const state = await stateFor(tx, job.scope);
      const pending = await request(
        tx
          .objectStore("estimation_inputs")
          .index("sequence")
          .count(
            IDBKeyRange.bound(
              [job.scopeKey, job.watermark],
              [job.scopeKey, Number.MAX_SAFE_INTEGER],
              true,
            ),
          ),
      );
      job.pending = pending;
      job.status = "complete";
      tx.objectStore("estimation_jobs").put(job);
      tx.objectStore("estimation_state").put({
        ...state,
        selectedJob: job.id,
        activeJob: null,
        publicationVersion: state.publicationVersion + 1,
      });
      if (state.selectedJob && state.selectedJob !== job.id) {
        const previous: JobRow | undefined = await request(
          tx.objectStore("estimation_jobs").get(state.selectedJob),
        );
        if (previous && previous.target.method_hash !== job.target.method_hash)
          await eachCursor(
            tx.objectStore("estimation_results").index("method"),
            IDBKeyRange.only([job.scopeKey, previous.target.method_hash]),
            (row) => {
              tx.objectStore("estimation_results").delete(row.key);
            },
          );
        tx.objectStore("estimation_jobs").delete(state.selectedJob);
      }
      return publicJob(job);
    });
  }
  cancel(jobId: string): Promise<void> {
    return this.transaction("readwrite", async (tx) => {
      const job: JobRow | undefined = await request(
        tx.objectStore("estimation_jobs").get(jobId),
      );
      if (!job || job.status === "cancelled") return;
      const state = await stateFor(tx, job.scope);
      job.status = "cancelled";
      tx.objectStore("estimation_jobs").put(job);
      if (
        state.selectedJob === jobId &&
        state.activeJob &&
        state.activeJob !== jobId
      ) {
        const candidate: JobRow | undefined = await request(
          tx.objectStore("estimation_jobs").get(state.activeJob),
        );
        if (candidate?.target.method_hash === job.target.method_hash) {
          tx.objectStore("estimation_jobs").put({
            ...candidate,
            status: "superseded",
          });
          state.activeJob = null;
          state.generation++;
        }
      }
      if (state.selectedJob === jobId)
        await eachCursor(
          tx.objectStore("estimation_results").index("method"),
          IDBKeyRange.only([job.scopeKey, job.target.method_hash]),
          (row) => {
            tx.objectStore("estimation_results").delete(row.key);
          },
        );
      else await this.deleteResults(tx, jobId);
      tx.objectStore("estimation_state").put({
        ...state,
        activeJob: state.activeJob === jobId ? null : state.activeJob,
        selectedJob: state.selectedJob === jobId ? null : state.selectedJob,
        publicationVersion: state.publicationVersion + 1,
      });
    });
  }
  private async overlapsLive(
    tx: IDBTransaction,
    input: import("./estimation-contracts").EstimationInput,
  ): Promise<boolean> {
    return (
      input.family === "history" &&
      (await matchingLiveInput(tx, input.scope, input.history)) !== null
    );
  }
  async viewPage(options: {
    scope: Scope;
    view: "original" | "selected";
    after?: string | null;
    limit?: number;
  }): Promise<{ rows: EstimationViewRow[]; after: string | null }> {
    checkedScope(options.scope);
    const limit = limitOf(options.limit ?? 100),
      prefix = scopeKey(options.scope) + ":";
    if (options.after && !options.after.startsWith(prefix))
      throw new Error("payload_rejected");
    return this.transaction("readonly", async (tx) => {
      if (!(await localReadMemberAllowed(tx, options.scope)))
        return { rows: [], after: null };
      const sourceRows: InputRow[] = await request(
        tx
          .objectStore("estimation_inputs")
          .getAll(
            IDBKeyRange.bound(
              options.after ?? prefix,
              prefix + "\uffff",
              !!options.after,
            ),
            limit,
          ),
      );
      const state = await stateFor(tx, options.scope),
        preferenceRevision = await this.selectionRevision(tx);
      const selected: JobRow | undefined = state.selectedJob
        ? await request(
            tx.objectStore("estimation_jobs").get(state.selectedJob),
          )
        : undefined;
      const rows: EstimationViewRow[] = [];
      const originalAuthority =
        options.scope.mode === "personal"
          ? options.scope
          : ((await readLocalAuthority(tx)).current ?? options.scope);
      for (const row of sourceRows) {
        let input = null;
        try {
          input = await resolveInput(tx, row);
        } catch {}
        const envelope =
          input?.family === "live"
            ? ((
                await originalForLive(tx, originalAuthority, {
                  attemptId: input.attempt.attempt_id,
                  attemptRevision: input.attempt.revision,
                  attemptHash: input.source.attempt_hash,
                })
              )?.result ?? null)
            : input
              ? await originalForSource(tx, row, input.source)
              : null;
        let original: EstimationViewRow["original"] = envelope ?? null;
        if (
          !original &&
          row.family === "history" &&
          input?.family === "history"
        )
          original =
            (
              await request(
                tx
                  .objectStore("history_records")
                  .get(`${row.namespace}:history:${row.id}`),
              )
            )?.originalEstimate ?? null;
        if (
          !original &&
          row.family === "live" &&
          input?.source.family === "live"
        )
          original = await legacyOriginal(tx, row, input.source.attempt_hash);
        const overlay: ResultRow | undefined =
          options.view === "selected" &&
          selected?.status === "complete" &&
          selected.selectionRevision === preferenceRevision
            ? await request(
                tx
                  .objectStore("estimation_results")
                  .get(resultKey(selected.target.method_hash, row.key)),
              )
            : undefined;
        const valid =
          overlay?.sequence === row.sequence &&
          row.sequence <= (selected?.watermark ?? -1) &&
          input &&
          overlay.result &&
          same(overlay.result.source, input.source);
        const contributes = input
          ? !(await this.overlapsLive(tx, input))
          : false;
        rows.push({
          contributes,
          key: row.key,
          sequence: row.sequence,
          input,
          result:
            options.view === "original"
              ? (envelope ?? null)
              : valid
                ? overlay.result
                : null,
          original,
          state: !input
            ? "unavailable"
            : options.view === "original"
              ? "original"
              : valid
                ? "selected"
                : overlay?.sequence === row.sequence &&
                    row.sequence <= (selected?.watermark ?? -1) &&
                    !overlay.result
                  ? "unavailable"
                  : "pending",
        });
      }
      return {
        rows,
        after: sourceRows.length === limit ? sourceRows.at(-1)!.key : null,
      };
    });
  }
}
