import { z } from "zod";
import {
  EngineIdSchema,
  EngineMethodIdentitySchema,
  EnginePreferenceSchema,
} from "./engine-policy";
import {
  InstantSchema,
  MethodIdentifierSchema,
  OpaqueKeySchema,
} from "./scalars";

export const EngineScopeSchema = z.strictObject({
  namespace: z.string().min(1).max(256),
  mode: z.enum(["personal", "company"]),
  era: z.string().max(256).nullable(),
});
export const EngineSelectionRequestSchema = z.strictObject({
  preference: EnginePreferenceSchema,
  expectedRevision: z.number().int().min(1).max(2147483647).nullable(),
});
export type EngineSelectionRequest = z.infer<
  typeof EngineSelectionRequestSchema
>;

export const EngineStatusSchema = z.strictObject({
  schema_version: z.literal("1.0.0"),
  scope: EngineScopeSchema,
  scopeToken: z.string().min(1).max(256),
  preference: EnginePreferenceSchema.nullable(),
  selectionRevision: z.number().int().min(1).max(2147483647).nullable(),
  buildDefault: EngineIdSchema,
  effectiveEngine: EngineIdSchema.nullable(),
  method: EngineMethodIdentitySchema.nullable(),
  local: z.strictObject({
    status: z.enum(["idle", "running", "complete", "pending", "failed"]),
    jobId: z.string().max(128).nullable(),
    processed: z.number().int().nonnegative(),
    unavailable: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
  }),
  organization: z.strictObject({
    status: z.enum([
      "personal",
      "current",
      "pending",
      "unavailable",
      "invalidated",
    ]),
    reason: z
      .enum([
        "sync_delayed",
        "method_unsupported",
        "deletion_changed",
        "auth_reconnect_required",
        "policy_unavailable",
      ])
      .nullable(),
  }),
  reason: z
    .enum([
      "invalid_preference",
      "engine_unavailable",
      "selection_conflict",
      "storage_write_failed",
      "estimate_unavailable",
      "policy_unavailable",
    ])
    .nullable(),
});
export type EngineStatus = z.infer<typeof EngineStatusSchema>;

export const OrganizationSelectionRequestSchema = z.strictObject({
  preference: EnginePreferenceSchema,
  selection_revision: z.number().int().min(1).max(2147483647),
  method_id: MethodIdentifierSchema,
  method_hash: OpaqueKeySchema,
  operation_id: z.uuid(),
});
export type OrganizationSelectionRequest = z.infer<
  typeof OrganizationSelectionRequestSchema
>;
export const OrganizationSelectionResponseSchema = z
  .strictObject({
    selection: OrganizationSelectionRequestSchema.extend({
      selection_generation: z.number().int().min(1),
      job_id: OpaqueKeySchema,
      updated_at: InstantSchema,
    }).nullable(),
    compatibility: z
      .strictObject({
        status: z.enum(["supported", "pending"]),
        reason: z
          .enum([
            "method_unsupported",
            "method_hash_mismatch",
            "engine_mismatch",
            "engine_unavailable",
          ])
          .nullable(),
      })
      .nullable(),
    recalculation: z
      .union([
        z.strictObject({
          job_id: OpaqueKeySchema,
          status: z.literal("invalidated"),
          completed_at: z.null(),
          error_code: z.literal("deletion_changed"),
        }),
        z.strictObject({
          job_id: OpaqueKeySchema,
          method_id: MethodIdentifierSchema,
          calculation_view: z.literal("recalculated"),
          status: z.enum([
            "pending",
            "completed",
            "failed",
            "invalidated",
            "superseded",
          ]),
          processed_estimates: z.number().int().nonnegative(),
          created_at: InstantSchema,
          completed_at: InstantSchema.nullable(),
          error_code: z
            .string()
            .regex(/^[a-z][a-z0-9_]{0,127}$/)
            .nullable(),
          requires_advance: z.literal(false),
          selection_revision: z.number().int().min(1),
          selection_generation: z.number().int().min(1),
        }),
      ])
      .nullable(),
  })
  .superRefine((value, context) => {
    if (
      value.selection === null
        ? value.compatibility !== null || value.recalculation !== null
        : value.compatibility === null || value.recalculation === null
    ) {
      context.addIssue({
        code: "custom",
        message: "Incomplete organization selection",
      });
    }
    if (value.selection && value.recalculation) {
      if (
        value.selection.job_id !== value.recalculation.job_id ||
        ("method_id" in value.recalculation &&
          (value.recalculation.method_id !== value.selection.method_id ||
            value.recalculation.selection_revision !==
              value.selection.selection_revision ||
            value.recalculation.selection_generation !==
              value.selection.selection_generation))
      ) {
        context.addIssue({
          code: "custom",
          message: "Organization selection binding mismatch",
        });
      }
    }
  });
export type OrganizationSelectionResponse = z.infer<
  typeof OrganizationSelectionResponseSchema
>;
