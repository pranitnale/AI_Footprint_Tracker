# Independent adopted-catalog integration review

15 September 2026. **Verdict: CLEAN for this bounded correction.** The reviewer independently inspected the frozen sources and reran the ordinary and qualified product-adoption proofs, native rejection and baseline tests, and LG10 failure isolation. No production or test source was changed by the reviewer. This verdict does not certify the pending browser release artifacts.

## Scope and findings

| Criterion | Result | Independent evidence |
| --- | --- | --- |
| Strict public runtime identity | PASS | `verify-update.mjs` and `generate_catalog.py` emit the existing eight fields. `catalog_commit`, `release_kind` and `snapshot_directory` remain provenance in the adoption lock and retained-source workflow. The real copied product parses both adopted identities without weakening its shared schema. |
| Ordinary adoption preserves behavior | PASS | An unchanged single-commit `release_candidate` passes actual update, verification, temporary adoption and converter `--check`. Its catalog/method identity and product result remain unchanged. |
| Qualified catalog reaches actual product consumers | PASS | The isolated `qualified_combination` adds an 8B synthetic model and a separate mapping. Actual copied registry/executor and EngineService/Ledger select that direct mapping, change the catalog/method hash and recalculate the default view. Explicit model override still wins. |
| Native executable identity remains strict | PASS | Installed EcoLogits remains pinned to 0.11.1. Retained Python and undeclared JSON must match installed bytes. Source manifest, sizes/hashes, lock, accepted identity and loaded module origin/allowlist are checked. Wrong installed version and modified retained code are unavailable. |
| Qualified data has an exact allowlist | PASS | Only `ecologits/data/models.json`, `ecologits/data/electricity_mixes.json` and `ecologits/data/video_models.json` may be declared. Qualification requires the release kind, label, core binding and pinned commit syntax. Duplicates, undeclared environment changes, code overlays and unknown paths fail closed. |
| Native data agrees with the accepted generated catalog | PASS | Hash/schema/version/catalog commit are bound before comparing parsed models, aliases, electricity data and video data. Altered unsealed data and resealed stale models/environment are rejected; independent alias/video inconsistency probes also reject. |
| Native catalogs remain private to the bound function | PASS | `FunctionType` retains the installed function's identical code object and binds separately constructed repositories. Tests prove upstream model/electricity repository identities and values remain unchanged. A copied product with no oracle directory runs successfully. |
| Original and archived observations survive adoption | PASS | Both adoption paths retain Original selection, preference, identity, numerics, stored original results and observations in a separately persisted database. All 25 frozen legacy cases pass. Earlier EcoLogits originals remain available in the original view with recalculation lineage preserved. |
| Native product parity | PASS | Both adopted paths return envelopes accepted by the shared TypeScript schema. All five metrics match metadata and value/interval endpoints with relative tolerance `1e-10` and absolute tolerance `1e-16`; null values remain null. |
| EcoLogits failure is isolated from Original | PASS | LG10 injects an actual EcoLogits load failure and an actual `llmImpacts` calculation failure. Original remains selected and captures/recalculates successfully; preserved Original result and observation bytes remain equal. |

## Independently executed checks

| Command or probe | Result |
| --- | --- |
| `node --test tools/ecologits/test/product-adoption.test.mjs` | 2 passed, no failures/skips/cancellations; 41.90 seconds. Both cases use the private pinned source artifact and real temporary update/verify/adopt operations. |
| `uv run --directory apps/server --frozen --offline --group dev python -m pytest -c pyproject.toml tests/test_native_catalog_overlay.py tests/test_ecologits_engine.py tests/test_native_product_parity.py -q` | 40 passed; 53.59 seconds; two existing framework deprecation warnings. |
| `node --import tsx --test apps/extension/test/engine-failure-isolation.test.ts` | 2 passed, no failures/skips; 2.39 seconds. |
| Temporary independent native probes | 8 passed; 7.11 seconds. Ordinary private-bound versus installed-global function results match exactly for three provider defaults at 1, 500 and 5,000 output tokens. Resealed alias/video divergence, missing catalog entry, wrong retained size, absolute source path, outside installed module and unlisted installed module all reject with sanitized `engine_unavailable` (409, retryable). |

The runtime used Node 24.12.0, Python 3.13.12 and EcoLogits 0.11.1 in the existing frozen server environment. These are local functional checks, not browser installation or a clean-source browser rebuild. The parent separately owns broad suite execution and final artifact generation. No broad suite, duplicate browser build, checkout adoption, dependency update, commit or push was performed for this review.

Evidence is retained outside the repository at `%TEMP%/aift-adopted-catalog-independent-20260915/`: test logs, temporary independent probe source, and before/after source hashes. All captured reviewed source hashes were unchanged across execution.

## Reviewed source SHA-256

| Path | SHA-256 |
| --- | --- |
| `tools/ecologits/verify-update.mjs` | `19360a04d98c4b40a7cc1c229671d50b47ceeedaac5d7aabb96d92fdbcef9447` |
| `packages/ecologits-core/tools/generate_catalog.py` | `f869863feecfd61c3a43ea356409c17fd392c622a45c8d9ec367f62df1b671d7` |
| `tools/ecologits/test/product-adoption.test.mjs` | `50eda19dd7d0e34b0da9fba75a374b3f542d9accb885636c9897c734dcdafb6c` |
| `tools/ecologits/test/product-adoption-proof.mts` | `a334791cf7a489e3571f7d7258723d6d8bf58962d2fca7825a48cc93002beb78` |
| `tools/ecologits/test/product-adoption-native.py` | `efc91fb483596e1d5ee743a29fd58c239365c5b0a98608f9be0bde2effa5290a` |
| `apps/server/aift/engine_adapter.py` | `1f01b089456514039bf0e5440b72bfd19eb3cf6e17a05bab9d05e0e0467222e1` |
| `apps/server/tests/test_native_catalog_overlay.py` | `625132f18e980e08b253a4b89610978028e48d3edd898d9df4cc4ff66deef61d` |
| `apps/server/ECOLOGITS.md` | `5e8ea31f8bdb6ee916fd1b95415543c52f077cb413f1fc16c4c0f36bd63c4725` |
| `apps/extension/test/engine-failure-isolation.test.ts` | `43949f7e02da8f95fe3f1ae635f8f2ecc03d33f155bb344a08bc8ad3a1a64f9e` |

## Limits

The qualified scenario is a controlled compatible JSON change, not approval for arbitrary future upstream code or data. Installed Python must still match; video data validation does not enable video estimation. Successful native activation is cached for process lifetime, so a packaged update requires process restart. The old definition rejection is deliberate when its accepted core/catalog identity differs.

Exact agreement with the installed function and cross-runtime tolerances establish implementation consistency for these cases, not physical measurement accuracy. Browser-native lifecycle, provider traffic, signing/store publication, PostgreSQL execution and final six-variant artifact freshness remain separate gates.
