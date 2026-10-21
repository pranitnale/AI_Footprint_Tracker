import assert from "node:assert/strict";
import test from "node:test";
import {
  createCountingRuntime,
  DEFAULT_COUNTING_RUNTIME,
  BUNDLED_TOKENIZER,
  countFields,
} from "@footprint/tokenizers";
import { countAccessibleFile } from "@footprint/file-text";
import { createMemoryRepository } from "@footprint/ledger";
import { initialSnapshot } from "@footprint/adapters";
import { Coordinator } from "../lib/coordinator";
import { HISTORY_CAPTURE_CHANNEL } from "../lib/history-capture";
import { FileGrantBroker } from "../lib/file-grant-broker";
import { validFileReceiptResult } from "../lib/file-receipt-result";
import { uploadedFileComponent } from "../lib/uploaded-file-components";
import {
  historyPage,
  historyBinding,
  historySender,
  historyConversation,
} from "./history-fixture";
import { countingHarness, distinctTokenizer } from "./counting-runtime-fixture";

const counting = () =>
  createCountingRuntime(distinctTokenizer(), "observed-text-v1");
const text = "Synthetic counting replacement has deliberately several words.";

for (const family of ["chrome", "firefox"] as const)
  test(`${family}: one distinctive tokenizer crosses actual live/history/worker/platform/file/receipt paths`, async () => {
    const runtime = counting(),
      h = await countingHarness(runtime, family);
    const repository = createMemoryRepository();
    let networks = 0;
    const coordinator = new Coordinator(repository, {
      counting: runtime,
      count: h.platform.countLocally,
      hasConsent: async () => true,
      sendDisplay: async () => {},
      transport: async () => {
        networks++;
        throw new Error("unexpected network");
      },
    });
    let broker: FileGrantBroker | undefined;
    try {
      const ordinary = await countFields({
        jobId: crypto.randomUUID(),
        revision: 1,
        modelId: null,
        ...DEFAULT_COUNTING_RUNTIME.selection,
        fields: { answer: text },
      });
      assert.notEqual(ordinary.counts.answer?.measurement.value, "1");
      await coordinator.whenReady();
      const at = new Date().toISOString(),
        captureId = crypto.randomUUID();
      const captured: any = { timing: null,
        channel: "ai-footprint-observation-v1",
        version: 1,
        id: captureId,
        revision: 1,
        event: "dispatch",
        site: "claude",
        at,
        dispatch: {
          site: "claude",
          action: "send",
          input: text,
          conversationId: historyConversation,
          parentId: null,
          requestId: "distinct-runtime",
          model: null,
          attachments: 0,
          imageEditParentId: null,
        },
        snapshot: initialSnapshot(),
        failure: null,
      };
      await coordinator.capture(captured, historySender);
      await coordinator.capture(
        {
          ...captured,
          revision: 2,
          event: "end",
          dispatch: null,
          snapshot: {
            ...initialSnapshot(),
            text,
            outputId: "distinct-answer",
            started: true,
            state: "completed",
          },
        },
        historySender,
      );
      const scope = await coordinator.currentScope();
      const attempts: any[] = [];
      await repository.scanAttempts(scope.namespace, (rows) => {
        attempts.push(...rows);
      });
      assert.equal(attempts[0].record.tokens.answer_output.value, "1");
      assert.equal(
        attempts[0].record.tokens.answer_output.profile_id,
        "observed-text-v1",
      );
      assert.equal(attempts[0].record.tokenizer_asset_hash, "a".repeat(64));
      const page = historyPage();
      page.messages.forEach((message) => {
        message.text = text;
      });
      page.messages[0].inlineFiles = [{ text }];
      const binding = historyBinding(),
        common = {
          channel: HISTORY_CAPTURE_CHANNEL as typeof HISTORY_CAPTURE_CHANNEL,
          id: crypto.randomUUID(),
          site: page.site,
          conversationId: page.conversationId,
          observedAt: page.observedAt,
        };
      await coordinator.history.receive(
        { ...common, event: "start", page: null },
        binding,
        historySender,
      );
      await coordinator.history.receive(
        { ...common, event: "page", page },
        binding,
        historySender,
      );
      const saved = await repository.historyPage(scope, undefined);
      assert.equal(saved.length, 2);
      for (const row of saved) {
        assert.equal(row.record.tokens.value, "1");
        assert.equal(row.record.tokens.profile_id, "observed-text-v1");
      }
      assert.ok(!JSON.stringify(saved).includes(text));
      assert.ok(h.commands.length >= 4);
      assert.ok(
        h.commands.every(
          (job) =>
            job.implementationId === runtime.selection.implementationId &&
            job.profileId === runtime.selection.profileId,
        ),
      );
      const bytes = new TextEncoder().encode(text).buffer;
      const root = `${family === "firefox" ? "moz" : "chrome"}-extension://counting-fixture/`;
      const parent = { ...historySender, id: "counting-fixture" },
        relay = {
          ...parent,
          frameId: 9,
          documentId: "relay",
          url: root + "file-relay.html",
        },
        client = { id: "counting-client", url: relay.url };
      const now = Date.now(),
        fileBinding = historyBinding(),
        fileHandle = crypto.randomUUID();
      broker = new FileGrantBroker({
        counting: runtime,
        extensionId: parent.id,
        relayUrl: relay.url,
        clock: () => now,
        snapshot: async () =>
          JSON.stringify({
            scope,
            erasureVersion: 0,
            ownershipStart: now - 1000,
            ownershipEnd: null,
            deviceId: null,
            enrollmentState: null,
          }),
        parentCurrent: async () => true,
        count: (job, signal) => h.platform.countFileLocally(job, signal, true),
      });
      const grant = await broker.issue(
        {
          target: "file-grant",
          fileHandle,
          kind: "text",
          size: bytes.byteLength,
          binding: fileBinding,
          observedAt: now,
        },
        parent,
      );
      assert.equal(grant.status, "granted");
      if (grant.status !== "granted") throw new Error("grant rejected");
      const nonce = crypto.randomUUID();
      const redeemed = await broker.redeem(
        {
          target: "file-relay-redeem",
          grant: grant.grant,
          parentOrigin: "https://claude.ai",
          relayNonce: nonce,
        },
        relay,
      );
      assert.equal(redeemed.status, "redeemed");
      if (redeemed.status !== "redeemed")
        throw new Error("redemption rejected");
      assert.deepEqual(
        await broker.register(
          {
            target: "file-relay-register",
            token: redeemed.token,
            relayNonce: nonce,
          },
          client,
        ),
        { status: "ready" },
      );
      assert.deepEqual(
        await broker.submit(
          {
            target: "file-relay-count",
            token: redeemed.token,
            relayNonce: nonce,
            job: {
              jobId: redeemed.spec.jobId,
              revision: 1,
              kind: "text",
              bytes,
            },
          },
          client,
        ),
        { status: "complete" },
      );
      assert.equal(bytes.byteLength, new TextEncoder().encode(text).byteLength);
      assert.deepEqual(
        await broker.bind(
          {
            target: "file-receipt-bind",
            binding: fileBinding,
            fileHandle,
            captureId,
          },
          parent,
        ),
        { bound: true },
      );
      const receipt = await broker.readReceipt(
        { binding: fileBinding, fileHandle, captureId },
        parent,
      );
      assert.equal(receipt.result?.tokens, "1");
      assert.equal(receipt.result?.tokenizerAssetHash, "a".repeat(64));
      assert.equal(
        receipt.spec?.tokenizerImplementationId,
        runtime.selection.implementationId,
      );
      assert.equal(
        receipt.spec?.tokenizerProfileId,
        runtime.selection.profileId,
      );
      const component = uploadedFileComponent(
        fileHandle,
        crypto.randomUUID(),
        receipt,
        scope,
        new Date(now).toISOString(),
        runtime.manifest,
      );
      assert.equal(component?.tokens.value, "1");
      assert.equal(component?.tokens.profile_id, "observed-text-v1");
      assert.ok(!JSON.stringify(receipt.result).includes(text));
      assert.equal(networks, 0);
    } finally {
      broker?.invalidate();
      coordinator.history.invalidate();
      coordinator.engines.dispose();
      h.dispose();
    }
  });

test("host snapshot and restarts reject a changed worker manifest instead of adopting it", async () => {
  const supplied = structuredClone(counting()),
    h = await countingHarness(supplied, "firefox");
  const job = () => ({
    jobId: crypto.randomUUID(),
    revision: 1,
    modelId: null,
    ...counting().selection,
    fields: { answer: text },
  });
  try {
    const input = job(),
      pending = h.platform.countLocally(input);
    supplied.manifest.profiles[0].assetHash = "b".repeat(64);
    assert.equal((await pending).counts.answer?.assetHash, "a".repeat(64));
    h.setWorkerAsset("b".repeat(64));
    h.ports[0].onerror?.({} as ErrorEvent);
    assert.equal((await h.platform.countLocally(job())).status, "unavailable");
    h.setWorkerAsset("a".repeat(64));
    h.ports[1].onerror?.({} as ErrorEvent);
    assert.equal(
      (await h.platform.countLocally(job())).counts.answer?.measurement.value,
      "1",
    );
    h.corruptFileReplies();
    assert.equal(
      (
        await h.platform.countFileLocally({
          jobId: crypto.randomUUID(),
          revision: 1,
          kind: "text",
          bytes: new TextEncoder().encode(text).buffer,
        })
      ).status,
      "unavailable",
    );
  } finally {
    h.dispose();
  }
});

test("the existing cl100k profile passes receipt validation with its actual asset, not the o200k asset", async () => {
  const runtime = createCountingRuntime(
    BUNDLED_TOKENIZER,
    "cl100k-base-4.0.0-reference",
  );
  const job = {
    jobId: crypto.randomUUID(),
    revision: 1,
    kind: "text" as const,
    bytes: new TextEncoder().encode(text).buffer,
    tokenizerImplementationId: runtime.selection.implementationId,
    tokenizerProfileId: runtime.selection.profileId,
  };
  const result = await countAccessibleFile(job);
  assert.equal(result.status, "counted");
  assert.ok(validFileReceiptResult(result, job, job.bytes.byteLength));
  assert.ok(
    validFileReceiptResult(
      result,
      job,
      job.bytes.byteLength,
      undefined,
      runtime.manifest,
    ),
  );
  assert.equal(
    validFileReceiptResult(
      { ...result, tokenizerAssetHash: "f".repeat(64) },
      job,
      job.bytes.byteLength,
      undefined,
      runtime.manifest,
    ),
    false,
  );
});
