# Electricity-factor review and configuration proposal

Research date: 14 September 2026. This is an exploration, not an implementation or an approved factor update. No application code, runtime coefficients, user settings, deployment or provider account was changed.

## Recommendation

Use **458.29 g CO2e/kWh**, the documented 2025 world electricity lifecycle-carbon factor, as an explicitly named fallback when AI processing location is unknown. Prefer verified, compatible processing-region or provider-fleet evidence when available. A world electricity average is a transparent reference, not a measured average of AI-serving electricity or a demonstrated best predictor for every provider.

Keep the user's country, interface language and AI electricity scenario separate. A person using Claude or ChatGPT in Germany does not establish that the AI computation ran on Germany's electricity mix. Europe-first adoption is therefore not sufficient evidence for a European default.

For an explicit EU-27 scenario, use **209.89671 g CO2e/kWh** from the same 2025 source family. For compatibility with EcoLogits' `EEE` Europe scenario, use **282.68 g CO2e/kWh**. Do not label these two populations interchangeably.

The existing USA value, **384.4 g CO2e/kWh**, was an analytical scenario selected in our baseline, not an observation of the serving location. It remains reproducible in original records. This review independently identifies the same number in OWID's 2025 data, improving the available source evidence beyond the previously recorded library-only provenance. A numerical match does not prove the exact original import history of the pinned library file.

## Evidence inspected

- [Live EcoLogits Swagger interface](https://api.ecologits.ai/docs#/Estimations/post_estimations_v1beta_estimations_post), reporting API version 0.0.2beta.
- [API wrapper source](https://github.com/mlco2/ecologits-api/tree/1faf30de8a770dcd73a91025bbdf59fcf4d131c7), cloned for read-only inspection at commit `1faf30de8a770dcd73a91025bbdf59fcf4d131c7`.
- [Library source](https://github.com/mlco2/ecologits/tree/3d9c4e8597878eb156abd8eec2c116827a08628d), cloned for read-only inspection at commit `3d9c4e8597878eb156abd8eec2c116827a08628d`; its project version field is 0.11.1.
- [OWID lifecycle-carbon chart](https://ourworldindata.org/grapher/electricity-mix?source=total&metric=carbon_intensity&frequency=annual), its displayed table, CSV and metadata. Source: Ember (2026), processed by OWID; updated 30 June 2026; data through 2025; next expected update June 2027.
- [Our current baseline](../../packages/estimator/data/baseline.json), methodology constraints and the earlier environmental-source audit.

The API repository's lockfile pins EcoLogits 0.10.2, while the separately inspected library head has a 0.11.1 version field. The live service does not expose a verified library commit in the observed response. Do not equate source HEAD, package version, lockfile and deployed dependency version.

The in-app browser explicitly blocked direct navigation to `https://api.ecologits.ai/openapi.json`. That resource was not retrieved through an alternative route. The supplied Swagger page, its rendered schemas, authorized public factor requests, numerical estimation requests and independent source repositories remained accessible.

## What the API calculates

The estimation request accepts provider, model name, output-token count, optional request latency and optional electricity-mix zone. It does not accept an explicit input-token count, uploaded document contents or the user's language.

The [wrapper](https://github.com/mlco2/ecologits-api/blob/1faf30de8a770dcd73a91025bbdf59fcf4d131c7/app/api/v1beta/router.py) calls `llm_impacts`. That function looks up model architecture, deployment settings and a provider configuration, then resolves the electricity zone. The [calculation kernel](https://github.com/mlco2/ecologits/blob/3d9c4e8597878eb156abd8eec2c116827a08628d/ecologits/impacts/llm.py) separates:

| Result | Calculation and source family |
| --- | --- |
| Electricity | Output-token GPU regression using ML.ENERGY benchmark data; model-memory GPU allocation; shared non-GPU server power; provider PUE. The host duration uses available throughput/first-token data or the latency regression and can be capped by supplied request latency. |
| Operational carbon | Facility electricity multiplied by the selected zone's `gwp` factor, in kg CO2e/kWh. The documented source is OWID. |
| Embodied carbon | Server and GPU manufacturing-related impacts allocated by modeled hardware time, lifetime and batch size. |
| Top-level GWP | Operational carbon plus allocated embodied carbon. It is broader than our electricity-only carbon component. |
| ADPe | Electricity-related plus allocated embodied mineral-resource depletion, measured in kg antimony-equivalent. Electricity factors come from ADEME Base Empreinte. |
| PE | Electricity-related plus allocated embodied primary energy, in MJ. It is not interchangeable with delivered electricity in kWh. Electricity factors come from ADEME Base Empreinte. |
| Water | `E_IT * (direct_WUE + PUE * electricity_water_factor)`. Direct WUE comes from provider assumptions; electricity-water factors are attributed to WRI. Missing country factors can use world values with warnings. |

Sources: [methodology](https://github.com/mlco2/ecologits/blob/3d9c4e8597878eb156abd8eec2c116827a08628d/docs/methodology/llm_inference.md), [factor loader and units](https://github.com/mlco2/ecologits/blob/3d9c4e8597878eb156abd8eec2c116827a08628d/ecologits/electricity_mix_repository.py), [factor records](https://github.com/mlco2/ecologits/blob/3d9c4e8597878eb156abd8eec2c116827a08628d/ecologits/data/electricity_mixes.json).

The min/max results propagate model and scenario assumptions. They are not empirically established confidence intervals for the user's actual request. Closed-model sizes may be inferred from indirect evidence; model recognition is not measured architecture or calibrated energy. Our current application reproduces a reviewed operational subset with its own four-profile selection rule, not every EcoLogits result or assumption.

For example, to compare our electricity-carbon component with an API result, use `impacts.usage.gwp`, not top-level `impacts.gwp`. Divide kilograms by neither electricity nor token count without retaining the component boundary; converting kg to g requires multiplication by 1,000.

## Documented default versus actual default

Swagger says the omitted electricity zone defaults to `WOR`. The actual wrapper sets the argument to `None` and passes it through. The library then uses the provider's configured country before a final world fallback. Current provider settings place OpenAI, Anthropic, Cohere, Google and Hugging Face in USA and Mistral in SWE. These are assumptions, not per-request location discoveries. Sources: [wrapper](https://github.com/mlco2/ecologits-api/blob/1faf30de8a770dcd73a91025bbdf59fcf4d131c7/app/api/v1beta/router.py), [provider selection](https://github.com/mlco2/ecologits/blob/3d9c4e8597878eb156abd8eec2c116827a08628d/ecologits/tracers/utils.py).

Three live, numerical-only requests used provider `openai`, model `gpt-4o-mini`, output tokens 300 and request latency 1.5 seconds. These called EcoLogits' estimator, not an AI generation API, and contained no user content.

| Zone argument | Facility energy minimum, kWh | Usage GWP minimum, kg CO2e | Implied factor, kg CO2e/kWh |
| --- | ---: | ---: | ---: |
| Explicit WOR | 0.00001740232832301384 | 0.000007975313047154013 | 0.45829 |
| Omitted | 0.00001740232832301384 | 0.0000066894550073665205 | 0.3844 |
| Explicit USA | Same as omitted | Same as omitted | 0.3844 |

The omitted-location response matched the explicit-USA response. Always select the scenario explicitly rather than relying on the documented default.

Swagger example values are also not guaranteed current: its France example says 0.04418 kg/kWh, while the live France factor lookup returned 0.04144. Its estimation example also differs from the executed calculation. Treat examples as examples, not current factor records.

## Factor values and date reconciliation

Live GET requests checked WOR, USA, DEU, FRA and EEE. All returned HTTP 200 and matched the inspected library values.

| Geography | EcoLogits code | 2025 lifecycle factor, g CO2e/kWh | Electricity water in EcoLogits, L/kWh |
| --- | --- | ---: | ---: |
| World | WOR | 458.29 | 3.908 |
| USA | USA | 384.40 | 3.1321 |
| Europe, matching Ember's grouping | EEE | 282.68 | 3.908, world fallback with warning |
| EU-27 | No EU-27 entry found in the inspected EcoLogits file | 209.89671 | Not established by this carbon review |
| Europe, OWID's other grouping | Not the EEE grouping | 271.19 | Not established by this carbon review |
| Germany | DEU | 329.65 | 1.947 |
| France | FRA | 41.44 | 3.6737 |
| Sweden | SWE | 35.26 | 6.0315 |
| Poland | POL | 588.60 | 2.5135 |

Carbon values are from the [dated OWID data](https://ourworldindata.org/grapher/electricity-mix?tab=table&source=total&metric=carbon_intensity&frequency=annual). Water values are library records with separate provenance; a 2025 carbon year does not make water a 2025 measurement. The [EcoLogits tutorial](https://github.com/mlco2/ecologits/blob/3d9c4e8597878eb156abd8eec2c116827a08628d/docs/tutorial/index.md) explicitly identifies EEE as a Europe aggregate. Its carbon value numerically matches OWID's Europe (Ember) row, rather than OWID's differently defined Europe or EU-27 rows.

All 215 carbon coefficients in the inspected library were compared with OWID's latest available observation for the corresponding geography. 214 matched using country codes plus WOR to OWID_WRL; EEE matched Europe (Ember), whose CSV code is blank. Comparison tolerance was 0.00001 g/kWh to allow binary floating-point conversion of kg to g. The numerical matches establish value agreement, not proof of the library's original import process.

Latest matched observation years: 92 records from 2025, 105 from 2024, 15 from 2023, two from 2022 and one from 2009. A data bundle must preserve record-specific years and flag older records instead of labelling every country factor current-year data.

Saved evidence: [all 215 comparisons](ecologits-carbon-factor-comparison-2026-09-14.csv), [original OWID CSV](owid-lifecycle-electricity-2026-09-14.csv), and [original metadata](owid-lifecycle-electricity-2026-09-14.metadata.json). These are research artifacts, not runtime registry inputs.

The downloaded CSV SHA-256 is `96f8a3dfd845f0cfea6bdd16274fe7a97b790c20237ad788bbdfda5ab08aece9`. OWID variable ID is 1295504. The metadata states lifecycle emissions, covering all greenhouse gases and electricity upstream, supply-chain and manufacturing stages. This is annual generation-mix intensity, not a live meter, contractual renewable-purchase factor or directly observed data-center electricity mix.

Programmatic source links exposed by OWID:

- [CSV](https://ourworldindata.org/grapher/electricity-mix.csv?v=1&csvType=full&useColumnShortNames=false&source=total&metric=carbon_intensity&frequency=annual).
- [Metadata](https://ourworldindata.org/grapher/electricity-mix.metadata.json?v=1&csvType=full&useColumnShortNames=false&source=total&metric=carbon_intensity&frequency=annual).
- [Underlying Ember dataset](https://ember-energy.org/data/yearly-electricity-data/).

## How to choose the most defensible scenario

The physically relevant relationship is `carbon = sum over processing regions of facility_kWh_in_region * region_carbon_factor`. If processing shares are known, a combined factor is weighted by the share of AI electricity in each region. User population shares do not provide those electricity weights.

Selection order:

1. Verified request or deployment processing region, with a compatible dated grid factor.
2. A compatible, disclosed provider serving-fleet factor when it covers the relevant workload and accounting boundary.
3. A clearly declared regional scenario when an organization has evidence supporting that assumption.
4. Explicit world scenario when processing location is unknown.

The recommendation for the current unknown-location baseline is `0.45829 kg CO2e/kWh`, or `458.29 g CO2e/kWh`. Display approximately 458 g in explanatory UI while retaining source precision in versioned data. For one Wh of facility electricity, this is approximately 0.458 g CO2e. USA gives 0.384 g, EcoLogits Europe 0.283 g and EU-27 0.210 g. Electricity is unchanged by this carbon-factor comparison. The world result is 19.22% above the USA result for identical electricity; this does not demonstrate greater physical accuracy for a particular provider.

For 2026 activity, label a 2025 factor as the latest annual reference. For historical activity, prefer an applicable year when available, with explicit fallback otherwise. Preserve original results; a source correction or changed scenario creates a separately labelled recalculation.

Do not select Europe because it lowers the number, use a person's IP to locate AI processing, replace lifecycle CO2e with generation-only CO2 without changing scope, or infer zero emissions from a renewable procurement claim.

## Country, language and organization setup

Use separate searchable country and language selectors. A slider is suitable for a numerical quantity, not countries or languages.

Proposed onboarding:

```text
Language: English
Your country: Germany
AI electricity scenario: Automatic
  Processing location unknown: World reference, 2025
```

Language controls interface text. Country can support regional defaults such as date formatting. Neither silently changes the data-center factor. Advanced settings can choose World, Europe (with its definition), EU-27 or a country as an explicitly assumed electricity scenario; separate tool/deployment choices can accommodate different processing locations.

The download website can collect these preferences and carry them into a first-run setup link or the existing organization connection flow. Ship one consistent extension package and apply configuration data after installation, rather than rebuilding extension code per person. This preserves a reproducible package and simplifies updates. The exact browser handoff still needs design and testing.

An organization can supply defaults, and a user can change their language/country and personal scenario. For environmental reporting, record the effective scenario and whether it came from verified evidence, an organization default or a user assumption. Keep a consistent organization comparison view available; personal what-if choices must not silently rewrite company totals. User overrides can remain available without overwriting the organization baseline.

For managed installations, [Chrome managed storage](https://developer.chrome.com/docs/extensions/reference/api/storage) supports administrator configuration. It is read-only to the extension, so overridable defaults and locked policies need separate semantics. Our own company dashboard can deliver the same type of data-only defaults through its existing authenticated configuration channel. Cross-browser policy delivery remains to be designed and verified.

All settings can be edited later in the dashboard. Apply changes to future records, preserve original methods on existing records, and offer a clearly labelled historical recalculation. Bundle reviewed factors for offline use; the normal extension does not need to send every interaction to EcoLogits' API.

Changing the electricity zone also changes EcoLogits' electricity-water and other impact factors, but does not change provider PUE or direct cooling WUE. Country selection cannot establish a complete local water scenario. Our incompatible-water-total protection remains necessary.

## Limits of this review

This review verified source paths, units, all 215 library carbon numbers, selected live factor responses, the omitted-location behavior and the date/scope of the recommended carbon dataset. It did not measure physical AI electricity, locate any private request, validate every model's energy estimate, resolve original WRI water vintages, or certify a complete environmental scenario. No runtime bundle was promoted.
