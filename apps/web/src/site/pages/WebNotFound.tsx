// Generated from the canvas board WebNotFound (board2jsx), then wired by hand. Static copy follows the board.
import type { Navigate } from "../../router";
import { todo } from "../board";

export function WebNotFoundPage({ navigate }: { navigate: Navigate }) {
  void navigate;
  return (
    <>
      <section className="wrap" style={{ "flex": "1", "width": "100%", "paddingTop": "80px", "paddingBottom": "80px", "display": "flex", "flexWrap": "wrap", "gap": "48px", "alignItems": "center", "justifyContent": "center" }}>
        <svg viewBox="0 0 64 64" style={{ "width": "180px", "height": "180px", "color": "#C9D3C3" }} aria-hidden="true"><path d="M27 6 A27 27 0 0 0 21 57 M37 6 A27 27 0 0 1 43 57" fill="none" stroke="currentColor" strokeWidth="10" /><path d="M23 42 C18 28 30 20 43 17 C42 29 37 43 25 42 L22 47 Z" fill="#8DBB6E" /></svg>
        <div style={{ "display": "flex", "flexDirection": "column", "gap": "16px", "maxWidth": "460px" }}>
          <span className="dsp num" style={{ "fontSize": "20px", "fontWeight": "700", "color": "#2E6B3F" }}>404</span>
          <h1 className="dsp" style={{ "margin": "0", "fontSize": "48px", "lineHeight": "1.05", "fontWeight": "800" }}>This page does not exist.</h1>
          <p className="p" style={{ "fontSize": "17px", "lineHeight": "26px" }}>The link may be old or mistyped.</p>
          <div style={{ "display": "flex", "flexWrap": "wrap", "gap": "10px" }}>
            <a className="btn pri" href="/">Go to the home page</a>
            <a className="btn sec" href="/methodology">Read the methodology</a></div></div></section>
    </>
  );
}
