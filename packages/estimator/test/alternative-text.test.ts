import assert from "node:assert/strict";
import test from "node:test";
import * as core from "@footprint/ecologits-core";
import configuration from "../../../config/estimation.build.json";
import mappings from "../../../config/estimation.mappings.json";
import media from "../../../config/estimation.media.json";
import { createMethodRegistry, LocalEstimateExecutor } from "../src/index";
import { emptyInputs } from "../src/engines/components";

const executor = new LocalEstimateExecutor(
  createMethodRegistry(configuration, mappings, media),
);
const reply = (tokens: string | null) => ({
  component_id: "text_0",
  role: "main" as const,
  inputs: { ...emptyInputs(), output_tokens: tokens },
  metrics: { energy: { scope: "modeled_text_component" as const } },
});
const kwh = (value: string | null | undefined) => Number(value);

test("a smaller record gives less electricity for the same output tokens", async () => {
  const large = await executor.alternativeText(reply("1200") as never, {
    provider: "openai",
    model_name: "gpt-5.6-sol",
  });
  const small = await executor.alternativeText(reply("1200") as never, {
    provider: "openai",
    model_name: "gpt-6-luna",
  });
  assert.equal(large.status, "estimated");
  assert.equal(small.status, "estimated");
  assert.equal(small.inputs.output_tokens, "1200");
  // Both use the record's modelled latency, so only the record differs.
  assert.equal(large.inputs.latency_seconds, null);
  for (const key of ["scenario_low", "value", "scenario_high"] as const)
    assert.ok(kwh(small.metrics.energy[key]) < kwh(large.metrics.energy[key]), key);
});

test("the alternative matches EcoLogits for that record, tokens and modelled latency", async () => {
  const result = await executor.alternativeText(reply("800") as never, {
    provider: "anthropic",
    model_name: "claude-haiku-4-5",
  });
  const direct = core.llmImpacts({
    provider: "anthropic",
    model_name: "claude-haiku-4-5",
    output_token_count: 800,
    request_latency: null,
  });
  const energy = direct.usage!.energy.value;
  const [low, high] =
    typeof energy === "number" ? [energy, energy] : [energy.min, energy.max];
  assert.ok(Math.abs(kwh(result.metrics.energy.scenario_low ?? result.metrics.energy.value) - low) < 1e-12);
  assert.ok(Math.abs(kwh(result.metrics.energy.scenario_high ?? result.metrics.energy.value) - high) < 1e-12);
});

test("no output tokens or an unknown record give no figure rather than zero", async () => {
  const empty = await executor.alternativeText(reply(null) as never, {
    provider: "openai",
    model_name: "gpt-6-luna",
  });
  assert.equal(empty.status, "unavailable");
  assert.equal(empty.metrics.energy.value, null);
  const unknown = await executor.alternativeText(reply("10") as never, {
    provider: "openai",
    model_name: "no-such-record",
  });
  assert.equal(unknown.status, "unavailable");
});
