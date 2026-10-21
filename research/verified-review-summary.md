# Verified outcome of the Claude Code research audit

Date: 7 September 2026. Status: completed with documented empirical gaps.

Claude Code reviewed the research using `claude-fable-5`, requested at `xhigh` effort. The CLI confirmed the model and completed both the independent audit and a focused correction pass. Across the two runs it made 47 WebFetch calls and 10 WebSearch calls, with no tool-permission denials. These are call counts, not a claim that every URL was successfully retrieved. Claude Code's built-in web processing also reports auxiliary Haiku usage; the reviewing model was Fable 5.

Read the [original independent audit](claude-independent-audit.md) together with its [correction addendum](claude-audit-corrections.md). Both preserve Claude Code's final responses verbatim. This document is the host's reconciled assessment, incorporating direct primary-source checks. The baseline research report and PDF were not overwritten.

## Outcome

The audit supports the original project's feasibility and its central architecture: a clean MV3 extension, model-specific tokenizers, four website adapters, local accounting, explicit uncertainty, and numerical-only company synchronization. It found additional useful evidence and a stronger development capture approach. It did not establish an existing extension that already provides exact complete request counts across all four consumer services.

Claude Code assessed all 13 report sections. Its design verdicts are engineering judgments, not proof of a working extension. Some sources were inaccessible or not independently re-fetched, and no live conversation, tokenizer calibration, extension installation, or physical power measurement was performed.

## Improvements to carry into implementation

1. **Use free model-specific Claude token counting for development calibration.** Anthropic explicitly says counting is free, subject to rate limits; it accepts structured request content and returns an input-token estimate. Use synthetic/public text with development credentials, not employee conversations. It does not expose a consumer request's hidden context or emulate cache hits. Calibrate each actual model/version and content category; the documented change between Claude tokenizer generations does not establish any particular error percentage for o200k_base. [Anthropic counting documentation](https://platform.claude.com/docs/en/build-with-claude/token-counting).

2. **Handle thinking-context behavior explicitly.** Anthropic documents that prior-turn thinking blocks contribute to input on models that keep them, while other models strip them. The adapter should represent this only for supported, observed model behavior, and should distinguish captured thinking summaries from full internal reasoning. This is a detail to add to the context-reconstruction fixtures. [Thinking input rules](https://platform.claude.com/docs/en/build-with-claude/token-counting#count-tokens-in-messages-with-thinking).

3. **Use DevTools/CDP as a development capture reference.** The Chrome debugger API exposes the Network domain and response-body retrieval for attached targets. Use it to build synthetic fixtures and compare the production fetch/XHR/DOM adapter against them. Capture still depends on target attachment, buffering, timing, and transport-specific events, and cannot reveal backend-to-backend calls. Keep this capability out of the normal employee install unless a separate product decision justifies it. [Chrome debugger](https://developer.chrome.com/docs/extensions/reference/api/debugger), [CDP Network](https://chromedevtools.github.io/devtools-protocol/tot/Network/).

4. **Evaluate a two-phase energy model against a pinned baseline.** EcoLogits's current code lacks an explicit input-token argument, and its maintainers acknowledge the prefill simplification. Long-document/short-answer tasks therefore need special validation. Develop a prefill/decode candidate using phase-aware measurements, but adopt it only after held-out evaluation and compatible-boundary checks. Open-model benchmarks cannot certify the deployment behavior of proprietary services. [EcoLogits discussion](https://github.com/mlco2/ecologits/discussions/86), [calculation source](https://github.com/mlco2/ecologits/blob/main/ecologits/impacts/llm.py), [TokenPowerBench](https://arxiv.org/abs/2512.03024).

5. **Add AI Energy Score and the Mistral disclosure to the evidence registry.** AI Energy Score v2 includes reasoning workloads and provides another cross-check for task-dependent energy. Mistral's July 2025 disclosure reports 1.14 g CO2e and 45 mL for a 400-token Le Chat response, with upstream impacts included. It is a useful additional reference, but its scope is not interchangeable with pure operational electricity or Google's direct-cooling water metric. [AI Energy Score v2](https://huggingface.co/blog/sasha/ai-energy-score-v2), [Mistral's primary disclosure](https://mistral.ai/news/our-contribution-to-a-global-environmental-standard-for-ai/).

6. **Pin tokenizer assets and calibration endpoints, not merely library names.** Google's loader explicitly maps selected Gemini IDs to Gemma3/Gemma4 tokenizer assets. The Gemma4 path is not revision-and-hash pinned in the inspected loader, so our build should pin it independently. A newer model in API documentation does not prove that a consumer website uses it. Unmapped models remain unverified estimates. [Official Google loader](https://github.com/googleapis/python-genai/blob/main/google/genai/_local_tokenizer_loader.py).

## Claims from the first audit that were corrected or qualified

| Initial audit claim | Reconciled finding |
| --- | --- |
| Sonar support ends on 2026-09-27; calibration should be rushed | Not confirmed by the host's live page or fetched migration guide. The official guide says Sonar remains supported and recommends Agent API for new projects. The migration is real; the deadline must not drive this project without a reproducible source. |
| Mistral's 400-token inference figure includes amortized training | Withdrawn by Claude Code. The primary disclosure separates training/lifecycle and marginal inference figures and mentions upstream manufacturing, but does not establish amortized training in that marginal figure. |
| Mistral is the only audited provider LCA | Exclusivity was not established and was withdrawn. Describe the specific reviewed study. |
| ML.ENERGY dataset license is unspecified | The public dataset card explicitly declares Apache-2.0. File access is gated through contact-sharing acceptance; gating and licensing are separate issues. |
| Gemma4 probably requires separate Gemma licensing acceptance | Speculation withdrawn. The inspected Google Gemma4 model card declares Apache-2.0. Preserve exact-asset notices and provenance. |
| The newer Claude tokenizer implies roughly 30% o200k_base error | Withdrawn. The vendor comparison is between Claude tokenizer generations, not an empirical substitute-tokenizer error measurement. |
| CDP captures every response body | Qualified. It improves observable browser capture, subject to target coverage and buffers; it never reveals all provider-internal work. |
| A two-phase replacement is necessarily more accurate | Qualified. Treat it as a candidate and retain EcoLogits as a benchmark until held-out tests justify a change. |

Primary resolution sources: [Perplexity migration guide](https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/overview), [Perplexity changelog](https://docs.perplexity.ai/docs/resources/changelog), [Mistral disclosure](https://mistral.ai/news/our-contribution-to-a-global-environmental-standard-for-ai/), [ML.ENERGY dataset license](https://huggingface.co/datasets/ml-energy/benchmark-v3), [Google Gemma4 model card](https://huggingface.co/google/gemma-4-E4B-it), [Anthropic counting](https://platform.claude.com/docs/en/build-with-claude/token-counting), [CDP limits](https://chromedevtools.github.io/devtools-protocol/tot/Network/).

The host additionally verified the full [AI Wattch MIT license](https://github.com/AIWattch/AI-Wattch/blob/main/LICENSE) and [EcoPrompt CC BY-NC-SA license](https://github.com/IB2M-Official/EcoPrompt/blob/main/LICENSE) in Chrome, closing two checks Claude Code had left open. The license assessment in the original report stands: AI Wattch can be considered for appropriately attributed reuse, while EcoPrompt is not a suitable unrestricted open-source base.

## Remaining limits

- Live consumer schemas, actual model IDs, hidden reasoning/search/document operations, cache semantics, and tokenizer approximation error still require a controlled capture/calibration prototype.
- Sonar's historical Llama lineage is a calibration lead, not proof of today's exact consumer tokenizer.
- A specific Perplexity legal-page browser recheck was blocked by the browser's site-safety policy; it was not worked around. The current consumer provider list was not independently refreshed through that page in this pass. This was a browser policy restriction, not an automatic shell-approval rejection.
- The precise Perplexity deadline remains unconfirmed even after the migration guide was checked. The report should refer to documented migration without inventing urgency.
- New repositories located by the reviewer remain candidates where shipped code was not audited; README accuracy claims are not evidence of measured accuracy.
- Dataset access was not requested, and no new account or credential was created. The Apache-2.0 declaration is verified; any access conditions must be reviewed before downloading the gated files.

## Recommended next deliverable

Build a measurement prototype producing an evidence matrix for every supported website/model/mode. It should compare developer capture against production-adapter capture, test official tokenizer parity, calibrate Claude/Sonar substitutes with synthetic text, and validate both short chats and long-document tasks. Only then finalize the resource coefficients and company dashboard.

The user requested research verification, so no extension implementation or infrastructure deployment was performed in this turn.
