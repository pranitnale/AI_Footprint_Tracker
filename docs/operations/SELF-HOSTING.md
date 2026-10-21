# Self-hosted operations

This repository provides source and container definitions for one self-hosted organization. It does not deploy a service or obtain DNS, TLS certificates, a PostgreSQL backup target or a Brevo account.

## Required inputs

Use a host with Docker Engine and Docker Compose v2. Create three HTTPS DNS names: a public registration host, one tenant host, and a distinct operator host. The tenant host is the organization's own domain or subdomain (for example `footprint.example.com`); it becomes `self_host_origin` and `AIFT_TENANT_HOST`, and it is the server address members enter in the extension under "Your organization runs its own server?". A self-hosted organization cannot use the hosted service's address. The operator host is still separate when no operator identities are configured. Obtain one certificate whose subject names cover all three hosts and place `fullchain.pem` and `privkey.pem` in a protected directory.

Copy `deploy/examples/compose.env.example` outside the repository and set the exact host paths and DNS names. Copy `deploy/examples/settings.self-hosted.example.json` to the protected settings path. Replace every placeholder. Keep the settings file, PostgreSQL password file, TLS private key and deletion journal readable only by the deployment administrator and the containers that require them.

The API, migration and worker image runs as UID 10001. Grant that UID read access to the mounted settings file and write access to the journal directory, using the host's dedicated group or ACL policy. The read-only settings mount must not become writable. Keep TLS private keys and database password files outside the source checkout and Docker build context. The PostgreSQL password in the protected connection URL must match its secret file and must be URL-encoded where necessary.

Generate three independent secret values with a cryptographic secret manager:

- `encryption_key`: a Fernet key.
- `lookup_key`: at least 32 random bytes encoded as a secret string.
- `deletion_signing_key`: a base64url encoded 32-byte Ed25519 seed.

Never reuse the database password or one of these keys. Never pass secrets as command arguments or commit the completed files. The example starts self-host capacity at 500, the supported target. Lower it when the deployment has a smaller approved operating limit. Usage is retained until an administrator deletes it. With `ip_collection_enabled` off (the default) the server collects no connection IP addresses, so no IP key is needed: `ip_key`, `ip_keys`, `active_ip_key_version`, `ip_restore_required_until` and `ip_retention_days` are ignored if an older settings file still contains them. See "Person analytics and IP collection" below before switching `person_analytics_enabled` or `ip_collection_enabled` on.

Before changing `routing_verified`, `mail_privacy_verified`, `policy_confirmed` or `restore_journal_verified` to true, complete the corresponding DNS/TLS, delivered-mail, policy and restore checks. These fields record completed work. They do not perform it. Production startup fails while required checks are false.

## Build and start

From the repository root, with the protected Compose environment loaded, run:

```sh
docker compose config --quiet
pnpm package:browsers
pnpm verify:source-archive
pnpm --filter @footprint/web build
docker compose build --pull api web
docker compose up -d postgres
docker compose run --rm migrate
docker compose run --rm -T api .venv/bin/python - < deploy/initialize-journal.py
docker compose run --rm -T api .venv/bin/python - --execute --confirm-new-deployment < deploy/initialize-journal.py
docker compose up -d api worker web
```

Load the protected environment with `docker compose --env-file /protected/path/compose.env ...`, or export its nonsecret paths and hosts before these commands. The browser packages, source verification and website build run on the host, not inside Docker, because they need the full checkout, the release artifacts in `artifacts/browser` and the frozen dependencies described in `RELEASE.md`. The website build refuses packages that do not match the release manifest, the current source inputs or the source reconstruction report, and writes the site to `apps/web/dist`. The web image copies only that folder and checks again that every offered download matches the release manifest. The image build fails if `apps/web/dist` is missing, so rebuild the website after any source change and before rebuilding the image. Do not run the first-deployment journal initializer on a restore. It requires a migrated, empty database before registration, refuses existing journal/checkpoint files or prior company/usage/erasure evidence, and validates the generated authenticated checkpoint using the backend restore parser. A partial or unknown state is refused. Keep all other application processes stopped during initialization.

The migration service must complete before the API or worker starts. The current schema head is `0007`. The worker performs bounded retention, deletion preview, export, rollup and method-recalculation work every five seconds. API readiness remains unavailable if the worker heartbeat is older than the configured maximum.

Self-hosted operation uses the configured tenant and registration origins. Administrators sign in at the tenant host; members connect from the extension with their work email and a code, after entering the tenant host as their organization's own server. The work email domain of the first administrator is the organization's domain, and only addresses on that domain can connect. There is no mandatory connection to our hosted product server. Brevo remains the explicitly configured OTP provider, and administrators must arrange their own verified sender and delivery/privacy settings. Hosted free capacity is separately configured as 50 enrolled memberships; it does not replace the self-hosted example's 500-member limit.

Check the real virtual hosts and certificate routing from an authorized machine:

```sh
curl --fail --silent --show-error https://company.footprint.example.org/health/live
curl --fail --silent --show-error https://company.footprint.example.org/health/ready
curl --fail --silent --show-error https://footprint.example.org/v1/public/deployment
```

Use your configured hosts. Also verify that an unknown host returns 404, tenant `/operator` returns 404, and the operator host serves only `/operator` routes. The web container refuses to start when `AIFT_TENANT_HOST` matches the registration or operator host; leave it empty only for the hosted service, which serves every organization at the registration host. Do not enable external traffic until readiness passes and an authorized browser completes registration, OTP, installation connection and one synthetic numerical upload.

## Backup

The database, key material, approved method bundles and deletion journal form one restore set. The journal and its `.head` checkpoint must survive ordinary database rollback. A database dump alone is incomplete.

1. Stop new traffic and maintenance with `docker compose stop web api worker`.
2. Create a PostgreSQL custom-format dump from the still-running database:

   ```sh
   docker compose exec -T postgres pg_dump --format=custom --username="$AIFT_POSTGRES_USER" --dbname="$AIFT_POSTGRES_DB" > aift-database.dump
   ```

3. Snapshot the entire configured journal directory, including the journal and `.head`, with the host backup system.
4. Snapshot the protected settings, the auth/lookup/deletion keys, TLS configuration and any deployment-pinned method trust material. Keep secret material separate from general application artifacts.
5. Hash the dump and journal snapshot, encrypt the backup at rest and transfer it to the approved backup target.
6. Restart `api`, `worker` and `web`, then confirm readiness.

Configure and test backup expiry separately from usage retention (until an administrator deletes it, or the shorter period the organization chooses). Already downloaded CSV copies cannot be recalled by the service.

## Restore drill

Restore only into an offline, isolated PostgreSQL database and journal directory. Do not point a drill at the production database.

1. Restore the protected keys and full journal plus `.head` before opening the database to application processes.
2. Restore the PostgreSQL custom dump into the empty isolated target.
3. Configure the restored service with `restore_journal_verified: false` and no public ingress.
4. Run migrations, replay the journal, and execute the restore verifier:

   ```sh
   docker compose run --rm migrate
   docker compose run --rm api .venv/bin/python -m aift.maintenance replay-journal
   docker compose run --rm api .venv/bin/python tools/verify_restore.py --execute --confirm-offline-restore
   ```

5. Confirm deletion epochs, revoked identities, expired records, export invalidation, method inventory and aggregate state. Resolve every failure before setting `restore_journal_verified` true for that restored environment.
6. Start the worker, wait for a fresh heartbeat, then check `/health/ready`. Attach the command output, backup identifiers and hash evidence to the private operations record.

The verifier refuses unapproved or online targets. Local SQLite tests do not establish a PostgreSQL restore.

## Person analytics and IP collection (operator settings)

Two settings in the protected settings file decide what organization administrators can see about each member. Both are `false` by default, and no organization administrator can change them (owner decision of 17 and 18 October 2026; `docs/implementation/CONTRACTS.md` section 8 has the full contract):

- `person_analytics_enabled`: off, administrators see organization totals and aggregates only, and the server refuses every person filter (`person_analytics_disabled` 400) and answers 404 for the request list, request details and Network page. On, the per-person views of before 18 October 2026 come back: one person's summary and breakdown, requests per member on the People page, the Requests page and request details, the Health list by browser and member, last-seen times, per-record and per-person exports, one person's recalculation and counts in a person's deletion preview.
- `ip_collection_enabled`: off, no connection address is collected, no IP key or `ip_retention_days` is needed (present ones are ignored) and `/v1/config` sends `ip_retention_days: 0`. On, each upload stores the encrypted address again, the IP keys and `ip_retention_days` are required and validated, the worker applies the retention and key rotation, and with person analytics also on the Network page returns. See `apps/server/IP-KEY-ROTATION.md`.

`/v1/config` reports both as `features` (read-only, outside the policy, so switching them changes no policy version); the admin website shows the per-person pages only when the server says they are on. Restart the API and worker after changing either.

Before switching either on: update the privacy notice, the data processing agreement and the website texts to describe it, add a new member consent text to the extension's connect dialog, and in Germany conclude a works agreement (Betriebsvereinbarung) with the works council. The texts shipped with this release describe both switches off.

Usage recorded while person analytics was off is not shown by person afterwards, unless the operator decides otherwise. The server records the moment it first sees `person_analytics_enabled` on (`person_analytics_enabled_since`) and per-person views show usage only from the first full day after it, in the organization's time zone. Switching it off and on again starts a new period from the new moment.

## Keys and method data

The IP-key procedure in `apps/server/IP-KEY-ROTATION.md` applies only while `ip_collection_enabled` is on. With it off, connection addresses stored earlier are shown to no one. `docker compose run --rm api .venv/bin/python -m aift.maintenance purge-network-observations` counts them, and the same command with `--confirm` deletes every stored row. Run the deleting form once, only after the owner has confirmed it; it cannot be undone.

Authentication encryption, identity lookup and deletion-signing keys have no automated online rotation command in this release. Replacing them directly can make sessions, encrypted identities or deletion receipts unrecoverable. Treat their rotation as a planned migration with a verified backup and rollback design. A suspected compromise requires ingress isolation and incident review before any replacement.

Follow `apps/server/METHOD-UPDATES.md` for data-only method installation. A signed deployment approval proves the configured signer, not scientific validation. Back up installed bundles and pinned trust material so historical recalculated views remain reproducible.

## Routine checks and incidents

Use `docker compose ps`, `/health/ready`, and `docker compose run --rm worker .venv/bin/python -m aift.maintenance health` to distinguish API and worker health. Keep proxy access logs disabled: the service stores no connection IP addresses, and a proxy access log would keep them anyway.

For an incident, stop `web` first to prevent new external work, preserve the database and journal, record exact UTC times and affected key or service versions, and contact `pranitnale42@gmail.com`. Do not mark offline browser erasure complete until those browsers reconnect and acknowledge the signed instruction. Export files already downloaded remain outside remote recall.
