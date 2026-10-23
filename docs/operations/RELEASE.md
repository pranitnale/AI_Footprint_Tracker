# Release operations

All standard and release builds use the same three unpacked folders: `apps/extension/.output/chrome-mv3`, `apps/extension/.output/edge-mv3` and `apps/extension/.output/firefox-mv2`. EcoLogits is the only product engine. Do not create `-original` or `-ecologits` folder copies. Public downloads contain one ZIP per browser; engine identity stays in the build metadata.

## Reproducible checks

Use Node 22.23.2, pnpm 11.19.0, uv 0.11.28 and Python 3.13.15. The pinned versions were checked against official Node, npm/PyPI and project metadata on 10 September 2026. From a clean checkout:

```sh
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
uv sync --project apps/server --frozen --group dev --python 3.13.15
pnpm check
```

`pnpm check` runs every workspace TypeScript check and `.test.ts`/`.test.tsx` suite from its package directory, independent verification tests, documentation checks, Ruff, the full Python suite, JavaScript and Python production dependency audits, all three browser/default builds, deterministic archives, a clean extracted-source rebuild of all three variants, and the website production build. It does not mask audit or test failures.

PostgreSQL transaction races, the one-million and ten-million record benchmarks, real Brevo no-tracking mail, production TLS/routing, browser-store signing, a production backup restore and cross-browser installation remain external gates until their dedicated evidence is recorded. Use the server benchmark and restore tools only with their explicit isolated/offline confirmations.

The local reference-test checkpoint used the existing Python 3.13.12 environment with frozen dependencies. The explicit 3.13.15 setup above must be recorded as a separate execution checkpoint; it does not change that earlier evidence.

### Provider drift check

Provider pages change their protocol names without notice. Before a release, save each supported site's current JavaScript files from the browser's developer tools into a folder outside the repository and compare them with the names the live and history readers know:

```sh
pnpm drift:check --site claude <saved files or folders>
```

The sites are `claude`, `chatgpt`, `perplexity`, `gemini` and `notebooklm`. The report lists known names the saved code no longer contains and unknown names that sit next to known ones. Both need review, because page code holds many names and a new one is often harmless. Add `--strict` to exit with 1 when anything needs review and `--json` for the report as JSON. The check reads only the files it is given and sends nothing anywhere. It is not part of `pnpm check` because it needs freshly saved page code, and it does not replace a native check on each site. Keep the saved page code out of the repository.

## Browser artifacts

`pnpm package:browsers` regenerates the dependency inventory, the CycloneDX SBOM and `THIRD-PARTY-NOTICES.md` (all rendered from one inventory by `tools/third_party.py`) first, then builds Chrome, Edge and Firefox with EcoLogits as the only packaged default. It creates fixed-order/fixed-timestamp archives, validates manifest identity, reviewed permissions, the provider-scoped relay exposure and license payload, and copies the exact archives into the website download directory. Generating the inventory first matters because the inventory is included in each build's corresponding-source payload, and both generated files are part of the final source-input fingerprint. All three packages use EcoLogits and disable engine overrides. Original calculation source remains for historical compatibility and research. The checked-in `config/estimation.build.json` default selects one compatibility alias per browser for the public website; this does not add a second public build picker. The manifest binds each alias to its canonical variant, byte hash, configuration-source hash, effective-configuration hash and complete source-input fingerprint.

`artifacts/browser/manifest.json` and the byte-identical website manifest record byte lengths, SHA-256 hashes and a deterministic fingerprint of the complete browser source input set. Included paths are ordered by their UTF-8 bytes in both JavaScript and Python so non-ASCII names cannot change the fingerprint between runtimes. Added, removed or changed included files invalidate that fingerprint. Symlinks in included source or built output are rejected. The packages are unsigned manual-install artifacts and must never be described as store listings. Before a Firefox listing, recheck the data collection declaration against [the Firefox data collection review](../release/FIREFOX-DATA-COLLECTION.md). For Mozilla's source review, `corepack pnpm --filter @footprint/extension zip:firefox` also writes a source ZIP with the same inputs as the release source archive (`apps/extension/build/source-package.ts` reads `tools/browser-artifact-inputs.json`), including `BROWSER-SOURCE-README.md` with the rebuild steps. Dotfiles and test files stay in, because each build embeds the EcoLogits source with them. `apps/extension/test/source-package.test.ts` lists the paths the rebuild needs and the private or ignored paths that must stay out.

The production website build accepts only that strict custom manifest, the three default-selected compatibility aliases and all three canonical artifacts whose byte hashes and source fingerprint match the current checkout. It also requires a successful `source-verification.json` bound to the current source archive and all three browser/default archive hashes. It has no fallback to WXT-generated ZIPs. Vite's general public-directory copying is disabled; the production build copies only the three verified aliases and manifest after revalidating them. Development and unit-test scripts explicitly render all browser packages as unavailable and do not serve or copy older archives. Run packaging and source verification after the source freeze and before the production website build.

Every native browser build runs the same notice hook, including a clean extracted-source rebuild. Binary packages contain the original MIT license, full upstream license/notice text, preserved asset notices and a path/hash inventory under `licenses/`. The packager rejects missing or altered notice payloads. Optional Node canvas binaries are excluded from the browser notice graph because the text-only PDF worker does not bundle them; preserved PDF resource notices do not imply that fonts or image decoders were shipped.

Run packaging twice from unchanged source and compare SHA-256 values. Then run:

```sh
pnpm verify:source-archive
```

This checks archive hashes, compatibility aliases and the source-input fingerprint against the trusted inclusion contract in the current checkout, extracts the matching source archive into a temporary directory, performs one frozen install and sequentially builds all three browser/default variants from that extracted source. Every reconstructed distribution path, byte length and SHA-256 hash must match its canonical variant ZIP. The command removes any prior verification report before its first check and writes a new success report only after all three targets match. Missing, extra or changed files in any target fail the gate; the previous proof cannot survive a failed run. Differences are not normalized away: investigate stale outputs and path, timestamp, platform or tool-version nondeterminism. Preserve the successful report, manifest, source archive, SBOM and third-party inventory with the release record.

## Dependency and license review

`pnpm audit:js` checks the production pnpm graph. `pnpm audit:python` exports the frozen production uv graph with hashes and audits it using pinned `pip-audit` 2.10.1. Both require current advisory-service access and fail on detected vulnerabilities or collection errors.

Use `pnpm run audit` to run the combined checks. `pnpm audit` is pnpm's built-in JavaScript command and does not invoke the custom Python audit. Shared Python is linted from `apps/server` with that repository configuration, alongside the server and deployment initializer tests.

The combined audit also runs `pnpm audit:browser-runtime`. It derives the same reviewed shipped component set used by browser notices and queries OSV for every exact npm name/version. This includes WXT runtime helpers declared as development dependencies and embedded CoreJS. Findings, missing responses and truncated advisory responses fail the gate; the dated result is saved as `artifacts/browser-runtime-audit.json`. The SBOM merges that same runtime inventory, so package-manager dependency labels cannot hide shipped code. Build-only packages remain separate from this browser-runtime assessment.

## Container image evidence

On 10 September 2026, read-only queries to the official Docker Hub library API confirmed the following tags and multi-platform digests. The Nginx `stable-alpine3.24` tag matched 1.30.4. Compose and Dockerfiles pin both version and digest.

| Image                        | Registry record                                                                                             | Digest                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| PostgreSQL 17.11 Bookworm    | [Official tag](https://hub.docker.com/v2/namespaces/library/repositories/postgres/tags/17.11-bookworm)      | `sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0` |
| Python 3.13.15 slim Bookworm | [Official tag](https://hub.docker.com/v2/namespaces/library/repositories/python/tags/3.13.15-slim-bookworm) | `sha256:ed86c82274b3c69b52fb5820f358f0bd7df0b603332063cb5c6e32bd220c3e6e` |
| Node 22.23.4 slim Bookworm   | [Official tag](https://hub.docker.com/v2/namespaces/library/repositories/node/tags/22.23.4-bookworm-slim)   | `sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d` |
| Nginx 1.30.6 Alpine 3.24     | [Official tag](https://hub.docker.com/v2/namespaces/library/repositories/nginx/tags/1.30.6-alpine3.24)      | `sha256:47928bf67eb62a1863cb08d9ecb52d3e704304ba614eaee17884204677702951` |

On 22 October 2026 the proxy image moved to Node 22.23.4 (CVE-2026-111497, Brotli decoder out-of-bounds write) and Nginx 1.30.6 (the 14 October 2026 advisories, CVE-2026-15176, CVE-2026-93479, CVE-2026-95101, CVE-2026-97629, CVE-2026-97205). Both digests come from Docker Hub API queries on 22 and 23 October 2026. The Nginx tag was rebuilt on 22 October 2026, so the pin uses that rebuild. `.node-version` stays at 22.23.2 until the next browser release, because it is a hashed browser-artifact input.

Registry metadata proves tag/digest availability, not that the images build, run or have no vulnerabilities. Docker CLI is absent on the local Windows verification host. Actual Compose validation, clean image builds and OS-image vulnerability scans remain unverified locally. CI includes Compose validation and no-cache image builds without starting a database. npm/pip audits do not cover container OS packages. No alternate database runtime was started around the host's denied PostgreSQL launcher.

`THIRD-PARTY-INVENTORY.json` and `SBOM.cdx.json` are generated from `pnpm-lock.yaml` and `apps/server/uv.lock`. `THIRD-PARTY-NOTICES.md` describes the inventory and preserves required attribution. Review every `NOASSERTION` license before release; generation is not legal approval.

## Release evidence

Update `docs/release/acceptance-evidence.json` only with commands and artifacts actually verified by the conductor. Do not convert local SQLite, jsdom or synthetic-browser results into production evidence. Record dates, tool versions, artifact hashes and the environment for each external gate.

No command in this document deploys, publishes, pushes, submits to a browser store or changes a VPS.
