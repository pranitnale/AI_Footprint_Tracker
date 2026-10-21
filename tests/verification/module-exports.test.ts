import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import {
  checkModule,
  checkRepository,
} from "../../tools/check-module-boundaries.mjs";

test("AR11 import-equals preserves erased type-only dependencies", () => {
  assert.deepEqual(
    checkModule(
      "apps/extension/lib/example.tsx",
      "import type Types = require('@footprint/ledger');",
    ),
    [],
  );
});

test("AR11 package export aliases and conditional branches cannot expose excluded build tools", () => {
  const root = mkdtempSync(join(tmpdir(), "aift-module-exports-"));
  try {
    for (const directory of [
      "packages/contracts/src",
      "apps/extension/lib",
      "apps/extension/entrypoints",
      "apps/web/src",
    ])
      mkdirSync(join(root, directory), { recursive: true });
    writeFileSync(
      join(root, "packages/contracts/src/index.ts"),
      "export const value = 1;",
    );
    writeFileSync(
      join(root, "packages/contracts/src/export-schema.ts"),
      "import 'node:fs';",
    );
    const cases = [
      {
        exports: { "./schema-builder": "./src/export-schema.ts" },
        specifier: "@footprint/contracts/schema-builder",
      },
      { exports: "./src/export-schema.ts", specifier: "@footprint/contracts" },
      {
        exports: {
          ".": { import: "./src/export-schema.ts", require: "./src/index.ts" },
        },
        specifier: "@footprint/contracts",
      },
    ];
    for (const fixture of cases) {
      writeFileSync(
        join(root, "packages/contracts/package.json"),
        JSON.stringify({
          name: "@footprint/contracts",
          exports: fixture.exports,
        }),
      );
      assert.ok(
        checkModule(
          "apps/extension/lib/probe.ts",
          `import '${fixture.specifier}';`,
          root,
        ).length > 0,
      );
      assert.ok(checkRepository(root).length > 0);
    }
  } finally {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith("aift-module-exports-"));
    rmSync(root, { recursive: true, force: true });
  }
});
