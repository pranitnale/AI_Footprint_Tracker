import { useState, type ReactNode } from "react";
import type { DisplayScenario } from "@footprint/contracts";
import { Icon } from "@footprint/ui/icons";
import { formatInteger } from "@footprint/ui/formatters";
import { ApiClient } from "../api";
import { PageTitle } from "../components";
import { Card, PeriodMenu, ScenarioMenu, Skeleton, StateCard, UpdatingNote } from "./controls";
import {
  SCENARIO_NAMES,
  SITE_LABELS,
  SITE_ORDER,
  adminFigures,
  baseText,
  baseValue,
  dashWindow,
  modelName,
  peopleOf,
  type AdminSummary,
  type DashWindow,
  type Metric,
  type UsageFigures,
} from "./figures";
import { METRIC_LABELS, MethodNote, ServerProblem, useSummary, useTimezone } from "./AdminOverview";
import { cachedSince, useAdminView } from "./state";

type Kind = { label: string; similar: boolean };

/**
 * How a model's electricity was estimated, from the estimate groups its totals carry: the model's
 * own EcoLogits record, or a similar model standing in (the same rule as the extension's Models page).
 * Only groups with a figure count. A reply stopped before any answer was written keeps its group
 * with no value, so a model used only for such replies read "Own record" beside an Unknown
 * electricity while its tool had a value (QA of 19 Oct 2026).
 */
export function estimationKind(part: AdminSummary | undefined): Kind {
  const groups = (part?.resources ?? [])
    .filter((series) => series.quantity === "energy" && series.value !== null)
    .map((series) => series.method_group ?? {});
  const selections = new Set(groups.map((group) => group.profile_selection).filter(Boolean));
  const target = groups.find((group) => group.profile_selection === "model_override" && group.selected_profile_id)?.selected_profile_id;
  if (selections.size === 1 && selections.has("direct_mapping")) return { label: "Own record", similar: false };
  if (selections.has("model_override"))
    return { label: target ? `Similar model: ${modelName(String(target).replace(/^[a-z_]+\//, "").replace(/\./g, "-"))}` : "Similar model", similar: true };
  if (selections.has("provider_flagship")) return { label: "Family estimate", similar: false };
  if (selections.has("direct_mapping")) return { label: "Own record, some replies estimated otherwise", similar: false };
  if (!groups.length && part?.history?.status === "available") return { label: "Earlier messages only", similar: false };
  // An estimate from a reference method that names no model mapping (the original method).
  if (groups.length) return { label: "Reference estimate", similar: false };
  return { label: "Not estimated", similar: false };
}

type ModelRow = { id: string; site: string; figures: UsageFigures; people: number | null; kind: Kind };

function modelRows(summary: AdminSummary, scenario: DisplayScenario): ModelRow[] {
  return Object.entries(summary.models ?? {}).flatMap(([id, part]) => {
    const figures = adminFigures(part, scenario);
    return figures ? [{ id, site: part.site ?? "", figures, people: peopleOf(part), kind: estimationKind(part) }] : [];
  });
}

const METRICS = ["requests", "energy", "carbon", "water"] as const;

export function AdminModels({ api, children }: { api: ApiClient; children?: ReactNode }) {
  const view = useAdminView();
  const config = useTimezone(api);
  const [now] = useState(() => new Date());
  const [metric, setMetric] = useState<Metric>("requests");
  const timezone = config.data?.timezone;
  const window = timezone ? dashWindow(view.period, timezone, now) : null;
  const summary = useSummary(api, window, "");
  const error = config.error ?? summary.error;
  const updating = error ? null : cachedSince(summary);
  const actions = (
    <>
      {timezone && <PeriodMenu timezone={timezone} now={now} />}
      <ScenarioMenu />
    </>
  );
  const figures = summary.data ? adminFigures(summary.data, view.scenario) : null;
  return (
    <>
      <PageTitle title="Tools and models" actions={actions}>
        {updating !== null && <UpdatingNote since={updating} />}
      </PageTitle>
      {error ? (
        <ServerProblem error={error} onRetry={() => (config.error ? config.retry() : summary.retry())} />
      ) : !summary.data || !window ? (
        <Skeleton label="Loading tools and models" />
      ) : !figures ? (
        <StateCard icon="refresh" tone="info" title="Figures are being rebuilt">
          <p>{summary.data.safe_message ?? "Check again in a few minutes."}</p>
        </StateCard>
      ) : (
        <>
          <ByToolStacked summary={summary.data} scenario={view.scenario} metric={metric} setMetric={setMetric} window={window} />
          <AllModels summary={summary.data} scenario={view.scenario} window={window} />
          <MethodNote figures={figures} />
        </>
      )}
      {children}
    </>
  );
}

function ByToolStacked({
  summary,
  scenario,
  metric,
  setMetric,
  window,
}: {
  summary: AdminSummary;
  scenario: DisplayScenario;
  metric: Metric;
  setMetric: (metric: Metric) => void;
  window: DashWindow;
}) {
  const models = modelRows(summary, scenario);
  const tools = SITE_ORDER.flatMap((site) => {
    const part = summary.sites?.[site];
    const f = adminFigures(part, scenario);
    const total = f ? baseValue(f, metric) : null;
    if (!total) return [];
    const segments = models
      .filter((row) => row.site === site)
      .map((row) => ({ ...row, value: baseValue(row.figures, metric) ?? 0 }))
      .filter((row) => row.value > 0)
      .sort((a, b) => b.value - a.value);
    // What the shown models leave (a model kept private, or saved history without a model) stays visible.
    const rest = Math.max(0, total - segments.reduce((sum, s) => sum + s.value, 0));
    return [{ site, total, people: peopleOf(part), segments, rest: rest > total * 0.001 ? rest : 0 }];
  }).sort((a, b) => b.total - a.total);
  const all = tools.reduce((sum, tool) => sum + tool.total, 0);
  const largest = Math.max(1e-12, ...tools.map((tool) => tool.total));
  const people = peopleOf(summary);
  const similar = models.filter((row) => row.kind.similar);
  const top = tools.slice(0, 2);
  const topShare = all ? Math.round((top.reduce((sum, tool) => sum + tool.total, 0) / all) * 100) : 0;
  return (
    <Card
      title={`${METRIC_LABELS[metric]} by tool`}
      aside={
        <div className="ad-segmented" role="group" aria-label="Figure shown">
          {METRICS.map((m) => (
            <button key={m} type="button" aria-pressed={metric === m} onClick={() => setMetric(m)}>
              {METRIC_LABELS[m]}
            </button>
          ))}
        </div>
      }
    >
      <p className="ad-soft ad-card-sub">
        {window.label}, each bar split by the model that answered · {tools.length} {tools.length === 1 ? "tool" : "tools"}, {models.length}{" "}
        {models.length === 1 ? "model" : "models"}
        {people ? `, ${formatInteger(people)} people` : ""}
        {metric !== "requests" ? ` · ${SCENARIO_NAMES[scenario]} scenario` : ""}
      </p>
      {tools.length ? (
        <ul className="ad-stack-list">
          {tools.map((tool) => (
            <li key={tool.site}>
              <span className="ad-stack-name">
                <b>
                  <i className={`ad-sq ad-tool-${tool.site}`} aria-hidden="true" />
                  {SITE_LABELS[tool.site]}
                </b>
                {tool.people !== null && <small>{formatInteger(tool.people)} people</small>}
              </span>
              <span className="ad-stack-body">
                <span className="ad-stack" style={{ width: `${(tool.total / largest) * 100}%` }} aria-hidden="true">
                  {tool.segments.map((seg, index) => (
                    <span
                      key={seg.id}
                      className={`ad-seg ad-tool-${tool.site} ad-shade-${Math.min(index, 3)}${seg.kind.similar ? " ad-seg-hatch" : ""}`}
                      style={{ flexGrow: seg.value }}
                    >
                      {seg.value / largest > 0.1 && <span>{baseText(metric, seg.value)}</span>}
                    </span>
                  ))}
                  {tool.rest > 0 && <span className="ad-seg ad-seg-rest" style={{ flexGrow: tool.rest }} />}
                </span>
                <span className="ad-legend">
                  {tool.segments.map((seg, index) => (
                    <span key={seg.id}>
                      <i className={`ad-sq ad-tool-${tool.site} ad-shade-${Math.min(index, 3)}${seg.kind.similar ? " ad-seg-hatch" : ""}`} aria-hidden="true" />
                      {modelName(seg.id)} <b>{baseText(metric, seg.value)}</b>
                    </span>
                  ))}
                  {tool.rest > 0 && (
                    <span>
                      <i className="ad-sq ad-seg-rest" aria-hidden="true" />
                      Earlier messages and other models <b>{baseText(metric, tool.rest)}</b>
                    </span>
                  )}
                </span>
              </span>
              <span className="ad-stack-total">
                <b className="ad-num">{baseText(metric, tool.total)}</b>
                <small>{all ? Math.round((tool.total / all) * 100) : 0}% of all</small>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ad-soft">No tool has a figure for this period.</p>
      )}
      {tools.length > 1 && (
        <p className="ad-card-foot">
          <b>
            {top.map((tool) => SITE_LABELS[tool.site]).join(" and ")} account for {topShare}% of all {metric === "requests" ? "requests" : METRIC_LABELS[metric].toLowerCase()}.
          </b>{" "}
          {similar.length > 0 && `Striped: ${similar.map((row) => modelName(row.id)).join(", ")} ${similar.length === 1 ? "is" : "are"} estimated with a similar model.`}
        </p>
      )}
    </Card>
  );
}

/** A CSV cell. A leading =, +, - or @ is quoted so a spreadsheet never reads the cell as a formula. */
function cell(value: string | number | null) {
  const text = value === null ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function AllModels({ summary, scenario, window }: { summary: AdminSummary; scenario: DisplayScenario; window: DashWindow }) {
  const rows = modelRows(summary, scenario).sort((a, b) => Number(b.figures.requests ?? 0n) - Number(a.figures.requests ?? 0n));
  function download() {
    const head = ["Model", "Model id", "Tool", "People", "Requests", "Electricity (Wh)", "Carbon (g CO2e)", "Water (mL)", "How it is estimated", "Scenario"];
    const lines = rows.map((row) =>
      [
        modelName(row.id),
        row.id,
        SITE_LABELS[row.site] ?? row.site,
        row.people,
        row.figures.requests === null ? null : row.figures.requests.toString(),
        baseValue(row.figures, "energy"),
        baseValue(row.figures, "carbon"),
        baseValue(row.figures, "water"),
        row.kind.label,
        SCENARIO_NAMES[scenario],
      ]
        .map(cell)
        .join(","),
    );
    const blob = new Blob([[head.join(","), ...lines].join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `ai-footprint-models-${window.startDate ?? "all"}-${window.endDate ?? "time"}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
  return (
    <Card
      title="All models"
      className="ad-card-table"
      aside={
        rows.length > 0 && (
          <button type="button" className="ad-chip" onClick={download}>
            <Icon name="download" size={16} />
            CSV
          </button>
        )
      }
    >
      {rows.length ? (
        <div className="ad-table-scroll">
          <table className="ad-table ad-table-stacked">
            <thead>
              <tr>
                <th>Model</th>
                <th>Tool</th>
                <th className="num">People</th>
                <th className="num">Requests</th>
                <th className="num">Electricity</th>
                <th className="num">Carbon</th>
                <th className="num">Water</th>
                <th>How it is estimated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row">{modelName(row.id)}</th>
                  <td data-label="Tool">{SITE_LABELS[row.site] ?? "Not known"}</td>
                  <td className="num" data-label="People">{row.people === null ? "Not shared" : formatInteger(row.people)}</td>
                  <td className="num" data-label="Requests">
                    <b>{row.figures.requestsText}</b>
                  </td>
                  <td className="num" data-label="Electricity">{baseText("energy", baseValue(row.figures, "energy"))}</td>
                  <td className="num" data-label="Carbon">{baseText("carbon", baseValue(row.figures, "carbon"))}</td>
                  <td className="num" data-label="Water">{baseText("water", baseValue(row.figures, "water"))}</td>
                  <td data-label="How it is estimated">
                    <span className={`ad-badge${row.kind.similar ? " ad-badge-warn" : ""}`}>{row.kind.label}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="ad-soft ad-pad">No model was recorded in this period.</p>
      )}
      {rows.some((row) => baseValue(row.figures, "energy") === null) && (
        <p className="ad-soft ad-pad">
          Unknown means no reply of that model has an estimate yet: a reply still being estimated, or one stopped before any
          answer was written, which leaves no output to estimate from. Its tool's figures add only the replies that have an
          estimate. They count these as unknown, not as zero.
        </p>
      )}
    </Card>
  );
}
