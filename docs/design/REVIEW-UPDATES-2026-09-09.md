# Canvas review updates, 9 September 2026

Source: the user's Markdown handoff exported at `2026-09-09T10:15:46.343Z`, design version `fern-v1`.

## Applied feedback

| Screen or anchor | Feedback | Source change |
| --- | --- | --- |
| P03:n12 | Explain that temporary text counting happens on the user's computer | Added "on your computer" while preserving the no-extra-archive statement |
| P03:n16 | Explain why the verified email is linked to the user ID | Clarified sign-in verification and linking browser installations; retained the Brevo delivery disclosure and the separate company-identification/IP notice |
| G05 | "move this trick/progress to center" | Centered the confirmation tick within the organization-ready form |
| L06:n12 | "make it properly aligned currently it is collapsing on try another email button" | Placed both recovery buttons in separate grid rows with a 12 px gap and matching widths |
| N04 | "move the tick of connected center aligned" | Centered the confirmation tick within the connected-installation panel using the same CSS modifier as G05 |

The two privacy paragraphs retain the existing 13 px, regular-weight, left-aligned supporting-text style and Fern supporting color `#5c6958`. Email verification confirms mailbox access, not independently verified real-world identity.

## Review preservation

Screen IDs, `fern-v1`, existing leaf-text order, navigation destinations and review storage are unchanged. The L06 wrapper adds no reviewable text node. No browser-local comments, saved edits, positions, approval status or resolved flags were changed. The provided Markdown records changes but is not a full JSON import backup. Saved text overrides can still take precedence over source copy after reload.

## Verification scope

All 22 automated tests passed, including four new checks for the requested source changes, privacy disclosures and relevant comment anchors. JavaScript syntax checks passed. The design scan flagged two existing accent borders, not new defects from this update. Browser automation was blocked by the file-URL policy, so no new visual, computed-layout or cross-browser performance result is claimed. The user can reload the existing canvas and review P03, G05, L06 and N04 without clearing saved review data.
