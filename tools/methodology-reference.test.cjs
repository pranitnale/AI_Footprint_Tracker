const test = require('node:test');
const assert = require('node:assert/strict');
const profiles = require('../registry/text-reference-profiles-2026-09-09.json');
const { textReference, environmentalAllocation, highestComparable } = require('./methodology-reference.cjs');
const cohere = profiles.candidates.find(candidate => candidate.id === 'command-a-03-2025-h100-reference');
const near = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance, actual + ' != ' + expected);

test('Command A example reproduces the pinned equation arithmetic', () => {
  const value = textReference(cohere, 1000);
  near(value.memoryGb, 266.4);
  assert.equal(value.gpuCount, 4);
  near(value.durationSeconds, 114.7517814, 1e-7);
  near(value.gpuKwh * 1000, 0.4149368917, 1e-9);
  near(value.hostKwh * 1000, 0.2988327641, 1e-9);
  near(value.itKwh * 1000, 0.7137696558, 1e-9);
});

test('Reference electricity, carbon and water have the correct denominators and units', () => {
  const value = environmentalAllocation({ boundary: 'it', kwh: textReference(cohere, 1000).itKwh }, profiles.environment_scenario);
  near(value.facilityKwh * 1000, 0.7780089249, 1e-9);
  near(value.carbonGrams, 0.2990666307, 1e-9);
  near(value.directLitres * 1000, 0.7130558862, 1e-9);
  near(value.upstreamLitres * 1000, 2.4368017536, 1e-9);
  near(value.totalLitres * 1000, 3.1498576398, 1e-9);
});

test('Facility-energy input is not multiplied by PUE again', () => {
  const value = environmentalAllocation({ boundary: 'facility', kwh: 0.00024 }, { id: 'illustration', pue: 1.09, carbonGramsPerKwh: 345 });
  near(value.facilityKwh, 0.00024);
  near(value.carbonGrams, 0.0828);
});

test('Missing water component does not turn into a complete total or a zero', () => {
  const value = environmentalAllocation({ boundary: 'it', kwh: 0.001 }, { id: 'partial', pue: 1.09, directWueLitresPerItKwh: 1 });
  near(value.directLitres, 0.001);
  assert.equal(value.upstreamLitres, null);
  assert.equal(value.totalLitres, null);
  assert.equal(value.carbonGrams, null);
});

test('Unknown PUE preserves facility energy but cannot recover IT or direct water', () => {
  const value = environmentalAllocation({ boundary: 'facility', kwh: 0.001 }, { id: 'partial', pue: null, directWueLitresPerItKwh: 1 });
  assert.equal(value.itKwh, null);
  assert.equal(value.directLitres, null);
  assert.equal(value.facilityKwh, 0.001);
});

test('GPU-based environmental allocation remains explicitly component-scoped', () => {
  const value = environmentalAllocation({ boundary: 'gpu_component', kwh: 0.001 }, profiles.environment_scenario);
  assert.equal(value.scope, 'gpu_associated_reference');
  near(value.facilityKwh, 0.00109);
});

test('Throughput and regression duration are different recorded strategies', () => {
  const value = textReference(cohere, 1000, { tokensPerSecond: 26.8, timeToFirstToken: 0.59 });
  near(value.durationSeconds, 37.9034328358209);
  assert.equal(value.durationStrategy, 'throughput_reference');
  assert.ok(value.hostKwh < textReference(cohere, 1000).hostKwh);
});

test('Zero output, invalid parameters and out-of-domain workload do not yield plausible electricity', () => {
  for (const n of [0, -1, NaN, Infinity, 1.5, true, '']) assert.throws(() => textReference(cohere, n));
  assert.throws(() => textReference({ activeBillions: 201, totalBillions: 201 }, 1000), /domain/);
  assert.throws(() => textReference(cohere, 1000, { batchSize: 513 }), /domain/);
  assert.throws(() => textReference(cohere, 1000, { precisionBits: 8 }), /domain/);
});

test('Invalid PUE and withdrawal factors are rejected', () => {
  assert.throws(() => environmentalAllocation({ boundary: 'it', kwh: 1 }, { pue: 0.9 }), /PUE/);
  assert.throws(() => environmentalAllocation({ boundary: 'it', kwh: 1 }, { pue: 1.1, waterKind: 'withdrawal' }), /withdrawal/);
  assert.throws(() => environmentalAllocation({ boundary: 'it', kwh: 1 }, { pue: 1.1, carbonGramsPerKwh: '' }), /Invalid/);
});

test('The highest text reference is selected from the declared cohort, not from its label', () => {
  const candidates = profiles.candidates.map(candidate => ({ id: candidate.id, modality: 'text', workloadKey: 'illustration-1000',
    ...environmentalAllocation({ boundary: 'it', kwh: textReference(candidate, 1000).itKwh }, profiles.environment_scenario) }));
  const chosen = highestComparable(candidates, { modality: 'text', scope: 'modelled_it_reference', scenarioId: profiles.environment_scenario.id, workloadKey: 'illustration-1000' });
  assert.equal(chosen.selected.id, cohere.id);
  assert.equal(chosen.eligibleCount, 4);
  const expectedWh = [0.0810133, 0.5996802, 0.7471486, 0.7780089];
  candidates.forEach((candidate, index) => near(candidate.facilityKwh * 1000, expectedWh[index], 5e-8));
});

test('Winner carries its own environmental vector, not independently maximized metrics', () => {
  const common = { modality: 'text', scope: 'component', scenarioId: 'common', workloadKey: 'same' };
  const chosen = highestComparable([{ ...common, id: 'a', facilityKwh: 1, carbonGrams: 900, totalLitres: 50 }, { ...common, id: 'b', facilityKwh: 2, carbonGrams: 3, totalLitres: 4 }], common);
  assert.equal(chosen.selected.id, 'b');
  assert.equal(chosen.selected.carbonGrams, 3);
  assert.equal(chosen.selected.totalLitres, 4);
});

test('No cross-modality, cross-scope or cross-workload fallback is silently selected', () => {
  const candidate = { id: 'text', modality: 'text', scope: 'it', scenarioId: 'reference', workloadKey: '1000', facilityKwh: 1 };
  for (const override of [{ modality: 'image' }, { scope: 'gpu' }, { workloadKey: '2000' }, { scenarioId: 'other' }]) {
    assert.equal(highestComparable([candidate], { ...candidate, ...override }).status, 'no_comparable_profile');
  }
});

test('Tie order is ASCII profile identity, independent of incoming record order', () => {
  const common = { modality: 'text', scope: 'it', scenarioId: 'same', workloadKey: 'same', facilityKwh: 1 };
  const candidates = ['z', 'a-2', 'a-10'].map(id => ({ ...common, id }));
  assert.equal(highestComparable(candidates, common).selected.id, 'a-10');
  assert.equal(highestComparable(candidates.toReversed(), common).selected.id, 'a-10');
  assert.throws(() => highestComparable([candidates[0], candidates[0]], common), /duplicate/);
});

test('Missing comparator metadata is rejected rather than treated as a match', () => {
  assert.throws(() => highestComparable([{ id: 'scope-omitted', facilityKwh: 1 }], {}), /signature/);
  const valid = { id: 'valid', modality: 'text', scope: 'it', scenarioId: 'same', workloadKey: 'same', facilityKwh: 1 };
  for (const key of ['modality', 'scope', 'scenarioId', 'workloadKey']) {
    const invalid = { ...valid, [key]: '' };
    assert.throws(() => highestComparable([invalid], valid), /signature/);
    assert.throws(() => highestComparable([valid], invalid), /signature/);
  }
});
