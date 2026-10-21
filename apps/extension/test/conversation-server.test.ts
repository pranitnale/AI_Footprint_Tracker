import { archivedEstimation, settleStartup } from "./archived-engine-fixture";
import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { countByTextLength, unavailableCount } from "./counting-fixture";
import { Ledger } from "@footprint/ledger";
import { Coordinator } from "../lib/coordinator";
import {
  transitionOwnership,
  hmacIdentity,
  type OwnershipHistory,
} from "../lib/ownership";
import { initialSnapshot } from "@footprint/adapters";
import { emptyHistorySummary } from "@footprint/estimator";
import { records } from "../../../packages/ledger/test/factory";
import { readFileSync } from "node:fs";
async function setup() {
  const db = await Ledger.open("conversation-server-" + crypto.randomUUID()),
    displays: any[] = [],
    calls: string[] = [];
  let offline = false,
    block: Promise<void> | null = null,
    answer: (() => Response) | null = null;
  const coordinator = new Coordinator(db, {
    estimation: archivedEstimation,
    hasConsent: async () => true,
    sendDisplay: async (_, v) => {
      displays.push(v);
    },
    count: unavailableCount,
    transport: (async (url: any) => {
      calls.push(String(url));
      if (offline) throw new TypeError("Failed to fetch");
      if (answer) return answer();
      if (block) await block;
      return new Response(
        JSON.stringify({
          aggregate_status: "current",
          request_count: "99",
          attempt_count: "100",
          tokens: [],
          resources: [],
          history: emptyHistorySummary(),
        }),
      );
    }) as typeof fetch,
  });
  await settleStartup(coordinator);
  const companyId = crypto.randomUUID(),
    userId = crypto.randomUUID(),
    era = crypto.randomUUID();
  const c: any = {
    key: "credentials",
    namespace: `company:${companyId}:${userId}`,
    company_id: companyId,
    user_id: userId,
    device_id: crypto.randomUUID(),
    origin: "https://company.example",
    access_token: "test-access",
    refresh_token: "test-refresh",
    access_expires_at: new Date(Date.now() + 600000).toISOString(),
    enrollment_era: { id: era, start: new Date().toISOString(), end: null },
    user_hmac_key: "b".repeat(64),
    policy: {
      policy_version: "1.0.0",
      disclosure_version: "1.0.0",
      pause_mode: "user_controlled",
      deletion_epoch: 0,
      timezone: "UTC",
    },
  };
  const at = Date.now();
  const history = (await db.get<OwnershipHistory>(
    "policy",
    "ownership-history",
  ))!;
  await db.policyTransaction([
    c,
    transitionOwnership(
      history,
      {
        scope: { namespace: c.namespace, mode: "company", era },
        secret: c.user_hmac_key,
        policyVersion: "1.0.0",
      },
      at,
    ) as any,
  ]);
  const id = crypto.randomUUID(),
    conversationId = crypto.randomUUID();
  const dispatch: any = {
    timing: null,
    channel: "ai-footprint-observation-v1",
    version: 1,
    id,
    revision: 1,
    event: "dispatch",
    site: "chatgpt",
    at: new Date(at + 1).toISOString(),
    dispatch: {
      site: "chatgpt",
      action: "send",
      input: "Synthetic input",
      conversationId,
      parentId: null,
      requestId: "synthetic-request",
      model: null,
      attachments: 0,
      imageEditParentId: null,
    },
    snapshot: initialSnapshot(),
    failure: null,
  };
  return {
    db,
    coordinator,
    c,
    displays,
    calls,
    dispatch,
    conversationId,
    offline: () => (offline = true),
    answer: (value: (() => Response) | null) => (answer = value),
    block: (value: Promise<void>) => (block = value),
  };
}
const sender = {
  tab: { id: 4 },
  frameId: 0,
  documentId: "synthetic-document",
  url: "https://chatgpt.com/",
};
async function acknowledgeRows(
  db: Ledger,
  namespace: string,
  rows: Awaited<ReturnType<Ledger["pending"]>>,
) {
  const acknowledgements = rows.map((row) => ({
    kind: row.kind,
    id: row.id,
    revision: row.revision,
    payload_hash: row.hash,
    server_record_version: row.revision,
    status: "applied" as const,
  }));
  await db.acknowledge(namespace, crypto.randomUUID(), acknowledgements, rows);
}
test("U07 company active and reopened conversations use server99 separately from local pending1", async () => {
  const f = await setup();
  await f.coordinator.capture(f.dispatch, sender);
  await f.coordinator.settleConversationDisplays();
  const active = f.displays.at(-1);
  assert.equal(active.summary.requests, 1);
  assert.equal(active.conversation.server.request_count, "99");
  assert.equal(active.conversation.pending.requests, 1);
  assert.equal(active.conversation.source, "server");
  assert.ok(
    f.calls.every((url) => {
      const parsed = new URL(url);
      return (
        /^\/v1\/me\/conversations\/[a-f0-9]{64}\/summary$/.test(
          parsed.pathname,
        ) &&
        parsed.searchParams.get("period") === "all" &&
        parsed.searchParams.get("calculation_view") === "original" &&
        parsed.searchParams.size === 2
      );
    }),
  );
  assert.ok(!f.calls.join().includes(f.conversationId));
  for (const row of await f.db.pending(f.c.namespace))
    await f.db.remove("outbox", row.key);
  const reopened = await f.coordinator.routeSummary(
    "chatgpt",
    f.conversationId,
  );
  assert.equal(reopened.conversation.server.request_count, "99");
  assert.equal(reopened.conversation.pending?.requests, 0);
  assert.equal(reopened.summary.requests, 1);
  f.offline();
  const cached = await f.coordinator.routeSummary("chatgpt", f.conversationId);
  assert.equal(cached.conversation.source, "cached");
  assert.equal(cached.conversation.server.request_count, "99");
  assert.equal(cached.conversation.offline, true);
  assert.ok(cached.conversation.cachedAt);
  await f.db.eraseNamespace(f.c.namespace);
  const erased = await f.coordinator.routeSummary("chatgpt", f.conversationId);
  assert.equal(erased.conversation.server, null);
  assert.equal(erased.summary.requests, 0);
  const before = f.calls.length;
  await f.db.put("policy", { ...f.c, enrollment_state: "revoked" });
  const revoked = await f.coordinator.routeSummary("chatgpt", f.conversationId);
  assert.equal(revoked.mode, "personal");
  assert.equal(revoked.conversation.server, null);
  assert.equal(f.calls.length, before);
  f.db.close();
});
const refusal = (code: string, status: number) => () =>
  new Response(JSON.stringify({ error: { code, safe_message: "Server words." } }), {
    status,
    headers: { "Content-Type": "application/json", "Retry-After": "60" },
  });
test("a server that answers with a refusal is reachable, so the chat is not offline", async () => {
  // Right after a server update every read answers 409 recalculation_pending (live, 14 Oct 2026).
  const f = await setup();
  await f.coordinator.capture(f.dispatch, sender);
  await f.coordinator.settleConversationDisplays();
  f.answer(refusal("recalculation_pending", 409));
  const first = await f.coordinator.routeSummary("chatgpt", f.conversationId);
  assert.equal(first.conversation.server, null);
  assert.equal(first.conversation.offline, false);
  // With a cached copy, a rate limit or a server error shows the copy, still not offline.
  f.answer(null);
  await f.coordinator.routeSummary("chatgpt", f.conversationId);
  for (const answer of [
    refusal("rate_limited", 429),
    () => new Response("<html>Service unavailable</html>", { status: 503 }),
  ]) {
    f.answer(answer);
    const cached = await f.coordinator.routeSummary("chatgpt", f.conversationId);
    assert.equal(cached.conversation.source, "cached");
    assert.equal(cached.conversation.server.request_count, "99");
    assert.equal(cached.conversation.offline, false);
  }
  // Only a failure to reach the server is offline.
  f.answer(null);
  f.offline();
  const unreachable = await f.coordinator.routeSummary("chatgpt", f.conversationId);
  assert.equal(unreachable.conversation.offline, true);
  f.db.close();
});
test("a paused organization keeps the connection and Details is told sharing is paused", async () => {
  const f = await setup();
  await f.coordinator.capture(f.dispatch, sender);
  await f.coordinator.settleConversationDisplays();
  f.answer(refusal("service_suspended", 403));
  const paused = await f.coordinator.routeSummary("chatgpt", f.conversationId);
  assert.equal(paused.mode, "company");
  assert.equal(paused.sharingPaused, true);
  assert.equal(paused.conversation.offline, false);
  assert.equal((await f.coordinator.company.credentials())?.enrollment_state ?? "active", "active");
  // Once the server answers again, the pause is over.
  f.answer(null);
  const resumed = await f.coordinator.routeSummary("chatgpt", f.conversationId);
  assert.equal(resumed.sharingPaused, false);
  f.db.close();
});
test("a chat comparison that cannot single out the chat or its smaller model records why", async () => {
  const f = await setup();
  const namespace = (await f.coordinator.currentScope()).namespace;
  const codes = async () =>
    (await f.db.list<any>("health", namespace)).map((row) => row.code);
  const coordinator = f.coordinator as any;
  const keyFor = coordinator.keyFor.bind(coordinator);
  coordinator.keyFor = async () => {
    throw new Error("policy_unavailable");
  };
  const unkeyed = await f.coordinator.chatComparison("chatgpt", f.conversationId);
  assert.equal(unkeyed.smallerModel, null);
  assert.ok((await codes()).includes("policy_unavailable"));
  coordinator.keyFor = keyFor;
  coordinator.smallerModel = async () => {
    throw new Error("synthetic estimator fault");
  };
  const unsized = await f.coordinator.chatComparison("chatgpt", f.conversationId);
  assert.equal(unsized.smallerModel, null);
  assert.ok((await codes()).includes("estimate_unavailable"));
  f.db.close();
});
test("offline company summary does not hold capture counting or persistence behind network", async () => {
  const f = await setup();
  let release!: () => void;
  f.block(new Promise<void>((resolve) => (release = resolve)));
  await f.coordinator.capture(f.dispatch, sender);
  assert.equal((await f.db.rows(f.c.namespace)).length, 2);
  assert.equal(f.displays[0].conversation.source, "local");
  release();
  await f.coordinator.settleConversationDisplays();
  assert.equal(f.displays.at(-1).conversation.server.request_count, "99");
  f.db.close();
});
test("company logout while a canonical response is in flight cannot display the old company snapshot", async () => {
  const f = await setup();
  let release!: () => void;
  f.block(new Promise<void>((resolve) => (release = resolve)));
  await f.coordinator.capture(f.dispatch, sender);
  for (let i = 0; i < 20 && !f.calls.length; i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(f.calls.length, 1);
  await f.db.put("policy", { ...f.c, enrollment_state: "revoked" });
  release();
  await f.coordinator.settleConversationDisplays();
  assert.equal(f.displays.at(-1).conversation.server, null);
  assert.equal(f.displays.at(-1).mode, "personal");
  assert.equal(f.displays.at(-1).summary.requests, 0);
  f.db.close();
});
test("in-progress erasure never returns a cached or partially purged conversation subtotal", async () => {
  const f = await setup();
  await f.coordinator.routeSummary("chatgpt", f.conversationId);
  await f.db.put("deletion_markers", {
    key: `range:${f.c.namespace}:1`,
    namespace: f.c.namespace,
    status: "purging",
  });
  const calls = f.calls.length;
  await assert.rejects(
    f.coordinator.routeSummary("chatgpt", f.conversationId),
    /deletion_in_progress/,
  );
  assert.equal(f.calls.length, calls);
  f.db.close();
});
test("a completed range purge during the server request prevents stale cache repopulation", async () => {
  const f = await setup();
  let release!: () => void;
  f.block(new Promise<void>((resolve) => (release = resolve)));
  await f.coordinator.capture(f.dispatch, sender);
  for (let i = 0; i < 20 && !f.calls.length; i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(f.calls.length, 1);
  await f.db.applyRange(
    { namespace: f.c.namespace, mode: "company", era: f.c.enrollment_era.id },
    null,
    new Date(Date.now() + 5000).toISOString(),
    1,
  );
  release();
  await f.coordinator.settleConversationDisplays();
  assert.equal(f.displays.at(-1).conversation.server, null);
  assert.equal(f.displays.at(-1).summary.requests, 0);
  assert.equal(
    (await f.db.list<any>("dashboard_cache", f.c.namespace)).filter(
      (row) => row.server,
    ).length,
    0,
  );
  f.db.close();
});

test("conversation pending count includes unconfirmed revisions and excludes other conversations", async () => {
  const f = await setup();
  await f.coordinator.capture(f.dispatch, sender);
  const initial = await f.db.pending(f.c.namespace);
  assert.ok(initial.length >= 2);
  await acknowledgeRows(
    f.db,
    f.c.namespace,
    initial.filter((row) => row.kind === "request"),
  );
  let view = await f.coordinator.routeSummary("chatgpt", f.conversationId);
  assert.equal(view.conversation.pending!.requests, 0);
  assert.equal(view.conversation.pending!.attempts, 0);
  assert.equal(view.conversation.pendingObservationCount, 1);

  await acknowledgeRows(f.db, f.c.namespace, await f.db.pending(f.c.namespace));
  view = await f.coordinator.routeSummary("chatgpt", f.conversationId);
  assert.equal(view.conversation.pendingObservationCount, 0);

  await f.coordinator.capture(
    {
      ...f.dispatch,
      revision: 2,
      event: "end",
      dispatch: null,
      snapshot: {
        ...initialSnapshot(),
        text: "Synthetic observed answer",
        outputId: "synthetic-output",
        started: true,
        state: "completed",
      },
    },
    sender,
  );
  view = await f.coordinator.routeSummary("chatgpt", f.conversationId);
  assert.ok(view.conversation.pendingObservationCount > 0);
  assert.ok(view.conversation.pending!.attempts > 0);
  await acknowledgeRows(f.db, f.c.namespace, await f.db.pending(f.c.namespace));

  const otherConversation = crypto.randomUUID();
  await f.coordinator.capture(
    {
      ...f.dispatch,
      id: crypto.randomUUID(),
      dispatch: {
        ...f.dispatch.dispatch,
        conversationId: otherConversation,
        requestId: "other-request",
      },
    },
    sender,
  );
  view = await f.coordinator.routeSummary("chatgpt", f.conversationId);
  assert.equal(view.conversation.pendingObservationCount, 0);
  assert.ok((await f.db.application.pendingCount(f.c.namespace)) > 0);

  await f.db.eraseNamespace(f.c.namespace);
  view = await f.coordinator.routeSummary("chatgpt", f.conversationId);
  assert.equal(view.conversation.pendingObservationCount, 0);
  assert.equal(view.conversation.server, null);
  f.db.close();
});

const geminiRelation = JSON.parse(
  readFileSync(
    new URL(
      "../../../fixtures/provider-identity-2026-09-10.json",
      import.meta.url,
    ),
    "utf8",
  ),
).gemini;

test("Gemini reopening shares the prefixed generation key and never adds requests or outbox entries", async () => {
  const f = await setup();
  try {
    const event = {
      ...f.dispatch,
      site: "gemini",
      dispatch: {
        ...f.dispatch.dispatch,
        site: "gemini",
        conversationId: geminiRelation.conversation_argument,
      },
    };
    await f.coordinator.capture(event, {
      ...sender,
      url: "https://gemini.google.com" + geminiRelation.route,
    });
    await f.coordinator.settleConversationDisplays();
    const before = await f.db.pending(f.c.namespace);
    const active = f.displays.at(-1);
    const first = await f.coordinator.routeSummary(
      "gemini",
      geminiRelation.conversation_argument,
    );
    const second = await f.coordinator.routeSummary(
      "gemini",
      geminiRelation.conversation_argument,
    );
    assert.equal(first.summary.requests, 1);
    assert.equal(second.summary.requests, 1);
    assert.equal(first.conversation.server.request_count, "99");
    assert.equal(active.summary.requests, first.summary.requests);
    assert.deepEqual(await f.db.pending(f.c.namespace), before);
    assert.ok(
      f.calls.every(
        (url) => !url.includes(geminiRelation.conversation_argument),
      ),
    );
    const urls = f.calls.filter((url) => url.includes("/conversations/"));
    assert.equal(new Set(urls).size, 1);
    await assert.rejects(
      f.coordinator.routeSummary(
        "gemini",
        geminiRelation.route.split("/").at(-1),
      ),
      /payload_rejected/,
    );
  } finally {
    f.db.close();
  }
});

for (const change of ["connect", "disconnect", "tenant_switch"] as const)
  test(`Gemini in-flight ${change} rederives identity and cannot relabel an old-scope summary`, async () => {
    const f = await setup();
    try {
      const personal = (await f.db.get<any>("policy", "personal"))!;
      const target = {
        ...f.c,
        namespace: `company:${crypto.randomUUID()}:${crypto.randomUUID()}`,
        origin: "https://second.example",
        user_hmac_key: "d".repeat(64),
        device_id: crypto.randomUUID(),
        enrollment_era: { ...f.c.enrollment_era, id: crypto.randomUUID() },
      };
      async function switchTo(c: any | null) {
        const history = (await f.db.get<OwnershipHistory>(
          "policy",
          "ownership-history",
        ))!;
        const scope = c
          ? {
              namespace: c.namespace,
              mode: "company" as const,
              era: c.enrollment_era.id,
            }
          : {
              namespace: personal.namespace,
              mode: "personal" as const,
              era: null,
            };
        const next = transitionOwnership(history, {
          scope,
          secret: c?.user_hmac_key ?? personal.secret,
          policyVersion: "1.0.0",
        });
        // This models the same atomic credential/ownership commit used by Connect and Disconnect.
        await f.db.policyTransaction(
          [...(c ? [c] : []), next as any],
          c ? [] : ["credentials"],
        );
      }
      async function seed(c: any | null, count: number) {
        const scope = c
          ? {
              namespace: c.namespace,
              mode: "company" as const,
              era: c.enrollment_era.id,
            }
          : {
              namespace: personal.namespace,
              mode: "personal" as const,
              era: null,
            };
        const key = await hmacIdentity(
          c?.user_hmac_key ?? personal.secret,
          "gemini",
          "conversation",
          geminiRelation.conversation_argument,
        );
        for (let index = 0; index < count; index++) {
          const [r] = records();
          r.site = "gemini";
          r.conversation_key = key;
          await f.db.commit(scope, [r]);
        }
      }
      await seed(f.c, 1);
      await seed(null, 2);
      await seed(target, 3);
      if (change === "connect") await switchTo(null);
      let release!: () => void, entered!: () => void;
      const paused = new Promise<void>((resolve) => (release = resolve)),
        started = new Promise<void>((resolve) => (entered = resolve));
      const scan = f.db.scanIndex.bind(f.db);
      let intercepted = false;
      f.db.scanIndex = async (...args: Parameters<Ledger["scanIndex"]>) => {
        if (!intercepted && args[0] === "requests") {
          intercepted = true;
          entered();
          await paused;
        }
        return scan(...args);
      };
      const pending = f.coordinator.routeSummary(
        "gemini",
        geminiRelation.conversation_argument,
      );
      await started;
      await switchTo(
        change === "connect" ? f.c : change === "disconnect" ? null : target,
      );
      release();
      const view = await pending;
      assert.equal(view.mode, change === "disconnect" ? "personal" : "company");
      assert.equal(
        view.summary.requests,
        change === "connect" ? 1 : change === "disconnect" ? 2 : 3,
      );
      if (change === "disconnect") assert.equal(view.conversation.server, null);
      else assert.equal(view.conversation.server.request_count, "99");
      assert.ok(
        f.calls.every(
          (url) => !url.includes(geminiRelation.conversation_argument),
        ),
      );
    } finally {
      f.db.close();
    }
  });

test("final permission await cannot approve stale company routing after an atomic tenant switch", async () => {
  const f = await setup();
  try {
    const target = {
      ...f.c,
      namespace: `company:${crypto.randomUUID()}:${crypto.randomUUID()}`,
      origin: "https://second.example",
      user_hmac_key: "d".repeat(64),
      device_id: crypto.randomUUID(),
      enrollment_era: { ...f.c.enrollment_era, id: crypto.randomUUID() },
    };
    for (const [c, count] of [
      [f.c, 1],
      [target, 2],
    ] as const) {
      const key = await hmacIdentity(
        c.user_hmac_key,
        "gemini",
        "conversation",
        geminiRelation.conversation_argument,
      );
      for (let n = 0; n < count; n++) {
        const [r] = records();
        r.site = "gemini";
        r.conversation_key = key;
        await f.db.commit(
          { namespace: c.namespace, mode: "company", era: c.enrollment_era.id },
          [r],
        );
      }
    }
    const original = f.coordinator.currentScope.bind(f.coordinator);
    let checks = 0,
      switched = false;
    f.coordinator.currentScope = async () => {
      checks++;
      return original();
    };
    (f.coordinator as any).dependencies.hasConsent = async () => {
      if (checks >= 4 && !switched) {
        switched = true;
        const history = (await f.db.get<OwnershipHistory>(
          "policy",
          "ownership-history",
        ))!;
        await f.db.policyTransaction([
          target,
          transitionOwnership(history, {
            scope: {
              namespace: target.namespace,
              mode: "company",
              era: target.enrollment_era.id,
            },
            secret: target.user_hmac_key,
            policyVersion: "1.0.0",
          }) as any,
        ]);
      }
      return true;
    };
    const view = await f.coordinator.routeSummary(
      "gemini",
      geminiRelation.conversation_argument,
    );
    assert.equal(switched, true);
    assert.equal((await original()).namespace, target.namespace);
    assert.equal(view.mode, "company");
    assert.equal(view.summary.requests, 2);
  } finally {
    f.db.close();
  }
});

test("routing permission and credential revalidation preserves paused, revoked and no-consent modes", async () => {
  const f = await setup();
  try {
    const settings = await f.coordinator.settings();
    await f.db.put("policy", { ...settings, paused: true });
    assert.equal((await f.coordinator.currentScope()).mode, "company");
    (f.coordinator as any).dependencies.hasConsent = async () => false;
    assert.equal((await f.coordinator.currentScope()).mode, "personal");
    (f.coordinator as any).dependencies.hasConsent = async () => true;
    await f.db.put("policy", { ...f.c, enrollment_state: "revoked" });
    assert.equal((await f.coordinator.currentScope()).mode, "personal");
  } finally {
    f.db.close();
  }
});

test("active publication never sends an old scope after its final queue-count await", async () => {
  const f = await setup();
  try {
    let switched = false;
    const original = f.db.application.pendingCount.bind(f.db.application);
    f.db.application.pendingCount = async (
      ...args: Parameters<Ledger["pendingCount"]>
    ) => {
      const count = await original(...args);
      if (!switched) {
        switched = true;
        const personal = (await f.db.get<any>("policy", "personal"))!;
        const history = (await f.db.get<OwnershipHistory>(
          "policy",
          "ownership-history",
        ))!;
        await f.db.policyTransaction(
          [
            transitionOwnership(history, {
              scope: {
                namespace: personal.namespace,
                mode: "personal",
                era: null,
              },
              secret: personal.secret,
              policyVersion: "1.0.0",
            }) as any,
          ],
          ["credentials"],
        );
      }
      return count;
    };
    await f.coordinator.capture(f.dispatch, sender);
    await f.coordinator.settleConversationDisplays();
    const current = await f.coordinator.currentScope();
    assert.equal(current.mode, "personal");
    assert.ok(
      f.displays.every((d) => d.mode !== "company"),
      "old company display published after ownership switch",
    );
  } finally {
    f.db.close();
  }
});

for (const [change, phase] of [
  ["connect", "initial"],
  ["disconnect", "initial"],
  ["tenant_switch", "initial"],
  ["disconnect", "refresh"],
  ["tenant_switch", "refresh"],
  ["erase", "refresh"],
] as const)
  test(`bound active ${phase} publication revalidates ${change} after its queue-count await`, async () => {
    const f = await setup();
    try {
      const personal = (await f.db.get<any>("policy", "personal"))!;
      const target = {
        ...f.c,
        namespace: `company:${crypto.randomUUID()}:${crypto.randomUUID()}`,
        origin: "https://second.example",
        device_id: crypto.randomUUID(),
        user_hmac_key: "d".repeat(64),
        enrollment_era: { ...f.c.enrollment_era, id: crypto.randomUUID() },
      };
      async function switchTo(c: any | null) {
        const history = (await f.db.get<OwnershipHistory>(
          "policy",
          "ownership-history",
        ))!;
        await f.db.policyTransaction(
          [
            ...(c ? [c] : []),
            transitionOwnership(history, {
              scope: c
                ? {
                    namespace: c.namespace,
                    mode: "company",
                    era: c.enrollment_era.id,
                  }
                : {
                    namespace: personal.namespace,
                    mode: "personal",
                    era: null,
                  },
              secret: c?.user_hmac_key ?? personal.secret,
              policyVersion: "1.0.0",
            }) as any,
          ],
          c ? [] : ["credentials"],
        );
      }
      if (change === "connect") await switchTo(null);
      const bound = {
        documentNonce: crypto.randomUUID(),
        navigationNonce: crypto.randomUUID(),
        captureId: f.dispatch.id,
      };
      const capturedScope = await f.coordinator.currentScope();
      const event = {
        ...f.dispatch,
        at: new Date(Date.now() + 1).toISOString(),
      };
      let calls = 0,
        switched = false,
        publishedBefore = 0;
      const pending = f.db.application.pendingCount.bind(f.db.application);
      f.db.application.pendingCount = async (
        ...args: Parameters<Ledger["pendingCount"]>
      ) => {
        const value = await pending(...args);
        calls++;
        if (!switched && calls === (phase === "initial" ? 1 : 2)) {
          switched = true;
          publishedBefore = f.displays.length;
          if (change === "erase")
            await f.db.applyRange(
              capturedScope,
              null,
              new Date(Date.now() + 10000).toISOString(),
              1,
            );
          else
            await switchTo(
              change === "connect"
                ? f.c
                : change === "disconnect"
                  ? null
                  : target,
            );
        }
        return value;
      };
      await f.coordinator.capture(event, sender, bound);
      await f.coordinator.settleConversationDisplays();
      assert.equal(switched, true);
      const after = f.displays.slice(publishedBefore);
      assert.ok(after.length > 0);
      for (const display of after) {
        assert.equal(display.summary.requests, 0);
        assert.equal(
          display.mode,
          change === "disconnect" ? "personal" : "company",
        );
        assert.deepEqual(display.displayBinding, bound);
        if (change === "erase") assert.equal(display.conversation.server, null);
        assert.equal(display.activeContext, null);
        assert.equal(display.budget, null);
        assert.equal(display.budgetBasis, null);
        assert.equal(display.state, "dispatch_only");
        assert.equal(display.guidance.show, false);
        assert.equal(display.guidance.ratio, null);
      }
      const persisted = JSON.stringify([
        ...(await f.db.rows(capturedScope.namespace)),
        ...(await f.db.all("provider_key_map")),
      ]);
      assert.ok(
        !persisted.includes(bound.documentNonce) &&
          !persisted.includes(bound.navigationNonce),
      );
      if (change !== "erase")
        assert.equal((await f.db.rows(capturedScope.namespace)).length, 2);
    } finally {
      f.db.close();
    }
  });

test("active binding stays pinned through progress and is never serialized with observations", async () => {
  const f = await setup();
  try {
    const binding = {
      documentNonce: crypto.randomUUID(),
      navigationNonce: crypto.randomUUID(),
      captureId: f.dispatch.id,
    };
    await f.coordinator.capture(f.dispatch, sender, binding);
    await f.coordinator.settleConversationDisplays();
    await f.coordinator.capture(
      {
        ...f.dispatch,
        revision: 2,
        event: "end",
        dispatch: null,
        snapshot: {
          ...initialSnapshot(),
          text: "Synthetic answer",
          outputId: "synthetic-output",
          conversationId: f.conversationId,
          started: true,
          state: "completed",
        },
      },
      sender,
      { ...binding, navigationNonce: crypto.randomUUID() },
    );
    await f.coordinator.settleConversationDisplays();
    assert.ok(f.displays.length > 0);
    assert.ok(
      f.displays.every(
        (d) => d.displayBinding.navigationNonce === binding.navigationNonce,
      ),
    );
    assert.ok(
      f.displays.every(
        (d) =>
          d.conversationIdentity.site === "chatgpt" &&
          d.conversationIdentity.conversationId === f.conversationId,
      ),
    );
    const persisted = JSON.stringify([
      ...(await f.db.rows(f.c.namespace)),
      ...(await f.db.all("provider_key_map")),
      ...(await f.db.pending(f.c.namespace)),
    ]);
    assert.ok(
      !persisted.includes(binding.documentNonce) &&
        !persisted.includes(binding.navigationNonce) &&
        !persisted.includes(f.conversationId),
    );
    f.coordinator.invalidateDisplay(sender.tab.id, binding.documentNonce);
    assert.equal((f.coordinator as any).displayBindings.size, 0);
  } finally {
    f.db.close();
  }
});

for (const change of ["erase", "correction", "alias"] as const)
  for (const phase of ["queue", "final_snapshot"] as const)
    test(`active nonzero metadata clears after ${change} at ${phase}`, async () => {
      const f = await setup();
      try {
        const scope = await f.coordinator.currentScope();
        const settings = (await f.db.get<any>("policy", "settings"))!;
        // The token trigger is off by default since 16 Oct 2026.
        await f.db.put("policy", { ...settings, key: "settings", budget: 100, contextTipTokens: true });
        (f.coordinator as any).dependencies.count = countByTextLength;
        f.dispatch.dispatch.input = "x".repeat(400);
        const binding = {
          documentNonce: crypto.randomUUID(),
          navigationNonce: crypto.randomUUID(),
          captureId: f.dispatch.id,
        };
        await f.coordinator.capture(f.dispatch, sender, binding);
        await f.coordinator.settleConversationDisplays();
        const end = {
          ...f.dispatch,
          revision: 2,
          event: "end",
          dispatch: null,
          snapshot: {
            ...initialSnapshot(),
            text: "y".repeat(400),
            outputId: "synthetic-output",
            conversationId: f.conversationId,
            started: true,
            state: "completed",
          },
        };
        await f.coordinator.capture(end, sender, binding);
        await f.coordinator.settleConversationDisplays();
        assert.ok(
          f.displays.some(
            (d) =>
              d.activeContext === "800" && d.guidance.show && d.budget === 100,
          ),
        );
        f.displays.length = 0;
        let changed = false;
        const mutate = async () => {
          changed = true;
          const rows = await f.db.rows(scope.namespace);
          const parent = rows.find(
            (row) => row.record.kind === "request",
          )!.record;
          const attempt = rows.find(
            (row) => row.record.kind === "attempt",
          )!.record;
          if (change === "erase")
            await f.db.applyRange(
              scope,
              null,
              new Date(Date.now() + 10000).toISOString(),
              1,
            );
          else if (change === "correction")
            await f.db.commit(scope, [
              { ...parent, revision: parent.revision + 1 },
              { ...attempt, revision: attempt.revision + 1 },
            ]);
          else {
            const target = crypto.randomUUID();
            await f.db.commit(scope, [
              { ...parent, request_id: target, provider_request_key: null },
            ]);
            await f.db.markAlias(
              scope.namespace,
              "request",
              parent.request_id,
              target,
            );
          }
        };
        if (phase === "queue") {
          const original = f.db.application.pendingCount.bind(f.db.application);
          f.db.application.pendingCount = async (...args) => {
            const value = await original(...args);
            if (!changed) await mutate();
            return value;
          };
        } else {
          const original = f.db.publicationSnapshot.bind(f.db);
          let snapshots = 0;
          f.db.publicationSnapshot = async (...args) => {
            if (args[1] && ++snapshots === 2) await mutate();
            return original(...args);
          };
        }
        await f.coordinator.capture({ ...end, revision: 3 }, sender, binding);
        await f.coordinator.settleConversationDisplays();
        assert.equal(changed, true);
        assert.ok(f.displays.length > 0);
        for (const display of f.displays) {
          assert.equal(display.activeContext, null);
          assert.equal(display.budget, null);
          assert.equal(display.budgetBasis, null);
          assert.equal(display.state, "dispatch_only");
          assert.equal(display.guidance.show, false);
          assert.equal(display.guidance.ratio, null);
          assert.equal(display.guidance.key, null);
        }
      } finally {
        f.db.close();
      }
    });

async function countedCapture() {
  const f = await setup();
  (f.coordinator as any).dependencies.count = countByTextLength;
  f.dispatch.dispatch.input = "x".repeat(400);
  await f.db.put("policy", {
    ...(await f.db.get<any>("policy", "settings")),
    key: "settings",
    budget: 100,
    // The token trigger is off by default since 16 Oct 2026; these tests need its advice.
    contextTipTokens: true,
  });
  const binding = {
    documentNonce: crypto.randomUUID(),
    navigationNonce: crypto.randomUUID(),
    captureId: f.dispatch.id,
  };
  await f.coordinator.capture(f.dispatch, sender, binding);
  const end = {
    ...f.dispatch,
    revision: 2,
    event: "end",
    dispatch: null,
    snapshot: {
      ...initialSnapshot(),
      text: "y".repeat(400),
      outputId: "synthetic-output",
      conversationId: f.conversationId,
      started: true,
      state: "completed",
    },
  };
  await f.coordinator.capture(end, sender, binding);
  await f.coordinator.settleConversationDisplays();
  assert.equal(f.displays.at(-1).activeContext, "800");
  return { ...f, binding, end };
}

test("erasure immediately before the atomic derived write cannot recreate context or guidance", async () => {
  const f = await countedCapture();
  try {
    const scope = await f.coordinator.currentScope(),
      write = f.db.application.writeDerived.bind(f.db.application);
    let erased = false;
    f.db.application.writeDerived = async (...args) => {
      if (!erased) {
        erased = true;
        await f.db.applyRange(
          scope,
          null,
          new Date(Date.now() + 10000).toISOString(),
          1,
        );
      }
      return write(...args);
    };
    f.displays.length = 0;
    await f.coordinator.capture({ ...f.end, revision: 3 }, sender, f.binding);
    await f.coordinator.settleConversationDisplays();
    assert.equal(erased, true);
    assert.equal((await f.db.rows(scope.namespace)).length, 0);
    assert.equal((await f.db.all("context_snapshots")).length, 0);
    assert.equal((await f.db.all("guidance_preferences")).length, 0);
    assert.ok(
      f.displays.every(
        (d) => d.activeContext === null && d.guidance.show === false,
      ),
    );
  } finally {
    f.db.close();
  }
});

test("a parent erased after its cache read cannot bless a new recorded reconstruction", async () => {
  const f = await countedCapture();
  try {
    const scope = await f.coordinator.currentScope(),
      commit = f.db.commit.bind(f.db);
    // The half-open purge keeps a child exactly at the cutoff; no future start is needed.
    const childAt = new Date().toISOString();
    let erased = false;
    f.db.commit = async (...args) => {
      if (!erased && args[3]?.dependencies.length) {
        erased = true;
        await f.db.applyRange(scope, null, childAt, 1);
      }
      return commit(...args);
    };
    const child = {
      ...f.dispatch,
      id: crypto.randomUUID(),
      at: childAt,
      dispatch: {
        ...f.dispatch.dispatch,
        parentId: "synthetic-output",
        requestId: "synthetic-child",
      },
    };
    await f.coordinator.capture(child, sender, {
      ...f.binding,
      captureId: child.id,
    });
    await f.coordinator.capture(
      {
        ...f.end,
        id: child.id,
        revision: 2,
        snapshot: { ...f.end.snapshot, outputId: "synthetic-child-output" },
      },
      sender,
      { ...f.binding, captureId: child.id },
    );
    await f.coordinator.settleConversationDisplays();
    assert.equal(erased, true);
    const rows = await f.db.rows(scope.namespace);
    assert.equal(rows.length, 2);
    const attempt = rows.find((row) => row.record.kind === "attempt")!.record;
    assert.equal(attempt.kind, "attempt");
    if (attempt.kind !== "attempt") throw new Error("test_fixture");
    assert.equal(attempt.tokens.new_input_text.value, "400");
    assert.equal(attempt.tokens.answer_output.value, "400");
    assert.equal(attempt.tokens.logical_input_total.value, null);
    assert.equal((await f.db.all("context_snapshots")).length, 0);
    assert.equal(f.displays.at(-1).activeContext, null);
    assert.equal(f.displays.at(-1).guidance.show, false);
  } finally {
    f.db.close();
  }
});

for (const phase of ["commit", "derived_write"] as const)
  for (const action of ["dismiss", "snooze"] as const)
    test(`a visible ${action} at ${phase} survives an ordinary progress revision`, async () => {
      const f = await countedCapture();
      try {
        const key = f.displays.at(-1).guidance.key;
        let acted = false;
        const act = async () => {
          if (!acted) {
            acted = true;
            await f.coordinator[action](key);
          }
        };
        if (phase === "commit") {
          const original = f.db.commit.bind(f.db);
          f.db.commit = async (...args) => {
            if (args[3]) await act();
            return original(...args);
          };
        } else {
          const original = f.db.application.writeDerived.bind(f.db.application);
          f.db.application.writeDerived = async (...args) => {
            await act();
            return original(...args);
          };
        }
        await f.coordinator.capture(
          { ...f.end, revision: 3 },
          sender,
          f.binding,
        );
        await f.coordinator.settleConversationDisplays();
        assert.equal(acted, true);
        const last = f.displays.at(-1);
        assert.equal(last.activeContext, "800");
        assert.equal(last.guidance.key, key);
        assert.equal(last.guidance.show, false);
        if (action === "dismiss")
          assert.equal(last.guidance.state.dismissed, true);
        else assert.ok(last.guidance.state.snoozedUntil > Date.now());
      } finally {
        f.db.close();
      }
    });

test("late progress from A preserves newer B guidance while retaining A's distinct output cache", async () => {
  const f = await countedCapture();
  try {
    const next = {
      ...f.dispatch,
      id: crypto.randomUUID(),
      at: new Date(Date.now() + 1).toISOString(),
      dispatch: {
        ...f.dispatch.dispatch,
        requestId: "synthetic-follow-up",
        parentId: "synthetic-output",
      },
    };
    const nextBinding = { ...f.binding, captureId: next.id };
    await f.coordinator.capture(next, sender, nextBinding);
    await f.coordinator.capture(
      {
        ...f.end,
        id: next.id,
        snapshot: { ...f.end.snapshot, outputId: "synthetic-follow-up-output" },
      },
      sender,
      nextBinding,
    );
    await f.coordinator.settleConversationDisplays();
    const b = (await f.db.all<any>("guidance_preferences"))[0];
    await f.coordinator.dismiss(f.displays.at(-1).guidance.key);
    await f.coordinator.capture({ ...f.end, revision: 3 }, sender, f.binding);
    await f.coordinator.settleConversationDisplays();
    const current = (await f.db.all<any>("guidance_preferences"))[0];
    assert.deepEqual(current.source, b.source);
    assert.equal(current.value.state.dismissed, true);
    assert.equal((await f.db.all("context_snapshots")).length, 2);
  } finally {
    f.db.close();
  }
});

for (const phase of ["final_queue", "final_snapshot"] as const)
  for (const action of ["dismiss", "snooze"] as const)
    test(`authoritative ${action} at ${phase} prevents in-flight advice from reopening`, async () => {
      const f = await countedCapture();
      try {
        const key = f.displays.at(-1).guidance.key;
        f.displays.length = 0;
        let acted = false;
        const act = async () => {
          if (!acted) {
            acted = true;
            await f.coordinator[action](key);
          }
        };
        if (phase === "final_queue") {
          const original = f.db.application.pendingCount.bind(f.db.application);
          f.db.application.pendingCount = async (...args) => {
            const result = await original(...args);
            await act();
            return result;
          };
        } else {
          const original = f.db.publicationSnapshot.bind(f.db);
          f.db.publicationSnapshot = async (...args) => {
            if (args[2]) await act();
            return original(...args);
          };
        }
        await f.coordinator.capture(
          { ...f.end, revision: 3 },
          sender,
          f.binding,
        );
        await f.coordinator.settleConversationDisplays();
        assert.equal(acted, true);
        assert.ok(
          f.displays.length >= 2,
          "initial and refreshed publications are both checked",
        );
        for (const display of f.displays) {
          assert.equal(display.activeContext, "800");
          assert.equal(display.summary.requests, 1);
          assert.equal(display.guidance.key, key);
          assert.equal(display.guidance.show, false);
          if (action === "dismiss")
            assert.equal(display.guidance.state.dismissed, true);
          else assert.ok(display.guidance.state.snoozedUntil > Date.now());
        }
      } finally {
        f.db.close();
      }
    });

for (const tokens of [false, true])
  test(`the long-chat tip's token trigger ${tokens ? "shows when Tokens is on" : "stays hidden by default"}, and displays carry the request limit`, async () => {
    const f = await setup();
    try {
      const settings = (await f.db.get<any>("policy", "settings"))!;
      await f.db.put("policy", { ...settings, key: "settings", budget: 100 });
      if (tokens) await f.coordinator.updateSettings({ contextTipTokens: true, contextTipRequestLimit: 70 });
      else await f.coordinator.updateSettings({ contextTipRequests: false });
      (f.coordinator as any).dependencies.count = countByTextLength;
      f.dispatch.dispatch.input = "x".repeat(400);
      const binding = { documentNonce: crypto.randomUUID(), navigationNonce: crypto.randomUUID(), captureId: f.dispatch.id };
      await f.coordinator.capture(f.dispatch, sender, binding);
      await f.coordinator.settleConversationDisplays();
      const end = {
        ...f.dispatch,
        revision: 2,
        event: "end",
        dispatch: null,
        snapshot: { ...initialSnapshot(), text: "y".repeat(400), outputId: "synthetic-output", conversationId: f.conversationId, started: true, state: "completed" },
      };
      await f.coordinator.capture(end, sender, binding);
      await f.coordinator.settleConversationDisplays();
      const shown = f.displays.filter((d) => d.activeContext === "800" && d.budget === 100);
      assert.ok(shown.length > 0, "the context figures are published either way");
      if (tokens) assert.ok(shown.some((d) => d.guidance.show === true), "over half the budget: the token tip shows");
      else assert.ok(shown.every((d) => d.guidance.show === false), "Tokens off: the token tip stays hidden");
      assert.ok(
        f.displays.every((d) => d.tipRequestLimit === (tokens ? 70 : null)),
        "the page gets the Requests trigger, null while it is off",
      );
      const route = await f.coordinator.routeSummary("chatgpt", f.conversationId);
      assert.equal(route.tipRequestLimit, tokens ? 70 : null);
      await assert.rejects(f.coordinator.updateSettings({ contextTipTokens: "no" as never }), /long-chat tip/);
    } finally {
      f.db.close();
    }
  });
