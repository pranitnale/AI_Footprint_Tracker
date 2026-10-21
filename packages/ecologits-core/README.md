# EcoLogits calculation core

Offline, pure TypeScript port verified against EcoLogits 0.11.2. The unchanged calculation implementation retains core identity `0.11.1-port.2`; the catalog, source and native package are pinned to 0.11.2. The package provides text and video arithmetic and catalog lookup. It contains no browser, storage, organization, network, clock, provider SDK or tokenizer dependency. Video arithmetic does not activate video capture or establish website support. Fidelity to the source is not physical calibration of a closed provider model.

This package is an independent MPL-2.0 port. See [NOTICE.md](NOTICE.md), [LICENSE](LICENSE), [DISCREPANCIES.md](DISCREPANCIES.md), [VERIFICATION.md](VERIFICATION.md) and the function-level [source map](source-to-port-map.json). EcoLogits is developed by its contributors and is part of CodeCarbon. Please preserve its [preferred citation](CITATION.cff): Rincé and Banse (2025), *EcoLogits: Evaluating the Environmental Impacts of Generative AI*, [JOSS 10(111), 7471](https://doi.org/10.21105/joss.07471).

## Public API

Import from `@footprint/ecologits-core`. The names below are exported by `src/index.ts`; snake_case input/output fields retain the upstream naming.

For method manifests that must not load the engine or catalog, import `ECOLOGITS_IDENTITY` from `@footprint/ecologits-core/identity`. This subpath imports only the small JSON identity. The main package import loads the baseline catalog and calculation code.

```ts
import { llmImpacts, resolveLlmInput, validateLlmInput, validateImpacts,
  admitTokenCount, ECOLOGITS_IDENTITY } from '@footprint/ecologits-core';

const count = admitTokenCount('1000');
if (!count.ok) throw new Error('Numeric domain is unavailable');
const request = {
  provider: 'cohere', model_name: 'command-a-03-2025',
  output_token_count: count.value, request_latency: null,
};
const resolved = resolveLlmInput(request);
if ('input' in resolved && validateLlmInput(resolved.input).ok) {
  const raw = llmImpacts(request);
  if (validateImpacts(raw).ok) {
    // Bind the numeric inputs and ECOLOGITS_IDENTITY into the application method.
    // Preserve raw before selecting a product phase or formatting a midpoint.
  }
}
```

| API | Contract |
| --- | --- |
| `llmImpacts(LlmLookupInput)` | Resolve provider/model/region, then return full `ImpactsOutput`. Missing model/zone produces a structured error output. Omitted/null duration is uncapped; zero is a real zero cap. |
| `videoImpacts(VideoLookupInput)` | Resolve video model/hardware/region and audio weighting. No request-latency argument exists at this layer. Omitted region is `WOR`; explicit null uses the provider default. |
| `resolveLlmInput`, `resolveVideoInput` | Return `{input, model, electricity_mix}` or a structured error output. Use these to bind profile, environment and numeric-input provenance. |
| `computeLlmImpacts(LlmInput)` | Low-level parameter/environment calculation, with source defaults and paired parameter endpoints. No provider lookup or warnings. |
| `computeVideoImpacts(VideoInput)` | Low-level video arithmetic, including an optional measured request cap. Power input is kW. |
| `computeLlmImpactsDag`, `computeVideoImpactsDag` | Return every input and intermediate asset. Explicit `request_latency` is required. Infinity is the raw uncapped sentinel; null is not a DAG default. |
| `executeLlmDag`, `executeVideoDag` | Exact explicit-asset override surface. All dependency inputs must be supplied. Any pre-supplied asset, including null, skips its computation; dependent required nulls fail. |
| `catalog`, `ECOLOGITS_IDENTITY`, `findModel`, `findElectricityMix`, `findVideoModel` | Immutable full baseline catalog, small runtime identity and exact case-sensitive lookups. No inferred model matching. |
| `createCatalogRuntime(Catalog)` | Copy/freeze an explicitly supplied catalog and return isolated find/resolve/calculate functions, candidate-bound status/model/electricity loaders, and pure repository constructors. Checks supported schema and basic reference/duplicate constraints. It never replaces or mutates the baseline runtime. |
| `range`, `add`, `multiply`, `divide`, `equal`, `less`, `lessEqual`, `greater`, `greaterEqual`, `mean` | Source-compatible paired endpoint operations. These are deliberately not general interval arithmetic. |
| `impact`, `addImpacts`, `compareImpacts`, `output`, `errorOutput`, `addOutputWarning`, `addOutputError` | Source value/phase/status helpers. Warning codes deduplicate; errors append. Output updates return a new object instead of mutating a prior result. |
| `modelFromJson`, `createModelRepository`, `electricityMixFromJson`, `createElectricityRepository` | Typed reference-domain loaders and immutable repositories. Source alias overwrite semantics remain visible. Baseline conversion rejects alias ambiguity. |
| `parseResolution`, `durationToFrames`, `parseValueOrRange` | Source video parsing and frame helpers. Named sizes: 720p, 1080p, 4k. Positive duration uses `trunc(24 * seconds + 1)`. |
| `admitTokenCount`, `validateLlmInput`, `validateVideoLookupInput`, `validateVideoInput`, `validateImpacts` | Separate strict product boundaries. Video lookup admission must run before lowering. These functions do not repair, clamp or silently reinterpret raw source results. |

`ValueOrRange` is `number | {min: number, max: number}`. A degenerate range stays a range. Raw results use binary64 numbers. No decimal serialization or headline policy belongs here.

`Impacts` contains `energy`, `gwp`, `adpe`, `pe`, `wcf`, `usage` and `embodied`. Each metric is `{type, name, unit, value}`. Usage has all five metrics plus `{type: 'usage', name: 'Usage'}`. Embodied has GWP, ADPe and PE plus `{type: 'embodied', name: 'Embodied'}`. Top-level GWP/ADPe/PE include usage plus embodied. Energy and WCF are usage-only. Units are exactly `kWh`, `kgCO2eq`, `kgSbeq`, `MJ`, and `L`. No training or embodied water is invented.

`ImpactsOutput` adds `warnings` and `errors`, each null or an array of `{code, message}`. On lookup failure all five metrics and both phases are null, warnings is null, and errors contains the source code and message. Other raw exceptions use `EcoLogitsError.pythonType` and `name`, including `ValidationError`, `TypeError`, `ValueError`, `KeyError`, `ZeroDivisionError`, `OverflowError`, and `ModelingError`. Python-specific traceback/validation-rendering strings are not a cross-language API. Product callers must sanitize diagnostics.

Inputs use billion parameters, tokens, seconds, GB, bits and kW. Electricity factors are per kWh. PUE and WUE follow the source's exact allocation. No user IP selects a region. Every original catalog record and source link is retained separately from normalized loader output, including when a source loader discards a field.

## Admitted domain

Raw math intentionally retains upstream defects and permissive negative/nonfinite behavior where represented by typed inputs. Product input validators accept finite numeric values, ordered nonnegative ranges where supported, positive divisors, positive model parameters and safe nonnegative integer token counts. PUE must be at least one at both endpoints. Active parameter endpoints cannot exceed their corresponding total endpoints. Regression coefficients may be signed. Missing/null/zero are distinct; only documented optional fields admit null. Booleans, numeric strings in calculation objects, unknown keys and ranges in scalar-only fields are rejected.

Keep persisted counters as decimal strings until `admitTokenCount`. Values above `9007199254740991` remain outside the new engine domain; they must remain recorded and explicitly unavailable to this engine. The original estimator's domain is independent.

Video product admission is sequential: call `validateVideoLookupInput(request)` before `resolveVideoInput(request)`, then `validateVideoInput(resolved.input)`, and finally `validateImpacts(result)`. The first step rejects zero/negative/nonfinite or coercible duration, nonboolean audio, malformed resolution, unsupported keys and invalid environmental overrides. This matters because raw zero duration intentionally becomes one frame and cannot be detected after lowering. Null location/PUE/WUE retain their documented default meanings.

Low-level video validation requires positive safe integer dimensions and frame count, and exact binary64 representation of area, area squared, area times frames, and frames squared before float regression. Larger Python integers, arbitrary Pydantic coercions, arbitrary Python objects, and locale-dependent Python formatting are outside the TypeScript reference API. The raw electricity loader supports ASCII numeric strings, not Python float's additional Unicode decimal forms. Always validate the output too: the source can return negative/nonfinite scalar estimates for extrapolated inputs. A product may impose narrower profile-capability bounds separately.

## Reproducibility

From the repository root:

```text
uv sync --project packages/ecologits-core/oracle --frozen
pnpm --filter @footprint/ecologits-core typecheck
pnpm --filter @footprint/ecologits-core test
pnpm --filter @footprint/ecologits-core test:release
pnpm --filter @footprint/ecologits-core test:clean-source
pnpm --filter @footprint/ecologits-core catalog:check
```

The first command prepares the Python developer environment and may access PyPI. Test execution uses `uv --offline --frozen`, the actual installed EcoLogits package, explicit UTF-8 transport, and byte checks against the declared retained-source allowlist before generating any expectations. Python is never imported by runtime TypeScript. A missing package/environment causes a test failure, not fallback to an adaptation. Clean-source verification creates a public-source-only copy and a fresh uv environment using the ordinary pinned wheel cache; it does not require the private original archive.

The normal suite runs 1,000 explicitly product-admitted seeded text combinations with every intermediate, 200 seeded video DAG combinations, all catalog entries and a permanent boundary corpus. A separately named 100-case invalid-product corpus exercises raw source behavior. The release command runs 10,000 valid text combinations and 2,000 video DAG cases. Full result keys, statuses, names, units, scalar/range structure, endpoints and Python-computed midpoints are compared. Operation context is mandatory: direct GPU counts, dimensions, frames and named DAG discrete values compare exactly. Positive, negative, zero and nonfinite classifications cannot cross a tolerance. Float signed zero is encoded as `{$float:'-0'}`; integer conversions normalize zero like Python int. Finite continuous floats use the frozen per-unit tolerance: relative `1e-10`; absolute electricity/GWP `1e-15`, ADPe `1e-24`, PE/water `1e-12`, latency/memory `1e-9`. Failed comparisons print a reproducible numeric fixture. Python exception classes compare exactly; high-level status codes and messages compare exactly.

`tools/generate_catalog.py` regenerates only the accepted baseline. It verifies the declared retained upstream files against their hashes and installed package bytes, verifies every loaded oracle module is retained, uses real upstream loaders, checks schema/alias classification, retains raw provenance, and emits deterministic bytes. The original sdist hash remains pinned independently; the public subset is not claimed to be the complete sdist. See [SOURCE-DISTRIBUTION.md](SOURCE-DISTRIBUTION.md). This converter is not a generic future-release translator. Candidate update/adopt tooling must prepare a separately pinned oracle, classify changed source/functions/schema/license, and verify candidate parity before adoption. Never change a current identity to hide a changed formula or dataset.

`createCatalogRuntime` receives already reviewed compatible data. It does not authenticate a signature, implement a signed update channel, authorize a different core version, or construct a product method hash. Those boundaries remain with the caller. A custom runtime must bind the supplied catalog's actual hash into its method; the baseline `ECOLOGITS_IDENTITY.catalog_sha256` must never label custom data.

`upstream/` is development source/provenance, `oracle/` is development-only Python, `test/` and `tools/` are verification-only, and `src/` plus imported `data/` are runtime. Root build/release tooling must keep development assets out of executable extension bundles while making corresponding source available to recipients.
