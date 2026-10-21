import type { ReasonCode, Site } from "@footprint/contracts";
export { MODEL_LABEL_PATTERN } from "@footprint/contracts";
import type { Scope } from "./ledger-support";

export interface StoredSettings {
  paused: boolean;
  budget: number | null;
  timezone: string;
  /** Absent in installations created before 17 September 2026; readers use DEFAULT_DISPLAY_SCENARIO. */
  displayScenario?: "minimum" | "midpoint" | "maximum";
  /**
   * The one long-chat tip switch of 12 to 16 October 2026 (absent meant on). Readers migrate
   * it to the fields below (`longChatTipSettings` in the extension); saving drops it.
   */
  contextTip?: boolean;
  /** The long-chat tip by request count. Absent before 16 October 2026: on unless contextTip is false. */
  contextTipRequests?: boolean;
  /** Requests that show the tip, 1 to 10,000. Absent before 16 October 2026: 50. */
  contextTipRequestLimit?: number;
  /** The long-chat tip by context share (with `budget`). Absent before 16 October 2026: off. */
  contextTipTokens?: boolean;
  /**
   * "Load full chat history automatically": whether the extension may read a chat's missing
   * messages from the site. Absent before 17 October 2026: on.
   */
  ownRead?: boolean;
  /** The same per site (chatgpt, claude, cowork, gemini, perplexity, notebooklm); absent: on. */
  ownReadSites?: Partial<
    Record<"chatgpt" | "claude" | "cowork" | "gemini" | "perplexity" | "notebooklm", boolean>
  >;
  /**
   * The person's agreement to tracking (18 October 2026): agreed, the version of the text and
   * when. Absent in installations from before that step, which reads as not agreed.
   */
  consent?: { agreed: boolean; version: string | null; at: number | null };
  /**
   * When tracking was last turned off (ms since 1970), kept after agreeing again. A live reply
   * still arriving then was ended by the withdrawal, not missed by the tracker. Absent before
   * 19 October 2026 and until the first withdrawal.
   */
  trackingWithdrawnAt?: number;
  /** The agreement given in the Connect dialog: the version of its text, when and to which server. */
  organizationConsent?: { version: string; at: number; origin: string } | null;
}
export interface StoredPersonal {
  namespace: string;
  secret: string;
}
export interface StoredInstallation {
  routingSecret: string;
}
export interface StoredOwnership {
  scope: Scope;
  secret: string;
  policyVersion: string;
  start: number;
  end: number | null;
}
export interface StoredOwnershipHistory {
  eras: StoredOwnership[];
}
export interface StoredCompanyPolicy {
  policy_version: string;
  disclosure_version: string;
  pause_mode: "user_controlled" | "disabled_by_company";
  usage_retention_months: number | null;
  timezone: string;
  /** Servers stopped collecting connection addresses on 18 October 2026 and send 0; optional. */
  ip_retention_days?: number;
  deletion_epoch: number;
}
export interface StoredEnrollmentEra {
  id: string;
  start: string;
  end: string | null;
}
export interface StoredCredentials {
  origin: string;
  namespace: string;
  access_token: string;
  refresh_token: string;
  access_expires_at: string;
  refresh_expires_at: string;
  company_id: string;
  user_id: string;
  device_id: string;
  installation_reconnect_secret: string;
  deletion_receipt_credential: string;
  key_version: "1";
  user_hmac_key: string;
  policy: StoredCompanyPolicy;
  enrollment_era: StoredEnrollmentEra;
  deletion_public_key: string;
  method_public_key?: string | null;
  enrollment_state?: "active" | "revoked" | "reconnect_needed";
  /**
   * The company's key for naming prompts and replies alike in every member's browser
   * (W11). Null when the server hands out none; then uploads carry no company keys.
   */
  company_dedup_key?: string | null;
  /**
   * The organization's name as its server gave it when this browser connected. Absent for
   * connections made before 13 October 2026; readers then fall back to a name from the origin.
   */
  company_name?: string;
  /**
   * The server's read-only operator switches from `/v1/config` (`features`), read when this
   * browser connected and at each policy check. Absent for connections saved before 19 October
   * 2026 and for servers that send none; both read as off.
   */
  features?: {
    person_analytics: boolean;
    ip_collection: boolean;
    person_analytics_since?: string;
  };
}
/**
 * A connection in progress. "code_sent": the email code went out and challenge_id names it.
 * "verified": the server accepted the code and holds connection_id until the person confirms.
 */
export interface StoredPendingConnection {
  origin: string;
  verifier: string;
  operation_id: string;
  exchange_id: string;
  /** The work email the code went to. Needed to send a new code; dropped once the code is accepted. */
  email?: string;
  challenge_id?: string;
  /** When the server lets this browser ask for another code. */
  retry_at?: string;
  connection_id?: string;
  /** The code's expiry while "code_sent", the connection's expiry once "verified". */
  expires_at?: string;
  state?: "code_sent" | "verified";
  company_name?: string;
  /** The policy version the person sees and acknowledges before connecting. */
  policy_version?: string;
  deletion_public_key?: string;
  exchange_started?: boolean;
  /**
   * The organization agreement the person gave with the Connect dialog's checkbox. Stored once
   * the exchange makes the connection, also when background maintenance finishes it.
   */
  consent_version?: string;
}
export interface StoredPendingPolicy {
  device_id: string;
  offered_at: number;
  policy: StoredCompanyPolicy;
}
export interface StoredRefreshOperation {
  id: string;
}
export interface StoredReconnect extends StoredCredentials {
  disconnect_pending: boolean;
  disconnect_operation_id: string;
  disconnect_refresh_id?: string | null;
}
export interface StoredDeletionEpoch {
  epoch: number;
}
export interface StoredDeletionReceipt {
  origin: string;
  company_id: string;
  user_id: string;
  device_id: string;
  deletion_receipt_credential: string;
  deletion_public_key: string;
  namespace: string;
  enrollment_era: StoredEnrollmentEra;
}
export interface StoredMonthlyClaim {
  namespace: string;
  month: string;
  claimedAt: number;
}
export interface RoutingSnapshot {
  credentials?: StoredCredentials;
  personal?: StoredPersonal;
  ownership: StoredOwnership | null;
}
export type SessionMaintenanceEntry =
  | { kind: "active"; session: StoredCredentials }
  | { kind: "reconnect"; session: StoredReconnect }
  | { kind: "deletion_receipt"; receipt: StoredDeletionReceipt };

/** Omitted fields stay unchanged; null removes only that named domain record. */
export interface SessionChanges {
  settings?: StoredSettings | null;
  personal?: StoredPersonal | null;
  installation?: StoredInstallation | null;
  ownershipHistory?: StoredOwnershipHistory | null;
  credentials?: StoredCredentials | null;
  pendingConnection?: StoredPendingConnection | null;
  pendingPolicy?: StoredPendingPolicy | null;
  refreshOperation?: StoredRefreshOperation | null;
  reconnects?: Array<{ origin: string; value: StoredReconnect | null }>;
  deletionEpochs?: Array<{
    deviceId: string;
    value: StoredDeletionEpoch | null;
  }>;
  deletionReceipts?: Array<{
    deviceId: string;
    value: StoredDeletionReceipt | null;
  }>;
}
export interface SessionTransitionGuard {
  deviceId: string | null;
  refreshToken?: string;
}
export interface SessionStateRepository {
  readSettings(): Promise<StoredSettings | undefined>;
  readPersonal(): Promise<StoredPersonal | undefined>;
  readInstallation(): Promise<StoredInstallation | undefined>;
  readOwnershipHistory(): Promise<StoredOwnershipHistory | undefined>;
  readCredentials(): Promise<StoredCredentials | undefined>;
  readPendingConnection(): Promise<StoredPendingConnection | undefined>;
  readPendingPolicy(): Promise<StoredPendingPolicy | undefined>;
  readRefreshOperation(): Promise<StoredRefreshOperation | undefined>;
  readReconnect(origin: string): Promise<StoredReconnect | undefined>;
  readDeletionEpoch(deviceId: string): Promise<StoredDeletionEpoch | undefined>;
  readDeletionReceipt(
    deviceId: string,
  ): Promise<StoredDeletionReceipt | undefined>;
  listSessionMaintenance(): Promise<SessionMaintenanceEntry[]>;
  readMonthlyClaim(namespace: string): Promise<StoredMonthlyClaim | undefined>;
  routingSnapshot(): Promise<RoutingSnapshot>;
  onRoutingChange(listener: () => void): () => void;
  /** Validate the guard and commit every supplied change atomically, or reject without changes. */
  applySessionChanges(
    changes: SessionChanges,
    expected?: SessionTransitionGuard,
  ): Promise<void>;
  claimMonthly(
    namespace: string,
    month: string,
    deviceId: string,
    deletionEpoch: number,
  ): Promise<boolean>;
  claimPersonalMonthly(namespace: string, month: string): Promise<boolean>;
}

export interface StoredSignedMethodUpdate {
  bundle: unknown;
  bundle_hash: string;
  issued_at: string;
  expires_at: string;
  signature: string;
}
export interface StoredAcceptedMethod {
  envelope: Readonly<StoredSignedMethodUpdate>;
  acceptedAt: string;
  delivery?: Readonly<StoredSignedMethodUpdate>;
  deliveryAcceptedAt?: string;
}
export type StoredMethodReason =
  | "trust_unconfigured"
  | "update_failed"
  | "expired_delivery"
  | "stored_method_invalid"
  | "scope_changed"
  | "catalog_full";
export interface StoredMethodCatalogPayload {
  namespace: string;
  version: 1;
  trust: string;
  records: StoredAcceptedMethod[];
  checkedAt: string | null;
  lastValidAt: string | null;
  reason: StoredMethodReason | null;
}
export interface StoredMethodCatalog extends StoredMethodCatalogPayload {
  seal: string;
}
export interface MethodCatalogSnapshot {
  catalog: StoredMethodCatalog;
  revision: string;
}
export interface MethodCatalogGuard {
  trust: string;
  erasureVersion: number;
  previousHash: string | null;
  ownershipStart: number | null;
}
export interface MethodCatalogRepository {
  readMethodCatalog(
    namespace: string,
  ): Promise<MethodCatalogSnapshot | undefined>;
  /** Stable digest for the existing sealed catalog format, independent of backend representation. */
  methodCatalogDigest(catalog: StoredMethodCatalogPayload): string;
  commitMethodCatalog(
    namespace: string,
    catalog: StoredMethodCatalog,
    expected: MethodCatalogGuard,
    validNow: () => boolean,
  ): Promise<void>;
}
export interface StoredHealth {
  namespace: string;
  code: ReasonCode;
  at: number;
  firstAt?: number;
  lastAt?: number;
  count?: number;
  /**
   * When the same kind of work last succeeded after this problem (resolveHealth). A health()
   * write leaves it out, so a problem that comes back is open again.
   */
  resolvedAt?: number;
}
/** A saved problem is solved once a success is recorded at or after its last occurrence. */
export function healthSolved(row: Pick<StoredHealth, "at" | "lastAt" | "resolvedAt">) {
  return (
    typeof row.resolvedAt === "number" && row.resolvedAt >= (row.lastAt ?? row.at)
  );
}
/**
 * A model label a site showed that the registry does not know. It stays in this browser
 * for Details and is never synced; replies carry only the site's unlisted id.
 */
export interface StoredModelLabel {
  namespace: string;
  site: Site;
  label: string;
  firstAt: number;
  lastAt: number;
  count: number;
}
/** Each namespace keeps this many labels; the least recently seen one is replaced first. */
export const MODEL_LABEL_LIMIT = 32;
export interface ModelLabelRepository {
  recordModelLabel(namespace: string, site: Site, label: string): Promise<void>;
  /** Most recently seen first. */
  listModelLabels(namespace: string): Promise<StoredModelLabel[]>;
}
export interface HealthRepository {
  health(namespace: string, code: ReasonCode): Promise<void>;
  /** Read at most limit records; the default and maximum are 1000. */
  listHealth(namespace: string, limit?: number): Promise<StoredHealth[]>;
  onHealthFailure(
    listener: (namespace: string, code: ReasonCode, error: unknown) => void,
  ): () => void;
  /**
   * The same kind of work succeeded, so the problems among codes that are open in this
   * namespace are solved now (owner decision of 16 October 2026). Nothing is deleted: a row
   * keeps its times and count, and its next health() write opens it again. Codes without a
   * row, or whose row is already solved, are not written, so a success with nothing open
   * costs one read. Returns the codes it closed.
   */
  resolveHealth(
    namespace: string,
    codes: readonly ReasonCode[],
  ): Promise<ReasonCode[]>;
  /** Told of every resolveHealth call, so problems kept only in memory close too. */
  onHealthResolved(
    listener: (namespace: string, codes: readonly ReasonCode[]) => void,
  ): () => void;
}
