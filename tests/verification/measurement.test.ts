import assert from "node:assert/strict";
import { test } from "node:test";
import { pythonReference } from "../../tools/python-reference.cjs";
import {
  BASELINE_BUNDLE,
  environmentalAllocation,
} from "../../packages/estimator/src/index";
import { fixed } from "../../packages/estimator/src/numeric";
import { CounterSchema, payloadHash } from "../../packages/contracts/src/index";

test("independent E01 oracle preserves the declared IT and facility denominators", () => {
  // These expected values are the acceptance document's synthetic arithmetic fixture.
  const scenario = {
    ...structuredClone(BASELINE_BUNDLE.scenario),
    id: "independent-e01-synthetic",
    pue: "1.2",
    carbon: "400",
    direct_water: "0.5",
    upstream_water: "1",
    direct_water_source: "freshwater" as const,
    upstream_water_source: "freshwater" as const,
    common_water_scope: "freshwater_consumption" as const,
  };
  const actual = environmentalAllocation("0.001", "it", scenario);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(actual).map(([name, value]) => [name, fixed(value)]),
    ),
    {
      it: "0.001",
      facility: "0.0012",
      carbon: "0.48",
      direct: "0.0005",
      upstream: "0.0012",
      total: "0.0017",
    },
  );
});

test("independent E02 oracle never applies facility overhead a second time", () => {
  const scenario = {
    ...structuredClone(BASELINE_BUNDLE.scenario),
    pue: "1.2",
    direct_water: "0.5",
  };
  const actual = environmentalAllocation("0.0012", "facility", scenario);
  assert.equal(fixed(actual.facility), "0.0012");
  assert.equal(fixed(actual.it), "0.001");
  assert.equal(fixed(actual.direct), "0.0005");
});

test("independent E01 Python oracle produces the same synthetic base-unit quantities", () => {
  const scenario = {
    ...structuredClone(BASELINE_BUNDLE.scenario),
    id: "independent-e01-synthetic",
    pue: "1.2",
    carbon: "400",
    direct_water: "0.5",
    upstream_water: "1",
    direct_water_source: "freshwater",
    upstream_water_source: "freshwater",
    common_water_scope: "freshwater_consumption",
  };
  const script = [
    "import json, sys",
    "from footprint_estimator import environmental_allocation, fixed",
    "actual = environmental_allocation('0.001', 'it', json.load(sys.stdin))",
    "print(json.dumps({name: fixed(value) for name, value in actual.items()}))",
  ].join("\n");
  const result = pythonReference(["-c", script], {
    input: JSON.stringify(scenario),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    it: "0.001",
    facility: "0.0012",
    carbon: "0.48",
    direct: "0.0005",
    upstream: "0.0012",
    total: "0.0017",
  });
});

test("independent E04 and Q06 oracle retains known components without an invented total", () => {
  const scenario = {
    ...structuredClone(BASELINE_BUNDLE.scenario),
    pue: "1.2",
    direct_water: null,
    upstream_water: "1",
  };
  const actual = environmentalAllocation("0.001", "it", scenario);
  assert.equal(actual.direct, null);
  assert.equal(fixed(actual.upstream), "0.0012");
  assert.equal(actual.total, null);
});

test("independent upload hash is order invariant and changes for corrected counts", () => {
  const before = { revision: 1, tokens: { output: "100", input: "10" } };
  const reordered = { tokens: { input: "10", output: "100" }, revision: 1 };
  const corrected = { revision: 1, tokens: { output: "99", input: "10" } };
  assert.equal(payloadHash(before), payloadHash(reordered));
  assert.notEqual(payloadHash(before), payloadHash(corrected));
});

test("regression: malformed or overflowing counters reject without escaping safeParse", () => {
  for (const value of [
    "PRIVATE_MARKER",
    "1.5",
    "-1",
    "01",
    "1e3",
    "9223372036854775808",
  ]) {
    assert.equal(CounterSchema.safeParse(value).success, false);
  }
  assert.equal(CounterSchema.safeParse("0").success, true);
  assert.equal(CounterSchema.safeParse("9223372036854775807").success, true);
});
