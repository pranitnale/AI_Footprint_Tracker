import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as core from '../src/index.js';

export interface Case { id: string; op: string; args: Record<string, any> }
export const environment = { if_electricity_mix_gwp: 0.59, if_electricity_mix_adpe: 1.349e-8,
  if_electricity_mix_pe: 2.5871, if_electricity_mix_wue: 3.908, datacenter_pue: 1.2, datacenter_wue: 0.569 };
export const llmBase: core.LlmInput = { ...environment, model_active_parameter_count: 70, model_total_parameter_count: 70, output_token_count: 1000 };
export const videoBase: core.VideoInput = { ...environment, video_width: 1920, video_height: 1080, video_frames_count: 121,
  server_accelerator_power: { min: 4.99203, max: 8.48731 }, accelerator_embodied_gwp: 273,
  accelerator_embodied_adpe: 0.00895, accelerator_embodied_pe: 3721,
  server_embodied_gwp: 6000, server_embodied_adpe: 0.42, server_embodied_pe: 8000, m: 0.000681 };

export function encode(value: any): any {
  if (Object.is(value, -0)) return { $float: '-0' };
  if (typeof value === 'number' && !Number.isFinite(value)) return { $float: String(value) };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, encode(child)]));
  return value;
}
export function execute(case_: Case): any {
  const a = case_.args;
  switch (case_.op) {
    case 'llm': return core.computeLlmImpacts(a as core.LlmInput);
    case 'llm_dag': return core.computeLlmImpactsDag(a as core.LlmInput & { request_latency: number });
    case 'llm_execute': return core.executeLlmDag(a);
    case 'video': return core.computeVideoImpacts(a as core.VideoInput);
    case 'video_dag': return core.computeVideoImpactsDag(a as core.VideoInput & { request_latency: number });
    case 'video_execute': return core.executeVideoDag(a);
    case 'llm_lookup': return core.llmImpacts(a as core.LlmLookupInput);
    case 'video_lookup': return core.videoImpacts(a as core.VideoLookupInput);
    case 'model': return core.findModel(a.provider, a.model_name);
    case 'mix': return core.findElectricityMix(a.zone);
    case 'status_from_code': return a.kind === 'warning' ? core.warningFromCode(a.code) : core.errorFromCode(a.code);
    case 'output_status': {
      let result: core.ImpactsOutput = { energy: null, gwp: null, adpe: null, pe: null, wcf: null, usage: null, embodied: null, warnings: null, errors: null };
      for (const code of a.warnings) result = core.addOutputWarning(result, core.warningFromCode(code));
      for (const code of a.errors) result = core.addOutputError(result, core.errorFromCode(code));
      return { output: result, has_warnings: !!result.warnings?.length, has_errors: !!result.errors?.length };
    }
    case 'electricity_from_json': return core.electricityMixFromJson(a);
    case 'electricity_repository': return core.createElectricityRepository(a.mixes.map(core.electricityMixFromJson));
    case 'model_from_json': return core.modelFromJson(a);
    case 'repository': return core.createModelRepository(a.models.map(core.modelFromJson), a.aliases);
    case 'resolution': return core.parseResolution(a.resolution);
    case 'frames': return core.durationToFrames(a.duration);
    case 'parse_value_or_range': return core.parseValueOrRange(a.value);
    case 'gpu_count': return core.gpuRequiredCount(a.model_required_memory, a.gpu_memory);
    case 'range': return a.action === 'mean' ? core.mean(a.a) : (core[a.action as 'add'] as Function)(a.a, a.b);
    case 'impact_add': return core.addImpacts(core.impact(a.left, a.a), core.impact(a.right, a.b));
    case 'impact_compare': return core.compareImpacts(core.impact(a.left, a.a), core.impact(a.right, a.b), a.action);
    default: throw new Error(`Unknown operation ${case_.op}`);
  }
}
function rangeMeans(value: any, path = ''): Record<string, number> {
  if (core.isRange(value)) return { [path]: core.mean(value) };
  const found: Record<string, number> = {};
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) Object.assign(found, rangeMeans(child, `${path}.${key}`));
  return found;
}
const discrete = /(^|\.)(gpu_required_count|server_gpu_count|video_width|video_height|video_frames_count|server_accelerator_count)$/;
const comparisonOperations = new Set(['llm', 'llm_dag', 'llm_execute', 'video', 'video_dag', 'video_execute', 'llm_lookup', 'video_lookup',
  'model', 'mix', 'electricity_from_json', 'electricity_repository', 'model_from_json', 'repository', 'resolution', 'frames',
  'gpu_count', 'range', 'impact_add', 'impact_compare', 'status_from_code', 'output_status', 'parse_value_or_range']);
function absoluteTolerance(path: string, unit?: string): number {
  if (unit === 'kgSbeq' || /adpe/i.test(path)) return 1e-24;
  if (unit === 'kWh' || unit === 'kgCO2eq' || /energy|gwp/.test(path)) return 1e-15;
  if (unit === 'MJ' || unit === 'L' || /(^|_)(pe|wcf|wue)(\.|$)/.test(path)) return 1e-12;
  if (/latency|memory/.test(path)) return 1e-9;
  return 1e-15;
}
/** Full structural comparison. No field dropping, range flattening or coercion. */
export function compare(actual: any, expected: any, path: string, unit: string | undefined, operation: string): void {
  assert.ok(comparisonOperations.has(operation), 'Comparison requires a recognized operation; discrete outputs must not use an unscoped tolerance.');
  if (typeof expected === 'number') {
    assert.equal(typeof actual, 'number', `${path}: number type`);
    const discreteOutput = (operation === 'gpu_count' || operation === 'frames') && path.endsWith('.value')
      || operation === 'resolution' && /\.value\.[01]$/.test(path);
    if (!Number.isFinite(actual) || !Number.isFinite(expected) || actual === 0 || expected === 0) {
      assert.equal(actual, expected, `${path}: exact nonfinite/zero classification`);
      return;
    }
    assert.equal(Math.sign(actual), Math.sign(expected), `${path}: positive/negative classification`);
    if (discrete.test(path) || discreteOutput) assert.equal(actual, expected, `${path}: exact discrete`);
    else assert.ok(Math.abs(actual - expected) <= Math.max(absoluteTolerance(path, unit), 1e-10 * Math.max(Math.abs(actual), Math.abs(expected))), `${path}: ${actual} != ${expected}`);
    return;
  }
  if (expected === null || typeof expected !== 'object') { assert.equal(actual, expected, path); return; }
  assert.equal(Array.isArray(actual), Array.isArray(expected), `${path}: collection type`);
  assert.ok(actual !== null && typeof actual === 'object', `${path}: object type`);
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${path}: complete keys`);
  for (const key of Object.keys(expected)) compare(actual[key], expected[key], `${path}.${key}`, expected.unit ?? unit, operation);
}
export function differential(cases: Case[]): { cases: number; input_sha256: string; oracle_output_sha256: string } {
  const input = JSON.stringify(encode(cases));
  const root = fileURLToPath(new URL('../', import.meta.url));
  const oracle = spawnSync('uv', ['run', '--project', 'oracle', '--frozen', '--offline', 'python', '-X', 'utf8', 'oracle/run.py'], {
    cwd: root, input, encoding: 'utf8', maxBuffer: 100 * 1024 * 1024, timeout: 180_000,
  });
  assert.equal(oracle.status, 0, `Pinned upstream oracle must run: ${oracle.error ?? oracle.stderr}`);
  const expected = JSON.parse(oracle.stdout) as any[];
  assert.equal(expected.length, cases.length);
  for (let i = 0; i < cases.length; i++) {
    const case_ = cases[i];
    let actual;
    try {
      const value = execute(case_);
      actual = { id: case_.id, value: encode(value), range_means: encode(rangeMeans(value)) };
    }
    catch (error) {
      if (!(error instanceof core.EcoLogitsError)) throw error;
      actual = { id: case_.id, error: { pythonType: error.pythonType } };
    }
    try { compare(actual, expected[i], case_.id, undefined, case_.op); }
    catch (error) { throw new Error(`${(error as Error).message}\nReproducer: ${JSON.stringify(encode(case_))}`, { cause: error }); }
  }
  return { cases: cases.length, input_sha256: createHash('sha256').update(input).digest('hex'),
    oracle_output_sha256: createHash('sha256').update(oracle.stdout).digest('hex') };
}

export function numericalCases(count = 1000): Case[] {
  let seed = 0x0e1101;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
  const cases: Case[] = [];
  for (let i = 0; i < count; i++) {
    const active = 0.1 + random() * 500;
    const total = active + random() * 1500;
    const input: core.LlmInput = { ...environment,
      model_active_parameter_count: i % 3 ? active : { min: active, max: active + random() * 100 },
      model_total_parameter_count: i % 4 ? total : { min: total, max: total + random() * 100 },
      output_token_count: Math.floor(random() * 100000), batch_size: 1 + Math.floor(random() * 256),
      model_quantization_bits: [4, 8, 16, 32][i % 4], gpu_memory: [24, 40, 80, 141][i % 4],
      server_power: random() * 3, server_gpu_count: [1, 2, 4, 8][i % 4],
      datacenter_pue: i % 2 ? 1 + random() : { min: 1, max: 2 },
      datacenter_wue: i % 2 ? random() : { min: 0.1, max: 3 },
      request_latency: i % 5 ? random() * 100 : null,
      tps: i % 3 ? 1 + random() * 200 : null, ttft: i % 3 ? random() : null,
    };
    const totalFloor = Math.max(core.lower(input.model_total_parameter_count), core.upper(input.model_active_parameter_count));
    input.model_total_parameter_count = core.isRange(input.model_total_parameter_count)
      ? { min: totalFloor, max: Math.max(totalFloor, input.model_total_parameter_count.max) } : totalFloor;
    assert.deepEqual(core.validateLlmInput(input), { ok: true }, `EL20-${i} must be product-admitted`);
    cases.push({ id: `EL20-${i}`, op: 'llm', args: input });
    cases.push({ id: `EL20-dag-${i}`, op: 'llm_dag', args: { ...input, model_active_parameter_count: core.lower(input.model_active_parameter_count), model_total_parameter_count: core.lower(input.model_total_parameter_count), request_latency: input.request_latency ?? Infinity } });
    if (i % 5 === 0) cases.push({ id: `EV04-${i}`, op: 'video_dag', args: { ...videoBase,
      video_width: 1280, video_height: 720, video_frames_count: 1 + Math.floor(random() * 720),
      n: random() * 1e-14, m: random() * 1e-3, n1: random() * 1e-3, m1: random(),
      n2: random() * 1e-8, m2: random() * 1e-10, g: random() * 100,
      non_audio_weight: random(), request_latency: i % 2 ? random() * 500 : Infinity,
    } });
  }
  return cases;
}
/** Deliberately invalid product inputs remain a separately named raw-source corpus. */
export function invalidNumericalCases(count = 100): Case[] {
  let seed = 0xbad011;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
  return Array.from({ length: count }, (_, index) => {
    const input = { ...llmBase, model_active_parameter_count: { min: 70, max: 71 + random() * 1000 }, model_total_parameter_count: 70 };
    assert.equal(core.validateLlmInput(input).ok, false);
    return { id: `EL20-invalid-${index}`, op: 'llm', args: input };
  });
}
export function catalogCases(): Case[] {
  return [
    ...core.catalog.models.flatMap((model, i) => [
      { id: `EL02-model-${i}`, op: 'model', args: { provider: model.provider, model_name: model.name } },
      { id: `EL02-output-${i}`, op: 'llm_lookup', args: { provider: model.provider, model_name: model.name, output_token_count: 1000 } },
    ]),
    ...core.catalog.electricity_mixes.flatMap((mix, i) => [
      { id: `EL12-mix-${i}`, op: 'mix', args: { zone: mix.zone } },
      { id: `EL12-dense-${i}`, op: 'llm_lookup', args: { provider: 'cohere', model_name: 'command-a-03-2025', output_token_count: 1000, electricity_mix_zone: mix.zone } },
      { id: `EL12-moe-${i}`, op: 'llm_lookup', args: { provider: 'openai', model_name: 'gpt-4o', output_token_count: 1000, electricity_mix_zone: mix.zone } },
    ]),
    ...core.catalog.video.models.flatMap((model, i) => [true, false].flatMap(audio => [undefined, null, 'FRA'].map(zone => ({
      id: `EV01-${i}-${audio}-${zone}`, op: 'video_lookup', args: { model_name: model.model_name,
        resolution: model.capabilities.resolutions[0].join('x'), duration: 5, with_audio: audio,
        ...(zone === undefined ? {} : { datacenter_location: zone }),
      },
    })))),
  ];
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const at = process.argv.indexOf('--cases');
  const count = at < 0 ? 1000 : Number(process.argv[at + 1]);
  console.log(JSON.stringify(differential([...catalogCases(), ...numericalCases(count)]), null, 2));
}
