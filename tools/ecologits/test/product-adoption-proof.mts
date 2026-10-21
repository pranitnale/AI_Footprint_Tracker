import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  canonicalJson,
  EstimationEnvelopeSchema,
  type ProductMetric,
} from "../../../packages/contracts/src/index.ts";
import { Ledger, type Scope } from "../../../packages/ledger/src/index.ts";
import { records } from "../../../packages/ledger/test/factory.ts";
import { loadLegacyCorpus } from "../../../packages/estimator/test/legacy-corpus.ts";
import { EngineService } from "../../../apps/extension/lib/estimation/service.ts";
import { scanSummary } from "../../../apps/extension/lib/summary-scan.ts";
import type {
  EstimateExecutor,
  MethodRegistry,
  NumericObservationInput,
} from "../../../packages/estimator/src/index.ts";
import { acceptedRelease, runNode } from "./helpers.mjs";

const [beforeRoot, afterRoot, stage, kind] = process.argv.slice(2);
const qualified = kind === "qualified_combination";
const workspace = new URL("../../../", import.meta.url);
const release = await acceptedRelease(fileURLToPath(workspace));
const config = JSON.parse(
  await readFile(new URL("config/estimation.build.json", workspace), "utf8"),
);
const mappings = JSON.parse(
  await readFile(new URL("config/estimation.mappings.json", workspace), "utf8"),
);
const media = JSON.parse(
  await readFile(new URL("config/estimation.media.json", workspace), "utf8"),
);
// The site's catch-all label has no record, binding or override, so before adoption it
// uses the shipped Anthropic flagship. The qualified case binds it to a new record.
const label = "claude-unlisted";
const flagship =
  config.ecologits_fallback.provider_defaults.anthropic.profile.model_name;
const expectedProfile = qualified ? "synthetic-supported-opus" : flagship;
async function runtime(root: string) {
  const base = join(root, "packages/estimator/src");
  const methods = await import(
    pathToFileURL(join(base, "engines/methods.ts")).href
  );
  const executor = await import(
    pathToFileURL(join(base, "engines/service.ts")).href
  );
  const original = await import(pathToFileURL(join(base, "original.ts")).href);
  return { ...methods, ...executor, original };
}
const before = await runtime(beforeRoot);
const methods: MethodRegistry = before.createMethodRegistry(
  { ...config, default_engine: "ecologits" },
  mappings,
  media,
);
const executor = new before.LocalEstimateExecutor(methods);
// The shipped build offers only EcoLogits and retires a saved Original choice. A build that
// still offers the archived Original method shows adoption leaves that choice unchanged.
const originalBuild = {
  ...config,
  default_engine: "ecologits",
  available_engines: ["original", "ecologits"],
};
const originalMethods: MethodRegistry = before.createMethodRegistry(
  originalBuild,
  mappings,
  media,
);
assert.deepEqual(originalMethods.original, methods.original);
const originalExecutor = new before.LocalEstimateExecutor(originalMethods);
const scope: Scope = {
  namespace: "personal:upstream-adoption",
  mode: "personal",
  era: null,
};
const db = await Ledger.open("upstream-product-proof-" + crypto.randomUUID());
const originalDb = await Ledger.open(
  "upstream-original-proof-" + crypto.randomUUID(),
);
const services: EngineService[] = [];
function service(
  registry: MethodRegistry,
  local: EstimateExecutor,
  database = db,
) {
  const value = new EngineService(
    database.estimation,
    registry,
    local,
    async () => ({
      scope,
      token: "same-installation",
      current: async () => {},
    }),
  );
  services.push(value);
  return value;
}
try {
  for (const database of [db, originalDb])
    await database.policyTransaction([
      { key: "personal", namespace: scope.namespace, secret: "a".repeat(64) },
      {
        key: "ownership-history",
        eras: [
          {
            scope,
            secret: "a".repeat(64),
            policyVersion: "1.0.0",
            start: 0,
            end: null,
          },
        ],
      },
    ]);
  const oldService = service(methods, executor);
  const [request, attempt] = records();
  request.model_id = attempt.model_id = label;
  request.model_evidence = attempt.model_evidence = "response_field";
  attempt.proposed_method_id = (await oldService.admission()).method_id;
  const input: NumericObservationInput = { family: "live", request, attempt };
  const original = await executor.estimate(input);
  assert.equal(original.status, "estimated");
  assert.equal(original.selection.kind, "provider_flagship");
  assert.equal(original.selection.profile?.model_name, flagship);
  await db.capture(scope, [request, attempt], [original]);
  await oldService.maintainLocal();
  const archivedBytes = canonicalJson(await db.all("estimation_originals"));
  const observedBytes = canonicalJson(await db.all("measurements"));
  const oldPreference = await db.estimation.readPreference();
  oldService.dispose();
  const frozenInput = structuredClone(input);
  frozenInput.attempt.proposed_method_id = methods.original.method_id;
  const frozenResult = canonicalJson(await executor.estimate(frozenInput));
  const oldOriginalService = service(
    originalMethods,
    originalExecutor,
    originalDb,
  );
  await oldOriginalService.select({
    preference: "original",
    expectedRevision: (await oldOriginalService.status()).selectionRevision,
  });
  await originalDb.capture(
    scope,
    [frozenInput.request, frozenInput.attempt],
    [await originalExecutor.estimate(frozenInput)],
  );
  await oldOriginalService.maintainLocal();
  const originalPreference = canonicalJson(
    await originalDb.estimation.readPreference(),
  );
  const originalArchive = canonicalJson(
    await originalDb.all("estimation_originals"),
  );
  const originalMeasurements = canonicalJson(
    await originalDb.all("measurements"),
  );
  oldOriginalService.dispose();
  const baseline = await readFile(
    join(afterRoot, "packages/estimator/data/baseline.json"),
  );
  const frozenLegacy = await readFile(
    join(afterRoot, "packages/estimator/test/fixtures/legacy-refinement.json"),
  );

  const adopted = runNode(
    fileURLToPath(workspace),
    fileURLToPath(new URL("tools/ecologits/adopt.mjs", workspace)),
    ["--stage", stage, "--target-root", afterRoot],
  );
  assert.equal(adopted.status, 0, `${adopted.stdout}${adopted.stderr}`);
  const converter = spawnSync(
    "uv",
    [
      "run",
      "--project",
      join(afterRoot, "packages/ecologits-core/oracle"),
      "--frozen",
      "--offline",
      "python",
      join(afterRoot, "packages/ecologits-core/tools/generate_catalog.py"),
      "--check",
    ],
    { cwd: fileURLToPath(workspace), encoding: "utf8", timeout: 60_000 },
  );
  assert.equal(converter.status, 0, `${converter.stdout}${converter.stderr}`);
  const adoptedLock = JSON.parse(
    await readFile(
      join(afterRoot, "packages/ecologits-core/upstream/lock.json"),
      "utf8",
    ),
  );
  assert.equal(adoptedLock.release_kind, kind);
  assert.equal(
    adoptedLock.catalog_commit,
    qualified ? "b".repeat(40) : adoptedLock.core_commit,
  );
  assert.equal(adoptedLock.core_commit, release.commit);
  assert.equal(
    adoptedLock.snapshot_directory,
    qualified
      ? `ecologits-${release.version}-qualified-product-adoption-proof`
      : `ecologits-${release.version}`,
  );

  const after = await runtime(afterRoot);
  const directMappings = structuredClone(mappings);
  if (qualified)
    directMappings.bindings[label] = {
      provider: "anthropic",
      model_name: "synthetic-supported-opus",
      workload: "text",
    };
  await writeFile(
    join(afterRoot, "config/estimation.mappings.json"),
    JSON.stringify(directMappings),
  );
  const nextMethods: MethodRegistry = after.createMethodRegistry(
    { ...config, default_engine: "ecologits" },
    directMappings,
    media,
  );
  const nextExecutor = new after.LocalEstimateExecutor(nextMethods);
  if (qualified) {
    assert.notEqual(
      nextMethods.ecologits.catalog_hash,
      methods.ecologits.catalog_hash,
    );
    assert.notEqual(
      nextMethods.ecologits.method_hash,
      methods.ecologits.method_hash,
    );
  } else {
    assert.equal(
      nextMethods.ecologits.catalog_hash,
      methods.ecologits.catalog_hash,
    );
    assert.equal(
      nextMethods.ecologits.method_hash,
      methods.ecologits.method_hash,
    );
  }
  assert.deepEqual(nextMethods.original, methods.original);
  assert.deepEqual(
    await readFile(join(afterRoot, "packages/estimator/data/baseline.json")),
    baseline,
  );
  assert.deepEqual(
    await readFile(
      join(
        afterRoot,
        "packages/estimator/test/fixtures/legacy-refinement.json",
      ),
    ),
    frozenLegacy,
  );
  assert.equal(
    canonicalJson(await nextExecutor.estimate(frozenInput)),
    frozenResult,
  );
  // The frozen corpus keeps its 2.0.0 records; the shared loader upgrades them to the
  // current observation schema without changing any recorded Original output.
  const legacy = loadLegacyCorpus();
  const nextOriginalMethods: MethodRegistry = after.createMethodRegistry(
    originalBuild,
    directMappings,
    media,
  );
  const preservedOriginalService = service(
    nextOriginalMethods,
    new after.LocalEstimateExecutor(nextOriginalMethods),
    originalDb,
  );
  await preservedOriginalService.maintainLocal();
  assert.equal(
    (await preservedOriginalService.status()).effectiveEngine,
    "original",
  );
  assert.equal(
    (await preservedOriginalService.admission()).method_hash,
    methods.original.method_hash,
  );
  const originalView = await preservedOriginalService.view(scope);
  assert.equal(originalView.pending, false);
  assert.equal(
    (await originalView.estimate(frozenInput))?.effective_method.method_hash,
    methods.original.method_hash,
  );
  assert.equal(
    canonicalJson(await originalDb.estimation.readPreference()),
    originalPreference,
  );
  assert.equal(
    canonicalJson(await originalDb.all("estimation_originals")),
    originalArchive,
  );
  assert.equal(
    canonicalJson(await originalDb.all("measurements")),
    originalMeasurements,
  );
  for (const row of legacy.live)
    assert.equal(
      canonicalJson(after.original.estimateAttempt(row.observation)),
      canonicalJson(row.expected),
      row.name,
    );
  for (const row of legacy.history)
    assert.equal(
      canonicalJson(after.original.estimateHistoricalText(row.observation)),
      canonicalJson(row.expected),
      row.name,
    );
  const nextService = service(nextMethods, nextExecutor);
  assert.deepEqual(await db.estimation.readPreference(), oldPreference);
  await nextService.maintainLocal();
  const selected = await nextService.view(scope);
  assert.equal(selected.pending, false);
  assert.equal(selected.view, "recalculated");
  assert.equal(selected.method?.method_hash, nextMethods.ecologits.method_hash);
  const recalculated = await selected.estimate(input);
  assert.ok(recalculated);
  assert.equal(
    recalculated?.selection.kind,
    qualified ? "direct_mapping" : "provider_flagship",
  );
  assert.equal(recalculated?.selection.profile?.model_name, expectedProfile);
  assert.equal(
    recalculated?.original_method_hash,
    methods.ecologits.method_hash,
  );
  if (qualified)
    assert.notEqual(
      recalculated.metrics.energy.value,
      original.metrics.energy.value,
    );
  else
    assert.equal(
      recalculated.metrics.energy.value,
      original.metrics.energy.value,
    );
  await selected.current();
  const summary = await scanSummary(
    db,
    scope.namespace,
    { calculationView: selected.view },
    undefined,
    false,
    undefined,
    (currentAttempt, _original, currentRequest) =>
      selected.estimate({
        family: "live",
        request: currentRequest!,
        attempt: currentAttempt,
      }),
  );
  assert.ok(summary.estimate && "requested_method" in summary.estimate);
  assert.equal(
    summary.estimate.requested_method.method_hash,
    nextMethods.ecologits.method_hash,
  );
  assert.equal(
    canonicalJson(await db.all("estimation_originals")),
    archivedBytes,
  );
  assert.equal(canonicalJson(await db.all("measurements")), observedBytes);
  assert.deepEqual(
    (await db.estimation.viewPage({ scope, view: "original" })).rows[0].result,
    original,
  );

  const overrideConfig = structuredClone(config);
  overrideConfig.ecologits_fallback.model_overrides[label] = {
    strategy: "upstream_profile",
    profile: {
      provider: "anthropic",
      model_name: "claude-opus-4-8",
      workload: "text",
    },
    basis: "nearest_record",
  };
  const overrideMethods = after.createMethodRegistry(
    overrideConfig,
    directMappings,
    media,
  );
  const overridden = await new after.LocalEstimateExecutor(
    overrideMethods,
  ).estimate(input, {
    methodId: overrideMethods.ecologits.method_id,
    view: "recalculated",
    originalMethodHash: methods.ecologits.method_hash,
  });
  assert.equal(overridden.selection.kind, "model_override");
  assert.equal(overridden.selection.profile.model_name, "claude-opus-4-8");
  const native = spawnSync(
    "uv",
    [
      "run",
      "--project",
      fileURLToPath(new URL("apps/server", workspace)),
      "--frozen",
      "--offline",
      "python",
      fileURLToPath(new URL("./product-adoption-native.py", import.meta.url)),
      afterRoot,
      fileURLToPath(workspace),
    ],
    {
      input: JSON.stringify({
        input,
        original_method_hash: methods.ecologits.method_hash,
      }),
      encoding: "utf8",
      timeout: 60_000,
    },
  );
  assert.equal(native.status, 0, `${native.stdout}${native.stderr}`);
  const nativeResult = EstimationEnvelopeSchema.parse(
    JSON.parse(native.stdout),
  );
  assert.equal(nativeResult.status, "estimated");
  assert.equal(
    nativeResult.selection.kind,
    qualified ? "direct_mapping" : "provider_flagship",
  );
  assert.equal(nativeResult.selection.profile?.model_name, expectedProfile);
  assert.equal(
    nativeResult.requested_method.method_hash,
    nextMethods.ecologits.method_hash,
  );
  assert.equal(
    nativeResult.original_method_hash,
    methods.ecologits.method_hash,
  );
  for (const quantity of Object.keys(recalculated.metrics) as Array<
    keyof typeof recalculated.metrics
  >) {
    const expected: ProductMetric = recalculated.metrics[quantity];
    const actual = nativeResult.metrics[quantity];
    assert.deepEqual(
      { ...actual, value: null, scenario_low: null, scenario_high: null },
      { ...expected, value: null, scenario_low: null, scenario_high: null },
    );
    for (const field of ["value", "scenario_low", "scenario_high"] as const) {
      if (expected[field] === null) assert.equal(actual[field], null);
      else {
        assert.notEqual(actual[field], null);
        const value = Number(expected[field]);
        assert.ok(
          Math.abs(Number(actual[field]) - value) <=
            Math.max(1e-16, Math.abs(value) * 1e-10),
          `${quantity}.${field}: native ${actual[field]}, TypeScript ${expected[field]}`,
        );
      }
    }
  }
  console.log(
    JSON.stringify({
      criteria: ["RL16", "RL23"],
      release_kind: kind,
      direct_model: recalculated.selection.profile.model_name,
      old_method: methods.ecologits.method_hash,
      new_method: nextMethods.ecologits.method_hash,
      original_method: nextMethods.original.method_hash,
      original_unchanged: true,
      converter_check: "passed",
      native_direct_mapping: "passed",
      native_metrics_parity: "passed",
      legacy_cases: legacy.live.length + legacy.history.length,
    }),
  );
} finally {
  services.forEach((value) => value.dispose());
  db.close();
  originalDb.close();
}
