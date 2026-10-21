import {
  finiteDecimal,
  SerializedEcoLogitsOutputSchema,
  ProductMetricSchema,
  type EstimateReason,
  type ProductMetric,
  type SerializedEcoLogitsOutput,
} from "@footprint/contracts";
import type {
  Impact,
  ImpactsOutput,
  ValueOrRange,
} from "@footprint/ecologits-core";
import type { Metric } from "../original";

export function serializeImpactValue(
  value: ValueOrRange,
): string | { min: string; max: string } {
  return typeof value === "number"
    ? finiteDecimal(value)
    : { min: finiteDecimal(value.min), max: finiteDecimal(value.max) };
}
function serializeMetric(value: Impact | null) {
  return value === null
    ? null
    : {
        type: value.type,
        name: value.name,
        unit: value.unit,
        value: serializeImpactValue(value.value),
      };
}
export function serializeEcoLogitsOutput(
  value: ImpactsOutput,
): SerializedEcoLogitsOutput {
  return SerializedEcoLogitsOutputSchema.parse({
    energy: serializeMetric(value.energy),
    gwp: serializeMetric(value.gwp),
    adpe: serializeMetric(value.adpe),
    pe: serializeMetric(value.pe),
    wcf: serializeMetric(value.wcf),
    usage:
      value.usage === null
        ? null
        : {
            type: value.usage.type,
            name: value.usage.name,
            energy: serializeMetric(value.usage.energy),
            gwp: serializeMetric(value.usage.gwp),
            adpe: serializeMetric(value.usage.adpe),
            pe: serializeMetric(value.usage.pe),
            wcf: serializeMetric(value.usage.wcf),
          },
    embodied:
      value.embodied === null
        ? null
        : {
            type: value.embodied.type,
            name: value.embodied.name,
            gwp: serializeMetric(value.embodied.gwp),
            adpe: serializeMetric(value.embodied.adpe),
            pe: serializeMetric(value.embodied.pe),
          },
    warnings:
      value.warnings === null
        ? null
        : value.warnings.map((warning) => ({ ...warning })),
    errors:
      value.errors === null
        ? null
        : value.errors.map((error) => ({ ...error })),
  });
}

export function unavailableMetric(
  unit: ProductMetric["unit"],
  scope: ProductMetric["scope"],
  reasons: readonly EstimateReason[],
): ProductMetric {
  return {
    value: null,
    unit,
    scope,
    status: "unavailable",
    phase: "usage",
    scenario_low: null,
    scenario_high: null,
    interval_kind: null,
    value_kind: "unavailable",
    reasons: [...reasons],
  };
}
export function projectLegacyMetric(
  metric: Metric,
  scope: ProductMetric["scope"],
): ProductMetric {
  return ProductMetricSchema.parse({
    ...metric,
    scope,
    phase: "usage",
    interval_kind: null,
    value_kind: metric.value === null ? "unavailable" : "scalar",
  });
}

/** Unit conversion and midpoint display are product projection; the full source result is retained. */
export function projectImpactValue(
  value: ValueOrRange,
  unit: ProductMetric["unit"],
  scope: ProductMetric["scope"],
  reasons: readonly EstimateReason[],
  scale = 1,
): ProductMetric {
  if (typeof value === "number") {
    return ProductMetricSchema.parse({
      ...unavailableMetric(unit, scope, reasons),
      value: finiteDecimal(value * scale),
      status: "partial_estimate",
      value_kind: "scalar",
    });
  }
  const lower = value.min * scale;
  const upper = value.max * scale;
  return ProductMetricSchema.parse({
    value: finiteDecimal((lower + upper) / 2),
    unit,
    scope,
    status: "partial_estimate",
    phase: "usage",
    scenario_low: finiteDecimal(lower),
    scenario_high: finiteDecimal(upper),
    interval_kind: "upstream_approximation",
    value_kind: "midpoint",
    reasons: [...reasons],
  });
}
