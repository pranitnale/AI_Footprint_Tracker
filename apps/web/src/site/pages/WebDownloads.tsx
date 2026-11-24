// Generated from the canvas board WebDownloads (board2jsx), then wired by hand. Static copy follows the board.
import type { Navigate } from "../../router";
import { version } from "../../../../extension/package.json";

const CHROME_WEB_STORE_URL = "https://chromewebstore.google.com/detail/ai-footprint-tracker/hcipdbbjkdjifcmallagehhjbdhodide";

const LOOK = {
  chrome: { name: "Chrome", mark: "C", bg: "#E3F0E1", fg: "#1F5A2E" },
  edge: { name: "Microsoft Edge", mark: "E", bg: "#E7EFF8", fg: "#1D4F80" },
  firefox: { name: "Firefox", mark: "F", bg: "#FFF1CC", fg: "#6E4700" },
} as const;
const STEPS = [
  ["Open the store page", "Open AI Footprint Tracker in the Chrome Web Store."],
  ["Add it to your browser", "Choose Add to Chrome and confirm. The button has the same name in Microsoft Edge."],
  ["Agree on the welcome page", "A welcome page opens. Nothing is counted until you choose Agree and start."],
  ["Pin the icon", "Pin AI Footprint Tracker to the toolbar, then open any supported AI chat."],
] as const;

export function WebDownloadsPage({ navigate }: { navigate: Navigate }) {
  void navigate;
  return (
    <>
      <section className="wrap" style={{ "paddingTop": "64px", "paddingBottom": "32px", "display": "flex", "flexDirection": "column", "gap": "14px", "maxWidth": "1200px" }}>
        <h1 className="dsp" style={{ "margin": "0", "fontSize": "clamp(38px, 4.6vw, 60px)", "lineHeight": "1.05", "fontWeight": "800", "letterSpacing": "-.02em" }}>Install in your desktop browser</h1>
        <p style={{ "margin": "0", "fontSize": "19px", "lineHeight": "29px", "color": "#4A5A4E", "maxWidth": "680px" }}>Use it on your own without an account, or connect the same extension to your organization later.</p></section>
      <section className="wrap" style={{ "display": "grid", "gridTemplateColumns": "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", "gap": "16px", "paddingBottom": "24px" }}>
        {Object.entries(LOOK).map(([id, look]) => ({ id, ...look })).map((b) => (
          <div key={b.id} className="card bc">
            <span className="bi" style={{ background: b.bg, color: b.fg }} aria-hidden="true">{b.mark}</span>
            <b className="dsp" style={{ "fontSize": "24px" }}>{b.name}</b>
            <span style={{ "fontSize": "15px", "color": "#4A5A4E" }}>{b.id === "firefox" ? "Not in its browser store yet" : "From the Chrome Web Store"}</span>
            {/* Edge installs extensions from the Chrome Web Store, so it gets the same package and
                the same updates as Chrome (owner decision of 23 Nov 2026). */}
            {b.id === "chrome" ? (
              <a className="btn pri" href={CHROME_WEB_STORE_URL} target="_blank" rel="noopener noreferrer">Add to Chrome</a>
            ) : b.id === "edge" ? (
              <a className="btn pri" href={CHROME_WEB_STORE_URL} target="_blank" rel="noopener noreferrer">Add to Edge</a>
            ) : (
              <button type="button" className="btn sec" disabled>Coming soon</button>
            )}
            {b.id === "chrome" && <span className="num" style={{ "fontSize": "13px", "color": "#4A5A4E" }}>Version {version}</span>}</div>
        ))}</section>
      <section className="wrap" style={{ "paddingBottom": "24px" }}>
        <div style={{ "display": "flex", "gap": "14px", "alignItems": "flex-start", "padding": "16px 20px", "borderRadius": "18px", "background": "#FFF6DB", "border": "1px solid #F0D58A", "color": "#4F3300" }}>
          <svg className="i" viewBox="0 0 24 24" style={{ "width": "22px", "height": "22px", "color": "#6E4700", "marginTop": "1px" }}><path d="M12 3 2 20h20L12 3z" /><path d="M12 10v4M12 17h.01" /></svg>
          <span style={{ "fontSize": "15px", "lineHeight": "23px" }}>Install from the Chrome Web Store, in Chrome or in Microsoft Edge. In Edge, allow extensions from other stores when Edge asks, then choose Add to Chrome on the store page. A Firefox version is coming to its browser store soon.</span></div></section>
      <section className="wrap" style={{ "paddingBottom": "72px", "display": "flex", "flexWrap": "wrap", "gap": "24px", "alignItems": "flex-start" }}>
        <div className="card" style={{ "flex": "1 1 560px", "padding": "26px", "display": "flex", "flexDirection": "column", "gap": "12px" }}>
          <h2 className="dsp" style={{ "margin": "0", "fontSize": "26px", "fontWeight": "700" }}>Install in four steps</h2>
          {STEPS.map(([title, text], i) => (
            <div key={title} className="is">
              <span className="isn">{i + 1}</span>
              <span style={{ "display": "flex", "flexDirection": "column", "gap": "4px" }}>
                <b style={{ "fontSize": "16px" }}>{title}</b>
                <span style={{ "fontSize": "15px", "lineHeight": "22px", "color": "#4A5A4E" }}>{text}</span></span></div>
          ))}
          <span style={{ "fontSize": "14px", "lineHeight": "21px", "color": "#4A5A4E" }}>With Enhanced protection on, Chrome may say the extension is not trusted yet. Google shows this for new developers during their first months. You can still add it.</span></div>
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
