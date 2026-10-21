// Generated from the canvas board WebImprint (board2jsx), then wired by hand. Static copy follows the board.
import type { Navigate } from "../../router";
import { SOURCE_REPOSITORY_LABEL, SOURCE_REPOSITORY_URL } from "../repository";

export function WebImprintPage({ navigate }: { navigate: Navigate }) {
  void navigate;
  return (
    <>
      <section className="wrap" style={{ "paddingTop": "56px", "paddingBottom": "28px", "display": "flex", "flexDirection": "column", "gap": "14px" }}>
        <span style={{ "fontSize": "13px", "fontWeight": "700", "letterSpacing": ".08em", "textTransform": "uppercase", "color": "#2E6B3F" }}>Legal</span>
        <h1 className="dsp" style={{ "margin": "0", "fontSize": "clamp(34px, 4vw, 52px)", "lineHeight": "1.08", "fontWeight": "800", "letterSpacing": "-.02em" }}>Imprint</h1>
        <p className="lead">Information under Section 5 of the German Digital Services Act (DDG) and Section 18(1) of the German Interstate Media Treaty (MStV).</p></section>
      <section className="wrap" style={{ "paddingBottom": "88px" }}>
        <div className="doc">
          <nav className="toc" aria-label="On this page">
            <a href="#provider">Provider</a>
            <a href="#contact">Contact</a>
            <a href="#source-code">Source code</a></nav>
          <article className="art">
            <h2 id="provider">Provider</h2>
            <p>Pranit Jagannath Nale</p>
            <h2 id="contact">Contact</h2>
            <ul>
              <li>Email:{" "}
                <a href="mailto:pranitnale42@gmail.com">pranitnale42@gmail.com</a></li>
              <li>Contact form:{" "}
                <a href="/contact">Contact us</a></li></ul>
            <h2 id="source-code">Source code</h2>
            <p>The source code is published at{" "}
              <a href={SOURCE_REPOSITORY_URL} target="_blank" rel="noopener noreferrer">{SOURCE_REPOSITORY_LABEL}</a>.</p></article></div></section>
    </>
  );
}
