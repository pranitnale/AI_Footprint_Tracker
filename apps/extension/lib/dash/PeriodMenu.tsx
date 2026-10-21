import { useEffect, useId, useRef, useState } from "react";
import { addCalendarDays } from "@footprint/ui/dates";
import { Icon } from "@footprint/ui/icons";
import { addMonths, DASH_PERIOD_LABELS, monthDays, monthName, type DashPeriod } from "../ui/dash-periods";

const OPTIONS = ["today", "7d", "30d", "month", "last-month", "all"] as const;
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/** Period dropdown (canvas MenusSheet): fixed periods plus a two-click custom range on a month calendar. */
export function PeriodMenu({ value, label, today, onChange }: { value: DashPeriod; label: string; today: string; onChange: (p: DashPeriod) => void }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(value.kind === "custom");
  const [month, setMonth] = useState((value.kind === "custom" ? value.from : today).slice(0, 7));
  const [from, setFrom] = useState<string | null>(value.kind === "custom" ? value.from : null);
  const [to, setTo] = useState<string | null>(value.kind === "custom" ? value.to : null);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        root.current?.querySelector<HTMLButtonElement>(".lg-period-btn")?.focus();
      }
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const choose = (kind: (typeof OPTIONS)[number]) => {
    onChange({ kind });
    setCustom(false);
    setOpen(false);
  };
  const pick = (day: string) => {
    if (!from || to) {
      setFrom(day);
      setTo(null);
      return;
    }
    const [a, b] = day < from ? [day, from] : [from, day];
    setFrom(a);
    setTo(b);
    onChange({ kind: "custom", from: a, to: b });
    setOpen(false);
  };

  const first = `${month}-01`;
  const lead = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const days = Array.from({ length: monthDays(month) }, (_, i) => addCalendarDays(first, i));
  const inRange = (day: string) => !!from && (to ? day >= from && day <= to : day === from);

  return (
    <div className="lg-period" ref={root}>
      <button type="button" className="lg-btn lg-btn-secondary lg-period-btn" aria-haspopup="true" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen(!open)}>
        <Icon name="calendar" size={16} />
        {label}
        <Icon name={open ? "chevronUp" : "chevronDown"} size={16} />
      </button>
      {open && (
        <div className="lg-period-menu" id={menuId} role="dialog" aria-label="Choose a period">
          <ul role="list">
            {OPTIONS.map((kind) => (
              <li key={kind}>
                <button type="button" className="lg-period-option" aria-pressed={!custom && value.kind === kind} onClick={() => choose(kind)}>
                  {DASH_PERIOD_LABELS[kind]}
                  {!custom && value.kind === kind && <Icon name="check" size={16} />}
                </button>
              </li>
            ))}
            <li>
              <button type="button" className="lg-period-option" aria-pressed={custom} aria-expanded={custom} onClick={() => setCustom(true)}>
                Custom dates
                {custom && <Icon name="check" size={16} />}
              </button>
            </li>
          </ul>
          {custom && (
            <div className="lg-cal">
              <div className="lg-cal-head">
                <button type="button" className="lg-cal-nav" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>
                  <Icon name="chevronLeft" size={16} />
                </button>
                <b aria-live="polite">
                  {monthName(month)} {month.slice(0, 4)}
                </b>
                <button type="button" className="lg-cal-nav" aria-label="Next month" disabled={month >= today.slice(0, 7)} onClick={() => setMonth(addMonths(month, 1))}>
                  <Icon name="chevronRight" size={16} />
                </button>
              </div>
              <p className="lg-cal-hint">{from && !to ? "Now choose the last day." : "Choose the first day."}</p>
              <div className="lg-cal-grid" role="grid" aria-label={`${monthName(month)} ${month.slice(0, 4)}`}>
                {WEEKDAYS.map((d) => (
                  <span key={d} className="lg-cal-wd" aria-hidden="true">
                    {d}
                  </span>
                ))}
                {Array.from({ length: lead }, (_, i) => (
                  <span key={`lead-${i}`} aria-hidden="true" />
                ))}
                {days.map((day) => (
                  <button
                    key={day}
                    type="button"
                    className="lg-cal-day"
                    data-edge={day === from || day === to || undefined}
                    data-in={inRange(day) || undefined}
                    disabled={day > today}
                    aria-pressed={inRange(day)}
                    aria-label={`${Number(day.slice(8))} ${monthName(month)}`}
                    onClick={() => pick(day)}
                  >
                    {Number(day.slice(8))}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
