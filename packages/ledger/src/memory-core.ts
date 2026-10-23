import { uniqueLiveHistoryMatch } from "./live-history-link";
import {
  canonicalJson,
  payloadHash,
  parseObservation,
  UNAVAILABLE_ADMISSION_METHOD_ID,
  EstimationEnvelopeSchema,
  EngineMethodIdentitySchema,
  EnginePreferenceRecordSchema,
  SelectionRevisionSchema,
  historyNumericPayloadHash,
  type Observation,
  type EngineMethodIdentity,
  type EstimationEnvelope,
} from "@footprint/contracts";
import type {
  Scope,
  RecordRow,
  OutboxRow,
  HistoryRow,
  DerivedSource,
  DerivedGuard,
  DerivedEntry,
  ThreadRelation,
} from "./ledger-support";
import type {
  TrackingCheckpoint,
  StoredEstimate,
  CachedSummary,
  SummaryVersion,
} from "./repository-contracts";
import type {
  EstimationInput,
  RecalculationJob,
  EnginePreferenceState,
  LocalSelectionState,
  UnavailableReason,
} from "./estimation-contracts";

export const same = (a: unknown, b: unknown) =>
  canonicalJson(a) === canonicalJson(b);
export const clone = <T>(value: T): T => structuredClone(value);
export const recordId = (r: Observation) =>
  r.kind === "request" ? r.request_id : r.attempt_id;
export const recordKey = (
  namespace: string,
  kind: Observation["kind"],
  id: string,
) => `${namespace}:${kind}:${id}`;
export const scopeKey = (scope: Scope) => canonicalJson(scope);
export const inputKey = (
  scope: Scope,
  family: "live" | "history",
  id: string,
) => `${scopeKey(scope)}:${family}:${id}`;
export const rowScope = (row: {
  namespace: string;
  era: string | null;
}): Scope => ({
  namespace: row.namespace,
  mode: row.namespace.startsWith("company:") ? "company" : "personal",
  era: row.era,
});
export function checkedScope(scope: Scope): Scope {
  if (
    !scope ||
    Object.keys(scope).length !== 3 ||
    !["personal", "company"].includes(scope.mode) ||
    !new RegExp(`^${scope.mode}:[a-z0-9:-]{1,160}$`).test(scope.namespace) ||
    (scope.mode === "personal"
      ? scope.era !== null
      : typeof scope.era !== "string" ||
        !/^[A-Za-z0-9:_-]{1,160}$/.test(scope.era))
  )
    throw new Error("policy_unavailable");
  return scope;
}
export function limitOf(limit: number, max = 100) {
  if (!Number.isInteger(limit) || limit < 1 || limit > max)
    throw new Error("payload_rejected");
  return limit;
}
export interface MemoryInput {
  key: string;
  scope: Scope;
  family: "live" | "history";
  id: string;
  sequence: number;
  originalMethodHash?: string;
  originalMethodId?: string;
  originalEvidenceCurrent?: boolean;
  resolvedSourceHash?: string | null;
}
export interface MemoryJob extends RecalculationJob {
  authority: string;
  baseWatermark: number;
}
export interface MemoryResult {
  namespace: string;
  inputKey: string;
  jobId: string;
  sequence: number;
  result: EstimationEnvelope | null;
  reason?: UnavailableReason;
}
export interface MemoryScopeState {
  scope: Scope;
  inputCount: number;
  originalEvidenceCurrentCount: number;
  originalMethodCounts: Map<string, number>;
  sequence: number;
  generation: number;
  publicationVersion: number;
  activeJob: string | null;
  selectedJob: string | null;
}
export interface MemoryState {
  records: Map<string, RecordRow>;
  measurements: Map<string, RecordRow>;
  checkpoints: Map<string, TrackingCheckpoint>;
  estimates: Map<string, StoredEstimate | null>;
  originals: Map<
    string,
    { namespace: string; inputKey: string; result: EstimationEnvelope }
  >;
  legacyOriginals: Map<string, StoredEstimate>;
  outbox: Map<string, OutboxRow>;
  receipts: Map<string, unknown>;
  histories: Map<string, HistoryRow>;
  historyQueue: Map<
    string,
    { row: HistoryRow; era: string | null; deviceId: string }
  >;
  coverage: Map<string, any>;
  inputs: Map<string, MemoryInput>;
  scopeStates: Map<string, MemoryScopeState>;
  jobs: Map<string, MemoryJob>;
  results: Map<string, MemoryResult>;
  methods: Map<string, EngineMethodIdentity>;
  preference: unknown;
  preferenceFloor: number;
  session: Record<string, any>;
  catalogs: Map<string, any>;
  health: Map<string, any>;
  modelLabels: Map<string, any>;
  coworkCheckpoints: Map<string, any>;
  threads: Map<string, ThreadRelation>;
  threadCursors: Map<
    string,
    {
      erasureVersion: number;
      after: { at: number; key: string } | null;
      end: { at: number; key: string };
    }
  >;
  epochs: Map<string, SummaryVersion>;
  summaries: Map<string, CachedSummary>;
  context: Map<string, DerivedEntry<any>>;
  guidance: Map<string, DerivedEntry<any>>;
  monthly: Map<string, string>;
  erasedNamespaces: Set<string>;
  /** Organization namespaces a full Personal erase flagged; see flagOrganizationMarkers. */
  releasableNamespaces: Set<string>;
  erasedRequests: Set<string>;
  erasedAttempts: Set<string>;
  /** As the IndexedDB markers: when the erasure was applied; see erasedWhenRead. */
  erasedHistory: Map<string, { at: number; refused?: true }>;
  erasedProvider: Map<string, { at: number }>;
  ranges: Array<{
    scope: Scope;
    start: string | null;
    end: string | null;
    epoch: number;
    retention: boolean;
    at: number;
  }>;
}
export function newState(): MemoryState {
  return {
    records: new Map(),
    measurements: new Map(),
    checkpoints: new Map(),
    estimates: new Map(),
    originals: new Map(),
    legacyOriginals: new Map(),
    outbox: new Map(),
    receipts: new Map(),
    histories: new Map(),
    historyQueue: new Map(),
    coverage: new Map(),
    inputs: new Map(),
    scopeStates: new Map(),
    jobs: new Map(),
    results: new Map(),
    methods: new Map(),
    preference: null,
    preferenceFloor: 0,
    session: {},
    catalogs: new Map(),
    health: new Map(),
    modelLabels: new Map(),
    coworkCheckpoints: new Map(),
    threads: new Map(),
    threadCursors: new Map(),
    epochs: new Map(),
    summaries: new Map(),
    context: new Map(),
    guidance: new Map(),
    monthly: new Map(),
    erasedNamespaces: new Set(),
    releasableNamespaces: new Set(),
    erasedRequests: new Set(),
    erasedAttempts: new Set(),
    erasedHistory: new Map(),
    erasedProvider: new Map(),
    ranges: [],
  };
}
export interface MemoryOptions {
  now?: () => number;
  id?: () => string;
  beforeCommit?: (operation: string) => void | Promise<void>;
}
/** Reads queue behind mutations; staged state becomes visible only after the failpoint succeeds. */
export class MemoryKernel {
  private state = newState();
  private tail: Promise<void> = Promise.resolve();
  readonly now: () => number;
  readonly id: () => string;
  readonly routingListeners = new Set<() => void>();
  readonly healthListeners = new Set<
    (namespace: string, code: any, error: unknown) => void
  >();
  readonly healthResolvedListeners = new Set<
    (namespace: string, codes: readonly any[]) => void
  >();
  constructor(private readonly options: MemoryOptions) {
    this.now = options.now ?? Date.now;
    this.id = options.id ?? (() => crypto.randomUUID());
  }
  read<T>(read: (s: MemoryState) => T): Promise<T> {
    return this.tail.then(() => clone(read(clone(this.state))));
  }
  mutate<T>(
    operation: string,
    update: (s: MemoryState) => T | Promise<T>,
    validate?: (s: MemoryState) => void,
  ): Promise<T> {
    const run = this.tail.then(async () => {
      const staged = clone(this.state);
      const result = await update(staged);
      await this.options.beforeCommit?.(operation);
      validate?.(staged);
      this.state = staged;
      return clone(result);
    });
    this.tail = run.then(
      () => {},
      () => {},
    );
    return run;
  }
}
export function epoch(s: MemoryState, namespace: string): SummaryVersion {
  return (
    s.epochs.get(namespace) ?? {
      version: 0,
      erasureVersion: 0,
      threadRejectionVersion: 0,
    }
  );
}
export function invalidate(
  s: MemoryState,
  namespace: string,
  purge = false,
  thread = false,
) {
  const old = epoch(s, namespace);
  s.epochs.set(namespace, {
    version: old.version + 1,
    erasureVersion: old.erasureVersion + (purge ? 1 : 0),
    threadRejectionVersion: purge
      ? 0
      : old.threadRejectionVersion + (thread ? 1 : 0),
  });
  for (const [key, row] of s.summaries)
    if (row.namespace === namespace) {
      if (purge) s.summaries.delete(key);
      else row.dirty = true;
    }
  if (purge)
    for (const state of s.scopeStates.values())
      if (state.scope.namespace === namespace) {
        if (state.activeJob) {
          const job = s.jobs.get(state.activeJob);
          if (job) job.status = "superseded";
          for (const [key, r] of s.results)
            if (r.jobId === state.activeJob) s.results.delete(key);
        }
        state.activeJob = null;
        state.generation++;
        state.publicationVersion++;
        if (![...s.inputs.values()].some((i) => same(i.scope, state.scope)))
          state.selectedJob = null;
      }
}
export function routing(s: MemoryState) {
  return {
    credentials: s.session.credentials,
    personal: s.session.personal,
    ownership: s.session.ownership?.eras?.at(-1) ?? null,
  };
}
export function historyAuthority(s: MemoryState) {
  const r = routing(s);
  return payloadHash({
    ownership: r.ownership ?? null,
    device: r.credentials?.device_id ?? null,
    namespace: r.credentials?.namespace ?? r.personal?.namespace ?? null,
    era: r.credentials?.enrollment_era?.id ?? null,
    status: r.credentials?.enrollment_state ?? null,
  });
}
export function methodTrust(s: MemoryState) {
  const c = s.session.credentials;
  return canonicalJson({
    namespace: c?.namespace ?? null,
    origin: c?.origin ?? null,
    device: c?.device_id ?? null,
    era: c?.enrollment_era?.id ?? null,
    publicKey: c?.method_public_key ?? null,
    state: c?.enrollment_state ?? "active",
  });
}
export function authority(s: MemoryState) {
  const eras: any[] = s.session.ownership?.eras ?? [],
    c = s.session.credentials,
    p = s.session.personal;
  const valid = (era: any) => {
    try {
      checkedScope(era.scope);
      return (
        Number.isFinite(era.start) &&
        (era.end === null || (Number.isFinite(era.end) && era.end >= era.start))
      );
    } catch {
      return false;
    }
  };
  const last = eras.at(-1);
  let current: Scope | null =
    valid(last) && last.end === null ? last.scope : null;
  if (
    current?.mode === "company" &&
    (!c ||
      c.namespace !== current.namespace ||
      c.enrollment_era?.id !== current.era ||
      !c.device_id ||
      (c.enrollment_state !== undefined && c.enrollment_state !== "active"))
  )
    current = null;
  if (current?.mode === "personal" && p?.namespace !== current.namespace)
    current = null;
  const personal: Scope | null =
    p &&
    eras.some(
      (e) =>
        valid(e) &&
        e.scope.namespace === p.namespace &&
        e.scope.mode === "personal",
    )
      ? { namespace: p.namespace, mode: "personal", era: null }
      : null;
  const grants = new Map<string, Scope>();
  if (current)
    for (const e of eras)
      if (
        valid(e) &&
        e.scope.namespace === current.namespace &&
        e.scope.mode === current.mode
      )
        grants.set(scopeKey(e.scope), e.scope);
  const fingerprint = payloadHash({
    eras,
    personal: p
      ? { namespace: p.namespace ?? null, secret: p.secret ?? null }
      : null,
    credentials: c
      ? {
          namespace: c.namespace ?? null,
          device: c.device_id ?? null,
          era: c.enrollment_era ?? null,
          status: c.enrollment_state ?? null,
          origin: c.origin ?? null,
          methodKey: c.method_public_key ?? null,
          deletionKey: c.deletion_public_key ?? null,
          hmac: c.user_hmac_key ?? null,
        }
      : null,
  });
  return {
    current,
    personal,
    grants,
    fingerprint,
    legacy: !s.session.ownership && !c && !p,
  };
}
export function allowed(s: MemoryState, scope: Scope, read = false): boolean {
  try {
    checkedScope(scope);
  } catch {
    return false;
  }
  if (s.erasedNamespaces.has(scope.namespace)) return false;
  const a = authority(s);
  return (
    a.legacy ||
    a.grants.has(scopeKey(scope)) ||
    (read && !!a.personal && same(a.personal, scope))
  );
}
export function scopedRead(s: MemoryState, from: Scope, to: Scope): boolean {
  const a = authority(s);
  return (
    allowed(s, to, true) &&
    (a.legacy
      ? same(from, to)
      : (!!a.current && same(from, a.current) && a.grants.has(scopeKey(to))) ||
        (!!a.personal && same(from, a.personal) && same(from, to)))
  );
}
export function preferenceState(s: MemoryState): EnginePreferenceState {
  if (s.preference === null) return { status: "missing", revision: null };
  const p = EnginePreferenceRecordSchema.safeParse(s.preference);
  if (p.success)
    return {
      status: "valid",
      revision: p.data.selection_revision,
      record: p.data,
    };
  const r = SelectionRevisionSchema.safeParse(
    (s.preference as any)?.selection_revision,
  );
  return { status: "invalid", revision: r.success ? r.data : null };
}
export function selectionRevision(s: MemoryState) {
  const p = preferenceState(s);
  return p.status === "missing" ? 1 : p.status === "valid" ? p.revision : null;
}
export function stateFor(s: MemoryState, scope: Scope): MemoryScopeState {
  const key = scopeKey(scope);
  let row = s.scopeStates.get(key);
  if (!row) {
    row = {
      scope,
      inputCount: 0,
      originalEvidenceCurrentCount: 0,
      originalMethodCounts: new Map(),
      sequence: 0,
      generation: 0,
      publicationVersion: 0,
      activeJob: null,
      selectedJob: null,
    };
    s.scopeStates.set(key, row);
  }
  return row;
}
/** Unknown pins count as inputs, so one known bucket alone cannot prove uniformity. */
export function uniformOriginalMethodHash(
  state: MemoryScopeState,
): string | null {
  if (state.inputCount === 0 || state.originalMethodCounts.size !== 1)
    return null;
  const [hash, count] = state.originalMethodCounts.entries().next().value!;
  return count === state.inputCount ? hash : null;
}
function changeOriginalMethodCount(
  state: MemoryScopeState,
  hash: string,
  delta: 1 | -1,
): void {
  const count = (state.originalMethodCounts.get(hash) ?? 0) + delta;
  if (count < 0) throw new Error("ledger_integrity_failed");
  if (count === 0) state.originalMethodCounts.delete(hash);
  else state.originalMethodCounts.set(hash, count);
}
export function publicJob(job: MemoryJob): RecalculationJob {
  const { authority: _, baseWatermark: __, ...value } = job;
  return value;
}
export function active(s: MemoryState, id: string): MemoryJob | null {
  const j = s.jobs.get(id);
  if (!j || j.status !== "running") return null;
  const st = stateFor(s, j.scope);
  return st.activeJob === id &&
    st.generation === j.generation &&
    j.authority === authority(s).fingerprint &&
    j.selectionRevision === selectionRevision(s) &&
    allowed(s, j.scope)
    ? j
    : null;
}
export function sourceCurrent(
  s: MemoryState,
  namespace: string,
  source?: DerivedSource,
): boolean {
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
  if (s.erasedNamespaces.has(namespace)) return false;
  const r = s.records.get(recordKey(namespace, "request", source.requestId)),
    a = s.records.get(recordKey(namespace, "attempt", source.attemptId));
  return (
    !!r &&
    !!a &&
    !r.aliasOf &&
    !a.aliasOf &&
    r.era === a.era &&
    r.record.kind === "request" &&
    a.record.kind === "attempt" &&
    r.record.revision === source.requestRevision &&
    r.hash === source.requestHash &&
    a.record.revision === source.attemptRevision &&
    a.hash === source.attemptHash &&
    a.record.request_id === source.requestId
  );
}
export function guardCurrent(
  s: MemoryState,
  namespace: string,
  g: DerivedGuard,
) {
  if (
    s.erasedNamespaces.has(namespace) ||
    epoch(s, namespace).erasureVersion !== g.erasureVersion ||
    g.dependencies.length > 2 ||
    !g.dependencies.every((d) => sourceCurrent(s, namespace, d))
  )
    return false;
  return true;
}
export function sourceFollows(
  s: MemoryState,
  namespace: string,
  next: DerivedSource,
  previous: DerivedSource,
): boolean {
  const nr = s.records.get(recordKey(namespace, "request", next.requestId));
  const pr = s.records.get(recordKey(namespace, "request", previous.requestId));
  const na = s.records.get(recordKey(namespace, "attempt", next.attemptId));
  const pa = s.records.get(recordKey(namespace, "attempt", previous.attemptId));
  if (
    !nr ||
    !pr ||
    !na ||
    !pa ||
    nr.record.kind !== "request" ||
    pr.record.kind !== "request" ||
    na.record.kind !== "attempt" ||
    pa.record.kind !== "attempt"
  )
    return false;
  if (next.requestId !== previous.requestId)
    return nr.record.dispatched_at > pr.record.dispatched_at;
  if (next.attemptId !== previous.attemptId)
    return na.record.started_at > pa.record.started_at;
  return (
    next.requestRevision >= previous.requestRevision &&
    next.attemptRevision >= previous.attemptRevision
  );
}
export function resolveRequest(
  s: MemoryState,
  namespace: string,
  id: string,
  era: string | null,
): (RecordRow & { record: Extract<Observation, { kind: "request" }> }) | null {
  const seen = new Set<string>();
  for (let depth = 0; depth < 64; depth++) {
    if (seen.has(id) || s.erasedRequests.has(`${namespace}:${id}`)) return null;
    seen.add(id);
    const row = s.records.get(recordKey(namespace, "request", id));
    if (!row || row.era !== era || row.record.kind !== "request") return null;
    if (
      row.namespace !== namespace ||
      row.record.request_id !== id ||
      payloadHash(parseObservation(row.record)) !== row.hash
    )
      throw new Error("ledger_integrity_failed");
    if (
      s.ranges.some(
        (r) =>
          r.scope.namespace === namespace &&
          (!r.start ||
            (row.record.kind === "request" &&
              row.record.dispatched_at >= r.start)) &&
          (!r.end ||
            (row.record.kind === "request" &&
              row.record.dispatched_at < r.end)),
      )
    )
      return null;
    if (row.aliasOf) {
      id = row.aliasOf;
      continue;
    }
    return row as RecordRow & {
      record: Extract<Observation, { kind: "request" }>;
    };
  }
  return null;
}
export function resolveInput(
  s: MemoryState,
  row: MemoryInput,
  includeHistory = true,
  allowAlias = false,
  observedRequestSource = false,
): EstimationInput | null {
  if (s.erasedNamespaces.has(row.scope.namespace)) return null;
  const common = { key: row.key, scope: row.scope, sequence: row.sequence };
  if (row.family === "history") {
    const h = s.histories.get(`${row.scope.namespace}:history:${row.id}`);
    if (
      !h ||
      h.era !== row.scope.era ||
      h.status === "conflict" ||
      h.record.role !== "response"
    )
      return null;
    if (h.hash !== historyNumericPayloadHash(h.record))
      throw new Error("ledger_integrity_failed");
    return {
      ...common,
      family: "history",
      source: {
        family: "history",
        message_key: row.id,
        observation_hash: h.hash,
      },
      history: h.record,
      originalMethodHash: h.original.proposed_method_hash,
      originalMethodState: "recorded",
    };
  }
  const a = s.records.get(recordKey(row.scope.namespace, "attempt", row.id));
  if (
    !a ||
    (a.aliasOf && !allowAlias) ||
    a.era !== row.scope.era ||
    a.record.kind !== "attempt" ||
    s.erasedAttempts.has(`${row.scope.namespace}:${row.id}`)
  )
    return null;
  let r = resolveRequest(s, row.scope.namespace, a.record.request_id, a.era);
  if (!r) return null;
  if (observedRequestSource) {
    const observed = s.records.get(
      recordKey(row.scope.namespace, "request", a.record.request_id),
    );
    if (
      !observed ||
      observed.era !== a.era ||
      observed.namespace !== row.scope.namespace ||
      observed.record.kind !== "request"
    )
      return null;
    r = observed as RecordRow & {
      record: Extract<Observation, { kind: "request" }>;
    };
  }
  if (
    payloadHash(parseObservation(a.record)) !== a.hash ||
    payloadHash(parseObservation(r.record)) !== r.hash
  )
    throw new Error("ledger_integrity_failed");
  const legacy = legacyOriginal(s, row);
  const hash = row.originalMethodHash ?? legacy?.method_hash ?? null,
    id = row.originalMethodId ?? legacy?.method_id ?? null;
  const originalMethodHash =
    a.record.proposed_method_id && id && a.record.proposed_method_id !== id
      ? null
      : hash;
  const revisions = [...s.measurements.values()].filter(
    (v) =>
      v.namespace === row.scope.namespace &&
      v.record.kind === "attempt" &&
      v.record.attempt_id === row.id,
  );
  const unadmitted =
    a.record.proposed_method_id === UNAVAILABLE_ADMISSION_METHOD_ID &&
    !hash &&
    !id &&
    !legacy &&
    ![...s.originals.values()].some((o) => o.inputKey === row.key) &&
    s.estimates.get(`${row.scope.namespace}:${row.id}`) == null &&
    revisions.length > 0 &&
    revisions.every(
      (v) =>
        v.record.kind === "attempt" &&
        v.record.proposed_method_id === UNAVAILABLE_ADMISSION_METHOD_ID,
    );
  const linked = includeHistory
    ? linkedHistory(
        s,
        row.scope,
        a.record.attempt_id,
        a.record.provider_attempt_key,
      )
    : null;
  return {
    ...common,
    family: "live",
    request: r.record,
    attempt: a.record,
    ...(linked ? { history: linked.record } : {}),
    originalMethodHash,
    originalMethodState: originalMethodHash
      ? "recorded"
      : unadmitted
        ? "not_admitted"
        : "unavailable",
    source: {
      family: "live",
      request_id: r.record.request_id,
      request_revision: r.record.revision,
      request_hash: r.hash,
      attempt_id: a.record.attempt_id,
      attempt_revision: a.record.revision,
      attempt_hash: a.hash,
      ...(linked
        ? {
            history_binding: {
              message_key: linked.record.message_key,
              observation_hash: linked.hash,
            },
          }
        : {}),
      ...(r.record.request_id !== a.record.request_id
        ? {
            canonical_request_binding: {
              observed_request_id: a.record.request_id,
              canonical_request_id: r.record.request_id,
              relation_hash: payloadHash({
                kind: "canonical_request_alias",
                observed_request_id: a.record.request_id,
                canonical_request_id: r.record.request_id,
              }),
            },
          }
        : {}),
    },
  };
}
export function matchingLiveInput(
  s: MemoryState,
  scope: Scope,
  history: import("@footprint/contracts").HistoryMessage,
): {
  request: import("@footprint/contracts").RequestObservation;
  attempt?: import("@footprint/contracts").AttemptObservation;
  input?: Extract<EstimationInput, { family: "live" }>;
} | null {
  if (!allowed(s, scope, true)) return null;
  if (history.role === "prompt" && !history.provider_request_key) {
    const matches = new Map<
      string,
      { request: import("@footprint/contracts").RequestObservation }
    >();
    for (const row of s.histories.values()) {
      if (
        row.namespace !== scope.namespace ||
        row.status !== "current" ||
        row.record.role !== "response" ||
        row.record.prompt_key !== history.message_key ||
        row.record.conversation_key !== history.conversation_key ||
        !allowed(s, rowScope(row), true)
      )
        continue;
      if (historyNumericPayloadHash(row.record) !== row.hash)
        throw new Error("ledger_integrity_failed");
      const match = matchingLiveInput(s, scope, row.record);
      if (match && ["send", "edit_and_send"].includes(match.request.action))
        matches.set(match.request.request_id, { request: match.request });
    }
    return matches.size === 1 ? [...matches.values()][0]! : null;
  }
  if (history.role === "response" && history.provider_attempt_key) {
    const overlaps = [...s.histories.values()].filter(
      (row) =>
        row.namespace === scope.namespace &&
        row.status === "current" &&
        row.record.role === "response" &&
        row.record.provider_attempt_key === history.provider_attempt_key &&
        row.record.site === history.site &&
        row.record.conversation_key === history.conversation_key &&
        allowed(s, rowScope(row), true),
    );
    if (overlaps.length > 1) return null;
  }
  const candidates: Array<{
    request: import("@footprint/contracts").RequestObservation;
    attempt?: import("@footprint/contracts").AttemptObservation;
    input?: Extract<EstimationInput, { family: "live" }>;
  }> = [];
  for (const stored of s.records.values()) {
    if (
      stored.namespace !== scope.namespace ||
      stored.aliasOf ||
      !allowed(s, rowScope(stored), true)
    )
      continue;
    if (history.role === "prompt" && stored.record.kind === "request") {
      const parent = resolveRequest(
        s,
        scope.namespace,
        stored.record.request_id,
        stored.era,
      );
      if (parent) candidates.push({ request: parent.record });
    } else if (
      history.role === "response" &&
      stored.record.kind === "attempt"
    ) {
      const row = s.inputs.get(
        inputKey(rowScope(stored), "live", stored.record.attempt_id),
      );
      const live = row ? resolveInput(s, row, false) : null;
      if (live?.family === "live")
        candidates.push({
          request: live.request,
          attempt: live.attempt,
          input: live,
        });
    }
  }
  return uniqueLiveHistoryMatch(history, candidates);
}
function linkedHistory(
  s: MemoryState,
  scope: Scope,
  attemptId: string,
  providerKey: string | null,
): HistoryRow | null {
  if (!providerKey || !allowed(s, scope, true)) return null;
  const rows = [...s.histories.values()].filter(
    (h) =>
      h.namespace === scope.namespace &&
      h.status === "current" &&
      h.record.role === "response" &&
      h.record.provider_attempt_key === providerKey &&
      allowed(s, rowScope(h), true),
  );
  const matches = rows.filter((h) => {
    if (h.hash !== historyNumericPayloadHash(h.record))
      throw new Error("ledger_integrity_failed");
    return (
      matchingLiveInput(s, scope, h.record)?.attempt?.attempt_id === attemptId
    );
  });
  return matches.length === 1 ? matches[0]! : null;
}
export function touchHistoryLinks(
  s: MemoryState,
  scope: Scope,
  history: import("@footprint/contracts").HistoryMessage,
) {
  if (!history.provider_attempt_key) return;
  for (const row of s.records.values())
    if (
      row.namespace === scope.namespace &&
      !row.aliasOf &&
      row.record.kind === "attempt" &&
      row.record.provider_attempt_key === history.provider_attempt_key
    )
      touch(s, rowScope(row), "live", row.record.attempt_id);
}
export function legacyOriginal(
  s: MemoryState,
  row: MemoryInput,
  attemptHash?: string,
): ReturnType<
  typeof import("@footprint/contracts").OriginalEstimateResultSchema.parse
> | null {
  let chosen: ReturnType<
    typeof import("@footprint/contracts").OriginalEstimateResultSchema.parse
  > | null = null;
  for (const [key, value] of s.legacyOriginals) {
    if (
      !key.startsWith(`${row.scope.namespace}:${row.id}:`) ||
      value.schema_version === "3.0.0" ||
      value.view !== "original" ||
      (attemptHash && value.observation_hash !== attemptHash)
    )
      continue;
    const measurement = s.measurements.get(
      `${recordKey(row.scope.namespace, "attempt", row.id)}:${value.observation_revision}`,
    );
    if (
      !measurement ||
      measurement.era !== row.scope.era ||
      measurement.record.kind !== "attempt" ||
      measurement.hash !== value.observation_hash ||
      payloadHash(measurement.record) !== measurement.hash ||
      (measurement.record.proposed_method_id &&
        measurement.record.proposed_method_id !== value.method_id)
    )
      continue;
    if (
      chosen &&
      (chosen.method_hash !== value.method_hash ||
        chosen.method_id !== value.method_id)
    )
      return null;
    if (!chosen || value.observation_revision < chosen.observation_revision)
      chosen = value;
  }
  return chosen;
}
export function touch(
  s: MemoryState,
  scope: Scope,
  family: "live" | "history",
  id: string,
  remove = false,
  eraseOriginals = true,
) {
  const key = inputKey(scope, family, id),
    old = s.inputs.get(key),
    state = stateFor(s, scope);
  const pin = old?.originalMethodHash
    ? old
    : remove
      ? {}
      : archivedOriginalPin(s, key);
  const results = [...s.results.entries()].filter(
    ([, r]) => r.inputKey === key,
  );
  for (const [key] of results) s.results.delete(key);
  for (const jobId of new Set([state.activeJob, state.selectedJob])) {
    const j = jobId ? s.jobs.get(jobId) : null;
    if (
      j &&
      old &&
      old.sequence > j.baseWatermark &&
      old.sequence <= j.watermark
    ) {
      j.snapshotTotal--;
      const r = results.find(([, v]) => v.jobId === j.id)?.[1];
      if (r) {
        j.processed--;
        if (!r.result || r.result.status === "unavailable") j.unavailable--;
      }
    }
  }
  if (old?.originalEvidenceCurrent) state.originalEvidenceCurrentCount--;
  if (remove) {
    if (old) {
      state.inputCount--;
      if (old.originalMethodHash)
        changeOriginalMethodCount(state, old.originalMethodHash, -1);
    }
    s.inputs.delete(key);
    if (eraseOriginals)
      for (const [k, r] of s.originals)
        if (r.inputKey === key) s.originals.delete(k);
  } else {
    if (!old) {
      state.inputCount++;
      if (pin.originalMethodHash)
        changeOriginalMethodCount(state, pin.originalMethodHash, 1);
    }
    s.inputs.set(key, {
      key,
      scope,
      family,
      id,
      sequence: ++state.sequence,
      ...(pin?.originalMethodHash
        ? {
            originalMethodHash: pin.originalMethodHash,
            originalMethodId: pin.originalMethodId,
          }
        : {}),
    });
    refreshOriginalEvidence(s, key);
  }
}
export function touchObservation(
  s: MemoryState,
  scope: Scope,
  record: Observation,
) {
  if (record.kind === "attempt") {
    const row = s.records.get(
      recordKey(scope.namespace, "attempt", record.attempt_id),
    );
    touch(s, scope, "live", record.attempt_id, !!row?.aliasOf, false);
    return;
  }
  for (const row of s.records.values())
    if (
      row.namespace === scope.namespace &&
      row.era === scope.era &&
      row.record.kind === "attempt" &&
      !row.aliasOf
    ) {
      let id = row.record.request_id;
      const seen = new Set<string>();
      while (!seen.has(id)) {
        if (id === record.request_id) {
          touch(s, scope, "live", row.record.attempt_id);
          break;
        }
        seen.add(id);
        const p = s.records.get(recordKey(scope.namespace, "request", id));
        if (!p?.aliasOf) break;
        id = p.aliasOf;
      }
    }
}
export function admitMethod(s: MemoryState, value: EngineMethodIdentity) {
  const m = EngineMethodIdentitySchema.parse(value);
  for (const key of [`id:${m.method_id}`, `hash:${m.method_hash}`]) {
    const old = s.methods.get(key);
    if (old && !same(old, m)) throw new Error("method_update_invalid");
    s.methods.set(key, m);
  }
}
export function storeOriginal(s: MemoryState, scope: Scope, value: unknown) {
  const result = EstimationEnvelopeSchema.parse(value);
  if (result.view !== "original") throw new Error("payload_rejected");
  const key = inputKey(
      scope,
      result.source.family,
      result.source.family === "live"
        ? result.source.attempt_id
        : result.source.message_key,
    ),
    attemptRow =
      result.source.family === "live"
        ? s.records.get(
            recordKey(scope.namespace, "attempt", result.source.attempt_id),
          )
        : undefined,
    row =
      s.inputs.get(key) ??
      (attemptRow?.aliasOf && attemptRow.era === scope.era
        ? {
            key,
            scope,
            family: "live" as const,
            id: result.source.family === "live" ? result.source.attempt_id : "",
            sequence: 0,
            ...archivedOriginalPin(s, key),
          }
        : undefined),
    input = row
      ? resolveInput(
          s,
          row,
          result.source.family !== "live" || !!result.source.history_binding,
          true,
          result.source.family === "live" &&
            result.source.canonical_request_binding === undefined &&
            result.source.history_binding === undefined &&
            attemptRow?.record.kind === "attempt" &&
            result.source.request_id === attemptRow.record.request_id,
        )
      : null;
  if (!input || !same(input.source, result.source))
    throw new Error("stale_estimation_result");
  const pinHash = row!.originalMethodHash ?? input.originalMethodHash,
    pinId =
      row!.originalMethodId ??
      (input.family === "history"
        ? input.history.proposed_method_id
        : input.attempt.proposed_method_id);
  if (
    (pinHash && pinHash !== result.requested_method.method_hash) ||
    (pinId && pinId !== result.requested_method.method_id)
  )
    throw new Error("method_admission_conflict");
  admitMethod(s, result.requested_method);
  admitMethod(s, result.effective_method);
  if (!row!.originalMethodHash && !attemptRow?.aliasOf) {
    touch(s, scope, row!.family, row!.id);
    const latest = s.inputs.get(key)!;
    latest.originalMethodHash = result.requested_method.method_hash;
    latest.originalMethodId = result.requested_method.method_id;
    changeOriginalMethodCount(stateFor(s, scope), latest.originalMethodHash, 1);
  }
  const k = `${key}:${payloadHash(result.source)}:${result.requested_method.method_hash}`,
    old = s.originals.get(k);
  if (old && !same(old.result, result)) throw new Error("revision_conflict");
  s.originals.set(k, { namespace: scope.namespace, inputKey: key, result });
  if (attemptRow?.aliasOf) touch(s, scope, "live", row!.id, true, false);
  else refreshOriginalEvidence(s, key);
}
export function localSelection(
  s: MemoryState,
  scope: Scope,
): LocalSelectionState {
  checkedScope(scope);
  const a = authority(s),
    p = preferenceState(s);
  const current = !!a.current && same(a.current, scope),
    personal = !!a.personal && same(a.personal, scope);
  if ((!current && !personal) || s.erasedNamespaces.has(scope.namespace))
    return {
      execution: "local_only",
      authorityScope: scope,
      status: "unavailable",
      members: [],
      unprovableCount: 0,
      scopeLimitExceeded: false,
      token: payloadHash({
        authority: a.fingerprint,
        scope,
        preference: p,
        unavailable: true,
      }),
    };
  const grants = current ? a.grants : new Map([[scopeKey(scope), scope]]),
    scopes = new Map([[scopeKey(scope), scope]]);
  const directory = [...s.scopeStates.values()].filter(
    (v) => v.scope.namespace === scope.namespace,
  );
  for (const st of directory)
    if (grants.has(scopeKey(st.scope)) && scopes.size < 64)
      scopes.set(scopeKey(st.scope), st.scope);
  const scopeLimitExceeded =
    directory.length > 64 ||
    directory.some(
      (st) => grants.has(scopeKey(st.scope)) && !scopes.has(scopeKey(st.scope)),
    );
  const members: LocalSelectionState["members"] = [],
    vector: unknown[] = [];
  for (const member of scopes.values()) {
    const st = stateFor(s, member),
      saved = st.selectedJob ? s.jobs.get(st.selectedJob) : null,
      selected =
        saved?.status === "complete" &&
        saved.selectionRevision === selectionRevision(s)
          ? saved
          : null,
      job = current && st.activeJob ? active(s, st.activeJob) : null,
      pending = selected
        ? [...s.inputs.values()].filter(
            (i) => same(i.scope, member) && i.sequence > selected.watermark,
          ).length
        : st.inputCount,
      uniformHash = uniformOriginalMethodHash(st);
    members.push({
      scope: member,
      inputCount: st.inputCount,
      uniformOriginalMethodHash: uniformHash,
      originalEvidenceCurrent:
        st.originalEvidenceCurrentCount === st.inputCount,
      pending,
      publicationVersion: st.publicationVersion,
      active: job ? publicJob(job) : null,
      selected: selected ? { ...publicJob(selected), pending } : null,
    });
    const binding = (j: MemoryJob | null) =>
      j
        ? {
            id: j.id,
            status: j.status,
            generation: j.generation,
            target: j.target,
            fallbackMethod: j.fallbackMethod ?? null,
            selectionRevision: j.selectionRevision,
            watermark: j.watermark,
          }
        : null;
    vector.push({
      scope: member,
      sequence: st.sequence,
      inputCount: st.inputCount,
      uniformOriginalMethodHash: uniformHash,
      originalEvidenceCurrent:
        st.originalEvidenceCurrentCount === st.inputCount,
      pending,
      publicationVersion: st.publicationVersion,
      active: binding(job),
      selected: binding(selected),
    });
  }
  const total = directory.reduce((sum, state) => sum + state.inputCount, 0),
    unprovableCount = Math.max(
      0,
      total - members.reduce((n, m) => n + m.inputCount, 0),
    );
  return {
    execution: "local_only",
    authorityScope: scope,
    status:
      p.status === "invalid"
        ? "unavailable"
        : unprovableCount || scopeLimitExceeded
          ? "partial"
          : "ready",
    members,
    unprovableCount,
    scopeLimitExceeded,
    token: payloadHash({
      authority: a.fingerprint,
      preference: p,
      vector,
      total,
      scopeLimitExceeded,
      epoch: epoch(s, scope.namespace),
    }),
  };
}
export function selectionCurrent(s: MemoryState, scope: Scope, token: string) {
  const v = localSelection(s, scope);
  return v.members.length > 0 && v.token === token;
}

function archivedOriginalPin(
  s: MemoryState,
  key: string,
): Pick<MemoryInput, "originalMethodHash" | "originalMethodId"> {
  let pin: Pick<MemoryInput, "originalMethodHash" | "originalMethodId"> = {};
  for (const [storedKey, row] of s.originals) {
    if (row.inputKey !== key) continue;
    const result = EstimationEnvelopeSchema.parse(row.result);
    if (
      storedKey !==
        `${key}:${payloadHash(result.source)}:${result.requested_method.method_hash}` ||
      result.view !== "original"
    )
      throw new Error("ledger_integrity_failed");
    if (
      pin.originalMethodHash &&
      pin.originalMethodHash !== result.requested_method.method_hash
    )
      throw new Error("method_admission_conflict");
    pin = {
      originalMethodHash: result.requested_method.method_hash,
      originalMethodId: result.requested_method.method_id,
    };
  }
  return pin;
}
export function refreshOriginalEvidence(s: MemoryState, key: string) {
  const row = s.inputs.get(key);
  if (!row) return;
  const input = resolveInput(s, row),
    st = stateFor(s, row.scope);
  const original =
    input && row.originalMethodHash
      ? s.originals.get(
          `${key}:${payloadHash(input.source)}:${row.originalMethodHash}`,
        )
      : undefined;
  const current =
    !!original &&
    same(original.result.source, input?.source) &&
    original.result.view === "original";
  if (row.originalEvidenceCurrent) st.originalEvidenceCurrentCount--;
  row.originalEvidenceCurrent = current;
  row.resolvedSourceHash = input ? payloadHash(input.source) : null;
  if (current) st.originalEvidenceCurrentCount++;
}

export function refreshHistoryAuthority(s: MemoryState) {
  const providerKeys = new Set(
    [...s.histories.values()].map(
      (row) => `${row.namespace}:${row.record.provider_attempt_key}`,
    ),
  );
  for (const row of [...s.inputs.values()]) {
    if (row.family !== "live") continue;
    const attempt = s.records.get(
      recordKey(row.scope.namespace, "attempt", row.id),
    );
    if (
      attempt?.record.kind !== "attempt" ||
      !providerKeys.has(
        `${row.scope.namespace}:${attempt.record.provider_attempt_key}`,
      )
    )
      continue;
    const input = resolveInput(s, row),
      hash = input ? payloadHash(input.source) : null;
    if (hash !== (row.resolvedSourceHash ?? null))
      touch(s, row.scope, "live", row.id);
  }
}
