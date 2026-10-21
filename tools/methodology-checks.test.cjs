const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { verifyReferencePayloads, validateMethodologyNumerics } = require('./methodology-checks.cjs');
const text = require('../registry/text-reference-profiles-2026-09-09.json');
const article = fs.readFileSync(path.join(__dirname, '../docs/methodology/content.html'), 'utf8');

test('Published coefficient, input, output and cohort examples agree with the reviewed registry', () => {
  assert.doesNotThrow(() => validateMethodologyNumerics(article, text));
});

test('Changes to any pinned numeric record or provenance require explicit review', () => {
  const changedText = structuredClone(text);
  changedText.coefficients.latencyGamma = '0.02';
  assert.throws(() => verifyReferencePayloads(changedText), /text registry changed/);
});

test('A prose/table arithmetic edit cannot pass a fresh generated-page check', () => {
  assert.throws(() => validateMethodologyNumerics(article.replace('0.7780089 Wh', '0.9780089 Wh'), text), /Facility electricity/);
  assert.throws(() => validateMethodologyNumerics(article.replace('−0.011205921025579175', '−0.011'), text), /b_E/);
});
