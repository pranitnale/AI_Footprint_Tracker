import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { jsonBytes, sha256Bytes, sortValue } from "./common.mjs";

function equal(left, right) {
  return JSON.stringify(sortValue(left)) === JSON.stringify(sortValue(right));
}

function indexBy(items, key) {
  return new Map(items.map((item) => [key(item), item]));
}

function without(value, keys) {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !keys.includes(key)),
  );
}

function fieldChanges(left, right, prefix = "") {
  if (equal(left, right)) return [];
  if (
    !left ||
    !right ||
    typeof left !== "object" ||
    typeof right !== "object" ||
    Array.isArray(left) ||
    Array.isArray(right)
  ) {
    return [
      { path: prefix || "$", accepted: left ?? null, candidate: right ?? null },
    ];
  }
  return [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .sort()
    .flatMap((key) =>
      fieldChanges(left[key], right[key], prefix ? `${prefix}.${key}` : key),
    );
}

function diffRecords(
  acceptedItems,
  candidateItems,
  keyFunction,
  renameFields = [],
) {
  const accepted = indexBy(acceptedItems, keyFunction);
  const candidate = indexBy(candidateItems, keyFunction);
  const added = [...candidate.keys()]
    .filter((key) => !accepted.has(key))
    .sort();
  const removed = [...accepted.keys()]
    .filter((key) => !candidate.has(key))
    .sort();
  const modified = [...candidate.keys()]
    .filter(
      (key) =>
        accepted.has(key) && !equal(accepted.get(key), candidate.get(key)),
    )
    .sort()
    .map((key) => ({
      key,
      changes: fieldChanges(accepted.get(key), candidate.get(key)),
    }));
  const renamed = [];
  const usedAdded = new Set();
  for (const from of removed) {
    const left = without(accepted.get(from), renameFields);
    const matches = added.filter(
      (to) =>
        !usedAdded.has(to) &&
        equal(left, without(candidate.get(to), renameFields)),
    );
    if (matches.length === 1) {
      renamed.push({ from, to: matches[0] });
      usedAdded.add(matches[0]);
    }
  }
  return { added, removed, renamed, modified };
}

export function catalogDiff(accepted, candidate) {
  const acceptedAliasKeys = new Set(
    accepted.aliases.map((alias) => `${alias.provider}/${alias.name}`),
  );
  const candidateAliasKeys = new Set(
    candidate.aliases.map((alias) => `${alias.provider}/${alias.name}`),
  );
  const acceptedDirectModels = accepted.models.filter(
    (model) => !acceptedAliasKeys.has(`${model.provider}/${model.name}`),
  );
  const candidateDirectModels = candidate.models.filter(
    (model) => !candidateAliasKeys.has(`${model.provider}/${model.name}`),
  );
  const models = diffRecords(
    acceptedDirectModels,
    candidateDirectModels,
    (model) => `${model.provider}/${model.name}`,
    ["name"],
  );
  const aliases = diffRecords(
    accepted.aliases,
    candidate.aliases,
    (alias) => `${alias.provider}/${alias.name}`,
    ["name"],
  );
  const electricity = diffRecords(
    accepted.electricity_mixes,
    candidate.electricity_mixes,
    (mix) => mix.zone,
    ["zone"],
  );
  const videoModels = diffRecords(
    accepted.video.models,
    candidate.video.models,
    (model) => model.model_name,
    ["model_name"],
  );
  const hardware = diffRecords(
    Object.entries(accepted.video.hardware_configurations).map(
      ([name, value]) => ({ name, ...value }),
    ),
    Object.entries(candidate.video.hardware_configurations).map(
      ([name, value]) => ({ name, ...value }),
    ),
    (item) => item.name,
    ["name"],
  );
  const sections = {
    models,
    aliases,
    electricity_mixes: electricity,
    video_models: videoModels,
    video_hardware: hardware,
    provider_defaults: {
      changes: fieldChanges(
        accepted.provider_configurations,
        candidate.provider_configurations,
      ),
    },
    video_provider_defaults: {
      changes: fieldChanges(
        accepted.video.provider_configurations,
        candidate.video.provider_configurations,
      ),
    },
    warning_messages: {
      changes: fieldChanges(
        accepted.warning_messages,
        candidate.warning_messages,
      ),
    },
    error_messages: {
      changes: fieldChanges(accepted.error_messages, candidate.error_messages),
    },
    provenance: {
      model_changes: fieldChanges(
        accepted.model_provenance,
        candidate.model_provenance,
      ),
      electricity_changes: fieldChanges(
        accepted.electricity_provenance,
        candidate.electricity_provenance,
      ),
      video_changes: fieldChanges(
        accepted.video_provenance,
        candidate.video_provenance,
      ),
    },
  };
  const parameterChanges = models.modified.filter((item) =>
    item.changes.some((change) => change.path.startsWith("architecture.")),
  );
  const deploymentChanges = models.modified.filter((item) =>
    item.changes.some((change) => change.path.startsWith("deployment.")),
  );
  const warningChanges = models.modified.filter((item) =>
    item.changes.some((change) => change.path.startsWith("warnings.")),
  );
  const sourceChanges = models.modified.filter((item) =>
    item.changes.some((change) => change.path.startsWith("sources.")),
  );
  const factorChanges = electricity.modified.filter((item) =>
    item.changes.some((change) => /^(adpe|pe|gwp|wue)/.test(change.path)),
  );
  return {
    schema_version: "1",
    sections,
    classifications: {
      parameter_changes: parameterChanges,
      deployment_changes: deploymentChanges,
      model_warning_changes: warningChanges,
      model_source_changes: sourceChanges,
      electricity_factor_changes: factorChanges,
    },
  };
}

export function inventoryDiff(accepted, candidate) {
  const acceptedFiles = accepted.files;
  const candidateFiles = candidate.files;
  const added = Object.keys(candidateFiles)
    .filter((path) => !acceptedFiles[path])
    .sort();
  const removed = Object.keys(acceptedFiles)
    .filter((path) => !candidateFiles[path])
    .sort();
  const modified = Object.keys(candidateFiles)
    .filter(
      (path) =>
        acceptedFiles[path] &&
        candidateFiles[path].module_semantic_sha256 !==
          acceptedFiles[path].module_semantic_sha256,
    )
    .sort()
    .map((path) => {
      const before = acceptedFiles[path];
      const after = candidateFiles[path];
      const symbols = [
        ...new Set([
          ...Object.keys(before.symbols),
          ...Object.keys(after.symbols),
        ]),
      ].sort();
      return {
        path,
        assignment_changed:
          before.assignment_semantic_sha256 !==
          after.assignment_semantic_sha256,
        symbols: symbols
          .filter(
            (symbol) =>
              before.symbols[symbol]?.semantic_sha256 !==
              after.symbols[symbol]?.semantic_sha256,
          )
          .map((symbol) => ({
            symbol,
            accepted: before.symbols[symbol]?.semantic_sha256 ?? null,
            candidate: after.symbols[symbol]?.semantic_sha256 ?? null,
          })),
      };
    });
  return {
    added,
    removed,
    modified,
    dependencies: fieldChanges(accepted.project, candidate.project),
  };
}

function modelKeys(catalog) {
  return new Set(
    catalog.models.map((model) => `${model.provider}/${model.name}`),
  );
}

function profileKey(provider, profile) {
  return profile.includes("/") ? profile : `${provider}/${profile}`;
}

export function validateOverlay(overlay, acceptedCatalog, candidateCatalog) {
  if (!overlay)
    return {
      configured: false,
      conflicts: [],
      direct_replacements: [],
      references: [],
    };
  const allowed = new Set([
    "schema_version",
    "flagships",
    "overrides",
    "mappings",
  ]);
  const unknown = Object.keys(overlay).filter((key) => !allowed.has(key));
  if (unknown.length)
    throw new Error(`Unknown product overlay fields: ${unknown.join(", ")}`);
  if (overlay.schema_version !== "1")
    throw new Error("Unsupported product overlay schema_version");
  const accepted = modelKeys(acceptedCatalog);
  const candidate = modelKeys(candidateCatalog);
  const references = [];
  for (const [provider, profile] of Object.entries(overlay.flagships ?? {})) {
    references.push({
      kind: "flagship",
      owner: provider,
      provider,
      profile_id: profileKey(provider, profile),
    });
  }
  for (const item of overlay.overrides ?? []) {
    references.push({
      kind: "override",
      owner: item.observed_model_id ?? item.provider,
      provider: item.provider,
      profile_id: profileKey(item.provider, item.profile_id),
    });
  }
  const directReplacements = [];
  for (const mapping of overlay.mappings ?? []) {
    if (mapping.fallback_profile_id) {
      references.push({
        kind: "mapping_fallback",
        owner: mapping.observed_model_id,
        provider: mapping.provider,
        profile_id: profileKey(mapping.provider, mapping.fallback_profile_id),
      });
    }
    if (mapping.direct_profile_id) {
      const direct = profileKey(mapping.provider, mapping.direct_profile_id);
      if (
        !accepted.has(direct) &&
        candidate.has(direct) &&
        mapping.fallback_profile_id
      ) {
        directReplacements.push({
          observed_model_id: mapping.observed_model_id,
          direct_profile_id: direct,
          prior_fallback_profile_id: profileKey(
            mapping.provider,
            mapping.fallback_profile_id,
          ),
        });
      } else if (accepted.has(direct) || candidate.has(direct)) {
        references.push({
          kind: "mapping_direct",
          owner: mapping.observed_model_id,
          provider: mapping.provider,
          profile_id: direct,
        });
      }
    }
  }
  const conflicts = references
    .filter(
      (reference) =>
        accepted.has(reference.profile_id) &&
        !candidate.has(reference.profile_id),
    )
    .map((reference) => ({
      ...reference,
      reason: "accepted profile or alias was removed from the candidate",
    }));
  const invalid = references
    .filter(
      (reference) =>
        !accepted.has(reference.profile_id) &&
        !candidate.has(reference.profile_id),
    )
    .map((reference) => ({
      ...reference,
      reason:
        "profile or alias is absent from both accepted and candidate catalogs",
    }));
  return {
    configured: true,
    conflicts: [...conflicts, ...invalid],
    direct_replacements: directReplacements,
    references,
  };
}

function changedFileSet(inventoryChange) {
  return new Set([
    ...inventoryChange.added,
    ...inventoryChange.removed,
    ...inventoryChange.modified.map((change) => change.path),
  ]);
}

export function validateSourceMap({
  acceptedInventory,
  candidateInventory,
  inventoryChange,
  sourceMap,
  coreRootHashes,
  baselinePortHashes,
  selection,
}) {
  const mappedFiles = new Set(
    sourceMap.functions_and_types.map((entry) => entry.upstream_file),
  );
  const changedFiles = changedFileSet(inventoryChange);
  const calculationPrefixes = ["ecologits/impacts/", "ecologits/estimations/"];
  const relevantChangedFiles = [...changedFiles]
    .filter(
      (path) =>
        mappedFiles.has(path) ||
        calculationPrefixes.some((prefix) => path.startsWith(prefix)),
    )
    .sort();
  const failures = [];
  const changedSymbols = [];
  const generatedCatalogChangedFiles = [];
  const portRelevantChangedFiles = [];
  for (const path of relevantChangedFiles) {
    const change = inventoryChange.modified.find((item) => item.path === path);
    const candidateFile = candidateInventory.files[path];
    const entries = sourceMap.functions_and_types.filter(
      (entry) => entry.upstream_file === path,
    );
    if (entries.length === 0) {
      failures.push({ code: "unmapped-relevant-file", path });
      continue;
    }
    const entryBySymbol = new Map(
      entries.map((entry) => [entry.symbol, entry]),
    );
    for (const symbol of change?.symbols ?? []) {
      changedSymbols.push({ path, ...symbol });
      if (symbol.candidate !== null && !entryBySymbol.has(symbol.symbol))
        failures.push({
          code: "unmapped-relevant-symbol",
          path,
          symbol: symbol.symbol,
        });
    }
    const providerDefaultsOnly =
      path === "ecologits/tracers/utils.py" &&
      change?.assignment_changed &&
      change.symbols.length === 0;
    const statusCatalogOnly =
      path === "ecologits/status_messages.py" &&
      (change?.symbols.length ?? 0) > 0 &&
      change.symbols.every(
        (symbol) =>
          symbol.candidate === null ||
          entryBySymbol.get(symbol.symbol)?.disposition === "adapted",
      );
    if (providerDefaultsOnly || statusCatalogOnly) {
      if (
        statusCatalogOnly &&
        candidateFile &&
        entries.some(
          (entry) => entry.source_sha256 !== candidateFile.file_sha256,
        )
      ) {
        failures.push({
          code: "stale-source-map-hash",
          path,
          expected: candidateFile.file_sha256,
        });
      }
      generatedCatalogChangedFiles.push(path);
      continue;
    }
    portRelevantChangedFiles.push(path);
    if (
      candidateFile &&
      entries.some((entry) => entry.source_sha256 !== candidateFile.file_sha256)
    ) {
      failures.push({
        code: "stale-source-map-hash",
        path,
        expected: candidateFile.file_sha256,
      });
    }
    const targets = [
      ...new Set(
        entries.flatMap((entry) =>
          entry.port ? entry.port.split(/\s*\+\s*/) : [],
        ),
      ),
    ];
    if (targets.length === 0) {
      failures.push({ code: "changed-excluded-source", path });
      continue;
    }
    if (
      !targets.some(
        (target) =>
          coreRootHashes[target] &&
          coreRootHashes[target] !== baselinePortHashes[target],
      )
    ) {
      failures.push({ code: "stale-port-target", path, targets });
    }
  }
  if (portRelevantChangedFiles.length > 0) {
    if (
      sourceMap.upstream_commit !== selection.core_commit ||
      sourceMap.upstream_version !== selection.version
    ) {
      failures.push({
        code: "stale-source-map-identity",
        expected_commit: selection.core_commit,
        expected_version: selection.version,
      });
    }
  }
  return {
    relevant_changed_files: relevantChangedFiles,
    port_relevant_changed_files: portRelevantChangedFiles,
    generated_catalog_changed_files: generatedCatalogChangedFiles,
    changed_symbols: changedSymbols,
    failures,
  };
}

export async function attribution({
  candidateRoot,
  selection,
  lock,
  inventoryChange,
  projectLicense = null,
  complianceApproved = false,
}) {
  let license = null;
  let citation = null;
  try {
    license = await readFile(`${candidateRoot}/LICENSE`, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    citation = await readFile(`${candidateRoot}/CITATION.cff`, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const licenseHash =
    license === null ? null : sha256Bytes(Buffer.from(license));
  const citationHash =
    citation === null ? null : sha256Bytes(Buffer.from(citation));
  if (
    licenseHash !== lock.license_sha256 ||
    citationHash !== lock.citation_sha256
  )
    throw new Error("Attribution bytes differ from the candidate lock");
  const notice = [
    `EcoLogits ${selection.version}`,
    "",
    `Requested core commit (not independently attested): ${selection.core_commit}`,
    `Requested catalog commit (not independently attested): ${selection.catalog_commit}`,
    `Release classification: ${selection.release_kind}`,
    selection.qualified_label
      ? `Qualified combination: ${selection.qualified_label}`
      : null,
    "",
    "This package includes an independent TypeScript port of EcoLogits. EcoLogits is developed by its contributors and is part of CodeCarbon.",
    "See the reproduced LICENSE and matching source archive for the upstream terms. Existing derived files retain their applicable license obligations; this notice does not relicense them.",
    `Candidate package license declaration: ${JSON.stringify(projectLicense)}`,
    `License, notice and citation acceptance: ${complianceApproved ? "accepted unchanged or approved for the exact candidate hashes" : "pending review; candidate output only"}`,
    "",
    "Citation metadata reproduced from the candidate CITATION.cff:",
    "",
    ...(citation ?? "")
      .trimEnd()
      .split("\n")
      .map((line) => `    ${line}`),
    "",
    `License SHA256: ${lock.license_sha256}`,
    `Citation SHA256: ${lock.citation_sha256}`,
    `Dependency metadata changes: ${inventoryChange.dependencies.length}`,
    "",
  ]
    .filter((value) => value !== null)
    .join("\n");
  return {
    metadata: {
      schema_version: "1",
      upstream_version: selection.version,
      core_commit: selection.core_commit,
      catalog_commit: selection.catalog_commit,
      release_kind: selection.release_kind,
      commit_attestation: "requested-identifiers-only",
      provenance_note: lock.commit_evidence ?? null,
      project_license: projectLicense,
      compliance_approved: complianceApproved,
      license_filename: basename(`${candidateRoot}/LICENSE`),
      license_sha256: lock.license_sha256,
      citation_filename: basename(`${candidateRoot}/CITATION.cff`),
      citation_sha256: lock.citation_sha256,
      license_text_sha256: licenseHash,
      citation_text_sha256: citationHash,
    },
    notice: Buffer.from(`${notice.replace(/\n+$/, "")}\n`),
  };
}

export function semanticReportMarkdown(report) {
  const section = report.catalog.sections;
  const lines = [
    "# EcoLogits candidate verification",
    "",
    `Result: ${report.status.toUpperCase()}`,
    "",
    `Candidate: ${report.selection.version} (${report.selection.release_kind})`,
    `Core commit: ${report.selection.core_commit}`,
    `Catalog commit: ${report.selection.catalog_commit}`,
    "",
    "## Semantic changes",
    "",
    `- Models: +${section.models.added.length}, -${section.models.removed.length}, ${section.models.modified.length} modified, ${section.models.renamed.length} rename candidates`,
    `- Aliases: +${section.aliases.added.length}, -${section.aliases.removed.length}, ${section.aliases.modified.length} modified`,
    `- Electricity mixes: +${section.electricity_mixes.added.length}, -${section.electricity_mixes.removed.length}, ${section.electricity_mixes.modified.length} modified`,
    `- Video models: +${section.video_models.added.length}, -${section.video_models.removed.length}, ${section.video_models.modified.length} modified`,
    `- Relevant Python files changed: ${report.source_map.relevant_changed_files.length}`,
    `- Source archive files: +${report.source.archive_files.added.length}, -${report.source.archive_files.removed.length}, ${report.source.archive_files.modified.length} modified`,
    `- Dependency metadata changes: ${report.source.dependencies.length}`,
    `- License/citation review required: ${report.compliance.review_required}`,
    `- Public retained source files: ${report.retention.retained_file_count}; excluded upstream files: ${report.retention.excluded_file_count}`,
    "",
    "## Numerical verification",
    "",
    `- Candidate Python cases: ${report.numerical.cases}`,
    `- Candidate TypeScript parity: ${report.numerical.parity ? "passed" : "failed"}`,
    `- Accepted-to-candidate result changes: ${report.numerical.accepted_candidate_deltas.length}`,
    "",
    "## Blocking findings",
    "",
    ...(report.blockers.length
      ? report.blockers.map(
          (blocker) => `- ${blocker.code}: ${blocker.message}`,
        )
      : ["- None"]),
    "",
  ];
  return Buffer.from(lines.join("\n"));
}
