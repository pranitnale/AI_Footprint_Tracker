// SPDX-License-Identifier: MPL-2.0
// Derived from EcoLogits 0.11.1 impacts/llm.py. See ../NOTICE.md.
import { executeDag, type Asset, type DagValues } from './dag.js';
import { impactsFromDag, resultFields, type Impacts } from './modeling.js';
import { add, divide, EcoLogitsError, isRange, less, lower, multiply, range, upper, type ValueOrRange } from './values.js';

export const LLM_DEFAULTS = Object.freeze({
  model_quantization_bits: 16,
  gpu_energy_alpha: 1.1665273170451914e-06,
  gpu_energy_beta: -0.011205921025579175,
  gpu_energy_gamma: 4.052928146734005e-05,
  latency_alpha: 0.0006785088094353663,
  latency_beta: 0.0003119310311688259,
  latency_gamma: 0.019473717579473387,
  gpu_memory: 80, gpu_embodied_gwp: 273, gpu_embodied_adpe: 0.00895, gpu_embodied_pe: 3721,
  server_gpu_count: 8, server_power: 1.2,
  server_embodied_gwp: 5700, server_embodied_adpe: 0.37, server_embodied_pe: 70000,
  server_lifetime: 3 * 365 * 24 * 60 * 60, batch_size: 64,
  tps: null, ttft: null,
});
export interface EnvironmentInput {
  if_electricity_mix_adpe: number;
  if_electricity_mix_pe: number;
  if_electricity_mix_gwp: number;
  if_electricity_mix_wue: number;
  datacenter_pue: ValueOrRange;
  datacenter_wue: ValueOrRange;
}
type LlmOverrides = Partial<Record<Exclude<keyof typeof LLM_DEFAULTS, 'tps' | 'ttft'>, number>>;
/** Counts are billion parameters and tokens, time is seconds, power is kW, memory is GB. */
export interface LlmInput extends EnvironmentInput, LlmOverrides {
  model_active_parameter_count: ValueOrRange;
  model_total_parameter_count: ValueOrRange;
  output_token_count: number;
  request_latency?: number | null;
  tps?: number | null;
  ttft?: number | null;
}
export function scalar(value: ValueOrRange | null | undefined): number {
  if (typeof value !== 'number') throw new EcoLogitsError('TypeError', 'Expected a scalar number');
  return value;
}
const v = (values: DagValues, key: string): ValueOrRange => {
  const value = values[key];
  if (value === null || value === undefined) throw new EcoLogitsError('TypeError', `Missing required argument: ${key}`);
  return value;
};
const s = (values: DagValues, key: string): number => scalar(values[key]);
const asset = (dependencies: readonly string[], run: Asset['run'], optional?: readonly string[]): Asset => ({ dependencies, run, optional });

export function gpuRequiredCount(memory: number, capacity: number): number {
  const count = Math.ceil(scalar(divide(memory, capacity)));
  if (count <= 0) throw new EcoLogitsError('ValueError', 'math domain error');
  if (!Number.isFinite(count)) throw new EcoLogitsError(Number.isNaN(count) ? 'ValueError' : 'OverflowError', 'cannot convert nonfinite float to integer');
  return 2 ** Math.ceil(Math.log2(count));
}
export const llmAssets: Readonly<Record<string, Asset>> = Object.freeze({
  gpu_energy: asset(['model_active_parameter_count', 'output_token_count', 'batch_size', 'gpu_energy_alpha', 'gpu_energy_beta', 'gpu_energy_gamma'], x => {
    const exp = Math.exp(s(x, 'gpu_energy_beta') * s(x, 'batch_size'));
    if (!Number.isFinite(exp) && Number.isFinite(s(x, 'gpu_energy_beta') * s(x, 'batch_size'))) throw new EcoLogitsError('OverflowError', 'math range error');
    const perToken = add(multiply(s(x, 'gpu_energy_alpha') * exp, v(x, 'model_active_parameter_count')), v(x, 'gpu_energy_gamma'));
    return multiply(v(x, 'output_token_count'), divide(perToken, 1000));
  }),
  generation_latency: asset(['model_active_parameter_count', 'output_token_count', 'batch_size', 'latency_alpha', 'latency_beta', 'latency_gamma', 'request_latency', 'tps', 'ttft'], x => {
    const perToken = x.tps === null ? add(add(multiply(v(x, 'latency_alpha'), v(x, 'model_active_parameter_count')), multiply(v(x, 'latency_beta'), v(x, 'batch_size'))), v(x, 'latency_gamma')) : divide(1, v(x, 'tps'));
    // Python regards NaN as truthy; only None and numeric zero select this fallback.
    const firstToken = x.ttft === null || x.ttft === 0 ? 0 : v(x, 'ttft');
    const latency = add(multiply(v(x, 'output_token_count'), perToken), firstToken);
    return less(v(x, 'request_latency'), latency) ? v(x, 'request_latency') : latency;
  }, ['tps', 'ttft']),
  model_required_memory: asset(['model_total_parameter_count', 'model_quantization_bits'], x => divide(multiply(multiply(1.2, v(x, 'model_total_parameter_count')), v(x, 'model_quantization_bits')), 8)),
  gpu_required_count: asset(['model_required_memory', 'gpu_memory'], x => gpuRequiredCount(s(x, 'model_required_memory'), s(x, 'gpu_memory'))),
  server_energy: asset(['generation_latency', 'server_power', 'server_gpu_count', 'gpu_required_count', 'batch_size'], x => multiply(multiply(multiply(divide(v(x, 'generation_latency'), 3600), v(x, 'server_power')), divide(v(x, 'gpu_required_count'), v(x, 'server_gpu_count'))), divide(1, v(x, 'batch_size')))),
  request_energy: asset(['datacenter_pue', 'request_it_energy'], x => multiply(v(x, 'datacenter_pue'), v(x, 'request_it_energy'))),
  request_it_energy: asset(['server_energy', 'gpu_required_count', 'gpu_energy'], x => add(v(x, 'server_energy'), multiply(v(x, 'gpu_required_count'), v(x, 'gpu_energy')))),
  request_usage_gwp: asset(['request_energy', 'if_electricity_mix_gwp'], x => multiply(v(x, 'request_energy'), v(x, 'if_electricity_mix_gwp'))),
  request_usage_adpe: asset(['request_energy', 'if_electricity_mix_adpe'], x => multiply(v(x, 'request_energy'), v(x, 'if_electricity_mix_adpe'))),
  request_usage_pe: asset(['request_energy', 'if_electricity_mix_pe'], x => multiply(v(x, 'request_energy'), v(x, 'if_electricity_mix_pe'))),
  request_usage_wcf: asset(['request_it_energy', 'if_electricity_mix_wue', 'datacenter_wue', 'datacenter_pue'], x => multiply(v(x, 'request_it_energy'), add(v(x, 'datacenter_wue'), multiply(v(x, 'datacenter_pue'), v(x, 'if_electricity_mix_wue'))))),
  ...Object.fromEntries(['gwp', 'adpe', 'pe'].flatMap(kind => [
    [`server_gpu_embodied_${kind}`, asset([`server_embodied_${kind}`, 'server_gpu_count', `gpu_embodied_${kind}`, 'gpu_required_count'], x => add(multiply(divide(v(x, 'gpu_required_count'), v(x, 'server_gpu_count')), v(x, `server_embodied_${kind}`)), multiply(v(x, 'gpu_required_count'), v(x, `gpu_embodied_${kind}`))))],
    [`request_embodied_${kind}`, asset([`server_gpu_embodied_${kind}`, 'server_lifetime', 'generation_latency', 'batch_size'], x => divide(multiply(v(x, 'generation_latency'), v(x, `server_gpu_embodied_${kind}`)), multiply(v(x, 'server_lifetime'), v(x, 'batch_size'))))],
  ])),
});
for (const asset of Object.values(llmAssets)) {
  Object.freeze(asset.dependencies);
  if (asset.optional) Object.freeze(asset.optional);
  Object.freeze(asset);
}

/** Exact DAG.execute surface: supply every dependency, with overrides allowed for any asset. */
export function executeLlmDag(inputs: DagValues): DagValues { return executeDag(llmAssets, inputs); }
/** Raw low-level DAG requires request_latency. Only the higher-level wrapper maps null to infinity. */
export function computeLlmImpactsDag(input: LlmInput & { request_latency: number }): DagValues {
  assertKeys(input, [...Object.keys(LLM_DEFAULTS), ...LLM_REQUIRED, 'request_latency']);
  return executeLlmDag({ ...LLM_DEFAULTS, ...input });
}
const LLM_REQUIRED = ['model_active_parameter_count', 'model_total_parameter_count', 'output_token_count',
  'if_electricity_mix_adpe', 'if_electricity_mix_pe', 'if_electricity_mix_gwp', 'if_electricity_mix_wue', 'datacenter_pue', 'datacenter_wue'];
export function assertKeys(input: object, allowed: readonly string[]): void {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) throw new EcoLogitsError('TypeError', `Unexpected argument: ${key}`);
  }
}
export function computeLlmImpacts(input: LlmInput): Impacts {
  const paired = isRange(input.model_active_parameter_count) || isRange(input.model_total_parameter_count);
  const results: DagValues = {};
  for (let index = 0; index < (paired ? 2 : 1); index++) {
    const endpoint = index === 0 ? lower : upper;
    const values = computeLlmImpactsDag({ ...input,
      model_active_parameter_count: endpoint(input.model_active_parameter_count),
      model_total_parameter_count: endpoint(input.model_total_parameter_count),
      request_latency: input.request_latency ?? Infinity,
    });
    for (const field of resultFields) {
      const value = v(values, field);
      results[field] = index === 0 ? value : range(lower(v(results, field)), upper(value));
    }
  }
  return impactsFromDag(results);
}
