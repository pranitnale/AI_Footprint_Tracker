import assert from "node:assert/strict";
import test from "node:test";
import {
  AttemptObservationSchema,
  HistoryMessageSchema,
  canonicalJson,
  OriginalEstimateResultSchema,
  OriginalHistoricalResultSchema,
} from "@footprint/contracts";
import {
  BASELINE_METHOD_HASH,
  BASELINE_METHOD_ID,
  estimateAttempt,
  estimateHistoricalText,
  RETIRED_IMAGE_REFERENCE_HASH,
} from "../src/index";
import { loadLegacyCorpus } from "./legacy-corpus";

const fixture = loadLegacyCorpus();

test("LG01-LG08 Original numerical results remain exact under the current observation schema", () => {
  assert.equal(BASELINE_METHOD_ID, fixture.provenance.method_id);
  assert.equal(BASELINE_METHOD_HASH, fixture.provenance.method_hash);
  assert.ok(fixture.live.length >= 16);
  assert.ok(fixture.history.length >= 8);
  for (const entry of fixture.live) {
    assert.equal(
      canonicalJson(OriginalEstimateResultSchema.parse(entry.expected)),
      canonicalJson(entry.expected),
      entry.name,
    );
    assert.equal(
      canonicalJson(
        estimateAttempt(AttemptObservationSchema.parse(entry.observation)),
      ),
      canonicalJson(entry.expected),
      entry.name,
    );
  }
  for (const entry of fixture.history) {
    assert.equal(
      canonicalJson(OriginalHistoricalResultSchema.parse(entry.expected)),
      canonicalJson(entry.expected),
      entry.name,
    );
    assert.equal(
      canonicalJson(
        estimateHistoricalText(HistoryMessageSchema.parse(entry.observation)),
      ),
      canonicalJson(entry.expected),
      entry.name,
    );
  }
});

test("Saved results keep the identity of the image benchmark data removed on 20 October 2026", () => {
  // The frozen image outputs held ML.ENERGY figures without a licence and were dropped with
  // the data. Results saved before then name the data by this hash, and new results keep it
  // so that their input hashes do not change.
  assert.equal(
    fixture.retired_image_reference.cohort_hash,
    RETIRED_IMAGE_REFERENCE_HASH,
  );
  assert.equal(fixture.retired_image_reference.gpu_kwh, null);
});
