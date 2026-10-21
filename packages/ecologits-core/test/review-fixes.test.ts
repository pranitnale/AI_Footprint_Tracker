import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compare, differential, encode, invalidNumericalCases, llmBase, numericalCases } from '../tools/differential.js';
import { resolveVideoInput, validateLlmInput, validateVideoInput, validateVideoLookupInput, videoImpacts } from '../src/index.js';
import { videoBase } from '../tools/differential.js';
import { validateReferences, type SourceMap } from '../tools/check_references.js';
import sourceMap from '../source-to-port-map.json';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('F1: direct frames, GPU count, dimensions and DAG discrete fields reject tiny mutations', () => {
  // The old unscoped comparator invocation must fail rather than silently use float tolerance.
  assert.throws(() => (compare as Function)(121.000000001, 121, 'EV03-probe.value'));
  assert.throws(() => compare(121, 121, 'probe.value', undefined, 'unknown-operation'));
  for (const [actual, expected, path, op] of [
    [121.000000001, 121, 'probe.value', 'frames'],
    [[1920.00000001, 1080], [1920, 1080], 'probe.value', 'resolution'],
    [32.000000001, 32, 'probe.value', 'gpu_count'],
    [4.00000000001, 4, 'probe.value.gpu_required_count', 'llm_dag'],
  ] as const) assert.throws(() => compare(actual, expected, path, undefined, op));
  compare(121, 121, 'probe.value', undefined, 'frames');
  compare(1 + 1e-11, 1, 'probe.value.energy.value', 'kWh', 'llm');
});

test('F1: near-zero sign and zero classification is symmetric, including signed zero', () => {
  for (const [actual, expected] of [[-1e-20, 1e-20], [0, 1e-20], [1e-20, 0], [0, -1e-20], [-1e-20, 0], [-0, 0], [0, -0], [Infinity, 1], [NaN, 1]]) {
    assert.throws(() => compare(actual, expected, 'probe.value.energy.value', 'kWh', 'llm'));
  }
  compare(1e-20 + 1e-25, 1e-20, 'probe.value.energy.value', 'kWh', 'llm');
  assert.deepEqual(encode(-0), { $float: '-0' });
  assert.equal(encode(0), 0);
});

test('F2: lookup admission rejects invalid duration/audio before raw lowering', () => {
  const base = { model_name: 'klingai/kling-v1.6', resolution: '720p', duration: 5 };
  assert.deepEqual(validateVideoLookupInput(base), { ok: true });
  for (const duration of [0, -0, -1, NaN, Infinity, -Infinity, true, false, '5', null, undefined]) {
    assert.equal(validateVideoLookupInput({ ...base, duration }).ok, false, String(duration));
  }
  for (const with_audio of ['false', null, 0, 1, undefined]) assert.equal(validateVideoLookupInput({ ...base, with_audio }).ok, false);
  for (const with_audio of [true, false]) assert.deepEqual(validateVideoLookupInput({ ...base, with_audio }), { ok: true });
  for (const resolution of [null, false, 720, '', '0x720', '-1x720', '1.5x720', '99999999999999999x720']) assert.equal(validateVideoLookupInput({ ...base, resolution }).ok, false);
  for (const input of [{ ...base, datacenter_pue: '1.2' }, { ...base, datacenter_location: 1 }, { ...base, request_latency: 1 }]) assert.equal(validateVideoLookupInput(input).ok, false);
  const zero = { ...base, duration: 0 };
  const lowered = resolveVideoInput(zero);
  assert.ok('input' in lowered);
  assert.equal(lowered.input.video_frames_count, 1);
  assert.equal(validateVideoInput(lowered.input).ok, true);
  assert.ok(videoImpacts(zero).energy);
  assert.equal(validateVideoLookupInput(zero).ok, false);
});

test('F3: NaN TTFT and signed-zero transport agree with actual Python on raw surfaces', () => {
  const cases = ['llm', 'llm_dag'].flatMap(op => [NaN, 0, -0].map(ttft => ({ id: `F3-${op}-${Object.is(ttft, -0) ? '-0' : ttft}`, op,
    args: { ...llmBase, ttft, ...(op === 'llm_dag' ? { request_latency: Infinity } : {}) } })));
  cases.push({ id: 'F3-negative-zero-cap', op: 'llm', args: { ...llmBase, ttft: 0, request_latency: -0 } });
  differential(cases);
  assert.equal(validateLlmInput({ ...llmBase, ttft: NaN }).ok, false);
});

test('Oracle raw JSON decoding preserves range dictionaries while recursively decoding float markers', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const script = [
    'import math, sys', "sys.path.insert(0, 'oracle')", 'from run import decode',
    "decoded = decode({'items': [{'value': {'min': {'$float': '-0'}, 'max': 1}}], 'scalar': {'$float': '-0'}}, range_values=False)",
    "assert type(decoded['items'][0]['value']) is dict",
    "assert math.copysign(1, decoded['items'][0]['value']['min']) == -1",
    "assert math.copysign(1, decoded['scalar']) == -1",
    "assert type(decode({'value': {'min': 0, 'max': 1}})['value']).__name__ == 'RangeValue'",
  ].join('\n');
  const run = spawnSync('uv', ['run', '--project', 'oracle', '--offline', '--frozen', 'python', '-X', 'utf8', '-c', script], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
});

test('EL20: valid seeded whole workloads meet admission; invalid samples are separate', () => {
  const cases = numericalCases(1000);
  assert.equal(cases.filter(c => c.op === 'llm').length, 1000);
  for (const item of cases.filter(c => c.op === 'llm')) assert.equal(validateLlmInput(item.args).ok, true, item.id);
  const invalid = invalidNumericalCases(100);
  for (const item of invalid) assert.equal(validateLlmInput(item.args).ok, false, item.id);
  differential(invalid);
});

test('Product admission: PUE endpoints must be at least one; signed regressions remain valid', () => {
  for (const pue of [0, 0.5, { min: 0.9, max: 1.5 }]) {
    assert.equal(validateLlmInput({ ...llmBase, datacenter_pue: pue }).ok, false);
    assert.equal(validateVideoInput({ ...videoBase, datacenter_pue: pue }).ok, false);
    assert.equal(validateVideoLookupInput({ model_name: 'x', resolution: '720p', duration: 5, datacenter_pue: pue }).ok, false);
  }
  for (const pue of [1, { min: 1, max: 1.5 }]) {
    assert.equal(validateLlmInput({ ...llmBase, datacenter_pue: pue, gpu_energy_beta: -0.1 }).ok, true);
    assert.equal(validateVideoInput({ ...videoBase, datacenter_pue: pue, g: -1 }).ok, true);
  }
});

test('F4: nonexistent implementation files, symbols, fixtures and false exclusions are rejected', () => {
  validateReferences(sourceMap as SourceMap);
  for (const patch of [{ port: 'src/does-not-exist.ts' }, { implementation: 'doesNotExist' }, { implementation: 'llmAssets.notAnAsset' },
    { fixtures: ['fixture-that-does-not-exist'] }, { fixtures: [] }, { disposition: 'excluded', reason: 'Explicitly excluded for this test only.' }]) {
    const broken = structuredClone(sourceMap) as SourceMap;
    Object.assign(broken.functions_and_types[0], patch);
    assert.throws(() => validateReferences(broken));
  }
});

test('F4: source checker rejects mutated hashes, omitted source inventories and Python symbols', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const mutations: SourceMap[] = [];
  const wrongHash = structuredClone(sourceMap) as SourceMap; wrongHash.functions_and_types[0].source_sha256 = '0'.repeat(64); mutations.push(wrongHash);
  const omitted = structuredClone(sourceMap) as SourceMap; omitted.functions_and_types = omitted.functions_and_types.filter(row => row.upstream_file !== 'ecologits/status_messages.py'); mutations.push(omitted);
  const pythonSymbol = structuredClone(sourceMap) as SourceMap; pythonSymbol.functions_and_types.find(row => row.port?.endsWith('.py'))!.implementation = 'doesNotExist'; mutations.push(pythonSymbol);
  const falseExclusion = structuredClone(sourceMap) as SourceMap;
  Object.assign(falseExclusion.functions_and_types[0], { disposition: 'excluded', port: null, implementation: null, fixtures: [], reason: 'This required mathematical function is falsely excluded by the negative test.' });
  mutations.push(falseExclusion);
  for (const broken of mutations) {
    const run = spawnSync('uv', ['run', '--project', 'oracle', '--offline', '--frozen', 'python', '-X', 'utf8', 'tools/check_surface.py', '--stdin'], { cwd: root, input: JSON.stringify(broken), encoding: 'utf8' });
    assert.notEqual(run.status, 0);
    assert.ok(run.stderr.includes('AssertionError'));
  }
});
