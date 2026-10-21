import assert from "node:assert/strict";
import test from "node:test";
import { baseParts, baseText, requestsPhrase } from "../lib/ui/figure-math";

// The dashboard read "Gemini · 1 requests" on a live profile (12 Oct 2026).
test("request counts use the singular for exactly one request", () => {
  assert.equal(requestsPhrase("1"), "1 request");
  assert.equal(requestsPhrase("≈ 1"), "≈ 1 request");
  assert.equal(requestsPhrase(1), "1 request");
  assert.equal(requestsPhrase("0"), "0 requests");
  assert.equal(requestsPhrase("12"), "12 requests");
  assert.equal(requestsPhrase("Unknown"), "Unknown requests");
  assert.deepEqual(baseParts("requests", 1), { number: "1", unit: "request" });
  assert.deepEqual(baseParts("requests", 3), { number: "3", unit: "requests" });
});

// A month with nothing recorded read "against 0 kWh in September" (12 Oct 2026).
test("a zero resource figure takes the unit small figures use", () => {
  assert.equal(baseText("energy", 0), "0 Wh");
  assert.equal(baseText("carbon", 0), "0 g CO₂e");
  assert.equal(baseText("water", 0), "0 mL");
  assert.deepEqual(baseParts("energy", 0), { number: "0", unit: "Wh" });
  assert.deepEqual(baseParts("water", 0), { number: "0", unit: "mL" });
  // Non-zero figures keep their scaled units.
  assert.equal(baseText("energy", 5), "5 Wh");
  assert.equal(baseText("energy", 0.0001), "0.1 mWh");
});
