# Writing, shared code and performance

Confirmed 9 September 2026. Applies to the website, extension, onboarding, dashboards, emails, errors, empty states, accessibility labels, code comments and implementation reviews.

## Write for the person using the app

- Use short, direct sentences and familiar terms. Explain the result first, then the next action if one is needed. Keep correct wording that already works; do not rewrite for novelty.
- Avoid em dashes, generic slogans, filler, exaggerated claims and unexplained internal terms. Use a full stop, comma or parentheses where appropriate. Do not claim human authorship to make the product sound natural.
- Prefer “Company totals” to “Aggregates”, “Plan limits” to “Entitlements”, and “Waiting to sync” to “Local queue” on ordinary user screens. Use technical names in technical documentation when precision needs them.
- Button labels name the action. Errors say what failed, what happened to the data and what the user can do next. Never claim a save, email delivery or deletion before it is confirmed.
- Preserve uncertainty, partial coverage, missing processing, privacy and prototype disclosures. Use “Unknown” with a reason for missing values, not zero. An estimate is not a meter reading.
- An unfamiliar model with a valid comparator uses “Highest comparable estimate”, with the proxy, scope and assumptions in Details. Do not call a finite cohort maximum a guaranteed upper bound. Use “Benchmark reference only” when it cannot validly estimate that request, and keep that figure separate from usage totals. Missing hidden reasoning alone is not a tracking failure.
- Do not use a runtime text-replacement filter to rewrite the app. Fix source copy and reuse the existing component or message definition. Keep units, plurals, dates and status wording consistent through shared formatters.
- Keep third-party licenses and quoted source material intact. Do not rewrite user comments, imported review text or chat content to enforce this style guide.

## Write comments that help the next developer

Explain constraints, tradeoffs and edge cases that the code does not make obvious. For example: “Retokenize the final text because chunk counts are not additive.” Avoid “Now we loop through the records” above a loop. Public module contracts should document units, null semantics, side effects and failure behavior when those affect callers. Keep comments current when behavior changes.

## Share logic without adding unnecessary complexity

“Global functions” means reusable, explicitly imported module functions, not mutable values on `window` or `globalThis`. Existing prototype exports are not a reason to add more browser globals.

- Check for an existing component/helper before adding one. Share repeated unit formatting, validation, token counting interfaces, resource calculations, status messages and transport rules when their semantics are genuinely the same.
- Prefer small pure functions and narrow interfaces with explicit inputs. Keep site-specific extraction and model quirks in provider adapters. Similar-looking code with different security or measurement semantics should not be forced into one helper.
- Do not optimize for the fewest lines. Avoid compressed one-line production logic, premature general-purpose frameworks, duplicated formula implementations and added dependencies for trivial operations.
- Keep state owned by the component/service that needs it. Share immutable configuration, not hidden cross-user or cross-company state. Test shared functions at their boundary and test their callers where failures differ.
- Do not refactor unrelated working code during a copy change. If a refactor is justified, keep it separately reviewable and verify behavior before and after.

### Keep scientific formulas easy to replace

Follow the easy-formula-update amendment in the implementation plan. Equations belong in named pure estimator methods; coefficients, units, applicability and sources belong in immutable versioned data records. The interface, adapters and controllers must not carry their own copies of the arithmetic. Coefficient changes should not require caller changes. Equation changes stay within the method implementation, its registration/validation and the cross-runtime reference, with matching tests and documentation. New scientific inputs may legitimately require a schema change; document that rather than promising every future study can be integrated by changing a constant. Use supported method IDs and data validation, never runtime evaluation of formula strings or remote code.

## Performance is a release check

Follow P01-P08 and H01-H06 in `ACCEPTANCE-AND-FAILURES.md`, including cached popup <=500 ms, ordinary completed-text metrics usually <=2 seconds, and the documented ingestion/query targets on the reference workload. These are targets until measured, not guarantees that this prototype meets production requirements.

- Never wait for counting, resource calculations or uploads before forwarding the original AI request. Preserve streaming, cancellation and response order.
- Use bounded workers/buffers for expensive work. Scope and batch DOM observation, update only changed UI, avoid whole-chat rescans for every streamed token, and retokenize the complete captured text at completion for correctness.
- Reuse cached results only with keys covering content revision, model, method and relevant settings. Invalidate on edits, branch changes and method changes. Bound cache size and avoid retaining raw chat content unnecessarily.
- Measure CPU, memory, long tasks, bundle size and extension-on/off latency in Chrome, Edge and Firefox. Use realistic long chats, concurrent streams, uploads and worker restarts. Record versions, hardware and datasets so results are repeatable.
- Avoid busy polling, unbounded retries and duplicated listeners. Clean up extension-owned observers and workers. Prefer a visible degraded state to hidden lost measurements or a broken host page.
- A production claim requires functional tests, security/access checks, accessibility checks and performance evidence. A copy review or passing prototype tests is not production certification.

## Review checklist

### Visual design and interaction rules

Visual style cannot prove whether a person or an AI produced an interface. Review the actual quality, not an imagined authorship score.

- Preserve the Fern identity and host-specific themes. Use layout, typography and useful content to establish hierarchy. Avoid repeated promotional labels above headings, oversized duplicate logos, decorative progress indicators and a separate card around every fact.
- Group related metrics in an aligned summary. Use tables for records, plain sections for explanations and cards only where they clarify grouping or interaction. Keep genuine steps, measurements and statuses, even if the visual pattern is common.
- Use consistent controls and explicit accessible names. Do not ship decorative switches, menu symbols that do nothing, unlabeled icons or buttons that claim a backend action succeeded without confirmation. Prototype-only actions must say so.
- Keep body/supporting text readable with at least 4.5:1 contrast (3:1 for qualifying large text), visible keyboard focus, meaningful status labels, and suitable pointer/touch targets. Test missing values and longer text in both themes.
- Use restrained borders and depth. Avoid gratuitous gradients, glass effects, shimmer, entrance animations or animation libraries. The prominent amber 50% warning is a user-approved exception to the otherwise quiet notice style.
- Reuse local CSS tokens, components and system fonts for the current design. A new font or asset needs a readability/branding reason and a measured loading cost. No external font, analytics or decorative asset request is required for this refinement.
- Check every screen for overflow, representative flows with keyboard input, and narrow/desktop layouts. Preserve saved review anchors when refining the canvas. Promotional eyebrow labels remain available in Edit/Comment mode during the current review version; the redundant Details kicker stays hidden but retains its anchor. Production should omit unused decorative markup.

1. Every shipped screen and state uses clear, consistent language without em dashes in authored copy.
2. Errors, missing values, estimates, sharing and destructive actions still explain their limits accurately.
3. Comments explain useful intent; shared code has a clear owner and avoids unnecessary globals or abstraction.
4. Copy fits desktop and narrow layouts and remains readable in light/dark modes. Keyboard controls and accessible labels still work.
5. Relevant tests and performance checks pass. Record any checks not run and any known regressions.
