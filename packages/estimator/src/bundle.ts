import {
  payloadHash,
  OriginalMethodBundleSchema as BundleSchema,
  OriginalScenarioSchema as ScenarioSchema,
  type OriginalMethodBundle as MethodBundle,
  type OriginalScenario as Scenario,
} from "@footprint/contracts";
import raw from "../data/baseline.json";
export const BASELINE_METHOD_ID = "ecologits-reference-2026-09-10-v1";
export { BundleSchema, ScenarioSchema };
export type { MethodBundle, Scenario };
export function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
export function approveBundle(input: unknown): Readonly<MethodBundle> {
  const b = BundleSchema.parse(input);
  if (
    new Set(b.profiles.map((p) => p.id)).size !== b.profiles.length ||
    b.profiles.some(
      (p) =>
        Number(p.activeBillions) > Number(p.totalBillions) ||
        Number(p.totalBillions) > 200,
    )
  )
    throw new Error("method_update_invalid");
  if (b.equation_id === "test-linear-v1" && !b.method_id.startsWith("test-"))
    throw new Error("method_update_invalid");
  return deepFreeze(b);
}
export const BASELINE_BUNDLE = approveBundle(raw);
export const BASELINE_METHOD_HASH = payloadHash(BASELINE_BUNDLE);
