import "./dom-env";
import assert from "node:assert/strict";
import test from "node:test";
import { longEquivalent } from "../lib/dash/Overview";
import type { UsageFigures } from "../lib/ui/usage-figures";

const figures = {} as UsageFigures;

test("the dashboard and monthly recap sentences use the singular for one unit", () => {
  // The monthly recap read "≈ 1 tablespoons of water" for 16.8 mL (seen live 19 Oct 2026).
  assert.equal(longEquivalent("water", 16.8, figures, null), "About as much as 1 tablespoon of water.");
  assert.equal(longEquivalent("water", 5, figures, null), "About as much as under a tablespoon of water.");
  assert.equal(longEquivalent("water", 29.2, figures, null), "About as much as 2 tablespoons of water.");
  assert.equal(longEquivalent("water", 260, figures, null), "About as much as 1 glass of water.");
  assert.equal(longEquivalent("water", 350, figures, null), "About as much as 1.4 glasses of water.");
  assert.equal(longEquivalent("energy", 0.15, figures, null), "About as much as an 8 W LED bulb uses in 1 minute.");
  assert.equal(longEquivalent("energy", 8.2, figures, null), "About as much as an 8 W LED bulb uses in 1 hour.");
  assert.equal(longEquivalent("energy", 80, figures, null), "About as much as an 8 W LED bulb uses in 10 hours.");
});
