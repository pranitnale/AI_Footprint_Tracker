# Timing and reconciliation implementation status

**16 September native follow-up:** the owner resumed Chrome testing. Corrections now cover immediate historical-plus-live display, coherent organization snapshots, benign native navigation hints, transient ChatGPT routes, Perplexity matching and Gemini's current XHR/composer structure. Dashboard labels explicitly distinguish live breakdowns from combined totals. Independent review is clean, including reentrant XHR cleanup and all read/commit route-guard consumers. The updated full extension suite passes 919 tests with one Windows-specific skip; extension typecheck, 40 adapter tests and 16 module-verification tests pass. All six packages reproduce exactly from the matching source archive, with 89 files each. Packaged privacy checks and the website build pass. Fresh files are in the existing installation folders. Chrome re-verification awaits the owner's manual extension reload; see [current native verification](NATIVE-VERIFICATION-2026-09-16.md). The table below describes the previous source checkpoint.

15 September 2026. Implementation and automated verification are complete under the owner's [current authorization and acceptance criteria](../implementation/TIMING-AND-RECONCILIATION-PLAN.md). The explicitly deferred native-browser and PostgreSQL checks remain pending. This record does not certify a production release.

## Implemented

- Current `2.0.0` observation, usage and history schemas; obsolete observation readers removed. Local DB15 and server migration0011 reset old testing usage while retaining authentication and deletion protection.
- Numeric timing evidence, monotonic live capture, qualified historical spans, live/history/null precedence and unchanged EcoLogits cap equations.
- Browser-verified provider response identity mappings, including Claude `message.uuid` instead of its unrelated live `message.id`.
- Canonical live/history contribution selection, compatible token enrichment, immutable originals, stronger duplicate selection and hash-bound historical dependencies.
- Conflicting historical timing becomes unavailable without removing valid counts. Original spans remain saved, incomplete timing can improve, and valid live timing still takes priority.
- Source freshness proof for the Original fast path, including history and ownership changes. Changed evidence receives recalculation; unchanged Original evidence retains its fast path.
- Python parity, current wire admission, native timing/water forwarding, history-dependent result invalidation and original-view preservation.

## Verification

| Check | Evidence/status |
| --- | --- |
| Current contracts | 26 tests passed, including Python validation parity |
| Estimator | Full suite 108 passed, including the model-provenance regression |
| Ledger | Latest complete suite 216 passed; typecheck passed |
| Application integration | Five real Coordinator/history cases pass, including ten old requests plus one live request, both arrival orders, restart, partial output, both request/attempt aliases and disputed timing without lost counts |
| Original and application regressions | 108 targeted extension tests passed, including no redundant Original executor calls and late file revisions |
| Workspace typecheck | Passed across all workspace packages |
| Module boundaries and verification | 16 verification tests passed; pure observation-evidence selection lives in contracts rather than importing calculation code in summaries |
| Offline comparison tooling | 8 tests passed |
| Upstream maintenance | 17 tests passed, including staged adoption, rollback, native product checks and unchanged Original numbers |
| Provider browser identities | Four sites verified in the in-app browser; [sanitized evidence](../../output/research/live-history-identity-2026-09-15.json) |
| Full extension suite | 840 passed, 1 Windows symlink test skipped; `.test-runtime/timing-extension-final.log` |
| Backend focused | Latest timing/reconciliation suite 18 passed; 12 focused shared-execution, alias and full-suite regression cases passed |
| Final full backend suite | 779 passed, 1 PostgreSQL test skipped; `.test-runtime/timing-backend-final.log` and `.test-runtime/timing-backend-final.xml` |
| Independent review | All twelve agreed criteria pass within the authorized implementation scope. Capture, timing-conflict, scoped shared-execution, original timer attribution and tooling reviews are clean. The final reviewer independently checked current test results, the 526-file source fingerprint and all six archive/public-copy hashes |
| Documentation and release tooling | 105 documentation tests passed; release tooling tests passed with one platform skip |
| Privacy and Python imports | 25 privacy tests passed; current source scan has no findings or read errors. Ruff clean after import-only sorting, full Python collection passed and 22 affected restore/timing tests passed |
| Build packages | Six current Chrome, Edge and Firefox variants built; matching source archive rebuild reproduces all 89 files in each variant with no missing, extra or changed files |
| Packaged privacy scan | No flagged content or read errors across the current source and packaged archives |

The final full run passes after correcting scoped shared-execution handling, preserving original timer attribution and updating obsolete test expectations. Tests still distinguish different requests from one shared response, and retain immutable raw alias evidence.

## Local distribution

For the Chrome build with EcoLogits selected by default, load `apps/extension/.output/chrome-mv3-ecologits`. Both calculation engines remain available in Advanced settings. The corresponding Edge and Firefox variants use the same suffix.

The [package manifest](../../artifacts/browser/manifest.json) and [source reproduction report](../../artifacts/browser/source-verification.json) record the current 16 September artifacts. The matching source archive is `artifacts/browser/ai-footprint-tracker-0.1.0-sources.zip`, 1,795,256 bytes, SHA-256 `4f8d52b591d4f06794c37f6e7ef015f8ac35be43d9775449389d26380be316cf`, covering 533 source files. The bundled EcoLogits notices and corresponding modified source remain included.

Chrome verification has resumed and its final pass awaits the updated extension reload. Edge/Firefox native checks, full browser overhead measurements and the approved isolated PostgreSQL environment remain outstanding. No deployment, push, remote estimation-service activation or Python runtime in the browser is part of this work.
