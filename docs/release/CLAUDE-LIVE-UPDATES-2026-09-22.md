# Claude live conversation updates, 22 September 2026

The owner reported that the installed Chrome extension kept old conversation totals until the page was refreshed. Authorized synthetic prompts reproduced the stale bar in the existing Claude test conversation.

## Causes and corrections

- Claude sends compressed requests containing tool definitions, even for short prompts. The observed request was about 453,000 decoded characters, within the existing body limit, but its tool definitions had 20 nesting levels. The generic 16-level frame validator rejected the dispatch. The Claude adapter now projects and validates only the prompt, parent/request/model identities and attachment fields it consumes. The total body-size limit and validation of consumed fields remain enforced. Tool definitions never enter the capture bridge or ledger.
- A capture failure could be saved successfully without appearing in the page status when it lacked a conversation identity. Validated failure events now use the same diagnostic mapping in the background and the content script. Saving the failure does not imply successful measurement.
- The first installed-fix check exposed a completion-publication race: background recalculation could still be pending when the final display was sent, temporarily excluding previously calculated history. Terminal capture publication now awaits the existing bounded local maintenance operation after identity reconciliation. Original website requests and responses still proceed independently of counting and estimation.
- Per the owner's follow-up, the compact bar omits scenario and midpoint suffixes. Details retain the selected values, fallback explanations and provenance. An approximate count remains approximate.
- Normal history without a verified live link, including history imported after reinstalling, does not trigger the bar's Matching incomplete warning. Conflicting historical records do trigger it; hover and keyboard focus explain the conflicting identities or measurements and their exclusion from totals. Unverified overlap remains disclosed in Details.

## Verification

- A new parser regression reproduced the original nesting failure before the correction. Malformed, oversized and unsafe consumed fields remain rejected.
- Capture tests cover three successive gzip requests with deep tool definitions, completed answer capture and unchanged host responses.
- A coordinator regression covers three completed replies with delayed background maintenance, increasing resource estimates and retained earlier-history totals.
- Content tests cover visible capture failures, quiet ordinary imported history, genuine matching conflicts with hover guidance, and scenario labels retained in Details rather than the compact bar.
- The pre-existing native-navigation harness extracted definitions only before the first test. Two recently added status tests preceded those definitions. Moving those tests below the helpers restored all 24 native-navigation checks without changing their assertions.
- Adapter suite: 44 passed. Extension typecheck passed. Focused completion, coordinator, history-engine and native-navigation checks: 51 passed. Focused presentation and hover checks: 70 passed.
- A broad extension run after the parser correction passed 937 tests with one Windows platform skip, excluding the previously documented large-history stress test. The initial unfiltered run stalled on that stress test; its task-owned process was stopped after roughly 112 seconds. It was not marked passed.
- The final extension regression run after the completion and conflict-warning corrections passed 939 tests, with one Windows platform skip and no failures, excluding that same large-history stress test. Final extension typechecking and the Chrome build passed.

## Installed Chrome check

After the owner reloaded the rebuilt extension and refreshed the active Claude test page once, two authorized synthetic replies were sent in the same page session. No reload or navigation occurred between them.

| Visible state | Requests | Input / output tokens | Electricity | Carbon | Water |
| --- | --- | --- | --- | --- | --- |
| Before new replies | 4 | 5 / 81 | 0.523 Wh | 0.201 g CO2e | 1.94 mL |
| First reply completed | 5 | 22 / 89 | 0.598 Wh | 0.230 g CO2e | 2.22 mL |
| Second reply completed | 6 | 40 / 98 | 0.677 Wh | 0.260 g CO2e | 2.51 mL |

The bar updated automatically after each completed reply. Neither repeated midpoint/scenario labels nor a Matching incomplete warning appeared. These are observed, rounded UI estimates, not provider measurements or a benchmark of completion-to-display latency. The genuine-conflict hover case was verified in the actual-content test harness, without corrupting real user records to manufacture an error.

A separate check in the older conversation retained its imported history while advancing from approximately 16 to approximately 17 recorded requests after a new reply, without a further reload. Electricity increased from 0.828 to 0.895 Wh and output tokens from 129 to 136. Its pre-existing unresolved live/history overlap remains approximate and disclosed in Details; that check establishes retained history and one new increment, not exact reconciliation of every older request.

The updated unpacked Chrome build is local development output. Public download ZIPs, Edge/Firefox installed behavior, publication and deployment are outside this change's verification.

## Follow-up: opening an older chat without refreshing

The owner's follow-up identified a separate history-navigation path not covered by the live-reply correction. A host `pushState` navigation can start its history request before the content script's delayed DOM scan updates the navigation binding. The later scan used to invalidate that just-started import and cancel its page observer, leaving an empty saved view until refresh.

A validated history start for the currently visible conversation now synchronizes the route immediately, clears stale content/background bindings and keeps the matching page response alive. Normal navigation, scope changes and permission revocation still use their existing invalidation behavior. Late pages from previous bindings remain inadmissible. No additional provider request, automated scroll, DOM text scraping or live-request record is introduced.

Regression tests execute the actual content entrypoint for Claude and ChatGPT with `pushState`, an early history start, a delayed route scan and a later completed history page. They verify automatic numerical display, a shared start/page binding, no cancellation of the matching page observer, and no fabricated live capture. The route-race regression failed before the correction; the corrected fixtures pass for both providers. The focused content, native-navigation, history-capture and route-reopening run passed 103 tests; extension typechecking passed. Installed-browser confirmation of this follow-up awaits the owner's reload and test.

The follow-up Chrome build completed successfully in the existing `.output/chrome-mv3` installation folder. Public download archives were not rebuilt.

Only synthetic request shape, event types and numeric display observations were used as evidence. Raw authenticated request/response bodies, credentials and provider conversation identities are not saved in this record.
