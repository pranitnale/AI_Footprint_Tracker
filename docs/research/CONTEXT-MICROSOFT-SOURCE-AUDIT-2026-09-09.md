# Microsoft inference energy simulation: source audit

Checked 9 September 2026. This is a research assessment, not a product coefficient change. It compares the public Microsoft repository at commit `cc9dc82a49f5d6cf64615c59d264aa34912f045e` with Oviedo et al., arXiv `2509.20241v2`, and the original throughput sources. No model generations, GPU jobs, installs, credentials, or upstream scripts were used. Local arithmetic reconstructed the released regression from its CSV.

## Decision

**Useful as a transparent reference scenario, insufficient to replace Claude coefficients.** The work provides an auditable way to connect input/output lengths, serving throughput, assumed node power, and facility overhead. Its original NVIDIA data demonstrate an input-length effect at fixed output length. However, the paper and released implementation disagree on several numerical choices, and the input sensitivity term may count prefill twice when paired with total output throughput. Neither source measures Claude, supplies its serving hardware, or models its prompt-cache hits.

For the tracker, the appropriate near-term use is a separate **Benchmark reference only** scenario with named open-weight model, hardware, software version, input/output domain, assumed power, and PUE. Do not silently use its simulated upper percentile as a Claude bound or add it to an existing EcoLogits total. An input-aware replacement needs a reconciled method and applicability evidence, not just a different numerical coefficient.

## Version and permission to reuse

- Microsoft commit: 15 April 2026. Its README labels the throughput dataset last updated December 2025 and describes estimates for high-concurrency services. The repository explicitly calls results assumption-dependent and directional. [Repository][MS-repo]
- Paper: first submitted 24 September 2025, revised **9 June 2026, v2**. The arXiv record gives journal reference *Joule* (2026), article 102430, DOI `10.1016/j.joule.2026.102430`. The June index dates are not the original publication date. The publisher scrape did not yield the body; the current arXiv PDF was available and its equation and supplemental page 21 were visually checked. [arXiv record][paper-abs], [v2 PDF][paper]
- The exact repository license is **MIT License**, copyright **2025-2026 Microsoft**. It requires retaining the copyright and permission notice in copies or substantial portions. This is the software license, not an assertion that every original benchmark has the same license. The arXiv record separately links CC BY-SA 4.0 for the paper. [Pinned license][MS-license], [arXiv record][paper-abs]
- NVIDIA `release/0.19` resolved during this audit to commit `c6f7d423354214df818e206e87680fb2d513a718`, dated 9 May 2025. Source links below use that commit.

## Exact released method and units

The released traditional-query script first keeps only FP8 rows with numeric input length, output length, and TPS. It fits a separate ordinary least-squares regression for each model with at least three observations:

```text
log TPS = b0 + b_in log(I) + b_out log(O)
TPS_hat(I,O) = min(exp(b0 + b_in log(I) + b_out log(O)), max_observed_TPS)
```

It floors arguments to `1e-6` before taking logarithms. With exactly two observations it uses the largest observed TPS for every input/output length. It skips fewer than two. The code does not reject extrapolation outside the observed length ranges. [Pinned main script][MS-code]

The baseline conversion is:

```text
E_facility_Wh = PUE * P_max_kW * u * O / (3.6 * TPS_hat(I,O))
E_IT_Wh       =       P_max_kW * u * O / (3.6 * TPS_hat(I,O))
```

Here `P_max_kW * u` is **assumed full-node steady-state IT power**, and TPS is **aggregate output tokens per second for that serving configuration**. `kW * seconds` gives kJ; dividing by 3.6 gives Wh. There is no further multiplication by eight for an eight-GPU node. The traditional script fixes `I=500` and samples rounded output lengths from an exponential distribution with median 300 tokens. It uses seed 42 and 10,000 draws per model. The sensitivity script instead evaluates inputs 500, 1,000, and 5,000 and substitutes `O + I/30` for `O`. [Main script][MS-code], [input sensitivity script][MS-input]

The published equation also divides by an efficiency factor, set to one in its baseline. Its main analysis approximates effective length by output length. **The visually inspected v2 supplemental text says `L_eff = I + O`, not `O + I/30`.** This discrepancy must be resolved before citing that supplemental formula as an implemented input-energy method. [Paper, equation 1 and supplemental note S3][paper]

## Released data coverage

Counts below were reconstructed from the pinned CSV after the same FP8 and numeric filtering. The CSV has 25 rows in total, of which 22 enter the released model. There are no Claude rows. [Pinned CSV][MS-data]

| Model label in CSV | Rows used | Input range | Output range | TPS cap | Released treatment |
| --- | ---: | ---: | ---: | ---: | --- |
| Llama 3.1 405B | 7 | 128-5,000 | 128-2,048 | 4,572.23 | Log regression, including two duplicated length pairs from another source |
| Llama 3.1 70B | 5 | 128-5,000 | 128-2,048 | 17,463.99 | Log regression |
| Mixtral 8x22B | 5 | 128-5,000 | 128-2,048 | 25,150.03 | Log regression |
| DeepSeek-R1 | 3 | 500-5,000 | 500-2,000 | 1,300 | Log regression across heterogeneous hardware references |
| Llama-3.1 Nemotron Ultra 253B | 2 | 500-5,000 | 500-2,000 | 5,200 | Constant maximum TPS, no input dependence in the denominator |

For reproducibility, independent normal-equation arithmetic on the CSV gives these coefficients, in the order `(b0, b_in, b_out)`:

```text
Llama 3.1 405B: ( 9.761963209, -0.585438883,  0.226564432)
Llama 3.1 70B:  (10.823819652, -0.562283417,  0.262074605)
Mixtral 8x22B:  (11.225390476, -0.553023950,  0.251666662)
DeepSeek-R1:   (10.559279180, -0.539388131, -0.004877551)
```

These reproduce the released fitting rule, not the current paper's fit and not measured energy. The DeepSeek fit has three observations and three coefficients, leaving no residual degrees of freedom. Its output coefficient is slightly negative; the sparse fit alone cannot establish general output-length scaling.

The v2 supplemental table is larger: 13 Llama-405B rows, 11 Llama-70B rows, 9 Mixtral rows, 3 DeepSeek rows, and 3 Nemotron rows. It includes output lengths to 4,096 and input lengths to 20,000. One Mixtral row is printed as input **20,480**, where the pinned CSV records **2,048** for the same 2,794.97 TPS. Treat that as an unresolved transcription difference. The larger table does not make the released CSV a matching reproduction of v2. [Paper, supplemental table S1][paper]

## Original references and hardware normalization

The CSV's `Source` column contains labels rather than complete URLs. The paper's supplemental references resolve them as follows:

| CSV label | Original source | Audit result |
| --- | --- | --- |
| `tensorRT-LLM-May2025`, v019 | [NVIDIA performance overview][NV-overview] | H100, FP8, TP8 values match the Llama rows; the original table contains additional lengths absent from the CSV |
| `tensorRT-LLM-Feb2025`, v017 | Paper links `NVIDIA/TensorRT-LLM/blob/release/0.17/docs/source/performance/perf-overview.md` | The corresponding raw URL returned 404 in this audit; original Mixtral table was not recovered |
| `llamaNemotron` | [Bercovich et al., Llama-Nemotron, figure 4][Nemotron] | Two length pairs, 500/2,000 and 5,000/500, with 250 concurrent users and FP8; **8 H100 for Llama and Nemotron, 8 H200 for DeepSeek-R1** |
| `tensorRT-LLM-DeepSeekR1` | NVIDIA R1 performance material | The CSV gives a figure-derived 886 TPS and a comment about normalization; the linked release-0.19 R1 guide does not establish that exact H100 observation |
| `ml.energy-chat-results` | ML.ENERGY results | The three such rows are FP16, marked variable input, and excluded by the released fitting rule |

The ordinary Llama TPS values are for the **whole TP8 group**, not TPS per GPU and not one user's streaming speed. NVIDIA reports these as different metrics. [Performance overview][NV-overview], [reporting implementation][NV-reporting]

DeepSeek requires separate treatment. The CSV marks all rows TP8, labels one hardware entry `2xH100 80GB HBM3`, and includes two H200 rows. Its comments explicitly flag normalization and power uncertainty. The current paper presents the DeepSeek rows as TP10 on an H100-equivalent basis. The code does not inspect hardware, TP size, or normalization flags; it groups by model name and assigns DeepSeek a single power constant. The original Nemotron paper confirms H200 for those two R1 measurements. A clean homogeneous H100 calibration is therefore not established. [CSV][MS-data], [main script][MS-code], [Nemotron figure 4][Nemotron], [NVIDIA R1 guide][NV-R1]

## Does TPS include prefill and TTFT?

**Yes for the verified NVIDIA 0.19 source, within its local benchmark scope.** The performance overview names the metric `Total Output Throughput (tokens/sec)`. Its implementation computes:

```text
total output TPS = sum(all output tokens)
                 / (latest request completion - earliest request start)
```

The request clock starts immediately before `generate_async` and ends after the response completes. The benchmark reports a separate decode-generation throughput after subtracting TTFT, but that is not the table's total-output metric. Thus the table already reflects prefill, local scheduling, and generation in its benchmark window. It does not include browser internet latency, arbitrary provider queueing, or measured provider-side power. [Statistics implementation][NV-statistics], [reporting implementation][NV-reporting], [request timing][NV-async]

**Inference from that definition:** at a measured fixed `(I,O)`, `O/TPS_output` is node-time allocation per query. Adding `I/30` or `I` to its numerator can count input processing again unless there is a documented adjustment to the denominator or another independently calibrated scope. The inspected Microsoft method does not supply that reconciliation. Keep this as a methodological concern, not a claim that the authors separately measured a prefill energy term.

## Power, overhead, and simulation intervals

| Issue | Released code / data | Current paper | Consequence |
| --- | --- | --- | --- |
| Node maximum power | Code 10.2 kW, or 12.8 for R1; CSV power column 11 or 14.3 kW is ignored | 10.2 kW or 12.5 for R1 | These are assumptions, with a version mismatch; they are not paired measured power for each TPS row |
| Steady-state power factor | Log-normal P5/P95 0.4/0.9 | Says centered at 0.7 with P5/P95 0.4/0.9 | Released function has median `sqrt(0.4*0.9)=0.6`, not 0.7 |
| PUE | Log-normal P5/P95 1.05/1.6 | P5/P95 1.05/1.4 | Different facility-energy distributions |
| Input numerator | Sensitivity adds `I/30` | S3 says adds `I` | Material method mismatch |
| Throughput validation | None in inspected released scripts | Reports leave-one-out R2 values 0.893-0.941 | Published validation cannot be reproduced from these scripts alone |

For either log-normal variable, the released function uses `sigma=(ln(q95)-ln(q05))/(2*1.645)` and `mu=ln(q05)+1.645*sigma`. The endpoints are percentiles, **not clipping bounds**. Positive probability lies outside them, including physically questionable values such as PUE below one or a steady-state factor above one. A plotted P95 is neither a confidence bound for Claude nor a maximum energy limit. [Released main script][MS-code]

The code also constructs its blended baseline by selecting the three highest simulated model medians, trimming each model first to P5-P95 and then to P10-P90 of that subset, and mixing the retained samples. This retains approximately the original P14-P86 region before subsequent plots and improvement multipliers. It is a selected, trimmed scenario distribution, not a population distribution of Claude requests. Use untrimmed underlying assumptions for any separately designed uncertainty model. [Released main script, mixed-distribution section][MS-code]

The per-query equation's node power covers the complete compute node and PUE converts it to facility energy. **Do not apply PUE again to the returned Wh or add CPU/RAM/node power a second time.** The paper separately models additional fleet provisioning/networking overhead at aggregate scale with a factor around 1.31; that factor is not in the released per-query equation. Decide explicitly whether a reference result covers node IT, node plus facility, or a fleet allocation. The framework is operational inference energy, not a lifecycle, training, water, or embodied-hardware inventory. [Paper, methods and supplemental note S5][paper], [repository scope][MS-repo]

## Validation and cache coverage

The current paper reports leave-one-out R2 of 0.912 (R1), 0.941 (405B), 0.893 (Nemotron), 0.932 (70B), and 0.921 (Mixtral). It also compares scenario energies with public disclosures and energy benchmarks after hardware/precision adjustments. Those comparisons are useful external checks, but they are not measurements of the same request/hardware/power combination and do not validate transfer to Claude. The supplemental prose says the intended use is interpolation in decoding-dominant workloads, not heavy prefill or extrapolation. It acknowledges that a capped throughput plateau can underestimate very long generations. [Paper, table 1 and supplemental note S2][paper]

The released files expose neither a held-out validation implementation nor per-observation uncertainty or fitted coefficient confidence intervals. The paper gives no fold outputs sufficient to reconcile the smaller released dataset, its constant Nemotron treatment, and the current reported scores. This audit reconstructed coefficients only; it did not independently validate those published R2 values.

The benchmark serving engines use ordinary KV caching during generation. That is not a prompt-cache-hit model. There is no input for reusable prefix length, cached-input tokens, hit probability, cache construction, cache reads, retention, eviction, or persistent conversation state in the Microsoft equation. NVIDIA's example dataset uses random token sequences; it does not provide evidence for Claude's cross-request prefix reuse. No cache discount should be inferred from this work or from provider billing prices. [Released code][MS-code], [NVIDIA dataset and benchmark description][NV-overview]

## What can be used now without new experiments?

A direct reference can use the original NVIDIA points without the disputed input numerator. For Llama 3.1 405B FP8, H100 TP8, with **2,000 output tokens**:

| Input tokens | Published aggregate output TPS |
| ---: | ---: |
| 500 | 3,661.85 |
| 1,000 | 3,253.17 |
| 2,048 | 2,139.94 |
| 20,000 | 370.26 |

These points establish that input length changes throughput even when output length stays fixed. Under a *fixed assumed power*, energy allocation proportional to `O/TPS` is **9.89 times larger** at 20,000 input tokens than at 500. The throughput values are measured; the energy ratio depends on holding power fixed. It is not a measured 9.89-fold energy increase and not a Claude multiplier. [NVIDIA 0.19 table][NV-overview]

For a standalone scenario with explicit `P_node=6.12 kW` and `PUE=1.296148` (the medians derived from the released baseline assumptions), the corresponding calculation yields about **1.203 Wh** and **11.902 Wh**. These are deterministic reference calculations, not the paper's Monte Carlo medians. This demonstrates a useful public fallback architecture: preserve measured `(model, hardware, engine, I, O, TPS)` rows and expose power/PUE as assumptions, with an explicit domain and unavailable result outside it.

Before a production estimator could adopt this family of methods, reconcile the paper/code versions and numerator, use homogeneous hardware and throughput scope, recover and pin every accepted benchmark row, validate interpolation on withheld comparable points, and keep cache effects unavailable until supported. Very long Claude contexts remain outside the demonstrated applicability. None of these prerequisites requires paying for Claude experiments merely to preserve an honest reference scenario, but the existing public evidence does not authorize calling that scenario Claude's measured or calibrated energy.

## Evidence retained locally

Public retrievals are retained under `.firecrawl/context-msreview-*` and are ignored by Git. They include the pinned license, CSV, main script, current paper metadata/passages/PDF, rendered pages 3 and 21, original NVIDIA source files, and the Nemotron passages. Parent-provided caches `.firecrawl/context-main-microsoft-repo.md` and `.firecrawl/context-main-microsoft-input-code.md` were reused. The release-0.17 raw source returned 404; no explicit URL-policy denial was encountered or bypassed. No upstream code was executed.

[MS-repo]: https://github.com/microsoft/aienergy_simulation/tree/cc9dc82a49f5d6cf64615c59d264aa34912f045e
[MS-license]: https://github.com/microsoft/aienergy_simulation/blob/cc9dc82a49f5d6cf64615c59d264aa34912f045e/LICENSE
[MS-data]: https://github.com/microsoft/aienergy_simulation/blob/cc9dc82a49f5d6cf64615c59d264aa34912f045e/model_throughput_DB.csv
[MS-code]: https://github.com/microsoft/aienergy_simulation/blob/cc9dc82a49f5d6cf64615c59d264aa34912f045e/simulation_traditional_queries.py
[MS-input]: https://github.com/microsoft/aienergy_simulation/blob/cc9dc82a49f5d6cf64615c59d264aa34912f045e/sensitivity_linput_standard_queries.py
[paper-abs]: https://arxiv.org/abs/2509.20241v2
[paper]: https://arxiv.org/pdf/2509.20241v2
[Nemotron]: https://arxiv.org/html/2505.00949#S2.F4
[NV-overview]: https://github.com/NVIDIA/TensorRT-LLM/blob/c6f7d423354214df818e206e87680fb2d513a718/docs/source/performance/perf-overview.md
[NV-statistics]: https://github.com/NVIDIA/TensorRT-LLM/blob/c6f7d423354214df818e206e87680fb2d513a718/tensorrt_llm/bench/dataclasses/statistics.py
[NV-reporting]: https://github.com/NVIDIA/TensorRT-LLM/blob/c6f7d423354214df818e206e87680fb2d513a718/tensorrt_llm/bench/dataclasses/reporting.py
[NV-async]: https://github.com/NVIDIA/TensorRT-LLM/blob/c6f7d423354214df818e206e87680fb2d513a718/tensorrt_llm/bench/benchmark/utils/asynchronous.py
[NV-R1]: https://github.com/NVIDIA/TensorRT-LLM/blob/c6f7d423354214df818e206e87680fb2d513a718/docs/source/blogs/Best_perf_practice_on_DeepSeek-R1_in_TensorRT-LLM.md
