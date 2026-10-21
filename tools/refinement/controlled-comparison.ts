import {
  payloadHash,
  type ProductMetric,
} from "../../packages/contracts/src/index";
import {
  admitTokenCount,
  computeLlmImpacts,
  computeLlmImpactsDag,
  LLM_DEFAULTS,
  validateImpacts,
  validateLlmInput,
  type LlmInput,
} from "../../packages/ecologits-core/src/index";
import { ECOLOGITS_IDENTITY } from "../../packages/ecologits-core/src/identity";
import {
  BASELINE_BUNDLE,
  BASELINE_METHOD_HASH,
  ScenarioSchema,
} from "../../packages/estimator/src/bundle";
import { textEnergy } from "../../packages/estimator/src/methods/text";
import { environmentalAllocation } from "../../packages/estimator/src/methods/environment";
import {
  projectImpactValue,
  serializeImpactValue,
  serializeEcoLogitsOutput,
  unavailableMetric,
} from "../../packages/estimator/src/engines/projection";
import { D, type Dec } from "../../packages/estimator/src/numeric";
import type { ControlledCase } from "./comparison-fixtures";

export const CONTROLLED_PROTOCOL = {
  id: "controlled-operational-text-1",
  selection:
    "explicit scalar profile from the immutable original reference cohort",
  timing:
    "shared regression coefficients, no measured-duration cap, no TPS or TTFT override",
  memory:
    "shared precision, 1.2 memory multiplier, GPU capacity and power-of-two allocation",
  output:
    "synthetic output tokens only; zero is a mathematical boundary, not zero physical work",
  quantities:
    "facility energy and lifecycle location-based CO2e; all-source upstream water",
  exclusions: [
    "No consumer-provider mapping, observed architecture or physical hardware equivalence is claimed.",
    "Ranged architectures, models above the legacy 200-billion bound, alternative timing and nontext workloads are outside this common-input protocol.",
    "Original supplies no embodied GWP, ADPe or primary-energy calculation. Raw EcoLogits values remain inspectable without a cross-engine delta.",
    "Direct water has unresolved source coverage; total water scopes are incompatible. Equal factors do not establish common coverage.",
    "EcoLogits-only ADPe and primary-energy factors are synthetic zero placeholders outside compared quantities. Embodied defaults are retained and are not shared original-engine parameters.",
    "Decimal versus binary64 representation, exponential evaluation and operation order remain intentional arithmetic differences.",
  ],
} as const;

function decimalMetric(
  value: Dec | null,
  unit: ProductMetric["unit"],
): ProductMetric {
  return {
    ...unavailableMetric(unit, "modeled_text_component", []),
    value: value?.toString() ?? null,
    status: value === null ? "unavailable" : "partial_estimate",
    value_kind: value === null ? "unavailable" : "scalar",
  };
}

/** Exercise existing cores on their explicit common domain without registering a product method. */
export function controlledComparison(fixture: ControlledCase) {
  const profile = BASELINE_BUNDLE.profiles.find(
    (entry) => entry.id === fixture.profile_id,
  );
  if (!profile || BASELINE_BUNDLE.settings.memoryMultiplier !== "1.2")
    throw new Error("comparison_control_unsupported");
  const baseline = BASELINE_BUNDLE.scenario;
  const scenario = ScenarioSchema.parse(
    fixture.environment === "baseline-reference"
      ? baseline
      : {
          ...baseline,
          id: "synthetic-unity-comparison-1",
          pue: "1",
          carbon: "1000",
          direct_water: "0",
          upstream_water: "1",
          provenance: {
            ...baseline.provenance,
            publisher: "AI Footprint Tracker comparison fixtures",
            title: "Synthetic unit-factor arithmetic scenario",
            url: "https://example.invalid/synthetic-numeric-fixture",
            section:
              "PUE 1; 1 kgCO2e per kWh; direct 0 L per IT kWh; upstream 1 L per facility kWh",
            population:
              "Synthetic arithmetic only; no location, provider or physical observation",
          },
        },
  );
  const c = BASELINE_BUNDLE.coefficients,
    s = BASELINE_BUNDLE.settings;
  const shared = {
    output_tokens: fixture.output_tokens,
    profile,
    coefficients: c,
    settings: s,
    scenario,
    timing: { request_latency: null, tps: null, ttft: null },
    units: {
      parameters: "billion",
      memory: "GB",
      power: "kW",
      time: "seconds",
      carbon: "gCO2e/kWh facility",
      direct_water: "L/kWh IT",
      upstream_water: "L/kWh facility",
    },
  };
  const inputHash = payloadHash(shared);
  const count = admitTokenCount(fixture.output_tokens);
  const identity = {
    protocol_hash: payloadHash(CONTROLLED_PROTOCOL),
    controls_hash: inputHash,
    original_bundle_hash: BASELINE_METHOD_HASH,
    original_equation: BASELINE_BUNDLE.equation_id,
    original_source: BASELINE_BUNDLE.provenance,
    ecologits_core: ECOLOGITS_IDENTITY,
  };
  const base = {
    id: fixture.id,
    fixture,
    mode: "controlled_mathematical_inputs" as const,
    shared,
    identity,
  };
  if (!count.ok)
    return {
      ...base,
      status: "unavailable" as const,
      reason: "numeric_domain_unsupported",
      runs: [],
    };
  const input: LlmInput = {
    ...LLM_DEFAULTS,
    model_active_parameter_count: Number(profile.activeBillions),
    model_total_parameter_count: Number(profile.totalBillions),
    output_token_count: count.value,
    request_latency: null,
    model_quantization_bits: Number(s.precisionBits),
    gpu_memory: Number(s.gpuMemoryGb),
    batch_size: Number(s.batchSize),
    server_power: Number(s.hostPowerKw),
    server_gpu_count: Number(s.serverGpuCount),
    gpu_energy_alpha: Number(c.energyAlpha),
    gpu_energy_beta: Number(c.energyBeta),
    gpu_energy_gamma: Number(c.energyGamma),
    latency_alpha: Number(c.latencyAlpha),
    latency_beta: Number(c.latencyBeta),
    latency_gamma: Number(c.latencyGamma),
    datacenter_pue: Number(scenario.pue),
    datacenter_wue: Number(scenario.direct_water),
    if_electricity_mix_gwp: new D(scenario.carbon!).div(1000).toNumber(),
    if_electricity_mix_wue: Number(scenario.upstream_water),
    if_electricity_mix_adpe: 0,
    if_electricity_mix_pe: 0,
  };
  if (!validateLlmInput(input).ok)
    throw new Error("comparison_control_unsupported");
  const energy = textEnergy(fixture.output_tokens, profile, BASELINE_BUNDLE);
  const allocated = environmentalAllocation(energy.it!, "it", scenario);
  const originalRaw = {
    energy: Object.fromEntries(
      Object.entries(energy).map(([key, value]) => [
        key,
        value?.toString() ?? null,
      ]),
    ),
    environment: Object.fromEntries(
      Object.entries(allocated).map(([key, value]) => [
        key,
        value?.toString() ?? null,
      ]),
    ),
  };
  const original = {
    engine: "original" as const,
    input_hash: inputHash,
    raw: originalRaw,
    metrics: {
      energy: decimalMetric(allocated.facility, "kWh"),
      carbon: decimalMetric(allocated.carbon, "gCO2e"),
      water_direct: decimalMetric(allocated.direct, "L"),
      water_upstream: decimalMetric(allocated.upstream, "L"),
      water_total: unavailableMetric("L", "modeled_text_component", [
        "factor_incompatible",
      ]),
    },
  };
  const impacts = computeLlmImpacts(input);
  const direct = computeLlmImpacts({ ...input, if_electricity_mix_wue: 0 });
  const upstream = computeLlmImpacts({ ...input, datacenter_wue: 0 });
  if (
    ![impacts, direct, upstream].every((result) => validateImpacts(result).ok)
  )
    throw new Error("comparison_result_invalid");
  const dag = computeLlmImpactsDag({ ...input, request_latency: Infinity });
  const eco = {
    engine: "ecologits" as const,
    input_hash: inputHash,
    input: Object.fromEntries(
      Object.entries(input).map(([key, value]) => [
        key,
        value === null ? null : serializeImpactValue(value),
      ]),
    ),
    input_representation:
      "finite binary64 values serialized as decimal strings",
    // Infinity is only the core's internal no-cap sentinel; JSON retains explicit null input above.
    intermediates: Object.fromEntries(
      [
        "model_required_memory",
        "gpu_required_count",
        "generation_latency",
        "gpu_energy",
        "server_energy",
        "request_it_energy",
        "request_energy",
      ].map((key) => [key, serializeImpactValue(dag[key]!)]),
    ),
    raw: serializeEcoLogitsOutput({ ...impacts, warnings: null, errors: null }),
    metrics: {
      energy: projectImpactValue(
        impacts.usage.energy.value,
        "kWh",
        "modeled_text_component",
        [],
      ),
      carbon: projectImpactValue(
        impacts.usage.gwp.value,
        "gCO2e",
        "modeled_text_component",
        [],
        1000,
      ),
      water_direct: projectImpactValue(
        direct.usage.wcf.value,
        "L",
        "modeled_text_component",
        [],
      ),
      water_upstream: projectImpactValue(
        upstream.usage.wcf.value,
        "L",
        "modeled_text_component",
        [],
      ),
      water_total: unavailableMetric("L", "modeled_text_component", [
        "factor_incompatible",
      ]),
    },
  };
  return {
    ...base,
    status: "computed" as const,
    reason: null,
    runs: [
      { ...original, output_hash: payloadHash(original) },
      { ...eco, output_hash: payloadHash(eco) },
    ],
  };
}
