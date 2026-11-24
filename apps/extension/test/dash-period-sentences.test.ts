import assert from "node:assert/strict";
import test from "node:test";
import { dashWindow, inPeriod, type DashPeriod } from "../lib/ui/dash-periods";

// Live, 23 Nov 2026: "Your share of the organization's electricity in the this month" and "in the
// all time". The sentences on the Organization view and the Models page put the period after a noun.
test("every period reads as a correct sentence after a noun", () => {
  const now = new Date("2026-11-23T12:00:00Z");
  const cases: Array<[DashPeriod, string]> = [
    [{ kind: "today" }, "today"],
    [{ kind: "7d" }, "in the last 7 days"],
    [{ kind: "30d" }, "in the last 30 days"],
    [{ kind: "month" }, "this month"],
    [{ kind: "last-month" }, "from 1 to 31 October"],
    [{ kind: "all" }, "over all time"],
    [{ kind: "custom", from: "2026-09-01", to: "2026-09-06" }, "from 1 to 6 September"],
  ];
  for (const [period, expected] of cases) {
    const text = inPeriod(dashWindow(period, "UTC", now));
    assert.equal(text, expected, period.kind);
    assert.doesNotMatch(`Requests ${text}, split by the model that answered`, /\bin the (this|all|today|\d)/);
  }
  // A custom range of one day names that day.
  const day = dashWindow({ kind: "custom", from: "2026-09-06", to: "2026-09-06" }, "UTC", now);
  assert.equal(inPeriod(day), `on ${day.phrase}`);
});
