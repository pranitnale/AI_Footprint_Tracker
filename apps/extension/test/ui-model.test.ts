import assert from "node:assert/strict";
import test from "node:test";
import {
  addCounters,
  buildUsageFilters,
  counter,
  zonedMidnight,
  type UsageFilterDraft,
} from "../lib/ui-model";

const base: UsageFilterDraft = {
  period: "month",
  start: "",
  end: "",
  site: "",
  model: "",
  calculationView: "original",
  methodId: "",
};

test("Berlin week starts on Monday even when today is Sunday", () => {
  const result = buildUsageFilters(
    { ...base, period: "week" },
    "Europe/Berlin",
    new Date("2026-09-13T12:00:00Z"),
    "my",
  );
  assert.equal(result.local.start, "2026-09-06T22:00:00.000Z");
});

test("last month and DST month boundaries use the configured timezone", () => {
  const last = buildUsageFilters(
    { ...base, period: "last_month" },
    "Europe/Berlin",
    new Date("2026-09-10T12:00:00Z"),
    "my",
  );
  assert.equal(last.local.start, "2026-07-31T22:00:00.000Z");
  assert.equal(last.local.end, "2026-08-31T22:00:00.000Z");
  const march = buildUsageFilters(
    { ...base, period: "custom", start: "2026-03-01", end: "2026-04-01" },
    "Europe/Berlin",
    new Date("2026-03-15T12:00:00Z"),
    "my",
  );
  assert.equal(march.local.end, "2026-03-31T22:00:00.000Z");
});

test("server presets remain presets and all time is explicit", () => {
  assert.equal(
    buildUsageFilters(base, "UTC", new Date("2026-09-10T12:00:00Z"), "my")
      .query,
    "?period=month&calculation_view=original",
  );
  assert.equal(
    buildUsageFilters({ ...base, period: "all" }, "UTC", new Date(), "my")
      .query,
    "?period=all&calculation_view=original",
  );
});

test("calculation selection uses separate local and server field names", () => {
  const result = buildUsageFilters(
    {
      ...base,
      calculationView: "recalculated",
      methodId: "reviewed-method-v2",
    },
    "UTC",
    new Date(),
    "my",
  );
  assert.equal(result.local.calculationView, "recalculated");
  assert.equal(result.local.methodId, "reviewed-method-v2");
  assert.match(
    result.query,
    /calculation_view=recalculated&method_id=reviewed-method-v2/,
  );
  assert.throws(
    () =>
      buildUsageFilters(
        { ...base, calculationView: "recalculated", methodId: "" },
        "UTC",
        new Date(),
        "my",
      ),
    /available calculation method/,
  );
});

test("member company view omits unsupported model filters and counters preserve 64-bit strings", () => {
  const result = buildUsageFilters(
    { ...base, model: "example-model" },
    "UTC",
    new Date(),
    "company",
  );
  assert.equal(result.query.includes("model"), false);
  assert.equal(counter("9223372036854775807"), 9_223_372_036_854_775_807n);
  assert.equal(counter("bad"), null);
  assert.equal(counter(Number.MAX_SAFE_INTEGER + 1), null);
  assert.equal(
    addCounters(["9223372036854775800", "7"]),
    9_223_372_036_854_775_807n,
  );
});

test("skipped midnight resolves to the first valid instant and impossible dates fail", () => {
  assert.equal(
    zonedMidnight("2026-09-06", "America/Santiago"),
    "2026-09-06T04:00:00.000Z",
  );
  assert.throws(() => zonedMidnight("2026-02-30", "UTC"), /does not exist/);
});

test("selected default omits inspection filters for both dashboard and server", () => {
  const selected = buildUsageFilters(
    { ...base, calculationView: "selected", methodId: "stale-inspection" },
    "Europe/Berlin",
    new Date("2026-09-10T12:00:00Z"),
    "my",
  );
  assert.equal("calculationView" in selected.local, false);
  assert.equal("methodId" in selected.local, false);
  assert.equal(
    new URLSearchParams(selected.query).has("calculation_view"),
    false,
  );
  assert.equal(new URLSearchParams(selected.query).has("method_id"), false);
});
