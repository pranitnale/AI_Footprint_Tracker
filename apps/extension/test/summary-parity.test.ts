import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { scanSummary } from "../lib/summary-scan";
import { BreakdownObserver, type UsageBreakdown } from "../lib/usage-breakdown";
import type { Filters } from "../lib/summary";
import { periodWindow } from "../lib/ui/periods";
import {
  PARITY_DATASETS,
  PARITY_NOW,
  paritySnapshot,
  parityEntries,
  type ParityEntry,
} from "./perf/parity-snapshot";
import { largeProfile } from "./perf/large-profile";

// Answers of the code before the speed work of 15 October 2026 (commit 4365c75), made by
// test/perf/parity-snapshot.ts on that code. Made again on 20 October 2026 on 71685720 with the
// removed image benchmark references left out: only the dashboard hashes changed, no figure.
// Made again on 22 October 2026 for EcoLogits 0.11.3: request, attempt, chat and prompt counts are
// unchanged; only the electricity, carbon and water figures and their hashes moved with the catalog.
const golden: Record<string, Record<string, ParityEntry>> = JSON.parse(
  readFileSync(new URL("./fixtures/summary-parity.json", import.meta.url), "utf8"),
);

for (const dataset of PARITY_DATASETS)
  test(`popup and dashboard answers are unchanged: ${dataset.name}`, async () => {
    const expected = golden[dataset.name];
    assert.ok(expected, `no golden answers for ${dataset.name}`);
    const actual = parityEntries(await paritySnapshot(dataset));
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
    const changed = Object.keys(expected).filter((key) => actual[key]!.hash !== expected[key]!.hash);
    assert.deepEqual(
      changed.map((key) => ({ key, expected: expected[key]!.figures, actual: actual[key]!.figures })),
      [],
    );
  });

test("a scan that checks the view once and skips the original archive gives the same figures", async () => {
  const profile = await largeProfile({
    size: { chats: 16, requests: 90, historyChats: 6, historyTurns: 3, days: 40, erasedRequests: 2, erasedDay: true },
    mode: "company",
    seed: 404,
    now: PARITY_NOW,
  });
  try {
    const c = profile.coordinator;
    const view = await c.engines.view(profile.scope);
    assert.equal(view.view, "recalculated");
    for (const [zone, period] of [
      ["Europe/Berlin", "30d"],
      ["Pacific/Chatham", "7d"],
      // A small profile has no request today, so a third 7 day window with a negative offset.
      ["America/St_Johns", "7d"],
    ] as const) {
      const range = periodWindow(period, zone, PARITY_NOW);
      const filters: Filters = { calculationView: view.view, start: range.start, end: range.end };
      const scan = async (
        checked: boolean,
      ): Promise<{ total: Awaited<ReturnType<typeof scanSummary>>; parts: UsageBreakdown }> => {
        const observer = new BreakdownObserver(filters, { bucket: range.bucket, timezone: zone });
        const total = await scanSummary(
          c.ledger,
          profile.scope.namespace,
          filters,
          undefined,
          false,
          undefined,
          checked
            ? (attempt, _original, request) => view.estimate({ family: "live", request, attempt })
            : (attempt, _original, request, context) => view.scanEstimate(request, attempt, context),
          observer,
          // The reference reads and checks the original archive and reads each attempt on
          // its own; the fast scan skips the archive and reads each page together.
          checked ? {} : { originalUnused: true, resultMethodHash: view.method!.method_hash },
        );
        await view.current();
        return { total, parts: observer.result() };
      };
      const reference = await scan(true);
      assert.ok(reference.total.requests > 0, `${zone} ${period} has requests`);
      assert.deepEqual(await scan(false), reference);
    }
  } finally {
    profile.close();
  }
});

test("a change during a scan still makes the reader retry", async () => {
  const profile = await largeProfile({
    size: { chats: 6, requests: 20, historyChats: 2, historyTurns: 2, days: 10, erasedRequests: 0, erasedDay: false },
    mode: "personal",
    seed: 505,
    now: PARITY_NOW,
  });
  try {
    const c = profile.coordinator;
    const view = await c.engines.view(profile.scope);
    let changed = false;
    await scanSummary(
      c.ledger,
      profile.scope.namespace,
      { calculationView: view.view },
      undefined,
      false,
      undefined,
      async (attempt, _original, request, context) => {
        // A new preference revision lands while the scan runs, as a Settings change would.
        if (!changed) {
          changed = true;
          const state = await profile.repository.estimation.readPreferenceState();
          assert.equal(state.status, "valid");
          if (state.status === "valid")
            await profile.repository.estimation.compareAndSetPreference(state.revision, {
              ...state.record,
              selection_revision: state.revision + 1,
            });
        }
        return view.scanEstimate(request, attempt, context);
      },
    );
    await assert.rejects(view.current(), /selection_conflict|aggregate_inconsistent/);
  } finally {
    profile.close();
  }
});
