# Independent implementation review

Conductor review, 10 September 2026. This is an active defect and evidence record, not a final approval. Findings describe the code inspected at the time; implementer reports do not close them without re-verification.

| Finding | Risk | Current evidence |
| --- | --- | --- |
| Root ESM scope broke the existing methodology generator | A new build configuration regressed existing authored material | Fixed. Conductor reran `node tools/build-methodology.cjs --check` successfully. The 99 existing checks also passed in the implementer's rerun. |
| Invalid counter strings threw from `safeParse` | Untrusted telemetry could escape the intended validation path | Fixed and independently reproduced as rejecting without throwing, including the BIGINT boundary. Regression test in `tests/verification/measurement.test.ts`. |
| Default factor metadata discarded established source qualifications | Incorrect carbon/water interpretation | Source families now retain lifecycle CO2e and all-source electricity water, including seawater and fuel-processing exclusions. Unknown direct-water category does not produce a complete water total. Further UI/export review remains necessary. |
| Python accepted factor values and negative energy rejected by TypeScript | Different validation behavior across the shared calculation boundary | Fixed by backend implementer. Conductor repeated both negative probes and confirmed rejection. Default cross-runtime golden tests pass. |
| Abandoned response clones could remain unread on capture rejection | Unbounded buffering and host interference | Extension implementer is correcting slot reservation, byte budgets and cleanup. Independent lifecycle and stream tests pending. |
| Local acknowledgement handling lacked full reconciliation | Stale/aliased/erased records could remain wrong or blocked | Extension implementer is adding strict receipts, canonical reconciliation, indexed storage and signed erasure handling. Independent fault tests pending. |
| Credential rotation completion was not atomic | Worker interruption could lose refresh recovery state | Extension implementer is correcting persistence. Independent crash/retry test pending. |
| Local summaries used parent dispatch date for attempt resources | Cross-midnight usage could land in the wrong period | Extension implementer is separating occurrence-time selection. Independent boundary fixtures pending. |
| Local summaries mixed method/scenario/gas/token scopes | Incompatible estimates could appear as one precise total | Extension implementer is adding compatible series and explicit view selection. Independent mixed-scope tests pending. |
| Local estimate storage overwrote historical lineage | Original results could disappear after revisions or method changes | Extension implementer is adding immutable estimate records and canonical selection. Independent persistence test pending. |
| Raw provider model values were compared only with canonical registry keys | Observed-model breakdowns could silently become unknown | Extension implementer is adding evidence-based alias normalization. Independent provider fixtures pending. |
| Initial backend used generic JSON entities and a global write lock | Missing relational invariants and cross-tenant serialization | Concrete identity tables and narrower locks were introduced. Remaining schema, query, constraint and PostgreSQL evidence still require review. |

## Independently executed checks

- 19 shared-core tests passed, including 800 supplied-text encoding comparisons, TypeScript/Python numerical comparisons and signed-update tampering checks.
- All three shared-package TypeScript checks passed.
- 12 backend authentication tests passed in the explicit test environment. This is not PostgreSQL execution evidence.
- Six independently authored measurement checks passed, including the acceptance document's synthetic electricity/carbon/water fixture in both TypeScript and Python.

No physical footprint calibration, live mailbox delivery, actual extension installation, complete provider/browser matrix, load target or production restore is certified by these results. Full implementation and integration verification continue.
