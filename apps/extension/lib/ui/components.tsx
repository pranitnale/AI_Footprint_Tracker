import { useId, type ReactNode } from "react";
import type { DisplayScenario } from "@footprint/contracts";
import { metricParts } from "@footprint/ui/formatters";
import { Icon, PUBLIC_WEBSITE, type IconName } from "@footprint/ui/icons";
import type { Figure, UsageFigures } from "./usage-figures";

export const SITE_LABELS: Record<string, string> = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  notebooklm: "NotebookLM",
  gemini: "Gemini",
};
/** Fixed order so the Fern ramp always gives the same tool the same shade. */
export const SITE_ORDER = ["claude", "chatgpt", "perplexity", "notebooklm", "gemini"] as const;

export const SCENARIO_NAMES: Record<DisplayScenario, string> = {
  minimum: "Minimum",
  midpoint: "Midpoint",
  maximum: "Maximum",
};
const SCENARIO_HINTS: Record<DisplayScenario, string> = {
  minimum: "This is the Minimum EcoLogits scenario, the low end of each range. You can change it in Settings on the dashboard.",
  midpoint: "This is the Midpoint EcoLogits scenario, halfway between the low and the high end of each range. You can change it in Settings on the dashboard.",
  maximum: "This is the Maximum EcoLogits scenario, the high end of each range. You can change it in Settings on the dashboard.",
};

export type Resource = "energy" | "carbon" | "water";
export const RESOURCE_LABELS: Record<Resource, string> = { energy: "Electricity", carbon: "Carbon", water: "Water" };
export const RESOURCE_ICONS: Record<Resource, IconName> = { energy: "bolt", carbon: "cloud", water: "drop" };

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  tone = "light",
  disabled = false,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  tone?: "light" | "hero";
  /** Shown but not clickable, for example while the figures it chooses are updating. */
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className={`lg-seg lg-seg-${tone}`} aria-disabled={disabled || undefined}>
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={option.value === value} disabled={disabled} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** The scenario label: never clickable; hover or keyboard focus explains it (owner rule, 8 Oct 2026). */
export function ScenarioChip({ scenario, tone = "light" }: { scenario: DisplayScenario; tone?: "light" | "hero" }) {
  const id = useId();
  return (
    <span className={`lg-scw lg-scw-${tone}`}>
      <span className="lg-scenario" tabIndex={0} aria-describedby={id}>
        <span className="lg-scenario-dot" aria-hidden="true" />
        {SCENARIO_NAMES[scenario]}
      </span>
      <span className="lg-tip" role="tooltip" id={id}>
        {SCENARIO_HINTS[scenario]}
      </span>
    </span>
  );
}

/** Number and unit of a figure for large layouts. Unknown stays a word, never zero. */
export function FigureParts({ figure, short = false }: { figure: Figure; short?: boolean }) {
  const parts = metricParts(figure.value, figure.unit);
  if (!parts) return <span className="lg-unknown">{figure.multiple ? "See Details" : "Unknown"}</span>;
  return (
    <>
      <span className="lg-figure-num lg-num">{parts.number}</span> <span className="lg-figure-unit">{short ? shortUnit(parts.unit) : parts.unit}</span>
    </>
  );
}

/** Tiles drop the gas name where space is tight: "400 g" means grams of CO₂e there. */
export function shortUnit(unit: string) {
  return unit.replace(" CO₂e", "").replace(" CO₂", "");
}

export function figureText(figure: Figure, short = false) {
  const parts = metricParts(figure.value, figure.unit);
  if (!parts) return figure.multiple ? "See Details" : "Unknown";
  return `${parts.number} ${short ? shortUnit(parts.unit) : parts.unit}`;
}

export function ResourceTiles({
  figures,
  selected,
  onSelect,
  label = "Choose the figure shown above",
}: {
  figures: UsageFigures;
  selected?: Resource;
  onSelect?: (resource: Resource) => void;
  label?: string;
}) {
  const resources: Resource[] = ["energy", "carbon", "water"];
  return (
    <div className="lg-tiles" role={onSelect ? "group" : undefined} aria-label={onSelect ? label : undefined}>
      {resources.map((resource) => {
        const content = (
          <>
            <span className={`lg-tile-label lg-ink-${resource}`}>
              <span className={`lg-dot lg-dot-${resource}`} aria-hidden="true" />
              {RESOURCE_LABELS[resource]}
            </span>
            <span className="lg-tile-value lg-display lg-num">{figureText(figures[resource], true)}</span>
          </>
        );
        return onSelect ? (
          <button key={resource} type="button" className="lg-tile" aria-pressed={selected === resource} onClick={() => onSelect(resource)}>
            {content}
          </button>
        ) : (
          <div key={resource} className="lg-tile">
            {content}
          </div>
        );
      })}
    </div>
  );
}

export function Bars({
  values,
  highlight,
  label,
  height = 64,
  onPick,
  pickLabels,
  future,
}: {
  values: (number | null)[];
  highlight?: number;
  /** Index of the first bucket that has not happened yet (later hours of today); those bars are drawn faintly. */
  future?: number;
  label: string;
  height?: number;
  onPick?: (index: number) => void;
  pickLabels?: string[];
}) {
  const max = Math.max(0, ...values.map((v) => v ?? 0)) || 1;
  return (
    <div className="lg-bars" role={onPick ? "group" : "img"} aria-label={label} style={{ height }}>
      {values.map((value, index) => {
        const h = Math.max(2, Math.round(((value ?? 0) / max) * height));
        const opacity = index === highlight ? 1 : future !== undefined && index >= future ? 0.15 : value ? 0.55 : 0.3;
        const style = { height: h, opacity };
        return onPick ? (
          <button
            key={index}
            type="button"
            className="lg-bar"
            style={style}
            aria-label={pickLabels?.[index]}
            aria-pressed={index === highlight}
            onClick={() => onPick(index)}
          />
        ) : (
          <span key={index} className="lg-bar" style={style} />
        );
      })}
    </div>
  );
}

export type ToolShareItem = { site: string; pct: number };

export function ToolShare({ items, label = "Share of electricity by tool" }: { items: ToolShareItem[]; label?: string }) {
  const shown = items.filter((item) => item.pct > 0);
  if (!shown.length) return null;
  return (
    <>
      <div className="lg-share" role="img" aria-label={`${label}: ${shown.map((i) => `${SITE_LABELS[i.site] ?? i.site} ${i.pct}%`).join(", ")}`}>
        {shown.map((item) => (
          <span key={item.site} style={{ width: `${item.pct}%`, background: `var(--lg-tool-${item.site})` }} />
        ))}
      </div>
      <div className="lg-share-legend" aria-hidden="true">
        {shown.map((item) => (
          <span key={item.site}>
            <span className="lg-swatch" style={{ background: `var(--lg-tool-${item.site})` }} />
            {SITE_LABELS[item.site] ?? item.site} <span className="lg-soft lg-num">{item.pct}%</span>
          </span>
        ))}
      </div>
    </>
  );
}

/** Rounds shares to whole percents that still add up to 100 (largest remainder). */
export function shares(values: Record<string, number>): ToolShareItem[] {
  const total = Object.values(values).reduce((a, b) => a + b, 0);
  if (!(total > 0)) return [];
  const raw = SITE_ORDER.filter((site) => (values[site] ?? 0) > 0).map((site) => ({ site, exact: ((values[site] ?? 0) / total) * 100 }));
  const floored = raw.map((r) => ({ site: r.site, pct: Math.floor(r.exact), rest: r.exact - Math.floor(r.exact) }));
  let missing = 100 - floored.reduce((a, b) => a + b.pct, 0);
  for (const item of [...floored].sort((a, b) => b.rest - a.rest)) {
    if (missing <= 0) break;
    item.pct++;
    missing--;
  }
  return floored.map(({ site, pct }) => ({ site, pct }));
}

/** The website pages the agreement screens link to. */
export const OPEN_SOURCE_PAGE = `${PUBLIC_WEBSITE}/open-source`;
export const PRIVACY_POLICY_PAGE = `${PUBLIC_WEBSITE}/privacy-policy`;

/**
 * "Everything runs on your computer", the most prominent message of the agreement screens, the
 * dashboard and Settings (owner decision of 17 October 2026): a faint green box with a visible
 * green border around its title and text (`.lg-local` in living-gauge.css).
 */
export function LocalCard({
  title,
  text,
  badges,
  readCode,
  readMethodology = false,
  heading = "h2",
  layout = "stack",
  id,
}: {
  title: string;
  text: string;
  badges?: readonly string[];
  /** "link" puts Read the code under the text; "button" beside it, as on the dashboard. */
  readCode?: "link" | "button";
  /** The dashboard Overview links to the methodology page instead of the code (owner, 21 Oct 2026). */
  readMethodology?: boolean;
  heading?: "h1" | "h2" | "h3";
  layout?: "stack" | "row";
  id?: string;
}) {
  const Heading = heading;
  const className = readCode === "button" ? "lg-btn lg-btn-secondary lg-local-code" : "lg-local-link";
  const code =
    readCode &&
    (readMethodology ? (
      <a className={className} href="methodology.html">
        Read the methodology
      </a>
    ) : (
      <a className={className} href={OPEN_SOURCE_PAGE} target="_blank" rel="noopener noreferrer">
        Read the code
      </a>
    ));
  return (
    <section className={`lg-local lg-local-${layout}`} aria-labelledby={id}>
      <div className="lg-local-body">
        <Heading id={id} className="lg-local-title">
          {title}
        </Heading>
        <p className="lg-local-text">{text}</p>
        {badges && badges.length > 0 && (
          <ul className="lg-local-badges" aria-label="About the tracker">
            {badges.map((badge) => (
              <li key={badge}>{badge}</li>
            ))}
          </ul>
        )}
        {readCode === "link" && code}
      </div>
      {readCode === "button" && code}
    </section>
  );
}

export function Credit() {
  return (
    <p className="lg-credit">
      Designed and built by{" "}
      <a href="https://www.linkedin.com/in/pranitnale/" target="_blank" rel="noopener noreferrer">
        Pranit Nale
      </a>
    </p>
  );
}

export function StatusLine({ icon = "check", tone = "ok", children }: { icon?: IconName; tone?: "ok" | "warn" | "muted"; children: ReactNode }) {
  return (
    <span className={`lg-status lg-status-${tone}`}>
      <Icon name={icon} size={16} />
      <span>{children}</span>
    </span>
  );
}

/** "1 min ago" style age for status lines; "just now" under a minute. */
export function ageText(at: number, now: number) {
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(at);
}
