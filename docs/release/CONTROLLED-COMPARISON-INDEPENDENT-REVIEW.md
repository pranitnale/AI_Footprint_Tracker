# Independent controlled-comparison review

15 September 2026. **Verdict: CLEAN for the recorded RL07 comparison-tool snapshot.** No actionable findings remain. This review verifies the offline native-policy and controlled-input comparison command, its fixture admission and generated reports. It does not establish physical accuracy, consumer-model calibration or whole-application release readiness. The earlier ledger and EcoLogits core reviews remain separate and unchanged; unfinished AR05 repository work is outside this review.

The reviewer changed no production source, accepted fixture, generated comparison report, commit or branch. Only this report was written in the repository. Independent scripts and output are under `%TEMP%/aift-controlled-comparison-independent-20260915/`.

## Scope and actual execution

Reviewed the implementation plan's section 13 and RL07, the comparison README, `controlled-comparison.ts`, `compare-engines.ts`, `comparison-fixtures.ts`, the tests and supplied fixtures, the generated JSON/Markdown pair, and the original/EcoLogits calculation paths they call. Checked branch HEAD `15515fdb70b196c04d72e48494d8a9bc8090a6eb` with Node 24.12.0 on Windows.

| Criterion | Result and evidence |
| --- | --- |
| Unchanged original mathematics | PASS. `textEnergy` and `environmentalAllocation` are called directly and are byte-identical to HEAD. No substitute equation or changed baseline coefficient is introduced. |
| Actual EcoLogits core and shared controls | PASS. Calls use `computeLlmImpacts` and its DAG. All nine core files match the accepted lock, catalog bytes match the declared hash, and core identity agrees with the lock. The mapped scalar inputs and independently recomputed raw outputs agree in every matrix case. |
| Common admitted domain | PASS. Four immutable scalar profiles, two explicit environments and validated decimal-string counts. Exact-safe binary64 counts are preserved; unsafe counts become unavailable without rounding. Extra parameters, arbitrary profiles/environments and malformed counters are rejected. |
| Native versus controlled behavior | PASS. The 19 native cases run seven explicit executor/policy variants. Seven supplied controlled cases are separately labeled and bypass provider/cohort selection. Controlled outputs are developer records, not registered production methods or saved product envelopes. |
| Units, phases and compatibility | PASS. Facility electricity, usage-phase lifecycle location-based CO2e and all-source upstream water have compatible arithmetic comparisons. Direct-water deltas are suppressed and total water remains unavailable. Original has no embodied counterpart; raw EcoLogits embodied values receive no cross-engine delta. |
| Deterministic offline reports and identities | PASS. Two fresh CLI runs have identical JSON and Markdown bytes, and both exactly reproduce the checked-in controlled report pair. Protocol, shared-input and output hashes verify. Instrumented network entry points record zero attempts. |
| Privacy and production separation | PASS for inspected code. Explicit synthetic numeric fixture paths are required; strict keys reject text and private-identity fields. No browser/profile/credential read, tokenization, network call or production comparison screen is introduced by these files. |

The actual shared mapping includes output tokens, active and total billion-parameter counts, precision, the 1.2 memory multiplier, GPU memory, power-of-two GPU allocation, batch size, host power, GPUs per server, energy/latency regression coefficients and uncapped timing with null TPS/TTFT. The original engine retains Decimal arithmetic; EcoLogits receives binary64 representations. Its null request latency becomes the existing internal infinity sentinel, which is not serialized as a numeric observation.

Both allocations use the same explicit PUE and water factors. Carbon is converted from grams per facility kWh to kilograms on EcoLogits input, then back to grams for comparison. Direct water remains per IT kWh and upstream water per facility kWh. The unity environment is explicitly synthetic. Baseline source dates, coverage gaps and unresolved factor details remain in the JSON provenance; numerical agreement is not evidence those reference assumptions describe a consumer deployment.

EcoLogits-only usage ADPe/primary-energy factors are visibly synthetic zero placeholders, outside the compared quantities. Its embodied defaults and full raw phases remain inspectable. The original's absent embodied phase and unavailable total water are not replaced with zeros. The mathematical zero-token case has null relative deltas with `zero_reference_value`, and is not presented as a physical zero-work measurement. Native scalar/midpoint deltas remain labeled as displayed-value comparisons, not interval subtraction or port-parity evidence.

## Independently executed checks

- Existing comparison tests: **8/8 PASS**, zero failures/skips. To respect the read-only repository boundary, the test was copied to the temporary evidence directory with only import locations and its CLI scratch directory relocated. Production modules and assertions were unchanged. `prepare-test.mjs` records that transformation; `package-tests.txt` records the run.
- `node node_modules/typescript/bin/tsc -p tools/refinement/tsconfig.json`: PASS.
- `independent-probes.mjs`: **64 matrix cases PASS** across all four profiles and both environments. Counts were 0, 1, 3, 500, 1,000,000, 9,007,199,254,740,991, 9,007,199,254,740,992 and 9,223,372,036,854,775,807. There were 48 computed cases and 16 explicitly unavailable cases outside the safe binary64 domain.
- The matrix independently constructed every EcoLogits input, recomputed its raw core output, called the unchanged original functions, verified allocation values, GPU branches, units and hashes, and confirmed the frozen baseline stayed unchanged. For nonzero comparable energy/carbon/upstream-water values, the largest absolute relative difference was approximately **2.91817e-16**, below the existing fixed `1e-10` test threshold. This describes only the sampled arithmetic.
- Eleven additional malformed/control-field shapes were rejected. The existing tests additionally cover zero/missing denominators, incompatible metrics, strict native fixture admission, policy selection and overwrite refusal.
- Fresh CLI outputs `regenerated-a.json/.md` and `regenerated-b.json/.md` are byte-identical to each other and to `tools/refinement/reports/engine-comparison-controlled-2026-09-15.json/.md`. Fetch, HTTP(S) request/get and socket connection entry points were instrumented to fail if invoked; **zero network attempts** occurred.
- `identity-check.mjs` verifies unchanged original source bytes, all nine locked core files, catalog hash and matching core identity. The report's preferred JOSS citation fields agree with the retained `CITATION.cff`.

Machine-readable results are in `independent-results.json`, `identity-results.json` and `source-hashes.json`. No expected production outputs were regenerated or overwritten. The existing EcoLogits Python-oracle review remains the separate cross-runtime parity evidence.

## Recorded source and artifact boundary

| File | SHA256 |
| --- | --- |
| `tools/refinement/controlled-comparison.ts` | `661115de5638d01e521cd1e7a4888b0e93e5c7a6aa00a68f7511497e9b0d6118` |
| `tools/refinement/compare-engines.ts` | `2ae4984dbf029a5c8ffb0265220c13e387e41bedfcd2f1e33cd8dbbf94be4f38` |
| `tools/refinement/comparison-fixtures.ts` | `5d9cc5361707b6ba6230c2f711a3a78f211b1ed19585861fa678d515b62a3057` |
| `tools/refinement/test/compare-engines.test.ts` | `3e32cd7b53470ae77f7045b13051f9096b21281df78872782f4ae5d91553ff27` |
| `tools/refinement/fixtures/engine-comparison.json` | `8efed83d99c25fe4cb29b209a8e827b3fef2ae6bd77c1a3bb5594c757499a13e` |
| `tools/refinement/reports/engine-comparison-controlled-2026-09-15.json` | `3ebbd4b29fd2239b5aab416da1d84b06da5e7a4bd469302f3e447f110973e577` |
| `tools/refinement/reports/engine-comparison-controlled-2026-09-15.md` | `16dd3e8bf114cde4071938370b9929b9dabbc9d3466faebbf2f6bb4d190f4786` |
| `packages/estimator/src/methods/text.ts` | `fefd81357782bd5413f683af54d94935646c9da082a99f9b77f48ea7f0706686` |
| `packages/estimator/src/methods/environment.ts` | `05cffa87b77f95eb7bbab6c9d19e1743c5a92b786e5241db411de57944ccd4ff` |
| `packages/ecologits-core/src/llm.ts` | `3e2ac14576757e40870a425b038c202892d8a3952466657e426d5c8fcf78d1e9` |

Original method hash: `7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9`. EcoLogits identity: `0.11.1-port.2`, core hash `c5f61cfea5a3b6f6fb36ea5faf0b8ef2910b6c2fd25e295748bf80bc547aa810`, catalog hash `3573ccc5995257c4a4d1a0d07b5c3a120f058eea6c84e002c6566023b2dcccc6`.

This is bounded RL07 evidence for the inspected offline command and artifacts. Future source or fixture changes require review against this boundary. It does not approve a fallback on the basis of its larger/smaller estimate, prove accuracy on real hardware, or replace browser, server, storage and release checks.
