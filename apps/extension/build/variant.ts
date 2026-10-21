import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import configuration from "../../../config/estimation.build.json";
import identity from "../../../packages/ecologits-core/data/identity.json";
import upstreamLock from "../../../packages/ecologits-core/upstream/lock.json";

export const BUILD_ENGINES = ["ecologits"] as const;
export type BuildEngine = (typeof BUILD_ENGINES)[number];
export type BuildStatus = "development" | "intermediate" | "release_candidate";

export interface BuildVariant {
  controlled: boolean;
  defaultEngine: BuildEngine;
  status: BuildStatus;
}

interface ValidBuildConfiguration {
  schema_version: "1.0.0";
  default_engine: BuildEngine;
  available_engines: ["ecologits"];
}

const hash = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonical(child)]),
    );
  return value;
}

function isEngine(value: unknown): value is BuildEngine {
  return BUILD_ENGINES.includes(value as BuildEngine);
}

export function validateBuildConfiguration(
  value: unknown,
): asserts value is ValidBuildConfiguration {
  if (!value || typeof value !== "object")
    throw new Error("The checked-in build configuration is invalid");
  const candidate = value as Record<string, unknown>;
  const availableEngines = candidate.available_engines;
  if (
    candidate.schema_version !== "1.0.0" ||
    !isEngine(candidate.default_engine) ||
    !Array.isArray(availableEngines) ||
    availableEngines.length !== BUILD_ENGINES.length ||
    !BUILD_ENGINES.every((engine, index) => availableEngines[index] === engine)
  )
    throw new Error(
      "The checked-in build configuration must select EcoLogits; Original is archived",
    );
}

export function resolveBuildVariant(
  environment: Record<string, string | undefined> = process.env,
): BuildVariant {
  validateBuildConfiguration(configuration);
  const requested = environment.AIFT_BUILD_DEFAULT;
  const label = environment.AIFT_BUILD_VARIANT;
  const status = environment.AIFT_BUILD_STATUS;
  if (requested === undefined && label === undefined && status === undefined) {
    return {
      controlled: false,
      defaultEngine: configuration.default_engine,
      status: "development",
    };
  }
  if (!isEngine(requested) || label !== requested)
    throw new Error(
      "A controlled build requires matching ecologits AIFT_BUILD_DEFAULT and AIFT_BUILD_VARIANT values; Original is archived",
    );
  if (status !== "intermediate" && status !== "release_candidate")
    throw new Error(
      "A controlled build requires AIFT_BUILD_STATUS=intermediate or release_candidate",
    );
  return { controlled: true, defaultEngine: requested, status };
}

export function variantOutputTemplate(_variant: BuildVariant): string {
  return "{{browser}}-mv{{manifestVersion}}";
}

export function writeBuildVariantMetadata(
  output: string,
  browser: string,
  manifestVersion: number,
  variant: BuildVariant,
) {
  const sourceDateEpoch = Number(process.env.SOURCE_DATE_EPOCH ?? "1788998400");
  if (!Number.isSafeInteger(sourceDateEpoch) || sourceDateEpoch < 315532800)
    throw new Error("Invalid SOURCE_DATE_EPOCH");
  const licensePage = readFileSync(join(output, "licenses.html"));
  const sourceArchive = readFileSync(
    join(output, "source/ecologits-source.zip"),
  );
  const noticeInventory = readFileSync(join(output, "licenses/inventory.json"));
  const effectiveConfiguration = {
    ...configuration,
    default_engine: variant.defaultEngine,
  };
  const metadata = {
    schema_version: "1.0.0",
    variant_id: `${browser}-${variant.defaultEngine}`,
    build_status: variant.status,
    browser,
    manifest_version: manifestVersion,
    default_engine: variant.defaultEngine,
    available_engines: [...BUILD_ENGINES],
    user_override_enabled: false,
    configuration_sha256: hash(
      `${JSON.stringify(canonical(effectiveConfiguration))}\n`,
    ),
    ecologits: {
      upstream_version: identity.upstream_version,
      core_version: identity.core_version,
      core_sha256: identity.core_sha256,
      catalog_sha256: identity.catalog_sha256,
      source_artifact_sha256: identity.source_artifact_sha256,
      retained_source_manifest_sha256:
        upstreamLock.retained_source_manifest_sha256,
    },
    bundled_notices: {
      license_path: "licenses.html",
      license_sha256: hash(licensePage),
      source_path: "source/ecologits-source.zip",
      source_sha256: hash(sourceArchive),
      inventory_sha256: hash(noticeInventory),
    },
    source_date_epoch: sourceDateEpoch,
  };
  writeFileSync(
    join(output, "build-variant.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
  return metadata;
}
