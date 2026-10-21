import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Brand,
  ExtractedFileTextDetails,
  FileTextSummarySection,
  Metric,
  ResourceGauge,
  formatInteger,
  formatMetric,
  formatRetention,
  presentFileTextSummary,
} from "../src/index.js";

test("missing values remain unknown instead of becoming zero", () => {
  assert.equal(formatInteger(null), "Unknown");
  assert.equal(formatInteger("bad"), "Unknown");
  assert.equal(formatInteger(Number.MAX_SAFE_INTEGER + 1), "Unknown");
  assert.equal(formatInteger(Number.NaN), "Unknown");
  assert.equal(formatInteger(Number.POSITIVE_INFINITY), "Unknown");
  assert.equal(formatInteger("NaN"), "Unknown");
  assert.equal(
    formatInteger("9223372036854775807").replace(/\D/g, ""),
    "9223372036854775807",
  );
  assert.equal(formatMetric(undefined, "kWh"), "Unknown");
  assert.equal(formatMetric(0, "kWh"), "0 kWh");
});

test("small positive estimates use readable units without rounding to zero", () => {
  assert.match(formatMetric("0.00038900446245", "kWh"), /^≈ 0[.,]389 Wh$/);
  assert.match(formatMetric("0.000000001", "kWh"), /^≈ 0[.,]001 mWh$/);
  assert.match(formatMetric("0.0003565279565", "L"), /^≈ 0[.,]357 mL$/);
  assert.match(formatMetric("1234", "gCO2e"), /^≈ 1[.,]23 kg CO₂e$/);
  assert.match(formatMetric("0.0142", "gCO2"), /^≈ 0[.,]0142 g CO₂$/);
});

test("a value that rounds up to the next unit is shown in that unit", () => {
  // Just below each boundary, rounding to three digits reaches the larger unit.
  assert.equal(formatMetric("0.9996", "kWh"), "≈ 1 kWh");
  assert.match(formatMetric("0.00009996", "kWh"), /^≈ 0[.,]1 Wh$/);
  assert.match(formatMetric("0.09996", "Wh"), /^≈ 0[.,]1 Wh$/);
  assert.equal(formatMetric("0.99961", "L"), "≈ 1 L");
  assert.equal(formatMetric("999.6", "gCO2e"), "≈ 1 kg CO₂e");
  assert.equal(formatMetric("999.6", "gCO2"), "≈ 1 kg CO₂");
  assert.equal(formatMetric("0.996", "kWh", 2), "≈ 1 kWh");
  // Values that stay below the boundary after rounding keep the smaller unit.
  assert.equal(formatMetric("0.9994", "kWh"), "≈ 999 Wh");
  assert.match(formatMetric("0.00009994", "kWh"), /^≈ 99[.,]9 mWh$/);
  assert.match(formatMetric("0.09994", "Wh"), /^≈ 99[.,]9 mWh$/);
  assert.equal(formatMetric("0.99949", "L"), "≈ 999 mL");
  assert.equal(formatMetric("999.4", "gCO2e"), "≈ 999 g CO₂e");
  assert.equal(formatMetric("999.4", "gCO2"), "≈ 999 g CO₂");
  assert.equal(formatMetric("0.994", "kWh", 2), "≈ 990 Wh");
  // Just above each boundary the larger unit is used as before.
  assert.equal(formatMetric("1.0004", "kWh"), "≈ 1 kWh");
  assert.match(formatMetric("0.00010004", "kWh"), /^≈ 0[.,]1 Wh$/);
  assert.match(formatMetric("0.10004", "Wh"), /^≈ 0[.,]1 Wh$/);
  assert.equal(formatMetric("1.0004", "L"), "≈ 1 L");
  assert.equal(formatMetric("1000.4", "gCO2e"), "≈ 1 kg CO₂e");
  assert.equal(formatMetric("1000.4", "gCO2"), "≈ 1 kg CO₂");
});

test("retention periods use singular, plural and explicit unknown labels", () => {
  assert.equal(formatRetention(1), "1 month");
  assert.equal(formatRetention("6"), "6 months");
  assert.equal(formatRetention(null), "Unknown");
  assert.equal(formatRetention("bad"), "Unknown");
});

test("shared components escape untrusted text", () => {
  const html = renderToStaticMarkup(
    <Metric label="Model" value={"<img src=x onerror=alert(1)>"} />,
  );
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img/);
  assert.match(
    renderToStaticMarkup(<ResourceGauge />),
    /aria-label="AI Footprint Tracker"/,
  );
  const brand = renderToStaticMarkup(<Brand />);
  assert.match(brand, /aria-hidden="true"/);
  assert.doesNotMatch(brand, /aria-label="AI Footprint Tracker"/);
});

test("file text summaries stay separate, preserve counters and distinguish origins", () => {
  const html = renderToStaticMarkup(
    <FileTextSummarySection
      coverage={{
        observed_request_count: "9223372036854775807",
        unknown_request_count: "1",
        scope: "extracted_file_text",
        additive: false,
      }}
      fileText={[
        {
          quantity: "extracted_file_text",
          scope: "extracted_file_text",
          unit: "tokens",
          additive: false,
          value: "9223372036854775807",
          measurement_group: {
            origin: "new_upload",
            extraction_profile_id: "local-file-text-utf8-pdfjs6.3.289-opc-v1",
            evidence: "heuristic_estimate",
            profile_id: "tokenizer-profile",
          },
          applicable_count: 2,
          contributing_component_count: 1,
          unknown_count: 1,
          partial_count: 1,
          unvalidated_count: 2,
          reason_counts: { tokenizer_mapping_unverified: 1 },
          missing_counts: { provider_processing: 2, ocr: 1 },
        },
        {
          quantity: "extracted_file_text",
          scope: "extracted_file_text",
          unit: "tokens",
          additive: false,
          value: null,
          measurement_group: {
            origin: "unknown_origin",
            extraction_profile_id: "observed-inline-file-text-v1",
            evidence: "unknown",
            profile_id: null,
          },
          applicable_count: 1,
          contributing_component_count: 0,
          unknown_count: 1,
          partial_count: 0,
          unvalidated_count: 0,
        },
      ]}
    />,
  );
  assert.match(html, /Extracted file text/);
  assert.match(html, /Locally extracted file text/);
  assert.match(html, /New upload/);
  assert.match(html, /Observed inline file text/);
  assert.match(html, /Unknown origin/);
  assert.match(
    html,
    new RegExp(
      `${formatInteger("9223372036854775807")} locally extracted tokens`,
    ),
  );
  assert.match(html, /Unknown observed inline file-text tokens/);
  assert.match(html, /do not establish original file fidelity/);
  assert.match(html, /provider processing: 2/);
});

test("missing and empty file extraction never become provider zero", () => {
  const missing = renderToStaticMarkup(<FileTextSummarySection />);
  assert.match(missing, /Document text extraction is unknown/);
  assert.doesNotMatch(missing, />0</);
  const empty = renderToStaticMarkup(
    <FileTextSummarySection
      fileText={[]}
      coverage={{
        observed_request_count: "0",
        unknown_request_count: "0",
        scope: "extracted_file_text",
        additive: false,
      }}
    />,
  );
  assert.match(empty, /No correlated file-text components were observed/);
  assert.match(empty, /does not establish zero provider file processing/);
});

test("historical file text uses message coverage without changing the request default", () => {
  const coverage = {
    observed_request_count: "2",
    unknown_request_count: "1",
    scope: "extracted_file_text" as const,
    additive: false as const,
  };
  const historical = renderToStaticMarkup(
    <FileTextSummarySection
      fileText={[]}
      coverage={coverage}
      coverageLabel="Historical messages"
    />,
  );
  const requests = renderToStaticMarkup(
    <FileTextSummarySection fileText={[]} coverage={coverage} />,
  );
  assert.match(
    historical,
    /Historical messages with observed extraction state/,
  );
  assert.match(historical, /Historical messages with unknown extraction state/);
  assert.match(requests, /Requests with observed extraction state/);
  assert.doesNotMatch(requests, /Historical messages/);
});

test("request file details show page, profile, evidence and limitations", () => {
  const html = renderToStaticMarkup(
    <ExtractedFileTextDetails
      schemaVersion="1.2.0"
      extractedText={[
        {
          component_id: "00000000-0000-4000-8000-000000000001",
          origin: "unknown_origin",
          extraction_profile_id: "observed-inline-file-text-v1",
          page_count: 2,
          tokens: {
            value: "123",
            evidence: "heuristic_estimate",
            scope: "extracted_file_text",
            completeness: "partial",
            profile_id: "tokenizer-profile",
            reason: "tokenizer_mapping_unverified",
          },
          missing: ["provider_processing", "ocr"],
        },
      ]}
    />,
  );
  assert.match(html, /Pages observed/);
  assert.match(html, /Record schema version: 1.2.0/);
  assert.match(
    html,
    /does not establish original file fidelity, rendered visibility, provider OCR/,
  );
  assert.doesNotMatch(html, /visible text extracted locally/);
  assert.match(html, />2</);
  assert.match(html, /Heuristic local estimate/);
  assert.match(html, /provider processing, ocr/);
  assert.match(html, /Observed inline file text/);
  assert.match(html, /Unknown origin/);
  assert.doesNotMatch(html, /00000000-0000-4000-8000-000000000001/);
});

test("pure file presentation preserves exact coverage and never combines profile groups", () => {
  const presentation = presentFileTextSummary(
    [
      {
        quantity: "extracted_file_text",
        scope: "extracted_file_text",
        unit: "tokens",
        additive: false,
        value: "9223372036854775807",
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
        missing_counts: { provider_processing: 1, retrieval_selection: 1 },
      },
      {
        quantity: "extracted_file_text",
        scope: "extracted_file_text",
        unit: "tokens",
        additive: false,
        value: "7",
        measurement_group: {
          origin: "retained_context",
          extraction_profile_id: "local-file-text-utf8-pdfjs6.3.289-opc-v1",
          evidence: "heuristic_estimate",
          profile_id: "o200k-base-4.0.0-reference",
        },
        applicable_count: 1,
        contributing_component_count: 1,
        unknown_count: 0,
        partial_count: 0,
        unvalidated_count: 1,
      },
    ],
    {
      observed_request_count: "9223372036854775807",
      unknown_request_count: "2",
      scope: "extracted_file_text",
      additive: false,
    },
  );
  assert.equal(presentation.groups.length, 2);
  assert.ok(
    presentation.groups[0]!.tokens.includes(
      formatInteger("9223372036854775807"),
    ),
  );
  assert.equal(presentation.groups[1]!.tokens, "7 locally extracted tokens");
  assert.match(presentation.groups[0]!.origin, /unknown/i);
  assert.match(presentation.groups[0]!.missing, /provider processing: 1/);
  assert.match(
    presentation.coverage!.observedRequests.replace(/\D/g, ""),
    /9223372036854775807/,
  );
  assert.doesNotMatch(
    presentation.groups.map((group) => group.tokens).join(" "),
    /9223372036854775814/,
  );
});

test("an email code keeps its six digits when copied with a space or a dash", async () => {
  const { emailCodeDigits } = await import("../src/formatters.js");
  assert.equal(emailCodeDigits("094 475"), "094475");
  assert.equal(emailCodeDigits("094-475"), "094475");
  assert.equal(emailCodeDigits(" 094 475\n"), "094475");
  assert.equal(emailCodeDigits("0944751"), "094475");
  assert.equal(emailCodeDigits("abc"), "");
});
