# Correction addendum to the independent audit

Targeted rechecks performed: re-fetch of the Perplexity `sonar-post` page and changelog, and the primary Mistral disclosure. Hugging Face license corrections are accepted on the host's direct-browser evidence without re-fetching.

## 1. Perplexity deadline — evidence conflict; date downgraded to unconfirmed

My recheck of [docs.perplexity.ai/api-reference/sonar-post](https://docs.perplexity.ai/api-reference/sonar-post) again returned the sentence verbatim: *"Sonar Chat Completions is now Agent API. Sonar will be supported until September 27, 2026,"* with a migration guide referenced at `/docs/agent-api/migrate-from-sonar/overview`. The [changelog](https://docs.perplexity.ai/changelog/changelog) independently corroborates the migration itself: a **July 2026** entry states "Sonar Chat Completions is now Agent API." The host's own observation of "Legacy API" navigation also corroborates deprecated status.

However, since the host's live Chrome read of the same URL does not reproduce the deprecation banner or the date, I cannot treat two tool-mediated fetches as decisive against a live browser. **Status: the Chat-Completions→Agent-API migration is confirmed (changelog, July 2026); the specific 2026-09-27 end-of-support date is disputed and remains unconfirmed** until the parent opens the migration guide URL above directly. I withdraw the urgency framing ("run calibration immediately before the deadline"). The retained, evidence-based version: **endpoint churn at Perplexity is real and current; run the Sonar calibration against whichever endpoint is live, record endpoint + model + date in the method version, and plan a re-run after the Agent API migration completes.** The practical recommendation barely changes; the deadline pressure is removed.

## 2. Mistral marginal figure — training-amortization claim withdrawn

The [primary disclosure](https://mistral.ai/news/our-contribution-to-a-global-environmental-standard-for-ai/) reports the figures separately: training/lifecycle totals for Mistral Large 2 (20.4 ktCO₂e, 281,000 m³ water, 660 kg Sb eq, as of January 2025 after 18 months of use) and a **marginal** figure for one 400-token Le Chat response (1.14 g CO₂e, 45 mL water, 0.16 mg Sb eq, "excluding users' terminals"). The page does **not** state that the marginal per-response figure includes amortized training, and my earlier assertion that it did came from secondary snippets. **Withdrawn.** What the primary source supports: it is an LCA-methodology disclosure (with Carbone 4 and ADEME, peer-reviewed by Resilio and Hubblo) whose marginal figure includes upstream impacts beyond pure operational electricity — the exact composition (manufacturing allocation vs. other upstream terms) is not itemized on the page. The resource-depletion metric (Sb eq) confirms manufacturing-related accounting is present somewhere in the boundary; that is manufacturing allocation, not training amortization, and I should not have conflated them.

I also withdraw "the **only** third-party-audited provider LCA" — exclusivity was not established. Corrected framing: **the only peer-reviewed provider LCA found in this research.** The corrected takeaway for the report stands, and is actually cleaner now: Mistral's 45 mL vs. Google's 0.26 mL is a boundary-composition contrast (upstream + partially unspecified boundary vs. on-site cooling only), useful as a labeled reference scenario and boundary-education example — **not a plug-in operational coefficient**, precisely because its boundary composition is not fully itemized.

## 3. Licenses — corrected

Accepted on the host's direct evidence: [google/gemma-4-E4B-it](https://huggingface.co/google/gemma-4-E4B-it) visibly declares **Apache-2.0**, and [ml-energy/benchmark-v3](https://huggingface.co/datasets/ml-energy/benchmark-v3) visibly declares **Apache-2.0**. I withdraw "license unspecified" for the ML.ENERGY dataset (the gating is an access/contact-sharing step, not a license ambiguity) and withdraw the speculation about a probable Gemma-terms gate on the Gemma4 tokenizer assets. Retained unchanged: pin exact artifact revisions and hashes (the Gemma4 loader entry still lacks a pinned hash in the inspected snapshot, unlike Gemma3), preserve NOTICE/attribution files, and record the dataset revision used for any fitted coefficients.

## 4. The ~30% figure — qualified; F1 reclassified as sharpening, not correction

Anthropic's statement compares **newer Claude tokenizers with older Claude tokenizers** ("approximately 30 percent more tokens… the exact increase depends on the content"). It says nothing about o200k_base's error against either family. I withdraw the phrasing that a single calibration "would embed up to ~30% systematic error" — the inter-family delta implies a substitute calibrated on one family will mis-fit the other, but the magnitude of that mis-fit for any given substitute is unbenchmarked and content-dependent. No numerical substitute-error claim survives. The original report already required per-model-version calibration and explicitly warned against using the 30% delta as a correction factor for an OpenAI tokenizer; my F1 therefore **sharpens** the report (explicit pre-4.7 vs 4.7+/5 family split in the calibration matrix, plus the free `count_tokens` endpoint as the per-family oracle) rather than correcting an error in it.

## 5. CDP capture — narrowed

"Captures every response body" was an overstatement. Corrected scope: [`chrome.debugger`](https://developer.chrome.com/docs/extensions/reference/api/debugger) with the [CDP Network domain](https://chromedevtools.github.io/devtools-protocol/tot/Network/) provides **stronger observable-browser capture** than a fetch wrapper — response bodies for attached targets (with explicit child-target/worker attachment required), WebSocket frames via separate frame events — but it is subject to bounded payload buffers, attachment coverage, and it reveals **nothing** about provider-side server-to-server calls, which remain invisible to any browser-side mechanism. Retained recommendation, restated precisely: use CDP capture in the development fixture phase **with explicit completeness checks** (compare captured bodies against DOM-rendered content and known request counts), then verify the production fetch-hook adapter reproduces those fixtures. The hidden-computation gap stays in the "unmeasurable portions" ledger regardless of capture mechanism.

## 6. Consumer model coverage — qualified to snapshot language

Supported: the official LocalTokenizer mapping (through gemini-3.5-flash/3.1-*) lags the model IDs listed in Google's **API documentation** (gemini-3.7-flash, gemini-3.8-flash). Not supported: that the Gemini **consumer website** serves those models to this user — that is a live-capture question, as the original report classified it. Likewise corrected: a local Gemini tokenizer is **absent from the `googleapis/js-genai` snapshot inspected, with an open feature request ([#362](https://github.com/googleapis/js-genai/issues/362))** — evidence of absence in that library at that snapshot, not proof that no JavaScript implementation exists anywhere. The design consequence is unchanged: the registry must handle unmapped model IDs as "estimated tokens," and consumer model identity goes into the capture-verification experiment list.

## 7. Energy engine — replacement made conditional

Corrected phrasing: build the two-phase (prefill/decode) surrogate as a **candidate**, and adopt it over EcoLogits' output-only kernel **only if it wins out-of-sample validation** on held-out open-model measurements and remains consistent with boundary-matched anchors (e.g., Google's published median under a comparable workload mix). More terms do not guarantee more accuracy on proprietary deployments, and the open-model datasets (ML.ENERGY v3, TokenPowerBench) grant **no insight into closed providers' actual hardware, batching, or utilization** — transfer remains an inference, exactly as the original report says. EcoLogits stays as the pinned benchmark engine and the bookkeeping layer (PUE/WUE/mix/embodied) throughout. The maintainer-acknowledged prefill omission ([discussion #86](https://github.com/mlco2/ecologits/discussions/86)) still justifies building the candidate; it does not pre-decide the comparison.

## Findings status summary

| Finding | Status |
|---|---|
| F1 Claude family calibration + free count_tokens | **Confirmed, reclassified as sharpening**; numerical o200k error implication withdrawn |
| F2 Gemini mapping lag, unpinned Gemma4 hash, js-genai absence | **Confirmed with narrowed language** (API-docs lag, snapshot-scoped; consumer identity unverified; Gemma-terms speculation withdrawn — Apache-2.0) |
| F3 EcoLogits prefill omission / two-phase candidate | **Confirmed**; replacement now conditional on out-of-sample validation |
| F4 Sonar Llama 3.3 basis; usage-field semantics | **Confirmed**; Agent API migration confirmed (changelog, July 2026); **2026-09-27 date unconfirmed/disputed**; urgency withdrawn |
| F5 Offset AI defects | **Confirmed** (unchanged) |
| F6 Mistral LCA omission | **Qualified**: peer-reviewed LCA reference and boundary-contrast example; training-amortization inclusion and "only audited" exclusivity **withdrawn** |
| F7 CDP dev capture | **Qualified**: stronger observable capture, not complete capture |
| F8 Claude thinking-block context billing | **Confirmed** (unchanged) |
| F9 New candidates | **Confirmed** (unchanged; argmin still inaccessible) |
| F10 Datasets | **Qualified**: both HF licenses are Apache-2.0; gating ≠ license ambiguity |
| F11 Consumer usage fields unverified | **Confirmed** (unchanged) |

## Reconciled recommended path

Unchanged in substance: clean WXT/MV3 shell with per-site adapters; CDP-assisted fixture capture in development with completeness checks, fetch-hook bridge in production; per-model-family tokenizer registry with the free Anthropic `count_tokens` and Google reference implementations as calibration oracles, unmapped models labeled "estimated"; Sonar calibration against the current endpoint with endpoint/version recorded, re-run after the Agent API migration; EcoLogits (MPL-2.0, pinned) as benchmark engine and bookkeeping layer, with the two-phase surrogate adopted only after it demonstrably outperforms out-of-sample; Google, Altman, and Mistral figures displayed as dated, boundary-tagged reference scenarios, never blended. Items that remain unverified pending the parent's browser or live capture: the Perplexity end-of-support date (open the migration guide), the current third-party-models legal page (403 to my tools), `argmin-com/extension` (404), and every consumer-site schema question, which only the controlled capture prototype can settle.
