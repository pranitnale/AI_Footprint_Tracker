# Modular extension and EcoLogits port: acceptance and scenario matrix

**22 September 2026 superseding decision:** Current extension builds use EcoLogits only. Original-default builds and product engine selection are retired. Original code, historical identities, archived research and explicit research comparisons remain available. Earlier dual-default build and picker requirements below are historical; see the [current contract amendment](CONTRACTS.md) and [research archive](../research/archive/original-method/README.md).

14 September 2026. Companion to [the implementation plan](MODULAR-EXTENSION-ECOLOGITS-PLAN.md) and [upstream maintenance/attribution specification](ECOLOGITS-UPSTREAM-MAINTENANCE.md). These are required tests and review gates, not tests already implemented or passed. All seven clarified owner decisions and the subsequent catalog-update/credit requirement are incorporated below.

The latest owner steering requires an Advanced settings engine picker, a developer-selected default and configurable same-provider or original-engine fallback. These supersede the initial developer-only-picker proposal.

## 1. Verification rules

- Every test has a stable ID, fixture provenance, execution environment, expected observable outcome and recorded result.
- Freeze the actual pre-refactor working-tree behavior before extracting modules. Preserve existing changes and existing explicitly known limitations.
- Independently generate raw EcoLogits expected outputs using pinned upstream Python. Do not generate expectations with the TypeScript port or our existing Python adaptation.
- Legacy output equality is exact according to the existing canonical serialization contract. New EcoLogits numeric parity uses the tolerance policy below; structure, discrete choices, units, warnings, errors, hashes and provenance bindings are exact.
- Different expected behavior due to product admission/scope must have its own test layer and explicit reason. A product wrapper must not hide a raw-port error.
- A fake transport proves contract behavior; it does not prove real browser installation, remote server availability or data-center accuracy.
- Retain existing end-to-end privacy, deletion, no-backfill, aggregation and noninterference gates. This matrix supplements them.

## 2. Numerical comparison policy

For scalar or interval-endpoint comparison use `abs(actual - expected) <= max(abs_tol, 1e-10 * max(abs(actual), abs(expected)))` for finite values. Apply to both endpoints and midpoint independently. Use these initial absolute tolerances and freeze any evidence-based tightening before acceptance fixtures are approved:

| Quantity | Unit | Absolute tolerance |
| --- | --- | --- |
| Electricity | kWh | `1e-15` |
| GWP | kgCO2eq | `1e-15` |
| ADPe | kgSbeq | `1e-24` |
| Primary energy | MJ | `1e-12` |
| Water | L | `1e-12` |
| Latency | seconds | `1e-9` |
| Model memory | GB | `1e-9` |
| GPU count, frames, dimensions | integer | exact |

Convert units explicitly before comparing; never compare a value in grams to one in kilograms with a permissive tolerance. Near-zero cases get dedicated assertions for zero versus unavailable and positive versus negative. Relative error alone cannot validate them. No tolerance may excuse a wrong branch, profile, cap, unit or missing field. Investigate discrepancies before adjusting thresholds. Very large fixture values must remain inside the admitted engine domain and avoid overflow.

## 3. Architecture and boundary tests

| ID | Scenario | Required result |
| --- | --- | --- |
| AR01 | Import graph for mathematical cores | No browser/WXT/React, network, IndexedDB, organization, clock or mutable application-singleton dependency. |
| AR02 | Replace estimator with a deterministic fake | Live capture, history, reconciliation and recalculation use the interface; no hidden direct original-engine call remains. |
| AR03 | Replace tokenizer with a deterministic fake | Live, historical and private-file counting use the same typed profile/job contract; estimator/storage need no source changes. |
| AR04 | Replace provider adapter with a fixture adapter | Tracking receives canonical capture data without formula, storage or auth changes. Browser permissions remain explicitly configured. |
| AR05 | Replace storage with an in-memory contract implementation | Tracking/query/sync tests use domain methods, not IndexedDB store names. Atomic-unit semantics still apply. |
| AR06 | Replace organization session/transport | Enrollment and synchronization do not require changing capture/tokenizer/core math. Personal mode remains network-free. |
| AR07 | Worker replies have wrong job, revision, profile, type, extra raw text or huge payload | Rejected with sanitized failure. No plausible numeric success is persisted. |
| AR08 | UI/background action and response mismatch | Strict action schema rejects it. Caller generics/casts cannot bypass validation. |
| AR09 | Page-originated privileged message, wrong frame/document/origin or revoked permission | Existing admission checks remain effective after interface extraction. |
| AR10 | Cancellation during parse/count/estimate/store/publication | Correct work is invalidated; stale output cannot overwrite a newer revision or another scope. |
| AR11 | Existing source/package import allowlists and proposed layer rules | All allowed imports explicit; new cross-layer dependencies fail CI. |
| AR12 | One component reports failure | Other valid observations remain stored; unknown environmental result is not converted to zero. |

## 4. Build defaults, Advanced settings and engine lifecycle

| ID | Scenario | Required result |
| --- | --- | --- |
| BE01 | No explicit user preference | Effective engine follows the validated developer default. Default remains original until the owner changes it. |
| BE02 | Build default original versus EcoLogits | Artifacts record different default identities; both include required engines for the Advanced settings selector and historical compatibility. |
| BE03 | Invalid/missing required build value, stale generated config or unknown engine | Build fails clearly; no accidental fallback or stale previous build. |
| BE04 | User selects original/EcoLogits in dashboard Advanced settings | Selection persists for that installation, applies across its supported sites and is reflected in effective settings. |
| BE05 | User selects follow-build-default | Later developer-default changes apply only according to the recorded default-view/new-observation policy; stored explicit preferences are not overwritten. |
| BE06 | Explicit user selection and developer default disagree | Explicit supported preference wins. No server/profile update silently changes it. |
| BE07 | Selection changes while a generation is running | Existing family retains its admitted method; new families use the new selection. Publication cannot mislabel an old-engine result. |
| BE08 | Selection changes during historical import/recalculation | Page/job method binding is stable. Stale results cannot become the active selected view; no duplicate import occurs. |
| BE09 | Background restart/browser restart | Selection and pinned work recover correctly; no transient fallback to the wrong default. |
| BE10 | User preference references an unavailable/removed engine | Show explicit unavailable selection and recovery action; keep old results readable; never silently substitute. |
| BE11 | Two browser profiles or installations | Preference is installation-scoped; no claim of automatic machine-wide or cross-profile propagation. |
| BE12 | Connect/disconnect, organization change or revoked credentials | Current local preference remains safely scoped; no old organization's methods or jobs leak into the new scope. |
| BE13 | Downloaded signed data attempts to change engine selection or add executable code | Rejected. Updates cannot add a new executable implementation or overwrite a stored method hash. |
| BE14 | Both build defaults across three browsers | Six build outputs and manifests validated; output directories and copied downloads do not overwrite another variant unnoticed. |
| BE15 | Update original-default to EcoLogits-default and back | Supported records persist, selected/default behavior follows policy, and new-schema-capable rollback remains writable. |
| BE16 | Production package inspection | No Python/Pyodide/native helper, unexpected network dependency or development comparison tooling shipped. |
| BE17 | Engine switch screen-reader/keyboard/narrow view | Controls are accessible, descriptions explain scope/history behavior, pending work is visible and no host-chat controls are affected. |

## 5. Original-engine preservation

| ID | Scenario | Required result |
| --- | --- | --- |
| LG01 | Baseline file and immutable method hash | Exact preserved identity and byte-equivalent canonical numerical behavior. |
| LG02 | Complete frozen corpus before/after refactor | All legacy values, reasons, scopes, profile choices, nulls and serialization match. |
| LG03 | Legacy Decimal rounding and signed-64-bit counter domain | Existing supported behavior retained; no new binary64 conversion. |
| LG04 | Positive, zero, unknown output and no/partial/completed execution | Existing eligibility and unavailable behavior retained. |
| LG05 | Fixed reference cohort and deterministic ties | Exact current winner/order behavior preserved in live and historical paths. |
| LG06 | Water category unresolved | Existing total remains null; refactor cannot convert it into an arithmetic sum. |
| LG07 | Images/files/search/visible thinking | Existing separate/non-additive/unknown scopes retained; no new resource multipliers. |
| LG08 | Legacy records reopened after an effective engine change | Original result unchanged; automatic recalculation has its own identity/default view. |
| LG09 | Legacy Python server parity | Existing strict full-result comparison still passes. |
| LG10 | New EcoLogits failure while original is selected | Original operation is unaffected; engines do not share mutable config or conflicting numeric helpers. |

## 6. Upstream LLM port tests

| ID | Scenario | Required result |
| --- | --- | --- |
| EL01 | Immutable source, release and artifact/data hashes | One pinned snapshot; no mixed main/latest datasets. |
| EL02 | Every catalog model and alias | Lookup/architecture/deployment/warnings have matching semantics; malformed/duplicate aliases fail predictably. |
| EL03 | Dense model with scalar parameters | Every intermediate and final metric matches upstream. |
| EL04 | MoE scalar/ranged active and total parameters | Exact upstream endpoint-pairing and range shape. No unintended Cartesian combination. |
| EL05 | Degenerate ranges and scalar-range arithmetic | Correct scalar/range type, endpoints, midpoint and comparison behavior. |
| EL06 | GPU memory thresholds immediately below/equal/above capacity and power-of-two boundaries | Allocated GPU count exactly matches; no tolerance around discrete branches. |
| EL07 | Quantization, memory capacity, batch size and host-power overrides | Core honors supported values and exact unit/allocation semantics. Product admission bounds are separately tested. |
| EL08 | Energy regression, GPU count and host allocation | No duplicated batch division, memory multiplier or accelerator factor. |
| EL09 | TPS/TTFT absent, present individually/together and zero versus null | Upstream fallback/override behavior faithfully represented; invalid product data refused explicitly. |
| EL10 | Measured latency absent, shorter/equal/longer than modeled time | Correct cap and unbounded default. No fabricated duration for histories. |
| EL11 | Explicit region versus provider default versus WOR | Correct default resolution and factor identity. User IP never selects a region. |
| EL12 | Every electricity mix using representative dense/MoE inputs | GWP/ADPe/PE/WUE values, fallback warnings and units match. |
| EL13 | PUE/WUE scalar and ranges | Correct propagation into every output; no double PUE or denominator confusion. |
| EL14 | Usage/embodied/total GWP, ADPe, PE and usage-only water | All phases agree with source; embodied water/training are not invented. |
| EL15 | Unknown model/provider/zone and malformed data | Source-compatible error classes/codes in reference layer; sanitized unavailable product result. |
| EL16 | Negative/nonfinite/reversed ranges, zero divisors and invalid dimensions | Product validator rejects without plausible success. Discrepancy register covers upstream behavior. |
| EL17 | Counter at/over JS safe-integer boundary | No silent precision loss; numeric observations retained; admitted/rejected core domain explicit. |
| EL18 | Missing versus null versus zero, booleans and numeric strings | Strict product schemas prevent unintended coercion; raw wrapper semantics documented separately. |
| EL19 | Very small values, cancellation-prone arithmetic, regression negative coefficients and threshold cases | Numeric tolerance met; legitimate signed intermediate coefficients are not wrongly rejected. |
| EL20 | Randomized valid combinations with fixed seed | At least 1,000 PR cases and 10,000 release cases against Python; failures minimized into permanent fixtures. |
| EL21 | Impact addition/type mismatch and repeated calls | Correct units/types, no state leakage; warnings returned even if logging is suppressed. |
| EL22 | Upstream loader/interval/documentation defects | Named reproducer, disposition and no silent corrected behavior under the unmodified source identity. |
| EL23 | Complete port surface map | Every required upstream function has a TypeScript implementation/fixture or explicit approved out-of-scope justification. |

## 7. Video core tests

| ID | Scenario | Required result |
| --- | --- | --- |
| EV01 | Every video profile and hardware type | Dataset lookup and full output agree with pinned Python. |
| EV02 | Named resolution, explicit dimensions, whitespace/case and invalid strings | Correct parser behavior; product invalid-domain rejection explicit. |
| EV03 | Duration/frame rounding at boundaries, including fractional durations | Positive-domain `int(24D + 1)` behavior matches; invalid negative/zero/out-of-bounds cases classified. |
| EV04 | Every model's seven regression terms and non-audio weight | Correct order/units and output latency; no accidental reuse of LLM coefficients. |
| EV05 | Audio true/false on native-audio and non-audio models | Baseline multiplier and stored no-audio adjustment match. |
| EV06 | W-based hardware data into kW-based core | No thousandfold discrepancy. Contradictory source docstring is recorded. |
| EV07 | Full-machine energy and embodied allocation | No LLM batch or GPU-fraction allocation imported into video. |
| EV08 | Power/PUE/WUE intervals, all phases and factor warnings | Raw ranges/units/types preserved without statistical relabeling. |
| EV09 | Omitted region WOR versus explicit null provider region | High-level semantics match exactly. |
| EV10 | Low-level request-latency cap versus high-level helper without this argument | Both supported surfaces tested separately. |
| EV11 | Large dimensions/duration, negative predicted latency, nonfinite results | Product admission/result validation handles safely; raw discrepancy retained. |
| EV12 | Production capture supplies no valid video observation | Video core stays dormant; no invented support, energy or generated-video counts. |

## 8. Model selection and developer-configurable fallback

| ID | Scenario | Required result |
| --- | --- | --- |
| PF01 | Verified mapping to a supported upstream model | Correct profile used with its existing assumptions/warnings unless an explicit observed-model override applies. A provider fallback entry does not displace a direct mapping; model recognition does not become a calibration badge. |
| PF02 | Missing OpenAI model | Apply the configured same-provider policy; never silently use Anthropic or an arbitrary global model. |
| PF03 | Missing Anthropic/other supported-provider model | Corresponding provider policy applies independently. |
| PF04 | Provider flagship policy definition | Explicit developer mapping per provider is deterministic, versioned and documented. No highest-energy, latest-date or lexical selection is inferred. |
| PF05 | Per-provider or exact-model developer override | Precedence deterministic; real observed model, selected reference and policy provenance all retained. |
| PF06 | Developer chooses original-engine fallback | Invoke the preserved original calculation without recursion; record requested/effective engine, parent-policy and child-method hashes and reason. Preserve raw legacy output and do not fabricate upstream-only fields. |
| PF07 | Unknown provider, opaque router or no eligible provider profile | Explicit configured benchmark profile (recorded as `provider_flagship` with `model_proxy`), original fallback or unavailable result; never an implicit original fallback and never a fabricated underlying host/model. |
| PF08 | Configured fallback absent, cyclic, malformed or outside admitted modality/domain | Reject configuration or return a fixed unavailable reason. No repeated fallback loop. |
| PF09 | Fallback/model catalog updated | New immutable method/policy/data identity; historical results unchanged; caches invalidated by hash. |
| PF10 | Documented parameter ranges above legacy 200B cap | New schema admits appropriately bounded profiles; legacy validator remains unchanged. |
| PF11 | Similar name or newer model without architecture evidence | It remains an assumption/proxy. No price or release-number scaling invented by the app. |
| PF12 | Developer comparison tools | Both engines and fallback choices run on identical numeric fixtures; reports show inputs, engine/profile versions, phases, ranges, missing coverage and absolute/relative differences. |
| PF13 | Attempt exists but corresponding request/provider mapping is absent or stale | Estimation input preparation remains pending/unavailable. No provider inferred from insufficient context; input hash binds both dependencies. |

## 9. Product result, history and aggregation

| ID | Scenario | Required result |
| --- | --- | --- |
| PR01 | EcoLogits raw full result with operational-only headline | Preserve raw usage/embodied/total; headline uses compatible usage phase only. |
| PR02 | Scalar and nontrivial interval results | New result schema stores both endpoints/kind; scalar legacy remains readable. |
| PR03 | Compact display needs one value | Clearly labeled range endpoint (minimum scenario by default; midpoint or maximum by setting) with accessible interval; no claim of expected/measured mean. |
| PR04 | EcoLogits water consumption (owner amendment, 16 September 2026) | Display upstream WCF directly with retained raw output/ranges, no component recalculations, no forced factor-incompatible total, and no water-source labels. Missing inputs and source failures remain unavailable. New method identity preserves saved originals. Original-engine semantics are unchanged. |
| PR05 | CO2 versus CO2e, operational versus embodied, facility versus IT | No incompatible aggregation or double conversion. |
| PR06 | Ranges from different dependence assumptions or source percentiles | Aggregate range only when coherent scenarios justify it; otherwise grouped/unknown, never a fabricated confidence interval. |
| PR07 | Known answer output versus verified total including reasoning | Correct work unit, no double addition of thinking; unknown reasoning stays unknown. |
| PR08 | Input length, cached tokens, tools and document text | No new unsupported input/caching/tool formula; non-additive file scopes remain separate. |
| PR09 | Interrupted/failed attempt with positive observed output | Partial estimate retained; execution state is not overwritten by successful calculation. |
| PR10 | Execution observed but zero/no visible output | Unknown work is not reported as zero energy. |
| PR11 | Historical prompt versus response, absent original duration | Response-only partial output surrogate; no fake execution or timing evidence. |
| PR12 | Effective engine or method change | Automatically schedule a bounded recalculation, make its completed view the default and retain originals. An explicit unchanged preference masks a developer-default change. |
| PR13 | Same history reopened, refined, branched or matched to live usage | Deduplication/anti-resurrection holds across engine versions and selected views. |
| PR14 | Mixed engine results in one installation/company | Compatible quantities may be combined with method breakdowns; incompatible groups remain separate. |
| PR15 | Existing original/recalculated controls plus Advanced engine picker | Both concepts are distinct; effective default, selected view and past-method lineage are understandable. |
| PR16 | Recalculation has missing old inputs or unsupported engine | Explicit partial/unavailable/pending state; no fabricated inputs or deleted original result. |
| PR17 | Scope/revision/deletion changes while a result is being published | Final publication guard prevents stale results. |
| PR18 | Both UI clients and CSV exports read a new result | Same values, units, range kind, selected phase, provenance and missing-data meaning. |
| PR19 | Automatic recalculation interrupted by crash, quota, engine failure or superseding selection | Resume/retry idempotently; pending state visible; only the active generation can promote the default view. |
| PR20 | Records change or are created while recalculation runs | Snapshot/revision checks and incremental completion prevent an incomplete set being labeled current/complete; capture continues. |
| PR21 | Enrolled member changes local engine preference | Self-scope/local recalculation only; no organization-wide job or other-installation preference change. Company canonical totals retain method breakdowns. |
| PR22 | Retokenization requested implicitly by a new engine | Stored numeric evidence is retained; no raw text is reconstructed or invented. Missing inputs yield scoped unavailable results. |

## 10. Persistence, migration and organization compatibility

| ID | Scenario | Required result |
| --- | --- | --- |
| ST01 | Populated IndexedDB upgrade with legacy records and pending work | Original hashes and totals preserved; new envelopes stored without destructive rewriting. |
| ST02 | Quota/transaction failure between observation, estimate and outbox | Atomic rollback or durable explicit pending estimate; no lost observation or duplicate outbox. |
| ST03 | Crash/restart during migration or rollup rebuild | Resumable bounded state, no partially valid summary presented as complete. |
| ST04 | Old/new tabs and stale workers after update | Compatibility guard prevents incompatible writes. |
| ST05 | Rollback to refactored original-engine build | Reads new schemas and old results; explicit unsupported behavior for any omitted computation. |
| ST06 | Attempt to downgrade to unsupported pre-migration binary | Refuses writes visibly; never recreates/clears the database. |
| ST07 | Erase a request/family/range/profile during queued or completed estimation | All result variants, caches, outboxes and pending jobs honor existing erasure rules. |
| ST08 | Data/profile updates after deletion | No result or history resurrection. |
| ST09 | Original and EcoLogits installations enrolled to one company | Server resolves requested policies and recomputes with matching engine/inputs; user/install identity remains correct. |
| ST10 | Old organization server lacks new engine/result/history support | Capability negotiation, local preservation and explicit pending/incompatibility; no silent method substitution. |
| ST11 | Server receives tampered client result/factors | Validates numeric observation and independently resolves trusted method data; client totals are not authoritative. |
| ST12 | Canonical record reconciliation invokes estimation | It uses the common interface and the record's pinned policy, not the current UI default. |
| ST13 | Schema 1.1, 1.2, history and new-result records mixed | Versioned validators preserve old bytes/hashes and reject unknown incompatible fields. |
| ST14 | Organization retention, historical retention exception and no-backfill | Existing distinct rules preserved for all engine variants. |
| ST15 | Multiple users/profiles, revocation and reconnect races | No credentials/results/method catalogs cross ownership boundaries. |
| ST16 | Backup/restore with old and new methods | Required method/data source snapshots preserved; deletion-journal replay and rollup reconstruction pass. |
| ST17 | Company privacy suppression with additional engine/profile groups | Small-group/complement protection remains effective; extra method groups do not reveal restricted activity. Retired 13 October 2026: members now see organization totals whatever the group size while sharing is on. |
| ST18 | New-schema server migrations on PostgreSQL | Real migration/transaction/recovery evidence required; SQLite tests do not substitute. |

## 11. Future remote executor contract tests, with a fake transport now

| ID | Scenario | Required result |
| --- | --- | --- |
| RE01 | Personal/disconnected installation | Zero estimation network calls. |
| RE02 | Organization remote capability absent or not authorized | Local path unchanged; no inferred consent or activation. |
| RE03 | Remote success for pinned input/method | Response identities, schema, phases and hashes validated before publication. |
| RE04 | Wrong tenant/install/request/revision/method/input hash | Reject; preserve valid local observations. |
| RE05 | Timeout after possible server completion | Retry idempotently, no duplicate estimate contribution or AI request. |
| RE06 | Offline and exact local method available | Future fallback uses that exact method with execution-origin label; not the other formula. |
| RE07 | Offline and no equivalent local implementation | Pending/unavailable resource estimate; no silent engine substitution. |
| RE08 | Local and remote results both arrive | One authority/contribution per observation/method/view; no double counting. |
| RE09 | Late response after selection, scope, revision or erasure change | Discard or retain only permitted historical result; do not publish as current. |
| RE10 | 401/403/409/413/422/429/5xx | Typed errors, bounded retries/backoff and clear recovery. |
| RE11 | Malicious result with raw text, nonfinite values, executable field or oversized payload | Rejected with sanitized diagnostics. |
| RE12 | Initial release package/network inspection | Only interface/fake tests exist; no live remote-estimation endpoint calls or new permissions activated. |

## 12. Provider, counting and browser regressions

| ID | Scenario | Required result |
| --- | --- | --- |
| BC01 | Existing four providers and raw dispatch/stream fixtures | Before/after observations equal except explicitly versioned metadata changes. |
| BC02 | UTF-8 splits, SSE framing, Gemini UTF-16 lengths, patches/snapshots and catchup replay | Existing correct assembly/replacement semantics preserved. |
| BC03 | Branch/edit/regenerate/retry/stop/multiple selected candidates | Existing identities and uncertainty remain accurate to the admitted observation evidence. |
| BC04 | Lost hook, replaced hook, unsupported protocol, missing body and stale document | Existing health/failure boundaries preserved; no invented successful capture. |
| BC05 | Both current encodings and 400-fixture corpus | Current tokenizer outputs unchanged; no upgraded exactness claim. |
| BC06 | Future tokenizer profile injected through full worker/file/history path | Proper selected asset/profile used and recorded, without raw text persistence. |
| BC07 | Large chats, concurrent streams, worker crash and queued cancellation | Bounded memory/work, revision checks, no wrong-job result or UI blockage. |
| BC08 | PDF/Office extraction, upload reuse/late receipts and malformed files | Current parser limits, association and non-additive result semantics retained. |
| BC09 | Connection/pause/permission/erasure changes during a count | Old-scope result cannot commit or publish. |
| BC10 | Three browsers and 12 browser/provider combinations | Actual installed-package tests recorded; in-app browsing or browser doubles alone do not close these gates. |
| BC11 | Host request/response controls with extension enabled/disabled | No changed requests, headers, bodies, streaming/cancellation behavior or focus interference. |
| BC12 | Original-before, original-after and EcoLogits performance | Same hardware/fixtures; CPU/RAM/startup/long tasks/bundle size/latencies published. Existing acceptance targets retained. |
| BC13 | Engine load lifecycle | No Python runtime, per-tab engine copies or worker-per-request pattern; cleanup and bounded caches verified. |
| BC14 | Theme, keyboard, screen reader, narrow layouts and history displays | Shared/current UI remains usable, including new Advanced settings and uncertainty details. |

## 13. Maintenance and release

| ID | Scenario | Required result |
| --- | --- | --- |
| RL01 | Upstream version or data revision changes | Source diff classified; fixture regeneration independent; new identity where semantics/data change. |
| RL02 | Reuse an existing method/profile ID with different contents | Reject both client and server. |
| RL03 | Signed data bundle contains arbitrary code, formulas or dynamic module URL | Reject. |
| RL04 | Python oracle dependencies missing or unpinned | Oracle/acceptance fails; no substitution with our own implementation. |
| RL05 | Source archive rebuilt cleanly for both defaults | Build selection and all required port/data/license files included; correct artifact hashes. |
| RL06 | MPL and dataset/source notices | Exact upstream revision, modifications and license boundaries inventoried; no blanket MIT relabeling. |
| RL07 | Offline developer comparison command/report | Synthetic or explicitly imported numeric fixtures only; both native-policy and controlled-input comparisons show assumptions and comparability. No production comparison-mode switch or screen. |
| RL08 | Final traceability | Every owner requirement maps to code changes/tests; unresolved required gates listed as failures or pending, never passed. |
| RL09 | Full upstream text/video model, alias and electricity catalog import | Every record retained in the immutable snapshot; generated coverage and any production exclusions explicit. No transcription into the legacy cohort. |
| RL10 | Run converter twice on identical pinned inputs | Identical generated bytes and hashes; ordinary builds work from locked artifacts without fetching latest. |
| RL11 | Compatible synthetic model addition through update tooling | Import, validation and parity succeed without handwritten formula, UI or storage changes. Consumer mapping changes, if needed, remain data-only. |
| RL12 | Upstream schema, formula, default, unit or architecture changes | Change report identifies them; stale port or unclassified semantic changes cannot pass verification. Relevant function-to-port map is complete. |
| RL13 | Candidate release changes valid numerical outputs | Candidate TypeScript matches candidate upstream Python; old-to-new deltas are reported separately rather than replacing candidate expectations with old ones. |
| RL14 | Pinned unreleased catalog combined with a different core commit | Exact combination and oracle provenance are recorded; unsupported combination rejected; no claim of an official released combination. |
| RL15 | Upstream removes/renames aliases or a configured flagship | Historical snapshot retained; affected references/conflicts reported; no silent replacement or local override loss. |
| RL16 | Supported direct model becomes available after flagship fallback | Direct mapping wins unless an explicit model override applies; new method identity and recalculated view preserve original fallback lineage. |
| RL17 | Interrupted adoption, dirty destination or failed numerical/license verification | Accepted lock/build remains usable; staged changes do not overwrite unrelated work; rollback restores exact accepted versions. |
| RL18 | Personal installation after developer adopts an upstream release | Packaged update supports offline use; no GitHub/PyPI polling, mandatory account or new remote dependency. Existing signed-data channels enforce core/schema compatibility. |
| RL19 | Both defaults and all browser artifacts inspected for credit | About/Licenses and distribution materials contain accurate version/source information; methodology and reports include the requested citation and independent-port identification. |
| RL20 | Recipient follows a released build's source link | Matching modified TypeScript source, applicable notices and MPL text are accessible. An upstream-only link or minified bundle cannot satisfy this gate. |
| RL21 | Candidate changes license, dataset rights, notices or citation metadata | Report detects changes; attribution regenerates from accepted metadata; unresolved applicable redistribution terms block candidate adoption/distribution. |
| RL22 | Mixed MIT/MPL source and generated JSON packaged/minified | Derived files retain applicable MPL classification and notices; source route survives bundling; no blanket MIT relabeling or lost dataset conditions. |
| RL23 | Original estimator selected while upstream catalog/core updates | Original frozen coefficients, method hash and numerical behavior unchanged; upstream overlays cannot mutate it. |

## 14. Evidence package

Produce: baseline hashes and fixtures; source/port inventory; discrepancy register; Python oracle environment/artifact hashes; deterministic differential outputs; product adapter fixtures; upstream lock/converter artifacts and update-rehearsal reports; two-default/three-browser manifests; database migration/restart/rollback/erasure evidence; mixed-client/server reports; performance measurements; license/SBOM/source archive and source-access checks; and a concise list of unverified provider/tokenizer capabilities.

The evidence package must distinguish executed checks, source inspection, simulated transport, installed-browser tests and external conditions still requiring action. No test count alone establishes complete correctness or physical measurement accuracy.
