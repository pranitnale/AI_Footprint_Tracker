# IP key rotation

This procedure applies only while the server has `ip_collection_enabled: true` (an operator setting, off by default; owner decision of 17 and 18 October 2026, see section 8 of `docs/implementation/CONTRACTS.md`). With IP collection off the server collects no connection addresses, needs no IP key, does not initialise the IP key registry, and `python -m aift.ip_rotation` refuses to run with `ip_collection_disabled`. Turning IP collection on needs updated privacy texts, a new member consent text in the extension's connect dialog and, in Germany, a works agreement first.

IP encryption and equality keys are independent of the application encryption key and email lookup key. Do not replace either application key to rotate IP observations. The legacy `ip_key` setting is version `1`; existing encrypted addresses and equality tokens keep their original derivation.

All key material belongs in the protected deployment settings file referenced by `AIFT_SETTINGS_FILE`. Never put secret values in command arguments, shell history, source control, chat, logs or the deletion journal. Provision fresh secret material through the deployment's approved secret-management process. This document does not supply production key material.

The additional settings are:

- `ip_keys`: an object mapping version strings to independently generated secret strings. Up to eight keys can be loaded. Each must meet the existing 256-bit generated-secret requirement. If `ip_key` and `ip_keys["1"]` are both present, they must agree.
- `active_ip_key_version`: the version that the new processes intend to use for writes. Versions are positive decimal identifiers. Activation cannot move backwards.
- `ip_restore_required_until`: an object mapping a version to a timezone-aware timestamp through which retained backups or other approved restore sources may require that key. Set this from the actual backup inventory and expiry policy. Omitting a horizon blocks retirement indefinitely. A newly declared horizon is persisted; an existing horizon cannot be shortened by changing or removing the setting.

The database pins each key version to a nonsecret keyed fingerprint. Changing secret material under an existing version fails startup. Missing keys needed by stored ciphertext, equality tokens or an unexpired restore horizon also fail startup. These checks do not print key values. Keep the keys protected and recoverable independently of database backups.

## Plan and execute

First deploy the rotation-capable software with the original configuration. That pins the existing key identity. Review a protected configuration containing both old and new keys, the new intended write version and the restore horizons. Run the default read-only plan with the same Python module paths and settings file as the application:

```sh
python -m aift.ip_rotation --tenant TENANT_ID
```

The plan reports versions, row counts, active and intended write versions and progress. It never prints key material or raw IPs. Planning neither activates the key nor creates a migration job. An unregistered new key can be planned from the protected configuration.

After reviewing the plan, explicitly execute:

```sh
python -m aift.ip_rotation --tenant TENANT_ID --execute
```

Activation changes the active write key for this configured application. Migration is scoped to the named tenant. Repeat the command for each applicable tenant; this command does not target a VPS or another application. The command processes one page of at most 100 network rows. The existing maintenance worker resumes the persisted job in bounded pages. Repeating execution for the same target is safe. All serving and worker processes need the new protected keyring and intended write version. A stale process using the former write version receives an explicit activation error instead of writing more old-key rows.

PostgreSQL shared row locks allow concurrent IP writes but make activation wait for old-version writes to commit. Rotation pages use the same tenant transaction scope as ingestion and deletion. SQLite tests serialize writes through the existing immediate transactions. No PostgreSQL execution was possible on the local verification host because Windows Application Control denied the official server launcher; no alternate launcher was used.

Each page decrypts with the recorded source key, verifies the existing equality token, and writes authenticated ciphertext plus a company-scoped equality token under the target key. Both values, the version and progress commit in one transaction. Failure rolls the page back and exposes a safe error code. No plaintext copy is saved in job state, audit, diagnostics or the deletion journal. Completed jobs also check for restored old-version rows on later worker ticks.

## Counts during migration

Admin network results include `distinct_ip_status` and `key_versions`. A selected range containing one key version has a normal exact `distinct_ips` string. A mixed-version range has `distinct_ips=null` and `distinct_ip_status=key_rotation_pending`. Individual authorized rows can still be decrypted using their recorded keys. The interface must label the count as unavailable while rotation runs, rather than displaying zero or adding counts from different versions. After migration, the same connection address again has one equality token and one distinct count.

IP expiry and whole-family/user deletion remove the complete network row, including ciphertext, equality token, version and the projected equality index. Rotation does not create a parallel address store. Usage retention remains separate from IP retention. Rotation metadata contains only deployment versions, progress and timestamps; deletion cannot be reversed by replaying a rotation page.

## Retire a key and restore a backup

Retirement checks are read-only:

```sh
python -m aift.ip_rotation --tenant TENANT_ID --retirement-check OLD_VERSION
```

The check covers retained IP material across the configured application, not only the named tenant. It refuses the active version, any version still used by a network row, and any version whose persisted restore horizon has not expired or was never declared. It never deletes a key or edits protected configuration. Once the check permits retirement, the deployment administrator can remove the key and its horizon entry from the protected file. Keep the pinned version identity in the database; version IDs must never be reused.

A restored backup may contain a mixture of old and new ciphertext and equality tokens. Supply every required key before opening it with the application. Missing keys fail visibly even when a later live database had completed rotation. Preserve the protected deletion journal and replay it through the existing restore procedure before making restored data available. Rotation resumes from retained rows and committed checkpoints, without recreating rows removed by deletion or retention. A backup predating key activation may need a reviewed explicit activation after journal replay; do not substitute a new key under an old version.

Local evidence: `uv run --project apps/server --frozen --group dev pytest apps/server/tests/test_ip_rotation.py`. Fixtures use ephemeral keys and synthetic documentation IP addresses in SQLite. They are not production configuration or PostgreSQL concurrency certification.

## Settings and stored addresses while IP collection is off

`ip_key`, `ip_keys`, `active_ip_key_version`, `ip_restore_required_until` and `ip_retention_days` are not required while IP collection is off. A settings file that still contains them keeps starting: the keys are accepted and ignored. Keep them if you may switch IP collection on again, because addresses stored with them can be read only with the same keys. `/v1/config` sends `ip_retention_days: 0` so that older extensions keep working.

Rate limiting does not depend on this setting. It counts requests under a keyed hash (HMAC with `lookup_key`) of the connection's address, held only in the abuse-protection rows, which are deleted one day after their last request. No IP key is involved.

Connection addresses stored while IP collection was on stay in the `network_observations` table until they are deleted; while it is off they are shown to no one and nothing deletes them automatically. Deleting a person still deletes that person's stored address rows. Without `--confirm` the maintenance command only counts the stored rows and deletes nothing:

```sh
python -m aift.maintenance purge-network-observations
```

It prints the count, for example `{"network_observations": 12, "deleted": 0, "mode": "count"}`. To delete every stored connection address row, the operator runs the one-off command with `--confirm`, and only after the owner has confirmed it:

```sh
python -m aift.maintenance purge-network-observations --confirm
```

It deletes the rows in pages, prints how many it deleted (`"mode": "deleted"`) and cannot be undone. The empty table stays. Run it with the same Python module paths and protected settings file as the application (for a Compose deployment, `docker compose run --rm api .venv/bin/python -m aift.maintenance purge-network-observations --confirm`). Backups taken before the purge still contain the rows until those backups expire under the deployment's backup policy.
