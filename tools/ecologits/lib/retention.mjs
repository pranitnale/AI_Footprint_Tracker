import { basename } from "node:path";
import {
  containedPath,
  fileRecord,
  hashTree,
  jsonBytes,
  sha256Bytes,
} from "./common.mjs";

export async function validateAcceptedRetention(snapshotRoot, manifest) {
  if (
    manifest.schema_version !== 1 ||
    manifest.distribution !== "retained-source-subset"
  ) {
    throw new Error("Unsupported retained source manifest");
  }
  if (basename(snapshotRoot) !== manifest.snapshot_directory)
    throw new Error("Retained snapshot directory does not match its manifest");
  const actual = await hashTree(snapshotRoot);
  const expected = Object.fromEntries(
    Object.entries(manifest.retained_files).map(([path, record]) => [
      path,
      record.sha256,
    ]),
  );
  if (!jsonBytes(actual).equals(jsonBytes(expected)))
    throw new Error(
      "Accepted retained source bytes do not match retained-source.json",
    );
  const overlap = Object.keys(manifest.retained_files).filter((path) =>
    Object.hasOwn(manifest.excluded_files, path),
  );
  if (overlap.length)
    throw new Error(
      `Retained and excluded source entries overlap: ${overlap.join(", ")}`,
    );
  if (
    Object.keys(manifest.retained_files).length +
      Object.keys(manifest.excluded_files).length !==
    manifest.original_file_count
  ) {
    throw new Error("Retained source manifest file count is inconsistent");
  }
}

function exclusionReason(path, acceptedManifest) {
  if (acceptedManifest.excluded_files[path])
    return acceptedManifest.excluded_files[path].reason;
  if (/^tests\/.*\/cassettes\/|^tests\/cassettes\//i.test(path))
    return "sdk-cassette";
  if (/^tests\//i.test(path)) return "upstream-test-fixture";
  if (/^docs\/assets\/.*\.(png|jpe?g|gif|webp|svg)$/i.test(path))
    return "documentation-image";
  if (/^docs\//i.test(path)) return "upstream-documentation";
  if (/^\.github\//i.test(path)) return "project-infrastructure";
  return "outside-core-oracle-surface";
}

function retainedReason(path, acceptedManifest, sourceMap) {
  if (acceptedManifest.retained_files[path])
    return acceptedManifest.retained_files[path].reason;
  if (
    sourceMap.functions_and_types.some((entry) => entry.upstream_file === path)
  )
    return "source-to-port-surface";
  if (/^ecologits\/data\/[^/]+\.json$/i.test(path))
    return "generated-catalog-input";
  if (/^ecologits\/(?:[^/]+\/)*__init__\.py$/i.test(path))
    return "python-package-boundary";
  if (/^(LICENSE[^/]*|NOTICE[^/]*|CITATION\.cff)$/i.test(path))
    return "license-notice-citation";
  if (/^(pyproject\.toml|PKG-INFO|README\.md)$/i.test(path))
    return "package-metadata";
  return null;
}

export async function buildCandidateRetention({
  candidateRoot,
  candidateFiles,
  acceptedManifest,
  sourceMap,
  selection,
  sourceArtifact,
}) {
  const retained = {};
  const excluded = {};
  for (const path of Object.keys(candidateFiles).sort()) {
    const reason = retainedReason(path, acceptedManifest, sourceMap);
    const record = await fileRecord(containedPath(candidateRoot, path));
    const value = {
      sha256: record.sha256,
      size: record.bytes,
      reason: reason ?? exclusionReason(path, acceptedManifest),
    };
    if (reason) retained[path] = value;
    else excluded[path] = value;
  }
  const missingSourceMapFiles = [
    ...new Set(
      sourceMap.functions_and_types
        .map((entry) => entry.upstream_file)
        .filter((path) => !retained[path]),
    ),
  ].sort();
  const acceptedOriginalHashes = Object.fromEntries(
    Object.entries({
      ...acceptedManifest.retained_files,
      ...acceptedManifest.excluded_files,
    }).map(([path, record]) => [path, record.sha256]),
  );
  const sameOriginalFiles = jsonBytes(candidateFiles).equals(
    jsonBytes(acceptedOriginalHashes),
  );
  const manifest = {
    schema_version: 1,
    distribution: "retained-source-subset",
    snapshot_directory: selection.snapshot_directory,
    upstream_version: selection.version,
    requested_git_commit: selection.core_commit,
    source_artifact: sourceArtifact,
    private_preservation:
      sameOriginalFiles && acceptedManifest.private_preservation
        ? acceptedManifest.private_preservation
        : "The complete selected source and package archives are preserved in the developer Git metadata directory. Public build and test verification use only this retained manifest and the locked package environment.",
    original_file_count: Object.keys(candidateFiles).length,
    retained_files: retained,
    excluded_files: excluded,
    verification: sameOriginalFiles
      ? acceptedManifest.verification
      : "Every retained file hash and size were calculated from the exact staged candidate before this manifest was sealed. Excluded files retain hashes and classifications only. No complete Git tag attestation is asserted.",
  };
  return {
    manifest,
    sha256: sha256Bytes(jsonBytes(manifest)),
    same_original_files: sameOriginalFiles,
    missing_source_map_files: missingSourceMapFiles,
  };
}
