# AI Footprint Tracker: implementation handoff

Prepared 9 September 2026. This is the starting brief for a separate implementer. The repository currently contains the editable design canvas, source-backed research, reference calculations, reduced protocol fixtures and implementation specifications. **There is no released extension, production backend, deployed organization service or completed live accuracy validation.** The [handoff review record](docs/implementation/HANDOFF-REVIEW-2026-09-09.md) records the resolved contradictions, independent reader checks and 99 passing offline checks, with their limits.

## 1. Goal and permission boundary

Build the complete AI Footprint Tracker product from the phase plan and contracts: a Chrome, Edge and Firefox extension for ChatGPT, Claude, Gemini and Perplexity; local-only personal tracking; company enrollment and numerical usage sync; public website; organization administration; and a separate platform-operator panel. Original project code is MIT, including website/backend/operator code, with third-party obligations preserved. Since 13 October 2026 (owner decision) every hosted organization is served at the one address `https://aifootprinttracker.com`; independent self-hosting, at the organization's own domain or subdomain, requires no proprietary control plane.

Treat this as a phased implementation, not permission to deploy, spend, buy datasets, rent GPUs, create provider accounts, register stores, publish source, send employee messages or change a live mail/DNS account. Use public/synthetic research and local tests. Live synthetic provider tests need an authorized account/browser and the relevant consent; previous sample captures are not permission to export private history. No production VPS has been selected.

The main criterion is **no silent errors**. Capture gaps, unknown scope, duplicate events, failed storage, pending synchronization, failed auth, invalid factors, incompatible updates and incomplete deletion must never become believable successful numbers or false zero usage. Preserve the user's AI tool even if measurement must stop. A working-looking bar is not implementation completion.

## 2. Read in this order

| Order | Document | Purpose |
| --- | --- | --- |
| 1 | [Main implementation plan](IMPLEMENTATION-PLAN.md) | Requirements R01-R24, ownership and P0-P11 work packages |
| 2 | [Product, hosting and enrollment](docs/implementation/PRODUCT-AND-ENROLLMENT-SPEC.md) | Personal/hosted/self-host modes, registration, email identity, connection protocol, plans/operator, retention and open decisions |
| 3 | [Data/API contracts](docs/implementation/CONTRACTS.md) | Observation schema 1.1.0, trusted boundaries, event lifecycle, IDs, math scopes, ledger/sync, authorization and deletion |
| 4 | [Acceptance/failure matrix](docs/implementation/ACCEPTANCE-AND-FAILURES.md) | Tests to implement, including actual browser, privacy, role, retention and failure evidence |
| 5 | [Methodology/multimodal specification](docs/implementation/METHODOLOGY-AND-MULTIMODAL-SPEC.md) and [quality gates](docs/implementation/METHODOLOGY-QUALITY-GATES.md) | Exact source-backed references, first-release images, coherent fallback, production eligibility and scientific claims |
| 6 | [Live browser audit](docs/implementation/LIVE-BROWSER-AUDIT-2026-09-09.md) and [sanitized fixture README](fixtures/browser-audit-2026-09-09/README.md) | What was actually observed on the four consumer sites, parser traps and unfinished live coverage |
| 7 | [Research index](docs/research/README.md) and [context-aware energy conclusion](docs/research/CONTEXT-AWARE-ENERGY-RESEARCH-2026-09-09.md) | Sources, corrections, accepted/rejected approaches, input/cache limitations and why baseline coefficients remain unchanged |
| 8 | [Brand/roles/design](docs/implementation/BRAND-ROLES-AND-DESIGN-HANDOFF.md), [canvas README](design-canvas/README.md), [review updates](docs/design/REVIEW-UPDATES-2026-09-09.md) | Locked Fern/Resource Gauge identity, draft screens, user edits/comments and interface behavior |
| 9 | [Brevo setup](docs/implementation/BREVO-PRIVACY-SETUP.md), [writing/code standards](docs/implementation/WRITING-AND-CODE-STANDARDS.md), [open-source rules](docs/implementation/OPEN-SOURCE-AND-REUSE.md) | Privacy-oriented mail setup, plain copy, reuse/performance and complete source delivery |

Earlier research remains evidence, not an alternative current product spec. In particular the original independent audit must be read with its correction addendum linked in the research index. Do not restore no-email accounts, invitation-only enrollment, extra organization MFA, admin links in the extension, output-only "high accuracy" claims or default expiry rules copied from superseded prose. If current normative documents genuinely conflict, record the conflict and resolve it before implementing the affected behavior.

## 3. The user experience to build

### Personal user

Visit the public site, read about the project and install the appropriate store package. No login or organization is required. The extension counts supported chats in that profile, calculates available estimates locally and shows the conversation bar. Clicking the browser toolbar icon opens My usage; the second Company tab explains that no company is connected. Nothing is uploaded to our servers in this mode, and personal multi-device sync is not promised.

### Organization and employee

Updated 13 October 2026 (owner decision). The registrant enters company/contact details and work domain at `https://aifootprinttracker.com` and verifies the work mailbox using a Brevo code; there is no organization address to choose. Verified registration creates the first admin and signs them in to `/admin` at the same address. Only administrators sign in on the website. A non-admin who tries is told that members connect from the extension.

The employee installs the same public extension package, chooses Connect organization, enters the work email and the emailed code, and confirms "Connect to {organization}?" after seeing what is shared. The organization is found from the email domain; whether a domain has an organization is revealed only after a correct code. The package does not contain a company secret. The same verified email in the same tenant connects additional browsers/machines to one user, each with its own installation credential. Old local personal records are not uploaded. Admins can see installation instructions in the web dashboard but never get an administration link inside the extension. On a self-hosted server, which runs one organization at its own domain or subdomain, a dedicated short-lived bootstrap carries the first admin from the registration origin to the tenant session without a second OTP or shared-domain cookie. A same-profile reconnect preserves its original installation ID and valid capture eras before resuming queued records; a reinstall after storage loss is a new installation for the same user.

The company stores numerical/categorical usage observations and computed resources, plus the requested separate email mapping. The records stay linked to a member's work email on the server, so they are not anonymous, but since the owner decision of 17 and 18 October 2026 administrators see organization aggregates only, never usage next to a name, email or browser, and in a very small organization those aggregates can still reveal one person's usage. Connection IP history is no longer collected since 18 October 2026; rows stored before then are shown to no one until a one-off purge deletes them. No prompts, answers, thinking text, files, filenames, titles or chat URLs are uploaded. Shared office IPs never merge users or prove physical device counts.

### Conversation UI

Below the composer show accumulated recorded conversation requests, input/output tokens and scoped estimated electricity, carbon and water. Clicking Details opens a nonmodal overlay on that same page, not a tab. Keep the host usable. Use its light/dark surfaces and typography, with no logo in the bar.

When the active-context estimate exceeds 50% of a verified application limit or disclosed advisory budget, show a restrained prominent banner directly above the composer. The long basis message and progress bar belong in Details. Dismissal hides advice only. Never start a chat, summarize, send, rewrite, alter files or interrupt the tool on the user's behalf.

E02 is the enrolled browser-toolbar popup. E01 is the local-only counterpart. C09/C13/C14 are Details content specimens, not forced navigation routes. C10 is for genuinely unavailable components, such as lost/unparseable observations, failed tokenizer, or no compatible usable resource profile. Missing hidden reasoning alone does not cause blanket C10. An unknown model can still use a reviewed highest-comparable profile with explicit proxy/scope disclosure; image-reference-only values stay out of ordinary totals.

## 4. Accounting and estimation must stay separate

### What is added for a conversation

The ledger records each actual dispatched action and its observed generation attempts. For a new turn it counts or estimates the **input supplied to that turn**, including known retained earlier context, and the **new output**. Cache/reasoning parts are normalized only when their semantics are established. Unknown hidden work stays unknown.

Synthetic example, assuming all visible earlier text is retained and every new prompt/answer is 500 tokens:

| Request | Logical input for this request | New output | Cumulative input + output usage |
| --- | ---: | ---: | ---: |
| First | 500 | 500 | 1,000 |
| Second | 1,500 | 500 | 3,000 |
| Third | 2,500 | 500 | 6,000 |

The final visible transcript contains 3,000 tokens, but cumulative processed-token usage is 6,000 under those assumptions. Reuse of previous text on a new request is not bookkeeping duplication. Reopening/history retrieval adds no new consumption. Regeneration and abandoned branches retain actual recorded work. Old untracked requests are not silently invented; their available text may inform a new request's context. Active context for the 50% warning is the current retained branch snapshot, never the cumulative 6,000 usage figure.

### What the resources mean

Estimate each observed execution with the accepted method and add compatible contributions for the conversation, user and company. Do not retokenize the final transcript once and call that lifetime consumption. Do not add every revision or duplicate transport delivery. Never add GPU-only image references to broader text/IT values as though they share a complete boundary.

The current EcoLogits text-energy reference primarily follows generated output and does **not explicitly adjust for growing input length**. Input accounting can grow correctly while the energy formula remains insensitive to that growth. The research found credible input-aware studies but no qualified drop-in formula for the actual four closed consumer services. Keep the present numerical reference settings and label them rough, assumption-based operational estimates. Do not call them highly accurate, complete, measured or "as accurate as possible" as an established result.

The [canonical methodology article](docs/methodology/content.html) contains the equations, units, coefficient provenance, worked examples and primary-source links. IT-to-facility energy uses PUE only when needed; carbon uses a compatible electricity intensity; direct cooling water and electricity-supply water use their own compatible denominators and are shown separately. A correct multiplication does not validate the unknown underlying provider scenario. User/company IP does not locate the AI data center.

Runtime baseline approval is a review of source fidelity, declared assumptions/applicability, units, evidence labeling and functional behavior. It is not fabricated empirical calibration. P0/P6 must build the reviewed immutable bundle explicitly. Raw research JSON, vendor disclosures and the SweetSpot demonstration do not automatically become runtime profiles. The highest-comparable choice is a maximum within the eligible finite cohort for that workload, not a physical upper bound.

Image generation/editing is first-release scope wherever the provider/plan exposes it. Count canonical operations and outputs, not downloads/previews. Each generated image is estimated at the published 2.907 Wh mean times the provider PUE; this is not a measurement of a Claude/ChatGPT/Gemini/Perplexity image operation. The ML.ENERGY image cohort once bundled as a GPU-only reference was removed on 20 October 2026 because the ML.ENERGY leaderboard repository it came from has no licence. Search, OCR, document selection, image interpretation, hidden reasoning and unknown cache reuse remain separately described gaps where not observable. A stopped image operation with no delivered image is not zero energy.

## 5. Implementation sequence and handoff artifacts

| Phase | Deliver first | Evidence required before closing |
| --- | --- | --- |
| P0 | Build targets, strict schemas, failure catalog, runtime-bundle eligibility, configuration and license inventory | Clean builds, official API/capability checks, source provenance and explicit pending owner choices |
| P1 | Complete sanitized capture corpus and per-mode/browser capability matrix | Actual twelve basic site/browser flows; every additional mode has a tested status; recorder gaps recorded |
| P2 | Local namespaces, numerical ledger, revisions, outbox and health | Crash/quota/migration/idempotency tests; personal mode has no upload path |
| P3 | Bundled local tokenizer assets and versioned mappings | Official parity where possible; substitutes explicitly calibrated or rough; no employee API calls |
| P4 | Registration, Brevo OTP, tenant identity, connection handoff and scoped credentials | Same-email multi-browser tests; tenant/role/proof/replay isolation; real controlled mail tests before launch |
| P5 | Provider-specific parsers and event normalization | Full-shape independent fixtures, history/branches/stop/images and no host interference |
| P6 | Shared pure estimator methods and immutable approved bundles | TS/Python goldens, boundaries, assumption labels and fallback vector coherence; no unearned calibrated claim |
| P7 | Durable upload acknowledgements, server canonicalization and rollups | Offline retry/crash/revision/duplicate/retention reconciliation; matching scope totals |
| P8 | Public/organization web flow, bar/Details and exactly two popup tabs | Approved screen fidelity, keyboard/contrast/narrow/dark states, local-only and enrolled network checks |
| P9 | Organization admin, role controls, retention/deletion, plans and operator | Cross-tenant/operator tests, last-admin/seat races, IP boundaries and deletion/expiry restore |
| P10 | Full reliability/privacy/security/performance matrix | Measured real-browser overhead, 500-user target evidence and no silent-data defects |
| P11 | Pilot, reproducible self-host package and publication preparation | Clean deployment/restore, real distribution/source/privacy configuration; publication only with authorization |

The detailed task lists, interfaces and acceptance IDs live in the linked plan/contracts. Each phase report must name files changed, assumptions, command/environment/results, known unverified modes, and the next dependency. An implementation claim requires executed evidence, not a checkmark copied from this document.

Keep formulas small and replaceable: a coefficient update changes a reviewed immutable data record, version, goldens and source explanation; a method replacement changes the method module, registration/validation and Python reference, plus tests/docs. It should not require edits throughout adapters, UI, reducers or controllers when the schema is unchanged. No mutable browser globals, utility dumping ground or downloaded executable equations.

## 6. What is already verified, and what is not

Existing evidence before this handoff: 23 authorized synthetic browser actions, reduced protocol fixtures with 32 offline checks, 67 dated recognition/model/router records, four reproducible text reference scenarios, a 208-configuration GPU-image cohort (removed on 20 October 2026, no licence), the source-audited Offset comparison and input/context/cache research. These are not equivalent to production support for every model/mode.

The established combined offline command contains **91 tests**, covering prototype behavior, reduced protocol parsing, reference arithmetic and source/document consistency. It does not run production adapters, backend migrations/auth/retention, independent store builds, live hardware energy measurements or the full acceptance matrix. The new handoff checks are likewise documentation checks, not executed PE product tests.

Run from the repository root:

```sh
node tools/build-methodology.cjs --check
node --test tools/context-energy-study.test.cjs tools/offset-audit.test.cjs tools/methodology-reference.test.cjs tools/methodology-checks.test.cjs design-canvas/test.cjs fixtures/browser-audit-2026-09-09/reference.test.mjs tools/handoff-consistency.test.cjs
```

The public article and canvas P02 share one authored HTML source. Only rebuild generated copies after intentionally editing that source. Do not change reference coefficients just to make an example look better. Keep raw signed-in captures, ignored research caches and tool transcripts outside public release artifacts.

The canvas contains 88 draft/reference screens with local edits/comments and portable exports. Locked brand decisions are confirmed, but all screens are not formally approved. Preserve review anchors; request or import the latest exported review before structural changes. Product implementation still needs actual accessible/responsive/browser verification. Source and paragraph consistency do not certify environmental accuracy.

## 7. Owner inputs that are not silently settled

At this handoff the following questions have been sent to the owner and await confirmation:

1. IP-history duration: provisional development fixture is 30 days, configurable. An indefinite history was not inferred from usage retention.
2. Hosted free capacity: provisional fixture is 50 enrolled memberships including admins, not installations/IPs. Confirm whether the owner instead means total company workforce eligibility.
3. Shared work domains: provisional fixture permits one active hosted organization per domain, with operator-reviewed exceptions. Confirm whether self-service duplicate-domain organizations are wanted.

These are isolated policy choices. P0, local accounting, adapters and other implementation can start; the affected public onboarding/pricing/IP behavior must not launch on an invented decision. Record the answers in the product specification and update the fixtures/tests together.

Other launch inputs: actual repository/store URLs and signing state, copyright/rights holder, real support/security/privacy contacts, operator allowlist/auth-policy acceptance, chosen hosting/DNS/TLS and protected secrets, approved Brevo sender/privacy setup, prices/entitlements and a separately approved billing integration if wanted. No real accounts, secrets or payment vendor are implied by placeholders.

## 8. Definition of complete

All agreed surfaces and applicable tests are implemented, executed and reported; no hidden loss/double counting, incorrect tenant attribution, unsupported accuracy label or content/IP leak remains. The extension does not hamper the host. Personal mode stays local. Same-email organization identity works across browsers. Company/admin totals reconcile under the same period/method/scope. Failed mail, offline queues and deleted/expired data have visible recoverable states. Admin/operator separation and last-admin protection hold under races. Scientific limitations are visible and the exact method/source chain is reproducible. All original runtime code and permitted dependencies can be built and self-hosted without our private services.

Ready to begin coding does not mean ready for public deployment. Keep a release-evidence ledger with `passed`, `failed`, `unverified`, `not_applicable` and reasoned research-ineligible states. Do not turn absent provider telemetry into a false failure of bookkeeping, or turn a successful documentation test into proof of physical accuracy.
