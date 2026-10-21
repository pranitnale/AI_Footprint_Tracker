const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixture = require('../fixtures/context-energy-study-2026-09-09/sweetspot-llama31-8b.json');
const c = Object.fromEntries(Object.entries(fixture.coefficients).map(([key, value]) => [key, Number(value)]));
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, actual + ' != ' + expected);

// Reproduce one published research profile without connecting it to the estimator.
function studyJoules(input, output, options = {}) {
  if (Object.keys(options).length) throw new Error('Cache or serving changes require a separately supported method');
  for (const [value, domain] of [[input, fixture.input_domain], [output, fixture.output_domain]]) {
    if (!Number.isSafeInteger(value) || value < domain[0] || value > domain[1]) throw new Error('Outside the inspected study domain');
  }
  return c.theta0 * output + c.theta1 * input * input + c.theta2 * input * output
    + c.theta3 * input + c.theta4 * output * output + c.theta5;
}

test('Growing retained context differs from new output and cumulative usage', () => {
  let retained = 0, cumulativeInput = 0, cumulativeOutput = 0;
  const totals = [];
  for (let turn = 0; turn < 3; turn += 1) {
    const input = retained + 500, output = 500;
    cumulativeInput += input;
    cumulativeOutput += output;
    retained = input + output;
    totals.push(input + output);
  }
  assert.deepEqual(totals, [1000, 2000, 3000]);
  assert.equal(cumulativeInput, 4500);
  assert.equal(cumulativeOutput, 1500);
  assert.equal(retained, 3000);
});

test('Published six-coefficient equation reproduces the report examples', () => {
  for (const row of fixture.examples) {
    near(studyJoules(row.input, row.output), Number(row.joules));
    const perOutput = c.theta0 + c.theta1 * row.input ** 2 / row.output + c.theta2 * row.input
      + c.theta3 * row.input / row.output + c.theta4 * row.output + c.theta5 / row.output;
    near(perOutput * row.output, Number(row.joules));
  }
  const total = fixture.examples.reduce((sum, row) => sum + studyJoules(row.input, row.output), 0);
  near(total, 202.49724785);
  near(total / 3600, 0.056249235513888884);
});

test('Context sensitivity does not certify long-context extrapolation or cache savings', () => {
  assert.ok(studyJoules(2500, 500) > studyJoules(500, 500));
  for (const [input, output] of [[50000, 500], [500, 0], [63, 500], [500, 4097]]) {
    assert.throws(() => studyJoules(input, output), /study domain/);
  }
  assert.throws(() => studyJoules(1500, 500, { cachedInput: 1000 }), /separately supported/);
  assert.equal(fixture.runtime_selection_allowed, false);
  assert.equal(fixture.boundary, 'gpu_run_average');
});

test('Research report retains the calculated examples and their limitations', () => {
  const report = fs.readFileSync(path.join(__dirname, '../docs/research/CONTEXT-AWARE-ENERGY-RESEARCH-2026-09-09.md'), 'utf8');
  for (const row of fixture.examples) assert.ok(report.includes(row.joules));
  for (const value of Object.values(fixture.coefficients)) assert.ok(report.includes(value));
  assert.ok(report.includes('202.49724785'));
  assert.ok(report.includes('not Claude estimates'));
  assert.ok(report.includes('retain the current numerical reference settings'));
});
