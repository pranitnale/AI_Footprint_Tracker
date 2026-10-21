# Architecture and replaceable modules

14 September 2026. Source inspection of the working tree based on commit `15515fd`, including existing uncommitted changes. This is an architectural assessment, not implementation authorization, an effort estimate, or a release/performance certification. No product source was changed by this assessment. Line references describe the inspected snapshot and may move.

## Finding

The application is already modular at the workspace-package level. Capture parsing, provider adapters, tokenizers, file extraction, estimation, numerical contracts, local storage and shared UI have separate packages. It does not need a new framework, new database, microservices or a complete rewrite to support replaceable components.

The largest gap is at the application-service level. A few broad classes and entrypoints coordinate many responsibilities and expose concrete implementations, raw store names and loosely typed messages to their callers. Changing a calculation implementation or organization workflow can therefore involve several paths despite the existing package boundaries.

The recommended change is to strengthen these boundaries incrementally: keep the packages, introduce narrow contracts at the points of substitution, and split broad application modules by responsibility while preserving transaction and privacy invariants.

## What exists now

| Responsibility | Actual location and technology | Assessment |
| --- | --- | --- |
| Browser packaging and startup | `apps/extension`, WXT, TypeScript, browser-specific manifests | Keep. Chrome/Edge and Firefox already have distinct build/runtime handling. |
| In-page network observation | `apps/extension/lib/capture-runtime.ts`, `entrypoints/capture.content.ts` | Capture runtime installs observation hooks and delegates protocol parsing. It still contains browser/site lifecycle decisions. |
| Protocol decoding and common route identities | `packages/capture-core` | Good separation from storage, estimates and organization networking. |
| Provider parsing | `packages/adapters`, with ChatGPT, Claude, Gemini, Perplexity and history submodules | Good foundation. `ProtocolSession` produces a shared snapshot shape. Some host-specific behavior also lives in extension capture, upload, route and placement files. |
| Text token counting | `packages/tokenizers`, `gpt-tokenizer`, dedicated worker | Already independently callable through `countText`. Two bundled reference encodings are supported. Current `modelId` does not automatically select a validated model-specific tokenizer. |
| File extraction and counting | `packages/file-text`, PDF.js, XML/ZIP parsers, dedicated worker | Already separate and bounded. Internally, extraction calls the concrete tokenizer directly. Raw bytes and extracted text stay in the worker. |
| Estimation | `packages/estimator`, TypeScript and `decimal.js` | Separate equation modules and data bundles already exist. Current engine is a project-owned operational reference implementation, not the complete upstream EcoLogits library port. |
| Local persistence | `packages/ledger`, IndexedDB | One consistent storage boundary with atomic record/outbox/derived-data operations. Its public surface and implementation are broad. |
| Organization connection and synchronization | `apps/extension/lib/company.ts` and supporting history/method services | Separate from mathematical packages, but enrollment, credentials, policy, HTTP, queues, reconciliation and deletion are combined. |
| Display and summaries | Extension React `App.tsx`, injected page UI, local/server summary modules; shared `packages/ui` | Reusable components and formatting exist. Transport, validation, loading, state and presentation remain mixed in broad files. |
| Organization backend | `apps/server`, Python/FastAPI, Pydantic, SQLAlchemy, PostgreSQL deployment | Already separate from the extension. Specialized modules exist, but `Service` still owns registration, authentication, enrollment and broad endpoint dispatch. |
| Web application | `apps/web`, React/TypeScript/Vite | Separate public/member/admin/operator application. Does not require a framework replacement for this proposal. |
| Shared numerical contracts | `packages/contracts`, Zod, generated JSON Schema, Python validation | Strong existing foundation. Keep schema versioning, strict validation, provenance and unknown-value semantics. |

## Actual runtime flow

1. Page capture observes supported traffic and the provider adapter interprets dispatches and stream/history data.
2. An isolated content script validates and relays relevant messages to the extension background.
3. `Coordinator` resolves identities, scope, request/attempt state, model labels and revisions. It sends transient text to the counting host.
4. Chrome/Edge use an offscreen document hosting workers. Firefox uses its background worker host. `countText` returns numeric measurements plus profile and evidence metadata.
5. The coordinator assembles numerical observations, derives context information, calls `estimateAttempt`, and commits observations, estimates and related metadata through the ledger.
6. Local summaries feed the page bar and extension dashboard. For eligible organization records, synchronization sends the numerical observations to the organization API.
7. The Python server validates and recomputes estimates using its project-owned Python reference before supplying organization views.

History is a parallel observation path with different evidence and deduplication semantics. `HistoryService` counts loaded historical messages, calls `estimateHistoricalText`, stores them through `commitHistory`, and manages its own upload flow. It should not be forced into live-execution semantics merely to remove code duplication.

Evidence: [coordinator](../../apps/extension/lib/coordinator.ts), [platform](../../apps/extension/lib/platform.ts), [count host](../../apps/extension/lib/count-host.ts), [history service](../../apps/extension/lib/history-service.ts), [company client](../../apps/extension/lib/company.ts), [server method adapter](../../apps/server/aift/method_registry.py).

## Boundaries that should change

### 1. Give estimation one application interface

`Coordinator` injects counting and some browser operations, but directly imports `estimateAttempt` and constructs concrete company, history and method services in its constructor. Estimation is also called directly during company reconciliation, historical ingestion and method recalculation.

Relevant locations in the inspected snapshot:

- `coordinator.ts:219`: partial dependency injection and construction of concrete services.
- `coordinator.ts:1402`: live estimation inside the persistence workflow.
- `company.ts:983`: estimation during reconciliation of a canonical server record.
- `history-service.ts:299`: historical estimation during storage preparation.
- `method-service.ts:579`: recalculation using a selected bundle.

Introduce a narrow estimation service passed to these consumers. It should expose distinct live and historical operations where their inputs and coverage differ, while sharing the same mathematical core. Resolve method versions and profiles explicitly. Retain the current numerical result contract through an adapter so the UI, ledger and transport need not understand EcoLogits' internal result objects.

There is a concrete result-contract extension to plan before exposing full upstream results: the current `Metric` type in `packages/estimator/src/index.ts:31` permits a scalar/null `value`, but types both `scenario_low` and `scenario_high` as `null`. It cannot directly represent EcoLogits' nontrivial ranges. Define and version the intended range/uncertainty representation and update affected storage readers, aggregation, Python validation and presentation deliberately. Do not flatten a range to its mean merely to preserve the old shape, and do not relabel an upstream approximation interval as a coherent scenario range or confidence interval. Existing scalar historical records must remain readable. An engine-only replacement can preserve the current contract only for the result semantics that it already represents.

Inside `packages/estimator`, separate:

- The faithful, version-pinned EcoLogits calculation port.
- Model and environmental profile selection, including the comparable-model fallback policy.
- Product scope selection, such as operational-only headlines and unresolved water boundaries.
- The result adapter that attaches record identity, revision, provenance and historical lineage.

The current `estimateAttempt` combines these concerns. Its current implementation evaluates the approved reference cohort and selects the highest electricity candidate; a recognized model name is not automatically assigned a calibrated model profile. A new upstream port must be introduced as a versioned engine rather than silently changing historical results.

### 2. Split extraction, token counting and observation assembly

Keep these as separate responsibilities even if they are presented as one feature to the user:

- Provider adapters extract observed content and execution evidence.
- A tokenizer profile resolves which counting implementation/assets to use.
- Token counting returns scoped numeric measurements and uncertainty.
- An observation assembler owns request/attempt identity, revisions, branches, retries, interrupted generations, and the distinction between observed and reconstructed context.

Most observation assembly currently lives in `Coordinator.process`, starting at `coordinator.ts:916`. Extract that behavior into focused services/pure transformations. The application coordinator should sequence work rather than own every transformation, upload association, context update and display refresh.

`countText` already has a useful interface. Its profile table and loader are hardcoded to two `gpt-tokenizer` encodings. Introduce a small registry of packaged tokenizer implementations rather than a general plugin framework. Maintain strict profile/evidence validation and bounded loading. The multi-field worker transport should also carry an explicit profile selection, rather than relying only on the tokenizer's default.

The file extraction package can accept a tokenizer interface so it follows the same selection contract. Keep extraction and counting together inside the private worker at runtime; do not expose document text to storage or transport just to achieve conceptual separation.

### 3. Separate organization session, transport and synchronization

`CompanyClient` currently owns enrollment, credential refresh, disconnection, policy refresh, authorized HTTP, live record batching, thread links, acknowledgement reconciliation and deletion propagation. It also owns callbacks to history and method maintenance.

Split it internally into narrow components:

- Organization enrollment and session lifecycle.
- Authenticated transport with common response/error validation.
- Outbox synchronization and acknowledgement handling.
- Reconciliation, using the estimation interface when a canonical record changes.
- Deletion/retention synchronization.

History uploads and method downloads should use the session/transport interfaces instead of depending on the entire concrete company client. Keep live and historical policies distinct. Personal mode must continue to function with no organization network traffic.

### 4. Narrow the storage API without breaking atomicity

The ledger is already a valuable module. It should remain the owner of IndexedDB, migrations, recovery and transactional consistency. However, its single implementation is roughly 3,400 lines and exposes generic `get`, `put`, `list`, `all` and store names alongside domain operations. Services can therefore become dependent on database layout.

Provide focused interfaces for numerical observations, estimates, history, settings/ownership, outbox, method catalogs and erasure markers. Split internal implementation files accordingly. Move usage decisions into application services where possible, while the storage layer continues enforcing the invariants required at commit time.

Do not split this into independent databases or independently committed saves. `Ledger.commit` currently makes records, outbox entries, estimates/metadata and invalidation cooperate within a transaction. Refactoring must retain atomic observation/outbox writes, scope/erasure guards, stale-revision handling and deletion protection.

### 5. Introduce shared typed extension-message contracts

Stored numerical observations have strict schemas, but some application boundaries remain loosely typed:

- `Coordinator.dependencies.count` returns `Promise<any>`.
- `CountHost.count` and `platform.countLocally` return `Promise<any>` despite the tokenizer package defining a result type.
- `App.tsx:211` defines transport using an arbitrary action string and caller-selected generic response type.
- `App.tsx:226` sends the message and casts the result to that response type.
- Background actions are separately dispatched by string, with manual validation in various handlers.

Create a shared action-to-request/response map and runtime schemas. Validate worker results and browser message payloads at the boundary. Preserve existing sender/origin/frame/permission checks; TypeScript types do not replace those checks. Keep transient text-bearing internal messages separate from the numeric-only persistence/API schemas.

### 6. Consolidate model-related configuration without conflating capabilities

Model information currently appears in several places:

- Allowed IDs in `packages/contracts/src/model-ids.ts`.
- Observed protocol aliases in `apps/extension/lib/models.ts`.
- Context-capacity assumptions in `apps/extension/lib/context.ts`.
- Tokenizer profile IDs in contracts and tokenizer implementation tables.
- Estimation profiles and environmental settings in method bundles.

Use a versioned source catalog with separate references for identity/aliases, tokenizer profile, estimation profile and context-capacity evidence. Generate duplicated allowed-ID tables where appropriate. Recognition, tokenizer exactness, estimated model architecture and context-capacity assumptions must remain independently qualified.

Keep archived schemas immutable. A catalog update must respect compatibility with enrolled servers and existing records. Do not simply accept arbitrary provider strings into numerical telemetry to avoid schema work.

### 7. Separate UI data access and presentation

`App.tsx` is roughly 2,500 lines and combines transport, response validation, loading/retry state, connection dialogs, settings, history, summaries and display components. The in-page content entrypoint is roughly 2,400 lines and combines message relaying, route/history lifecycle, placement, health and presentation.

Extract a typed extension client, query/state hooks, presentation models and feature components. Use the existing shared UI and formatting packages. Split the content entrypoint into capture/message admission, navigation lifecycle and display mounting/controllers. Keep provider-specific placement in site-aware adapters and preserve saved design anchors and host noninterference.

Source length is a sign of concentrated responsibilities, not proof of a defect. The reason to split is to make each change have a clear owner and explicit inputs, not to meet an arbitrary line limit.

## Target structure

This is a proposed responsibility structure, not a list of existing new files:

```text
Browser startup/composition
  Browser platform + worker lifecycle
  Tracking and observation services
    Provider extraction adapters
    Private file extraction
    Tokenizer profile selection + counting engines
    Numerical observation/revision assembly
  Estimation service
    EcoLogits TypeScript core
    Versioned model/environment profiles
    Product scope/result adapter
  Local storage interfaces
    One transactional IndexedDB implementation
  Organization services
    Enrollment/session + authenticated transport
    Live/history outboxes + reconciliation + deletion
  Query/presentation services
    Local and organization views + React/in-page components

Shared: typed contracts, evidence metadata, health, versioning
```

These responsibilities can mostly live inside the existing packages and extension directories. A new npm package, operating-system process or generic event bus is not needed for each component. Keep explicit calls and narrowly scoped invalidation notifications.

## Backend and verification implications

The FastAPI backend and PostgreSQL can remain. The broad server `Service` can later be split into authentication/enrollment, ingestion, member/admin and operator services without changing the public API merely for file organization.

The existing estimator tests compare TypeScript with `packages/estimator/python/footprint_estimator.py`, the project's own Python reference. This is valuable parity coverage but is not by itself direct differential verification against the upstream EcoLogits package. Add a pinned upstream Python oracle for the faithful port and keep product-wrapper expectations separate. Preserve tests for intentional scope and factor differences.

Decide the backend calculation implementation explicitly when introducing the new engine: an upstream Python adapter can serve as the server implementation and verification reference, or another deliberate shared-engine arrangement can be chosen. A TypeScript port in the extension alone does not remove the existing Python implementation. Preserve matching versioned inputs and results across both runtimes and retain old methods for replay.

Existing package tests, coordinator tests, company/ledger tests and browser-double integration tests provide a useful refactoring safety net. Add narrow interface/contract tests and package dependency rules. I did not find a dedicated repository-wide import-layer enforcement gate in the inspected configuration/tests; some existing tests enforce particular import allowlists. Keep the different purposes separate.

## Recommended sequence

1. Record current observable behavior and freeze public record/result formats. Define typed worker, estimator, storage and organization interfaces.
2. Add a composition root that constructs and injects the concrete services. Route live estimates, historical estimates, server reconciliation and recalculation through the estimation interface.
3. Split coordinator, company and ledger responsibilities behind those interfaces while retaining their existing behavior and transactional guards.
4. Add the upstream EcoLogits TypeScript port as a separately versioned implementation. Verify it against upstream Python using identical assumptions and inputs; adapt its results to the existing product boundary.
5. Consolidate model/profile configuration and make tokenizer implementations replaceable behind the current counting interface.
6. Separate UI clients/state/presentation and finish provider-specific capture/placement boundaries where they currently spread into entrypoints.
7. Repeat relevant integration and real-browser checks as each boundary changes. Framework/file organization changes do not establish browser compatibility or performance.

## What future changes should affect

| Desired change | Intended change boundary | Legitimate additional work |
| --- | --- | --- |
| Replace a tokenizer | Tokenizer implementation, packaged assets and profile binding | Counting fixtures, asset notices and any explicit new profile/schema compatibility |
| Correct a provider stream parser | That provider's adapter and observation fixtures | Capture admission changes only if the observed message shape changes |
| Update EcoLogits equations | Versioned calculation core and upstream comparison fixtures | New method version and numerical-result compatibility review |
| Add a recognized model | Catalog/aliases and separately evidenced profile bindings | Generated schemas and server compatibility where allowed IDs change |
| Change local persistence internals | Ledger implementation/repositories | Migrations, crash recovery, erasure and atomicity verification |
| Change organization authentication | Enrollment/session/transport and matching server endpoints | Consent, credential migration and UI flow changes where behavior changes |
| Change a dashboard layout | Presentation components/view models | Accessibility, formatting and host-placement tests |
| Add a genuinely new metric | A deliberate contract extension | Estimator, storage, aggregation, backend and UI all need to understand its meaning |

The goal is to localize implementation substitutions. It is not to pretend that new scientific observations, security policies or user-visible data fields can change without coordinated contract updates.

## Verification performed for this assessment

- Inspected actual package manifests, source imports, entrypoints, interfaces, concrete calls, numerical persistence operations, UI transport and backend estimator integration.
- Traced live capture, history, reconciliation and recalculation call sites.
- Inspected existing unit/parity/integration test sources and documented release boundaries.
- Did not modify product code, run the full suite, benchmark the application or certify deployed behavior.
- Existing uncommitted source changes belong to the working tree and were preserved.
