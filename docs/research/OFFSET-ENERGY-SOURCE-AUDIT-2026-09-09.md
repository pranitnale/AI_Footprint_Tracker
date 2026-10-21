# Offset AI energy-source audit

Research date: 9 September 2026. Scope: Offset AI's methodology version 1.1, last updated April 2026, and the primary sources behind its energy and hosting claims. This is a source audit, not a calibration of the tracker or a measurement of consumer AI infrastructure. Product files and active registries were not changed by this research task.

## Finding

The primary sources support retaining explicit workload and electricity boundaries. They do not support adopting Offset AI's fixed Claude and Perplexity energy factors. Offset's Jegham citation has the wrong arXiv identifier; the actual paper estimates energy from API performance and assumed infrastructure, and does not benchmark Perplexity's complete retrieval workload. Epoch's estimate already includes server and facility overhead. Altman's statement does not disclose the boundary needed to justify an additional PUE multiplier.

The current tracker methodology already separates electricity boundaries and identifies its output-token surrogate's limitations. The useful addition is a short, dated comparison of published reference estimates, with their workload, statistic, evidence type and transfer limits. That comparison should not silently become a new factor registry.

## Claim and evidence matrix

| Offset claim | Primary evidence | Verdict and appropriate use |
| --- | --- | --- |
| Jegham's paper is arXiv:2501.07945. | That identifier resolves to a January 2025 paper about predicting bovine embryo transferability. The intended paper is arXiv:2505.09598. | Incorrect citation. Correct the identifier in any discussion of this source. [Wrong target](https://arxiv.org/abs/2501.07945), [correct target](https://arxiv.org/abs/2505.09598). |
| The Jegham source is peer reviewed. | The current arXiv record lists v6, revised 24 November 2025, without a journal reference or acceptance statement. The authors' current repository supplies an arXiv-preprint citation. | Peer-review status is not established by the checked primary records. Describe it as a preprint unless a publisher or acceptance record is supplied. This does not prove that peer review has never occurred. [arXiv record](https://arxiv.org/abs/2505.09598), [authors' repository](https://github.com/Nidhal-Jegham/HowHungryisAIDashboard). |
| Jegham measured the per-model energy on production-class GPUs. | Sections 4.1 to 4.3 combine public API latency/throughput with rated power, estimated hardware classes, batch allocation and environmental factors. | Mischaracterizes the energy evidence. The API performance is empirical; model energy and infrastructure attribution are estimated. [Method](https://arxiv.org/html/2505.09598v6#S4). |
| Claude 3.5 Sonnet uses 0.35 Wh per prompt according to Jegham. | Table 4 in v5 and v6 gives 0.973 ± 0.066 Wh for 100 input and 300 output tokens; 3.638 ± 0.256 Wh for 1,000 input and 1,000 output; 7.772 ± 0.345 Wh for 10,000 input and 1,500 output. | The cited result does not support 0.35 Wh. This rejects the attribution, not the physical possibility that some Claude request could consume 0.35 Wh. Do not replace it with 0.973 Wh as a universal Claude factor. [v6 Table 4](https://arxiv.org/html/2505.09598v6#S5.T4). |
| Jegham supplies Perplexity's 0.43 Wh including retrieval, web search and indexing. | No Perplexity or retrieval/RAG energy benchmark was found in any of the six arXiv versions or the inspected calculation script. The v1 abstract mentions 0.43 Wh for GPT-4o, not Perplexity. | Unsupported attribution. The coinciding number does not establish how Offset selected it. No verified complete Perplexity energy measurement was recovered. [v1](https://arxiv.org/html/2505.09598v1), [v6](https://arxiv.org/html/2505.09598v6), [pinned script](https://github.com/Nidhal-Jegham/HowHungryisAIDashboard/blob/0052264c6639e329a07c0684fd031e3bcaa7da8d/Data_Cleaning_Final.py). |
| Jegham supports an AWS U.S. intensity of approximately 462 g CO2/kWh. | The AWS CIF is 0.385 kg CO2e/kWh in v1 to v4, and 0.287 kg CO2e/kWh in v5 and v6. The inspected current calculation script uses 0.3 for its Claude/AWS scenarios. | 462 g/kWh is unsupported by the checked versions. Do not silently substitute another paper value as the true intensity of a user's request. [v1 Table 1](https://arxiv.org/html/2505.09598v1#S4.T1), [v6 Table 1](https://arxiv.org/html/2505.09598v6#S4.T1), [pinned script](https://github.com/Nidhal-Jegham/HowHungryisAIDashboard/blob/0052264c6639e329a07c0684fd031e3bcaa7da8d/Data_Cleaning_Final.py). |
| Epoch estimates approximately 0.3 Wh for a typical GPT-4o text response. | The calculation assumes 100 billion active parameters, 500 output tokens, an H100 scenario, 10% compute utilization and 70% power utilization. | Supported as an assumption-based scenario, not a current measured provider coefficient. The short-input assumption matters. [Epoch calculation and appendix](https://epoch.ai/gradient-updates/how-much-energy-does-chatgpt-use). |
| An additional PUE factor can be applied to the common 0.3 to 0.34 Wh evidence. | Epoch's 1,500 W per H100 allocation already includes host and data-center overhead. Altman supplies no component boundary. | Adding PUE to Epoch double counts overhead. Adding it to Altman is not justified by the disclosed information; it cannot be shown to be a GPU-only number. [Epoch](https://epoch.ai/gradient-updates/how-much-energy-does-chatgpt-use), [Altman](https://blog.samaltman.com/the-gentle-singularity). |
| Altman's 0.34 Wh describes a median GPT-4o text query on Azure U.S. | Altman describes an average ChatGPT query. The passage gives no model, token workload, region, hardware, sampling window or mean/median calculation. | Preserve the word average. Median, GPT-4o identity and Azure-U.S. attribution are not established by that statement. [Original post](https://blog.samaltman.com/the-gentle-singularity). |
| Claude and Perplexity can be assigned uniform AWS U.S. or southern-U.S. environmental factors. | Anthropic confirms Amazon is its primary cloud partner, but also says it trains and runs Claude on AWS Trainium, Google TPUs and NVIDIA GPUs. Its April 2026 AWS announcement includes inference expansion in Asia and Europe. Perplexity documents consumer Sonar inference on Cerebras. | Primary-AWS partnership is supported for Anthropic. A specific request's hardware, country, southern-U.S. weighting and full workload distribution are not. Model availability on a cloud does not establish consumer-site routing. [Anthropic hardware](https://www.anthropic.com/news/google-broadcom-partnership-compute), [Anthropic regions](https://www.anthropic.com/news/anthropic-amazon-compute), [Perplexity Sonar](https://www.perplexity.ai/hub/blog/meet-new-sonar). |

## What the energy sources actually calculate

### Jegham and colleagues

The arXiv record gives this revision history: v1 on 14 May 2025, v2 on 15 May, v3 on 15 July, v4 on 29 September, v5 on 11 November and v6 on 24 November 2025. No later arXiv revision was listed when checked. All six full-text versions were inspected for the disputed Claude, Perplexity and AWS claims. The v1 to v4 energy table has no Claude 3.5 Sonnet result; those versions list it in the deployment table. [Revision history](https://arxiv.org/abs/2505.09598).

The v6 equation is:

```text
t_i [hours] = (L_i [seconds] + n_out [tokens] / R_i [tokens/second]) / 3600
E_i,min/max [kWh] = t_i × (P_GPU [kW] × U_GPU,min/max
                         + P_nonGPU [kW] × U_nonGPU) × PUE

U_GPU = G × D_GPU / (N × B)
U_nonGPU = G × D_nonGPU / (N × B)
```

Here G is allocated GPUs, N is GPUs per node, B is batch size and D denotes the assigned power fraction. The paper's main scenario uses N = 8 and B = 8, with fixed non-GPU D = 0.5. These allocations already contain the batch division. They should not be divided by B again. The energy boundary includes estimated non-GPU serving power and PUE overhead. Unassigned GPU idle capacity is excluded. [Equations 1 to 3 and limitations](https://arxiv.org/html/2505.09598v6#S4.SS2).

The authors sample latency and throughput using a Gaussian copula with assumed correlation -0.3, 10,000 draws and a 50/50 weighting of lower/upper power-utilization scenarios. The resulting standard deviation describes this conditional model distribution. It is not an empirically measured error bar for the true energy of a proprietary deployment. Their three input/output configurations can inform workload sensitivity; they do not identify universal prefill coefficients or the energy of web retrieval.

The current public script was inspected at commit `0052264c6639e329a07c0684fd031e3bcaa7da8d`, dated 9 September 2026. It retains the latency-plus-decoding-time method and denominator-aware water formula, but its factors differ from the paper. It maps Claude to an Anthropic host label with an H100/H200 scenario and a 0.3 CIF, and contains no Perplexity/Sonar route. This is another reason to pin paper and code versions independently. The repository did not provide a reuse license in its root listing or README; do not infer permission to copy its code or data from public availability. [Pinned calculation script](https://github.com/Nidhal-Jegham/HowHungryisAIDashboard/blob/0052264c6639e329a07c0684fd031e3bcaa7da8d/Data_Cleaning_Final.py), [repository](https://github.com/Nidhal-Jegham/HowHungryisAIDashboard).

### Epoch's February 2025 scenario and later overview

The numerical reference can be reproduced as:

```text
E [Wh] = (2 × active_parameters × output_tokens)
         / (peak_FLOP_per_second × compute_utilization)
         × allocated_power_W × power_utilization / 3600

       = (2 × 100e9 × 500) / (9.89e14 × 0.10)
         × 1500 × 0.70 / 3600
       = 0.294910684... Wh
```

The 1,500 W includes an approximately 1,275 W server allocation per GPU and estimated facility overhead. The hardware and proprietary architecture are assumptions. A short manually typed input is treated as negligible, while the source separately estimates approximately 2.4 to 2.5 Wh at 10,000 input tokens and approximately 40 Wh at 100,000 input tokens, each with 500 output tokens. Those long-context estimates depend on architecture and attention assumptions. Its cache explanation is not proof that any consumer service preserves the full cache between messages. [Original calculation](https://epoch.ai/gradient-updates/how-much-energy-does-chatgpt-use).

The later 2026 topic overview mentions approximately 0.6 Wh for a 100-word message to a free chatbot, including an allocated upfront model-development contribution. It also distinguishes agents and reasoning workloads from simple chat. This is a broader scope, not a like-for-like replacement for an operational-only coefficient. [2026 overview](https://epoch.ai/publications/ai-energy).

### Altman's June 2025 statement

The original post says, “the average query uses about 0.34 watt-hours,” and, “It also uses about 0.000085 gallons of water.” The energy value is a first-party assertion without a disclosed measurement method. Assuming U.S. gallons, the water conversion is 0.32176000164 mL. That unit conversion does not reveal whether the water covers direct cooling, electricity supply, withdrawals or consumption. A site-only interpretation is an inference, not a published boundary. [Original post](https://blog.samaltman.com/the-gentle-singularity).

### De Vries, Joule, 2023

The publisher labels this article a Commentary in Joule 7(10), dated 18 October 2023, pages 2191 to 2194, DOI `10.1016/j.joule.2023.09.004`. It is not a direct ChatGPT energy experiment. Its stated upper estimate of 2.9 Wh follows a SemiAnalysis scenario of 564 MWh per day divided by 195 million requests per day:

```text
564,000,000 Wh / 195,000,000 requests = 2.892307692... Wh/request
```

The associated scenario uses 3,617 HGX A100 servers and 28,936 GPUs. The article also discusses a roughly 3 Wh implication from a ten-times-search comparison. These are historical estimates with different workloads and hardware, not evidence of a measured tenfold efficiency improvement between identical requests. The main article separately warns that cooling overhead and utilization affect electricity totals. [Publisher full text](https://www.sciencedirect.com/science/article/pii/S2542435123003653).

## Hosting evidence and its limits

Anthropic's 6 April 2026 announcement supports a mix of Trainium, TPUs and NVIDIA GPUs for training and running Claude, while retaining Amazon as its primary cloud provider. Its 20 April announcement, clarified on 21 April, describes inference capacity expansion in Asia and Europe. These announcements do not supply per-request regional weights or demonstrate where a particular Claude.ai conversation runs. [6 April](https://www.anthropic.com/news/google-broadcom-partnership-compute), [20 April](https://www.anthropic.com/news/anthropic-amazon-compute).

Perplexity's Sonar announcement identifies a consumer offering built on Llama 3.3 70B with Cerebras inference. Its footnote explicitly says the API offering was not yet running on Cerebras at the time. This is useful evidence that consumer and API deployment assumptions cannot be interchanged. It does not establish the present distribution of all Perplexity requests or quantify retrieval energy. The retained page extraction did not expose its publication date; access date is 9 September 2026. [Perplexity announcement](https://www.perplexity.ai/hub/blog/meet-new-sonar).

## Recommended adoption

1. Add a compact published-reference table to the evidence section of `docs/methodology/content.html`. For each reference retain the source revision, measurement date when known, model/workload, average or median statistic, electricity boundary and whether it is measured or modeled. Include an explicit unknown where the original source omits a field.
2. Make the PUE compatibility rule concrete: Epoch's 0.3 Wh already includes facility overhead; Altman's 0.34 Wh has an undisclosed boundary. Neither supplies evidence for treating 0.34 Wh as raw GPU energy and multiplying it by an arbitrary PUE.
3. Add Jegham as a candidate sensitivity/comparison method, with the correct identifier and an estimated-energy label. Validate any candidate against measurements before adoption. Browser delay includes queueing, transport and tools; observed latency does not identify GPU power or hardware. Keep the existing separation of GPU, serving IT and facility electricity.
4. Preserve an input-aware research track. Workload-specific prefill/decode measurements can improve the output-token surrogate, but neither Offset's prompt count nor the disputed per-tool constants provide those coefficients. Compare candidates on held-out short, long-context, cached and reasoning workloads under declared hardware settings, keeping unknown hidden work separate.
5. Keep environmental factors as dated scenarios unless actual deployment evidence establishes their relevance. A cloud partnership, an API model listing or a user's location does not establish the consumer request's facility. Do not adopt the unsupported 462 g/kWh or southern-U.S. weighting.

The current page already has most of these structural protections. Preserve them, its review anchors and the active EcoLogits reference. The evidence supports clearer source comparison and targeted future validation, not an immediate factor substitution.

## Evidence retained and limits

Public evidence was collected through the Firecrawl CLI, one concurrent job for this research task. Raw captures are in the ignored `.firecrawl/offset-energy-*` files; the existing `.firecrawl/formulas-how-hungry-ai-v6.md` was reused for v6 full text. The original Cell page returned only navigation and advertising scaffolding, so its publisher-hosted ScienceDirect full text was used. No authenticated consumer conversations, browser traffic or private account data were inspected.

Publication-status checking covered the arXiv record, authors' repository and a public search for a publisher version. Absence of a recovered journal record is reported as unverified, not proof of non-publication. Absence of a disputed benchmark is scoped to the six paper versions and the inspected current calculation script. No claim is made about unavailable private measurements or every possible historical dashboard dataset.

Rerun inputs: `firecrawl-deep-research`; primary energy claims behind Offset AI methodology v1.1; versioned paper, authors' code, provider statements and explicit workload boundaries; research date 2026-09-09.
