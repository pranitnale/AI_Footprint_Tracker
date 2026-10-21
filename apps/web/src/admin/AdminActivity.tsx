import { useState } from "react";
import type { DisplayScenario } from "@footprint/contracts";
import { formatInteger } from "@footprint/ui/formatters";
import { ApiClient, queryString } from "../api";
import { PageTitle } from "../components";
import { Card, PeriodMenu, ScenarioMenu, Skeleton, SourceNote, StateCard, UpdatingNote } from "./controls";
import {
  SITE_LABELS,
  SITE_ORDER,
  adminFigures,
  baseText,
  baseValue,
  dashAxis,
  dashWindow,
  modelName,
  peopleOf,
  periodQuery,
  type AdminSummary,
  type DashWindow,
  type UsageFigures,
} from "./figures";
import { DayBars, ServerProblem, useTimezone } from "./AdminOverview";
import { cachedSince, useAdminView, useFigures } from "./state";

/** The organization's activity for a period: the admin summary with its day and model splits. */
export function useActivity(api: ApiClient, window: { startDate?: string; endDate?: string } | null) {
  const path = window ? "/v1/admin/activity" + queryString(periodQuery(window)) : null;
  return useFigures<AdminSummary>(api, path, () => api.get<AdminSummary>(path!));
}

const COLUMNS = ["requests", "energy", "carbon", "water"] as const;
type Column = (typeof COLUMNS)[number];

/**
 * One table row: a model, or what a tool's models leave (`rest`). People is null for the rest,
 * since the server counts people per tool and per model but not for the requests no model was
 * named for.
 */
type ActivityRow = {
  id: string;
  site: string;
  rest: boolean;
  requestsText: string;
  values: Record<Column, number | null>;
  people: number | null;
};

function valuesOf(figures: UsageFigures): Record<Column, number | null> {
  return Object.fromEntries(COLUMNS.map((column) => [column, baseValue(figures, column)])) as Record<Column, number | null>;
}

/**
 * The models, plus for each tool what its models leave: requests no model was named for (often
 * all of Perplexity's) and saved messages without a model. Without that row the table fell short
 * of the page's total (QA of 19 October 2026). It is the same rest the Tools and models page shows.
 */
export function activityRows(summary: AdminSummary, scenario: DisplayScenario): ActivityRow[] {
  const models: ActivityRow[] = Object.entries(summary.models ?? {}).flatMap(([id, part]) => {
    const figures = adminFigures(part, scenario);
    return figures
      ? [{ id, site: part.site ?? "", rest: false, requestsText: figures.requestsText, values: valuesOf(figures), people: peopleOf(part) }]
      : [];
  });
  const rests = SITE_ORDER.flatMap((site): ActivityRow[] => {
    const figures = adminFigures(summary.sites?.[site], scenario);
    if (!figures) return [];
    const own = models.filter((row) => row.site === site);
    const total = valuesOf(figures);
    const values = Object.fromEntries(
      COLUMNS.map((column) => {
        const whole = total[column];
        return [column, whole === null ? null : Math.max(0, whole - own.reduce((sum, row) => sum + (row.values[column] ?? 0), 0))];
      }),
    ) as Record<Column, number | null>;
    // Only requests decide the row. A model whose own estimate is unknown leaves its tool's
    // electricity here too, and a row of zero requests with that electricity would misname it.
    const shown = (values.requests ?? 0) >= 1;
    return shown ? [{ id: `${site} rest`, site, rest: true, requestsText: baseText("requests", values.requests), values, people: null }] : [];
  });
  return [...models, ...rests].sort((a, b) => (b.values.requests ?? 0) - (a.values.requests ?? 0));
}

/**
 * The Activity page (approved canvas RequestsNew; owner decision of 18 October 2026 replaced the
 * per-person request list): the whole organization's requests per day, and its use of each tool and
 * model with how many people used it, as a count only. No person or email appears, and the server
 * sends none. Figures come from the same summary as the Overview, so they match it.
 */
export function AdminActivity({ api }: { api: ApiClient }) {
  const view = useAdminView();
  const config = useTimezone(api);
  const [now] = useState(() => new Date());
  const timezone = config.data?.timezone;
  const window = timezone ? dashWindow(view.period, timezone, now) : null;
  const activity = useActivity(api, window);
  const error = config.error ?? activity.error;
  const updating = error ? null : cachedSince(activity);
  const figures = adminFigures(activity.data, view.scenario);
  const actions = (
    <>
      {timezone && <PeriodMenu timezone={timezone} now={now} />}
      <ScenarioMenu />
    </>
  );
  return (
    <>
      <PageTitle title="Activity" actions={actions}>
        {updating !== null ? <UpdatingNote since={updating} /> : "The whole organization by day, tool and model. No person or email appears on this page."}
      </PageTitle>
      {error ? (
        <ServerProblem error={error} onRetry={() => (config.error ? config.retry() : activity.retry())} />
      ) : !activity.data || !window ? (
        <Skeleton label="Loading activity" />
      ) : !figures ? (
        <StateCard icon="refresh" tone="info" title="Figures are being rebuilt">
          <p>{activity.data.safe_message ?? "Check again in a few minutes."}</p>
        </StateCard>
      ) : (
        <>
          <RequestsPerDay summary={activity.data} figures={figures} window={window} scenario={view.scenario} />
          <ByModel summary={activity.data} scenario={view.scenario} phrase={window.phrase} />
          <SourceNote>
            People are counted, never named. A tool or model used by one person still shows, so in a very small organization a
            row can describe one person's usage. A tool's row for earlier messages and other models has no count of people.
          </SourceNote>
        </>
      )}
    </>
  );
}

function RequestsPerDay({
  summary,
  figures,
  window,
  scenario,
}: {
  summary: AdminSummary;
  figures: UsageFigures;
  window: DashWindow;
  scenario: DisplayScenario;
}) {
  const daily = summary.days && window.bucket === "day" && window.keys.length > 1;
  return (
    <Card title="Requests per day" aside={<span className="ad-soft">{`${window.label} · ${figures.requestsText} requests`}</span>}>
      {daily ? (
        <DayBars
          keys={window.keys}
          axis={dashAxis(window)}
          values={window.keys.map((key) => {
            const part = adminFigures(summary.days![key], scenario);
            return part ? baseValue(part, "requests") : 0;
          })}
          metric="requests"
          label="Requests each day"
          tone="light"
        />
      ) : (
        <p className="ad-soft">Choose a period of 2 to 62 days to see the requests of each day.</p>
      )}
    </Card>
  );
}

function ByModel({ summary, scenario, phrase }: { summary: AdminSummary; scenario: DisplayScenario; phrase: string }) {
  const rows = activityRows(summary, scenario);
  return (
    <Card title="By tool and model" className="ad-card-table" aside={<span className="ad-soft">{phrase}</span>}>
      {rows.length ? (
        <div className="ad-table-scroll">
          <table className="ad-table ad-table-stacked">
            <thead>
              <tr>
                <th>Tool and model</th>
                <th className="num">Requests</th>
                <th className="num">People</th>
                <th className="num">Electricity</th>
                <th className="num">Carbon</th>
                <th className="num">Water</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row">
                    <span className="ad-model-cell">
                      <i className={`ad-dot ad-tool-${row.site || "other"}`} aria-hidden="true" />
                      <span>
                        {row.rest ? "Earlier messages and other models" : modelName(row.id)}
                        <small>{SITE_LABELS[row.site] ?? "Tool not known"}</small>
                      </span>
                    </span>
                  </th>
                  <td className="num" data-label="Requests">
                    <b>{row.requestsText}</b>
                  </td>
                  <td className="num" data-label="People">{row.rest ? <span className="ad-soft">Not counted</span> : row.people === null ? "None" : formatInteger(row.people)}</td>
                  <td className="num" data-label="Electricity">{baseText("energy", row.values.energy)}</td>
                  <td className="num" data-label="Carbon">{baseText("carbon", row.values.carbon)}</td>
                  <td className="num" data-label="Water">{baseText("water", row.values.water)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="ad-soft ad-pad">No model was recorded in this period.</p>
      )}
    </Card>
  );
}
