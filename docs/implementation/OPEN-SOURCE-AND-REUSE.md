# Open-source delivery and code-reuse plan

This is an implementation/release checklist, not a claim that a public repository, license file or published extension already exists. It supplements the [main plan](../../IMPLEMENTATION-PLAN.md). The owner's current decision is **MIT for original project code**; this supersedes the older research's proposed Apache-2.0 default. Historical research files remain historical evidence, not the current licensing decision.

## 1. License boundary

Use the standard MIT text for original extension, backend, public/organization website, admin UI, platform-operator UI, project-authored calculation code, scripts and documentation where the project owns the necessary rights. Confirm the copyright holder before populating the final license; do not assume the individual or employer owns all contributions. Preserve upstream copyright/license notices for reused material. [MIT license text](https://opensource.org/license/mit).

Dependencies, tokenizer/model assets, datasets and copied source can have different terms. Declare those exceptions explicitly; do not say every file/dependency has been relicensed MIT. EcoLogits core is the planned MPL-2.0 component. Keep applicable MPL source, notices and source-availability requirements, including modified/derived covered files. MIT wrapper code does not change those obligations. An actual port of covered source must be reviewed as such, not automatically stamped MIT. Keep the boundary visible in package directories and the inventory. [Mozilla's MPL guidance](https://www.mozilla.org/en-US/MPL/2.0/FAQ/).

**EcoLogits update and credit amendment, 14 September 2026:** apply the [upstream maintenance and attribution specification](ECOLOGITS-UPSTREAM-MAINTENANCE.md) to the planned parallel TypeScript port. It requires exact source/data/license/citation locks, deterministic catalog imports, update-diff reports, applicable file notices and access to the matching modified covered source. Both selectable-engine builds need these artifacts even when original is the default. Give visible EcoLogits credit and its requested scholarly citation; do not present acknowledgment alone as license compliance. These are future implementation/release requirements, not a claim that the new port has already been distributed or cleared.

Do not add noncommercial restrictions, company-only restrictions, or a requirement to use the author's server to the MIT project. Self-hosters can configure their own server and build the complete product without a proprietary company-only module. Contributor and deployment rules govern workflow/security; they are not extra restrictions on rights granted by the license. Publication does not authorize distributing private datasets, provider credentials or company information.

## 2. Reuse manifest and selected components

Prefer a maintained dependency over copying source when practical. Copy narrow audited components when the integration requires it; do not fork a complete extension whose accounting must largely be replaced. For every imported package/file/asset, record upstream URL, exact commit/version, hash, license identifier/text, copyright notices, destination, modifications, security review, tests, update owner and redistribution conditions. Keep this in a machine-readable inventory plus human-readable third-party notices. “On GitHub” or a README badge alone is not reuse permission.

| Candidate | Planned reuse | Required replacement or restriction |
| --- | --- | --- |
| [WXT](https://github.com/wxt-dev/wxt) | Extension project/build foundation; verify pinned MIT license | Separate Chrome/Edge/Firefox packages and capability tests |
| [gpt-tokenizer](https://github.com/niieani/gpt-tokenizer) | Browser text tokenization for verified encodings; pinned MIT package | Official parity tests; not proof of complete website request usage |
| [tiktoken](https://github.com/openai/tiktoken) | Official mapping/reference fixtures, with pinned notices | No assumed encoding for unknown models |
| [Claude Counter](https://github.com/she-llac/claude-counter) | Audited MIT capture/embedded-UI portions where useful | Replace branch-size consumption counting, blanket thinking exclusions and cache-timer assumptions |
| [EcoLogits core](https://github.com/mlco2/ecologits) | Pinned MPL operational calculation/reference component | Preserve MPL requirements; do not accidentally reuse its separate AGPL API server |
| [Google Gen AI tokenizer reference](https://github.com/googleapis/python-genai) | Verify mappings/reference behavior and exact tokenizer assets | Review source and asset licenses separately; no generic Gemini claim |
| [AI Wattch](https://github.com/AIWattch/AI-Wattch) | Optional audited MIT UI pieces | Do not inherit character-based counting as an accurate tokenizer |
| [Alba](https://github.com/lindsaygross/Alba) | Optional audited appearance reference/components | No remote prompt optimization; replace heuristic accounting |
| [TokenLens](https://github.com/cerokuo/token-lens) | Optional parser architecture reference, subject to exact ISC license review | Public API-shaped parsers do not establish consumer-site compatibility |

Research candidates are not automatically approved imports. Reverify licenses at the pinned revision, inspect transitive dependencies and run the project's privacy/accounting tests before integration. Exclude AIRadar and noncommercial EcoPrompt components from the unrestricted build. Do not copy Offset AI implementation without an established reusable license. Retain original authorship; never represent upstream work as newly authored project code.

## 3. Required repository files

Phase 0 creates the following with project-specific content, not empty templates:

| File / area | Required contents |
| --- | --- |
| `LICENSE` | Standard MIT license with confirmed original-code copyright holder |
| `THIRD-PARTY-NOTICES.md`, `LICENSES/`, inventory | Exact third-party licenses, notices, derived-source boundaries and asset conditions |
| `README.md` | Purpose; estimated-footprint limitations; three-browser/four-site scope; employee install, self-host setup and paired identity; privacy overview; no implication of provider endorsement |
| `CONTRIBUTING.md` | Reproducible environment, tests, fixture creation, schema/migration rules, review expectations and contribution rights; preserve notices; no copied code without provenance |
| `CODE_OF_CONDUCT.md` | Respectful community expectations and a real maintainer-managed reporting channel; no fabricated contact |
| `SECURITY.md` | Supported versions, private vulnerability reporting, secret/IP/content handling and disclosure process; no demand to post exploits or employee data publicly |
| `SUPPORT.md` | Bug versus feature versus deployment help; synthetic reproduction instructions; what diagnostics may safely be shared |
| `GOVERNANCE.md` | Maintainers, review/merge authority, releases, methodology changes, conflicts of interest and how contributors join; no fictitious people |
| `CHANGELOG.md` | Software and methodology changes, adapter compatibility, breaking schemas and migration notes |
| `docs/privacy/`, `docs/methodology/` | Collection/retention/roles/deletion disclosures; measurement boundaries, uncertainty, sources, validation and guidance limitations |
| `docs/deployment/` | Configurable company server, separate admin URL, HTTPS, enrollment, pairing, backup/restore/deletion replay, upgrade and revocation |
| Issue/PR templates | Browser/site/version, safe reproduction, observed/expected result, test/notice checklist; explicitly forbid prompts, secrets, raw IPs, authenticated HARs and real employee documents |
| CI/release workflows | Build/test all browser targets, backend/schema tests, secret/license scans, dependency checks, artifact hashes and software bill of materials |

Adopt a documented contributor sign-off process such as Developer Certificate of Origin sign-off, with maintainer verification of contribution provenance. Do not introduce a separate copyright-assignment agreement without an explicit owner decision. Public contributor identity expectations are separate from pseudonymous employee identity in the product.

## 4. Engineering and scientific contribution rules

- Tests and fixtures accompany every adapter, tokenizer, estimator, schema or migration change. Synthetic fixture content must be licensed and free of user secrets. Live provider requests are a separate explicitly configured maintenance task.
- Reject silent fallback to zero, invented model mappings, unsupported exactness claims and unsupported environmental savings. A new tokenizer/profile or guidance rule requires evidence and a stated applicability domain.
- Preserve method versions and numerical reproducibility; document source boundaries, benchmark transfer assumptions and calibration split. Corrections create visible versioned results rather than silently rewriting history.
- A dependency update must include transitive license/security review and relevant browser/capture regressions. Missing license/provenance blocks redistribution pending resolution, not a guessed permissive license.
- Keep credentials, private IPs/hostnames, company databases, browser profiles, signed-in recordings and employee text out of repository/history, artifacts, examples and public issues. Scan before release; if a real secret leaks, revoke/rotate it rather than relying only on deleting the file.
- Accessibility, neutral environmental language and cross-browser behavior are acceptance criteria. Guidance helps users make informed choices; it is not a greenwashing claim, punishment mechanism or individual employee ranking.

## 5. Release and self-hosting gates

Publish the source corresponding to released extension/backend artifacts, dependency lockfiles, schema migrations, build steps, notices, calculation data permitted for redistribution and synthetic tests. Publish artifact hashes and an SBOM; maintain a documented supported-version/upgrade policy. Verify that all required runtime code is available from source and that no undisclosed proprietary endpoint is needed for counting, estimates, employee dashboards or administration.

If a benchmark dataset is gated or cannot be redistributed, document access conditions and provide redistributable synthetic fixtures so ordinary builds/tests still work. Do not package third-party data without permission merely because calculation code is open source. Original illustrative/company branding must not copy provider trademarks or imply endorsement; host-compatible palettes do not grant logo rights.

Prepare Chrome Web Store, Edge Add-ons and Firefox Add-ons submissions from the published source. Record review/signing state accurately. Admin deployment addresses and credentials are supplied by each company, not hardcoded into the public repository or exposed as extension administration links. Ordinary employee extension access remains separate from authenticated admin access.

The public website links the real repository and verified distribution pages. Hosted paid capacity/retention is a service entitlement, not an extra restriction on the MIT source. Self-hosters build all required website/operator/backend/extension code and use their own Brevo account without our private key or a mandatory call to our hosting. The same public extension package supports local-only and enrolled use; no reusable organization credential is baked into a download.

All checklist items above are project release requirements, not a claim that every open-source project is legally required to carry every listed community document. Complete O01-O06 and the existing privacy, security and browser suites before claiming the project is ready for public use.

## 6. Methodology data added on 9 September 2026

The [text reference registry](../../registry/text-reference-profiles-2026-09-09.json) records an EcoLogits commit, coefficients, source model cards and a quarantined conflicting entry. Preserve EcoLogits' applicable source license and notices if implementation is copied or adapted; our original-code MIT license does not replace them.

The image reference cohort, a derived selection of 208 published GPU energy figures from the ML.ENERGY leaderboard export, was removed on 20 October 2026 because the ML.ENERGY leaderboard repository it came from has no licence file (LICENSE, COPYING or NOTICE). The related dataset card declares Apache-2.0, but it describes a different artifact, so no permissive licence was inferred. The methodology now cites the leaderboard as an external comparison without reproducing its numbers. Do not reintroduce figures from that repository unless it gains a licence that allows redistribution.

The extractor only parses public JSON already saved in the named evidence files. It does not execute upstream scripts, fetch gated datasets or require employee content. Ordinary builds and tests use the committed reduced registries and do not require the ignored `.firecrawl` research cache. The [67-entry catalog](MODEL-CATALOG-2026-09-09.md) paraphrases dated availability evidence with links; do not republish authenticated pages or raw model-menu captures.
