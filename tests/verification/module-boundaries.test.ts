import assert from "node:assert/strict";
import test from "node:test";
import {
  checkModule,
  checkRepository,
} from "../../tools/check-module-boundaries.mjs";

test("AR01/AR11 runtime sources retain reviewed package and browser boundaries", () => {
  assert.deepEqual(checkRepository(), []);
});

test("MA01 metadata and main-context imports cannot reach executable tokenizer entrypoints", () => {
  for (const [file, source] of [
    [
      "apps/extension/lib/counting-config.ts",
      'import { BUNDLED_TOKENIZER } from "@footprint/tokenizers"',
    ],
    [
      "apps/extension/lib/coordinator.ts",
      'import { countFields } from "@footprint/tokenizers/worker"',
    ],
    [
      "apps/extension/lib/history-capture.ts",
      'export * from "./counting-worker-config"',
    ],
    [
      "packages/tokenizers/src/runtime.ts",
      'import { BUNDLED_TOKENIZER } from "./bundled"',
    ],
    ["packages/tokenizers/src/manifest.ts", 'export * from "./index"'],
    [
      "packages/tokenizers/src/protocol.ts",
      'await import("gpt-tokenizer/encoding/o200k_base")',
    ],
    [
      "packages/file-text/src/types.ts",
      'import { BUNDLED_TOKENIZER } from "@footprint/tokenizers"',
    ],
    ["packages/file-text/src/host.ts", 'import "@footprint/tokenizers/worker"'],
  ])
    assert.ok(
      checkModule(file, source).some((issue) =>
        issue.includes("executable counting"),
      ),
      file,
    );
  for (const [file, source] of [
    [
      "apps/extension/lib/counting-config.ts",
      'import { BUNDLED_TOKENIZER_MANIFEST } from "@footprint/tokenizers/metadata"',
    ],
    [
      "apps/extension/lib/count.worker.ts",
      'import { countFields } from "@footprint/tokenizers/worker"',
    ],
    [
      "apps/extension/lib/count-host.ts",
      'import url from "./count.worker?worker&url"',
    ],
    [
      "packages/file-text/src/index.ts",
      'import { countText } from "@footprint/tokenizers/worker"',
    ],
    [
      "packages/tokenizers/src/runtime.ts",
      'import { BUNDLED_TOKENIZER_MANIFEST } from "./manifest"',
    ],
  ])
    assert.deepEqual(checkModule(file, source), [], file);
});

test("AR11 boundary gate rejects cross-layer imports and computed module loading", () => {
  const violations = [
    [
      "apps/extension/lib/estimation/probe.ts",
      'import "../dashboard/metric-presentation"',
    ],
    ["apps/extension/lib/estimation/probe.ts", 'import "../file-client"'],
    ["apps/extension/lib/example.ts", "ledger['get']('policy', 'personal')"],
    ["apps/extension/lib/example.ts", "(ledger.get)('policy', 'personal')"],
    ["apps/extension/lib/example.ts", "ledger.get('measurements', id)"],
    ["apps/extension/lib/example.ts", "const db = ledger; db.commit(command)"],
    [
      "apps/extension/lib/example.ts",
      "import * as storage from '@footprint/ledger'; const Db = storage['Ledger']",
    ],
    [
      "apps/extension/lib/example.ts",
      "import '@footprint/contracts/src/export-schema'",
    ],
    ["packages/estimator/src/example.ts", 'export * from "@footprint/ledger"'],
    ["packages/tokenizers/src/example.ts", 'import "@footprint/estimator"'],
    [
      "packages/ledger/src/example.ts",
      'import "../../../apps/extension/lib/company"',
    ],
    ["apps/extension/lib/estimation/example.ts", 'import "../platform"'],
    ["apps/extension/lib/count.worker.ts", 'import "@footprint/ledger"'],
    ["apps/extension/lib/App.tsx", 'import "./coordinator"'],
    ["apps/extension/lib/example.ts", 'import "wxt/browser"'],
    ["apps/extension/lib/example.ts", "await import(location.href)"],
    ["apps/web/src/example.ts", 'import "node:fs"'],
    ["packages/contracts/src/example.ts", 'import "./export-schema"'],
    [
      "apps/extension/lib/example.ts",
      'import type { Ledger as Database } from "@footprint/ledger"',
    ],
    ["apps/extension/lib/example.ts", 'await ledger.get("policy", "personal")'],
    [
      "apps/extension/lib/example.ts",
      'await ledger.scanIndex("attempts", "parent", id, consume)',
    ],
  ];
  for (const [file, source] of violations)
    assert.ok(checkModule(file, source).length > 0, file);
  assert.deepEqual(
    checkModule(
      "apps/extension/lib/example.tsx",
      "export { type Scope } from '@footprint/ledger'",
    ),
    [],
  );
  assert.deepEqual(
    checkModule(
      "packages/tokenizers/src/example.ts",
      'await import("gpt-tokenizer/encoding/o200k_base")',
    ),
    [],
  );
});
