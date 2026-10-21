/**
 * "direct": the tracker's own wrappers are in place. "monitored": another script wraps fetch
 * after the tracker, and every finished chat request the browser recorded also passed the
 * tracker. "missed": one did not. "unverified": neither can be shown.
 */
export type CaptureInterception = "direct" | "monitored" | "unverified" | "missed";
export interface CaptureReady {
  channel: "ai-footprint-ready-v1";
  nonce: string;
  interception: CaptureInterception;
}
export function validateCaptureReady(
  value: unknown,
  nonce: string,
): value is CaptureReady {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const message = value as Partial<CaptureReady>;
  return (
    Object.keys(message).sort().join(",") === "channel,interception,nonce" &&
    message.channel === "ai-footprint-ready-v1" &&
    message.nonce === nonce &&
    (message.interception === "direct" ||
      message.interception === "monitored" ||
      message.interception === "unverified" ||
      message.interception === "missed")
  );
}
export const COWORK_SENT_CHANNEL = "ai-footprint-cowork-sent-v1";
/**
 * The page sent a message in a Cowork session (W5). Cowork replies are read from the
 * session's events, so this send is what the watchdog observes instead of a dispatch.
 */
export interface CoworkSent {
  channel: typeof COWORK_SENT_CHANNEL;
  nonce: string;
  at: string;
}
export function validateCoworkSent(
  value: unknown,
  nonce: string,
  now: number,
): value is CoworkSent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const message = value as Partial<CoworkSent>;
  const at = typeof message.at === "string" ? Date.parse(message.at) : NaN;
  return (
    Object.keys(message).sort().join(",") === "at,channel,nonce" &&
    message.channel === COWORK_SENT_CHANNEL &&
    message.nonce === nonce &&
    message.at!.length === 24 &&
    Number.isFinite(at) &&
    new Date(at).toISOString() === message.at &&
    Math.abs(now - at) <= 60000
  );
}
/** Listener liveness and observed activity do not prove complete interception. */
export class CaptureWatchdog {
  private readyAt: number | null = null;
  private interception: CaptureInterception = "unverified";
  private sentAt: number | null = null;
  private capturedAt = -Infinity;
  private activityAt: number | null = null;
  private gapCode: "capture_hook_missing" | "protocol_unsupported" | null =
    null;
  private heartbeatReported = false;
  private missReported = false;
  private activityReported = false;
  private lastTickAt: number;
  private lastRenewalAt: number;
  private resumeGraceUntil: number | null = null;
  constructor(private bootAt: number) {
    this.lastTickAt = bootAt;
    this.lastRenewalAt = bootAt;
  }
  ready(now: number, interception: CaptureInterception = "direct") {
    this.readyAt = now;
    this.interception = interception;
    this.heartbeatReported = false;
    this.resumeGraceUntil = null;
  }
  sent(now: number) {
    this.sentAt = now;
    this.activityAt = null;
    this.gapCode = null;
    this.activityReported = false;
  }
  captured(now: number) {
    this.capturedAt = now;
  }
  activity(now: number) {
    if (this.sentAt !== null && now - this.sentAt < 60000)
      this.activityAt = now;
  }
  private heartbeatExpired(now: number) {
    return (
      (this.readyAt === null && now - this.bootAt >= 10000) ||
      (this.readyAt !== null && now - this.readyAt > 45000)
    );
  }
  poll(now: number, resumed = false) {
    const delayed = resumed || now - this.lastTickAt > 10000;
    this.lastTickAt = now;
    // A suspended timer gets one reply grace; repeated delays cannot keep a silent hook pending.
    if (
      delayed &&
      this.heartbeatExpired(now) &&
      this.resumeGraceUntil === null &&
      !this.heartbeatReported
    )
      this.resumeGraceUntil = now + 10000;
    const refreshStatus = delayed || now - this.lastRenewalAt >= 30000;
    if (refreshStatus) this.lastRenewalAt = now;
    return {
      probe: refreshStatus || now - this.bootAt <= 10000,
      refreshStatus,
    };
  }
  status(now: number) {
    const missing = this.heartbeatExpired(now);
    const checkingAfterResume =
      missing &&
      this.resumeGraceUntil !== null &&
      now < this.resumeGraceUntil &&
      !this.heartbeatReported;
    return {
      listener: checkingAfterResume
        ? ("starting" as const)
        : missing
          ? ("missing" as const)
          : this.readyAt === null
            ? ("starting" as const)
            : ("active" as const),
      interception: this.interception,
      lastCapturedAt: Number.isFinite(this.capturedAt) ? this.capturedAt : null,
      activityGap:
        this.sentAt !== null &&
        this.activityAt !== null &&
        this.capturedAt < this.sentAt - 1000 &&
        now - this.sentAt >= 15000,
    };
  }
  check(
    now: number,
    enabled: boolean,
  ): "capture_hook_missing" | "protocol_unsupported" | null {
    if (!enabled) {
      this.sentAt = null;
      this.activityAt = null;
      return null;
    }
    const status = this.status(now);
    if (status.activityGap && this.gapCode === null)
      this.gapCode =
        status.interception === "direct"
          ? "protocol_unsupported"
          : "capture_hook_missing";
    if (status.listener === "missing") {
      // The outage already accounts for activity missed while the listener was unavailable.
      if (status.activityGap) this.activityReported = true;
      if (!this.heartbeatReported) {
        this.heartbeatReported = true;
        return "capture_hook_missing";
      }
    } else if (status.activityGap && !this.activityReported) {
      this.activityReported = true;
      return this.gapCode;
    }
    // A chat request reached the network without passing the tracker: its reply is missing.
    if (status.interception === "missed" && !this.missReported) {
      this.missReported = true;
      return "capture_hook_missing";
    }
    return null;
  }
}

export function isPlainSendKey(
  event: Pick<
    KeyboardEvent,
    "key" | "shiftKey" | "ctrlKey" | "altKey" | "metaKey" | "isComposing"
  >,
): boolean {
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    !event.isComposing
  );
}
