# EcoLogits core remediation verification

15 September 2026. This records fixes after the independent review returned FINDINGS. The frozen [independent report](../../docs/release/ECOLOGITS-CORE-INDEPENDENT-REVIEW.md) was not modified. The parent must still request independent re-review; these results are implementer evidence, not a release approval.

## Findings reproduced and fixed

| Finding | Reproduction and final behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1      | All five original forbidden comparator mutations reproduced before edits. `compare` now requires a recognized operation. Direct frames/GPU/dimension outputs and named DAG discrete values compare exactly. Positive, negative, zero, signed-zero and nonfinite classifications cannot cross a float tolerance. Negative tests reject incorrect values and missing operation context.                                                                                                                                              |
| F2      | Zero duration reproduced a one-frame raw estimate that passed the former low-level checks. New `validateVideoLookupInput` rejects invalid duration/audio/resolution before lowering. Raw helpers retain upstream zero-duration behavior. Product callers must validate lookup input, then resolved input, then output.                                                                                                                                                                                                             |
| F3      | NaN TTFT mismatched the actual Python scalar and DAG surfaces before the fix. Explicit null/zero truthiness now preserves Python NaN behavior. Signed float zero is transported explicitly; integer conversion zero matches Python int. Permanent actual-Python cases pass.                                                                                                                                                                                                                                                        |
| F4      | A nonexistent implementation and fixture reference passed the old checker. Schema-2 map entries now resolve actual TypeScript declarations/assets or Python functions and executable case IDs. Source hashes and the complete required AST inventory are independently checked. Python-only abstract/logging methods are explicitly excluded; plain-record/property/mutability adaptations have specific reasons. Negative tests reject nonexistent references, missing sources, changed hashes and false mathematical exclusions. |

Residual re-review found an oracle transport defect: raw JSON parser inputs bypassed decoding entirely, so signed-zero markers reached Python as dictionaries. Scalar `-0` and `{min:-0,max:1}` both reproduced before the fix. The oracle now recursively decodes transport scalars for raw JSON operations while leaving plain range dictionaries intact for upstream parsing. Seven permanent parser/loader cases and a direct nested decoder test pass. The later manifest-driven activation change preserved those semantics while moving source selection ahead of package import. Every runtime source hash and the core/catalog identities remain unchanged. The final oracle runner SHA256 is `40b5c54f9f5baff5cde88148f0fad5e1fb73d62d5df85840b7aadcdef88ae0fb`. Release parity and the clean-source build were rerun successfully.

The parent additionally required PUE >= 1 at every product-admitted endpoint. Text, low-level video and lookup-level video validators enforce it while retaining legitimate negative regression coefficients. No catalog calculation or coefficient changed. The new executable identity is `0.11.1-port.2`; converter identity is `2`.

## Executed evidence

Environment: Windows x64, Node 24.12.0, Python 3.13.12, uv 0.11.28. Python dependencies remain frozen in the same uv lock. The oracle validates the candidate-pinned installed package and source artifact, then activates the exact retained snapshot selected by the manifest before importing EcoLogits. Qualified combinations may replace only the three explicitly listed catalog JSON files; Python code must still match the pinned installed package. Every loaded upstream module must come from the retained snapshot. No application Python adaptation generates expectations.

| Command                                                     | Result                                                                                                                                                                                                                 |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @footprint/ecologits-core typecheck`         | PASS.                                                                                                                                                                                                                  |
| `pnpm --filter @footprint/ecologits-core test`              | PASS, 19 blocks. 3,659 catalog/valid-seed comparisons, 976 permanent boundaries, 7 review raw cases and 100 separately labeled invalid-product cases: 4,742 actual-Python comparisons, plus direct decoder assertions. |
| `pnpm --filter @footprint/ecologits-core test:release`      | PASS, 23,459 comparisons: 10,000 admitted text workloads, 10,000 full text DAGs, 2,000 video DAGs and 1,459 catalog cases.                                                                                             |
| `pnpm --filter @footprint/ecologits-core test:clean-source` | PASS. A separate public-source copy creates a fresh frozen uv environment from the ordinary wheel cache, then passes typecheck and the full suite offline. No private vendor artifact is present or required.          |
| `tools/check_surface.py` in the frozen oracle environment   | PASS, 117 source symbols with checked hashes, definitions, implementation references and actual fixture IDs.                                                                                                           |
| Deterministic catalog check twice in the suite              | PASS; retained source, catalog, identity and lock bytes agree.                                                                                                                                                         |

All 1,000 PR and 10,000 release whole-workload seeds now explicitly pass product input admission. Invalid active/total endpoint relationships are tested in a separate 100-case raw-source corpus and never counted as admitted seeds. The comparator keeps the acceptance plan's original per-unit tolerances; none were loosened. Exceptions compare by Python class, statuses by exact code/message, and output shape/units/phases are retained. Python-computed range midpoints remain independently compared. Machine-readable corpus hashes and command results are in [verification.json](verification.json).

The complete baseline catalog remains 344 text models, 12 aliases, 215 electricity zones, 17 video models and 4 hardware types. All normalized text records/outputs, all zones with dense/MoE inputs and every video model with audio and geography variants are covered. Source quirks and reference-domain restrictions remain explicit in [DISCREPANCIES.md](DISCREPANCIES.md). These include the limited typed raw model loader, the raw electricity loader's ASCII text domain, and the TypeScript convenience of omitted text lookup latency becoming null.

## Source distribution

The full original tarball and tree contained 41 SDK cassettes and 16 documentation images/logos unnecessary to the core. After every original tar member was byte-checked, both were moved without deletion to `.git/refinement-artifacts/vendor-source/ecologits-0.11.1-original/`. Only 26 source/data/legal/metadata files were copied back unchanged. The public package contains no tarball, cassette directory or docs-image directory.

The original artifact identity remains independently pinned. `upstream/retained-source.json` declares 26 retained and 143 excluded files with hashes, sizes and disposition. The reduced source tree is not called a complete sdist. Its verifier checks the allowlist, metadata and installed oracle; it does not depend on the private original archive. Negative tests cover bad paths, extra/omitted files, sizes, hashes and broken original-artifact binding. See [SOURCE-DISTRIBUTION.md](SOURCE-DISTRIBUTION.md) for adoption and public packaging requirements.

| Identity                          | SHA256                                                             |
| --------------------------------- | ------------------------------------------------------------------ |
| Original PyPI source artifact     | `d24df5c0202bd5925376143f5b78d7273cb015d17323e660723e07e6fad223c0` |
| Core source manifest              | `c5f61cfea5a3b6f6fb36ea5faf0b8ef2910b6c2fd25e295748bf80bc547aa810` |
| Generated catalog, unchanged      | `3573ccc5995257c4a4d1a0d07b5c3a120f058eea6c84e002c6566023b2dcccc6` |
| Retained-source manifest          | `38e0eba65c85c1b8c5afd23325ba200a353fbe403533f9e620bdb7e4177d5073` |
| Upstream/core lock                | `f1520d66e1a860cae13c5f612880c1b09b00ddb64d47e29592abbd6137c7ae1b` |
| Source map                        | `be6f1e605af0e5f24f61dd92d5be490a6067e1ca26cb260dfe182dbc9059053e` |
| Python dependency lock, unchanged | `0ed1b8878ff0eb4420c974929a84a6bef64ba9a5048655cfc2dfcf91242b725b` |

## Manifest-driven adoption closure

The maintenance workflow now stages the candidate oracle project and adopts its `pyproject.toml` and `uv.lock` with the catalog, identity, retained-source manifest and lock. Package readers no longer hardcode `0.11.1`, its snapshot directory or its PyPI metadata filename. `generate_catalog.py`, `source_integrity.py`, `check_surface.py`, the clean-source check and provenance tests resolve the adopted manifest and lock. A compatible catalog-only combination records the three allowed data overlays explicitly; any Python source mismatch with the candidate-pinned package remains blocking.

An isolated temporary checkout adopted a qualified synthetic `cohere/synthetic-compatible-model` addition. After adoption, its ordinary package commands all passed offline: `pnpm catalog:check`, `pnpm typecheck` and `pnpm test`. The model was present in the adopted catalog. No estimator formula, runtime `src/**` file, interface, storage module or live checkout catalog was changed by the rehearsal.

The complete maintenance suite passed 3 tests in 249.4 seconds, including compatible additions, valid parameter/default deltas, stale formula and unknown-schema rejection, alias/flagship conflict, direct mapping replacement, qualified-combination provenance, compliance changes, deterministic reruns, sealed-stage tampering, dirty targets, forced interruption, recovery, rollback and malicious archives. The unchanged full-artifact proof passed 2,255 candidate comparisons with zero accepted-to-candidate deltas. It reproduced catalog SHA256 `3573ccc5995257c4a4d1a0d07b5c3a120f058eea6c84e002c6566023b2dcccc6`, runtime core SHA256 `c5f61cfea5a3b6f6fb36ea5faf0b8ef2910b6c2fd25e295748bf80bc547aa810` and retained-source SHA256 `38e0eba65c85c1b8c5afd23325ba200a353fbe403533f9e620bdb7e4177d5073`. All nine generated maintenance artifacts were byte-identical on a second verification run.

| Manifest-driven reader         | SHA256                                                             |
| ------------------------------ | ------------------------------------------------------------------ |
| `oracle/run.py`                | `40b5c54f9f5baff5cde88148f0fad5e1fb73d62d5df85840b7aadcdef88ae0fb` |
| `oracle/source_integrity.py`   | `b32bca1df1eaa41ca8c3eecc88316a3deb954cf0f6ce34b6532357ac9d07cb52` |
| `tools/generate_catalog.py`    | `34c6ad40bd1a8e7f5fa3cfe1ce117f305c455ea3f5c1e94d9bdd559a24f00f93` |
| `tools/check_surface.py`       | `7edf2a4386c6eb3de734ee6a0576ceaa1a6f794c1b68f280dded805a96f62e08` |
| `tools/verify_clean_source.py` | `dcd91611800d02509cfc89abf6ddcb78e72dfb8a7b173f44c3812f4838f5ff95` |
| `test/provenance.test.ts`      | `8d607a7f35dd7d0d0232374a5af5904172f81bdbc083e546034212bf41f13104` |

## Integration and remaining gates

The public API adds `validateVideoLookupInput`. `CatalogRuntime` now also returns candidate-bound warning/error factories and model/electricity loaders, plus pure repository constructors, so candidate tooling need not duplicate them. `@footprint/ecologits-core/identity` remains small and independent of the full runtime. Candidate comparators must supply the operation to `compare(actual, expected, path, unitOrUndefined, operation)` and retain `{$float:'-0'}` transport semantics.

The parent owns independent re-review, app/video dormancy checks, product mapping/result policy, migrations, backend compatibility, browser/performance evidence and final package/source inventories. Update tooling must consume the retained-source manifest and never copy the private full artifact into adoption or release output. Matching public corresponding-source publication and recipient access remain unverified. Complete independent Git tag-to-commit linkage is still open: the prior GitHub request was denied and not bypassed; the allowed PyPI artifact and prior local audit byte matches are recorded, not promoted into a new Git attestation.

No commit, push, branch change, deployment or application code change was made by this remediation task.
