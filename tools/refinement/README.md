# Refinement verification tools

These tools support the modular extension and EcoLogits refinement. They run in the developer environment and are excluded from runtime extension code.

`freeze-original-estimator.ts <new-fixture-path>` captures synthetic inputs and exact original-engine outputs before refactoring. It records the baseline method identity, working-tree source hashes and Git head. It refuses to overwrite a file. The accepted fixture is `packages/estimator/test/fixtures/legacy-refinement.json`; ordinary tests read it and never regenerate expected outputs.

This characterization corpus protects legacy behavior. Independent existing Python parity and upstream EcoLogits oracle checks have separate purposes and remain required. A passing characterization test does not prove physical accuracy or the complete release matrix.

## Offline engine comparison

Run from the repository root with explicit fixture and new output paths:

```text
node --import tsx tools/refinement/compare-engines.ts --fixtures tools/refinement/fixtures/engine-comparison.json --output tools/refinement/.test-runtime/comparison
```

The command writes `<output>.json` and `<output>.md` and refuses existing output files. Optional `--build-config <path>`, `--mappings <path>` and `--media <path>` select explicit validated alternatives; otherwise it reads `config/estimation.build.json`, `config/estimation.mappings.json` and `config/estimation.media.json`. It reads only those specified files and the known local source/citation manifests. It does not read browser storage, user conversations, environment credentials or provider traffic, and it performs no network request or tokenization.

The fixture format is `engine-comparison-fixtures-1` with `provenance: "synthetic_numeric_only"`. Native cases contain bounded identifiers, supported site/model identities, language tags and decimal-string/null token observations. Unknown models use null or a recognized but unmapped model ID. An unknown underlying provider is represented by the existing opaque-router site; an invented provider/site is rejected. Extra text, title, real request-identity and credential fields are rejected. All assembled live/history observations pass the actual shared schemas before execution. For history, `tokens.answer` is the recorded message count and `history_role` determines eligibility; other counts and execution claims must be absent/null. Language tags label synthetic fixtures and never alter or validate token counts.

Every case runs through the actual `LocalEstimateExecutor` for the original method, the configured EcoLogits method, and an EcoLogits policy with original-engine fallback for missing provider models. Existing direct mappings and explicit model overrides keep their normal precedence. Fixture `policy_variants` may add complete validated fallback policies for override/unavailable scenarios. Each distinct policy gets the normal method identity and hash. The supplied fixture covers 19 numeric cases and four explicit policy variants, including zero, missing/unsafe counts, multiple language tags, opaque routing, historical prompt/response scope and an unsupported video-profile override. It does not create a video observation.

JSON retains full validated envelopes, requested/effective method IDs/hashes, profile selection/reasons, input/output hashes, missing components, raw original/EcoLogits output, source manifests, the original environment and full EcoLogits method definitions. Markdown separates operational usage from raw source phases and preserves endpoint ranges. The report credits EcoLogits and its requested JOSS citation.

Deltas use the estimator's 48-digit, half-even Decimal constructor. Native deltas compare each engine's displayed operational scalar or midpoint under its native profile/environment policy. These are not a controlled hardware/region experiment, an interval subtraction, a probability statement, an avoided-impact claim or physical accuracy evidence. A zero denominator gives a null relative delta with `zero_reference_value`. Missing values remain null; incompatible units, scope or water-source categories suppress the delta with a reason. Full underlying values and ranges remain visible.

### Controlled mathematical comparisons

The separate `controlled_cases` fixture list has four fields: a bounded `id`, decimal-string `output_tokens`, a `profile_id` from the unchanged four-profile original reference cohort, and `environment` equal to `baseline-reference` or `synthetic-unity`. The supplied fixtures include seven cases covering all four scalar profiles, both environments, mathematical zero and a count outside binary64's exact integer range. Missing lists produce no controlled cases; undeclared profiles, arbitrary ranges/timing parameters and extra fields are rejected. Unsafe counts retain their exact input and an unavailable result instead of being rounded.

`controlled-comparison.ts` calls the existing original `textEnergy` and `environmentalAllocation` functions and the raw EcoLogits `computeLlmImpacts`/DAG functions. Both receive the same scalar architecture, output count, coefficients, precision, memory allocation, batch size, host/GPU settings and environmental factors. Timing uses the common uncapped regression with no TPS or TTFT override. Decimal and binary64 representation and evaluation order remain the arithmetic differences under examination. No provider lookup, winning-cohort selection, replacement formula, catalog change or production method registration occurs in these cases.

The baseline environment uses the original reference factors and keeps their existing qualifications. The explicitly synthetic unity environment uses PUE 1, carbon 1 kgCO2e per facility kWh, direct water 0 L per IT kWh and upstream water 1 L per facility kWh. These numbers are arithmetic controls with no claimed physical location. Carbon converts grams to kilograms on EcoLogits input and back to grams for comparison; direct/upstream water denominators remain distinct.

Only compatible operational quantities get cross-engine differences. Direct water's source coverage remains unresolved and total water remains unavailable. Original has no embodied, ADPe or primary-energy counterpart. EcoLogits-only embodied defaults and synthetic zero ADPe/primary-energy factors remain visible in its full raw output and are excluded from differences. Ranged architectures, over-200-billion legacy profiles, alternative timing and nontext workloads are outside this common-input protocol; the report makes no consumer hardware equivalence claim. A zero-token mathematical result is not evidence of zero physical work.

Report schema `1.1.0` labels native and controlled modes separately. Each controlled case records the complete shared inputs, protocol/control hashes, immutable original bundle/source identity, EcoLogits core identity, actual core inputs as finite decimal strings, allocation intermediates, full raw outputs and output hashes. The source manifest additionally hashes the comparison code and the original mathematical functions. Controlled cases are developer artifacts and never masquerade as saved product envelopes. [The generated comparison](reports/engine-comparison-controlled-2026-09-15.md) and its [JSON evidence](reports/engine-comparison-controlled-2026-09-15.json) cover both modes.

Focused checks:

```text
node node_modules/typescript/bin/tsc -p tools/refinement/tsconfig.json
node --import tsx --test tools/refinement/test/*.test.ts
```

Suggested root script value for parent wiring: `"compare:engines": "node --import tsx tools/refinement/compare-engines.ts"`. Root manifests are not edited by this task.

## Future organization response admission

`packages/estimator/src/engines/remote-admission.ts` exports `createRemoteEstimateExecutor`, `admitRemoteEstimationResponse`, `RemoteEstimationFailure`, `RemoteTransportFailure` and their binding/request types. No endpoint, network transport, authentication implementation or production activation is provided.

The factory implements the existing `EstimateExecutor` contract. Configuration contains a trusted `MethodRegistry`, exact catalog JSON bytes plus source identity, a personal/company context, an operation UUID with generation/revision, an `isCurrent` guard, and an injected transport. Company/installation IDs are opaque hashes. Personal mode rejects before transport. The company context is supplied by a trusted caller after its separate authorization/capability decisions; this helper does not authenticate that context or implement tenant permissions.

The returned executor declares immutable `executionOrigin: "organization"`. This is trusted composition metadata so the caller can refuse routing local-only archived read grants to an organization transport. It is not authentication or upload permission. The composition layer owns grant routing and must not treat missing origin metadata as permission to consume a local-only grant.

Catalog identity and SHA256 bytes must match the accepted method definition, and the loaded core identity must match too. The factory constructs its own catalog runtime from verified bytes and reuses existing profile resolution/policy/numeric admission. A caller-supplied presence predicate cannot authorize a replacement profile. Unknown methods, invalid dependencies, unavailable observations and unsupported EcoLogits numeric inputs fail before transport with sanitized codes; wider original-engine counts remain independent.

The request is `{schema_version, accepted, observation}`. `accepted` binds company correlation, operation/generation/job revision, observation source/revisions, calculation input hash, exact requested/effective method identities, resolved selection/fallback, auxiliary image-method hash and view lineage. The transport response is strictly `{schema_version:'1.0.0', correlation, envelope, output_hash}`. Envelope schema 2 must have `execution_origin:'organization'`; every accepted binding field must match. Even an internally consistent response with a recomputed hash cannot substitute an original fallback where the accepted policy chose an upstream profile.

The output digest is consistency and identity checking, **not authentication or proof that a remote numerical calculation is correct**. Response data is bounded to 2 MiB and parsed through the real envelope schema. Abort/current-generation guards run before sending and after waiting/admission; late responses cannot fulfill a cancelled or superseded call. The eventual storage caller must still enforce its final ownership/revision/erasure publication guard. Remote capability negotiation, authenticated transport, server computation and real endpoint activation remain future work.

Bounded retries, per-attempt deadlines, typed HTTP/offline failures and an explicitly configured exact-method local fallback are implemented behind the injected transport. Retries keep the same frozen operation and accepted input binding; cancellation does not release a physical operation slot until its promise settles. Offline fallback must match the full requested method identity and every accepted result binding, and its result retains `execution_origin: "local"`. The executor's declared destination remains `organization`, so fallback does not grant access to local-only archived inputs. See the [estimator retry and fallback contract](../../packages/estimator/README.md#dormant-remote-retry-and-fallback-contract) for bounds, Retry-After handling, terminal statuses and fallback admission.

Fake transports exercise this real helper against actual local executor results. Tests cover personal refusal, accepted original fallback, altered correlation/source/method/output identities, self-consistent unauthorized fallback, malformed/oversized response data, invalid catalog/source identities, unsupported counts, cancellation, supersession and sanitized failures. Additional cases cover unknown-completion timeouts, stable retry identities, bounded backoff/status handling, exact local fallback, retained unsettled slots and late results. These are offline contract checks; no physical remote calls, live-server behavior or installed-browser runtime behavior is claimed.
