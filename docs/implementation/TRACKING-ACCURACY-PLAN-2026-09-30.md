# Tracking accuracy audit and fix plan

Audit date: 30 September 2026. Scope: every way Claude, Claude Cowork, ChatGPT (including Work), Perplexity and Gemini produce model output, and whether the tracker captures, counts and attributes it to the right model. Claude Code is out of scope at the owner's request.

This document is the plan. It does not change behavior. Section 9 lists the owner decisions this plan depends on.

## 1. Summary

The tracker is not failing loudly. It is **undercounting quietly**. For the owner's real accounts, most model output never reaches the estimate:

| Tool | What the tracker counts today | What it misses (measured on the owner's accounts) |
| --- | --- | --- |
| Claude chat | Visible answer text only | Tool input written by the model (files, code, email drafts, artifacts): about **1.8 times** the visible text across 120 chats. Hidden thinking: **6.9 hours** of thinking time across the same chats, never estimated. |
| Claude Cowork | Nothing. The bar says "Waiting for an observed request" | Everything. One session alone reports **$83** of usage. Cowork exposes exact provider token counts that the tracker never reads. |
| ChatGPT | Final answer text of recognised turns | Tool calls, Work progress messages, turn plans and reasoning summaries: about **50%** of the counted text again. **47 minutes** of hidden reasoning in 50 chats. Most messages come from models the tracker does not recognise. |
| All tools | EcoLogits energy uses only `answer_output` | Visible thinking is counted and shown but **excluded from the energy estimate**. `output_total` is never filled. |

Model identification is also broken for the current models. `claude-opus-5-5` (28 of the owner's recent Claude chats), `gpt-6-astra-wm` (219 ChatGPT messages), `gpt-5.6-sol-wm`, `gpt-5-6` and `gpt-5-4-thinking` all fall back to a benchmark proxy. This happens even though this morning's EcoLogits 0.11.2 update put Claude Opus 5.5, Sonnet 5.5, GPT-6 Astra, Luna, Sol and 6.1 Sol into the catalog. That update imported the catalog only. Website recognition was explicitly left out, as its own release note says. History import attaches a model only for Perplexity, so every imported Claude, ChatGPT and Gemini message is estimated with the proxy. Under the 16 September rules, the proxy is `gpt-5.2-chat-latest` for unrecognised ChatGPT models and the GPT-5.5 benchmark for other unrecognised models.

## 2. How the evidence was collected

- **Code review** of adapters, capture runtime, coordinator, history import, contracts and estimator on the consolidated `main` (commit `0d91f28`).
- **Provider web-app bundles.** The complete public claude.ai bundle (2,636 chunks) was searched for stream event names, content block types, delta types, endpoints and widget tool names. The same was done for the logged-out ChatGPT and Perplexity bundles.
- **Live, read-only inspection** in the owner's Chrome with the installed tracker. It read the owner's Claude (Team plan), ChatGPT (Pro) and Perplexity (enterprise org) history through the sites' own APIs. Only structure, counts, lengths and model labels were logged. No message text was stored or copied into this repository.
- **Three live test prompts on Claude**, with a fetch probe that tallied stream event types only:
  - an email draft;
  - web search plus file creation;
  - a Cowork session switch (no message sent).
- **Numbers.** Character counts are exact. Token figures marked "estimate" use about 4 characters per token or the Cowork-calibrated rate in section 5.3.

Live checks for Gemini and Perplexity sending were blocked because the automation window was minimised. Chrome then throttles pages and Gemini refuses to send. Those rows say "code and bundle only" and are listed in section 8 as open verification.

## 3. Cross-cutting defects (all tools)

| ID | Defect | Where | Effect |
| --- | --- | --- | --- |
| X1 | `output_total` is never populated. EcoLogits and the Original method both use `output_total ?? answer_output`. | `packages/contracts/src/observation-evidence.ts:63`, `packages/estimator/src/original.ts:155`, `apps/extension/lib/coordinator.ts:1428` | Visible thinking tokens are counted and shown, but they do not affect energy, carbon or water. Tool input and reasoning never reach the estimate. |
| X2 | Only three count fields exist on the capture path: `input`, `answer`, `thinking`. `tool_input`, `tool_output`, `reported_reasoning` and `output_total` exist in the schema but are never written. | `coordinator.ts:1428-1440`, `packages/contracts/src/index.ts:138` | There is no place to put tool-call output or provider-reported totals. |
| X3 | Hidden reasoning is recorded only as the coverage reason `hidden_reasoning_unobserved`. No estimate is made, although every provider exposes reasoning duration. | adapters `initialSnapshot()`, estimator | Reasoning-heavy replies are underestimated by the largest single amount. |
| X4 | History import sets `modelId` only for Perplexity. | `packages/adapters/src/history/*.ts`, `apps/extension/lib/history-service.ts:759` | Every imported Claude, ChatGPT and Gemini message uses the benchmark proxy, even when the provider states the exact model. |
| X5 | `normalizeModel` recognises a model only if its raw label is `<site>-...` and listed in `MODEL_IDS`, or matches one hard-coded alias. | `apps/extension/lib/models.ts`, `packages/contracts/src/model-ids.ts`, `config/estimation.mappings.json` | Real provider labels (`claude-opus-5-5`, `gpt-6-astra-wm`, `gpt-5-6`, ...) are unknown. |
| X6 | Live capture stops after 600 seconds and cancels the stream reader. | `apps/extension/lib/capture-runtime.ts:769,802` | Long agentic turns (a Cowork turn in the data ran 631 s; ChatGPT Work and deep research often run longer) are cut off and counted from partial text. |
| X7 | At most 4 concurrent captures. A ChatGPT reply that looks completed but never receives the WebSocket terminal holds its slot for up to 600 s. | `capture-runtime.ts:550-562, 743-771` | After 4 such replies, new replies in the tab are dropped with only a `buffer_overflow` health entry. |
| X8 | If `session.snapshot()` throws (for example ChatGPT `ambiguous_candidate` or text over 2,097,152 characters), only a health message is sent. No terminal frame reaches the ledger. | `capture-runtime.ts:188-190` | The attempt stays `generating` until `recoverInterrupted` runs at the next worker start. The energy estimate is then likely stale. |
| X9 | Every progress frame recounts and **overwrites** the token measurement. A failed count on the final frame turns a known count into unknown. | `coordinator.ts:1428-1440`, `count-host.ts:129-151` | A 16-job queue shared with history import, or a 20 s timeout, can erase a good count. |
| X10 | The content script drops more than 16 capture messages per second. `activeCaptureIds` is cleared only on `end`. After 32 captures that die without `end`, every new reply in the tab is dropped. | `apps/extension/entrypoints/content.content.ts:994-1038` | Silent loss until reload. |
| X11 | Unknown stream frames are treated as a capture failure by design. The providers add new frame types every few weeks, so the design turns ordinary vendor changes into "Tracking problem". | all adapters | See C3 and C4. Each new vendor frame breaks tracking for that reply. |

## 4. Findings by tool

### 4.1 Claude chat, Projects and artifacts (highest priority)

Owner account facts (live): Team plan (`raven` capability), one organisation, 391 chats, of which 167 are in 49 Projects. Models on recent chats:

| Model | Chats |
| --- | --- |
| `claude-opus-5` | 122 |
| `claude-sonnet-5` | 37 |
| `claude-opus-5-5` | 28 |
| `claude-opus-4-8` | 9 |
| `claude-opus-4-6` | 2 |
| `claude-sonnet-4-6` | 2 |

Thinking mode: `auto` in 243 chats, `extended` in 14, `off` in 125. Effort: `medium` in 324 chats, `high` in 54, `xhigh` in 1.

**Tool output generated by the model** (all 391 chats, characters of tool-call input JSON; none of it is counted today):

| Tool | Calls | Model-written input | Tool result (context, not output) |
| --- | --- | --- | --- |
| `create_file` (files, documents, artifacts) | 328 | 6,268,304 | 35,544 |
| `bash_tool` | 4,824 | 3,341,718 | 15,975,686 |
| `str_replace` (file edits) | 552 | 642,459 | 69,429 |
| `view` | 1,553 | 133,409 | 4,759,009 |
| `web_search` | 1,151 | 103,310 | 3,800,579 |
| `visualize:show_widget` | 18 | 80,277 | 6,744 |
| `present_files` | 413 | 35,655 | 136,442 |
| `ask_user_input_v0` | 60 | 33,521 | 46,550 |
| `web_fetch` | 306 | 32,896 | 95,105 |
| `message_compose_v1` (editable email and message drafts) | 11 | 17,525 | 20,051 |
| `Artifact` | 12 | 3,805 | 45,129 |
| others (memory, past-chat search, project knowledge, image and places search, widgets) | 54 | 5,300 | 1,050,000 approx. |

For comparison, visible answer text in the 120 most recent chats was 1,801,630 characters, and tool input in the same chats was 3,259,526 characters.

| ID | Defect | Evidence | Effect |
| --- | --- | --- | --- |
| C1 | **Tool input is ignored.** `input_json_delta` is accepted but its content is discarded. The same applies to `tool_use.input` in history. | `packages/adapters/src/claude.ts:97-106`, `history/claude.ts:34`. Live: an email test counted 156 characters of text (31 tokens in the bar) and ignored the 440-character email. A file test counted 475 characters and ignored the 406-character file. | Emails in the editable card, artifacts, generated documents, code and edits are not counted. Largest single gap. |
| C2 | **Hidden thinking is not estimated.** All 1,469 thinking blocks in 120 chats are summary-only (`thinking` empty, `summaries` present, `start_timestamp`/`stop_timestamp` present), totalling 24,853 s. | Live history scan, live SSE (`thinking_summary_delta`) | Estimate: about 1.5 million hidden reasoning tokens at the Cowork-calibrated rate (section 5.3), against about 0.45 million tokens of visible text in the same chats. |
| C3 | **Completion route variant `completion2` / `retry_completion2` is not matched.** claude.ai selects it with the flag `claude_ai_clients_completions_use_bard` or a per-conversation backend `c2`. | Bundle: `url: /api/organizations/${t}/chat_conversations/${n}/${i}` with `i += "2"` for backend `c2`. Route regex: `dispatch.ts:17`. The owner's account used `/completion` on 30 September. | When the flag reaches this account, nothing is captured and no error is shown. |
| C4 | **About ten new stream events and block types fail the capture.** Events: `compaction_status`, `cache_performance`, `model_fallback`, `model_update`, `content_block_retract`, `tool_approval`, `mcp_auth_required`, `mcp_elicitation(_complete)`, `composer_notice`, `notice_poll_hint`, `melange_edit_result`. Blocks: `flag`, `compaction`, `connector_text`, `server_tool_use`, `mcp_tool_use`. | Bundle event enum next to the completion handler. Parser `claude.ts:62-69` and `default: throw` at `:130`. | Any reply that triggers one of these shows "Tracking problem" and is counted partially. |
| C5 | **More than one `message_start` in one stream** ("primary rotated" or model fallback) and **`content_block_retract`** reuse block indexes. The parser throws `conflicting_duplicate`. | Bundle handler (`ve>1`, `F.retract(from_index)`). `claude.ts:70-71`. | Capture fails exactly when Claude does extra work: a fallback model generates a second reply, and the retracted blocks were still generated. |
| C6 | **Stop reasons other than `end_turn`/`stop_sequence`/`max_tokens` never complete live**, and history accepts only `end_turn`. | Owner data: `stop_sequence` 47, `user_canceled` 57, `tool_use_limit` 12, `compaction` 1. Code: `claude.ts:111`, `history/claude.ts:47`. | These replies end as `interrupted_unconfirmed` or incomplete history, lose timing evidence and get the wrong labels. |
| C7 | **`claude-opus-5-5` is not recognised.** `claude-sonnet-5-5` is not recognised either (in the catalog; also in the bundle for Sonnet 5.5 via Cowork). | Live `message_start.model` = `claude-opus-5-5`. `MODEL_IDS` lacks it. | Opus 5.5 replies use the benchmark proxy instead of their own EcoLogits profile. |
| C8 | **History import has no model.** Claude history rows carry no per-message model, but the conversation carries `model`, and the live stream carries `message_start.model`. | `history/claude.ts`, conversation list field `model` | All imported Claude messages use the proxy. |
| C9 | **AI-powered artifacts are untracked.** Artifacts that call Claude send `POST /api/organizations/{org}/proxy/v1/messages` from the claude.ai page. The response is a Messages API body, which normally includes exact `usage`. | Bundle (`KO={"api.anthropic.com": .../proxy/v1/messages}`, headers `anthropic-artifact-id`) | Every use of an interactive AI artifact is missed. |
| C10 | **Voice mode is untracked.** It uses `wss://claude.ai/api/ws/voice/.../chat_conversations/{id}`, and WebSockets are only proxied for ChatGPT. | Bundle | Voice conversations are missing. |
| C11 | **Project context is never counted as input.** Project knowledge, project instructions, memory and past-chat search results are added server-side. The bar's "In" is only the typed prompt. | 167 project chats; `project_knowledge_search` returned 166,583 characters in 8 calls | The "In" figure understates what the model read. EcoLogits energy does not depend on input, so this is a display issue rather than an energy issue. |
| C12 | **Conversation compaction.** A reply can stop with `compaction` and a `compaction_status` event. The compaction summary is a separate model call. | Owner data (1 case). Bundle `compaction_delta`. | Unknown frames fail today (C4). The summary output itself is uncounted. |

Projects themselves need no new route. Project chats open at `/chat/{uuid}` and use the same completion endpoint, and live capture and history import already treat them like other chats. Their extra input context (C11) is the only project-specific gap.

### 4.2 Claude Cowork (priority)

Live facts: Cowork sessions run in Anthropic's cloud (`environment_kind: anthropic_cloud`, tags `cowork-remote`). They are opened at `claude.ai/cowork/{session_id}` (`cse_...`). The page loads:

- `GET /v1/code/sessions/{id}` (session, including `external_metadata.usage` with input, output, cache read and cache write tokens and `cost_usd`)
- `GET /v1/code/sessions/{id}/events?limit=500&cursor=...` (full event history, paged)
- `GET /v1/code/sessions/{id}/events/stream?from_sequence_num=N` (live server-sent events)
- sending uses the same `/v1/code/sessions/{id}/events` resource

Events are Claude Agent SDK messages (`system`, `assistant`, `user`, `result`, `rate_limit_event`, `control_request`, `autocompact_state`, ...). The per-turn `result` event reports, from the provider:

- `usage.output_tokens`
- `usage.output_tokens_details.thinking_tokens`
- `usage.input_tokens`, `cache_read_input_tokens` and `cache_creation_input_tokens`
- `usage.server_tool_use` (web search and fetch counts)
- `modelUsage` per model, including Claude Haiku 4.5 side calls
- `num_turns`, `duration_ms`, `duration_api_ms` and `total_cost_usd`

Example from the owner's data: one turn with 54,594 output tokens (33,559 thinking), 39 model calls and 631 s wall time.

| ID | Defect | Effect |
| --- | --- | --- |
| W1 | No capture route, parser or history reader for `/v1/code/sessions/...`. | Cowork shows "AI usage · Waiting for an observed request" and records nothing. |
| W2 | Page routes accept only `/chat/{uuid}`. | Even a Cowork history importer would be refused by the route authority (`packages/capture-core/src/routes.ts`). |
| W3 | Cowork keeps working after the tab closes, and scheduled tasks run with no tab open. | A live-only approach misses most Cowork work. It must import completed turns from the events API. |
| W4 | Per-message `usage` inside streamed `assistant` events is a partial snapshot. The sum over messages was 223 against 5,230 in the turn's `result`. | Totals must come from `result.usage` and `modelUsage`, deduplicated by turn, never from summing message snapshots. |
| W5 | A turn uses several models. | Energy must be split per model using `modelUsage`, not attributed to the session model. |

### 4.3 ChatGPT, including Work and Projects

Live facts (owner's Pro account, 50 most recent chats, 521 assistant messages):

- 13 of the 50 chats are Projects (`/g/g-p-{id}/c/{uuid}`).
- Nearly every turn runs asynchronously (`async_source: saserver-...:conversation-turn-...`) and finishes over the WebSocket.
- Work chats have `conversation_origin: "tpp"`, `-wm` model slugs and `work_activity` metadata on most messages (167 of 193 in one chat).

Model slugs observed, as `model_slug | resolved | requested | default | thinking_effort`:

| Slug | Messages |
| --- | --- |
| `gpt-6-astra-wm` | 219 |
| `gpt-5-6-thinking` | 174 (some with `thinking_effort: max`) |
| `gpt-5.6-sol-wm` | 58 |
| `gpt-5-6` | 46 |
| `gpt-5-4-thinking` / `gpt-5-4-auto-thinking` | 15 |

Assistant output by kind, as `role | channel | content type | recipient`, in characters:

| Kind | Messages | Characters | Counted today |
| --- | --- | --- | --- |
| `final` text to `all` | 89 | 141,945 | yes |
| `thoughts` (reasoning summaries) | 139 | 27,104 | no |
| code to `api_tool.call_tool` (connector and app calls) | 92 | 23,692 | no |
| code to `container.exec` (code execution) | 26 | 9,357 | no |
| `commentary` text to `all` (visible Work progress messages) | 29 | 7,863 | no |
| code to `turn_plan.update_turn_plan` | 4 | 2,186 | no |
| `reasoning_recap` | 68 | 1,569 | no |
| other tool calls (`genui.search`, `web.run`, ...) | 70 | about 800 | no |

`finished_duration_sec` totals 2,839 s of reasoning.

| ID | Defect | Effect |
| --- | --- | --- |
| G1 | Only `final` or null-channel `text` to `all` is counted. `commentary` text, tool-call code and canvas documents (`canmore.*`) are discarded (`chatgpt.ts:196-203`). History accepts only `channel === "final"` (`history/chatgpt.ts:37`). | About 34,000 characters of generated tool calls and progress text are missed in 50 chats. Canvas documents, the ChatGPT equivalent of Claude's editable email, are not counted. |
| G2 | Reasoning is never estimated. `thinking` is always null (`chatgpt.ts:242`). `metadata.reasoning_start_time`, `reasoning_end_time` and `finished_duration_sec` are present. | 47 minutes of reasoning in 50 chats, unestimated. |
| G3 | Model slugs are not recognised: `gpt-6-astra-wm`, `gpt-5.6-sol-wm`, `gpt-5-6`, `gpt-5-4-thinking`, `gpt-5-4-auto-thinking`. Only `gpt-5-6-thinking` is aliased. `resolved_model_slug` is never read. | Most ChatGPT messages use the proxy. |
| G4 | **Work chats lose the bar.** The Work page renders two ProseMirror editors. `resolveComposer` requires exactly one candidate and fails closed (`apps/extension/lib/content-placement.ts:83-130`). | No bar and no per-chat totals on Work chats (observed live). |
| G5 | Project chats (`/g/g-p-.../c/{uuid}`) never import history. The route regex accepts only `/c/{uuid}` (`routes.ts:33`). Live capture of new replies still works. | Earlier project messages stay "unknown". 26% of the owner's recent chats are projects. |
| G6 | History message model (`metadata.model_slug`) is not passed on (X4). | Imported ChatGPT messages use the proxy. |
| G7 | Async turns: the terminal status is accepted only when exactly one capture is active (`capture-runtime.ts:718`). Work turns that run longer than 600 s are cut (X6). | Work output is counted partially or ends as `interrupted_unconfirmed`. |
| G8 | Live `finals.length > 1` throws `ambiguous_candidate` inside `snapshot()` (X8). None were seen in history, but Work turns with several final messages are possible. | Terminal frame lost. |
| G9 | The WebSocket host allowlist is `chatgpt.com` and `ws.chatgpt.com` (`capture-runtime.ts:687`). The live host looked compatible, but the probe could not read it. | To verify. If the host moved, every async turn would time out. |

### 4.4 Perplexity (priority; live part pending)

Live facts so far: the account belongs to an enterprise organisation. The sidebar offers Computer (`/computer/tasks`, `/computer/artifacts`), Projects (`/projects/{slug}`) and Library. The thread list APIs used by older builds returned empty lists for this account. The Library loads through `/rest/perplexity_ask/graphql` and `/rest/collections/list_collection_threads`.

Bundle facts: workflow items are `WORKFLOW_ITEM_TEXT`, `TABLE`, `TODO_LIST`, `WIDGET`, `EMBEDDED_IFRAME`, `CONTENT`, `QUERIES`, `SOURCES`, `USER_QUESTIONS`, `USER_RESPONSE` and nested `WORKFLOW`. Text variants include `answer` and `text_final`. The page itself treats `text_final` as an answer variant. Model labels include `pplx_asi_opus_thinking`, `pplx_asi_sonnet_thinking` and `pplx_reasoning`.

| ID | Defect | Effect |
| --- | --- | --- |
| P1 | Only `WORKFLOW_ITEM_TEXT` with variant `answer` is counted (`perplexity.ts:84`, `history/perplexity.ts:84`). The variant `text_final`, generated tables, to-do lists, widget content and nested sub-workflows are ignored. | Research, Labs and Computer outputs are undercounted. Answers delivered as `text_final` may count as zero. |
| P2 | More than one answer item throws `ambiguous_candidate`. Nested workflows and multi-step answers can contain several. | "Tracking problem" on multi-part answers. |
| P3 | Perplexity Computer tasks and artifacts (`/computer/...`) and Projects pages have no capture or history route. | Agent work is untracked. |
| P4 | Reasoning steps (thinking models such as `pplx_asi_opus_thinking`) are not estimated. New labels such as `pplx_asi_*` and `pplx_reasoning` are unmapped. | Proxy model and missing reasoning. |
| P5 | The bar did not appear on the Perplexity home and thread pages during the audit. Cause: the automation window was minimised, so the page viewport was 0×0 and `isVisibleComposerAnchor` correctly refused to place the bar. | Not a defect. Re-check in a visible window during Phase 7. |

Live test (30 September): a query sent through Perplexity's own `?q=` address streamed through `/rest/sse/perplexity_ask` and opened `/search/{uuid}`. The tracker matches both. Reading the thread structure through `/rest/thread/{uuid}` did not complete while the window was minimised, so the item types and variants above come from the bundle, not from the owner's threads.

### 4.5 Gemini (live part pending)

| ID | Defect | Effect |
| --- | --- | --- |
| M1 | Live capture counts only `candidate[1][0]` (`gemini.ts:44`). Thinking text ("Show thinking") and other candidate fields are ignored. | Reasoning output is missing for Thinking and Pro modes. |
| M2 | No completion semantics. Every reply ends `interrupted_unconfirmed` with `completion_semantics_unverified`, so live timing is never kept. | No timing evidence for EcoLogits. Every Gemini reply is labelled partial. |
| M3 | Model is never captured, live or from history. | All Gemini replies use the proxy. |
| M4 | The XHR path requires the exact path `/_/BardChatUi/...StreamGenerate`, so multi-account `/u/N/` paths are missed. Page routes accept only `/app/{hex}`, so Gems (`/gem/...`) and `/u/N/app/...` never import history. | Second Google accounts and Gems are untracked or history-less. |
| M5 | Deep Research, Canvas, image and video generation outputs are not parsed. | Undercount for those features. |
| M6 | The composer selector expects `input-area-v2 rich-textarea [role="textbox"]`. The bar was absent on `/app` during the audit, but the window was minimised (viewport 0×0), which alone explains it. | Re-check the selector in a visible window during Phase 8. |

Gemini would not send a test prompt from the minimised window. A click triggered only the `ESY5D` pre-check RPC and no `StreamGenerate`.

## 5. Target design

### 5.1 Output accounting

Keep every component separate and record its evidence, so that nothing is double counted and each figure can be explained in Details:

| Component | Field | Source per tool | Evidence |
| --- | --- | --- | --- |
| Visible answer | `answer_output` (exists) | Claude text blocks. ChatGPT final text. Perplexity `answer` and `text_final`. Gemini `candidate[1]`. | `local_tokenizer` |
| Visible intermediate text | `answer_output` (append) or a new `intermediate_output` | ChatGPT `commentary` text to `all` | `local_tokenizer` |
| Visible thinking | `visible_thinking` (exists) | Claude `thinking_delta` when present. Gemini thoughts text. | `local_tokenizer` |
| Model-written tool input | `tool_input` (exists, unused) | Claude `input_json_delta` and `tool_use.input`. ChatGPT assistant messages to recipients other than `all` (code, `api_tool.*`, `container.exec`, `canmore.*`, `turn_plan.*`). Perplexity tables and to-do items. | `local_tokenizer` on the decoded argument text |
| Hidden reasoning | new `hidden_reasoning_estimate` | Claude thinking block durations. ChatGPT reasoning start/end or `finished_duration_sec`. Gemini and Perplexity thinking durations when exposed. | `duration_estimate` with a range |
| Provider-reported totals | `output_total`, `reported_reasoning`, `input_*` (exist) | Cowork `result.usage` and `modelUsage`. AI-artifact proxy `usage`. | `provider_reported` |

Rules:

- `output_total` for estimation is the provider-reported output when present. Otherwise it is `answer + intermediate + visible_thinking + tool_input + hidden_reasoning_estimate`, labelled as a composite estimate.
- Reasoning summaries (Claude `summaries`, ChatGPT `thoughts` and `reasoning_recap`) are written by a separate summariser. They are evidence that reasoning happened. They are not counted as model output, so they do not double count with the hidden-reasoning estimate.
- Tool results (search results, file views, command output) are model **input** for the next step, not output. Record them as `tool_output` for display only.
- Tokenise decoded argument text, not raw JSON with escapes. Keep a JSON-overhead note in Details.
- Retokenise complete text at completion (existing rule). Never let a failed final count erase a known earlier count (fixes X9).

### 5.2 EcoLogits input

- Pass `output_total` as `output_token_count`.
- Keep EcoLogits' modeled-time cap. Use the complete generation duration as `request_latency`, including thinking and tool steps. Do not use wall time spent waiting on tools or on the user.
- For multi-model turns (Cowork `modelUsage`), compute one EcoLogits result per model and sum them. Never attribute Haiku side calls to Opus, or the reverse.

### 5.3 Hidden-reasoning estimate

- Estimate = reasoning seconds × a model-class output rate, with a low and high bound.
- Calibrate the rate from provider-reported data where it exists. The owner's Cowork turns give 184,244 output tokens (60,946 thinking) over 3,021 API seconds, about **61 tokens per second** for the Opus 5 and Sonnet 5 class. Store rates as versioned data records (writing standard: formulas in methods, coefficients in data), not in adapters.
- Fall back to the EcoLogits latency model's per-token time for models without calibration.
- Label it "Estimated hidden reasoning" in Details, never on the compact bar. Missing hidden reasoning alone is still not a tracking failure (writing standards).

### 5.4 Model identification

1. **One model registry per site, generated from data.** Map every observed raw label to an EcoLogits catalog record:
   - Claude API names map directly: `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-4-5-20251001` and so on. Accept any raw Claude label that exactly matches an `anthropic` catalog record, with or without a date suffix.
   - ChatGPT: prefer `resolved_model_slug` over `model_slug`. Normalise `gpt-5-6` to `gpt-5.6`. Map the Work suffix `-wm` to the same base model if the owner confirms (section 9). Examples: `gpt-6-astra-wm` → `gpt-6-astra`, `gpt-5.6-sol-wm` → `gpt-5.6-sol`, `gpt-5-4-(auto-)thinking` → `gpt-5.4`, `gpt-5-6-thinking` → `gpt-5.6-sol` (existing alias). The instant model `gpt-5-6` needs an owner decision: `gpt-5.6-luna`, `gpt-5.6-sol` or benchmark.
   - Perplexity: keep the alias table. Add `pplx_asi_*` and `pplx_reasoning` once their vendor models are known, otherwise the benchmark (existing owner rule).
   - Gemini: capture the model label from the StreamGenerate response or the page's model switcher (to verify live).
2. **Carry the model everywhere:**
   - live `message_start.model` (Claude);
   - `model_fallback` and `model_update` events (switch the model mid-reply);
   - ChatGPT per-message slug;
   - Cowork per-model usage;
   - history rows (X4). For Claude history, use the linked live attempt's model first, then the conversation model, as weaker "conversation setting" evidence.
3. **Make unknown models visible.** Record the raw label (bounded, never text) in a diagnostics list and Details. Add a CI test that every `anthropic`, `openai` and `google_genai` catalog record added by an EcoLogits update either has a site mapping or is explicitly marked "not offered in consumer apps". This stops the next catalog update from repeating this morning's gap.

### 5.5 Resilience instead of fail-closed

- **Classify stream frames into three groups:**
  - known and counted;
  - known and ignorable (display or telemetry: `ping`, `composer_notice`, `notice_poll_hint`, `cache_performance`, `tool_approval`, `mcp_*`, `flag` blocks);
  - unknown.
- An unknown **event** type is recorded as a diagnostic, and the reply is still counted from known blocks with the label "Partly measured". Only unknown **content inside a known text or tool block** stays a hard failure. This keeps the owner rule that genuine errors show a compact status, while ordinary vendor additions no longer produce "Tracking problem".
- Support stream structure changes:
  - multiple `message_start` in one stream (each message is its own generated output);
  - `content_block_retract` (keep retracted text as generated output, remove it from the visible answer);
  - `model_fallback` (attribute later blocks to the new model).
- Accept all Claude stop reasons. `end_turn`, `stop_sequence`, `max_tokens`, `tool_use_limit`, `pause_turn`, `compaction`, `refusal` and `model_context_window_exceeded` complete a reply. `user_canceled` ends it as cancelled.
- Replace the 600 s cutoff with an inactivity timeout (for example 120 s without bytes), capped at 60 minutes. Release a slot as soon as a terminal is proven. Evict dead `activeCaptureIds` on a timer.

## 6. Implementation plan

Each phase ends with tests plus a native check on the owner's Chrome, following the probe method in `docs/release/LIVE-CAPTURE-AND-REOPEN-2026-09-26.md`.

### Phase 0. Guard rails (half a day)

- Add the owner decision rows (section 9) to `OWNER-DECISIONS.md`.
- Build synthetic fixtures from the structures recorded here: Claude email, file creation, fallback with retract, compaction, `completion2`, Cowork `result`, ChatGPT Work turn, project route. Fixtures contain no real text.
- Add a provider-drift check. A script lists event names, block types and delta types from the current claude.ai bundle and compares them with the parser's lists. It runs before each release.

### Phase 1. Model identification (1 to 2 days)

**Files:**
- `packages/contracts/src/model-ids.ts`
- `apps/extension/lib/models.ts`
- `config/estimation.mappings.json`
- the native server mapping
- `packages/adapters/src/history/{claude,chatgpt,gemini}.ts`
- `apps/extension/lib/history-service.ts`

**Work:**
- Implement the registry in 5.4.
- Read ChatGPT `resolved_model_slug`, Claude `model_fallback`/`model_update` and history models.
- Add the unknown-model diagnostic and the catalog-coverage test.

**Acceptance:**
- A live Opus 5.5 reply shows EcoLogits profile `anthropic/claude-opus-5-5` in Details.
- `gpt-6-astra-wm` maps to `openai/gpt-6-astra`.
- Imported ChatGPT history keeps each message's model.
- No real label observed in this audit falls back to the proxy unless the owner chose that.

### Phase 2. Output accounting in contracts and estimator (2 to 3 days)

**Files:**
- `packages/contracts` (fields, evidence, reasons, JSON schema, Python mirror)
- `packages/estimator` (`selectOutputMeasurement`, Original method, EcoLogits engine)
- `apps/extension/lib/coordinator.ts` (count fields `tool_input`, `hidden_reasoning`)
- `packages/tokenizers/src/protocol.ts` (`CountField`)
- `packages/ledger`
- the server parity tests

**Work:**
- Implement 5.1 to 5.3.
- Fix X9 by keeping the last good measurement.
- Add the multi-model split.

**Acceptance:**
- For a fixture with 100 answer tokens, 80 tool-input tokens, 50 visible thinking tokens and 10 s of reasoning, `output_total` = 230 + estimate, with the components listed in Details.
- EcoLogits receives `output_total`.
- TypeScript and Python agree.
- A schema version bump is documented, with the local reset rule stated.

### Phase 3. Claude chat capture (2 days)

**Files:**
- `packages/adapters/src/claude.ts`, `dispatch.ts`, `history/claude.ts`
- `apps/extension/lib/capture-runtime.ts`

**Work:**
- Accumulate `input_json_delta` per tool block, decoding `partial_json` safely at `content_block_stop`.
- Count history `tool_use.input`.
- Add thinking durations from block timestamps (live and history).
- Accept the `completion2` and `retry_completion2` routes.
- Apply the frame classification from 5.5.
- Handle multiple messages, retract and fallback.
- Complete on all stop reasons.
- Count history for all stop reasons.

**Acceptance:**
- The email test counts the email body.
- The file test counts the file content.
- A synthetic `compaction_status`, `model_fallback` or `content_block_retract` stream shows no Tracking problem.
- A `completion2` fixture is captured.
- Existing Claude tests still pass.

### Phase 4. Claude Cowork (3 days)

**Files:**
- new `packages/adapters/src/cowork.ts` and `history/cowork.ts`
- `packages/capture-core/src/routes.ts` (`/cowork/{cse_id}`)
- `history-route.ts`, `route-authority.ts`, `capture-runtime.ts` (event stream on `/v1/code/sessions/{id}/events/stream`)
- the content bar (session totals)

**Work:**
- Passively read `result` events from the events responses the Cowork page already loads (history pages and the live stream). Dedupe by `result` uuid or sequence number.
- Use `modelUsage` per model, `output_tokens_details.thinking_tokens` and `duration_api_ms`.
- Show session totals on `/cowork/...`.
- The 14 September rule forbids fetching on the user's behalf, so there is no automatic backfill of unopened sessions unless the owner changes that rule (section 9).

**Acceptance:**
- Opening a Cowork session shows provider-reported output tokens that match `result.usage` exactly.
- Re-opening does not double count.
- A running turn updates when its `result` arrives.

### Phase 5. Claude extras (1 to 2 days)

- AI-powered artifacts: capture `/api/organizations/{org}/proxy/v1/messages` request and response `usage` as provider-reported output (C9).
- Voice mode: decide whether to support the voice WebSocket (C10). If not, show "Voice not tracked" in Details.
- Project and context input: optional display of project knowledge size (C11), owner decision.

### Phase 6. ChatGPT (2 to 3 days)

**Files:**
- `packages/adapters/src/chatgpt.ts`, `history/chatgpt.ts`
- `apps/extension/lib/content-placement.ts`
- `packages/capture-core/src/routes.ts`

**Work:**
- Count commentary text and tool-call content (G1).
- Estimate reasoning from timestamps (G2).
- Fix composer resolution for Work pages by preferring the editor inside `form[data-chatgpt-composer]` that is visible and last focused, instead of failing on two (G4).
- Accept `/g/{gizmo}/c/{uuid}` project and GPT routes (G5).
- Terminal handling for concurrent async turns (G7).
- Allow several finals by summing them (G8).
- Verify the WebSocket host (G9).

**Acceptance:**
- On a Work chat the bar appears, and a Work turn counts final, commentary and tool text.
- Project chats import history.
- Model slugs map correctly.

### Phase 7. Perplexity (2 to 3 days, after live verification)

- Count `text_final` and tables, to-do lists and nested workflows as output (P1).
- Remove the single-answer throw in favour of summing distinct items (P2).
- Add Computer tasks and Projects capture and history once their endpoints are recorded live (P3).
- Map new model labels (P4).
- Verify the bar on the home page (P5).

### Phase 8. Gemini (2 days, after live verification)

- Locate the thoughts field and the model label in StreamGenerate (M1, M3).
- Define completion from the final frame (M2).
- Accept `/u/N/` and Gem routes (M4).
- Parse Deep Research and Canvas (M5).
- Verify the composer selector (M6).

### Phase 9. Resilience and release (1 to 2 days)

- Inactivity timeout, slot release and dead-capture eviction (X6, X7, X10).
- Terminal frame on snapshot failure (X8).
- Full `pnpm check`, native Chrome checks per feature, and Edge and Firefox checks as before.
- Update the methodology, CHANGELOG and status record.

Rough total: 18 to 25 working days (own estimate). Phases 1 to 4 deliver most of the accuracy gain and can ship first.

## 7. Verification matrix (native, per feature)

| Tool | Feature | Test | Pass condition |
| --- | --- | --- | --- |
| Claude | Plain reply, thinking auto | short prompt | Answer counted; hidden reasoning estimated from block duration |
| Claude | Email draft card | "draft an email" | Email body counted as tool input |
| Claude | File or artifact creation | create a file | File content counted |
| Claude | Web search and fetch | search prompt | Tool input counted; results as input only |
| Claude | Project chat | message in a project | Same as plain; project route works |
| Claude | AI-powered artifact | use an artifact that calls Claude | Provider usage recorded |
| Claude | Stop and regenerate | cancel mid-reply, retry | Cancelled attempt counted as cancelled; retry separate |
| Claude | Opus 5.5, Sonnet 5, Opus 5 | switch models | Correct EcoLogits profile each |
| Cowork | Open a finished session | open `/cowork/...` | Totals equal `result.usage` |
| Cowork | Live turn | small task | Totals update on `result` |
| ChatGPT | Thinking reply | GPT-5.6 Thinking | Reasoning estimated; model `gpt-5.6-sol` |
| ChatGPT | Work | small Work task | Bar present; commentary and tool calls counted; model `gpt-6-astra` |
| ChatGPT | Project chat | reopen a project chat | History imported |
| ChatGPT | Canvas | ask for a document in canvas | Canvas text counted |
| Perplexity | Search, Pro, Research, Labs, Computer, Projects | one prompt each | Answer, tables and reasoning counted; model mapped |
| Gemini | Fast, Thinking, Pro, Deep Research, Canvas, Gem, second account | one prompt each | Thoughts counted; model captured; completion verified |

## 8. Open verification

These items need the automation Chrome window visible (not minimised):

- Gemini live sending, the thoughts field and the model field.
- Perplexity thread structure on the owner's real threads (`text_final`, tables, nested workflows) and the Computer and Projects endpoints.
- ChatGPT WebSocket host (G9) and a live Work turn capture.
- The composer selectors on Perplexity and Gemini (P5, M6).
- Whether `completion2` is enabled for any owner account today (C3).

Test artefacts created during this audit, which the owner may delete:

- Claude chat "Meeting confirmation email draft".
- Claude chat "Munich population web search and markdown file".
- Perplexity thread "AI Footprint Tracker test: in two sentences, what is the capital of Denmark...".

These were created in new chats, not in the designated MCQs test chat that the 26 September rule names.

## 9. Owner decisions needed

1. Count model-written tool input (files, code, email drafts, canvas) as output tokens for the estimate. Recommended: yes.
2. Estimate hidden reasoning from duration, shown as an estimate with a range in Details. Recommended: yes, calibrated from Cowork data.
3. ChatGPT `-wm` (Work) slugs use the same EcoLogits profile as the base model. `gpt-5-6` (instant) maps to which profile?
4. Cowork: only sessions the user opens (fits the 14 September rule "never fetch on the user's behalf"), or allow an explicit, user-started import of all past sessions? The second option needs a change to that rule, because Cowork keeps working with no tab open.
5. Voice mode: support now or label as not tracked?
6. Unknown vendor stream events: count the reply as "Partly measured" instead of "Tracking problem". Recommended: yes.
