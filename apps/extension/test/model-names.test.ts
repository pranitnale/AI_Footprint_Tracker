import assert from "node:assert/strict";
import test from "node:test";
import { labelName, modelName, recordName } from "../lib/ui/model-names";

test("a family's unlisted id reads as the family with an unlisted version", () => {
  assert.equal(modelName("claude-haiku-unlisted"), "Claude Haiku, version not yet listed");
  assert.equal(modelName("chatgpt-gpt-sol-unlisted"), "GPT Sol, version not yet listed");
  assert.equal(modelName("gemini-flash-lite-unlisted"), "Gemini Flash-Lite, version not yet listed");
  assert.equal(
    modelName("perplexity-claude-opus-unlisted"),
    "Claude Opus on Perplexity, version not yet listed",
  );
  // Ids without a family keep their own names.
  assert.equal(modelName("claude-unlisted"), "Claude model not yet listed");
  assert.equal(modelName("perplexity-unlisted-google"), "Gemini model on Perplexity, not yet listed");
  assert.equal(modelName("claude-haiku-4-5"), "Claude Haiku 4.5");
});

test("a variant's unlisted id reads as the variant with an unlisted version", () => {
  // Owner decision of 14 October 2026: unknown variants have ids of their own.
  assert.equal(modelName("chatgpt-gpt-pro-unlisted"), "GPT Pro, version not yet listed");
  assert.equal(modelName("perplexity-gpt-mini-unlisted"), "GPT mini on Perplexity, version not yet listed");
  assert.equal(modelName("gemini-pro-image-unlisted"), "Gemini Pro Image, version not yet listed");
  assert.equal(modelName("claude-small-unlisted"), "Claude mini, nano or lite model, not yet listed");
  assert.equal(modelName("perplexity-gemini-image-unlisted"), "Gemini image model on Perplexity, not yet listed");
});

test("a Pro of a GPT family reads as that family model with Pro reasoning", () => {
  // Owner correction of 14 October 2026: gpt-6-sol-pro is GPT-6 Sol with reasoning.mode pro,
  // and OpenAI's help page says GPT-6 Pro in ChatGPT is GPT-6 Astra with the Pro option.
  assert.equal(modelName("chatgpt-gpt-6-sol-pro"), "GPT-6 Sol (Pro reasoning)");
  assert.equal(modelName("chatgpt-gpt-6-pro"), "GPT-6 Astra (Pro reasoning)");
  assert.equal(modelName("chatgpt-gpt-5-6-sol-pro"), "GPT-5.6 Sol (Pro reasoning)");
  assert.equal(modelName("perplexity-gpt-6-astra-pro"), "GPT-6 Astra (Pro reasoning)");
  assert.equal(modelName("chatgpt-gpt-sol-pro-unlisted"), "GPT Sol (Pro reasoning), version not yet listed");
  assert.equal(
    modelName("perplexity-gpt-luna-pro-unlisted"),
    "GPT Luna (Pro reasoning) on Perplexity, version not yet listed",
  );
  // A Pro model without a family name is a model of its own.
  assert.equal(modelName("chatgpt-gpt-5-5-pro"), "GPT-5.5 Pro");
});

test("o3-pro reads as o3 with Pro reasoning and Nano Banana Pro names Gemini 3 Pro Image", () => {
  // Owner decisions of 14 October 2026.
  assert.equal(modelName("chatgpt-o3-pro"), "o3 (Pro reasoning)");
  assert.equal(modelName("perplexity-o3-pro"), "o3 (Pro reasoning)");
  assert.equal(modelName("gemini-nano-banana-pro"), "Nano Banana Pro (Gemini 3 Pro Image)");
  assert.equal(modelName("perplexity-nano-banana-pro"), "Nano Banana Pro (Gemini 3 Pro Image)");
  assert.equal(modelName("chatgpt-o3"), "o3");
});

test("records read by name and reasoning settings in labels read as settings", () => {
  assert.equal(recordName("openai/gpt-6.1-sol"), "GPT-6.1 Sol");
  assert.equal(recordName("anthropic/claude-haiku-4-5"), "Claude Haiku 4.5");
  assert.equal(recordName("google_genai/gemini-3-flash-preview"), "Gemini 3 Flash Preview");
  // Owner decision of 14 October 2026: a reasoning word is a setting, not a model.
  assert.equal(labelName("claude-haiku-6-thinking"), "Claude Haiku 6 (Thinking)");
  assert.equal(labelName("claude-haiku-6-thinking-20261001"), "Claude Haiku 6 (Thinking)");
  assert.equal(labelName("gpt-6-2-luna-auto-thinking"), "GPT-6.2 Luna (Auto thinking)");
  assert.equal(labelName("gpt-6.2-sol-thinking-wm"), "GPT-6.2 Sol (Thinking)");
  assert.equal(labelName("3.9 Flash Thinking"), "3.9 Flash (Thinking)");
  // Labels without a setting, and compact ids that cannot be split, stay as the site wrote them.
  assert.equal(labelName("claude-nova-9"), "claude-nova-9");
  assert.equal(labelName("claude55haikuthinking"), "claude55haikuthinking");
  assert.equal(labelName("gpt7_astra_fast"), "gpt7_astra_fast");
});
