# Timing and live/history merge audit

15 September 2026. This is an audit of the current application and a specification of the owner's requested behavior. It does not enable timing capture, change estimation engines or change released artifacts.

## Owner's current decision

Use a valid captured live duration when one exists for the exact response attempt. Otherwise use the historical duration exposed by the provider. Otherwise pass `null` to EcoLogits so its own timing model applies. Historical timing is useful whether a chat predates installation or live capture was unavailable for another reason.

The owner explicitly chose to use the observed historical spans from ChatGPT, Claude and Perplexity. This supersedes the earlier recommendation to retain Claude and Perplexity spans only as evidence without admitting them as latency caps. Their limitations still apply: Claude's text-block span can omit the initial phase, and Perplexity's entry span can include search and other workflow work. Do not relabel these as complete measured inference or GPU time.

Keep the existing engine and model fallback controls. Missing timing must not itself trigger an Original-engine fallback. Timing does not establish the identity of an underlying model.

## Result

The application has durable history deduplication, live replay protection and downstream support for suppressing proven live/history overlap. It does not yet have the timing input or the provider identity integration necessary to implement the requested policy reliably. In particular, the current approximate combined view can include the same response from live capture and imported history.

## What the code currently does

| Area | Verified behavior | Relevant code |
| --- | --- | --- |
| EcoLogits input | Always supplies `request_latency: null`. The native implementation and remote admission path have the same assumption. | [TypeScript engine](../../packages/estimator/src/engines/ecologits.ts), [native engine](../../apps/server/aift/engine_adapter.py), [remote admission](../../packages/estimator/src/engines/remote-admission.ts) |
| Scientific method identity | Declares `profile-regression-without-measured-latency`. Timing admission must get a new method identity. | [Method registry](../../packages/estimator/src/engines/methods.ts), [policy schema](../../packages/contracts/src/engine-policy.ts) |
| Live timestamps | Capture retains a dispatch wall-clock timestamp. The coordinator records `ended_at` when it processes the end message, after capture transport and other work. These are bookkeeping timestamps, not an accurate elapsed timer. | [Capture runtime](../../apps/extension/lib/capture-runtime.ts), [coordinator](../../apps/extension/lib/coordinator.ts) |
| Repeated history import | Stable HMAC message keys include conversation, role and provider message ID. The numeric payload hash excludes import time. Reimporting an unchanged message does not create another history message. | [History service](../../apps/extension/lib/history-service.ts), [history contracts and refinement](../../packages/contracts/src/index.ts) |
| Historical response matching | Every history adapter currently leaves `liveAttemptId` null. The strict history bridge explicitly rejects a non-null value. Only Perplexity supplies a historical request ID. | [History DTO defaults](../../packages/adapters/src/history/common.ts), [history bridge validation](../../apps/extension/lib/history-capture.ts) |
| Combined totals | Adds unmatched history to live totals and displays `Estimated · Matching incomplete` when overlap is unresolved. This avoids hiding observed history, but is not a guarantee of counting each response once. | [Combined presentation](../../apps/extension/lib/history-presentation.ts) |
| Proven overlap | Suppresses the historical contribution. It does not merge fuller historical token evidence into a partial live observation. | [History repository](../../packages/ledger/src/history-repository.ts), [estimation repository](../../packages/ledger/src/estimation-repository.ts), [server history](../../apps/server/aift/historical_usage.py) |
| Evidence improvement | History refinement permits certain absence-to-known changes but rejects changed known token counts and identities. Live identity coalescing selects the earliest record, rather than the most complete evidence. | [History refinement](../../packages/contracts/src/index.ts), [live coalescing](../../packages/ledger/src/index.ts) |

The two local overlap checks are also inconsistent. `historyLiveOverlap()` reads at most two provider-index records and accepts any suitable canonical record among them. The estimation path scans all matches, checks authorized ownership, requires exactly one canonical match and checks both request and attempt ambiguity. More than two aliases, an ambiguous parent or an ownership change can therefore produce different decisions between summaries. The memory and server implementations need the same defined matching rule.

## Timing selection

Selection is per response attempt, not per chat or installation date:

1. Use a valid live duration captured from the dispatch of that attempt to its verified completion.
2. If no usable live duration exists, use the accepted historical span belonging to that same attempt.
3. If neither exists, use `null`.

Installing an extension does not prove it observed a request. An already open tab, missing permission, a disabled extension, a browser restart or installation during generation can leave a post-installation response without a complete live timer. Such responses follow the same historical/null fallback rule as older chats.

For newly captured requests, use a monotonic clock such as `performance.now()` in the capture layer. Take the start immediately around dispatch, without delaying or modifying the provider request. Take the end at the supported provider completion signal, before counting, background processing or storage. Store elapsed seconds directly rather than subtracting timestamps from different clocks or processes.

Record separate source and scope information: browser request-to-completion, provider message span, Claude content-block span or Perplexity entry/workflow span. First text, time to first token and displayed reasoning duration are different measurements and must not replace the full live timer. Preserve uncertainty for partial streams, cancellation, reconnection and unverified completion.

The observed provider completion signals are Claude `message_stop` with an appropriate finish reason, ChatGPT's actual message stream completion after any handoff, and Perplexity's completed final SSE record. A successful completion can be followed by a network abort, as it was in the controlled Claude and Perplexity tests. HTTP connection end or abort alone must not override a proven successful completion. Gemini's current adapter explicitly reports unverified completion semantics; it needs its own completion validation before a full live duration can be advertised.

### Historical evidence available from the controlled tests

| Tool | Accepted historical source to implement | Qualification |
| --- | --- | --- |
| ChatGPT | The final assistant message's `update_time - create_time`. | Provider message span. Validate the finish reason, stability and relationship to the selected response. Do not use the whole conversation's update time. |
| Claude | Start/stop timestamps on the corresponding generated content blocks. | Content span, potentially missing prefill/initial wait. Multiple blocks need an explicit rule; do not blindly sum overlapping blocks or use the parent prompt's age for retries. |
| Perplexity | `entry_updated_datetime - entry_created_datetime` for the corresponding completed entry. | Workflow span, potentially including search. Do not substitute thread `updated_datetime` or empty answer-step timestamps. |
| Gemini | No verified historical duration pair. | Pass `null`. A single turn timestamp is an occurrence time, not a duration. |

Reject missing, malformed, reversed or otherwise unusable intervals. Store unavailable as null rather than zero. A stale reimport must not erase a captured live duration. Changed historical timestamps after edits must be classified as new/conflicting evidence, not silently used to increase the original duration.

The [paired live/history report](LIVE-TO-HISTORY-LATENCY-CHECK-2026-09-15.md) and [curated numerical evidence](../../output/research/latency-live-history-2026-09-15.json) document the actual observations and capture limitations. These were five synthetic generations, not exhaustive coverage of all provider modes.

EcoLogits uses supplied latency as an upper limit on its modeled generation time, effectively `min(modeled_time, supplied_time)`. Null means no observed cap. Admitting a short partial historical span can therefore reduce the non-GPU server and embodied allocation even if it omits part of inference. The selected policy and evidence scope must remain visible in calculation provenance. The underlying GPU energy regression remains separate. See the [direct methodology verification](ECOLOGITS-LATENCY-METHODOLOGY-VERIFICATION-2026-09-15.md).

## Identity matching needed before merging

Do not match responses merely by text, nearby timestamps, conversation membership or model name. Those can coincide across real retries. Prove the same provider output within the authorized account/conversation scope and hash the provider identity locally using the established domains.

| Tool | Current live output identity | Current historical response identity | Required integration |
| --- | --- | --- | --- |
| Claude | Assistant `message_start.message.id`. | Historical assistant `uuid`. | Verify same-response equality and admit that mapping. Prompt/request identities require separate proof. |
| ChatGPT | Final assistant message ID. | Historical final assistant row ID. | Verify equality and admit the response mapping. The ordinary live request key uses the submitted user-message ID, so historical `metadata.request_id` must not automatically be equated to it. |
| Gemini | Prefers turn `r_*`; candidate ID is only a fallback. | Selected response candidate `rc_*`. | Retain turn and candidate separately. Do not equate a turn with every alternative candidate. Review compatibility for already saved turn-based identities. |
| Perplexity | Workflow answer item ID. | Entry `frontend_uuid`; the answer item ID is discarded by history parsing. | Retain the unique selected answer item identity. Entry identity can link the prompt, but cannot safely collapse multiple answer alternatives. |

The prior browser research retained timing and schema evidence without raw provider IDs. An identity equality fixture is still needed before promoting these candidate mappings to verified live/history links. Synthetic downstream overlap fixtures alone do not prove provider identity semantics.

## One contribution with preserved evidence

Keep immutable observations and originals. Build a canonical contribution from proven linked evidence. A later history import may improve an existing response's evidence, but must not create a second contribution for that same execution.

For example, if an older chat has ten imported responses and one new response is captured live, refreshing and importing eleven historical responses must leave eleven contributions. The live duration for the new response survives the refresh. Regenerating an answer is a separate execution when the provider gives a different response/attempt identity; it must not be collapsed merely because the prompt was reused. Existing branch visibility rules remain distinct from accounting for separate observed live executions.

If a live observation contains only 200 visible output tokens and the same response later exposes 500 complete historical visible tokens, keeping both observations in totals is wrong. Always discarding history is also wrong. Select the fuller compatible output evidence for one contribution, with provenance. Do not replace a provider-reported total including hidden reasoning with a historical visible-text count: these measure different scopes. Do not join a timer from one retry with the tokens of another retry.

The selection must be independent of arrival order: live-first, history-first, repeated history imports, worker restarts and delayed sync should converge to the same contribution. If identity remains ambiguous, preserve the evidence and explicit uncertainty rather than claiming exact deduplication.

## Required application changes

1. Introduce a versioned numeric timing contract with duration in seconds, source, scope, completion qualification and extraction/policy version. Use decimal strings in canonical persisted payloads to preserve the existing no-floating-JSON hashing contract. Keep old observation schemas readable and unchanged.
2. Add live timing capture and provider-specific historical extraction. Extend the strict capture bridges so validated timing and verified identity evidence can reach background services.
3. Introduce a consistent canonical overlap resolver for local summaries, estimation contributions, memory storage and server calculations. Require unambiguous identity and authorized ownership. Preserve deletion and retention guarantees.
4. Define evidence refinement and the calculation input for a linked live/history response. Preserve immutable originals; support missing-to-known timing and fuller compatible tokens without arrival-order dependence. Record the provenance of every selected field.
5. Add the selected timing to EcoLogits inputs in the TypeScript engine, native adapter and remote validation. Version the method's latency policy, include timing evidence in input hashes and invalidate affected derived results through the established recalculation path. Preserve the former null-only method's identity and semantics.
6. Preserve local/organization isolation and synchronization rules. A timing or identity refinement must not be lost behind an old acknowledgment, survive an applicable deletion or cause reimport to recreate erased usage.

No Python runtime needs to be added to the extension. These are changes to the existing TypeScript capture, observation and estimation pipeline, with corresponding Python server contract support.

One existing engine-policy nuance is outside the timing change: [build configuration](../../config/estimation.build.json) routes an unknown underlying provider to the Original engine. Perplexity may be in that situation. This audit does not silently alter that policy or claim every Perplexity request already runs through EcoLogits. The caller must distinguish timing fallback from model/provider fallback.

## Acceptance cases

- A pre-installation response with a valid historical span uses that span; absent or unusable span passes null.
- A post-installation response without a complete live observation uses historical evidence or null, never installation time.
- Each provider's paired live/history fixture identifies exactly the same response, including supported handoff paths. Gemini alternatives and Perplexity multiple answer items remain distinct or explicitly ambiguous.
- Live then history, history then live, repeated reloads and more than two live aliases produce the same contribution and totals.
- Valid live timing survives historical rereads; a compatible fuller historical count can improve a partial live count without doubling usage or losing a better provider token total.
- Retry, edit, long idle before retry, selected branch change, cancellation, incomplete stream, reconnection and installation during generation do not fabricate complete durations or merge different executions.
- Timing-only refinement changes the derived input hash and recalculated result while retaining original estimates.
- TypeScript and Python return equivalent EcoLogits results for the same admitted timing; null retains upstream modeled timing. The Original engine remains numerically unchanged.
- Ownership changes, erasure, retention, pending receipts and reconnect do not leak or resurrect linked records.
- Native Chrome, Edge and Firefox checks validate actual capture and extension overhead before release. These remain pending under the owner's earlier instruction.

## Verification performed for this audit

Read-only code inspection covered provider adapters, capture validation/runtime, coordinator timestamps, history ingestion/refinement, local and memory overlap logic, combined presentation and native/remote timing inputs.

Ran the existing focused suites:

```text
node --import tsx --test packages/adapters/test/history-text.test.ts apps/extension/test/combined-usage.test.ts packages/ledger/test/estimation-upgrade.test.ts apps/extension/test/history-service.test.ts
```

Result: 38 tests passed, zero failures or skips. They verify current reload deduplication, bounded history ingestion, branch handling, erasure behavior, presentation and synthetic overlap handling. They do not establish working end-to-end provider live/history identity matching or measured latency support. No runtime source or packaged extension was changed by this audit.
