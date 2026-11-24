import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { Ledger } from "@footprint/ledger";
import {
  BASELINE_METHOD_ID,
  emptyHistorySummary,
  estimateAttempt,
} from "@footprint/estimator";
import { records } from "../../../packages/ledger/test/factory";
import { unavailableCount } from "./counting-fixture";
import { Coordinator } from "../lib/coordinator";
import { transitionOwnership, type OwnershipHistory } from "../lib/ownership";

// Organization current-method design, section 9 tests 12 to 16 (23 Nov 2026): in an organization
// the organization's and the member's own totals are asked in the server's newest method.

type Answer = { status?: number; body: unknown };
const SERVER_METHOD = "ecologits-server-newest-test";
const SERVER_HASH = "d".repeat(64);

function row(methodId = SERVER_METHOD, methodHash = SERVER_HASH) {
  return {
    quantity: "energy",
    unit: "Wh",
    scope: "operational",
    value: "1.5",
    method_group: { method_id: methodId, method_hash: methodHash },
  };
}
function current(extra: Record<string, unknown> = {}) {
  return {
    aggregate_status: "current",
    calculation_view: "recalculated",
    method_id: SERVER_METHOD,
    method_hash: SERVER_HASH,
    recalculation_job_id: "c".repeat(64),
    recalculated_at: new Date().toISOString(),
    request_count: "2",
    attempt_count: "2",
    tokens: [],
    resources: [row()],
    ...extra,
  };
}
const original = {
  aggregate_status: "current",
  calculation_view: "original",
  request_count: "2",
  attempt_count: "2",
  tokens: [],
  resources: [row("ecologits-original-test", "e".repeat(64))],
};
const refusal = (status: number, code: string): Answer => ({
  status,
  body: { error: { code, message: code } },
});

async function setup(origin: string) {
  const db = await Ledger.open("current-view-" + crypto.randomUUID());
  const requests: URL[] = [];
  let answer: (url: URL) => Answer = () => ({ body: current() });
  const transport = (async (input: any) => {
    const url = new URL(String(input));
    if (!url.pathname.endsWith("/summary")) throw new TypeError("synthetic offline");
    requests.push(url);
    const { status = 200, body } = answer(url);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const c = new Coordinator(db, {
    hasConsent: async () => true,
    count: unavailableCount,
    sendDisplay: async () => {},
    transport,
  });
  await c.whenReady();
  const companyId = crypto.randomUUID(),
    userId = crypto.randomUUID(),
    era = crypto.randomUUID();
  const credentials = {
    key: "credentials",
    origin,
    namespace: `company:${companyId}:${userId}`,
    company_id: companyId,
    user_id: userId,
    device_id: crypto.randomUUID(),
    access_token: "test-only-access",
    refresh_token: "test-only-refresh",
    access_expires_at: new Date(Date.now() + 600000).toISOString(),
    enrollment_era: { id: era, start: new Date().toISOString(), end: null },
    user_hmac_key: "b".repeat(64),
    method_public_key: null,
    policy: {
      policy_version: "1.0.0",
      pause_mode: "user_controlled",
      deletion_epoch: 0,
      timezone: "UTC",
    },
  };
  const history = (await db.get<OwnershipHistory>("policy", "ownership-history"))!;
  await db.policyTransaction([
    credentials as any,
    transitionOwnership(history, {
      scope: { namespace: credentials.namespace, mode: "company", era },
      secret: credentials.user_hmac_key,
      policyVersion: "1.0.0",
    }) as any,
  ]);
  return {
    db,
    c,
    requests,
    answer: (next: (url: URL) => Answer) => {
      answer = next;
    },
    close: () => db.close(),
  };
}

test("12: default organization and own summaries ask the current view without a method", async () => {
  const f = await setup("https://current-12.example");
  try {
    for (const view of ["company", "my"] as const) {
      f.requests.length = 0;
      await f.c.selectedServerSummary(view, "?period=30d");
      assert.equal(f.requests.length, 1, view);
      assert.equal(f.requests[0]!.searchParams.get("calculation_view"), "current", view);
      assert.equal(f.requests[0]!.searchParams.has("method_id"), false, view);
    }
    // An explicit view from a caller is kept.
    f.requests.length = 0;
    f.answer(() => ({ body: original }));
    await f.c.selectedServerSummary("company", "?period=30d&calculation_view=original");
    assert.equal(f.requests[0]!.searchParams.get("calculation_view"), "original");
  } finally {
    f.close();
  }
});

test("13: an answer in a method this browser never saw is one total; a mix or a wrong hash is refused", async () => {
  const f = await setup("https://current-13.example");
  try {
    const shown = await f.c.selectedServerSummary("company", "?period=30d");
    assert.deepEqual(shown.calculation, {
      view: "recalculated",
      methodId: SERVER_METHOD,
      methodHash: SERVER_HASH,
    });
    assert.equal((shown.resources as unknown[]).length, 1);

    f.answer(() => ({ body: current({ resources: [row(), row("ecologits-other-test")] }) }));
    await assert.rejects(
      f.c.selectedServerSummary("company", "?period=7d"),
      /method_update_invalid/,
    );
    f.answer(() => ({
      body: current({
        models: {
          "claude-opus-5-5": {
            ...current({ resources: [row("ecologits-other-test")] }),
            site: "claude",
          },
        },
      }),
    }));
    await assert.rejects(
      f.c.selectedServerSummary("company", "?period=7d"),
      /method_update_invalid/,
      "a split in another method fails the whole answer",
    );
    const packaged = f.c.engines.methods.ecologits;
    f.answer(() => ({
      body: current({
        method_id: packaged.method_id,
        method_hash: "f".repeat(64),
        resources: [row(packaged.method_id, "f".repeat(64))],
      }),
    }));
    await assert.rejects(
      f.c.selectedServerSummary("company", "?period=7d"),
      /method_update_invalid/,
      "a packaged method id with another hash",
    );
  } finally {
    f.close();
  }
});

test("14: a server that refuses the current view is asked as before, and not again", async () => {
  const f = await setup("https://current-14.example");
  try {
    f.answer((url) =>
      url.searchParams.get("calculation_view") === "current"
        ? refusal(422, "unsupported_filter")
        : { body: original },
    );
    const first = await f.c.selectedServerSummary("company", "?period=30d");
    assert.deepEqual(
      f.requests.map((url) => url.searchParams.get("calculation_view")),
      ["current", "original"],
    );
    assert.equal(first.calculation.view, "original");
    f.requests.length = 0;
    await f.c.selectedServerSummary("company", "?period=7d");
    assert.deepEqual(
      f.requests.map((url) => url.searchParams.get("calculation_view")),
      ["original"],
    );
  } finally {
    f.close();
  }
});

test("14b: a server that ignores the view and answers the original view is asked as before, and not again", async () => {
  const { calculation_view: _label, ...unlabelled } = original;
  for (const [name, body] of [
    ["labelled original", original],
    ["unlabelled", unlabelled],
  ] as const) {
    const f = await setup(`https://current-14b-${name.replace(" ", "-")}.example`);
    try {
      f.answer(() => ({ body }));
      const first = await f.c.selectedServerSummary("company", "?period=30d");
      assert.deepEqual(
        f.requests.map((url) => url.searchParams.get("calculation_view")),
        ["current", "original"],
        name,
      );
      assert.equal(first.calculation.view, "original", name);
      f.requests.length = 0;
      await f.c.selectedServerSummary("company", "?period=7d");
      assert.deepEqual(
        f.requests.map((url) => url.searchParams.get("calculation_view")),
        ["original"],
        name,
      );
    } finally {
      f.close();
    }
  }
});

test("15: while the server recalculates, the saved copy is shown as a saved copy", async () => {
  const f = await setup("https://current-15.example");
  try {
    const fresh = await f.c.selectedServerSummary("company", "?period=30d");
    assert.equal(fresh.snapshot_source, "server");
    f.answer(() => refusal(409, "recalculation_pending"));
    const saved = await f.c.selectedServerSummary("company", "?period=30d");
    assert.equal(saved.snapshot_source, "cached");
    assert.equal(saved.offline, false);
    assert.equal(saved.calculation.methodHash, SERVER_HASH);
    await assert.rejects(
      f.c.selectedServerSummary("company", "?period=7d"),
      /recalculation_pending/,
      "without a saved copy the error is the one of today",
    );
  } finally {
    f.close();
  }
});

test("16: the own summary in the current view holds no local part", async () => {
  const f = await setup("https://current-16.example");
  try {
    const scope = await f.c.currentScope();
    const [r, a] = records();
    a.proposed_method_id = BASELINE_METHOD_ID;
    r.dispatched_at = a.started_at = new Date().toISOString();
    await f.db.commit(
      scope,
      [r, a],
      [
        {
          store: "local_estimates",
          value: {
            key: `current:${scope.namespace}:${a.attempt_id}`,
            namespace: scope.namespace,
            estimate: estimateAttempt(a),
          },
        },
      ],
    );
    const server = emptyHistorySummary();
    f.answer(() => ({ body: current({ history: server }) }));
    const mine = await f.c.selectedServerSummary("my", "?period=30d");
    assert.deepEqual(mine.history.local, emptyHistorySummary());
    assert.equal(mine.history.pending, null);
    assert.deepEqual(mine.history.server, server);
    assert.deepEqual(mine.calculation, {
      view: "recalculated",
      methodId: SERVER_METHOD,
      methodHash: SERVER_HASH,
    });
  } finally {
    f.close();
  }
});
