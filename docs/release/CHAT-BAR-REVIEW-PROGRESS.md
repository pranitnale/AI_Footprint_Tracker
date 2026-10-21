# Chat-bar review implementation

Review page: `review/chat-bar-messages/index.html`, served locally at `http://127.0.0.1:43127/`.

## First batch, 22 September 2026

The owner requested implementation of straightforward comments while continuing to review. This batch uses the initial snapshot of General feedback and MSG-001, MSG-006, MSG-007, MSG-008 and MSG-010. Later edits and additional comments have not yet been processed. The review page was not reloaded or edited during this batch; its browser-saved comments remain the review source.

| Review reference | Request | Result in this batch |
| --- | --- | --- |
| General feedback | Make error text smaller and show the action to take on hover. | Implemented for the chat-bar status row: 11px instead of the inherited 12px. A tooltip gives status-specific recovery guidance, with diagnostic-specific actions for tracking failures. Keyboard focus exposes the same advice; Escape, blur and outside interaction dismiss it. Normal statuses do not gain unnecessary focus stops or stale recovery text. |
| MSG-001 | Show Partially loaded for evidence of missing earlier messages, not merely insufficient website evidence. | Pending. The UI's historical summary exposes `first_request_verified`, while page records separately contain nullable `has_earlier`/`has_later`. A follow-up must carry reliable missing-history evidence through local and company summaries, preserve unknown coverage in Details, and test each provider's boundary evidence. Treating false as true or removing the notice unconditionally would not implement the requested distinction. |
| MSG-006 | Recover untracked messages by reading history and reconciling the whole conversation. | Pending. Clarification: matching incomplete identifies unresolved overlap between history and live records, not simply a period with tracking disabled. History already imports when supported data loads. Follow-up must improve capture/reconciliation across disabled/enabled periods without double counting, claiming complete hidden execution, reading while tracking is disabled, or generating prompts. |
| MSG-007 | Investigate image output tokens, explain missing metrics and minimize unnecessary partial warnings. | One concrete false warning fixed. The bar used to check all metric fields, including the intentionally unused EcoLogits water breakdowns. It now checks electricity, carbon and total water, which are the displayed totals. Actual missing contributions and observed image operations still yield Partly measured. Image-token support remains pending provider-specific investigation. |
| MSG-008 | Fix avoidable failures rather than merely showing errors. | Applied to the confirmed MSG-007 bug. Broader recovery work remains pending; actual lost observations are not marked recovered simply because a later request succeeds. |
| MSG-010 | Increase capture capacity to minimize limit errors. | Pending. Trace admission and downstream throughput before changing the limits. Prefer bounded buffering/coalescing that preserves dispatch/final events, then measure suitable limits. An unbounded or arbitrarily large limit is not an established maximum supported capacity. |

## Explanation for MSG-007

Resource metrics are electricity, carbon and water estimates, not extra categories of text tokens. Text requests can lack a resource estimate when usable output counting or a compatible model profile is absent, or calculation inputs/results fail validation. In addition, the current summary retains direct-water and electricity-supply-water slots for older records, while EcoLogits intentionally does not fill those slots. The latter caused the false partial notice corrected here. Hidden reasoning remains outside fully observed coverage even when all three displayed resource estimates are available.

Image output tokens must not be invented by counting image file bytes as text or assuming that every provider uses the same image token representation. Establish the supported provider evidence and units before introducing an image output count. This batch changes no counting formulas or observation records.

## Validation

- A regression using the actual local EcoLogits executor and `summarize` reproduced the false partial status before the fix.
- After the fix, the same test verifies a recorded status for available primary totals, a partial status for each missing/unknown primary metric, and a partial status for observed image operations.
- 87 focused tests passed across conversation-status-help, actual content-entrypoint harness, diagnostics and version-2 estimation summaries. No failures or skips. Log: `.test-runtime/chat-bar-first-batch/tests.log`.
- Extension TypeScript check passed: `node node_modules/typescript/bin/tsc -p apps/extension/tsconfig.json --noEmit`.
- Tooltip behavior checks cover hover, pointer exit, keyboard focus, Escape, blur, no additional requests, and stale-help removal after recovery. Saved-total read failures retain read-only retry advice rather than a claim of failed storage writes.
- Final review corrected outside-click handling for the closed shadow root, so clicking within the tooltip does not dismiss it. All 53 content-entrypoint tests passed again, including internal/external pointer interactions; the extension TypeScript check also passed again. Log: `.test-runtime/chat-bar-first-batch/content-final.log`. These tests overlap the earlier 87-test run and are not an additional unique test count.
- This is local source validation with DOM/transport doubles, not installed Chrome/Edge/Firefox provider verification. No package rebuild, deployment, publication or push was performed.

Existing unrelated working-tree changes were preserved. Pre-batch snapshots of the edited existing files are retained locally under `.test-runtime/chat-bar-first-batch/` to distinguish this batch from earlier work.

## Tracking accuracy changes, 4 October 2026

The tracking accuracy work of 4 October 2026 changed several reviewed messages. The review page keeps every message id, so saved comments keep their anchors; the texts below were updated on the page.

| Review reference | Change |
| --- | --- |
| MSG-001 | NotebookLM never shows Partially loaded: its saved content is not paged. The earlier request (show the label only for evidence of missing messages) is still pending. |
| MSG-007 | Partly measured is no longer a status on the bar (owner decision, 2 October 2026). Details shows a Partly measured paragraph naming the parts that were not read or were read in part, and replies without a resource estimate. Image operations no longer make a reply partial, because images are now estimated. |
| MSG-008 | Tracking problem shows only while a problem is active. It clears when a later capture is saved in full; earlier problems stay in Details under page tracking health. |
| MSG-010 | Capture capacity: eight captures per tab instead of four; captures already known to be complete give up their slot when a new reply needs one; progress updates over the rate limit are held and sent a moment later instead of dropped, and send and finish updates pass up to 64 per second. |
| MSG-040 | Generated images are estimated at 2.9 Wh each before data-centre overhead (Luccioni et al. 2024) and added to the totals. The original method's archived benchmark, formerly Image energy unavailable or Benchmark reference only, now describes the benchmark rather than the reply and is listed only where not every image is estimated: results of the original method (before 4 October 2026, or the Original engine where a build offers it) and replies with an image that could not be estimated. Each reply is judged on its own; replies with the same benchmark and settings share one line, and past 32 different lines Details says how many more are not listed. The website's organization summary still lists the benchmark series, separately from the totals. |
| MSG-046 | Details has a Not included section listing work the site does not show. Model-written tool input and generated media are now counted. |

Validation is part of the tracking accuracy record: automated tests with synthetic fixtures, not an installed-browser check.

