# EcoLogits primary method and Original research archive

22 September 2026. Local implementation and verification record. The extension is not in production and has not been published.

## Delivered behavior

- EcoLogits is the default and only selectable engine in current extension builds. Standard builds and controlled release builds use it for Chrome, Edge and Firefox. Explicit Original build requests are rejected.
- The release plan, packager, source verifier and website download validation use three EcoLogits variants. The three stable public download aliases select those variants. Retired Original download ZIPs have been removed.
- Output consolidation: all build commands now share `.output/chrome-mv3`, `.output/edge-mv3` and `.output/firefox-mv2`. Old suffixed folders and stale ZIPs were moved out of `.output` into a private local archive after the automatic safety policy rejected deletion. Public downloads now contain one ZIP per browser, with no separate EcoLogits-suffixed duplicate. The Original research archive remains in the repository.
- Existing Original preferences migrate to the build default with a new selection revision. First admission uses EcoLogits. Saved numerical observations and recorded results retain their identities, and new selections cannot request the archived engine.
- The [Original method archive](../research/archive/original-method/README.md) and [research history](../research/archive/original-method/RESEARCH-HISTORY.md) document the project's earlier method, source audits, alternatives, corrections and limitations. Executable code and versioned inputs remain in place for reproducibility and historical compatibility.
- The root README, extension and configuration guides, public methodology, open-source page, build instructions and current contract amendments explain the decision. Existing design-review anchors are preserved.

The accepted EcoLogits numerical core and catalog were not upgraded by this change. This record does not adopt the separately prepared 22 September catalog candidate.

## Verification

| Check | Result |
| --- | --- |
| Workspace TypeScript checks | Passed |
| Contracts, estimator and ledger tests | 28, 113 and 216 passed respectively |
| Extension selection, migration and historical preservation | 13 engine-service tests passed, including fresh EcoLogits admission and rejected Original selection |
| Broader extension run excluding the large-history stress test | 928 tests: 925 passed, two file-relay timeouts, one platform skip. The complete four-test file-relay suite passed when rerun on its own. No full-suite pass is claimed. |
| Website tests | 48 passed, one Windows symlink skip |
| Focused Python engine, export and contract tests | 319 passed |
| Research comparison tests | Eight passed |
| Methodology, documentation and review-anchor checks | 105 passed; all relative archive links resolve |
| Build-plan and packaging tests | Five TypeScript tests, 12 Python release tests with one skip, and three browser-runtime tests passed |
| Explicit controlled Original build request | Rejected with the archive explanation; ordinary default resolves to EcoLogits |
| Standard browser builds and distribution packaging | Chrome, Edge and Firefox built; three EcoLogits release candidates packaged with matching notices and corresponding source |

The 10,050-record aggregation test exceeded a 90-second test deadline in the broad run and its remaining process was stopped. It was not marked passed or removed. Native installed-browser checks, external deployment and publication were not performed.

`pnpm verify:source-archive` passed: Chrome, Edge and Firefox reconstructed with exactly matching distribution paths, byte lengths and SHA-256 hashes. The report contains only `chrome-ecologits`, `edge-ecologits` and `firefox-ecologits`, each with no missing, extra or changed entries. `pnpm --filter @footprint/web build` then passed against those verified packages and source proof. The generated website includes the three EcoLogits-selected public download aliases.

After output consolidation, packaging, exact source reconstruction and the production website build passed again using only the three canonical unpacked folders. Build/release tests, refinement typechecking and Python lint passed; download-validation tests passed eight checks with one Windows symlink skip. An explicit directory inventory confirmed that `.output` contains exactly `chrome-mv3`, `edge-mv3` and `firefox-mv2`, each with EcoLogits as its only available engine. Public downloads contain exactly one ZIP per browser and their manifest. Concurrent source edits during an earlier packaging attempt were preserved and included in the final rebuild; the earlier mismatched artifacts were not accepted as verified.
