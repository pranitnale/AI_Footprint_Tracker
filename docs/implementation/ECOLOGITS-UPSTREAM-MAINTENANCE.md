# EcoLogits catalog updates, release adoption and attribution

14 September 2026. Implementation requirements added after the owner clarified that the extension should benefit from EcoLogits' full model library and subsequent releases with little repetitive work, while giving proper credit and meeting applicable license conditions. This supplements the [modular implementation plan](MODULAR-EXTENSION-ECOLOGITS-PLAN.md) and [acceptance matrix](MODULAR-EXTENSION-ECOLOGITS-ACCEPTANCE.md). The workflow and artifacts below are planned, not implemented.

## 1. Adoption model

Treat EcoLogits as an upstream dependency with a maintained TypeScript port, rather than manually copying selected model parameters into our original reference cohort. Import the complete pinned text/video model catalogs, aliases, electricity factors, source references and warnings into a reproducible upstream snapshot. Preserve the original estimator's separate frozen dataset.

Keep four independently versioned parts:

| Part | Contents | Update method |
| --- | --- | --- |
| Upstream snapshot | Exact source/data/license/citation files and hashes | Fetch a selected release or explicit commit into a staging directory. |
| Generated catalog | Validated normalized records, units, aliases and provenance | Deterministic conversion from the snapshot. Never hand-edit generated records. |
| Ported calculation core | TypeScript counterparts of upstream Python functions | Focused source changes when calculation behavior changes, verified against Python. |
| Product policy | Consumer-site mappings, flagships, local overrides, headline scope and applicability | Separate reviewed overlay that an upstream import cannot overwrite. |

The reference snapshot and core tests cover the complete imported catalog. Production capability remains limited to workloads and sites for which the extension has suitable observations. Packaging may load catalogs lazily or derive a subset for supported providers, but every exclusion must be declared and all configured mappings, fallbacks and required historical profiles must resolve. Adding a supported catalog entry must not require handwriting its coefficients in the estimator, UI or server.

An upstream API model entry does not automatically identify a consumer-site model. Importing new data may still require a small mapping-data change. A tokenizer, provider extractor or new observation field is required only when the new model/workload genuinely needs it. This keeps data adoption separate from claims about extraction or physical accuracy.

## 2. Reproducible update tooling

Provide developer commands with these proposed semantics; final names may follow repository conventions:

```text
pnpm ecologits:update --version <upstream-release> --stage <directory>
pnpm ecologits:verify-update --stage <directory>
pnpm ecologits:adopt --stage <directory>
```

The first command intentionally retrieves public upstream material. The verification command runs against the staged artifacts and an explicitly prepared, locked Python environment without provider credentials or runtime network access. Adoption applies a validated local source/configuration change; it does not publish a release, deploy a server or change installed users' settings.

The workflow must:

1. Resolve the selected release to immutable source and package artifacts. Record Git commit, package hash, individual file hashes, converter version, core version, catalog schema, Python environment lock, license/citation hashes and mapping-overlay hash in a machine-readable lock manifest. A tag alone is insufficient if it moves later.
2. Preserve downloaded source/data unchanged. Generate our catalog into a separate directory, with each generated record traceable to its original JSON path and source hash. Preserve raw provenance even where an upstream loader drops it.
3. Produce a readable and machine-readable change report: added, modified, renamed and removed models/aliases; parameter, timing, provider, region, factor, unit, warning and source changes; calculation-function changes; new dependencies; and license/citation changes. Include changes outside obvious JSON files, such as provider defaults in Python.
4. Validate the complete candidate schema and reference graph. Unknown fields, architectures, units or semantic changes require classification rather than silent dropping. Detect duplicate/ambiguous aliases, invalid ranges, missing sources, removed flagship references and overrides that no longer apply. Preserve valid local overlays; report conflicts without choosing a replacement automatically.
5. Generate candidate expected outputs using the candidate's upstream Python calculation code and datasets. Compare the TypeScript candidate against those outputs. Separately compare the previous accepted version with the candidate and report the expected numerical changes to developer fixtures. A scientific change between upstream versions is not itself a port failure; a mismatch with the chosen candidate is.
6. Regenerate catalog outputs, notices, citation metadata, source-to-port map and coverage report deterministically. Running conversion twice with identical inputs must produce identical bytes. Ordinary builds and tests use committed/locked artifacts and never fetch `latest`.
7. Apply only the validated staged changes. Refuse to overwrite unrelated dirty files or unresolved manual edits. Preserve the previous lock and source snapshot, or an immutable verified retrieval artifact, for rollback and historical replay. A failed update leaves the accepted build unchanged.

Default to stable releases. To adopt a catalog fix before an upstream release, support an explicit immutable commit as a separate developer option. Record both the core commit and catalog commit, label the combination as our qualified combination rather than a released upstream package, and verify it with a reference environment constructed from that exact combination. Reject compatibility assumptions based only on an unchanged version string. Never make floating `main` the production source.

A scheduled watcher or automatic publication is not part of this requirement. The reusable commands are the maintenance interface; a later requested CI workflow can invoke them without changing the calculation architecture.

## 3. Different changes require different work

| Upstream change | Expected adoption path | Required evidence |
| --- | --- | --- |
| New model or corrected parameters in an already supported schema | Import and regenerate catalog; review relevant consumer mapping if needed | Candidate Python parity, catalog validation, provenance and changed-output report. |
| Electricity/provider data changes | Regenerate data/defaults under a new identity | Unit/scope/default checks and impact-delta report; no silent geographic substitution. |
| New schema, architecture or parameter | Extend converter/core input adapter where necessary | Explicit field classification and domain/compatibility tests. |
| Formula, default, interval or numerical-behavior change | Update the corresponding isolated TypeScript core functions | Candidate differential tests for intermediates, boundaries and final outputs. |
| New modality or required observation | Port and test supported core surface; keep production inactive until observations exist | New input contract/capture evidence before activation. |
| SDK tracing or unrelated documentation change | Record the diff; no port changes if outside the supported surface | Source map demonstrates no relevant calculation/data change. |
| Dependency, license or data-redistribution change | Review changed terms and inventory before adoption | Compatible release obligations satisfied; retain the current accepted version if unresolved. |

Keep a source-to-port map at function level, including upstream file/function, TypeScript location, fixtures and intentional exclusions. A changed relevant source function without a reviewed disposition makes update verification fail. Do not build an unverified general Python-to-TypeScript translator or evaluate remote formulas to claim automatic major-version support.

Most compatible catalog updates should be an import, review and test operation. A new release that changes algorithms still needs focused porting. Stable application interfaces prevent routine changes from spreading into storage, extraction or UI; genuinely new scientific inputs can require a coordinated contract change. No design can promise zero work for every future major release.

The future organization Python executor can adopt the native package through a pinned dependency update plus adapter/compatibility tests. This reduces translation work for that executor, but cannot make a local TypeScript engine support new Python behavior without a corresponding port.

## 4. Versions, distribution and historical results

Use separate executable-core, catalog, converter and product-policy identities, joined by a compatibility manifest. The semantic method hash binds the exact versions actually used. Preserve requested/effective engine and fallback lineage. Never reuse an existing published method ID/hash for changed coefficients or source behavior.

When a formerly absent model gains an eligible direct mapping, new work uses it according to the established resolution order unless an explicit developer model override applies. The configured flagship remains available for other missing models. Changes produce an impact-delta report and a new method/policy identity; existing originals retain their recorded proxy and parameters. Adoption triggers the already specified automatic recalculation view when it changes the effective method, without changing a user's selected engine or retokenizing saved numeric observations.

Retain method/profile snapshots needed by stored results. Keep compatibility implementations required for supported historical replay, loading them on demand. When retiring executable versions is necessary, declare the compatibility limit and retain readable original results; do not silently discard required profiles to shrink a catalog.

Personal extensions receive accepted updates through packaged extension releases by default and continue to calculate offline. They do not poll GitHub/PyPI or require an account. A deployment that already enables the existing signed data-update mechanism may use it only for compatible data, with exact schema/core constraints, signatures, provenance, atomic activation and rollback. Such data cannot add code, change the user's engine preference or alter archived methods. New code requires a packaged release.

The extension, organization Python adapter and all build variants must agree on the compatibility manifest before activating a method. Preserve the existing pending/incompatibility behavior for an older server. Keep the legacy original method frozen through every upstream update.

## 5. License obligations and project credit

The inspected [EcoLogits 0.11.1 license](https://github.com/mlco2/ecologits/blob/886d1ebfadb51a2d6407fcea6d9778c997c85c35/LICENSE) is MPL-2.0. Its sections 3.1-3.4 govern distribution of covered source, executable forms, larger works and notices. For this planned direct port, classify derived TypeScript files as MPL-covered and keep them visibly separate from original MIT application code. Moving or translating source does not by itself remove its obligations. Preserve applicable copyright, license, patent and warranty notices. New original files containing no covered code may retain the project's MIT license. [Mozilla's official guidance](https://www.mozilla.org/en-US/MPL/2.0/FAQ/) explains the file boundary and modified-source distribution requirements.

For each distributed build, including an original-default build that contains the selectable EcoLogits engine:

- Include the MPL-2.0 license text, applicable upstream notices and a third-party inventory identifying the exact covered files, source revision and our modifications. Use appropriate MPL/SPDX file notices or accompanying notices for formats such as JSON that cannot carry comments safely.
- Make the covered source, including our corresponding TypeScript modifications, available under MPL-2.0 and tell recipients where to obtain it. The upstream Python repository alone is insufficient for our modified port. Provide a stable version-specific source archive/repository reference that matches the shipped artifact and test recipient access before release.
- Keep source-availability information accessible from extension About/Licenses and the distribution documentation. Bundle readable notices so offline users can inspect them. Minified JavaScript is an executable form under Mozilla's guidance, so a bundled/minified extension still needs the corresponding source route.
- Keep the file-level license boundary correct in source archives, package metadata and SBOMs. Do not relabel the complete bundle or third-party data as exclusively MIT. Distribution terms must preserve recipients' rights to the covered source.
- Inventory dataset and transitive-asset rights separately. Preserve original and normalized data provenance and any required dataset attribution. An upstream software license does not establish rights to unrelated linked papers, model weights, documentation images or external datasets.

The source/distribution points above follow the pinned license and [Mozilla FAQ questions 8-11, 16 and 22](https://www.mozilla.org/en-US/MPL/2.0/FAQ/). The exact named About screen and release-archive layout are our chosen ways to meet them, not UI mandated verbatim by MPL. Source publication for all original project code remains the project's existing open-source commitment as well.

Give visible, accurate credit in the methodology article, About/Licenses, repository README and developer comparison reports. Proposed copy, populated from the release manifest:

> This extension includes a TypeScript port of EcoLogits [version], with model data from [revision]. EcoLogits is developed by its contributors and is part of CodeCarbon. Our integration and modifications are documented in the corresponding source. EcoLogits-derived source is available under MPL-2.0.

The inspected [upstream README](https://github.com/mlco2/ecologits/blob/886d1ebfadb51a2d6407fcea6d9778c997c85c35/README.md) identifies CodeCarbon. Preserve actual copyright notices rather than inventing a copyright owner from that affiliation. Identify our implementation as an independent port, with the supported version and scope; do not imply endorsement or use logos on the assumption that MPL grants trademark rights. The license's section 2.3 excludes a general trademark/logo grant.

Honor the citation requested in the pinned [CITATION.cff](https://github.com/mlco2/ecologits/blob/886d1ebfadb51a2d6407fcea6d9778c997c85c35/CITATION.cff): Samuel Rincé and Adrien Banse (2025), *EcoLogits: Evaluating the Environmental Impacts of Generative AI*, Journal of Open Source Software, 10(111), 7471, DOI [10.21105/joss.07471](https://doi.org/10.21105/joss.07471). Include that citation in methodology/research material and comparison reports; preserve the software citation metadata too. This scholarly credit and the chosen visible acknowledgments supplement the license obligations, rather than replacing them or being presented as an additional MPL condition.

Credit reflects what ran. An original-engine fallback is labeled as that engine in result details; the package can still acknowledge the included EcoLogits port. The native future backend and its distribution artifacts need their own exact dependency/license inventory. Using a separate hosted API's software or service would require its own review and is not authorized or licensed merely by adopting the core library.

## 6. Release and maintenance gates

Update tooling must detect license, notice and citation changes alongside numerical changes. Regenerate attribution from the actual accepted manifest, not a manually remembered version. Verify notices and matching source availability for every Chrome/Edge/Firefox build and both defaults. Missing covered source, broken source links, unresolved redistribution terms, dropped notices or an unclassified license change block adoption/distribution of the affected candidate, while the previous accepted release remains usable.

Demonstrate the maintenance workflow with three repeatable fixtures: a compatible model addition, a calculation/schema change that requires core work, and a license/notice change requiring review. Prove that the first does not need handwritten formula/UI/storage edits, the second cannot pass with a stale port, and the third cannot disappear from the report. Add regression cases for alias removals, local overlay conflicts, direct-model replacement of a prior fallback, repeatable generation and interrupted adoption.

This plan defines concrete compliance work. It does not claim that merely writing the plan has completed a license review or that future releases have already been cleared.
