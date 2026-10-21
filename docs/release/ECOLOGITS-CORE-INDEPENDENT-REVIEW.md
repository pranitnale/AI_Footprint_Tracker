# Independent EcoLogits core review

Review completed 15 September 2026 (Europe/Berlin). **Verdict: FINDINGS.** This is an independent, read-only review of the finished `packages/ecologits-core` package, before remedial edits. Passing the existing corpus does not clear the findings below or approve the complete application.

Only this report was written in the repository by the reviewer. Reproducers and redacted inventory results were written outside the repository to `%TEMP%/aift-ecologits-independent-review-20260914/`. No production source, accepted fixture, lock, branch, commit, provider service or deployment was changed. No subagents were used. The GitHub route that was previously restricted was not retried or bypassed.

## Reviewed identity and environment

Branch: `codex/modular-ecologits-refinement`. Windows x64, PowerShell, Node `v24.12.0`, Python `3.13.12`, uv `0.11.28`. Requirements were re-derived from plan sections 6-8, the EL/EV and relevant AR/RL acceptance rows, and `ECOLOGITS-UPSTREAM-MAINTENANCE.md`.

| Artifact | Independently checked SHA256 |
| --- | --- |
| TypeScript source manifest identity | `a5ed1f3ac35d75a752f649fec558b4d4f06c456d02eba0bb17afaf8937b29247` |
| Generated catalog | `3573ccc5995257c4a4d1a0d07b5c3a120f058eea6c84e002c6566023b2dcccc6` |
| PyPI source archive | `d24df5c0202bd5925376143f5b78d7273cb015d17323e660723e07e6fad223c0` |
| Complete upstream/core lock | `46519230fcd9091b0d95ff90783691f7b823cb904718a756a9d001709a620955` |
| Source-to-port map | `e403f45e9d36bfaeeeecd9f4133ef60300df3c92a3e0bb8038d0e0c7bc3f254a` |

The source manifest was re-generated in check mode and all constituent source hashes were checked. Independently reading all 169 regular tar members and comparing their bytes to the extracted snapshot found no mismatch and no special archive entries. The archive hash equals the pinned uv lock sdist hash. This review did not retrieve fresh PyPI metadata or independently establish the complete tag-to-commit relationship for requested commit `886d1ebfadb51a2d6407fcea6d9778c997c85c35`. The catalog's `upstream_commit` is consequently a requested identity with the provenance qualification in the lock, not newly established Git attestation.

## Findings requiring disposition

### F1: The comparator permits forbidden discrete and near-zero mismatches (P2)

Location: `packages/ecologits-core/tools/differential.ts:54`, `:66`, `:67`.

The discrete regex applies to named DAG properties, but direct `gpu_count` and `frames` results are at `<case-id>.value`, and resolution dimensions are at `<case-id>.value.0`/`.1`. They receive float tolerance. Additionally, the zero rule is asymmetric: an expected zero must match exactly, but a tiny positive expected value can match actual zero or a negative value. This contradicts the acceptance policy's exact integer and positive/negative/zero requirements.

These calls all return without throwing in the reviewed code:

```ts
compare(121.000000001, 121, 'EV03-probe.value');
compare([1920.00000001, 1080], [1920, 1080], 'EV02-probe.value');
compare(32.000000001, 32, 'EL06-probe.value');
compare(-1e-20, 1e-20, 'EL19-probe.value.energy.value');
compare(0, 1e-20, 'EL19-probe.value.energy.value');
```

No current positive-domain formula discrepancy was established by these comparator mutations. They demonstrate that the existing green checks are weaker than their stated contract. Fix operation-aware discrete comparison and near-zero result classification; retain unit tolerances for genuinely continuous finite quantities. Add negative tests of the comparator itself. Affected criteria: EL06, EL19, EV02, EV03, numerical-comparison policy, and strength of EL20 evidence.

### F2: Video lowering can turn invalid product input into a validated estimate (P2)

Locations: `packages/ecologits-core/src/catalog.ts:129` and `:140`; `packages/ecologits-core/src/admission.ts:43`.

There is no strict product admission for `VideoLookupInput` before duration-to-frame conversion and audio truthiness. The low-level validator only sees the resulting frame count and coefficients, so it cannot recover whether duration was zero, null, a boolean or a numeric string, or whether audio was a boolean. In particular, validly typed duration `0` becomes one frame and passes both available product validators.

```ts
const request = {
  model_name: 'klingai/kling-v1.6', resolution: '720p', duration: 0,
};
const resolved = resolveVideoInput(request);
validateVideoInput(resolved.input); // {ok: true}; frames = 1
const raw = videoImpacts(request);
validateImpacts(raw);              // {ok: true}
// raw.energy.value = {min: 0.00228565819392,
//                     max: 0.0027896355225600004}, kWh
```

Untyped callers supplying `duration: true`, `'5'` or `null` also pass both checks after conversion, with frame counts 25, 121 and 1 respectively. Invalid audio values `'false'`, null, 0 and 1 also pass the low-level input validator after lowering. This is a product-admission gap, not a reason to change the raw source helper: upstream's zero-duration frame behavior must remain reproducible. Provide a separate strict lookup-level admission path, rejecting nonpositive/nonfinite duration and coercible types before conversion, and document/test how product callers use it. Production video activation remains a separate, unverified application gate. Affected criteria: EL16, EL18, EV02/03/11 and plan section 7.3.

### F3: JavaScript truthiness silently repairs raw NaN TTFT (P2, outside admitted product domain)

Location: `packages/ecologits-core/src/llm.ts:66`.

`x.ttft || 0` treats JavaScript NaN as false, while Python `ttft or 0` retains NaN because it is truthy. For `{...llmBase, ttft: NaN}`, actual pinned Python returns NaN generation latency and affected impact values, while TypeScript returns finite values using zero TTFT. Both the `llm` and complete `llm_dag` operations reproduce the mismatch through the existing actual-Python harness:

```ts
differential([{id: 'independent-ttft-nan', op: 'llm',
  args: {...llmBase, ttft: NaN}}]);
differential([{id: 'independent-ttft-nan-dag', op: 'llm_dag',
  args: {...llmBase, ttft: NaN, request_latency: Infinity}}]);
```

The product input validator correctly rejects NaN TTFT. There is no demonstrated admitted-product failure here. However, the raw API and discrepancy register explicitly claim represented nonfinite source behavior is preserved, and currently do not classify this difference. Preserve Python's numeric truthiness or explicitly narrow the reference contract with an honest disposition; do not report this as a pre-existing upstream defect. Affected criteria: EL09's raw surface, EL22 and the nonfinite-source behavior claim.

### F4: The source map gate checks an AST inventory, not implementation/fixture dispositions (P2)

Locations: `packages/ecologits-core/tools/check_surface.py:9-23`; `packages/ecologits-core/test/provenance.test.ts:38`; `packages/ecologits-core/source-to-port-map.json:963` and `:973`.

The checker verifies source file, symbol and line tuples. The associated test checks source file hashes and only that `fixtures.length > 0`. It never resolves the implementation or fixture reference. Most fixture fields are strings such as `EL03-EL14, EL19-EL20`, rather than executable fixture IDs. In an isolated temporary copy, changing `gpu_energy` to `port: 'src/does-not-exist.ts'`, `implementation: 'doesNotExist'`, `fixtures: 'fixture-that-does-not-exist'` still exits 0 with `Verified 117 source symbols.` The production hash checks would also not inspect those three modified fields.

This weak gate has an actual inaccurate disposition: `_StatusMessage.__str__` is labeled implemented, but the port exposes plain `{code,message}` objects and no counterpart of the upstream string with its explanatory URL. `_StatusMessage.from_code`, an abstract method that raises `NotImplementedError`, is likewise labeled implemented by concrete warning/error factory functions. Excluding these unused Python-only surfaces is reasonable; calling them implemented and tested is inaccurate. Other property methods are represented by plain fields/call-site logic and need explicit adaptation descriptions rather than generic file-wide labels.

Require resolvable implementation/fixture references or specific exclusion/adaptation reasons; keep source-hash and inventory verification as a separate check. The mathematical kernels and current runtime imports were inspected independently, so this finding does not assert that all 117 entries are missing. Affected criteria: EL23, RL12's map dependency and RL08 traceability.

## Executed verification

Commands ran from the repository root unless specified. Test execution used the existing locked environment with `uv --frozen --offline`; no provider credentials, hosted service or substitute Python estimator was used.

| Command | Observed result |
| --- | --- |
| `pnpm --filter @footprint/ecologits-core test` | PASS: 9 tests, 0 failed/skipped; 955 boundary comparisons and 3,659 catalog/seed comparisons. |
| `pnpm --filter @footprint/ecologits-core typecheck` | PASS. |
| `pnpm --filter @footprint/ecologits-core test:release` | PASS under the existing comparator: 23,459 comparisons, including 10,000 text results, 10,000 text DAGs, 2,000 video DAGs and 1,459 catalog cases. |
| Deterministic converter invoked twice by the package suite | PASS: recomputed catalog, identity and lock bytes equal accepted files on both runs. |
| `uv run --project packages/ecologits-core/oracle --offline --frozen python -X utf8 <temp>/inventory.py` | PASS: tar/extracted source equality, raw provenance pointers and hashes, exact raw video data, hardware coverage; ancillary-file inventory recorded. |
| `node --import tsx <temp>/probes.mjs <temp>/probes.json` | Reproduced F1-F3, plus separately classified domain/transport observations below. |
| `uv run --project packages/ecologits-core/oracle --offline --frozen python -X utf8 <temp>/map-probe.py` | Reproduced F4 in a temporary copy. |
| Direct `numericalCases`/validator audit saved as `<temp>/random-admission.json` | Whole-result seeds admit 994/1,000 and 9,910/10,000; paired scalar DAG sets admit all 1,000/10,000 after interpreting the documented infinity sentinel as uncapped. |

`<temp>` denotes the temporary directory in the opening paragraph. Its scripts contain the full independent reproducers; they do not change accepted fixtures. `release-test.txt`, `inventory.json`, `probes.json` and `random-admission.json` contain local evidence. Only redacted cassette metadata was emitted or saved, not cookie/organization values or conversation bodies.

| Corpus | Input SHA256 | Oracle output SHA256 |
| --- | --- | --- |
| 955 boundaries | `e920cbccb9504f780ebc0395ece317232b23937db47d896227a871705ffeecc2` | `86a5bb6276a91563cdd1f5450ff3f97e3da47476a0f6d0f4064980e778f27930` |
| 3,659 normal catalog/seeds | `cfc0aaef897087147a5541e6a98dd29c13b19fd861ee0c3193c212bd47c09865` | `ba732417a6bf10ab89c59e72e75999b82c2eb87989cc61315a20e6a6bd86dd90` |
| 23,459 release | `43ee2a2758a26e37de10ba88d9a6ea38b9b14d455cba6a256306d1a9188e9a3b` | `42e374096ad7ec146cbe5f040c0484cba3bdf42156b4db1b782b39ad962b7c97` |

### Oracle and numerical source inspection

`oracle/run.py` imports the actual installed `ecologits` functions/classes and compares each installed upstream Python/data file bytewise to the packaged snapshot before any expectation generation. The uv lock pins the package and transitive dependencies with artifact hashes. No formula reimplementation generates expected outputs; exceptions retain their Python class, and Pydantic/dataclass serialization retains all returned metric, unit, phase, status and range keys. Python `RangeValue.mean` computes the expected midpoint independently. The comparator uses the specified per-unit tolerance table, with the F1 exceptions to exact classification identified above. No skip/fallback-to-own-reference path was found.

LLM formula review confirmed default constants, billion-parameter and bit/GB memory units, power-of-two GPU allocation, per-token energy's Wh-to-kWh division, host batch/GPU allocation, one PUE application, source multiplication order, TPS/TTFT and duration cap behavior in the admitted finite domain, provider environment resolution, paired active/total endpoints and phase addition. Video review confirmed all seven regression terms and their order, integer area/frame operations in the admitted safe domain, full-machine allocation, W-to-kW conversion in the wrapper, audio weighting, and omitted-WOR versus explicit-null provider geography. All four hardware configurations appear in the tested catalog.

The oracle supplies `request_latency=None` when omitted from `llm_lookup` (`oracle/run.py:72`), although the actual Python high-level function requires that argument. This is a documented TypeScript convenience adaptation, not proof of identical callable signatures. The raw wrappers, strict admission and source-compatible arithmetic should continue to be described separately.

### Additional observations, not additional admitted-core defects

- The random generator can make an active upper endpoint exceed a total endpoint. For example `EL20-186` has active `[28.132851638272406,104.59565197341144]` and scalar total `29.354397028125824`. Six PR and 90 release whole-result cases are outside the product-admitted domain. All scalar DAG seed cases still meet the requested numeric minimum, so this is not reported as a missing 1,000/10,000-case gate. Separate invalid-source cases and assert valid-case admission to make future counts unambiguous.
- JSON transport changes JavaScript `-0` to Python integer zero. A `request_latency: -0` probe fails on signed zero even though Python would preserve a directly supplied negative float zero. This is a transport mismatch, not proof of a formula defect. Either encode signed zero or explicitly define it as normalized/out of scope.
- `modelFromJson` with null architecture parameters returns an invalid model while Python raises `ValidationError`. The map currently limits that loader to typed numeric inputs; the product validator rejects the resolved null parameter. No current generated-catalog failure was found. The malformed-object exclusion must remain explicit; this loader alone is not a strict schema validator.
- `electricityMixFromJson` rejects the valid Python decimal string `١.٢`, while Python `float` accepts it. Current pinned catalog bytes use supported representations. Unlike `parseResolution`, the electricity loader does not implement Unicode decimal conversion. Record an ASCII numeric-text limit or cover it before claiming general Python float parsing.

## Catalog, boundaries and distribution evidence

The snapshot retains 344 original text models and 12 aliases; the normalized runtime contains 356 resolved model records. All resolved lookups and representative outputs are tested against Python. It also retains 215 electricity mixes and 17 video models. Independent provenance checks found every raw model source list and JSON pointer/hash intact, including upstream's lost `sources` data. The generated video object is exactly equal to the raw source object, including hardware and capability metadata. All 215 mixes have dense and MoE comparisons. The converter rejects top-level schema drift, unknown classifications and ambiguous baseline aliases rather than manually transcribing a subset.

`createCatalogRuntime` copies and recursively freezes supplied data and creates local indices/functions. Tests confirm mutation of the caller's source cannot change the runtime, the baseline remains unchanged, and duplicate/schema/provider-reference failures occur. It deliberately performs only basic compatible-catalog checks: signature, complete candidate schema, mapping policy, core compatibility and method-hash admission belong to its caller. It must not be represented as a complete release-candidate validator.

Every runtime source imports only local source/data. There is no browser, storage, organization, network, wall-clock, tokenizer or provider SDK import. The `./identity` export imports only the small identity JSON and freezes it. No code path from that subpath loads the full catalog. No video capture entry point exists in the package. Final application chunking and video dormancy remain parent checks.

All runtime files carry MPL-2.0 identifiers. The package metadata is MPL-2.0; the root package license and citation match unchanged upstream bytes. NOTICE identifies translated source, independent port status, generated JSON, modifications, citation and the requirement for corresponding modified source. This establishes local source labeling, not public distribution compliance.

### Ancillary upstream archive content requiring a release disposition

The unchanged source archive and extracted tree include **41 SDK cassettes (440,891 bytes)** and **16 documentation images**, including upstream/provider-related logos and sponsor images. The oracle, converter and runtime do not need those assets. Existing provenance verification binds all extracted files, so silently deleting or editing them would break the accepted archive identity; use a deliberate source-distribution allowlist or a separately recorded development-source retrieval arrangement.

The cassette scan found 20 `set-cookie` headers, 2 `cookie` headers, 14 `openai-organization` headers and 4 `anthropic-organization-id` headers with non-placeholder-looking values. Examples by location only: `upstream/ecologits-0.11.1/tests/cassettes/test_litellm/test_litellm_stream_chat.yaml:16`, `.../test_openai/test_openai_chat.yaml:79` and `:87`, and `.../test_anthropic/test_anthropic_chat.yaml:65`. No API-key-shaped value matched the narrowly tested `sk-`, `AIza` and `ghp_` patterns. That is not a comprehensive secret-clearance claim, and no live validity was tested. These are vendored upstream captures, not this application's user data.

Only the root upstream `LICENSE` was found by the license/notice filename inventory. No separate image-by-image rights record was established. The package NOTICE correctly does not assert rights to independently redistribute linked assets. Keep executable bundles limited to necessary runtime source/data and readable notices. The parent must explicitly decide what additional upstream material enters the corresponding-source archive, run its privacy and asset-rights review, and verify the final allowlist. **Release clearance for ancillary assets/cassettes is UNVERIFIED**, not automatically satisfied by the package's MPL label. The tarball itself also contains these files, so excluding only the extracted directories is insufficient if the whole tarball is redistributed.

## Acceptance disposition

PASS below means source inspection plus the stated executed evidence supports the bounded core requirement. It does not override the listed comparator limitations. Mixed product/release requirements remain UNVERIFIED where their relevant boundary is outside this package.

| Criterion | Disposition and evidence |
| --- | --- |
| EL01 | UNVERIFIED in full: archive/extracted/core/catalog hashes PASS; complete tag-to-commit attestation not independently established. |
| EL02 | PASS for the complete pinned catalog and typed raw repository domain: 356 lookups/outputs, duplicates/alias behavior and raw provenance. Arbitrary malformed/coercible loader objects are outside that declared domain. |
| EL03 | PASS: dense scalars, all DAG intermediates and final results compared; formulas independently inspected. |
| EL04 | PASS: scalar/ranged MoE and dense endpoint pairing, including degenerate ranges. |
| EL05 | PASS: direct interval operations, comparisons, scalar/range shapes and Python midpoints in the admitted domain. |
| EL06 | FAIL verification gate: GPU logic and tested values agree, but direct integer comparison is tolerant (F1). Named DAG GPU values do compare exactly. |
| EL07 | PASS low-level supported overrides and product divisor/type checks. |
| EL08 | PASS source allocation/order and explicit asset overrides; no extra batch/GPU/PUE division. |
| EL09 | FAIL full raw claim due to NaN TTFT (F3); finite absent/null/zero/present cases PASS. |
| EL10 | PASS core cap and uncapped semantics, including exact boundaries. Application historical timing choice UNVERIFIED. |
| EL11 | PASS default, explicit region, WOR, null and unknown/empty zone lookup behavior. |
| EL12 | PASS all 215 mixes and representative dense/MoE calculations, factors, units and warnings. |
| EL13 | PASS PUE/WUE scalar/range propagation and allocation. |
| EL14 | PASS usage/embodied/total GWP, ADPe, PE and usage-only energy/water structure; no training or embodied water added. |
| EL15 | PASS typed raw lookup error classes/codes/messages; arbitrary malformed loader inputs are explicitly limited. Product sanitization/observation retention UNVERIFIED here. |
| EL16 | FAIL complete product admission due to video lowering (F2); low-level negative/nonfinite/reversed/zero-divisor checks PASS in exercised cases. |
| EL17 | PASS string-to-number boundary at MAX_SAFE_INTEGER and over-limit rejection. Persistence after rejection UNVERIFIED here. |
| EL18 | FAIL complete product schema claim due to video duration/audio coercion (F2). Low-level field validation PASS. |
| EL19 | FAIL comparator gate: legitimate signed coefficients and small-value cases run, but positive-to-negative/zero output mismatches can pass (F1). |
| EL20 | PASS execution/count requirement: fixed seeds with 1,000/10,000 admitted scalar DAG cases and full-result cases as quantified above. Complete acceptance remains subject to F1 and a rerun after fixes. |
| EL21 | PASS inspected impact type/unit behavior, warning deduplication, error appending and repeated-call isolation. |
| EL22 | FAIL completeness: documented source quirks are preserved, but the NaN truthiness difference is new and unregistered (F3). |
| EL23 | FAIL: complete 117-symbol AST inventory exists, but dispositions/fixture links are not verified and some implemented claims are inaccurate (F4). |
| EV01 | PASS all 17 profiles and four hardware types through actual Python lookup calculations. |
| EV02 | FAIL complete gate: source parser examples agree; direct integer comparison and product lookup admission are incomplete (F1/F2). |
| EV03 | FAIL complete gate: source frame rounding examples agree; direct exact comparison and zero-duration product admission are incomplete (F1/F2). |
| EV04 | PASS seven regression terms, order, units and signed coefficients through source inspection and full DAG comparisons. |
| EV05 | PASS actual boolean audio flags across all catalog profiles; malformed boolean admission is F2. |
| EV06 | PASS explicit W-to-kW conversion and documented upstream docstring discrepancy. |
| EV07 | PASS full-machine energy and server/accelerator embodied allocation. |
| EV08 | PASS raw power/PUE/WUE ranges, phases, factors, warnings and units. |
| EV09 | PASS omitted WOR versus null provider geography. |
| EV10 | PASS low-level cap and explicit override surface; high-level extra cap rejected. |
| EV11 | FAIL complete product admission (F2). Low-level safe integer products and negative/nonfinite result rejection PASS in exercised cases. |
| EV12 | UNVERIFIED application activation; package has no observation/capture entry point. |
| AR01 | PASS actual runtime imports and pure core source inspection. |
| AR11 | UNVERIFIED application-wide layer CI; package import test and current runtime graph PASS. |
| AR02-AR10, AR12 | UNVERIFIED/not exercised by this bounded review: application injection, workers, storage, security scopes, cancellation and retention. |
| RL04 | PASS actual frozen/offline Python oracle and locked dependencies; mismatch/missing reference environment is a hard failure, not a fallback. |
| RL06 | PASS local port/data license labeling and unchanged notices; ancillary asset inventory and distributed source completeness UNVERIFIED. |
| RL08 | FAIL core traceability completeness (F4); whole-app owner traceability UNVERIFIED. |
| RL09 | PASS complete source/catalog retention, counts and independent provenance checks. Production exclusions/mappings UNVERIFIED. |
| RL10 | PASS repeat deterministic baseline conversion and no runtime fetch dependency. |
| RL12 | FAIL map-verifier prerequisite (F4); candidate schema/formula/default/license classification remains the separate update-tool review. |
| RL18 | PASS offline isolated core runtime; installed packaged updates and signed-data activation UNVERIFIED. |
| RL22 | PASS local source/generated JSON MPL labeling; minified bundles, source routes and ancillary rights clearance UNVERIFIED. |
| RL01-03, RL05, RL07, RL11, RL13-17, RL19-21, RL23 | UNVERIFIED/not exercised here: candidate/adoption workflow, immutable client/server methods, signed updates, comparison reports, browser artifacts, source availability and legacy-engine preservation. |

The parent should return F1-F4 to the implementer, retain this frozen-hash report, and request a focused independent re-review of the resulting diff and strengthened tests. Public source access, complete commit linkage, final source/runtime allowlists, browser installation, application integration, backend behavior and legacy preservation remain separate gates.

## Independent remediation re-review, 15 September 2026

**Verdict: FINDINGS, with F1-F4 resolved and one remaining oracle-transport finding R1.** This section preserves the original review above. It independently evaluates `0.11.1-port.2`, converter `2`, rather than accepting implementer verification claims. No production source or accepted fixture was edited during re-review.

### Exact re-reviewed identity

| Artifact | SHA256 |
| --- | --- |
| Executable core source manifest | `c5f61cfea5a3b6f6fb36ea5faf0b8ef2910b6c2fd25e295748bf80bc547aa810` |
| Catalog, unchanged | `3573ccc5995257c4a4d1a0d07b5c3a120f058eea6c84e002c6566023b2dcccc6` |
| Retained-source manifest | `38e0eba65c85c1b8c5afd23325ba200a353fbe403533f9e620bdb7e4177d5073` |
| Upstream/core lock | `f1520d66e1a860cae13c5f612880c1b09b00ddb64d47e29592abbd6137c7ae1b` |
| Revised source map | `be6f1e605af0e5f24f61dd92d5be490a6067e1ca26cb260dfe182dbc9059053e` |
| Oracle protocol source, `oracle/run.py` | `121cbba4b40a601f3b82c916b0588742dd3de8fdbe0f40361733e2785cc431e6` |

### Resolution of original findings

| Item | Independent disposition |
| --- | --- |
| F1 | PASS. All five original comparator mutations are now rejected with operation context. Direct frame/GPU/dimension values use exact comparison; both directions of zero and sign changes are rejected. Missing/unknown operation context fails. No tolerance was increased. |
| F2 | PASS. `validateVideoLookupInput` rejects the original zero, boolean, string and null durations and malformed audio before lowering. The documented sequence is lookup admission, resolved-input admission, then result validation. Raw zero-duration behavior remains source-compatible. |
| F3 | PASS. Original NaN TTFT probes for full results and complete DAGs now match actual Python. Explicit null/numeric-zero fallback replaces JavaScript truthiness. The original negative-zero latency-cap probe also passes. |
| F4 | PASS for the reviewed map. The new checker verifies the independently enumerated required Python files, source hashes/AST rows, resolvable TypeScript declarations/graph assets or Python functions, and actual fixture IDs. Original nonexistent-file/symbol/fixture mutations fail. Python-only status string/abstract methods are now explicitly excluded; record/property/mutability adaptations have specific descriptions. Source inspection confirms the revised dispositions. |
| Product PUE requirement | PASS. Text, low-level video and lookup-level video admission reject scalar PUE below one and any ordered range with a lower endpoint below one. PUE one and valid ranges are accepted; signed regression coefficients remain allowed. |
| Valid random seeds | PASS. Independently counted and validated all 1,000 PR and 10,000 release whole-workload inputs. Invalid active/total relationships now occupy a separately named 100-case corpus. |
| Candidate catalog isolation | PASS. Independently changed a candidate warning message, checked candidate factories and `modelFromJson` use it, and confirmed baseline messages remain unchanged. |

### R1: Float markers bypass decoding for raw JSON operations (P2, verification only)

Location: `packages/ecologits-core/oracle/run.py:57`.

The new transport encodes `-0` as `{"$float":"-0"}`, but `model_from_json`, `repository` and `parse_value_or_range` bypass all decoding. Consequently valid numeric input is presented to the actual Python function as a dictionary. This affects the new signed-zero transport and also other nonfinite float markers in those operations. It is an oracle protocol defect, not a TypeScript calculation defect or a source behavior to preserve.

These independent actual-harness cases fail:

```ts
differential([{id: 'independent-parser-negative-zero',
  op: 'parse_value_or_range', args: {value: -0}}]);
differential([{id: 'independent-parser-range-negative-zero',
  op: 'parse_value_or_range', args: {value: {min: -0, max: 1}}}]);
differential([{id: 'review-model-zero-ttft', op: 'model_from_json', args: {
  provider: 'openai', name: 'synthetic',
  architecture: {type: 'dense', parameters: 70}, deployment: {ttft: -0},
}}]);
```

The oracle reports `KeyError` for the scalar parser and `ValidationError` for the range/parser/model cases. The TypeScript functions return valid values. Direct calls to the unchanged installed Python `parse_value_or_range(-0.0)`, `parse_value_or_range({'min': -0.0, 'max': 1})` and `Model.from_json` with `deployment.ttft=-0.0` all succeed and preserve the negative sign (`math.copysign` returns `-1.0`). The core and source therefore agree when given the same values; the oracle is giving them different values.

Decode transport float markers recursively for raw JSON operations while leaving ordinary min/max dictionaries intact for the real upstream loader/parser. Do not use the normal decoder unchanged if that would construct `RangeValue` before testing the parser. Add protocol probes for scalar and nested markers in each affected operation. The admitted model with positive parameters and zero TTFT demonstrates that this is not merely an arbitrary malformed-object exclusion.

Affected evidence: signed-zero/input-transport fidelity, raw parser/loader portions of EL05/EL09/EL18 and the integrity of future differential coverage. The finite catalog/release outputs tested in this review remain supported. The original mathematical-core findings do not reopen.

### Executed remediation gates

Same Windows/Node/Python/uv versions as the original review. Normal JavaScript dependencies used TypeScript `5.9.3`, tsx `4.23.13` and esbuild `0.28.2`. No network fetch occurred during these gates.

| Command/check | Independent result |
| --- | --- |
| `pnpm --filter @footprint/ecologits-core test` | PASS: 18 blocks, 0 failed/skipped; 4,735 actual-Python comparisons (969 boundaries, 3,659 catalog/seeds, 7 review cases, 100 separate invalid-domain cases). |
| `pnpm --filter @footprint/ecologits-core typecheck` | PASS. |
| `pnpm --filter @footprint/ecologits-core test:release` | PASS: 23,459 actual-Python comparisons under the strengthened comparator. |
| `pnpm --filter @footprint/ecologits-core test:clean-source` | PASS: the package-provided public-copy check creates a fresh frozen offline uv environment, then typechecks and runs all 18 tests. |
| Reviewer-owned `<temp>/recheck.mjs` | PASS for F1-F4, PUE, valid seed counts, NaN/negative-zero core probes and candidate isolation; reproduces R1 scalar/range cases. |
| Reviewer-owned external public-source copy | PASS: 26 retained files/143 exclusions independently verified against all 169 original archive members; fresh offline Python dependency environment, 18 tests and typecheck outside the repository. |
| Browser-targeted bundles from that external copy | PASS: minified full engine and identity-only entries build and a bundled representative LLM calculation passes `validateImpacts`. |

Temporary independent evidence is in `%TEMP%/aift-ecologits-independent-rereview-20260915/`: `recheck.mjs`, `recheck.json`, `public-copy.py`, `public-copy-inventory.json`, and `public-copy/`. The external copy contains the 69 public package files plus the shared TypeScript configuration, no `.git`, no original tarball and no pre-existing Python environment. Its `node_modules` junction provides the workspace's ordinary pinned JavaScript dependencies only. Python was freshly installed into that copy with `uv sync --project oracle --frozen --offline` from the standard wheel cache. Reuse of normal dependency caches is explicit; there is no private vendor-artifact dependency.

Typecheck in the external package used `node ../../node_modules/typescript/bin/tsc -p tsconfig.json`; all tests used `node --import tsx --test test/*.test.ts`. A first reviewer invocation used one excess `../` and could not find `tsc`; the corrected command passed. This was a reviewer command-path error, not a package failure. Browser bundles were built with `esbuild.build` using `bundle:true`, `platform:'browser'`, `format:'esm'` and `minify:true`. `build/index.meta.json` reports only the nine runtime TypeScript files and two generated JSON inputs, no imports, and 299,504 output bytes. `build/identity.meta.json` reports only `src/identity.ts` and `data/identity.json`, no imports, and 475 output bytes. These checks establish portable source/bundle boundaries, not installed-browser behavior or performance acceptance.

| Corpus | Input SHA256 | Oracle output SHA256 |
| --- | --- | --- |
| 969 boundaries | `7f18d1b2842fdcd1c41f1c358b252b12f357e2b085fcfe0a169df9ea9437738f` | `d814956eda6008ef4cfcfc008780cd06a369feeaf6d0abae7b41f28559f42e54` |
| 3,659 catalog/valid seeds | `0ffe591ccb67a175f82c5d6b3795be8c39fe8ab5c5cac2a273062eb8e7325e6b` | `5538d3952cd2a85556b0d579ab83a4d820f378891e9a074de539446d8edcf63d` |
| 23,459 release | `bd7c29adda8ff6c4ba9f1be207324acc015d6ad8115cb7fb43b0803080a71d1f` | `000c6ec82b4a13c48961c04ccebc64ac26403e7b8f4b9d4b9d68e7a4872c64db` |

### Retained source and revised acceptance disposition

The reviewer read the private original archive solely to independently verify retained/excluded manifest entries against the original bytes, not to build or run the public copy. All 169 path/hash/size entries match; all 26 retained files are byte-identical to that archive. The 41 SDK cassettes, 16 images and original tarball are absent from the public package. The original archive remains privately preserved under `.git` with the original SHA256. `source_integrity.py` binds the public allowlist to installed package bytes, frozen dependency metadata and the preserved PyPI metadata; loaded upstream modules must belong to the retained set. No raw cookie or organization values were printed or copied into the report.

The ancillary-content issue is **PASS for the current public package boundary**. RL06/RL09/RL10/RL22's local package/source obligations now have independent retained-source and relocated-build evidence. Final source archives must still apply the parent's allowlist and exclude `.git`, environments and ignored verification outputs. Public recipient access remains UNVERIFIED, as does complete tag-to-commit attestation.

Original failure rows attributable to F1-F4 (EL06, EL09's NaN case, EL16, EL18's video admission, EL19, EL22's NaN disposition, EL23, EV02, EV03 and EV11) now **PASS their reviewed remediation scope**. R1 remains a separate **FAIL** for the raw JSON oracle's transported float values. AR01 and identity laziness PASS source/bundle inspection; application-wide AR/RL integration, observed-video dormancy, server behavior, legacy preservation, browser installs and public source publication retain their original UNVERIFIED status. This report is not whole-application release approval.

## Independent final closure, 15 September 2026

**Latest bounded core-review verdict: CLEAN.** F1-F4 and R1 are independently verified resolved. The earlier FINDINGS verdicts above remain as the historical evidence for the exact revisions reviewed, not the final disposition.

The final R1 change is limited to oracle transport and verification fixtures. `decode(value, range_values=False)` recursively decodes float transport markers while retaining min/max dictionaries for the actual upstream JSON parser/loader. The normal mathematical operations still construct upstream `RangeValue` objects. Source inspection and a direct nested-decoder assertion verify that the fix does not replace the upstream parser with pre-parsed values.

Final oracle protocol SHA256 is `27ffcd0c110c82170a35e5fb17fc2a73c5e39edb20788dc4ffe74c7c6f56b427`. Fixture source SHA256 is `8acdcdb9c39bf09d0d79783e5f65ba7aa38543a0a754e819162095e69e59520d`; review-fix test SHA256 is `2d4fd9137c4fd15d722bc737fc209f81e5ea6654f02c6d9e09914b1faf9ac319`. Runtime core `c5f61cfea5a3b6f6fb36ea5faf0b8ef2910b6c2fd25e295748bf80bc547aa810`, catalog, retained-source manifest, source map and upstream/core lock are unchanged from the preceding remediation identity table.

The reviewer reran the original scalar and ranged parser reproducers and the valid model with negative-zero TTFT. All match the actual Python package. An additional repository case containing that model also matches. The latter two independent cases have input hash `607aadbf734f7db9f0d6e1675fb04ace7729b21f9a2160744d31afcabda6474a` and oracle-output hash `12ed761cc8eb33ae088b15d17013f5b4d8fb00d400def1afcdfbf7e3c66a13e7`. The complete reviewer-owned F1-F4/PUE/seed/isolation probe script was rerun successfully; its final output is saved as `recheck-corrected.json` in the temporary re-review directory.

Final independently executed gates:

- `pnpm --filter @footprint/ecologits-core test`: PASS, 19 tests, zero failures or skips, **4,742 actual-Python comparisons** (976 boundary, 3,659 catalog/valid seeds, 7 NaN/signed-zero core cases and 100 separately labeled invalid-product cases).
- `pnpm --filter @footprint/ecologits-core test:release`: PASS, **23,459 comparisons**, including 10,000 admitted whole-workload cases. Input/output hashes remain `bd7c29adda8ff6c4ba9f1be207324acc015d6ad8115cb7fb43b0803080a71d1f` / `000c6ec82b4a13c48961c04ccebc64ac26403e7b8f4b9d4b9d68e7a4872c64db`.
- `pnpm --filter @footprint/ecologits-core typecheck`: PASS.
- The changed public oracle/tests were copied into the reviewer-owned external public-source copy. Its typecheck and all **19 tests** pass using the previously created fresh frozen Python environment and ordinary pinned JavaScript dependencies, without a private archive/tree. The runtime source and data were unchanged, so the preceding independent browser-targeted main/identity bundle evidence remains applicable.
- Source-map negative tests, retained-source negative tests, deterministic conversion twice, runtime source boundaries and identity-only imports all pass in those full suites.

The final boundary corpus has input SHA256 `d5e1ab97ac1e72c77ded35a86607053f42cf7a7b44f2986f246bfb1ad4b07a89` and oracle-output SHA256 `b66eadd87a126142f9077a997ddc6dc28b160ea08537892f42aa813ed1ba0643`. The 3,659-case corpus hashes remain those in the preceding remediation table.

**Acceptance closure:** the reviewed core portions of EL02-EL23 and EV01-EV11 now PASS within their declared typed reference/product domains; no unresolved core finding remains. EL01's complete tag-to-commit attestation remains UNVERIFIED. Application portions of the mixed criteria, including observation retention, sanitization, actual video dormancy (EV12), client/server policy and source publication, remain outside this approval. AR01 and local runtime/source boundaries PASS. Local RL04/RL06/RL09/RL10/RL12-map/RL18-runtime/RL22-source evidence PASS; candidate adoption, final distribution archives, public corresponding-source recipient access, native browser operation and the rest of the application still require their own gates. CLEAN here does not certify physical model accuracy, a public release or production readiness of the whole application.
