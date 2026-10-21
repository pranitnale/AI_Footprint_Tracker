import {
  resolveApplicationRepository,
  type ApplicationRepository,
  type RepositorySource,
  type TrackingCheckpoint,
  type Scope,
  type DerivedSource,
} from "@footprint/ledger";
import {
  isRouteConversationId,
  isDisplayBinding,
  parseConversationRoute,
  siteForHost,
  type RouteSite,
  type DisplayBinding,
  type ConversationIdentity,
} from "@footprint/capture-core";
import {
  MODEL_IDS,
  SCHEMA_VERSION,
  emptyTokenFields,
  emptyGeneration,
  composeOutputTotal,
  emptyRequestMedia,
  emptyAttemptMedia,
  unknownMediaSettings,
  unknownMeasurement,
  payloadHash,
  canonicalJson,
  UNAVAILABLE_ADMISSION_METHOD_ID,
  DEFAULT_DISPLAY_SCENARIO,
  DisplayScenarioSchema,
  type DisplayScenario,
  type EngineMethodIdentity,
  type RequestObservation,
  type AttemptObservation,
  type TokenMeasurement,
  type ReasonCode,
  type HistoryView,
  type Site,
  type EstimationEnvelope,
  type HistoryMessage,
} from "@footprint/contracts";
import { smallerModelChange, type SmallerModel } from "./smaller-model";
import { BASELINE_METHOD_ID } from "@footprint/estimator";
import {
  isNetworkFailure,
  randomSecret,
  type Credentials,
  type CompanySession,
} from "./company";
import {
  CAPTURE_FAILURE_REASONS as failureMap,
  sideCapture,
  validateCapture,
  type CaptureMessage,
} from "./bridge";
import {
  contextGuidance,
  selectContextBudget,
  type GuidanceState,
} from "./context";
import { summarize, type Filters } from "./summary";
import { countedContext } from "./claude-token-factor";
import {
  keepUnknownModelLabels,
  resolveModelLabel,
  unknownModelLabel,
} from "./models";
import { scanSummary, type ScanEstimateContext } from "./summary-scan";
import {
  BreakdownObserver,
  HistoryBreakdown,
  type BreakdownBucket,
} from "./usage-breakdown";
import { chatComparison } from "./chat-comparison";
import type { UsageBreakdownView } from "./dashboard/types";
import { periodWindow } from "./ui/periods";
import {
  needsModelLabels,
  type EstimateDetailSummary,
} from "./estimate-details";
import {
  serverHistoryView,
  serverSummary,
  withSplitHistoryViews,
  type ServerSummarySnapshot,
} from "./server-summary";
import type { RecordedThreads, RecordedThreadMatch } from "./recorded-threads";
import type { MethodService } from "./method-service";
import type { EngineService } from "./estimation/service";
import {
  composeRuntime,
  type RuntimeDependencies,
} from "./runtime-composition";
import {
  isEstimationEnvelope,
  type PresentedEstimate,
} from "./estimate-presentation";
import type { HistoryService } from "./history-service";
import type { MonthlySummaryService } from "./monthly-summary";
import {
  HealthReporter,
  combineHealth,
  persistedHealth,
  failureCode,
  solveHealth,
  type HealthSuccess,
} from "./health";
import { inlineFileComponents } from "./inline-file-components";
import { uploadedFileComponent } from "./uploaded-file-components";
import {
  validFileCaptureAssociation,
  type FileCaptureAssociation,
} from "./file-association-protocol";
import type {
  FileGrantBroker,
  FileReceiptRead,
  FileSender,
} from "./file-grant-broker";
import { digest } from "@footprint/ledger";
import {
  snapshotCountingRuntime,
  type CountingRuntime,
  validCountResponse,
  type CountField,
  type CountRequest,
  type CountResponse,
} from "@footprint/tokenizers/metadata";
import {
  GENERATED_TEXT_FIELDS,
  TEXT_PARTS,
  applyProviderUsage,
  initialReplyTokens,
  providerTotal,
  retainedCount,
  snapshotCountFields,
  snapshotGeneration,
} from "./reply-output";
import { PACKAGED_COUNTING_RUNTIME } from "./counting-config";
import { repriceUploads, uploadTotal, uploadedImages } from "./input-images";
import {
  PROMPT_ACTIONS,
  REPLY_ACTIONS,
  REQUEST_PROMPT_SITES,
  companyKeySecret,
  companyKeyer,
  streamPromptId,
} from "./company-identity";
import {
  ownershipAt,
  hmacIdentity,
  transitionOwnership,
  type Ownership,
} from "./ownership";
import {
  createChatgptProgressStore,
  memoryKeyValueArea,
  validChatgptReadProgress,
  type ChatgptProgressStore,
  type ChatgptReadProgress,
  type KeyValueArea,
} from "./chatgpt-read-progress";
import {
  longChatTipSettings,
  tipRequestLimit,
  validTipRequestLimit,
  type LongChatTipAction,
  type LongChatTipState,
} from "./long-chat-tip";
import { createLongChatTipStore, type LongChatTipStore } from "./long-chat-tip-store";
import {
  OWN_READ_SETTING_KEYS,
  ownReadAllowed,
  ownReadSettings,
  validOwnReadSites,
  type OwnReadSettingKey,
} from "./own-read-settings";
import {
  TRACKING_CONSENT_VERSION,
  organizationConsent,
  trackingConsent,
  type OrganizationConsent,
  type TrackingConsent,
  type TrackingState,
} from "./tracking-consent";
import {
  isOrganizationConsentVersion,
  organizationConsentCovers,
  organizationConsentVersion,
  storedFeatures,
  type OrganizationFeatures,
} from "./organization-terms";
import { organizationName } from "./dashboard/organization";

type TrackingJob = TrackingCheckpoint;

/** Snapshot limitations that become coverage reasons of the attempt. */
const COVERAGE_LIMITATIONS = [
  "unknown_event_observed",
  "research_work_unobserved",
] as const;

function usableServerHistory(
  history: HistoryView | undefined,
  matchedLiveOnly: boolean,
) {
  return (
    (history?.server_status === "current" &&
      history.server !== null &&
      history.server.status !== "unavailable") ||
    // Recorded-thread summaries explicitly cover matched live requests. Do not
    // combine that population with local history from another snapshot.
    (matchedLiveOnly && history?.local.status === "empty")
  );
}

/** Errors that mean the local calculation changed while a guarded read or display ran. */
function calculationChanged(error: unknown) {
  return (
    error instanceof Error &&
    ["aggregate_inconsistent", "selection_conflict"].includes(error.message)
  );
}

interface CapturePublication {
  scope: Scope;
  r: RequestObservation;
  a: AttemptObservation;
  source: DerivedSource;
  activeContext: string | null;
  budget: ReturnType<typeof selectContextBudget>;
  guidance: ReturnType<typeof contextGuidance>;
  storedGuidance?: { actionToken: string; value: { state: GuidanceState } };
  guidanceKey: string;
  derivedSaved: boolean;
  erasureVersion: number;
}
interface Settings {
  key: "settings";
  paused: boolean;
  budget: number | null;
  timezone: string;
  displayScenario: DisplayScenario;
  /** Stored before 16 October 2026 only; `settings()` turns it into the fields below. */
  contextTip?: boolean;
  contextTipRequests: boolean;
  contextTipRequestLimit: number;
  contextTipTokens: boolean;
  /** "Load full chat history automatically" (17 October 2026); `settings()` fills absent values with on. */
  ownRead: boolean;
  ownReadSites: Record<OwnReadSettingKey, boolean>;
  /** The agreement to tracking (18 October 2026); `settings()` reads an absent one as not agreed. */
  consent: TrackingConsent;
  /** When tracking was last turned off, kept after agreeing again (`setTrackingConsent`). */
  trackingWithdrawnAt?: number;
  /** The agreement given in the Connect dialog, or null. */
  organizationConsent: OrganizationConsent | null;
}
interface ContextNode {
  tokens: string;
  branchId: string;
  at: number;
}

/** How soon the dashboard reads again after figures moved during every build (a streaming reply). */
const DASHBOARD_MOVING_REFRESH_MS = 2_000;
/** Capture queue limits. A running capture may always keep one waiting progress frame. */
const CAPTURE_LIMITS = Object.freeze({
  softFrames: 16,
  softBytes: 16777216,
  hardFrames: 32,
  hardBytes: 25165824,
  publishIntervalMs: 2000,
});
type CaptureLink = {
  message: CaptureMessage;
  bytes: number;
  terminal: boolean;
  state: "queued" | "running" | "superseded";
  /** Whether the frame still counts toward the queue limits. */
  counted: boolean;
  owner: Deferred<"processed" | "superseded">;
  run: Promise<void>;
};
type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  promise.catch(() => {});
  return { promise, resolve, reject };
}
export class Coordinator {
  readonly counting: CountingRuntime;
  readonly monthly: MonthlySummaryService;
  readonly ledger: ApplicationRepository;
  readonly history: HistoryService;
  private readonly chatgptProgress: ChatgptProgressStore;
  private readonly longChatTips: LongChatTipStore;
  private uploadAssociations = new Map<
    string,
    {
      message: FileCaptureAssociation;
      sender: FileSender;
      expires: number;
      dirty: boolean;
      running: Promise<void> | null;
    }
  >();
  private uploadReads = new Map<string, Promise<FileReceiptRead | null>>();
  private uploadAdmission = 0;
  private uploadWake: {
    timer: ReturnType<typeof setTimeout>;
    promise: Promise<void>;
    resolve: () => void;
  } | null = null;
  private displayWake: {
    timer: ReturnType<typeof setTimeout>;
    promise: Promise<void>;
    resolve: () => void;
  } | null = null;
  private displayCapacity: Promise<void> | null = null;
  private uploadReadWaiters = new Set<string>();
  private uploadReadLate = new Set<string>();
  private uploadCompleted = new Map<
    string,
    { owner: object; receipt: FileReceiptRead }
  >();
  readonly threads: RecordedThreads;
  readonly company: CompanySession;
  readonly methods: MethodService;
  readonly engines: EngineService;
  private flights = new Map<string, Promise<void>>();
  private queued = 0;
  private queuedBytes = 0;
  // Progress frames of one reply carry the whole reply so far, so a newer frame
  // replaces one still waiting. At most one waits per capture.
  private queuedProgress = new Map<string, CaptureLink>();
  /** Frames waiting (not yet running) per capture, and how many of them end it. */
  private captureWaiting = new Map<string, { frames: number; terminal: number }>();
  private lastPublishAt = new Map<string, number>();
  /** Tabs whose last capture display waited for recalculation, republished when it publishes. */
  private pendingCalc = new Map<
    number,
    {
      localKey: string;
      version: string;
      attempts: number;
      failures: number;
      exhausted: boolean;
    }
  >();
  private calculationDirty = false;
  private calculationRetry: ReturnType<typeof setTimeout> | null = null;
  private ready: Promise<void>;
  private summaryFlights = new Map<string, Promise<any>>();
  /**
   * NotebookLM guide captures held until their end frame, by capture key (see `holdGuide`).
   * Bounded: a guide whose end never comes is dropped with the oldest.
   */
  private heldGuides = new Map<string, CaptureMessage>();
  private conversationFlights = new Map<string, Promise<any>>();
  private recalculationWork: Promise<any> | null = null;
  private publishedCaptures = new Map<
    number,
    { localKey: string; version: string }
  >();
  private fileDisplayWork: Promise<void> | null = null;
  private fileDisplayPending = new Map<
    string,
    {
      scope: Scope;
      conversationKey: string;
      threadKey?: string;
      expires: number;
    }
  >();
  private displayVersions = new Map<number, string>();
  private displayDocuments = new Map<number, string>();
  private displayBindings = new Map<
    string,
    {
      tabId: number;
      binding: DisplayBinding;
      identity: ConversationIdentity | null;
      documentId?: string;
      origin: string;
      thread?: { key: string; erasureVersion: number; ownershipStart: number };
      /** A Perplexity follow-up: the thread the tab showed and the reply it names. */
      followUp?: { threadId: string; parentId: string };
      /**
       * A Perplexity reply that joins a thread by its own id: a send from outside a thread,
       * which starts one, or a capture recovered after a worker restart. Holds the thread
       * the tab opened or shows, and the last thread whose link was tried before the reply
       * ended.
       */
      byReply?: { threadId?: string; tried?: string };
    }
  >();
  /** The Perplexity thread each tab shows, or null on another page of the site. */
  private tabThreads = new Map<number, string | null>();
  /** The browser reported a tab's new address, also after in-page navigation. */
  noteTabAddress(tabId: number, address: string) {
    let thread: string | null = null;
    try {
      const url = new URL(address);
      if (siteForHost(url.hostname) === "perplexity")
        thread =
          parseConversationRoute("perplexity", url.pathname)?.conversationId ??
          null;
    } catch {}
    this.tabThreads.delete(tabId);
    this.tabThreads.set(tabId, thread);
    while (this.tabThreads.size > 128)
      this.tabThreads.delete(this.tabThreads.keys().next().value!);
  }
  invalidateDisplay(tabId: number, documentNonce?: string) {
    this.history.invalidate(tabId, documentNonce);
    this.threads.invalidate(tabId, documentNonce);
    for (const [key, entry] of this.uploadAssociations)
      if (
        entry.sender.tab?.id === tabId &&
        (!documentNonce ||
          entry.message.binding.documentNonce === documentNonce)
      ) {
        this.uploadAssociations.delete(key);
        this.uploadReadWaiters.delete(key);
        for (const [readKey, cached] of this.uploadCompleted)
          if (cached.owner === entry) this.uploadCompleted.delete(readKey);
      }
    for (const [key, value] of this.displayBindings)
      if (
        value.tabId === tabId &&
        (!documentNonce || value.binding.documentNonce === documentNonce)
      )
        this.displayBindings.delete(key);
    if (!documentNonce || this.displayDocuments.get(tabId) === documentNonce) {
      this.displayVersions.delete(tabId);
      this.publishedCaptures.delete(tabId);
      this.displayDocuments.delete(tabId);
      this.pendingCalc.delete(tabId);
    }
  }
  private displayWork = new Set<Promise<void>>();
  constructor(
    repository: RepositorySource,
    private dependencies: RuntimeDependencies & {
      sendDisplay: (tabId: number, message: unknown) => Promise<unknown>;
      /** Called after a recalculation publishes, so open chats can refresh saved totals. */
      calculationPublished?: () => void;
      extensionId?: string;
      fileReceipts?: Pick<FileGrantBroker, "readReceipt" | "onReceipt">;
      fileFailure?: (code: ReasonCode) => void;
      health?: HealthReporter;
      /**
       * The extension's own storage for per-chat state (ChatGPT read progress, closed
       * long-chat tips); kept in memory if absent.
       */
      progressStorage?: KeyValueArea;
      /**
       * Track nothing until the person agreed (lib/tracking-consent.ts). The background passes
       * true; tests written before the agreement step leave it out and keep their meaning.
       */
      requireTrackingConsent?: boolean;
    },
  ) {
    const ledger = resolveApplicationRepository(repository);
    this.ledger = ledger;
    const chatStorage = dependencies.progressStorage ?? memoryKeyValueArea();
    this.chatgptProgress = createChatgptProgressStore(chatStorage);
    this.longChatTips = createLongChatTipStore(chatStorage);
    this.counting = snapshotCountingRuntime(
      dependencies.counting ?? PACKAGED_COUNTING_RUNTIME,
    );
    const runtime = composeRuntime(
      ledger,
      { ...dependencies, counting: this.counting },
      {
        selectedServerSummary: (query) =>
          this.selectedServerSummary("my", query),
        currentScope: () => this.currentScope(),
        estimateCanonical: (scope, attemptId) =>
          this.estimateCanonical(scope, attemptId),
        promoteRecordedCapture: (match, current) =>
          this.promoteRecordedCapture(match, current),
        scanSelected: (scope, threadKey, pendingOnly) =>
          this.scanUsage(scope, undefined, pendingOnly, threadKey),
        // A Perplexity thread's saved rows are keyed by the thread itself.
        historyCommitted: (scope, conversationKey) =>
          this.refreshFileDisplays(scope, conversationKey, conversationKey),
        trackingAllowed: () => this.trackingConsented(),
        organizationAgreed: (origin, features) =>
          this.organizationAgreed(origin, features),
        connectionAgreed: (version, origin) =>
          this.recordOrganizationConsent(version, origin),
      },
    );
    this.company = runtime.company;
    this.methods = runtime.methods;
    this.engines = runtime.engines;
    if (dependencies.calculationPublished)
      this.engines.onPublished(dependencies.calculationPublished);
    // Only wake work here; the republish itself runs outside the publication.
    this.engines.onPublished(() => {
      if (!this.pendingCalc.size) return;
      this.calculationDirty = true;
      this.wakeFileDisplays();
    });
    this.history = runtime.history;
    this.threads = runtime.threads;
    this.monthly = runtime.monthly;
    this.ready = this.initialize();
    void this.ready.then(() => this.engines.maintainLocal()).catch(() => {});
    dependencies.fileReceipts?.onReceipt((fileHandle) => {
      for (const [key, entry] of this.uploadAssociations)
        if (
          entry.message.association.files.some(
            (file) => file.fileHandle === fileHandle,
          )
        )
          this.scheduleUploadedFiles(key, entry);
    });
  }
  whenReady(): Promise<void> {
    return this.ready;
  }
  private async estimateCanonical(scope: Scope, attemptId: string) {
    const authority = await this.methods.authority();
    if (canonicalJson(authority.scope) !== canonicalJson(scope))
      throw new Error("policy_unavailable");
    const input = await this.ledger.estimation.liveInput(scope, attemptId);
    if (!input || canonicalJson(input.scope) !== canonicalJson(scope)) {
      await this.ledger.health(scope.namespace, "estimate_unavailable");
      return;
    }
    const calculated = await this.engines.original(
      {
        family: "live",
        request: input.request,
        attempt: input.attempt,
        canonicalRequestBinding: input.source.canonical_request_binding,
      },
      input.originalMethodHash ?? undefined,
    );
    await authority.current();
    const envelope = calculated.result;
    if (!envelope) {
      await this.ledger.health(
        scope.namespace,
        calculated.reason ?? "estimate_unavailable",
      );
      return;
    }
    const estimate =
      envelope.requested_method.engine_id === "original" &&
      envelope.raw?.engine_id === "original" &&
      !Array.isArray(envelope.raw.result)
        ? envelope.raw.result
        : envelope;
    await this.ledger.commitCapture({
      scope,
      observations: [],
      originals: [envelope],
      archivedEstimates: [estimate],
      currentEstimate: { attemptId: input.attempt.attempt_id, estimate },
    });
    await solveHealth(this.ledger, scope.namespace, [
      "estimate_made",
      "record_saved",
    ]);
    void this.engines.maintainLocal();
  }
  private async captureEstimate(
    scope: Scope,
    request: RequestObservation,
    attempt: AttemptObservation,
    originalMethodHash?: string,
  ) {
    const saved = await this.ledger.getRecord(
      scope.namespace,
      "attempt",
      attempt.attempt_id,
    );
    const prior = saved
      ? await this.ledger.estimation.liveInput(scope, attempt.attempt_id)
      : null;
    const binding = prior?.source.canonical_request_binding;
    return this.engines.original(
      binding && prior && binding.observed_request_id === attempt.request_id
        ? {
            family: "live",
            request: prior.request,
            attempt,
            canonicalRequestBinding: binding,
          }
        : { family: "live", request, attempt },
      originalMethodHash,
    );
  }
  async associateUploadedFiles(
    value: unknown,
    sender: FileSender,
  ): Promise<{ accepted: boolean }> {
    if (
      !this.dependencies.fileReceipts ||
      !this.dependencies.extensionId ||
      sender.id !== this.dependencies.extensionId ||
      sender.frameId !== 0 ||
      sender.tab?.id == null ||
      !validFileCaptureAssociation(value) ||
      this.uploadAdmission >= 16
    )
      return { accepted: false };
    let site: ReturnType<typeof siteForHost>;
    try {
      const url = new URL(sender.url!);
      if (url.protocol !== "https:") return { accepted: false };
      site = siteForHost(url.hostname);
    } catch {
      return { accepted: false };
    }
    if (site !== "chatgpt" && site !== "perplexity") return { accepted: false };
    // No upload is counted before the person agreed to tracking.
    if (!(await this.trackingConsented())) return { accepted: false };
    const key = `capture:${sender.tab.id}:${sender.documentId ?? "legacy-document"}:${value.association.captureId}`,
      captured = this.displayBindings.get(key);
    if (
      !captured ||
      canonicalJson(captured.binding) !== canonicalJson(value.binding)
    )
      return { accepted: false };
    this.uploadAdmission++;
    try {
      await this.ready;
      await this.flights.get(key);
      for (const [old, entry] of this.uploadAssociations)
        if (entry.expires <= Date.now()) this.uploadAssociations.delete(old);
      const job = await this.uploadJob(key);
      if (
        !job ||
        job.request.site !== site ||
        canonicalJson(job.scope) !== canonicalJson(await this.currentScope())
      )
        return { accepted: false };
      const previous = this.uploadAssociations.get(key);
      if (previous) {
        const old = previous.message.association,
          next = value.association;
        if (
          old.files.length + old.unmatchedReferenceCount !==
            next.files.length + next.unmatchedReferenceCount ||
          old.files.some(
            (file) =>
              !next.files.some(
                (candidate) => candidate.fileHandle === file.fileHandle,
              ),
          )
        )
          return { accepted: false };
        previous.message = structuredClone(value);
        this.scheduleUploadedFiles(key, previous);
      } else {
        if (this.uploadAssociations.size >= 32) return { accepted: false };
        const entry = {
          message: structuredClone(value),
          sender: {
            id: sender.id,
            url: sender.url,
            tab: { id: sender.tab.id },
            frameId: 0,
            documentId: sender.documentId,
          },
          expires: Date.now() + 300000,
          dirty: false,
          running: null as Promise<void> | null,
        };
        this.uploadAssociations.set(key, entry);
        this.scheduleUploadedFiles(key, entry);
      }
      return { accepted: true };
    } catch {
      return { accepted: false };
    } finally {
      this.uploadAdmission--;
    }
  }
  private async uploadJob(key: string): Promise<TrackingJob | undefined> {
    const installation = await this.ledger.readInstallation();
    if (!installation) return;
    // Capture routing locators are local-only and use the same domain separation as ordinary capture.
    for (const provider of ["chatgpt", "perplexity"] as const) {
      const locator = await hmacIdentity(
        installation.routingSecret,
        provider,
        "local-capture",
        key,
      );
      const job = await this.ledger.checkpoint(locator);
      if (job) return job;
    }
  }
  private scheduleUploadedFiles(
    key: string,
    entry: {
      message: FileCaptureAssociation;
      sender: FileSender;
      expires: number;
      dirty: boolean;
      running: Promise<void> | null;
    },
  ) {
    if (
      this.uploadAssociations.get(key) !== entry ||
      entry.expires <= Date.now()
    )
      return;
    entry.dirty = true;
    if (entry.running) return;
    entry.running = (async () => {
      for (let pass = 0; pass < 3 && entry.dirty; pass++) {
        entry.dirty = false;
        await this.applyUploadedFiles(key, entry);
      }
    })()
      .catch((error) => {
        if (
          !(error instanceof Error) ||
          ![
            "derived_dependency_changed",
            "record_erased",
            "revision_conflict",
            "policy_unavailable",
          ].includes(error.message)
        )
          this.dependencies.fileFailure?.("storage_write_failed");
      })
      .finally(() => {
        entry.running = null;
        if (entry.dirty && this.uploadAssociations.get(key) === entry)
          this.wakeUploadedFiles();
      });
  }
  private wakeUploadedFiles() {
    // Only new dirty work schedules another turn; failed unchanged reads do not poll.
    if (this.uploadWake) return;
    let resolve!: () => void;
    const promise = new Promise<void>((done) => (resolve = done));
    const timer = setTimeout(() => {
      this.uploadWake = null;
      for (const [key, entry] of this.uploadAssociations) {
        if (entry.expires <= Date.now()) {
          this.uploadAssociations.delete(key);
          continue;
        }
        if (entry.dirty && !entry.running)
          this.scheduleUploadedFiles(key, entry);
      }
      for (const [key, value] of this.uploadCompleted)
        if (![...this.uploadAssociations.values()].includes(value.owner as any))
          this.uploadCompleted.delete(key);
      resolve();
    }, 0);
    this.uploadWake = { timer, promise, resolve };
  }
  private async readUploadedReceipt(
    key: string,
    entry: { message: FileCaptureAssociation; sender: FileSender },
    fileHandle: string,
  ): Promise<FileReceiptRead | null> {
    const readKey = key + ":" + fileHandle;
    const cached = this.uploadCompleted.get(readKey);
    if (cached) {
      this.uploadCompleted.delete(readKey);
      if (cached.owner === entry && cached.receipt.validNow())
        return cached.receipt;
    }
    let physical = this.uploadReads.get(readKey);
    if (!physical) {
      if (this.uploadReads.size >= 16) {
        this.uploadReadWaiters.add(key);
        return null;
      }
      physical = this.dependencies
        .fileReceipts!.readReceipt(
          {
            binding: { ...entry.message.binding, captureId: null },
            captureId: entry.message.association.captureId,
            fileHandle,
          },
          entry.sender,
        )
        .catch(() => null)
        .then((receipt) => {
          if (
            this.uploadReadLate.has(readKey) &&
            receipt &&
            receipt.status !== "pending" &&
            receipt.validNow() &&
            this.uploadAssociations.get(key) === entry
          ) {
            // Keep the completed numerical capability so a slow read is not repeated.
            // Admission bounds this cache to 32 captures with at most 16 handles each.
            this.uploadCompleted.set(readKey, { owner: entry, receipt });
            const current = this.uploadAssociations.get(key)!;
            current.dirty = true;
            this.wakeUploadedFiles();
          }
          return receipt;
        })
        .finally(() => {
          this.uploadReads.delete(readKey);
          this.uploadReadLate.delete(readKey);
          for (const waiting of this.uploadReadWaiters) {
            const current = this.uploadAssociations.get(waiting);
            if (current) current.dirty = true;
          }
          if (this.uploadReadWaiters.size) {
            this.uploadReadWaiters.clear();
            this.wakeUploadedFiles();
          }
        });
      this.uploadReads.set(readKey, physical);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        physical,
        new Promise<null>((resolve) => {
          timer = setTimeout(() => {
            this.uploadReadLate.add(readKey);
            resolve(null);
          }, 5000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  private async applyUploadedFiles(
    key: string,
    entry: {
      message: FileCaptureAssociation;
      sender: FileSender;
      expires: number;
      dirty: boolean;
      running: Promise<void> | null;
    },
  ): Promise<void> {
    const message = entry.message;
    if (
      entry.expires <= Date.now() ||
      this.uploadAssociations.get(key) !== entry ||
      !message.association.files.length
    )
      return;
    const receipts = await Promise.all(
      message.association.files.map(async (file) => ({
        fileHandle: file.fileHandle,
        receipt: await this.readUploadedReceipt(key, entry, file.fileHandle),
      })),
    );
    if (
      entry.expires <= Date.now() ||
      this.uploadAssociations.get(key) !== entry
    )
      return;
    const previous = this.flights.get(key) ?? Promise.resolve();
    const work = previous
      .catch(() => {})
      .then(async () => {
        const job = await this.uploadJob(key);
        if (!job) return;
        if (
          canonicalJson(await this.currentScope()) !== canonicalJson(job.scope)
        )
          return;
        const source: DerivedSource = {
          requestId: job.request.request_id,
          requestRevision: job.request.revision,
          requestHash: payloadHash(job.request),
          attemptId: job.attempt.attempt_id,
          attemptRevision: job.attempt.revision,
          attemptHash: payloadHash(job.attempt),
        };
        const current = await this.ledger.publicationSnapshot(
          job.scope.namespace,
          source,
        );
        if (!current.sourceCurrent || current.erasing) return;
        const identities = [...(job.uploadedFileIds ?? [])],
          components = [...(job.request.documents.extracted_text ?? [])];
        const validated: FileReceiptRead[] = [];
        for (const item of receipts) {
          if (!item.receipt) continue;
          const existing = identities.find(
              (id) => id.fileHandle === item.fileHandle,
            ),
            componentId = existing?.componentId ?? crypto.randomUUID();
          const component = uploadedFileComponent(
            item.fileHandle,
            componentId,
            item.receipt,
            job.scope,
            job.request.dispatched_at,
            this.counting.manifest,
          );
          if (!component) continue;
          if (!existing)
            identities.push({ fileHandle: item.fileHandle, componentId });
          const position = components.findIndex(
            (value) => value.component_id === componentId,
          );
          if (position >= 0) components[position] = component;
          else components.push(component);
          validated.push(item.receipt);
        }
        if (!validated.length) return;
        if (
          identities.length > 16 ||
          components.length +
            job.request.media.input_images.length +
            job.request.media.requested_operations.length >
            100
        ) {
          this.dependencies.fileFailure?.("media_metadata_limit_exceeded");
          return;
        }
        const basis = validated[0]!.basis!;
        if (
          validated.some(
            (value) => canonicalJson(value.basis) !== canonicalJson(basis),
          ) ||
          basis.erasureVersion !== current.erasureVersion
        )
          return;
        const partial =
          message.association.unmatchedReferenceCount > 0 ||
          message.association.files.some(
            (file) =>
              !identities.some((id) => id.fileHandle === file.fileHandle),
          );
        const coverage = job.request.coverage_reasons.filter(
          (reason) =>
            !(
              reason === "partial_capture" &&
              job.uploadPartialAdded &&
              !partial
            ),
        );
        const added = partial && !coverage.includes("partial_capture");
        if (added) coverage.push("partial_capture");
        const request = {
          ...job.request,
          documents: { ...job.request.documents, extracted_text: components },
          coverage_reasons: coverage,
          features: [
            ...new Set([...job.request.features, "document" as const]),
          ],
        };
        if (canonicalJson(request) === canonicalJson(job.request)) return;
        request.revision++;
        const updated = {
          ...job,
          request,
          uploadedFileIds: identities,
          uploadPartialAdded: partial && (job.uploadPartialAdded || added),
        };
        await this.ledger.commitCapture({
          scope: job.scope,
          observations: [request],
          checkpoint: updated,
          guard: {
            erasureVersion: basis.erasureVersion,
            dependencies: [source],
            requestFileMetadata: {
              source,
              ownershipStart: basis.ownershipStart,
              ownershipEnd: basis.ownershipEnd,
              deviceId: basis.deviceId,
              enrollmentState: basis.enrollmentState,
              validNow: () =>
                this.uploadAssociations.get(key) === entry &&
                entry.expires > Date.now() &&
                validated.every((value) => value.validNow()),
            },
          },
        });

        this.refreshFileDisplays(
          job.scope,
          job.request.conversation_key,
          this.displayBindings.get(key)?.thread?.key,
        );
      });
    this.flights.set(key, work);
    try {
      await work;
    } finally {
      if (this.flights.get(key) === work) this.flights.delete(key);
    }
  }
  async settleUploadedFiles(): Promise<void> {
    for (let pass = 0; pass < 64; pass++) {
      const work = [...this.uploadAssociations.values()].flatMap((entry) =>
        entry.running ? [entry.running] : [],
      );
      if (this.uploadWake) work.push(this.uploadWake.promise);
      if (!work.length) return;
      await Promise.all(work);
    }
  }
  invalidateUploadedFiles(): void {
    this.methods.invalidate();
    this.invalidateRecordedCaptures();
    for (const wake of [this.uploadWake, this.displayWake])
      if (wake) {
        clearTimeout(wake.timer);
        wake.resolve();
      }
    this.uploadWake = null;
    this.displayWake = null;
    this.uploadCompleted.clear();
    this.uploadReadWaiters.clear();
    this.publishedCaptures.clear();
    this.fileDisplayPending.clear();
    this.displayVersions.clear();
    this.uploadAssociations.clear();
  }
  private async initialize() {
    if (!(await this.ledger.readPersonal()))
      await this.ledger.applySessionChanges({
        personal: {
          namespace: `personal:${crypto.randomUUID()}`,
          secret: randomSecret(),
        },
      });
    if (!(await this.ledger.readInstallation()))
      await this.ledger.applySessionChanges({
        installation: {
          routingSecret: randomSecret(),
        },
      });
    if (!(await this.ledger.readSettings()))
      await this.ledger.applySessionChanges({
        settings: {
          paused: false,
          budget: null,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          displayScenario: DEFAULT_DISPLAY_SCENARIO,
          ...longChatTipSettings({}),
          ...ownReadSettings({}),
        },
      });
    const personal = (await this.ledger.readPersonal())!;
    if (!(await this.ledger.readOwnershipHistory()))
      await this.ledger.applySessionChanges({
        ownershipHistory: {
          eras: [
            {
              scope: {
                namespace: personal.namespace,
                mode: "personal",
                era: null,
              },
              secret: personal.secret,
              policyVersion: "1.0.0",
              start: 0,
              end: null,
            },
          ],
        },
      });
    const credentials = await this.company.credentials();
    await this.ledger.recoverInterrupted(
      credentials
        ? {
            namespace: credentials.namespace,
            mode: "company",
            era: credentials.enrollment_era.id,
          }
        : { namespace: personal.namespace, mode: "personal", era: null },
    );
    await this.ledger.resumePendingCleanup();
  }
  async settings(): Promise<Settings> {
    await this.ready;
    // Installations created before the range display choice existed have no saved value.
    const { contextTip: legacyTip, ...stored } = (await this.ledger.readSettings())!;
    return {
      key: "settings",
      displayScenario: DEFAULT_DISPLAY_SCENARIO,
      ...stored,
      // The two long-chat tip triggers of 16 October 2026, migrated from the one switch.
      ...longChatTipSettings({ contextTip: legacyTip, ...stored }),
      // "Load full chat history" (17 October 2026): absent in older installations, which reads as on.
      ...ownReadSettings(stored),
      // The agreement (18 October 2026): absent in older installations, which reads as not
      // agreed, so they stay off until the person agrees.
      consent: trackingConsent(stored.consent),
      organizationConsent: organizationConsent(stored.organizationConsent),
    };
  }
  /**
   * Whether the tracker may load a chat's full history from this site now (`own-read-settings.ts`); a
   * content script asks right before each own read.
   */
  async ownReadSetting(key: OwnReadSettingKey) {
    const settings = await this.settings();
    // Nothing is read from a site before the person agreed to tracking.
    if (this.consentMissing(settings)) return { on: false };
    const switches = ownReadSettings(settings);
    // The site's own switch cannot be changed while the main switch is off; Details names
    // the main switch then (live QA, 19 Oct 2026).
    if (!switches.ownRead) return { on: false, cause: "main" as const };
    return { on: ownReadAllowed(switches, key) };
  }
  /** Whether the person's agreement is missing while this coordinator requires it. */
  private consentMissing(settings: Pick<Settings, "consent">) {
    return !!this.dependencies.requireTrackingConsent && !settings.consent.agreed;
  }
  /**
   * Whether anything may be tracked: the person agreed (lib/tracking-consent.ts). Every tracking
   * entry checks it before it stores, counts, estimates, reads or uploads anything: live captures
   * (`process`), history imports and recorded threads (their `trackingAllowed` hook), uploaded
   * files, the own read and the files the background counts for a page.
   */
  async trackingConsented(): Promise<boolean> {
    if (!this.dependencies.requireTrackingConsent) return true;
    return !this.consentMissing(await this.settings());
  }
  /**
   * What a provider tab needs for the bar and Details: the agreement, the organization and
   * whether tracking is paused. Paused follows `process`: a policy that requires tracking
   * records replies although the person paused.
   */
  async trackingState(): Promise<TrackingState> {
    const consented = await this.trackingConsented();
    const scope = await this.currentScope();
    const credentials =
      scope.mode === "company" ? await this.company.credentials() : null;
    const own = !!credentials && credentials.namespace === scope.namespace;
    return {
      consent: consented ? "agreed" : "required",
      organization: own ? organizationName(credentials!, "your organization") : null,
      paused:
        (await this.settings()).paused &&
        !(own && credentials!.policy.pause_mode === "disabled_by_company"),
    };
  }
  /**
   * Records the person's choice from the welcome page, the popup or Settings. Agreeing names the
   * version of the text that was shown and may carry the choice of "Load full chat history
   * automatically" made beside it; withdrawing (Turn off tracking) stops all tracking at once.
   * Records already saved stay until the person erases them.
   */
  async setTrackingConsent(change: {
    agreed?: unknown;
    version?: unknown;
    ownRead?: unknown;
  }): Promise<{ changed: boolean; ownReadChanged: boolean }> {
    if (typeof change.agreed !== "boolean") throw new Error("payload_rejected");
    if (change.agreed && change.version !== TRACKING_CONSENT_VERSION)
      throw new Error("payload_rejected");
    if (change.ownRead !== undefined && typeof change.ownRead !== "boolean")
      throw new Error("payload_rejected");
    const old = await this.settings();
    const at = Date.now();
    const { key: _key, contextTip: _legacy, ...settings } = {
      ...old,
      ...(typeof change.ownRead === "boolean" ? { ownRead: change.ownRead } : {}),
      consent: {
        agreed: change.agreed,
        version: change.agreed ? TRACKING_CONSENT_VERSION : old.consent.version,
        at,
      },
      // The replies the withdrawal ends below are told apart from replies the tracker missed
      // by this time (`BreakdownObserver`), so the Tracking page does not report them as not
      // read (live QA, 19 Oct 2026).
      ...(change.agreed ? {} : { trackingWithdrawnAt: at }),
    } as Settings;
    await this.ledger.applySessionChanges({ settings });
    if (!change.agreed) {
      this.invalidateRecordedCaptures();
      this.heldGuides.clear();
      // A reply still arriving sends its later frames nowhere once tracking is off, so its
      // record stayed "generating" for good (live QA, 19 Oct 2026). It ends now as a reply
      // not read to its end, as after a browser restart; its saved copy counts it once the
      // chat is read again after agreeing.
      await this.ledger.recoverInterrupted(
        await this.currentScope(),
        Number.POSITIVE_INFINITY,
      );
    }
    return {
      changed: old.consent.agreed !== change.agreed,
      ownReadChanged: OWN_READ_SETTING_KEYS.some(
        (key) =>
          ownReadAllowed(old, key) !==
          ownReadAllowed(ownReadSettings(settings), key),
      ),
    };
  }
  /** Keeps the agreement the person gave in the Connect dialog, after the connection succeeded. */
  async recordOrganizationConsent(version: unknown, origin: string) {
    if (!isOrganizationConsentVersion(version)) throw new Error("payload_rejected");
    const { key: _key, contextTip: _legacy, ...settings } = {
      ...(await this.settings()),
      organizationConsent: { version, at: Date.now(), origin },
    } as Settings;
    await this.ledger.applySessionChanges({ settings });
  }
  /**
   * Whether the organization agreement covers what this server's operator switches change
   * (lib/organization-terms.ts). The organization client holds sharing while it does not.
   */
  async organizationAgreed(origin: string, features: OrganizationFeatures) {
    return organizationConsentCovers(
      (await this.settings()).organizationConsent,
      origin,
      features,
    );
  }
  /**
   * Right after connecting: reads the server's switches before anything is shared. True when a
   * switch is on that the Connect dialog's text did not describe, so the person must agree to the
   * updated text first; sharing is held until then.
   */
  async organizationReviewAfterConnect(): Promise<boolean> {
    try {
      await this.company.checkPolicy();
    } catch {
      // The first sync checks the switches again before it shares anything.
    }
    const c = await this.company.credentials();
    return (
      !!c && !(await this.organizationAgreed(c.origin, storedFeatures(c.features)))
    );
  }
  /**
   * The person agreed, in the Connect dialog or in Settings, to the text for the switches this
   * browser last read. A version for other switches means the page showed an older text.
   */
  async agreeOrganization(version: unknown) {
    const c = await this.company.credentials();
    if (!c || (c.enrollment_state && c.enrollment_state !== "active"))
      throw new Error("policy_unavailable");
    if (version !== organizationConsentVersion(storedFeatures(c.features)))
      throw new Error(
        "What your organization's server collects has changed again. Review the updated text and agree again.",
      );
    await this.recordOrganizationConsent(version, c.origin);
  }
  private routingIdentity(
    state: Awaited<ReturnType<ApplicationRepository["routingSnapshot"]>>,
  ) {
    return JSON.stringify({
      credentials: state.credentials
        ? {
            namespace: state.credentials.namespace,
            device: state.credentials.device_id,
            era: state.credentials.enrollment_era?.id,
            origin: state.credentials.origin,
            status: state.credentials.enrollment_state ?? "active",
            deletionEpoch: state.credentials.policy?.deletion_epoch,
          }
        : null,
      personal: state.personal,
      ownership: state.ownership,
    });
  }
  private async checkedScope(): Promise<{ scope: Scope; identity: string }> {
    await this.ready;
    for (let retry = 0; retry < 3; retry++) {
      const before = await this.ledger.routingSnapshot();
      const c = before.credentials as Credentials | undefined;
      const active =
        c &&
        (!c.enrollment_state || c.enrollment_state === "active") &&
        (await this.dependencies.hasConsent(c.origin));
      const after = await this.ledger.routingSnapshot();
      const identity = this.routingIdentity(before);
      if (identity !== this.routingIdentity(after)) continue;
      if (active)
        return {
          scope: {
            namespace: c.namespace,
            mode: "company",
            era: c.enrollment_era.id,
          },
          identity,
        };
      if (!before.personal?.namespace) throw new Error("policy_unavailable");
      return {
        scope: {
          namespace: before.personal.namespace,
          mode: "personal",
          era: null,
        },
        identity,
      };
    }
    throw new Error("policy_unavailable");
  }
  async currentScope(): Promise<Scope> {
    return (await this.checkedScope()).scope;
  }
  private async keyFor(
    scope: Scope,
    site: string,
    kind: string,
    id: string,
  ): Promise<string> {
    const history = await this.ledger.readOwnershipHistory();
    const secret = history?.eras.find(
      (e) => e.scope.namespace === scope.namespace && e.scope.era === scope.era,
    )?.secret;
    if (!secret) throw new Error("policy_unavailable");
    return hmacIdentity(secret, site, kind, id);
  }
  capture(
    message: unknown,
    sender: {
      tab?: { id?: number };
      url?: string;
      frameId?: number;
      documentId?: string;
    },
    binding?: DisplayBinding,
  ): Promise<"processed" | "superseded"> {
    let host: string;
    try {
      const url = new URL(sender.url ?? "");
      if (url.protocol !== "https:") throw new Error();
      host = url.hostname;
    } catch {
      return Promise.reject(new Error("payload_rejected"));
    }
    if (
      sender.tab?.id == null ||
      sender.frameId !== 0 ||
      !validateCapture(message, host)
    )
      return Promise.reject(new Error("payload_rejected"));
    const bytes =
      2048 +
      2 *
        ((message.dispatch?.input?.length ?? 0) +
          (message.dispatch?.inlineFiles?.reduce(
            (sum, text) => sum + text.length,
            0,
          ) ?? 0) +
          (message.snapshot
            ? Object.values(snapshotCountFields(message.snapshot)).reduce(
                (sum, text) => sum + (text?.length ?? 0),
                0,
              )
            : 0));
    const jobKey = `capture:${sender.tab.id}:${sender.documentId ?? "legacy-document"}:${message.id}`;
    if (binding && !isDisplayBinding(binding, message.id))
      return Promise.reject(new Error("payload_rejected"));
    const mergeable = message.event === "progress" && !message.failure;
    const slot = mergeable ? this.queuedProgress.get(jobKey) : undefined;
    if (slot) {
      if (message.revision <= slot.message.revision)
        return Promise.resolve("superseded" as const);
      // Replace the waiting frame in place while nothing else is queued behind it.
      if (this.flights.get(jobKey) === slot.run) {
        if (this.queuedBytes - slot.bytes + bytes > CAPTURE_LIMITS.hardBytes)
          return Promise.reject(new Error("buffer_overflow"));
        this.rememberCaptureBinding(jobKey, binding, sender, message);
        this.queuedBytes += bytes - slot.bytes;
        slot.bytes = bytes;
        slot.message = message;
        const replaced = slot.owner;
        slot.owner = deferred();
        replaced.resolve("superseded");
        return slot.owner.promise;
      }
    }
    // A waiting progress frame is also replaced by the end frame, which carries the
    // same cumulative reply.
    const replaced =
      slot ??
      (message.event === "end" ? this.queuedProgress.get(jobKey) : undefined);
    const links = this.queued - (replaced ? 1 : 0);
    const after =
      this.queuedBytes - (replaced ? replaced.bytes : 0) + bytes;
    // A capture that is already running may always keep one waiting progress
    // frame; a new progress head and every other frame face the fixed limits.
    const admitted =
      mergeable && !this.flights.has(jobKey)
        ? links < CAPTURE_LIMITS.softFrames &&
          after <= CAPTURE_LIMITS.softBytes
        : links < CAPTURE_LIMITS.hardFrames &&
          after <= CAPTURE_LIMITS.hardBytes;
    if (!admitted) return Promise.reject(new Error("buffer_overflow"));
    if (replaced) this.supersedeCapture(jobKey, replaced);
    this.rememberCaptureBinding(jobKey, binding, sender, message);

    // The digest key is a local routing locator, never telemetry or a content hash.
    const previous = this.flights.get(jobKey) ?? Promise.resolve();
    const terminal = message.event === "end";
    const link: CaptureLink = {
      message,
      bytes,
      terminal,
      state: "queued",
      counted: true,
      owner: deferred(),
      run: Promise.resolve(),
    };
    this.queued++;
    this.queuedBytes += bytes;
    this.adjustWaiting(jobKey, 1, terminal);
    if (mergeable) this.queuedProgress.set(jobKey, link);
    link.run = previous
      .catch(() => {})
      .then(async () => {
        if (link.state === "superseded") return;
        link.state = "running";
        if (this.queuedProgress.get(jobKey) === link)
          this.queuedProgress.delete(jobKey);
        this.adjustWaiting(jobKey, -1, link.terminal);
        if (
          this.dependencies.hasSiteConsent &&
          !(await this.dependencies.hasSiteConsent(new URL(sender.url!).origin))
        ) {
          await this.ready;
          await this.ledger.health(
            (await this.currentScope()).namespace,
            "capture_hook_missing",
          );
          throw new Error("capture_hook_missing");
        }
        await this.process(link.message, sender.tab!.id!, jobKey);
      })
      .finally(() => {
        if (link.counted) {
          this.queued--;
          this.queuedBytes -= link.bytes;
          link.counted = false;
        }
        if (this.flights.get(jobKey) === link.run) this.flights.delete(jobKey);
      });
    this.flights.set(jobKey, link.run);
    link.run.then(
      () => link.owner.resolve("processed"),
      (error) => link.owner.reject(error),
    );
    return link.owner.promise;
  }
  private rememberCaptureBinding(
    jobKey: string,
    binding: DisplayBinding | undefined,
    sender: { tab?: { id?: number }; url?: string; documentId?: string },
    message: CaptureMessage,
  ) {
    if (!binding) return;
    // A progress frame may recover the isolated content script's pinned binding after a worker
    // restart, but it can never replace a binding already known for this capture.
    if (!this.displayBindings.has(jobKey)) {
      const url = new URL(sender.url!);
      const tabId = sender.tab!.id!;
      // The sender's address stays the page's first address after in-page navigation
      // (seen 5 Oct 2026), so the browser's own address updates name the thread.
      const route =
        message.site === "perplexity"
          ? this.tabThreads.has(tabId)
            ? (this.tabThreads.get(tabId) ?? undefined)
            : parseConversationRoute("perplexity", url.pathname)?.conversationId
          : undefined;
      // Only the send itself names the reply it follows and the thread it was sent from.
      const threadId = message.event === "dispatch" ? route : undefined;
      const parentId = message.dispatch?.parentId;
      this.displayBindings.set(jobKey, {
        tabId,
        binding: { ...binding },
        identity: null,
        documentId: sender.documentId,
        origin: url.origin,
        ...(threadId && parentId ? { followUp: { threadId, parentId } } : {}),
        // A send that names no earlier answer starts a thread. Perplexity can move the
        // page to the new thread's address before the send reaches the background
        // (5 Oct 2026), so that address may already be known. A later frame seen first
        // belongs to a capture whose binding was rebuilt, after a worker restart or a
        // navigation that dropped it; it may already be linked to the thread its page
        // shows, or be a new thread's answer. Either reply proves its thread by its own id.
        ...(message.site === "perplexity" &&
        (message.event !== "dispatch" || !parentId)
          ? { byReply: route ? { threadId: route } : {} }
          : {}),
      });
    }
    while (this.displayBindings.size > 128)
      this.displayBindings.delete(this.displayBindings.keys().next().value!);
  }
  /** A waiting frame that a newer one replaces resolves without running. */
  private supersedeCapture(jobKey: string, link: CaptureLink) {
    link.state = "superseded";
    if (this.queuedProgress.get(jobKey) === link)
      this.queuedProgress.delete(jobKey);
    this.adjustWaiting(jobKey, -1, link.terminal);
    if (link.counted) {
      this.queued--;
      this.queuedBytes -= link.bytes;
      link.counted = false;
    }
    link.owner.resolve("superseded");
  }
  private adjustWaiting(jobKey: string, change: 1 | -1, terminal: boolean) {
    const waiting = this.captureWaiting.get(jobKey) ?? { frames: 0, terminal: 0 };
    waiting.frames += change;
    if (terminal) waiting.terminal += change;
    if (waiting.frames <= 0) this.captureWaiting.delete(jobKey);
    else this.captureWaiting.set(jobKey, waiting);
  }
  private async process(
    message: CaptureMessage,
    tabId: number,
    localKey: string,
    released = false,
  ): Promise<void> {
    await this.ready;
    // Before the person agreed nothing is recorded, not even a health receipt, and no
    // organization policy overrides that (lib/tracking-consent.ts). The frame is answered as
    // delivered, as while paused, so the page sends it nowhere else.
    if (!(await this.trackingConsented())) return;
    if (await this.ledger.readPendingPolicy())
      await this.company.resolvePendingPolicy();
    const history = (await this.ledger.readOwnershipHistory())!;
    const ownership = ownershipAt(history, Date.parse(message.at));
    const scope = ownership.scope;
    const settings = await this.settings();
    const credentials = await this.company.credentials();
    const companyRequiresTracking =
      scope.mode === "company" &&
      credentials?.namespace === scope.namespace &&
      credentials.policy.pause_mode === "disabled_by_company";
    if (settings.paused && !companyRequiresTracking) return;
    if (message.event === "health") {
      await this.ledger.health(
        scope.namespace,
        failureMap[message.failure ?? ""] ?? "capture_hook_missing",
      );
      return;
    }
    if (!released && (await this.holdGuide(message, tabId, localKey, scope)))
      return;
    const installation = (await this.ledger.readInstallation())!;
    const key = await hmacIdentity(
      installation.routingSecret,
      message.site,
      "local-capture",
      localKey,
    );
    let job = await this.ledger.checkpoint(key);
    if (job && job.captureRevision >= message.revision) return;
    if (!job) {
      if (message.event !== "dispatch" || !message.dispatch) {
        await this.ledger.health(scope.namespace, "capture_body_missing");
        return;
      }
      const d = message.dispatch;
      let originalMethod: Readonly<EngineMethodIdentity> | null = null;
      try {
        originalMethod = await this.engines.admission();
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !["invalid_preference", "engine_unavailable"].includes(error.message)
        )
          throw error;
      }
      const requested = resolveModelLabel(message.site, d.model);
      const model = requested?.id ?? null;
      // Perplexity can answer with another model than the one selected (B0), so its reply
      // takes only the model the stream names.
      const attemptModel = message.site === "perplexity" ? null : model;
      const requestId = crypto.randomUUID();
      const at = new Date(message.at).toISOString();
      if (Math.abs(Date.now() - Date.parse(at)) > 86400000) {
        await this.ledger.health(scope.namespace, "clock_skew");
        return;
      }
      const conversation = await this.keyFor(
        scope,
        message.site,
        "conversation",
        d.conversationId ??
          (message.site === "perplexity" && d.requestId
            ? "provisional-request:" + d.requestId
            : crypto.randomUUID()),
      );
      const request: RequestObservation = {
        schema_version: SCHEMA_VERSION,
        kind: "request",
        request_id: requestId,
        revision: 1,
        conversation_key: conversation,
        key_version: "1",
        provider_request_key: d.requestId
          ? await this.keyFor(scope, message.site, "request", d.requestId)
          : null,
        site: message.site,
        adapter_version: "0.1.0",
        action: d.action,
        dispatched_at: at,
        ended_at: null,
        state: "dispatched",
        model_id: model,
        model_evidence: model ? "request_field" : "unknown",
        // Read aloud makes speech from a reply already shown (G1).
        features: [d.action === "read_aloud" ? "audio" : "text"],
        observed_search_operations: null,
        documents: {
          extracted_text: null,
          // Current references do not prove fresh uploads or absent retained-file processing.
          upload_count: null,
          types: d.attachments || d.attachmentPresence ? ["unknown"] : [],
          processing: "unknown",
        },
        media: emptyRequestMedia(),
        coverage_reasons: [
          "hidden_reasoning_unobserved",
          "context_unobserved",
          "provider_usage_unavailable",
          "media_processing_unobserved",
          ...(!d.conversationId
            ? ["conversation_identity_local_only" as const]
            : []),
          ...(!d.requestId ? ["cross_device_dedup_unverified" as const] : []),
        ],
        policy_version: ownership.policyVersion,
        company_dedup_key: null,
      };
      if (d.attachments || d.attachmentPresence)
        request.features.push("document");
      if (d.imageEditParentId) {
        request.features.push("image_edit", "image_input");
        request.media.input_images.push({
          count: "1",
          origin: "retained_context",
          width: null,
          height: null,
          dimension_source: "unknown",
          detail: "unknown",
          token_profile_id: null,
          tokens: unknownMeasurement("media_processing_unobserved"),
        });
      }
      // Sizes of images uploaded with the prompt, when the adapter reads them (A7).
      if (d.inputImages) {
        if (d.inputImages.length && !request.features.includes("image_input"))
          request.features.push("image_input");
        request.media.input_images.push(
          ...uploadedImages(message.site, model, d.inputImages),
        );
      }
      const attempt: AttemptObservation = {
        schema_version: SCHEMA_VERSION,
        kind: "attempt",
        attempt_id: crypto.randomUUID(),
        request_id: requestId,
        revision: 1,
        provider_attempt_key: null,
        key_version: "1",
        started_at: at,
        ended_at: null,
        timing: null,
        state: "dispatch_only",
        execution_evidence: "none",
        model_id: attemptModel,
        model_evidence: attemptModel ? "request_field" : "unknown",
        tokens: initialReplyTokens(emptyTokenFields()),
        media: emptyAttemptMedia(),
        generation: emptyGeneration(),
        coverage_reasons: [
          "hidden_reasoning_unobserved",
          "context_unobserved",
          "provider_usage_unavailable",
          "observed_text_only",
          "media_processing_unobserved",
          "cross_device_dedup_unverified",
        ],
        tokenizer_profile_id: null,
        tokenizer_asset_hash: null,
        proposed_method_id:
          originalMethod?.method_id ?? UNAVAILABLE_ADMISSION_METHOD_ID,
        company_dedup_key: null,
      };
      if (d.inputImages)
        attempt.tokens.image_input_tokens = uploadTotal(
          request.media.input_images,
        );
      const parentKey = d.parentId
        ? await this.keyFor(scope, message.site, "message", d.parentId)
        : null;
      const parentContext = parentKey
        ? (
            await this.ledger.readDerived<ContextNode, never>(scope.namespace, {
              contextKey: `${scope.namespace}:${parentKey}`,
            })
          ).context?.value
        : undefined;
      // The prompt's company key (W11), when the request carries the prompt's own id.
      const companySecret = companyKeySecret(credentials, scope);
      const promptKey =
        companySecret &&
        d.requestId &&
        PROMPT_ACTIONS.has(d.action) &&
        REQUEST_PROMPT_SITES.has(message.site)
          ? await companyKeyer(companySecret)(
              message.site,
              "company-request",
              d.requestId,
            )
          : null;
      job = {
        key,
        namespace: scope.namespace,
        ...(originalMethod
          ? { originalMethodHash: originalMethod.method_hash }
          : {}),
        scope,
        request,
        attempt,
        captureRevision: 0,
        parentKey,
        outputKey: null,
        branchId:
          d.action === "regenerate" || d.action === "edit_and_send"
            ? crypto.randomUUID()
            : (parentContext?.branchId ?? conversation),
        imageParentKey: d.imageEditParentId
          ? await this.keyFor(
              scope,
              message.site,
              "image-generation",
              d.imageEditParentId,
            )
          : null,
        ...(promptKey ? { companyKeys: { request: promptKey } } : {}),
        at: Date.now(),
      };
      await this.ledger.commitCapture({
        scope,
        observations: [request, attempt],
        checkpoint: job,
      });
      // Kept after the capture is saved, so an erasure in between leaves nothing behind.
      // Only a label that decides the reply's estimate is kept.
      const requestedLabel = attemptModel
        ? unknownModelLabel(requested, d.model)
        : null;
      if (requestedLabel)
        await keepUnknownModelLabels(
          this.ledger,
          scope.namespace,
          message.site,
          [requestedLabel],
        );
    }
    // The installation routing key and original era remain stable across enrollment changes.
    if (job.scope.namespace !== scope.namespace) return;
    const fields: CountRequest["fields"] = {};
    const inlineFiles = message.dispatch?.inlineFiles;
    let inlineSource: DerivedSource | undefined;
    let inlineErasure: number | undefined;
    if (inlineFiles !== undefined) {
      inlineSource = {
        requestId: job.request.request_id,
        requestRevision: job.request.revision,
        requestHash: payloadHash(job.request),
        attemptId: job.attempt.attempt_id,
        attemptRevision: job.attempt.revision,
        attemptHash: payloadHash(job.attempt),
      };
      const source = await this.ledger.publicationSnapshot(
        scope.namespace,
        inlineSource,
      );
      if (!source.sourceCurrent || source.erasing)
        throw new Error("derived_dependency_changed");
      inlineErasure = source.erasureVersion;
      inlineFiles?.forEach((text, index) => {
        fields[`file_${index}`] = text;
      });
    }
    if (
      message.dispatch?.input !== null &&
      message.dispatch?.input !== undefined
    )
      fields.input = message.dispatch.input;
    if (message.snapshot)
      Object.assign(fields, snapshotCountFields(message.snapshot));
    let counts: CountResponse["counts"] = {};
    // Whether the tokenizer counted this frame's text in full, for closing earlier problems.
    let counted = false;
    const countJob: CountRequest = {
      jobId: crypto.randomUUID(),
      revision: message.revision,
      modelId: job.attempt.model_id,
      implementationId: this.counting.selection.implementationId,
      profileId: this.counting.selection.profileId,
      fields,
    };
    try {
      if (Object.keys(fields).length) {
        const result = await this.dependencies.count(countJob);
        if (
          !validCountResponse(result, countJob, this.counting.manifest) ||
          (result.status !== "counted" && result.status !== "partial")
        )
          throw new Error("tokenizer_unavailable");
        counts = result.counts;
        if (result.status === "partial") {
          await this.ledger.health(scope.namespace, "tokenizer_unavailable");
        } else counted = true;
      }
    } catch {
      await this.ledger.health(scope.namespace, "tokenizer_unavailable");
    }
    const r = { ...job.request, revision: job.request.revision + 1 };
    if (inlineFiles !== undefined) {
      r.documents = {
        ...r.documents,
        extracted_text: inlineFileComponents(
          inlineFiles,
          counts,
          r.documents.extracted_text,
          job.inlineComponentIds,
          countJob,
          this.counting.manifest,
        ),
      };
      const componentIds = [...(job.inlineComponentIds ?? [])];
      r.documents.extracted_text?.forEach((component, index) => {
        componentIds[index] = component.component_id;
      });
      job = { ...job, inlineComponentIds: componentIds };
    }
    const a = {
      ...job.attempt,
      tokens: { ...job.attempt.tokens },
      revision: job.attempt.revision + 1,
      timing: message.timing,
    };
    // Lengths of the texts behind the kept counts, so a failed recount knows whether the
    // text changed since (X9). Only lengths are kept, never text.
    const countedUnits: Record<string, number> = { ...job.countedUnits };
    const changed = (field: CountField) =>
      countedUnits[field] !== fields[field]?.length;
    for (const [field, target] of TEXT_PARTS) {
      if (!Object.hasOwn(fields, field)) {
        // An adapter leaves out generated text it can no longer read (too long, or in an
        // unknown shape). The count read earlier is then a lower bound, never complete.
        const kept = a.tokens[target];
        if (
          message.snapshot &&
          GENERATED_TEXT_FIELDS.has(field) &&
          kept.value !== null &&
          kept.evidence !== "provider_reported"
        )
          a.tokens[target] = {
            ...kept,
            completeness: "partial",
            reason: "partial_capture",
          };
        continue;
      }
      a.tokens[target] = retainedCount(
        a.tokens[target],
        counts[field]?.measurement,
        changed(field),
      );
      if (counts[field]?.status === "counted") {
        a.tokenizer_profile_id = counts[field].measurement.profile_id;
        a.tokenizer_asset_hash = counts[field].assetHash;
      }
    }
    // Labels the registry does not know, kept locally once the capture is saved.
    const unknownLabels = new Set<string>();
    let servedLabel: string | null = null;
    if (message.snapshot) {
      const s = message.snapshot;
      const served = resolveModelLabel(message.site, s.model);
      const model = served?.id ?? null;
      // Progress frames repeat the label; it is kept once, when the raw label changes,
      // even if two unknown labels map to the same unlisted id.
      const unknown = unknownModelLabel(served, s.model);
      if (unknown !== null && unknown !== job.keptLabel) servedLabel = unknown;
      if (model) {
        a.model_id = model;
        a.model_evidence = "response_field";
        // Uploaded images use the rule of the model that answered, once the reply names it.
        if (r.media.input_images.some((image) => image.origin === "new_upload")) {
          r.media = {
            ...r.media,
            input_images: repriceUploads(
              message.site,
              model,
              r.media.input_images,
            ),
          };
          a.tokens.image_input_tokens = uploadTotal(r.media.input_images);
        }
      }
      if (s.conversationId) {
        r.conversation_key = await this.keyFor(
          scope,
          message.site,
          "conversation",
          s.conversationId,
        );
        r.coverage_reasons = r.coverage_reasons.filter(
          (reason) => reason !== "conversation_identity_local_only",
        );
      }
      a.execution_evidence = s.text
        ? s.text.length
          ? "content_observed"
          : "provider_started"
        : s.started
          ? "provider_started"
          : a.execution_evidence;
      if (s.started) {
        a.state = s.state;
        r.state = s.state;
      }
      if (s.state === "generating" && message.event !== "end") {
        a.ended_at = null;
        r.ended_at = null;
      }
      r.observed_search_operations =
        s.searchOperations === null ? null : String(s.searchOperations);
      if (s.searchOperations && !r.features.includes("search"))
        r.features.push("search");
      if (s.thinking && !r.features.includes("thinking"))
        r.features.push("thinking");
      a.generation = snapshotGeneration(
        message.site,
        s,
        job.attempt.generation,
        counts,
        changed,
        unknownLabels,
      );
      // A reply with stream events the tracker does not know is counted from the parts
      // it knows (D7; owner decision of 2 Oct), and a research run's agents work out of
      // sight (E1). Details names both.
      for (const reason of COVERAGE_LIMITATIONS)
        if (s.limitations.includes(reason) && !a.coverage_reasons.includes(reason))
          a.coverage_reasons = [...a.coverage_reasons, reason];
      if (s.usage) {
        a.tokens = applyProviderUsage(a.tokens, s.usage);
        a.execution_evidence = "usage_reported";
        a.coverage_reasons = a.coverage_reasons.filter(
          (reason) => reason !== "provider_usage_unavailable",
        );
        r.coverage_reasons = r.coverage_reasons.filter(
          (reason) => reason !== "provider_usage_unavailable",
        );
      }
      // Saved history matches the reply by its attempt id; the next request names the
      // reply's last answer as its parent, which keys the context chain (W6).
      const attemptId = s.attemptId ?? s.outputId;
      if (attemptId) {
        a.provider_attempt_key = await this.keyFor(
          scope,
          message.site,
          "attempt",
          attemptId,
        );
        a.coverage_reasons = a.coverage_reasons.filter(
          (v) => v !== "cross_device_dedup_unverified",
        );
      }
      if (s.outputId)
        job.outputKey = await this.keyFor(
          scope,
          message.site,
          "message",
          s.outputId,
        );
      // A saved NotebookLM answer keeps no id the stream named (16 Oct 2026), so the
      // finished reply is also kept by its content id, which the saved copy carries too.
      if (message.site === "notebooklm" && s.contentId)
        job.contentKey = await this.keyFor(
          scope,
          message.site,
          "reply-content",
          s.contentId,
        );
      if (s.providerRequestId) {
        const providerKey = await this.keyFor(
          scope,
          message.site,
          "request",
          s.providerRequestId,
        );
        if (r.provider_request_key && r.provider_request_key !== providerKey) {
          r.coverage_reasons = [
            ...new Set([
              ...r.coverage_reasons,
              "request_identity_ambiguous" as const,
            ]),
          ];
        } else {
          r.provider_request_key = providerKey;
          r.coverage_reasons = r.coverage_reasons.filter(
            (reason) => reason !== "cross_device_dedup_unverified",
          );
        }
      }
      // Company keys (W11): the same provider ids under the company's key, so members who
      // see this prompt or reply name it alike. The first key made is kept.
      const companySecret = companyKeySecret(credentials, job.scope);
      if (companySecret) {
        const sign = companyKeyer(companySecret);
        const keys = { ...job.companyKeys };
        const promptId = streamPromptId(message.site, s);
        if (!keys.request && promptId && PROMPT_ACTIONS.has(r.action))
          keys.request = await sign(message.site, "company-request", promptId);
        if (!keys.attempt && attemptId && REPLY_ACTIONS.has(r.action))
          keys.attempt = await sign(message.site, "company-attempt", attemptId);
        if (
          keys.request !== job.companyKeys?.request ||
          keys.attempt !== job.companyKeys?.attempt
        )
          job = { ...job, companyKeys: keys };
      }
      if (s.imageOperations.length) {
        a.media = emptyAttemptMedia();
        a.media.coverage_reasons = [
          "image_settings_unknown",
          "model_unverified",
        ];
        r.media = {
          ...r.media,
          requested_operations: [],
          coverage_reasons: ["image_settings_unknown"],
        };
        for (const operation of s.imageOperations) {
          const key = await this.keyFor(
            scope,
            message.site,
            "image-generation",
            operation.id,
          );
          if (
            operation.kind === "image_edit" &&
            job.imageParentKey &&
            (!operation.parentId ||
              (await this.keyFor(
                scope,
                message.site,
                "image-generation",
                operation.parentId,
              )) !== job.imageParentKey)
          )
            throw new Error("conflicting_duplicate_identity");
          const first = operation.outputs[0];
          const settings = {
            ...unknownMediaSettings(),
            width: first?.width ?? null,
            height: first?.height ?? null,
          };
          a.media.image_operations.push({
            operation_key: key,
            kind: operation.kind,
            requested_count:
              operation.requestedCount === null
                ? null
                : String(operation.requestedCount),
            returned_count: operation.outputs.length
              ? String(operation.outputs.length)
              : null,
            state: operation.state,
            execution_evidence: operation.outputs.length
              ? "content_observed"
              : "provider_started",
            settings,
            model_id: null,
            model_evidence: "unknown",
          });
          r.media.requested_operations.push({
            operation_key: key,
            kind: operation.kind,
            requested_count:
              operation.requestedCount === null
                ? null
                : String(operation.requestedCount),
            settings: unknownMediaSettings(),
          });
          for (const output of operation.outputs)
            a.media.generated_images.push({
              operation_key: key,
              count: "1",
              width: output.width,
              height: output.height,
              dimension_source: "unknown",
              settings,
            });
          const feature =
            operation.kind === "image_edit" ? "image_edit" : "image_generation";
          if (!r.features.includes(feature)) r.features.push(feature);
        }
        a.execution_evidence = s.imageOperations.some(
          (operation) => operation.outputs.length > 0,
        )
          ? "content_observed"
          : "provider_started";
      }
    }
    if (message.event === "end") {
      const terminal =
        a.state === "completed" ||
        a.state === "cancelled" ||
        a.state === "failed"
          ? a.state
          : "interrupted_unconfirmed";
      a.state = terminal;
      r.state = terminal;
      a.ended_at = new Date().toISOString();
      r.ended_at = a.ended_at;
      if (terminal === "interrupted_unconfirmed")
        a.coverage_reasons = [
          ...new Set([
            ...a.coverage_reasons,
            "unknown_terminal_state" as const,
          ]),
        ];
    }
    if (message.failure) {
      const failure = failureMap[message.failure] ?? "partial_capture";
      a.coverage_reasons = [...new Set([...a.coverage_reasons, failure])];
      if (failure === "partial_capture") {
        r.coverage_reasons = [...new Set([...r.coverage_reasons, failure])];
        // A later file receipt cannot resolve a separate stream capture failure.
        job.uploadPartialAdded = false;
      }
      await this.ledger.health(scope.namespace, failure);
    }
    // The output total is the sum of its parts unless the provider reported it.
    if (!providerTotal(a.tokens))
      a.tokens.output_total = composeOutputTotal(a.tokens);
    // Inline files are counted as request components, not reply parts, so only the
    // reply's own fields are tracked here.
    for (const [field, text] of Object.entries(fields))
      if (
        text !== undefined &&
        !field.startsWith("file_") &&
        counts[field as CountField]?.status === "counted"
      )
        countedUnits[field] = text.length;
    const budget = selectContextBudget(a.model_id, settings.budget);
    const guidanceKey = `${scope.namespace}:${r.conversation_key}:${job.branchId}:${a.model_id ?? "unknown"}:${budget?.version ?? "none"}:${budget?.tokens ?? "none"}`;
    const derived = await this.ledger.readDerived<
      ContextNode,
      { state: GuidanceState }
    >(scope.namespace, {
      contextKey: job.parentKey
        ? `${scope.namespace}:${job.parentKey}`
        : undefined,
      guidanceKey,
    });
    const prior = derived.context?.value;
    const guidanceLineage = derived.guidance
      ? {
          key: guidanceKey,
          actionToken: derived.guidance.actionToken,
          actionRevision: derived.guidance.actionRevision,
        }
      : undefined;
    const input = a.tokens.new_input_text;
    // Read aloud and notebook guides are not turns: the chat's context is not their
    // input, and they leave the chat's context advice as it was (G1, W9).
    const speech = sideCapture(r.action);
    if (
      a.tokens.logical_input_total.evidence === "provider_reported" ||
      speech
    ) {
      // The provider's own input count already covers the earlier conversation.
    } else if (input.value !== null && (!job.parentKey || prior)) {
      const value = (
        BigInt(input.value) + BigInt(prior?.tokens ?? "0")
      ).toString();
      a.tokens.logical_input_total = {
        ...input,
        value,
        scope: "reconstructed_context",
        completeness: "partial",
        reason: "context_unobserved",
      };
    } else if (job.parentKey) {
      a.tokens.logical_input_total = unknownMeasurement("context_unobserved");
    }
    let derivationValid = true;
    let estimated = false;
    const capturedJob = job;
    const persist = async (guard = true) => {
      const calculated = await this.captureEstimate(
        scope,
        r,
        a,
        capturedJob.originalMethodHash,
      );
      const envelope = calculated.result;
      // Keep the established original-engine read format while retaining the complete envelope separately.
      const estimate =
        envelope?.requested_method.engine_id === "original" &&
        envelope.raw?.engine_id === "original" &&
        !Array.isArray(envelope.raw.result)
          ? envelope.raw.result
          : envelope;
      job = {
        ...capturedJob,
        request: r,
        attempt: a,
        captureRevision: message.revision,
        countedUnits,
        ...(servedLabel ? { keptLabel: servedLabel } : {}),
      };
      await this.ledger.commitCapture({
        scope,
        observations: [r, a],
        checkpoint: job,
        ...(envelope && estimate
          ? { originals: [envelope], archivedEstimates: [estimate] }
          : {}),
        currentEstimate: { attemptId: a.attempt_id, estimate },
        guard:
          guard || inlineSource
            ? {
                erasureVersion: inlineErasure ?? derived.erasureVersion,
                dependencies: [
                  ...(guard && derived.context ? [derived.context.source] : []),
                  ...(inlineSource ? [inlineSource] : []),
                ],
                guidance: guard && !speech ? guidanceLineage : undefined,
                advanceGuidanceTo:
                  guard && !speech
                  ? {
                      requestId: r.request_id,
                      attemptId: a.attempt_id,
                    }
                  : undefined,
              }
            : undefined,
      });
      // Progress frames repeat component and image labels, so those are kept at the end.
      const labels = new Set(message.event === "end" ? unknownLabels : []);
      if (servedLabel) labels.add(servedLabel);
      if (labels.size)
        await keepUnknownModelLabels(
          this.ledger,
          scope.namespace,
          message.site,
          labels,
        );
      if (calculated.reason)
        await this.ledger.health(scope.namespace, calculated.reason);
      estimated = !!envelope && !calculated.reason;
    };
    // Owner decision of 16 Oct 2026: a reply that was read, counted and saved closes the
    // problems of that work. Problems this reply carries itself stay open.
    const solveAfterReply = async () => {
      if (message.event !== "end") return;
      const successes: HealthSuccess[] = ["record_saved"];
      if (!message.failure) successes.push("reply_read");
      if (counted) successes.push("reply_counted");
      if (estimated) successes.push("estimate_made");
      await solveHealth(this.ledger, scope.namespace, successes, [
        ...a.coverage_reasons,
        ...r.coverage_reasons,
      ]);
    };
    try {
      await persist();
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== "derived_dependency_changed"
      )
        throw error;
      // Keep directly observed quantities while refusing reconstruction from a changed cache basis.
      if (derived.context)
        a.tokens.logical_input_total = unknownMeasurement("context_unobserved");
      derivationValid = false;
      await persist(false);
    }
    if (r.provider_request_key)
      await this.ledger.coalesceProviderIdentity(
        scope.namespace,
        "request",
        r.provider_request_key,
      );
    if (a.provider_attempt_key)
      await this.ledger.coalesceProviderIdentity(
        scope.namespace,
        "attempt",
        a.provider_attempt_key,
      );
    const settled = a.state !== "generating" && a.state !== "dispatch_only";
    // A newer frame of this reply is already waiting and will publish. Skipping this
    // frame's display keeps the bar from replaying old figures, while a streaming
    // reply still updates at least every couple of seconds.
    const waiting = this.captureWaiting.get(localKey);
    const superseded =
      message.event === "progress" &&
      !message.failure &&
      !!waiting &&
      (waiting.terminal > 0 ||
        Date.now() - (this.lastPublishAt.get(localKey) ?? 0) <
          CAPTURE_LIMITS.publishIntervalMs);
    // Publish after estimation has processed this observation. A pass already running
    // may predate this commit, so settle with a fresh pass, and do it before the derived
    // context is written, as for the final frame.
    if (!superseded) await this.engines.settleLocal(settled ? 3000 : 750);
    let activeContext: string | null = null;
    if (
      a.tokens.logical_input_total.value !== null &&
      a.tokens.answer_output.value !== null
    ) {
      activeContext = (
        BigInt(a.tokens.logical_input_total.value) +
        BigInt(a.tokens.answer_output.value)
      ).toString();
    }
    // The stored context stays the tokenizer's count, because the next turn adds to it; the
    // advice and Details show it with the Claude token factor (owner decision, 15 Oct 2026).
    const shownContext = countedContext(r.site, a.model_id, a.tokens);
    let guidance = contextGuidance(
      shownContext,
      budget?.tokens ?? null,
      derivationValid ? derived.guidance?.value.state : undefined,
    );
    const source = {
      requestId: r.request_id,
      requestRevision: r.revision,
      requestHash: await digest(r),
      attemptId: a.attempt_id,
      attemptRevision: a.revision,
      attemptHash: await digest(a),
    };
    const dependencies = [
      derived.context?.source,
      derived.guidance?.source,
    ].filter(
      (value): value is typeof source =>
        !!value &&
        !(
          value.requestId === source.requestId &&
          value.attemptId === source.attemptId
        ),
    );
    const derivedSaved =
      derivationValid &&
      !speech &&
      (await this.ledger.writeDerived(
        scope.namespace,
        source,
        {
          erasureVersion: derived.erasureVersion,
          dependencies,
          guidance: guidanceLineage,
        },
        {
          context:
            job.outputKey && activeContext !== null
              ? {
                  key: `${scope.namespace}:${job.outputKey}`,
                  value: {
                    tokens: activeContext,
                    branchId: job.branchId,
                    at: Date.now(),
                  },
                }
              : undefined,
          guidance: { key: guidanceKey, value: { state: guidance.state } },
        },
      ));
    const storedGuidance = derivedSaved
      ? (
          await this.ledger.readDerived<never, { state: GuidanceState }>(
            scope.namespace,
            { guidanceKey },
          )
        ).guidance
      : undefined;
    if (storedGuidance)
      guidance = {
        ...guidance,
        state: storedGuidance.value.state,
        show:
          guidance.show &&
          !storedGuidance.value.state.dismissed &&
          Date.now() >= (storedGuidance.value.state.snoozedUntil ?? 0),
      };
    if (
      scope.mode === "company" &&
      (await this.currentScope()).namespace !== scope.namespace
    )
      return;
    const context = this.displayBindings.get(localKey);
    const observedConversationId =
      message.snapshot?.conversationId ?? message.dispatch?.conversationId;
    if (
      context &&
      message.site !== "perplexity" &&
      isRouteConversationId(message.site, observedConversationId)
    )
      context.identity = {
        site: message.site as RouteSite,
        conversationId: observedConversationId,
      };
    // The end frame may have arrived while this frame settled; it publishes the
    // same reply, so showing this one first would only delay the final figures.
    if (
      superseded ||
      (message.event === "progress" &&
        !message.failure &&
        (this.captureWaiting.get(localKey)?.terminal ?? 0) > 0)
    ) {
      void this.engines.maintainLocal();
      return;
    }
    // Read aloud speaks a reply of a chat the tab already shows (G1), and a notebook guide
    // is written beside it (W9). The page never selects such a capture, so a display of its
    // own would be discarded and would stop the shown reply from updating. The shown reply
    // is published again instead.
    if (sideCapture(r.action)) {
      if (message.event === "end") {
        await solveAfterReply();
        await this.republishAfterSpeech(tabId, localKey, r, scope);
      } else void this.engines.maintainLocal();
      return;
    }
    // A Perplexity reply joins the thread the tab shows as soon as there is proof, so the
    // bar counts it live as on other sites (owner, 5 Oct 2026). A follow-up is linked
    // when it is sent; a new thread's first answer once its id and the thread the tab
    // opened are both known (noteThreadRoute). A link that fails is tried once more when
    // the reply ends, then waits for the page's next read of the thread.
    if (
      r.site === "perplexity" &&
      context &&
      !context.thread &&
      r.provider_request_key
    ) {
      const opened = context.byReply?.threadId;
      if (
        context.followUp &&
        (message.event === "dispatch" || message.event === "end")
      )
        await this.linkLiveReply(scope, context, {
          threadId: context.followUp.threadId,
          requestKey: r.provider_request_key,
          dispatchedAt: r.dispatched_at,
          parentId: context.followUp.parentId,
        });
      else if (
        opened &&
        a.provider_attempt_key &&
        (message.event === "end" || context.byReply!.tried !== opened)
      ) {
        context.byReply!.tried = opened;
        await this.linkLiveReply(scope, context, {
          threadId: opened,
          requestKey: r.provider_request_key,
          dispatchedAt: r.dispatched_at,
          attemptKey: a.provider_attempt_key,
        });
      }
    }
    const version = crypto.randomUUID();
    this.displayVersions.set(tabId, version);
    if (context)
      this.displayDocuments.set(tabId, context.binding.documentNonce);
    if (this.displayVersions.size > 128) {
      const oldest = this.displayVersions.keys().next().value!;
      this.displayVersions.delete(oldest);
      this.publishedCaptures.delete(oldest);
      this.displayDocuments.delete(oldest);
      this.pendingCalc.delete(oldest);
    }
    const basis: CapturePublication = {
      scope,
      r,
      a,
      source,
      activeContext: shownContext,
      budget,
      guidance,
      storedGuidance,
      guidanceKey,
      derivedSaved,
      erasureVersion: derived.erasureVersion,
    };
    const publish = (remoteView?: any, current = false) =>
      this.publishCapture(
        localKey,
        tabId,
        version,
        basis,
        remoteView,
        false,
        current,
      );
    try {
      await publish();
      this.lastPublishAt.delete(localKey);
      this.lastPublishAt.set(localKey, Date.now());
      while (this.lastPublishAt.size > 128)
        this.lastPublishAt.delete(this.lastPublishAt.keys().next().value!);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "aggregate_inconsistent")
        throw error;
      // The observation is saved; only its figures could not be shown. Retry the
      // display after the calculation settles instead of reporting a lost capture.
      this.pendingCalc.set(tabId, {
        localKey,
        version,
        attempts: 0,
        failures: 0,
        exhausted: true,
      });
      this.scheduleCalculationRetry();
    }
    // After the display, so closing problems never delays the figures.
    await solveAfterReply();
    if (scope.mode === "company") {
      if (this.displayWork.size >= 16) {
        await this.ledger.health(scope.namespace, "sync_delayed");
        return;
      }
      // Once a newer display of this tab exists, this frame's figures are never sent.
      const replaced = () => this.displayVersions.get(tabId) !== version;
      // An erasure since this frame is not a passing change. The server can still be
      // erasing the range in pages when this device applies its instruction, so an
      // immediate read could show and cache figures being deleted. A later display
      // reads again.
      const erased = async () =>
        (await this.ledger.summaryVersion(scope.namespace)).erasureVersion !==
        basis.erasureVersion;
      const sharedView = (force: boolean) => {
        if (context?.thread)
          return this.activeThreadView(scope, context.thread.key);
        // A forced read follows an upload, so it must not join a read that may reuse
        // the server summary cached before that upload.
        const key =
          scope.namespace + ":" + r.conversation_key + (force ? ":fresh" : "");
        let flight = this.conversationFlights.get(key);
        if (!flight) {
          flight = this.conversationView(
            scope,
            r.conversation_key,
            force ? 0 : 10000,
          ).finally(() => this.conversationFlights.delete(key));
          this.conversationFlights.set(key, flight);
        }
        return flight;
      };
      // A shared read is rejected when the local calculation changes before it ends,
      // for example when this reply's end frame commits during a read an earlier
      // frame started. The rejected read has already left the shared slot, so the
      // next attempt is a complete new guarded read after the calculation settles.
      const refresh = (force = false) =>
        this.publishCurrentView(
          () => sharedView(force),
          (view) => publish(view, true),
          async () => replaced() || (await erased()),
        );
      const work = (async () => {
        try {
          await refresh();
        } catch (error) {
          // The reply's records upload even when its figures could not be read first;
          // the read after the upload shows them.
          if (
            message.event !== "end" ||
            !calculationChanged(error) ||
            (await erased())
          )
            throw error;
        }
        if (
          message.event === "end" &&
          (await this.currentScope()).namespace === scope.namespace
        ) {
          await this.company.sync();
          await refresh(true);
        }
      })().catch(async (error) => {
        // A newer display of this tab shows later figures, so this rejected read delays nothing.
        if (calculationChanged(error) && replaced()) return;
        if (
          error instanceof Error &&
          [
            "aggregate_inconsistent",
            "selection_conflict",
            "policy_unavailable",
          ].includes(error.message)
        ) {
          // A rejected remote view still needs a fresh local publication to clear obsolete visible totals.
          await publish().catch(() => {});
        }
        await this.ledger
          .health(scope.namespace, "sync_delayed")
          .catch(() => {});
      });
      this.displayWork.add(work);
      void work.finally(() => {
        this.displayWork.delete(work);
        this.wakeFileDisplays();
      });
    }
  }
  private async promoteRecordedCapture(
    match: RecordedThreadMatch,
    current: () => void,
  ) {
    // The bounded capture map may include a committed capture whose first display is still in flight.
    // Retain proof for that original binding without choosing it over a newer selected capture.
    for (const [key, context] of [...this.displayBindings]) {
      if (
        context.tabId === match.tabId &&
        context.documentId === match.documentId &&
        context.binding.documentNonce === match.binding.documentNonce &&
        context.binding.navigationNonce === match.binding.navigationNonce
      )
        await this.matchRecordedCapture(key, match, current);
    }
  }
  private linkLiveReply(
    scope: Scope,
    context: { binding: DisplayBinding; tabId: number; documentId?: string },
    proof: { threadId: string; requestKey: string; dispatchedAt: string } & (
      | { parentId: string }
      | { attemptKey: string }
    ),
  ) {
    return this.threads
      .linkLiveReply({
        scope,
        binding: context.binding,
        tabId: context.tabId,
        documentId: context.documentId,
        ...proof,
      })
      .catch(() =>
        this.ledger.health(scope.namespace, "sync_delayed").catch(() => {}),
      );
  }
  /**
   * The tab opened a Perplexity thread. A new thread opens at its first answer's id while
   * the answer streams, often before the reply's id reaches the extension, so a reply
   * sent from outside a thread in this page is linked when its id is known (process) or
   * now if it already is. The id must equal the thread's id (linkLiveReply).
   */
  async noteThreadRoute(
    tabId: number,
    documentId: string | undefined,
    threadId: string,
  ) {
    if (!isRouteConversationId("perplexity", threadId)) return;
    const links: Promise<unknown>[] = [];
    for (const [localKey, context] of this.displayBindings) {
      if (
        context.tabId !== tabId ||
        context.documentId !== documentId ||
        !context.byReply ||
        context.thread
      )
        continue;
      context.byReply.threadId = threadId;
      // After the frame being saved, whose attempt key a link needs.
      const link = (this.flights.get(localKey) ?? Promise.resolve())
        .catch(() => {})
        .then(async () => {
          if (
            this.displayBindings.get(localKey) !== context ||
            context.thread ||
            context.byReply?.threadId !== threadId ||
            context.byReply.tried === threadId
          )
            return;
          const job = await this.uploadJob(localKey);
          if (
            !job ||
            job.request.site !== "perplexity" ||
            !job.request.provider_request_key ||
            !job.attempt.provider_attempt_key ||
            context.byReply.tried === threadId
          )
            return;
          context.byReply.tried = threadId;
          await this.linkLiveReply(job.scope, context, {
            threadId,
            requestKey: job.request.provider_request_key,
            dispatchedAt: job.request.dispatched_at,
            attemptKey: job.attempt.provider_attempt_key,
          });
        })
        .catch(() =>
          this.currentScope()
            .then((scope) => this.ledger.health(scope.namespace, "sync_delayed"))
            .catch(() => {}),
        );
      links.push(link);
    }
    await Promise.all(links);
  }
  private invalidateRecordedCaptures() {
    this.threads.invalidateAll();
    this.history.invalidate();
    for (const context of this.displayBindings.values())
      if (context.thread) {
        context.thread = undefined;
        context.identity = null;
      }
  }
  private async matchRecordedCapture(
    localKey: string,
    match: RecordedThreadMatch,
    current: () => void,
  ) {
    const selected = this.publishedCaptures.get(match.tabId);
    const context = this.displayBindings.get(localKey);
    if (
      !context ||
      context.documentId !== match.documentId ||
      context.binding.documentNonce !== match.binding.documentNonce ||
      context.binding.navigationNonce !== match.binding.navigationNonce
    )
      return;
    const job = await this.uploadJob(localKey);
    if (
      !job ||
      job.request.site !== "perplexity" ||
      canonicalJson(job.scope) !== canonicalJson(match.scope) ||
      !job.request.provider_request_key ||
      Date.parse(job.request.dispatched_at) < match.ownershipStart ||
      (!match.providerKeys.includes(job.request.provider_request_key) &&
        context.thread?.key !== match.threadKey)
    )
      return;
    const source: DerivedSource = {
      requestId: job.request.request_id,
      requestRevision: job.request.revision,
      requestHash: payloadHash(job.request),
      attemptId: job.attempt.attempt_id,
      attemptRevision: job.attempt.revision,
      attemptHash: payloadHash(job.attempt),
    };
    const routing = await this.checkedScope();
    if (canonicalJson(routing.scope) !== canonicalJson(job.scope)) return;
    if (
      this.dependencies.hasSiteConsent &&
      !(await this.dependencies.hasSiteConsent(context.origin))
    )
      return;
    const after = await this.ledger.publicationSnapshot(
      job.namespace,
      source,
      undefined,
      {
        key: match.threadKey,
        providerRequestKey: job.request.provider_request_key,
      },
    );
    if (
      this.displayBindings.get(localKey) !== context ||
      this.routingIdentity(after) !== routing.identity ||
      after.trackingPaused ||
      after.ownership?.start !== match.ownershipStart ||
      !after.threadCurrent ||
      after.erasureVersion !== match.erasureVersion
    )
      return;
    current();
    // This identity comes only from committed membership of the original request in a reviewed GET.
    context.identity = { site: "perplexity", conversationId: match.threadId };
    if (
      context.thread?.key !== match.threadKey ||
      context.thread.erasureVersion !== match.erasureVersion
    )
      context.thread = {
        key: match.threadKey,
        erasureVersion: match.erasureVersion,
        ownershipStart: match.ownershipStart,
      };
    if (
      selected?.localKey === localKey &&
      this.publishedCaptures.get(match.tabId) === selected &&
      this.displayVersions.get(match.tabId) === selected.version
    )
      this.refreshFileDisplays(
        job.scope,
        job.request.conversation_key,
        match.threadKey,
      );
  }
  private refreshFileDisplays(
    scope: Scope,
    conversationKey: string,
    threadKey?: string,
  ) {
    const key = scope.namespace + ":" + conversationKey;
    if (
      !this.fileDisplayPending.has(key) &&
      this.fileDisplayPending.size >= 32
    ) {
      this.dependencies.fileFailure?.("sync_delayed");
      return;
    }
    this.fileDisplayPending.set(key, {
      scope,
      conversationKey,
      threadKey,
      expires: Date.now() + 300000,
    });
    this.wakeFileDisplays();
  }
  private wakeFileDisplays() {
    if (
      this.fileDisplayWork ||
      this.displayWake ||
      (!this.fileDisplayPending.size && !this.calculationDirty)
    )
      return;
    if (this.displayWork.size >= 16) {
      // One completion subscription wakes the retained set when a real slot opens.
      if (!this.displayCapacity) {
        const wait = Promise.race([...this.displayWork])
          .catch(() => {})
          .finally(() => {
            if (this.displayCapacity === wait) this.displayCapacity = null;
            this.deferFileDisplays();
          });
        this.displayCapacity = wait;
      }
      return;
    }
    this.deferFileDisplays();
  }
  private deferFileDisplays() {
    if (
      this.displayWake ||
      this.fileDisplayWork ||
      (!this.fileDisplayPending.size && !this.calculationDirty)
    )
      return;
    let resolve!: () => void;
    const promise = new Promise<void>((done) => (resolve = done));
    const timer = setTimeout(() => {
      this.displayWake = null;
      this.runFileDisplays();
      resolve();
    }, 0);
    this.displayWake = { timer, promise, resolve };
  }
  private runFileDisplays() {
    if (
      this.fileDisplayWork ||
      (!this.fileDisplayPending.size && !this.calculationDirty)
    )
      return;
    if (this.displayWork.size >= 16) {
      this.wakeFileDisplays();
      return;
    }
    const work = (async () => {
      for (
        let pass = 0;
        pass < 3 && (this.fileDisplayPending.size || this.calculationDirty);
        pass++
      ) {
        const changes = [...this.fileDisplayPending.values()].filter(
          (change) => change.expires > Date.now(),
        );
        this.fileDisplayPending.clear();
        const calculation = this.calculationDirty;
        this.calculationDirty = false;
        for (const [tabId, selected] of changes.length
          ? [...this.publishedCaptures]
          : []) {
          const job = await this.uploadJob(selected.localKey);
          if (
            !job ||
            !changes.some(
              (change) =>
                canonicalJson(change.scope) === canonicalJson(job.scope) &&
                (change.conversationKey === job.request.conversation_key ||
                  (!!change.threadKey &&
                    change.threadKey ===
                      this.displayBindings.get(selected.localKey)?.thread
                        ?.key)),
            )
          )
            continue;
          if (
            this.publishedCaptures.get(tabId) !== selected ||
            this.displayVersions.get(tabId) !== selected.version
          )
            continue;
          await this.republishSelected(
            tabId,
            selected.localKey,
            selected.version,
            job,
            "file",
          );
        }
        if (calculation) await this.republishPendingCalculations();
      }
    })()
      .catch(() => this.dependencies.fileFailure?.("sync_delayed"))
      .finally(() => {
        this.fileDisplayWork = null;
        this.displayWork.delete(work);
        this.wakeFileDisplays();
      });
    this.fileDisplayWork = work;
    this.displayWork.add(work);
  }
  /**
   * Shows the tab's reply of the same chat again with the new totals after read aloud.
   * A page that shows saved totals instead reads them again itself. In company mode the
   * speech is synced at once, as a reply is, and the reply shown again from the server.
   */
  private async republishAfterSpeech(
    tabId: number,
    localKey: string,
    r: RequestObservation,
    scope: Scope,
  ) {
    const shown = this.publishedCaptures.get(tabId);
    const installation = await this.ledger.readInstallation();
    const job =
      shown &&
      shown.localKey !== localKey &&
      this.displayVersions.get(tabId) === shown.version &&
      installation
        ? await this.ledger.checkpoint(
            await hmacIdentity(
              installation.routingSecret,
              r.site,
              "local-capture",
              shown.localKey,
            ),
          )
        : undefined;
    const current = () =>
      !!shown &&
      !!job &&
      job.scope.namespace === scope.namespace &&
      job.request.conversation_key === r.conversation_key &&
      this.publishedCaptures.get(tabId)?.localKey === shown.localKey &&
      this.displayVersions.get(tabId) === shown.version;
    if (current())
      await this.republishSelected(
        tabId,
        shown!.localKey,
        shown!.version,
        job!,
        "calculation",
      );
    if (scope.mode !== "company") return;
    if (this.displayWork.size >= 16) {
      await this.ledger.health(scope.namespace, "sync_delayed");
      return;
    }
    const work = (async () => {
      if ((await this.currentScope()).namespace !== scope.namespace) return;
      await this.company.sync();
      if (current())
        await this.republishSelected(
          tabId,
          shown!.localKey,
          shown!.version,
          job!,
          "calculation",
          true,
        );
    })().catch(() =>
      this.ledger.health(scope.namespace, "sync_delayed").catch(() => {}),
    );
    this.displayWork.add(work);
    void work.finally(() => {
      this.displayWork.delete(work);
      this.wakeFileDisplays();
    });
  }
  /** Rebuilds a published capture display from its saved job. */
  private async republishSelected(
    tabId: number,
    localKey: string,
    version: string,
    job: TrackingJob,
    mode: "file" | "calculation",
    fresh = false,
  ) {
    const { request: r, attempt: a, scope } = job;
    const source: DerivedSource = {
      requestId: r.request_id,
      requestRevision: r.revision,
      requestHash: payloadHash(r),
      attemptId: a.attempt_id,
      attemptRevision: a.revision,
      attemptHash: payloadHash(a),
    };
    const budget = selectContextBudget(
      a.model_id,
      (await this.settings()).budget,
    );
    const guidanceKey =
      scope.namespace +
      ":" +
      r.conversation_key +
      ":" +
      job.branchId +
      ":" +
      (a.model_id ?? "unknown") +
      ":" +
      (budget?.version ?? "none") +
      ":" +
      (budget?.tokens ?? "none");
    const derived = await this.ledger.readDerived<
      never,
      { state: GuidanceState }
    >(scope.namespace, { guidanceKey });
    const storedGuidance = derived.guidance;
    const activeContext = countedContext(r.site, a.model_id, a.tokens);
    const guidance = contextGuidance(
      activeContext,
      budget?.tokens ?? null,
      storedGuidance?.value.state,
    );
    const basis: CapturePublication = {
      scope,
      r,
      a,
      source,
      activeContext,
      budget,
      guidance,
      storedGuidance,
      guidanceKey,
      derivedSaved:
        !!storedGuidance &&
        canonicalJson(storedGuidance.source) === canonicalJson(source),
      erasureVersion: derived.erasureVersion,
    };
    const thread = this.displayBindings.get(localKey)?.thread;
    if (mode === "calculation") {
      // A company display republishes once from the recent shared view, so a
      // recalculation does not fetch the server for every open chat. After a sync the
      // view is read again.
      const read = async () =>
        scope.mode === "company"
          ? thread
            ? await this.activeThreadView(scope, thread.key)
            : await this.conversationView(
                scope,
                r.conversation_key,
                fresh ? 0 : 10000,
              )
          : undefined;
      if (!fresh) {
        // The recent view only saves a server read; a read that changed shows local figures.
        const view = await read().catch((error) => {
          if (calculationChanged(error)) return undefined;
          throw error;
        });
        await this.publishCapture(localKey, tabId, version, basis, view, true);
        return;
      }
      // The read after the sync is made again while the calculation changes, as a
      // reply's is. An erasure since this display ends the retries, because the
      // server can still be erasing that range.
      await this.publishCurrentView(
        read,
        (view) =>
          this.publishCapture(
            localKey,
            tabId,
            version,
            basis,
            view,
            true,
            true,
          ),
        async () =>
          this.displayVersions.get(tabId) !== version ||
          (await this.ledger.summaryVersion(scope.namespace)).erasureVersion !==
            basis.erasureVersion,
      );
      return;
    }
    await this.publishCapture(localKey, tabId, version, basis, undefined, true);
    if (
      scope.mode === "company" &&
      this.publishedCaptures.get(tabId)?.version === version
    )
      // As after a reply: a read the calculation overtook is made again, three at most.
      await this.publishCurrentView(
        async () =>
          thread
            ? await this.activeThreadView(scope, thread.key)
            : await this.conversationView(scope, r.conversation_key, 0),
        (view) =>
          this.publishCapture(localKey, tabId, version, basis, view, true, true),
        async () =>
          this.displayVersions.get(tabId) !== version ||
          (await this.ledger.summaryVersion(scope.namespace)).erasureVersion !==
            basis.erasureVersion,
      );
  }
  /** Displays that waited for recalculation are rebuilt once it publishes, a few times at most. */
  private async republishPendingCalculations() {
    for (const [tabId, entry] of [...this.pendingCalc]) {
      if (this.pendingCalc.get(tabId) !== entry) continue;
      if (
        this.displayVersions.get(tabId) !== entry.version ||
        (!entry.exhausted &&
          this.publishedCaptures.get(tabId)?.version !== entry.version) ||
        entry.attempts >= 5
      ) {
        this.pendingCalc.delete(tabId);
        continue;
      }
      // A frame still waiting or running for this reply publishes newer figures itself.
      if (this.flights.has(entry.localKey)) continue;
      entry.attempts++;
      try {
        const job = await this.uploadJob(entry.localKey);
        if (!job) {
          this.pendingCalc.delete(tabId);
          continue;
        }
        await this.republishSelected(
          tabId,
          entry.localKey,
          entry.version,
          job,
          "calculation",
        );
      } catch {
        entry.failures++;
        if (entry.failures < 3 || this.pendingCalc.get(tabId) !== entry) {
          this.scheduleCalculationRetry();
          continue;
        }
        this.pendingCalc.delete(tabId);
        // The figures could not be shown after several tries. The page marks this
        // until its next display, which clears it.
        const binding = this.displayBindings.get(entry.localKey)?.binding;
        if (binding)
          await this.dependencies
            .sendDisplay(tabId, {
              target: "footprint-display-stale",
              displayBinding: { ...binding },
              conversationIdentity: null,
            })
            .catch(() => {});
      }
    }
  }
  private scheduleCalculationRetry() {
    if (this.calculationRetry) return;
    const timer = setTimeout(() => {
      this.calculationRetry = null;
      if (!this.pendingCalc.size) return;
      this.calculationDirty = true;
      this.wakeFileDisplays();
    }, 1500);
    (timer as any).unref?.();
    this.calculationRetry = timer;
  }
  private async activeThreadView(scope: Scope, threadKey: string) {
    const key = scope.namespace + ":recorded-thread:" + threadKey;
    const existing = this.conversationFlights.get(key);
    if (existing) return existing;
    const flight = this.loadActiveThreadView(scope, threadKey).finally(() =>
      this.conversationFlights.delete(key),
    );
    this.conversationFlights.set(key, flight);
    return flight;
  }
  private async loadActiveThreadView(scope: Scope, threadKey: string) {
    const before = await this.ledger.publicationSnapshot(scope.namespace);
    const view = await this.threads.view(scope, threadKey);
    const after = await this.ledger.publicationSnapshot(scope.namespace);
    if (
      after.erasing ||
      before.erasureVersion !== after.erasureVersion ||
      this.routingIdentity(before) !== this.routingIdentity(after)
    )
      return;
    // Saved totals changed during the read, as when a reply's later frames commit. That
    // is a passing change, so the caller reads again (publishCurrentView), as it does for
    // a conversation, instead of showing this browser's figures alone.
    if (before.version !== after.version)
      throw new Error("aggregate_inconsistent");
    return {
      ...view,
      threadKey,
      version: after.version,
      erasureVersion: after.erasureVersion,
    };
  }
  /**
   * Reads the company view of a capture's chat and shows it with `publish`. A read is
   * rejected when the local calculation changes before it ends, and `publish` returns
   * "stale" when it changes after the read but before the display is built. Both are
   * passing changes, so the calculation settles and a complete new guarded read
   * follows, three reads at most. `stop` ends the retries early, for example once a
   * newer display replaced this one. Throws the last rejected read's error, or
   * `aggregate_inconsistent` when the last figures were stale; other errors pass on.
   */
  private async publishCurrentView(
    read: () => Promise<unknown>,
    publish: (view: unknown) => Promise<"stale" | undefined>,
    stop: () => Promise<boolean>,
  ) {
    for (let attempt = 1; ; attempt++) {
      let refused: unknown = null;
      let view: unknown;
      try {
        view = await read();
      } catch (error) {
        if (!calculationChanged(error)) throw error;
        refused = error;
      }
      if (!refused && (await publish(view)) !== "stale") return;
      if (attempt === 3 || (await stop()))
        throw refused ?? new Error("aggregate_inconsistent");
      await this.engines.settleLocal(750);
    }
  }
  /**
   * With `current`, server figures in `remoteView` (a conversation's or a recorded
   * thread's) that were read under an earlier local calculation or saved totals are not
   * replaced by local figures alone: nothing is sent and "stale" is returned, so the
   * caller can read the server again. A thread read that saved totals changed during
   * throws instead (loadActiveThreadView).
   */
  private async publishCapture(
    localKey: string,
    tabId: number,
    version: string,
    basis: CapturePublication,
    remoteView?: any,
    strict = false,
    current = false,
  ) {
    const {
      scope,
      r,
      a,
      source,
      activeContext,
      budget,
      guidance,
      storedGuidance,
      guidanceKey,
      derivedSaved,
      erasureVersion,
    } = basis;
    const context = this.displayBindings.get(localKey);
    const guidanceActionKey = storedGuidance
      ? guidanceKey + "#" + storedGuidance.actionToken
      : null;
    const sameScope = (a: Scope, b: Scope) =>
      a.namespace === b.namespace && a.mode === b.mode && a.era === b.era;

    const attempt = async () => {
      const thread = context?.thread;
      const threadGuard =
        thread && r.provider_request_key
          ? { key: thread.key, providerRequestKey: r.provider_request_key }
          : undefined;
      const routing = await this.checkedScope();
      const selected = routing.scope;
      const same = sameScope(selected, scope);
      if (strict && !same) return;
      if (thread && !same) return;
      if (
        thread &&
        this.dependencies.hasSiteConsent &&
        !(await this.dependencies.hasSiteConsent(context!.origin))
      )
        return;
      const observedId = context?.identity?.conversationId;
      const selectedKey =
        same || !observedId
          ? r.conversation_key
          : await this.keyFor(selected, r.site, "conversation", observedId);
      const calculation = await this.engines.view(selected);
      const before = await this.ledger.publicationSnapshot(
        selected.namespace,
        same ? source : undefined,
        undefined,
        threadGuard,
        calculation.guard,
      );
      if (
        thread &&
        (!before.threadCurrent ||
          before.trackingPaused ||
          before.ownership?.start !== thread.ownershipStart ||
          before.erasureVersion !== thread.erasureVersion)
      )
        return;
      if (
        !before.calculationCurrent ||
        this.routingIdentity(before) !== routing.identity
      )
        return "retry" as const;
      if (
        strict &&
        (before.erasing ||
          !before.sourceCurrent ||
          before.erasureVersion !== erasureVersion)
      )
        return;
      if (before.erasing) throw new Error("deletion_in_progress");
      const threadView = thread
        ? await this.threads.view(selected, thread.key, false)
        : null;
      const summary =
        threadView?.summary ?? (await this.scanUsage(selected, selectedKey));
      const pending = threadView
        ? threadView.conversation.pending
        : selected.mode === "company"
          ? await this.scanUsage(selected, selectedKey, true)
          : null;
      // Perplexity capture uses a provisional request key until a thread relation is proven.
      const historyConversation =
        r.site === "perplexity" ? thread?.key : selectedKey;
      const historyFilters = {
        calculationView: calculation.view,
        ...(calculation.method
          ? { methodId: calculation.method.method_id }
          : {}),
      };
      let history = historyConversation
        ? await this.history.localView(
            selected,
            historyConversation,
            historyFilters,
          )
        : undefined;
      const queueCount = await this.ledger.pendingCount(selected.namespace);
      const remote = thread
        ? remoteView?.threadKey === thread.key &&
          remoteView?.version === before.version &&
          remoteView?.erasureVersion === before.erasureVersion
          ? remoteView.conversation
          : null
        : same
          ? remoteView?.conversation
          : null;
      const serverCandidate =
        (thread
          ? !!remote
          : remote?.server?.erasure_version === before.erasureVersion) &&
        remoteView?.calculationToken === calculation.token
          ? remote?.server
          : null;
      if (
        current &&
        !serverCandidate &&
        (thread
          ? remoteView?.threadKey === thread.key &&
            remoteView?.erasureVersion === before.erasureVersion &&
            !!remoteView?.conversation?.server
          : remote?.server?.erasure_version === before.erasureVersion)
      )
        return "stale" as const;
      if (serverCandidate?.history && historyConversation) {
        // The conversation endpoint supplies live and history totals from one
        // transaction. A separate history fetch could describe a different population.
        try {
          history = await this.history.view(
            selected,
            historyConversation,
            historyFilters,
            serverCandidate.history,
          );
        } catch {
          // The final publication guards still reject changed scope, source or calculation.
        }
      }
      const server =
        serverCandidate &&
        usableServerHistory(history, !!thread && !serverCandidate.history)
          ? serverCandidate
          : null;
      const active =
        same &&
        before.sourceCurrent &&
        derivedSaved &&
        before.erasureVersion === erasureVersion;
      const settings = await this.settings();
      const modelLabels = await this.displayModelLabels(
        selected.namespace,
        r.site,
        summary,
      );
      const display = {
        target: "footprint-display",
        displayBinding: context?.binding ?? null,
        conversationIdentity: context?.identity ?? null,
        modelLabels,
        recordedThread: threadView
          ? server
            ? remoteView.recordedThread
            : threadView.recordedThread
          : null,
        summary,
        history,
        conversation: {
          source: server ? remote.source : "local",
          server,
          pending,
          pendingObservationCount: pending?.pendingObservationCount ?? 0,
          cachedAt: server ? remote.cachedAt : null,
          offline: remote?.offline ?? false,
        },
        state: active ? a.state : "dispatch_only",
        queueCount,
        activeContext: active ? activeContext : null,
        budget: active ? (budget?.tokens ?? null) : null,
        budgetBasis: active ? budget : null,
        // The token trigger of the long-chat tip shows only while its Settings switch is on;
        // the context figures in Details stay either way.
        guidance: active
          ? { ...guidance, show: guidance.show && settings.contextTipTokens, key: guidanceActionKey }
          : { ratio: null, show: false, state: { level: 0 }, key: null },
        // The page shows the tip once the chat's Req reaches this; null when Requests is off.
        tipRequestLimit: tipRequestLimit(settings),
        mode: selected.mode,
        // The organization paused sharing: Details says so instead of Offline or Syncing.
        sharingPaused:
          selected.mode === "company" && this.company.sharingPaused?.() === true,
        // Sharing waits for the person to agree to what the server's switches change.
        sharingHeld:
          selected.mode === "company" && this.company.sharingHeld?.() === true,
        displayScenario: settings.displayScenario,
        // The page keeps its last complete figures while this display waits for
        // recalculation, and the display is republished when the result publishes.
        calculationPending: calculation.pending === true,
      };
      if (
        thread &&
        this.dependencies.hasSiteConsent &&
        !(await this.dependencies.hasSiteConsent(context!.origin))
      )
        return;
      const approved = await this.checkedScope();
      const after = await this.ledger.publicationSnapshot<{
        state: GuidanceState;
      }>(
        selected.namespace,
        same ? source : undefined,
        active && storedGuidance
          ? { key: guidanceKey, actionToken: storedGuidance.actionToken }
          : undefined,
        threadGuard,
        calculation.guard,
      );
      if (context?.thread !== thread) return "retry" as const;
      if (thread && (!after.threadCurrent || after.trackingPaused)) return;
      if (
        !sameScope(approved.scope, selected) ||
        approved.identity !== routing.identity ||
        this.routingIdentity(after) !== approved.identity ||
        after.erasing ||
        before.erasureVersion !== after.erasureVersion ||
        before.sourceCurrent !== after.sourceCurrent
      ) {
        if (strict) return;
        return "retry" as const;
      }
      if (!after.calculationCurrent || before.version !== after.version)
        return "retry" as const;
      if (this.displayVersions.get(tabId) !== version) return;
      if (active) {
        if (after.guidance) {
          const state = after.guidance.value.state as GuidanceState;
          display.guidance = {
            ...display.guidance,
            state,
            show:
              display.guidance.show &&
              !state.dismissed &&
              Date.now() >= (state.snoozedUntil ?? 0),
          };
        } else {
          display.guidance = {
            ratio: null,
            show: false,
            state: { level: 0 },
            key: null,
          };
        }
      }
      if (context && this.displayBindings.get(localKey) !== context) return;
      if (context) this.publishedCaptures.set(tabId, { localKey, version });
      const prior = this.pendingCalc.get(tabId);
      if (display.calculationPending)
        this.pendingCalc.set(
          tabId,
          prior?.localKey === localKey && prior.version === version
            ? { ...prior, exhausted: false }
            : { localKey, version, attempts: 0, failures: 0, exhausted: false },
        );
      else this.pendingCalc.delete(tabId);
      // No intervening asynchronous scan is permitted between the final atomic guard and send.
      await this.dependencies.sendDisplay(tabId, display).catch(() => {});
      return;
    };
    // A newer display of this tab, or the tab closing or navigating away, means these
    // figures are never sent. Company work publishes outside the capture queue, so later
    // frames of the same reply keep changing the calculation while it retries. Without
    // this check a display nobody can see would record estimate_unavailable, which
    // Tracking health shows and company sync reports as a calculation failure.
    const replaced = () => this.displayVersions.get(tabId) !== version;
    // A routing change during the build (an organization key refresh, for example) makes the
    // history view refuse with policy_unavailable; the next attempt reads the new state. A
    // refusal that lasts through every attempt is reported as itself (16 Oct 2026).
    let refused: Error | undefined;
    for (let retry = 0; retry < 3; retry++) {
      if (replaced()) return;
      refused = undefined;
      try {
        const outcome = await attempt();
        if (outcome !== "retry") return outcome;
      } catch (error) {
        if (error instanceof Error && error.message === "policy_unavailable")
          refused = error;
        else if (
          !(error instanceof Error) ||
          !["aggregate_inconsistent", "selection_conflict"].includes(
            error.message,
          )
        )
          throw error;
      }
      // Rebuild the guarded display after concurrent calculation publication settles.
      if (retry < 2) await this.engines.maintainLocal();
    }
    if (replaced()) return;
    if (refused) throw refused;
    await this.ledger.health(scope.namespace, "estimate_unavailable");
    throw new Error("aggregate_inconsistent");
  }
  /**
   * NotebookLM asks for a notebook's guide the first time the notebook opens in each page and
   * gets the saved guide back unchanged. Each read was saved as a new request and attempt,
   * which only the provider ids joined as aliases: six rows in five minutes for one notebook
   * (live QA, 19 Oct 2026), and past 100 rows of one id `coalesceProviderIdentity` refuses the
   * capture. A guide's frames are therefore held until its end. A finished guide whose text is
   * already saved for the notebook (same attempt key, completed) is dropped as delivered, so it
   * stores nothing; totals were and stay the same. Any other guide is processed as before, its
   * dispatch first, then the end, which carries the whole guide. Returns true when the frame
   * needs nothing more.
   */
  private async holdGuide(
    message: CaptureMessage,
    tabId: number,
    localKey: string,
    scope: Scope,
  ): Promise<boolean> {
    if (message.site !== "notebooklm" || message.event === "health") return false;
    if (message.event === "dispatch") {
      if (message.dispatch?.action !== "notebook_guide") return false;
      this.heldGuides.delete(localKey);
      this.heldGuides.set(localKey, message);
      while (this.heldGuides.size > 16)
        this.heldGuides.delete(this.heldGuides.keys().next().value!);
      return true;
    }
    const dispatch = this.heldGuides.get(localKey);
    if (!dispatch) return false;
    // The end frame carries the whole guide, so progress waits for it.
    if (message.event === "progress" && !message.failure) return true;
    this.heldGuides.delete(localKey);
    const s = message.snapshot;
    if (
      message.event === "end" &&
      !message.failure &&
      s?.state === "completed" &&
      typeof s.attemptId === "string"
    ) {
      if (
        await this.ledger.completedAttempt(
          scope.namespace,
          await this.keyFor(scope, message.site, "attempt", s.attemptId),
        )
      )
        return true;
    }
    await this.process(dispatch, tabId, localKey, true);
    return false;
  }
  /** Test and shutdown boundary; network work never holds the capture queue. */
  async settleConversationDisplays() {
    for (let pass = 0; pass < 64; pass++) {
      const work = [...this.displayWork];
      if (this.displayWake) work.push(this.displayWake.promise);
      if (this.displayCapacity) work.push(this.displayCapacity);
      if (!work.length) return;
      await Promise.all(work);
    }
  }
  async conversationSummary(conversationKey: string) {
    const scope = await this.currentScope();
    return this.conversationView(scope, conversationKey);
  }
  private async scanUsage(
    scope: Scope,
    conversationKey?: string,
    pendingOnly = false,
    threadKey?: string,
  ) {
    for (let retry = 0; retry < 3; retry++) {
      try {
        return await this.scanUsageOnce(
          scope,
          conversationKey,
          pendingOnly,
          threadKey,
        );
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !["aggregate_inconsistent", "selection_conflict"].includes(
            error.message,
          ) ||
          retry === 2
        )
          throw error;
        await this.engines.maintainLocal();
      }
    }
    throw new Error("aggregate_inconsistent");
  }
  private async scanUsageOnce(
    scope: Scope,
    conversationKey?: string,
    pendingOnly = false,
    threadKey?: string,
  ) {
    const view = await this.engines.view(scope);
    const result = await scanSummary(
      this.ledger,
      scope.namespace,
      { calculationView: view.view },
      conversationKey,
      pendingOnly,
      threadKey,
      view.method
        ? (attempt, _original, request, context) =>
            view.scanEstimate(request, attempt, context)
        : undefined,
      undefined,
      {
        originalUnused: true,
        resultMethodHash: view.method?.method_hash,
      },
    );
    await view.current();
    return {
      ...result,
      calculation: {
        view: view.view,
        methodId: view.method?.method_id ?? null,
        methodHash: view.method?.method_hash ?? null,
        pending: view.pending,
      },
    };
  }
  /**
   * Read-only split of the selected calculation into time buckets, tools, models and chats for the
   * popup and dashboard views. It scans with the same engine view and estimate selection as
   * scanUsageOnce, and the observer reuses the totals' accumulator, so no figure is computed
   * differently from the totals. Nothing is written.
   */
  async usageBreakdown(request: {
    start?: string;
    end?: string;
    bucket: BreakdownBucket;
    timezone: string;
  }) {
    const instant = (value: unknown) =>
      value === undefined ||
      (typeof value === "string" && !Number.isNaN(Date.parse(value)));
    if (
      !request ||
      !["hour", "day"].includes(request.bucket) ||
      typeof request.timezone !== "string" ||
      !instant(request.start) ||
      !instant(request.end)
    )
      throw new Error("payload_rejected");
    try {
      new Intl.DateTimeFormat("en", { timeZone: request.timezone });
    } catch {
      throw new Error("payload_rejected");
    }
    const authority = await this.methods.authority(),
      scope = authority.scope;
    const withdrawnAt = (await this.settings()).trackingWithdrawnAt ?? null;
    for (let retry = 0; retry < 3; retry++) {
      try {
        const view = await this.engines.view(scope);
        const filters: Filters = {
          calculationView: view.view,
          ...(request.start ? { start: request.start } : {}),
          ...(request.end ? { end: request.end } : {}),
        };
        const observer = new BreakdownObserver(filters, {
          bucket: request.bucket,
          timezone: request.timezone,
          withdrawnAt,
        });
        const total = await scanSummary(
          this.ledger,
          scope.namespace,
          filters,
          undefined,
          false,
          undefined,
          view.method
            ? (attempt, _original, parent, context) =>
                view.scanEstimate(parent, attempt, context)
            : undefined,
          observer,
          {
            originalUnused: true,
            resultMethodHash: view.method?.method_hash,
          },
        );
        // Saved history counts in every total the dashboard shows, so it is split the same way.
        const savedRouter = new HistoryBreakdown({
          bucket: request.bucket,
          timezone: request.timezone,
        });
        const saved = await this.history.local(
          scope,
          undefined,
          filters,
          false,
          savedRouter,
        );
        const savedParts = savedRouter.result();
        await view.current();
        await authority.current();
        return {
          history:
            saved.status === "available" && savedParts
              ? { total: saved, ...savedParts }
              : null,
          scopeToken: authority.token,
          generatedAt: Date.now(),
          bucket: request.bucket,
          timezone: request.timezone,
          total: {
            requests: total.requests,
            attempts: total.attempts,
            tokens: total.tokens,
            metrics: total.metrics,
            tools: total.tools,
            models: total.models,
          },
          ...observer.result(),
          calculation: {
            view: view.view,
            methodId: view.method?.method_id ?? null,
            pending: view.pending,
          },
        };
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !["aggregate_inconsistent", "selection_conflict"].includes(
            error.message,
          ) ||
          retry === 2
        )
          throw error;
        await this.engines.maintainLocal();
      }
    }
    throw new Error("aggregate_inconsistent");
  }
  /**
   * How one chat compares with the person's other chats in the last 30 days, for Details.
   * Read-only: both windows come from usageBreakdown, so each chat's figure is the one the
   * dashboard shows, at the scenario chosen in Settings and in the Settings time zone.
   */
  async chatComparison(site: RouteSite, conversationId: string) {
    if (!isRouteConversationId(site, conversationId))
      throw new Error("payload_rejected");
    const settings = await this.settings();
    const now = new Date();
    const month = periodWindow("30d", settings.timezone, now);
    const day = periodWindow("today", settings.timezone, now);
    const window = (await this.usageBreakdown({
      start: month.start,
      end: month.end,
      bucket: "day",
      timezone: settings.timezone,
    })) as unknown as UsageBreakdownView;
    const today = (await this.usageBreakdown({
      start: day.start,
      end: day.end,
      bucket: "hour",
      timezone: settings.timezone,
    })) as unknown as UsageBreakdownView;
    // Live records key a chat by its "conversation" identity in the current scope; a chat the
    // page has not saved yet has no key and still gets the average and the distribution.
    let key: string | null = null;
    try {
      key = await this.keyFor(
        await this.currentScope(),
        site,
        "conversation",
        conversationId,
      );
    } catch (error) {
      key = null;
      // The comparison still shows; the health row says why this chat was not singled out.
      await this.comparisonDiagnostic(failureCode(error));
    }
    // The smaller-model card is optional; a chat it cannot compare simply shows no card.
    let smallerModel: SmallerModel | null = null;
    if (key)
      try {
        smallerModel = await this.smallerModel(await this.currentScope(), key);
      } catch {
        smallerModel = null;
        await this.comparisonDiagnostic("estimate_unavailable");
      }
    return {
      ...chatComparison(window, today, key, settings.displayScenario),
      scenario: settings.displayScenario,
      smallerModel,
    };
  }
  /** Records why part of a chat comparison failed. Never fails the comparison itself. */
  private async comparisonDiagnostic(code: ReasonCode) {
    try {
      await this.ledger.health((await this.currentScope()).namespace, code);
    } catch {
      // A health row that cannot be written leaves the comparison as it is.
    }
  }
  /**
   * How one chat's electricity would change if a smaller model wrote each reply's output tokens.
   * Read-only: live replies use the estimates the totals use, saved history is estimated again with
   * the same method (deterministic, so equal to the saved figures), and nothing is written.
   */
  private async smallerModel(scope: Scope, conversationKey: string) {
    const executor = this.engines.executor;
    if (!executor.alternativeText) return null;
    const view = await this.engines.view(scope);
    const envelopes: EstimationEnvelope[] = [];
    await scanSummary(
      this.ledger,
      scope.namespace,
      { calculationView: view.view },
      conversationKey,
      false,
      undefined,
      view.method
        ? (attempt, _original, parent) =>
            view.estimate({ family: "live", request: parent, attempt })
        : undefined,
      {
        reset: () => {
          envelopes.length = 0;
        },
        request: () => undefined,
        attempt: (_attempt, _parent, estimate) => {
          if (estimate && isEstimationEnvelope(estimate)) envelopes.push(estimate);
        },
      },
    );
    // Saved replies the totals count: not in conflict and not already counted live.
    const saved: HistoryMessage[] = [];
    let historyFailed = false;
    await this.history.local(
      scope,
      conversationKey,
      { calculationView: view.view },
      false,
      {
        reset: () => {
          saved.length = 0;
        },
        fail: () => {
          historyFailed = true;
        },
        add: (_source, record, options) => {
          if (!options?.conflict && !options?.overlap && record.role === "response")
            saved.push(record);
        },
      },
    );
    if (historyFailed) return null;
    for (const record of saved)
      envelopes.push(
        await executor.estimate(
          { family: "history", record },
          {
            ...(view.method ? { methodId: view.method.method_id } : {}),
            view: "original",
          },
        ),
      );
    await view.current();
    return smallerModelChange(envelopes, (component, profile) =>
      executor.alternativeText!(component, profile),
    );
  }
  private async conversationView(
    scope: Scope,
    conversationKey: string,
    maxAgeMs = 0,
  ) {
    const calculation = await this.engines.view(scope);
    let summary = await this.scanUsage(scope, conversationKey);
    if (scope.mode === "personal") {
      const snapshot = await this.ledger.publicationSnapshot(
        scope.namespace,
        undefined,
        undefined,
        undefined,
        calculation.guard,
      );
      if (!snapshot.calculationCurrent)
        throw new Error("aggregate_inconsistent");
      return {
        calculationToken: calculation.token,
        summary,
        conversation: {
          source: "local" as const,
          server: null,
          pending: null,
          pendingObservationCount: 0,
          cachedAt: null,
          offline: false,
        },
      };
    }
    let server: any = null;
    let offline = false;
    if ((await this.currentScope()).namespace === scope.namespace) {
      try {
        const selected = calculation;
        server = await serverSummary(
          this.ledger,
          this.company,
          "my",
          selected.method
            ? `?period=all&calculation_view=recalculated&method_id=${encodeURIComponent(selected.method.method_id)}`
            : "?period=all&calculation_view=original",
          { key: conversationKey, namespace: scope.namespace, maxAgeMs },
          selected.method
            ? {
                methodId: selected.method.method_id,
                methodHash: selected.method.method_hash,
              }
            : undefined,
        );
        await selected.current();
      } catch (error) {
        server = null;
        // Offline means unreachable. A server that answers with a refusal, for example 409
        // recalculation_pending for a while after an update, is reachable.
        offline = isNetworkFailure(error);
      }
    }
    const current = await this.currentScope();
    if (current.namespace !== scope.namespace)
      return {
        mode: current.mode,
        summary: await this.scanUsage(current, conversationKey),
        conversation: {
          source: "local" as const,
          server: null,
          pending: null,
          pendingObservationCount: 0,
          cachedAt: null,
          offline: false,
        },
      };
    // Read after the network await so a concurrent erasure is not re-exposed locally.
    summary = await this.scanUsage(scope, conversationKey);
    const pending = await this.scanUsage(scope, conversationKey, true);
    const erasureVersion = (await this.ledger.summaryVersion(scope.namespace))
      .erasureVersion;
    if (server && server.erasure_version !== erasureVersion) server = null;
    const approved = await this.currentScope();
    const snapshot = await this.ledger.publicationSnapshot(
      scope.namespace,
      undefined,
      undefined,
      undefined,
      calculation.guard,
    );
    if (canonicalJson(approved) !== canonicalJson(scope))
      throw new Error("policy_unavailable");
    if (!snapshot.calculationCurrent) throw new Error("aggregate_inconsistent");
    return {
      calculationToken: calculation.token,
      summary,
      conversation: {
        source: server?.snapshot_source ?? "local",
        server,
        pending,
        pendingObservationCount: pending.pendingObservationCount,
        cachedAt: server?.cached_at ?? null,
        offline: server?.offline ?? offline,
      },
    };
  }
  async routeSummary(
    site: RouteSite,
    conversationId: string,
    binding?: DisplayBinding,
  ) {
    if (binding && !isDisplayBinding(binding, null))
      throw new Error("payload_rejected");
    const displayBinding = binding ? { ...binding } : null;
    if (!isRouteConversationId(site, conversationId))
      throw new Error("payload_rejected");
    // Both the HMAC key and returned data belong to this captured scope. Connecting,
    // disconnecting or switching tenants during an await requires a fresh lookup.
    // Why the last attempt was read again. Saving a reply or an import while the totals are
    // read changes the calculation; that is normal and named as such when it lasts through
    // every attempt. Until 19 Oct 2026 it was reported as policy_unavailable, which the
    // Tracking page shows as "Organization rules could not be checked", also in personal mode
    // (live QA: agreeing again while a cut-off reply was still being written).
    let changed: "calculation" | "routing" = "routing";
    for (let retry = 0; retry < 3; retry++) {
      if (retry > 0 && changed === "calculation")
        await this.engines.settleLocal(750);
      const scope = await this.currentScope();
      let calculation;
      try {
        calculation = await this.engines.view(scope);
      } catch (error) {
        if (
          error instanceof Error &&
          [
            "policy_unavailable",
            "selection_conflict",
            "aggregate_inconsistent",
          ].includes(error.message) &&
          retry < 2
        ) {
          changed =
            error.message === "policy_unavailable" ? "routing" : "calculation";
          continue;
        }
        throw error;
      }
      const before = await this.ledger.publicationSnapshot(scope.namespace);
      if (before.erasing) throw new Error("deletion_in_progress");
      const conversationKey = await this.keyFor(
        scope,
        site,
        site === "perplexity" ? "route" : "conversation",
        conversationId,
      );
      let view;
      try {
        view =
          site === "perplexity"
            ? await this.threads.view(scope, conversationKey)
            : await this.conversationView(scope, conversationKey);
      } catch (error) {
        const failed = await this.ledger.publicationSnapshot(scope.namespace);
        if (failed.erasing) throw new Error("deletion_in_progress");
        if (
          error instanceof Error &&
          ["aggregate_inconsistent", "selection_conflict"].includes(
            error.message,
          )
        ) {
          changed = "calculation";
          continue;
        }
        if (
          this.routingIdentity(before) !== this.routingIdentity(failed) ||
          canonicalJson(scope) !== canonicalJson(await this.currentScope())
        ) {
          changed = "routing";
          continue;
        }
        throw error;
      }
      let history;
      try {
        const serverHistory = view.conversation.server?.history;
        const filters = {
          calculationView: calculation.view,
          ...(calculation.method
            ? { methodId: calculation.method.method_id }
            : {}),
        };
        history = serverHistory
          ? await this.history.view(
              scope,
              conversationKey,
              filters,
              serverHistory,
            )
          : await this.history.localView(scope, conversationKey, filters);
        if (
          view.conversation.server &&
          !usableServerHistory(history, site === "perplexity" && !serverHistory)
        ) {
          if (site === "perplexity")
            view = await this.threads.view(scope, conversationKey, false);
          else
            view = {
              ...view,
              conversation: {
                ...view.conversation,
                source: "local" as const,
                server: null,
                cachedAt: null,
              },
            };
        }
      } catch (error) {
        const failed = await this.ledger.publicationSnapshot(scope.namespace);
        if (failed.erasing) throw new Error("deletion_in_progress");
        if (
          error instanceof Error &&
          ["aggregate_inconsistent", "selection_conflict"].includes(
            error.message,
          )
        ) {
          changed = "calculation";
          continue;
        }
        if (this.routingIdentity(before) !== this.routingIdentity(failed)) {
          changed = "routing";
          continue;
        }
        throw error;
      }
      const current = await this.currentScope();
      const after = await this.ledger.publicationSnapshot(
        scope.namespace,
        undefined,
        undefined,
        undefined,
        calculation.guard,
      );
      if (after.erasing) throw new Error("deletion_in_progress");
      if (
        this.routingIdentity(before) !== this.routingIdentity(after) ||
        before.erasureVersion !== after.erasureVersion
      ) {
        changed = "routing";
        continue;
      }
      if (!after.calculationCurrent || before.version !== after.version) {
        changed = "calculation";
        continue;
      }
      if (
        current.namespace !== scope.namespace ||
        current.mode !== scope.mode ||
        current.era !== scope.era
      ) {
        changed = "routing";
        continue;
      }
      const modelLabels = await this.displayModelLabels(
        scope.namespace,
        site,
        view.summary,
      );
      const settings = await this.settings();
      return {
        target: "footprint-display",
        displayBinding,
        conversationIdentity: { site, conversationId },
        ...view,
        modelLabels,
        history,
        recordedThread: "recordedThread" in view ? view.recordedThread : null,
        activeContext: null,
        budget: null,
        budgetBasis: null,
        guidance: { ratio: null, show: false, state: { level: 0 }, key: null },
        tipRequestLimit: tipRequestLimit(settings),
        mode: scope.mode,
        sharingPaused:
          scope.mode === "company" && this.company.sharingPaused?.() === true,
        sharingHeld:
          scope.mode === "company" && this.company.sharingHeld?.() === true,
        displayScenario: settings.displayScenario,
        // New history can wait for recalculation. The page then shows a neutral
        // state and refreshes when the result publishes, instead of an error.
        calculationPending: calculation.pending === true,
      };
    }
    throw new Error(
      changed === "calculation" ? "aggregate_inconsistent" : "policy_unavailable",
    );
  }
  /**
   * Raw names of models the library does not know, for Details only. They stay in this
   * browser and are read only when an estimate used a family benchmark for that reason.
   */
  private async displayModelLabels(
    namespace: string,
    site: Site,
    summary: unknown,
  ): Promise<string[]> {
    const details = (summary as { estimation?: EstimateDetailSummary } | null)
      ?.estimation;
    if (!needsModelLabels(details)) return [];
    try {
      return (await this.ledger.listModelLabels(namespace))
        .filter((row) => row.site === site)
        .slice(0, 8)
        .map((row) => row.label);
    } catch {
      // A diagnostic that cannot be read leaves Details without the names; the line
      // still says the model is not in the library.
      return [];
    }
  }
  private async methodSelection(scope: Scope, methodId: string) {
    const method = this.engines.methods.get(methodId);
    if (!method) return this.methods.selection(scope, methodId);
    const authority = await this.methods.authority();
    if (canonicalJson(scope) !== canonicalJson(authority.scope))
      throw new Error("policy_unavailable");
    return {
      methodId: method.method_id,
      methodHash: method.method_hash,
      trust: authority.token,
      current: authority.current,
      estimate: async (
        attempt: AttemptObservation,
        original: PresentedEstimate | undefined,
        request: RequestObservation,
      ) => {
        if (!original || original.view !== "original")
          throw new Error("method_update_invalid");
        const originalHash = isEstimationEnvelope(original)
          ? original.requested_method.method_hash
          : original.method_hash;
        const input = await this.engines.liveInput(scope, request, attempt);
        if (!input) throw new Error("dependency_missing");
        const result = await this.engines.executor.estimate(input, {
          methodId,
          view: "recalculated",
          originalMethodHash: originalHash,
        });
        await authority.current();
        return result;
      },
    };
  }
  /**
   * What the popup checks its saved figures against before the dashboard is read: the data
   * scope's token (it changes with every erasure, connection and disconnection), whether an
   * erasure is running, and the settings. It reads no records, so it answers at once.
   */
  async viewToken() {
    const authority = await this.methods.authority();
    const snapshot = await this.ledger.publicationSnapshot(
      authority.scope.namespace,
    );
    const settings = await this.settings();
    await authority.current();
    return {
      scopeToken: authority.token,
      erasing: snapshot.erasing,
      settings,
    };
  }
  /**
   * While a reply streams, every progress commit changes the calculation token, so a build
   * that takes longer than the gap between two commits never passes its final check. Before
   * 19 October 2026 the dashboard and Settings then failed with "could not load" for the
   * whole reply, and Turn off tracking was out of reach. Each attempt now waits for local
   * calculation work to settle first; when the figures still moved during every attempt, the
   * last build is returned marked "rebuilding" so the page shows it and reads again. A change
   * of data scope, routing or erasure still fails, because those figures must never be shown.
   */
  async dashboard(filters: Filters = {}) {
    let moved: Awaited<ReturnType<Coordinator["buildDashboard"]>>["result"] | undefined;
    for (let retry = 0; retry < 3; retry++) {
      if (retry > 0) await this.engines.settleLocal(750);
      try {
        const built = await this.buildDashboard(filters);
        if (built.consistent) return built.result;
        moved = built.result;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== "aggregate_inconsistent"
        )
          throw error;
      }
    }
    if (!moved) throw new Error("aggregate_inconsistent");
    return {
      ...moved,
      aggregate_status: "rebuilding" as const,
      refreshAfterMs: DASHBOARD_MOVING_REFRESH_MS,
    };
  }
  private async buildDashboard(filters: Filters = {}) {
    const authority = await this.methods.authority(),
      scope = authority.scope;
    const before = await this.ledger.publicationSnapshot(scope.namespace);
    if (before.erasing) throw new Error("deletion_in_progress");
    if (
      !filters ||
      typeof filters !== "object" ||
      Array.isArray(filters) ||
      ![undefined, "original", "recalculated"].includes(
        filters.calculationView,
      ) ||
      ((filters.calculationView ?? "original") === "original" &&
        filters.methodId !== undefined)
    )
      throw new Error("payload_rejected");
    const defaultView =
      filters.calculationView === undefined
        ? await this.engines.view(scope)
        : null;
    const selection =
      filters.calculationView === "recalculated"
        ? await this.methodSelection(scope, filters.methodId!)
        : defaultView?.method
          ? {
              methodId: defaultView.method.method_id,
              methodHash: defaultView.method.method_hash,
              trust: authority.token,
              current: defaultView.current,
              estimate: (
                attempt: AttemptObservation,
                _original: PresentedEstimate | undefined,
                request: RequestObservation,
                context: ScanEstimateContext,
              ) => defaultView.scanEstimate(request, attempt, context),
            }
          : null;
    if (defaultView)
      filters = {
        ...filters,
        calculationView: defaultView.view,
        ...(defaultView.method
          ? { methodId: defaultView.method.method_id }
          : {}),
      };
    const cacheKey = `summary:${scope.namespace}:${await digest({ filters, methodHash: selection?.methodHash ?? null, methodTrust: selection?.trust ?? null, defaultSelection: defaultView !== null })}`;
    const candidate = await this.ledger.readSummary<any>(cacheKey);
    const cached =
      candidate &&
      defaultView &&
      candidate.calculationToken !== defaultView.token
        ? { ...candidate, dirty: true }
        : candidate;
    const flightKey = `${cacheKey}:${defaultView?.token ?? "explicit"}`;
    const build = () => {
      if (this.summaryFlights.has(flightKey))
        return this.summaryFlights.get(flightKey)!;
      const flight = (async (): Promise<{ summary: any; stored: boolean }> => {
        // The last complete scan whose view moved before it could be stored (see dashboard()).
        let moved: unknown;
        for (let retry = 0; retry < 3; retry++) {
          const epoch = await this.ledger.summaryVersion(scope.namespace);
          const summary = await scanSummary(
            this.ledger,
            scope.namespace,
            filters,
            undefined,
            false,
            undefined,
            selection?.estimate,
            undefined,
            // Only the default view's scanEstimate leaves the original unread.
            defaultView?.method
              ? {
                  originalUnused: true,
                  resultMethodHash: defaultView.method.method_hash,
                }
              : {},
          );
          try {
            await selection?.current();
            await authority.current();
            await this.ledger.cacheSummary(
              scope.namespace,
              cacheKey,
              summary,
              epoch?.version ?? 0,
              defaultView?.guard,
            );
          } catch (error) {
            if ((error as Error).message !== "aggregate_inconsistent")
              throw error;
            moved = summary;
            continue;
          }
          await solveHealth(this.ledger, scope.namespace, "totals_built");
          return { summary, stored: true };
        }
        if (moved === undefined) throw new Error("aggregate_inconsistent");
        return { summary: moved, stored: false };
      })().finally(() => this.summaryFlights.delete(flightKey));
      this.summaryFlights.set(flightKey, flight);
      return flight;
    };
    const built = cached ? null : await build();
    const summary = cached?.summary ?? built!.summary;
    if (cached?.dirty)
      void build().catch(async (error) => {
        try {
          await authority.current();
        } catch {
          return;
        }
        await this.ledger
          .health(scope.namespace, failureCode(error))
          .catch(() => {});
      });
    const c = await this.company.credentials();
    const p = await this.company.pending();
    const health = combineHealth(
      persistedHealth(await this.ledger.listHealth(scope.namespace)),
      this.dependencies.health?.list(scope.namespace) ?? [],
    );
    const saved = await this.ledger.listSessionMaintenance();
    const heldQueues = [];
    const held = saved.filter(
      (entry) =>
        entry.kind === "reconnect" ||
        (entry.kind === "active" &&
          entry.session.namespace !== scope.namespace),
    );
    for (const item of held) {
      if (item.kind === "deletion_receipt") continue;
      const entry = item.session;
      const count = await this.ledger.pendingCount(entry.namespace);
      if (count)
        heldQueues.push({
          origin: entry.origin,
          count,
          state: entry.enrollment_state ?? "disconnected",
          revocation_pending:
            item.kind === "reconnect" &&
            item.session.disconnect_pending === true,
        });
    }
    const result = {
      scopeToken: authority.token,
      history: await this.history.view(scope, undefined, filters),
      summary,
      calculation: {
        view: filters.calculationView ?? "original",
        methodId: selection?.methodId ?? null,
        methodHash: selection?.methodHash ?? null,
        pending: defaultView?.pending ?? false,
      },
      generatedAt: cached?.generatedAt ?? Date.now(),
      aggregate_status:
        cached?.dirty || defaultView?.pending ? "rebuilding" : "current",
      refreshAfterMs: cached?.dirty || defaultView?.pending ? 250 : null,
      settings: await this.settings(),
      mode: scope.mode,
      company: c
        ? {
            origin: c.origin,
            ...(c.company_name ? { company_name: c.company_name } : {}),
            policy: c.policy,
            enrollment_state: c.enrollment_state ?? "active",
            // What the server's operator switches change, the text version that describes them
            // and whether sharing waits for the person to agree to it (Settings asks).
            features: storedFeatures(c.features),
            consent_version: organizationConsentVersion(storedFeatures(c.features)),
            consent_required: !(await this.organizationAgreed(
              c.origin,
              storedFeatures(c.features),
            )),
          }
        : null,
      // A stored connection without one of the current states predates the email code flow and
      // cannot be continued, so it is not offered.
      pending:
        p && (p.state === "code_sent" || p.state === "verified") && p.expires_at
          ? {
              origin: p.origin,
              state: p.state,
              expires_at: p.expires_at,
              ...(p.email ? { email: p.email } : {}),
              ...(p.retry_at ? { retry_at: p.retry_at } : {}),
              ...(p.company_name ? { company_name: p.company_name } : {}),
            }
          : null,
      queue: await this.ledger.pending(scope.namespace),
      queueCount: await this.ledger.pendingCount(scope.namespace),
      refusedCount: await this.ledger.refusedCount(scope.namespace),
      heldQueues,
      health,
    };
    // New figures committed during the build (a streaming reply) move the calculation token;
    // dashboard() decides what to do with such a build. Any other change still fails here.
    let moved = built?.stored === false;
    try {
      await selection?.current();
    } catch (error) {
      if ((error as Error).message !== "aggregate_inconsistent") throw error;
      moved = true;
    }
    await authority.current();
    const after = await this.ledger.publicationSnapshot(
      scope.namespace,
      undefined,
      undefined,
      undefined,
      defaultView?.guard,
    );
    if (after.erasing) throw new Error("deletion_in_progress");
    if (
      this.routingIdentity(before) !== this.routingIdentity(after) ||
      before.erasureVersion !== after.erasureVersion
    )
      throw new Error("aggregate_inconsistent");
    if (!after.calculationCurrent || before.version !== after.version)
      moved = true;
    if (defaultView?.pending) void this.engines.maintainLocal();
    return { result, consistent: !moved };
  }
  async trackingHealth() {
    const authority = await this.methods.authority();
    let persisted: unknown[] = [],
      status: "available" | "unavailable" = "available";
    try {
      persisted = await this.ledger.listHealth(authority.scope.namespace);
    } catch {
      status = "unavailable";
      this.dependencies.health?.report(
        "storage_write_failed",
        authority.scope.namespace,
      );
    }
    await authority.current();
    return {
      health: combineHealth(
        persistedHealth(persisted),
        this.dependencies.health?.list(authority.scope.namespace) ?? [],
      ),
      status,
      scopeToken: authority.token,
    };
  }
  methodStatus() {
    return this.methods.status();
  }
  async engineStatus() {
    await this.ready;
    const status = await this.engines.status();
    void this.engines.maintainLocal();
    void this.engines.maintainOrganization();
    return status;
  }
  async selectEngine(request: unknown) {
    await this.ready;
    return this.engines.select(request);
  }
  async resumeEngine() {
    await this.ready;
    return this.engines.resume();
  }
  refreshMethods() {
    return this.methods.refresh(true);
  }
  async selectedServerSummary(
    view: "my" | "company",
    query: string,
  ): Promise<
    ServerSummarySnapshot<HistoryView> & {
      scopeToken: string;
      history: HistoryView;
      calculation: {
        view: "original" | "recalculated";
        methodId: string | null;
        methodHash: string | null;
      };
    }
  > {
    const authority = await this.methods.authority();
    const params = new URLSearchParams(query);
    const useDefault = view === "my" && !params.has("calculation_view");
    if (useDefault) await this.engines.maintainOrganization();
    const calculation = useDefault
      ? await this.engines.view(authority.scope)
      : null;
    const before = await this.ledger.publicationSnapshot(
      authority.scope.namespace,
    );
    const effective = useDefault ? await this.engines.admission() : null;
    if (effective) {
      params.set("calculation_view", "recalculated");
      params.set("method_id", effective.method_id);
    } else if (view === "company" && !params.has("calculation_view")) {
      params.set("calculation_view", "original");
    }
    const selection =
      params.get("calculation_view") === "recalculated"
        ? await this.methodSelection(
            authority.scope,
            params.get("method_id") ?? "",
          )
        : null;
    const result = await serverSummary(
      this.ledger,
      this.company,
      view,
      "?" + params.toString(),
      undefined,
      selection ?? undefined,
    );
    if (
      selection &&
      (result.method_id !== selection.methodId ||
        result.method_hash !== selection.methodHash ||
        result.calculation_view !== "recalculated")
    )
      throw new Error("method_update_invalid");
    if (
      !selection &&
      result.calculation_view !== undefined &&
      result.calculation_view !== "original"
    )
      throw new Error("method_update_invalid");
    const history =
      view === "my"
        ? await this.history.view(
            authority.scope,
            undefined,
            {
              calculationView: selection ? "recalculated" : "original",
              ...(selection ? { methodId: selection.methodId } : {}),
              site: params.get("site") ?? undefined,
              model: params.get("model") ?? undefined,
              ...(params.get("period") === "all" &&
              !params.has("start") &&
              !params.has("end")
                ? {}
                : {
                    start:
                      typeof result.range_start === "string"
                        ? result.range_start
                        : undefined,
                    end:
                      typeof result.range_end === "string"
                        ? result.range_end
                        : undefined,
                  }),
            },
            result.history as any,
          )
        : serverHistoryView(result.history);
    await selection?.current();
    await authority.current();
    const after = await this.ledger.publicationSnapshot(
      authority.scope.namespace,
      undefined,
      undefined,
      undefined,
      calculation?.guard,
    );
    if (after.erasing) throw new Error("deletion_in_progress");
    if (
      !after.calculationCurrent ||
      this.routingIdentity(before) !== this.routingIdentity(after) ||
      before.erasureVersion !== after.erasureVersion
    )
      throw new Error("aggregate_inconsistent");
    return {
      ...withSplitHistoryViews(result),
      history,
      scopeToken: authority.token,
      calculation: {
        view: selection ? "recalculated" : "original",
        methodId: selection?.methodId ?? null,
        methodHash: selection?.methodHash ?? null,
      },
    };
  }
  recalculation(methodId: string | null, operationId: string): Promise<any> {
    if (this.recalculationWork)
      return Promise.reject(new Error("sync_delayed"));
    const work = this.runRecalculation(methodId, operationId).finally(() => {
      if (this.recalculationWork === work) this.recalculationWork = null;
    });
    this.recalculationWork = work;
    return work;
  }
  private async runRecalculation(methodId: string | null, operationId: string) {
    if (
      typeof operationId !== "string" ||
      !(
        methodId === null
          ? /^[a-f0-9]{64}$/
          : /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
      ).test(operationId)
    )
      throw new Error("payload_rejected");
    const scope = await this.currentScope();
    if (scope.mode !== "company") throw new Error("policy_unavailable");
    const selection =
      methodId === null ? null : await this.methodSelection(scope, methodId);
    const result = await this.company.threadRequest(
      scope,
      methodId === null
        ? "/v1/me/recalculations/" + operationId
        : "/v1/me/recalculations",
      methodId === null
        ? undefined
        : { method_id: methodId, operation_id: operationId },
    );
    if (
      !result ||
      typeof result.job_id !== "string" ||
      !/^[a-f0-9]{64}$/.test(result.job_id) ||
      typeof result.method_id !== "string" ||
      !/^[a-z0-9][a-z0-9.-]{0,127}$/.test(result.method_id) ||
      !["pending", "completed", "failed", "invalidated"].includes(
        result.status,
      ) ||
      !Number.isSafeInteger(result.processed_estimates) ||
      result.processed_estimates < 0 ||
      result.calculation_view !== "recalculated"
    )
      throw new Error("payload_rejected");
    if (selection && result.method_id !== methodId)
      throw new Error("payload_rejected");
    await (
      selection ?? (await this.methodSelection(scope, result.method_id))
    ).current();
    return {
      jobId: result.job_id,
      methodId: result.method_id,
      status: result.status,
      processedEstimates: result.processed_estimates,
      error:
        result.status === "pending"
          ? "recalculation_pending"
          : result.status === "invalidated"
            ? "deletion_changed"
            : result.error_code
              ? "recalculation_failed"
              : null,
    };
  }
  async updateSettings(
    changes: Partial<
      Pick<
        Settings,
        | "paused"
        | "budget"
        | "timezone"
        | "displayScenario"
        | "contextTipRequests"
        | "contextTipRequestLimit"
        | "contextTipTokens"
        | "ownRead"
      >
    > & {
      /** Only the sites named change; the others keep their switch. */
      ownReadSites?: Partial<Record<OwnReadSettingKey, boolean>>;
    },
  ): Promise<{ ownReadChanged: boolean }> {
    const old = await this.settings();
    if (changes.ownRead !== undefined && typeof changes.ownRead !== "boolean")
      throw new Error("Choose whether to load the full chat history automatically.");
    if (
      changes.ownReadSites !== undefined &&
      !validOwnReadSites(changes.ownReadSites)
    )
      throw new Error("Choose for each site whether to load the full chat history automatically.");
    if (
      changes.contextTipRequests !== undefined &&
      typeof changes.contextTipRequests !== "boolean"
    )
      throw new Error("Choose whether the long-chat tip shows by requests.");
    if (
      changes.contextTipTokens !== undefined &&
      typeof changes.contextTipTokens !== "boolean"
    )
      throw new Error("Choose whether the long-chat tip shows by tokens.");
    if (
      changes.contextTipRequestLimit !== undefined &&
      !validTipRequestLimit(changes.contextTipRequestLimit)
    )
      throw new Error(
        "Choose a long-chat tip limit between 1 and 10,000 requests.",
      );
    if (
      changes.displayScenario !== undefined &&
      !DisplayScenarioSchema.safeParse(changes.displayScenario).success
    )
      throw new Error(
        "Choose the minimum, midpoint or maximum scenario for ranged estimates.",
      );
    const c = await this.company.credentials();
    if (
      changes.paused &&
      (await this.currentScope()).mode === "company" &&
      c?.policy.pause_mode === "disabled_by_company"
    )
      throw new Error(
        "Your company policy requires tracking. Advice can still be dismissed.",
      );
    if (
      changes.budget !== undefined &&
      changes.budget !== null &&
      (!Number.isInteger(changes.budget) ||
        changes.budget < 1000 ||
        changes.budget > 10000000)
    )
      throw new Error(
        "Choose an advisory budget between 1,000 and 10,000,000 tokens.",
      );
    // The tip fields are saved explicitly from now on, so the one switch of before 16 October
    // 2026 is dropped rather than left to disagree with them.
    // Pages save their whole copy of the settings, which carries the agreements as they were
    // when the page loaded. Only setTrackingConsent and the Connect dialog change those, so a
    // stale copy can never undo an agreement or a withdrawal made elsewhere.
    const {
      consent: _consent,
      organizationConsent: _organization,
      trackingWithdrawnAt: _withdrawn,
      ...requested
    } = changes as typeof changes &
      Partial<Pick<Settings, "consent" | "organizationConsent" | "trackingWithdrawnAt">>;
    const {
      key: _key,
      contextTip: _legacy,
      ...settings
    } = {
      ...old,
      ...requested,
      ownReadSites: { ...old.ownReadSites, ...changes.ownReadSites },
    } as Settings;
    await this.ledger.applySessionChanges({ settings });
    if (changes.paused) this.invalidateRecordedCaptures();
    const ownReadChanged = OWN_READ_SETTING_KEYS.some(
      (key) =>
        ownReadAllowed(old, key) !==
        ownReadAllowed(ownReadSettings(settings), key),
    );
    // Open pages keep their last display; only the scenario choice changes, so send it alone
    // rather than rebuilding every guarded display.
    if (
      changes.displayScenario !== undefined &&
      changes.displayScenario !== old.displayScenario
    )
      for (const tabId of this.publishedCaptures.keys())
        void this.dependencies
          .sendDisplay(tabId, {
            target: "footprint-display-scenario",
            displayScenario: changes.displayScenario,
          })
          .catch(() => {});
    // The background tells open provider tabs, which stop or resume their own reads.
    return { ownReadChanged };
  }
  async dismiss(key: string) {
    await this.ledger.updateDerivedGuidance(
      (await this.currentScope()).namespace,
      key,
      "dismiss",
    );
  }
  async snooze(key: string) {
    await this.ledger.updateDerivedGuidance(
      (await this.currentScope()).namespace,
      key,
      "snooze",
    );
  }
  /**
   * Whether the person closed or snoozed the long-chat tip of a chat (16 Oct 2026), kept per
   * scope under the chat's keyed conversation identity. With `action` it records the cross
   * ("close", for good) or the Details snooze (24 hours) and returns the new state.
   */
  async longChatTip(
    site: Site,
    conversationId: string,
    action?: LongChatTipAction,
  ): Promise<LongChatTipState> {
    if (
      !isRouteConversationId(site, conversationId) ||
      (action !== undefined && action !== "close" && action !== "snooze")
    )
      throw new Error("payload_rejected");
    const scope = await this.currentScope();
    const conversation = await this.keyFor(
      scope,
      site,
      "conversation",
      conversationId,
    );
    return action
      ? this.longChatTips.write(scope.namespace, conversation, action)
      : this.longChatTips.read(scope.namespace, conversation);
  }
  async permissionRemoved() {
    await this.ready;
    const history = (await this.ledger.readOwnershipHistory())!;
    const personal = (await this.ledger.readPersonal())!;
    await this.ledger.applySessionChanges({
      ownershipHistory: transitionOwnership(history, {
        scope: { namespace: personal.namespace, mode: "personal", era: null },
        secret: personal.secret,
        policyVersion: "1.0.0",
      }),
    });
  }
  /**
   * How far the tracker's own read of a long ChatGPT chat got (14 Oct 2026,
   * `chatgpt-read-progress.ts`), kept per scope and keyed by the chat's conversation key.
   * Without `progress` it returns what is kept; its point to continue from counts only while
   * the saved prompt that starts the oldest page read still exists, so an import that never
   * landed, or an erased record, makes the next read start at the newest page again. With
   * `progress` it keeps that.
   */
  async chatgptReadProgress(
    conversationId: string,
    progress?: ChatgptReadProgress,
  ): Promise<ChatgptReadProgress | null> {
    if (
      !isRouteConversationId("chatgpt", conversationId) ||
      (progress !== undefined && !validChatgptReadProgress(progress))
    )
      throw new Error("payload_rejected");
    // Nothing about a chat is kept before the person agreed to tracking.
    if (!(await this.trackingConsented())) return null;
    const scope = await this.currentScope();
    const conversation = await this.keyFor(
      scope,
      "chatgpt",
      "conversation",
      conversationId,
    );
    if (progress) {
      await this.chatgptProgress.write(scope.namespace, conversation, progress);
      return progress;
    }
    const kept = await this.chatgptProgress.read(scope.namespace, conversation);
    if (!kept?.before) return kept;
    // The same key the history import gives a saved prompt (`HistoryService`).
    const prompt = await this.ledger.findHistoryMessage(
      scope,
      await this.keyFor(
        scope,
        "chatgpt",
        "history-message",
        JSON.stringify([conversationId, "prompt", kept.before]),
      ),
    );
    return prompt?.record.conversation_key === conversation
      ? kept
      : { ...kept, before: null, top: null };
  }
  async clearPersonal() {
    const scope = await this.currentScope();
    if (scope.mode !== "personal") throw new Error("policy_unavailable");
    const count = await this.ledger.eraseNamespace(scope.namespace);
    // A marker left from an organization erasure would refuse every record of that
    // membership if the person connects to it again. The full erase flags such markers,
    // and the connection releases one only when the server issues credentials for that
    // same membership, which confirms it is active (owner decision of 20 Oct 2026).
    await this.ledger.flagOrganizationMarkers();
    // The read progress of ChatGPT chats and closed long-chat tips go with their records.
    await this.chatgptProgress.erase(scope.namespace);
    await this.longChatTips.erase(scope.namespace);
    const personal = {
      namespace: `personal:${crypto.randomUUID()}`,
      secret: randomSecret(),
    };
    const routing = await this.ledger.routingSnapshot();
    const history = (await this.ledger.readOwnershipHistory())!;
    await this.ledger.applySessionChanges(
      {
        personal,
        ...(routing.ownership?.scope.namespace === scope.namespace
          ? {
              ownershipHistory: transitionOwnership(history, {
                scope: {
                  namespace: personal.namespace,
                  mode: "personal",
                  era: null,
                },
                secret: personal.secret,
                policyVersion: "1.0.0",
              }),
            }
          : {}),
      },
      { deviceId: routing.credentials?.device_id ?? null },
    );
    return { count };
  }
}
