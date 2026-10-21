import assert from "node:assert/strict";
import test from "node:test";
import { emptyGeneration, type HistoryMessage } from "@footprint/contracts";
import { records } from "../../../packages/ledger/test/factory";
import { HistoryBreakdown } from "../lib/usage-breakdown";

// Saved prompts often name no model while their replies do. Until 14 October 2026 the model split
// of saved history counted each message under its own model id, so a model with saved replies had
// fewer saved requests than replies and its figures per request on the Models page were inflated.
const tokens = records()[1].tokens.answer_output;
function message(
  key: string,
  role: "prompt" | "response",
  model: string | null,
  changes: Partial<HistoryMessage> = {},
): HistoryMessage {
  return {
    schema_version: "3.0.0",
    kind: "history_message",
    message_key: key.repeat(64),
    role,
    conversation_key: "c".repeat(64),
    key_version: "1",
    site: "chatgpt",
    parent_key: null,
    prompt_key: null,
    provider_request_key: null,
    provider_attempt_key: null,
    occurred_at: "2026-10-13T10:00:00.000Z",
    date_basis: "message_created",
    observed_at: "2026-10-14T10:00:00.000Z",
    proposed_method_id: "ecologits-0.11.2",
    proposed_method_hash: "f".repeat(64),
    model_id: model,
    tokens,
    parts: null,
    generation: emptyGeneration(),
    inline_file_text: null,
    timing: null,
    text_complete: true,
    coverage_reasons: ["history_only"],
    company_dedup_key: null,
    ...changes,
  } as HistoryMessage;
}
const reply = (
  key: string,
  prompt: string,
  model: string | null,
  at = "2026-10-13T10:00:01.000Z",
) =>
  message(key, "response", model, {
    prompt_key: prompt.repeat(64),
    parent_key: prompt.repeat(64),
    occurred_at: at,
  });

function split(rows: HistoryMessage[]) {
  const breakdown = new HistoryBreakdown({ timezone: "UTC", bucket: "day" });
  breakdown.reset();
  for (const row of rows) breakdown.add(row, row, { estimate: [] });
  return breakdown;
}

test("a saved prompt without a model counts for the model of its reply", () => {
  const rows = [
    // Prompts are read before their replies, as the history service hands them over.
    message("1", "prompt", null),
    message("2", "prompt", "gpt-5"),
    message("3", "prompt", null),
    message("4", "prompt", null),
    reply("5", "1", "gpt-5"),
    reply("6", "2", "gpt-5"),
    // A prompt answered again with another model counts once, for its first reply.
    reply("8", "3", "gpt-5", "2026-10-13T10:00:09.000Z"),
    reply("7", "3", "o3", "2026-10-13T10:00:02.000Z"),
    // A reply that names no model leaves its prompt out of every model, as before.
    reply("9", "4", null),
  ];
  const breakdown = split(rows);
  const result = breakdown.result()!;
  assert.equal(result.models["gpt-5"]!.prompt_count, "2");
  assert.equal(result.models["gpt-5"]!.response_count, "3");
  assert.equal(result.models["o3"]!.prompt_count, "1");
  assert.equal(result.models["o3"]!.response_count, "1");
  // Every prompt still counts once in the totals by tool and day.
  assert.equal(result.sites["chatgpt"]!.prompt_count, "4");
  assert.equal(result.buckets["2026-10-13"]!.prompt_count, "4");
  // Reading the result again adds nothing twice; a new scan starts empty.
  assert.equal(breakdown.result()!.models["gpt-5"]!.prompt_count, "2");
  breakdown.reset();
  for (const row of rows) breakdown.add(row, row, { estimate: [] });
  assert.equal(breakdown.result()!.models["gpt-5"]!.prompt_count, "2");
});

test("undated replies come after dated ones and the lower message key breaks a tie", () => {
  const rows = [
    message("1", "prompt", null),
    reply("2", "1", "o3", null as never),
    reply("4", "1", "gpt-5", "2026-10-13T10:00:05.000Z"),
    reply("3", "1", "gpt-4o", "2026-10-13T10:00:05.000Z"),
  ];
  assert.equal(split(rows).result()!.models["gpt-4o"]!.prompt_count, "1");
  assert.equal(split(rows).result()!.models["gpt-5"]!.prompt_count, "0");
  assert.equal(split(rows).result()!.models["o3"]!.prompt_count, "0");
});
