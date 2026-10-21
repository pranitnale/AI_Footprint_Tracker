#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CATALOG_SCHEMA,
  TOOL_VERSION,
  assertAllowedOptions,
  containedPath,
  exists,
  fileRecord,
  hashTree,
  jsonBytes,
  parseArgs,
  portablePath,
  readJson,
  requireOption,
  sha256Bytes,
  sha256File,
  walkFiles,
  writeJson,
} from "./lib/common.mjs";
import {
  attribution,
  catalogDiff,
  inventoryDiff,
  semanticReportMarkdown,
  validateOverlay,
  validateSourceMap,
} from "./lib/semantic.mjs";
import { buildCandidateRetention } from "./lib/retention.mjs";

const args = parseArgs(process.argv.slice(2));
assertAllowedOptions(args, ["repository-root", "stage", "review", "cases"]);
const numericalCaseCount = args.cases === undefined ? 64 : Number(args.cases);
if (
  !Number.isSafeInteger(numericalCaseCount) ||
  numericalCaseCount < 1 ||
  numericalCaseCount > 10_000
) {
  throw new Error("--cases must be an integer from 1 to 10000");
}
const repositoryRoot = resolve(args["repository-root"] ?? process.cwd());
const toolDirectory = dirname(fileURLToPath(import.meta.url));
const toolWorkspace = resolve(toolDirectory, "../..");
const stage = resolve(requireOption(args, "stage"));
await walkFiles(stage); // Reject any symlink before reading staged inputs.
const stageManifest = await readJson(join(stage, "stage.json"));
if (
  stageManifest.schema_version !== "1" ||
  stageManifest.tool_version !== TOOL_VERSION
)
  throw new Error("Unsupported or stale stage manifest");
const coreRoot = join(repositoryRoot, "packages/ecologits-core");
const pythonProject = resolve(
  repositoryRoot,
  stageManifest.environment.python_project,
);
const pythonLockHash = await sha256File(join(pythonProject, "uv.lock"));
if (pythonLockHash !== stageManifest.environment.python_lock_sha256)
  throw new Error(
    "Locked Python environment changed after staging; create a new stage",
  );
if (
  (await sha256File(join(pythonProject, "pyproject.toml"))) !==
  stageManifest.candidate_oracle_files["pyproject.toml"]
)
  throw new Error(
    "Candidate Python project changed after staging; create a new stage",
  );
const acceptedPythonProject = resolve(
  repositoryRoot,
  stageManifest.baseline.accepted_python_project,
);
if (
  (await sha256File(join(acceptedPythonProject, "uv.lock"))) !==
  stageManifest.baseline.accepted_python_lock_sha256
)
  throw new Error(
    "Accepted Python oracle lock changed after staging; create a new stage",
  );

function cleanEnvironment() {
  const environment = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (
      /(token|secret|password|api.?key|openai|anthropic|cohere|mistral|google.*credential)/i.test(
        key,
      )
    )
      continue;
    environment[key] = value;
  }
  environment.PYTHONDONTWRITEBYTECODE = "1";
  return environment;
}

function command(program, commandArgs, options = {}) {
  const result = spawnSync(program, commandArgs, {
    cwd: toolWorkspace,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    timeout: 240_000,
    env: cleanEnvironment(),
    ...options,
  });
  if (result.status !== 0)
    throw new Error(
      `${program} failed (${result.status}): ${result.error?.message ?? result.stderr}`,
    );
  return result.stdout;
}

function pythonInProject(project, script, scriptArgs, input) {
  return command(
    "uv",
    [
      "run",
      "--project",
      project,
      "--frozen",
      "--offline",
      "python",
      "-X",
      "utf8",
      script,
      ...scriptArgs,
    ],
    { input },
  );
}

function python(script, scriptArgs, input) {
  return pythonInProject(pythonProject, script, scriptArgs, input);
}

async function validateHashes(root, expected, label) {
  const actual = await hashTree(root);
  if (!jsonBytes(actual).equals(jsonBytes(expected)))
    throw new Error(`${label} changed after staging; create a new stage`);
}

for (const artifact of Object.values(stageManifest.artifacts)) {
  if (!artifact) continue;
  const actual = await fileRecord(containedPath(stage, artifact.filename));
  if (actual.sha256 !== artifact.sha256 || actual.bytes !== artifact.bytes)
    throw new Error(`Staged artifact was modified: ${artifact.filename}`);
}
await validateHashes(
  join(stage, "artifacts/candidate"),
  stageManifest.candidate_files,
  "Candidate source",
);
await validateHashes(
  join(stage, "artifacts/package"),
  stageManifest.package_files,
  "Package extraction",
);
await validateHashes(
  join(stage, "artifacts/candidate-oracle"),
  stageManifest.candidate_oracle_files,
  "Candidate oracle environment",
);
await validateHashes(
  join(stage, "baseline"),
  stageManifest.baseline.files,
  "Accepted baseline",
);

const verification = join(stage, "verification");
if (await exists(verification))
  await rm(verification, { recursive: true, force: true });
const verificationTemporary = join(stage, `.verification-${randomUUID()}`);
await mkdir(verificationTemporary);
const generated = join(verificationTemporary, "generated");
await mkdir(generated);
const candidateRoot = join(stage, "artifacts/candidate");
const acceptedRoot = join(stage, "baseline/accepted-source");
const pythonDirectory = join(toolDirectory, "python");

const catalogArguments = [
  "--candidate",
  candidateRoot,
  "--version",
  stageManifest.selection.version,
  "--catalog-commit",
  stageManifest.selection.catalog_commit,
];
let candidateCatalogBytes;
let candidateCatalog;
const blockers = [];
try {
  const first = python(
    join(pythonDirectory, "candidate_catalog.py"),
    catalogArguments,
  );
  const second = python(
    join(pythonDirectory, "candidate_catalog.py"),
    catalogArguments,
  );
  if (first !== second)
    throw new Error(
      "Candidate catalog generation produced different bytes on the second run",
    );
  candidateCatalogBytes = Buffer.from(first);
  candidateCatalog = JSON.parse(first);
  if (candidateCatalog.schema_version !== CATALOG_SCHEMA)
    throw new Error(
      `Unsupported generated catalog schema: ${candidateCatalog.schema_version}`,
    );
} catch (error) {
  const report = {
    schema_version: "1",
    status: "failed",
    selection: stageManifest.selection,
    execution: {
      network_used: false,
      provider_credentials_available_to_children: false,
      python_environment_frozen: true,
      ordinary_runtime_fetch_required: false,
    },
    blockers: [
      {
        code: "candidate-conversion-failed",
        message: `Candidate schema or loader validation failed: ${error.message}`,
      },
    ],
  };
  await writeJson(join(verificationTemporary, "report.json"), report);
  await writeFile(
    join(verificationTemporary, "report.md"),
    Buffer.from(
      `# EcoLogits candidate verification\n\nResult: FAILED\n\n- candidate-conversion-failed: ${error.message}\n`,
    ),
  );
  await writeJson(join(verificationTemporary, "adoption-plan.json"), {
    schema_version: "1",
    target_package: "packages/ecologits-core",
    selection: stageManifest.selection,
    entries: [],
  });
  await rename(verificationTemporary, verification);
  const stageFiles = {};
  for (const path of await walkFiles(stage)) {
    if (path === "verification/seal.json") continue;
    stageFiles[path] = await sha256File(containedPath(stage, path));
  }
  await writeJson(join(verification, "seal.json"), {
    schema_version: "1",
    status: "failed",
    report_sha256: stageFiles["verification/report.json"],
    adoption_plan_sha256: stageFiles["verification/adoption-plan.json"],
    stage_files: stageFiles,
    external_preconditions: null,
  });
  process.stderr.write(
    `EcoLogits candidate verification failed: ${join(verification, "report.md")}\n`,
  );
  process.exit(1);
}
await writeFile(join(generated, "catalog.json"), candidateCatalogBytes);
const acceptedCatalog = await readJson(
  join(stage, "baseline/accepted-catalog.json"),
);
const acceptedRetention = await readJson(
  join(stage, "baseline/retained-source.json"),
);
const catalogChanges = catalogDiff(acceptedCatalog, candidateCatalog);

const inspectScript = join(pythonDirectory, "inspect_candidate.py");
const acceptedInventory = JSON.parse(
  python(inspectScript, ["--candidate", acceptedRoot]),
);
const candidateInventory = JSON.parse(
  python(inspectScript, ["--candidate", candidateRoot]),
);
const sourceChanges = inventoryDiff(acceptedInventory, candidateInventory);
const acceptedOriginalFiles = Object.fromEntries(
  Object.entries({
    ...acceptedRetention.retained_files,
    ...acceptedRetention.excluded_files,
  }).map(([path, record]) => [path, record.sha256]),
);
sourceChanges.archive_files = {
  added: Object.keys(stageManifest.candidate_files)
    .filter((path) => !Object.hasOwn(acceptedOriginalFiles, path))
    .sort(),
  removed: Object.keys(acceptedOriginalFiles)
    .filter((path) => !Object.hasOwn(stageManifest.candidate_files, path))
    .sort(),
  modified: Object.keys(stageManifest.candidate_files)
    .filter(
      (path) =>
        Object.hasOwn(acceptedOriginalFiles, path) &&
        stageManifest.candidate_files[path] !== acceptedOriginalFiles[path],
    )
    .sort(),
};
const environmentValidation = JSON.parse(
  python(join(pythonDirectory, "validate_environment.py"), [
    "--candidate",
    candidateRoot,
    "--lock",
    join(pythonProject, "uv.lock"),
    "--version",
    stageManifest.selection.version,
    "--artifact-sha256",
    stageManifest.artifacts.package.sha256,
  ]),
);
if (!environmentValidation.valid)
  blockers.push({
    code: "candidate-environment-incompatible",
    message:
      "The frozen Python environment does not satisfy the exact candidate package requirements.",
    details: environmentValidation.issues,
  });

const sourceMap = await readJson(join(coreRoot, "source-to-port-map.json"));
if (sourceMap.schema_version !== 2)
  throw new Error("Unsupported source-to-port map schema");
const portTargets = [
  ...new Set(
    sourceMap.functions_and_types.flatMap((entry) =>
      entry.port ? entry.port.split(/\s*\+\s*/) : [],
    ),
  ),
].sort();
const currentPortHashes = {};
for (const target of portTargets)
  currentPortHashes[target] = await sha256File(containedPath(coreRoot, target));
const sourceMapStatus = validateSourceMap({
  acceptedInventory,
  candidateInventory,
  inventoryChange: sourceChanges,
  sourceMap,
  coreRootHashes: currentPortHashes,
  baselinePortHashes: stageManifest.baseline.port_hashes,
  selection: stageManifest.selection,
});
for (const failure of sourceMapStatus.failures)
  blockers.push({
    code: failure.code,
    message: `Candidate calculation source is not covered by an updated, changed TypeScript port: ${failure.path ?? "source map identity"}`,
    details: failure,
  });
if (
  sourceMapStatus.port_relevant_changed_files.length > 0 &&
  stageManifest.selection.core_version ===
    stageManifest.baseline.identity.core_version
) {
  blockers.push({
    code: "unchanged-core-version",
    message:
      "Calculation source changed but --core-version still names the accepted port version.",
  });
}

const overlayPath = stageManifest.environment.overlay
  ? resolve(repositoryRoot, stageManifest.environment.overlay)
  : null;
if (
  overlayPath &&
  (await sha256File(overlayPath)) !== stageManifest.environment.overlay_sha256
)
  throw new Error("Product overlay changed after staging; create a new stage");
const overlay = overlayPath ? await readJson(overlayPath) : null;
const overlayStatus = validateOverlay(
  overlay,
  acceptedCatalog,
  candidateCatalog,
);
for (const conflict of overlayStatus.conflicts)
  blockers.push({
    code: "overlay-conflict",
    message: `${conflict.kind} ${conflict.owner} references removed or missing ${conflict.profile_id}.`,
    details: conflict,
  });

const baselineCandidatePackageDifferences = [];
const packageHashes = stageManifest.package_files;
for (const [path, hash] of Object.entries(stageManifest.candidate_files)) {
  if (
    !path.startsWith("ecologits/") ||
    (!path.endsWith(".py") && !path.endsWith(".json"))
  )
    continue;
  if (packageHashes[path] !== hash)
    baselineCandidatePackageDifferences.push({
      path,
      candidate: hash,
      package: packageHashes[path] ?? null,
    });
}
for (const path of Object.keys(packageHashes)) {
  if (
    path.startsWith("ecologits/") &&
    (path.endsWith(".py") || path.endsWith(".json")) &&
    !stageManifest.candidate_files[path]
  ) {
    baselineCandidatePackageDifferences.push({
      path,
      candidate: null,
      package: packageHashes[path],
    });
  }
}
if (
  stageManifest.selection.release_kind === "release_candidate" &&
  baselineCandidatePackageDifferences.length > 0
) {
  blockers.push({
    code: "package-source-mismatch",
    message:
      "The selected commit source and PyPI package differ in Python or catalog files.",
    details: baselineCandidatePackageDifferences.slice(0, 20),
  });
}
const declaredCatalogOverlays = new Set([
  "ecologits/data/models.json",
  "ecologits/data/electricity_mixes.json",
  "ecologits/data/video_models.json",
]);
const qualifiedPackageDifferences = baselineCandidatePackageDifferences.filter(
  (change) => !declaredCatalogOverlays.has(change.path),
);
if (
  stageManifest.selection.release_kind === "qualified_combination" &&
  qualifiedPackageDifferences.length > 0
)
  blockers.push({
    code: "qualified-core-package-mismatch",
    message:
      "A qualified candidate may overlay declared catalog JSON, but its Python code must match the candidate-pinned package environment.",
    details: qualifiedPackageDifferences.slice(0, 20),
  });

function complianceFileHashes(rootHashes) {
  return Object.fromEntries(
    Object.entries(rootHashes).filter(([path]) =>
      /(^|\/)(license[^/]*|notice[^/]*|citation\.cff)$/i.test(path),
    ),
  );
}
const acceptedTreeHashes = await hashTree(acceptedRoot);
const candidateTreeHashes = stageManifest.candidate_files;
const acceptedCompliance = complianceFileHashes(acceptedTreeHashes);
const candidateCompliance = complianceFileHashes(candidateTreeHashes);
acceptedCompliance.project_license = acceptedInventory.project.license ?? null;
candidateCompliance.project_license =
  candidateInventory.project.license ?? null;
const candidateLicensePath = join(candidateRoot, "LICENSE");
const candidateCitationPath = join(candidateRoot, "CITATION.cff");
const candidateHasLicense = await exists(candidateLicensePath);
const candidateHasCitation = await exists(candidateCitationPath);
if (!candidateHasLicense)
  blockers.push({
    code: "required-license-missing",
    message: "Candidate source does not contain the required license file.",
  });
if (!candidateHasCitation)
  blockers.push({
    code: "required-citation-missing",
    message: "Candidate source does not contain CITATION.cff.",
  });
const licenseCitationChanged =
  JSON.stringify(acceptedCompliance) !== JSON.stringify(candidateCompliance);
const dependencyHash = sha256Bytes(jsonBytes(candidateInventory.project));
const dependencyChanged = sourceChanges.dependencies.length > 0;
let review = null;
const reviewPath = args.review
  ? resolve(args.review)
  : join(stage, "review.json");
if (await exists(reviewPath)) {
  const reviewRelative = relative(stage, reviewPath);
  containedPath(stage, portablePath(reviewRelative));
  review = await readJson(reviewPath);
  if (review.schema_version !== "1")
    throw new Error("Unsupported review file schema");
}
function reviewed(section, expectedHash) {
  const decision = review?.[section];
  return (
    decision?.decision === "approved" &&
    decision.candidate_sha256 === expectedHash &&
    typeof decision.reviewer === "string" &&
    decision.reviewer.trim() &&
    typeof decision.rationale === "string" &&
    decision.rationale.trim()
  );
}
const complianceHash = sha256Bytes(jsonBytes(candidateCompliance));
if (
  licenseCitationChanged &&
  !reviewed("license_notice_citation", complianceHash)
) {
  blockers.push({
    code: "compliance-review-required",
    message:
      "License, notice or citation files changed and lack an exact-hash approval.",
  });
}
if (dependencyChanged && !reviewed("dependencies", dependencyHash)) {
  blockers.push({
    code: "dependency-review-required",
    message:
      "Dependency or package metadata changed and lack an exact-hash approval.",
  });
}

let differential;
try {
  differential = await import(
    pathToFileURL(join(coreRoot, "tools/differential.ts")).href
  );
} catch (error) {
  await rm(verificationTemporary, { recursive: true, force: true });
  throw new Error(
    "verify-update must run through Node with --import tsx so it can reuse the core differential interface",
    { cause: error },
  );
}
const acceptedModelKeys = new Set(
  acceptedCatalog.models.map((model) => `${model.provider}/${model.name}`),
);
const acceptedMixes = new Set(
  acceptedCatalog.electricity_mixes.map((mix) => mix.zone),
);
const acceptedVideos = new Set(
  acceptedCatalog.video.models.map((model) => model.model_name),
);
const supplementalCases = [];
for (const [index, model] of candidateCatalog.models.entries()) {
  if (!acceptedModelKeys.has(`${model.provider}/${model.name}`)) {
    supplementalCases.push({
      id: `RL11-model-${index}`,
      op: "model",
      args: { provider: model.provider, model_name: model.name },
    });
    supplementalCases.push({
      id: `RL11-output-${index}`,
      op: "llm_lookup",
      args: {
        provider: model.provider,
        model_name: model.name,
        output_token_count: 1000,
      },
    });
  }
}
for (const [index, mix] of candidateCatalog.electricity_mixes.entries()) {
  if (!acceptedMixes.has(mix.zone))
    supplementalCases.push({
      id: `RL13-mix-${index}`,
      op: "mix",
      args: { zone: mix.zone },
    });
}
for (const [index, model] of candidateCatalog.video.models.entries()) {
  if (!acceptedVideos.has(model.model_name))
    supplementalCases.push({
      id: `RL11-video-${index}`,
      op: "video_lookup",
      args: {
        model_name: model.model_name,
        resolution: model.capabilities.resolutions[0].join("x"),
        duration: 5,
        with_audio: true,
      },
    });
}
const rawModels = await readJson(
  join(candidateRoot, "ecologits/data/models.json"),
);
const rawElectricity = await readJson(
  join(candidateRoot, "ecologits/data/electricity_mixes.json"),
);
const surfaceCases = [
  ...Object.keys(candidateCatalog.warning_messages).map((code, index) => ({
    id: `RL12-warning-${index}`,
    op: "status_from_code",
    args: { kind: "warning", code },
  })),
  ...Object.keys(candidateCatalog.error_messages).map((code, index) => ({
    id: `RL12-error-${index}`,
    op: "status_from_code",
    args: { kind: "error", code },
  })),
  {
    id: "RL12-output-status",
    op: "output_status",
    args: {
      warnings: Object.keys(candidateCatalog.warning_messages).slice(0, 2),
      errors: Object.keys(candidateCatalog.error_messages).slice(0, 2),
    },
  },
  ...rawModels.models.map((model, index) => ({
    id: `RL12-model-loader-${index}`,
    op: "model_from_json",
    args: model,
  })),
  {
    id: "RL12-model-repository",
    op: "repository",
    args: { models: rawModels.models, aliases: rawModels.aliases },
  },
  ...rawElectricity.electricity_mixes.map((mix, index) => ({
    id: `RL12-electricity-loader-${index}`,
    op: "electricity_from_json",
    args: mix,
  })),
  {
    id: "RL12-electricity-repository",
    op: "electricity_repository",
    args: { mixes: rawElectricity.electricity_mixes },
  },
  ...["equal", "less", "lessEqual", "greater", "greaterEqual"].flatMap(
    (action) =>
      [
        ["energy", "gwp"],
        ["adpe", "pe"],
        ["wcf", "energy"],
      ].map(([left, right], index) => ({
        id: `RL12-impact-compare-${action}-${index}`,
        op: "impact_compare",
        args: { left, right, a: 1, b: 1, action },
      })),
  ),
  {
    id: "RL12-range-negative-zero",
    op: "range",
    args: { action: "add", a: -0, b: -0 },
  },
  { id: "RL12-frames-zero", op: "frames", args: { duration: 0 } },
  {
    id: "RL12-resolution",
    op: "resolution",
    args: { resolution: "1920x1080" },
  },
  {
    id: "RL12-gpu-count",
    op: "gpu_count",
    args: { model_required_memory: 160, gpu_memory: 80 },
  },
  {
    id: "RL12-parse-value-range",
    op: "parse_value_or_range",
    args: { value: { min: 1, max: 2 } },
  },
  {
    id: "RL12-parse-value-negative-zero",
    op: "parse_value_or_range",
    args: { value: -0 },
  },
  {
    id: "RL12-electricity-negative-zero",
    op: "electricity_from_json",
    args: { name: "ZZZ", adpe: -0, pe: 1, gwp: 1, wue: 1, warnings: [] },
  },
];
const cases = [
  ...differential.catalogCases(),
  ...differential.numericalCases(numericalCaseCount),
  ...(typeof differential.invalidNumericalCases === "function"
    ? differential.invalidNumericalCases(Math.min(numericalCaseCount, 100))
    : []),
  ...surfaceCases,
  ...supplementalCases,
];
function encodeSpecial(value) {
  if (typeof value === "number" && !Number.isFinite(value))
    return { $float: String(value) };
  if (typeof value === "number" && Object.is(value, -0))
    return { $float: "-0" };
  if (Array.isArray(value)) return value.map(encodeSpecial);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, encodeSpecial(child)]),
    );
  return value;
}
const caseInput = JSON.stringify(encodeSpecial(cases));
const candidatePythonOutput = python(
  join(pythonDirectory, "run_candidate.py"),
  ["--candidate", candidateRoot],
  caseInput,
);
const acceptedPythonOutput = pythonInProject(
  acceptedPythonProject,
  join(coreRoot, "oracle/run.py"),
  [],
  caseInput,
);
const tsOutput = command(
  process.execPath,
  [
    "--import",
    "tsx",
    join(toolDirectory, "ts-candidate-runner.mts"),
    "--core-root",
    coreRoot,
    "--catalog",
    join(generated, "catalog.json"),
  ],
  { input: caseInput },
);
const candidateExpected = JSON.parse(candidatePythonOutput);
const acceptedExpected = JSON.parse(acceptedPythonOutput);
const candidateActual = JSON.parse(tsOutput);
const mismatches = [];
for (let index = 0; index < candidateExpected.length; index += 1) {
  try {
    differential.compare(
      candidateActual[index],
      candidateExpected[index],
      cases[index].id,
      undefined,
      cases[index].op,
    );
  } catch (error) {
    if (mismatches.length < 50)
      mismatches.push({ id: cases[index].id, message: error.message });
  }
}
if (mismatches.length > 0)
  blockers.push({
    code: "candidate-parity-failed",
    message: `Candidate TypeScript differs from candidate Python in ${mismatches.length} reported cases.`,
    details: mismatches,
  });
const acceptedCandidateDeltas = [];
for (let index = 0; index < candidateExpected.length; index += 1) {
  const acceptedBytes = jsonBytes(acceptedExpected[index]);
  const candidateBytes = jsonBytes(candidateExpected[index]);
  if (!acceptedBytes.equals(candidateBytes))
    acceptedCandidateDeltas.push({
      id: cases[index].id,
      accepted_sha256: sha256Bytes(acceptedBytes),
      candidate_sha256: sha256Bytes(candidateBytes),
    });
}

const candidateMap = {
  ...sourceMap,
  upstream_commit: stageManifest.selection.core_commit,
  upstream_version: stageManifest.selection.version,
  functions_and_types: sourceMap.functions_and_types.map((entry) => ({
    ...entry,
    source_sha256:
      candidateInventory.files[entry.upstream_file]?.file_sha256 ??
      entry.source_sha256,
  })),
};
await writeJson(join(generated, "source-to-port-map.json"), candidateMap);
const sourceArtifactRecord =
  stageManifest.selection.version === acceptedRetention.upstream_version &&
  stageManifest.artifacts.package.sha256 ===
    acceptedRetention.source_artifact.sha256
    ? acceptedRetention.source_artifact
    : {
        filename: `ecologits-${stageManifest.selection.version}.tar.gz`,
        sha256: stageManifest.artifacts.package.sha256,
        origin:
          stageManifest.artifacts.package.resolved_url ??
          stageManifest.artifacts.package.requested_url ??
          "developer-supplied-local-artifact",
      };
const retention = await buildCandidateRetention({
  candidateRoot,
  candidateFiles: stageManifest.candidate_files,
  acceptedManifest: acceptedRetention,
  sourceMap: candidateMap,
  selection: stageManifest.selection,
  sourceArtifact: sourceArtifactRecord,
});
for (const path of retention.missing_source_map_files)
  blockers.push({
    code: "retained-source-map-file-missing",
    message: `A source-to-port file is missing from the retained candidate: ${path}`,
  });
const retentionSemanticallyUnchanged = jsonBytes(retention.manifest).equals(
  jsonBytes(acceptedRetention),
);
const retainedSourceBytes = retentionSemanticallyUnchanged
  ? await readFile(join(stage, "baseline/retained-source.json"))
  : jsonBytes(retention.manifest);
retention.sha256 = sha256Bytes(retainedSourceBytes);
await writeFile(join(generated, "retained-source.json"), retainedSourceBytes);
const catalogHash = sha256Bytes(candidateCatalogBytes);
const currentCoreFiles = Object.fromEntries(
  Object.entries(await hashTree(join(coreRoot, "src"))).map(([path, hash]) => [
    `src/${path}`,
    hash,
  ]),
);
const coreHash = sha256Bytes(jsonBytes(currentCoreFiles));
const candidateLock = {
  schema_version: "2",
  upstream_version: stageManifest.selection.version,
  requested_git_commit: stageManifest.selection.core_commit,
  core_commit: stageManifest.selection.core_commit,
  catalog_commit: stageManifest.selection.catalog_commit,
  release_kind: stageManifest.selection.release_kind,
  snapshot_directory: stageManifest.selection.snapshot_directory,
  official_release_claim: false,
  qualified_label: stageManifest.selection.qualified_label,
  catalog_overlay_files:
    stageManifest.selection.release_kind === "qualified_combination"
      ? [
          "ecologits/data/models.json",
          "ecologits/data/electricity_mixes.json",
          "ecologits/data/video_models.json",
        ]
      : [],
  provenance_note: stageManifest.provenance_note,
  core_version: stageManifest.selection.core_version,
  core_sha256: coreHash,
  core_files: currentCoreFiles,
  converter_version: stageManifest.selection.converter_version,
  maintenance_tool_version: TOOL_VERSION,
  catalog_schema: CATALOG_SCHEMA,
  catalog_sha256: catalogHash,
  python_lock_sha256: pythonLockHash,
  oracle_lock_sha256: pythonLockHash,
  oracle_project_sha256: await sha256File(
    join(stage, "artifacts/candidate-oracle/pyproject.toml"),
  ),
  source_map_sha256: sha256Bytes(jsonBytes(candidateMap)),
  retained_source_manifest_sha256: retention.sha256,
  source_distribution: retention.manifest.distribution,
  overlay_sha256: overlayPath ? await sha256File(overlayPath) : null,
  license_sha256: candidateHasLicense
    ? await sha256File(candidateLicensePath)
    : null,
  citation_sha256: candidateHasCitation
    ? await sha256File(candidateCitationPath)
    : null,
  artifacts: Object.fromEntries(
    Object.entries(stageManifest.artifacts).map(([name, artifact]) => [
      name,
      artifact
        ? {
            filename: artifact.filename,
            bytes: artifact.bytes,
            sha256: artifact.sha256,
            origin:
              artifact.resolved_url ??
              artifact.requested_url ??
              "developer-supplied-local-artifact",
          }
        : null,
    ]),
  ),
  source_artifact: sourceArtifactRecord,
  files: Object.fromEntries(
    Object.entries(retention.manifest.retained_files).map(([path, record]) => [
      path,
      record.sha256,
    ]),
  ),
  port_files: currentPortHashes,
  counts: {
    models: candidateCatalog.models.length - candidateCatalog.aliases.length,
    aliases: candidateCatalog.aliases.length,
    resolved_models: candidateCatalog.models.length,
    electricity_mixes: candidateCatalog.electricity_mixes.length,
    video_models: candidateCatalog.video.models.length,
    hardware_configurations: Object.keys(
      candidateCatalog.video.hardware_configurations,
    ).length,
  },
  commit_evidence: stageManifest.provenance_note,
  private_artifact_directory:
    stageManifest.environment.private_artifact_directory,
};
await writeJson(join(generated, "lock.json"), candidateLock);
const candidateIdentity = {
  upstream_version: candidateLock.upstream_version,
  requested_git_commit: candidateLock.core_commit,
  core_version: candidateLock.core_version,
  core_sha256: candidateLock.core_sha256,
  converter_version: candidateLock.converter_version,
  catalog_schema: candidateLock.catalog_schema,
  catalog_sha256: candidateLock.catalog_sha256,
  source_artifact_sha256: stageManifest.artifacts.package.sha256,
};
await writeJson(join(generated, "identity.json"), candidateIdentity);
const coverage = {
  schema_version: "1",
  imported: candidateLock.counts,
  production_exclusions: [
    "Provider SDK tracing and token acquisition are not bundled into the local calculation core.",
    "Catalog presence does not prove a consumer-site model mapping or tokenizer mapping.",
    "Image generation remains on its separately versioned product method.",
    "Models without suitable observed workload fields remain inactive in product policy.",
  ],
  source_to_port_entries: candidateMap.functions_and_types.length,
  numerical_cases: cases.length,
};
await writeJson(join(generated, "coverage.json"), coverage);
const attributionOutput = await attribution({
  candidateRoot,
  selection: stageManifest.selection,
  lock: candidateLock,
  inventoryChange: sourceChanges,
  projectLicense: candidateInventory.project.license ?? null,
  complianceApproved:
    !licenseCitationChanged ||
    reviewed("license_notice_citation", complianceHash),
});
await writeJson(
  join(generated, "attribution.json"),
  attributionOutput.metadata,
);
await writeFile(join(generated, "NOTICE.md"), attributionOutput.notice);
const sourceDistribution = [
  "# EcoLogits source distribution",
  "",
  `This candidate selects EcoLogits ${stageManifest.selection.version} with requested core commit ${stageManifest.selection.core_commit} and requested catalog commit ${stageManifest.selection.catalog_commit}. These identifiers are not independently attested by this tooling, including when source archives are supplied locally.`,
  stageManifest.provenance_note,
  "",
  `The public retained snapshot contains ${Object.keys(retention.manifest.retained_files).length} unchanged candidate files. The retained manifest records hashes, sizes and classifications for ${Object.keys(retention.manifest.excluded_files).length} excluded upstream files. The reduced directory is not presented as the complete source artifact.`,
  "",
  `The complete selected source and package archives are preserved for the developer under ${stageManifest.environment.private_artifact_directory}. That private evidence is not required by ordinary builds or tests and must not enter browser artifacts or public source archives.`,
  "",
  `Source artifact SHA256: ${sourceArtifactRecord.sha256}`,
  `Release classification: ${stageManifest.selection.release_kind}`,
  "",
  "The package lock, retained-source manifest, source-to-port map and corresponding TypeScript source provide the version-specific public provenance chain.",
  "",
].join("\n");
await writeFile(
  join(generated, "SOURCE-DISTRIBUTION.md"),
  Buffer.from(sourceDistribution),
);

const report = {
  schema_version: "1",
  status: blockers.length === 0 ? "passed" : "failed",
  selection: stageManifest.selection,
  provenance_note: stageManifest.provenance_note,
  deterministic_generation: {
    passed: true,
    catalog_sha256: catalogHash,
    converter_version: stageManifest.selection.converter_version,
    maintenance_tool_version: TOOL_VERSION,
  },
  catalog: catalogChanges,
  source: sourceChanges,
  source_map: sourceMapStatus,
  overlay: overlayStatus,
  package_source_comparison: {
    required_equal:
      stageManifest.selection.release_kind === "release_candidate",
    differences: baselineCandidatePackageDifferences,
  },
  numerical: {
    cases: cases.length,
    parity: mismatches.length === 0,
    mismatches,
    case_input_sha256: sha256Bytes(Buffer.from(caseInput)),
    candidate_python_sha256: sha256Bytes(Buffer.from(candidatePythonOutput)),
    candidate_typescript_sha256: sha256Bytes(Buffer.from(tsOutput)),
    accepted_python_sha256: sha256Bytes(Buffer.from(acceptedPythonOutput)),
    accepted_candidate_deltas: acceptedCandidateDeltas,
  },
  compliance: {
    accepted_files: acceptedCompliance,
    candidate_files: candidateCompliance,
    candidate_sha256: complianceHash,
    dependency_sha256: dependencyHash,
    review_required: licenseCitationChanged || dependencyChanged,
    review_applied: review !== null,
  },
  retention: {
    distribution: retention.manifest.distribution,
    original_file_count: retention.manifest.original_file_count,
    retained_file_count: Object.keys(retention.manifest.retained_files).length,
    excluded_file_count: Object.keys(retention.manifest.excluded_files).length,
    manifest_sha256: retention.sha256,
  },
  execution: {
    network_used: false,
    provider_credentials_available_to_children: false,
    python_environment_frozen: true,
    candidate_python_lock_sha256: pythonLockHash,
    accepted_python_lock_sha256:
      stageManifest.baseline.accepted_python_lock_sha256,
    ordinary_runtime_fetch_required: false,
  },
  blockers,
};
await writeJson(join(verificationTemporary, "report.json"), report);
await writeFile(
  join(verificationTemporary, "report.md"),
  semanticReportMarkdown(report),
);

const adoptionEntries = [];
function addEntry(source, target, scope = "package", explicitPrecondition) {
  const preconditions =
    scope === "package"
      ? stageManifest.baseline.adoption_preconditions
      : stageManifest.baseline.private_adoption_preconditions;
  const precondition =
    explicitPrecondition === undefined
      ? (preconditions[target] ?? null)
      : explicitPrecondition;
  adoptionEntries.push({ source, target, scope, precondition });
}
for (const candidatePath of Object.keys(
  retention.manifest.retained_files,
).sort()) {
  addEntry(
    `artifacts/candidate/${candidatePath}`,
    `upstream/${stageManifest.selection.snapshot_directory}/${candidatePath}`,
  );
}
const privateDirectory = stageManifest.environment.private_artifact_directory;
addEntry(
  stageManifest.artifacts.package.filename,
  `${privateDirectory}/ecologits-${stageManifest.selection.version}.tar.gz`,
  "private",
);
if (stageManifest.artifacts.pypi_metadata) {
  addEntry(
    stageManifest.artifacts.pypi_metadata.filename,
    `upstream/pypi-${stageManifest.selection.version}.json`,
  );
  addEntry(
    stageManifest.artifacts.pypi_metadata.filename,
    `${privateDirectory}/pypi-${stageManifest.selection.version}.json`,
    "private",
  );
}
addEntry(
  stageManifest.artifacts.source_core.filename,
  `${privateDirectory}/source-${stageManifest.selection.core_commit}.tar.gz`,
  "private",
);
if (
  stageManifest.selection.catalog_commit !== stageManifest.selection.core_commit
) {
  addEntry(
    stageManifest.artifacts.source_catalog.filename,
    `${privateDirectory}/catalog-${stageManifest.selection.catalog_commit}.tar.gz`,
    "private",
  );
}
addEntry("verification/generated/catalog.json", "data/catalog.json");
addEntry("verification/generated/identity.json", "data/identity.json");
addEntry("verification/generated/lock.json", "upstream/lock.json");
addEntry("verification/generated/coverage.json", "upstream/coverage.json");
addEntry(
  "verification/generated/attribution.json",
  "upstream/attribution.json",
);
addEntry(
  "verification/generated/retained-source.json",
  "upstream/retained-source.json",
);
addEntry("verification/generated/NOTICE.md", "NOTICE.md");
addEntry(
  "verification/generated/SOURCE-DISTRIBUTION.md",
  "SOURCE-DISTRIBUTION.md",
);
addEntry("artifacts/candidate-oracle/pyproject.toml", "oracle/pyproject.toml");
addEntry("artifacts/candidate-oracle/uv.lock", "oracle/uv.lock");
if (candidateHasLicense) addEntry("artifacts/candidate/LICENSE", "LICENSE");
if (candidateHasCitation)
  addEntry("artifacts/candidate/CITATION.cff", "CITATION.cff");
addEntry(
  "verification/generated/source-to-port-map.json",
  "source-to-port-map.json",
  "package",
  await fileRecord(join(coreRoot, "source-to-port-map.json")),
);
const adoptionPlan = {
  schema_version: "1",
  target_package: "packages/ecologits-core",
  selection: stageManifest.selection,
  entries: adoptionEntries,
  snapshot_precondition: stageManifest.baseline.snapshot_precondition,
  snapshot_target: `upstream/${stageManifest.selection.snapshot_directory}`,
  snapshot_candidate_files: Object.fromEntries(
    Object.entries(retention.manifest.retained_files).map(([path, record]) => [
      path,
      record.sha256,
    ]),
  ),
  external_preconditions: {
    port_files: { ...currentCoreFiles, ...currentPortHashes },
    overlay: overlayPath
      ? {
          path: stageManifest.environment.overlay,
          sha256: await sha256File(overlayPath),
        }
      : null,
  },
};
await writeJson(
  join(verificationTemporary, "adoption-plan.json"),
  adoptionPlan,
);

await rename(verificationTemporary, verification);
const stageFiles = {};
for (const path of await walkFiles(stage)) {
  if (path === "verification/seal.json") continue;
  stageFiles[path] = await sha256File(containedPath(stage, path));
}
const seal = {
  schema_version: "1",
  status: report.status,
  report_sha256: stageFiles["verification/report.json"],
  adoption_plan_sha256: stageFiles["verification/adoption-plan.json"],
  stage_files: stageFiles,
  external_preconditions: adoptionPlan.external_preconditions,
};
await writeJson(join(verification, "seal.json"), seal);
process.stdout.write(
  `EcoLogits candidate verification ${report.status}: ${join(verification, "report.md")}\n`,
);
if (report.status !== "passed") process.exitCode = 1;
