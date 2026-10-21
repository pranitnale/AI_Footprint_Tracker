export interface GuidanceState {
  lastNotice: number;
  armed: boolean;
  dismissed: boolean;
  level: 0 | 50 | 80;
  snoozedUntil?: number;
}
export function contextGuidance(
  tokens: string | null,
  budget: number | null,
  previous: GuidanceState | undefined,
  now = Date.now(),
): { state: GuidanceState; ratio: number | null; show: boolean } {
  const state: GuidanceState = {
    lastNotice: 0,
    armed: true,
    dismissed: false,
    level: 0,
    ...previous,
  };
  if (tokens === null || !Number.isInteger(budget) || budget! < 1)
    return { state, ratio: null, show: false };
  const ratio = Number(tokens) / budget!;
  if (!Number.isFinite(ratio)) return { state, ratio: null, show: false };
  if (ratio <= 0.45) {
    state.armed = true;
    state.level = 0;
  }
  const level = ratio > 0.8 ? 80 : ratio > 0.5 ? 50 : 0;
  if (
    level &&
    state.armed &&
    (state.lastNotice === 0 || now - state.lastNotice >= 86400000)
  ) {
    state.lastNotice = now;
    state.armed = false;
    state.dismissed = false;
    state.level = level;
  } else if (level === 80 && state.level === 50 && !state.dismissed)
    state.level = 80;
  return {
    state,
    ratio,
    show:
      state.level > 0 &&
      !state.dismissed &&
      ratio > 0.5 &&
      now >= (state.snoozedUntil ?? 0),
  };
}
export interface ContextBudget {
  tokens: number;
  kind:
    | "verified_application_capacity"
    | "user_advisory"
    | "published_reference_advisory";
  version: string;
  source: string | null;
  referenceTokens: number | null;
  basis: string;
}
const claudeReference: Readonly<Record<string, number>> = Object.freeze({
  "claude-fable-5-1": 1000000,
  "claude-opus-5": 1000000,
  "claude-sonnet-5": 1000000,
  "claude-opus-4-8": 500000,
  "claude-opus-4-7": 500000,
  "claude-opus-4-6": 500000,
  "claude-sonnet-4-6": 500000,
});
export function selectContextBudget(
  model: string | null,
  userBudget: number | null,
  verified?: ContextBudget | null,
): ContextBudget | null {
  if (
    verified?.kind === "verified_application_capacity" &&
    Number.isInteger(verified.tokens) &&
    verified.tokens > 0
  )
    return verified;
  if (userBudget !== null)
    return {
      tokens: userBudget,
      kind: "user_advisory",
      version: "user-advisory-v1",
      source: null,
      referenceTokens: null,
      basis: "Your advisory budget. The actual app limit is unverified.",
    };
  const reference = model ? claudeReference[model] : undefined;
  if (!reference) return null;
  return {
    tokens: reference / 2,
    kind: "published_reference_advisory",
    version: "claude-paid-reference-2026-09-09-v1",
    source:
      "https://support.claude.com/en/articles/8606394-how-large-is-the-context-window-on-paid-claude-plans",
    referenceTokens: reference,
    basis:
      "Conservative guidance using half the published paid Claude.ai full window. The 50% allowance is a planning choice, not a measured response reserve or proven bound. Account-specific limits, hidden context and compaction remain unverified.",
  };
}
