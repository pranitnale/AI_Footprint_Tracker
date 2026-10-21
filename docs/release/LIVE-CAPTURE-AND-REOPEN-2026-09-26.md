# Live replies and reopening saved chats

The owner reported two problems in the MCQs Claude chat, which has about 360 saved messages:

- after sending "hi", the bar stopped updating and showed Tracking problem;
- reopening a chat that was already counted took about as long as the first import.

Native checks on 26 September 2026 (five "hi" sends and several reloads) found the causes below.

## Causes

- **Stale live updates.** While a reply streams, the page posts a progress update about every 0.75 s, each with the whole reply so far. The background processed every update fully and in order:
  - it counted the reply again;
  - it saved a new revision, which put the selected method's calculation back into waiting;
  - it rebuilt the bar, which reread the whole chat.

  Each update took 1.3 to 5 s, so updates piled up. The bar kept showing old revisions for 15 to 40 s after the reply ended. It flipped between whole-chat totals and figures for this page only, with Earlier activity unavailable, Partly measured and a late Processing.
- **Tracking problem from thinking summaries.** The Tracking problem in the owner's report had a separate cause, found after the backlog fix; see [Thinking summaries](#thinking-summaries).
- **Tracking problem from the backlog.** Three limits could also turn the backlog into a sticky page problem. This was reproduced in the synthetic benchmark:
  - the background queue holds 16 updates and rejected any update beyond that, including the final one;
  - building the bar gave up after three tries while the calculation kept changing;
  - reading saved totals gave up after three quick tries.
- **Slow reopen.** Reloading an unchanged 359-message chat showed Loading recorded conversation totals for about 7 s, although Claude had delivered the chat 2.9 s after the reload started. Three things caused the wait:
  - The page discarded its first saved-totals read when the reimport finished, then read again.
  - Non-final 100-message batches rewrote the chat's coverage without its selected message. Even an unchanged reimport therefore changed the summary version twice and forced retries.
  - Every message was counted again. In company mode, an empty coverage upload was also queued on every reopen.

## Changes

- **Merging live updates.** A waiting progress update of a reply is replaced by the newer one, or by the end update, which carries the same cumulative reply. Send and end updates are never merged away. Upload work sharing the reply's queue keeps its place.
  - A running reply may always keep one waiting update.
  - New progress updates face the old limit of 16. Send and end updates have a reserve of 32 in total.
  - A replaced update is not a tracking problem.
- **When the bar updates.** A live update publishes after a fresh calculation pass that includes it: at most 0.75 s for progress, 3 s for the end update. A progress update skips its display only when a newer one is waiting and the bar changed less than 2 s ago, or when the end update arrives while it waits for recalculation. The end update always publishes.
- **Waiting calculation.** A live display now says when its calculation is still waiting. The bar then keeps the last complete whole-chat figures with the compact Updating label, for up to 15 s. The background republishes that display when the calculation publishes, at most five times.
- **Failed publication.** If building the bar keeps failing after the update was saved, the capture is no longer reported as lost. The display is retried. After three failed retries, the page shows a non-sticky Tracking problem, which the next display clears.
- **Saved-totals reads.** A read that would be discarded while a live display is shown is no longer sent. The first read on reload is kept, and one refresh runs after it.
- **Coverage writes.** Non-final batches of a multi-batch import leave existing coverage alone until the final batch. Unchanged coverage is not rewritten, so its upload flag and any in-flight receipt stay valid.
- **Faster saved-totals read.** A saved-totals read issues each page's erasure checks, live-overlap checks and result reads together within its one transaction, instead of waiting for each row in turn. On page load the read starts when the content script loads, not when the bar mounts, so a long chat's totals are ready when the bar appears.
- **Count reuse.** Each saved message keeps a local count basis: its text length, file text lengths, counting runtime and the counts produced. A reimported finished message with the same lengths under the same runtime reuses its saved count. Anything else is counted again, including existing rows until they gain a basis.
  - The basis never holds text or a hash of text, and it is never synchronized.
  - Limit: a finished message changed in place under the same identity with exactly the same length keeps its earlier count. Claude, ChatGPT and Gemini create new message identities for edits and regenerations.

## Thinking summaries

After the changes above, the owner edited an earlier message in the MCQs chat, and the bar again showed Tracking problem. Its reason was Site response could not be observed (`protocol_unsupported`), a capture problem that stays until reload.

**Evidence** (read-only, block types and counts only):
- Claude.ai now streams a reply's reasoning as a thinking block with a one-line summary and empty thinking text.
- In the saved chat, the edited reply and the owner's original "hi" reply at 08:31 are the only recent replies with such a block. The owner's report came from that 08:31 reply.
- The ten later "hi" replies in that chat had no thinking block. None of the five sent in the native checks after the changes showed Tracking problem.
- Claude's page code handles `thinking_summary_delta`, `thinking_cut_off_delta` and `tool_use_block_update_delta`. The tracker's Claude reader rejected every delta type it did not know, so the whole reply was reported as unobserved.

**Change.** The Claude reader accepts these three display updates, but only on the block type they describe: thinking for the first two, tool use for the third.
- It ignores their content. Summary text is not counted as visible thinking and is not kept.
- A summary-only thinking block therefore has zero visible thinking tokens, and hidden reasoning stays marked as unobserved.
- Other unknown updates, including `connector_text_delta`, which Claude's page treats as answer text, still fail the capture visibly instead of being guessed.

**Verification.** Adapter and capture-runtime tests cover a summary-only reply completing without a failure and without keeping summary text. They also check that the new updates are rejected on the wrong block and that other unknown updates are still rejected. A native check needs a reply in which Claude thinks, and that is not predictable with short test messages.

## Measurements

**Synthetic benchmarks.** Real Coordinator, HistoryService and page observer, fake IndexedDB, and a text-length counter with a modelled 4 ms message hop. These are scratch scripts in `tmp/fp-bench`, not shipped.

A streamed reply (42 frames, 100 ms apart) against 360 saved messages:

| Measure | Before | After |
|---|---|---|
| Last bar update after the reply ended | 18.8 s | 1.3 to 1.4 s |
| Rejected updates (`buffer_overflow`) | 24 of 42 | 0 |
| History shown as unavailable during the reply | every progress display | never |
| Frames fully processed | 18 | 7 (35 merged) |
| IndexedDB transactions | 3,833 | 1,481 |
| Peak heap above start | 164 MB | 117 to 134 MB |

Reopening an unchanged 360-message Claude chat:

| Measure | Before | After |
|---|---|---|
| Count calls on reimport | 360 | 0 |
| Summary version changes | 2 | 0 |
| IndexedDB writes | 6 | 0 |
| First saved-totals read during the reimport | 4.3 to 4.5 s | 1.2 to 1.8 s |
| Saved-totals read on its own | 1.3 s | 0.9 to 1.5 s |

**Native Chrome, owner's profile, MCQs chat (359 streamed rows), 26 September 2026.** Timings run from the start of navigation. Temporary timing marks were added for these runs and removed afterwards.

| Measure | Before | After |
|---|---|---|
| One saved-totals read, warm, no import running | 2.5 to 4 s (Back navigation) | 1.4 to 1.5 s |
| Saved totals shown after a warm reload | 8.5 s (5.6 s after the stream ended) | 7.9 s (1.5 s after the stream ended) |
| First reload right after an extension reload | not measured | totals at 12.2 s; read 7.7 s while the first reimport ran |
| Reimport of an unchanged chat | every message counted | no message counted once rows carry a count basis |

In that warm reload the bar mounted 5.7 s after navigation start, because Claude renders its composer late. After the read moved to content-script start, a warm reload showed the saved totals the moment the bar mounted, 4.1 s after navigation start. That was 2.7 s before Claude finished sending the chat, and nothing flickered when the reimport finished.

Live replies in the same chat, after the changes:

| Measure | Before | After |
|---|---|---|
| Bar settled after the reply ended | 15 to 40 s, with replayed partial figures | 3.0 to 4.1 s, no replay |
| Flips between whole-chat and page-only figures | two to four per reply | none |
| Earlier activity unavailable, Partly measured or a late Processing | shown | not shown |
| Progress displays while Claude writes | stale and flipping | whole-chat figures, Processing, and output tokens rising (141 to 151, then 172 at the end) |

A progress display taken before Claude has streamed any reply text (`started` false) correctly keeps the previous figures. The 3.0 s run was measured before a final change: a progress frame now skips its display when the end frame arrives while it waits for recalculation. That change is covered by tests but was not measured natively.

## Verification and limits

- Extension suite: 86 files, 1,012 tests, 1,011 passed, 1 Windows skip. The known `large-history.test.ts` stress case was excluded, as in earlier records.
- Also passed:
  - package suites: contracts 28, adapters 46, capture-core 11, tokenizers 7, estimator 113, ledger 220;
  - documentation checks (105) and the web suite (48 passed, 1 skipped);
  - extension typecheck;
  - Chrome, Edge and Firefox builds.
- Edge and Firefox are covered by tests and builds only, not by native checks.
- The 0.75 s, 3 s, 2 s and 15 s timing values are provisional and were not tuned natively.
