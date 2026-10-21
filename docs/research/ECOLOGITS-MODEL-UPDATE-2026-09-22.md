# EcoLogits model repository update review

**30 September resolution:** the rejected candidate below remains unadopted. The corrected official EcoLogits 0.11.2 release was verified and adopted instead. See the [implementation and verification record](../release/ECOLOGITS-0.11.2-2026-09-30.md).

22 September 2026. **Prepared, not adopted.** The accepted tracker catalog and configuration are unchanged. An unresolved upstream timing problem prevents treating this candidate as a routine model addition. No packages were rebuilt, installed or published.

## Source and scope

The latest published PyPI version and Git tag remain `0.11.1`, at `886d1ebfadb51a2d6407fcea6d9778c997c85c35`. The [model repository update](https://github.com/mlco2/ecologits/commit/2b3630389e31414155328d1e6d0a91faa36e9409), merged through [PR 262](https://github.com/mlco2/ecologits/pull/262), changes the catalog without changing the calculation code. The inspected main revision was `5d40d5316cb3b8da0b5267d9786c4c04585d0929`; its subsequent change concerns Mistral test fixtures, not the catalog.

The candidate combines the released 0.11.1 calculation core with catalog commit `2b3630389e31414155328d1e6d0a91faa36e9409`, qualified as `models-2026-09-22`. It is not an official new package release. The normalized candidate catalog SHA256 is `dcf8a2f1e6b5e894da5f196a176250f969250429c768b80d973859debebf99e9`. Core version `0.11.1-port.2`, converter version 2, electricity factors, provider defaults and video data remain unchanged.

## Catalog changes

The complete import has 20 added models, 30 removed models, 135 modified models and three removed aliases. The accepted catalog has 344 model records plus 12 aliases; the candidate has 334 model records plus nine aliases. All 215 electricity zones, 17 video models and four hardware configurations remain available.

| Provider | Added model names |
| --- | --- |
| OpenAI | `gpt-5.6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-6-astra` |
| Anthropic | `claude-fable-5`, `claude-fable-5-1`, `claude-opus-5`, `claude-sonnet-5` |
| Google | `gemini-3.5-flash-lite`, `gemini-3.6-flash`, `gemini-3.7-flash`, `gemini-3.8-flash` |
| Mistral | `glm-5-2`, `labs-leanstral-1-5`, `labs-leanstral-1-5-1`, `mistral-code-fim-latest`, `zai-glm-5`, `zai-glm-5-2`, `zai-glm-5-3`, `zai-glm-latest` |

The modifications include 135 deployment timing changes and three architecture/parameter changes. Cohere Command A Plus corrects its malformed MoE parameter structure to total 218B, active 25B. Mistral Large 2512 and its latest name change from dense 123B to MoE total 675B, active 41B, and gain the multimodal warning. These are upstream estimates and corrections, not physical calibration established by this review.

The [machine-readable analysis](ecologits-model-update-2026-09-22/analysis.json) contains all additions, removals, aliases, field changes, source hashes and numerical check metadata. Removed upstream records would leave the new active catalog; the prior accepted snapshot and saved original results must remain preserved through adoption. Retaining a snapshot does not establish native recomputation support for every archived method.

## Timing finding and adoption decision

The unchanged [upstream generation latency function](https://github.com/mlco2/ecologits/blob/886d1ebfadb51a2d6407fcea6d9778c997c85c35/ecologits/impacts/llm.py#L66) defines TTFT in seconds and adds it directly to output tokens divided by tokens per second. The new catalog changes GPT-5.5 TTFT from 3.38 to 2620.75, Claude Opus 4.8 from 1.63 to 1145.75, and Gemini 3.1 Pro from 4.32 to 2680.75. These magnitudes suggest a unit problem, but milliseconds have not been confirmed and no conversion was guessed.

[Upstream issue 264](https://github.com/mlco2/ecologits/issues/264), opened on 22 September, independently reports the unusually large TPS/TTFT changes. It had no comments at inspection. The issue also identifies `google_genai/gemini-2.5-flash-image` with TPS 0 and TTFT 12008. That zero throughput is present in the downloaded candidate; a successful catalog import is not proof that every record is suitable for product calculation.

The following comparisons use the same 500 output tokens, unchanged environment, and the midpoint of operational energy in kWh. No captured request latency is supplied:

| Model | Accepted energy | Candidate energy | Candidate / accepted |
| --- | ---: | ---: | ---: |
| GPT-5.5 | 0.003303954 | 0.068624110 | 20.77 |
| Claude Opus 4.8 | 0.002332443 | 0.028827060 | 12.36 |
| Gemini 3.1 Pro | 0.006687612 | 0.128164693 | 19.16 |

Captured timing can limit the impact: all three examples are unchanged with a 10-second latency cap. With a 60-second cap they increase by about 33%, 50% and 33%, respectively. Historical observations without suitable timing remain exposed to the much larger modeled-time changes. This affects water and carbon calculations too; passing cross-runtime parity only proves that both implementations reproduce the selected upstream behavior.

**Decision:** retain the accepted runtime while the timing issue is unresolved. The user was asked whether to hold activation or explicitly accept the unchanged upstream values with this limitation documented. No response or authorization to accept those values has been inferred. No GitHub comment, issue or other message was sent.

**Owner decision and accuracy check, 27 September 2026.** The owner asked to accept the update only if it is accurate. It is not accurate, so it remains unadopted.

The check compared the published catalogs at `886d1eb` (accepted) and `2b36303` (candidate):
- All 141 candidate records with a TTFT value exceed 60 s. The median is 1,085 against 1.01 s in the accepted catalog.
- Divided by 1,000, the candidate values match the accepted range: median 1.08 s, 10th to 90th percentile 0.35 to 4.28 s. The upstream formula nevertheless adds TTFT as seconds.
- The 20 added models, including Claude Fable 5.1, Opus 5 and Sonnet 5, GPT-5.6 and the Gemini 3.x Flash models, come from the same pipeline and carry the same millisecond-scale values. Two of them have no timing at all.
- Throughput is also implausible for some records. It falls to 1 token per second for GPT-5.4 Pro and the dated GPT-5 Pro, and to 0 for Gemini 2.5 Flash Image, which makes its modeled latency infinite.
- Issue 264 is still open. The maintainer replied on 23 September that a patch will be applied to the upstream pipeline that generates this file, and that current releases are not affected. No catalog commit, pull request or release has followed; PyPI is still 0.11.1.

The accepted 0.11.1 catalog, whose timing is in seconds, stays in use. A corrected upstream catalog needs a fresh stage and the full verification above before the owner's acceptance applies to it.

## Prepared tracker mappings

The [proposed mappings](ecologits-model-update-2026-09-22/proposed.estimation.mappings.json) add 13 direct consumer-to-API assumptions to the existing seven:

| Observed site | Newly direct labels |
| --- | --- |
| ChatGPT | GPT-5.6 Sol, GPT-5.6 Luna |
| Claude | Fable 5, Fable 5.1, Opus 5, Sonnet 5 |
| Gemini | 3.6 Flash |
| Perplexity | GPT-5.6 Terra, GPT-5.6 Sol, Claude Sonnet 5, Claude Opus 5, Gemini 3.8 Flash, Gemini 3.7 Flash |

The [proposed policy](ecologits-model-update-2026-09-22/proposed.estimation.build.json) removes the six obsolete Perplexity overrides so they no longer take precedence over the new direct mappings. Existing provider fallback choices, the GPT-5.5 unknown-provider benchmark, engine defaults and explicit user preferences remain unchanged.

The repository already recognizes these 13 labels, so no capture or tokenizer changes are required. Direct mapping means a reviewed name correspondence, not proven API equivalence or hardware accuracy. Unvalidated-reference and assumed-provider-environment disclosures remain applicable. Ambiguous labels such as GPT-6 Pro, Sol Pro, generic latest labels and thinking modes are not assigned speculative new API identities. Mistral-hosted GLM entries do not establish Perplexity's hosting provider. The complete library includes GPT-6 Astra, but the current GPT-6 Pro consumer label has no verified binding to it.

## Verification and reproducibility

- Downloaded the immutable core/catalog source archives and PyPI artifact through the existing update tool. Exact artifact hashes are retained in the private stage.
- Candidate verification with `--cases 10000` passed **24,180** actual candidate-Python versus candidate-TypeScript cases, with no mismatches. Accepted-to-candidate outputs changed in 824 cases, including catalog metadata and model additions/removals.
- Deterministic catalog generation passed. Relevant calculation source, dependency metadata, license and citation checks reported no changes requiring a new port or legal review.
- Validated both proposed product configuration schemas, every configured fallback reference, all 20 direct mappings against the recognized model IDs and candidate catalog, and every direct selection result.
- All 20 direct mappings produced valid raw impacts for 500 output tokens both without a latency cap and with a 10-second cap. This is a reference calculation check, not live provider or browser validation.
- Calculated the nine accepted/candidate timing scenarios in the machine-readable analysis. No runtime or installed extension was changed, so no native browser or release test is claimed.

The private stage is `.git/ecologits-model-update-2026-09-22`. It contains unchanged artifacts, the accepted baseline, generated candidate outputs, sealed mechanical verification, proposed product configuration and `REVIEW-NOT-APPROVED.md`. The tool's `passed` report is a mechanical parity result; it does not clear the timing finding.

To reproduce staging against the still-accepted baseline, choose a fresh staging directory:

```powershell
node tools/ecologits/update.mjs --version 0.11.1 --core-commit 886d1ebfadb51a2d6407fcea6d9778c997c85c35 --catalog-commit 2b3630389e31414155328d1e6d0a91faa36e9409 --qualified-label models-2026-09-22 --stage <new-directory>
node --import tsx tools/ecologits/verify-update.mjs --stage <new-directory> --cases 10000
```

Once the timing disposition is settled, adoption must update the catalog and product mappings together, verify current edit preconditions, preserve the previous snapshot, run estimator/native-server regression and parity checks, and rebuild the intended browser artifacts. A corrected upstream commit needs a fresh stage and new verification. This report does not authorize publishing or deployment.

EcoLogits is developed by its contributors and is part of CodeCarbon. Its covered source remains MPL-2.0. Citation: Samuel Rincé and Adrien Banse (2025), *EcoLogits: Evaluating the Environmental Impacts of Generative AI*, Journal of Open Source Software, 10(111), 7471, DOI [10.21105/joss.07471](https://doi.org/10.21105/joss.07471). Original source/license/citation bytes remain intact in the staged artifacts.
