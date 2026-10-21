# Claude history import without a conversation size cutoff

The owner reported a 534-message Claude chat whose history remained at zero usage with `History update problem` even after scrolling to the first message. The observed native history response was 1,268,829 UTF-8 bytes. Its selected branch held 613,554 text units, including inline file text. Both exceeded the old 1 MiB response and 512 Ki text limits. The chat itself had a coherent first-message chain, so scrolling could not repair the import.

The Claude path now parses the host's already-issued response as a JSON stream. It extracts one validated provider row at a time and sends at most 50 rows or approximately 512 Ki text units per batch, except when one indivisible message is larger than the batch target. The isolated content script forwards a batch only for its current conversation and awaits the background acknowledgement before the main-world parser advances. Counting runs in the existing private worker. The background keeps numerical rows and source identifiers, then reconstructs the selected branch and commits numerical history in groups of 100. Raw conversation text is not persisted. Idle leases renew after acknowledged batches, without a whole-conversation time or size cutoff. A final commit sends progress heartbeats while it runs.

The verified local behavior is:

- A synthetic 4,300-message, greater-than-8-MiB response parses without the former conversation-wide byte, text or message limits.
- A synthetic 534-message selected branch above the old thresholds crosses the actual observer, private counter, HistoryService and ledger; 267 prompts and 267 responses are stored as numeric history, with first-message proof. A separate forked answer is parsed but excluded from the saved branch. No live request is invented, and raw synthetic message text is absent from saved records.
- Navigating before finalization leaves no partial numeric records. Duplicate source IDs, incomplete JSON and wrong route or lifecycle data fail explicitly.
- A true remaining import failure shows a compact status and a reason on hover/focus and in Details. It does not tell a user to scroll to repair a size failure or display `Req 0` as a plausible full conversation total.
- The broader extension test run from the extension directory passed 954 tests, with one Windows-specific skip and no failures. The known `large-history.test.ts` stress case was excluded, as in earlier runs. All 44 adapter tests, extension typechecking, the production Chrome, Edge and Firefox builds, and the production dependency audit passed. Installed-browser verification remains separate.

The installed Chrome extension still needs activation of this build and an observed run against the affected chat. This record does not establish a true physical resource measurement: tokens and resource totals remain estimates with the same model and hidden-work coverage rules as before. A later [cross-provider correction](CROSS-PROVIDER-BATCHED-HISTORY-2026-09-23.md) replaces the other providers' whole-response import paths. Long single messages or inline file fields can still exceed the private tokenizer's per-field safety limits and must remain visibly unknown rather than silently estimated.

The affected Chrome tab still displayed its old history failure during the pre-activation inspection. That observation is not a test of the rebuilt package. The owner was asked to reload the extension and refresh this tab once so the new content scripts can run; ordinary chat changes do not require a refresh.

The streaming JSON implementation uses the browser-capable MIT-licensed `@streamparser/json` package. It neither fetches private history independently nor changes the host request, response, scrolling or controls.
