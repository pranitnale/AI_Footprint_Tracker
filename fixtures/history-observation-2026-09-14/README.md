# Minimized historical-response shapes

The conductor inspected normal history responses for previously authorized synthetic conversations in native Chrome on 14 September 2026. No generation request or upload was made for this inspection. Authenticated response bodies were processed transiently and discarded. The JSON files here replace all message text, identities and dates with synthetic values. They are structural test fixtures, not raw captures or evidence of measured physical resource use.

## Perplexity

Observed route: `GET /rest/thread/{conversation UUID}`. The inspected response held two entries in increasing `entry_created_datetime` order. These timestamps carried an explicit UTC offset and fractional seconds. The separate `updated_datetime` was an unzoned thread timestamp and must not be substituted for a request's occurrence date.

Both entries satisfied `frontend_uuid == uuid` and `thread_url_slug == the opened route UUID`. The first entry's `backend_uuid` also equaled that route UUID; the second backend ID differed. Context IDs were shared between entries but differed from the route. `first_entry` repeated the first entry; `latest_entry` and `next_cursor` were null and `has_next_page` was false.

Visible answer text was under `blocks[intended_usage=workflow_root].workflow_block.steps[].items[type=WORKFLOW_ITEM_TEXT].payload.text_payload.text`. The item and payload variants were `answer`, `is_streaming` was false, and workflow/step states were `WORKFLOW_COMPLETED`. The full text was repeated by the concatenation of the string-valued `chunks` array. Count one representation only. Other observed block kinds included plans, web results, answer tabs, sources and follow-ups; they are omitted from the minimized fixture and are not answer text.

The capability-like `read_write_token` existed in the response. The fixture contains a plainly synthetic sentinel so tests can prove it is never projected. No real capability value was retained.

The narrow first-available-request rule requires the designated `first_entry` to match the first primary entry on UUID/frontend identity, route, the route-root backend identity, source date and canonical query. That route-root backend occurrence must be unique, and the primary entries must have valid increasing source dates. The duplicate pointer is never another counted message. Mismatches leave the root unverified. This is an explicit first-entry proof, not an inference from `has_next_page:false`; it retains `loaded_messages` scope and never claims all branches or provider executions are complete.

This observation does not establish pagination direction across multiple pages or every relationship between workflow output IDs and live generation identifiers.

## ChatGPT

The current application requested the plural endpoint `GET /backend-api/conversations/{conversation UUID}`. An initial capture looking for the older singular path did not capture a history body; the observed plural path was then captured during ordinary reload.

The response used a flat `messages` array, not a `mapping` tree. The inspected fixture had eleven records: two user messages, two final assistant text messages, two assistant reasoning recaps, three tool records and two hidden system records. Stable message IDs and `metadata.request_id` were UUIDs. The request ID grouped a user message with its corresponding response records; `turn_id` differed between the user and assistant portions. Some parent links were absent or pointed outside the flat page. Do not reconstruct a complete tree or request identity from array position, turn ID or timestamps.

`create_time` was a Unix-seconds number. Its order was not strictly the array order; the synthetic fixture preserves that property. Final visible answers used `author.role=assistant`, `channel=final`, `content.content_type=text`, string-valued `parts`, and `metadata.is_complete=true`. Hidden system, tool output and reasoning recaps must not be counted as ordinary user prompts or final answer text.

The conversation ID matched the opened route. `page_info.start_cursor` equaled the first message ID, `end_cursor` equaled the last, both page-direction flags were false, `current_node` equaled the last message ID and `context_truncation_continuation` was null. A later ordinary reload confirmed those same boundary conditions; only a hidden system record preceded the first visible prompt. Its request query keys included `include_has_versions` and `num_turns`. A narrow first-available-request rule can validate these conditions while retaining `loaded_messages` branch scope. This does not establish every alternative branch or provider execution. Missing, conflicting or incomplete boundary evidence must remain partial.

## Claude

An ordinary GET to the organization's `chat_conversations/{conversation UUID}` path exposed two `chat_messages`. The request's query keys were `tree`, `rendering_mode`, `render_all_tools`, `include_inline_comparison` and `consistency`; the raw organization identity is not retained here.

The conversation UUID matched the opened route. `current_leaf_message_uuid` matched the assistant message, whose parent UUID matched the human message. The human message had index zero and parent `00000000-0000-4000-8000-000000000000`. Both messages had `truncated=false`, and their `created_at` and `updated_at` were ISO strings with an explicit timezone. This observed root sentinel and selected-leaf parent chain support a bounded root rule; they do not prove every provider execution or every alternative branch was loaded.

The top-level message `text` was empty. Actual visible text was in `content` blocks with `type=text`, string `text`, timestamp strings and empty `citations`. Count that canonical text once. Human and assistant were the observed sender values. The inspected messages had no completion-request or response identifier field, so no historical-to-live execution identity is inferred from this shape.

The synthetic human message also had one attachment. Its `extracted_content` was a string, and file size was numeric. The fixture uses an invented filename, identifier and short marker. Extracted file text needs its own component and coverage; it must not be silently added to the ordinary prompt or treated as proof of full attachment processing. No original filename or attachment text was retained.

## Gemini

The conductor opened the existing authorized Token Test Confirmation conversation in the in-app browser. Its normal history request was the `hNvQHb` RPC through `POST /_/BardChatUi/data/batchexecute`. The eight request arguments had the shape `[conversation,10,null,1,[1],[4],null,1]`, with `conversation` exactly `c_` plus the opened hexadecimal route suffix. No new generation, upload or provider request was issued by the extension.

The selected `wrb.fr` row held a JSON string at index two. Its decoded payload was `[turns,null,null,[]]`. Five turns appeared newest first. Each turn was an array of five entries:

1. `[conversation ID, response ID]`, using `c_` and `r_` identities.
2. A prior-turn tuple `[conversation ID, response ID, selected candidate ID]`, or null for the oldest turn.
3. An eleven-position prompt record, with the canonical prompt string array at index zero.
4. A twenty-six-position response record. Index zero held candidates, and index three identified the selected `rc_` candidate. A candidate's index zero was its ID; index one was its canonical answer string array.
5. A timestamp pair `[Unix seconds, nanoseconds]`. All five observations had microsecond precision; their nanosecond component was divisible by 1,000.

Every prior tuple matched the next older loaded turn and its selected candidate. The oldest prior tuple was null. This supports a bounded linked-chain root rule for the inspected shape, not completion of every possible branch or provider execution. No historical model version was established. The inspected response had one candidate per turn; a parser must match the explicit selected candidate identity rather than count every candidate.

The stopped turn's canonical answer was empty while candidate index thirty-seven contained substantial reasoning. An empty answer is not evidence of zero total work or a completed generation. The separate rich-text representation at response index twelve repeated the canonical answer in three turns and differed for the search response. It is not an additional answer. The fixture replaces this with synthetic duplicates to test exclusion, and includes a synthetic reasoning sentinel that must not be counted as a final answer.

The captured batch response contained an XSSI prefix and three decimal-length/JSON-line frames. For each, the declared length was the JSON line's JavaScript character length plus two. Naively slicing that many characters across the normalized CDP body crossed into the next frame. This observation does not establish all wire encodings or permit changing the existing live-generation framing rules. History framing needs independent bounded parsing and malformed/truncated tests.

A later metadata-only reload showed `Network.requestWillBeSent.type=XHR` and `Network.responseReceived.type=XHR` for the Gemini history POST, with HTTP 200. The implementation therefore needs passive XMLHttpRequest observation as well as Fetch. That later wider event buffer reported truncation; the selected request/response transport classifications were present. A corresponding three-provider Chrome transport check ended with detached diagnostic sessions, so it did not establish those providers' transport types. All temporary captures were disabled or already detached afterward.

## Capture limits

The selected response bodies parsed successfully. The wider network event buffers reported truncation during the ChatGPT and Perplexity captures; the Claude and Gemini captures did not report truncation. These observations do not establish complete traffic coverage or the absence of other events. No unrelated conversation, raw response body, screenshot or original identifier is included in these fixtures. The universal Claude root sentinel is a protocol constant, not a user's identifier.
