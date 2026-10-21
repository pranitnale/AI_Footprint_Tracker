import {
  createMethodRegistry,
  LocalEstimateExecutor,
} from "@footprint/estimator";
import buildConfiguration from "../../../../config/estimation.build.json";
import mappings from "../../../../config/estimation.mappings.json";
import media from "../../../../config/estimation.media.json";

declare const __AIFT_DEFAULT_ENGINE__: "original" | "ecologits" | undefined;

const defaultEngine =
  typeof __AIFT_DEFAULT_ENGINE__ === "undefined"
    ? buildConfiguration.default_engine
    : __AIFT_DEFAULT_ENGINE__;

export const packagedBuildConfiguration = Object.freeze({
  ...buildConfiguration,
  default_engine: defaultEngine,
});

/** Build inputs are immutable data. Neither catalog import nor enrollment changes these policies. */
export const packagedMethods = createMethodRegistry(
  packagedBuildConfiguration,
  mappings,
  media,
);
export const createLocalExecutor = () =>
  new LocalEstimateExecutor(packagedMethods);
