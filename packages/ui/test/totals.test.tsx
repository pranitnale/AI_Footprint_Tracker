import test from "node:test";
import assert from "node:assert/strict";
import {
  comparableGroups,
  comparableKey,
  comparableTotal,
  methodReleaseKeys,
  sumFixed,
} from "../src/totals";

const method = (hash: string) => ({ method_hash: hash.repeat(64) });
const comparability = (tokenizer: string | null) => ({
  energy_boundary: "facility",
  carbon_boundary: "lifecycle",
  carbon_accounting: "location",
  water_kind: "consumption",
  direct_water_source: "unknown",
  upstream_water_source: "unknown",
  common_water_scope: null,
  tokenizer_profile_id: tokenizer,
});
const row = (value: string | null, extra: Record<string, unknown> = {}) => ({
  value,
  unit: "kWh",
  phase: "usage",
  requested_method: method("a"),
  effective_method: method("a"),
  comparability: comparability("o200k-base-4.0.0-reference"),
  ...extra,
});

test("D4 rows calculated alike add up whatever model or tokenizer each reply used", () => {
  const total = comparableTotal([
    row("0.001", { selection: { kind: "direct_mapping" } }),
    row("0.002", {
      selection: { kind: "provider_flagship" },
      comparability: comparability("cl100k-base-4.0.0-reference"),
    }),
  ]);
  assert.equal(total.multiple, false);
  assert.equal(total.value, "0.003");
  assert.equal(total.value_kind, "scalar");
  assert.equal(total.lineage?.comparability.tokenizer_profile_id, null);
});

test("ranged and point rows add endpoint by endpoint; a ranged row without endpoints leaves them unknown", () => {
  const ranged = row("2", {
    value_kind: "midpoint",
    scenario_low: "1",
    scenario_high: "3",
  });
  const point = row("5", { value_kind: "scalar" });
  assert.deepEqual(
    (({ value, value_kind, scenario_low, scenario_high }) => ({
      value,
      value_kind,
      scenario_low,
      scenario_high,
    }))(comparableTotal([ranged, point])),
    {
      value: "7",
      value_kind: "midpoint_sum",
      scenario_low: "6",
      scenario_high: "8",
    },
  );
  const older = row("2", {
    value_kind: "midpoint_sum",
    scenario_low: null,
    scenario_high: null,
  });
  const total = comparableTotal([older, point]);
  assert.equal(total.value, "7");
  assert.equal(total.scenario_low, null);
});

test("other methods, units or boundaries stay separate; unknown rows never split a total", () => {
  assert.equal(
    comparableTotal([row("1"), row("2", { effective_method: method("b") })])
      .multiple,
    true,
  );
  assert.equal(
    comparableTotal([row("1"), row("2", { unit: "Wh" })]).multiple,
    true,
  );
  assert.equal(
    comparableTotal([
      row("1"),
      row("2", {
        comparability: { ...comparability(null), carbon_accounting: "market" },
      }),
    ]).multiple,
    true,
  );
  // A series that only counts unknown replies adds nothing and splits nothing.
  const total = comparableTotal([
    row("1"),
    row(null, { effective_method: method("c") }),
  ]);
  assert.equal(total.multiple, false);
  assert.equal(total.value, "1");
  // Rows that name no lineage cannot be added to others.
  assert.equal(comparableKey({ value: "1" }), null);
  assert.equal(
    comparableTotal([{ value: "1" }, { value: "2" }]).multiple,
    true,
  );
  assert.equal(comparableTotal([{ value: "1" }]).value, "1");
});

test("company series carry their lineage in the method group", () => {
  const series = (value: string, profile: string) => ({
    value,
    unit: "kWh",
    method_group: {
      requested_method: method("a"),
      effective_method: method("a"),
      comparability: comparability(null),
      selected_profile_id: profile,
      profile_selection: "direct_mapping",
    },
  });
  const total = comparableTotal([
    series("0.5", "anthropic/claude-opus-5-5"),
    series("0.25", "openai/gpt-6-astra"),
  ]);
  assert.equal(total.multiple, false);
  assert.equal(total.value, "0.75");
  assert.equal(sumFixed(["0.5", "0.25"]), total.value);
});

// An EcoLogits identity as the server and extension send it. Each extension build whose model
// mappings changed proposes a new method id and hash with the same core, catalog and environment.
const release = (hash: string, changes: Record<string, unknown> = {}) => ({
  engine_id: "ecologits",
  implementation_version: "0.11.1-port.2",
  method_id: `ecologits-0.11.2-${hash.repeat(64)}`,
  method_hash: hash.repeat(64),
  source_version: "0.11.2",
  source_commit: "c".repeat(40),
  catalog_hash: "8".repeat(64),
  profile_policy_hash: hash.repeat(64),
  environment_policy_hash: "b".repeat(64),
  product_scope: "operational-only",
  ...changes,
});
const series = (value: string, method: Record<string, unknown>) => ({
  value,
  unit: "kWh",
  value_kind: "midpoint_sum",
  scenario_low: String(Number(value) / 2),
  scenario_high: String(Number(value) * 2),
  method_group: {
    requested_method: method,
    effective_method: method,
    comparability: comparability(null),
  },
});

test("releases that differ only in model mappings add up, with no single method lineage", () => {
  // Production on 14 October 2026: three builds in one month made every organization figure
  // "Not available" although the contract adds comparable methods.
  const total = comparableTotal([
    series("0.5", release("1")),
    series("0.25", release("2")),
    row("0.125", {
      requested_method: release("3"),
      effective_method: release("3"),
    }),
  ]);
  assert.equal(total.multiple, false);
  assert.equal(total.value, "0.875");
  assert.equal(total.methodReleases, 3);
  // No one method identity describes the total, so it names none.
  assert.equal(total.lineage, null);
  const one = comparableTotal([
    series("0.5", release("1")),
    series("0.25", release("1")),
  ]);
  assert.equal(one.methodReleases, 1);
  assert.equal(one.lineage?.requested_method.method_hash, "1".repeat(64));
});

test("another EcoLogits core, catalog, environment policy or engine stays apart", () => {
  for (const changes of [
    { implementation_version: "0.12.0-port.1" },
    { source_version: "0.12.0" },
    { catalog_hash: "9".repeat(64) },
    { environment_policy_hash: "e".repeat(64) },
    { engine_id: "original" },
  ])
    assert.equal(
      comparableTotal([
        series("0.5", release("1")),
        series("0.25", release("2", changes)),
      ]).multiple,
      true,
      JSON.stringify(changes),
    );
});

test("comparableGroups gives each set that adds, largest first, never a sum of sets", () => {
  const groups = comparableGroups([
    series("0.5", release("1")),
    series("0.25", release("2", { catalog_hash: "9".repeat(64) })),
    series("0.375", release("3", { catalog_hash: "9".repeat(64) })),
    series("1", release("4", { engine_id: "original" })),
    { value: null },
  ]);
  assert.deepEqual(
    groups.map((group) => [group.value, group.rows, group.multiple]),
    [
      ["1", 1, false],
      ["0.625", 2, false],
      ["0.5", 1, false],
    ],
  );
  assert.equal(groups[1]!.scenario_low, "0.3125");
  assert.equal(groups[1]!.scenario_high, "1.25");
});

test("a local group that already added releases counts each of them once in the total", () => {
  // The extension's own summary groups releases of one family into one row and lists them.
  const local = {
    ...row("0.5", { requested_method: release("1"), effective_method: release("1") }),
    comparability: comparability(null),
    method_releases: [`${"1".repeat(64)}:${"1".repeat(64)}`, `${"2".repeat(64)}:${"2".repeat(64)}`],
  };
  assert.deepEqual(methodReleaseKeys(local), local.method_releases);
  const total = comparableTotal([local, series("0.25", release("2")), series("0.125", release("3"))]);
  assert.equal(total.multiple, false);
  assert.equal(total.value, "0.875");
  assert.equal(total.methodReleases, 3);
  assert.equal(total.lineage, null);
  // A single row names its own release.
  assert.deepEqual(methodReleaseKeys(series("0.25", release("2"))), [`${"2".repeat(64)}:${"2".repeat(64)}`]);
});
