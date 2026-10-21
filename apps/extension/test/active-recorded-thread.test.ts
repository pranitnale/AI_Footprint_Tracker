import { archivedEstimation, settleStartup } from "./archived-engine-fixture";
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { Ledger } from "@footprint/ledger";
import { countWithBundledTokenizer } from "./counting-fixture";
import {
  initialSnapshot,
  parseDispatch,
  parsePerplexityHistory,
  THREAD_HISTORY_CHANNEL,
} from "@footprint/adapters";
import { matchesDisplayContext } from "@footprint/capture-core";
import { Coordinator } from "../lib/coordinator";
import {
  hmacIdentity,
  transitionOwnership,
  type OwnershipHistory,
} from "../lib/ownership";

async function setup() {
  const db = await Ledger.open("active-thread-" + crypto.randomUUID());
  const displays: any[] = [];
  const calls: string[] = [];
  let consent = true;
  const c = new Coordinator(db, {
    estimation: archivedEstimation,
    hasConsent: async () => true,
    hasSiteConsent: async () => consent,
    count: countWithBundledTokenizer,
    sendDisplay: async (_, display) => {
      displays.push(display);
    },
    transport: (async (url: any) => {
      calls.push(String(url));
      throw new Error("synthetic offline");
    }) as typeof fetch,
  });
  await settleStartup(c);
  const scope = await c.currentScope();
  const secret = (await db.get<any>("policy", "personal"))!.secret;
  const route = crypto.randomUUID();
  const sender = {
    tab: { id: 57 },
    frameId: 0,
    documentId: "synthetic-active-document",
    url: "https://www.perplexity.ai/search/" + route,
  };
  const binding = {
    documentNonce: crypto.randomUUID(),
    navigationNonce: crypto.randomUUID(),
    captureId: null as string | null,
  };
  async function capture(
    frontend = crypto.randomUUID(),
    otherSender = sender,
    otherBinding = binding,
    // A follow-up names the reply it continues; each reply has its own id.
    reply: { parent?: string; output?: string; ended?: () => Promise<void> } = {},
  ) {
    const id = crypto.randomUUID();
    const b = { ...otherBinding, captureId: id };
    const dispatch = parseDispatch(
      "perplexity",
      new URL("https://www.perplexity.ai/rest/sse/perplexity_ask"),
      JSON.stringify({
        query_str: "Synthetic input",
        params: {
          frontend_uuid: frontend,
          ...(reply.parent ? { last_backend_uuid: reply.parent } : {}),
          attachments: [],
          model_preference: "synthetic-unmapped",
        },
      }),
    )!;
    const start: any = {
      channel: "ai-footprint-observation-v1",
      version: 1,
      id,
      revision: 1,
      event: "dispatch",
      site: "perplexity",
      at: new Date().toISOString(),
      dispatch,
      snapshot: initialSnapshot(),
      failure: null,

      timing: null,
    };
    await c.capture(start, otherSender, b);
    await reply.ended?.();
    const end = {
      ...start,
      revision: 2,
      event: "end",
      dispatch: null,
      snapshot: {
        ...initialSnapshot(),
        started: true,
        state: "completed",
        text: "Synthetic answer.",
        outputId: reply.output ?? crypto.randomUUID(),
      },
    };
    await c.capture(end, otherSender, b);
    await c.settleConversationDisplays();
    return { frontend, id, binding: b, end };
  }
  function history(ids: string[], b = binding, threadId = route) {
    // Extra provider fields are intentionally never forwarded by the reviewed parser.
    const parsed = parsePerplexityHistory(
      {
        entries: ids.map((id) => ({
          frontend_uuid: id,
          uuid: id,
          thread_url_slug: threadId,
          backend_uuid: crypto.randomUUID(),
          context_uuid: crypto.randomUUID(),
          frontend_context_uuid: crypto.randomUUID(),
          read_write_token: "synthetic-private-marker",
          title: "synthetic-private-title",
          structured_answer_block_usages: ["not-numerical"],
        })),
        has_next_page: false,
        read_write_token: "synthetic-private-marker",
      },
      threadId,
    )!;
    const start: any = {
      channel: THREAD_HISTORY_CHANNEL,
      event: "start",
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      site: "perplexity",
      threadId,
      page: null,
    };
    return {
      start,
      page: { ...start, event: "page", page: parsed },
      binding: { ...b, captureId: null },
    };
  }
  async function observe(
    ids: string[],
    b = binding,
    s = sender,
    threadId = route,
  ) {
    const h = history(ids, b, threadId);
    await c.threads.receive(h.start, h.binding, s);
    await c.threads.receive(h.page, h.binding, s);
    await c.settleConversationDisplays();
  }
  const promoted = () =>
    displays.filter(
      (d) =>
        d.conversationIdentity?.site === "perplexity" &&
        d.displayBinding?.captureId,
    );
  async function connect() {
    const companyId = crypto.randomUUID(),
      userId = crypto.randomUUID(),
      era = crypto.randomUUID();
    const credentials: any = {
      key: "credentials",
      namespace: `company:${companyId}:${userId}`,
      company_id: companyId,
      user_id: userId,
      device_id: crypto.randomUUID(),
      origin: "https://company.example",
      access_token: "test-only-access",
      refresh_token: "test-only-refresh",
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
    const history = (await db.get<OwnershipHistory>(
      "policy",
      "ownership-history",
    ))!;
    await db.policyTransaction([
      credentials,
      transitionOwnership(history, {
        scope: { namespace: credentials.namespace, mode: "company", era },
        secret: credentials.user_hmac_key,
        policyVersion: "1.0.0",
      }) as any,
    ]);
    return credentials;
  }
  return {
    db,
    c,
    scope,
    secret,
    sender,
    binding,
    route,
    displays,
    calls,
    capture,
    history,
    observe,
    promoted,
    connect,
    revoke: () => {
      consent = false;
    },
  };
}

test("verified GET promotes the original active request with matched thread totals and unchanged observations", async () => {
  const f = await setup();
  const historyKeys: Array<string | undefined> = [];
  const localHistory = f.c.history.localView.bind(f.c.history);
  f.c.history.localView = async (scope, conversation, filters) => {
    historyKeys.push(conversation);
    return localHistory(scope, conversation, filters);
  };
  try {
    const a = await f.capture(),
      b = await f.capture();
    assert.equal(f.displays.at(-1).conversationIdentity, null);
    assert.deepEqual(
      historyKeys,
      [],
      "unproven captures must not query route history using their provisional key",
    );
    const guidanceKey = f.displays.at(-1).guidance.key;
    assert.equal(typeof guidanceKey, "string");
    await f.c.dismiss(guidanceKey);
    const before = JSON.stringify([
      await f.db.all("requests"),
      await f.db.all("attempts"),
    ]);
    await f.observe([a.frontend, b.frontend]);
    const display = f.promoted().at(-1);
    assert.ok(display);
    const relations = await f.db.all<any>("thread_relations");
    assert.ok(historyKeys.length > 0);
    assert.ok(historyKeys.every((key) => key === relations[0].threadKey));
    assert.equal(display.history.local.status, "empty");
    assert.equal(display.summary.requests, 2);
    assert.equal(display.displayBinding.captureId, b.id);
    assert.equal(display.conversationIdentity.conversationId, f.route);
    assert.equal(display.recordedThread.providerHistoryComplete, false);
    assert.equal(display.guidance.key, guidanceKey);
    assert.equal(display.guidance.state.dismissed, true);
    assert.equal(display.guidance.show, false);
    assert.equal(display.summary.metrics.energy.value !== null, true);
    assert.equal(
      matchesDisplayContext(
        display.displayBinding,
        display.conversationIdentity,
        {
          ...f.binding,
          selectedCaptureId: b.id,
          route: { site: "perplexity", conversationId: f.route },
        },
      ),
      true,
    );
    assert.equal(
      JSON.stringify([await f.db.all("requests"), await f.db.all("attempts")]),
      before,
    );
    const storage = JSON.stringify([
      await f.db.all("thread_relations"),
      await f.db.all("provider_key_map"),
      await f.db.all("outbox"),
    ]);
    for (const forbidden of [
      "read_write_token",
      "synthetic-private-marker",
      "synthetic-private-title",
      a.frontend,
      b.frontend,
      f.route,
    ])
      assert.equal(storage.includes(forbidden), false, forbidden);
    assert.equal(
      JSON.stringify(f.displays).includes("synthetic-private-marker"),
      false,
    );
    const totals = display.summary;
    await f.c.capture({ ...b.end, revision: 3 }, f.sender, b.binding);
    await f.c.settleConversationDisplays();
    assert.equal(f.promoted().at(-1).summary.requests, 2);
    assert.deepEqual(f.promoted().at(-1).summary.metrics, totals.metrics);
    await f.observe([a.frontend, b.frontend]);
    assert.equal((await f.db.all("requests")).length, 2);
    assert.equal((await f.db.all("attempts")).length, 2);
    assert.equal(f.calls.length, 0);
  } finally {
    f.db.close();
  }
});

test("unmatched history and another capture's membership cannot promote the selected request", async () => {
  const f = await setup();
  try {
    const a = await f.capture(),
      b = await f.capture();
    await f.observe([a.frontend, crypto.randomUUID()]);
    assert.equal(f.promoted().length, 0);
    assert.equal((await f.db.all("requests")).length, 2);
    await f.observe([b.frontend]);
    assert.equal(f.promoted().at(-1).displayBinding.captureId, b.id);
    assert.equal(f.promoted().at(-1).summary.requests, 2);
  } finally {
    f.db.close();
  }
});

for (const boundary of [
  "navigation",
  "document",
  "tab",
  "pause",
  "pause_resume",
  "permission",
  "erase",
  "scope",
] as const) {
  test(`verified history cannot promote across ${boundary}`, async () => {
    const f = await setup();
    try {
      const a = await f.capture();
      const h = f.history([a.frontend]);
      await f.c.threads.receive(h.start, h.binding, f.sender);
      if (boundary === "navigation")
        f.c.invalidateDisplay(f.sender.tab.id, f.binding.documentNonce);
      if (boundary === "pause") await f.c.updateSettings({ paused: true });
      if (boundary === "pause_resume") {
        await f.c.updateSettings({ paused: true });
        await f.c.updateSettings({ paused: false });
      }
      if (boundary === "permission") f.revoke();
      if (boundary === "erase")
        await f.db.applyRange(
          f.scope,
          null,
          new Date(Date.now() + 1000).toISOString(),
          1,
        );
      if (boundary === "scope") {
        const ownership = (await f.db.get<OwnershipHistory>(
          "policy",
          "ownership-history",
        ))!;
        await f.db.policyTransaction([
          {
            key: "personal",
            namespace: "personal:" + crypto.randomUUID(),
            secret: "e".repeat(64),
          },
          transitionOwnership(ownership, {
            scope: {
              namespace: "personal:" + crypto.randomUUID(),
              mode: "personal",
              era: null,
            },
            secret: "e".repeat(64),
            policyVersion: "1.0.0",
          }) as any,
        ]);
      }
      const sender =
        boundary === "document"
          ? { ...f.sender, documentId: "other-document" }
          : boundary === "tab"
            ? { ...f.sender, tab: { id: 58 } }
            : f.sender;
      await f.c.threads.receive(h.page, h.binding, sender).catch(() => {});
      await f.c.settleConversationDisplays();
      assert.equal(f.promoted().length, 0);
    } finally {
      f.db.close();
    }
  });
}

for (const boundary of [
  "erase",
  "reject",
  "alias",
  "correction",
  "navigation",
  "permission",
  "pause",
] as const) {
  test(`active thread publication discards ${boundary} during its final queue await`, async () => {
    const f = await setup();
    try {
      const a = await f.capture();
      const pendingCount = f.db.application.pendingCount.bind(f.db.application);
      let changed = false;
      f.db.application.pendingCount = async (...args) => {
        const value = await pendingCount(...args);
        if (!changed) {
          changed = true;
          if (boundary === "erase")
            await f.db.applyRange(
              f.scope,
              null,
              new Date(Date.now() + 1000).toISOString(),
              1,
            );
          if (boundary === "navigation")
            f.c.invalidateDisplay(f.sender.tab.id, f.binding.documentNonce);
          if (boundary === "permission") f.revoke();
          if (boundary === "pause") await f.c.updateSettings({ paused: true });
          if (boundary === "correction") {
            const row = (await f.db.all<any>("requests"))[0];
            await f.db.commit(f.scope, [
              { ...row.record, revision: row.record.revision + 1 },
            ]);
          }
          if (boundary === "reject") {
            const key = await hmacIdentity(
              f.secret,
              "perplexity",
              "request",
              a.frontend,
            );
            const link = (await f.db.all<any>("thread_relations"))[0];
            await f.db.put("thread_relations", { ...link, rejected: true });
            assert.equal(link.providerRequestKey, key);
          }
          if (boundary === "alias") {
            const row = (await f.db.all<any>("requests"))[0];
            const target = crypto.randomUUID();
            await f.db.commit(f.scope, [
              { ...row.record, request_id: target, provider_request_key: null },
            ]);
            await f.db.markAlias(
              f.scope.namespace,
              "request",
              row.record.request_id,
              target,
            );
          }
        }
        return value;
      };
      await f.observe([a.frontend]);
      assert.equal(changed, true);
      assert.equal(f.promoted().length, 0);
    } finally {
      f.db.close();
    }
  });
}

test("GET arriving during first publication retries with the verified subset, without an identity-labelled provisional subtotal", async () => {
  const f = await setup();
  try {
    const frontend = crypto.randomUUID();
    const pendingCount = f.db.application.pendingCount.bind(f.db.application);
    let observed = false;
    f.db.application.pendingCount = async (...args) => {
      const value = await pendingCount(...args);
      if (!observed) {
        observed = true;
        const h = f.history([frontend]);
        await f.c.threads.receive(h.start, h.binding, f.sender);
        await f.c.threads.receive(h.page, h.binding, f.sender);
      }
      return value;
    };
    const a = await f.capture(frontend);
    assert.equal(observed, true);
    assert.ok(f.promoted().length);
    assert.ok(
      f
        .promoted()
        .every((d) => d.recordedThread && d.displayBinding.captureId === a.id),
    );
  } finally {
    f.db.close();
  }
});

test("verified-thread refresh retries a real engine promotion at its final queue await", async (t) => {
  const f = await setup();
  try {
    const a = await f.capture();
    const pending = f.db.application.pendingCount.bind(f.db.application);
    let changed = false;
    t.mock.method(
      f.db.application,
      "pendingCount",
      async (...args: Parameters<typeof pending>) => {
        const count = await pending(...args);
        if (!changed) {
          changed = true;
          const state = await f.db.application.estimation.readPreferenceState();
          assert.equal(state.status, "valid");
          if (state.status !== "valid")
            assert.fail("Missing engine preference");
          assert.equal(
            await f.db.application.estimation.compareAndSetPreference(
              state.revision,
              {
                schema_version: "1.0.0",
                preference: "ecologits",
                selection_revision: state.revision + 1,
                updated_at: new Date().toISOString(),
              },
            ),
            true,
          );
          await f.c.engines.maintainLocal();
        }
        return count;
      },
    );
    await f.observe([a.frontend]);
    assert.equal(changed, true);
    const emitted = f.promoted();
    assert.equal(emitted.length, 1);
    assert.equal(
      emitted[0].summary.calculation.methodHash,
      f.c.engines.methods.ecologits.method_hash,
    );
    assert.equal(emitted[0].summary.calculation.pending, false);
    assert.equal(emitted[0].displayBinding.captureId, a.id);
  } finally {
    f.c.engines.dispose();
    f.db.close();
  }
});

test("active publication retries a real engine promotion during its recorded-thread scan", async (t) => {
  const f = await setup();
  try {
    const a = await f.capture();
    await f.observe([a.frontend]);
    const start = f.displays.length;
    const scan = f.db.application.scanAttempts.bind(f.db.application);
    const threadView = f.c.threads.view.bind(f.c.threads);
    let inThread = false,
      promoted = false,
      reads = 0;
    t.mock.method(
      f.c.threads,
      "view",
      async (...args: Parameters<typeof threadView>) => {
        reads++;
        inThread = true;
        try {
          return await threadView(...args);
        } finally {
          inThread = false;
        }
      },
    );
    t.mock.method(
      f.db.application,
      "scanAttempts",
      async (...args: Parameters<typeof scan>) => {
        await scan(...args);
        if (!inThread || promoted) return;
        promoted = true;
        const state = await f.db.application.estimation.readPreferenceState();
        assert.equal(state.status, "valid");
        if (state.status !== "valid") assert.fail("Missing engine preference");
        assert.equal(
          await f.db.application.estimation.compareAndSetPreference(
            state.revision,
            {
              schema_version: "1.0.0",
              preference: "ecologits",
              selection_revision: state.revision + 1,
              updated_at: new Date().toISOString(),
            },
          ),
          true,
        );
        await f.c.engines.maintainLocal();
      },
    );
    await f.c.capture({ ...a.end, revision: 3 }, f.sender, a.binding);
    assert.equal(promoted, true);
    assert.ok(reads >= 2 && reads <= 3, `Recorded view attempts: ${reads}`);
    const emitted = f.displays.slice(start);
    assert.equal(emitted.length, 1);
    assert.equal(
      emitted[0].summary.calculation.methodHash,
      f.c.engines.methods.ecologits.method_hash,
    );
    assert.equal(emitted[0].summary.calculation.pending, false);
    assert.equal(emitted[0].recordedThread.status, "matched_recorded_subset");
    assert.equal(emitted[0].displayBinding.captureId, a.id);
  } finally {
    f.c.engines.dispose();
    f.db.close();
  }
});

for (const boundary of ["engine", "erase", "scope"] as const) {
  test(`active publication rechecks ${boundary} after awaiting retry recovery`, async (t) => {
    const f = await setup();
    try {
      const a = await f.capture();
      await f.observe([a.frontend]);
      const start = f.displays.length;
      const threadView = f.c.threads.view.bind(f.c.threads);
      const maintain = f.c.engines.maintainLocal.bind(f.c.engines);
      let failed = false,
        recovering = false,
        changes = 0;
      t.mock.method(
        f.c.threads,
        "view",
        async (...args: Parameters<typeof threadView>) => {
          if (!failed) {
            failed = true;
            recovering = true;
            throw new Error("aggregate_inconsistent");
          }
          return threadView(...args);
        },
      );
      t.mock.method(f.c.engines, "maintainLocal", async () => {
        if (recovering) {
          recovering = false;
          changes++;
          if (boundary === "engine") {
            const state =
              await f.db.application.estimation.readPreferenceState();
            assert.equal(state.status, "valid");
            if (state.status !== "valid")
              assert.fail("Missing engine preference");
            assert.equal(
              await f.db.application.estimation.compareAndSetPreference(
                state.revision,
                {
                  schema_version: "1.0.0",
                  preference: "ecologits",
                  selection_revision: state.revision + 1,
                  updated_at: new Date().toISOString(),
                },
              ),
              true,
            );
          } else if (boundary === "erase") {
            let requestId: string | undefined;
            await f.db.application.scanRequests(
              f.scope.namespace,
              async (rows) => {
                const request = rows.find(
                  (row) => row.record.kind === "request",
                )?.record;
                if (request?.kind === "request") requestId = request.request_id;
              },
            );
            assert.ok(requestId);
            await f.db.application.eraseFamily(f.scope.namespace, requestId);
          } else {
            const ownership = (await f.db.application.readOwnershipHistory())!;
            const personal = {
              namespace: `personal:${crypto.randomUUID()}`,
              secret: "e".repeat(64),
            };
            await f.db.application.applySessionChanges({
              personal,
              ownershipHistory: transitionOwnership(ownership, {
                scope: {
                  namespace: personal.namespace,
                  mode: "personal",
                  era: null,
                },
                secret: personal.secret,
                policyVersion: "1.0.0",
              }),
            });
          }
        }
        await maintain();
        if (boundary === "engine" && changes > 0) {
          // The assertion concerns the selected engine, not a maintenance time budget.
          for (let attempt = 0; attempt < 20; attempt++) {
            const state = await f.c.engines.status();
            if (state.local.status === "complete" && state.local.pending === 0)
              break;
            assert.notEqual(state.local.status, "failed");
            await maintain();
          }
          assert.equal((await f.c.engines.status()).local.status, "complete");
        }
      });
      await f.c.capture({ ...a.end, revision: 3 }, f.sender, a.binding);
      assert.equal(changes, 1);
      const emitted = f.displays.slice(start);
      if (boundary === "engine") {
        assert.equal(emitted.length, 1);
        assert.equal(
          emitted[0].summary.calculation.methodHash,
          f.c.engines.methods.ecologits.method_hash,
        );
      } else assert.equal(emitted.length, 0);
    } finally {
      f.c.engines.dispose();
      f.db.close();
    }
  });
}

// The display republish normally runs after the next calculation publishes.
async function republishPending(c: Coordinator) {
  (c as any).calculationDirty = true;
  (c as any).wakeFileDisplays();
  await c.settleConversationDisplays();
}

test("persistent publication conflicts resolve the saved capture, keep health visible and retry the display", async (t) => {
  const f = await setup();
  try {
    const a = await f.capture();
    await f.observe([a.frontend]);
    const start = f.displays.length;
    let reads = 0;
    const view = t.mock.method(f.c.threads, "view", async () => {
      reads++;
      throw new Error("aggregate_inconsistent");
    });
    // The observation is saved, so a display conflict is not a lost capture.
    assert.equal(
      await f.c.capture({ ...a.end, revision: 3 }, f.sender, a.binding),
      "processed",
    );
    assert.equal(reads, 3);
    assert.equal(f.displays.length, start);
    const attempts: unknown[] = [];
    await f.db.application.scanAttempts(f.scope.namespace, async (rows) => {
      attempts.push(...rows);
    });
    assert.equal(attempts.length, 1);
    assert.ok(
      (await f.c.trackingHealth()).health.some(
        (row) => row.code === "estimate_unavailable",
      ),
    );
    view.mock.restore();
    await republishPending(f.c);
    const shown = f.displays.slice(start);
    assert.equal(shown.length, 1);
    assert.equal(shown[0].target, "footprint-display");
    assert.equal(shown[0].displayBinding.captureId, a.binding.captureId);
    await republishPending(f.c);
    assert.equal(f.displays.length, start + 1, "a settled display is not rebuilt again");
  } finally {
    f.c.engines.dispose();
    f.db.close();
  }
});

test("a display that keeps conflicting sends one stale notice after three retries", async (t) => {
  const f = await setup();
  try {
    const a = await f.capture();
    await f.observe([a.frontend]);
    const start = f.displays.length;
    t.mock.method(f.c.threads, "view", async () => {
      throw new Error("aggregate_inconsistent");
    });
    assert.equal(
      await f.c.capture({ ...a.end, revision: 3 }, f.sender, a.binding),
      "processed",
    );
    for (let retry = 0; retry < 4; retry++) await republishPending(f.c);
    const sent = f.displays.slice(start);
    assert.deepEqual(
      sent.map((message) => message.target),
      ["footprint-display-stale"],
    );
    assert.deepEqual(sent[0], {
      target: "footprint-display-stale",
      displayBinding: a.binding,
      conversationIdentity: null,
    });
  } finally {
    f.c.engines.dispose();
    f.db.close();
  }
});

test("publication does not retry or relabel a non-transient thread failure", async (t) => {
  const f = await setup();
  try {
    const a = await f.capture();
    await f.observe([a.frontend]);
    let reads = 0;
    t.mock.method(f.c.threads, "view", async () => {
      reads++;
      throw new Error("payload_rejected");
    });
    await assert.rejects(
      f.c.capture({ ...a.end, revision: 3 }, f.sender, a.binding),
      /payload_rejected/,
    );
    assert.equal(reads, 1);
  } finally {
    f.c.engines.dispose();
    f.db.close();
  }
});

test("company active thread keeps server, local and pending populations separate; slow server lookup cannot block capture ACK", async () => {
  const f = await setup();
  let release!: () => void;
  try {
    const credentials = await f.connect();
    const a = await f.capture(),
      b = await f.capture();
    const scope = await f.c.currentScope();
    const rows = await f.db.pending(scope.namespace);
    // A real ACK removes exactly the first recorded request family from the pending subset.
    const first = (await f.db.all<any>("requests"))[0].record.request_id;
    const attempts = new Set(
      (await f.db.all<any>("attempts"))
        .filter((row) => row.record.request_id === first)
        .map((row) => row.record.attempt_id),
    );
    const firstRows = rows.filter(
      (row) => row.id === first || attempts.has(row.id),
    );
    await f.db.acknowledge(
      scope.namespace,
      crypto.randomUUID(),
      firstRows.map((row) => ({
        kind: row.kind,
        id: row.id,
        revision: row.revision,
        payload_hash: row.hash,
        server_record_version: row.revision,
        status: "applied" as const,
      })),
      firstRows,
    );
    let delayed = false;
    const hold = new Promise<void>((done) => {
      release = done;
    });
    (f.c.company as any).transport = async (url: string, init: any) => {
      if (url.includes("/v1/me/thread-relations")) {
        const body = JSON.parse(init.body);
        return new Response(
          JSON.stringify({
            ...body,
            source: undefined,
            provider_request_keys: undefined,
            results: body.provider_request_keys.map(
              (provider_request_key: string) => ({
                provider_request_key,
                status: "linked",
              }),
            ),
          }),
        );
      }
      if (url.includes("/recorded-threads/")) {
        if (delayed) await hold;
        const key = new URL(url).pathname.split("/").at(-2);
        return new Response(
          JSON.stringify({
            site: "perplexity",
            key_version: "1",
            thread_key: key,
            deletion_epoch: 0,
            status: "matched_recorded_subset",
            coverage: {
              scope: "matched_recorded_requests",
              provider_history_complete: false,
              matched_request_count: "9",
            },
            summary: {
              aggregate_status: "current",
              request_count: "9",
              attempt_count: "9",
              tokens: [],
              resources: [],
            },
          }),
        );
      }
      throw new Error("synthetic offline usage");
    };
    await f.observe([a.frontend, b.frontend]);
    const current = f.promoted().at(-1);
    assert.equal(current.summary.requests, 2);
    assert.equal(current.conversation.pending.requests, 1);
    assert.equal(current.conversation.server.request_count, "9");
    assert.equal(current.mode, "company");
    assert.equal(current.displayBinding.captureId, b.id);
    delayed = true;
    await f.c.capture({ ...b.end, revision: 3 }, f.sender, b.binding);
    assert.equal(f.promoted().at(-1).summary.requests, 2);
    release();
    await f.c.settleConversationDisplays();
    assert.equal(f.promoted().at(-1).conversation.server.request_count, "9");
    assert.equal(credentials.namespace, scope.namespace);
  } finally {
    release?.();
    await f.c.settleConversationDisplays();
    f.db.close();
  }
});

test("history strict DTO rejects capability fields and parser rejects wrong route/request equalities", async () => {
  const f = await setup();
  try {
    const a = await f.capture();
    for (const row of [
      {
        frontend_uuid: a.frontend,
        uuid: crypto.randomUUID(),
        thread_url_slug: f.route,
      },
      {
        frontend_uuid: a.frontend,
        uuid: a.frontend,
        thread_url_slug: crypto.randomUUID(),
      },
      { frontend_uuid: null, uuid: a.frontend, thread_url_slug: f.route },
    ])
      assert.equal(
        parsePerplexityHistory(
          { entries: [row], has_next_page: false },
          f.route,
        ),
        null,
      );
    const h = f.history([a.frontend]);
    await assert.rejects(
      f.c.threads.receive(
        { ...h.start, read_write_token: "synthetic-private-marker" } as any,
        h.binding,
        f.sender,
      ),
      /payload_rejected/,
    );
    await f.c.threads.receive(h.start, h.binding, f.sender);
    await assert.rejects(
      f.c.threads.receive(
        {
          ...h.page,
          page: {
            ...h.page.page,
            read_write_token: "synthetic-private-marker",
          },
        } as any,
        h.binding,
        f.sender,
      ),
      /payload_rejected/,
    );
    assert.equal((await f.db.all("thread_relations")).length, 0);
    assert.equal(f.promoted().length, 0);
  } finally {
    f.db.close();
  }
});

test("a Perplexity follow-up joins the open thread when it is sent, once the reply it names is in the thread, and its reply counts live (owner, 5 Oct 2026)", async () => {
  const f = await setup();
  try {
    const shown = (id: string) =>
      f.promoted().filter((d) => d.displayBinding.captureId === id);
    // The thread's first answer has the thread's id; the page's read links it.
    const opening = await f.capture(undefined, f.sender, f.binding, {
      output: f.route,
    });
    await f.observe([opening.frontend]);
    assert.equal(shown(opening.id).at(-1).summary.requests, 1);
    const before = JSON.stringify([
      await f.db.all("requests"),
      await f.db.all("attempts"),
    ]);
    // A follow-up of the first answer: from its send the bar shows the thread with the new
    // request while the reply runs, as on other sites, without another read of the thread.
    const second = crypto.randomUUID(),
      secondReply = crypto.randomUUID();
    let running: any = null;
    const follow = await f.capture(second, f.sender, f.binding, {
      parent: f.route,
      output: secondReply,
      ended: async () => {
        await f.c.settleConversationDisplays();
        running = f
          .promoted()
          .filter((d) => d.displayBinding.captureId !== opening.id)
          .at(-1);
      },
    });
    assert.ok(running);
    // The send is shown before its reply starts, as on other sites.
    assert.equal(running.state, "dispatch_only");
    assert.equal(running.conversationIdentity.conversationId, f.route);
    assert.equal(running.summary.requests, 2);
    const joined = shown(follow.id).at(-1);
    assert.ok(joined);
    assert.equal(joined.conversationIdentity.conversationId, f.route);
    assert.equal(joined.summary.requests, 2);
    // A follow-up of that reply joins through the reply's own link.
    const third = await f.capture(undefined, f.sender, f.binding, {
      parent: secondReply,
      output: crypto.randomUUID(),
    });
    assert.equal(shown(third.id).at(-1).summary.requests, 3);
    // A reply that is not in this thread proves nothing.
    const stray = await f.capture(undefined, f.sender, f.binding, {
      parent: crypto.randomUUID(),
    });
    assert.equal(shown(stray.id).length, 0);
    // Nor does a reply of this thread for a send from another thread's page.
    const elsewhere = crypto.randomUUID();
    const other = await f.capture(
      undefined,
      { ...f.sender, url: "https://www.perplexity.ai/search/" + elsewhere },
      f.binding,
      { parent: secondReply },
    );
    assert.equal(shown(other.id).length, 0);
    // The first answer of a thread nothing here has read or recorded has the thread's id,
    // so a follow-up of it joins that thread.
    const unseen = await f.capture(
      undefined,
      { ...f.sender, url: "https://www.perplexity.ai/search/" + elsewhere },
      f.binding,
      { parent: elsewhere },
    );
    const fresh = shown(unseen.id).at(-1);
    assert.equal(fresh.conversationIdentity.conversationId, elsewhere);
    assert.equal(fresh.summary.requests, 1);
    const relations = await f.db.all<any>("thread_relations");
    assert.equal(relations.length, 4);
    assert.equal(new Set(relations.map((row) => row.threadKey)).size, 2);
    // Linking adds no usage and changes no observation.
    const after = JSON.parse(
      JSON.stringify([await f.db.all("requests"), await f.db.all("attempts")]),
    );
    const earlier = JSON.parse(before);
    for (const [index, rows] of earlier.entries())
      for (const row of rows)
        assert.deepEqual(
          after[index].find((value: any) => value.key === row.key),
          row,
        );
    assert.equal(f.calls.length, 0);
  } finally {
    f.db.close();
  }
});

test("a Perplexity follow-up joins the thread the browser says the tab shows after in-page navigation", async () => {
  const f = await setup();
  try {
    const shown = (id: string) =>
      f.promoted().filter((d) => d.displayBinding.captureId === id);
    const opening = await f.capture(undefined, f.sender, f.binding, {
      output: f.route,
    });
    await f.observe([opening.frontend]);
    // The sender keeps the address the page loaded at (seen 5 Oct 2026).
    const home = { ...f.sender, url: "https://www.perplexity.ai/" };
    const unnoted = await f.capture(undefined, home, f.binding, {
      parent: f.route,
    });
    assert.equal(shown(unnoted.id).length, 0);
    f.c.noteTabAddress(57, "https://www.perplexity.ai/search/" + f.route);
    const follow = await f.capture(undefined, home, f.binding, {
      parent: f.route,
    });
    const joined = shown(follow.id).at(-1);
    assert.equal(joined.conversationIdentity.conversationId, f.route);
    // The browser's address wins over the sender's, also when it names no thread.
    f.c.noteTabAddress(57, "https://www.perplexity.ai/library");
    const away = await f.capture(undefined, f.sender, f.binding, {
      parent: f.route,
    });
    assert.equal(shown(away.id).length, 0);
    f.c.noteTabAddress(
      57,
      "https://www.perplexity.ai/search/" + crypto.randomUUID(),
    );
    const other = await f.capture(undefined, f.sender, f.binding, {
      parent: f.route,
    });
    assert.equal(shown(other.id).length, 0);
    // Another tab's address says nothing about this one.
    f.c.noteTabAddress(58, "https://www.perplexity.ai/search/" + f.route);
    const elsewhere = await f.capture(
      undefined,
      { ...home, tab: { id: 59 } },
      f.binding,
      { parent: f.route },
    );
    assert.equal(shown(elsewhere.id).length, 0);
  } finally {
    f.db.close();
  }
});

test("a Perplexity follow-up whose link fails when it is sent is linked again when its reply ends", async () => {
  const f = await setup();
  try {
    const opening = await f.capture(undefined, f.sender, f.binding, {
      output: f.route,
    });
    await f.observe([opening.frontend]);
    const threads = f.c.threads as any;
    const link = threads.linkLiveReply.bind(threads);
    let calls = 0;
    threads.linkLiveReply = (input: any) =>
      ++calls === 1
        ? Promise.reject(new Error("synthetic ledger failure"))
        : link(input);
    let running: any[] = [];
    const follow = await f.capture(undefined, f.sender, f.binding, {
      parent: f.route,
      ended: async () => {
        await f.c.settleConversationDisplays();
        running = f
          .promoted()
          .filter((d) => d.displayBinding.captureId !== opening.id);
      },
    });
    // The failed link left the reply off the thread while it ran, and said so.
    assert.equal(running.length, 0);
    assert.ok(
      (await f.db.all<any>("health")).some((row) =>
        JSON.stringify(row).includes("sync_delayed"),
      ),
    );
    assert.equal(calls, 2);
    const joined = f
      .promoted()
      .filter((d) => d.displayBinding.captureId === follow.id)
      .at(-1);
    assert.equal(joined.conversationIdentity.conversationId, f.route);
    assert.equal(joined.summary.requests, 2);
  } finally {
    f.db.close();
  }
});

test("a Perplexity reply that was linked when sent rejoins its thread after a worker restart", async () => {
  const f = await setup();
  const restarted: any[] = [];
  let worker: Coordinator | null = null;
  try {
    const opening = await f.capture(undefined, f.sender, f.binding, {
      output: f.route,
    });
    await f.observe([opening.frontend]);
    // A follow-up is sent and linked; then the worker restarts before its reply ends.
    const id = crypto.randomUUID();
    const b = { ...f.binding, captureId: id };
    const start: any = {
      channel: "ai-footprint-observation-v1",
      version: 1,
      id,
      revision: 1,
      event: "dispatch",
      site: "perplexity",
      at: new Date().toISOString(),
      dispatch: parseDispatch(
        "perplexity",
        new URL("https://www.perplexity.ai/rest/sse/perplexity_ask"),
        JSON.stringify({
          query_str: "Synthetic input",
          params: {
            frontend_uuid: crypto.randomUUID(),
            last_backend_uuid: f.route,
            attachments: [],
            model_preference: "synthetic-unmapped",
          },
        }),
      )!,
      snapshot: initialSnapshot(),
      failure: null,
      timing: null,
    };
    await f.c.capture(start, f.sender, b);
    await f.c.settleConversationDisplays();
    worker = new Coordinator(f.db, {
      estimation: archivedEstimation,
      hasConsent: async () => true,
      hasSiteConsent: async () => true,
      count: countWithBundledTokenizer,
      sendDisplay: async (_, display) => {
        restarted.push(display);
      },
      transport: (async () => {
        throw new Error("synthetic offline");
      }) as typeof fetch,
    });
    await worker.whenReady();
    const end = (outputId: string, revision: number): any => ({
      ...start,
      revision,
      event: "end",
      dispatch: null,
      snapshot: {
        ...initialSnapshot(),
        started: true,
        state: "completed",
        text: "Synthetic answer.",
        outputId,
      },
    });
    await worker.capture(end(crypto.randomUUID(), 2), f.sender, b);
    await worker.settleConversationDisplays();
    const shown = restarted.filter(
      (d) => d.displayBinding?.captureId === id && d.conversationIdentity,
    );
    assert.equal(shown.at(-1)?.conversationIdentity.conversationId, f.route);
    assert.equal(shown.at(-1)?.summary.requests, 2);
    // A recovered reply on a thread it was never linked to stays off it.
    const other = crypto.randomUUID();
    const strayId = crypto.randomUUID();
    const stray = { ...f.binding, captureId: strayId };
    await worker.capture(
      { ...end(crypto.randomUUID(), 2), id: strayId },
      { ...f.sender, url: "https://www.perplexity.ai/search/" + other },
      stray,
    );
    await worker.settleConversationDisplays();
    assert.equal(
      restarted.filter(
        (d) => d.displayBinding?.captureId === strayId && d.conversationIdentity,
      ).length,
      0,
    );
  } finally {
    await worker?.settleConversationDisplays();
    worker?.engines.dispose();
    f.db.close();
  }
});

test("a new Perplexity thread's first answer joins the thread the tab opens at its id and counts live (owner, 5 Oct 2026)", async () => {
  const f = await setup();
  try {
    const home = { ...f.sender, url: "https://www.perplexity.ai/" };
    const shown = (id: string) =>
      f.promoted().filter((d) => d.displayBinding.captureId === id);
    // A send from the home page, with frames as the page reports them.
    async function send(threadId: string, from = home) {
      const id = crypto.randomUUID();
      const b = { ...f.binding, captureId: id };
      const start: any = {
        channel: "ai-footprint-observation-v1",
        version: 1,
        id,
        revision: 1,
        event: "dispatch",
        site: "perplexity",
        at: new Date().toISOString(),
        dispatch: parseDispatch(
          "perplexity",
          new URL("https://www.perplexity.ai/rest/sse/perplexity_ask"),
          JSON.stringify({
            query_str: "Synthetic input",
            params: {
              frontend_uuid: crypto.randomUUID(),
              attachments: [],
              model_preference: "synthetic-unmapped",
            },
          }),
        )!,
        snapshot: initialSnapshot(),
        failure: null,
        timing: null,
      };
      await f.c.capture(start, from, b);
      const frame = (revision: number, done: boolean): any => ({
        ...start,
        revision,
        event: done ? "end" : "progress",
        dispatch: null,
        snapshot: {
          ...initialSnapshot(),
          started: true,
          state: done ? "completed" : "generating",
          text: done ? "Synthetic answer, now complete." : "Synthetic",
          outputId: threadId,
        },
      });
      const settle = () => f.c.settleConversationDisplays();
      return {
        id,
        progress: async () => {
          await f.c.capture(frame(2, false), from, b);
          await settle();
        },
        end: async () => {
          await f.c.capture(frame(3, true), from, b);
          await settle();
        },
        open: async (route: string, tabId = 57, documentId = home.documentId) => {
          await f.c.noteThreadRoute(tabId, documentId, route);
          await settle();
        },
      };
    }
    // The page opens the thread before the reply's id arrives: the reply joins with its
    // first frame that names it, while it still streams.
    const early = crypto.randomUUID();
    const a = await send(early);
    await a.open(early);
    assert.equal(shown(a.id).length, 0);
    await a.progress();
    const running = shown(a.id).at(-1);
    assert.ok(running);
    assert.equal(running.state, "generating");
    assert.equal(running.conversationIdentity.conversationId, early);
    assert.equal(running.summary.requests, 1);
    await a.end();
    assert.equal(shown(a.id).at(-1).summary.requests, 1);
    assert.equal(shown(a.id).at(-1).conversationIdentity.conversationId, early);
    // The reply's id arrives first and the page then opens the thread.
    const late = crypto.randomUUID();
    const b = await send(late);
    await b.progress();
    assert.equal(shown(b.id).length, 0);
    await b.open(late);
    assert.equal(shown(b.id).at(-1).conversationIdentity.conversationId, late);
    await b.end();
    assert.equal(shown(b.id).at(-1).summary.requests, 1);
    // A thread whose id is not the reply's proves nothing, nor does the reply's own thread
    // opened in another tab or page.
    const unopened = crypto.randomUUID();
    const c = await send(unopened);
    await c.open(crypto.randomUUID());
    await c.progress();
    await c.open(unopened, 58);
    await c.open(unopened, 57, "another-document");
    await c.end();
    assert.equal(shown(c.id).length, 0);
    // The page can reach the new thread's address before the send is seen (5 Oct 2026):
    // the send names no earlier answer, so it still starts that thread.
    const raced = crypto.randomUUID();
    const page = (id: string) => ({
      ...home,
      url: "https://www.perplexity.ai/search/" + id,
    });
    const d = await send(raced, page(raced));
    await d.progress();
    assert.equal(shown(d.id).at(-1).conversationIdentity.conversationId, raced);
    await d.end();
    assert.equal(shown(d.id).at(-1).summary.requests, 1);
    // The address of another thread proves nothing for it.
    const e = await send(crypto.randomUUID(), page(crypto.randomUUID()));
    await e.progress();
    await e.end();
    assert.equal(shown(e.id).length, 0);
    const relations = await f.db.all<any>("thread_relations");
    assert.equal(relations.length, 3);
    const keys = await Promise.all(
      [early, late, raced].map((id) =>
        hmacIdentity(f.secret, "perplexity", "route", id),
      ),
    );
    assert.deepEqual(
      relations.map((row) => row.threadKey).sort(),
      [...keys].sort(),
    );
    // A follow-up in the new thread joins it through the first answer.
    const follow = await f.capture(
      undefined,
      { ...f.sender, url: "https://www.perplexity.ai/search/" + early },
      f.binding,
      { parent: early },
    );
    assert.equal(shown(follow.id).at(-1).summary.requests, 2);
    assert.equal(f.calls.length, 0);
  } finally {
    f.db.close();
  }
});

// Each thread summary read returns a higher server count, so a display shows which read
// it came from. Saved totals change during one read, or after it answers but before its
// display is built; neither read may be shown, and the thread is read again.
for (const during of [true, false])
  test(`company mode: a Perplexity thread read is made again when saved totals change ${during ? "during it" : "before its display"}`, async () => {
    const f = await setup();
    try {
      const credentials = await f.connect();
      let reads = 0,
        changeOn = 0,
        changed = 0;
      const invalidate = async () => {
        const key = `epoch:${credentials.namespace}`;
        const epoch = await f.db.get<any>("dashboard_cache", key);
        await f.db.put("dashboard_cache", {
          ...epoch,
          key,
          namespace: credentials.namespace,
          version: (epoch?.version ?? 0) + 1,
        });
      };
      (f.c.company as any).transport = async (url: string, init: any) => {
        if (url.includes("/v1/me/thread-relations")) {
          const body = JSON.parse(init.body);
          return new Response(
            JSON.stringify({
              ...body,
              source: undefined,
              provider_request_keys: undefined,
              results: body.provider_request_keys.map(
                (provider_request_key: string) => ({
                  provider_request_key,
                  status: "linked",
                }),
              ),
            }),
          );
        }
        if (url.includes("/recorded-threads/")) {
          const read = ++reads;
          if (during && read === changeOn) {
            changed = read;
            await invalidate();
          }
          const count = String(read);
          return new Response(
            JSON.stringify({
              site: "perplexity",
              key_version: "1",
              thread_key: new URL(url).pathname.split("/").at(-2),
              deletion_epoch: 0,
              status: "matched_recorded_subset",
              coverage: {
                scope: "matched_recorded_requests",
                provider_history_complete: false,
                matched_request_count: count,
              },
              summary: {
                aggregate_status: "current",
                request_count: count,
                attempt_count: count,
                tokens: [],
                resources: [],
              },
            }),
          );
        }
        throw new Error("synthetic offline usage");
      };
      const opening = await f.capture(undefined, f.sender, f.binding, {
        output: f.route,
      });
      await f.observe([opening.frontend]);
      const follow = await f.capture(undefined, f.sender, f.binding, {
        parent: f.route,
      });
      await f.c.settleConversationDisplays();
      // A later commit to the thread, as when a reply's output reaches the saved thread,
      // refreshes the display; its read is the one the change overlaps.
      if (!during) {
        // The local view is read once per display attempt, after the server read.
        const history = f.c.history as any;
        const localView = history.localView.bind(history);
        history.localView = async (...args: any[]) => {
          if (changeOn && !changed && reads >= changeOn) {
            changed = reads;
            await invalidate();
          }
          return localView(...args);
        };
      }
      changeOn = reads + 1;
      const threadKey = (await f.db.all<any>("thread_relations"))[0].threadKey;
      (f.c as any).refreshFileDisplays(
        await f.c.currentScope(),
        threadKey,
        threadKey,
      );
      await f.c.settleConversationDisplays();
      assert.ok(changed > 0);
      // Exactly one more read follows the one the change overlapped.
      assert.equal(reads, changed + 1);
      const shown = f
        .promoted()
        .filter((d) => d.displayBinding.captureId === follow.id);
      assert.ok(
        !shown.some(
          (d) => d.conversation?.server?.request_count === String(changed),
        ),
      );
      const last = shown.at(-1);
      assert.equal(last.conversationIdentity.conversationId, f.route);
      assert.equal(last.conversation.server.request_count, String(reads));
    } finally {
      await f.c.settleConversationDisplays();
      f.db.close();
    }
  });

test("company mode: a Perplexity follow-up's live link goes to the server like a page read's, one request at a time", async () => {
  const f = await setup();
  try {
    await f.connect();
    const linked: string[][] = [];
    (f.c.company as any).transport = async (url: string, init: any) => {
      if (url.includes("/v1/me/thread-relations")) {
        const body = JSON.parse(init.body);
        linked.push(body.provider_request_keys);
        return new Response(
          JSON.stringify({
            ...body,
            source: undefined,
            provider_request_keys: undefined,
            results: body.provider_request_keys.map(
              (provider_request_key: string) => ({
                provider_request_key,
                status: "linked",
              }),
            ),
          }),
        );
      }
      throw new Error("synthetic offline usage");
    };
    const opening = await f.capture(undefined, f.sender, f.binding, {
      output: f.route,
    });
    await f.observe([opening.frontend]);
    // The first answer is linked live, as its id is the thread's, and again by the read.
    assert.equal(linked.length, 2);
    const follow = await f.capture(undefined, f.sender, f.binding, {
      parent: f.route,
    });
    assert.equal(linked.length, 3);
    const requests = await f.db.all<any>("requests");
    const followKey = requests.find(
      (row) => row.record.dispatched_at === follow.end.at,
    )!.record.provider_request_key;
    assert.deepEqual(linked[2], [followKey]);
    // The server confirmed it, so nothing waits to be sent again.
    const relation = (await f.db.all<any>("thread_relations")).find(
      (row) => row.providerRequestKey === followKey,
    );
    assert.equal(relation.pending, 0);
    const shown = f.promoted().filter(
      (d) => d.displayBinding.captureId === follow.id,
    );
    assert.equal(shown.at(-1).mode, "company");
    assert.equal(shown.at(-1).conversationIdentity.conversationId, f.route);
  } finally {
    await f.c.settleConversationDisplays();
    f.db.close();
  }
});
