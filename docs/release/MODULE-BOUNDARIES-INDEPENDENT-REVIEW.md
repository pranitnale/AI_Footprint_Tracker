# Independent TypeScript module-boundary review

15 September 2026. **Bounded verdict: FINDINGS.** Reviewed `tools/check-module-boundaries.mjs` and `tests/verification/module-boundaries.test.ts`. Only this report was written. No checker, application, package, test, dependency or CI source was changed by the reviewer.

The checker is an architectural regression gate for the scanned TypeScript runtime files. It is not Python enforcement, native-browser verification, a JavaScript sandbox or a security guarantee against arbitrary executable code or filesystem tricks.

## Executed baseline

- `node --import tsx --test tests/verification/module-boundaries.test.ts`: **2 passed**, zero failures/skips, 1055.56 ms.
- Independent `checkRepository()` invocation: **zero live issues** at the inspected snapshot. This result does not prove the unfinished application migration is complete, and later legitimate migration failures must be assessed separately from checker defects.
- Ten independently supplied forbidden dependency forms were rejected: static side-effect import, export-star, named export, whole/inline type import, dynamic literal import, require, import-equals, type import-equals and import-type query.
- Computed loading rejection and the explicit shared-package/external dependency tables are present. `sourceFiles` scans TypeScript runtime modules under package `src`, extension `lib`/`entrypoints` and web `src`, not Python or dependency/vendor implementations.
- Root `test:verification` includes this test file through its glob; root `check` invokes that script, and `.github/workflows/check.yml` invokes `pnpm check`. Root comparison test/typecheck and maintenance-test wiring is also present. Source wiring was inspected; hosted CI was not executed here.

## Findings

### MB-01: Estimation can import unlisted presentation/browser adapters (P2)

The estimation relative-target prohibition enumerates a few filenames instead of the complete intended browser/presentation boundary. Both of these imports from `apps/extension/lib/estimation/probe.ts` return an empty issue list:

```ts
import "../dashboard/metric-presentation";
import "../file-client";
```

Both target actual modules. The first crosses into dashboard presentation; the second reaches a browser adapter named in the checker's own `browserClients` set. In contrast, `../platform` is rejected. The dependency policy therefore depends on which adapter/UI filename is chosen, rather than enforcing the claimed direction. Cover the intended adapter and dashboard families consistently, including `.ts` presentation helpers, while retaining explicitly allowed type-only DTO dependencies.

### MB-02: Concrete Ledger and raw-table checks miss ordinary syntax and stores (P2)

Independent `checkModule("apps/extension/lib/probe.ts", source)` calls accepted all of these:

```ts
await ledger["get"]("policy", "personal");
await (ledger.get)("policy", "personal");
await ledger.get("measurements", "id");
const db = ledger; await db.commit(scope, [], undefined);
import * as storage from "@footprint/ledger";
const Db = storage["Ledger"];
```

`measurements` is a real store in `packages/ledger/src/ledger-support.ts`, and the concrete class exposes the generic get/commit operations. The store-name set omits it. Call inspection only recognizes direct property-access callees, and raw commit detection depends on the literal receiver name `ledger`. Concrete-class detection only recognizes an identifier spelled `Ledger`, missing indexed namespace access.

A combined, syntactically valid example is also accepted:

```ts
import * as storage from "@footprint/ledger";
async function read() {
  const db = await storage["Ledger"].open("probe");
  return (db.get)("measurements", "id");
}
```

This is not a claim that every arbitrary JavaScript alias must be security-analyzed. It demonstrates common direct/parenthesized/indexed syntax and a real unlisted table defeating the explicit no-concrete-Ledger/no-raw-table policy. Cover these forms, derive or verify the store inventory, and distinguish domain repository operations from concrete storage access using a documented rule.

### MB-03: Inline type-only reexports are misclassified (P3)

From `apps/extension/lib/probe.tsx`, these equivalent type-only forms receive different outcomes:

```ts
export { type Scope } from "@footprint/ledger"; // rejected as a runtime presentation bypass
export type { Scope } from "@footprint/ledger"; // accepted
```

`importsOf` reports the first as `typeOnly: false`. It already recognizes inline type-only named imports, but does not apply the corresponding check to named exports. Type-only import-equals is also reported as false. Preserve the policy distinction for supported equivalent TypeScript syntax, while mixed type/value imports or exports must remain runtime dependencies.

### MB-04: The build-tool exclusion guarantee depends on uninspected export maps (P2 gate gap)

The generator exclusion is exact, but the importer guard only checks relative targets. This accepted-package path receives no issue:

```ts
// packages/estimator/src/probe.ts
import "@footprint/contracts/src/export-schema";
```

The current contracts package exports only its runtime index, so this particular subpath is presently blocked by package resolution. This is **not a demonstrated current routable application import**. It shows that the checker itself does not establish the promised exclusion: it permits arbitrary subpaths of approved package names and does not inspect export-map destinations. A future exported alias pointing at an exempt generator could pass this gate while the generator remains skipped.

Either resolve approved internal package entries/export destinations and reject the build-only target, or enforce a reviewed runtime subpath/export-map allowlist. Keep this guarantee's dependency on package metadata explicit rather than treating the relative filename check as complete enforcement.

## Scope and source boundary

| File | Reviewed SHA256 |
| --- | --- |
| `tools/check-module-boundaries.mjs` | `7662790aa579f7fa0d55fcc94aea08977b076af81e905fe96ee0228af329f9d9` |
| `tests/verification/module-boundaries.test.ts` | `6189b30bcb470dcee9e437f431be3d675f3e7fdfae3392fdf666971912456b4c` |

The independent adversarial inputs ran in memory through the exported checker functions. No synthetic application source was written into the repository. Their empty issue arrays establish checker false negatives, not successful runtime exploitation. Current source compilation/export resolution is specifically distinguished for MB-04.

The gate needs targeted corrections and independent rechecks before AR11 can receive a bounded passing verdict. Passing its two current tests and finding no present repository violation do not clear these uncovered policy paths. Native browser, Python, dependency supply-chain and final release checks remain outside this review.

## Independent remediation recheck, 15 September 2026

**Latest verdict: FINDINGS. MB-01 and MB-02 are CLOSED for the documented valid TypeScript forms. MB-03 is partially corrected and MB-04 remains open.** This recheck was performed by a separate reviewer after the original reviewer moved to counting implementation. No checker, runtime source, test or repository package manifest was changed by this reviewer; this section is appended to preserve the original evidence.

The updated two-test suite passes and `node tools/check-module-boundaries.mjs` reports no current repository issues. Independent evidence is under `%TEMP%/aift-module-boundaries-recheck-20260915/`: `independent-recheck.mjs`, `initial-recheck-results.json`, `await-context.mjs`, `await-context-results.json`, a checker source copy and source hashes. Synthetic package manifests and modules used for the export-map test exist only inside that temporary directory.

### Closed cases and parsing qualification

MB-01's two exact relative imports now fail under the stronger estimation-folder rule. Relative imports outside that folder are denied except the explicit build/mapping configuration paths; the configuration file's own outer-module exception remains separately checked.

MB-02 now rejects bracket calls, parenthesized calls in valid async/module context, the `measurements` example, direct declaration aliases, storage namespace imports and the combined concrete-class example. Detection no longer depends on enumerating store-name strings for the guarded receivers. All ten previously rejected import syntaxes remain rejected when they cross a forbidden package boundary.

One exact fragment from the earlier report, bare top-level `await (ledger.get)(...)` without module syntax, still returns no issue. AST inspection shows TypeScript parses that script fragment as a call to an identifier named `await`, not an AwaitExpression. Adding `export {}` or placing it inside `async function read()` produces the intended AST and the access is rejected. This is not retained as a false-negative finding for a valid module-level await operation. The checker is not a substitute for parsing/typechecking the complete application source.

### MB-03 remaining type-only form

Inline and whole-declaration type reexports now agree and are allowed. However:

```ts
import type Types = require("@footprint/ledger");
type S = Types.Scope;
```

`importsOf` still reports `typeOnly: false` for this declaration. In `apps/extension/lib/probe.tsx`, it is rejected as a runtime presentation bypass. The ImportEqualsDeclaration branch does not forward `node.isTypeOnly`. This is the remaining part of MB-03, rather than a new policy request.

### MB-04 remaining export-destination gap

The exact unexported `@footprint/contracts/src/export-schema` import now fails. The checker reads export-map keys, but does not inspect their destination values. The isolated fixture contains an exempt `packages/contracts/src/export-schema.ts` and a runtime estimator module importing an explicitly exported package entry. Both `checkModule` and `checkRepository` return empty issue lists for each of these maps:

```json
{".": "./src/index.ts", "./schema-builder": "./src/export-schema.ts"}
{".": "./src/export-schema.ts"}
{".": {"import": "./src/export-schema.ts", "default": "./src/index.ts"}}
```

The first runtime import is `@footprint/contracts/schema-builder`; the latter two import `@footprint/contracts`. All resolve through declared exports in the fixture, while the generator remains excluded from source scanning. A specifier-name ban cannot establish the destination guarantee when the exported name is different. Resolve/enforce the runtime destinations, including conditional branches, or use a separately reviewed export-destination allowlist.

The actual repository's current contracts export remains its runtime index. This is a reproduced regression-gate gap under a manifest change, not a claim that a current application import reaches the generator or that the generator was executed. The parent received both remaining findings before any CLEAN verdict.

| File | Recheck SHA256 |
| --- | --- |
| `tools/check-module-boundaries.mjs` | `c344d375bab9e1a8f159784c9cdf3817aadc4a3f179c3ebb0ddd748a1e8620b1` |
| `tests/verification/module-boundaries.test.ts` | `363defd0d0ca1fbb6e12461d2a6b24974738adff5d3918a82739878a5c5fedfe` |

The TypeScript-layer, CI and source-scope qualifications above remain in force. New counting modules or legitimate composition changes must receive explicit policy review if they cross a checked boundary; a live violation is not a reason to weaken a rule automatically.

## Final independent remediation closure, 15 September 2026

**Latest bounded verdict: CLEAN. MB-01 through MB-04 are CLOSED for the documented TypeScript syntax, configured layer rules and explicit package-export policy.** The earlier findings, source snapshots and the bare-script parsing qualification remain preserved above. This is an architectural regression gate, not a proof against arbitrary JavaScript reflection, filesystem indirection or unscanned languages.

The reviewer inspected the final changes and reran the independent cases. Type-only import-equals now forwards `node.isTypeOnly`, produces `typeOnly: true` and is accepted in the permitted presentation type-only case. Inline and whole type reexports remain equivalent; mixed type/value exports remain runtime dependencies and are rejected where required.

The new package-export inspection walks nested object and array destinations, normalizes relative destinations, rejects generator/developer/upstream targets and package escapes, and requires explicit public paths without wildcards. `checkRepository` inspects every package map even if no application currently imports that entry. The three earlier aliased/root/conditional generator cases now fail through both checker entry points.

The original independent script was unchanged. Its temporary synthetic estimator package needed a minimal `package.json` because the strengthened repository scan now inspects every package's exports; only that temporary fixture setup was completed. No repository manifest or repro import was altered. Final results are in `final-recheck-results.json` under the recheck evidence directory named above.

Independent final execution:

- `node --import tsx --test tests/verification/module-boundaries.test.ts tests/verification/module-exports.test.ts`: **4/4 PASS**, zero failures/skips.
- `node tools/check-module-boundaries.mjs`: PASS. Independent `checkRepository()` also returns no current runtime source or package-export issues.
- The MB-01/MB-02 cases remain rejected in valid module/async syntax, and all ten forbidden dependency forms remain rejected. The initial bare-script `await` AST qualification is unchanged and is not treated as a valid-module storage bypass.
- `export-controls.mjs` verifies four allowed export-map forms: string root, named alias, root conditional and array. Five forbidden controls also pass: a generator hidden in nested conditional/array branches, developer tools, retained upstream source, a package escape and wildcard exports. These checks run without any application importing the export, establishing the metadata-wide guard.
- Additional controls verify that the build-data exception applies only to `lib/estimation/config.ts`, ordinary own-folder estimation type imports remain allowed, and mixed type/value presentation exports remain blocked.

The source wiring remains `test:verification` through root `check` and the hosted workflow's `pnpm check`. This review executed local checks only, not hosted CI, Python or native browser tests. Counting changes added after this snapshot still require the live gate and explicit policy assessment; no allowlist was weakened by the reviewer.

| File | Final SHA256 |
| --- | --- |
| `tools/check-module-boundaries.mjs` | `65db652bf228637c6419d3e229918879413cdf7818c92d761cafef2b55db397c` |
| `tests/verification/module-boundaries.test.ts` | `363defd0d0ca1fbb6e12461d2a6b24974738adff5d3918a82739878a5c5fedfe` |
| `tests/verification/module-exports.test.ts` | `2d707ad718c4995c4af23a4d82a8ff3db66366e8c1218b83919937dce2a34dd2` |

Only this report and temporary evidence were written by the re-reviewer. The ledger, core and controlled-comparison reviews remain unchanged.
