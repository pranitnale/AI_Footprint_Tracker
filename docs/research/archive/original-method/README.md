# Original calculation method (archived)

**Status: archived on 22 September 2026. Superseded by EcoLogits for new product use.**

The Original method is the project-developed calculation approach previously used by AI Footprint Tracker, created by Pranit Jagannath Nale. It combined published reference equations, explicit hardware and environment assumptions, a finite text-model comparison cohort and separately scoped image references. It drew on EcoLogits and other published work; calling it project-developed does not claim invention of the underlying scientific equations.

The project undertook substantial research before and during this implementation: literature comparison, primary-source and coefficient checks, environmental-boundary audits, inspection of what consumer AI websites expose, worked numerical examples, cross-runtime arithmetic checks, and independent reviews with recorded corrections. The [research history](RESEARCH-HISTORY.md) links that evidence, including rejected alternatives and unresolved gaps. Those checks establish specific source, arithmetic and software properties. They do not establish metered accuracy for closed-provider requests.

## Current decision

EcoLogits is the primary and only selectable calculation engine in current browser builds, across all supported sites. Standard development and distribution builds use EcoLogits. Existing saved Original engine preferences migrate to the current build default with a new selection revision. Recalculation uses saved numerical observations, keeps recorded results, and publishes the new view only when its existing completeness checks pass. In-flight requests keep their admitted method identity. Pending, failed and unsupported work remains visible.

The earlier method is retained for research, reproducibility and interpretation of saved records. It is no longer a product choice or an automatic fallback in the shipped configuration. Archived configurations and explicit research comparisons can still execute it. “Original recorded calculations” in a history or export view means the calculation recorded at the time, which can also be EcoLogits. It is not a switch back to the archived Original engine.

This is a product-maintenance decision, not a claim that EcoLogits has been independently validated against every provider's physical resource use. The accepted pinned EcoLogits core and catalog, consumer-to-API assumptions, operational boundary and missing-coverage disclosures still apply. Future upstream updates require their own review.

## Preserved implementation and data

The archive is maintained **in place** for executable code and versioned inputs. Moving them would break stable imports, stored method identities, existing research links and source-fingerprint tests. The following locations are the authoritative preserved implementation, not a second maintained product method:

| Material | Preserved location |
| --- | --- |
| TypeScript Original estimator | [original.ts](../../../../packages/estimator/src/original.ts) |
| Original history projection | [history.ts](../../../../packages/estimator/src/history.ts) |
| Versioned bundle, identity and coefficients | [bundle.ts](../../../../packages/estimator/src/bundle.ts), [registry](../../../../registry/) |
| Python reference | [Python estimator](../../../../packages/estimator/python/) |
| Original method contract | [original-method.ts](../../../../packages/contracts/src/original-method.ts) |
| Frozen regression corpus | [legacy-refinement.json](../../../../packages/estimator/test/fixtures/legacy-refinement.json), [characterization test](../../../../packages/estimator/test/legacy-refinement.test.ts) |
| Text and image reference cohorts | [text references](../../../../registry/text-reference-profiles-2026-09-09.json); the image reference cohort was removed on 20 October 2026 because the ML.ENERGY leaderboard repository it came from has no licence |
| Research comparison tooling | [comparison guide](../../../../tools/refinement/README.md) |

Shared modules in these locations may also support current calculations. Archive status applies to the earlier method and its assumptions, not to every function in those files. Do not delete numerical observations, rewrite recorded results, remove attribution or reinterpret old method IDs when maintaining this archive.

## Reproducing the historical work

Use the full repository and the pinned toolchain described in the [root README](../../../../README.md):

```sh
pnpm --filter @footprint/estimator test
node --test tools/context-energy-study.test.cjs tools/offset-audit.test.cjs tools/methodology-reference.test.cjs tools/methodology-checks.test.cjs
```

These checks cover regression fixtures, source-linked arithmetic and documentation consistency. Their success is not calibration evidence. The comparison tool remains available for explicit research runs; it does not control the shipped engine selection.

## Licensing and attribution

Original project code remains under the repository's [MIT License](../../../../LICENSE). The independent EcoLogits TypeScript core remains MPL-2.0 with its [notice](../../../../packages/ecologits-core/NOTICE.md), [citation](../../../../packages/ecologits-core/CITATION.cff) and corresponding-source requirements. Other referenced materials retain their own rights and source qualifications; see [third-party notices](../../../../THIRD-PARTY-NOTICES.md). Archiving does not change those obligations.
