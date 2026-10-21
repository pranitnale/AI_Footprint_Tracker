# Timing and live/history reconciliation

Owner authorization: 15 September 2026. Implement the twelve changes discussed in the conversation, with the owner's replacement of compatibility requirement 10: this is a pre-production application and obsolete testing data/schema support may be removed. This amendment supersedes old observation compatibility requirements for this work.

## Current target

- One current observation, usage-batch, history-message, history-page and historical-summary schema: `2.0.0`. Reject obsolete wire versions. Existing current estimation envelopes remain `2.0.0`; independently versioned method/configuration documents remain distinct.
- IndexedDB version 15 deliberately clears obsolete usage data and derived calculations. Preserve authentication, settings, ownership controls and deletion protection. No migration or interpretation of obsolete observations.
- Timing is a numeric evidence object with positive decimal-string seconds, source, scope, completeness and extraction-profile version. Unavailable is null, never zero.
- Capture monotonic live elapsed time from dispatch to the verified provider terminal receipt. Preserve streaming and host controls; follow handoffs and classify cancellation or unverified completion accurately.
- Historical timing policy admits the owner's chosen ChatGPT message span, Claude generated-content span and Perplexity entry/workflow span with honest scope. Gemini history remains null until a duration source is verified.
- Timing precedence is valid complete-for-scope live evidence, then eligible historical evidence for the same response, then null. EcoLogits retains its unmodified modeled-time cap. Original mathematics, model fallback configuration and engine controls stay intact.
- Use proven response identities to link live and historical observations. Select one contributing live workload and its compatible historical evidence. Preserve raw numerical observations and original estimates within the new schema; do not combine different retries, alternatives or accounts.
- Fuller historical visible output can improve a partial compatible live count. A provider-reported total or a complete measurement must not be silently replaced by an incompatible historical count. All selected evidence is bound into calculation source hashes.
- A timing-only disagreement never removes an otherwise valid response or its tokens. Conflicting complete historical spans become unavailable with a persistent timing-conflict reason; incomplete rereads retain the first incomplete span until complete evidence arrives. Original records retain their original span. Valid live timing still takes priority.
- Local summaries, recalculation, memory repository and backend must agree on identity, ownership and contribution rules. Arrival order, reloads, repeated imports and deletion must not alter correct counts.
- Record attribution and source integrity; no Python runtime in the browser, no activation of a hosted execution API and no deployment.

## Acceptance evidence required

| Requirement | Required evidence |
| --- | --- |
| Latest schema only | Current JSON schemas, strict old-version rejection tests, no runtime old-schema readers; populated old local DB resets usage safely |
| Correct live timer | Deterministic capture tests for dispatch, first terminal receipt, HTTP abort after success, WS handoff, resume, timeout, cancellation and missing start |
| Historical spans | Provider-shaped fixtures for valid/invalid spans, fractional precision, complete/interrupted outcomes and scoped source metadata |
| Proven provider linkage | Paired same-response identity evidence or explicitly reported unverified modes, plus adapter-to-ledger regression tests |
| One contribution | Live-first/history-first, repeated reload, old conversation plus new response, retries, alternatives and multiple aliases |
| Evidence enrichment | Complete historical visible output improves partial compatible live capture; live duration survives reload; provider totals remain authoritative for their scope |
| Calculation correctness | TypeScript and native Python agree for numeric fixtures with live, historical and null timing; Original formula arithmetic remains unchanged |
| Durable consistency | Restart, recalculation invalidation, ownership/era transitions, erasure, retention and sync receipt races |
| Product behavior | Same combined totals and provenance through conversation/dashboard paths; missing/ambiguous evidence remains visible |
| Review and distribution | Independent source review after combined changes, relevant checks and fresh local build artifacts |

Native Chrome/Edge/Firefox installation checks remain pending under the owner's explicit earlier instruction. Passing unit/integration tests must not be described as completing those browser checks. A prior PostgreSQL execution denial must not be bypassed.

## Work ownership

- Contract worker: TypeScript contracts, JSON schemas and contract tests.
- Capture worker: provider parsing, timing evidence helpers, capture bridges/runtime and associated tests.
- Ledger worker: canonical matching, linked inputs, local/memory storage, reset and ledger tests.
- Main agent: estimator policy, application integration, backend parity, shared test/fixture consolidation and verification orchestration.
- Independent reviewer: review the resulting behavior and diffs after implementation.

Status: implementation and automated verification completed. See [the verification record](../release/TIMING-RECONCILIATION-STATUS.md) for results and the explicitly deferred native-browser and PostgreSQL checks.
