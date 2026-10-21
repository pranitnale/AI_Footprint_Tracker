# Context-aware energy estimates for AI conversations

## Executive assessment

Credible research supports making energy estimation sensitive to input length, generated output, retained context, batching and cache reuse. It also supports estimating each execution and then adding compatible execution estimates into a conversation total. Counting the final visible transcript once is not a substitute for that accounting.

A ready numerical replacement that can be shown to improve long-conversation estimates for Claude.ai, ChatGPT, Gemini and Perplexity was not established. The strongest compact published coefficient set is restricted to small open models and short-to-medium inputs. More comprehensive predictors need model, hardware and serving information or fitted assets that are not available for these consumer services. Better scientific structure and a small published fitting error do not establish lower error after transfer to an undisclosed deployment.[^1][^2][^3]

The recommended decision is to **retain the current numerical reference settings, with their explicit limitations**, while adopting the context-aware input contract, replaceable-method architecture and public-data evaluation procedure described below. Published candidate equations belong in a separate research comparison until their applicability is established. This is not a requirement for perfect information before using estimates: a clearly specified assumption-based scenario can be useful. It is a requirement not to present a mismatched or unvalidated replacement as an accuracy improvement.

The implementation plan now explicitly requires localized formula updates. Coefficients and provenance are immutable versioned data, equations are small pure methods, and callers use one shared result interface. The current TypeScript/Python design still requires cross-runtime parity; it does not require separate arithmetic inside each provider adapter or screen. No paid hardware experiment, new provider generation or paid dataset purchase is part of this recommendation.

## 1. Plain-language explanation

A chat creates work over time. On a later turn, earlier answers can become input to the next answer. However, the provider may reuse previous processing, summarize older messages or retrieve only some document content. The visible transcript, the input used for a particular answer, and cumulative usage therefore describe different things.[^4][^5]

For illustration, suppose each new user message and each new answer contains 500 tokens, all previous messages remain in context, and there is no extra system or tool content:

| Execution | Input for this execution | Newly generated output | Input plus output |
| --- | ---: | ---: | ---: |
| First | 500 | 500 | 1,000 |
| Second | 1,500 | 500 | 2,000 |
| Third | 2,500 | 500 | 3,000 |
| Cumulative | 4,500 | 1,500 | 6,000 |

The final visible transcript contains 3,000 tokens. Cumulative logical usage is 6,000. Neither number alone determines electricity. Reused context may avoid some processing, but generating the answer still accesses context-dependent state. Counting an earlier answer as input on a later execution is legitimate; counting it again as newly generated output is not.

The existing energy baseline changes with output length but has no explicit input-length argument. In this example, with all other reference settings fixed, its three energy contributions are equal. A suitable input-aware model can produce different contributions despite equal output lengths. That is the desired improvement; the conversation summation itself does not need replacing.

## 2. Quantities the estimator needs

For execution t, define:

- I_t: logical input used for that execution, or a clearly labeled reconstruction of the retained active branch.
- O_t: newly generated output under its observed or reported scope. A visible reasoning summary is not the hidden reasoning total.
- C_t: input tokens whose computed prefix state was actually reused, when that is exposed with verified semantics.
- U_t: newly processed input, equal to I_t minus C_t only where those fields form a verified partition.
- h_t: a declared model, hardware, precision, engine, batching and environmental scenario.

An interface accepting these fields must not imply that every method uses them. Each method declares its required inputs, optional inputs, ignored inputs and scope. Missing cache information remains unknown, not a measured zero. A developer API's token categories and cache policy are not automatically the consumer website's categories and policy.[^4]

The existing browser audit found no verified complete input/output usage report in its inspected samples. In several follow-up requests, the browser sent a new prompt plus conversation references, not the complete model input. Provider-held system instructions, retrieval, compression and hidden work remain separate uncertainties. Input reconstruction can improve coverage, but it cannot establish what was processed internally merely because the page displays a long history.[^6]

Claude's own help material confirms automatic summarization of long conversations when code execution is enabled, while preserving the full chat history. Consequently, adding all visible history after compaction can overstate active context. A history load is useful for reconstruction, but is not itself a new generation or proof of unchanged context.[^5]

## 3. Scientific structure

The conceptual accounting is:

```text
E_IT,t = E_input(U_t, C_t, h_t)
       + E_generation(O_t, I_t, h_t)
       + E_cache_transfer_and_other_included_work(t, h_t)
       + E_allocated_nonoverlapping_host_and_idle(t, h_t)

E_facility,t = E_IT,t × PUE_t
E_conversation = sum of compatible E_facility,t contributions
```

This is an accounting decomposition, not a newly calibrated equation. Terms must describe disjoint work. If a source measures a complete GPU run, its result already includes the GPU work within that interval. If it measures facility electricity, another PUE is not applied. Host and idle terms are added only if absent from the starting boundary.[^7][^8]

Two dependencies are particularly important. First, new uncached input tokens still attend to a retained cached prefix, so input processing is not generally a function of U_t alone. Second, output generation still uses the retained context, so replacing I_t everywhere with U_t is wrong even when a cache hit is known. Within-response KV caching and reuse of a prefix across separate requests are related but distinct mechanisms.[^1][^4][^9]

A model need not calculate these phases separately to be useful. A jointly fitted function E(I,O,h) can predict total energy while reflecting their interactions. Its internal polynomial terms are not automatically independently measured phase energies. Conversely, naming two terms "prefill" and "decode" does not establish their numerical accuracy.

## 4. Candidate methods and adoption decisions

The error figures below are the authors' results for different tasks and evaluation designs. They are not comparable percentages of accuracy for Claude.

| Candidate | Useful contribution | Important limit | Decision |
| --- | --- | --- | --- |
| SweetSpot | Six published coefficients per model capture nonlinear input/output relationships. | Fitted on single-H100, TensorRT-LLM saturation workloads, 13 open profiles from 1B to 9B, each input/output length 64 to 4,096. No independent holdout was established from the inspected text. | Reproducible bounded research scenario, not a global Claude replacement. |
| From Prompts to Power | Joint model/workload/hardware predictor with a held-out model test, heterogeneous-batch test and a separate roughly 50K-input experiment. | GPU-only; main grid below 1,000 input/output tokens; predictor excludes batches of five or fewer and does not explicitly model quantization. Deployable trained assets and reuse terms were not recovered. | Strong candidate if suitable public assets become available. |
| EnergyLens, closed-form | Compact twelve-parameter formula for prefill, decode and parallelism/batch effects. | Coefficients need re-fitting on each target; no ready coefficient set was recovered. Configuration-ranking accuracy is not request-energy accuracy. | Good pluggable method template, not a coefficient download for Claude. |
| LLMCO2 | Learned architecture/kernel and hardware features, with explicit inference phase treatment. | Requires a graph/predictor pipeline and compatible assets. Published and repository versions need reconciliation. | Offline research candidate rather than a lightweight universal formula. |
| Microsoft AI energy simulations | Public analysis code combines input/output-dependent throughput with node-power and facility assumptions. | A scenario model, not measured provider electricity. Paper, data and source versions must be reconciled before reuse. | Useful independently reviewed comparison, not an automatic default update. |
| ACL energy-considerations study | Measured input/output/batch bins and explicit workload-dependent optimization effects. | Controlled sweeps reach 32K input, but the aggregate binning model excludes inputs above 8K and outputs above 512. | Supports an empirical lookup approach within its measured domain, not unlimited extrapolation. |
| Output-only EcoLogits reference | Reproducible current baseline and clear operational allocation. | Does not explicitly vary GPU energy with input length; benchmark-average input work can already be included in its fitted energy. | Retain as a disclosed baseline, not proof that context has no cost. |

Sources: SweetSpot; From Prompts to Power; EnergyLens; LLMCO2; Microsoft repository; Fernandez et al.; pinned EcoLogits methodology.[^1][^2][^3][^7][^10][^11][^12]

### 4.1 Stronger prediction evidence is available, but transfer remains unverified

From Prompts to Power reports Random Forest MAPE of 10.4842% on held-out Qwen2.5-14B measurements. It also estimates each member of heterogeneous batches, sums the predictions and compares with measured batch electricity, reporting 13.63% MAPE across 125 experiments. This directly supports execution-level estimates followed by aggregation within the tested setup. Those scores do not establish that every individual request has the same error, or that the predictor transfers to an unknown closed model.[^3]

The source includes a separate Phi-3 mini experiment with approximately 50,000 input tokens on two L4 GPUs. Its one-request result is 3.25 times the 300-input case. This is evidence that measured long-input studies exist; it is not a universal context multiplier. Its hardware, model, batch regime and relationship to the main predictor differ. A source's largest experiment must not silently become the validity range of every released or described predictor.[^3]

The paper links Carbon AI Extension, whose store listing is publicly accessible. Public installability does not establish that its trained model, source code or calibration dataset is available under a reusable license. The inspected paper, listing and developer website did not establish a ready open-source predictor for this project. No extension was installed and no vendor service was connected.[^13]

### 4.2 An input-aware formula can remain small

SweetSpot's equation can be written as a request-average GPU-energy expression:

```text
E_J(I,O) = θ0 O + θ1 I² + θ2 I O + θ3 I + θ4 O² + θ5
Wh = E_J / 3,600
```

I and O are input and output token counts. The six coefficients respectively have units J/output-token, J/input-token², J/(input-token × output-token), J/input-token, J/output-token² and J. This is an algebraic rewriting of the published per-output-token expression, not six new project constants.[^1]

For its Llama 3.1 8B profile, Table 5 publishes:

| Coefficient | Published value |
| --- | ---: |
| θ0 | 1.970934e-2 |
| θ1 | 3.329326e-7 |
| θ2 | 3.583505e-5 |
| θ3 | 1.551942e-2 |
| θ4 | 2.249613e-5 |
| θ5 | 8.939092e-1 |

Applying those coefficients to the three hypothetical input/output pairs above gives:

| Input | Output | Calculated GPU reference energy, J | Converted Wh |
| ---: | ---: | ---: | ---: |
| 500 | 500 | 33.17431735 | 0.0092150882 |
| 1,500 | 500 | 67.27712755 | 0.0186880910 |
| 2,500 | 500 | 102.04580295 | 0.0283460564 |
| Sum | | 202.49724785 | 0.0562492355 |

These are arithmetic evaluations of a published fit, using interpolation points within its length range. They are not measured individual turns, not a measured cached conversation, not facility totals, and not Claude estimates. Many digits are retained only so the calculation can be checked. They demonstrate that input sensitivity can be implemented with a small equation, without claiming that these particular coefficients are suitable for the product's full workload.

Do not use the polynomial at zero output, for interrupted prefill, above its length range or for an arbitrary cache-hit count and call the result validated. The source does not establish those cases. Also, a lower joules-per-output-token value can result from generating more output while total electricity increases. The footprint helper must not recommend unnecessary answers simply to improve that ratio.

### 4.3 Unjustified shortcuts to reject

- **One rate for input plus output:** useful as a crude baseline, not an empirically established universal physical conversion.
- **A fixed input/output ratio:** not portable across architecture, batch, context length and runtime.
- **A price discount as a cache-energy discount:** pricing does not measure joules avoided.
- **Browser elapsed time multiplied by GPU power:** browser time includes network, queuing, retrieval and display effects, while GPU count, power and sharing remain unknown.
- **EcoLogits multiplied by a normalized SweetSpot input correction:** normalization removes units, not differences in model size, runtime, batch, boundary and benchmark-average input cost. This would be a new unvalidated hybrid and may double count processing already represented in the baseline.
- **The highest published value as a guaranteed upper bound:** the configured cohort is finite and cannot cover all hidden work or deployments.

These rejections do not prohibit assumption-based estimates. They prohibit inheriting another method's validation claim after changing what the method means.[^1][^2][^7]

### 4.4 The Microsoft throughput approach

The released Microsoft analysis uses an input/output-dependent throughput fit and assumed node power. A compact, dimensionally explicit version of its baseline conversion is:

```text
E_facility_Wh = P_node_kW × PUE × O / (3.6 × TPS_total_output(I,O))
```

Here P_node is assumed steady-state IT power for the whole serving group. TPS is aggregate output throughput for that group, not an individual user's streaming speed. The verified NVIDIA source measures output tokens over the complete benchmark request interval, including local prefill and generation. Consequently, input length can affect energy through the throughput denominator without adding another input-token charge. This is a useful alternative to a separately fitted phase decomposition.[^11][^20]

The released April 2026 code is not a matching reproduction of the June paper. Their throughput tables, PUE ranges, power assumptions and input sensitivity expressions differ. The released sensitivity script adds I/30 to output length, whereas the inspected paper supplement says I plus O. Combining either added input term with throughput already measured over the complete request risks counting input processing again unless that change is explicitly reconciled and validated. The detailed audit records the exact differences rather than choosing one silently.

Original NVIDIA data give a useful, narrower result: for Llama 3.1 405B on H100 with eight-way tensor parallelism, output throughput at 2,000 output tokens is 3,661.85 tokens/second with 500 input tokens and 370.26 with 20,000 input tokens. At identical assumed node power, O/TPS implies roughly 9.89 times the energy allocation. Throughput is measured; the fixed-power energy ratio is an inference, not measured electricity and not a Claude multiplier.[^20]

This suggests a practical future reference profile using matched published model/hardware/input/output throughput points and explicit power assumptions. It does not resolve persistent prompt-cache reuse, serving power, hidden work or extrapolation to very long Claude contexts. The repository's MIT license permits software reuse with its notices; it does not certify the scientific applicability of its constants.[^11]

## 5. Cache evidence and uncertainty

The July 2026 study Attention to Detail directly evaluates prefix caching, attention backends and chunked prefill across multi-turn and other workloads. It includes assistant coding sessions, WildChat conversations and a LongBench subset with mean prompt length around 25,583 tokens. It therefore provides relevant measured evidence beyond short isolated prompts.[^14]

Its cache effects vary by model and task. One configuration increases energy with caching enabled; another differs despite no repeated prefixes, for which the authors suggest a memory-management explanation rather than verified cache-hit savings. The study acknowledges sensor bias and uses a particular offline vLLM setup. A single cache discount cannot be recovered from those results and assigned to Claude.[^14]

When the consumer app does not expose cache reuse, the practical alternatives are named scenarios, not invented observations. A no-prefix-reuse scenario may be compared with an explicitly assumed reuse scenario only if the selected energy method supports both. Their range is not a probability interval or guaranteed upper/lower bound. Unknown actual cache state must remain visible in Details. A source that models only ordinary uncached requests does not become cache-aware by inserting zero for the cached field.

Evaluate each complete conversation under a consistent scenario. Shared model/hardware assumptions should not be independently randomized for each turn merely to make the total's uncertainty appear smaller. Hidden reasoning, auxiliary execution and compaction remain separate coverage gaps, not random errors guaranteed to cancel with more requests.

## 6. What free public data can establish

Public data can support meaningful progress without purchasing GPU time. However, a calibration table must contain independently useful measurements, not merely values derived from the same formula being tested.

| Evidence asset | What is usable now | What is not established |
| --- | --- | --- |
| ML.ENERGY public leaderboard JSON | GPU operating-point comparisons and checks of energy/token, output length and allocated request-energy identities. | Input/cache features and independent per-request energy labels are absent from the inspected summary. Detailed data has a separate access gate. |
| SweetSpot Table 5 | CPU-only equation reproduction, unit checks and length-sensitivity comparisons. | Raw measured-grid contents and license were not inspected because artifact access failed; no new holdout result was obtained. |
| TokenPowerBench JSON | Small public run records and measurement requirements. | The inspected record has missing input/cache fields and inconsistent derived response/total metrics. It is not clean training data without repair and provenance review. |
| Attention to Detail replication record | An open archive is described with code, data and results. | Its internal record schema and request/cache joins were not inspected; no empirical cache coefficient was extracted. |
| Phase-level A10 study | Published input/output and phase comparisons. | The linked replication repository is expired, so an independent raw-data evaluation was not reproduced. |

The detailed measurement audit records exact fields, file revisions, arithmetic identities and retrieval limitations. A failed retrieval does not prove the data does not exist; equally, a dataset link does not prove that the required usable labels have been recovered.[^15][^16][^17]

GPU telemetry is also not a whole-datacenter meter. NVIDIA's cumulative energy interface and sampled power interface have different units and update behavior. More frequent polling does not necessarily produce more independent physical measurements. Zeus can instrument appropriately scoped windows, but a field called total energy may still mean the selected GPUs rather than the entire server. A small fitting residual against systematically biased measurements does not certify physical accuracy.[^18]

## 7. Public-data-only implementation path

### Step 1: complete observation accounting

Preserve the existing per-execution ledger and conversation sums. Reconstruct only defensible active context. Keep logical input, new user text, output, known cache subsets, current context size and cumulative usage separate. Branch changes, regeneration and history loads must not create duplicate executions. Mark incomplete history and compaction explicitly.

### Step 2: keep a stable calculation interface

Use one shared interface receiving numerical observations, their provenance, a method ID and an immutable scenario/profile. Return quantities, units, boundary, included/missing components, assumptions, calculation version and status. Provider adapters extract observations; they do not choose hidden physical coefficients. Screens format results; they do not calculate energy independently.

An equation change normally touches its pure method module, registration/validation, cross-runtime reference and tests. A coefficient change normally touches its reviewed profile, version and expected results. A genuinely new input requires an explicit schema amendment. No fixed line-count guarantee should replace correctness, but a study update should not require editing every screen or adapter.

### Step 3: admit research candidates separately

Retain the existing reference for ordinary prototype comparisons. Evaluate SweetSpot or a recovered broader predictor in an isolated research fixture with explicit model/runtime/length scope. Store GPU, IT and facility boundaries distinctly. Do not automatically merge a small-model, saturated TensorRT experiment with the current larger-model vLLM cohort simply because both mention H100.

### Step 4: validate from available measurements, not fresh paid runs

If suitable public raw or aggregate records become accessible under compatible terms, freeze their source version and cleaning decisions. Keep repeated runs and turns from the same conversation together when splitting. Compare an output-only baseline, a simple input/output baseline and the candidate on the same held-out workloads and energy boundary. For batch-labelled data, compare the sum of request predictions to the measured batch; do not manufacture independent request labels by duplicating a batch average.

Report errors in joules or Wh, signed bias and relative errors only above an appropriate measurement floor. Report long-input, output-length, cache and hardware/model groups separately. If a narrow public benchmark validates the candidate, state that narrow domain. Transfer to an undisclosed hosted service remains an additional assumption, not the same measured error percentage.

### Step 5: promote only the supported scope

A credible candidate may become a new, versioned assumption-based profile without claiming exact provider telemetry. Promotion still needs usable coefficients/assets, correct boundaries, an applicability rationale and successful reproducibility checks. Stronger claims such as calibrated accuracy require the independent evidence specified above. Outside-domain inputs retain the existing qualified fallback or an explicitly scoped reference, not arbitrary extrapolation.

Preserve the selected highest-comparable policy for unfamiliar models. It is a cautious selection within the approved cohort, not necessarily the predictor with minimum expected error. Keep the selected model/hardware scenario intact rather than independently maximizing electricity, carbon and water from different profiles. Historical results retain their original method; recalculation is a separately labeled view.

## 8. Electricity, carbon and water downstream

The denominator-aware environmental equations do not need changing merely because the upstream energy predictor changes:

```text
E_facility_kWh = E_IT_kWh × PUE
carbon_g = E_facility_kWh × compatible_carbon_g_per_kWh
direct_water_L = E_IT_kWh × direct_WUE_L_per_IT_kWh
electricity_water_L = E_facility_kWh × electricity_water_L_per_kWh
water_total_L = direct_water_L + electricity_water_L
```

These equations require compatible scope and factors. A GPU-only result is not complete IT electricity; applying PUE to it does not manufacture missing CPU or host energy. Direct and electricity-supply water must have compatible consumption and source-water definitions before an unqualified total is formed. CO2-only and CO2e factors keep distinct labels.[^8][^19]

An improved energy estimate can improve downstream estimates, but unknown serving geography, source-factor vintage and water definitions remain. Company disclosures are useful reference checks, not universal per-token multipliers. Google's reported production reference already includes facility overhead, and its reported statistic is not automatically the expected value for an arbitrary long Claude conversation.[^8]

## 9. Adoption summary

**Adopt now:** explicit input/context/cache semantics; one replaceable calculation interface; versioned coefficient files; separate source/measurement/transfer uncertainty; reproducible candidate equations; and comparison against independent public measurements when suitable data is available.

**Keep unchanged:** current default numerical reference settings, existing historical results and the operational-only environmental boundary. Retention of the baseline preserves a known limitation; it is not evidence that input processing is negligible.

**Do not adopt:** universal input coefficients, fixed cache discounts, extrapolation from a 4K small-model fit to a 100K-or-longer proprietary conversation, or a normalized hybrid that inherits neither source's validation. Do not purchase experiments or send employee content to external calculators.

The best defensible outcome today is a useful, transparent conversation counter with honestly scoped resource estimates and an inexpensive path to incorporate stronger public evidence. No checked source establishes a universal percentage accuracy for these consumer services.

## Sources

[^1]: **Hiari Pizzini Cavagna et al.** *SweetSpot: An Analytical Model for Predicting Energy Efficiency of LLM Inference*, arXiv v2, 23 February 2026. Equations 4-6, experimental scope, Table 3 fitting errors, Table 5 coefficients and limitations. [Original paper](https://arxiv.org/html/2602.05695v2).
[^2]: **Vittorio Palladino, Gianluca Palermo, Michael E. Papka and Zhiling Lan.** *EnergyLens: Interpretable Closed-Form Energy Models for Multimodal LLM Inference Serving*, arXiv v1, May 2026. Equation 4, fitting procedure, target re-fitting and separate error/ranking evaluations. [Original paper](https://arxiv.org/html/2605.10556v1).
[^3]: **Francisco Caravaca, Ángel Cuevas and Rubén Cuevas.** *From Prompts to Power: Measuring the Energy Footprint of LLM Inference*, arXiv v1, 5 November 2025. Sections III-V: batch allocation, workload scope, long-input example and held-out/mixed-batch prediction. [Original paper](https://arxiv.org/html/2511.05597v1).
[^4]: **Anthropic.** *Prompt caching*, documentation inspected 9 September 2026. Prefix reuse mechanics and API-specific scope. [Official documentation](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).
[^5]: **Anthropic.** *How do usage and length limits work?*, inspected 9 September 2026. Consumer-app automatic context management and preserved history. [Official help](https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work).
[^6]: **AI Footprint Tracker.** *Four-site live browser audit*, 9 September 2026. Dated, limited observations rather than general proof of all provider behavior. [Local audit](../implementation/LIVE-BROWSER-AUDIT-2026-09-09.md).
[^7]: **GenAI Impact / EcoLogits.** *LLM inference methodology* and pinned implementation. GPU normalization, serving assumptions and existing equation. [Methodology](https://ecologits.ai/latest/methodology/llm_inference/), [pinned kernel](https://github.com/mlco2/ecologits/blob/886d1ebfadb51a2d6407fcea6d9778c997c85c35/ecologits/impacts/llm.py).
[^8]: **Google.** *Measuring the Environmental Impact of Delivering AI at Google Scale*, arXiv v1, August 2025. Facility, idle and environmental allocation boundaries. [Original paper](https://arxiv.org/html/2508.15734v1).
[^9]: **vLLM project.** *Automatic Prefix Caching*, inspected 9 September 2026. Prompt-processing reuse and remaining decode work. [Official documentation](https://docs.vllm.ai/en/latest/features/automatic_prefix_caching/).
[^10]: **Zhenxiao Fu et al.** *LLMCO2*, HotCarbon 2025, with separate earlier arXiv version. Do not mix the versions' evaluation protocols. [Published paper](https://hotcarbon.org/assets/2025/paper-1.pdf), [repository](https://github.com/fuzhenxiao/LLMCO2), [arXiv v1](https://arxiv.org/html/2410.02950v1).
[^11]: **Felipe Oviedo et al. / Microsoft.** *Energy use of AI inference, efficiency pathways, and test-time scaling*, Joule 2026; arXiv v2 dated 9 June 2026, with an earlier April repository snapshot. Public input-dependent throughput and power scenarios. [Pinned repository](https://github.com/microsoft/aienergy_simulation/tree/cc9dc82a49f5d6cf64615c59d264aa34912f045e), [current author manuscript](https://arxiv.org/pdf/2509.20241v2), [MIT license](https://github.com/microsoft/aienergy_simulation/blob/cc9dc82a49f5d6cf64615c59d264aa34912f045e/LICENSE).
[^12]: **Jared Fernandez et al.** *Energy Considerations of Large Language Model Inference and Efficiency Optimizations*, ACL 2025. Controlled sweeps and bounded input/output binning. [Publisher record](https://aclanthology.org/2025.acl-long.1563/), [author manuscript](https://arxiv.org/html/2504.17674).
[^13]: **Hiili / GreenBrain Science.** Carbon AI Extension listing and developer website, inspected 9 September 2026. Evidence of a product, not an open model/data license. [Store listing](https://chromewebstore.google.com/detail/carbon-ai-extension/clffbmdchmecickkojbefnjklbhdmmcp), [developer website](https://hiili.org/).
[^14]: **Nada Zine et al.** *Attention to Detail: Evaluating Energy, Performance, and Accuracy Trade-offs Across vLLM Configurations*, arXiv v1, 10 July 2026. Multi-turn cache experiments and measurement limitations. [Original paper](https://arxiv.org/html/2607.09172v1), [replication record](https://zenodo.org/records/19253906).
[^15]: **ML.ENERGY project.** v3 dataset and records documentation, inspected 9 September 2026. [Dataset card](https://huggingface.co/datasets/ml-energy/benchmark-v3), [record definitions](https://ml.energy/data/api/records/), [v3 analysis](https://ml.energy/blog/measurement/energy/diagnosing-inference-energy-consumption-with-the-mlenergy-leaderboard-v30/).
[^16]: **Chenxu Niu et al.** *TokenPowerBench: Benchmarking the Power Consumption of LLM Inference*, arXiv v1, December 2025, and public run records. [Paper](https://arxiv.org/html/2512.03024v1), [pinned sample](https://raw.githubusercontent.com/chenxuniu/TokenPowerBench/ec00f52f6baacabeb2af41edd584fc81e2dca77f/results/vllm_models--Llama-3.1-8B_128_1000_20250610_095633.json).
[^17]: **Lola Solovyeva and Fernando Castor.** *Towards Green AI: Decoding the Energy of LLM Inference in Software Development*, arXiv v1, February 2026. Phase-level evidence and currently expired replication link. [Paper](https://arxiv.org/html/2602.05712v1), [replication link](https://anonymous.4open.science/r/PhaseLevelAnalysisLLMInference-4E96).
[^18]: **NVIDIA and Zeus project; Part-time Power Measurements authors.** Device energy/power API semantics and empirical instrumentation limits. [NVML](https://docs.nvidia.com/deploy/nvml-api/group__nvmlDeviceQueries.html), [Zeus monitor](https://ml.energy/zeus/reference/monitor/energy/), [measurement study](https://arxiv.org/html/2312.02741v2).
[^19]: **Pengfei Li et al.** *Making AI Less Thirsty*, arXiv v5, water accounting Section 3.1. [Original framework](https://arxiv.org/html/2304.03271v5#S3.SS1).
[^20]: **NVIDIA.** TensorRT-LLM release 0.19 performance overview and benchmark statistic definitions, pinned commit `c6f7d423354214df818e206e87680fb2d513a718`. [Throughput table](https://github.com/NVIDIA/TensorRT-LLM/blob/c6f7d423354214df818e206e87680fb2d513a718/docs/source/performance/perf-overview.md), [statistic definitions](https://github.com/NVIDIA/TensorRT-LLM/blob/c6f7d423354214df818e206e87680fb2d513a718/tensorrt_llm/bench/dataclasses/statistics.py).

## Supporting source audits

- [Energy-model equations, versions, validation and reuse](CONTEXT-ENERGY-MODELS-SOURCE-AUDIT-2026-09-09.md).
- [Measured data, cache experiments, artifact access and free validation](CONTEXT-ENERGY-MEASUREMENTS-SOURCE-AUDIT-2026-09-09.md).
- [Microsoft paper/code reconciliation and original NVIDIA throughput](CONTEXT-MICROSOFT-SOURCE-AUDIT-2026-09-09.md).
- [Implementation requirement for localized formula updates](../../IMPLEMENTATION-PLAN.md#confirmed-amendment-easy-formula-updates-9-september-2026).

The isolated [equation fixture](../../fixtures/context-energy-study-2026-09-09/sweetspot-llama31-8b.json) and [four research checks](../../tools/context-energy-study.test.cjs) reproduce the token example, polynomial arithmetic and rejected extrapolations. They do not execute model inference or validate the equation against new measurements. Run `node --test tools/context-energy-study.test.cjs` to repeat them.
