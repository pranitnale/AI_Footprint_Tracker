import assert from "node:assert/strict";
import test from "node:test";
import { catalog, findModel, llmImpacts, validateImpacts } from "../src/index.js";

test("issue 264: published timing uses seconds and no catalog throughput is zero", () => {
  // EcoLogits 0.11.3 values; 0.11.2 had 47 tokens a second and 2.16 s for GPT-5.5 and 13.48 s for
  // Gemini 2.5 Flash Image. Seconds, not milliseconds, is what issue 264 fixed.
  assert.deepEqual(findModel("openai", "gpt-5.5")?.deployment, {
    tps: 96,
    ttft: 4.03,
  });
  assert.deepEqual(findModel("google_genai", "gemini-2.5-flash-image")?.deployment, {
    tps: null,
    ttft: 15.05,
  });
  for (const model of catalog.models) {
    const tps = model.deployment?.tps;
    if (tps != null) assert.ok(Number.isFinite(tps) && tps > 0, model.name);
  }
  // Missing throughput must enter the upstream regression instead of dividing by zero.
  const result = llmImpacts({
    provider: "google_genai",
    model_name: "gemini-2.5-flash-image",
    output_token_count: 500,
  });
  assert.ok(validateImpacts(result).ok);
  assert.ok(result.usage?.energy);
});
