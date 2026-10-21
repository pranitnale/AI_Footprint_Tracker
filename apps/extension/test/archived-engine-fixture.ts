import configuration from "../../../config/estimation.build.json";
import mappings from "../../../config/estimation.mappings.json";
import media from "../../../config/estimation.media.json";
import {
  createMethodRegistry,
  LocalEstimateExecutor,
} from "@footprint/estimator";

// Historical compatibility tests must not depend on the current product default.
export const archivedConfiguration = {
  ...configuration,
  default_engine: "original",
  available_engines: ["original", "ecologits"],
};
const methods = createMethodRegistry(archivedConfiguration, mappings, media);
export const archivedEstimation = {
  methods,
  executor: new LocalEstimateExecutor(methods),
};

/**
 * Waits for the coordinator's startup estimation pass. A capture is saved in two commits,
 * the request first and its original estimate after counting. A startup pass that reads
 * the first capture between them finds an input without an original estimate and starts
 * a recalculation, which moves the local view from original to recalculated figures. The
 * servers in these tests answer only the original view, so their company figures would
 * be refused (seen under load on 14 Oct 2026).
 */
export async function settleStartup(coordinator: {
  whenReady(): Promise<void>;
  engines: { maintainLocal(): Promise<void> };
}) {
  await coordinator.whenReady();
  await coordinator.engines.maintainLocal();
}
