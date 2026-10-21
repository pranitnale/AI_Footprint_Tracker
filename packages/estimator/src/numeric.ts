import Decimal from "decimal.js";
export const D = Decimal.clone({
  precision: 48,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -100,
  toExpPos: 100,
});
export type Dec = Decimal;
// Base units have an explicit 18-place serialization contract in both runtimes.
export function fixed(value: Dec | null): string | null {
  if (value === null) return null;
  if (!value.isFinite() || value.isNegative() || value.gte("1e20"))
    throw new Error("estimate_unavailable");
  return value.toFixed(18).replace(/\.?0+$/, "") || "0";
}
