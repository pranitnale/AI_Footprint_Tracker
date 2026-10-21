import type { FileTextCoverage, FileTextSeries } from "@footprint/ui";
import type {
  DisplayScenario,
  HistorySummary,
  HistoryView,
} from "@footprint/contracts";
import type { TrackingHealthIssue } from "../health";
import type { ViewKind } from "../ui-model";
import type { ResourceProvenance } from "./resource-presentation";
import type { TokenTotalKey } from "../token-summary";
import type { OwnReadSettingKey } from "../own-read-settings";
import type { OrganizationConsent, TrackingConsent } from "../tracking-consent";
import type { OrganizationFeatures } from "../organization-terms";

export type CounterValue = string | number | bigint | null;
export type LocalGroup = ResourceProvenance & {
  signature?: string;
  method_id?: string;
  profile_id?: string;
  profile_selection?: string;
  selected_profile_id?: string;
  cohort_id?: string;
  scope: string;
  unit?: string;
  value: string | null;
  known: number;
  evidence?: string;
  completeness?: string;
};
export type LocalMetric = ResourceProvenance & {
  value: string | null;
  known: number;
  unknown: number;
  unit?: string;
  groups?: LocalGroup[];
  reason?: string | null;
};
export { TOKEN_LABELS as LOCAL_TOKEN_LABELS } from "../token-summary";
export type LocalTokenKey = TokenTotalKey;
export type LocalSummary = {
  requests: number;
  attempts: number;
  tokens: Record<LocalTokenKey, LocalMetric>;
  metrics: {
    energy: LocalMetric;
    carbon: LocalMetric;
    waterDirect: LocalMetric;
    waterUpstream: LocalMetric;
    water: LocalMetric;
  };
  tools: Record<string, number>;
  models: string[];
  outcomes: Record<string, number>;
  images?: {
    operations: number;
    returned: string | null;
    unknown: number;
    completed: number;
  };
  estimate?: object | null;
  file_text?: FileTextSeries[] | null;
  file_text_coverage?: FileTextCoverage | null;
};
export type ServerSeries = ResourceProvenance & {
  quantity: string;
  unit: string;
  scope: string;
  value: string | null;
  unknown_count: CounterValue;
  contributing_attempt_count: CounterValue;
  profile_selection?: string;
  selected_profile_id?: string;
  cohort_id?: string;
  method_id?: string;
  validation_state?: string;
  method_group?: { method_id?: string };
};
export type ServerSummary = {
  scopeToken: string;
  aggregate_status: string;
  suppressed?: boolean;
  safe_message?: string;
  request_count?: string;
  attempt_count?: string;
  generated_at?: string;
  resources?: ServerSeries[];
  tokens?: ServerSeries[];
  coverage?: { resource_scope: string };
  retention_cutoff?: string | null;
  pending_estimates?: string;
  snapshot_source?: "server" | "cached";
  cached_at?: number;
  offline?: boolean;
  file_text?: FileTextSeries[] | null;
  file_text_coverage?: FileTextCoverage | null;
  calculation?: CalculationResult;
  history?: HistoryView;
};
export type CalculationResult = {
  pending?: boolean;
  view: "original" | "recalculated";
  methodId: string | null;
  methodHash: string | null;
};
export type RecalculationResult = {
  jobId: string;
  methodId: string;
  status: "pending" | "completed" | "failed" | "invalidated";
  processedEstimates: number;
  error:
    | "recalculation_pending"
    | "deletion_changed"
    | "recalculation_failed"
    | null;
};
export type MonthlySummary = {
  calculation?: CalculationResult;
  month: string;
  timezone: string;
  summary: ServerSummary | LocalSummary;
  generatedAt: number;
};
export type Settings = {
  paused: boolean;
  budget: number | null;
  timezone: string;
  displayScenario: DisplayScenario;
  /** The one tip switch before 16 October 2026; read through `longChatTipSettings`. */
  contextTip?: boolean;
  /**
   * The long-chat tip triggers (16 October 2026). The background always sends them; a copy
   * saved by an older version may lack them, so read them through `longChatTipSettings`.
   */
  contextTipRequests?: boolean;
  contextTipRequestLimit?: number;
  contextTipTokens?: boolean;
  /**
   * "Load full chat history automatically" (17 October 2026). Absent in a copy from an older
   * version, which reads as on; read them through `ownReadSettings`.
   */
  ownRead?: boolean;
  ownReadSites?: Partial<Record<OwnReadSettingKey, boolean>>;
  /**
   * The agreement to tracking (18 October 2026). The background always sends it; read it
   * through `consentRequired`, which keeps a copy without it as before.
   */
  consent?: TrackingConsent;
  /** The agreement given in the Connect dialog. */
  organizationConsent?: OrganizationConsent | null;
};
export type HeldQueue = {
  origin: string;
  count: number;
  state: "disconnected" | "revoked" | "reconnect_needed";
  revocation_pending: boolean;
};
export type Dashboard = {
  scopeToken: string;
  summary: LocalSummary;
  generatedAt: number;
  aggregate_status: "current" | "rebuilding";
  refreshAfterMs?: number | null;
  settings: Settings;
  mode: "personal" | "company";
  company: null | {
    origin: string;
    /** The name the organization's server gave; absent for connections saved before 13 October 2026. */
    company_name?: string;
    enrollment_state?: "active" | "revoked" | "reconnect_needed";
    policy: {
      pause_mode: "user_controlled" | "disabled_by_company";
      policy_version: string;
      usage_retention_months: number | null;
      /**
       * Days the organization kept connection addresses. Servers stopped collecting them on
       * 18 October 2026 and send 0; nothing shows it, and a server may leave it out.
       */
      ip_retention_days?: number;
      /** Whether members see organization totals; the server's policy names it, see `organizationSharing`. */
      company_sharing?: string;
      /** The organization's time zone, in which per-person views start their first day. */
      timezone?: string;
    };
    /** The server's operator switches as this browser last read them (lib/organization-terms.ts). */
    features?: OrganizationFeatures;
    /** The version of the Connect text for those switches. */
    consent_version?: string;
    /** Sharing waits until the person agrees to that text in Settings. */
    consent_required?: boolean;
  };
  /**
   * A connection in progress: "code_sent" waits for the email code (email and retry_at say where it
   * went and when another may be sent), "verified" waits for the person to confirm company_name.
   */
  pending: null | {
    origin: string;
    state: "code_sent" | "verified";
    expires_at: string;
    email?: string;
    retry_at?: string;
    company_name?: string;
  };
  queue: unknown[];
  queueCount?: number;
  /** Revisions the organization server refused for good; they never count as waiting. */
  refusedCount?: number;
  heldQueues?: HeldQueue[];
  health: TrackingHealthIssue[];
  calculation?: CalculationResult;
  history?: HistoryView;
};
export type TrackingHealthResponse = {
  health: TrackingHealthIssue[];
  status: "available" | "unavailable";
  scopeToken?: string;
};
export type RebuildMonitor = {
  key: string;
  view: ViewKind;
  attempts: number;
  startedAt: number;
  delayMs: number;
  stopped: "failed" | "exhausted" | null;
};

/** One bucket of the usage breakdown, shaped like the local totals. */
export type BreakdownSummary = Pick<
  LocalSummary,
  "requests" | "attempts" | "tokens" | "metrics" | "tools" | "models"
>;
/** How a model's counted replies were matched to estimation records (ReplySelection). */
export type ModelSelection = {
  kind: string;
  basis: string | null;
  record: string | null;
  replies: number;
};
export type UsageBreakdownView = {
  scopeToken: string;
  generatedAt: number;
  bucket: "hour" | "day";
  timezone: string;
  total: BreakdownSummary;
  /** "YYYY-MM-DD" days or "00" to "23" hours in the breakdown time zone. */
  buckets: Record<string, BreakdownSummary>;
  sites: Record<string, BreakdownSummary>;
  /** Keyed by the model that answered; `selections` is absent from a background before 19 October 2026. */
  models: Record<string, BreakdownSummary & { selections?: ModelSelection[] }>;
  chats: {
    key: string;
    requests: number;
    site: string;
    metrics: Pick<LocalSummary["metrics"], "energy" | "carbon" | "water">;
  }[];
  /** The tool each model answered on. */
  modelSites?: Record<string, string>;
  /** ISO start of the latest reply per tool in the window. */
  siteLastAt?: Record<string, string>;
  /** ISO start of each tool's latest live reply, when that reply could not be read to its end. */
  siteLastMissed?: Record<string, string>;
  calculation: { view: string; methodId: string | null; pending: boolean };
  /** Saved-history split in the same buckets; null while saved figures are unavailable. */
  history: null | {
    total: HistorySummary;
    buckets: Record<string, HistorySummary>;
    sites: Record<string, HistorySummary>;
    models: Record<string, HistorySummary>;
    chats: Record<string, HistorySummary>;
    modelSites?: Record<string, string>;
    siteLastAt?: Record<string, string>;
  };
};
