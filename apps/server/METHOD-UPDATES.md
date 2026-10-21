# Reviewed methods and calculation history

The packaged `ecologits-reference-2026-09-10-v1` bundle remains the default. Installing another bundle does not change that default or rewrite any observations, original results or revision snapshots. An installed reference bundle still has `validation_state=unvalidated_reference`. Signature approval establishes deployment trust, not scientific validation.

## Install a data bundle

Apply migrations through the current server head (`0007`; method history was introduced in `0003`). Run installation locally in the deployment environment using the same database configuration and Python module paths as the server:

```sh
python -m aift.method_registry approved-update.json \
  --trusted-spki /run/config/reviewed-method-p256-public-key.base64 \
  --approved-by deployment-review-reference
```

The public key is an independently pinned deployment configuration file. Set the matching base64 SPKI value as `method_public_key` in protected server settings to enable extension delivery. Never take it from the update envelope or an arbitrary remote response. The local deployment administrator reviews the bundle's equations, coefficients, scope, sources and expected results, verifies the signer against that trust configuration, and records the review reference with `--approved-by`. No installation HTTP endpoint is provided.

The authenticated enrollment exchange pins this separate key in the extension. Active paired installations can fetch the bounded inventory at `/v1/me/method-updates` and a complete signed envelope at `/v1/me/method-updates/{method_id}`. Neither public config nor policy refresh rotates trust. Existing enrollments without method trust continue using the packaged baseline and show the limitation; re-enroll to establish the configured method key. Personal mode makes no method-update requests.

To renew an expired delivery approval for an unchanged already-approved bundle, sign a new envelope with a later UTC-millisecond issue time and run the same command with `--renew-delivery`. The CLI verifies the configured key and immutable bundle hash. The original method approval and all calculation history stay unchanged; one current delivery-approval record occupies a domain-scoped key in the existing maintenance metadata table. This requires no extra server migration. Do not generate a new method ID solely to change delivery expiry. New clients reject expired envelopes, while clients that previously admitted the bundle can still explicitly recalculate with it after expiry.

Extension IndexedDB version 9 stores connection-scoped immutable bundles and authenticated local admission receipts. Downloading does not change the capture default. Choose a recalculated view explicitly; an unavailable requested method is not replaced silently. Method diagnostics distinguish loading, current, stale, failed and legacy baseline-only states. The ordinary company maintenance check is bounded and retains the last valid catalog when a delivery fails. A method key change requires authenticated re-enrollment and never imports another connection's catalog.

The envelope matches the shared estimator's signed-update format. It contains exactly `bundle`, `bundle_hash`, `issued_at`, `expires_at` and `signature`. `bundle_hash` is the shared canonical JSON SHA-256 hash of the bundle. Sign the canonical JSON object containing exactly `bundle_hash`, `issued_at` and `expires_at` using ECDSA P-256 with SHA-256. `signature` is base64 of the 64-byte IEEE P1363 `r || s` signature, each integer padded to 32 bytes. The trusted key file is base64 DER SubjectPublicKeyInfo. The issue time allows at most five minutes of future clock skew; the approval envelope must not be expired at installation. Its expiry does not retire an already installed historical method.

Install validates the strict shared bundle schema, coefficient bounds and provenance fields, then verifies the signature. Extra fields, executable formula strings, unsupported equations, hash or signature mismatches, expired envelopes and conflicting reuse of a method ID are rejected. Deployment installation rejects `test-linear-v1` in every environment; that equation exists only in the packaged estimator's test interface. New executable equations need an ordinary software release. Updates cannot replace the baseline. At most 32 methods, including the baseline, are available. The update envelope is limited to 2 MiB.

The immutable database row records the bundle, hash, signer fingerprint, review reference, signature, approval period and installation time. Repeating the same ID/hash is idempotent. Reusing an ID with different contents is a conflict. Processes resolve bundles from the database on demand; installation does not depend on a mutable process-global registry or a server restart. Keep deployed historical bundles when rolling out new software or restoring a backup.

## Request and read a separate view

Authenticated clients can read `GET /v1/methods`. The response contains `default_method_id` and `methods`, with IDs, hashes, equation IDs, approval/provenance and validation state. There is no automatic promotion to a new default.

An employee can start a job with `POST /v1/me/recalculations` and a JSON body containing `method_id` and a UUID `operation_id`. An admin can use `POST /v1/admin/recalculations`; optional `user_id` restricts its scope, otherwise it covers the company. Read status at the same path followed by `/{job_id}`. Jobs advance through the existing worker; clients do not need to submit an advance request. The status reports `pending`, `completed`, `failed` or `invalidated`, an error code, timestamps and `processed_estimates`. That count is cumulative stored revision results, not a fixed number of attempts or a completion percentage.

Summary endpoints accept `calculation_view=recalculated&method_id=...`. The default is `calculation_view=original`; `method_id` is not allowed with the original view. Admin CSV exports accept the same fields. Recalculated views require a completed matching job and an estimate matching every current applicable observation revision and payload hash. Missing methods or revisions return explicit pending responses; they never expose partial numerical totals as current. Company member summaries retain date/site privacy checks and suppress the complete result when a disclosed method/profile/scenario or token coverage group would be too small. Admin data remains restricted to current admin sessions.

Each persisted estimate is keyed by tenant, owner, attempt, observation revision, method and view. It records the observation hash and, for recalculation, the original method hash. Corrections create new entries. Previous revision results remain historical; they are excluded from current totals. Jobs recheck for missing current revisions each bounded pass, including corrections behind an earlier cursor. Original results can always be reopened unchanged.

Unknown proposed methods preserve observations as pending. Compatible installation lets the worker store an original-view resolution separately and adjust the current rollup contribution transactionally. The initial observation estimate and revision snapshot stay unchanged. The read API resolves that separately stored result. Unknown methods do not expire into an invented zero or silently substitute the baseline. Calculation failures stay visible and worker failures roll back the affected page.

## Worker, erasure and restore behavior

Each job processes at most 100 attempts per transaction. A tenant tick advances at most five jobs and 100 pending original attempts. Cursor state and immutable results commit together; a crash before commit can safely replay the page. Completed jobs remain eligible to pick up later accepted revisions. The status endpoint independently checks current revision/hash compatibility, so a completed checkpoint cannot make stale results look current.

Method jobs use the same tenant transaction lock as ingestion, corrections and erasure. Deletion and retention invalidate affected work, drain history in bounded pages and remove complete request families. The current original overlay is retained until its rollup contribution is subtracted in the final canonical deletion transaction. Restore replays the protected deletion journal before data becomes available. Method bundles themselves contain no tenant usage and survive erasure. Export availability also follows deletion epochs, retention cutoffs and method-view readiness.

Run the focused verification with:

```sh
uv run --project apps/server --frozen --group dev python -m pytest apps/server/tests/test_method_history.py apps/server/tests/test_method_delivery.py
pnpm --filter @footprint/estimator test
```

The local tests use SQLite and synthetic observations. They cover persisted TypeScript/Python parity, a clean Python process restart, crash rollback, competing worker transactions, corrections, original/recalculated views, malformed updates, member privacy, exports, erasure, retention and backup journal replay. They are not PostgreSQL concurrency, physical energy calibration or browser release evidence. PostgreSQL execution was unavailable on this host because Windows Application Control denied the official server launcher; no alternate launch route was used.
