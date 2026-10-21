import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { countByTextLength, unavailableCount } from "./counting-fixture";
import { archivedEstimation } from "./archived-engine-fixture";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Ledger } from "@footprint/ledger";
import {
  parseDispatch,
  initialSnapshot,
  PerplexitySession,
} from "@footprint/adapters";
import { parseConversationRoute } from "@footprint/capture-core";
import { Coordinator } from "../lib/coordinator";
import {
  hmacIdentity,
  transitionOwnership,
  type OwnershipHistory,
} from "../lib/ownership";
import { scanSummary } from "../lib/summary-scan";
const relation = JSON.parse(
  readFileSync(
    new URL(
      "../../../fixtures/provider-identity-2026-09-10.json",
      import.meta.url,
    ),
    "utf8",
  ),
).perplexity;
function dispatch(frontend: unknown) {
  return parseDispatch(
    "perplexity",
    new URL("https://www.perplexity.ai/rest/sse/perplexity_ask"),
    JSON.stringify({
      query_str: "Synthetic input",
      params: {
        frontend_uuid: frontend,
        last_backend_uuid: null,
        attachments: [],
      },
    }),
  );
}

test("Perplexity frontend UUID identifies only a request; retrieved route/context inequalities remain intact", () => {
  const route = relation.route.split("/").at(-1);
  assert.equal(
    new Set(relation.entries.map((e: any) => e.frontend_uuid)).size,
    6,
  );
  for (const entry of relation.entries) {
    assert.equal(entry.uuid, entry.frontend_uuid);
    assert.notEqual(entry.backend_uuid, entry.frontend_uuid);
    assert.equal(entry.thread_url_slug, route);
    assert.notEqual(entry.context_uuid, route);
    assert.notEqual(entry.frontend_context_uuid, route);
    assert.notEqual(entry.context_uuid, entry.frontend_context_uuid);
    const actual = dispatch(entry.frontend_uuid);
    assert.equal(actual.requestId, entry.frontend_uuid);
    assert.equal(actual.conversationId, null);
  }
  assert.deepEqual(parseConversationRoute("perplexity", relation.route), {
    site: "perplexity",
    conversationId: route,
  });
  for (const invalid of [
    null,
    undefined,
    "request-like",
    "-".repeat(36),
    "00000000-0000-0000-0000-000000000000",
    "00000000-0000-4000-8000-000000000003/private",
    {},
    1,
  ])
    assert.equal(dispatch(invalid).requestId, null);
});

test("actual coordinator coalesces replayed Perplexity requests and attempts but separates distinct sends and ownership scopes", async () => {
  const db = await Ledger.open("perplexity-request-" + crypto.randomUUID());
  let network = 0;
  const coordinator = new Coordinator(db, {
    hasConsent: async () => true,
    count: unavailableCount,
    sendDisplay: async () => {},
    transport: (async () => {
      network++;
      throw new Error("Synthetic offline company");
    }) as typeof fetch,
  });
  try {
    const personal = await coordinator.currentScope();
    const personalPolicy = (await db.get<any>("policy", "personal"))!;
    const sender = {
      tab: { id: 4 },
      frameId: 0,
      documentId: "synthetic-perplexity-document",
      url: "https://www.perplexity.ai" + relation.route,
    };
    const requestId = relation.entries[0].frontend_uuid;
    const otherId = relation.entries[1].frontend_uuid;
    async function observe(frontend: string) {
      const id = crypto.randomUUID(),
        at = new Date().toISOString();
      const start: any = { timing: null,
        channel: "ai-footprint-observation-v1",
        version: 1,
        id,
        revision: 1,
        event: "dispatch",
        site: "perplexity",
        at,
        dispatch: dispatch(frontend),
        snapshot: initialSnapshot(),
        failure: null,
      };
      await coordinator.capture(start, sender);
      const session = new PerplexitySession();
      const value = {
        // The entry's backend id names the reply, the same live and saved (F1, W7).
        backend_uuid: relation.entries.find(
          (entry: any) => entry.frontend_uuid === frontend,
        ).backend_uuid,
        blocks: [
          {
            intended_usage: "workflow_root",
            workflow_block: {
              steps: [
                {
                  items: [
                    {
                      type: "WORKFLOW_ITEM_TEXT",
                      variant: "answer",
                      id: "observed-output-" + frontend,
                      payload: {
                        text_payload: {
                          chunks: ["Synthetic answer"],
                          text: "Synthetic answer",
                          is_streaming: false,
                        },
                      },
                    },
                  ],
                },
              ],
            },
          },
        ],
        final: true,
        final_sse_message: true,
        text_completed: true,
        status: "COMPLETED",
      };
      session.frame({ event: "message", data: JSON.stringify(value), value });
      assert.equal(session.snapshot().conversationId, null);
      await coordinator.capture(
        {
          ...start,
          revision: 2,
          event: "end",
          dispatch: null,
          snapshot: session.snapshot(),
        },
        sender,
      );
      await coordinator.settleConversationDisplays();
    }
    await observe(requestId);
    await observe(requestId);
    await observe(otherId);
    let totals = await scanSummary(db, personal.namespace);
    assert.equal(totals.requests, 2);
    assert.equal(totals.attempts, 2);
    assert.equal(network, 0);
    const original = await db.rows(personal.namespace);
    const firstKey = await hmacIdentity(
      personalPolicy.secret,
      "perplexity",
      "request",
      requestId,
    );
    const own = original.filter(
      (r) =>
        r.record.kind === "request" &&
        r.record.provider_request_key === firstKey,
    );
    assert.equal(own.length, 2);
    assert.equal(own.filter((r) => !r.aliasOf).length, 1);
    const provisional = await hmacIdentity(
      personalPolicy.secret,
      "perplexity",
      "conversation",
      "provisional-request:" + requestId,
    );
    assert.ok(
      own.every(
        (r) =>
          r.record.kind === "request" &&
          r.record.conversation_key === provisional &&
          r.record.coverage_reasons.includes(
            "conversation_identity_local_only",
          ),
      ),
    );

    assert.ok(!JSON.stringify(original).includes(requestId));
    for (const number of [1, 2]) {
      const companyId = crypto.randomUUID(),
        userId = crypto.randomUUID(),
        era = crypto.randomUUID(),
        secret = String(number).repeat(64);
      const c: any = {
        key: "credentials",
        namespace: `company:${companyId}:${userId}`,
        company_id: companyId,
        user_id: userId,
        device_id: crypto.randomUUID(),
        origin: `https://company${number}.example`,
        access_token: "synthetic-access",
        refresh_token: "synthetic-refresh",
        access_expires_at: new Date(Date.now() + 600000).toISOString(),
        enrollment_era: { id: era, start: new Date().toISOString(), end: null },
        user_hmac_key: secret,
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
        c,
        transitionOwnership(history, {
          scope: { namespace: c.namespace, mode: "company", era },
          secret,
          policyVersion: "1.0.0",
        }) as any,
      ]);
      await observe(requestId);
      await observe(requestId);
      totals = await scanSummary(db, c.namespace);
      assert.equal(totals.requests, 1);
      assert.equal(totals.attempts, 1);
      const current = await db.rows(c.namespace);
      const key = await hmacIdentity(
        secret,
        "perplexity",
        "request",
        requestId,
      );
      assert.notEqual(key, firstKey);
      assert.equal(
        current.filter((r) => r.record.kind === "request" && !r.aliasOf).length,
        1,
      );
      assert.ok(
        current
          .filter((r) => r.record.kind === "request")
          .every(
            (r) =>
              r.record.kind === "request" &&
              r.record.provider_request_key === key,
          ),
      );
      assert.ok((await db.pending(c.namespace)).length > 0);
    }
    assert.deepEqual(await db.rows(personal.namespace), original);
    assert.equal((await db.pending(personal.namespace)).length, 0);
  } finally {
    db.close();
  }
});

test("a Perplexity follow-up finds the context of the reply its send names (W7)", async () => {
  const db = await Ledger.open("perplexity-context-" + crypto.randomUUID());
  const coordinator = new Coordinator(db, {
    estimation: archivedEstimation,
    hasConsent: async () => true,
    count: countByTextLength,
    sendDisplay: async () => {},
    transport: (async () => {
      throw new Error("personal mode must remain local");
    }) as typeof fetch,
  });
  try {
    const scope = await coordinator.currentScope();
    const sender = {
      tab: { id: 5 },
      frameId: 0,
      documentId: "synthetic-perplexity-context",
      url: "https://www.perplexity.ai" + relation.route,
    };
    // Two sends of one thread: the second names the first reply's backend id.
    async function send(entry: any, parent: string | null, answer: string) {
      const id = crypto.randomUUID(),
        at = new Date().toISOString();
      const start: any = {
        timing: null,
        channel: "ai-footprint-observation-v1",
        version: 1,
        id,
        revision: 1,
        event: "dispatch",
        site: "perplexity",
        at,
        dispatch: parseDispatch(
          "perplexity",
          new URL("https://www.perplexity.ai/rest/sse/perplexity_ask"),
          JSON.stringify({
            query_str: "q".repeat(100),
            params: {
              frontend_uuid: entry.frontend_uuid,
              last_backend_uuid: parent,
              attachments: [],
            },
          }),
        ),
        snapshot: initialSnapshot(),
        failure: null,
      };
      await coordinator.capture(start, sender);
      const session = new PerplexitySession();
      const value = {
        backend_uuid: entry.backend_uuid,
        status: "COMPLETED",
        final: true,
        final_sse_message: true,
        text_completed: true,
        blocks: [
          {
            intended_usage: "workflow_root",
            workflow_block: {
              steps: [
                {
                  items: [
                    {
                      type: "WORKFLOW_ITEM_TEXT",
                      variant: "answer",
                      id: "answer-item-" + entry.frontend_uuid,
                      payload: {
                        text_payload: {
                          text: answer,
                          chunks: [answer],
                          is_streaming: false,
                        },
                      },
                    },
                  ],
                },
              ],
            },
          },
        ],
      };
      session.frame({ event: "message", data: JSON.stringify(value), value });
      await coordinator.capture(
        {
          ...start,
          revision: 2,
          event: "end",
          dispatch: null,
          snapshot: session.snapshot(),
        },
        sender,
      );
      await coordinator.settleConversationDisplays();
      const rows = await db.rows(scope.namespace);
      const request = rows.find(
        (row) =>
          row.record.kind === "request" &&
          !row.aliasOf &&
          row.record.dispatched_at === at,
      )!.record as any;
      return rows.find(
        (row) =>
          row.record.kind === "attempt" &&
          (row.record as any).request_id === request.request_id,
      )!.record as any;
    }
    const [first, second, third] = relation.entries;
    const opening = await send(first, null, "a".repeat(300));
    const followUp = await send(second, first.backend_uuid, "b".repeat(50));
    const opened = BigInt(opening.tokens.logical_input_total.value);
    const context = BigInt(followUp.tokens.logical_input_total.value);
    assert.equal(followUp.tokens.logical_input_total.scope, "reconstructed_context");
    // The follow-up's input includes the first prompt and answer, not only its own prompt.
    assert.ok(context > BigInt(followUp.tokens.new_input_text.value));
    assert.ok(context >= opened + BigInt(opening.tokens.answer_output.value));
    // A parent the extension never saw leaves the context unknown, never just the prompt.
    const unseen = await send(third, "99999999-9999-4999-8999-999999999999", "c");
    assert.equal(unseen.tokens.logical_input_total.value, null);
    assert.equal(unseen.tokens.logical_input_total.reason, "context_unobserved");
  } finally {
    db.close();
  }
});
