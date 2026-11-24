# Organization totals in one method: design

Status: design for approval, 23 November 2026. No product code is written yet.
File and line references are to local `main` at `900de48a`.

## The problem and the decision

Members' browsers calculate with the EcoLogits data packaged in their extension version. Rows of
two data versions never add (`packages/ui/src/totals.ts:95-139`), so an organization total goes
blank as soon as two versions are in use.

Owner decisions of 23 November 2026:

- The server keeps every reply of an organization calculated with its newest method. Organization
  totals, a member's own totals inside an organization, the admin website and exports use these
  figures. A past period can change after a data update.
- Originals stay stored and are never overwritten.
- The bar under a chat and Details keep the browser's own calculation.
- No interface change: no new line, label, note or control.

Words used below: the **default method** is the method packaged in the running server build
(`default_method_id` of `GET /v1/methods`, `apps/server/aift/method_registry.py:253-270`). The
**current view** is the recalculated view of the default method.

## 1. Where the figures live and how they stay complete

No new table and no migration.

- **Figures.** One row per record in `engine_estimates` with `view = 'recalculated'` and the
  default method's id. This is what a recalculation job writes today
  (`method_history.py:497-535`). Rows are keyed by record, record hash and method, not by job, so
  rows that a member's own job already wrote for the same method are reused.
- **Completeness.** One server-owned row per organization in `method_recalculation_jobs`:
  `owner` NULL (whole organization), `actor` `"system"` (the name the audit log already uses for
  the worker, `maintenance.py:300`; the column is not nullable), `method_id` the default method,
  `id = digest(canonical([company.id, "current-method", method_id]))`. New function
  `MethodHistory.keep_current(session, company, owner=None, create=False)` keeps the row: it
  replaces server-owned rows of earlier default methods (their estimates stay stored) and calls
  the existing `advance`.
- **Who starts the job** (chief's decision of 23 November 2026). The worker starts it by itself
  for every organization that has current records (a live attempt or a saved message that counts
  today), so the figures are made after a server deploy before any browser or the admin website
  asks. An organization without records gets no job. A `current` request starts the job too when
  the worker has not yet (section 2), which matters right after an erasure.
- Because the worker now adds a default-method estimate for every record, a few existing tests
  that counted every row of the estimates table after a worker run count the rows of their own
  method instead; the commit lists each changed assertion.

What triggers the work:

| Event | What happens | Window without figures |
|---|---|---|
| Server deploy with this change, or with a new default method | The worker's next tick calls `keep_current` for every organization. It creates the job for the default method (replacing a server-owned job of the earlier default) and `advance` fills it, 100 records per tick (`method_history.py:27`). The server-owned job is advanced first on every tick, before the five jobs `cursor_page` picks, so members' own jobs cannot delay it. | Until the job completes, once per data update. See section 7. |
| A record arrives (usage batch or saved-history page) | At the end of the same upload transaction the server calls `keep_current(owner=member)`: `advance` narrowed to the uploading member, budget 100, inside a savepoint. It calculates the new records with the default method at once. A failure is caught, the upload still succeeds, and the worker retries 5 seconds later. | None in the normal case. |
| A correction (new revision of an attempt) | The record hash changes, so its estimate no longer matches (`method_history.py:250-272`). The same upload hook calculates the new revision. The old revision's row stays stored. | None. |
| A saved message changes or links to a live reply | `invalidate_linked_estimates` removes the dependent recalculated rows (`engine_history.py:627-654`), as today. The same upload hook calculates them again. | None. |
| Erasure or deletion-epoch change | `invalidate_erasure` deletes every job of the organization (`method_history.py:211-213`) and the erased records' estimates (`erase_record`). Estimates of other records stay valid. After the deletion finishes, the worker's next tick or the next `current` request, whichever comes first, creates the job again. Nothing is missing, or only records that arrived in between, so that tick or request completes it. | While the deletion runs the answer is the existing "being updated" state. Afterwards none in the normal case. |

Uploads and the worker already run under the same organization lock (`db.py:414-423`), so the
upload hook and a worker tick never calculate the same record at the same time.

One rule is new, for the server's job only (`resolvable_only` in `MethodHistory.missing`): a live
attempt whose original method the server cannot resolve (not the baseline, the packaged method or
a row of `method_bundles`) is not counted as missing. It cannot be recalculated, because the
recalculation needs the original method's hash, which only saved messages carry. Jobs of members
and administrators keep their rule, under which one such record keeps the job pending. See
section 4.

## 2. What each endpoint answers and how a client asks

New request value: `calculation_view=current`, without `method_id`.

| Endpoint | `current` accepted |
|---|---|
| `GET /v1/company/summary` | yes |
| `GET /v1/me/summary` | yes |
| `GET /v1/admin/summary` | yes |
| `GET /v1/admin/activity` | yes |
| conversation, saved-chat and single-record endpoints, exports | no, 422 `unsupported_filter` as for any unknown view |

Server handling: one rewrite at the top of `Analytics.route` for these four paths, next to the
existing rewrite for a device's estimation choice (`analytics.py:172-187`). `current` becomes
`calculation_view=recalculated&method_id=<default method>`. Everything after it (readiness,
summary, splits, saved history, activity) is the existing recalculated path, unchanged.

A `current` request that finds no job for the default method (the worker has not started it yet,
as right after an erasure, or the organization has no records) must write: it creates the job and
runs its first page. Summaries are read without the organization's lock, so such a request uses the
existing read-first path of `GET /v1/config` (`main.py:303-316`): it runs as a read, and only when
it must write it runs again under the lock. When the figures are still incomplete after that
page, the transaction is committed first and the answer is then the 409 below.

Answers to a `current` request:

| Case | Answer |
|---|---|
| Figures complete | 200, the existing recalculated shape: `calculation_view: "recalculated"`, `method_id`, `method_hash`, `recalculation_job_id` (the server-owned job), `recalculated_at`. Every row of `resources`, of each split and of `history.resources` names the default method. |
| Figures not complete | 409 `recalculation_pending`, retryable. Never a partial or mixed answer. Readiness is the existing rule (`method_history.py:609-630`): a completed job for the organization in the current epoch and no missing record of the asked population. For `/v1/me/summary` the missing-record check covers that member only; the organization's job must still have completed once for the method. |
| Erasure running, or totals rebuilding for a new time zone | 200 with `aggregate_status: "rebuilding"` and no method fields, the same body the original view gives today (`analytics.py:1557-1566`). The rewrite checks this first, because an erasure deletes the jobs. |
| Sharing off, suppressed | 200 as today (`policy_disabled`, `suppressed`). |
| `method_id` sent with `current` | 422 `unsupported_filter`. |
| Server from before this change | 422 `unsupported_filter` (`method_history.py:602-603`). This is the fallback signal. |

Published 0.1.0: nothing it sends changes meaning. `calculation_view=original` still answers the
stored originals from the daily rollups, and `calculation_view=recalculated&method_id=<its
method>` still answers that method. The server-owned job only adds rows of another method, which
these requests never read.

Can 0.1.0 browsers get the one-method totals? No. 0.1.0 asks the organization in the original view
and refuses any answer not labelled original (`coordinator.ts:4696-4701`,
`server-summary.ts:904-907`). Sending recalculated figures under the label original would be a
false label, and "Your share" would then compare the member's own figures in the 0.1.0 method with
a total in another method. So 0.1.0 browsers see what they see today: one total while all rows add,
otherwise "Not available" for that figure, until Chrome updates them.

## 3. While a recalculation runs

Only a server deploy opens a window: the one that brings this change, and each later one with a
new default method. The window starts at the deploy, so it has usually passed before anyone
asks. Arriving records open none, because they are calculated in the upload.

- Server: 409 `recalculation_pending` for the current view. It never answers with part of the
  records or with rows of two methods.
- Extension: for a `current` request, a 409 `recalculation_pending` falls back to this browser's
  last saved copy of the same summary (`ledger.serverSnapshot`, same query, scope and deletion
  epoch). The copy is complete and in one method, the previous default, and the pages already
  mark such a copy with its age ("Organization figures not refreshed ... Showing organization
  figures from ..."). Without a saved copy the page behaves as on a 409 today. Today
  `recalculation_pending` is rethrown without the saved copy (`server-summary.ts:951-965`); that
  stays so for every other request.
- Admin website: keeps the figures it already shows and otherwise shows its existing load error.

Alternative not chosen: keep answering with the previous default method until the new job is
done. It needs two server-owned jobs kept complete during the change and a rule for which one
answers. The window is about two minutes on production data, so this is not worth it now.

## 4. Browser newer than the server, and unknown models

- **Server from before this change** (older self-hosted server): it answers 422
  `unsupported_filter` to `current`. The extension then sends exactly today's requests
  (organization: original; own: recalculated with the browser's method) and remembers the refusal
  for that server address for the life of the service worker, as it does for `splits=none`
  (`server-summary.ts:793`, `925-942`). A very old server that ignores the unknown view and
  answers the original view (labelled `original`, or unlabelled with `aggregate_status`
  `current`) is treated the same way; that answer is never shown (chief, 23 November 2026).
- **Server knows `current`, but a browser already runs a newer method** (extension updated before
  the server): the server cannot calculate that browser's live originals (`method_unsupported`)
  and so cannot recalculate them. With the rule of section 1 these records do not block the
  organization: they are counted as requests with a pending estimate (`pending_estimates`,
  coverage counts), exactly as the original view counts them today, and add no electricity,
  carbon or water. Saved messages of that browser are recalculated normally, because they carry
  the original method's hash. When the server is updated, its worker resolves the originals
  (`recover_original`), the job calculates the records and the totals include them. The total is
  one method at every moment.
  Records that fail for another reason (`engine_unavailable`, `estimation_input_unavailable`)
  keep the job pending, as today. These are a server fault or a short-lived state.
- **Model unknown to the server's data**: the server refuses a model id it does not list at
  upload, as today (`invalid_observation`), so such a reply never reaches the totals of any view.
  For a listed model without an EcoLogits record, and for a reply that names no model, the
  recalculation returns a valid estimate, with a stand-in or without a value and with its reason,
  as the browser does for a model its own data lacks. The record adds
  to requests and tokens and is counted as unknown for electricity, carbon and water. Nothing is
  blocked. A model that only the newer browser data knows shows a figure in that browser's bar
  and none in the organization total until the server has that data.

## 5. How the extension verifies what it shows

Today a recalculated answer must match a method the browser holds: a packaged engine method, or a
signed bundle (`coordinator.ts:4292-4324`, `method-service.ts:552-561`). EcoLogits methods have no
signed delivery (`method_registry.py:63-79` lists only signed bundles), so a default method the
browser never saw cannot pass that check and must not go through `methodSelection`.

Rules for an answer to a `current` request:

1. `calculation_view` is `recalculated`, with a well-formed `method_id`, `method_hash` and
   `recalculation_job_id` (the existing `validatedTotals` checks), unless `aggregate_status` is
   not `current`.
2. Every resource row of the summary, of every day, tool and model split, and every row of
   `history.resources` names exactly the answer's `method_id` and `method_hash`. One other row
   fails the whole answer with `method_update_invalid`. This is the check `serverSummary` already
   makes against the asked method (`server-summary.ts:890-903`), made against the answer's own
   method and extended to splits and saved history.
3. When the browser packages a method with that id, the hash must equal the packaged hash.
   Otherwise `method_update_invalid`.
4. When the browser does not know the method, the answer is accepted. The identity the pages need
   comes from each row's `requested_method` and `effective_method`, which `validatedV2Resource`
   already checks for shape and consistency. `comparableTotal` adds the rows because they are one
   method family, and places that name a method read the name from that identity.

What this guarantees: the browser never shows a mix, never shows figures under another method's
name, and detects a server that contradicts the browser's own copy of a method. It cannot check
other members' figures themselves; it trusts its organization server for those, as today.

A cross-check against `GET /v1/methods` is left out on purpose: the extension does not read that
endpoint today, and it would compare the server with itself.

## 6. Exact Claude input and file figures

Unchanged. Exact input (`historical_exact_inputs`) is added to the token rows by
`HistoricalUsage.summary` in both views (`historical_usage.py:1115-1170`); it depends on no
method. File text figures come from the stored messages (`message_parts`), also in both views.
The current view is the existing recalculated view, which a member's own summary already uses
today, so requests, tokens, exact input and file figures are produced by code that is in
production now. Only the method of the resource rows is new for the organization.

## 7. Cost

**Summary requests.** The limit is 150 database statements per summary request
(`tests/test_summary_performance.py:27`). Only the original administrator summary is guarded
today (70 statements on a copy of production). A recalculated organization summary with splits
ran the original pass and then read its records once per part (`Analytics.selected`, for each of
up to 62 days, 5 tools and each model). Measured in S2 on 23 November 2026 on the test
organization: 301 statements for each of the three organization requests in the current view
(administrator summary, Activity, a member's organization view) and 72 for a member's own. So the
parts now share one read of the period's records with their estimates
(`Analytics.period_records`), the way they already share the rollups (`_period_read`) and the
saved messages (`PeriodRows`), and the server's job is read once a request. A period of more than
10,000 records is not kept; its parts read their own, as before. That left 221 statements, most
of them reads for one linked saved reply at a time (78 of saved messages, 80 of deletion
tombstones), so a recalculated read now fetches what its attempts' linked replies need together
(`history_matching.prefetch_linked`), as the saved-history part already does (`prefetch`). The performance test holds every
request in the current view under the limit and compares each answer with the unshared path. No
estimate is calculated in a read. The readiness check costs two statements a request, as for a
member's own summary today.

**Uploads.** A batch holds at most 100 records (`dto.py:254`). The hook adds, per new attempt or
saved reply, one calculation (the upload already makes one for the original) and one insert, plus
two queries limited to the uploading member. Budget 100 per upload; anything beyond that is left
to the worker. S1 asserts a statement bound per uploaded reply.

**One-time recalculation.** The worker ticks every 5 seconds (`maintenance.py:504-506`) and
handles 100 records of the server-owned job per tick. Production holds about 2,300 estimates; the
records of browsers on the default method already have their rows. So at most about 23 ticks:
two to three minutes, once per data update. The tick holds the organization lock only for its 100
records, so uploads are not held up noticeably. Larger organizations scale linearly, about 1,200
records a minute. The rehearsal on vps_sujit measures the real duration.

**Worker load afterwards.** One readiness check per organization and tick (two queries), no
calculation, as for every existing job.

**Storage.** One more estimate row per record whose browser runs another method than the default,
and one more per data update. Old rows are kept (originals and earlier methods are never
overwritten).

**Migration and rollback.** No migration; the production schema stays 0016. Rollback is a
redeploy of the previous image without `alembic downgrade`. The rows the new code wrote are valid
for the old code: the server-owned job looks like an organization job an administrator started,
and the old worker advances it harmlessly.

## 8. Documents that change

No interface text is added.

- `docs/implementation/CONTRACTS.md`: section 4.3 (line 334), the summary fields (line 461) and
  the extension contract (line 754, "Server summaries must match the installed selected hash"):
  add the current view, its readiness rule and the verification rules of section 5.
- `docs/implementation/MODULAR-EXTENSION-ECOLOGITS-PLAN.md` line 365: "Company totals remain
  canonical ... unless an authorized existing admin operation requests a company recalculation"
  is replaced by the server-kept current view, with the owner decision of 23 November 2026.
- `docs/implementation/METHODOLOGY-AND-MULTIMODAL-SPEC.md` line 95: organization totals use the
  server's newest method; originals stay stored.
- `IMPLEMENTATION-PLAN.md`: a dated amendment line. `docs/release/MODULAR-REFINEMENT-STATUS.md`
  and `CHANGELOG.md`: the change.
- `apps/server/API-INTEGRATION.md` (lines 34, 46, 137) and `docs/operations/SELF-HOSTING.md`:
  the `current` value, the server-owned job, the window after a data update.
- `apps/extension/lib/estimation/README.md`: which requests use the current view.
- Methodology text: `docs/methodology/content.html`, next to the paragraph on arithmetic totals
  (line 209). It must say that organization totals are calculated by the organization's server
  with its newest EcoLogits data, that a past period can therefore change after a data update,
  and that the bar and Details show the browser's own calculation. Recipe: edit `content.html`,
  rebuild with `tools/build-methodology.cjs`, update the prefix literals in
  `design-canvas/test.cjs`.

## 9. Tests

Each fails without the change. Server tests go into a new `apps/server/tests/test_current_method.py`
unless a file is named.

1. **Two browsers, one total.** Two members upload live replies and saved messages, one with an
   archived method and one with the packaged method. After one worker run the four endpoints
   answer `current` with every row in the default method and electricity equal to the sum of both
   members. The same requests in the original view still show two method groups.
2. **Old browser after the recalculation.** After the job completed, the member with the archived
   method uploads one more reply and one saved-history page. Without any worker run, the next
   `current` summary answers 200 and includes them.
3. **Default-method change.** With another packaged definition, the first `current` request
   answers 409 `recalculation_pending`; no answer at any point holds rows of two methods; after
   the worker runs, the answer is 200 in the new method. The originals and the earlier method's
   estimates are still stored, and the original view is unchanged.
4. **Correction.** A new revision of an attempt is in the `current` total at once; the old
   revision's estimate is still stored and not counted.
5. **Erasure.** During the deletion `current` answers `aggregate_status: "rebuilding"`; after it
   and one worker tick it answers 200; the erased records' estimates are gone.
6. **0.1.0 unchanged.** In a mixed organization, the exact 0.1.0 requests
   (`/v1/company/summary` with `calculation_view=original`, `/v1/me/summary` with
   `calculation_view=recalculated&method_id=<0.1.0 method>`) give the same bodies, apart from
   `snapshot_id` and `generated_at`, before and after the server-owned job ran.
   `test_summary_parity.py`, `test_summary_splits.py` and `test_method_history.py` pass unmodified,
   and so do `legacy-server-compatibility.test.ts` and `server-summary-v2.test.ts` cases for the
   original and explicit recalculated requests.
7. **Unknown method.** A reply whose method the server does not know does not block the total and
   is counted as pending; after that method is installed the next worker run calculates it.
8. **No model.** A reply that names no model gets its estimate and does not hold the job back.
   (A model id the server does not list is refused at upload, in every view.)
9. **Requests the server refuses.** `current` with `method_id`, and `current` on a conversation,
   saved-chat or record endpoint, answer 422 `unsupported_filter`. A member's own `current`
   summary is ready when that member's records are done, also while another member's are not.
10. **Exact input.** A Claude reply with an exact input count gives the same token rows in the
    current view as in the original view.
11. **Cost** (`test_summary_performance.py`): the organization, own, administrator and activity
    summaries in the current view stay under 150 statements and calculate nothing; one uploaded
    reply stays under a fixed statement bound; worker ticks repeat no work once the job is done.

Extension (org-client):

12. The default organization and own requests send `calculation_view=current` and no `method_id`.
13. An answer in a method the browser never saw is shown as one total; an answer with one row of
    another method, or with a packaged id and another hash, fails with `method_update_invalid`.
14. A 422 `unsupported_filter` makes the extension send today's two requests, and the next summary
    for that server does not try `current` again.
15. A 409 `recalculation_pending` shows the saved copy marked as a saved copy; without a copy the
    error is the one of today.
16. The own summary in the current view contains no local part: local records calculated with the
    browser's method neither add to it nor blank it.
17. Device side: see section 11.

Website (org-client):

18. The admin pages request `calculation_view=current`; a one-method answer shows no partial note
    and no release note.

## 10. Work packages, in landing order

| # | Session | Package | Done when |
|---|---|---|---|
| S1 | org-server | The server keeps the figures: `keep_current`, the worker calls it first for every organization, the upload hooks in `Analytics.ingest` and `HistoricalUsage.ingest`, the unresolvable-original rule in `missing`. | Tests 2, 4, 5 (estimate part), 7, 8 and the upload and worker bounds of 11. |
| S2 | org-server | The current view: the rewrite in `route`, the rebuilding answer, the read cost guard and, only if the measurement needs it, the shared period read. | Tests 1, 3, 5, 6, 9, 10 and the summary bounds of 11. |
| E1 | org-client | Extension asks for the current view (contract below). | Tests 12 to 16. |
| E2 | org-client | Device-side test of section 11. No product code expected. | Test 17. |
| W1 | org-client | Admin website asks for the current view. | Test 18. |
| D1 | org-client | Documents of section 8 with the methodology rebuild. | Review-anchor test passes. |

S1 can deploy alone: it only adds rows. E1 and W1 need S2 on the server. The server with S1 and
S2 works with 0.1.0 and with the packaged 0.1.1.

### Contract for org-client

Extension, in `Coordinator.selectedServerSummary` and `serverSummary`:

- **When.** In an organization, for the organization summary and for the own summary, whenever
  the page asked no explicit view (today's `calculationView: "selected"`). Explicit views from a
  caller (the monthly summary, a chosen method) stay as they are. The bar, Details, conversation
  and saved-chat summaries are not touched.
- **Request.** `calculation_view=current`, no `method_id`. `summaryQuery` must accept it. The
  cache key needs no method hash; the query string already separates it.
- **Success.** 200 as in section 2. Apply the rules of section 5. Return
  `calculation: { view: "recalculated", methodId, methodHash }` from the answer.
- **Own summary.** `history` is `serverHistoryView(result.history)`, as for the organization. Do
  not call `HistoryService.view` for it: that view scans local records in the browser's method
  and drops server rows of any other method (`history-service.ts:2462-2473`). The pages already
  read only the server part (`orgFigures`, `OrgOverview.tsx:51-53`, `Popup.tsx:970`). Records not
  uploaded yet are not in the own figure, as today ("Your share appears once your records have
  synced").
- **`aggregate_status` not `current`.** Accept the answer without method fields and show the
  existing state.
- **409 `recalculation_pending`.** Use the saved copy of the same request when there is one
  (`snapshot_source: "cached"`); otherwise throw as today.
- **422 `unsupported_filter`.** Remember the server address for the life of the service worker
  and run today's code path unchanged: organization with `calculation_view=original`, own with
  `maintainOrganization`, `engines.admission()` and `calculation_view=recalculated&method_id=`.
  A server that knows `current` also knows `splits=none`, so this 422 always means `current`.
- **Other errors.** As today.
- `maintainOrganization` (the device's own job on the server) is still needed for the bar and
  Details side and stays; it is not a precondition of a `current` request.

Website, in `apps/web/src/admin/*`:

- `/v1/admin/summary` and `/v1/admin/activity` requests add `calculation_view=current`. Website
  and server are deployed together, server first, so no fallback is needed. On 409 the page keeps
  what it shows.
- The partial note and the release note (`AdminOverview.tsx:338-355`) stay in the code and stop
  appearing, because a current answer is one method.
- Export form (`admin-pages.tsx:1900-1950`): the server needs no change. The existing choice
  "Completed recalculation" with the default method now always works, because the server-owned
  job is an organization job. Proposal: the form starts on that choice with the default method
  preselected (it already loads `/v1/methods`); "Original recorded calculations" stays available.
  No text changes. The chief decides whether a changed preselection is within "no interface
  change".
- The request list with person analytics shows each request's own recorded estimate and names
  its method. It stays as it is, like Details.

## 11. The device side

Where: `EngineService.runLocal` (`apps/extension/lib/estimation/service.ts:535-641`).

- **After an update that changes the packaged method.** The selected method is the packaged
  method of the build (`selected`, lines 137-189). For every data scope with saved inputs whose
  last completed local job targeted another method hash (lines 553-562), `ensureJob` starts a job
  for the new method (lines 467-499). The job reads its inputs in pages of 32, calculates each
  with the new method, keeps the original's hash as lineage and never rewrites the original
  (lines 569-617). When all inputs of its snapshot are processed it is promoted and the pages are
  told (lines 618-627). Until then the view stays on the last completed results
  (`localViewState`, `view-state.ts:33-80`).
- **Whole chats.** The job works on the scope's saved estimation inputs, live replies and saved
  messages alike (`observation`, lines 58-70), not on the chat that is open.
- **Without the user.** `maintainLocal` runs when the service worker starts
  (`coordinator.ts:534`, `592`), after captures and on the ordinary alarms; work is bounded to 250
  ms and four batches a pass and resumes from a saved cursor (lines 507-514, 542-543).
- **Method unchanged.** No scope is pending, so the pass returns before any calculation
  (line 563). Test "repeated maintenance reuses completed selection and CAS rejects a late
  preference" (`apps/extension/test/engine-service.test.ts:310`) asserts one calculation across
  two passes.
- **Closed during several updates.** On the next start the browser compares its last completed
  target with the method packaged now and runs one job, from whatever it had to the newest. It
  needs no code of the versions in between, because the job needs only the saved numbers and the
  original's hash. An input without an original hash is marked unavailable (lines 572-583), as
  today.

The gap: the existing tests change the method through the preference (Original to EcoLogits,
`engine-service.test.ts:200`, `58`). I found no test in which the packaged EcoLogits method itself
changes between two builds while the preference stays the same, which is the case of every data
update. Test to add (E2), in `apps/extension/test/engine-service.test.ts`: "a build with new
EcoLogits data recalculates every saved input once". It seeds live and saved inputs of two chats
under one EcoLogits method, reopens the same database with a build whose packaged EcoLogits method
has another hash, runs maintenance and asserts: every input has a result in the new method, the
originals are byte for byte the same, the view names the new method, a second pass calculates
nothing, and a reopen with the same build calculates nothing. If this test fails, the fix belongs
to that package and comes back to the chief first.

## Open points for the chief

1. Export form preselection (section 10).
2. The second "Claude Opus 5.5" row under Top models is probably not caused by the two methods.
   The model split is keyed by the recorded model id in both views (`analytics.py:1520-1531`), so
   two recorded ids with one display name stay two rows in the current view. org-client should
   read the two ids from the live answer before anyone promises that the row disappears.
3. The durations of section 7 are estimates from the code's bounds. The summary statement count in
   the current view and the one-time recalculation are measured in S2 and in the rehearsal.
