# Research documentation

**Current method, 22 September 2026:** EcoLogits is the primary and only selectable product engine. The project-developed Original method is [archived](archive/original-method/README.md), with a [research history](archive/original-method/RESEARCH-HISTORY.md) linking the substantial literature review, source audits, numerical checks, independent challenges and corrections behind it. References below to retaining the earlier reference settings describe historical decisions and do not override this change.

This index connects the project's research, primary-source checks, calculation inputs and implementation decisions. The repository contains the application implementation alongside preserved designs and research. The extension has not been published; local verification does not establish production measurement accuracy.

## Start here

| Question | Main document | Supporting evidence |
| --- | --- | --- |
| Where should the implementer start? | [Implementation handoff](../../IMPLEMENTER-HANDOFF.md) | [Implementation plan](../../IMPLEMENTATION-PLAN.md), [product/enrollment specification](../implementation/PRODUCT-AND-ENROLLMENT-SPEC.md), [Contracts](../implementation/CONTRACTS.md), [acceptance and failure rules](../implementation/ACCEPTANCE-AND-FAILURES.md) |
| What are the exact electricity, carbon and water equations? | [Canonical methodology article](../methodology/content.html) | [Text reference records](../../registry/text-reference-profiles-2026-09-09.json), [methodology specification](../implementation/METHODOLOGY-AND-MULTIMODAL-SPEC.md) |
| Why are tokens, physical energy and context size different? | [Context-aware energy research](CONTEXT-AWARE-ENERGY-RESEARCH-2026-09-09.md) | Three-turn worked example, equation coefficients, candidate comparison and source footnotes in that report |
| Did Offset have a better method or sources? | [Offset comparison](OFFSET-COMPARISON-2026-09-09.md) | [Energy-source audit](OFFSET-ENERGY-SOURCE-AUDIT-2026-09-09.md), [water/carbon audit](OFFSET-ENVIRONMENT-SOURCE-AUDIT-2026-09-09.md) |
| Which input-aware methods were evaluated? | [Energy-model source audit](CONTEXT-ENERGY-MODELS-SOURCE-AUDIT-2026-09-09.md) | Exact equations, recoverable coefficients, paper versions, workload limits and reuse status |
| Can public measurements validate a better formula without paid experiments? | [Measured-data audit](CONTEXT-ENERGY-MEASUREMENTS-SOURCE-AUDIT-2026-09-09.md) | Dataset fields, batch/request distinctions, cache experiments, sensor limits and raw-data access gaps |
| Can Microsoft's published model be reused? | [Microsoft source audit](CONTEXT-MICROSOFT-SOURCE-AUDIT-2026-09-09.md) | Paper/code differences, original NVIDIA throughput semantics, units, license and independent arithmetic |
| What do the four websites actually expose? | [Live browser audit](../implementation/LIVE-BROWSER-AUDIT-2026-09-09.md) | [Sanitized protocol fixtures](../../fixtures/browser-audit-2026-09-09/README.md), [context guidance](../implementation/CONTEXT-GUIDANCE.md) |
| Which current models/modes are recognized? | [Dated model catalog](../implementation/MODEL-CATALOG-2026-09-09.md) | [Machine-readable inventory](../../registry/model-catalog-2026-09-09.json); recognition does not establish tokenizer or energy calibration |
| What did the original independent review establish? | [Reconciled review summary](../../research/verified-review-summary.md) | [Original research](../../research/report-source.md), [original source ledger](../../research/source-ledger.md), [independent audit](../../research/claude-independent-audit.md) and its mandatory [correction addendum](../../research/claude-audit-corrections.md) |

## Why the current numbers remain reference estimates

| Quantity or choice | Provenance and reason retained | What is not established |
| --- | --- | --- |
| Text-energy equation and coefficients | Pinned EcoLogits source, explicit profile settings and reproduced worked arithmetic | Actual closed-provider hardware, power, input-length sensitivity or per-request physical accuracy |
| Current highest-comparable text reference | Deterministic comparison of the declared four-profile cohort under common settings | A global maximum, calibrated uncertainty bound or proof that the proxy is the employee's actual model |
| PUE, carbon and water factors | Exact library values, conversions and scope qualifications in the canonical article and environmental audit | Complete original vintage/population provenance for every value, or the actual serving location of an employee request |
| Image reference values | Nothing since 20 October 2026: the bundled ML.ENERGY GPU figures were removed (no licence); the methodology cites the leaderboard as an external comparison | Full provider-operation energy, unobserved CPU/host work or arbitrary input-image/document processing |
| Input-aware candidates | Credible studies demonstrate relevant structure and bounded empirical results | A ready, independently qualified numerical replacement for all four consumer websites |

An equation can be implemented correctly while its assumptions differ from reality. A source number can be transcribed correctly without being applicable to a particular request. A held-out result can establish error on one domain without establishing the same error after transfer. The reports preserve these distinctions rather than declaring the current numbers universally correct.

The current decision is to retain the numerical reference settings, disclose the input/context limitation, and keep improved methods replaceable. No paid hardware experiment, paid provider generation or paid dataset purchase is authorized. Candidate values are isolated from runtime selection, and a future update must be reviewed against the [methodology quality gates](../implementation/METHODOLOGY-QUALITY-GATES.md).

## Trace from source to displayed result

For each accepted numerical method, the required chain is:

1. An exact source version and relevant table, equation, dataset or code revision.
2. The original number, unit, population, workload, system boundary and evidence class.
3. Explicit project choices such as hardware scenario, fallback cohort and unknown-cache assumptions.
4. A versioned equation and coefficients with conversions that can be recomputed.
5. Named tests of arithmetic, applicability, capture and any empirical validation, each with its actual scope.
6. The resulting quantity, method version, included/missing components and limitations presented to the reader.

New publications do not silently overwrite old observations or estimates. Revised methods produce a separately labeled recalculation view. A paper correction, software release or newer source year is not itself a reason to mix incompatible factors.

The [published-reference catalog](../../registry/published-reference-evidence-2026-09-09.json) is source evidence, not an approved runtime factor bundle. Likewise, the [SweetSpot research fixture](../../fixtures/context-energy-study-2026-09-09/sweetspot-llama31-8b.json) is a bounded arithmetic example, not a Claude profile.

## Reproducibility and evidence limits

The principal local checks are:

```sh
node tools/build-methodology.cjs --check
node --test tools/context-energy-study.test.cjs tools/offset-audit.test.cjs tools/methodology-reference.test.cjs tools/methodology-checks.test.cjs design-canvas/test.cjs fixtures/browser-audit-2026-09-09/reference.test.mjs
```

The four new context-study checks cover the three-turn token example, exact polynomial arithmetic, explicit extrapolation/cache rejection and consistency with the research report. They do not fit a model, reproduce GPU experiments or certify production adapters. Earlier prototype checks and their limits are recorded in [prototype verification](../../design-canvas/VERIFICATION.md).

On 9 September 2026, the full command above passed **91 offline checks**, and the generated-methodology check passed without changing the public article or its numerical reference settings. A fresh reader checked the context report, its 20 footnotes, the localized-update requirements and the research fixture. Independent exact-decimal arithmetic reproduced all three example energies and their sum. The reader's focused tests passed 4/4 plus 19/19 existing reference checks. These results support the documented arithmetic and consistency, not a measured accuracy claim for a consumer service.

Source retrieval limitations remain part of the supporting audits. Inaccessible, gated or expired artifacts are not treated as inspected data. No access restriction was bypassed. Original public source snapshots remain in the ignored local research cache; external links and the decisions derived from them are recorded in the curated documents. Raw authenticated browser captures, private conversations and research tool logs are not part of the public evidence handoff.

## Updating the research

The [easy-formula-update amendment](../../IMPLEMENTATION-PLAN.md#confirmed-amendment-easy-formula-updates-9-september-2026) and [writing/code standard](../implementation/WRITING-AND-CODE-STANDARDS.md#keep-scientific-formulas-easy-to-replace) require shared pure methods, immutable coefficient records and cross-runtime fixtures. Future implementers should change the method-specific module and its reviewed data, not duplicate formulas across the app.

When new evidence changes a conclusion, record what changed, the exact new source, why its scope is applicable, which earlier statement is superseded, and which tests were rerun. Keep rejected alternatives and their reasons available so that an unsupported claim does not return through an older report or a copied coefficient table.
