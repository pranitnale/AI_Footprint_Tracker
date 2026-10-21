# Consumer-app context guidance: implementation evidence

Reviewed 2026-09-08. The selected threshold is **above 50%**, not 60%. This feature is guidance, separate from tokens consumed and environmental estimates.

## What is verified

| Consumer app | Official evidence | Consequence |
| --- | --- | --- |
| Claude | [Usage and length limits](https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work) distinguishes quotas from context, documents model-dependent capacity and automatic summarization with code execution enabled. | Full visible chat history may no longer equal retained model context. |
| ChatGPT | [Models in ChatGPT](https://help.openai.com/en/articles/20001354-gpt-56-and-gpt-6-pro-in-chatgpt) documents mode, plan and routing differences. | A developer model's capacity cannot automatically be assigned to every ChatGPT session. |
| Gemini | [Gemini Apps limits](https://support.google.com/gemini/answer/16275805?hl=en) publishes personal-plan context capacities separately from usage quotas; work/school guidance is separate. | Match account type and plan; a published capacity is not a live occupied-context count. |
| Perplexity | [How Perplexity works](https://www.perplexity.ai/help-center/en/articles/10352895-how-does-perplexity-work) describes model selection/automatic Best routing, search and follow-up context. | Retrieved sources and routed models make a chat-text-only count incomplete. |

These pages do not establish a supported third-party interface returning both live occupied context and the applicable app limit for all four sites. This is not proof that no private response contains useful fields. Private response capture/semantic validation remains an implementation investigation, not completed telemetry support.

## Adapter decision order

1. Prefer observed provider fields only after verifying their meaning: active input context versus generated output, cached tokens, lifetime usage or subscription quota. Record units, model/plan/mode, timestamp, schema and capacity basis. Never sum overlapping cached/total counters.
2. Otherwise estimate the current retained active branch locally, using a validated model tokenizer or explicitly approximate profile. Include only known retained messages, draft and observed tool/document context. Flag unknown instructions, hidden reasoning, retrieval and compaction. Do not sum every historical request's input/output totals.
3. Choose a dated, verified **consumer application** capacity where applicable. Otherwise use a reviewed, versioned advisory budget and disclose its amount and basis. Developer API limits are references, not evidence of identical consumer-app limits.
4. Compute `estimated_active_input_tokens / selected_budget_tokens`. Normalize output-reservation conventions consistently; do not subtract an output allowance twice. This ratio is not a guarantee a request will fit.
5. If compaction/routing changes invalidate the numerator or denominator, invalidate/recompute the snapshot. Without a defensible budget or context snapshot, show unavailable/qualitative guidance, not fabricated precision. Never interpret missing fields as zero.
6. Trigger above 0.50; exactly 0.50 does not trigger. Rearm at or below 0.45 with the existing 24-hour cooldown and installation-level duplicate-tab coordination. Advice dismissal never pauses tracking.

## Privacy and verification gates

- Observe already occurring supported activity only; no guessed private endpoints or extra provider requests. Preserve host streaming, cancellation and submission behavior.
- No live employee chat text is sent to token-counting APIs. Anthropic's developer counting endpoint is not a live Claude.ai context meter; synthetic/public development calibration remains separate.
- Validate adapters using consented, synthetic chat fixtures covering model switching, branches, regeneration, long chats, summarization, files, search and missing fields. Publish per-provider capability status and fail visibly on schema changes.
- Test 49%, 50%, 51%; unknown model/plan; unavailable budget; cache accounting; duplicate tabs; dismissal; and differences between cumulative consumption and active context.
- UI: prominent, tinted, nonblocking banner directly above the input, Details overlay on request, accessible progress bar labeled by budget kind, and explicit uncertainty inside Details. No automatic chat creation, prompt edits, modal warning or quantified saving without evidence.

The C11 canvas values (31,000 / 50,000 = 62%) are synthetic UI fixtures only. They do not select a production fallback or describe Claude's actual capacity.
