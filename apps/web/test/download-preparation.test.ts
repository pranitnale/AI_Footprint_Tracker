import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  rename,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { browserInputFingerprint } from "../../../tools/browser-inputs.mjs";
import { checkBuiltDownloads } from "../scripts/check-built-downloads.mjs";
import {
  prepareDownloads,
  validateDownloadManifest,
} from "../scripts/prepare-downloads.mjs";
import viteConfig from "../vite.config";

const contract = {
  variant_schema_version: "1.0.0",
  path_order: "utf8_bytes",
  fixed_files: ["fixed.txt"],
  source_roots: ["apps/extension", "config"],
  excluded_parts: [".output", "node_modules"],
  excluded_suffixes: [".log"],
  engines: ["ecologits"],
  targets: {
    chrome: { folder: "chrome-mv3", manifest_version: 3, target: "chrome-mv3" },
    edge: { folder: "edge-mv3", manifest_version: 3, target: "edge-mv3" },
    firefox: {
      folder: "firefox-mv2",
      manifest_version: 2,
      target: "firefox-mv2",
    },
  },
};

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

const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

test("Vite never copies the public downloads directory without release validation", () => {
  assert.equal(viteConfig.publicDir, false);
  const plugins = viteConfig.plugins as
    Array<{ name?: string; closeBundle?: unknown }> | undefined;
  assert.ok(
    Array.isArray(plugins) &&
      plugins.some(
        (plugin) =>
          plugin &&
          typeof plugin === "object" &&
          plugin.name === "verified-browser-downloads" &&
          typeof plugin.closeBundle === "function",
      ),
  );
});

async function fixture(defaultEngine: "original" | "ecologits" = "ecologits") {
  const root = await mkdtemp(join(tmpdir(), "aift-downloads-"));
  const artifacts = join(root, "artifacts/browser");
  const publicOutput = join(root, "apps/web/public/downloads");
  await mkdir(join(root, "apps/extension"), { recursive: true });
  await mkdir(join(root, "config"), { recursive: true });
  await mkdir(artifacts, { recursive: true });
  await mkdir(publicOutput, { recursive: true });
  await writeFile(join(root, "fixed.txt"), "fixed");
  await writeFile(
    join(root, "apps/extension/package.json"),
    JSON.stringify({ name: "@footprint/extension", version: "0.1.0" }),
  );
  await writeFile(join(root, "apps/extension/source.ts"), "current");
  const configuration = {
    schema_version: "1.0.0",
    default_engine: defaultEngine,
    available_engines: ["ecologits"],
  };
  const configurationPath = join(root, "config/estimation.build.json");
  await writeFile(configurationPath, `${JSON.stringify(configuration)}\n`);
  const inputFingerprint = await browserInputFingerprint(root, contract);
  const engineConfigurationHashes = {
    original: sha256("effective-original"),
    ecologits: sha256("effective-ecologits"),
  };
  const ecologits = {
    upstream_version: "0.11.1",
    core_version: "0.11.1-port.2",
    core_sha256: "1".repeat(64),
    catalog_sha256: "2".repeat(64),
    source_artifact_sha256: "3".repeat(64),
    retained_source_manifest_sha256: "4".repeat(64),
  };
  const bundledNotices = {
    license_path: "licenses.html",
    license_sha256: "5".repeat(64),
    source_path: "source/ecologits-source.zip",
    source_sha256: "6".repeat(64),
    inventory_sha256: "7".repeat(64),
  };
  const packages: Record<string, any> = {};
  for (const browser of ["chrome", "edge", "firefox"] as const) {
    for (const engine of ["ecologits"] as const) {
      const variant = `${browser}-${engine}`;
      const versionedName = `ai-footprint-tracker-0.1.0-${variant}.zip`;
      const webName = `ai-footprint-tracker-${browser}.zip`;
      const data = Buffer.from(`${variant}-archive`);
      const artifactFolder = join(artifacts, browser, engine);
      await mkdir(artifactFolder, { recursive: true });
      await writeFile(join(artifactFolder, versionedName), data);
      await writeFile(join(publicOutput, webName), data);
      const buildVariant = {
        schema_version: "1.0.0",
        variant_id: variant,
        build_status: "release_candidate",
        browser,
        manifest_version: contract.targets[browser].manifest_version,
        default_engine: engine,
        available_engines: ["ecologits"],
        user_override_enabled: false,
        configuration_sha256: engineConfigurationHashes[engine],
        ecologits,
        bundled_notices: bundledNotices,
        source_date_epoch: 1788998400,
      };
      const inputs = {
        source: inputFingerprint,
        browser,
        manifest_version: contract.targets[browser].manifest_version,
        default_engine: engine,
        available_engines: ["ecologits"],
        configuration_sha256: engineConfigurationHashes[engine],
        ecologits,
        source_date_epoch: 1788998400,
      };
      packages[variant] = {
        archive: `artifacts/browser/${browser}/${engine}/${versionedName}`,
        bytes: data.byteLength,
        path: `/downloads/${webName}`,
        sha256: sha256(data),
        target: contract.targets[browser].folder,
        browser,
        default_engine: engine,
        available_engines: ["ecologits"],
        build_variant: buildVariant,
        input_fingerprint: {
          algorithm: "sha256",
          sha256: sha256(JSON.stringify(canonical(inputs))),
          inputs,
        },
      };
    }
  }
  const sourceName = "ai-footprint-tracker-0.1.0-sources.zip";
  const sourceData = Buffer.from("source-archive");
  await writeFile(join(artifacts, sourceName), sourceData);
  packages.sources = {
    archive: `artifacts/browser/${sourceName}`,
    bytes: sourceData.byteLength,
    sha256: sha256(sourceData),
  };
  const aliases = Object.fromEntries(
    await Promise.all(
      (["chrome", "edge", "firefox"] as const).map(async (browser) => {
        const variant = `${browser}-${defaultEngine}`;
        const selected = packages[variant];
        const aliasName = `ai-footprint-tracker-${browser}.zip`;
        const data = await readFile(join(root, selected.archive));
        await writeFile(join(publicOutput, aliasName), data);
        return [
          browser,
          {
            path: `/downloads/${aliasName}`,
            variant_id: variant,
            bytes: selected.bytes,
            sha256: selected.sha256,
          },
        ];
      }),
    ),
  );
  const manifest = {
    aliases,
    build_status: "release_candidate",
    default_selection: {
      engine: defaultEngine,
      source: "config/estimation.build.json",
      source_sha256: sha256(await readFile(configurationPath)),
      effective_configuration_sha256: engineConfigurationHashes[defaultEngine],
      source_input_sha256: inputFingerprint.sha256,
    },
    input_fingerprint: inputFingerprint,
    packages,
    product: "ai-footprint-tracker",
    schema_version: "2.0.0",
    signing_status: "unsigned_manual_install",
    source_date_epoch: 1788998400,
    version: "0.1.0",
  };
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(join(artifacts, "manifest.json"), text);
  await writeFile(join(publicOutput, "manifest.json"), text);
  await writeFile(
    join(artifacts, "source-verification.json"),
    `${JSON.stringify(
      {
        comparison:
          "uncompressed distribution paths, byte lengths and SHA-256 hashes",
        input_fingerprint: manifest.input_fingerprint,
        matches: true,
        schema_version: "2.0.0",
        source_archive_sha256: packages.sources.sha256,
        targets: Object.fromEntries(
          (["chrome", "edge", "firefox"] as const).flatMap((browser) =>
            (["ecologits"] as const).map((engine) => [
              `${browser}-${engine}`,
              {
                archive_sha256: packages[`${browser}-${engine}`].sha256,
                changed: [],
                expected_entries: 2,
                extra: [],
                matches: true,
                missing: [],
                rebuilt_entries: 2,
              },
            ]),
          ),
        ),
        version: "0.1.0",
      },
      null,
      2,
    )}\n`,
  );
  return { root, artifacts, publicOutput, manifest };
}

test("download preparation accepts only the current strict custom manifest", async () => {
  const value = await fixture();
  assert.deepEqual(
    await validateDownloadManifest({
      repository: value.root,
      artifactOutput: value.artifacts,
      publicOutput: value.publicOutput,
      contract,
    }),
    {
      chrome: "/downloads/ai-footprint-tracker-chrome.zip",
      edge: "/downloads/ai-footprint-tracker-edge.zip",
      firefox: "/downloads/ai-footprint-tracker-firefox.zip",
    },
  );
  await writeFile(join(value.root, "apps/extension/source.ts"), "changed");
  await assert.rejects(
    validateDownloadManifest({
      repository: value.root,
      artifactOutput: value.artifacts,
      publicOutput: value.publicOutput,
      contract,
    }),
    /current source inputs/,
  );
});

test("compatibility aliases are pinned to the checked-in default variant", async () => {
  const value = await fixture();
  value.manifest.aliases.chrome.variant_id = "chrome-original";
  let text = `${JSON.stringify(value.manifest, null, 2)}\n`;
  await writeFile(join(value.artifacts, "manifest.json"), text);
  await writeFile(join(value.publicOutput, "manifest.json"), text);
  await assert.rejects(
    validateDownloadManifest({
      repository: value.root,
      artifactOutput: value.artifacts,
      publicOutput: value.publicOutput,
      contract,
    }),
    /chrome compatibility alias/,
  );

  const changedDefault = await fixture();
  changedDefault.manifest.default_selection.engine = "original";
  text = `${JSON.stringify(changedDefault.manifest, null, 2)}\n`;
  await writeFile(join(changedDefault.artifacts, "manifest.json"), text);
  await writeFile(join(changedDefault.publicOutput, "manifest.json"), text);
  await assert.rejects(
    validateDownloadManifest({
      repository: changedDefault.root,
      artifactOutput: changedDefault.artifacts,
      publicOutput: changedDefault.publicOutput,
      contract,
    }),
    /default browser download selection/,
  );
});

test("the same three public links can select the checked-in EcoLogits default", async () => {
  const value = await fixture("ecologits");
  assert.deepEqual(
    await validateDownloadManifest({
      repository: value.root,
      artifactOutput: value.artifacts,
      publicOutput: value.publicOutput,
      contract,
    }),
    {
      chrome: "/downloads/ai-footprint-tracker-chrome.zip",
      edge: "/downloads/ai-footprint-tracker-edge.zip",
      firefox: "/downloads/ai-footprint-tracker-firefox.zip",
    },
  );
  assert.deepEqual(
    Object.values(value.manifest.aliases).map((alias: any) => alias.variant_id),
    ["chrome-ecologits", "edge-ecologits", "firefox-ecologits"],
  );
});

test("the single public browser ZIP must match its canonical archive", async () => {
  const value = await fixture();
  await writeFile(
    join(value.publicOutput, "ai-footprint-tracker-edge.zip"),
    "wrong variant",
  );
  await assert.rejects(
    validateDownloadManifest({
      repository: value.root,
      artifactOutput: value.artifacts,
      publicOutput: value.publicOutput,
      contract,
    }),
    /edge-ecologits canonical download does not match/,
  );
});

test("malicious package paths and divergent public manifests fail closed", async () => {
  const value = await fixture();
  value.manifest.product = "another-product";
  let text = `${JSON.stringify(value.manifest, null, 2)}\n`;
  await writeFile(join(value.artifacts, "manifest.json"), text);
  await writeFile(join(value.publicOutput, "manifest.json"), text);
  await assert.rejects(
    validateDownloadManifest({
      repository: value.root,
      artifactOutput: value.artifacts,
      publicOutput: value.publicOutput,
      contract,
    }),
    /unsupported shape/,
  );
  value.manifest.product = "ai-footprint-tracker";
  value.manifest.packages["chrome-ecologits"].archive = "../outside.zip";
  text = `${JSON.stringify(value.manifest, null, 2)}\n`;
  await writeFile(join(value.artifacts, "manifest.json"), text);
  await writeFile(join(value.publicOutput, "manifest.json"), text);
  await assert.rejects(
    validateDownloadManifest({
      repository: value.root,
      artifactOutput: value.artifacts,
      publicOutput: value.publicOutput,
      contract,
    }),
    /package metadata is invalid/,
  );
  await writeFile(join(value.publicOutput, "manifest.json"), "{}\n");
  await assert.rejects(
    validateDownloadManifest({
      repository: value.root,
      artifactOutput: value.artifacts,
      publicOutput: value.publicOutput,
      contract,
    }),
    /manifests differ/,
  );
});

test("production downloads require a current successful three-variant rebuild proof", async () => {
  const value = await fixture();
  const reportPath = join(value.artifacts, "source-verification.json");
  await unlink(reportPath);
  await assert.rejects(
    validateDownloadManifest({
      repository: value.root,
      artifactOutput: value.artifacts,
      publicOutput: value.publicOutput,
      contract,
    }),
    /verification report is missing/,
  );

  const fresh = await fixture();
  const freshReportPath = join(fresh.artifacts, "source-verification.json");
  const report = JSON.parse(await readFile(freshReportPath, "utf8"));
  report.targets["edge-ecologits"].archive_sha256 = "0".repeat(64);
  await writeFile(freshReportPath, JSON.stringify(report));
  await assert.rejects(
    validateDownloadManifest({
      repository: fresh.root,
      artifactOutput: fresh.artifacts,
      publicOutput: fresh.publicOutput,
      contract,
    }),
    /edge-ecologits source reconstruction proof/,
  );

  report.targets["edge-ecologits"].archive_sha256 =
    fresh.manifest.packages["edge-ecologits"].sha256;
  report.targets["firefox-ecologits"].matches = false;
  await writeFile(freshReportPath, JSON.stringify(report));
  await assert.rejects(
    validateDownloadManifest({
      repository: fresh.root,
      artifactOutput: fresh.artifacts,
      publicOutput: fresh.publicOutput,
      contract,
    }),
    /firefox-ecologits source reconstruction proof/,
  );
});

test("test mode emits unavailable downloads while production mode rejects stale artifacts", async () => {
  const value = await fixture();
  const generated = join(value.root, "generated/downloads.ts");
  assert.deepEqual(
    await prepareDownloads({
      repository: value.root,
      artifactOutput: value.artifacts,
      publicOutput: value.publicOutput,
      generated,
      contract,
      forceUnavailable: true,
      quiet: true,
    }),
    {},
  );
  await writeFile(join(value.root, "apps/extension/added.ts"), "new input");
  await assert.rejects(
    prepareDownloads({
      repository: value.root,
      artifactOutput: value.artifacts,
      publicOutput: value.publicOutput,
      generated,
      contract,
      quiet: true,
    }),
    /current source inputs/,
  );
  assert.deepEqual(
    await prepareDownloads({
      repository: value.root,
      artifactOutput: value.artifacts,
      publicOutput: value.publicOutput,
      generated,
      contract,
      allowUnavailable: true,
      quiet: true,
    }),
    {},
  );
  assert.match(await readFile(generated, "utf8"), /builtDownloads = \{\}/);
});

test("symlinked release files are rejected", async (context) => {
  const value = await fixture();
  const artifact = join(
    value.artifacts,
    "chrome/ecologits/ai-footprint-tracker-0.1.0-chrome-ecologits.zip",
  );
  const target = `${artifact}.target`;
  await rename(artifact, target);
  try {
    await symlink(target, artifact, "file");
  } catch (error) {
    context.skip(`symlinks unavailable: ${String(error)}`);
    return;
  }
  await assert.rejects(
    validateDownloadManifest({
      repository: value.root,
      artifactOutput: value.artifacts,
      publicOutput: value.publicOutput,
      contract,
    }),
    /missing or unsafe/,
  );
});

const webNames = [
  "ai-footprint-tracker-chrome.zip",
  "ai-footprint-tracker-edge.zip",
  "ai-footprint-tracker-firefox.zip",
];

// The same layout the Vite plugin writes: the bundled site plus the validated downloads.
async function builtSite(value: Awaited<ReturnType<typeof fixture>>) {
  const dist = join(value.root, "apps/web/dist");
  await mkdir(join(dist, "downloads"), { recursive: true });
  await writeFile(join(dist, "index.html"), "<!doctype html>");
  for (const name of [...webNames, "manifest.json"])
    await copyFile(join(value.publicOutput, name), join(dist, "downloads", name));
  return dist;
}

test("the web image accepts a built site only while its downloads match the release manifest", async () => {
  const value = await fixture();
  const dist = await builtSite(value);
  assert.deepEqual(await checkBuiltDownloads(dist), {
    chrome: "/downloads/ai-footprint-tracker-chrome.zip",
    edge: "/downloads/ai-footprint-tracker-edge.zip",
    firefox: "/downloads/ai-footprint-tracker-firefox.zip",
  });

  const zip = join(dist, "downloads/ai-footprint-tracker-firefox.zip");
  await writeFile(zip, "replaced after the build");
  await assert.rejects(
    checkBuiltDownloads(dist),
    /Built firefox download does not match the release manifest/,
  );
  await copyFile(join(value.publicOutput, "ai-footprint-tracker-firefox.zip"), zip);

  await writeFile(join(dist, "downloads/ai-footprint-tracker-safari.zip"), "x");
  await assert.rejects(
    checkBuiltDownloads(dist),
    /offers files outside the release manifest: ai-footprint-tracker-safari.zip/,
  );
  await unlink(join(dist, "downloads/ai-footprint-tracker-safari.zip"));

  const manifest = JSON.parse(
    await readFile(join(dist, "downloads/manifest.json"), "utf8"),
  );
  manifest.packages["edge-ecologits"].sha256 = "0".repeat(64);
  await writeFile(join(dist, "downloads/manifest.json"), JSON.stringify(manifest));
  await assert.rejects(
    checkBuiltDownloads(dist),
    /built edge download is not bound to a release package/,
  );

  await unlink(join(dist, "downloads/manifest.json"));
  await assert.rejects(
    checkBuiltDownloads(dist),
    /no verified browser release manifest/,
  );
  await unlink(join(dist, "index.html"));
  await assert.rejects(checkBuiltDownloads(dist), /built website is missing/);
});

test("the web image check runs from a lone copy with only Node built-ins", async () => {
  // The image copies just this script next to the site, without the repository or node_modules.
  const value = await fixture();
  const dist = await builtSite(value);
  const alone = await mkdtemp(join(tmpdir(), "aift-image-check-"));
  const script = join(alone, "check-built-downloads.mjs");
  await copyFile(
    new URL("../scripts/check-built-downloads.mjs", import.meta.url),
    script,
  );
  const passed = spawnSync(process.execPath, [script, dist], {
    cwd: alone,
    encoding: "utf8",
  });
  assert.equal(passed.status, 0, passed.stderr);
  await unlink(join(dist, "downloads/ai-footprint-tracker-chrome.zip"));
  const failed = spawnSync(process.execPath, [script, dist], {
    cwd: alone,
    encoding: "utf8",
  });
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /Built chrome download is missing or unsafe/);
});
