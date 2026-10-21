# Browser extension

The extension uses TypeScript, WXT, React and IndexedDB. It observes the supported consumer websites, counts available text locally, saves numerical observations and calculates scoped resource estimates. Personal mode needs no account or estimation network service. Python is a development oracle and an organization-server dependency, not an extension runtime.

## Timing and revisited conversations

Current numerical observations and imported history use schema `2.0.0`. IndexedDB version 15 resets obsolete pre-production usage data and derived results instead of migrating old observation schemas. Authentication, settings and deletion protection are retained. This reset was explicitly authorized by the owner for testing.

Live capture uses a monotonic timer from dispatch to a verified provider completion receipt. EcoLogits receives valid live timing first, the matching historical provider span second, and null when neither is usable. Historical spans are labeled as ChatGPT provider-message, Claude generated-content or Perplexity workflow evidence. Gemini's unverified duration remains null. These are estimation inputs, not measurements of provider hardware energy.

Verified response identities link live and saved copies of the same response. Current calculations can recover a fuller compatible visible-token count from saved history while retaining live timing. A provider-reported output total keeps its separate scope. Reopening a conversation does not add a second contribution for a proven match; retries and ambiguous identities remain distinct. Numerical observations and original estimates stay immutable within the current schema.

The [implementation and acceptance plan](../../docs/implementation/TIMING-AND-RECONCILIATION-PLAN.md) tracks this change. The [sanitized browser evidence](../../output/research/live-history-identity-2026-09-15.json) records field relationships verified on the four websites. Native installed-extension checks remain a separate pending gate.

Read the [implementation contracts](../../docs/implementation/CONTRACTS.md) and [modular plan](../../docs/implementation/MODULAR-EXTENSION-ECOLOGITS-PLAN.md) before changing behavior. The [verification record](../../docs/release/MODULAR-REFINEMENT-STATUS.md) distinguishes component checks from installed-browser and production release evidence.

## Module boundaries

| Responsibility                 | Main entry points                                                             | Replacement contract                                                                                                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider interpretation        | `packages/adapters`, `lib/capture-runtime.ts`                                 | A packaged provider registry supplies route recognition, dispatch parsing and fresh protocol sessions. Canonical capture validation and configured browser permissions still apply. |
| Tracking and lifecycle         | `lib/coordinator.ts`, `lib/history-service.ts`, `lib/recorded-threads.ts`     | Coordinates capture, counting, admission and guarded publication. It does not implement either scientific formula.                                                                  |
| Text and private-file counting | `lib/counting-config.ts`, `packages/tokenizers`, `packages/file-text`         | A trusted `CountingRuntime` binds implementation, profile and asset metadata. Job/revision identity and cancellation cross worker boundaries.                                       |
| Calculation selection and jobs | `lib/estimation/service.ts`, `lib/estimation/view-state.ts`                   | `MethodRegistry` and asynchronous `EstimateExecutor`, with immutable method/input identities and bounded resumable local jobs.                                                      |
| Scientific calculations        | `packages/estimator`, `packages/ecologits-core`                               | The preserved Original engine and independent EcoLogits text/video port. The product adapter chooses admissible inputs and presents the operational phase.                          |
| Local persistence              | `packages/ledger`                                                             | Explicit `ApplicationRepository` domain operations, an IndexedDB adapter and an independent memory implementation for substitution tests.                                           |
| Organization connection        | `lib/company.ts`, `lib/method-service.ts`                                     | A structural `CompanySession`, scoped credentials, capability checks and the existing numerical synchronization protocol.                                                           |
| Dashboard and summaries        | `lib/dashboard`, `lib/queries.ts`, `lib/monthly-summary.ts`                   | Validated action/response DTOs and shared presentation helpers. Screens do not read database stores or duplicate formulas.                                                          |
| Browser-specific hosts         | `entrypoints/background.ts`, `lib/platform.ts`, worker/offscreen entry points | Packaged Chromium and Firefox hosts implement the same counting and application contracts.                                                                                          |

`lib/runtime-composition.ts` chooses concrete services. The Coordinator receives an `ApplicationRepository` or compatible repository source; its dependency options can supply a counting runtime, organization session and a paired method registry/executor. Normal production construction passes `Ledger.application`. Tests can exercise the same services with `createMemoryRepository()` without an IndexedDB simulation.

The pipeline is provider observation, validated capture, local counting, numerical observation, pinned calculation, atomic storage and guarded presentation. Expensive counting runs outside the page UI thread. Transient text and file bytes are not persistence or organization-upload DTOs. Counting accuracy and scientific model uncertainty remain separate.

Page, UI and background metadata consumers use `@footprint/tokenizers/metadata` and `lib/counting-config.ts`. Counting/file workers use `@footprint/tokenizers/worker` and `lib/counting-worker-config.ts`. Keep the manifest and worker implementation consistent when replacing a tokenizer. Source and build checks reject counting implementations or encoder dictionaries in main-context bundles; declarations of profile IDs and asset hashes do not require loading those dictionaries.

## Changing one module

- Replace a provider through the packaged adapter registry and its fixtures. Keep native requests, stream controls, snapshot replacement, identity and permission behavior intact. New routes or observation fields need explicit coverage and contract review.
- Replace a tokenizer through the trusted counting configuration. Carry its implementation/profile/asset identity through live, history and private-file paths. Stored numerical history cannot be retokenized without the original text, which the application does not retain.
- Change calculation data through a versioned method definition. An equation change belongs in its engine implementation and corresponding reference tests. UI, provider and storage code consume the result contract rather than the equation.
- Replace storage by implementing the domain ports and running the shared repository and actual consumer tests. Atomic observation/result/outbox writes, erasure and final publication checks are part of the contract, not optional backend details.
- Replace organization transport/session behavior at composition. Personal data is not backfilled after connection, and local read authority is not permission for capture, upload or remote execution.

These boundaries limit the effect of ordinary changes. A new scientific input, provider observation or result quantity can legitimately require a versioned shared schema and caller changes; it must not be hidden inside an existing field.

## Choosing the calculation

[`config/estimation.build.json`](../../config/estimation.build.json) sets the developer default, available engines and explicit fallback policy. EcoLogits is the default and only selectable product engine. The Original implementation remains in source for archived research and saved-record compatibility. [`config/estimation.mappings.json`](../../config/estimation.mappings.json) keeps consumer-to-upstream assumptions separate from the imported catalog.

The dashboard's Advanced settings uses EcoLogits. An existing Original preference migrates to the EcoLogits build default with a new selection revision. See the [Original method research archive](../../docs/research/archive/original-method/README.md). This does not rewrite observations or stored results, or synchronize settings across other browser profiles.

An effective method change schedules recalculation of saved numerical observations. Originals remain available for inspection. The recalculated view becomes the default only after the authorized population is complete; pending or unavailable results stay explicit. Existing original-versus-recalculated inspection is separate from the engine preference. Captures already admitted retain their pinned method.

EcoLogits headline carbon includes operations only. Full upstream usage, embodied and total results remain in the engine envelope with their units, uncertainty and source identity. Missing models use the reviewed provider flagship, explicit benchmark proxy or unavailable policy. Requested model, proxy and effective engine stay distinct. Video arithmetic is ported, but video observation capture is not activated.

## Upstream updates and future organization execution

Use the staged update, verify and adopt workflow in [`ECOLOGITS-UPSTREAM-MAINTENANCE.md`](../../docs/implementation/ECOLOGITS-UPSTREAM-MAINTENANCE.md). Catalog-compatible updates should not require handwritten estimator, UI or storage changes. Changed formulas, schemas, defaults or rights require review and the appropriate port/contract changes. Ordinary extension builds use pinned local artifacts and do not poll GitHub or PyPI.

[`tools/refinement`](../../tools/refinement/README.md) provides the offline comparison command with separate native-policy and controlled-input results. These developer reports do not change user settings or introduce a production comparison screen.

The existing organization backend uses native Python internally for accepted numerical ingestion and recalculation. A dormant remote executor helper has an injected transport for contract tests. Production composition still uses local estimation. A future remote endpoint needs its own authenticated capability/disclosure checks and publication authority; current local-only grants cannot authorize it.

## Verification and builds

Run from the repository root after installing the pinned dependencies described in the [root README](../../README.md):

```text
pnpm --filter @footprint/extension typecheck
pnpm --filter @footprint/extension test
pnpm test:verification
pnpm test:refinement
pnpm test:ecologits-maintenance
```

`pnpm check` includes the wider repository and release checks. Each module also owns focused tests. Passing Node, React/JSDOM, memory or fake-IndexedDB tests does not establish native browser permissions, lifecycle, accessibility, CPU/RAM or provider compatibility.

All development and release commands use exactly three unpacked directories: `.output/chrome-mv3`, `.output/edge-mv3` and `.output/firefox-mv2`. Every browser uses EcoLogits. `pnpm package:browsers` rebuilds these same folders and produces one public ZIP per browser plus corresponding source and notices; `pnpm verify:source-archive` verifies reconstruction. Engine-suffixed folders are retired. See [release evidence and native installation handoff](RELEASE-EVIDENCE.md). Building or packaging does not publish anything.

## EcoLogits credit and source

The EcoLogits core is an independent TypeScript port under MPL-2.0. Preserve its [license](../../packages/ecologits-core/LICENSE), [notice](../../packages/ecologits-core/NOTICE.md), [citation](../../packages/ecologits-core/CITATION.cff), retained source and modification inventory. Original project code and other dependencies retain their separate licenses. Packaged About/Licenses links expose the matching modified source archive through an extension-private route. An upstream-only link does not replace that corresponding-source obligation.
