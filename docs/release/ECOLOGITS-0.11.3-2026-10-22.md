# EcoLogits 0.11.3 model update

22 October 2026. The tracker now uses the EcoLogits 0.11.3 model catalog. This record covers the local update, the tests and the builds. It is not a publication record. The version of the tracker stays 0.1.0, because the extension has not been published.

## Source

- EcoLogits 0.11.3 was published on PyPI on 14 October 2026. The Git tag `0.11.3` resolves to `d0b76e382442e63df688e9c37016f596223c8aff`.
- PyPI source archive SHA256: `8887d7ac04a8368e73363f911a814f3a643e51bc0ead9da31179bd2cc03f5964`. GitHub source archive SHA256: `22e80002d208239377db3c8c4ad3e2e9037e7d78698e20e8c64dfc2e2c9cbf6c`.
- The update workflow (`tools/ecologits/update.mjs`, `verify-update.mjs`, `adopt.mjs`) downloaded, compared and adopted the release. The lock is `packages/ecologits-core/upstream/lock.json`; the source snapshot is `packages/ecologits-core/upstream/ecologits-0.11.3/`.

## What changed upstream

Only model data changed. The calculation functions, electricity mixes, provider settings, aliases and video data are the same as in 0.11.2.

- Three model records were added: `anthropic/claude-haiku-5-5`, `mistralai/mistral-large-4` and `mistralai/mistral-large-4-0`. None was removed.
- 104 model records have new measured speed values (tokens a second and time to first token). Nothing else changed in these records.
- For GPT-5.5 Pro (both names) the measured speed was removed. EcoLogits then uses its regression for the generation time, so this model's estimate goes up.
- The package metadata allows `wrapt` up to, but not including, 3.0.0 (before: 2.0.0). A review bound to the exact candidate hash accepted this change. No other dependency changed.

The catalog now has 342 models, 9 aliases (351 names), 215 electricity zones and 17 video models.

## What the tracker changed

- **Claude Haiku 5.5 has its own record.** claude.ai labels for Haiku 5.5 now map directly to `claude-haiku-5-5` (`config/estimation.mappings.json`, registry id `claude-haiku-5-5`). Before, they used Claude Haiku 4.5 as a family stand-in. Details now names the exact record.
- **Stand-ins follow the newest records.** The generated family stand-ins (`tools/estimation-family-stand-ins.ts`) now use `claude-haiku-5-5` for an unknown Claude Haiku version and for a Claude mini, nano or lite variant, on claude.ai and on Perplexity. Claude Haiku 3 and 3.5 keep their nearest record, Claude Haiku 4.5. The policy version is `ecologits-0-11-3-2026-10-22`.
- **The smaller-model comparison in Details uses Claude Haiku 5.5 for Claude and Cowork chats.** Haiku 5.5 is the Haiku people can choose on claude.ai, and its record uses slightly less electricity than Haiku 4.5. See `docs/methodology/EVERYDAY-COMPARISONS-2026-10-12.md`.
- **The server uses the same release.** `apps/server` pins `ecologits==0.11.3`, and the native engine accepts only that version.
- **The methodology names 0.11.3**, its commit, the new worked example and the check date of all links (22 October 2026). The tracker-side pages, the reference page and the website were regenerated.
- The TypeScript core identity stays `0.11.1-port.2`, because the calculation code did not change.

Nothing changed in capture, counting, storage or the compact bar. The method identity changes with the catalog, so saved results are recalculated by the existing method-change handling. The original results are kept.

## Not adopted

- **The npm package `@ecologits/ecologits.js`.** Version 3.0.0 of 13 October 2026 is a separate TypeScript port with the model data compiled in. That data is from 0.11.2 (it has no Claude Haiku 5.5). The tracker keeps its own port, which is checked case by case against the pinned Python release. A change to the npm package would need its own parity review.
- **Open upstream proposals.** Changes that are not in a release, for example draft pull requests, are not used. The tracker adopts only published, pinned releases.

## Effect on figures

Electricity midpoint for 500 output tokens without measured timing, from the tracker's port with the 0.11.2 and the 0.11.3 catalogs. These are modelled values, not measurements.

| Model | 0.11.2, Wh | 0.11.3, Wh | Change |
| --- | ---: | ---: | ---: |
| GPT-5.5 | 3.230 | 3.141 | -2.8% |
| GPT-5.5 Pro | 129.2 | 191.9 | +48.5% |
| GPT-5 Pro | 61.38 | 40.95 | -33.3% |
| GPT-5.4 Pro | 159.7 | 121.1 | -24.2% |
| o1 | 1.925 | 0.938 | -51.3% |
| GPT-5.1 | 0.897 | 0.813 | -9.3% |
| GPT-6 Sol | 0.929 | 0.908 | -2.3% |
| GPT-6.1 Sol | 0.978 | 0.960 | -1.9% |
| GPT-6 Luna | 0.069 | 0.070 | +1.8% |
| Claude Opus 5.5 | 2.343 | 2.285 | -2.5% |
| Claude Sonnet 5.5 | 0.765 | 0.745 | -2.6% |
| Claude Opus 5 | 2.706 | 2.267 | -16.2% |
| Claude Sonnet 5 | 1.038 | 0.756 | -27.2% |
| Claude Opus 4.8 | 2.225 | 2.219 | -0.2% |
| Claude Haiku 4.5 | 0.057 | 0.055 | -4.1% |
| Claude Haiku 5.5 | not in catalog | 0.053 | new |
| Gemini 3.1 Pro | 8.781 | 6.617 | -24.6% |
| Gemini 3.8 Flash | 2.439 | 2.287 | -6.2% |
| Gemini 3 Flash | 1.454 | 1.431 | -1.6% |
| Mistral Medium 3.5 | 0.320 | 0.280 | -12.4% |
| GLM 5.3 | 1.979 | 1.979 | 0.0% |

Most current models change by a few percent. Older models with old speed data change more. GPT-5.5 Pro goes up because its speed data was removed upstream; the tracker uses GPT-5.5 Pro only for a GPT Pro of a generation without a known family. When a site gives the measured reply time, the tracker uses it, so these differences are smaller in practice.

## Verification

- Candidate verification: 2,243 candidate Python and candidate TypeScript cases agree; 644 changes from the accepted catalog to the candidate; generation is deterministic.
- Full run on the VPS test container (commit `35b55f2`): all type checks, the catalog and stand-in checks, the web build and suite (168 tests), documentation (107), privacy (26), release tools, refinement (8), calibration (13), ruff and the Chrome build passed. Packages: contracts 59, adapters 220, capture-core 25, ledger 259, tokenizers 16 and UI 23 tests passed.
- That run found tests that still expected 0.11.2 values: GPT-5.5 timing in the core, a storyboard and an image total in the estimator, Haiku 4.5 as the server's stand-in (4 server tests and the native/TypeScript parity test), the popup and dashboard parity answers (energy only; 56 entries, counts unchanged) and the number of excluded upstream files in the maintenance workflow test. They now expect the 0.11.3 values or read them from the adopted manifest. The maintenance tests also needed the oracle's packages in the container's offline cache.
- Two extension tests timed out while the VPS was under heavy load (file relay, synthetic API start) and passed on the rerun.
- A module boundary check that had failed since earlier October work now lists each reviewed exception with its reason.
- Reruns after these fixes: EcoLogits maintenance 17 of 17, documentation 107 of 107, EcoLogits core 20 of 20, estimator 150 of 150, verification 16 of 16, the affected server tests 75 of 75 and the affected extension tests 51 of 51 passed. Full server suite on `35b55f2`: 1,088 passed and 23 skipped; the 5 failures were the Haiku expectations fixed above. Full extension suite: 1,906 of 1,911 passed; the 5 failures were the 3 parity answers and the 2 timeouts above.
