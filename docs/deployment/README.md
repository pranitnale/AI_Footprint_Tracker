# Deployment documentation

No deployment target, DNS name, certificate, production secret, mail account or operator identity is bundled with this repository.

Use these maintained guides:

1. [Self-hosted operations](../operations/SELF-HOSTING.md) covers protected inputs, the Compose lifecycle, migration head 0007, worker readiness, backup, restore, deletion-journal replay, keys and incidents.
2. [Deployment file reference](../../deploy/README.md) describes the Compose examples, reverse proxy and fail-closed configuration validation.
3. [Server configuration](../../apps/server/README.md) documents the settings model, API, migration and maintenance commands.
4. [Release operations](../operations/RELEASE.md) documents frozen dependencies, audits, unsigned browser packages, source reconstruction and external gates.
5. [Privacy guide](../privacy/README.md) summarizes collection, roles, retention, deletion and export boundaries that a deployment must disclose.

The supplied topology uses a public registration host, a distinct operator host and, for self-hosting, the organization's own tenant host, all behind HTTPS. A self-hosted organization needs its own domain or subdomain for the tenant host. The hosted service has one address: the registration host serves the website, registration, administrator sign-in, every organization's admin dashboard and the API, and `AIFT_TENANT_HOST` stays empty. The deployment administrator supplies protected settings, PostgreSQL credentials, TLS keys, deletion-journal storage, backup storage and a verified transactional mail configuration.

Do not mark routing, mail privacy, policy or restore checks complete until the corresponding real checks pass. The local Compose files and synthetic tests do not establish Docker/Linux execution, production TLS, live mail, PostgreSQL restore/load, capacity or operator readiness. No command in these documents publishes or deploys the service automatically.
