import {
  FileTextSummarySection,
  formatDateTime,
  formatInteger,
} from "@footprint/ui";
import {
  DEFAULT_DISPLAY_SCENARIO,
  type DisplayScenario,
  type HistoryView,
} from "@footprint/contracts";
import type { MethodStatus } from "../method-service";
import {
  LOCAL_TOKEN_LABELS,
  type LocalSummary,
  type ServerSummary,
  type Dashboard,
  type LocalMetric,
  type ServerSeries,
} from "./types";
import {
  resourceValue,
  resourceProvenance,
  isVisibleResource,
} from "./resource-presentation";
import { HistoryDetails } from "./history-details";
import { selectedHistory } from "../history-presentation";
export function DashboardDetails({
  summary,
  dashboard,
  methodStatus,
  history,
  scenario = DEFAULT_DISPLAY_SCENARIO,
}: {
  summary: LocalSummary | ServerSummary | null;
  dashboard: Dashboard | null;
  methodStatus: MethodStatus | null;
  history: HistoryView | null;
  scenario?: DisplayScenario;
}) {
  if (!summary) return null;
  const loaded = history ? selectedHistory(summary, history) : null;
  const scopeNote = (
    <p>
      These breakdowns cover requests recorded live.
      {loaded?.status === "available" && loaded.observed_prompt_count !== "0"
        ? " Earlier loaded messages remain in Request coverage and headline totals."
        : ""}
    </p>
  );
  if (!("requests" in summary))
    return (
      <>
        {history && <HistoryDetails history={history} scenario={scenario} />}
        {scopeNote}
        <ServerDetails
          summary={summary}
          methodStatus={methodStatus}
          scenario={scenario}
        />
      </>
    );
  return (
    <>
      {history && <HistoryDetails history={history} scenario={scenario} />}
      {scopeNote}
      <div className="dashboard-grid">
        <section>
          <h2>Live requests by tool</h2>
          {summary.requests === 0 ? (
            <p>No requests were recorded live in this period.</p>
          ) : (
            Object.entries(summary.tools).map(([name, value]) => (
              <div className="bar-row" key={name}>
                <span>{name}</span>
                <meter
                  min="0"
                  max={Math.max(...Object.values(summary.tools), 1)}
                  value={value}
                />
                <b>{value}</b>
              </div>
            ))
          )}
        </section>
        <section>
          <h2>Models observed in live requests</h2>
          {summary.models.length ? (
            <ul>
              {summary.models.map((model) => (
                <li key={model}>{model}</li>
              ))}
            </ul>
          ) : (
            <p>
              No model was reliably identified in live requests during this
              period.
            </p>
          )}
        </section>
        <section>
          <h2>Tokens for live requests</h2>
          {Object.entries(LOCAL_TOKEN_LABELS).map(([name, label]) => (
            <MetricGroups
              key={name}
              label={label}
              metric={summary.tokens[name as keyof typeof LOCAL_TOKEN_LABELS]}
              defaultUnit="tokens"
              methodStatus={methodStatus}
              scenario={scenario}
            />
          ))}
        </section>
        <section>
          <h2>Resource estimates for live requests</h2>
          <MetricGroups
            label="Electricity"
            metric={summary.metrics.energy}
            defaultUnit="kWh"
            methodStatus={methodStatus}
            scenario={scenario}
          />
          <MetricGroups
            label="Carbon"
            metric={summary.metrics.carbon}
            defaultUnit="gCO2e"
            methodStatus={methodStatus}
            scenario={scenario}
          />
          <MetricGroups
            label="Water consumption"
            metric={summary.metrics.water}
            defaultUnit="L"
            methodStatus={methodStatus}
            scenario={scenario}
          />
          <WaterComponent
            quantity="water_direct"
            label="Direct cooling water"
            metric={summary.metrics.waterDirect}
            defaultUnit="L"
            methodStatus={methodStatus}
            scenario={scenario}
          />
          <WaterComponent
            quantity="water_upstream"
            label="Electricity-supply water"
            metric={summary.metrics.waterUpstream}
            defaultUnit="L"
            methodStatus={methodStatus}
            scenario={scenario}
          />
        </section>
        <section>
          <h2>Images and media in live requests</h2>
          {summary.images ? (
            <>
              <p>
                {summary.images.operations} observed image operations;{" "}
                {summary.images.completed} completed.
              </p>
              <p>
                Returned images: {summary.images.returned ?? "Unknown"}. Unknown
                outcomes: {summary.images.unknown}.
              </p>
            </>
          ) : (
            <p>No image-operation summary is available for this view.</p>
          )}
        </section>
        <FileTextSummarySection
          fileText={summary.file_text}
          coverage={summary.file_text_coverage}
        />
      </div>
    </>
  );
}

function WaterComponent({
  quantity,
  metric,
  ...props
}: {
  quantity: string;
  label: string;
  metric: LocalMetric;
  defaultUnit: string;
  methodStatus: MethodStatus | null;
  scenario: DisplayScenario;
}) {
  const groups = metric.groups?.filter((group) =>
    isVisibleResource(quantity, group),
  );
  if (metric.groups?.length)
    return groups?.length ? (
      <MetricGroups {...props} metric={{ ...metric, groups }} />
    ) : null;
  if (metric.value === null || !isVisibleResource(quantity, metric))
    return null;
  return <MetricGroups {...props} metric={metric} />;
}

function MetricGroups({
  label,
  metric,
  defaultUnit,
  methodStatus,
  scenario,
}: {
  label: string;
  metric: LocalMetric;
  defaultUnit: string;
  methodStatus: MethodStatus | null;
  scenario: DisplayScenario;
}) {
  if (metric.groups?.length)
    return (
      <div className="detail-group">
        <h3>{label}</h3>
        {metric.groups.map((group, index) => (
          <p
            className="group"
            key={`${group.signature ?? group.scope}-${index}`}
          >
            {resourceValue(
              group.value,
              group.unit ?? defaultUnit,
              group,
              scenario,
            )}
            . {resourceProvenance(group, group.unit ?? defaultUnit, scenario)}{" "}
            Scope:{" "}
            {group.scope.replaceAll("_", " ")}.{" "}
            {group.method_id
              ? "Calculation method " +
                trustedMethodLabel(group.method_id, methodStatus) +
                ". "
              : ""}
            {group.profile_selection
              ? `${group.profile_selection.replaceAll("_", " ")}. `
              : ""}
            {group.evidence ? `${group.evidence.replaceAll("_", " ")}. ` : ""}
            {group.completeness
              ? `${group.completeness.replaceAll("_", " ")}.`
              : ""}
          </p>
        ))}
      </div>
    );
  return (
    <p>
      {label}:{" "}
      {resourceValue(metric.value, metric.unit ?? defaultUnit, metric, scenario)}
      . {resourceProvenance(metric, metric.unit ?? defaultUnit, scenario)}{" "}
      {metric.unknown} unknown.
    </p>
  );
}

function ServerDetails({
  summary,
  methodStatus,
  scenario,
}: {
  summary: ServerSummary;
  methodStatus: MethodStatus | null;
  scenario: DisplayScenario;
}) {
  return (
    <div className="dashboard-grid">
      <section>
        <h2>Server coverage for live requests</h2>
        <p>
          {summary.coverage?.resource_scope ??
            "Coverage details are unavailable."}
        </p>
        {summary.retention_cutoff && (
          <p>
            Retained history starts {formatDateTime(summary.retention_cutoff)}.
          </p>
        )}
      </section>
      <section>
        <h2>Token groups for live requests</h2>
        {summary.tokens?.length ? (
          summary.tokens.map((item, index) => (
            <SeriesLine
              item={item}
              methodStatus={methodStatus}
              scenario={scenario}
              key={`${item.quantity}-${item.scope}-${index}`}
            />
          ))
        ) : (
          <p>No token groups are available.</p>
        )}
      </section>
      <section>
        <h2>Resource groups for live requests</h2>
        {summary.resources?.length ? (
          summary.resources
            .filter((item) => isVisibleResource(item.quantity, item))
            .map((item, index) => (
              <SeriesLine
                item={item}
                methodStatus={methodStatus}
                scenario={scenario}
                key={`${item.quantity}-${item.scope}-${index}`}
              />
            ))
        ) : (
          <p>No compatible resource estimate is available.</p>
        )}
      </section>
      <section>
        <h2>Media coverage for live requests</h2>
        <p>
          Image and document operations contribute only when their compatible
          server calculation is present in the resource groups. Missing media
          work is not changed to zero.
        </p>
      </section>
      <FileTextSummarySection
        fileText={summary.file_text}
        coverage={summary.file_text_coverage}
      />
    </div>
  );
}

function SeriesLine({
  item,
  methodStatus,
  scenario,
}: {
  item: ServerSeries;
  methodStatus: MethodStatus | null;
  scenario: DisplayScenario;
}) {
  const methodId = item.method_group?.method_id ?? item.method_id;
  return (
    <p className="group">
      {item.quantity === "water_total"
        ? "Water consumption"
        : item.quantity.replaceAll("_", " ")}
      : {resourceValue(item.value, item.unit, item, scenario)}.{" "}
      {resourceProvenance(item, item.unit, scenario)} Scope:{" "}
      {item.scope.replaceAll("_", " ")}.{" "}
      {formatInteger(item.contributing_attempt_count)} included;{" "}
      {formatInteger(item.unknown_count)} unknown.
      {item.profile_selection
        ? ` ${item.profile_selection.replaceAll("_", " ")}.`
        : ""}
      {item.selected_profile_id ? ` Profile ${item.selected_profile_id}.` : ""}
      {methodId
        ? " Calculation method " +
          trustedMethodLabel(methodId, methodStatus) +
          "."
        : ""}
    </p>
  );
}

function trustedMethodLabel(methodId: string, status: MethodStatus | null) {
  return (
    status?.methods.find((method) => method.id === methodId)?.label ?? methodId
  );
}
