import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { pythonReference } from "../../../tools/python-reference.cjs";
import {
  claudeFactorFor,
  claudeHistoryMessage,
  claudeMeasurement,
  claudeText,
  claudeTokenCount,
  claudeTokenFields,
  composeOutputTotal,
  emptyTokenFields,
  historyPromptParts,
  historyResponseParts,
  MediaPolicySchema,
  notApplicableMeasurement,
  providerMeasurement,
  type ClaudeTokenFactor,
  type HistoryMessage,
  type Site,
  type TokenFields,
  type TokenMeasurement,
} from "../src/index";

const media = MediaPolicySchema.parse(
  JSON.parse(
    readFileSync(
      new URL("../../../config/estimation.media.json", import.meta.url),
      "utf8",
    ),
  ),
);
const factor = media.claude_token_factor!;
const counted = (value: string): TokenMeasurement => ({
  value,
  evidence: "heuristic_estimate",
  scope: "observed_text",
  completeness: "complete_for_scope",
  profile_id: "o200k-base-4.0.0-reference",
  reason: "tokenizer_mapping_unverified",
});

test("the packaged method names one Claude token factor, 1.56, with its source", () => {
  assert.deepEqual(factor, {
    factor: "1.56",
    tokenizer_profile_id: "o200k-base-4.0.0-reference",
    measured_on: "2026-10-15",
    source: "https://platform.claude.com/docs/en/build-with-claude/token-counting",
  });
});

test("a count is multiplied and rounded half up in integers", () => {
  const cases: Array<[string, string]> = [
    ["0", "0"],
    ["1", "2"], // 1.56
    ["10", "16"], // 15.6
    ["25", "39"], // 39.0
    ["100", "156"],
    ["2084", "3251"], // 3251.04
    ["9223372036854775807", "14388460377493450259"], // exact beyond floating point
  ];
  for (const [value, expected] of cases)
    assert.equal(claudeTokenCount(value, factor), expected, value);
  // An exact half rounds up.
  assert.equal(claudeTokenCount("1", { factor: "1.5" }), "2");
  assert.equal(claudeTokenCount("3", { factor: "1.5" }), "5");
});

test("only Claude text gets the factor: claude.ai and Cowork always, Perplexity by model", () => {
  const cases: Array<[Site, string | null, boolean]> = [
    ["claude", "claude-opus-5-5", true],
    ["claude", null, true],
    ["claude", "claude-unlisted", true],
    ["perplexity", "perplexity-claude-sonnet-5-5", true],
    ["perplexity", "perplexity-claude-opus-unlisted", true],
    ["perplexity", "perplexity-unlisted-anthropic", true],
    ["perplexity", "perplexity-best", false],
    ["perplexity", "perplexity-gpt-5-5", false],
    ["perplexity", null, false],
    ["chatgpt", "chatgpt-gpt-5-5", false],
    ["gemini", null, false],
    ["notebooklm", "notebooklm-default", false],
  ];
  for (const [site, model, expected] of cases) {
    assert.equal(claudeText(site, model), expected, `${site} ${model}`);
    assert.equal(
      claudeFactorFor(site, model, factor),
      expected ? factor : null,
    );
  }
});

test("counts the provider reports, image rules and unknown counts never change", () => {
  const reported = providerMeasurement("433");
  assert.equal(claudeMeasurement(reported, factor), reported);
  const image: TokenMeasurement = {
    ...counted("1600"),
    profile_id: "vendor-image-rules-1",
  };
  assert.equal(claudeMeasurement(image, factor), image);
  const unknown = emptyTokenFields().answer_output;
  assert.equal(claudeMeasurement(unknown, factor), unknown);
  assert.equal(claudeMeasurement(counted("10"), null).value, "10");
});

function reply(parts: Partial<Record<keyof TokenFields, TokenMeasurement>>) {
  const tokens = { ...emptyTokenFields(), ...parts } as TokenFields;
  tokens.output_total = composeOutputTotal(tokens);
  return tokens;
}

test("a corrected total is the sum of its corrected parts", () => {
  const tokens = reply({
    new_input_text: counted("9"),
    answer_output: counted("10"),
    visible_thinking: counted("3"),
    tool_input: counted("1"),
    intermediate_output: notApplicableMeasurement(),
  });
  const corrected = claudeTokenFields(tokens, factor);
  assert.equal(corrected.new_input_text.value, "14");
  assert.deepEqual(
    [
      corrected.answer_output.value,
      corrected.visible_thinking.value,
      corrected.tool_input.value,
    ],
    ["16", "5", "2"],
  );
  // 16 + 5 + 2, not round(1.56 x 14) = 22.
  assert.equal(corrected.output_total.value, "23");
  assert.deepEqual(corrected.output_total, composeOutputTotal(corrected));
  // Cowork: the provider's own output total stays; prompt text counted here is corrected.
  const cowork = {
    ...tokens,
    output_total: providerMeasurement("433"),
  };
  const coworkCorrected = claudeTokenFields(cowork, factor);
  assert.equal(coworkCorrected.output_total.value, "433");
  assert.equal(coworkCorrected.new_input_text.value, "14");
  assert.equal(claudeTokenFields(tokens, null), tokens);
});

function saved(
  overrides: Partial<HistoryMessage> & Pick<HistoryMessage, "role">,
): HistoryMessage {
  const parts =
    overrides.role === "response"
      ? historyResponseParts(counted("10"), {
          visible_thinking: counted("3"),
          tool_output: counted("7"),
        })
      : historyPromptParts(notApplicableMeasurement());
  return {
    site: "claude",
    model_id: "claude-opus-5-5",
    tokens: overrides.role === "response" ? composeOutputTotal(parts) : counted("9"),
    parts,
    generation: {
      text_components: [],
      media: [],
      coverage_reasons: [],
    },
    inline_file_text: null,
    ...overrides,
  } as unknown as HistoryMessage;
}

test("a saved reply's total is the sum of its corrected parts; a saved prompt is corrected itself", () => {
  const response = claudeHistoryMessage(saved({ role: "response" }), factor);
  assert.equal(response.parts!.answer_output.value, "16");
  assert.equal(response.parts!.visible_thinking.value, "5");
  assert.equal(response.parts!.tool_output.value, "11");
  assert.equal(response.tokens.value, "21");
  const prompt = claudeHistoryMessage(saved({ role: "prompt" }), factor);
  assert.equal(prompt.tokens.value, "14");
  // ChatGPT and a Perplexity reply by another model keep their counts.
  for (const [site, model] of [
    ["chatgpt", "chatgpt-gpt-5-5"],
    ["perplexity", "perplexity-best"],
  ] as const) {
    const other = saved({ role: "response", site, model_id: model });
    assert.deepEqual(claudeHistoryMessage(other, factor), other);
  }
  // Cowork saves Claude's own output total; it stays as reported.
  const cowork = saved({ role: "response", tokens: providerMeasurement("433") });
  assert.equal(claudeHistoryMessage(cowork, factor).tokens.value, "433");
});

test("the server mirrors the factor rules exactly", () => {
  const tokens = reply({
    new_input_text: counted("9"),
    answer_output: counted("10"),
    visible_thinking: counted("3"),
    tool_input: counted("1"),
  });
  const cases = {
    counts: ["0", "1", "10", "25", "2084", "9223372036854775807"],
    sites: [
      ["claude", null],
      ["perplexity", "perplexity-claude-sonnet-5-5"],
      ["perplexity", "perplexity-best"],
      ["chatgpt", "chatgpt-gpt-5-5"],
    ],
    tokens,
    cowork: { ...tokens, output_total: providerMeasurement("433") },
    messages: [
      saved({ role: "response" }),
      saved({ role: "prompt" }),
      saved({ role: "response", site: "perplexity", model_id: "perplexity-best" }),
      saved({ role: "response", tokens: providerMeasurement("433") }),
    ],
    factor,
  };
  const code = [
    "import json,sys",
    "from footprint_contracts import claude_token_count, claude_factor_for, claude_token_fields, claude_history_message",
    "c=json.load(sys.stdin); f=c['factor']",
    "print(json.dumps({",
    "  'counts':[claude_token_count(v,f) for v in c['counts']],",
    "  'sites':[claude_factor_for(s,m,f) is not None for s,m in c['sites']],",
    "  'tokens':claude_token_fields(c['tokens'],f),",
    "  'cowork':claude_token_fields(c['cowork'],f),",
    "  'messages':[claude_history_message(m,f) for m in c['messages']],",
    "}))",
  ].join("\n");
  const run = pythonReference(["-c", code], { input: JSON.stringify(cases) });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), {
    counts: cases.counts.map((value) => claudeTokenCount(value, factor)),
    sites: cases.sites.map(
      ([site, model]) => claudeFactorFor(site as Site, model, factor) !== null,
    ),
    tokens: claudeTokenFields(tokens, factor),
    cowork: claudeTokenFields(cases.cowork, factor),
    messages: cases.messages.map((message) =>
      claudeHistoryMessage(message, factor as ClaudeTokenFactor),
    ),
  });
});
