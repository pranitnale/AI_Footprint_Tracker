import assert from "node:assert/strict";
import test from "node:test";
import {
  createCountingRuntime,
  snapshotCountingRuntime,
  DEFAULT_COUNTING_RUNTIME,
  countFields,
  validCountResponse,
  type TokenizerImplementation,
} from "../src/index";

const manifest = () => ({
  id: "review-fake-1",
  profiles: [
    {
      profileId: "observed-text-v1",
      encoding: "review_fake",
      assetHash: "a".repeat(64),
    },
  ],
});

test("CountingRuntime snapshots one selected implementation and approved profile without carrying executable code", () => {
  const input = manifest();
  const runtime = createCountingRuntime(input, "observed-text-v1");
  input.id = "changed";
  input.profiles[0].assetHash = "b".repeat(64);
  assert.equal(runtime.selection.implementationId, "review-fake-1");
  assert.equal(runtime.manifest.profiles[0].assetHash, "a".repeat(64));
  for (const value of [
    runtime,
    runtime.selection,
    runtime.manifest,
    runtime.manifest.profiles,
    runtime.manifest.profiles[0],
  ])
    assert.ok(Object.isFrozen(value));
  assert.deepEqual(snapshotCountingRuntime(runtime), runtime);
  assert.equal("count" in runtime.manifest, false);
  assert.equal(
    DEFAULT_COUNTING_RUNTIME.selection.profileId,
    "o200k-base-4.0.0-reference",
  );
});

test("Malformed, unapproved and ambiguous manifests fail before counting", () => {
  for (const mutate of [
    (value: any) => {
      value.id = "https://untrusted.example/code";
    },
    (value: any) => {
      value.moduleUrl = "remote.js";
    },
    (value: any) => {
      value.count = "not-executable-configuration";
    },
    (value: any) => {
      value.profiles = [];
    },
    (value: any) => {
      value.profiles.push({ ...value.profiles[0] });
    },
    (value: any) => {
      value.profiles[0].profileId = "not-an-approved-profile";
    },
    (value: any) => {
      value.profiles[0].assetHash = "A".repeat(64);
    },
    (value: any) => {
      value.profiles[0].assetHash = "short";
    },
    (value: any) => {
      value.profiles[0].encoding = null;
    },
    (value: any) => {
      value.profiles[0].extra = true;
    },
  ]) {
    const value = manifest();
    mutate(value);
    assert.throws(
      () => createCountingRuntime(value, "observed-text-v1"),
      /tokenizer_manifest_invalid/,
    );
  }
  assert.throws(
    () => createCountingRuntime(manifest(), "o200k-base-4.0.0-reference"),
    /tokenizer_manifest_invalid/,
  );
  const runtime = createCountingRuntime(manifest(), "observed-text-v1");
  assert.throws(
    () =>
      snapshotCountingRuntime({
        ...runtime,
        selection: { ...runtime.selection, implementationId: "different" },
      }),
    /tokenizer_manifest_invalid/,
  );
});

test("Metadata-only manifest validates distinctive counts and rejects wrong worker assets", async () => {
  const tokenizer: TokenizerImplementation = {
    ...manifest(),
    async count(job) {
      return {
        jobId: job.jobId,
        revision: job.revision,
        measurement: {
          value: job.text ? "1" : "0",
          evidence: "heuristic_estimate",
          scope: "observed_text",
          completeness: "complete_for_scope",
          profile_id: "observed-text-v1",
          reason: "tokenizer_mapping_unverified",
        },
        assetHash: "a".repeat(64),
        profileId: "observed-text-v1",
        encoding: "review_fake",
        modelExactness: "unverified",
        status: "counted",
      };
    },
  };
  const runtime = createCountingRuntime(tokenizer, "observed-text-v1");
  const job = {
    jobId: crypto.randomUUID(),
    revision: 1,
    modelId: null,
    ...runtime.selection,
    fields: {
      answer: "many synthetic words deliberately produce one fake token",
    },
  };
  const result = await countFields(job, tokenizer);
  assert.equal(result.counts.answer?.measurement.value, "1");
  assert.ok(validCountResponse(result, job, runtime.manifest));
  assert.equal(validCountResponse(result, job), false);
  const changed = structuredClone(result);
  changed.counts.answer!.assetHash = "b".repeat(64);
  assert.equal(validCountResponse(changed, job, runtime.manifest), false);
});
