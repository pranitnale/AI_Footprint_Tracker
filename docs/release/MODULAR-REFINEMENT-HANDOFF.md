# Modular refinement: local build handoff

15 September 2026. Local implementation and unsigned package verification are complete. Native-browser testing is pending at the owner's request. Production release acceptance is not complete. No commit, push, deployment or publication was performed.

## Implemented

- Separate provider, counting, estimation, storage, organization and presentation contracts, with actual replacement tests and import/build enforcement.
- Preserved Original calculations alongside the independent EcoLogits 0.11.1 TypeScript text/video port and full pinned catalog. Video capture remains inactive.
- Developer-selected default and Advanced user override, automatic guarded recalculation of saved numerical observations, retained originals, explicit provider-flagship or Original fallback and operational-only headline carbon.
- Staged upstream update, verification, adoption and rollback, with actual adopted-catalog application/native checks, source identities, MPL notices, credit and matching modified source.
- Encoder dictionaries confined to workers. Checked capture/content scripts are 226,906/259,781 bytes, versus 3,964,784/3,997,659 in the rejected diagnostic candidates. These are static sizes, not RAM measurements.

The [extension guide](../../apps/extension/README.md) describes module ownership and replacement points. The [implementation record](MODULAR-REFINEMENT-STATUS.md) and [176-criterion audit](MODULAR-ACCEPTANCE-AUDIT.md) retain detailed evidence and limitations.

## Verified local checks

- All workspace JavaScript/TypeScript suites pass. Extension: 818 passed, one documented skip; no failures.
- Full server/journal tests: 755 passed, one PostgreSQL-only skip; lint passes.
- Workspace typecheck, 16 module/verification tests, 17 upstream-maintenance tests, documentation, calibration, comparison, release-tool and dependency checks pass within their recorded scopes.
- All six variants reproduce byte-for-byte from their matching source archive: 89 entries each, no missing, extra or changed files.
- Independent final artifact review is CLEAN for package contents, actual defaults, source, notices, private routes, worker placement and website downloads.
- Package privacy pattern scan has no high-confidence findings or scanner errors. It is not binary semantic or general privacy certification.
- Actual packaged file worker: 14/14 synthetic text/Office/PDF checks pass in the in-app browser. This is not installed-extension or cross-browser testing.

The initial monolithic `pnpm check` failed and its log is retained. Subsequent corrected stages passed separately. Do not describe the initial command as successful or add overlapping test counts.

## Packages

Each variant includes both engines and the Advanced override. The checked-in default remains Original. Existing unpacked installations should keep their stable directory and identity; a separately loaded variant is not an automatic migration of another installation's storage.

| Browser | Default   | Local archive                                                                                                                                  | SHA256                                                             |
| ------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Chrome  | original  | [ai-footprint-tracker-0.1.0-chrome-original.zip](../../artifacts/browser/chrome/original/ai-footprint-tracker-0.1.0-chrome-original.zip)       | `f3579b97e0a3a827c593d5b7ae4e0a11a69ffd87a0bea39c9f2fbdf501095859` |
| Chrome  | ecologits | [ai-footprint-tracker-0.1.0-chrome-ecologits.zip](../../artifacts/browser/chrome/ecologits/ai-footprint-tracker-0.1.0-chrome-ecologits.zip)    | `751a04ad88d519ec3c33135959ed5414c2d88cdac39bafdd3d2e5c232441326f` |
| Edge    | original  | [ai-footprint-tracker-0.1.0-edge-original.zip](../../artifacts/browser/edge/original/ai-footprint-tracker-0.1.0-edge-original.zip)             | `cddb79c8468d2f466fef72d947c79aea9582359533abe5e6ab2e61a666c2e6c5` |
| Edge    | ecologits | [ai-footprint-tracker-0.1.0-edge-ecologits.zip](../../artifacts/browser/edge/ecologits/ai-footprint-tracker-0.1.0-edge-ecologits.zip)          | `15c5b3d822fb9f37613227c7e83693d8a5cfbdc9355a3551a8b4f1189ffa5fb2` |
| Firefox | original  | [ai-footprint-tracker-0.1.0-firefox-original.zip](../../artifacts/browser/firefox/original/ai-footprint-tracker-0.1.0-firefox-original.zip)    | `a512bfd719007600477471b58d1e3d4718dba7d5fa0767deb45a1a208c9c746c` |
| Firefox | ecologits | [ai-footprint-tracker-0.1.0-firefox-ecologits.zip](../../artifacts/browser/firefox/ecologits/ai-footprint-tracker-0.1.0-firefox-ecologits.zip) | `72737b3ea86d3edb03ef7af01beccfdd9a3f065e305cd9b7ca8c5710fbd16669` |

Browser corresponding source: [ai-footprint-tracker-0.1.0-sources.zip](../../artifacts/browser/ai-footprint-tracker-0.1.0-sources.zip), SHA256 `787df8d014444e7405c229ac64f10855a2625b51c6f5f340c4a5973ca75a26b4`.

Verified source fingerprint: `f29da53bf84dd974afc0fce2ed3903d462d995ccee3d8510136571987f07f045` over 519 selected files. See [source reproduction](../../artifacts/browser/source-verification.json), [independent artifact review](MODULAR-ARTIFACT-INDEPENDENT-REVIEW.md) and [in-app worker evidence](../../artifacts/browser/file-worker-browser-check-2026-09-15.json).

## Remaining release conditions

- Native Chrome/Edge/Firefox installation, provider combinations, upgrade/lifecycle, accessibility and CPU/RAM/latency measurements remain pending. The owner chose to leave native testing pending on 15 September. Browser tooling rejected the extension-management URL; no alternate route bypassed that restriction.
- Real PostgreSQL migration, transaction/recovery, restore and load checks require an explicitly approved isolated environment. The prior Windows Application Control denial remains respected; no target or credentials were inferred.
- Complete upstream Git attestation and applicable public source/distribution, signing/store and production configuration evidence remain distinct from the verified local hashes and notices. These are listed in the acceptance audit.

Resume native or external verification only when the owner supplies the required environment or changes the pending instruction. The current local packages and source evidence are ready for that next step.
