# Contributing

Thank you for improving AI Footprint Tracker. Contributions should preserve the product's numerical uncertainty, privacy boundaries, cross-browser behavior and source provenance.

## Development environment

Use Node 22.23.2, pnpm 11.19.0, uv 0.11.28 and Python 3.13.15. From a clean checkout:

```sh
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
uv sync --project apps/server --frozen --group dev --python 3.13.15
pnpm typecheck
pnpm test
```

Before proposing release-related changes, also run the applicable commands in [the release guide](docs/operations/RELEASE.md). Some PostgreSQL, Docker, live-mail and native-browser gates need an explicitly approved environment. Report unrun checks instead of substituting a local mock.

## Safe issues and fixtures

Use synthetic data in issues, tests and fixtures. Do not submit prompts, answers, employee content, real files, credentials, signed URLs, raw IP addresses, private hostnames, browser profiles, authenticated HAR files or production database extracts. Send a suspected vulnerability privately according to [SECURITY.md](SECURITY.md).

Provider fixtures must record their scope and source without including authenticated content. A fixture proves only the observed shape it contains. It does not establish every provider variant or justify a fallback for unknown data.

## Code and data changes

- Add focused tests for adapter, tokenizer, estimator, schema, migration, retention, disclosure and browser-lifecycle changes.
- Preserve observation and method history. Schema 1.1 records and hashes are immutable. Schema 1.2 additions must remain versioned and must not reinterpret historical 1.1 records.
- Add a new ordered migration instead of editing a migration that may already have run. Update readiness, restore and deletion-journal checks together when the stored contract changes.
- Keep unknown quantities unknown. Do not turn missing evidence into zero, measured usage or provider processing.
- Keep extracted document text separate from ordinary input/output tokens and resource estimates.
- Preserve accessibility, keyboard behavior, the locked Fern identity and all four supported-site boundaries.
- Keep expensive parsing and counting off the host page's main UI thread.

## Reuse and notices

Do not copy code, datasets, assets or model files without recording their source, exact version or commit, license, copyright notices, modifications and redistribution conditions. Preserve upstream notices. Update [`THIRD-PARTY-INVENTORY.json`](THIRD-PARTY-INVENTORY.json), [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) and the SBOM when shipped dependencies change.

Original contributions are accepted under the repository's MIT license. This project uses the [Developer Certificate of Origin 1.1](https://developercertificate.org/) sign-off process and does not require a separate copyright assignment. Add this line to every commit, using an identity you are authorized to place in the public Git history:

```text
Signed-off-by: Your Name <your-email@example.com>
```

Use `git commit -s` to add it automatically. The sign-off records the contributor identity and certification described by the DCO in the public project history. Product employee identities may remain pseudonymous under the product contracts; that separate privacy rule does not remove the public contribution sign-off requirement.

## Pull requests

Explain the concrete behavior change, privacy or numerical impact, tests run, tests not run, schema/migration effect and notice changes. Keep changes focused. A maintainer reviews code, test evidence, provenance, accessibility and security boundaries before merge. Passing tests do not by themselves approve a methodology, dependency, release or production deployment.

See [GOVERNANCE.md](GOVERNANCE.md) for decision authority and [SUPPORT.md](SUPPORT.md) for questions that do not propose a code change.
