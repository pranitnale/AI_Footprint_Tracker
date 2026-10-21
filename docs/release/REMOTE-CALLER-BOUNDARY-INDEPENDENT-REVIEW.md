# Independent dormant remote caller review

15 September 2026. **Final bounded verdict: CLEAN.** RCB-01 was independently reproduced, corrected by the production owner, and independently rechecked. The shared composition guard now rejects absent/non-local executor authority before invocation and rejects non-local or missing result origin afterward. Real canonical, explicit-dashboard, live and history callers pass the scoped checks below. No production remote endpoint or positive capability implementation is activated.

## Scope and independence

Reviewed `remote-executor-boundary.test.ts`, `remote-executor-fixture.ts`, their actual composition/execution callers, and the repository commit/view/publication/cache boundaries needed to evaluate the assertions. The test author and production owners are separate from this reviewer. Source remained read-only; only this report was written for this request. The reviewer's earlier provider-registry implementation and UI work are outside this verdict.

Requirements: RE01/RE02 require Personal/disconnected operation and absent remote capability to remain local; RE08 requires one contribution per observation/method/view; RE09 requires late selection/source/scope/erasure replies to fail the actual caller guards. The requested scope is dormant, fail-closed local authority. It does not implement or approve positively authorized remote persistence, authentication, a capability protocol, remote numerical accuracy, a new endpoint, native browsers or PostgreSQL.

All inputs and transports were synthetic. The actual local estimator generated comparison envelopes. IndexedDB was exercised through `fake-indexeddb`, including close/reopen of the named database in the same process. The memory repository retained in-process state; it is not durable-restart evidence. No real provider traffic, credentials or remote requests were used.

## RCB-01 [P1] Local execution restriction is bypassed by canonical and explicit-view callers

**Status: verified corrected.** The original dormant injection-boundary defect and its reproduction are retained below; they are not claims that the default release calls an active remote service.

`EngineService.runLocal` checks the executor's declared `executionOrigin` before reading job pages and rejects organization-origin results before committing. In contrast, `EngineService.original` calls the executor without either origin check. `Coordinator.estimateCanonical` obtains a saved input through `repository.estimation.liveInput`, then calls that method. The explicit EcoLogits `Coordinator.methodSelection` callback also calls the raw executor after resolving stored inputs, without the local-execution restriction. The runtime constructor accepts the injected executor but has no remote-capability authorization parameter.

The submitted fixture tests replace the canonical callback with `assert.fail` and exercise `maintainLocal`; they do not invoke actual Coordinator canonical reconciliation or explicit dashboard recalculation. Their local-job assertions pass but do not establish the broader caller restriction.

### Independent reproduction

For each IndexedDB/memory and Personal/company combination:

1. Use the submitted fixture's real repository/session setup and `seed` to save one genuine local Original envelope with numeric request/attempt observations.
2. Construct a real Coordinator over that repository, injecting the same `fakeRemote` helper into its estimation dependency. Do not supply any capability or enable a network endpoint. The fake transport counts calls and receives the actual observation input.
3. Await initialization and local maintenance. Remote calls remain zero, confirming the local-job guard works.
4. Call `coordinator.company.canonicalEstimation(currentScope, savedAttempt)` through the actual composed callback.
5. Call `coordinator.dashboard({ calculationView: "recalculated", methodId: methods.ecologits.method_id })` through the explicit selected-view path.

| Case, reproduced on both repositories | Observed result |
| --- | --- |
| Personal canonical reconciliation | One fake remote call receives the saved request and attempt; the valid organization-original reply later encounters `revision_conflict` |
| Company canonical reconciliation | Same result |
| Personal explicit EcoLogits dashboard | One fake remote call; returns one known estimate with `execution_origin: "organization"`, without an error |
| Company explicit EcoLogits dashboard | Same result |

The saved original remains byte-identical and local in all cases. The canonical conflict prevents replacement of that original; it does not undo delivery of saved inputs to the injected executor. The dashboard case establishes actual returned organization-origin data, not only an executor-call counter. Selecting an explicit method is not remote-execution authorization.

The valid fake reply uses the accepted method/view, calls the actual local estimator, changes only `execution_origin` to `organization`, validates the envelope, and returns the accepted correlation plus `payloadHash(envelope)`. For an original-view request it omits recalculation lineage flags. This detail matters: the submitted `fakeResponse` helper unconditionally adds `originalMethodMissing` when the accepted original hash is null, so it is only suitable for its existing recalculated fixtures. An initial canonical probe using it still proved input delivery but its invalid original response was caught as unavailable and the callback resolved. The stronger results in the table use a valid original-view response and accurately report the later conflict.

**Required correction:** apply one shared local execution boundary before invoking an executor with these observations and when admitting its response. Cover canonical reconciliation, live capture, historical imports and explicit recalculated views as well as maintenance. Missing declared origin must not infer local permission; a locally labeled executor returning organization-origin data must not be admitted. Retain genuine local replacements and numerical capture/unavailable behavior. Do not add a positive remote capability implementation or loosen the repository's local grants to make the tests pass.

The parent and test owner received the exact repro. Their subsequent shared execution correction and independent recheck are recorded below. This reviewer made no implementation changes.

## Verified narrower behavior

Independently executed:

```text
pnpm --filter @footprint/extension exec tsx --test test/remote-executor-boundary.test.ts
24 passed, 0 failed, 0 skipped (5.07 seconds).
```

The source and passing assertions establish:

- Default composed runtimes use the packaged local executor in Personal, disconnected and company fixtures. Their local maintenance makes zero product-network requests; absence of a capability does not select the dormant helper automatically.
- An explicitly injected organization executor receives zero calls from local recalculation jobs. A caller falsely declaring local execution but returning an organization-origin reply is rejected before result commit/promotion.
- Local-first, organization-first and concurrent exact alternatives admit one local result. Organization-origin commits reject, a repeated local result is a duplicate, promotion processes one input, and the selected summary contains one contribution after fake IndexedDB reopen.
- Held replies after selection, request/attempt revision, disconnect and erasure fail the actual commit/view/publication/cache guards. The fixture deliberately keeps the helper's `isCurrent` callback true, so this evidence comes from caller/storage checks rather than a tautological supplied-false guard.

### Additional independent stale-reply probes

Four additional cases, two per repository, held otherwise valid local and organization alternatives until after either a **request-only revision** or an **EcoLogits to Original to EcoLogits selection cycle**. The latter returns to the same method hash but advances the selection generation.

Before mutation, the captured source/calculation guard allowed a real summary cache write. After mutation:

| Mutation | Organization/local commit results | Publication/cache result |
| --- | --- | --- |
| Request revision only; attempt unchanged | `method_update_invalid` / `stale` | Calculation guard false, source guard false, late summary-cache write rejected |
| Selection changes away and back | `stale` / `stale` | Calculation guard false, late summary-cache write rejected |

`view.current()` rejected in all four cases. The rejected cache entry remained absent after reopening IndexedDB or retaining the memory state; no selected result was published, and original-envelope bytes remained unchanged. These additional cases confirm source dependency and selection-generation protection beyond a method-name comparison.

## Acceptance assessment

| Area | Bounded result |
| --- | --- |
| Default composition with no remote capability | PASS for exercised Personal/disconnected/company local-maintenance paths; no production helper construction was found in application source |
| Organization/missing execution authority across composed local callers | PASS after RCB-01 correction for canonical, explicit-dashboard, live and history paths; absent/unknown/non-local executor origin and foreign/missing result origin are denied |
| One stored local contribution, RE08 | PASS for the dormant local-job authority and exact alternatives; not approval of a positive remote persistence authority |
| Actual late commit/view/publication/cache guards, RE09 | PASS for the tested selection/revision/disconnect/erasure cases and independent request-only/selection-cycle probes |
| Helper retries, authentication, remote accuracy and endpoint readiness | Outside scope; helper contract has a separate independent report |
| Full release/native-browser/network-package acceptance | Outside scope |

The related `REMOTE-EXECUTOR-INDEPENDENT-REVIEW.md` was read for its declared boundary, not treated as proof of these callers. Its helper-only CLEAN verdict explicitly excluded eventual caller persistence and capability integration. This report does not rerun or re-certify that helper review.

## Source snapshot

The hashes below identify the inspected snapshot while owners continue implementing changes. Repository/helper files are dependencies inspected for these specific boundaries, not blanket independent approval of their complete implementations.

Snapshot timestamp: `2026-09-15T10:12:03+00:00`. SHA-256 over file bytes.

| Path | SHA-256 |
| --- | --- |
| `apps/extension/test/remote-executor-boundary.test.ts` | `c4d3159f4d8325b1932ef2e7c4183d6e1d65cd64322c1497dc69daab49f79d6f` |
| `apps/extension/test/remote-executor-fixture.ts` | `d42633827858ac91333877387b76bd476cee5b28d939f6c016c604cdd3179438` |
| `apps/extension/lib/runtime-composition.ts` | `2ac6a1edf79e1a6bd5718bcbac8a71000613aff6a290fd1c9dc5a79d1e553d49` |
| `apps/extension/lib/estimation/service.ts` | `009f7f6761a46544bde6b4d0bcab5c260788c3fd0c72339d378b2d963acf2173` |
| `apps/extension/lib/coordinator.ts` | `5d9d1fbfdba225eceb5a9cf1ae682e718a29346930bbef5b0470f320970c138e` |
| `apps/extension/lib/history-service.ts` | `303e04f842f5e16fd172b53934e5edd5cf108145bd0da79c9e8f3b201a842833` |
| `apps/extension/lib/summary-scan.ts` | `b625f9a8273c116eb134c7e08708ad642bf4ebba83f38cdda33fd0a3d62db622` |
| `apps/extension/lib/method-service.ts` | `b31b72604f94038e5189a88a05a4bc7acc85ac33dcc539cc4576e0f804e9cd07` |
| `packages/ledger/src/estimation-repository.ts` | `c8ddba6881656bebf20aa7f4408a642b0722a34ee1653d18102b3529d87241e7` |
| `packages/ledger/src/memory-estimation.ts` | `3a402f3db6a1b0c03fc1028ecf18446286c1c420e4f652d6cbae73e715359d9e` |
| `packages/ledger/src/estimation-storage.ts` | `6f8b8a5edbea5418a28ae30e77f0fd2eb7c48e93026275e40b82e524e98c5134` |
| `packages/ledger/src/memory-core.ts` | `0afda864940edf9d6020b881165421fd27d910af692fb5bd7a80feeefe32e921` |
| `packages/ledger/src/index.ts` | `8efddc2aecee8ce854cbbd9a632db7a885ee1738dedd1765e9af7a95343d7b79` |
| `packages/ledger/src/memory-repository.ts` | `7418baee4c964d440d5f753f447493ce9d76dc7ea6fb75a7b8e6681b1507defb` |
| `packages/estimator/src/engines/remote-admission.ts` | `dc52b22a9d1670702028317964e1ddc17ce4f5b45d43e6654c1a71ee318d897d` |
| `docs/release/REMOTE-EXECUTOR-INDEPENDENT-REVIEW.md` | `fc59c748dacdbb07b4447cda6b42889636da0ae8ae27a2c8869bcbeb3163c1d6` |

**Initial conclusion: FINDINGS.** The 24-test suite did not cover RCB-01. The following correction evidence supersedes this initial verdict while preserving the original source snapshot.

## Final RCB-01 correction recheck

The production change is a shared `localApplicationExecutor` wrapper in `runtime-composition.ts`. Every composed service receives it. Each invocation requires the underlying executor to declare literal `local` before the input is passed in, and the returned result must declare literal `local` as its execution origin. Violations throw typed `EstimationFailure("method_update_invalid")`; no alternate executor or fallback is selected. Its origin getter preserves the existing `runLocal` rejection before job input reads. The actual canonical and explicit-view paths therefore use the same restriction as live/history calls.

A local declaration remains a trusted injected-code contract, not a JavaScript sandbox or proof that arbitrary implementation code never performs network I/O. The scope is consistent fail-closed authority and result admission at the current application boundary. It does not grant remote capability or approve future remote persistence.

### Unchanged failure paths

Repeated the original valid-response transport reproducer on both repositories and Personal/company modes. In all four combinations:

- Initialization and local maintenance made zero fake remote calls.
- Actual canonical reconciliation made zero fake remote calls and recorded explicit unavailable health while retaining the saved local original bytes.
- Actual explicit EcoLogits dashboard recalculation rejected with `method_update_invalid`, made zero fake remote calls and returned no organization estimate.

The stronger original-view response fixture remains valid if called; rejection no longer depends on a serialization/lineage failure or the original archive's later conflict.

### Independent local-control and numerical-preservation probes

Two additional real-Coordinator cases, one per repository, verified genuine local substitution first: canonical reconciliation retained its original, and explicit EcoLogits dashboard returned one known local estimate. A locally declared executor that returned an organization-origin result was then rejected by the output guard.

After removing the executor's origin declaration **after construction**, later canonical, live and history calls made zero further executor invocations. Live capture still saved a new request/attempt with 27 counted input tokens; imported history saved two numerically counted rows. New environmental original results remained absent, and the pre-existing original stayed byte-identical. Personal network calls were zero. This verifies checks occur on actual calls rather than only accepting construction-time metadata, without mistaking failed environmental estimation for failed numerical recording.

### Focused regression evidence

Independently ran:

```text
pnpm --filter @footprint/extension exec tsx --test test/remote-executor-boundary.test.ts test/remote-executor-callers.test.ts test/runtime-composition.test.ts
62 passed, 0 failed, 0 skipped (3.32 seconds).

pnpm --filter @footprint/extension exec tsc --noEmit
Exit 0.
```

The 62 cases contain the original 24 maintenance/storage/publication cases, 36 actual caller cases, and two composition regressions. The 36-case matrix covers IndexedDB/memory, Personal/disconnected/company, and organization/missing/unknown executor origin, organization/missing result origin, and a genuine local substitute. Each exercises actual canonical, explicit dashboard, live capture and history import calls with preserved numerical evidence. Company summary/history reads use only the injected failing transport; they are not remote-estimation calls. No native browser or real server is exercised.

The earlier held-alternative tests still pass after the correction: organization results cannot replace or add to the single local job contribution, and late selection/revision/disconnect/erasure results fail commit/view/publication/cache guards. Reopened fake IndexedDB retains the permitted local result or absence of a rejected cache entry. The earlier independent request-only revision and selection-cycle probes remain recorded above. Overlapping test runs are not summed.

The test owner also corrected `fakeResponse` so original-view requests omit recalculation-only missing-lineage flags. Genuine local compatibility now asserts wrapper behavior rather than requiring the injected executor object itself to be stored unchanged. No other positive remote authority was added.

## Final correction snapshot

This snapshot identifies the shared correction and its exercised caller dependencies. It does not extend the verdict to unrelated code in the same files, the full ledger implementation, release packaging or the reviewer's provider-registry/UI work.

Snapshot timestamp: `2026-09-15T10:23:49+00:00`. SHA-256 over file bytes.

| Path | SHA-256 |
| --- | --- |
| `apps/extension/lib/runtime-composition.ts` | `9a2aba1e86f6c939c658c6402abe426a34dead3e0670684c979b43a183a09990` |
| `apps/extension/test/remote-executor-callers.test.ts` | `ff7258fe840ddba26faad4ea12d230fca7ad926141be6984623ec191ae0ca8c4` |
| `apps/extension/test/remote-executor-fixture.ts` | `30e8601b29051facd256cd3707aca526c0dc36abf449b34d3fad5c5fbb02ce4d` |
| `apps/extension/test/remote-executor-boundary.test.ts` | `c4d3159f4d8325b1932ef2e7c4183d6e1d65cd64322c1497dc69daab49f79d6f` |
| `apps/extension/test/runtime-composition.test.ts` | `5bd4025aa66fa2a1d64fa24dd4fa60a480b7dd437b5509aba2563ad4f358ffca` |
| `apps/extension/lib/estimation/service.ts` | `009f7f6761a46544bde6b4d0bcab5c260788c3fd0c72339d378b2d963acf2173` |
| `apps/extension/lib/coordinator.ts` | `5d9d1fbfdba225eceb5a9cf1ae682e718a29346930bbef5b0470f320970c138e` |
| `apps/extension/lib/history-service.ts` | `303e04f842f5e16fd172b53934e5edd5cf108145bd0da79c9e8f3b201a842833` |
| `packages/ledger/src/estimation-repository.ts` | `c8ddba6881656bebf20aa7f4408a642b0722a34ee1653d18102b3529d87241e7` |
| `packages/ledger/src/memory-estimation.ts` | `3a402f3db6a1b0c03fc1028ecf18446286c1c420e4f652d6cbae73e715359d9e` |
| `packages/estimator/src/engines/remote-admission.ts` | `dc52b22a9d1670702028317964e1ddc17ce4f5b45d43e6654c1a71ee318d897d` |

**Final bounded conclusion: CLEAN.** RCB-01 is verified corrected. The current composed callers preserve dormant local authority, one permitted local contribution, numerical recording and the exercised late-result guards. Positively authorized remote execution/persistence, capability/authentication design, real network/browser behavior and full release readiness remain outside this verdict. Only this report was changed by this reviewer.
