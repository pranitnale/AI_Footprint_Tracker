# Consumer website network audit, 9 September 2026

Status: live inspection completed for the cases listed below. This is development evidence, not release certification. No production extension was installed or validated. Private website protocols can change without notice.

## What the implementer should take away

All four tested websites exposed the newly submitted prompt and an answer representation that can support local text counting. None of the inspected samples provided a verified, complete numerical input/output token-usage report. This is a finding about these samples and modes, not a claim that such fields can never exist.

| Website | Observed input | Observed answer transport | Best supported conclusion today |
| --- | --- | --- | --- |
| Claude | Gzipped JSON; new prompt and parent reference | SSE text, thinking and tool blocks | Count assembled text with a labeled tokenizer profile; expose observed search operations separately |
| ChatGPT | JSON; one new message and parent reference | Initial SSE hands off to an existing WebSocket; nested SSE deltas | A fetch-only implementation will miss answers in this mode; deduplicate catchups and apply stateful deltas |
| Gemini | Form body containing nested positional JSON | XSSI-guarded, UTF-16-length-framed nested JSON snapshots | Decode UTF-8 first, then frame by UTF-16 units; replace candidate snapshots instead of adding them |
| Perplexity | JSON query plus conversation/routing parameters | SSE workflow patches and snapshots | Count canonical answer items once; preserve unknown underlying model and separate query/source counts |

The observed sites still support useful estimates. Missing hidden reasoning does not require hiding the observed prompt/answer counts or a valid, clearly scoped resource estimate. It does prevent labeling those numbers as complete cloud consumption.

## Scope and capture boundary

The user authorized synthetic test messages and detailed inspection of ChatGPT, Claude, Gemini and Perplexity. The four signed-in pages were found in the Codex in-app browser. A regular-Chrome probe was rejected by the browser policy; no regular-Chrome test tab was opened. The audit uses the existing in-app sessions with the supported full-CDP capability. This does not establish parity with packaged Chrome, Edge or Firefox extensions.

Only the synthetic test conversation bodies are inspected. Authentication headers, cookies, account identifiers, connector URLs, unrelated conversations and raw account settings must not enter this repository. Network response bodies remain in the browser-control session; documentation uses structural descriptions and sanitized examples.

Capture uses `Network.enable` with a 32 MiB total buffer, 8 MiB resource buffer and 2 MiB post-data limit, plus event cursors. Event truncation, missing response bodies and interrupted collection are separate capture failures, not evidence of absent provider fields. No page fetch hooks, service workers or production extensions have been installed by this audit.

## Initial Claude findings

Observed UI selection: `Fable 5.1 High`. Requested and response-reported model string: `claude-fable-5-1`. Preserve those exact observed strings as evidence; no official-tokenizer mapping is established merely by this label.

### Completed initial tests

| Test | Action | Observed result |
| --- | --- | --- |
| C-TEXT-01 | Send `Reply with exactly: TOKEN TEST OK` in a new chat | One normal completion stream; final text `TOKEN TEST OK`; terminal `end_turn` and `message_stop` |
| C-TEXT-02 | Ask to repeat the previous three-word response | Same conversation, new prompt and message IDs; previous assistant referenced as parent; same expected answer |
| C-REGENERATE-01 | Click Retry on the second assistant answer | Separate retry endpoint; empty new prompt; parent is the previous human message; fresh assistant and completion-request IDs; alternate answer retained in the saved conversation |

### Routes actually observed

- `POST /api/organizations/:organization_uuid/chat_conversations/:conversation_uuid/completion`
- `POST /api/organizations/:organization_uuid/chat_conversations/:conversation_uuid/retry_completion`
- `POST /api/organizations/:organization_uuid/chat_conversations/:conversation_uuid/title`
- `GET /api/organizations/:organization_uuid/chat_conversations/:conversation_uuid` with observed query keys `tree`, `rendering_mode`, `render_all_tools`, `include_inline_comparison`, `consistency`

The title request is not another user send. Its backend cost is not established by this capture and must not be silently promoted into a measured generation or assumed zero.

### Request decoding

Both generation routes used `Content-Type: application/json`, `Content-Encoding: gzip`, and `Accept: text/event-stream`. CDP exposed binary-looking `postData` plus base64 bytes in `postDataEntries`. Parsing `postData` directly as JSON failed. Decoding those bytes with gzip produced JSON successfully. Production code must inspect the actual body representation and content encoding, handle uncompressed variants too, and never tokenize compressed bytes, base64 or the whole JSON envelope as chat input.

The first request had 33 prompt characters but 449,465 decoded JSON characters, including 234 tool definitions. The follow-up and retry carried 233 tool definitions. These counts describe this account and test, not a universal Claude configuration. The client-supplied definitions are not proof that every definition was included in the model context. Do not persist their descriptions, schemas, connector URLs or credentials.

Observed request keys: `prompt`, `timezone`, `locale`, `model`, `effort`, `thinking_mode`, `tools`, `turn_message_uuids`, `attachments`, `files`, `sync_sources`, `completion_request_id`, `rendering_mode`. The new-chat request additionally had `create_conversation_params`; the follow-up/retry instead had `parent_message_uuid`.

Observed metadata was `effort=high`, `thinking_mode=auto`, `rendering_mode=messages`. Initial new-chat parameters included `name`, `model`, `include_conversation_preferences`, `paprika_mode`, `compass_mode`, `tool_search_mode`, `is_temporary`, `chat_memory_mode` and `enabled_imagine`. Undocumented flags retain unknown semantics.

Follow-up requests did not contain a full history/messages array. The server-side conversation and parent reference determine additional context. Counting only `prompt` gives new-input text, not complete logical input.

### Stream and token observations

The initial streams were HTTP 200 `text/event-stream`, with captured HTTP completion and no event-buffer truncation. The observed event vocabulary was `conversation_ready` (new chat), `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_limit`, `message_stop`.

`message_start.message` exposed message IDs, role, model, parent reference, content and stop/trace metadata. No input/output token-usage object was present in these three captured start or terminal events. `message_delta.delta.stop_reason` was `end_turn`. The text appeared in `text_delta` fragments; the first answer split as `T` and `OKEN TEST OK`. Reassemble and tokenize the complete text, not each fragment independently.

`message_limit` exposed quota windows named `5h`, `7d` and `7d_oi`, reset times, utilization values and a resolved limit percentage. These are account quota data, not input/output tokens, occupied context or electricity. Do not infer the undocumented window suffix's semantics. Actual account quota values are deliberately omitted here.

The synthetic conversation JSON contained `chat_messages`, `current_leaf_message_uuid`, a model label and settings. After the retry it contained five messages: two human messages and three assistant messages, including both alternate answers. Messages exposed `uuid`, `text`, `content`, `sender`, `index`, timestamps, `truncated`, attachments/files/sync sources and `parent_message_uuid`. No numerical token-count field was found in that captured conversation JSON.

### Immediate implementation consequences

1. Observe both normal and retry routes. Empty retry prompt is not zero logical input or zero resource use.
2. Use new local dispatch identity plus verified response/message identity. A referenced parent is not a new generation ID.
3. Treat conversation-tree loads as history reconciliation. Never mint consumption merely because multiple answer branches appear in JSON.
4. Prefer assembled stream text; use saved message content for reconciliation without double-counting parallel `text` and structured `content` representations.
5. Treat new input, reconstructed active context, output text, visible reasoning and quotas as separate quantities.
6. Keep tokenizer approximation and resource-estimate limitations explicit. Absence in these samples is not proof that all models, plans or future responses lack counts.

### Additional Claude observations

C-THINK-01 asked for a short least-common-multiple calculation without tools. The stream contained a `thinking` block followed by a `text` block, but the thinking block's `thinking` string and `summaries` array were empty. There were no thinking-text deltas or reported reasoning-token totals. This signals a reasoning-related block, not zero backend reasoning. The UI supplied the final answer, 360360.

The debugger's completed SSE body returned mojibake for superscripts/multiplication signs, while the rendered answer had correct Unicode. C-UNICODE-01 resolved this discrepancy: base64 bytes from `Network.streamResourceContent` decoded correctly as UTF-8. Reversing the completed-body string through Windows-1252 reproduced those exact bytes. This is a recorder-specific decoding artifact, not a provider text mutation. Never apply that reversal indiscriminately to normal provider strings; Gemini's completed-body string was already correct Unicode.

C-UNICODE-01 submitted `Grüner Fußabdruck 🌿 | café | 你好 | é`, with the final accented letter represented as two code points. The actual Claude request preserved that representation. The returned answer used the precomposed `é`. Count each actual wire text without silently normalizing one to match the other. Five streamed chunks recovered 2,200 bytes with a terminal `message_stop`.

C-SEARCH-01 requested IANA's public explanation of example.com, with no connected apps or files. Its 73 frames contained two `tool_use` blocks named `web_search`, two corresponding non-error `tool_result` blocks, an empty thinking block and a final text block. Tool inputs arrived through `input_json_delta.partial_json`. Each tool result exposed ten records containing type/title/URL/site metadata, not the complete retrieved page text or a verified full model context. Citation start/end deltas accompanied answer text. This establishes two observed tool invocations in this sample, not twenty searches. Count final answer text separately from tool-input JSON and displayed tool results; never add citation labels/URLs twice.

C-STOP-01 used the site's Stop response control after text appeared. It produced `POST .../stop_response`, HTTP 200 for that stop request, and `ERR_ABORTED` for the completion stream. The captured partial completion had no `message_stop` or final stop reason. Preserve the observed text as partial, record the successful user stop signal, and do not turn the aborted network request into zero execution. Network failure alone is not enough to infer this user action.

## ChatGPT initial observations

UI effort: Extra High. Requested and response-reported model: `gpt-5-6-thinking`. G-TEXT-01 and G-TEXT-02 used the same baseline and follow-up pattern as Claude and both displayed `TOKEN TEST OK`.

### Input and dispatch

Observed generation route: `POST /backend-api/f/conversation`, JSON request, SSE response. `action=next`; `messages` contained one new user message. The follow-up added `conversation_id` and referenced a prior `parent_message_id`; it did not resend a full history array.

Other observed request keys included `client_prepare_state`, timezone fields, `conversation_mode`, `enable_message_followups`, `system_hints`, `model_response_contracts`, `supports_buffering`, `supported_encodings`, `client_contextual_info`, `paragen_cot_summary_display_override`, `force_parallel_switch`, `thinking_effort` and `local_function_names`. Treat client telemetry, contract declarations and opaque fields separately from model input. Do not upload or tokenize the whole envelope.

Preparation, Sentinel, telemetry and autocomplete requests were also present. In particular, `/backend-api/f/conversation/prepare`, `/backend-api/sentinel/...`, `/ces/...` and `/backend-api/conversation/experimental/generate_autocompletions` are not extra user-initiated sends merely because they are POSTs. Opaque Sentinel and resume fields are not usage counters.

### HTTP-to-WebSocket handoff

The initial HTTP response did not contain the final answer. Its events were `delta_encoding` with `v1`, `resume_conversation_token`, `stream_handoff`, then `[DONE]`. Handoff options advertised `resume_sse_endpoint` and `subscribe_ws_topic`, each with a `topic_id`. The browser chose an already-open WebSocket. The SSE resume alternative has not been exercised.

The socket supplied JSON arrays containing `reply` and `message` envelopes. A subscribe reply could include `catchups`. Message envelopes carried `topic_id`, opaque `offset`, and `payload` of type `conversation-turn-stream`. The nested payload contained `type=stream-item`, conversation/turn references, `encoded_item`, `stream_item_id`, `parent_stream_item_id` and a server timestamp. `encoded_item` contained another SSE-framed item. The stream eventually supplied `type=done` and an unsubscribe reply.

Production must correlate by the observed topic/turn/conversation identities, ingest both catchups and live items, and deduplicate by verified item identity. Observing only new WebSocket constructors after startup can miss an already-open connection. An initial HTTP `[DONE]` ends that handoff response, not the assistant's generation.

### Nested content and misleading token fields

Nested events included `delta`, `input_message`, `title_generation`, `message_marker`, `server_ste_metadata`, `message_stream_complete`, `conversation_detail_metadata` and `[DONE]`.

The observed `delta` encoding used `p`, `o`, `v` and optional `c`. Some frames omitted path/operation fields. Root message snapshots were followed by a `patch` list with operations such as appending to `/message/content/parts/0`, replacing status/end-turn, and appending metadata. Do not concatenate every `v`, treat this private format as ordinary JSON Patch without normalization, or treat system/user snapshots as assistant output. Full decoder inheritance semantics still need fixture validation.

For the baseline, the final text snapshot began empty; a later patch produced the answer. An assistant `reasoning_recap` message was separate from the assistant `final` text message. Reasoning timestamps and `finished_duration_sec` appeared, but no numerical input/output/reasoning token totals were identified in these two reconstructed nested streams. `finish_details.stop_tokens` contained an integer token identifier, not the count of tokens generated. `resume_conversation_token.token` was an opaque credential, not a token count. `model_limits` was an empty array and `limits_progress` was null in these samples, not proof of unlimited context.

An `input_message` of role `developer` and content type `developer_content` was exposed alongside the user input. Its private instruction contents are intentionally omitted. Such a field shows an observable context component, not proof that every server-side instruction or retained context component is visible.

### Search, reasoning and interruption

G-THINK-01 used the same short calculation as Claude. A reasoning recap and duration were exposed, without a verified reasoning-token total. G-SEARCH-01 exposed an assistant message addressed to `web.run`, tool-role messages, search-query/result metadata, a `thoughts` content object, a reasoning recap and final text. The exposed thoughts structure had a `thoughts` array with `summary`, `content`, `chunks` and `finished`. Treat this as the website's exposed reasoning display, not a full private reasoning trace. Its alternative representations may overlap; do not add summary/content/chunks without a verified normalization rule.

Until a reviewed normalization profile selects a primary reasoning-display representation, its numerical `visible_thinking` field remains unavailable. The independently valid answer count remains available. This audit identifies the reasoning structures but does not promote a sum of them to a tested token metric.

The search sample contained 26 unique stream items and one duplicate item across the captured socket envelopes. This is direct evidence that deduplication is necessary, not merely a hypothetical reconnect case. `server_ste_metadata.metadata.search_tool_call_count` was null even in this sample with an observed web-tool invocation. Null therefore cannot mean zero searches. Count verified invocation identities when available; label any missing internal queries separately. Search results and citations do not establish the exact text ultimately passed to a model.

G-STOP-01 successfully clicked Stop answering. The page sent `POST /backend-api/stop_conversation`. The nested terminal metadata contained `finish_details={type:"interrupted",reason:"client_stopped"}`. Both `message_stream_complete` and the transport's `done` still appeared. They mean the stream has ended, not necessarily that the answer completed normally. Preserve partial output and use the interruption reason when setting the attempt state.

Across the inspected runs, deltas also included an explicit `append` to `/message/content/parts/0`, followed by frames containing only `v`. A later explicit root `patch` could itself be followed by a `v`-only patch array. The reduced replay harness models inheritance of the last top-level path and operation for these observed forms. A new stream resets that state. The optional `c` field is retained as opaque metadata; its general semantics are not established here. Unknown operations, incompatible value types or missing targets must stop that decoder branch with an explicit diagnostic.

## Perplexity initial observations

UI: Search with Best automatic model selection. Captured request `model_preference=pplx_pro`; stream `display_model` and `user_selected_model` were also `pplx_pro`, with `mode=COPILOT`. This is a routing/product label, not an established underlying model or tokenizer identity. Do not assign the Sonar or Llama tokenizer solely from that label.

### Capture quality and query route

P-TEXT-01 displayed `TOKEN TEST OK` after a visible completed search step and ten sources. The recorder reported event truncation and lost the original generation request event. That sample is incomplete for network conclusions.

P-TEXT-02 captured `POST /rest/sse/perplexity_ask` and its JSON request, then HTTP 200 SSE followed by `Network.loadingFailed` with `ERR_ABORTED` and `canceled=true`. The page nevertheless displayed the complete expected answer without a user stop action. Completed-body retrieval failed with no resource data. This is not sufficient evidence of a failed/cancelled model generation.

P-STREAM-01 used a longer synthetic response with start/end markers and enabled `Network.streamResourceContent` while the request was in flight. Base64 `bufferedData` plus subsequent `Network.dataReceived.data` chunks recovered the stream. Fourteen chunks yielded 54,828 text characters and 28 SSE frames including both markers. That request finished normally at HTTP level. Capture mode and completeness must be recorded per run, not inferred from a prior run's status. See [official CDP streaming capture](https://chromedevtools.github.io/devtools-protocol/tot/Network/#method-streamResourceContent).

### Request structure

The request consisted of `query_str` and `params`. Relevant parameters included `last_backend_uuid`, `frontend_uuid`, attachments, language/timezone, `search_focus`, `sources`, `mode`, `model_preference`, `is_related_query`, `is_incognito`, `query_source`, `skip_search_enabled`, `use_schematized_api`, `send_back_text_in_streaming_api`, supported block/features and browser/tool-approval flags. `read_write_token` is sensitive access material and must never become telemetry or a token count.

Observed values included `search_focus=internet`, `sources=[web]`, `mode=copilot`, `use_schematized_api=true` and `send_back_text_in_streaming_api=false`. Do not expect a legacy top-level answer-text field in that mode.

### Answer workflow and completion

SSE used `event: message` carrying objects and `event: end_of_stream` with `{}`. Root fields included request/context identities, display/user-selected model labels, `query_str`, attachments, `text_completed`, `blocks`, `message_mode`, `answer_modes`, `structured_answer_block_usages`, `reconnectable`, cursor, classifier/search metadata and terminal status flags.

Blocks included `answer_tabs`, `pending_followups` and `workflow_root` intended usages. Intermediate `diff_block` records targeted `field=workflow_block`; the first observed patch replaced the root path with a workflow object. Later records supplied a complete `workflow_block`. The final answer was located at `workflow_block.steps[*].items[*].payload.text_payload.text`, with parallel `chunks` containing repeated portions of that text. Count the reconstructed text once; do not also add chunks or repeated snapshots. Workflow-item IDs and intended usage distinguish generated answer items from other blocks.

In P-STREAM-01, the initial text payload had `text=""`, `is_streaming=true` and a 54-character first chunk. Subsequent patches used `add` on numbered `chunks` array positions. Later patches replaced `text`, `is_streaming`, workflow statuses and other fields. The final 25 chunks joined to exactly the final canonical text. Therefore use the assembled chunks provisionally while streaming, then replace that provisional view with final `text`. Reading only `text` during the stream would lose partial output on interruption. Reading both would double-count. Other observed diff targets included `web_result_block` and `sources_mode_block`; keep their state distinct from the answer workflow.

The observed answer discriminator is `block.intended_usage=workflow_root`, then `step.items[*].type=WORKFLOW_ITEM_TEXT` with `variant=answer` and a `payload.text_payload`. The three fully recovered Perplexity examples each had exactly one such answer item, with `display_mode=WORKFLOW_ITEM_ALWAYS_EXPAND`; search-query/source items had different types. Follow that item's stable `id` across patches. Display mode alone is not an answer selector. Multiple answer-text items, different text variants or answer-tab selection require additional fixtures and a documented disjointness/selection rule; the reduced decoder rejects those unverified text cases rather than concatenating them into a purported total.

The completed sample had `status=COMPLETED`, `text_completed=true`, `final=true`, `final_sse_message=true`, followed by `end_of_stream`. Verify these together against stop/error examples before defining the production completion rule.

`structured_answer_block_usages` contained a block-kind label, not numerical token consumption. `telemetry_data.has_first_token` and `has_first_output_token` were booleans. `_extras.core_elapsed` was elapsed time, not electricity or token count. No self-describing numerical input/output token totals were found in the fully recovered sample. Source counts do not equal search-call counts, and the source pane may still display sources from an earlier turn.

### Search and recorder failure cases

P-SEARCH-01 recovered 99,807 bytes in 18 frames. The final workflow had a completed step containing `WORKFLOW_ITEM_QUERIES` and `WORKFLOW_ITEM_SOURCES`, followed by a completed answer step containing `WORKFLOW_ITEM_TEXT`. The query payload held one query string. Separate blocks exposed ten `web_results` and a sources-mode `result_count=10`. These are one observed query and ten result records, not ten model requests. The cumulative conversation source pane showed twenty sources while the latest answer showed ten, so a DOM-wide source count is not a per-turn metric.

P-STOP-01's response finished before the stop click could locate its control. It is a normal-completion sample, not a cancellation sample. The recovered stream also contained a comment/keepalive frame without JSON, which a parser must distinguish from malformed data.

P-STOP-02 attempted a second stop test. `Network.streamResourceContent` timed out; two subsequent UI inspections also timed out. After disabling Network diagnostics, UI inspection recovered and showed a naturally completed answer with Submit available. No successful stop click or complete terminal network capture was confirmed. The cause of the temporary unresponsiveness is not established. Do not claim Perplexity cancellation support from either test. This is also a practical reason to measure observer overhead and provide safe teardown.

## Gemini initial observations

UI mode: Thinking, on a work account. No human-readable Gemini model/version string was identified in the inspected generation payloads. M-TEXT-01 and M-TEXT-02 both displayed `TOKEN TEST OK`.

### Request and context references

Actual generation route: `POST /_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate`. Other `/_/BardChatUi/data/batchexecute` requests were preparation/history-related traffic, not extra user generations just because they were POSTs.

Generation query keys were `bl`, `f.sid`, `hl`, `_reqid` and `rt`. Request content type was `application/x-www-form-urlencoded;charset=UTF-8`, with form keys `f.req` and `at`. Opaque session/anti-abuse values and opaque extension headers are intentionally omitted.

`f.req` decoded to a two-element JSON array whose second element was another JSON-encoded string. Decoding that string produced a 99-element positional argument array in both observed requests. The new prompt was at `[0][0]`; context references were in `[2]`. Do not interpret opaque strings or small positional integers as token counters.

The first request's conversation tuple was empty. On the follow-up, its first three entries matched the previous response's conversation ID, response ID and candidate ID. The body carried one new prompt, not a full visible chat-history array.

### Framing and duplicated representations

The HTTP response was `application/json`, not SSE. It began with the XSSI guard `)]}'` and blank lines, then decimal length-prefixed JSON frames. The baseline had ten transport frames, using wrapper tags `wrb.fr`, `di`, `af.httprm` and `e`.

**The observed lengths count UTF-16 code units, not UTF-8 bytes or Unicode code points.** The declared length includes the line feed before and after the JSON block. ASCII samples alone concealed this distinction. In M-UNICODE-01, one frame declared 2,842 units: its payload measured 2,842 UTF-16 units, 2,840 code points and 2,856 UTF-8 bytes. Another declared 2,852 units and measured 2,872 UTF-8 bytes. A byte-offset parser failed; decoding the bytes as UTF-8 and slicing the resulting string by UTF-16 units succeeded. Test split multibyte sequences, surrogate pairs, frame prefixes and nested escaped strings before production use.

For `wrb.fr` records, the third entry could itself be JSON text requiring another parse. Eight such inner frames were present in the baseline. Answer-bearing inner arrays had length 60. Candidate text appeared at `[4][0][1][0]`; another representation repeated it at `[26][0][0][0][1][2]`.

The observed candidate ID was `[4][0][0]`; conversation and response IDs were `[1][0]` and `[1][1]`. Index zero was the displayed candidate in these samples. General candidate selection/reselection is not established. The production adapter must resolve an observed selected candidate ID, then match `[4][i][0]` and read `[4][i][1][0]`; it must not assume that index zero is always selected when multiple candidates appear. If the selected identity cannot be established, retain partial/ambiguous coverage and require a matching live fixture before promoting that mode.

The first answer snapshot was `TOKEN TEST`, followed by three snapshots of `TOKEN TEST OK`. These are replacements/repeated state, not four disjoint output chunks. Track the selected candidate and replace its provisional text. Do not add the duplicate rich representation or all candidates to one answer count. These positions are observed schema facts for this build, not a stable published API.

No self-describing numerical token-usage object was identified. Opaque positional fields have not been semantically mapped, so absence of keyword matches is not proof that every numeric field is unrelated. A Thinking label and opaque mode headers do not establish an official tokenizer or an application context-window capacity.

### Unicode, search and stopping

M-UNICODE-01 returned the expected multilingual text in repeated candidate snapshots. The dispatched prompt already contained precomposed `é`, although the intended test string used a combining accent. Consequently this case does not isolate model-side normalization: the input changed before dispatch somewhere in the UI/automation path. Record and count the dispatched string, not the intended test string.

M-SEARCH-01 produced 21 transport frames and 19 inner records. The visible answer had official IANA links and a source-details control. Candidate metadata at `[4][0][2]` included source/citation structures; the rich representation repeated the links. These are evidence of exposed grounding/source material, not a verified count of all backend search calls. No self-describing token-count field was identified.

M-STOP-01 successfully clicked Stop response. The UI displayed `You stopped this response`. The captured StreamGenerate resource nevertheless ended with `Network.loadingFinished`, 24 framed records and the same wrapper-tag family as normal responses. All ten captured candidate-text snapshots were empty. This supports zero observed answer text in that sample, not zero reasoning, zero computation or zero resource use. Do not assign normal completion solely from HTTP success or the `e` wrapper. Related `batchexecute` calls occurred, but their individual RPC semantics were not established; do not invent a stop endpoint from temporal proximity.

## Test coverage and explicit gaps

The audit dispatched 23 synthetic user actions: seven on Claude including one Retry, five on ChatGPT, six on Perplexity and five on Gemini. Three Perplexity cases have material capture gaps. An intentionally stopped stream without a natural terminal marker is not the same thing as a recorder losing a completed response.

| Case family | Claude | ChatGPT | Gemini | Perplexity |
| --- | --- | --- | --- | --- |
| New chat and follow-up | Captured; parent/history checked | Captured; handoff and socket checked | Captured; context tuple checked | UI checked; first capture truncated, second response body unavailable |
| Longer complete answer | Short calculation and search | Short calculation and search | Search | P-STREAM-01 and P-STOP-01 captured |
| Reasoning display | Empty thinking block observed | Recap and thoughts-display structure observed | Thinking mode; hidden reasoning size unknown | Workflow does not prove internal reasoning size |
| Public search | Two explicit web tool calls | Explicit web tool call; duplicate stream item | Grounded answer and source metadata | One exposed query, ten result records |
| Unicode | Wire input and UTF-8 output checked | Not independently exercised live | UTF-16 framing proved with Unicode | Not independently exercised live |
| Successful user stop | Partial stream plus stop request | Explicit `client_stopped` finish | UI stopped; successful HTTP finish | Not verified; two unsuccessful timing/capture attempts |
| Regenerate | Retry route and alternate branch checked | Not exercised | Not exercised | Not exercised |
| History/reload | Synthetic conversation JSON inspected | Not independently exercised | Context references only | Not independently exercised |
| Attachments, text/scanned PDF, OCR | Not exercised | Not exercised | Not exercised | Not exercised |
| Temporary chats, auto-routing changes, compaction, edit/send, concurrent chats | Not exercised | Not exercised | Not exercised | Not exercised |
| Actual Chrome / Edge / Firefox packaged extension | Not tested | Not tested | Not tested | Not tested |

The recorder did not expose `Browser.getVersion` through its supported raw-CDP method set. Record the tested host as Codex in-app browser on Windows, dated 9 September 2026; do not invent an engine version or minimum browser support. Consumer UI/model labels in this report are observed evidence, not official model compatibility claims.

Attachments were not uploaded in this audit. A text-file or PDF production path must not be inferred from empty `attachments` arrays. Phase 1 still needs synthetic upload fixtures covering local file selection, document parsing, server extraction/OCR, retrieval and failed/unsupported uploads. A browser text extraction can be counted locally but cannot establish provider-side OCR/image tokens or selected retrieval chunks.

## Counting design that follows from the evidence

### Keep different questions separate

1. **What did the person newly type?** Count the actual dispatched prompt or new message text. A composer draft is a preview, not consumption. Claude Retry can have an empty new prompt without an empty logical input.
2. **What text did the answer expose?** Reconstruct the canonical answer once, preserving actual Unicode and Markdown. Count final assembled text, not the sum of stream-chunk counts.
3. **What additional work was visible?** Keep reasoning display, tool calls, tool-result displays, source/query counts and attachments in distinct fields. Visibility does not establish that all these fields are disjoint model-token categories.
4. **What did the model process in total?** Usually unknown from these captures. Server-held history, system instructions, memory, cached input, tool selection, OCR, compression and hidden reasoning can change it. A reconstructed active-branch estimate is a different scope from new-input text.
5. **How much did the conversation cost environmentally?** Apply a compatible versioned estimation profile to its supported workload inputs. None of these endpoints exposed measured joules, watt-hours, CO2e, cooling water, actual GPU allocation or serving grid location.

### Tokenizer selection, without inventing precision

| Site | Immediate implementer rule | Required accuracy work |
| --- | --- | --- |
| Claude | Resolve the observed label only through a reviewed registry. Use a labeled local proxy for observed text if available; do not promote the historical Anthropic tokenizer to modern-model exactness | Compare candidates on the licensed synthetic corpus using an explicitly supplied maintainer key and the model-specific counting endpoint, as specified in Contracts 3.6. No key or count-API calibration was used in this audit |
| ChatGPT | A published, pinned tokenizer can count supplied text exactly under that encoding; an unverified website-model mapping remains approximate | Verify the current official encoding mapping for the actual supported model. No complete request count follows just from counting the browser-visible answer |
| Gemini | Do not map the UI word Thinking or opaque header values to a particular tokenizer | Validate a supported model mapping/local tokenizer or publish a measured proxy profile. Keep model identity unknown when only a mode is exposed |
| Perplexity | `pplx_pro` is not a tokenizer name and does not identify Llama/Sonar/GPT/Claude | Test explicit underlying-model modes separately. Automatic routing needs an explicitly labeled proxy or an unknown mapping |

No single tokenizer has been proved closest for all four consumer sites by this audit. Do not add a universal characters-divided-by-four rule, fixed percentage correction, latency-to-token conversion or quota-to-token conversion and call it accurate. The existing P3 holdout/error gates still apply.

### Resource estimates and context guidance

Preserve the existing calculation contract: serving-IT electricity is estimated by a workload-compatible method; facility electricity applies PUE only if the source excludes it; electricity-related CO2e applies grid intensity; direct cooling and electricity-supply water retain their respective denominators and are added only with compatible boundaries. Token counts do not identify the physical factors by themselves.

For Claude, the normal useful display is observed input/output text counts plus an applicable labeled resource estimate. Details lists the actual model-label evidence, tokenizer profile/error status, estimation factors and excluded/unknown components. Missing private reasoning alone is not a broken-capture state. If only a broad model-class proxy is supported, identify the assumed class and range; do not silently substitute an exact model profile. If no compatible factor exists, preserve the token counts and explain which resource component is unavailable.

None of these samples exposed a verified remaining/occupied model context window. Claude quota percentages, ChatGPT empty model-limit arrays and Gemini positional integers cannot drive the 50% warning. Use verified app-specific capacity where available elsewhere; otherwise use the labeled advisory budget already specified in CONTEXT-GUIDANCE.md. Reconstructed active context, conversation size and cumulative token use are different numbers.

## Concrete implementation sequence

### 1. Development recorder and evidence

- Observe authorized synthetic traffic only. Attach before dispatch, enable request/response/WebSocket events, collect with cursors, and record truncation and missing targets.
- Prefer buffered bytes plus subsequent live data when completed-body retrieval fails or misdecodes. Avoid double-adding buffered bytes and live chunks. Record a capture-start boundary per resource.
- Account for HTTP content encoding separately from UTF-8 and application framing. Claude gzip, SSE framing, WebSocket envelope JSON and Gemini positional framing are different layers.
- A debugger recorder is development tooling, not the employee extension's runtime. Its broad access is not authorization for a shipped extension to request debugger/cookies/history permissions.
- Preserve a private-memory capture only as long as needed to derive a reviewed synthetic fixture. Sanitize before any file write, log, issue, model review or company upload. Do not export an authenticated HAR to the repository.

### 2. Shared production observation bridge

- Install packaged, site-scoped observers at document start using each browser's verified mechanism. Observe the original request/response without replaying it or changing headers, body, credentials, cancellation or response order.
- Support the transport actually used: response streams for all four sites and WebSocket receive events for the tested ChatGPT mode. Attaching late to an existing socket needs a documented partial-coverage/DOM reconciliation path. Do not force socket reconnection or page reload just to obtain counts.
- Handle relevant `fetch`, XHR and worker/frame paths only when evidenced. A page-world hook cannot automatically see a request made inside a dedicated worker. Mark that coverage gap instead of treating a quiet hook as no AI activity.
- Bound every observer queue, decode buffer, nesting depth and frame size. Cancel only the measurement branch on overflow. A cloned response can buffer unboundedly when its reader falls behind; worker tokenization alone does not solve that capture-side problem.
- Validate messages crossing from the page world into the extension. Page data is untrusted and must not select an arbitrary company URL, invoke privileged actions, change the token registry or supply an authenticated user identity.

### 3. Provider normalization

| Adapter | Required state machine work |
| --- | --- |
| Claude | Decode actual body encoding; match both completion routes; track content blocks by index and IDs; accumulate text/input-JSON deltas; separate tool results/citations/thinking; reconcile alternate branches; combine explicit stop UI/request with stream termination |
| ChatGPT | Correlate handoff topics; ingest subscribe catchups and live items; deduplicate verified item IDs; decode nested SSE; apply private delta inheritance and type-aware operations; retain separate message IDs/roles/channels; use interrupted finish metadata rather than a generic stream-end flag |
| Gemini | Parse form and both JSON layers; validate positional shapes; decode UTF-8 incrementally then length-frame in UTF-16 units; decode inner records; update candidate snapshots by identity; separate rich-text duplicates/sources; use independent stopped/completed UI evidence where wire semantics remain uncertain |
| Perplexity | Parse SSE/comments; track blocks and workflow items; support verified diff targets/operations; reconcile final snapshots; select canonical text payloads; distinguish observed query/tool/result counts; handle natural client aborts without labeling all aborted requests as user cancellation |

Never infer extra model attempts from multiple chunks, candidates, source panels, telemetry POSTs, reconnects or assistant/tool display messages alone. A user retry is a new user action; a repeated server snapshot is not.

### 4. Ledger, display and company synchronization

Use the existing Request/Attempt contracts and versioned revisions. Keep durable numerical progress when a response is stopped or capture fails. Upload allowlisted numerical/categorical records only, not raw prompt/answer/tool text, query strings, URLs, titles, provider credentials or raw provider IDs.

Track parsing health independently from measurement scope. A successful observed-text count with unknown hidden reasoning is normal estimated coverage. An unknown frame, capture overflow or missing request body is a concrete capture failure. C10 must explain the affected component, while retaining valid independent numbers. A zero is allowed only for a known-zero component, such as empty observed answer text in M-STOP-01, not for unknown backend work.

### 5. Remaining promotion gates

- Reproduce the basic, follow-up, stop, retry/edit, Unicode and search flows with the actual packaged extension in Chrome, Edge and Firefox. These in-app captures do not close that twelve-combination gate.
- Capture uploaded plain text, text PDF and scanned PDF; compare the local visible/extracted text boundary to what the provider actually exposes.
- Exercise existing sockets, navigation/reload, concurrent tabs, compaction, authentication expiry, offline/network cuts, response-body caps, parser drift and duplicate/reordered events.
- Compare provider request/response bytes and host UI behavior with the observer on/off. No extension-caused prompt mutation, consumed stream, blocked Stop/Send/upload or extra provider call is acceptable.
- Validate tokenizer parity/holdout errors and resource factor compatibility independently. A protocol replay test does not prove tokenizer accuracy or environmental accuracy.

## Companion evidence and tests

The [reduced fixtures and reference tests](../../fixtures/browser-audit-2026-09-09/README.md) use synthetic identities and abbreviated structures derived from this audit. They exercise framing, Unicode, repeated snapshots, catchup deduplication, stopping semantics and misleading token-like fields. They are not raw captures, a production adapter or proof of every private-schema variant. The implementation acceptance document adds specific live and offline gates for the remaining work.

## Reproducing the synthetic tests

Use a fresh authorized test conversation on each site. Replace `X` below with `C`, `G`, `M` or `P` so captured dispatches can be attributed without copying private conversation content. Begin collection before pressing Send. Do not resend merely because a preparation request appeared before the generation request.

| Case | Synthetic prompt or action |
| --- | --- |
| Baseline | `Reply with exactly: TOKEN TEST OK` |
| Follow-up | `AFT-X-02: Repeat the exact three words from your previous reply. Add nothing else.` |
| Reasoning | `AFT-X-THINK-01. Without using tools, find the smallest positive integer divisible by every integer from 1 through 15. Check your answer carefully, then explain it in at most 60 words.` |
| Unicode | `AFT-X-UNICODE-01. Reply with exactly this line, preserving Unicode and accents:` then a newline and `Grüner Fußabdruck 🌿` plus a vertical bar, `café`, another bar, `你好`, another bar, and `e` followed by U+0301. Record the actual dispatched code points |
| Public search | `AFT-X-SEARCH-01. Use public web search only to find IANA's official explanation of example.com. Do not use connected apps or files. Give a two-sentence answer and one official source link.` |
| Stop | `AFT-X-STOP-01. Do not use tools. Write a numbered list of 150 distinct short ideas for reducing ordinary office waste. Start the list immediately.` Perplexity/Gemini also said not to search. Click the site's Stop control as soon as the intended stage is visible |
| Perplexity stream recovery | `AFT-P-STREAM-01: Without searching the web or using connected apps, explain in about 150 words how browser extensions can estimate visible text tokens. Start with AFT STREAM START and finish with AFT STREAM END.` |
| Second Perplexity stop attempt | `AFT-P-STOP-02. Do not search or use tools. Start a numbered list of 150 office waste-reduction ideas, explaining each in two sentences.` This attempt did not produce a verified cancellation |
| Claude regeneration | Click Retry on the second assistant answer, then inspect the new request and returned branch |

The protocol-reference tab may be kept for the next implementer. Temporary Network diagnostics were disabled on all four inspected AI tabs at the end of this audit. The synthetic conversations remain in the user's accounts; no existing chats were deleted or modified, and no account/model settings were changed.

## Handoff verification

The reduced reference suite passed all 32 tests on Windows with Node v24.12.0. Local Markdown link targets and the tracked-document whitespace check passed. A separate fresh-reader review identified candidate-selection, answer-item selection and reasoning-display ambiguities; all three were clarified and the reviewer confirmed those fixes. That review checked the documentation and reduced examples, not independent live captures or a production extension.

The audit's contribution is specific protocol evidence, reproducible reduced cases and explicit remaining gates. It does not guarantee that consumer-site updates will never require debugging or adapter maintenance.
