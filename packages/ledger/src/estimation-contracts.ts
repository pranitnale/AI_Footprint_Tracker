import type {
  AttemptObservation,
  RequestObservation,
  HistoryMessage,
  EngineMethodIdentity,
  EnginePreferenceRecord,
  EnginePreference,
  EstimateObservationSource,
  EstimationEnvelope,
  OriginalEstimateResultSchema,
  HistorySummary,
} from "@footprint/contracts";
import type { Scope, HistoryRow } from "./ledger-support";

export interface RecalculationJob {
  id: string;
  scope: Scope;
  target: EngineMethodIdentity;
  fallbackMethod?: EngineMethodIdentity;
  selectionRevision: number;
  generation: number;
  status: "running" | "complete" | "cancelled" | "superseded";
  watermark: number;
  cursor: number;
  snapshotTotal: number;
  processed: number;
  unavailable: number;
  pending: number;
}
export type EstimationInput = {
  key: string;
  sequence: number;
  scope: Scope;
  originalMethodHash: string | null;
  originalMethodState: "recorded" | "not_admitted" | "unavailable";
} & (
  | {
      family: "live";
      source: Extract<EstimateObservationSource, { family: "live" }>;
      request: RequestObservation;
      attempt: AttemptObservation;
      history?: HistoryMessage;
    }
  | {
      family: "history";
      source: Extract<EstimateObservationSource, { family: "history" }>;
      history: HistoryMessage;
    }
);
export type UnavailableReason =
  | "dependency_missing"
  | "ledger_integrity_failed"
  | "original_method_missing"
  | "method_unsupported";
export interface EstimationPage {
  job: RecalculationJob;
  inputs: EstimationInput[];
  unavailable: Array<{
    key: string;
    sequence: number;
    reason: UnavailableReason;
  }>;
  done: boolean;
}
export interface EstimationViewRow {
  key: string;
  sequence: number;
  input: EstimationInput | null;
  result: EstimationEnvelope | null;
  original:
    | EstimationEnvelope
    | ReturnType<typeof OriginalEstimateResultSchema.parse>
    | HistorySummary["resources"]
    | null;
  contributes: boolean;
  state: "original" | "selected" | "pending" | "unavailable";
}
export type EnginePreferenceState =
  | { status: "missing"; revision: null }
  | { status: "valid"; revision: number; record: EnginePreferenceRecord }
  | { status: "invalid"; revision: number | null };
export interface LocalSelectionState {
  execution: "local_only";
  authorityScope: Scope;
  status: "ready" | "partial" | "unavailable";
  members: Array<{
    scope: Scope;
    active: RecalculationJob | null;
    selected: RecalculationJob | null;
    pending: number;
    publicationVersion: number;
    inputCount: number;
    uniformOriginalMethodHash?: string | null;
    originalEvidenceCurrent?: boolean;
  }>;
  unprovableCount: number;
  scopeLimitExceeded: boolean;
  token: string;
}
export interface EstimationRepository {
  localSelectionState(authorityScope: Scope): Promise<LocalSelectionState>;
  localSelectionCurrent(authorityScope: Scope, token: string): Promise<boolean>;
  originalForLive(
    authorityScope: Scope,
    source: {
      attemptId: string;
      attemptRevision: number;
      attemptHash: string;
    },
  ): Promise<{
    result: EstimationEnvelope;
    request: RequestObservation;
    attempt: AttemptObservation;
  } | null>;
  state(scope: Scope): Promise<{
    active: RecalculationJob | null;
    selected: RecalculationJob | null;
    pending: number;
    publicationVersion: number;
    inputCount?: number;
    uniformOriginalMethodHash?: string | null;
    originalEvidenceCurrent?: boolean;
  }>;
  liveInput(
    scope: Scope,
    attemptId: string,
  ): Promise<Extract<EstimationInput, { family: "live" }> | null>;
  readPreference(): Promise<EnginePreferenceRecord | null>;
  readPreferenceState(): Promise<EnginePreferenceState>;
  repairPreference(
    expectedRevision: number | null,
    preference: EnginePreference,
  ): Promise<EnginePreferenceRecord | null>;
  compareAndSetPreference(
    expectedRevision: number | null,
    next: EnginePreferenceRecord,
  ): Promise<boolean>;
  start(options: {
    scope: Scope;
    target: EngineMethodIdentity;
    fallbackMethod?: EngineMethodIdentity;
    selectionRevision: number;
  }): Promise<RecalculationJob>;
  resume(scope: Scope): Promise<RecalculationJob | null>;
  page(jobId: string, limit?: number): Promise<EstimationPage>;
  commitResult(options: {
    jobId: string;
    inputKey: string;
    sequence: number;
    result: EstimationEnvelope;
  }): Promise<"applied" | "duplicate" | "stale">;
  markUnavailable(options: {
    jobId: string;
    inputKey: string;
    sequence: number;
    reason: UnavailableReason;
  }): Promise<"applied" | "duplicate" | "stale">;
  resultFor(
    scope: Scope,
    source: EstimateObservationSource,
    methodHash: string,
  ): Promise<EstimationEnvelope | null>;
  /**
   * `liveInput` and, for the input it finds, `resultFor(scope, input.source, methodHash)`, in
   * one read. A summary scan needs both for every attempt and resolved the input twice.
   * Optional: a repository without it is read with the two calls.
   */
  liveResult?(
    scope: Scope,
    attemptId: string,
    methodHash: string,
  ): Promise<{
    input: Extract<EstimationInput, { family: "live" }>;
    result: EstimationEnvelope | null;
  } | null>;
  /** `liveResult` for at most 200 attempts in one read, in the order given. Optional. */
  liveResults?(
    scope: Scope,
    attemptIds: string[],
    methodHash: string,
  ): Promise<
    Array<{
      input: Extract<EstimationInput, { family: "live" }>;
      result: EstimationEnvelope | null;
    } | null>
  >;
  /** One read for at most 100 sources. Each entry equals `resultFor` for that source. */
  resultsFor(
    scope: Scope,
    sources: EstimateObservationSource[],
    methodHash: string,
  ): Promise<Array<EstimationEnvelope | null>>;
  promote(jobId: string): Promise<RecalculationJob>;
  cancel(jobId: string): Promise<void>;
  viewPage(options: {
    scope: Scope;
    view: "original" | "selected";
    after?: string | null;
    limit?: number;
  }): Promise<{ rows: EstimationViewRow[]; after: string | null }>;
}

/** Narrow capture dependency. Implementations own a single atomic observation/result/outbox transaction. */
export interface CaptureRepository {
  capture(
    scope: Scope,
    records: unknown[],
    results?: EstimationEnvelope[],
  ): Promise<void>;
}
export interface ObservationRepository {
  estimation: EstimationRepository;
}
