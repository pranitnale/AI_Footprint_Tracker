import assert from "node:assert/strict";
import test from "node:test";
import { assertMainThreadTokenizerBoundary } from "../build/tokenizer-boundary";
import { PACKAGED_COUNTING_RUNTIME } from "../lib/counting-config";
import { PACKAGED_TOKENIZER } from "../lib/counting-worker-config";
import { createCountingRuntime } from "@footprint/tokenizers/metadata";

test("MA01 main output rejects rendered encoder implementations and dictionaries, including shared chunks", () => {
  for (const file of [
    "content-scripts/capture.js",
    "content-scripts/content.js",
    "background.js",
    "chunks/shared.js",
    "chunks/dashboard.js",
  ])
    for (const id of [
      "/repo/node_modules/.pnpm/gpt-tokenizer@4.0.0/node_modules/gpt-tokenizer/esm/bpeRanks/o200k_base.js",
      "C:\\repo\\node_modules\\gpt-tokenizer\\esm\\encoding\\cl100k_base.js",
      "/repo/packages/tokenizers/src/bundled.ts",
      "/repo/packages/tokenizers/src/counting.ts",
    ])
      assert.throws(
        () =>
          assertMainThreadTokenizerBoundary({
            [file]: { type: "chunk", modules: { [id]: { renderedLength: 1 } } },
          }),
        /Tokenizer worker code rendered/,
      );
});

test("MA01 metadata, eliminated code and separately emitted worker assets are allowed", () => {
  assert.doesNotThrow(() =>
    assertMainThreadTokenizerBoundary({
      "background.js": {
        type: "chunk",
        modules: {
          "/repo/packages/tokenizers/src/manifest.ts": { renderedLength: 400 },
          "/repo/packages/tokenizers/src/runtime.ts": { renderedLength: 1200 },
          "/repo/node_modules/gpt-tokenizer/esm/encoding/o200k_base.js": {
            renderedLength: 0,
          },
        },
      },
      "assets/count.worker.js": { type: "asset" },
      "assets/o200k_base.js": { type: "asset" },
      "assets/file.worker.js": { type: "asset" },
    }),
  );
});

test("MA01 packaged worker implementation and metadata retain identical counting selection", () => {
  assert.deepEqual(
    createCountingRuntime(
      PACKAGED_TOKENIZER,
      PACKAGED_COUNTING_RUNTIME.selection.profileId,
    ),
    PACKAGED_COUNTING_RUNTIME,
  );
  assert.equal("count" in PACKAGED_COUNTING_RUNTIME.manifest, false);
});
