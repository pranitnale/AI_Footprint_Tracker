// SPDX-License-Identifier: MPL-2.0
// Independent product-domain checks. These do not change the raw upstream calculations.
import { isRange, lower, upper, type ValueOrRange } from './values.js';
import { LLM_DEFAULTS } from './llm.js';
import { VIDEO_DEFAULTS, durationToFrames, parseResolution } from './video.js';
import { impact } from './modeling.js';

export type Admission = { ok: true } | { ok: false; reason: 'numeric-domain'; field: string };
function valid(value: unknown, positive: boolean): value is ValueOrRange {
  if (typeof value === 'number') return Number.isFinite(value) && (positive ? value > 0 : value >= 0);
  return isRange(value) && Object.keys(value).length === 2 && typeof value.min === 'number' && typeof value.max === 'number'
    && valid(value.min, positive) && valid(value.max, positive) && value.min <= value.max;
}
function validPue(value: unknown): boolean { return valid(value, true) && lower(value) >= 1; }
/** No coercion: persisted decimal counters must pass this check before conversion to binary64. */
export function admitTokenCount(value: unknown): { ok: true; value: number } | { ok: false; reason: 'numeric-domain'; field: string } {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value) || value.length > 16 || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { ok: false, reason: 'numeric-domain', field: 'output_token_count' };
  }
  return { ok: true, value: Number(value) };
}
const environmentFields = ['if_electricity_mix_adpe', 'if_electricity_mix_pe', 'if_electricity_mix_gwp', 'if_electricity_mix_wue', 'datacenter_pue', 'datacenter_wue'];
function record(input: unknown): input is Record<string, unknown> { return !!input && typeof input === 'object' && !Array.isArray(input); }
/** Run before resolveVideoInput/videoImpacts: lowering cannot preserve invalid duration/audio types. */
export function validateVideoLookupInput(input: unknown): Admission {
  const fail = (field: string): Admission => ({ ok: false, reason: 'numeric-domain', field });
  if (!record(input)) return fail('input');
  const allowed = ['model_name', 'resolution', 'duration', 'with_audio', 'datacenter_location', 'datacenter_pue', 'datacenter_wue'];
  if (Object.keys(input).some(key => !allowed.includes(key))) return fail('input');
  if (typeof input.model_name !== 'string' || input.model_name.length === 0) return fail('model_name');
  if (typeof input.resolution !== 'string' || input.resolution.length === 0 || input.resolution.length > 128) return fail('resolution');
  if (typeof input.duration !== 'number' || !Number.isFinite(input.duration) || input.duration <= 0) return fail('duration');
  if (Object.hasOwn(input, 'with_audio') && typeof input.with_audio !== 'boolean') return fail('with_audio');
  if (Object.hasOwn(input, 'datacenter_location') && input.datacenter_location !== null
    && (typeof input.datacenter_location !== 'string' || input.datacenter_location.length === 0)) return fail('datacenter_location');
  for (const field of ['datacenter_pue', 'datacenter_wue']) if (Object.hasOwn(input, field) && input[field] !== null && !valid(input[field], field === 'datacenter_pue')) return fail(field);
  if (Object.hasOwn(input, 'datacenter_pue') && input.datacenter_pue !== null && !validPue(input.datacenter_pue)) return fail('datacenter_pue');
  try {
    const [width, height] = parseResolution(input.resolution);
    const frames = durationToFrames(input.duration);
    for (const value of [width, height, frames]) if (!Number.isSafeInteger(value) || value <= 0) return fail('resolution');
    const area = width * height;
    if (![area, area ** 2, area * frames, frames ** 2].every(Number.isSafeInteger)) return fail('video_volume');
  } catch { return fail('resolution'); }
  return { ok: true };
}
export function validateLlmInput(input: unknown): Admission {
  const fail = (field: string): Admission => ({ ok: false, reason: 'numeric-domain', field });
  if (!record(input)) return fail('input');
  const required = [...environmentFields, 'model_active_parameter_count', 'model_total_parameter_count', 'output_token_count'];
  for (const key of required) if (!Object.hasOwn(input, key)) return fail(key);
  const allowed = [...required, ...Object.keys(LLM_DEFAULTS), 'request_latency'];
  if (!validPue(input.datacenter_pue)) return fail('datacenter_pue');
  for (const key of ['model_active_parameter_count', 'model_total_parameter_count'] as const) if (!valid(input[key], true)) return fail(key);
  if (lower(input.model_active_parameter_count as ValueOrRange) > lower(input.model_total_parameter_count as ValueOrRange)
    || upper(input.model_active_parameter_count as ValueOrRange) > upper(input.model_total_parameter_count as ValueOrRange)) return fail('model_active_parameter_count');
  if (typeof input.output_token_count !== 'number' || !Number.isSafeInteger(input.output_token_count) || input.output_token_count < 0) return fail('output_token_count');
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.includes(key)) return fail(key);
    if (value === null && ['tps', 'ttft', 'request_latency'].includes(key)) continue;
    if (!['model_active_parameter_count', 'model_total_parameter_count', 'datacenter_pue', 'datacenter_wue'].includes(key) && typeof value !== 'number') return fail(key);
    if (key.startsWith('gpu_energy_') || key.startsWith('latency_')) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return fail(key);
    } else if (!valid(value, ['tps', 'gpu_memory', 'model_quantization_bits', 'batch_size', 'server_gpu_count', 'server_lifetime', 'datacenter_pue'].includes(key))) return fail(key);
  }
  return { ok: true };
}
export function validateVideoInput(input: unknown): Admission {
  const fail = (field: string): Admission => ({ ok: false, reason: 'numeric-domain', field });
  if (!record(input)) return fail('input');
  const required = [...environmentFields, 'video_width', 'video_height', 'video_frames_count', 'server_accelerator_power',
    'accelerator_embodied_gwp', 'accelerator_embodied_adpe', 'accelerator_embodied_pe', 'server_embodied_gwp', 'server_embodied_adpe', 'server_embodied_pe'];
  for (const key of required) if (!Object.hasOwn(input, key)) return fail(key);
  const allowed = [...required, ...Object.keys(VIDEO_DEFAULTS), 'request_latency'];
  if (!validPue(input.datacenter_pue)) return fail('datacenter_pue');
  for (const [field, value] of Object.entries(input)) {
    if (!allowed.includes(field)) return fail(field);
    if (field === 'request_latency' && value === null) continue;
    if (!['datacenter_pue', 'datacenter_wue', 'server_accelerator_power'].includes(field) && typeof value !== 'number') return fail(field);
    if (['n', 'm', 'n1', 'm1', 'n2', 'm2', 'g'].includes(field)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false, reason: 'numeric-domain', field };
    } else if (!valid(value, ['video_width', 'video_height', 'video_frames_count', 'server_lifetime', 'server_accelerator_count', 'datacenter_pue'].includes(field))) return { ok: false, reason: 'numeric-domain', field };
  }
  for (const field of ['video_width', 'video_height', 'video_frames_count'] as const) {
    if (!Number.isSafeInteger(input[field])) return { ok: false, reason: 'numeric-domain', field };
  }
  // Python multiplies integer dimensions exactly before converting to float in the regression.
  const area = (input.video_width as number) * (input.video_height as number);
  if (!Number.isSafeInteger(area) || !Number.isSafeInteger(area ** 2) || !Number.isSafeInteger(area * (input.video_frames_count as number)) || !Number.isSafeInteger((input.video_frames_count as number) ** 2)) return fail('video_volume');
  return { ok: true };
}
export function validateImpacts(result: unknown): Admission {
  const fail = (field: string): Admission => ({ ok: false, reason: 'numeric-domain', field });
  if (!record(result)) return fail('result');
  const kinds = ['energy', 'gwp', 'adpe', 'pe', 'wcf'] as const;
  const top = [...kinds, 'usage', 'embodied'];
  if (Object.keys(result).some(key => ![...top, 'warnings', 'errors'].includes(key)) || top.some(key => !Object.hasOwn(result, key))) return fail('result');
  function metric(value: unknown, kind: typeof kinds[number], field: string): Admission {
    const expected = impact(kind, 0);
    if (!record(value) || Object.keys(value).length !== 4 || value.type !== expected.type || value.unit !== expected.unit || value.name !== expected.name || !valid(value.value, false)) return fail(field);
    return { ok: true };
  }
  for (const kind of kinds) { const status = metric(result[kind], kind, kind); if (!status.ok) return status; }
  for (const phase of ['usage', 'embodied'] as const) {
    const values = result[phase];
    const fields = phase === 'usage' ? kinds : ['gwp', 'adpe', 'pe'] as const;
    if (!record(values) || Object.keys(values).length !== fields.length + 2 || values.type !== phase || values.name !== (phase === 'usage' ? 'Usage' : 'Embodied')) return fail(phase);
    for (const kind of fields) { const status = metric(values[kind], kind, `${phase}.${kind}`); if (!status.ok) return status; }
  }
  for (const field of ['warnings', 'errors']) if (Object.hasOwn(result, field)) {
    const values = result[field];
    if (values !== null && (!Array.isArray(values) || values.some(value => !record(value) || Object.keys(value).length !== 2 || typeof value.code !== 'string' || typeof value.message !== 'string'))) return fail(field);
    if (field === 'errors' && Array.isArray(values) && values.length) return fail(field);
  }
  return { ok: true };
}
