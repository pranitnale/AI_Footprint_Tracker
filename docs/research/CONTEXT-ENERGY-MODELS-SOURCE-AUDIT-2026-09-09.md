# Context-aware inference energy models: source audit

Research cutoff: 9 September 2026. Scope: public studies, original repositories and published coefficients. No paid inference, hardware experiments, provider traffic or private conversations were used. This document changes no production formula or registry value.

## Decision

There is enough evidence to improve the *structure* of an estimator: distinguish input processing, output generation, context retained during generation, cache reuse and serving assumptions. There is not enough evidence in the audited sources to replace Claude.ai, ChatGPT, Gemini or Perplexity values with a context-sensitive formula and claim improved numerical accuracy for those services.

The most immediately reproducible small formula is **SweetSpot**, because its paper publishes six coefficients for each of 13 open models. It can support a separate, clearly named H100 research scenario within its measured workload range. Its coefficients are not validated for Claude, models larger than 9B, or inputs beyond 4096 tokens. **EnergyLens's 12-parameter formula** is a useful future method when matching public calibration data are available, but the reported cross-hardware result re-fits coefficients on each target. It does not supply portable Claude coefficients. [SweetSpot v2](https://arxiv.org/html/2602.05695v2), [EnergyLens closed-form v1](https://arxiv.org/html/2605.10556v1).

For a more complete learned predictor, **From Prompts to Power** is a particularly relevant candidate: it jointly uses input/output length, architecture, hardware and batch size, and validates on a held-out 14B model and heterogeneous batches. It also contains an actual approximately 50K-input measurement. This improves the evidence base for scenario work, but is different from having recovered deployable model weights or validated a transfer to Claude. [From Prompts to Power](https://arxiv.org/html/2511.05597v1).

Keep the existing hosted-model values until a candidate passes matching, reproducibility and independent validation checks. Study-based scenarios remain useful without provider telemetry, provided the assumed model, hardware, load and coverage are explicit. A scenario is an estimate under those assumptions; disagreement between scenarios is not a calibrated confidence interval.

## Evidence comparison

Errors in this table have different targets and evaluation designs. They must not be ranked as if each measured the same per-request quantity.

| Method and original source | What it captures | Recoverability and validation | Decision for this project |
| --- | --- | --- | --- |
| [EcoLogits methodology](https://ecologits.ai/latest/methodology/llm_inference/) and [0.11.1 kernel](https://github.com/genai-impact/ecologits/blob/v0.11.1/ecologits/impacts/llm.py) | Active parameters, assumed batch size, output count; separate server and facility overhead. The current latency route can include TTFT. | Published constants. H100/vLLM benchmark fit; GPU-energy function has no input-length argument. | Retain as the existing assumption-based baseline. TTFT in the latency/server term does not make GPU energy context-aware. |
| [SweetSpot v2, 23 February 2026](https://arxiv.org/html/2602.05695v2) | Nonlinear input and output lengths, including input-output interaction and fixed cost. | All six coefficients for 13 profiles are in Table 5. Reported mean MAPE 1.79% is fitted per model to its experimental results; no held-out split was found. | Best compact reproducible context scenario found, limited to its own model/runtime/load range. |
| [EnergyLens closed-form v1, May 2026](https://arxiv.org/html/2605.10556v1) | Separate prefill/decode terms, batch saturation, tensor and pipeline parallelism. | Twelve scalars fitted from about 50 measurements per target. Mistral-7B evaluation reports 13.0% MAPE; Qwen MoE 32.2%, LLaVA video 50.9%. Cross-batch holdout tests report ranking/regret, not an absolute request-energy error bound. No released fitted coefficient set was recovered. | Good candidate template for fitting matching public data. Not a ready coefficient replacement. |
| [LLMCO2, HotCarbon 2025](https://hotcarbon.org/assets/2025/paper-1.pdf) and [repository](https://github.com/fuzhenxiao/LLMCO2) | Kernel graphs, prefill/decode, hardware roofline features, architecture, serving-engine costs. | Published study uses three models, A100/H100 and 8K/1K/1K train/validation/test records. 68.6% of GPU predictions fall within 10% error. Source/data archive is released, but a licensed, ready predictor with verified units and weights was not recovered. | A possible offline research pipeline, not a small portable token formula. Reconcile paper/code versions first. |
| [LLMCarbon](https://arxiv.org/html/2309.14393) and [repository](https://github.com/SotaroKaneda/MLCarbon) | Parameter/FLOP, hardware utilization, operational and embodied carbon. | Inference validation is one GPT-3 batch latency comparison, with assumed facility/carbon factors. The often quoted 8.2% comparison concerns training. | Does not fix the context/prefill problem. |
| [From Tokens to Watt-hours v1, July 2026](https://arxiv.org/html/2607.26571v1) | Transparent compute, parameter traffic, KV writes and context-dependent attention reads. | Constants are published. Its four-model 500-input/500-output comparison reports 4.73% to 27.23% error against the same study used for calibration; an independent holdout is not established. | Useful analytical comparator; unresolved accounting and transfer limitations make it a poor default upgrade. |
| [From Prompts to Power v1, November 2025](https://arxiv.org/html/2511.05597v1) | Input/output lengths, model architecture, hardware, batch size; measured GPU energy per prompt. | 32,500 measurements, 155 architectures and 21 GPU configurations. Random Forest MAPE 10.4842% on held-out Qwen2.5-14B; 13.63% on summed predictions across 125 heterogeneous-batch experiments. Main grid below 1000 input/output tokens; supplementary long-input example around 50K. | Strong candidate for recovering and validating a learned scenario predictor. Public model/data availability and licenses must be established separately from the paper. |
| [EnergyLens simulator v1, May 2026](https://arxiv.org/html/2605.14249v1) | Architecture/operator shapes, fusion, dense/MoE models, communication and overlap. This is a different project from the 12-parameter EnergyLens above. | A100/TensorRT-LLM measurements: 9.25% to 13.19% multi-GPU phase-energy MAPE. Includes Llama3-70B and Qwen3-30B-A3B. No complete licensed ready artifact was recovered. | Stronger physical detail for offline scenario generation, but detailed architecture and backend models are required. |
| [WattGPU v1, July 2026](https://arxiv.org/html/2607.02391v1) and [repository](https://github.com/maufadel/wattgpu) | Mean GPU power and inter-token latency from hardware/model metadata. | Grouped cross-validation, leave-one-GPU-out and leave-one-model-out prevent replicate leakage. Stronger generalization design, but no prompt/output-length features. Server mean-power times ITL is explicitly not a valid energy/token calculation. | Useful hardware sensitivity evidence. It does not solve request-level context accounting. |
| [HYMELL v1, August 2026](https://arxiv.org/html/2608.06723v1) | Primitive, block and whole-model analytical/ML estimates; attention shape, batch size and phase. | About 1200 model configurations. Llama3-8B phase errors below 5%; transferring to A6000 re-profiles and re-fits. No complete parameter/weight release or clear end-to-end held-out split was recovered. | Research direction, not directly implementable from six or twelve public constants. |
| [The 1/W Law v1, March 2026](https://arxiv.org/html/2603.17280v1) | KV capacity, context-dependent concurrency and analytical fleet throughput/power, including 64K/128K scenarios. | Explicitly no new hardware experiments. H100 calibrated to published work; B200/H200 and long-context results are projections. | Explanatory fleet scenario only. Not measured validation for a 128K chat request. |

## Exact compact equations and units

Let `I` be input tokens supplied to a model execution, `O` generated output tokens, and `B` the effective serving batch. They are not necessarily visible-message counts or the user's number of simultaneous chats. One joule is one watt-second; `Wh = J / 3600`, `kWh = J / 3,600,000`.

### EcoLogits baseline

The cached 0.11.1/main GPU function uses the following expression, where `P_active` is in **billions** of parameters:

```text
e_gpu_Wh_per_output_token
  = 1.1665273170451914e-6 × exp(-0.011205921025579175 × B) × P_active
    + 4.052928146734005e-5

E_gpu_kWh = O × e_gpu_Wh_per_output_token / 1000
default B = 64
```

This is the function's single-GPU intermediate, not the complete facility result. The surrounding method accounts for required GPUs, server energy and PUE. The source's fitted domain filters to H100 80GB, batches at most 512 and models at most 200B. No coefficient in this function changes when `I` changes. [Kernel](https://github.com/genai-impact/ecologits/blob/v0.11.1/ecologits/impacts/llm.py), [methodology](https://ecologits.ai/latest/methodology/llm_inference/).

### SweetSpot

Equation 5 gives energy per output token. Multiplying by `O` gives the algebraically equivalent request-average energy, with no division-by-zero problem for ordinary positive-output requests:

```text
e_J_per_output_token(I,O)
  = θ0 + θ1 I²/O + θ2 I + θ3 I/O + θ4 O + θ5/O

E_request_J(I,O)
  = θ0 O + θ1 I² + θ2 I O + θ3 I + θ4 O² + θ5
```

The coefficient units in the second expression are: `θ0` J/output-token; `θ1` J/input-token²; `θ2` J/(input-token × output-token); `θ3` J/input-token; `θ4` J/output-token²; `θ5` J. All 13 rows are recoverable from Table 5; representative exact published profiles are below. [Equation 5 and Table 5](https://arxiv.org/html/2602.05695v2).

| Profile | θ0 | θ1 | θ2 | θ3 | θ4 | θ5 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Llama 3.2 1B | 5.005153e-3 | 1.079941e-7 | 6.825240e-6 | 2.611042e-3 | 3.852659e-6 | 5.406443e-1 |
| Qwen 2 7B | 1.857219e-2 | 2.598309e-7 | 1.531846e-5 | 1.465957e-2 | 9.735924e-6 | 8.719728e-1 |
| Llama 3.1 8B | 1.970934e-2 | 3.329326e-7 | 3.583505e-5 | 1.551942e-2 | 2.249613e-5 | 8.939092e-1 |
| Gemma 2 9B | 1.749322e-2 | 5.981696e-7 | 1.110917e-4 | 1.901597e-2 | 7.408055e-5 | 2.558409e0 |

The scope matters as much as the coefficients: single-GPU execution on H100; TensorRT-LLM throughput mode; tensor/pipeline parallelism one; maximum batch size 1024; maximum batched tokens 8192; 1000 homogeneous requests; input and output lengths each 64 to 4096, in powers of two. Maximum batch size is a scheduler ceiling, not proof that every operation contains 1024 requests. Single-request measurement was excluded because measurement timing overhead was material. The dependent variable is GPU energy integrated during the run and normalized by generated tokens, not facility electricity or an isolated browser request measurement. [Sections 5.1 and 6.2](https://arxiv.org/html/2602.05695v2).

The paper fits each model separately to its experiments. Its 1.79% mean MAPE is not evidence of 1.79% accuracy on a new architecture, unseen serving load, cache hits, or long conversations. The theoretical prefill/decode grouping of polynomial terms is also not independently measured phase attribution. A zero-output request, interruption or failed prefill is outside the reported validation; evaluating the polynomial at `O=0` would be an unvalidated extrapolation. [Sections 5.2.4 and 6](https://arxiv.org/html/2602.05695v2).

A useful reproducibility check, calculated here from Table 5: at `O=512`, the Llama 3.1 8B profile predicts 19.0512 J for `I=64` and 161.1871 J for `I=4096`, an 8.4607× ratio. Qwen 2 7B predicts 14.3744 J and 109.4631 J, a 7.6152× ratio. These are arithmetic outputs of published fits, not new measurements. Even within the source domain, there is no single architecture-independent input multiplier.

### EnergyLens closed-form

Its Equation 4 is:

```text
E_J = αp × I / (B^βp + εp) × TP^γ1p × PP^γ2p
    + αd × O_cap / (B^βd + εd) × TP^γ1d × PP^γ2d
    + δ1 × TP + δ2 × PP
```

`I` corresponds to the paper's `total_input_tokens`, and `O_cap` to `max_tokens`. Preserve those dataset definitions: replacing the cap with actual output length requires validation. Batch/parallelism counts and exponents are dimensionless; `αp` and `αd` supply J/token scaling; `δ1`, `δ2` supply J. A baseline term described as power overhead still has energy units in this fitted equation because it is added to energy. [Equation 4](https://arxiv.org/html/2605.10556v1#S4.Ex1).

The 12 parameters are fitted by minimizing mean absolute relative error, using L-BFGS-B with 10 initializations. Bounds are `α,δ>0`, `β∈[0,2]`, `γ∈[-2,2]`, `ε∈[0.001,1]`. No fitted numeric parameter table was located in the paper or the targeted repository search. The paper's cross-hardware portability is portability of this equation's *form*, followed by target-specific fitting. [Section IV-B](https://arxiv.org/html/2605.10556v1#S4.SS2).

The strongest explicitly separated holdout in the paper trains on the smallest 40% of batch sizes and evaluates the remaining 60%. For Mistral-7B it reports 97.3% pairwise ranking accuracy and 3.0% energy regret; Qwen2-VL image drops to 78.3% ranking and 16.0% regret. These metrics evaluate configuration selection, not absolute per-request error. The 13.0% MAPE experiment samples training measurements, but the inspected prose does not document its absolute-error holdout as clearly as the batch extrapolation experiment. [Tables IV and VII](https://arxiv.org/html/2605.10556v1).

The authors identify missing TP/PP/sequence interactions, expert routing and long-video processing, and leave integration with continuous batching to future work. The decode term does not explicitly contain the growing context `I+o`; context effects are not automatically solved by having separate phase terms. [Conclusion and limitations](https://arxiv.org/html/2605.10556v1#S6).

### Analytical GPU accounting in From Tokens to Watt-hours

The following reproduces the paper's full expression, not an endorsement of its constants. Let `N` be parameter count, `L` layers, `d` hidden width, and `S = O I + O(O-1)/2`:

```text
C_pre = 6 N I + 2 L d I²                     [FLOP]
C_dec = 6 N O + 4 L d S                      [FLOP]
gamma(N) = 0.10 × (N / 24e9)^0.8
s_attn(N) = 1 + 1.5 × (N / 24e9)^0.9
eta(N) = 1 + 0.8 × (N / 24e9)^0.8

Q_param = 16 N gamma(N)                      [bit]
Q_KV_write = 32 d L O                        [bit]
Q_attention = 32 d L S s_attn(N)             [bit]

E_J = 0.52e-12 × (C_pre + C_dec)
    + 11.68e-12 × (Q_param + Q_KV_write + Q_attention) × eta(N)
```

The scalar constants are fully recoverable. The simple parameter-only alternative uses `E_out/token = α_eff × 6N`, and input multiplier 1.2, 1.8, 3 or 4 for input buckets ending at 2048, 5120, 10240 and above. That is a separate approximation; do not apply it on top of the full expression. [Equations 7–23 and Appendix A](https://arxiv.org/html/2607.26571v1).

Three issues prevent promoting it. First, it uses six FLOPs per parameter per inference token where LLMCarbon explicitly distinguishes training `6PD` from inference `2PD`; the coefficient convention needs reconciliation. Second, the parameter-traffic term has no `O` or batch argument, while GQA/MQA, MoE routing, residency and batch reuse are absorbed or omitted. Third, Section 3.5 calibrates against Caravaca's measurements and Section 4.5 compares to that same study at 500/500 tokens, without establishing independent held-out cases. Its 5% to 27% comparison therefore is not long-context validation. CPU, host memory, network, cooling and PUE are excluded. [Calibration and limitations](https://arxiv.org/html/2607.26571v1), [LLMCarbon equations 4–5](https://arxiv.org/html/2309.14393#S4).

### LLMCarbon, neural predictors and the batch measurement identity

The Random Forest in From Prompts to Power is an ensemble of decision trees over model, workload and hardware features, not a universal scalar coefficient table. Abstractly, `E_prompt = mean(tree_t(features))`; the feature definitions, trained trees and output normalization are part of the method. Its heterogeneous-batch test estimates each prompt individually, sums predicted energy and compares that sum with measured batch energy. That directly supports the proposed per-execution-then-sum architecture within the tested configuration assumptions. The general predictor deliberately excludes batches of five or fewer prompts and does not explicitly model quantization; those restrictions also belong in any recovered profile. The reported 50K-input Phi-3 mini experiment uses two L4 GPUs and one request, so it is not automatically included in the predictor's validated training domain. [Sections III and V](https://arxiv.org/html/2511.05597v1).

LLMCarbon uses `F_inference≈2PD` FLOPs, execution time `t = F/(n_devices × throughput_peak × efficiency)`, hardware energy `Σ(power_i × efficiency_i × n_i × t_i)`, and facility energy `E_hardware × PUE`. With powers in W and time in seconds the energy is J. It does not separate the input/output attention geometry. Its inference example predicts 3.1 s versus 3.0 s for GPT-3 175B, 16 A100s, batch 32, input 128, then assumes facility/carbon factors. That cannot establish measured inference-energy accuracy across contexts. [Sections 4–5](https://arxiv.org/html/2309.14393).

LLMCO2, WattGPU and HYMELL require learned predictors, not a recovered handful of universal energy coefficients. LLMCO2's public runner trains separate prefill/decode models and sums their predictions; the HotCarbon paper describes a prefill predictor feeding a total-energy predictor. The archive, weights, units and implementation version must be reconciled before reuse. The 2024 arXiv v1 reports a different six-family, four-GPU experiment with mean MAPE 15.5%; it must not be combined with the 2025 paper's three-model train/test protocol to manufacture stronger validation. [Public runner](https://github.com/fuzhenxiao/LLMCO2/blob/main/llmco2.py), [HotCarbon paper](https://hotcarbon.org/assets/2025/paper-1.pdf), [arXiv v1](https://arxiv.org/html/2410.02950v1).

The August 2026 request-cost study provides a helpful local approximation:

```text
E_batch_J(O) = E_fixed_J + O × E_decode_step_J
E_request_J = E_batch_J / B
e_J_per_output_token = E_batch_J / (B × O)
```

`E_decode_step` is for a complete batch step, not one user's token. The approximation holds model, hardware, runtime, input context and batch fixed; the authors warn that longer outputs can increase marginal cost through KV growth. A lower J/token value can coexist with higher total request energy. No transferable coefficient catalogue or held-out predictor is supplied. [Characterization of Request and Token Energy Costs, equations 1–4](https://arxiv.org/html/2608.28044v1).

## Long contexts, cache and misleading combinations

The targeted 16K–128K search did not find a measured, ready coefficient set covering large open models that could defensibly transfer to closed hosted models. This is a search result, not proof that no such work exists. Actual long-input measurements do exist: From Prompts to Power reports approximately 50K inputs on Phi-3 mini 128K using two L4 GPUs, with one-request energy 3.25 times its 300-input case. That is evidence for this configuration, not a universal input multiplier or large-model/Claude calibration. Its main prediction grid is below 1000 tokens. [Long-context experiment and training scope](https://arxiv.org/html/2511.05597v1#S4.SS1.SSS1).

The large-model EnergyLens simulator validates prefill only through 8192 input tokens; its decode validation starts at 512 input tokens and generates up to 7680 output tokens. A long output test is not the same as a long input test. [EnergyLens simulator, Appendix M](https://arxiv.org/html/2605.14249v1#A13).

The 1/W paper reaches 128K analytically. It uses `B_max=floor(V_KV/(bytes_per_KV_token × context_window))`, a logistic power model, and `tokens_per_joule = [B/iteration_time]/power`. Its H100 power parameters are `P_idle=300 W`, dynamic range `300 W`, slope `1`, midpoint `log2(B)=4.2`. These are recoverable scenario assumptions. The claimed inverse-context law needs full concurrency and its KV/latency assumptions; an individual chat is not a fully occupied fleet. The paper explicitly excludes MoE dispatch overhead and conducts no new hardware experiments. Its B200/H200 ±20% is a stated projection assumption, not a measured confidence interval. [Equations 1–4 and limitations](https://arxiv.org/html/2603.17280v1).

The August attention-scaling study illustrates why architecture transfer is uncertain, but its actual inputs are only 128, 512, 1024 and 1800 tokens and models 1.3B–7B. Prefill is excluded. It cannot validate 128K whole-request estimates. Similarly, TokenPowerBench is an instrumentation/benchmark framework, not a published universal coefficient function for arbitrary context. [Attention-scaling study, Table I](https://arxiv.org/html/2608.25096v1), [TokenPowerBench](https://arxiv.org/html/2512.03024v1).

A cached prompt prefix saves some repeated prefill work; the output still attends to the retained context. New uncached prompt tokens also attend to the cached prefix. Consequently, replacing `I` everywhere with uncached-token count is structurally wrong, and a cached read is not automatically zero energy. None of the compact coefficient sets above validates an arbitrary cache-hit discount for Claude.ai. Model/API cache fields, if observable, remain valuable inputs but do not by themselves establish joules saved. [SweetSpot architecture and decode derivation](https://arxiv.org/html/2602.05695v2#S4), [request-cost phase discussion](https://arxiv.org/html/2608.28044v1#S2).

Do **not** promote `EcoLogits(O) × SweetSpot(I,O)/SweetSpot(I_reference,O)` as a validated correction. The ratio transports a small-model TensorRT saturation curve to a different vLLM benchmark fit and assumed model; its reference context is arbitrary unless matched to the baseline's actual workload. The baseline already reflects its benchmark workload's costs, so an added prefill term can also double count workload-average processing. Normalization removes units, not architecture, scheduling, cache or measurement-boundary differences. Such a hybrid would be a new, unvalidated method and would inherit neither paper's error rate. [EcoLogits fit description](https://ecologits.ai/latest/methodology/llm_inference/), [SweetSpot scope and limits](https://arxiv.org/html/2602.05695v2).

## How to use the evidence without a large rewrite

Keep one shared pure calculation entry point with explicit `methodId`, method version and immutable profile data. A method module owns its equations; a profile record owns coefficients, units, model/hardware/runtime assumptions, workload domain, energy boundary, source version and validation status. Provider adapters supply observed quantities and provenance. Interface components format returned values. A later method change should affect one kernel/dispatch entry and profile records, not hundreds of callers or mutable browser globals.

Useful independent input fields are total input tokens, newly processed input tokens, cached-read tokens, cached-write tokens, generated output tokens, hidden-output coverage, model identity, batch assumption, quantization assumption and media/tool coverage. Unsupported or unobserved fields remain unknown. Each method declares which it consumes; accepting a field in the common request object must not imply the selected equation uses it.

Compute one estimate for each distinct model execution, then sum executions belonging to the conversation under the same method/profile version and boundary. Include previous messages again when they are processed as context in a later execution; that is repeated computation, not duplicate accounting. Conversely, do not re-add the earlier execution itself whenever the UI reloads. Branches, retries, tool/model subcalls and partial outputs need execution identities and coverage. A visible user turn need not equal one inference request.

For a conversation, sum complete scenario evaluations. If hardware/model/cache assumptions are shared, evaluate the whole conversation under each shared scenario before reporting its range. Do not shrink systematic model uncertainty as `1/sqrt(number_of_turns)`. A scenario using an assumed Claude architecture must say so and carry the architecture/serving uncertainty separately from token-count uncertainty.

Public-data-only next work can reproduce the published SweetSpot table values in a research fixture, inspect accessible released measurement records, fit a small bounded alternative offline, and test held-out prompt lengths, model families and hardware. No new GPU experiments or paid inference are required or proposed. Promote coefficients only after documenting that those public records actually contain the required input lengths, realized batch and energy boundaries. This audit does not authorize downloading unsafe or denied resources.

## Reuse and retrieval record

| Asset | Verified availability and licensing limits |
| --- | --- |
| SweetSpot | Paper CC BY 4.0; Table 5 contains numeric coefficients. The paper links [Zenodo DOI 10.5281/zenodo.18714476](https://doi.org/10.5281/zenodo.18714476), but artifact contents and license were not verified. The parallel measurement audit reports failed retrieval followed by an explicit URL-safety denial; no archive was downloaded or bypass attempted. |
| EnergyLens closed-form | Paper CC BY 4.0. Equation and fitting bounds available; fitted weights/code license not located in the inspected material. |
| LLMCO2 | Public code and `data` directory; README asks to extract `data.7z`. No repository license was displayed in the inspected tree/README. Ready inference weights and archive schema remain unverified. Do not equate public visibility with a reusable license. |
| LLMCarbon | Inspected preliminary repository identifies Apache-2.0 and links a separate fuller project. Code availability does not repair inference validation limits. |
| WattGPU | Inspected repository identifies Apache-2.0 and contains data/pipelines/models. Dataset-specific terms and a portable request-energy model were not established here. |
| EnergyLens simulator | Paper CC BY-NC-ND 4.0. It identifies EnergAIzer as MIT at [Zenodo 18916559](https://zenodo.org/records/18916559); this is a dependency, not evidence of a released complete simulator or its license. |
| HYMELL and From Tokens to Watt-hours | Papers CC BY 4.0. HYMELL fitted assets were not recovered. Tokens-to-Watt-hours constants can be transcribed with attribution, but the implementation was not independently reproduced. |
| From Prompts to Power | Paper CC BY-NC-ND 4.0. Trained model and data artifacts were not recovered by this subtask; the paper license does not establish their reuse terms. |
| TokenPowerBench and August request/attention studies | Read as primary methods/measurement evidence. Paper licenses use the arXiv perpetual non-exclusive license. Data/code rights must be checked on their actual artifacts before reuse. |

Searches used Firecrawl's paper index with seven distinct framings: general prefill/decode predictors; closed-form nonlinear methods; caching and continuous batching; LLMCarbon/LLMCO2; held-out hardware validation; and two long-input/large-model queries. Two developer-index searches checked code availability. A related-paper expansion from SweetSpot/EnergyLens returned no candidates. Full source pages were inspected for formulas, coefficients, validation boundaries and limitations; older EcoLogits/TokenPowerBench/ML.ENERGY pages and the main researcher's From Prompts to Power capture were reused from cache. Repeated long-context searches converged on the same candidates, so retrieval stopped on evidence saturation.

New public source caches are under `.firecrawl/context-models-*`; they are ignored by Git. No source instructions were executed. This document is the only research artifact created by this subtask.
