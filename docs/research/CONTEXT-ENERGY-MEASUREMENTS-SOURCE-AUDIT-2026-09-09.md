# Context and cache energy: measurement source audit

Research date: 9 September 2026. Scope: public measurements, datasets, instrumentation and reproducibility for text LLM inference. This is a research document, not a new estimator, coefficient update or claim about the electricity used by a particular Claude, ChatGPT, Gemini or Perplexity request.

## Decision

Public measurements support treating input context, generated output, cache reuse, serving load and hardware as separate variables. They do not support adding a universal input-token coefficient or cache discount to our existing output-based reference. Retain the current numbers unless a separately reviewed method and applicable evidence qualify a replacement. Retaining them preserves a disclosed limitation; it does not validate the omission of context.

Free CPU reanalysis is worthwhile and does not require model weights, an inference endpoint or a GPU. It can reproduce published equations, audit units and denominators, fit relationships that the available observations actually identify, and test a candidate against genuinely independent measurements. However, **no raw artifact verified in this audit contains all the features and suitable independent labels needed to validate a context-and-cache-aware estimator for the four proprietary browser services**. This is a finding about the inspected evidence, not a claim that no such public dataset exists.

The strongest candidates have different roles:

| Source | Useful evidence | Readiness for our question |
| --- | --- | --- |
| ML.ENERGY v3 | Measured GPU energy across models, tasks, hardware and concurrency; maintained data toolkit | Public summaries support workload/hardware comparisons. They omit input lengths and cache state. Request energy is allocated from a batch, not measured independently per request. Detailed data is gated. |
| SweetSpot | Published input/output equation and fitted coefficients; controlled input/output grid described in the paper | Equations can be reproduced locally. The linked raw artifact could not be inspected in this audit, so measured-grid availability and a new independent split remain unverified. |
| Attention to Detail, July 2026 | Controlled prefix-cache on/off experiments including multi-turn workloads, repeated runs and an open replication archive | Strong evidence that cache effects depend on task and serving configuration. Published measurements have acknowledged sensor bias. The archive is a single 831.6 MB ZIP; its internal schema was not verified. |
| TokenPowerBench | Public small JSON run results and measurement code | Accessible, but the inspected record lacks input/cache features and contains inconsistent derived values. Repair and provenance checks are required before fitting even a narrower model. |
| Towards Green AI, February 2026 | Phase-level input/output experiments on a single A10 | Relevant paper, but its linked replication repository is expired. Tables cannot supply independent raw-request validation. |
| Poddar et al. LLM Energy Benchmark | Reproducible task-oriented measurement code | The inspected public repository contains code but no published result CSV/JSON files. Running it would be a new GPU experiment, which is outside this task. |

No paid experiments, provider test generations, new GPU jobs, dependency installations, model downloads, private chat capture or third-party messages were performed.

## 1. ML.ENERGY: useful measured data, different label semantics

Primary sources: [benchmark repository](https://github.com/ml-energy/benchmark), [v3 dataset card](https://huggingface.co/datasets/ml-energy/benchmark-v3), [data toolkit](https://ml.energy/data/), [records API](https://ml.energy/data/api/records/), and [the authors' v3 analysis](https://ml.energy/blog/measurement/energy/diagnosing-inference-energy-consumption-with-the-mlenergy-leaderboard-v30/).

The January 2026 v3 analysis reports 46 models, seven tasks and 1,858 configurations on H100 and B200 GPUs. That is a release snapshot, not an assertion that every current record belongs to exactly that count. Its LLM task families include chat, problem solving and code completion, with separate multimodal and diffusion tasks. It documents a substantial interaction between output length, available batch size and energy per output token. Thus, an energy/token value already depends on the benchmark workload and operating point. [ML.ENERGY v3 analysis](https://ml.energy/blog/measurement/energy/diagnosing-inference-energy-consumption-with-the-mlenergy-leaderboard-v30/)

### Exact accessible files and fields

The public leaderboard repository was inspected at commit `5d899ea5a1c8934c0eff691df2b731d20490bb2a`. An example source file is:

`public/data/models/Qwen__Qwen3-8B__lm-arena-chat.json`

[Pinned Qwen3-8B chat JSON](https://raw.githubusercontent.com/ml-energy/leaderboard/5d899ea5a1c8934c0eff691df2b731d20490bb2a/public/data/models/Qwen__Qwen3-8B__lm-arena-chat.json)

This file has top-level model/task/architecture/precision metadata and a `configurations` array. Its 19 configuration records include:

- `gpu_model`, `num_gpus`, `parallelization`, `max_num_seqs`, `avg_batch_size`;
- `avg_output_len`, `output_length_distribution`;
- `avg_power_watts`, `energy_per_token_joules`, `energy_per_request_joules`;
- `output_throughput_tokens_per_sec`, `median_itl_ms`, `p90_itl_ms`, `p95_itl_ms`, `p99_itl_ms`.

The inspected configuration schema has no input-token or prefix-cache field. Its output histogram is a distribution, not a table joining each request's input, output and physical energy measurement.

For the first configuration, one B200 with `max_num_seqs = 8`, the record gives:

```text
energy_per_token_joules   = 0.43039510958494537
avg_output_len           = 638.6728515625
energy_per_request_joules = 274.88167193717175
```

The arithmetic `energy_per_token_joules * avg_output_len` reproduces `energy_per_request_joules`. The same identity was checked across all 19 records. This agrees with the records API, which calls request energy an estimate and defines the underlying energy/token as steady-state GPU energy per output token. It does not establish physical request-by-request attribution. [Pinned data](https://raw.githubusercontent.com/ml-energy/leaderboard/5d899ea5a1c8934c0eff691df2b731d20490bb2a/public/data/models/Qwen__Qwen3-8B__lm-arena-chat.json), [records API](https://ml.energy/data/api/records/)

This distinction prevents two errors:

1. Do not treat the configuration's allocated J/request as a separately measured target for every request in its output histogram. That would manufacture labels and make a fitted output relationship appear independently validated.
2. Do not add an input-energy term to this full-service energy/token allocation without defining and recalibrating the boundary. Prefill energy in the serving measurement can already contribute to its numerator, even though the normalization is by output tokens.

### Detailed dataset and access limits

The toolkit reads `runs/llm.parquet`. Its documented `LLMRun` fields additionally include `seed`, `num_request_repeats`, tensor/expert/data parallelism, `steady_state_energy_joules`, `steady_state_duration_seconds`, `completed_requests`, `total_output_tokens`, and stability status/reason. The summary is described as only a few MB. Methods such as `read_results_json()`, `read_prometheus_json()`, `output_lengths()`, `inter_token_latencies()` and `timelines()` fetch raw `results.json` and `prometheus.json` files when needed. [Records API](https://ml.energy/data/api/records/)

The dataset card and toolkit explicitly require accepting the Hugging Face access conditions, sharing contact information and authenticating. No access conditions were accepted and no credentials were used here. The dataset card declares Apache-2.0, but openness of the license does not remove the access gate. The public documentation does not prove that the raw records expose a complete prompt/cache schema, nor that an individual energy label exists. Those questions require a later authorized inspection of the actual raw files. [Dataset card](https://huggingface.co/datasets/ml-energy/benchmark-v3), [toolkit access instructions](https://ml.energy/data/)

For reproducibility, pin the dataset revision, toolkit version and repository commit separately. The dataset card and current toolkit documentation show different import spellings, so do not copy an unpinned loading example into the project as if package compatibility had been tested.

**Free work possible now:** verify published identities, compare operating points, and fit power/throughput/concurrency relationships for the public task/model/hardware strata. **Not identifiable from the public summary:** an independent prompt-length coefficient, a cache-hit energy discount, or a per-request phase decomposition.

## 2. TokenPowerBench: accessible records require a data-quality gate

Primary sources: [paper](https://arxiv.org/html/2512.03024v1), [repository](https://github.com/chenxuniu/TokenPowerBench), and [pinned repository tree](https://api.github.com/repos/chenxuniu/TokenPowerBench/git/trees/ec00f52f6baacabeb2af41edd584fc81e2dca77f?recursive=1).

The paper describes phase-aware GPU, CPU/DRAM and optional node-level measurements, varying engine, batch, context and parallelism. It is a useful experimental framework description. However, claims in the paper about available metrics are not proof that every published result implements those semantics.

At inspected commit `ec00f52f6baacabeb2af41edd584fc81e2dca77f`, the tree lists 182 `results/*.json` files totaling 672,119 bytes. This is small enough for a later free local audit. The public sample inspected in detail is:

`results/vllm_models--Llama-3.1-8B_128_1000_20250610_095633.json`

[Pinned sample JSON](https://raw.githubusercontent.com/chenxuniu/TokenPowerBench/ec00f52f6baacabeb2af41edd584fc81e2dca77f/results/vllm_models--Llama-3.1-8B_128_1000_20250610_095633.json)

Its structure is `{ model_name: [run, ...] }`. The inspected run includes `duration`, `total_output_tokens`, `responses`, `batch_size`, `engine`, `gpu_avg_power`, component energies, and redundant formatted and derived values. It has per-device average power and memory information, but no input-token count, prefix-hit count, prompt identity, complete hardware/driver identity, or explicit prefill/decode energy fields.

The following inconsistencies were recomputed locally:

| Published field or identity | Value or result | Implication |
| --- | --- | --- |
| `gpu_energy` | 3,690.5537917166257 J | Matches `gpu_avg_power * duration` for this record. |
| `responses` | 32 | The record's own response denominator. |
| `gpu_energy / responses` | 115.32980599114455 J/response | Does not match the reported 160.4588605094185 J/response. The latter implies a denominator of 23. |
| `total_energy` | 3,690.5537917166257 J | Nonzero. |
| `total_energy_per_token`, `total_energy_per_response`, `total_avg_power` | All 0 | Internally inconsistent with nonzero total energy, tokens and duration. |
| CPU and DRAM fields | 0 | Sensor availability and validity are not established by these zeros. |

The raw numerator and derived GPU J/token are arithmetically compatible in this sample. That does not resolve the other denominator errors, measurement boundary, missing channels or missing input metadata. Do not silently repair an ambiguous response count by choosing the value that produces a desired result. Record invalid derived columns, retain the raw source and investigate the generating code/version first.

The repository README declares MIT and refers to a LICENSE file; no LICENSE/COPYING file was found in the inspected recursive tree. This is a provenance gap to resolve before vendoring code or redistributing a bundled dataset. It is not a claim that the authors prohibit reuse. [Repository](https://github.com/chenxuniu/TokenPowerBench), [pinned tree](https://api.github.com/repos/chenxuniu/TokenPowerBench/git/trees/ec00f52f6baacabeb2af41edd584fc81e2dca77f?recursive=1)

**Recommendation:** use the framework as a source of measurement requirements and the small records as audit material. Do not use the inspected JSON as clean context/cache training labels or describe its zeros as measured whole-system consumption.

## 3. Direct prefix-cache energy experiment

[Attention to Detail: Evaluating Energy, Performance, and Accuracy Trade-offs Across vLLM Configurations](https://arxiv.org/html/2607.09172v1), dated 10 July 2026, is the most directly relevant cache measurement study found in this search.

The study crosses three attention backends, prefix caching on/off and chunked prefill on/off across five models and five tasks, with 30 repetitions of each setting, yielding 9,000 runs. It uses vLLM 0.10.2, A100-SXM4-40GB hardware, and the offline inference interface. Energy comes from CPU `perf` and GPU `nvidia-smi` sampling at 1 Hz. It measures the generation workload, excluding model loading and warmup, and measures idle consumption during a separate calibration period. Treat the exact idle-subtraction implementation as unverified until the artifact code is read. [Study design and execution](https://arxiv.org/html/2607.09172v1#S4)

Its workload coverage is particularly useful:

- AssistantTraces: 20 coding sessions, first ten turns, sequential batches by turn.
- WildChat: 200 conversations, limited to five turns, original dataset assistant messages used as history; sequential batches by turn.
- LongBench v2: 30 sampled long-context items from the short subset, with reported mean prompt length about 25,583 tokens and no repeated prefixes.
- EvoEval and Natural Questions: additional repeated-prefix and short-question contrasts.

Cache and KV state are reset between dataset evaluations. The experiment therefore starts cold, then permits within-workload reuse where applicable. It does not measure a proprietary provider's cache persistence, routing, eviction or compaction policy. [Workloads and execution](https://arxiv.org/html/2607.09172v1#S3.SS4)

### What it supports

Prefix caching generally reduces energy, but effects are task/model dependent and often modest. The paper reports an energy increase for Llama-3B on AssistantTraces when caching is enabled. It also observes a Qwen-32B/LongBench energy difference despite no repeated prefixes, and explicitly treats a change in memory-management behavior as a hypothesis requiring further instrumentation. Thus, neither enabling the option nor observing a latency improvement identifies a universal number of joules saved per cached token. [Results](https://arxiv.org/html/2607.09172v1#S5.SS1.SSS3), [discussion](https://arxiv.org/html/2607.09172v1#S6)

The repetitions have a reported energy coefficient of variation of 0.043. This is repeatability within the experiment, not an accuracy guarantee: the paper acknowledges systematic sensor bias and warns that repetitions reduce noise without removing that bias. Its offline batches and specific older serving version also limit transfer to HTTP production workloads and other architectures. [Threats to validity](https://arxiv.org/html/2607.09172v1#S7)

### Artifact status

The [Zenodo replication record](https://zenodo.org/records/19253906) was successfully read. It is open, version v2, published 27 March 2026, and declares CC-BY-4.0. It presents one `ASE.zip` file, 831.6 MB, with listed MD5 `90fa072b22f13491c9c876b3183b9b15`. Its description promises code, datasets and results. A large download was not made.

The ZIP preview could not be inspected: the fallback web tool explicitly rejected that URL as unsafe and non-retryable. No alternative route was used after that rejection. Consequently, no exact internal CSV name, row schema, per-request energy label or cache-hit join is certified here. The paper says cache queries/hits and other runtime metrics are in the package; this is a paper claim awaiting artifact verification.

**Recommendation:** retain as measured evidence for cache sensitivity and a candidate for free CPU reanalysis if a small public aggregate table becomes available. Do not import a cache-saving factor from it into usage totals.

## 4. Other input/output evidence and free reanalysis limits

### SweetSpot

The companion estimator audit covers [SweetSpot](https://arxiv.org/html/2602.05695), its input/output equation, Table 5 coefficients and validation interpretation. The linked [Zenodo artifact, DOI 10.5281/zenodo.18714476](https://doi.org/10.5281/zenodo.18714476), could not be retrieved here through either Firecrawl's page or public API extraction. A subsequent web read explicitly rejected the URL as unsafe and non-retryable; inspection stopped.

Therefore this audit cannot answer whether the artifact contains the measured energy grid, only generated prompts, both, or additional per-run data. Its dataset license and exact raw schema remain unverified. The paper's published coefficients can be evaluated on a CPU without any inference. Reproducing those coefficients or their example predictions is arithmetic reproducibility, not a new held-out measurement result. A reported fit error must not be relabeled as our independent validation error.

### Towards Green AI: phase-level measurements

[Towards Green AI: Decoding the Energy of LLM Inference in Software Development](https://arxiv.org/html/2602.05712v1), dated 5 February 2026, studies ten 3B-7B models on a single NVIDIA A10 24 GB using Transformers 4.56.1 and PyTorch 2.8.0. It reports input ranges of roughly 50-400, 150-1,200 and 4,000-8,000 tokens across workloads, with output limits ranging from 10 to 2,000. It separates prefill from decode and finds that input size affects both phases. [Methods](https://arxiv.org/html/2602.05712v1#S3)

Its 10 Hz pyNVML sampling does not itself guarantee 100 ms independent physical readings. Token boundaries can be shorter than the effective sensor update/averaging behavior, so per-token attribution needs the instrumentation caution below. The paper's [replication link](https://anonymous.4open.science/r/PhaseLevelAnalysisLLMInference-4E96) was read and explicitly reports an expired repository with zero files. Published aggregate tables remain useful for checking reported directions and magnitudes in that A10/code domain; they do not provide the raw prompt/output/energy joins needed for our own split.

### Poddar et al. benchmark

The [LLM Energy Benchmark repository](https://github.com/sohampoddar26/LLM-energy-benchmark), accompanying the NAACL 2025 paper, documents CodeCarbon/CarbonTracker measurements and task-level analysis. Its output contract names `output.json`, `emissions.csv` and a `carbontracker/` directory. The [recursive tree at commit `a5645e64efce3b5d82d2043283ff394872edbeaa`](https://api.github.com/repos/sohampoddar26/LLM-energy-benchmark/git/trees/a5645e64efce3b5d82d2043283ff394872edbeaa?recursive=1) did not contain result CSV/JSON data. The repository declares GPL-3.0. The documented CSV-generation scripts create prompt datasets; those are not measured electricity labels. Re-running its inference pipeline would require new hardware work, outside the user's public-research-only request.

### What can be done without a GPU

| Operation | Possible from inspected material? | What it would establish |
| --- | --- | --- |
| Recompute published input/output equations and unit conversions | Yes, from the companion equation audit | Correct implementation of that published equation. |
| Audit ML.ENERGY public JSON and fit within-task concurrency curves | Yes | Relationships among observed aggregate operating points. |
| Audit TokenPowerBench's small run files | Yes | Data consistency, recoverable columns and missing metadata. It is not yet clean calibration data. |
| Independently split SweetSpot's measured grid | Not verified | Requires the actual measured table and grouping metadata. Generated prompt files alone are insufficient. |
| Reanalyse the cache study | Potentially, after suitable public raw/aggregate files are inspectable | Effects within the study's hardware, version and workload boundary. |
| Establish the physical joules of a proprietary browser request from numeric client telemetry | No | Client counts/timing do not expose server electricity, hardware, batching or unreported work. |

## 5. Measurement boundaries and resolution

### NVIDIA's current API contract

The official [NVML device-query documentation](https://docs.nvidia.com/deploy/nvml-api/group__nvmlDeviceQueries.html) states:

- `nvmlDeviceGetTotalEnergyConsumption` returns cumulative GPU energy in millijoules since the driver was reloaded, for supported Volta-or-newer devices. Millijoules are the return unit, not a promise of millijoule accuracy or per-token temporal resolution.
- `nvmlDeviceGetPowerUsage` reports GPU and associated circuitry, such as memory, in milliwatts. Ampere except GA100 and newer devices return a one-second average; GA100 and older devices return the instantaneous power interface. The documented semantics differ by architecture.

A GPU counter is not a wall meter. CPU/DRAM, networking, host devices, cooling and facility losses need separately defined measurements or assumptions. Adding a facility multiplier to an already measured wall/facility energy quantity would double count part of the boundary. Similarly, adding GPU energy to a node meter that already includes the GPU would double count electricity.

### Zeus is instrumentation, not a provider calibration dataset

The official [Zeus energy monitor API](https://ml.energy/zeus/reference/monitor/energy/) uses the cumulative energy API where available and a separate power-polling process on older architectures. It supports synchronized windows and selected devices. Its optional `approx_instant_energy` exists because a window shorter than the counter update period may return zero; replacing that zero with instantaneous power times elapsed time remains an approximation.

The current documented `Measurement.total_energy` is the sum of GPU energies. CPU and DRAM are separate optional dictionaries and can be unavailable. Do not interpret a field called `total_energy` as whole-system energy without reading the exact version's contract. Concurrent Zeus windows can overlap; summing them can double count the same device energy. Synchronization is needed for GPU work launched asynchronously, but synchronizing every decode token can itself change serving behavior.

### Instrument bias does not disappear with more rows

[Part-time Power Measurements: nvidia-smi's Lack of Attention](https://arxiv.org/html/2312.02741v2) experimentally characterizes more than 70 GPUs and compares measurements with an external power device. In the tested A100/H100 configurations it finds an instantaneous-power reporting pattern covering only the past 25 ms of each 100 ms interval. Its prescribed measurement practices reduced mean error in selected benchmarks from 39.27% to 4.89%; these are results for its experiment, not a general error bar for every NVIDIA measurement or a guarantee for newer drivers.

Its results support explicit warmup, repetition, timing alignment and random phase offsets where appropriate, and checking the actual GPU/driver's behavior. Increasing the polling frequency does not recover information absent from the sensor's underlying measurement window. A fit with tiny residual error against biased measurements can still be wrong about physical energy.

## 6. Cache and multi-turn semantics the evidence supports

The official [vLLM automatic prefix caching documentation](https://docs.vllm.ai/en/latest/features/automatic_prefix_caching/) describes reusing KV state for matching prefixes, including long-document queries and multi-round conversation. It explicitly limits the direct benefit to prompt processing; generating new output still requires decoding. This is a serving-framework mechanism, not proof that a particular hosted provider uses that mechanism or reports every cache hit.

For a turn `t`, distinguish:

- `I_t`: actual context supplied to the model for this turn, including retained prior user and assistant turns and any observable system/tool material;
- `C_t`: tokens whose prior computed state is actually reused;
- `U_t = I_t - C_t`: tokens requiring new processing, where these quantities have compatible provider semantics;
- `O_t`: total generated tokens, with hidden reasoning/tool branches explicitly missing if not observable.

Counting only the newest user message understates possible input work. Treating all prior visible messages as newly recomputed every turn assumes no reuse. Treating all history as cached assumes a hit, retention and compatible routing. None of those assumptions is established by an unchanged DOM alone.

Even with prefix reuse, new tokens attend to retained context, and generated tokens continue to use context-dependent state. Therefore `I_t - C_t` is not a complete input to the decoding cost. Retrieval and offloaded-cache transfer, residency, eviction, speculative decoding and disaggregated serving can introduce further work. The correct conversation calculation is a sum of turn estimates under a consistent scenario, not a token count of the final transcript multiplied once by an average coefficient.

Cache cost discounts and speedups are not energy discount coefficients. A lower price can reflect commercial policy; lower TTFT can coexist with different power, hardware utilization or memory behavior. The direct cache study provides a measured example of why a uniform conversion is unsafe.

For browser tracking, keep actual text and any content-dependent reconstruction local. Numeric telemetry can carry approved counts, their provenance, method version and missing-data status. It must not be treated as self-validating electricity ground truth. A hash of private content is not needed to calibrate published numeric measurement tables and should not be added by this research work.

## 7. Validation design for a future public-data candidate

This is an acceptance design for reanalysing published data. It does not authorize commissioning or paying for experiments.

### Minimum record contract

Before fitting, require exact source revision, license, run/repetition identifier, model and tokenizer revision, precision/quantization, hardware count/type, serving engine/version, concurrency/batch policy, actual input/output counts, cache policy plus observed reused-token count, and measurement start/end/boundary. Phase energies require a documented separation method. Node/facility fields require an explicit inclusion map. Unknown, missing and zero must be different states.

For a batch-labelled dataset, retain the batch as the observation. Either compare a candidate's summed request predictions with the measured batch total or state the allocation rule and validate it separately. Never present allocated request values as additional independent measured samples. The input/output distribution and scheduling state within that batch also matter; means alone cannot identify nonlinear context terms.

### Comparisons and splits

1. Freeze raw records and a cleaning manifest. Reject invalid energy, duration and denominator values. Resolve sensor absence, loading/warmup inclusion, failed requests, truncated generations and changing output limits before model selection.
2. Compare an output-only baseline, a simple input-plus-output candidate, and a context/cache-aware candidate only where the features are actually available. Added complexity must improve held-out prediction, not merely training fit.
3. Hold complete input/output configurations out, including some length pairs and long-context bands. Keep repetitions, prompts and conversation turns from the same unit together. Randomly scattering repeated rows across train/test leaks the experiment.
4. Test transport separately: leave one model family, GPU, task or engine version out where the dataset permits. A successful within-H100 split does not establish A100, TPU, Cerebras, proprietary MoE or newer-model accuracy.
5. For caching, compare matched cold/warm workloads and cache-miss/partial-hit regimes, preserving the actual reused-token evidence. Evaluate accumulated conversation error by turn count as well as per-turn error. Resetting a benchmark cache between runs must be represented in the model's initial state.

Useful metrics are MAE in J/request or J/batch with the correct unit, normalized absolute error, median and high-percentile relative error, signed bias, and interval coverage plus interval width. Use MAPE cautiously for near-zero denominators. Report separate results by prompt length, output length, cache regime, model and hardware. Report both quality and energy when output changes, since generating a shorter or different answer changes the workload.

Bootstrap independent runs or conversations, not individual tokens or duplicated derived labels. Instrument uncertainty, coefficient uncertainty and provider-transfer uncertainty must remain distinguishable. For a conversation, sample shared hardware/model assumptions once for the whole sequence; do not make them independent for every turn and incorrectly shrink uncertainty by averaging. When no justified cache probabilities exist, show named cache scenarios rather than inventing a probabilistic confidence interval. Reusing the same energy uncertainty in water/carbon conversions likewise preserves correlation.

### Threshold for product adoption

A candidate can earn a narrow label such as “validated on these published H100 workloads” after a reproducible held-out result. It cannot earn “accurate for Claude/ChatGPT/Gemini/Perplexity” from these open-model benchmarks alone. If the product cannot observe required inputs or has no applicable hardware/serving evidence, it should retain the existing disclosed estimate or show the candidate as a benchmark reference separate from usage totals.

## Evidence trail and scope of the search

Six targeted discovery searches were performed: ML.ENERGY raw input/output data; cache reuse and multi-turn measurement papers; prefix-cache energy measurement; TokenPowerBench raw results; NVML/Zeus measurement resolution; and public input/output/energy tabular datasets. Citation and artifact links from the resulting primary sources were then inspected. The later targeted search added the phase-level A10 study but did not resolve the raw-label availability gap. This was source saturation within the task's scope, not an exhaustive census of all papers.

The source cache is ignored by Git. New evidence files use `.firecrawl/context-measurements-*`. Reused evidence includes `formulas-mlenergy-v3-dataset.md`, `formulas-mlenergy-data.md`, `formulas-mlenergy-records.md`, `formulas-mlenergy-v3-analysis.md`, `formulas-image-mlenergy-leaderboard-tree.json`, `formulas-image-mlenergy-build-data.md` and `formulas-tokenpowerbench.md`.

Primary evidence inspected includes the ML.ENERGY dataset/toolkit/records documentation and pinned public JSON, the TokenPowerBench paper/repository/tree/sample, the July cache paper and Zenodo record, the February phase-level paper and expired artifact, the Poddar repository/tree, NVIDIA's official API reference, Zeus's official API reference, and vLLM's official caching documentation. Search abstracts for other cache systems were useful leads but were not promoted into validated energy claims.

Limitations: SweetSpot raw data and both ZIP internals remain unverified; no GPU result was reproduced; no new estimator was fitted; no provider-specific physical measurement was obtained; and no study's quoted validation score was independently replicated. Only this audit and assigned ignored source files were written.
