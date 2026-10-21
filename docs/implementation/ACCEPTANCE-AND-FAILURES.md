# Acceptance tests, failure handling and release gates

Reconciled: 9 September 2026; observation schema target `1.1.0`. These are **tests to implement and execute**, not reported passing results. Read alongside the [phase plan](../../IMPLEMENTATION-PLAN.md), [contracts](CONTRACTS.md) and [product/enrollment specification](PRODUCT-AND-ENROLLMENT-SPEC.md). Design-review/registry formats have independent versions.

## 1. Verification rules

- Every test records fixture/version, command, environment, expected result and actual result. Store machine-readable results and sanitized evidence in CI artifacts.
- Never use the production implementation itself as the only expected-value oracle. Use hand-counted synthetic lifecycle fixtures, official tokenizer reference outputs, independent numerical golden calculations, database invariants and browser-visible behavior.
- Unit/CI tests are deterministic and make no live provider requests. Live compatibility checks are a separate synthetic-account suite with permission and any development budget explicitly configured.
- Run adapter cases independently for all four sites in Chrome, Edge and Firefox; passing Claude does not prove Gemini, and passing Chrome does not prove another browser. Run security checks against API routes, not only hidden UI controls.
- An expected “unavailable” result is a pass only if the unknown state, reason, downstream aggregate treatment and user/admin visibility are correct. Returning zero is not a substitute.
- A failure that causes silent loss, misattribution, double counting, false precision, content leakage or unauthorized IP disclosure blocks release. Cosmetic defects can be prioritized separately if they do not hide an error or impair access.

## 2. Requirement traceability

| Requirement | Phase owners | Minimum verification groups |
| --- | --- | --- |
| R01: four consumer websites in three browsers | P0, P1, P5, P11 | A01-A12 per browser/site; B01-B08; twelve-combination live release matrix |
| R02: conversation metrics | P3, P5, P6, P8 | T01-T12, E01-E12, U01-U04 |
| R03: exactly two tabs | P8 | U05, U06, U10 |
| R04: cross-tool personal periods | P7, P8 | G01-G12, Y10-Y12, U05-U07 |
| R05: company/admin separation | P4, P7, P9 | S01-S08, G09, U10 |
| R06: deployment-specific usage retention | P2, P9, P11 | L11, D01-D08, PE17-PE20 (N08 removed on 18 October 2026) |
| R07: verified-email identity across browsers/machines | P4 | I01-I12, Y11, B05-B06, PE07-PE10 |
| R08: enrolled-profile scope/pause policy | P4, P8, P9 | I01, U11, S06 |
| R09: 500-user self-hosted scale | P10, P11 | P01-P08, deployment drill |
| R10: thinking/search/image/file input, image generation/editing and gaps | P1, P3, P5, P6 | A06-A10, T07-T10, E07-E09, FM01-FM12, IM01-IM20 |
| R11: operational resource boundary | P6 | E01-E12 |
| R12: no prompt/answer/document content uploaded | P0, P2, P5, P10 | S03-S05, L08, A12 |
| R13: admin-only network IP (superseded on 18 October 2026, no IP collection) | P9 | S01-S04, D04 (N01-N10 removed) |
| R14: MIT original code and compliant open-source reuse | P0, P11 | O01-O06; license/build/store release gates |
| R15: host appearance and integration | P8 | U01-U04, U08-U09 |
| R16: 50% warning with official-limit priority/labeled fallback | P0, P3, P8 | C01-C06 |
| R17: optional educational footprint guidance | P8 | C07-C08, H04 |
| R18: informational-only, no AI-tool interference | P5, P8, P10 | H01-H06 in all twelve browser/site combinations |
| R19: sourced formulas/highest-comparable estimates | P0, P3, P6-P8, P10 | FM01-FM12, IM01-IM20, Q01-Q14, MU01-MU06 |
| R20: personal local-only/no backfill | P2, P4, P8 | PE01-PE02, PE10-PE11, BV12, U05-U07 |
| R21: public website/hosted registration/one hosted address (13 October 2026) | P0, P4, P8, P11 | PE03-PE06, PE23-PE24, BV01-BV11 |
| R22: OTP-only administrator login and extension email-code connection | P4, P8 | I01-I12, PE07-PE10, PE12-PE14, AR07, BV09-BV13 |
| R23: two roles/multiple admins/separate admin entry | P4, P9 | AR01-AR08, S01-S02, S07, U10, PE14-PE15 |
| R24: hosted plans/operator exceptions/full self-hostable source | P0, P9, P11 | PE15-PE24, O01-O06 |

## 3. Capture and adapters — A01-A12

Run every applicable case for ChatGPT, Claude, Gemini and Perplexity in each of Chrome, Edge and Firefox, with capability status for modes unavailable to the test account or browser. `Not observed` is not `verified`. Reused fixtures require verified protocol parity; browser-specific injection and lifecycle tests cannot be replaced by replaying a Chrome fixture.

| ID | Fixture / action | Required result |
| --- | --- | --- |
| A01 | New text chat; one actual send; known terminal stream | Exactly one request/attempt, correct conversation association and observed terminal state; draft preview excluded |
| A02 | Second turn with prior history; reload twice; reopen old chat | Only new dispatch adds consumption; repeated processed context distinguished from unique conversation text; history does not add events |
| A03 | Regenerate, edit-and-send, then switch branches | Each actual user action counted once; all recorded branches retained in conversation usage; branch display changes do not subtract past work |
| A04 | Stop mid-stream; reject before generation; then browser crash | Cancelled, failed and interrupted states remain distinct; rejected dispatch counts as one user request but zero confirmed executions plus one unconfirmed transport attempt; no fake zero-energy assumption |
| A05 | Split UTF-8 bytes, split SSE/JSON frames, repeated frames, reordered completion evidence | Incremental decoder/parser preserves content; replay dedup correct; malformed framing yields a diagnostic without affecting website response |
| A06 | Visible thinking summary plus optional reported reasoning | Separate fields/scopes; no inference of hidden reasoning from summary; no double addition to inclusive output total |
| A07 | Web search with multiple sources and observed tool calls | User request, generation and search-operation counts separate; citations are not search-call counts; unobserved retrieval work marked |
| A08 | Plain text PDF and office document upload | No file contents/names persisted or uploaded to company; observed extracted-text count distinguished from provider processing |
| A09 | Scanned PDF, oversized document, image/audio/video | Unsupported components explicitly unknown; remaining text still captured safely; no invented OCR/multimodal token equivalent |
| A10 | Model auto routing, label changes and missing model field | Actual evidence source preserved; unknown IDs remain unknown; requested model does not silently become asserted executed model |
| A11 | Protocol/endpoint changes; bridge absent; composer moves | Independent UI signal exposes degraded capture/placement; no green status from parser inactivity; no production debugger permission |
| A12 | Concurrent tabs/streams and hostile page messages | No cross-chat attribution; credential access rejected; size/rate limits enforced; native send/cancel semantics unaffected |

For A11, manually suppress the hook while allowing the site to generate. Verify the visible fallback diagnostic. This test addresses the important class of “parser never saw anything, so no exception was thrown.” It cannot prove detection of every possible future site change; publish that limitation.

## 4. Local ledger — L01-L12

| ID | Fault or scenario | Required result |
| --- | --- | --- |
| L01 | Crash between ledger write and outbox mutation | Transaction commits both or neither; no acknowledged orphan record |
| L02 | Kill MV3 worker after local commit but before UI notification | Restart loads same record/revision/outbox; no new request ID |
| L03 | Deliver the same adapter event repeatedly | Idempotent local update; request/attempt totals unchanged |
| L04 | Send identical prompt text twice deliberately | Two actual dispatches remain two requests; no content-hash deduplication |
| L05 | Final tokenizer count is lower than provisional count | New revision replaces measurement and adjusts local subtotal downward once |
| L06 | IndexedDB quota/write failure | Bar/badge immediately says recording failed; no “saved” acknowledgement; bounded in-memory recovery is explicitly at risk |
| L07 | Migration fails or old schema is unsupported | Preserve database; show blocked state and export/recovery instructions; never auto-clear |
| L08 | Synthetic secret marker in prompt, answer, filename and thinking | Marker absent from IDB, browser local storage, health logs, outbox and diagnostics export |
| L09 | Browser restarts with unfinished generation | Recover as interrupted/unconfirmed; preserved numerical checkpoint is partial, not final full text |
| L10 | Orphan parent, bad revision order or corrupted quantity injected | Integrity scan identifies affected records; quarantine/repair visible; unrelated records remain usable |
| L11 | Advance time under personal, self-hosted and hosted policies | Personal remains local until user deletion/storage loss; self-hosted usage remains until admin deletion by default; hosted organization records/queues/totals are kept until admin deletion by default (owner decision of 11 October 2026) or obey the disclosed shorter period or plan maximum, independently of mail retention |
| L12 | Attempt to switch company with queued records | Explicit disconnect/enroll flow; old records remain scoped to old enrollment and never uploaded to new company |

## 5. Tokenizers and count semantics — T01-T12

| ID | Oracle / scenario | Required result |
| --- | --- | --- |
| T01 | Official tiktoken reference corpus for pinned mappings | 100% token-count parity for supported text/special-token policy; exact asset hash recorded |
| T02 | Official Google LocalTokenizer reference for mapped model/assets | 100% parity including normalization, Unicode and special-token policy; no guessed generic Gemini mapping |
| T03 | Corrupt asset bytes or change model-to-encoding mapping | Hash/version validation fails; old valid applicable profile or explicit unavailable state; no silent fallback |
| T04 | Unknown/new model identifier | Registry fails closed for exactness; declared approximate alternative clearly labeled or unavailable |
| T05 | Claude synthetic calibration/holdout; API auth/rate/model failure | Maintainer-only counting key; published bias/median/P95 by model/language/content; incomplete run cannot promote profile; no universal 30% correction or generated-output exactness inferred from input counting |
| T06 | Same Claude corpus across tokenizer generations | Separate profiles/results; historical package not labeled accurate for modern models |
| T07 | Raw Markdown versus rendered DOM; chunks split mid-token | Completed raw-text count matches full reference; DOM fallback has separate scope/evidence; chunk counts not naively summed |
| T08 | Inclusive output total with reasoning subset | Total unchanged when reasoning detail added; no double-count |
| T09 | Cache read/write/uncached fields with varying semantics | Partition rules applied only for the validated schema; otherwise categories not combined into an invented input total |
| T10 | Documents/tool context not fully exposed | Visible text count remains scoped; unknown context/tool parts do not become zero or exact logical input |
| T11 | Offscreen worker timeout, termination, stale job response | Request/attempt remains recorded; correct revision receives result; stale response ignored explicitly; processing error visible |
| T12 | Empty text, tiny strings, huge values, languages with poor proxy performance | Known empty text may be zero; invalid/overflow rejected; approximation errors reported by group; no divide-by-zero or unsupported exact badge |

For proxy validation, publish sample sizes and absolute errors for tiny examples where relative error is misleading. No API calibration sends employee content; only approved synthetic/public fixtures. Generation-based experiments require explicit development credentials/budget and are not part of employee installation.

## 6. Identity and authorization — I01-I12; S01-S08

Apply the later [BR01-BR03, AR01-AR08 and DS01-DS02 checks](BRAND-ROLES-AND-DESIGN-HANDOFF.md#5-additional-acceptance-checks-planned) for Fern branding, multiple equal organization admins, OTP-only role-based login and pre-implementation design review. The organization role `user` replaces older “member” terminology. These additional checks are planned, not executed.

Brevo is selected for organization OTP delivery. Apply [BV01-BV15 release checks](BREVO-PRIVACY-SETUP.md#8-required-release-checks). I01-I12 below now use verified work-email identity and installation-bound connection, not invitation-only accounts or recovery phrases. Since 13 October 2026 (owner decision) the work email is verified with an email code inside the extension; there is no web approval of a browser connection. Personal mode remains local-only. These checks are specified, not executed.

| ID | Scenario | Required result |
| --- | --- | --- |
| I01 | Verify work email with an email code in the extension and confirm a new browser connection | Stable tenant/user and new installation created; organization selected by the email domain; email restricted to auth mapping, no AI-account identity or chat content; profile-wide disclosure and acknowledged policy version recorded |
| I02 | Concurrent same-email first login; lose committed connection exchange response | One membership and one installation per exchange; same verifier/exchange retrieves same result, different proof/exchange denied; no duplicate identity |
| I03 | Expired connection, wrong origin or superseded policy | Enrollment blocked with safe correction path; no credential sent to another origin; current policy acknowledged before activation |
| I04 | Same email on second browser; lose completion response | Same user/new installation and independent keys; idempotent retry restores same credentials; server totals combine once |
| I05 | Create or claim a connection without a correct email code | No usage/account access; public connection ID alone insufficient; five code attempts, expiry, single use, verifier and abuse limits enforced; no organization revealed before the code is verified |
| I06 | Wrong verifier, wrong tenant or consumed/denied connection | Exchange fails without altering membership/healthy installations; secrets absent from URLs/page messages |
| I07 | Lose all installations then verify same email again | Same membership retrieved; new installation through normal connection; no recovery phrase or mandatory existing device; other devices revoked only by explicit action |
| I08 | Two users share one IP; one user changes IP | No automatic user merge/split; identities independent of network |
| I09 | Refresh response lost after rotation; retry same operation | Cached idempotent rotation recovers; different-operation token reuse triggers family revocation |
| I10 | Concurrent worker refresh attempts | Single-flight behavior; no accidental credential loss; restarted worker can recover pending operation |
| I11 | Revoke device, then upload with old access/refresh credentials | Authorization denied; visible client state; existing historical usage remains unless separately deleted |
| I12 | Reinstall; reverify same email; then attempt an old deleted-identity retry | Reinstall joins same active user; deleted identity/credentials cannot be resurrected; deliberate fresh membership never restores erased usage |

| ID | Security probe | Required result |
| --- | --- | --- |
| S01 | Member calls all admin paths and guesses another user's IDs | Server denies; no data in errors, caches or exports |
| S02 | User attempts admin mutations; admin promotes/demotes users; cross-tenant and last-admin probes | Ordinary user denied; same-tenant admin role changes authorized and audited; last-admin and concurrency safeguards hold; see AR01-AR06 |
| S03 | Prompts/answers/secrets injected as marker strings in all capture paths | Absent from outbound company traffic, DB, logs, traces, crash reports and exports; employee build never invokes external counting/generation APIs or includes calibration credentials |
| S04 | Access raw IP via member API, company JSON, admin API, dashboard cache or error path | No exposure anywhere; since 18 October 2026 no IP address is collected or shown, including to administrators, and audit holds no plaintext IP |
| S05 | Host page spoofs bridge events, injects HTML/JS or requests secrets | Strict validation, text-only rendering and privileged message allowlist prevent escalation; remaining analytics-spoofing limitation disclosed |
| S06 | Tamper with enrollment origin, company ID, policy, method signature or redirect | No reassignment/exfiltration; failure visible; pausing policy cannot be silently widened by page messages |
| S07 | Admin CSRF, session fixation, OTP brute force/replay, expired session and role revocation | Vetted email-OTP-only login, session/CSRF/rate/expiry and current-role checks; no added password/MFA requirement; no secret-bearing logs |
| S08 | CSV formula injection, unauthorized download, expired export link | Safe export encoding and authorization; short-lived access enforced; deleted-data exports invalidated |

## 7. Resource math and scientific honesty — E01-E12

Use the following deliberately synthetic golden case; it is an arithmetic fixture, **not a real AI footprint coefficient**:

`E_IT = 0.001 kWh`, `PUE = 1.2`, `C = 400 g/kWh`, `WUE_IT = 0.5 L/kWh`, electricity-water factor `= 1 L/kWh`.

Expected facility energy `0.0012 kWh`; electricity-related carbon `0.48 g`; direct water `0.0005 L`; upstream water `0.0012 L`; combined water `0.0017 L`.

| ID | Scenario | Required result |
| --- | --- | --- |
| E01 | Synthetic golden case above in TS and Python | Identical unrounded base-unit outputs within the documented decimal precision contract |
| E02 | Input energy already facility-inclusive | PUE not applied again; IT water unavailable unless compatible IT denominator can be derived |
| E03 | WUE IT denominator versus facility denominator | Correct equation selected; incompatible/missing denominator rejected visibly |
| E04 | Missing PUE, grid factor or water factor | Affected metric/subtotal unavailable or explicitly partial; no generic hidden constant |
| E05 | Location-based versus market-based factor; user changes IP | Method boundaries remain distinct; IP change never changes inference-region scenario |
| E06 | EcoLogits result with embodied and operational outputs | Only compatible operational portion enters headline; training/hardware not silently included |
| E07 | Reasoning/cache/tool subsets overlap | No duplicate workload addition; hidden reasoning is not zero; pricing cache discounts do not become energy discounts |
| E08 | Long-input/short-output workload outside output-only profile domain | Unsupported/rough/partial label; not a confident ordinary-prompt estimate |
| E09 | Search, OCR or document image work not observed | Missing components visible in request and aggregate; known model subtotal not labeled complete footprint |
| E10 | Candidate promotion with and without suitable public held-out measurements | Available evaluation publishes error/bias/domain limits; missing evidence blocks calibrated claims/promotion, not a qualified rough baseline passing functional/arithmetic/scope gates; no paid experiment silently launched |
| E11 | Aggregate records with shared scenario uncertainty and incompatible boundaries | Compatible scenario totals only; no fake 95% interval or sqrt-N confidence gain; incompatible metrics separated |
| E12 | Correct observation revision; new method; corrupt signature and decimal extremes | Immutable estimate lineage per observation revision/method/view; canonical pointer selects one contribution; recalculated view explicit; invalid update/overflow rejected |

All published validation must distinguish open-model benchmark fit from the unknown serving arrangements of closed consumer products. “All tests passed” is not evidence of physical footprint accuracy for a provider that has not exposed the required telemetry.

## 8. Synchronization — Y01-Y14

| ID | Injected fault / scenario | Required result |
| --- | --- | --- |
| Y01 | Retry same ID/revision/hash 100 times | One canonical contribution; duplicate ACKs consistent |
| Y02 | Same ID/revision, changed numeric payload | Explicit conflict/quarantine; no silent overwrite/new ID |
| Y03 | Deliver revision 3 before revision 2 | Newer result retained; stale ACK reconciles client |
| Y04 | Server commits then response is lost | Retry yields duplicate; no extra usage |
| Y05 | Kill DB connection before commit | No success ACK; transaction rolls back; retry safely applies once |
| Y06 | Mixed valid/invalid records and missing ACK entries | Only acknowledged records leave outbox; independent records progress; rejects remain visible |
| Y07 | 401, 403, 429, 413, 5xx and timeout sequence | Specified refresh/split/backoff/revocation behavior; no data dropped or busy-loop |
| Y08 | Unknown method bundle with valid token observation | Observation durable, calculation pending visible; later approved method resolves same record without duplicate counts |
| Y09 | Suspend MV3 worker during backoff; restart next day | Persisted next retry/outbox restored; activity/alarm resumes; no reliance on old timer |
| Y10 | Server snapshot already includes some local records | My usage uses server snapshot with separate pending subset; never adds whole local and server totals |
| Y11 | Duplicate parent IDs already counted; shared attempt key; mirrored chat; genuinely distinct dispatches | Verified duplicate parent aliases reverse all duplicate contributions; truly distinct actions retain two request counts with one shared attempt contribution; unresolved identity visibly quarantined; history adds none |
| Y12 | Go offline after viewing paired/company snapshot | Current-profile local totals and dated remote snapshot separately labeled; no falsely current company data |
| Y13 | Child attempt arrives before parent; batches exceed size | Dependency retried after parent; batching limit enforced; no truncation |
| Y14 | Queue contains deleted-range records and old policy/deletion epoch | Tombstones fetched/applied; server prevents resurrection; explicit erased ACK cleans eligible local metadata |

## 9. Aggregation and time — G01-G12

| ID | Dataset / scenario | Required result |
| --- | --- | --- |
| G01 | Hand-constructed requests with internal retries, cancellation and failure | User-request, attempt, search and outcome counts reconcile independently |
| G02 | Progress revisions and corrected final count | Only canonical current contribution counted; old bucket delta removed exactly once |
| G03 | Empty period versus unknown-resource requests | “No recorded requests” distinct from unavailable resources; unknown-only resource sum null, not zero |
| G04 | One user active every day; two devices and changing IPs | Distinct active user count is one; device/IP counts separate; no sum of daily distincts |
| G05 | Europe/Berlin DST start/end and month boundary | Correct 23/25-hour calendar days and half-open ranges; no duplicates/gaps |
| G06 | Offline request uploaded next month; stream spans midnight | Request/attempt start-time buckets follow contract (the network observation by upload month was removed on 18 October 2026) |
| G07 | Future timestamp >5 minutes, old valid offline record | Future record quarantined; eligible old event keeps occurrence time; no silent retiming |
| G08 | Mixed method versions, token scopes and evidence classes | Separate incompatible series; coverage denominator correct; no global exact badge |
| G09 | Company cells with 1-4 users plus complementary total | Suppression enforced in JSON, UI and member exports; subtraction and date-filter tests included |
| G10 | Manually corrupt daily rollup then run reconciliation | Affected summary marked inconsistent; canonical rebuild verified; no current-looking wrong value |
| G11 | Change timezone or explicitly recalculate methods | Visible job/version transition; original method retained; cached snapshots invalidated correctly |
| G12 | Sum personal server contributions against admin company total | Same calculation view/time/scope matches canonical query; rounding only display; admin export same semantics |

G09 documents remaining temporal/auxiliary-information privacy risk. Passing a threshold test does not justify claiming anonymity or differential privacy.

**Owner decision, 13 October 2026:** G09 no longer applies. While sharing is on, members see organization totals whatever the group size, so a small team's totals can reveal one person's usage. The regression tests now check that one person's usage reaches the member summary and that turning sharing off still hides it.

## 10. UI and host integration — U01-U12

| ID | Interaction / state | Required result |
| --- | --- | --- |
| U01 | Composer bar on all sites, normal and narrow windows | Correct anchor/order; no covered controls or duplicate bars; metrics linked to current conversation |
| U02 | Toggle host light/dark mode without reload | Theme updates, contrast remains readable, no flash that hides tracking warnings |
| U03 | SPA navigation, branch changes, multiple composers | Bar moves/updates correctly; obsolete subscriptions removed; capture independent from placement failures |
| U04 | Partial tokens, missing water, processing and storage failure | Clear labels; no error-as-zero; Details explains missing components and action |
| U05 | Open toolbar then Expand; switch periods/tools/models | Exactly My usage and Company primary tabs; same filters/units/scope; popup within supported bounds |
| U06 | Toolbar clicked on unsupported site or browser blank page | Native extension dashboard still works; no dependency on an injected website overlay |
| U07 | Online, queued, auth-blocked and offline modes | Server/local/pending/cached snapshots clearly separate with timestamps; no double-count |
| U08 | Keyboard, Escape, tab order and screen reader | Logical focus; true modals use appropriate focus management, but in-chat Details is nonmodal with no backdrop/trap; explicit close restores trigger focus and outside-click does not steal host focus; no per-token announcements |
| U09 | 200% zoom, high contrast and long translated labels | Controls/metrics accessible; important warnings not clipped; no destructive layout shift |
| U10 | Member and admin use all extension views/settings/help; admin opens separately shared website | No admin link/control/login flow in any extension surface and no admin URL in member configuration; admin web auth/roles still required when route is known; employee Company aggregate tab preserved |
| U11 | User-controlled pause versus company-disabled pause | Policy explained before enrollment and in settings; disabled control cannot claim to prevent uninstall/out-of-profile use |
| U12 | First supported activity/dashboard open after month end | Summary shown at most once per profile/company/month; a closed browser simply delays it |

Use representative synthetic screenshots and accessible role/text assertions rather than brittle selectors tied to website class hashes. Do not put real user chats into test artifacts.

## 11. Network observations — N01-N10 (removed)

**Removed by the owner decision of 17 and 18 October 2026.** By default connection IP addresses are not collected, the admin Network page and its endpoints are off (an operator setting, `ip_collection_enabled` with person analytics, brings them back; CONTRACTS section 8), and addresses stored before then are shown to no one until the one-off `python -m aift.maintenance purge-network-observations --confirm` deletes them (see CONTRACTS section 8). N01-N10 are no longer release gates. The ids and their original text stay below only so that existing references remain valid. The earlier text read: the IP-retention preference remains pending; until confirmed, tests use the explicitly provisional 30-day IP policy, independently of six-month hosted and default indefinite self-hosted usage policies.

| ID | Network scenario | Required result |
| --- | --- | --- |
| N01 | (Removed 18 October 2026) Direct HTTPS connection | Valid transport peer recorded with upload timestamp; not client JSON IP |
| N02 | (Removed 18 October 2026) Trusted single/multi-hop proxy | Only documented trusted chain resolves client address; normalized address matches independent ingress fixture |
| N03 | (Removed 18 October 2026) Untrusted X-Forwarded-For and malformed proxy chain | Spoof ignored; unresolved source flagged; no arbitrary first/last-hop guess |
| N04 | (Removed 18 October 2026) Shared NAT/VPN for many pseudonyms | One connection IP can map to multiple users; users not merged; admin wording not “unique people” |
| N05 | (Removed 18 October 2026) IPv4/IPv6/mapped forms and user network changes | Canonical equivalence correct; valid new network counted separately without new user |
| N06 | (Removed 18 October 2026) Offline records synced from a new address | Address associated with ingestion time; AI occurrence location explicitly unknown |
| N07 | (Removed 18 October 2026) Retry duplicate batch from another connection | No AI-count inflation; duplicate-only receipt excluded from AI-reporting adoption count |
| N08 | (Removed 18 October 2026) Expire IP data under configured retention | Ciphertext/equality tokens/indexes removed; usage follows its own policy, not IP expiry; old distinct-IP query exposes partial coverage |
| N09 | (Removed 18 October 2026) IP encryption/equality key rotation and backup restore | No duplicate distincts from key versions; keys not in repo/logs; missing key fails visibly |
| N10 | (Removed 18 October 2026) Inspect proxy logs, app logs, member traffic and admin audit | No ungoverned raw-IP copies; full IP view/export authorized and audited without plaintext duplication |

## 12. Deletion and restore — D01-D08

| ID | Scenario | Required result |
| --- | --- | --- |
| D01 | No admin deletion over simulated years in each deployment mode | Self-hosted default retains usage; hosted free/extended plans expire complete request families and derived totals at the disclosed cutoff; storage-pressure warnings do not invent another purge policy |
| D02 | Delete selected dispatch-time range including midnight-spanning attempts | Preview shows complete selected request families and fixed cutoff; exact confirmed scope only; future new requests unaffected; idempotent tombstone/job |
| D03 | Crash halfway through deletion/rebuild | Job resumes safely; affected summaries rebuilding, not stale successful totals |
| D04 | Delete records with IP associations, cached summaries and exports | All in-scope active-system references removed/invalidated; minimal audit/tombstones only |
| D05 | Offline device uploads erased records after completion | Server rejects with erased status; reconnecting client clears affected local state; new UUID cannot bypass range tombstone |
| D06 | Delete user with online/offline devices, pending connections and login continuations | Usage/web credentials revoked; separate signed deletion-only channel permits local purge/ACK; no usage access or identity resurrection; ordinary revocation alone does not trigger purge |
| D07 | Restore backup taken before deletion | Deletion journal replay before service exposure; records remain erased; missing journal blocks restoration completion |
| D08 | Disconnected device or externally downloaded export remains | Completion report states external/offline limitations; no false remote-wipe claim; acknowledgement coverage visible |

## 13. Performance, lifecycle and deployment — P01-P08

These engineering targets require a documented reference host, browser family/version and dataset. They are not measured promises yet. Extension targets must be measured independently in Chrome, Edge and Firefox.

| ID | Workload | Proposed gate |
| --- | --- | --- |
| P01 | 500 users with multiple paired devices; normal daily activity | Correct isolation/dedup; no memory/time limit hides lost observations |
| P02 | 50 applied observations/second burst; 100-record batches | p95 ingestion <=2 seconds on reference host; durable ACKs; overload gives visible bounded 429/backoff |
| P03 | 1 million retained records baseline; 10 million capacity run | p95 indexed dashboard query <=2 seconds on reference host; publish storage/index growth and actual results |
| P04 | Cached dashboard open and ordinary terminal text | Cached popup <=500 ms; local terminal metrics usually <=2 seconds; slower jobs visibly processing |
| P05 | Four simultaneous streams plus large document | Defined raw-buffer limits honored; no unbounded clone buffering; no blocking website send/cancel interaction |
| P06 | Repeated background/worker termination, browser restart, permission revocation in each target | Durable recovery; explicit loss-of-visibility state; no immortal-background assumption |
| P07 | Fresh deployment, upgrade, backup and rollback drill | Instructions alone suffice; no secrets in image/repo; schema compatibility and deletion replay demonstrated |
| P08 | Disk full, database unavailable, estimator failure and queue surge | Readiness/health fail accurately; no uncommitted ACKs; alerts and documented recovery preserve data |

If a target cannot be achieved, publish the measurement and obtain an explicit target/architecture revision. Do not hide the failure by returning incomplete data as a fast result. Load tests use synthetic numeric records, not employee conversations.

## 14. Cross-browser support — B01-B08

| ID | Scenario | Required result |
| --- | --- | --- |
| B01 | Clean checkout builds Chrome, Edge and Firefox packages | Separate valid manifests/signing metadata; shared source/version provenance; no unsupported Chromium permission/API in Firefox output |
| B02 | Minimum and stable browser versions; tokenizer host startup/termination | Browser-specific background host works; identical numeric results; storage/credential isolation proven; missing critical capability visibly blocks enrollment |
| B03 | Page bridge injection, permission grant/revocation and hostile page messages | Actual target-browser isolation and access checks pass; no silent fallback that leaks credentials or raw text |
| B04 | Four AI sites in all three actual browsers | Twelve verified basic-text combinations; requested thinking/search/document modes explicitly classified per combination; themes/popups/navigation work |
| B05 | Pair every browser pair in both directions, same and different machines | All linked installations share one user ID and personal server total; distinct installation IDs/browser labels; no IP-based or provider-account-based merge |
| B06 | Two paired browsers generate simultaneously, mirror history, then reconnect offline queues | Distinct real requests counted separately; history/retries do not duplicate; one active user across browsers; canonical/local snapshot reconciliation correct |
| B07 | Chrome Web Store, Edge Add-ons and Firefox Add-ons package origins, updates and enrollment | Each authenticated origin/configuration works without Chrome-only ID assumptions; publication/approval state accurately reported; upgrades preserve ledger/identity |
| B08 | Cross-browser revocation, full-user deletion, same-email reconnect and fresh second install | All installation credentials follow same policy; deletion-only channel works in each browser; active same-tenant email resolves to same user, never deleted identity or another tenant's user |

## 15. Context guidance — C01-C08

| ID | Scenario | Required result |
| --- | --- | --- |
| C01 | Active input context at 49%, exactly 50%, then 51% | Only above-50% crossing triggers inline advisory; no claim the full limit was exceeded |
| C02 | Provider exposes official application capacity while fallback is configured | Verified official limit wins; basis/date/model shown; no stale fallback denominator |
| C03 | Official capacity absent; reviewed model/family or company budget configured | Conservative advisory budget used with explicit numerical amount and basis; never presented as verified actual capacity |
| C04 | No valid capacity/budget; unknown routing; hidden context | Percentage unavailable or explicitly budget-based when valid general policy exists; partial numerator labeled; no invented model limit/unknown-to-zero conversion |
| C05 | Regenerate history, switch branch/model, provider compaction | Active context recomputed; cumulative consumption never used as numerator; old ratio/basis not carried forward |
| C06 | Two tabs cross threshold; dismiss/snooze; ratio falls then rises | One notice per key with configured 45% rearm/24-hour cooldown; preferences respected independently of tracking-pause policy |
| C07 | User chooses to keep chat, dismisses tip or starts fresh manually | Chat unchanged by extension; no automatic summary/generation/new chat; loss-of-context/retry trade-off explained |
| C08 | Advice claims savings or ranks employee/model greenness without evidence | Unsupported claim rejected; optional neutral tips only; guidance view creates no consumption records |

## 16. Host noninterference — H01-H06

Run all cases against the same synthetic workflows with the extension disabled and enabled in Chrome, Edge and Firefox on all four sites.

| ID | Scenario | Required result |
| --- | --- | --- |
| H01 | Send, edit, regenerate, stop and stream; slow/offline company server | Native requests/results/events preserved; dispatch never waits for measurement/sync; no duplicate provider call |
| H02 | Upload/download, attachment selection, tools/search/model choice | File bytes, selections and native outcomes unchanged; unsupported measurement does not disable host features |
| H03 | Navigation, keyboard shortcuts, text selection, accessibility and narrow viewport | No stolen focus/shortcuts or blocked controls; scoped styles; unsafe bar placement yields toolbar-only diagnostic |
| H04 | Context warning/monthly summary appears while typing/streaming | Approved above-composer long-chat banner and compact bar summary only; no focus steal/modal/audio/OS notification/unsolicited overlay; details/dashboard require explicit action |
| H05 | Tokenizer crash, buffer limit, slow parser or conflicting extension hook | Measurement mechanism disables safely; website remains usable; teardown changes only owned hooks/nodes; reload guidance if safe restoration impossible |
| H06 | Extension-on/off latency/CPU/memory and response-stream comparison | Publish measured bounded overhead; no request body/header/response corruption or functional regression; breach blocks release rather than trading host behavior for metrics |

## 17. Open-source delivery — O01-O06

| ID | Scenario | Required result |
| --- | --- | --- |
| O01 | Inspect original code license/package metadata | MIT and confirmed copyright holder; no conflicting original-code Apache default; third-party exceptions explicit |
| O02 | Trace every copied component, asset and transitive dependency | Exact revision/hash/license/notices and modifications recorded; unknown/noncommercial/restricted components excluded pending resolution |
| O03 | Distribute MPL-covered component or source port | Covered-file license/source/notices preserved; no blanket MIT relabeling; MIT wrappers separated |
| O04 | Clean external contributor follows repository docs | Setup/tests/contribution/security/support/governance/privacy instructions complete and contacts real; no employee secrets required |
| O05 | Scan source/history, release packages, public fixtures and issue templates | No credentials, employee text, raw IPs or private deployment identifiers; approved synthetic fixtures and safe reporting instructions |
| O06 | Rebuild all browser/backend packages from published source | Matching version/provenance/hashes, SBOM/notices, self-host setup and redistributed-source obligations; ordinary build/test needs no proprietary hidden module or live counting key |

## 18. Failure catalog: visible state and recovery

Map internal exceptions to these stable codes. Each diagnostic records first/last occurrence, affected site/record count, retry state and safe correlation ID. A transient issue can resolve automatically; the history remains inspectable. Repeated identical issues are coalesced, not erased.

Capture coverage uncertainty is separate from this failure catalog. An active MAIN-world listener with an outer fetch wrapper shows `Capture coverage unverified` in Details; it must not manufacture a current `capture_hook_missing` failure. Verify direct and forwarding/non-forwarding wrappers, initial and renewed heartbeat deadlines, a second outage after recovery, observed activity without capture, and preservation of real diagnostics when only historical numbers are available. No heartbeat check may trigger a provider request or overwrite another script's wrapper.

| Failure code | User-visible behavior | Automated recovery | Admin/operational behavior |
| --- | --- | --- | --- |
| `capture_hook_missing` | Tracking problem; observed activity may be missing | Reinitialize supported hook on safe lifecycle event; no request replay | Adapter/site degraded, affected reporting installations counted |
| `protocol_unsupported` | Partly measured in Details (never a bar status), or unavailable with affected component | Preserve valid independent observations; await packaged adapter update | Capability regression and version visible |
| `composer_anchor_missing` | Toolbar still works; integration unavailable | Reattempt bounded placement on route/layout change | Placement issue distinct from capture failure |
| `capture_limit_exceeded` | Partial capture; known numeric checkpoint retained | Stop only measurement buffer, allow chat to continue | Limit counter and workload category, no content |
| `model_unverified` | Model/count method unverified | Registry update only when evidence available | Unknown-model share in coverage report |
| `tokenizer_unavailable` | Request recorded; tokens processing failed/unavailable | Restart worker, retry bounded job while text remains in memory | Failure rate and affected versions |
| `storage_write_failed` | Prominent recording failure; unsaved work at risk | Bounded retry; no false saved state | Health alert when transmission possible; silence not treated as recovery |
| `ledger_integrity_failed` | Affected records blocked; repair instruction | Quarantine/rebuild derived indexes, preserve originals | Integrity incident and repair report |
| `auth_reconnect_required` | Connect to company again; local work pending | Single-flight refresh, then stop repeated failures | Installation auth-blocked status |
| `enrollment_revoked` | Company connection revoked | Stop upload; explicit re-enrollment/pairing decision | Revocation audit, no automatic new identity |
| `sync_delayed` | Pending count, oldest age, last successful sync | Persisted jitter/backoff, retry on activity/alarm | Queue-age thresholds visible |
| `payload_rejected` | Specific record cannot sync; update/recovery action | Quarantine affected record, continue safe ones | Reject code/schema/version totals |
| `revision_conflict` | Reconciliation needed; not discarded | Fetch canonical observation, do not invent IDs | Conflict queue with numeric metadata only |
| `request_identity_ambiguous` | Recorded activity with unresolved request count | Quarantine contested parent contributions; preserve one canonical attempt | Resolve verified identity/dispatch evidence; no silent duplicate parent totals |
| `dependency_missing` | Related record waiting to sync | Send parent, retry child | Alert if parent cannot be recovered |
| `clock_skew` | Device time needs checking | Retain original timestamp; no silent retiming | Quarantined future records/installation count |
| `estimate_pending` | Tokens saved, resource calculation pending | Approved method/job retry | Pending age/backlog; alert after 15 minutes |
| `estimate_unavailable` | Known scope/subtotal and missing factors | No endless retry for unsupported science | Unsupported share, not an operational success error |
| `method_update_invalid` | Last valid applicable method with stale warning, or unavailable | Reject signature/hash; keep valid bundle | Update/security alert |
| `aggregate_inconsistent` | Rebuilding or dated prior snapshot | Reconcile/rebuild from canonical data | Immediate operator alert; verified repair required |
| `ip_unresolved` | No employee-facing IP detail | Do not guess; fix trusted-proxy config | Network coverage warning |
| `ip_history_expired` | No employee-facing IP detail | Correct configured expiry | Admin query says which dates remain covered |
| `retention_expired` | Older organization records expired under the disclosed policy | Terminal receipt and local scoped purge; never retime or endlessly retry | Effective cutoff, affected families and expiry/rebuild status |
| `deletion_in_progress` | Affected summary updating | Idempotent deletion/rebuild | Job progress and failure escalation |
| `policy_unavailable` | Last valid company policy with age | Fetch on reconnect; no broadened permissions | Stale-config installations visible |
| `guidance_budget_unavailable` | General tips, no misleading percentage | Load reviewed budget/configuration when available | Guidance configuration issue, not failed AI use |
| `host_interference_detected` | Measurement disabled; host usable; badge/dashboard diagnosis | Safe removal of only owned mechanism, otherwise clear reload advice | Browser/site regression blocks release; no preservation of a harmful hook |

Initial alert thresholds: storage/integrity/authz leakage/aggregate inconsistency immediately; repeated protocol/capture failure immediately for the affected site; sync queue older than 24 hours flagged; estimation backlog older than 15 minutes flagged. An installation not reporting for 24 hours is labeled **not reporting**, not failed or inactive AI use. Closed browsers are expected. No third-party crash analytics or alert destination receives user data without separate configuration and disclosure.

## 19. Release evidence and open-source handoff

Before P11 completes, the release folder must contain:

1. Requirement/test matrix with actual pass/fail/unsupported status and links to CI or signed test artifacts. No blank rows silently treated as pass.
2. Three-browser/four-site capability matrix with tested operating systems, minimum/stable versions, account modes, adapter versions and verification dates. Experimental thinking/search/document components visibly identified in the shipped UI.
3. Tokenizer asset hashes/licenses, official parity results and calibration holdout report. The “closest tokenizer” claim is limited to what the tested corpus/model supports.
4. Estimator method bundles, source bibliography, unit/boundary explanation, baseline/candidate comparisons and uncertainty limitations. Public numbers must reproduce from published numeric inputs.
5. Privacy inventory and outbound-marker-test evidence; finalized IP-retention preference; access-role tests; employee disclosure and administrator governance checklist.
6. Idempotency, fault injection, canonical/rollup reconciliation, backup/deletion-replay and fresh deployment evidence.
7. Source/build provenance for Chrome, Edge and Firefox packages, lockfiles, licenses/notices, software bill of materials, per-browser permissions review and proof no remote executable code or development-recorder privilege entered employee builds. Include each store's installation/review/signing status and tested cross-browser pairing evidence.
8. Measured performance report for the specified 500-user workload; pilot issue log and closure of every silent-accounting/privacy blocker.
9. Maintenance runbook: synthetic adapter checks, registry review, incident triage, rollback compatibility, user-visible degradation, data-only signature rotation and responsible security reporting.
10. O01-O06 evidence and all artifacts in [open-source delivery rules](OPEN-SOURCE-AND-REUSE.md); original-code MIT licensing and accurate upstream attribution. Include C01-C08 context-guidance basis tests and H01-H06 enabled/disabled host-behavior comparisons.

The first implementer should begin with P0 contracts/fixtures, then P1 capture evidence. This plan intentionally does not pretend that currently unobserved consumer-server fields, a chosen closed-provider hardware configuration or physical per-request telemetry have already been established.

## 20. Live-audit-derived gates, BA01-BA22

These are additional implementation/release requirements derived from the [9 September live audit](LIVE-BROWSER-AUDIT-2026-09-09.md). They are not all executed. The separate [reduced fixture harness](../../fixtures/browser-audit-2026-09-09/README.md) passed 32 offline checks on 9 September; it verifies only its documented subset. Production adapters, tokenizer accuracy, resource factors and browser compatibility remain unverified by that harness.

| ID | Test | Required result |
| --- | --- | --- |
| BA01 | Claude compressed and uncompressed dispatches; tiny prompt with a large tool envelope | Correct dispatched prompt selected; gzip/base64/envelope/tool definitions never automatically counted as new user text |
| BA02 | Claude new/follow-up/Retry with empty prompt and alternate branch | Retry is a new user action; history/parent loads are not; no false zero logical input |
| BA03 | Claude and other SSE split UTF-8, CRLF, multiline data, comments and incomplete frames | Correct assembled text; comments ignored; incomplete/malformed data creates an explicit scoped diagnostic |
| BA04 | Claude quota windows, empty thinking block and search/citation events | Quotas not tokens/context; unknown hidden reasoning not zero; answer/tool/citation representations kept disjoint |
| BA05 | Claude successful Stop response and aborted stream | Retain partial output and observed execution; correlate explicit stop evidence; no normal completion without proof |
| BA06 | ChatGPT HTTP handoff without answer in initial SSE | Follow correlated observed transport; initial `[DONE]` cannot finalize output |
| BA07 | ChatGPT existing socket, subscribe catchups, duplicate/conflicting items | No lost or double-counted answer; conflicting same-ID content fails visibly; late attachment reports partial coverage |
| BA08 | ChatGPT omitted path/operation, string append, object append and patch arrays | Validated per-stream state; message roles/channels isolated; unsupported shape/operation fails visibly |
| BA09 | ChatGPT reasoning display, stop-token IDs and null search count during a web invocation | No token-ID-as-count or duration-as-reasoning inference; null search count not zero; overlapping displays not added |
| BA10 | ChatGPT `client_stopped` with stream-complete and transport-done signals | Cancelled partial attempt, not a fully completed answer or discarded work |
| BA11 | Gemini form body with nested JSON and conversation tuple | New prompt extracted; references not treated as prompt/history text; opaque session data stays private |
| BA12 | Gemini Unicode frames including emoji and combining marks, fragmented at every boundary | Incremental UTF-8 followed by UTF-16-unit framing; wrong byte-length parser rejected; no silent Unicode normalization |
| BA13 | Gemini repeated/changed candidates and rich duplicate text | Selected candidate reconciled once; no summing cumulative snapshots or alternate renderings |
| BA14 | Gemini stopped response with successful HTTP termination and empty answer snapshots | Observed text may be zero; backend work unknown; no false normal completion from HTTP/wrapper alone |
| BA15 | Perplexity initial empty `text`, growing `chunks`, patches and final full workflow | Partial output recoverable from chunks; final text replaces rather than adds; item/block identity preserved |
| BA16 | Perplexity query list, ten sources and cumulative twenty-source pane | Query, source and user-request metrics separated; no guessed search-call count |
| BA17 | Perplexity normal client abort versus successful user Stop | Normal final answer retained; cancellation classification requires independent evidence. Genuine stopped live fixture still required |
| BA18 | Lost events, completed-body unavailable, diagnostic timeout or bad character decoding | Capture failure recorded per run; no inference that the provider never exposes the missing field; preserve host usability |
| BA19 | Unknown model/routing label and absent verified app context capacity | Labeled proxy/unknown model; no automatic Llama/Claude/Gemini tokenizer mapping; 50% advice follows verified capacity or disclosed advisory budget |
| BA20 | Synthetic plain text, text PDF, scanned PDF, unsupported upload and OCR/retrieval | Real upload flow evidenced; local extracted text kept distinct from opaque provider processing. Live upload fixtures still required |
| BA21 | Actual packaged observer in Chrome, Edge and Firefox; existing tabs, workers/frames and extension on/off | Correct capture and measured bounded overhead without changing Send/Stop/uploads/streams; one browser's pass cannot promote another |
| BA22 | Full-shape fixtures, company uploads, logs and release packages searched for private markers | No raw authenticated captures, prompts/answers/tool text, source URLs/titles, credentials or provider IDs leak; only approved numeric/categorical fields sync |

Run the reference checks with `node --test fixtures/browser-audit-2026-09-09/reference.test.mjs`. Treat their passing result as a research-harness result only. Add independently checked full-shape fixtures and real-browser evidence before claiming P1/P5 or BA01-BA22 complete.

## 21. Methodology and first-release images, FM01-FM12 and IM01-IM20

The 32 checks in [the methodology and multimodal specification, Section 8](METHODOLOGY-AND-MULTIMODAL-SPEC.md#8-required-checks) are mandatory additions to this acceptance plan. They cover exact reference arithmetic, coherent PUE/carbon/water boundaries, highest-comparable selection, no false upper-bound claim, source/version drift, image dispatch identity, completed/partial outputs, history, image/file input, privacy and scoped aggregation.

Run `node --test tools/methodology-reference.test.cjs tools/methodology-checks.test.cjs design-canvas/test.cjs` and `node tools/build-methodology.cjs --check` for the reduced offline/documentation checks. These do not satisfy production image capture, tokenizer calibration, actual Chrome/Edge/Firefox behavior, backend recomputation, physical accuracy or the full FM/IM suite. P1 must obtain synthetic live image-generation/edit/upload fixtures where each site/plan provides those functions. A site without a native image feature is marked not applicable; an available but unverified feature is not declared supported.

Release evidence must distinguish the 67-entry recognition catalog from validated tokenizer/estimator profiles. Include the exact eligible cohort, selected proxy and environment version with golden image/text examples. Reject any release that adds reference-only figures to ordinary company totals, treats a displayed historical image as a fresh generation, substitutes binary-image bytes for text tokens, or turns an interrupted image operation into zero work because no final image arrived.

## 22. Scientific evidence and interpretation, Q01-Q14

The [methodology quality contract](METHODOLOGY-QUALITY-GATES.md#6-implementation-tasks-and-acceptance) adds Q01-Q14 to the production release requirements. These gates cover external-reference isolation, statistics, energy/water denominators, gas and water-source categories, provenance periods, incomplete environmental scenarios, validation/promotion, input sensitivity, coherent server recomputation, causal claims and saved-review anchors.

`node --test tools/offset-audit.test.cjs` checks the named reduced arithmetic, evidence-catalog and documentation regressions. It is not metered energy validation or execution of all Q gates. Tests that use deliberately synthetic result vectors verify bookkeeping only; production must independently validate factor coherence and recompute accepted results.

## 23. Localized calculation updates, MU01-MU06

These are implementation requirements, not tests already executed. They verify the easy-formula-update amendment without a fixed line-count promise.

| ID | Test | Required result |
| --- | --- | --- |
| MU01 | Change a supported coefficient through a reviewed versioned data record | New results and provenance propagate through the shared calculation interface without edits to provider adapters, UI components, aggregate reducers or API controllers |
| MU02 | Register a replacement test equation using existing observation/result fields | Changes remain in the estimator method, registration/validation, Python reference, tests and documentation; callers retain the stable interface |
| MU03 | Compare both runtimes on old and new bundles | Shared golden cases agree within the declared numeric tolerance; units, scope, assumptions and unavailable components agree too |
| MU04 | Recalculate existing records with a new method and then reopen the original view | Original results remain reproducible; recalculated totals are separately versioned and not silently substituted |
| MU05 | Send an unknown method, invalid coefficient or executable formula string | Reject or surface the specified incompatible-method state; no evaluation, silent default method or fabricated zero |
| MU06 | Change the method or observation while cached results exist | Versioned cache keys prevent stale reuse; cache bounds and host-noninterference performance checks still pass |

## 24. Personal, enrollment, hosted plans and operator gates, PE01-PE24

These are production tests to implement, not the offline documentation checks. Apply the canonical [product/enrollment specification](PRODUCT-AND-ENROLLMENT-SPEC.md). Pending owner policies must be explicit fixture parameters and cannot be reported as approved production decisions. PE03-PE07, PE09, PE11, PE12 and PE23 were updated on 13 October 2026 (owner decision) for the one hosted address, registration without an address field, administrator-only website sign-in and the extension's email-code connection.

| ID | Scenario | Required result |
| --- | --- | --- |
| PE01 | Clean personal install, all four sites, popup/settings/month change | Local counts and estimates work; no account/OTP/product-server/analytics calls or network outbox; actual browser/store update traffic identified separately |
| PE02 | Personal Company tab and explicit Connect | Company initially shows local not-connected state without server traffic; only user-started Connect requests the selected origin/permission and disclosure |
| PE03 | Register company without an address field (13 October 2026); Unicode name; invalid fields; submitted address field | Server normalizes/validates and generates an internal organization key that is never shown; extra fields rejected; hosted public origin is the one registration address; no forged verification/company-ownership claim |
| PE04 | Two registrations race the same domain; timeout after committed creation | One allowed organization per domain unless a developer exception exists; same verified retry retrieves same job; domain-duplication policy follows explicit selected configuration |
| PE05 | Provisioning crash/retry; hosted registration sign-in; self-hosted first-admin cross-origin bootstrap, including lost response and form parser probes | Pending/failure visible; no duplicate company/admin; hosted verification sets the session at the registration origin and returns /admin; self-hosted exact bounded urlencoded form/nonce/Origin/draft grant establishes tenant session with no-store 303, no shared cookie or second OTP; duplicate/extra fields, wrong content type, swapped tenant/browser, replay and expiry rejected |
| PE06 | Domain suffix lookalike, unapproved subdomain/free-mail address, controlled exception and a domain shared after it | Exact reviewed eligibility, generic identity response, free-mail `work_email_required` at once, no accidental admin/domain-wide ownership grant; exception audited; on a shared domain an email reaches only the organization it already belongs to |
| PE07 | Website sign-in as registrant, ordinary member, existing admin and an email domain no organization uses | Admin: one code consumption, web session and /admin. Member: `admin_required`, no session and no new member. Unknown domain: the code is sent as usual and `organization_not_found` comes only after a correct code. No member web pages, second factor or role chosen by client |
| PE08 | Wrong purpose/tenant, expired/late/replayed OTP, parallel redemption and lost response | Atomic single redemption; no duplicate user/session escalation; safe retry/new-code path; all BV challenge/privacy gates hold |
| PE09 | Connect from Chrome, Edge and Firefox with the work email and an email code in the extension | Organization found from the email domain; same-email same-tenant user reused, one new independent installation; no website page, approval tab, existing-device or recovery phrase requirement; explicit "Connect to {organization}" disclosure before upload; changed policy returns `policy_changed` |
| PE10 | Store install, pending proof flow, repeated exchange and browser restart | Store package contains no tenant secret; locator alone cannot claim; verifier/exchange ID binds one credential result, expiry/revocation respected and Connected waits for durable storage |
| PE11 | Local history then join; disconnect with never-uploaded records and newer accepted-record revisions; reconnect | No personal backfill or reassignment; a fresh email code for the owning member plus reconnect proof renews original device ID; a resume device unknown in the selected organization connects as a new installation and recognizes valid earlier capture eras; ownership/erasure/expiry checks unchanged; new browser cannot claim old queue; revoked/deleted proof rejected |
| PE12 | Host/header/body tenant spoof, sibling-origin CSRF, parent-domain cookie injection, duplicate cookie names and arbitrary redirect | At the hosted address only the request's own credential selects the organization; a self-hosted server agrees canonical host and principal; two organizations served at one address reach only their own data; __Host- prefixed Secure/HttpOnly Path=/ no-Domain sessions, ambiguous cookies rejected, CSRF/Origin/allowlist checks; no tenant crossover or credentials in URLs |
| PE13 | Tenant cache/job/export lookup with another tenant's identifiers | Tenant carried through database FKs, background processing, cache keys, downloads and errors; no cross-tenant data/role disclosure |
| PE14 | Admin promotion/demotion, concurrent last-admin removal, session/export already open | Exactly two roles; current-role checks and atomic last-admin guard; privileged access revoked promptly; extension still has no admin link |
| PE15 | Organization admin guesses operator route or self-promotes | No operator authority; isolated operator grant/session/purpose required; no default employee-data impersonation feature |
| PE16 | Last hosted seat raced, existing member installs another browser, exception expires over cap | Transactional one-seat allocation under selected cap definition; installation does not add person; over-limit blocks new members, not silent deletion/demotion of existing users |
| PE17 | Hosted six-calendar-month cutoff, end-of-month, DST and midnight-spanning attempts | Deterministic frozen UTC cutoff from company calendar; whole request families removed; no orphan/hidden all-time aggregate, coverage start displayed |
| PE18 | Expired offline queue uploaded with new IDs or changed receipt time | Occurrence/enrollment/expiry rules enforced; terminal retention_expired receipt, visible local purge, no endless retry or upload-time rebucketing |
| PE19 | Paid/override extension then shortening/revocation | Versioned entitlement and explicit affected-data preview/effective-time acknowledgement; no invented charge; longer retention cannot resurrect erased data |
| PE20 | Restore backup taken before deletion/expiry after later longer-plan change | Current cutoffs plus deletion/expiry journal replay before service; missing journal blocks restore; no resurrection in canonical data, rollups, exports or reconnecting devices |
| PE21 | Operator grants free exception, changes plan and retries failed mutation | Exact tenant/fields/reason/time/audit; same idempotency key no duplicate mutation; ordinary admin cannot assign own unlimited hosting |
| PE22 | Independent self-host build, separate Brevo secret, no hosted-service network access | Complete app builds/runs with configurable single tenant and no proprietary license/control-plane call; hosted free limits not imposed as source restrictions |
| PE23 | Public, registration and administrator pages, unavailable store/repository URL, narrow/keyboard layouts | Consistent Fern brand and truthful links/states; no company white label or false install success; draft-screen content translated into usable accessible surfaces |
| PE24 | Owner choices or production config missing | Development remains possible with labeled fixtures; affected enrollment/pricing/IP/publishing paths stay visibly unconfigured, not silently guessed or called release-ready |
