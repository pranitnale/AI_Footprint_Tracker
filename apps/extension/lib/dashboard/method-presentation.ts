import type { MethodReason, MethodStatus } from "../method-service";
import type { EngineStatus } from "@footprint/contracts";
import type { CalculationResult } from "./types";
export const methodReasons: Record<MethodReason, string> = {
  trust_unconfigured:
    "Organization calculation updates are not configured. Built-in calculations remain available.",
  update_failed:
    "Calculation updates could not be checked. Previously verified methods remain available.",
  expired_delivery:
    "The latest delivery window has ended. Previously accepted methods remain available for selection.",
  stored_method_invalid:
    "Stored calculation methods could not be verified. Original estimates remain available.",
  scope_changed:
    "The organization connection changed while calculation methods were checked. Refresh the catalog for the current connection.",
  catalog_full:
    "No additional calculation methods can be stored. Previously verified methods remain available.",
};

export function formatReviewDate(value: string) {
  const date = new Date(value.length === 10 ? value + "T00:00:00Z" : value);
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

export function calculationLabel(
  calculation: CalculationResult | null,
  status: MethodStatus | null,
  engine?: EngineStatus | null,
) {
  if (!calculation) return "Calculation view unavailable";
  if (calculation.view === "original") return "Original recorded estimates";
  if (
    engine?.method?.method_hash === calculation.methodHash &&
    engine.method.method_id === calculation.methodId
  )
    return engine.method.engine_id === "ecologits"
      ? "EcoLogits recalculated estimates"
      : "Original calculation, recalculated estimates";
  return (
    status?.methods.find(
      (method) =>
        method.id === calculation.methodId &&
        method.hash === calculation.methodHash,
    )?.label ?? `Recalculated estimates (${calculation.methodId})`
  );
}

export function errorCode(error: unknown) {
  return error instanceof Error
    ? ((error as Error & { code?: string }).code ?? error.message)
    : "";
}

export function calculationError(error: unknown) {
  const code = errorCode(error);
  if (
    [
      "summary_response_invalid",
      "method_status_invalid",
      "tracking_health_invalid",
      "extension_response_invalid",
    ].includes(code) ||
    (error instanceof Error && error.name === "ZodError")
  )
    return "The response could not be verified. The last successful view remains shown. Try again to check the current data.";
  if (code === "scope_changed")
    return "The connection changed while recorded usage was loaded. Try again for the current scope.";
  if (code === "recalculation_pending")
    return "This recalculated view is still being prepared. The last successful view remains shown.";
  if (code === "method_unsupported")
    return "That calculation method is no longer available. The last successful view remains shown.";
  if (code === "method_update_invalid")
    return "The calculation method could not be verified. The last successful view remains shown.";
  return code || "Recorded usage could not be loaded.";
}
