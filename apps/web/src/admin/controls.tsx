import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { DisplayScenario } from "@footprint/contracts";
import { Status } from "@footprint/ui";
import { Icon, type IconName } from "@footprint/ui/icons";
import { DASH_PERIOD_LABELS, SCENARIO_NAMES, SITE_LABELS, SITE_ORDER, dashWindow, type DashPeriod } from "./figures";
import { setAdminView, useAdminView } from "./state";

export type MenuOption<T extends string> = { value: T; label: string };

/**
 * A chip that opens a short list of choices (canvas AdminOverview header). The list is a menu of
 * radio items: arrow keys move, Enter or Space chooses, Escape and a click outside close it and
 * return focus to the chip.
 */
export function ChipMenu<T extends string>({
  label,
  icon,
  value,
  options,
  onChange,
  name,
  footer,
}: {
  label: string;
  icon?: IconName;
  value: T;
  options: MenuOption<T>[];
  onChange: (value: T) => void;
  /** What the choice is about, for screen readers ("Period"). */
  name: string;
  /** Extra content under the choices, such as custom dates. */
  footer?: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const chip = useRef<HTMLButtonElement>(null),
    list = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = (focus = true) => {
    setOpen(false);
    if (focus) chip.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const items = () => [...(list.current?.querySelectorAll<HTMLElement>("[role=menuitemradio]") ?? [])];
    (items().find((item) => item.getAttribute("aria-checked") === "true") ?? items()[0])?.focus();
    const outside = (event: MouseEvent) => {
      if (!list.current?.contains(event.target as Node) && !chip.current?.contains(event.target as Node)) close(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const all = items();
      const at = all.indexOf(document.activeElement as HTMLElement);
      if (at === -1) return;
      event.preventDefault();
      all[(at + (event.key === "ArrowDown" ? 1 : all.length - 1)) % all.length]?.focus();
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <span className="ad-menu">
      <button
        ref={chip}
        type="button"
        className="ad-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`${name}: ${label}`}
        onClick={() => setOpen((value) => !value)}
      >
        {icon && <Icon name={icon} size={16} />}
        {label}
        <Icon name="chevronDown" size={16} />
      </button>
      {open && (
        <div ref={list} id={id} className="ad-menu-pop" role="menu" aria-label={name}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === value}
              className="ad-menu-item"
              onClick={() => {
                onChange(option.value);
                close();
              }}
            >
              <span>{option.label}</span>
              {option.value === value && <Icon name="check" size={16} />}
            </button>
          ))}
          {footer?.(() => close())}
        </div>
      )}
    </span>
  );
}

const PERIODS = ["today", "7d", "30d", "month", "last-month", "all"] as const;

/** The period chip, with the dashboard's periods and custom dates. */
export function PeriodMenu({ timezone, now = new Date(), allTime = true }: { timezone: string; now?: Date; allTime?: boolean }) {
  const { period } = useAdminView();
  const window = dashWindow(period, timezone, now);
  const [from, setFrom] = useState(period.kind === "custom" ? period.from : "");
  const [to, setTo] = useState(period.kind === "custom" ? period.to : "");
  const value = period.kind === "custom" ? "custom" : period.kind;
  return (
    <ChipMenu<string>
      name="Period"
      icon="calendar"
      label={window.label}
      value={value}
      options={PERIODS.filter((kind) => allTime || kind !== "all").map((kind) => ({ value: kind, label: DASH_PERIOD_LABELS[kind] }))}
      onChange={(kind) => setAdminView({ period: { kind } as DashPeriod })}
      footer={(close) => (
        <form
          className="ad-menu-custom"
          onSubmit={(event) => {
            event.preventDefault();
            if (!from || !to) return;
            setAdminView({ period: { kind: "custom", from, to } });
            close();
          }}
        >
          <span className="ad-menu-head">Custom dates</span>
          <label>
            From
            <input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} required />
          </label>
          <label>
            To
            <input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} required />
          </label>
          <button type="submit" className="ad-btn ad-btn-sm">
            Show these dates
          </button>
        </form>
      )}
    />
  );
}

/** The tool chip: all tools, or one. */
export function ToolMenu() {
  const { site } = useAdminView();
  return (
    <ChipMenu<string>
      name="Tool"
      label={site ? SITE_LABELS[site]! : "All tools"}
      value={site}
      options={[{ value: "", label: "All tools" }, ...SITE_ORDER.map((key) => ({ value: key, label: SITE_LABELS[key]! }))]}
      onChange={(next) => setAdminView({ site: next })}
    />
  );
}

const SCENARIO_HINTS: Record<DisplayScenario, string> = {
  minimum: "The Minimum EcoLogits scenario, the low end of each range.",
  midpoint: "The Midpoint EcoLogits scenario, halfway between the low and the high end of each range.",
  maximum: "The Maximum EcoLogits scenario, the high end of each range.",
};

/** The scenario chip. Figures in every admin page follow it, as the extension's figures follow its setting. */
export function ScenarioMenu() {
  const { scenario } = useAdminView();
  return (
    <ChipMenu<DisplayScenario>
      name="EcoLogits scenario"
      label={SCENARIO_NAMES[scenario]}
      value={scenario}
      options={(["minimum", "midpoint", "maximum"] as const).map((value) => ({ value, label: SCENARIO_NAMES[value] }))}
      onChange={(next) => setAdminView({ scenario: next })}
      footer={() => <p className="ad-menu-note">{SCENARIO_HINTS[scenario]} Exports carry all three.</p>}
    />
  );
}

/** A white card with an optional heading row (canvas card: 20 px corners, hairline border). */
export function Card({
  title,
  aside,
  children,
  className = "",
  id,
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  const heading = useId();
  return (
    <section className={`ad-card ${className}`} aria-labelledby={title ? heading : undefined} id={id}>
      {(title || aside) && (
        <div className="ad-card-head">
          {title && (
            <h2 id={heading} className="ad-h2">
              {title}
            </h2>
          )}
          {aside && <div className="ad-card-aside">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Placeholder blocks in the page's shape while figures load (canvas AdminStates, Loading). */
export function Skeleton({ label = "Loading organization figures" }: { label?: string }) {
  return (
    <div className="ad-skeleton" role="status">
      <div className="ad-skel-row">
        <span />
        <span />
        <span />
      </div>
      <span className="ad-skel-block" />
      <p>{label}</p>
    </div>
  );
}

/** A state card in the main area (canvas AdminStates): no usage yet, could not load. */
export function StateCard({
  icon,
  tone = "good",
  title,
  children,
  actions,
}: {
  icon: IconName;
  tone?: "good" | "danger" | "info";
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="ad-card ad-state" role={tone === "danger" ? "alert" : "status"}>
      <span className={`ad-state-icon ad-tone-${tone}`} aria-hidden="true">
        <Icon name={icon} size={26} />
      </span>
      <h2 className="ad-h2">{title}</h2>
      <div className="ad-state-text">{children}</div>
      {actions && <div className="ad-actions">{actions}</div>}
    </section>
  );
}

export function SourceNote({ children }: { children: ReactNode }) {
  return <p className="ad-foot-note">{children}</p>;
}

/**
 * Says that the figures below were read earlier in this session and are being read again, so they
 * are not taken for the latest answer. `since` is when they were read (ms), from cachedSince.
 */
export function UpdatingNote({ since }: { since: number }) {
  const time = new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(since);
  return (
    <span role="status">
      <Status>Updating figures read at {time}</Status>
    </span>
  );
}
