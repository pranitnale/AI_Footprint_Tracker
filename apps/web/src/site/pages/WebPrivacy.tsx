// Generated from the canvas board WebPrivacy (board2jsx), then wired by hand. Static copy follows the board.
import type { Navigate } from "../../router";

const NEVER = [
  "Prompts, answers or thinking text",
  "Retrieved passages or source links",
  "Documents, file names or chat titles",
  "The site’s own chat or message ids",
  "AI account passwords, cookies or sign-in tokens",
  "Unrelated browsing history",
];

export function WebPrivacyPage({ navigate }: { navigate: Navigate }) {
  void navigate;
  return (
    <>
      <section className="wrap" style={{ "paddingTop": "64px", "paddingBottom": "36px", "display": "flex", "flexDirection": "column", "gap": "14px" }}>
        <h1 className="dsp" style={{ "margin": "0", "fontSize": "clamp(38px, 4.6vw, 60px)", "lineHeight": "1.05", "fontWeight": "800", "letterSpacing": "-.02em" }}>Privacy and data flow</h1>
        <p style={{ "margin": "0", "fontSize": "19px", "lineHeight": "29px", "color": "#4A5A4E", "maxWidth": "760px" }}>Chat text is counted inside your browser and then let go. The extension does not keep another copy of your conversations.</p></section>
      <section className="wrap" style={{ "paddingBottom": "40px" }}>
        <div className="card" style={{ "padding": "28px", "display": "flex", "flexDirection": "column", "gap": "20px" }}>
          <b className="dsp" style={{ "fontSize": "22px" }}>Where your data goes</b>
          <div style={{ "display": "grid", "gridTemplateColumns": "repeat(auto-fit, minmax(min(320px, 100%), 1fr))", "gap": "16px" }}>
            <div className="lane" style={{ "background": "#F4F5EF" }}>
              <span className="pill" style={{ "alignSelf": "flex-start", "background": "#0F2A1C", "color": "#B9E27C" }}>Your browser</span>
              <span style={{ "fontSize": "15px", "lineHeight": "23px" }}>Reads the chat page, counts the text and estimates the footprint. The text is not stored.</span>
              <div style={{ "display": "flex", "flexWrap": "wrap", "gap": "8px" }}>
                <span className="pill" style={{ "background": "#FFFFFF", "border": "1px solid #DCE2D6" }}>Counts</span>
                <span className="pill" style={{ "background": "#FFFFFF", "border": "1px solid #DCE2D6" }}>Model names</span>
                <span className="pill" style={{ "background": "#FFFFFF", "border": "1px solid #DCE2D6" }}>Times</span>
                <span className="pill" style={{ "background": "#FFFFFF", "border": "1px solid #DCE2D6" }}>Estimates</span></div></div>
            <div className="lane" style={{ "background": "#E3F0E1" }}>
              <span className="pill" style={{ "alignSelf": "flex-start", "background": "#FFFFFF", "color": "#1F5A2E" }}>Personal mode</span>
              <span style={{ "fontSize": "15px", "lineHeight": "23px", "color": "#1F3F29" }}>Numbers stay in this browser profile. Our server is not contacted until you choose Connect.</span>
              <span style={{ "fontSize": "14px", "lineHeight": "21px", "color": "#2E3F33" }}>Connecting later does not upload the personal history you already have.</span></div>
            <div className="lane" style={{ "background": "#0F2A1C", "color": "#F4F5EF" }}>
              <span className="pill" style={{ "alignSelf": "flex-start", "background": "#B9E27C", "color": "#0F2A1C" }}>Organization mode</span>
              <span style={{ "fontSize": "15px", "lineHeight": "23px", "color": "#DDE8DF" }}>Numbers go to your organization: usage, tools, models, request times and coverage, linked to your verified work email.</span>
              <span style={{ "fontSize": "14px", "lineHeight": "21px", "color": "#B9CDBE" }}>Never the text itself.</span></div></div></div></section>
      <section className="wrap" style={{ "paddingBottom": "40px", "display": "grid", "gridTemplateColumns": "repeat(auto-fit, minmax(min(340px, 100%), 1fr))", "gap": "16px" }}>
        <div className="card pc">
          <b className="dsp" style={{ "fontSize": "20px" }}>Earlier messages</b>
          <p className="p">When you open an older chat, numbers from its earlier messages are counted too. In organization mode they belong to your connected account and can date from before you joined.</p></div>
        <div className="card pc">
          <b className="dsp" style={{ "fontSize": "20px" }}>Counting a message once</b>
          <p className="p">When several colleagues see the same message, it should count once. Your browser sends a keyed fingerprint of the site's message id for this, never the id itself.</p></div>
        <div className="card pc">
          <b className="dsp" style={{ "fontSize": "20px" }}>Signing in</b>
          <p className="p">Your work email is stored apart from usage records. Brevo delivers the one-time sign-in codes and never receives usage or chat content.</p></div></section>
      <section className="wrap" style={{ "paddingBottom": "40px" }}>
        <div style={{ "display": "flex", "gap": "16px", "alignItems": "flex-start", "padding": "20px 24px", "borderRadius": "20px", "background": "#E7EFF8", "color": "#173F66" }}>
          <svg className="i" viewBox="0 0 24 24" style={{ "width": "24px", "height": "24px", "color": "#1D4F80", "marginTop": "2px" }}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></svg>
          <span style={{ "display": "flex", "flexDirection": "column", "gap": "6px" }}>
            <b style={{ "fontSize": "16px" }}>What administrators see</b>
            <span style={{ "fontSize": "15px", "lineHeight": "23px" }}>Administrators see figures for the whole organization only, never one person's usage, and the server enforces this. The figures are shown however few people use AI, so in an organization of one or two people they can reveal one person's usage. Connection IP addresses are not collected.</span></span></div></section>
      <section className="wrap" style={{ "paddingBottom": "40px", "display": "grid", "gridTemplateColumns": "repeat(auto-fit, minmax(min(440px, 100%), 1fr))", "gap": "16px" }}>
        <div className="card" style={{ "padding": "26px", "display": "flex", "flexDirection": "column" }}>
          <b className="dsp" style={{ "fontSize": "22px", "paddingBottom": "10px" }}>Never sent in organization uploads</b>
          {NEVER.map((t) => (
            <div className="never" key={t}>
              <svg className="i" viewBox="0 0 24 24" style={{ "color": "#A3352B" }} aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>{t}</div>
          ))}</div>
        <div className="card" style={{ "padding": "26px", "display": "flex", "flexDirection": "column" }}>
          <b className="dsp" style={{ "fontSize": "22px", "paddingBottom": "10px" }}>How long it is kept</b>
          <div className="rr">
            <span>Hosted organization usage</span>
            <b>Until an administrator deletes it</b></div>
          <div className="rr">
            <span>If your administrators choose a shorter period</span>
            <b>3 to 24 months</b></div>
          <div className="rr">
            <span>Earlier messages read from chats</span>
            <b>Until deleted</b></div>
          <div className="rr">
            <span>Self-hosted usage</span>
            <b>Until an administrator deletes it</b></div>
          <div className="rr">
            <span>Connection addresses</span>
            <b>Not collected</b></div>
          <div className="rr">
            <span>Messages sent with the contact form</span>
            <b>Until you ask us to delete them</b></div>
          <span style={{ "fontSize": "14px", "lineHeight": "21px", "color": "#4A5A4E", "paddingTop": "12px" }}>The current policy is shown before you connect. Browsers that are offline apply deletions when they reconnect. Exported files that were already downloaded cannot be recalled.</span></div></section>
      <section className="wrap" style={{ "paddingBottom": "88px" }}>
        <div className="card" style={{ "padding": "22px 26px", "display": "flex", "flexWrap": "wrap", "justifyContent": "space-between", "alignItems": "center", "gap": "12px" }}>
          <span style={{ "fontSize": "16px" }}>
            <b>Questions about privacy?</b>{" "}
            <span style={{ "color": "#4A5A4E" }}>The privacy policy has the full details. Or write to us with the contact form.</span></span>
          <span style={{ "display": "flex", "flexWrap": "wrap", "gap": "10px" }}>
            <a className="btn sec" href="/privacy-policy">Privacy policy</a>
            <a className="btn sec" href="/contact">Contact us</a></span></div></section>
    </>
  );
}
