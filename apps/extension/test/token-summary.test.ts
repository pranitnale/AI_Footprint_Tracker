import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyTokenFields,
  notApplicableMeasurement,
  type TokenFields,
  type TokenMeasurement,
} from "@footprint/contracts";
import {
  TokenTotals,
  outputWithOtherModels,
  partlyMeasuredText,
  tokenTotalText,
} from "../lib/token-summary";
import {
  conversationBar,
  serverResourceText,
  serverTokenFigure,
  serverTokenTotal,
} from "../lib/conversation-bar";

const counted = (
  value: string,
  profile: TokenMeasurement["profile_id"] = "o200k-base-4.0.0-reference",
  completeness: TokenMeasurement["completeness"] = "complete_for_scope",
): TokenMeasurement => ({
  value,
  evidence: "heuristic_estimate",
  scope: "observed_text",
  completeness,
  profile_id: profile,
  reason: completeness === "complete_for_scope" ? null : "partial_capture",
});
function reply(fields: Partial<TokenFields>): TokenFields {
  return { ...emptyTokenFields(), ...fields };
}
const format = (value: string) => value;

test("In adds new input text, tool results and uploaded images; Out is the output total", () => {
  const totals = new TokenTotals();
  totals.add(
    reply({
      new_input_text: counted("10"),
      tool_output: counted("200"),
      image_input_tokens: counted("1120", "vendor-image-rules-1"),
      output_total: counted("50"),
      answer_output: counted("30"),
    }),
  );
  // No tools ran and no images were uploaded: those parts do not apply and are not missing.
  totals.add(
    reply({
      new_input_text: counted("5", "cl100k-base-4.0.0-reference"),
      tool_output: notApplicableMeasurement(),
      image_input_tokens: notApplicableMeasurement(),
      output_total: counted("7", "cl100k-base-4.0.0-reference"),
    }),
  );
  const result = totals.result();
  assert.equal(result.input.value, "1335");
  assert.equal(result.input.known, 2);
  assert.equal(result.input.partial, 0);
  assert.equal(result.input.unknown, 0);
  // Another tokenizer counts the same kind of thing, so the approximate figure adds.
  assert.equal(result.output.value, "57");
  assert.equal(result.output.groups.length, 2);
  assert.equal(result.imageInput.value, "1120");
  assert.equal(result.imageInput.unknown, 0);
  assert.equal(result.toolOutput.unknown, 0);
});

const reported = (value: string): TokenMeasurement => ({
  value,
  evidence: "provider_reported",
  scope: "provider_request",
  completeness: "complete_for_scope",
  profile_id: null,
  reason: null,
});

test("Out adds the output of other models in a reply (D3), and a missing one makes it partial", () => {
  const totals = new TokenTotals();
  // A Cowork turn: the main model's exact total and a side model's exact count.
  totals.add(reply({ output_total: reported("379") }), [reported("10")]);
  // A reply whose research component could not be read.
  totals.add(reply({ output_total: counted("50") }), [
    {
      ...counted("0"),
      value: null,
      evidence: "unknown",
      reason: "tool_work_unobserved",
    },
  ]);
  const result = totals.result();
  assert.equal(result.output.value, "439");
  assert.equal(result.output.known, 2);
  assert.equal(result.output.partial, 1);
  assert.equal(result.otherModels.value, "10");
  assert.equal(result.otherModels.known, 1);
  assert.equal(result.otherModels.unknown, 1);
  assert.equal(
    tokenTotalText(result.output, format),
    "≈ 439 tokens · measured in part for 1 reply",
  );
  // Without components Out is the reply's own total, unchanged.
  const own = reported("7");
  assert.equal(outputWithOtherModels(own, []), own);
  assert.deepEqual(outputWithOtherModels(own, [reported("3")]), reported("10"));
  // An unknown own total with a known component is known in part, never zero.
  const unknownOwn = reply({}).output_total;
  const partial = outputWithOtherModels(unknownOwn, [reported("3")]);
  assert.equal(partial.value, "3");
  assert.equal(partial.completeness, "partial");
});

test("a part that was not read makes In partial and is never counted as zero", () => {
  const totals = new TokenTotals();
  // emptyTokenFields leaves tool results and images unknown, as an adapter that does not
  // read them yet does.
  totals.add(reply({ new_input_text: counted("12") }));
  totals.add(reply({}));
  const result = totals.result();
  assert.equal(result.input.value, "12");
  assert.equal(result.input.known, 1);
  assert.equal(result.input.partial, 1);
  assert.equal(result.input.unknown, 1);
  assert.equal(result.toolOutput.value, null);
  assert.equal(result.toolOutput.unknown, 2);
  assert.equal(
    tokenTotalText(result.input, format),
    "≈ 12 tokens · not measured for 1 reply · measured in part for 1 reply",
  );
  assert.equal(tokenTotalText(result.toolOutput, format), "Unknown");
  // No replies yet is unknown; replies where the field does not apply are not.
  assert.equal(
    tokenTotalText({ value: null, unknown: 0, partial: 0 }, format),
    "Unknown",
  );
  assert.equal(
    tokenTotalText(
      { value: null, unknown: 0, partial: 0, notApplicable: 2 },
      format,
    ),
    "Not applicable",
  );
});

test("Details says which parts were not read, without a bar status", () => {
  const totals = new TokenTotals();
  totals.add(
    reply({
      new_input_text: counted("12"),
      answer_output: counted("40", undefined, "partial"),
      output_total: counted("40", undefined, "partial"),
    }),
  );
  const tokens = totals.result();
  const text = partlyMeasuredText(tokens, 2, format)!;
  assert.match(text, /^Partly measured\./);
  assert.match(
    text,
    /Not read: tool results \(1 reply\), uploaded images \(1 reply\)/,
  );
  assert.match(text, /Read in part: answer text \(1 reply\)/);
  assert.match(text, /No resource estimate: 2 replies\./);
  assert.match(text, /not counted as zero/);
  const complete = new TokenTotals();
  complete.add(
    reply({
      new_input_text: counted("1"),
      tool_output: notApplicableMeasurement(),
      image_input_tokens: notApplicableMeasurement(),
      answer_output: counted("2"),
      visible_thinking: notApplicableMeasurement(),
      tool_input: notApplicableMeasurement(),
      intermediate_output: notApplicableMeasurement(),
    }),
  );
  assert.equal(partlyMeasuredText(complete.result(), 0, format), null);
  // A reply counted around unknown stream events is partly measured (owner, 2 Oct).
  assert.match(
    partlyMeasuredText(complete.result(), 0, format, 1)!,
    /^Partly measured\. Counted around stream events the tracker does not know: 1 reply\./,
  );
});

test("the bar shows In and Out with approximate markers and no extra labels", () => {
  const summary = {
    requests: 1,
    tokens: { input: { value: "1335" }, output: { value: "57" } },
    metrics: {
      energy: { value: "0.001", unknown: 0 },
      carbon: { value: "0.2", unit: "gCO2e", unknown: 0 },
      water: { value: "0.01", unit: "L", unknown: 1 },
    },
    images: { operations: 2, returned: "2" },
  };
  const result = conversationBar(summary, { failure: false });
  assert.match(
    result.text,
    /^Req 1 · In\/Out tokens - ≈ 1,335\/57 · Electricity/,
  );
  assert.doesNotMatch(result.text, /Images|image energy|Partly measured/);
  assert.equal(result.status, "Recorded");
});

test("synced figures add per-model series calculated alike and sum token fields", () => {
  const lineage = (model: string) => ({
    requested_method: { method_hash: "a".repeat(64) },
    effective_method: { method_hash: "b".repeat(64) },
    comparability: {
      unit: "kWh",
      tokenizer_profile_id: model,
      boundary: "usage",
    },
    selection: { model },
  });
  const rows = [
    {
      quantity: "energy",
      value: "0.001",
      unit: "kWh",
      unknown_count: "0",
      method_group: lineage("one"),
    },
    {
      quantity: "energy",
      value: "0.002",
      unit: "kWh",
      unknown_count: "0",
      method_group: lineage("two"),
    },
  ];
  assert.equal(serverResourceText(rows, "energy"), "≈ 3 Wh");
  const other = structuredClone(rows);
  other[1]!.method_group.effective_method.method_hash = "c".repeat(64);
  assert.equal(serverResourceText(other, "energy"), "See Details");
  assert.equal(serverResourceText([], "energy"), "Unknown");
  const tokens = [
    { quantity: "new_input_text", value: "10", unknown_count: 0 },
    { quantity: "new_input_text", value: "5", unknown_count: 1 },
    { quantity: "tool_output", value: null, unknown_count: 2 },
    { quantity: "image_input_tokens", value: "1120", unknown_count: 0 },
    { quantity: "output_total", value: "40", partial_count: 1 },
    { quantity: "answer_output", value: "30" },
  ];
  assert.equal(serverTokenTotal(tokens, "input"), "1135");
  assert.equal(serverTokenTotal(tokens, "output"), "40");
  assert.deepEqual(serverTokenFigure(tokens, "newInput", 3), {
    value: "15",
    unknown: 1,
    partial: 0,
    notApplicable: 0,
  });
  assert.deepEqual(serverTokenFigure(tokens, "toolOutput", 3), {
    value: null,
    unknown: 2,
    partial: 0,
    notApplicable: 0,
  });
  // No series for a field while replies exist: it applied to none of them.
  assert.equal(
    tokenTotalText(serverTokenFigure(tokens, "reasoning", 3), format),
    "Not applicable",
  );
  assert.equal(
    tokenTotalText(serverTokenFigure([], "reasoning", 0), format),
    "Unknown",
  );
  assert.deepEqual(serverTokenFigure(tokens, "input"), { value: "1135" });
  assert.equal(serverTokenTotal([], "input"), null);
  // Synced Out adds other models' output; an unknown one leaves Out measured in part.
  const withOthers = [
    ...tokens,
    { quantity: "other_model_output", value: "12", unknown_count: 0 },
    { quantity: "other_model_output", value: null, unknown_count: 1 },
  ];
  assert.equal(serverTokenTotal(withOthers, "output"), "52");
  assert.deepEqual(serverTokenFigure(withOthers, "output", 3), {
    value: "52",
    unknown: 0,
    partial: 2,
    notApplicable: 0,
  });
  assert.deepEqual(serverTokenFigure(withOthers, "otherModels", 3), {
    value: "12",
    unknown: 1,
    partial: 0,
    notApplicable: 0,
  });
});
