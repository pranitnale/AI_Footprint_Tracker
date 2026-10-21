# AI footprint methodology comparison

## Executive assessment

AI Footprint Tracker's declared methodology is more reproducible and more careful about accounting boundaries than Offset AI's published method. It distinguishes observed tokens from hidden work, separates IT from facility electricity, keeps direct cooling and electricity-supply water separate, and versions its assumptions. Offset's method contains a wrong primary citation, unsupported per-tool attributions and several unit or boundary problems. These findings justify retaining the tracker's core equations rather than importing Offset's coefficient bundle. [Offset methodology](https://www.offsetai.app/methodology-transparency-calculations), [tracker methodology](../methodology/content.html)

This does **not** establish that the tracker's estimates are closer to the actual electricity or water used by today's closed consumer services. The tracker is still a design/specification and reference implementation, not a calibrated production extension. Its present text surrogate has no explicit input-length term, its four-model fallback does not cover all modern architectures, and several bundled environmental factors lack complete original-source provenance. Additional complexity and passing arithmetic tests are not measurements of predictive accuracy.

The appropriate changes are to adopt stronger original-source references, record more precise factor definitions, strengthen validation before promotion, and explain what the numbers can support. No universal replacement for all four services was established. Existing worked-example coefficients remain unchanged and explicitly hypothetical; new published values are retained as scoped evidence, not silently substituted into historical results.

## 1. Scope of the comparison

The compared Offset page identifies itself as version 1.1, last updated April 2026. The page and linked evidence were checked on 9 September 2026. The assessment concerns the **published methodology**, not the behavior or source code of its installed extension. Sources that have changed since April may explain some differences, so a missing current citation is not automatically proof that the claim was never supportable.

The tracker side comprises the current public methodology, dated reference registries, implementation contracts and reduced arithmetic tests. Planned capture, calibration, security and cross-browser capabilities are not treated as already delivered production behavior. Both projects describe an operational focus rather than allocating model training to the ordinary per-request headline. [Offset](https://www.offsetai.app/methodology-transparency-calculations), [tracker implementation specification](../implementation/METHODOLOGY-AND-MULTIMODAL-SPEC.md)

Three questions must be separated:

1. **Arithmetic correctness:** do the published inputs reproduce the stated result?
2. **Accounting validity:** do the factors use compatible quantities, populations, years and boundaries?
3. **Predictive accuracy:** how close is the estimate to an independently measured target workload?

Offset's default arithmetic is largely reproducible, but arithmetic alone does not resolve the second or third question. The tracker's tests provide evidence mainly about the first question and parts of the second. Neither a citation nor a checksum independently answers the third.

## 2. Reconstructing Offset's calculation

Offset counts prompts and multiplies by a fixed factor for each tool. Its general carbon calculation is `energy × PUE × carbon intensity`. Its general water calculation is `energy × PUE × (direct WUE + electricity-water intensity)`. The published common inputs are PUE 1.3, direct WUE 1.9 L/kWh, electricity-water intensity 4.54 L/kWh, and carbon intensities of 367 g/kWh or approximately 462 g/kWh for the services it assigns to AWS. [Offset's formulas and table](https://www.offsetai.app/methodology-transparency-calculations)

The following reproduces those formulas exactly from the stated inputs. It is an audit of their arithmetic, not an endorsed estimate of the services.

| Tool | Stated energy, Wh/prompt | Electricity after PUE, Wh | Calculated carbon, g/prompt | Calculated water with common factors, mL/prompt | Water in Offset table, mL/prompt |
| --- | ---: | ---: | ---: | ---: | ---: |
| ChatGPT | 0.34 | 0.442 | 0.162214 | 2.84648 | 2.85 |
| Gemini | 0.24 | 0.312 | 0.114504 | 2.00928 | 2.01 |
| Claude | 0.35 | 0.455 | 0.210210 | 2.93020 | 3.60 |
| Perplexity | 0.43 | 0.559 | 0.258258 | 3.59996 | 4.70 |

The first two water entries reproduce after rounding. Offset says it increases AWS-associated water intensity to reflect southern-U.S. cooling, but does not give the exact factor or regional weights. Its Claude value implies a combined intensity of approximately **7.91209 L/kWh**, while Perplexity implies **8.40787 L/kWh**. Those are derived from `reported water / (stated energy × PUE)` and are not published physical coefficients. The differing entries therefore cannot be independently reconstructed from the disclosed common water factors alone. [Offset's regional-weighting explanation](https://www.offsetai.app/methodology-transparency-calculations)

Its annual examples are arithmetically reasonable under a full 365-day year: 100 employees × 20 prompts/day × 365 × 0.16 g gives 116.8 kg, and the same request count × 3 mL gives 2,190 L. These calculations inherit all errors and scope limitations of the per-prompt factors. An organization using working days rather than every calendar day would have a different request count; measured counts are preferable to such projections.

## 3. The most consequential source problems

### 3.1 The Jegham citation points to a different subject

Offset repeatedly links arXiv:2501.07945 as the source for *How Hungry is AI?*. That identifier resolves to a paper about bovine embryo transferability. The intended paper is arXiv:2505.09598, whose current listed revision is v6 from 24 November 2025. The checked arXiv record and authors' repository do not establish journal acceptance; the work should be described as a preprint unless a publisher or acceptance record is supplied. This is not a claim that peer review could never have occurred. [Linked identifier](https://arxiv.org/abs/2501.07945), [correct paper](https://arxiv.org/abs/2505.09598), [authors' repository](https://github.com/Nidhal-Jegham/HowHungryisAIDashboard)

The paper uses empirical API latency/throughput with assumed infrastructure, power allocation and environmental factors. Its resulting energy is **modeled**, not a direct power-meter reading from the closed provider. In v6, Claude 3.5 Sonnet is estimated at **0.973 ± 0.066 Wh** for **100 input and 300 output tokens**. The paper's medium and long configurations have different results. It does not support replacing every Claude request with either Offset's 0.35 Wh or the paper's 0.973 Wh. The reported dispersion is conditional on the authors' simulation assumptions, not a measured uncertainty interval for the true deployment. [Method and equations](https://arxiv.org/html/2505.09598v6#S4.SS2), [Table 4](https://arxiv.org/html/2505.09598v6#S5.T4)

No Perplexity/RAG energy benchmark was found in any of the six paper versions or the inspected authors' calculation script. The v1 abstract uses 0.43 Wh for GPT-4o, not Perplexity. This does not prove where Offset obtained its number, but the cited attribution is unsupported. The AWS carbon factors are 385 g CO2e/kWh in v1-v4 and 287 in v5-v6, not the stated 462. The authors' current code has yet another factor set, reinforcing the need to pin paper and code independently. [v1](https://arxiv.org/html/2505.09598v1), [v6 Table 1](https://arxiv.org/html/2505.09598v6#S4.T1), [pinned authors' script](https://github.com/Nidhal-Jegham/HowHungryisAIDashboard/blob/0052264c6639e329a07c0684fd031e3bcaa7da8d/Data_Cleaning_Final.py)

### 3.2 Facility overhead is added to a number that already contains it

Google's **0.24 Wh** reference includes serving accelerators, non-GPU host energy, allocated idle capacity and facility overhead. Offset uses that 0.24 as a per-tool energy input and applies PUE 1.3, obtaining 0.312 Wh. The extra 0.072 Wh is a **30% increase caused by adding facility overhead again**, not a correction supported by Google's source. Google's result is also a volume-weighted median across model-average energy, not an arithmetic mean of all queries or a fixed-length prompt measurement. [Google's original paper, Tables 1-2 and Sections 3.1-3.4](https://arxiv.org/html/2508.15734v1)

Epoch's approximately **0.3 Wh** scenario similarly includes server and facility overhead in its assigned **1,500 W per H100**. Multiplying that result by PUE again would double count overhead. Its assumptions include 100 billion active parameters, 500 output tokens, 10% compute utilization and 70% power utilization; the reproducible calculation gives approximately **0.2949107 Wh**. Those are model assumptions and a defined short-input workload, not a meter reading of current GPT-4o. [Epoch's original calculation and appendix](https://epoch.ai/gradient-updates/how-much-energy-does-chatgpt-use)

Sam Altman's **0.34 Wh** statement describes an average ChatGPT query but does not disclose the component boundary, model, region, token workload or measurement method. It therefore neither establishes a GPU-only starting point nor justifies adding an arbitrary PUE. Calling it a median GPT-4o query on Azure U.S. adds specificity absent from the original statement. Its water figure converts to approximately **0.3217600 mL** if U.S. gallons are assumed, but the conversion does not establish a direct-only or total-water boundary. [Original June 2025 post](https://blog.samaltman.com/the-gentle-singularity)

### 3.3 The direct-water denominator is not interchangeable with supplied electricity

The denominator-aware equations are:

```text
E_facility = E_IT × PUE
W_direct = E_IT × WUE_IT
W_electricity = E_facility × EWIF
W_total = E_IT × (WUE_IT + PUE × EWIF)
```

Direct consumptive WUE uses IT electricity in Li's model, the author's OECD-hosted explanation and the guide linked by EESI. EESI itself uses imprecise wording referring to all data-center energy, which makes checking its source chain especially important. Offset applies PUE to both water terms without establishing a different direct-WUE denominator. [Li v5, Section 3.1](https://arxiv.org/html/2304.03271v5#S3.SS1), [Ren on OECD.AI](https://oecd.ai/en/wonk/how-much-water-does-ai-consume), [EESI](https://www.eesi.org/articles/view/data-centers-and-water-consumption), [linked WUE guide](https://www.datacenterknowledge.com/cooling/a-guide-to-data-center-water-usage-effectiveness-wue-and-best-practices)

Conditionally treating Offset's 0.34 Wh as IT energy and retaining all its other coefficients, direct water should be **0.6460 mL**, not 0.8398 mL. Electricity-supply water remains 2.00668 mL, giving **2.65268 mL** rather than 2.84648 mL. The isolated denominator error increases the total by approximately **7.31%**. These are conditional arithmetic results, not corrected real ChatGPT measurements; the input energy boundary and factors remain unverified.

If a source explicitly defines direct WUE per **facility** kWh, `E_facility × WUE_facility` is valid. The rule is not that PUE is always forbidden in water calculations. The rule is to match the factor's actual denominator and apply overhead only once.

### 3.4 Some water summaries change the unit of activity

Offset's own statement of 500 mL across 10-50 requests implies **10-50 mL/request**, not 10-25. The original Li scenario is historical and workload-specific; even a correct division would not create a current universal query factor. The cited Sean Goedecke article estimates approximately **5 mL per average conversation**, not per prompt. It relies on assumed shorter responses and model-efficiency improvements, not direct measurements. [Li v5](https://arxiv.org/html/2304.03271v5), [Goedecke's October 2024 article](https://www.seangoedecke.com/water-impact-of-ai/)

## 4. Carbon factors, hosting and regional assumptions

EIA's 2023 figure of 0.81 lb CO2/kWh converts to approximately **367.41 g CO2/kWh**, so Offset's rounded 367 is supported for that scope. IEA's **445 g CO2/kWh for 2024** is also supported. Both describe generation-associated CO2, not complete electricity-lifecycle CO2e. Offset labels its per-tool table CO2e without establishing the additional gas and lifecycle definitions. Neither figure can silently replace the tracker's library factor, whose source family is lifecycle CO2e. [EIA FAQ](https://www.eia.gov/tools/faqs/faq.php?id=74&t=11), [IEA Electricity 2025](https://www.iea.org/reports/electricity-2025/emissions), [OWID definition](https://ourworldindata.org/grapher/carbon-intensity-electricity), [Ember methodology](https://files.ember-energy.org/public-downloads/ember_electricity_data_methodology.pdf)

More recent generation-only references exist: EIA's 2024 U.S. profile gives **785 lb CO2/MWh**, approximately **356.07 g/kWh**, and IEA's 2025 world figure is **435 g/kWh**. These are useful dated alternatives within their own accounting class, not evidence that the tracker's original lifecycle estimate was too high. Changing year, geographic weighting or included gases is a method change, not a routine display conversion. [EIA United States Electricity Profile 2024](https://www.eia.gov/electricity/state/unitedstates/), [IEA Electricity 2026](https://www.iea.org/reports/electricity-2026/emissions)

The linked IEA data-center page did not substantiate an exact global-average PUE of 1.3 in the retrieved material. That is an unsupported current citation, not proof that no historical population or weighting could give 1.3. A global stock average, a survey average and a hyperscale fleet's energy-weighted average must not be treated as the same quantity. [IEA linked page](https://www.iea.org/energy-system/buildings/data-centres-and-data-transmission-networks)

Anthropic confirms Amazon is its primary cloud partner, but also describes running Claude on Trainium, Google TPUs and NVIDIA GPUs, with inference expansion in Asia and Europe. Perplexity has documented a consumer Sonar offering on Cerebras and explicitly distinguished it from its API deployment at publication. These sources do not locate a particular request, but they rule out treating a cloud partnership or model label as sufficient evidence for a uniform AWS/U.S./southern-U.S. allocation. Nor does the employee's IP establish inference geography. [Anthropic hardware](https://www.anthropic.com/news/google-broadcom-partnership-compute), [Anthropic regional expansion](https://www.anthropic.com/news/anthropic-amazon-compute), [Perplexity consumer/API distinction](https://www.perplexity.ai/hub/blog/meet-new-sonar)

## 5. Better original water evidence, with unresolved limits

Following EESI's electricity-water discussion to the original LBNL report recovers a more specific value: **4.52 L/kWh for the modeled U.S. data-center electricity mix in 2023**, with **340 g generation-associated CO2e/kWh** for the same published allocation. Offset's approximately 4.54 follows rounded secondary conversions. LBNL's value is preferable as a named historical electricity-supply reference because its population and method are described. It is not a universal current water factor or proof of an assistant's location. [LBNL 2024 report, printed pages 56-58](https://escholarship.org/content/qt32d6m0d1/qt32d6m0d1.pdf)

The underlying Siddik et al. study uses power-plant water data, balancing-authority generation and transfers, thermoelectric estimates, allocated hydro-reservoir evaporation and EPA generation-associated greenhouse gases. Its public historical dataset is described as 2018-2022, while LBNL presents a 2023 aggregate using later source editions. The exact vintage combination reproducing the published national pair was not recovered. That limitation must remain in the evidence record. The carbon result is not full lifecycle GHG, and its water allocation is not simply potable cooling water. [Siddik et al., Water Resources Research, 2024](https://agupubs.onlinelibrary.wiley.com/doi/full/10.1029/2024WR038350), [public dataset](https://www.hydroshare.org/resource/2f54448714554f83b9655da108f0fd3f/)

The same LBNL report does not yet support importing a complete direct-water bundle without further reconciliation. Its rounded annual totals, 66 billion L and 176 TWh, imply approximately **0.375 L/kWh of facility electricity**. With PUE 1.4, that would imply approximately **0.525 L/kWh_IT**, not the reported site-WUE figure just above 0.36. Different averaging or weighting may explain the difference, but the checked text does not resolve it. The 2025 Update, published in June 2026, updates energy analysis rather than supplying a reconciled new water-factor series. The direct factor is therefore withheld from automatic adoption. [LBNL 2024, printed pages 38 and 46-58](https://escholarship.org/content/qt32d6m0d1/qt32d6m0d1.pdf), [2025 Update](https://www.osti.gov/servlets/purl/3374245)

Our own **3.1321 L/kWh** is reproducible as a pinned EcoLogits value, but its WRI source family needs qualifications. WRI's 2020 paper uses GaBi 8.6.0.20/Energy 2018 data, excludes fuel extraction/processing water, includes all water sources including seawater, and gives a rounded U.S. appendix value of 0.83 U.S. gal/kWh. This establishes a source family and approximate scale, not the exact provenance of the library's extra decimals. It must not be labeled freshwater-only or complete electricity-lifecycle water. [Pinned library record](https://github.com/mlco2/ecologits/blob/886d1ebfadb51a2d6407fcea6d9778c997c85c35/ecologits/data/electricity_mixes.json), [WRI original paper](https://files.wri.org/d8/s3fs-public/guidance-calculating-water-use-embedded-purchased-electricity_0.pdf)

## 6. The remaining linked sources

| Source on Offset's page | Assessment and use |
| --- | --- |
| De Vries, Joule 2023 | A published commentary, not a direct ChatGPT power experiment. Its roughly 2.9 Wh follows a historical infrastructure/request-volume scenario. The change to newer estimates does not itself prove a measured tenfold efficiency gain for identical requests. [Publisher text](https://www.sciencedirect.com/science/article/pii/S2542435123003653) |
| Tomlinson et al., Scientific Reports 2024 | The approximately 1.84 g training allocation is real within the paper's explicit assumption of complete monthly retraining and 300 million monthly queries. It is not a measured current training charge per request and remains outside the tracker's chosen operational scope. Its human-versus-AI lifestyle allocation is not evidence of emissions actually avoided by using an assistant. [Original paper](https://www.nature.com/articles/s41598-024-54271-x) |
| CarbonCredits, August 2025 | The approximately 0.15 g discussion links back to Epoch and presents secondary context; it is not an independent new measurement corroborating a universal query factor. Its Jegham illustration does not establish the disputed Perplexity attribution. [Article](https://carboncredits.com/chatgpt-hits-700m-weekly-users-but-at-what-environmental-cost/) |
| Smartly.AI | The current linked page repeats 4.32 g and other query estimates without a recoverable, sufficiently specified derivation for that coefficient. Keep as historical commentary, not a calibration source. [Current article](https://smartly.ai/blog/the-carbon-footprint-of-chatgpt-how-much-co2-does-a-query-generate) |
| DesignWhine | Its large-spread table mixes annual totals, page-view estimates, per-query figures and a mislabeled Epoch quantity. That compilation is not a statistical uncertainty interval or a like-for-like model benchmark. The general warning about inconsistent assumptions is useful; the range is not adopted. [Article](https://www.designwhine.com/ai-carbon-footprint/) |
| Arbor | The cited reasoning multiplier has no matched task/model/hardware domain adequate for a universal correction. The page also compares energy and carbon values in an efficiency summary, which are different quantities. Do not multiply every reasoning request by 50-100. [Article](https://www.arbor.eco/blog/ai-environmental-impact) |
| Undark/WIRED | Useful reporting on uncertainty, on-site versus power-supply water and absent provider definitions. It does not turn Altman's unspecified water boundary into a verified direct-only measurement. [Article](https://undark.org/2025/12/16/ai-data-centers-water/) |
| Hannah Ritchie, August 2025 | Useful context and an explicit refusal to treat 0.24 Wh as the definitive query value. Some summaries of Google's median and marginality are interpretive; the original paper controls the calculation definition. [Article](https://www.sustainabilitybynumbers.com/p/ai-footprint-august-2025) |
| OECD.AI water article | Authored by Shaolei Ren and useful for the correct water equation. It is an expert contribution with a platform disclaimer, not a separate OECD measurement campaign. [Article](https://oecd.ai/en/wonk/how-much-water-does-ai-consume) |

Secondary sources can help explain the topic and identify original studies. Repeating the same underlying estimate across several articles does not create independent validation. Scope differences should not be resolved by selecting whichever number best reassures or alarms the reader.

## 7. Where the tracker is stronger, and where it is not

| Dimension | Tracker advantage | Remaining limitation |
| --- | --- | --- |
| Workload accounting | Request identities, observed input/output and separate media counts can capture variation that a fixed prompt count cannot. | Full context, cached work, hidden reasoning and auxiliary steps may remain unobserved; production adapters are not yet verified. |
| Electricity | Explicit GPU, IT and facility boundaries; no automatic second PUE. | A hardware surrogate is not the unknown provider's measured electricity. |
| Water and carbon | Separate denominators, components and calculation versions. | Exact factor vintage, gas coverage and water-source categories still need stronger metadata. |
| Unknown models | Explicit highest-comparable selection with proxy identity and finite-cohort qualification. | A finite maximum is not a physical upper bound or a confidence interval. |
| Reproducibility | Pinned sources, numerical fixtures and document/registry drift checks. | Reproducing an assumption-based number does not validate its real-world error. |
| Company reporting | Revision reconciliation and coverage-aware totals are specified. | Totals remain model-based allocations, not verified causal savings or intrinsic tool efficiency. |

With its fixed reference settings and uncapped regression duration, the current four-profile text fallback is **linear in observed output tokens**. Command A is the largest result for every positive output count, yielding approximately **0.7780089 Wh per 1,000 observed output tokens**. Changing input length alone does not change this energy result. That is better workload granularity than a fixed prompt count, but it is not an input-aware energy model. Its common-proxy per-tool totals mostly describe output volume under common assumptions, not experimentally established differences between services. [Reference implementation](../../tools/methodology-reference.cjs), [pinned kernel](https://github.com/mlco2/ecologits/blob/886d1ebfadb51a2d6407fcea6d9778c997c85c35/ecologits/impacts/llm.py)

## 8. Adopted changes and promotion rules

The methodology now requires a dated published-reference comparison, explicit environmental definitions and a distinction between **attributed footprint** and **avoided impact**. The correct Jegham reference is retained as an estimated-energy comparison method, not promoted to ground truth. LBNL, WRI, EIA and IEA references are recorded with their own populations and boundaries. Existing worked coefficients are not silently replaced.

Before an energy method receives a validated label, it must be tested on untouched measurements with compatible system boundaries. Compare at least a simple per-request baseline, the current output-token surrogate and any proposed input-aware candidate on the **same** workloads. Report absolute error, signed bias, aggregate error and subgroup results, including long context, cached/uncached operation, reasoning and modalities. Do not tune on the holdout, treat a modeled paper estimate as a meter reading, or infer confidence from a source title or checksum. [Implementation quality contract](../implementation/METHODOLOGY-QUALITY-GATES.md)

Rough reference scenarios can still be useful and can be released as clearly labeled estimates after arithmetic, privacy, capture and noninterference checks. They must not receive a calibrated badge or support a claimed percentage accuracy without the required evidence. Fallback eligibility needs a documented rationale; unknown settings are not proof of a matching configuration.

An allocated request footprint also does not measure the physical change caused by skipping the request. Batching, idle capacity, caching, changed workflows and rebound can affect the counterfactual. Tool comparisons need equivalent tasks, outcomes, retries and boundaries. An estimate that decreases because its input count decreases is not independent evidence that the same amount of electricity or water was saved. The tracker must not use these figures as unsupported offset claims or green rankings. [Google's allocation boundary](https://arxiv.org/html/2508.15734v1), [task-comparison limitations](https://www.nature.com/articles/s41598-024-54271-x)

## 9. Conclusion

Keep the tracker's denominator-aware equations, immutable provenance, separate media scopes and honest unknowns. Adopt Offset's useful emphasis on accessible explanations, worked examples and dated disclosures, but source those explanations from original evidence. Reject its unsupported Claude/Perplexity factors, unexplained AWS weighting and universal overhead application.

The strongest current claim is **better specified and more auditable**, not **proven more physically accurate**. The route to stronger accuracy is measured validation of workload-sensitive models and better provider disclosure, not collecting more interchangeable-looking per-query numbers.

## Source register and supporting audits

Exact links are placed beside each claim above. The [energy-source audit](OFFSET-ENERGY-SOURCE-AUDIT-2026-09-09.md) preserves paper-version checks, equations and hosting evidence; the [environmental-source audit](OFFSET-ENVIRONMENT-SOURCE-AUDIT-2026-09-09.md) preserves denominator, population, year and source-chain qualifications. The [published-reference evidence catalog](../../registry/published-reference-evidence-2026-09-09.json) records the adopted references in machine-readable form, with explicit exclusions from automatic production factor selection. These sources do not establish the serving location or physical footprint of an individual employee request.
