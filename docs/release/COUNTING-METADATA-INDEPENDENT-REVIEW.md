# Independent counting metadata/runtime review

15 September 2026. **Final bounded verdict: CLEAN.** The MA01 metadata/worker split preserves the exercised counting, profile/asset validation, worker, private-file and historical paths. The reviewer found stale test-loader imports; the owner corrected those fixtures and the affected tests pass. No production source was modified by this reviewer.

## Scope

Reviewed the explicit tokenizer entrypoints, metadata and executable worker configuration, affected metadata consumers, source/import gate and rendered-main-chunk guard. Functional checks cover current supported profiles and existing supplied-text fixtures. The provider registry was not changed or re-reviewed.

Final six-package composition and size verification belongs to the artifact reviewer. This report does not accept those final packages, certify native Chrome/Edge/Firefox lifecycle, measure RAM/latency or claim provider token accuracy. No new extraction behavior, profile, encoding, remote endpoint or permission is approved here. Only this report was written for MA01.

## Source assessment

- `@footprint/tokenizers/metadata` exports the protocol, immutable manifest and runtime/validation helpers. It does not export `BUNDLED_TOKENIZER`, `countFields`, `countText` or `verifyAsset`, and its internal dependency graph does not import the encoder implementation.
- `@footprint/tokenizers/worker` exports the executable implementation/counting functions and metadata. The root export remains a compatibility entrypoint for developer callers; browser metadata consumers now use the explicit metadata subpath.
- `counting-config.ts` contains the trusted metadata selection. `counting-worker-config.ts` imports the executable tokenizer only for workers. Actual packaged worker metadata equals the configured immutable runtime.
- File types/hosts, Coordinator, HistoryService/countHistoryPage, runtime composition, platform/host validation, private-file broker/receipt and file projections use metadata imports. Dedicated count/file workers retain executable imports. The BPE asset verification, model-unverified label, measurement scopes, profile selection and count bounds remain intact.
- The source gate rejects main-context executable imports and metadata-to-implementation edges. The Vite guard rejects rendered tokenizer/encoder modules in main chunks while permitting separately emitted worker assets. These are useful enforcement checks; actual final artifact topology still requires the separate artifact review.

## Independent numerical and worker evidence

An additional probe imported the metadata and worker entrypoints explicitly, rather than relying only on the compatibility root used by some test harnesses. It verified the metadata surface has no executable counting exports and compared all **400 golden text cases across both encodings: 800 exact count comparisons**. Every result retained the expected profile and asset hash and passed the metadata-only validator. Replacing the returned asset hash with a forged hash failed validation for every case.

The unchanged expected assets are:

| Profile | SHA-256 |
| --- | --- |
| `o200k-base-4.0.0-reference` | `4cd35a52f4ece645422670151ccbdbd6afd2bcb47b83efd13e47e5d8942aecb4` |
| `cl100k-base-4.0.0-reference` | `b56372fb0b95dbd370f9de6f44b6c15006a8a36980fbc6c0568a0108971aea45` |

Independently executed the owner's already-built diagnostic workers without rebuilding any package. All four emitted ES modules, two count-worker variants and two file-worker variants, passed **800 golden count/hash comparisons each** under Node worker threads with `fetch` denied. This includes empty text and both supported profiles. These are diagnostic Chrome-build assets, not the final six candidates or native-browser execution.

The owner's initial built-file-worker timeout had a demonstrated fixture cause: file jobs used `o200k_base:edge-00`, but the existing file-job contract requires a UUID and intentionally ignores malformed jobs. An independent direct-validation probe rejected that exact ID and accepted a UUID with the same empty-file inputs. Only the ignored probe's ID construction changed; no production workaround or timeout relaxation was needed. The corrected emitted-worker probe then passed independently.

## Reviewer-found fixture regressions and correction

The first 30-test extension run passed 28 cases; both actual file-worker entrypoint tests failed with `unexpected_worker_dependency`. Their test import map still referenced `counting-config` after the executable import moved to `counting-worker-config`. The owner corrected that map and the analogous Node-worker rewrite strings in relay/upload fixtures. An extended run then found the relay manifest test's WXT loader lacked the new `build/tokenizer-boundary` import. The owner mapped the actual guard module there.

No production changes were needed for these regressions. The final affected relay/entrypoint run passed all six tests. All 32 uploaded-file cases passed in the extended run, including both real 33-token receipt assertions, immutable numerical history, company queueing and late guarded refreshes.

One Chrome relay test hit its existing five-second timeout during the concurrent extended run. It passed on the focused affected-file rerun with the same timeout, and no timeout was weakened. This is retained as a timing observation, not converted into a native performance claim.

## Executed checks

| Command or probe | Independent result |
| --- | --- |
| `pnpm --filter @footprint/tokenizers test` | 7 passed, no failures/skips; includes 400 supplied-text cases with both encodings |
| `pnpm --filter @footprint/file-text test` | 13 passed, no failures/skips; includes actual dedicated worker, parser bounds, cancellation and caller-buffer preservation |
| Explicit metadata/worker corpus and forged-asset probe | 800 exact comparisons; all altered asset hashes rejected |
| `node apps/extension/.test-runtime/check-built-tokenizers.mjs` | Four emitted diagnostic workers, 800 exact count/hash comparisons each; exit 0 |
| `node --import tsx --test tests/verification/module-boundaries.test.ts` | 3 passed, no failures/skips |
| Initial focused counting/history/platform/file/build-guard run | 28 passed; 2 stale entrypoint test-loader failures, corrected as described |
| Extended entrypoint/relay/upload run | 36 passed; stale WXT test-loader import and one concurrent relay timeout, resolved on the affected-file rerun |
| `pnpm --filter @footprint/extension exec tsx --test test/file-relay.test.ts test/file-worker-entry.test.ts` | 6 passed, no failures/skips, unchanged timeout |
| `pnpm --filter @footprint/extension exec tsc --noEmit` | Exit 0 after the final source correction |

Initial focused command:

```text
pnpm --filter @footprint/extension exec tsx --test test/counting-runtime-flow.test.ts test/history-counting-runtime.test.ts test/count-boundary-modular.test.ts test/count-worker-runtime-modular.test.ts test/count-platform-modular.test.ts test/file-worker-entry.test.ts test/file-transport.test.ts test/tokenizer-build-boundary.test.ts
```

Extended command:

```text
pnpm --filter @footprint/extension exec tsx --test test/file-worker-entry.test.ts test/file-relay.test.ts test/uploaded-files.test.ts
```

The unchanged passing cases include actual Coordinator/history/file/receipt use of the same distinct fake tokenizer, existing cl100k receipt acceptance, wrong-asset rejection, immutable metadata snapshots, worker restart, queue/cancellation behavior and private transport. The test runs and corpus probes overlap and are not summed as a unique-test total. No broad extension suite or six-build regeneration was run.

## Diagnostic emitted-worker snapshot

Root: `apps/extension/.test-runtime/tokenizer-diagnostic-output/chrome-mv3/assets`. These ignored diagnostic files were inspected/executed locally and are not accepted release artifacts.

| File | SHA-256 | Exact comparisons |
| --- | --- | --- |
| `count.worker-DDeG4lWu.js` | `91d7745f52fe517f412e381993b789b457693789d4d256db7555c3bcb79b8bf4` | 800 |
| `count.worker-DV3z8oDP.js` | `afd45c7f53c98275dfb5af58f981961309db804421ddb9afbd565d2319702d09` | 800 |
| `file.worker-CYDTenGc.js` | `f49fcd32e95309e3417f310dde9155ebf800dff8a869193788cebd499677a87c` | 800 |
| `file.worker-DYGm1sRO.js` | `ce29ba19370625e3a1386265ed54806f65f71fe45bec388b8cb99579a562be0a` | 800 |

## Final source snapshot

The owner's 40-file handoff was independently hash-checked against disk after fixture corrections. Whole-file hashes do not extend this verdict to unrelated estimator, storage, organization or release behavior in those files.

Snapshot timestamp: `2026-09-15T11:00:34+00:00`. SHA-256 over file bytes.

| Path | SHA-256 |
| --- | --- |
| `packages/tokenizers/package.json` | `b0df6653ba147abf65cad641a8b3f7c26532927374e60e9d8b4ce03d7014bca6` |
| `packages/tokenizers/README.md` | `d104296ec97dee598b6f2c76e0605026f32a94eda9972e34d25865a6a5bef148` |
| `packages/tokenizers/src/manifest.ts` | `bb9759296288a0d9361687a79a4e19d8a26c7669c65141e15710786d79e80a49` |
| `packages/tokenizers/src/metadata.ts` | `bc2e635842759302f3a4af1544bcb58cdcd5f8c1d26fbec474aa2e46bd7f11f9` |
| `packages/tokenizers/src/worker.ts` | `a8a9302306475496bdbd4666b0f8a3f0ebaecd49788ab586c27bdbc15dfcf395` |
| `packages/tokenizers/src/index.ts` | `a25f625cfe56a4f3b519b090c3211801f6447dac2eb6b23927b8a3f93576e1e9` |
| `packages/tokenizers/src/bundled.ts` | `81a33a60cd9e4fd18932811ae2ca338bf05e1506914e475e4877b6cbf12c2e89` |
| `packages/tokenizers/src/counting.ts` | `167b9cbd988f6cbdc95283447f4a42d5d99ee2d9f72a36e3c412297f88dcda72` |
| `packages/tokenizers/src/runtime.ts` | `fa492880b7960b5d3b99ad4df899efd79ba20fc3194688d117c3455dcdfe8117` |
| `packages/file-text/src/index.ts` | `be4505a85c9be1a7ca2f345f47d163c4afcd1587889729acd99f51c58f0e839c` |
| `packages/file-text/src/types.ts` | `114b01e5470cdc61c71f39a249278453c71429122147d13d3b24c6d26955001e` |
| `packages/file-text/src/host.ts` | `47073a0e98df5dbb0f46e234ddc046f81af0db54f8bcfc6cd51644cad0a297c2` |
| `apps/extension/lib/counting-config.ts` | `3404d539d0d208bd9f6462296976bcce992347a663854fdec51c24c82f7ec536` |
| `apps/extension/lib/counting-worker-config.ts` | `aebc1d795b4a8274841df7d838e625cefb7f9f683c2512f6542af093e13c64c0` |
| `apps/extension/lib/count.worker.ts` | `b4208b9c7dab28d200af65cdcf5576f8df8ff72393e36ca5c0e489671a98f89d` |
| `apps/extension/lib/file.worker.ts` | `1c7f1fc9c733cbe8b9e84df3ea4009c22fea56861f85c7e8f9ffff89e5cf38f9` |
| `apps/extension/lib/coordinator.ts` | `04a47804bcb1f93602cc6598fe678306d696991ad6349ea5cb873f01d75e1b17` |
| `apps/extension/lib/count-host.ts` | `ea462d0ff9d60f1a6cc0e8361248224bf63ffd525c83166f3fc1c431ff708ab8` |
| `apps/extension/lib/platform.ts` | `648b44a97b5455431a698dc931b311ab46dcaa981178c69d539ccce34b1e6a13` |
| `apps/extension/lib/history-service.ts` | `2d4e356c8841b9059ad87929856b3805309c1bb471e5323e63ac91b5d6c8db19` |
| `apps/extension/lib/history-capture.ts` | `3f22eaecda01e9dbd0b08714d20b5a0b7a9470463e0b58226f12b0f2d07b098b` |
| `apps/extension/lib/runtime-composition.ts` | `5ef0d840eed9e701f2eaefa73d6ce89e46d9fe32ec4fe6283ba17e02df272d88` |
| `apps/extension/lib/inline-file-components.ts` | `d37d884c8ba4c393d060c40d823d3a1f9ec0f91434096f49ce600fb71547fb30` |
| `apps/extension/lib/file-receipt-result.ts` | `932cd1ee68f7bd1e8040862eab86a47f602e861958cef13762de0dbd8f445272` |
| `apps/extension/lib/file-grant-broker.ts` | `df3684eeda5c78fb8b999226d789db1b00c6ec2faa43380fb222ad89338cca5f` |
| `apps/extension/lib/file-client.ts` | `5cd14f370bd8ea8d351ca6e32434fc80e29257d584b72c5a7c09f3cb31609916` |
| `apps/extension/lib/uploaded-file-components.ts` | `71979b5382c602547e162197cbc797bcfb430566f90ff201f7292a8b07fb640c` |
| `apps/extension/build/tokenizer-boundary.ts` | `b0b6dcb362085941a12599c3d6bead962b82ede672ec57268c5c7c8e34072818` |
| `apps/extension/wxt.config.ts` | `5bacd9ce7d12baa7dc7dac7770bcba224ccc8641588549002f055d7c00068678` |
| `apps/extension/test/tokenizer-build-boundary.test.ts` | `0c2829c649b668c19ff4fdf0eb5191ca66889bf4a284385ed38159fba1584127` |
| `apps/extension/test/counting-runtime-fixture.ts` | `9af585f393beb2cbbb011eaa7a30d556b65bc9ceeaf36a674988097525b6b82c` |
| `apps/extension/test/count-worker-runtime-modular.test.ts` | `93dd6f42ac53dc6c9db42e6b074313b7bf8848a4eb81bd25bac1a8d43d0d1412` |
| `apps/extension/test/count-platform-modular.test.ts` | `ff965b6cbfaaa9e567e5d8a634ce34cba7367ffa56659b5d0e2fb43bfbe748db` |
| `apps/extension/test/count-boundary-modular.test.ts` | `942d22d4e58b228334bdd3a6766e5e30c17a61e77f467b471a9e7d2f870a53de` |
| `apps/extension/test/file-transport.test.ts` | `ec2c230389f4911b06ebe452b4f55ee879635e545fe4364a2535ab8566fc44e7` |
| `tools/check-module-boundaries.mjs` | `f6a548d23ad9f58637f629d742046e43ef42286ca98d92dcc05c3067616810a2` |
| `tests/verification/module-boundaries.test.ts` | `7980898ba78f5d8724c772602f61584b0f3914255ceafa8baf489831a67cfba7` |
| `apps/extension/test/file-worker-entry.test.ts` | `7245bcb3fab4605e6e8a045ab1a7100abbc5489d670437a678f41c16adc83f7f` |
| `apps/extension/test/file-relay.test.ts` | `3a28a359293126954ed991ff5b056bc7e83e2af1580dc841afa43b430ae329c6` |
| `apps/extension/test/uploaded-files.test.ts` | `571b5649c87858c02a856e78766040a380187ca466d40735050b95a213dbc909` |

**Conclusion: CLEAN for the MA01 source/runtime correction and the exercised diagnostic workers.** No unresolved functional finding remains in this scope. Final six-bundle topology/size and native browser/performance acceptance remain with their assigned reviewers. No source was changed by this reviewer.
