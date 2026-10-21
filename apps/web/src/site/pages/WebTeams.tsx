// Generated from the canvas board WebTeams (board2jsx), then wired by hand. Static copy follows the board.
import type { Navigate } from "../../router";
import { todo } from "../board";

export function WebTeamsPage({ navigate }: { navigate: Navigate }) {
  void navigate;
  return (
    <>
      <section className="wrap" style={{ "paddingTop": "64px", "paddingBottom": "36px", "display": "flex", "flexDirection": "column", "gap": "14px" }}>
        <h1 className="dsp" style={{ "margin": "0", "fontSize": "clamp(38px, 4.6vw, 60px)", "lineHeight": "1.05", "fontWeight": "800", "letterSpacing": "-.02em", "maxWidth": "860px" }}>Understand your organization's AI use.</h1>
        <p style={{ "margin": "0", "fontSize": "19px", "lineHeight": "29px", "color": "#4A5A4E", "maxWidth": "700px" }}>See requests, tools, models and resource estimates across your team, without ever receiving chat content.</p></section>
      <section className="wrap" style={{ "display": "grid", "gridTemplateColumns": "repeat(auto-fit, minmax(min(320px, 100%), 1fr))", "gap": "16px", "alignItems": "stretch", "paddingBottom": "20px" }}>
        <div className="plan card">
          <span style={{ "fontSize": "15px", "fontWeight": "700", "color": "#4A5A4E" }}>Personal</span>
          <b className="dsp" style={{ "fontSize": "40px" }}>Free</b>
          <div style={{ "display": "flex", "flexDirection": "column", "gap": "10px", "flex": "1" }}>
            <span className="li">
              <svg className="i" viewBox="0 0 24 24" style={{ "color": "#2E6B3F", "marginTop": "2px" }}><path d="m5 12 5 5 9-10" /></svg>No account</span>
            <span className="li">
              <svg className="i" viewBox="0 0 24 24" style={{ "color": "#2E6B3F", "marginTop": "2px" }}><path d="m5 12 5 5 9-10" /></svg>Records stay in one browser profile</span>
            <span className="li">
              <svg className="i" viewBox="0 0 24 24" style={{ "color": "#2E6B3F", "marginTop": "2px" }}><path d="m5 12 5 5 9-10" /></svg>Chrome, Edge and Firefox on desktop</span></div>
          <a className="btn sec" href="/downloads">Get the extension</a></div>
        <div className="plan" style={{ "background": "#0F2A1C", "color": "#F4F5EF", "boxShadow": "0 30px 60px rgba(15,42,28,.25)" }}>
          <div style={{ "display": "flex", "justifyContent": "space-between", "alignItems": "center" }}>
            <span style={{ "fontSize": "15px", "fontWeight": "700", "color": "#B9CDBE" }}>Hosted organization</span>
            <span className="st" style={{ "background": "#B9E27C", "color": "#0F2A1C" }}>No server needed</span></div>
          <b className="dsp" style={{ "fontSize": "40px" }}>Free</b>
          <div style={{ "display": "flex", "flexDirection": "column", "gap": "10px", "flex": "1" }}>
            <span className="li">
              <svg className="i" viewBox="0 0 24 24" style={{ "color": "#B9E27C", "marginTop": "2px" }}><path d="m5 12 5 5 9-10" /></svg>Up to 50 active members, including administrators</span>
            <span className="li">
              <svg className="i" viewBox="0 0 24 24" style={{ "color": "#B9E27C", "marginTop": "2px" }}><path d="m5 12 5 5 9-10" /></svg>Free forever, with no time limit</span>
            <span className="li">
              <svg className="i" viewBox="0 0 24 24" style={{ "color": "#B9E27C", "marginTop": "2px" }}><path d="m5 12 5 5 9-10" /></svg>Usage kept until you delete it, or for a shorter period you choose</span>
            <span className="li">
              <svg className="i" viewBox="0 0 24 24" style={{ "color": "#B9E27C", "marginTop": "2px" }}><path d="m5 12 5 5 9-10" /></svg>Several administrators</span></div>
          <a className="btn" href="/register" style={{ "background": "#B9E27C", "color": "#0F2A1C" }}>Register your organization</a></div>
        <div className="plan card">
          <span style={{ "fontSize": "15px", "fontWeight": "700", "color": "#4A5A4E" }}>Self-hosted</span>
          <b className="dsp" style={{ "fontSize": "40px" }}>Your server</b>
          <div style={{ "display": "flex", "flexDirection": "column", "gap": "10px", "flex": "1" }}>
            <span className="li">
              <svg className="i" viewBox="0 0 24 24" style={{ "color": "#2E6B3F", "marginTop": "2px" }}><path d="m5 12 5 5 9-10" /></svg>One organization</span>
            <span className="li">
              <svg className="i" viewBox="0 0 24 24" style={{ "color": "#2E6B3F", "marginTop": "2px" }}><path d="m5 12 5 5 9-10" /></svg>Usage kept until an administrator deletes it</span>
            <span className="li">
              <svg className="i" viewBox="0 0 24 24" style={{ "color": "#2E6B3F", "marginTop": "2px" }}><path d="m5 12 5 5 9-10" /></svg>Your own database and email sender</span></div>
          <a className="btn sec" href="/self-host">Review requirements</a></div></section>
      <section className="wrap" style={{ "paddingBottom": "64px" }}>
        <div className="card" style={{ "padding": "22px 26px", "display": "flex", "flexWrap": "wrap", "justifyContent": "space-between", "alignItems": "center", "gap": "16px" }}>
          <span style={{ "display": "flex", "flexDirection": "column", "gap": "4px" }}>
            <b className="dsp" style={{ "fontSize": "20px" }}>More than 50 members?</b>
            <span style={{ "fontSize": "15px", "lineHeight": "23px", "color": "#4A5A4E" }}>Tell us how many people would use it, and we will set up a plan for your organization. There is no checkout on this website.</span></span>
          <a className="btn pri" href="/contact">
            <svg className="i" viewBox="0 0 24 24" style={{ "width": "16px", "height": "16px" }}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></svg>Contact us</a></div></section>
      <section className="wrap" style={{ "paddingBottom": "64px", "display": "flex", "flexDirection": "column", "gap": "24px" }}>
        <div style={{ "display": "flex", "flexDirection": "column", "gap": "10px" }}>
          <span className="eyebrow">Joining</span>
          <h2 className="dsp" style={{ "margin": "0", "fontSize": "clamp(30px, 3.4vw, 44px)", "lineHeight": "1.1", "fontWeight": "700" }}>Three steps for everyone.</h2></div>
        <div style={{ "display": "grid", "gridTemplateColumns": "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", "gap": "16px" }}>
          <div className="card jn">
            <span className="jnn">1</span>
            <b className="dsp" style={{ "fontSize": "20px" }}>Register the organization</b>
            <p className="p">An administrator registers with a work email and confirms it with a code.</p></div>
          <div className="card jn">
            <span className="jnn">2</span>
            <b className="dsp" style={{ "fontSize": "20px" }}>Members connect</b>
            <p className="p">Each person installs the extension, chooses Connect organization and enters their work email.</p></div>
          <div className="card jn">
            <span className="jnn">3</span>
            <b className="dsp" style={{ "fontSize": "20px" }}>Enter the code</b>
            <p className="p">The person enters the code sent to that email, checks what is shared and connects.</p></div></div></section>
      <section className="wrap" style={{ "paddingBottom": "88px", "display": "grid", "gridTemplateColumns": "repeat(auto-fit, minmax(min(420px, 100%), 1fr))", "gap": "16px" }}>
        <div className="card" style={{ "padding": "28px", "display": "flex", "flexDirection": "column", "gap": "16px" }}>
          <span className="eyebrow">What administrators see</span>
          <div style={{ "display": "grid", "gridTemplateColumns": "repeat(3, 1fr)", "gap": "10px" }}>
            <div style={{ "padding": "14px", "borderRadius": "14px", "background": "#FFF6DB", "display": "flex", "flexDirection": "column", "gap": "2px" }}>
              <span style={{ "fontSize": "12px", "fontWeight": "600", "color": "#8A5A00" }}>Electricity</span>
              <b className="dsp num" style={{ "fontSize": "22px" }}>31.6 kWh</b></div>
            <div style={{ "padding": "14px", "borderRadius": "14px", "background": "#F1EFEA", "display": "flex", "flexDirection": "column", "gap": "2px" }}>
              <span style={{ "fontSize": "12px", "fontWeight": "600", "color": "#5B564C" }}>Carbon</span>
              <b className="dsp num" style={{ "fontSize": "22px" }}>12.1 kg</b></div>
            <div style={{ "padding": "14px", "borderRadius": "14px", "background": "#E7EFF8", "display": "flex", "flexDirection": "column", "gap": "2px" }}>
              <span style={{ "fontSize": "12px", "fontWeight": "600", "color": "#1D69AE" }}>Water</span>
              <b className="dsp num" style={{ "fontSize": "22px" }}>103 L</b></div></div>
          <div style={{ "display": "flex", "height": "16px", "borderRadius": "8px", "overflow": "hidden", "gap": "2px" }}><div style={{ "flex": "12.96", "background": "#183D24" }} /><div style={{ "flex": "11.06", "background": "#2E6B3F" }} /><div style={{ "flex": "3.48", "background": "#5A9654" }} /><div style={{ "flex": "2.53", "background": "#BFD99A" }} /><div style={{ "flex": "1.58", "background": "#8DBB6E" }} /></div>
          <p className="p">Organization totals, requests by tool and model, how many people use AI and connection health, never one person's usage. Example organization, last 30 days.</p></div>
        <div className="card" style={{ "padding": "28px", "display": "flex", "flexDirection": "column", "gap": "14px" }}>
          <span className="eyebrow">What members keep</span>
          <span className="li">
            <svg className="i" viewBox="0 0 24 24" style={{ "color": "#2E6B3F", "marginTop": "2px" }}><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z" /></svg>Chat text stays private. The organization receives numbers only.</span>
          <span className="li">
            <svg className="i" viewBox="0 0 24 24" style={{ "color": "#2E6B3F", "marginTop": "2px" }}><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z" /></svg>Personal records from before connecting stay in the browser.</span>
          <span className="li">
            <svg className="i" viewBox="0 0 24 24" style={{ "color": "#2E6B3F", "marginTop": "2px" }}><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z" /></svg>Everyone sees what is shared before they connect.</span>
          <span className="li">
            <svg className="i" viewBox="0 0 24 24" style={{ "color": "#2E6B3F", "marginTop": "2px" }}><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z" /></svg>Their own figures, in the same popup and dashboard.</span></div></section>
    </>
  );
}
