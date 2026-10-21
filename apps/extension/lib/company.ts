import {
  healthSolved,
  resolveApplicationRepository,
  type ApplicationRepository,
  type RepositorySource,
  type Scope,
  type OutboxRow,
  type Ack,
  type StoredCompanyPolicy,
  type StoredCredentials,
  type StoredPendingConnection,
  type StoredReconnect,
  type StoredDeletionReceipt,
  type SessionChanges,
} from "@footprint/ledger";
import {
  canonicalJson,
  parseUsageBatch,
  SCHEMA_VERSION,
  OrganizationSelectionRequestSchema,
  OrganizationSelectionResponseSchema,
  type OrganizationSelectionRequest,
  type OrganizationSelectionResponse,
  type AttemptObservation,
  type CompanyKeyEntry,
} from "@footprint/contracts";
import { transitionOwnership } from "./ownership";
import { solveHealth, technicalDetail } from "./health";
import { estimateAttempt } from "@footprint/estimator";
import {
  organizationFeatures,
  sameFeatures,
  storedFeatures,
  type OrganizationFeatures,
} from "./organization-terms";

export type Policy = StoredCompanyPolicy;
export type Credentials = StoredCredentials;
export type PendingConnection = StoredPendingConnection;
export const randomSecret = () =>
  [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
// 32 random bytes as the server makes them (base64url), or 64 hex digits.
const COMPANY_DEDUP_KEY = /^(?:[A-Za-z0-9_-]{43}|[0-9a-f]{64})$/;
/** The company key a connection or refresh hands out (W11), checked. */
function companyDedupKey(value: unknown): string | null {
  // A server without company keys sends none; then no upload carries keys either.
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !COMPANY_DEDUP_KEY.test(value))
    throw new Error("payload_rejected");
  return value;
}
/**
 * An upload is built before its request may refresh the token, and the refresh can
 * withdraw the company key. Keys go only while the credentials in use hold one (W11).
 */
function withCompanyKeys(body: unknown, credentials: StoredCredentials) {
  if (
    credentials.company_dedup_key ||
    typeof body !== "object" ||
    body === null ||
    !Object.hasOwn(body, "company_dedup_keys")
  )
    return body;
  const { company_dedup_keys: _withdrawn, ...rest } = body as Record<
    string,
    unknown
  >;
  return rest;
}
export function companyOrigin(raw: string): string {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Enter the exact HTTPS company address, without a path.");
  return url.origin;
}
/**
 * Words for a failed connection start that the person can act on, or null when the failure is
 * not one of these and keeps the general handling. fetch rejects with one of these TypeError
 * messages (Chrome, Firefox, Safari) when the address has no DNS record, no certificate or refuses
 * this extension (CORS), and with a TimeoutError when it does not answer. Other TypeErrors are
 * programming faults and must not be explained away as a wrong address.
 */
const NETWORK_FAILURES = [
  "Failed to fetch",
  "NetworkError when attempting to fetch resource.",
  "Load failed",
];
/** Local refusals of a connection step whose words are already meant for the person. */
const CONNECT_REFUSALS = [
  "Finish or cancel the connection in progress before starting again.",
  "Disconnect this company before connecting another.",
  "Enter your work email, for example name@your-organization.com.",
  "Enter the 6-digit code from the email.",
  "The connection in progress has ended. Start again.",
];
/**
 * Server answers to a connection step that the person can act on. The words are the extension's
 * own rather than the server's safe_message, so a self-hosted server cannot put other text here.
 */
const CONNECT_ANSWERS: Record<string, string> = {
  organization_not_found:
    "No organization uses this work email domain. Check that you used your work email, ask your administrator which work email the organization was registered with, or register your organization at aifootprinttracker.com.",
  admin_required:
    "Only administrators sign in on the website. Members connect from the AI Footprint Tracker browser extension.",
  work_email_required:
    "Use your work email. Free email providers cannot belong to an organization.",
  otp_invalid_or_expired:
    "The code is wrong or has expired. Check the latest email, or send a new code.",
  otp_rate_limited:
    "Too many codes were requested for this email. Wait a few minutes and try again.",
  rate_limited: "Too many attempts from this browser. Wait a few minutes and try again.",
  email_service_unavailable:
    "The email with your code could not be sent. Try again later.",
  policy_changed:
    "Your organization changed what it collects while you were connecting. Start again to see the current terms.",
  capacity_reached:
    "Your organization has reached its member limit. Ask your administrator to free a place or raise the limit.",
  member_unavailable:
    "This work email cannot connect because an administrator removed or blocked it. Ask your administrator.",
  connection_denied:
    "Your organization refused this connection. Start again, and ask your administrator if it happens again.",
  connection_expired: "The connection took too long and expired. Start again.",
};
/** Server answers after which the connection in progress cannot go on, so it is dropped. */
const CONNECTION_ENDED = new Set([
  "organization_not_found",
  "work_email_required",
  "policy_changed",
  "capacity_reached",
  "member_unavailable",
  "connection_denied",
  "connection_expired",
]);
/** The error code from a server's error body, kept by call() beside its general message. */
export function serverErrorCode(error: unknown): string | null {
  const code = (error as { serverCode?: unknown } | null)?.serverCode;
  return typeof code === "string" ? code : null;
}
function connectAnswer(code: string | null): string | null {
  if (!code) return null;
  if (Object.hasOwn(CONNECT_ANSWERS, code)) return CONNECT_ANSWERS[code]!;
  // The server names its member limit with a capacity code; any of them means the same here.
  return code.startsWith("capacity") ? CONNECT_ANSWERS.capacity_reached! : null;
}
/**
 * Whether a request failed because the server could not be reached at all. Only these failures
 * may be shown as offline; a server that answers with an error (for example while it recalculates
 * after an update) is reachable, and other TypeErrors are programming faults.
 */
export function isNetworkFailure(error: unknown): boolean {
  return (
    (error instanceof TypeError && NETWORK_FAILURES.includes(error.message)) ||
    (error instanceof DOMException && error.name === "TimeoutError")
  );
}
export function connectFailureMessage(error: unknown): string | null {
  if (isNetworkFailure(error))
    return "The organization server could not be reached. Check your internet connection. If your organization runs its own server, check its address.";
  if (error instanceof Error && CONNECT_REFUSALS.includes(error.message))
    return error.message;
  return connectAnswer(serverErrorCode(error));
}
/** The code a connection failure is reported with: the server's own, or connect_failed. */
export function connectFailureCode(error: unknown): string {
  const code = serverErrorCode(error);
  return code && connectAnswer(code) ? code : "connect_failed";
}
/**
 * The background's reply to a connection step that failed in a way the person can act on, or null
 * for the general handling. A server answer is fully explained by its words; the technical detail
 * helps only with a failure on the way there, and for a 401 it would read "auth_reconnect_required".
 */
export function connectFailureReply(error: unknown) {
  const reason = connectFailureMessage(error);
  if (!reason) return null;
  const code = connectFailureCode(error);
  return {
    ok: false as const,
    code,
    error: reason,
    ...(code === "connect_failed" ? { detail: technicalDetail(error) } : {}),
  };
}
/**
 * 403 codes after which this browser has lost its place in the organization: an administrator
 * removed the browser or its member (enrollment_revoked), its refresh token family was revoked
 * after a reuse (refresh_reuse_detected), the server no longer knows it as an installation
 * (installation_required) or its member is no longer active (identity_unavailable). Every other
 * 403, for example origin_mismatch from a misconfigured proxy, keeps the connection.
 */
const ACCESS_ENDED = new Set([
  "enrollment_revoked",
  "refresh_reuse_detected",
  "installation_required",
  "identity_unavailable",
]);
/**
 * The organization is suspended or its deletion is scheduled (service_suspended). An administrator
 * can cancel a scheduled deletion within 7 days, so sharing waits and the connection is kept.
 */
const SHARING_PAUSED = "service_suspended";
/** How long sync waits before asking a paused organization again. */
const SHARING_PAUSE_RETRY_MS = 10 * 60 * 1000;
/**
 * How far back the health report sent at each sync looks. The admin Health page counts a browser
 * as synced over the last 24 hours, so a problem stays listed for the same day and then goes.
 */
export const HEALTH_REPORT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Server codes a caller acts on, copied to the error's message and code. */
const NAMED_REFUSALS = new Set([
  "thread_relation_conflict",
  "deletion_epoch_changed",
  "deletion_in_progress",
  "aggregate_rebuilding",
  "thread_identity_unresolved",
  "recalculation_pending",
  "method_update_invalid",
  "method_unsupported",
]);
/** Refusals named on any call, also outside an enrollment-pinned request. */
const UNPINNED_REFUSALS = new Set([
  "recalculation_pending",
  "method_update_invalid",
  "method_unsupported",
]);
export type FailedAnswer = Error & {
  status: number;
  retryAfter: number;
  serverCode?: string;
  code?: string;
};
/** Whether a failed call means this browser lost access to the organization. */
export function isAccessEnded(error: unknown): boolean {
  return (
    (error as { status?: unknown } | null)?.status === 403 &&
    ACCESS_ENDED.has(serverErrorCode(error) ?? "")
  );
}
/** Whether a failed call means the organization paused sharing for now. */
export function isSharingPaused(error: unknown): boolean {
  return (
    (error as { status?: unknown } | null)?.status === 403 &&
    serverErrorCode(error) === SHARING_PAUSED
  );
}
/**
 * The error for a server answer that is not ok. Its body is read leniently: a proxy in front of the
 * server may answer 502, 503, 429, 401 or 403 with an HTML page, and the status and Retry-After
 * must still reach the caller, so a 401 asks to reconnect and a 503 waits.
 */
function failedAnswer(
  response: Response,
  body: Uint8Array,
  pinned: boolean,
): FailedAnswer {
  let code: string | null = null;
  try {
    const parsed = JSON.parse(new TextDecoder("utf-8").decode(body));
    const value = parsed?.error?.code;
    if (typeof value === "string" && /^[a-z0-9_]{1,64}$/.test(value)) code = value;
  } catch {
    code = null;
  }
  const status = response.status;
  const error = new Error(
    status === 401
      ? "auth_reconnect_required"
      : status === 403
        ? code && ACCESS_ENDED.has(code)
          ? "enrollment_revoked"
          : code === SHARING_PAUSED
            ? "sync_delayed"
            : "policy_unavailable"
        : status === 429 || status >= 500
          ? "sync_delayed"
          : "payload_rejected",
  ) as FailedAnswer;
  error.status = status;
  // Kept apart from message and code, which other callers read, so only the steps that explain a
  // refusal see it (connectFailureMessage, isAccessEnded, isSharingPaused).
  if (code) error.serverCode = code;
  if (code && NAMED_REFUSALS.has(code) && (pinned || UNPINNED_REFUSALS.has(code)))
    Object.assign(error, { code, message: code });
  const delay = response.headers.get("Retry-After");
  const wait = delay
    ? /^\d+$/.test(delay.trim())
      ? Number(delay.trim()) * 1000
      : Date.parse(delay) - Date.now()
    : 0;
  error.retryAfter = Number.isFinite(wait) ? Math.max(0, wait) : 0;
  return error;
}
function connectionRefusal(code: string): Error {
  return Object.assign(new Error(code), { serverCode: code });
}
const WORK_EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]+$/;
export async function sha256(text: string): Promise<string> {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type CompanySession = Pick<CompanyClient, keyof CompanyClient>;

export class CompanyClient {
  methodMaintenance?: () => Promise<void>;
  historyMaintenance?: () => Promise<void>;
  estimationMaintenance?: () => Promise<void>;
  /**
   * Whether the person agreed to tracking (lib/tracking-consent.ts). Before that, and after they
   * turned tracking off, a sync applies erasures only: no policy read, health report or upload,
   * and no history or estimation maintenance. Absent, everything runs as before.
   */
  trackingAllowed?: () => Promise<boolean>;
  /**
   * Whether the person's organization agreement covers what this server's operator switches
   * change (lib/organization-terms.ts). While it does not, sharing is held: a sync applies
   * erasures and checks the policy but sends no health report or record, and no history or
   * thread link is uploaded. Absent, nothing is held.
   */
  organizationAgreed?: (
    origin: string,
    features: OrganizationFeatures,
  ) => Promise<boolean>;
  /**
   * Keeps the organization agreement the person gave in the Connect dialog once the connection
   * it was given for is made (`Coordinator.recordOrganizationConsent`). confirm() calls it,
   * whether the dialog's own request or background maintenance finishes the exchange.
   */
  connectionAgreed?: (version: string, origin: string) => Promise<void>;
  canonicalEstimation?: (
    scope: Scope,
    attempt: AttemptObservation,
  ) => Promise<void>;
  private refreshFlight: Promise<Credentials> | null = null;
  private syncFlight: Promise<void> | null = null;
  private policyFlight: Promise<void> | null = null;
  /** The organization paused sharing; see sharingPaused(). */
  private paused = false;
  /** While sharing is paused, syncs wait until this time (ms) before asking again. */
  private pausedUntil = 0;
  /** Sharing waits for the person's agreement; see sharingHeld(). */
  private held = false;
  private repository: ApplicationRepository;
  constructor(
    source: RepositorySource,
    private transport: typeof fetch = fetch,
    private hasConsent: (origin: string) => Promise<boolean> = async () => true,
  ) {
    this.repository = resolveApplicationRepository(source);
  }
  credentials() {
    return this.repository.readCredentials();
  }
  pending() {
    return this.repository.readPendingConnection();
  }
  private async call(
    origin: string,
    path: string,
    body: unknown | undefined,
    token?: string,
    expected?: { scope: Scope; device: string; epoch: number },
    limits?: { bytes: number; signal?: AbortSignal },
    method?: "GET" | "POST" | "PUT",
  ): Promise<any> {
    const verified = companyOrigin(origin);
    if (!(await this.hasConsent(verified)))
      throw new Error("policy_unavailable");
    if (expected) {
      const current = await this.credentials();
      if (
        !current ||
        current.namespace !== expected.scope.namespace ||
        current.device_id !== expected.device ||
        current.enrollment_era.id !== expected.scope.era ||
        current.access_token !== token ||
        current.policy.deletion_epoch !== expected.epoch ||
        current.enrollment_state === "revoked" ||
        current.enrollment_state === "reconnect_needed"
      )
        throw new Error("policy_unavailable");
    }
    if (!path.startsWith("/v1/") || path.includes("://"))
      throw new Error("payload_rejected");
    const deadline = Date.now() + 20000;
    const signal = limits?.signal
      ? AbortSignal.any([limits.signal, AbortSignal.timeout(20000)])
      : AbortSignal.timeout(20000);
    // Called unbound: browsers refuse fetch with "Illegal invocation" when it runs as a method of
    // another object, and the background passes the global fetch.
    const transport = this.transport;
    const response = await transport(verified + path, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      signal,
    });
    if (response.ok && !response.body) throw new Error("payload_rejected");
    // The cap guards the service worker's memory. A call allowed more than 1 MiB (a summary with
    // its splits) grows its buffer only as far as the answer needs instead of reserving the cap.
    const cap = limits?.bytes ?? 1048576;
    let buffer = new Uint8Array(Math.min(cap, 1048576));
    let bytes = 0;
    let reads = 0;
    const check = () => {
      // A deadline that passes while the body arrives is a timeout like one before the answer,
      // so it counts as a network failure (isNetworkFailure). A caller's own abort is not.
      if (
        Date.now() >= deadline ||
        (signal.aborted &&
          (signal.reason as DOMException | undefined)?.name === "TimeoutError")
      )
        throw new DOMException(
          "The organization server did not answer in time.",
          "TimeoutError",
        );
      if (signal.aborted) throw new Error("policy_unavailable");
    };
    if (response.body) {
      const reader = response.body.getReader();
      try {
        for (;;) {
          check();
          if (++reads > 8192) throw new Error("payload_rejected");
          // Yield even for immediately resolved empty chunks so cancellation can run.
          if (reads % 64 === 0) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            check();
          }
          const { done, value } = await reader.read();
          check();
          if (done) break;
          if (value.length > buffer.length - bytes) {
            // An error answer keeps its status even when a proxy sends a long page with it.
            if (!response.ok) break;
            if (value.length > cap - bytes) throw new Error("payload_rejected");
            const grown = new Uint8Array(
              Math.min(cap, Math.max(buffer.length * 2, bytes + value.length)),
            );
            grown.set(buffer.subarray(0, bytes));
            buffer = grown;
          }
          buffer.set(value, bytes);
          bytes += value.length;
        }
      } catch (error) {
        void reader.cancel().catch(() => {});
        throw error;
      }
      if (!response.ok) void reader.cancel().catch(() => {});
    }
    if (!response.ok) throw failedAnswer(response, buffer.subarray(0, bytes), !!expected);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      buffer.subarray(0, bytes),
    );
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("payload_rejected");
    }
    if (expected) {
      const latest = await this.credentials();
      if (
        !latest ||
        latest.namespace !== expected.scope.namespace ||
        latest.device_id !== expected.device ||
        latest.enrollment_era.id !== expected.scope.era ||
        latest.policy.deletion_epoch !== expected.epoch ||
        (latest.enrollment_state && latest.enrollment_state !== "active")
      )
        throw new Error("policy_unavailable");
    }
    return data;
  }
  /**
   * Step 1 of connecting: the server emails a 6-digit code to the work email. Nothing is stored
   * before the server answers, so a mistyped address or email leaves no connection behind. Asking
   * again for the same origin sends a new code and keeps the verifier and operation ids.
   */
  async requestCode(
    rawOrigin: string,
    rawEmail: string,
  ): Promise<PendingConnection> {
    const origin = companyOrigin(rawOrigin);
    const email = rawEmail.trim();
    if (email.length > 254 || !WORK_EMAIL.test(email))
      throw new Error(
        "Enter your work email, for example name@your-organization.com.",
      );
    if (await this.credentials())
      throw new Error("Disconnect this company before connecting another.");
    const prior = await this.pending();
    // A code the server accepted holds a connection there; it is cancelled, not replaced. A
    // connection stored by the earlier approval-page flow cannot be finished and gives way.
    if (prior?.connection_id && prior.state === "verified")
      throw new Error(
        "Finish or cancel the connection in progress before starting again.",
      );
    const base =
      prior?.state === "code_sent" && prior.origin === origin
        ? prior
        : {
            origin,
            verifier: randomSecret(),
            operation_id: crypto.randomUUID(),
            exchange_id: crypto.randomUUID(),
          };
    const result = await this.call(origin, "/v1/connections/otp/request", {
      email,
      dispatch_id: crypto.randomUUID(),
    });
    if (
      result.error_code === "email_service_unavailable" ||
      result.delivery_state === "failed"
    )
      throw connectionRefusal("email_service_unavailable");
    if (
      typeof result.challenge_id !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(result.challenge_id) ||
      !Number.isFinite(Date.parse(result.expires_at)) ||
      !Number.isFinite(Date.parse(result.retry_at))
    )
      throw new Error("payload_rejected");
    const pending: PendingConnection = {
      origin,
      verifier: base.verifier,
      operation_id: base.operation_id,
      exchange_id: base.exchange_id,
      email,
      challenge_id: result.challenge_id,
      expires_at: result.expires_at,
      retry_at: result.retry_at,
      state: "code_sent",
    };
    await this.repository.applySessionChanges({ pendingConnection: pending });
    return pending;
  }
  /**
   * Step 2: the server checks the code, finds the organization by the email's domain and holds a
   * connection for this browser's verifier. It returns the organization's name and current policy
   * for the person to confirm; nothing is shared yet.
   */
  async verifyCode(
    rawCode: string,
    browserFamily: "chrome" | "edge" | "firefox",
  ): Promise<PendingConnection> {
    const code = rawCode.replace(/\s/g, "");
    if (!/^\d{6}$/.test(code))
      throw new Error("Enter the 6-digit code from the email.");
    const pending = await this.pending();
    if (pending?.state !== "code_sent" || !pending.challenge_id)
      throw new Error("The connection in progress has ended. Start again.");
    const prior = await this.repository.readReconnect(pending.origin);
    let result: any;
    try {
      result = await this.call(pending.origin, "/v1/connections", {
        verifier_challenge: await sha256(pending.verifier),
        challenge_method: "S256",
        browser_family: browserFamily,
        protocol_version: "1.0.0",
        operation_id: pending.operation_id,
        challenge_id: pending.challenge_id,
        code,
        ...(prior
          ? {
              resume_device_id: prior.device_id,
              installation_reconnect_secret: prior.installation_reconnect_secret,
            }
          : {}),
      });
    } catch (error) {
      await this.dropEndedConnection(error);
      throw error;
    }
    const name =
      typeof result.company_name === "string"
        ? result.company_name.trim().slice(0, 200)
        : "";
    if (
      typeof result.connection_id !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(result.connection_id) ||
      result.state !== "verified" ||
      !Number.isFinite(Date.parse(result.expires_at)) ||
      !name ||
      typeof result.deletion_public_key !== "string" ||
      !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(result.policy?.policy_version)
    )
      throw new Error("payload_rejected");
    // The server must name the address this browser asked, as /v1/public/config did before.
    if (result.company_origin !== pending.origin)
      throw new Error("policy_unavailable");
    const verified: PendingConnection = {
      origin: pending.origin,
      verifier: pending.verifier,
      operation_id: pending.operation_id,
      exchange_id: pending.exchange_id,
      connection_id: result.connection_id,
      expires_at: result.expires_at,
      state: "verified",
      company_name: name,
      policy_version: result.policy.policy_version,
      deletion_public_key: result.deletion_public_key,
    };
    await this.repository.applySessionChanges({ pendingConnection: verified });
    return verified;
  }
  private async dropEndedConnection(error: unknown) {
    const code = serverErrorCode(error);
    if (code && (CONNECTION_ENDED.has(code) || code.startsWith("capacity")))
      await this.repository.applySessionChanges({ pendingConnection: null });
  }
  /**
   * Step 3: the person confirmed the organization and what it collects. The exchange acknowledges
   * that policy version and hands out the credentials. A retry after a failed save repeats the
   * same exchange id, which the server answers again with the same credentials.
   *
   * `consentVersion` is the organization agreement the person gave with the Connect dialog's
   * checkbox. It is kept with the exchange, so the agreement is stored when the connection is
   * made, also when the dialog's request failed on the way and background maintenance finishes
   * the exchange later (before 20 Oct 2026 that agreement was lost, and sharing was held).
   */
  async confirm(consentVersion?: string): Promise<"connected"> {
    let p = await this.pending();
    if (p?.state !== "verified" || !p.connection_id || !p.policy_version)
      throw new Error("The connection in progress has ended. Start again.");
    if (!p.exchange_started || (consentVersion && p.consent_version !== consentVersion)) {
      p = {
        ...p,
        exchange_started: true,
        ...(consentVersion ? { consent_version: consentVersion } : {}),
      };
      await this.repository.applySessionChanges({ pendingConnection: p });
    }
    let result: any;
    try {
      result = await this.call(p.origin, "/v1/connections/exchange", {
        connection_id: p.connection_id,
        verifier: p.verifier,
        exchange_id: p.exchange_id,
        policy_version: p.policy_version,
        disclosure_acknowledged: true,
      });
    } catch (error) {
      await this.dropEndedConnection(error);
      throw error;
    }
    for (const key of [
      "company_id",
      "user_id",
      "device_id",
      "access_token",
      "refresh_token",
      "user_hmac_key",
      "installation_reconnect_secret",
      "deletion_receipt_credential",
    ])
      if (
        typeof result[key] !== "string" ||
        !result[key].length ||
        result[key].length > 4096
      )
        throw new Error("payload_rejected");
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (
      !["company_id", "user_id", "device_id"].every((key) =>
        uuid.test(result[key]),
      ) ||
      !uuid.test(result.enrollment_era?.id) ||
      result.key_version !== "1"
    )
      throw new Error("payload_rejected");
    if (
      !result.policy ||
      !["user_controlled", "disabled_by_company"].includes(
        result.policy.pause_mode,
      ) ||
      !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(result.policy.policy_version) ||
      !Number.isFinite(Date.parse(result.access_expires_at)) ||
      !Number.isFinite(Date.parse(result.refresh_expires_at))
    )
      throw new Error("payload_rejected");
    const companyKey = companyDedupKey(result.company_dedup_key);
    if (result.method_public_key != null) {
      try {
        if (
          typeof result.method_public_key !== "string" ||
          result.method_public_key.length > 512 ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(result.method_public_key)
        )
          throw new Error();
        await crypto.subtle.importKey(
          "spki",
          Uint8Array.from(atob(result.method_public_key), (c) =>
            c.charCodeAt(0),
          ),
          { name: "ECDSA", namedCurve: "P-256" },
          false,
          ["verify"],
        );
      } catch {
        throw new Error("method_update_invalid");
      }
    }
    const credentials: Credentials = {
      origin: p.origin,
      namespace: `company:${result.company_id}:${result.user_id}`,
      access_token: result.access_token,
      refresh_token: result.refresh_token,
      access_expires_at: result.access_expires_at,
      refresh_expires_at: result.refresh_expires_at,
      company_id: result.company_id,
      user_id: result.user_id,
      device_id: result.device_id,
      installation_reconnect_secret: result.installation_reconnect_secret,
      deletion_receipt_credential: result.deletion_receipt_credential,
      key_version: result.key_version,
      user_hmac_key: result.user_hmac_key,
      policy: result.policy,
      enrollment_era: result.enrollment_era,
      deletion_public_key: p.deletion_public_key!,
      method_public_key: result.method_public_key ?? null,
      company_dedup_key: companyKey,
    };
    // The exchange names the organization again; the name confirmed in step 2 stands in when not.
    const exchangedName =
      typeof result.company_name === "string"
        ? result.company_name.trim().slice(0, 200)
        : "";
    if (exchangedName || p.company_name)
      credentials.company_name = exchangedName || p.company_name;
    // The server just issued credentials for this membership, so it is active and was not
    // deleted (a deleted person can never get the same user id back). A marker for this
    // namespace that a full Personal erase flagged is then a leftover and goes; an
    // unflagged marker stays and keeps refusing records (owner decision of 20 Oct 2026).
    await this.repository.releaseFlaggedMarker(credentials.namespace);
    const history = await this.repository.readOwnershipHistory();
    if (!history) throw new Error("policy_unavailable");
    const nextHistory = transitionOwnership(history, {
      scope: {
        namespace: credentials.namespace,
        mode: "company",
        era: credentials.enrollment_era.id,
      },
      secret: credentials.user_hmac_key,
      policyVersion: credentials.policy.policy_version,
    });
    const existingCredentials = await this.credentials();
    if (existingCredentials?.device_id === credentials.device_id) {
      await this.repository.applySessionChanges({ pendingConnection: null });
      await this.keepConnectionAgreement(p);
      return "connected";
    }
    await this.repository.applySessionChanges(
      {
        credentials,
        ownershipHistory: nextHistory,
        pendingConnection: null,
        reconnects: [{ origin: p.origin, value: null }],
        refreshOperation: null,
        pendingPolicy: null,
      },
      { deviceId: null },
    );
    await this.keepConnectionAgreement(p);
    return "connected";
  }
  /** Stores the Connect dialog's agreement that was kept with a finished exchange. */
  private async keepConnectionAgreement(p: PendingConnection) {
    if (p.consent_version && this.connectionAgreed)
      await this.connectionAgreed(p.consent_version, p.origin);
  }
  async cancel(): Promise<void> {
    const p = await this.pending();
    if (p?.connection_id)
      await this.call(p.origin, "/v1/connections/cancel", {
        connection_id: p.connection_id,
        verifier: p.verifier,
      });
    await this.repository.applySessionChanges({ pendingConnection: null });
  }
  async disconnect(): Promise<void> {
    const c = await this.credentials();
    if (!c) return;
    this.held = false;
    const held = {
      ...c,
      disconnect_pending: true,
      disconnect_operation_id: crypto.randomUUID(),
    };
    const history = await this.repository.readOwnershipHistory();
    const personal = await this.repository.readPersonal();
    if (!history || !personal) throw new Error("policy_unavailable");
    const nextHistory = transitionOwnership(history, {
      scope: { namespace: personal.namespace, mode: "personal", era: null },
      secret: personal.secret,
      policyVersion: "1.0.0",
    });
    await this.repository.applySessionChanges(
      {
        reconnects: [{ origin: c.origin, value: held }],
        ownershipHistory: nextHistory,
        credentials: null,
        refreshOperation: null,
        pendingPolicy: null,
      },
      { deviceId: c.device_id, refreshToken: c.refresh_token },
    );
    try {
      await this.finishDisconnect(held);
    } catch {
      await this.repository.health(c.namespace, "sync_delayed");
    }
  }
  private async finishDisconnect(input: StoredReconnect): Promise<void> {
    let held = input;
    try {
      await this.call(
        held.origin,
        "/v1/connections/disconnect",
        { operation_id: held.disconnect_operation_id },
        held.access_token,
      );
    } catch (error) {
      if ((error as any).status !== 401 || !held.refresh_token) throw error;
      held = {
        ...held,
        disconnect_refresh_id:
          held.disconnect_refresh_id ?? crypto.randomUUID(),
      };
      await this.repository.applySessionChanges({
        reconnects: [{ origin: held.origin, value: held }],
      });
      const refreshed = await this.call(held.origin, "/v1/auth/refresh", {
        refresh_token: held.refresh_token,
        operation_id: held.disconnect_refresh_id,
      });
      held = {
        ...held,
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token,
        disconnect_refresh_id: null,
      };
      await this.repository.applySessionChanges({
        reconnects: [{ origin: held.origin, value: held }],
      });
      await this.call(
        held.origin,
        "/v1/connections/disconnect",
        { operation_id: held.disconnect_operation_id },
        held.access_token,
      );
    }
    await this.repository.applySessionChanges({
      reconnects: [
        {
          origin: held.origin,
          value: {
            ...held,
            disconnect_pending: false,
            access_token: "",
            refresh_token: "",
          },
        },
      ],
    });
  }
  private async refresh(): Promise<Credentials> {
    if (this.refreshFlight) return this.refreshFlight;
    this.refreshFlight = (async () => {
      const c = await this.credentials();
      if (!c) throw new Error("auth_reconnect_required");
      let operation = await this.repository.readRefreshOperation();
      if (!operation) {
        operation = { id: crypto.randomUUID() };
        await this.repository.applySessionChanges({
          refreshOperation: operation,
        });
      }
      const result = await this.call(c.origin, "/v1/auth/refresh", {
        refresh_token: c.refresh_token,
        operation_id: operation.id,
      });
      if (
        typeof result.access_token !== "string" ||
        typeof result.refresh_token !== "string"
      )
        throw new Error("payload_rejected");
      const companyKey = companyDedupKey(result.company_dedup_key);
      const latest = await this.credentials();
      if (!latest || latest.device_id !== c.device_id)
        throw new Error("auth_reconnect_required");
      const next = {
        ...latest,
        access_token: result.access_token,
        refresh_token: result.refresh_token,
        access_expires_at: result.access_expires_at,
        refresh_expires_at: result.refresh_expires_at,
        // Installations enrolled before company keys receive the key here. A server that
        // no longer hands one out gets no keys from now on.
        company_dedup_key: companyKey,
      };
      await this.repository.applySessionChanges(
        { credentials: next, refreshOperation: null },
        { deviceId: c.device_id, refreshToken: c.refresh_token },
      );
      return next;
    })().finally(() => {
      this.refreshFlight = null;
    });
    return this.refreshFlight;
  }
  async authorized(
    path: string,
    body?: unknown,
    expected?: { scope: Scope; device: string; epoch: number },
    /** Largest answer accepted, in bytes; 1 MiB when not given. */
    maxBytes?: number,
  ): Promise<any> {
    let c = await this.credentials();
    if (!c) throw new Error("auth_reconnect_required");
    if (c.enrollment_state === "revoked") throw new Error("enrollment_revoked");
    if (c.enrollment_state === "reconnect_needed")
      throw new Error("auth_reconnect_required");
    const pinned = expected ?? {
      scope: {
        namespace: c.namespace,
        mode: "company" as const,
        era: c.enrollment_era.id,
      },
      device: c.device_id,
      epoch: c.policy.deletion_epoch,
    };
    try {
      if (Date.parse(c.access_expires_at) < Date.now() + 30000)
        c = await this.refresh();
      let result;
      const limits = maxBytes === undefined ? undefined : { bytes: maxBytes };
      try {
        result = await this.call(
          c.origin,
          path,
          withCompanyKeys(body, c),
          c.access_token,
          pinned,
          limits,
        );
      } catch (error) {
        if ((error as any).status !== 401) throw error;
        c = await this.refresh();
        result = await this.call(
          c.origin,
          path,
          withCompanyKeys(body, c),
          c.access_token,
          pinned,
          limits,
        );
      }
      this.paused = false;
      return result;
    } catch (error) {
      if (isAccessEnded(error)) await this.holdEnrollment(c, "revoked");
      else if (isSharingPaused(error)) this.paused = true;
      throw error;
    }
  }
  /**
   * Whether the organization paused sharing (suspended, or its deletion is scheduled) on the last
   * answer. Records wait in this browser and the connection is kept; it clears once a call
   * succeeds again.
   */
  sharingPaused(): boolean {
    return this.paused;
  }
  /**
   * Whether the last check found sharing held for the person's agreement to what the server's
   * operator switches change. Records wait in this browser; Details and Settings say so.
   */
  sharingHeld(): boolean {
    return this.held;
  }
  private async holdsSharing(
    origin: string,
    features: OrganizationFeatures,
  ): Promise<boolean> {
    if (!this.organizationAgreed) return false;
    this.held = !(await this.organizationAgreed(origin, features));
    return this.held;
  }
  /**
   * Reads the policy and the server's operator switches now. Called right after connecting, so a
   * switch that is on asks for the person's agreement before the first sync shares anything.
   */
  async checkPolicy(): Promise<OrganizationFeatures> {
    const c = await this.credentials();
    if (!c) throw new Error("auth_reconnect_required");
    return this.refreshPolicy(c);
  }
  /** Keeps the switches with the credentials when they changed. */
  private async keepFeatures(deviceId: string, features: OrganizationFeatures) {
    const latest = await this.credentials();
    if (
      !latest ||
      latest.device_id !== deviceId ||
      sameFeatures(latest.features, features)
    )
      return;
    await this.repository.applySessionChanges(
      { credentials: { ...latest, features } },
      { deviceId, refreshToken: latest.refresh_token },
    );
  }
  async threadRequest(scope: Scope, path: string, body?: unknown) {
    if (
      path !== "/v1/me/thread-relations" &&
      path !== "/v1/me/history" &&
      !/^\/v1\/me\/history\/[a-f0-9]{64}\/summary\?period=all(?:&calculation_view=original|&calculation_view=recalculated&method_id=[a-z0-9][a-z0-9.-]{0,127})?$/.test(
        path,
      ) &&
      path !== "/v1/me/recalculations" &&
      !/^\/v1\/me\/recalculations\/[a-f0-9]{64}$/.test(path) &&
      !/^\/v1\/me\/recorded-threads\/[a-f0-9]{64}\/summary\?period=all(?:&calculation_view=original|&calculation_view=recalculated&method_id=[a-z0-9][a-z0-9.-]{0,127})?$/.test(
        path,
      )
    )
      throw new Error("payload_rejected");
    let c = await this.credentials();
    if (
      !c ||
      scope.mode !== "company" ||
      c.namespace !== scope.namespace ||
      c.enrollment_era.id !== scope.era
    )
      throw new Error("policy_unavailable");
    if (Date.parse(c.access_expires_at) < Date.now() + 30000)
      c = await this.refresh();
    if (c.namespace !== scope.namespace || c.enrollment_era.id !== scope.era)
      throw new Error("policy_unavailable");
    // Saved history and Perplexity thread links are uploads; they wait like the records do.
    if (
      body !== undefined &&
      (path === "/v1/me/history" || path === "/v1/me/thread-relations") &&
      (await this.holdsSharing(c.origin, storedFeatures(c.features)))
    )
      throw new Error("sync_delayed");
    return this.call(c.origin, path, withCompanyKeys(body, c), c.access_token, {
      scope,
      device: c.device_id,
      epoch: c.policy.deletion_epoch,
    });
  }
  /** Selection is bound to this enrolled installation; the body cannot choose a tenant or employee. */
  async estimationSelection(
    scope: Scope,
    selection?: OrganizationSelectionRequest,
  ): Promise<OrganizationSelectionResponse> {
    const body =
      selection === undefined
        ? undefined
        : OrganizationSelectionRequestSchema.parse(selection);
    let credentials = await this.credentials();
    if (
      !credentials ||
      scope.mode !== "company" ||
      credentials.namespace !== scope.namespace ||
      credentials.enrollment_era.id !== scope.era
    )
      throw new Error("policy_unavailable");
    const device = credentials.device_id;
    const epoch = credentials.policy.deletion_epoch;
    if (Date.parse(credentials.access_expires_at) < Date.now() + 30000)
      credentials = await this.refresh();
    const response = await this.call(
      credentials.origin,
      "/v1/me/estimation-selection",
      body,
      credentials.access_token,
      { scope, device, epoch },
      { bytes: 32768 },
      body === undefined ? "GET" : "PUT",
    );
    const current = await this.credentials();
    if (
      !current ||
      current.device_id !== device ||
      current.namespace !== scope.namespace ||
      current.enrollment_era.id !== scope.era ||
      current.policy.deletion_epoch !== epoch ||
      (current.enrollment_state && current.enrollment_state !== "active")
    )
      throw new Error("policy_unavailable");
    return OrganizationSelectionResponseSchema.parse(response);
  }
  async methodRequest(scope: Scope, path: string, signal?: AbortSignal) {
    if (
      path !== "/v1/me/method-updates" &&
      !/^\/v1\/me\/method-updates\/[a-z0-9][a-z0-9.-]{0,127}$/.test(path)
    )
      throw new Error("payload_rejected");
    let c = await this.credentials();
    if (
      !c ||
      scope.mode !== "company" ||
      c.namespace !== scope.namespace ||
      c.enrollment_era.id !== scope.era ||
      !c.method_public_key
    )
      throw new Error("policy_unavailable");
    const pinned = c.method_public_key;
    if (Date.parse(c.access_expires_at) < Date.now() + 30000)
      c = await this.refresh();
    if (
      c.namespace !== scope.namespace ||
      c.enrollment_era.id !== scope.era ||
      c.method_public_key !== pinned
    )
      throw new Error("policy_unavailable");
    return this.call(
      c.origin,
      path,
      undefined,
      c.access_token,
      { scope, device: c.device_id, epoch: c.policy.deletion_epoch },
      {
        bytes: path.endsWith("method-updates") ? 65536 : 2 * 1024 * 1024,
        signal,
      },
    );
  }
  async linkThread(
    scope: Scope,
    threadKey: string,
    keys: string[],
    epoch: number,
  ) {
    if (
      !/^[a-f0-9]{64}$/.test(threadKey) ||
      keys.length < 1 ||
      keys.length > 100 ||
      keys.some((key) => !/^[a-f0-9]{64}$/.test(key)) ||
      new Set(keys).size !== keys.length ||
      !Number.isSafeInteger(epoch) ||
      epoch < 0
    )
      throw new Error("payload_rejected");
    const result = await this.threadRequest(scope, "/v1/me/thread-relations", {
      site: "perplexity",
      key_version: "1",
      thread_key: threadKey,
      provider_request_keys: keys,
      deletion_epoch: epoch,
      source: "perplexity-thread-response-v1",
    });
    if (
      Object.keys(result ?? {})
        .sort()
        .join(",") !== "deletion_epoch,key_version,results,site,thread_key" ||
      result.site !== "perplexity" ||
      result.key_version !== "1" ||
      result.thread_key !== threadKey ||
      result.deletion_epoch !== epoch ||
      !Array.isArray(result.results) ||
      result.results.length !== keys.length ||
      !result.results.every(
        (r: any, i: number) =>
          Object.keys(r ?? {})
            .sort()
            .join(",") === "provider_request_key,status" &&
          r.provider_request_key === keys[i] &&
          ["linked", "not_recorded"].includes(r.status),
      )
    )
      throw new Error("payload_rejected");
    return result.results as {
      provider_request_key: string;
      status: "linked" | "not_recorded";
    }[];
  }
  private async syncThreadRelations(c: Credentials) {
    const scope: Scope = {
      namespace: c.namespace,
      mode: "company",
      era: c.enrollment_era.id,
    };
    const rows = await this.repository.pendingThreadLinks(c.namespace);
    if (!rows.length) return;
    const threadKey = rows[0]!.threadKey,
      keys = rows
        .filter((r) => r.threadKey === threadKey)
        .map((r) => r.providerRequestKey);
    const before = await this.repository.publicationSnapshot(c.namespace);
    if (before.erasing) return;
    try {
      const result = await this.linkThread(
        scope,
        threadKey,
        keys,
        c.policy.deletion_epoch,
      );
      await this.repository.acknowledgeThreadLinks(
        c.namespace,
        threadKey,
        result,
        before.erasureVersion,
      );
    } catch (error) {
      if ((error as any).code === "thread_relation_conflict")
        await this.repository.rejectThreadLinks(scope, threadKey, keys, {
          erasureVersion: before.erasureVersion,
          deviceId: c.device_id,
        });
      throw error;
    }
  }
  async resolvePendingPolicy(): Promise<void> {
    if (this.policyFlight) return this.policyFlight;
    this.policyFlight = (async () => {
      const pending = await this.repository.readPendingPolicy();
      if (!pending) return;
      const current = await this.credentials();
      if (!current || current.device_id !== pending.device_id) {
        await this.repository.applySessionChanges({ pendingPolicy: null });
        return;
      }
      const receipt = await this.authorized("/v1/config/acknowledge", {
        policy_version: pending.policy.policy_version,
      });
      if (
        receipt.policy_version !== pending.policy.policy_version ||
        receipt.enrollment_era_id !== current.enrollment_era.id ||
        !Number.isFinite(Date.parse(receipt.acknowledged_at))
      )
        throw new Error("policy_unavailable");
      const latest = await this.credentials();
      if (
        !latest ||
        latest.device_id !== current.device_id ||
        latest.enrollment_era.id !== current.enrollment_era.id
      )
        return;
      const history = (await this.repository.readOwnershipHistory())!;
      const next = transitionOwnership(
        history,
        {
          scope: {
            namespace: latest.namespace,
            mode: "company",
            era: latest.enrollment_era.id,
          },
          secret: latest.user_hmac_key,
          policyVersion: pending.policy.policy_version,
        },
        Date.parse(receipt.acknowledged_at),
      );
      await this.repository.applySessionChanges(
        {
          credentials: { ...latest, policy: pending.policy },
          ownershipHistory: next,
          pendingPolicy: null,
        },
        { deviceId: latest.device_id, refreshToken: latest.refresh_token },
      );
    })().finally(() => {
      this.policyFlight = null;
    });
    return this.policyFlight;
  }
  /** Checks the policy and returns the server's operator switches from the same answer. */
  private async refreshPolicy(c: Credentials): Promise<OrganizationFeatures> {
    await this.resolvePendingPolicy();
    const config = await this.authorized("/v1/config");
    const policy = config.policy ?? config;
    if (
      typeof policy.policy_version !== "string" ||
      !["user_controlled", "disabled_by_company"].includes(policy.pause_mode)
    )
      throw new Error("policy_unavailable");
    // The switches sit outside the policy, so they can change while its version stays.
    const features = organizationFeatures(config);
    await this.keepFeatures(c.device_id, features);
    if (policy.policy_version === c.policy.policy_version) return features;
    await this.repository.applySessionChanges({
      pendingPolicy: {
        device_id: c.device_id,
        offered_at: Date.now(),
        policy,
      },
    });
    await this.resolvePendingPolicy();
    return features;
  }
  sync(): Promise<void> {
    if (this.syncFlight) return this.syncFlight;
    this.syncFlight = this.syncOnce().finally(() => {
      this.syncFlight = null;
    });
    return this.syncFlight;
  }
  async maintenance(): Promise<void> {
    if (await this.credentials()) {
      await this.sync();
      if (this.trackingAllowed && !(await this.trackingAllowed())) return;
      const c = await this.credentials();
      if (c && (await this.holdsSharing(c.origin, storedFeatures(c.features))))
        return;
      await this.historyMaintenance?.();
      await this.methodMaintenance?.().catch(() => {});
      await this.estimationMaintenance?.();
      return;
    }
    const pending = await this.pending();
    if (pending) {
      // Only an exchange the person already confirmed is finished here; a code or a confirmation
      // still waits for them.
      if (pending.state === "verified" && pending.exchange_started)
        await this.confirm();
      return;
    }
    const saved = (await this.repository.listSessionMaintenance()).sort(
      (a, b) =>
        Number(b.kind === "reconnect" && b.session.disconnect_pending) -
        Number(a.kind === "reconnect" && a.session.disconnect_pending),
    );
    const seen = new Set<string>();
    for (const item of saved) {
      if (item.kind === "active") continue;
      const entry = item.kind === "reconnect" ? item.session : item.receipt;
      if (seen.has(entry.device_id) || !(await this.hasConsent(entry.origin)))
        continue;
      seen.add(entry.device_id);
      if (item.kind === "reconnect" && item.session.disconnect_pending) {
        try {
          await this.finishDisconnect(item.session);
        } catch {
          await this.repository.health(
            entry.namespace,
            "auth_reconnect_required",
          );
        }
      }
      try {
        if (await this.applyDeletions(entry))
          await solveHealth(
            this.repository,
            entry.namespace,
            "deletions_applied",
          );
      } catch {
        await this.repository.health(entry.namespace, "deletion_in_progress");
      }
    }
  }
  private async syncOnce(): Promise<void> {
    let c = await this.credentials();
    if (!c) return;
    try {
      if (!(await this.applyDeletions(c))) {
        await this.repository.health(c.namespace, "deletion_in_progress");
        return;
      }
    } catch {
      await this.repository.health(c.namespace, "deletion_in_progress");
      return;
    }
    await solveHealth(this.repository, c.namespace, "deletions_applied");
    // An erasure the person asked for still reaches the server; nothing else is sent before
    // the person agreed to tracking or after they withdrew.
    if (this.trackingAllowed && !(await this.trackingAllowed())) return;
    c = await this.credentials();
    if (!c) return;
    if (c.enrollment_state && c.enrollment_state !== "active") return;
    if (Date.now() < this.pausedUntil) return;
    let features: OrganizationFeatures;
    try {
      features = await this.refreshPolicy(c);
    } catch (error) {
      await this.refused(c, error, "policy_unavailable");
      return;
    }
    await solveHealth(this.repository, c.namespace, "policy_checked");
    // A switch the person has not agreed to holds everything after the policy check: no health
    // report and no record leaves this browser until they agree in Settings.
    if (await this.holdsSharing(c.origin, features)) return;
    // Saved health rows are kept (lib/health.ts), so a row last seen long ago is history,
    // not this browser's state. Reporting every row made one capture gap read as "Capture
    // failed, just now" on the admin Health page at every sync, for good (14 Oct 2026).
    // A row solved since it was last seen is not current either.
    const reportedSince = Date.now() - HEALTH_REPORT_WINDOW_MS;
    const health = (await this.repository.listHealth(c.namespace, 1000)).filter(
      (item) => (item.lastAt ?? item.at) >= reportedSince && !healthSolved(item),
    );
    const categories: Array<[string, string[]]> = [
      ["storage_failed", ["storage_write_failed", "ledger_integrity_failed"]],
      [
        "capture_failed",
        [
          "capture_hook_missing",
          "protocol_unsupported",
          "buffer_overflow",
          "malformed_frame",
          "partial_capture",
          "capture_body_missing",
        ],
      ],
      ["tokenizer_failed", ["tokenizer_unavailable", "tokenizer_timeout"]],
      [
        "calculation_failed",
        ["estimate_unavailable", "aggregate_inconsistent"],
      ],
      [
        "sync_failed",
        ["sync_delayed", "payload_rejected", "revision_conflict"],
      ],
    ];
    const category = categories.find(([, codes]) =>
      health.some((item) => codes.includes(item.code)),
    );
    try {
      await this.authorized("/v1/health/reports", {
        code: category?.[0] ?? "healthy",
        site: null,
        count: category
          ? health.filter((item) => category[1].includes(item.code)).length
          : 0,
        client_version: "0.1.0",
      });
    } catch (error) {
      await this.refused(c, error, "sync_delayed");
      return;
    }
    // The server took a signed-in request, so the connection works again.
    await solveHealth(this.repository, c.namespace, "connected");
    const rows = await this.repository.queue(c.namespace);
    if (!rows.length) {
      try {
        await this.syncThreadRelations(c);
      } catch {
        await this.repository.health(c.namespace, "sync_delayed");
        return;
      }
      await solveHealth(this.repository, c.namespace, "synced");
      return;
    }
    const records = [];
    const sent: OutboxRow[] = [];
    // Company keys travel beside the records, once per record, and only to a server that
    // handed out the company key (W11).
    const keys: CompanyKeyEntry[] = [];
    const named = new Set<string>();
    for (const row of rows) {
      const r = await this.repository.queuedRecord(row);
      const id = r.kind === "request" ? r.request_id : r.attempt_id;
      const entry: CompanyKeyEntry | null =
        c.company_dedup_key && row.companyKey && !named.has(`${r.kind}:${id}`)
          ? { kind: r.kind, record_id: id, company_dedup_key: row.companyKey }
          : null;
      if (
        new TextEncoder().encode(
          JSON.stringify([...records, r, ...keys, ...(entry ? [entry] : [])]),
        ).length > 500000
      )
        break;
      records.push(r);
      sent.push(row);
      if (entry) {
        keys.push(entry);
        named.add(`${r.kind}:${id}`);
      }
    }
    if (!sent.length) {
      await this.repository.health(c.namespace, "payload_rejected");
      return;
    }
    const batch = parseUsageBatch({
      schema_version: SCHEMA_VERSION,
      batch_id: crypto.randomUUID(),
      sent_at: new Date().toISOString(),
      client_version: "0.1.0",
      deletion_epoch: c.policy.deletion_epoch ?? 0,
      records,
      ...(keys.length ? { company_dedup_keys: keys } : {}),
    });
    let refusedNow = false;
    try {
      const pinned = {
        scope: {
          namespace: c.namespace,
          mode: "company" as const,
          era: c.enrollment_era.id,
        },
        device: c.device_id,
        epoch: c.policy.deletion_epoch,
      };
      const result = await this.authorized("/v1/usage/batches", batch, pinned);
      if (result.batch_id !== batch.batch_id || !Array.isArray(result.results))
        throw new Error("payload_rejected");
      const acks: Ack[] = result.results.map((r: any) => ({
        kind: r.kind,
        id: r.id ?? r.record_id,
        revision: r.revision,
        payload_hash: r.payload_hash,
        server_record_version: r.server_record_version,
        status: r.status,
        reason: r.reason ?? r.reason_code ?? r.error_code,
        canonical_id: r.canonical_id,
      }));
      refusedNow = acks.some((ack) => ack.status === "rejected");
      await this.repository.acknowledge(
        c.namespace,
        batch.batch_id,
        acks,
        sent,
      );
      const erasures = new Map<string, boolean>();
      for (const ack of acks) {
        const row = sent.find(
          (r) =>
            r.kind === ack.kind &&
            r.id === ack.id &&
            r.revision === ack.revision &&
            r.hash === ack.payload_hash,
        );
        if (!row) continue;
        if (ack.status === "stale" || ack.status === "aliased") {
          const canonical = await this.authorized(
            `/v1/usage/records/${ack.kind}/${ack.canonical_id ?? ack.id}`,
            undefined,
            pinned,
          );
          const estimate =
            canonical.record?.kind === "attempt" && !this.canonicalEstimation
              ? estimateAttempt(canonical.record)
              : undefined;
          await this.repository.reconcile(
            c.namespace,
            canonical.record,
            canonical.payload_hash,
            ack.status === "aliased" ? ack.id : undefined,
            ack.revision,
            estimate,
          );
          if (canonical.record?.kind === "attempt")
            await this.canonicalEstimation?.(pinned.scope, canonical.record);
        }
        if (ack.status === "erased" || ack.status === "retention_expired") {
          const record = await this.repository.queuedRecord(row);
          erasures.set(
            record.request_id,
            (erasures.get(record.request_id) ?? true) &&
              ack.status === "retention_expired",
          );
        }
      }
      // Resolve every receipt before a family purge removes the other queued revisions.
      for (const [requestId, retention] of erasures)
        await this.repository.eraseFamily(
          c.namespace,
          requestId,
          true,
          retention,
        );
      const acknowledged = new Set(
        acks
          .filter((a) =>
            sent.some(
              (r) =>
                r.kind === a.kind &&
                r.id === a.id &&
                r.revision === a.revision &&
                (r.hash === a.payload_hash || a.status === "rejected") &&
                (!["applied", "duplicate", "stored_pending_estimate"].includes(
                  a.status,
                ) ||
                  a.server_record_version === r.revision),
            ),
          )
          .map((r) => `${r.kind}:${r.id}:${r.revision}`),
      );
      await this.repository.retry(
        sent.filter(
          (r) => !acknowledged.has(`${r.kind}:${r.id}:${r.revision}`),
        ),
      );
      await this.syncThreadRelations(c);
    } catch (error) {
      await this.repository.retry(sent, (error as any).retryAfter ?? 0);
      await this.refused(c, error, "sync_delayed");
      return;
    }
    // The server answered the upload. Records it refused in this upload are reported as their
    // own problems and stay open.
    await solveHealth(
      this.repository,
      c.namespace,
      "synced",
      refusedNow ? ["payload_rejected"] : [],
    );
  }
  /**
   * What a refused sync step does to the connection. A browser that lost access, or whose tokens
   * the server no longer accepts, holds its enrollment and returns to personal mode. A paused
   * organization keeps the enrollment and its queued records, and sync waits before asking again.
   * Any other failure, including a 403 that does not end access, is recorded and retried.
   */
  private async refused(
    c: Credentials,
    error: unknown,
    otherwise: "policy_unavailable" | "sync_delayed",
  ) {
    if (isAccessEnded(error)) await this.holdEnrollment(c, "revoked");
    else if ((error as any)?.status === 401)
      await this.holdEnrollment(c, "reconnect_needed");
    else if (isSharingPaused(error)) {
      this.paused = true;
      this.pausedUntil =
        Date.now() +
        Math.max(SHARING_PAUSE_RETRY_MS, (error as FailedAnswer).retryAfter ?? 0);
      await this.repository.health(c.namespace, "sync_delayed");
    } else await this.repository.health(c.namespace, otherwise);
  }
  private async holdEnrollment(
    c: Credentials,
    state: "revoked" | "reconnect_needed",
  ) {
    const current = await this.credentials();
    if (!current || current.device_id !== c.device_id) return;
    const history = await this.repository.readOwnershipHistory();
    const personal = await this.repository.readPersonal();
    const updates: SessionChanges = {
      credentials: { ...current, enrollment_state: state },
    };
    if (history && personal)
      updates.ownershipHistory = transitionOwnership(history, {
        scope: { namespace: personal.namespace, mode: "personal", era: null },
        secret: personal.secret,
        policyVersion: "1.0.0",
      });
    await this.repository.applySessionChanges(updates, {
      deviceId: current.device_id,
      refreshToken: current.refresh_token,
    });
    await this.repository.health(
      c.namespace,
      state === "revoked" ? "enrollment_revoked" : "auth_reconnect_required",
    );
  }
  async applyDeletions(c: StoredDeletionReceipt): Promise<boolean> {
    for (let page = 0; page < 10; page++)
      if (await this.applyDeletionPage(c)) return true;
    return false;
  }
  private async applyDeletionPage(c: StoredDeletionReceipt): Promise<boolean> {
    const decode = (value: string) =>
      Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
        c.charCodeAt(0),
      );
    const last = await this.repository.readDeletionEpoch(c.device_id);
    const result = await this.call(c.origin, "/v1/deletions/status", {
      device_id: c.device_id,
      credential: c.deletion_receipt_credential,
      last_epoch: last?.epoch ?? 0,
    });
    const instruction = result.instruction;
    if (
      result.algorithm !== "Ed25519" ||
      result.key_version !== "1" ||
      instruction?.company_id !== c.company_id ||
      instruction?.device_id !== c.device_id ||
      !Number.isSafeInteger(instruction.deletion_epoch) ||
      instruction.deletion_epoch < (last?.epoch ?? 0) ||
      !Array.isArray(instruction.changes) ||
      instruction.changes.length > 100 ||
      typeof instruction.has_more !== "boolean" ||
      !Number.isSafeInteger(instruction.current_deletion_epoch) ||
      instruction.current_deletion_epoch < instruction.deletion_epoch ||
      (instruction.has_more && instruction.deletion_epoch <= (last?.epoch ?? 0))
    )
      throw new Error("payload_rejected");
    const publicKey = await crypto.subtle.importKey(
      "raw",
      decode(c.deletion_public_key),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    if (
      !(await crypto.subtle.verify(
        "Ed25519",
        publicKey,
        decode(result.signature),
        new TextEncoder().encode(canonicalJson(instruction)),
      ))
    )
      throw new Error("payload_rejected");
    if (
      !Number.isFinite(Date.parse(instruction.issued_at)) ||
      Math.abs(Date.now() - Date.parse(instruction.issued_at)) > 300000
    )
      throw new Error("clock_skew");
    const scope: Scope = {
      namespace: c.namespace,
      mode: "company",
      era: c.enrollment_era.id,
    };
    let fullyErased = false;
    for (const change of instruction.changes) {
      if (change.user_id !== null && change.user_id !== c.user_id)
        throw new Error("payload_rejected");
      // Only deleting the person ends the connection: the server then deletes the member and
      // revokes every browser, and a full namespace erase blocks the namespace for good. Erasing
      // the whole organization's usage keeps members and browsers active and is the range the
      // preview froze (CONTRACTS section 9), so it erases like a range and the browser stays
      // connected. Treating it as a full erase silently dropped the credentials (18 Oct 2026).
      // A company change without that range, which no current server sends, still erases all.
      const bounded =
        typeof change.start === "string" &&
        typeof change.end === "string" &&
        change.start < change.end;
      if (
        change.scope === "user" ||
        (change.scope === "company" && !bounded)
      ) {
        await this.repository.eraseNamespace(c.namespace);
        fullyErased = true;
      } else if (
        (change.scope === "range" || change.scope === "company") &&
        bounded
      )
        await this.repository.applyRange(
          scope,
          change.start,
          change.end,
          change.epoch,
          change.retention === true,
        );
      else throw new Error("payload_rejected");
    }
    if (instruction.retention_cutoff !== null) {
      if (
        typeof instruction.retention_cutoff !== "string" ||
        !Number.isFinite(Date.parse(instruction.retention_cutoff))
      )
        throw new Error("payload_rejected");
      await this.repository.applyRange(
        scope,
        null,
        instruction.retention_cutoff,
        instruction.deletion_epoch,
        true,
      );
    }
    const changes: SessionChanges = {
      deletionEpochs: [
        { deviceId: c.device_id, value: { epoch: instruction.deletion_epoch } },
      ],
      deletionReceipts: [
        {
          deviceId: c.device_id,
          value: {
            origin: c.origin,
            company_id: c.company_id,
            user_id: c.user_id,
            device_id: c.device_id,
            deletion_receipt_credential: c.deletion_receipt_credential,
            deletion_public_key: c.deletion_public_key,
            namespace: c.namespace,
            enrollment_era: c.enrollment_era,
          },
        },
      ],
    };
    if (fullyErased) {
      const history = await this.repository.readOwnershipHistory();
      const personal = await this.repository.readPersonal();
      if (
        history &&
        personal &&
        history.eras.at(-1)?.scope.namespace === c.namespace
      )
        changes.ownershipHistory = transitionOwnership(history, {
          scope: {
            namespace: personal.namespace,
            mode: "personal",
            era: null,
          },
          secret: personal.secret,
          policyVersion: "1.0.0",
        });
    }
    await this.repository.applySessionChanges(changes);
    await this.call(c.origin, "/v1/deletions/ack", {
      device_id: c.device_id,
      credential: c.deletion_receipt_credential,
      last_epoch: instruction.deletion_epoch,
      purged: true,
    });
    const active = await this.credentials();
    if (active?.device_id === c.device_id)
      await this.repository.applySessionChanges(
        {
          credentials: {
            ...active,
            policy: {
              ...active.policy,
              deletion_epoch: instruction.deletion_epoch,
            },
          },
        },
        { deviceId: active.device_id, refreshToken: active.refresh_token },
      );
    return !instruction.has_more;
  }
}
