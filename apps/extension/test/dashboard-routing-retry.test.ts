import { archivedEstimation } from "./archived-engine-fixture";
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { Ledger } from "@footprint/ledger";
import { unavailableCount } from "./counting-fixture";
import { Coordinator } from "../lib/coordinator";
import { HealthReporter } from "../lib/health";
import { transitionOwnership, type OwnershipHistory } from "../lib/ownership";

// Live, 23 Nov 2026: right after connecting to an organization, a routing write landed while the
// dashboard was built, the history view refused with policy_unavailable, and the dashboard showed
// "The dashboard could not load" and filed "Organization rules could not be checked".

async function setup() {
  const ledger = await Ledger.open("dashboard-routing-" + crypto.randomUUID());
  const coordinator = new Coordinator(ledger, {
    estimation: archivedEstimation,
    count: unavailableCount,
    hasConsent: async () => true,
    sendDisplay: async () => {},
    health: new HealthReporter(async () => {}),
  });
  await coordinator.whenReady();
  return Object.assign(coordinator, { testLedger: ledger });
}

/** Each call starts a real build, then raises the routing generation as onRoutingChange does. */
function changeRoutingDuring(coordinator: Coordinator, calls: number) {
  const history = coordinator.history;
  const view = history.view.bind(history);
  let seen = 0;
  history.view = (...args: Parameters<typeof view>) => {
    const built = view(...args);
    if (seen++ < calls) history.invalidate();
    return built;
  };
  return () => seen;
}

test("a routing change during the first dashboard build is retried and the dashboard loads", async () => {
  const coordinator = await setup();
  const views = changeRoutingDuring(coordinator, 1);
  const dashboard = await coordinator.dashboard({ calculationView: "original" });
  assert.equal(dashboard.summary.requests, 0);
  assert.equal(views(), 2);
});

test("a routing change during every attempt still fails as policy_unavailable, within three attempts", async () => {
  const coordinator = await setup();
  const views = changeRoutingDuring(coordinator, Infinity);
  await assert.rejects(
    coordinator.dashboard({ calculationView: "original" }),
    /policy_unavailable/,
  );
  assert.equal(views(), 3);
});

test("a build made before a routing change is never shown", async () => {
  const coordinator = await setup();
  const builds = coordinator as unknown as {
    buildDashboard: () => Promise<{ result: unknown; consistent: boolean }>;
  };
  const refused = () => Promise.reject(new Error("policy_unavailable"));
  const moved = (result: string) => Promise.resolve({ result: { result }, consistent: false });

  let steps = [() => moved("before"), refused, refused];
  builds.buildDashboard = () => steps.shift()!();
  await assert.rejects(coordinator.dashboard(), /policy_unavailable/);

  steps = [() => moved("before"), refused, () => moved("after")];
  const shown = (await coordinator.dashboard()) as unknown as {
    result: string;
    aggregate_status: string;
  };
  assert.equal(shown.result, "after");
  assert.equal(shown.aggregate_status, "rebuilding");
});

test("a scope change during the build is refused at once and never retried", async () => {
  const coordinator = await setup();
  const ledger = coordinator.testLedger;
  let calls = 0;
  (coordinator as unknown as { buildDashboard: () => Promise<never> }).buildDashboard = async () => {
    calls++;
    const history = (await ledger.get<OwnershipHistory>("policy", "ownership-history"))!;
    await ledger.policyTransaction([
      transitionOwnership(history, {
        scope: { namespace: "personal:other", mode: "personal", era: null },
        secret: "b".repeat(64),
        policyVersion: "1.0.0",
      }) as any,
    ]);
    throw new Error("policy_unavailable");
  };
  await assert.rejects(coordinator.dashboard(), /policy_unavailable/);
  assert.equal(calls, 1);
});
