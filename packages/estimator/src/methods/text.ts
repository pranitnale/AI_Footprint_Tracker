import { D, type Dec } from "../numeric";
import type { MethodBundle } from "../bundle";
export type EnergyParts = {
  gpu: Dec | null;
  host: Dec | null;
  it: Dec | null;
  facility: Dec | null;
};
export function textEnergy(
  n: string,
  p: MethodBundle["profiles"][number],
  b: MethodBundle,
): EnergyParts {
  const s = b.settings,
    c = b.coefficients,
    batch = new D(s.batchSize),
    active = new D(p.activeBillions);
  const required = new D(p.totalBillions)
    .mul(s.memoryMultiplier)
    .mul(s.precisionBits)
    .div(8)
    .div(s.gpuMemoryGb)
    .ceil();
  let g = new D(1);
  while (g.lt(required)) g = g.mul(2);
  const gpu = new D(n)
    .mul(
      new D(c.energyAlpha)
        .mul(new D(c.energyBeta).mul(batch).exp())
        .mul(active)
        .plus(c.energyGamma),
    )
    .mul(g)
    .div(1000);
  const seconds = new D(n).mul(
    new D(c.latencyAlpha)
      .mul(active)
      .plus(new D(c.latencyBeta).mul(batch))
      .plus(c.latencyGamma),
  );
  const host = seconds
    .div(3600)
    .mul(s.hostPowerKw)
    .mul(g.div(s.serverGpuCount))
    .div(batch);
  return { gpu, host, it: gpu.plus(host), facility: null };
}
export function testLinearEnergy(
  n: string,
  p: MethodBundle["profiles"][number],
  b: MethodBundle,
): EnergyParts {
  return {
    gpu: null,
    host: null,
    it: new D(n).mul(b.coefficients.energyAlpha).mul(p.activeBillions),
    facility: null,
  };
}
