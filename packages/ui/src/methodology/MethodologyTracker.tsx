// Generated from the canvas board Methodology (board2jsx), then wired. The copy follows the board.
// The default React import keeps this module working under the classic JSX transform, as in icons.tsx.
import React, { useState, type ReactNode } from "react";
import type { MethodologyLinks } from "./links";

// Each citation names the numbered source it supports.
const CITES: Record<string, number> = {"k1":2,"k2":13,"k3":2,"k4":2,"k5":12,"k6":5,"k7":3,"k8":6,"k9":1,"k10":2,"k11":10,"k12":11,"k13":12,"k14":4,"k15":1,"k16":1};

export function MethodologyTracker({ links, bar, credit, reference }: { links: MethodologyLinks; bar: ReactNode; credit: boolean; reference: ReactNode }) {
  const [cite, setCite] = useState("");
  const pick = (key: string) => setCite((open) => (open === key ? "" : key));
  const mark = (key: string) => (cite === key ? "#FFE9A8" : "transparent");
  const source = (n: number) => (CITES[cite] === n ? "#FFF1CC" : "transparent");
  return (
    <>
      {bar}
      <header style={{ "background": "#0F2A1C", "color": "#F4F5EF", "padding": "clamp(36px, 5vw, 64px) clamp(16px, 4vw, 56px) clamp(32px, 4vw, 48px)", "position": "relative", "overflow": "hidden" }}><div style={{ "position": "absolute", "right": "-120px", "top": "-140px", "width": "520px", "height": "520px", "borderRadius": "50%", "border": "64px solid rgba(185,226,124,.06)" }} />
        <div style={{ "maxWidth": "1160px", "margin": "0 auto", "display": "flex", "flexDirection": "column", "gap": "22px", "position": "relative" }}>
          <span style={{ "fontSize": "14px", "fontWeight": "600", "color": "#B9CDBE" }}>Methodology · updated 21 October 2026 · EcoLogits 0.11.2</span>
          <h1 className="mth-dsp" style={{ "margin": "0", "fontSize": "clamp(40px, 6vw, 64px)", "lineHeight": "1.04", "fontWeight": "700", "letterSpacing": "-0.02em", "maxWidth": "900px" }}>How we estimate the footprint of your AI chats</h1>
          <p style={{ "margin": "0", "fontSize": "20px", "lineHeight": "31px", "color": "#DDE8DF", "maxWidth": "760px" }}>The tracker counts the text that you and the AI write. It finds the model that answered. Then it uses EcoLogits, an open-source method, to calculate electricity, carbon and water. Plain words come first. The equations come after.</p>
          <div style={{ "padding": "22px 24px", "borderRadius": "18px", "background": "rgba(185,226,124,.10)", "border": "1px solid rgba(185,226,124,.40)", "display": "flex", "flexWrap": "wrap", "gap": "18px 32px", "alignItems": "center", "justifyContent": "space-between" }}>
            <div style={{ "flex": "1 1 420px", "display": "flex", "gap": "16px", "alignItems": "flex-start" }}>
              <span style={{ "flex": "none", "width": "44px", "height": "44px", "borderRadius": "12px", "background": "#B9E27C", "color": "#0F2A1C", "display": "grid", "placeItems": "center" }}>
                <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "width": "22px", "height": "22px" }}><path d="M12 3 4 7v5c0 4.5 3.4 8.2 8 9 4.6-.8 8-4.5 8-9V7l-8-4z" /><path d="m9 12 2 2 4-4" /></svg></span>
              <div style={{ "display": "flex", "flexDirection": "column", "gap": "6px" }}>
                <b className="mth-dsp" style={{ "fontSize": "22px", "lineHeight": "28px", "color": "#F4F5EF" }}>Built on the EcoLogits methodology</b>
                <span style={{ "fontSize": "15px", "lineHeight": "23px", "color": "#DDE8DF" }}>All electricity, carbon and water figures use the calculations and parameters of EcoLogits 0.11.2, an open-source project. The tracker adds two things: it counts the tokens in your browser, and it finds the EcoLogits record for each reply.</span></div></div>
            <div style={{ "display": "flex", "flexWrap": "wrap", "gap": "10px" }}>
              <a href="https://ecologits.ai" target="_blank" rel="noopener noreferrer" style={{ "height": "42px", "padding": "0 16px", "borderRadius": "12px", "display": "inline-flex", "alignItems": "center", "gap": "8px", "fontSize": "15px", "fontWeight": "600", "textDecoration": "none", "background": "#B9E27C", "color": "#0F2A1C" }}>ecologits.ai
                <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "width": "14px", "height": "14px" }}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg></a>
              <a href="https://github.com/mlco2/ecologits" target="_blank" rel="noopener noreferrer" style={{ "height": "42px", "padding": "0 16px", "borderRadius": "12px", "display": "inline-flex", "alignItems": "center", "gap": "8px", "fontSize": "15px", "fontWeight": "600", "textDecoration": "none", "border": "1px solid rgba(244,245,239,.35)", "color": "#F4F5EF" }}>EcoLogits on GitHub
                <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "width": "14px", "height": "14px" }}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg></a>
              <a href={links.repository} target="_blank" rel="noopener noreferrer" style={{ "height": "42px", "padding": "0 16px", "borderRadius": "12px", "display": "inline-flex", "alignItems": "center", "gap": "8px", "fontSize": "15px", "fontWeight": "600", "textDecoration": "none", "border": "1px solid rgba(244,245,239,.35)", "color": "#F4F5EF" }}>Tracker source code on GitHub
                <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "width": "14px", "height": "14px" }}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg></a></div></div></div></header>
      <nav aria-label="Parts of the methodology" style={{ "background": "#F4F5EF", "borderBottom": "1px solid #DCE2D6" }}>
        <div style={{ "maxWidth": "1160px", "margin": "0 auto", "padding": "12px clamp(16px, 4vw, 56px)", "display": "flex", "flexWrap": "wrap", "gap": "10px" }}>
          <a className="mth-tab" href={links.part1} aria-current="page">
            <small>Part 1</small>
            <b>What the tracker adds to EcoLogits</b>
            <span>Questions and answers, and why</span></a>
          <a className="mth-tab" href={links.part2}>
            <small>Part 2</small>
            <b>How EcoLogits calculates</b>
            <span>Each equation, step by step</span></a></div></nav>
      <div style={{ "maxWidth": "1160px", "margin": "0 auto", "padding": "36px clamp(16px, 4vw, 56px) 56px", "display": "flex", "flexWrap": "wrap", "gap": "48px", "alignItems": "flex-start" }}>
        <nav aria-label="On this page" style={{ "flex": "1 1 220px", "maxWidth": "260px", "display": "flex", "flexDirection": "column", "gap": "2px", "position": "sticky", "top": "16px" }}>
          <span style={{ "fontSize": "13px", "fontWeight": "600", "color": "#4A5A4E", "padding": "0 10px 8px" }}>On this page</span>
          <a className="mth-toc" href="#m-minute">
            <span className="mth-tn">01</span>In one minute</a>
          <a className="mth-toc" href="#m-adds">
            <span className="mth-tn">02</span>What the tracker adds</a>
          <a className="mth-toc mth-sub" href="#m-tokens">
            <span className="mth-tn">2.1</span>Tokens</a>
          <a className="mth-toc mth-sub" href="#m-model">
            <span className="mth-tn">2.2</span>The model</a>
          <a className="mth-toc mth-sub" href="#m-time">
            <span className="mth-tn">2.3</span>Time, ranges and location</a>
          <a className="mth-toc mth-sub" href="#m-media">
            <span className="mth-tn">2.4</span>Images, speech and video</a>
          <a className="mth-toc mth-sub" href="#m-gaps">
            <span className="mth-tn">2.5</span>Gaps and older chats</a>
          <a className="mth-toc" href="#m-excluded">
            <span className="mth-tn">03</span>What is not included</a>
          <a className="mth-toc" href="#m-privacy">
            <span className="mth-tn">04</span>Privacy</a>
          <a className="mth-toc" href="#m-sources">
            <span className="mth-tn">05</span>Sources</a>
          <a className="mth-toc" href={links.part2} style={{ "marginTop": "12px", "border": "1px solid #DCE2D6", "fontWeight": "600" }}>
            <span className="mth-tn">→</span>Part 2: How EcoLogits calculates</a></nav>
        <article style={{ "flex": "999 1 560px", "minWidth": "0", "maxWidth": "860px", "display": "flex", "flexDirection": "column", "gap": "36px" }}>
          <section id="m-minute" className="mth-sec">
            <h2 className="mth-dsp mth-h2">In one minute</h2>
            <div style={{ "display": "flex", "flexWrap": "wrap", "gap": "10px", "alignItems": "stretch" }}>
              <div className="mth-card" style={{ "flex": "1 1 130px", "padding": "16px", "display": "flex", "flexDirection": "column", "gap": "8px" }}>
                <span style={{ "display": "flex", "justifyContent": "space-between", "alignItems": "center" }}>
                  <span className="mth-dsp" style={{ "fontSize": "28px", "fontWeight": "700", "color": "#5A9654" }}>1</span>
                  <span className="mth-own" style={{ "background": "#E3F0E1", "color": "#1F5A2E" }}>Tracker</span></span>
                <b style={{ "fontSize": "16px" }}>Count</b>
                <span style={{ "fontSize": "14px", "lineHeight": "20px" }} className="mth-muted">The tracker counts the tokens in your message, your files and the AI's reply.</span></div>
              <div style={{ "display": "grid", "placeItems": "center", "color": "#9DB394" }}>
                <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg></div>
              <div className="mth-card" style={{ "flex": "1 1 130px", "padding": "16px", "display": "flex", "flexDirection": "column", "gap": "8px" }}>
                <span style={{ "display": "flex", "justifyContent": "space-between", "alignItems": "center" }}>
                  <span className="mth-dsp" style={{ "fontSize": "28px", "fontWeight": "700", "color": "#5A9654" }}>2</span>
                  <span className="mth-own" style={{ "background": "#E3F0E1", "color": "#1F5A2E" }}>Tracker</span></span>
                <b style={{ "fontSize": "16px" }}>Identify</b>
                <span style={{ "fontSize": "14px", "lineHeight": "20px" }} className="mth-muted">The tracker reads the name of the model that answered, for example Claude Opus 5.5.</span></div>
              <div style={{ "display": "grid", "placeItems": "center", "color": "#9DB394" }}>
                <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg></div>
              <div className="mth-card" style={{ "flex": "1 1 130px", "padding": "16px", "display": "flex", "flexDirection": "column", "gap": "8px" }}>
                <span style={{ "display": "flex", "justifyContent": "space-between", "alignItems": "center" }}>
                  <span className="mth-dsp" style={{ "fontSize": "28px", "fontWeight": "700", "color": "#5A9654" }}>3</span>
                  <span className="mth-own" style={{ "background": "#E7EFF8", "color": "#1D4F80" }}>EcoLogits</span></span>
                <b style={{ "fontSize": "16px" }}>Electricity</b>
                <span style={{ "fontSize": "14px", "lineHeight": "20px" }} className="mth-muted">EcoLogits calculates the energy that the servers used to write the reply.</span></div>
              <div style={{ "display": "grid", "placeItems": "center", "color": "#9DB394" }}>
                <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg></div>
              <div className="mth-card" style={{ "flex": "1 1 130px", "padding": "16px", "display": "flex", "flexDirection": "column", "gap": "8px" }}>
                <span style={{ "display": "flex", "justifyContent": "space-between", "alignItems": "center" }}>
                  <span className="mth-dsp" style={{ "fontSize": "28px", "fontWeight": "700", "color": "#5A9654" }}>4</span>
                  <span className="mth-own" style={{ "background": "#E7EFF8", "color": "#1D4F80" }}>EcoLogits</span></span>
                <b style={{ "fontSize": "16px" }}>Carbon and water</b>
                <span style={{ "fontSize": "14px", "lineHeight": "20px" }} className="mth-muted">EcoLogits converts the electricity into carbon and water for the provider's data centres.</span></div></div>
            <div style={{ "display": "flex", "flexWrap": "wrap", "gap": "10px" }}>
              <a href="#m-adds" className="mth-note" style={{ "flex": "1 1 280px", "textDecoration": "none" }}>
                <span className="mth-own" style={{ "background": "#FFFFFF", "color": "#1F5A2E" }}>Tracker</span>
                <span>The tracker does steps 1 and 2. Part 1, on this page, explains how and why.</span></a>
              <a href={links.part2} className="mth-note" style={{ "flex": "1 1 280px", "textDecoration": "none", "background": "#E7EFF8", "color": "#1D3A5C" }}>
                <span className="mth-own" style={{ "background": "#FFFFFF", "color": "#1D4F80" }}>EcoLogits</span>
                <span>Steps 3 and 4 use the EcoLogits equations. Part 2 shows each equation.</span></a></div>
            <p className="mth-p">Most AI providers do not publish the size of their models. So each result is a range. In Settings, you choose which value you see: Minimum, Midpoint or Maximum. Your choice applies to all parts of the tracker.</p>
            {/* Two basic terms for readers who are new to AI. They have no Q number, because the flow boxes and Part 2 point to Q1 to Q21. */}
            <details className="mth-qa" open>
              <summary>
                <span className="mth-qm" aria-hidden="true">?</span>
                <span style={{ "flex": "1" }}>What is a token?</span>
                <svg className="mth-i mth-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg></summary>
              <div className="mth-ans">
                <p>A token is a small piece of text: a short word, a part of a longer word, a number or a punctuation mark. AI models read and write text as tokens. The tokens that the model writes are its output tokens. The more output tokens a reply has, the more energy it uses.</p></div></details>
            <details className="mth-qa">
              <summary>
                <span className="mth-qm" aria-hidden="true">?</span>
                <span style={{ "flex": "1" }}>What is a tokenizer?</span>
                <svg className="mth-i mth-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg></summary>
              <div className="mth-ans">
                <p>A tokenizer is the program that splits text into tokens. Different AI models can use different tokenizers, so the same text can give a different number of tokens. The tracker uses one tokenizer for all sites: o200k_base, which OpenAI uses for its recent models. Claude's own tokenizer makes more tokens from the same text, so for Claude the tracker multiplies the count by 1.56 (measured on 15 October 2026). Q1 below tells why.</p></div></details></section>
          <section id="m-adds" className="mth-sec">
            <span className="mth-kick">Part 1</span>
            <h2 className="mth-dsp mth-h2">What the tracker adds to EcoLogits</h2>
            <p className="mth-p">EcoLogits calculates the footprint of one request to an AI model.{" "}
              <span className="mth-cs" style={{ background: mark("k1") }}>For this calculation, it needs the number of output tokens, the model and, if possible, the time of the request.</span>
              <button className="mth-ct" data-cite="k1" type="button" onClick={() => pick("k1")} aria-pressed={cite === "k1"} aria-label="Source 2">2</button> A chat website does not give these values directly. The tracker gets them from the page. This part explains how, and why we made each choice.</p>
            {cite === "k1" && (
            <>
              <div className="mth-scard" role="note">
                <span className="mth-scn">2</span>
                <div style={{ "flex": "1", "minWidth": "0", "display": "flex", "flexDirection": "column", "gap": "3px" }}>
                  <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#6E4700" }}>Source 2 · EcoLogits documentation</span>
                  <span style={{ "fontSize": "14px", "lineHeight": "20px" }}>LLM inference: energy, time and GPUs</span>
                  <span style={{ "fontSize": "13px", "color": "#4A5A4E" }}>It supports the text in yellow.</span>
                  <a href="https://ecologits.ai/0.11/methodology/llm_inference/" target="_blank" rel="noopener noreferrer" style={{ "alignSelf": "flex-start", "display": "inline-flex", "alignItems": "center", "gap": "6px", "fontSize": "14px", "fontWeight": "600" }}>Open the EcoLogits page
                    <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "width": "14px", "height": "14px" }}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg></a></div>
                <button className="mth-sclose" type="button" onClick={() => pick("k1")} aria-label="Close the source">×</button></div></>)}
            <div style={{ "display": "flex", "alignItems": "center", "gap": "10px", "padding": "12px 16px", "borderRadius": "14px", "background": "#FFF8E1", "border": "1px solid #F0D58A", "fontSize": "14px", "lineHeight": "20px", "color": "#4D3A00" }}>
              <span className="mth-ct" style={{ "verticalAlign": "baseline", "margin": "0", "cursor": "default" }}>2</span>
              <span>Select a source number to see its source. The text that it supports then shows in yellow.</span></div>
            <div style={{ "display": "flex", "flexDirection": "column", "gap": "8px" }}>
              <div className="mth-flow" style={{ "fontSize": "12px", "fontWeight": "800", "letterSpacing": ".05em", "textTransform": "uppercase", "color": "#4A5A4E" }}>
                <span>On the chat page</span><span />
                <span>What the tracker does</span><span />
                <span>What EcoLogits gets</span></div>
              <div className="mth-flow">
                <div className="mth-fbox" style={{ "background": "#F7F8F3" }}>
                  <b>Text of the reply</b>The main text, reasoning and tool text</div>
                <div className="mth-farr">
                  <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></div>
                <div className="mth-fbox" style={{ "background": "#E3F0E1", "borderColor": "#CFE6BD" }}>
                  <b>Counts the tokens</b>In your browser, see Q1 to Q7</div>
                <div className="mth-farr">
                  <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></div>
                <div className="mth-fbox" style={{ "background": "#E7EFF8", "borderColor": "#C9DAEE" }}>
                  <b>Output tokens{" "}
                    <i>n</i></b>The main value of the calculation</div></div>
              <div className="mth-flow">
                <div className="mth-fbox" style={{ "background": "#F7F8F3" }}>
                  <b>Model name</b>Sent by the site with each reply</div>
                <div className="mth-farr">
                  <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></div>
                <div className="mth-fbox" style={{ "background": "#E3F0E1", "borderColor": "#CFE6BD" }}>
                  <b>Finds the record</b>Or a stand-in, see Q8 to Q11</div>
                <div className="mth-farr">
                  <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></div>
                <div className="mth-fbox" style={{ "background": "#E7EFF8", "borderColor": "#C9DAEE" }}>
                  <b>Model record</b>Size and speed of the model</div></div>
              <div className="mth-flow">
                <div className="mth-fbox" style={{ "background": "#F7F8F3" }}>
                  <b>Start and end</b>Of each reply</div>
                <div className="mth-farr">
                  <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></div>
                <div className="mth-fbox" style={{ "background": "#E3F0E1", "borderColor": "#CFE6BD" }}>
                  <b>Measures the time</b>See Q12</div>
                <div className="mth-farr">
                  <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></div>
                <div className="mth-fbox" style={{ "background": "#E7EFF8", "borderColor": "#C9DAEE" }}>
                  <b>Time limit</b>An upper limit for the time</div></div>
              <div className="mth-flow">
                <div className="mth-fbox" style={{ "background": "#F7F8F3" }}>
                  <b>Provider</b>Anthropic, OpenAI, Google</div>
                <div className="mth-farr">
                  <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></div>
                <div className="mth-fbox" style={{ "background": "#E3F0E1", "borderColor": "#CFE6BD" }}>
                  <b>Uses EcoLogits values</b>With one exception, see Q14</div>
                <div className="mth-farr">
                  <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></div>
                <div className="mth-fbox" style={{ "background": "#E7EFF8", "borderColor": "#C9DAEE" }}>
                  <b>PUE, WUE, grid</b>Data-centre settings</div></div></div></section>
          <section id="m-tokens" className="mth-sec">
            <span className="mth-kick">2.1</span>
            <h2 className="mth-dsp mth-h2">Tokens</h2>
            <details className="mth-qa" open>
              <summary>
                <span className="mth-qm">Q1</span>
                <span style={{ "flex": "1" }}>Which tokenizer does the tracker use?</span>
                <svg className="mth-i mth-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg></summary>
              <div className="mth-ans">
                <p>
                  <span className="mth-cs" style={{ background: mark("k2") }}>The tracker uses one tokenizer for all sites: the o200k_base encoding of the open-source library gpt-tokenizer.</span>
                  <button className="mth-ct" data-cite="k2" type="button" onClick={() => pick("k2")} aria-pressed={cite === "k2"} aria-label="Source 13">13</button> OpenAI uses this encoding for its recent models. For Claude, Gemini, NotebookLM and Perplexity, the tracker has no tokenizer that runs in the browser. So it uses o200k_base for them too. Details marks these counts as estimates.</p>
                {cite === "k2" && (
                <>
                  <div className="mth-scard" role="note">
                    <span className="mth-scn">13</span>
                    <div style={{ "flex": "1", "minWidth": "0", "display": "flex", "flexDirection": "column", "gap": "3px" }}>
                      <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#6E4700" }}>Source 13 · Open-source library</span>
                      <span style={{ "fontSize": "14px", "lineHeight": "20px" }}>gpt-tokenizer, o200k_base encoding, MIT licence</span>
                      <span style={{ "fontSize": "13px", "color": "#4A5A4E" }}>It supports the text in yellow.</span>
                      <a href="https://github.com/niieani/gpt-tokenizer" target="_blank" rel="noopener noreferrer" style={{ "alignSelf": "flex-start", "display": "inline-flex", "alignItems": "center", "gap": "6px", "fontSize": "14px", "fontWeight": "600" }}>Open the library on GitHub
                        <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "width": "14px", "height": "14px" }}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg></a></div>
                    <button className="mth-sclose" type="button" onClick={() => pick("k2")} aria-label="Close the source">×</button></div></>)}
                <div className="mth-why">
                  <b>Why</b>
                  <span>The count must run in your browser, so your text stays on your device. o200k_base runs in the browser, and it is fast.</span></div></div></details>
            <details className="mth-qa">
              <summary>
                <span className="mth-qm">Q2</span>
                <span style={{ "flex": "1" }}>Does the tracker use the provider's own token counts?</span>
                <svg className="mth-i mth-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg></summary>
              <div className="mth-ans">
                <p>Yes, when the page shows them. At the moment, only some Claude pages give exact counts: Claude Cowork, and artifacts that call Claude. For these replies, the tracker uses the exact counts.</p>
                <div className="mth-why">
                  <b>Why</b>
                  <span>An exact count from the provider is better than an estimate.</span></div></div></details>
            <details className="mth-qa">
              <summary>
                <span className="mth-qm">Q3</span>
                <span style={{ "flex": "1" }}>Where does the count happen?</span>
                <svg className="mth-i mth-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg></summary>
              <div className="mth-ans">
                <p>In your browser, in a separate background process (a Web Worker). The tracker counts the text and does not keep it. It keeps only numbers, such as token counts and model names.</p>
                <div className="mth-why">
                  <b>Why</b>
                  <span>Your text stays private, and the chat page does not become slow.</span></div></div></details>
            <details className="mth-qa" open>
              <summary>
                <span className="mth-qm">Q4</span>
                <span style={{ "flex": "1" }}>What does the tracker count as output tokens?</span>
                <svg className="mth-i mth-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg></summary>
              <div className="mth-ans">
                <p>All text that the model writes:</p>
                <ul className="mth-list">
                  <li>The main text of the reply.</li>
                  <li>Visible reasoning text, for example a thinking summary.</li>
                  <li>Text that the AI writes into tools, files, artifacts and canvases.</li>
                  <li>Text that the AI writes between the steps of a task.</li></ul>
                <p>
                  <span className="mth-cs" style={{ background: mark("k3") }}>EcoLogits calculates the energy from the output tokens.</span>
                  <button className="mth-ct" data-cite="k3" type="button" onClick={() => pick("k3")} aria-pressed={cite === "k3"} aria-label="Source 2">2</button> Some tasks use more than one model, for example a research task. The tracker calculates the text of each helper model with that model's own record. The tracker does not count hidden reasoning, because the page does not show it.</p>
                {cite === "k3" && (
                <>
                  <div className="mth-scard" role="note">
                    <span className="mth-scn">2</span>
                    <div style={{ "flex": "1", "minWidth": "0", "display": "flex", "flexDirection": "column", "gap": "3px" }}>
                      <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#6E4700" }}>Source 2 · EcoLogits documentation</span>
                      <span style={{ "fontSize": "14px", "lineHeight": "20px" }}>LLM inference: energy, time and GPUs</span>
                      <span style={{ "fontSize": "13px", "color": "#4A5A4E" }}>It supports the text in yellow.</span>
                      <a href="https://ecologits.ai/0.11/methodology/llm_inference/" target="_blank" rel="noopener noreferrer" style={{ "alignSelf": "flex-start", "display": "inline-flex", "alignItems": "center", "gap": "6px", "fontSize": "14px", "fontWeight": "600" }}>Open the EcoLogits page
                        <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "width": "14px", "height": "14px" }}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg></a></div>
                    <button className="mth-sclose" type="button" onClick={() => pick("k3")} aria-label="Close the source">×</button></div></>)}
                <div className="mth-why">
                  <b>Why</b>
                  <span>All text that a model writes uses energy, not only the main text. An estimate of hidden reasoning from the reply time would not be accurate.</span></div></div></details>
            <details className="mth-qa" open>
              <summary>
                <span className="mth-qm">Q5</span>
                <span style={{ "flex": "1" }}>Why do input tokens not change the electricity?</span>
                <svg className="mth-i mth-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg></summary>
              <div className="mth-ans">
                <p>
                  <span className="mth-cs" style={{ background: mark("k4") }}>The EcoLogits equations use the output tokens only. They do not use the length of your message.</span>
                  <button className="mth-ct" data-cite="k4" type="button" onClick={() => pick("k4")} aria-pressed={cite === "k4"} aria-label="Source 2">2</button> The tracker still counts the input: your new text, files, tool results and uploaded images. Details shows these counts. The tracker also adds the earlier messages of the chat. With this total, it tells you when a chat becomes very long.</p>
                {cite === "k4" && (
                <>
                  <div className="mth-scard" role="note">
                    <span className="mth-scn">2</span>
                    <div style={{ "flex": "1", "minWidth": "0", "display": "flex", "flexDirection": "column", "gap": "3px" }}>
                      <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#6E4700" }}>Source 2 · EcoLogits documentation</span>
                      <span style={{ "fontSize": "14px", "lineHeight": "20px" }}>LLM inference: energy, time and GPUs</span>
                      <span style={{ "fontSize": "13px", "color": "#4A5A4E" }}>It supports the text in yellow.</span>
                      <a href="https://ecologits.ai/0.11/methodology/llm_inference/" target="_blank" rel="noopener noreferrer" style={{ "alignSelf": "flex-start", "display": "inline-flex", "alignItems": "center", "gap": "6px", "fontSize": "14px", "fontWeight": "600" }}>Open the EcoLogits page
                        <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "width": "14px", "height": "14px" }}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg></a></div>
                    <button className="mth-sclose" type="button" onClick={() => pick("k4")} aria-label="Close the source">×</button></div></>)}
                <div className="mth-why">
                  <b>Why</b>
                  <span>The tracker uses the EcoLogits method without change. It does not add a factor for input that EcoLogits does not use.</span></div></div></details>
            <details className="mth-qa">
              <summary>
                <span className="mth-qm">Q6</span>
                <span style={{ "flex": "1" }}>How does the tracker count uploaded images?</span>
                <svg className="mth-i mth-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg></summary>
              <div className="mth-ans">
                <p>It uses the image rules that each provider publishes. These rules convert the size of an image into tokens.{" "}
                  <span className="mth-cs" style={{ background: mark("k5") }}>For example, Gemini 3 counts 1,120 tokens for each image.</span>
                  <button className="mth-ct" data-cite="k5" type="button" onClick={() => pick("k5")} aria-pressed={cite === "k5"} aria-label="Source 12">12</button></p>
                {cite === "k5" && (
                <>
                  <div className="mth-scard" role="note">
                    <span className="mth-scn">12</span>
                    <div style={{ "flex": "1", "minWidth": "0", "display": "flex", "flexDirection": "column", "gap": "3px" }}>
                      <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#6E4700" }}>Source 12 · Provider documentation</span>
                      <span style={{ "fontSize": "14px", "lineHeight": "20px" }}>Google: Gemini API media resolution. 1,120 tokens for each image (Gemini 3), 25 tokens for each second of audio</span>
                      <span style={{ "fontSize": "13px", "color": "#4A5A4E" }}>It supports the text in yellow.</span>
                      <a href="https://ai.google.dev/gemini-api/docs/media-resolution" target="_blank" rel="noopener noreferrer" style={{ "alignSelf": "flex-start", "display": "inline-flex", "alignItems": "center", "gap": "6px", "fontSize": "14px", "fontWeight": "600" }}>Open the Google page
                        <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "width": "14px", "height": "14px" }}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg></a></div>
                    <button className="mth-sclose" type="button" onClick={() => pick("k5")} aria-label="Close the source">×</button></div></>)}
                <div className="mth-why">
                  <b>Why</b>
                  <span>Images that you upload are input. Like all input, they do not change the electricity.</span></div></div></details>
            <details className="mth-qa">
              <summary>
                <span className="mth-qm">Q7</span>
                <span style={{ "flex": "1" }}>Does the cache count?</span>
                <svg className="mth-i mth-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg></summary>
              <div className="mth-ans">
                <p>No. Some providers keep earlier input in a cache and use it again. Cache tokens are input, so they do not change the EcoLogits estimate.</p></div></details></section>
          <section id="m-model" className="mth-sec">
            <span className="mth-kick">2.2</span>
            <h2 className="mth-dsp mth-h2">The model</h2>
            <details className="mth-qa" open>
              <summary>
                <span className="mth-qm">Q8</span>
                <span style={{ "flex": "1" }}>How does the tracker know which model wrote the reply?</span>
                <svg className="mth-i mth-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg></summary>
              <div className="mth-ans">
                <p>It reads the model name that the site sends with each reply. ChatGPT, Claude, Gemini and Perplexity send a model name. NotebookLM does not send one, so the tracker uses Gemini 3 Flash for NotebookLM. Details shows the model of each chat.</p>
                <div className="mth-why">
                  <b>Why</b>
                  <span>Each model uses a different amount of energy. The real model gives the best estimate.</span></div></div></details>
            <details className="mth-qa" open>
              <summary>
                <span className="mth-qm">Q9</span>
                <span style={{ "flex": "1" }}>What if EcoLogits has no record for the model?</span>
                <svg className="mth-i mth-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg></summary>
              <div className="mth-ans">
                <p>EcoLogits has records for many models, but not always for the newest ones. Then the tracker uses a stand-in, in this order:</p>
                <div style={{ "display": "flex", "flexDirection": "column", "gap": "6px" }}>
                  <div style={{ "display": "grid", "gridTemplateColumns": "minmax(0, 1fr) 34px minmax(0, 1.25fr)", "gap": "8px", "alignItems": "center" }}>
                    <div className="mth-fbox" style={{ "background": "#F7F8F3" }}>
                      <b>Does EcoLogits have a record for this model?</b></div>
                    <div className="mth-farr" style={{ "flexDirection": "column", "fontSize": "11px", "fontWeight": "800", "color": "#1F5A2E" }}>Yes
                      <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></div>
                    <div className="mth-fbox">
                      <span className="mth-own" style={{ "alignSelf": "flex-start", "background": "#E3F0E1", "color": "#1F5A2E" }}>Own record</span>
                      <b>Use the model's own record.</b></div></div>
                  <div style={{ "display": "flex", "alignItems": "center", "gap": "8px", "paddingLeft": "16px", "fontSize": "11px", "fontWeight": "800", "color": "#8A5A00" }}>
                    <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6" /></svg>No</div>
                  <div style={{ "display": "grid", "gridTemplateColumns": "minmax(0, 1fr) 34px minmax(0, 1.25fr)", "gap": "8px", "alignItems": "center" }}>
                    <div className="mth-fbox" style={{ "background": "#F7F8F3" }}>
                      <b>Is there a close record from the same family?</b></div>
                    <div className="mth-farr" style={{ "flexDirection": "column", "fontSize": "11px", "fontWeight": "800", "color": "#1F5A2E" }}>Yes
                      <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></div>
                    <div className="mth-fbox">
                      <span className="mth-own" style={{ "alignSelf": "flex-start", "background": "#EEF1E8", "color": "#2E3F33" }}>Similar model</span>
                      <b>Use it. If two records fit, use the larger one.</b>
                      <span className="mth-muted">Claude Opus 4.1 → Claude Opus 4.5 · GPT-5.6 Pro → GPT-6 Astra</span></div></div>
                  <div style={{ "display": "flex", "alignItems": "center", "gap": "8px", "paddingLeft": "16px", "fontSize": "11px", "fontWeight": "800", "color": "#8A5A00" }}>
                    <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6" /></svg>No</div>
                  <div className="mth-fbox" style={{ "marginLeft": "0" }}>
                    <span className="mth-own" style={{ "alignSelf": "flex-start", "background": "#FFF1CC", "color": "#6E4700" }}>Family estimate</span>
                    <b>Use the provider's benchmark model.</b>
                    <span className="mth-muted">OpenAI: GPT-6.1 Sol · Anthropic: Claude Opus 5.5 · Google: Gemini 3.8 Flash · all other providers: GPT-6.1 Sol</span></div></div>
                <p>Details shows the stand-in and the reason.</p>
                <div className="mth-why">
                  <b>Why</b>
                  <span>The tracker does not guess a new model size. It always uses a record that EcoLogits publishes, so you can check each figure. The larger of two records keeps the estimate from being too low.</span></div></div></details>
            <details className="mth-qa">
              <summary>
                <span className="mth-qm">Q10</span>
                <span style={{ "flex": "1" }}>What about Perplexity?</span>
                <svg className="mth-i mth-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg></summary>
              <div className="mth-ans">
                <p>Perplexity uses models from other providers. When Perplexity names the model, for example Claude Sonnet 5.5, the tracker uses that model's record. Perplexity modes that do not name a model, for example Best, Sonar and Deep research, use GPT-6.1 Sol.</p>
                <div className="mth-why">
                  <b>Why</b>
                  <span>Perplexity does not publish which model or model size these modes use. GPT-6.1 Sol is the tracker's general benchmark.</span></div></div></details>
            <details className="mth-qa">
              <summary>
                <span className="mth-qm">Q11</span>
                <span style={{ "flex": "1" }}>Does the tracker use a different method for an unknown model?</span>
                <svg className="mth-i mth-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg></summary>
              <div className="mth-ans">
                <p>No. The tracker uses only the EcoLogits method. It does not change to this project's old method. If no estimate is possible, the tracker shows that the figure is not available.</p>
                <div className="mth-why">
                  <b>Why</b>
                  <span>All figures then come from one method, so you can compare them.</span></div></div></details></section>
          <section id="m-time" className="mth-sec">
            <span className="mth-kick">2.3</span>
            <h2 className="mth-dsp mth-h2">Time, ranges and location</h2>
            <details className="mth-qa" open>
              <summary>
                <span className="mth-qm">Q12</span>
                <span style={{ "flex": "1" }}>Does the tracker use the real time of the reply?</span>
                <svg className="mth-i mth-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg></summary>
              <div className="mth-ans">
                <p>Yes, as an upper limit. The tracker measures the time from your request to the end of the reply. EcoLogits calculates the time from the model's speed.{" "}
                  <span className="mth-cs" style={{ background: mark("k6") }}>It then uses the shorter of the two times.</span>
                  <button className="mth-ct" data-cite="k6" type="button" onClick={() => pick("k6")} aria-pressed={cite === "k6"} aria-label="Source 5">5</button> A shorter time lowers the server part of the energy. It does not change the GPU part.</p>
                {cite === "k6" && (
                <>
                  <div className="mth-scard" role="note">
                    <span className="mth-scn">5</span>
                    <div style={{ "flex": "1", "minWidth": "0", "display": "flex", "flexDirection": "column", "gap": "3px" }}>
                      <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#6E4700" }}>Source 5 · EcoLogits code on GitHub</span>
                      <span style={{ "fontSize": "14px", "lineHeight": "20px" }}>impacts/llm.py, release 0.11.2: the equations and constants</span>
                      <span style={{ "fontSize": "13px", "color": "#4A5A4E" }}>It supports the text in yellow.</span>
                      <a href="https://github.com/mlco2/ecologits/blob/0.11.2/ecologits/impacts/llm.py" target="_blank" rel="noopener noreferrer" style={{ "alignSelf": "flex-start", "display": "inline-flex", "alignItems": "center", "gap": "6px", "fontSize": "14px", "fontWeight": "600" }}>Open the code on GitHub
                        <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "width": "14px", "height": "14px" }}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg></a></div>
                    <button className="mth-sclose" type="button" onClick={() => pick("k6")} aria-label="Close the source">×</button></div></>)}
                <div className="mth-why">
                  <b>Why</b>
                  <span>The measured time is real data. EcoLogits accepts it only as a limit, so it can never make the estimate higher.</span></div></div></details>
            <details className="mth-qa">
              <summary>
                <span className="mth-qm">Q13</span>
                <span style={{ "flex": "1" }}>What are Minimum, Midpoint and Maximum?</span>
                <svg className="mth-i mth-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg></summary>
              <div className="mth-ans">
                <p>
                  <span className="mth-cs" style={{ background: mark("k7") }}>Most AI providers do not publish the size of their models. So EcoLogits gives a range for each estimate.</span>
                  <button className="mth-ct" data-cite="k7" type="button" onClick={() => pick("k7")} aria-pressed={cite === "k7"} aria-label="Source 3">3</button> The tracker keeps both ends of the range. Minimum is the low end. Maximum is the high end. Midpoint is the average of the two. You choose one in Settings. The default is Midpoint. Totals add the same end of each estimate.</p>
                {cite === "k7" && (
                <>
                  <div className="mth-scard" role="note">
                    <span className="mth-scn">3</span>
                    <div style={{ "flex": "1", "minWidth": "0", "display": "flex", "flexDirection": "column", "gap": "3px" }}>
                      <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#6E4700" }}>Source 3 · EcoLogits documentation</span>
                      <span style={{ "fontSize": "14px", "lineHeight": "20px" }}>Proprietary models: parameter ranges</span>
                      <span style={{ "fontSize": "13px", "color": "#4A5A4E" }}>It supports the text in yellow.</span>
                      <a href="https://ecologits.ai/0.11/methodology/proprietary_models/" target="_blank" rel="noopener noreferrer" style={{ "alignSelf": "flex-start", "display": "inline-flex", "alignItems": "center", "gap": "6px", "fontSize": "14px", "fontWeight": "600" }}>Open the EcoLogits page
                        <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "width": "14px", "height": "14px" }}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg></a></div>
                    <button className="mth-sclose" type="button" onClick={() => pick("k7")} aria-label="Close the source">×</button></div></>)}
                <div className="mth-why">
                  <b>Why</b>
                  <span>The default does not show a footprint that is larger than the method supports. You can choose a higher end in Settings at any time.</span></div></div></details>
            <details className="mth-qa" open>
              <summary>
                <span className="mth-qm">Q14</span>
                <span style={{ "flex": "1" }}>Which electricity grid does the tracker use?</span>
                <svg className="mth-i mth-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg></summary>
              <div className="mth-ans">
                <p>
                  <span className="mth-cs" style={{ background: mark("k8") }}>The tracker uses the data-centre location that EcoLogits gives for each provider. For Anthropic, OpenAI and Google, this location is the United States.</span>
                  <button className="mth-ct" data-cite="k8" type="button" onClick={() => pick("k8")} aria-pressed={cite === "k8"} aria-label="Source 6">6</button> The tracker never uses your location. It also does not use the server region that ChatGPT sometimes shows.</p>
                <p>One exception: EcoLogits lists the GLM models under Mistral, with the grid of Sweden. For GLM models on Perplexity, the tracker uses the United States grid, a PUE of 1.09 to 1.14 and a WUE of 0.13 to 0.99.</p>
                {cite === "k8" && (
                <>
                  <div className="mth-scard" role="note">
                    <span className="mth-scn">6</span>
                    <div style={{ "flex": "1", "minWidth": "0", "display": "flex", "flexDirection": "column", "gap": "3px" }}>
                      <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#6E4700" }}>Source 6 · EcoLogits code on GitHub</span>
                      <span style={{ "fontSize": "14px", "lineHeight": "20px" }}>tracers/utils.py, release 0.11.2: location, PUE and WUE for each provider</span>
                      <span style={{ "fontSize": "13px", "color": "#4A5A4E" }}>It supports the text in yellow.</span>
                      <a href="https://github.com/mlco2/ecologits/blob/0.11.2/ecologits/tracers/utils.py" target="_blank" rel="noopener noreferrer" style={{ "alignSelf": "flex-start", "display": "inline-flex", "alignItems": "center", "gap": "6px", "fontSize": "14px", "fontWeight": "600" }}>Open the code on GitHub
                        <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "width": "14px", "height": "14px" }}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg></a></div>
                    <button className="mth-sclose" type="button" onClick={() => pick("k8")} aria-label="Close the source">×</button></div></>)}
                <div className="mth-why">
                  <b>Why</b>
                  <span>The location of the servers sets the carbon of the electricity. Your location does not change it. The EcoLogits record for GLM does not show where Perplexity runs these models, so the tracker uses the same grid as for the other Perplexity models.</span></div></div></details>
            <details className="mth-qa">
              <summary>
                <span className="mth-qm">Q15</span>
                <span style={{ "flex": "1" }}>Does the tracker include the manufacture of the hardware?</span>
                <svg className="mth-i mth-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg></summary>
              <div className="mth-ans">
                <p>No.{" "}
                  <span className="mth-cs" style={{ background: mark("k9") }}>EcoLogits also calculates a share of the manufacture of the servers and GPUs.</span>
                  <button className="mth-ct" data-cite="k9" type="button" onClick={() => pick("k9")} aria-pressed={cite === "k9"} aria-label="Source 1">1</button> The tracker does not show this share. It shows only use: the electricity to run the AI, and its carbon and water.</p>
                {cite === "k9" && (
                <>
                  <div className="mth-scard" role="note">
                    <span className="mth-scn">1</span>
                    <div style={{ "flex": "1", "minWidth": "0", "display": "flex", "flexDirection": "column", "gap": "3px" }}>
                      <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#6E4700" }}>Source 1 · EcoLogits documentation</span>
                      <span style={{ "fontSize": "14px", "lineHeight": "20px" }}>Methodology overview, release 0.11</span>
                      <span style={{ "fontSize": "13px", "color": "#4A5A4E" }}>It supports the text in yellow.</span>
                      <a href="https://ecologits.ai/0.11/methodology/" target="_blank" rel="noopener noreferrer" style={{ "alignSelf": "flex-start", "display": "inline-flex", "alignItems": "center", "gap": "6px", "fontSize": "14px", "fontWeight": "600" }}>Open the EcoLogits page
                        <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "width": "14px", "height": "14px" }}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg></a></div>
                    <button className="mth-sclose" type="button" onClick={() => pick("k9")} aria-label="Close the source">×</button></div></>)}
                <div className="mth-why">
                  <b>Why</b>
                  <span>Each figure then shows one thing: the energy of your requests. "What is not included" below lists the manufacture.</span></div></div></details></section>
          <section id="m-media" className="mth-sec">
            <span className="mth-kick">2.4</span>
            <h2 className="mth-dsp mth-h2">Images, speech and video</h2>
            <details className="mth-qa" open>
              <summary>
                <span className="mth-qm">Q16</span>
                <span style={{ "flex": "1" }}>How does the tracker estimate generated images?</span>
                <svg className="mth-i mth-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg></summary>
              <div className="mth-ans">
                <p>
                  <span className="mth-cs" style={{ background: mark("k10") }}>EcoLogits does not calculate the other kinds of model output, such as images.</span>
                  <button className="mth-ct" data-cite="k10" type="button" onClick={() => pick("k10")} aria-pressed={cite === "k10"} aria-label="Source 2">2</button>{" "}
                  <span className="mth-cs" style={{ background: mark("k11") }}>The tracker uses 2.907 Wh for each image. This is the mean value for image generation in a published study.</span>
                  <button className="mth-ct" data-cite="k11" type="button" onClick={() => pick("k11")} aria-pressed={cite === "k11"} aria-label="Source 10">10</button> The tracker multiplies this value by the provider's PUE. Carbon and water use the same factors as text. An edit counts as one image.</p>
                {cite === "k10" && (
                <>
                  <div className="mth-scard" role="note">
                    <span className="mth-scn">2</span>
                    <div style={{ "flex": "1", "minWidth": "0", "display": "flex", "flexDirection": "column", "gap": "3px" }}>
                      <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#6E4700" }}>Source 2 · EcoLogits documentation</span>
                      <span style={{ "fontSize": "14px", "lineHeight": "20px" }}>LLM inference: energy, time and GPUs</span>
                      <span style={{ "fontSize": "13px", "color": "#4A5A4E" }}>It supports the text in yellow.</span>
                      <a href="https://ecologits.ai/0.11/methodology/llm_inference/" target="_blank" rel="noopener noreferrer" style={{ "alignSelf": "flex-start", "display": "inline-flex", "alignItems": "center", "gap": "6px", "fontSize": "14px", "fontWeight": "600" }}>Open the EcoLogits page
                        <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "width": "14px", "height": "14px" }}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg></a></div>
                    <button className="mth-sclose" type="button" onClick={() => pick("k10")} aria-label="Close the source">×</button></div></>)}
                {cite === "k11" && (
                <>
                  <div className="mth-scard" role="note">
                    <span className="mth-scn">10</span>
                    <div style={{ "flex": "1", "minWidth": "0", "display": "flex", "flexDirection": "column", "gap": "3px" }}>
                      <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#6E4700" }}>Source 10 · Study</span>
                      <span style={{ "fontSize": "14px", "lineHeight": "20px" }}>Luccioni, A. S., Jernite, Y. and Strubell, E. Power Hungry Processing: Watts Driving the Cost of AI Deployment? ACM FAccT 2024</span>
                      <span style={{ "fontSize": "13px", "color": "#4A5A4E" }}>It supports the text in yellow.</span>
                      <a href="https://arxiv.org/abs/2311.16863" target="_blank" rel="noopener noreferrer" style={{ "alignSelf": "flex-start", "display": "inline-flex", "alignItems": "center", "gap": "6px", "fontSize": "14px", "fontWeight": "600" }}>Open the paper
                        <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "width": "14px", "height": "14px" }}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg></a></div>
                    <button className="mth-sclose" type="button" onClick={() => pick("k11")} aria-label="Close the source">×</button></div></>)}
                <div className="mth-why">
                  <b>Why</b>
                  <span>The value comes from published measurements. The tracker does not change it for the image size.</span></div></div></details>
            <details className="mth-qa">
              <summary>
                <span className="mth-qm">Q17</span>
                <span style={{ "flex": "1" }}>How does the tracker estimate speech?</span>
                <svg className="mth-i mth-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg></summary>
              <div className="mth-ans">
                <p>EcoLogits has no method for speech at the moment. So the tracker converts the audio length into tokens.{" "}
                  <span className="mth-cs" style={{ background: mark("k12") }}>OpenAI counts one token for each 50 milliseconds of audio, that is 20 tokens each second.</span>
                  <button className="mth-ct" data-cite="k12" type="button" onClick={() => pick("k12")} aria-pressed={cite === "k12"} aria-label="Source 11">11</button>{" "}
                  <span className="mth-cs" style={{ background: mark("k13") }}>Google counts 25 tokens each second.</span>
                  <button className="mth-ct" data-cite="k13" type="button" onClick={() => pick("k13")} aria-pressed={cite === "k13"} aria-label="Source 12">12</button> For Anthropic, the tracker uses the OpenAI rate. Then it uses the EcoLogits record of the speech model gpt-4o-mini-tts. If the audio length is not known, the tracker calculates it from the text: 17 characters for each second.</p>
                {cite === "k12" && (
                <>
                  <div className="mth-scard" role="note">
                    <span className="mth-scn">11</span>
                    <div style={{ "flex": "1", "minWidth": "0", "display": "flex", "flexDirection": "column", "gap": "3px" }}>
                      <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#6E4700" }}>Source 11 · Provider documentation</span>
                      <span style={{ "fontSize": "14px", "lineHeight": "20px" }}>OpenAI: Realtime API costs. One token for each 50 ms of assistant audio</span>
                      <span style={{ "fontSize": "13px", "color": "#4A5A4E" }}>It supports the text in yellow.</span>
                      <a href="https://developers.openai.com/api/docs/guides/realtime-costs" target="_blank" rel="noopener noreferrer" style={{ "alignSelf": "flex-start", "display": "inline-flex", "alignItems": "center", "gap": "6px", "fontSize": "14px", "fontWeight": "600" }}>Open the OpenAI page
                        <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "width": "14px", "height": "14px" }}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg></a></div>
                    <button className="mth-sclose" type="button" onClick={() => pick("k12")} aria-label="Close the source">×</button></div></>)}
                {cite === "k13" && (
                <>
                  <div className="mth-scard" role="note">
                    <span className="mth-scn">12</span>
                    <div style={{ "flex": "1", "minWidth": "0", "display": "flex", "flexDirection": "column", "gap": "3px" }}>
                      <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#6E4700" }}>Source 12 · Provider documentation</span>
                      <span style={{ "fontSize": "14px", "lineHeight": "20px" }}>Google: Gemini API media resolution. 1,120 tokens for each image (Gemini 3), 25 tokens for each second of audio</span>
                      <span style={{ "fontSize": "13px", "color": "#4A5A4E" }}>It supports the text in yellow.</span>
                      <a href="https://ai.google.dev/gemini-api/docs/media-resolution" target="_blank" rel="noopener noreferrer" style={{ "alignSelf": "flex-start", "display": "inline-flex", "alignItems": "center", "gap": "6px", "fontSize": "14px", "fontWeight": "600" }}>Open the Google page
                        <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "width": "14px", "height": "14px" }}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg></a></div>
                    <button className="mth-sclose" type="button" onClick={() => pick("k13")} aria-label="Close the source">×</button></div></>)}
                <div className="mth-why">
                  <b>Why</b>
                  <span>With a token count, speech can use the same EcoLogits equations as text. 17 characters each second is a normal speed of speech.</span></div></div></details>
            <details className="mth-qa">
              <summary>
                <span className="mth-qm">Q18</span>
                <span style={{ "flex": "1" }}>How does the tracker estimate video?</span>
                <svg className="mth-i mth-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg></summary>
              <div className="mth-ans">
                <p>
                  <span className="mth-cs" style={{ background: mark("k14") }}>EcoLogits has a method for video.</span>
                  <button className="mth-ct" data-cite="k14" type="button" onClick={() => pick("k14")} aria-pressed={cite === "k14"} aria-label="Source 4">4</button> The tracker uses it with the resolution and the length of the video. If the site does not give these values, the tracker uses defaults:</p>
                <ul className="mth-list">
                  <li>Perplexity: 1280 × 720 pixels, 8 seconds, no audio.</li>
                  <li>Gemini: 1280 × 720 pixels, 10 seconds, with audio.</li>
                  <li>Google video models without a name: the record of Veo 3.1.</li>
                  <li>A NotebookLM video overview: one image for each 10 seconds, plus the narration as speech.</li></ul>
                <p>For video, EcoLogits uses a world average grid when no location is given. The tracker uses the provider's location, as for text: the United States.</p>
                {cite === "k14" && (
                <>
                  <div className="mth-scard" role="note">
                    <span className="mth-scn">4</span>
                    <div style={{ "flex": "1", "minWidth": "0", "display": "flex", "flexDirection": "column", "gap": "3px" }}>
                      <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#6E4700" }}>Source 4 · EcoLogits documentation</span>
                      <span style={{ "fontSize": "14px", "lineHeight": "20px" }}>Video generation</span>
                      <span style={{ "fontSize": "13px", "color": "#4A5A4E" }}>It supports the text in yellow.</span>
                      <a href="https://ecologits.ai/0.11/methodology/video_generation/" target="_blank" rel="noopener noreferrer" style={{ "alignSelf": "flex-start", "display": "inline-flex", "alignItems": "center", "gap": "6px", "fontSize": "14px", "fontWeight": "600" }}>Open the EcoLogits page
                        <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "width": "14px", "height": "14px" }}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg></a></div>
                    <button className="mth-sclose" type="button" onClick={() => pick("k14")} aria-label="Close the source">×</button></div></>)}
                <div className="mth-why">
                  <b>Why</b>
                  <span>Text and video from the same provider then use the same grid.</span></div></div></details></section>
          <section id="m-gaps" className="mth-sec">
            <span className="mth-kick">2.5</span>
            <h2 className="mth-dsp mth-h2">Gaps and older chats</h2>
            <details className="mth-qa" open>
              <summary>
                <span className="mth-qm">Q19</span>
                <span style={{ "flex": "1" }}>What if the tracker cannot read all of a reply?</span>
                <svg className="mth-i mth-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg></summary>
              <div className="mth-ans">
                <p>The tracker counts the part that it can read. Details then shows "Partly measured". The tracker never shows zero for a reply that it could not read in full. A stopped reply counts the text that the AI wrote before it stopped.</p>
                <div className="mth-why">
                  <b>Why</b>
                  <span>A partial count is nearer to the real value than zero.</span></div></div></details>
            <details className="mth-qa">
              <summary>
                <span className="mth-qm">Q20</span>
                <span style={{ "flex": "1" }}>What about chats from before you installed the tracker?</span>
                <svg className="mth-i mth-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg></summary>
              <div className="mth-ans">
                <p>When you open an older chat, the tracker reads its saved history and estimates each reply. For Claude, the history names only the current model of the chat. So the tracker uses that model for each reply in the chat. If you open a chat again, its counts never go down.</p>
                <div className="mth-why">
                  <b>Why</b>
                  <span>Your totals then include your earlier use too.</span></div></div></details>
            <details className="mth-qa">
              <summary>
                <span className="mth-qm">Q21</span>
                <span style={{ "flex": "1" }}>Do edited messages and other branches count?</span>
                <svg className="mth-i mth-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg></summary>
              <div className="mth-ans">
                <p>Yes. When you edit a message, the site keeps the old version as a branch. The AI used energy for each branch, so all branches count.</p></div></details></section>
          <section id="m-excluded" className="mth-sec">
            <h2 className="mth-dsp mth-h2">What is not included</h2>
            <p className="mth-p">These parts are not in the figures. So the full footprint of AI use is larger than the tracker shows, in each scenario.</p>
            <div style={{ "display": "grid", "gridTemplateColumns": "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", "gap": "10px 24px" }}>
              <span style={{ "display": "flex", "gap": "10px", "fontSize": "16px", "lineHeight": "24px" }}>
                <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "color": "#8A5A00", "marginTop": "3px" }}><path d="M6 6l12 12M18 6 6 18" /></svg>
                <span>
                  <span className="mth-cs" style={{ background: mark("k15") }}>Training of the models. EcoLogits does not include it.</span>
                  <button className="mth-ct" data-cite="k15" type="button" onClick={() => pick("k15")} aria-pressed={cite === "k15"} aria-label="Source 1">1</button></span></span>
              <span style={{ "display": "flex", "gap": "10px", "fontSize": "16px", "lineHeight": "24px" }}>
                <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "color": "#8A5A00", "marginTop": "3px" }}><path d="M6 6l12 12M18 6 6 18" /></svg>
                <span>Manufacture of servers and chips. EcoLogits calculates a share, but the tracker does not show it.</span></span>
              <span style={{ "display": "flex", "gap": "10px", "fontSize": "16px", "lineHeight": "24px" }}>
                <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "color": "#8A5A00", "marginTop": "3px" }}><path d="M6 6l12 12M18 6 6 18" /></svg>
                <span>
                  <span className="mth-cs" style={{ background: mark("k16") }}>Your computer, your phone and the network. EcoLogits does not include them.</span>
                  <button className="mth-ct" data-cite="k16" type="button" onClick={() => pick("k16")} aria-pressed={cite === "k16"} aria-label="Source 1">1</button></span></span>
              <span style={{ "display": "flex", "gap": "10px", "fontSize": "16px", "lineHeight": "24px" }}>
                <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "color": "#8A5A00", "marginTop": "3px" }}><path d="M6 6l12 12M18 6 6 18" /></svg>
                <span>Hidden reasoning and agent steps that the site does not show.</span></span>
              <span style={{ "display": "flex", "gap": "10px", "fontSize": "16px", "lineHeight": "24px" }}>
                <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "color": "#8A5A00", "marginTop": "3px" }}><path d="M6 6l12 12M18 6 6 18" /></svg>
                <span>Search engines and other services that the AI uses.</span></span>
              <span style={{ "display": "flex", "gap": "10px", "fontSize": "16px", "lineHeight": "24px" }}>
                <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "color": "#8A5A00", "marginTop": "3px" }}><path d="M6 6l12 12M18 6 6 18" /></svg>
                <span>Servers that stay ready but idle.</span></span></div>
            {cite === "k15" && (
            <>
              <div className="mth-scard" role="note">
                <span className="mth-scn">1</span>
                <div style={{ "flex": "1", "minWidth": "0", "display": "flex", "flexDirection": "column", "gap": "3px" }}>
                  <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#6E4700" }}>Source 1 · EcoLogits documentation</span>
                  <span style={{ "fontSize": "14px", "lineHeight": "20px" }}>Methodology overview, release 0.11</span>
                  <span style={{ "fontSize": "13px", "color": "#4A5A4E" }}>It supports the text in yellow.</span>
                  <a href="https://ecologits.ai/0.11/methodology/" target="_blank" rel="noopener noreferrer" style={{ "alignSelf": "flex-start", "display": "inline-flex", "alignItems": "center", "gap": "6px", "fontSize": "14px", "fontWeight": "600" }}>Open the EcoLogits page
                    <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "width": "14px", "height": "14px" }}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg></a></div>
                <button className="mth-sclose" type="button" onClick={() => pick("k15")} aria-label="Close the source">×</button></div></>)}
            {cite === "k16" && (
            <>
              <div className="mth-scard" role="note">
                <span className="mth-scn">1</span>
                <div style={{ "flex": "1", "minWidth": "0", "display": "flex", "flexDirection": "column", "gap": "3px" }}>
                  <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#6E4700" }}>Source 1 · EcoLogits documentation</span>
                  <span style={{ "fontSize": "14px", "lineHeight": "20px" }}>Methodology overview, release 0.11</span>
                  <span style={{ "fontSize": "13px", "color": "#4A5A4E" }}>It supports the text in yellow.</span>
                  <a href="https://ecologits.ai/0.11/methodology/" target="_blank" rel="noopener noreferrer" style={{ "alignSelf": "flex-start", "display": "inline-flex", "alignItems": "center", "gap": "6px", "fontSize": "14px", "fontWeight": "600" }}>Open the EcoLogits page
                    <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "width": "14px", "height": "14px" }}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg></a></div>
                <button className="mth-sclose" type="button" onClick={() => pick("k16")} aria-label="Close the source">×</button></div></>)}</section>
          <section id="m-privacy" className="mth-sec">
            <h2 className="mth-dsp mth-h2">Privacy</h2>
            <p className="mth-p">The tracker counts in your browser. It keeps numbers only: token counts, model names and times. It never keeps your messages, the AI's replies or the contents of your files. If you connect to an organization, the tracker sends only these numbers, never chat titles. The organization server keeps the address of your browser connection for 30 days, for the administrator's network view.</p></section>
          <section id="m-sources" className="mth-sec">
            <h2 className="mth-dsp mth-h2">Sources</h2>
            <p className="mth-p">Each number in the text points to one of these sources. All links were checked on 11 October 2026.</p>
            <div style={{ "display": "grid", "gridTemplateColumns": "repeat(auto-fit, minmax(min(360px, 100%), 1fr))", "gap": "6px 12px" }}>
              <div className="mth-ref" id="src-1" style={{ background: source(1) }}>
                <span className="mth-scn" style={{ "background": "#EEF1E8", "color": "#1F5A2E" }}>1</span>
                <div style={{ "display": "flex", "flexDirection": "column", "gap": "2px", "minWidth": "0" }}>
                  <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#4A5A4E" }}>EcoLogits documentation</span>
                  <span>Methodology overview, release 0.11</span>
                  <a href="https://ecologits.ai/0.11/methodology/" target="_blank" rel="noopener noreferrer" style={{ "fontSize": "14px", "wordBreak": "break-all" }}>ecologits.ai/0.11/methodology/</a></div></div>
              <div className="mth-ref" id="src-2" style={{ background: source(2) }}>
                <span className="mth-scn" style={{ "background": "#EEF1E8", "color": "#1F5A2E" }}>2</span>
                <div style={{ "display": "flex", "flexDirection": "column", "gap": "2px", "minWidth": "0" }}>
                  <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#4A5A4E" }}>EcoLogits documentation</span>
                  <span>LLM inference: energy, time and GPUs</span>
                  <a href="https://ecologits.ai/0.11/methodology/llm_inference/" target="_blank" rel="noopener noreferrer" style={{ "fontSize": "14px", "wordBreak": "break-all" }}>ecologits.ai/0.11/methodology/llm_inference/</a></div></div>
              <div className="mth-ref" id="src-3" style={{ background: source(3) }}>
                <span className="mth-scn" style={{ "background": "#EEF1E8", "color": "#1F5A2E" }}>3</span>
                <div style={{ "display": "flex", "flexDirection": "column", "gap": "2px", "minWidth": "0" }}>
                  <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#4A5A4E" }}>EcoLogits documentation</span>
                  <span>Proprietary models: parameter ranges</span>
                  <a href="https://ecologits.ai/0.11/methodology/proprietary_models/" target="_blank" rel="noopener noreferrer" style={{ "fontSize": "14px", "wordBreak": "break-all" }}>ecologits.ai/0.11/methodology/proprietary_models/</a></div></div>
              <div className="mth-ref" id="src-4" style={{ background: source(4) }}>
                <span className="mth-scn" style={{ "background": "#EEF1E8", "color": "#1F5A2E" }}>4</span>
                <div style={{ "display": "flex", "flexDirection": "column", "gap": "2px", "minWidth": "0" }}>
                  <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#4A5A4E" }}>EcoLogits documentation</span>
                  <span>Video generation</span>
                  <a href="https://ecologits.ai/0.11/methodology/video_generation/" target="_blank" rel="noopener noreferrer" style={{ "fontSize": "14px", "wordBreak": "break-all" }}>ecologits.ai/0.11/methodology/video_generation/</a></div></div>
              <div className="mth-ref" id="src-5" style={{ background: source(5) }}>
                <span className="mth-scn" style={{ "background": "#EEF1E8", "color": "#1F5A2E" }}>5</span>
                <div style={{ "display": "flex", "flexDirection": "column", "gap": "2px", "minWidth": "0" }}>
                  <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#4A5A4E" }}>EcoLogits code on GitHub</span>
                  <span>impacts/llm.py, release 0.11.2: the equations and constants</span>
                  <a href="https://github.com/mlco2/ecologits/blob/0.11.2/ecologits/impacts/llm.py" target="_blank" rel="noopener noreferrer" style={{ "fontSize": "14px", "wordBreak": "break-all" }}>github.com/mlco2/ecologits/blob/0.11.2/ecologits/impacts/llm.py</a></div></div>
              <div className="mth-ref" id="src-6" style={{ background: source(6) }}>
                <span className="mth-scn" style={{ "background": "#EEF1E8", "color": "#1F5A2E" }}>6</span>
                <div style={{ "display": "flex", "flexDirection": "column", "gap": "2px", "minWidth": "0" }}>
                  <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#4A5A4E" }}>EcoLogits code on GitHub</span>
                  <span>tracers/utils.py, release 0.11.2: location, PUE and WUE for each provider</span>
                  <a href="https://github.com/mlco2/ecologits/blob/0.11.2/ecologits/tracers/utils.py" target="_blank" rel="noopener noreferrer" style={{ "fontSize": "14px", "wordBreak": "break-all" }}>github.com/mlco2/ecologits/blob/0.11.2/ecologits/tracers/utils.py</a></div></div>
              <div className="mth-ref" id="src-10" style={{ background: source(10) }}>
                <span className="mth-scn" style={{ "background": "#EEF1E8", "color": "#1F5A2E" }}>10</span>
                <div style={{ "display": "flex", "flexDirection": "column", "gap": "2px", "minWidth": "0" }}>
                  <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#4A5A4E" }}>Study</span>
                  <span>Luccioni, A. S., Jernite, Y. and Strubell, E. Power Hungry Processing: Watts Driving the Cost of AI Deployment? ACM FAccT 2024</span>
                  <a href="https://arxiv.org/abs/2311.16863" target="_blank" rel="noopener noreferrer" style={{ "fontSize": "14px", "wordBreak": "break-all" }}>arxiv.org/abs/2311.16863</a></div></div>
              <div className="mth-ref" id="src-11" style={{ background: source(11) }}>
                <span className="mth-scn" style={{ "background": "#EEF1E8", "color": "#1F5A2E" }}>11</span>
                <div style={{ "display": "flex", "flexDirection": "column", "gap": "2px", "minWidth": "0" }}>
                  <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#4A5A4E" }}>Provider documentation</span>
                  <span>OpenAI: Realtime API costs. One token for each 50 ms of assistant audio</span>
                  <a href="https://developers.openai.com/api/docs/guides/realtime-costs" target="_blank" rel="noopener noreferrer" style={{ "fontSize": "14px", "wordBreak": "break-all" }}>developers.openai.com/api/docs/guides/realtime-costs</a></div></div>
              <div className="mth-ref" id="src-12" style={{ background: source(12) }}>
                <span className="mth-scn" style={{ "background": "#EEF1E8", "color": "#1F5A2E" }}>12</span>
                <div style={{ "display": "flex", "flexDirection": "column", "gap": "2px", "minWidth": "0" }}>
                  <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#4A5A4E" }}>Provider documentation</span>
                  <span>Google: Gemini API media resolution. 1,120 tokens for each image (Gemini 3), 25 tokens for each second of audio</span>
                  <a href="https://ai.google.dev/gemini-api/docs/media-resolution" target="_blank" rel="noopener noreferrer" style={{ "fontSize": "14px", "wordBreak": "break-all" }}>ai.google.dev/gemini-api/docs/media-resolution</a></div></div>
              <div className="mth-ref" id="src-13" style={{ background: source(13) }}>
                <span className="mth-scn" style={{ "background": "#EEF1E8", "color": "#1F5A2E" }}>13</span>
                <div style={{ "display": "flex", "flexDirection": "column", "gap": "2px", "minWidth": "0" }}>
                  <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#4A5A4E" }}>Open-source library</span>
                  <span>gpt-tokenizer, o200k_base encoding, MIT licence</span>
                  <a href="https://github.com/niieani/gpt-tokenizer" target="_blank" rel="noopener noreferrer" style={{ "fontSize": "14px", "wordBreak": "break-all" }}>github.com/niieani/gpt-tokenizer</a></div></div></div>
            <p className="mth-p mth-muted" style={{ "fontSize": "15px", "lineHeight": "24px" }}>Further reading: Li, P., Yang, J., Islam, M. A. and Ren, S. Making AI Less "Thirsty". arXiv:2304.03271. Elsworth, C. et al. Measuring the environmental impact of delivering AI at Google scale. arXiv:2508.15734, 2025.</p></section>
          {reference}
          {credit && (<p className="mth-credit" style={{ "margin": "0", "textAlign": "center", "fontSize": "14px", "lineHeight": "19px", "color": "#4A5A4E", "padding": "16px 0 8px" }}>Designed and built by{" "}
            <a href="https://www.linkedin.com/in/pranitnale/" target="_blank" rel="noopener noreferrer" style={{ "color": "#2E6B3F", "fontWeight": "600", "textDecoration": "underline", "textUnderlineOffset": "2px" }}>Pranit Nale</a></p>)}</article></div>
    </>
  );
}
