import { ScenarioSchema, type Scenario } from "../bundle";
import { D, type Dec } from "../numeric";
export function environmentalAllocation(
  value: Dec | string,
  boundary: "gpu" | "it" | "facility",
  input: Scenario,
) {
  const scenario = ScenarioSchema.parse(input);
  const kwh = new D(value);
  if (!kwh.isFinite() || kwh.isNegative())
    throw new Error("factor_incompatible");
  const it =
    boundary === "facility"
      ? scenario.pue === null
        ? null
        : kwh.div(scenario.pue)
      : kwh;
  const facility =
    boundary === "facility"
      ? kwh
      : scenario.pue === null
        ? null
        : kwh.mul(scenario.pue);
  const carbon =
    facility === null || scenario.carbon === null
      ? null
      : facility.mul(scenario.carbon);
  const waterBase = scenario.direct_denominator === "it" ? it : facility;
  const direct =
    waterBase === null || scenario.direct_water === null
      ? null
      : waterBase.mul(scenario.direct_water);
  const upstream =
    facility === null || scenario.upstream_water === null
      ? null
      : facility.mul(scenario.upstream_water);
  const compatible =
    scenario.direct_water_source !== "unknown" &&
    scenario.direct_water_source === scenario.upstream_water_source &&
    scenario.common_water_scope ===
      scenario.direct_water_source + "_consumption";
  const total =
    direct === null || upstream === null || !compatible
      ? null
      : direct.plus(upstream);
  return { it, facility, carbon, direct, upstream, total };
}
