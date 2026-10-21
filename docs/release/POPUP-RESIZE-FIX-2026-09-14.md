# Chrome toolbar popup sizing correction

Recorded 14 September 2026. This note covers one toolbar-popup defect and its bounded verification. It is not a release certificate or a claim that the complete application passed native verification.

## Observed defect

The user opened the locally installed Chrome extension from the toolbar on a 3,440-pixel-wide monitor. Native Chrome 152.0.7977.84 screenshot snapshots showed outer popup bounds, including the Chrome border, changing from 201 by 614 pixels to 351 by 614 pixels without interaction. Content was squeezed, the brand wrapped and controls were clipped.

The popup stylesheet requested a 760-pixel application width but changed the shell to `100vw` and `100vh` whenever the action-popup viewport began below 620 pixels. Chrome [automatically sizes action popups to their HTML content](https://developer.chrome.com/docs/extensions/reference/api/action#popup). The narrow initial viewport therefore selected a viewport-relative width that resolved back to the same narrow viewport. Wrapping, document scrolling and asynchronous content then changed the intrinsic dimensions again. The source and installed build had no resize observer, resize listener or animation driving the change.

## Correction

- [`popup/index.html`](../../apps/extension/entrypoints/popup/index.html) marks the action-popup document as a popup surface.
- [`app.css`](../../apps/extension/lib/app.css) gives the popup-only `html`, `body` and root an intrinsic 760 by 580 pixel size. The child shell is capped to the actual viewport, remains fixed at the viewport origin and clips document overflow. Header, tabs and footer do not shrink; the named main region owns keyboard-accessible scrolling with a stable scrollbar gutter. Long connection addresses can wrap. Dialogs retain their existing viewport-bound scrolling.
- Expanded dashboard width now uses the containing block rather than `100vw`, so the page scrollbar gutter cannot create lateral overflow.
- [`App.tsx`](../../apps/extension/lib/App.tsx) names the popup main region for keyboard users. A failed initial dashboard request now shows usage scope, connection and synchronization as unavailable. It does not claim connected-installation scope, an undefined organization or a verified zero queue. A successful retry restores the authoritative mode and queue count.

The first intrinsic-root correction exposed a reduced-height keyboard issue: at 320 by 300 pixels, focus movement scrolled the fixed-size document by 37 pixels and moved the application and header above the viewport. Fixing the popup shell to the viewport origin kept document scroll at zero while allowing only the main region and dialogs to scroll.

## Bounded verification

Root exercised the actual application and current CSS in real Chromium frames at 760 by 580, 400 by 400, 320 by 300 and 201 by 600 pixels. At 320 by 300, the Connect control remained fully visible with main scroll 330, root scroll 0, application y 0 and header y 18. The Settings dialog scrolled 261 pixels; Shift+Tab reached Save, forward Tab remained trapped in the dialog and Escape restored focus to Settings. Expanded views at 375, 760 and 1,200 pixels had no horizontal overflow.

The normal popup remained 760 by 580 through delayed loading to loaded content, visible initial error to successful retry, and custom-date filter expansion and application. The final keyboard, dialog and filter capture contained zero `Runtime.exceptionThrown` events and was not truncated. One earlier development-harness session recorded a `MutationObserver` startup message during a failed browser-inspection evaluation and reload. The identical message reproduced on a static control page whose iframe contained no application code. This separates that harness message from the application without describing all historical console output as clean.

The focused popup sizing and application tests passed 17 of 17 and independent source review returned CLEAN. The full extension suite, run with concurrency 2, passed 370 tests with one existing Windows symlink skip and exit code 0; its log is `.test-runtime/popup-resize-final-extension-tests.log`. A default parallel run encountered two unchanged five-second relay timeouts. The isolated relay suite passed 4 of 4, and the bounded full run passed without increasing or weakening the timeout.

[The focused popup release report](../../artifacts/browser/popup-resize-release-20260914.json) records a 213-file input fingerprint of `106eff078cd425c2e33d0d5afc2b5b2f8f0e83cd147ad88563cf12bdfc7ea7fb`, a matching source archive and exact 77-entry clean-source reconstruction for Chrome, Edge and Firefox. Archive integrity, the popup marker, permissions, relay exposure, notices, website copies and the 907-item package privacy scan passed. Two initial source-verification attempts retained masked Vite import failures from long temporary locations; the same archive, frozen dependencies and Node guard passed from an explicitly approved short profile directory. This supports path/environment sensitivity but does not establish exact path-length causation. The earlier broad release check remains unchanged.

[The conductor verification report](../../artifacts/browser/popup-resize-conductor-verification-20260914.json) independently matches the current manifest and source report, verifies the command-log hashes and preserved broad release report, and records a successful final typecheck. The Downloads page exposed all three expected current package links. This verification keeps the native after-reload state pending.

The final rebuilt toolbar popup still needs the user to reload or reopen the installed unpacked extension and confirm stable native bounds. The frame checks do not replace that final toolbar observation. Native Edge and Firefox popup behavior, store packaging, signing and the broader provider/browser matrix remain separate unverified gates. No raw screenshot or personal information is stored with this note.
