# Estimation integration independent review

Review date: 15 September 2026. **Final bounded verdict: CLEAN.** EIR-01 through EIR-08 were independently reproduced, corrected by their owners, and rechecked at the recorded snapshots. The final EIR-08 check verifies the requested BE15 no-job rollback state and retained-era integration. The composition and monthly/counting evidence remains bounded as documented. Ledger v14 migration/index certification, concurrent AR05 work, this reviewer's previously authored UI, and external release gates remain outside this verdict.

## Scope and independence

Reviewed parent-authored estimator adapters under `packages/estimator/src/engines/`, excluding `remote-admission.ts`; engine selection, method registry and configuration; `apps/extension/lib/estimation/service.ts`; and relevant Coordinator, CompanyClient, MethodService and RecordedThreads integration. The parent subsequently added `runtime-composition.ts`, the local selection vector, missing-original lineage, and the production history selection/publication boundary to this scoped review. Shared contract, summary, ledger and server code was read where needed to establish the actual boundary behavior. This is not a separate sign-off on those other owners' complete implementations.

Excluded from the independent verdict: the raw EcoLogits core and its upstream parity, the separately authored remote admission helper, backend/ledger/packaging release acceptance, native browsers, performance, and the UI modules previously implemented by this reviewer. No UI tests are used as independent evidence here. No source fixes, commits, pushes or deployment changes were made. Only this report was written.

Governing documents: `IMPLEMENTATION-PLAN.md`, `docs/implementation/MODULAR-EXTENSION-ECOLOGITS-PLAN.md`, its acceptance matrix, upstream-maintenance specification, and writing standards. In particular, plan sections 4.3, 5.1, 9.1 and 11 require numeric evidence preservation, pinned identities, complete-view promotion, scope/selection guards, and consistent local/canonical presentation.

## Findings

### EIR-01 [P1] A corrupt preference cannot be repaired and prevents new numeric capture

**Status: main recovery/capture failure and local EIR-01-L integration verified corrected.** The initial failure and correction evidence are retained below.

**Locations:** `apps/extension/lib/estimation/service.ts`, `selected`, `admission`, `status` and `select`; Coordinator's first-dispatch `engines.admission()`; dependency `packages/ledger/src/estimation-repository.ts`, `preference` and `compareAndSetPreference`.

Fault-injecting an installation preference with `preference: "removed_engine"`, valid revision 7 and otherwise valid metadata causes all of these real EngineService operations to reject with `ZodError`: status, admission, selected/default view, resume, reset to build default with expected revision 7, and reset with expected revision null. The repository parses the existing corrupt value before either reading status or performing CAS, so even an explicit known-revision reset cannot recover.

A second probe used the real Coordinator. A valid synthetic dispatch after the corruption rejected with `ZodError` and left **zero request/attempt rows**. The default dashboard also rejected. **Explicit `dashboard({calculationView: "original"})` was readable**; this finding does not claim that explicit original inspection or the stored original bytes were destroyed.

This fails BE10 and the unavailable/failed-boundary requirements of AR08, PR16 and the plan's instruction to preserve numeric observations when environmental estimation is unavailable. It does not silently switch engines, which is correct, but it has no supported repair and suppresses unrelated numeric recording.

Required correction: expose a typed invalid-preference state without inventing a saved choice; provide explicit, guarded repair that cannot overwrite a concurrent valid choice; preserve new live numeric observations with explicitly unavailable admission; leave existing original evidence readable. A repaired preference must not retrospectively claim that an original formula ran.

**Correction recheck:** fresh real-service probes now return an invalid EngineStatus with `preference`, `effectiveEngine` and `method` all null and reason `invalid_preference`; default view is explicitly original/pending; resume preserves the visible invalid state. Direct admission correctly refuses to select a formula. Explicit repair of invalid revision 7 to build default returns revision 8 with unchanged measurements and original-envelope bytes. Injecting a competing valid EcoLogits repair at the repository repair boundary makes the stale Original repair return `selection_conflict`, preserving the winning valid choice.

A fresh real-Coordinator dispatch and completed synthetic response now persist two request/attempt rows, input/output tokens (22/23 in the test double), and `unavailable-admission-v1`. No original envelope is fabricated. The default dashboard reports one request, unknown electricity, original view and pending true. Network calls remain zero. A separate executor probe confirms old null-proposed observations retain Original compatibility behavior while the reserved unavailable marker rejects `method_unsupported` without falling through to Original. These probes verify the main EIR-01 correction without independently signing off this reviewer's UI modules.

**EIR-01-L correction recheck:** separate real-Coordinator probes captured dispatch/end under corrupt revision 7, repaired explicitly to Original or EcoLogits, and completed local maintenance. Both targets produced an estimated, recalculated Envelope2 with the requested engine, `original_method_hash: null`, and `original_method_missing`. Selected rows were available; numerical measurement bytes remained unchanged, `estimation_originals` remained empty, and Personal network calls were zero. Original-target recalculation does not invent an original result.

Seven invalid lineage combinations were independently rejected: null, known and arbitrary unknown proposed methods claiming missing lineage, plus the reserved marker with original view, a known original hash, a false flag, or no flag. A hostile local executor then changed a known-original recalculation to null lineage and added the missing reason. The context-free envelope schema accepted that shape, but the real service and typed repository rejected it: failed status, zero committed results, unchanged known original. The schema alone cannot establish archived-source truth.

The local integration criterion is verified. The separately authored backend review also reports its missing-lineage/0010 follow-up CLEAN; its exact evidence and unverified PostgreSQL gate are attributed in the section below. This is not an independent approval of the full ledger/backend implementation by this reviewer.

### EIR-02 [P1] Summary callbacks omit genuine canonical request bindings

**Status: verified corrected after owner changes.** The initial failure and correction evidence are retained below.

**Locations:** Coordinator `scanUsageOnce` and default dashboard callback, and the explicit EcoLogits callback in `methodSelection`; EngineService `view().estimate`; dependency `summary-scan.ts` and ledger `liveInput`.

The parent callback passes only `{family: "live", request, attempt}` to `view.estimate`. A reconciled attempt may still contain its original request ID while the selected result is bound to a different canonical request and a verified alias relation. `view.estimate` prepares the supplied source instead of resolving the current ledger-scoped canonical input.

Reproducer: seed two real request/attempt/original-envelope pairs; make request A an alias of request B with the ledger API; select EcoLogits and complete its job. The ledger reports a complete job. `ledger.estimation.liveInput` supplies the genuine alias binding, and `view.estimate` with that binding returns an estimated result. The exact callback used by the parent summary returns **2 attempts, 1 known electricity estimate and 1 unknown**, although both selected recalculations exist. The problem is omitted evidence at the caller, not a failure to calculate the aliased record.

This fails ST12, PR13 and AR02/AR10 at the presentation integration boundary. It produces incomplete selected totals after valid canonical reconciliation. Do not fix it by manufacturing the relation hash from arbitrary request IDs. Resolve and validate the current canonical request, attempt, scope and alias proof through the repository, and preserve the source/publication guard until the summary is returned.

**Correction recheck:** the same real-Ledger alias setup now reports a complete job, an estimated bound result, and **2 attempts / 2 known / 0 unknown** in both the global and conversation scans. The owner updated canonical parent traversal and resolved the binding through scoped `liveInput`; explicit EcoLogits method selection was also routed through trusted input. This closes the reproduced EIR-02 path, not the separate original-inspection issue EIR-05.

### EIR-03 [P1] A selection can change after a scan guard and before route publication

**Status: verified corrected after final publication guards.** The original failure and final independent checks are retained below.

**Locations:** Coordinator `routeSummary`, `scanUsageOnce`, and the final publication checks in `publishCapture`; related audit targets are the initial-original dashboard branch and `selectedServerSummary`. At initial review, Ledger `publicationSnapshot` guarded routing, records and erasure but omitted engine selection/publication state.

An executed real-Coordinator probe completed EcoLogits at selection revision 2, called `routeSummary("claude", validUuid)`, and changed the preference to Original at revision 3 using the real CAS API during the awaited `history.view` call. There was no scope change and no record mutation.

The route returned the previous EcoLogits recalculated summary with **`calculation.pending: false`**, while fresh EngineStatus reported **Original, revision 3, idle**. Network calls were zero. `scanUsageOnce` checked `view.current()` before returning, but `routeSummary` performed more asynchronous work and then checked only routing/data/erasure state.

This fails PR17, PR19, BE08 and RE09's final-publication requirement. Showing a clearly pending last completed view is allowed. Publishing the superseded view as the current completed selection is not. Carry the captured selection/publication guard through the whole route and check it at the actual response/send boundary. If live, historical, pending and server parts use different guards, retry the whole snapshot rather than combine them.

At initial review, only the `routeSummary` race above was executed. The final correction carries the captured calculation guard into the last atomic publication snapshot after asynchronous scope/history/queue reads. Default dashboard cache rows also carry the calculation token.

**Correction recheck:** six independent delayed-await cases passed against the final wiring:

| Boundary | Independent result |
| --- | --- |
| Exact original `routeSummary` reproducer: EcoLogits revision 2 to Original revision 3 CAS after the real history read | Retried to original/pending true, one request, zero Personal network calls |
| Capture queue count after the calculation scan, same CAS direction | Fresh original/pending true with both requests, zero Personal network calls |
| Initial Original dashboard: switch to completed EcoLogits after history read | Retried to the current EcoLogits hash, recalculated/pending false, one request |
| Cached Original dashboard, same delayed switch | Returned the current completed EcoLogits calculation, one request |
| Default `selectedServerSummary`: CAS after its real history read | A valid baseline server summary was accepted; the late superseded publication rejected with a selection/aggregate guard error |
| RecordedThreads: CAS inside final `currentScope`, after `calculation.current()` | A matching selected baseline server result was accepted; the late superseded publication rejected |

The final two cases used actual Ledger policy/vector guards and synthetic CompanySession replies, with organization maintenance isolated to target the read boundary. They do not claim a live server or native browser run. The raw-CAS Original cases intentionally leave maintenance pending, so the explicit pending fallback is the correct result.

### EIR-04 [P2] Recorded Perplexity routes request and prefer original server results after a selected-engine change

**Status: verified corrected after owner changes.** The initial failure and correction evidence are retained below.

**Locations:** `apps/extension/lib/recorded-threads.ts`, `view`; CompanyClient `threadRequest` path allowlist. Supporting server contract: `aift/thread_relations.py::summary` and `method_history.py::prepare_view`.

RecordedThreads obtains the selected local summary, but its server request remains:

```text
/v1/me/recorded-threads/<threadKey>/summary?period=all
```

The CompanyClient allowlist also permits only that unqualified URL for this endpoint. The server supports calculation parameters, but absent `calculation_view` defaults to original.

An executed RecordedThreads boundary probe supplied a local selected EcoLogits summary and a schema-valid original server response. The method returned `conversation.source: "server"`, `server.calculation_view: "original"`, and `offline: false`, alongside the local recalculated identity. It never requested or checked the selected engine's server method.

This fails PR12/PR15/PR18 and consistent selected-view behavior across entrypoints. Pass a pinned selected method/view to the thread request, validate returned calculation identity, and retain the same selection guard across the request. Pending or incompatible server work must remain explicit. This probe uses a CompanyClient double to inspect the boundary; it is not claimed as a native browser or real PostgreSQL test.

**Correction recheck:** supplied the actual `EngineService.view` as the new sixth RecordedThreads hook after completing an EcoLogits selection in a real Ledger. Both requests carried `calculation_view=recalculated` and the exact selected method ID. An original server response was discarded (`server: null`, `source: local`), while a matching recalculated ID/hash was accepted (`source: server`). The production Coordinator supplies the same hook. This closes the reproduced EIR-04 mismatch path.

### EIR-05 [P2] Original inspection hides valid Envelope2 originals after request-only changes

**Status: verified corrected using archived-source proof.** The original failure is retained below.

**Locations:** `apps/extension/lib/summary-scan.ts` and `estimate-presentation.ts::estimateMatchesSource`, used by Coordinator original-view queries.

The parent requested a distinct test of retained originals after the selected-view alias correction. Each case starts with a genuine EcoLogits **original** Envelope2 stored in both `estimation_originals` and the `current` compatibility row, matching the Coordinator commit shape. The original summary initially reports **one known electricity estimate**.

- Update only the request to revision 2, adding the search feature while leaving the attempt unchanged: the Original summary reports **zero known, one unknown**.
- Instead, keep the attempt unchanged, store a new canonical request and alias the old request to it: the Original summary also reports **zero known, one unknown**.

In both cases, original-envelope bytes remain unchanged, the current compatibility row still contains Envelope2, and the original request revision remains in `measurements` with a payload hash exactly equal to `envelope.source.request_hash`. The original has a provable archived dependency; it is not a missing or tampered result.

This fails retained-original inspection in LG08 and PR15. The current matcher applies the latest parent hash/ID to both selected recalculations and archived originals. The fix must distinguish the two: selected results remain bound to current canonical dependencies; an original view may use its recorded dependency only after verifying the archived observation hash, identity, scope and erasure state. Do not merely remove request-hash validation or fall back to an arbitrary original row.

The first attempt to construct this probe used only `db.capture`, which did not populate the compatibility row consumed by `scanSummary`; its initial known count was already zero. That attempt was discarded as an invalid reproduction of the production path. The reported results above use the actual two-store commit shape and establish the one-known baseline before mutation.

**Correction recheck:** repeated both cases with real Coordinator-created Personal policy/ownership and the two-store commit shape. Global and conversation Original scans now each report one known, zero unknown and the exact saved Envelope2. Original archive bytes remain unchanged. Supplying the previous recalculated envelope after either mutation yields zero known, one unknown. Deliberately removing the original archive while retaining the compatibility row also yields zero known, one unknown. The correction preserves archived originals without admitting stale selected results or an unproved pointer. Personal network calls were zero. Owner regressions additionally cover current canonical filtering, superseded attempts, missing archived input, prior-era revocation, changing grants, and saved Personal fallback authority.

## Executed source-derived checks

All reproducers ran from the repository root using PowerShell here-string input to `node --import tsx --input-type=module`. Synthetic data and temporary `fake-indexeddb` databases were used. No authenticated provider traffic, user conversations or real company credentials were accessed.

| Check | Executed result | Interpretation |
| --- | --- | --- |
| Frozen original corpus through the new executor wrapper | 17 live, 8 history and 4 image results matched canonical expected bytes; no mismatches | Original numerical/serialized behavior preserved for the frozen corpus, including raw child output |
| Baseline method identity | `7684a7960e2b21ae5082a23c50052563447bbe588d32ea052b79373525783bc9` | Matches the declared frozen original baseline |
| Independent EcoLogits counter boundary probe | 0 unavailable; 1 and 2^53-1 estimated; 2^53 and signed-64 maximum unavailable with `numeric_domain_unsupported` | No unsafe integer rounding into the binary64 core in these cases |
| Source identity mutation | Incrementing only the request revision changed `input_hash` | Request evidence, not only attempt tokens, participates in identity |
| Immutable output | Envelope, source and requested method were frozen | Caller mutation cannot change these admitted identities |
| Build-default independence | Original-default and EcoLogits-default registries had the same scientific EcoLogits method hash | Preference default is separate from the scientific policy |
| Product projection | Resource phase was `usage`; total water stayed unavailable | No fabricated combined-water total in this probe; raw-core parity is outside this review |
| Invalid preference | Initial six-operation failure corrected; typed null-choice status, guarded revision-8 repair, concurrent-valid-choice protection, and preserved live token capture all independently pass | Main EIR-01 and local EIR-01-L verified corrected |
| Canonical selected summary | Initial callback counted 1 of 2; after correction global and conversation scans both count 2 known / 0 unknown | EIR-02 reproduced, then verified corrected |
| Selection changed during route assembly | Original reproduction corrected; six final delayed-await publication probes pass | EIR-03 verified corrected |
| Recorded-thread selected/server mismatch | Initially preferred original server data; corrected production selection hook requests exact method and discards mismatch | EIR-04 reproduced, then verified corrected |
| Original Envelope2 archived request dependency | After correction both mutations retain known 1 globally and per conversation; stale selected and missing archive remain unknown | EIR-05 verified corrected |
| Company selection authentication/scope probe | Personal call rejected with zero network calls; company call bound the expected Bearer header; changing namespace/device before reply caused `policy_unavailable` | Correct client-side authentication/scope boundary for the exercised path |

### Reproducer recipes

These are source-derived recipes, not application fixtures written by this reviewer. `db.db` in the corruption recipe is deliberately used only to simulate a damaged durable record; the ordinary Ledger API correctly rejects direct untyped writes to estimation stores.

1. **Corrupt preference:** create a real Ledger and EngineService using `createMethodRegistry(config, mappings)` and `LocalEstimateExecutor`. In a raw IndexedDB transaction, put `{key:"installation", record:{schema_version:"1.0.0", preference:"removed_engine", selection_revision:7, updated_at:new Date().toISOString()}}` in `engine_preferences`. Await transaction completion. Invoke `status`, `admission`, `view(scope)`, `resume`, and `select({preference:"build_default", expectedRevision:7/null})`. All rejected with `ZodError`. Repeat with an initialized Coordinator and a valid synthetic dispatch to observe zero recorded rows. Call both explicit-original and default dashboards to preserve the distinction reported above.

2. **Canonical alias:** create two pairs with `packages/ledger/test/factory.ts::records`; compute original envelopes with the executor and persist with `db.capture(scope,pair,[envelope])`. Call `db.markAlias(scope.namespace,"request",pairA[0].request_id,pairB[0].request_id)`. Use EngineService to select EcoLogits and await `maintainLocal`. Obtain `view = await service.view(scope)` and the A-attempt's `liveInput`. Compare the bound result with the real summary callback:

   ```js
   const bound = await view.estimate({
     family: "live", request: input.request, attempt: input.attempt,
     canonicalRequestBinding: input.source.canonical_request_binding,
   });
   const total = await scanSummary(
     db, scope.namespace, { calculationView: view.view },
     undefined, false, undefined,
     (attempt, _original, request) => view.estimate({ family: "live", request, attempt }),
   );
   // Observed: bound.status === "estimated";
   // total.attempts === 2; total.metrics.energy.known === 1; unknown === 1.
   ```

3. **Final route race:** initialize Coordinator with synthetic count/consent/display/transport functions; derive a Claude conversation key for a generated UUID, seed a valid numeric pair and original envelope, select EcoLogits and await local completion. Wrap `c.history.view` so it first awaits the real method, then once performs a valid preference CAS to Original at revision+1, and returns the captured history. Call `c.routeSummary("claude", conversationUuid)`. Compare its returned `summary.calculation` against fresh EngineStatus. This targets an actual await after the live scan's last guard; no artificial response schema is supplied.

4. **Recorded thread:** construct RecordedThreads with a real empty Ledger, a synthetic company scope, and an injected `scanSelected` returning a selected EcoLogits calculation identity. A CompanyClient double captures the requested URL and returns a valid matched-thread response containing an original server summary. Call `threads.view(scope, "d".repeat(64))`. Observe the unqualified URL and the preferred original server result. The supporting server source explicitly defaults an omitted calculation view to original.

### Existing regression suites, run as additional evidence

```text
pnpm --filter @footprint/estimator exec tsx --test test/legacy-refinement.test.ts test/selection.test.ts test/engine-executor.test.ts
13 tests passed, 0 failed.

pnpm --filter @footprint/extension exec tsx --test test/engine-service.test.ts test/coordinator.test.ts test/method-runtime.test.ts test/recorded-threads.test.ts test/history-engine-service.test.ts
91 tests passed, 0 failed.

After the EIR-02/EIR-04 corrections:
pnpm --filter @footprint/extension exec tsx --test test/engine-service.test.ts test/recorded-threads.test.ts
39 tests passed, 0 failed.

After the main EIR-01 correction:
pnpm --filter @footprint/extension exec tsx --test test/engine-service.test.ts test/coordinator.test.ts test/history-engine-service.test.ts
31 tests passed, 0 failed.
```

These earlier runs include running-capture engine pinning, transient local failure retry, retained original bytes, genuine client enrollment against a SQLite TestClient, history import pinning, and scope/erasure races. At that time they did not cover the reproduced later-await race; the separate adversarial checks above close that gap.

Final reruns after scanner correction and runtime composition:

```text
pnpm --filter @footprint/extension exec tsx --test test/runtime-composition.test.ts test/engine-service.test.ts test/coordinator.test.ts test/method-runtime.test.ts test/recorded-threads.test.ts test/history-engine-service.test.ts test/summary-original-proof.test.ts test/summary-estimation-v2.test.ts
115 passed, 0 failed, 0 skipped (15.03 seconds).

pnpm --filter @footprint/extension exec tsc --noEmit
Exit 0.

pnpm --filter @footprint/estimator exec tsx --test test/missing-original-method.test.ts test/legacy-refinement.test.ts
7 passed, 0 failed, 0 skipped (5.93 seconds).
```

The earlier scanner `summaryAuthority` undefined-value canonicalization failure (engine-service 10/11) was a known in-progress owner defect. The final run supersedes that result and passes its affected alias case. A preceding 114-test run passed before adding the composition test; these overlapping runs are not summed. SQLite and component tests are not PostgreSQL/native-browser release evidence.

## Acceptance assessment

| Area | Scoped assessment |
| --- | --- |
| Original raw math/serialization, LG01-LG08 | PASS for the 29 frozen cases through the wrapper; no claim of exhaustive physical accuracy |
| Complete method/input identities and immutability | PASS for inspected registry/hash construction and independent mutation/boundary checks |
| Usage-only projection, scalar/range distinction, unknown water | PASS for inspected projection and executed cases; upstream parity remains separately owned |
| Deterministic override/direct/flagship/original fallback | PASS for inspected precedence and executed regression cases; mapping quality is an assumption, not empirical provider identification |
| Normal valid preference CAS/build default and running capture pinning | PASS for exercised paths, including invalid-preference recovery, concurrent repair, and both local missing-original recalculation targets |
| Durable retry/promotion and publication | PASS for local interruption/retry and six independently exercised final-publication boundaries (EIR-03) |
| Canonical request alias integration | PASS for corrected selected alias bindings and archived-original proof (EIR-02/EIR-05) |
| Consistent selected/original views across all entrypoints | PASS for the exercised capture, route, dashboard, history and selected-server boundaries; UI/native-browser independence remains excluded |
| Personal calculation network isolation | PASS for exercised personal/default/capture and explicit personal CompanyClient paths |
| Authenticated organization selection | Client request/reply scope checks pass; full backend authorization and deployment acceptance remain separately owned |
| Missing old executable code | PASS for preserved numerical capture, explicitly missing original lineage, both later supported targets, and rejection of fabricated missing lineage |

## Assessment requested by parent: absent original-method lineage

Allowing a future recalculated envelope to carry `original_method_hash: null` can be appropriate **only when the numeric observation legitimately never had an admitted or known original method**. A new selected calculation scientifically depends on the saved numeric evidence and the requested new method, not on the old formula having run. PR12, PR16 and PR19-PR22 support using available numeric evidence while preserving explicit missing-data semantics.

This must be a coordinated contract change, not a relaxed assertion or a UI workaround:

- Retain a known original hash even when the old executable or old result is unavailable. Null must not conceal a mismatched known hash, lost provenance or a corrupt archived record.
- Require explicit missing-original lineage, such as a validated `original_method_missing` reason backed by repository metadata. A dedicated lineage state may distinguish never admitted from unknown/corrupt metadata more clearly than a free-standing reason.
- Validate this rule in TypeScript, JSON Schema, Python, local job admission/result commit/promotion and server ingestion. Preserve original result absence and numeric observation bytes. Never manufacture a raw original result or claim that an original formula ran.
- Bind the later result to the actual source revision and target method. Test that null cannot override known original lineage or be promoted against another source/job.
- The existing executor expression `options.methodId ?? proposed ?? methods.original.method_id` is a legacy fallback. A newly unadmitted capture with null proposed method must not enter that fallback and silently become an Original estimate. It needs explicit unavailable-admission handling; legitimate old null-proposed records retain their existing compatibility semantics.

The plan's prohibition on invented conversion remains intact: a selected unsupported old method stays unavailable. It does not require an unrelated old executable to exist before a supported new method can calculate valid stored observations. The design constraints above were subsequently tested through the local positive and negative probes in EIR-01-L. Cross-runtime backend evidence is separately attributed below.

## Archived-era local-only grants

The earlier review correctly left this phase unverified while it was being designed. The parent later requested a bounded service integration recheck of the implemented local selection vector. The following results are now independently verified, without duplicating the separately owned ledger authorization review:

- Established real ownership history across Personal, another company, and archived/current eras of the current company. The current service vector included only its two authorized company eras. Holding the archived executor kept the whole default view original/pending; releasing it completed both results together. Both archived/current results were readable through the current service view. Personal/foreign records were excluded; measurements, originals and outbox bytes were unchanged. Organization selection callbacks received only the current scope.
- Injected executors declaring organization execution or no execution origin received zero inputs. An executor claiming local but returning an organization-origin result was called once, and its result was rejected. All three cases ended failed with zero processed/committed results. Automatic kick scheduling was disabled only in these isolated rejection probes to avoid racing the manually awaited maintenance call.
- Using production Coordinator history hooks, imported history in a company era, reconnected to the same company with an empty current era, and completed selection. The vector contained both eras, current input count was zero, and selected archived history remained available with the correct EcoLogits hash. Starting another archived job during `resultFor` made publication and subsequent pending reads unavailable with empty resources while retaining response count 1. Completing maintenance restored resources. Stored history rows remained byte-identical. One synthetic company network attempt failed offline; no raw history was exported by this probe.

These are service/history consumption and locality results. Full offline archive authorization, revocation, erased-grant invariants and durable migration acceptance remain the ledger review's separate responsibility.

## Runtime composition: bounded AR02/AR06 review

**Verdict: CLEAN for the exercised injection boundary.** `runtime-composition.ts` chooses concrete defaults, and Coordinator accepts a paired registry/executor plus a structural CompanySession. Capture, history, canonical reconciliation, maintenance, selected summaries and recorded routes share that composition. The explicit method lookup now uses the injected engine registry. This review makes no AR05 claim about replacing domain storage repositories.

The independent positive probe created a registry with an EcoLogits default and changed mapping review date, giving a method ID/hash distinct from the packaged global. It supplied a structural Personal session and a wrapped replacement executor. Live dispatch/end, history import, canonical reconciliation callback and explicit recalculated dashboard reached that executor (nine calls); the dashboard returned one known live result and available historical resources using the custom method hash. The exact injected session, registry and executor objects were retained. Organization operations and network calls were both zero. This proves the exercised explicit-selection path did not leak the packaged registry.

Independently ran the owner's complementary regression in the final suite: a deterministic failing injected executor reaches live capture, history, canonical reconciliation and recalculation, preserves numerical evidence and the retained original, and does not silently run a replacement formula. The default-dependency regressions and extension typecheck also pass. Raw engine math, UI behavior and arbitrary future entrypoints remain outside this bounded composition verdict.

## Separately attributed backend evidence

The parent supplied `docs/release/BACKEND-ECOLOGITS-INDEPENDENT-REVIEW.md`; this reviewer read it but did not execute its backend probes. Its final bounded verdict is CLEAN, including explicit missing-lineage admission, known-original retention, Original-target Envelope2 storage, registry validation, protected erasure/journal replay and populated 0009-to-0010 migration preservation.

That reviewer reports **401 passed with one PostgreSQL-only skip**, followed after interruption by **135 passed with no skips** against unchanged reviewed runtime hashes. Those suites overlap and are not summed. PostgreSQL execution, restore/races/load and migration 0010 on PostgreSQL remain ST18 UNVERIFIED. These attributed results support the backend side of EIR-01-L; they do not turn this integration report into an independent backend or release certification.

## Source snapshot and re-review

The following hashes identify the preceding CLEAN review snapshot. Parent and other agents are still implementing changes, including the subsequent AR05 migration; later modifications are not approved by these hashes. Follow-up evidence has its own snapshot below. Dependencies establish inspected contracts, not blanket approval of their owners' implementations.

Snapshot timestamp: `2026-09-15T07:42:21+00:00`. Hash algorithm: SHA-256 over file bytes.

| Scope | Path | SHA-256 |
| --- | --- | --- |
| Reviewed source | `packages/estimator/src/selection.ts` | `2c525d0f1174031239bfe6548f462f9b8b0ac70efbd3c1d92526f456cfcc9f30` |
| Reviewed source | `packages/estimator/src/engines/methods.ts` | `f796fda485388479208dd620f727bcec1bc12020b0d3cff8f8698974b041b176` |
| Reviewed source | `packages/estimator/src/engines/service.ts` | `bed5b4ccaebe9f020470816dec6e863f1083dbaaf0d1749f80bb42fce4f8a7e5` |
| Reviewed source | `packages/estimator/src/engines/inputs.ts` | `cc9c040cb54eefe3e1c99fba3c50e0c2e020eac84be6d916f7cd314b3aef0e16` |
| Reviewed source | `packages/estimator/src/engines/original.ts` | `a42295572b51a7c53dbdc9708f9eac80a196eb2cf2586ab3370f86618d63b25b` |
| Reviewed source | `packages/estimator/src/engines/ecologits.ts` | `a4fa0347c690af38a0437ef55718de5f75bb1c70c843d3ea45cb044d233234a7` |
| Reviewed source | `packages/estimator/src/engines/projection.ts` | `c2aef1dc379bea056aa2ac78f7a67ecd9431be85a2a2da247af118e52212df2e` |
| Reviewed source | `packages/estimator/src/engines/history-projection.ts` | `788701dc136b8fba34b2a9e81d2a81c5eb67b1e2f8698b3e759886db4d8845cb` |
| Reviewed source | `apps/extension/lib/estimation/config.ts` | `11e5f99a17e8a785663d6cf85272940b9277241c015191b8b6275b0db7921aee` |
| Reviewed source | `apps/extension/lib/estimation/service.ts` | `a2fc299c0c849379d0381c0ffcfa77b45f9460a40c28c86780e996d85f5d9d94` |
| Reviewed source | `apps/extension/lib/coordinator.ts` | `323dbdc3f4c454405e004870293d9d3829f0f948788fe023686d43f949636d28` |
| Reviewed source | `apps/extension/lib/company.ts` | `bde775524b14dcb329370ea3cb91bd1043206d80f181f1db26bd3273cd9610f2` |
| Reviewed source | `apps/extension/lib/method-service.ts` | `cda47e9d471ea6e337618430f889dd82904e919399ebc05e6d8c8fd6fd548171` |
| Reviewed source | `apps/extension/lib/recorded-threads.ts` | `1b99c694b7036f6ea4cf3be3992545304ab6a929c359c834da1b2b009b1281b5` |
| Reviewed source | `config/estimation.build.json` | `78a726b6aa2b91db054d4d42276d58fcb0d55bc3817c5e55acd6fe2c19000055` |
| Reviewed source | `config/estimation.mappings.json` | `2f5e7efd104bc5d6ca8c59c2f85e4d3259c2a8dd7673f6fab320fe9f66fc380a` |
| Inspected dependency | `packages/estimator/src/bundle.ts` | `3abbfcde7fcb5ad7853d261949fcebabaf65c2c1bcd4b427eb07d0a3c2db3d7e` |
| Inspected dependency | `packages/estimator/src/original.ts` | `025037e7587ccfda525001d7247404ef665b0b44aac1517564da00e8dfab53d3` |
| Inspected dependency | `packages/estimator/src/history.ts` | `9a65c033f2c2870ffd6c9f44611cf4160b7601489a60d1ffce2f48b200e69679` |
| Inspected dependency | `packages/estimator/test/fixtures/legacy-refinement.json` | `5c719a90ea922cc9b9be9354e765780c54296ae2b6fe6585d2f2d7c8748101be` |
| Inspected dependency | `packages/contracts/src/engine-policy.ts` | `414b30b065b0362cb69db01271d09379269f5435f43e0fbfab96bdeb120b62d5` |
| Inspected dependency | `packages/contracts/src/engine-status.ts` | `166fc4c15c881ae24495418fa7beb058065462c2d6ca8e2a34d30ecfa61bb6d0` |
| Inspected dependency | `packages/contracts/src/estimation-result.ts` | `a212b83add5f9ff9e684c7fc7f242df5b7dcd994d79f76f6545b00778adb17ea` |
| Inspected dependency | `packages/ledger/src/estimation-repository.ts` | `0ea40a88a8f9a7eed5c8ee138975350812c414218ff9dfb3cb928836f1584940` |
| Inspected dependency | `packages/ledger/src/estimation-storage.ts` | `9cf4223256420f4fba5ae8e364412334e10c0c4356cb57946a951ba37c33a2f0` |
| Inspected dependency | `packages/ledger/src/index.ts` | `b243fcdbd8ad8c0225ae22010986d12f12532f2065f3aa83805054eb63b08619` |
| Inspected dependency | `apps/extension/lib/summary-scan.ts` | `3525a88cbce9835bb8f1d856d9a6fa64a72b124530b95f1f9f40404f13feeaac` |
| Inspected dependency | `apps/extension/lib/estimate-presentation.ts` | `ca342f594116575d25dee2929c0f33c65b3d1e630b3072a0feb77e49f26938f9` |
| Inspected dependency | `apps/extension/lib/server-summary.ts` | `f13b364c3da9abadfd06b3a01487de56d3cb0e27f0a22533648fe8c7cedf6dba` |
| Inspected dependency | `apps/server/aift/thread_relations.py` | `98602a445aff6d6a2dd9fc166026dba05c9b9d7ee943ad0da8a3fddbf3bb5a6c` |
| Inspected dependency | `apps/server/aift/method_history.py` | `c1486a693ec9e7efeb7b1e3b8ce9bf8c9985654aae9f8246b41df883ad044d02` |
| Reviewed source | `packages/estimator/src/lineage.ts` | `411c38c76a28436e00dff6df5d8ce2c2dd4a99d4e65518459e1dec72517a0c91` |
| Reviewed source | `apps/extension/lib/estimation/view-state.ts` | `ac9e5a910c49880a16c255bcfe087631c94f58ee7f0bebbe3330981a4065f0de` |
| Reviewed source | `apps/extension/lib/runtime-composition.ts` | `1c67ac7f2d2e27abac1b98ebc6264524ce75019e07f31725f2069b8f40ff3e13` |
| Inspected dependency | `apps/extension/lib/history-service.ts` | `d95e6a9c6e66c8d2a13ab1d0a411e8bcde12c981afe4d3b0cf56e275e2f8ce80` |
| Inspected dependency | `apps/extension/test/runtime-composition.test.ts` | `2f6e1c5c864dd504f75498323e856b320c2f5211e1111c2e5403003f520bca52` |
| Inspected dependency | `packages/ledger/src/estimation-contracts.ts` | `b4954ac9e45b0e918daa0cfb722666dd0da5c521a772dae089b442640af50f6a` |
| Inspected dependency | `packages/ledger/src/local-selection.ts` | `f906680e8205008aef19f2eebfe5b802f30d843a542eb7600f66c40ed7875225` |
| Inspected dependency | `packages/ledger/src/original-live.ts` | `78aa6b42584facb66eb356d9c64711fb67be3b50cf12b015e7a535ee45ecb98f` |
| Inspected dependency | `docs/release/BACKEND-ECOLOGITS-INDEPENDENT-REVIEW.md` | `725a21ac3746504224a29f5d13216a7e794ee103b8d480472273e8b8790cc02b` |

**Preceding bounded conclusion:** EIR-01 through EIR-05, including the local EIR-01-L extension, had no remaining reproduced blocker in that reviewed snapshot. The added AR02/AR06 composition boundary is independently CLEAN. Full ledger/backend acceptance, AR05 domain storage migration, native Chrome/Edge/Firefox verification, measured performance, PostgreSQL ST18 and public distribution remain outside this verdict. Later source changes require focused re-review.


## Subsequent targeted audits: monthly selection and counting replacement

The parent requested these read-only follow-ups after the preceding CLEAN handoff, while a separate owner was migrating domain repositories. This follow-up does not independently approve that concurrent AR05 migration. No implementation files were modified.

### EIR-06 [P2] Production monthly summaries bypass the selected engine

**Status: verified corrected at the monthly service and claim boundary.** The original Personal/company reproductions are retained below.

`background.ts` dispatches `monthly-summary` directly to the standalone `server-summary.ts::monthlySummary`. Both branches force Original: Personal builds Original filters and calls `scanSummary` without the selected callback; company requests a My summary with `calculation_view=original`. Neither path captures the effective engine selection. Existing monthly claim methods guard once-per-month state and some policy/erasure conditions, but accept no calculation token.

No locked requirement intentionally fixes the monthly view to Original. The root plan limits when and where the month-end notice appears, and requires at most one per profile/company/month. Modular plan Q2/Q5 and section 9.1 require the completed selected recalculation to become the default for that installation. PR12/PR15 and final-publication requirements PR17/PR19 therefore apply to this production entrypoint. The monthly period does not create a method-selection exception.

Independent probes used real Coordinator policy, actual completed EcoLogits selection and synthetic August observations:

- Personal: the August dashboard returned one known selected EcoLogits result, but the monthly helper returned an Original envelope for the same one request and consumed the August claim. Network calls were zero.
- Company: the current local engine view was completed EcoLogits, but the helper requested `/v1/me/summary?calculation_view=original&end=2026-09-01&period=custom&start=2026-08-01`, accepted the synthetic Original response, and consumed the August claim. The URL assertion uses a synthetic CompanySession reply, not a live server.

**Recommended correction:** route the production action through a Coordinator-owned monthly operation or a small injected query interface. Use the captured effective local view and selected callback for Personal, and the selected My server-summary path for company scope. Preserve timezone-derived half-open previous-month ranges, source separation and calculation identity in the returned result. A standalone compatibility helper may retain Original defaults if production no longer bypasses selection through it.

Couple the once-per-month claim with the captured selection/routing and applicable record/erasure generations in one atomic repository operation. An asynchronous check followed by an unguarded claim leaves another race and can permanently consume the notice for a rejected snapshot. A superseded, failed or not-yet-current selected calculation should not consume the successful monthly claim. Recheck Personal/company selection, change during query and claim, pending work, concurrent requests, erasure, scope/credential changes and calendar/timezone boundaries, including storage-adapter parity when available.

### EIR-07 [P2] Tokenizer selection metadata cannot cross the full host and receipt path

**Status: verified corrected for AR03/BC06 in the exercised source and simulated worker/platform paths.** Native browser and performance acceptance remain separate. The original partial assessment and reproductions are retained below.

The existing deterministic `countByTextLength` replacement returns bundled implementation/profile/asset identities. It proves that a count function can replace the algorithm behind the existing declared metadata. The runtime-composition test replaces the estimate executor and organization session; its counting dependency is this same bundled-metadata fake. Neither demonstrates an honestly distinct allowed tokenizer selection through every production path.

Independently ran all 13 tests in `count-boundary-modular`, `count-worker-runtime-modular`, `count-platform-modular`, and `file-worker-entry`: all passed. Their relevant scope is:

| Existing evidence | What remains unproved |
| --- | --- |
| Distinct fake implementation with allowed `observed-text-v1` through `countFields` and direct `countAccessibleFile` | Full host/worker/platform/receipt transport and persisted live/history/file metadata |
| CountWorkerRuntime injection with a delayed bundled implementation | Distinct implementation/profile/assets across the production host configuration |
| Chrome/Firefox platform and offscreen fakes, including `cl100k` text | Distinct counting manifest through live/history and private-file receipt |
| Actual file worker initial-job and cancellation regressions | Alternate selected manifest at worker construction and its host validation |

Two independent probes establish actual source gaps:

1. Created `review-fake-1` using the already-allowed `observed-text-v1` profile, a declared test asset hash and a deterministic count of one. Direct text and file counting returned `counted` and passed validation with that manifest. A synthetic FileWorkerPort emitted the same valid counted result to the actual `FileCountHost`; the host returned `unavailable` with `worker_unavailable`. It calls `validFileResult(result, job)` against the bundled default and has no manifest dependency. No raw source text appeared in the returned results.
2. Used the unchanged bundled implementation and its already-packaged `cl100k-base-4.0.0-reference` profile. `countAccessibleFile` returned counted and `validFileResult` accepted it, but `validFileReceiptResult` rejected it. That receipt validator additionally requires `TOKENIZER_ASSETS.profiles.o200k_base.asset_hash`. This is a supported existing profile rejected by a later boundary, not a request to admit an unknown contract ID.

Related source constraints explain why merely adding another direct function test cannot close BC06: Coordinator live and `countHistoryPage` create the bundled default implementation/profile requests and validate against the bundled default. `CountHostOptions.implementation` controls only text validation; it is not passed into `FileCountHost`. The concrete file worker selects bundled counting. Chromium text/file response checks and file receipt validation also use bundled metadata. Some defaults are appropriate at composition, but the selected manifest must be injectable consistently at the callers and validators that consume it.

**Recommended smallest meaningful correction and test:** provide a selected counting configuration/manifest at the composition boundary and propagate its implementation/profile/asset metadata through live/history requests, worker construction, text/file hosts, platform response checks and receipt validation. Keep functions inside the packaged worker; do not serialize executables or introduce arbitrary runtime imports. Keep strict job/revision/profile/asset checks and existing numeric/byte bounds.

Use one distinctive deterministic implementation with an already-allowed profile and truthful asset metadata in an integrated regression. Exercise actual live and history assembly plus the private-file host/receipt path; assert stored numerical values and profile/asset metadata, unchanged estimator/storage source, absence of raw text, and rejection of a deliberately wrong asset or stale job. Include the existing bundled `cl100k` receipt case. Entirely new profile IDs outside `PROFILE_IDS` legitimately require an explicit contract/schema revision; this finding does not ask to loosen that whitelist or improve extraction/token accuracy.

### Follow-up source snapshot

These hashes identify the inspected follow-up sources, not approval of unrelated changes in the same files. The previous 40-file snapshot remains the evidence boundary for the earlier CLEAN handoff.

Follow-up timestamp: `2026-09-15T08:04:35+00:00`. SHA-256 over file bytes.

| Path | SHA-256 |
| --- | --- |
| `apps/extension/entrypoints/background.ts` | `c7140964ac81bb2fd9c504953b1f1f9cccfeff453e6a349ec8b0324e744cb96c` |
| `apps/extension/lib/server-summary.ts` | `7069db23cf65f5843d65967500fcc616cbb0e3882b2537f647dac68419e1741f` |
| `packages/ledger/src/index.ts` | `bdeead9aae506dd56ebd7e5c8033cea8c0ffc0f7e2545fa8c1e84289b41a292f` |
| `apps/extension/lib/coordinator.ts` | `68073bcf0e60ca56c8574431df4866a371d08eb04dbcb64fdd1abff01cbf3793` |
| `apps/extension/lib/history-capture.ts` | `74fb5742a7d3b4ef52d1717f131e53f6cefd970bfd20afa11811f731097e337f` |
| `apps/extension/lib/count-host.ts` | `a03530640f06852113626f089e140d763ccadd6e3214ba4c73143a277c91b04b` |
| `apps/extension/lib/count.worker.ts` | `fd78fb7f508b767f556d85dc3043f418d7e3d8afb5c35c55d0d3d02a8e99f6f7` |
| `apps/extension/lib/file.worker.ts` | `d75814edab8e328d39f387cbea6a135198f9b19278e3f538482bedd7a58714eb` |
| `apps/extension/lib/platform.ts` | `3dd4cd60590ae0ff6114c68f666baea99969e256b54fc49bc718ee52151f0e5f` |
| `apps/extension/lib/file-receipt-result.ts` | `1c28810b29899b7687e993a9a7401cf7ae2d142f6ea4b8997d434558ccfe990e` |
| `apps/extension/lib/file-grant-broker.ts` | `146553c41b9e8c1aa3008c32c4e3da480c7b73d93a5d5077f0e572f0bd62c73e` |
| `packages/file-text/src/host.ts` | `7ccf279bbae8f4b22d1ed0f260b7d4d79041873516d23d25aaf9c598ff571d76` |
| `packages/file-text/src/types.ts` | `a6b16900b293a0185fa045e8eb3d9e157f12e617ba2fe5f986b5b1af268c0b0b` |
| `packages/tokenizers/src/protocol.ts` | `e8c64544b5f419508ebcb4a31ac07073d8767178313d02661985b563947c4fb2` |
| `packages/tokenizers/src/counting.ts` | `237f1c3e61a047a0ed62a9f5426ddcebc32030409dcebdeec14b20bcc3b8abd0` |
| `apps/extension/test/counting-fixture.ts` | `12b607321fccaa94d49107f6f8fecd0c0524c680922cfabfdd43a7c98b2ba006` |
| `apps/extension/test/count-boundary-modular.test.ts` | `6e00f36ce0c77e1b9da6b23b3c9a534dc2d5312d3438b70aa6d07c03505aaa57` |
| `apps/extension/test/count-platform-modular.test.ts` | `3c611a2fd99e9ba021388bdc7e5b4e5822882b688225194a809a01a8f5f3c357` |
| `apps/extension/test/count-worker-runtime-modular.test.ts` | `417fafe6a30dde9bd566039c23cd4ceadb4048c8651553f07957e7fdd956dac7` |
| `apps/extension/test/file-worker-entry.test.ts` | `fc8fab9663c0e18b12439faa1e8452927055bb12732b6bd836edeb8099a245ea` |

**Initial follow-up conclusion: FINDINGS.** EIR-06 and EIR-07 required correction. The independent correction evidence below supersedes this initial result while retaining its source snapshot.

## Final EIR-06/EIR-07 correction recheck

### Monthly selection and claiming

**Bounded verdict: CLEAN.** Production background dispatch now calls the composed `MonthlySummaryService`. The service captures the engine view, waits for completed selected work, queries Personal locally with the pinned selector or company through the selected My-summary callback, and returns explicit calculation metadata. `claimMonthlyView` compares scope, credentials where applicable, timezone, erasure and the complete local selection token in the same atomic operation that claims the month. That token includes the input/publication vector and summary epoch. A stale attempt retries; an already claimed month or pending selection returns null.

Independently repeated the original selected-EcoLogits cases for both Personal/company and IndexedDB/memory repositories: all four returned the selected EcoLogits method for August, claimed once, and retained original-envelope bytes. Personal made zero network calls. Company exercised the actual selected-server-summary integration with synthetic authorized responses and verified its explicit method query.

Eight additional source-derived probes started from completed EcoLogits, changed the preference to Original at the final claim boundary, and varied whether the replacement calculation completed immediately. For each repository and mode, the first claim was `stale`. A completed replacement retried and claimed only the Original result. A pending replacement returned null with no saved month; after maintenance it returned the completed Original result and claimed once. A second successful-month read returned null. No original bytes changed. These are exact final-claim races, not only engine-status assertions.

Independently ran the 38 owner-authored monthly integration regressions and six server-summary regressions: **44 passed, no failures/skips**. They additionally exercise initial default and explicit Original views, failed work/recovery, query-time switches, six simultaneous reads, timezone changes, erasure and rebuilding server summaries on both repositories. This is not an independent UI sign-off. The parent reports monthly visibility/keying tests separately; the reviewer's previous UI authorship keeps that portion excluded.

### Counting replacement, validation and persistence

**Bounded verdict: CLEAN.** Trusted composition now snapshots an immutable `CountingRuntime` containing the selected IDs and a non-executable validation manifest. Worker implementations remain packaged or explicitly injected at construction. Text/file hosts, platform response validation, Coordinator live assembly, HistoryService/countHistoryPage, inline-file projection, broker receipts and uploaded-file projection receive the selected metadata. The broker rejects page-supplied selectors that disagree with its trusted selection. The receipt validator uses the job's actual selected asset instead of requiring the o200k asset.

The original two independent failures now pass:

- `FileCountHost` supplied with the explicit trusted `review-fake-1` runtime returns count 1 for the allowed `observed-text-v1` profile. Omitting that trust still rejects the custom reply, and a wrong asset is rejected. The fix did not make arbitrary worker manifests authoritative.
- The already-bundled `cl100k-base-4.0.0-reference` result passes receipt validation with its actual asset, including the unchanged default validator call. A forged asset fails.

An independent actual `FileWorkerRuntime` probe held counting across cancellation. A stale revision did not cancel it; the matching revision produced cancelled, and the next job counted successfully. Disposing another runtime while its count was held suppressed the late reply. A profile outside the existing contract whitelist still failed before counting.

A separate independent persistence probe used the actual IndexedDB repository and actual worker runtimes behind a Chrome-shaped transport double. Live dispatch/end and imported history recorded distinctive count 1, `observed-text-v1`, and the expected asset metadata where the observation schema carries it. Mutating the originally supplied configuration after construction did not change admission. Restarting the text worker with a different asset produced unknown counts for the new observation while preserving the previous counted observation. Closing and reopening IndexedDB retained the original count/profile/asset and the exact historical rows. The private-text sentinel was absent from stored measurements and history; Personal network calls were zero.

Independently ran **21 extension counting/history/full-flow tests**, **7 tokenizer tests**, and **13 private-file tests**, all passing with no skips. The full-flow tests execute actual Coordinator, HistoryService, CountHost/CountWorkerRuntime, FileCountHost/FileWorkerRuntime, broker, public receipt and uploaded projection with the same distinct fake, through Chrome- and Firefox-shaped transport doubles. They cover metadata snapshots, wrong assets and worker restart. The shared suites retain supplied-text tokenizer parity, real dedicated-worker file counts, byte-buffer preservation, parser bounds and cancellation checks. None is a native browser or performance measurement.

### Final executed commands

```text
pnpm --filter @footprint/extension exec tsx --test test/monthly-engine-service.test.ts test/server-summary.test.ts
44 passed, 0 failed, 0 skipped.

pnpm --filter @footprint/extension exec tsx --test test/counting-runtime-flow.test.ts test/history-counting-runtime.test.ts test/count-boundary-modular.test.ts test/count-worker-runtime-modular.test.ts test/count-platform-modular.test.ts test/file-worker-entry.test.ts
21 passed, 0 failed, 0 skipped.

pnpm --filter @footprint/tokenizers test
7 passed, 0 failed, 0 skipped.

pnpm --filter @footprint/file-text test
13 passed, 0 failed, 0 skipped.

pnpm --filter @footprint/extension exec tsc --noEmit
Exit 0.
```

Earlier test totals overlap these runs and are not summed. The independent ad hoc probes used synthetic data and transport doubles and modified no implementation files.

### Correction source snapshot

The following hashes identify this bounded correction review. Whole-file hashes do not extend the verdict to unrelated concurrent AR05 changes in those files. The earlier manifests remain historical evidence.

Correction timestamp: `2026-09-15T08:40:22+00:00`. SHA-256 over file bytes.

| Path | SHA-256 |
| --- | --- |
| `apps/extension/lib/monthly-summary.ts` | `133eeb648f5033622fcf58713d6f9d4611ba18497bfa19c10f2dc69ce36147b0` |
| `apps/extension/lib/runtime-composition.ts` | `2ac6a1edf79e1a6bd5718bcbac8a71000613aff6a290fd1c9dc5a79d1e553d49` |
| `apps/extension/lib/coordinator.ts` | `52350f96d15d47e839230dda0139426cb9f831262a69595d16fa947f84e6664d` |
| `apps/extension/entrypoints/background.ts` | `76836fce2d72dbea02169b76b046399e81005fcba02e0b7f34c0ec67be5e113d` |
| `apps/extension/lib/server-summary.ts` | `e18ae2f7dc4ba7ba89a7ba96da70b65f6ce41a442f792da641f84e0f0437d52c` |
| `packages/ledger/src/monthly-claim.ts` | `3ed7f8f9e0c81e0babad51187108e7aca8cfa908584014cecfa29db6db9c9e69` |
| `packages/ledger/src/memory-repository.ts` | `7418baee4c964d440d5f753f447493ce9d76dc7ea6fb75a7b8e6681b1507defb` |
| `packages/ledger/src/local-selection.ts` | `f906680e8205008aef19f2eebfe5b802f30d843a542eb7600f66c40ed7875225` |
| `packages/ledger/src/repository-contracts.ts` | `6117e4bb8dd6885b6d18e36a778ebb04ddf9e86ea6488873d9eddf5bc34b49cd` |
| `packages/tokenizers/src/runtime.ts` | `2b21228e65194d8eed9d9926d964eec6579c848bcac04b89f8d604719e73aac9` |
| `packages/tokenizers/src/protocol.ts` | `3d2dbf28dad64ead50c969dae2811bb41581638076548859ad9e02964a36a3ac` |
| `packages/tokenizers/src/counting.ts` | `3b94dc87886779e0f7ec887eaddeb23d20dd45589587f1c06f98c23a9c395c6f` |
| `apps/extension/lib/counting-config.ts` | `2d80226255df3cce9169b0f6dd5ff4de6e6c6f6953c445ebffa8d50f39077c24` |
| `apps/extension/lib/count-host.ts` | `18ac02dbcd79b109d9197b18b87a144693081f41ae13e3679f50af6f5462e585` |
| `apps/extension/lib/count.worker.ts` | `9c788de4dadee21d5902dfcf587d9bd2b1dbaefadde08f7942ece2b2ef30edf6` |
| `apps/extension/lib/file.worker.ts` | `bdb8e982daa933b3dfdd7d8bd9b7685df5168ba31ca12b3a954c27fee8bc33ca` |
| `apps/extension/lib/platform.ts` | `dbd3773303bff2177ee897e25f8da1d04b3143517f984dcd0ea282ba3406513d` |
| `apps/extension/lib/offscreen-entry.ts` | `de9c42763c01d411bc6cdf784db6e05543f45e39751dd3c039a71c18456ed00f` |
| `packages/file-text/src/host.ts` | `373dd9db506aaaae34fed26a4cd71d83563c6d7814608bc980e233bd9ad4acca` |
| `packages/file-text/src/types.ts` | `b31522d54f5bf28c114513f1cd0889e042521ff6c5a1fa5c2f027d04b8fe2637` |
| `apps/extension/lib/file-grant-broker.ts` | `f7a5c33be3506792dd529c8c0a002fcb4273cbbe35f3f6d285318c89d33c61d6` |
| `apps/extension/lib/file-receipt-result.ts` | `cd4f557d345e83b4b5b41ed6db0691b995bd79944b287a293504b85ebf5be195` |
| `apps/extension/lib/inline-file-components.ts` | `20eec72c41d4353754a6e8a467b8c105eff3a4a582d4856694c278b977d3c7ed` |
| `apps/extension/lib/uploaded-file-components.ts` | `d477a101ae42242bd9d5562da4b70f7fa78213c0f43ee005df213b6f9d02d729` |
| `apps/extension/lib/history-capture.ts` | `e5bd23791ea02c0f9ae758c6b820f6f4d5232fc06442040d85f1330d5389ab2f` |
| `apps/extension/lib/history-service.ts` | `303e04f842f5e16fd172b53934e5edd5cf108145bd0da79c9e8f3b201a842833` |
| `apps/extension/test/monthly-engine-service.test.ts` | `6edd0c55141d4a973a28ac5df5148c8608699f560075e7c0be9859c1a7c79c65` |
| `apps/extension/test/counting-runtime-flow.test.ts` | `a5bf49d87d9eff3018dc39a7dbe0c94e9ff8532432a367e5d4d3014a9a483272` |
| `apps/extension/test/counting-runtime-fixture.ts` | `035f1cfe419d2d03eab3a1c344e5002ea303b69ee295aa3788ec983c4cb6d7f7` |
| `apps/extension/test/history-counting-runtime.test.ts` | `1239d26e841b1c37cdf6d413f91f302a3a59e5f8c05729208fa6ba41c088d193` |

**Final bounded conclusion: CLEAN.** EIR-06 and EIR-07 have no remaining reproduced blocker in this correction snapshot. The source/worker integration portions of monthly engine selection and AR03/BC06 are verified. Earlier EIR-01 through EIR-05 and AR02/AR06 evidence remains tied to its recorded snapshots. This does not certify the concurrent AR05 migration, this reviewer's UI, full extension release readiness, native browsers, measured performance, PostgreSQL or public distribution. Only this report was changed by this reviewer.

## Subsequent BE15 build-default rollback audit

The parent requested one concrete additional case before final builds: retain saved EcoLogits originals with no active or selected recalculation job, then reload with an Original-default build. Source remained read-only.

### EIR-08 [P1] Initial-Original shortcut skips rollback recalculation when saved originals used EcoLogits

**Status: verified corrected at the EngineService/vector integration boundary.** The original failure blocked BE15 and the Q2/PR12 default-view requirement for the exercised rollback state; its reproduction is retained below.

`EngineService` and `localViewState` both infer an initial Original state from follow-build-default preference revision 1, effective Original target, and absent active/selected jobs. Neither checks which methods produced the saved originals. `runLocal` excludes those members from pending work, and `ensureJob` independently returns null for the same condition. The presentation predicate also reports the view settled.

Executed eight source-derived cases with real EngineService, registries, LocalEstimateExecutor and typed capture commits. Every case used real saved Personal ownership authority. The problematic recipe is:

1. Construct an Eco-default registry and EngineService, and call `admission()`. It saves `build_default` at selection revision 1.
2. Store a genuine EcoLogits original for a valid numeric request/attempt pair using `commitCapture`, including the current compatibility estimate. Assert both active and selected jobs are null. This represents recorded data before maintenance has established a job; no source or preference corruption is injected.
3. Dispose that service and construct a fresh service with an Original-default registry over the same durable repository. Before maintenance, status already reports Original/complete and the view is original with pending false.
4. Await `maintainLocal`, then read status, job state and the default summary through the actual selected-view callback rules.

Both repositories return the same failure: **zero executor calls, no selected job, one pending input, Original/complete status, original/pending-false view, and one known displayed EcoLogits original**. Original bytes remain unchanged. The problem is the skipped required recalculation and incorrect settled default, not loss of the retained original.

| Build/default scenario | Independent result on both repositories |
| --- | --- |
| Eco-default to Original-default, follow build default, no jobs | FAIL: no recalculation; saved Eco result is treated as settled default |
| Original-default to Eco-default, follow build default, no jobs | PASS: pending first, one recalculation, completed selected Eco view |
| Original-default to unchanged Original-default, no jobs | PASS for the control: unchanged Original result remains settled without redundant work |
| Eco-default to Original-default, explicit saved Eco preference | PASS: explicit preference wins and the completed selected view remains EcoLogits |

**Recommended correction:** establish trustworthy saved-method/effective-method evidence before applying the initial-Original optimization. If the relevant saved observations cannot be proven compatible with the target Original method, conservatively schedule the required work and keep the default pending. Job creation, status and presentation must use the same predicate. Account for the authorized scope vector, archived eras and observations with explicitly missing original admission. Do not overwrite preference or original evidence, infer compatibility merely from a method label, or add an unbounded scan of originals to a hot read path.

The focused correction should preserve the unchanged-Original and explicit-preference controls while covering the failing direction, reload/restart, mixed original methods and the no-job state. The earlier passing EIR-01 through EIR-07 probes do not cover or waive this additional build-transition case.

### BE15 audit source snapshot

Timestamp: `2026-09-15T08:48:50+00:00`. SHA-256 over file bytes.

| Path | SHA-256 |
| --- | --- |
| `apps/extension/lib/estimation/service.ts` | `a2fc299c0c849379d0381c0ffcfa77b45f9460a40c28c86780e996d85f5d9d94` |
| `apps/extension/lib/estimation/view-state.ts` | `ac9e5a910c49880a16c255bcfe087631c94f58ee7f0bebbe3330981a4065f0de` |
| `packages/ledger/src/estimation-contracts.ts` | `b4954ac9e45b0e918daa0cfb722666dd0da5c521a772dae089b442640af50f6a` |
| `packages/ledger/src/estimation-repository.ts` | `0ea40a88a8f9a7eed5c8ee138975350812c414218ff9dfb3cb928836f1584940` |
| `packages/ledger/src/local-selection.ts` | `f906680e8205008aef19f2eebfe5b802f30d843a542eb7600f66c40ed7875225` |
| `packages/ledger/src/memory-repository.ts` | `7418baee4c964d440d5f753f447493ce9d76dc7ea6fb75a7b8e6681b1507defb` |
| `packages/estimator/src/engines/methods.ts` | `f796fda485388479208dd620f727bcec1bc12020b0d3cff8f8698974b041b176` |
| `config/estimation.build.json` | `78a726b6aa2b91db054d4d42276d58fcb0d55bc3817c5e55acd6fe2c19000055` |

**Initial BE15 conclusion: FINDINGS.** The source snapshot above records EIR-08 before correction. The following independent recheck supersedes this initial result.

## Final EIR-08 correction recheck

**Bounded verdict: CLEAN for the requested BE15 integration cases.** The shared `initialOriginalView` predicate now requires a safe input count and either an empty member or a uniform saved original-method hash exactly matching the current Original target. Missing proof is conservative. `localViewState` applies it to the whole authorized vector, and the runner only skips work when that whole-vector predicate succeeds. Once any member requires work, all nonempty unmatched members can receive jobs; `ensureJob` no longer has the contradictory per-member shortcut.

Reran the unchanged eight-case independent script across IndexedDB and memory. The previously failing Eco-default to Original-default case now begins pending, invokes the executor once, publishes a recalculated Original result, reports zero pending inputs, and preserves original-envelope bytes. The reverse transition, unchanged Original optimization and explicit EcoLogits preference controls continue to pass. The follow-build-default preference remains revision 1; correctness does not depend on rewriting the user's choice.

Four additional independent cases exercised retained company eras: both repositories, with an archived EcoLogits original and either a current Original original or an empty current era. The archived executor was deliberately held after the current member had completed where applicable. The entire view stayed original/pending while work was held. Releasing it produced a completed selected Original view with two selected rows/two executor calls for two nonempty eras, or one row/one call for the empty-current case. Both original archives remained byte-identical and preference revision stayed 1. Results were inspected through each era's scoped `viewPage`, then combined for the assertion; `viewPage` itself is not a vector-wide listing. An initial assertion that treated the current-era page as the whole vector was corrected as a probe assumption, not reported as a product defect.

Independently ran:

```text
pnpm --filter @footprint/extension exec tsx --test test/build-default-transition.test.ts test/engine-service.test.ts test/monthly-engine-service.test.ts test/history-engine-service.test.ts
86 passed, 0 failed, 0 skipped.

pnpm --filter @footprint/extension exec tsc --noEmit
Exit 0.
```

The 86 tests include the independently authored 18-case transition suite, existing selection/publication tests, and monthly/history regressions. The transition suite additionally covers mixed Original/Eco inputs, empty and matching Original controls, and numeric-only unavailable admission for both target defaults. These tests overlap earlier evidence and are not summed with previous runs. This reviewer did not modify source or rerun the ledger migration/index certification; that remains separately owned.

### EIR-08 correction source snapshot

Timestamp: `2026-09-15T09:06:44+00:00`. SHA-256 over file bytes. Dependencies identify the inspected contract boundary, not a blanket ledger verdict.

| Path | SHA-256 |
| --- | --- |
| `apps/extension/lib/estimation/service.ts` | `009f7f6761a46544bde6b4d0bcab5c260788c3fd0c72339d378b2d963acf2173` |
| `apps/extension/lib/estimation/view-state.ts` | `69c913ba598b4263f9afb718c7b7e8b3393f0a255d1c7d80aaafb2832f42510c` |
| `packages/ledger/src/estimation-contracts.ts` | `442453ae9e606485fdac635cd931372d60bdce9ee1f31ba3f496460069d57ca5` |
| `packages/ledger/src/local-selection.ts` | `12286b45d90db877e110b20676084f91476cefddb1e65514eaa1f827d5543592` |
| `packages/ledger/src/estimation-repository.ts` | `c8ddba6881656bebf20aa7f4408a642b0722a34ee1653d18102b3529d87241e7` |
| `packages/ledger/src/memory-repository.ts` | `7418baee4c964d440d5f753f447493ce9d76dc7ea6fb75a7b8e6681b1507defb` |
| `apps/extension/test/build-default-transition.test.ts` | `6aab24d291e9711ee4c57cf2972c19467f7b49161afde4dd26ab21b9e1f1baa5` |
| `apps/extension/test/engine-service.test.ts` | `43471a279f68e0d1c14aa993bb27ba41056855f1877256e0dfb0b0382ba668be` |
| `apps/extension/test/monthly-engine-service.test.ts` | `6edd0c55141d4a973a28ac5df5148c8608699f560075e7c0be9859c1a7c79c65` |
| `apps/extension/test/history-engine-service.test.ts` | `0ade83c7d72c6e34b8f103b23e26e98f49a2efc32ab3c04fcdbf50430fabbe43` |

**Final bounded conclusion: CLEAN.** EIR-08 is verified corrected for the executed no-job build transition and retained-era cases. All eight reproduced integration findings now have correction evidence at their respective snapshots. This report does not certify ledger v14 migration/index behavior, concurrent AR05 changes, this reviewer's UI, full release readiness, native browsers, performance, PostgreSQL or distribution. Only this report was changed.
