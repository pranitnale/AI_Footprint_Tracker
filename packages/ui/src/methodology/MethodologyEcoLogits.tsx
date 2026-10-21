// Generated from the canvas board MethodologyEcoLogits (board2jsx), then wired. The copy follows the board.
// The default React import keeps this module working under the classic JSX transform, as in icons.tsx.
import React, { useState, type ReactNode } from "react";
import type { MethodologyLinks } from "./links";

// Each citation names the numbered source it supports.
const CITES: Record<string, number> = {"k1":9,"k2":5,"k3":2,"k4":2,"k5":5,"k6":2,"k7":5,"k8":5,"k9":6,"k10":2,"k11":7,"k12":2,"k13":7,"k14":3,"k15":8,"k16":4,"k17":4};

export function MethodologyEcoLogits({ links, bar, credit, reference }: { links: MethodologyLinks; bar: ReactNode; credit: boolean; reference: ReactNode }) {
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
          <a className="mth-tab" href={links.part1}>
            <small>Part 1</small>
            <b>What the tracker adds to EcoLogits</b>
            <span>Questions and answers, and why</span></a>
          <a className="mth-tab" href={links.part2} aria-current="page">
            <small>Part 2</small>
            <b>How EcoLogits calculates</b>
            <span>Each equation, step by step</span></a></div></nav>
      <div style={{ "maxWidth": "1160px", "margin": "0 auto", "padding": "36px clamp(16px, 4vw, 56px) 56px", "display": "flex", "flexWrap": "wrap", "gap": "48px", "alignItems": "flex-start" }}>
        <nav aria-label="On this page" style={{ "flex": "1 1 220px", "maxWidth": "260px", "display": "flex", "flexDirection": "column", "gap": "2px", "position": "sticky", "top": "16px" }}>
          <span style={{ "fontSize": "13px", "fontWeight": "600", "color": "#4A5A4E", "padding": "0 10px 8px" }}>On this page</span>
          <a className="mth-toc" href="#m-chain">
            <span className="mth-tn">01</span>The calculation chain</a>
          <a className="mth-toc" href="#m-gpus">
            <span className="mth-tn">02</span>GPUs for the model</a>
          <a className="mth-toc" href="#m-pertoken">
            <span className="mth-tn">03</span>Energy for each token</a>
          <a className="mth-toc" href="#m-time">
            <span className="mth-tn">04</span>Time to write the reply</a>
          <a className="mth-toc" href="#m-server">
            <span className="mth-tn">05</span>Server and data centre</a>
          <a className="mth-toc" href="#m-carbon">
            <span className="mth-tn">06</span>Carbon</a>
          <a className="mth-toc" href="#m-water">
            <span className="mth-tn">07</span>Water</a>
          <a className="mth-toc" href="#m-ranges">
            <span className="mth-tn">08</span>Ranges for closed models</a>
          <a className="mth-toc" href="#m-video">
            <span className="mth-tn">09</span>Video</a>
          <a className="mth-toc" href="#m-example">
            <span className="mth-tn">10</span>A worked example</a>
          <a className="mth-toc" href="#m-sources">
            <span className="mth-tn">11</span>Sources</a>
          <a className="mth-toc" href={links.part1} style={{ "marginTop": "12px", "border": "1px solid #DCE2D6", "fontWeight": "600" }}>
            <span className="mth-tn">→</span>Part 1: What the tracker adds</a></nav>
        <article style={{ "flex": "999 1 560px", "minWidth": "0", "maxWidth": "860px", "display": "flex", "flexDirection": "column", "gap": "36px" }}>
          <section id="m-chain" className="mth-sec">
            <span className="mth-kick">Part 2</span>
            <h2 className="mth-dsp mth-h2">The calculation chain</h2>
            <p className="mth-p">
              <span className="mth-cs" style={{ background: mark("k1") }}>EcoLogits is an open-source method and library.</span>
              <button className="mth-ct" data-cite="k1" type="button" onClick={() => pick("k1")} aria-pressed={cite === "k1"} aria-label="Source 9">9</button> It calculates the environmental impact of one request to an AI model.{" "}
              <span className="mth-cs" style={{ background: mark("k2") }}>The tracker uses its equations and its parameters from release 0.11.2.</span>
              <button className="mth-ct" data-cite="k2" type="button" onClick={() => pick("k2")} aria-pressed={cite === "k2"} aria-label="Source 5">5</button> This part shows each equation and explains each value.</p>
            {cite === "k1" && (
            <>
              <div className="mth-scard" role="note">
                <span className="mth-scn">9</span>
                <div style={{ "flex": "1", "minWidth": "0", "display": "flex", "flexDirection": "column", "gap": "3px" }}>
                  <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#6E4700" }}>Source 9 · EcoLogits project</span>
                  <span style={{ "fontSize": "14px", "lineHeight": "20px" }}>EcoLogits repository, MPL 2.0 licence. Rincé, S. and Banse, A. EcoLogits: Evaluating the Environmental Impacts of Generative AI. JOSS 10(111), 7471, doi:10.21105/joss.07471</span>
                  <span style={{ "fontSize": "13px", "color": "#4A5A4E" }}>It supports the text in yellow.</span>
                  <a href="https://github.com/mlco2/ecologits" target="_blank" rel="noopener noreferrer" style={{ "alignSelf": "flex-start", "display": "inline-flex", "alignItems": "center", "gap": "6px", "fontSize": "14px", "fontWeight": "600" }}>Open the repository on GitHub
                    <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "width": "14px", "height": "14px" }}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg></a></div>
                <button className="mth-sclose" type="button" onClick={() => pick("k1")} aria-label="Close the source">×</button></div></>)}
            {cite === "k2" && (
            <>
              <div className="mth-scard" role="note">
                <span className="mth-scn">5</span>
                <div style={{ "flex": "1", "minWidth": "0", "display": "flex", "flexDirection": "column", "gap": "3px" }}>
                  <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#6E4700" }}>Source 5 · EcoLogits code on GitHub</span>
                  <span style={{ "fontSize": "14px", "lineHeight": "20px" }}>impacts/llm.py, release 0.11.2: the equations and constants</span>
                  <span style={{ "fontSize": "13px", "color": "#4A5A4E" }}>It supports the text in yellow.</span>
                  <a href="https://github.com/mlco2/ecologits/blob/0.11.2/ecologits/impacts/llm.py" target="_blank" rel="noopener noreferrer" style={{ "alignSelf": "flex-start", "display": "inline-flex", "alignItems": "center", "gap": "6px", "fontSize": "14px", "fontWeight": "600" }}>Open the code on GitHub
                    <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "width": "14px", "height": "14px" }}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg></a></div>
                <button className="mth-sclose" type="button" onClick={() => pick("k2")} aria-label="Close the source">×</button></div></>)}
            <div style={{ "display": "flex", "alignItems": "center", "gap": "10px", "padding": "12px 16px", "borderRadius": "14px", "background": "#FFF8E1", "border": "1px solid #F0D58A", "fontSize": "14px", "lineHeight": "20px", "color": "#4D3A00" }}>
              <span className="mth-ct" style={{ "verticalAlign": "baseline", "margin": "0", "cursor": "default" }}>2</span>
              <span>Select a source number to see its source. The text that it supports then shows in yellow.</span></div>
            <div className="mth-card" style={{ "padding": "18px", "display": "flex", "flexDirection": "column", "gap": "12px" }}>
              <svg viewBox="0 0 800 456" role="img" aria-label="The EcoLogits calculation chain, from tokens and the model record to electricity, carbon and water" style={{ "width": "100%", "height": "auto", "display": "block", "fontFamily": "inherit" }}>
                <defs>
                  <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="#9DB394" /></marker></defs>
                <a href="#m-chain"><rect x="10" y="10" width="240" height="58" rx="12" fill="#E3F0E1" stroke="#CFE6BD" />
                  <text x="130" y="36" textAnchor="middle" fontSize="14" fontWeight="700" fill="#13241A">Output tokens n</text>
                  <text x="130" y="54" textAnchor="middle" fontSize="12.5" fill="#4A5A4E">counted by the tracker</text></a>
                <a href="#m-chain"><rect x="280" y="10" width="240" height="58" rx="12" fill="#E7EFF8" stroke="#C9DAEE" />
                  <text x="400" y="36" textAnchor="middle" fontSize="14" fontWeight="700" fill="#13241A">Model record</text>
                  <text x="400" y="54" textAnchor="middle" fontSize="12.5" fill="#4A5A4E">P_active, P_total, TPS, TTFT</text></a>
                <a href="#m-time"><rect x="550" y="10" width="240" height="58" rx="12" fill="#E3F0E1" stroke="#CFE6BD" />
                  <text x="670" y="36" textAnchor="middle" fontSize="14" fontWeight="700" fill="#13241A">Measured time</text>
                  <text x="670" y="54" textAnchor="middle" fontSize="12.5" fill="#4A5A4E">upper limit, from the tracker</text></a><line x1="330" y1="68" x2="140" y2="103" stroke="#9DB394" strokeWidth="2" markerEnd="url(#ah)" /><line x1="400" y1="68" x2="400" y2="103" stroke="#9DB394" strokeWidth="2" markerEnd="url(#ah)" /><line x1="470" y1="68" x2="660" y2="103" stroke="#9DB394" strokeWidth="2" markerEnd="url(#ah)" /><line x1="670" y1="68" x2="670" y2="103" stroke="#9DB394" strokeWidth="2" markerEnd="url(#ah)" /><line x1="220" y1="68" x2="610" y2="103" stroke="#9DB394" strokeWidth="2" markerEnd="url(#ah)" />
                <a href="#m-gpus"><rect x="10" y="105" width="240" height="58" rx="12" fill="#FFFFFF" stroke="#DCE2D6" />
                  <text x="130" y="131" textAnchor="middle" fontSize="14" fontWeight="700" fill="#13241A">1 · GPUs g</text>
                  <text x="130" y="149" textAnchor="middle" fontSize="12.5" fill="#4A5A4E">memory of the model</text></a>
                <a href="#m-pertoken"><rect x="280" y="105" width="240" height="58" rx="12" fill="#FFFFFF" stroke="#DCE2D6" />
                  <text x="400" y="131" textAnchor="middle" fontSize="14" fontWeight="700" fill="#13241A">2 · Energy per token</text>
                  <text x="400" y="149" textAnchor="middle" fontSize="12.5" fill="#4A5A4E">e_GPU, for each GPU</text></a>
                <a href="#m-time"><rect x="550" y="105" width="240" height="58" rx="12" fill="#FFFFFF" stroke="#DCE2D6" />
                  <text x="670" y="131" textAnchor="middle" fontSize="14" fontWeight="700" fill="#13241A">3 · Time t</text>
                  <text x="670" y="149" textAnchor="middle" fontSize="12.5" fill="#4A5A4E">n / TPS + TTFT, capped</text></a><line x1="150" y1="163" x2="245" y2="198" stroke="#9DB394" strokeWidth="2" markerEnd="url(#ah)" /><line x1="400" y1="163" x2="290" y2="198" stroke="#9DB394" strokeWidth="2" markerEnd="url(#ah)" /><line x1="130" y1="163" x2="470" y2="198" stroke="#9DB394" strokeWidth="2" markerEnd="url(#ah)" /><line x1="670" y1="163" x2="560" y2="198" stroke="#9DB394" strokeWidth="2" markerEnd="url(#ah)" />
                <a href="#m-pertoken"><rect x="140" y="200" width="240" height="58" rx="12" fill="#FFFFFF" stroke="#DCE2D6" />
                  <text x="260" y="226" textAnchor="middle" fontSize="14" fontWeight="700" fill="#13241A">GPU energy</text>
                  <text x="260" y="244" textAnchor="middle" fontSize="12.5" fill="#4A5A4E">E_GPU = g · n · e_GPU</text></a>
                <a href="#m-server"><rect x="420" y="200" width="240" height="58" rx="12" fill="#FFFFFF" stroke="#DCE2D6" />
                  <text x="540" y="226" textAnchor="middle" fontSize="14" fontWeight="700" fill="#13241A">4 · Server energy</text>
                  <text x="540" y="244" textAnchor="middle" fontSize="12.5" fill="#4A5A4E">E_server, the rest of the server</text></a><line x1="260" y1="258" x2="360" y2="293" stroke="#9DB394" strokeWidth="2" markerEnd="url(#ah)" /><line x1="540" y1="258" x2="440" y2="293" stroke="#9DB394" strokeWidth="2" markerEnd="url(#ah)" />
                <a href="#m-server"><rect x="280" y="295" width="240" height="58" rx="12" fill="#FFFFFF" stroke="#9DB394" />
                  <text x="400" y="321" textAnchor="middle" fontSize="14" fontWeight="700" fill="#13241A">IT energy E_IT</text>
                  <text x="400" y="339" textAnchor="middle" fontSize="12.5" fill="#4A5A4E">E_GPU + E_server</text></a><line x1="330" y1="353" x2="140" y2="388" stroke="#9DB394" strokeWidth="2" markerEnd="url(#ah)" /><line x1="470" y1="353" x2="660" y2="388" stroke="#9DB394" strokeWidth="2" markerEnd="url(#ah)" />
                <a href="#m-server"><rect x="10" y="390" width="240" height="58" rx="12" fill="#FFF6DB" stroke="#F0D58A" />
                  <text x="130" y="416" textAnchor="middle" fontSize="14" fontWeight="700" fill="#13241A">5 · Electricity E</text>
                  <text x="130" y="434" textAnchor="middle" fontSize="12.5" fill="#4A5A4E">E_IT · PUE</text></a><line x1="250" y1="419" x2="278" y2="419" stroke="#9DB394" strokeWidth="2" markerEnd="url(#ah)" />
                <a href="#m-carbon"><rect x="280" y="390" width="240" height="58" rx="12" fill="#F1EFEA" stroke="#D8D2C4" />
                  <text x="400" y="416" textAnchor="middle" fontSize="14" fontWeight="700" fill="#13241A">Carbon C</text>
                  <text x="400" y="434" textAnchor="middle" fontSize="12.5" fill="#4A5A4E">E · grid carbon</text></a>
                <a href="#m-water"><rect x="550" y="390" width="240" height="58" rx="12" fill="#E7F1FA" stroke="#B9D6F0" />
                  <text x="670" y="416" textAnchor="middle" fontSize="14" fontWeight="700" fill="#13241A">Water W</text>
                  <text x="670" y="434" textAnchor="middle" fontSize="12.5" fill="#4A5A4E">E_IT · (WUE + PUE · EWIF)</text></a></svg>
              <div style={{ "display": "flex", "flexWrap": "wrap", "gap": "8px 18px", "fontSize": "13px", "color": "#2E3F33" }}>
                <span style={{ "display": "inline-flex", "alignItems": "center", "gap": "6px" }}><span style={{ "width": "12px", "height": "12px", "borderRadius": "3px", "background": "#E3F0E1", "boxShadow": "inset 0 0 0 1px #CFE6BD" }} />From the tracker</span>
                <span style={{ "display": "inline-flex", "alignItems": "center", "gap": "6px" }}><span style={{ "width": "12px", "height": "12px", "borderRadius": "3px", "background": "#E7EFF8", "boxShadow": "inset 0 0 0 1px #C9DAEE" }} />From the EcoLogits record</span>
                <span>Select a box to go to its step.</span></div></div>
            <p className="mth-p">Steps 1 to 3 use the model record and the tokens. Step 4 adds the rest of the server. Step 5 adds the data centre. From the electricity, EcoLogits then calculates the carbon and the water.</p>
            {/* Two basic terms for readers who are new to AI hardware. */}
            <details className="mth-qa" open>
              <summary>
                <span className="mth-qm" aria-hidden="true">?</span>
                <span style={{ "flex": "1" }}>What is a GPU?</span>
                <svg className="mth-i mth-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg></summary>
              <div className="mth-ans">
                <p>A GPU (graphics processor) is a chip that does many calculations at the same time. Data centres run AI models on GPUs. EcoLogits first finds how many GPUs a model needs. Then it calculates the energy of each GPU.</p></div></details>
            <details className="mth-qa">
              <summary>
                <span className="mth-qm" aria-hidden="true">?</span>
                <span style={{ "flex": "1" }}>What is a parameter?</span>
                <svg className="mth-i mth-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg></summary>
              <div className="mth-ans">
                <p>A parameter is one number inside a model. The model learned it during training. Large models have billions of parameters, written as B: 670 B is 670 billion. A model with more parameters needs more GPU memory and more energy for each token.</p></div></details></section>
          <section id="m-gpus" className="mth-sec">
            <h2 className="mth-dsp mth-h2">1 · GPUs for the model</h2>
            <p className="mth-p">A model must fit into the memory of the GPUs (graphics processors).{" "}
              <span className="mth-cs" style={{ background: mark("k3") }}>EcoLogits uses a reference server with NVIDIA H100 GPUs. Each GPU has 80 GB of memory.</span>
              <button className="mth-ct" data-cite="k3" type="button" onClick={() => pick("k3")} aria-pressed={cite === "k3"} aria-label="Source 2">2</button></p>
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
            <div className="mth-eq">
              <span>
                <em>M</em> = 1.2 ·{" "}
                <em>P</em>
                <sub>total</sub> · 16 / 8{" "}
                <small>GB of memory for the model</small></span>
              <span>
                <em>g</em> = 2
                <sup>⌈log₂ ⌈
                  <em>M</em> / 80⌉⌉</sup>{" "}
                <small>number of GPUs</small></span></div>
            <div className="mth-sym">
              <div className="mth-s">
                <i>P</i>
                <sub>total</sub></div>
              <div>All parameters of the model, in billions.</div>
              <div className="mth-v">From the EcoLogits record</div>
              <div className="mth-s">1.2 · 16 / 8</div>
              <div>Each parameter uses 16 bits, that is 2 bytes. EcoLogits adds 20% more memory for other data.</div><div className="mth-v" />
              <div className="mth-s">80</div>
              <div>The memory of one H100 GPU, in GB.</div><div className="mth-v" />
              <div className="mth-s">⌈ ⌉ and 2
                <sup>…</sup></div>
              <div>Round up. Then use the next power of two: 1, 2, 4, 8, 16, 32 and so on.</div><div className="mth-v" /></div>
            <div className="mth-card" style={{ "padding": "18px", "display": "flex", "flexDirection": "column", "gap": "12px" }}>
              <b style={{ "fontSize": "15px" }}>Example: Claude Opus 5.5, 670 B parameters</b>
              <span className="mth-num" style={{ "fontSize": "15px" }}>1.2 × 670 × 2 = 1,608 GB → 1,608 / 80 = 20.1 → 21 GPUs → next power of two:{" "}
                <b>32 GPUs</b></span>
              <div style={{ "display": "grid", "gridTemplateColumns": "repeat(16, minmax(0, 22px))", "gap": "5px" }}><span style={{ "aspectRatio": "1", "borderRadius": "5px", "background": "#2E6B3F" }} /><span style={{ "aspectRatio": "1", "borderRadius": "5px", "background": "#2E6B3F" }} /><span style={{ "aspectRatio": "1", "borderRadius": "5px", "background": "#2E6B3F" }} /><span style={{ "aspectRatio": "1", "borderRadius": "5px", "background": "#2E6B3F" }} /><span style={{ "aspectRatio": "1", "borderRadius": "5px", "background": "#2E6B3F" }} /><span style={{ "aspectRatio": "1", "borderRadius": "5px", "background": "#2E6B3F" }} /><span style={{ "aspectRatio": "1", "borderRadius": "5px", "background": "#2E6B3F" }} /><span style={{ "aspectRatio": "1", "borderRadius": "5px", "background": "#2E6B3F" }} /><span style={{ "aspectRatio": "1", "borderRadius": "5px", "background": "#2E6B3F" }} /><span style={{ "aspectRatio": "1", "borderRadius": "5px", "background": "#2E6B3F" }} /><span style={{ "aspectRatio": "1", "borderRadius": "5px", "background": "#2E6B3F" }} /><span style={{ "aspectRatio": "1", "borderRadius": "5px", "background": "#2E6B3F" }} /><span style={{ "aspectRatio": "1", "borderRadius": "5px", "background": "#2E6B3F" }} /><span style={{ "aspectRatio": "1", "borderRadius": "5px", "background": "#2E6B3F" }} /><span style={{ "aspectRatio": "1", "borderRadius": "5px", "background": "#2E6B3F" }} /><span style={{ "aspectRatio": "1", "borderRadius": "5px", "background": "#2E6B3F" }} /><span style={{ "aspectRatio": "1", "borderRadius": "5px", "background": "#2E6B3F" }} /><span style={{ "aspectRatio": "1", "borderRadius": "5px", "background": "#2E6B3F" }} /><span style={{ "aspectRatio": "1", "borderRadius": "5px", "background": "#2E6B3F" }} /><span style={{ "aspectRatio": "1", "borderRadius": "5px", "background": "#2E6B3F" }} /><span style={{ "aspectRatio": "1", "borderRadius": "5px", "background": "#2E6B3F" }} /><span style={{ "aspectRatio": "1", "borderRadius": "5px", "background": "#CFE6BD" }} /><span style={{ "aspectRatio": "1", "borderRadius": "5px", "background": "#CFE6BD" }} /><span style={{ "aspectRatio": "1", "borderRadius": "5px", "background": "#CFE6BD" }} /><span style={{ "aspectRatio": "1", "borderRadius": "5px", "background": "#CFE6BD" }} /><span style={{ "aspectRatio": "1", "borderRadius": "5px", "background": "#CFE6BD" }} /><span style={{ "aspectRatio": "1", "borderRadius": "5px", "background": "#CFE6BD" }} /><span style={{ "aspectRatio": "1", "borderRadius": "5px", "background": "#CFE6BD" }} /><span style={{ "aspectRatio": "1", "borderRadius": "5px", "background": "#CFE6BD" }} /><span style={{ "aspectRatio": "1", "borderRadius": "5px", "background": "#CFE6BD" }} /><span style={{ "aspectRatio": "1", "borderRadius": "5px", "background": "#CFE6BD" }} /><span style={{ "aspectRatio": "1", "borderRadius": "5px", "background": "#CFE6BD" }} /></div>
              <div style={{ "display": "flex", "flexWrap": "wrap", "gap": "6px 16px", "fontSize": "13px", "color": "#2E3F33" }}>
                <span style={{ "display": "inline-flex", "alignItems": "center", "gap": "6px" }}><span style={{ "width": "12px", "height": "12px", "borderRadius": "3px", "background": "#2E6B3F" }} />21 GPUs for the memory</span>
                <span style={{ "display": "inline-flex", "alignItems": "center", "gap": "6px" }}><span style={{ "width": "12px", "height": "12px", "borderRadius": "3px", "background": "#CFE6BD" }} />11 more from the rounding</span></div></div></section>
          <section id="m-pertoken" className="mth-sec">
            <h2 className="mth-dsp mth-h2">2 · Energy for each token</h2>
            <p className="mth-p">Each output token uses energy on each GPU.{" "}
              <span className="mth-cs" style={{ background: mark("k4") }}>EcoLogits fitted an equation to measurements of open models on H100 GPUs, from the ML.ENERGY leaderboard.</span>
              <button className="mth-ct" data-cite="k4" type="button" onClick={() => pick("k4")} aria-pressed={cite === "k4"} aria-label="Source 2">2</button> A larger model uses more energy for each token.</p>
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
            <div className="mth-eq">
              <span>
                <em>e</em>
                <sub>GPU</sub> = α · exp(β ·{" "}
                <em>B</em>) ·{" "}
                <em>P</em>
                <sub>active</sub> + γ{" "}
                <small>Wh for each output token, for each GPU</small></span>
              <span>
                <em>E</em>
                <sub>GPU</sub> ={" "}
                <em>g</em> ·{" "}
                <em>n</em> ·{" "}
                <em>e</em>
                <sub>GPU</sub>{" "}
                <small>Wh for the reply</small></span></div>
            <div className="mth-sym">
              <div className="mth-s">
                <i>P</i>
                <sub>active</sub></div>
              <div>Active parameters, in billions. In a mixture-of-experts model, only a part of the model works for each token.</div>
              <div className="mth-v">From the EcoLogits record</div>
              <div className="mth-s">
                <i>B</i></div>
              <div>The number of requests that the server processes at the same time (the batch).</div>
              <div className="mth-v">64</div>
              <div className="mth-s">α, β, γ</div>
              <div>Fitted values: α = 1.1665 × 10⁻⁶, β = −0.011206, γ = 4.0529 × 10⁻⁵.{" "}
                <span className="mth-cs" style={{ background: mark("k5") }}>The EcoLogits pages show them rounded. The tracker uses the exact values from the code.</span>
                <button className="mth-ct" data-cite="k5" type="button" onClick={() => pick("k5")} aria-pressed={cite === "k5"} aria-label="Source 5">5</button></div><div className="mth-v" />
              <div className="mth-s">
                <i>n</i></div>
              <div>Output tokens of the reply.</div>
              <div className="mth-v">Counted by the tracker</div>
              <div className="mth-s">
                <i>g</i></div>
              <div>GPUs from step 1.</div><div className="mth-v" /></div>
            {cite === "k5" && (
            <>
              <div className="mth-scard" role="note">
                <span className="mth-scn">5</span>
                <div style={{ "flex": "1", "minWidth": "0", "display": "flex", "flexDirection": "column", "gap": "3px" }}>
                  <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#6E4700" }}>Source 5 · EcoLogits code on GitHub</span>
                  <span style={{ "fontSize": "14px", "lineHeight": "20px" }}>impacts/llm.py, release 0.11.2: the equations and constants</span>
                  <span style={{ "fontSize": "13px", "color": "#4A5A4E" }}>It supports the text in yellow.</span>
                  <a href="https://github.com/mlco2/ecologits/blob/0.11.2/ecologits/impacts/llm.py" target="_blank" rel="noopener noreferrer" style={{ "alignSelf": "flex-start", "display": "inline-flex", "alignItems": "center", "gap": "6px", "fontSize": "14px", "fontWeight": "600" }}>Open the code on GitHub
                    <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "width": "14px", "height": "14px" }}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg></a></div>
                <button className="mth-sclose" type="button" onClick={() => pick("k5")} aria-label="Close the source">×</button></div></>)}
            <div className="mth-card" style={{ "padding": "18px", "display": "flex", "flexDirection": "column", "gap": "10px" }}>
              <svg viewBox="0 0 560 230" role="img" aria-label="Energy per output token for each GPU grows in a straight line with the active parameters" style={{ "width": "100%", "maxWidth": "560px", "margin": "0 auto", "height": "auto", "display": "block", "fontFamily": "inherit" }}><rect x="159.66666666666669" y="20" width="203.66666666666663" height="170" fill="#E3F0E1" />
                <text x="261.5" y="36" textAnchor="middle" fontSize="12" fontWeight="700" fill="#1F5A2E">Claude Opus 5.5: 70 to 200 B</text><line x1="50" y1="190" x2="525" y2="190" stroke="#DCE2D6" /><line x1="50" y1="20" x2="50" y2="190" stroke="#DCE2D6" />
                <text x="50" y="208" textAnchor="middle" fontSize="12" fill="#4A5A4E">0 B</text>
                <text x="206.66666666666666" y="208" textAnchor="middle" fontSize="12" fill="#4A5A4E">100 B</text>
                <text x="363.3333333333333" y="208" textAnchor="middle" fontSize="12" fill="#4A5A4E">200 B</text>
                <text x="520" y="208" textAnchor="middle" fontSize="12" fill="#4A5A4E">300 B</text>
                <text x="44" y="194" textAnchor="end" fontSize="12" fill="#4A5A4E">0</text>
                <text x="44" y="116.72727272727273" textAnchor="end" fontSize="12" fill="#4A5A4E">1×10⁻⁴</text>
                <text x="44" y="39.45454545454547" textAnchor="end" fontSize="12" fill="#4A5A4E">2×10⁻⁴</text><line x1="50" y1="158.68191886614633" x2="520" y2="26.681426862764482" stroke="#2E6B3F" strokeWidth="3" /><circle cx="159.66666666666669" cy="127.88180406535723" r="5" fill="#2E6B3F" /><circle cx="363.3333333333333" cy="70.68159086389177" r="5" fill="#2E6B3F" />
                <text x="167.66666666666669" y="145.88180406535724" fontSize="12" fill="#13241A">8.0×10⁻⁵ Wh</text>
                <text x="355.3333333333333" y="60.68159086389177" textAnchor="end" fontSize="12" fill="#13241A">1.5×10⁻⁴ Wh</text>
                <text x="290" y="226" textAnchor="middle" fontSize="12" fill="#4A5A4E">Active parameters</text></svg>
              <span style={{ "fontSize": "14px", "lineHeight": "21px" }} className="mth-muted">With{" "}
                <i>B</i> = 64, the equation becomes{" "}
                <span className="mth-num">e
                  <sub>GPU</sub> ≈ 5.69 × 10⁻⁷ · P
                  <sub>active</sub> + 4.05 × 10⁻⁵</span> Wh. The line goes up steadily: double the active parameters, and the energy for each token nearly doubles.</span></div></section>
          <section id="m-time" className="mth-sec">
            <h2 className="mth-dsp mth-h2">3 · Time to write the reply</h2>
            <p className="mth-p">The server works for as long as the model writes.{" "}
              <span className="mth-cs" style={{ background: mark("k6") }}>EcoLogits takes the speed of the model from its record.</span>
              <button className="mth-ct" data-cite="k6" type="button" onClick={() => pick("k6")} aria-pressed={cite === "k6"} aria-label="Source 2">2</button></p>
            {cite === "k6" && (
            <>
              <div className="mth-scard" role="note">
                <span className="mth-scn">2</span>
                <div style={{ "flex": "1", "minWidth": "0", "display": "flex", "flexDirection": "column", "gap": "3px" }}>
                  <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#6E4700" }}>Source 2 · EcoLogits documentation</span>
                  <span style={{ "fontSize": "14px", "lineHeight": "20px" }}>LLM inference: energy, time and GPUs</span>
                  <span style={{ "fontSize": "13px", "color": "#4A5A4E" }}>It supports the text in yellow.</span>
                  <a href="https://ecologits.ai/0.11/methodology/llm_inference/" target="_blank" rel="noopener noreferrer" style={{ "alignSelf": "flex-start", "display": "inline-flex", "alignItems": "center", "gap": "6px", "fontSize": "14px", "fontWeight": "600" }}>Open the EcoLogits page
                    <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "width": "14px", "height": "14px" }}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg></a></div>
                <button className="mth-sclose" type="button" onClick={() => pick("k6")} aria-label="Close the source">×</button></div></>)}
            <div className="mth-eq">
              <span>
                <em>t</em> = min({" "}
                <em>t</em>
                <sub>measured</sub> ,{" "}
                <em>n</em> / TPS + TTFT ){" "}
                <small>seconds</small></span></div>
            <div className="mth-sym">
              <div className="mth-s">TPS</div>
              <div>Tokens that the model writes in one second.</div>
              <div className="mth-v">From the EcoLogits record</div>
              <div className="mth-s">TTFT</div>
              <div>Time to the first token, in seconds.</div>
              <div className="mth-v">From the EcoLogits record</div>
              <div className="mth-s">
                <i>t</i>
                <sub>measured</sub></div>
              <div>The time that the tracker measured in your browser. EcoLogits uses the shorter time.</div>
              <div className="mth-v">See Part 1, Q12</div></div>
            <div className="mth-note">
              <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "marginTop": "2px" }}><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></svg>
              <span>
                <span className="mth-cs" style={{ background: mark("k7") }}>If the record has no speed, EcoLogits uses a fitted equation: time for each token = 6.785 × 10⁻⁴ · P
                  <sub>active</sub> + 3.119 × 10⁻⁴ · B + 0.01947 seconds.</span>
                <button className="mth-ct" data-cite="k7" type="button" onClick={() => pick("k7")} aria-pressed={cite === "k7"} aria-label="Source 5">5</button></span></div>
            {cite === "k7" && (
            <>
              <div className="mth-scard" role="note">
                <span className="mth-scn">5</span>
                <div style={{ "flex": "1", "minWidth": "0", "display": "flex", "flexDirection": "column", "gap": "3px" }}>
                  <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#6E4700" }}>Source 5 · EcoLogits code on GitHub</span>
                  <span style={{ "fontSize": "14px", "lineHeight": "20px" }}>impacts/llm.py, release 0.11.2: the equations and constants</span>
                  <span style={{ "fontSize": "13px", "color": "#4A5A4E" }}>It supports the text in yellow.</span>
                  <a href="https://github.com/mlco2/ecologits/blob/0.11.2/ecologits/impacts/llm.py" target="_blank" rel="noopener noreferrer" style={{ "alignSelf": "flex-start", "display": "inline-flex", "alignItems": "center", "gap": "6px", "fontSize": "14px", "fontWeight": "600" }}>Open the code on GitHub
                    <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "width": "14px", "height": "14px" }}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg></a></div>
                <button className="mth-sclose" type="button" onClick={() => pick("k7")} aria-label="Close the source">×</button></div></>)}
            <p className="mth-p">Example: Claude Opus 5.5 writes 75.5 tokens each second and starts after 3.43 seconds. A reply of 1,000 tokens takes 1,000 / 75.5 + 3.43 = 16.7 seconds.</p></section>
          <section id="m-server" className="mth-sec">
            <h2 className="mth-dsp mth-h2">4 and 5 · Server and data centre</h2>
            <p className="mth-p">The GPUs are not the only parts that use energy. The rest of the server uses energy too: processors, memory and fans.{" "}
              <span className="mth-cs" style={{ background: mark("k8") }}>EcoLogits sets the power of the server without its GPUs at 1.2 kW for each 8 GPUs.</span>
              <button className="mth-ct" data-cite="k8" type="button" onClick={() => pick("k8")} aria-pressed={cite === "k8"} aria-label="Source 5">5</button></p>
            {cite === "k8" && (
            <>
              <div className="mth-scard" role="note">
                <span className="mth-scn">5</span>
                <div style={{ "flex": "1", "minWidth": "0", "display": "flex", "flexDirection": "column", "gap": "3px" }}>
                  <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#6E4700" }}>Source 5 · EcoLogits code on GitHub</span>
                  <span style={{ "fontSize": "14px", "lineHeight": "20px" }}>impacts/llm.py, release 0.11.2: the equations and constants</span>
                  <span style={{ "fontSize": "13px", "color": "#4A5A4E" }}>It supports the text in yellow.</span>
                  <a href="https://github.com/mlco2/ecologits/blob/0.11.2/ecologits/impacts/llm.py" target="_blank" rel="noopener noreferrer" style={{ "alignSelf": "flex-start", "display": "inline-flex", "alignItems": "center", "gap": "6px", "fontSize": "14px", "fontWeight": "600" }}>Open the code on GitHub
                    <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "width": "14px", "height": "14px" }}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg></a></div>
                <button className="mth-sclose" type="button" onClick={() => pick("k8")} aria-label="Close the source">×</button></div></>)}
            <div className="mth-eq">
              <span>
                <em>E</em>
                <sub>server</sub> ={" "}
                <em>t</em> / 3,600 · 1.2 kW ·{" "}
                <em>g</em> / 8 · 1 /{" "}
                <em>B</em>{" "}
                <small>kWh, step 4</small></span>
              <span>
                <em>E</em>
                <sub>IT</sub> ={" "}
                <em>E</em>
                <sub>server</sub> +{" "}
                <em>E</em>
                <sub>GPU</sub>{" "}
                <small>energy of the IT equipment</small></span>
              <span>
                <em>E</em> = PUE ·{" "}
                <em>E</em>
                <sub>IT</sub>{" "}
                <small>electricity, step 5</small></span></div>
            <div className="mth-sym">
              <div className="mth-s">
                <i>t</i> / 3,600</div>
              <div>The time from step 3, in hours.</div><div className="mth-v" />
              <div className="mth-s">
                <i>g</i> / 8</div>
              <div>One server holds 8 GPUs. This is the number of servers that the model uses.</div><div className="mth-v" />
              <div className="mth-s">1 /{" "}
                <i>B</i></div>
              <div>64 requests share the server at the same time. So one request gets 1/64.</div><div className="mth-v" />
              <div className="mth-s">PUE</div>
              <div>Power usage effectiveness. It adds the energy for cooling and power losses in the data centre. A PUE of 1.09 adds 9%.</div>
              <div className="mth-v">For each provider, see the table</div></div>
            <div className="mth-card" style={{ "overflowX": "auto" }}>
              <table style={{ "width": "100%", "borderCollapse": "collapse", "minWidth": "560px" }}>
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Data-centre location</th>
                    <th>PUE</th>
                    <th>WUE, L for each kWh</th></tr></thead>
                <tbody>
                  <tr>
                    <td>
                      <b>Anthropic</b></td>
                    <td>United States</td>
                    <td className="mth-num">1.09 to 1.14</td>
                    <td className="mth-num">0.13 to 0.999</td></tr>
                  <tr>
                    <td>
                      <b>OpenAI</b></td>
                    <td>United States</td>
                    <td className="mth-num">1.20</td>
                    <td className="mth-num">0.569</td></tr>
                  <tr>
                    <td>
                      <b>Google</b></td>
                    <td>United States</td>
                    <td className="mth-num">1.09</td>
                    <td className="mth-num">0.999</td></tr></tbody></table></div>
            <p className="mth-p" style={{ "fontSize": "15px", "lineHeight": "24px" }}>
              <span className="mth-cs" style={{ background: mark("k9") }}>These values come from the EcoLogits settings for each provider.</span>
              <button className="mth-ct" data-cite="k9" type="button" onClick={() => pick("k9")} aria-pressed={cite === "k9"} aria-label="Source 6">6</button> Anthropic gives a range, so its PUE and WUE are ranges too.</p>
            {cite === "k9" && (
            <>
              <div className="mth-scard" role="note">
                <span className="mth-scn">6</span>
                <div style={{ "flex": "1", "minWidth": "0", "display": "flex", "flexDirection": "column", "gap": "3px" }}>
                  <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#6E4700" }}>Source 6 · EcoLogits code on GitHub</span>
                  <span style={{ "fontSize": "14px", "lineHeight": "20px" }}>tracers/utils.py, release 0.11.2: location, PUE and WUE for each provider</span>
                  <span style={{ "fontSize": "13px", "color": "#4A5A4E" }}>It supports the text in yellow.</span>
                  <a href="https://github.com/mlco2/ecologits/blob/0.11.2/ecologits/tracers/utils.py" target="_blank" rel="noopener noreferrer" style={{ "alignSelf": "flex-start", "display": "inline-flex", "alignItems": "center", "gap": "6px", "fontSize": "14px", "fontWeight": "600" }}>Open the code on GitHub
                    <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "width": "14px", "height": "14px" }}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg></a></div>
                <button className="mth-sclose" type="button" onClick={() => pick("k9")} aria-label="Close the source">×</button></div></>)}</section>
          <section id="m-carbon" className="mth-sec">
            <h2 className="mth-dsp mth-h2">Carbon</h2>
            <p className="mth-p">
              <span className="mth-cs" style={{ background: mark("k10") }}>Carbon is the electricity multiplied by the carbon intensity of the grid where the data centre is. EcoLogits takes the value for each country from Our World in Data.</span>
              <button className="mth-ct" data-cite="k10" type="button" onClick={() => pick("k10")} aria-pressed={cite === "k10"} aria-label="Source 2">2</button></p>
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
            <div className="mth-eq">
              <span>
                <em>C</em> ={" "}
                <em>E</em> ·{" "}
                <em>I</em>
                <sub>grid</sub>{" "}
                <small>g CO₂e</small></span></div>
            <div className="mth-sym">
              <div className="mth-s">
                <i>E</i></div>
              <div>Electricity from step 5, in kWh.</div><div className="mth-v" />
              <div className="mth-s">
                <i>I</i>
                <sub>grid</sub></div>
              <div>
                <span className="mth-cs" style={{ background: mark("k11") }}>Carbon of the grid for each kWh. United States: 384.4 g CO₂e.</span>
                <button className="mth-ct" data-cite="k11" type="button" onClick={() => pick("k11")} aria-pressed={cite === "k11"} aria-label="Source 7">7</button></div>
              <div className="mth-v">The same value for Anthropic, OpenAI and Google</div>
              <div className="mth-s">CO₂e</div>
              <div>Carbon dioxide equivalent. It also counts other greenhouse gases, converted to the effect of CO₂.</div><div className="mth-v" /></div>
            {cite === "k11" && (
            <>
              <div className="mth-scard" role="note">
                <span className="mth-scn">7</span>
                <div style={{ "flex": "1", "minWidth": "0", "display": "flex", "flexDirection": "column", "gap": "3px" }}>
                  <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#6E4700" }}>Source 7 · EcoLogits data on GitHub</span>
                  <span style={{ "fontSize": "14px", "lineHeight": "20px" }}>data/electricity_mixes.json, release 0.11.2: carbon and water of each grid</span>
                  <span style={{ "fontSize": "13px", "color": "#4A5A4E" }}>It supports the text in yellow.</span>
                  <a href="https://github.com/mlco2/ecologits/blob/0.11.2/ecologits/data/electricity_mixes.json" target="_blank" rel="noopener noreferrer" style={{ "alignSelf": "flex-start", "display": "inline-flex", "alignItems": "center", "gap": "6px", "fontSize": "14px", "fontWeight": "600" }}>Open the data on GitHub
                    <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "width": "14px", "height": "14px" }}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg></a></div>
                <button className="mth-sclose" type="button" onClick={() => pick("k11")} aria-label="Close the source">×</button></div></>)}</section>
          <section id="m-water" className="mth-sec">
            <h2 className="mth-dsp mth-h2">Water</h2>
            <p className="mth-p">Water here means water that evaporates and does not come back.{" "}
              <span className="mth-cs" style={{ background: mark("k12") }}>EcoLogits counts two parts: cooling in the data centre, and water at the power stations that make the electricity.</span>
              <button className="mth-ct" data-cite="k12" type="button" onClick={() => pick("k12")} aria-pressed={cite === "k12"} aria-label="Source 2">2</button></p>
            {cite === "k12" && (
            <>
              <div className="mth-scard" role="note">
                <span className="mth-scn">2</span>
                <div style={{ "flex": "1", "minWidth": "0", "display": "flex", "flexDirection": "column", "gap": "3px" }}>
                  <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#6E4700" }}>Source 2 · EcoLogits documentation</span>
                  <span style={{ "fontSize": "14px", "lineHeight": "20px" }}>LLM inference: energy, time and GPUs</span>
                  <span style={{ "fontSize": "13px", "color": "#4A5A4E" }}>It supports the text in yellow.</span>
                  <a href="https://ecologits.ai/0.11/methodology/llm_inference/" target="_blank" rel="noopener noreferrer" style={{ "alignSelf": "flex-start", "display": "inline-flex", "alignItems": "center", "gap": "6px", "fontSize": "14px", "fontWeight": "600" }}>Open the EcoLogits page
                    <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "width": "14px", "height": "14px" }}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg></a></div>
                <button className="mth-sclose" type="button" onClick={() => pick("k12")} aria-label="Close the source">×</button></div></>)}
            <div style={{ "display": "grid", "gridTemplateColumns": "minmax(0, 1fr) 30px minmax(0, 1fr)", "gap": "8px", "alignItems": "stretch" }}>
              <div style={{ "padding": "18px", "borderRadius": "18px", "background": "#E7F1FA", "display": "flex", "flexDirection": "column", "gap": "6px" }}>
                <span style={{ "fontSize": "13px", "fontWeight": "700", "color": "#1D69AE" }}>On site</span>
                <b style={{ "fontSize": "16px" }}>Cooling of the servers</b>
                <span className="mth-num" style={{ "fontSize": "15px" }}>E
                  <sub>IT</sub> · WUE</span></div>
              <div style={{ "display": "grid", "placeItems": "center", "fontSize": "24px", "fontWeight": "700", "color": "#1D69AE" }}>+</div>
              <div style={{ "padding": "18px", "borderRadius": "18px", "background": "#E7F1FA", "display": "flex", "flexDirection": "column", "gap": "6px" }}>
                <span style={{ "fontSize": "13px", "fontWeight": "700", "color": "#1D69AE" }}>Off site</span>
                <b style={{ "fontSize": "16px" }}>Power stations</b>
                <span className="mth-num" style={{ "fontSize": "15px" }}>E
                  <sub>IT</sub> · PUE · EWIF</span></div></div>
            <div className="mth-eq">
              <span>
                <em>W</em> ={" "}
                <em>E</em>
                <sub>IT</sub> · ( WUE + PUE · EWIF ){" "}
                <small>litres</small></span></div>
            <div className="mth-sym">
              <div className="mth-s">WUE</div>
              <div>Water usage effectiveness: litres of cooling water for each kWh of IT energy.</div>
              <div className="mth-v">For each provider, see step 5</div>
              <div className="mth-s">EWIF</div>
              <div>
                <span className="mth-cs" style={{ background: mark("k13") }}>Water for each kWh of grid electricity. United States: 3.132 L.</span>
                <button className="mth-ct" data-cite="k13" type="button" onClick={() => pick("k13")} aria-pressed={cite === "k13"} aria-label="Source 7">7</button></div><div className="mth-v" />
              <div className="mth-s">PUE</div>
              <div>The power stations make all the electricity of the data centre, so EWIF is multiplied by PUE.</div><div className="mth-v" /></div>
            {cite === "k13" && (
            <>
              <div className="mth-scard" role="note">
                <span className="mth-scn">7</span>
                <div style={{ "flex": "1", "minWidth": "0", "display": "flex", "flexDirection": "column", "gap": "3px" }}>
                  <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#6E4700" }}>Source 7 · EcoLogits data on GitHub</span>
                  <span style={{ "fontSize": "14px", "lineHeight": "20px" }}>data/electricity_mixes.json, release 0.11.2: carbon and water of each grid</span>
                  <span style={{ "fontSize": "13px", "color": "#4A5A4E" }}>It supports the text in yellow.</span>
                  <a href="https://github.com/mlco2/ecologits/blob/0.11.2/ecologits/data/electricity_mixes.json" target="_blank" rel="noopener noreferrer" style={{ "alignSelf": "flex-start", "display": "inline-flex", "alignItems": "center", "gap": "6px", "fontSize": "14px", "fontWeight": "600" }}>Open the data on GitHub
                    <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "width": "14px", "height": "14px" }}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg></a></div>
                <button className="mth-sclose" type="button" onClick={() => pick("k13")} aria-label="Close the source">×</button></div></>)}
            <p className="mth-p">For 1 kWh of IT energy, the water is 3.54 to 4.57 L for Anthropic, 4.33 L for OpenAI and 4.41 L for Google.</p></section>
          <section id="m-ranges" className="mth-sec">
            <h2 className="mth-dsp mth-h2">Ranges for closed models</h2>
            <p className="mth-p">
              <span className="mth-cs" style={{ background: mark("k14") }}>Providers do not publish the size of their closed models. EcoLogits estimates the total parameters. For mixture-of-experts models, it assumes that 10% to 30% of the parameters are active.</span>
              <button className="mth-ct" data-cite="k14" type="button" onClick={() => pick("k14")} aria-pressed={cite === "k14"} aria-label="Source 3">3</button> Example: the EcoLogits record of Claude Opus 5.5 has 670 B parameters, and 70 to 200 B of them are active.</p>
            {cite === "k14" && (
            <>
              <div className="mth-scard" role="note">
                <span className="mth-scn">3</span>
                <div style={{ "flex": "1", "minWidth": "0", "display": "flex", "flexDirection": "column", "gap": "3px" }}>
                  <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#6E4700" }}>Source 3 · EcoLogits documentation</span>
                  <span style={{ "fontSize": "14px", "lineHeight": "20px" }}>Proprietary models: parameter ranges</span>
                  <span style={{ "fontSize": "13px", "color": "#4A5A4E" }}>It supports the text in yellow.</span>
                  <a href="https://ecologits.ai/0.11/methodology/proprietary_models/" target="_blank" rel="noopener noreferrer" style={{ "alignSelf": "flex-start", "display": "inline-flex", "alignItems": "center", "gap": "6px", "fontSize": "14px", "fontWeight": "600" }}>Open the EcoLogits page
                    <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "width": "14px", "height": "14px" }}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg></a></div>
                <button className="mth-sclose" type="button" onClick={() => pick("k14")} aria-label="Close the source">×</button></div></>)}
            <p className="mth-p">
              <span className="mth-cs" style={{ background: mark("k15") }}>EcoLogits then does the calculation twice. The first run uses all low values: low parameters, low PUE and low WUE. The second run uses all high values.</span>
              <button className="mth-ct" data-cite="k15" type="button" onClick={() => pick("k15")} aria-pressed={cite === "k15"} aria-label="Source 8">8</button> The midpoint is the average of the two.</p>
            {cite === "k15" && (
            <>
              <div className="mth-scard" role="note">
                <span className="mth-scn">8</span>
                <div style={{ "flex": "1", "minWidth": "0", "display": "flex", "flexDirection": "column", "gap": "3px" }}>
                  <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#6E4700" }}>Source 8 · EcoLogits code on GitHub</span>
                  <span style={{ "fontSize": "14px", "lineHeight": "20px" }}>utils/range_value.py, release 0.11.2: how ranges multiply</span>
                  <span style={{ "fontSize": "13px", "color": "#4A5A4E" }}>It supports the text in yellow.</span>
                  <a href="https://github.com/mlco2/ecologits/blob/0.11.2/ecologits/utils/range_value.py" target="_blank" rel="noopener noreferrer" style={{ "alignSelf": "flex-start", "display": "inline-flex", "alignItems": "center", "gap": "6px", "fontSize": "14px", "fontWeight": "600" }}>Open the code on GitHub
                    <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "width": "14px", "height": "14px" }}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg></a></div>
                <button className="mth-sclose" type="button" onClick={() => pick("k15")} aria-label="Close the source">×</button></div></>)}
            <p className="mth-p">The worked example below shows both ends for one reply. Totals add the same end of each estimate. These ends are scenarios, not a statistical confidence interval. The real value can be anywhere in the range, or outside it if an assumption is not correct.</p></section>
          <section id="m-video" className="mth-sec">
            <h2 className="mth-dsp mth-h2">Video</h2>
            <p className="mth-p">
              <span className="mth-cs" style={{ background: mark("k16") }}>For video, EcoLogits calculates the time that the server needs to make the video. It uses one fitted equation for each video model. The equation uses the number of frames and the resolution.</span>
              <button className="mth-ct" data-cite="k16" type="button" onClick={() => pick("k16")} aria-pressed={cite === "k16"} aria-label="Source 4">4</button></p>
            {cite === "k16" && (
            <>
              <div className="mth-scard" role="note">
                <span className="mth-scn">4</span>
                <div style={{ "flex": "1", "minWidth": "0", "display": "flex", "flexDirection": "column", "gap": "3px" }}>
                  <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#6E4700" }}>Source 4 · EcoLogits documentation</span>
                  <span style={{ "fontSize": "14px", "lineHeight": "20px" }}>Video generation</span>
                  <span style={{ "fontSize": "13px", "color": "#4A5A4E" }}>It supports the text in yellow.</span>
                  <a href="https://ecologits.ai/0.11/methodology/video_generation/" target="_blank" rel="noopener noreferrer" style={{ "alignSelf": "flex-start", "display": "inline-flex", "alignItems": "center", "gap": "6px", "fontSize": "14px", "fontWeight": "600" }}>Open the EcoLogits page
                    <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "width": "14px", "height": "14px" }}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg></a></div>
                <button className="mth-sclose" type="button" onClick={() => pick("k16")} aria-label="Close the source">×</button></div></>)}
            <div className="mth-eq">
              <span>
                <em>F</em> = 24 ·{" "}
                <em>s</em> + 1{" "}
                <small>frames</small></span>
              <span>
                <em>t</em> ={" "}
                <em>f</em>
                <sub>model</sub>({" "}
                <em>F</em> ,{" "}
                <em>W</em> ×{" "}
                <em>H</em> ){" "}
                <small>seconds, capped by the measured time</small></span>
              <span>
                <em>E</em> = PUE ·{" "}
                <em>t</em> / 3,600 ·{" "}
                <em>P</em>
                <sub>server</sub>{" "}
                <small>kWh</small></span></div>
            <p className="mth-p">
              <i>s</i> is the length in seconds and{" "}
              <i>W</i> ×{" "}
              <i>H</i> the resolution in pixels.{" "}
              <i>f</i>
              <sub>model</sub> is the fitted time equation of the video model.{" "}
              <span className="mth-cs" style={{ background: mark("k17") }}>P
                <sub>server</sub> is the power of the full server, as a range</span>
              <button className="mth-ct" data-cite="k17" type="button" onClick={() => pick("k17")} aria-pressed={cite === "k17"} aria-label="Source 4">4</button>, for example 1.07 to 2.35 kW for Veo 3.1 on TPU v6e.</p>
            {cite === "k17" && (
            <>
              <div className="mth-scard" role="note">
                <span className="mth-scn">4</span>
                <div style={{ "flex": "1", "minWidth": "0", "display": "flex", "flexDirection": "column", "gap": "3px" }}>
                  <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#6E4700" }}>Source 4 · EcoLogits documentation</span>
                  <span style={{ "fontSize": "14px", "lineHeight": "20px" }}>Video generation</span>
                  <span style={{ "fontSize": "13px", "color": "#4A5A4E" }}>It supports the text in yellow.</span>
                  <a href="https://ecologits.ai/0.11/methodology/video_generation/" target="_blank" rel="noopener noreferrer" style={{ "alignSelf": "flex-start", "display": "inline-flex", "alignItems": "center", "gap": "6px", "fontSize": "14px", "fontWeight": "600" }}>Open the EcoLogits page
                    <svg className="mth-i" viewBox="0 0 24 24" aria-hidden="true" style={{ "width": "14px", "height": "14px" }}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg></a></div>
                <button className="mth-sclose" type="button" onClick={() => pick("k17")} aria-label="Close the source">×</button></div></>)}
            <p className="mth-p">Carbon and water use the same equations as text.</p></section>
          <section id="m-example" className="mth-sec">
            <h2 className="mth-dsp mth-h2">A worked example</h2>
            <p className="mth-p">Claude Opus 5.5 writes a reply of 1,000 tokens. The values below come from the EcoLogits code in the tracker. You can do the same calculation with the equations above.</p>
            <div className="mth-card" style={{ "overflowX": "auto" }}>
              <table style={{ "width": "100%", "borderCollapse": "collapse", "minWidth": "560px" }}>
                <thead>
                  <tr>
                    <th>Value</th>
                    <th>Result</th>
                    <th>Source of the value</th></tr></thead>
                <tbody>
                  <tr>
                    <td>Output tokens{" "}
                      <i>n</i></td>
                    <td className="mth-num">1,000</td>
                    <td className="mth-muted">Selected for the example</td></tr>
                  <tr>
                    <td>Active / total parameters</td>
                    <td className="mth-num">70 to 200 B / 670 B</td>
                    <td className="mth-muted">EcoLogits record</td></tr>
                  <tr>
                    <td>GPUs{" "}
                      <i>g</i></td>
                    <td className="mth-num">32</td>
                    <td className="mth-muted">Step 1</td></tr>
                  <tr>
                    <td>Time{" "}
                      <i>t</i></td>
                    <td className="mth-num">16.7 s</td>
                    <td className="mth-muted">Step 3: 1,000 / 75.5 + 3.43</td></tr>
                  <tr>
                    <td>GPU energy / server energy</td>
                    <td className="mth-num">2.57 to 4.94 Wh / 0.35 Wh</td>
                    <td className="mth-muted">Steps 2 and 4</td></tr>
                  <tr>
                    <td>PUE / WUE</td>
                    <td className="mth-num">1.09 to 1.14 / 0.13 to 0.999 L/kWh</td>
                    <td className="mth-muted">EcoLogits settings for Anthropic</td></tr></tbody></table></div>
            <div style={{ "display": "grid", "gridTemplateColumns": "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", "gap": "10px" }}>
              <div style={{ "padding": "18px", "borderRadius": "18px", "background": "#FFF6DB", "display": "flex", "flexDirection": "column", "gap": "4px" }}>
                <span style={{ "fontSize": "14px", "fontWeight": "600", "color": "#8A5A00" }}>Electricity</span>
                <span className="mth-dsp mth-num" style={{ "fontSize": "28px", "fontWeight": "700" }}>3.18 to 6.03 Wh</span>
                <span className="mth-num" style={{ "fontSize": "14px", "color": "#5E4300" }}>(2.57 + 0.35) × 1.09 for the minimum</span></div>
              <div style={{ "padding": "18px", "borderRadius": "18px", "background": "#F1EFEA", "display": "flex", "flexDirection": "column", "gap": "4px" }}>
                <span style={{ "fontSize": "14px", "fontWeight": "600", "color": "#5B564C" }}>Carbon</span>
                <span className="mth-dsp mth-num" style={{ "fontSize": "28px", "fontWeight": "700" }}>1.22 to 2.32 g</span>
                <span className="mth-num" style={{ "fontSize": "14px", "color": "#5B564C" }}>electricity × 384.4 g CO₂e for each kWh</span></div>
              <div style={{ "padding": "18px", "borderRadius": "18px", "background": "#E7F1FA", "display": "flex", "flexDirection": "column", "gap": "4px" }}>
                <span style={{ "fontSize": "14px", "fontWeight": "600", "color": "#1D69AE" }}>Water</span>
                <span className="mth-dsp mth-num" style={{ "fontSize": "28px", "fontWeight": "700" }}>10.3 to 24.2 mL</span>
                <span className="mth-num" style={{ "fontSize": "14px", "color": "#1D4F80" }}>2.92 Wh × (0.13 + 1.09 × 3.132) for the minimum</span></div></div></section>
          <section id="m-sources" className="mth-sec">
            <h2 className="mth-dsp mth-h2">Sources</h2>
            <p className="mth-p">Each number in the text points to one of these sources. All links were checked on 11 October 2026.</p>
            <div style={{ "display": "grid", "gridTemplateColumns": "repeat(auto-fit, minmax(min(360px, 100%), 1fr))", "gap": "6px 12px" }}>
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
              <div className="mth-ref" id="src-7" style={{ background: source(7) }}>
                <span className="mth-scn" style={{ "background": "#EEF1E8", "color": "#1F5A2E" }}>7</span>
                <div style={{ "display": "flex", "flexDirection": "column", "gap": "2px", "minWidth": "0" }}>
                  <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#4A5A4E" }}>EcoLogits data on GitHub</span>
                  <span>data/electricity_mixes.json, release 0.11.2: carbon and water of each grid</span>
                  <a href="https://github.com/mlco2/ecologits/blob/0.11.2/ecologits/data/electricity_mixes.json" target="_blank" rel="noopener noreferrer" style={{ "fontSize": "14px", "wordBreak": "break-all" }}>github.com/mlco2/ecologits/blob/0.11.2/ecologits/data/electricity_mixes.json</a></div></div>
              <div className="mth-ref" id="src-8" style={{ background: source(8) }}>
                <span className="mth-scn" style={{ "background": "#EEF1E8", "color": "#1F5A2E" }}>8</span>
                <div style={{ "display": "flex", "flexDirection": "column", "gap": "2px", "minWidth": "0" }}>
                  <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#4A5A4E" }}>EcoLogits code on GitHub</span>
                  <span>utils/range_value.py, release 0.11.2: how ranges multiply</span>
                  <a href="https://github.com/mlco2/ecologits/blob/0.11.2/ecologits/utils/range_value.py" target="_blank" rel="noopener noreferrer" style={{ "fontSize": "14px", "wordBreak": "break-all" }}>github.com/mlco2/ecologits/blob/0.11.2/ecologits/utils/range_value.py</a></div></div>
              <div className="mth-ref" id="src-9" style={{ background: source(9) }}>
                <span className="mth-scn" style={{ "background": "#EEF1E8", "color": "#1F5A2E" }}>9</span>
                <div style={{ "display": "flex", "flexDirection": "column", "gap": "2px", "minWidth": "0" }}>
                  <span style={{ "fontSize": "12px", "fontWeight": "700", "color": "#4A5A4E" }}>EcoLogits project</span>
                  <span>EcoLogits repository, MPL 2.0 licence. Rincé, S. and Banse, A. EcoLogits: Evaluating the Environmental Impacts of Generative AI. JOSS 10(111), 7471, doi:10.21105/joss.07471</span>
                  <a href="https://github.com/mlco2/ecologits" target="_blank" rel="noopener noreferrer" style={{ "fontSize": "14px", "wordBreak": "break-all" }}>github.com/mlco2/ecologits</a></div></div></div></section>
          {reference}
          {credit && (<p className="mth-credit" style={{ "margin": "0", "textAlign": "center", "fontSize": "14px", "lineHeight": "19px", "color": "#4A5A4E", "padding": "16px 0 8px" }}>Designed and built by{" "}
            <a href="https://www.linkedin.com/in/pranitnale/" target="_blank" rel="noopener noreferrer" style={{ "color": "#2E6B3F", "fontWeight": "600", "textDecoration": "underline", "textUnderlineOffset": "2px" }}>Pranit Nale</a></p>)}</article></div>
    </>
  );
}
