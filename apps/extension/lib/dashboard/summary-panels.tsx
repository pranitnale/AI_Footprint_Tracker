import {
  Button,
  FileTextSummarySection,
  Metric,
  Notice,
  formatDateTime,
  formatInteger,
} from "@footprint/ui";
import {
  DEFAULT_DISPLAY_SCENARIO,
  type DisplayScenario,
} from "@footprint/contracts";
import type { HeldQueue, MonthlySummary } from "./types";
import { metricValue, unknownLabel } from "./metric-presentation";
import { resourceValue } from "./resource-presentation";
export function MonthlySummaryPanel({
  value,
  onClose,
  scenario = DEFAULT_DISPLAY_SCENARIO,
}: {
  value: MonthlySummary;
  onClose: () => void;
  scenario?: DisplayScenario;
}) {
  const requests = metricValue(value.summary, "requests");
  const energy = metricValue(value.summary, "energy");
  return (
    <section className="monthly-summary" aria-label="Monthly summary">
      <div className="view-head">
        <div>
          <h2>Your {value.month} summary</h2>
          <p>
            {value.timezone}. Generated{" "}
            {formatDateTime(new Date(value.generatedAt).toISOString())}.
          </p>
          <p>
            Calculation:{" "}
            {value.calculation?.view === "recalculated"
              ? "Recalculated estimates."
              : "Original recorded estimates."}
          </p>
        </div>
        <Button variant="quiet" onClick={onClose}>
          Dismiss
        </Button>
      </div>
      {"snapshot_source" in value.summary &&
        value.summary.snapshot_source === "cached" && (
          <Notice tone="warning">
            This is a cached server snapshot
            {value.summary.offline ? " because the service is offline" : ""}.
          </Notice>
        )}
      {"suppressed" in value.summary && value.summary.suppressed ? (
        <Notice tone="warning" title="Monthly totals are hidden">
          {value.summary.safe_message}
        </Notice>
      ) : (
        <>
          <div className="metric-band">
            <Metric label="Requests" value={formatInteger(requests.value)} />
            <Metric
              label="Electricity estimate"
              value={
                energy.multiple
                  ? "Multiple groups"
                  : resourceValue(
                      energy.value,
                      energy.unit || "kWh",
                      energy.provenance,
                      scenario,
                    )
              }
              detail={unknownLabel(energy.unknown)}
            />
          </div>
          <FileTextSummarySection
            fileText={value.summary.file_text}
            coverage={value.summary.file_text_coverage}
            headingLevel={3}
            className="expanded-detail file-text-summary"
          />
        </>
      )}
    </section>
  );
}

export function PersonalCompany({ onConnect }: { onConnect: () => void }) {
  return (
    <section className="empty-company">
      <h1>No organization connected</h1>
      <p>
        Personal records stay in this browser. Opening this tab does not contact
        a product server.
      </p>
      <Button variant="primary" onClick={onConnect}>
        Connect an organization
      </Button>
    </section>
  );
}

export function HeldQueueNotice({ queue }: { queue: HeldQueue }) {
  return (
    <Notice tone="warning">
      <strong>Company records held for {queue.origin}</strong>
      <span>
        {queue.count} records. State: {queue.state.replaceAll("_", " ")}
        {queue.revocation_pending
          ? ". Server revocation is still pending."
          : "."}{" "}
        These records are never reassigned.
      </span>
    </Notice>
  );
}
