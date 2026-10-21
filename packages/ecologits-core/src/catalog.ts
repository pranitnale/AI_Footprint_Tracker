// SPDX-License-Identifier: MPL-2.0
// Derived from EcoLogits repositories, tracers/utils.py and estimations/video.py. See ../NOTICE.md.
import generated from '../data/catalog.json';
export { ECOLOGITS_IDENTITY } from './identity.js';
import { assertKeys, computeLlmImpacts, type EnvironmentInput, type LlmInput } from './llm.js';
import { errorOutput, output, type ImpactsOutput, type StatusMessage } from './modeling.js';
import { EcoLogitsError, isRange, range, type ValueOrRange } from './values.js';
import { computeVideoImpacts, durationToFrames, parseResolution, type VideoInput } from './video.js';

export type Provider = 'anthropic' | 'cohere' | 'google_genai' | 'huggingface_hub' | 'mistralai' | 'openai';
export interface Model {
  readonly provider: Provider; readonly name: string;
  readonly architecture: { readonly type: 'dense' | 'moe'; readonly parameters: ValueOrRange | { readonly total: ValueOrRange; readonly active: ValueOrRange } };
  readonly warnings: readonly StatusMessage[]; readonly sources: readonly string[];
  readonly deployment: { readonly tps: number | null; readonly ttft: number | null } | null;
}
export interface ElectricityMix {
  readonly zone: string; readonly adpe: number; readonly pe: number; readonly gwp: number; readonly wue: number;
  readonly warnings: readonly StatusMessage[];
}
export interface ProviderConfiguration {
  readonly datacenter_location: string; readonly datacenter_pue: ValueOrRange; readonly datacenter_wue: ValueOrRange;
}
export interface VideoModel {
  readonly model_name: string; readonly provider: string; readonly hardware: string;
  readonly regression_parameters: Readonly<Record<'n' | 'm' | 'n1' | 'm1' | 'n2' | 'm2' | 'g' | 'non_audio_weight', number>>;
  readonly capabilities: { readonly resolutions: readonly (readonly number[])[]; readonly frames_count: readonly number[]; readonly audio_generation: boolean };
}
export interface Hardware {
  readonly number_of_accelerators: number;
  readonly server_power: Readonly<Record<'p2_5' | 'mean' | 'p97_5', number>>;
  readonly server_embodied: Readonly<Record<'gwp' | 'adpe' | 'pe', number>>;
  readonly accelerator_embodied: Readonly<Record<'gwp' | 'adpe' | 'pe', number>>;
}
export interface Provenance { readonly path: string; readonly source_sha256: string; readonly raw_sources?: readonly string[]; readonly alias_of?: string }
export interface Catalog {
  readonly schema_version: string; readonly upstream_version: string; readonly upstream_commit: string;
  readonly models: readonly Model[];
  readonly aliases: readonly { readonly provider: string; readonly name: string; readonly alias: string; readonly type: string }[];
  readonly electricity_mixes: readonly ElectricityMix[];
  readonly provider_configurations: Readonly<Record<string, ProviderConfiguration>>;
  readonly video: { readonly models: readonly VideoModel[]; readonly hardware_configurations: Readonly<Record<string, Hardware>>; readonly provider_configurations: Readonly<Record<string, ProviderConfiguration>> };
  readonly model_provenance: Readonly<Record<string, Provenance>>;
  readonly electricity_provenance: Readonly<Record<string, Provenance>>;
  readonly video_provenance: Readonly<Record<string, Provenance>>;
  readonly warning_messages: Readonly<Record<string, StatusMessage>>;
  readonly error_messages: Readonly<Record<string, StatusMessage>>;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export const catalog: Catalog = freeze(generated as Catalog);
export interface LlmLookupInput {
  provider: string; model_name: string; output_token_count: number;
  request_latency?: number | null; electricity_mix_zone?: string | null;
}
export interface VideoLookupInput {
  model_name: string; resolution: string; duration: number; with_audio?: boolean;
  datacenter_location?: string | null; datacenter_pue?: ValueOrRange | null; datacenter_wue?: ValueOrRange | null;
}
export function electricityInput(mix: ElectricityMix, config: Pick<ProviderConfiguration, 'datacenter_pue' | 'datacenter_wue'>): EnvironmentInput {
  return { if_electricity_mix_adpe: mix.adpe, if_electricity_mix_pe: mix.pe,
    if_electricity_mix_gwp: mix.gwp, if_electricity_mix_wue: mix.wue,
    datacenter_pue: config.datacenter_pue, datacenter_wue: config.datacenter_wue };
}
/** Build a runtime from a reviewed schema-1 catalog. Signature and method admission stay with the caller. */
export function createCatalogRuntime(source: Catalog): CatalogRuntime {
  function copy(value: any): any {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new EcoLogitsError('ValueError', 'Nonfinite catalog number');
    if (Array.isArray(value)) return value.map(copy);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, copy(child)]));
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
    throw new EcoLogitsError('TypeError', 'Catalog must contain JSON values');
  }
  return buildCatalogRuntime(freeze(copy(source) as Catalog));
}
function buildCatalogRuntime(catalog: Catalog) {
  if (catalog.schema_version !== '1') throw new EcoLogitsError('ValueError', 'Unsupported catalog schema');
  const modelKeys = new Set<string>();
  for (const model of catalog.models) {
    const key = `${model.provider}\0${model.name}`;
    if (modelKeys.has(key)) throw new EcoLogitsError('ValueError', 'Duplicate normalized model');
    modelKeys.add(key);
    if (!Object.hasOwn(catalog.provider_configurations, model.provider)) throw new EcoLogitsError('ValueError', 'Missing provider configuration');
    if (!['dense', 'moe'].includes(model.architecture.type)) throw new EcoLogitsError('ValueError', 'Unsupported architecture');
  }
  if (new Set(catalog.electricity_mixes.map(mix => mix.zone)).size !== catalog.electricity_mixes.length) throw new EcoLogitsError('ValueError', 'Duplicate electricity zone');
  if (new Set(catalog.video.models.map(model => model.model_name)).size !== catalog.video.models.length) throw new EcoLogitsError('ValueError', 'Duplicate video model');
  for (const model of catalog.video.models) {
    if (!Object.hasOwn(catalog.video.provider_configurations, model.provider) || !Object.hasOwn(catalog.video.hardware_configurations, model.hardware)) throw new EcoLogitsError('ValueError', 'Missing video configuration');
  }
  const modelIndex = new Map(catalog.models.map(model => [`${model.provider}\0${model.name}`, model]));
  const electricityIndex = new Map(catalog.electricity_mixes.map(mix => [mix.zone, mix]));
  const videoIndex = new Map(catalog.video.models.map(model => [model.model_name, model]));
  function findModel(provider: string, modelName: string): Model | null { return modelIndex.get(`${provider}\0${modelName}`) ?? null; }
  function findElectricityMix(zone: string): ElectricityMix | null { return electricityIndex.get(zone) ?? null; }
  function findVideoModel(name: string): VideoModel | null { return videoIndex.get(name) ?? null; }


  /** Numeric preparation is exposed so adapters can bind the exact resolved inputs into their method hash. */
  function resolveLlmInput(input: LlmLookupInput): { input: LlmInput; model: Model; electricity_mix: ElectricityMix } | ImpactsOutput {
    const model = findModel(input.provider, input.model_name);
    if (!model) return errorOutput('model-not-registered', `Could not find model \`${input.model_name}\` for ${input.provider} provider.`);
    const config = catalog.provider_configurations[input.provider];
    const zone = input.electricity_mix_zone ?? config.datacenter_location ?? 'WOR';
    const mix = findElectricityMix(zone);
    if (!mix) return errorOutput('zone-not-registered', `Could not find electricity mix for \`${zone}\` zone.`);
    const parameters = model.architecture.parameters;
    const moe = typeof parameters === 'object' && 'total' in parameters;
    return { input: { ...electricityInput(mix, config),
      model_active_parameter_count: moe ? parameters.active : parameters,
      model_total_parameter_count: moe ? parameters.total : parameters,
      output_token_count: input.output_token_count, request_latency: input.request_latency ?? null,
      tps: model.deployment?.tps ?? null, ttft: model.deployment?.ttft ?? null,
    }, model, electricity_mix: mix };
  }
  /** Raw upstream results, including full embodied/usage phases. No product headline policy is applied. */
  function llmImpacts(input: LlmLookupInput): ImpactsOutput {
    assertKeys(input, ['provider', 'model_name', 'output_token_count', 'request_latency', 'electricity_mix_zone']);
    const resolved = resolveLlmInput(input);
    if (!('input' in resolved)) return resolved;
    return output(computeLlmImpacts(resolved.input), [...resolved.model.warnings, ...resolved.electricity_mix.warnings]);
  }

  function resolveVideoInput(input: VideoLookupInput): { input: VideoInput; model: VideoModel; electricity_mix: ElectricityMix } | ImpactsOutput {
    const model = findVideoModel(input.model_name);
    if (!model) return errorOutput('model-not-registered', `Could not find video model \`${input.model_name}\`.`);
    const config = catalog.video.provider_configurations[model.provider];
    const zone = input.datacenter_location === undefined ? 'WOR' : input.datacenter_location === null ? config.datacenter_location : input.datacenter_location;
    const mix = findElectricityMix(zone);
    if (!mix) return errorOutput('zone-not-registered', `Could not find electricity mix for \`${zone}\` zone.`);
    const [width, height] = parseResolution(input.resolution);
    const hardware = catalog.video.hardware_configurations[model.hardware];
    return { model, electricity_mix: mix, input: {
      ...electricityInput(mix, { datacenter_pue: input.datacenter_pue ?? config.datacenter_pue, datacenter_wue: input.datacenter_wue ?? config.datacenter_wue }),
      video_width: width, video_height: height, video_frames_count: durationToFrames(input.duration),
      server_accelerator_power: range(hardware.server_power.p2_5 / 1000, hardware.server_power.p97_5 / 1000),
      accelerator_embodied_gwp: hardware.accelerator_embodied.gwp, accelerator_embodied_adpe: hardware.accelerator_embodied.adpe,
      accelerator_embodied_pe: hardware.accelerator_embodied.pe, server_embodied_gwp: hardware.server_embodied.gwp,
      server_embodied_adpe: hardware.server_embodied.adpe, server_embodied_pe: hardware.server_embodied.pe,
      server_accelerator_count: hardware.number_of_accelerators, ...model.regression_parameters,
      non_audio_weight: input.with_audio === undefined || input.with_audio ? 1 : model.regression_parameters.non_audio_weight,
    } };
  }
  function videoImpacts(input: VideoLookupInput): ImpactsOutput {
    assertKeys(input, ['model_name', 'resolution', 'duration', 'with_audio', 'datacenter_location', 'datacenter_pue', 'datacenter_wue']);
    const resolved = resolveVideoInput(input);
    if (!('input' in resolved)) return resolved;
    return output(computeVideoImpacts(resolved.input), resolved.electricity_mix.warnings);
  }

  function warningFromCode(code: string): StatusMessage {
    const message = Object.hasOwn(catalog.warning_messages, code) ? catalog.warning_messages[code] : undefined;
    if (!message) throw new EcoLogitsError('ValueError', `Warning code \`${code}\` does not exist.`);
    return message;
  }
  function errorFromCode(code: string): StatusMessage {
    const message = Object.hasOwn(catalog.error_messages, code) ? catalog.error_messages[code] : undefined;
    if (!message) throw new EcoLogitsError('ValueError', `Error code \`${code}\` does not exist.`);
    return message;
  }
  /** Typed numeric loader; this is not a complete Pydantic coercion schema. */
  function modelFromJson(data: Record<string, any>): Model {
    for (const key of ['provider', 'name', 'architecture']) if (!Object.hasOwn(data, key)) throw new EcoLogitsError('KeyError', key);
    if (!['anthropic', 'cohere', 'google_genai', 'huggingface_hub', 'mistralai', 'openai'].includes(data.provider)) throw new EcoLogitsError('ValueError', `${data.provider} is not a valid Providers`);
    const architecture = data.architecture;
    if (!architecture || !['dense', 'moe'].includes(architecture.type) || !Object.hasOwn(architecture, 'parameters')) throw new EcoLogitsError('ValidationError', 'Invalid architecture');
    const parameters = architecture.parameters;
    let parsed: Model['architecture']['parameters'];
    if (parameters && typeof parameters === 'object' && 'total' in parameters && 'active' in parameters) {
      parsed = { total: parseValueOrRange(parameters.total), active: parseValueOrRange(parameters.active) };
    } else parsed = parseValueOrRange(parameters);
    if (Object.hasOwn(data, 'source') && !Object.hasOwn(data, 'sources')) throw new EcoLogitsError('KeyError', 'sources');
    return { provider: data.provider, name: data.name, architecture: { type: architecture.type, parameters: parsed },
      warnings: (data.warnings ?? []).map(warningFromCode),
      // Preserve the upstream singular-key guard instead of silently recovering lost sources.
      sources: Object.hasOwn(data, 'source') && data.sources != null ? data.sources : [],
      deployment: data.deployment == null ? null : { tps: data.deployment.tps ?? null, ttft: data.deployment.ttft ?? null },
    };
  }
  function electricityMixFromJson(data: Record<string, any>): ElectricityMix {
    for (const key of ['name', 'adpe', 'pe', 'gwp', 'wue']) if (!Object.hasOwn(data, key)) throw new EcoLogitsError('KeyError', key);
    const number = (value: unknown): number => {
      if (typeof value === 'number') return value;
      if (typeof value === 'boolean') return Number(value);
      if (typeof value !== 'string') throw new EcoLogitsError('TypeError', 'float() argument must be a string or a real number');
      const text = value.trim();
      if (/^[+-]?(inf(inity)?|nan)$/i.test(text)) return /nan/i.test(text) ? NaN : text.startsWith('-') ? -Infinity : Infinity;
      if (!/^[+-]?(?:[0-9](?:_?[0-9])*(?:\.(?:[0-9](?:_?[0-9])*)?)?|\.[0-9](?:_?[0-9])*)(?:e[+-]?[0-9](?:_?[0-9])*)?$/i.test(text)) throw new EcoLogitsError('ValueError', 'could not convert string to float');
      return Number(text.replaceAll('_', ''));
    };
    return { zone: data.name, adpe: number(data.adpe), pe: number(data.pe), gwp: number(data.gwp), wue: number(data.wue),
      warnings: (data.warnings ?? []).map(warningFromCode) };
  }
  return Object.freeze({ catalog, findModel, findElectricityMix, findVideoModel, resolveLlmInput, resolveVideoInput, llmImpacts, videoImpacts, warningFromCode, errorFromCode, modelFromJson, electricityMixFromJson, createModelRepository, createElectricityRepository });
}
export type CatalogRuntime = ReturnType<typeof buildCatalogRuntime>;
const defaultRuntime = buildCatalogRuntime(catalog);
export const findModel = defaultRuntime.findModel;
export const findElectricityMix = defaultRuntime.findElectricityMix;
export const findVideoModel = defaultRuntime.findVideoModel;
export const resolveLlmInput = defaultRuntime.resolveLlmInput;
export const resolveVideoInput = defaultRuntime.resolveVideoInput;
export const llmImpacts = defaultRuntime.llmImpacts;
export const videoImpacts = defaultRuntime.videoImpacts;
export const warningFromCode = defaultRuntime.warningFromCode;
export const errorFromCode = defaultRuntime.errorFromCode;
export const modelFromJson = defaultRuntime.modelFromJson;
export const electricityMixFromJson = defaultRuntime.electricityMixFromJson;

/** Raw repository constructor semantics, including upstream alias overwrite behavior. */
export function createModelRepository(models: readonly Model[], aliases: readonly { provider: string; name: string; alias: string }[] = []): readonly Model[] {
  const index = new Map<string, Model>();
  for (const model of models) {
    const key = `${model.provider}\0${model.name}`;
    if (index.has(key)) throw new EcoLogitsError('ValueError', `duplicated models with: ('${model.provider}', '${model.name}')`);
    index.set(key, model);
  }
  for (const alias of aliases) {
    const model = index.get(`${alias.provider}\0${alias.alias}`);
    if (!model) throw new EcoLogitsError('ValueError', `model alias not found: ('${alias.provider}', '${alias.alias}')`);
    index.set(`${alias.provider}\0${alias.name}`, { ...model, name: alias.name });
  }
  return [...index.values()];
}



export function parseValueOrRange(value: ValueOrRange): ValueOrRange {
  return isRange(value) ? range(value.min, value.max) : value;
}


export function createElectricityRepository(mixes: readonly ElectricityMix[]): readonly ElectricityMix[] {
  const keys = new Set<string>();
  for (const mix of mixes) {
    if (keys.has(mix.zone)) throw new EcoLogitsError('ValueError', `duplicated electricity mix with: ${mix.zone}`);
    keys.add(mix.zone);
  }
  return [...mixes];
}
