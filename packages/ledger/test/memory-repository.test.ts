import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRepository } from "../src/memory-repository";
import { repositoryContract } from "./repository-contract-cases";

test("memory contracts run without an IndexedDB runtime", () => {
  assert.equal(typeof globalThis.indexedDB, "undefined");
});
repositoryContract("Memory domain repository", async () => {
  let failed = false;
  const repository = createMemoryRepository({
    beforeCommit(operation) {
      if (failed && operation === "commitCapture") {
        failed = false;
        throw Error("contract_write_failed");
      }
    },
  });
  return {
    repository,
    failNextCapture() {
      failed = true;
    },
  };
});
