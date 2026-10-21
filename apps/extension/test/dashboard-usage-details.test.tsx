import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import {
  emptyHistorySummary,
  createMethodRegistry,
} from "@footprint/estimator";
import type { HistoryView } from "@footprint/contracts";
import { DashboardDetails } from "../lib/dashboard/usage-details";
import { combinedUsage } from "../lib/history-presentation";
import type { LocalSummary } from "../lib/dashboard/types";
import configuration from "../../../config/estimation.build.json";
import mappings from "../../../config/estimation.mappings.json";
import media from "../../../config/estimation.media.json";

function emptyLocalSummary(): LocalSummary {
  const metric = () => ({ value: null, known: 0, unknown: 0, groups: [] });
  return {
    requests: 0,
    attempts: 0,
    tokens: {
      input: metric(),
      newInput: metric(),
      toolOutput: metric(),
      imageInput: metric(),
      logicalInput: metric(),
      output: metric(),
      answer: metric(),
      thinking: metric(),
      toolInput: metric(),
      intermediate: metric(),
      reasoning: metric(),
      otherModels: metric(),
    },
    metrics: {
      energy: metric(),
      carbon: metric(),
      waterDirect: metric(),
      waterUpstream: metric(),
      water: metric(),
    },
    tools: { chatgpt: 0, claude: 0, gemini: 0, perplexity: 0 },
    models: [],
    outcomes: {},
  };
}

function history(count: string): HistoryView {
  return {
    local: {
      ...emptyHistorySummary(),
      status: "available",
      observed_prompt_count: count,
      observed_response_count: count,
      prompt_count: count,
      response_count: count,
    },
    pending: null,
    server: null,
    server_status: "unavailable",
    coverage: "partial_loaded_history",
  };
}
function render(summary: LocalSummary, view: HistoryView) {
  return new JSDOM(
    renderToStaticMarkup(
      <DashboardDetails
        summary={summary}
        dashboard={null}
        methodStatus={null}
        history={view}
      />,
    ),
  );
}

test("EcoLogits dashboard shows water consumption without component rows or water-source labels", () => {
  const methods = createMethodRegistry(configuration, mappings, media);
  const summary = emptyLocalSummary();
  const metadata = {
    requested_method: methods.ecologits,
    effective_method: methods.ecologits,
    comparability: {
      energy_boundary: "facility" as const,
      carbon_boundary: "lifecycle" as const,
      carbon_accounting: "location" as const,
      water_kind: "consumption" as const,
      direct_water_source: "unknown" as const,
      upstream_water_source: "all_source" as const,
      common_water_scope: null,
      tokenizer_profile_id: null,
    },
  };
  summary.metrics.water = {
    value: "0.123",
    unit: "L",
    known: 1,
    unknown: 0,
    ...metadata,
  };
  for (const scope of ["local", "server"] as const) {
    const view =
      scope === "local"
        ? summary
        : {
            scopeToken: "a".repeat(64),
            aggregate_status: "current",
            resources: ["water_total", "water_direct", "water_upstream"].map(
              (quantity) => ({
                quantity,
                unit: "L",
                scope: "modeled_text_component",
                value: quantity === "water_total" ? "0.123" : null,
                unknown_count: "0",
                contributing_attempt_count: "1",
                ...metadata,
              }),
            ),
          };
    const dom = new JSDOM(
      renderToStaticMarkup(
        <DashboardDetails
          summary={view}
          dashboard={null}
          methodStatus={null}
          history={null}
        />,
      ),
    );
    try {
      const text = dom.window.document.body.textContent!;
      assert.match(text, /Water consumption/);
      assert.match(text, /123 mL/);
      assert.doesNotMatch(
        text,
        /Direct cooling water|Electricity-supply water|water direct|water upstream|Direct source|Electricity-supply source/,
      );
    } finally {
      dom.window.close();
    }
  }
});

test("history-only 157-request dashboard does not present four zero bars as a combined tool breakdown", () => {
  const summary = emptyLocalSummary(),
    view = history("157");
  const before = JSON.stringify({ summary, view });
  assert.equal(combinedUsage(summary, view)?.requests, "157");
  const dom = render(summary, view),
    document = dom.window.document;
  try {
    assert.match(
      document.body.textContent!,
      /Earlier loaded messages remain in Request coverage and headline totals/,
    );
    assert.match(
      document.body.textContent!,
      /No requests were recorded live in this period/,
    );
    assert.equal(document.querySelectorAll("meter").length, 0);
    assert.match(document.body.textContent!, /157/);
    assert.match(
      document.body.textContent!,
      /No model was reliably identified in live requests/,
    );
    for (const title of [
      "Live requests by tool",
      "Models observed in live requests",
      "Tokens for live requests",
      "Resource estimates for live requests",
      "Images and media in live requests",
    ])
      assert.ok(
        [...document.querySelectorAll("h2")].some(
          (node) => node.textContent === title,
        ),
      );
    assert.equal(JSON.stringify({ summary, view }), before);
  } finally {
    dom.window.close();
  }
});

test("mixed history and live requests retain honest tool/model scope without inventing historical attribution", () => {
  const summary = emptyLocalSummary(),
    view = history("155");
  summary.requests = 2;
  summary.tools.claude = 2;
  summary.models = ["observed-live-model"];
  const before = JSON.stringify({ summary, view });
  assert.equal(combinedUsage(summary, view)?.requests, "157");
  const dom = render(summary, view),
    document = dom.window.document;
  try {
    const tools = [...document.querySelectorAll("section")].find(
      (node) =>
        node.querySelector("h2")?.textContent === "Live requests by tool",
    )!;
    assert.equal(
      [...tools.querySelectorAll("meter")].reduce(
        (sum, meter) => sum + Number(meter.getAttribute("value")),
        0,
      ),
      2,
    );
    assert.equal(
      tools
        .querySelector("meter[value='2']")
        ?.parentElement?.querySelector("span")?.textContent,
      "claude",
    );
    const models = [...document.querySelectorAll("section")].find(
      (node) =>
        node.querySelector("h2")?.textContent ===
        "Models observed in live requests",
    )!;
    assert.deepEqual(
      [...models.querySelectorAll("li")].map((node) => node.textContent),
      ["observed-live-model"],
    );
    assert.match(
      document.body.textContent!,
      /These breakdowns cover requests recorded live/,
    );
    assert.equal(JSON.stringify({ summary, view }), before);
  } finally {
    dom.window.close();
  }
});

test("company resource and token detail groups clearly retain their live-request scope", () => {
  const view = history("155");
  view.server = view.local;
  view.server_status = "current";
  const summary = {
    scopeToken: "a".repeat(64),
    aggregate_status: "current",
    request_count: "2",
    resources: [],
    tokens: [],
  };
  assert.equal(combinedUsage(summary, view)?.requests, "157");
  const dom = new JSDOM(
    renderToStaticMarkup(
      <DashboardDetails
        summary={summary}
        dashboard={null}
        methodStatus={null}
        history={view}
      />,
    ),
  );
  try {
    const titles = [...dom.window.document.querySelectorAll("h2")].map(
      (node) => node.textContent,
    );
    assert.ok(titles.includes("Token groups for live requests"));
    assert.ok(titles.includes("Resource groups for live requests"));
    assert.ok(titles.includes("Media coverage for live requests"));
    assert.match(
      dom.window.document.body.textContent!,
      /Earlier loaded messages remain in Request coverage and headline totals/,
    );
  } finally {
    dom.window.close();
  }
});

// The image benchmark data was removed on 20 October 2026. Results saved before then can still
// hold its references; the dashboard no longer shows them.
test("the dashboard does not list image benchmark references of saved results", () => {
  const summary = emptyLocalSummary();
  summary.images = { operations: 2, returned: "2", unknown: 0, completed: 2 };
  summary.estimate = {
    image_references: [
      {
        profile_selection: "reference_only",
        reference_only: true,
        gpu_kwh: null,
        cohort_id: "first-reply-cohort",
      },
    ],
  };
  const dom = render(summary, history("0"));
  try {
    const text = dom.window.document.body.textContent!;
    assert.match(text, /2 observed image operations/);
    assert.doesNotMatch(text, /image benchmark/i);
    assert.doesNotMatch(text, /first-reply-cohort/);
  } finally {
    dom.window.close();
  }
});
