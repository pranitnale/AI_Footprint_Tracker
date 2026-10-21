import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SummaryMetrics,
  formatInteger,
} from "../src/components";
import { adminDestination, normalizePath } from "../src/router";
import { safeDestination } from "../src/auth-pages";
import {
  buildDeletionExecution,
  buildDeletionPreview,
  resolveDownloads,
} from "../src/safety";

test("server roles choose fixed destinations and unsafe redirects are refused", () => {
  assert.equal(adminDestination("admin"), "/admin");
  // Members connect from the extension, so the website has no page for them.
  assert.equal(adminDestination("user"), "/login");
  assert.equal(safeDestination("/admin", false), "/admin");
  assert.equal(safeDestination("/onboarding", false), "/login");
  assert.equal(safeDestination("https://attacker.example", false), "/login");
  assert.equal(safeDestination("/operator", true), "/operator");
  assert.equal(safeDestination("/admin", true), "/operator/login");
  assert.equal(normalizePath("//admin//users/"), "/admin/users");
});

test("incompatible resource groups are shown separately", () => {
  const html = renderToStaticMarkup(
    <SummaryMetrics
      summary={{
        aggregate_status: "current",
        request_count: "2",
        pending_estimates: "1",
        file_text_coverage: {
          observed_request_count: "2",
          unknown_request_count: "1",
          scope: "extracted_file_text",
          additive: false,
        },
        file_text: [
          {
            quantity: "extracted_file_text",
            scope: "extracted_file_text",
            unit: "tokens",
            additive: false,
            value: "9223372036854775807",
            measurement_group: {
              origin: "new_upload",
              extraction_profile_id: "local-file-text-profile",
              evidence: "heuristic_estimate",
              profile_id: "tokenizer-profile",
            },
            applicable_count: 2,
            contributing_component_count: 1,
            unknown_count: 1,
            partial_count: 1,
            unvalidated_count: 2,
            reason_counts: { tokenizer_mapping_unverified: 1 },
            missing_counts: { provider_processing: 2 },
          },
        ],
        resources: [
          {
            quantity: "energy",
            unit: "kWh",
            scope: "observed_text",
            value: "0.1",
            applicable_count: 1,
            unknown_count: 0,
            partial_count: 1,
            unvalidated_count: 1,
            contributing_attempt_count: 1,
          },
          {
            quantity: "energy",
            unit: "kWh",
            scope: "image_generation",
            value: "0.2",
            applicable_count: 1,
            unknown_count: 0,
            partial_count: 1,
            unvalidated_count: 1,
            contributing_attempt_count: 1,
          },
        ],
      }}
    />,
  );
  assert.match(html, /Multiple groups/);
  assert.match(html, /observed text/);
  assert.match(html, /image generation/);
  assert.match(html, /1 estimates are still processing/);
  assert.match(html, /Locally extracted document text/);
  assert.match(
    html,
    new RegExp(
      `${formatInteger("9223372036854775807")} locally extracted tokens`,
    ),
  );
  assert.match(html, /not calibrated provider processing counts/);
});

test("suppressed summaries do not expose document-text groups", () => {
  const html = renderToStaticMarkup(
    <SummaryMetrics
      summary={{
        aggregate_status: "current",
        suppressed: true,
        safe_message: "Hidden for a small group.",
        file_text: [],
      }}
    />,
  );
  assert.match(html, /Company totals are hidden/);
  assert.doesNotMatch(html, /Locally extracted document text/);
});

test("authorized historical aggregates stay separate from observed requests", () => {
  const html = renderToStaticMarkup(
    <SummaryMetrics
      summary={{
        aggregate_status: "current",
        request_count: "2",
        history: {
          schema_version: "1.0.0",
          scope: "loaded_history",
          status: "available",
          observed_prompt_count: "13",
          observed_response_count: "10",
          prompt_count: "12",
          response_count: "10",
          dated_message_count: "18",
          undated_message_count: "4",
          calculated_message_count: "20",
          uncalculated_message_count: "2",
          matched_live_message_count: "1",
          unresolved_overlap_message_count: "2",
          conflicting_message_count: "0",
          first_request_verified: true,
          branch_scope: "selected_branch",
          provider_history_complete: false,
          file_text: [
            {
              quantity: "extracted_file_text",
              scope: "extracted_file_text",
              unit: "tokens",
              additive: false,
              value: "7",
              measurement_group: {
                origin: "unknown_origin",
                extraction_profile_id: "observed-inline-file-text-v1",
                evidence: "heuristic_estimate",
                profile_id: "o200k-base-4.0.0-reference",
              },
              applicable_count: 1,
              contributing_component_count: 1,
              unknown_count: 0,
              partial_count: 1,
              unvalidated_count: 1,
              reason_counts: { tokenizer_mapping_unverified: 1 },
              missing_counts: { provider_processing: 1, ocr: 1 },
            },
          ],
          file_text_coverage: {
            observed_message_count: "1",
            unknown_message_count: "0",
            scope: "extracted_file_text",
            additive: false,
          },
          tokens: [
            {
              role: "prompt",
              part: "total",
              profile_id: "o200k-base-4.0.0-reference",
              evidence: "heuristic_estimate",
              value: "9007199254740993123",
              known_message_count: "11",
              unknown_message_count: "1",
            },
          ],
          resources: [
            {
              quantity: "energy",
              value: null,
              unit: "kWh",
              scope: "historical_visible_response",
              method_id: "history-method-v1",
              method_hash: "a".repeat(64),
              status: "unavailable",
              validation_state: "unvalidated_reference",
              profile_selection: "unavailable",
              selected_profile_id: null,
              reasons: ["history_only"],
              missing_components: ["provider_execution_unobserved"],
              known_message_count: "0",
              unknown_message_count: "10",
            },
          ],
        },
      }}
    />,
  );
  assert.match(html, /Partially calculated/);
  assert.match(html, /Loaded prompts.*13/);
  assert.match(html, /Imported prompt contributions.*12/);
  assert.match(html, /historical message evidence, not observed API calls/);
  assert.match(html, /≈.*tokens/);
  assert.match(html, /First available request loaded/i);
  assert.match(html, /complete provider execution history/i);
  assert.match(html, /provider execution unobserved/);
  assert.match(html, /Historical messages with observed extraction state/);
  assert.match(html, /7 observed inline file-text tokens/);
  assert.match(html, /Recorded calculation method: history-method-v1/);
  assert.match(html, /changing the live recalculation view does not relabel/);
  assert.match(html, /methodology and source catalog/);
  assert.match(html, />Requests<.*>2</s);
});

test("destructive execution requires every confirmation proof", () => {
  assert.throws(() => buildDeletionExecution("preview", "reauth", false));
  assert.throws(() => buildDeletionExecution("", "reauth", true));
  const value = buildDeletionExecution("p", "r", true);
  assert.equal(value.confirmed, true);
  assert.equal(value.preview_token, "p");
});

test("deletion date ranges use organization-local midnight across DST", () => {
  const september = buildDeletionPreview(
    "range",
    { start: "2026-09-01", end: "2026-10-01" },
    "Europe/Berlin",
  );
  assert.equal(september.start, "2026-08-31T22:00:00.000Z");
  assert.equal(september.end, "2026-09-30T22:00:00.000Z");
  assert.throws(() =>
    buildDeletionPreview(
      "range",
      { start: "2026-02-30", end: "2026-03-02" },
      "Europe/Berlin",
    ),
  );
});

test("download configuration never invents a missing configured package", () => {
  const entries = resolveDownloads({ chrome: "/real/chrome.zip" });
  assert.equal(entries[0]?.href, "/real/chrome.zip");
  assert.equal(entries[1]?.href, null);
  assert.equal(entries[2]?.href, null);
});

test("unconfigured website downloads use the stable default-selected aliases", () => {
  assert.deepEqual(resolveDownloads(), [
    {
      id: "chrome",
      href: "/downloads/ai-footprint-tracker-chrome.zip",
    },
    {
      id: "edge",
      href: "/downloads/ai-footprint-tracker-edge.zip",
    },
    {
      id: "firefox",
      href: "/downloads/ai-footprint-tracker-firefox.zip",
    },
  ]);
});

test("the summary does not list image benchmark series", () => {
  // The image benchmark data was removed on 20 October 2026. A server can still report series
  // from results saved before then; the page no longer shows them.
  const html = renderToStaticMarkup(
    <SummaryMetrics
      summary={{
        aggregate_status: "current",
        request_count: "1",
        image_references: [
          {
            quantity: "energy",
            unit: "kWh",
            scope: "gpu_associated_reference",
            value: null,
            applicable_count: 1,
            unknown_count: 1,
            partial_count: 0,
            unvalidated_count: 1,
            contributing_attempt_count: 0,
            method_group: { effective_method: { engine_id: "ecologits" } },
            reason_counts: {},
          },
        ],
      }}
    />,
  );
  assert.doesNotMatch(html, /Image benchmark references/);
  assert.doesNotMatch(html, /gpu associated reference/);
});
