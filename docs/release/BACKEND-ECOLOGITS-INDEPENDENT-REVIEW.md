# Independent backend EcoLogits review

15 September 2026. Branch `codex/modular-ecologits-refinement`, based on `15515fdb70b196c04d72e48494d8a9bc8090a6eb` with concurrent uncommitted implementation. **Final bounded verdict: CLEAN, including the later missing-lineage/0010 follow-up.** Both initial findings and the follow-up registry-boundary finding were independently verified resolved. Their original reproductions and remediation history remain below. The explicitly unverified production and external gates are not waived.

## Scope and independence

Read-only source review of `apps/server` and `packages/contracts/python/estimation_contracts.py`, including new untracked modules, against the modular plan and its acceptance matrix. Only this report is written by this reviewer. No backend source, fixtures, branch, deployment or external account was changed. Independent reproductions used temporary SQLite databases and synthetic observations; no private traffic was captured.

This task previously authored extension summary and server-summary TypeScript changes. Those files are explicitly excluded from this independent verdict. Running the backend's TypeScript contract/parity subprocesses verifies interoperability with their actual output, but does not constitute an independent review of that previously authored client implementation. Core port correctness, browser installation, performance, public source publication and production deployment require separate evidence.

## Confirmed findings

### B1: An unresolved live page permanently starves historical recalculation (P2)

Initial locations: `apps/server/aift/method_history.py:455`, `:463`, `:467`, `:491`.

`advance` spends the entire work budget on selected live rows, including rows for which `recover_original` returns `None`. It then assigns history only `budget - len(records)` slots. When exactly one complete page of live originals cannot be resolved, every subsequent tick wraps back to that page and history gets zero slots forever. This is an ordinary admitted state when previously observed methods are not installed, not a malformed database.

Independent reproduction:

1. Use the regular SQLite `setup` fixture, authenticate and connect an installation.
2. Upload one request with 100 unique attempts, each using `proposed_method_id="not-installed-historical-method"`. Upload in two valid batches. The server accepts and retains their numeric observations with pending estimates.
3. Upload one valid historical response using the frozen original method and 33 observed output tokens.
4. Select the packaged EcoLogits identity through authenticated `PUT /v1/me/estimation-selection` with revision 1 and a fresh operation ID.
5. Execute `aift.maintenance.run(service)` four times and inspect the job and `engine_estimates` after every tick.

Observed on all four ticks: `status="pending"`, `processed=0`, zero historical recalculated overlays. The eligible historical record is calculable independently of the unavailable live originals but never receives work. The original live records must remain pending, and the whole job must not be falsely marked complete. Fair bounded progress between record families is required. Relevant criteria: PR12, PR16, PR19 and PR20.

### B2: Historical export silently ignores invalid view/method combinations (P2)

Initial locations: `apps/server/aift/historical_usage.py:732` and `:747`.

The export route calls the shared `prepare_view` validator only when `calculation_view` is exactly `recalculated`. Other values and method IDs without that exact view are accepted and return original results. Their presence also suppresses automatic selected-view injection in `Analytics.__call__`. A malformed request therefore silently changes the requested/default calculation semantics instead of failing visibly.

With an authenticated installation containing one historical response, all three independent HTTP requests returned 200 and one original-resource record:

```text
GET /v1/me/history/export?calculation_view=typo
GET /v1/me/history/export?method_id=uninstalled-method
GET /v1/me/history/export?calculation_view=original&method_id=uninstalled-method
```

Validate all combinations with the same view contract as summary and record endpoints. Valid omitted/default, explicit original and completed recalculated exports must remain available. Relevant criteria: PR18, ST13 and selected-view export validation.

## Executed evidence

Environment: Windows x64, PowerShell, frozen uv environment, Python 3.13.12, native EcoLogits 0.11.1, SQLite. PostgreSQL test configuration was absent; no production target was inferred.

The following command completed with **314 passed, 1 skipped** in 115.30 seconds:

```text
uv run --directory apps/server --frozen --group dev python -m pytest -q tests/test_ecologits_engine.py tests/test_engine_selection.py tests/test_engine_exports.py tests/test_estimation_contracts.py tests/test_native_product_parity.py tests/test_method_history.py tests/test_migrations.py tests/test_restore_verifier.py
```

The skipped case requires an explicitly supplied isolated PostgreSQL target. These tests include actual upstream Python execution, TypeScript/native product and hash parity, malformed envelope admission, scoped selection and concurrency, immutable original revisions, mixed live/history recalculation, CSV provenance, canonical aliases, erasure, migration and offline restore validation. Existing tests passing did not detect B1 or B2; both were reproduced separately from source-derived scenarios.

The additional lifecycle suite completed with **114 passed**, no skips, in 171.78 seconds:

```text
uv run --directory apps/server --frozen --group dev python -m pytest -q tests/test_historical_usage.py tests/test_thread_relations.py tests/test_analytics.py tests/test_admin_api.py tests/test_completion.py tests/test_lifecycle.py tests/test_method_delivery.py tests/test_release_boundaries.py tests/test_restore_plans.py tests/test_ip_rotation.py
```

Combined baseline execution: **428 passed, 1 skipped** across these non-overlapping suites. Deprecation warnings concern Starlette/httpx, the AnyIO blocking-portal alias and Alembic path separators. They did not fail the tests.

An additional independent fault-injection check replaced native water-component execution with a synthetic exception during ordinary live upload. The HTTP request failed, the transaction retained zero canonical rows, a retry without the injected fault retained exactly the request and attempt, and a second replay returned two duplicates. This verifies atomic rollback and retry without duplicate accounting, not production engine availability.

A separate source-derived privacy check created five distinct enrolled members with otherwise matching live and historical observations. With the original method for all five, the member company summary was current and history available. With EcoLogits for only one member, live results were suppressed without resource fields and history was unavailable with an empty resource list. The additional method group did not disclose that member's values. This is direct local evidence for the mixed-engine portion of ST17, not a complete privacy audit.

An independent restart/revision check selected EcoLogits for one of two installations, processed one of three live records, and created a fresh application instance over the same database. The maintenance tick resumed the persisted job and promoted its complete view without changing canonical original estimates. A later attempt revision changed 500 output tokens to 7: the selected default returned 409 pending until maintenance recomputed it, then returned the correct total of 1007 tokens. The sibling installation continued to use its original default throughout. This is a SQLite application-restart test, not an OS/container crash test.

Independently invoked `native_runtime`, hashed all **21 locked installed Python/JSON files**, and compared them with the accepted upstream lock. All matched. The generated identity's source, core and catalog fields match the lock, with `source_artifact_sha256` correctly compared to the lock's nested source-artifact hash. The uv lock pins both the EcoLogits source archive and wheel.

| Identity | Verified value |
| --- | --- |
| Method hash | `6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e` |
| Core | `0.11.1-port.2` |
| Core source hash | `c5f61cfea5a3b6f6fb36ea5faf0b8ef2910b6c2fd25e295748bf80bc547aa810` |
| Catalog hash | `3573ccc5995257c4a4d1a0d07b5c3a120f058eea6c84e002c6566023b2dcccc6` |
| Upstream archive hash | `d24df5c0202bd5925376143f5b78d7273cb015d17323e660723e07e6fad223c0` |
| Full accepted lock file hash | `f1520d66e1a860cae13c5f612880c1b09b00ddb64d47e29592abbd6137c7ae1b` |

The requested commit is `886d1ebfadb51a2d6407fcea6d9778c997c85c35`. Exact installed-package bytes were verified; the complete package/tag-to-Git-commit relationship was not independently established here. The existing lock explicitly qualifies that distinction. No claim of fresh upstream attestation is made.

## Source and acceptance assessment

| Area | Assessment before remediation |
| --- | --- |
| Native execution and trusted methods | PASS in local execution. Runtime verifies version and source/data bytes, uses native `llm_impacts`, requires compatible core identity and admitted profile references, archives packaged policy definitions, and never accepts client totals as authoritative. LG01/LG09, PF01-PF08 and ST09/ST11 covered within backend scope. |
| Hash and source binding | PASS in inspected/executed scope. Requested/effective identities, both live dependency hashes, historical numeric hash, image auxiliary hash and input hash are retained and validated. Cross-runtime parity uses actual TypeScript and Python. Canonical aliases require scoped server proof rather than a client assertion. PF13, ST11-ST13. |
| Product scope and missing data | PASS in inspected/executed scope. Headlines use usage energy and usage GWP converted to gCO2e. Raw usage/embodied/total and ranges remain separate. Output total wins over answer output without adding thinking again. Zero/unknown output remains unavailable. No fabricated historical duration or unsupported input-length formula. Direct/upstream water remain separate and total water remains unavailable. PR01-PR11. |
| Original evidence and views | PASS in tested retention cases. Current and archived original methods/results are not rewritten to the chosen UI method. Recalculated envelopes retain original method hash and numeric source snapshots. Historical refinements retain the original observation/result. PR13-PR16, LG08. |
| Installation selection and scope | PASS in scoped tests. Strict payload, tenant/member/device authorization, monotonic revision conflict handling, operation replay and same-installation supersession are enforced. Member selection cannot create an organization-wide job or alter another installation's preference. BE08-BE12, PR17/PR21, ST15. |
| Automatic jobs and races | PARTIAL. Production configuration runs the existing maintenance process separately; API readiness requires its heartbeat. Durable cursors, revision checks, selection guards, deletion epochs and restart paths are implemented and tested locally. B1 prevents fair historical progress in an admitted partial state. PR12/PR19/PR20 cannot pass until corrected. |
| Aggregation and exports | PARTIAL. Compatible method groups retain requested/effective identity and comparability. Midpoint sums have no fabricated aggregate interval. CSV keeps raw originals and selected envelopes, phase, range and provenance fields; formula escaping remains. B2 leaves invalid self-export view requests unvalidated. PR14/PR18, ST17 within tested privacy scope. |
| Migration and restore | PASS for SQLite/source evidence only. Migration 0009 adds scoped immutable overlay storage without rewriting canonical originals and refuses automatic downgrade. Restore replays the protected erasure journal, drains erasure/rebuild work, reexecutes retained engine sources, checks identities and canonical rollups, and rejects inconsistent/missing data. ST07/ST08/ST14/ST16 have local evidence; ST18 remains UNVERIFIED. |

## Explicitly unverified gates

- Real PostgreSQL 0009 migration, transaction/race behavior, process crash/restart and offline restore on an approved production-like target. PostgreSQL DDL compilation and SQLite tests are not substitutes for ST18.
- Building/running the production container stack and independently measuring sustained ingestion/query/recalculation performance. The Dockerfile, Compose worker command, heartbeat and maintenance integration were inspected only.
- Actual installed Chrome/Edge/Firefox artifacts, provider noninterference, full browser performance and accessibility. This review does not close BC10-BC14.
- Fresh upstream commit attestation, corresponding public source access and full final distribution licensing. These are separate release gates.
- Physical resource accuracy, provider execution measurements and tokenizer calibration. Native parity demonstrates implementation fidelity only.

No production or complete-plan approval follows from this bounded backend review.

## First remediation recheck

B1 is independently verified resolved. `advance` now persists alternating live/history priority, lends unused capacity to the other family, and preserves the live cursor on history-only ticks. Repeating the exact original reproduction produced historical-overlay counts `[0, 1, 1, 1]` across four maintenance ticks. All canonical original payloads and estimates remained unchanged, and the unresolved job remained pending with no completion timestamp. A separate one-record-budget check with two added historical messages observed `(live inspections, history calculations)` of `[(1, 0), (0, 1), (1, 0), (0, 1)]`; every tick respected its budget and both historical records completed.

B2's three original malformed queries now return 422. The source calls the shared view validator for every historical export and reads the validated method. An independent selected-installation check also confirmed that queryless export returns the completed EcoLogits envelope while explicit `calculation_view=original` returns the preserved original result.

The first recheck found a remaining B2 boundary: `GET /v1/me/history/export?method_id=` still returned 200 with original resources for an installation whose queryless export returned EcoLogits. Parameter presence disables default injection, but `prepare_view` treats the empty method as absent. This was returned to the implementer for correction; B2 remains open until the explicit-empty case is independently rejected.

## Final independent closure

**B1: PASS. B2: PASS. No unresolved finding remains in this bounded backend review.**

The final `prepare_view` change rejects the presence of `method_id` for original views, including an empty value. Explicit recalculated views still require a nonempty method. Independently issued empty-method requests against both self-summary and self-history-export endpoints now return 422 with the correct typed error in all six cases. Queryless selected export, explicit completed recalculated export and explicit original export still return 200 with their respective identities and unchanged original resources. The earlier B2-open statement records the intermediate revision only.

The backend task also added same-engine full-identity equality in `validate_estimation_envelope`. Source inspection confirms it compares the complete validated requested/effective identity, rather than only the method hash; legitimate EcoLogits-to-original fallback remains distinct. Independent actual-native live/history envelopes were serialized through JSON, mutated in requested source version and effective implementation version, environment policy hash and method hash, and given valid recomputed input hashes. Python and the actual TypeScript validator agreed on all eleven cases: two valid same-engine envelopes and one valid cross-engine fallback accepted, all eight mutations rejected. This closes the reviewed identity-binding portion of ST11/ST13 without claiming an independent review of this task's earlier client-summary code.

Independently executed remediation checks:

- Method history, native EcoLogits adapter, installation selection, engine exports and the first fairness/export regressions: **103 passed** in 140.39 seconds.
- Python estimation contracts, actual native/TypeScript product parity and restore verification after identity hardening: **262 passed** in 11.96 seconds.
- Final fairness and expanded malformed-export regressions after the empty-method fix: **9 passed** in 12.98 seconds.
- Ruff on both remediated backend modules, Python estimation contracts and the three associated regression modules: **PASS**.
- Independent original reproductions, one-record work-budget checks, valid selected/original exports and cross-runtime identity mutations: **PASS**, as detailed above.

These reruns overlap earlier baseline tests and are not summed as a unique-test total. The 428-pass baseline and its one PostgreSQL skip remain separately recorded.

| Final remediated source | SHA256 |
| --- | --- |
| `apps/server/aift/method_history.py` | `cb0e3a4c4fa13cea0ddb4a07f4ef921278832374388fc8f91dde7532283fabe3` |
| `apps/server/aift/historical_usage.py` | `786df6d9552c81b622fb163a5ca2e8108b6793e96f7d41c805a4b26163a8fdd8` |
| `packages/contracts/python/estimation_contracts.py` | `dff98d6660be1b60cfeb4e100d0b5c6af9cd08391fe315e3e58ff9370b9e712a` |

The earlier PARTIAL assessments attributable to B1/B2 now PASS their local backend scope: fair automatic recalculation progress, strict view admission and selected/original export consistency. PostgreSQL execution, production container lifecycle/performance, native browser operation, complete upstream Git attestation and public distribution gates remain UNVERIFIED. CLEAN is not production certification or approval of the complete modular refinement.

## Reserved missing-original lineage follow-up

The parent authorized an additional bounded review after the preceding closure. It covers the live `unavailable-admission-v1` marker, selected recalculation with explicit missing lineage, migration 0010, related Python registry/contract guards, and their storage/restore behavior. Source remains read-only for this reviewer. The earlier source hashes describe the preceding revision; the follow-up hashes below identify this new scope.

### B3: Original-history registry dispatch ignored missing-original opt-in

During this follow-up, an independent call to `method_registry.estimate_history` using a valid historical response and options `{methodId: BASELINE_METHOD_ID, view: "recalculated", originalMethodMissing: true}` returned a populated legacy list. The same happened with the reserved marker substituted into the historical source. The native wrapper rejected this live-only opt-in, but the Original registry branch dispatched directly to the legacy historical helper without checking it. This was a registry-boundary defect, not a demonstrated exploit through the ordinary HTTP history recalculation route, which did not supply this option.

The implementer corrected `estimate_history` to reject true or nonboolean missing-original options, and to reject the reserved live marker on every historical source before either engine dispatch. Ordinary historical sources with an omitted or false flag retain their previous behavior. Independent rechecks of normal/marker historical sources against both Original/EcoLogits targets now reject the forbidden opt-in. **B3 is resolved.**

### Independently checked invariants

- The reserved marker does not resolve to an executable method. Initial ingestion retains the numeric attempt with a pending estimate and no original result. It does not silently assign the current build default as an original method.
- A missing-lineage execution requires actual live request/attempt DTOs, the exact marker, boolean `originalMethodMissing: true`, recalculated view, null original hash and an explicitly selected supported method matching the native definition. Known, arbitrary unknown and null-proposed sources cannot use the exception. Marker calls without opt-in and historical use are rejected.
- Persistence and lookup bind the source hash, scoped canonical attempt, marker and missing-lineage declaration. Missing canonical sources are rejected. Known current originals and retained legacy/engine original archives cannot be reclassified as absent.
- Selected Original uses an Envelope2 overlay for this path. The selected method remains explicit, `original_method_hash` stays null and `original_method_missing` remains visible in reasons and persisted lineage state. Old Original calls without opt-in retain legacy output. No legacy `resource_estimates` row is created for a missing-lineage result.
- Missing-lineage overlays count toward completed selected work for both engines. Other unresolved originals remain pending. The earlier family-fairness and strict-export fixes remain present.

### Independent execution and corruption probes

An authenticated fixture ingested one reserved-marker live attempt, selected Original, then selected EcoLogits. Both recalculations produced the requested Envelope2 result with null original hash and the explicit missing-lineage reason. The two overlays coexisted, canonical source and pending original bytes remained unchanged, ordinary original lookup stayed pending, and the legacy overlay table stayed empty. Running the actual restore verifier accepted both overlays and preserved their bytes.

A separate known-original fixture was copied into a forged marker source with a valid recomputed Envelope2. Normal persistence rejected it without changing the known original. Inserting that forged overlay directly into the temporary database to simulate corrupt restored data caused `verify_restored` to fail with `restore_engine_estimate_inconsistent`; known original bytes still matched.

A further probe backed up a database containing both selected overlays before authenticated erasure. Erasure removed all canonical observations, engine overlays and recalculation jobs. Restoring the pre-erasure backup and running the protected-journal restore verifier again left all three tables empty. No result or job was resurrected.

The initial standalone erasure probe passed its functional assertions but exited during Windows cleanup because a SQLite backup connection remained open. A later explicit cleanup command was blocked by policy and was not retried through another route. The synthetic fixture directory `%TEMP%/aift-independent-marker-erasure-jn64c171` may remain. The probe was rerun in a fresh fixture with explicitly closed backup connections: all assertions passed, process exit was 0, and that new fixture cleaned up successfully. No real user observations or credentials were used.

### Migration and test evidence

Migration 0010 adds a nonnullable, default-false `original_method_missing` column and replaces only the previous engine-overlay lineage constraint. The exception requires live/recalculated/null-original-hash state and the source marker. The legacy resource-estimate table is untouched. SQLite uses reflected batch copying that retains unrelated checks; PostgreSQL discovers the prior constraint by its normalized expression rather than assuming a deployment-specific name. Missing or ambiguous prior constraints fail. Downgrade still requires a reviewed backup and protected journal replay. Database/readiness/restore schema guards now require version 10.

Independently reran the populated 0009-to-0010 tests. They check exact stored JSON BLOB bytes including intentional whitespace, primary/foreign keys, indexes, unrelated constraints, default false, narrow invalid-state rejection, unchanged legacy table SQL/bytes and `foreign_key_check`. PostgreSQL reflection/DDL checks are simulated/compiled only, not PostgreSQL execution.

The following follow-up suite completed with **401 passed, 1 PostgreSQL-only skip** in 162.81 seconds:

```text
uv run --directory apps/server --frozen --group dev python -m pytest -q tests/test_missing_original_lineage.py tests/test_missing_lineage_migration.py tests/test_ecologits_engine.py tests/test_engine_selection.py tests/test_engine_exports.py tests/test_method_history.py tests/test_estimation_contracts.py tests/test_native_product_parity.py tests/test_restore_verifier.py tests/test_migrations.py
```

Ruff passed for all ten changed runtime/migration/validator modules and the three missing-lineage regression modules. These tests overlap previous evidence and are not added to earlier counts as distinct cases. Final post-interruption guard/regression results are recorded in the closure below.

| Follow-up source | SHA256 |
| --- | --- |
| `apps/server/aift/engine_adapter.py` | `cdcbe540e3a6cd4f9cc7a713d6f081bed0ef759abd0c88059b9d2160ee85edac` |
| `apps/server/aift/engine_history.py` | `822c4e405df16112c6734d1e112c30db52312f9182918ba5ecafa723683dc1b0` |
| `apps/server/aift/method_registry.py` | `84112bf501fa469f5673e5d4411762a70c9546d409fee58464a2dedab004135c` |
| `apps/server/aift/method_history.py` | `c1486a693ec9e7efeb7b1e3b8ce9bf8c9985654aae9f8246b41df883ad044d02` |
| `apps/server/aift/db.py` | `212e313bb25ce3ec7d8235d515dc603ac6e3485b6adcd079cb7a30b7f91e2cff` |
| `apps/server/aift/main.py` | `0573d4cd2e0a0268ca7053189cb80056d124461e0ef897072cf96eb34672c3f9` |
| `apps/server/tools/verify_restore.py` | `4ff52121f65ff732dac88b7b1d5a418356af9c777cc84f838b669c6c2ba347fe` |
| `apps/server/migrations/versions/0010_missing_original_lineage.py` | `fdb5c3cd52993459e6fe9c3b0cfe7ce18cd7aa68bfd77031ef2c1938ad4430ff` |
| `packages/contracts/python/estimation_contracts.py` | `9ccc48717e350e09423b020f962131a5d36e7c04ba1a8bf79ce64e52d25b8eb2` |
| `packages/estimator/python/footprint_estimator.py` | `ba428d2b0a0cd37a2c1465e21c2f6e5f74e5679aafdfdcb654f15989f01b8f14` |

The historical export module remains at its preceding reviewed hash. No PostgreSQL installation, alternate PostgreSQL executable or workaround around Application Control was attempted. The approved-environment decision remains outside this review.

### Follow-up final closure

After the usage interruption, the incomplete test process no longer existed, so its partial output was not treated as a pass. The final suite was restarted against the unchanged reviewed runtime hashes and completed with **135 passed, no skips**, in 117.83 seconds:

```text
uv run --directory apps/server --frozen --group dev python -m pytest -q tests/test_missing_lineage_guards.py tests/test_missing_lineage_migration.py tests/test_missing_original_lineage.py tests/test_method_history_fairness.py tests/test_history_export_filters.py
```

**Bounded verdict: CLEAN.** B1, B2 and B3 are resolved. Missing-lineage source proof, known-original retention, Original-target Envelope2 storage, strict registry guards, bounded family fairness, export validation and populated migration preservation pass the inspected and executed backend scope. The independent corruption and protected erasure/replay probes also pass. The 401-test and 135-test runs overlap and are not a distinct 536-test claim.

ST18 remains UNVERIFIED, now including migration 0010. Production container/process lifecycle, PostgreSQL restore/races/load, native browsers, full upstream commit attestation, publication and physical-model accuracy retain their earlier limitations. Only this report was changed by the reviewer; no source fixes, deployment changes, commits or pushes were made.
