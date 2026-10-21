# PostgreSQL test environment attempt

Date: 10 September 2026. Result: server startup blocked by Windows Application Control. No PostgreSQL integration or performance result is claimed.

The official [PostgreSQL Windows download page](https://www.postgresql.org/download/windows/) links [EDB's portable binaries](https://www.enterprisedb.com/download-postgresql-binaries). The 17.11 Windows x86-64 link was `https://sbp.enterprisedb.com/getfile.jsp?fileid=1260491`.

- Downloaded size: 341,325,378 bytes.
- Observed SHA-256: `4b8db0930c38f6ef845db919551dedda3b6b845aeb0927b3d79a6e8e9e4537cf`. This is an observed artifact checksum, not an independently published vendor signature.
- Runtime extracted outside the repository under the current user's local application-data directory, `CodexTestRuntimes/aift-postgresql-17.11`.
- `initdb --version` returned PostgreSQL 17.11.
- Initialized a new UTF-8/C-locale test cluster with SCRAM-SHA-256 authentication and a random test-only password.
- Requested a hidden launcher with a loopback-only listener on port 55432. Windows rejected `pg_ctl.exe` with: "An Application Control policy has blocked this file."
- The application-control configuration was not changed. No alternate launcher was used to bypass the denial. No service or system installation was created, and no VPS was accessed.

The private local connection configuration is excluded from source and release artifacts. An approved PostgreSQL environment is still required for actual migration, isolation, transaction-failure, restore and load checks. SQLite test results cannot close those gates.
