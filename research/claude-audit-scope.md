# Claude Code independent audit

Requested by the user on 2026-09-07.

## Execution

- Requested model: `claude-fable-5`.
- Runtime initialization confirmed model: `claude-fable-5`.
- Requested effort: `xhigh`, supported by the installed CLI's help.
- Mode: independent consultation with read-only local and public-web research tools.
- Allowed tools: Read, Grep, Glob, WebSearch, WebFetch.
- Original report: `research/report-source.md`.
- Evidence ledger: `research/source-ledger.md`.
- Exact review brief: `research/claude-review-prompt.md`.
- Original research and PDF remain the baseline under review.

## Audit acceptance criteria

1. Explicitly assess all 13 report sections, including facts, assumptions, and recommendations.
2. Independently retrieve primary sources for material claims rather than relying on the source ledger or API-shaped parsers.
3. Search for more accurate tokenizers, empirical resource datasets, and suitable extension foundations.
4. Distinguish exact observed-text counting, full request observability, and physical resource estimation.
5. Recheck environmental units, PUE/WUE boundaries, input/output/context/hidden thinking/cache semantics, and aggregation uncertainty.
6. Evaluate reuse licenses, code actually shipped, capture/deduplication, and current maintenance evidence.
7. Assess privacy, company enrollment and deployment, offline history, site themes, and nontechnical usability against the user's confirmed scope.
8. Return linked corrections, stronger alternatives, remaining empirical gaps and a concrete recommended approach.
9. Disclose inaccessible sources and unperformed live/API/power tests. Do not count an unverified assertion as a confirmed finding.

The host will preserve the independent final output, check consequential proposed corrections, and distinguish Claude Code's findings from its own assessment.

## Baseline SHA-256 hashes

- `report-source.md`: `004F9351B0732CBE77751F90ECC3E1E829BFED3472BAC8214B95911915347EEE`
- `source-ledger.md`: `62D9A43AA486FF825522EC2D04FB7D211C98F05EBF78D8A691243100FEAA834B`
- `AI-Resource-Counter-Research.pdf`: `43FAB55F091060B3ABB4FB6EF9248D524DA7F99B36E7D781C433B6B133FFFFA9`

## Completion

The first audit completed successfully in approximately 13 minutes. A focused correction pass completed in approximately 2 minutes. Both requested `claude-fable-5` with `xhigh`; both confirmed that reviewing model and reported no permission denials. The CLI reports auxiliary Haiku use for its web processing.

- Verbatim independent result: `research/claude-independent-audit.md`.
- Verbatim correction result: `research/claude-audit-corrections.md`.
- Host-verified outcome and remaining limits: `research/verified-review-summary.md`.

All requested components were assessed. This is completed research verification with explicit empirical gaps, not live extension acceptance testing. Some overstatements in the independent audit were withdrawn or qualified after the host checked primary sources; see the correction addendum and reconciled summary.
