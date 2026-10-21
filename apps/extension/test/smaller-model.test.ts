import { archivedEstimation } from "./archived-engine-fixture";
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
// The EcoLogits core directly, as an independent reference for the comparison.
import * as core from "../../../packages/ecologits-core/src/index";
import type { ComponentResult, EstimationEnvelope } from "@footprint/contracts";
import { Ledger } from "@footprint/ledger";
import { ClaudeSession, initialSnapshot, parseHistoryText, type HistoryTextPage } from "@footprint/adapters";
import { Coordinator } from "../lib/coordinator";
import { HISTORY_CAPTURE_CHANNEL } from "../lib/history-capture";
import { readComparison, smallerModelCard } from "../lib/details-overview";
import { readSmallerModel, smallerModelChange, type SmallerModel } from "../lib/smaller-model";
import { countByTextLength } from "./counting-fixture";
import { formatMetric } from "@footprint/ui/formatters";

const executor = archivedEstimation.executor;
const alternative = (component: ComponentResult, profile: { provider: string; model_name: string }) =>
  executor.alternativeText(component, profile);

type Counted = { value: string; scenario_low?: string; scenario_high?: string };

/** A reply envelope with one main text component; only the fields the comparison reads. */
function reply(provider: string, model: string, tokens: string, status: "estimated" | "unavailable" = "estimated", counted: Counted = { value: "1" }) {
  return {
    components: [
      {
        component_id: "text_0",
        kind: "text",
        role: "main",
        status,
        selection: { kind: "direct_mapping", observed_model_id: null, profile: { provider, model_name: model, workload: "text" }, reason: null, basis: "exact_record" },
        inputs: { output_tokens: tokens },
        metrics: { energy: { scope: "modeled_text_component", ...(status === "estimated" ? counted : { value: null }) } },
      },
      // Side calls and other parts are left as they are.
      { component_id: "text_1", kind: "text", role: "side_call", status: "estimated", selection: null, inputs: { output_tokens: "50" }, metrics: { energy: { scope: "modeled_text_component", value: "1" } } },
    ],
  } as unknown as EstimationEnvelope;
}

const endpoints = (provider: string, model: string, tokens: number, latency: number | null = null) => {
  const energy = core.llmImpacts({ provider, model_name: model, output_token_count: tokens, request_latency: latency }).usage!.energy.value;
  return typeof energy === "number" ? { low: energy, high: energy } : { low: energy.min, high: energy.max };
};

/** The counted figure of a reply as the ledger stores it, in kWh. */
const counted = ({ low, high }: { low: number; high: number }): Counted => ({ value: String((low + high) / 2), scenario_low: String(low), scenario_high: String(high) });

test("the change is the smaller record minus the actual record, per reply, in Wh", async () => {
  const change = await smallerModelChange(
    [reply("anthropic", "claude-opus-5-5", "1000", "estimated", counted(endpoints("anthropic", "claude-opus-5-5", 1000))), reply("openai", "gpt-5.6-sol", "400", "estimated", counted(endpoints("openai", "gpt-5.6-sol", 400)))],
    alternative,
  );
  assert.ok(change);
  const expected = { low: 0, high: 0 };
  for (const [provider, actual, small, tokens] of [
    ["anthropic", "claude-opus-5-5", "claude-haiku-4-5", 1000],
    ["openai", "gpt-5.6-sol", "gpt-6-luna", 400],
  ] as const) {
    const a = endpoints(provider, actual, tokens),
      s = endpoints(provider, small, tokens);
    expected.low += (s.low - a.low) * 1000;
    expected.high += (s.high - a.high) * 1000;
  }
  assert.ok(Math.abs(change.minimum - expected.low) < 1e-9);
  assert.ok(Math.abs(change.maximum - expected.high) < 1e-9);
  assert.ok(Math.abs(change.midpoint - (expected.low + expected.high) / 2) < 1e-9);
  assert.deepEqual(change.records, ["claude-haiku-4-5", "gpt-6-luna"]);
  assert.equal(change.replies, 2);
  assert.equal(change.unchanged, 0);
});

test("replies already on a small record keep their figure, and nothing to shrink shows no card", async () => {
  assert.equal(await smallerModelChange([reply("anthropic", "claude-haiku-4-5", "900")], alternative), null);
  // gpt-5-nano is smaller than gpt-6-luna, so the comparison would grow and is left out.
  assert.equal(await smallerModelChange([reply("openai", "gpt-5-nano", "900")], alternative), null);
  const mixed = await smallerModelChange(
    [reply("anthropic", "claude-haiku-4-5", "900"), reply("anthropic", "claude-sonnet-5-5", "900"), reply("mistralai", "mistral-small-latest", "10"), reply("openai", "gpt-6.1-sol", "5", "unavailable")],
    alternative,
  );
  assert.ok(mixed);
  assert.equal(mixed.replies, 2);
  // Mistral has no smaller record chosen; an unknown figure is not compared at all.
  assert.equal(mixed.unchanged, 1);
  assert.deepEqual(mixed.records, ["claude-haiku-4-5"]);
  assert.equal(await smallerModelChange([], alternative), null);
});

test("the card adds the change to the figure Details shows, at the chosen scenario", () => {
  const smaller: SmallerModel = { minimum: -2, midpoint: -6, maximum: -10, records: ["claude-haiku-4-5"], replies: 3, unchanged: 1 };
  const energy = { value: "0.009", unit: "kWh", value_kind: "midpoint_sum", scenario_low: "0.003", scenario_high: "0.015" };
  const card = smallerModelCard({ energy, scenario: "midpoint" }, smaller)!;
  assert.equal(card.thisChat, "9 Wh");
  assert.equal(card.smaller, "≈ 3 Wh");
  assert.ok(Math.abs(card.share - 3 / 9) < 1e-12);
  assert.match(card.note, /^Compared with Claude Haiku 4\.5\. Assumes the same answer length/);
  assert.match(card.note, /1 reply keeps its own figure\.$/);
  assert.equal(smallerModelCard({ energy, scenario: "minimum" }, smaller)!.smaller, "≈ 1 Wh");
  assert.equal(smallerModelCard({ energy, scenario: "maximum" }, smaller)!.smaller, "≈ 5 Wh");
  // A change larger than the shown figure says so instead of showing zero.
  const larger = smallerModelCard({ energy, scenario: "minimum" }, { ...smaller, minimum: -4 })!;
  assert.equal(larger.smaller, "Not available");
  assert.equal(larger.share, 0);
  // No card without a figure or a change.
  assert.equal(smallerModelCard({ energy: { value: null, unit: "kWh" }, scenario: "midpoint" }, smaller), null);
  assert.equal(smallerModelCard({ energy, scenario: "midpoint" }, null), null);
});

test("a reply faster than modelled shows the smaller record's own figure, not zero", async () => {
  // Seen live on 13 October 2026: Claude Opus 5.5, 128 tokens out, counted with a measured
  // latency shorter than the modelled one. The old modelled difference exceeded the counted
  // minimum, so the card showed "≈ 0 kWh" at Minimum and about 0.9 mWh at Midpoint.
  const haiku = endpoints("anthropic", "claude-haiku-4-5", 128);
  const shown = (kwh: number) => formatMetric(kwh, "kWh");
  for (const latency of [3, 5]) {
    const own = counted(endpoints("anthropic", "claude-opus-5-5", 128, latency));
    const change = await smallerModelChange([reply("anthropic", "claude-opus-5-5", "128", "estimated", own)], alternative);
    assert.ok(change);
    const energy = { ...own, unit: "kWh", value_kind: "midpoint" };
    assert.equal(smallerModelCard({ energy, scenario: "minimum" }, change)!.smaller, shown(haiku.low), `${latency} s`);
    assert.equal(smallerModelCard({ energy, scenario: "midpoint" }, change)!.smaller, shown((haiku.low + haiku.high) / 2), `${latency} s`);
    assert.equal(smallerModelCard({ energy, scenario: "maximum" }, change)!.smaller, shown(haiku.high), `${latency} s`);
    assert.match(smallerModelCard({ energy, scenario: "minimum" }, change)!.smaller, /^≈ \d+(\.\d+)? mWh$/);
  }
});

test("a malformed smaller-model reply is dropped without losing the comparison", () => {
  const good = { minimum: -1, midpoint: -2, maximum: -3, records: ["gpt-6-luna"], replies: 2, unchanged: 0 };
  assert.deepEqual(readSmallerModel(good), good);
  for (const bad of [
    { ...good, midpoint: 2 },
    { ...good, records: ["gpt-5.6-sol"] },
    { ...good, records: [] },
    { ...good, replies: 0 },
    { ...good, minimum: Number.NaN },
    "x",
  ])
    assert.equal(readSmallerModel(bad), null, JSON.stringify(bad));
  const comparison = { chats: 1, thisChat: 2, smallerShare: null, averageWh: 2, todayShare: null, bins: [1], thisBin: 0 };
  assert.equal(readComparison({ ...comparison, smallerModel: { bad: true } })!.smallerModel, null);
  assert.deepEqual(readComparison({ ...comparison, smallerModel: good })!.smallerModel, good);
});

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const conversation = uuid(901);
const sender = { tab: { id: 82 }, frameId: 0, documentId: "synthetic-smaller", url: `https://claude.ai/chat/${conversation}` };

function history(pairs: number): HistoryTextPage {
  const chat_messages = [];
  for (let index = 0; index < pairs * 2; index++) {
    const assistant = index % 2 === 1;
    chat_messages.push({
      uuid: uuid(index + 1),
      sender: assistant ? "assistant" : "human",
      index,
      parent_message_uuid: index === 0 ? uuid(0) : uuid(index),
      truncated: false,
      created_at: "2020-01-01T12:00:00.000000Z",
      stop_reason: assistant ? "end_turn" : null,
      content: [{ type: "text", text: assistant ? "a longer answer ".repeat(20 * index) : "query" }],
    });
  }
  return parseHistoryText("claude", { uuid: conversation, current_leaf_message_uuid: uuid(pairs * 2), chat_messages }, conversation, new Date().toISOString());
}

/** One live Claude reply after the saved ones, captured as the page streams it. */
async function live(c: Coordinator) {
  const common = { channel: "ai-footprint-observation-v1", version: 1, id: crypto.randomUUID(), site: "claude", at: new Date().toISOString(), failure: null };
  await c.capture(
    { ...common, event: "dispatch", revision: 1, timing: null, dispatch: { site: "claude", action: "send", input: "query", conversationId: conversation, parentId: uuid(6), requestId: uuid(700), model: "claude-opus-4-8", attachments: null, imageEditParentId: null }, snapshot: initialSnapshot() },
    sender,
  );
  const session = new ClaudeSession();
  const frame = (value: unknown) => session.frame({ value } as Parameters<ClaudeSession["frame"]>[0]);
  frame({ type: "message_start", message: { id: "msg_smaller_live", uuid: uuid(8), parent_uuid: uuid(7), model: "claude-opus-4-8" } });
  frame({ type: "content_block_start", index: 0, content_block: { type: "text", text: "a live answer ".repeat(40) } });
  frame({ type: "message_delta", delta: { stop_reason: "end_turn" } });
  frame({ type: "message_stop" });
  await c.capture(
    { ...common, event: "end", revision: 2, dispatch: null, snapshot: session.snapshot(), timing: { duration_seconds: "5", source: "browser_request", scope: "request", completeness: "complete_for_scope", profile_version: "timing-observation-1" } },
    sender,
  );
}

test("a saved Claude chat gets the smaller-model change in its comparison reply", async () => {
  const db = await Ledger.open(`smaller-${crypto.randomUUID()}`);
  const c = new Coordinator(db, {
    estimation: archivedEstimation,
    count: countByTextLength,
    hasConsent: async () => true,
    hasSiteConsent: async () => true,
    sendDisplay: async () => {},
    transport: async () => {
      throw new TypeError("synthetic offline");
    },
  });
  try {
    await c.whenReady();
    await c.engines.admission();
    const current = await db.estimation.readPreference();
    if (current?.preference !== "ecologits") await c.engines.select({ preference: "ecologits", expectedRevision: current?.selection_revision ?? null });
    const page = history(3);
    const binding = { documentNonce: crypto.randomUUID(), navigationNonce: crypto.randomUUID(), captureId: null };
    const common = { channel: HISTORY_CAPTURE_CHANNEL as typeof HISTORY_CAPTURE_CHANNEL, id: crypto.randomUUID(), site: page.site, conversationId: page.conversationId, observedAt: page.observedAt };
    await c.history.receive({ ...common, event: "start", page: null }, binding, sender);
    await c.history.receive({ ...common, event: "page", page }, binding, sender);
    await live(c);
    for (let i = 0; i < 20; i++) {
      await c.engines.maintainLocal();
      const state = await c.engines.status();
      if (state.local.status === "complete" && state.local.pending === 0) break;
    }
    const result = await c.chatComparison("claude", conversation);
    const smaller = result.smallerModel;
    assert.ok(smaller, "a chat on the Claude flagship stand-in can shrink");
    // Claude names no model in this history, so each reply uses the provider stand-in.
    assert.deepEqual(smaller.records, ["claude-haiku-4-5"]);
    // Three saved replies and one live reply.
    assert.equal(smaller.replies, 4);
    assert.equal(smaller.unchanged, 0);
    assert.ok(smaller.minimum < 0 && smaller.midpoint < 0 && smaller.maximum < 0);
    assert.ok(smaller.minimum >= smaller.maximum);
    // The background reply passes the content script's check unchanged.
    assert.deepEqual(readComparison(JSON.parse(JSON.stringify(result)))!.smallerModel, smaller);
  } finally {
    c.engines.dispose();
    db.close();
  }
});

test("a reply from the smallest family of any version is not compared", async () => {
  // Owner, 13 Oct 2026: Haiku, Luna and Flash are the smallest families; comparing Claude Haiku 5.5
  // (unlisted, so estimated with a stand-in record) with Haiku 4.5 suggested a saving that does not exist.
  const observed = (envelope: EstimationEnvelope, id: string) => {
    (envelope.components[0] as any).selection.observed_model_id = id;
    return envelope;
  };
  const standIn = counted(endpoints("anthropic", "claude-sonnet-4-6", 1000));
  for (const [provider, record, id] of [
    ["anthropic", "claude-sonnet-4-6", "claude-haiku-5-5"],
    ["openai", "gpt-5.6-sol", "gpt-6.1-luna"],
    ["google_genai", "gemini-3.1-pro-preview", "gemini-4-flash"],
    ["openai", "gpt-5.6-sol", "claude-haiku-4-5"],
  ] as const)
    assert.equal(await smallerModelChange([observed(reply(provider, record, "1000", "estimated", standIn), id)], alternative), null, id);
  // A chat that mixes a smallest-family reply with a larger one compares only the larger one.
  const mixed = await smallerModelChange(
    [
      observed(reply("anthropic", "claude-sonnet-4-6", "1000", "estimated", standIn), "claude-haiku-5-5"),
      reply("anthropic", "claude-opus-5-5", "1000", "estimated", counted(endpoints("anthropic", "claude-opus-5-5", 1000))),
    ],
    alternative,
  );
  assert.ok(mixed);
  assert.equal(mixed.replies, 2);
  assert.deepEqual(mixed.records, ["claude-haiku-4-5"]);
});

test("a family's unlisted id of the smallest families is not compared, whatever record stands in", async () => {
  // Owner, 13 Oct 2026: an unknown Haiku 5.5 becomes claude-haiku-unlisted and uses the newest Haiku
  // record. The observed id alone must hide the comparison, also if a larger record stood in.
  const observed = (envelope: EstimationEnvelope, id: string) => {
    (envelope.components[0] as any).selection.observed_model_id = id;
    return envelope;
  };
  const sonnet = counted(endpoints("anthropic", "claude-sonnet-4-6", 1000));
  for (const id of [
    "claude-haiku-unlisted",
    "perplexity-claude-haiku-unlisted",
    "chatgpt-gpt-luna-unlisted",
    "perplexity-gpt-luna-unlisted",
    "gemini-flash-unlisted",
    "gemini-flash-lite-unlisted",
    "perplexity-gemini-flash-lite-unlisted",
  ])
    assert.equal(await smallerModelChange([observed(reply("anthropic", "claude-sonnet-4-6", "1000", "estimated", sonnet), id)], alternative), null, id);
  const haiku = counted(endpoints("anthropic", "claude-haiku-4-5", 1000));
  assert.equal(await smallerModelChange([observed(reply("anthropic", "claude-haiku-4-5", "1000", "estimated", haiku), "claude-haiku-unlisted")], alternative), null);
  // A larger family's unlisted id is still compared.
  const opus = await smallerModelChange(
    [observed(reply("anthropic", "claude-opus-5-5", "1000", "estimated", counted(endpoints("anthropic", "claude-opus-5-5", 1000))), "claude-opus-unlisted")],
    alternative,
  );
  assert.ok(opus);
  assert.deepEqual(opus.records, ["claude-haiku-4-5"]);
});
