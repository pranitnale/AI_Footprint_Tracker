import { useId, useState } from "react";
import { baseText, type Metric } from "../ui/figure-math";

/** A round axis step (1, 2 or 5 times a power of ten) giving about two gridlines under the tallest bar. */
export function niceStep(max: number) {
  if (!(max > 0)) return 0;
  const raw = max / 2;
  const power = 10 ** Math.floor(Math.log10(raw));
  const f = raw / power;
  return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * power;
}

export type BarPoint = { key: string; value: number | null; label: string; detail?: string };

/**
 * The large daily chart on the hero (canvas DashOverview). Hovering or focusing a bar shows its day,
 * figure and requests; the chart is a list of buttons so keyboard and screen reader users get the same.
 */
export function HeroBars({ points, metric, highlight, height = 196, axis, onPick }: { points: BarPoint[]; metric: Metric; highlight?: number; height?: number; axis: string[]; onPick?: (index: number) => void }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(0, ...points.map((p) => p.value ?? 0));
  const step = niceStep(max);
  const top = step ? Math.max(max, step * 2) : 1;
  const ticks = step ? [step * 2, step].filter((t) => t <= top) : [];
  const shown = active ?? null;
  return (
    <div className="dh-chart">
      <div className="dh-chart-plot" style={{ height }}>
        {ticks.map((t) => (
          <span key={t} className="dh-tick" style={{ bottom: `${(t / top) * 100}%` }}>
            <span>{baseText(metric, t, 2)}</span>
          </span>
        ))}
        <ol className="dh-bars" aria-label="Each day in the period">
          {points.map((p, i) => {
            const h = p.value ? Math.max(2, (p.value / top) * 100) : 0;
            return (
              <li key={p.key} className="dh-bar-slot">
                <button
                  type="button"
                  className="dh-bar"
                  data-on={i === highlight || i === active || undefined}
                  style={{ height: `${h}%` }}
                  aria-label={`${p.label}: ${p.value === null ? "unknown" : baseText(metric, p.value)}${p.detail ? `, ${p.detail}` : ""}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  onClick={() => onPick?.(i)}
                />
                {shown === i && (
                  <span className="dh-bar-tip" role="tooltip" style={{ bottom: `calc(${h}% + 10px)` }}>
                    <b>{p.label}</b> · {p.value === null ? "Unknown" : baseText(metric, p.value)}
                    {p.detail ? ` · ${p.detail}` : ""}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
      <div className="dh-axis" aria-hidden="true">
        {axis.map((a, i) => (
          <span key={`${a}-${i}`}>{a}</span>
        ))}
      </div>
    </div>
  );
}

/** Ring split by tool (canvas "Where it comes from"), with a hairline gap between segments. */
export function Donut({ parts, size = 168, stroke = 26, center, sub }: { parts: { key: string; value: number; color: string }[]; size?: number; stroke?: number; center: string; sub: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let at = 0;
  return (
    <div className="dh-donut" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--lg-track)" strokeWidth={stroke} />
        {total > 0 &&
          parts.map((p) => {
            const length = (p.value / total) * c;
            const gap = parts.length > 1 ? Math.min(2, length / 2) : 0;
            const el = (
              <circle
                key={p.key}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={p.color}
                strokeWidth={stroke}
                strokeDasharray={`${Math.max(0, length - gap)} ${c}`}
                strokeDashoffset={-at}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            );
            at += length;
            return el;
          })}
      </svg>
      <span className="dh-donut-center">
        <b className="lg-display">{center}</b>
        <span>{sub}</span>
      </span>
    </div>
  );
}

/**
 * Month so far (canvas "October so far"): this month's running total, the month before as a light
 * line, and a dashed line continuing this month at its current daily pace to the month's end.
 */
export function PaceChart({ current, previous, daysInMonth, label, previousLabel }: { current: number[]; previous: number[]; daysInMonth: number; label: string; previousLabel: string }) {
  const id = useId();
  const sum = (values: number[]) => values.reduce<number[]>((acc, v) => [...acc, (acc.at(-1) ?? 0) + v], []);
  const cur = sum(current);
  const prev = sum(previous);
  const pace = cur.length ? (cur.at(-1)! / cur.length) * daysInMonth : 0;
  const max = Math.max(1, pace, ...prev, ...cur);
  const W = 500;
  const H = 180;
  const x = (day: number) => (day / Math.max(1, daysInMonth - 1)) * W;
  const y = (v: number) => H - (v / max) * (H - 10);
  const line = (values: number[]) => values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = cur.length - 1;
  return (
    <figure className="dh-pace" aria-labelledby={id}>
      <svg viewBox={`-6 -6 ${W + 12} ${H + 12}`} preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" y1={H} x2={W} y2={H} className="dh-pace-base" />
        {prev.length > 1 && <path d={line(prev)} className="dh-pace-prev" />}
        {cur.length > 0 && <path d={`M${x(last).toFixed(1)},${y(cur[last]!).toFixed(1)} L${x(daysInMonth - 1).toFixed(1)},${y(pace).toFixed(1)}`} className="dh-pace-proj" />}
        {cur.length > 1 && <path d={line(cur)} className="dh-pace-cur" />}
        {cur.length > 0 && <circle cx={x(daysInMonth - 1)} cy={y(pace)} r="5" className="dh-pace-end" />}
      </svg>
      <div className="dh-axis" aria-hidden="true">
        {["1st", "8th", "15th", "22nd", `${daysInMonth}${daysInMonth === 31 ? "st" : "th"}`].map((a) => (
          <span key={a}>{a}</span>
        ))}
      </div>
      <figcaption id={id} className="dh-legend">
        <span>
          <i className="dh-key dh-key-cur" />
          {label}
        </span>
        <span>
          <i className="dh-key dh-key-proj" />
          At this pace
        </span>
        <span>
          <i className="dh-key dh-key-prev" />
          {previousLabel}
        </span>
      </figcaption>
    </figure>
  );
}
