import { archivedEstimation } from "./archived-engine-fixture";
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import ts from "typescript";
import { Ledger, type Scope } from "@footprint/ledger";
import { initialSnapshot, parseDispatch } from "@footprint/adapters";
import { canonicalJson, payloadHash } from "@footprint/contracts";
import { countText } from "@footprint/tokenizers";
import { countWithBundledTokenizer } from "./counting-fixture";
import { countAccessibleFile } from "@footprint/file-text";
import { Coordinator } from "../lib/coordinator";
import { FileGrantBroker } from "../lib/file-grant-broker";
import { scanSummary } from "../lib/summary-scan";
import {
  ownershipAt,
  transitionOwnership,
  type OwnershipHistory,
} from "../lib/ownership";
const require = createRequire(import.meta.url);
const sample =
  "AI Footprint Tracker synthetic attachment test.\nThe only test marker is FERN-ATTACHMENT-042.\nThis file contains no personal, customer or company information.\n";
const sender = {
  id: "extension",
  tab: { id: 1 },
  frameId: 0,
  documentId: "actual-capture-document",
  url: "https://chatgpt.com/",
};
function actualWorker() {
  const compiled = ts.transpileModule(
    readFileSync(new URL("../lib/file.worker.ts", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const worker = new Worker(
    `require(${JSON.stringify(require.resolve("tsx/cjs"))});const {parentPort}=require('node:worker_threads');global.self=globalThis;self.postMessage=value=>parentPort.postMessage(value);const r=require('node:module').createRequire(${JSON.stringify(import.meta.url)});new Function('require','exports',${JSON.stringify(compiled)})(name=>name==='@footprint/file-text/pdf-worker?worker&url'?{default:''}:r(name==='./counting-worker-config'?'../lib/counting-worker-config.ts':name),{});parentPort.on('message',data=>self.onmessage({data}));`,
    { eval: true },
  );
  return {
    count: (job: any) =>
      new Promise<any>((resolve, reject) => {
        worker.once("message", resolve);
        worker.once("error", reject);
        const bytes = job.bytes.slice(0);
        worker.postMessage({ ...job, bytes }, [bytes]);
      }),
    close: () => worker.terminate(),
  };
}
async function setup(real = false) {
  const db = await Ledger.open("uploaded-association-" + crypto.randomUUID());
  const displays: any[] = [];
  let c: Coordinator;
  let fence = 0;
  db.onRoutingChange(() => fence++);
  const worker = real ? actualWorker() : null;
  let countFile = (job: any) =>
    worker ? worker.count(job) : countAccessibleFile(job);
  let parentAllowed = true;
  const broker = new FileGrantBroker({
    extensionId: "extension",
    relayUrl: "moz-extension://extension/file-relay.html",
    routingVersion: () => fence,
    parentCurrent: async () => parentAllowed,
    count: async (job) => countFile(job),
    snapshot: async (observedAt) => {
      const scope = await c.currentScope(),
        history = await db.get<OwnershipHistory>("policy", "ownership-history"),
        settings = await c.settings(),
        state = await db.publicationSnapshot(scope.namespace);
      if (
        canonicalJson(ownershipAt(history!, observedAt).scope) !==
          canonicalJson(scope) ||
        state.erasing ||
        canonicalJson(state.ownership.scope) !== canonicalJson(scope) ||
        settings.paused
      )
        throw Error("file_unavailable");
      return JSON.stringify({
        scope,
        erasureVersion: state.erasureVersion,
        ownershipStart: state.ownership.start,
        ownershipEnd: state.ownership.end,
        deviceId: state.credentials?.device_id ?? null,
        enrollmentState: state.credentials?.enrollment_state ?? null,
      });
    },
  });
  const access = {
    readReceipt: broker.readReceipt.bind(broker),
    onReceipt: broker.onReceipt.bind(broker),
  };
  const dependencies = {
    estimation: archivedEstimation,
    hasConsent: async () => true,
    transport: async () => new Response("{}", { status: 503 }),
    sendDisplay: async (_tabId: number, display: unknown) => {
      displays.push(display);
    },
    extensionId: "extension",
    fileReceipts: access,
    count: countWithBundledTokenizer,
  };
  c = new Coordinator(db, dependencies);
  await c.whenReady();
  let scope = await c.currentScope();
  const binding = {
    documentNonce: crypto.randomUUID(),
    navigationNonce: crypto.randomUUID(),
    captureId: null,
  };
  async function upload(text = sample, hold?: Promise<void>) {
    const fileHandle = crypto.randomUUID(),
      bytes = new TextEncoder().encode(text).buffer,
      observedAt = Date.now();
    const grant = await broker.issue(
      {
        target: "file-grant",
        binding,
        fileHandle,
        kind: "text",
        size: bytes.byteLength,
        observedAt,
      },
      sender,
    );
    assert.equal(grant.status, "granted");
    if (grant.status !== "granted") throw Error();
    const relay = {
        id: "extension",
        tab: { id: 1 },
        frameId: 9,
        documentId: "relay-" + crypto.randomUUID(),
        url: "moz-extension://extension/file-relay.html",
      },
      nonce = crypto.randomUUID();
    const redeemed = await broker.redeem(
      {
        target: "file-relay-redeem",
        grant: grant.grant,
        parentOrigin: "https://chatgpt.com",
        relayNonce: nonce,
      },
      relay,
    );
    assert.equal(redeemed.status, "redeemed");
    const old = countFile;
    if (hold)
      countFile = async (job) => {
        await hold;
        return old(job);
      };
    const work = broker
      .submit(
        {
          target: "file-relay-count",
          token: redeemed.token,
          relayNonce: nonce,
          job: { jobId: redeemed.spec.jobId, revision: 1, kind: "text", bytes },
        },
        relay,
        true,
      )
      .finally(() => {
        countFile = old;
      });
    if (!hold) assert.equal((await work).status, "complete");
    return { fileHandle, observedAt, work };
  }
  function capture(
    input = "ordinary prompt",
    parentId: string | null = null,
    wireId = crypto.randomUUID(),
    conversationId = "synthetic-conversation",
  ) {
    const id = crypto.randomUUID();
    const dispatch = parseDispatch(
      "chatgpt",
      new URL("https://chatgpt.com/backend-api/f/conversation"),
      JSON.stringify({
        conversation_id: conversationId,
        parent_message_id: parentId,
        messages: [
          {
            id: wireId,
            author: { role: "user" },
            content: { parts: [input] },
            metadata: {
              attachments: [
                {
                  id: "file_00000000000000000000000000000001",
                  size: 158,
                  name: "PRIVATE_NAME",
                  mime_type: "text/plain",
                  source: "local",
                  library_file_id: "PRIVATE_LIBRARY",
                  is_big_paste: false,
                },
              ],
            },
          },
        ],
      }),
    );
    return {
      message: {
        channel: "ai-footprint-observation-v1" as const,
        version: 1 as const,
        id,
        revision: 1,
        event: "dispatch" as const,
        site: "chatgpt" as const,
        at: new Date().toISOString(),
        dispatch,
        snapshot: initialSnapshot(),
        failure: null,

        timing: null,
      },
      binding: { ...binding, captureId: id },
    };
  }
  async function send(
    value: ReturnType<typeof capture>,
    end = false,
    text = "answer",
    outputId = "synthetic-output",
  ) {
    await c.capture(
      end
        ? {
            ...value.message,
            revision: 2,
            event: "end",
            dispatch: null,
            snapshot: {
              ...initialSnapshot(),
              started: true,
              state: "completed",
              text,
              outputId,
              conversationId: value.message.dispatch?.conversationId ?? null,
            },
          }
        : value.message,
      sender,
      value.binding,
    );
  }
  async function associate(
    value: ReturnType<typeof capture>,
    files: Array<{ fileHandle: string }>,
    unmatched = 0,
  ) {
    for (const file of files)
      assert.deepEqual(
        await broker.bind(
          {
            target: "file-receipt-bind",
            binding,
            fileHandle: file.fileHandle,
            captureId: value.message.id,
          },
          sender,
        ),
        { bound: true },
      );
    const association = {
      channel: "ai-footprint-upload-association-v1",
      captureId: value.message.id,
      status: unmatched ? "partial" : "matched",
      unmatchedReferenceCount: unmatched,
      files: files.map((file) => ({
        fileHandle: file.fileHandle,
        origin: "new_upload",
      })),
    };
    const message = {
      target: "file-capture-association",
      binding: value.binding,
      association,
    };
    const reply = await c.associateUploadedFiles(message, sender);
    assert.equal(reply.accepted, true);
    await c.settleUploadedFiles();
    return message;
  }
  return {
    db,
    displays,
    get c() {
      return c;
    },
    broker,
    access,
    scope,
    binding,
    upload,
    capture,
    send,
    associate,
    async request() {
      return (await db.rows(scope.namespace)).filter(
        (row) => row.record.kind === "request",
      );
    },
    async attempts() {
      return (await db.rows(scope.namespace)).filter(
        (row) => row.record.kind === "attempt",
      );
    },
    async connect() {
      const company: Scope = {
        namespace: "company:" + crypto.randomUUID() + ":" + crypto.randomUUID(),
        mode: "company",
        era: crypto.randomUUID(),
      };
      const history = await db.get<OwnershipHistory>(
        "policy",
        "ownership-history",
      );
      await db.policyTransaction([
        {
          key: "credentials",
          namespace: company.namespace,
          device_id: crypto.randomUUID(),
          origin: "https://company.example",
          enrollment_era: { id: company.era },
          policy: { pause_mode: "user_controlled" },
        },
        transitionOwnership(history!, {
          scope: company,
          secret: "b".repeat(64),
          policyVersion: "1.0.0",
        }) as any,
      ]);
      return company;
    },
    restart() {
      c = new Coordinator(db, dependencies);
    },
    rejectParent() {
      parentAllowed = false;
    },
    async close() {
      broker.invalidate();
      db.close();
      await worker?.close();
    },
  };
}

test("real worker33 receipt revises only its existing request and preserves numeric-only historical hashes and ordinary totals", async () => {
  const f = await setup(true);
  try {
    const file = await f.upload();
    const capture = f.capture();
    await f.send(capture);
    await f.send(capture, true);
    await f.c.settleConversationDisplays();
    const before = (await f.request())[0]!,
      attempt = (await f.attempts())[0]!,
      summary = await scanSummary(f.db, f.scope.namespace),
      previousHash = before.hash;
    await f.associate(capture, [file]);
    const after = (await f.request())[0]!.record as any;
    assert.equal(after.documents.extracted_text[0].tokens.value, "33");
    assert.equal(after.documents.extracted_text[0].origin, "new_upload");
    assert.equal(after.documents.upload_count, null);
    assert.equal(after.documents.processing, "unknown");
    assert.equal(
      after.documents.extracted_text[0].tokens.completeness,
      "complete_for_scope",
    );
    assert.notEqual(
      after.documents.extracted_text[0].component_id,
      file.fileHandle,
    );
    assert.equal((await f.attempts())[0]!.hash, attempt.hash);
    const next = await scanSummary(f.db, f.scope.namespace);
    for (const key of ["requests", "attempts", "tokens", "metrics"] as const)
      assert.deepEqual(next[key], summary[key]);
    assert.equal(next.file_text[0]!.value, "33");
    const old = (await f.db.all<any>("measurements")).find(
      (row) => row.hash === previousHash,
    );
    assert.equal(payloadHash(old.record), previousHash);
    for (const store of [
      "requests",
      "attempts",
      "measurements",
      "outbox",
      "local_estimates",
    ] as const) {
      const serialized = JSON.stringify(await f.db.all(store));
      for (const marker of [
        "FERN-ATTACHMENT",
        "PRIVATE_NAME",
        "PRIVATE_LIBRARY",
        "extracted_content",
        file.fileHandle,
      ])
        assert.ok(!serialized.includes(marker), store + ":" + marker);
    }
  } finally {
    await f.close();
  }
});

test("pending receipt stays unknown and later completion revises once without advancing capture revision", async () => {
  const f = await setup();
  let release!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  try {
    const file = await f.upload(sample, hold),
      capture = f.capture();
    await f.send(capture);
    const before = (await f.request())[0]!.record as any;
    const message = await f.associate(capture, [file]);
    assert.equal(
      ((await f.request())[0]!.record as any).documents.extracted_text,
      null,
    );
    release();
    await file.work;
    await f.c.settleUploadedFiles();
    const result = (await f.request())[0]!.record as any;
    assert.equal(result.documents.extracted_text[0].tokens.value, "33");
    assert.equal(result.revision, before.revision + 1);
    const hash = payloadHash(result);
    assert.equal(
      (await f.c.associateUploadedFiles(message, sender)).accepted,
      true,
    );
    await f.c.settleUploadedFiles();
    assert.equal((await f.request())[0]!.hash, hash);
    await f.send(capture, true);
    assert.deepEqual(
      ((await f.request())[0]!.record as any).documents.extracted_text,
      result.documents.extracted_text,
    );
  } finally {
    release();
    await f.close();
  }
});

test("late file-only revision preserves context provenance and committed dismissal for next-turn reconstruction", async () => {
  const f = await setup();
  try {
    await f.c.updateSettings({ budget: 1000, contextTipTokens: true });
    const file = await f.upload(),
      first = f.capture("word ".repeat(650));
    await f.send(first);
    await f.send(first, true, "word ".repeat(650), "first-output");
    await f.c.settleConversationDisplays();
    const contexts = await f.db.all<any>("context_snapshots");
    assert.equal(contexts.length, 1);
    const tokens = contexts[0].value.tokens;
    const guidance = (await f.db.all<any>("guidance_preferences"))[0];
    assert.ok(guidance);
    const actionKey = guidance.key + "#" + guidance.actionToken;
    await f.c.dismiss(actionKey);
    const action = (await f.db.all<any>("guidance_preferences"))[0];
    await f.associate(first, [file]);
    const preserved = (await f.db.all<any>("context_snapshots"))[0],
      after = (await f.db.all<any>("guidance_preferences"))[0];
    assert.equal(preserved.value.tokens, tokens);
    assert.equal(after.actionRevision, action.actionRevision);
    assert.equal(after.value.state.dismissed, true);
    assert.notEqual(
      preserved.source.requestHash,
      contexts[0].source.requestHash,
    );
    await f.c.snooze(actionKey);
    assert.ok(
      (await f.db.all<any>("guidance_preferences"))[0].value.state
        .snoozedUntil > Date.now(),
    );
    const second = f.capture("next", "first-output");
    await f.send(second);
    const records = await f.attempts();
    const latest =
      records.find(
        (row) => row.record.request_id !== preserved.source.requestId,
      ) ?? records.at(-1)!;
    assert.equal(
      (latest.record as any).tokens.logical_input_total.value,
      (BigInt(tokens) + 1n).toString(),
    );
  } finally {
    await f.close();
  }
});

test("two files read in reverse completion order remain separate, partial references stay visible without invented components", async () => {
  const f = await setup();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  try {
    const a = await f.upload("alpha"),
      b = await f.upload("beta"),
      capture = f.capture();
    await f.send(capture);
    const read = f.access.readReceipt;
    f.access.readReceipt = async (value, owner) => {
      const result = await read(value, owner);
      if (value.fileHandle === a.fileHandle) await gate;
      return result;
    };
    for (const file of [a, b])
      assert.deepEqual(
        await f.broker.bind(
          {
            target: "file-receipt-bind",
            binding: f.binding,
            fileHandle: file.fileHandle,
            captureId: capture.message.id,
          },
          sender,
        ),
        { bound: true },
      );
    const message = {
      target: "file-capture-association",
      binding: capture.binding,
      association: {
        channel: "ai-footprint-upload-association-v1",
        captureId: capture.message.id,
        status: "partial",
        unmatchedReferenceCount: 1,
        files: [a, b].map((file) => ({
          fileHandle: file.fileHandle,
          origin: "new_upload",
        })),
      },
    };
    assert.equal(
      (await f.c.associateUploadedFiles(message, sender)).accepted,
      true,
    );
    await f.send(capture, true);
    release();
    await f.c.settleUploadedFiles();
    const request = (await f.request())[0]!.record as any;
    assert.equal(request.documents.extracted_text.length, 2);
    assert.ok(request.coverage_reasons.includes("partial_capture"));
    assert.ok(
      request.documents.extracted_text.every(
        (item: any) => item.tokens.completeness === "complete_for_scope",
      ),
    );
    const ids = request.documents.extracted_text.map(
      (item: any) => item.component_id,
    );
    await f.c.associateUploadedFiles(message, sender);
    await f.c.settleUploadedFiles();
    assert.deepEqual(
      ((await f.request())[0]!.record as any).documents.extracted_text.map(
        (item: any) => item.component_id,
      ),
      ids,
    );
  } finally {
    release();
    await f.close();
  }
});

test("upload-before-Connect and cross-tab/capture/binding messages never reassign a file receipt", async () => {
  const f = await setup();
  try {
    const file = await f.upload(),
      capture = f.capture();
    await f.send(capture);
    const other = f.capture();
    await f.send(other);
    await f.broker.bind(
      {
        target: "file-receipt-bind",
        binding: f.binding,
        fileHandle: file.fileHandle,
        captureId: capture.message.id,
      },
      sender,
    );
    const message = {
      target: "file-capture-association",
      binding: capture.binding,
      association: {
        channel: "ai-footprint-upload-association-v1",
        captureId: capture.message.id,
        status: "matched",
        unmatchedReferenceCount: 0,
        files: [{ fileHandle: file.fileHandle, origin: "new_upload" }],
      },
    };
    for (const owner of [
      { ...sender, id: "other" },
      { ...sender, tab: { id: 2 } },
      { ...sender, documentId: "other" },
      { ...sender, frameId: 1 },
    ])
      assert.equal(
        (await f.c.associateUploadedFiles(message, owner)).accepted,
        false,
      );
    assert.equal(
      (
        await f.c.associateUploadedFiles(
          {
            ...message,
            binding: {
              ...capture.binding,
              navigationNonce: crypto.randomUUID(),
            },
          },
          sender,
        )
      ).accepted,
      false,
    );
    assert.equal(
      (
        await f.c.associateUploadedFiles(
          { ...message, rawText: "PRIVATE" },
          sender,
        )
      ).accepted,
      false,
    );
    await f.c.associateUploadedFiles(
      {
        ...message,
        binding: other.binding,
        association: { ...message.association, captureId: other.message.id },
      },
      sender,
    );
    await f.c.settleUploadedFiles();
    assert.ok(
      (await f.request()).every(
        (row) => (row.record as any).documents.extracted_text === null,
      ),
    );
    const company = await f.connect();
    assert.equal(
      (await f.c.associateUploadedFiles(message, sender)).accepted,
      false,
    );
    assert.equal((await f.db.rows(company.namespace)).length, 0);
    assert.ok(
      (await f.request()).every(
        (row) => (row.record as any).documents.extracted_text === null,
      ),
    );
  } finally {
    await f.close();
  }
});

for (const phase of ["read", "commit"] as const)
  test(`family erasure during file ${phase} prevents request, cache and outbox resurrection`, async () => {
    const f = await setup();
    try {
      const file = await f.upload(),
        capture = f.capture();
      await f.send(capture);
      const request = (await f.request())[0]!.record;
      const read = f.access.readReceipt;
      const commit = f.db.commit.bind(f.db);
      let erased = false;
      if (phase === "read")
        f.access.readReceipt = async (...args) => {
          const value = await read(...args);
          if (!erased) {
            erased = true;
            await f.db.eraseFamily(f.scope.namespace, request.request_id);
          }
          return value;
        };
      else
        f.db.commit = async (...args) => {
          if (args[3]?.requestFileMetadata && !erased) {
            erased = true;
            await f.db.eraseFamily(f.scope.namespace, request.request_id);
          }
          return commit(...args);
        };
      await f.associate(capture, [file]);
      assert.equal(erased, true);
      assert.equal((await f.db.rows(f.scope.namespace)).length, 0);
      assert.equal((await f.db.all("provider_key_map")).length, 0);
      assert.equal((await f.db.all("context_snapshots")).length, 0);
      assert.equal((await f.db.all("outbox")).length, 0);
    } finally {
      await f.close();
    }
  });

test("pause then resume between receipt read and transaction cannot commit the old numerical capability", async () => {
  const f = await setup();
  try {
    const file = await f.upload(),
      capture = f.capture();
    await f.send(capture);
    const original = f.db.commit.bind(f.db);
    let paused = false;
    f.db.commit = async (...args) => {
      if (args[3]?.requestFileMetadata && !paused) {
        paused = true;
        await f.c.updateSettings({ paused: true });
        f.broker.invalidate();
        await f.c.updateSettings({ paused: false });
      }
      return original(...args);
    };
    await f.associate(capture, [file]);
    assert.equal(paused, true);
    assert.equal(
      ((await f.request())[0]!.record as any).documents.extracted_text,
      null,
    );
  } finally {
    await f.close();
  }
});

test("canonical duplicate request keeps one component set and never unions another capture upload handle", async () => {
  const f = await setup();
  try {
    const wireId = crypto.randomUUID(),
      a = await f.upload(),
      first = f.capture("ordinary prompt", null, wireId);
    await f.send(first);
    await f.associate(first, [a]);
    const baseline = await scanSummary(f.db, f.scope.namespace);
    const b = await f.upload("different"),
      duplicate = f.capture("ordinary prompt", null, wireId);
    await f.send(duplicate);
    await f.associate(duplicate, [b]);
    const result = await scanSummary(f.db, f.scope.namespace);
    assert.equal(result.requests, 1);
    assert.deepEqual(result.file_text, baseline.file_text);
    assert.equal(result.file_text[0]!.contributing_component_count, 1);
  } finally {
    await f.close();
  }
});

test("failed extraction is unknown, and a restarted worker cannot reuse expired receipt metadata to revise retained history", async () => {
  const f = await setup();
  try {
    const file = await f.upload("\uD800"),
      capture = f.capture();
    await f.send(capture);
    const read = f.access.readReceipt;
    f.access.readReceipt = async (...args) => {
      const result = await read(...args);
      if (result.result) {
        result.result.status = "unavailable";
        result.result.reason = "malformed_file";
        result.result.tokens = null;
        result.result.tokenizerProfile = null;
        result.result.tokenizerAssetHash = null;
        result.result.extractedTextBytes = null;
        result.result.pages = null;
        result.result.textParts = null;
        result.result.evidence = "unknown";
        result.result.coverage = "unavailable";
        result.status = "unavailable";
      }
      return result;
    };
    const message = await f.associate(capture, [file]);
    const record = (await f.request())[0]!;
    assert.equal(
      (record.record as any).documents.extracted_text[0].tokens.value,
      null,
    );
    assert.equal(
      (record.record as any).documents.extracted_text[0].tokens.reason,
      "partial_capture",
    );
    await f.send(capture, true);
    const hash = (await f.request())[0]!.hash;
    f.broker.invalidate();
    f.restart();
    await f.c.whenReady();
    await f.send(capture, true);
    await f.c.associateUploadedFiles(message, sender);
    await f.c.settleUploadedFiles();
    assert.equal((await f.request())[0]!.hash, hash);
  } finally {
    await f.close();
  }
});

for (const streamFailure of [false, true]) {
  test(`file-only partial recovery preserves independent coverage (stream failure ${streamFailure})`, async () => {
    const f = await setup();
    try {
      const first = await f.upload("first"),
        second = await f.upload("second"),
        capture = f.capture();
      await f.send(capture);
      await f.associate(capture, [first], 1);
      const partial = (await f.request())[0]!.record;
      assert.ok(partial.coverage_reasons.includes("partial_capture"));
      const independent = partial.coverage_reasons.filter(
        (value) => value !== "partial_capture",
      );
      if (streamFailure) {
        await f.c.capture(
          {
            ...capture.message,
            revision: 2,
            event: "end",
            dispatch: null,
            failure: "capture_interrupted",
          },
          sender,
          capture.binding,
        );
        assert.ok(
          (await f.attempts())[0]!.record.coverage_reasons.includes(
            "partial_capture",
          ),
        );
      }
      await f.associate(capture, [first, second]);
      const completed = (await f.request())[0]!.record as any;
      assert.equal(completed.documents.extracted_text.length, 2);
      assert.equal(
        completed.coverage_reasons.includes("partial_capture"),
        streamFailure,
      );
      for (const reason of independent)
        assert.ok(completed.coverage_reasons.includes(reason));
      assert.ok(
        completed.documents.extracted_text.every(
          (item: any) => item.tokens.completeness === "complete_for_scope",
        ),
      );
    } finally {
      await f.close();
    }
  });
}

test("company upload association queues only a validated numerical request revision", async () => {
  const f = await setup();
  try {
    const scope = await f.connect();
    await new Promise((resolve) => setTimeout(resolve, 2));
    const file = await f.upload(),
      capture = f.capture();
    await f.send(capture);
    const before = (await f.db.rows(scope.namespace)).find(
      (row) => row.record.kind === "attempt",
    )!;
    await f.associate(capture, [file]);
    const rows = await f.db.rows(scope.namespace),
      request = rows.find((row) => row.record.kind === "request")!;
    assert.equal(
      (request.record as any).documents.extracted_text[0].tokens.value,
      "33",
    );
    assert.equal(
      rows.find((row) => row.record.kind === "attempt")!.hash,
      before.hash,
    );
    const queue = await f.db.all<any>("outbox");
    assert.ok(queue.some((row) => row.hash === request.hash));
    const serialized = JSON.stringify(queue);
    for (const marker of [
      "FERN-ATTACHMENT",
      "PRIVATE_NAME",
      "PRIVATE_LIBRARY",
      file.fileHandle,
    ])
      assert.ok(!serialized.includes(marker));
  } finally {
    await f.close();
  }
});

test("previous observation schemas are rejected without changing the latest saved records", async () => {
  const f = await setup();
  try {
    await f.send(f.capture());
    const before = (await f.request())[0]!;
    assert.equal(before.record.schema_version, "3.0.0");
    const previous = structuredClone(before.record) as any;
    previous.schema_version = "1.1.0";
    delete previous.documents.extracted_text;
    await assert.rejects(
      f.db.commit(await f.c.currentScope(), [previous]),
      (error: any) =>
        error?.name === "ZodError" &&
        error.issues
          .flatMap((issue: any) => issue.errors?.flat() ?? [issue])
          .some((issue: any) => issue.path.includes("schema_version")),
    );
    assert.equal((await f.request())[0]!.hash, before.hash);
  } finally {
    await f.close();
  }
});

test("file component growth respects the shared100 bound without truncating stored measurements", async () => {
  const f = await setup();
  try {
    const first = await f.upload("one"),
      second = await f.upload("two"),
      capture = f.capture();
    await f.send(capture);
    await f.associate(capture, [first], 1);
    const row = (await f.request())[0]!,
      request = structuredClone(row.record) as any;
    request.revision++;
    request.documents.extracted_text = Array.from(
      { length: 100 },
      (_, index) => ({
        ...request.documents.extracted_text[0],
        component_id: index
          ? crypto.randomUUID()
          : request.documents.extracted_text[0].component_id,
      }),
    );
    const job = (await f.db.all<any>("provider_key_map")).find(
      (item) => item.request?.id === request.id,
    )!;
    await f.db.commit(
      f.scope,
      [request],
      [{ store: "provider_key_map", value: { ...job, request } }],
    );
    const before = (await f.request())[0]!.hash;
    await f.associate(capture, [first, second]);
    assert.equal((await f.request())[0]!.hash, before);
    assert.equal(
      ((await f.request())[0]!.record as any).documents.extracted_text.length,
      100,
    );
  } finally {
    await f.close();
  }
});

test("late real file33 receipt refreshes the ended selected view without another capture and preserves dismissed advice", async () => {
  const f = await setup(true);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  try {
    await f.c.updateSettings({ budget: 1000, contextTipTokens: true });
    const file = await f.upload(sample, gate),
      capture = f.capture(
        "word ".repeat(650),
        null,
        crypto.randomUUID(),
        crypto.randomUUID(),
      );
    await f.send(capture);
    await f.send(capture, true, "word ".repeat(650));
    await f.c.settleConversationDisplays();
    const before = f.displays.at(-1);
    assert.equal(before.summary.file_text.length, 0);
    await f.associate(capture, [file]);
    await f.c.dismiss(before.guidance.key);
    f.displays.length = 0;
    release();
    await file.work;
    await f.c.settleUploadedFiles();
    await f.c.settleConversationDisplays();
    assert.ok(f.displays.length > 0);
    const after = f.displays.at(-1);
    assert.equal(after.summary.file_text[0].value, "33");
    assert.deepEqual(after.displayBinding, capture.binding);
    assert.deepEqual(after.conversationIdentity, before.conversationIdentity);
    assert.equal(after.guidance.show, false);
    assert.equal(after.guidance.state.dismissed, true);
    for (const key of ["requests", "attempts", "tokens", "metrics"])
      assert.deepEqual(after.summary[key], before.summary[key]);
  } finally {
    release();
    await f.close();
  }
});

for (const sameConversation of [true, false]) {
  test(`late A file refresh keeps newer B selection (same conversation ${sameConversation})`, async () => {
    const f = await setup();
    try {
      const file = await f.upload(),
        conversationId = crypto.randomUUID(),
        a = f.capture("first", null, crypto.randomUUID(), conversationId);
      await f.send(a);
      await f.send(a, true, "answerA", "outputA");
      const b = f.capture(
        "word ".repeat(650),
        null,
        crypto.randomUUID(),
        sameConversation ? conversationId : crypto.randomUUID(),
      );
      await f.send(b);
      await f.send(b, true, "answerB", "outputB");
      await f.c.settleConversationDisplays();
      const before = f.displays.at(-1);
      f.displays.length = 0;
      await f.associate(a, [file]);
      await f.c.settleConversationDisplays();
      if (!sameConversation) {
        assert.equal(f.displays.length, 0);
        return;
      }
      assert.ok(f.displays.length > 0);
      for (const display of f.displays) {
        assert.deepEqual(display.displayBinding, b.binding);
        assert.deepEqual(
          display.conversationIdentity,
          before.conversationIdentity,
        );
        assert.equal(display.activeContext, before.activeContext);
        assert.deepEqual(display.guidance, before.guidance);
        assert.equal(display.summary.file_text[0].value, "33");
      }
    } finally {
      await f.close();
    }
  });
}

for (const lifecycle of ["erase", "navigation", "enrollment"] as const) {
  test(`late file display refresh discards ${lifecycle} changes during its final queue await`, async () => {
    const f = await setup();
    try {
      const file = await f.upload(),
        capture = f.capture();
      await f.send(capture);
      await f.send(capture, true);
      await f.c.settleConversationDisplays();
      f.displays.length = 0;
      const pending = f.db.application.pendingCount.bind(f.db.application);
      let changed = false;
      f.db.application.pendingCount = async (namespace) => {
        const value = await pending(namespace);
        if (!changed) {
          changed = true;
          if (lifecycle === "erase")
            await f.db.applyRange(
              f.scope,
              null,
              new Date(Date.now() + 10000).toISOString(),
              1,
            );
          else if (lifecycle === "navigation")
            f.c.invalidateDisplay(sender.tab.id, f.binding.documentNonce);
          else await f.connect();
        }
        return value;
      };
      await f.associate(capture, [file]);
      await f.c.settleConversationDisplays();
      assert.ok(changed);
      assert.equal(f.displays.length, 0);
    } finally {
      await f.close();
    }
  });
}

test("file refresh applies a snooze committed during its final snapshot without reopening advice", async () => {
  const f = await setup();
  try {
    await f.c.updateSettings({ budget: 1000, contextTipTokens: true });
    const file = await f.upload(),
      capture = f.capture("word ".repeat(650));
    await f.send(capture);
    await f.send(capture, true, "word ".repeat(650));
    await f.c.settleConversationDisplays();
    const key = f.displays.at(-1).guidance.key;
    f.displays.length = 0;
    const snapshot = f.db.publicationSnapshot.bind(f.db);
    let snoozed = false;
    f.db.publicationSnapshot = async (namespace, source, guidance) => {
      if (guidance && !snoozed) {
        snoozed = true;
        await f.c.snooze(key);
      }
      return snapshot(namespace, source, guidance);
    };
    await f.associate(capture, [file]);
    await f.c.settleConversationDisplays();
    assert.ok(snoozed);
    assert.ok(f.displays.length > 0);
    for (const display of f.displays) {
      assert.equal(display.guidance.show, false);
      assert.ok(display.guidance.state.snoozedUntil > Date.now());
      assert.equal(display.summary.file_text[0].value, "33");
    }
  } finally {
    await f.close();
  }
});

for (const total of [4, 16]) {
  test(`association drain fairly continues ${total} accepted monotonic expansions`, async () => {
    const f = await setup();
    try {
      const files: Array<Awaited<ReturnType<typeof f.upload>>> = [];
      for (let i = 0; i < total; i++) files.push(await f.upload("hello " + i));
      const capture = f.capture();
      await f.send(capture);
      for (const file of files)
        assert.equal(
          (
            await f.broker.bind(
              {
                target: "file-receipt-bind",
                binding: f.binding,
                fileHandle: file.fileHandle,
                captureId: capture.message.id,
              },
              sender,
            )
          ).bound,
          true,
        );
      let size = 1;
      const message = () => ({
        target: "file-capture-association",
        binding: capture.binding,
        association: {
          channel: "ai-footprint-upload-association-v1",
          captureId: capture.message.id,
          status: size === total ? "matched" : "partial",
          unmatchedReferenceCount: total - size,
          files: files.slice(0, size).map((file) => ({
            fileHandle: file.fileHandle,
            origin: "new_upload",
          })),
        },
      });
      const read = f.access.readReceipt;
      f.access.readReceipt = async (value, owner) => {
        const result = await read(value, owner);
        if (value.fileHandle === files[0]!.fileHandle && size < total) {
          size++;
          assert.equal(
            (await f.c.associateUploadedFiles(message(), sender)).accepted,
            true,
          );
        }
        return result;
      };
      assert.equal(
        (await f.c.associateUploadedFiles(message(), sender)).accepted,
        true,
      );
      await f.c.settleUploadedFiles();
      await f.c.settleConversationDisplays();
      const request = (await f.request())[0]!;
      assert.equal(
        (request.record as any).documents.extracted_text.length,
        total,
      );
      assert.ok(!request.record.coverage_reasons.includes("partial_capture"));
      const shown = f.displays.length;
      await f.c.associateUploadedFiles(message(), sender);
      await f.c.settleUploadedFiles();
      await f.c.settleConversationDisplays();
      assert.equal((await f.request())[0]!.hash, request.hash);
      assert.equal(f.displays.length, shown);
      assert.equal((f.c as any).uploadWake, null);
    } finally {
      f.c.invalidateUploadedFiles();
      await f.close();
    }
  });
}

test("display drain continues the fourth committed update after three stale guarded publications", async () => {
  const f = await setup();
  try {
    const files: Array<Awaited<ReturnType<typeof f.upload>>> = [];
    for (let i = 0; i < 4; i++) files.push(await f.upload("hello " + i));
    const capture = f.capture();
    await f.send(capture);
    await f.send(capture, true);
    await f.c.settleConversationDisplays();
    let size = 1;
    const pending = f.db.application.pendingCount.bind(f.db.application);
    f.db.application.pendingCount = async (namespace) => {
      const value = await pending(namespace);
      if (size < 4) {
        size++;
        await f.associate(capture, files.slice(0, size), 4 - size);
      }
      return value;
    };
    await f.associate(capture, files.slice(0, 1), 3);
    await f.c.settleUploadedFiles();
    await f.c.settleConversationDisplays();
    assert.equal(
      ((await f.request())[0]!.record as any).documents.extracted_text.length,
      4,
    );
    assert.equal(
      f.displays.at(-1).summary.file_text[0].contributing_component_count,
      4,
    );
    assert.equal((f.c as any).fileDisplayPending.size, 0);
    assert.equal((f.c as any).displayWake, null);
  } finally {
    f.c.invalidateUploadedFiles();
    await f.close();
  }
});

for (const invalidation of ["reset", "expiry"] as const) {
  test(`queued association continuation respects ${invalidation}`, async () => {
    const f = await setup();
    try {
      const files: Array<Awaited<ReturnType<typeof f.upload>>> = [];
      for (let i = 0; i < 4; i++) files.push(await f.upload("hello " + i));
      const capture = f.capture();
      await f.send(capture);
      for (const file of files)
        await f.broker.bind(
          {
            target: "file-receipt-bind",
            binding: f.binding,
            fileHandle: file.fileHandle,
            captureId: capture.message.id,
          },
          sender,
        );
      let size = 1;
      const message = () => ({
        target: "file-capture-association",
        binding: capture.binding,
        association: {
          channel: "ai-footprint-upload-association-v1",
          captureId: capture.message.id,
          status: size === 4 ? "matched" : "partial",
          unmatchedReferenceCount: 4 - size,
          files: files.slice(0, size).map((file) => ({
            fileHandle: file.fileHandle,
            origin: "new_upload",
          })),
        },
      });
      const read = f.access.readReceipt;
      f.access.readReceipt = async (value, owner) => {
        const result = await read(value, owner);
        if (value.fileHandle === files[0]!.fileHandle && size < 4) {
          size++;
          await f.c.associateUploadedFiles(message(), sender);
        }
        return result;
      };
      const wake = (f.c as any).wakeUploadedFiles.bind(f.c);
      let invalidated = false;
      (f.c as any).wakeUploadedFiles = () => {
        wake();
        if (!invalidated) {
          invalidated = true;
          if (invalidation === "reset") f.c.invalidateUploadedFiles();
          else
            for (const entry of (f.c as any).uploadAssociations.values())
              entry.expires = Date.now() - 1;
        }
      };
      await f.c.associateUploadedFiles(message(), sender);
      await f.c.settleUploadedFiles();
      await f.c.settleConversationDisplays();
      assert.ok(invalidated);
      assert.equal(
        ((await f.request())[0]!.record as any).documents.extracted_text.length,
        3,
      );
      assert.equal((f.c as any).uploadAssociations.size, 0);
    } finally {
      f.c.invalidateUploadedFiles();
      await f.close();
    }
  });
}

test("display capacity release wakes one preserved pending set without polling", async () => {
  const f = await setup();
  let release!: () => void;
  try {
    const file = await f.upload(),
      capture = f.capture();
    await f.send(capture);
    await f.send(capture, true);
    await f.c.settleConversationDisplays();
    f.displays.length = 0;
    const gate = new Promise<void>((done) => (release = done)),
      work = (f.c as any).displayWork as Set<Promise<void>>;
    for (let i = 0; i < 16; i++) {
      const slot = gate.then(() => {
        work.delete(slot);
      });
      work.add(slot);
    }
    await f.associate(capture, [file]);
    assert.equal(f.displays.length, 0);
    assert.equal((f.c as any).fileDisplayPending.size, 1);
    assert.equal((f.c as any).displayWake, null);
    const waiting = (f.c as any).displayCapacity;
    assert.ok(waiting);
    for (let i = 0; i < 10; i++) (f.c as any).wakeFileDisplays();
    assert.equal((f.c as any).displayCapacity, waiting);
    release();
    await f.c.settleConversationDisplays();
    assert.equal(f.displays.length, 1);
    assert.equal(f.displays[0].summary.file_text[0].value, "33");
    assert.equal((f.c as any).fileDisplayPending.size, 0);
  } finally {
    release?.();
    f.c.invalidateUploadedFiles();
    await f.close();
  }
});

test("every slow successful receipt read is consumed once after its logical deadline", async () => {
  const f = await setup();
  try {
    const files = [await f.upload(), await f.upload()],
      capture = f.capture();
    await f.send(capture);
    const read = f.access.readReceipt;
    let reads = 0;
    let resolve!: () => void;
    const completed = new Promise<void>((done) => (resolve = done));
    f.access.readReceipt = async (value, owner) => {
      reads++;
      await new Promise((done) => setTimeout(done, 5200));
      const result = await read(value, owner);
      if (reads === 2) resolve();
      return result;
    };
    await f.associate(capture, files);
    assert.equal(
      ((await f.request())[0]!.record as any).documents.extracted_text,
      null,
    );
    await completed;
    await new Promise((done) => setTimeout(done, 20));
    await f.c.settleUploadedFiles();
    await f.c.settleConversationDisplays();
    assert.equal(reads, 2);
    assert.equal(
      ((await f.request())[0]!.record as any).documents.extracted_text.length,
      2,
    );
    assert.equal((f.c as any).uploadCompleted.size, 0);
    assert.equal((f.c as any).uploadReads.size, 0);
  } finally {
    f.c.invalidateUploadedFiles();
    await f.close();
  }
});

test("an unchanged failed receipt dependency is not retried by drain wakeups", async () => {
  const f = await setup();
  try {
    const file = await f.upload(),
      capture = f.capture();
    await f.send(capture);
    let reads = 0;
    f.access.readReceipt = async () => {
      reads++;
      throw Error("synthetic failure");
    };
    await f.associate(capture, [file]);
    await new Promise((done) => setTimeout(done, 30));
    await f.c.settleUploadedFiles();
    assert.equal(reads, 1);
    assert.equal((f.c as any).uploadWake, null);
    assert.equal((f.c as any).uploadCompleted.size, 0);
    assert.equal(
      ((await f.request())[0]!.record as any).documents.extracted_text,
      null,
    );
  } finally {
    f.c.invalidateUploadedFiles();
    await f.close();
  }
});

for (const change of ["reset", "expiry"] as const) {
  test(`display capacity wait honors ${change} before capacity release`, async () => {
    const f = await setup();
    let release!: () => void;
    try {
      const file = await f.upload(),
        capture = f.capture();
      await f.send(capture);
      await f.send(capture, true);
      await f.c.settleConversationDisplays();
      f.displays.length = 0;
      const gate = new Promise<void>((done) => (release = done)),
        work = (f.c as any).displayWork as Set<Promise<void>>;
      for (let i = 0; i < 16; i++) {
        const slot = gate.then(() => {
          work.delete(slot);
        });
        work.add(slot);
      }
      await f.associate(capture, [file]);
      assert.equal((f.c as any).fileDisplayPending.size, 1);
      if (change === "reset") f.c.invalidateUploadedFiles();
      else
        for (const entry of (f.c as any).fileDisplayPending.values())
          entry.expires = Date.now() - 1;
      release();
      await f.c.settleConversationDisplays();
      assert.equal(f.displays.length, 0);
      assert.equal((f.c as any).fileDisplayPending.size, 0);
      assert.equal((f.c as any).displayWake, null);
    } finally {
      release?.();
      f.c.invalidateUploadedFiles();
      await f.close();
    }
  });
}
