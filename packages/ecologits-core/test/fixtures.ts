import * as core from '../src/index.js';
import { llmBase, videoBase, type Case } from '../tools/differential.js';

export function boundaryCases(): Case[] {
  const cases: Case[] = [];
  const add = (id: string, op: string, args: Record<string, any>) => cases.push({ id, op, args });
  for (const bits of [4, 8, 16, 32]) for (const capacity of [24, 40, 80, 141]) for (const count of [1, 2, 4, 8, 16, 32]) {
    const threshold = capacity * count;
    for (const delta of [-1e-10, 0, 1e-10]) {
      add(`EL06-${bits}-${capacity}-${count}-${delta}`, 'gpu_count', { model_required_memory: threshold + delta, gpu_memory: capacity });
      add(`EL06-memory-${bits}-${capacity}-${count}-${delta}`, 'llm_dag', { ...llmBase, model_quantization_bits: bits, gpu_memory: capacity,
        model_total_parameter_count: (threshold + delta) * 8 / bits / 1.2, request_latency: Infinity });
    }
  }
  for (const active of [70, { min: 70, max: 70 }, { min: 10, max: 70 }]) for (const total of [90, { min: 90, max: 90 }, { min: 90, max: 210 }]) {
    add(`EL04/05-${cases.length}`, 'llm', { ...llmBase, model_active_parameter_count: active, model_total_parameter_count: total,
      datacenter_pue: { min: 1.09, max: 1.14 }, datacenter_wue: { min: 0.13, max: 0.999 } });
  }
  for (const tps of [undefined, null, 0, 1, 25]) for (const ttft of [undefined, null, 0, 0.59]) for (const latency of [undefined, null, 0, 40, 10000]) {
    add(`EL09/10-${cases.length}`, 'llm', { ...llmBase, ...(tps === undefined ? {} : { tps }), ...(ttft === undefined ? {} : { ttft }), ...(latency === undefined ? {} : { request_latency: latency }) });
  }
  for (const latency of [39.999999999, 40, 40.000000001]) add(`EL10-exact-${latency}`, 'llm', { ...llmBase, tps: 25, ttft: 0, request_latency: latency });
  for (const tokens of [0, 1e-100, Number.MIN_VALUE, 1, Number.MAX_SAFE_INTEGER]) add(`EL17/19-${tokens}`, 'llm', { ...llmBase, output_token_count: tokens });
  for (const data of [
    { gpu_memory: 0 }, { model_total_parameter_count: 0 }, { model_total_parameter_count: -1 }, { batch_size: 0 },
    { server_gpu_count: 0 }, { server_lifetime: 0 }, { gpu_energy_beta: 1000 }, { request_latency: -1 },
    { datacenter_pue: { min: 1.5, max: 1.1 } }, { model_total_parameter_count: { min: 100, max: 50 } },
    { model_quantization_bits: null }, { generation_latency: 1 }, { request_energy: 1 },
  ]) add(`EL16/22-${cases.length}`, 'llm', { ...llmBase, ...data });
  const llmDag = { ...core.LLM_DEFAULTS, ...llmBase, request_latency: Infinity };
  for (const [asset, value] of Object.entries(core.computeLlmImpactsDag({ ...llmBase, request_latency: Infinity }))) {
    if (!(asset in core.llmAssets)) continue;
    add(`EL08-override-${asset}`, 'llm_execute', { ...llmDag, [asset]: typeof value === 'number' ? value * 0.5 : value });
  }
  add('EL22-null-asset', 'llm_execute', { ...llmDag, request_embodied_gwp: null });
  add('EL22-null-dependency', 'llm_execute', { ...llmDag, gpu_energy: null });
  const incomplete = { ...llmDag } as Record<string, any>; delete incomplete.tps;
  add('EL22-absent-optional-node', 'llm_execute', incomplete);
  for (const a of [2, { min: 1, max: 3 }, { min: 2, max: 2 }]) for (const b of [2, { min: 1, max: 4 }, { min: 2, max: 2 }]) {
    for (const action of ['add', 'multiply', 'divide', 'equal', 'less', 'lessEqual', 'greater', 'greaterEqual']) add(`EL05-range-${cases.length}`, 'range', { a, b, action });
  }
  add('EL22-reverse-division', 'range', { a: 2, b: { min: 2, max: 4 }, action: 'divide' });
  add('EL16-negative-range-multiplier', 'range', { a: { min: 1, max: 3 }, b: -1, action: 'multiply' });
  add('EL05-midpoint', 'range', { a: { min: 1e-12, max: 3e-12 }, action: 'mean' });
  for (const kind of ['energy', 'gwp', 'adpe', 'pe', 'wcf']) {
    add(`EL21-add-${kind}`, 'impact_add', { left: kind, right: kind, a: 1, b: { min: 2, max: 3 } });
    add(`EL21-mismatch-${kind}`, 'impact_add', { left: kind, right: kind === 'energy' ? 'gwp' : 'energy', a: 1, b: 2 });
    for (const action of ['equal', 'less', 'lessEqual', 'greater', 'greaterEqual']) for (const a of [2, { min: 1, max: 3 }]) {
      add(`EL21-compare-${cases.length}`, 'impact_compare', { left: kind, right: kind, a, b: { min: 2, max: 3 }, action });
    }
  }
  for (const provider of ['openai', 'missing', 'OpenAI']) for (const zone of [undefined, null, 'WOR', 'FRA', 'USA', 'unknown', '']) {
    add(`EL11/15-${provider}-${zone}`, 'llm_lookup', { provider, model_name: 'gpt-4o', output_token_count: 1000, ...(zone === undefined ? {} : { electricity_mix_zone: zone }) });
  }
  const rawModel = { provider: 'openai', name: 'synthetic', architecture: { type: 'dense', parameters: 70 }, sources: ['https://example.com/source'] };
  add('EL22-source-loader', 'model_from_json', rawModel);
  add('EL22-singular-source', 'model_from_json', { ...rawModel, source: true });
  add('EL22-singular-missing-sources', 'model_from_json', { provider: 'openai', name: 'synthetic', architecture: rawModel.architecture, source: true });
  add('EL15-provider-enum', 'model_from_json', { ...rawModel, provider: 'unknown' });
  add('EL15-warning-code', 'model_from_json', { ...rawModel, warnings: ['unknown'] });
  add('EL02-duplicate-model', 'repository', { models: [rawModel, rawModel] });
  add('EL02-missing-alias', 'repository', { models: [rawModel], aliases: [{ provider: 'openai', name: 'alias', alias: 'missing' }] });
  add('EL22-alias-overwrite', 'repository', { models: [rawModel], aliases: [{ provider: 'openai', name: 'synthetic', alias: 'synthetic' }] });
  const rawMix = { name: 'TEST', adpe: 1e-8, pe: 2, gwp: 0.5, wue: 3 };
  for (const pe of [0, 1, '1.2', '1e+2', '-.1', '1_000', 'nan', 'inf', '1.2.', 'invalid', null, true]) add(`EL15-mix-loader-${pe}`, 'electricity_from_json', { ...rawMix, pe });
  add('EL15-duplicate-mix', 'electricity_repository', { mixes: [rawMix, rawMix] });
  for (const resolution of ['720p', ' 1080P ', '4K', '1920x1080', ' 1920 X 1080 ', '+1920x-1080', '1_920x1_080', '١٢٨٠x٧٢٠', '１２８０x７２０', '\u0085720p\u001c', '0x0', 'hd', '1920', '1x2x3', '1.0x2', 'x2', '0x10x0x10']) add(`EV02-${resolution}`, 'resolution', { resolution });
  for (const duration of [0, 1 / 24 - 1e-15, 1 / 24, 1 / 24 + 1e-15, 0.125, 4.999999999, 5, 5.000000001, -1, -0.01, 1e308, Infinity, NaN]) add(`EV03-${duration}`, 'frames', { duration });
  const videoDag = { ...core.VIDEO_DEFAULTS, ...videoBase, request_latency: Infinity };
  for (const key of Object.keys(core.videoAssets)) add(`EV10-override-${key}`, 'video_execute', { ...videoDag, [key]: 1 });
  for (const latency of [0, 0.1, 10000, null]) add(`EV10-cap-${latency}`, 'video', { ...videoBase, request_latency: latency });
  add('EV11-negative-latency-scalar', 'video', { ...videoBase, server_accelerator_power: 5, m: 0, g: -1 });
  add('EV11-negative-latency-range', 'video', { ...videoBase, m: 0, g: -1 });
  add('EV11-nonfinite', 'video', { ...videoBase, video_width: NaN });
  add('EV08-range-environment', 'video', { ...videoBase, datacenter_pue: { min: 1.09, max: 1.14 }, datacenter_wue: { min: 0.13, max: 0.999 } });
  add('EV10-high-level-rejects-cap', 'video_lookup', { model_name: 'missing', resolution: '720p', duration: 5, request_latency: 2 });
  add('EV03-truncated-negative-zero', 'frames', { duration: -0.05 });
  add('EV02-integer-signed-zero', 'resolution', { resolution: '-0x+0' });
  add('EV02-parse-range', 'parse_value_or_range', { value: { min: 1.09, max: 1.14 } });
  add('EV02-parse-scalar', 'parse_value_or_range', { value: 1.2 });
  add('EV02-parse-reversed-range', 'parse_value_or_range', { value: { min: 1.14, max: 1.09 } });
  for (const kind of ['warning', 'error']) for (const code of Object.keys(kind === 'warning' ? core.catalog.warning_messages : core.catalog.error_messages)) {
    add(`EL21-status-${code}`, 'status_from_code', { kind, code });
  }
  add('EL21-output-empty', 'output_status', { warnings: [], errors: [] });
  add('EL21-output-dedup', 'output_status', { warnings: ['model-arch-not-released', 'model-arch-not-released'], errors: ['zone-not-registered', 'zone-not-registered'] });
  add('EV02-parser-negative-zero-scalar', 'parse_value_or_range', { value: -0 });
  add('EV02-parser-negative-zero-range', 'parse_value_or_range', { value: { min: -0, max: 1 } });
  add('EV02-parser-negative-zero-degenerate', 'parse_value_or_range', { value: { min: -0, max: -0 } });
  add('EV02-parser-nan-scalar', 'parse_value_or_range', { value: NaN });
  add('EV02-parser-infinity-range', 'parse_value_or_range', { value: { min: 0, max: Infinity } });
  add('EL22-json-loader-negative-zero', 'model_from_json', { ...rawModel, architecture: { type: 'dense', parameters: { min: -0, max: 1 } } });
  add('EL22-json-repository-negative-zero', 'repository', { models: [{ ...rawModel, deployment: { tps: -0, ttft: -0 } }] });
  return cases;
}
