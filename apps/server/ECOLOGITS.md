# Organization compatibility for parallel engines

The organization server runs EcoLogits inside the existing ingestion and recalculation services. It does not expose a new per-request remote estimation endpoint. Original Python Decimal arithmetic is unchanged. Observation, batch, history and result boundaries accept only the current `2.0.0` schema; method and configuration documents retain their independent versions.

## Runtime and immutable identities

`pyproject.toml` and `uv.lock` pin `ecologits==0.11.3`. At first EcoLogits use, the adapter verifies the installed version, retained-source manifest, source lock and accepted core/catalog identity. Every retained Python file and every JSON file outside a declared catalog overlay must match the installed package byte for byte. Loaded EcoLogits modules must belong to that installed package and the source allowlist. Configured model references must exist in the accepted native catalog. Missing or incompatible executable code remains explicitly unavailable; it never selects another method because a dependency is absent.

A `qualified_combination` may declare only `ecologits/data/models.json`, `ecologits/data/electricity_mixes.json` and `ecologits/data/video_models.json` as catalog overlays. It must retain an explicit qualification label and separate pinned core/catalog commits. The adapter checks exact retained file sizes and hashes, the manifest hash, safe paths without symlinks, the generated catalog hash, and agreement between native parsed models/aliases/electricity data and the generated catalog. Video data is verified and retained; this does not enable video capture or estimation in the product adapter. An undeclared overlay, modified installed Python, altered data or inconsistent provenance makes the native engine unavailable.

The adapter constructs native repositories from those verified JSON bytes and binds them to the unchanged installed `llm_impacts` function body. It does not import the development oracle, add a retained directory to `sys.path`, evaluate downloaded code or change upstream module globals. The raw native result uses the accepted electricity repository. Water consumption is taken directly from its WCF value; no extra water-component calculations run. The core commit remains the executable source identity; a changed catalog produces a new catalog and method hash. A successful runtime is cached for the process lifetime, so a packaged update requires a new process and validation. Previously saved original results remain unchanged; an older definition with a different core/catalog identity is explicitly unavailable for native recomputation.

The server constructs the same method definition/hash as the extension from the core identity, reviewed mappings, fallback policy, operational scope, timing/environment policies and original child hash. Successful admission retains the packaged definition in the immutable method registry. Inventory includes compatible archived policies, and reports unavailable executable identities separately. Signed legacy data delivery cannot distribute new executable code.

Each envelope explicitly records `auxiliary_method_hashes.image_reference`. The existing calculation-input hash includes that field, and every independent image result must name the same cohort. Validation also checks that selection labels identify the requested/effective engine families and that original raw model identity matches the outer selection. These checks do not rewrite original raw results.

EcoLogits uses output-total tokens when available, otherwise visible answer tokens. It never adds hidden reasoning counts. Bookkeeping start/end timestamps do not establish generation latency. The selected policy, `observed-live-then-history-then-modeled-1`, uses complete captured browser timing first, then complete historical timing from the same verified response, then the upstream modeled time. Source and scope remain attached to timing evidence. All raw impacts, including WCF, use the same latency cap. Compatible complete historical visible output may improve a partial live answer count without replacing a provider-reported total. Zero visible output after execution is unknown energy, and integers above binary64's safe range are explicitly unsupported by this engine. Historical calculations cover visible response text only. Prompt observations and unsupported workloads do not invent execution counts.

The native package computes raw usage, embodied and total impacts. Raw numerical scalars and range endpoints are retained as finite decimal strings. Product energy uses usage kWh; carbon uses usage GWP converted from kg to g. Policy `upstream-wcf-1` displays the midpoint of the upstream WCF range, (minimum + maximum) / 2, as water consumption in liters. Shared direct/upstream component fields are null and not applicable and their rows are hidden for EcoLogits. A changed method hash triggers the existing recalculation workflow without rewriting saved originals. Independent original image references stay outside the EcoLogits raw result and are counted once.

Per-record ranges remain available in result details and records CSV. Summaries add range midpoints and label them `midpoint_sum`, including summaries with one contributing record. Since 17 September 2026 they also add every record's lower endpoint into `scenario_low` and upper endpoint into `scenario_high` (scenario sums, so a client can show a minimum, midpoint or maximum scenario total). `interval_kind` stays null because there is no established joint interval for combining upstream approximation ranges. Daily rollups written before that date carry null endpoints; a range summary that merges one of them reports null scenario sums until the day is rebuilt. Scalar groups remain scalar. Method, effective child, profile, scope, units and comparability metadata keep incompatible groups separate.

## Selection and self-scope jobs

An active authenticated installation can call `GET` or `PUT /v1/me/estimation-selection`. PUT accepts exactly:

```json
{
  "preference": "ecologits",
  "selection_revision": 1,
  "method_id": "<supported immutable method ID>",
  "method_hash": "<64-character SHA256>",
  "operation_id": "<UUID>"
}
```

Preferences are `build_default`, `original` or `ecologits`. Explicit preferences must match the supplied method family. For `build_default`, the client supplies its resolved packaged method. Server policy and method availability remain authoritative. Tenant, employee and installation scope come only from authentication; client totals or profile vectors are not accepted.

Response fields are `selection`, `compatibility` and `recalculation`. Selection includes the revision, server generation and job ID. Compatibility is `supported` or `pending` with a reason. Recalculation uses the existing `/v1/me/recalculations/{job_id}` status contract and adds selection revision/generation for selection jobs. An identical request is idempotent; an older or conflicting revision is rejected. Installation A cannot change B's preference, even for the same employee. Jobs calculate the authenticated employee's authorized canonical live and historical observations across their enrolled installations.

The worker processes bounded pages and resumes after restart. Each job checks its selection generation and erasure epoch before work or publication. New canonical revisions make a previously complete method view pending until refreshed. Explicit original/recalculated inspection does not change preference. Authenticated installation summary/export reads without an explicit view follow the current completed selection; a pending selection returns an explicit pending outcome instead of silently showing the previous formula. Browser sessions without an installation retain original defaults.

No personal records are uploaded by selecting an engine. Existing no-backfill, enrollment, retention, conflict and erasure rules still determine the eligible population. Pending unknown history produces null resource contributions with a reason, while its independently counted text remains visible.

## Storage, restore and compatibility

Migration `0009` raises the schema guard to 9 and adds `engine_estimates`. It does not rewrite legacy observations, original result bytes or earlier migrations. New overlays key both request and attempt hashes for live data, or the numeric history hash for history. They store immutable method/view lineage and validated numerical source snapshots, so historical refinements remain recomputable without reconstructing user text. Deletion drains these snapshots and results with their canonical source; alias reconciliation removes superseded derived rows. Current original recovery overlays stay present until their rollup contribution has been subtracted.

Migration `0010` raises the current schema guard to 10 and adds `engine_estimates.original_method_missing`, defaulting to false for existing and ordinary new rows. A null original hash is allowed for a recalculated row only when this flag is true, the family is live, and the numerical source names the reserved `unavailable-admission-v1` method. Missing source fields, arbitrary unknown methods, historical rows and a non-null hash with the flag are rejected. Runtime checks separately bind the unavailable-original reason and reject a claimed trusted original. SQLite uses Alembic batch recreation; PostgreSQL discovers and replaces the existing lineage check by its reflected name. The migration preserves populated overlay JSON bytes, keys, foreign keys and indexes, and leaves migration `0009` and legacy `resource_estimates` unchanged.

`GET /v1/config` and `/v1/methods` advertise supported observation, history and result schema versions. Results are legacy live `1.0.0` or envelope `2.0.0`. Original-only historical summaries remain `1.0.0`; summaries containing new resource rows use `2.0.0`. Existing live `1.1.0`/`1.2.0` and historical observation `1.0.0` bytes are unchanged. Unsupported methods retain pending numerical records with explicit compatibility outcomes.

The offline restore verifier replays protected erasure first, checks source and method bindings, recomputes persisted overlays from their validated numeric snapshots, and verifies rollups. A valid input hash alone does not authenticate calculated numbers. Pending execution is never certified as a numerical success.

## Timing and historical evidence

A shared resolver supplies both historical suppression and live calculation inputs. It requires the same owner and site, exact response identity and an unambiguous current request/attempt. Conversations must match, except that Perplexity can use its exact request identity together with the exact answer identity. Prompt-only inference requires a uniquely matched response and a send/edit action. Contradictory historical identities remain unresolved.

Recalculated live overlays include the historical observation hash in their key, input source and retained numerical snapshot. History changes and erasure invalidate linked derived results. Repeated stale imports retain stronger timing and compatible complete counts while acknowledging the hash actually sent. Explicit Original views use preserved initial historical observations and their original estimates. Default selected engine views use current merged evidence.

Live aliases retain their real numeric observations, per-revision original estimates and method pins. The strongest valid copy becomes the canonical contribution; timing, provider totals, complete answers and completion evidence determine selection. Promotion updates alias references without rewriting raw identities or counting the copies twice.

## Local verification limits

The native adapter, strict Python contracts, ingestion, method negotiation, scoped selection, historical and live recalculation, CSV, migration and restore tests run with the pinned dependency. SQLite tests and PostgreSQL DDL compilation do not establish PostgreSQL transaction or migration behavior. The real PostgreSQL test requires an explicitly configured isolated `AIFT_POSTGRES_TEST_URL`; no local PostgreSQL runtime or URL was available during this implementation. No VPS or external deployment was contacted. Browser release, performance and production acceptance gates remain separate.

Earlier modular-refinement verification, before the timing/schema replacement below:

- Full server and deployment-journal suite: **479 passed, 1 skipped**, 497.81 seconds. The skipped test requires the isolated PostgreSQL URL. Local JUnit evidence is `.test-runtime/ecologits-backend-final.xml`; console output is `.test-runtime/ecologits-backend-final.log`.
- Final adapter, shared contracts, CSV and Python/TypeScript product comparison run: **187 passed**, 30.20 seconds. This includes final source snapshots, alias bindings, midpoint-only summaries and the current port/converter identity.
- Final default-view, canonical-alias and shared history/product checks: **4 passed**, 7.98 seconds.
- Auxiliary-contract follow-up: **326 passed**, 166.15 seconds, covering the explicit auxiliary-method field, recomputed input hashes, engine/profile labels, observed-model binding, native parity, exports, recalculation, history and restore. Evidence is `.test-runtime/ecologits-auxiliary-contract.xml` and `.test-runtime/ecologits-auxiliary-contract.log`. The input-hash preimage is unchanged.
- Missing-original-lineage migration follow-up: **13 passed**, 7.84 seconds, covering populated `0009` native overlay JSON byte preservation, unchanged keys/foreign keys/indexes and legacy constraints, narrow reserved-source admission, guard 10 and PostgreSQL SQL compilation. PostgreSQL was not executed or installed for this follow-up.
- Qualified native catalog activation follow-up: **40 passed**, 37.60 seconds, in `test_native_catalog_overlay.py`, `test_ecologits_engine.py` and `test_native_product_parity.py`. Nineteen focused overlay checks cover changed model/electricity data, unchanged installed function/global repositories, separate core/catalog identities, qualification requirements, exact hashes, stale generated data, source-path rejection and unsupported installed versions. This later correction is separate from earlier full-suite results. Evidence is `.test-runtime/native-qualified-catalog.xml`; adapter SHA256 is `1f01b089456514039bf0e5440b72bfd19eb3cf6e17a05bab9d05e0e0467222e1`.
- Ruff checks pass. Independent review reproduced and rechecked fixes for original-method pinning, alias cleanup, pending-history visibility, recovery fairness, immutable recovery retry handling, archived method inventory and erasure ordering. A separate valid-schema tampering exercise is rejected by numerical restore recomputation.

Method, input and source identities are checked exactly between TypeScript and Python. Product output comparison uses a predefined relative tolerance of `1e-10` and absolute tolerance of `1e-16` for this fixture domain; categorical metadata, missing values, reasons and phases remain exact. Only execution origin differs. These checks establish reproducibility for the fixtures, not physical calibration or whole-application release readiness.


Timing/schema verification is in progress. The new focused suite covers measured/native timing, both history/live arrival orders for both engines, count enrichment, stale rereads, original preservation, erasure and completed-alias promotion. The populated SQLite upgrade test verifies usage reset while authentication and erasure protection survive. The complete combined change still requires final regression and independent review; historical results above do not certify the new implementation.
