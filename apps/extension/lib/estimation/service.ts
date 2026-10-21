import {
  EngineSelectionRequestSchema,
  EngineStatusSchema,
  payloadHash,
  canonicalJson,
  type EngineMethodIdentity,
  type EnginePreferenceRecord,
  type EngineStatus,
  type OrganizationSelectionRequest,
  type OrganizationSelectionResponse,
  type ReasonCode,
  type EstimationEnvelope,
  type AttemptObservation,
  type RequestObservation,
} from "@footprint/contracts";
import {
  EstimationFailure,
  resolveEngineChoice,
  prepareObservation,
  type EstimateExecutor,
  type MethodRegistry,
  type NumericObservationInput,
} from "@footprint/estimator";
import type {
  EstimationInput,
  EstimationRepository,
  RecalculationJob,
  Scope,
} from "@footprint/ledger";
import { localViewState } from "./view-state";

interface Authority {
  scope: Scope;
  token: string;
  current(): Promise<void>;
}
type Repository = EstimationRepository;
type Organization = (
  scope: Scope,
  request?: OrganizationSelectionRequest,
) => Promise<OrganizationSelectionResponse>;
/** What a summary scan hands `scanEstimate` (ScanEstimateContext in summary-scan.ts). */
type ScanEstimateInput = {
  savedResult(
    scope: Scope,
    methodHash: string,
  ): Promise<{
    input: Extract<EstimationInput, { family: "live" }>;
    result: EstimationEnvelope | null;
  } | null>;
  hash(value: object): string;
};
type Selection = {
  preference: EnginePreferenceRecord;
  method: Readonly<EngineMethodIdentity>;
};

function observation(input: EstimationInput): NumericObservationInput {
  return input.family === "history"
    ? { family: "history", record: input.history }
    : {
        family: "live",
        request: input.request,
        attempt: input.attempt,
        ...(input.history === undefined ? {} : { history: input.history }),
        ...(input.source.canonical_request_binding
          ? { canonicalRequestBinding: input.source.canonical_request_binding }
          : {}),
      };
}
/**
 * The input an attempt is estimated from: its saved input when that still holds the same
 * request and attempt, the attempt as observed when nothing is saved for it yet, and
 * nothing when the saved input has changed since the attempt was read.
 */
function savedLiveInput(
  request: RequestObservation,
  attempt: AttemptObservation,
  current: Extract<EstimationInput, { family: "live" }> | null,
  hash: (value: object) => string = payloadHash,
): NumericObservationInput | null {
  if (!current && request.request_id === attempt.request_id)
    return { family: "live", request, attempt };
  if (
    !current ||
    hash(current.attempt) !== hash(attempt) ||
    hash(current.request) !== hash(request)
  )
    return null;
  return observation(current);
}
function operationId(token: string, selection: Selection): string {
  const hash = payloadHash({
    kind: "estimation_selection",
    token,
    revision: selection.preference.selection_revision,
    method: selection.method.method_hash,
  });
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/** Owns selection and resumable work. The executor only receives validated numerical observations. */
export class EngineService {
  private localFlight: Promise<void> | null = null;
  private organizationFlight: Promise<void> | null = null;
  private organizationDirty = false;
  private wake: ReturnType<typeof setTimeout> | null = null;
  private failure: { token: string; reason: EngineStatus["reason"] } | null =
    null;
  private organizationStatus: {
    token: string;
    revision: number;
    value: EngineStatus["organization"];
  } | null = null;
  private disposed = false;
  private sourceCursor = 0;
  private readonly publishedListeners = new Set<() => void>();
  constructor(
    private readonly repository: Repository,
    readonly methods: MethodRegistry,
    readonly executor: EstimateExecutor,
    private readonly authority: () => Promise<Authority>,
    private readonly organization?: Organization,
    private readonly now = () => Date.now(),
  ) {}

  /** Called after a recalculation publishes, when saved totals can change without new usage. */
  onPublished(listener: () => void) {
    this.publishedListeners.add(listener);
    return () => this.publishedListeners.delete(listener);
  }
  dispose() {
    this.disposed = true;
    if (this.wake !== null) clearTimeout(this.wake);
    this.wake = null;
  }
  private async selected(): Promise<Selection> {
    let state = await this.repository.readPreferenceState();
    if (state.status === "invalid") throw new Error("invalid_preference");
    if (state.status === "missing") {
      const initial: EnginePreferenceRecord = {
        schema_version: "1.0.0",
        preference: "build_default",
        selection_revision: 1,
        updated_at: new Date(this.now()).toISOString(),
      };
      if (await this.repository.compareAndSetPreference(null, initial))
        state = {
          status: "valid",
          revision: initial.selection_revision,
          record: initial,
        };
      else state = await this.repository.readPreferenceState();
    }
    if (state.status !== "valid") throw new Error("invalid_preference");
    if (
      state.record.preference === "original" &&
      !this.methods.build.available_engines.some(
        (engine) => engine === "original",
      )
    ) {
      // Retiring a method changes the selection, never the saved observations or original results.
      const next = {
        ...state.record,
        preference: "build_default" as const,
        selection_revision: state.record.selection_revision + 1,
        updated_at: new Date(this.now()).toISOString(),
      };
      state = (await this.repository.compareAndSetPreference(
        state.revision,
        next,
      ))
        ? { status: "valid", revision: next.selection_revision, record: next }
        : await this.repository.readPreferenceState();
      if (state.status !== "valid") throw new Error("invalid_preference");
      this.organizationStatus = null;
    }
    const preference = state.record;
    const choice = resolveEngineChoice(
      this.methods.build.default_engine,
      preference,
      this.methods.build.available_engines,
    );
    if (!preference || choice.status !== "selected")
      throw new Error(
        choice.status === "unavailable" ? choice.reason : "invalid_preference",
      );
    return { preference, method: this.methods[choice.engine] };
  }
  /** The caller stores this identity at the first admission, before counting can yield. */
  async admission(): Promise<Readonly<EngineMethodIdentity>> {
    return (await this.selected()).method;
  }
  async liveInput(
    scope: Scope,
    request: RequestObservation,
    attempt: AttemptObservation,
  ): Promise<NumericObservationInput | null> {
    return savedLiveInput(
      request,
      attempt,
      await this.repository.liveInput(scope, attempt.attempt_id),
    );
  }
  async original(
    input: NumericObservationInput,
    pinnedHash?: string,
  ): Promise<{
    result: Readonly<EstimationEnvelope> | null;
    reason: ReasonCode | null;
  }> {
    prepareObservation(input);
    try {
      const result = await this.executor.estimate(input);
      if (pinnedHash && result.requested_method.method_hash !== pinnedHash)
        return { result: null, reason: "method_update_invalid" };
      return { result, reason: null };
    } catch (error) {
      // Missing old executable code must not prevent the browser from saving numerical observations.
      return {
        result: null,
        reason:
          error instanceof EstimationFailure &&
          error.code === "method_unsupported"
            ? "method_unsupported"
            : "estimate_unavailable",
      };
    }
  }
  /** A new default becomes visible only after publication. Pending work retains an explicitly original view. */
  async view(scope: Scope) {
    const context = await this.authority();
    if (canonicalJson(scope) !== canonicalJson(context.scope))
      throw new Error("policy_unavailable");
    const preferenceState = await this.repository.readPreferenceState();
    if (preferenceState.status === "invalid") {
      const vector = await this.repository.localSelectionState(scope);
      await context.current();
      return {
        view: "original" as const,
        method: null,
        revision: preferenceState.revision,
        jobId: null,
        pending: true,
        token: vector.token,
        guard: { authorityScope: scope, localSelectionToken: vector.token },
        current: async () => {
          await context.current();
          const latest = await this.repository.readPreferenceState();
          if (
            latest.status !== "invalid" ||
            latest.revision !== preferenceState.revision
          )
            throw new Error("selection_conflict");
          if (
            !(await this.repository.localSelectionCurrent(scope, vector.token))
          )
            throw new Error("aggregate_inconsistent");
        },
        estimate: async (_input: NumericObservationInput) => undefined,
        scanEstimate: async (
          _request: RequestObservation,
          _attempt: AttemptObservation,
          _context: ScanEstimateInput,
        ) => undefined,
      };
    }
    const selection = await this.selected();
    const vector = await this.repository.localSelectionState(scope);
    const state = localViewState(
      vector,
      selection.method,
      selection.preference,
    );
    const ready = state.ready && !state.initialOriginal;
    await this.current(context, selection);
    const currentView = async () => {
      await this.current(context, selection);
      if (!(await this.repository.localSelectionCurrent(scope, vector.token)))
        throw new Error("aggregate_inconsistent");
    };
    return {
      view: ready ? ("recalculated" as const) : ("original" as const),
      method: ready ? selection.method : null,
      revision: selection.preference.selection_revision,
      jobId: ready ? vector.token : null,
      pending: state.updating,
      token: vector.token,
      guard: { authorityScope: scope, localSelectionToken: vector.token },
      current: currentView,
      estimate: async (input: NumericObservationInput) => {
        await currentView();
        const resolved =
          input.family === "live" && input.canonicalRequestBinding === undefined
            ? await this.liveInput(scope, input.request, input.attempt)
            : input;
        if (!resolved) return undefined;
        const result = await this.repository.resultFor(
          scope,
          prepareObservation(resolved).source,
          selection.method.method_hash,
        );
        await currentView();
        return result ?? undefined;
      },
      /**
       * `estimate` for a scan of many attempts. The scan supplies the attempt's saved input
       * (read once and shared with its history link) and checks this view once, with
       * `current()` after the whole scan, instead of twice per attempt. Every check reads the
       * whole local selection, which counts all saved inputs, so per attempt it made a long
       * profile's popup take seconds (15 Oct 2026). Every value the token covers only grows
       * (versions, sequences, job generations), so a change during the scan still fails that
       * final check and the caller reads again.
       */
      scanEstimate: async (
        request: RequestObservation,
        attempt: AttemptObservation,
        context: ScanEstimateInput,
      ) => {
        const saved = await context.savedResult(
          scope,
          selection.method.method_hash,
        );
        const resolved = savedLiveInput(
          request,
          attempt,
          saved?.input ?? null,
          context.hash,
        );
        if (!resolved) return undefined;
        const source = prepareObservation(resolved).source;
        // Without a saved input resultFor finds no result either. With one, it answers only
        // for the saved input's own source, which is what `estimate` asks for.
        if (!saved) return undefined;
        return canonicalJson(source) === canonicalJson(saved.input.source)
          ? (saved.result ?? undefined)
          : undefined;
      },
    };
  }
  private async current(context: Authority, selection: Selection) {
    if (this.disposed) throw new Error("policy_unavailable");
    await context.current();
    const latest = await this.selected();
    if (
      latest.preference.selection_revision !==
        selection.preference.selection_revision ||
      latest.method.method_hash !== selection.method.method_hash
    )
      throw new Error("selection_conflict");
  }
  async status(): Promise<EngineStatus> {
    const context = await this.authority();
    const preferenceState = await this.repository.readPreferenceState();
    if (preferenceState.status === "invalid") {
      await context.current();
      return EngineStatusSchema.parse({
        schema_version: "1.0.0",
        scope: context.scope,
        scopeToken: context.token,
        preference: null,
        selectionRevision: preferenceState.revision,
        buildDefault: this.methods.build.default_engine,
        effectiveEngine: null,
        method: null,
        local: {
          status: "failed",
          jobId: null,
          processed: 0,
          unavailable: 0,
          pending: 0,
        },
        organization:
          context.scope.mode === "personal"
            ? { status: "personal", reason: null }
            : { status: "unavailable", reason: "policy_unavailable" },
        reason: "invalid_preference",
      });
    }
    const selection = await this.selected();
    const vector = await this.repository.localSelectionState(context.scope);
    const state = localViewState(
      vector,
      selection.method,
      selection.preference,
    );
    await this.current(context, selection);
    const reason =
      this.failure?.token === context.token
        ? this.failure.reason
        : state.incompleteAuthority
          ? "estimate_unavailable"
          : null;
    const organization =
      context.scope.mode === "personal"
        ? { status: "personal" as const, reason: null }
        : this.organizationStatus?.token === context.token &&
            this.organizationStatus.revision ===
              selection.preference.selection_revision
          ? this.organizationStatus.value
          : { status: "pending" as const, reason: "sync_delayed" as const };
    return EngineStatusSchema.parse({
      schema_version: "1.0.0",
      scope: context.scope,
      scopeToken: context.token,
      preference: selection.preference.preference,
      selectionRevision: selection.preference.selection_revision,
      buildDefault: this.methods.build.default_engine,
      effectiveEngine: selection.method.engine_id,
      method: selection.method,
      local: {
        status: reason
          ? "failed"
          : state.active
            ? "running"
            : state.updating
              ? "pending"
              : "complete",
        jobId: state.active?.id ?? (state.ready ? vector.token : null),
        processed: state.processed,
        unavailable: state.unavailable,
        pending: state.pending,
      },
      organization,
      reason,
    });
  }
  async select(value: unknown): Promise<EngineStatus> {
    const request = EngineSelectionRequestSchema.parse(value);
    if (
      request.preference !== "build_default" &&
      !this.methods.build.available_engines.some(
        (engine) => engine === request.preference,
      )
    )
      throw new Error("engine_unavailable");
    const context = await this.authority();
    await context.current();
    const before = await this.repository.readPreferenceState();
    const next: EnginePreferenceRecord = {
      schema_version: "1.0.0",
      preference: request.preference,
      selection_revision: (request.expectedRevision ?? 0) + 1,
      updated_at: new Date(this.now()).toISOString(),
    };
    const accepted =
      before.status === "invalid"
        ? (await this.repository.repairPreference(
            request.expectedRevision,
            request.preference,
          )) !== null
        : await this.repository.compareAndSetPreference(
            request.expectedRevision,
            next,
          );
    if (!accepted) {
      const result = await this.status();
      return { ...result, reason: "selection_conflict" };
    }
    this.failure = null;
    this.organizationStatus = null;
    await this.ensureJob(context, await this.selected());
    this.kick();
    void this.maintainOrganization();
    return this.status();
  }
  private async ensureJob(
    context: Authority,
    selection: Selection,
    sourceScope: Scope = context.scope,
  ): Promise<RecalculationJob | null> {
    await this.current(context, selection);
    const state = await this.repository.state(sourceScope);
    if (
      !state.active &&
      state.selected?.target.method_hash === selection.method.method_hash &&
      state.selected.selectionRevision ===
        selection.preference.selection_revision &&
      !state.pending
    )
      return null;
    if (
      selection.method.engine_id === "ecologits" &&
      (this.methods.original.method_id !==
        this.methods.ecoDefinition.original_fallback.method_id ||
        this.methods.original.method_hash !==
          this.methods.ecoDefinition.original_fallback.method_hash)
    )
      throw new Error("method_update_invalid");
    await this.current(context, selection);
    return this.repository.start({
      scope: sourceScope,
      target: selection.method,
      selectionRevision: selection.preference.selection_revision,
      ...(selection.method.engine_id === "ecologits"
        ? { fallbackMethod: this.methods.original }
        : {}),
    });
  }
  private kick() {
    if (this.disposed || this.wake !== null) return;
    this.wake = setTimeout(() => {
      this.wake = null;
      void this.maintainLocal();
    }, 16);
  }
  /** At most 128 records per turn. Durable cursors survive worker shutdown and ordinary alarms resume them. */
  maintainLocal(): Promise<void> {
    if (this.localFlight) return this.localFlight;
    this.localFlight = this.runLocal().finally(() => {
      this.localFlight = null;
    });
    return this.localFlight;
  }
  /**
   * Waits for a pass already running, then runs a fresh one, so work committed after
   * that pass started is included. The wait is bounded because a large backlog can
   * take longer than a display should wait; later publications cover the rest.
   */
  async settleLocal(ms: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bounded = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms);
    });
    const work = (async () => {
      await this.localFlight?.catch(() => {});
      await this.maintainLocal();
    })().catch(() => {});
    try {
      await Promise.race([work, bounded]);
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }
  private async runLocal() {
    let context: Authority | null = null;
    try {
      if (this.disposed) return;
      context = await this.authority();
      const selection = await this.selected();
      this.failure = null;
      const deadline = this.now() + 250;
      for (let batch = 0; batch < 4; batch++) {
        await this.current(context, selection);
        const vector = await this.repository.localSelectionState(context.scope);
        if (vector.status === "unavailable")
          throw new Error("policy_unavailable");
        if (
          localViewState(vector, selection.method, selection.preference)
            .initialOriginal
        )
          return;
        const pending = vector.members.filter(
          (member) =>
            (member.inputCount > 0 || member.active) &&
            (member.active ||
              member.pending > 0 ||
              member.selected?.target.method_hash !==
                selection.method.method_hash ||
              member.selected.selectionRevision !==
                selection.preference.selection_revision),
        );
        if (!pending.length) return;
        if (this.executor.executionOrigin !== "local")
          throw new Error("method_unsupported");
        const member = pending[this.sourceCursor++ % pending.length];
        const job = await this.ensureJob(context, selection, member.scope);
        if (!job) continue;
        const page = await this.repository.page(job.id, 32);
        for (const input of page.inputs) {
          await this.current(context, selection);
          if (
            !input.originalMethodHash &&
            input.originalMethodState !== "not_admitted"
          ) {
            await this.repository.markUnavailable({
              jobId: job.id,
              inputKey: input.key,
              sequence: input.sequence,
              reason: "original_method_missing",
            });
            continue;
          }
          try {
            const result = await this.executor.estimate(observation(input), {
              methodId: selection.method.method_id,
              view: "recalculated",
              ...(input.originalMethodHash === null
                ? { originalMethodMissing: true }
                : { originalMethodHash: input.originalMethodHash }),
            });
            if (result.execution_origin !== "local")
              throw new Error("method_update_invalid");
            await this.current(context, selection);
            if (
              (await this.repository.commitResult({
                jobId: job.id,
                inputKey: input.key,
                sequence: input.sequence,
                result,
              })) === "stale"
            )
              throw new Error("stale_estimation_result");
          } catch (error) {
            if (
              !(error instanceof EstimationFailure) ||
              error.code !== "method_unsupported"
            )
              throw error;
            await this.repository.markUnavailable({
              jobId: job.id,
              inputKey: input.key,
              sequence: input.sequence,
              reason: "method_unsupported",
            });
          }
        }
        const next = await this.repository.resume(member.scope);
        if (!next || next.id !== job.id) continue;
        if (next.processed === next.snapshotTotal) {
          await this.current(context, selection);
          await this.repository.promote(job.id);
          for (const listener of this.publishedListeners)
            try {
              listener();
            } catch {}
        }
        if (this.now() >= deadline) break;
      }
      this.kick();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (["selection_conflict", "stale_estimation_result"].includes(message)) {
        this.kick();
        return;
      }
      if (message === "policy_unavailable") return;
      if (context)
        this.failure = { token: context.token, reason: "estimate_unavailable" };
    }
  }
  /** Network work is separate so opening a local dashboard never waits for an organization response. */
  maintainOrganization(): Promise<void> {
    this.organizationDirty = true;
    if (this.organizationFlight) return this.organizationFlight;
    this.organizationFlight = (async () => {
      for (
        let pass = 0;
        pass < 4 && this.organizationDirty && !this.disposed;
        pass++
      ) {
        this.organizationDirty = false;
        await this.runOrganization();
      }
    })().finally(() => {
      this.organizationFlight = null;
    });
    return this.organizationFlight;
  }
  private async runOrganization() {
    let context: Authority | null = null;
    let selection: Selection | null = null;
    try {
      context = await this.authority();
      if (context.scope.mode === "personal") return;
      selection = await this.selected();
      if (!this.organization) throw new Error("policy_unavailable");
      let response = await this.organization(context.scope);
      await this.current(context, selection);
      const remote = response.selection;
      const same =
        remote?.selection_revision ===
          selection.preference.selection_revision &&
        remote.preference === selection.preference.preference &&
        remote.method_id === selection.method.method_id &&
        remote.method_hash === selection.method.method_hash;
      const invalidated = response.recalculation?.status === "invalidated";
      if (
        remote &&
        (!same || invalidated) &&
        remote.selection_revision >= selection.preference.selection_revision
      ) {
        // A changed build or deletion epoch needs a new operation, even when the preference stays the same.
        const next = {
          ...selection.preference,
          selection_revision: selection.preference.selection_revision + 1,
          updated_at: new Date(this.now()).toISOString(),
        };
        if (
          !(await this.repository.compareAndSetPreference(
            selection.preference.selection_revision,
            next,
          ))
        )
          return;
        selection = await this.selected();
        this.kick();
        if (
          remote.selection_revision >= selection.preference.selection_revision
        )
          throw new Error("policy_unavailable");
      }
      if (!same || invalidated) {
        response = await this.organization(context.scope, {
          preference: selection.preference.preference,
          selection_revision: selection.preference.selection_revision,
          method_id: selection.method.method_id,
          method_hash: selection.method.method_hash,
          operation_id: operationId(context.token, selection),
        });
        await this.current(context, selection);
      }
      if (
        !response.selection ||
        response.selection.method_hash !== selection.method.method_hash ||
        response.selection.method_id !== selection.method.method_id ||
        response.selection.selection_revision !==
          selection.preference.selection_revision ||
        response.selection.preference !== selection.preference.preference
      )
        throw new Error("policy_unavailable");
      const value: EngineStatus["organization"] =
        response.compatibility?.status !== "supported"
          ? { status: "unavailable", reason: "method_unsupported" }
          : response.recalculation?.status === "completed"
            ? { status: "current", reason: null }
            : response.recalculation?.status === "invalidated"
              ? { status: "invalidated", reason: "deletion_changed" }
              : { status: "pending", reason: "sync_delayed" };
      this.organizationStatus = {
        token: context.token,
        revision: selection.preference.selection_revision,
        value,
      };
    } catch (error) {
      if (!context || !selection) return;
      const message = error instanceof Error ? error.message : "";
      this.organizationStatus = {
        token: context.token,
        revision: selection.preference.selection_revision,
        value: {
          status: "pending",
          reason:
            message === "auth_reconnect_required"
              ? "auth_reconnect_required"
              : "sync_delayed",
        },
      };
    }
  }
  async resume(): Promise<EngineStatus> {
    this.failure = null;
    await this.maintainLocal();
    void this.maintainOrganization();
    return this.status();
  }
}
