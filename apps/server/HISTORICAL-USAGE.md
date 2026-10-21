# Historical numeric usage

Historical imports use schema `1.0.0` independently of live observation schema `1.2.0`. Apply Alembic migration **0008** before starting this server version. The readiness guard rejects an older database.

The `historical_observations` table stores the authenticated tenant/user, original source date and its basis, acquisition date, numeric message payload, original payload and immutable method-bound assessments. `historical_coverage` holds bounded branch/root metadata. `historical_tombstones` records explicit erasure identity. No raw messages, files, provider IDs, titles or capability tokens are collected.

Imported history is retained beyond hosted age limits. This exception does not extend live observation, IP or mail retention. Explicit deletion includes imported records, including undated imports in a range deletion; the deletion preview exposes these counts separately. New live tombstones record whether they came from age cleanup or explicit erasure. Legacy unknown provenance remains conservative.

The installation-authenticated endpoints are:

- `POST /v1/me/history`: strict bounded numeric page and current deletion epoch; ordered per-message receipts.
- `GET /v1/me/history/{conversation_key}/summary?period=all`: historical subset independently of live lookup.
- `GET /v1/me/history/export`: at most 100 numeric records, optional `conversation_key` and `cursor`, and a `next_cursor` for continuing the export.

My, Company and admin summary responses include a separate historical projection. Company privacy thresholds apply to historical categories and complements as well as ordinary usage. Do not add unresolved historical overlap to live totals or treat visible prompt count as an API execution count.

The standard admin records CSV also includes `history_message` rows with source date basis, acquisition time, original numeric payload and original resource assessments. Undated rows and older imports are included in an all-time export; dated filters use source dates. A recalculated view now waits for both live and historical overlays, labels their selected method, and retains original numerical assessments in separate columns. Summary CSV exports keep historical counters, tokens, resources and extracted-file groups separate from live quantities. Original-only history summaries stay schema `1.0.0`; summaries containing parallel-engine rows use `2.0.0`. See [parallel-engine compatibility](ECOLOGITS.md).

History sync processes bounded batches and retains pending records through temporary failure. Restart and re-enrollment never reassign personal data to a company. A Personal Clear starts the browser from scratch and keeps no deletion markers; nothing about it is sent to this server.

Run the ordinary restore verifier after migration and protected-journal replay. It now verifies historical numeric hashes and original/current assessments against their pinned approved methods and checks that explicitly erased history is absent. A successful SQLite fixture is not PostgreSQL restore certification.
