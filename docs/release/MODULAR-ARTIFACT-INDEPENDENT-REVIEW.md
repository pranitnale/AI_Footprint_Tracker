# Independent modular browser-artifact review

15 September 2026. **Final bounded verdict: CLEAN. Corrected six-package content/default/realm checks, source reproduction bindings and production website downloads PASS. MA01 is CLOSED.** This verifies the unsigned local artifact set identified below, not native installation or publication. The parent executed all builds and artifact generation. The reviewer started no duplicate build and changed no product, packaging or fixture source.

The first final `pnpm check` stopped in extension tests before packaging. The parent fixed those failures and recorded later stages separately, including full Python/server checks. The corrected final artifacts and matching rebuild came from these separate executed stages, not one successful `pnpm check`. The first packaged set was rejected for MA01 and remains historical evidence only.

## Verification scope

The review follows RL05, RL06, RL08, RL19, RL20 and RL22 in the modular acceptance matrix and the source-input contract in `tools/browser-artifact-inputs.json`. It distinguishes local file/content inspection, the parent's executed clean source rebuild, installed-browser behavior and external release conditions.

| Area | Required local evidence |
| --- | --- |
| Six canonical variants | Chrome/Edge/Firefox with Original and EcoLogits defaults; exact manifest versions, engine/configuration identities, both engines and user override; ZIP names, lengths and SHA256 values agree with final metadata. |
| Default downloads | Each browser alias matches the variant selected by the checked-in configuration. Artifact/public manifests are identical; production web output contains only the three verified aliases and manifest. |
| Privacy of packaged routes | Reviewed permissions and provider-scoped resource exposure; licenses/source/offscreen/worker/dashboard routes are not declared web-accessible. Private license-page relative links resolve to actual archive entries. |
| Notices and component inventory | Full applicable license/notice/citation payloads, path/hash inventory, distinct MPL port classification and preserved product terms. Browser runtime component identities agree with the generated inventory and SBOM. |
| Corresponding modified source | Every included modified core file, catalog, identity, retained upstream source, notices and maintenance source agrees with the current accepted files. The private source ZIP is complete for its declared component scope and excludes raw/private/generated material. |
| Full browser source archive | Exact complete inclusion set and canonical source fingerprint, required build files, locked configuration/dependencies, no missing/extra/changed selected source. The archive is a documented rebuild-only subset, not a complete development checkout. |
| Source reproduction | A fresh successful report binds all six archive hashes and the current full source archive/fingerprint; all reconstructed distribution paths, lengths and hashes match, with empty difference lists. The review identifies which task executed the rebuild. |

The reviewer has inspected the packager, source verifier, notice generator, variant metadata, input inclusion/fingerprint logic and strict website download validation. The independent checker is prepared under `%TEMP%/aift-artifact-independent-20260915/verify_artifacts.py`; it reads generated files and writes evidence only outside the repository. The first package-content pass is recorded below and does not certify final candidates.

## First candidate pass and blocking finding

The first six-candidate package set was written at 10:31:47 UTC on 15 September. Its declared source fingerprint is `ea3abd8a7d42238d8426e5a714a19ada2c34eeec95731c30392c0ec115daa0b7` over 512 selected files. Independent `--packages-only` inspection passed archive and built-directory equality, manifest and default aliases, declared source inclusion and byte equality, permissions/private routes, local license links, full notices and runtime component inventory for all six variants. The nested corresponding-source ZIP contains 105 entries and hashes to `569655f1be769ef823ef24d53b40f165c5bf6735f54fed20083cd32ece15a5c0`. Source reproduction and production website output were deliberately pending in this pass.

### MA01 [P2]: Counting implementation and dictionaries enter page bundles

**CLOSED by the corrected-candidate pass below.** The parent identified an unexpected tokenizer payload while inspecting the actual first candidates. Independent inspection confirmed it in every Chrome, Edge and Firefox variant, with either default engine:

| Packaged file | Bytes | SHA-256 |
| --- | --- | --- |
| `content-scripts/capture.js` | 3,964,784 | `6c503cdb55c1cb7dc45e0c863439649a37e6174eaf009364ccab82ac74480379` |
| `content-scripts/content.js` | 3,997,659 | `36c47f2eba1ef1be316eed45b7be2c343efef7928e207e7b4405e6edab2e3ede` |

Both page files are byte-identical across all six variants. Each contains the encoder class implementation, 27 `specialTokensEncoder` references, and concrete module-level calls to `getEncodingApi("o200k_base", ...)` and `getEncodingApi("cl100k_base", ...)` alongside their encoded dictionaries. Background bundles also contain this implementation and are 4,666,326 to 4,668,553 bytes depending on target/default. This is more than harmless manifest profile names in the output.

The source dependency path includes `counting-config.ts` importing `BUNDLED_TOKENIZER`, `runtime.ts` importing `./bundled`, and the tokenizer package barrel exporting protocol, runtime and counting implementations together. Although `bundled.ts` uses dynamic imports in source, the emitted page bundle contains the encoder initialization and data. Lightweight runtime selection and manifest metadata must be separated from executable tokenizer implementations so page and control realms do not load these worker dependencies.

The counting owner is fixing the dependency boundary and adding an import/artifact regression. Closure requires independently checking fresh source and regenerated candidate bundles, with dictionaries and initialization confined to the intended worker execution path. Earlier intermediate September 14 bundles contained a similar payload; that comparison is not an acceptance baseline. No browser CPU, heap or latency delta is claimed from byte inspection alone.

Evidence is retained outside the repository under `%TEMP%/aift-artifact-independent-20260915/`: `rejected-package-content-results.json`, `rejected-tokenizer-artifact-evidence.json` and `tokenizer-initializer-contexts.json`. These bind the rejected archive hashes, source fingerprint, exact byte counts and short initializer contexts without dumping minified files. The eventual final report must use regenerated hashes and rerun every affected artifact/source check.

### MA01 diagnostic correction check

**Source/build guard and diagnostic artifact: PASS.** Final six-candidate closure was still pending at this diagnostic stage. Independently inspected the distinct diagnostic output at `apps/extension/.test-runtime/tokenizer-diagnostic-output/chrome-mv3`; the reviewer did not rebuild it or alter the rejected candidates.

Host composition now imports `@footprint/tokenizers/metadata`, whose graph contains protocol, immutable manifest and runtime selection/validation. Executable workers use `@footprint/tokenizers/worker` through the separate `counting-worker-config.ts`. The runtime module imports the manifest instead of the executable bundled implementation. The metadata and worker configurations retain identical selection/asset identity.

The WXT Vite `generateBundle` hook calls `assertMainThreadTokenizerBoundary` for main output. The guard examines each rendered chunk's module map, including shared chunks, and rejects rendered `gpt-tokenizer` code/data or the executable tokenizer modules after normalizing Windows paths and query suffixes. It allows fully eliminated modules and separately emitted worker assets. Independently reran the three build-boundary tests: 3 passed, zero skipped or failed.

The independent emitted-module traversal starts from manifest background/content scripts and every packaged HTML script, follows static/dynamic relative imports, and found **12 host modules with zero tokenizer API/encoder markers**. All four emitted count/file worker entries retain a reachable encoder implementation. The diagnostic background contains the actual compiled `original` default, consistent with its configuration.

| Diagnostic file | Bytes | SHA-256 |
| --- | --- | --- |
| `content-scripts/capture.js` | 226,906 | `ec8b9cde97430664138621701dfd4931d605c82cc5c62ead7348b3267f96d616` |
| `content-scripts/content.js` | 259,781 | `46cdd9235aa12211bedccb5ee6b1395f51aec388960d00fe92e9fdd53bc7e078` |
| `background.js` | 928,774 | `341ac66fc9147ea681d15ecfc294e86eb3039d5697af3e7c3756b9d784b873c5` |

Each page script is 3,737,878 bytes smaller than the rejected candidate. This is a file-size measurement only. The independent counting-behavior review is a separate gate; this diagnostic pass does not establish native browser execution or final package freshness.

Evidence: `diagnostic-realm-results.json`, `diagnostic-source-hashes.json` and `tokenizer-build-boundary-tests.txt` in the external evidence directory. At that stage, fresh Chrome, Edge and Firefox candidates under both defaults still required realm traversal, complete package/source checks, source reproduction and website alias validation. Those later checks are recorded below.

### Corrected six-candidate pass

**Package content/default/realm checks: PASS. MA01: CLOSED.** The corrected package command exited zero and wrote its manifest at 11:06:37 UTC. Independently reran the complete package-content check and emitted host/worker dependency traversal against all six actual ZIPs. Their source fingerprint is `f29da53bf84dd974afc0fce2ed3903d462d995ccee3d8510136571987f07f045` over 519 selected source files; it differs from the rejected candidate fingerprint.

Each corrected variant has 89 entries, 45 inventoried notice files and 15 runtime components. All manifests, ZIP hashes, exact built-directory/source bytes, declared permissions, private license/source links, selected-default aliases and full applicable notice payloads passed again. Every background contains the correct compiled Original or EcoLogits default literal. Every host graph has 12 reachable modules with zero encoder implementation markers; all four emitted count/file workers still reach the encoders.

An additional independent comparison proves the 16-file JavaScript import graph reachable from count/file workers is byte-identical across all six corrected variants and equals the separately reviewed diagnostic graph. A broader comparison also verifies all 18 JavaScript assets, including the separately spawned PDF workers, are identical across those six variants and the diagnostic build. Thus these package bytes retain the graph exercised by the counting reviewer, without claiming six native browser installations. The page script bytes and hashes match the diagnostic values above. Background sizes range from 928,772 to 931,005 bytes across target/default combinations.

The corrected browser source ZIP contains 519 source entries, is 1,784,451 bytes and hashes to `787df8d014444e7405c229ac64f10855a2625b51c6f5f340c4a5973ca75a26b4`. All six nested EcoLogits corresponding-source ZIPs have the same 105 entries, 1,537,671 bytes and SHA-256 `c2a5938bb219b6a5d4964c8cfc0e81ef9180029890c6f2b041d9165c3cf2ada3`.

Current evidence: `package-content-results.json`, `realm-bundle-results.json`, `final-bundle-byte-results.json` and `final-worker-assets-results.json` in the external evidence directory. Source reproduction and production website verification were pending at this intermediate pass and are now verified below.

## Final artifact identity and verification

The reviewer independently executed the full artifact checker after the parent completed source reproduction and the production website build. It passed with the current 519-file source fingerprint `f29da53bf84dd974afc0fce2ed3903d462d995ccee3d8510136571987f07f045`. All included source paths and bytes match the checkout's declared browser inputs. This includes the new extension README, build guard and tokenizer entrypoints. The full repository root README is outside the documented rebuild subset; the packaged browser/source READMEs and notices describe their own scopes.

| Variant | ZIP bytes | SHA-256 |
| --- | --- | --- |
| Chrome Original | 5,274,962 | `f3579b97e0a3a827c593d5b7ae4e0a11a69ffd87a0bea39c9f2fbdf501095859` |
| Chrome EcoLogits | 5,274,964 | `751a04ad88d519ec3c33135959ed5414c2d88cdac39bafdd3d2e5c232441326f` |
| Edge Original | 5,274,958 | `cddb79c8468d2f466fef72d947c79aea9582359533abe5e6ab2e61a666c2e6c5` |
| Edge EcoLogits | 5,274,961 | `15c5b3d822fb9f37613227c7e83693d8a5cfbdc9355a3551a8b4f1189ffa5fb2` |
| Firefox Original | 5,274,962 | `a512bfd719007600477471b58d1e3d4718dba7d5fa0767deb45a1a208c9c746c` |
| Firefox EcoLogits | 5,274,965 | `72737b3ea86d3edb03ef7af01beccfdd9a3f065e305cd9b7ca8c5710fbd16669` |
| Browser source | 1,784,451 | `787df8d014444e7405c229ac64f10855a2625b51c6f5f340c4a5973ca75a26b4` |

The parent ran the clean-source reproduction. The reviewer inspected its execution log and independently checked `artifacts/browser/source-verification.json`, SHA-256 `c9448a5cb7a63238ee579b4886b8e441cc53d0c31de5873c1239b093640489f9`. It binds the current source archive/fingerprint and every ZIP above. All six targets have 89 expected and 89 rebuilt entries, with empty missing/extra/changed lists. The verifier compares every uncompressed distribution path and byte hash without normalized exceptions.

The reviewer independently called the read-only `validateDownloadManifest` and checked actual `apps/web/dist/downloads`. Both pass. The production download directory contains exactly `manifest.json` and the Chrome, Edge and Firefox aliases. Each alias equals the corresponding Original-default ZIP selected by the checked-in configuration; the manifest equals the verified public/artifact manifest. Canonical variants remain in the artifact/public staging set, while the production website contains only its three selected downloads and manifest.

| Check | Executor and result |
| --- | --- |
| Six complete package/source-content checks | Reviewer: PASS, then repeated as part of the final combined artifact check after source/web completion. |
| Host/worker module reachability and compiled defaults | Reviewer: PASS for all six. Zero host encoder violations, four retained count/file workers per variant, correct compiled defaults. |
| Worker bytes across targets and diagnostic build | Reviewer: PASS for the 16-file import graph and all 18 JavaScript assets. |
| Build-boundary regression | Reviewer: 3 tests passed. |
| Fresh source reproduction | Parent executed; reviewer independently verified all six report/archive/source bindings: PASS. |
| Production website build and downloads | Parent built; reviewer independently validated the manifest and exact final download files: PASS. |
| Archive privacy scan | Parent: exit zero, 1,857 items and 183,284,187 bytes, no high-confidence pattern findings or scanner errors; 49 binary semantic checks explicitly outside scope. |

The parent recorded successful current workspace tests and typechecks separately: all workspace JavaScript suites passed, including 818 extension tests and one documented skip; all 16 module verification tests passed. The full server/journal suite passed 755 tests with one PostgreSQL-only skip after the native correction. These overlapping stages are not added into a synthetic total. The extension skip concerns file-symlink creation being denied on Windows; the successful source rebuild exercises real installed pnpm links but is not represented as execution of that skipped fixture.

Local inspection/helper execution used Node 24.12.0, pnpm 11.19.0 and Python 3.13.12. These observed developer runtimes are distinct from the README's recommended Node version and from shipped browser execution. The reviewer did not install, sign, publish, deploy, commit or push any artifact.

## Parent-executed browser-worker evidence

The parent executed the actual packaged file worker from a dedicated loopback harness in the Codex in-app browser. `artifacts/browser/file-worker-browser-check-2026-09-15.json` records **14 of 14 checks passed**, including text, Office containers, PDF and explicit encrypted/scanned-PDF unavailable outcomes. This reviewer did not repeat the browser session; it independently validated the report's exact current archive, source fingerprint, worker and harness bindings, all case results and stated raw-marker/telemetry assertions.

The browser report SHA-256 is `573b16c28c3c8fe372b21908102335f60debc428bbdc7f5540c91829dc09a47a`. The file-worker SHA-256 is `f49fcd32e95309e3417f310dde9155ebf800dff8a869193788cebd499677a87c`, and the harness SHA-256 is `fc1847fcb5a29d1f5525dfe86271c459ffa9ec0ccd6ec2efa202ef78dac8a402`. The report binds the current Chrome Original ZIP and final source fingerprint. Its Chrome 152 identifier is the page-reported user agent; `Browser.getVersion` was unavailable. No complete network trace was captured.

This is browser worker execution, not native extension installation or cross-browser acceptance. The shared worker-byte checks establish artifact identity across targets, not equivalent browser behavior. Native installation/identity continuity, lifecycle, actual provider traffic, permissions and CPU/RAM/latency remain unverified.

Final external evidence includes `artifact-results.json`, `source-input-records.json`, `final-artifact-run.txt`, `final-download-validator.txt` and `browser-report-binding.json`, alongside the realm/byte results and preserved rejected-candidate evidence.

## Limits retained throughout

These are unsigned manual-install candidates. ZIP/manifest inspection and source reproduction do not establish native installation, extension identity continuity, browser consent/signing behavior, background/offscreen lifecycle or the twelve browser/provider combinations. The preserved native-installation and performance gates remain required. A private source link can be verified against packaged content locally; native browser navigation/download behavior must be identified separately if not exercised.

The report does not equate a license inventory with an unrestricted legal conclusion, source reproducibility with physical accuracy, or a passing local artifact check with a published/signed release. **No open finding remains in this bounded artifact review.** Native/browser performance, PostgreSQL execution and external release conditions remain separate required gates.
