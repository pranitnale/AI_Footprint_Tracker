import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { createMethodRegistry } from "@footprint/estimator";
import { Ledger } from "@footprint/ledger";
import configuration from "../../../config/estimation.build.json";
import mappings from "../../../config/estimation.mappings.json";
import media from "../../../config/estimation.media.json";
import { serverSummary, validatedSummary } from "../lib/server-summary";

const methods = createMethodRegistry(configuration, mappings, media);
const comparability = {
  energy_boundary: "facility",
  carbon_boundary: "lifecycle",
  carbon_accounting: "location",
  water_kind: "consumption",
  direct_water_source: "unknown",
  upstream_water_source: "unknown",
  common_water_scope: null,
  tokenizer_profile_id: "o200k-base-4.0.0-reference",
} as const;

function response() {
  const requested = methods.ecologits;
  const effective = methods.ecologits;
  return {
    aggregate_status: "current",
    calculation_view: "recalculated",
    method_id: requested.method_id,
    method_hash: requested.method_hash,
    recalculation_job_id: "a".repeat(64),
    resources: [
      {
        quantity: "energy",
        unit: "kWh",
        scope: "modeled_text_component",
        value: "2.5e-7",
        method_group: {
          method_id: requested.method_id,
          method_hash: requested.method_hash,
          environment_scenario_id: effective.environment_policy_hash,
          selected_profile_id: "anthropic/claude-opus-4-8",
          profile_selection: "direct_mapping",
          starting_energy_boundary: "facility",
          result_scope: "modeled_text_component",
          cohort_id: effective.method_id,
          cohort_hash: effective.catalog_hash,
          eligible_candidate_count: null,
          eligible_candidate_signature: null,
          requested_method: structuredClone(requested),
          effective_method: structuredClone(effective),
          comparability: structuredClone(comparability),
          interval_kind: "upstream_approximation",
        },
        applicable_count: 1,
        unknown_count: 0,
        partial_count: 1,
        unvalidated_count: 1,
        contributing_attempt_count: 1,
        reason_counts: { provider_environment_assumed: 1 },
        phase: "usage",
        value_kind: "midpoint_sum",
        scenario_low: null,
        scenario_high: null,
        interval_kind: null,
      },
    ],
  };
}

test("version 2 resource aggregates accept scenario sums that bracket the midpoint sum", () => {
  const input = response();
  Object.assign((input.resources as any[])[0], {
    scenario_low: "1e-7",
    scenario_high: "4e-7",
  });
  const resource = (validatedSummary(input).resources as any[])[0]!;
  assert.equal(resource.scenario_low, "1e-7");
  assert.equal(resource.scenario_high, "4e-7");
  assert.equal(resource.interval_kind, null);
  for (const changes of [
    { scenario_low: "3e-7" },
    { scenario_high: null },
    { scenario_high: "NaN" },
    { interval_kind: "upstream_approximation" },
  ]) {
    const rejected = response();
    Object.assign(
      (rejected.resources as any[])[0],
      { scenario_low: "1e-7", scenario_high: "4e-7" },
      changes,
    );
    assert.throws(
      () => validatedSummary(rejected),
      /payload_rejected/,
      JSON.stringify(changes),
    );
  }
  // Scalar groups never carry scenario sums.
  const scalar = response();
  const row = (scalar.resources as any[])[0];
  row.method_group.interval_kind = null;
  Object.assign(row, {
    value_kind: "scalar",
    scenario_low: "1e-7",
    scenario_high: "4e-7",
  });
  assert.throws(() => validatedSummary(scalar), /payload_rejected/);
});

test("native version 2 resource aggregates preserve exponent values and full lineage", () => {
  const input = response();
  const result = validatedSummary(input);
  const resource = (result.resources as any[])[0]!;
  assert.equal(resource.value, "2.5e-7");
  assert.equal(resource.phase, "usage");
  assert.equal(resource.value_kind, "midpoint_sum");
  assert.equal(resource.scenario_low, null);
  assert.equal(resource.scenario_high, null);
  assert.equal(resource.interval_kind, null);
  assert.deepEqual(resource.method_group.requested_method, methods.ecologits);
  assert.deepEqual(resource.method_group.effective_method, methods.ecologits);
  assert.deepEqual(resource.method_group.comparability, comparability);
  assert.equal(
    resource.method_group.environment_scenario_id,
    methods.ecologits.environment_policy_hash,
  );
  assert.equal(
    resource.method_group.cohort_hash,
    methods.ecologits.catalog_hash,
  );
  assert.deepEqual(resource.reason_counts, {
    provider_environment_assumed: "1",
  });
});

test("version 2 scalar aggregate accepts the current native omission of optional display metadata", () => {
  const input = response();
  const row = input.resources[0] as any;
  row.value = "5e-324";
  row.method_group.interval_kind = null;
  for (const field of [
    "phase",
    "value_kind",
    "scenario_low",
    "scenario_high",
    "interval_kind",
  ])
    delete row[field];
  const resource = (validatedSummary(input).resources as any[])[0]!;
  assert.equal(resource.value, "5e-324");
  assert.equal(Object.hasOwn(resource, "value_kind"), false);
  assert.deepEqual(resource.method_group.requested_method, methods.ecologits);
});

test("version 2 unknown aggregate remains null and never becomes a numerical zero", () => {
  const input = response();
  const row = input.resources[0] as any;
  row.value = null;
  row.unknown_count = 1;
  row.contributing_attempt_count = 0;
  row.partial_count = 0;
  row.method_group.interval_kind = null;
  row.value_kind = "unavailable";
  const resource = (validatedSummary(input).resources as any[])[0]!;
  assert.equal(resource.value, null);
  assert.equal(resource.value_kind, "unavailable");
  assert.equal(resource.contributing_attempt_count, "0");
});

test("malformed or unknown version 2 resource metadata is rejected rather than stripped", () => {
  const changes: Array<(value: ReturnType<typeof response>) => void> = [
    (value) => ((value.resources[0] as any).raw = "private"),
    (value) => ((value.resources[0] as any).value = "-1e-7"),
    (value) => ((value.resources[0] as any).value = "1e999"),
    (value) => ((value.resources[0] as any).value_kind = "midpoint"),
    (value) => ((value.resources[0] as any).scenario_low = "1e-8"),
    (value) =>
      ((value.resources[0] as any).method_group.method_id = "wrong-method"),
    (value) =>
      ((value.resources[0] as any).method_group.environment_scenario_id =
        "f".repeat(64)),
    (value) => delete (value.resources[0] as any).method_group.effective_method,
    (value) => ((value.resources[0] as any).method_group.raw = "private"),
    (value) =>
      ((value.resources[0] as any).method_group.validation_state = "verified"),
    (value) =>
      ((value.resources[0] as any).method_group.comparability.water_kind =
        "withdrawal"),
  ];
  for (const change of changes) {
    const value = response();
    change(value);
    assert.throws(() => validatedSummary(value), /^Error: payload_rejected$/);
  }
});

test("legacy resource projection retains its existing shape without invented version 2 basis", () => {
  const input = {
    aggregate_status: "current",
    resources: [
      {
        quantity: "energy",
        unit: "kWh",
        scope: "modeled_text_component",
        value: "0.000000000000000001",
        method_group: {
          method_id: "legacy-method",
          method_hash: "b".repeat(64),
          environment_scenario_id: "legacy-environment",
          selected_profile_id: "legacy-profile",
          profile_selection: "highest_comparable",
        },
        applicable_count: 1,
        unknown_count: 0,
        contributing_attempt_count: 1,
      },
    ],
  };
  const resource = (validatedSummary(input).resources as any[])[0]!;
  assert.equal(resource.value, "0.000000000000000001");
  assert.deepEqual(resource.method_group, input.resources[0]!.method_group);
  for (const field of [
    "phase",
    "value_kind",
    "scenario_low",
    "scenario_high",
    "interval_kind",
    "requested_method",
    "effective_method",
  ])
    assert.equal(Object.hasOwn(resource, field), false);
});

test("recalculated server selection rejects a valid resource from another requested method", async () => {
  const ledger = await Ledger.open(`server-v2-${crypto.randomUUID()}`);
  const credentials = {
    key: "credentials",
    namespace: "company:server-v2",
    origin: "https://company.example",
    enrollment_era: { id: crypto.randomUUID() },
    device_id: "device-one",
    policy: { deletion_epoch: 0, timezone: "Europe/Berlin" },
  };
  await ledger.put("policy", credentials);
  const input = response();
  const row = input.resources[0] as any;
  row.method_group.requested_method = methods.original;
  row.method_group.effective_method = methods.original;
  row.method_group.method_id = methods.original.method_id;
  row.method_group.method_hash = methods.original.method_hash;
  row.method_group.environment_scenario_id =
    methods.original.environment_policy_hash;
  row.method_group.cohort_id = methods.original.method_id;
  row.method_group.cohort_hash = methods.original.catalog_hash;
  row.method_group.profile_selection = "legacy_reference";
  row.method_group.interval_kind = null;
  row.value_kind = "scalar";
  const company: any = {
    credentials: async () => credentials,
    authorized: async () => input,
  };
  await assert.rejects(
    serverSummary(
      ledger,
      company,
      "my",
      `?calculation_view=recalculated&method_id=${methods.ecologits.method_id}`,
      undefined,
      {
        methodId: methods.ecologits.method_id,
        methodHash: methods.ecologits.method_hash,
      },
    ),
    /method_update_invalid/,
  );
  ledger.close();
});
