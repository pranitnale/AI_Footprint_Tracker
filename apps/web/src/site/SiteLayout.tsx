// The public website's header and footer from the canvas web boards (WebHome and the pages after it).
import { type MouseEvent, type ReactNode } from "react";
import type { Navigate } from "../router";
import { SITE_ROUTES } from "./board";

const NAV: ReadonlyArray<readonly [string, string]> = [
  ["/", "Home"],
  ["/downloads", "Download"],
  ["/teams", "For teams"],
  ["/methodology", "Methodology"],
  ["/privacy", "Privacy"],
  ["/contact", "Contact"],
];

const FOOTER: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, string]>]> = [
  ["Product", [["/downloads", "Download"], ["/teams", "For teams"], ["/self-host", "Self-host"]]],
  ["Trust", [["/methodology", "Methodology"], ["/privacy", "Privacy"], ["/open-source", "Open source"]]],
  ["Organizations", [["/login", "Administrator sign in"], ["/register", "Register an organization"], ["/contact", "Contact us"]]],
  ["Legal", [["/terms", "Terms of use"], ["/privacy-policy", "Privacy policy"], ["/dpa", "Data processing agreement"], ["/imprint", "Imprint"]]],
];

const FULL_LOAD = new Set(["/contact", "/register"]);

export function Mark({ size = 28, color = "#2E6B3F", leaf = "currentColor" }: { size?: number; color?: string; leaf?: string }) {
  return (
    <svg viewBox="0 0 64 64" style={{ width: size, height: size, color }} aria-hidden="true" focusable="false">
      <path d="M27 6 A27 27 0 0 0 21 57 M37 6 A27 27 0 0 1 43 57" fill="none" stroke="currentColor" strokeWidth="10" />
      <path d="M23 42 C18 28 30 20 43 17 C42 29 37 43 25 42 L22 47 Z" fill={leaf} />
    </svg>
  );
}

/**
 * Routes clicks on the site's own links inside the app, so pages keep plain hrefs (which work
 * without script, with a middle click and in a new tab) and still navigate without a reload.
 */
function routeLinks(navigate: Navigate) {
  return (event: MouseEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element).closest?.("a");
    if (!anchor || anchor.target || anchor.hasAttribute("download")) return;
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin || !SITE_ROUTES.has(url.pathname)) return;
    // A self-hosted organization's own host sends these to the registration host, which only a page load reaches.
    if (FULL_LOAD.has(url.pathname)) return;
    event.preventDefault();
    navigate(url.pathname + url.search + url.hash);
    if (url.hash) document.getElementById(url.hash.slice(1))?.scrollIntoView();
    else window.scrollTo(0, 0);
  };
}

/** The methodology has three pages and Download an older address; each marks its menu entry. */
function current(path: string, to: string) {
  if (to === "/downloads") return path === to || path === "/download";
  if (to === "/methodology") return path === to || path.startsWith("/methodology/");
  return path === to;
}

/** A signed-in administrator's organization, for the header button that opens the panel. */
export type AdminPanelLink = { company: string | null };

/**
 * Admin sign in for visitors, Open admin panel with the organization's name for a signed-in
 * administrator. A long name is cut with an ellipsis inside a capped width, so it never moves the
 * navigation; the title and the accessible name carry it in full.
 */
function AdminButton({ navigate, panel }: { navigate: Navigate; panel?: AdminPanelLink | null }) {
  if (!panel)
    return (
      <a href="/login" className="btn sec site-signin">
        Admin sign in
      </a>
    );
  const label = panel.company ? `Open admin panel for ${panel.company}` : "Open admin panel";
  return (
    <a
      href="/admin"
      className="btn sec site-signin site-panel"
      title={label}
      aria-label={label}
      onClick={(event) => {
        // The session is already known, so the panel opens without loading the website again.
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate("/admin");
      }}
    >
      <span className="site-panel-lines">
        <span className="site-panel-action">Open admin panel</span>
        {panel.company && <span className="site-panel-org">{panel.company}</span>}
      </span>
    </a>
  );
}

export function SiteLayout({
  navigate,
  path,
  adminPanel,
  children,
}: {
  navigate: Navigate;
  path: string;
  /** Set while an administrator's session is known on this page. */
  adminPanel?: AdminPanelLink | null;
  children: ReactNode;
}) {
  return (
    <div className="site" onClick={routeLinks(navigate)}>
      <a className="skip" href="#main-content">
        Skip to content
      </a>
      <header className="site-top">
        <div className="wrap site-top-row">
          <a href="/" className="site-brand" aria-label="AI Footprint Tracker home">
            <Mark />
            <b className="dsp">AI Footprint Tracker</b>
          </a>
          <nav aria-label="Site" className="site-nav">
            {NAV.map(([to, label]) => (
              <a key={to} className="wl" href={to} aria-current={current(path, to) ? "page" : undefined}>
                {label}
              </a>
            ))}
          </nav>
          <AdminButton navigate={navigate} panel={adminPanel} />
        </div>
      </header>
      <main id="main-content" className="site-main">
        {children}
      </main>
      <footer className="site-foot">
        <div className="site-foot-row">
          <div className="site-foot-about">
            <span>
              <Mark color="#B9E27C" />
              <b className="dsp">AI Footprint Tracker</b>
            </span>
            <span>Estimates the electricity, carbon and water behind your AI chats. Figures are estimates, not measurements.</span>
          </div>
          <div className="site-foot-cols">
            {FOOTER.map(([title, links]) => (
              <div key={title}>
                <b>{title}</b>
                {links.map(([to, label]) => (
                  <a key={to + label} className="fl" href={to}>
                    {label}
                  </a>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="site-credit">
          <p>
            Designed and built by{" "}
            <a href="https://www.linkedin.com/in/pranitnale/" target="_blank" rel="noopener noreferrer">
              Pranit Nale
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
