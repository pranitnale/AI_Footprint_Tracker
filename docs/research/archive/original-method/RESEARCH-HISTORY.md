# Research behind the Original method

This is a curated map of the research that informed AI Footprint Tracker's earlier method. The linked reports keep their original dates, findings and corrections. Read them as historical evidence; their use of “current” or “retained” reflects the decision at the time. The [archive decision](README.md) supersedes their recommendation to use the Original method in the product.

| Research stage | Evidence and outcome |
| --- | --- |
| Initial investigation | [Original report](../../../../research/report-source.md) and [source ledger](../../../../research/source-ledger.md). Preserve the original questions and reference chain. |
| Independent challenge and corrections | [Independent audit](../../../../research/claude-independent-audit.md), mandatory [corrections](../../../../research/claude-audit-corrections.md), and [reconciled review](../../../../research/verified-review-summary.md). Earlier unqualified claims must not override later corrections. |
| Input, output and conversation context | [Context-aware energy research](../../CONTEXT-AWARE-ENERGY-RESEARCH-2026-09-09.md), [model source audit](../../CONTEXT-ENERGY-MODELS-SOURCE-AUDIT-2026-09-09.md), [Microsoft audit](../../CONTEXT-MICROSOFT-SOURCE-AUDIT-2026-09-09.md). Examined input-aware alternatives, equations, coefficients, cache assumptions and transfer limits. |
| Measurement and validation feasibility | [Measured-data audit](../../CONTEXT-ENERGY-MEASUREMENTS-SOURCE-AUDIT-2026-09-09.md). Recorded dataset availability, sensor boundaries and access gaps. Missing measurements were not replaced by fabricated calibration. |
| Alternative product methodology | [Offset comparison](../../OFFSET-COMPARISON-2026-09-09.md), [energy audit](../../OFFSET-ENERGY-SOURCE-AUDIT-2026-09-09.md), [water/carbon audit](../../OFFSET-ENVIRONMENT-SOURCE-AUDIT-2026-09-09.md). Compared numerical claims and rejected unsupported transfers. |
| Observable consumer-web evidence | [Browser audit](../../../implementation/LIVE-BROWSER-AUDIT-2026-09-09.md) and [sanitized fixtures](../../../../fixtures/browser-audit-2026-09-09/README.md). Distinguished visible text and timing from verified provider usage and hidden work. |
| Transparent numerical references | [Methodology specification](../../../implementation/METHODOLOGY-AND-MULTIMODAL-SPEC.md), [text cohort](../../../../registry/text-reference-profiles-2026-09-09.json), an image cohort (removed on 20 October 2026 because the ML.ENERGY leaderboard repository it came from has no licence), and [published comparisons](../../../../registry/published-reference-evidence-2026-09-09.json). Kept units, source versions, boundaries and arithmetic reproducible. |
| Preservation alongside EcoLogits | [Modular refinement record](../../../release/MODULAR-REFINEMENT-STATUS.md) and [EcoLogits core review](../../../release/ECOLOGITS-CORE-INDEPENDENT-REVIEW.md). Added separate method identities, characterization fixtures, a port and explicit recalculation lineage. |

## What the research did not establish

- Visible text counts do not reveal all hidden reasoning, provider context, cache behavior or auxiliary work.
- The Original text surrogate has no explicit input-length term. More complete token accounting does not by itself make its energy equation input-aware.
- The highest estimate in a finite comparison cohort is not a physical upper bound or the actual model used by a provider.
- Carbon and water factors require compatible dates, populations, units and system boundaries. A reproducible conversion does not prove that a factor applies to an individual request.
- GPU-only image references do not establish complete provider-operation energy.
- Agreement between implementations demonstrates arithmetic consistency, not measured real-world accuracy. Native browser compatibility and release readiness need separate evidence.

Research-only coefficients and rejected alternatives remain excluded from automatic selection. Future contributors should record new evidence and a new method version rather than overwrite historical conclusions or relabel preserved results.
