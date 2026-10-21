// Generated from the canvas board WebHome (board2jsx), then wired by hand. Static copy follows the board.
import type { Navigate } from "../../router";
import { todo } from "../board";

export function WebHomePage({ navigate }: { navigate: Navigate }) {
  void navigate;
  return (
    <>
      {/* The hero (canvas WebHomeNew, owner decision of 17 October 2026): "runs entirely on your
          computer" is the most prominent message, and where the data goes sits beside it. */}
      <section className="wrap" style={{ "paddingTop": "72px", "paddingBottom": "96px" }}>
        <div className="hx" style={{ "alignItems": "start" }}>
          <div style={{ "display": "flex", "flexDirection": "column", "gap": "24px" }}>
            <span className="eyebrow">For everyone who cares about their AI footprint</span>
            <h1 className="dsp h1x">Know the energy behind your AI use.</h1>
            <p className="lead">Electricity, carbon and water behind your AI use, for you or your whole organization.</p>
            <section className="lg-local" aria-labelledby="home-local">
              <h2 id="home-local" className="lg-local-title">Runs entirely on your computer.</h2>
              <p className="lg-local-text">The extension counts and calculates in your browser. Your chats never leave it, and for personal use nothing at all is sent to us.</p>
              <ul className="lg-local-badges" aria-label="About the extension">
                <li>Open source, MIT License</li>
                <li>No account for personal use</li>
                <li>No analytics or advertising</li></ul></section>
            <div style={{ "display": "flex", "flexWrap": "wrap", "gap": "12px", "paddingTop": "4px" }}>
              <a className="btn pri" href="/downloads" style={{ "height": "52px", "padding": "0 24px", "fontSize": "16px" }}>Add to your browser
                <svg className="i" viewBox="0 0 24 24" style={{ "width": "17px", "height": "17px" }}><path d="M5 12h14M13 6l6 6-6 6" /></svg></a>
              <a className="btn sec" href="/open-source" style={{ "height": "52px", "padding": "0 22px", "fontSize": "16px" }}>Read the code</a></div></div>
          <section className="wd" aria-labelledby="home-data">
            <h2 id="home-data" className="wdh">Where your data goes</h2>
            <div className="wdc">
              <h3>On your computer</h3>
              <p>Reading the chat, counting tokens, finding the model, estimating electricity, carbon and water, and keeping your history.</p></div>
            <div className="wdc">
              <h3>Sent to us</h3>
              <p>Nothing, for personal use.</p></div>
            <div className="wdc">
              <h3>Only if you join an organization</h3>
              <p>Numbers are sent to your organization's account: token counts, estimates, tools, models and times. Never prompts, answers, files or chat titles.</p></div>
            <span style={{ "fontSize": "14px", "color": "#4A5A4E" }}>Check it yourself: the full source code is public.{" "}
              <a href="/open-source">Open source</a></span></section></div></section>
      <section style={{ "borderTop": "1px solid #DCE2D6", "borderBottom": "1px solid #DCE2D6", "background": "#FFFFFF" }}>
        <div className="wrap" style={{ "display": "flex", "flexWrap": "wrap", "alignItems": "center", "gap": "14px 44px", "paddingTop": "22px", "paddingBottom": "22px" }}>
          <span style={{ "fontSize": "14px", "color": "#4A5A4E" }}>Works on</span>
          <span className="svc">ChatGPT</span>
          <span className="svc">Claude</span>
          <span className="svc">Gemini</span>
          <span className="svc">Perplexity</span>
          <span className="svc">NotebookLM</span>
          <span style={{ "fontSize": "14px", "color": "#4A5A4E", "marginLeft": "auto" }}>in Chrome, Edge and Firefox</span></div></section>
      <section className="wrap" style={{ "paddingTop": "112px", "paddingBottom": "104px", "display": "flex", "flexDirection": "column", "gap": "48px" }}>
        <h2 className="dsp h2x" style={{ "maxWidth": "900px", "fontSize": "clamp(30px, 3.6vw, 46px)" }}>AI runs on electricity. Until now, your organization's share has not shown up in any report.</h2>
        <div style={{ "display": "grid", "gridTemplateColumns": "repeat(auto-fit, minmax(min(260px, 100%), 1fr))", "gap": "32px" }}>
          <div className="stat">
            <b className="dsp num">415 TWh</b>
            <span className="p">used by data centres worldwide in 2024, about 1.5% of the world's electricity</span></div>
          <div className="stat">
            <b className="dsp num">945 TWh</b>
            <span className="p">expected by 2030 in the base case, more than twice as much</span></div>
          <div className="stat" style={{ "borderTopColor": "#2E6B3F" }}>
            <b className="dsp" style={{ "color": "#2E6B3F" }}>Per request</b>
            <span className="p">what AI Footprint Tracker adds: your own share, by tool, model and day</span></div></div>
        <span style={{ "fontSize": "13px", "color": "#4A5A4E" }}>Source: International Energy Agency, Energy and AI (2025).</span></section>
      <section className="wrap" style={{ "paddingBottom": "112px", "display": "flex", "flexDirection": "column", "gap": "32px" }}>
        <h2 className="dsp h2x">What your organization sees</h2>
        <div className="bento">
          <div className="cell" style={{ "gridColumn": "span 7", "background": "#0F2A1C", "color": "#F4F5EF" }}>
            <h3 className="dsp">Totals you can report</h3>
            <p style={{ "color": "#DDE8DF", "maxWidth": "460px" }}>Electricity, carbon and water for the whole organization, by day, tool and model.</p>
            <div style={{ "display": "flex", "flexDirection": "column", "gap": "12px", "marginTop": "8px" }}>
              <div className="tb">
                <span style={{ "color": "#DDE8DF" }}>Claude</span>
                <span><i style={{ "width": "100%", "background": "#B9E27C" }} /></span>
                <span className="num" style={{ "textAlign": "right", "color": "#F4F5EF", "fontWeight": "600" }}>13.0 kWh</span></div>
              <div className="tb">
                <span style={{ "color": "#DDE8DF" }}>ChatGPT</span>
                <span><i style={{ "width": "85%", "background": "#2E6B3F" }} /></span>
                <span className="num" style={{ "textAlign": "right", "color": "#F4F5EF", "fontWeight": "600" }}>11.1 kWh</span></div>
              <div className="tb">
                <span style={{ "color": "#DDE8DF" }}>Perplexity</span>
                <span><i style={{ "width": "27%", "background": "#5A9654" }} /></span>
                <span className="num" style={{ "textAlign": "right", "color": "#F4F5EF", "fontWeight": "600" }}>3.5 kWh</span></div>
              <div className="tb">
                <span style={{ "color": "#DDE8DF" }}>Gemini</span>
                <span><i style={{ "width": "20%", "background": "#8DBB6E" }} /></span>
                <span className="num" style={{ "textAlign": "right", "color": "#F4F5EF", "fontWeight": "600" }}>2.5 kWh</span></div>
              <div className="tb">
                <span style={{ "color": "#DDE8DF" }}>NotebookLM</span>
                <span><i style={{ "width": "12%", "background": "#BFD99A" }} /></span>
                <span className="num" style={{ "textAlign": "right", "color": "#F4F5EF", "fontWeight": "600" }}>1.6 kWh</span></div></div></div>
          <div className="cell" style={{ "gridColumn": "span 5", "background": "#EAF3DA", "color": "#13241A" }}>
            <h3 className="dsp">Ranges, not false precision</h3>
            <p style={{ "color": "#2E3F33" }}>Each figure has a minimum, midpoint and maximum, because providers do not publish everything. Your reports state the scenario they use.</p>
            <div style={{ "marginTop": "auto", "display": "flex", "flexDirection": "column", "gap": "10px" }}>
              <div style={{ "display": "flex", "justifyContent": "space-between", "fontSize": "13px", "color": "#2E3F33" }}>
                <span>Minimum</span>
                <span>Midpoint</span>
                <span>Maximum</span></div><div style={{ "height": "10px", "borderRadius": "5px", "background": "linear-gradient(90deg, #2E6B3F, #8DBB6E 50%, #BFD99A)" }} />
              <div className="num" style={{ "display": "flex", "justifyContent": "space-between", "fontSize": "20px", "fontWeight": "700" }}>
                <span>31.6</span>
                <span>45.8</span>
                <span>60.0 kWh</span></div></div></div>
          <div className="cell" style={{ "gridColumn": "span 4", "background": "#FFFFFF", "border": "1px solid #DCE2D6" }}>
            <span className="ico" style={{ "background": "#E3F0E1", "color": "#1F5A2E" }}>
              <svg className="i" viewBox="0 0 24 24"><path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c1-3.6 3.5-5.5 6.5-5.5s5.5 1.9 6.5 5.5M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.8c1.7.7 2.9 2.4 3.5 5.2" /></svg></span>
            <h3 className="dsp">Organization figures, for administrators</h3>
            <p style={{ "color": "#4A5A4E" }}>Administrators see totals for the whole organization, never one person's usage. Members see their own figures and, if you choose, the organization's totals.</p></div>
          <div className="cell" style={{ "gridColumn": "span 4", "background": "#F4F5EF", "border": "1px solid #DCE2D6" }}>
            <span className="ico" style={{ "background": "#FFFFFF", "color": "#1F5A2E", "border": "1px solid #DCE2D6" }}>
              <svg className="i" viewBox="0 0 24 24"><path d="M14 3H6v18h12V7l-4-4zM14 3v4h4M9 13h6M9 17h6" /></svg></span>
            <h3 className="dsp">Exports for reporting</h3>
            <p style={{ "color": "#4A5A4E" }}>A CSV for any date range, with units, coverage and all three scenarios in every row.</p></div>
          <div className="cell" style={{ "gridColumn": "span 4", "background": "#FFFFFF", "border": "1px solid #DCE2D6" }}>
            <span className="ico" style={{ "background": "#E3F0E1", "color": "#1F5A2E" }}>
              <svg className="i" viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg></span>
            <h3 className="dsp">Policies you decide</h3>
            <p style={{ "color": "#4A5A4E" }}>Whether people can pause, who sees totals, your time zone and how long usage is kept.</p></div></div></section>
      <section style={{ "background": "#FFFFFF", "borderTop": "1px solid #DCE2D6", "borderBottom": "1px solid #DCE2D6" }}>
        <div className="wrap mx" style={{ "paddingTop": "104px", "paddingBottom": "104px" }}>
          <div style={{ "display": "flex", "flexDirection": "column", "gap": "20px" }}>
            <span className="eyebrow">Method</span>
            <h2 className="dsp h2x">An open method you can check</h2>
            <p className="lead" style={{ "maxWidth": "520px" }}>The estimates follow EcoLogits, an open methodology for the energy and emissions of AI models. Every equation, parameter and limit is published.</p>
            <a href="/methodology" style={{ "display": "inline-flex", "alignItems": "center", "gap": "8px", "fontSize": "16px", "fontWeight": "600", "textDecoration": "none" }}>
              <svg className="i" viewBox="0 0 24 24" style={{ "width": "18px", "height": "18px" }}><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5zM4 19a2 2 0 0 1 2-2h13" /></svg>Read the methodology
              <svg className="i" viewBox="0 0 24 24" style={{ "width": "16px", "height": "16px" }}><path d="M5 12h14M13 6l6 6-6 6" /></svg></a></div>
          <div style={{ "borderRadius": "22px", "border": "1px solid #DCE2D6", "background": "#F4F5EF", "padding": "26px 28px" }}>
            <span style={{ "fontSize": "14px", "fontWeight": "600", "color": "#4A5A4E" }}>One 1,000-token answer from a large model</span>
            <div style={{ "marginTop": "10px" }}>
              <div className="wx">
                <span style={{ "fontSize": "14px", "fontWeight": "600", "color": "#8A5A00" }}>Electricity</span>
                <b className="dsp num" style={{ "fontSize": "30px" }}>3.2 to 6.0 Wh</b>
                <span style={{ "fontSize": "13px", "color": "#4A5A4E" }}>a 10 W LED for 19 to 36 minutes</span></div>
              <div className="wx">
                <span style={{ "fontSize": "14px", "fontWeight": "600", "color": "#4A5A4E" }}>Carbon</span>
                <b className="dsp num" style={{ "fontSize": "30px" }}>1.2 to 2.3 g CO
                  <sub style={{ "fontSize": "15px" }}>2</sub>e</b>
                <span style={{ "fontSize": "13px", "color": "#4A5A4E" }}>on the US grid</span></div>
              <div className="wx">
                <span style={{ "fontSize": "14px", "fontWeight": "600", "color": "#1D4F80" }}>Water</span>
                <b className="dsp num" style={{ "fontSize": "30px" }}>10 to 24 mL</b>
                <span style={{ "fontSize": "13px", "color": "#4A5A4E" }}>for cooling and power</span></div></div>
            <span style={{ "display": "block", "marginTop": "14px", "fontSize": "13px", "color": "#4A5A4E" }}>Worked example for Claude Opus 5.5 from the methodology.</span></div></div></section>
      <section className="wrap" style={{ "paddingTop": "112px", "paddingBottom": "104px", "display": "flex", "flexDirection": "column", "gap": "32px" }}>
        <h2 className="dsp h2x">Numbers only. Never the conversation.</h2>
        <div className="gx">
          <div style={{ "borderRadius": "22px", "background": "#FFFFFF", "border": "1px solid #DCE2D6", "padding": "26px", "display": "flex", "flexDirection": "column", "gap": "16px" }}>
            <b style={{ "fontSize": "17px" }}>Your organization receives</b>
            <div className="lst">
              <span className="li2">
                <svg className="i" viewBox="0 0 24 24" style={{ "width": "17px", "height": "17px", "marginTop": "2px", "color": "#2E6B3F" }}><path d="m5 12 5 5 9-10" /></svg>Token counts and the estimates</span>
              <span className="li2">
                <svg className="i" viewBox="0 0 24 24" style={{ "width": "17px", "height": "17px", "marginTop": "2px", "color": "#2E6B3F" }}><path d="m5 12 5 5 9-10" /></svg>Tools and models used</span>
              <span className="li2">
                <svg className="i" viewBox="0 0 24 24" style={{ "width": "17px", "height": "17px", "marginTop": "2px", "color": "#2E6B3F" }}><path d="m5 12 5 5 9-10" /></svg>Request times</span>
              <span className="li2">
                <svg className="i" viewBox="0 0 24 24" style={{ "width": "17px", "height": "17px", "marginTop": "2px", "color": "#2E6B3F" }}><path d="m5 12 5 5 9-10" /></svg>How much of each reply could be measured</span></div></div>
          <div style={{ "borderRadius": "22px", "background": "#0F2A1C", "color": "#F4F5EF", "padding": "26px", "display": "flex", "flexDirection": "column", "gap": "16px" }}>
            <b style={{ "fontSize": "17px" }}>Never sent to us or your organization</b>
            <div className="lst">
              <span className="li2" style={{ "color": "#DDE8DF" }}>
                <svg className="i" viewBox="0 0 24 24" style={{ "width": "17px", "height": "17px", "marginTop": "2px", "color": "#B9E27C" }}><path d="M6 6l12 12M18 6 6 18" /></svg>Prompts, answers or thinking text</span>
              <span className="li2" style={{ "color": "#DDE8DF" }}>
                <svg className="i" viewBox="0 0 24 24" style={{ "width": "17px", "height": "17px", "marginTop": "2px", "color": "#B9E27C" }}><path d="M6 6l12 12M18 6 6 18" /></svg>Retrieved passages or source links</span>
              <span className="li2" style={{ "color": "#DDE8DF" }}>
                <svg className="i" viewBox="0 0 24 24" style={{ "width": "17px", "height": "17px", "marginTop": "2px", "color": "#B9E27C" }}><path d="M6 6l12 12M18 6 6 18" /></svg>Documents, file names or chat titles</span>
              <span className="li2" style={{ "color": "#DDE8DF" }}>
                <svg className="i" viewBox="0 0 24 24" style={{ "width": "17px", "height": "17px", "marginTop": "2px", "color": "#B9E27C" }}><path d="M6 6l12 12M18 6 6 18" /></svg>The site's own chat or message ids</span>
              <span className="li2" style={{ "color": "#DDE8DF" }}>
                <svg className="i" viewBox="0 0 24 24" style={{ "width": "17px", "height": "17px", "marginTop": "2px", "color": "#B9E27C" }}><path d="M6 6l12 12M18 6 6 18" /></svg>Passwords, cookies or sign-in tokens</span>
              <span className="li2" style={{ "color": "#DDE8DF" }}>
                <svg className="i" viewBox="0 0 24 24" style={{ "width": "17px", "height": "17px", "marginTop": "2px", "color": "#B9E27C" }}><path d="M6 6l12 12M18 6 6 18" /></svg>Unrelated browsing history</span></div></div></div>
        <div style={{ "display": "grid", "gridTemplateColumns": "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", "gap": "16px" }}>
          <span className="fact">
            <svg className="i" viewBox="0 0 24 24" style={{ "width": "20px", "height": "20px", "color": "#2E6B3F" }}><path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c1-3.6 3.5-5.5 6.5-5.5s5.5 1.9 6.5 5.5M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.8c1.7.7 2.9 2.4 3.5 5.2" /></svg>
            <span>Members see organization totals only if you turn sharing on. In a small team, organization totals can show one person's usage, for administrators too.</span></span>
          <a className="fact" href="/dpa">
            <svg className="i" viewBox="0 0 24 24" style={{ "width": "20px", "height": "20px", "color": "#2E6B3F" }}><path d="M7 3h7l5 5v13H7zM14 3v5h5" /></svg>
            <span>A data processing agreement under GDPR for every organization.</span></a>
          <a className="fact" href="/self-host">
            <svg className="i" viewBox="0 0 24 24" style={{ "width": "20px", "height": "20px", "color": "#2E6B3F" }}><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 7.5h.01M7 16.5h.01" /></svg>
            <span>Prefer your own servers? Run it yourself; the code is open source.</span></a></div></section>
      <section style={{ "background": "#FFFFFF", "borderTop": "1px solid #DCE2D6" }}>
        <div className="wrap" style={{ "paddingTop": "104px", "paddingBottom": "104px", "display": "flex", "flexDirection": "column", "gap": "44px" }}>
          <h2 className="dsp h2x">From sign-up to the first totals</h2>
          <div className="tl">
            <div className="tls">
              <span className="tld dsp" style={{ "fontWeight": "800" }}>1</span>
              <h3 className="dsp">Register your organization</h3>
              <p className="p">An administrator signs up with a work email and sets the policies.</p></div>
            <div className="tls">
              <span className="tld dsp" style={{ "fontWeight": "800" }}>2</span>
              <h3 className="dsp">Members connect</h3>
              <p className="p">Each person installs the extension and connects it with their work email and a code sent to it.</p></div>
            <div className="tls">
              <span className="tld dsp" style={{ "fontWeight": "800" }}>3</span>
              <h3 className="dsp">Read the totals</h3>
              <p className="p">Overview, tools and models, a monthly recap and exports, updated as people work.</p></div></div></div></section>
      <section className="wrap" style={{ "paddingTop": "24px", "paddingBottom": "104px" }}>
        <div style={{ "borderRadius": "28px", "background": "#0F2A1C", "color": "#F4F5EF", "padding": "clamp(32px, 5vw, 64px)", "display": "grid", "gridTemplateColumns": "minmax(0, 1.3fr) minmax(0, 1fr)", "gap": "32px", "alignItems": "center" }} className="mx">
          <div style={{ "display": "flex", "flexDirection": "column", "gap": "14px" }}>
            <h2 className="dsp h2x" style={{ "color": "#F4F5EF" }}>Start with your own team.</h2>
            <p style={{ "margin": "0", "fontSize": "18px", "lineHeight": "28px", "color": "#DDE8DF", "maxWidth": "560px" }}>Free for organizations of up to 50 members, with no time limit. A larger organization?{" "}
              <a href="/contact" style={{ "color": "#B9E27C", "fontWeight": "600" }}>Contact us</a>.</p></div>
          <div style={{ "display": "flex", "flexWrap": "wrap", "gap": "12px", "justifyContent": "flex-end" }}>
            <a className="btn" href="/register" style={{ "height": "54px", "padding": "0 26px", "fontSize": "16px", "background": "#B9E27C", "color": "#0F2A1C" }}>Set up your organization
              <svg className="i" viewBox="0 0 24 24" style={{ "width": "17px", "height": "17px" }}><path d="M5 12h14M13 6l6 6-6 6" /></svg></a></div></div></section>
    </>
  );
}
