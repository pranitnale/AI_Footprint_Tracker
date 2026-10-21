# Browser source archive

This archive contains the source and locked JavaScript dependencies needed to rebuild the unsigned browser extension. It is a rebuild-only subset of the repository, not a complete development checkout.

Use Node 22.23.2 and pnpm 11.19.0. From the extracted archive root:

```sh
pnpm install --frozen-lockfile
node --import tsx tools/refinement/build-variants.ts --release-candidate
```

The command creates three distinct distributions under `apps/extension/.output`: Chrome, Edge and Firefox with EcoLogits as the default and only selectable product engine. Original calculation code remains for historical compatibility and research; the active engine override is disabled. Each output includes its variant manifest, full third-party license payloads and corresponding EcoLogits source archive.

The full repository's `verify:source-archive` command performs one frozen install, rebuilds all three variants sequentially, and compares every reconstructed distribution path and byte hash with its matching ZIP. It runs outside this subset.

Use `--browser chrome|edge|firefox` and `--engine ecologits` to rebuild one variant. Omit `--release-candidate` for an explicitly intermediate local build. Packages remain unsigned; building does not install, sign, publish or certify a native browser extension.

All build commands use the same three folders: `.output/chrome-mv3`, `.output/edge-mv3` and `.output/firefox-mv2`. Each uses EcoLogits. Release builds replace those folders instead of creating engine-suffixed copies. Load the matching folder in your browser and use Reload after rebuilding it. If you previously loaded a suffixed folder, remove that old browser entry and load the canonical folder; changing paths can create a different extension identity and separate local storage.

Test source is retained for inspection, but this archive does not support running tests or root `pnpm check`. The full repository also contains sanitized root fixtures, calibration corpora, Python reference environments, server code, documentation and release tools required by those commands. Use a complete checkout and its root README for development and verification. Do not infer that missing fixture files represent missing provider data or substitute real authenticated captures.
