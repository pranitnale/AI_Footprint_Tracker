import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, LivingGaugeMark } from "@footprint/ui/icons";
import { SCENARIO_NAMES, SITE_LABELS } from "../ui/components";
import { FULL_HISTORY_LABEL, TOUR_SITES } from "./copy";

/**
 * The short tour the welcome page turns into once the person agreed (owner request of 21 October
 * 2026): where the bar and Details are, how to pin the tracker and open the popup, the dashboard
 * and Settings, and what stays private. It stays on the welcome page and ends by closing the tab.
 */

/**
 * A highlight over a screenshot, in percent of the image so it scales with it. `n` is its badge: a
 * number, or a letter where a step already uses numbers for another picture (owner, 21 Oct 2026).
 */
type Mark = { n?: number | string; left: number; top: number; width: number; height: number };

type Shot = { src: string; width: number; height: number };

// Screenshots taken on 21 October 2026 in a fresh, signed-out test profile with neutral test chats,
// re-encoded as WebP. The sizes are the files' own, so the page keeps its layout while they load.
const SHOTS = {
  bar: { src: "/tutorial/bar.webp", width: 816, height: 281 },
  details: { src: "/tutorial/details.webp", width: 492, height: 517 },
  popup: { src: "/tutorial/popup.webp", width: 400, height: 600 },
  dashboard: { src: "/tutorial/dashboard.webp", width: 1280, height: 800 },
  settings: { src: "/tutorial/settings.webp", width: 1280, height: 800 },
} satisfies Record<string, Shot>;

// Pixel boxes measured on the screenshots above, as percentages.
const BAR_LINE: Mark = { left: 2.5, top: 85.8, width: 95.3, height: 9.6 };
const BAR_DETAILS: Mark = { left: 91.4, top: 85.8, width: 6.4, height: 9.6 };

function Screenshot({
  shot,
  alt,
  marks = [],
  legend,
  maxWidth,
}: {
  shot: Shot;
  alt: string;
  marks?: Mark[];
  legend?: readonly string[];
  /** CSS pixels; tall, narrow shots are kept smaller so the step stays short. */
  maxWidth?: number;
}) {
  // Numbers sit in a margin left of the image, level with their ring, so they never cover the
  // screenshot's own text at any width (coordinator review, 21 October 2026).
  const numbered = marks.some((mark) => mark.n != null);
  return (
    <figure className="wl-shot" style={maxWidth ? { maxWidth } : undefined}>
      <div className={numbered ? "wl-shot-frame wl-shot-numbered" : "wl-shot-frame"}>
        <img src={shot.src} width={shot.width} height={shot.height} alt={alt} decoding="async" />
        {marks.map((mark, index) => (
          <span
            key={index}
            className="wl-ring"
            aria-hidden="true"
            style={{ left: `${mark.left}%`, top: `${mark.top}%`, width: `${mark.width}%`, height: `${mark.height}%` }}
          />
        ))}
        {marks.map(
          (mark, index) =>
            mark.n != null && (
              <span key={`n${index}`} className="wl-ring-badge wl-shot-badge" aria-hidden="true" style={{ top: `${mark.top + mark.height / 2}%` }}>
                {mark.n}
              </span>
            ),
        )}
      </div>
      {legend && <Legend items={legend} badges={marks.flatMap((mark) => (mark.n != null ? [mark.n] : []))} />}
    </figure>
  );
}

/** The key under a picture; its badges match the ones on the picture, 1, 2, 3 unless given. */
function Legend({ items, badges = [] }: { items: readonly string[]; badges?: readonly (number | string)[] }) {
  return (
    <figcaption>
      <ol className="wl-legend">
        {items.map((item, index) => (
          <li key={item}>
            <span className="wl-ring-badge wl-legend-badge" aria-hidden="true">
              {badges[index] ?? index + 1}
            </span>
            {item}
          </li>
        ))}
      </ol>
    </figcaption>
  );
}

// Generic toolbar symbols drawn here, so no browser maker's artwork is copied.
const PUZZLE = <path d="M5 9h4.5a2 2 0 1 1 4 0H18v4a2 2 0 1 1 0 4v3H5z" />;
const PIN = <path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7" />;

function Glyph({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

/**
 * A plain browser window drawn in HTML: a toolbar with the reload and Extensions buttons and,
 * when asked, the Extensions menu and the pinned tracker. Its parts are described by `label`.
 */
function BrowserSketch({ label, step }: { label: string; step: "reload" | "pin" }) {
  const ring = (n: number) => <span className="wl-sk-badge">{n}</span>;
  return (
    <div className="wl-sketch" role="img" aria-label={label}>
      <div className="wl-sk-bar">
        <span className="wl-sk-nav">
          <Glyph>
            <path d="M15 6l-6 6 6 6" />
          </Glyph>
          <Glyph>
            <path d="M9 6l6 6-6 6" />
          </Glyph>
          <span className={step === "reload" ? "wl-sk-btn wl-sk-on" : "wl-sk-btn"}>
            <Icon name="refresh" size={16} />
          </span>
        </span>
        <span className="wl-sk-address">chatgpt.com</span>
        <span className="wl-sk-tools">
          {step === "pin" && (
            <span className="wl-sk-btn wl-sk-on wl-sk-pinned">
              <LivingGaugeMark size={18} />
              {ring(3)}
            </span>
          )}
          <span className={step === "pin" ? "wl-sk-btn wl-sk-on" : "wl-sk-btn"}>
            <Glyph>{PUZZLE}</Glyph>
            {step === "pin" && ring(1)}
          </span>
        </span>
      </div>
      {step === "pin" ? (
        <div className="wl-sk-body wl-sk-body-menu">
          <div className="wl-sk-menu">
            <span className="wl-sk-menu-title">Extensions</span>
            <span className="wl-sk-menu-row">
              <LivingGaugeMark size={18} className="wl-sk-mark" />
              <span>AI Footprint Tracker</span>
              <span className="wl-sk-btn wl-sk-on wl-sk-pin">
                <Glyph>{PIN}</Glyph>
                {ring(2)}
              </span>
            </span>
          </div>
        </div>
      ) : (
        <div className="wl-sk-body">
          <span className="wl-sk-line" />
          <span className="wl-sk-line wl-sk-line-short" />
          <span className="wl-sk-composer">Ask anything</span>
          <span className="wl-sk-tracker">
            <span>Req · In/Out tokens · Electricity · Carbon · Water</span>
            <span className="wl-sk-details">Details</span>
          </span>
        </div>
      )}
    </div>
  );
}

/** What stays on this computer and what may leave it, drawn as two boxes. */
function PrivacySketch() {
  return (
    <div
      className="wl-private"
      role="img"
      aria-label="This computer: the chat text is counted in memory and then discarded, and the numbers are saved in this browser. Nothing is sent to us. Your organization gets numbers only, and only if you connect."
    >
      <div className="wl-pv-box wl-pv-device">
        <span className="wl-pv-title">
          <LivingGaugeMark size={20} />
          This computer
        </span>
        <span className="wl-pv-row">
          <Icon name="message" size={18} />
          <span>
            <b>Chat text:</b> counted in memory, then discarded
          </span>
        </span>
        <span className="wl-pv-row">
          <Icon name="bars" size={18} />
          <span>
            <b>Numbers:</b> saved in this browser
          </span>
        </span>
      </div>
      <div className="wl-pv-box">
        <span className="wl-pv-row">
          <Icon name="close" size={18} />
          <span>
            <b>Sent to us:</b> nothing
          </span>
        </span>
        <span className="wl-pv-row">
          <Icon name="building" size={18} />
          <span>
            <b>Shared with your organization:</b> numbers only, and only if you connect
          </span>
        </span>
      </div>
    </div>
  );
}

function SiteLinks() {
  return (
    <ul className="wl-sites">
      {TOUR_SITES.map((site) => (
        <li key={site.key}>
          <a href={site.url} target="_blank" rel="noopener noreferrer">
            {SITE_LABELS[site.key]}{" "}
            <span className="lg-visually-hidden">(opens in a new tab)</span>
            <Icon name="external" size={14} />
          </a>
        </li>
      ))}
    </ul>
  );
}

export type TourStep = { title: string; body: ReactNode; figure: ReactNode };

/** A badge in the text that matches the same badge on the picture beside it. */
function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="wl-ring-badge wl-inline-badge" aria-hidden="true">
      {children}
    </span>
  );
}

/**
 * The steps in order. `paused` keeps the first step from saying that tracking is on. The copy
 * follows the owner's request of 21 October 2026: short sentences, one action per step, active
 * voice and one name for each thing, close to ASD-STE100 Simplified Technical English.
 */
export function tourSteps(paused: boolean): TourStep[] {
  return [
    {
      title: "You're all set. Go back to your AI tool and chat as usual.",
      body: (
        <>
          <p>
            {!paused && (
              <>
                <b>Tracking is on.</b>{" "}
              </>
            )}
            Use your AI tool as you always do. The tracker works in the background on these sites:
          </p>
          <SiteLinks />
        </>
      ),
      figure: (
        <figure className="wl-shot">
          <BrowserSketch
            step="reload"
            label="A browser window on an AI site with the reload button highlighted, and the tracker's bar under the message box."
          />
          <figcaption className="wl-caption">Reload a tab that was open before you installed the tracker.</figcaption>
        </figure>
      ),
    },
    {
      title: "The bar under the message box",
      body: (
        <>
          <p>A small bar shows under the box where you type. It shows the footprint of the open chat. It updates after each reply.</p>
          <dl className="wl-terms">
            <dt>Req</dt>
            <dd>Requests in this chat</dd>
            <dt>In/Out tokens</dt>
            <dd>Tokens the AI read and wrote</dd>
            <dt>Electricity, Carbon, Water</dt>
            <dd>The estimated use of this chat</dd>
          </dl>
        </>
      ),
      figure: (
        <Screenshot
          shot={SHOTS.bar}
          marks={[{ ...BAR_LINE, n: 1 }]}
          legend={["The bar"]}
          alt="A ChatGPT chat with the bar highlighted under the message box: Req 2, In/Out tokens about 21/88, Electricity about 0.197 Wh, Carbon about 0.0757 g CO2e, Water about 0.71 mL, and Details at the right end."
        />
      ),
    },
    {
      title: "Details shows the full picture",
      body: (
        <>
          <p>Select Details at the right end of the bar. Details shows:</p>
          <ol className="wl-numbered">
            <li>Electricity, carbon and water</li>
            <li>The same in everyday terms, like minutes of LED light</li>
            <li>Tokens read and written</li>
            <li>The same reply on a smaller model</li>
          </ol>
          <p>Below, Details tells you how each figure is estimated. If something is not counted, Details tells you why and what to do, for example Reload page.</p>
        </>
      ),
      figure: (
        <>
          <Screenshot shot={SHOTS.bar} marks={[BAR_DETAILS]} alt="The bar under the message box with Details highlighted at its right end." />
          <Screenshot
            shot={SHOTS.details}
            maxWidth={400}
            marks={[
              { n: 1, left: 5.7, top: 16.4, width: 85.6, height: 17.4 },
              { n: 2, left: 5.7, top: 35.0, width: 85.6, height: 17.4 },
              { n: 3, left: 5.7, top: 53.0, width: 85.6, height: 19.0 },
              { n: 4, left: 5.7, top: 72.8, width: 85.6, height: 17.6 },
            ]}
            alt="Details for a chat with 2 requests: Electricity 0.197 Wh, Carbon 0.0757 g CO2e and Water 0.71 mL, in everyday terms 1 minute of an 8 W LED bulb, 21 tokens read and 88 written, and the same output tokens with a smaller model."
          />
        </>
      ),
    },
    {
      title: "Pin the tracker and open the popup",
      body: (
        <>
          <ol className="wl-numbered">
            <li>Click the Extensions button (the puzzle piece) at the top right of your browser.</li>
            <li>Find AI Footprint Tracker. Click its pin.</li>
            <li>Click the AI Footprint Tracker logo in the toolbar. The popup opens.</li>
          </ol>
          <p>In the popup:</p>
          <ul className="wl-lettered">
            <li>
              <Badge>A</Badge>Choose today, 7 days or 30 days.
            </li>
            <li>
              <Badge>B</Badge>See electricity, carbon and water.
            </li>
            <li>
              <Badge>C</Badge>See the split by AI tool.
            </li>
            <li>
              <Badge>D</Badge>Open the dashboard.
            </li>
          </ul>
        </>
      ),
      figure: (
        <>
          <figure className="wl-shot">
            <BrowserSketch
              step="pin"
              label="A browser toolbar. 1: the puzzle-piece Extensions button at the top right. 2: the Extensions menu with AI Footprint Tracker and its pin. 3: the AI Footprint Tracker logo pinned in the toolbar."
            />
            <Legend items={["Extensions", "Pin", "Your tracker"]} />
          </figure>
          <Screenshot
            shot={SHOTS.popup}
            maxWidth={320}
            marks={[
              { n: "A", left: 46.8, top: 10.6, width: 44.4, height: 6.6 },
              { n: "B", left: 2.6, top: 48.0, width: 92.4, height: 13.0 },
              { n: "C", left: 2.6, top: 62.0, width: 92.4, height: 16.0 },
              { n: "D", left: 70.8, top: 79.6, width: 27.0, height: 7.0 },
            ]}
            legend={["Period", "Electricity, carbon and water", "Split by AI tool", "Dashboard"]}
            alt="The popup. A: Today, 7 days and 30 days. B: electricity, carbon and water. C: 2 requests split by AI tool. D: the Dashboard button."
          />
        </>
      ),
    },
    {
      title: "The dashboard and Settings",
      body: (
        <>
          <p className="wl-badged">
            <Badge>1</Badge>The dashboard has these pages:
          </p>
          <dl className="wl-terms">
            <dt>Overview</dt>
            <dd>Your totals over time, by AI tool</dd>
            <dt>Tools and models</dt>
            <dd>Each AI tool and model you used</dd>
            <dt>Monthly recap</dt>
            <dd>A summary of each month</dd>
            <dt>Methodology</dt>
            <dd>How each figure is calculated</dd>
          </dl>
          <p>Open Settings from the dashboard, or with the sliders button in the popup. In Settings you can:</p>
          <ul className="wl-lettered">
            <li>
              <Badge>2</Badge>
              <span>
                Choose the low, midpoint or high end of each estimate ({SCENARIO_NAMES.minimum}, {SCENARIO_NAMES.midpoint} or {SCENARIO_NAMES.maximum}).
              </span>
            </li>
            <li>
              <Badge>3</Badge>
              <span>Pause tracking. Nothing is recorded while paused.</span>
            </li>
            <li className="wl-plain">Turn {FULL_HISTORY_LABEL} on or off.</li>
            <li className="wl-plain">Erase all records.</li>
            <li className="wl-plain">Turn off tracking. This withdraws your agreement.</li>
            <li className="wl-plain">Connect to an organization, if you want. Only numbers are shared, never your chats.</li>
          </ul>
        </>
      ),
      figure: (
        <>
          <Screenshot
            shot={SHOTS.dashboard}
            marks={[{ n: 1, left: 1.0, top: 10.2, width: 15.1, height: 30.6 }]}
            legend={["The dashboard's pages"]}
            alt="The dashboard Overview: Your AI footprint for the last 30 days, with Overview, Tools and models, Monthly recap, Methodology and Settings in the sidebar."
          />
          <Screenshot
            shot={SHOTS.settings}
            marks={[
              { n: 2, left: 22.0, top: 29.8, width: 65.4, height: 21.4 },
              { n: 3, left: 82.4, top: 80.2, width: 5.2, height: 5.4 },
            ]}
            legend={["Low, midpoint or high end", "Pause tracking"]}
            alt="Settings: Scenario with Minimum, Midpoint and Maximum, the Tracking switch to pause, and Your agreement with Turn off tracking."
          />
        </>
      ),
    },
    {
      title: "Private by design",
      body: (
        <>
          <p>The tracker calculates everything on this computer.</p>
          <p>It counts the text of your chats in memory and keeps only numbers. The text is never stored or sent.</p>
          <p>Nothing leaves this browser unless you connect to an organization. Then only numbers are shared, never your chats.</p>
        </>
      ),
      figure: (
        <figure className="wl-shot">
          <PrivacySketch />
        </figure>
      ),
    },
  ];
}

/**
 * Back and Next move through the steps; "Done, close this page" and "Skip tour and close" call
 * `close`, which closes the tab. Each step change moves focus to its heading so keyboard and
 * screen reader users start reading at the new step.
 */
export function Tour({ paused, close, start = 0, focusFirst = false }: { paused: boolean; close: () => void; start?: number; focusFirst?: boolean }) {
  const steps = tourSteps(paused);
  const [index, setIndex] = useState(() => Math.min(Math.max(0, Math.trunc(start)), steps.length - 1));
  const [announced, setAnnounced] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  // Opening the page already agreed must not move focus; agreeing here and every step change do.
  const moveFocus = useRef(focusFirst);
  const step = steps[index]!;
  const last = index === steps.length - 1;

  useEffect(() => {
    if (!moveFocus.current) {
      moveFocus.current = true;
      return;
    }
    heading.current?.focus();
    setAnnounced(`Step ${index + 1} of ${steps.length}: ${steps[index]!.title}`);
  }, [index, steps.length]);

  return (
    <section className="wl-tour" aria-labelledby="wl-tour-title">
      {paused && (
        <div className="wl-done wl-paused" role="status">
          <b>Tracking is paused.</b>
          <span>Nothing is recorded. To resume, use the popup or Settings.</span>
        </div>
      )}
      <div className="wl-progress">
        <p className="wl-count lg-num">
          Step {index + 1} of {steps.length}
        </p>
        <ol className="wl-dots" aria-hidden="true">
          {steps.map((item, at) => (
            <li key={item.title} data-state={at === index ? "on" : at < index ? "done" : undefined} />
          ))}
        </ol>
      </div>
      <div className="wl-tour-step">
        <div className="wl-tour-text">
          <h1 id="wl-tour-title" ref={heading} tabIndex={-1} className="lg-display wl-tour-title">
            {step.title}
          </h1>
          {step.body}
        </div>
        <div className="wl-tour-figure">{step.figure}</div>
      </div>
      {/* Skip sits on the left and Next or Done on the right (owner, 21 Oct 2026). On the last step
          Done already closes the page, so a second close button would only confuse. */}
      <div className="wl-tour-nav">
        {index > 0 && (
          <button type="button" className="lg-btn lg-btn-secondary wl-btn" onClick={() => setIndex(index - 1)}>
            Back
          </button>
        )}
        {!last && (
          <button type="button" className="lg-btn lg-btn-secondary wl-btn" onClick={close}>
            Skip tour and close
          </button>
        )}
        {last ? (
          <button type="button" className="lg-btn lg-btn-primary wl-btn wl-next" onClick={close}>
            Done, close this page
          </button>
        ) : (
          <button type="button" className="lg-btn lg-btn-primary wl-btn wl-next" onClick={() => setIndex(index + 1)}>
            Next
          </button>
        )}
      </div>
      <p className="lg-visually-hidden" aria-live="polite">
        {announced}
      </p>
    </section>
  );
}
