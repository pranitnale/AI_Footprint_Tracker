import assert from "node:assert/strict";
import test from "node:test";
import { chatComparison, chatEnergies, MIN_OTHER_CHATS } from "../lib/chat-comparison";
import type { UsageBreakdownView } from "../lib/dashboard/types";
import { emptyHistorySummary } from "@footprint/estimator";
import { breakdown } from "./ui-fixtures";

const window = () => breakdown({ bucket: "day", timezone: "UTC" }) as unknown as UsageBreakdownView;
const key = (i: number) => String(i).padStart(64, "0");
const near = (actual: number | null, expected: number) => assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

test("each chat's electricity is its figure at the chosen scenario", () => {
  const energies = chatEnergies(window(), "minimum");
  assert.equal(energies.size, 24);
  // Fixture chat i uses 1.4 Wh times (1 + i mod 9) at Minimum.
  near(energies.get(key(0))!, 1.4);
  near(energies.get(key(8))!, 12.6);
  assert.ok(chatEnergies(window(), "maximum").get(key(8))! > 12.6);
});

test("a chat is compared with the other chats only, and the average includes every chat", () => {
  const result = chatComparison(window(), null, key(8), "minimum");
  assert.equal(result.chats, 24);
  near(result.thisChat, 12.6);
  // Chat 17 has the same figure, so it is not smaller: 22 of the 23 others are.
  near(result.smallerShare, 22 / 23);
  near(result.averageWh, (111 * 1.4) / 24);
  assert.equal(result.bins.reduce((a, b) => a + b, 0), 24);
  assert.equal(result.thisBin, result.bins.length - 1);
  assert.equal(result.todayShare, null);
});

test("a chat known only from saved history is compared too", () => {
  const view = window();
  view.history = {
    total: { ...emptyHistorySummary(), status: "available" },
    buckets: {},
    sites: {},
    models: {},
    chats: {
      ["f".repeat(64)]: {
        ...emptyHistorySummary(),
        status: "available",
        prompt_count: "3",
        resources: [
          {
            quantity: "energy",
            value: "0.0004",
            unit: "kWh",
            scope: "historical_visible_response",
            method_id: "baseline-public-v1",
            method_hash: "a".repeat(64),
            status: "partial_estimate",
            validation_state: "unvalidated_reference",
            profile_selection: "highest_comparable",
            selected_profile_id: "reference",
            reasons: [],
            missing_components: [],
            known_message_count: "3",
            unknown_message_count: "0",
          },
        ],
      },
    },
  };
  const energies = chatEnergies(view, "minimum");
  assert.equal(energies.size, 25);
  near(energies.get("f".repeat(64))!, 0.4);
  // Live chats without saved history keep their own figure.
  near(energies.get(key(8))!, 12.6);
});

test("today's share is this chat's part of today's total", () => {
  const today = window();
  today.chats = today.chats.slice(0, 2);
  const result = chatComparison(window(), today, key(1), "minimum");
  const total = 2.524 * Object.values(today.buckets).reduce((sum, bucket) => sum + bucket.requests, 0);
  near(result.todayShare, Math.min(1, 2.8 / total));
});

test("too few other chats gives no percentage, and an unsaved chat still gets the average", () => {
  const view = window();
  view.chats = view.chats.slice(0, MIN_OTHER_CHATS);
  assert.equal(chatComparison(view, null, key(0), "minimum").smallerShare, null);
  const unsaved = chatComparison(window(), null, null, "minimum");
  assert.equal(unsaved.thisChat, null);
  assert.equal(unsaved.smallerShare, null);
  assert.equal(unsaved.thisBin, null);
  assert.ok(unsaved.averageWh! > 0);
  const none = chatComparison({ ...window(), chats: [] }, null, key(0), "minimum");
  assert.deepEqual([none.chats, none.averageWh, none.thisBin], [0, null, null]);
});
