import type { ComponentResult, EstimationEnvelope } from "@footprint/contracts";

/**
 * The smaller EcoLogits text record each provider's replies are compared with in Details. Chosen on
 * 12 October 2026 in docs/methodology/EVERYDAY-COMPARISONS-2026-10-12.md; Claude moved from Haiku 4.5
 * to Haiku 5.5 with EcoLogits 0.11.3 (22 October 2026). Perplexity has no record of its own, so its
 * replies follow the provider of their stand-in record.
 */
export const SMALLER_RECORDS: Readonly<Record<string, string>> = {
  openai: "gpt-6-luna",
  anthropic: "claude-haiku-5-5",
  google_genai: "gemini-3.5-flash-lite",
};
export const SMALLER_NAMES: Readonly<Record<string, string>> = {
  "gpt-6-luna": "GPT-6 Luna",
  "claude-haiku-5-5": "Claude Haiku 5.5",
  "gemini-3.5-flash-lite": "Gemini 3.5 Flash-Lite",
};

/**
 * Owner, 13 October 2026: a reply already written by the smallest family of its provider is not
 * compared, whatever its version, because comparing Claude Haiku 6 with Haiku 5.5, for example,
 * would suggest a saving the person cannot make. The observed model is checked as well as the
 * record: an unknown version carries its family in its unlisted id (`claude-haiku-unlisted`,
 * `chatgpt-gpt-luna-unlisted`, `gemini-flash-lite-unlisted`), and a stand-in record or a
 * Perplexity reply's record can belong to another family or provider.
 */
const SMALLEST_FAMILY = /\b(luna|haiku|flash)\b/;
const smallestFamily = (...names: (string | null | undefined)[]) =>
  names.some((name) => !!name && SMALLEST_FAMILY.test(name.toLowerCase()));

/** How this chat's electricity would change, in Wh per scenario, if a smaller model wrote the same output tokens. */
export type SmallerModel = {
  minimum: number;
  midpoint: number;
  maximum: number;
  /** The smaller records used, by record name. */
  records: string[];
  /** Replies compared. */
  replies: number;
  /** Replies with a figure that could not be compared, so they keep their own figure. */
  unchanged: number;
};

type Profile = { provider: string; model_name: string };
export type AlternativeText = (component: ComponentResult, profile: Profile) => Promise<ComponentResult>;

function endpoints(component: ComponentResult) {
  const energy = component.metrics.energy;
  if (component.status !== "estimated" || energy.value === null) return null;
  const values = {
    minimum: Number(energy.scenario_low ?? energy.value),
    midpoint: Number(energy.value),
    maximum: Number(energy.scenario_high ?? energy.value),
  };
  return Object.values(values).every(Number.isFinite) ? values : null;
}

/**
 * Compares each reply's main text with the smaller record of its provider. Whether the record is
 * smaller is decided on `alternative` figures for both models, with the same output tokens and
 * modelled latency, so that choice depends on the model alone. The change itself replaces the
 * reply's counted figure, which Details already shows, with the smaller record's figure. Subtracting
 * the modelled difference instead could exceed the counted figure when the measured latency was
 * shorter than the modelled one, and the card then showed zero. Side calls, images and other parts
 * keep their figures. A reply already written by a model at least as small does not change.
 * Returns null when nothing could be compared or nothing would shrink.
 */
export async function smallerModelChange(
  envelopes: Iterable<EstimationEnvelope>,
  alternative: AlternativeText,
): Promise<SmallerModel | null> {
  const change = { minimum: 0, midpoint: 0, maximum: 0 };
  const records = new Set<string>();
  let replies = 0,
    unchanged = 0;
  for (const envelope of envelopes)
    for (const component of envelope.components) {
      if (component.kind !== "text" || component.role !== "main" || component.status !== "estimated") continue;
      const profile = component.selection?.profile;
      const target = profile ? SMALLER_RECORDS[profile.provider] : undefined;
      if (!profile || profile.workload !== "text" || !target) {
        unchanged++;
        continue;
      }
      if (profile.model_name === target || smallestFamily(component.selection?.observed_model_id, profile.model_name)) {
        replies++;
        continue;
      }
      const [actual, smaller] = await Promise.all([
        alternative(component, { provider: profile.provider, model_name: profile.model_name }),
        alternative(component, { provider: profile.provider, model_name: target }),
      ]);
      const a = endpoints(actual),
        s = endpoints(smaller),
        counted = endpoints(component);
      if (!a || !s || !counted) {
        unchanged++;
        continue;
      }
      replies++;
      if (s.midpoint >= a.midpoint) continue;
      records.add(target);
      // EcoLogits gives kWh; Details shows Wh. A scenario where the smaller record's modelled figure
      // is above a very fast reply's counted one keeps the counted figure rather than growing.
      for (const key of ["minimum", "midpoint", "maximum"] as const) change[key] += Math.min(0, s[key] - counted[key]) * 1000;
    }
  if (!replies || !records.size || !(change.midpoint < 0)) return null;
  return { ...change, records: [...records].sort(), replies, unchanged };
}

/** Accepts a smaller-model change from a background reply only when every field is well formed. */
export function readSmallerModel(value: unknown): SmallerModel | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const finite = (x: unknown) => typeof x === "number" && Number.isFinite(x) && x <= 0;
  if (!finite(v.minimum) || !finite(v.midpoint) || !finite(v.maximum)) return null;
  if (!Number.isSafeInteger(v.replies) || (v.replies as number) < 1 || !Number.isSafeInteger(v.unchanged) || (v.unchanged as number) < 0) return null;
  if (!Array.isArray(v.records) || !v.records.length || !v.records.every((r) => typeof r === "string" && Object.hasOwn(SMALLER_NAMES, r))) return null;
  return {
    minimum: v.minimum as number,
    midpoint: v.midpoint as number,
    maximum: v.maximum as number,
    records: [...(v.records as string[])],
    replies: v.replies as number,
    unchanged: v.unchanged as number,
  };
}
