import {
  HistoricalResourceV2Schema,
  HistoryMessageSchema,
  NonnegativeFiniteDecimalSchema,
  canonicalJson,
  claudeHistoryMessage,
  historyTokenParts,
  type ClaudeTokenFactor,
  type HistoricalResourceV2,
  type HistoryMessage,
  type HistorySummary,
} from "@footprint/contracts";
import { BASELINE_BUNDLE, BASELINE_METHOD_HASH } from "./bundle";
import { textEnergy } from "./methods/text";
import { environmentalAllocation } from "./methods/environment";
import { D, fixed } from "./numeric";

// Cover the complete admitted decimal span without changing legacy Decimal precision.
const HistoryDecimal = D.clone({
  precision: 1024,
  toExpNeg: -18,
  toExpPos: 20,
});

function sumEngineQuantity(left: string | null, right: string): string {
  const sum = new HistoryDecimal(left ?? "0").plus(right);
  if (!sum.isFinite() || sum.isNegative())
    throw new Error("estimate_unavailable");
  for (const value of [sum.toString(), sum.toFixed()]) {
    const parsed = NonnegativeFiniteDecimalSchema.safeParse(value);
    if (parsed.success) return parsed.data;
  }
  throw new Error("estimate_unavailable");
}

function engineResourceKey(metric: HistoricalResourceV2): string {
  const {
    value: _value,
    known_message_count: _known,
    unknown_message_count: _unknown,
    scenario_low: _low,
    scenario_high: _high,
    ...identity
  } = metric;
  return canonicalJson(identity);
}

/** Loaded answer text supports a partial output surrogate, never an execution count. */
export function estimateHistoricalText(
  input: HistoryMessage,
): HistorySummary["resources"] {
  const record = HistoryMessageSchema.parse(input);
  if (
    record.proposed_method_id !== BASELINE_BUNDLE.method_id ||
    record.proposed_method_hash !== BASELINE_METHOD_HASH
  )
    throw new Error("method_unsupported");
  if (record.role !== "response") return [];
  const b = BASELINE_BUNDLE;
  const candidates =
    record.tokens.value !== null && new D(record.tokens.value).gt(0)
      ? b.profiles.map((profile) => ({
          profile,
          energy: textEnergy(record.tokens.value!, profile, b),
        }))
      : [];
  candidates.sort(
    (a, c) =>
      c.energy.it!.cmp(a.energy.it!) ||
      a.profile.id.localeCompare(c.profile.id, "en"),
  );
  const allocated = candidates[0]
    ? environmentalAllocation(candidates[0].energy.it!, "it", b.scenario)
    : null;
  const fields = {
    energy: allocated?.facility,
    carbon: allocated?.carbon,
    water_direct: allocated?.direct,
    water_upstream: allocated?.upstream,
    water_total: allocated?.total,
  };
  return (Object.keys(fields) as Array<keyof typeof fields>).map((quantity) => {
    const value = fixed(fields[quantity] ?? null);
    return {
      quantity,
      value,
      unit:
        quantity === "energy"
          ? "kWh"
          : quantity === "carbon"
            ? b.scenario.carbon_gas === "CO2"
              ? "gCO2"
              : "gCO2e"
            : "L",
      scope: "historical_visible_response",
      method_id: b.method_id,
      method_hash: BASELINE_METHOD_HASH,
      status: value === null ? "unavailable" : "partial_estimate",
      validation_state: "unvalidated_reference",
      profile_selection: candidates.length
        ? "highest_comparable"
        : "unavailable",
      selected_profile_id: candidates[0]?.profile.id ?? null,
      reasons: [
        "history_only",
        "unvalidated_reference",
        "input_length_not_modelled",
        "hidden_reasoning_unobserved",
      ],
      missing_components: [
        ...b.missing_components,
        "provider_execution_unobserved",
      ],
      known_message_count: value === null ? "0" : "1",
      unknown_message_count: value === null ? "1" : "0",
    };
  });
}
export function emptyHistorySummary(): HistorySummary {
  return {
    schema_version: "3.0.0",
    scope: "loaded_history",
    status: "empty",
    observed_prompt_count: "0",
    observed_response_count: "0",
    prompt_count: "0",
    response_count: "0",
    dated_message_count: "0",
    undated_message_count: "0",
    calculated_message_count: "0",
    uncalculated_message_count: "0",
    matched_live_message_count: "0",
    unresolved_overlap_message_count: "0",
    conflicting_message_count: "0",
    first_request_verified: false,
    branch_scope: "unknown",
    provider_history_complete: false,
    tokens: [],
    resources: [],
    file_text: [],
    file_text_coverage: {
      observed_message_count: "0",
      unknown_message_count: "0",
      scope: "extracted_file_text",
      additive: false,
    },
  };
}
export class HistoryAccumulator {
  readonly summary = emptyHistorySummary();
  private readonly engineResources = new Map<string, HistoricalResourceV2>();
  private readonly unboundedSums = new Set<string>();
  /**
   * claudeTokenFactor: the packaged Claude token factor, which the token figures of saved
   * Claude messages carry (owner decision of 15 October 2026). Without it the counts are
   * summed as stored. Resource figures come from each message's own estimate.
   */
  constructor(
    private readonly claudeTokenFactor: ClaudeTokenFactor | null = null,
  ) {}

  private addEngineResource(input: HistoricalResourceV2) {
    const metric = HistoricalResourceV2Schema.parse(input);
    const key = engineResourceKey(metric);
    let target = this.engineResources.get(key);
    const value =
      metric.value === null
        ? null
        : sumEngineQuantity(target?.value ?? null, metric.value);
    const ranged =
      metric.value_kind === "midpoint" || metric.value_kind === "midpoint_sum";
    if (!target) {
      target = {
        ...metric,
        value: null,
        known_message_count: "0",
        unknown_message_count: "0",
        ...(ranged
          ? {
              value_kind: "midpoint_sum" as const,
              scenario_low: null,
              scenario_high: null,
              interval_kind: null,
            }
          : {}),
      };
      this.engineResources.set(key, target);
      this.summary.resources.push(target);
    }
    const count =
      value === null ? "unknown_message_count" : "known_message_count";
    target[count] = (BigInt(target[count]) + 1n).toString();
    target.value = value;
    if (ranged) {
      // Scenario sums add the same endpoint of every ranged record. One contribution without
      // endpoints (an older snapshot) leaves the group's scenario sums unavailable.
      if (
        metric.scenario_low === null ||
        metric.scenario_high === null ||
        this.unboundedSums.has(key)
      ) {
        this.unboundedSums.add(key);
        target.scenario_low = null;
        target.scenario_high = null;
      } else if (metric.value !== null) {
        target.scenario_low = sumEngineQuantity(
          target.scenario_low,
          metric.scenario_low,
        );
        target.scenario_high = sumEngineQuantity(
          target.scenario_high,
          metric.scenario_high,
        );
      }
    }
    this.summary.schema_version = "3.0.0";
  }

  add(
    record: HistoryMessage,
    options: {
      conflict?: boolean;
      overlap?: boolean;
      estimate?: HistorySummary["resources"];
      /** A regenerated Claude reply (`regeneratedHistoryReplies`): one request of its own. */
      regenerated?: boolean;
    } = {},
  ) {
    const out = this.summary;
    out.status = "available";
    const increment = (
      key:
        | "observed_prompt_count"
        | "observed_response_count"
        | "prompt_count"
        | "response_count"
        | "dated_message_count"
        | "undated_message_count"
        | "matched_live_message_count"
        | "unresolved_overlap_message_count"
        | "conflicting_message_count"
        | "calculated_message_count"
        | "uncalculated_message_count",
    ) => {
      out[key] = (BigInt(out[key]) + 1n).toString();
    };
    increment(
      record.role === "prompt"
        ? "observed_prompt_count"
        : "observed_response_count",
    );
    increment(
      record.occurred_at === null
        ? "undated_message_count"
        : "dated_message_count",
    );
    if (options.conflict) {
      increment("conflicting_message_count");
      return;
    }
    if (options.overlap) {
      increment("matched_live_message_count");
      return;
    }
    increment(record.role === "prompt" ? "prompt_count" : "response_count");
    // A regeneration no live capture matched adds its request to Req; one matched live was
    // counted by the live retry and returned above.
    if (options.regenerated && record.role === "response")
      increment("prompt_count");
    // A row no live capture can produce never waits for a live match (W9).
    if (!record.coverage_reasons.includes("no_live_request"))
      increment("unresolved_overlap_message_count");
    increment(
      record.tokens.value !== null
        ? "calculated_message_count"
        : "uncalculated_message_count",
    );
    const counted = claudeHistoryMessage(record, this.claudeTokenFactor);
    for (const [part, measurement] of historyTokenParts(counted)) {
      let token = out.tokens.find(
        (t) =>
          t.role === record.role &&
          t.part === part &&
          t.profile_id === measurement.profile_id &&
          t.evidence === measurement.evidence,
      );
      if (!token) {
        token = {
          role: record.role,
          part,
          profile_id: measurement.profile_id,
          evidence:
            measurement.evidence as HistorySummary["tokens"][number]["evidence"],
          value: null,
          known_message_count: "0",
          unknown_message_count: "0",
        };
        out.tokens.push(token);
      }
      const known = measurement.value !== null;
      const count = known ? "known_message_count" : "unknown_message_count";
      token[count] = (BigInt(token[count]) + 1n).toString();
      if (known)
        token.value = (
          BigInt(token.value ?? "0") + BigInt(measurement.value!)
        ).toString();
    }
    const fileCoverage =
      record.inline_file_text === null
        ? "unknown_message_count"
        : "observed_message_count";
    out.file_text_coverage[fileCoverage] = (
      BigInt(out.file_text_coverage[fileCoverage]) + 1n
    ).toString();
    for (const component of counted.inline_file_text ?? []) {
      const group = {
        origin: component.origin,
        extraction_profile_id: component.extraction_profile_id,
        evidence: component.tokens.evidence,
        profile_id: component.tokens.profile_id,
      };
      let target = out.file_text.find(
        (row) =>
          JSON.stringify(row.measurement_group) === JSON.stringify(group),
      );
      if (!target) {
        target = {
          quantity: "extracted_file_text",
          scope: "extracted_file_text",
          unit: "tokens",
          additive: false,
          value: null,
          measurement_group: group,
          applicable_count: 0,
          contributing_component_count: 0,
          unknown_count: 0,
          partial_count: 0,
          unvalidated_count: 0,
          reason_counts: {},
          missing_counts: {},
        };
        out.file_text.push(target);
      }
      target.applicable_count++;
      if (component.tokens.value === null) target.unknown_count++;
      else {
        target.contributing_component_count++;
        target.unvalidated_count++;
        target.value = (
          BigInt(target.value ?? "0") + BigInt(component.tokens.value)
        ).toString();
      }
      if (component.tokens.completeness === "partial") target.partial_count++;
      if (component.tokens.reason)
        target.reason_counts[component.tokens.reason] =
          (target.reason_counts[component.tokens.reason] ?? 0) + 1;
      for (const reason of component.missing)
        target.missing_counts[reason] =
          (target.missing_counts[reason] ?? 0) + 1;
    }
    for (const metric of options.estimate ?? estimateHistoricalText(record)) {
      if ("requested_method" in metric) {
        this.addEngineResource(metric);
        continue;
      }
      let target = out.resources.find(
        (r) =>
          !("requested_method" in r) &&
          r.quantity === metric.quantity &&
          r.method_id === metric.method_id &&
          r.method_hash === metric.method_hash &&
          r.unit === metric.unit &&
          r.scope === metric.scope &&
          r.profile_selection === metric.profile_selection &&
          r.selected_profile_id === metric.selected_profile_id &&
          r.status === metric.status &&
          JSON.stringify(r.reasons) === JSON.stringify(metric.reasons) &&
          JSON.stringify(r.missing_components) ===
            JSON.stringify(metric.missing_components),
      );
      if (!target) {
        target = {
          ...metric,
          value: null,
          known_message_count: "0",
          unknown_message_count: "0",
        };
        out.resources.push(target);
      }
      const count =
        metric.value === null ? "unknown_message_count" : "known_message_count";
      target[count] = (BigInt(target[count]) + 1n).toString();
      if (metric.value !== null)
        target.value = fixed(new D(target.value ?? "0").plus(metric.value));
    }
  }
}
