import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as core from '../src/index.js';
import { differential, llmBase, videoBase } from '../tools/differential.js';
import { boundaryCases } from './fixtures.js';

test('EL04-EL22 and EV02/03/08/10/11: permanent boundary and source-quirk corpus', () => {
  console.log(JSON.stringify(differential(boundaryCases())));
});

test('EL16-18 and EV11/12: strict product domain stays separate from raw source behavior', () => {
  assert.deepEqual(core.admitTokenCount('9007199254740991'), { ok: true, value: Number.MAX_SAFE_INTEGER });
  for (const value of ['9007199254740992', '9223372036854775807', '', '01', '-1', '1.0', 1, true, null]) assert.equal(core.admitTokenCount(value).ok, false);
  assert.equal(core.validateLlmInput(llmBase).ok, true);
  for (const value of [NaN, Infinity, -1, '1', true, null, { min: 2, max: 1 }]) assert.equal(core.validateLlmInput({ ...llmBase, output_token_count: value }).ok, false);
  for (const input of [{}, null, { ...llmBase, raw_text: 'not allowed' }, { ...llmBase, tps: 0 }, { ...llmBase, datacenter_pue: null }, { ...llmBase, batch_size: { min: 1, max: 2 } }]) assert.equal(core.validateLlmInput(input).ok, false);
  assert.equal(core.validateLlmInput({ ...llmBase, gpu_energy_beta: -0.1 }).ok, true);
  assert.equal(core.validateVideoInput(videoBase).ok, true);
  for (const input of [{}, { ...videoBase, video_width: 0 }, { ...videoBase, video_height: 1.5 }, { ...videoBase, video_width: 1e100 }, { ...videoBase, with_audio: true }]) assert.equal(core.validateVideoInput(input).ok, false);
  const negative = core.computeVideoImpacts({ ...videoBase, server_accelerator_power: 5, m: 0, g: -1 });
  assert.equal(core.validateImpacts(negative).ok, false);
  assert.equal(core.validateImpacts(core.computeLlmImpacts(llmBase)).ok, true);
  assert.equal(core.validateImpacts({}).ok, false);
  assert.equal(core.validateImpacts({ ...core.computeLlmImpacts(llmBase), raw_text: 'not allowed' }).ok, false);
  assert.equal(core.validateImpacts(core.llmImpacts({ provider: 'unknown', model_name: 'x', output_token_count: 1 })).ok, false);
});

test('EL21: repeated calls cannot change catalogs or defaults', () => {
  const before = JSON.stringify(core.catalog);
  const first = core.llmImpacts({ provider: 'openai', model_name: 'gpt-4o', output_token_count: 1000 });
  core.videoImpacts({ model_name: core.catalog.video.models[0].model_name, resolution: '720p', duration: 5, with_audio: false });
  assert.deepEqual(core.llmImpacts({ provider: 'openai', model_name: 'gpt-4o', output_token_count: 1000 }), first);
  assert.equal(JSON.stringify(core.catalog), before);
  assert.throws(() => { (core.catalog.models as any[]).push({}); }, TypeError);
  assert.throws(() => { (core.llmAssets.gpu_energy as any).run = () => 0; }, TypeError);
  const warning = core.warningFromCode('model-arch-not-released');
  const result = core.output(core.computeLlmImpacts(llmBase));
  const warned = core.addOutputWarning(result, warning);
  assert.deepEqual(core.addOutputWarning(warned, warning).warnings, [warning]);
  assert.equal(result.warnings, null);
  const error = core.errorFromCode('zone-not-registered');
  const errored = core.addOutputError(core.addOutputError(result, error), error);
  assert.equal(errored.errors?.length, 2);
  assert.equal(result.errors, null);
});

test('RL09/18: an explicit catalog runtime isolates compatible data and never changes the baseline', () => {
  const model = { ...core.catalog.models[0], name: 'synthetic-compatible-model' };
  const mutable = JSON.parse(JSON.stringify({ ...core.catalog, models: [...core.catalog.models, model] })) as core.Catalog;
  const runtime = core.createCatalogRuntime(mutable);
  const request = { provider: model.provider, model_name: model.name, output_token_count: 1000 };
  assert.deepEqual(runtime.llmImpacts(request), core.llmImpacts({ ...request, model_name: core.catalog.models[0].name }));
  assert.equal(core.findModel(model.provider, model.name), null);
  (mutable.models as any[]).length = 0;
  assert.ok(runtime.findModel(model.provider, model.name));
  assert.throws(() => { (runtime.catalog.models as any[]).length = 0; }, TypeError);
  assert.throws(() => core.createCatalogRuntime({ ...core.catalog, schema_version: 'unknown' }), core.EcoLogitsError);
  assert.throws(() => core.createCatalogRuntime({ ...core.catalog, models: [...core.catalog.models, core.catalog.models[0]] }), core.EcoLogitsError);
  assert.throws(() => core.createCatalogRuntime({ ...core.catalog, provider_configurations: {} }), core.EcoLogitsError);
  const warnings = { ...core.catalog.warning_messages, 'model-arch-not-released': { code: 'model-arch-not-released', message: 'Synthetic changed warning' } };
  const custom = core.createCatalogRuntime({ ...core.catalog, warning_messages: warnings });
  assert.equal(custom.warningFromCode('model-arch-not-released').message, 'Synthetic changed warning');
  assert.equal(custom.modelFromJson({ provider: 'openai', name: 'synthetic', architecture: { type: 'dense', parameters: 70 }, warnings: ['model-arch-not-released'] }).warnings[0].message, 'Synthetic changed warning');
  assert.equal(custom.electricityMixFromJson({ name: 'TEST', adpe: 1, pe: 2, gwp: 3, wue: 4, warnings: ['model-arch-not-released'] }).warnings[0].message, 'Synthetic changed warning');
  assert.notEqual(core.warningFromCode('model-arch-not-released').message, 'Synthetic changed warning');
});
