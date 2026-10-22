# Everyday comparisons and smaller models, 12 October 2026

The Details overlay, the popup and the dashboard translate figures into everyday terms. The canvas used placeholders; the owner asked on 12 October 2026 for values from reputable sources. These conversions are presentation only. They never change a stored or estimated figure.

## Values used

| Comparison | Value | Source | Scope and caveats |
| --- | --- | --- | --- |
| LED light | 8 W bulb, so 1 Wh = 7.5 minutes of light | US DOE FEMP, "Purchasing Energy-Efficient Light Bulbs", Table 2 (June 2023): an 800 lumen LED, the replacement for a 60 W incandescent, draws 5.9 to 10.5 W. EU Delegated Regulation 2019/2015, Annex V, Table 7: a 60 W equivalence claim needs 806 lm. | 8 W is near the middle of the DOE range (our choice). |
| Phone charge | 19 Wh per full charge, measured at the wall | US EPA, Greenhouse Gas Equivalencies Calculator, "Number of smartphones charged": 0.019 kWh per smartphone charged (based on US DOE data). | Wall energy matches the grid-side AI figures. Battery content of current flagships is about 14 to 16 Wh (Apple EU product sheet for iPhone 17: 3,692 mAh). |
| Car | 164 g CO₂e per passenger-km | Umweltbundesamt, "Vergleich der durchschnittlichen Emissionen einzelner Verkehrsmittel im Personenverkehr in Deutschland 2024", TREMOD 6.71B (10/2025): passenger car, all drives, 164 g greenhouse gases per passenger-km at 1.4 persons per car. | CO₂, CH₄ and N₂O as CO₂e including fuel and electricity supply; vehicle manufacture excluded. Shown as "one person driving". |
| Tablespoon | 15 mL | US FDA, 21 CFR 101.9(b)(5)(viii): "a tablespoon means 15 mL". NIST Metric Kitchen: 15 mL = 1 tablespoon. | No EU legal definition exists. |
| Glass of water | 250 mL | Common European glass size, as on the canvas. | Rounded everyday unit. |
| Words per token | about 0.75 English words per token | OpenAI Help Center, "What are tokens and how to count them?": 1 token is about 4 characters or three quarters of a word in English. | Varies by tokenizer and language. Anthropic notes newer Claude tokenizers produce about 30 percent more tokens for the same text, so Claude replies are shown with the same approximate marker. |

## Smaller model per tool

All records come from `packages/ecologits-core/data/catalog.json` (EcoLogits 0.11.2; the Claude row was updated for EcoLogits 0.11.3 on 22 October 2026). The comparison keeps the same output tokens and swaps only the model record.

| Tool | Smaller record | Reason |
| --- | --- | --- |
| ChatGPT | openai/gpt-6-luna | Small tier of the current generation; the default for Free and Go plans in `registry/model-catalog-2026-09-09.json`. |
| Claude, Cowork | anthropic/claude-haiku-5-5 | The newest Haiku record and the Haiku offered on claude.ai; also the stand-in for unknown Haiku labels. Until 22 October 2026 (EcoLogits 0.11.2) this was claude-haiku-4-5, then the only Haiku record. |
| Gemini | google_genai/gemini-3.5-flash-lite | Newest Flash-Lite record (`gemini-flash-lite-latest` still points to an older record). |
| NotebookLM | google_genai/gemini-3.5-flash-lite | NotebookLM names no model; it follows its Gemini stand-in. |
| Perplexity | Follows the vendor of the resolved stand-in: OpenAI to gpt-6-luna, Anthropic to claude-haiku-5-5, Google to gemini-3.5-flash-lite | Perplexity has no record of its own; the existing vendor stand-in approach stays (no route to the original method). |

## Sources

- US DOE FEMP light bulbs: https://www.energy.gov/cmei/femp/purchasing-energy-efficient-light-bulbs
- EU 2019/2015 Annex V: https://www.legislation.gov.uk/eur/2019/2015/annex/V/adopted
- US EPA equivalencies: https://www.epa.gov/energy/greenhouse-gases-equivalencies-calculator-calculations-and-references
- Apple iPhone 17 specifications (DE): https://www.apple.com/de/iphone-17/specs/
- Umweltbundesamt 2024 table: https://www.uba.de/system/files/medien/366/bilder/dateien/vtv_2024_pv_tab_pdf.pdf
- 21 CFR 101.9: https://www.law.cornell.edu/cfr/text/21/101.9
- NIST Metric Kitchen: https://www.nist.gov/pml/owm/metric-si/metric-kitchen/metric-kitchen-cooking-measurement-equivalencies
- OpenAI tokens article: https://help.openai.com/en/articles/4936856-what-are-tokens-and-how-to-count-them
- Anthropic glossary: https://platform.claude.com/docs/en/about-claude/glossary
