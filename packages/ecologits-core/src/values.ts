// SPDX-License-Identifier: MPL-2.0
// Derived from EcoLogits 0.11.1 utils/range_value.py. See ../NOTICE.md.
export interface RangeValue { readonly min: number; readonly max: number }
export type ValueOrRange = number | RangeValue;

/** Raw source errors. Product callers should expose their own sanitized diagnostics. */
export class EcoLogitsError extends Error {
  constructor(readonly pythonType: string, message: string) {
    super(message);
    this.name = pythonType;
  }
}

export function isRange(value: unknown): value is RangeValue {
  return typeof value === 'object' && value !== null && 'min' in value && 'max' in value;
}

/** This preserves upstream endpoint pairing. It is not general interval arithmetic. */
export function range(min: number, max: number): RangeValue {
  if (min > max) throw new EcoLogitsError('ValidationError', 'min value must be lower than max value');
  return { min, max };
}
export const lower = (value: ValueOrRange): number => isRange(value) ? value.min : value;
export const upper = (value: ValueOrRange): number => isRange(value) ? value.max : value;
export const mean = (value: ValueOrRange): number => isRange(value) ? (value.min + value.max) / 2 : value;
export function add(a: ValueOrRange, b: ValueOrRange): ValueOrRange {
  return isRange(a) || isRange(b) ? range(lower(a) + lower(b), upper(a) + upper(b)) : a + b;
}
export function multiply(a: ValueOrRange, b: ValueOrRange): ValueOrRange {
  return isRange(a) || isRange(b) ? range(lower(a) * lower(b), upper(a) * upper(b)) : a * b;
}
function quotient(a: number, b: number): number {
  if (b === 0) throw new EcoLogitsError('ZeroDivisionError', 'division by zero');
  return a / b;
}
/** Upstream reverse division aliases forward division: scalar / range becomes range / scalar. */
export function divide(a: ValueOrRange, b: ValueOrRange): ValueOrRange {
  if (isRange(a) && isRange(b)) {
    // Reverse division first produces nested ranges, then Pydantic rejects the endpoints.
    divide(a.min, b);
    divide(a.max, b);
    throw new EcoLogitsError('ValidationError', 'RangeValue endpoints must be scalar numbers');
  }
  if (isRange(b)) return range(quotient(b.min, a as number), quotient(b.max, a as number));
  if (isRange(a)) return range(quotient(a.min, b), quotient(a.max, b));
  return quotient(a, b);
}
export function equal(a: ValueOrRange, b: ValueOrRange): boolean {
  return lower(a) === lower(b) && upper(a) === upper(b);
}
export function less(a: ValueOrRange, b: ValueOrRange): boolean { return upper(a) < lower(b); }
export function greater(a: ValueOrRange, b: ValueOrRange): boolean { return lower(a) > upper(b); }
export function lessEqual(a: ValueOrRange, b: ValueOrRange): boolean {
  return isRange(a) ? upper(a) <= upper(b) : a <= lower(b);
}
export function greaterEqual(a: ValueOrRange, b: ValueOrRange): boolean {
  return isRange(a) ? lower(a) >= lower(b) : a >= upper(b);
}
