import { z } from "zod";

export const CounterSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,18})$/)
  .refine(
    (v) =>
      /^(0|[1-9][0-9]{0,18})$/.test(v) && BigInt(v) <= 9223372036854775807n,
    "Counter overflow",
  );
export const DecimalSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$/)
  .refine((v) => v.replace(".", "").length <= 38, "Decimal overflow");
export const InstantSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine(
    (v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v,
    "Invalid calendar instant",
  );
export const OpaqueKeySchema = z.string().regex(/^[0-9a-f]{64}$/);

export const MethodIdentifierSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9.-]{0,127}$/);

// New binary64 results need scientific notation for quantities below legacy 18-place precision.
// Existing DecimalSchema and its archived wire meaning remain unchanged.
export const FiniteDecimalSchema = z
  .string()
  .max(96)
  .regex(/^-?(0|[1-9][0-9]*)(\.[0-9]+)?(e[+-]?[0-9]{1,3})?$/)
  .refine((value) => Number.isFinite(Number(value)), "Nonfinite quantity")
  .refine(
    (value) =>
      Number(value) !== 0 || /^-?0(\.0+)?(e[+-]?[0-9]{1,3})?$/.test(value),
    "Quantity underflow",
  );
export const NonnegativeFiniteDecimalSchema = FiniteDecimalSchema.refine(
  (value) => Number(value) >= 0 && !Object.is(Number(value), -0),
  "Negative quantity",
);

export function finiteDecimal(value: number): string {
  if (!Number.isFinite(value)) throw new Error("estimate_unavailable");
  return Object.is(value, -0) ? "0" : String(value);
}
