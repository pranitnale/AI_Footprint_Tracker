import { z } from "zod";

const positive = z
  .string()
  .regex(/^[0-9]+(\.[0-9]+)?$/)
  .refine((s) => Number(s) > 0 && Number(s) < 1e9);
const factor = z
  .string()
  .regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/)
  .refine((s) => Number(s) < 1e9)
  .nullable();

export const OriginalSourceSchema = z.strictObject({
  publisher: z.string(),
  title: z.string(),
  url: z.url(),
  section: z.string(),
  source_revision: z.string(),
  license: z.string(),
  access_date: z.string(),
  activity_period: z.string().nullable(),
  factor_data_period: z.string().nullable(),
  publication_date: z.string().nullable(),
  software_snapshot: z.string(),
  review_date: z.string(),
  unknown_period_reason: z.string(),
  population: z.string(),
  statistic: z.enum(["scenario_example", "measured_configuration"]),
});

export const OriginalScenarioSchema = z
  .strictObject({
    id: z.string(),
    pue: factor,
    carbon: factor,
    carbon_gas: z.enum(["CO2", "CO2e"]),
    carbon_boundary: z.enum(["generation", "lifecycle", "unknown"]),
    carbon_accounting: z.enum(["location", "market"]),
    gases: z.array(z.string()),
    gwp: z.string().nullable(),
    direct_water: factor,
    direct_denominator: z.enum(["it", "facility"]),
    upstream_water: factor,
    water_kind: z.literal("consumption"),
    direct_water_source: z.enum(["freshwater", "all_source", "unknown"]),
    upstream_water_source: z.enum(["freshwater", "all_source", "unknown"]),
    common_water_scope: z
      .enum(["freshwater_consumption", "all_source_consumption"])
      .nullable(),
    upstream_exclusions: z.array(z.string()),
    provenance: OriginalSourceSchema,
  })
  .refine((s) => s.pue === null || Number(s.pue) >= 1, "PUE below 1");

// This is the unchanged legacy schema. New engine data uses a separate contract.
export const OriginalMethodBundleSchema = z.strictObject({
  schema_version: z.literal("1.0.0"),
  method_id: z.string().regex(/^[a-z0-9.-]+$/),
  equation_id: z.enum(["ecologits-output-v1", "test-linear-v1"]),
  runtime_selection_allowed: z.literal(true),
  validation_state: z.literal("unvalidated_reference"),
  reviewer: z.string().min(1),
  review_date: z.string(),
  release_validation: z.literal("pending"),
  coefficients: z.strictObject({
    energyAlpha: positive,
    energyBeta: z.string().regex(/^-[0-9]+\.[0-9]+$/),
    energyGamma: positive,
    latencyAlpha: positive,
    latencyBeta: positive,
    latencyGamma: positive,
  }),
  settings: z.strictObject({
    gpuMemoryGb: positive,
    precisionBits: z.literal("16"),
    batchSize: positive,
    memoryMultiplier: positive,
    hostPowerKw: positive,
    serverGpuCount: positive,
  }),
  profiles: z
    .array(
      z.strictObject({
        id: z.string(),
        model: z.string(),
        activeBillions: positive,
        totalBillions: positive,
        architecture_source: z.url(),
      }),
    )
    .min(1)
    .max(1000),
  scenario: OriginalScenarioSchema,
  provenance: OriginalSourceSchema,
  missing_components: z.array(z.string()),
});

export type OriginalMethodBundle = z.infer<typeof OriginalMethodBundleSchema>;
export type OriginalScenario = z.infer<typeof OriginalScenarioSchema>;
