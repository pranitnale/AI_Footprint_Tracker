# Historical chat timing exposure

15 September 2026. Read-only inspection through the Codex in-app browser of existing synthetic test chats on Claude, ChatGPT, Gemini and Perplexity. No new prompts were sent. No product behavior changed. These findings concern the consumer websites' current history responses, not their public developer SDK contracts.

Only timing field names, sample counts and derived durations are retained here. Raw authenticated responses, headers, conversation/message IDs, chat text and attachments are excluded.

## Findings

| Website | Historical fields observed | What the evidence supports |
| --- | --- | --- |
| Claude | `chat_messages[].content[].start_timestamp`, `stop_timestamp`; message `created_at`, `updated_at` | Content-block intervals and the span across exposed blocks. These are not yet verified as the complete request interval. |
| ChatGPT | Message `create_time`, `update_time`; metadata `reasoning_start_time`, `reasoning_end_time`, `finished_duration_sec` | Message timestamp spans and separate reasoning intervals. Reasoning-only time and mutable update timestamps cannot automatically stand in for complete request latency. |
| Gemini | One seconds/nanoseconds timestamp pair per turn in the observed `hNvQHb` history RPC, at each turn's index `[4]` | A turn occurrence timestamp. No independently verified start/end pair was found in this sample. Positional numeric fields with unknown semantics remain unknown. |
| Perplexity | `entry_created_datetime`, `entry_updated_datetime`, `updated_datetime`; workflow `started_at` and step `started_at`/`completed_at` | Entry timestamp spans and workflow-step intervals. Their persistence and scope require validation before admitting them as full request durations. |

Sample coverage: two Claude chats with eight assistant messages; one ChatGPT chat with 20 message records; one Gemini chat with five turns; one Perplexity chat with two entries. This is not a survey of every model, mode, account, branch or historical schema.

The first Claude navigation trace lost early events. It was not used to assert absence of fields. Subsequent normal in-page navigation yielded the selected history responses. The Perplexity event buffer also reported truncation, but the selected history response itself was successfully retrieved and parsed. Neither trace proves complete network coverage.

## Numerical checks and misleading alternatives

- Claude's first simple text block spans 1.143945 seconds. In a tool-using answer, the span from the first exposed tool block to the last exposed text block is 19.578224 seconds, while that last text block alone spans 0.023086 seconds. Hidden or omitted work can still fall outside the exposed span. All seven assistant messages in the second Claude sample have equal message creation and update timestamps, despite nonzero block spans.
- ChatGPT's first final message has a creation/update span of approximately 5.041015 seconds. A separate reasoning recap has a timestamp span of approximately 0.967169 seconds while `finished_duration_sec` is zero. That zero does not establish zero reasoning time. An update time is not assumed to be an immutable generation-completion event.
- Gemini exposes five identified turn timestamps for five turns. The current history adapter assigns each turn's same timestamp to both its prompt and response. Subtracting those would produce a false zero-duration result.
- Perplexity's two entry creation/update spans are 2.914384 and 1.126208 seconds. The first entry's separate `updated_datetime` is nearly 30 minutes after its creation and equals the later thread update. This field cannot safely be substituted for the first entry's generation-completion time. Workflow steps expose narrower intervals that need separate labels.

ISO timestamps were compared at microsecond precision where available. A millisecond parser would round some short Claude tool-result intervals to zero.

## Current application behavior

The history adapters currently retain an occurrence timestamp and its basis, not a validated start/end duration. See `packages/adapters/src/history/types.ts`, `claude.ts`, `chatgpt.ts`, `gemini.ts` and `perplexity.ts`. Existing imported numeric records therefore cannot recover these additional source fields without rereading the original provider history.

`packages/estimator/src/engines/ecologits.ts` currently passes `request_latency: null`. The method definition explicitly binds the `profile-regression-without-measured-latency` policy. The EcoLogits core supports a supplied cap, but the application does not yet admit measured or reconstructed historical duration.

## Recommended future admission policy

1. Prefer a saved, validated browser-observed full request interval from a live capture, with request identity, monotonic elapsed time and completion evidence.
2. Permit a provider-derived historical full request interval only after validating field semantics, clock basis, units, branch identity, completion/cancellation and stability under reopening, editing and regeneration. Keep its provenance distinct from a browser measurement.
3. Retain narrower block, reasoning and workflow intervals as partial timing evidence. Do not add overlapping intervals or feed a partial lower bound into EcoLogits as a full request cap.
4. If complete timing is absent or uncertain, keep the existing catalog-based estimate and `request_latency: null`. Do not invent zero or use the time spent loading an old chat.

The historical capture contract, numeric storage schema, method identity and replay tests would need an explicit versioned change before using new timing evidence. No such implementation is included in this investigation.

## EcoLogits timing semantics verification

A subsequent check read the official [methodology overview](https://ecologits.ai/0.11/methodology/) and the actual Python implementation at the pinned commit. The web fetcher rejected the detailed LLM methodology URL; that page was not read through an alternate route. The following mathematical and instrumentation findings are verified from upstream source, rather than inferred from the consumer websites' field names.

- [`generation_latency`](https://github.com/mlco2/ecologits/blob/886d1ebfadb51a2d6407fcea6d9778c997c85c35/ecologits/impacts/llm.py#L66) distinguishes supplied request latency from modeled generation latency. It uses the smaller of the supplied duration and the output-token timing estimate, including the catalog's first-token time when supplied. An absent duration becomes infinity in the wrapper, so it imposes no cap.
- The selected duration enters non-GPU server energy and allocated embodied impacts. The GPU energy regression remains driven by the token workload and model/batch parameters. Elapsed network or tool time does not independently measure those components' energy.
- The [Anthropic non-streaming wrapper](https://github.com/mlco2/ecologits/blob/886d1ebfadb51a2d6407fcea6d9778c997c85c35/ecologits/tracers/anthropic_tracer.py#L188) times the wrapped API call. Its [streaming text helper](https://github.com/mlco2/ecologits/blob/886d1ebfadb51a2d6407fcea6d9778c997c85c35/ecologits/tracers/anthropic_tracer.py#L38) starts its own timer when consuming the stream, after the stream manager has opened the request. Consequently, a claim that every SDK path uses exactly the same dispatch-to-final-event boundary would be too broad.
- A browser-observed generation request can be an explicitly labeled elapsed-time proxy. An entire multi-call/tool workflow, a reasoning recap, or a text-block interval is not automatically equivalent to the single inference workload represented by a token count. These field observations establish availability, not EcoLogits approval or validation of a historical latency cap.

The prior recommendation remains conservative: preserve partial timing as partial evidence, keep provenance and workload identity, and retain absent measured latency until an appropriate request-level interval has been validated. No production timing policy was changed by this verification.

At the owner's subsequent explicit request, the detailed methodology page was successfully opened and read in the in-app browser. It confirms that modeled generation time excludes network latency and supplied request duration is an upper bound. The [direct methodology verification](ECOLOGITS-LATENCY-METHODOLOGY-VERIFICATION-2026-09-15.md) records that completed reading, fresh core/application checks and remaining application policies. The earlier access limitation above describes the earlier attempt only.

## Deeper historical scope checks

The already captured synthetic history responses were subsequently inspected for branch, completion and timing-field contents. No new prompts, production changes or additional full-history exports were needed.

- Claude's retry shares its earlier human parent. The first retry text-block timestamp is 92.744734 seconds after that parent's creation, while the text-block interval itself is 1.126695 seconds. A parent-creation-to-retry-completion formula therefore includes the wait before the retry. It cannot recover retry latency. Several other assistant block starts are about 7-9 milliseconds before their parent message's persisted creation time, reinforcing that these persistence timestamps cannot simply be joined as a request clock.
- Claude's stopped sample has `stop_reason: user_canceled` while `truncated` is false. The latter flag alone cannot establish natural completion.
- All five ChatGPT final messages have `status: finished_successfully` and `metadata.is_complete: true`, but the last has `metadata.finish_details.type: interrupted`. Its saved-message status does not establish successful completion of the whole generation. The first four have finish type `stop`. Message creation/update spans are present in all five; their scope remains distinct from the separate reasoning intervals.
- Perplexity's root workflow `completed_at` is an empty string in both entries. The `WORKFLOW_ITEM_TEXT` answer steps have empty `started_at` and `completed_at` fields even though their status is `WORKFLOW_COMPLETED`. Nonempty step intervals belong to earlier steps, including a source step. Presence of a string field or completed status is not sufficient timing evidence. Entry creation/update spans remain available but are not independently verified generation intervals.
- Gemini still has one identified occurrence timestamp per observed turn. No additional positional field was promoted into a duration based on its numerical appearance.

These checks strengthen the conservative admission recommendation. They do not show that provider-derived historical timing is unusable; they show why it must be classified and validated per provider, schema and workload.

## Proposed implementation boundary

Keep timing observation separate from estimation. Capture adapters should emit versioned numeric timing evidence with request/attempt association, source, clock basis, start/end semantics, scope, completeness, completion outcome and exclusions. The estimation adapter should choose an admitted full-request cap without altering the EcoLogits mathematical core.

For live requests, record a monotonic dispatch time, optional provider start, first generated-content receipt, first visible-text receipt, and genuine terminal receipt. Preserve a UTC anchor for history association, but calculate elapsed browser duration from the same monotonic clock. Capture receipt times before counting, parsing queues and background publication add delay. Follow a response across SSE/WebSocket handoff and reconnects where the original start remains known. Initial HTTP completion, UI animations, thinking recaps and a user stop click do not independently prove the final provider completion time.

Record provider timestamps alongside browser timings when both exist. Do not subtract unrelated client/server clocks. Keep thinking/tool/text intervals separately and do not sum overlapping intervals or double-add a first-token delay. Retain microsecond source precision and distinguish a real zero from missing or rounded evidence. A provider duration or timestamp pair must refer to the same generation and token workload before it outranks a browser observation.

Before activating historical caps, use paired live-then-history verification on controlled normal, thinking, tool, retry, branch, cancellation, interruption and edited-message cases. Check that the relevant fields survive reopening and do not shift with later edits or thread activity. Validate complete nonempty endpoints, units, monotonic ordering and the provider's finish reason. Label inferred historical intervals as provider-derived, not browser-measured or independently measured GPU time. Incomplete/replayed histories remain uncapped by measured latency.

The initial estimator integration should preserve upstream behavior: admitted request duration is a cap, while catalog TTFT/TPS or the regression remain the timing model. A verified duration above that estimate still does not raise EcoLogits' selected time. Using measured server inference time directly would be a separate explicitly versioned methodological policy, not a hidden replacement inside this port.

Persist only the required numeric/categorical timing evidence. Include admitted timing and policy identity in calculation input hashes, preserve recorded originals, and recalculate through existing guarded jobs. Existing history records lack these source fields, so recovering them requires rereading the provider history. No existing duration can be invented from import time or chat loading time.

## Subsequent paired live/history experiment

The owner then explicitly authorized new requests. The [paired experiment](LIVE-TO-HISTORY-LATENCY-CHECK-2026-09-15.md) sent five synthetic generations, verified the outbound prompts and rendered answers, and reopened the resulting histories. It confirms Claude's stored text-block timing tracks the post-first-text interval in that sample, establishes ChatGPT message-timestamp stability across a follow-up, and shows that Perplexity's live `core_elapsed` does not survive in its saved entry. Gemini still exposes only one identified turn timestamp. These stronger observations refine, but do not remove, the source/scope qualifications above.
