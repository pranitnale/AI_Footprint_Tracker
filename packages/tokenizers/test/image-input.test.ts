import test from "node:test";
import assert from "node:assert/strict";
import { TokenMeasurementSchema } from "@footprint/contracts";
import {
  IMAGE_INPUT_PROFILE_ID,
  anthropicResizedSize,
  imageInputMeasurement,
  imageInputRule,
  imageInputTokens,
  imageInputTotal,
  openaiPatchTokens,
  openaiTileTokens,
} from "../src/metadata";

const size = (width: number | null, height: number | null) => ({
  width,
  height,
});

test("OpenAI patch tokens match the published GPT-6 Astra high detail examples", () => {
  // High detail: 65,535 pixels, a 2,500-patch budget and a 1.2 multiplier.
  const high = {
    kind: "openai_patches",
    maxDimension: 65_535,
    budget: 2500,
    multiplier: 120,
  } as const;
  assert.equal(openaiPatchTokens({ width: 1024, height: 1024 }, high), 1229);
  assert.equal(openaiPatchTokens({ width: 2048, height: 2048 }, high), 3000);
  assert.equal(openaiPatchTokens({ width: 4096, height: 512 }, high), 2458);
});

test("OpenAI auto detail follows each model's sizing row", () => {
  const tokens = (
    model: Parameters<typeof imageInputRule>[1],
    w: number,
    h: number,
  ) => imageInputTokens(imageInputRule("chatgpt", model)!, size(w, h));
  // GPT-6 Astra and GPT-5.6 keep the original size: 4000 x 3000 is 125 x 94 patches.
  assert.equal(
    tokens("chatgpt-gpt-6-astra", 4000, 3000),
    Math.ceil(125 * 94 * 1.2),
  );
  assert.equal(tokens("chatgpt-gpt-5-6-sol", 4000, 3000), 14100);
  // Past 30,000 patches the API rejects the image, so a site must have scaled it.
  assert.ok(tokens("chatgpt-gpt-6-astra", 8000, 8000)! <= 36_000);
  // GPT-5.5 auto is original detail capped at 10,000 patches and 6,000 pixels: the
  // budget step scales 4000 x 3000 to 3669 x 2752, which is 115 x 86 patches.
  assert.equal(
    tokens("chatgpt-gpt-5-5", 4000, 3000),
    Math.ceil(115 * 86 * 1.2),
  );
  // GPT-5.4 auto is high detail: 2,500 patches.
  assert.equal(tokens("chatgpt-gpt-5-4", 2048, 2048), 3000);
  // GPT-5.2: 2,048 pixels and 6,144 patches; 2048 x 2048 is 4,096 patches.
  assert.equal(tokens("chatgpt-gpt-5-2", 2048, 2048), Math.ceil(4096 * 1.2));
  // Tiles: the published GPT-4o examples.
  assert.equal(tokens("chatgpt-gpt-4o", 1024, 1024), 765);
  assert.equal(tokens("chatgpt-gpt-4o", 2048, 4096), 1105);
  assert.equal(
    openaiTileTokens(
      { width: 512, height: 512 },
      { kind: "openai_tiles", base: 70, tile: 140 },
    ),
    210,
  );
  // Variants read images like their base model; unlisted models use the benchmark row.
  assert.deepEqual(
    imageInputRule("chatgpt", "chatgpt-gpt-5-5-pro"),
    imageInputRule("chatgpt", "chatgpt-gpt-5-5"),
  );
  assert.deepEqual(
    imageInputRule("chatgpt", "chatgpt-o3-pro"),
    imageInputRule("chatgpt", "chatgpt-o3"),
  );
  for (const model of [
    "chatgpt-gpt-6-1-sol",
    "chatgpt-gpt-5-3-mini",
    "chatgpt-latest",
    null,
  ] as const)
    assert.deepEqual(
      imageInputRule("chatgpt", model),
      imageInputRule("chatgpt", "chatgpt-gpt-6-astra"),
    );
});

test("Anthropic tokens follow the published resize table for both tiers", () => {
  const cases = [
    [200, 200, 64, 64],
    [1000, 1000, 1296, 1296],
    [1092, 1092, 1521, 1521],
    [1920, 1080, 1560, 2691],
    [2000, 1500, 1564, 3888],
    [3840, 2160, 1560, 4784],
  ] as const;
  for (const [w, h, standard, high] of cases) {
    assert.equal(
      imageInputTokens(
        imageInputRule("claude", "claude-sonnet-4-6")!,
        size(w, h),
      ),
      standard,
      `${w}x${h}`,
    );
    assert.equal(
      imageInputTokens(
        imageInputRule("claude", "claude-opus-4-7")!,
        size(w, h),
      ),
      high,
      `${w}x${h}`,
    );
  }
  assert.deepEqual(anthropicResizedSize(1920, 1080, 1568, 1568), {
    width: 1456,
    height: 819,
  });
  // The docs table shows 1269 x 952; the longest edge that fits is 1270 x 952. Both cost
  // 1,564 tokens, and profile vendor-image-rules-1 records 1270 x 952.
  assert.deepEqual(anthropicResizedSize(2000, 1500, 1568, 1568), {
    width: 1270,
    height: 952,
  });
  assert.deepEqual(anthropicResizedSize(3840, 2160, 2576, 4784), {
    width: 2576,
    height: 1449,
  });
  // A portrait A4 scan, and the same scan turned on its side.
  assert.deepEqual(anthropicResizedSize(1075, 1520, 1568, 1568), {
    width: 924,
    height: 1307,
  });
  assert.deepEqual(anthropicResizedSize(1520, 1075, 1568, 1568), {
    width: 1307,
    height: 924,
  });
  // Claude 4.7 and later are high resolution; ids without a version use Opus 5.5.
  for (const model of [
    "claude-fable-5-1",
    "claude-sonnet-5",
    "claude-opus-4-8",
    "claude-unlisted",
    null,
  ] as const)
    assert.deepEqual(
      imageInputRule("claude", model),
      imageInputRule("claude", "claude-opus-4-7"),
      String(model),
    );
  for (const model of [
    "claude-haiku-4-5",
    "claude-opus-4-6",
    "claude-sonnet-3-7",
    "claude-opus-3",
  ] as const)
    assert.deepEqual(
      imageInputRule("claude", model),
      imageInputRule("claude", "claude-sonnet-4-6"),
      model,
    );
});

test("Gemini 3 counts a fixed amount per image; older Gemini counts 768-pixel tiles", () => {
  const gemini3 = imageInputRule("gemini", "gemini-3-8-flash")!;
  assert.equal(imageInputTokens(gemini3, size(null, null)), 1120);
  assert.equal(imageInputTokens(gemini3, size(4000, 3000)), 1120);
  for (const model of [
    "gemini-unnamed",
    "gemini-nano-banana-2",
    "gemini-deep-research",
    null,
  ] as const)
    assert.deepEqual(imageInputRule("gemini", model), gemini3, String(model));
  const older = imageInputRule("gemini", "gemini-2-5-pro")!;
  assert.deepEqual(imageInputRule("gemini", "gemini-nano-banana"), older);
  assert.equal(imageInputTokens(older, size(384, 300)), 258);
  assert.equal(imageInputTokens(older, size(1000, 800)), 4 * 258);
  assert.equal(imageInputTokens(older, size(null, null)), null);
});

test("Perplexity uses the answering model's vendor and the OpenAI rule otherwise", () => {
  assert.deepEqual(
    imageInputRule("perplexity", "perplexity-claude-opus-4-6"),
    imageInputRule("claude", "claude-opus-4-6"),
  );
  assert.deepEqual(
    imageInputRule("perplexity", "perplexity-gemini-2-5-pro"),
    imageInputRule("gemini", "gemini-2-5-pro"),
  );
  assert.deepEqual(
    imageInputRule("perplexity", "perplexity-o4-mini"),
    imageInputRule("chatgpt", "chatgpt-o4-mini"),
  );
  assert.deepEqual(
    imageInputRule("perplexity", "perplexity-unlisted-anthropic"),
    imageInputRule("claude", "claude-unlisted"),
  );
  assert.deepEqual(
    imageInputRule("perplexity", "perplexity-unlisted-google"),
    imageInputRule("gemini", "gemini-unlisted"),
  );
  for (const model of [
    "perplexity-best",
    "perplexity-kimi-k3",
    "perplexity-unlisted",
    null,
  ] as const)
    assert.deepEqual(
      imageInputRule("perplexity", model),
      imageInputRule("chatgpt", "chatgpt-gpt-6-astra"),
      String(model),
    );
  // NotebookLM reads images as sources, which are not counted.
  assert.equal(imageInputRule("notebooklm", "notebooklm-default"), null);
});

test("image measurements stay estimates and never read a hidden size as zero", () => {
  const rule = imageInputRule("claude", "claude-opus-4-7");
  const known = imageInputMeasurement(rule, size(1000, 1000));
  const hidden = imageInputMeasurement(rule, size(null, null));
  for (const value of [
    known,
    hidden,
    imageInputMeasurement(null, size(1, 1)),
    imageInputTotal([]),
    imageInputTotal([known, known]),
    imageInputTotal([known, hidden]),
    imageInputTotal([hidden]),
  ])
    assert.ok(TokenMeasurementSchema.safeParse(value).success);
  assert.equal(known.value, "1296");
  assert.equal(known.profile_id, IMAGE_INPUT_PROFILE_ID);
  assert.equal(hidden.value, null);
  assert.equal(hidden.reason, "image_dimensions_unknown");
  assert.equal(imageInputTotal([]).evidence, "not_applicable");
  assert.equal(imageInputTotal([known, known]).value, "2592");
  assert.equal(
    imageInputTotal([known, known]).completeness,
    "complete_for_scope",
  );
  const partial = imageInputTotal([known, hidden]);
  assert.equal(partial.value, "1296");
  assert.equal(partial.completeness, "partial");
  assert.equal(partial.reason, "image_dimensions_unknown");
  assert.equal(imageInputTotal([hidden]).value, null);
});
