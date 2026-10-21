import {
  EstimationEnvelopeSchema,
  HistoricalResourceV2Schema,
  HistoryMessageSchema,
  historyNumericPayloadHash,
  type EstimationEnvelope,
  type HistoryMessage,
  type HistorySummary,
} from "@footprint/contracts";

/** Project one observed response, retaining the original engine's archived rows. */
export function historicalResources(
  result: Readonly<EstimationEnvelope>,
  record: HistoryMessage,
): HistorySummary["resources"] {
  EstimationEnvelopeSchema.parse(result);
  HistoryMessageSchema.parse(record);
  if (
    result.source.family !== "history" ||
    result.source.message_key !== record.message_key ||
    result.source.observation_hash !== historyNumericPayloadHash(record)
  ) {
    throw new Error("estimation_source_mismatch");
  }
  if (record.role !== "response") return [];
  if (
    result.requested_method.engine_id === "original" &&
    result.effective_method.engine_id === "original"
  ) {
    if (
      result.raw?.engine_id !== "original" ||
      !Array.isArray(result.raw.result)
    ) {
      throw new Error("estimate_unavailable");
    }
    return result.raw.result;
  }
  const profile = result.selection.profile;
  const originalRows =
    result.raw?.engine_id === "original" && Array.isArray(result.raw.result)
      ? result.raw.result
      : [];
  return Object.entries(result.metrics).map(([quantity, metric]) =>
    HistoricalResourceV2Schema.parse({
      quantity,
      ...metric,
      method_id: result.requested_method.method_id,
      method_hash: result.requested_method.method_hash,
      validation_state: result.validation_state,
      profile_selection: result.selection.kind,
      selected_profile_id: profile
        ? `${profile.provider}/${profile.model_name}`
        : (originalRows.find((row) => row.quantity === quantity)
            ?.selected_profile_id ?? null),
      missing_components: result.missing_components,
      known_message_count: metric.value === null ? "0" : "1",
      unknown_message_count: metric.value === null ? "1" : "0",
      requested_method: result.requested_method,
      effective_method: result.effective_method,
      comparability: result.comparability,
    }),
  );
}
