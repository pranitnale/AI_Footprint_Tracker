# Stale conversation bar after extension reload

## Confirmed cause

The owner supplied three different Claude conversations showing the preceding synthetic test chat's exact totals: 6 requests, 40 input tokens, 98 output tokens and 0.677 Wh. Inspection of the affected Chrome tab showed repeated `Extension context invalidated` errors from the extension's content script.

Reloading the extension invalidated its connection to an already-open page. Chrome threw synchronously when that old script attempted a runtime message. Calls written as `sendMessage(...).catch(...)` could not catch an exception thrown before a promise existed. Both navigation cleanup and the invalidation callback could exit before clearing the old numerical DOM. The host website continued navigating while the disconnected bar stayed visible.

The earlier verification covered live replies in refreshed pages and ordinary navigation failures, but missed the extension-reload lifecycle and synchronous transport exception. Its asynchronous transport double did not reproduce Chrome's behavior. This was a verification gap; previous passing tests did not establish safe display behavior after reload.

Reloading only the affected web page restored that conversation's own figures: 173 requests, 8,299 input tokens and 102,135 output tokens. This supports a stale page display as the cause, rather than identical stored totals for every conversation. No raw conversation content or authenticated captures are retained in this report.

## Correction

- Content-script runtime calls normalize synchronous throws and promise rejection through one local transport function.
- An invalid extension context enters an irreversible stopped state for that page instance. Numerical figures and Details content are cleared first, then observers, timers and pending history bindings are cleaned up without depending on working extension APIs.
- The retained compact bar says `AI usage unavailable` and `Reload required`. Hover and keyboard focus explain the lost connection and the one-time page reload needed after an extension update. It cannot accept late numerical publications.
- A conversation change immediately clears the prior visible figures before cleanup or transport. Each accepted display also retains its page path; render refuses a display belonging to another path.
- No estimator coefficients, ledger records, historical imports or deduplication rules are changed by this correction.

## Verification

New actual-content tests reproduce the synchronous failure both during the invalidation callback and when navigation first discovers it. They require cleared numbers, compact explanatory status, idempotent cleanup and rejection of late displays. Another test navigates using `pushState` and DOM changes, verifies immediate clearing between different conversations, and rejects a delayed summary from the preceding conversation.

The focused content, native-navigation, route-reopening, file-offer and status-help run passed 107 tests. Extension typechecking passed. Final build and installed-browser checks are recorded after completion. The previously documented large-history stress test remains a separate unresolved verification limitation.

The Chrome build completed in the existing `.output/chrome-mv3` folder. The isolated watchdog-timer harness was updated to inject the new local transport dependency and stopped-state input; its original assertions remain unchanged. The final content/watchdog run passed 63 tests after adding stopped-state guards for late health callbacks.

The final broad extension run passed 944 tests, with one Windows platform skip and no failures. The known large-history stress test was excluded, as in the preceding verification records. Final typechecking and whitespace checks passed. Activation of the rebuilt extension and navigation between the owner's affected conversations remain the final installed-browser check.
