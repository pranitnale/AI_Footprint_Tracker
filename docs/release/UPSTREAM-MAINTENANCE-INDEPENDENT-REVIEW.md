# Upstream maintenance independent review

Review date: 15 September 2026. **Final bounded verdict: CLEAN.** UM-01 through UM-09 and their focused follow-ups are closed on the final snapshot below. This reviewer independently ran 14 focused tests and the original failure probes; the implementation owner's separate 15-test full-workflow result is explicitly attributed. Earlier findings and the initial timeout remain recorded as historical evidence, not unresolved defects in the final snapshot.

## Scope and evidence limits

This review covers `tools/ecologits/` update, verification, adoption, archive handling, retained source, attribution and recovery, plus their package-oracle consumers. It applies the maintenance requirements RL09-RL18 and RL21. It does not repeat the separate core or controlled-comparison reviews, certify physical accuracy, approve upstream licenses, attest a Git commit, publish source, or adopt a release into the shared checkout.

The review used the review skill's main checklist, independent testing/maintainability/security passes, and an additional adversarial boundary pass. Only this report is authored by this reviewer. Implementation and test corrections belong to the maintenance owner. No network retrieval, denied-URL workaround, real checkout adoption, commit or push was performed. Generated probes used bounded temporary fixtures, which were removed after the probes.

The available developer-private archive was:

```text
.git/refinement-artifacts/vendor-source/ecologits-0.11.1-original/ecologits-0.11.1.tar.gz
SHA256 d24df5c0202bd5925376143f5b78d7273cb015d17323e660723e07e6fad223c0
```

This establishes the local archive bytes used in the rehearsal, not their relationship to a named Git commit. The local-artifact workflow accepts requested commit IDs from its caller. No live GitHub/PyPI provenance verification was attempted.

## Initial findings

Line references below identify the initially reviewed implementation. The owner is changing these files concurrently; corrected line numbers and hashes must be recorded with the recheck.

### UM-01 [P1] A refused rollback can leave an unrecoverable mixed state

Confidence: 10/10. Initial `adopt.mjs:154-198` validates and restores each entry in one reverse loop. It sets `journal.phase = "rolled_back"` only after the loop. Explicit rollback requires each current file to equal its candidate, while recovery excludes journals still marked `committed`.

An actual CLI probe constructed a committed temporary journal with entries `[a, b]`. Their original bytes were `old-a` and `old-b`, and candidate bytes were `new-a` and `new-b`. Current `a` contained an unrelated edit; `b` matched its candidate. `--rollback latest` restored `b` to `old-b`, then exited 1 with `Rollback refuses a file changed outside the transaction: a.txt`. The journal remained `committed`. An independent exact-function probe also confirmed that retrying rejects the already-restored `b`, and recovery ignores the journal.

Preflight every target and backup before any restoration. Persist rollback phase and progress so interruption during restoration remains recoverable. Test dirty targets, corrupt backups and interruption during rollback, not only interruption during forward adoption.

### UM-02 [P2] Latest rollback is ordered by hash and random ID

Confidence: 10/10. Initial `adopt.mjs:127` uses `(await readdir(transactionRoot)).sort()`, and line 225 selects `committed.at(-1)`. Line 362 builds transaction IDs from a report hash and random UUID, neither of which records adoption order.

An actual CLI probe created `tx-zzzz-old` first and `tx-aaaa-new` second, with separate matching candidate files. `--rollback latest` exited 0 and restored the older transaction's file. The newer transaction remained adopted. With overlapping files, this also exposes UM-01's partial-rollback path.

Record transaction chronology under the lock and select the latest committed transaction using that record. Verify two consecutive adoptions whose IDs sort in reverse chronological order.

### UM-03 [P2] A qualified adoption cannot be used as the next baseline

Confidence: 10/10. Initial `update.mjs:102-110` reconstructs the accepted directory as `ecologits-${acceptedIdentity.upstream_version}`. A qualified adoption instead records `ecologits-<version>-qualified-<label>` in the identity and retained manifest. `lib/retention.mjs:17-18` rejects a directory basename that differs from the manifest.

The initial path calculation combined with the actual retention validator produces `Retained snapshot directory does not match its manifest`. The original workflow tested package commands after qualified adoption but did not stage the next update.

Use the validated adopted snapshot directory, checking agreement between the identity, lock and retained manifest. Add a second stage/verify operation after qualified adoption in a temporary repository.

### UM-04 [P1] Qualified Python/package mismatch rejection is unreachable

Confidence: 10/10. Initial `verify-update.mjs:409-434` nests the `release_kind === "qualified_combination"` check inside an outer `release_kind === "release_candidate"` condition. Its `qualified-core-package-mismatch` blocker cannot execute.

An independent exact-condition probe supplied one differing `.py` record: a release candidate produced a blocker, but a qualified candidate produced none. A harmless comment appended to a retained Python file is a minimal fixture: its AST and numerical outputs remain unchanged, so those checks do not close the missing byte-identity guard. Candidate verification imports staged Python, but `packages/ecologits-core/oracle/source_integrity.py:92-97` subsequently compares retained Python against the installed locked package and rejects `Installed oracle mismatch`. Verification can therefore approve a candidate that fails ordinary post-adoption package checks.

Make the qualified comparison a sibling guard. Only the explicitly declared catalog JSON overlay files may differ from the exact package environment. Verify the comment-only mismatch as a negative case.

### UM-05 [P2] Approved citation changes still produce the old notice

Confidence: 10/10. Initial `lib/semantic.mjs:508-531` reads the candidate license and citation, but uses their contents only for hashes. The notice unconditionally emits the MPL-2.0 statement and the fixed 2025 JOSS citation.

An actual `attribution()` probe used synthetic changed license/citation inputs and the citation title `Candidate Citation 2026`. The generated notice retained the old citation and did not contain the new title. Hash-bound human approval in verification does not change this generator behavior. This fails RL21's requirement to regenerate attribution from the accepted metadata.

Generate the visible statements from validated candidate metadata, or require reviewed replacement notice text bound to the changed files. A changed license must not silently retain a contradictory license statement. This is a code/metadata finding, not a legal interpretation of candidate terms.

### UM-06 [P1] Recovery follows an unchecked transaction-directory junction

Confidence: 10/10 for the transaction directory; 9/10 for the related removal path. Initial `adopt.mjs` validates the state directory in `acquireLock`, but `readTransactions` follows `transactionRoot` with `readdir`, and adoption follows it with `mkdir` and backup/pending/journal writes. The transaction root itself is not checked for links.

An actual Windows CLI probe placed a junction at a temporary target's `.ecologits-maintenance/transactions`, pointing to a separate sibling temporary directory. The sibling contained an interrupted journal with no entries. `--recover` exited 0, reported one recovered transaction, and changed the journal outside the selected target to `rolled_back`. Both directories were dedicated fixtures and were cleaned afterward.

The original-null rollback branch also calls `rm(target)` without the ancestor check used by `replaceFrom`; its leaf-only file check does not reject a linked parent. Reject linked transaction roots and validate every rollback target's ancestry before inspection or removal. Regression tests must prove outside-fixture sentinel files and journals remain untouched.

### UM-07 [P1] Adoption preconditions are checked before acquiring the lock

Confidence: 10/10. Initial `adopt.mjs:354` checks `currentMatches(target, entry.precondition)` before `await acquireLock(false)` at line 358. Preparation then recaptures `original` at line 371 without comparing it with that expected precondition.

A can finish a different adoption after B's preflight but before B acquires the released lock. B then overwrites A using a candidate verified against the earlier baseline. An independent in-memory probe of the actual adoption body committed with `capturedOriginal: "concurrent-adoption"` despite the stale precondition.

Acquire the target lock before checking snapshot, port, overlay and target preconditions. Validate copied backups against expected original bytes before applying the transaction.

### UM-08 [P1] Prepared candidate bytes are not checked against the seal

Confidence: 10/10. Initial `adopt.mjs:262` checks staged hashes once. Later line 372 computes a fresh candidate record from the current source and line 382 copies that source into pending storage. Neither the new record nor the copied bytes is compared with the loaded seal.

A source change or concurrent reverification after the seal check can install different bytes. An independent in-memory probe of the actual adoption body reached `phase: "committed"` with `installed: "unverified-candidate"`.

Hash each prepared transaction copy and compare it with the originally loaded sealed hash before changing any target. Validate the actual bytes copied, not only the source before copying.

### UM-09 [P2] Generated copy overstates local-archive Git provenance

Confidence: 9/10. Initial `verify-update.mjs:916` generates `source from core commit ... and catalog commit ...`. `lib/semantic.mjs:520-521` emits `Core source commit` and `Catalog source commit`. Local archive mode establishes only supplied bytes and requested commit IDs; its README correctly discloses that limitation, but these recipient-facing generated files omit it.

Use requested-commit wording and carry artifact origin and attestation limits into generated notices and distribution text. A local or PyPI archive hash must not become Git commit attestation through generated copy.

## Executed checks and current limitations

`pnpm test:ecologits-maintenance` was started once with the private archive available. Its final result was **exit 1: 3 tests, 2 passed, 0 failed, 1 cancelled, 0 skipped**, after 910,123 ms. Both archive-security tests passed. The full workflow reported successful `catalog:check`, `typecheck` and `test` commands after compatible synthetic-model adoption in a temporary repository, then hit its 600,000 ms test timeout. It finished unwinding without forced termination. This is not a passing full-suite result. The owner began corrections while that long run was active, so later subcommands do not establish one immutable corrected-source snapshot.

The private prerequisite is explicit: when the pinned developer archive is absent, the original workflow test is skipped and only the archive-security tests run. Missing `uv` or cached dependencies is not configured as another skip. This run did not skip for the archive prerequisite.

Source inspection confirms bounded archive expansion, regular-file/link checks, immutable requested identifiers, separate catalog conversion, candidate Python versus TypeScript comparison, separate accepted-to-candidate deltas, source-map gates, overlay conflict reporting, hash-bound human-review decisions, retained-source inventories and staged seals. These mechanisms do not waive the failures above.

`uv --frozen --offline` and the adapters' ordinary Python socket restrictions were inspected. The report fields `network_used: false` and `provider_credentials_available_to_children: false` are declared constants, not measured isolation evidence. This review does not claim an operating-system sandbox, denial of all possible network routes, removal of credential files, or safe execution of arbitrary hostile Python.

Initial rollback/probe source SHA256:

```text
tools/ecologits/adopt.mjs
2388bb9abb0d298234f7061e49b7e304ff6896f5331d186f9d5d40333d10374f
tools/ecologits/lib/semantic.mjs
9ffe8d50a368f8b0458657b17a2026244d0019789b6fb593b9bffc2959b6760d
tools/ecologits/test/workflow.test.mjs
25aab292c1c978c47b3bdb43d35d779a4578460119cdd7d232eb0b7faff1d54a
```

## Initial correction gate

The maintenance owner has the findings. Closure requires independent rechecks of the original failure sequences, including recovery interruption and consecutive adoption, plus a completed relevant suite on a recorded corrected snapshot. A source edit or owner-reported pass alone does not close a finding. No maintenance CLEAN verdict or release-readiness claim is made here.

### First correction recheck

Independently ran `node --test tools/ecologits/test/archive-security.test.mjs tools/ecologits/test/recovery.test.mjs`: **13 passed, 0 failed, 0 cancelled, 0 skipped**, 20,641 ms. These tests exercise rollback preflight, recorded ordering, interrupted rollback, failed compensation and recovery, linked transaction/target parents, explicit legacy transaction selection, current attribution, and filesystem hooks for post-lock target edits and copied-byte tampering. Source inspection also confirms the corrected qualified snapshot lookup and the independent qualified package mismatch guard; their new workflow tests stage a subsequent candidate and require rejection of comment-only Python differences.

One remaining UM-07 gap was reproduced on `lib/transactions.mjs` SHA256 `7d3c02def55535928764f24bfa639941539a1205a4eacb7d0228d061d53615b5`. The caller checks the destination before `replaceFrom`, but that helper does not recheck it after preparing the replacement. An actual helper probe changed the destination to `concurrent-user-edit` immediately after copying the replacement temporary file. The helper returned successfully and the destination became `verified-candidate`, losing the edit. The owner received this reproduction and is adding the destination recheck to both adoption and rollback. The first correction snapshot is therefore not CLEAN.

On helper SHA256 `83f0f8b95d823d524d68fe88fe6165ac02b6f02cc68a1b6e99cb86768117ed23`, the same probe now rejects `Replacement target changed during preparation` and preserves `concurrent-user-edit`. The 13 focused tests were independently rerun and all passed in 15,140 ms. The parsed report/plan buffer is also the buffer checked against the loaded seal. Two final edges remain under correction: the reviewer demonstrated that empty citation bytes bypassed the new truthiness-guarded attribution hash check, and the owner identified that rollback left transaction-created empty snapshot directories which prevented reusing that stage. These follow-ups remain within UM-05 and UM-01 respectively, not a passing final snapshot.

Durable review lesson: a sealed staging report is not sufficient unless copied transaction bytes are bound to that seal under the adoption lock, and rollback itself needs a recoverable transaction protocol.

## Final correction recheck

**Bounded verdict: CLEAN.** No remaining reproduced blocker was found in the reviewed maintenance/update/adoption scope. The reviewer changed no implementation or test source. The independent security and testing follow-up passes also reported no remaining findings in their inspected correction boundaries.

| Finding | Final correction and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UM-01   | Rollback preflights every target and backup/pending payload, records `rolling_back` and `restoring_rollback`, and supports recovery after failed compensation. Independently executed dirty/corrupt-payload, interruption, compensation and repeated-recovery tests pass. Transaction-created empty directories are journaled and removed with checked, non-recursive `rmdir`; same-stage reuse after rollback passes and pre-existing directories are preserved. |
| UM-02   | Committed journals record a validated monotonic sequence under the lock. The reverse-lexical-ID regression passes. Legacy journals without ordering require an explicit transaction ID, which is tested.                                                                                                                                                                                                                                                          |
| UM-03   | Update selects the accepted snapshot from its recorded lock and checks identity/retention agreement. The actual subsequent-stage/verify regression against a qualified-adopted fixture was independently inspected and passed in the owner's full run.                                                                                                                                                                                                            |
| UM-04   | The qualified package comparison is independent of the single-commit branch and permits only the three declared catalog JSON overlays. The harmless Python-comment mismatch fixture reaches the exact blocker. Its execution passed in the owner's full run.                                                                                                                                                                                                      |
| UM-05   | Notices reproduce the current CFF and refer to the reproduced license and candidate declaration, instead of substituting fixed text. Empty and missing bytes are checked against the lock. Independently executed attribution tests and the original empty-CFF probe reject mismatches.                                                                                                                                                                           |
| UM-06   | State/transaction and target ancestry are checked, including original-null rollback removal. The independently executed transaction-junction and linked-target-parent regressions pass without changing outside fixture bytes.                                                                                                                                                                                                                                    |
| UM-07   | Target preconditions are checked after lock acquisition, after preparation and before application. Replacement rechecks destination bytes and ancestry after copying and syncing the replacement. The actual destination-edit probe now rejects replacement and preserves the concurrent edit.                                                                                                                                                                    |
| UM-08   | Backup, pending and replacement copies are validated against the approved records. Report and plan parsing uses the same buffer whose digest is checked against the seal. Independently executed filesystem-hook tests reject pending-copy, replacement-copy and parsed-plan tampering.                                                                                                                                                                           |
| UM-09   | Generated notice and source-distribution text call commit IDs requested and not independently attested, including local-archive mode. This wording was inspected; the attribution test asserts the qualification.                                                                                                                                                                                                                                                 |

### Final test results and attribution

This reviewer independently executed:

```text
node --test tools/ecologits/test/archive-security.test.mjs tools/ecologits/test/recovery.test.mjs
Exit 0. Tests 14, passed 14, failed 0, cancelled 0, skipped 0.
Duration 16,075 ms.
```

The actual replacement-target-edit and empty-CFF mismatch probes were independently repeated against their corrected functions. Both rejected the unsafe operation; the concurrent target edit was preserved. All ad hoc probe directories were cleaned.

The implementation owner separately executed and reported the final unchanged-snapshot run:

```text
pnpm test:ecologits-maintenance
Exit 0. Tests 15, passed 15, failed 0, cancelled 0, skipped 0.
Duration 130,883 ms. Full workflow 130,764 ms.
```

That full run includes qualified post-adoption `catalog:check`, `typecheck` and package `test`, subsequent qualified staging/verification, Python-comment/package mismatch rejection, schema/formula/overlay/compliance cases, and recovery. The full-workflow test and its helpers were read independently. Its final execution result is owner-attributed, not presented as a second independent full run. These totals overlap and must not be added. The initial 600-second timeout is not erased or relabeled as a pass. The fixture helper now excludes installed environments and dependency trees before traversing them; its improved runtime does not establish a production performance result.

The final public recovery/archive tests do not need the private archive. The full workflow still has an explicit private-archive skip when that artifact is absent; final execution here had the artifact and no skips.

### Final source snapshot

SHA256 over file bytes. Paths are relative to the repository. These hashes approve the bounded maintenance correction, not unrelated source in this shared branch.

| File                                                                     | SHA256                                                             |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `tools/ecologits/update.mjs`                                             | `558a2726ca0c5ac6aab4b0f37e75e2943189143d9b9baa7f5da9c3c119cf53cb` |
| `tools/ecologits/verify-update.mjs`                                      | `22554a70ae7d7a242acd8b3caf7fce013737ac58fbd2761ea1c177776bff104f` |
| `tools/ecologits/adopt.mjs`                                              | `4c9c9d9418d2390e1d103ceb9fd3ed7245bbadc0df90d1b9459eacd9ecd6bb8d` |
| `tools/ecologits/lib/transactions.mjs`                                   | `f13808b0395de0d5a3adfcce237fa0a93e639560e7824225ee320580fea61feb` |
| `tools/ecologits/lib/common.mjs`                                         | `6a55b25f3371281fbce44544cc703e2b8801cb01d8bb7e307920fe8d9e326c9d` |
| `tools/ecologits/lib/semantic.mjs`                                       | `ad64f41ad1f3e7dd004d082347584756533f4a28ea6580ec8e1ee72d99ea82b0` |
| `tools/ecologits/lib/retention.mjs`                                      | `11157ad2cc9ec4db9434530589cc2a0cd71daaf0217f08a04c47765472c5e100` |
| `tools/ecologits/python/candidate_catalog.py`                            | `d66ef488ce15535d86c5dfe982ed12fd69d6915975336e40705e7ab936c12aa8` |
| `tools/ecologits/python/inspect_candidate.py`                            | `36fc9cac743c5f6130f51540c363d04e5577dd34a478c0ba1a500dd43a7261e2` |
| `tools/ecologits/python/validate_environment.py`                         | `2624c0d75bf87375d7eed74518371f6130852d123bfa5d3f725ec5ba39bfa073` |
| `tools/ecologits/python/run_candidate.py`                                | `6bf88066e2796181556ce1fbca195165a2e86d78b19c1fa940520fc5af68ab2d` |
| `tools/ecologits/ts-candidate-runner.mts`                                | `2ea20dc388c327e4798d2491a9e1d05e37e4c7dcd889e03cd1af60411818af4f` |
| `tools/ecologits/test/recovery.test.mjs`                                 | `80d6ed62bc1fbfe8a99fe2d2496be4d2c1f94249c0102bfe03ebecd9c4b5a289` |
| `tools/ecologits/test/workflow.test.mjs`                                 | `ec3a922398194218bd295d3245fe3fd5ca6be636411a5e39935b27e5149bda2c` |
| `tools/ecologits/test/archive-security.test.mjs`                         | `a0dcb046b1064c54d40c2532f08dd4d292153eae8406b77d7e19364df4c1aed7` |
| `tools/ecologits/test/helpers.mjs`                                       | `86b94ca409d7602af3bb6bd778264385d7a51c29c48f0a9a55be1357b348658b` |
| `tools/ecologits/README.md`                                              | `31e3f939ad3a6f0ab857377ad33e61609e2079163ba9d94c03fbe449e91da700` |
| Inspected consumer: `packages/ecologits-core/oracle/source_integrity.py` | `b32bca1df1eaa41ca8c3eecc88316a3deb954cf0f6ce34b6532357ac9d07cb52` |

### Remaining external and product gates

This review does not attest Git origin, approve future upstream licenses or dataset rights, measure a hostile-code sandbox, certify power-loss behavior, or verify native browser packaging, public source availability or production performance. Recovery is a journaled multi-file operation with per-file atomic replacement, not an atomic filesystem snapshot. Do not build or edit the component while recovery is pending.

RL16 evidence here covers maintenance reporting of newly available direct profiles and preservation of overlays, not installed-user recalculation behavior. RL18 evidence covers locked local artifacts and absence of a new runtime fetch mechanism, not distribution of a real packaged update. No release was adopted into the shared checkout. All original-engine, installed-user, backend and public-distribution boundaries remain with their separate acceptance evidence.

**Final bounded conclusion: CLEAN.** UM-01 through UM-09 have no remaining reproduced blocker on the recorded correction snapshot. Later source changes require a focused recheck.
