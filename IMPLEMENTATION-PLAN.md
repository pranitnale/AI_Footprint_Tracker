# AI Footprint Tracker: implementation plan

**Single hosted address amendment, 13 October 2026 (owner decision):** the hosted service has one address, `https://aifootprinttracker.com`, with the developer panel at `https://developer.aifootprinttracker.com`. There are no per-organization subdomains and registration asks for no organization address. The organization is found from the verified work email domain without revealing beforehand which domains are customers. Members connect only in the extension with an email code; only administrators sign in on the website and land on `/admin`. A self-hosted server keeps one organization at its own domain or subdomain and the bootstrap hand-over after registration. R21, R22, the identity sections and P4 below are updated; the [product specification](docs/implementation/PRODUCT-AND-ENROLLMENT-SPEC.md) and [server integration notes](apps/server/API-INTEGRATION.md) have the details.

**Live updates and compact-bar amendment, 22 September 2026:** completed Claude replies must update conversation totals without a page refresh. Keep scenario and midpoint explanations in Details rather than repeated compact-bar labels. Ordinary imported history without live links, including after reinstalling, is not a matching error. Show Matching incomplete in the bar for actual conflicting records, with a reason on hover and keyboard focus. Preserve approximate markers and disclose unverified overlap in Details. See [implementation and verification](docs/release/CLAUDE-LIVE-UPDATES-2026-09-22.md).

**EcoLogits primary-method amendment, 22 September 2026:** EcoLogits is the default and only selectable product engine in all current browser builds. Migrate saved Original preferences to the current build default, preserving observations, admitted in-flight identities and historical results. Retain the earlier project-developed method in the [research archive](docs/research/archive/original-method/README.md), with its source, research and reproducibility evidence preserved in place. This supersedes earlier requirements for an active Original engine choice, Original-default distributions and automatic Original fallback; legacy schemas, historical calculations and explicit research comparisons remain supported.

**EcoLogits water display amendment, 16 September 2026:** the owner requires displaying the midpoint of EcoLogits WCF, (minimum + maximum) / 2, as water consumption. Remove adapter-side direct/electricity-supply water recalculations and the forced unavailable total. Policy `upstream-wcf-1` creates a new method identity for recalculation while preserving saved originals. Retain upstream ranges and genuine missing-input/error states. Do not add water-source category labels to the EcoLogits display. This supersedes earlier EcoLogits water-total compatibility gates; the Original engine remains unchanged.

**Timing implementation authorization, 15 September 2026:** implement live and historical timing, exact live/history reconciliation and independent verification under the [current timing plan](docs/implementation/TIMING-AND-RECONCILIATION-PLAN.md). The owner explicitly permits dropping obsolete pre-production usage data and schema support. Observation, usage-batch and history families use only `2.0.0`; this replaces earlier requirements to preserve old observation schemas. Keep authentication, settings, deletion protection, both calculation engines and EcoLogits attribution. No deployment or push is authorized by this amendment.

**Refinement implementation authorization, 14 September 2026 UTC:** the owner authorized implementing the full modular/EcoLogits refinement, delegated work and independent verification in this checkout, with no push to main. Work is on `codex/modular-ecologits-refinement`; see [current implementation and verification](docs/release/MODULAR-REFINEMENT-STATUS.md). The planning-only status in earlier dated amendments is historical. Completion requires the full applicable acceptance evidence, not merely passing the first implementation slice.

**Modular architecture and parallel-engine planning, 14 September 2026:** the owner requested a thorough implementation plan for preserving the current estimator, adding a verified TypeScript port of EcoLogits, and restructuring module boundaries for future capture/counting/storage and organization-server changes. Read the [modular extension and EcoLogits plan](docs/implementation/MODULAR-EXTENSION-ECOLOGITS-PLAN.md) and its [acceptance matrix](docs/implementation/MODULAR-EXTENSION-ECOLOGITS-ACCEPTANCE.md) before that implementation. Confirmed behavior includes a developer default with an Advanced settings user override, automatic recalculation into a new default view while retaining originals, and configurable same-provider flagship or original-engine fallback. The remote estimation API remains future scope. These documents are a plan, not a claim that the refactor or port has been implemented.

**Upstream maintenance and attribution amendment, 14 September 2026:** the owner also requires reuse of EcoLogits' current and future model library, repeatable adoption of new releases, and proper credit/license compliance. The [maintenance specification](docs/implementation/ECOLOGITS-UPSTREAM-MAINTENANCE.md) adds deterministic catalog imports, staged update/verify/adopt tooling, separate local overlays, candidate Python parity and corresponding source/notice/citation release gates. Formula changes still require focused port updates; catalog-compatible changes should not require handwritten estimator/UI/storage edits.

**Implementation authorization, 10 September 2026:** the owner requested the complete production application and authorized delegated implementation and local verification. The [confirmed release decisions](docs/decisions/2026-09-10-release-decisions.md) finalize IP retention (superseded on 18 October 2026: connection IP addresses are no longer collected), hosted free-capacity semantics, domain reuse, copyright and contact details. They supersede older statements below that those choices await the owner. The original design canvas remains preserved as reference and review history. Implementation progress and executed evidence are tracked in [the release record](docs/release/IMPLEMENTATION-STATUS.md).

**Historical conversation amendment, 14 September 2026:** the owner requested counting of previously untracked conversations as their messages load and approved keeping older imported numeric history. The [history decision](docs/decisions/2026-09-14-historical-conversation-counting.md) adds a separate versioned numeric family with scoped identities, source dates, partial estimates, deduplication and erasure protection. It supersedes the former exclusion of historical imports. Personal records are not backfilled on Connect; text remains local. Live activity and earlier visible history retain distinct stored evidence. The later compact-presentation amendment in that decision defines a combined provisional extension summary, with visible matching uncertainty and unchanged underlying records. [Observed provider evidence](docs/release/HISTORICAL-CONVERSATION-EVIDENCE-2026-09-14.md) and executed verification must accompany this feature before release.

**Plan date:** 7 September 2026; product/authentication reconciliation: 9 September 2026. **Deliverable:** an implementation specification, not implemented software. **Primary release criterion:** no detected measurement, storage, synchronization, authorization, or aggregation failure may be silently converted into a plausible successful result.

Read this document first, then [data and API contracts](docs/implementation/CONTRACTS.md), [acceptance tests and failure handling](docs/implementation/ACCEPTANCE-AND-FAILURES.md), and [open-source delivery and reuse rules](docs/implementation/OPEN-SOURCE-AND-REUSE.md). These documents form one plan. A phase is complete only when its exit criteria and referenced tests pass.

The [implementer handoff](IMPLEMENTER-HANDOFF.md) gives the reading order, current evidence, remaining owner inputs and completion requirements. The [product, hosting and enrollment specification](docs/implementation/PRODUCT-AND-ENROLLMENT-SPEC.md) is normative for personal mode, hosted organizations, email identity, connection handoff, operator entitlements and deployment-specific retention. The legacy invitation/recovery-phrase flow has been replaced in the contracts below, not left as an alternative onboarding implementation.

The [research documentation index](docs/research/README.md) connects the original research and its corrections, live browser evidence, source audits, exact numerical inputs, rejected alternatives and the rationale for retaining or replacing each method. Use that evidence chain when changing a scientific assumption; an older unqualified claim must not override a later checked correction.

## Confirmed amendment: methodology, model fallback and images (9 September 2026)

The [Offset comparison](docs/research/OFFSET-COMPARISON-2026-09-09.md) adds the normative [methodology quality gates](docs/implementation/METHODOLOGY-QUALITY-GATES.md). Keep the existing numerical reference coefficients; do not import Offset's disputed per-tool factors. The new [published-reference evidence catalog](registry/published-reference-evidence-2026-09-09.json) is explicitly excluded from automatic runtime selection. P0/P3/P6/P7/P8/P10/P11 must enforce evidence classification, factor populations/dates/denominators, gas and water-source boundaries, measured validation before calibrated claims, and the distinction between allocated footprint and avoided impact. Reproducibility is not proof of physical accuracy.

The [methodology and multimodal specification](docs/implementation/METHODOLOGY-AND-MULTIMODAL-SPEC.md) is normative for P0/P1/P3/P5/P6/P7/P8/P10/P11. It supplies exact equations, versioned reference inputs, observation-schema changes, selection rules and 32 additional production acceptance gates. The [full reading page](design-canvas/methodology.html) and editable canvas P02 share [one authored article](docs/methodology/content.html); rebuild both with `node tools/build-methodology.cjs` and reject drift with `--check`.

**Use the highest comparable estimate when a model has no applicable profile.** Evaluate every eligible member of the pinned, modality-compatible cohort on the same observed workload and coherent environmental scenario. Select by electricity and retain that candidate's complete vector, provenance and coverage. Keep the real observed model separate from the selected proxy. This is a conservative choice within a finite reference set, not a guaranteed physical upper bound. No eligible comparator means a clearly labeled reference-only/unavailable component, never a fabricated value or zero. Missing hidden reasoning alone does not suppress an otherwise useful scoped estimate.

**Image generation and image edits are first-release scope**, alongside text, thinking, search and image/document uploads, where each website and plan actually provides those features. Track generation operations and output identities, not image downloads or thumbnails. Image-energy profiles are separate from text-token profiles. Each generated image is estimated at 2.907 Wh of IT energy (Luccioni, Jernite and Strubell, ACM FAccT 2024) times the provider PUE (3 October 2026). The ML.ENERGY Leaderboard (Chung et al., NeurIPS Datasets and Benchmarks 2025) is cited in the methodology as an external comparison only; its 208 image figures, once bundled as a reference outside the totals, were removed on 20 October 2026 because the ML.ENERGY leaderboard repository it came from has no licence (owner decision of 20 October 2026). A zero delivered-image count after execution is not evidence of zero energy.

The [dated model inventory](docs/implementation/MODEL-CATALOG-2026-09-09.md) and [machine-readable catalog](registry/model-catalog-2026-09-09.json) contain 67 model, router and mode records, with account/plan and source qualifications. Recognition is not tokenizer validation or energy calibration. The [four text reference profiles](registry/text-reference-profiles-2026-09-09.json) and image cohort are reproducible reference scenarios, not measurements of today's closed consumer models. Recheck models and available workflows before release. The EcoLogits output-token-based baseline has no explicit input-length term; do not present it as a validated long-context or complete hidden-reasoning estimator.

## Observed browser protocols: 9 September 2026

Read the [four-site live browser audit](docs/implementation/LIVE-BROWSER-AUDIT-2026-09-09.md) before implementing P1/P3/P5. It records 23 authorized synthetic actions in the Codex in-app browser, provider routes and payload shapes, reasoning/search/stop behavior, Unicode traps and explicit capture gaps. The [reduced reference fixtures](fixtures/browser-audit-2026-09-09/README.md) have 32 passing offline checks. These are research examples, not production adapters, tokenizer calibration or Chrome/Edge/Firefox release evidence.

Observed prompt/answer text can support useful local counts and scoped resource estimates. No inspected sample exposed a verified complete numerical input/output usage report. Preserve the distinction between observed text, reconstructed context, hidden work and physical resource estimates. Missing hidden reasoning alone is normal estimated coverage, not a broken extension. Unknown schemas, lost captures and incompatible factors remain visible failures for the affected component.

## Confirmed amendment: writing and code quality (9 September 2026)

Follow [writing, shared-code and performance standards](docs/implementation/WRITING-AND-CODE-STANDARDS.md) for all implementation work. Use natural, plain interface text and useful code comments without em dashes. Reuse small shared modules and existing components where their behavior matches; avoid unnecessary globals, duplication and abstractions. Keep measurement/privacy disclosures and enforce the existing cross-browser performance and noninterference gates. Shorter code is not a substitute for correctness or measured performance.

## Confirmed amendment: easy formula updates (9 September 2026)

Keep calculation methods replaceable without rewriting provider adapters, conversation totals, dashboards or server controllers. Here, "global" means one shared, explicitly imported calculation interface and immutable, versioned coefficient/profile files, not mutable browser globals. Store each source number once with its unit, scope and provenance. Keep each equation in a small pure method module under the estimator package. All callers consume the same structured result contract, including missing components and assumptions.

A coefficient-only update should change its reviewed data record, method version, affected expected results and source documentation, not application call sites. A new equation should normally change only its method module, method registration/validation and the Python reference required by the current cross-runtime design, plus its tests and documentation. Shared numeric fixtures must prove TypeScript/Python parity. If new observations or result fields are genuinely required, make that an explicit schema change rather than hide it in unrelated code. Minimize the change surface, but do not promise a fixed line count or compress scientific logic to meet one.

Existing signed data-only updates may select only supported method IDs and schema-valid coefficients. Never evaluate downloaded formula strings or executable code. A new executable method requires a normal packaged software release. Preserve old bundles and original historical results; a new formula creates a separately labeled recalculation view. Bound any calculation cache and include method hash, input revision and scenario in its key. P0/P6/P7/P8 must satisfy MU01-MU06 in the acceptance plan.

The [context-aware energy research](docs/research/CONTEXT-AWARE-ENERGY-RESEARCH-2026-09-09.md) compares published input/output, cache and throughput methods. It retains the existing numerical reference settings: credible studies were found, but a transferable numerical improvement for the four consumer services was not established. The small SweetSpot fixture is research-only and must not enter automatic runtime selection. P6 should use suitable public measurements and CPU-only reanalysis; no paid hardware experiments, paid generation or paid data purchases are authorized. An artifact access gate or missing raw measurements does not permit a fabricated calibration result. Rough reference estimates can remain useful with their unvalidated scope disclosed.

## Confirmed amendment: Fern brand and two organization roles (8 September 2026)

Lock **Resource Gauge + Fern**: primary `#3D7542`, ink `#203524`, soft `#E1EEDB`, canvas `#F7F9F2`. Use one AI Footprint Tracker brand across company pages, without company-specific branding. The in-chat bar has no logo and adapts to the AI host's light/dark theme.

Use exactly two organization roles, `user` and `admin`. Multiple admins may promote/demote existing verified users within their organization through the admin panel. Protect the last active admin, audit changes and revoke demoted users' privileged access across sessions. Organization authentication is **Brevo email OTP only**: administrators sign in on the website and land on `/admin`, members verify their work email with a code in the extension (13 October 2026); no extra password/MFA factor is required. The platform-owner panel is separate from organization membership roles.

See [locked brand, roles and design handoff](docs/implementation/BRAND-ROLES-AND-DESIGN-HANDOFF.md) for permission rules, current identity and hosted-address decisions, planned checks and the all-screen design-canvas inventory. That document supersedes older conflicting role/authentication wording. The [editable design canvas](design-canvas/README.md) now contains 88 draft screen/state specimens with local comments and portable review exports, including new C13 fallback and C14 image-reference details. Review and approve these designs before product implementation; prototype completion is not product completion.

## Confirmed amendment: Brevo OTP delivery (8 September 2026)

**Brevo is the selected provider for organization authentication OTP emails.** Follow the [Brevo privacy-first setup and release checklist](docs/implementation/BREVO-PRIVACY-SETUP.md). This is a recorded decision and setup specification, not a claim that account configuration or integration has been completed.

This amendment overrides earlier blanket prohibitions on collecting email addresses only for the organization authentication boundary: collect and verify work emails there, keep authentication identity separate from numerical usage records, and do not send usage records or chat content to Brevo. Personal mode remains local-only, without email enrollment or Brevo calls. Verifying an administrator's work email is required; customer-domain DNS ownership verification is not required by the user. Mailbox verification alone does not prove authority to represent a company.

The Brevo target is one-month transactional-log retention for all senders, no stored previews, no recipient open/click tracking for OTPs, minimal message data, and restricted administrative access. Brevo's one-month retention is unrelated to the hosted product's six-month usage-retention policy. The guide records dated observations, outstanding manual settings, backend requirements and mandatory delivery/privacy tests. The product/enrollment specification and revised Contracts now define the hosted-auth design. Account setup, actual delivery and production authentication remain unimplemented/unverified.

## 1. Settled requirements and decisions

### 1.1 User-confirmed scope

| ID | Requirement |
| --- | --- |
| R01 | Desktop extension for Google Chrome, Microsoft Edge and Mozilla Firefox, supporting ChatGPT, Claude, Gemini and Perplexity consumer websites in each browser. Developer API usage is not the runtime product. |
| R02 | Display conversation tokens in/out, estimated electricity, carbon and water beneath the composer. Carbon's CO2 or CO2e label follows the source's actual scope. |
| R03 | Clicking the extension in Chrome, Edge or Firefox opens a dashboard with exactly two primary tabs: **My usage** and **Company**. |
| R04 | My usage aggregates across all supported tools, with optional tool and observed-model breakdowns; support week, month, custom dates and all recorded time. |
| R05 | Company shows permitted company-wide aggregates. Detailed adoption analytics are admin-only (since the owner decision of 17 and 18 October 2026 as organization aggregates only: administrators never see employee-level activity, and IP observations are not collected), accessed through a separately shared admin web address. No administration link/control appears in the extension, including for admins. |
| R06 | Self-hosted usage remains until admin deletion by default. Hosted free live request families are also kept until admin deletion (owner decision of 11 October 2026); an administrator's shorter choice or a configured plan maximum applies as a rolling calendar-month window. Imported numeric history has a separate until-deletion policy, including older source dates. Apply the appropriate policy to records and derived totals, separately from IP and mail retention. |
| R07 | Keep verified work email linked to a stable tenant-scoped user ID. Signing in with that same canonical email pairs Chrome, Edge, Firefox and multiple machines to one user with separate installations. Ordinary employee names and AI-account identities are not collected; registrant company/contact details stay in registration. |
| R08 | Track all supported AI use in an enrolled browser profile. Company policy can disable the extension's pause control. |
| R09 | Design and test for up to 500 pseudonymous users per company; one company per self-hosted installation. |
| R10 | First release includes text, visible thinking, web search, image/document uploads and image generation/editing where the website exposes those workflows; explicitly identify unobserved or unsupported components. |
| R11 | Headline resource boundary is conversation operation. Exclude model training and hardware manufacturing, and disclose workstation/network exclusions. |
| R12 | No prompts, answers, thinking text, retrieved passages, document contents, filenames or chat titles are transmitted to the company backend. |
| R13 | **Superseded by the owner decision of 17 and 18 October 2026:** by default connection IP addresses are not collected and there is no admin Network page, and addresses stored before then are shown to no one until a one-off purge deletes them; the operator setting `ip_collection_enabled` brings the collection back (see [CONTRACTS section 8](docs/implementation/CONTRACTS.md#8-administrator-views-and-network-observations)). Original requirement, kept for reference: Collect the connection IP observable by the company backend for admin analytics. IP is a network observation, not a person identifier or AI inference-location signal. |
| R14 | Entire extension, backend, calculation implementation, schemas, tests and deployment instructions must be open source. Use MIT for original project code; preserve third-party licenses/notices and satisfy the open-source delivery checklist. |
| R15 | Match each host's palette, typography and light/dark appearance without interfering with chat controls. |
| R16 | Warn nonblockingly when estimated active conversation context exceeds 50% of the selected capacity/budget. Prefer the provider's official conversation limit; otherwise use a documented conservative advisory budget and visibly explain its basis. |
| R17 | Help users understand and potentially reduce their AI footprint through optional, evidence-aware guidance; never promise unverified environmental savings. |
| R18 | The extension is informational only and must preserve the AI tool's behavior. No prompt edits, automatic actions, blocked controls, focus stealing or interference with sending, streaming, uploads, tools or navigation. |
| R19 | Publish equations, units, source links, factor provenance and a reproducible worked example. For unrecognized models use the highest eligible comparable estimate, label the proxy and assumptions, and never imply exact physical measurement or a guaranteed upper bound. |
| R20 | Personal installations require no account and keep usage local. Two popup tabs remain, with a local not-connected Company state and no background product-server traffic. Connecting never backfills personal history. |
| R21 | Public branded website links methodology, privacy, real source/downloads and self-host instructions. Hosted registration verifies the registering admin's work mailbox, not customer DNS ownership. Since 13 October 2026 every hosted organization is served at the one address `https://aifootprinttracker.com`, registration asks for no organization address, and the organization is found from the work email domain. |
| R22 | Brevo email codes serve both roles: administrators sign in on the website and land on `/admin`; members connect only in the extension with an email code (13 October 2026). Installation-bound connection joins the same user across browsers without a shared package credential or required recovery phrase. |
| R23 | Exactly two organization roles, user/admin, with multiple equal admins, audited role changes and atomic last-admin protection. No admin link in the extension. |
| R24 | Hosted configurable free/paid entitlements and retention; separate protected platform-operator panel can configure plans and grant free exceptions. Entire original website/operator/server/extension code remains MIT and self-hostable. |

### 1.2 Remaining owner decisions and launch configuration

Three owner decisions are pending: IP-history duration; whether the hosted free 50-person rule means enrolled memberships or total workforce; and whether one work domain may have several hosted organizations. The [decision table](docs/implementation/PRODUCT-AND-ENROLLMENT-SPEC.md#2-confirmed-decisions-and-remaining-owner-choices) records provisional development fixtures, not silently approved production defaults. Coding the modular paths can proceed; affected public enrollment/pricing/IP collection requires the owner's final choices. Paid prices/payment provider, real distribution links, copyright holder, operator contacts and deployment secrets remain explicit launch inputs. No paid experiment, subscription upgrade, billing integration, domain purchase or deployment is authorized by this plan.

### 1.3 Engineering choices made by this plan

- WXT + TypeScript + React for the extension and shared UI. Use CSS modules/custom properties; no runtime-loaded scripts or styles from a CDN.
- Python FastAPI + Pydantic, SQLAlchemy and Alembic for the server. PostgreSQL is the production database; SQLite is not a production substitute.
- Reuse EcoLogits **core** as a pinned operational-estimate baseline. Do not fork its separate AGPL server by accident. Original project code uses MIT. Third-party dependencies and copied/derived source retain their applicable licenses, including MPL-2.0 portions; do not relabel them MIT.
- A dedicated tokenizer worker runs through a browser-platform abstraction. Use the Chromium offscreen/service-worker design only where verified for the target Chrome/Edge release; provide a Firefox-compatible background/worker host. The logical background coordinator owns durable state and synchronization on all browsers. No raw text is written to durable storage.
- Self-host mode has one company per server; hosted mode supports multiple isolated organizations. Every business record, job, cache, query and credential carries validated tenant scope. Do not infer tenant solely from a supplied body or untrusted host header.
- One browser profile has at most one active company enrollment. Company switching is an explicit disconnect/enroll operation; old queued data is never reassigned.
- For enrolled users, the server is authoritative for cross-installation My usage and company totals. The extension is authoritative for unsynced local observations. Display these separately until reconciliation; never add two whole totals together. Personal-only My usage is entirely local and does not create a network outbox.
- No silent fallback from a validated tokenizer/model to a heuristic or from an unavailable resource factor to zero.
- An observed model family such as Llama is a breakdown dimension, not a fifth website. Standalone Llama hosting and additional providers require later adapters.

### 1.4 Honest accuracy contract

Full cloud request usage and physical energy are not always observable from a consumer browser. The extension must expose three independent properties: **how a number was obtained**, **what it includes**, and **whether tracking is working**. An officially tokenized visible answer can be accurate for that text while the full request remains partly observed. An energy result remains an estimate even when a provider reports exact request-token counts.

“No silent errors” means every detected failure is surfaced and retained, not that a disabled/uninstalled extension can observe unknown activity. Missing traffic or provider-internal computation must be marked unobservable. Absence of events is never proof that an employee did not use AI.

### 1.5 Browser support and cross-browser identity

Chrome, Edge and Firefox are first-release targets, not inferred compatibility claims. Maintain one shared measurement/accounting core with browser-specific manifests, lifecycle hosts, permission handling, capture injection and distribution packages. Phase 0 must verify the minimum versions and supported desktop operating systems for each target. Test the actual browser binaries; passing a generic Chromium test does not prove Edge or Firefox support. No Safari, other-browser or mobile support is implied.

Every ordinary installation starts local-only. Connect to an organization uses the hosted address (or a self-hosted server's own address), a work email verified with an email code in the extension, the organization's disclosure and installation-bound handoff. The same canonical email in that tenant retrieves the same user automatically after verification; no separate Create ID versus pairing-phrase choice is required. Chrome and Edge on one laptop plus Firefox on another computer produce **one user ID and three enrolled installations**, with combined My usage. This does not prove three physical devices. Never merge using IP addresses, browser fingerprints, AI-provider logins or an email shared across different tenants. See the product specification for lost-device/reinstall, disconnect and old personal-history boundaries.

Release matrix: three browsers × four AI websites, with basic text capture verified in all twelve combinations and every additional requested mode classified. A browser-specific gap must remain visible and cannot be concealed by a passing Chrome test. Cross-browser tests B01-B08 are mandatory.

## 2. Research decisions carried forward

Current implementation requirements come from the latest confirmed user decisions and the reconciled normative documents linked above. Scientific conclusions follow the dated [research index](docs/research/README.md), including the latest context-energy conclusion and Offset source corrections. The [verified original review summary](research/verified-review-summary.md), [Fable correction addendum](research/claude-audit-corrections.md) and [original research](research/report-source.md) remain historical evidence, not an override of later checked findings. Read the [first Fable audit](research/claude-independent-audit.md) only with its corrections. Rejected claims must not re-enter through a copied table.

| Evidence | Implementation consequence |
| --- | --- |
| OpenAI publishes explicit encoding mappings | Use matching assets for verified model IDs; unsupported model IDs stay unverified. |
| Google publishes LocalTokenizer mappings/assets for selected Gemini models | Build and test a browser-compatible implementation against the official reference; pin the exact artifact revision and hash. |
| Anthropic's old tokenizer is inaccurate for Claude 3+ | Compare substitutes using a synthetic corpus and the free model-specific counting endpoint during development. No claimed universal closest tokenizer. |
| Newer Claude tokenizer generations differ; thinking-context rules also vary | Registry entries include tokenizer generation and verified thinking-context semantics, not one generic Claude multiplier. |
| Some consumer response schemas are now observed in the dated live audit | Use the captured mode-specific evidence and reduced fixtures; complete full-shape and packaged-browser validation before promoting production support. |
| Existing counters have heuristics, exclusions and bookkeeping limitations | Start a clean shell. Borrow narrow attributed capture/UI ideas, particularly from Claude Counter. |
| EcoLogits omits explicit input-token modeling in the inspected kernel | Test long-context workloads separately; compare a two-phase candidate before replacing the baseline. |
| CDP improves development capture but has limits | Use an isolated development recorder with completeness checks, never the debugger permission in the employee build. |
| Offset AI has unsupported citations and boundary problems | Do not copy its per-query constants or compound PUE/WUE application. |
| ML.ENERGY v3 and the referenced Gemma4 model card declare Apache-2.0 | Record exact asset licenses; ML.ENERGY file-access gating remains a separate condition. |
| Mistral's disclosed inference figure includes upstream impacts | Keep it as a dated reference; do not assume training amortization or use it as an operational-only default. |
| Perplexity migration is documented but the claimed deadline was not reproduced | Version the actual endpoint/model used for calibration; do not plan around the unconfirmed date. |

Primary anchors: [OpenAI model mapping](https://github.com/openai/tiktoken/blob/main/tiktoken/model.py), [Google tokenizer loader](https://github.com/googleapis/python-genai/blob/main/google/genai/_local_tokenizer_loader.py), [Anthropic counting](https://platform.claude.com/docs/en/build-with-claude/token-counting), [EcoLogits kernel](https://github.com/mlco2/ecologits/blob/main/ecologits/impacts/llm.py), [original water framework](https://arxiv.org/html/2304.03271v5), [ML.ENERGY dataset](https://huggingface.co/datasets/ml-energy/benchmark-v3). Recheck rapidly changing model mappings when the release is built.

## 3. User experience and metric definitions

### 3.1 Conversation bar

**Details interaction:** user clicks Details to open a dismissible, host-themed nonmodal overlay above the bar on the same page. Do not open a new browser tab or navigate away. Keep the conversation and composer usable; provide close, Back to chat, Escape and outside-click dismissal. Follow the overlay requirements in the brand/design handoff. Canvas screen C09 remains a content reference; the host mockups demonstrate the actual overlay interaction.

Display, in order: **Requests | Input tokens | Output tokens | Electricity | Carbon | Water | Details**. The carbon unit is CO2 or CO2e according to the accepted profile, not a hardcoded equivalence. Each resource metric carries an estimate marker. A compact status indicator separately shows Recorded, Processing, Updating, Waiting to sync, or Tracking problem. Tracking problem appears only while a problem is current and clears when capture recovers; earlier problems stay in Details. A partial measurement is ordinary uncertainty: Details says "Partly measured" and lists what was not read, and the bar never shows it as a status (owner decision, 2 October 2026). Input tokens add the new input text, tool results read as input and uploaded images; output tokens are the output total (answer, visible thinking, tool input and other generated text).

- Draft text is a token preview and never enters consumption totals.
- The bar represents recorded generation activity for that conversation since tracking began, including regenerated/abandoned branches. It is not merely the current visible branch's text size.
- Details distinguish new prompt text, logical input/context, visible answer, visible thinking summary, reported reasoning and cached input.
- If some components are unknown, display the known subtotal with its scope, or a dash if no meaningful subtotal exists. Never label a partial subtotal the complete resource total.
- Reloading or opening an old conversation shows existing recorded activity and can extend its separate imported visible-history records. Deduplicated loaded-prompt/response counts and supported token/resource estimates increase as earlier messages become available. Show Partially calculated and a reviewed first-available-request indicator. Loading history never fabricates a live dispatch or observed execution.

### 3.2 Toolbar dashboard

Use a browser-platform action popup with a 760 x 580 CSS-pixel design target, internal scrolling and responsive small-screen fallback. Chrome limits action popups to 800 x 600; verify Edge/Firefox limits and manifest behavior independently and adapt dimensions while preserving both tabs. Do not depend on an action click event firing when a default popup is configured. An optional Expand control opens the same dashboard as an extension page, retaining the two tabs. [Chrome action documentation](https://developer.chrome.com/docs/extensions/reference/api/action).

**My usage:** default current calendar month in company timezone; period selector offers this week, this month, last month, custom range and all recorded time. Show requests, input/output tokens, energy, carbon and direct-plus-upstream water; breakdown by website, then observed model where known. Display quality coverage, pending local records and last server update. Paired devices contribute to the same server total. Offline mode shows the current profile's local total and a separately labeled cached server snapshot.

**Company:** same periods and resource units; aggregate totals and platform shares, reporting coverage and update time. No user IDs, device IDs or IP information in ordinary-member responses. Member company reporting uses daily-or-coarser buckets. Owner decision, 13 October 2026: while sharing is on, members see these totals and breakdowns whatever the group size (the earlier five-person suppression is removed), so a small team's totals can reveal one person's usage; turning sharing off hides them, and admin views remain available (as organization aggregates only since 18 October 2026, see 3.3). Settings/disclosure appears as a dialog, not a third primary tab.

There is **no administration link, button, menu item or admin-login flow in the extension**, even for an admin using it. The company distributes the separate admin web address directly to authorized administrators. They authenticate in that web application. The address may use the same hosting service as ingestion, but knowing or discovering the address grants no access: server-side admin authentication/authorization remain mandatory. This separation is a navigation requirement, not security through an undiscoverable URL. The monthly summary appears inside the user-opened dashboard or as a compact inline bar notice on first supported-site activity after a month ends, at most once per profile/company/month; never as an unsolicited overlay. The relevant browser being closed postpones it.

### 3.3 Admin analytics

**Owner decision of 17 and 18 October 2026:** administrators see organization totals and aggregate figures only, never usage next to a name, email, member id or browser and never a request list per person; the server enforces this. Aggregates are shown for any number of people, so in a very small organization they can reveal one person's usage. The People, Activity and Health pages show organization counts, the member list serves access management only, exports are organization summaries, recalculations are organization-wide, and there is no Network page because connection IP addresses are no longer collected. The earlier behaviour stays in the code behind operator settings that are off by default (`person_analytics_enabled`, `ip_collection_enabled`; CONTRACTS section 8). [CONTRACTS section 8](docs/implementation/CONTRACTS.md#8-administrator-views-and-network-observations) is authoritative. The page list, the user and device filters and the connection IP label below record the earlier design.

Provide Overview, Users, Tools/models, Network observations, Tracking health, Policies, Exports and Audit log pages. Filters include date range, website, observed model, pseudonymous user and device where permitted.

Define labels exactly:

- **User requests:** observed user-initiated send/regenerate/continue actions that dispatched a generation request, including failed/cancelled attempts; show completion outcomes separately.
- **Observed generation attempts:** attempts with verified generation evidence; these may exceed user requests. Dispatch-only/unconfirmed transport attempts are shown separately. A replay/reconnect or rejected dispatch is not automatically a generation execution.
- **Search operations:** separately observed retrieval operations; do not fold them into user request count.
- **Registered user IDs:** current non-deleted pseudonymous memberships, not verified unique human employees.
- **Active user IDs:** distinct pseudonymous users with at least one recorded user request in the selected occurrence-time window.
- **Active installations:** distinct enrolled profiles producing those requests. Unpaired profiles may represent the same person.
- **Reporting installations:** profiles with recent heartbeat; not proof of AI activity. Profiles may stop reporting because their browser is closed, tracking is disabled, or connectivity is lost.
- **AI-reporting connection IPs:** distinct addresses observed by the company server on ingestion of AI records, grouped by upload time. Never relabel this as number of people or precise source IP of past offline AI requests.

Procurement views show adoption, repeat usage, request outcomes, tool shares, quality coverage and changes over time. Do not infer task quality, license needs, monetary savings or environmentally superior models from token counts alone. Manual licensed-seat/headcount inputs can be added as clearly labeled administrator data; they are not inferred from IPs.

### 3.4 Footprint helper and context warning

The information bar includes a compact context indicator and optional guidance. This is active-context guidance, not the cumulative tokens spent over all conversation turns and not a subscription/rate-limit meter.

Use the provider's exposed, verified conversation limit when available. Otherwise use a versioned conservative advisory budget from the reviewed model/family registry or an explicitly configured company guidance budget. Show whether the denominator is an official application limit, a published model reference or an advisory budget, with source/date/assumptions in Details. Do not invent an official limit or describe an advisory budget as guaranteed actual capacity. Missing valid budget/configuration yields unavailable percentage plus general tips, not a hidden numeric fallback.

When the estimated ratio exceeds 50%, display a prominent but nonblocking dismissible banner directly above the chat input: **Long chat · for a new topic, consider a fresh conversation.** Its Details button opens an in-page overlay with a labeled context progress bar, token estimate, selected limit/advisory budget and uncertainty disclosure. Keep the long basis explanation inside Details, not on the information bar. See [consumer-app evidence and adapter rules](docs/implementation/CONTEXT-GUIDANCE.md). Do not say the model's limit has been exceeded. Never automatically start a chat, discard context, summarize through another model, modify a prompt or send a request. A summary or repeated explanations can themselves add work.

Provide short rule-based tips on relevant context, suitable answer length and avoiding unnecessary document content. No remote prompt optimizer, quantified saving, guilt message or employee environmental ranking. Users can dismiss/snooze advice independently of whether company tracking can be paused. The extension must not optimize on their behalf. C01-C08 verify threshold/basis behavior; H01-H06 verify host noninterference.

### 3.5 Informational-only integration

Automatically added website UI is limited to the compact bottom information bar/statuses and the user-approved nonblocking above-composer long-chat banner. Extra details open only on an explicit user action. No unsolicited modal, floating notification over chat controls, audio, OS notification or focus change. Do not alter site prompts, messages, model choices, files, request/response data, shortcuts or navigation. The extension overlay/dashboard opens only when the user explicitly requests it.

Capture hooks pass through original requests immediately and never await counting, estimates or company-server availability. If a capture/UI mechanism conflicts with the website, disable that mechanism, leave the website usable and report lost measurement through the extension badge/dashboard; do not keep a broken hook for the sake of complete metrics. Zero computational overhead is not promised: measure and bound the overhead, and block release when required host functions regress. Verification compares identical workflows with the extension enabled and disabled in all twelve browser/site combinations.

## 4. Architecture and ownership map

```text
Supported AI site
  browser-compatible page observation bridge
      -> isolated provider adapter / composer UI
      -> tokenizer worker in browser-specific extension host
      -> background-coordinator ledger and outbox
             -> local conversation bar + toolbar dashboard
             -> authenticated HTTPS ingestion
Company server
  authenticate -> validate -> deduplicate -> calculate -> commit
      -> PostgreSQL observations / estimates / aggregates
      -> personal + member-company APIs
      -> admin-only organization aggregates + audit log (network observations removed on 18 October 2026)
```

Create these modules in Phase 0; paths below are planned ownership boundaries, not files already implemented:

| Owner | Paths | Responsibility |
| --- | --- | --- |
| Extension platform implementer | `apps/extension/entrypoints/`, `apps/extension/src/platform/{chromium,firefox}/` | Browser-specific manifests/lifecycle, worker hosts, permissions, messages, cross-browser enrollment |
| Capture implementer | `packages/capture-core/`, `packages/adapters/{chatgpt,claude,gemini,perplexity}/` | Protocol parsing, state transitions, model identification, capture quality |
| Measurement implementer | `packages/tokenizers/`, `packages/estimator/`, `registry/`, `calibration/` | Tokenizer assets, reference parity, estimator data, calibration artifacts |
| Data/sync implementer | `packages/ledger/`, `packages/contracts/`, `apps/extension/src/sync/` | IndexedDB, revisions, outbox, acknowledgement reconciliation |
| Backend implementer | `apps/server/app/{auth,organizations,entitlements,operator,ingestion,estimates,aggregates,admin,privacy}/`, `apps/server/migrations/` | Hosted/single-tenant modes, registration, credentials, roles, plans, IP, retention/deletion |
| UI implementer | `packages/ui/`, `apps/extension/src/ui/`, `apps/web/`, `apps/admin/`, `apps/operator/` | Public and registration pages, extension Connect flow, composer bar, two-tab dashboard, host themes, admin and isolated operator web surfaces |
| Verification/release implementer | `tests/`, `tools/dev-recorder/`, `deploy/`, `docs/` | Fixtures, tests, fault injection, CI, deployment, release provenance |

Do not let multiple implementers edit the same contract concurrently. The contract owner publishes a version change before consumers implement it. Interface changes require corresponding fixtures and migration notes.

## 5. Phase order and dependency gates

| Phase | Deliverable | Depends on |
| --- | --- | --- |
| P0 | Repository, frozen decisions, contracts and build/release foundations | This plan |
| P1 | Four-site capture evidence and supported-mode matrix | P0 |
| P2 | Local ledger and explicit failure-state core | P0; P1 informs adapter events |
| P3 | Tokenizer registry, browser execution and calibration | P0, relevant P1 model evidence |
| P4 | Organization registration, Brevo OTP, same-email identity, installation handoff and backend storage | P0 |
| P5 | Four production adapters and conversation accounting | P1, P2, P3 |
| P6 | Versioned operational resource estimator | P3; can benchmark data in parallel with P4/P5 |
| P7 | Durable synchronization and exact aggregate bookkeeping | P2, P4, P6; P5 supplies end-to-end events |
| P8 | Public/download/registration website, extension Connect flow, conversation bar and two-tab local/enrolled dashboard | P4-P7; UI fixtures can start earlier |
| P9 | Admin analytics, IP views, policies/deletion, hosted entitlements and separate operator panel | P4, P7 |
| P10 | Fault injection, security, privacy and capacity verification | P5-P9 |
| P11 | Employee pilot, hosted release configuration, self-hosted packaging and complete open-source release | P10 |

Parallel work is permitted only after shared contracts are stable. P1 is a discovery gate: do not guess private endpoints to make P5 appear ready. Each phase below specifies work, artifacts and an objective exit gate.

## 6. Detailed work packages

### P0. Establish a reproducible foundation

**Tasks**

1. Create a monorepo with pnpm workspaces for TypeScript and a locked Python environment for the server/calibration tools. Pin supported runtime versions and dependency versions in files, not just the README. Resolve actual stable patches during implementation and record the date.
2. Add MIT for original project code with the confirmed copyright holder; implement the [open-source checklist](docs/implementation/OPEN-SOURCE-AND-REUSE.md). Inventory borrowed files, tokenizer assets and datasets with exact upstream revisions, licenses, notices and modifications. Keep EcoLogits MPL notices and applicable source-availability obligations. Exclude noncommercial/source-available components from unrestricted builds. Do not assume all code in an MIT project is automatically MIT.
3. Turn [CONTRACTS.md](docs/implementation/CONTRACTS.md) into versioned schemas and generated TypeScript/Python types. Enable TypeScript strict mode, unknown/error handling rules and Pydantic `extra="forbid"` on server payloads.
4. Create a shared failure-code catalog and a metric provenance enum. Ban `catch { return 0 }`, success-looking fallback DTOs, raw prompt logging and implicit unknown-to-zero conversion through review rules and targeted lint checks.
5. Create CI commands for formatting, lint/typecheck, schema compatibility, unit tests, browser fixtures, backend PostgreSQL tests and package validation. CI makes no paid API calls and uses no employee content.
6. Add configuration validation for personal/hosted/self-hosted mode, canonical HTTPS origins and tenant routing, pause policy, timezone, usage/IP retention, entitlements, accepted methods, trusted proxies and deployment keys. Personal mode does not require server configuration. Invalid required organization settings prevent enrollment visibly, not default enrollment into the wrong company.
7. (IP retention superseded on 18 October 2026: no IP addresses are collected.) Record the remaining IP-retention preference before enrollment release. Document controller contact, data use, retention, deletion and the distinction between pseudonymization and anonymity. IP addresses can be personal data; the company's deployment owner must settle its applicable governance before rollout. [European Commission guidance](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/application-gdpr_en).
8. Add separate Chrome, Edge and Firefox build targets and a capability matrix covering page-world injection, background lifecycle, worker/WASM execution, IndexedDB, scheduling, permission grants, popup behavior and store signing. Verify current official documentation and actual target builds before freezing minimum versions. Prove a Firefox-compatible background host; do not require Chromium's offscreen API or assume an identical service-worker lifecycle there. Record supported desktop OS/browser combinations explicitly.
9. Define the context-limit/advisory-budget registry and guidance-copy contract before UI implementation. Require an explicit source or company policy basis for every fallback; seed supported-model and unknown-model guidance policies through reviewed configuration, not invented private-provider capacities. Add the MIT/community/reuse artifacts and O01-O06 from the open-source checklist.
10. Freeze the product/enrollment state machines and endpoint/schema contracts. Record the three pending owner policies explicitly. Define the public, tenant-admin and platform-operator trust boundaries, local namespace rules, manual entitlement assignment and deployment-specific retention before consumers implement them.
11. Define a reviewed, immutable rough-baseline bundle format with method ID/hash, source coefficients, assumed environment, required observations, eligible modalities/workloads, missing components and evidence labels. Research JSON is not automatically runtime-approved. The initial EcoLogits coefficients remain unchanged; review applicability and qualification, not invented physical calibration.

**Artifacts:** workspace config/lockfiles; source/license inventory; `docs/decisions/`; shared schemas; CI workflows; sample config without real server identifiers or secrets.

**Exit gate:** clean-checkout builds for all three browsers succeed; platform-host feasibility is demonstrated; schema-invalid and unknown-field fixtures fail visibly; no external API credentials are required for CI; no borrowed asset lacks a recorded license. Every R01-R24 requirement has an assigned phase/test. B01-B03 define the browser-platform evidence needed before capture integration proceeds. Pending owner choices are isolated configuration/release gates, not invented approvals.

### P1. Capture evidence before production parsers

**Evidence already available:** the [9 September audit](docs/implementation/LIVE-BROWSER-AUDIT-2026-09-09.md) supplies initial in-app observations for all four sites. It does not close P1. Perplexity cancellation, uploads, compaction, several retry/edit/reload cases and the actual twelve browser/site combinations remain open. Record these gaps explicitly rather than starting from guessed endpoints or treating the reduced corpus as a release certificate.

**Tasks**

1. Build separate development capture tooling: CDP/DevTools for verified Chrome/Edge targets and a verified Firefox-native DevTools/automation capture route for Firefox. Do not assume CDP target attachment works unchanged in Firefox. Attach to relevant page/worker/frame targets where supported and record attachment failures, buffer limits and missing bodies. Employee packages must never include development-debugger privileges. [Chrome debugger](https://developer.chrome.com/docs/extensions/reference/api/debugger).
2. Use synthetic accounts/content where feasible. For each site in each of the three browsers, capture new chat, second turn with context, stop mid-response, regenerate, edit/branch, reload, two tabs, thinking, search, input image, text PDF, scanned PDF, office files and unsupported file behavior. For native image-generation flows, add new image, multiple outputs, edit/inpaint/upscale where available, stop/failure, history/reload, duplicate preview and download cases. Record absence/plan gating separately from failed or unverified capture. Reuse protocol fixtures only after confirming browser parity; record browser/version with every capture.
3. Produce `fixtures/<site>/<mode>/<fixture-id>/` containing redacted request/stream structure, expected textual content, numerical fields, observed model IDs, timestamps, source build information and manually checked expected events. Remove cookies, authorization, session tokens, real user identifiers and document contents unrelated to the synthetic fixture.
4. Create `registry/capabilities.json`: each site/model/mode is `verified`, `experimental`, `unsupported` or `not_observed`, with supported transports, completion evidence, request identity source and known gaps.
5. Validate usage-field meanings individually. A parser accepting `usage.input_tokens` is not proof the website sends that field. Separate provider-reported counts from visible-text counts and quota percentages.
6. Compare recorder output with the rendered page and known synthetic actions. Record any generation not seen by the recorder, rather than treating recorder output as absolute ground truth.

**Provider-specific questions:** ChatGPT message/generation IDs and auto routing; Claude stream/content blocks and thinking context; Gemini framing and worker-originated transport; Perplexity multi-step/search and model identity. No endpoint name is approved merely because another extension's README mentions it.

**Artifacts:** fixture corpus; capability matrix; provider normalization maps; capture-gap report; fixture regeneration instructions.

**Exit gate:** one basic text flow per site/browser combination is evidenced; every requested nonbasic mode has a tested classification and user-facing missing-component behavior. Unavailable access blocks only that mode's promotion, not an invented parser. Record expected failure tests A01-A12 and B03-B04.

### P2. Implement the local ledger and health model

**Tasks**

1. Implement IndexedDB migrations and stores described in Contracts. A background-coordinator transaction creates/updates an observation and its outbox entry atomically, independent of browser host type.
2. Implement user-request and generation-attempt state machines. Record initial dispatch before waiting for tokenization; an attempt skeleton remains dispatch-only until generation evidence exists. Numeric fields may start as unknown. Persist numeric progress checkpoints, never raw text.
3. Assign stable local IDs and monotonically increasing revisions. Distinguish replay from real regeneration; persist deduplication keys before UI updates are declared recorded.
4. Recover unfinished attempts after worker/browser restart as `interrupted_unconfirmed`, keeping known tokens and an incompleteness reason. Reconcile later terminal evidence through a new revision.
5. Add ledger integrity checks: unique IDs, missing parent requests, invalid revision order, invalid quantities and orphaned outbox entries. Surface repairable issues; never clear the database as an automatic recovery strategy.
6. Implement `health_state` with category, first/last occurrence, affected site/period, retry information and user action. Make storage failure visible on the composer bar and toolbar badge even if diagnostics cannot themselves be persisted.

**Artifacts:** `packages/ledger/`; migration fixtures; state-machine unit tests; local diagnostics view; exact-once-accounting fixtures.

**Exit gate:** reload/history does not create usage; true regeneration does; restart preserves acknowledged local data; failed writes are never called successful; no empty catch converts unknown to zero. Tests L01-L12 pass.

### P3. Implement and calibrate token counting

**Tasks**

1. Implement a model registry with canonical website/model IDs, encoding ID, exact asset hash/revision, reference source, tokenizer generation, content support and verification date. Reject unverified wildcard model matching.
2. Bundle `gpt-tokenizer` encodings applicable to verified OpenAI mappings. Validate ordinary text and relevant special-token policy against official tiktoken reference fixtures.
3. Implement Google local-tokenizer support only for explicitly mapped models. Port matching normalization/special-token behavior and verify the precise SentencePiece/tokenizer assets against Google's Python reference. Gemma3's pinned artifact and the inspected Gemma4 Apache-2.0 asset must be tracked separately.
4. Build a synthetic/public calibration corpus of at least 400 cases: English/German prose, mixed language, code, numeric tables, URLs, Unicode and long excerpts. Reserve at least 25% as untouched holdout data. Publish corpus license and distribution.
5. Implement the development-only Anthropic calibration workflow in Contracts Section 3.6. Use a maintainer-controlled API key and synthetic/public licensed samples, not employee chats. Compare modern Claude candidates against the model-specific counting endpoint, recording envelope/content distinctions and holdout errors. Test preserved thinking-context rules. This endpoint returns an input-token estimate, not historical Claude.ai output usage; do not treat counting an answer as a new input as proof of its generated-output count. For Sonar, historical Llama lineage is a candidate only; no generation spending occurs without an explicitly configured development budget/credential.
6. Run tokenizers through the shared worker-host interface. In verified Chromium targets, use one offscreen document with the documented `WORKERS` reason and compatible lifecycle helpers. In Firefox, use the packaged background/worker host proven in P0; no Chromium offscreen dependency may reach that build. Both hosts must preserve identical numeric/privacy contracts and report worker failures. [Chromium offscreen reference](https://developer.chrome.com/docs/extensions/reference/api/offscreen).
7. Serialize worker jobs with IDs and revisions; cancel stale previews; prioritize terminal results; cap buffers; explicitly report timeout/unsupported content. Raw text exists only in memory and is released after counting.
8. Re-tokenize complete captured text at completion. Stream chunks are not assumed independently additive. Test differences between raw Markdown and rendered DOM text; prefer the former when captured.

**Quality targets:** 100% parity on supported official-tokenizer fixtures. For an approximate profile, publish signed bias, median/P95 error and holdout size. Proposed promotion target is median absolute relative error <=5% and P95 <=15% on each adequately sampled language/content group. These are engineering acceptance targets, not known achieved accuracy. A failing group remains explicitly rough/unsupported and cannot receive the calibrated badge.

**Exit gate:** assets reproducible; official parity passes; substitutes have disclosed measured errors or are explicitly unvalidated; no unsupported model silently inherits another model's encoding. Tests T01-T12 pass.

### P4. Build identity, enrollment and backend storage

**Tasks**

1. Implement hosted multi-tenant and self-hosted single-tenant modes with PostgreSQL migrations from Contracts and the product specification. Bind credentials and validated request origin to company/user/device server-side; do not trust IDs from a request body.
2. Implement company registration without an address field (the server generates an internal key; 13 October 2026), domain eligibility, verifying-admin OTP and idempotent provisioning. A successful creation grants exactly one initial admin; domain match never grants subsequent admin privileges. Expose pending, conflict, quota and provisioning failure states.
3. Implement same-email cross-browser identity and the installation-bound connection handoff. One tenant/email maps to one user with independent credentials per installation. Test all three browser pairs in both directions and multiple machines. Store package links do not contain company credentials; personal history is not uploaded on connection.
4. Reinstall or loss of all installations is recovered through the normal email-code connection in the extension and a new installation handoff. No mandatory recovery phrase or existing-device approval. Revocation of other installations is explicit, not a side effect of connecting. Test deleted/suspended users, alias/case rules and concurrent first connection without identity resurrection.
5. Implement access-token expiry, refresh rotation, single-flight refresh, device revocation and revocation on account deletion. Registration IDs are not credentials. Keep persistent credentials in extension-owned storage accessible only to trusted extension contexts.
6. Implement Brevo email OTP-only organization web authentication, secure HttpOnly sessions, CSRF protection, expiry and rate limits. The verified organization registrant receives the first admin membership through successful organization creation. Store verified email linked to stable user identity. Website sign-in is for current administrators only and lands on `/admin`; anyone else gets `admin_required` and members connect from the extension. Keep web sessions separate from scoped extension credentials; do not require a second factor or password.
7. Create exactly `user` and `admin` organization roles; use the authorization matrix in Contracts and the role-management rules in the brand/roles handoff. Support multiple admins with promotion/demotion, atomic last-admin protection, audit and immediate privileged-access invalidation. Admin rights never come from a client-supplied flag, IP, email-domain match or ordinary enrollment link. Platform-operator authority is separate.
8. (Superseded on 18 October 2026: network observations are no longer captured.) Capture network observations at the server's trusted ingress, as detailed in P9. Finalize the pending IP-retention policy before activating enrollment.

**Artifacts:** migrations; registration/OTP/connection APIs; credential-based tenant resolution at the hosted address; self-hosted bootstrap and reconnect documentation; role/identity tests; deployment secret schema; Brevo delivery/privacy evidence.

**Exit gate:** the same verified email in one tenant connects multiple installations to one user; different tenant identities stay isolated. Registration/domain/OTP/handoff replay and role checks pass; email/registrant details remain confined to their declared authentication/registration boundary, with no chat content. I01-I12, S01-S08, relevant PE01-PE24, AR and Brevo BV gates pass. Never consume one OTP twice to create separate user/admin sessions.

### P5. Implement the four production adapters

Each adapter owns endpoint/transport recognition, request identity, raw-text extraction, observed model mapping, usage-field normalization, terminal detection and a composer anchor. Shared code owns buffering, error taxonomy and the ledger.

**Shared tasks**

1. Inject a packaged page observation bridge at document start only on the four approved sites, through the per-browser mechanism proven in P0/P1. An isolated script validates bridge messages and communicates with extension services. Page-origin messages are untrusted and never gain server credentials. Firefox injection/compartment behavior must be tested independently, not inferred from Chromium APIs.
2. Preserve original fetch/XHR behavior, response availability, cancellation and backpressure. Observe only relevant endpoints; do not replay prompts. The live audit establishes that the tested ChatGPT mode also needs WebSocket receive observation, subscribe-catchup handling and handoff correlation. Handle late installation/existing sockets as partial coverage, without forcing reconnection. Prove worker/frame reach separately.
3. Parse incrementally with UTF-8 and framing tests; capture tool/thinking/document/image metadata in separate categories. Follow schema 1.1.0 media ownership: request inputs and intent are not additional attempt outputs. Correlate image operations, revisions, requested/returned counts and full-image dimensions; history, previews and downloads are not new generations. Avoid whole-body regex searches for token-looking fields.
4. Use independent composer/generation UI signals to detect a missing protocol hook. New visible output without an attributed local request becomes a capture diagnostic, not an invented request or automatic recount of history.
5. Maintain provider conversation/branch mapping locally and opaque company-scoped keys for cross-device conversation lookup. No raw provider IDs or content hashes leave the profile.
6. Implement explicit health checks on route change, reload and permission changes. Unknown protocol/composer versions produce visible degraded states and a diagnostic code.
7. Preserve host functionality under all measurement failures. No hook may await tokenization/network sync, rewrite payloads, consume the site's response stream, suppress native events or override site controls. Implement narrowly scoped teardown without undoing another extension's changes; if safe restoration cannot be proven, stop further processing, surface the issue and request a reload rather than overwriting unknown hooks. Test enabled-versus-disabled host behavior through H01-H06.

**Site packages**

- **ChatGPT:** decode the observed HTTP-to-WebSocket handoff and nested SSE; deduplicate stream-item IDs across catchups/live delivery; apply validated path/operation inheritance and type-aware patches per stream. Preserve message roles/channels, exposed reasoning displays and model evidence. Initial HTTP `[DONE]` is not assistant completion; `client_stopped` overrides a successful stream-end event. Test temporary chats, auto selection, SSE-resume alternative and regeneration.
- **Claude:** decode gzip or the actual uncompressed request representation; observe both `/completion` and `/retry_completion`; empty retry prompt does not mean zero logical input. Assemble indexed content blocks and text/input-JSON deltas; separate search results/citations/empty thinking from answer output. Use explicit stop evidence and branch-aware reconciliation. Adapt any reused capture ideas with attribution; replace branch-size accounting, fixed cache countdown assumptions and blanket thinking exclusions.
- **Gemini:** parse the form and nested JSON request; decode response bytes as UTF-8 before applying the observed UTF-16-code-unit length framing. Track candidate snapshots by identity and replace provisional text; ignore duplicate rich representations. Do not equate the Thinking mode or positional integers with a model identity/tokenizer/context capacity. Validate stopped/completed signals, schema drift and document processing.
- **Perplexity:** maintain separate workflow/source blocks, JSON-pointer patches and item identities. While a text payload is streaming, reconstruct its `chunks`; at finalization use canonical `text` once. Do not add both. Separate exposed queries, tool invocations, source-result counts and actual generations. Preserve unknown routing; `pplx_pro` does not establish a Llama/Sonar tokenizer. Natural client `ERR_ABORTED` alone is not proof of user cancellation.

**Exit gate:** each adapter passes its P1 corpus and end-to-end smoke tests. A changed fixture fails loudly; every dropped/capped component records its reason. Tests A01-A12 and the dated BA01-BA22 audit-derived gates run in the applicable provider/browser combinations. The reference harness is not the production implementation or its sole expected-value oracle.

### P6. Implement operational resource estimation

**Tasks**

1. Define immutable method bundles containing engine version, coefficient/data revisions, supported model/workload ranges, unit boundaries, geography scenarios, PUE/WUE factors, licenses and quality evidence.
2. Implement the equations in Contracts with separate IT and facility energy. Select EcoLogits usage outputs, not its combined embodied-plus-usage result. Do not apply PUE twice.
3. Implement compatible Python/TypeScript numerical outputs with shared golden fixtures. Store decimal base-unit strings, round only for display and use the same method bundle on both sides.
4. Prefer an applicable reviewed profile. When model identity or a direct profile is missing, apply the highest-comparable algorithm and metadata in the methodology specification. Compare the whole eligible cohort under one workload and coherent scenario, retain the winner's vector and disclose the proxy. Unknown model identity alone is not automatic unavailability. No compatible method/factor remains explicit reference-only/unavailable. The user's IP, company server IP or browser location never selects the inference electricity grid.
5. Model visible/reported reasoning, context and cache fields according to their actual semantics. Do not add reasoning/cache subsets twice, infer full reasoning from a summary, or translate billing discounts into energy discounts.
6. Only when suitable accessible public metered data exists, evaluate a prefill/decode candidate on held-out open-model workloads, including long-input/short-output cases. Compare bias/error against the pinned baseline and promote only supported domains. Otherwise record the evidence gap and retain the qualified rough baseline. Missing measurements do not authorize paid experiments or fabricated validation.
7. Use ML.ENERGY, TokenPowerBench and AI Energy Score as applicable evaluation sources; treat Google/Altman/Mistral disclosures as dated boundary-labeled references. Dataset gates are handled in development, not by employee installations.
8. Keep unestimated search/OCR/image interpretation operations visible. A text-model subtotal is not a complete document/search footprint. Unknown finite upper bounds stay null.
9. Implement image generation as a separate work-unit path. Since 3 October 2026 each generated image uses the published 2.907 Wh mean times the provider PUE. The ML.ENERGY image figures that were first used as a GPU-only reference were removed on 20 October 2026 because the ML.ENERGY leaderboard repository it came from has no licence; no figures from it are bundled or reproduced.
10. Preserve factor definitions and dates, including an explicitly unknown original measurement year. Quarantine conflicting architecture entries, including the documented Mistral Large 3 mismatch. Keep measured open-model records, proprietary architecture hypotheses and provider median disclosures distinguishable. Copy neither a vendor median nor a study maximum into a universal per-chat/per-image constant.
11. Execute the applicable quality gates: source/provenance, units, arithmetic, cross-runtime parity, explicit assumptions and functional/privacy/noninterference checks are mandatory for rough baseline release. Empirical validation is mandatory before a calibrated claim or candidate promotion, not a demand for unavailable Claude electricity telemetry before any qualified estimate can ship. Where suitable public data exists, compare methods on untouched metered workloads and publish subgroup errors. Otherwise record the missing evidence. Never add input tokens to the output coefficient or hide the known context-length weakness. Q01-Q14 are not satisfied by reduced documentation tests alone.
12. Enforce the easy-formula-update amendment: shared immutable coefficient data, small pure method modules, a stable result interface and cross-runtime fixtures. Demonstrate a coefficient-only change and a test-method replacement without edits to adapters, UI components, aggregate reducers or API controllers when the existing observation/result schema suffices. Validate versions and cache invalidation; retain historical reproducibility and prohibit downloaded executable formulas.

**Artifacts:** `registry/methods/`; estimator core and Python reference; calibration report; unit/cross-runtime fixtures; assumptions UI copy; methodology documentation.

**Exit gate:** correct units and scope; no hidden constants; a reviewed runtime-eligible rough-baseline bundle and declared assumption domains; cross-runtime/functional checks pass. Keep unsupported reference-only results outside ordinary totals. Holdout evaluation is required for candidate promotion/calibrated claims, and remains explicitly unavailable where suitable evidence is absent. Physical accuracy is not certified. E01-E12 and applicable FM/IM/Q/MU gates pass under those evidence classifications; offline reference arithmetic is not production or physical validation.

### P7. Build synchronization and aggregation

**Tasks**

1. Implement a durable outbox with coalescing of revisions, bounded batches, retry schedules and acknowledgement states from Contracts. Register listeners through each browser's background platform host and use verified scheduling/activity mechanisms to resume work; never rely on an in-memory timer surviving termination. Test Chromium service-worker suspension and the selected Firefox host independently. [Chromium lifecycle guidance](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).
2. Implement ingestion as authenticate -> strict validation -> row lock/dedup -> estimate -> transactional canonical update and aggregate delta -> durable acknowledgement. A lost HTTP response after commit must be safe to retry.
3. Return per-record acknowledgements. Rejected records remain locally available with reason and a recovery path; they are never silently removed from the queue.
4. Make same-ID/same-revision/same-content retries idempotent. Conflicting payloads at the same revision are explicit conflicts. Older revisions cannot overwrite newer values. Legitimate final token corrections may reduce provisional values. Reconcile duplicate parent requests as well as attempts, including reversal of prior contributions; ambiguous parent relationships remain visibly unresolved.
5. Build personal, company and admin aggregates from canonical current records, not from all received revisions. Update old and new contribution buckets within the same transaction when records change.
6. Keep registered-user, active-user, device and IP cardinalities separate. Compute distinct user counts over the requested whole range; do not sum daily distinct counts.
7. Return quality/coverage denominators and snapshot time with every total. Unknown-only resources return null with zero coverage, not a displayed zero footprint.
8. Online personal totals come from the server; pending local work is a separate subtotal. For offline or server outage, show a local-profile total plus dated cached paired-device/company snapshots without summing them.
9. Run a periodic reconciliation job comparing canonical records with rollups. If mismatch occurs, mark affected aggregates inconsistent, stop serving them as current, rebuild from canonical data and record the repair.
10. Ingest media and method-selection metadata under schema 1.1.0. Keep matched-profile, highest-comparable and reference-only series distinct. Reference-only figures never enter normal usage totals. Reconcile image outputs once by canonical attempt/operation identity and expose GPU-associated image subtotals separately from broader IT/text estimates unless an explicitly reviewed common partial scope is used.

**Exit gate:** duplicate requests/retries never inflate counts; stale/conflicting revisions behave as specified; database crashes do not acknowledge uncommitted data; dashboard sums and quality counters reconcile. Tests Y01-Y14 and G01-G12 pass.

### P8. Deliver conversation and employee dashboard UI

**Tasks**

1. Implement one reusable metric component that requires value, units, scope, provenance and health. A component cannot render a plain zero for an unavailable value.
2. Implement the anchored composer bar and a details popover on each site. Subscribe to ledger updates; never compute consumption independently inside the UI.
3. Implement exactly two toolbar tabs and shared period/tool/model filters. Preserve filter state across popup reopen. Display paired-device server totals and local pending data with clear boundaries.
4. Add per-provider theme adapters with host-derived CSS values and reviewed fallback palettes. Handle dark-mode changes, SPA navigation, multiple composers and anchor disappearance.
5. Add accessible labels, keyboard focus management, Escape behavior, readable contrast and screen-reader statuses without announcing every stream chunk. Avoid layout shifts or covering send/attachment controls.
6. Implement offline, disconnected, permission missing, tracking paused by user, pausing disabled by company, tokenizer unavailable, partially measured, queue blocked and server stale states. Show company policy in plain language.
   Keep administration navigation out of all extension surfaces; the two employee tabs remain My usage and Company, with no admin affordance in settings, help or expanded views.
7. Add the month-end summary as a once-per-month disclosure/summary, not a background popup promise while the relevant browser is closed.
8. Implement the context indicator and optional footprint helper from Sections 3.4-3.5 and Contracts Section 3.7. Use official-limit priority, labeled conservative fallback, the above-50% rule, warning deduplication/hysteresis and dismiss/snooze. Place the restrained prominent banner directly above the composer; detailed basis/progress appears only inside user-opened Details. No unsolicited interruptive overlay or automatic AI action.
9. Publish the complete methodology, model inventory and source bibliography from the canonical article. Details identifies observed model versus proxy, input/output components, environment scenario, missing work and image-operation counts. C10 is reserved for genuinely unavailable components, not ordinary hidden reasoning or unknown models with valid fallback profiles. Keep image references and estimates visibly scoped. Preserve existing design-review anchors while adding new specimens.
10. Build public home/methodology/privacy/open-source/download/teams/self-host pages, organization registration and administrator login from P/G/L specimens, and the extension's Connect flow from N specimens. Use real configured source/store links; unavailable listings show their actual status. Enrolled E02 opens from the browser toolbar; personal E01/E09 works with no server. Complete install and Connect as separate truthful steps, with actual browser permissions and handoff evidence.

**Exit gate:** user can identify the difference between no use, unknown estimate and unsynced work; all site/theme/layout checks pass; company tab never leaks admin fields or administration navigation; bar and toolbar agree for the same accounting scope. Tests U01-U12, C01-C08 and H01-H06 pass.

### P9. Build administration, IP analytics and policies

**Tasks**

1. Implement admin analytics defined in Section 3.3 using server APIs, with pagination and date/tool/pseudonym filters. Provide CSV export with calculation version, units, coverage and occurrence/upload time labels.
2. Capture the source address only at trusted server ingress. If behind a reverse proxy, accept forwarded client addresses solely from explicitly configured trusted proxy chains. Ignore client JSON IP fields and spoofed forwarding headers from untrusted peers. An unresolved chain yields a visible unknown-IP condition. [Trusted-proxy example documentation](https://nginx.org/en/docs/http/ngx_http_realip_module.html).
3. Canonicalize IPv4/IPv6, encrypt full addresses at the application layer, and maintain a keyed equality token for permitted distinct-IP queries. Never use an unsalted IP hash as anonymity. Store IP observations separately from usage records.
4. (Superseded on 18 October 2026: IP addresses are no longer collected.) Associate IP with the ingestion connection and receipt time, not with a retroactively inferred AI dispatch location. Admin filters must distinguish AI request occurrence month from upload month. Retrying a batch may create another network observation but cannot create more AI consumption.
5. (Superseded on 18 October 2026: IP addresses are no longer collected.) Enforce IP retention independently. Under the provisional 30-day default, delete both address ciphertext and equality tokens after expiry; historical unique-IP queries then state their available coverage. Never retain a hidden permanent hash to defeat the declared retention.
6. Implement company pause policy: user-configurable or disabled by company. Disclose profile-wide capture before enrollment. Policy enforcement cannot prevent extension uninstall or activity outside the enrolled profile; admin health labels reflect this limitation.
7. Implement explicit admin deletion of a user or selected request-dispatch-time range with preview counts, OTP reauthentication, confirmation, idempotent jobs, aggregate rebuild and minimal audit. Delete complete request families, showing cross-boundary attempt dates. Self-hosted usage stays until this operation by default; hosted expiry additionally follows the organization's chosen period or plan maximum, if any (hosted free keeps usage until admin deletion since 11 October 2026). Since 18 October 2026 a preview that names one person lists what will be deleted without counts.
8. Implement deletion notifications/tombstones and device synchronization so erased records cannot be uploaded again from offline caches. A separate deletion-only receipt channel must remain usable after full-user deletion revokes usage credentials. Define backup expiry and restore-time deletion replay in deployment documentation.
9. Implement immutable hosted plans, organization assignments and operator free exceptions under the product specification. Serialize last-seat allocation, preserve existing users on over-limit transitions, preview shorter retention and prevent expiry resurrection from queues or backups. No invented prices, automatic billing vendor or purchased upgrade.
10. Implement the isolated platform-operator application, explicit grants/session boundary, organization directory, plan editor, exception grant/revoke and health/audit views. Organization admin promotion must never grant operator access. Test operator isolation and do not expose raw employee data as a default support feature.

**Exit gate:** member endpoints cannot access individual/IP data; trusted-proxy/NAT/IPv6 tests pass; expiry/deletion affects all declared stores/exports; admin deletion cannot leave current-looking stale totals. Plan/exception and tenant/operator boundaries pass S01-S08 (N01-N10 were removed on 18 October 2026), D01-D08 and applicable PE gates. Pending policy/billing configuration is visible, not treated as active commerce.

### P10. Prove reliability, privacy and capacity

**Tasks**

1. Execute the full acceptance matrix, including forced browser/worker termination, storage quota failures, invalid schema, unknown model, parser drift, API outages, auth expiry, clock skew, partial acknowledgements, duplicate delivery and PostgreSQL transaction interruption.
2. Inspect outbound traffic/database/logs with synthetic marker text; require that no prohibited content or raw IP appears outside its dedicated authorized storage path.
3. Test 500 pseudonymous accounts, multiple paired profiles, 50 applied observations/second bursts and a representative large history. Use a 1-million-record CI/staging baseline and a 10-million-record capacity run before claiming multi-year suitability. These are test targets, not measured capacity claims.
4. Proposed targets on the documented reference host: p95 100-record ingestion <=2 seconds; p95 dashboard query <=2 seconds; cached popup visible <=500 ms; local terminal metrics usually <=2 seconds for ordinary text. A breached target produces explicit processing/stale state, not wrong results. Publish actual hardware and results.
5. Bound extension memory and CPU using four concurrent streams and large documents. No unbounded cloned-response buffering. Record measured overhead and fail a release that blocks chat interaction.
6. Review threat boundaries and operational runbooks. Verify secret storage, admin authentication, role checks, trusted proxies, cross-user access, pairing, signed method/config updates, and absence of remote code loading.
7. Run B01-B08 and the four-site adapter/UI suite in actual Chrome, Edge and Firefox builds. Include browser-to-browser pairing, simultaneous cross-browser chats, offline/restart behavior, store-specific extension origins and upgrade compatibility. One browser's failure blocks that browser's release claim and the all-three-browser release gate.
8. Run H01-H06 with the extension off/on, slow/unavailable company server, tokenizer failure, large documents and competing page hooks. Measurement/guidance must not change AI-tool results or interaction semantics. Any host-function regression blocks release even if all reported usage totals appear correct.
9. Run PE01-PE24 against real PostgreSQL and browser builds: personal network isolation, registration/domain races, same-email connection, administrator-only sign-in, no domain enumeration before a verified code, OTP quota/lost responses, connection proof replay, sibling-origin CSRF, background tenant scoping, role revocation, operator exceptions, last-seat allocation and retention/restore. Publish tested total hosted tenant count and hardware separately from the 500-user-per-company target.

**Exit gate:** no unresolved defect that can silently lose, misattribute, double-count or mislabel usage; no unauthorized personal/IP disclosure; all protected-state and reconstruction tests pass. Performance deviations need an explicit documented target revision, not a hidden test waiver.

### P11. Pilot and publish

**Tasks**

1. Package Docker Compose for application, PostgreSQL and a documented HTTPS ingress. Supply interactive setup, health checks, migrations, encrypted backup instructions and restore verification. Pin image versions/digests. No VPS is chosen by this plan.
2. Supply admin instructions: configure TLS/mail/policies, register and verify the first admin, tell members to install the extension and connect with their work email, log in to the separate admin website, manage roles/health/exports, reconnect/revoke installations and delete data. Explain six-month hosted versus self-hosted retention and plan transitions. No extension administration navigation; open-source route visibility is not an access-control boundary.
3. Supply personal/employee instructions without provider API keys: install the verified Chrome/Edge/Firefox store package for local use, or choose Connect organization in the installed extension, enter the work email and the emailed code, and confirm the connection. Repeat the same email on another browser for the same user. Store approval, signing and install state must be truthful. Validate managed deployment before documenting it. No paid developer registration, account creation or publication is authorized merely by this plan.
4. Pilot with 10-20 users spanning all four sites in Chrome, Edge and Firefox, both themes, VPN/shared-office networks and paired installations on the same and different machines. Verify that one paired person has one pseudonym and that simultaneous distinct requests are not deduplicated incorrectly. Verify comprehension, correctness, reporting coverage and administrative usefulness before wider rollout.
5. Publish extension/server source under the stated MIT/third-party license boundaries, repository community/security/contribution documents, pinned dependency/asset manifests, calibration results, calculation boundaries, known gaps and the supported-site matrix. Ensure production packages correspond to published source and third-party source/notice obligations are fulfilled. Run O01-O06 before release.
6. Establish adapter maintenance: synthetic scheduled smoke tests, dependency/model-registry review, visible stale-support dates and signed data-only configuration updates. Rollbacks preserve ledger/schema compatibility.
7. Complete public launch configuration, operator grants, real repository/store/support URLs, final owner policies and Brevo privacy/delivery gates. Publish the website/operator code as well as extension/server code. Test an independent self-host install with its own mail credentials and no required call to our hosted service. Payment checkout remains disabled unless separately specified and authorized.

**Exit gate:** deployment from documentation succeeds on a clean host; backup restore and deletion replay pass; pilot has no unresolved silent-accounting or privacy defects; all twelve browser/site combinations have verified basic text capture and explicit status for every additional requested mode. All three installable packages/distribution paths are verified and any store approval outstanding is stated, not called published. Store listings must use “estimates” where appropriate and explain IP collection.

## 7. Operational definitions of done

Implementation is not complete when the bar merely displays plausible numbers. Completion requires: captured events reconcile; official tokenizers pass parity; approximations have measured or explicitly unvalidated status; resource scope is correct; partial totals are labeled; server acknowledgements are durable; personal/company/admin views agree; IPs are admin-only network observations; failures are visible and recoverable; and self-hosted installation, upgrade, deletion and restore are demonstrated.

No production fixture, coefficient, deployment credential, API key, paid benchmark result or private endpoint was invented by this plan. Phase 1 and Phase 3 produce the empirical facts still missing from the research. Implementers can begin P0/P1 with these contracts and gates; promotion of measurement support depends on the resulting evidence.
