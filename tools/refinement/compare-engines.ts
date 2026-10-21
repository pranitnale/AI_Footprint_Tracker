import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EngineBuildConfigurationSchema,
  EstimationEnvelopeSchema,
  MediaPolicySchema,
  ModelMappingsSchema,
  payloadHash,
  type EngineBuildConfiguration,
  type EstimationEnvelope,
  type ProductMetric,
} from "../../packages/contracts/src/index";
import {
  BASELINE_BUNDLE,
  createMethodRegistry,
  LocalEstimateExecutor,
} from "../../packages/estimator/src/index";
import { D } from "../../packages/estimator/src/numeric";
import {
  buildObservation,
  parseComparisonFixtures,
} from "./comparison-fixtures";
import {
  CONTROLLED_PROTOCOL,
  controlledComparison,
} from "./controlled-comparison";

const root = resolve(import.meta.dirname, "../..");
const quantities = [
  "energy",
  "carbon",
  "water_direct",
  "water_upstream",
  "water_total",
] as const;
type Quantity = (typeof quantities)[number];
const hash = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");
export interface MetricDelta {
  unit: ProductMetric["unit"];
  signed_delta: string | null;
  absolute_delta: string | null;
  relative_delta: string | null;
  reason:
    | "reference_unavailable"
    | "candidate_unavailable"
    | "incompatible_scope"
    | "zero_reference_value"
    | null;
  basis: "displayed_operational_value";
}
/** Decimal arithmetic keeps original-engine values out of binary64 while computing report deltas. */
export function metricDelta(
  reference: ProductMetric,
  candidate: ProductMetric,
  comparable = true,
): MetricDelta {
  const absent = (reason: MetricDelta["reason"]): MetricDelta => ({
    unit: reference.unit,
    signed_delta: null,
    absolute_delta: null,
    relative_delta: null,
    reason,
    basis: "displayed_operational_value",
  });
  if (reference.value === null) return absent("reference_unavailable");
  if (candidate.value === null) return absent("candidate_unavailable");
  if (
    !comparable ||
    reference.unit !== candidate.unit ||
    reference.phase !== candidate.phase ||
    reference.scope !== candidate.scope
  )
    return absent("incompatible_scope");
  const baseline = new D(reference.value),
    difference = new D(candidate.value).minus(baseline);
  return {
    unit: reference.unit,
    signed_delta: difference.toString(),
    absolute_delta: difference.abs().toString(),
    relative_delta: baseline.isZero()
      ? null
      : difference.div(baseline).toString(),
    reason: baseline.isZero() ? "zero_reference_value" : null,
    basis: "displayed_operational_value",
  };
}
function comparable(
  a: EstimationEnvelope,
  b: EstimationEnvelope,
  quantity: Quantity,
): boolean {
  const left = a.comparability,
    right = b.comparability;
  if (quantity === "energy")
    return left.energy_boundary === right.energy_boundary;
  if (quantity === "carbon")
    return (
      left.carbon_boundary === right.carbon_boundary &&
      left.carbon_accounting === right.carbon_accounting
    );
  if (quantity === "water_direct")
    return (
      left.water_kind === right.water_kind &&
      left.direct_water_source !== "unknown" &&
      left.direct_water_source === right.direct_water_source
    );
  if (quantity === "water_upstream")
    return (
      left.water_kind === right.water_kind &&
      left.upstream_water_source === right.upstream_water_source
    );
  return (
    left.common_water_scope !== null &&
    left.common_water_scope === right.common_water_scope
  );
}
export interface ComparisonSourceManifest {
  fixture_sha256: string;
  build_sha256: string;
  mappings_sha256: string;
  media_sha256: string;
  citation_sha256: string;
  core_lock_sha256: string;
  retained_source_manifest_sha256: string;
  comparison_sha256: string;
  controlled_comparison_sha256: string;
  original_text_sha256: string;
  original_environment_sha256: string;
}
export async function compareEngines(
  fixturesInput: unknown,
  buildInput: unknown,
  mappingsInput: unknown,
  mediaInput: unknown,
  source: ComparisonSourceManifest,
) {
  const fixtures = parseComparisonFixtures(fixturesInput);
  const build = EngineBuildConfigurationSchema.parse(buildInput);
  const mappings = ModelMappingsSchema.parse(mappingsInput);
  const media = MediaPolicySchema.parse(mediaInput);
  const originalFallback: EngineBuildConfiguration = {
    ...build,
    ecologits_fallback: {
      ...build.ecologits_fallback,
      policy_version: `${build.ecologits_fallback.policy_version.slice(0, 90)}-comparison-original-fallback`,
      provider_defaults: Object.fromEntries(
        Object.keys(build.ecologits_fallback.provider_defaults).map(
          (provider) => [provider, { strategy: "original_engine" as const }],
        ),
      ),
      unknown_provider: { strategy: "original_engine" },
    },
  };
  const variants = [
    { id: "original", request: "original" as const, build },
    { id: "ecologits-configured", request: "ecologits" as const, build },
    {
      id: "ecologits-original-fallback",
      request: "ecologits" as const,
      build: originalFallback,
    },
    ...fixtures.policy_variants.map((variant) => ({
      id: variant.id,
      request: "ecologits" as const,
      build: { ...build, ecologits_fallback: variant.policy },
    })),
  ].map((variant) => {
    const registry = createMethodRegistry(variant.build, mappings, media);
    return {
      ...variant,
      registry,
      executor: new LocalEstimateExecutor(registry),
    };
  });
  const cases = [];
  for (let index = 0; index < fixtures.cases.length; index++) {
    const fixture = fixtures.cases[index],
      observation = buildObservation(fixture, index);
    const observation_hash = payloadHash(observation);
    const runs = [];
    for (const variant of variants) {
      const method =
        variant.request === "original"
          ? variant.registry.original
          : variant.registry.ecologits;
      const result = EstimationEnvelopeSchema.parse(
        await variant.executor.estimate(observation, {
          methodId: method.method_id,
        }),
      );
      runs.push({
        variant_id: variant.id,
        output_hash: payloadHash(result),
        result,
      });
    }
    const reference = runs[0].result;
    cases.push({
      id: fixture.id,
      mode: "native_product_policies" as const,
      fixture,
      observation,
      observation_hash,
      runs,
      deltas: runs.slice(1).map((run) => ({
        reference_variant: "original",
        candidate_variant: run.variant_id,
        metrics: Object.fromEntries(
          quantities.map((quantity) => [
            quantity,
            metricDelta(
              reference.metrics[quantity],
              run.result.metrics[quantity],
              comparable(reference, run.result, quantity),
            ),
          ]),
        ) as Record<Quantity, MetricDelta>,
      })),
    });
    if (payloadHash(observation) !== observation_hash)
      throw new Error("comparison_input_mutated");
  }
  const controlled_cases = fixtures.controlled_cases.map((fixture) => {
    const controlled = controlledComparison(fixture);
    const [original, eco] = controlled.runs;
    return {
      ...controlled,
      deltas:
        original && eco
          ? (Object.fromEntries(
              quantities.map((quantity) => [
                quantity,
                metricDelta(
                  original.metrics[quantity],
                  eco.metrics[quantity],
                  quantity !== "water_direct" && quantity !== "water_total",
                ),
              ]),
            ) as Record<Quantity, MetricDelta>)
          : null,
    };
  });
  return {
    schema_version: "1.1.0",
    report_kind: "offline-engine-comparison",
    fixtures_kind: fixtures.provenance,
    source_manifest: source,
    fixture_payload_hash: payloadHash(fixtures),
    configuration: { build, mappings, media },
    citation: {
      authors: ["Samuel Rincé", "Adrien Banse"],
      year: 2025,
      title: "EcoLogits: Evaluating the Environmental Impacts of Generative AI",
      journal: "Journal of Open Source Software",
      volume: 10,
      issue: 111,
      page: 7471,
      doi: "10.21105/joss.07471",
      url: "https://doi.org/10.21105/joss.07471",
    },
    disclosures: [
      "Synthetic numeric observations only. No text was read or retokenized; language tags do not alter the supplied counts.",
      "Reference estimates are not physical measurements or calibrated consumer-model claims.",
      "Operational usage values are compared under each engine's native profile/environment policy. This is not a controlled hardware or region experiment.",
      "Separate controlled mathematical cases use the same explicit scalar profile, output count, regression/hardware settings and environmental factors in the existing cores. They are offline arithmetic exercises, not product method results or provider measurements.",
      "Deltas compare displayed scalar values or labeled midpoints, not probability distributions or corresponding physical interval endpoints.",
      "Unknown water source categories and incompatible scopes remain explicit; no unavailable value is converted to zero.",
      "Original fallback policy applies after eligible direct mappings and explicit model overrides; it does not forcibly replace every direct result.",
    ],
    methods: variants.map((variant) => ({
      variant_id: variant.id,
      requested_engine: variant.request,
      original: variant.registry.original,
      ecologits: variant.registry.ecologits,
      ecologits_definition: variant.registry.ecoDefinition,
      original_source: BASELINE_BUNDLE.provenance,
      original_environment: BASELINE_BUNDLE.scenario,
    })),
    cases,
    controlled_protocol: CONTROLLED_PROTOCOL,
    controlled_cases,
  };
}
export type EngineComparisonReport = Awaited<ReturnType<typeof compareEngines>>;
const cell = (value: unknown) =>
  String(value ?? "Unavailable")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
function valueLabel(metric: ProductMetric): string {
  if (metric.value === null)
    return `Unavailable (${metric.reasons.join(", ")})`;
  return metric.value_kind === "midpoint"
    ? `${metric.value} (midpoint; ${metric.scenario_low} to ${metric.scenario_high})`
    : metric.value;
}
function rawValue(value: string | { min: string; max: string }): string {
  return typeof value === "string" ? value : `[${value.min}, ${value.max}]`;
}
export function comparisonMarkdown(report: EngineComparisonReport): string {
  const lines = [
    "# Offline engine comparison",
    "",
    ...report.disclosures.map((value) => `- ${value}`),
    "",
    "EcoLogits is developed by its contributors and is part of CodeCarbon. This tool uses the independent TypeScript port and preserves its source attribution.",
    "",
    `[Rincé and Banse (2025), ${report.citation.title}, JOSS 10(111), 7471](${report.citation.url}).`,
    "",
    "## Comparison overview",
    "",
    `${report.cases.length} native-policy numeric cases across ${report.methods.length} explicit method/policy variants, plus ${report.controlled_cases.length} controlled mathematical cases. Values below use native operational energy; controlled inputs and results follow separately.`,
    "",
    "| Case | Original kWh | Configured EcoLogits kWh | Signed delta kWh | Configured selection |",
    "| --- | --- | --- | --- | --- |",
    ...report.cases.map((item) => {
      const original = item.runs[0].result,
        configured = item.runs.find(
          (run) => run.variant_id === "ecologits-configured",
        )!.result;
      const value = (metric: ProductMetric) =>
        metric.value === null
          ? "Unavailable"
          : metric.value +
            (metric.value_kind === "midpoint" ? " (midpoint)" : "");
      const delta = item.deltas.find(
        (delta) => delta.candidate_variant === "ecologits-configured",
      )!.metrics.energy;
      return `| ${item.id} | ${value(original.metrics.energy)} | ${value(configured.metrics.energy)} | ${cell(delta.signed_delta)} | ${configured.selection.kind} |`;
    }),
    "",
    "## Source manifest",
    "",
    "| Input or artifact | SHA256 |",
    "| --- | --- |",
    ...Object.entries(report.source_manifest).map(
      ([name, value]) => `| ${name} | ${value} |`,
    ),
    "",
    "## Methods and policies",
    "",
  ];
  for (const method of report.methods)
    lines.push(
      `### ${method.variant_id}`,
      "",
      `Requested engine: ${method.requested_engine}. Registry identities:`,
      "",
      `Original: ${method.original.method_id}; hash ${method.original.method_hash}.`,
      "",
      `EcoLogits: ${method.ecologits.method_id}; hash ${method.ecologits.method_hash}.`,
      "",
      `Core ${method.ecologits_definition.core.core_version}; catalog ${method.ecologits_definition.core.catalog_sha256}; source artifact ${method.ecologits_definition.core.source_artifact_sha256}.`,
      "",
      `Fallback policy: ${method.ecologits_definition.fallback.policy_version}. Complete immutable definition is retained in the JSON report.`,
      "",
    );
  for (const item of report.cases) {
    lines.push(
      `## ${item.id}`,
      "",
      `Numeric fixture: ${item.fixture.family}, ${item.fixture.site}, observed model ${item.fixture.model_id ?? "unknown"}, language tag ${item.fixture.language}.`,
      "",
      `Supplied counts: input ${item.fixture.tokens.input ?? "unknown"}; answer ${item.fixture.tokens.answer ?? "unknown"}; output total ${item.fixture.tokens.output_total ?? "unknown"}; visible thinking ${item.fixture.tokens.visible_thinking ?? "unknown"}.`,
      "",
      `Observation hash: ${item.observation_hash}.`,
      "",
    );
    for (const run of item.runs) {
      const result = run.result;
      lines.push(
        `### ${run.variant_id}`,
        "",
        `Status: ${result.status}. Selection: ${result.selection.kind}; profile ${result.selection.profile ? `${result.selection.profile.provider}/${result.selection.profile.model_name}` : "none"}.`,
        "",
        `Requested: ${result.requested_method.method_id} (${result.requested_method.method_hash}).`,
        "",
        `Effective: ${result.effective_method.method_id} (${result.effective_method.method_hash}).`,
        "",
        `Input hash: ${result.input_hash}; output hash: ${run.output_hash}.`,
        "",
        `Reasons: ${result.reasons.join(", ") || "none"}. Missing components: ${result.missing_components.join(", ") || "none"}.`,
        "",
        "| Operational usage quantity | Value | Unit |",
        "| --- | --- | --- |",
        ...quantities.map(
          (quantity) =>
            `| ${quantity} | ${cell(valueLabel(result.metrics[quantity]))} | ${result.metrics[quantity].unit} |`,
        ),
        "",
      );
      if (result.raw?.engine_id === "ecologits") {
        const raw = result.raw.result;
        lines.push(
          "Raw EcoLogits phases (source units and endpoint ranges):",
          "",
          "| Phase | Quantity | Value | Unit |",
          "| --- | --- | --- | --- |",
        );
        for (const [phase, values] of [
          ["usage", raw.usage],
          ["embodied", raw.embodied],
          ["total", raw],
        ] as const) {
          if (values === null) continue;
          for (const key of ["energy", "gwp", "adpe", "pe", "wcf"] as const) {
            const value =
              key in values ? values[key as keyof typeof values] : null;
            if (
              value &&
              typeof value === "object" &&
              "value" in value &&
              "unit" in value
            )
              lines.push(
                `| ${phase} | ${key} | ${rawValue(value.value as string | { min: string; max: string })} | ${value.unit} |`,
              );
          }
        }
        lines.push(
          "",
          `Raw warnings: ${raw.warnings?.map((value) => `${value.code}: ${value.message}`).join("; ") ?? "none"}.`,
          "",
          "Energy and water are usage-only even at the top level. No embodied water or training impact is supplied.",
          "",
        );
      } else if (result.raw?.engine_id === "original") {
        const raw = result.raw.result;
        lines.push(
          `Original raw profile: ${Array.isArray(raw) ? (raw[0]?.selected_profile_id ?? "none") : (raw.selected_profile_id ?? "none")}. Original raw output is retained in JSON; it supplies no embodied phase.`,
          "",
        );
      } else lines.push("Raw result unavailable.", "");
      const delta = item.deltas.find(
        (value) => value.candidate_variant === run.variant_id,
      );
      if (delta)
        lines.push(
          "Deltas from the original displayed operational value:",
          "",
          "| Quantity | Signed delta | Absolute delta | Relative delta | Reason |",
          "| --- | --- | --- | --- | --- |",
          ...quantities.map((quantity) => {
            const value = delta.metrics[quantity];
            return `| ${quantity} | ${cell(value.signed_delta)} | ${cell(value.absolute_delta)} | ${cell(value.relative_delta)} | ${value.reason ?? "none"} |`;
          }),
          "",
        );
    }
  }
  lines.push(
    "## Controlled mathematical inputs",
    "",
    `Protocol: ${report.controlled_protocol.id}. These calls bypass provider/cohort selection and use existing mathematical functions with declared common inputs. They do not create or register a production method.`,
    "",
    ...report.controlled_protocol.exclusions.map((value) => `- ${value}`),
    "",
  );
  for (const item of report.controlled_cases) {
    lines.push(
      `### ${item.id}`,
      "",
      `Status: ${item.status}; reason ${item.reason ?? "none"}. Profile: ${item.shared.profile.id}; active ${item.shared.profile.activeBillions} and total ${item.shared.profile.totalBillions} billion parameters; output ${item.shared.output_tokens} tokens.`,
      "",
      `Environment: ${item.shared.scenario.id}; PUE ${item.shared.scenario.pue}; carbon ${item.shared.scenario.carbon} gCO2e/kWh facility; direct water ${item.shared.scenario.direct_water} L/kWh IT; upstream water ${item.shared.scenario.upstream_water} L/kWh facility.`,
      "",
      `Shared settings: ${JSON.stringify(item.shared.settings)}. Shared regression coefficients: ${JSON.stringify(item.shared.coefficients)}. Timing: regression, no measured cap or TPS/TTFT override.`,
      "",
      `Control hash: ${item.identity.controls_hash}; protocol hash ${item.identity.protocol_hash}; original source bundle ${item.identity.original_bundle_hash}; EcoLogits core ${item.identity.ecologits_core.core_version}. Full input, source identity, intermediates and raw phases remain in JSON.`,
      "",
    );
    if (!item.deltas) continue;
    lines.push(
      "| Operational quantity | Original | EcoLogits | Unit | Signed delta | Absolute delta | Relative delta | Reason |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      ...quantities.map((quantity) => {
        const delta = item.deltas![quantity];
        return `| ${quantity} | ${cell(item.runs[0].metrics[quantity].value)} | ${cell(item.runs[1].metrics[quantity].value)} | ${delta.unit} | ${cell(delta.signed_delta)} | ${cell(delta.absolute_delta)} | ${cell(delta.relative_delta)} | ${delta.reason ?? "none"} |`;
      }),
      "",
      `Output hashes: ${item.runs.map((run) => `${run.engine} ${run.output_hash}`).join("; ")}.`,
      "",
    );
  }
  return lines.join("\n") + "\n";
}
function readJson(path: string): { value: unknown; sha256: string } {
  if (statSync(path).size > 2 * 1024 * 1024)
    throw new Error("comparison_input_too_large");
  const bytes = readFileSync(path);
  return { value: JSON.parse(bytes.toString("utf8")), sha256: hash(bytes) };
}
export async function runComparisonCli(
  args: readonly string[],
): Promise<{ json: string; markdown: string }> {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index],
      value = args[index + 1];
    if (
      ![
        "--fixtures",
        "--output",
        "--build-config",
        "--mappings",
        "--media",
      ].includes(flag) ||
      !value ||
      value.startsWith("--") ||
      values.has(flag)
    )
      throw new Error("comparison_arguments_invalid");
    values.set(flag, value);
  }
  if (!values.has("--fixtures") || !values.has("--output"))
    throw new Error(
      "Supply --fixtures <numeric-fixtures.json> --output <report-prefix>.",
    );
  const fixture = readJson(resolve(values.get("--fixtures")!));
  const build = readJson(
    resolve(
      values.get("--build-config") ?? `${root}/config/estimation.build.json`,
    ),
  );
  const mappings = readJson(
    resolve(
      values.get("--mappings") ?? `${root}/config/estimation.mappings.json`,
    ),
  );
  const media = readJson(
    resolve(values.get("--media") ?? `${root}/config/estimation.media.json`),
  );
  const prefix = resolve(values.get("--output")!),
    json = `${prefix}.json`,
    markdown = `${prefix}.md`;
  if (existsSync(json) || existsSync(markdown))
    throw new Error("comparison_output_exists");
  const report = await compareEngines(
    fixture.value,
    build.value,
    mappings.value,
    media.value,
    {
      fixture_sha256: fixture.sha256,
      build_sha256: build.sha256,
      mappings_sha256: mappings.sha256,
      media_sha256: media.sha256,
      citation_sha256: hash(
        readFileSync(`${root}/packages/ecologits-core/CITATION.cff`),
      ),
      core_lock_sha256: hash(
        readFileSync(`${root}/packages/ecologits-core/upstream/lock.json`),
      ),
      retained_source_manifest_sha256: hash(
        readFileSync(
          `${root}/packages/ecologits-core/upstream/retained-source.json`,
        ),
      ),
      comparison_sha256: hash(
        readFileSync(`${root}/tools/refinement/compare-engines.ts`),
      ),
      controlled_comparison_sha256: hash(
        readFileSync(`${root}/tools/refinement/controlled-comparison.ts`),
      ),
      original_text_sha256: hash(
        readFileSync(`${root}/packages/estimator/src/methods/text.ts`),
      ),
      original_environment_sha256: hash(
        readFileSync(`${root}/packages/estimator/src/methods/environment.ts`),
      ),
    },
  );
  mkdirSync(dirname(prefix), { recursive: true });
  writeFileSync(json, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  writeFileSync(markdown, comparisonMarkdown(report), { flag: "wx" });
  return { json, markdown };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runComparisonCli(process.argv.slice(2))
    .then((result) =>
      process.stdout.write(`Wrote ${result.json} and ${result.markdown}\n`),
    )
    .catch(() => {
      process.stderr.write(
        "Comparison failed. Check explicit numeric fixtures, configuration and new output paths.\n",
      );
      process.exitCode = 1;
    });
}
