# Extension estimation boundary

This directory connects numerical observations to calculation implementations. The pure equations and model catalog belong to `packages/estimator` and `packages/ecologits-core`. Browser capture, token counting, IndexedDB transactions and organization authentication have separate owners.

`config.ts` creates the immutable packaged method registry from the developer build configuration and consumer-to-API mapping overlay. The release build supplies the default engine at compile time. Both local engines remain available to the Advanced setting. An imported EcoLogits catalog cannot overwrite the product's mappings or fallback choices.

`EngineService` owns installation preferences, admission, local recalculation and synchronization of the installation's organization selection. Its dependencies are a typed estimation repository, an executor, the method registry and a scope-authority provider. The optional organization function only exchanges selection metadata. It is not a per-request calculation endpoint.

`../runtime-composition.ts` selects the concrete application services. `Coordinator` accepts an optional paired method registry/executor and an organization session implementation. The same injected executor reaches live capture, historical imports, canonical reconciliation and selected recalculation; explicit method lookup uses that registry. Defaults remain the packaged local engines and authenticated company client. The organization session's public structural contract allows an in-memory implementation without constructing an HTTP client. The `runtime-composition` regression exercises these paths with a deterministic unavailable executor and verifies numeric preservation without a hidden formula fallback.

Application services consume named `ApplicationRepository` capabilities. The IndexedDB adapter preserves atomic capture/checkpoint/original/outbox writes; an independent memory implementation exercises the same domain contracts and application flows. The production background constructs `Ledger.application`, while the compatibility provider keeps existing callers usable. The module dependency check rejects concrete database classes and raw table operations in application services. Native persistence, quota, process-restart and performance evidence remain separate release checks.

`../monthly-summary.ts` uses the completed selected view for both Personal and company My usage. Pending calculations do not claim a month. Its atomic claim checks the selection/data/erasure token, scope and time zone before consuming the once-per-month marker. Original inspection and the standalone legacy monthly helper remain separate from the production default.

The main entrypoints are:

- `admission()` resolves the method for a newly observed family. Store its ID/hash before token counting can yield. Progress, refinements and restarts retain that admitted identity.
- `original()` validates the numerical input, executes the admitted method and checks its pinned hash. A missing implementation produces an explicit unavailable outcome so an otherwise valid observation can still be stored. It does not choose another method to conceal a failure.
- `liveInput()` resolves a request alias through trusted repository data. An alias hash supplied by a caller is not authorization.
- `select()` applies an explicit preference with a revision check. It schedules recalculation without rewriting observations or original results.
- `maintainLocal()` processes bounded pages and persists progress. `maintainOrganization()` is a separate coalesced operation, so an organization response does not hold up local calculation.
- `view()` selects a completed default view and supplies a publication guard. Callers must preserve the distinction between original inspection, a completed selected view and pending work. They must check selection, source and erasure authority at the final publication boundary, including after subsequent history or network reads.

An unchanged first installation using the Original build default can display saved originals without first creating a redundant recalculation job. A changed selected method requires a new complete view. Calculated results retain the requested and effective methods separately when a configured unknown-model policy uses the Original engine.

Storage validates observation dependencies, method identities, fallback identity and job generation again when accepting results. Calculation publication has a separate version from observation/capture state. A formula change must not clear a provider's recorded-page coverage or masquerade as a deletion.

The future remote executor in `packages/estimator/src/engines/remote-admission.ts` is not activated here. Its `executionOrigin` is trusted composition metadata, not authentication. Local read grants must never be treated as permission to upload observations or use remote execution. Personal operation remains local.

See the [implementation plan](../../../../docs/implementation/MODULAR-EXTENSION-ECOLOGITS-PLAN.md), [acceptance matrix](../../../../docs/implementation/MODULAR-EXTENSION-ECOLOGITS-ACCEPTANCE.md) and [current verification record](../../../../docs/release/MODULAR-REFINEMENT-STATUS.md) for the remaining work and independent release evidence. Passing an executor test establishes software behavior, not the physical accuracy of a provider's footprint or native browser performance.
