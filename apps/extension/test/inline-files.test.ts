import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Ledger } from "@footprint/ledger";
import { UsageBatchSchema } from "@footprint/contracts";
import { pythonReference } from "../../../tools/python-reference.cjs";
import {
  initialSnapshot,
  parseDispatch,
  INLINE_FILE_LIMITS,
} from "@footprint/adapters";
import { Coordinator } from "../lib/coordinator";
import { validateCapture } from "../lib/bridge";
import { transitionOwnership, type OwnershipHistory } from "../lib/ownership";
import { scanSummary } from "../lib/summary-scan";
import {
  DEFAULT_TOKENIZER_IMPLEMENTATION_ID,
  DEFAULT_TOKENIZER_PROFILE_ID,
  type CountRequest,
  type CountResponse,
} from "@footprint/tokenizers";

const require = createRequire(import.meta.url);
function counter() {
  const worker = new Worker(
    `require(${JSON.stringify(require.resolve("tsx/cjs"))});
    const {parentPort}=require('node:worker_threads');
    global.self=globalThis;self.postMessage=value=>parentPort.postMessage(value);
    require(${JSON.stringify(fileURLToPath(new URL("../lib/count.worker.ts", import.meta.url)))});
    parentPort.on('message',data=>self.onmessage({data}));`,
    { eval: true },
  );
  const pending = new Map<
    string,
    { resolve: (v: CountResponse) => void; reject: (v: Error) => void }
  >();
  let failed: Error | undefined;
  worker.on("message", (message) => {
    const item = pending.get(message.jobId);
    if (!item) return;
    pending.delete(message.jobId);
    item.resolve(message);
  });
  worker.on("error", (error) => {
    failed = error;
    for (const item of pending.values()) item.reject(error);
    pending.clear();
  });
  return {
    threadId: worker.threadId,
    count: (job: CountRequest): Promise<CountResponse> =>
      new Promise((resolve, reject) => {
        if (failed) {
          reject(failed);
          return;
        }
        pending.set(job.jobId, { resolve, reject });
        worker.postMessage({ type: "count", request: job });
      }),
    close: () => worker.terminate(),
  };
}
const sender = {
  tab: { id: 1 },
  frameId: 0,
  documentId: "synthetic-inline-document",
  url: "https://claude.ai/new",
};
const marker = "FERN_PRIVATE_INLINE_8361";
const attachment = (text: string) => ({
  file_name: "PRIVATE_NAME_927.txt",
  file_type: "text/plain",
  file_size: 158,
  extracted_content: text,
  origin: "user_upload",
  kind: "file",
});
function dispatch(texts: string[] | null, id = crypto.randomUUID()): any {
  const d = parseDispatch(
    "claude",
    new URL(
      "https://claude.ai/api/organizations/synthetic/chat_conversations/synthetic/completion",
    ),
    JSON.stringify({
      prompt: "ordinary prompt",
      attachments: texts?.map(attachment) ?? [{ unsupported: true }],
      files: [],
    }),
  );
  return {
    timing: null,
    channel: "ai-footprint-observation-v1",
    version: 1,
    id,
    revision: 1,
    event: "dispatch",
    site: "claude",
    at: new Date().toISOString(),
    dispatch: d,
    snapshot: initialSnapshot(),
    failure: null,
  };
}
async function setup(count: any) {
  const name = "inline-" + crypto.randomUUID(),
    db = await Ledger.open(name);
  const dependencies = {
    count,
    hasConsent: async () => true,
    sendDisplay: async () => {},
    transport: (async () => {
      throw new Error("unexpected_network");
    }) as typeof fetch,
  };
  const c = new Coordinator(db, dependencies);
  const scope = await c.currentScope();
  return { name, db, c, scope, dependencies };
}
async function requestRecord(f: Awaited<ReturnType<typeof setup>>) {
  return (await f.db.rows(f.scope.namespace)).find(
    (row) => row.record.kind === "request",
  )!.record as any;
}
test("actual counting worker matches frozen official reference counts for inline fields including empty and Unicode", async () => {
  const worker = counter();
  try {
    assert.ok(worker.threadId > 0);
    const corpus = JSON.parse(
      readFileSync(
        new URL("../../../calibration/tokenizer-golden.json", import.meta.url),
        "utf8",
      ),
    );
    for (const entry of corpus.cases) {
      const counts = await worker.count({
        jobId: crypto.randomUUID(),
        revision: 1,
        modelId: null,
        implementationId: DEFAULT_TOKENIZER_IMPLEMENTATION_ID,
        profileId: DEFAULT_TOKENIZER_PROFILE_ID,
        fields: { file_0: entry.text, input: "hello" },
      });
      assert.equal(
        counts.counts.file_0!.measurement.value,
        String(entry.counts.o200k_base),
        entry.id,
      );
      assert.equal(counts.counts.input!.measurement.value, "1");
      assert.equal(counts.counts.file_0!.modelExactness, "unverified");
      assert.ok(
        !JSON.stringify(counts).includes(entry.text) || entry.text.length < 5,
      );
    }
    assert.equal(
      (
        await worker.count({
          jobId: crypto.randomUUID(),
          revision: 1,
          modelId: null,
          implementationId: DEFAULT_TOKENIZER_IMPLEMENTATION_ID,
          profileId: DEFAULT_TOKENIZER_PROFILE_ID,
          fields: {
            file_0: "x".repeat(INLINE_FILE_LIMITS.textUnits),
            file_1: "x",
          },
        })
      ).reason,
      "capture_limit_exceeded",
    );
  } finally {
    await worker.close();
  }
});
test("Coordinator saves only numeric inline components and preserves ordinary tokens, context and resource totals", async () => {
  const worker = counter(),
    a = await setup(worker.count),
    b = await setup(worker.count);
  try {
    const message = dispatch([marker, "second file"]),
      plain = structuredClone(message);
    delete plain.dispatch.inlineFiles;
    await a.c.capture(message, sender);
    await b.c.capture(plain, sender);
    const r = await requestRecord(a);
    assert.equal(r.documents.upload_count, null);
    assert.equal(r.documents.processing, "unknown");
    const components = r.documents.extracted_text;
    assert.equal(components.length, 2);
    for (const component of components) {
      assert.equal(component.origin, "unknown_origin");
      assert.equal(component.page_count, null);
      assert.equal(
        component.extraction_profile_id,
        "observed-inline-file-text-v1",
      );
      assert.equal(component.tokens.scope, "extracted_file_text");
      assert.equal(component.tokens.evidence, "heuristic_estimate");
      assert.ok(component.missing.includes("provider_processing"));
    }
    const rowA = (await a.db.rows(a.scope.namespace)).find(
      (row) => row.record.kind === "attempt",
    )!;
    const rowB = (await b.db.rows(b.scope.namespace)).find(
      (row) => row.record.kind === "attempt",
    )!;
    assert.deepEqual((rowA.record as any).tokens, (rowB.record as any).tokens);
    const sumA = await scanSummary(a.db, a.scope.namespace),
      sumB = await scanSummary(b.db, b.scope.namespace);
    for (const key of ["tokens", "metrics"] as const)
      assert.deepEqual(sumA[key], sumB[key]);
    const persisted = JSON.stringify(
      await Promise.all(
        [
          "requests",
          "attempts",
          "provider_key_map",
          "outbox",
          "measurements",
          "local_estimates",
          "context_snapshots",
          "guidance_preferences",
        ].map((store) => a.db.all(store as any)),
      ),
    );
    for (const forbidden of [
      marker,
      "PRIVATE_NAME_927",
      "file_0",
      "extracted_content",
      "ordinary prompt",
    ])
      assert.ok(!persisted.includes(forbidden), forbidden);
  } finally {
    a.db.close();
    b.db.close();
    await worker.close();
  }
});

test("the observed synthetic Claude upload yields the independent 33-token reference without adding prompt tokens", async () => {
  const text =
    "AI Footprint Tracker synthetic attachment test.\nThe only test marker is FERN-ATTACHMENT-042.\nThis file contains no personal, customer or company information.\n";
  assert.equal(Buffer.byteLength(text), 158);
  assert.equal(
    createHash("sha256").update(text).digest("hex"),
    "65db80d10c295d53f93db94b057f1ef1b52469cfdb8ef9903c3c1da38bcba01e",
  );
  const worker = counter(),
    f = await setup(worker.count);
  try {
    await f.c.capture(dispatch([text, ""]), sender);
    const request = await requestRecord(f);
    assert.equal(request.documents.extracted_text[0].tokens.value, "33");
    assert.equal(request.documents.extracted_text[1].tokens.value, "0");
    assert.equal(
      request.documents.extracted_text[0].extraction_profile_id,
      "observed-inline-file-text-v1",
    );
    const attempt = (await f.db.rows(f.scope.namespace)).find(
      (row) => row.record.kind === "attempt",
    )!.record as any;
    assert.equal(attempt.tokens.new_input_text.value, "2");
    assert.equal(attempt.tokens.logical_input_total.value, "2");
  } finally {
    f.db.close();
    await worker.close();
  }
});
test("restart and capture revisions retain component identities and replace measurements rather than append", async () => {
  const worker = counter(),
    f = await setup(worker.count);
  try {
    const message = dispatch([marker, "second"]);
    await f.c.capture(message, sender);
    const first = await requestRecord(f),
      ids = first.documents.extracted_text.map((c: any) => c.component_id);
    f.db.close();
    f.db = await Ledger.open(f.name);
    f.c = new Coordinator(f.db, f.dependencies);
    await f.c.whenReady();
    await f.c.capture(
      {
        ...message,
        revision: 2,
        dispatch: { ...message.dispatch, inlineFiles: ["changed"] },
      },
      sender,
    );
    const corrected = await requestRecord(f);
    assert.equal(corrected.documents.extracted_text.length, 1);
    assert.equal(corrected.documents.extracted_text[0].component_id, ids[0]);
    assert.notEqual(
      corrected.documents.extracted_text[0].tokens.value,
      first.documents.extracted_text[0].tokens.value,
    );
    await f.c.capture(
      {
        ...message,
        revision: 3,
        event: "end",
        dispatch: null,
        snapshot: {
          ...initialSnapshot(),
          text: "reply",
          started: true,
          state: "completed",
        },
      },
      sender,
    );
    assert.deepEqual(
      (await requestRecord(f)).documents.extracted_text,
      corrected.documents.extracted_text,
    );
    await f.c.capture(
      {
        ...message,
        revision: 4,
        dispatch: { ...message.dispatch, inlineFiles: null },
      },
      sender,
    );
    assert.equal((await requestRecord(f)).documents.extracted_text, null);
    await f.c.capture(
      {
        ...message,
        revision: 5,
        dispatch: { ...message.dispatch, inlineFiles: ["recovered"] },
      },
      sender,
    );
    assert.equal(
      (await requestRecord(f)).documents.extracted_text[0].component_id,
      ids[0],
    );
  } finally {
    f.db.close();
    await worker.close();
  }
});
test("unsupported, empty and failed inline measurements preserve distinct unknown and observed-empty states", async () => {
  for (const texts of [null, [], [marker]] as Array<string[] | null>) {
    const f = await setup(async () => {
      throw new Error("synthetic_worker_failure");
    });
    try {
      await f.c.capture(dispatch(texts), sender);
      const r = await requestRecord(f);
      assert.equal(r.documents.upload_count, null);
      assert.equal(r.documents.processing, "unknown");
      if (texts === null) assert.equal(r.documents.extracted_text, null);
      else if (!texts.length) assert.deepEqual(r.documents.extracted_text, []);
      else {
        const token = r.documents.extracted_text[0].tokens;
        assert.equal(token.value, null);
        assert.equal(token.evidence, "unknown");
        assert.equal(token.reason, "tokenizer_unavailable");
      }
    } finally {
      f.db.close();
    }
  }
});

test("malformed successful worker metadata and malformed envelopes reject the whole plausible count", async () => {
  const worker = counter();
  const mutations: Array<(counts: any) => any> = [
    () => null,
    () => [],
    () => "invalid",
    () => 0,
    () => false,
    (counts) => {
      counts.counts.file_0.measurement.scope = "provider_reported_total";
      counts.counts.file_0.measurement.reason = "invented_reason";
      return counts;
    },
    (counts) => {
      counts.counts.file_0.jobId = "other-job:file_0";
      return counts;
    },
    (counts) => {
      counts.counts.file_0.revision++;
      return counts;
    },
    (counts) => {
      counts.counts.file_0.assetHash = "0".repeat(64);
      return counts;
    },
    (counts) => {
      counts.counts.file_0.encoding = "unknown";
      return counts;
    },
    (counts) => {
      counts.counts.file_0.measurement.profile_id =
        "cl100k-base-4.0.0-reference";
      return counts;
    },
    (counts) => {
      counts.counts.file_0.measurement.value = "1.5";
      return counts;
    },
    (counts) => {
      counts.counts.file_0.measurement.value = "9223372036854775807";
      return counts;
    },
    (counts) => {
      counts.counts.file_0.measurement.value = "0";
      return counts;
    },
    (counts) => {
      counts.counts.file_0.measurement.reason = null;
      return counts;
    },
    (counts) => {
      counts.counts.file_0.unexpected = "private metadata";
      return counts;
    },
    (counts) => {
      delete counts.counts.file_0;
      return counts;
    },
  ];
  try {
    for (const [index, mutate] of mutations.entries()) {
      const f = await setup(async (job: any) =>
        mutate(await worker.count(job)),
      );
      try {
        await f.c.capture(dispatch([marker]), sender);
        const request = await requestRecord(f);
        assert.equal(request.documents.extracted_text.length, 1);
        const value = request.documents.extracted_text[0].tokens;
        assert.equal(value.value, null, String(index));
        assert.equal(value.evidence, "unknown");
        assert.equal(value.reason, "tokenizer_unavailable");
        const attempt = (await f.db.rows(f.scope.namespace)).find(
          (row) => row.record.kind === "attempt",
        )!.record as any;
        assert.equal(attempt.tokens.new_input_text.value, null, String(index));
      } finally {
        f.db.close();
      }
    }
  } finally {
    await worker.close();
  }
});
test("capture bridge rejects unknown inline fields, wrong sites and combined text overflow", () => {
  const valid = dispatch([marker]);
  assert.equal(validateCapture(valid, "claude.ai"), true);
  const legacy = structuredClone(valid);
  delete legacy.dispatch.inlineFiles;
  assert.equal(validateCapture(legacy, "claude.ai"), true);
  for (const files of [
    { text: marker },
    ["x".repeat(INLINE_FILE_LIMITS.textUnits), "x"],
    Array(17).fill("x"),
    [null],
    Array(2),
    Object.assign(["text"], { filename: "unexpected" }),
  ])
    assert.equal(
      validateCapture(
        { ...valid, dispatch: { ...valid.dispatch, inlineFiles: files } },
        "claude.ai",
      ),
      false,
    );
  assert.equal(
    validateCapture(
      {
        ...valid,
        site: "chatgpt",
        dispatch: { ...valid.dispatch, site: "chatgpt" },
      },
      "chatgpt.com",
    ),
    false,
  );
});

test("company outbox carries only numerical inline revisions accepted by both API validators", async () => {
  const worker = counter(),
    f = await setup(worker.count);
  try {
    const history = (await f.db.get<OwnershipHistory>(
      "policy",
      "ownership-history",
    ))!;
    const company = {
      namespace: "company:synthetic-inline",
      mode: "company" as const,
      era: "synthetic-era",
    };
    await f.db.policyTransaction([
      transitionOwnership(history, {
        scope: company,
        secret: "b".repeat(64),
        policyVersion: "1.0.0",
      }) as any,
    ]);
    await f.c.capture(dispatch([marker]), sender);
    await f.c.settleConversationDisplays();
    const queued = await f.db.pending(company.namespace);
    const records = await Promise.all(
      queued.map((row) => f.db.queuedRecord(row)),
    );
    assert.ok(
      records.some(
        (record: any) =>
          record.kind === "request" &&
          record.documents.extracted_text?.length === 1,
      ),
    );
    const batch = {
      schema_version: "3.0.0",
      batch_id: crypto.randomUUID(),
      sent_at: new Date().toISOString(),
      client_version: "0.1.0",
      deletion_epoch: 0,
      records,
    };
    assert.equal(UsageBatchSchema.safeParse(batch).success, true);
    const serialized = JSON.stringify(batch);
    for (const forbidden of [
      marker,
      "PRIVATE_NAME_927",
      "ordinary prompt",
      "extracted_content",
      "file_0",
      "synthetic-inline-document",
    ])
      assert.ok(!serialized.includes(forbidden), forbidden);
    const validated = pythonReference(
      [
        "-c",
        "import json,sys\nfrom footprint_contracts import validate_batch\nvalidate_batch(json.load(sys.stdin))\nprint('accepted')",
      ],
      { input: serialized },
    );
    assert.equal(validated.status, 0, validated.stderr);
    assert.equal(validated.stdout.trim(), "accepted");
  } finally {
    f.db.close();
    await worker.close();
  }
});
test("erasure during counting cannot resurrect components, jobs or observations", async () => {
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>((r) => (entered = r)),
    gate = new Promise<void>((r) => (release = r));
  const worker = counter(),
    f = await setup(async (job: any) => {
      entered();
      await gate;
      return worker.count(job);
    });
  try {
    const work = f.c.capture(dispatch([marker]), sender);
    await started;
    const r = await requestRecord(f);
    await f.db.eraseFamily(f.scope.namespace, r.request_id);
    release();
    await assert.rejects(work, /derived_dependency_changed|erased/);
    assert.equal((await f.db.rows(f.scope.namespace)).length, 0);
    assert.equal((await f.db.all("provider_key_map")).length, 0);
  } finally {
    release();
    f.db.close();
    await worker.close();
  }
});
test("capture-time personal ownership survives Connect while inline worker is running", async () => {
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>((r) => (entered = r)),
    gate = new Promise<void>((r) => (release = r));
  const worker = counter(),
    f = await setup(async (job: any) => {
      entered();
      await gate;
      return worker.count(job);
    });
  try {
    const message = dispatch([marker]),
      work = f.c.capture(message, sender);
    await started;
    const history = (await f.db.get<OwnershipHistory>(
      "policy",
      "ownership-history",
    ))!;
    await f.db.policyTransaction([
      transitionOwnership(
        history,
        {
          scope: { namespace: "company:new", mode: "company", era: "new-era" },
          secret: "b".repeat(64),
          policyVersion: "1.0.0",
        },
        Date.parse(message.at) + 1,
      ) as any,
    ]);
    release();
    await work;
    assert.equal((await requestRecord(f)).documents.extracted_text.length, 1);
    assert.equal((await f.db.rows("company:new")).length, 0);
    assert.equal((await f.db.queue(f.scope.namespace)).length, 0);
  } finally {
    release();
    f.db.close();
    await worker.close();
  }
});

for (const change of ["correction", "alias"] as const)
  test(`source ${change} during inline counting rejects a stale numerical update`, async () => {
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>((r) => (entered = r)),
      gate = new Promise<void>((r) => (release = r));
    const worker = counter(),
      f = await setup(async (job: any) => {
        entered();
        await gate;
        return worker.count(job);
      });
    try {
      const work = f.c.capture(dispatch([marker]), sender);
      await started;
      const r = await requestRecord(f);
      if (change === "correction")
        await f.db.write(f.scope, { ...r, revision: r.revision + 1 });
      else {
        const canonical = {
          ...r,
          request_id: crypto.randomUUID(),
          provider_request_key: null,
        };
        await f.db.write(f.scope, canonical);
        await f.db.markAlias(
          f.scope.namespace,
          "request",
          r.request_id,
          canonical.request_id,
        );
      }
      release();
      await assert.rejects(work, /derived_dependency_changed/);
      for (const row of await f.db.rows(f.scope.namespace))
        if (row.record.kind === "request")
          assert.equal((row.record as any).documents.extracted_text, null);
    } finally {
      release();
      f.db.close();
      await worker.close();
    }
  });
test("canonical replay counts file components once and range cleanup survives restart and summary reconstruction", async () => {
  const worker = counter(),
    f = await setup(worker.count);
  try {
    const first = dispatch([marker]);
    first.dispatch.requestId = "synthetic-same-dispatch";
    await f.c.capture(first, sender);
    const second = dispatch([marker]);
    second.dispatch.requestId = first.dispatch.requestId;
    await f.c.capture(second, sender);
    let summary = await scanSummary(f.db, f.scope.namespace);
    assert.equal(summary.requests, 1);
    assert.equal(summary.file_text.length, 1);
    assert.equal(summary.file_text[0]!.contributing_component_count, 1);
    await f.db.applyRange(f.scope, null, "2030-01-01T00:00:00.000Z", 1);
    f.db.close();
    f.db = await Ledger.open(f.name);
    summary = await scanSummary(f.db, f.scope.namespace);
    assert.equal(summary.requests, 0);
    assert.deepEqual(summary.file_text, []);
    assert.equal((await f.db.all("provider_key_map")).length, 0);
  } finally {
    f.db.close();
    await worker.close();
  }
});
