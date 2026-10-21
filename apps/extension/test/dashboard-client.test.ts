import assert from "node:assert/strict";
import test from "node:test";
import { createDashboardClient } from "../lib/dashboard/client";
import {
  validatedLocalSummary,
  validatedServerSummary,
} from "../lib/dashboard/summary-validators";
import { SummaryAccumulator } from "../lib/summary-scan";
import { serverSummary } from "./ui-fixtures";

function summary() {
  return {
    scopeToken: "a".repeat(64),
    aggregate_status: "current",
    request_count: "2",
    resources: [
      {
        quantity: "energy",
        unit: "kWh",
        scope: "modeled_text_component",
        value: "3e-19",
        value_kind: "midpoint_sum",
        phase: "usage",
        scenario_low: null,
        scenario_high: null,
        interval_kind: null,
        unknown_count: "0",
        contributing_attempt_count: "2",
      },
    ],
  };
}

test("dashboard client accepts finite scientific result quantities and validates summed scenario intervals", () => {
  assert.equal(validatedServerSummary(summary()).resources![0].value, "3e-19");
  const bounded = summary();
  Object.assign(bounded.resources[0], {
    scenario_low: "1e-19",
    scenario_high: "5e-19",
  });
  assert.equal(
    validatedServerSummary(bounded).resources![0].scenario_low,
    "1e-19",
  );
  for (const changes of [
    { value: "1e-999" },
    { value: "NaN" },
    { value: "Infinity" },
    { value: "-1" },
    {
      scenario_low: "1e-19",
      scenario_high: "5e-19",
      interval_kind: "upstream_approximation",
    },
    { scenario_low: "4e-19", scenario_high: "5e-19" },
    { scenario_low: "1e-19" },
    { value_kind: "unavailable" },
  ]) {
    const value = summary();
    Object.assign(value.resources[0], changes);
    assert.throws(
      () => validatedServerSummary(value),
      /summary_response_invalid/,
    );
  }
});

// The image benchmark data was removed on 20 October 2026, so summaries list no references.
test("local summaries carry no image benchmark references", () => {
  const base = new SummaryAccumulator().result();
  assert.equal("imageReferences" in base, false);
  assert.equal("imageReferencesOmitted" in base, false);
  assert.deepEqual(validatedLocalSummary(base), base);
});

test("dashboard client requires token counters and validates per-record interval order", () => {
  const value = summary();
  assert.throws(
    () => validatedServerSummary({ ...value, request_count: null }),
    /summary_response_invalid/,
  );
  assert.throws(
    () =>
      validatedServerSummary({
        ...value,
        tokens: [
          { ...value.resources[0], quantity: "answer_output", unit: "tokens" },
        ],
      }),
    /summary_response_invalid/,
  );
  const resource = {
    ...value.resources[0],
    value_kind: "midpoint",
    scenario_low: "1e-19",
    scenario_high: "5e-19",
    interval_kind: "upstream_approximation",
  };
  assert.equal(
    validatedServerSummary({ ...value, resources: [resource] }).resources![0]
      .value_kind,
    "midpoint",
  );
  assert.throws(
    () =>
      validatedServerSummary({
        ...value,
        resources: [{ ...resource, scenario_low: "9e-19" }],
      }),
    /summary_response_invalid/,
  );
});

test("named action client validates acknowledgments and erasure counts", async () => {
  const client = createDashboardClient(async () => ({ ok: "yes", count: -1 }));
  await assert.rejects(client.command("sync"), /extension_response_invalid/);
  await assert.rejects(client.eraseLocal(), /erase_response_invalid/);
  await assert.rejects(client.engineStatus());
});

test("engine selection validates its request before crossing the runtime boundary", async () => {
  let sent = 0;
  const client = createDashboardClient(async () => {
    sent += 1;
    return {};
  });
  await assert.rejects(
    client.selectEngine({
      preference: "invented" as never,
      expectedRevision: null,
    }),
  );
  await assert.rejects(
    client.selectEngine({ preference: "ecologits", expectedRevision: -1 }),
  );
  assert.equal(sent, 0);
});

test("organization splits by day, tool and model are summaries checked like the whole", () => {
  const whole = serverSummary("company");
  const part = { ...whole, scopeToken: undefined } as Record<string, unknown>;
  delete part.scopeToken;
  delete part.sites;
  const valid = {
    ...whole,
    days: { "2026-10-11": part },
    models: { "chatgpt-gpt-5-6-sol": { ...part, site: "chatgpt" } },
  };
  const checked = validatedServerSummary(valid) as typeof valid;
  assert.deepEqual(Object.keys(checked.sites!), ["claude", "chatgpt", "perplexity", "notebooklm", "gemini"]);
  assert.equal(checked.models["chatgpt-gpt-5-6-sol"]!.site, "chatgpt");
  for (const bad of [
    { ...whole, days: { "11 Oct": part } },
    { ...whole, sites: { bing: part } },
    { ...whole, models: { "../x y": part } },
    { ...whole, days: { "2026-10-11": { ...part, request_count: "-1" } } },
    { ...whole, models: { "chatgpt-gpt-5-6-sol": { ...part, site: 3 } } },
    { ...whole, sites: { chatgpt: { ...part, resources: [{ quantity: "energy" }] } } },
    { ...whole, days: "2026-10-11" },
  ])
    assert.throws(() => validatedServerSummary(bad), /summary_response_invalid/, JSON.stringify(Object.keys(bad)));
});
