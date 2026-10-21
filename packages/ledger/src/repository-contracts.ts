import type {
  Observation,
  RequestObservation,
  AttemptObservation,
  EstimationEnvelope,
  OriginalEstimateResultSchema,
  HistoryMessage,
  HistoryPage,
  HistoryReceipt,
  HistorySummary,
  HistoryCountBasis,
  ReasonCode,
} from "@footprint/contracts";
import type {
  Scope,
  RecordRow,
  OutboxRow,
  Ack,
  HistoryRow,
  ThreadRelation,
  DerivedSource,
  DerivedGuard,
  DerivedEntry,
  CoworkAdvance,
  CoworkCheckpoint,
} from "./ledger-support";
import type {
  CaptureRepository,
  EstimationRepository,
} from "./estimation-contracts";
import type {
  RoutingSnapshot,
  SessionStateRepository,
  MethodCatalogRepository,
  HealthRepository,
  ModelLabelRepository,
} from "./session-contracts";

export type StoredEstimate =
  EstimationEnvelope | ReturnType<typeof OriginalEstimateResultSchema.parse>;
export interface TrackingCheckpoint {
  key: string;
  namespace: string;
  scope: Scope;
  request: RequestObservation;
  attempt: AttemptObservation;
  captureRevision: number;
  parentKey: string | null;
  outputKey: string | null;
  branchId: string;
  imageParentKey: string | null;
  inlineComponentIds?: string[];
  uploadedFileIds?: Array<{ fileHandle: string; componentId: string }>;
  uploadPartialAdded?: boolean;
  originalMethodHash?: string;
  /** Text lengths of the last successful count per field; lengths only, never text. */
  countedUnits?: Record<string, number>;
  /** The last unknown model label already kept for this reply (local only). */
  keptLabel?: string;
  /**
   * Company keys of this capture's prompt and reply (W11): HMACs of the provider's ids
   * under the company key. The ledger keeps each beside its record for upload.
   */
  companyKeys?: { request?: string; attempt?: string };
  /**
   * A finished NotebookLM reply's content id, keyed like the provider's ids (16 Oct 2026).
   * Its saved copy keeps no id the stream named, so history links to this reply by it
   * (`liveReplyContents`). It goes with the checkpoint when the capture is erased.
   */
  contentKey?: string;
  at: number;
}
/** A live reply a saved copy can link to by its content (`TrackingCheckpoint.contentKey`). */
export interface LiveReplyContent {
  contentKey: string;
  attemptKey: string;
  /** The reply's company key, when the capture made one. */
  companyAttemptKey: string | null;
  startedAt: string;
  /** Current saved replies of the conversation already named by `attemptKey`. */
  linkedMessageKeys: string[];
}
/** All fields belong to one atomic observation/checkpoint/original/outbox admission. */
export interface CaptureCommit {
  scope: Scope;
  observations: unknown[];
  checkpoint?: TrackingCheckpoint;
  originals?: EstimationEnvelope[];
  archivedEstimates?: StoredEstimate[];
  currentEstimate?: { attemptId: string; estimate: StoredEstimate | null };
  guard?: DerivedGuard;
}
/**
 * A capture not ended this long after its request is taken as interrupted when the worker
 * starts. Live captures end within an hour plus one sweep (W10), so a longer reply that is
 * still running is never marked interrupted while its page keeps capturing.
 */
export const INTERRUPTED_AFTER_MS = 3_900_000;
export interface TrackingRepository extends CaptureRepository {
  checkpoint(id: string): Promise<TrackingCheckpoint | undefined>;
  commitCapture(command: CaptureCommit): Promise<void>;
  coalesceProviderIdentity(
    namespace: string,
    kind: Observation["kind"],
    providerKey: string,
  ): Promise<void>;
  /**
   * Whether a live attempt with this provider attempt key is saved in the namespace and
   * completed. A NotebookLM guide read again unchanged is not saved a second time (19 Oct 2026).
   */
  completedAttempt(namespace: string, attemptKey: string): Promise<boolean>;
  recoverInterrupted(scope: Scope, before?: number): Promise<number>;
}
export type RecordConsumer = (rows: RecordRow[]) => void | Promise<void>;
/**
 * A period for a whole-namespace scan: a request's `dispatched_at` or an attempt's
 * `started_at` at or after `start` and before `end`, compared as strings like the summary
 * filters do. A repository may still pass rows outside it, so callers keep their own check;
 * the rows it passes come in the same key order as an unfiltered scan.
 */
export type RecordPeriod = { start?: string; end?: string };
export interface ObservationQueries {
  getRecord(
    namespace: string,
    kind: Observation["kind"],
    id: string,
  ): Promise<RecordRow | undefined>;
  /**
   * `getRecord` for at most 200 ids in one read, in the order given. Optional: a repository
   * without it is read one record at a time.
   */
  getRecords?(
    namespace: string,
    kind: Observation["kind"],
    ids: string[],
  ): Promise<Array<RecordRow | undefined>>;
  scanRequests(
    namespace: string,
    consume: RecordConsumer,
    filter?: {
      conversationKey?: string;
      threadKey?: string;
      /** Only with neither key: the requests of a period (`RecordPeriod`). */
      between?: RecordPeriod;
    },
  ): Promise<void>;
  scanAttempts(
    namespace: string,
    consume: RecordConsumer,
    filter?: {
      requestId?: string;
      /** Only without `requestId`: the attempts of a period (`RecordPeriod`). */
      between?: RecordPeriod;
    },
  ): Promise<void>;
  currentEstimate(
    namespace: string,
    attemptId: string,
  ): Promise<StoredEstimate | undefined>;
  /** The revision waits to upload; a revision the server refused does not. */
  pendingRevision(
    namespace: string,
    kind: Observation["kind"],
    id: string,
    revision: number,
  ): Promise<boolean>;
}
export interface CalculationGuard {
  authorityScope: Scope;
  localSelectionToken: string;
}
export interface MonthlyViewClaim {
  scope: Scope;
  month: string;
  timezone: string;
  selection: CalculationGuard;
  company: { deviceId: string; deletionEpoch: number } | null;
}
export type MonthlyViewClaimResult = "claimed" | "already_claimed" | "stale";
export interface SummaryVersion {
  version: number;
  erasureVersion: number;
  threadRejectionVersion: number;
}
export interface PublicationSnapshot<G = unknown>
  extends RoutingSnapshot, SummaryVersion {
  erasing: boolean;
  sourceCurrent: boolean;
  calculationCurrent: boolean;
  trackingPaused: boolean;
  threadCurrent: boolean;
  guidance: DerivedEntry<G> | null;
}
export interface CachedSummary<T = unknown> {
  key: string;
  namespace: string;
  summary: T;
  generatedAt: number;
  version?: number;
  dirty?: boolean;
  summaryFormatVersion?: number;
  calculationToken?: string;
  server?: boolean;
  deletionEpoch?: number;
}
export interface PublicationRepository {
  claimMonthlyView(command: MonthlyViewClaim): Promise<MonthlyViewClaimResult>;
  publicationSnapshot<G = unknown>(
    namespace: string,
    source?: DerivedSource,
    guidance?: { key: string; actionToken: string },
    thread?: { key: string; providerRequestKey: string },
    selection?: CalculationGuard,
  ): Promise<PublicationSnapshot<G>>;
  summaryVersion(namespace: string): Promise<SummaryVersion>;
  readSummary<T = unknown>(id: string): Promise<CachedSummary<T> | undefined>;
  cacheSummary(
    namespace: string,
    id: string,
    summary: unknown,
    version: number,
    selection?: CalculationGuard,
  ): Promise<void>;
  serverSnapshot<T = unknown>(
    namespace: string,
    id: string,
    deviceId: string,
    deletionEpoch: number,
    value?: T,
    expectedErasureVersion?: number,
  ): Promise<CachedSummary<T> | null>;
  claimMonthly(
    namespace: string,
    month: string,
    deviceId: string,
    deletionEpoch: number,
  ): Promise<boolean>;
  claimPersonalMonthly(namespace: string, month: string): Promise<boolean>;
  lastClaimedMonth(namespace: string): Promise<string | null>;
  pendingErasure(namespace: string): Promise<boolean>;
}
export interface DerivedRepository {
  readDerived<C, G>(
    namespace: string,
    keys: { contextKey?: string; guidanceKey?: string },
  ): Promise<{
    erasureVersion: number;
    context?: DerivedEntry<C>;
    guidance?: DerivedEntry<G>;
  }>;
  writeDerived<C, G>(
    namespace: string,
    source: DerivedSource,
    guard: DerivedGuard,
    writes: {
      context?: { key: string; value: C };
      guidance?: { key: string; value: G };
    },
  ): Promise<boolean>;
  updateDerivedGuidance(
    namespace: string,
    actionKey: string,
    action: "dismiss" | "snooze",
    now?: number,
  ): Promise<boolean>;
}
export interface UsageSyncRepository {
  queue(namespace: string, now?: number, limit?: number): Promise<OutboxRow[]>;
  pending(namespace: string): Promise<OutboxRow[]>;
  pendingCount(namespace: string): Promise<number>;
  refusedCount(namespace: string): Promise<number>;
  queuedRecord(row: OutboxRow): Promise<Observation>;
  acknowledge(
    namespace: string,
    batchId: string,
    results: Ack[],
    sent: OutboxRow[],
  ): Promise<void>;
  retry(rows: OutboxRow[], retryAfter?: number): Promise<void>;
  reconcile(
    namespace: string,
    canonical: Observation,
    expectedHash: string,
    aliasId?: string,
    sourceRevision?: number,
    estimate?: StoredEstimate,
  ): Promise<void>;
}
export interface ErasureRepository {
  eraseFamily(
    namespace: string,
    requestId: string,
    notify?: boolean,
    retention?: boolean,
  ): Promise<number>;
  applyRange(
    scope: Scope,
    start: string | null,
    end: string | null,
    epoch: number,
    retention?: boolean,
  ): Promise<number>;
  eraseNamespace(namespace: string): Promise<number>;
  /**
   * Flags the organization namespace markers left in this browser so a later connection
   * the server confirms for that membership may release them. Only a full Personal erase
   * calls it; it returns the flagged namespaces.
   */
  flagOrganizationMarkers(): Promise<string[]>;
  /**
   * Removes a namespace marker that flagOrganizationMarkers flagged, once the server has
   * issued credentials for that namespace. Range, request and attempt markers stay.
   */
  releaseFlaggedMarker(namespace: string): Promise<boolean>;
  resumePendingCleanup(
    limit?: number,
  ): Promise<{ processed: number; pending: boolean }>;
}
export interface HistoryAdmission {
  authority: string;
  erasureVersion: number;
  estimates: Record<string, HistorySummary["resources"]>;
  envelopes?: Record<string, EstimationEnvelope>;
  healthCodes?: ReasonCode[];
  /**
   * Set on non-final batches of a multi-batch import. Existing coverage stays as it
   * is until the final batch, so readers never see a half-updated selection.
   */
  deferCoverage?: boolean;
  /** Local-only count bases for messages on this page, keyed by message key. */
  countBases?: Record<string, HistoryCountBasis>;
  /**
   * Company keys of messages on this page, keyed by message key (W11). A saved message
   * keeps the first key it gets; one that gets a key while unchanged is uploaded again.
   */
  companyKeys?: Record<string, string>;
  /**
   * A Cowork batch with results: the checkpoint its counts were calculated from and the
   * one it leaves. The commit fails as `cowork_checkpoint_stale` when the saved
   * checkpoint changed meanwhile, so a turn is never counted twice.
   */
  cowork?: CoworkAdvance;
}
export interface HistoryAcknowledgementGuard {
  authority: string;
  erasureVersion: number;
  coverageKey?: string;
  coverageHash?: string;
}
export interface HistoryStorageRepository {
  findHistoryMessage(
    scope: Scope,
    messageKey: string,
  ): Promise<HistoryRow | undefined>;
  /** One read for at most 100 keys. Each entry equals `findHistoryMessage` for that key. */
  findHistoryMessages(
    scope: Scope,
    messageKeys: string[],
  ): Promise<Array<HistoryRow | undefined>>;
  historyCoverage(
    scope: Scope,
    conversationKey: string,
  ): Promise<
    { key: string; page: HistoryPage; deviceId?: string | null } | undefined
  >;
  commitHistory(
    scope: Scope,
    page: HistoryPage,
    expected: HistoryAdmission,
    validNow: () => boolean,
  ): Promise<void>;
  /** The latest saved Cowork checkpoint of a conversation key, or null. */
  coworkCheckpoint(
    scope: Scope,
    conversationKey: string,
  ): Promise<CoworkCheckpoint | null>;
  /**
   * The live replies of a conversation that carry a content key, oldest first, each with
   * the saved replies already linked to it.
   */
  liveReplyContents(
    scope: Scope,
    conversationKey: string,
  ): Promise<LiveReplyContent[]>;
  /**
   * Queues saved rows again for the current enrolment, as reimporting unchanged history
   * does. Counted Cowork results are never reimported, so this keeps them uploaded after
   * a reconnection. Rows already queued in this enrolment, erased rows and missing rows
   * are left alone; personal history has nothing to queue. Returns the rows queued.
   */
  requeueHistory(
    scope: Scope,
    messageKeys: string[],
    expected: { authority: string; erasureVersion: number },
    validNow: () => boolean,
  ): Promise<number>;
  historyPage(
    scope: Scope,
    conversation: string | undefined,
    after?: string | null,
    limit?: number,
  ): Promise<HistoryRow[]>;
  pendingHistory(scope: Scope): Promise<HistoryRow[]>;
  acknowledgeHistory(
    scope: Scope,
    receipts: HistoryReceipt[],
    expected?: HistoryAcknowledgementGuard,
    validNow?: () => boolean,
  ): Promise<void>;
  historyQueued(scope: Scope, keys: string[]): Promise<Set<string>>;
  pendingHistoryCoverage(
    scope: Scope,
  ): Promise<Array<{ key: string; page: HistoryPage }>>;
  historyLiveOverlap(scope: Scope, message: HistoryMessage): Promise<boolean>;
  historyErased(scope: Scope, message: HistoryMessage): Promise<boolean>;
  /**
   * One read for at most 100 messages. `erased` equals `historyErased`; `overlap`
   * equals `historyLiveOverlap` and is false for an erased message.
   */
  historyRowFlags(
    scope: Scope,
    messages: HistoryMessage[],
  ): Promise<Array<{ erased: boolean; overlap: boolean }>>;
}
export interface ThreadRepository {
  linkRecordedThread(
    scope: Scope,
    threadKey: string,
    providerKeys: string[],
    erasureVersion: number,
    confirmation?: { keys: string[]; versions: Record<string, number> },
    current?: () => void,
  ): Promise<string[]>;
  pendingThreadLinks(
    namespace: string,
    limit?: number,
  ): Promise<ThreadRelation[]>;
  acknowledgeThreadLinks(
    namespace: string,
    threadKey: string,
    results: Array<{
      provider_request_key: string;
      status: "linked" | "not_recorded";
    }>,
    erasureVersion: number,
  ): Promise<void>;
  rejectThreadLinks(
    scope: Scope,
    threadKey: string,
    keys: string[],
    expected: { erasureVersion: number; deviceId: string },
  ): Promise<boolean>;
  threadRelationVersions(
    namespace: string,
    keys: string[],
  ): Promise<Record<string, number>>;
  /**
   * Whether a Perplexity reply is part of a thread: its saved copy is a current reply in
   * the thread's saved history, or its live capture answers a request linked to the
   * thread. A follow-up that names the reply continues the same thread.
   */
  threadAnswer(
    namespace: string,
    threadKey: string,
    attemptKey: string,
  ): Promise<boolean>;
}
/** Explicit domain capabilities from one shared backend. Services can accept narrower domains. */
export interface ApplicationRepository
  extends
    TrackingRepository,
    ObservationQueries,
    PublicationRepository,
    DerivedRepository,
    UsageSyncRepository,
    ErasureRepository,
    HistoryStorageRepository,
    ThreadRepository,
    SessionStateRepository,
    MethodCatalogRepository,
    HealthRepository,
    ModelLabelRepository {
  readonly estimation: EstimationRepository;
}
export interface ApplicationRepositoryProvider {
  readonly application: ApplicationRepository;
}
export type RepositorySource =
  ApplicationRepository | ApplicationRepositoryProvider;
export function resolveApplicationRepository(
  source: RepositorySource,
): ApplicationRepository {
  return "application" in source ? source.application : source;
}
