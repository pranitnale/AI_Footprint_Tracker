# Cross-provider resource-bar checks

This is an unfinished native verification record, not a claim that every provider passes.

## Observed behavior

- ChatGPT: two successive synthetic replies in one conversation updated automatically from 1 request, 19 input / 10 output tokens, 31.3 mWh to 2 requests, 32 input / 15 output tokens, 53.3 mWh. No tab refresh occurred between the replies. Token and footprint values are the extension's estimates, not provider billing or physical measurements.
- Gemini: the composer was visible but the bar did not mount. The native idle button label was `Dictate (^⇧D)`, while the selector required the exact label `Dictate`. The revised selector accepts the observed shortcut suffix within the same bounded, unique semantic composer checks. Tests cover idle, draft, generating and ambiguous composers for both labels. Native activation remains pending.
- Perplexity: live requests were recorded, but the new conversation initially had no proven thread membership, so its totals were unavailable. A diagnostic refresh allowed the separate thread observer to associate all four recorded requests, producing 4 requests, 82 input / 30 output tokens and 0.419 Wh. This refresh is a reproduction step, not a passing no-refresh test.
- Perplexity numeric history also failed independently. Its adapter supplies bounded `user_selected_model` and `display_model` labels, but the history bridge still required `modelId === null`. The bridge now accepts only the same bounded label grammar, only for Perplexity. Unsupported model mapping remains the normalizer's responsibility. Arbitrary metadata and labels on other providers remain rejected.

## Validation

The new populated-model bridge test failed before the fix. Afterward, 190 focused tests passed with no failures or skips across actual content entrypoints, composer placement, history parsing/counting/service admission, active recorded threads and recorded-thread isolation. The worker and service integration tests now include populated model labels; earlier null-only fixtures did not exercise the defect. Extension typechecking and the local Chrome build passed.

The rebuilt output is `apps/extension/.output/chrome-mv3`. Packaged website downloads were not regenerated for these changes. Existing unrelated edits were preserved.

## Remaining work

- Activate the new build and verify the Gemini bar and Perplexity numeric-history import in Chrome.
- Complete no-refresh navigation checks for Claude, ChatGPT, Gemini and Perplexity, including history predating extension installation and cached sidebar navigation.
- Establish a supported, validated live Perplexity thread relation. Its live SSE `thread_url_slug` equals the current answer's backend identifier on follow-up replies, whereas fetched history normalizes that field to the root route. Treating every SSE slug or context UUID as a conversation route would silently misattribute requests. No such shortcut was implemented.
- Verify Gemini completion/counting once its bar mounts.
- The existing verbose partial-history status and insufficient-boundary notice remain subject to the owner-confirmed compact-bar decision and the open MSG-001 item in `CHAT-BAR-REVIEW-PROGRESS.md`.

Browser management was explicitly denied by the browser tool. Desktop computer-use is not an override of that denial. The owner was asked to click the extension's Reload control after the concrete build completed. During subsequent checks the AI-page connection also began returning `Debugger unattached`; native verification cannot continue until that connection is restored. Temporary Perplexity debugger breakpoints were removed. Raw authenticated responses, credentials and private conversation contents were not written to this report or the repository.
