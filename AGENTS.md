# AI Footprint Tracker project rules

Read `IMPLEMENTATION-PLAN.md` and the relevant contracts before changing product behavior. This repository contains the application implementation alongside preserved design and planning material. Unsigned local packages have verification evidence; native-browser and external release gates remain separate. Read `docs/release/MODULAR-REFINEMENT-STATUS.md` for the current state. The extension has not been published.

## Tracking changes

Before changing how the extension reads a provider's page, links live and saved replies, counts or estimates (the tracking-critical files in section 9 of `docs/implementation/TRACKING-HANDOVER-2026-10-05.md`), read that handover. It records each tool's data formats, the rules that keep the figures correct and the tests that guard them. The tracking was verified live on 5 October 2026. Change a working rule only when you can show it is wrong, live or in a failing test, and add a test that fails without your change. UI refinements should not need to touch these files.

## Browser inspection

- Use the in-app **@Browser** for ordinary browsing, local UI verification and DevTools inspection. Do not use the gstack browser.
- For DevTools access, use the in-app **@Browser** with full CDP first. The official ChatGPT Chrome extension through **@Chrome** Computer Use is the user-approved fallback when a required in-app capability is unavailable, the task needs the regular Chrome profile, or the user requests Chrome. Full CDP must be enabled in **Settings > Browser > Developer mode**, and website-specific approval must be respected.
- Check the session's actual CDP capability before sending test prompts or claiming access to network bodies. In-app DOM and network CDP commands were verified on a public HTTPS page on 9 September 2026. Explain missing settings or approvals; full CDP does not override URL/security policy, and a fallback must not bypass an explicit denial. Do not automatically reinstall or launch a separate Chrome DevTools MCP.
- Inspect only authorized test traffic. Do not expose credentials, export unrelated conversations or treat an incomplete capture as proof that a provider never returns usage fields. Keep raw authenticated captures out of the repository.

## Writing and maintainability

Follow `docs/implementation/WRITING-AND-CODE-STANDARDS.md` for interface copy, comments, reuse and performance checks.

- Write plain, specific English. No em dashes in project-authored interface copy or code comments. Do not remove accuracy, privacy, security or prototype disclosures to make wording shorter.
- Comments should explain why a choice matters, a constraint or a surprising edge case. Do not narrate obvious code, add filler or claim a human wrote generated code.
- Reuse established components and small shared module functions. Do not create mutable browser globals, a generic utility dumping ground or a large abstraction just to reduce line count.
- Keep provider-specific behavior separate. Preserve original host requests, streaming and controls. Do expensive counting off the main UI thread.
- Performance claims need measurements. Follow the existing acceptance gates, test each supported browser and report regressions or untested behavior honestly.
- Preserve saved design edits and comments. Text-only revisions must keep review anchors stable; structural changes need an explicit migration.

## Standing UI decision: compact resource bar

Owner-confirmed on 22 September 2026. Applies to every future change to the resource bar below the chat composer.

- Always keep the bar compact and concise: essential resource figures, brief units, necessary approximate markers and the Details control.
- Do not add midpoint, minimum/maximum, scenario, methodology or other explanatory labels beside the figures. Put these explanations in Details.
- Show genuine errors as small, compact status labels. Explain the specific reason on hover and keyboard focus, with further information in Details. Ordinary estimation uncertainty or imported history alone must not appear as an error.
- Do not add verbose warnings, diagnostic text or extra informational rows to the bar. Preserve necessary accuracy and coverage disclosures in Details rather than expanding the compact surface.
- Bug fixes, new features and estimator updates must preserve this decision. Do not reintroduce removed labels or expand the bar unless the owner explicitly requests a change to this rule.
- Owner decision of 13 October 2026: a status stays on the bar only when the person can act on it, with the action in brackets on the same line (for example "History not loaded (reload page)"); activity such as Processing may stay. Everything the person cannot act on is listed in Details only, under a collapsible section with a warning-coloured header that says what could not be counted and why. Organization mode is local-first: the bar never shows sync or snapshot wording, and sync state is a small icon at the bottom of Details. See `barStatusParts` in `apps/extension/lib/conversation-bar.ts`.
- Owner decision of 14 October 2026 (replaces the statuses kept on the bar on 13 October): the bar shows only the figures (Req, In/Out, Electricity, Carbon, Water, approximate markers and units) and the Details control. No error, update or progress state appears on the bar, and the bar has no hover or focus help. Until a chat has figures, the bar shows one short state instead of the figure labels, never "Req 0" (owner decision of 14 October 2026, afternoon): "Waiting for your request" when there is nothing to count yet (new chat, start page, nothing sent), "Processing" while a reply streams, is counted or estimated, or an opened chat's history is read or calculated, and "No figures yet" when the chat has messages that could not be counted (the reason is in Details). Figures appear as soon as the first batch is counted; later batches update them in place. While anything updates, the last figures of the open chat stay until new figures publish. Every state moves into Details: one with an action (Reload page, Retry, allow access, scroll on ChatGPT) opens Details with its button, progress (including the tracker's own read, "Sending request" then "Receiving data") is a line at the bottom of Details, and the rest is listed under "Not everything could be counted". `barStatusParts` keeps every status for Details; `test/bar-status.test.ts` checks that each removed label still reaches Details.
- Owner decision of 16 October 2026: a NotebookLM notebook whose only counted work is its notebook guide (the title, summary and suggested questions NotebookLM writes after a source is added) shows the guide's figures in the normal layout, with "Req 0" as the totals and Details count it, instead of "Waiting for your request", and "Processing" while the guide is written or estimated; "Waiting for your request" stays for a notebook or chat with nothing counted, and other sites are unchanged (`notebookGuideOnly` in `apps/extension/lib/conversation-bar.ts`).
- Owner decision of 18 October 2026 (approved exception for the agreement step): before the person agrees to tracking on the welcome page or in the popup, the bar shows only "Tracking is off" with a "Set up" control in place of Details, which opens the welcome page; nothing is counted then. This is the only state allowed besides the figures and the states above. After the person agrees the bar is unchanged, and Details gains only one line at its bottom ("Calculated on your computer. Nothing from this chat was sent to us.", or in organization mode that only numbers are shared with the organization). See `BAR_TRACKING_OFF` in `apps/extension/lib/conversation-bar.ts` and `apps/extension/lib/tracking-consent.ts`.
