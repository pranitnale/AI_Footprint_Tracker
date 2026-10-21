import { formatInteger } from "./formatters";

export type FileTextSeries = {
  quantity: "extracted_file_text";
  scope: "extracted_file_text";
  unit: "tokens";
  additive: false;
  value: string | null;
  measurement_group: {
    origin: "new_upload" | "retained_context" | "unknown_origin";
    extraction_profile_id: string;
    evidence: "heuristic_estimate" | "unknown";
    profile_id: string | null;
  };
  applicable_count: number;
  contributing_component_count: number;
  unknown_count: number;
  partial_count: number;
  unvalidated_count: number;
  reason_counts?: Record<string, number>;
  missing_counts?: Record<string, number>;
};

export type FileTextCoverage = {
  observed_request_count: string;
  unknown_request_count: string;
  scope: "extracted_file_text";
  additive: false;
};

export type ExtractedFileTextComponent = {
  component_id: string;
  origin: "new_upload" | "retained_context" | "unknown_origin";
  extraction_profile_id: string;
  page_count: number | null;
  tokens: {
    value: string | null;
    evidence: "heuristic_estimate" | "unknown";
    scope: "extracted_file_text";
    completeness: string;
    profile_id: string | null;
    reason: string | null;
  };
  missing: string[];
};

export type FileTextGroupPresentation = {
  key: string;
  origin: string;
  profile: string;
  extractionProfileId: string;
  tokens: string;
  tokenizerProfile: string;
  evidence: string;
  applicable: string;
  contributing: string;
  unknown: string;
  partial: string;
  unvalidated: string;
  reasons: string;
  missing: string;
};

export type FileTextPresentation = {
  title: "Extracted file text" | "Locally extracted document text";
  description: string;
  coverage: { observedRequests: string; unknownRequests: string } | null;
  coverageUnknown: string | null;
  empty: string | null;
  groups: FileTextGroupPresentation[];
};

export function fileTextOriginLabel(
  value: FileTextSeries["measurement_group"]["origin"],
) {
  if (value === "new_upload") return "New upload";
  if (value === "retained_context") return "Retained conversation context";
  return "Unknown origin";
}

export function fileTextProfileLabel(value: string) {
  if (value === "observed-inline-file-text-v1")
    return "Observed inline file text";
  if (value === "local-file-text-utf8-pdfjs6.3.289-opc-v1")
    return "Locally extracted file text";
  return "Other extraction profile";
}

export function readableFileTextCode(value: string) {
  return value.replaceAll("_", " ");
}

export function countedFileTextCodes(value?: Record<string, number>) {
  if (!value || Object.keys(value).length === 0) return "None recorded";
  return Object.entries(value)
    .map(
      ([reason, count]) =>
        `${readableFileTextCode(reason)}: ${formatInteger(count)}`,
    )
    .join(", ");
}

export function presentFileTextSummary(
  fileText?: FileTextSeries[] | null,
  coverage?: FileTextCoverage | null,
): FileTextPresentation {
  const groups = Array.isArray(fileText)
    ? fileText.map((item, index) => ({
        key: `${item.measurement_group.origin}-${item.measurement_group.extraction_profile_id}-${item.measurement_group.profile_id ?? "unknown"}-${index}`,
        origin: fileTextOriginLabel(item.measurement_group.origin),
        profile: fileTextProfileLabel(
          item.measurement_group.extraction_profile_id,
        ),
        extractionProfileId: item.measurement_group.extraction_profile_id,
        tokens: (() => {
          const inline =
            item.measurement_group.extraction_profile_id ===
            "observed-inline-file-text-v1";
          if (item.value === null)
            return inline
              ? "Unknown observed inline file-text tokens"
              : "Unknown locally extracted tokens";
          return `${formatInteger(item.value)} ${inline ? "observed inline file-text" : "locally extracted"} tokens`;
        })(),
        tokenizerProfile: item.measurement_group.profile_id ?? "Unknown",
        evidence:
          item.measurement_group.evidence === "heuristic_estimate"
            ? "Heuristic local estimate"
            : "Unknown",
        applicable: formatInteger(item.applicable_count),
        contributing: formatInteger(item.contributing_component_count),
        unknown: formatInteger(item.unknown_count),
        partial: formatInteger(item.partial_count),
        unvalidated: formatInteger(item.unvalidated_count),
        reasons: countedFileTextCodes(item.reason_counts),
        missing: countedFileTextCodes(item.missing_counts),
      }))
    : [];
  return {
    title: fileText?.some(
      (item) =>
        item.measurement_group.extraction_profile_id ===
        "observed-inline-file-text-v1",
    )
      ? "Extracted file text"
      : "Locally extracted document text",
    description:
      "These non-additive token estimates cover file text observed inline or extracted locally by the browser. Each origin and extraction profile remains separate. They are heuristic local estimates, not calibrated provider processing counts. They are not added to input, output or resource estimates and do not establish original file fidelity, rendered visibility, provider OCR, retrieval or processing.",
    coverage: coverage
      ? {
          observedRequests: formatInteger(coverage.observed_request_count),
          unknownRequests: formatInteger(coverage.unknown_request_count),
        }
      : null,
    coverageUnknown: coverage
      ? null
      : "Request-level file-text coverage is unknown.",
    empty: !Array.isArray(fileText)
      ? "Document text extraction is unknown for this view. Historical or unassociated records may not include it."
      : fileText.length === 0
        ? "No correlated file-text components were observed in this view. This does not establish zero provider file processing."
        : null,
    groups,
  };
}
