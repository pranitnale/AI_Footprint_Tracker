import { archivedEstimation } from "./archived-engine-fixture";
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { unavailableCount } from "./counting-fixture";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Ledger, type Scope } from "@footprint/ledger";
import {
  THREAD_HISTORY_CHANNEL,
  type ThreadHistoryMessage,
} from "@footprint/adapters";
import { Coordinator } from "../lib/coordinator";
import { emptyHistorySummary } from "@footprint/estimator";
import {
  hmacIdentity,
  transitionOwnership,
  type OwnershipHistory,
} from "../lib/ownership";
import { records } from "../../../packages/ledger/test/factory";
import { pythonReference } from "../../../tools/python-reference.cjs";
const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../../../fixtures/provider-identity-2026-09-10.json",
      import.meta.url,
    ),
    "utf8",
  ),
).perplexity;
const threadId = fixture.route.split("/").at(-1)!;
const sender = {
  tab: { id: 21 },
  frameId: 0,
  documentId: "synthetic-document",
  url: "https://www.perplexity.ai" + fixture.route,
};
async function setup() {
  const name = "thread-test-" + crypto.randomUUID(),
    db = await Ledger.open(name);
  const calls: { url: string; body: any; authorization: string | null }[] = [];
  let offline = false;
  const remoteKeys = new Set<string>();
  const c = new Coordinator(db, {
    estimation: archivedEstimation,
    hasConsent: async () => true,
    count: unavailableCount,
    sendDisplay: async () => {},
    transport: (async (url: any, init: any) => {
      if (offline) throw new TypeError("Failed to fetch");
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({
        url: String(url),
        body,
        authorization: init.headers.Authorization,
      });
      const credentials = (await db.get<any>("policy", "credentials"))!;
      const key =
        body?.thread_key ?? new URL(String(url)).pathname.split("/").at(-2);
      const count = String(remoteKeys.size);
      return new Response(
        JSON.stringify(
          body
            ? {
                site: "perplexity",
                key_version: "1",
                thread_key: key,
                deletion_epoch: credentials.policy.deletion_epoch,
                results: body.provider_request_keys.map(
                  (provider_request_key: string) => ({
                    provider_request_key,
                    status: remoteKeys.has(provider_request_key)
                      ? "linked"
                      : "not_recorded",
                  }),
                ),
              }
            : {
                site: "perplexity",
                key_version: "1",
                thread_key: key,
                deletion_epoch: credentials.policy.deletion_epoch,
                status: remoteKeys.size
                  ? "matched_recorded_subset"
                  : "unavailable",
                coverage: {
                  scope: "matched_recorded_requests",
                  provider_history_complete: false,
                  matched_request_count: count,
                },
                summary: remoteKeys.size
                  ? {
                      aggregate_status: "current",
                      request_count: count,
                      attempt_count: count,
                      tokens: [],
                      resources: [],
                    }
                  : null,
              },
        ),
      );
    }) as typeof fetch,
  });
  await c.whenReady();
  const personal = await c.currentScope(),
    secret = (await db.get<any>("policy", "personal"))!.secret;
  async function connect() {
    const company = crypto.randomUUID(),
      user = crypto.randomUUID(),
      era = crypto.randomUUID();
    const scope: Scope = {
      namespace: `company:${company}:${user}`,
      mode: "company",
      era,
    };
    const credentials: any = {
      key: "credentials",
      namespace: scope.namespace,
      company_id: company,
      user_id: user,
      device_id: crypto.randomUUID(),
      user_hmac_key: "e".repeat(64),
      access_token: "test-only-access",
      refresh_token: "test-refresh",
      origin: "https://company.example",
      access_expires_at: new Date(Date.now() + 600000).toISOString(),
      enrollment_era: { id: era, start: new Date().toISOString(), end: null },
      policy: {
        policy_version: "1.0.0",
        deletion_epoch: 0,
        pause_mode: "user_controlled",
      },
    };
    const history = (await db.get<OwnershipHistory>(
      "policy",
      "ownership-history",
    ))!;
    await db.policyTransaction([
      credentials,
      transitionOwnership(history, {
        scope,
        secret: credentials.user_hmac_key,
        policyVersion: "1.0.0",
      }) as any,
    ]);
    return { scope, credentials, secret: credentials.user_hmac_key };
  }
  async function seed(
    scope: Scope,
    secret: string,
    frontend = fixture.entries[0].frontend_uuid,
    occurrence?: string,
  ) {
    const pair = records();
    if (occurrence) {
      pair[0].dispatched_at = occurrence;
      pair[1].started_at = occurrence;
    }
    pair[0].site = "perplexity";
    pair[0].provider_request_key = await hmacIdentity(
      secret,
      "perplexity",
      "request",
      frontend,
    );
    pair[0].conversation_key = await hmacIdentity(
      secret,
      "perplexity",
      "conversation",
      "provisional-request:" + frontend,
    );
    await db.commit(scope, pair);
    return pair;
  }
  function history(
    ids = fixture.entries.map((entry: any) => entry.frontend_uuid),
    hasNextPage = false,
  ) {
    const binding = {
      documentNonce: crypto.randomUUID(),
      navigationNonce: crypto.randomUUID(),
      captureId: null,
    };
    const start: ThreadHistoryMessage = {
      channel: THREAD_HISTORY_CHANNEL,
      event: "start",
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      site: "perplexity",
      threadId,
      page: null,
    };
    const page: ThreadHistoryMessage = {
      ...start,
      event: "page",
      page: { requestIds: ids, hasNextPage },
    };
    return { binding, start, page };
  }
  return {
    name,
    db,
    c,
    calls,
    remoteKeys,
    personal,
    secret,
    connect,
    seed,
    history,
    setOffline: () => {
      offline = true;
    },
    setOnline: () => {
      offline = false;
    },
  };
}
test("route invalidation after reading relation versions prevents late thread association", async () => {
  const f = await setup();
  let valid = true;
  const guard = {
    check: () => {
      if (!valid) throw new Error("partial_capture");
    },
    verify: async () => {
      guard.check();
    },
  };
  try {
    await f.seed(f.personal, f.secret);
    const event = f.history();
    await f.c.threads.receive(event.start, event.binding, sender, guard);
    const versions = f.db.application.threadRelationVersions.bind(
      f.db.application,
    );
    f.db.application.threadRelationVersions = async (...args) => {
      const result = await versions(...args);
      valid = false;
      return result;
    };
    await assert.rejects(
      f.c.threads.receive(event.page, event.binding, sender, guard),
      /partial_capture/,
    );
    assert.equal((await f.db.all("thread_relations")).length, 0);
  } finally {
    f.db.close();
  }
});
test("thread relation transaction aborts if route authority expires before its write", async () => {
  const f = await setup();
  try {
    const pair = await f.seed(f.personal, f.secret);
    const key = await hmacIdentity(f.secret, "perplexity", "route", threadId);
    let checks = 0;
    await assert.rejects(
      f.db.linkRecordedThread(
        f.personal,
        key,
        [pair[0].provider_request_key!],
        0,
        undefined,
        () => {
          if (++checks === 2) throw new Error("partial_capture");
        },
      ),
      /partial_capture/,
    );
    assert.equal((await f.db.all("thread_relations")).length, 0);
  } finally {
    f.db.close();
  }
});
test("personal thread links match only already recorded requests, preserve hashes, and reopen after restart with incomplete coverage", async () => {
  const f = await setup();
  try {
    const empty = f.history();
    await f.c.threads.receive(empty.start, empty.binding, sender);
    await f.c.threads.receive(empty.page, empty.binding, sender);
    assert.equal((await f.db.rows(f.personal.namespace)).length, 0);
    assert.equal((await f.db.all("thread_relations")).length, 0);
    await f.seed(f.personal, f.secret);
    const before = await f.db.rows(f.personal.namespace),
      event = f.history();
    await f.c.threads.receive(event.start, event.binding, sender);
    await f.c.threads.receive(event.page, event.binding, sender);
    const result = await f.c.routeSummary(
      "perplexity",
      threadId,
      event.binding,
    );
    assert.equal(result.summary.requests, 1);
    assert.equal(result.recordedThread!.unmatchedPageRequests, 5);
    assert.equal(result.recordedThread!.providerHistoryComplete, false);
    assert.deepEqual(await f.db.rows(f.personal.namespace), before);
    assert.equal((await f.db.all("outbox")).length, 0);
    assert.equal(f.calls.length, 0);
    const links = await f.db.all<any>("thread_relations");
    assert.equal(links.length, 1);
    assert.equal(links[0].pending, 0);
    const persisted = JSON.stringify([...links, ...before]);
    for (const entry of fixture.entries)
      assert.ok(!persisted.includes(entry.frontend_uuid));
    assert.ok(!persisted.includes(threadId));
    f.db.close();
    const restored = await Ledger.open(f.name),
      c = new Coordinator(restored, {
    estimation: archivedEstimation,
        hasConsent: async () => true,
        count: unavailableCount,
        sendDisplay: async () => {},
        transport: (() => {
          throw new Error("personal network forbidden");
        }) as any,
      });
    try {
      const reopened = await c.routeSummary(
        "perplexity",
        threadId,
        event.binding,
      );
      assert.equal(reopened.summary.requests, 1);
      assert.equal(reopened.recordedThread!.observedPageRequests, null);
      assert.equal(
        reopened.recordedThread!.coverageAfterRestart,
        "saved_links_only",
      );
      await assert.rejects(
        c.threads.receive(event.page, event.binding, sender),
      );
    } finally {
      restored.close();
    }
  } finally {
    f.db.close();
  }
});
test("pre-Connect history retains personal ownership and never contributes personal records to company", async () => {
  const f = await setup();
  try {
    await f.seed(f.personal, f.secret);
    const event = f.history();
    await f.c.threads.receive(event.start, event.binding, sender);
    const company = await f.connect();
    await f.seed(company.scope, company.secret);
    await f.c.threads.receive(event.page, event.binding, sender);
    assert.equal(f.calls.length, 0);
    const links = await f.db.all<any>("thread_relations");
    assert.equal(links.length, 1);
    assert.equal(links[0].namespace, f.personal.namespace);
    const view = await f.c.routeSummary("perplexity", threadId, event.binding);
    assert.equal(view.mode, "company");
    assert.equal(view.summary.requests, 0);
    assert.equal((await f.db.pending(company.scope.namespace)).length, 2);
  } finally {
    f.db.close();
  }
});
test("another paired browser uses existing own server records with no fabricated local history rows", async () => {
  const f = await setup();
  try {
    const company = await f.connect();
    for (const entry of fixture.entries.slice(0, 2))
      f.remoteKeys.add(
        await hmacIdentity(
          company.secret,
          "perplexity",
          "request",
          entry.frontend_uuid,
        ),
      );
    const event = f.history();
    await f.c.threads.receive(event.start, event.binding, sender);
    await f.c.threads.receive(event.page, event.binding, sender);
    const view = await f.c.routeSummary("perplexity", threadId, event.binding);
    assert.equal(view.summary.requests, 0);
    assert.equal(view.conversation.server!.request_count, "2");
    assert.equal(view.recordedThread!.unmatchedPageRequests, 4);
    assert.equal(view.recordedThread!.providerHistoryComplete, false);
    assert.equal((await f.db.rows(company.scope.namespace)).length, 0);
    assert.equal((await f.db.all("thread_relations")).length, 0);
    const sent = f.calls.find((call) => call.body)!.body;
    assert.equal(
      sent.thread_key,
      await hmacIdentity(company.secret, "perplexity", "route", threadId),
    );
    assert.ok(!JSON.stringify(sent).includes(threadId));
    assert.deepEqual(Object.keys(sent).sort(), [
      "deletion_epoch",
      "key_version",
      "provider_request_keys",
      "site",
      "source",
      "thread_key",
    ]);
  } finally {
    f.db.close();
  }
});
test("offline company saves only matched numerical-record links and waits for the request ACK", async () => {
  const f = await setup();
  try {
    const company = await f.connect();
    await f.seed(company.scope, company.secret);
    f.setOffline();
    const event = f.history();
    await f.c.threads.receive(event.start, event.binding, sender);
    await f.c.threads.receive(event.page, event.binding, sender);
    assert.equal((await f.db.all<any>("thread_relations")).length, 1);
    assert.equal(
      (await f.db.pendingThreadLinks(company.scope.namespace)).length,
      0,
    );
    const outbox = await f.db.pending(company.scope.namespace);
    await f.db.acknowledge(
      company.scope.namespace,
      crypto.randomUUID(),
      outbox.map((row) => ({
        kind: row.kind,
        id: row.id,
        revision: row.revision,
        payload_hash: row.hash,
        server_record_version: row.revision,
        status: "applied",
      })),
      outbox,
    );
    assert.equal(
      (await f.db.pendingThreadLinks(company.scope.namespace)).length,
      1,
    );
    const view = await f.c.routeSummary("perplexity", threadId, event.binding);
    assert.equal(view.summary.requests, 1);
    assert.equal(view.conversation.server, null);
    assert.equal(view.conversation.offline, true);
  } finally {
    f.db.close();
  }
});
test("range erasure between history phases rejects resurrection and deletion removes existing links", async () => {
  const f = await setup();
  try {
    await f.seed(f.personal, f.secret);
    const event = f.history();
    await f.c.threads.receive(event.start, event.binding, sender);
    await f.db.applyRange(
      f.personal,
      null,
      new Date(Date.now() + 1000).toISOString(),
      1,
    );
    await assert.rejects(
      f.c.threads.receive(event.page, event.binding, sender),
      /deletion_in_progress/,
    );
    assert.equal((await f.db.all("thread_relations")).length, 0);
    const fresh = await f.seed(
      f.personal,
      f.secret,
      fixture.entries[1].frontend_uuid,
      new Date(Date.now() + 10000).toISOString(),
    );
    // The fixture's retained occurrence lies after this test's purge range.
    const next = f.history();
    await f.c.threads.receive(next.start, next.binding, sender);
    await f.c.threads.receive(next.page, next.binding, sender);
    assert.equal((await f.db.all("thread_relations")).length, 1);
    await f.db.eraseFamily(f.personal.namespace, fresh[0].request_id);
    assert.equal((await f.db.all("thread_relations")).length, 0);
  } finally {
    f.db.close();
  }
});
test("wrong navigation/document results and conflicting thread assignment never create an alternate relation", async () => {
  const f = await setup();
  try {
    await f.seed(f.personal, f.secret);
    const event = f.history();
    await f.c.threads.receive(event.start, event.binding, sender);
    await assert.rejects(
      f.c.threads.receive(
        event.page,
        { ...event.binding, navigationNonce: crypto.randomUUID() },
        sender,
      ),
    );
    const valid = f.history();
    await f.c.threads.receive(valid.start, valid.binding, sender);
    await f.c.threads.receive(valid.page, valid.binding, sender);
    const other = f.history();
    other.start.threadId = other.page.threadId = crypto.randomUUID();
    await f.c.threads.receive(other.start, other.binding, sender);
    await assert.rejects(
      f.c.threads.receive(other.page, other.binding, sender),
      /thread_relation_conflict/,
    );
    assert.equal((await f.db.all("thread_relations")).length, 1);
  } finally {
    f.db.close();
  }
});

test("canonical alias and revision reconciliation preserve one thread contribution without editing observation identities", async () => {
  const f = await setup();
  try {
    const first = await f.seed(f.personal, f.secret),
      event = f.history();
    await f.c.threads.receive(event.start, event.binding, sender);
    await f.c.threads.receive(event.page, event.binding, sender);
    const other = await f.seed(
      f.personal,
      f.secret,
      fixture.entries[0].frontend_uuid,
      "2020-01-01T00:00:00.000Z",
    );
    await f.db.coalesceProviderIdentity(
      f.personal.namespace,
      "request",
      first[0].provider_request_key!,
    );
    let view = await f.c.routeSummary("perplexity", threadId, event.binding);
    assert.equal(view.summary.requests, 1);
    assert.equal(view.summary.attempts, 1);
    assert.equal(
      (await f.db.all<any>("thread_relations"))[0].requestId,
      other[0].request_id,
    );
    const corrected = {
      ...other[0],
      revision: 2,
      conversation_key: "f".repeat(64),
    };
    await f.db.commit(f.personal, [corrected]);
    view = await f.c.routeSummary("perplexity", threadId, event.binding);
    assert.equal(view.summary.requests, 1);
    const canonical = (await f.db.getRecord(
      f.personal.namespace,
      "request",
      other[0].request_id,
    ))!.record;
    const original = (await f.db.getRecord(
      f.personal.namespace,
      "request",
      first[0].request_id,
    ))!.record;
    assert.equal(canonical.kind, "request");
    assert.equal(original.kind, "request");
    if (canonical.kind !== "request" || original.kind !== "request")
      throw new Error("test_fixture");
    assert.equal(canonical.conversation_key, "f".repeat(64));
    assert.equal(original.conversation_key, first[0].conversation_key);
    await f.db.eraseFamily(f.personal.namespace, other[0].request_id);
    assert.equal((await f.db.all("thread_relations")).length, 0);
    assert.equal(
      (await f.c.routeSummary("perplexity", threadId, event.binding)).summary
        .requests,
      0,
    );
  } finally {
    f.db.close();
  }
});

test("a tenant switch inside the final permission check never sends old-scope keys with new credentials", async () => {
  const f = await setup();
  try {
    const company = await f.connect();
    let changed = false;
    (f.c.company as any).hasConsent = async () => {
      if (!changed) {
        changed = true;
        await f.connect();
      }
      return true;
    };
    await assert.rejects(
      f.c.company.linkThread(
        company.scope,
        "a".repeat(64),
        ["b".repeat(64)],
        0,
      ),
      /policy_unavailable/,
    );
    assert.equal(changed, true);
    assert.equal(f.calls.length, 0);
    await assert.rejects(
      f.c.company.linkThread(
        company.scope,
        threadId,
        [fixture.entries[0].frontend_uuid],
        0,
      ),
      /payload_rejected/,
    );
    assert.equal(f.calls.length, 0);
  } finally {
    f.db.close();
  }
});

test("a late relation ACK cannot recreate a purged link and retry pages do not queue unknown keys", async () => {
  const f = await setup();
  try {
    const company = await f.connect(),
      pair = await f.seed(company.scope, company.secret);
    f.setOffline();
    const event = f.history();
    await f.c.threads.receive(event.start, event.binding, sender);
    await f.c.threads.receive(event.page, event.binding, sender);
    const link = (await f.db.all<any>("thread_relations"))[0],
      before = await f.db.publicationSnapshot(company.scope.namespace);
    await f.db.eraseFamily(company.scope.namespace, pair[0].request_id);
    await f.db.acknowledgeThreadLinks(
      company.scope.namespace,
      link.threadKey,
      [{ provider_request_key: link.providerRequestKey, status: "linked" }],
      before.erasureVersion,
    );
    assert.equal((await f.db.all("thread_relations")).length, 0);
    const retry = f.history();
    await f.c.threads.receive(retry.start, retry.binding, sender);
    await f.c.threads.receive(retry.page, retry.binding, sender);
    assert.equal((await f.db.all("thread_relations")).length, 0);
    assert.equal((await f.db.rows(company.scope.namespace)).length, 0);
  } finally {
    f.db.close();
  }
});

test("remote conflict prevents a local first association instead of silently inventing alternate membership", async () => {
  const f = await setup();
  try {
    const company = await f.connect();
    await f.seed(company.scope, company.secret);
    (f.c.company as any).transport = async () =>
      new Response(
        JSON.stringify({ error: { code: "thread_relation_conflict" } }),
        { status: 409 },
      );
    const event = f.history();
    await f.c.threads.receive(event.start, event.binding, sender);
    await assert.rejects(
      f.c.threads.receive(event.page, event.binding, sender),
      /thread_relation_conflict/,
    );
    assert.equal((await f.db.all("thread_relations")).length, 0);
    assert.equal((await f.db.rows(company.scope.namespace)).length, 2);
  } finally {
    f.db.close();
  }
});

test("multiple bounded observed pages reopen a large recorded subset once without imposing a 100-request history cap", async () => {
  const f = await setup();
  try {
    const ids: string[] = [];
    for (let i = 0; i < 250; i++) {
      const id = crypto.randomUUID();
      ids.push(id);
      await f.seed(f.personal, f.secret, id);
    }
    for (let offset = 0; offset < ids.length; offset += 100) {
      const event = f.history(
        ids.slice(offset, offset + 100),
        offset + 100 < ids.length,
      );
      await f.c.threads.receive(event.start, event.binding, sender);
      await f.c.threads.receive(event.page, event.binding, sender);
    }
    const replay = f.history(ids.slice(0, 100), true);
    await f.c.threads.receive(replay.start, replay.binding, sender);
    await f.c.threads.receive(replay.page, replay.binding, sender);
    let largest = 0;
    const scan = f.db.application.scanRequests.bind(f.db.application);
    f.db.application.scanRequests = async (namespace, consume, filter) =>
      scan(
        namespace,
        async (rows) => {
          largest = Math.max(largest, rows.length);
          await consume(rows);
        },
        filter,
      );
    const view = await f.c.routeSummary("perplexity", threadId, replay.binding);
    assert.equal(view.summary.requests, 250);
    assert.equal(view.summary.attempts, 250);
    assert.equal((await f.db.all("thread_relations")).length, 250);
    assert.ok(largest > 0 && largest <= 200);
    assert.equal(view.recordedThread!.observedPageRequests, 100);
    assert.equal(view.recordedThread!.providerHistoryComplete, false);
    assert.equal(f.calls.length, 0);
  } finally {
    f.db.close();
  }
});

test("one long Perplexity history page links all recorded requests in bounded groups", async () => {
  const f = await setup();
  try {
    const ids: string[] = [];
    for (let index = 0; index < 230; index++) {
      const requestId = crypto.randomUUID();
      ids.push(requestId);
      await f.seed(f.personal, f.secret, requestId);
    }
    const event = f.history(ids, false);
    await f.c.threads.receive(event.start, event.binding, sender);
    assert.deepEqual(
      await f.c.threads.receive(event.page, event.binding, sender),
      { observed: true },
    );
    const view = await f.c.routeSummary("perplexity", threadId, event.binding);
    assert.equal(view.summary.requests, 230);
    assert.equal(view.recordedThread!.observedPageRequests, 230);
    assert.equal(view.recordedThread!.unmatchedPageRequests, 0);
    assert.equal((await f.db.all("thread_relations")).length, 230);
  } finally {
    f.db.close();
  }
});

test("Perplexity route responses retry a tenant switch instead of relabeling another scope's local subset", async () => {
  const f = await setup();
  try {
    const a = await f.connect();
    await f.seed(a.scope, a.secret);
    const pageA = f.history();
    await f.c.threads.receive(pageA.start, pageA.binding, sender);
    await f.c.threads.receive(pageA.page, pageA.binding, sender);
    let switched = false;
    const read = f.c.company.threadRequest.bind(f.c.company);
    f.c.company.threadRequest = async (...args) => {
      const response = await read(...args);
      if (!switched && args[1].includes("/summary")) {
        switched = true;
        const b = await f.connect();
        await f.seed(b.scope, b.secret);
        await f.seed(b.scope, b.secret, fixture.entries[1].frontend_uuid);
        const key = await hmacIdentity(
          b.secret,
          "perplexity",
          "route",
          threadId,
        );
        const keys = await Promise.all(
          fixture.entries
            .slice(0, 2)
            .map((entry: any) =>
              hmacIdentity(
                b.secret,
                "perplexity",
                "request",
                entry.frontend_uuid,
              ),
            ),
        );
        await f.db.linkRecordedThread(b.scope, key, keys, 0);
      }
      return response;
    };
    const view = await f.c.routeSummary("perplexity", threadId, pageA.binding);
    assert.equal(switched, true);
    assert.equal(view.mode, "company");
    assert.equal(view.summary.requests, 2);
    assert.equal((await f.db.rows(a.scope.namespace)).length, 2);
  } finally {
    f.db.close();
  }
});

test("the extension consumes actual FastAPI paired-installation relation and summary responses", async () => {
  const reference = pythonReference(
    [
      "-c",
      `
import json, sys, tempfile
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0, str(Path('apps/server/tests').resolve()))
from conftest import setup, login, connect
from test_perplexity_identity import records_for, identity, statuses
from test_file_text_contract import mixed_upload
from test_thread_relations import link, summary, canonical_state
fixture=json.load(sys.stdin)
with tempfile.TemporaryDirectory(dir='apps/extension') as folder:
    # No pytest markers here, so the fixture's operator switches keep their defaults.
    no_markers=SimpleNamespace(node=SimpleNamespace(get_closest_marker=lambda _name: None))
    app,client,company,admin,now,settings=setup.__wrapped__(Path(folder),no_markers)
    login(app,client)
    first,_=connect(app,client)
    paired,_=connect(app,client)
    for entry in fixture['entries'][:2]:
        pair=records_for(first,now[0],entry['frontend_uuid'],entry['backend_uuid'])
        assert statuses(mixed_upload(client,first,list(pair))) == ['applied','applied']
    thread=identity(paired['user_hmac_key'],'route',fixture['route'].split('/')[-1])
    keys=[identity(paired['user_hmac_key'],'request',entry['frontend_uuid']) for entry in fixture['entries']]
    before=canonical_state(app)
    result=link(client,paired,thread,keys)
    assert result.status_code==200
    view=summary(client,paired,thread)
    assert canonical_state(app)==before
    print(json.dumps({'credentials':paired,'origin':company.data['origin'],'post':result.json(),'get':view}))
    client.close()
    app.state.db.engine.dispose()
`,
    ],
    { input: JSON.stringify(fixture), timeout: 60000 },
  );
  assert.equal(reference.status, 0, reference.stderr);
  const value = JSON.parse(reference.stdout);
  const db = await Ledger.open("thread-api-reference-" + crypto.randomUUID());
  const calls: { path: string; body: any }[] = [];
  const c = new Coordinator(db, {
    estimation: archivedEstimation,
    hasConsent: async () => true,
    count: unavailableCount,
    sendDisplay: async () => {},
    transport: (async (url: any, init: any) => {
      const body = init.body ? JSON.parse(init.body) : null;
      const path = new URL(url).pathname;
      calls.push({ path, body });
      if (path.startsWith("/v1/me/history/"))
        return new Response(
          JSON.stringify({
            history: emptyHistorySummary(),
            deletion_epoch: value.credentials.policy.deletion_epoch,
          }),
        );
      if (body) {
        assert.equal(body.thread_key, value.post.thread_key);
        assert.deepEqual(
          body.provider_request_keys,
          value.post.results.map((r: any) => r.provider_request_key),
        );
      }
      return new Response(JSON.stringify(body ? value.post : value.get));
    }) as typeof fetch,
  });
  try {
    await c.whenReady();
    const credentials = {
      ...value.credentials,
      key: "credentials",
      origin: value.origin,
      namespace: `company:${value.credentials.company_id}:${value.credentials.user_id}`,
      access_expires_at: new Date(Date.now() + 600000).toISOString(),
    };
    const scope: Scope = {
      namespace: credentials.namespace,
      mode: "company",
      era: credentials.enrollment_era.id,
    };
    const history = (await db.get<OwnershipHistory>(
      "policy",
      "ownership-history",
    ))!;
    await db.policyTransaction([
      credentials,
      transitionOwnership(history, {
        scope,
        secret: credentials.user_hmac_key,
        policyVersion: "1.0.0",
      }) as any,
    ]);
    const binding = {
      documentNonce: crypto.randomUUID(),
      navigationNonce: crypto.randomUUID(),
      captureId: null,
    };
    const start: ThreadHistoryMessage = {
      channel: THREAD_HISTORY_CHANNEL,
      event: "start",
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      site: "perplexity",
      threadId,
      page: null,
    };
    await c.threads.receive(start, binding, sender);
    await c.threads.receive(
      {
        ...start,
        event: "page",
        page: {
          requestIds: fixture.entries.map((e: any) => e.frontend_uuid),
          hasNextPage: false,
        },
      },
      binding,
      sender,
    );
    const result = await c.routeSummary("perplexity", threadId, binding);
    assert.equal(
      calls.filter((call) => !call.path.startsWith("/v1/me/history/")).length,
      2,
    );
    assert.equal(
      calls.filter((call) => call.path.startsWith("/v1/me/history/")).length,
      0,
    );
    assert.equal(result.history.server, null);
    assert.equal(result.history.local.status, "empty");
    assert.equal(result.summary.requests, 0);
    assert.equal(result.conversation.server!.request_count, "2");
    assert.equal(result.recordedThread!.unmatchedPageRequests, 4);
    assert.equal((await db.rows(scope.namespace)).length, 0);
    assert.equal((await db.all("thread_relations")).length, 0);
  } finally {
    db.close();
  }
});

test("confirmed conflict invalidates an earlier offline association and requires fresh positive confirmation after restart", async () => {
  const f = await setup();
  try {
    const company = await f.connect();
    await f.seed(company.scope, company.secret);
    f.setOffline();
    const event = f.history();
    await f.c.threads.receive(event.start, event.binding, sender);
    await f.c.threads.receive(event.page, event.binding, sender);
    assert.equal(
      (await f.c.routeSummary("perplexity", threadId, event.binding)).summary
        .requests,
      1,
    );
    const original = await f.db.rows(company.scope.namespace);
    (f.c.company as any).transport = async () =>
      new Response(
        JSON.stringify({ error: { code: "thread_relation_conflict" } }),
        { status: 409 },
      );
    const conflicting = f.history();
    await f.c.threads.receive(conflicting.start, conflicting.binding, sender);
    await assert.rejects(
      f.c.threads.receive(conflicting.page, conflicting.binding, sender),
      /thread_relation_conflict/,
    );
    const after = await f.c.routeSummary("perplexity", threadId, event.binding);
    assert.equal(after.summary.requests, 0);
    assert.equal(after.recordedThread!.status, "unavailable");
    assert.equal(after.recordedThread!.observedPageRequests, null);
    assert.deepEqual(await f.db.rows(company.scope.namespace), original);
    const marker = (await f.db.all<any>("thread_relations"))[0];
    assert.equal(marker.rejected, true);
    assert.equal(marker.pending, 0);
    f.db.close();
    const restored = await Ledger.open(f.name);
    try {
      const keys = [marker.providerRequestKey],
        epoch = (await restored.publicationSnapshot(company.scope.namespace))
          .erasureVersion;
      await assert.rejects(
        restored.linkRecordedThread(
          company.scope,
          marker.threadKey,
          keys,
          epoch,
        ),
        /thread_relation_conflict/,
      );
      const versions = await restored.threadRelationVersions(
        company.scope.namespace,
        keys,
      );
      await restored.linkRecordedThread(
        company.scope,
        marker.threadKey,
        keys,
        epoch,
        { keys, versions },
      );
      assert.equal(
        (await restored.all<any>("thread_relations"))[0].rejected,
        false,
      );
    } finally {
      restored.close();
    }
  } finally {
    f.db.close();
  }
});

test("a sync conflict invalidates only its attempted thread candidates and old ACK cannot reactivate them", async () => {
  const f = await setup();
  try {
    const company = await f.connect();
    await f.seed(company.scope, company.secret);
    f.setOffline();
    const event = f.history();
    await f.c.threads.receive(event.start, event.binding, sender);
    await f.c.threads.receive(event.page, event.binding, sender);
    const rows = await f.db.pending(company.scope.namespace);
    await f.db.acknowledge(
      company.scope.namespace,
      crypto.randomUUID(),
      rows.map((row) => ({
        kind: row.kind,
        id: row.id,
        revision: row.revision,
        payload_hash: row.hash,
        server_record_version: row.revision,
        status: "applied",
      })),
      rows,
    );
    const link = (await f.db.all<any>("thread_relations"))[0];
    (f.c.company as any).transport = async () =>
      new Response(
        JSON.stringify({ error: { code: "thread_relation_conflict" } }),
        { status: 409 },
      );
    await assert.rejects(
      (f.c.company as any).syncThreadRelations(company.credentials),
    );
    await f.db.acknowledgeThreadLinks(
      company.scope.namespace,
      link.threadKey,
      [{ provider_request_key: link.providerRequestKey, status: "linked" }],
      0,
    );
    assert.equal((await f.db.all<any>("thread_relations"))[0].rejected, true);
    assert.equal(
      (await f.c.routeSummary("perplexity", threadId, event.binding)).summary
        .requests,
      0,
    );
    assert.equal(
      (await f.c.routeSummary("perplexity", threadId, event.binding))
        .recordedThread!.observedPageRequests,
      null,
    );
  } finally {
    f.db.close();
  }
});

test("an older positive response cannot overwrite a later authoritative conflict", async () => {
  const f = await setup();
  try {
    const company = await f.connect();
    await f.seed(company.scope, company.secret);
    f.setOffline();
    const initial = f.history();
    await f.c.threads.receive(initial.start, initial.binding, sender);
    await f.c.threads.receive(initial.page, initial.binding, sender);
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
      }),
      entered = new Promise<void>((resolve) => {
        started = resolve;
      });
    let calls = 0;
    (f.c.company as any).transport = async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      if (++calls === 1) {
        started();
        await gate;
        return new Response(
          JSON.stringify({
            site: "perplexity",
            key_version: "1",
            thread_key: body.thread_key,
            deletion_epoch: 0,
            results: body.provider_request_keys.map((key: string) => ({
              provider_request_key: key,
              status: "linked",
            })),
          }),
        );
      }
      return new Response(
        JSON.stringify({ error: { code: "thread_relation_conflict" } }),
        { status: 409 },
      );
    };
    const old = f.history();
    await f.c.threads.receive(old.start, old.binding, sender);
    const work = f.c.threads.receive(old.page, old.binding, sender);
    await entered;
    const fresh = f.history();
    await f.c.threads.receive(fresh.start, fresh.binding, sender);
    await assert.rejects(
      f.c.threads.receive(fresh.page, fresh.binding, sender),
      /thread_relation_conflict/,
    );
    release();
    await assert.rejects(work, /thread_relation_conflict/);
    assert.equal((await f.db.all<any>("thread_relations"))[0].rejected, true);
  } finally {
    f.db.close();
  }
});

test("late conflict guards preserve a different enrollment and remove no unrelated thread", async () => {
  const f = await setup();
  try {
    const company = await f.connect();
    await f.seed(company.scope, company.secret);
    f.setOffline();
    const event = f.history();
    await f.c.threads.receive(event.start, event.binding, sender);
    await f.c.threads.receive(event.page, event.binding, sender);
    const link = (await f.db.all<any>("thread_relations"))[0];
    const next = await f.connect();
    await f.seed(next.scope, next.secret);
    assert.equal(
      await f.db.rejectThreadLinks(
        company.scope,
        link.threadKey,
        [link.providerRequestKey],
        { erasureVersion: 0, deviceId: company.credentials.device_id },
      ),
      false,
    );
    assert.equal((await f.db.all<any>("thread_relations"))[0].rejected, false);
    await f.db.eraseFamily(company.scope.namespace, link.requestId);
    assert.equal(
      await f.db.rejectThreadLinks(
        company.scope,
        link.threadKey,
        [link.providerRequestKey],
        { erasureVersion: 0, deviceId: company.credentials.device_id },
      ),
      false,
    );
    assert.equal((await f.db.all("thread_relations")).length, 0);
    assert.equal((await f.db.rows(next.scope.namespace)).length, 2);
  } finally {
    f.db.close();
  }
});

test("a delayed conflict after navigation invalidates only its candidate thread and preserves the new route", async () => {
  const f = await setup();
  try {
    const company = await f.connect();
    await f.seed(company.scope, company.secret);
    f.setOffline();
    const a = f.history([fixture.entries[0].frontend_uuid]);
    await f.c.threads.receive(a.start, a.binding, sender);
    await f.c.threads.receive(a.page, a.binding, sender);
    await f.seed(
      company.scope,
      company.secret,
      fixture.entries[1].frontend_uuid,
    );
    const b = f.history([fixture.entries[1].frontend_uuid]),
      otherThread = crypto.randomUUID();
    b.start.threadId = b.page.threadId = otherThread;
    await f.c.threads.receive(b.start, b.binding, sender);
    await f.c.threads.receive(b.page, b.binding, sender);
    const observations = await f.db.rows(company.scope.namespace);
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
      }),
      entered = new Promise<void>((resolve) => {
        started = resolve;
      });
    (f.c.company as any).transport = async () => {
      started();
      await gate;
      return new Response(
        JSON.stringify({ error: { code: "thread_relation_conflict" } }),
        { status: 409 },
      );
    };
    const retry = f.history([fixture.entries[0].frontend_uuid]);
    await f.c.threads.receive(retry.start, retry.binding, sender);
    let cleanupDone!: () => void;
    const cleaned = new Promise<void>((resolve) => {
      cleanupDone = resolve;
    });
    const reject = f.db.application.rejectThreadLinks.bind(f.db.application);
    f.db.application.rejectThreadLinks = async (...args) => {
      const result = await reject(...args);
      cleanupDone();
      return result;
    };
    const work = f.c.threads.receive(retry.page, retry.binding, sender);
    const cancelled = assert.rejects(work, /history_unavailable/);
    await entered;
    f.c.invalidateDisplay(sender.tab.id, retry.binding.documentNonce);
    release();
    await cancelled;
    await cleaned;
    const view = await f.c.routeSummary("perplexity", otherThread, b.binding);
    assert.equal(view.summary.requests, 1);
    assert.equal(view.recordedThread!.status, "matched_recorded_subset");
    assert.deepEqual(await f.db.rows(company.scope.namespace), observations);
    const links = await f.db.all<any>("thread_relations");
    assert.equal(links.filter((row) => row.rejected).length, 1);
    assert.equal(links.filter((row) => !row.rejected).length, 1);
  } finally {
    f.db.close();
  }
});

for (const change of [
  "fractional_summary",
  "missing_summary_count",
  "zero_matched",
  "mismatched_count",
  "fractional_coverage",
  "numeric_coverage",
  "unavailable_positive",
  "unavailable_summary",
] as const)
  test(`recorded-thread ${change} response cannot become a trusted matched summary`, async () => {
    const f = await setup();
    try {
      await f.connect();
      (f.c.company as any).transport = async (url: string) => {
        const thread_key = new URL(url).pathname.split("/").at(-2);
        const response: any = {
          site: "perplexity",
          key_version: "1",
          thread_key,
          deletion_epoch: 0,
          status: "matched_recorded_subset",
          coverage: {
            scope: "matched_recorded_requests",
            provider_history_complete: false,
            matched_request_count: "1",
          },
          summary: {
            aggregate_status: "current",
            request_count: "1",
            attempt_count: "1",
            tokens: [],
            resources: [],
          },
        };
        if (change === "fractional_summary")
          response.summary.request_count = "1.5";
        if (change === "missing_summary_count")
          delete response.summary.request_count;
        if (change === "zero_matched") {
          response.summary.request_count = "0";
          response.coverage.matched_request_count = "0";
        }
        if (change === "mismatched_count")
          response.coverage.matched_request_count = "2";
        if (change === "fractional_coverage")
          response.coverage.matched_request_count = "1.0";
        if (change === "numeric_coverage")
          response.coverage.matched_request_count = 1;
        if (change === "unavailable_positive") {
          response.status = "unavailable";
          response.summary = null;
        }
        if (change === "unavailable_summary") {
          response.status = "unavailable";
          response.coverage.matched_request_count = "0";
        }
        return new Response(JSON.stringify(response));
      };
      const view = await f.c.routeSummary(
        "perplexity",
        threadId,
        f.history().binding,
      );
      assert.equal(view.conversation.server, null);
      // The server answered, so a rejected answer is not "offline".
      assert.equal(view.conversation.offline, false);
      assert.equal(view.recordedThread!.status, "unavailable");
    } finally {
      f.db.close();
    }
  });

test("a server that is recalculating is reachable, so the thread is not shown offline", async () => {
  // Live, 14 Oct 2026: right after a server update every read answered 409
  // recalculation_pending and Details showed "Offline" although the server was reachable.
  const f = await setup();
  try {
    const company = await f.connect();
    await f.seed(company.scope, company.secret);
    const event = f.history();
    await f.c.threads.receive(event.start, event.binding, sender);
    await f.c.threads.receive(event.page, event.binding, sender);
    (f.c.company as any).transport = async () =>
      new Response(
        JSON.stringify({ error: { code: "recalculation_pending" } }),
        { status: 409 },
      );
    const view = await f.c.routeSummary("perplexity", threadId, event.binding);
    assert.equal(view.conversation.server, null);
    assert.equal(view.conversation.offline, false);
    assert.equal(view.summary.requests, 1);
  } finally {
    f.db.close();
  }
});

test("unresolved server identity is distinct from offline and preserves separately labeled local observations", async () => {
  const f = await setup();
  try {
    const company = await f.connect();
    await f.seed(company.scope, company.secret);
    f.setOffline();
    const event = f.history();
    await f.c.threads.receive(event.start, event.binding, sender);
    await f.c.threads.receive(event.page, event.binding, sender);
    (f.c.company as any).transport = async () =>
      new Response(
        JSON.stringify({ error: { code: "thread_identity_unresolved" } }),
        { status: 409 },
      );
    const view = await f.c.routeSummary("perplexity", threadId, event.binding);
    assert.equal(view.conversation.server, null);
    assert.equal(view.conversation.offline, false);
    assert.equal(view.summary.requests, 1);
    assert.equal(view.conversation.pending!.requests, 1);
    assert.equal(
      view.recordedThread!.serverUnavailableReason,
      "unresolved_identity",
    );
  } finally {
    f.db.close();
  }
});
