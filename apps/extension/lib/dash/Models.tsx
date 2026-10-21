import type { DisplayScenario } from "@footprint/contracts";
import { formatInteger } from "@footprint/ui/formatters";
import type { UsageBreakdownView } from "../dashboard/types";
import { SITE_LABELS, SITE_ORDER } from "../ui/components";
import { dashWindow } from "../ui/dash-periods";
import { baseText, baseValue, modelSite, requestsPhrase, partFigures, partKeys, totalFigures } from "../ui/figure-math";
import { modelName } from "../ui/model-names";
import type { UsageFigures } from "../ui/usage-figures";
import { useBreakdown } from "./Overview";
import { OrgUnavailable, orgFigures, orgUnused, useServerSummary, type OrgSummary } from "./OrgOverview";
import type { PageContext } from "./Dashboard";
import { estimationKind, type Kind } from "./model-estimation";

type ModelRow = { id: string; site: string | null; figures: UsageFigures; kind: Kind };

function rows(view: UsageBreakdownView, scenario: DisplayScenario): ModelRow[] {
  return partKeys(view, "models")
    .flatMap((id) => {
      const figures = partFigures(view, "models", id, scenario);
      return figures && figures.requests ? [{ id, site: modelSite(view, id), figures, kind: estimationKind(view, id) }] : [];
    })
    .sort((a, b) => (baseValue(b.figures, "energy") ?? 0) - (baseValue(a.figures, "energy") ?? 0));
}

const req = (f: UsageFigures) => Number(f.requests ?? 0n);
const tokens = (v: bigint | null) => (v === null ? "Not available" : Number(v) >= 1_000_000 ? `${(Number(v) / 1_000_000).toFixed(2)} M` : Number(v) >= 1_000 ? `${Math.round(Number(v) / 1_000)} k` : formatInteger(v));

export function Models({ ctx, org = false }: { ctx: PageContext; org?: boolean }) {
  const window = dashWindow(ctx.period, ctx.dashboard.settings.timezone, ctx.now);
  const mine = useBreakdown(ctx, window);
  const company = useServerSummary(ctx, "company", org ? window : null);
  const scenario = ctx.dashboard.settings.displayScenario;
  if (org) return <OrgModels ctx={ctx} summary={company.data} error={company.error} retry={company.retry} mine={mine.data} phrase={window.phrase} />;
  if (!mine.data)
    return mine.error ? (
      <div className="dh-card dh-loading" role="alert">
        <p>Your figures could not be loaded.</p>
        <button type="button" className="lg-btn lg-btn-secondary" onClick={mine.retry}>
          Try again
        </button>
      </div>
    ) : (
      <div className="dh-loading" role="status">
        Loading your tools and models
      </div>
    );
  const view = mine.data;
  const total = totalFigures(view, scenario);
  const models = rows(view, scenario);
  const sites = SITE_ORDER.flatMap((site) => {
    const f = partFigures(view, "sites", site, scenario);
    return f && f.requests ? [{ site, figures: f, models: models.filter((m) => m.site === site) }] : [];
  }).sort((a, b) => req(b.figures) - req(a.figures));
  const totalRequests = req(total);
  const maxRequests = Math.max(1, ...sites.map((s) => req(s.figures)));

  // Highlights from the same figures (canvas: "75% of your requests go to Claude and ChatGPT").
  const top2 = sites.slice(0, 2);
  const top2Share = totalRequests ? Math.round((top2.reduce((a, s) => a + req(s.figures), 0) / totalRequests) * 100) : 0;
  const exact = models.filter((m) => m.kind.tone === "own").reduce((a, m) => a + req(m.figures), 0);
  const exactShare = totalRequests ? Math.round((exact / totalRequests) * 100) : 0;
  const perRequest = sites
    .map((s) => ({ site: s.site, wh: (baseValue(s.figures, "energy") ?? 0) / Math.max(1, req(s.figures)) }))
    .filter((s) => s.wh > 0)
    .sort((a, b) => b.wh - a.wh);

  return (
    <>
      <section className="dh-card" aria-labelledby="md-used">
        <div className="md-head">
          <div>
            <h2 id="md-used" className="lg-display">
              Tools and models you used
            </h2>
            <p className="dh-soft">Requests in the {window.phrase}, split by the model that answered</p>
          </div>
          <dl className="md-counts">
            <div>
              <dt>tools</dt>
              <dd className="lg-display">{sites.length}</dd>
            </div>
            <div>
              <dt>models</dt>
              <dd className="lg-display">{models.length}</dd>
            </div>
            <div>
              <dt>requests</dt>
              <dd className="lg-display">{formatInteger(totalRequests)}</dd>
            </div>
          </dl>
        </div>
        <ul className="md-tools">
          {sites.map((s) => {
            const unassigned = req(s.figures) - s.models.reduce((a, m) => a + req(m.figures), 0);
            return (
              <li key={s.site} className="md-tool">
                <span className="md-tool-name">
                  <span className="lg-swatch" style={{ background: `var(--lg-tool-${s.site})` }} />
                  {SITE_LABELS[s.site]}
                </span>
                <div className="md-tool-bars" style={{ width: `${(req(s.figures) / maxRequests) * 100}%` }} aria-hidden="true">
                  {s.models.map((m, i) => (
                    <span
                      key={m.id}
                      className={`md-seg${m.kind.tone === "similar" ? " md-seg-hatch" : ""}`}
                      style={{ flex: req(m.figures), background: `var(--lg-tool-${s.site})`, opacity: i === 0 ? 1 : 0.62 }}
                    >
                      {req(m.figures)}
                    </span>
                  ))}
                  {unassigned > 0 && (
                    <span className="md-seg md-seg-none" style={{ flex: unassigned }}>
                      {unassigned}
                    </span>
                  )}
                </div>
                <span className="md-tool-total">
                  <b className="lg-display lg-num">{s.figures.requestsText}</b>
                  <span className="dh-soft"> · {totalRequests ? Math.round((req(s.figures) / totalRequests) * 100) : 0}%</span>
                </span>
                <p className="md-tool-legend">
                  {s.models.map((m, i) => (
                    <span key={m.id}>
                      <span className="lg-swatch" style={{ background: `var(--lg-tool-${s.site})`, opacity: i === 0 ? 1 : 0.62 }} />
                      {modelName(m.id)} <b className="lg-num">{m.figures.requestsText}</b>
                      {m.kind.tone === "similar" && <span className="dh-soft"> · similar model stands in</span>}
                    </span>
                  ))}
                  {unassigned > 0 && <span className="dh-soft">{formatInteger(unassigned)} without a named model</span>}
                </p>
              </li>
            );
          })}
        </ul>
        {sites.length > 0 && (
          <div className="dh-facts">
            {top2.length === 2 && (
              <div>
                <b className="lg-display">{top2Share}%</b>
                <p>
                  of your requests go to {SITE_LABELS[top2[0]!.site]} and {SITE_LABELS[top2[1]!.site]}.
                </p>
              </div>
            )}
            {models[0] && (
              <div>
                <b className="lg-display">{totalRequests ? Math.round((req(models[0].figures) / totalRequests) * 100) : 0}%</b>
                <p>of your requests use {modelName(models[0].id)}, the model behind the most electricity.</p>
              </div>
            )}
            <div>
              <b className="lg-display">{exactShare}%</b>
              <p>of requests are estimated with the exact model{models.some((m) => m.kind.tone === "similar") ? ". For the rest a similar model stands in." : "."}</p>
            </div>
          </div>
        )}
      </section>

      <section className="dh-card" aria-labelledby="md-each">
        <h2 id="md-each" className="lg-display">
          What each tool used
        </h2>
        <p className="dh-soft">Tokens read and written, and the electricity, carbon and water behind them. Bars compare tools within each column.</p>
        <ToolTable sites={sites} total={total} />
        <div className="dh-facts dh-facts-text">
          <div>
            <b>Writing drives the estimate</b>
            <p>EcoLogits estimates from the tokens the AI writes, not what it reads. Long documents you attach add reading but little electricity.</p>
          </div>
          <div>
            <b>Carbon and water follow electricity</b>
            <p>Carbon uses the electricity mix of each provider's data centres. Water also counts the cooling there.</p>
          </div>
          {perRequest.length > 1 && (
            <div>
              <b>Cost per request differs</b>
              <p>
                A {SITE_LABELS[perRequest[0]!.site]} request uses {(perRequest[0]!.wh / perRequest.at(-1)!.wh).toFixed(1)} times the electricity of a {SITE_LABELS[perRequest.at(-1)!.site]} request: {baseText("energy", perRequest[0]!.wh, 2)} against {baseText("energy", perRequest.at(-1)!.wh, 2)}.
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="dh-card" aria-labelledby="md-all">
        <div className="dh-card-head">
          <h2 id="md-all" className="lg-display">
            All models
          </h2>
          <span className="dh-soft">Sorted by electricity</span>
        </div>
        <div className="dh-scroll">
          <table className="dh-table md-models">
            <thead>
              <tr>
                <th scope="col">Model</th>
                <th scope="col">Tool</th>
                <th scope="col" className="num">
                  Requests
                </th>
                <th scope="col" className="num">
                  Tokens out
                </th>
                <th scope="col" className="num">
                  Electricity
                </th>
                <th scope="col" className="num">
                  Carbon
                </th>
                <th scope="col" className="num">
                  Water
                </th>
                <th scope="col" className="num">
                  Per request
                </th>
                <th scope="col">How it is estimated</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => {
                const wh = baseValue(m.figures, "energy");
                return (
                  <tr key={m.id}>
                    <th scope="row">{modelName(m.id)}</th>
                    <td>
                      {m.site ? (
                        <>
                          <span className="lg-swatch" style={{ background: `var(--lg-tool-${m.site})` }} /> {SITE_LABELS[m.site]}
                        </>
                      ) : (
                        "Unknown"
                      )}
                    </td>
                    <td className="num">{m.figures.requestsText}</td>
                    <td className="num">{tokens(m.figures.tokensOut)}</td>
                    <td className="num">
                      <b>{baseText("energy", wh)}</b>
                    </td>
                    <td className="num">{baseText("carbon", baseValue(m.figures, "carbon"))}</td>
                    <td className="num">{baseText("water", baseValue(m.figures, "water"))}</td>
                    <td className="num">{wh !== null && req(m.figures) ? baseText("energy", wh / req(m.figures), 2) : "Not available"}</td>
                    <td>
                      <span className={`md-kind md-kind-${m.kind.tone}`} title={m.kind.detail}>
                        {m.kind.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="md-kinds">
        <div className="dh-card">
          <span className="md-kind md-kind-own">Own record</span>
          <b>The exact model is known</b>
          <p className="dh-soft">EcoLogits has a record for the model that answered, so its own size and speed are used.</p>
        </div>
        <div className="dh-card">
          <span className="md-kind md-kind-similar">Similar model</span>
          <b>No record yet</b>
          <p className="dh-soft">The closest model of the same family stands in. The larger one is used when two fit.</p>
        </div>
        <div className="dh-card">
          <span className="md-kind md-kind-family">Family estimate</span>
          <b>A brand-new or unnamed model</b>
          <p className="dh-soft">The family's benchmark model is used until a record exists. Details says which.</p>
        </div>
      </div>
    </>
  );
}

function ToolTable({ sites, total }: { sites: { site: string; figures: UsageFigures }[]; total: UsageFigures }) {
  const allCols = [
    { key: "in", label: "Tokens read", value: (f: UsageFigures) => (f.tokensIn === null ? null : Number(f.tokensIn)), text: (f: UsageFigures) => tokens(f.tokensIn), color: "var(--lg-tool-notebooklm)" },
    { key: "out", label: "Tokens written", value: (f: UsageFigures) => (f.tokensOut === null ? null : Number(f.tokensOut)), text: (f: UsageFigures) => tokens(f.tokensOut), color: "var(--lg-fern)" },
    { key: "energy", label: "Electricity", value: (f: UsageFigures) => baseValue(f, "energy"), text: (f: UsageFigures) => baseText("energy", baseValue(f, "energy")), color: "var(--lg-energy)" },
    { key: "carbon", label: "Carbon", value: (f: UsageFigures) => baseValue(f, "carbon"), text: (f: UsageFigures) => baseText("carbon", baseValue(f, "carbon")), color: "var(--lg-carbon)" },
    { key: "water", label: "Water", value: (f: UsageFigures) => baseValue(f, "water"), text: (f: UsageFigures) => baseText("water", baseValue(f, "water")), color: "var(--lg-water)" },
    {
      key: "per",
      label: "Per request",
      value: (f: UsageFigures) => {
        const wh = baseValue(f, "energy");
        return wh !== null && f.requests ? wh / Number(f.requests) : null;
      },
      text: (f: UsageFigures) => {
        const wh = baseValue(f, "energy");
        return wh !== null && f.requests ? baseText("energy", wh / Number(f.requests), 2) : "Not available";
      },
      color: "var(--lg-tool-perplexity)",
    },
  ];
  // A column no tool has a figure for (organization summaries without token rows) is left out, not filled with "Not available".
  const cols = allCols.filter((c) => sites.some((s) => c.value(s.figures) !== null));
  const max = Object.fromEntries(cols.map((c) => [c.key, Math.max(0, ...sites.map((s) => c.value(s.figures) ?? 0))]));
  return (
    <div className="dh-scroll">
      <table className="dh-table md-each">
        <thead>
          <tr>
            <th scope="col">Tool</th>
            {cols.map((c) => (
              <th key={c.key} scope="col">
                <span className="lg-swatch" style={{ background: c.color }} /> {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sites.map((s) => (
            <tr key={s.site}>
              <th scope="row">
                <span className="lg-swatch" style={{ background: `var(--lg-tool-${s.site})` }} /> {SITE_LABELS[s.site]}
                <small className="dh-soft">{requestsPhrase(s.figures.requestsText)}</small>
              </th>
              {cols.map((c) => {
                const v = c.value(s.figures);
                return (
                  <td key={c.key}>
                    <span className={c.key === "energy" ? "md-strong" : undefined}>{c.text(s.figures)}</span>
                    <span className="md-track" aria-hidden="true">
                      <span style={{ width: `${v && max[c.key] ? (v / max[c.key]!) * 100 : 0}%`, background: c.color }} />
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
          <tr className="md-total">
            <th scope="row">All tools</th>
            {cols.map((c) => (
              <td key={c.key}>
                <b>{c.text(total)}</b>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function OrgModels({ ctx, summary, error, retry, mine, phrase }: { ctx: PageContext; summary: OrgSummary | null; error: string | null; retry: () => void; mine: UsageBreakdownView | null; phrase: string }) {
  const scenario = ctx.dashboard.settings.displayScenario;
  if (!summary)
    return error ? (
      <OrgUnavailable summary={null} onRetry={retry} />
    ) : (
      <div className="dh-loading" role="status">
        Loading organization figures
      </div>
    );
  if (summary.suppressed || summary.aggregate_status !== "current") return <OrgUnavailable summary={summary} onRetry={retry} />;
  if (orgUnused(summary, orgFigures(summary, scenario)!)) return <OrgUnavailable summary={summary} onRetry={retry} empty />;
  const sites = SITE_ORDER.flatMap((site) => {
    const f = orgFigures(summary.sites?.[site], scenario);
    return f && f.requests ? [{ site, figures: f, mine: mine ? partFigures(mine, "sites", site, scenario) : null }] : [];
  }).sort((a, b) => req(b.figures) - req(a.figures));
  const models = Object.entries(summary.models ?? {})
    .map(([id, s]) => ({ id, site: s.site ?? null, figures: orgFigures(s, scenario)!, mine: mine ? partFigures(mine, "models", id, scenario) : null }))
    .filter((m) => m.figures.requests)
    .sort((a, b) => (baseValue(b.figures, "energy") ?? 0) - (baseValue(a.figures, "energy") ?? 0));
  const total = orgFigures(summary, scenario)!;
  if (!sites.length)
    return (
      <section className="dh-card dh-unavailable" role="status">
        <div>
          <b>The organization server has not shared a split by tool for this period.</b>
          <p className="dh-soft">The organization total is on the Overview. Your own tools and models are under Me.</p>
        </div>
      </section>
    );
  return (
    <>
      <section className="dh-card" aria-labelledby="mo-tools">
        <h2 id="mo-tools" className="lg-display">
          Tools used across the organization
        </h2>
        <p className="dh-soft">
          Requests in the {phrase}, with your own count beside each. {requestsPhrase(total.requestsText)} in all.
        </p>
        <ToolTable sites={sites} total={total} />
        <ul className="mo-mine">
          {sites.map((s) => (
            <li key={s.site}>
              {SITE_LABELS[s.site]}: you <b>{s.mine?.requestsText ?? "0"}</b> of {s.figures.requestsText}
            </li>
          ))}
        </ul>
      </section>
      {models.length > 0 && (
        <section className="dh-card" aria-labelledby="mo-models">
          <h2 id="mo-models" className="lg-display">
            All models
          </h2>
          <div className="dh-scroll">
            <table className="dh-table md-models">
              <thead>
                <tr>
                  <th scope="col">Model</th>
                  <th scope="col">Tool</th>
                  <th scope="col" className="num">
                    Requests
                  </th>
                  <th scope="col" className="num">
                    Yours
                  </th>
                  <th scope="col" className="num">
                    Electricity
                  </th>
                  <th scope="col" className="num">
                    Per request
                  </th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => {
                  const wh = baseValue(m.figures, "energy");
                  return (
                    <tr key={m.id}>
                      <th scope="row">{modelName(m.id)}</th>
                      <td>{m.site ? SITE_LABELS[m.site] : "Unknown"}</td>
                      <td className="num">{m.figures.requestsText}</td>
                      <td className="num">{m.mine?.requestsText ?? "0"}</td>
                      <td className="num">{baseText("energy", wh)}</td>
                      <td className="num">{wh !== null && req(m.figures) ? baseText("energy", wh / req(m.figures), 2) : "Not available"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
