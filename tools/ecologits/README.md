# EcoLogits upstream maintenance tools

These developer-only commands stage, verify and adopt an explicit EcoLogits candidate. They do not run in an extension build, poll for releases, publish packages, deploy services or change user settings.

The maintenance boundary reuses two interfaces owned by `packages/ecologits-core`:

- `data/catalog.json` and `createCatalogRuntime(candidate)` define the normalized schema-1 catalog and isolated candidate runtime.
- `tools/differential.ts` defines the cross-runtime case generators and complete structural comparator.

The Python adapters in `python/` import the exact staged upstream source in the selected frozen `uv` environment. They contain no impact equations and no expected numerical results. A new upstream schema is rejected until this converter and the core catalog contract are deliberately updated.

## Commands

Run an ordinary stable release candidate with an explicit version and full immutable commit:

```text
node tools/ecologits/update.mjs --version 0.11.1 --commit 886d1ebfadb51a2d6407fcea6d9778c997c85c35 --stage <new-directory>
node --import tsx tools/ecologits/verify-update.mjs --stage <directory>
node tools/ecologits/adopt.mjs --stage <directory> --target-root <repository>
```

`update` is the only command that retrieves public material. It downloads the selected PyPI sdist and the exact GitHub commit archive from fixed HTTPS origins. `verify-update` runs `uv --frozen --offline`, removes provider credentials from child environments and blocks ordinary socket connections inside its candidate Python adapters. `adopt` accepts only a passed, sealed report.

For an already retrieved artifact or a fixture, provide regular local `.tar.gz` files:

```text
node tools/ecologits/update.mjs --version 0.11.1 --commit <40-hex-commit> --stage <new-directory> --source-archive <source.tar.gz> --package-archive <package.tar.gz>
```

The local-artifact form does not prove that a supplied archive came from the named commit. The report retains that limitation and never marks an upstream release official from the supplied version string or source hash alone.

An unreleased catalog fix must name both immutable commits and a qualification label:

```text
node tools/ecologits/update.mjs --version <base-release> --core-commit <40-hex-commit> --catalog-commit <40-hex-commit> --qualified-label <reviewed-label> --stage <new-directory>
```

This produces `release_kind: qualified_combination` and `official_release_claim: false`. It cannot masquerade as an upstream release. Use `--core-source-archive`, `--catalog-source-archive` and `--package-archive` for a local rehearsal of the same combination.

If relevant Python calculation behavior changes, supply a new `--core-version`. Verification then also requires:

- an updated package source-to-port map whose candidate file hashes, version and commit match;
- at least one mapped TypeScript target whose hash changed from the accepted baseline;
- candidate TypeScript parity with candidate upstream Python across the full differential set.

Source equality alone never passes this gate. Accepted-Python versus candidate-Python deltas are recorded separately from candidate-Python versus candidate-TypeScript parity.

Use `--python-project <locked-uv-project>` when a candidate requires a separately prepared dependency environment. The lock must contain the selected EcoLogits version and satisfy every base dependency. New direct URL requirements are rejected for separate source review. A deliberate converter revision is selected with `--converter-version`; omission keeps the accepted catalog converter identity.

## Human reviews

License, notice, citation or dependency changes remain blocked until a reviewer adds a hash-bound `review.json` inside the stage and reruns verification. A review file has this shape:

```json
{
  "schema_version": "1",
  "license_notice_citation": {
    "decision": "approved",
    "candidate_sha256": "<report.compliance.candidate_sha256>",
    "reviewer": "<reviewer identity>",
    "rationale": "<what was checked>"
  },
  "dependencies": {
    "decision": "approved",
    "candidate_sha256": "<report.compliance.dependency_sha256>",
    "reviewer": "<reviewer identity>",
    "rationale": "<what was checked>"
  }
}
```

Include only the applicable section. A changed hash invalidates the decision. Unknown catalog fields, units, architectures and relevant unmapped source cannot be approved through this file. They require converter, contract or port work.

An optional product overlay remains outside the generated upstream snapshot:

```json
{
  "schema_version": "1",
  "flagships": { "openai": "gpt-5.5-pro" },
  "overrides": [
    {
      "observed_model_id": "example",
      "provider": "openai",
      "profile_id": "gpt-5.5-pro"
    }
  ],
  "mappings": [
    {
      "observed_model_id": "example",
      "provider": "openai",
      "direct_profile_id": "future-direct-profile",
      "fallback_profile_id": "gpt-5.5-pro"
    }
  ]
}
```

Pass it to `update` as `--overlay <repository-relative-path>`. Verification reports removed flagships, aliases and overrides as conflicts. It also reports when a newly added direct profile can replace a prior fallback. Adoption never writes the overlay.

## Staged evidence

Each stage contains:

- unchanged downloaded archives and their SHA256 records;
- safely extracted core source, catalog source and package trees;
- the exact combined Python candidate and an accepted baseline snapshot;
- a deterministic candidate catalog, identity, lock, source map, coverage and attribution files;
- readable and machine-readable semantic change reports;
- candidate Python, candidate TypeScript and accepted Python output hashes plus changed case identities;
- an adoption plan and seal that hash every staged file used by adoption.

The complete selected upstream archives remain developer evidence. Adoption stores them under `.git/refinement-artifacts/vendor-source/`, outside the public package tree. The public `upstream/ecologits-<version>/` directory contains only the declared calculation, catalog, package-metadata and legal subset. `upstream/retained-source.json` binds every retained byte and records the hash, size and exclusion classification of every omitted upstream file. Upstream SDK cassettes, test fixtures, documentation images and unrelated project infrastructure are never copied back into the public source snapshot.

The semantic report covers models, aliases, parameters, deployment timing, warnings, sources, electricity factors, provider defaults, video models and hardware, Python functions/defaults, dependencies, licenses, notices and citation files. Complete source/package Python and JSON bytes must agree for a single-commit release candidate. A qualified combination may differ only in the three declared catalog JSON files. Python byte differences, including comments, fail verification because the adopted oracle must match the locked package. The next update reads the accepted snapshot directory from the adopted lock and checks agreement with the identity and retained manifest.

Generated notices reproduce the candidate CITATION.cff and refer to the reproduced license, with exact hashes and candidate license metadata. Changed license, notice or citation bytes still require an explicit approval for those hashes; a generated notice does not itself approve or change license obligations. Generated documents describe commit identifiers as requested and not independently attested. Local archive hashes do not establish Git commit identity.

## Adoption, recovery and rollback

Adoption acquires the target lock before checking every target against the accepted baseline, mapped port files and the overlay against their verified hashes. It checks targets again after preparation. Backups must match the original preconditions, and prepared copies and replacement bytes must match the loaded seal. A dirty, missing or unexpectedly created target stops target replacement. Recovery files are flushed before the journal permits replacement. State, transaction and target directory links are rejected.

After an interrupted process, restore the accepted files with:

```text
node tools/ecologits/adopt.mjs --recover --target-root <repository>
```

Roll back the latest completed adoption, provided no adopted file was edited afterward:

```text
node tools/ecologits/adopt.mjs --rollback latest --target-root <repository>
```

A completed transaction retains its backups for explicit rollback and historical inspection. Private vendor evidence participates in the same transaction and rollback. New journals record a monotonically increasing commit sequence while holding the lock. `latest` uses that sequence, never transaction names or filesystem timestamps. Legacy committed journals without a sequence require an explicit transaction ID because their order cannot be reconstructed safely.

Rollback validates every target, backup and pending payload before changing any target. Its durable `rolling_back` phase survives process interruption. Recovery completes that rollback. On an ordinary I/O error, rollback attempts to restore the complete state from before rollback; if that restoration also fails, `restoring_rollback` records the pending recovery. Recovery finishes restoration before another adoption is allowed. An external edit or corrupt recovery payload is rejected before further writes. These are recoverable multi-file operations with atomic replacement of each file, not a filesystem-wide atomic snapshot; do not build or edit the component while recovery is pending.

The synthetic failure options `--test-interrupt-after`, `--test-fail-after`, `--test-rollback-interrupt-after`, `--test-rollback-fail-after` and `--test-restore-fail-after` exist only for isolated tests.

The journal records newly created component directories. A successful rollback removes only those directories that are still empty, allowing the same qualified snapshot label to be staged again. Pre-existing directories and unrelated files are preserved.

## Tests

```text
node --import tsx --test tools/ecologits/test/*.test.mjs
```

All adoption tests use isolated temporary fixture repositories. Public recovery tests cover all-entry preflight, commit order, interrupted rollback, compensating restoration after I/O failure, repeated recovery, directory junctions, post-lock target changes and candidate-copy races. The full workflow also covers RL09-RL18 and RL21: complete baseline import, deterministic reruns, compatible model additions, a subsequent update after qualified adoption, qualified Python/package byte mismatch, changed valid outputs, stale formula rejection, alias and flagship conflicts, direct-candidate metadata, offline verification, license detection, staged tampering and malicious archives.

The full compatible-adoption rehearsal and the product-adoption proof stage the release that `packages/ecologits-core/upstream/lock.json` accepts. They read its commit archive and PyPI sdist from the lock's `private_artifact_directory`, check both against the lock's hashes and stage them the way the accepted adoption did. The frozen oracle environment and package metadata therefore match, and no review file is needed. A linked Git worktree finds the archives through the common Git directory. After a new release is adopted, the tests follow its lock without edits. They report an explicit skip in a public source copy where the archives are intentionally absent. Public package typechecks, tests, catalog checks and clean-source checks never require the private artifacts.

On Windows the workflow test runs `pnpm catalog:check`, `pnpm typecheck` and `pnpm test` through `cmd`, so `pnpm` must resolve on `PATH`. Where only Corepack is installed, put a folder containing a `pnpm.cmd` with the line `@corepack pnpm %*` first on `PATH`. In a checkout inside a OneDrive folder, also set `UV_LINK_MODE=copy`, because uv cannot hardlink from its cache into a new environment there. Verification runs `uv --frozen --offline`, so the locked packages for `packages/ecologits-core/oracle` and `apps/server` must already be in the uv cache.

```powershell
$env:UV_LINK_MODE = "copy"
$env:PATH = "<folder containing pnpm.cmd>;$env:PATH"
corepack pnpm test:ecologits-maintenance
```

## Root command wiring

The repository owner can expose the planned command names by adding these root scripts. This task does not edit the shared root manifest or lockfile.

```json
{
  "ecologits:update": "node tools/ecologits/update.mjs",
  "ecologits:verify-update": "node --import tsx tools/ecologits/verify-update.mjs",
  "ecologits:adopt": "node tools/ecologits/adopt.mjs",
  "test:ecologits-maintenance": "node --import tsx --test tools/ecologits/test/*.test.mjs"
}
```

Ordinary verified builds and tests continue to use committed artifacts without network access. A later CI watcher may invoke these commands, but automatic adoption, publication and runtime polling remain out of scope.

The package-local oracle and `catalog:check` command read the adopted retained manifest, snapshot directory, lock identities and candidate-pinned oracle project. Adoption updates `oracle/pyproject.toml` and `oracle/uv.lock` from the verified stage. A compatible catalog overlay is explicitly listed in the lock so installed package code remains exact while the adopted retained data comes from its separately pinned catalog commit. Normal package catalog checks, typechecks and parity tests therefore continue to work after adoption without private artifacts or network access.
