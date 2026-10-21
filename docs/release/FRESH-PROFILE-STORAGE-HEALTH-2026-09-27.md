# Fresh-profile storage health

On 27 September 2026 a fresh Chrome for Testing 151 profile showed the red "!" badge right after the unpacked Chrome build loaded, before any chat activity. The popup reported `ledger_integrity_failed` ("One or more observations could not be confirmed in local storage"), one occurrence, scope This extension, held in memory only. It also said the saved calculation choice was unavailable. The owner's normal Chrome 154 profile did not show the badge.

## Finding

A clean install does not trip the ledger integrity check. The badge came from the test setup: the profile folder path was too long for Windows.

- Chrome could not create the extension's IndexedDB files, so the first `indexedDB.open` in the service worker failed with `UnknownError: Internal error opening database with version 15`. No stored observation was read.
- `Ledger.open()` rejected, so every popup request failed with the same error and the popup could not load the saved calculation choice.
- `failureCode` in `apps/extension/lib/health.ts` treated only `QuotaExceededError`, `InvalidStateError` and `AbortError` as storage failures. Every other error became `ledger_integrity_failed`, so the storage failure was mislabelled as a ledger problem.

## Native reproduction

Chrome for Testing 151 (Playwright `chromium-1234`) loaded `apps/extension/.output/chrome-mv3` with `--load-extension` into new, empty profiles. The only seeded file was `Default/Preferences`. A pipe-connected CDP client paused the extension's service worker before its first line and recorded every exception. It then read the badge and the popup text.

| Profile folder path length | Result |
| --- | --- |
| About 50, 100, 115, 125 characters | No exception, empty badge, "No unresolved tracking problems reported" |
| 135, 140, 145, 160, 175 characters | `UnknownError` on the first open, "!" badge, the reported health entry |
| About 215 characters | Chrome could not create several of its own databases, and the extension did not load |

A run without the debugger on a short path also stayed clean. Chrome's default profile path is about 50 characters, well below the failure range. Keep test profile folder paths short on Windows, for example under `%LOCALAPPDATA%\Temp`. A long session scratch folder is not suitable.

## Change

- `failureCode` now also treats the IndexedDB `UnknownError` as `storage_write_failed`. The IndexedDB specification reserves this error for failures unrelated to the database contents. Other errors keep their previous codes, including `ConstraintError`, which remains `ledger_integrity_failed`.
- A browser that cannot open its database still shows the badge, because nothing can be recorded. The popup now shows "Browser storage failed. Recent observations may be missing." instead of the integrity message.
- The compact resource bar is unchanged. Capture failures with this error now use the existing compact Browser storage failed label.

## Verification

- New tests:
  - `file-grant-background.test.ts`: the actual background entrypoint starts on a fresh, empty ledger with no health issue and no badge. Startup storage failure is covered for both `InvalidStateError` and `UnknownError`, including the badge, the engine-status reply and the absence of `ledger_integrity_failed`.
  - `health.test.ts`: `Ledger.open()` passes Chrome's `UnknownError` through unchanged, the reporter counts it once as a storage failure, and `ConstraintError` stays an integrity failure.
- Both `UnknownError` tests fail on the previous `health.ts` and pass with the change.
- The rebuilt Chrome output, run natively: a 145-character profile path shows "storage write failed" with "Browser storage failed"; a 53-character path stays clean.
- Edge and Firefox were not rechecked natively. The change is shared code with no browser-specific branch.
