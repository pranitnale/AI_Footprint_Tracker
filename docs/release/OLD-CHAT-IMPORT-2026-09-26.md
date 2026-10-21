# Old-chat history import, honest bar states and faster counting

The owner reported that Claude chats created before the extension was installed showed `Req 0`, Unknown figures, `Partly measured` and `Partially loaded · Scroll to the first message` until the page was reloaded. Later checks found three related gaps: `Earlier activity unavailable` after an import, and no bar at all on ChatGPT and Gemini.

## Causes

- **Missed import.** On a Claude sidebar or Recents click, the chat request started 1 to 6 ms before the address changed (five native observations). The page observer compared the request with the current address and ignored it. Claude does not request the chat again, so nothing imported until a reload. Back and Forward reuse Claude's cached chat and send no request.
- **Misleading labels.** With no request in the view, every value was empty and the bar called that `Partly measured`. Empty history was labelled `Partially loaded` with advice to scroll, although Claude returns a whole conversation at once. Unknown water expanded into three items.
- **Stale unavailable state.** Newly imported history waits for the selected method's recalculation. A totals read during that window returned unavailable history, and nothing refreshed the page when the calculation published.
- **No ChatGPT or Gemini bar.** ChatGPT's editor no longer carries `#prompt-textarea`. Gemini's composer fieldset changed class, and Quill's hidden clipboard helper made the tracker see two editors and fail closed.
- **Slow import and totals read.** Each message was counted in a separate round trip, and each counted message needed several separate database reads. A totals read opened up to three transactions per saved row, and each reopen bumped the summary epoch even when nothing changed.

## Changes

- The page observer takes the conversation id from the request. A request for another chat waits, emitting nothing and using no budget, until the address matches or a bounded deadline passes (5 s, or 1 s after the response). It then continues on the existing path. This applies to Claude, ChatGPT, Perplexity (text history and recorded threads) and Gemini (fetch and XHR). An unmatched clone is cancelled so it cannot hold a response in memory.
- A navigation reset keeps a waiting read for the chat now shown. The Perplexity thread start now binds to the new route before the delayed page scan, as text history already did.
- The bar shows `AI usage · Loading earlier messages` while an import can still arrive. After a grace period with no request, it shows `History not loaded`, with the reload advice on hover and in Details. Waiting recalculation shows `AI usage · Calculating earlier messages` or `Updating`, and the page refreshes when the result publishes.
- `Partly measured` requires a measurement. Tokens show `Unknown` without an approximate marker. Water is one compact item, with its parts in Details. `Partially loaded` is a compact label; its hover advice is provider-specific and never tells Claude users to scroll.
- ChatGPT and Gemini composer discovery accepts the current layouts and keeps the earlier ones.
- Counting keeps at most four history counts in flight, shared by every open import, against the worker's 16 slots. The tokenizer worker stays single and serial. The Chrome offscreen document is checked once rather than per message, with one retry if it disappears.
- Imports reuse one HMAC key per import. Existing rows are read in batches of up to 100 in one transaction.
- The totals read uses one flags read and one results read per 100 rows.
- An unchanged reimport leaves the summary version alone. Changed coverage (other than the observation time and the sync-only pending flag) still bumps it.

## Measurements

**Native Chrome, owner's profile, 26 September 2026.** Timings run from the click or navigation start. The window was in the background, so the bar's text was checked only through automated tests. Height was used as a proxy.

| Case | Before | After |
|---|---|---|
| Claude sidebar open, unimported chat | never imported (checked for 60 to 100 s) | 2 messages: figures about 1.0 s; 8 messages: finish 1.7 s; 122 messages: finish 0.8 s, bar settled 2.2 s |
| Claude reload, first import, 71 messages | figures 9.8 s | not repeated (chat already imported) |
| Claude reload, re-import | 128 messages: 8.7 s | 163 messages: 7.9 s; 71 messages: 6.3 s |
| One small import's background messages | start plus batch about 2 s | start 342 ms, batch 18 ms, finish 83 ms, totals read 238 ms |
| ChatGPT, Gemini bar | not mounted | mounted; history captured on sidebar open |

On reload, part of the remaining time is Claude streaming its own response. A later check of a 359-message chat found that most of the wait was the extension's own reimport and a discarded first totals read, which the [live capture and reopen record](LIVE-CAPTURE-AND-REOPEN-2026-09-26.md) corrects. The earlier fixed 2 s setup did not recur, so the route-proof code was not changed. ChatGPT changed its address before requesting the chat (114 ms against 329 ms), so it was not affected by the race.

**Synthetic benchmark.** 300 Claude messages, real tokenizer worker, fake IndexedDB, 4 ms modelled message hop. Scratch script, not shipped.

| Phase | Before | After |
|---|---|---|
| First import | 3.3 to 4.5 s (counting 1.8 to 1.9 s) | 1.8 to 1.9 s (counting 0.6 to 0.7 s) |
| Totals read | 2.0 to 2.3 s, 3,024 transactions | 0.65 to 0.69 s, 212 transactions |
| Re-import of unchanged messages | 1.9 to 2.2 s | 0.5 s, 54 transactions |
| Peak heap above start | 105 to 114 MB | 114 to 116 MB (same range) |
| Counts in flight | 1 | at most 4 |

The earlier runs did not wait for background recalculation between phases, so their transaction counts partly include that work. The tokenizer itself counted about 517,000 characters of natural text in about 60 ms, so its privacy-motivated disabled merge cache was kept.

## Verification and limits

- The final extension suite passed: 84 files, 980 tests, 979 passed, 1 Windows skip. The known `large-history.test.ts` stress case was excluded, as in earlier records.
- Also passed:
  - package suites: ledger 218, adapters 44, estimator 113;
  - documentation checks (105) and the web suite (48);
  - extension typecheck;
  - Chrome, Edge and Firefox builds.
- Not verified:
  - Edge and Firefox native checks;
  - a native Perplexity sidebar check;
  - a native observation of the Calculating state on a long chat;
  - the Firefox polling fallback, since Chromium binds through the Navigation API.
- Tokens and resources remain estimates under the existing coverage rules.
