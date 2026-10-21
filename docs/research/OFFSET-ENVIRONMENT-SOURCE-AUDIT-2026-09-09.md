# Offset AI environmental-factor source audit

Research date: 9 September 2026. Scope: water, electricity-related carbon, PUE and the environmental factors in the AI Footprint Tracker methodology. This report is research only. It does not change the methodology, registry, product behavior or saved design reviews.

## Findings that affect adoption

Offset's environmental framework is recognizable, but its published implementation combines factors with incompatible or insufficiently documented boundaries. The strongest elements to retain are the separation of direct cooling from electricity-supply water and the use of explicit electricity intensity factors. Our existing methodology already handles those distinctions more carefully. Offset's numerical defaults should not be adopted as a set. [Offset methodology, version 1.1, April 2026](https://www.offsetai.app/methodology-transparency-calculations), [our methodology](../methodology/content.html)

The most consequential findings are:

1. Direct cooling WUE normally divides water by **IT electricity**, while electricity-supply water divides by supplied electricity. Offset applies PUE to both terms. Its EESI citation phrases the denominator imprecisely; the guide EESI links, the OECD-hosted explanation, Li's paper and LBNL's original report explicitly support the IT denominator. This is a demonstrable formula mismatch, not just a preference for another coefficient. [Data Center Knowledge](https://www.datacenterknowledge.com/cooling/a-guide-to-data-center-water-usage-effectiveness-wue-and-best-practices), [Ren on OECD.AI](https://oecd.ai/en/wonk/how-much-water-does-ai-consume), [Li et al., v5, section 3.1](https://arxiv.org/html/2304.03271v5#S3.SS1)
2. The 1.9 L/kWh direct-water coefficient is not established by the source chain as a current, representative AI-serving consumption factor. EESI says 1.9; its linked January 2025 guide currently says 1.8 and gives no original population/year supporting a universal AI average. [EESI](https://www.eesi.org/articles/view/data-centers-and-water-consumption), [linked guide](https://www.datacenterknowledge.com/cooling/a-guide-to-data-center-water-usage-effectiveness-wue-and-best-practices)
3. The approximately 4.54 L/kWh electricity-water coefficient has a much better original source: LBNL reports **4.52 L/kWh for the modeled U.S. data-center electricity mix in 2023**, versus 4.35 for overall U.S. electricity use. Offset's value follows EESI's rounded 1.2 U.S. gallons/kWh calculation. It is not a global or provider-specific factor. [LBNL 2024 report, printed pages 56–58](https://escholarship.org/content/qt32d6m0d1/qt32d6m0d1.pdf)
4. EIA's 367 and IEA's 445 are approximately supported for the stated historical years, but they are **CO2 per generation kWh**, not complete lifecycle CO2e factors. They cannot silently replace our EcoLogits/OWID lifecycle factor. [EIA FAQ](https://www.eia.gov/tools/faqs/faq.php?id=74&t=11), [IEA Electricity 2025](https://www.iea.org/reports/electricity-2025/emissions), [OWID indicator definition](https://ourworldindata.org/grapher/carbon-intensity-electricity), [Ember methodology](https://files.ember-energy.org/public-downloads/ember_electricity_data_methodology.pdf)
5. Offset contains two clear water-summary errors: 500 mL over 10–50 requests implies 10–50 mL/request, not 10–25; Sean Goedecke's cited 5 mL estimate is per average **conversation**, not per prompt. [Li et al., v5](https://arxiv.org/html/2304.03271v5), [Goedecke, October 2024](https://www.seangoedecke.com/water-impact-of-ai/)

## Claim-by-claim source assessment

| Offset claim | What the cited/source-chain evidence supports | Assessment |
| --- | --- | --- |
| Global average PUE approximately 1.3, attributed to IEA | The current linked technology page has June 2026 findings and does not expose this PUE number in the retrieved content. A targeted IEA search did not substantiate that exact global-average claim. LBNL's separate U.S. model reports approximately 1.4 for 2023, but this does not disprove a differently weighted global 1.3. | Unsupported by the retrieved citation, not proved false. Do not present 1.3 as an established IEA global average without the exact historical table, year and weighting. |
| EIA U.S. 367 g CO2/kWh, 2023 | FAQ updated 11 December 2024 reports 0.81 lb CO2/kWh from utility-scale net generation. Conversion gives 367.41 g. Its rounded totals imply approximately 366.22 g, so 367 is a reasonable rounded statement rather than an exact coefficient. | Supported approximately for 2023 generation CO2. Incomplete as lifecycle or all-GHG CO2e. |
| IEA global 445 g CO2/kWh, 2024 | Electricity 2025 explicitly states 445 and defines intensity as total CO2 emissions divided by total generation. | Supported historical generation CO2 factor. Not a U.S. server factor or lifecycle CO2e. |
| 1.9 L/kWh average direct WUE | EESI repeats 1.9, but its linked guide uses IT electricity and currently states 1.8. Neither is a primary measured modern-AI average. | Weak secondary coefficient, with inconsistent source-chain number and denominator. Reject as an unqualified default. |
| 4,540 L/MWh indirect water | EESI derives 1.2 U.S. gal/kWh from approximately 211 billion gallons and 176 TWh for U.S. data centers in 2023. LBNL gives 4.52 L/kWh directly. | Approximately supported after rounding, with important lost geography, population, year and modeling assumptions. Prefer the primary 4.52 and explicit scope. |
| 500 mL for 10–50 GPT-3 requests implies 10–25 mL/request | Division produces 10–50 mL/request. Li v5 models a specific medium-length conversation workload using 0.004 kWh of server energy/request and historical location scenarios. | Arithmetic error; not a modern universal per-request benchmark. |
| Independent analysis gives approximately 5 mL per prompt | Goedecke's October 2024 post estimates 5 mL per average conversation, relying on rough response-length and model-efficiency assumptions. | Misquotes the unit of activity. Not measured production data. |
| Altman's approximately 0.3 mL likely covers direct water only | The phrase “likely” is an interpretation. Without a disclosed water numerator/boundary it cannot be promoted to a known direct-only measurement. | Keep the source boundary unknown unless a first-party methodological disclosure establishes it. |

Sources for the table: [Offset](https://www.offsetai.app/methodology-transparency-calculations), [IEA linked data-center page](https://www.iea.org/energy-system/buildings/data-centres-and-data-transmission-networks), [EIA](https://www.eia.gov/tools/faqs/faq.php?id=74&t=11), [IEA emissions](https://www.iea.org/reports/electricity-2025/emissions), [EESI](https://www.eesi.org/articles/view/data-centers-and-water-consumption), [WUE guide](https://www.datacenterknowledge.com/cooling/a-guide-to-data-center-water-usage-effectiveness-wue-and-best-practices), [LBNL](https://escholarship.org/content/qt32d6m0d1/qt32d6m0d1.pdf), [Li v5](https://arxiv.org/html/2304.03271v5), [Goedecke](https://www.seangoedecke.com/water-impact-of-ai/).

## Water equations and reproducible arithmetic

For a source whose direct WUE is consumptive litres per IT kWh:

```text
E_facility = E_IT × PUE
W_direct = E_IT × WUE_IT
W_electricity = E_facility × EWIF
W_operational = E_IT × (WUE_IT + PUE × EWIF)
```

This is the relationship in Li v5 section 3.1 and the 30 November 2023 OECD.AI article by the paper's coauthor Shaolei Ren. The OECD page is an author contribution with a disclaimer that its views are not necessarily those of the OECD; it is not a separate OECD measurement campaign. LBNL likewise defines site WUE using IT electricity. [Li equation](https://arxiv.org/html/2304.03271v5#S3.SS1), [OECD-hosted explanation](https://oecd.ai/en/wonk/how-much-water-does-ai-consume), [LBNL, printed page 38](https://escholarship.org/content/qt32d6m0d1/qt32d6m0d1.pdf)

Holding Offset's coefficients fixed **and conditionally treating its 0.34 Wh baseline as IT electricity** gives:

| Calculation | Result |
| --- | ---: |
| Offset direct: 0.00034 × 1.3 × 1.9 × 1,000 | 0.8398 mL |
| Denominator-correct direct: 0.00034 × 1.9 × 1,000 | 0.6460 mL |
| Electricity supply: 0.00034 × 1.3 × 4.54 × 1,000 | 2.00668 mL |
| Offset total | 2.84648 mL |
| Denominator-correct total using the same coefficients | 2.65268 mL |

This isolated error increases direct water by 30% and total water by approximately 7.31%. These are arithmetic consequences, not corrected real ChatGPT measurements. They do not validate the 0.34 Wh energy boundary, PUE, WUE, serving location or electricity mix. If energy already includes facility overhead, PUE must not be added again; recovering the IT term requires a compatible PUE or an independently reported overhead component.

If a different source explicitly defines WUE per **facility** kWh, then `E_facility × WUE_facility` is valid. The factor must carry that denominator. The label “L/kWh” alone is insufficient.

### What the 500 mL study actually represents

Li v5, dated 26 March 2025, considers GPT-3 175B, input of up to approximately 800 words and output of 150–300 words, with assumed server electricity of 0.004 kWh per request. Its U.S. average scenario uses PUE 1.170, direct WUE 0.550 L/kWh_IT and EWIF 3.142 L/kWh, yielding 16.904 mL/request. Its location table is wider than the rounded 10–50-request summary: for example Ireland gives 7.107 mL/request and Washington gives 47.506. This is a modeled workload and deployment sensitivity study, not a direct meter reading for current ChatGPT. [Li v5, sections 3.3 and Table 1](https://arxiv.org/html/2304.03271v5#S3.SS3)

Goedecke argues from that older baseline to a smaller average **conversation**, using assumed shorter content and assumed efficiency improvements. The post explicitly relies partly on uncertain model-size estimates and response speed as an energy proxy. It is useful as a criticism of careless extrapolation, but is not a sound calibration source for a universal modern prompt coefficient. Its October 2024 date also means it is not a critique of every clarification in the March 2025 v5 paper. [Goedecke](https://www.seangoedecke.com/water-impact-of-ai/)

## Following EESI to primary water evidence

EESI is an explanatory secondary article. Its direct-WUE source is another secondary guide, which now gives a different number. More fundamentally, the guide acknowledges inconsistent water-meter coverage, and its discussion of ingested and discharged water does not provide a verified consumption-category numerator for the average. A consumption estimator therefore needs primary category-specific evidence, not only a WUE number. [EESI](https://www.eesi.org/articles/view/data-centers-and-water-consumption), [Data Center Knowledge, 17 January 2025](https://www.datacenterknowledge.com/cooling/a-guide-to-data-center-water-usage-effectiveness-wue-and-best-practices)

For indirect water, EESI links the **2024 United States Data Center Energy Usage Report**, LBNL-2001637. The original PDF host returned a security-check page during this audit; the University of California eScholarship copy supplied the actual report. Its 2023 estimates are approximately 176 TWh facility electricity, 66 billion L direct water, nearly 800 billion L electricity-supply water and 61 billion kg electricity-associated CO2e. It reports 4.52 L/kWh and 0.34 kg CO2e/kWh for the modeled data-center electricity mix, versus 4.35 L/kWh and 0.35 kg CO2e/kWh for overall U.S. electricity use. [Official UC copy, printed pages 55–58](https://escholarship.org/content/qt32d6m0d1/qt32d6m0d1.pdf)

The report links facilities' counties to balancing authorities and models their electricity supply using generation and interchange data. It assumes a common balancing-authority electricity mix for data centers within that authority because facility-level sourcing is unavailable. Thus the national data-center result is a modeled electricity allocation, not proof about the region or procurement of any particular assistant. Its published rounded factors should not be given false extra precision from a quotient of separately rounded headline totals. [LBNL, printed pages 56–58](https://escholarship.org/content/qt32d6m0d1/qt32d6m0d1.pdf)

### Underlying electricity-water and GHG method

The report cites Siddik, Shehabi, Rao and Marston's **Spatially and Temporally Detailed Water and Carbon Footprints of U.S. Electricity Generation and Use**, published in *Water Resources Research* on 22 December 2024, DOI 10.1029/2024WR038350. Its method uses:

- EIA 930 hourly balancing-authority generation and electricity transfers, with EIA 923 monthly plant generation.
- EIA thermoelectric cooling withdrawals and consumption, plus estimates for plants without reported water data.
- Grubert's hydroelectric-reservoir evaporation data and primary-purpose allocation. All reservoir evaporation is assigned to the dam's primary purpose; secondary purposes receive none.
- Meldrum et al. representative wind/solar water factors.
- EPA eGRID annual plant CO2-equivalent emissions. The study describes CO2, methane and nitrous oxide among the reported gases and does not include hydroelectric reservoir GHG emissions because data are insufficient.

The carbon result is generation-associated CO2e, not a complete lifecycle factor. The water result includes attributed hydropower reservoir evaporation, which can materially affect comparisons with factors using other allocation methods. [Siddik et al., section 2.1 and Table 1](https://agupubs.onlinelibrary.wiley.com/doi/full/10.1029/2024WR038350)

**Remaining vintage gap:** the journal article and public dataset describe historical data for 2018–2022. The HydroShare page's temporal metadata extends to June 2023, while its own text still describes static 2018–2022 data. LBNL cites 2024 editions of underlying sources when presenting its 2023 aggregate result, but does not expose in the checked text the exact factor-year/version combination that reproduces 4.52 and 0.34. The 2023 application year is clear; the exact underlying vintage is not fully reconstructed here. Do not describe those factors as directly measured 2023 grid data without this qualification. [Siddik article](https://agupubs.onlinelibrary.wiley.com/doi/full/10.1029/2024WR038350), [HydroShare dataset](https://www.hydroshare.org/resource/2f54448714554f83b9655da108f0fd3f/)

### Direct-water aggregation is not resolved

LBNL reports approximately PUE 1.4 and site WUE just over 0.36 L/kWh for 2023, while defining WUE against IT energy. Its annual totals give `66 billion L / 176 TWh = 0.375 L/kWh_facility`; applying PUE 1.4 would imply approximately `0.525 L/kWh_IT`. The 0.36 value, PUE 1.4 and 66-billion-L total therefore do not directly reconcile as one simple ratio model. The report discusses combining space types, cooling systems and locations, so different averaging/weighting may explain part of this, but the checked description does not resolve it. [LBNL, printed pages 38 and 46–56](https://escholarship.org/content/qt32d6m0d1/qt32d6m0d1.pdf)

Do not silently adopt `PUE 1.4 + WUE_IT 0.36` as a verified coherent national scenario. An explicitly labeled **aggregate direct-water ratio**, approximately 0.375 L/kWh_facility, can be derived from the rounded published totals, but it is not a measured site WUE and has different semantics. It should remain research/reference-only until the aggregation is reconciled.

The newer **United States Data Center Energy Usage Report: 2025 Update**, released 18 June 2026, updates equipment assumptions and electricity estimates. It does not provide an updated indirect-water or GHG factor series that resolves this issue. A newer publication date alone cannot refresh these environmental coefficients. [LBNL 2025 Update, DOI 10.71468/P1RP4F](https://www.osti.gov/servlets/purl/3374245)

## Audit of our bundled environmental example

Our current example is explicitly a pinned EcoLogits Cohere/USA scenario, not a claim to know the actual serving location. That is an appropriate distinction. However, a software commit makes the arithmetic reproducible without making every environmental coefficient empirically current or fully traceable. [Pinned provider settings](https://github.com/mlco2/ecologits/blob/886d1ebfadb51a2d6407fcea6d9778c997c85c35/ecologits/tracers/utils.py), [pinned electricity record](https://github.com/mlco2/ecologits/blob/886d1ebfadb51a2d6407fcea6d9778c997c85c35/ecologits/data/electricity_mixes.json)

| Existing value | Verified provenance | Gap or constraint |
| --- | --- | --- |
| PUE 1.09 | Pinned EcoLogits Cohere/Google scenario; Google's production study also reports fleet PUE 1.09. | EcoLogits record itself does not identify the measurement year, participating facilities or weight. Google's separate support does not prove identical population/vintage. |
| Direct WUE 0.999 L/kWh_IT | Exact literal in the pinned provider settings. | Primary year, water category, geographic coverage and calculation not established by that code. Current EcoLogits prose displays 0.99 and routes source details to a live supplemental spreadsheet. The retrieved sheet exposed only its introduction, so the provider row was not verified. |
| Carbon 0.3844 kg/kWh | Exact USA record in the pinned JSON; EcoLogits methodology attributes GWP to OWID. | No record-level year/source/version. OWID's electricity intensity is lifecycle CO2e, including electricity upstream/supply-chain/manufacturing stages. Exact vintage of 384.4 is unresolved. |
| Electricity water 3.1321 L/kWh | Exact USA record; EcoLogits attributes off-site factors to WRI. | WRI's 2020 working paper uses GaBi 8.6.0.20 and Energy 2018 inventory data. Its rounded USA appendix value is 0.83 U.S. gal/kWh, approximately 3.142 L/kWh. This supports the order and source family but does not reproduce 3.1321 exactly. |

Sources: [EcoLogits methodology](https://ecologits.ai/latest/methodology/llm_inference/), [supplemental material](https://docs.google.com/spreadsheets/d/1XkPTkrGxpwWpIVIxpVvgRJuInSZsqbndTQbFGcHhdd0/), [Google production paper](https://arxiv.org/html/2508.15734v1), [OWID](https://ourworldindata.org/grapher/carbon-intensity-electricity), [WRI original paper](https://files.wri.org/d8/s3fs-public/guidance-calculating-water-use-embedded-purchased-electricity_0.pdf).

The WRI factors cover water associated with electricity generation and explicitly exclude other upstream uses such as fuel extraction and processing. They include water from all sources, including seawater, and account for electricity imports. They therefore must not be called either full electricity lifecycle water or freshwater-only consumption. The appendix's U.S. grid regions use eGRID 2016 definitions published in 2018; the underlying GaBi inventory vintage is 2018. These dates should not be collapsed into a claim that all coefficients are observations from a single 2018 year. [WRI, data sources/method and appendices](https://files.wri.org/d8/s3fs-public/guidance-calculating-water-use-embedded-purchased-electricity_0.pdf)

Ember's current methodology aims to include full lifecycle emissions and all gases using a 100-year CO2e timescale. OWID's current data page is updated 30 June 2026 and covers through 2025, but that does not retrospectively establish the year of the older pinned 384.4 record. Replacing that factor with EIA's generation CO2 would change the accounting boundary, even if the new number appeared more authoritative or recent. [Ember original methodology](https://files.ember-energy.org/public-downloads/ember_electricity_data_methodology.pdf), [OWID indicator](https://ourworldindata.org/grapher/carbon-intensity-electricity)

### Stronger provider reference

Google's August 2025 production paper supplies a more explicit reference for the median Gemini Apps text prompt in May 2025: 0.24 Wh at the comprehensive facility boundary, including approximately 0.02 Wh overhead. Direct consumptive freshwater WUE is 1.15 L/kWh_IT for its LLM-supporting data centers, using the preceding calendar year's Category 2 metric for 2023 and 2024. Using rounded components gives `(0.24 − 0.02) / 1,000 × 1.15 = 0.000253 L`, close to the published 0.26 mL. [Google paper, sections 3.1–3.4 and Tables 1–2](https://arxiv.org/html/2508.15734v1)

The same paper gives 2024 electricity factors of 345 g CO2e/kWh location-based and 94 g CO2e/kWh market-based. At 0.24 Wh, those imply approximately 0.0828 g and 0.02256 g respectively for electricity only. Its headline 0.03 g includes additional Scope 1 and embodied Scope 3 contributions. These variants must retain their accounting definitions, and its direct-water figure must not be called total operational water. Its LLM-serving water population also means that 1.15 does not by itself prove the EcoLogits 0.999 global/provider assumption is false. [Google paper, section 3.3](https://arxiv.org/html/2508.15734v1#S3.SS3)

## Concrete adoption recommendations

| Proposed action | Reason and readiness |
| --- | --- |
| Retain our denominator-aware equations and consumption/withdrawal distinction. | Strong primary support. Offset's water formula is not an improvement. |
| Keep the pinned EcoLogits example reproducible, but add an explicit environmental provenance gap. | Its values are traceable as software settings, not yet as fully dated empirical inputs. Do not silently overwrite an existing example during a research audit. |
| Add a Google May 2025 reference profile with explicit facility boundary, direct freshwater-only water, and separate electricity GHG accounting options. | Strong, well-defined first-party production reference. Not a universal current per-prompt coefficient or total-water scenario. |
| Add LBNL's 2023 U.S. data-center electricity mix as a candidate **electricity-supply-only** reference: 4.52 L/kWh and 340 g generation-associated CO2e/kWh. | Both come from the same published modeled allocation. Record unresolved source-version details; keep direct water unavailable pending reconciliation. Do not mislabel it a complete deployment scenario. |
| Offer EIA U.S. generation CO2 or IEA world generation CO2 only as separately named carbon scenarios. | Historical EIA 2023: approximately 367 g; current published U.S. 2024 profile: 785 lb/MWh = approximately 356.07 g, released 10 November 2025. IEA Electricity 2026: approximately 435 g for 2025. None is a lifecycle CO2e substitute. |
| Build dated scenario records from original values and definitions before selecting a product default. | Require population, geography, activity period, source publication/revision, factor denominator, water category, gases/GWP horizon, generation/lifecycle boundary, weighting, primary URL and derivation. This audit does not establish any user's actual serving location. |
| Do not import 1.9, 4.54, 367 and PUE 1.3 as one coherent default. | Different sources, geographic weightings, years and unresolved direct-water definitions. A plausible numerical result is not evidence of one actual deployment. |
| Keep unsupported totals unavailable rather than inventing a direct factor. | Known electricity-supply water or known direct water is useful with its scope visible. Unknown is not zero. |

Current carbon alternatives: [EIA United States Electricity Profile 2024](https://www.eia.gov/electricity/state/unitedstates/), [IEA Electricity 2026 emissions](https://www.iea.org/reports/electricity-2026/emissions). The IEA 2026 forecast of 360 g in 2030 is not an observed current factor.

For a future source registry, the most important additional distinction is `activity_year` versus `factor_data_year` versus `publication_date` versus `software_snapshot`. A 2026 library release containing a 2020 publication based on 2018 inventory data must not appear to be a 2026 environmental observation.

## Evidence files and limits

Research used Firecrawl public search and scrape, with one job at a time within this research angle. Raw fetched evidence is in the ignored `.firecrawl/offset-environment-*` files; no authenticated traffic, unrelated conversations or private data were inspected. Existing `.firecrawl/formulas-li-water-2025.md`, `.firecrawl/formulas-google-gemini-2025.md` and pinned EcoLogits captures were reused.

Key additional evidence files are `offset-environment-eesi.md`, `offset-environment-dck-wue.md`, `offset-environment-oecd-water.md`, `offset-environment-lbnl-2024-escholarship.md`, `offset-environment-siddik-2024.md`, `offset-environment-siddik-dataset.md`, `offset-environment-wri-paper.md`, `offset-environment-owid-carbon.md`, `offset-environment-ember-methodology.md`, `offset-environment-eia-faq.md`, `offset-environment-eia-usa-current.md`, `offset-environment-iea-emissions.md`, `offset-environment-iea-emissions-2026.md`, `offset-environment-lbnl-update.md` and `offset-environment-goedecke-water.md`.

Not fully resolved: historical IEA support for PUE 1.3; exact source year and numerator of EcoLogits 0.999; exact source vintage/derivation of EcoLogits 384.4 and 3.1321; exact LBNL electricity-factor vintage for its 2023 aggregate; LBNL direct-WUE aggregation. These are source-traceability gaps, not proof that every affected estimate is numerically wrong. No current source checked establishes the actual data-center region of an individual ChatGPT, Claude, Gemini or Perplexity interaction.

Rerun inputs: `firecrawl-deep-research`; topic: Offset AI environmental assumptions and adoption into AI Footprint Tracker; date: 2026-09-09; output: Markdown source audit; primary preference: original methodological papers, government/laboratory reports and provider disclosure.
