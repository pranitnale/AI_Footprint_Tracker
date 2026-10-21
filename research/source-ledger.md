# Research evidence ledger

All sources accessed 2026-09-07. Repository `main` is a snapshot observed on that date, not a pinned release. This ledger distinguishes supported claims from implementation experiments that have not been performed. The report contains the public-facing synthesis and links.

| Claim family | Source and date/version | Evidence and limits |
| --- | --- | --- |
| Offset product | [Offset AI homepage](https://www.offsetai.app/), accessed September 2026 | Claims four-site tracking, team dashboard and monthly reports; no source license located. |
| Offset formulas | [Methodology v1.1](https://www.offsetai.app/methodology-transparency-calculations), April 2026 | Fixed prompt coefficients; second PUE multiplier; problematic cited benchmark destination. |
| Citation mismatch | [arXiv 2501.07945](https://arxiv.org/abs/2501.07945), January 2025 | Actual target is bovine-embryo research, not AI energy. |
| Closed-model estimates | [How Hungry is AI? v6](https://arxiv.org/html/2505.09598v6), November 2025 | Statistical hardware estimates and API performance; no Perplexity/Sonar match in inspected text. |
| Production reference | [Google study v1](https://arxiv.org/html/2508.15734v1), August 2025 | May 2025 Gemini representative median; PUE included, direct water, market-based carbon plus embodied/direct contribution. |
| Provider disclosure | [The Gentle Singularity](https://blog.samaltman.com/the-gentle-singularity), June 2025 | 0.34 Wh and 0.000085 gallons; no detailed per-model methodology. |
| Water equations | [Making AI Less Thirsty v5](https://arxiv.org/html/2304.03271v5), March 2025 revision | Different IT/facility denominators; direct and power-generation water. |
| Empirical resources | [ML.ENERGY data toolkit](https://ml.energy/data/), v3 data | Open-model empirical benchmark; commercial deployments unverified. |
| Reasoning energy | [ML.ENERGY v3 analysis](https://ml.energy/blog/measurement/energy/diagnosing-inference-energy-consumption-with-the-mlenergy-leaderboard-v30/), January 2026 | Output length and serving configuration influence per-token and per-response energy. |
| Input/output phases | [TokenPowerBench](https://arxiv.org/abs/2512.03024), December 2025 | Prefill/decode instrumentation; not closed-service telemetry. |
| Context/batching effects | [Request and token energy characterization](https://arxiv.org/abs/2608.28044), August 2026 preprint | Measured open models on H100/H200; evidence against universal token coefficient. |
| EcoLogits approach | [LLM methodology](https://ecologits.ai/latest/methodology/llm_inference/), current docs | GPU surrogate; outputs drive regression; deployment/region assumptions. |
| EcoLogits exact interface | [llm.py](https://github.com/mlco2/ecologits/blob/main/ecologits/impacts/llm.py), main | No explicit input-token argument; usage and embodied outputs separable. |
| EcoLogits model uncertainty | [Proprietary models](https://ecologits.ai/latest/methodology/proprietary_models/), current docs | Closed model parameters inferred; not provider-certified. |
| EcoLogits reuse | [Core](https://github.com/mlco2/ecologits), [API](https://github.com/mlco2/ecologits-api), main | MPL-2.0 core; AGPL-3.0 API; self-hosting described. |
| OpenAI mappings | [model.py](https://github.com/openai/tiktoken/blob/main/tiktoken/model.py), main | Explicit o200k_base/cl100k_base/o200k_harmony map; no universal mapping for unknown future models. |
| OpenAI artifacts | [openai_public.py](https://github.com/openai/tiktoken/blob/main/tiktoken_ext/openai_public.py), main | Public asset URLs and integrity hashes. |
| Browser OpenAI implementation | [gpt-tokenizer](https://github.com/niieani/gpt-tokenizer), main | JavaScript encoding implementation, MIT; parity not run in this research. |
| Historical Claude tokenizer | [Anthropic TypeScript tokenizer](https://github.com/anthropics/anthropic-tokenizer-typescript), main, archived September 2026 | Explicit warning for Claude 3+; MIT. |
| Modern Claude counts | [Counting docs](https://platform.claude.com/docs/en/build-with-claude/token-counting), current | Model-specific endpoint; estimates; newer tokenizer statement; no caching emulation. |
| Gemini exact model mapping | [Loader](https://github.com/googleapis/python-genai/blob/main/google/genai/_local_tokenizer_loader.py), main | Explicit Gemini-to-Gemma3/Gemma4 mapping, pinned Gemma3 artifact/hash. |
| Gemini behavior | [LocalTokenizer](https://github.com/googleapis/python-genai/blob/main/google/genai/local_tokenizer.py), main | Experimental, text-only, unsupported model/content limitations. |
| Gemini official use | [Local counting examples](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/list-token), updated September 2026 | Official documentation of local counts, contradicts earlier blanket claim. |
| Hidden reasoning | [OpenAI](https://developers.openai.com/api/docs/guides/reasoning), [Google](https://ai.google.dev/gemini-api/docs/thinking), [Anthropic](https://platform.claude.com/docs/en/build-with-claude/extended-thinking), current | Visible summaries and invisible/full reasoning differ. APIs do not establish consumer fields. |
| Perplexity routing | [Third-party models](https://www.perplexity.ai/en-GB/hub/legal/third-party-models), November 2025 | Multiple underlying providers; Sonar exact current tokenizer unresolved. |
| Sonar API | [Usage schema](https://docs.perplexity.ai/api-reference/sonar-post), current | Public API usage fields only; consumer availability not validated. |
| Claude Counter | [Tokens](https://raw.githubusercontent.com/she-llac/claude-counter/main/src/content/tokens.js), [bridge](https://raw.githubusercontent.com/she-llac/claude-counter/main/src/injected/bridge.js), [license](https://raw.githubusercontent.com/she-llac/claude-counter/main/LICENSE), main | o200k_base substitute; active branch; exclusions; MIT. |
| ChatGPT Counter | [Nested main.js](https://raw.githubusercontent.com/Dhruvg0/Chatgpt-token-counter/main/chatgpt-tokens-counter/src/content/main.js), main | chars/4 despite README claims; packaging discrepancy; not runtime tested. |
| AI Wattch | [Estimator](https://github.com/AIWattch/AI-Wattch/blob/main/src/shared/utils/estimation.ts), main | Character estimate; three-site coverage; candidate source audit only. |
| Alba | [Configuration](https://github.com/lindsaygross/Alba/blob/main/energyConfig.js), [capture](https://github.com/lindsaygross/Alba/blob/main/content.js), main | Read in Chrome; heuristics, accounting risks, remote optimizer configuration. |
| TokenLens | [Interceptor](https://raw.githubusercontent.com/cerokuo/token-lens/main/src/injected/injected.js), main | API-schema assumptions, not evidence of actual consumer metadata. |
| License exclusions | [AIRadar](https://raw.githubusercontent.com/risewithvj/AIRadar/main/LICENSE), [EcoPrompt](https://github.com/IB2M-Official/EcoPrompt/blob/main/LICENSE), main | Source-available restrictions and noncommercial terms respectively. |
| MV3 capture | [Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [webRequest](https://developer.chrome.com/docs/extensions/reference/api/webRequest), current | MAIN/isolated contexts; no general response-body reader in webRequest, no WebSocket messages. |
| Storage | [Extension storage](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies), [storage API](https://developer.chrome.com/docs/extensions/reference/api/storage), current | Extension-owned storage, quotas, service-worker considerations. |
| Company configuration | [Managed storage](https://developer.chrome.com/docs/extensions/reference/manifest/storage), [permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions), current | Enterprise configuration and chosen-origin runtime permission. |
| Store policy | [User data](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), [remote code](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code), [installation](https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions), current | Disclosure, packaged code, distribution design constraints. |
| Pseudonymization | [GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng), current consolidated applicability not separately audited | Identifiable/pseudonymous distinction; no legal compliance certification. |
| Shell framework | [WXT](https://github.com/wxt-dev/wxt), main | MIT, TypeScript, MV3. |

## Discovery and stopping record

Primary retrieval waves: Offset homepage/methodology and its actual citation destinations; Google/Altman disclosures; EcoLogits docs and implementation; empirical input/output/energy benchmarks; official tokenizer SDK mappings/artifacts; candidate extension source/license checks; Chrome capture, storage, deployment and policy documentation. Browser fallback was used for GitHub files that the web tool could not retrieve.

Unresolved claims requiring experiments: current consumer-site fields by model/mode; closest Claude/Sonar substitute and measured errors; tokenizer-port parity; live extension compatibility; actual commercial serving hardware and physical resource use. These are explicitly unverified rather than inferred from README/API schemas. Stopping reason: sufficient evidence for the recommended architecture; further generic search cannot replace the required controlled captures and calibration.

## Operational learning

Windows application control blocked the installed gstack executable even outside the sandbox. Public web research and authorized Chrome computer use provided a working fallback. Do not disable application control to repeat this research. Browser source reads can reveal discrepancies between README accuracy claims and packaged extension code.
