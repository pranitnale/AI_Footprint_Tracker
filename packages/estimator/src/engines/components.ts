import {
  ComponentResultSchema,
  finiteDecimal,
  type ComponentInputs,
  type ComponentResult,
  type EstimateReason,
  type EstimationEnvelope,
  type MediaOutput,
  type ProductMetric,
  type Selection,
  type Site,
  type TimingEvidence,
  type TokenMeasurement,
  type UpstreamProfileReference,
} from "@footprint/contracts";
import type {
  EnvironmentInput,
  ImpactsOutput,
  ValueOrRange,
} from "@footprint/ecologits-core";
import { resolveModelProfile } from "../selection";
import type { EcoLogitsRuntime } from "./ecologits";
import type { MethodRegistry } from "./methods";
import {
  projectImpactValue,
  serializeEcoLogitsOutput,
  unavailableMetric,
} from "./projection";

type Metrics = EstimationEnvelope["metrics"];
type Scope = ProductMetric["scope"];
const METRIC_NAMES = [
  "energy",
  "carbon",
  "water_direct",
  "water_upstream",
  "water_total",
] as const;
const UNITS = {
  energy: "kWh",
  carbon: "gCO2e",
  water_direct: "L",
  water_upstream: "L",
  water_total: "L",
} as const;
export const TEXT_METHOD_ID = "ecologits-llm-0-11";

export function emptyInputs(): ComponentInputs {
  return {
    output_tokens: null,
    latency_seconds: null,
    latency_basis: null,
    environment_provider: null,
    electricity_mix_zone: null,
    units: null,
    width: null,
    height: null,
    duration_seconds: null,
    with_audio: null,
    audio_seconds: null,
    defaults_applied: [],
  };
}

export function unavailableMetrics(
  scope: Scope,
  reasons: readonly EstimateReason[],
): Metrics {
  return {
    energy: unavailableMetric("kWh", scope, reasons),
    carbon: unavailableMetric("gCO2e", scope, reasons),
    water_direct: unavailableMetric("L", scope, ["not_applicable"]),
    water_upstream: unavailableMetric("L", scope, ["not_applicable"]),
    water_total: unavailableMetric("L", scope, reasons),
  };
}

/** Usage-phase figures only, as for text; direct and upstream water stay unused. */
function impactMetrics(
  energy: ValueOrRange,
  gwp: ValueOrRange,
  wcf: ValueOrRange,
  scope: Scope,
  reasons: readonly EstimateReason[],
): Metrics {
  return {
    energy: projectImpactValue(energy, "kWh", scope, reasons),
    carbon: projectImpactValue(gwp, "gCO2e", scope, reasons, 1000),
    water_direct: unavailableMetric("L", scope, ["not_applicable"]),
    water_upstream: unavailableMetric("L", scope, ["not_applicable"]),
    water_total: projectImpactValue(wcf, "L", scope, reasons),
  };
}

function component(value: ComponentResult): ComponentResult {
  return ComponentResultSchema.parse(value);
}

function unavailableComponent(
  base: Pick<ComponentResult, "component_id" | "kind" | "role" | "method_id">,
  selection: Selection | null,
  inputs: ComponentInputs,
  scope: Scope,
  reasons: readonly EstimateReason[],
  raw: ComponentResult["raw"] = null,
): ComponentResult {
  return component({
    ...base,
    selection,
    inputs,
    raw,
    status: "unavailable",
    metrics: unavailableMetrics(scope, reasons),
    reasons: [...new Set(reasons)],
  });
}

/** The EcoLogits data-centre configuration of a provider, with an optional grid override. */
export function providerEnvironment(
  core: EcoLogitsRuntime,
  provider: string,
  zoneOverride: string | null = null,
): { environment: EnvironmentInput; zone: string; warnings: readonly { code: string; message: string }[] } | null {
  const config = Object.hasOwn(core.catalog.provider_configurations, provider)
    ? core.catalog.provider_configurations[provider]
    : undefined;
  if (!config) return null;
  const zone = zoneOverride ?? config.datacenter_location;
  const mix = core.findElectricityMix(zone);
  if (!mix) return null;
  return {
    environment: core.electricityInput(mix, config),
    zone,
    warnings: mix.warnings,
  };
}

type EnvironmentOverride = MethodRegistry["media"]["environment_overrides"][string];

/** The PUE and WUE an override names, as core values; absent factors keep the provider's. */
function overrideFactors(
  override: EnvironmentOverride | null,
): Partial<Pick<EnvironmentInput, "datacenter_pue" | "datacenter_wue">> {
  const factor = (value: string | { min: string; max: string }): ValueOrRange =>
    typeof value === "string"
      ? Number(value)
      : { min: Number(value.min), max: Number(value.max) };
  return {
    ...(override?.datacenter_pue === undefined
      ? {}
      : { datacenter_pue: factor(override.datacenter_pue) }),
    ...(override?.datacenter_wue === undefined
      ? {}
      : { datacenter_wue: factor(override.datacenter_wue) }),
  };
}

function latencyBasis(timing: TimingEvidence | null): ComponentInputs["latency_basis"] {
  if (timing === null) return "modeled";
  if (timing.scope === "research_task") return "research_task";
  return timing.source === "browser_request" ? "measured" : "history";
}

export function textSelection(
  methods: MethodRegistry,
  core: EcoLogitsRuntime,
  modelId: string | null,
  provider: string | null,
): { selection: Selection; failure: EstimateReason | null } {
  const resolution = resolveModelProfile(
    { modelId, provider, workload: "text" },
    methods.mappings.bindings,
    methods.ecoDefinition.fallback,
    {
      has: (profile) =>
        profile.workload === "text" &&
        core.findModel(profile.provider, profile.model_name) !== null,
    },
  );
  if (resolution.kind === "upstream")
    return {
      selection: {
        kind: resolution.selection,
        observed_model_id: modelId,
        profile: resolution.profile,
        reason: resolution.selection === "direct_mapping" ? null : "model_proxy",
        basis: resolution.basis,
      },
      failure: null,
    };
  // A component never switches engines; the original method is only a whole-reply choice.
  const failure: EstimateReason =
    resolution.kind === "original" ? "original_engine_fallback" : resolution.reason;
  return {
    selection: {
      kind: "unavailable",
      observed_model_id: modelId,
      profile: null,
      reason: failure,
      basis: null,
    },
    failure,
  };
}

/** EcoLogits LLM impacts for one text component, with the record's own or an overridden grid, PUE and WUE. */
export function textComponent(
  core: EcoLogitsRuntime,
  methods: MethodRegistry,
  options: {
    componentId: string;
    role: ComponentResult["role"];
    selection: Selection;
    output: TokenMeasurement;
    timing: TimingEvidence | null;
    scope: Scope;
    reasons: readonly EstimateReason[];
  },
): ComponentResult {
  const base = {
    component_id: options.componentId,
    kind: "text" as const,
    role: options.role,
    method_id: TEXT_METHOD_ID,
  };
  const latency =
    options.timing === null ? null : Number(options.timing.duration_seconds);
  const override =
    options.selection.observed_model_id !== null &&
    Object.hasOwn(
      methods.media.environment_overrides,
      options.selection.observed_model_id,
    )
      ? methods.media.environment_overrides[options.selection.observed_model_id]!
      : null;
  const inputs: ComponentInputs = {
    ...emptyInputs(),
    output_tokens: options.output.value,
    latency_seconds: latency === null ? null : finiteDecimal(latency),
    latency_basis: latencyBasis(options.timing),
    environment_provider: options.selection.profile?.provider ?? null,
    electricity_mix_zone: override?.electricity_mix_zone ?? null,
  };
  const reasons = [
    ...options.reasons,
    ...(override ? (["environment_override"] as const) : []),
  ];
  const profile = options.selection.profile;
  if (profile === null)
    return unavailableComponent(base, options.selection, inputs, options.scope, [
      ...reasons,
      options.selection.reason ?? "estimate_unavailable",
    ]);
  if (options.output.value === null || options.output.value === "0")
    return unavailableComponent(base, options.selection, inputs, options.scope, [
      ...reasons,
      "estimate_unavailable",
    ]);
  const count = core.admitTokenCount(options.output.value);
  if (!count.ok)
    return unavailableComponent(base, options.selection, inputs, options.scope, [
      ...reasons,
      "numeric_domain_unsupported",
    ]);
  const lookup = {
    provider: profile.provider,
    model_name: profile.model_name,
    output_token_count: count.value,
    request_latency: latency,
    ...(override ? { electricity_mix_zone: override.electricity_mix_zone } : {}),
  };
  const resolved = core.resolveLlmInput(lookup);
  if (!("input" in resolved))
    return unavailableComponent(
      base,
      options.selection,
      inputs,
      options.scope,
      [...reasons, "source_error"],
      serializeEcoLogitsOutput(resolved),
    );
  const factors = overrideFactors(override);
  const input = { ...resolved.input, ...factors };
  if (!core.validateLlmInput(input).ok)
    return unavailableComponent(base, options.selection, inputs, options.scope, [
      ...reasons,
      "numeric_domain_unsupported",
    ]);
  inputs.electricity_mix_zone = resolved.electricity_mix.zone;
  // core.llmImpacts takes no PUE or WUE, so only a factor override computes the resolved input
  // itself, with the same warnings; every other reply keeps the unchanged upstream call.
  const raw =
    Object.keys(factors).length === 0
      ? core.llmImpacts(lookup)
      : core.output(core.computeLlmImpacts(input), [
          ...resolved.model.warnings,
          ...resolved.electricity_mix.warnings,
        ]);
  return impactComponent(
    base,
    options.selection,
    inputs,
    options.scope,
    reasons,
    raw,
    core,
  );
}

function impactComponent(
  base: Pick<ComponentResult, "component_id" | "kind" | "role" | "method_id">,
  selection: Selection | null,
  inputs: ComponentInputs,
  scope: Scope,
  reasons: readonly EstimateReason[],
  raw: ImpactsOutput,
  core?: EcoLogitsRuntime,
): ComponentResult {
  const validate = core?.validateImpacts;
  if (raw.errors !== null || raw.usage === null || raw.wcf === null)
    return unavailableComponent(
      base,
      selection,
      inputs,
      scope,
      [...reasons, "source_error"],
      serializeEcoLogitsOutput(raw),
    );
  if (validate && !validate(raw).ok)
    return unavailableComponent(base, selection, inputs, scope, [
      ...reasons,
      "source_error",
    ]);
  const finalReasons = [
    ...new Set<EstimateReason>([
      ...reasons,
      ...(raw.warnings?.length ? (["source_warning"] as const) : []),
    ]),
  ];
  return component({
    ...base,
    selection,
    inputs,
    raw: serializeEcoLogitsOutput(raw),
    status: "estimated",
    metrics: impactMetrics(
      raw.usage.energy.value,
      raw.usage.gwp.value,
      raw.wcf.value,
      scope,
      finalReasons,
    ),
    reasons: finalReasons,
  });
}

function imageProvider(
  methods: MethodRegistry,
  site: Site,
  modelId: string | null,
): string | null {
  const image = methods.media.image;
  if (modelId !== null && Object.hasOwn(image.model_providers, modelId))
    return image.model_providers[modelId]!;
  return Object.hasOwn(image.site_providers, site)
    ? image.site_providers[site]!
    : null;
}

/**
 * Generated images: a published IT energy per image times the provider's PUE, with the
 * provider's grid factors and the EcoLogits water rule. Image size is not scaled.
 */
export function imageComponent(
  core: EcoLogitsRuntime,
  methods: MethodRegistry,
  options: {
    componentId: string;
    role: ComponentResult["role"];
    site: Site;
    modelId: string | null;
    count: string;
    width: number | null;
    height: number | null;
    reasons: readonly EstimateReason[];
  },
): ComponentResult {
  const scope = "modeled_image_component";
  const base = {
    component_id: options.componentId,
    kind: "image" as const,
    role: options.role,
    method_id: methods.media.image.method_id,
  };
  const provider = imageProvider(methods, options.site, options.modelId);
  const inputs: ComponentInputs = {
    ...emptyInputs(),
    units: options.count,
    width: options.width,
    height: options.height,
    environment_provider: provider,
  };
  const env = provider === null ? null : providerEnvironment(core, provider);
  if (env === null)
    return unavailableComponent(base, null, inputs, scope, [
      ...options.reasons,
      "factor_unavailable",
    ]);
  inputs.electricity_mix_zone = env.zone;
  const units = Number(options.count);
  if (!Number.isSafeInteger(units) || units < 1)
    return unavailableComponent(base, null, inputs, scope, [
      ...options.reasons,
      "numeric_domain_unsupported",
    ]);
  const itKwh =
    (units * Number(methods.media.image.it_energy_wh_per_image)) / 1000;
  const e = env.environment;
  const energy = core.multiply(e.datacenter_pue, itKwh);
  const gwp = core.multiply(energy, e.if_electricity_mix_gwp);
  const wcf = core.multiply(
    itKwh,
    core.add(e.datacenter_wue, core.multiply(e.datacenter_pue, e.if_electricity_mix_wue)),
  );
  const reasons = [...new Set<EstimateReason>(options.reasons)];
  return component({
    ...base,
    selection: null,
    inputs,
    raw: null,
    status: "estimated",
    metrics: impactMetrics(energy, gwp, wcf, scope, reasons),
    reasons,
  });
}

/**
 * Generated speech: audio tokens at the vendor's documented rate through the EcoLogits
 * gpt-4o-mini-tts record, with the data-centre configuration of the site's provider.
 */
export function speechComponent(
  core: EcoLogitsRuntime,
  methods: MethodRegistry,
  options: {
    componentId: string;
    role: ComponentResult["role"];
    site: Site;
    seconds: number;
    reasons: readonly EstimateReason[];
  },
): ComponentResult {
  const scope = "modeled_speech_component";
  const speech = methods.media.speech;
  const base = {
    component_id: options.componentId,
    kind: "speech" as const,
    role: options.role,
    method_id: speech.method_id,
  };
  const provider = Object.hasOwn(speech.site_providers, options.site)
    ? speech.site_providers[options.site]!
    : null;
  const rate =
    provider !== null && Object.hasOwn(speech.tokens_per_second, provider)
      ? Number(speech.tokens_per_second[provider])
      : null;
  const selection: Selection = {
    kind: "model_override",
    observed_model_id: null,
    profile: { ...speech.profile },
    reason: "model_proxy",
    basis: "model_not_named",
  };
  const reasons: EstimateReason[] = [...options.reasons, "model_proxy"];
  const inputs: ComponentInputs = {
    ...emptyInputs(),
    audio_seconds: finiteDecimal(options.seconds),
    environment_provider: provider,
    latency_basis: "modeled",
  };
  const env = provider === null ? null : providerEnvironment(core, provider);
  if (rate === null || env === null || !(options.seconds > 0))
    return unavailableComponent(base, selection, inputs, scope, [
      ...reasons,
      "factor_unavailable",
    ]);
  inputs.electricity_mix_zone = env.zone;
  // Rounded half up, matching the server; a reply always carries at least one token.
  const tokens = Math.max(1, Math.floor(options.seconds * rate + 0.5));
  inputs.output_tokens = String(tokens);
  const resolved = core.resolveLlmInput({
    provider: speech.profile.provider,
    model_name: speech.profile.model_name,
    output_token_count: tokens,
    request_latency: null,
  });
  if (!("input" in resolved))
    return unavailableComponent(
      base,
      selection,
      inputs,
      scope,
      [...reasons, "source_error"],
      serializeEcoLogitsOutput(resolved),
    );
  const input = { ...resolved.input, ...env.environment };
  if (!core.validateLlmInput(input).ok)
    return unavailableComponent(base, selection, inputs, scope, [
      ...reasons,
      "numeric_domain_unsupported",
    ]);
  const raw = core.output(core.computeLlmImpacts(input), [
    ...resolved.model.warnings,
    ...env.warnings,
  ]);
  return impactComponent(base, selection, inputs, scope, reasons, raw, core);
}

/** EcoLogits video impacts; values the page does not show come from the documented defaults. */
export function videoComponent(
  core: EcoLogitsRuntime,
  methods: MethodRegistry,
  options: {
    componentId: string;
    site: Site;
    item: Extract<MediaOutput, { kind: "video" }>;
    reasons: readonly EstimateReason[];
  },
): ComponentResult {
  const scope = "modeled_video_component";
  const video = methods.media.video;
  const base = {
    component_id: options.componentId,
    kind: "video" as const,
    role: "generated_video" as const,
    method_id: video.method_id,
  };
  // A video the page shows without naming its model uses the site's stand-in model.
  const named = options.item.model_id;
  const modelId =
    named ??
    (Object.hasOwn(video.site_models, options.site)
      ? video.site_models[options.site]!
      : null);
  const resolution = resolveModelProfile(
    { modelId, provider: null, workload: "video" },
    methods.mappings.bindings,
    methods.ecoDefinition.fallback,
    {
      has: (profile) =>
        profile.workload === "video" &&
        core.findVideoModel(profile.model_name)?.provider === profile.provider,
    },
  );
  const inputs: ComponentInputs = { ...emptyInputs() };
  if (resolution.kind !== "upstream")
    return unavailableComponent(
      base,
      {
        kind: "unavailable",
        observed_model_id: named,
        profile: null,
        reason: resolution.kind === "original" ? "original_engine_fallback" : resolution.reason,
        basis: null,
      },
      inputs,
      scope,
      [...options.reasons, "estimate_unavailable"],
    );
  const profile: UpstreamProfileReference = resolution.profile;
  const selection: Selection = {
    kind: resolution.selection,
    observed_model_id: named,
    profile,
    reason:
      resolution.selection === "direct_mapping" && named !== null
        ? null
        : "model_proxy",
    basis: named === null ? "model_not_named" : resolution.basis,
  };
  const siteDefault = Object.hasOwn(video.site_defaults, options.site)
    ? video.site_defaults[options.site]
    : undefined;
  const modelDefault = Object.hasOwn(video.model_defaults, profile.model_name)
    ? video.model_defaults[profile.model_name]
    : undefined;
  const fallback = siteDefault ?? modelDefault;
  const applied: ComponentInputs["defaults_applied"] = named === null ? ["model"] : [];
  let width = options.item.width,
    height = options.item.height;
  if (width === null || height === null) {
    width = fallback?.width ?? null;
    height = fallback?.height ?? null;
    applied.push("resolution");
  }
  let duration =
    options.item.duration_seconds === null
      ? null
      : Number(options.item.duration_seconds);
  if (duration === null) {
    duration = fallback ? Number(fallback.duration_seconds) : null;
    applied.push("duration");
  }
  let audio = options.item.with_audio;
  if (audio === null) {
    audio = fallback?.with_audio ?? null;
    applied.push("audio");
  }
  Object.assign(inputs, {
    width,
    height,
    duration_seconds: duration === null ? null : finiteDecimal(duration),
    with_audio: audio,
    defaults_applied: applied,
    environment_provider: profile.provider,
  });
  const reasons = [
    ...options.reasons,
    ...(selection.reason === "model_proxy" ? (["model_proxy"] as const) : []),
    ...(applied.length ? (["media_default_assumed"] as const) : []),
  ];
  if (width === null || height === null || duration === null || audio === null)
    return unavailableComponent(base, selection, inputs, scope, [
      ...reasons,
      "estimate_unavailable",
    ]);
  const lookup = {
    model_name: profile.model_name,
    resolution: `${width}x${height}`,
    duration,
    with_audio: audio,
    datacenter_location: null,
  };
  if (!core.validateVideoLookupInput(lookup).ok)
    return unavailableComponent(base, selection, inputs, scope, [
      ...reasons,
      "numeric_domain_unsupported",
    ]);
  const resolved = core.resolveVideoInput(lookup);
  if ("input" in resolved)
    inputs.electricity_mix_zone = resolved.electricity_mix.zone;
  return impactComponent(
    base,
    selection,
    inputs,
    scope,
    reasons,
    core.videoImpacts(lookup),
    core,
  );
}

/** Speech length from its basis; characters use the measured reading rate. */
export function speechSeconds(
  methods: MethodRegistry,
  item: Extract<MediaOutput, { kind: "speech" }>,
): number | null {
  if (item.length_basis === "characters")
    return item.characters === null
      ? null
      : Number(item.characters) / Number(methods.media.speech.characters_per_second);
  return item.seconds === null ? null : Number(item.seconds);
}

/** All media components of one observation, in page order. */
export function mediaComponents(
  core: EcoLogitsRuntime,
  methods: MethodRegistry,
  site: Site,
  media: readonly MediaOutput[],
  reasons: readonly EstimateReason[],
): ComponentResult[] {
  const results: ComponentResult[] = [];
  const counters = { image: 0, video: 0, speech: 0 };
  const next = (kind: keyof typeof counters) => `${kind}_${counters[kind]++}`;
  for (const item of media) {
    if (item.kind === "image")
      results.push(
        imageComponent(core, methods, {
          componentId: next("image"),
          role: "generated_image",
          site,
          modelId: item.model_id,
          count: item.count,
          width: item.width,
          height: item.height,
          reasons,
        }),
      );
    else if (item.kind === "video")
      results.push(
        videoComponent(core, methods, {
          componentId: next("video"),
          site,
          item,
          reasons,
        }),
      );
    else if (item.kind === "speech") {
      const seconds = speechSeconds(methods, item);
      results.push(
        speechComponent(core, methods, {
          componentId: next("speech"),
          role: "generated_speech",
          site,
          seconds: seconds ?? 0,
          reasons: [
            ...reasons,
            ...(item.length_basis === "characters"
              ? (["speech_length_estimated"] as const)
              : []),
          ],
        }),
      );
    } else {
      // NotebookLM Video Overview: illustrations at the image figure plus narration.
      const seconds = Number(item.duration_seconds);
      const illustrations = Math.ceil(
        seconds / Number(methods.media.overview.seconds_per_illustration),
      );
      results.push(
        imageComponent(core, methods, {
          componentId: next("image"),
          role: "overview_illustrations",
          site,
          modelId: null,
          count: String(Math.max(1, illustrations)),
          width: null,
          height: null,
          reasons,
        }),
        speechComponent(core, methods, {
          componentId: next("speech"),
          role: "overview_narration",
          site,
          seconds,
          reasons,
        }),
      );
    }
  }
  return results;
}

function sumValues(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Adds component metrics; a range keeps its endpoints and a scalar counts as both. */
export function sumComponentMetrics(
  components: readonly ComponentResult[],
  scope: Scope,
  reasons: readonly EstimateReason[],
): Metrics {
  const estimated = components.filter((c) => c.status === "estimated");
  const result = {} as Record<(typeof METRIC_NAMES)[number], ProductMetric>;
  for (const name of METRIC_NAMES) {
    const metrics = estimated
      .map((c) => c.metrics[name])
      .filter((metric) => metric.value !== null);
    if (!metrics.length) {
      result[name] = unavailableMetric(
        UNITS[name],
        scope,
        name === "water_direct" || name === "water_upstream"
          ? ["not_applicable"]
          : reasons,
      );
      continue;
    }
    // A point estimate is a range of zero width. Every EcoLogits total is a range, so the
    // totals of replies with text ranges and of point-only replies (images, speech) add
    // endpoint by endpoint in every summary, without a separate group for each kind.
    const low = sumValues(metrics.map((m) => Number(m.scenario_low ?? m.value)));
    const high = sumValues(metrics.map((m) => Number(m.scenario_high ?? m.value)));
    result[name] = {
      value: finiteDecimal((low + high) / 2),
      unit: UNITS[name],
      scope,
      status: "partial_estimate",
      phase: "usage",
      scenario_low: finiteDecimal(low),
      scenario_high: finiteDecimal(high),
      interval_kind: "upstream_approximation",
      value_kind: "midpoint",
      reasons: [...reasons],
    };
  }
  return result;
}
