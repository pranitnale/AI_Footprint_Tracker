import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { payloadHash, type EstimationEnvelope } from "@footprint/contracts";
import {
  BASELINE_METHOD_HASH,
  LocalEstimateExecutor,
  createMethodRegistry,
  estimateAttempt,
} from "@footprint/estimator";
import { Ledger } from "@footprint/ledger";
import { records } from "../../../packages/ledger/test/factory";
import configuration from "../../../config/estimation.build.json";
import mappings from "../../../config/estimation.mappings.json";
import media from "../../../config/estimation.media.json";
import {
  estimateSourceAttemptId,
  estimateSourceRevision,
  groupRange,
  metricLineage,
} from "../lib/estimate-presentation";
import { scanSummary } from "../lib/summary-scan";
import { sumFixed, summarize } from "../lib/summary";
import { conversationBar, localWaterText } from "../lib/conversation-bar";
import {
  resourceProvenance,
  resourceValue,
} from "../lib/dashboard/resource-presentation";
import { formatMetric } from "@footprint/ui/formatters";

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
const row = (record: ReturnType<typeof records>[number]) => ({
  key: `${record.kind}:${"attempt_id" in record ? record.attempt_id : record.request_id}`,
  namespace: "personal:summary-v2",
  era: null,
  record,
  hash: payloadHash(record),
});

function directObservation() {
  const [request, attempt] = records();
  request.site = "claude";
  request.model_id = "claude-opus-4-8";
  request.model_evidence = "response_field";
  attempt.model_id = "claude-opus-4-8";
  attempt.model_evidence = "response_field";
  return { request, attempt };
}

test("unused EcoLogits water components are not missing, and partial figures are never a bar status", async () => {
  const { request, attempt } = directObservation();
  const estimate = await executor.estimate(
    { family: "live", request, attempt },
    { methodId: methods.ecologits.method_id },
  );
  const summary = summarize([row(request), row(attempt)], [estimate]);
  assert.equal(summary.metrics.waterDirect.value, null);
  assert.equal(summary.metrics.waterUpstream.value, null);
  for (const name of ["energy", "carbon", "water"] as const) {
    assert.notEqual(summary.metrics[name].value, null, name);
    assert.equal(summary.metrics[name].unknown, 0, name);
  }
  assert.equal(conversationBar(summary, { failure: false }).status, "Recorded");
  for (const name of ["energy", "carbon", "water"] as const) {
    for (const missing of [{ value: null }, { unknown: 1 }]) {
      const incomplete = {
        ...summary,
        metrics: {
          ...summary.metrics,
          [name]: { ...summary.metrics[name], ...missing },
        },
      };
      // Owner decision, 2 Oct: a partial measurement is explained in Details only.
      assert.equal(
        conversationBar(incomplete, { failure: false }).status,
        "Recorded",
        name,
      );
    }
  }
  const image = { ...summary, images: { ...summary.images, operations: 1 } };
  assert.equal(conversationBar(image, { failure: false }).status, "Recorded");
});

test("version 2 midpoint metrics aggregate as midpoint sums while the example keeps raw ranges", async () => {
  const first = directObservation();
  const second = directObservation();
  const estimates = await Promise.all(
    [first, second].map(({ request, attempt }) =>
      executor.estimate(
        { family: "live", request, attempt },
        { methodId: methods.ecologits.method_id },
      ),
    ),
  );
  const result = summarize(
    [
      row(first.request),
      row(first.attempt),
      row(second.request),
      row(second.attempt),
    ],
    estimates,
  );
  const name = (
    Object.keys(estimates[0]!.metrics) as Array<
      keyof EstimationEnvelope["metrics"]
    >
  ).find((key) => estimates[0]!.metrics[key].value_kind === "midpoint");
  assert.ok(name, "EcoLogits fixture supplies at least one range");
  const summaryName =
    name === "water_direct"
      ? "waterDirect"
      : name === "water_upstream"
        ? "waterUpstream"
        : name === "water_total"
          ? "water"
          : name;
  const metric = result.metrics[summaryName];
  assert.equal(metric.groups.length, 1);
  assert.equal(metric.groups[0]!.known, 2);
  assert.equal(metric.groups[0]!.value_kind, "midpoint_sum");
  // Scenario sums add the same endpoint of every ranged record in the group.
  assert.equal(
    metric.groups[0]!.scenario_low,
    sumFixed(
      estimates.map((estimate) => estimate.metrics[name]!.scenario_low!),
    ),
  );
  assert.equal(
    metric.groups[0]!.scenario_high,
    sumFixed(
      estimates.map((estimate) => estimate.metrics[name]!.scenario_high!),
    ),
  );
  assert.equal(
    (metric.groups[0]! as { interval_kind?: null }).interval_kind,
    null,
  );
  assert.equal(metric.value_kind, "midpoint_sum");
  assert.equal(metric.scenario_low, metric.groups[0]!.scenario_low);
  assert.equal(metric.scenario_high, metric.groups[0]!.scenario_high);
  assert.equal(metric.interval_kind, null);
  assert.ok(Number(metric.scenario_low) <= Number(metric.value));
  assert.ok(Number(metric.value) <= Number(metric.scenario_high));
  assert.equal(
    metric.groups[0]!.value,
    sumFixed(estimates.map((estimate) => estimate.metrics[name]!.value!)),
  );
  assert.equal(result.estimate, estimates[0]);
  assert.equal(result.estimate!.raw, estimates[0]!.raw);
  assert.equal(result.estimate!.raw?.engine_id, "ecologits");
  if (result.estimate!.raw?.engine_id !== "ecologits")
    throw new Error("Expected EcoLogits example");
  assert.ok(result.estimate!.raw.result.usage);
  assert.ok(result.estimate!.raw.result.embodied);
  assert.equal(result.metrics.water.unknown, 0);
  assert.equal(
    result.metrics.water.value,
    sumFixed(estimates.map((estimate) => estimate.metrics.water_total.value!)),
  );
  const waterText = localWaterText(result.metrics);
  assert.match(waterText, /^Water /);
  assert.doesNotMatch(waterText, /Unknown|unavailable|Direct|supply/);
  assert.doesNotMatch(
    resourceProvenance(estimates[0]!, "L"),
    /Direct source|Electricity-supply source/,
  );
  assert.notEqual(result.estimate!.metrics[name]!.scenario_low, null);
  const single = summarize(
    [row(first.request), row(first.attempt)],
    [estimates[0]!],
  );
  assert.equal(
    single.metrics[summaryName].groups[0]!.value_kind,
    "midpoint_sum",
  );
  const one = single.metrics[summaryName];
  assert.equal(
    one.groups[0]!.scenario_low,
    estimates[0]!.metrics[name]!.scenario_low,
  );
  // The default display shows the midpoint; every endpoint stays in the provenance text.
  assert.equal(
    resourceValue(one.value, one.unit, one),
    formatMetric(one.value, one.unit),
  );
  assert.equal(
    resourceValue(one.value, one.unit, one, "minimum"),
    formatMetric(estimates[0]!.metrics[name]!.scenario_low, one.unit),
  );
  assert.equal(
    resourceValue(one.value, one.unit, one, "maximum"),
    formatMetric(estimates[0]!.metrics[name]!.scenario_high, one.unit),
  );
  assert.equal(
    resourceValue(one.value, one.unit, one, "midpoint"),
    formatMetric(one.value, one.unit),
  );
  assert.match(
    resourceProvenance(one, one.unit),
    /Scenario totals: minimum .* midpoint .* maximum .*Shown: midpoint scenario/,
  );
  assert.match(
    resourceProvenance(one, one.unit, "maximum"),
    /Shown: maximum scenario/,
  );
});

test("mixed legacy and version 2 estimates retain distinct complete lineage", async () => {
  const legacyPair = records();
  const legacy = estimateAttempt(legacyPair[1]);
  const fallbackPair = records();
  fallbackPair[0].site = "perplexity";
  fallbackPair[0].model_id = null;
  fallbackPair[1].model_id = null;
  const fallback = await legacyExecutor.estimate(
    {
      family: "live",
      request: fallbackPair[0],
      attempt: fallbackPair[1],
    },
    { methodId: legacyMethods.ecologits.method_id },
  );
  const result = summarize(
    [
      row(legacyPair[0]),
      row(legacyPair[1]),
      row(fallbackPair[0]),
      row(fallbackPair[1]),
    ],
    [legacy, fallback],
  );
  assert.equal(result.metrics.energy.value, null);
  assert.equal(result.metrics.energy.groups.length, 2);
  const legacyLineage = metricLineage(legacy, "energy");
  assert.deepEqual(Object.keys(legacyLineage), [
    "method_id",
    "method_hash",
    "view",
    "scope",
    "unit",
    "starting_energy_boundary",
    "environment_scenario_id",
    "profile_selection",
    "selected_profile_id",
    "cohort_id",
    "cohort_hash",
    "validation_state",
  ]);
  const version2 = result.metrics.energy.groups.find(
    (group) => group.schema_version === "3.0.0",
  )!;
  assert.equal(version2.requested_method!.engine_id, "ecologits");
  assert.equal(version2.effective_method!.engine_id, "original");
  // The profile choice is a detail of each reply, so a group does not name one.
  assert.ok(!("selection" in version2));
  assert.equal(version2.product_scope, "operational-only");
  assert.equal(
    version2.effective_method!.environment_policy_hash,
    fallback.effective_method.environment_policy_hash,
  );
  assert.equal(
    version2.requested_method!.catalog_hash,
    fallback.requested_method.catalog_hash,
  );
});

test("source helpers reject wrong revisions and hashes instead of publishing stale values", async () => {
  const input = directObservation();
  const estimate = await executor.estimate(
    { family: "live", ...input },
    { methodId: methods.ecologits.method_id },
  );
  assert.equal(estimateSourceAttemptId(estimate), input.attempt.attempt_id);
  assert.equal(estimateSourceRevision(estimate), input.attempt.revision);
  for (const changed of [
    { ...estimate, source: { ...estimate.source, attempt_revision: 99 } },
    {
      ...estimate,
      source: { ...estimate.source, attempt_hash: "f".repeat(64) },
    },
    {
      ...estimate,
      source: { ...estimate.source, request_hash: "f".repeat(64) },
    },
  ] as EstimationEnvelope[]) {
    const result = summarize(
      [row(input.request), row(input.attempt)],
      [changed],
    );
    assert.equal(result.metrics.energy.known, 0);
    assert.equal(result.metrics.energy.unknown, 1);
    assert.equal(result.estimate, null);
  }
});

test("scanSummary reads a stored version 2 estimate without a legacy projection", async () => {
  const db = await Ledger.open(`summary-v2-stored-${crypto.randomUUID()}`);
  const scope = {
    namespace: "personal:summary-v2-stored",
    mode: "personal" as const,
    era: null,
  };
  const input = directObservation();
  const estimate = await executor.estimate(
    { family: "live", ...input },
    { methodId: methods.ecologits.method_id },
  );
  await db.commit(
    scope,
    [input.request, input.attempt],
    [
      {
        store: "local_estimates",
        value: {
          key: `current:${scope.namespace}:${input.attempt.attempt_id}`,
          namespace: scope.namespace,
          selection: "current",
          estimate,
        },
      },
    ],
  );
  const result = await scanSummary(db, scope.namespace);
  assert.equal(result.estimate?.schema_version, "3.0.0");
  assert.deepEqual(result.estimate, estimate);
  assert.deepEqual(result.estimate.raw, estimate.raw);
  db.close();
});

test("scanSummary awaits an async selector and permits EcoLogits without a synthetic legacy original", async () => {
  const db = await Ledger.open(`summary-v2-${crypto.randomUUID()}`);
  const scope = {
    namespace: "personal:summary-v2",
    mode: "personal" as const,
    era: null,
  };
  const input = directObservation();
  await db.commit(scope, [input.request, input.attempt]);
  const recalculated = await executor.estimate(
    { family: "live", ...input },
    {
      methodId: methods.ecologits.method_id,
      view: "recalculated",
      originalMethodHash: BASELINE_METHOD_HASH,
    },
  );
  let receivedOriginal: unknown = "not-called";
  let receivedParent: unknown;
  let calls = 0;
  const result = await scanSummary(
    db,
    scope.namespace,
    { calculationView: "recalculated" },
    undefined,
    false,
    undefined,
    async (attempt, original, parent) => {
      await new Promise(setImmediate);
      calls++;
      if (calls === 1) {
        const key = `epoch:${scope.namespace}`;
        const epoch = await db.get<{ version?: number }>(
          "dashboard_cache",
          key,
        );
        await db.put("dashboard_cache", {
          ...epoch,
          key,
          namespace: scope.namespace,
          version: (epoch?.version ?? 0) + 1,
        });
      }
      assert.equal(attempt.attempt_id, input.attempt.attempt_id);
      receivedOriginal = original;
      receivedParent = parent;
      return recalculated;
    },
  );
  assert.equal(receivedOriginal, undefined);
  assert.deepEqual(receivedParent, input.request);
  assert.equal(calls, 2, "epoch change retries the async scan");
  assert.equal(result.estimate, recalculated);
  assert.equal(result.estimate.raw, recalculated.raw);
  db.close();
});

test("D4 a chat with several models has one total in both summary paths", async () => {
  const first = directObservation();
  const second = directObservation();
  second.request.model_id = second.attempt.model_id = "claude-haiku-4-5";
  const estimates = await Promise.all(
    [first, second].map((input) =>
      executor.estimate(
        { family: "live", ...input },
        { methodId: methods.ecologits.method_id },
      ),
    ),
  );
  // The two replies used different records, so their selections differ.
  assert.notDeepEqual(estimates[0]!.selection, estimates[1]!.selection);
  const local = summarize(
    [first, second].flatMap((input) => [row(input.request), row(input.attempt)]),
    estimates,
  );
  const db = await Ledger.open(`summary-v2-models-${crypto.randomUUID()}`);
  const scope = {
    namespace: "personal:summary-v2-models",
    mode: "personal" as const,
    era: null,
  };
  try {
    for (const [index, input] of [first, second].entries())
      await db.commit(
        scope,
        [input.request, input.attempt],
        [
          {
            store: "local_estimates",
            value: {
              key: `current:${scope.namespace}:${input.attempt.attempt_id}`,
              namespace: scope.namespace,
              selection: "current",
              estimate: estimates[index],
            },
          },
        ],
      );
    const scanned = await scanSummary(db, scope.namespace);
    for (const result of [local, scanned])
      for (const name of ["energy", "carbon", "water"] as const) {
        const metric = result.metrics[name];
        assert.equal(metric.groups.length, 1, name);
        assert.equal(metric.known, 2, name);
        assert.equal(
          metric.value,
          sumFixed(
            estimates.map(
              (estimate) =>
                estimate.metrics[name === "water" ? "water_total" : name].value!,
            ),
          ),
          name,
        );
        // A ranged total keeps the endpoint sums for the scenario display.
        if (metric.value_kind === "midpoint_sum") {
          assert.ok(Number(metric.scenario_low) <= Number(metric.value), name);
          assert.ok(Number(metric.value) <= Number(metric.scenario_high), name);
        }
      }
    // Details list each model with the record behind it, in both summary paths (S3.5).
    for (const result of [local, scanned]) {
      const models = result.estimation.lines
        .filter((line) => line.role === "main")
        .map((line) => [line.model, line.basis, line.count])
        .sort();
      assert.deepEqual(models, [
        ["claude-haiku-4-5", "exact_record", 1],
        ["claude-opus-4-8", "exact_record", 1],
      ]);
    }
  } finally {
    db.close();
  }
});

test("D4 ranged and scalar members add endpoint by endpoint", () => {
  const ranged = {
    value: "2",
    scenario_low: "1",
    scenario_high: "3",
  } as unknown as Parameters<typeof groupRange>[0][number];
  const scalar = {
    value: "5",
    scenario_low: null,
    scenario_high: null,
  } as unknown as Parameters<typeof groupRange>[0][number];
  assert.deepEqual(groupRange([ranged, scalar], sumFixed), {
    value_kind: "midpoint_sum",
    scenario_low: "6",
    scenario_high: "8",
  });
  assert.deepEqual(groupRange([scalar, scalar], sumFixed), {
    value_kind: "scalar",
    scenario_low: null,
    scenario_high: null,
  });
});
