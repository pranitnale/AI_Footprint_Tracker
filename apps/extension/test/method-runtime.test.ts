import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { unavailableCount } from "./counting-fixture";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdirSync, mkdtempSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ledger } from "@footprint/ledger";
import { canonicalJson, payloadHash } from "@footprint/contracts";
import {
  BASELINE_BUNDLE,
  BASELINE_METHOD_ID,
  BASELINE_METHOD_HASH,
  estimateAttempt,
  type MethodBundle,
  type SignedMethodUpdate,
} from "@footprint/estimator";
import { Coordinator } from "../lib/coordinator";
import { MethodService } from "../lib/method-service";
import { transitionOwnership, type OwnershipHistory } from "../lib/ownership";
import { records } from "../../../packages/ledger/test/factory";
import { pythonExecutable } from "../../../tools/python-reference.cjs";
import { env } from "node:process";
import {
  historyWorker,
  historyPage,
  historySender,
  historyBinding,
  historyConversation,
} from "./history-fixture";
import {
  HISTORY_CAPTURE_CHANNEL,
  type HistoryCaptureMessage,
} from "../lib/history-capture";
import {
  presentFileTextSummary,
  type FileTextSeries,
  type FileTextCoverage,
} from "@footprint/ui/file-text";

async function signed(
  now: number,
  name = "signed-client-v1",
  change: (b: MethodBundle) => void = () => {},
  pair?: CryptoKeyPair,
  lifetime = 60000,
) {
  pair ??= await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const publicKey = Buffer.from(
    await crypto.subtle.exportKey("spki", pair.publicKey),
  ).toString("base64");
  const bundle = structuredClone(BASELINE_BUNDLE) as MethodBundle;
  bundle.method_id = name;
  bundle.coefficients.energyAlpha = "0.2";
  change(bundle);
  const envelope: SignedMethodUpdate = {
    bundle,
    bundle_hash: payloadHash(bundle),
    issued_at: new Date(now).toISOString(),
    expires_at: new Date(now + lifetime).toISOString(),
    signature: "",
  };
  envelope.signature = Buffer.from(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      pair.privateKey,
      new TextEncoder().encode(
        canonicalJson({
          bundle_hash: envelope.bundle_hash,
          issued_at: envelope.issued_at,
          expires_at: envelope.expires_at,
        }),
      ),
    ),
  ).toString("base64");
  const fingerprint = Buffer.from(
    await crypto.subtle.digest("SHA-256", Buffer.from(publicKey, "base64")),
  ).toString("hex");
  return { envelope, publicKey, fingerprint, pair };
}
async function setup() {
  const name = "method-runtime-" + crypto.randomUUID(),
    db = await Ledger.open(name),
    clock = { now: Date.now() },
    calls: string[] = [];
  let replies: ReturnType<typeof signed> extends Promise<infer T>
    ? T[]
    : never = [];
  const transport = (async (url: any, init: any) => {
    calls.push(String(url));
    const pathname = new URL(url).pathname;
    if (pathname === "/v1/me/method-updates")
      return new Response(
        JSON.stringify({
          delivery_status: "available",
          trust_fingerprint: replies[0]?.fingerprint,
          methods: replies.map(({ envelope }) => ({
            method_id: (envelope.bundle as MethodBundle).method_id,
            method_hash: envelope.bundle_hash,
            issued_at: envelope.issued_at,
            expires_at: envelope.expires_at,
          })),
        }),
      );
    const found = replies.find(
      ({ envelope }) =>
        (envelope.bundle as MethodBundle).method_id ===
        pathname.split("/").at(-1),
    );
    if (found) return new Response(JSON.stringify(found.envelope));
    throw new Error("synthetic offline");
  }) as typeof fetch;
  const c = new Coordinator(db, {
    hasConsent: async () => true,
    count: unavailableCount,
    sendDisplay: async () => {},
    transport,
  });
  await c.whenReady();
  const service = new MethodService(
    db,
    c.company,
    () => c.currentScope(),
    () => clock.now,
  );
  (c as any).methods = service;
  async function connect(publicKey?: string) {
    const companyId = crypto.randomUUID(),
      userId = crypto.randomUUID(),
      era = crypto.randomUUID();
    const credentials: any = {
      key: "credentials",
      origin: "https://company.example",
      namespace: `company:${companyId}:${userId}`,
      company_id: companyId,
      user_id: userId,
      device_id: crypto.randomUUID(),
      access_token: "test-only-access",
      refresh_token: "test-only-refresh",
      access_expires_at: new Date(Date.now() + 600000).toISOString(),
      enrollment_era: { id: era, start: new Date().toISOString(), end: null },
      user_hmac_key: "b".repeat(64),
      method_public_key: publicKey ?? null,
      policy: {
        policy_version: "1.0.0",
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
  async function seed() {
    const scope = await c.currentScope(),
      [r, a] = records();
    a.proposed_method_id = BASELINE_METHOD_ID;
    r.dispatched_at = a.started_at = new Date().toISOString();
    const estimate = estimateAttempt(a);
    await db.commit(
      scope,
      [r, a],
      [
        {
          store: "local_estimates",
          value: {
            key: `current:${scope.namespace}:${a.attempt_id}`,
            namespace: scope.namespace,
            estimate,
          },
        },
      ],
    );
    return { scope, r, a, estimate };
  }
  return {
    name,
    db,
    c,
    service,
    clock,
    calls,
    connect,
    seed,
    setReplies: (value: typeof replies) => {
      replies = value;
    },
  };
}

test("personal mode uses packaged explicit recalculation without product-server traffic", async () => {
  const f = await setup();
  try {
    await f.seed();
    const status = await f.c.refreshMethods();
    assert.equal(status.canRefresh, false);
    assert.equal(status.methods.length, 1);
    const view = await f.c.dashboard({
      calculationView: "recalculated",
      methodId: BASELINE_METHOD_ID,
    });
    assert.equal(view.calculation.methodHash, BASELINE_METHOD_HASH);
    assert.equal(view.summary.estimate?.view, "recalculated");
    assert.equal(f.calls.length, 0);
    await assert.rejects(
      f.c.dashboard({
        calculationView: "recalculated",
        methodId: "unknown-method",
      }),
      /method_unsupported/,
    );
  } finally {
    f.db.close();
  }
});

test("verified admission survives restart and expiry for explicit recalculation without changing originals", async () => {
  const f = await setup();
  let restored: Ledger | undefined;
  try {
    const value = await signed(f.clock.now);
    f.setReplies([value]);
    await f.connect(value.publicKey);
    const source = await f.seed();
    const before = JSON.stringify([
      await f.db.all("requests"),
      await f.db.all("attempts"),
      await f.db.all("outbox"),
      await f.db.all("local_estimates"),
    ]);
    assert.equal((await f.service.refresh(true)).state, "current");
    const view = await f.c.dashboard({
      calculationView: "recalculated",
      methodId: "signed-client-v1",
    });
    assert.equal(
      view.summary.estimate?.method_hash,
      value.envelope.bundle_hash,
    );
    assert.equal(
      view.summary.estimate?.original_method_hash,
      source.estimate.method_hash,
    );
    assert.notEqual(
      view.summary.metrics.energy.value,
      source.estimate.metrics.energy.value,
    );
    assert.equal(
      JSON.stringify([
        await f.db.all("requests"),
        await f.db.all("attempts"),
        await f.db.all("outbox"),
        await f.db.all("local_estimates"),
      ]),
      before,
    );
    f.clock.now += 120000;
    f.db.close();
    restored = await Ledger.open(f.name);
    const c = new Coordinator(restored, {
      hasConsent: async () => true,
      count: unavailableCount,
      sendDisplay: async () => {},
      transport: async () => {
        throw new Error("offline");
      },
    });
    await c.whenReady();
    (c as any).methods = new MethodService(
      restored,
      c.company,
      () => c.currentScope(),
      () => f.clock.now,
    );
    const status = await c.methodStatus();
    assert.equal(status.state, "stale");
    assert.equal(status.methods[1].expiredForNewAdmission, true);
    const reloaded = await c.dashboard({
      calculationView: "recalculated",
      methodId: "signed-client-v1",
    });
    assert.equal(
      reloaded.summary.estimate?.method_hash,
      value.envelope.bundle_hash,
    );
    assert.equal(
      (await c.dashboard({ calculationView: "original" })).calculation.view,
      "original",
    );
    assert.throws(
      () => estimateAttempt(source.a, { methodId: "signed-client-v1" }),
      /method_unsupported/,
    );
  } finally {
    restored?.close();
    f.db.close();
  }
});

for (const failure of [
  "tamper",
  "wrong-key",
  "expired",
  "test-equation",
  "unsafe-url",
  "conflict",
  "partial-batch",
] as const) {
  test(`method failure ${failure} retains only last valid catalog`, async () => {
    const f = await setup();
    try {
      const good = await signed(f.clock.now);
      f.setReplies([good]);
      await f.connect(good.publicKey);
      await f.seed();
      assert.equal((await f.service.refresh(true)).state, "current");
      f.clock.now += 1100;
      let bad = await signed(
        f.clock.now,
        failure === "conflict" ? "signed-client-v1" : "signed-second-v1",
        (b) => {
          if (failure === "test-equation") {
            b.method_id = "test-equation-v1";
            b.equation_id = "test-linear-v1";
          }
          if (failure === "unsafe-url")
            b.provenance.url = "javascript:alert(1)";
          if (failure === "conflict") b.coefficients.energyAlpha = "0.3";
        },
        failure === "wrong-key" ? undefined : good.pair,
      );
      if (failure === "tamper" || failure === "partial-batch")
        bad.envelope.signature = "AA==";
      if (failure === "expired") f.clock.now += 61000;
      const extra = await signed(
        f.clock.now,
        "signed-third-v1",
        () => {},
        good.pair,
      );
      f.setReplies(
        failure === "partial-batch" ? [good, extra, bad] : [good, bad],
      );
      const status = await f.service.refresh(true);
      assert.equal(status.state, "stale");
      assert.equal(status.reason, "update_failed");
      assert.equal(status.methods.length, 2);
      await assert.rejects(
        f.c.dashboard({
          calculationView: "recalculated",
          methodId: "signed-third-v1",
        }),
        /method_unsupported/,
      );
      assert.equal(
        (
          await f.c.dashboard({
            calculationView: "recalculated",
            methodId: "signed-client-v1",
          })
        ).calculation.methodHash,
        good.envelope.bundle_hash,
      );
    } finally {
      f.db.close();
    }
  });
}

test("missing trust and changed connection never expose another catalog; malformed durable records fail visibly", async () => {
  const f = await setup();
  try {
    await f.connect();
    assert.equal((await f.service.refresh(true)).reason, "trust_unconfigured");
    assert.equal(f.calls.length, 0);
    const value = await signed(f.clock.now);
    await f.connect(value.publicKey);
    f.setReplies([value]);
    await f.service.refresh(true);
    const scope = await f.c.currentScope(),
      row = (await f.db.get<any>("method_catalogs", scope.namespace))!;
    await f.db.put("method_catalogs", {
      ...row,
      records: row.records.map((r: any) => ({
        ...r,
        acceptedAt: "2000-01-01T00:00:00.000Z",
      })),
    });
    assert.equal((await f.service.status()).reason, "stored_method_invalid");
    await assert.rejects(
      f.service.selection(scope, "signed-client-v1"),
      /method_update_invalid/,
    );
    await f.connect(value.publicKey);
    assert.equal((await f.service.status()).methods.length, 1);
  } finally {
    f.db.close();
  }
});

for (const change of ["scope", "erase", "revoke", "key", "cancel"] as const) {
  test(`late verified admission is rejected after ${change}`, async () => {
    const f = await setup();
    try {
      const value = await signed(f.clock.now);
      const credentials = await f.connect(value.publicKey);
      f.setReplies([value]);
      const scope = await f.c.currentScope(),
        commit = f.db.commitMethodCatalog.bind(f.db);
      let injected = false;
      f.db.commitMethodCatalog = async (...args) => {
        if (!injected) {
          injected = true;
          if (change === "scope") await f.connect(value.publicKey);
          if (change === "erase")
            await f.db.applyRange(
              scope,
              null,
              new Date(Date.now() + 1000).toISOString(),
              1,
            );
          if (change === "revoke")
            await f.db.put("policy", {
              ...credentials,
              enrollment_state: "revoked",
            });
          if (change === "key")
            await f.db.put("policy", {
              ...credentials,
              method_public_key: (await signed(f.clock.now)).publicKey,
            });
          if (change === "cancel") f.service.invalidate();
        }
        return commit(...args);
      };
      await f.service.refresh(true);
      assert.equal(injected, true);
      assert.equal((await f.db.all("method_catalogs")).length, 0);
    } finally {
      f.db.close();
    }
  });
}

test("actual client enrollment and authenticated bundle delivery through SQLite TestClient", async () => {
  const parent = fileURLToPath(
    new URL("../../../.test-runtime/method-runtime-20260914/", import.meta.url),
  );
  mkdirSync(parent, { recursive: true });
  const temporary = mkdtempSync(parent + "api-");
  const environment: NodeJS.ProcessEnv = { ...env, PYTHONNOUSERSITE: "1" };
  delete environment.PYTHONHOME;
  delete environment.PYTHONUSERBASE;
  delete environment.PYTHONPATH;
  const process = spawn(
    pythonExecutable(),
    [
      "-X",
      "utf8",
      "-u",
      fileURLToPath(new URL("./method-api-bridge.py", import.meta.url)),
      temporary,
    ],
    { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: environment },
  );
  const pending = new Map<number, (value: any) => void>();
  let ready!: (value: any) => void;
  const started = new Promise<any>((resolve) => {
    ready = resolve;
  });
  const lines = createInterface({ input: process.stdout });
  lines.on("line", (line) => {
    const data = JSON.parse(line);
    if (data.ready) ready(data);
    else {
      pending.get(data.id)?.(data);
      pending.delete(data.id);
    }
  });
  let diagnostics = "";
  process.stderr.on("data", (chunk) => {
    diagnostics = (diagnostics + String(chunk)).slice(-2048);
  });
  let counter = 0;
  const call = async (request: Record<string, unknown>) => {
    const id = ++counter;
    let timer: ReturnType<typeof setTimeout>;
    const response = new Promise<any>((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("synthetic_api_timeout")),
        20000,
      );
      pending.set(id, (value) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
    process.stdin.write(JSON.stringify({ id, ...request }) + "\n");
    return response;
  };
  let db: Ledger | undefined;
  const privateWorker = historyWorker();
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const info = await Promise.race([
      started,
      new Promise(
        (_, reject) =>
          (startupTimer = setTimeout(
            () => reject(new Error("synthetic_api_start_timeout")),
            20000,
          )),
      ),
    ]);
    clearTimeout(startupTimer);
    db = await Ledger.open("method-api-" + crypto.randomUUID());
    const transport = (async (url: any, init: any) => {
      const result = await call({
        method: init.method,
        path: new URL(url).pathname + new URL(url).search,
        headers: init.headers,
        body: init.body ? JSON.parse(init.body) : undefined,
      });
      if (
        ["/v1/public/config", "/v1/config", "/v1/auth/refresh"].includes(
          new URL(url).pathname,
        )
      )
        result.body.method_public_key = "untrusted-public-config-value";
      return new Response(JSON.stringify(result.body), {
        status: result.status,
      });
    }) as typeof fetch;
    const c = new Coordinator(db, {
      hasConsent: async () => true,
      count: privateWorker.count,
      sendDisplay: async () => {},
      transport,
    });
    await c.whenReady();
    // The member's three steps: the code goes to the fake mailbox, which the bridge reads.
    const connect = async () => {
      await c.company.requestCode(info.origin, "admin@example.org");
      const mail = await call({ read_code: true });
      await c.company.verifyCode(mail.body.code, "chrome");
      return c.company.confirm();
    };
    assert.equal(await connect(), "connected");
    assert.notEqual(
      (await c.company.credentials())!.method_public_key,
      "untrusted-public-config-value",
    );
    assert.equal(
      (await c.refreshMethods()).methods.some((m) => m.id === info.methodId),
      true,
    );
    const enrolled = (await c.company.credentials())!;
    await db.application.applySessionChanges({
      credentials: {
        ...enrolled,
        access_expires_at: "2000-01-01T00:00:00.000Z",
      },
    });
    await c.company.methodRequest(
      await c.currentScope(),
      "/v1/me/method-updates",
    );
    await (c.company as any).refreshPolicy(await c.company.credentials());
    assert.equal(
      (await c.company.credentials())!.method_public_key,
      enrolled.method_public_key,
    );
    const scope = await c.currentScope(),
      [legacyRequest, a] = records();
    const r = {
      ...legacyRequest,
      schema_version: "3.0.0" as const,
      documents: {
        ...legacyRequest.documents,
        upload_count: null,
        processing: "unknown" as const,
        extracted_text: [
          {
            component_id: crypto.randomUUID(),
            origin: "unknown_origin" as const,
            extraction_profile_id: "observed-inline-file-text-v1" as const,
            page_count: null,
            tokens: {
              value: "33",
              evidence: "heuristic_estimate" as const,
              scope: "extracted_file_text" as const,
              completeness: "complete_for_scope" as const,
              profile_id: "o200k-base-4.0.0-reference" as const,
              reason: "tokenizer_mapping_unverified" as const,
            },
            missing: ["provider_processing" as const, "ocr" as const],
          },
        ],
      },
    };
    a.proposed_method_id = BASELINE_METHOD_ID;
    r.dispatched_at = a.started_at = new Date().toISOString();
    await db.commit(
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
    const result = await c.dashboard({
      calculationView: "recalculated",
      methodId: info.methodId,
    });
    assert.equal(result.summary.estimate?.view, "recalculated");
    await c.company.sync();
    assert.equal(
      (await db.pending(scope.namespace)).length,
      0,
      "the actual API must acknowledge the numerical request family",
    );
    const job = await c.recalculation(info.methodId, crypto.randomUUID());
    assert.match(job.jobId, /^[a-f0-9]{64}$/);
    assert.equal((await c.recalculation(null, job.jobId)).jobId, job.jobId);
    await assert.rejects(
      c.selectedServerSummary(
        "my",
        `?period=all&calculation_view=recalculated&method_id=${info.methodId}`,
      ),
      /recalculation_pending/,
    );
    await call({ advance_worker: true });
    const synced = await c.selectedServerSummary(
      "my",
      `?period=all&calculation_view=recalculated&method_id=${info.methodId}`,
    );
    assert.equal(synced.calculation.view, "recalculated");
    assert.equal(synced.request_count, "1");
    const original = await c.selectedServerSummary(
      "my",
      "?period=all&calculation_view=original",
    );
    for (const view of [original, synced]) {
      const groups = view.file_text as FileTextSeries[];
      const coverage = view.file_text_coverage as FileTextCoverage;
      assert.equal(groups.length, 1);
      // File text sent to Claude: 33 tokenizer tokens x 1.56 = 51.48, rounded to 51.
      assert.equal(groups[0].value, "51");
      assert.deepEqual(coverage, {
        observed_request_count: "1",
        unknown_request_count: "0",
        scope: "extracted_file_text",
        additive: false,
      });
      assert.match(
        presentFileTextSummary(groups, coverage).groups[0].tokens,
        /^51 observed inline file-text tokens$/,
      );
      assert.equal(
        JSON.stringify(groups).includes(
          r.documents.extracted_text[0].component_id,
        ),
        false,
      );
    }
    assert.deepEqual(
      original.resources,
      (
        await c.selectedServerSummary(
          "my",
          "?period=all&calculation_view=original",
        )
      ).resources,
    );
    const historical = historyPage(),
      binding = historyBinding();
    const historyMessage: Omit<HistoryCaptureMessage, "event" | "page"> = {
      channel: HISTORY_CAPTURE_CHANNEL,
      id: crypto.randomUUID(),
      site: historical.site,
      conversationId: historical.conversationId,
      observedAt: historical.observedAt,
    };
    await c.history.receive(
      { ...historyMessage, event: "start", page: null },
      binding,
      historySender,
    );
    await c.history.receive(
      { ...historyMessage, event: "page", page: historical },
      binding,
      historySender,
    );
    assert.equal((await db.pendingHistory(scope)).length, 2);
    c.history.invalidate();
    const imported = await db.pendingHistory(scope);
    const priorDevice = (await c.company.credentials())!;
    await c.company.disconnect();
    assert.equal(await connect(), "connected");
    const historyScope = await c.currentScope();
    assert.equal(historyScope.namespace, scope.namespace);
    assert.notEqual(historyScope.era, scope.era);
    assert.equal(
      (await c.company.credentials())!.device_id,
      priorDevice.device_id,
    );
    assert.deepEqual(
      (await db.pendingHistory(historyScope)).map((row) => row.record),
      imported.map((row) => row.record),
    );
    await c.history.sync();
    assert.equal((await db.pendingHistory(historyScope)).length, 0);
    assert.equal((await db.pendingHistoryCoverage(historyScope)).length, 0);
    let loaded = await c.routeSummary(
      "claude",
      historyConversation,
      historyBinding(),
    );
    assert.equal(loaded.conversation.server, null);
    assert.equal(loaded.history.server, null);
    assert.equal(loaded.history.local.observed_response_count, "1");
    // Recalculation must finish before a coherent remote pair replaces local data.
    await c.engines.maintainOrganization();
    for (let pass = 0; pass < 3 && !loaded.history.server; pass++) {
      await call({ advance_worker: true });
      loaded = await c.routeSummary(
        "claude",
        historyConversation,
        historyBinding(),
      );
    }
    assert.equal(loaded.summary.requests, 0);
    assert.equal(loaded.history.local.observed_response_count, "1");
    assert.equal(loaded.history.server?.observed_response_count, "1");
    // One saved Claude reply token: 1 x 1.56 = 1.56, rounded half up to 2.
    assert.equal(
      loaded.history.server?.tokens.find((t) => t.role === "response")?.value,
      "2",
    );
    assert.equal(loaded.history.server?.dated_message_count, "2");
    assert.equal(
      (
        await c.selectedServerSummary(
          "my",
          "?period=all&calculation_view=original",
        )
      ).history.server?.response_count,
      "1",
    );
    const saved = await db.historyPage(historyScope, undefined);
    assert.equal(JSON.stringify(saved).includes("hello"), false);
    assert.equal(saved[0].record.occurred_at, "2020-01-01T10:00:00.000001Z");
    const engine = await c.engineStatus();
    await c.selectEngine({
      preference: "ecologits",
      expectedRevision: engine.selectionRevision,
    });
    await c.engines.maintainOrganization();
    await call({ advance_worker: true });
    const selectedDefault = await c.selectedServerSummary("my", "?period=all");
    assert.equal(selectedDefault.calculation.view, "recalculated");
    assert.equal(
      selectedDefault.calculation.methodHash,
      c.engines.methods.ecologits.method_hash,
    );
    assert.equal(selectedDefault.request_count, "1");
    assert.equal(selectedDefault.history.server?.observed_response_count, "1");
  } finally {
    clearTimeout(startupTimer);
    db?.close();
    await privateWorker.close();
    lines.close();
    process.stdin.end();
    process.kill();
    assert.equal(
      diagnostics.includes("Traceback"),
      false,
      "synthetic API fixture failed",
    );
  }
});

test("refresh flood shares one physical fetch and a late timed-out response never admits", async () => {
  const f = await setup();
  let release!: (r: Response) => void;
  try {
    const value = await signed(f.clock.now);
    await f.connect(value.publicKey);
    let requests = 0;
    let entered!: () => void;
    const started = new Promise<void>((r) => {
      entered = r;
    });
    (f.c.company as any).transport = async () => {
      requests++;
      entered();
      return new Promise<Response>((r) => {
        release = r;
      });
    };
    const jobs = Array.from({ length: 40 }, () => f.service.refresh(true));
    await started;
    assert.equal(requests, 1);
    assert.equal((await f.service.status()).state, "loading");
    f.clock.now += 31000;
    release(
      new Response(
        JSON.stringify({
          delivery_status: "available",
          trust_fingerprint: value.fingerprint,
          methods: [],
        }),
      ),
    );
    const results = await Promise.all(jobs);
    assert.equal(requests, 1);
    assert.ok(
      results.every(
        (r) => r.state === "failed" && r.reason === "update_failed",
      ),
    );
    assert.equal((await f.db.all("method_catalogs")).length, 0);
  } finally {
    f.db.close();
  }
});

test("oversized chunked UTF-8 delivery is rejected and cancelled before catalog admission", async () => {
  const f = await setup();
  try {
    const value = await signed(f.clock.now);
    await f.connect(value.publicKey);
    f.setReplies([value]);
    const transport = (f.c.company as any).transport;
    let cancelled = false;
    (f.c.company as any).transport = async (url: any, init: any) => {
      assert.equal(init.redirect, "error");
      if (String(url).endsWith("/method-updates")) return transport(url, init);
      let chunks = 0;
      return new Response(
        new ReadableStream({
          pull(c) {
            if (chunks++ < 40)
              c.enqueue(new TextEncoder().encode("€".repeat(32768)));
            else c.close();
          },
          cancel() {
            cancelled = true;
          },
        }),
      );
    };
    assert.equal((await f.service.refresh(true)).state, "failed");
    assert.equal(cancelled, true);
    assert.equal((await f.service.status()).methods.length, 1);
    await assert.rejects(
      f.c.company.methodRequest(
        await f.c.currentScope(),
        "/v1/me/method-updates/../config",
      ),
      /payload_rejected/,
    );
  } finally {
    f.db.close();
  }
});

test("same method ID remains isolated under another company's trust key", async () => {
  const f = await setup();
  try {
    const a = await signed(f.clock.now);
    await f.connect(a.publicKey);
    f.setReplies([a]);
    await f.seed();
    await f.service.refresh(true);
    f.clock.now += 1100;
    const b = await signed(f.clock.now, "signed-client-v1", (bundle) => {
      bundle.coefficients.energyAlpha = "0.8";
    });
    await f.connect(b.publicKey);
    f.setReplies([b]);
    await f.seed();
    await f.service.refresh(true);
    const result = await f.c.dashboard({
      calculationView: "recalculated",
      methodId: "signed-client-v1",
    });
    assert.equal(result.calculation.methodHash, b.envelope.bundle_hash);
    assert.notEqual(result.calculation.methodHash, a.envelope.bundle_hash);
    assert.equal((await f.db.all("method_catalogs")).length, 2);
  } finally {
    f.db.close();
  }
});

test("ordinary policy acknowledgement keeps accepted methods while A-to-B-to-A blocks a pending admission", async () => {
  const f = await setup();
  try {
    const a = await signed(f.clock.now);
    const credentials = await f.connect(a.publicKey);
    f.setReplies([a]);
    await f.seed();
    await f.service.refresh(true);
    const history = (await f.db.get<OwnershipHistory>(
      "policy",
      "ownership-history",
    ))!;
    await f.db.policyTransaction([
      {
        ...credentials,
        policy: { ...credentials.policy, policy_version: "1.0.1" },
      },
      transitionOwnership(history, {
        scope: await f.c.currentScope(),
        secret: credentials.user_hmac_key,
        policyVersion: "1.0.1",
      }) as any,
    ]);
    f.clock.now += 120000;
    assert.equal((await f.service.status()).methods.length, 2);
    assert.equal(
      (
        await f.c.dashboard({
          calculationView: "recalculated",
          methodId: "signed-client-v1",
        })
      ).calculation.methodHash,
      a.envelope.bundle_hash,
    );
    const next = await signed(f.clock.now, "signed-next-v1", () => {}, a.pair);
    f.setReplies([a, next]);
    const commit = f.db.commitMethodCatalog.bind(f.db);
    let changed = false;
    f.db.commitMethodCatalog = async (...args) => {
      if (!changed) {
        changed = true;
        await f.connect(a.publicKey);
        const moved = (await f.db.get<OwnershipHistory>(
          "policy",
          "ownership-history",
        ))!;
        await f.db.policyTransaction([
          credentials,
          transitionOwnership(moved, {
            scope: {
              namespace: credentials.namespace,
              mode: "company",
              era: credentials.enrollment_era.id,
            },
            secret: credentials.user_hmac_key,
            policyVersion: "1.0.0",
          }) as any,
        ]);
      }
      return commit(...args);
    };
    await f.service.refresh(true);
    assert.equal(changed, true);
    assert.equal(
      (await f.service.status()).methods.some((m) => m.id === "signed-next-v1"),
      false,
    );
  } finally {
    f.db.close();
  }
});

test("renewed delivery preserves original sealed admission and full namespace erasure removes catalog", async () => {
  const f = await setup();
  try {
    const first = await signed(f.clock.now);
    await f.connect(first.publicKey);
    f.setReplies([first]);
    await f.service.refresh(true);
    const scope = await f.c.currentScope(),
      stored = (await f.db.get<any>("method_catalogs", scope.namespace))!;
    f.clock.now += 61000;
    const renewed = await signed(
      f.clock.now,
      "signed-client-v1",
      () => {},
      first.pair,
    );
    f.setReplies([renewed]);
    assert.equal((await f.service.refresh(true)).state, "current");
    const after = (await f.db.get<any>("method_catalogs", scope.namespace))!;
    assert.deepEqual(after.records[0].envelope, stored.records[0].envelope);
    assert.equal(after.records[0].acceptedAt, stored.records[0].acceptedAt);
    assert.equal(
      after.records[0].delivery.expires_at,
      renewed.envelope.expires_at,
    );
    await f.db.eraseNamespace(scope.namespace);
    assert.equal((await f.db.all("method_catalogs")).length, 0);
  } finally {
    f.db.close();
  }
});

test("catalog and numerical UI tokens cannot be combined across companies", async () => {
  const f = await setup();
  try {
    const a = await signed(f.clock.now);
    await f.connect(a.publicKey);
    f.setReplies([a]);
    await f.seed();
    await f.service.refresh(true);
    const oldStatus = await f.service.status();
    await f.connect(a.publicKey);
    await f.seed();
    const newDashboard = await f.c.dashboard(),
      newStatus = await f.service.status();
    assert.notEqual(oldStatus.scopeToken, newDashboard.scopeToken);
    assert.equal(newStatus.scopeToken, newDashboard.scopeToken);
    assert.equal(newStatus.methods.length, 1);
  } finally {
    f.db.close();
  }
});

test("a scope change during final dashboard queue lookup rejects the whole numerical response", async () => {
  const f = await setup();
  try {
    const a = await signed(f.clock.now);
    await f.connect(a.publicKey);
    f.setReplies([a]);
    await f.seed();
    await f.service.refresh(true);
    const count = f.db.application.pendingCount.bind(f.db.application);
    let moved = false;
    f.db.application.pendingCount = async (...args) => {
      const value = await count(...args);
      if (!moved) {
        moved = true;
        await f.connect(a.publicKey);
      }
      return value;
    };
    await assert.rejects(
      f.c.dashboard({
        calculationView: "recalculated",
        methodId: "signed-client-v1",
      }),
      /policy_unavailable/,
    );
    assert.equal(moved, true);
  } finally {
    f.db.close();
  }
});

test("a mismatched server method cannot replace the last valid summary cache", async () => {
  const f = await setup();
  try {
    const value = await signed(f.clock.now);
    await f.connect(value.publicKey);
    f.setReplies([value]);
    await f.seed();
    await f.service.refresh(true);
    let corrupt = false;
    (f.c.company as any).transport = async () =>
      new Response(
        JSON.stringify({
          aggregate_status: "current",
          calculation_view: "recalculated",
          method_id: "signed-client-v1",
          method_hash: corrupt ? "0".repeat(64) : value.envelope.bundle_hash,
          recalculation_job_id: "b".repeat(64),
          recalculated_at: new Date().toISOString(),
          request_count: "3",
          attempt_count: "3",
          tokens: [],
          resources: [],
        }),
      );
    const query =
      "?period=all&calculation_view=recalculated&method_id=signed-client-v1";
    const valid = await f.c.selectedServerSummary("my", query);
    assert.equal(valid.calculation.methodHash, value.envelope.bundle_hash);
    const cached = JSON.stringify(
      (await f.db.all<any>("dashboard_cache")).filter((row) =>
        row.key.startsWith("server-summary:"),
      ),
    );
    corrupt = true;
    await assert.rejects(
      f.c.selectedServerSummary("my", query),
      /method_update_invalid/,
    );
    assert.equal(
      JSON.stringify(
        (await f.db.all<any>("dashboard_cache")).filter((row) =>
          row.key.startsWith("server-summary:"),
        ),
      ),
      cached,
    );
  } finally {
    f.db.close();
  }
});

for (const renewal of [false, true]) {
  for (const phase of ["crypto", "seal", "transaction"] as const) {
    test(`expired ${renewal ? "renewed" : "new"} delivery at ${phase} retains the last valid catalog`, async () => {
      const f = await setup();
      const nativeVerify = crypto.subtle.verify.bind(crypto.subtle);
      try {
        const a = await signed(f.clock.now, "retained-method");
        await f.connect(a.publicKey);
        f.setReplies([a]);
        assert.equal((await f.service.refresh(true)).methods.length, 2);
        const before = (await f.db.all<any>("method_catalogs"))[0];
        f.clock.now += 1100;
        const b = await signed(
          f.clock.now,
          renewal ? "retained-method" : "expiring-method",
          () => {},
          a.pair,
          1000,
        );
        let advanced = false;
        const advance = () => {
          if (!advanced) {
            advanced = true;
            f.clock.now += 1001;
          }
        };
        if (phase === "crypto") {
          crypto.subtle.verify = (async (
            ...args: Parameters<typeof nativeVerify>
          ) => {
            const result = await nativeVerify(...args);
            if (
              new TextDecoder()
                .decode(args[3] as ArrayBuffer)
                .includes(b.envelope.expires_at)
            )
              advance();
            return result;
          }) as typeof crypto.subtle.verify;
        } else if (phase === "seal") {
          const seal = (f.service as any).seal.bind(f.service);
          (f.service as any).seal = async (value: any) => {
            const result = await seal(value);
            if (
              value.records.some(
                (r: any) =>
                  (r.delivery ?? r.envelope).expires_at ===
                  b.envelope.expires_at,
              )
            )
              advance();
            return result;
          };
        } else {
          const commit = f.db.commitMethodCatalog.bind(f.db);
          f.db.commitMethodCatalog = async (...args) => {
            const original = args[3];
            let checks = 0;
            args[3] = () => {
              if (++checks === 2) advance();
              return original();
            };
            return commit(...args);
          };
        }
        f.setReplies(renewal ? [b] : [a, b]);
        const status = await f.service.refresh(true);
        assert.equal(advanced, true);
        assert.equal(status.state, "stale");
        assert.equal(status.reason, "update_failed");
        assert.equal(status.methods.length, 2);
        const after = (await f.db.all<any>("method_catalogs"))[0];
        assert.deepEqual(after.records, before.records);
        assert.equal(after.lastValidAt, before.lastValidAt);
        assert.equal(
          (
            await f.service.selection(
              await f.c.currentScope(),
              "retained-method",
            )
          ).methodHash,
          a.envelope.bundle_hash,
        );
      } finally {
        crypto.subtle.verify = nativeVerify;
        f.db.close();
      }
    });
  }
}

for (const mode of ["flood", "abort", "deadline", "tiny-success"] as const) {
  test(`actual method reader bounds ${mode} streams and preserves valid methods`, async () => {
    const f = await setup();
    const realNow = Date.now;
    try {
      const a = await signed(f.clock.now);
      await f.connect(a.publicKey);
      f.setReplies([a]);
      await f.service.refresh(true);
      f.clock.now += 1100;
      const nativeTransport = (f.c.company as any).transport;
      let pulls = 0,
        cancelled = false;
      (f.c.company as any).transport = async (url: any, init: any) => {
        const original = await nativeTransport(url, init);
        const encoded = new TextEncoder().encode(await original.text());
        if (mode === "abort") setTimeout(() => f.service.invalidate(), 0);
        return new Response(
          new ReadableStream({
            pull(controller) {
              pulls++;
              if (mode === "deadline" && pulls === 2)
                Date.now = () => realNow() + 21000;
              if (mode === "tiny-success") {
                if (pulls <= encoded.length)
                  controller.enqueue(encoded.subarray(pulls - 1, pulls));
                else controller.close();
              } else if (pulls < 100000) controller.enqueue(new Uint8Array());
              else {
                controller.enqueue(encoded);
                controller.close();
              }
            },
            cancel() {
              cancelled = true;
            },
          }),
        );
      };
      const status = await f.service.refresh(true);
      assert.equal(status.methods.length, 2);
      if (mode === "tiny-success") {
        assert.equal(status.state, "current");
        assert.equal(cancelled, false);
      } else {
        assert.ok(pulls <= 8194);
        assert.equal(cancelled, true);
        if (mode !== "abort") assert.equal(status.state, "stale");
      }
      assert.equal(
        (await f.db.all<any>("method_catalogs"))[0].records.length,
        1,
      );
    } finally {
      Date.now = realNow;
      f.db.close();
    }
  });
}
