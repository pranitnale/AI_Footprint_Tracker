import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  payloadHash,
  type EngineMethodIdentity,
  type EstimationEnvelope,
  type HistorySummary,
} from "@footprint/contracts";
import {
  LocalEstimateExecutor,
  createMethodRegistry,
} from "@footprint/estimator";
import { Ledger } from "@footprint/ledger";
import { formatMetric } from "@footprint/ui/formatters";
import { records } from "../../../packages/ledger/test/factory";
import configuration from "../../../config/estimation.build.json";
import mappings from "../../../config/estimation.mappings.json";
import media from "../../../config/estimation.media.json";
import { scanSummary } from "../lib/summary-scan";
import { sumFixed, summarize } from "../lib/summary";
import { conversationBar } from "../lib/conversation-bar";
import { metricValue } from "../lib/dashboard/metric-presentation";
import { resourceProvenance } from "../lib/dashboard/resource-presentation";
import { validatedLocalSummary } from "../lib/dashboard/summary-validators";
import {
  combinedUsage,
  methodReleasesNote,
} from "../lib/history-presentation";
import { usageFigures } from "../lib/ui/usage-figures";

// Every extension build that changes the model mappings, stand-ins or media coefficients is a new
// EcoLogits method id with the same core, catalog and environment policy (13 and 14 October 2026
// had four). A chat or period across such an update must add up on the bar, in Details, in the
// popup and on the dashboard, as the organization totals do since 14 October 2026.
const methods = createMethodRegistry(configuration, mappings, media);
const executor = new LocalEstimateExecutor(methods);
// A later build whose mappings file changed: a new method id and hash in the same family.
const laterMethods = createMethodRegistry(
  configuration,
  { ...mappings, review_date: "2099-12-31" },
  media,
);
const laterExecutor = new LocalEstimateExecutor(laterMethods);
const row = (record: ReturnType<typeof records>[number]) => ({
  key: `${record.kind}:${"attempt_id" in record ? record.attempt_id : record.request_id}`,
  namespace: "personal:method-releases",
  era: null,
  record,
  hash: payloadHash(record),
});

function observation() {
  const [request, attempt] = records();
  request.site = "claude";
  request.model_id = attempt.model_id = "claude-opus-4-8";
  request.model_evidence = attempt.model_evidence = "response_field";
  return { request, attempt };
}

/** The same estimate as if a later build with other model mappings had made it. */
function nextRelease(
  estimate: EstimationEnvelope,
  hash: string,
  changes: Partial<EngineMethodIdentity> = {},
): EstimationEnvelope {
  const method = (identity: EngineMethodIdentity) => ({
    ...identity,
    method_id: `${identity.method_id.slice(0, 100)}-next`,
    method_hash: hash.repeat(64),
    profile_policy_hash: hash.repeat(64),
    ...changes,
  });
  return {
    ...estimate,
    requested_method: method(estimate.requested_method),
    effective_method: method(estimate.effective_method),
  };
}

/** Two replies, the second estimated by the later build, or by a changed identity when given. */
async function twoReleases(changes?: Partial<EngineMethodIdentity>) {
  const inputs = [observation(), observation()];
  const first = await executor.estimate(
    { family: "live", ...inputs[0]! },
    { methodId: methods.ecologits.method_id },
  );
  const second = changes
    ? nextRelease(
        await executor.estimate(
          { family: "live", ...inputs[1]! },
          { methodId: methods.ecologits.method_id },
        ),
        "e",
        changes,
      )
    : await laterExecutor.estimate(
        { family: "live", ...inputs[1]! },
        { methodId: laterMethods.ecologits.method_id },
      );
  const estimates = [first, second];
  const rows = inputs.flatMap((input) => [
    row(input.request),
    row(input.attempt),
  ]);
  return { inputs, estimates, rows };
}

test("a chat spanning two releases of one method shows its summed figures on the bar", async () => {
  const { inputs, estimates, rows } = await twoReleases();
  assert.notEqual(
    estimates[0]!.requested_method.method_hash,
    estimates[1]!.requested_method.method_hash,
  );
  const local = summarize(rows, estimates);
  const db = await Ledger.open(`method-releases-${crypto.randomUUID()}`);
  const scope = {
    namespace: "personal:method-releases",
    mode: "personal" as const,
    era: null,
  };
  try {
    for (const [index, input] of inputs.entries())
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
        const key = name === "water" ? "water_total" : name;
        assert.equal(metric.groups.length, 1, name);
        assert.equal(metric.reason, null, name);
        assert.equal(
          metric.value,
          sumFixed(estimates.map((estimate) => estimate.metrics[key].value!)),
          name,
        );
        assert.equal(
          (metric.groups[0] as { method_releases?: string[] }).method_releases
            ?.length,
          2,
          name,
        );
      }
  } finally {
    db.close();
  }
  // The bar shows figures, never "See Details", for a chat across an extension update.
  const bar = conversationBar(local, { failure: false }).text;
  assert.doesNotMatch(bar, /See Details/);
  assert.match(
    bar,
    new RegExp(
      `Electricity ${formatMetric(local.metrics.energy.value, "kWh").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    ),
  );
  // The popup's Me view and the dashboard read the same totals.
  const figures = usageFigures(validatedLocalSummary(local), null, "midpoint");
  assert.equal(figures.energy.multiple, false);
  assert.notEqual(figures.energy.value, null);
  assert.notEqual(figures.energy.text, "See Details");
  // Details says the figure combines two releases instead of naming one of their hashes.
  const group = local.metrics.energy.groups[0]!;
  const provenance = resourceProvenance(group as never, group.unit);
  assert.match(provenance, /Combines estimates from 2 extension releases/);
  assert.doesNotMatch(provenance, /Hash /);
  assert.match(
    methodReleasesNote(local.metrics.energy, null) ?? "",
    /2 extension releases/,
  );
  // The dashboard's validator keeps the release list to bounded strings.
  const malformed = structuredClone(local) as typeof local;
  (malformed.metrics.energy.groups[0] as { method_releases?: unknown })
    .method_releases = [1];
  assert.throws(() => validatedLocalSummary(malformed));
});

test("one release keeps its method name and hash in Details and has no release note", async () => {
  const inputs = [observation(), observation()];
  const estimates = await Promise.all(
    inputs.map((input) =>
      executor.estimate(
        { family: "live", ...input },
        { methodId: methods.ecologits.method_id },
      ),
    ),
  );
  const local = summarize(
    inputs.flatMap((input) => [row(input.request), row(input.attempt)]),
    estimates,
  );
  const group = local.metrics.energy.groups[0]!;
  assert.equal(
    (group as { method_releases?: string[] }).method_releases?.length,
    1,
  );
  assert.match(resourceProvenance(group as never, group.unit), /Hash /);
  assert.equal(methodReleasesNote(local.metrics.energy, null), null);
});

test("another EcoLogits catalog, environment policy or engine still stays apart", async () => {
  for (const changes of [
    { catalog_hash: "9".repeat(64) },
    { environment_policy_hash: "9".repeat(64) },
    { source_version: "0.12.0" },
    { engine_id: "original" as const },
  ]) {
    const { estimates, rows } = await twoReleases(changes);
    const local = summarize(rows, estimates);
    assert.equal(local.metrics.energy.groups.length, 2, JSON.stringify(changes));
    assert.equal(local.metrics.energy.value, null, JSON.stringify(changes));
    assert.match(
      conversationBar(local, { failure: false }).text,
      /Electricity Unknown|See Details/,
    );
  }
});

test("live figures and saved history from another release of the family add, and Details counts them", async () => {
  const { estimates, rows } = await twoReleases();
  const local = summarize(rows, estimates);
  const energy = estimates[0]!.metrics.energy;
  const third = nextRelease(estimates[0]!, "d");
  const saved: HistorySummary = {
    schema_version: "3.0.0",
    status: "available",
    branch_scope: "complete",
    first_request_verified: true,
    observed_prompt_count: "1",
    observed_response_count: "1",
    prompt_count: "1",
    response_count: "1",
    dated_message_count: "2",
    undated_message_count: "0",
    matched_live_message_count: "0",
    unresolved_overlap_message_count: "0",
    conflicting_message_count: "0",
    calculated_message_count: "1",
    uncalculated_message_count: "0",
    tokens: [],
    resources: [
      {
        quantity: "energy",
        scope: "modeled_text_component",
        unit: "kWh",
        phase: "usage",
        value: energy.value,
        value_kind: energy.value_kind,
        scenario_low: energy.scenario_low,
        scenario_high: energy.scenario_high,
        interval_kind: null,
        known_message_count: "1",
        unknown_message_count: "0",
        requested_method: third.requested_method,
        effective_method: third.effective_method,
        comparability: third.comparability,
      },
    ],
    file_text: [],
    file_text_coverage: {
      observed_message_count: "0",
      unknown_message_count: "0",
      scope: "extracted_file_text",
      additive: false,
    },
  } as unknown as HistorySummary;
  const view = {
    local: saved,
    pending: null,
    server: null,
    server_status: "personal",
    coverage: "partial_loaded_history",
  } as never;
  const combined = combinedUsage(local as never, view, "midpoint")!;
  assert.equal(combined.energy.multiple, false);
  assert.equal(
    combined.energy.value,
    sumFixed([local.metrics.energy.value!, energy.value!]),
  );
  assert.equal(combined.energy.methodReleases, 3);
  assert.match(
    methodReleasesNote(local.metrics.energy, combined) ?? "",
    /3 extension releases/,
  );
});

test("synced series of two releases name both in the provenance Details shows", async () => {
  const { estimates } = await twoReleases();
  const series = estimates.map((estimate) => ({
    quantity: "energy",
    scope: "modeled_text_component",
    unit: "kWh",
    value: estimate.metrics.energy.value,
    value_kind: estimate.metrics.energy.value_kind,
    scenario_low: estimate.metrics.energy.scenario_low,
    scenario_high: estimate.metrics.energy.scenario_high,
    method_group: {
      requested_method: estimate.requested_method,
      effective_method: estimate.effective_method,
      comparability: estimate.comparability,
    },
  }));
  const figure = metricValue(
    { request_count: "2", resources: series } as never,
    "energy",
  );
  assert.equal(figure.multiple, false);
  assert.equal(figure.provenance.method_releases?.length, 2);
  assert.match(
    resourceProvenance(figure.provenance, "kWh"),
    /Combines estimates from 2 extension releases/,
  );
});
