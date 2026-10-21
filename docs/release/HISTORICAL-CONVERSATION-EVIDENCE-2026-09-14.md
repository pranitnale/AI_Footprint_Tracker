# Historical conversation evidence

The owner requested old-chat counting and approved retention of older imported numeric history on 14 September 2026. This record describes the conductor's source inspection and acceptance boundaries. It is not a release certification.

The [decision](../decisions/2026-09-14-historical-conversation-counting.md) supersedes the former exclusion of pre-installation conversations. The [minimized fixtures](../../fixtures/history-observation-2026-09-14/README.md) preserve reviewed protocol relationships with invented identities, dates and text. Authenticated response bodies remained transient and were cleared after inspection. No private screenshot text or raw provider capture was committed.

## Observed providers

| Provider | Evidence from an existing synthetic chat | Counting boundary |
| --- | --- | --- |
| ChatGPT | Current plural conversation endpoint; flat messages; stable message IDs; per-message Unix timestamp; explicit page cursors and direction flags; final-answer role/channel | Count visible user text and final assistant text. Exclude hidden records, tool output and reasoning recaps. Preserve historical request grouping separately from a proven live-event link. |
| Claude | Selected leaf and message-parent chain; universal root sentinel; human/assistant content blocks; per-message zoned dates; extracted attachment text | Top-level message text was empty. Count content text once, and keep extracted file text separate. A verified selected chain may reach the first available request without proving all branches or executions. |
| Perplexity | Entry/frontend identity equality and route membership; dated entries; prompt text; completed workflow answer | Full answer text repeats the chunks. Count it once. Entry time applies to the historical entry and does not establish the answer's completion time. |
| Gemini | Host-issued history RPC; response/candidate identity links; selected candidate; prior-turn chain; timestamp pair | Select the explicit candidate. Exclude duplicate rich text and separate reasoning. A stopped response with empty canonical answer is not a complete zero-work observation. Preserve the turn-time basis. |

The successful ChatGPT and Perplexity captures reported truncation of the wider event buffer. Their selected response bodies parsed successfully, but these observations cannot prove complete network coverage. The Claude and Gemini captures did not report event-buffer truncation. Native Chrome supplied the first three inspected chats; Gemini used the in-app profile containing the earlier authorized test conversation.

## Identity check limits

One short ChatGPT prompt used the last send in the previously approved six-send batch. Its live response showed that the posted user ID matched the echoed user ID and that the user and final assistant records shared a request ID. Seventeen SSE frames were parsed. No capability or raw identifier was retained.

The immediate reopened-history capture was incomplete before the matching response could be identified. Its already-cleared live IDs were not recoverable from the later capture. Therefore the same-message live-to-history identity equality remains unverified. No additional generation was sent to retry it. The expanded Claude/Perplexity test batch was still awaiting the owner's answer at this point.

A later ordinary reload independently verified ChatGPT's first-page boundary signals: the start and end cursors matched the first and last records, both page-direction flags were false, the current node matched the last record, context-truncation continuation was null, and only a hidden system record preceded the first visible user prompt. This supports a narrowly validated first-available-request rule; it does not establish every alternative branch or every execution.

## Required implementation checks

- Repeated pages, tabs and device uploads are idempotent. Stable historical message identities do not depend on text hashes.
- Counts continue across bounded batches for conversations exceeding 100 messages. A batch limit is not a lifetime conversation limit.
- Imported visible-history totals remain separate from live totals when overlap cannot be established. The UI must not add both and present the result as a verified total.
- Source dates retain message, entry or turn semantics. Missing dates stay unknown and are never replaced with the import time.
- Older imports survive hosted age cleanup. Explicit erasure, disconnect authority and deletion tombstones remain effective; merely reopening a chat must not undo deletion.
- A failed recorded-conversation request cannot hide independently available imported history. Failed counting, storage, synchronization or unsupported source shapes remain visible.
- Resource figures describe an unvalidated partial scenario for observed historical text. Loaded prompts are not observed API executions; hidden work and missing media components are not silently zero.

The reviewed implementation and current browser archives include this historical feature. The executed checks below do not replace native browser verification, PostgreSQL verification or release promotion.

## Executed local source verification

The conductor used an in-app browser harness importing the actual content entrypoint, provider parsers, counting web worker, coordinator, history service, estimator and IndexedDB ledger. Provider markup, host identity, site consent and extension transport were synthetic. These checks sent no provider or hosted product-server requests and do not prove native extension installation.

| Check | Observed result |
| --- | --- |
| Claude and Perplexity earlier-page loading | Loaded prompt counts increased from 1 to 2 to 3; stored historical messages increased from 2 to 4 to 6. Replaying the loaded page kept six records. |
| First available request | Partial pages remained partial. The independently verified first-message evidence changed the first-available indicator when loaded. This did not claim every branch or hidden execution. |
| Long Claude history | 402 historical messages passed through four worker batches, producing 201 prompts and 201 responses with 1,206 visible-text reference tokens for each side. No live requests or attempts were fabricated. The single measured update took about 2.1 seconds, not a performance certification. |
| Failed update and recovery | A rejected history update preserved previously accepted numbers and showed a visible history problem. A subsequent accepted page recovered the status. |
| Privacy of stored fixtures | Ledger inspection found no fixture text or raw provider identities. |
| Narrow details panel | The earlier horizontal overflow was reproduced at a 320-pixel viewport. After the style fix, panel client width and scroll width were both 275 pixels. Native composer markup remained unchanged. |
| Wide layout | An earlier 3,440 by 1,440 check observed one stable geometry across 12 frames. The final longer metric bar still needs the same repeated check. |
| Controls and copy | Details opened, Escape closed it, and the compact Perplexity bar visibly marked known historical estimates with the approximation symbol. This does not cover every production control. |

The conductor's independent provider and aggregation oracles passed eight checks on the reviewed source, including all four canonical text/date rules, unknowns, cycles, cross-conversation rejection, large pages, first-entry pointer adversaries, aggregation order and exclusion of known live overlap. The shared independent verification suite passed 11 checks. Documentation consistency passed 104 checks after correcting two stale wording/spacing assertions. The current-input privacy scan checked 504 files and found no high-confidence sensitive-data candidates; it is an offline pattern scan, not a zero-risk guarantee.

The full integration run and independent backend review found release-blocking issues: retention-expired live receipts could create historical erasure markers; queued history from an earlier same-device enrollment era could be stranded; empty historical rows changed recalculated CSV exports; and account transitions exposed routing-test failures. These issues were corrected and independently re-verified. The repeated expiry probe produced zero historical erasure markers; explicit deletion remained authoritative. The actual TypeScript client and FastAPI reconnect roundtrip sent unchanged original-era history with microsecond source dates. CSV exports omit empty history and preserve the original history method/profile beside recalculated live rows.

The final conductor-run JavaScript suite passed 660 tests, with two Windows file-symlink tests skipped. This includes 511 passing extension tests. All workspace type checks passed. The full Python server and deletion-journal suite passed 243 tests, with the PostgreSQL-specific test skipped and 12 dependency/configuration deprecation warnings. The documented server-directory Ruff check passed. Independent rereview reported CLEAN after 110 focused TypeScript checks, 81 Python checks, the actual client/API reconnect test and the additional migration/documentation checks.

## Built artifacts and native verification boundary

The owner confirmed that Chrome loads `apps/extension/.output/chrome-mv3` from this project. The conductor rebuilt that directory and the Edge/Firefox targets from the frozen reviewed source. Each archive contains 77 files. Independent checks verified every built file against its ZIP entry, archive CRCs and paths, permissions, full license payloads and website download copies.

The matching source archive contains 240 files with input fingerprint `63e4bb82b4dfb2e553cd90aecb4e3a1c911b2d7a6788670fa82309b60f8f4732`. Rebuilding that archive independently produced identical paths, lengths and SHA-256 hashes for all 77 files in all three browser targets. The Chrome ZIP SHA-256 is `5fccb807048460d89c23349eb2fe4b5fbb769d76a56dee12d0f4280ab0e78a7a`. The generated release manifest records the other hashes. The package privacy scan checked 975 entries and found no high-confidence sensitive-data candidates. The website production build and its checked download copies passed verification. Previous packages are preserved under `artifacts/checkpoints/pre-history-20260914`.

At this artifact checkpoint, updating files on disk had not proved Chrome reloaded them. Browser-tool attempts timed out, and extension-management automation had separately been denied by URL policy. The owner was asked to reload this unpacked extension and refresh an old chat. The subsequent native observations are recorded below.

The former synthetic API on port 4181 is stopped; safe health checks found no listener. The source integration tests used isolated API databases. They do not establish a currently running hosted service or live synchronization from the installed Chrome profile. The checked website is served locally through a direct preview of its production build; normal development startup would deliberately mark download metadata unavailable.

## Native follow-up after the owner's reload

The owner subsequently confirmed reloading the unpacked extension and refreshing an old chat. Browser inspection recovered. The installed Chrome build then displayed historical prompt/response counts, token and resource estimates, source-date coverage and the first-available-request indicator on Claude. When the provider exposed the beginning of the conversation, previously imported messages were not counted again. The toolbar popup opened and Settings was inspected without saving changes. No conversation text, title, provider identifier or screenshot from this check was written to the repository.

The native ultrawide check requested 3,440 by 1,440 pixels through the browser viewport control. At the observed 1.25 device-pixel ratio, the effective CSS viewport was 2,752 by 1,152. The information bar retained one 768 by approximately 162.4 geometry over 20 animation frames; the open Details panel retained one 520 by 460 geometry over another 20 frames, with equal client and scroll widths. The viewport override was reset after testing.

This follow-up also found additional issues that the earlier source checks had not resolved:

- A generic page-local failure counter could keep the bar at `Tracking problem` without preserving the cause. Its message incorrectly described all causes as saving failures and directed the user to health information that the compact toolbar popup did not show.
- The compact popup could retain a `rebuilding` label after returning a dirty cached snapshot, without a completion refresh.
- At a 320 by 700 CSS viewport, Details extended above the viewport and its Close button was not visible. Horizontal width checks alone had missed this vertical placement failure.
- A Perplexity test chat initially showed unavailable conversation totals after navigation through Sessions. Retry did not recover it; a full reload produced historical counts and estimates. A later warm navigation roundtrip succeeded. The sender-route validation is a plausible cause, not a captured runtime proof: the actual `MessageSender` fields from the failed call were not retained.

The diagnostic, cache-refresh, vertical-placement and route-validation corrections were implemented after this native checkpoint. They are not contained in the hashes recorded above. Chrome documents the sender metadata and the tab's committed URL separately; matching host permissions permit reading the current tab URL without adding broad tab access. See the [runtime sender reference](https://developer.chrome.com/docs/extensions/reference/api/runtime#type-MessageSender) and [tabs reference](https://developer.chrome.com/docs/extensions/reference/api/tabs#type-Tab). The route fix preserves extension identity, top-frame, origin, permission and current-conversation checks, challenges the current content document, and cancels stale work at mutation boundaries. A committed document may still be loading; that state alone does not reject valid history.

Independent review reproduced and corrected duplicate diagnostic counts, repeated counting of one settled startup failure, inaccurate memory-only copy and missing repositioning of an already-open panel. The final reviewed source passed 190 focused checks and a clean review. The conductor then ran the full JavaScript suite: 688 passed, with two Windows file-symlink tests skipped, including 539 passing extension tests. All workspace type checks passed. No Python implementation changed in this follow-up; the earlier 243-pass server result still describes that unchanged server source.

The conductor verified the final placement through the in-app browser using the actual content entrypoint and synthetic provider transport. An open panel remained open after resizing to 320 by 500 and scrolling the page. Its top was 12 pixels, the Close button occupied vertical pixels 31 through 61, and client/scroll widths both measured 275 pixels. Close worked and restored focus to Details. Native composer fixture markup remained unchanged. This supplements the native failure reproduction without claiming that the newly corrected build was already running in Chrome.

A further native popup observation exposed a primary-button hover contrast defect. The generic hover background overrode the primary background while retaining its text color. The corrected primary-specific hover rule measured 6.656:1 contrast in light mode and 5.673:1 in dark mode using browser-computed colors from the actual stylesheet; dimensions were unchanged. Independent CSS review was clean.

These follow-up changes were packaged with Chrome ZIP SHA-256 `cd58ef93079019f8eda918b59552b41ec2fe0f9c5eb0dc943e32f3d1218a76f5` and source input fingerprint `879e531b90bd3dbfe53463b01e0343a2adaa7e5e411ac49600d5fc9d3332506d`. The 242-file source archive rebuilt all 77 files in each of the three browser targets identically. Package privacy checks, website build and independent archive/download-copy checks passed. The owner confirmed reloading this newer build and refreshing Claude and the Perplexity test chat.

## Heartbeat investigation after the second reload

The native tracker displayed saved historical numbers on both refreshed pages, while Details reported `capture_hook_missing`. No current-document extension startup exception appeared in the inspected logs. A local nonce heartbeat probe received no answer on either page; it sent no provider request. On Claude, the executing capture script's SHA-256 matched the built script, and a brief debugger check at its probe condition found the listener enabled, permission stop false, and `window.fetch` different from both its own wrapper and its original fetch reference. The debugger was resumed and disabled immediately after inspection. No private page content or raw identifiers were retained.

The probe condition required the extension's wrapper to be the current top-level fetch function. An outer wrapper therefore prevented this active listener from answering. The observed outer functions contained forwarding code, but their captured delegate identity was not inspected; this evidence does not prove complete interception through them. The correction separates listener liveness from direct or unverified interception, preserves host wrappers, and retains real missing-heartbeat and missed-activity failures. The history-only compact bar also needs to preserve these states instead of replacing them with its historical partial-coverage status.

Independent review additionally reproduced a later-outage suppression: after a first missing heartbeat and a successful ready response, a second expired heartbeat returned no new diagnostic because the duplicate guard was lifetime-scoped. Detection now re-arms after recovery while preserving earlier observation gaps. Final verification of this correction is recorded below.

Review of the actual timer callback also reproduced a false timeout after a passive scheduling gap. Renewal counted callback ticks instead of elapsed time; a delayed callback could report an expired heartbeat without first sending a new probe. The correction uses elapsed-time renewal and a single bounded response grace after suspension, without restarting that grace indefinitely or clearing already diagnosed gaps. In the conductor's local browser fixture, a deliberately silent heartbeat preserved historical numbers and showed a tracking problem. A subsequent ready response exposed a separate presentation issue: the recovered outage was still labeled current. These checks are synthetic liveness tests, not new provider generations.

## Verified heartbeat build, awaiting installed-runtime check

The final independent review passed 88 focused checks and type checking. It compared the changed files with the previously verified source archive and replayed the actual content timer callback across the reproduced 11-to-71-second scheduling gap. The corrected callback probed immediately without reporting a failure; a responsive listener remained explicitly unverified. Silent-hook tests confirmed one bounded grace period, repeated-outage detection and preservation of real missed-activity gaps. The conductor's full workspace run passed 707 JavaScript tests, with two Windows symlink checks skipped, including 558 passing extension tests. Workspace type checks passed. No Python implementation changed in this follow-up.

The conductor rechecked the actual content entrypoint in the local browser fixture. Historical Claude counts and estimates remained visible with unverified capture coverage. A real-time silent-heartbeat timeout showed a current problem without erasing two stored historical messages; a subsequent ready response changed it to an earlier problem. At a 320 by 500 viewport, Details opened at vertical pixel 12, its Close button occupied pixels 31 through 61, and client/scroll widths both measured 275 pixels. Close worked. Perplexity historical messages increased from two to four when earlier messages loaded, and replay retained four records. The simulated saved-total failure preserved capture uncertainty; Retry recovered the read and retained the earlier read diagnostic. No live requests or outbox records were fabricated, no fixture text/raw conversation ID was stored, and native fixture markup remained unchanged. At 3,440 by 1,440 CSS pixels, the updated Perplexity bar retained one 768 by approximately 145 geometry across 20 frames. Temporary viewport overrides were cleared.

The new source archive contains 243 files with input fingerprint `039d0dc22fa8df463729cbf1e0f3dda1f65c8b5f497ce4cd427e0e88bde72d89`. Its SHA-256 is `5084dfab7894e23752ccc39e37e37b1b0cbe18671bafb1cdac8c97a0229dd93e`. Independent rebuilding reproduced every path, length and SHA-256 of all 77 files in each browser target. Chrome ZIP SHA-256 is `a020c0081b3b44cfc9b5357d938df7d86c0c90c666ca5bda38e9ee7adc688c02`; the release manifest records Edge and Firefox hashes. The package privacy scan checked 981 items and found no high-confidence sensitive-data candidates. The website production build, download copies and locally served manifest passed independent verification. The prior build is preserved under `artifacts/checkpoints/before-heartbeat-followup-20260914`.

The Chrome output is in the owner's confirmed unpacked-install folder. A further manual Reload was requested because extension-management automation remains denied by URL policy. Until that reload and native checks are completed, the evidence above establishes the reviewed source and artifacts, not that the user's installed runtime is running this heartbeat correction. It is not an overall production-release approval, a completed browser/provider matrix or proof of live hosted synchronization.
