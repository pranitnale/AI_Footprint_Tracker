// SPDX-License-Identifier: MPL-2.0
// Derived from EcoLogits 0.11.1 impacts/video.py and estimations/video.py. See ../NOTICE.md.
import { executeDag, type Asset, type DagValues } from './dag.js';
import { assertKeys, type EnvironmentInput, scalar } from './llm.js';
import { impactsFromDag, type Impacts } from './modeling.js';
import { add, divide, EcoLogitsError, multiply, type ValueOrRange } from './values.js';

export const VIDEO_DEFAULTS = Object.freeze({ n: 0, m: 0, n1: 0, m1: 0, n2: 0, m2: 0, g: 0,
  non_audio_weight: 1, server_accelerator_count: 8, server_lifetime: 3 * 365 * 24 * 60 * 60 });
/** Power is kW despite the upstream low-level docstring saying W. */
export interface VideoInput extends EnvironmentInput, Partial<Record<keyof typeof VIDEO_DEFAULTS, number>> {
  video_width: number; video_height: number; video_frames_count: number;
  server_accelerator_power: ValueOrRange;
  accelerator_embodied_gwp: number; accelerator_embodied_adpe: number; accelerator_embodied_pe: number;
  server_embodied_gwp: number; server_embodied_adpe: number; server_embodied_pe: number;
  request_latency?: number | null;
}
const v = (x: DagValues, key: string): ValueOrRange => {
  const value = x[key];
  if (value === null || value === undefined) throw new EcoLogitsError('TypeError', `Missing required argument: ${key}`);
  return value;
};
const s = (x: DagValues, key: string): number => scalar(x[key]);
const asset = (dependencies: readonly string[], run: Asset['run']): Asset => ({ dependencies, run });
export const videoAssets: Readonly<Record<string, Asset>> = Object.freeze({
  generation_latency: asset(['video_width', 'video_height', 'video_frames_count', 'n', 'm', 'n1', 'm1', 'n2', 'm2', 'g', 'non_audio_weight', 'request_latency'], x => {
    const area = s(x, 'video_width') * s(x, 'video_height');
    const frames = s(x, 'video_frames_count');
    const volume = area * frames / 1000;
    const latency = (
      s(x, 'n') * frames * area ** 2 + s(x, 'm') * volume + s(x, 'm1') * frames
      + s(x, 'm2') * area ** 2 + s(x, 'n1') * frames ** 2 + s(x, 'n2') * volume ** 2 + s(x, 'g')
    ) * s(x, 'non_audio_weight');
    return s(x, 'request_latency') < latency ? s(x, 'request_latency') : latency;
  }),
  server_accelerator_energy: asset(['generation_latency', 'server_accelerator_power'], x => multiply(divide(v(x, 'generation_latency'), 3600), v(x, 'server_accelerator_power'))),
  request_energy: asset(['datacenter_pue', 'server_accelerator_energy'], x => multiply(v(x, 'datacenter_pue'), v(x, 'server_accelerator_energy'))),
  request_usage_gwp: asset(['request_energy', 'if_electricity_mix_gwp'], x => multiply(v(x, 'request_energy'), v(x, 'if_electricity_mix_gwp'))),
  request_usage_adpe: asset(['request_energy', 'if_electricity_mix_adpe'], x => multiply(v(x, 'request_energy'), v(x, 'if_electricity_mix_adpe'))),
  request_usage_pe: asset(['request_energy', 'if_electricity_mix_pe'], x => multiply(v(x, 'request_energy'), v(x, 'if_electricity_mix_pe'))),
  request_usage_wcf: asset(['server_accelerator_energy', 'if_electricity_mix_wue', 'datacenter_wue', 'datacenter_pue'], x => multiply(v(x, 'server_accelerator_energy'), add(v(x, 'datacenter_wue'), multiply(v(x, 'datacenter_pue'), v(x, 'if_electricity_mix_wue'))))),
  ...Object.fromEntries(['gwp', 'adpe', 'pe'].flatMap(kind => [
    [`server_accelerator_embodied_${kind}`, asset([`server_embodied_${kind}`, 'server_accelerator_count', `accelerator_embodied_${kind}`], x => add(v(x, `server_embodied_${kind}`), multiply(v(x, 'server_accelerator_count'), v(x, `accelerator_embodied_${kind}`))))],
    [`request_embodied_${kind}`, asset([`server_accelerator_embodied_${kind}`, 'server_lifetime', 'generation_latency'], x => multiply(divide(v(x, 'generation_latency'), v(x, 'server_lifetime')), v(x, `server_accelerator_embodied_${kind}`)))],
  ])),
});
for (const asset of Object.values(videoAssets)) { Object.freeze(asset.dependencies); Object.freeze(asset); }
export function executeVideoDag(inputs: DagValues): DagValues { return executeDag(videoAssets, inputs); }
export function computeVideoImpactsDag(input: VideoInput & { request_latency: number }): DagValues {
  assertKeys(input, [...Object.keys(VIDEO_DEFAULTS), 'video_width', 'video_height', 'video_frames_count', 'request_latency',
    'server_accelerator_power', 'if_electricity_mix_adpe', 'if_electricity_mix_pe', 'if_electricity_mix_gwp', 'if_electricity_mix_wue',
    'datacenter_pue', 'datacenter_wue', 'accelerator_embodied_gwp', 'accelerator_embodied_adpe', 'accelerator_embodied_pe',
    'server_embodied_gwp', 'server_embodied_adpe', 'server_embodied_pe']);
  return executeVideoDag({ ...VIDEO_DEFAULTS, ...input });
}
export function computeVideoImpacts(input: VideoInput): Impacts {
  return impactsFromDag(computeVideoImpactsDag({ ...input, request_latency: input.request_latency ?? Infinity }));
}
export function durationToFrames(duration: number): number {
  const frames = duration * 24 + 1;
  if (!Number.isFinite(frames)) throw new EcoLogitsError(Number.isNaN(frames) ? 'ValueError' : 'OverflowError', 'cannot convert nonfinite float to integer');
  const integer = Math.trunc(frames);
  return integer === 0 ? 0 : integer;
}
/** Supports the upstream names and Python-style decimal integer strings. */
export function parseResolution(resolution: string): [number, number] {
  const strip = (text: string) => text.replace(/^[\p{White_Space}\x1c-\x1f]+|[\p{White_Space}\x1c-\x1f]+$/gu, '');
  const key = strip(resolution).toLowerCase();
  const named: Record<string, [number, number]> = { '720p': [1280, 720], '1080p': [1920, 1080], '4k': [3840, 2160] };
  if (Object.hasOwn(named, key)) return named[key];
  const parts = key.split('x');
  if (parts.length !== 2) throw new EcoLogitsError('ValueError', `Unsupported resolution: ${resolution}`);
  const integer = (part: string): number => {
    // Python int accepts all Unicode decimal digits. Adjacent Nd blocks are multiples of ten.
    const text = [...strip(part)].map(character => {
      if (!/\p{Decimal_Number}/u.test(character)) return character;
      const codepoint = character.codePointAt(0)!;
      let start = codepoint;
      while (start > 0 && /\p{Decimal_Number}/u.test(String.fromCodePoint(start - 1))) start--;
      return String((codepoint - start) % 10);
    }).join('');
    if (!/^[+-]?[0-9](?:_?[0-9])*$/.test(text)) throw new EcoLogitsError('ValueError', `invalid literal for int() with base 10: '${part}'`);
    const value = Number(text.replaceAll('_', ''));
    return value === 0 ? 0 : value;
  };
  return [integer(parts[0]), integer(parts[1])];
}
