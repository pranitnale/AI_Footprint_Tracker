// Generated from the canvas board WebSelfHost (board2jsx), then wired by hand. Static copy follows the board.
import type { Navigate } from "../../router";
import { useState } from "react";
import { SOURCE_REPOSITORY_URL, sourceFileUrl } from "../repository";

// A planning checklist for the person reading; nothing is saved or sent.
const LISTS: ReadonlyArray<readonly [string, string, readonly string[]]> = [
  ["a", "Before you deploy", [
    "Prepare an HTTPS domain and a PostgreSQL database.",
    "Create protected secrets for the app, encryption, signing and forms.",
    "Give the organization its own domain or subdomain, such as footprint.example.com.",
    "Set the trusted entry point that forwards requests to the server.",
    "Set up your own Brevo sender for sign-in codes.",
    "Choose retention, backups and where deletion records are stored.",
  ]],
  ["b", "Before people connect", [
    "Check the email sender privacy settings and that real codes arrive.",
    "Test restoring a backup and replaying deletions.",
    "Build and review each browser package.",
    "Check that connecting works in Chrome, Edge and Firefox.",
    "Review what employees are told and who has admin access.",
  ]],
];

export function WebSelfHostPage({ navigate }: { navigate: Navigate }) {
  void navigate;
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return (
    <>
      <section className="wrap" style={{ "paddingTop": "64px", "paddingBottom": "36px", "display": "flex", "flexDirection": "column", "gap": "14px" }}>
        <a href="/teams" style={{ "fontSize": "14px", "fontWeight": "600", "textDecoration": "none" }}>For teams</a>
        <h1 className="dsp" style={{ "margin": "0", "fontSize": "clamp(38px, 4.6vw, 60px)", "lineHeight": "1.05", "fontWeight": "800", "letterSpacing": "-.02em" }}>Run it on your own server.</h1>
        <p style={{ "margin": "0", "fontSize": "19px", "lineHeight": "29px", "color": "#4A5A4E", "maxWidth": "720px" }}>The same open extension, server, estimator and website. It does not call any licensing service.</p></section>
      <section className="wrap" style={{ "paddingBottom": "40px" }}>
        <div className="card" style={{ "padding": "28px", "display": "flex", "flexDirection": "column", "gap": "18px" }}>
          <b className="dsp" style={{ "fontSize": "22px" }}>What you run</b>
          <div className="flow" style={{ "display": "grid", "gridTemplateColumns": "minmax(0, 1fr) 40px minmax(0, 1.3fr) 40px minmax(0, 1fr)", "gap": "8px", "alignItems": "stretch" }}>
            <div className="node" style={{ "background": "#E3F0E1" }}>
              <b style={{ "fontSize": "16px" }}>Browser extension</b>
              <span style={{ "fontSize": "14px", "lineHeight": "20px", "color": "#2E3F33" }}>Counts on each device and sends numbers only</span></div>
            <div className="arrow" aria-hidden="true">
              <svg className="i" viewBox="0 0 24 24" style={{ "width": "26px", "height": "26px" }}><path d="M4 12h15M14 7l5 5-5 5" /></svg></div>
            <div className="node" style={{ "background": "#0F2A1C", "color": "#F4F5EF" }}>
              <b style={{ "fontSize": "16px" }}>Your server</b>
              <span style={{ "fontSize": "14px", "lineHeight": "20px", "color": "#B9CDBE" }}>API and organization website over HTTPS on your domain</span></div>
            <div className="arrow" aria-hidden="true">
              <svg className="i" viewBox="0 0 24 24" style={{ "width": "26px", "height": "26px" }}><path d="M4 12h15M14 7l5 5-5 5" /></svg></div>
            <div style={{ "display": "flex", "flexDirection": "column", "gap": "8px" }}>
              <div className="node" style={{ "background": "#E7EFF8" }}>
                <b style={{ "fontSize": "16px" }}>PostgreSQL</b>
                <span style={{ "fontSize": "14px", "color": "#1D4F80" }}>Usage and settings</span></div>
              <div className="node" style={{ "background": "#FFF6DB" }}>
                <b style={{ "fontSize": "16px" }}>Email sender</b>
                <span style={{ "fontSize": "14px", "color": "#6E4700" }}>Your Brevo account, for sign-in codes</span></div></div></div></div></section>
      <section className="wrap" style={{ "paddingBottom": "32px", "display": "grid", "gridTemplateColumns": "repeat(auto-fit, minmax(min(440px, 100%), 1fr))", "gap": "16px" }}>
        {LISTS.map(([key, title, items]) => {
          const done = items.filter((_, i) => checked.has(key + i)).length;
          return (
            <div key={key} className="card" style={{ "padding": "26px", "display": "flex", "flexDirection": "column" }}>
              <div style={{ "display": "flex", "justifyContent": "space-between", "alignItems": "baseline", "paddingBottom": "10px" }}>
                <b className="dsp" style={{ "fontSize": "22px" }}>{title}</b>
                <span className="num" style={{ "fontSize": "14px", "color": "#4A5A4E" }}>{done} of {items.length}</span></div>
              {items.map((text, i) => {
                const on = checked.has(key + i);
                return (
                  <button key={text} type="button" className="ck" role="checkbox" aria-checked={on} onClick={() => toggle(key + i)}>
                    <span className="box" style={{ background: on ? "#2E6B3F" : "#FFFFFF", border: on ? "2px solid #2E6B3F" : "2px solid #9DB394" }}>
                      <svg className="i" viewBox="0 0 24 24" style={{ width: 14, height: 14, opacity: on ? 1 : 0 }} aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg></span>
                    <span style={{ "fontSize": "15px", "lineHeight": "22px" }}>{text}</span></button>
                );
              })}
            </div>
          );
        })}</section>
      <section className="wrap" style={{ "paddingBottom": "88px", "display": "flex", "flexDirection": "column", "gap": "18px" }}>
        <div style={{ "display": "flex", "gap": "14px", "alignItems": "flex-start", "padding": "16px 20px", "borderRadius": "18px", "background": "#FFF6DB", "border": "1px solid #F0D58A", "color": "#4F3300" }}>
          <svg className="i" viewBox="0 0 24 24" style={{ "width": "22px", "height": "22px", "color": "#6E4700", "marginTop": "1px" }}><path d="M12 3 2 20h20L12 3z" /><path d="M12 10v4M12 17h.01" /></svg>
          <span style={{ "fontSize": "15px", "lineHeight": "23px" }}>A successful build does not prove that HTTPS, DNS, email delivery, backups, store signing or browser support work. Check each one on the real setup.</span></div>
        <div style={{ "display": "flex", "flexWrap": "wrap", "gap": "12px" }}>
          <a className="btn pri" href={sourceFileUrl("docs/operations/SELF-HOSTING.md")} target="_blank" rel="noopener noreferrer">Open the deployment guide</a>
          <a className="btn sec" href={SOURCE_REPOSITORY_URL} target="_blank" rel="noopener noreferrer">View the source</a></div></section>
    </>
  );
}
