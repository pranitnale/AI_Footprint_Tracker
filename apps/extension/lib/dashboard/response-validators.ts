import { REASON_CODES } from "@footprint/contracts";
import type { MethodStatus } from "../method-service";
import type {
  CalculationResult,
  RecalculationResult,
  TrackingHealthResponse,
} from "./types";
import { methodReasons } from "./method-presentation";
export const scopeTokenPattern = /^[a-f0-9]{64}$/;
export function validatedMethodStatus(value: unknown): MethodStatus {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("method_status_invalid");
  const status = value as MethodStatus;
  const states = ["baseline_only", "loading", "current", "stale", "failed"];
  const reasons = Object.keys(methodReasons);
  if (
    !states.includes(status.state) ||
    !scopeTokenPattern.test(status.scopeToken) ||
    (status.reason !== null && !reasons.includes(status.reason)) ||
    typeof status.canRefresh !== "boolean" ||
    !/^[a-z0-9][a-z0-9.-]{0,127}$/.test(status.defaultMethodId) ||
    !Array.isArray(status.methods) ||
    status.methods.length < 1 ||
    status.methods.length > 32 ||
    (status.checkedAt !== null &&
      !Number.isFinite(Date.parse(status.checkedAt))) ||
    (status.lastValidAt !== null &&
      !Number.isFinite(Date.parse(status.lastValidAt)))
  )
    throw new Error("method_status_invalid");
  const ids = new Set<string>();
  for (const method of status.methods) {
    let url: URL;
    try {
      url = new URL(method.provenance.url);
    } catch {
      throw new Error("method_status_invalid");
    }
    if (
      !/^[a-z0-9][a-z0-9.-]{0,127}$/.test(method.id) ||
      !/^[a-f0-9]{64}$/.test(method.hash) ||
      !method.label ||
      method.label.length > 160 ||
      /[\u0000-\u001f\u007f]/.test(method.label) ||
      !["packaged", "enrollment"].includes(method.source) ||
      typeof method.expiredForNewAdmission !== "boolean" ||
      !method.provenance ||
      !method.provenance.publisher ||
      method.provenance.publisher.length > 160 ||
      /[\u0000-\u001f\u007f]/.test(method.provenance.publisher) ||
      !method.provenance.title ||
      method.provenance.title.length > 160 ||
      /[\u0000-\u001f\u007f]/.test(method.provenance.title) ||
      method.provenance.url.length > 2048 ||
      !Number.isFinite(Date.parse(method.provenance.reviewDate)) ||
      url.protocol !== "https:" ||
      ids.has(method.id)
    )
      throw new Error("method_status_invalid");
    ids.add(method.id);
  }
  if (!ids.has(status.defaultMethodId))
    throw new Error("method_status_invalid");
  return status;
}

export function validatedCalculation(value: unknown): CalculationResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as CalculationResult;
  if (
    !["original", "recalculated"].includes(result.view) ||
    (result.pending !== undefined && typeof result.pending !== "boolean") ||
    (result.view === "original" &&
      (result.methodId !== null || result.methodHash !== null)) ||
    (result.view === "recalculated" &&
      (!result.methodId ||
        !/^[a-z0-9][a-z0-9.-]{0,127}$/.test(result.methodId) ||
        !result.methodHash ||
        !/^[a-f0-9]{64}$/.test(result.methodHash)))
  )
    return null;
  return result;
}

export function validatedRecalculation(value: unknown): RecalculationResult {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("recalculation_status_invalid");
  const result = value as RecalculationResult;
  if (
    !/^[a-f0-9]{64}$/.test(result.jobId) ||
    !/^[a-z0-9][a-z0-9.-]{0,127}$/.test(result.methodId) ||
    !["pending", "completed", "failed", "invalidated"].includes(
      result.status,
    ) ||
    !Number.isSafeInteger(result.processedEstimates) ||
    result.processedEstimates < 0 ||
    ![
      null,
      "recalculation_pending",
      "deletion_changed",
      "recalculation_failed",
    ].includes(result.error)
  )
    throw new Error("recalculation_status_invalid");
  return result;
}

export function validatedTrackingHealth(
  value: unknown,
): TrackingHealthResponse {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("tracking_health_invalid");
  const response = value as TrackingHealthResponse;
  if (
    !["available", "unavailable"].includes(response.status) ||
    !Array.isArray(response.health) ||
    // Saved problems are kept once they close, one per code for this scope and one for the
    // extension, so this is the most a valid answer can hold.
    response.health.length > 2 * REASON_CODES.length ||
    (response.scopeToken !== undefined &&
      !scopeTokenPattern.test(response.scopeToken))
  )
    throw new Error("tracking_health_invalid");
  for (const issue of response.health) {
    if (
      !issue ||
      !REASON_CODES.includes(issue.code) ||
      ![
        issue.at,
        issue.firstAt,
        issue.lastAt,
        ...(issue.resolvedAt === null ? [] : [issue.resolvedAt]),
      ].every(
        (at) =>
          Number.isSafeInteger(at) && at >= 0 && at <= 8_640_000_000_000_000,
      ) ||
      issue.firstAt > issue.lastAt ||
      !Number.isSafeInteger(issue.count) ||
      issue.count < 1 ||
      !["persisted", "memory"].includes(issue.persistence) ||
      !["current", "extension"].includes(issue.scope) ||
      !["unresolved", "resolved", "inactive"].includes(issue.state)
    )
      throw new Error("tracking_health_invalid");
  }
  return response;
}
