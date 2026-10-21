// SPDX-License-Identifier: MPL-2.0
// Derived from EcoLogits 0.11.1 impacts/modeling.py and tracers/utils.py. See ../NOTICE.md.
import { add, equal, greaterEqual, lessEqual, EcoLogitsError, type ValueOrRange } from './values.js';

export interface Impact {
  readonly type: string;
  readonly name: string;
  readonly value: ValueOrRange;
  readonly unit: string;
}
export interface StatusMessage { readonly code: string; readonly message: string }
export interface Usage {
  readonly type: 'usage'; readonly name: 'Usage';
  readonly energy: Impact; readonly gwp: Impact; readonly adpe: Impact; readonly pe: Impact; readonly wcf: Impact;
}
export interface Embodied {
  readonly type: 'embodied'; readonly name: 'Embodied';
  readonly gwp: Impact; readonly adpe: Impact; readonly pe: Impact;
}
export interface Impacts {
  readonly energy: Impact; readonly gwp: Impact; readonly adpe: Impact; readonly pe: Impact; readonly wcf: Impact;
  readonly usage: Usage; readonly embodied: Embodied;
}
export interface ImpactsOutput {
  readonly energy: Impact | null; readonly gwp: Impact | null; readonly adpe: Impact | null;
  readonly pe: Impact | null; readonly wcf: Impact | null;
  readonly usage: Usage | null; readonly embodied: Embodied | null;
  readonly warnings: readonly StatusMessage[] | null; readonly errors: readonly StatusMessage[] | null;
}
const metadata = {
  energy: ['energy', 'Energy', 'kWh'],
  gwp: ['GWP', 'Global Warming Potential', 'kgCO2eq'],
  adpe: ['ADPe', 'Abiotic Depletion Potential (elements)', 'kgSbeq'],
  pe: ['PE', 'Primary Energy', 'MJ'],
  wcf: ['WCF', 'Water Consumption Footprint', 'L'],
} as const;
export function impact(kind: keyof typeof metadata, value: ValueOrRange): Impact {
  const [type, name, unit] = metadata[kind];
  return { type, name, value, unit };
}
/** Source checks the type, but does not separately check the unit. */
export function addImpacts(a: Impact, b: Impact): Impact {
  if (!b || typeof b !== 'object' || !('type' in b)) throw new EcoLogitsError('ModelingError', 'Cannot add an Impact with a non-Impact.');
  if (a.type !== b.type) throw new EcoLogitsError('ModelingError', `Error occurred, cannot add a ${a.type} Impact with ${b.type} Impact.`);
  return { ...a, value: add(a.value, b.value) };
}
export function compareImpacts(a: Impact, b: Impact, operation: 'equal' | 'less' | 'lessEqual' | 'greater' | 'greaterEqual'): boolean {
  if (!b || typeof b !== 'object' || !('type' in b)) throw new EcoLogitsError('ModelingError', 'Cannot compare an Impact with a non-Impact.');
  if (a.type !== b.type) throw new EcoLogitsError('ModelingError', `Error occurred, cannot compare a ${a.type} Impact with ${b.type} Impact.`);
  if (operation === 'equal') return equal(a.value, b.value);
  if (operation === 'lessEqual') return lessEqual(a.value, b.value);
  if (operation === 'greaterEqual') return greaterEqual(a.value, b.value);
  // functools.total_ordering derives these from __le__, not RangeValue.__lt__.
  if (operation === 'less') return lessEqual(a.value, b.value) && !equal(a.value, b.value);
  return !lessEqual(a.value, b.value);
}
export function addOutputWarning(result: ImpactsOutput, warning: StatusMessage): ImpactsOutput {
  if (result.warnings?.some(value => value.code === warning.code)) return result;
  return { ...result, warnings: [...result.warnings ?? [], warning] };
}
export function addOutputError(result: ImpactsOutput, error: StatusMessage): ImpactsOutput {
  return { ...result, errors: [...result.errors ?? [], error] };
}
export const resultFields = [
  'request_energy', 'request_usage_gwp', 'request_usage_adpe', 'request_usage_pe', 'request_usage_wcf',
  'request_embodied_gwp', 'request_embodied_adpe', 'request_embodied_pe',
] as const;
export function impactsFromDag(results: Record<string, ValueOrRange | null>): Impacts {
  const value = (key: string): ValueOrRange => {
    const v = results[key];
    if (v === null || v === undefined) throw new EcoLogitsError('ValidationError', `Missing impact ${key}`);
    return v;
  };
  const usage: Usage = {
    type: 'usage', name: 'Usage', energy: impact('energy', value('request_energy')),
    gwp: impact('gwp', value('request_usage_gwp')), adpe: impact('adpe', value('request_usage_adpe')),
    pe: impact('pe', value('request_usage_pe')), wcf: impact('wcf', value('request_usage_wcf')),
  };
  const embodied: Embodied = {
    type: 'embodied', name: 'Embodied', gwp: impact('gwp', value('request_embodied_gwp')),
    adpe: impact('adpe', value('request_embodied_adpe')), pe: impact('pe', value('request_embodied_pe')),
  };
  return { energy: usage.energy, gwp: addImpacts(usage.gwp, embodied.gwp),
    adpe: addImpacts(usage.adpe, embodied.adpe), pe: addImpacts(usage.pe, embodied.pe),
    wcf: usage.wcf, usage, embodied };
}
export function output(impacts: Impacts, warnings: readonly StatusMessage[] = []): ImpactsOutput {
  const unique = warnings.filter((w, i) => warnings.findIndex(x => x.code === w.code) === i);
  return { ...impacts, warnings: unique.length ? unique : null, errors: null };
}
export function errorOutput(code: string, message: string): ImpactsOutput {
  return { energy: null, gwp: null, adpe: null, pe: null, wcf: null, usage: null, embodied: null,
    warnings: null, errors: [{ code, message }] };
}
