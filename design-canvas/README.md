# AI Footprint Tracker: editable design canvas

This is a local, front-end-only **design prototype**, not the extension or company backend. It contains **88 screens and state specimens** using the selected Resource Gauge direction and Fern palette. Screen records are illustrative; the detailed methodology identifies published reference data and reproducible calculated examples separately.

## Open

From the project directory, run:

```sh
node design-canvas/serve.cjs
```

Open **http://127.0.0.1:4178/** in the in-app Browser. The server binds only to loopback, serves an explicit list of static assets and accepts no uploads or writes. It must remain running while reviewing. Stop it with Ctrl+C in its terminal when finished.

You can also open `index.html` directly in a normal browser, but browser storage behavior for file URLs varies. The loopback URL is preferred. Keep the same browser and URL to retain its local review. Do not casually switch between `localhost`, `127.0.0.1`, ports or browser profiles: these are different storage locations.

No package installation is required. Generated assets are included. After editing the methodology source or model catalog, run the build command below. The page has no remote fonts, analytics, authentication requests or runtime dependencies. A content-security policy blocks runtime connections; following a source citation can open its external website.

## Detailed methodology

Open [the reading page](http://127.0.0.1:4178/methodology) for the complete article, or [P02 in the canvas](http://127.0.0.1:4178/?screen=P02) to edit text and add comments. Use the article's contents links in Explore mode to move between sections inside the screen. C13 shows unfamiliar-model fallback details; C14 shows an image-generation benchmark reference. Both are new specimens, with no changes to existing screen IDs.

The article has a plain-language introduction, 15 detailed sections, 39 numbered references, exact equations and coefficient sources, text/image worked examples, scope rules and the dated 67-entry model/mode inventory. The source-review addendum separates published measurements from hardware assumptions and explains the validation required before claiming physical accuracy. The public reading page has no editor; changes made in the canvas remain local review proposals until incorporated into source.

```sh
node tools/build-methodology.cjs
node tools/build-methodology.cjs --check
node --test tools/offset-audit.test.cjs tools/methodology-reference.test.cjs tools/methodology-checks.test.cjs design-canvas/test.cjs
```

The canonical article is `docs/methodology/content.html`. The builder generates the marked section in `screens.js` and `methodology.html`. It verifies the reviewed numeric registry digests, displayed coefficients, example inputs/results and cohort values. The separate published-reference catalog is not a runtime factor bundle; its evidence classes, scope metadata and reviewed digest are checked too. A changed registry needs source review and an explicit method-version decision, not merely a refreshed digest. The image extractor also rejects public payloads whose digest differs from the reviewed pinned artifacts. Neither a build pass nor correct arithmetic verifies a closed provider's physical footprint.

## Review the screens

- **Board:** drag empty canvas to pan; use zoom buttons/slider, Ctrl+wheel or the keyboard while the canvas has focus.
- **Screen index:** search by ID, name, role or state; filter by group. Selecting a screen focuses it at a fitted size.
- **Focus screen:** inspect one screen. Scroll within a product screen where its content exceeds the frame.
- **Explore:** click prototype buttons to navigate between designed states. Sample forms do not submit. Decorative controls and incomplete interactions are design specimens, not implemented behavior.
- **Conversation Details:** on the host specimens, Details opens an overlay inside that same screen rather than navigating to C09. Close with ×, Back to chat, Escape or an outside click. Open in Explore mode first, then switch to Edit/Comment to review the overlay. C09 remains a reference for the detailed content. Existing screen element anchors are preserved; new overlay elements are appended.
- **Edit:** click a text element or sample text input, change text/size/color/weight/alignment in the inspector, then Apply edit. Multiline headings remain editable. Change a screen's content density, or drag its header on the board to rearrange it.
- **Comment:** select text for an anchored comment, or click the screen header for a screen-level comment. Enter feedback and Add comment. Resolve/reopen or delete with a second confirmation click. Undo can restore a deleted comment during the current session.
- **Review status:** Draft, Needs changes or Approved. Editing an approved screen returns it to Needs changes. Prototype approval does not certify production security, accessibility or data accuracy.
- **Undo/redo:** keep up to 30 review changes in the current tab session. History itself does not survive reload; saved edits/comments do.

This is not a general vector editor. It does not allow adding arbitrary widgets, rewriting layout CSS visually, rearranging elements inside product screens, or modifying navigation targets. Use comments to request structural changes. Palette edits in an element are proposals, not automatic changes to the locked global Fern tokens.

## Saving and sharing

Edits, screen positions, comments, density and review status save in **localStorage in this browser only**. Nothing is uploaded or automatically written into the source files. Check the save indicator and any warning banner. Storage failure, invalid saved data or another tab changing the review produces a visible warning rather than silently overwriting work.

**Export review** shows portable JSON in a dialog. Copy the text or request a file download. Browser download behavior varies; if no file appears, use the visible text or Copy to clipboard. Failed clipboard access selects the text for manual copying.

**Import review** accepts pasted JSON or a chosen file. It validates the schema, version, screen IDs, element anchors and allowed styles before showing a separate **Replace current review** confirmation. Import replaces, rather than merges, the current review. Export current work first. Undo is available after importing during the same session.

**Export handoff notes** provides Markdown covering all screens, review states, changed elements and comments. Give implementers:

1. This complete `design-canvas` directory.
2. Your exported review JSON, so they can restore the exact edits.
3. The Markdown handoff and the project implementation specifications.

There is no multi-user live collaboration, background synchronization to the assistant or automatic source-code application of comments. Ask for a review of your comments or share the export when ready. Do not put actual employee information, credentials or private chat content into mockups or public review files.

## Screen groups

Public website; organization setup; login/access; employee onboarding; extension; in-chat integration; organization administration; role/safety dialogs; platform operations; system states. Mobile examples and branded/provider dark themes are included. Providers are **illustrative shells**, not screenshots or verified replicas of their current interfaces.

The source includes both role-change confirmation and success specimens. The sample users table is not a live role database, so returning from a success specimen does not simulate a persisted production role change. True role authorization and persistence belong in later implementation.

## Source map

| File | Purpose |
| --- | --- |
| `index.html` | Studio chrome, editor, comments and transfer dialogs |
| `screens.js` | Screen inventory, synthetic fixtures, component templates and navigation |
| `screens.css` | Fern product tokens, screen layouts, illustrative host themes |
| `studio.css` | Review board, inspector and responsive workspace |
| `studio.js` | Pan/zoom, editing, comments, import/export and local saving |
| `review-state.js` | Portable review schema, strict validation and Markdown export |
| `serve.cjs` | Read-only loopback static server |
| `test.cjs` | Built-in Node tests; no external test packages |
| `methodology.html` | Generated standalone reading page, also served at `/methodology` |
| `../docs/methodology/content.html` | Canonical authored article with direct sources |
| `../tools/build-methodology.cjs` | Generates both article views and checks numerical/source drift |
| `../registry/` | Dated model inventory and separate numeric reference cohorts |

Element IDs are stable for this source version, `fern-v1`. Structural template changes can shift numbered anchors. Before such changes, export reviews and migrate anchors or increment the base version; do not silently apply old edits to different elements.

## Checks

### Copy style

The shared visual pass also reduces repeated card borders and oversized decorative branding, improves supporting-text contrast, and replaces decorative settings toggles with keyboard-operable preview controls. These switches reset on reload and do not change real account settings. The Fern palette and prominent 50% chat warning are retained.

The 9 September 2026 copy pass replaces slogans and internal jargon with plain language across the default screens and studio controls. Authored copy has no em dashes; missing values say Unknown. Saved reviewer edits and comments are kept exactly as written, so a saved override may still show older wording. No text anchors were reordered. Some artboards are taller to keep their content visible.

Implementers must follow [writing and code standards](../docs/implementation/WRITING-AND-CODE-STANDARDS.md), including shared module helpers and measured performance gates. This copy revision does not certify production extension performance.

```sh
node --test design-canvas/test.cjs
```

See `VERIFICATION.md` for observed checks and limitations. The original prototype source is covered by `LICENSE` in this directory. System fonts are referenced, not redistributed.
