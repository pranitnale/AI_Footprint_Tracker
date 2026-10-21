#!/usr/bin/env node
import { copyFile, mkdir, readFile, rename, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import {
  CATALOG_SCHEMA,
  TOOL_VERSION,
  assertAllowedOptions,
  assertNoSymlinkPath,
  assertCommit,
  containedPath,
  copyArtifact,
  copyTree,
  download,
  ensureNewDirectory,
  exists,
  extractTarGz,
  fileRecord,
  hashTree,
  jsonBytes,
  parseArgs,
  portablePath,
  readJson,
  requireOption,
  sha256File,
  validateRelativePath,
  writeJson,
} from "./lib/common.mjs";
import { validateAcceptedRetention } from "./lib/retention.mjs";

const args = parseArgs(process.argv.slice(2), ["allow-prerelease"]);
assertAllowedOptions(args, [
  "allow-prerelease",
  "repository-root",
  "stage",
  "version",
  "commit",
  "core-commit",
  "catalog-commit",
  "qualified-label",
  "core-version",
  "converter-version",
  "python-project",
  "overlay",
  "package-archive",
  "source-archive",
  "core-source-archive",
  "catalog-source-archive",
]);
const repositoryRoot = resolve(args["repository-root"] ?? process.cwd());
const requestedStage = resolve(requireOption(args, "stage"));
const version = requireOption(args, "version");
if (!/^\d+\.\d+\.\d+(?:[a-z0-9.-]+)?$/i.test(version))
  throw new Error("--version must be an explicit release version");
if (!/^\d+\.\d+\.\d+$/.test(version) && !args["allow-prerelease"])
  throw new Error("Pre-releases require --allow-prerelease");

let coreCommit;
let catalogCommit;
if (args.commit) {
  if (args["core-commit"] || args["catalog-commit"])
    throw new Error(
      "Use --commit or the explicit core/catalog commit pair, not both",
    );
  coreCommit = catalogCommit = assertCommit(args.commit);
} else {
  coreCommit = assertCommit(requireOption(args, "core-commit"), "core-commit");
  catalogCommit = assertCommit(
    requireOption(args, "catalog-commit"),
    "catalog-commit",
  );
}
const officialCombination = coreCommit === catalogCommit;
const qualifiedLabel = args["qualified-label"] ?? null;
if (!officialCombination && !qualifiedLabel)
  throw new Error("A mixed core/catalog candidate requires --qualified-label");
if (officialCombination && qualifiedLabel)
  throw new Error(
    "--qualified-label is only valid for a mixed immutable commit candidate",
  );
if (qualifiedLabel && !/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(qualifiedLabel))
  throw new Error("--qualified-label must be a short portable identifier");
if (
  args["core-version"] &&
  !/^[a-z0-9][a-z0-9._+-]{0,79}$/i.test(args["core-version"])
)
  throw new Error("--core-version must be a short portable identifier");
if (
  args["converter-version"] &&
  !/^[a-z0-9][a-z0-9._+-]{0,79}$/i.test(args["converter-version"])
)
  throw new Error("--converter-version must be a short portable identifier");
const snapshotDirectory = officialCombination
  ? `ecologits-${version}`
  : `ecologits-${version}-qualified-${qualifiedLabel}`;

const coreRoot = join(repositoryRoot, "packages/ecologits-core");
const acceptedIdentity = await readJson(join(coreRoot, "data/identity.json"));
const acceptedLock = await readJson(join(coreRoot, "upstream/lock.json"));
const acceptedCatalog = await readJson(join(coreRoot, "data/catalog.json"));
const sourceMap = await readJson(join(coreRoot, "source-to-port-map.json"));
if (sourceMap.schema_version !== 2)
  throw new Error("Unsupported source-to-port map schema");
const acceptedSnapshot =
  acceptedLock.snapshot_directory ??
  `ecologits-${acceptedIdentity.upstream_version}`;
if (validateRelativePath(acceptedSnapshot).includes("/"))
  throw new Error(
    "Accepted snapshot_directory must name one upstream directory",
  );
if (
  (acceptedIdentity.snapshot_directory !== undefined &&
    acceptedIdentity.snapshot_directory !== acceptedSnapshot) ||
  acceptedLock.upstream_version !== acceptedIdentity.upstream_version
)
  throw new Error("Accepted identity and lock describe different snapshots");
const acceptedSource = containedPath(coreRoot, `upstream/${acceptedSnapshot}`);
await assertNoSymlinkPath(repositoryRoot, acceptedSource);
const acceptedRetention = await readJson(
  join(coreRoot, "upstream/retained-source.json"),
);
await validateAcceptedRetention(acceptedSource, acceptedRetention);
const retainedHashes = Object.fromEntries(
  Object.entries(acceptedRetention.retained_files).map(([path, record]) => [
    path,
    record.sha256,
  ]),
);
if (!jsonBytes(retainedHashes).equals(jsonBytes(acceptedLock.files)))
  throw new Error(
    "Accepted lock and retained source manifest describe different retained files",
  );
if (
  (await sha256File(join(coreRoot, "upstream/retained-source.json"))) !==
  acceptedLock.retained_source_manifest_sha256
)
  throw new Error("Accepted lock does not bind retained-source.json");
if (
  acceptedRetention.source_artifact.sha256 !==
  acceptedLock.source_artifact.sha256
)
  throw new Error(
    "Accepted lock and retained source manifest describe different source artifacts",
  );
const pythonProject = resolve(
  repositoryRoot,
  args["python-project"] ?? "packages/ecologits-core/oracle",
);
if (!(await exists(join(pythonProject, "uv.lock"))))
  throw new Error(`Locked Python project is missing uv.lock: ${pythonProject}`);
const overlayPath = args.overlay ? resolve(repositoryRoot, args.overlay) : null;
if (overlayPath && !(await exists(overlayPath)))
  throw new Error(`Product overlay does not exist: ${overlayPath}`);
if (overlayPath) {
  const overlayRelative = relative(repositoryRoot, overlayPath);
  validateRelativePath(portablePath(overlayRelative));
}

if (await exists(requestedStage))
  throw new Error(`Stage already exists: ${requestedStage}`);
const temporaryStage = `${requestedStage}.building-${process.pid}`;
await ensureNewDirectory(temporaryStage);

async function obtainLocalOrRemote(localPath, destination, url, hosts) {
  return localPath
    ? {
        mode: "local",
        ...(await copyArtifact(resolve(localPath), destination)),
      }
    : { mode: "network", ...(await download(url, destination, hosts)) };
}

try {
  const downloads = join(temporaryStage, "downloads");
  await mkdir(downloads);
  let pypiMetadata = null;
  let packageUrl = null;
  let expectedPackageHash = null;
  if (!args["package-archive"]) {
    const metadataPath = join(downloads, `pypi-${version}.json`);
    const metadataDownload = await download(
      `https://pypi.org/pypi/ecologits/${encodeURIComponent(version)}/json`,
      metadataPath,
      ["pypi.org"],
    );
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    if (metadata.info?.version !== version)
      throw new Error(
        "PyPI metadata version does not match the selected version",
      );
    const sdists = (metadata.urls ?? []).filter(
      (item) => item.packagetype === "sdist" && !item.yanked,
    );
    if (
      sdists.length !== 1 ||
      typeof sdists[0].url !== "string" ||
      !sdists[0].digests?.sha256
    ) {
      throw new Error(
        "PyPI must expose exactly one non-yanked sdist with a SHA256 digest",
      );
    }
    packageUrl = sdists[0].url;
    expectedPackageHash = sdists[0].digests.sha256;
    pypiMetadata = {
      ...metadataDownload,
      filename: portablePath(relative(temporaryStage, metadataPath)),
      sha256: await sha256File(metadataPath),
    };
  }

  const packagePath = join(downloads, `ecologits-${version}.tar.gz`);
  const packageArtifact = await obtainLocalOrRemote(
    args["package-archive"],
    packagePath,
    packageUrl,
    ["files.pythonhosted.org"],
  );
  if (expectedPackageHash && packageArtifact.sha256 !== expectedPackageHash)
    throw new Error("PyPI sdist hash does not match signed metadata");

  const coreSourcePath = join(downloads, `ecologits-core-${coreCommit}.tar.gz`);
  const coreSourceArtifact = await obtainLocalOrRemote(
    args["core-source-archive"] ?? args["source-archive"],
    coreSourcePath,
    `https://codeload.github.com/mlco2/ecologits/tar.gz/${coreCommit}`,
    ["codeload.github.com"],
  );
  let catalogSourcePath = coreSourcePath;
  let catalogSourceArtifact = coreSourceArtifact;
  if (catalogCommit !== coreCommit || args["catalog-source-archive"]) {
    catalogSourcePath = join(
      downloads,
      `ecologits-catalog-${catalogCommit}.tar.gz`,
    );
    catalogSourceArtifact = await obtainLocalOrRemote(
      args["catalog-source-archive"] ?? args["source-archive"],
      catalogSourcePath,
      `https://codeload.github.com/mlco2/ecologits/tar.gz/${catalogCommit}`,
      ["codeload.github.com"],
    );
  }

  const artifacts = join(temporaryStage, "artifacts");
  await mkdir(artifacts);
  const candidateOracle = join(artifacts, "candidate-oracle");
  await mkdir(candidateOracle);
  for (const file of ["pyproject.toml", "uv.lock"])
    await copyFile(join(pythonProject, file), join(candidateOracle, file));
  const sourceCore = join(artifacts, "source-core");
  const packageRoot = join(artifacts, "package");
  const coreExtraction = await extractTarGz(coreSourcePath, sourceCore);
  const packageExtraction = await extractTarGz(packagePath, packageRoot);
  let sourceCatalog = sourceCore;
  let catalogExtraction = coreExtraction;
  if (catalogSourcePath !== coreSourcePath) {
    sourceCatalog = join(artifacts, "source-catalog");
    catalogExtraction = await extractTarGz(catalogSourcePath, sourceCatalog);
  }

  const candidate = join(artifacts, "candidate");
  await copyTree(sourceCore, candidate);
  const dataFiles = [
    "ecologits/data/models.json",
    "ecologits/data/electricity_mixes.json",
    "ecologits/data/video_models.json",
  ];
  for (const dataFile of dataFiles) {
    await copyFile(
      containedPath(sourceCatalog, dataFile),
      containedPath(candidate, dataFile),
    );
  }

  const baseline = join(temporaryStage, "baseline");
  await mkdir(baseline);
  await copyTree(acceptedSource, join(baseline, "accepted-source"));
  await writeJson(join(baseline, "accepted-catalog.json"), acceptedCatalog);
  await writeJson(join(baseline, "accepted-lock.json"), acceptedLock);
  await writeJson(join(baseline, "accepted-identity.json"), acceptedIdentity);
  await writeJson(join(baseline, "source-to-port-map.json"), sourceMap);
  await copyFile(
    join(coreRoot, "upstream/retained-source.json"),
    join(baseline, "retained-source.json"),
  );

  const mutableTargetPaths = [
    "data/catalog.json",
    "data/identity.json",
    "upstream/lock.json",
    "upstream/coverage.json",
    "upstream/attribution.json",
    "upstream/retained-source.json",
    "LICENSE",
    "CITATION.cff",
    "NOTICE.md",
    "SOURCE-DISTRIBUTION.md",
    "oracle/pyproject.toml",
    "oracle/uv.lock",
  ];
  const targetPreconditions = {};
  for (const targetPath of mutableTargetPaths) {
    const full = containedPath(coreRoot, targetPath);
    targetPreconditions[targetPath] = (await exists(full))
      ? await fileRecord(full)
      : null;
  }
  const portTargets = [
    ...new Set(
      sourceMap.functions_and_types.flatMap((entry) =>
        entry.port ? entry.port.split(/\s*\+\s*/) : [],
      ),
    ),
  ].sort();
  const portHashes = {};
  for (const portTarget of portTargets)
    portHashes[portTarget] = await sha256File(
      containedPath(coreRoot, portTarget),
    );
  const adoptionTargetPaths = new Set(mutableTargetPaths);
  adoptionTargetPaths.add("source-to-port-map.json");
  for (const retainedPath of Object.keys(acceptedRetention.retained_files))
    adoptionTargetPaths.add(`upstream/${snapshotDirectory}/${retainedPath}`);
  const adoptionPreconditions = {};
  for (const targetPath of [...adoptionTargetPaths].sort()) {
    const full = containedPath(coreRoot, targetPath);
    adoptionPreconditions[targetPath] = (await exists(full))
      ? await fileRecord(full)
      : null;
  }
  const snapshotTarget = join(coreRoot, "upstream", snapshotDirectory);
  const snapshotPrecondition = (await exists(snapshotTarget))
    ? await hashTree(snapshotTarget)
    : null;
  const privateDirectory = `.git/refinement-artifacts/vendor-source/ecologits-${version}-${coreCommit.slice(0, 12)}-${catalogCommit.slice(0, 12)}`;
  const privateTargetPaths = [
    `${privateDirectory}/ecologits-${version}.tar.gz`,
    `${privateDirectory}/source-${coreCommit}.tar.gz`,
  ];
  if (catalogCommit !== coreCommit)
    privateTargetPaths.push(
      `${privateDirectory}/catalog-${catalogCommit}.tar.gz`,
    );
  if (pypiMetadata) adoptionTargetPaths.add(`upstream/pypi-${version}.json`);
  if (pypiMetadata)
    privateTargetPaths.push(`${privateDirectory}/pypi-${version}.json`);
  const privateAdoptionPreconditions = {};
  for (const targetPath of privateTargetPaths.sort()) {
    const full = containedPath(repositoryRoot, targetPath);
    privateAdoptionPreconditions[targetPath] = (await exists(full))
      ? await fileRecord(full)
      : null;
  }

  const manifest = {
    schema_version: "1",
    tool_version: TOOL_VERSION,
    catalog_schema: CATALOG_SCHEMA,
    selection: {
      version,
      core_commit: coreCommit,
      catalog_commit: catalogCommit,
      release_kind: officialCombination
        ? "release_candidate"
        : "qualified_combination",
      official_release_claim: false,
      qualified_label: qualifiedLabel,
      snapshot_directory: snapshotDirectory,
      core_version: args["core-version"] ?? acceptedIdentity.core_version,
      converter_version:
        args["converter-version"] ?? acceptedIdentity.converter_version,
    },
    provenance_note: officialCombination
      ? "The immutable commit and package artifact are separately pinned. Adoption requires content comparison; this manifest does not claim tag-to-commit linkage by itself."
      : "This is an explicitly qualified mixed-commit candidate, not an official upstream release.",
    artifacts: {
      package: {
        filename: portablePath(relative(temporaryStage, packagePath)),
        ...packageArtifact,
      },
      source_core: {
        filename: portablePath(relative(temporaryStage, coreSourcePath)),
        ...coreSourceArtifact,
      },
      source_catalog: {
        filename: portablePath(relative(temporaryStage, catalogSourcePath)),
        ...catalogSourceArtifact,
      },
      pypi_metadata: pypiMetadata,
    },
    extraction: {
      source_core: coreExtraction,
      source_catalog: catalogExtraction,
      package: packageExtraction,
    },
    candidate_files: await hashTree(candidate),
    candidate_oracle_files: await hashTree(candidateOracle),
    package_files: await hashTree(packageRoot),
    baseline: {
      identity: acceptedIdentity,
      files: await hashTree(baseline),
      accepted_python_project: portablePath(
        relative(repositoryRoot, join(coreRoot, "oracle")),
      ),
      accepted_python_lock_sha256: await sha256File(
        join(coreRoot, "oracle/uv.lock"),
      ),
      target_preconditions: targetPreconditions,
      adoption_preconditions: adoptionPreconditions,
      snapshot_precondition: snapshotPrecondition,
      private_adoption_preconditions: privateAdoptionPreconditions,
      port_hashes: portHashes,
    },
    environment: {
      python_project: portablePath(relative(repositoryRoot, pythonProject)),
      python_lock_sha256: await sha256File(join(pythonProject, "uv.lock")),
      overlay: overlayPath
        ? portablePath(relative(repositoryRoot, overlayPath))
        : null,
      overlay_sha256: overlayPath ? await sha256File(overlayPath) : null,
      private_artifact_directory: privateDirectory,
    },
  };
  await writeJson(join(temporaryStage, "stage.json"), manifest);
  await rename(temporaryStage, requestedStage);
  process.stdout.write(
    `Staged EcoLogits ${version} candidate at ${requestedStage}\n`,
  );
  process.stdout.write(
    `${officialCombination ? "Single immutable commit candidate" : `Qualified combination: ${qualifiedLabel}`}\n`,
  );
} catch (error) {
  if (await exists(temporaryStage))
    await rm(temporaryStage, { recursive: true, force: true });
  throw error;
}
