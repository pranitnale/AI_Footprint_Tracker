# EcoLogits model data of 19 November 2026

22 November 2026. The tracker now uses the model catalog and grid data of the EcoLogits development branch at commit `7b8bc036376d4b4dd08596323383c78ae1e116d7` (model refresh of 19 November 2026), with the calculation code of release 0.11.3. No EcoLogits release contains this data yet. Owner decision of 22 November 2026: carry the newest record for every model. This record covers the local update and the tests. It is not a publication record.

## Source

- Release 0.11.3 (tag `0.11.3`, commit `d0b76e382442e63df688e9c37016f596223c8aff`) is still the latest release. Upstream `main` was 27 commits ahead on 22 November.
- Between the two, the calculation code (`impacts/*`, `tracers/utils.py`) is unchanged. Upstream changed tracers, added a tracking module and fixed how model sources are read; none of that affects the figures.
- The update workflow adopted a qualified combination labelled `main-7b8bc036`: the Python code and the PyPI package stay on 0.11.3, and only `models.json`, `electricity_mixes.json` and `video_models.json` come from `7b8bc03`. The lock says `release_kind: qualified_combination` and `official_release_claim: false`; the snapshot is `packages/ecologits-core/upstream/ecologits-0.11.3-qualified-main-7b8bc036/`.
- Verification on the test server passed: 2233 Python cases, TypeScript parity, no blocking findings, no license, citation or dependency review needed. Catalog source archive SHA256 `93d260d64186d23fde1d2aa8c0765aa217e2919397dc118c39dee9a943294549`.
- `tools/ecologits/update.mjs` read the preconditions of its adoption targets before it added the PyPI metadata file, so adopt refused the already adopted `upstream/pypi-0.11.3.json`. The file was removed before adoption and written again with identical bytes, and the ordering is fixed.

## What changed upstream

- Ten models added: `anthropic/claude-fable-5-2`, `google_genai/gemini-4-argon`, `gemini-4-carbon`, `gemini-4-hydrogen`, `gemini-4-neon`, `openai/gpt-6.1-terra`, `gpt-6.2-astra`, `gpt-6.2-sol` and two Mistral models.
- 40 models removed: 34 older OpenAI models (GPT-3.5 and GPT-4 names, search previews, chat-latest and Codex aliases, o1, o3-mini, o4-mini and dated snapshots) and 6 Mistral models. Six Azure aliases of GPT-3.5 went with them.
- 87 models have new measured speeds. The parameters of three Gemini aliases and of `mistral-large-latest` changed.
- The carbon factor of the CAF grid changed from 0 to 0.024. No provider default uses it.

The catalog now has 312 models, 3 aliases, 215 electricity zones and 17 video models.

## What the tracker changed

- **Claude Fable 5.2 has its own record.** claude.ai's default model `claude-fable-5-2` is a registry id with a direct binding. Before, it used Claude Fable 5.1 as a family stand-in. Its context window is 1 million tokens, from Anthropic's model page.
- **Stand-ins follow the newest records.** An unknown Fable version uses Fable 5.2, an unknown GPT Sol or Astra version GPT-6.2 Sol or Astra, and an unknown Terra version GPT-6.1 Terra.
- **New models the sites offer have their own ids.** A read-only look at the sites' model lists on 23 November 2026 found them: ChatGPT offers GPT-6.2 Sol, GPT-6.2 Astra and GPT-6.1 Terra (each with a Pro reasoning id); Perplexity offers GPT-6.2 Sol and Astra (with Pro ids), Claude Fable 5.2 and Gemini 4 Argon, Carbon, Hydrogen and Neon, also as Computer orchestrators; the Gemini app offers 4 Hydrogen, now its default, and 4 Neon. Each id binds its own record. Perplexity's Claude Fable 5.1 id, which used the Fable stand-in, now binds Fable 5.1.
- **Retired OpenAI models.** The tooling cannot keep records that upstream removed. The registry ids stay, because old chats carry them, and each uses the remaining record closest in figures at 100, 500 and 2000 output tokens: GPT-4 uses GPT-6 Astra (-6% to +2%), GPT-3.5 uses GPT-5 mini (+2% to +13%), o3-mini and o4-mini use GPT-4o mini (-25% to +6%), and o1 uses GPT-6.1 Sol (0 to +12%), all with basis `nearest_record` (owner approval of 22 November 2026). Details names the stand-in.
- **GLM 5.2 and 5.3** now carry speeds measured on Mistral's platform (90 and 100 tokens a second), and the tracker uses them (owner decision of 22 November 2026).
- **Benchmarks stay.** OpenAI `gpt-6.1-sol`, Anthropic `claude-opus-5-5` and Google `gemini-3.8-flash`.
- Policy `ecologits-0-11-3-main-7b8bc036-2026-11-22`. The TypeScript core identity stays `0.11.1-port.2`.

## The published 0.1.0 extension

The server pins `ecologits==0.11.3` and loads the qualified data as an overlay. Uploads from 0.1.0 name a method of the plain 0.11.3 release. Before this change the server refused any method whose catalog differed from its own, so those uploads would have stayed pending and dropped out of company totals. Now an archived method with the plain release's core runs on the installed package's own data (`RELEASE_CATALOG_SHA256` in `apps/server/aift/engine_adapter.py`), and only when those three data files have the release's own hashes. Any other catalog stays unavailable, and no method is replaced silently. This path is tied to this one release catalog: the next catalog update must carry the method the published extension then uses forward in the same way. Deploy the server before any extension that sends `claude-fable-5-2`, because an older server's schema rejects that id.

## Effect on figures

500 output tokens, modelled timing, energy midpoint, from the server's own EcoLogits 0.11.3 code:

| Model | Before | After | Change |
| --- | --- | --- | --- |
| Claude Opus 5.5 | 2.28 Wh | 2.25 Wh | -1% |
| GPT-6.1 Sol (OpenAI benchmark) | 0.96 Wh | 0.95 Wh | -1% |
| Gemini 3.8 Flash | 2.29 Wh | 2.29 Wh | 0% |
| Claude Fable 5.2 (before: Fable 5.1 stand-in) | 7.57 Wh | 6.16 Wh | -19% |
| Unknown GPT Sol version (before: 6.1 Sol, now 6.2 Sol) | 0.96 Wh | 0.92 Wh | -4% |
| Unknown GPT Astra version (before: 6 Astra, now 6.2 Astra) | 9.51 Wh | 8.20 Wh | -14% |
| Unknown GPT Terra version (before: 5.6 Terra, now 6.1 Terra) | 1.03 Wh | 0.38 Wh | -63% |

Larger moves elsewhere: GPT-5.5 Pro and the GPT Pro stand-in -37% (measured speed added upstream), GPT-5 Pro +28%, GLM 5.2 and 5.3 -33%, GPT-5 nano -15%. All other mapped records change by 6% or less. Saved original results stay unchanged; the changed method hash starts the existing recalculation flow.

## Not verified

- Live chats with the new models in the installed extension. The labels come from the sites' model lists and the Gemini picker, not from a captured reply; the label a saved Gemini 4 reply carries is not seen yet.
