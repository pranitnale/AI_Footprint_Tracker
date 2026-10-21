// The source ZIP that `wxt zip -b firefox` makes for Mozilla's review (build/source-package.ts)
// must hold what the Firefox build needs, following BROWSER-SOURCE-README.md, and nothing the
// repository keeps private or ignores. The files are chosen with WXT's own glob library and
// options, so the test selects what the real zip would.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  WXT_TEST_EXCLUSIONS,
  keepTestSources,
  loadSourceContract,
  reviewSourcePackage,
} from "../build/source-package";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const resolver = createRequire(import.meta.url);
type Glob = {
  globSync(
    patterns: string[],
    options: { cwd: string; ignore: string[]; onlyFiles: boolean; dot: boolean },
  ): string[];
};
// tinyglobby is WXT's dependency, not the extension's, so it is loaded from WXT's location.
const { globSync } = createRequire(resolver.resolve("wxt"))("tinyglobby") as Glob;

/**
 * The files WXT puts in the source ZIP for this source root: its zipDir call with its own default
 * exclusions first (wxt 0.21 `resolveZipConfig`), less the test exclusions the config hook removes.
 */
function selected(directory: string) {
  const { includeSources, excludeSources, dotSources } = reviewSourcePackage();
  const ignore = keepTestSources([
    "**/node_modules",
    "**/web-ext.config.ts",
    ...WXT_TEST_EXCLUSIONS,
    ".output/**",
    ...excludeSources,
  ]);
  return new Set(globSync(includeSources, { cwd: directory, ignore, onlyFiles: true, dot: dotSources }));
}

/** What a reviewer needs to rebuild the Firefox package from the ZIP alone. */
const REQUIRED = [
  ".node-version",
  "BROWSER-SOURCE-README.md",
  "LICENSE",
  "SBOM.cdx.json",
  "THIRD-PARTY-INVENTORY.json",
  "THIRD-PARTY-NOTICES.md",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "apps/extension/package.json",
  "apps/extension/wxt.config.ts",
  "apps/extension/build/notices.ts",
  "apps/extension/build/source-package.ts",
  "apps/extension/build/variant.ts",
  "config/README.md",
  "config/estimation.build.json",
  "config/estimation.mappings.json",
  "config/estimation.media.json",
  "config/source-repository.json",
  "packages/ecologits-core/data/identity.json",
  "packages/ecologits-core/upstream/lock.json",
  // Each build embeds every file of these two folders as the EcoLogits source, dotfiles and
  // tests included, so the rebuild matches only with them.
  "packages/ecologits-core/.gitattributes",
  "packages/ecologits-core/.gitignore",
  "tools/ecologits/test/workflow.test.mjs",
  "tools/browser-artifact-inputs.json",
  "tools/build-methodology.cjs",
  "tools/refinement/build-variants.ts",
];

/** Private, ignored or unneeded paths that must never reach the ZIP. */
const FORBIDDEN = [
  "OWNER-DECISIONS.md",
  "TEST-ARTEFACTS.md",
  "handoff/session.md",
  "research/review-transcript.jsonl",
  "research/notes.md",
  "artifacts/browser/manifest.json",
  ".git/config",
  ".claude/settings.json",
  "node_modules/react/index.js",
  "apps/extension/node_modules/wxt/index.js",
  "packages/ui/node_modules/react/index.js",
  "apps/extension/.env",
  "apps/extension/.env.local",
  "config/.env.production",
  "apps/extension/.output/firefox-mv2/manifest.json",
  "apps/extension/.wxt/tsconfig.json",
  "apps/extension/test-results/report.json",
  "apps/extension/tsconfig.tsbuildinfo",
  "apps/extension/debug.log",
  "packages/ui/dist/index.js",
  "packages/ui/coverage/index.html",
  "packages/ecologits-core/oracle/.venv/lib/site.py",
  "packages/ecologits-core/test/results.local.json",
  "tools/__pycache__/third_party.cpython-313.pyc",
  "tools/ecologits/.ecologits-maintenance/state.json",
  "tools/local.sqlite3",
  "apps/extension/.wxt/local_modules/x.tgz",
  "packages/ui/.pytest_cache/v/cache",
  "tools/.ruff_cache/0.1/x",
  "apps/extension/.test-runtime/db.json",
  "apps/server/aift/service.py",
  "apps/web/src/main.tsx",
  "docs/release/RELEASE.md",
  "fixtures/capture.json",
];

test("the review source ZIP takes the release source archive's inputs, so the two cannot drift apart", () => {
  const contract = loadSourceContract();
  const { includeSources } = reviewSourcePackage(contract);
  for (const file of contract.fixed_files) assert.ok(includeSources.includes(file), file);
  for (const folder of ["apps/extension", "packages", "config", "tools"])
    assert.ok(includeSources.includes(`${folder}/**`), folder);
  // WXT's forced test exclusions are taken out again; its other defaults stay.
  assert.deepEqual(keepTestSources(["**/node_modules", ...WXT_TEST_EXCLUSIONS, "**/*.log"]), ["**/node_modules", "**/*.log"]);
  const config = readFileSync(new URL("../wxt.config.ts", import.meta.url), "utf8");
  assert.match(config, /"config:resolved": \(wxt\) => \{\s*wxt\.config\.zip\.excludeSources = keepTestSources\(/);
});

test("the review source ZIP holds what the Firefox build needs and nothing private or ignored", () => {
  const directory = mkdtempSync(join(tmpdir(), "aift-review-source-"));
  try {
    for (const path of [...REQUIRED, ...FORBIDDEN]) {
      mkdirSync(dirname(join(directory, path)), { recursive: true });
      writeFileSync(join(directory, path), "synthetic\n");
    }
    const files = selected(directory);
    for (const path of REQUIRED) assert.ok(files.has(path), `missing: ${path}`);
    for (const path of FORBIDDEN) assert.equal(files.has(path), false, `included: ${path}`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("from this repository the review source ZIP has every required release input and the build instructions", () => {
  const files = selected(root);
  const contract = JSON.parse(readFileSync(join(root, "tools/browser-artifact-inputs.json"), "utf8"));
  for (const path of [...REQUIRED, ...contract.required_source_entries])
    assert.ok(files.has(path), `missing: ${path}`);
  for (const path of files)
    assert.match(path, /^(?:apps\/extension|packages|config|tools)\/|^[^/]+$/, `outside the source roots: ${path}`);
  const readme = readFileSync(join(root, "BROWSER-SOURCE-README.md"), "utf8");
  assert.match(readme, /pnpm install --frozen-lockfile/);
  assert.match(readme, /tools\/refinement\/build-variants\.ts/);
  assert.match(readme, /--browser chrome\|edge\|firefox/);
});
