import assert from "node:assert/strict";
import test from "node:test";
import {
  carDistance,
  carbonEquivalent,
  energyEquivalent,
  ledDuration,
  phoneCharges,
  spelledUnit,
  toGrams,
  toMillilitres,
  toWh,
  waterAmount,
  waterEquivalent,
  wordsForTokens,
} from "../src/comparisons";
import { formatMetric, metricParts } from "../src/formatters";

test("metric parts split formatMetric exactly, so the popup and the bar never disagree", () => {
  const cases: [string | null, string][] = [
    ["0.00899", "kWh"], ["1.04", "kWh"], ["0.0000371", "kWh"], ["3.46", "gCO2e"], ["12100", "gCO2e"],
    ["0.0292", "L"], ["3.4", "L"], ["0", "kWh"], [null, "kWh"], ["-1", "kWh"], ["31.6", "kWh"],
  ];
  for (const [value, unit] of cases) {
    const text = formatMetric(value, unit);
    const parts = metricParts(value, unit);
    if (text === "Unknown") assert.equal(parts, null);
    else assert.equal(text.replace(/^≈ /, ""), `${parts!.number} ${parts!.unit}`.trim());
  }
});

test("unit conversion accepts only the units the estimator reports", () => {
  assert.equal(toWh("1.04", "kWh"), 1040);
  assert.equal(toWh("5", "Wh"), 5);
  assert.equal(toWh("5", "L"), null);
  assert.equal(toWh(null, "kWh"), null);
  assert.equal(toGrams("3.46", "gCO2e"), 3.46);
  assert.equal(toGrams("1", "kg CO₂e"), 1000);
  assert.equal(toMillilitres("0.0292", "L"), 29.2);
});

test("everyday comparisons use the sourced factors", () => {
  // 8.99 Wh with an 8 W bulb is 67 minutes, so it rounds into hours.
  assert.deepEqual(ledDuration(8.99), { value: "1.1", unit: "hours" });
  assert.deepEqual(ledDuration(4), { value: "30", unit: "min" });
  assert.deepEqual(ledDuration(0.05), { value: "<1", unit: "min" });
  assert.equal(energyEquivalent(1040), "≈ 130 hours of LED light");
  // 19 Wh per charge at the wall.
  assert.deepEqual(phoneCharges(8.99), { value: "47%", unit: "phone charge" });
  assert.deepEqual(phoneCharges(38), { value: "2", unit: "phone charges" });
  // 164 g per passenger-km.
  assert.deepEqual(carDistance(3.46), { value: "20", unit: "m" });
  assert.deepEqual(carDistance(400), { value: "2.4", unit: "km" });
  assert.equal(carbonEquivalent(12100), "≈ 74 km by car");
  assert.deepEqual(waterAmount(29.2), { value: "2", unit: "tbsp" });
  assert.deepEqual(waterAmount(3400), { value: "14", unit: "glasses" });
  assert.equal(waterEquivalent(5), "less than a tablespoon of water");
  assert.equal(wordsForTokens(537), 400);
  assert.equal(wordsForTokens(40), 30);
  // Two one-word replies wrote 5 tokens (seen live 12 Oct 2026); this read "≈ 0 words".
  assert.equal(wordsForTokens(2.5), 2);
  assert.equal(wordsForTokens(0.5), 1);
  assert.equal(wordsForTokens(0), 0);
});

test("everyday comparisons use the singular only when the shown value is 1", () => {
  // The monthly recap read "≈ 1 tablespoons of water" for 16.8 mL (seen live 19 Oct 2026).
  assert.equal(waterEquivalent(15), "≈ 1 tablespoon of water");
  assert.equal(waterEquivalent(16.8), "≈ 1 tablespoon of water");
  assert.equal(waterEquivalent(29.2), "≈ 2 tablespoons of water");
  assert.deepEqual(waterAmount(250), { value: "1", unit: "glass" });
  assert.deepEqual(waterAmount(260), { value: "1", unit: "glass" });
  assert.deepEqual(waterAmount(350), { value: "1.4", unit: "glasses" });
  assert.equal(waterEquivalent(260), "≈ 1 glass of water");
  assert.equal(waterEquivalent(350), "≈ 1.4 glasses of water");
  // 19 Wh is one phone charge; 19.5 Wh is 1.03 charges, shown as "1".
  assert.deepEqual(phoneCharges(19), { value: "1", unit: "phone charge" });
  assert.deepEqual(phoneCharges(19.5), { value: "1", unit: "phone charge" });
  assert.deepEqual(phoneCharges(28.5), { value: "1.5", unit: "phone charges" });
  // 8 W for an hour; 8.2 Wh is 61.5 minutes, shown as 1 hour.
  assert.deepEqual(ledDuration(8), { value: "1", unit: "hour" });
  assert.deepEqual(ledDuration(8.2), { value: "1", unit: "hour" });
  assert.equal(energyEquivalent(8.2), "≈ 1 hour of LED light");
  // 0.15 Wh is 1.1 minutes, shown as 1 minute.
  assert.equal(energyEquivalent(0.15), "≈ 1 minute of LED light");
  assert.equal(energyEquivalent(0.3), "≈ 2 minutes of LED light");
  assert.equal(spelledUnit({ value: "1", unit: "tbsp" }), "tablespoon");
  assert.equal(spelledUnit({ value: "<1", unit: "tbsp" }), "tablespoon");
  assert.equal(spelledUnit({ value: "1", unit: "min" }), "minute");
  assert.equal(spelledUnit({ value: "30", unit: "min" }), "minutes");
  // Metric abbreviations have no plural.
  assert.equal(spelledUnit({ value: "1", unit: "km" }), "km");
  assert.equal(spelledUnit({ value: "20", unit: "m" }), "m");
});
