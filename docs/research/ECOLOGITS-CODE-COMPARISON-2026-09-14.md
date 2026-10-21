# App calculations compared with EcoLogits 0.11

Reviewed 14 September 2026 against the current working tree, including existing uncommitted history and presentation changes. Git HEAD: `15515fd`. This is an analysis of implemented behavior, not a claim that a released extension or a particular installed browser build was verified. Product code was not changed for this audit.

**Finding:** the app implements a restricted, assumption-based adaptation of EcoLogits' operational text equations. The six regression coefficients and the hardware allocation arithmetic match the pinned source. Model selection, latency selection, environmental scenario selection, water-total eligibility, reasoning coverage and impact scope differ. There is no evidence here that our estimates are physically more accurate than EcoLogits.

The reviewed packaged default is `ecologits-reference-2026-09-10-v1`, equation `ecologits-output-v1`, with canonical bundle hash `7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9`. Signed method updates and explicitly selected recalculations can change a deployment's method. The results below describe this packaged default.

The named methodology is **EcoLogits**. Its rendered [introduction](https://ecologits.ai/0.11/methodology/), [LLM methodology](https://ecologits.ai/0.11/methodology/llm_inference/), [proprietary-model methodology](https://ecologits.ai/0.11/methodology/proprietary_models/) and [video methodology](https://ecologits.ai/0.11/methodology/video_generation/) were read in the Codex in-app browser. Exact constants and implementation behavior were checked against immutable upstream source at commit `886d1ebfadb51a2d6407fcea6d9778c997c85c35`, the EcoLogits 0.11.1 snapshot named by our bundle.

**What supplies the numbers**

The live path is provider adapter → captured text and operation metadata → local tokenizer → numerical attempt record → shared estimator → compatible totals. The server implements the same equations in Python. Imported visible history uses those text equations separately, without claiming to have observed the original execution.

| Component | Implemented calculation or rule | What it actually establishes |
| --- | --- | --- |
| New input text | `N(s) = countTokens(s)` using the packaged encoding. The live worker defaults to `o200k_base`. | Count of observed text under a reference encoding. No model-specific validated tokenizer selection currently occurs. |
| Answer output | `N(assembled answer text)`. Captured snapshots replace previous revisions. | Newly observed answer text, not necessarily complete provider output. Full-text tokenization avoids treating stream chunks as tokens. |
| Visible thinking | `N(assembled thinking text)`, separately stored as `visible_thinking`. | The inspected Claude adapter extracts thinking blocks. ChatGPT explicitly returns no thinking text; the other inspected live adapters leave it unknown. Visible thinking is not hidden reasoning telemetry. |
| Logical input/context | `I_t = new_input_t + parent_context`; then `context_t = I_t + answer_t`, when the required parent record is available. | A partial branch reconstruction. It does not recover hidden system instructions, exact provider message framing, cache reuse, compaction or document selection. |
| Cumulative token totals | Sum compatible current attempt counts for each token field separately. | Reused old context may be counted again in logical input for later executions. It is not new output. New-input totals and logical-input totals remain different quantities. |
| Extracted document text | `N(extracted or observed inline file text)`; sums by compatible extraction/tokenizer group. Also counts available pages, text parts and bytes. | Separate, non-additive file-text evidence. It is not automatically added to the main input total or energy calculation. OCR, image encoding, retrieval selection and provider processing are not calculated. |
| Cache, tool and image token fields | Schema has `input_uncached`, cache read/write, `reported_reasoning`, `output_total`, tool input/output and image input/output fields. Current live capture does not populate these verified numerical categories. | Their existence in a schema does not mean they are measured. Unknown values stay null. No generic cache discount or reasoning multiplier exists. |
| Energy work unit | Use `output_total` if non-null, otherwise `answer_output`; require positive output and execution evidence. | Current live capture normally supplies answer output only. The estimator does not add `visible_thinking` or `reported_reasoning` separately. |
| Search operations | Counts observed supported tool-operation identities; e.g. Claude uses distinct `web_search` block IDs and ChatGPT counts recorded assistant messages addressed to `web.run`. | An observed operation count, not a complete count of backend searches. No search-energy coefficient is applied. |
| Generated images | Count identified image operations and returned outputs. Requested, returned, completed and unknown counts are distinct. | The inspected ChatGPT adapter supplies image-operation evidence. Downloads, thumbnails and requested count alone are not generated-image energy. |
| Request and attempt totals | Count canonical request records and executed attempt records separately; sum current revisions, excluding reconciled aliases. | Regeneration or retries can create additional work. Upload retries and stream snapshots must not become new consumption. Partial output can contribute even if the attempt was cancelled or failed. |
| Imported history | Apply the text equation to positive-token response messages; prompt messages have no energy contribution. Confirmed matches to live activity are excluded. | Partial footprint of loaded visible responses. Missing historical executions and hidden work are unknown. |
| Combined extension summary | `live requests + unmatched historical prompts`; compatible live and historical numerical components are summed. | A provisional presentation. Unresolved overlap is labeled “Matching incomplete”; this is not a proven full historical execution count. |
| Context guidance | `ratio = reconstructed context / advisory budget`. Notify above 50%; higher level above 80%; re-arm at or below 45%, with cooldown/dismiss/snooze rules. | Product guidance, not an environmental equation. The implemented Claude fallback budget is half a recorded reference window. That 50% allowance is a planning choice. |
| Organization analytics | Sums and distinct counts by permitted date, provider, model, user and device scope. Network data describes the upload connection and its receipt time. | Activity/accounting statistics. Employee IP is not an input to the environmental scenario. |

Code: [tokenizer](../../packages/tokenizers/src/index.ts), [counting worker](../../apps/extension/lib/count.worker.ts), [provider adapters](../../packages/adapters/src/), [coordinator](../../apps/extension/lib/coordinator.ts), [file extraction](../../packages/file-text/src/index.ts), [file totals](../../apps/extension/lib/file-text-summary.ts), [summary accumulator](../../apps/extension/lib/summary-scan.ts), [history estimator](../../packages/estimator/src/history.ts), [combined presentation](../../apps/extension/lib/history-presentation.ts), [context guidance](../../apps/extension/lib/context.ts), [server analytics](../../apps/server/aift/analytics.py).

**Exact operational text formulas**

Notation: `n` is the selected output-token count; `Pa` and `Pt` are active and total parameters in billions; `B` is batch size; `g` is allocated GPU count. Energy below is in kWh unless explicitly labeled otherwise. `t` is seconds. The default assumes 16-bit weights, 80 GB per H100 GPU, batch 64, 1.2 kW non-GPU host power and eight GPUs per reference server.

| Calculation | App formula | EcoLogits comparison |
| --- | --- | --- |
| Required memory | `memory_GB = 1.2 × Pt × 16 / 8` | Same. The memory multiplier is not a cooling-energy multiplier. |
| GPU count | `g = next_power_of_two(ceil(memory_GB / 80))`, minimum 1 | Same for the admitted positive model sizes. |
| Single-GPU energy per output token | `e_Wh = aE × exp(bE × B) × Pa + cE` | Same regression and exact coefficients. |
| Total GPU electricity | `E_GPU = n × e_Wh × g / 1000` | Same. No additional division by batch size; batch is already represented in the fitted GPU equation. |
| Latency | `t = n × (aL × Pa + bL × B + cL)` | Only EcoLogits' regression fallback, without its request-duration cap or throughput/first-token override. |
| Non-GPU host electricity | `E_host = (t / 3600) × 1.2 × (g / 8) / B` | Same allocation formula. Different latency can change the result substantially. |
| IT electricity | `E_IT = E_GPU + E_host` | Same. |
| Facility electricity | `E_facility = E_IT × 1.09` | Same PUE equation, but one fixed Cohere/USA scenario is applied to all observed providers. |
| Electricity-related carbon | `C_g = E_facility × 384.4` | Same as EcoLogits' **usage** GWP for the same factors, with kg converted to grams. It is not EcoLogits' usage-plus-hardware total. |
| Direct water | `W_direct_L = E_IT × 0.999` | Same IT-energy denominator. |
| Electricity-supply water | `W_supply_L = E_facility × 3.1321` | Same facility-energy denominator. |
| Combined water | `W_total = W_direct + W_supply` only when source categories and common consumption scope are compatible; otherwise null | EcoLogits adds the two components: `E_IT × (WUE_direct + PUE × WUE_supply)`. Our packaged baseline refuses the sum because direct source category is unknown. |

Exact coefficients from [baseline.json](../../packages/estimator/data/baseline.json), checked against the [upstream kernel](https://github.com/mlco2/ecologits/blob/886d1ebfadb51a2d6407fcea6d9778c997c85c35/ecologits/impacts/llm.py):

```text
aE = 0.0000011665273170451914
bE = -0.011205921025579175
cE = 0.00004052928146734005
aL = 0.0006785088094353663
bL = 0.0003119310311688259
cL = 0.019473717579473387
```

Implementation: [text.ts](../../packages/estimator/src/methods/text.ts), [environment.ts](../../packages/estimator/src/methods/environment.ts), [Python implementation](../../packages/estimator/python/footprint_estimator.py).

The environmental function also accepts facility-energy inputs: it preserves supplied facility energy and divides by PUE to recover IT energy only when PUE is available. It does not apply PUE twice. Direct water can use an explicitly specified facility denominator for another compatible scenario. These are supported function branches, not the packaged text baseline's starting boundary.

The baseline records carbon as location-based electricity-lifecycle CO2e. This electricity supply-chain boundary is distinct from manufacturing the AI servers, which the app excludes. Original factor vintages and the exact pinned CO2e methodology remain unresolved in the metadata. The baseline marks electricity-supply water as all-source consumption and direct water source as unknown. It does not justify a freshwater-only total. These metadata limitations are not evidence that the literal factors are numerically false.

**Selection and actual numerical behavior**

The current estimator evaluates all four profiles for the same output count and environment, selects the largest IT result and keeps its full environmental vector. With a shared positive PUE this is also the largest facility result. It does not select a different profile based on an observed ChatGPT, Claude, Gemini or Perplexity model. Its result always says `highest_comparable` for usable text; the `matched_profile` result type is not an implemented default selection path.

| Profile | Active / total billions | Allocated GPUs | Facility Wh for 1,000 output tokens |
| --- | ---: | ---: | ---: |
| Llama 3.1 8B | 8.03 / 8.03 | 1 | 0.081013329 |
| Llama 3.1 70B | 70.55 / 70.55 | 4 | 0.599680243 |
| Command R+ 08-2024 | 104 / 104 | 4 | 0.747148584 |
| Command A 03-2025 | 111 / 111 | 4 | 0.778008925 |

Command A wins for every positive output count in this fixed baseline because every candidate result is linear in `n`. Consequently:

```text
Electricity_Wh ≈ 0.0007780089248751 × n
Carbon_gCO2e ≈ 0.000299066630722 × n
Direct_water_mL ≈ 0.000713055886193 × n
Electricity_supply_water_mL ≈ 0.002436801753601 × n
Combined_water = unavailable
```

For 1,000 output tokens the app returns approximately **0.778 Wh, 0.299 g CO2e, 0.713 mL direct water and 2.437 mL electricity-supply water**. Input length, separately counted thinking, cache fields, tool tokens and recognized provider/model identity do not change those values. Doubling the selected output count doubles the unrounded footprint.

This means provider comparisons currently describe output volume under a common proxy. They do not establish which real AI service is more energy efficient. A finite reference maximum can still underestimate a larger deployment or overestimate a more efficient one.

EcoLogits normally selects the registered model's architecture and provider configuration. For proprietary models it uses disclosed assumptions and, for some models, parameter ranges. Unregistered models produce an error instead of our finite-cohort fallback. See [selection code](https://github.com/mlco2/ecologits/blob/886d1ebfadb51a2d6407fcea6d9778c997c85c35/ecologits/tracers/utils.py) and [proprietary methodology](https://ecologits.ai/0.11/methodology/proprietary_models/).

There is a concrete latency difference even for our chosen proxy. The pinned EcoLogits [Command A record](https://github.com/mlco2/ecologits/blob/886d1ebfadb51a2d6407fcea6d9778c997c85c35/ecologits/data/models.json) supplies `TPS = 26.8` and `TTFT = 0.59 seconds`. With 1,000 output tokens and no binding request-duration cap:

- App regression: `t = 114.751781 seconds`; facility electricity `0.778008925 Wh`.
- EcoLogits deployment path: `t = 0.59 + 1000/26.8 = 37.903433 seconds`; facility electricity `0.559871685 Wh`.

The GPU equation is unchanged; host allocation causes this difference. This is a matched-assumption arithmetic comparison, not a physical experiment or proof that either latency represents a consumer service.

**What is different, why it was chosen, and whether it is better**

“Documented” below means the reason is explicitly recorded in the project. “Assessment” is this audit's interpretation, not a recovered author intention.

| Area | Difference from EcoLogits 0.11 | Reason and assessment |
| --- | --- | --- |
| Browser token evidence | Our default counts observed text with one reference encoding. EcoLogits uses provider API usage where supported; behavior varies by tracer. | Documented: consumer websites do not expose a verified full usage report in the project's inspected evidence. Good for local browser coverage and avoiding fabricated telemetry; usually weaker than a correct provider-reported count. |
| Thinking/reasoning | Our live energy excludes separately counted thinking. EcoLogits' Google tracer explicitly adds candidate and thought token counts. | Documented: visible thinking may be a summary and must not be confused with hidden reasoning or double-counted. Assessment: careful scope labeling is useful, but the current energy result is narrower. It is not an accuracy advantage. |
| Proprietary models | Fixed reviewed open-model cohort and maximum, rather than EcoLogits' model-specific architecture hypotheses. | Documented: avoid importing unreviewed proprietary parameter assumptions; keep unknown-model estimates useful. Better traceability of the proxy, not proven lower error. |
| Latency | Always uncapped benchmark regression; no OpenRouter deployment timing selection. | Documented reference strategy. Assessment: keeps the benchmark scenario consistent and reproducible. No evidence that it is more realistic than applicable measured serving statistics. |
| Environmental scenario | The same Cohere/USA factors for all four providers, rather than provider PUE/WUE and selected country factors. | Documented: a named reference scenario, not a claim to know serving location; do not use employee IP. Transparent, but loses real provider and geographic variation. |
| Input length and caching | No input-length or cache term in energy. EcoLogits' LLM GPU kernel also lacks an input-length variable. | Documented: the context research did not establish a transferable, validated numerical replacement. This preserves a known limitation; it does not show input processing has no cost. |
| Water sum | More restrictive compatibility gate; baseline total is unavailable. | Documented: avoid combining unknown or different source-water definitions into an unqualified total. Better protection against an unsupported label; not evidence that EcoLogits' arithmetic is wrong. |
| Hardware impacts | App excludes AI hardware extraction/manufacturing/transport. EcoLogits allocates them by hardware lifetime and request time. | Documented operational-only boundary. A narrower product scope, not a scientific improvement. EcoLogits covers more of the footprint. |
| Minerals and primary energy | App has no ADPe or PE calculation. EcoLogits reports both usage and hardware components. | Outside the app's selected electricity/carbon/water scope. Our electricity in Wh is not EcoLogits' primary energy in MJ. |
| Uncertainty | App returns partial/unvalidated labels; `scenario_low` and `scenario_high` are null. EcoLogits can propagate parameter and environmental ranges. | Honest absence of numerical confidence claims, but less quantitative uncertainty information. Neither a range nor a maximum alone establishes measured coverage probability. |
| Images | Our separate ML.ENERGY benchmark references are not an EcoLogits image method. EcoLogits 0.11 lists image generation as upcoming. | Documented first-release image scope and GPU-only evidence. Additional reference coverage, not a validated consumer image footprint. |
| Video | App has no video-energy equation. EcoLogits 0.11 implements video generation with model-specific latency and whole-machine power. | Not part of the implemented estimator. Model catalog recognition is not calculation support. |
| Totals/history | App adds browser bookkeeping, deduplication, partial historical reconstruction and compatible series. | Product-specific accounting. It can improve the usefulness of recorded activity without fixing the energy model's physical limitations. |
| Training, employee device/network, end-of-life | App excludes these. EcoLogits' stated inference scope also excludes training, networking and user devices; end-of-life is not covered. | Similar scope exclusions, not a unique advantage. Neither is a complete lifetime footprint of using AI. |

Documented rationale: [methodology specification](../implementation/METHODOLOGY-AND-MULTIMODAL-SPEC.md), [quality gates](../implementation/METHODOLOGY-QUALITY-GATES.md), [context research decision](CONTEXT-AWARE-ENERGY-RESEARCH-2026-09-09.md), [estimator README](../../packages/estimator/README.md). This audit uses these documents as evidence of project decisions; it does not independently revalidate every alternative research study cited inside them.

For token behavior, see EcoLogits' [Google tracer](https://github.com/mlco2/ecologits/blob/886d1ebfadb51a2d6407fcea6d9778c997c85c35/ecologits/tracers/google_genai_tracer.py) and [OpenAI tracer](https://github.com/mlco2/ecologits/blob/886d1ebfadb51a2d6407fcea6d9778c997c85c35/ecologits/tracers/openai_tracer.py). Do not claim all EcoLogits streaming counts are exact: the inspected legacy OpenAI Chat Completions streaming path increments a counter for qualifying chunks, while its Responses streaming path uses terminal usage. Our assembled-text approach avoids the former assumption but still has an unverified tokenizer-to-model mapping.

EcoLogits' additional LLM impact formulas, not implemented by the app, are:

```text
For impact X in GWP, ADPe or PE:
  Hardware_X = (g / 8) × host_embodied_X + g × GPU_embodied_X
  Request_embodied_X = t × Hardware_X / (64 × lifetime_seconds)
  Request_total_X = E_facility × electricity_factor_X + Request_embodied_X
  lifetime_seconds = 3 × 365 × 24 × 3600
```

The pinned host/GPU values are respectively 5,700/273 kg CO2e, 0.37/0.00895 kg Sb equivalent and 70,000/3,721 MJ. EcoLogits does not estimate embodied water. Source: [LLM kernel](https://github.com/mlco2/ecologits/blob/886d1ebfadb51a2d6407fcea6d9778c997c85c35/ecologits/impacts/llm.py).

EcoLogits' video method uses `E_facility = PUE × power_kW × latency_seconds / 3600`. Latency comes from a model-specific polynomial in resolution and frame count, capped by request time when available. It assigns the selected whole machine to the request without the LLM batch allocation, and separately allocates embodied impacts. We adopt none of those video equations. Source: [video methodology](https://ecologits.ai/0.11/methodology/video_generation/).

**Image reference details**

`E_image_GPU_kWh = returned_image_count × selected_J_per_image / 3,600,000`.

Selection filters 208 candidates by known width, height, steps and precision, admits text-to-image operations, then takes the largest compatible joules-per-image record. Those joules already include the benchmark's per-image allocation. The app does not multiply by GPU count or divide by batch again.

The cohort contains FLUX.1-dev and HunyuanDiT measurements at 1024 × 1024, 50 steps and bfloat16, on H100/B200 configurations. With unspecified settings, the maximum was an eight-B200 FLUX.1-dev benchmark configuration, not a measured ChatGPT image. (Note of 20 October 2026: the cohort was removed on 20 October 2026 because the ML.ENERGY leaderboard repository it came from has no licence, and its figures are no longer quoted in this repository.) Zero/unknown returned count after execution, incompatible settings and image edits yield unavailable reference energy. No arbitrary pixel or step scaling is implemented.

Image GPU references remain outside ordinary text electricity/carbon/water totals; no image carbon or water expansion is called by the current estimator. See [image selection](../../packages/estimator/src/index.ts) (removed on 20 October 2026), [pinned FLUX data](https://github.com/ml-energy/leaderboard/blob/5d899ea5a1c8934c0eff691df2b731d20490bb2a/public/data/models/black-forest-labs__FLUX.1-dev__text-to-image.json), [pinned HunyuanDiT data](https://github.com/ml-energy/leaderboard/blob/5d899ea5a1c8934c0eff691df2b731d20490bb2a/public/data/models/Tencent-Hunyuan__HunyuanDiT-v1.2-Diffusers__text-to-image.json).

**Verification and limits**

- Read the actual runtime TypeScript, Python server equations, token/capture paths, history estimators, summary reducers, baseline data and project decisions. Checked the rendered EcoLogits methodology rather than relying on scraped formula text.
- Retrieved the immutable upstream kernel, provider settings, model registry, electricity factors and relevant API tracers directly. All six regression constants match exactly. The pinned provider code uses direct WUE **0.999**; the LLM web table displays **0.99**. Our code follows the pinned literal, not the web table's displayed value.
- Executed the unchanged arithmetic bodies of selected upstream functions, without their DAG decorators or type annotations, against production TypeScript results for four profiles and five workloads: 1, 500, 1,000, 32,768 and 9,223,372,036,854,775,807 output tokens. All 20 cases agreed within `2.56e-16` relative floating-point difference. The huge case tests arithmetic, not scientific applicability.
- Checked the carbon kg-to-g conversion, direct/indirect water denominators, unchanged results when input/thinking/cache/tool fields or recognized provider identity change, and output-total priority. The current upstream deployment latency example was recalculated separately.
- Retrieved both original image JSON exports. Their parsed-payload SHA-256 hashes match the recorded source hashes. Every one of the 208 packaged joules, dimensions, steps and precision entries matches the corresponding upstream record.
- Ran **48 relevant existing tests; all passed**: 13 estimator/history/update tests, four tokenizer tests, and 31 selected context, summary, history-presentation, document-summary, image and measurement-verification tests. Estimator checks include TypeScript/Python parity.
- Numerical serialization uses 48 significant decimal digits for the main estimator and 18 decimal places in base units; totals use integer/fixed-decimal addition. Display rounding uses approximately three significant digits. Numerical precision is not physical measurement accuracy.

Commands run:

```text
pnpm --filter @footprint/estimator test
pnpm --filter @footprint/tokenizers test
node --import tsx --test apps/extension/test/context.test.ts apps/extension/test/summary.test.ts apps/extension/test/combined-usage.test.ts apps/extension/test/history-presentation.test.ts apps/extension/test/file-text-summary.test.ts tests/verification/measurement.test.ts tests/verification/live-image.test.ts
```

Independent audit scripts and raw public-source evidence were kept outside the repository in `%TEMP%/aift-ecologits-audit-2026-09-14/`: `check-app.mjs`, `check-upstream.py`, `check-images.cjs`, `app-results.json` and `independent-results.json`. No authenticated captures or employee content were used.

This is numerical/source verification, not new power-meter calibration, complete live-provider testing, a full application regression run or proof that the serving assumptions are true. The method itself remains `unvalidated_reference` with release validation pending.

**Documentation gap to resolve separately**

The public [worked example](../methodology/content.html) still shows `3.1498576 mL` total water and says a normal display would show approximately `3.1 mL`. That reproduces the historical arithmetic sum, but the current runtime returns null because the source-water compatibility condition is unresolved. The article's general water section does mention compatibility, yet the example's display claim does not state the runtime restriction. It should be qualified before being treated as a description of current app output. The reference helper in `tools/methodology-reference.cjs` also allows timing overrides and arithmetic water addition; it is not the production estimator. Prototype sample figures and research-only formulas are not additional live measurement methods.

**Assessment:** retain the benefits of explicit scope, provenance, local counting and careful aggregation, but describe the product as an EcoLogits-derived operational reference. Do not market it as more accurate, a complete environmental footprint, a guaranteed upper bound, or a measured ranking of AI providers. Improving those claims requires validated provider/workload applicability, fuller output evidence, relevant timing and environmental scenarios, and additional impact coverage.
