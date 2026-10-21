import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { extractTarGz, jsonBytes, readJson } from "../lib/common.mjs";
import {
  acceptedRelease,
  archiveDirectory,
  copyCore,
  runNode,
} from "./helpers.mjs";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const core = join(workspace, "packages/ecologits-core");
const estimator = join(workspace, "packages/estimator");
const release = await acceptedRelease(workspace);
const flagship = (
  await readJson(join(workspace, "config/estimation.build.json"))
).ecologits_fallback.provider_defaults.anthropic.profile.model_name;

async function productCopy(root, name) {
  const target = join(root, name);
  await mkdir(join(target, "packages"), { recursive: true });
  await copyCore(core, join(target, "packages/ecologits-core"));
  await copyCore(estimator, join(target, "packages/estimator"));
  await copyCore(join(workspace, "config"), join(target, "config"));
  await copyCore(
    join(workspace, "apps/server/aift"),
    join(target, "apps/server/aift"),
  );
  await copyFile(
    join(workspace, "tsconfig.base.json"),
    join(target, "tsconfig.base.json"),
  );
  return target;
}

async function dependencies(target) {
  const links = {
    "@footprint/ecologits-core": join(target, "packages/ecologits-core"),
    "@footprint/contracts": join(workspace, "packages/contracts"),
    "decimal.js": await realpath(join(estimator, "node_modules/decimal.js")),
    zod: await realpath(join(estimator, "node_modules/zod")),
  };
  for (const [name, source] of Object.entries(links)) {
    const destination = join(target, "packages/estimator/node_modules", name);
    await mkdir(dirname(destination), { recursive: true });
    await symlink(
      source,
      destination,
      process.platform === "win32" ? "junction" : "dir",
    );
  }
}

for (const kind of ["release_candidate", "qualified_combination"])
  test(
    `RL16 RL23 ${kind} adoption reaches the default product view and preserves Original`,
    {
      timeout: 180_000,
      skip: release.available
        ? false
        : "requires the developer-private pinned source archive; no network fallback",
    },
    async (context) => {
      const root = await mkdtemp(join(tmpdir(), "ecologits-product-adoption-"));
      context.after(() => rm(root, { recursive: true, force: true }));
      const before = await productCopy(root, "before");
      const after = await productCopy(root, "after");
      const candidate = join(root, "upstream-candidate");
      await extractTarGz(release.sourceArchive, candidate);
      const modelPath = join(candidate, "ecologits/data/models.json");
      const catalog = await readJson(modelPath);
      const direct = structuredClone(
        catalog.models.find(
          (model) =>
            model.provider === "anthropic" && model.name === "claude-opus-4-8",
        ),
      );
      assert.ok(direct);
      direct.name = "synthetic-supported-opus";
      direct.architecture = { type: "dense", parameters: 8 };
      if (kind === "qualified_combination") catalog.models.push(direct);
      await writeFile(modelPath, jsonBytes(catalog));
      const catalogArchive = join(root, "candidate.tar.gz");
      await archiveDirectory(candidate, catalogArchive);
      const stage = join(root, "stage");
      const update = runNode(
        workspace,
        join(workspace, "tools/ecologits/update.mjs"),
        [
          "--repository-root",
          after,
          "--stage",
          stage,
          "--version",
          release.version,
          ...(kind === "qualified_combination"
            ? [
                "--core-commit",
                release.commit,
                "--catalog-commit",
                "b".repeat(40),
                "--qualified-label",
                "product-adoption-proof",
              ]
            : ["--commit", release.commit]),
          "--python-project",
          join(core, "oracle"),
          ...(kind === "qualified_combination"
            ? [
                "--core-source-archive",
                release.sourceArchive,
                "--catalog-source-archive",
                catalogArchive,
              ]
            : ["--source-archive", release.sourceArchive]),
          "--package-archive",
          release.packageArchive,
        ],
      );
      assert.equal(update.status, 0, `${update.stdout}${update.stderr}`);
      const verification = runNode(
        workspace,
        join(workspace, "tools/ecologits/verify-update.mjs"),
        ["--repository-root", after, "--stage", stage, "--cases", "4"],
      );
      assert.equal(
        verification.status,
        0,
        `${verification.stdout}${verification.stderr}`,
      );
      assert.equal(
        (await readJson(join(stage, "verification/report.json"))).status,
        "passed",
      );
      await dependencies(before);
      await dependencies(after);
      const proof = runNode(
        workspace,
        join(workspace, "tools/ecologits/test/product-adoption-proof.mts"),
        [before, after, stage, kind],
      );
      assert.equal(proof.status, 0, `${proof.stdout}${proof.stderr}`);
      const evidence = JSON.parse(proof.stdout.trim().split("\n").at(-1));
      assert.equal(
        evidence.direct_model,
        kind === "qualified_combination"
          ? "synthetic-supported-opus"
          : flagship,
      );
      assert.equal(evidence.original_unchanged, true);
      context.diagnostic(JSON.stringify(evidence));
    },
  );
