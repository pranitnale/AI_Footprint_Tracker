# Methodology, fallback selection and multimodal implementation

Confirmed 9 September 2026. This addendum is normative for P0, P1, P3, P5, P6, P7, P8 and release verification. It records the highest-comparable fallback and first-release image-generation decisions. It does not claim that the extension, image adapters or a production estimator are implemented.

Also follow [methodology quality gates](METHODOLOGY-QUALITY-GATES.md), added after the [Offset source comparison](../research/OFFSET-COMPARISON-2026-09-09.md). The original numerical equations/coefficient values remain unchanged. The text registry's promotion metadata now explicitly distinguishes unvalidated reference use from tokenizer validation, measured energy validation and closed-service transfer claims. The new external-reference catalog is not a runtime factor bundle.

## 1. Source and artifact ownership

| Artifact | Purpose |
| --- | --- |
| [Public methodology source](../methodology/content.html) | Reader-facing equations, coefficient provenance, worked examples, boundaries, uncertainty and media treatment. No development-process narrative |
| [Methodology build](../../tools/build-methodology.cjs) | Generates P02 detail content and the standalone local reading page from the article and model catalog. `--check` rejects stale generated output |
| [Numeric/source checks](../../tools/methodology-checks.cjs) | Rejects changes to reviewed numeric snapshots and checks displayed coefficients, example inputs/results and cohort arithmetic |
| [Model catalog](MODEL-CATALOG-2026-09-09.md) and [JSON inventory](../../registry/model-catalog-2026-09-09.json) | Dated recognition/availability evidence; not energy calibration |
| [Text reference profiles](../../registry/text-reference-profiles-2026-09-09.json) | Four explicit dense-model comparator profiles, exact kernel constants and one declared environmental scenario |
| [Arithmetic reference](../../tools/methodology-reference.cjs) | Independent, dependency-free numerical examples for verification. Not the employee production estimator |

The public article cites the exact sources for its coefficients and empirical examples. Keep source facts, project choices, illustrative inputs and derived arithmetic distinct. A source publication/commit date is not automatically the year its factors were measured. Preserve original third-party licensing, provenance and notices. The image reference cohort taken from the ML.ENERGY leaderboard export was removed on 20 October 2026 because the ML.ENERGY leaderboard repository it came from has no licence file; do not relabel an unknown upstream licence.

`--check` validates the text reference snapshot using SHA-256 of its parsed JSON serialization, avoiding line-ending-only differences. It also checks the article's displayed coefficients, inputs, worked results and text cohort examples against the arithmetic reference. A reviewed source correction requires a method-version decision, revised documentation/goldens and explicit digest update. Do not blindly refresh the digest to make a failing build pass.

The model catalog contains 67 records, including 27 observed text-menu choices and separate modes, routers, media and agent records. It is exhaustive only within the inspected account menus, not every rollout or private enterprise configuration. All energy profiles in that inventory remain `not_calibrated`. A source-backed menu entry never becomes a calibrated energy model simply by being listed.

## 2. Calculation boundaries

### 2.1 Text reference

Pin EcoLogits 0.11.1 at commit `886d1ebfadb51a2d6407fcea6d9778c997c85c35` for the published equation reference. Reproduce the usage component only. Do not import its hardware-manufacturing allocation into the operational headline.

For output tokens n, active/total parameters Pa/Pt in billions, batch B, precision q, GPU memory M and allocated GPUs g:

```text
e_gpu_Wh_per_token = aE * exp(bE * B) * Pa + cE
E_gpu_one_kWh = n * e_gpu_Wh_per_token / 1000
memory_GB = 1.2 * Pt * q / 8
g = 2 ^ ceil(log2(ceil(memory_GB / M)))
t_reg_seconds = n * (aL * Pa + bL * B + cL)
t_seconds = min(request_duration_if_available, t_reg_seconds + TTFT)
E_host_kWh = (t_seconds / 3600) * host_power_kW * (g / installed_GPUs) / B
E_IT_kWh = E_host_kWh + g * E_gpu_one_kWh
E_facility_kWh = E_IT_kWh * PUE
```

Exact constants and defaults are in the JSON and public article, linked to the immutable source. If throughput is used, `n/TPS` replaces the regression duration. An absent request-duration cap is unbounded; it is not a made-up elapsed time. Record the chosen duration strategy, TPS/TTFT evidence and any cap in the method identity. The GPU energy already depends on batch size; do not divide it by B again. The 1.2 memory multiplier is not an electricity or cooling multiplier.

This is **output-token-based text inference**, not pure physical decode energy. Benchmark-normalized energy can include average prompt-processing work, but the kernel has no explicit input-length argument. Counting retained old context is required for token usage and context guidance; it does not by itself validate a prefill-electricity coefficient. Extra-long-input, hidden-reasoning and auxiliary-service effects remain explicitly missing or a separately validated profile. An input-aware candidate must beat the baseline on held-out evidence with compatible boundaries before promotion.

The reference seed set uses Meta Llama 3.1 8B/70B and Cohere Command R+ 08-2024/Command A 03-2025. Meta's 8.03/70.55-billion values are library precision; the card names the 8B/70B families. The set maximum is not the largest possible model or a physical upper bound. The confirmed `mistral-large-2512` architecture conflict is quarantined. Do not import all library model entries or proprietary parameter hypotheses without original-source review.

### 2.2 Environmental conversions

```text
C_electricity_g = E_facility_kWh * carbon_g_per_kWh
W_direct_L = E_IT_kWh * direct_consumptive_WUE_L_per_kWh_IT
W_electricity_L = E_facility_kWh * electricity_water_L_per_kWh
W_total_L = W_direct_L + W_electricity_L
```

Starting with facility electricity does not require another PUE multiplication. If its compatible PUE is unknown, carbon can still be computed from a compatible factor, while IT-denominator direct water remains unavailable. Unknown factors are null with reasons. Zero direct WUE is valid only for a documented zero-consumption scenario, not because a field was blank. Do not mix withdrawal and consumption, or location-based and market-based emissions.

The worked common scenario uses the pinned library assumptions: PUE 1.09; direct WUE 0.999 L/kWh_IT; carbon 384.4 g/kWh; electricity water 3.1321 L/kWh. Original measurement years are not encoded in those records. This is a declared library reference, not the actual location of a user’s request or a newly measured 2026 factor. Production review must explicitly approve its rough-reference use or replace it with a sourced scenario. Never choose data-center factors from employee IP.

## 3. Highest-comparable fallback

### 3.1 Required algorithm

1. Prefer the most applicable reviewed model/workload profile. Model identification, tokenizer identification and energy-profile selection are separate decisions.
2. If that profile is missing, derive the known workload signature: task/modality, observable work units, current count scope, available media settings, and known execution/termination evidence. Unknown settings remain unknown.
3. Build the eligible comparator set from the pinned approved registry. Require compatible task, units, workload assumptions, starting energy boundary and calculation scope. Resolve one coherent environmental scenario before comparing facility electricity.
4. Evaluate every eligible candidate on the **same observation and scenario assumptions**. Do not substitute the largest model label or parameter count for numerical evaluation.
5. Select the maximum comparable facility electricity. When only GPU electricity is available, compare GPU values within that explicitly GPU-scoped set. Any later common proportional facility allocation preserves the winning identity and the component scope.
6. Use deterministic ties: ASCII profile ID order within the exact pinned cohort. Preserve the eligible set or its deterministic hash, candidate count, exclusion reasons and chosen profile ID.
7. Return that candidate’s complete vector. Do not independently maximize carbon, direct water and electricity water from unrelated scenarios.
8. Label selection as `highest_comparable`, not `provider_reported`, calibrated model identity or guaranteed upper bound. Display “Highest comparable estimate” and expose proxy/cohort/scope/basis in Details.
9. If there is no compatible set, preserve independently valid text/work counts. A benchmark reference can be displayed separately, but is not a request-specific result and cannot silently enter normal usage totals.

Unknown model identity alone no longer makes resource estimation unavailable when an applicable comparator set exists. Missing hidden reasoning alone also does not suppress useful supported estimates. Invalid data, no comparable modality, missing work-unit counts or incompatible factors still require an explicit unavailable/reference-only state. This exception to always displaying a footprint number is necessary to avoid fabricated measurements.

### 3.2 Required selection metadata

Extend method/result contracts with:

| Field | Meaning |
| --- | --- |
| `profile_selection` | `matched_profile`, `highest_comparable`, `reference_only`, `unavailable` |
| `observed_model_key`, `model_evidence` | Actual recognized model/mode/router evidence; never overwritten with proxy model |
| `selected_profile_id`, `cohort_id`, `cohort_hash` | Immutable selected calculation identity and comparator set |
| `eligible_candidate_count`, `eligibility_signature` | Size of evaluated set and versioned workload/scenario signature |
| `selection_reason` | Allowlisted reason such as unknown model, absent profile or unsupported mode |
| `assumed_settings`, `known_settings` | Separate bounded categorical/numerical metadata; no source text or filenames |
| `starting_energy_boundary`, `result_scope` | GPU, IT or facility starting point; exact covered component |
| `environment_scenario_id`, `factor_provenance_status` | Coherent factor vector, source snapshot and original-year status |
| `reference_only` | True for a comparator not applicable enough to estimate this request; excluded from usage contribution |

Do not report the fallback model as the model the employee selected. Personal/company tool breakdowns use the observed tool/model; method breakdowns identify the proxy separately. Historical method results are not silently overwritten when the cohort changes. Register a new method/cohort version and offer a separate recalculated view.

## 4. Image generation is first-release scope

Support image-generation and image-editing observation where the consumer app actually exposes those workflows. This does not imply every one of the four websites has a native image generator or that every plan exposes one. An absent site feature is not an adapter defect; a present feature with unverified capture remains experimental and blocks a claim of full support for that combination.

### 4.1 Counting and identity

- Count an actual observed generation dispatch, not an image appearing in the DOM, a page asset request, cache hit, library preview, thumbnail, download or reopened history.
- Correlate the user request, attempt, actual image-generation operation and output identities locally. Reconnects, partial renders and replacement previews revise the same operation.
- Keep image edit, new text-to-image generation, inpainting, upscaling and ordinary image display distinct. A follow-up edit can be a new generation even if the source image is unchanged.
- Determine actual returned output count where possible, not only requested count. Record requested/returned count separately and partial/cancelled/error state. Never infer no compute solely because no final image was delivered.
- Distinguish full output dimensions from preview dimensions. Do not decode or upload image pixels solely to supply company analytics. A decoded local image may supply dimensions if already in the authorized flow; no guessed private fetches.
- Text used to generate an image is not automatically a separate language-model execution. Count an auxiliary generation only when independently observed; avoid adding it to an image profile that already includes that processing.
- SVG/HTML/code rendering is not a raster-model generation merely because its output looks like an image.

### 4.2 Image energy reference

Superseded. This section first specified a GPU-only reference from 208 ML.ENERGY image configurations, kept outside the totals. On 3 October 2026 image generation moved to the EcoLogits method: each generated image is estimated at 2.907 Wh of IT energy (Luccioni, Jernite and Strubell, ACM FAccT 2024) times the provider PUE, added to the totals. On 20 October 2026 the ML.ENERGY figures were removed because the leaderboard repository they came from has no licence; the [public methodology](../methodology/content.html) cites the leaderboard (Chung et al., NeurIPS Datasets and Benchmarks 2025, https://ml.energy/leaderboard/) as an external comparison without reproducing its numbers.

A leaderboard figure is GPU-device energy already normalized per image; any comparison must not multiply it by GPU count or divide it by batch size again, and must not present it as complete image-operation energy. No linear pixel/step scaling or diffusion-to-autoregressive equivalence is approved.

### 4.3 Image input and files

Image-input tokenization requires a validated consumer-to-model rule and actual preprocessing evidence. Store observed original/resized/thumbnail dimension status separately. The public article links current Anthropic patch rules, OpenAI model/detail schemes and Gemini media rules; these developer API definitions are not automatic mappings for the consumer websites.

Documents need separate local text extraction, page-image/OCR and retrieval coverage. Byte size, page count and a generic tokens-per-page range are not exact input or energy values. Count the known text once. If the provider uses an image representation as well, retain it as a separate input component. A historical uploaded file can be used again as context without a new upload; old upload time does not exclude its contribution to the current request.

PDF, plain text, office files, spreadsheets, slides and scanned documents each need fixtures. Capture file metadata only from the already authorized user flow. No real prompts, documents, image pixels, filenames, source URLs, embeddings or content hashes enter company telemetry.

## 5. Observation-contract amendment

Target the extended observation schema as **1.1.0** before product implementation freezes. Both request and attempt consumers, local storage, sync, server validation, numeric recalculation and exports must use the same schema. There is no released 1.0 product migration to perform, but older documentation examples are not authority to discard new media fields.

Add bounded `media` metadata to request/attempt records. Request media owns `input_images`, `requested_operations` and `coverage_reasons`; attempt media owns executed `image_operations`, `generated_images` and `coverage_reasons`. Each category may be empty or unknown with an explicit status. Do not copy request intent into an additional generated-output contribution. Group repeated identical numerical settings to cap record size. The canonical executed attempt is authoritative for returned-image counts and image resource contributions.

| Category | Allowed data |
| --- | --- |
| Input images | Count; origin (`new_upload`, `retained_context`, `unknown_origin`); known dimensions; dimension source (`original`, `provider_resized`, `thumbnail_only`, `unknown`); approved detail/media-resolution enum; token-profile identity and scoped count when available |
| Requested operations | Request intent, local opaque correlation key, operation kind and requested output count/settings; not evidence of executed work or returned output |
| Image operations | Local opaque operation key; kind (`text_to_image`, `image_edit`, `inpaint`, `upscale`, `unknown`); requested/returned image counts; state; known numerical settings; observed model evidence |
| Generated images | Grouped returned count; known full dimensions and provenance; numerical settings or unknown; associated local operation key |
| Documents | Existing type/count metadata plus bounded page-count/extraction coverage where observed; no names, text or document hashes |

Use Counter strings for counts and existing measurement objects for token estimates. Dimensions and bounded structural values use validated integers. Source-specific free-text settings are not allowed: map through a reviewed enum or mark unknown. Cap at 100 grouped media entries per observation; exceeding the cap sets `media_metadata_limit_exceeded` and preserves the original provider action. This cap is a project safety limit, not a provider upload limit.

Add feature categories `image_input`, `image_generation` and `image_edit`. Retain legacy `image` only as an explicitly normalized unknown-direction compatibility category. Add token components `image_input_tokens` and `image_output_tokens` only with a verified scope. A binary image cannot be tokenized as plain text; absence of a provider count does not become zero output tokens. The output image count remains independently useful.

Observation skeletons still record dispatch and execution evidence. A stopped job with zero returned images must not be estimated as zero electricity simply by multiplying image count by zero. Preserve any supported partial estimate, otherwise reference-only/unavailable with execution evidence. Failed uploads before dispatch are not generated-image requests.

## 6. UI and aggregation

The compact bar keeps its current units and approximate marker. Unknown-model estimates with a valid cohort use “Highest comparable estimate” in the status/detail explanation. Details shows observed model, selected proxy, cohort scope/date, known versus assumed settings and missing components. Image work adds generated-image count and a separate image/component section. Input-image tokens are not quietly relabeled as ordinary typed input.

C10/S06 remain valid only for genuine unavailable components, invalid capture or no comparable method/factors. They are not the automatic screen for every unrecognized model or hidden-reasoning gap. A reference-only number has its own reference label; it must not be presented as a successful request-specific measurement. Add an image-generation example and an unfamiliar-model fallback specimen without shifting existing Fern v1 anchors.

Company totals retain selection/coverage breakdowns: matched-profile estimates, highest-comparable estimates and separately available benchmark references. Reference-only figures never silently contribute to normal usage totals. GPU-associated image estimates and broader text/IT estimates are separate scoped subtotals unless a reviewed common partial-coverage aggregation is explicitly defined and labeled; no unqualified complete-operation total is fabricated. Request counts remain independent of estimation success.

The server recomputes from accepted numerical observations and the same immutable method/cohort/scenario versions. The browser's result is not an authoritative server number. Unknown model fallback must be deterministic on both sides, including tie order, candidate filters, factor versions and unit conversion. Credentials and raw content remain outside this path.

## 7. Phase-specific work

| Phase | Required additions and exit evidence |
| --- | --- |
| P0 | Freeze schema 1.1.0, modality/settings enums, selection metadata, coefficient licenses, dataset provenance and reference-only aggregation rules |
| P1 | In every applicable site/browser, capture new image, multiple images, edit/regenerate, stop/fail, history/reload, thumbnail/download, input image, text PDF, scanned PDF and office-file cases; record native feature availability separately from parser coverage |
| P3 | Validate text/image tokenizer mappings and preprocessing rules without live-content API uploads. A media catalog label is not a tokenizer profile |
| P5 | Normalize generation operations, media direction, stable identities and output dimensions; preserve host Send/Stop/upload streaming; no duplicate counting of asset requests |
| P6 | Implement pinned equations and eligible-profile argmax; confirm image joules are already per image; preserve GPU scope and coherent factor vectors; quarantine inconsistent model entries |
| P7 | Extend local/server validation, replay/deduplication and aggregates for media and method selection. Recompute both sides with identical versions and Decimal arithmetic |
| P8 | Publish the full methodology, source links and dated model inventory; add accessible fallback/media Details; keep numbered examples clearly distinguished from live data |
| P10/P11 | Execute the new FM/IM gates, browser noninterference tests, privacy-marker checks, source/update drift tests and a first-release image pilot |

## 8. Required checks

All rows below are production acceptance requirements. Offline arithmetic/prototype tests cover only their implemented reduced subsets.

| ID | Scenario | Required outcome |
| --- | --- | --- |
| FM01 | Exact pinned constants and Command A worked example | GPU, host, IT, facility, carbon and both water components reproduce independent golden values |
| FM02 | Facility starting energy and unknown PUE | No second PUE multiplication; preserve compatible carbon; direct IT-water unavailable when IT cannot be derived |
| FM03 | Missing/blank/invalid/negative factor | No coercion to zero; failure scoped to affected component |
| FM04 | Withdrawal factor used for consumptive water | Reject incompatible definition |
| FM05 | Unknown model with eligible text/image cohort | Numerical maximum of all eligible profiles selected; real observed model remains unchanged |
| FM06 | Candidate with largest carbon/water differs from largest electricity | Whole selected vector retained; no synthetic independent maxima |
| FM07 | No eligible model, known incompatible settings or missing work units | Explicit reference-only/unavailable result; valid independent metrics retained |
| FM08 | Cohort change, deterministic tie and browser/server recomputation | Versioned stable choice and matching units; no silent historical rewrite |
| FM09 | Unverified proprietary parameters or confirmed registry conflict | No calibrated badge or silent use; quarantined entry excluded |
| FM10 | Reasoning hidden; final output empty after known execution | Useful scoped estimate where supported, never inferred zero work |
| FM11 | Published mean/median/SD/extreme, factor year and source boundaries | Correct labels; no fabricated confidence interval or mixed boundary comparison |
| FM12 | Public page, JSON and generated P02 drift | Build check fails; formula/source links and example values match canonical content |
| IM01 | First image-generation dispatch | One request with media-operation evidence, independent of thumbnails |
| IM02 | Partial/final image variants, duplicate frames and reconnect | Same operation/output revised, not repeatedly counted |
| IM03 | Requested images differ from returned images | Both counts retained with outcome; no assumed completed output |
| IM04 | Image edit, inpaint, upscale and plain SVG rendering | Correct operation class; no automatic text-to-image factor substitution |
| IM05 | Reopen old image, download, cache and preview requests | No new generation consumption |
| IM06 | Existing conversation with old images/documents plus a new message | Relevant retained context considered; old uploads not recounted; only new request added |
| IM07 | Actual image dimensions versus thumbnail dimensions | Correct provenance; no thumbnail-based match to a full-image benchmark |
| IM08 | All 208 image candidates and known-settings filter | Correct maximum, compatible subset and deterministic identity |
| IM09 | Per-image energy with multiple GPUs/batching | No second GPU multiplication or batch division |
| IM10 | GPU-only source with scenario-based environmental allocation | Component scope retained; host/idle not silently invented |
| IM11 | Different resolution, step count, precision or generation architecture | No unvalidated linear scaling or claimed exact profile match |
| IM12 | Input-image token formula and resize/detail variants | Applicable model rule verified; API rule not automatically assigned to website |
| IM13 | PDF text, page image, OCR and selected retrieval chunks | Overlap handled; unobserved processing explicitly missing |
| IM14 | Stopped/failed image job without delivered image | Execution evidence preserved; no false zero resource cost |
| IM15 | Private markers in filenames, pixels, PDF text and URLs | Absent from company traffic, logs, exports and public fixtures |
| IM16 | Chrome/Edge/Firefox under upload, streaming, parser failure and slow server | AI host remains usable; enabled/disabled overhead measured |
| IM17 | Native image feature absent or plan-gated | Honest applicability state, not a false implementation failure or invented capability |
| IM18 | Media metadata exceeds cap | Original task unaffected; diagnostic and partial metadata, no silent loss |
| IM19 | Reference-only and GPU-component records in monthly/company totals | Scope/selection breakdown preserved; no reference-only normal contribution |
| IM20 | Saved canvas comments, anchors, citation links and full methodology scrolling | Existing review intact; new content readable, editable/commentable and keyboard accessible |

## 9. Handoff commands

```powershell
node tools/build-methodology.cjs
node tools/build-methodology.cjs --check
node --test tools/methodology-reference.test.cjs tools/methodology-checks.test.cjs design-canvas/test.cjs
node --test fixtures/browser-audit-2026-09-09/reference.test.mjs
node design-canvas/serve.cjs
```

Use `/methodology` for the standalone reading page and `/?screen=P02` for editable/commentable canvas review. The static server stays loopback-only and read-only. External citations open only when followed; the page does not run analytics, remote fonts or third-party calculation calls. Source evidence under `.firecrawl` is ignored by Git. The public JSON records and links, not that local cache, are the durable handoff.
