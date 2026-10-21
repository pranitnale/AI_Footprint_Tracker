// Generated from the canvas board WebDownloads (board2jsx), then wired by hand. Static copy follows the board.
import type { Navigate } from "../../router";
import { useState } from "react";
import { version } from "../../../../extension/package.json";
import { builtDownloads } from "../../generated/downloads";
import { resolveDownloads } from "../../safety";

const LOOK = {
  chrome: { name: "Chrome", mark: "C", bg: "#E3F0E1", fg: "#1F5A2E" },
  edge: { name: "Microsoft Edge", mark: "E", bg: "#E7EFF8", fg: "#1D4F80" },
  firefox: { name: "Firefox", mark: "F", bg: "#FFF1CC", fg: "#6E4700" },
} as const;
const TABS = [["chromium", "Chrome and Edge"], ["firefox", "Firefox"]] as const;
const STEPS: Record<(typeof TABS)[number][0], ReadonlyArray<readonly [string, string]>> = {
  chromium: [
    ["Download and unzip", "Keep the unzipped folder somewhere it will stay."],
    ["Open the extensions page", "Go to chrome://extensions or edge://extensions and turn on Developer mode."],
    ["Load the folder", "Choose Load unpacked and select the unzipped folder."],
    ["Pin the icon", "Pin AI Footprint to the toolbar, then open any supported AI chat."],
  ],
  firefox: [
    ["Download the package", "Keep the file somewhere it will stay."],
    ["Open the debugging page", "Go to about:debugging and choose This Firefox."],
    ["Load the add-on", "Choose Load Temporary Add-on and select the package file."],
    ["Open a chat", "Open any supported AI chat. The bar appears below the message box."],
  ],
};

export function WebDownloadsPage({ navigate }: { navigate: Navigate }) {
  void navigate;
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("chromium");
  // Deployments set their package links at runtime; a missing link shows as unavailable, never as a broken download.
  const downloads = resolveDownloads(window.__AIFT_CONFIG__?.downloads ?? builtDownloads).map((d) => ({ ...d, ...LOOK[d.id] }));
  return (
    <>
      <section className="wrap" style={{ "paddingTop": "64px", "paddingBottom": "32px", "display": "flex", "flexDirection": "column", "gap": "14px", "maxWidth": "1200px" }}>
        <h1 className="dsp" style={{ "margin": "0", "fontSize": "clamp(38px, 4.6vw, 60px)", "lineHeight": "1.05", "fontWeight": "800", "letterSpacing": "-.02em" }}>Install in your desktop browser</h1>
        <p style={{ "margin": "0", "fontSize": "19px", "lineHeight": "29px", "color": "#4A5A4E", "maxWidth": "680px" }}>Use it on your own without an account, or connect the same extension to your organization later.</p></section>
      <section className="wrap" style={{ "display": "grid", "gridTemplateColumns": "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", "gap": "16px", "paddingBottom": "24px" }}>
        {downloads.map((b) => (
          <div key={b.id} className="card bc">
            <span className="bi" style={{ background: b.bg, color: b.fg }} aria-hidden="true">{b.mark}</span>
            <b className="dsp" style={{ "fontSize": "24px" }}>{b.name}</b>
            <span style={{ "fontSize": "15px", "color": "#4A5A4E" }}>Test package for manual installation</span>
            {b.href ? (
              <a className="btn pri" href={b.href} download>
                <svg className="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>Download package</a>
            ) : (
              <button type="button" className="btn sec" disabled>Package unavailable</button>
            )}
            <span className="num" style={{ "fontSize": "13px", "color": "#4A5A4E" }}>Version {version} · unsigned</span></div>
        ))}</section>
      <section className="wrap" style={{ "paddingBottom": "24px" }}>
        <div style={{ "display": "flex", "gap": "14px", "alignItems": "flex-start", "padding": "16px 20px", "borderRadius": "18px", "background": "#FFF6DB", "border": "1px solid #F0D58A", "color": "#4F3300" }}>
          <svg className="i" viewBox="0 0 24 24" style={{ "width": "22px", "height": "22px", "color": "#6E4700", "marginTop": "1px" }}><path d="M12 3 2 20h20L12 3z" /><path d="M12 10v4M12 17h.01" /></svg>
          <span style={{ "fontSize": "15px", "lineHeight": "23px" }}>Not in a browser store yet. These packages are unsigned, so review the source before you roll them out. If a package shows as unavailable, build it from the repository.</span></div></section>
      <section className="wrap" style={{ "paddingBottom": "72px", "display": "flex", "flexWrap": "wrap", "gap": "24px", "alignItems": "flex-start" }}>
        <div className="card" style={{ "flex": "1 1 560px", "padding": "26px", "display": "flex", "flexDirection": "column", "gap": "12px" }}>
          <div style={{ "display": "flex", "flexWrap": "wrap", "justifyContent": "space-between", "alignItems": "center", "gap": "12px" }}>
            <h2 className="dsp" style={{ "margin": "0", "fontSize": "26px", "fontWeight": "700" }}>Install in four steps</h2>
            <div role="tablist" style={{ "display": "flex", "gap": "6px", "padding": "4px", "borderRadius": "14px", "background": "#EEF1E8" }}>
              {TABS.map(([key, label]) => (
                <button key={key} type="button" className="tab" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} style={{ background: tab === key ? "#FFFFFF" : "transparent", color: tab === key ? "#13241A" : "#4A5A4E" }}>{label}</button>
              ))}</div></div>
          {STEPS[tab].map(([title, text], i) => (
            <div key={title} className="is">
              <span className="isn">{i + 1}</span>
              <span style={{ "display": "flex", "flexDirection": "column", "gap": "4px" }}>
                <b style={{ "fontSize": "16px" }}>{title}</b>
                <span style={{ "fontSize": "15px", "lineHeight": "22px", "color": "#4A5A4E" }}>{text}</span></span></div>
          ))}
          <span style={{ "fontSize": "14px", "lineHeight": "21px", "color": "#4A5A4E" }}>{tab === "firefox" ? "Firefox removes temporary add-ons when it restarts. Load it again after a restart until a signed version is available." : "Your browser may remind you that a developer extension is installed. That is expected for an unsigned package."}</span></div>
        <div style={{ "flex": "1 1 300px", "display": "flex", "flexDirection": "column", "gap": "16px" }}>
          <div className="card" style={{ "padding": "24px", "display": "flex", "flexDirection": "column", "gap": "12px" }}>
            <b className="dsp" style={{ "fontSize": "20px" }}>Prefer to build it?</b>
            <p className="p">The repository has everything needed to build each browser package yourself.</p>
            <a className="btn sec" href="/open-source">Build from source</a></div>
          <div className="card" style={{ "padding": "24px", "display": "flex", "flexDirection": "column", "gap": "12px" }}>
            <b className="dsp" style={{ "fontSize": "20px" }}>Rolling out to an organization?</b>
            <p className="p">Register your organization or host the server yourself.</p>
            <a className="btn sec" href="/teams">See options for teams</a></div></div></section>
    </>
  );
}
