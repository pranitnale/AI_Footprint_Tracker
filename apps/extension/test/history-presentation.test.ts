import assert from "node:assert/strict";
import test from "node:test";
import type {
  EngineMethodIdentity,
  HistoricalResourceV2,
  HistorySummary,
  HistoryView,
} from "@footprint/contracts";
import { formatInteger, formatMetric } from "@footprint/ui/formatters";
import {
  combinedUsage,
  presentHistorySummary,
  presentHistoryView,
} from "../lib/history-presentation";

function summary(changes: Partial<HistorySummary> = {}): HistorySummary {
  return {
    schema_version: "3.0.0",
    scope: "loaded_history",
    status: "available",
    observed_prompt_count: "9007199254740994",
    observed_response_count: "3",
    prompt_count: "9007199254740993",
    response_count: "3",
    dated_message_count: "2",
    undated_message_count: "1",
    calculated_message_count: "4",
    uncalculated_message_count: "2",
    matched_live_message_count: "1",
    unresolved_overlap_message_count: "1",
    conflicting_message_count: "0",
    first_request_verified: false,
    branch_scope: "loaded_messages",
    provider_history_complete: false,
    file_text: [
      {
        quantity: "extracted_file_text",
        scope: "extracted_file_text",
        unit: "tokens",
        additive: false,
        value: "7",
        measurement_group: {
          origin: "unknown_origin",
          extraction_profile_id: "observed-inline-file-text-v1",
          evidence: "heuristic_estimate",
          profile_id: "o200k-base-4.0.0-reference",
        },
        applicable_count: 1,
        contributing_component_count: 1,
        unknown_count: 0,
        partial_count: 1,
        unvalidated_count: 1,
        reason_counts: { tokenizer_mapping_unverified: 1 },
        missing_counts: { provider_processing: 1, ocr: 1 },
      },
    ],
    file_text_coverage: {
      observed_message_count: "1",
      unknown_message_count: "0",
      scope: "extracted_file_text",
      additive: false,
    },
    tokens: [
      {
        role: "prompt",
        part: "total",
        profile_id: "o200k-base-4.0.0-reference",
        evidence: "heuristic_estimate",
        value: "9007199254740993123",
        known_message_count: "2",
        unknown_message_count: "1",
      },
    ],
    resources: [
      {
        quantity: "energy",
        value: "0.0004",
        unit: "kWh",
        scope: "historical_visible_response",
        method_id: "history-method-v1",
        method_hash: "a".repeat(64),
        status: "partial_estimate",
        validation_state: "unvalidated_reference",
        profile_selection: "highest_comparable",
        selected_profile_id: "reference-profile",
        reasons: ["history_only", "unvalidated_reference"],
        missing_components: [
          "provider_execution_unobserved",
          "hidden_reasoning_unobserved",
        ],
        known_message_count: "2",
        unknown_message_count: "1",
      },
    ],
    ...changes,
  };
}

test("available history preserves exact counters and partial evidence", () => {
  const value = presentHistorySummary(summary());
  assert.equal(value.status, "Estimated");
  assert.ok(value.compact.includes(formatInteger("9007199254740993")));
  assert.match(value.compact, /In\/Out tokens/);
  assert.match(value.compact, /Electricity/);
  assert.ok(
    value.counts.some(
      ([label, count]) =>
        label === "Earlier requests" &&
        count === formatInteger("9007199254740993"),
    ),
  );
  assert.equal(
    value.tokens[0]!.tokens,
    `≈ ${formatInteger("9007199254740993123")} tokens`,
  );
  assert.match(value.resources[0]!.value, /^≈ 0[.,]4 Wh$/);
  assert.match(value.resources[0]!.missing, /provider execution unobserved/);
  assert.equal(value.resources[0]!.method, "history-method-v1");
  assert.equal(value.resources[0]!.methodHash, "a".repeat(64));
  assert.equal(value.resources[0]!.selectedProfile, "reference-profile");
  assert.equal(value.coverage[0], "Partially loaded");
  assert.ok(value.coverage.every((line) => line.length < 90));
});

test("compact history exposes scoped text and water components without combining groups", () => {
  const baseResource = summary().resources[0]!;
  const value = presentHistorySummary(
    summary({
      tokens: [
        summary().tokens[0]!,
        {
          role: "prompt",
          part: "total",
          profile_id: "cl100k-base-4.0.0-reference",
          evidence: "heuristic_estimate",
          value: "5",
          known_message_count: "1",
          unknown_message_count: "0",
        },
        {
          role: "response",
          part: "total",
          profile_id: "o200k-base-4.0.0-reference",
          evidence: "heuristic_estimate",
          value: "11",
          known_message_count: "1",
          unknown_message_count: "0",
        },
      ],
      resources: [
        baseResource,
        { ...baseResource, method_hash: "b".repeat(64), value: "0.0006" },
        {
          ...baseResource,
          quantity: "carbon",
          value: "0.2",
          unit: "gCO2e",
        },
        {
          ...baseResource,
          quantity: "water_direct",
          value: "0.001",
          unit: "L",
        },
        {
          ...baseResource,
          quantity: "water_upstream",
          value: "0.002",
          unit: "L",
        },
        {
          ...baseResource,
          quantity: "water_total",
          value: null,
          unit: "L",
          status: "unavailable",
        },
      ],
    }),
  );
  // Approximate token counts add across tokenizers; resources from different methods do not.
  assert.ok(
    value.compact.includes(
      `In/Out tokens - ≈ ${formatInteger("9007199254740993128")}/11`,
    ),
  );
  assert.match(value.compact, /Electricity Multiple groups/);
  assert.match(value.compact, /Carbon ≈ 0[.,]2 g CO₂e/);
  assert.match(value.compact, /Direct water ≈ 1 mL/);
  assert.match(value.compact, /Electricity-supply water ≈ 2 mL/);
  assert.match(value.compact, /Water Unknown/);
  assert.doesNotMatch(value.compact, /3 mL/);
});

test("first-request wording does not claim complete provider history", () => {
  const value = presentHistorySummary(
    summary({ first_request_verified: true, branch_scope: "selected_branch" }),
  );
  assert.equal(value.coverage[0], "First message: loaded");
  assert.equal(value.coverage[1], "Branch: selected conversation");
  assert.doesNotMatch(
    value.coverage.join(" "),
    /completely|provider history complete/i,
  );
});

test("empty and unavailable history never appear as successful zero usage", () => {
  const empty = presentHistorySummary(summary({ status: "empty" }));
  const unavailable = presentHistorySummary(summary({ status: "unavailable" }));
  assert.match(empty.compact, /earlier provider activity remains unknown/i);
  assert.match(unavailable.compact, /does not mean.*zero work/i);
  assert.equal(empty.counts.length, 0);
  assert.equal(unavailable.counts.length, 0);
});

test("local pending and synced history remain separate", () => {
  const view: HistoryView = {
    local: summary({ prompt_count: "2" }),
    pending: summary({ prompt_count: "1" }),
    server: summary({ prompt_count: "8" }),
    server_status: "offline",
    coverage: "partial_loaded_history",
  };
  const value = presentHistoryView(view);
  assert.deepEqual(
    value.sections.map((section) => section.key),
    ["server", "local", "pending"],
  );
  assert.match(value.compact, /Other snapshots in Details/);
  assert.match(value.serverNotice!, /not added/i);
});

const ecoMethod: EngineMethodIdentity = {
  engine_id: "ecologits",
  implementation_version: "test-port-v1",
  method_id: "test-ecologits-v1",
  method_hash: "e".repeat(64),
  source_version: "0.11.1",
  source_commit: null,
  catalog_hash: null,
  profile_policy_hash: "b".repeat(64),
  environment_policy_hash: "c".repeat(64),
  product_scope: "operational-only",
};
function rangedHistory(): HistoricalResourceV2 {
  return {
    quantity: "energy",
    unit: "kWh",
    value: "3e-19",
    status: "partial_estimate",
    scope: "historical_visible_response",
    method_id: ecoMethod.method_id,
    method_hash: ecoMethod.method_hash,
    validation_state: "unvalidated_reference",
    profile_selection: "direct_mapping",
    selected_profile_id: "openai/gpt-test",
    reasons: [],
    missing_components: ["provider_execution_unobserved"],
    known_message_count: "2",
    unknown_message_count: "0",
    phase: "usage",
    value_kind: "midpoint_sum",
    scenario_low: null,
    scenario_high: null,
    interval_kind: null,
    requested_method: ecoMethod,
    effective_method: ecoMethod,
    comparability: {
      energy_boundary: "facility",
      carbon_boundary: "unknown",
      carbon_accounting: "location",
      water_kind: "consumption",
      direct_water_source: "unknown",
      upstream_water_source: "unknown",
      common_water_scope: null,
      tokenizer_profile_id: null,
    },
  };
}

test("EcoLogits history shows one water consumption value without component or source labels", () => {
  const water: HistoricalResourceV2 = {
    ...rangedHistory(),
    quantity: "water_total",
    unit: "L",
    value: "0.003",
  };
  const component = (
    quantity: "water_direct" | "water_upstream",
  ): HistoricalResourceV2 => ({
    ...water,
    quantity,
    value: null,
    status: "unavailable",
    value_kind: "unavailable",
    reasons: ["not_applicable"],
  });
  const presentation = presentHistorySummary(
    summary({
      schema_version: "3.0.0",
      resources: [
        component("water_direct"),
        component("water_upstream"),
        water,
      ],
    }),
  );
  assert.equal(presentation.resources.length, 1);
  assert.equal(presentation.resources[0]!.quantity, "Water consumption");
  assert.match(presentation.resources[0]!.value, /3 mL/);
  assert.match(presentation.compact, /Water ≈ 3 mL/);
  assert.doesNotMatch(
    presentation.compact,
    /Direct water|Electricity-supply water/,
  );
  assert.doesNotMatch(
    presentation.resources[0]!.provenance,
    /Direct source|Electricity-supply source/,
  );
});

test("v2 historical midpoint sums retain operational provenance and say when scenario totals are unavailable", () => {
  const original = rangedHistory();
  const presentation = presentHistorySummary(
    summary({ schema_version: "3.0.0", resources: [original] }),
  );
  assert.doesNotMatch(presentation.resources[0]!.value, /sum of midpoints/);
  assert.match(
    presentation.resources[0]!.provenance,
    /Scenario totals are unavailable for this group/,
  );
  assert.match(presentation.resources[0]!.provenance, /Operational use only/);
  assert.match(
    presentation.resources[0]!.provenance,
    /Requested: EcoLogits.*Calculated with: EcoLogits/,
  );
  assert.equal(original.scenario_low, null);
  assert.doesNotMatch(
    presentation.coverage.join(" "),
    /Method: original recorded estimate/,
  );
});

test("individual historical ranges remain accessible without being described as measured confidence", () => {
  const record = {
    ...rangedHistory(),
    value_kind: "midpoint" as const,
    value: "3e-19",
    scenario_low: "1e-19",
    scenario_high: "5e-19",
    interval_kind: "upstream_approximation" as const,
  };
  const presentation = presentHistorySummary(
    summary({ schema_version: "3.0.0", resources: [record] }),
    "minimum",
  );
  // The minimum display names the endpoint it shows; the midpoint remains selectable.
  assert.equal(
    presentation.resources[0]!.value,
    `${formatMetric("1e-19", "kWh")} (minimum)`,
  );
  assert.match(
    presentHistorySummary(
      summary({ schema_version: "3.0.0", resources: [record] }),
      "midpoint",
    ).resources[0]!.value,
    /≈ .* \(midpoint\)$/,
  );
  assert.match(
    presentation.resources[0]!.provenance,
    /Upstream approximation interval/,
  );
  assert.match(presentation.resources[0]!.provenance, /Shown: minimum scenario/);
  assert.match(
    presentation.resources[0]!.provenance,
    /not a confidence interval or a measured mean/,
  );
});

test("compatible v2 live and history groups sum midpoint values and scenario endpoints", () => {
  const record = rangedHistory();
  const history: HistoryView = {
    local: summary({ schema_version: "3.0.0", resources: [record] }),
    pending: null,
    server: null,
    server_status: "personal",
    coverage: "partial_loaded_history",
  };
  const live = {
    requests: 1,
    metrics: {
      energy: { ...record, scope: "modeled_text_component", value: "1e-19" },
      carbon: { value: null },
      water: { value: null },
    },
  };
  const value = combinedUsage(live, history, "minimum")!;
  assert.equal(value.energy.value, "0.0000000000000000004");
  assert.doesNotMatch(value.energy.text, /sum of midpoints/);
  // Rows without endpoints (older snapshots) leave the combined scenario total unavailable.
  assert.equal(value.energy.scenario_low, null);
  assert.equal(value.energy.scenario_high, null);
  assert.equal(
    value.energy.text,
    `${formatMetric("0.0000000000000000004", "kWh")} (midpoint)`,
  );
  assert.equal(value.energy.compactText, formatMetric("0.0000000000000000004", "kWh"));
  assert.doesNotMatch(value.text, /midpoint|minimum|maximum|scenario/);
  const boundedRecord = {
    ...record,
    scenario_low: "1e-19",
    scenario_high: "5e-19",
  };
  const bounded = combinedUsage(
    {
      ...live,
      metrics: {
        ...live.metrics,
        energy: {
          ...boundedRecord,
          scope: "modeled_text_component",
          value: "1e-19",
          scenario_low: "0.5e-19",
          scenario_high: "2e-19",
        },
      },
    },
    {
      ...history,
      local: summary({ schema_version: "3.0.0", resources: [boundedRecord] }),
    },
    "minimum",
  )!;
  assert.equal(bounded.energy.scenario_low, "0.00000000000000000015");
  assert.equal(bounded.energy.scenario_high, "0.0000000000000000007");
  assert.equal(
    bounded.energy.text,
    formatMetric("0.00000000000000000015", "kWh"),
  );
  assert.equal(
    combinedUsage(
      {
        ...live,
        metrics: {
          ...live.metrics,
          energy: {
            ...boundedRecord,
            scope: "modeled_text_component",
            value: "1e-19",
            scenario_low: "0.5e-19",
            scenario_high: "2e-19",
          },
        },
      },
      {
        ...history,
        local: summary({
          schema_version: "3.0.0",
          resources: [boundedRecord],
        }),
      },
      "maximum",
    )!.energy.text,
    formatMetric("0.0000000000000000007", "kWh"),
  );
  const changed = {
    ...live,
    metrics: {
      ...live.metrics,
      energy: {
        ...live.metrics.energy,
        comparability: {
          ...record.comparability,
          carbon_boundary: "lifecycle" as const,
        },
      },
    },
  };
  assert.equal(combinedUsage(changed, history)!.energy.multiple, true);
});

test("ranged history follows the display scenario and falls back to the midpoint sum without endpoints", () => {
  const bounded: HistoricalResourceV2 = {
    ...rangedHistory(),
    scenario_low: "1e-19",
    scenario_high: "5e-19",
  };
  const view = presentHistorySummary(
    summary({ schema_version: "3.0.0", resources: [bounded] }),
    "minimum",
  );
  assert.equal(view.resources[0]!.value, formatMetric("1e-19", "kWh"));
  assert.match(
    view.resources[0]!.provenance,
    /Scenario totals: minimum .*Shown: minimum scenario/,
  );
  assert.equal(
    presentHistorySummary(
      summary({ schema_version: "3.0.0", resources: [bounded] }),
      "maximum",
    ).resources[0]!.value,
    formatMetric("5e-19", "kWh"),
  );
  assert.equal(
    presentHistorySummary(
      summary({ schema_version: "3.0.0", resources: [bounded] }),
      "midpoint",
    ).resources[0]!.value,
    formatMetric("3e-19", "kWh"),
  );
  assert.match(
    presentHistoryView(
      {
        local: summary({ schema_version: "3.0.0", resources: [bounded] }),
        pending: null,
        server: null,
        server_status: "personal",
        coverage: "partial_loaded_history",
      },
      "maximum",
    ).compact,
    new RegExp(`Electricity ${formatMetric("5e-19", "kWh")}`),
  );
  // Without endpoints a minimum display falls back to the midpoint and says so.
  const legacy = presentHistorySummary(
    summary({ schema_version: "3.0.0", resources: [rangedHistory()] }),
    "minimum",
  );
  assert.equal(
    legacy.resources[0]!.value,
    `${formatMetric("3e-19", "kWh")} (midpoint)`,
  );
  assert.match(legacy.resources[0]!.provenance, /Scenario totals are unavailable/);
});
