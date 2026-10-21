// How each model is estimated on the "Tools and models" page. Live QA of 19 October 2026: every
// model read "Not estimated", because the page looked for the record selection on the figure
// groups, which never carry it.
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { validatedBreakdown } from "../lib/dashboard/summary-validators";
import type { UsageBreakdownView } from "../lib/dashboard/types";
import { NOT_ESTIMATED_DETAIL, estimationKind } from "../lib/dash/model-estimation";
import { partKeys } from "../lib/ui/figure-math";
import { largeProfile } from "./perf/large-profile";

test("every estimated model of a real scan says how it is estimated", async () => {
  const profile = await largeProfile({
    size: { chats: 8, requests: 30, historyChats: 8, historyTurns: 2, days: 20, erasedRequests: 0, erasedDay: false },
    mode: "personal",
    seed: 606,
    now: new Date("2026-10-12T10:30:00.000Z"),
  });
  try {
    const view = validatedBreakdown(await profile.coordinator.usageBreakdown({ bucket: "day", timezone: "UTC" }));
    assert.equal(view.calculation.view, "recalculated", "the packaged build estimates with EcoLogits");
    const saved = (id: string) =>
      (view.history?.models[id]?.resources ?? []).some((r) => r.quantity === "energy" && Number(r.known_message_count) > 0);
    const estimated = partKeys(view, "models").filter((id) => (view.models[id]?.metrics.energy.known ?? 0) > 0 || saved(id));
    assert.ok(estimated.length >= 3, "the profile must have estimated models, or the check proves nothing");
    assert.ok(estimated.some(saved), "some model must have saved figures, so the saved side is checked too");
    const kinds = estimated.map((id) => {
      // The groups do not carry the record selection; the model's tally and saved figures do.
      assert.ok((view.models[id]?.metrics.energy.groups ?? []).every((g) => g.profile_selection === undefined));
      return estimationKind(view, id);
    });
    assert.deepEqual(
      kinds.filter((k) => !["own", "similar", "family"].includes(k.tone)),
      [],
      "an estimated model always names its kind",
    );
    // The profile's models all have a direct mapping in the packaged build.
    assert.ok(kinds.some((k) => k.label === "Own record"));
  } finally {
    profile.close();
  }
});

/** A breakdown view with only what estimationKind reads. */
function viewOf(
  live: Record<string, Array<{ kind: string; basis: string | null; record: string | null; replies: number }>>,
  saved: Record<string, Array<{ kind: string; record: string | null; known: number }>> = {},
) {
  return {
    models: Object.fromEntries(Object.entries(live).map(([id, selections]) => [id, { selections }])),
    history: {
      models: Object.fromEntries(
        Object.entries(saved).map(([id, rows]) => [
          id,
          {
            resources: rows.map((row) => ({
              quantity: "energy",
              profile_selection: row.kind,
              selected_profile_id: row.record,
              known_message_count: String(row.known),
              unknown_message_count: "0",
            })),
          },
        ]),
      ),
    },
  } as unknown as UsageBreakdownView;
}

test("the kind follows how each reply's model was matched to a record", () => {
  const own = { kind: "direct_mapping", basis: "exact_record", record: "anthropic/claude-opus-5-5", replies: 4 };
  const nearest = { kind: "model_override", basis: "nearest_record", record: "openai/gpt-6-astra", replies: 2 };
  const unnamed = { kind: "model_override", basis: "model_not_named", record: "openai/gpt-6.1-sol", replies: 3 };
  const view = viewOf(
    {
      opus: [own],
      o3: [nearest],
      best: [unnamed],
      flagship: [{ kind: "provider_flagship", basis: "model_not_in_library", record: "openai/gpt-6.1-sol", replies: 1 }],
      mixed: [own, nearest],
      failed: [{ kind: "unavailable", basis: null, record: null, replies: 2 }],
      bestLive: [unnamed],
    },
    {
      // Only saved replies: their figures name the kind and record.
      savedOwn: [{ kind: "direct_mapping", record: "anthropic/claude-opus-5-5", known: 3 }],
      // A saved stand-in takes the reason of a live reply with the same record,
      bestLive: [{ kind: "model_override", record: "openai/gpt-6.1-sol", known: 5 }],
      // and without one reads as the closest model.
      savedOverride: [{ kind: "model_override", record: "openai/gpt-6-astra", known: 1 }],
      // A saved reply without a figure says nothing about the estimate.
      savedUnknown: [{ kind: "direct_mapping", record: "anthropic/claude-opus-5-5", known: 0 }],
    },
  );
  const kind = (id: string) => estimationKind(view, id);
  assert.deepEqual(kind("opus"), { label: "Own record", tone: "own" });
  assert.deepEqual(kind("o3"), { label: "Similar model: GPT-6 Astra", tone: "similar" });
  assert.deepEqual(kind("best"), { label: "Family estimate", tone: "family" });
  assert.deepEqual(kind("flagship"), { label: "Family estimate", tone: "family" });
  assert.deepEqual(kind("mixed"), { label: "Similar model: GPT-6 Astra", tone: "similar", detail: "Some replies use another estimate" });
  const notEstimated = { label: "Not estimated", tone: "other", detail: NOT_ESTIMATED_DETAIL };
  assert.deepEqual(kind("failed"), notEstimated);
  assert.deepEqual(kind("bestLive"), { label: "Family estimate", tone: "family" });
  assert.deepEqual(kind("savedOwn"), { label: "Own record", tone: "own" });
  assert.deepEqual(kind("savedOverride"), { label: "Similar model: GPT-6 Astra", tone: "similar" });
  assert.deepEqual(kind("savedUnknown"), notEstimated);
  assert.deepEqual(kind("absent"), notEstimated);
});
