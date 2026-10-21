import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AttemptObservationSchema,
  HistoryMessageSchema,
  OUTPUT_PARTS,
  composeOutputTotal,
  emptyGeneration,
  historyResponseParts,
  notApplicableMeasurement,
  payloadHash,
  type TokenMeasurement,
} from "@footprint/contracts";
import { BASELINE_BUNDLE } from "../src/index";

// Entries stay loosely typed, as the tests read them by name from parsed JSON.
type Entry = any;
export type LegacyCorpus = {
  format: string;
  provenance: { method_id: string; method_hash: string };
  live: Entry[];
  history: Entry[];
  /**
   * An image benchmark reference as results saved before 20 October 2026 hold it. The
   * benchmark data and the frozen outputs that carried its figures were removed; this record
   * has none and checks that such saved results stay readable.
   */
  retired_image_reference: Record<string, unknown> & { cohort_hash: string };
};

/**
 * The frozen corpus keeps its 2.0.0 observations byte for byte, so its recorded
 * Original outputs stay independent evidence. A 2.0.0 record had no intermediate
 * output part and no inclusive-total rule. A legacy total with a value was an
 * inclusive total, which 3.0.0 accepts only as the provider's report of the request;
 * any other total is recomposed. No counted quantity changes.
 */
export function upgradeLegacyAttempt(observation: any) {
  const tokens = {
    ...observation.tokens,
    intermediate_output: notApplicableMeasurement(),
  };
  const total = observation.tokens.output_total as TokenMeasurement;
  tokens.output_total =
    total.value === null
      ? composeOutputTotal(tokens)
      : { ...total, evidence: "provider_reported", scope: "provider_request" };
  assert.equal(
    tokens.output_total.scope,
    total.value === null ? total.scope : "provider_request",
  );
  assert.ok(
    total.value === null ||
      tokens.output_total.value === total.value,
    "Upgrade must keep an inclusive total",
  );
  assert.ok(
    OUTPUT_PARTS.every(
      (part) =>
        part === "intermediate_output" ||
        tokens[part] === observation.tokens[part],
    ),
  );
  return AttemptObservationSchema.parse({
    ...observation,
    schema_version: "3.0.0",
    tokens,
    generation: emptyGeneration(),
    company_dedup_key: null,
  });
}

/** A 2.0.0 reply counted only its answer, so its other parts do not apply. */
export function upgradeLegacyHistory(observation: any) {
  return HistoryMessageSchema.parse({
    ...observation,
    schema_version: "3.0.0",
    parts:
      observation.role === "response"
        ? historyResponseParts(observation.tokens)
        : null,
    generation: emptyGeneration(),
    company_dedup_key: null,
  });
}

/**
 * The Original method binds the count's scope label into its eligibility signature and
 * settings. When the upgrade relabels an inclusive total, only these two fields change:
 * the frozen values are first proved to come from the old label, then recomputed.
 */
function rebindOutputScope(expected: Entry, from: string, to: string): Entry {
  const signature = (scope: string) =>
    payloadHash({
      work_units: expected.known_settings.output_tokens,
      count_scope: scope,
      scenario_hash: payloadHash(BASELINE_BUNDLE.scenario),
      cohort_hash: expected.cohort_hash,
      method_hash: expected.method_hash,
    });
  assert.equal(expected.known_settings.output_scope, from);
  assert.equal(expected.eligibility_signature, signature(from));
  return {
    ...expected,
    eligibility_signature: signature(to),
    known_settings: { ...expected.known_settings, output_scope: to },
  };
}

/**
 * Reads the corpus, checks each live expectation still binds the unchanged 2.0.0
 * record and rebinds it to the upgraded record. Every other expected field is kept.
 */
export function loadLegacyCorpus(): LegacyCorpus {
  const corpus = JSON.parse(
    readFileSync(
      new URL("./fixtures/legacy-refinement.json", import.meta.url),
      "utf8",
    ),
  ) as LegacyCorpus;
  return {
    ...corpus,
    live: corpus.live.map((entry) => {
      assert.equal(
        entry.expected.observation_hash,
        payloadHash(entry.observation),
        entry.name,
      );
      const observation = upgradeLegacyAttempt(entry.observation);
      const from = entry.observation.tokens.output_total.scope;
      const to = observation.tokens.output_total.scope;
      const expected =
        from === to ? entry.expected : rebindOutputScope(entry.expected, from, to);
      return {
        ...entry,
        observation,
        expected: {
          ...expected,
          observation_hash: payloadHash(observation),
        },
      };
    }),
    history: corpus.history.map((entry) => ({
      ...entry,
      observation: upgradeLegacyHistory(entry.observation),
    })),
  };
}
