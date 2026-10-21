# Methodology evidence and validation contract

This contract supplements the operational, token, media and aggregation specifications. It incorporates the [Offset comparison](../research/OFFSET-COMPARISON-2026-09-09.md). It does not authorize copying unlicensed code, sending employee content to external counters, changing the operational-only boundary, or silently replacing historical coefficients.

## 1. Evidence classes and permissible claims

Use separate fields for evidence type, calculation correctness, applicability and validation state. Valid evidence classes are `provider_measurement`, `controlled_hardware_measurement`, `statistical_or_inventory_model`, `analytical_hardware_scenario`, `api_performance_plus_hardware_assumptions`, `first_party_assertion`, and `secondary_summary`. Preserve original wording of the source's statistic: mean, median, conditional simulation mean, scenario example or unspecified average.

An evidence catalog is not a runtime method bundle. [The new published-reference catalog](../../registry/published-reference-evidence-2026-09-09.json) has `runtime_selection_allowed=false`; its values are available for comparisons and candidate-source review, not automatic selection. Promotion requires a new approved, versioned bundle with all applicable boundaries, observations and tests. A newer source date does not automatically make a different population, gas boundary or task comparable.

Permissible states are:

- **Reference scenario:** reproducible assumptions and a useful, explicit scope. No claimed empirical accuracy for the consumer service.
- **Validated in-domain estimate:** energy error demonstrated on untouched compatible measurements; tokenizer/capture evidence independently established. State the tested domain.
- **Transferred estimate:** an in-domain method applied to an undisclosed/different serving system with remaining transfer uncertainty. Never silently inherit the original measured-error claim.
- **Provider-reported quantity:** meaning verified for that field; it does not certify unrelated hidden work or physical resources.

Reference estimates may ship with clear labels after functional, arithmetic, privacy and host-noninterference checks. They may not receive a calibrated badge or a percentage-accuracy claim without the requisite measurement evidence. This distinction keeps the initial product usable without presenting validation work as already complete.

## 2. Mandatory factor provenance

Every factor record must carry the following fields, with explicit `unknown`/null and a reason where unresolved. Missing fields are not inferred from a service brand or a library release date.

| Field group | Required contents |
| --- | --- |
| Source identity | Author/publisher, title, exact URL, page/table/section, revision or content hash, license/reuse status, access date |
| Time | Activity period, underlying factor-data period, publication date, software snapshot, review/expiry date; keep distinct |
| Population | Geography, modeled/measured facility or grid population, weighting, workload/model and hardware where relevant |
| Electricity | Starting GPU/IT/facility boundary, included host/idle/facility components, energy versus power, per-request or per-token/image work unit |
| GHG | CO2 versus CO2e; included gases; GWP method/time horizon when supplied; generation versus lifecycle; location versus market accounting |
| Direct water | Consumption versus withdrawal; freshwater versus all-source/unknown; IT versus facility energy denominator; cooling population/season |
| Electricity water | Consumption/withdrawal; source-water categories; hydro/reservoir allocation; imported-electricity treatment; fuel/upstream inclusions and exclusions |
| Derivation | Original rounded number/unit, conversion, assumptions, eligible uses, prohibited substitutions, unresolved source gaps |

Keep factor compatibility separate from unit convertibility. CO2 and all-GHG CO2e are not silently interchangeable because both can be expressed in grams. A generation-only factor is not a full lifecycle factor. Mixed freshwater/all-water definitions require an explicitly labeled compatible covered scope, or separate components without an unexplained total. Emissions and water need not cover identical upstream processes, but those differences must be disclosed rather than implying one complete lifecycle boundary.

The existing 384.4 g and 3.1321 L library references remain exactly reproducible, with their original-vintage gaps. The new LBNL 4.52 L/340 g pair is a historical electricity-supply reference with a different emissions boundary and unresolved exact factor vintage. Direct water remains unavailable in that reference until its aggregation is reconciled. Do not complete its total using an unrelated cooling factor by default.

## 3. Starting energy and PUE

Before calculating, check a discriminated starting boundary:

- `gpu`: preserve GPU scope; host and facility allocations need explicit assumptions. PUE alone does not turn GPU energy into measured total IT energy.
- `it`: apply a compatible PUE once to obtain facility energy.
- `facility`: use directly, without another PUE. Recover IT only through compatible evidence.
- `unknown`: do not infer GPU/IT from the fact that the source mentions an AI model. Keep the reference separate from request-specific environmental calculations unless a reviewed assumption explicitly resolves the boundary.

Google's May 2025 production value and Epoch's February 2025 scenario already include facility overhead. Altman's original 0.34 Wh statement does not disclose its boundary. These are regression fixtures for boundary selection, not runtime per-query defaults.

For direct WUE defined per facility energy, use `W_direct = E_facility × WUE_facility`. For direct WUE defined per IT energy, use `W_direct = E_IT × WUE_IT`. An unqualified `L/kWh` field is insufficient. Unknown water is not zero.

## 4. Measured validation before promotion

Freeze the evaluation design before evaluating the holdout. Use licensed public/synthetic workloads and instrumented open systems; retain dataset hashes and avoid overlapping prompts, templates or measurements between fitting and holdout. Preserve the existing at-least-25% untouched token holdout requirement; report how energy validation splits are grouped by workload and hardware rather than treating correlated batch samples as independent.

Each energy observation needs measurement-boundary documentation, hardware configuration, workload input/output and media settings, cache/warmup conditions, sampling interval, measurement resolution, repetitions and treatment of idle/host/facility energy. A model-generated estimate from Jegham, Epoch or another calculator is not a measured target. Closed-provider transfer error remains unknown unless suitable independent measurements become available.

Evaluate, on the same holdout:

1. A simple per-request baseline estimated from training data only, not a copied provider median.
2. The current output-token surrogate with the same accounting boundary.
3. Any candidate input-aware, cache-aware or multimodal method.

Report at least:

```text
error_i = predicted_energy_i - measured_energy_i
MAE = sum(abs(error_i)) / number_of_valid_measurements
signed_bias = sum(error_i) / number_of_valid_measurements
aggregate_relative_error = sum(error_i) / sum(measured_energy_i)
absolute_relative_error_i = abs(error_i) / measured_energy_i
```

Relative measures require a positive denominator above the documented measurement quantification limit. Values at/below that limit remain explicitly censored or unsuitable for relative-error scoring; do not introduce an arbitrary tiny divisor. Publish absolute-unit errors as well as relative results. Keep model bias separate from run-to-run variability and conditional simulation spread.

Report results by input length, output length, short/long context, cache state, reasoning mode, language/content group, model/hardware and modality. Improvements averaged across easy cases cannot hide a critical long-context regression. Choose a candidate only within the subdomains where a predeclared comparison demonstrates acceptable error and improvement; restrict its applicability elsewhere. No universal energy-accuracy percentage is prescribed without a representative validation corpus.

Token validation is a separate gate. Official-encoding parity or measured substitute error on untouched text does not prove complete request capture. Likewise, a physically measured batch energy does not reveal hidden consumer-service tokens. Keep these evidence records independent.

## 5. Fallback, interpretation and aggregation

Retain the user-selected highest-comparable rule, but require complete comparison signatures, eligibility rationale, approved cohort hash and validated factor-bundle identities. Equal scenario-name strings do not prove that supplied carbon/water vectors are coherent. The server calculates the vector from the accepted bundle; it does not trust caller-supplied results. Reject conflicting factors under one immutable scenario identity.

The present four-model, fixed-setting fallback is linear in observed output tokens. Under that specific reference, changing only input length does not change energy. Details must state that the method does not explicitly model extra input/context work. Do not add input tokens to the output-token coefficient, assign hidden reasoning a fixed multiplier, or infer energy savings from a smaller context gauge.

An attributed footprint is an allocation of modeled resources to recorded activity. It is not necessarily the marginal change caused by adding/removing that activity. Claims of avoided energy, carbon or water require an explicit counterfactual with equivalent outcomes, relevant human/device activity, retries, batching, caching and rebound considered. Do not borrow the entire human lifestyle allocation from a task-comparison paper to claim that this extension saves that footprint.

Per-tool totals describe recorded usage under declared assumptions. They do not establish intrinsic provider efficiency when workload, outcome quality, model, geography or capture coverage differ. Company purchasing decisions may use adoption and usage data, but environmental rankings need matched-task evidence. Finite cohort maxima and heterogeneous literature ranges are not confidence intervals.

## 6. Implementation tasks and acceptance

| Gate | Required evidence |
| --- | --- |
| Q01 | Evidence catalogs with `runtime_selection_allowed=false` cannot enter automatic runtime factor selection |
| Q02 | Source mean/median/scenario/unspecified-average tags survive import, display and export; a median is not silently multiplied as an expected aggregate mean |
| Q03 | Google/Epoch facility references receive no second PUE; undisclosed Altman boundary stays unknown |
| Q04 | IT and facility direct-water denominators produce their respective formulas; ambiguous denominator is rejected or explicitly reference-only |
| Q05 | CO2 versus CO2e, generation versus lifecycle and location versus market factors never silently substitute for each other |
| Q06 | Water-source categories, consumption/withdrawal and upstream exclusions are preserved; incompatible components cannot produce an unqualified total |
| Q07 | Activity period, factor-data period, publication date and software version remain separate, including explicit vintage gaps |
| Q08 | LBNL electricity-supply reference retains unknown direct water; no synthesized complete water scenario |
| Q09 | Tokenizer/capture validation and held-out energy validation are independent promotion gates; equation parity/checksums cannot create a calibrated status |
| Q10 | Candidate energy methods beat or appropriately match the simple baselines in declared domains without hiding critical subgroup regressions |
| Q11 | Current reference's input-length insensitivity is correctly disclosed; no input-plus-output or fixed reasoning multiplier is introduced without validation |
| Q12 | Incoherent vectors under the same scenario ID/hash are rejected; accepted vectors are recomputed from immutable factors |
| Q13 | Usage allocations, tool shares and context tips do not become unsupported avoided-emissions claims or green rankings |
| Q14 | All pre-existing Fern v1 review anchors remain attached to their original elements; new public material is appended or explicitly migrated |

P0 adds evidence/provenance schemas; P3 supplies token/capture checks; P6 implements boundary/factor validation and held-out comparisons when suitable public measurements exist; P7 preserves compatible aggregation; P8 exposes the distinctions in Details and methodology. P10/P11 enforce Q01-Q14 and FM/IM according to evidence class. Q09-Q10 prohibit unearned calibrated labels or candidate promotion; they do not require paid experiments or inaccessible measurements to ship a functionally tested, explicitly unvalidated rough baseline. Record an unavailable comparison as unavailable, never passed. The reduced documentation tests verify only their named subsets, not these entire production requirements.
