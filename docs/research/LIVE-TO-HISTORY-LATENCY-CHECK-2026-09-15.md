# Paired live and historical latency checks

15 September 2026. The owner explicitly authorized new requests, UI and network observation, changing chats and refreshing to inspect preserved history. Five synthetic generations were made in the in-app browser: one each on Claude, ChatGPT, Gemini and Perplexity, plus a second ChatGPT request in the same chat.

All outbound synthetic prompts were verified against the actual request bodies. All five answers remained visible after reopening. No extension installation, engine policy change or runtime source change was performed. [Curated numerical evidence](../../output/research/latency-live-history-2026-09-15.json) records timings and capture limitations without authenticated raw payloads or provider IDs.

## Results

| Case | Browser-observed completion interval | Preserved historical timing | Interpretation |
| --- | --- | --- | --- |
| Claude A, Opus 5 Extra | 5.964 s to `message_stop`; first text at 1.501 s | Text block 4.471 s | Closely matches the 4.462 s first-text-to-stop interval. It does not cover the full browser request and cannot be substituted for complete generation/request latency without accounting for the omitted initial phase. |
| ChatGPT A, requested GPT-5.6 Thinking/max | 7.724 s to HTTP completion | Final message creation/update span 5.690 s | Message-level span is distinct from browser elapsed time. First-text receipt was not captured in this first sample. |
| ChatGPT B, same chat and mode | 6.773 s to `message_stream_complete`, 7.141 s to HTTP completion; first text at 2.918 s | Message span 6.101 s; separate reasoning span 1.714 s | Historical message timing covers more than final text streaming and includes the reasoning interval in this sample. It is a promising provider-message proxy, not measured GPU time or a proven universal full-inference interval. |
| Gemini A, Thinking | 7.962 s to HTTP completion | One identified turn timestamp | No verified historical duration pair. |
| Perplexity A, Search / `pplx_pro` | 5.703 s to its completed final SSE record | Entry creation/update span 5.275 s | This is a workflow record. Query/source work was present, so it is not an isolated LLM inference interval. |

These are different workloads and modes, not comparative provider benchmarks. No ranking of provider speed, efficiency or environmental impact follows from this table.

A historical provider span being shorter than browser elapsed time is not itself an error: the methodology targets server inference time independently of networking. The qualification question is whether the span covers the relevant prefill, reasoning and decode work. This experiment does not separate network delay, queueing and prefill within the browser's initial wait. Claude's close agreement with the post-first-text interval supports treating its field as text-block evidence rather than asserting that it includes every inference phase.

## What survives and what does not

Claude's live text-block start/stop timestamps survived in history with precision reduced from nanoseconds to microseconds. Literal strings differ, but their instants agree at the stored precision. The history message's own creation and update timestamps were equal, despite nonzero generation. Its text-block span matches the post-first-text browser span much more closely than the complete request span. This test supports preserving the block interval as block evidence; it does not validate a complete latency cap.

ChatGPT's first answer kept exactly the same creation and update values after the second request and another reload. Its creation value was present in the live SSE; its final historical update value was not identified in that live body. The second sample captured first text and a true stream-complete event. The separate reasoning display reported one second while its timestamps span about 1.714 seconds. A display duration is not a precise complete-request clock.

Gemini's selected `hNvQHb` history response retained one seconds/nanoseconds occurrence pair for its single turn. No other positional value was assigned duration semantics merely because it was numeric. The human-readable underlying model version was not verified.

Perplexity's live `_extras.core_elapsed` was 4.76315451040864 and was absent from the saved history response. Its name and magnitude do not establish pure inference timing or a documented unit contract. The persisted root workflow completion and answer-step start/completion fields were empty strings despite completed status. The query/source step did have timing. Search mode produced one observed query item and ten source records despite the prompt requesting no search; these are not counts of model invocations or all backend fetches.

Both Claude and Perplexity delivered successful provider completion markers and completed UI answers before their HTTP resources ended with `net::ERR_ABORTED`. No stop action was sent. A network abort therefore cannot by itself classify a user cancellation or replace provider terminal semantics.

## Capture limitations

The first ChatGPT stream body became available only through completed-body retrieval, so first-text timing is unavailable for A. The second sample captured 30 SSE frames with no trailing fragment or event-buffer truncation. Claude's completed-body lookup failed after abort, but buffered bytes and subsequent data events reconstructed 96 SSE frames without a trailing fragment or event-buffer truncation. Perplexity reconstructed 22 SSE data frames without event-buffer truncation.

Gemini's initial recorder filter incorrectly required a slash before `BardFrontendService`, while the observed path contains `assistant.lamda.BardFrontendService`. The matching request and completed-response timestamps were recovered from the CDP buffer; that wider recovery reported truncation. Its full-request bounds and retrieved history are available, but complete packet coverage and first-text timing are not claimed. This temporary inspection-filter error did not change the application's provider adapter.

The observer itself was not benchmarked for overhead. CDP receipt timestamps are not provider GPU measurements. Browser/server clock offsets were not calibrated; no cross-clock subtraction was used for a reported duration. The rendered answer was compared to its saved synthetic text with whitespace and markdown-emphasis normalization.

## Consequences for implementation

1. Keep live browser request duration, first-generated/first-visible-text time, provider-message spans, reasoning intervals, block intervals and workflow intervals as different evidence types.
2. For live EcoLogits caps, associate dispatch and genuine terminal events with the same supported generation workload. Follow real stream handoffs, preserve reconnect uncertainty, and inspect provider finish reasons before classifying cancellation.
3. Preserve Claude historical block timestamps, but do not use a text-only span as complete generation latency. It omits the initial phase in this sample. A hybrid of observed block duration and assumed prefill would be a separate labeled method policy, not a provider-measured full duration.
4. ChatGPT's message creation/update span is the strongest historical candidate in these paired samples. Validate long-input, reasoning, tool, retry, edited-message, branch and cancellation cases before activating it as a general latency cap. Stability in two samples does not prove the field's semantics in all modes.
5. Keep Perplexity entry timing as workflow evidence. Do not promote empty answer-step endpoints or the nonpersistent `core_elapsed` diagnostic to durable LLM timing.
6. Keep Gemini historical measured latency absent until an independently verified start/end or duration field is found. A single occurrence timestamp cannot produce a duration.
7. Preserve the upstream EcoLogits cap rule and the original estimates. Store versioned numeric evidence, qualify its source and scope, include any admitted timing in calculation hashes, and recalculate only through the established versioned path.

No automatic historical cap is enabled by this investigation. The [earlier historical exposure report](HISTORICAL-LATENCY-EXPOSURE-2026-09-15.md) and [direct methodology verification](ECOLOGITS-LATENCY-METHODOLOGY-VERIFICATION-2026-09-15.md) provide the preceding evidence and mathematical context.
