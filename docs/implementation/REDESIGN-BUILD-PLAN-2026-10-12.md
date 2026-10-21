# Redesign build plan, 12 October 2026

The owner approved the Living Gauge canvas and authorized the full build on 12 October 2026. This file is the working plan and progress record. Update the status column as phases land, so a later session can continue from here.

Canvas: https://claude.ai/code/artifact/f204fabf-3e9e-4f1a-a968-a953578a2481 (76 boards, version 155). The canvas wins where it differs from older plan text. Owner decisions are rows in the local OWNER-DECISIONS.md.

## Ground rules

- Additive refinement. Do not change tracking, counting or estimation behaviour. Before touching any file listed in section 9 of `docs/implementation/TRACKING-HANDOVER-2026-10-05.md`, read that handover, change only presentation, and run the full suites. New data the UI needs comes from new read-only code that reuses the existing aggregation (`SummaryAccumulator` in `lib/summary-scan.ts`), so every figure is computed by the same code as today.
- The in-page resource bar keeps its current look (owner rule, 7 October and 22 September 2026). Only the Details overlay is redesigned.
- Writing rules: `docs/implementation/WRITING-AND-CODE-STANDARDS.md`. No em dashes in copy or comments.
- Canvas decisions that supersede older plan text, recorded 12 October 2026: the popup is the canvas popup (400 px wide, Me and Organization switch) rather than the 760 x 580 two-tab popup; the dashboard is a separate page with its own navigation; Bricolage Grotesque and Instrument Sans are bundled locally (SIL Open Font License), never loaded from Google; the range markers keep their canvas gradients.
- Live checks never send a message into an existing conversation and never delete a conversation. New conversations only.
- Commit to local `main` in small tested steps. No push, no deploy, no publication.

## Verification harness (phase 0)

| Part | What it proves | Where it runs |
| --- | --- | --- |
| Unit and component suites | Existing behaviour and new components | vps_sujit runner container (`tools/harness/runner.Dockerfile`), laptop only for quick checks |
| `tools/harness/extension` | The built extension loads in Chrome for Testing 151, every extension page renders, and no uncaught exception, unhandled rejection, console error or failed extension request occurs | vps_sujit (headless, Xvfb) |
| Recorded traffic | Bar placement, capture and figures on synthetic provider pages and streams, offline and repeatable | vps_sujit |
| Web harness | Website, admin site, sign-in, registration, onboarding and developer panel against the real API (`tests/browser_harness.py`) | vps_sujit |
| Server stack `aift-test` | PostgreSQL migrations and the hosted flows with a mail catcher | vps_sujit, Compose project `aift-test`, ports on 127.0.0.1 only |
| Live checks | The real provider sites with the owner's accounts | laptop, Chrome for Testing profile `%LOCALAPPDATA%\aift-live`, connected over CDP on 127.0.0.1:9333 |

## Phases

| # | Phase | Status |
| --- | --- | --- |
| 0 | Harness: runner image, Playwright pin, extension loader with error trap, web harness runs, VPS sync script | done: VPS sync (staged edits and deletions since 12 Oct), preview shots of every popup, dashboard and Details state, extension page check over every dashboard route |
| 1 | Foundations: tokens, local fonts, shared components, usage breakdown action (days, tools, models, chats) reusing the summary accumulator | done |
| 2 | Popup: My usage, Organization, first run, one-line problem notice, paused, organization offline, connect, waiting for approval | done (test/popup.test.tsx) |
| 3 | Dashboard: Overview (both scopes), Tools and models (both scopes), Monthly recap (both scopes), Settings (both scopes), Tracking status, Licences, no chats yet, organization connect; dialogs for scenario, pause, erase, connect, disconnect | done (test/dashboard.test.tsx); the earlier dashboard (lib/App.tsx) and its engine picker are removed |
| 4 | Details overlay: canvas layout inside the existing shadow root, scoped under `.panel`; bar untouched | done: figures with range, everyday terms, tokens, comparison with your chats (read-only `chat-comparison` action), what was counted, how it was estimated, status chips from BarStatusSheet; the earlier full explanation stays inside How this was estimated. The smaller-model card landed in phase 10 |
| 5 | Website: home, downloads, for teams, self-host, privacy, open source, methodology, contact, legal pages, not found | done (test/site.test.tsx): every site page, methodology parts 1 and 2 shared with the extension (packages/ui/src/methodology), the full technical reference kept. Legal pages keep marked placeholders for facts only the owner can supply |
| 6 | Admin site: overview, people, tools and models, policies and data, health, person, requests, request details, network, audit, deletion, plan, dialogs, states | done: src/admin with the extension's figure modules (src/admin/figures.ts), so administrators see the same totals as each extension; earlier tools such as recalculation and per-attempt detail stay one step further down. Checked against server-recorded data at 1440 and 390 px |
| 7 | Sign-in and connect: login, code, register, verify, onboarding, approve, approved; keep the browser approval through sign-in | done (test/interaction.test.tsx, test/app-logout.test.tsx) |
| 8 | Developer panel: origin developer.aifootprinttracker.com, sign-in, organizations, contact requests, manage, plans, exceptions, health and audit | done (test/interaction.test.tsx, server tests/test_admin_people.py): Service navigation with a new-request badge, organization stat cards and member bars, the Manage dialog led by the current plan, plan cards, one table of every organization's exceptions (new GET /v1/operator/exceptions), the Contact requests inbox, health cards and a filterable audit log. Exceptions start when granted, because the server refuses later starts; the canvas start date and "No end date" are therefore not offered. The audit log names developers by pseudonym only (existing rule). No email notification for new contact requests is built. Checked against server-recorded data at 1440 and 390 px and clicked through in Chromium |
| 9 | Server features: contact requests (storage, rate limit, honeypot, developer inbox), usage kept until an administrator deletes it (administrators may choose a shorter period), organization deletion, "developer" reserved | done except deleting a whole organization account (usage deletion of the whole organization exists). Added for the admin site: people summary, per-person and organization splits for administrators, per-request tokens and electricity, connected browsers on Health, the signed-in email (tests/test_admin_people.py) |
| 10 | Everyday comparison factors and smaller models from sourced research | done: factors in docs/methodology/EVERYDAY-COMPARISONS-2026-10-12.md. The smaller-model card in Details adds, per reply, the difference between the provider's smaller record and the reply's own record, both from EcoLogits with the same output tokens and modelled latency (`LocalEstimateExecutor.alternativeText`, `lib/smaller-model.ts`), to the figure Details shows. It arrives with the chat-comparison reply, so the background message is unchanged; a chat it cannot compare shows no card (test/smaller-model.test.ts, packages/estimator/test/alternative-text.test.ts) |
| 11 | Full verification: every button and screen, both themes, narrow widths, live provider checks, performance budgets | done: new chats sent and reloaded live on ChatGPT, Claude, Gemini and Perplexity in a separate test profile (no existing chat touched); popup, dashboard pages and dialogs clicked through at 1440 and 390 px in both themes with no console errors or overflow; Details checked at 1280 and 420 px in dark mode on all four sites. Fixes found this way: a new ChatGPT chat now opens at a provisional `/c/local-chatgpt:<id>` address and lost its reply (Out Unknown); Gemini's October layout put the bar inside the rounded composer in a serif font; Perplexity's home page showed no bar and logged a false tracking problem; Details was cut off or covered by provider headers and composers; Settings and Tracking broke at phone width; "1 requests", "0 kWh" and "≈ 0 words per reply". Popup first figure: median 0.52 s before, 0.33 s after keeping the last view (usage breakdown about 0.3 s per call, left unchanged in the tracking-critical scan). ChatGPT's new plain `gpt-6` slug stays "model not yet listed" until it can be mapped from evidence |

## Acceptance for every phase

- Each canvas board in the phase is implemented with its copy, states and interactions. Sample figures on the canvas are replaced by real data.
- New and existing tests pass on the runner. Extension baseline: see the log in `tmp/baseline/`.
- The extension harness reports zero errors on every page the phase touches.
- Screens are compared against the canvas at the canvas widths and at a narrow width, light and dark where the canvas shows both.
