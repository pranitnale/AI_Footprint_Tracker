# Independent monthly summary UI review

15 September 2026. **Final bounded verdict: CLEAN.** Both reproduced P2 findings were corrected by the production owner and independently rechecked. The final targeted run passed 16 checks. This reviewer did not change UI source or permanent component tests; this report and ignored local probe files are the only review artifacts.

## Scope

The review covered the monthly readiness condition in `apps/extension/lib/App.tsx`, request identity and cancellation in `dashboard/use-monthly-summary.ts`, `CalculationResult.pending` validation, optional `MonthlySummary.calculation` metadata, the panel label, and the monthly component regressions. The engine selection hook and named dashboard client were read to trace status refreshes and validated responses.

Acceptance questions were whether initial status loading waits before requesting a monthly claim, pending or failed calculations and mismatched scopes stay hidden, selection changes invalidate old results, readiness refreshes preserve an already claimed result, dismissal prevents another claim, and the existing expanded dashboard still renders its monthly panel once.

All execution used React, Testing Library and JSDOM under the extension's `tsx` configuration with synthetic clients and values. These tests exercise the actual hook, panel and App components. Backend claim behavior was represented by a client returning one non-null result followed by null for the consumed claim. This report does not independently certify the backend claim transaction or numerical calculations.

## MUI-01: Readiness refresh discarded a claimed monthly result (P2)

The previous effect in `use-monthly-summary.ts` depended on `enabled` and cancelled its request during every effect cleanup. A status read, including the read triggered by opening Settings, changes `engine.busy` and temporarily disables the monthly panel. With the same client, scope and calculation key, returning to readiness issued another monthly request. Its null response replaced the received result because the backend had already claimed that month. A response arriving while temporarily hidden could also be discarded before it reached UI state.

The original independent reproduction first received a valid summary, then changed only `enabled` from true to false and back to true. Observed output was `sameKeyReadinessRefresh: { calls: 2, visible: null }`.

The correction tracks a request by client, scope and calculation key. Identity changes or unmount invalidate the request. A readiness-only change hides presentation while preserving an in-flight request and allowing its successful response to be cached. A completed non-null response prevents another request for that identity. Dismissal hides the result without forgetting the completed claim. Null responses and failures remain eligible for a later retry.

**Independent closure: PASS.** The unchanged acceptance probes verify both a previously received result and a response arriving while hidden, with exactly one request after readiness returns. They also verify dismissal, null retry and cancellation after a real calculation-key change. Final source inspection confirms that returned results are bound to the client as well as scope and calculation key.

## MUI-02: Recalculated monthly totals were labeled Original (P2)

`MonthlySummaryPanel` previously rendered `Calculation: Original recorded estimates.` unconditionally. A monthly result with `calculation.view: "recalculated"`, an EcoLogits method ID and its hash therefore carried an incorrect calculation label.

The original independent render probe returned `ecoPanelClaimsOriginal: true`. The correction selects `Recalculated estimates.` for recalculated metadata and retains `Original recorded estimates.` for Original or legacy results without calculation metadata.

**Independent closure: PASS.** The unchanged acceptance render probe no longer finds the Original label for a recalculated result. The permanent panel regression checks both labels.

## Final acceptance assessment

| Check                                      | Result and evidence                                                                                                                                                                                                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Initial status loading                     | PASS. The readiness condition requires current dashboard data and a matching non-null engine status before requesting the month. The independent hook probe observes zero requests while initially disabled.                                                                                           |
| Pending, failed or mismatched engine state | PASS within this component boundary. App requires matching scope, a method, an admitted local status and no busy operation or pending dashboard calculation. Targeted full-App cases retain the previous completed view while selected work is pending or failed and reject late foreign-scope status. |
| Ready result during a status refresh       | PASS. A received result reappears after temporary hiding without a second request.                                                                                                                                                                                                                     |
| In-flight result during a status refresh   | PASS. A successful response arriving while hidden is retained and appears when readiness returns, with one request.                                                                                                                                                                                    |
| Dismissal                                  | PASS. The panel stays dismissed and the same identity is not requested again.                                                                                                                                                                                                                          |
| Null response                              | PASS. It does not mark the identity completed and can be retried after readiness returns.                                                                                                                                                                                                              |
| Calculation change                         | PASS. Old results are immediately hidden by the identity check; a late old response cannot restore them.                                                                                                                                                                                               |
| Calculation metadata                       | PASS. `pending` is optional but must be boolean when supplied. Monthly calculation metadata is validated when present; the label follows its view.                                                                                                                                                     |
| Existing monthly panel                     | PASS. The expanded company dashboard still claims and renders the monthly summary once.                                                                                                                                                                                                                |

## Executed tests

Commands below ran from `apps/extension`, using its JSX and TypeScript settings rather than the repository root's JSX defaults.

```powershell
pnpm exec tsx --tsconfig tsconfig.json --test .test-runtime/monthly-ui-recheck.test.ts test/monthly-summary-ui.test.tsx
pnpm exec tsx --tsconfig tsconfig.json --test --test-name-pattern='personal Company and return|expanded company dashboard claims|pending and failed engine selection|late engine status from an earlier scope|pending selected results' test/app-ui.test.tsx
```

| Final run                                                                             | Result                                                                                                                                                               |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unchanged independent acceptance probes in `.test-runtime/monthly-ui-recheck.test.ts` | 6 passed, zero failures. Prepared before the completed correction.                                                                                                   |
| Permanent `test/monthly-summary-ui.test.tsx`                                          | 5 passed, zero failures. Covers received and in-flight readiness changes, dismissal, null retry, calculation changes and both panel labels.                          |
| Targeted full-App tests                                                               | 5 passed, zero failures. Includes Personal startup, expanded company monthly once, pending/failed selection, late foreign-scope status and pending selected results. |
| Final targeted total                                                                  | **16 passed.** These are the three disjoint sets above.                                                                                                              |

The earlier broader component run passed 49 of 50 tests. The Personal startup test timed out while waiting for its heading and also failed in an isolated cold run with the default one-second Testing Library wait. An ignored copy using the same fixture and assertions with a ten-second functional timeout passed in about 1.89 seconds, with coherent request ordering and the once-only monthly assertion intact. No calculation-fixture mismatch was established. The owner subsequently made that test's initial functional waits explicit at five seconds, preserving its content and call assertions. The final targeted run passed. This is functional synchronization evidence, not a browser-performance measurement.

The original defect probe remains in `.test-runtime/monthly-ui-review.ts`; its pre-fix expectations describe the bug and are not the post-fix acceptance suite. The independent post-fix suite was preserved unchanged. These scratch files are ignored local review artifacts, so the permanent tests are the repository's portable regressions.

## Current file hashes

SHA256 values below identify file bytes read when this report was saved. Later source or formatting changes require a new hash record; this verdict does not certify an unreviewed later revision.

| Repository path                                                | SHA256                                                             |
| -------------------------------------------------------------- | ------------------------------------------------------------------ |
| `apps/extension/lib/App.tsx`                                   | `191c2cccc8b288ed720ddb09a533675dd4edd2d0c8c255d4f5030c5077fbf680` |
| `apps/extension/lib/dashboard/use-monthly-summary.ts`          | `a6017afbada3f17425a6605f43d19987a1b9148ae363f8cb5d4db0230f583b46` |
| `apps/extension/lib/dashboard/use-engine-selection.ts`         | `0cfd33ce737104c7ba672543dd9ad3e9478f4f457a7959c9311746d40bc791c7` |
| `apps/extension/lib/dashboard/client.ts`                       | `6b070d6b75310bd9915e4b0eae3d6b799aed1995ded5d7cf334aa6fdad83ad31` |
| `apps/extension/lib/dashboard/response-validators.ts`          | `e4d6caab801ba488c8a4a3ac7dafdac5de3f780edf3d64220027f8da6d0da826` |
| `apps/extension/lib/dashboard/summary-validators.ts`           | `07bd34e610b8266620ee0227dbe52b76beb1df086abb25478a6de438ea8d6fc9` |
| `apps/extension/lib/dashboard/types.ts`                        | `778f7399ed27f477c12dfa9bcbd97b7c45cb743f50b4857ee16a49423c3303fe` |
| `apps/extension/lib/dashboard/summary-panels.tsx`              | `eefca571dfc6abc8e42ea5e95f0caf9428d838fd152efbaa20446e46dfc8a8f3` |
| `apps/extension/test/monthly-summary-ui.test.tsx`              | `cf305f30226ed3fbc28b7f8ba491dc387d6a4615d9e28b6c6166145ea0b654dd` |
| `apps/extension/test/app-ui.test.tsx`                          | `4ba3b9a70f2aacde8ea960c6e8d9778f74b2b9e751bb83ffb72ad89f349fefc1` |
| `apps/extension/.test-runtime/monthly-ui-review.ts`            | `f288836946da343552ce70e95765ca82add23c03f29205d6d071bc627cc52ffa` |
| `apps/extension/.test-runtime/monthly-ui-recheck.test.ts`      | `561687ff7ee6dd30ed8484b79e5023cfc6266087582055002e99657bdf8a0518` |
| `apps/extension/.test-runtime/app-ui-readonly-review.test.tsx` | `6ee37b1edf649e748d3d53581f18ce7d8fc4d00476587f37cd62d728cd86b3e1` |

## Exclusions

No native Chrome, Edge or Firefox extension was installed or exercised for this review. JSDOM component results do not establish browser layout, accessibility, performance, lifecycle or extension permission behavior. No live provider traffic, production organization, PostgreSQL target or remote estimation endpoint was used.

The full `pnpm check` pipeline is owned by the parent task and was in progress when this report was saved. Its outcome, packaging checks, backend claim correctness and native-browser release gates are separate from this bounded UI verdict. No commit, push or deployment was performed by this reviewer.
