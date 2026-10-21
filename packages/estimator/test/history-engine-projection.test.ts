import assert from "node:assert/strict";
import test from "node:test";
import {
  EstimationEnvelopeSchema,
  HistoricalResourceV2Schema,
  HistoryMessageSchema,
  HistoryResourcesSchema,
  HistorySummarySchema,
  calculationInputHash,
  canonicalJson,
  historyResponseParts,
  type EstimationEnvelope,
  type HistoricalResourceV2,
  type HistoryMessage,
  type HistorySummary,
} from "@footprint/contracts";
import configuration from "../../../config/estimation.build.json";
import mappings from "../../../config/estimation.mappings.json";
import media from "../../../config/estimation.media.json";
import { historicalResources } from "../src/engines/history-projection";
import { createMethodRegistry } from "../src/engines/methods";
import { LocalEstimateExecutor } from "../src/engines/service";
import { HistoryAccumulator, estimateHistoricalText } from "../src/history";
import { loadLegacyCorpus } from "./legacy-corpus";

const corpus = loadLegacyCorpus();
const methods = createMethodRegistry(configuration, mappings, media);
const executor = new LocalEstimateExecutor(methods);
/** Test-only policy: the shipped policy never routes to the original engine. */
const legacyConfiguration = {
  ...configuration,
  ecologits_fallback: {
    ...configuration.ecologits_fallback,
    unknown_provider: { strategy: "original_engine" as const },
  },
};
const legacyMethods = createMethodRegistry(legacyConfiguration, mappings, media);
const legacyExecutor = new LocalEstimateExecutor(legacyMethods);

function message(overrides: Partial<HistoryMessage> = {}): HistoryMessage {
  const base = {
    ...structuredClone(
      corpus.history.find((row) => row.name === "response-100")!.observation,
    ),
    site: "chatgpt",
    model_id: "chatgpt-gpt-5-5",
    ...overrides,
  };
  // A saved reply's total is its parts' sum; a prompt names no output parts.
  return HistoryMessageSchema.parse({
    ...base,
    parts:
      overrides.parts ??
      (base.role === "response" ? historyResponseParts(base.tokens) : null),
  });
}

async function estimate(
  record: HistoryMessage,
  methodId = methods.ecologits.method_id,
  run: LocalEstimateExecutor = executor,
): Promise<EstimationEnvelope> {
  return EstimationEnvelopeSchema.parse(
    await run.estimate({ family: "history", record }, { methodId }),
  );
}

function energy(rows: HistorySummary["resources"]): HistoricalResourceV2 {
  const metric = rows.find((row) => row.quantity === "energy");
  assert.ok(metric && "requested_method" in metric);
  return metric;
}

function scalar(
  metric: HistoricalResourceV2,
  value: string,
): HistoricalResourceV2 {
  return HistoricalResourceV2Schema.parse({
    ...structuredClone(metric),
    value,
    value_kind: "scalar",
    interval_kind: null,
    scenario_low: null,
    scenario_high: null,
  });
}

test("history projection preserves every frozen original row and legacy accumulation", async () => {
  const direct = new HistoryAccumulator(),
    projected = new HistoryAccumulator();
  for (const fixture of corpus.history) {
    const record = HistoryMessageSchema.parse(fixture.observation);
    const result = await estimate(record, methods.original.method_id);
    const before = canonicalJson(result);
    const rows = historicalResources(result, record);
    assert.equal(
      canonicalJson(rows),
      canonicalJson(fixture.expected),
      fixture.name,
    );
    if (record.role === "response")
      assert.strictEqual(rows, result.raw?.result);
    assert.equal(canonicalJson(result), before);
    direct.add(record);
    projected.add(record, { estimate: rows });
    const individual = new HistoryAccumulator();
    individual.add(record, { estimate: rows });
    HistorySummarySchema.parse(individual.summary);
  }
  assert.deepEqual(projected.summary, direct.summary);
  assert.equal(projected.summary.schema_version, "3.0.0");
});

test("history EcoLogits projection retains phases, ranges, upstream water and method identity", async () => {
  const record = message({
    proposed_method_id: methods.ecologits.method_id,
    company_dedup_key: null,
    proposed_method_hash: methods.ecologits.method_hash,
  });
  const result = await estimate(record);
  const before = canonicalJson(result);
  const rows = historicalResources(result, record);
  assert.equal(rows.length, 5);
  for (const row of rows) {
    assert.ok("requested_method" in row);
    const metric = result.metrics[row.quantity];
    assert.equal(row.value, metric.value);
    assert.equal(row.unit, metric.unit);
    assert.equal(row.phase, "usage");
    assert.equal(row.scope, "historical_visible_response");
    assert.equal(row.method_id, result.requested_method.method_id);
    assert.equal(row.method_hash, result.requested_method.method_hash);
    assert.equal(row.selected_profile_id, "openai/gpt-5.5");
    assert.deepEqual(row.requested_method, result.requested_method);
    assert.deepEqual(row.effective_method, result.effective_method);
    assert.deepEqual(row.comparability, result.comparability);
    assert.deepEqual(row.reasons, metric.reasons);
    assert.deepEqual(row.missing_components, result.missing_components);
    assert.equal(row.known_message_count, metric.value === null ? "0" : "1");
    assert.equal(row.unknown_message_count, metric.value === null ? "1" : "0");
    assert.equal(row.scenario_low, metric.scenario_low);
    assert.equal(row.scenario_high, metric.scenario_high);
    assert.equal(row.interval_kind, metric.interval_kind);
  }
  assert.equal(energy(rows).value_kind, "midpoint");
  assert.ok(energy(rows).scenario_low !== null);
  assert.notEqual(
    rows.find((row) => row.quantity === "water_total")!.value,
    null,
  );
  assert.equal(
    rows.find((row) => row.quantity === "water_total")!.unknown_message_count,
    "0",
  );
  assert.equal(canonicalJson(result), before);
  HistoryResourcesSchema.parse(rows);
  const total = new HistoryAccumulator();
  total.add(record, { estimate: rows });
  assert.equal(total.summary.schema_version, "3.0.0");
  HistorySummarySchema.parse(total.summary);
});

test("history original fallback keeps parent identity and the actual child profile", async () => {
  const record = message({ site: "perplexity", model_id: null });
  const result = await estimate(
    record,
    legacyMethods.ecologits.method_id,
    legacyExecutor,
  );
  assert.equal(result.selection.kind, "original_fallback");
  assert.ok(
    result.raw?.engine_id === "original" && Array.isArray(result.raw.result),
  );
  const raw = canonicalJson(result.raw.result);
  const rows = historicalResources(result, record);
  for (const row of rows) {
    assert.ok("requested_method" in row);
    const original: HistorySummary["resources"][number] =
      result.raw.result.find((metric) => metric.quantity === row.quantity)!;
    assert.equal(row.method_hash, legacyMethods.ecologits.method_hash);
    assert.equal(row.requested_method.engine_id, "ecologits");
    assert.equal(
      row.effective_method.method_hash,
      methods.original.method_hash,
    );
    assert.equal(row.value, original.value);
    assert.equal(row.selected_profile_id, original.selected_profile_id);
    assert.equal(row.profile_selection, "original_fallback");
  }
  assert.equal(canonicalJson(result.raw.result), raw);
});

test("historical prompts emit no resource rows for either engine", async () => {
  for (const methodId of [
    methods.original.method_id,
    methods.ecologits.method_id,
  ]) {
    const record = message({ role: "prompt" });
    const rows = historicalResources(await estimate(record, methodId), record);
    assert.deepEqual(rows, []);
    const total = new HistoryAccumulator();
    total.add(record, { estimate: rows });
    assert.equal(total.summary.schema_version, "3.0.0");
    assert.equal(total.summary.prompt_count, "1");
    assert.equal(total.summary.response_count, "0");
    assert.deepEqual(total.summary.resources, []);
  }
});

test("history projection checks source family, message identity and numeric revision", async () => {
  const record = message();
  const result = await estimate(record);
  for (const changed of [
    message({ message_key: "f".repeat(64) }),
    message({ tokens: { ...record.tokens, value: "101" } }),
    message({ role: "prompt" }),
  ])
    assert.throws(
      () => historicalResources(result, changed),
      /estimation_source_mismatch/,
    );
  const changed = structuredClone(result);
  assert.equal(changed.source.family, "history");
  changed.source = {
    family: "live",
    request_id: "00000000-0000-4000-8000-000000000001",
    request_revision: 1,
    request_hash: "a".repeat(64),
    attempt_id: "00000000-0000-4000-8000-000000000002",
    attempt_revision: 1,
    attempt_hash: "b".repeat(64),
  };
  changed.input_hash = calculationInputHash(changed);
  assert.throws(
    () => historicalResources(changed, record),
    /estimation_source_mismatch/,
  );
  assert.deepEqual(
    historicalResources(
      result,
      message({ observed_at: "2026-09-15T12:00:00.000Z" }),
    ),
    historicalResources(result, record),
  );
});

test("history unavailable results keep null values and per-message unknown coverage", async () => {
  const base = message();
  const record = message({ tokens: { ...base.tokens, value: "0" } });
  const result = await estimate(record);
  assert.equal(result.status, "unavailable");
  const rows = historicalResources(result, record);
  assert.equal(rows.length, 5);
  for (const row of rows) {
    assert.equal(row.value, null);
    assert.equal(row.status, "unavailable");
    assert.equal(row.known_message_count, "0");
    assert.equal(row.unknown_message_count, "1");
  }
  const total = new HistoryAccumulator();
  total.add(record, { estimate: rows });
  assert.equal(total.summary.response_count, "1");
  assert.equal(total.summary.schema_version, "3.0.0");
  HistorySummarySchema.parse(total.summary);
});

test("range aggregation adds scenario endpoints beside the midpoint sum without a joint interval kind", async () => {
  const record = message();
  const rows = historicalResources(await estimate(record), record);
  const input = energy(rows);
  assert.equal(input.value_kind, "midpoint");
  const before = canonicalJson(rows);
  const total = new HistoryAccumulator();
  total.add(record, { estimate: rows });
  const first = energy(total.summary.resources);
  assert.equal(first.value, input.value);
  assert.equal(first.value_kind, "midpoint_sum");
  assert.equal(first.scenario_low, input.scenario_low);
  assert.equal(first.scenario_high, input.scenario_high);
  assert.equal(first.interval_kind, null);
  total.add(message({ message_key: "f".repeat(64) }), { estimate: rows });
  const doubled = energy(total.summary.resources);
  assert.equal(doubled.known_message_count, "2");
  assert.equal(doubled.value_kind, "midpoint_sum");
  assert.equal(Number(doubled.scenario_low), 2 * Number(input.scenario_low));
  assert.equal(Number(doubled.scenario_high), 2 * Number(input.scenario_high));
  assert.ok(Number(doubled.scenario_low) <= Number(doubled.value));
  assert.ok(Number(doubled.value) <= Number(doubled.scenario_high));
  assert.equal(canonicalJson(rows), before);
  HistorySummarySchema.parse(total.summary);
  // A summed contribution saved before scenario sums existed leaves the group's endpoints
  // unavailable, even when a later contribution to the same group carries them.
  const summed = rows.map((row) =>
    row.quantity === "energy" && "value_kind" in row
      ? {
          ...row,
          value_kind: "midpoint_sum" as const,
          scenario_low: null,
          scenario_high: null,
          interval_kind: null,
        }
      : row,
  );
  const legacy = new HistoryAccumulator();
  legacy.add(record, { estimate: summed });
  legacy.add(message({ message_key: "f".repeat(64) }), {
    estimate: summed.map((row) =>
      row.quantity === "energy" && "value_kind" in row
        ? {
            ...row,
            scenario_low: input.scenario_low,
            scenario_high: input.scenario_high,
          }
        : row,
    ),
  });
  const partial = energy(legacy.summary.resources);
  assert.equal(partial.known_message_count, "2");
  assert.equal(partial.value_kind, "midpoint_sum");
  assert.equal(partial.scenario_low, null);
  assert.equal(partial.scenario_high, null);
  HistorySummarySchema.parse(legacy.summary);
});

const variants: Array<[string, (metric: HistoricalResourceV2) => void]> = [
  [
    "parent hash",
    (metric) => {
      metric.method_hash = metric.requested_method.method_hash = "f".repeat(64);
      metric.effective_method.method_hash = metric.method_hash;
    },
  ],
  [
    "parent id",
    (metric) => {
      metric.method_id = metric.requested_method.method_id = "other-parent";
      metric.effective_method.method_id = metric.method_id;
    },
  ],
  [
    "child",
    (metric) => {
      metric.effective_method.method_hash = "f".repeat(64);
    },
  ],
  [
    "comparability",
    (metric) => {
      metric.comparability.carbon_boundary =
        metric.comparability.carbon_boundary === "generation"
          ? "lifecycle"
          : "generation";
    },
  ],
  [
    "unit",
    (metric) => {
      metric.unit = metric.unit === "gCO2e" ? "gCO2" : "gCO2e";
    },
  ],
  [
    "profile",
    (metric) => {
      metric.selected_profile_id += "-other";
    },
  ],
  [
    "selection",
    (metric) => {
      metric.profile_selection = "provider_flagship";
    },
  ],
  [
    "reason",
    (metric) => {
      metric.reasons.push("source_warning");
    },
  ],
  [
    "missing coverage",
    (metric) => {
      metric.missing_components.push("test_missing");
    },
  ],
  [
    "interval semantics",
    (metric) => {
      metric.interval_kind = "scenario";
    },
  ],
  [
    "scalar semantics",
    (metric) => {
      metric.value_kind = "scalar";
      metric.scenario_low = metric.scenario_high = metric.interval_kind = null;
    },
  ],
  [
    "availability",
    (metric) => {
      metric.value = null;
      metric.status = "unavailable";
      metric.value_kind = "unavailable";
      metric.scenario_low = metric.scenario_high = metric.interval_kind = null;
      metric.known_message_count = "0";
      metric.unknown_message_count = "1";
    },
  ],
];
for (const [name, change] of variants) {
  test(`historical grouping keeps incompatible ${name} separate`, async () => {
    const record = message();
    if (name === "child") {
      record.site = "perplexity";
      record.model_id = null;
    }
    const source = historicalResources(
      name === "child"
        ? await estimate(
            record,
            legacyMethods.ecologits.method_id,
            legacyExecutor,
          )
        : await estimate(record),
      record,
    ).find((row) => row.quantity === "carbon")!;
    assert.ok("requested_method" in source);
    const other = structuredClone(source);
    change(other);
    HistoricalResourceV2Schema.parse(other);
    const forward = new HistoryAccumulator(),
      reverse = new HistoryAccumulator();
    forward.add(record, { estimate: [source] });
    forward.add(record, { estimate: [other] });
    reverse.add(record, { estimate: [other] });
    reverse.add(record, { estimate: [source] });
    assert.equal(forward.summary.resources.length, 2);
    assert.deepEqual(
      forward.summary.resources.map(canonicalJson).sort(),
      reverse.summary.resources.map(canonicalJson).sort(),
    );
    HistorySummarySchema.parse(forward.summary);
  });
}

test("Original and EcoLogits history retain separate groups in the current summary", async () => {
  const record = message();
  const original = estimateHistoricalText(record);
  const legacyBefore = canonicalJson(original);
  const result = await estimate(record);
  const projected = historicalResources(result, record);
  const total = new HistoryAccumulator();
  total.add(record, { estimate: original });
  assert.equal(total.summary.schema_version, "3.0.0");
  total.add(record, { estimate: projected });
  assert.equal(total.summary.schema_version, "3.0.0");
  assert.equal(total.summary.resources.length, 10);
  assert.equal(canonicalJson(original), legacyBefore);
  assert.equal(
    canonicalJson(
      total.summary.resources.filter((row) => !("requested_method" in row)),
    ),
    legacyBefore,
  );
  HistorySummarySchema.parse(total.summary);
});

for (const [left, right, expected] of [
  ["9007199254740993", "1", "9007199254740994"],
  ["1e-30", "2e-30", "3e-30"],
  ["1e-90", "2e-90", "3e-90"],
  [`1.${"0".repeat(84)}1`, `0.${"0".repeat(84)}1`, `1.${"0".repeat(84)}2`],
]) {
  test(`new historical decimal sums remain exact for ${left}`, async () => {
    const record = message();
    const base = energy(historicalResources(await estimate(record), record));
    const forward = new HistoryAccumulator(),
      reverse = new HistoryAccumulator();
    for (const value of [left!, right!])
      forward.add(record, { estimate: [scalar(base, value)] });
    for (const value of [right!, left!])
      reverse.add(record, { estimate: [scalar(base, value)] });
    assert.equal(energy(forward.summary.resources).value, expected);
    assert.equal(energy(reverse.summary.resources).value, expected);
    HistorySummarySchema.parse(forward.summary);
  });
}

test("new sums fail explicitly on overflow or unrepresentable exact precision", async () => {
  const record = message();
  const base = energy(historicalResources(await estimate(record), record));
  for (const values of [
    ["1e308", "1e308"],
    ["1e308", "1e-300"],
  ]) {
    const total = new HistoryAccumulator();
    total.add(record, { estimate: [scalar(base, values[0]!)] });
    assert.throws(
      () => total.add(record, { estimate: [scalar(base, values[1]!)] }),
      /estimate_unavailable/,
    );
  }
});

test("conflicted and proven-overlap history does not publish new resource rows", async () => {
  const record = message();
  const rows = historicalResources(await estimate(record), record);
  for (const flags of [{ conflict: true }, { overlap: true }]) {
    const total = new HistoryAccumulator();
    total.add(record, { ...flags, estimate: rows });
    assert.deepEqual(total.summary.resources, []);
    assert.equal(total.summary.schema_version, "3.0.0");
    assert.equal(total.summary.response_count, "0");
    HistorySummarySchema.parse(total.summary);
  }
});

test("malformed v2 scope and phase cannot enter a historical aggregate", async () => {
  const record = message();
  const base = energy(historicalResources(await estimate(record), record));
  for (const altered of [
    { ...base, phase: "embodied" },
    { ...base, scope: "modeled_text_component" },
  ]) {
    const total = new HistoryAccumulator();
    assert.throws(() =>
      total.add(record, { estimate: [altered as HistoricalResourceV2] }),
    );
  }
});

test("history Perplexity records use the benchmark or a direct vendor profile", async () => {
  const result = await estimate(
    message({ site: "perplexity", model_id: null }),
  );
  assert.equal(result.selection.kind, "provider_flagship");
  assert.equal(result.selection.profile?.model_name, "gpt-6.1-sol");
  assert.equal(result.selection.basis, "model_not_named");
  assert.equal(result.effective_method.engine_id, "ecologits");
  assert.notEqual(result.metrics.water_total.value, null);
  const record = message({
    site: "perplexity",
    model_id: "perplexity-claude-sonnet-5",
  });
  const proxied = await estimate(record);
  assert.equal(proxied.selection.kind, "direct_mapping");
  assert.equal(proxied.selection.profile?.provider, "anthropic");
  assert.equal(proxied.selection.profile?.model_name, "claude-sonnet-5");
  for (const row of historicalResources(proxied, record))
    assert.equal(row.profile_selection, "direct_mapping");
});
