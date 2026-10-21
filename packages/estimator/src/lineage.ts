import { UNAVAILABLE_ADMISSION_METHOD_ID } from "@footprint/contracts";

export interface OriginalLineageOptions {
  view?: "original" | "recalculated";
  originalMethodHash?: string;
  originalMethodMissing?: boolean;
}

/** Only a validated live admission marker can establish that no original method existed. */
export function admitsMissingOriginalMethod(
  family: "live" | "history",
  proposedMethodId: string | null,
  options: OriginalLineageOptions,
): boolean {
  if (
    options.originalMethodMissing !== undefined &&
    typeof options.originalMethodMissing !== "boolean"
  ) {
    throw new Error("method_update_invalid");
  }
  if (options.originalMethodMissing !== true) {
    if (proposedMethodId === UNAVAILABLE_ADMISSION_METHOD_ID)
      throw new Error("method_update_invalid");
    return false;
  }
  if (
    family !== "live" ||
    proposedMethodId !== UNAVAILABLE_ADMISSION_METHOD_ID ||
    options.view !== "recalculated" ||
    options.originalMethodHash != null
  ) {
    throw new Error("method_update_invalid");
  }
  return true;
}
