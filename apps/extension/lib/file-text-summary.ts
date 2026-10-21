import {
  claudeFactorFor,
  claudeMeasurement,
  extractedFileText,
  type ExtractedFileTextComponent,
  type RequestObservation,
} from "@footprint/contracts";
import { PACKAGED_CLAUDE_TOKEN_FACTOR } from "./claude-token-factor";

export type FileTextSeries = {
  quantity: "extracted_file_text";
  scope: "extracted_file_text";
  unit: "tokens";
  additive: false;
  measurement_group: Pick<
    ExtractedFileTextComponent,
    "origin" | "extraction_profile_id"
  > &
    Pick<ExtractedFileTextComponent["tokens"], "evidence" | "profile_id">;
  value: string | null;
  applicable_count: number;
  contributing_component_count: number;
  unknown_count: number;
  partial_count: number;
  unvalidated_count: number;
  reason_counts: Record<string, number>;
  missing_counts: Record<string, number>;
};
export type FileTextSummary = {
  file_text: FileTextSeries[];
  file_text_coverage: {
    observed_request_count: string;
    unknown_request_count: string;
    scope: "extracted_file_text";
    additive: false;
  };
};

/** Canonical request pages feed this independently of attempt token and resource reducers. */
export class FileTextAccumulator {
  private observed = 0n;
  private unknown = 0n;
  private groups = new Map<string, FileTextSeries>();
  request(request: RequestObservation) {
    const components = extractedFileText(request);
    if (components === null) this.unknown++;
    else this.observed++;
    // Text of files sent to a Claude model carries the Claude token factor.
    const factor = claudeFactorFor(
      request.site,
      request.model_id,
      PACKAGED_CLAUDE_TOKEN_FACTOR,
    );
    for (const component of components ?? []) {
      const measurement = claudeMeasurement(component.tokens, factor);
      const group = {
        origin: component.origin,
        extraction_profile_id: component.extraction_profile_id,
        evidence: measurement.evidence,
        profile_id: measurement.profile_id,
      };
      const key = JSON.stringify(group);
      const series: FileTextSeries = this.groups.get(key) ?? {
        quantity: "extracted_file_text",
        scope: "extracted_file_text",
        unit: "tokens",
        additive: false,
        measurement_group: group,
        value: null,
        applicable_count: 0,
        contributing_component_count: 0,
        unknown_count: 0,
        partial_count: 0,
        unvalidated_count: 0,
        reason_counts: {},
        missing_counts: {},
      };
      series.applicable_count++;
      if (measurement.value === null) series.unknown_count++;
      else {
        series.value = (
          BigInt(series.value ?? "0") + BigInt(measurement.value)
        ).toString();
        series.contributing_component_count++;
        series.unvalidated_count++;
      }
      if (measurement.completeness === "partial") series.partial_count++;
      if (measurement.reason)
        series.reason_counts[measurement.reason] =
          (series.reason_counts[measurement.reason] ?? 0) + 1;
      for (const missing of component.missing)
        series.missing_counts[missing] =
          (series.missing_counts[missing] ?? 0) + 1;
      this.groups.set(key, series);
    }
  }
  result(): FileTextSummary {
    return {
      file_text: [...this.groups.values()].map((series) =>
        structuredClone(series),
      ),
      file_text_coverage: {
        observed_request_count: this.observed.toString(),
        unknown_request_count: this.unknown.toString(),
        scope: "extracted_file_text",
        additive: false,
      },
    };
  }
}
