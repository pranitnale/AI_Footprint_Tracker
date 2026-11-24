# Claude merged app: tracking check and fix plan

Check date: 18 November 2026. Scope: claude.ai after Anthropic merged chats and Cowork into one app, and what the tracker must change to count it correctly. Claude Code sessions stay out of scope.

This document is the plan. It does not change behavior. Section 8 lists the owner decisions it depends on. Code anchors come from a read of `main` at `50c11f67`; check them before editing.

## 1. Summary

Claude now reads and sends every chat and every Cowork session through one binary request that the tracker does not match. The published build (0.1.0) therefore counts nothing live on Claude. It still shows figures for chats, but only from its own background read of the saved chat, late and by text.

| Kind of conversation | What Claude exposes now | What the tracker does today (seen live) |
| --- | --- | --- |
| New chat (created after the merge) | Exact output and thinking tokens, per model, through a Cowork-style session behind the chat | Counts the saved text only, late. Hidden thinking is missed. Later turns are picked up late or not at all. |
| Old chat (before the merge), also when continued | Text only. No session, no exact counts. | Same text count as before the merge, but late, and later turns are unreliable. |
| Cowork session | Exact counts as before, through the same session and events data | Not counted. The session opens at a chat address, the tracker treats it as a chat, and its own read gets "not found". |

Measured on one new test chat (two turns, the second with thinking): the bar showed 290 output tokens, Claude's own records say 572 (581 with side calls). Visible text alone was within 4% on the turn without thinking.

The data for a correct count is all still reachable. For new chats it is better than before the merge, because exact counts including hidden thinking now exist where the tracker used to estimate from text.

## 2. How the evidence was collected

- **Live, read-only inspection** in the in-app browser on the owner's team account, and in the owner's Chrome with the store build on a second (Max) account. Only structure, counts, lengths and model ids were logged. No message text was stored.
- **A page-side probe** that wrapped `fetch`, kept request and response bytes for the new RPC, split the Connect frames, decompressed them and walked the protobuf without a schema. Field meanings below are inferred from that walk.
- **Four short test prompts**: one each in two throwaway chats on the team account (one new, one from 5 November), and two in one new chat on the Max account. They are logged in the local `TEST-ARTEFACTS.md`.
- **Code reading** of the Claude and Cowork readers, the own-read scheduler, the bar states and the history service.
- **Limits.** One day and two accounts. The switch reached the team account between 11:39 and 12:22 UTC. The classic send code is still in Claude's bundle, so other accounts may still be on the old path.

## 3. What changed on claude.ai

### 3.1 Transport

- Reading a conversation: `POST /claudeai-rpc/anthropic.bard.api.v1alpha.ConversationService/StreamTimeline` (`application/connect+proto`). One snapshot frame, then deltas on a long-lived stream.
- Sending: `PerformAction` on the same service (`application/proto`).
- Other calls: `ReadCoworkSession`, `ReportViewing`, `GetNewConversationDefaults`.
- The page no longer issues the requests the tracker reads: `POST .../chat_conversations/<id>/completion`, `GET .../chat_conversations/<uuid>?tree=`, `GET /v1/code/sessions/<id>/events` and `.../events/stream`.
- The timeline carries text, thinking summary lines, tool names and the model. It carries **no token counts**, in the snapshot or in the live deltas.

### 3.2 Routes and lists

- Every conversation is shown at `/chat/<uuid>`.
- The Recents list still links Cowork sessions as `/cowork/cse_<id>`. Opening one redirects to `/chat/<uuid>`, with a version-8 uuid that appears nowhere in the session object. A reload at that address is a direct open of the chat route.
- The Claude interface shows no token counts.

### 3.3 The three kinds

**New chats.**
- The chat list row (`GET .../chat_conversations_v2`, fetched by the page) has `workspace_upgraded: true` and `workspace_session_id: cse_...`.
- The page fetches `GET /v1/code/sessions/<cse>?omit_bound_device=true` on open and again after every turn. It carries `external_metadata.usage.output_tokens`, cumulative and exact, and the tag `bard-conversation:<chat uuid>`.
- A direct read of `/v1/code/sessions/<cse>/events?limit=500&sort_order=asc` still answers, with only the `anthropic-version` header. Each `result` event has cumulative `modelUsage` per model (`outputTokens`, `thinkingTokens`).
- The saved chat JSON (a direct read still answers) has `workspace_upgraded` but no session id, and **no thinking block**, even when thinking tokens were used.
- Per-turn exact output is the difference of cumulative `modelUsage.outputTokens` between results. `result.usage.output_tokens` is only the last message (48 on a turn that used 316).

**Old chats.** `workspace_upgraded: false`, no session. A continued old chat also sends through `PerformAction` and stays without a session. The saved chat JSON still answers a direct read. No exact counts exist.

**Old Cowork sessions.** The session object and the events endpoint answer as before. The chat JSON endpoint answers 404 for the session's chat uuid. On a `/cowork/cse_<id>` open, the timeline request carries the `cse_` id as plain text. On a direct open of the chat route, the page asks for the timeline first and fetches the session object after it.

### 3.4 Event kinds in a session (read today)

All events carry a string `payload.type`: `control_request`, `control_response`, `autocompact_state`, `rate_limit_event`, `env_manager_log`, `active_goal`, `system` (subtypes `init`, `status`, `turn_handoff_available`, `hook_started`, `hook_response`, `background_tasks_changed`), `user`, `assistant`, `result`. Sequence numbers are strings from "1".

- Chat-backed sessions: no hidden first message. Each user payload has two text blocks, the first much longer than the typed prompt (133 characters for a 2-character prompt).
- Old Cowork sessions: the hidden first message answered by a result with empty `modelUsage`, as recorded in October.

## 4. What the tracker does today, and why

Seen live with the store build, then explained from the code.

- **No live counting.** `generationRoute` (`packages/adapters/src/dispatch.ts:56-63`) matches only the completion paths.
- **No passive history.** `historyRequestConversation` (`apps/extension/lib/history-route.ts:257-262`) matches only the chat JSON fetch, which the page no longer makes.
- **Figures come from the own read.** After a 4 second grace (6 on a full load) the "missing" mode fetches the chat JSON. This is why a new chat shows "Processing", then "No figures yet", then figures 15 to 40 seconds later.
- **Later turns have no trigger.** The "missing" mode needs zero saved requests (`content.content.ts:3972-3988`), runs once per navigation and is blocked for 5 minutes after a read (`own-read.ts:505-523`, `:715-726`). A second turn stayed uncounted for 77 seconds and through one reload. It did appear some minutes later on reopening; that trigger was not found in the code and is an open point.
- **Hidden thinking is missed.** The JSON has no thinking block, and the text count cannot see it.
- **Cowork is not reached.** Routes and readers split by id shape (`cse_` or uuid, `routes.ts:66-69`). A session at a chat route is read as a chat, and its JSON read ends in 404 and "History not loaded".
- **No error is shown.** Scripted sends do not arm the send watchdog. A trusted send would show "Processing" for 15 seconds and may then report "Site response could not be observed" in Details (not tested live).
- **Model.** `claude-fable-5-2` is not listed. It is estimated with the `claude-fable-5-1` profile as a family stand-in and labelled "Claude Fable, version not yet listed". `claude-opus-5-5` and the other ids seen are listed.
- **"Claude hides 1 part"** in Details is a fixed line for every Claude chat (`details-overview.ts:183-190`), not a detected problem.

## 5. Target design

### 5.1 One conversation, one id, one counting source

- A session-backed conversation keeps its session id (`cse_`) as the conversation id on the wire and in the ledger. A `/chat/<uuid>` route is bound to it by a verified link.
- Existing Cowork records and checkpoints continue without migration. Every id-shape rule stays valid, including "`cumulative` required for sessions, forbidden elsewhere" (`history-capture.ts:410-421`).
- Ledger id per kind: new chat, `cse_` when nothing is stored under its uuid, else the uuid counted by text; old chat, the uuid; Cowork, `cse_`.
- A linked route never gets the chat JSON text import. This is what prevents double counting.

### 5.2 Link sources, in order of trust

1. Chat list row: `uuid` with `workspace_session_id`.
2. Session object whose tag `bard-conversation:<uuid>` names the shown chat.
3. Cowork: the `/cowork/cse_<id>` route followed by its redirect within one navigation.
4. Cowork, direct open of the chat route: to be settled by a probe (section 7). A session-object fetch that merely happens while the route is shown is not proof on its own.

A link is never accepted from timing alone. The link and the last counted total are stored locally so a reload resolves before the page refetches. A full erase clears them.

### 5.3 Exact counting for new chats and Cowork

- Trigger: the page's own session-object fetch for the shown session. When its total differs from the stored total, the tracker asks for one events read.
- Read: the existing Cowork own read and reader, then `coworkTurns` and the stored checkpoint, so each turn gets its exact output, its thinking share and its side calls.
- The first read starts at event 1 and proves the start. Later reads resume from the checkpoint, usually one request per turn. An unchanged total on open sends nothing.
- Fallback when the events read is unavailable or Load full chat history is off: one reply per change of the session total, on a separate basis that never mixes with the events basis (the two counters differ, 581 against 572).
- Input is taken from the events as Cowork does today.

### 5.4 Old chats

- Send signal: a `PerformAction` request, named from its path only.
- Turn end: the stop control was seen after that send and is gone on two scans. If it was never seen, 20 seconds after the send.
- Read: a new own-read mode that runs once per turn. It keeps the pause, the not-found and refused blocks, visibility, the setting and the request limit. It skips only the once-per-navigation rule and the 5-minute block after a successful read.
- Import dedupes by message, so an unchanged turn changes nothing and a grown reply replaces its row.
- It runs only where a `PerformAction` was seen. Accounts still on the classic path keep live capture and the page's own read unchanged.

### 5.5 Bar and Details

- The bar shows "Processing" from a seen send until the turn's figures arrive, and never "No figures yet" in the middle of a turn. No new bar states.
- The send watchdog treats the new RPC as an observed send, so it does not report "Site response could not be observed".
- Details takes its surface from the resolved id. Session-backed chats use the exact-count wording and list no hidden part.

### 5.6 Timeline reader: deferred

No protobuf reader for `StreamTimeline` now. It carries no counts, its schema is unpublished and was seen on one day, and every need has a cheaper source. Revisit only if the stop-control signal proves unreliable.

## 6. Implementation plan

Tests run on the VPS only. Each phase starts with its failing tests.

### Phase 0. Probes (half a day)

The open items in section 7 that decide details of phases 1 and 2. No code.

### Phase 1. Linking and exact counting (3 to 4 days)

Smallest step that restores correct counting for new chats and Cowork.

- Add `packages/adapters/src/history/claude-session-link.ts` (pure): pairs from the chat list, and session, tagged chat and total from a session object. Extend `coworkRequest` (`cowork.ts:27-48`) with the session-object request.
- Add `apps/extension/lib/claude-session-links.ts` (page world, bounded clones, ids and totals only), wired at `passive-history-text.ts:175-207`, and `claude-session-link-store.ts` (background, local storage).
- Add `routeConversation(site, pathname, sessionOf)` beside `routes.ts:84` and use it where the route is compared with the conversation: `cowork-history.ts:197-198`, `:334-339`; `own-read.ts:142-149`; `own-read-page.ts`; one helper for the Claude uses in `content.content.ts`; `history-service.ts:330-331`; `route-authority.ts:203`, `:248`, `:430`.
- Replace the `/cowork/` path test at `content.content.ts:3934-3942` with "the resolved id is a session", and add the after-turn request driven by the session total.
- Resume the events read from the checkpoint (`own-read.ts:316-322`, `cowork-own-read.ts:75-107`).
- Hold the "missing" JSON read on Claude chat routes until the link state is known or the grace ends. Never import replies by text for a chat whose JSON says `workspace_upgraded: true` while a link is known.
- Route the `PerformAction` signal to `watchdog.captured`.

Failing-first tests: new `packages/adapters/test/claude-session-link.test.ts`; `packages/capture-core/test/routes.test.ts` (bound chat route); `apps/extension/test/history-service.test.ts` (session page accepted on its bound chat route, refused on another); `route-authority-limits.test.ts`; `cowork-history.test.ts` (session shown at a chat route); `packages/adapters/test/cowork-history.test.ts` (chat-backed session proves its start, control and log events count as read, prompt with an attachment); `cowork-own-read.test.ts` (reads on from the checkpoint); `watchdog-timer.test.ts` (RPC send is observed). New lib imports go into the allowlist in `conductor-content.test.ts`.

### Phase 2. Old chats after each turn, and bar states (2 to 3 days)

- Add `packages/adapters/src/claude-rpc.ts` (names the RPC method from the path) and raise the existing sent signal from `PerformAction`.
- Add the `after_turn` own-read mode in `own-read.ts`, keyed by a turn token. At least 10 seconds between reads of one chat, one retry after 5 seconds when the leaf is not an assistant message, large chats at most once per 2 minutes.
- Add `turnActive` to `barActivity` (`content.content.ts:3413-3483`), bounded and off while paused.

Failing-first tests: `own-read.test.ts` (second turn in one navigation is read, skips the read block but not a pause, paced); `conductor-content.test.ts` (old chat counted after each turn, classic completion asks for no own read, Processing through a turn with no capture, no "No figures yet" mid-turn); new `packages/adapters/test/claude-rpc.test.ts`; `bar-status.test.ts`.

### Phase 3. Details wording and settings (1 day)

- Surface from the resolved id (`content.content.ts:3677-3683`, `details-overview.ts:158-165`, `estimate-details.ts:416-418`).
- The Load full chat history switch for chat routes, per the decision in section 8.

Tests: `details-overview.test.ts` (session chat hides nothing), `own-read-settings.test.ts`.

### Phase 4. Models (half a day, more if the catalog moves)

- Check upstream EcoLogits for a Fable 5.2 record first.
- Otherwise add `claude-fable-5-2` to `packages/contracts/src/model-ids.ts`, the schema JSONs and the mappings, with a nearest-record link to Fable 5.1 and a new policy version. Figures stay as today; the label and reported id change.
- Tests: `model-labels.test.ts`, `packages/estimator/test/model-coverage.test.ts`, `family-stand-ins.test.ts`, the EcoLogits maintenance suite, and the server parity tests. Whether the server must be deployed first is not checked yet.

### Phase 5. Session-total fallback (1 day)

- Optional `basis` on the Cowork checkpoint (`packages/ledger/src/ledger-support.ts:92-141`); `coworkTurns` skips a page of the other basis.
- Tests: `cowork-turns.test.ts` (total track, tracks never mix).

### Phase 6. Verification and release (1 to 2 days)

- Native check in Chrome on both accounts: new chat with and without thinking, old chat continued, Cowork session opened from Recents and reloaded, a tool-using turn, stop, regenerate, edit.
- Compare each bar figure with the session's `modelUsage`.
- A classic-path account end to end, if one can be found.
- A new store version is needed. The published 0.1.0 stays wrong on Claude until it is approved.

### Handover rules that change

| Rule today | Change | Test that justifies it |
| --- | --- | --- |
| Own read once per navigation, blocked 5 minutes after a read | `after_turn` reads once per turn | `own-read.test.ts` |
| The route must equal the conversation id | A verified session link is accepted | `history-service.test.ts`, `route-authority-limits.test.ts` |
| Hidden thinking and side calls are not counted on chat routes | Counted for session-backed chats | `details-overview.test.ts`, `cowork-history.test.ts` |
| Cowork own read starts from the first event | Resumes from the checkpoint | `cowork-own-read.test.ts` |
| The send watchdog knows the Cowork send only | Covers `PerformAction` | `watchdog-timer.test.ts` |
| A reread never lowers a count | Unchanged | none |

## 7. Probes

Settled on 18 November:

- The events read works with only `anthropic-version`.
- Every event kind seen carries a string `payload.type`, so the reader marks it as read.
- Chat-backed sessions have no hidden first message.
- The chat JSON carries `workspace_upgraded` but not the session id.
- Recents links Cowork sessions as `/cowork/cse_<id>`, which redirects to the chat route.
- The session object of an old Cowork session carries no chat tag and no chat uuid.

Still open:

- Cowork, direct open of the chat route: does the timeline snapshot hold the `cse_` id as plain text, so a byte search after decompression can prove the link without a schema?
- Is the `result` event saved before the page refetches the session object?
- The stop control's selector during a streaming turn on the merged app.
- What the first text block of a chat-backed user payload is, and whether it should count as input.
- Does the session's cumulative count keep replaced branches (edit, regenerate)?
- A tool-using turn, stop, Research, artifacts (`proxy/v1/messages`) and project chats.
- Does `PerformAction` also carry stop or rename, so that not every one is a send?
- An account still on the classic `/completion` path.
- What re-read the test chat's second turn some minutes later.

## 8. Owner decisions needed

1. **Chats the store build already counted by text since the merge.** Recommended: leave them on text for now. They are few (created between the merge and the fixed release), and moving them means retiring saved rows, which breaks "saved rows are never removed" and needs its own test. They keep missing hidden thinking until a full erase.
2. **Load full chat history switches.** Recommended: the Claude switch covers every chat route, including session-backed chats and Cowork sessions shown there. The Cowork switch stays stored and keeps applying to `/cowork/` addresses only.
3. **Extra request per turn.** Exact counting needs one events read after each turn of a session-backed chat. Recommended: yes, under the existing switch (on by default), with the session-total fallback when it is off.
4. **Fable 5.2.** Recommended: add the id with the Fable 5.1 record until EcoLogits lists it.

## 9. Risks

- **Link trust.** A wrong link would show another session's figures on a chat. Hence list or tag proof only.
- **Moving target.** Anthropic changed this once today and may change the events endpoint, its headers or the session object again.
- **Side calls after the last result** (9 tokens in the probe) are counted only with the next turn.
- **Whole-chat JSON reads per turn** are heavy on long old chats. The pacing in phase 2 bounds them.
- **Evidence base.** Two accounts, one day. Phase 6 repeats the check before release.

## 10. Revision of 22 November 2026

This section is newer than sections 5 to 8. Where they differ, this section applies.

### 10.1 What the recheck found

Read-only check on 22 November in the owner's Chrome, team account, store build 0.1.0.

- **Unchanged:** the transport of section 3.1, the exact counts in the events list, the events read with only the `anthropic-version` header.
- **A fourth kind, the converted chat.** Claude now converts an old chat into a session when it is continued. Seen: a chat created 4 November was converted on 18 November. Its list row has `workspace_upgraded: true` and a `cse_` id; its session has `environment_kind: anthropic_cloud` and the tags `bard-e1-force-upgrade` and `bard-conversation:<uuid>`. The events start at the conversion (a first user event answered by a result with empty `modelUsage`). So the earlier turns have text only and the later turns have exact counts. The bar showed a text count for all 273 requests, while the session held 152,157 exact output tokens since the conversion, about half of them hidden thinking.
- **`PerformAction` is not only a send.** It also fired when a chat was merely opened.
- **The session object is wrapped** in `response_shape`. Readers must accept both shapes.
- **The events list pages** with `next_cursor`. 858 events needed two reads.
- **Exact input is mostly cache reads** (60 million cache-read tokens on that chat), as in Cowork sessions.
- **EcoLogits:** the latest release is still 0.11.3, the one the app uses. Upstream `main` (27 commits ahead, model refresh of 19 November) adds `claude-fable-5-2`, four `gemini-4-*` models, `gpt-6.1-terra`, `gpt-6.2-astra` and `gpt-6.2-sol`, changes the speed data of 87 models, removes 40 old models and corrects one electricity mix (CAF).

### 10.2 Owner decisions of 22 November (they replace section 8)

1. **Exact where it exists.** Use Claude's own token counts wherever Claude exposes them, input included. Count by text only where no counts exist.
2. **One switch.** One "Load full chat history" switch covers Claude chats and Cowork. Where Claude still shows them separately, both are counted as before.
3. **One read per reply** for exact per-reply counts, under that switch. With the switch off, use the running total the page loads itself.
4. **Models.** Adopt the unreleased EcoLogits data, so `claude-fable-5-2` and the other new models get their own records.
5. **Presentation.** No new label on the bar. A drop-down in Details says how the chat was counted: exact from Claude, estimated from text, or part of each. The same drop-down shows the two numbers when Claude's own total is higher than the tracker's count.
6. **Release.** Tests run on ionos-server. The server may be deployed after thorough testing without asking, and the published 0.1.0 extension must keep working against it. The new extension version is packaged and waits for the owner.

### 10.3 Design changes

| Kind | Counting source |
| --- | --- |
| New chat (session from its first turn) | Exact, from the session's events |
| Converted chat | Text for the turns before the conversion, exact for the turns after it |
| Old chat, not converted | Text, read again after each turn |
| Cowork session | Exact, as before the merge |

- **Converted chats.** No turn may be counted twice and none may be dropped. The text import of such a chat stops at the conversion; the exact count starts there. The design must name the boundary it uses and prove it with a test built from a recorded conversion.
- **Chats the store build counted by text.** When the link is proven and the events prove the start, the text rows of the session-backed turns are replaced by exact rows, once. This is a deliberate exception to "saved rows are never removed". It needs its own failing-first test, and the company totals on the server must be corrected, not added a second time.
- **Send signal.** A `PerformAction` counts as a send only when its body marks one. The probe names the field. The path alone is not enough.
- **Readers.** Accept the wrapped and the plain session object. Follow `next_cursor`. Resume from the stored checkpoint.
- **One switch.** The merged switch is on unless the user had turned off either of the two old switches. The old Cowork value is not kept.
- **Backward compatibility.** The classic paths stay untouched and tested: the completion stream, the chat JSON the page fetches, and `/cowork/` routes that load their own events. An account Claude has not switched must count exactly as today.
- **Details.** One collapsed drop-down, "How this was counted", in the existing Details layout. No new bar state.
- **No silent state.** Every state the new code can reach has a defined bar text or Details line. A read that fails, a link that cannot be proven and a total that disagrees are each shown, not hidden.

Keep it plain. No new abstraction, setting, state or file that these points do not need. The timeline reader stays deferred (section 5.6).

### 10.4 Workstreams

| # | Workstream | Depends on |
| --- | --- | --- |
| A | Live probes (section 7, plus: the send field of `PerformAction`, the conversion boundary, whether a converted chat's saved JSON still holds the turns after the conversion) | Signed-in test Chrome |
| B | Core: linking, exact counting, converted chats, the one-time replacement, send signal, old chats after each turn, bar states | A for details |
| C | Settings and Details: one switch, the "How this was counted" drop-down | B's interfaces |
| D | Server: corrected company totals after a replacement, 0.1.0 compatibility | B's design |
| E | EcoLogits snapshot and the new model ids | none |
| F | Verification and release: full suite against a baseline of `main`, live matrix (section 6, phase 6), one smoke chat on each other site, package 0.1.1, server deploy, test files removed | B to E |

### 10.5 How the work runs

The main session plans, approves each design before code is written, reviews each diff and lands it on local `main`. Developer sessions work in their own worktrees and commit there. One coordinator session owns ionos-server and the test browser: it runs test requests first come, first served, as many at once as free memory allows, and grants the browser to one session at a time. Nothing is pushed.
