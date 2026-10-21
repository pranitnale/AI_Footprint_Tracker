# Historical conversation counting

The owner requested historical conversation support on 14 September 2026. This explicitly expands the earlier scope that excluded importing conversations from before extension installation.

## Compact presentation amendment, 14 September 2026

The owner subsequently requested one normal Requests summary for earlier and new activity, a short loading hint, statistics in Details, and counting explanations on Methodology. This supersedes the earlier requirement for separate headline history totals, while retaining original records and evidence boundaries.

The extension now projects recorded requests plus unmatched earlier prompts into one provisional display. Confirmed live matches and conflicts are already excluded from the earlier contribution. Where unmatched messages may still overlap live records, the request figure carries an approximation marker and the visible status says Matching incomplete. This is not a verified union or execution count; the remaining matching uncertainty is counted in Details and explained on Methodology. Compatible token profiles and text-resource methods can combine; incompatible groups remain in Details. Local, pending and synced snapshots never add together.

The in-conversation hint is “Partially loaded · Scroll to the first message to load completely.” It disappears only after the selected history summary verifies its first-message boundary. Loaded coverage and calculation accuracy remain separate. Methodology is also bundled with the extension for offline reading. Existing design-canvas review anchors are preserved by appending the new methodology section after existing article content.

## Accepted behavior

- Count messages from the conversation history that the user loads, including conversations that predate installation.
- Update deduplicated numeric totals as earlier messages become available. Show partial calculation and history coverage, including whether the first request has been verified.
- Keep imported historical estimates distinguishable from live observations. A loaded user message is evidence of a historical prompt, not proof of every underlying API call, hidden token or complete operation.
- Store numeric request and token counts and supported resource estimates against the scoped user and conversation identity. Process message text locally. Do not retain or transmit raw messages, filenames, chat titles or content hashes as telemetry.
- Preserve reliable provider dates and their message-, entry- or turn-creation basis. Keep unknown occurrence dates explicit and separate from the time of import; never invent dispatch or response-completion times.
- Prevent double counting across repeated loads, paired browsers and already tracked live requests. Preserve immutable original observations and estimates.
- Continue passively as the user loads history. Do not change the host's scrolling, navigation, requests or generation behavior to obtain older messages.

The owner answered **“Keep older imported numeric history too”** when asked whether imports may be retained beyond the approved six-month hosted retention window. Imported numeric history therefore needs a distinct age-retention policy. Explicit deletion and revocation remain authoritative; reopening a conversation must not restore deliberately erased data.

Personal mode keeps its data local. Connecting a personal installation does not silently upload its preexisting personal ledger. Historical numeric data newly observed in the connected scope follows the new import feature and its user/conversation boundaries.

Loaded prompt/response counts include every deduplicated visible message in the stated scope. Proven live matches and conflicting records are excluded from imported numerical contributions and disclosed separately. They remain in loaded-message counts. Unresolved overlap is never silently summed with live totals. The scoped importing user is not proof of the original message author's identity.

“First available request loaded” requires the reviewed provider boundary or selected-chain rule. It does not establish every alternative branch, every provider execution or full physical resource measurement. Estimates remain partially calculated. The [source evidence record](../release/HISTORICAL-CONVERSATION-EVIDENCE-2026-09-14.md) describes the verified shapes and capture limits.

## Implementation status

This records the requested behavior and retention decision, not a completed implementation. Provider identity and date evidence, partial-coverage semantics, canonical reconciliation, database contracts, retention and erasure behavior require implementation and independent verification before this feature can be reported ready.

The screenshot supplied with the request illustrates an unavailable conversation-total state. Its private conversation text is not a test fixture and is not copied into this repository.
