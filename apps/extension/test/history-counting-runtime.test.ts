import assert from "node:assert/strict";
import test from "node:test";
import {
  countFields,
  createCountingRuntime,
  type CountRequest,
  type CountingRuntime,
  type TokenizerImplementation,
} from "@footprint/tokenizers";
import { createMemoryRepository, type Scope } from "@footprint/ledger";
import {
  countHistoryPage,
  HISTORY_CAPTURE_CHANNEL,
} from "../lib/history-capture";
import { HistoryService } from "../lib/history-service";
import type { CompanySession } from "../lib/company";
import { historyPage, historyBinding, historySender } from "./history-fixture";

const profile = {
  profileId: "observed-text-v1",
  encoding: "synthetic-history-counter",
  assetHash: "b".repeat(64),
};
const replacement: TokenizerImplementation = {
  id: "synthetic-history-counting-1",
  profiles: [profile],
  async count(job) {
    return {
      jobId: job.jobId,
      revision: job.revision,
      measurement: {
        value: job.text.length ? "1" : "0",
        evidence: "heuristic_estimate",
        scope: "observed_text",
        completeness: "complete_for_scope",
        profile_id: "observed-text-v1",
        reason: "tokenizer_mapping_unverified",
      },
      profileId: profile.profileId,
      encoding: profile.encoding,
      assetHash: profile.assetHash,
      modelExactness: "unverified",
      status: "counted",
    };
  },
};
const runtime = () => createCountingRuntime(replacement, profile.profileId);
const withFile = () => {
  const page = historyPage();
  page.messages[0].inlineFiles = [{ text: "SYNTHETIC-PRIVATE-ATTACHMENT" }];
  return page;
};

test("history replacement counts and inline files preserve the selected manifest without returning raw text", async () => {
  const page = withFile();
  const before = structuredClone(page);
  const jobs: CountRequest[] = [];
  const counted = await countHistoryPage(
    page,
    async (job, signal) => {
      jobs.push(structuredClone(job));
      return countFields(job, replacement, signal);
    },
    { counting: runtime() },
  );
  assert.equal(jobs.length, 2);
  assert.ok(
    jobs.every(
      (job) =>
        job.implementationId === replacement.id &&
        job.profileId === profile.profileId,
    ),
  );
  for (const message of counted.messages) {
    assert.equal(message.tokens.value, "1");
    assert.equal(message.tokens.profile_id, profile.profileId);
    assert.equal(message.tokens.reason, "tokenizer_mapping_unverified");
    assert.equal("text" in message, false);
    assert.equal("inlineFiles" in message, false);
  }
  const file = counted.messages[0].inlineFileComponents![0];
  assert.equal(file.tokens.value, "1");
  assert.equal(file.tokens.profile_id, profile.profileId);
  assert.equal(file.tokens.scope, "extracted_file_text");
  assert.equal(
    JSON.stringify(counted).includes("SYNTHETIC-PRIVATE-ATTACHMENT"),
    false,
  );
  assert.deepEqual(page, before);
});

test("history rejects wrong replacement identity or assets as unknown for message and file", async () => {
  for (const corruption of ["implementation", "profile", "asset"] as const) {
    const counted = await countHistoryPage(
      withFile(),
      async (job) => {
        const response = await countFields(job, replacement);
        if (corruption === "implementation")
          response.implementationId = "wrong-implementation";
        else if (corruption === "profile")
          response.profileId = "cl100k-base-4.0.0-reference";
        else
          for (const result of Object.values(response.counts))
            result!.assetHash = "c".repeat(64);
        return response;
      },
      { counting: runtime() },
    );
    assert.equal(counted.messages[0].tokens.value, null, corruption);
    assert.equal(counted.messages[0].tokens.reason, "tokenizer_unavailable");
    assert.equal(
      counted.messages[0].inlineFileComponents![0].tokens.value,
      null,
    );
  }
});

test("history snapshots runtime metadata before counting yields and never lets responses select another manifest", async () => {
  const counting = structuredClone(runtime());
  let calls = 0;
  const counted = await countHistoryPage(
    withFile(),
    async (job) => {
      calls++;
      assert.equal(job.implementationId, replacement.id);
      if (calls === 1) {
        Object.assign(counting.selection, {
          implementationId: "changed-implementation",
        });
        Object.assign(counting.manifest.profiles[0], {
          assetHash: "d".repeat(64),
        });
        await new Promise(setImmediate);
      }
      return countFields(job, replacement);
    },
    { counting },
  );
  assert.equal(calls, 2);
  assert.ok(counted.messages.every((message) => message.tokens.value === "1"));
  assert.equal(counted.messages[0].inlineFileComponents![0].tokens.value, "1");
  await assert.rejects(
    countHistoryPage(
      withFile(),
      async () => assert.fail("Invalid runtime must fail before counting"),
      { counting },
    ),
    /tokenizer_manifest_invalid/,
  );
});

test("HistoryService forwards a fixed replacement runtime through admission and persists numerical provenance", async () => {
  const repository = createMemoryRepository();
  const scope: Scope = {
    namespace: "personal:history-counting-runtime",
    mode: "personal",
    era: null,
  };
  const secret = "a".repeat(64);
  await repository.applySessionChanges({
    personal: { namespace: scope.namespace, secret },
    ownershipHistory: {
      eras: [{ scope, secret, policyVersion: "1.0.0", start: 0, end: null }],
    },
  });
  const counting: CountingRuntime = structuredClone(runtime());
  let calls = 0;
  const service = new HistoryService(
    repository,
    { credentials: async () => undefined } as unknown as CompanySession,
    async () => scope,
    async (job, signal) => {
      calls++;
      assert.equal(job.implementationId, replacement.id);
      return countFields(job, replacement, signal);
    },
    async () => true,
    undefined,
    counting,
  );
  try {
    Object.assign(counting.selection, {
      implementationId: "changed-after-construction",
    });
    Object.assign(counting.manifest.profiles[0], { assetHash: "e".repeat(64) });
    const page = withFile();
    const binding = historyBinding();
    const common = {
      channel: HISTORY_CAPTURE_CHANNEL as typeof HISTORY_CAPTURE_CHANNEL,
      id: crypto.randomUUID(),
      site: page.site,
      conversationId: page.conversationId,
      observedAt: page.observedAt,
    };
    await service.receive(
      { ...common, event: "start", page: null },
      binding,
      historySender,
    );
    await service.receive(
      { ...common, event: "page", page },
      binding,
      historySender,
    );
    const saved = await repository.historyPage(scope, undefined);
    assert.equal(calls, 2);
    assert.equal(saved.length, 2);
    for (const row of saved) {
      assert.equal(row.record.tokens.value, "1");
      assert.equal(row.record.tokens.profile_id, profile.profileId);
    }
    assert.equal(
      JSON.stringify(saved).includes("SYNTHETIC-PRIVATE-ATTACHMENT"),
      false,
    );
  } finally {
    service.invalidate();
  }
});
