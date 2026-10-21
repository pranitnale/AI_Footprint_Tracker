import { createHash } from "node:crypto";
import { access, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  browserInputFingerprint,
  loadBrowserInputContract,
} from "../../../tools/browser-inputs.mjs";
import {
  assertFileDigest as assertDigest,
  fileDigest as digest,
} from "./check-built-downloads.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, "../../..");
const publicOutput = resolve(here, "../public/downloads");
const generated = resolve(here, "../src/generated/downloads.ts");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function exactKeys(value, keys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}

function validSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function validSourceDigest(value) {
  return (
    exactKeys(value, ["archive", "bytes", "sha256"]) &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes > 0 &&
    validSha256(value.sha256)
  );
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonical(child)]),
    );
  return value;
}

function variantFingerprint(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

function validDifferenceList(value) {
  return Array.isArray(value) && value.length === 0;
}

function validBuildVariant(value, browser, engine, contract, manifest) {
  const target = contract.targets[browser];
  return (
    exactKeys(value, [
      "available_engines",
      "browser",
      "build_status",
      "bundled_notices",
      "configuration_sha256",
      "default_engine",
      "ecologits",
      "manifest_version",
      "schema_version",
      "source_date_epoch",
      "user_override_enabled",
      "variant_id",
    ]) &&
    value.schema_version === contract.variant_schema_version &&
    value.variant_id === `${browser}-${engine}` &&
    value.build_status === "release_candidate" &&
    value.browser === browser &&
    value.manifest_version === target.manifest_version &&
    value.default_engine === engine &&
    JSON.stringify(value.available_engines) ===
      JSON.stringify(contract.engines) &&
    value.user_override_enabled === false &&
    validSha256(value.configuration_sha256) &&
    value.source_date_epoch === manifest.source_date_epoch &&
    exactKeys(value.ecologits, [
      "catalog_sha256",
      "core_sha256",
      "core_version",
      "retained_source_manifest_sha256",
      "source_artifact_sha256",
      "upstream_version",
    ]) &&
    [
      value.ecologits.catalog_sha256,
      value.ecologits.core_sha256,
      value.ecologits.retained_source_manifest_sha256,
      value.ecologits.source_artifact_sha256,
    ].every(validSha256) &&
    exactKeys(value.bundled_notices, [
      "inventory_sha256",
      "license_path",
      "license_sha256",
      "source_path",
      "source_sha256",
    ]) &&
    value.bundled_notices.license_path === "licenses.html" &&
    value.bundled_notices.source_path === "source/ecologits-source.zip" &&
    [
      value.bundled_notices.inventory_sha256,
      value.bundled_notices.license_sha256,
      value.bundled_notices.source_sha256,
    ].every(validSha256)
  );
}

function validVariantRecord(
  value,
  browser,
  engine,
  contract,
  manifest,
  currentFingerprint,
) {
  const variant = `${browser}-${engine}`;
  const target = contract.targets[browser];
  if (
    !exactKeys(value, [
      "archive",
      "available_engines",
      "browser",
      "build_variant",
      "bytes",
      "default_engine",
      "input_fingerprint",
      "path",
      "sha256",
      "target",
    ]) ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < 1 ||
    !validSha256(value.sha256) ||
    value.archive !==
      `artifacts/browser/${browser}/${engine}/ai-footprint-tracker-${manifest.version}-${variant}.zip` ||
    value.path !== `/downloads/ai-footprint-tracker-${browser}.zip` ||
    value.target !== target.folder ||
    value.browser !== browser ||
    value.default_engine !== engine ||
    JSON.stringify(value.available_engines) !==
      JSON.stringify(contract.engines) ||
    !validBuildVariant(value.build_variant, browser, engine, contract, manifest)
  )
    return false;
  const fingerprint = value.input_fingerprint;
  const inputs = fingerprint?.inputs;
  return (
    exactKeys(fingerprint, ["algorithm", "inputs", "sha256"]) &&
    fingerprint.algorithm === "sha256" &&
    validSha256(fingerprint.sha256) &&
    exactKeys(inputs, [
      "available_engines",
      "browser",
      "configuration_sha256",
      "default_engine",
      "ecologits",
      "manifest_version",
      "source",
      "source_date_epoch",
    ]) &&
    JSON.stringify(inputs.source) === JSON.stringify(currentFingerprint) &&
    inputs.browser === browser &&
    inputs.manifest_version === target.manifest_version &&
    inputs.default_engine === engine &&
    JSON.stringify(inputs.available_engines) ===
      JSON.stringify(contract.engines) &&
    inputs.configuration_sha256 === value.build_variant.configuration_sha256 &&
    JSON.stringify(inputs.ecologits) ===
      JSON.stringify(value.build_variant.ecologits) &&
    inputs.source_date_epoch === manifest.source_date_epoch &&
    variantFingerprint(inputs) === fingerprint.sha256
  );
}

async function validateSourceVerification(
  artifacts,
  manifest,
  currentFingerprint,
  variants,
) {
  const reportPath = resolve(artifacts, "source-verification.json");
  const info = await lstat(reportPath).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink())
    throw new Error(
      "The three-variant source verification report is missing or unsafe.",
    );
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  if (
    !exactKeys(report, [
      "comparison",
      "input_fingerprint",
      "matches",
      "schema_version",
      "source_archive_sha256",
      "targets",
      "version",
    ]) ||
    report.schema_version !== "2.0.0" ||
    report.version !== manifest.version ||
    report.matches !== true ||
    report.comparison !==
      "uncompressed distribution paths, byte lengths and SHA-256 hashes" ||
    report.source_archive_sha256 !== manifest.packages.sources.sha256 ||
    JSON.stringify(report.input_fingerprint) !==
      JSON.stringify(currentFingerprint) ||
    !exactKeys(report.targets, variants)
  )
    throw new Error(
      "The three-variant source verification report is stale or invalid.",
    );
  for (const variant of variants) {
    const target = report.targets[variant];
    if (
      !exactKeys(target, [
        "archive_sha256",
        "changed",
        "expected_entries",
        "extra",
        "matches",
        "missing",
        "rebuilt_entries",
      ]) ||
      target.archive_sha256 !== manifest.packages[variant].sha256 ||
      target.matches !== true ||
      !Number.isSafeInteger(target.expected_entries) ||
      target.expected_entries < 1 ||
      target.rebuilt_entries !== target.expected_entries ||
      !validDifferenceList(target.missing) ||
      !validDifferenceList(target.extra) ||
      !validDifferenceList(target.changed)
    )
      throw new Error(
        `The ${variant} source reconstruction proof is stale or invalid.`,
      );
  }
}

export async function validateDownloadManifest(options = {}) {
  const root = options.repository ?? repository;
  const publicFolder = options.publicOutput ?? publicOutput;
  const artifacts =
    options.artifactOutput ?? resolve(root, "artifacts/browser");
  const contract =
    options.contract ?? (await loadBrowserInputContract(options.contractPath));
  const extensionPackage = JSON.parse(
    await readFile(resolve(root, "apps/extension/package.json"), "utf8"),
  );
  const publicManifestPath = resolve(publicFolder, "manifest.json");
  const artifactManifestPath = resolve(artifacts, "manifest.json");
  if (
    !(await exists(publicManifestPath)) ||
    !(await exists(artifactManifestPath))
  )
    throw new Error("The custom browser release manifest is missing.");
  for (const path of [publicManifestPath, artifactManifestPath]) {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error("The custom browser release manifest is unsafe.");
  }
  const publicText = await readFile(publicManifestPath, "utf8");
  const artifactText = await readFile(artifactManifestPath, "utf8");
  if (publicText !== artifactText)
    throw new Error("The website and artifact release manifests differ.");
  const manifest = JSON.parse(publicText);
  const browsers = ["chrome", "edge", "firefox"];
  const engines = ["ecologits"];
  const variants = browsers.flatMap((browser) =>
    engines.map((engine) => `${browser}-${engine}`),
  );
  if (
    !exactKeys(manifest, [
      "aliases",
      "build_status",
      "default_selection",
      "input_fingerprint",
      "packages",
      "product",
      "schema_version",
      "signing_status",
      "source_date_epoch",
      "version",
    ]) ||
    manifest.schema_version !== "2.0.0" ||
    manifest.product !== "ai-footprint-tracker" ||
    manifest.version !== extensionPackage.version ||
    manifest.build_status !== "release_candidate" ||
    manifest.signing_status !== "unsigned_manual_install" ||
    !Number.isSafeInteger(manifest.source_date_epoch) ||
    manifest.source_date_epoch < 315532800 ||
    !exactKeys(manifest.input_fingerprint, ["algorithm", "files", "sha256"]) ||
    manifest.input_fingerprint.algorithm !== "sha256" ||
    !Number.isSafeInteger(manifest.input_fingerprint.files) ||
    manifest.input_fingerprint.files < 1 ||
    !validSha256(manifest.input_fingerprint.sha256) ||
    JSON.stringify(contract.engines) !== JSON.stringify(engines) ||
    !exactKeys(contract.targets, browsers) ||
    !exactKeys(manifest.packages, [...variants, "sources"])
  )
    throw new Error("The browser release manifest has an unsupported shape.");
  const currentFingerprint = await browserInputFingerprint(root, contract);
  if (
    JSON.stringify(currentFingerprint) !==
    JSON.stringify(manifest.input_fingerprint)
  )
    throw new Error("Browser packages do not match the current source inputs.");
  for (const browser of browsers) {
    for (const engine of engines) {
      const variant = `${browser}-${engine}`;
      const record = manifest.packages[variant];
      if (
        !validVariantRecord(
          record,
          browser,
          engine,
          contract,
          manifest,
          currentFingerprint,
        )
      )
        throw new Error(`The ${variant} package metadata is invalid.`);
      await assertDigest(
        resolve(root, record.archive),
        record,
        `${variant} artifact`,
      );
      await assertDigest(
        resolve(publicFolder, `ai-footprint-tracker-${browser}.zip`),
        record,
        `${variant} canonical download`,
      );
    }
  }
  const configurationPath = resolve(root, "config/estimation.build.json");
  const configuration = JSON.parse(await readFile(configurationPath, "utf8"));
  const selection = manifest.default_selection;
  const configurationDigest = await digest(configurationPath);
  if (
    configuration.default_engine !== selection?.engine ||
    JSON.stringify(configuration.available_engines) !==
      JSON.stringify(engines) ||
    !exactKeys(selection, [
      "effective_configuration_sha256",
      "engine",
      "source",
      "source_input_sha256",
      "source_sha256",
    ]) ||
    selection.source !== "config/estimation.build.json" ||
    selection.source_sha256 !== configurationDigest.sha256 ||
    selection.source_input_sha256 !== currentFingerprint.sha256 ||
    !validSha256(selection.effective_configuration_sha256)
  )
    throw new Error("The default browser download selection is invalid.");
  if (!exactKeys(manifest.aliases, browsers))
    throw new Error("The browser compatibility aliases are invalid.");
  const entries = {};
  for (const browser of browsers) {
    const variant = `${browser}-${selection.engine}`;
    const selected = manifest.packages[variant];
    const alias = manifest.aliases[browser];
    const webName = `ai-footprint-tracker-${browser}.zip`;
    if (
      !exactKeys(alias, ["bytes", "path", "sha256", "variant_id"]) ||
      alias.variant_id !== variant ||
      alias.path !== `/downloads/${webName}` ||
      alias.bytes !== selected.bytes ||
      alias.sha256 !== selected.sha256 ||
      selected.build_variant.configuration_sha256 !==
        selection.effective_configuration_sha256
    )
      throw new Error(`The ${browser} compatibility alias is invalid.`);
    await assertDigest(
      resolve(publicFolder, webName),
      alias,
      `${browser} compatibility alias`,
    );
    entries[browser] = alias.path;
  }
  const sources = manifest.packages.sources;
  const sourceName = `ai-footprint-tracker-${manifest.version}-sources.zip`;
  if (
    !validSourceDigest(sources) ||
    sources.archive !== `artifacts/browser/${sourceName}` ||
    manifest.default_selection.source_input_sha256 !==
      manifest.input_fingerprint.sha256
  )
    throw new Error("The matching source package metadata is invalid.");
  await assertDigest(
    resolve(root, sources.archive),
    sources,
    "source artifact",
  );
  await validateSourceVerification(
    artifacts,
    manifest,
    currentFingerprint,
    variants,
  );
  return entries;
}

export async function prepareDownloads(options = {}) {
  const allowUnavailable = options.allowUnavailable ?? false;
  let entries;
  if (options.forceUnavailable) {
    entries = {};
  } else {
    try {
      entries = await validateDownloadManifest(options);
    } catch (error) {
      if (!allowUnavailable) throw error;
      entries = {};
      if (!options.quiet)
        console.warn(
          `Browser downloads are unavailable: ${error instanceof Error ? error.message : "validation failed"}`,
        );
    }
  }
  const output = options.generated ?? generated;
  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    `// Generated from validated aliases for the checked-in browser default.\nexport const builtDownloads = ${JSON.stringify(entries)} as const;\n`,
    "utf8",
  );
  return entries;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await prepareDownloads({
    allowUnavailable: process.argv.includes("--allow-unavailable"),
    forceUnavailable: process.argv.includes("--force-unavailable"),
  });
