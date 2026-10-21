/** Numeric duration evidence only. No provider timestamp or conversation text is retained. */
export interface TimingEvidence {
  duration_seconds: string;
  source:
    | "browser_request"
    | "chatgpt_history"
    | "claude_history"
    | "perplexity_history"
    | "gemini_history"
    | "cowork_history"
    | "notebooklm_history";
  scope:
    | "request"
    | "provider_message"
    | "content_blocks"
    | "workflow"
    | "research_task";
  completeness: "complete_for_scope" | "partial" | "unknown";
  profile_version: "timing-observation-1";
}

const scopes = {
  browser_request: "request",
  chatgpt_history: "provider_message",
  claude_history: "content_blocks",
  perplexity_history: "workflow",
  // Gemini history keeps no reply times; only a research run's span is stored (G4).
  gemini_history: "research_task",
  // A Cowork turn's time is the difference of the session's reported API time (W5).
  cowork_history: "provider_message",
  // A Studio item stores when it was created and when it finished (W9).
  notebooklm_history: "provider_message",
} as const;
// A research run reports its own task span, which covers more than the saved blocks (C1).
const researchSources: ReadonlySet<string> = new Set([
  "chatgpt_history",
  "claude_history",
]);

export function isTimingEvidence(value: unknown): value is TimingEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as TimingEvidence;
  return (
    Object.keys(v).sort().join(",") ===
      "completeness,duration_seconds,profile_version,scope,source" &&
    typeof v.duration_seconds === "string" &&
    /^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/.test(v.duration_seconds) &&
    Number(v.duration_seconds) > 0 &&
    Number(v.duration_seconds) <= 86400 &&
    Object.hasOwn(scopes, v.source) &&
    (scopes[v.source] === v.scope ||
      (v.scope === "research_task" && researchSources.has(v.source))) &&
    ["complete_for_scope", "partial", "unknown"].includes(v.completeness) &&
    v.profile_version === "timing-observation-1"
  );
}

export function timingEvidence(
  seconds: number,
  source: TimingEvidence["source"],
  completeness: TimingEvidence["completeness"] = "complete_for_scope",
  scope: TimingEvidence["scope"] = scopes[source],
): TimingEvidence | null {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 86400) return null;
  const value: TimingEvidence = {
    duration_seconds: seconds.toFixed(9).replace(/\.?0+$/, ""),
    source,
    scope,
    completeness,
    profile_version: "timing-observation-1",
  };
  return isTimingEvidence(value) ? value : null;
}

/** Call observe with receipt times, before decoding or asynchronous downstream work. */
export class LiveRequestTimer {
  private terminal: number | null = null;
  constructor(private readonly dispatched: number) {}
  observe(verifiedComplete: boolean, received: number): void {
    if (!verifiedComplete) this.terminal = null;
    else if (this.terminal === null && Number.isFinite(received))
      this.terminal = received;
  }
  evidence(): TimingEvidence | null {
    return this.terminal === null
      ? null
      : timingEvidence(
          (this.terminal - this.dispatched) / 1000,
          "browser_request",
        );
  }
}
