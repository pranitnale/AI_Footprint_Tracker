# Independent publication-race review

15 September 2026. **Current bounded verdict: CLEAN for the cache-test and Coordinator publication-race corrections.** This record is separate from final browser-artifact clearance. The reviewer changes no product/test source and writes only this report and temporary evidence.

At the initial checkpoint, the cache-test correction was CLEAN while the Coordinator correction was still pending. That historical checkpoint and the subsequent completed-source recheck are preserved below.

The parent reported that the first final extension run stopped with 735 tests, 730 passes, four failures and one skip. The log at `.test-runtime/final-check.log` confirms three escaping `aggregate_inconsistent` failures and the dashboard-cache test-file timeout. These failures preceded final artifact generation; no earlier browser candidate is certified by this review.

## Dashboard cache fixture and generation coverage

Reviewed `apps/extension/test/dashboard-health-cache.test.ts` and its actual diff. The previous same-build fixture used the default view, which can change calculation generation after new observations. It also waited for a separate completion latch that would not resolve if the intercepted cache write rejected. The correction selects explicit Original for the same-build scenario, records the actual intercepted write promise and bounds stage waits at five seconds.

A separate new case retains the generation-change behavior: it holds an old default-view cache write, completes local calculation, obtains a current recalculated dashboard under a different cache key, releases the old write and asserts `aggregate_inconsistent`. A final read confirms the newer result remains. The test therefore preserves the stale-calculation guard instead of changing the same-build test to imply that an old write should succeed across an engine generation change.

Both cases release their held gate, restore the intercepted method, await the real work with a bound and dispose their history/engine activity. Existing scope-transition and independent health/scope-isolation tests remain. No product guard was changed for this test-only correction.

Independent execution from `apps/extension`:

```text
node --import tsx --test --test-timeout=15000 test/dashboard-health-cache.test.ts
```

**5/5 PASS**, zero failures/skips, approximately 0.99 seconds total in this run. This timing describes the test execution and is not a product performance measurement. Evidence is under `%TEMP%/aift-publication-review-20260915/`, including the reviewed test copy and `dashboard-health-cache-tests.txt`.

Reviewed test SHA256: `b5dbf1ba1dcaa7f2ec0591d9fbeb3d7a7d295a1ea855ed2d7e558ed42eac65b7`.

The source correction to `Coordinator.publishCapture`, its bounded retry behavior and final scope/erasure/selection guards require a separate completed-source recheck before this record can give a combined CLEAN verdict. Final extension-suite results and actual browser artifacts remain separate gates.

## Completed Coordinator correction and independent recheck

**Latest bounded verdict: CLEAN for the cache-test and Coordinator publication-race corrections.** The owner confirmed a stable source boundary. No product or test source was changed by this reviewer. Final full-suite and artifact generation remain parent-owned and are not certified by these focused results alone.

The production correction is confined to `Coordinator.publishCapture`. Each outer attempt rebuilds the display from the captured source basis while refreshing routing, calculation selection, summaries and queue state. Nested `Error` instances with exactly `aggregate_inconsistent` or `selection_conflict` cause another complete guarded attempt. Other failures propagate. There are at most three outer attempts and at most two direct local-maintenance waits in this function. Exhaustion records `estimate_unavailable` and throws an explicit `aggregate_inconsistent`; it neither invents an empty successful summary nor rewrites the observations.

The final calculation-token or observation-summary-version mismatch now retries even for a strict refresh. This permits a verified recorded-thread refresh to survive a concurrent real engine promotion. Scope/routing, erasure, source, thread, pause, display-version and context checks remain before emission. Strict refresh still discards invalid source/routing/erasure results. The final atomic snapshot is followed by synchronous checks and `sendDisplay`, with no intervening asynchronous scan. Recovery calls local maintenance and does not add organization requests.

### Executed tests and independent probes

From `apps/extension`:

```text
node --import tsx --test --test-timeout=20000 test/active-recorded-thread.test.ts test/inline-files.test.ts test/dashboard-health-cache.test.ts
```

**45/45 PASS**, zero failures/skips. This includes the formerly failing active-thread and malformed-inline-count cases; real promotion during recorded-thread scanning; strict refresh promotion at the final queue await; engine/scope/erasure changes after recovery; exhaustion with real tracking-health readback; non-transient failure; and existing final navigation, permission, pause, rejection, correction and alias checks. Output: `focused-tests.txt` in the evidence directory above.

Independent `node node_modules/typescript/bin/tsc -p apps/extension/tsconfig.json --noEmit`: PASS against the existing prepared extension configuration. No build was launched.

`independent-probes.mjs` uses the actual Coordinator and a relocated copy of the existing synthetic setup helper, without importing the owner's new test assertions. Six additional scenarios pass:

| Scenario | Observed result |
| --- | --- |
| Site consent removed during retry recovery | No display emitted; the saved attempt remains; no organization call. |
| Pause enabled during retry recovery | No display emitted; the saved attempt remains; no organization call. |
| Display navigation invalidated during retry recovery | No stale display emitted; the saved attempt remains. |
| Persistent recorded-thread selection conflicts | Exactly three thread reads and two recovery waits; no display; visible `estimate_unavailable`; explicit failure. |
| Non-Error object with a transient-looking message | One read, no retry, original rejection preserved. |
| Persistent non-thread source-scan conflicts | Bounded failure with no display, saved observation and visible unavailable health. |

**Bound qualification:** the existing `scanUsage` helper has its own three-attempt/two-maintenance loop. Consequently the last scenario performs nine underlying scans and eight total maintenance calls across the three outer publication attempts. The two-call bound describes direct calls added by `publishCapture`, not a global bound on nested helpers. Local maintenance also uses an existing record limit and cooperative time budget; this review does not claim a hard wall-clock latency bound or native-browser performance result. All six Personal probe scenarios recorded zero organization calls. Results are in `independent-results.json`.

### Final reviewed source hashes

| File | SHA256 |
| --- | --- |
| `apps/extension/lib/coordinator.ts` | `5d9d1fbfdba225eceb5a9cf1ae682e718a29346930bbef5b0470f320970c138e` |
| `apps/extension/test/active-recorded-thread.test.ts` | `c45667c9ec61acbeabb545449fe4e028da84ad4350e4083847755f4ec618f3b0` |
| `apps/extension/test/inline-files.test.ts` | `b7c744283395590185a13d8e3cd49c0bcf64aea7144503ec348ed825758c35b6` |
| `apps/extension/test/dashboard-health-cache.test.ts` | `b5dbf1ba1dcaa7f2ec0591d9fbeb3d7a7d295a1ea855ed2d7e558ed42eac65b7` |

The final artifact review must use newly generated candidates and their coherent source fingerprints. This focused correction review does not turn the earlier failed monolithic check into a pass or replace later recorded stage results.
