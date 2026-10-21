import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  copyTree,
  extractTarGz,
  hashTree,
  jsonBytes,
  readJson,
} from "../lib/common.mjs";
import {
  acceptedRelease,
  archiveDirectory,
  copyCore,
  runNode,
} from "./helpers.mjs";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const core = join(workspace, "packages/ecologits-core");
const oracle = join(core, "oracle");
const updateScript = join(workspace, "tools/ecologits/update.mjs");
const verifyScript = join(workspace, "tools/ecologits/verify-update.mjs");
const adoptScript = join(workspace, "tools/ecologits/adopt.mjs");
const release = await acceptedRelease(workspace);
const { version, commit } = release;

function output(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function expectSuccess(result, label) {
  assert.equal(result.status, 0, `${label}\n${output(result)}`);
}

async function fixtureRepository(root, name) {
  const repository = join(root, name);
  await mkdir(join(repository, "packages"), { recursive: true });
  await copyCore(core, join(repository, "packages/ecologits-core"));
  await copyFile(
    join(workspace, "tsconfig.base.json"),
    join(repository, "tsconfig.base.json"),
  );
  return repository;
}

async function candidateDirectory(root, source, name, mutate) {
  const candidate = join(root, name);
  await copyTree(source, candidate);
  if (mutate) await mutate(candidate);
  return candidate;
}

async function stageOfficial({ root, name, repository }) {
  const stage = join(root, `${name}-stage`);
  const update = runNode(workspace, updateScript, [
    "--version",
    version,
    "--commit",
    commit,
    "--stage",
    stage,
    "--repository-root",
    repository,
    "--python-project",
    oracle,
    "--source-archive",
    release.sourceArchive,
    "--package-archive",
    release.packageArchive,
  ]);
  expectSuccess(update, `${name} update`);
  return stage;
}

async function stageCatalogCandidate({
  root,
  name,
  repository,
  catalogSource,
  coreSourceArchive = release.sourceArchive,
  extra = [],
}) {
  const catalogArchive = join(root, `${name}-catalog.tar.gz`);
  await archiveDirectory(catalogSource, catalogArchive);
  const stage = join(root, `${name}-stage`);
  const catalogCommit = name
    .split("")
    .reduce(
      (value, character) =>
        (value + character.charCodeAt(0).toString(16)).slice(-40),
      "",
    )
    .padEnd(40, "b")
    .slice(0, 40);
  const update = runNode(workspace, updateScript, [
    "--version",
    version,
    "--core-commit",
    commit,
    "--catalog-commit",
    catalogCommit === commit ? "b".repeat(40) : catalogCommit,
    "--qualified-label",
    name,
    "--stage",
    stage,
    "--repository-root",
    repository,
    "--python-project",
    oracle,
    "--core-source-archive",
    coreSourceArchive,
    "--catalog-source-archive",
    catalogArchive,
    "--package-archive",
    release.packageArchive,
    ...extra,
  ]);
  expectSuccess(update, `${name} update`);
  return stage;
}

async function stageCandidate({
  root,
  name,
  repository,
  source,
  packageSource = source,
  extra = [],
}) {
  const sourceArchive = join(root, `${name}-source.tar.gz`);
  const packageArchive = join(root, `${name}-package.tar.gz`);
  await archiveDirectory(source, sourceArchive);
  await archiveDirectory(packageSource, packageArchive);
  const stage = join(root, `${name}-stage`);
  const update = runNode(workspace, updateScript, [
    "--version",
    version,
    "--commit",
    commit,
    "--stage",
    stage,
    "--repository-root",
    repository,
    "--python-project",
    oracle,
    "--source-archive",
    sourceArchive,
    "--package-archive",
    packageArchive,
    ...extra,
  ]);
  expectSuccess(update, `${name} update`);
  return stage;
}

async function verify(repository, stage, expectedStatus = 0) {
  const result = runNode(workspace, verifyScript, [
    "--stage",
    stage,
    "--repository-root",
    repository,
    "--cases",
    "4",
  ]);
  assert.equal(result.status, expectedStatus, output(result));
  return readJson(join(stage, "verification/report.json"));
}

async function packageHashes(repository) {
  return hashTree(join(repository, "packages/ecologits-core"));
}

test(
  "RL09-RL18 and RL21 staged maintenance and recoverable adoption",
  {
    timeout: 600_000,
    skip: release.available
      ? false
      : "requires the developer-private pinned EcoLogits source artifact",
  },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "ecologits-workflow-test-"));
    try {
      const repository = await fixtureRepository(root, "repository");
      const officialSource = join(root, "official-source");
      await extractTarGz(release.sourceArchive, officialSource);

      const unchangedStage = await stageOfficial({
        root,
        name: "unchanged",
        repository,
      });
      const unchangedReport = await verify(repository, unchangedStage);
      assert.equal(unchangedReport.status, "passed");
      assert.equal(unchangedReport.catalog.sections.models.added.length, 0);
      assert.equal(
        unchangedReport.numerical.accepted_candidate_deltas.length,
        0,
      );
      assert.equal(unchangedReport.execution.network_used, false);
      assert.equal(
        unchangedReport.execution.ordinary_runtime_fetch_required,
        false,
      );
      assert.equal(unchangedReport.retention.excluded_file_count, 143);
      const firstCatalog = await readFile(
        join(unchangedStage, "verification/generated/catalog.json"),
      );
      const rerunReport = await verify(repository, unchangedStage);
      assert.equal(
        rerunReport.deterministic_generation.catalog_sha256,
        unchangedReport.deterministic_generation.catalog_sha256,
      );
      assert.deepEqual(
        await readFile(
          join(unchangedStage, "verification/generated/catalog.json"),
        ),
        firstCatalog,
      );

      const addition = await candidateDirectory(
        root,
        officialSource,
        "addition",
        async (candidate) => {
          const path = join(candidate, "ecologits/data/models.json");
          const data = await readJson(path);
          const model = structuredClone(
            data.models.find(
              (item) =>
                item.provider === "cohere" &&
                typeof item.architecture.parameters === "number",
            ),
          );
          model.name = "synthetic-compatible-model";
          data.models.push(model);
          await writeFile(path, jsonBytes(data));
        },
      );
      const additionStage = await stageCatalogCandidate({
        root,
        name: "addition",
        repository,
        catalogSource: addition,
      });
      const additionReport = await verify(repository, additionStage);
      assert.equal(additionReport.status, "passed");
      assert.ok(
        additionReport.catalog.sections.models.added.includes(
          "cohere/synthetic-compatible-model",
        ),
      );
      const additionPlan = await readJson(
        join(additionStage, "verification/adoption-plan.json"),
      );
      assert.equal(
        additionPlan.entries.some((entry) => entry.target.startsWith("src/")),
        false,
      );
      assert.equal(
        additionPlan.entries.some(
          (entry) =>
            entry.scope === "package" &&
            entry.target.includes("tests/cassettes"),
        ),
        false,
      );
      assert.ok(
        additionPlan.entries.some(
          (entry) =>
            entry.scope === "private" &&
            entry.target.startsWith(".git/refinement-artifacts/vendor-source/"),
        ),
      );

      const normalTarget = await fixtureRepository(
        root,
        "normal-command-target",
      );
      const normalPackage = join(normalTarget, "packages/ecologits-core");
      await mkdir(join(normalPackage, "node_modules"));
      await mkdir(join(normalPackage, "node_modules/@types"));
      for (const dependency of ["tsx", "typescript", "@types/node"]) {
        await symlink(
          join(workspace, "node_modules", dependency),
          join(normalPackage, "node_modules", dependency),
          process.platform === "win32" ? "junction" : "dir",
        );
      }
      try {
        const normalAdoption = runNode(workspace, adoptScript, [
          "--stage",
          additionStage,
          "--target-root",
          normalTarget,
        ]);
        expectSuccess(normalAdoption, "compatible model adoption");
        const normalCommandResults = [];
        for (const commandName of ["catalog:check", "typecheck", "test"]) {
          const program =
            process.platform === "win32" ? process.env.ComSpec : "pnpm";
          const commandArgs =
            process.platform === "win32"
              ? ["/d", "/c", `pnpm ${commandName}`]
              : [commandName];
          const command = spawnSync(program, commandArgs, {
            cwd: normalPackage,
            encoding: "utf8",
            maxBuffer: 128 * 1024 * 1024,
            timeout: 240_000,
            env: {
              ...process.env,
              UV_OFFLINE: "1",
              PATH: `${join(workspace, "node_modules/.bin")}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`,
            },
          });
          assert.equal(
            command.status,
            0,
            `${commandName} after compatible adoption\n${output(command)}`,
          );
          normalCommandResults.push({
            command: commandName,
            status: command.status,
          });
        }
        const normallyAdoptedCatalog = await readJson(
          join(normalPackage, "data/catalog.json"),
        );
        assert.ok(
          normallyAdoptedCatalog.models.some(
            (model) => model.name === "synthetic-compatible-model",
          ),
        );
        console.log(
          JSON.stringify({
            scenario: "RL11-compatible-post-adoption",
            model: "cohere/synthetic-compatible-model",
            commands: normalCommandResults,
          }),
        );
      } finally {
        for (const dependency of ["tsx", "typescript", "@types/node"]) {
          const link = join(normalPackage, "node_modules", dependency);
          if (existsSync(link)) await unlink(link);
        }
      }

      const nextStage = await stageCatalogCandidate({
        root,
        name: "after-qualified-adoption",
        repository: normalTarget,
        catalogSource: addition,
      });
      const nextReport = await verify(normalTarget, nextStage);
      assert.equal(nextReport.status, "passed");
      assert.equal(nextReport.numerical.accepted_candidate_deltas.length, 0);

      const commentOnly = await candidateDirectory(
        root,
        officialSource,
        "comment-only",
        async (candidate) => {
          const path = join(candidate, "ecologits/impacts/llm.py");
          await writeFile(
            path,
            `${await readFile(path, "utf8")}\n# Synthetic byte-only mismatch.\n`,
          );
        },
      );
      const commentArchive = join(root, "comment-only.tar.gz");
      await archiveDirectory(commentOnly, commentArchive);
      const commentStage = await stageCatalogCandidate({
        root,
        name: "qualified-code-mismatch",
        repository,
        catalogSource: addition,
        coreSourceArchive: commentArchive,
      });
      const commentReport = await verify(repository, commentStage, 1);
      assert.ok(
        commentReport.blockers.some(
          (item) => item.code === "qualified-core-package-mismatch",
        ),
      );

      const directRepository = await fixtureRepository(
        root,
        "direct-repository",
      );
      await mkdir(join(directRepository, "config"));
      const directOverlay = {
        schema_version: "1",
        flagships: {},
        overrides: [],
        mappings: [
          {
            observed_model_id: "synthetic-site-model",
            provider: "cohere",
            direct_profile_id: "synthetic-compatible-model",
            fallback_profile_id: "c4ai-aya-expanse-32b",
          },
        ],
      };
      await writeFile(
        join(directRepository, "config/ecologits-product-policy.json"),
        jsonBytes(directOverlay),
      );
      const directStage = await stageCatalogCandidate({
        root,
        name: "direct-replacement",
        repository: directRepository,
        catalogSource: addition,
        extra: ["--overlay", "config/ecologits-product-policy.json"],
      });
      const directReport = await verify(directRepository, directStage);
      assert.deepEqual(directReport.overlay.direct_replacements, [
        {
          observed_model_id: "synthetic-site-model",
          direct_profile_id: "cohere/synthetic-compatible-model",
          prior_fallback_profile_id: "cohere/c4ai-aya-expanse-32b",
        },
      ]);

      const parameter = await candidateDirectory(
        root,
        officialSource,
        "parameter",
        async (candidate) => {
          const path = join(candidate, "ecologits/data/models.json");
          const data = await readJson(path);
          const model = data.models.find(
            (item) =>
              item.provider === "cohere" &&
              typeof item.architecture.parameters === "number",
          );
          model.architecture.parameters += 0.25;
          await writeFile(path, jsonBytes(data));
        },
      );
      const parameterStage = await stageCatalogCandidate({
        root,
        name: "parameter",
        repository,
        catalogSource: parameter,
      });
      const parameterReport = await verify(repository, parameterStage);
      assert.equal(parameterReport.status, "passed");
      assert.ok(
        parameterReport.catalog.classifications.parameter_changes.length > 0,
      );
      assert.ok(parameterReport.numerical.accepted_candidate_deltas.length > 0);
      assert.equal(parameterReport.numerical.parity, true);

      const providerDefault = await candidateDirectory(
        root,
        officialSource,
        "provider-default",
        async (candidate) => {
          const path = join(candidate, "ecologits/tracers/utils.py");
          const source = await readFile(path, "utf8");
          assert.ok(source.includes("datacenter_pue=1.20"));
          await writeFile(
            path,
            source.replace("datacenter_pue=1.20", "datacenter_pue=1.21"),
          );
        },
      );
      const providerDefaultStage = await stageCandidate({
        root,
        name: "provider-default",
        repository,
        source: providerDefault,
      });
      const providerDefaultReport = await verify(
        repository,
        providerDefaultStage,
        1,
      );
      assert.equal(providerDefaultReport.status, "failed");
      assert.ok(
        providerDefaultReport.catalog.sections.provider_defaults.changes
          .length > 0,
      );
      assert.deepEqual(
        providerDefaultReport.source_map.generated_catalog_changed_files,
        ["ecologits/tracers/utils.py"],
      );
      assert.ok(
        providerDefaultReport.numerical.accepted_candidate_deltas.length > 0,
      );
      assert.equal(providerDefaultReport.numerical.parity, true);
      assert.ok(
        providerDefaultReport.blockers.some(
          (item) => item.code === "candidate-environment-incompatible",
        ),
      );

      const formula = await candidateDirectory(
        root,
        officialSource,
        "formula",
        async (candidate) => {
          const path = join(candidate, "ecologits/impacts/llm.py");
          const source = await readFile(path, "utf8");
          assert.ok(
            source.includes("GPU_ENERGY_ALPHA = 1.1665273170451914e-06"),
          );
          await writeFile(
            path,
            source.replace(
              "GPU_ENERGY_ALPHA = 1.1665273170451914e-06",
              "GPU_ENERGY_ALPHA = 2.1665273170451914e-06",
            ),
          );
        },
      );
      const formulaStage = await stageCandidate({
        root,
        name: "formula",
        repository,
        source: formula,
        extra: ["--core-version", "0.11.1-port.2"],
      });
      const formulaReport = await verify(repository, formulaStage, 1);
      assert.equal(formulaReport.status, "failed");
      assert.ok(
        formulaReport.blockers.some(
          (item) =>
            item.code === "stale-source-map-hash" ||
            item.code === "stale-port-target",
        ),
      );
      assert.equal(formulaReport.numerical.parity, false);

      const unknownSchema = await candidateDirectory(
        root,
        officialSource,
        "unknown-schema",
        async (candidate) => {
          const path = join(candidate, "ecologits/data/electricity_mixes.json");
          const data = await readJson(path);
          data.electricity_mixes[0].energy_unit = "kWh";
          await writeFile(path, jsonBytes(data));
        },
      );
      const unknownStage = await stageCandidate({
        root,
        name: "unknown-schema",
        repository,
        source: unknownSchema,
      });
      const unknownResult = runNode(workspace, verifyScript, [
        "--stage",
        unknownStage,
        "--repository-root",
        repository,
        "--cases",
        "4",
      ]);
      assert.equal(unknownResult.status, 1, output(unknownResult));
      const unknownReport = await readJson(
        join(unknownStage, "verification/report.json"),
      );
      assert.ok(
        unknownReport.blockers.some(
          (item) => item.code === "candidate-conversion-failed",
        ),
      );
      assert.match(
        unknownReport.blockers[0].message,
        /Unclassified electricity fields/,
      );

      const license = await candidateDirectory(
        root,
        officialSource,
        "license",
        async (candidate) => {
          const path = join(candidate, "LICENSE");
          await writeFile(
            path,
            `${await readFile(path, "utf8")}\nSynthetic changed notice.\n`,
          );
        },
      );
      const licenseStage = await stageCandidate({
        root,
        name: "license",
        repository,
        source: license,
      });
      const licenseReport = await verify(repository, licenseStage, 1);
      assert.ok(
        licenseReport.blockers.some(
          (item) => item.code === "compliance-review-required",
        ),
      );
      assert.notDeepEqual(
        licenseReport.compliance.accepted_files,
        licenseReport.compliance.candidate_files,
      );

      const aliasRepository = await fixtureRepository(root, "alias-repository");
      await mkdir(join(aliasRepository, "config"));
      const acceptedCatalog = await readJson(join(core, "data/catalog.json"));
      const removedAlias = acceptedCatalog.aliases[0];
      const overlay = {
        schema_version: "1",
        flagships: { [removedAlias.provider]: removedAlias.name },
        overrides: [],
        mappings: [],
      };
      await writeFile(
        join(aliasRepository, "config/ecologits-product-policy.json"),
        jsonBytes(overlay),
      );
      const aliasCandidate = await candidateDirectory(
        root,
        officialSource,
        "alias-removal",
        async (candidate) => {
          const path = join(candidate, "ecologits/data/models.json");
          const data = await readJson(path);
          data.aliases = data.aliases.filter(
            (item) =>
              !(
                item.provider === removedAlias.provider &&
                item.name === removedAlias.name
              ),
          );
          await writeFile(path, jsonBytes(data));
        },
      );
      const aliasStage = await stageCatalogCandidate({
        root,
        name: "alias-removal",
        repository: aliasRepository,
        catalogSource: aliasCandidate,
        extra: ["--overlay", "config/ecologits-product-policy.json"],
      });
      const aliasReport = await verify(aliasRepository, aliasStage, 1);
      assert.ok(
        aliasReport.catalog.sections.aliases.removed.includes(
          `${removedAlias.provider}/${removedAlias.name}`,
        ),
      );
      assert.ok(
        aliasReport.blockers.some((item) => item.code === "overlay-conflict"),
      );

      assert.equal(
        additionReport.selection.release_kind,
        "qualified_combination",
      );
      assert.equal(additionReport.selection.official_release_claim, false);
      assert.ok(
        additionReport.package_source_comparison.differences.length > 0,
      );

      const dirtyTarget = await fixtureRepository(root, "dirty-target");
      const dirtyCatalogPath = join(
        dirtyTarget,
        "packages/ecologits-core/data/catalog.json",
      );
      await writeFile(
        dirtyCatalogPath,
        `${await readFile(dirtyCatalogPath, "utf8")} `,
      );
      const lockBeforeDirtyAdopt = await readFile(
        join(dirtyTarget, "packages/ecologits-core/upstream/lock.json"),
      );
      const dirtyAdopt = runNode(workspace, adoptScript, [
        "--stage",
        unchangedStage,
        "--target-root",
        dirtyTarget,
      ]);
      assert.notEqual(dirtyAdopt.status, 0);
      assert.match(output(dirtyAdopt), /Dirty or unexpected adoption target/);
      assert.deepEqual(
        await readFile(
          join(dirtyTarget, "packages/ecologits-core/upstream/lock.json"),
        ),
        lockBeforeDirtyAdopt,
      );

      const tamperTarget = await fixtureRepository(root, "tamper-target");
      const generatedCatalogPath = join(
        unchangedStage,
        "verification/generated/catalog.json",
      );
      const untamperedCatalog = await readFile(generatedCatalogPath);
      await writeFile(
        generatedCatalogPath,
        Buffer.concat([untamperedCatalog, Buffer.from(" ")]),
      );
      const tamperAdopt = runNode(workspace, adoptScript, [
        "--stage",
        unchangedStage,
        "--target-root",
        tamperTarget,
      ]);
      assert.notEqual(tamperAdopt.status, 0);
      assert.match(output(tamperAdopt), /modified after verification/);
      await writeFile(generatedCatalogPath, untamperedCatalog);

      const interruptedTarget = await fixtureRepository(
        root,
        "interrupted-target",
      );
      const interruptedBefore = await packageHashes(interruptedTarget);
      const interruptedPlan = await readJson(
        join(unchangedStage, "verification/adoption-plan.json"),
      );
      const catalogApplyCount =
        interruptedPlan.entries.findIndex(
          (entry) =>
            entry.scope === "package" && entry.target === "data/catalog.json",
        ) + 1;
      assert.ok(catalogApplyCount > 0);
      const interrupted = runNode(workspace, adoptScript, [
        "--stage",
        unchangedStage,
        "--target-root",
        interruptedTarget,
        "--test-interrupt-after",
        String(catalogApplyCount),
      ]);
      assert.equal(interrupted.status, 86, output(interrupted));
      const recovery = runNode(workspace, adoptScript, [
        "--recover",
        "--target-root",
        interruptedTarget,
      ]);
      expectSuccess(recovery, "interrupted recovery");
      assert.deepEqual(
        await packageHashes(interruptedTarget),
        interruptedBefore,
      );
      assert.deepEqual(await hashTree(join(interruptedTarget, ".git")), {});

      const failedTarget = await fixtureRepository(root, "failed-target");
      const failedBefore = await packageHashes(failedTarget);
      const failed = runNode(workspace, adoptScript, [
        "--stage",
        unchangedStage,
        "--target-root",
        failedTarget,
        "--test-fail-after",
        "3",
      ]);
      assert.notEqual(failed.status, 0);
      assert.deepEqual(await packageHashes(failedTarget), failedBefore);

      const adoptedTarget = await fixtureRepository(root, "adopted-target");
      const adoptedBefore = await packageHashes(adoptedTarget);
      const adopted = runNode(workspace, adoptScript, [
        "--stage",
        unchangedStage,
        "--target-root",
        adoptedTarget,
      ]);
      expectSuccess(adopted, "adoption");
      const adoptedLock = await readJson(
        join(adoptedTarget, "packages/ecologits-core/upstream/lock.json"),
      );
      assert.equal(adoptedLock.release_kind, "release_candidate");
      assert.equal(adoptedLock.official_release_claim, false);
      const rolledBack = runNode(workspace, adoptScript, [
        "--rollback",
        "latest",
        "--target-root",
        adoptedTarget,
      ]);
      expectSuccess(rolledBack, "rollback");
      assert.deepEqual(await packageHashes(adoptedTarget), adoptedBefore);
      const privateFilesAfterRollback = await hashTree(
        join(adoptedTarget, ".git"),
      );
      assert.deepEqual(privateFilesAfterRollback, {});
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
