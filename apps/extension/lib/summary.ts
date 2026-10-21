import type { RecordRow } from "@footprint/ledger";
import { countsAsRequest } from "@footprint/contracts";
import { sumFixed } from "@footprint/ui/totals";
import { EstimateDetails } from "./estimate-details";
import { FileTextAccumulator } from "./file-text-summary";
import { TokenTotals } from "./token-summary";
import { countedReplyTokens } from "./claude-token-factor";
import {
  aggregateMetricLineage,
  aggregateMetricMetadata,
  estimateIsReferenceOnly,
  estimateMatchesSource,
  estimateMetric,
  estimateRequestedMethodId,
  estimateSourceAttemptId,
  estimateView,
  groupRange,
  estimateRelease,
  metricLineage,
  metricSignature,
  type EstimateMetricName,
  type PresentedEstimate,
} from "./estimate-presentation";
export {
  estimateSourceAttemptId,
  estimateSourceRevision,
  metricLineage,
  metricSignature,
  type PresentedEstimate,
} from "./estimate-presentation";
export type Filters = {
  calculationView?: "original" | "recalculated";
  methodId?: string;
  start?: string;
  end?: string;
  site?: string;
  model?: string;
};
export { sumFixed };
export { tokenSignature } from "./token-summary";
export function summarize(
  rows: RecordRow[],
  estimates: PresentedEstimate[],
  filters: Filters = {},
) {
  const allRequests = rows.filter((r) => r.record.kind === "request");
  const inRange = (at: string) =>
    (!filters.start || at >= filters.start) &&
    (!filters.end || at < filters.end);
  const requests = allRequests.filter(
    ({ record: r, aliasOf }) =>
      !aliasOf &&
      r.kind === "request" &&
      inRange(r.dispatched_at) &&
      (!filters.site || r.site === filters.site) &&
      (!filters.model || r.model_id === filters.model),
  );
  const requestIds = new Set(
    allRequests
      .filter(
        ({ record: r }) =>
          r.kind === "request" && (!filters.site || r.site === filters.site),
      )
      .map((r) => r.record.request_id),
  );
  const attempts = rows.filter(
    ({ record: r, aliasOf }) =>
      !aliasOf &&
      r.kind === "attempt" &&
      inRange(r.started_at) &&
      requestIds.has(r.request_id) &&
      (!filters.model || r.model_id === filters.model),
  );
  const requestById = new Map(
    allRequests.flatMap(({ record, aliasOf }) =>
      !aliasOf && record.kind === "request"
        ? [[record.request_id, record] as const]
        : [],
    ),
  );
  const current = new Map(
    attempts.flatMap(({ record: attempt }) => {
      if (attempt.kind !== "attempt") return [];
      const parent = requestById.get(attempt.request_id);
      return parent
        ? [[attempt.attempt_id, { attempt, parent }] as const]
        : [];
    }),
  );
  const selected = [
    ...new Map(
      estimates
        .filter(
          (e) =>
            (() => {
              const sourceId = estimateSourceAttemptId(e);
              const source = sourceId ? current.get(sourceId) : undefined;
              return (
                !!source &&
                estimateMatchesSource(e, source.attempt, source.parent)
              );
            })() &&
            !estimateIsReferenceOnly(e) &&
            estimateView(e) === (filters.calculationView ?? "original") &&
            (!filters.methodId ||
              estimateRequestedMethodId(e) === filters.methodId),
        )
        .map((e) => [estimateSourceAttemptId(e)!, e]),
    ).values(),
  ];
  const metric = (name: EstimateMetricName) => {
    const usable = selected.filter(
      (estimate) => estimateMetric(estimate, name).value !== null,
    );
    const grouped = new Map<string, PresentedEstimate[]>();
    for (const e of usable) {
      const signature = metricSignature(e, name);
      const group = grouped.get(signature) ?? [];
      group.push(e);
      grouped.set(signature, group);
    }
    const groups = [...grouped].map(([signature, values]) => {
      const metrics = values.map((estimate) => estimateMetric(estimate, name));
      const lineage = aggregateMetricLineage(values[0]!, name);
      return {
        signature,
        ...lineage,
        // Envelope groups add ranged and scalar members endpoint by endpoint.
        ...("value_kind" in lineage
          ? {
              ...groupRange(metrics, sumFixed),
              // A group may add releases of one method family; Details says so.
              method_releases: [
                ...new Set(values.map(estimateRelease)),
              ].sort(),
            }
          : {}),
        value: sumFixed(metrics.map((metric) => metric.value!)),
        known: values.length,
      };
    });
    return {
      value: groups.length === 1 ? groups[0]!.value : null,
      known: usable.length,
      unknown: Math.max(0, attempts.length - usable.length),
      unit:
        groups.length === 1
          ? groups[0]!.unit
          : name === "energy"
            ? "kWh"
            : name === "carbon"
              ? "gCO2e"
              : "L",
      groups,
      reason: groups.length > 1 ? "incompatible_scopes" : null,
      ...aggregateMetricMetadata(
        groups.length === 1
          ? (groups[0] as Record<string, unknown>)
          : undefined,
      ),
    };
  };
  const tokens = new TokenTotals();
  // Every attempt here has a request (requestIds), aliased ones included.
  const siteOf = new Map(
    allRequests.flatMap(({ record }) =>
      record.kind === "request"
        ? [[record.request_id, record.site] as const]
        : [],
    ),
  );
  for (const { record } of attempts)
    if (record.kind === "attempt") {
      const counted = countedReplyTokens(
        siteOf.get(record.request_id)!,
        record.model_id,
        record.tokens,
        record.generation,
      );
      tokens.add(counted.tokens, counted.components);
    }
  const details = new EstimateDetails();
  for (const estimate of selected) details.add(estimate);
  // Read aloud adds speech to a reply already counted, so it is not a request (G1).
  const sent = requests.filter(
    ({ record: r }) => r.kind === "request" && countsAsRequest(r),
  );
  const tools = Object.fromEntries(
    ["chatgpt", "claude", "gemini", "perplexity", "notebooklm"].map((site) => [
      site,
      sent.filter(({ record: r }) => r.kind === "request" && r.site === site)
        .length,
    ]),
  );
  const operations = attempts.flatMap(({ record: r }) =>
    r.kind === "attempt" ? r.media.image_operations : [],
  );
  const knownImages = operations.filter((op) => op.returned_count !== null);
  // File text is counted per request; read aloud and notebook guides are not requests,
  // as in the server's totals (W9 review).
  const files = new FileTextAccumulator();
  for (const { record } of sent)
    if (record.kind === "request") files.request(record);
  return {
    ...files.result(),
    requests: sent.length,
    attempts: attempts.filter(
      ({ record: r }) =>
        r.kind === "attempt" && r.execution_evidence !== "none",
    ).length,
    tokens: tokens.result(),
    metrics: {
      energy: metric("energy"),
      carbon: metric("carbon"),
      waterDirect: metric("water_direct"),
      waterUpstream: metric("water_upstream"),
      water: metric("water_total"),
    },
    images: {
      operations: operations.length,
      returned: knownImages.length
        ? knownImages
            .reduce((n, op) => n + BigInt(op.returned_count!), 0n)
            .toString()
        : null,
      unknown: operations.length - knownImages.length,
      completed: operations.filter((op) => op.state === "completed").length,
    },
    tools,
    models: [
      ...new Set(requests.map(({ record: r }) => r.model_id).filter(Boolean)),
    ],
    outcomes: Object.fromEntries(
      [
        "completed",
        "cancelled",
        "failed",
        "interrupted_unconfirmed",
        "generating",
      ].map((state) => [
        state,
        attempts.filter((r) => r.record.state === state).length,
      ]),
    ),
    estimate: selected[0] ?? null,
    estimation: details.result(),
  };
}
