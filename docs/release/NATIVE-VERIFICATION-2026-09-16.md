# Native verification, 16 September 2026

The owner resumed the previously deferred checks and reported updating the Chrome build. Verification uses the connected Chrome profile and synthetic conversations only. This is an in-progress record, not a whole-browser or production acceptance pass.

## Access boundaries

- The browser tool explicitly denied the user-opened extension dashboard URL. No alternate route accessed that page, extension storage or background execution.
- Normal HTTPS provider pages and their visible injected usage bar remain accessible. Chrome DevTools was verified for page-scoped network timing, DOM inspection and numerical capture-message observation.
- No connected Edge or Firefox inspection surface is available. No local PostgreSQL service or configured `AIFT_POSTGRES_TEST_URL` / `AIFT_BENCH_DATABASE_URL` was found. An approved isolated target remains requested; the prior Windows Application Control restriction was not bypassed.

## Chrome / Claude observations

| Check | Current evidence |
| --- | --- |
| First successful text request | One request, about 38 input tokens and 22 output tokens; approximately 0.139 Wh. Full network duration 2.673798 seconds. |
| Second successful text request | Two cumulative requests, about 77 input tokens and 45 output tokens; approximately 0.281 Wh and 0.108 g CO2e. |
| Numerical timing handoff | Second response emitted completed timing with `source: browser_request`, `scope: request`, `completeness: complete_for_scope`, `duration_seconds: 1.9568`. Chrome's request-to-network-finish span was 2.029599 seconds. Terminal receipt precedes final transport closure. |
| Repeated full reload | The two-request conversation retained two requests, 45 output tokens and approximately 0.281 Wh. No duplicate contribution was visible. |
| Earlier historical response | A previous synthetic chat imported one request, 20 input tokens and 11 output tokens. Its saved Claude content-block endpoints span 0.716036 seconds; this is a content-block proxy, not a full request duration. |
| Provider-paused response | Claude paused an identifier-style synthetic request after one character. The extension emitted `interrupted_unconfirmed` with `timing: null`. This is an interruption observation, not a successful-response test. |
| Earlier attachment fixture | A previous synthetic text-file chat imported one request, 34 input tokens and 8 output tokens, approximately 57.8 mWh. A new ordinary request completed with five output tokens and a 3.9551-second live timing value. |
| Historical plus live active display | **Failure found:** the active update showed only the new request (one request, nine input tokens, five output tokens, 60.8 mWh). After reload the retained combined records correctly showed approximately two requests, 43 input tokens, 13 output tokens and 0.119 Wh. |

The visible capture coverage message reports another page wrapper: the listener is active and the observed live operation was captured, but coverage of future requests is unverified. The responsible wrapper has not been identified.

## Open investigation

### Additional provider checks

| Provider | Evidence from the installed Chrome build | Follow-up |
| --- | --- | --- |
| ChatGPT | A synthetic three-tree answer emitted completed live timing of 3.358 seconds. The active bar retained a one-token partial value with unknown resources; reload showed five output tokens and a resource estimate. | The actual content regression reproduces loss of the selected capture during the transient `WEB:` route. A bounded exact-identity recovery is under independent review. |
| Perplexity | A synthetic three-tree answer emitted completed live timing of 4.1771 seconds. The site also performed research. The active bar did not associate the saved request with the conversation; reload showed one request and five output tokens. | Review covers initial thread association and benign navigation notifications during matching. |
| Gemini | Its current composer has no enclosing form and `StreamGenerate` uses XHR. The existing hook was installed but captured neither a live operation nor a mounted usage bar. | XHR interception and native composer placement have been added and are under independent review. |

Gemini's natural response and a separately verified UI-stopped response both ended with `Network.loadingFinished` and the same positional terminal markers (`inner[14] = true`, candidate marker `[2]`). The stopped response visibly said “You stopped this response”. These markers therefore cannot establish successful completion. The new XHR path must retain partial observed text and null timing, with unverified completion, rather than passing an incorrectly complete duration to EcoLogits. The source-packaged fixture at `apps/extension/test/fixtures/gemini-xhr-lifecycle-2026-09-16.json` contains synthetic identifiers and text only.

### Dashboard screenshot

The owner's screenshot shows 157 requests in the combined headline and 157 historical prompts plus 157 historical responses in Request coverage, while the lower tool bars show zero. Source inspection confirms that those bars and the model/token/resource breakdowns use the live-only summary. The historical summary contract currently has no tool/model breakdown. A focused copy correction makes that scope explicit and replaces four zero bars with an empty-live-records explanation. It does not allocate historical requests to guessed providers or change any estimates.

### Organization snapshots

Independent review identified a second omission in the first proposed fix: a server snapshot with nine live requests and three historical requests was displayed as nine when no local historical rows existed. The correction uses the historical summary embedded in the same conversation response, including when local history is empty. It rejects unavailable or missing history as a combined snapshot and retains a coherent local fallback. A separately fetched history summary is not treated as belonging to the same server transaction. Recorded-thread endpoints keep their explicitly scoped matched-live view only when local history is empty.

The active-display omission was independently reproduced through the actual `Coordinator.sendDisplay` path: ten historical request/response pairs plus one live request produced a display with one request, five output tokens and no history field. Immediately querying the recorded route, without a newer provider history fetch, produced the correct approximately eleven requests and 55 output tokens. `publishCapture` omitted the history snapshot which the content renderer requires to combine the two populations. The correction and direct display regressions now pass. The earlier tests checked route summaries but used a no-op display callback, so their pass did not cover this live presentation path.

Some initial conversation loads displayed `History update problem`. A previously unimported synthetic attachment conversation first showed zero/unknown history, then imported correctly after a fresh reload. A fresh reload also cleared the warning on the other historical fixture. Tests using actual background/content/coordinator code reproduce loss on a redundant same-document loading or URL notification. Fresh current-frame proof now distinguishes benign hints from real navigation, without new permissions. Native event ordering was not captured for the original warning, so this is a reproduced compatible mechanism, not proof of its exact native cause. The rebuilt browser check remains pending.

## Follow-up source review

Independent review is clean after correcting all reported findings. This includes bounded remembered route state, read-versus-commit verification in historical and recorded-thread consumers, a final read-only summary guard, exact transient ChatGPT identity recovery, coherent server history pairing, and reentrant Gemini XHR cleanup before sink/timer allocation. Review retained strict navigation, ownership, permission, erasure and calculation guards. Focused evidence includes 109 publication/history tests, 67 Gemini/placement/lifecycle tests, and independent final checks; these overlapping counts are not a whole-suite total. Full-suite and package verification results will be recorded separately.

## Final automated checks for the follow-up

- Full extension suite: **919 passed, one Windows-specific symlink check skipped**, zero failures; `.test-runtime/native-extension-verified.log`.
- Extension typecheck: passed; `.test-runtime/native-extension-typecheck.log`.
- Adapter tests: 40 passed. Module/verification tests: 16 passed.
- The initial full run identified outdated background import harnesses and an actual SQLite fixture which did not schedule the selected default-engine job. The corrected test verifies local fallback while pending, then invokes the existing organization-maintenance path before checking remote history counts, tokens and dates. Existing security and numerical assertions are retained.
- All six variants were rebuilt from the same 533-file source input. OneDrive held an existing generated `background.js` open; Windows Restart Manager identified the holder. The file already matched the new build's SHA-256. Promotion skipped identical files and copied changed files with hash checks, retaining the existing installation paths. `.test-runtime/native-promotion.json` records 13 copied files, 539 unchanged files and no errors. No OneDrive setting or browser profile was changed.
- Matching source archive: 1,795,256 bytes, SHA-256 `4f8d52b591d4f06794c37f6e7ef015f8ac35be43d9775449389d26380be316cf`. All six source rebuilds reproduce all 89 distributed files exactly. The current workspace fingerprint and package/public-alias hashes also match; `.test-runtime/native-final-artifacts.json` and `artifacts/browser/source-verification.json`.
- Current source and packaged privacy scan: no findings or read errors. The website build passes with the current download manifest and reproduction report.
- Native checks must be repeated after the owner reloads the updated extension. The browser tool cannot operate the extension manager, so the final reload is a manual owner step. No new installation folder or profile is needed.

One attempted historical network capture was truncated and another response body was evicted from the inspector cache. Neither is evidence that provider timing is absent. Subsequent narrowly scoped capture retrieved the synthetic history response successfully. Only derived numerical metadata is recorded here; no raw authenticated captures or conversation identifiers are included.

Temporary page observers are restricted to numerical test metadata and are removed after each test. No host request, provider response, browser security setting or ordinary user conversation was modified.
