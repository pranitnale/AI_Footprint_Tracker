# Independent modular ledger review

15 September 2026. **Initial verdict: FINDINGS.** This is a bounded, read-only review of the ledger refinement, including storage, migration, calculation jobs, original result lineage and selected views. It is not approval of the application, organization backend or browser release. Any later remediation verdict is appended below; the findings here describe the recorded initial snapshot.

Only this report was written in the repository by the reviewer. Independent scripts, results and source copies are under `%TEMP%/aift-ledger-independent-review-20260915/`. No production source, accepted fixture, commit or branch was changed. The earlier EcoLogits core review is preserved.

## Scope and pinned evidence

Branch: `codex/modular-ecologits-refinement`; HEAD: `15515fdb70b196c04d72e48494d8a9bc8090a6eb`. Windows x64, Node 24.12.0, TypeScript 5.9.3 and fake-indexeddb 6.2.5. The reviewer re-read plan sections 9-11, ST01-ST18, PR12-PR22, relevant BE/AR/RE/RL rows, and contracts for original assessments, historical retention and same-installation enrollment continuity. The matrix uses PR and RE identifiers; no invented RM criterion is assigned.

The initial `pnpm --filter @footprint/ledger test` passed **41 tests**, with zero failures/skips, and `pnpm --filter @footprint/ledger typecheck` passed. Review then used independent combinations rather than treating that test count as proof of concurrency correctness.

| Initial source file | SHA256 |
| --- | --- |
| `src/database.ts` | `fb7c2dfc56046b8b1fb0ba79a51fb2d6d1399bccaabf6a927e4bd2ec55a626fe` |
| `src/estimation-contracts.ts` | `587b1d66a6531f5f3e40bc13550b90f35984eb8f31e9c37d5912fc6b412d9d90` |
| `src/estimation-repository.ts` | `f13d11fa2185e041cf6757b522999d9a0159e3af6ebc28bca1b91c57e190fcc9` |
| `src/estimation-storage.ts` | `dddf898ae88e61320c0093f01e195e69eea51efc15e97ce4af90c237c4971b24` |
| `src/history-repository.ts` | `8fc8074dd85b7f599a7824016790d93af6106fa019b58e0f477b857fe0962100` |
| `src/index.ts` | `355fc8f41dbaed990257a13df25debb2b00b558f41174d6e54d71e1865e97de0` |
| `src/ledger-support.ts` | `34c819e5364108cd2f60de4bdbc89f0a62df007777811ff7a2621aa3de7bdb24` |

Those files were copied to `<temp>/reviewed-source/`. The parent then authorized a separate calculation-publication epoch fix while review continued. The later overlap/prior-era probe observed that work in progress (`publicationVersion` appeared). F1-F5 below reference the initial lines and unchanged relevant logic, not an assertion that later owner edits were frozen. The checked history and database files were unchanged at that point.

## Reproduced findings

### L1: Cancelling the selected base can publish an empty incremental view as complete (P1)

Locations in the initial source: `src/estimation-repository.ts:694-716` (`cancel`), `:649-675` (`promote`).

1. Capture A and complete selected method M job J1.
2. Capture B, start same-method incremental J2 and commit its result. J2 has `snapshotTotal=1`, `processed=1`, and inherits A from J1's published watermark.
3. Call the documented `cancel(J1.id)` while J2 is active.
4. Call `promote(J2.id)`.

Cancellation deletes every result under M, including J2's newly written result, but leaves J2 active with unchanged counters. Promotion succeeds. The observed selected state is `complete`, `processed=1`, `snapshotTotal=1`, `pending=0`, while the result store contains **zero rows** and both view rows are `pending` without a result. This violates the atomic complete-view invariant and can present a completed calculation with all contributions missing.

The base cancellation must invalidate/rebase dependent incremental work or preserve everything that work still legitimately needs. Promotion must not rely on counters whose persisted outcomes have been removed by another supported operation. Affected: PR17, PR19, PR20, AR10, BE08 and RE09.

### L2: A new envelope can replace a valid legacy original method pin (P1)

Location: `src/estimation-storage.ts:607-655` (`storeOriginal`).

A valid legacy original assessment can exist in `local_estimates` while the new input metadata has no `originalMethodHash`, as after migration. `resolveInput` correctly obtains its legacy method hash. `storeOriginal` checks only the input row's new pin and optional `attempt.proposed_method_id`; it ignores the already resolved legacy pin. For a legacy observation whose proposed method ID is null, a different engine's otherwise genuine original envelope is accepted and becomes the input's original lineage.

Independent reproduction stores an `estimateAttempt` legacy original for the current source, confirms `liveInput().originalMethodHash`, then calls `capture(scope, [], [ecologitsOriginalEnvelope])` for that same source. Before: original hash `7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9`. After: `6f503b82e000af2c9598cd1a2668ffdc6ea336d07525712859deee072ac7804e`, the test's EcoLogits method. The legacy row remains physically present, but its original lineage is no longer authoritative.

Preserve an established legacy method/hash pin before admitting a new-envelope original; do not require the archived attempt to have a non-null proposed method ID to protect its already validated assessment. Affected: ST01, ST13, original-engine preservation, PR12/PR16 and RL02.

### L3: Conflicting identities under the same method ID/hash are admitted and stall jobs (P2)

Locations: `src/estimation-repository.ts:261-365` (`start`), `:375-440` (cached-result advancement), and hash-only result keys in `src/estimation-storage.ts:116`.

After publishing M, call `start` with the same method ID/hash but a changed `implementation_version`. It is accepted by the shape schema and ledger. Because the full target differs, the job starts from zero with one source in its denominator. Because cache keys use only the unchanged method hash, `page` then skips the previous result, advances the cursor to the watermark, returns no inputs and reports `done=false`, `processed=0`, `snapshotTotal=1`. Promotion remains `recalculation_incomplete` indefinitely.

Reject inconsistent immutable method identities before creating a job or using any cached result. A schema-shaped identity is not evidence that its ID/hash has the same previously admitted contents. Affected: RL02, PR19, ST13 and pinned-method/cache integrity.

### L4: Limiting provider matches before filtering aliases can double-count a proved overlap (P2)

Location: `src/estimation-repository.ts:720-750` (`overlapsLive`), especially `getAll(..., 3)` before filtering canonical rows.

Using only public APIs, the reviewer captured four attempts with the same provider attempt key and request/site/conversation. IDs ending `...001`, `...002`, `...003` were marked as aliases of canonical `...004`. A historical response was then imported with that same proved provider attempt key. The first three provider-index rows are aliases, so the bounded read misses the canonical fourth row and returns false for overlap.

`viewPage({view:'original'})` produces one history row and one canonical live row, both with `contributes:true` and a valid original. One execution consequently has two permitted union contributions. The same predicate is used for selected views.

Find/resolve the actual canonical relation, or return an explicit unresolved classification when a bounded search is incomplete. A truncated set containing only aliases is not proof that no canonical match exists. Affected: PR13, RE08, exact-once union and contract section 14's overlap invariants.

### L5: A single deletion discards every unaffected selected result and forces full replay (P2)

Locations: `src/ledger-support.ts:245`, `src/estimation-storage.ts:582-606`, and `src/index.ts:1919-1948` / `:2270-2436`.

The new `invalidateSummaries(..., purge=true)` unconditionally calls `clearEstimationViews`, removing all calculation jobs/results for the namespace. The independent scenario completes M for A, B and C, then erases only A. B and C's dependencies, source bytes and method remain unchanged, but all selected results disappear; state becomes selected-null/pending-two and the next same-target job starts at cursor zero with `snapshotTotal=2`.

This also applies to live age-retention cleanup and retained history unrelated to expired live records. The package retention test explicitly expects the retained history result cache to be empty afterward. Anti-resurrection correctly requires removal of affected outputs and invalidation of unsafe work; it does not require recomputing every unaffected source. Preserve/reuse valid survivors and adjust publication state, or explicitly qualify a narrower incremental guarantee. Full namespace erasure must still remove all data.

This is a performance and availability gap against the requested same-target incremental behavior, not evidence of erased data resurrection. Affected: PR20, bounded recalculation requirements and ST14's retained-history usability.

### L6: Prior-era history is retained but absent from the new original/selected view contract (P2 plan gap)

Locations: `src/estimation-repository.ts:217-235` (`allowed`), `:751-785` (exact-scope input range), `src/estimation-storage.ts:42` / `:96`, and the README's declared archived-era limitation.

The reviewer imported valid history in era 1, then configured the same namespace/device as active in era 2 with an ownership history showing both eras. The compatibility `historyPage(era2)` still returns the retained row. Both new `viewPage` original and selected modes return **zero rows**, while `state(era2)` reports pending zero and the new job has an empty snapshot. No unavailable archived row or count is exposed by this API. Reopening/re-importing every conversation is not an automatic recalculation of stored observations.

Keeping strict era authorization is the correct security default; do not simply relabel older observations with the current era. However, the full approved plan requires preservation of original inspectability/counts and explicit unavailable/partial states when recalculation cannot use retained numeric history. Existing same-installation reconnect contracts already distinguish authorized earlier capture eras from another user's/device's data. An explicit authorized archived-era reader/recalculation contract, or a clearly integrated original/partial view that preserves those counts and resources, is still required.

**Assessment:** this is a blocker for claiming complete connected-history selected-view acceptance. It is not a physical data-loss finding: compatibility reads retain the original observations and assessments. It may be resolved partly in the application/backend, but the current exact-era ledger API alone cannot certify PR12/PR16/PR21, ST14-ST16 and the declared complete-history behavior. No evidence in this review authorizes cross-user, cross-device or arbitrary prior-era access.

### Calculation epoch correction in progress

The parent independently found that engine-preference CAS/promotion/cancellation incremented the general observation/cache epoch and invalidated recorded-page coverage. Initial source inspection confirms those operations called general `invalidateSummaries`. During this review the ledger owner began introducing a separate calculation `publicationVersion`. This boundary must be independently rechecked after the owner reports completion. The parent owns the full recorded-thread/UI integration check; a ledger-only counter test cannot by itself certify native UI behavior.

## Independent checks and their limits

All commands ran from the shared repository unless noted. Scripts use numeric synthetic fixtures only.

| Evidence | Observed result |
| --- | --- |
| `pnpm --filter @footprint/ledger test` | Initial PASS, 41 tests; fake-indexeddb only. |
| `pnpm --filter @footprint/ledger typecheck` | Initial PASS. |
| `node --import tsx <temp>/probes.mjs <temp>/probes.json` | Reproduced L1, L2, L3 and L5 using genuine executor envelopes and public ledger APIs. |
| `node --import tsx <temp>/migration-overlap.mjs <temp>/migration-overlap.json` | Verified actual version-11 schema and byte preservation; reproduced L4 and quantified L6. |
| `node --import tsx <temp>/rollback.mjs <temp>/rollback.json` | Mid-migration abort/retry and asynchronous transaction rollback PASS. |

`<temp>` is the directory in the opening paragraph. The initial bug outcomes are retained in their original JSON files; subsequent fix checks should use separate output names.

### Genuine version-11 migration

The reviewer extracted the **actual HEAD `packages/ledger/src/index.ts`** to a temporary file and imported its original `Ledger` class. Its version-11 IndexedDB schema was compared with the frozen fixture, including all 19 store names, key paths, auto-increment settings, index key paths, uniqueness and multi-entry settings: exact match. This avoids trusting the fixture merely because it is labeled version 11.

A populated database created and written by that original implementation was reopened through version 12. Canonical serialization of every old store was unchanged except for the additive `schema-12` marker. The new source index recovered the genuine original method hash. Existing package tests additionally cover retained numeric history, pending live/history outboxes, original legacy resources and method-catalog rows.

For a stronger interruption probe, the reviewer aborted the actual upgrade after its **second estimation-input put**, rather than only aborting before cursor work started. Reopening with the actual version-11 implementation showed schema version 11, no estimation-input store and all 19 old stores unchanged. A clean retry produced three indexed inputs. The frozen schema test also verifies the old connection closes and a requested downgrade to version 11 raises `VersionError` without database recreation.

The actual temporary version-11 source file SHA256 is `135cbe7004a71773f8816e64e2aab4281218b692c8e6283a7284f8cefcb5030a` (PowerShell-written UTF-8 copy); frozen fixture SHA256 is `da83676849d7bce5bbef4fe3c45b2c64300c4353087d5ba1a1fc5c8fe8bf1070`.

### Atomic writes, domain boundaries and concurrency

Capture validates envelope schema/input hash and exact current request/attempt source hashes within one write transaction. Invalid envelope or method data aborts previously staged observation/outbox writes. Canonical request binding is re-derived from the stored scoped alias chain; a self-consistent forged relation hash alone is insufficient. The inspected resolver rejects missing/cyclic/cross-era parent chains and source hash mismatches. An alias changes dependency metadata and invalidates obsolete result rows. Existing tests cover forged source bindings, genuine chained aliases and retained attempt bytes.

The calculation repository keeps transactions closed while external calculation runs. Result admission rechecks active generation, ownership authority, selection revision, current source sequence, source hashes and requested target. Superseded/cancelled active jobs and changed/erased source versions are rejected in the tested ordinary paths. L1 is the uncovered combination involving a *selected base* and a dependent active job; L3 is the uncovered immutable-identity collision.

The reviewer independently induced an asynchronous IndexedDB `ConstraintError` after a recalculated result was staged, by causing the existing job update to become a duplicate-key add. The operation reported sanitized `storage_write_failed`; the transaction left zero results and processed zero. The package's injected synchronous `QuotaExceededError` tests likewise roll back capture and result/job/outbox changes. These checks support atomic behavior in this engine. They do not establish actual browser quota, disk-full or shutdown behavior.

For ordinary new/revised input catch-up, the reviewed code uses per-scope increasing sequences and a completed watermark. Changed sources move beyond the active watermark, invalidate their obsolete result, and adjust the declared snapshot denominator. The existing 101-result test proves unchanged rows are byte-identical after adding one source, and the next job has one input. That successful common path does not cover L1 or the full invalidation in L5.

### Original data, erasure and scope

Current-source original envelopes are immutable under their source/method key in the tested version-12 paths. Unknown recalculation remains a terminal unavailable outcome rather than numeric zero. Retained older observation revisions and legacy resource arrays remain stored. L2 is the missing protection when that original pin exists only in legacy storage.

Request/range/namespace erasure removes corresponding input metadata, original envelopes, selected results and relevant queues, and stored tombstones prevent the tested reinsertions. Live age cleanup retains the separate history family and its original resources; personal installation preference survives scope erasure and personal records are not backfilled into a company outbox. Full server deletion-journal replay, restored backups, new-schema PostgreSQL migrations and remote authorization are outside these fake-IDB checks.

## Initial acceptance disposition

PASS means the stated bounded behavior was inspected and exercised. It does not certify native browser or PostgreSQL behavior.

| Criterion | Initial disposition |
| --- | --- |
| ST01 | PASS additive migration/schema and old-store byte preservation; FAIL continued protection of legacy original lineage through L2. |
| ST02 | PASS inspected capture/result atomicity, invalid-data rollback and injected sync/async failure recovery. Native quota behavior UNVERIFIED. |
| ST03 | PASS fake-IDB abort after partial migration and restart/retry. Actual browser crash/shutdown recovery UNVERIFIED. |
| ST04 | PASS version-change close and stale source/job guards in tested paths. Old/new installed browser tabs/workers UNVERIFIED. |
| ST05 | PASS local reading of old/new schemas through the refactored implementation; an actual rollback browser artifact UNVERIFIED. |
| ST06 | PASS unsupported version-11 open raises VersionError; no recreation/clear. Visible product recovery UI UNVERIFIED. |
| ST07 | PASS tested deletion/tombstones and removal of result variants; surviving-view availability/performance has L5. |
| ST08 | PASS tested request/range/profile anti-resurrection. Full data-adoption/restore replay UNVERIFIED. |
| ST09-ST11 | UNVERIFIED here: real organization compatibility, capability negotiation and server-authoritative recomputation. |
| ST12 | PASS current source/alias integrity and atomic rejection of malformed reconciliation envelope. Calling the common executor in every application path is outside this package review. |
| ST13 | PASS storage of mixed legacy/envelope2 shapes and malformed-envelope rejection; FAIL L2/L3 immutable lineage/identity gaps. |
| ST14 | PASS physical historical retention/no-personal-backfill; L5/L6 prevent full selected-history usability approval. |
| ST15 | PASS tested active ownership/era invalidation and stale job rejection; cross-user/device archived-era access must remain guarded. |
| ST16-ST18 | UNVERIFIED: backups/deletion journals, organization suppression and real PostgreSQL migration. |
| PR12/PR15/PR16/PR21 | FAIL complete selected-history gate due to L6; typed job/original APIs exist. Automatic application scheduling, UI labels and self-scope server work require parent verification. |
| PR13 / RE08 | FAIL L4 exact-once union with canonical aliases beyond a truncated lookup. |
| PR17 / PR19 / BE08 / AR10 | FAIL L1; ordinary active supersession/source guards pass. |
| PR20 | PASS normal one-source catch-up and concurrent revision handling; FAIL L1 and L5 combinations. |
| PR22 | PASS no text reconstruction/retokenization in the ledger; only numeric observations and result envelopes are used. |
| RL02 | FAIL L2/L3 original method and immutable identity admission. |
| AR05 | PASS narrow repository/capture interfaces and the exercised substitute repository/executor. Complete removal of store-name coupling from all application services is outside this package. |
| Summary epochs / calculation publication | INITIAL FAIL acknowledged by parent; separate publication epoch fix in progress, requiring re-review. |

The parent and ledger owner received the exact reproducers before writing this report. Fixes may proceed on the shared checkout. A later CLEAN verdict must identify the new source hashes and independently rerun the relevant negative combinations, not replace this initial evidence or infer correctness from the initial 41 passing tests.

## First remediation re-review, 15 September 2026

**Verdict remains FINDINGS. L1-L5 are resolved in their original reproductions; L6 remains an open plan gap, and two additional integrity/erasure cases fail.** The parent and owner have the new reproducers. This section does not treat the owner's passing tests as an independent verdict.

The reviewer read the diff against the archived initial files and independently reran all original scripts. The 47 ledger tests and strict typecheck pass. Original negative sequences now yield:

- L1: cancelling the selected base makes the dependent job stale; its promotion throws `stale_estimation_result`.
- L2: the attempted replacement of a validated legacy pin throws `method_admission_conflict`.
- L3: changed metadata under an admitted ID/hash throws `method_update_invalid` before the job replaces selection.
- L4: canonical fourth after three aliases now produces `history.contributes=false`, `live.contributes=true`.
- L5: deleting A preserves the two original B/C result rows; selected state remains complete with pending zero, and same-target catch-up has `snapshotTotal=0` at the completed watermark.
- L6: compatibility history still returns one prior-era row, while the exact-era original/selected views return zero and their job reports an empty snapshot. No resolution of this plan gap is claimed.

Outputs are retained separately as `<temp>/probes-remediated.json` and `<temp>/migration-overlap-remediated.json`. The actual version-11 schema/upgrade check also passed again.

### Independent calculation epoch verification: PASS

`<temp>/epoch.mjs` executes the same scenario using both the archived initial implementation and the remediated implementation. The initial observation version moves `1 -> 2 -> 3 -> 4` across promotion, preference CAS and cancellation. The corrected implementation keeps observation version at 1 and erasure version at 0, while calculation `publicationVersion` moves `0 -> 1 -> 2 -> 3`. This proves the separate local publication epoch directly. Its output is `<temp>/epoch.json`.

`node --import tsx --test apps/extension/test/recorded-threads.test.ts` independently passes all 29 tests, including the large multi-page recorded subset. This is still Node/fake-IDB/local route evidence, not native browser or PostgreSQL migration evidence.

### L7: Recalculated effective-method identity bypasses the immutable registry (P2)

Location: `src/estimation-repository.ts:commitResult` (initial first-remediation implementation starts around line 487); `src/estimation-storage.ts:648` registers identities for start/original admission only.

Clone a genuine recalculated EcoLogits result, change only `effective_method.implementation_version` to `forged-effective-version`, and recompute its `input_hash` with the contract helper. Keep requested method, method ID/hash, source, raw output and all observations unchanged. The envelope schema accepts it. `commitResult` returns `applied`, and promotion publishes a selected result whose effective metadata conflicts with the already registered target identity under the exact same method ID/hash.

The requested method is compared with the job, but effective identity is not checked against the registry or the same-engine requested identity. This is not a mathematical formula test: it is a self-consistent but false execution attribution that the persistence boundary was required to reject. Validate effective identity as well, including the rules for a legitimate original-engine fallback. Affected: RL02, ST13, RE03/RE04 and pinned-method integrity.

### L8: Preserved aliased originals are missed by canonical-family erasure (P1)

Locations: `src/estimation-storage.ts:touchAliases` / `touchInput(..., eraseOriginals=false)` and `src/index.ts:2270` (`eraseFamily`).

Capture two duplicate request/attempt families with genuine original envelopes. Mark the first request as an alias of the second request and its attempt as an alias of the second attempt. The remediation correctly preserves both original envelopes during aliasing, but removes the aliased attempt's current input-index row. Then call `eraseFamily` for the canonical request ID.

Observed result: one aliased original envelope remains, along with the aliased request/attempt rows. Canonical dependency cleanup no longer reaches that retained original because its input-index row has been removed and its observed request ID differs from the canonical request ID. Original envelopes before erasure: two; after erasure: one. Namespace-wide erasure still removes everything, but that does not satisfy family erasure.

Preserving original assessments during aliasing is required; family erasure must traverse the relevant stored alias closure and remove those original variants as well. Do not solve this by again discarding originals when merely creating aliases. Affected: ST07/ST08, alias erasure and the original/selected anti-resurrection contract.

Both L7 and L8 are reproduced in `<temp>/remediation-adversarial.mjs` with numeric-only evidence in `<temp>/remediation-adversarial.json`. All actions use public ledger capture, alias, result and erasure APIs; only the intentionally forged result is mutated outside those APIs. The current executor returns frozen method objects, so the test uses `structuredClone` to model an untrusted returned DTO rather than modifying the executor's registry.

A further L8 ordering variant is retained in `<temp>/attempt-alias-erasure.mjs` and `.json`: establish only the attempt alias, before any request alias exists, then erase the canonical request. The aliased attempt and original envelope also survive in that state. Request and attempt reconciliation are separate supported operations, so erasure must include the reverse attempt-alias closure. An otherwise independent observed request should not be deleted merely because one of its attempts is aliased. This remains the same family-erasure finding. The parent and owner received the variant while their correction was in progress.

### First-remediation source identity

The seven files were copied to `<temp>/reviewed-source-round2/`. Database, history repository and facade hashes remain those in the initial table. Changed files at the residual finding snapshot:

| File | SHA256 |
| --- | --- |
| `src/estimation-contracts.ts` | `4ec7f37ff8059b29ef7082c02d8827841421f1dd609421692dc1ab9fa9e9e73f` |
| `src/estimation-repository.ts` | `f70021ae1f45565a83e3403b4c01e4000b1539cac21096d8818f6dd405e04d46` |
| `src/estimation-storage.ts` | `835d2d2f95e78ff6ea8c13f36a683cc293b3f9d7babcd3f035b59d01549d88be` |
| `src/ledger-support.ts` | `0c33b9e10e1c7ecf15d75bb646623596b5d7d1300f99ffc94f35ba7a3c073092` |

L1-L5 and calculation-epoch scope may be marked PASS for this revision, but L7/L8 prevent correctness/erasure clearance, and L6 still prevents a claim that all connected historical selected-view requirements are complete.

## Prior-era local authorization design assessment

At the parent's request, the reviewer separately assessed whether L6 needs upload-eligibility proof. **A local-only read/calculation grant need not require device upload proof for numeric observations already readable by the same authenticated user.** Actual `apps/extension/lib/company.ts:411` creates the namespace from both company and user IDs, and `ownership.ts` records exact historical era scopes. Under that premise, local arithmetic creates no additional reader or external disclosure. Missing historical upload metadata should not, by itself, make those local numeric observations uncalculable.

The grant should be derived from current active session/ledger state and a matching saved ownership era in the same company/user namespace. Keep each observation's captured scope, era, hashes and original method unchanged. Separately bind the calculation job's publication authority to the current connection/ownership identity, selected method revision and erasure generation. Revalidate meaningful authority changes, revocation, scope switch and erasure at reads and publication; routine access-token refresh should retain the existing non-rotation semantics.

This local grant must not authorize observation reassignment, outbox creation/draining, remote estimation, server-canonical recomputation or another device's upload. Those keep their existing, independent device/era capability checks. Accepting another namespace's era, or reusing the local grant to send records, would be a concrete boundary violation; the parent's proposed separation excludes those actions. A source that lacks even local ownership evidence still needs an explicit unavailable/partial state and preserved inspection/count behavior, not silent omission from an empty complete view.

This is a design assessment, not implemented-code acceptance of L6. No source was changed for it.

## Second remediation re-review, 15 September 2026

**L7 and L8 are independently CLOSED; verdict remains FINDINGS for L6 and the interrupted linked-history cleanup case L9 below.** The reviewer reran the original effective-identity, joint-alias and attempt-only-alias probes. Forged same-engine metadata is now rejected by the shared envelope schema and ledger defense. Cross-engine results must match the full child identity pinned in `start.fallbackMethod`; the child is also checked against the immutable registry. Joint alias erasure leaves no original envelopes or aliased records. Attempt-only alias erasure leaves no original envelope or attempt while preserving the independent request.

The reviewer ran `pnpm --filter @footprint/ledger test`: **52/52 PASS**, zero skips; strict typecheck also PASS. The suite includes capture/write/reconcile replay rejection for attempt tombstones and interrupted reverse-attempt cleanup. Independent mid-migration and asynchronous-write rollback probes passed again. Results are saved under `<temp>/remediation-adversarial-final.json`, `attempt-alias-erasure-final.json` and `rollback-final.json`. These filenames identify that recheck, not final acceptance of all ledger requirements.

Checked SHA256 values:

| File | SHA256 |
| --- | --- |
| `packages/ledger/src/index.ts` | `14f5f2c38e5c8fc2b2e6b9d92069f1a42440836d85a1fce3635d8ef77c9fb4e9` |
| `packages/ledger/src/estimation-repository.ts` | `8e01fb8cc86db74a4512a2b360b098414195368f5f3e89f5192a855120adf6d0` |
| `packages/ledger/src/estimation-storage.ts` | `fdff3b96fc7f94ca0864883e06bda31bc836aac6055cfb155f22e1aef43fc012` |
| `packages/ledger/src/ledger-support.ts` | `cea3cfccb6d38049349c7402e47e2e7f4dffba09a47d6982f30dd7cf70843b59` |
| `packages/ledger/src/estimation-contracts.ts` | `1125e6eb77ec3c969978f975b390af3f761b69296c06d7c769ea5fb9ccb2b4c7` |
| `packages/contracts/src/estimation-result.ts` | `3644775ffbdc3e8a1abd935e7438162da3e72309667b67ce15484dff2acba1d6` |

Database and history-repository hashes remain unchanged from the initial table. The shared contract change was made by the implementation team; the reviewer only read and tested it.

### L9: Interrupted linked-history cleanup cannot resume and the erased execution contributes again (P1)

Locations at this snapshot: `src/index.ts:2303-2406` derives stable identities from current live rows; `:2509-2514` calls `eraseHistoryLinks` after committing the live-family deletion; `:2667` onward performs historical cleanup. Request/attempt tombstones retain era and reverse attempt IDs but not the provider-stable cleanup linkage needed once live rows are gone.

Independent reproduction:

1. Capture a live family and a historical response with its proved provider attempt key. Verify the history is excluded from union contribution.
2. Inject one failure at `eraseHistoryLinks` after `eraseFamily` has committed removal of the live family. This models the gap between two real storage phases; it does not alter production source.
3. Restore the helper, close/reopen the ledger, and retry `eraseFamily` for the same request ID.

The retry has no parent/attempt rows from which to recover stable keys, so it completes without removing the linked history. Observed after reopen/retry: one history row, one original envelope, and a history view row with `contributes:true`, `state:'original'`. The execution that was explicitly erased now contributes through the retained history because its live counterpart no longer exists.

The existing reverse-attempt tombstones solve a different interrupted phase. Recovery also needs durable, minimal pending historical-cleanup linkage and a read/publication guard while that cleanup is incomplete. A failed or retried erase must not turn a previously matched historical row into a fresh contribution. Retention-only cleanup must continue preserving history; this reproduction uses explicit family erasure.

Scripts and evidence: `<temp>/history-cleanup-interruption.mjs` / `.json` and the stronger close/reopen variant `<temp>/history-cleanup-restart.mjs` / `.json`. This is a verified failure of the current erasure implementation; the review does not assert that the underlying interrupted-history gap originated in this remediation. Affected criteria: ST07/ST08, PR13/PR17 and explicit-erasure anti-resurrection. Native process-kill behavior remains untested, but the committed data state and failed recovery are reproduced through fake-IDB storage and the public erase API.

## Critical residual closure, 15 September 2026

**Latest verdict: FINDINGS for L6 only. The reviewed critical calculation, identity and erasure findings L1-L5/L7-L9 are CLOSED.** The local prior-era authorization design is accepted in principle, but no implementation of that separate phase is included in this snapshot. The parent was notified that the critical-residual hold can be released.

The reviewer inspected the final L9 implementation. It persists minimal provider-stable cleanup keys before deleting the live source, carries pending explicit-erasure intent through retries, and removes the pending marker only after linked history is physically cleaned. A shared erasure predicate checks namespace, message, personal/stable-identity and explicit-range tombstones. Normal history reads, upload candidates and calculation inputs are suppressed during the incomplete purge; internal erasure scans still see suppressed rows. Original resources are not exposed from an unresolved erased history input. Live age-retention keeps its separate historical exemption.

The reviewer independently ran:

- `pnpm --filter @footprint/ledger test`: **54/54 PASS**, zero failures/skips. This includes the previous 52 cases plus direct-family and attempt-only-alias linked-history interruption/reopen tests.
- `pnpm --filter @footprint/ledger typecheck`: PASS.
- `node --import tsx <temp>/history-cleanup-read-guards.mjs <temp>/history-cleanup-read-guards-final.json`: PASS. After interruption and reopen, public history count is zero, pending upload count is zero and the original view is empty. After retry, physical history and original-envelope counts are both zero. The original L4 canonical-fourth overlap and actual version-11 migration assertions in that independent script also pass.

Earlier independently passed migration-abort, asynchronous-write rollback, same-method incremental reuse, genuine original-pin protection, effective identity, alias-only erasure and epoch/recorded-thread checks remain documented above. The latest full suite re-executes their permanent regressions. This does not substitute for native Chrome/Edge/Firefox shutdown/quota testing or PostgreSQL recovery.

Final source SHA256 values for this critical-residual closure:

| File | SHA256 |
| --- | --- |
| `src/database.ts` | `fb7c2dfc56046b8b1fb0ba79a51fb2d6d1399bccaabf6a927e4bd2ec55a626fe` |
| `src/estimation-contracts.ts` | `1125e6eb77ec3c969978f975b390af3f761b69296c06d7c769ea5fb9ccb2b4c7` |
| `src/estimation-repository.ts` | `7d3e03d060a3074eee26e6a6eef203b7e0611ae712baf0987d71f1be26d92874` |
| `src/estimation-storage.ts` | `dfdba34338136fd64b49f37ce7b053a507417da3883923dae9e425ea6ce03ab7` |
| `src/history-repository.ts` | `511a36ac7575c4694ec38ca6077558686b660b6d731f777986479b6defa62c51` |
| `src/index.ts` | `2555810caf50082a1a679b44cf505db9e1d22e95330e9eca4dcde1a38c77d0a9` |
| `src/ledger-support.ts` | `100f44ab7517f7cf6b39a89eeaa5d2ce3719060aaefc20a4c5fd6e0b387a2ec4` |

**Remaining acceptance:** L6 still blocks complete connected-history selected-view approval. The code must implement and independently test the local read grant, keep upload/remote authority separate, retain actual source-era identity and preserve explicit unavailable/count behavior. The application's startup/maintenance path must also invoke durable pending-cleanup recovery; this package review proves that retry works after reopen, not that a particular browser startup scheduler invokes it. Other native-browser, backup/server and whole-application rows retain their stated UNVERIFIED status. No source files were modified by the reviewer, and the earlier core review remains unchanged.

## Local-selection and version-13 phase review, 15 September 2026

**Initial new-phase verdict: FINDINGS.** The implementation now provides the previously missing local read grants, a coherent selection vector/token, explicit preference repair, bounded cleanup recovery, original-live lookup and additive version-13 metadata migration. The reviewer independently ran the initial **134-test suite and strict typecheck**, both PASS. Three adversarial combinations below still failed. Implementation continued after those findings were reported; the source snapshot and original probe outputs are retained separately.

New evidence directory: `%TEMP%/aift-ledger-local-selection-independent-20260915/`. `grant-adversarial.mjs` and `.json` contain all three reproducers. `source-snapshot/` retains the ten ledger source files at the finding boundary. No source was edited by the reviewer.

### L10: Authorized cross-era live/history overlap contributes twice (P1)

Location at the finding snapshot: `src/estimation-repository.ts:877`, inside `overlapsLive`.

Capture a live execution in era 1, renew local authority for the same company/user namespace in era 2 with era 1 explicitly retained in ownership history, and import its historical response in era 2. The response has the same proved provider attempt key, site and conversation as the live record. Complete the selected local calculations for both granted members.

Observed: the selection vector is `ready`, both members have pending zero, and both the era-2 historical row and era-1 live row return `contributes:true` in their selected views. One proved execution has two contributions. The overlap helper still filters canonical records to `row.era === input.scope.era`, which was insufficient once the view union legitimately spans several locally authorized eras.

Resolve overlap over the relevant locally granted canonical source scopes, retaining the existing site/conversation/ambiguity checks. This does not authorize foreign namespaces, unknown eras or uploads. Affected: PR13, RE08, exact-once union and L6's completed multi-era view.

### L11: Re-import leaves an obsolete current-input directory entry (P2)

Location: `src/history-repository.ts:209-237` at the finding snapshot, where the current history row receives `era: scope.era` and only the new-era input is touched.

Import a historical message in era 1 and re-import the same `message_key` after authorized renewal to era 2, with identical numerical payload and proposed method/hash. Only the acquisition timestamp changes; its numeric payload hash is unchanged. The physical history table has one current row, but `estimation_inputs` contains two era-specific entries. Completing both granted jobs yields a phantom unavailable result for the obsolete era-1 directory entry and a successful era-2 result. The vector reports `ready`, `unprovableCount=0`, and one input in each member despite only one retained current message.

Keep exactly one current directory/source entry for the canonical message, while preserving archived original bytes. The existing import-era/upload routing policy is a separate contract; this finding does not require copying data into another device's queue or changing that policy. Retire obsolete current metadata when needed, or preserve the original source era with separately reviewed acquisition/outbox metadata. Affected: PR13/PR16/PR20, progress/availability counts and current-source identity integrity.

### L12: A later reserved marker can conceal earlier admission evidence (P2)

Location: `src/estimation-storage.ts:471-491` at the finding snapshot (`explicitlyUnadmitted`).

Capture revision 1 with `proposed_method_id` set to the known original method, but no completed result envelope. Its state is correctly `unavailable`. Write revision 2 with `proposed_method_id='unavailable-admission-v1'`. The new classifier checks stored result/pin evidence, but not the earlier immutable observation measurement. It changes the state to `not_admitted`, allowing a selected local recalculation with `original_method_hash:null` and `original_method_missing` to be committed and published. The original known proposal remains plainly present in `measurements`.

The reserved exception is intended for a family that was explicitly never admitted, not a way to retroactively reinterpret an earlier known or unknown admission. Preserve and check immutable admission history, including when no estimate was completed. This is distinct from the previously fixed case with an existing validated result pin. Affected: original-lineage integrity, BE07, ST13 and the new reserved-admission contract.

### Independently verified migration and boundary evidence

`actual-v12-upgrade.mjs` imports the archived, real version-12 ledger implementation retained by this reviewer in the earlier phase. It populates genuine original and completed recalculated rows, scoped policy and a legacy unknown-era observation. The version-13 upgrade preserves every existing row across all **25 stores**, adds only the missing input/state metadata and `attemptSource` index, and adds the schema marker. The unknown-era input appears as `partial` with `unprovableCount=1`; the known completed member remains available.

The reviewer also aborts that actual upgrade during its first missing-input write. Reopening with version 12 restores every original row and the pre-upgrade index set. Retrying successfully reaches version 13; attempting to reopen afterward with version 12 raises `VersionError`. Results are in `actual-v12-upgrade.json`. These are fake-IDB transaction tests, not native browser shutdown evidence.

Source inspection confirms the intended separation: grants come from the current matching company/user or personal namespace and stored ownership eras; active jobs bind a fingerprint of meaningful trust/ownership state; ordinary credential-token refresh is excluded from that fingerprint. Calculation commits are local-only. Upload admission retains its separate current enrollment/device checks. Completed immutable arithmetic may be reused under a renewed local read grant; source identity is not relabeled by calculation.

The vector is capped at 64 members with an explicit overflow/unknown count. It binds source sequence, member publication state, current preference, authority and erasure epoch, while excluding ordinary page cursor progress. The fifth `publicationSnapshot` argument checks that token within the same read transaction. Invalid preference state may still allow an explicitly Original view under a valid grant, while new calculation jobs require a valid selection revision. Tests cover stale tokens, foreign/revoked authority, invalid preference repair races and bounded original lookup; application UI use of these contracts is a separate parent gate.

`originalForLive` validates the current exact attempt, source scope, actual current request-alias chain and immutable archived request/attempt measurements before returning an original envelope. The two-row ambiguity detector requires an independently verified current pointer before choosing among multiple exact-attempt originals. Cleanup recovery handles at most 32 durable targets per call, revalidates marker identity and leaves failed work retryable. Neither helper adds network access.

Finding-boundary SHA256 values for the most relevant files:

| File | SHA256 |
| --- | --- |
| `src/estimation-repository.ts` | `0e86ad82d297af4a749e10b0647db625107a5eaf75192d9217f86afbc067e7b9` |
| `src/estimation-storage.ts` | `f31c35a5b396dde46bb11a947de8c44e5566b99c14d473a82210391bfc9db83d` |
| `src/history-repository.ts` | `511a36ac7575c4694ec38ca6077558686b660b6d731f777986479b6defa62c51` |
| `src/local-selection.ts` | `6f1123ab7e9f94f1bf655f93af33a1d098cafc7a1ab4320d04548a7a482b0bbe` |
| `src/original-live.ts` | `78aa6b42584facb66eb356d9c64711fb67be3b50cf12b015e7a535ee45ecb98f` |
| `src/cleanup-recovery.ts` | `893ea319cea0e643b0403c6cfcb26069a4171a6967059b54b6a7e88008d98e4b` |
| `src/database.ts` | `5bbcc99598cc7e98e5b221e70de6ce6553c426593f451d780212be40d00c476c` |

The owner reported small follow-ons during review, including the stronger personal namespace check, standard original-view use of the archived lookup, and an invalid-preference Original-publication test. The table reflects the captured source boundary after those changes, while 134 is the initial executed full-suite count. Later verification must record its own final count/hashes. The local read-grant design remains supported; L10-L12 require focused corrections rather than a return to upload-proof requirements.

## Final local-selection remediation review, 15 September 2026

**Latest verdict: CLEAN for this bounded ledger snapshot. L6 and L10-L12 are independently CLOSED.** Previously closed L1-L5/L7-L9 remain covered by the final package regressions and the evidence above. This clears the ledger findings recorded in this report; it does not certify all application acceptance rows or authorize a release. The owner confirmed no ledger source edits remained in progress before the final snapshot was recorded.

The reviewer inspected the corrections and independently reran the original three reproducers without changing their scenario logic:

- **L10:** The canonical overlap search now accepts locally readable source eras in the same namespace, retaining canonical, ambiguity, site and conversation checks. The authorized two-era scenario publishes two source rows with exactly **one contribution**: live true, matched history false. Both members have pending zero.
- **L11:** History reimports preserve the first canonical source era and record the latest acquisition era separately in optional internal `lastImportEra` metadata. A duplicate does not create another calculation input. The reproduction now has **one physical history row and one current input**, no unavailable result and no unprovable count. Refinements update the input under its retained source era. Original bytes remain preserved; upload queue routing still uses the current enrollment/device.
- **L12:** The reserved never-admitted exception now checks every retained immutable attempt measurement, including source identity, revision key and hash. An earlier known or legacy-null proposal prevents the exception, even without a completed original result. The reproduction remains `unavailable` after the later marker and rejects the null-original result with `method_update_invalid`.

Independent outputs are retained as `grant-adversarial-remediated.json` in the new evidence directory named above. The initial failing `.json` and source snapshot remain intact.

### Local authority, publication and recovery checks

`positive-grant-remediated.json` verifies that an authorized earlier-era history observation can be recalculated locally after the same user's device/enrollment changes. History, original and outbox bytes remain unchanged by that calculation. The old device's queue is still ineligible for upload, a remote-origin result is rejected, and revocation rejects a late result commit and invalidates both the local vector and the atomic publication guard. These results close the package-level L6 gap under the accepted local-read-grant design.

`cache-guard.json` verifies the additional fifth `cacheSummary` argument. An engine preference change leaves the observation epoch unchanged but invalidates the previous calculation token. Attempting to cache with that stale token rejects with `aggregate_inconsistent` and preserves the prior cache bytes. A current token is stored with the cache; a foreign-namespace authority cannot authorize the write.

The reviewer also inspected the final saved-Personal compatibility path. Read authority requires the persisted Personal namespace and a matching recorded ownership era. It permits original and completed-result reads when routing falls back from company mode. Job start and commit retain their separate active-ownership requirement. The final package regression checks reads, job denial, trust-token rotation, revoked-company denial, pending-cleanup suppression and Personal erasure. This does not extend a Personal grant to company records or grant capture/upload authority.

The actual version-12 upgrade/abort/downgrade script was rerun against the remediated source. `actual-v12-upgrade-remediated.json` again confirms all existing rows across 25 stores remain unchanged, migration adds only metadata/index/schema changes, an aborted upgrade restores version 12 and its index set, and downgrade after successful version 13 raises `VersionError`. A retained completed member remains readable while the unknown-era observation is explicitly partial with one unprovable input. The earlier public `resumePendingCleanup()` recovery probe also passed after the version-13 change; recovery remains bounded and does not expose erased history while work is pending.

### Final executed checks and source boundary

- `pnpm --filter @footprint/ledger test`: **145/145 PASS**, zero failures or skips. Full output: `ledger-final-tests.txt` in the new evidence directory.
- `pnpm --filter @footprint/ledger typecheck`: PASS.
- From `apps/extension`, `node --import tsx --test test/history-service.test.ts test/history-engine-service.test.ts test/dashboard-health-cache.test.ts test/recorded-threads.test.ts`: **65/65 PASS**, zero failures or skips. Full output: `extension-final-tests.txt`.
- The original three adversarial cases, actual-v12 migration, positive local grant and stale-cache probes all pass as described above. Source changes were made by the implementation team; this reviewer wrote only the review report and temporary evidence files.

Final SHA256 values, relative to `packages/ledger/`:

| File | SHA256 |
| --- | --- |
| `src/index.ts` | `b243fcdbd8ad8c0225ae22010986d12f12532f2065f3aa83805054eb63b08619` |
| `src/database.ts` | `5bbcc99598cc7e98e5b221e70de6ce6553c426593f451d780212be40d00c476c` |
| `src/estimation-contracts.ts` | `b4954ac9e45b0e918daa0cfb722666dd0da5c521a772dae089b442640af50f6a` |
| `src/estimation-repository.ts` | `0ea40a88a8f9a7eed5c8ee138975350812c414218ff9dfb3cb928836f1584940` |
| `src/estimation-storage.ts` | `9cf4223256420f4fba5ae8e364412334e10c0c4356cb57946a951ba37c33a2f0` |
| `src/history-repository.ts` | `24ad4fa5db951d513d6dc1f29545d3e355543d738ec7fe359dbd15caf16d4d49` |
| `src/ledger-support.ts` | `f2fd428b1453da8b96634f8c6c50810743fd9d181ae5d723607d6517f5b1d503` |
| `src/local-selection.ts` | `f906680e8205008aef19f2eebfe5b802f30d843a542eb7600f66c40ed7875225` |
| `src/original-live.ts` | `78aa6b42584facb66eb356d9c64711fb67be3b50cf12b015e7a535ee45ecb98f` |
| `src/cleanup-recovery.ts` | `893ea319cea0e643b0403c6cfcb26069a4171a6967059b54b6a7e88008d98e4b` |

These are Node/fake-IDB and focused integration results. Native Chrome/Edge/Firefox process interruption, actual quota pressure, measured browser performance, server/backup recovery and complete UI integration retain their separate application/release gates. Later source changes require assessment against this recorded boundary. The earlier EcoLogits core review remains unchanged.

## AR05 domain ports and memory substitution phase, 15 September 2026

**Initial AR05 verdict: FINDINGS.** This is a new additive phase after the prior bounded ledger CLEAN snapshot. It covers explicit application/session/catalog/health ports, the IndexedDB adapters, guarded capture metadata, and the separate memory implementation. The parent owns broader application consumer migration and static caller-boundary acceptance. A subsequently requested atomic monthly-view claim is also being implemented and must be included at the final review boundary. Nothing here revises the prior core or controlled-comparison reviews.

Independent evidence is under `%TEMP%/aift-ar05-independent-20260915/`. The `domain-probes.mjs` script uses only domain methods for setup, capture, reads, erasure and session transitions on both backends. `probe-results.json` preserves the first substantive failures. Source copies and hashes are retained in `finding-source/` and `finding-source-hashes.json`. No production source was changed by the reviewer.

An initial test run crossed an acknowledged unfinished memory edit and failed with an undefined `legacyOriginal` helper in five shared cases and the memory Coordinator smoke. The helper was being added concurrently; this is recorded as a transient work-in-progress execution, not an additional final finding. The six IndexedDB domain cases, six session adapter cases and IndexedDB Coordinator smoke passed in that run. A final sealed-source run is still required.

### A1: Null current estimate changes never-admitted classification in memory (P2)

Location at the finding boundary: `src/memory-core.ts`, `resolveInput`.

Using each domain repository, capture a valid live family with the reserved `unavailable-admission-v1` marker and `currentEstimate: {attemptId, estimate: null}`. There is no original pin or completed estimate. Both current-estimate reads return absent, but IndexedDB reports `originalMethodState: 'not_admitted'` and memory reports `'unavailable'`.

The memory classifier uses `s.estimates.has(...)`, treating the explicit null placeholder as admission evidence. IndexedDB's original/envelope indexes contain no estimate for that placeholder. Substituting memory therefore prevents the supported local null-original recalculation path from being exercised faithfully. Null must not count as prior admission, while real earlier proposals/results must still block the reserved exception. The owner acknowledged the finding and is adding a shared regression.

### A2: Memory namespace erasure retains readable scoped session data (P2)

Location: `src/memory-repository.ts`, `eraseNamespace`, and the session monthly-claim representation.

Initialize an active company session and a separate saved Personal namespace, claim a company month, then call the public company `eraseNamespace`. IndexedDB removes the company credentials and monthly claim while retaining the unrelated Personal record. Memory still returns the erased namespace's credentials from `readCredentials()` and its monthly claim from `readMonthlyClaim()`.

Removing observation and calculation maps is insufficient for the shared namespace-erasure contract. The memory backend must also remove the same scoped session/bookkeeping records and retain unrelated records. This is an observed substitution and erasure gap in the new memory implementation, not a claim that the existing IndexedDB erase failed. The owner acknowledged it for focused correction.

### A3: Memory history compatibility reads apply an additional selected-view grant (P2)

Location: `src/memory-history.ts`, `historyPage`.

Import one valid company history response, then revoke the current company credentials without erasing the stored data. Calling `historyPage` for the same namespace returns one retained numeric row through the IndexedDB adapter and zero through memory. Both calculation selection vectors correctly report unavailable.

The IndexedDB compatibility history reader remains independent of selected-view/job grants; the new memory implementation adds `scopedRead` filtering. That silently changes an existing domain read when storage is substituted. Preserve the retained-history compatibility read and its erasure checks while continuing to deny revoked calculation/upload authority. The owner agreed this difference is unintended and is adding a backend-shared regression.

### Additional independent evidence during remediation

The domain-only alias probe passes on both backends after the owner's scan correction: two requests including one alias remain visible before deletion; deleting the canonical family removes both requests and both attempts. No direct storage access was used.

`calculation-probes.mjs` / `calculation-results.json` also pass on both backends for three independent sequences: same-method incremental calculation processes only the new source and preserves a selected survivor after erasure; cancelling a selected base invalidates an active dependent generation; ordinary token refresh preserves a running job, while revocation rejects its late result and invalidates the read token. These are substantive checks of the new memory behavior, but do not close A1-A3 or replace final testing of the complete additive snapshot.

### AR05 remediation recheck and A4, 15 September 2026

**A1-A3 are independently CLOSED. Verdict remains FINDINGS for A4 below.** The unchanged `domain-probes.mjs` now returns matching outcomes from both backends: null current remains never-admitted, namespace cleanup removes company credentials/monthly state and keeps unrelated Personal, and a revoked session retains one compatibility history row while selected calculation remains unavailable. Output: `probe-results-remediated.json`.

The reviewer ran the owner's sealed snapshot: **171/171 ledger tests PASS**, strict ledger typecheck PASS, and **8/8 actual consumer tests PASS** from `runtime-composition.test.ts` plus `application-repository-views.test.ts`. These execute real Coordinator capture/history/canonical/recalculation with injected executor/session and real summary/history/thread consumers against both backends. The memory-only test process confirms IndexedDB is absent. Outputs: `final-ledger-tests.txt` and `final-consumer-tests.txt`.

Prepared monthly-claim probes also pass in Personal and company modes on both backends: timezone mismatch, wrong company device/deletion epoch, changed selection, a queued preference change and erased scope reject without consuming a month. Concurrent valid claims produce exactly one `claimed` and one `already_claimed`. The claim checks routing, token and month in the same transaction and shares the legacy claim record. Output: `monthly-results.json`. This proves the repository operation, not all notification UI behavior.

The asynchronous memory commit probes for history and method catalogs pass. They suspend after staging, invalidate the external callback, then resume. The final guard rejects, both data and epoch remain unchanged, and queued readers do not observe the staged state. Outputs: `atomic-probes.mjs` / `atomic-results.json`. The independent incremental/cancellation/refresh/revocation checks also pass again in `calculation-results-final.json`.

#### A4: Memory returns an archived original whose canonical parent left the current chain (P2)

Location: `src/memory-estimation.ts`, `originalForLive`. Reviewed SHA256: `cf2c15ab51fa9b4b67fdf1faabc329dbac2d6f7a492a1ce197645a86eebe811d`.

This reproduction uses only legitimate domain operations, without storage mutation:

1. Capture requests A, B and C and an attempt belonging to A.
2. Reconcile A as an alias of B, resolve the current input, and calculate/store a genuine original with the admitted canonical binding A to B.
3. Confirm both backends return that original for the exact current attempt.
4. Reconcile A as an alias of C and read `originalForLive` again.

Both current inputs now resolve to C. IndexedDB returns null because the archived original's request B is outside the current request-alias chain. Memory still returns the original and archived request B. It verifies stored hashes but does not establish current-chain membership for that archived source.

Preserve the IndexedDB original-proof contract in the memory substitute, including current-chain checks and ordinary same-request revision compatibility. This is an independently observed gap in the new memory implementation, not a failure of the existing IndexedDB helper. The original/selected view helpers share this memory lookup, so it can also affect the inspection original returned alongside a selected view. The owner and parent were notified before a final CLEAN verdict.

Evidence: `alias-lineage-probe.mjs` / `alias-lineage-results.json`. The full sealed-source hashes before A4 remediation are retained in `final-source-hashes.json`; despite that provisional filename, A4 prevents acceptance of that boundary.

## Final AR05 and atomic monthly-claim closure, 15 September 2026

**Latest verdict: CLEAN for the recorded domain-port, memory-substitution and atomic monthly-claim snapshot. A1-A4 are independently CLOSED.** The owner confirmed source was stable before the final recheck. This approves the bounded package behavior and tested consumer substitutions described here; complete caller migration, browser performance and application release acceptance remain the parent's separate gates.

The unchanged A4 reproducer now returns matching results: both backends expose the original while B belongs to the current chain, then return null after the A-to-C shortcut removes B. The memory helper now constructs a scoped, bounded current chain, checks identity/hash/cycle/erasure conditions, requires the archived request to be a member, and checks range erasure across current and archived source requests. The added shared regression also verifies that an ordinary revision of B preserves its archived revision-1 original and that extending A-to-B into A-to-B-to-C still permits that original. Output: `alias-lineage-results-remediated.json`. Only `memory-estimation.ts` and the shared contract cases changed between the 171-test boundary and this final 173-test boundary.

The final design exposes explicit tracking, observation query, publication, derived-state, synchronization, history, thread, erasure, session, catalog and health capabilities. These ports do not accept store/index names or generic CRUD operations, and are not derived from `Pick<Ledger>`. `Ledger.application` caches an adapter over the existing shared IndexedDB transactions. The independent memory implementation uses one shared state with serialized staged mutations, defensive snapshots and final external-callback validation. Its lack of disk persistence is intentional; it does not simulate IndexedDB migration or native process recovery.

Capture metadata is detached at dispatch and checked against the transaction's staged source revisions/hashes before checkpoint/current-pointer publication. The optional guard leaves legacy callers' transaction path compatible. Source observations, original envelopes, checkpoint, input invalidation and outbox remain one atomic unit. Session transitions retain compare-and-set guards, and catalog digests preserve the existing sealed representation without making physical storage keys a consumer argument. The final monthly-view claim validates exact scope, local calculation token, routing, timezone and company device/era/deletion epoch, when applicable, in the same transaction that claims the month.

### Final executed evidence

- `pnpm --filter @footprint/ledger test`: **173/173 PASS**, zero failures/skips. This includes the earlier ledger regressions, ten shared domain cases on each backend, the absence-of-IndexedDB memory assertion, explicit null-pointer preservation and six session/catalog/health adapter cases. Output: `sealed-ledger-tests.txt`.
- `pnpm --filter @footprint/ledger typecheck`: PASS.
- From `apps/extension`, `node --import tsx --test test/runtime-composition.test.ts test/application-repository-views.test.ts test/company-repository.test.ts`: **16/16 PASS**, zero failures/skips, rerun after A4. Output: `sealed-consumer-tests.txt`. This covers actual Coordinator/executor/session substitution, original-aware summary/history/thread readers, enrollment/disconnect, failed enrollment rollback, refresh races, applied/erased/stale acknowledgements and sealed catalog admission/races.
- All four independently reproduced findings now have passing unchanged scenario rechecks. The domain probes use no direct store seeding or private memory-state access. Initial failures and source copies remain preserved.
- Independent Personal/company monthly-claim scenarios, incremental survivor/cancellation/revocation sequences and asynchronous final-guard rollback probes passed as recorded above. No network transport was needed for this review. These are contract/execution checks rather than real-server evidence.

### Final source boundary

Paths below are relative to `packages/ledger/`. Complete machine-readable hashes are retained in `sealed-source-hashes.json` under the AR05 evidence directory.

| File | SHA256 |
| --- | --- |
| `src/repository-contracts.ts` | `6117e4bb8dd6885b6d18e36a778ebb04ddf9e86ea6488873d9eddf5bc34b49cd` |
| `src/session-contracts.ts` | `401d4b5d9783b9ea61a04341bc0dd52bb954e42191e730bb3d539705c928a30e` |
| `src/indexeddb-repository.ts` | `2588a040d5d3863d0714bcbffd265efd1145583de0910d4642c26fd08156c12d` |
| `src/indexeddb-session.ts` | `c6c63dda06ed1c7ca0281b784d1574967b4d4b7b8328357592bed671f32870da` |
| `src/capture-validation.ts` | `bd86c7559d8364546a60c6516decc8630422bdb0898ca514a591a1ccae7a1ca7` |
| `src/memory-core.ts` | `e9e5d1cb279ae70b0a68004f5dd78dbfe78abbb90f7de889610eab4ab935e90d` |
| `src/memory-estimation.ts` | `49fae4e83d63a51d13793d9b6780cd7090bafdd39cc891f60e38a382f8023dcf` |
| `src/memory-history.ts` | `b99bdcea47f7b54169603f554a6567ac0163f06af6ab60abf23b1752603bc5b0` |
| `src/memory-session.ts` | `b275a8c0ab71b6bcb9c7d6c0c8b37f63129518fa3d36efa77d43274ac189009c` |
| `src/memory-repository.ts` | `7418baee4c964d440d5f753f447493ce9d76dc7ea6fb75a7b8e6681b1507defb` |
| `src/monthly-claim.ts` | `3ed7f8f9e0c81e0babad51187108e7aca8cfa908584014cecfa29db6db9c9e69` |
| `src/index.ts` | `8efddc2aecee8ce854cbbd9a632db7a885ee1738dedd1765e9af7a95343d7b79` |
| `test/repository-contract-cases.ts` | `ba3d336773ef05b460906b92676a1480cd27f343a9950b9c2f5b2f9c5f2eeedf` |
| `test/session-contracts.test.ts` | `2a9b7a5e1d579a27a86235c7a7b4fa9ad297dc1ac0325855a23fdd2e13639334` |

The reviewer changed only this report and temporary evidence files during AR05. Previous review snapshots and failures remain intact. Native browser migration/interruption/quota behavior, measured performance, server restore and full application/static consumer-boundary acceptance are not inferred from a memory backend or these tests.

## BE15 original-method proof and version-14 review, 15 September 2026

**Bounded verdict: CLEAN for the new original-method proof and additive version-14 ledger migration.** No new package findings were identified. This is a separate phase after the AR05/monthly snapshot. The EIR-08 application finding and its original failing build-transition evidence remain owned by `ESTIMATION-INTEGRATION-INDEPENDENT-REVIEW.md`; the package proof reviewed here supports that correction rather than replacing the application review.

The APIs now distinguish an authorized empty scope (`inputCount: 0`, null uniform hash), a populated scope whose every current input carries the same known immutable original-method pin, and a scope with mixed or missing pins (null uniform hash). Denied state reads omit the count, so they cannot be mistaken for an authorized empty scope. The local selection vector includes each member's proof in its token. The proof concerns admitted original-method metadata; it is not a new physical assessment or permission to change source ownership/upload eligibility.

### Independent proof checks

The reviewer inspected `original-method-proof.ts`, its state/vector callers, the memory counters and their admission/touch/erasure paths. IndexedDB obtains the existing scoped input count, reads one key from the original-method index, validates that hash and compares its exact bucket count with the full input count. Missing pins remain in the full count. The memory backend maintains the corresponding per-scope input count and hash buckets during its staged transactions. A revision preserves the original method pin; deleting or aliasing away an input removes its contribution to the proof.

`proof-transition-probes.mjs` performs the same 13 checks through public domain operations on both backends. All pass: empty scope, one Original pin, mixed Original/EcoLogits pins, an unknown input retained in the count, canonical alias removal, a later genuine original filling the missing bucket, failed source-bound admission rolling back both proof and token, revision preservation, separate retained/current era proofs, family erasure including an attempt alias, transition back to an empty old era, and count omission after revocation. Filling a missing pin changes the selection token; an aborted admission preserves it. The mixed-era vector retains distinct Original and EcoLogits proofs rather than silently collapsing them to one default.

Evidence directory: `%TEMP%/aift-original-proof-v14-independent-20260915/`. The script and `proof-transition-results.json` preserve the executed checks. No production source or accepted fixture was edited.

### Actual version-13 migration, abort and indexed-read evidence

In addition to executing the new frozen-schema fixture tests, the reviewer used the archived real version-13 ledger implementation retained from the earlier local-selection review. Its source still opens version 13 and does not call the current version-14 migration. The independent script creates a genuine EcoLogits original without active/selected jobs through that implementation, retains follow-build-default revision 1, and adds unrelated opaque records in all 25 stores. It snapshots the old rows and complete index definitions before upgrade.

The script aborts after creation of the new index, then reopens with the archived implementation. All old rows and index definitions are restored at version 13. Retrying with the current implementation succeeds at version 14. Across all 25 stores, existing row content is canonically unchanged, including original hashes, source records and the previous version-13 migration timestamp. The only new index is nonunique, non-multi-entry `estimation_inputs.originalMethod` with key path `['scopeKey', 'originalMethodHash']`; the only new migration row is `schema-14`. Reopening with the version-13 implementation afterward raises `VersionError`.

The same real-upgrade probe blocks `get`, `getAll` and `openCursor` on source/input/original payload stores and their indexes. Both `state()` and `localSelectionState()` still prove the saved EcoLogits pin. Together, the two calls use exactly **two original-method key cursors and two bucket counts**, with **zero blocked payload reads**. A subsequent unknown input clears the uniform proof and invalidates the old token. These are measured API-call properties, not a claim of constant-time database internals or a browser latency benchmark.

Evidence: `actual-v13-upgrade.mjs`, the unchanged archived source under `actual-v13/`, and `actual-v13-upgrade-results.json`. The checker's old implementation uses the current workspace dependencies while its ledger schema/migration source remains archived. These are fake-IDB transaction checks, not native process-kill or disk-full evidence.

### Final executed checks

- `pnpm --filter @footprint/ledger test`: **178/178 PASS**, zero failures/skips. This includes the frozen version-13 upgrade, abort/retry, downgrade and payload-read restrictions, plus both backend proof transitions and the previous ledger regressions. Output: `ledger-tests.txt` in the new evidence directory.
- `pnpm --filter @footprint/ledger typecheck`: PASS.
- From `apps/extension`, `node --import tsx --test test/build-default-transition.test.ts`: **18/18 PASS**, zero failures/skips. Output: `build-transition-tests.txt`. Both backends exercise EcoLogits-to-Original and reverse build-default changes, unchanged Original defaults, explicit preference precedence, mixed methods, retained eras and explicitly unadmitted observations.
- The independent actual-v13 migration and the two-backend proof-transition scripts pass as detailed above.

The reviewer inspected the consuming initial-Original predicate: it requires a valid whole selection vector, no active/selected jobs, follow-build-default revision 1, an Original target and either an authorized empty member or a matching uniform original-method hash for every member. Missing proof cannot activate the shortcut. Broader EngineService/UI acceptance remains in the application review.

### Source boundary

Paths below are relative to `packages/ledger/`; machine-readable values are in `source-hashes.json` in the new evidence directory.

| File | SHA256 |
| --- | --- |
| `src/original-method-proof.ts` | `947ab86bac163c9e12ea6109e891c92f1a415218b913f9fb1fc7179cecbc5013` |
| `src/database.ts` | `6e234eff835f8d790eccfc310f2d0ddc90f1e6dfb128aed848c7e209dd6d09e8` |
| `src/estimation-storage.ts` | `6f8b8a5edbea5418a28ae30e77f0fd2eb7c48e93026275e40b82e524e98c5134` |
| `src/estimation-contracts.ts` | `442453ae9e606485fdac635cd931372d60bdce9ee1f31ba3f496460069d57ca5` |
| `src/estimation-repository.ts` | `c8ddba6881656bebf20aa7f4408a642b0722a34ee1653d18102b3529d87241e7` |
| `src/local-selection.ts` | `12286b45d90db877e110b20676084f91476cefddb1e65514eaa1f827d5543592` |
| `src/memory-core.ts` | `0afda864940edf9d6020b881165421fd27d910af692fb5bd7a80feeefe32e921` |
| `src/memory-estimation.ts` | `3a402f3db6a1b0c03fc1028ecf18446286c1c420e4f652d6cbae73e715359d9e` |
| `test/repository-contract-cases.ts` | `116af8e30951ce34f632feddd9b81fcf5604809011ba3d0a2ccfddb34738ed99` |
| `test/original-proof-upgrade.test.ts` | `e9cd54ec21224ae017e47ce5f8e29f5dfc2735d49cd711c60fc6a4d488a5eb14` |
| `test/v13-fixture.ts` | `db8cbcbb9cf00de6f6ce22a5a59cd72b40055ef319e6dac53faa00601443f909` |

Only this report and temporary evidence files were written by this reviewer in the new phase. Earlier AR05, core, controlled-comparison and module-boundary review evidence remains unchanged. This closure does not replace native-browser migration/recovery, performance, server or release gates.
