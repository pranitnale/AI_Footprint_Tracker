import { readFileSync } from "node:fs";

/**
 * The source ZIP that `wxt zip -b firefox` adds for Mozilla's review. It holds the same inputs as
 * the release source archive (`tools/browser-artifact-inputs.json`, read by
 * `tools/package-browser-artifacts.py` and `tools/verify-source-archive.py`), so a reviewer can
 * follow BROWSER-SOURCE-README.md and rebuild the Firefox package: the root files the build reads
 * (third-party inventory and notices, SBOM, lockfile, Node version) and the extension, packages,
 * config and tools folders. Reading the contract keeps the two lists from drifting apart.
 *
 * Everything the repository ignores stays out (dependencies, build output, caches, local
 * environment files, local test results), as do files outside those folders, such as the owner's
 * local decisions, research transcripts and release artifacts.
 *
 * Dotfiles and test files stay in, unlike WXT's defaults: each build embeds the EcoLogits
 * corresponding source (`build/notices.ts`), which holds every file of packages/ecologits-core and
 * tools/ecologits, so a rebuild without them would differ from the submitted package.
 */
type InputContract = {
  fixed_files: string[];
  source_roots: string[];
  excluded_parts: string[];
  excluded_suffixes: string[];
};

/** Paths `.gitignore` files ignore inside the source roots that the contract does not name. */
const IGNORED = [
  "**/.ecologits-maintenance/**",
  "**/.firecrawl/**",
  "**/.local-calibration-deps/**",
  "**/test-results/**",
  "**/*.egg-info/**",
  "**/*.tsbuildinfo",
  // Local environment files, as the release tools skip every name that starts with .env.
  "**/.env*",
  "packages/ecologits-core/test/results.local.json",
];

export function loadSourceContract(
  path = new URL("../../../tools/browser-artifact-inputs.json", import.meta.url),
): InputContract {
  return JSON.parse(readFileSync(path, "utf8")) as InputContract;
}

export function reviewSourcePackage(contract: InputContract = loadSourceContract()) {
  return {
    includeSources: [
      ...contract.fixed_files,
      ...contract.source_roots.map((root) => `${root}/**`),
    ],
    excludeSources: [
      ...contract.excluded_parts.map((part) => `**/${part}/**`),
      ...contract.excluded_suffixes.map((suffix) => `**/*${suffix}`),
      ...IGNORED,
    ],
    dotSources: true,
  };
}

/** WXT's own source exclusions of test files (wxt 0.21 `resolveZipConfig`). */
export const WXT_TEST_EXCLUSIONS = [
  "**/__tests__/**",
  "**/*.+(test|spec).?(c|m)+(j|t)s?(x)",
];

/**
 * WXT always adds its test exclusions to the configured ones, so the `config:resolved` hook in
 * wxt.config.ts takes them out again (see the module comment).
 */
export function keepTestSources(excludeSources: string[]): string[] {
  return excludeSources.filter((pattern) => !WXT_TEST_EXCLUSIONS.includes(pattern));
}
