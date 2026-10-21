// Generated from the canvas board WebOpenSource (board2jsx), then wired by hand. Static copy follows the board.
import type { Navigate } from "../../router";
import { licenceGroups } from "../licences";
import { SOURCE_REPOSITORY_URL } from "../repository";
import { ThirdPartyNotices } from "../ThirdPartyNotices";

const licences = licenceGroups();

export function WebOpenSourcePage({ navigate }: { navigate: Navigate }) {
  void navigate;
  return (
    <>
      <section className="wrap" style={{ "paddingTop": "64px", "paddingBottom": "36px", "display": "flex", "flexDirection": "column", "gap": "14px" }}>
        <h1 className="dsp" style={{ "margin": "0", "fontSize": "clamp(38px, 4.6vw, 60px)", "lineHeight": "1.05", "fontWeight": "800", "letterSpacing": "-.02em" }}>Read the code. Host it yourself.</h1>
        <p style={{ "margin": "0", "fontSize": "19px", "lineHeight": "29px", "color": "#4A5A4E", "maxWidth": "760px" }}>Our own code is under the MIT License. Third-party code, models and data keep their own terms and notices.</p></section>
      <section className="wrap" style={{ "paddingBottom": "32px", "display": "grid", "gridTemplateColumns": "repeat(auto-fit, minmax(min(420px, 100%), 1fr))", "gap": "16px" }}>
        <div className="card pc">
          <b className="dsp" style={{ "fontSize": "22px" }}>Everything is open to inspect</b>
          <div style={{ "display": "flex", "flexWrap": "wrap", "gap": "8px" }}>
            <span className="tagl">Extension</span>
            <span className="tagl">Server</span>
            <span className="tagl">Calculation</span>
            <span className="tagl">Data schemas</span>
            <span className="tagl">Tests</span>
            <span className="tagl">Deployment files</span></div>
          <p className="p">Estimates use EcoLogits. Each estimate records the method version it used.</p>
          <div style={{ "display": "flex", "flexWrap": "wrap", "gap": "10px", "marginTop": "auto" }}>
            <a className="btn pri" href={SOURCE_REPOSITORY_URL} target="_blank" rel="noopener noreferrer">Open the repository</a>
            <a className="btn sec" href="/methodology">Read the methodology</a></div></div>
        <div className="card pc">
          <b className="dsp" style={{ "fontSize": "22px" }}>Third-party components</b>
          <div style={{ "display": "flex", "gap": "24px", "alignItems": "center", "flexWrap": "wrap" }}>
            <svg viewBox="0 0 120 120" style={{ "width": "150px", "height": "150px", "flex": "none" }} aria-label={`${licences.total} components by licence`} role="img">
              {licences.groups.map((a) => (
                <circle key={a.key} cx="60" cy="60" r="48" fill="none" stroke={a.color} strokeWidth="16" strokeDasharray={a.dash} strokeDashoffset={a.offset} transform="rotate(-90 60 60)" />
              ))}
              <text x="60" y="60" textAnchor="middle" fontFamily="Bricolage Grotesque, system-ui" fontSize="26" fontWeight="700" fill="#13241A">{licences.total}</text>
              <text x="60" y="78" textAnchor="middle" fontFamily="Instrument Sans, system-ui" fontSize="11" fill="#4A5A4E">components</text></svg>
            <div style={{ "display": "flex", "flexDirection": "column", "gap": "8px", "flex": "1", "minWidth": "180px" }}>
              {licences.groups.map((a) => (
                <div key={a.key} style={{ "display": "flex", "justifyContent": "space-between", "gap": "12px", "fontSize": "15px" }}>
                  <span style={{ "display": "inline-flex", "alignItems": "center", "gap": "8px" }}><span style={{ width: 12, height: 12, borderRadius: 4, background: a.color }} />{a.name}</span>
                  <b className="num">{a.n}</b></div>
              ))}</div></div>
          <a href="#notices" style={{ "fontSize": "15px", "fontWeight": "600" }}>See the full list with notices</a></div></section>
      <section className="wrap" style={{ "paddingBottom": "32px", "display": "grid", "gridTemplateColumns": "repeat(auto-fit, minmax(min(420px, 100%), 1fr))", "gap": "16px" }}>
        <div className="card pc">
          <b className="dsp" style={{ "fontSize": "22px" }}>Security and contributions</b>
          <p className="p">Please keep credentials, signed-in page captures and employee data out of public issues. Report security concerns privately.</p>
          <a className="btn sec" href="mailto:pranitnale42@gmail.com" style={{ "alignSelf": "flex-start" }}>Email the security contact</a></div>
        <div className="card pc" style={{ "background": "#0F2A1C", "borderColor": "#0F2A1C", "color": "#F4F5EF" }}>
          <b className="dsp" style={{ "fontSize": "22px" }}>Open code is not proof</b>
          <p style={{ "margin": "0", "fontSize": "15px", "lineHeight": "23px", "color": "#B9CDBE" }}>Being able to rerun the code does not prove the figures are physically exact. Method versions, inputs, sources and known limits stay part of every estimate.</p></div></section>
      <section className="wrap" id="notices" style={{ "paddingBottom": "56px", "scrollMarginTop": "24px" }}>
        <ThirdPartyNotices /></section>
    </>
  );
}
