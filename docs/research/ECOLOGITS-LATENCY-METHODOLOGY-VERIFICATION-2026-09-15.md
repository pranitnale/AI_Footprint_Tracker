# EcoLogits methodology and application verification

15 September 2026. The owner explicitly requested direct in-app browsing of the detailed methodology after the web fetcher failed. The [LLM inference page](https://ecologits.ai/0.11/methodology/llm_inference/) opened successfully in the in-app browser. Its generation-latency section, expanded alternative regression, environmental allocation and limitations were read. The earlier fetch failure remains historical and no longer means this page is unverified.

## Meaning and calculation

EcoLogits models generation time on the server, excluding network delay. It uses catalog time-to-first-token and throughput when present. Otherwise, its fallback estimates per-token duration from active parameters and batch size. An observed request duration limits the modeled duration from above. The absent-duration path imposes no cap.

The model's selected duration affects host-server energy and embodied allocation. GPU energy has a separate token-based regression. The methodology also assumes a hardware, batching and environmental scenario; timing alone does not establish physical accuracy.

Sources: [generation latency](https://ecologits.ai/0.11/methodology/llm_inference/#estimating-the-generation-latency), [server energy](https://ecologits.ai/0.11/methodology/llm_inference/#server-energy-consumption-without-gpus), [upstream implementation](https://github.com/mlco2/ecologits/blob/886d1ebfadb51a2d6407fcea6d9778c997c85c35/ecologits/impacts/llm.py#L66).

## Corrections to the conversational explanation

- `request_latency` is the supplied request-time observation. It is not the same quantity as the internal modeled `generation_latency`, and it is not time to first token alone.
- Browser dispatch-to-completion timing is an elapsed-time proxy that includes networking and scheduling. It does not directly measure GPU or server inference time.
- A whole tool-using chat turn may combine several inference calls and external work. A duration and its output count must refer to the same supported workload before they can be admitted together.
- The pinned SDK's exact timer placement varies by path. The Anthropic non-streaming wrapper times the wrapped API call; its streaming text helper begins its timer during consumption after the stream has been opened. Do not claim every SDK path has an identical start event. See the [upstream tracer](https://github.com/mlco2/ecologits/blob/886d1ebfadb51a2d6407fcea6d9778c997c85c35/ecologits/tracers/anthropic_tracer.py#L38).
- Historical block, reasoning and workflow fields establish available partial timing, not a validated full request cap. The earlier historical inspection's examples and qualifications remain applicable.

## Application checks performed

- `pnpm --filter @footprint/ecologits-core test`: 19 tests passed, zero failed or skipped. Its emitted differential reports cover 976 boundary cases and 3,659 catalog/seeded cases against the locked actual Python implementation. Source identities, deterministic catalog generation and negative validation checks passed. Log: `.test-runtime/ecologits-methodology-reverification.log`.
- Three focused estimator test files: 36 tests passed, zero failed or skipped. These exercise engine execution/selection/fallback, historical projection and frozen Original numerical/lineage behavior. Log: `.test-runtime/ecologits-application-reverification.log`.
- Opus 4.8 with 2,084 output tokens: the modeled time is 37.56103448275862 seconds. Supplied durations absent, 1.5 and 50 seconds produce selected durations 37.56103448275862, 1.5 and 37.56103448275862 seconds. The GPU regression component is identical in all three runs. Numeric evidence: `.test-runtime/ecologits-latency-cap-reverification.json`.
- The preceding live API comparison reproduced all 26 numerical impact values in each of two matched-input cases. The saved original app-executor raw output also matched the corresponding API result. Evidence: `.test-runtime/ecologits-api-discrepancy-evidence.json`.

No new numerical implementation discrepancy was found in these checks. They do not certify every possible input, installed-browser behavior or environmental accuracy. The existing native-browser and external release gates remain pending.

## Current application policies and precision priorities

The application deliberately supplies no measured latency. It uses the selected upstream model's timing data and the pinned provider-default environment. It retains raw source intervals and all source impact phases, but presents operational-only headline carbon. Direct and upstream water remain separate; the product withholds a combined water total under the previously approved category-compatibility policy. Those are application policies, not missing arithmetic in the port.

The page's rounded regression coefficients must not replace the pinned implementation's full precision. There is also a specific data-summary difference: the page lists Anthropic's upper datacenter WUE as 0.99, while the pinned Python provider configuration uses 0.999. Our catalog preserves the Python value and reproduces the API. This difference is documented rather than silently changing the versioned dataset to match the prose table.

For greater practical precision, prioritize provider-reported output usage where exposed, reliable assembled-text counting otherwise, correct model identity, and explicit handling of hidden reasoning, tools and missing observations. Better browser timing cannot compensate for an incorrect model or workload. Do not infer serving location from the user's location. Unknown proprietary architecture, hardware and environmental assumptions remain labeled estimates.

EcoLogits can be selected as the primary engine for supported text observations. It does not count tokens or capture requests. The verified video core remains inactive without reliable video observations, and there is no general EcoLogits image-generation estimator in this release. Unsupported quantities remain unavailable or use an explicitly labeled applicable fallback; Original is not a calibrated substitute for missing physical evidence.

No product code, default, fallback rule, browser package or saved user preference was changed during this verification. The owner has been asked whether an EcoLogits-default build should replace the earlier same-provider flagship policy with Original for missing models. That choice remains separate from numerical correctness. Existing Advanced preferences, retained originals and method-versioned recalculation must remain intact when the selection policy changes.
