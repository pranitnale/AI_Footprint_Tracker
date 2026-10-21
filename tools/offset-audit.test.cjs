const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const catalog = require('../registry/published-reference-evidence-2026-09-09.json');
const profiles = require('../registry/text-reference-profiles-2026-09-09.json');
const { textReference, environmentalAllocation } = require('./methodology-reference.cjs');
const { validatePublishedReferences } = require('./methodology-checks.cjs');
const article = fs.readFileSync(path.join(__dirname, '../docs/methodology/content.html'), 'utf8');
const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, actual + ' != ' + expected);

test('Offset published formula reproduces four conditional rows, not provider measurements', () => {
  const rows = [[0.34, 367, 0.162214, 2.84648], [0.24, 367, 0.114504, 2.00928], [0.35, 462, 0.21021, 2.9302], [0.43, 462, 0.258258, 3.59996]];
  for (const [wh, carbon, expectedCarbon, expectedWater] of rows) {
    near(wh / 1000 * 1.3 * carbon, expectedCarbon);
    near(wh / 1000 * 1.3 * (1.9 + 4.54) * 1000, expectedWater);
  }
  near(3.6 / (0.35 * 1.3), 7.912087912087913);
  near(4.7 / (0.43 * 1.3), 8.407871198568873);
});

test('Conditional direct-water correction removes only the extra direct-term PUE', () => {
  const value = environmentalAllocation({ boundary: 'it', kwh: 0.00034 }, { id: 'conditional-only', pue: 1.3, directWueLitresPerItKwh: 1.9, electricityWaterLitresPerKwh: 4.54 });
  near(value.directLitres * 1000, 0.646);
  near(value.upstreamLitres * 1000, 2.00668);
  near(value.totalLitres * 1000, 2.65268);
  near(0.34 * 1.3, 0.442);
  near(0.24 * 1.3 - 0.24, 0.072);
});

test('Published-reference catalog is explicitly non-runtime and preserves unknown boundaries', () => {
  assert.doesNotThrow(() => validatePublishedReferences(article, catalog));
  const runtime = structuredClone(catalog);
  runtime.runtime_selection_allowed = true;
  assert.throws(() => validatePublishedReferences(article, runtime), /not runtime/);
  const missing = structuredClone(catalog);
  delete missing.references[0].activity_period;
  assert.throws(() => validatePublishedReferences(article, missing), /Incomplete/);
  const wrongClass = structuredClone(catalog);
  wrongClass.references[0].evidence_type = 'plausible_but_undefined_class';
  assert.throws(() => validatePublishedReferences(article, wrongClass), /Unsupported evidence class/);
});

test('New source coefficients and worked comparison cannot silently drift apart', () => {
  const changed = structuredClone(catalog);
  changed.references.find(item => item.id === 'lbnl-us-datacenter-electricity-2023').electricity_water.value = '9.99';
  assert.throws(() => validatePublishedReferences(article, changed), /mismatch/);
  assert.throws(() => validatePublishedReferences(article.replace('0.2949107 Wh', '0.9 Wh'), catalog), /mismatch/);
  const changedScope = structuredClone(catalog);
  changedScope.references.find(item => item.id === 'eia-us-electricity-co2-2024').carbon.unit = 'lbCO2e/MWh';
  assert.throws(() => validatePublishedReferences(article, changedScope), /snapshot changed/);
});

test('Gas units and original activity units remain distinct', () => {
  const byId = new Map(catalog.references.map(item => [item.id, item]));
  assert.equal(byId.get('eia-us-electricity-co2-2024').carbon.unit, 'lbCO2/MWh');
  assert.equal(byId.get('lbnl-us-datacenter-electricity-2023').electricity_ghg.unit, 'gCO2e/kWh_supplied');
  near(785 * 453.59237 / 1000, 356.07001045);
  near(0.000085 * 3.785411784 * 1000, 0.32176000164);
  assert.deepEqual([500 / 50, 500 / 10], [10, 50]);
});

test('Current fixed text reference is linear in output and remains uncalibrated', () => {
  const source = profiles.candidates.find(item => item.id === 'command-a-03-2025-h100-reference');
  near(textReference(source, 1000).itKwh, 10 * textReference(source, 100).itKwh);
  assert.equal(profiles.calibration_status, 'published_surrogate_not_calibrated_to_consumer_services');
  assert.ok(profiles.production_promotion_requires.includes('held_out_energy_validation_before_calibrated_claims'));
  assert.ok(article.includes('changing input length alone does not change the energy estimate'));
  assert.ok(article.includes('Attributed footprints are not avoided impacts'));
});

test('Reference review appends after all previous methodology review leaves', () => {
  const screen = require('../design-canvas/screens.js').find(item => item.id === 'P02');
  const parts = screen.html.split('<!-- REFERENCE REVIEW ADDENDUM -->');
  assert.equal(parts.length, 2);
  const pattern = /<(h[1-4]|p|span|strong|b|small|label|button|td|th|li|output)\b[^>]*>((?:[^<]|<br\s*\/?>)*)<\/\1>|<input\b([^>]*)>/gi;
  const original = [...parts[0].matchAll(pattern)].filter(match => match[1] ? match[2].trim() : !/type\s*=\s*["']?checkbox/i.test(match[3]));
  assert.equal(original.length, 579);
  assert.ok(parts[1].includes('id="method-validation"'));
});
