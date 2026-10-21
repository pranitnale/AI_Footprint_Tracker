// Generated from the canvas board WebContact (board2jsx), then wired by hand. Static copy follows the board.
import { useRef, useState, type FormEvent } from "react";
import { ApiError, idempotencyKey, type ApiClient } from "../../api";
import type { Navigate } from "../../router";

type Topic = "larger_organization" | "self_hosting" | "other";
const TOPICS: ReadonlyArray<{ key: Topic; label: string; hint: string; placeholder: string }> = [
  { key: "larger_organization", label: "More than 50 members", hint: "A plan for a larger organization", placeholder: "How many people would use it, and from when? Anything else we should know?" },
  { key: "self_hosting", label: "Self-hosting", hint: "Running the server yourself", placeholder: "Which part of self-hosting can we help with?" },
  { key: "other", label: "Something else", hint: "Questions, feedback or press", placeholder: "How can we help?" },
];
// The server accepts these bands only, so the page never invents an exact head count.
const BANDS = [
  ["51-100", "51 to 100"],
  ["101-250", "101 to 250"],
  ["251-1000", "251 to 1,000"],
  ["1000+", "More than 1,000"],
] as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function afterSending(topic: Topic, people: string | null) {
  if (topic === "self_hosting") return "We will answer your self-hosting question.";
  if (topic !== "larger_organization") return "";
  const band = BANDS.find(([value]) => value === people)?.[1];
  if (!band) return "";
  return `For an organization with ${band === "More than 1,000" ? "more than 1,000" : band} people, we will suggest a plan that fits.`;
}

type Sent = { name: string; email: string; after: string };

export function WebContactPage({ api, navigate }: { api: ApiClient; navigate: Navigate }) {
  void navigate;
  const [topic, setTopic] = useState<Topic>("larger_organization");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<Sent | null>(null);
  // One key per message, so a send repeated after a lost reply is stored once.
  const operation = useRef(idempotencyKey());
  const current = TOPICS.find((t) => t.key === topic)!;

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    if (!text("name") || !text("message")) {
      setError("Add your name and a message.");
      return;
    }
    if (!EMAIL.test(text("email"))) {
      setError("Enter a work email we can reply to.");
      return;
    }
    const people = topic === "larger_organization" ? text("people") || null : null;
    setBusy(true);
    setError("");
    try {
      await api.post("/v1/public/contact", {
        topic,
        name: text("name"),
        email: text("email"),
        organization: text("organization"),
        people,
        message: text("message"),
        website: String(form.get("website") ?? ""),
        idempotency_key: operation.current,
      });
      operation.current = idempotencyKey();
      setSent({ name: text("name"), email: text("email"), after: afterSending(topic, people) });
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 429
          ? "Too many messages were sent from here. Try again in an hour."
          : caught instanceof ApiError && caught.safe_message
            ? caught.safe_message
            : "The message could not be sent. Try again in a moment.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="wrap" style={{ "paddingTop": "64px", "paddingBottom": "32px", "display": "flex", "flexDirection": "column", "gap": "14px" }}>
        <h1 className="dsp" style={{ "margin": "0", "fontSize": "clamp(38px, 4.6vw, 60px)", "lineHeight": "1.05", "fontWeight": "800", "letterSpacing": "-.02em" }}>Contact us</h1>
        <p style={{ "margin": "0", "fontSize": "19px", "lineHeight": "29px", "color": "#4A5A4E", "maxWidth": "740px" }}>Teams of up to 50 members use the hosted service free, with no time limit. Is your organization larger, or do you have a question about self-hosting or anything else? Write to us and we reply by email.</p></section>
      <section className="wrap" style={{ "paddingBottom": "88px", "display": "flex", "flexWrap": "wrap", "gap": "20px", "alignItems": "flex-start" }}>
        {sent ? (
          <div className="card" role="status" style={{ flex: "999 1 540px", minWidth: 0, boxSizing: "border-box", padding: 32, display: "flex", flexDirection: "column", gap: 14, alignItems: "flex-start" }}>
            <span style={{ "width": "52px", "height": "52px", "borderRadius": "16px", "background": "#E3F0E1", "color": "#1F5A2E", "display": "grid", "placeItems": "center" }}>
              <svg className="i" viewBox="0 0 24 24" style={{ "width": "26px", "height": "26px" }} aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg></span>
            <h2 className="dsp" tabIndex={-1} ref={(node) => node?.focus()} style={{ "margin": "0", "fontSize": "28px", "fontWeight": "700", "outline": "none" }}>Thanks, {sent.name.split(/\s+/)[0]}. Your message has arrived.</h2>
            <p className="p">We will reply to {sent.email}.{sent.after ? ` ${sent.after}` : ""}</p>
            <button type="button" className="btn sec" onClick={() => setSent(null)}>Send another message</button></div>
        ) : (
          <form className="card" onSubmit={send} noValidate aria-label="Contact form" style={{ flex: "999 1 540px", minWidth: 0, boxSizing: "border-box", padding: 28, display: "flex", flexDirection: "column", gap: 22, position: "relative" }}>
            <fieldset className="fs">
              <legend className="lg">What is it about?</legend>
              <div role="radiogroup" aria-label="Topic" style={{ "display": "grid", "gridTemplateColumns": "repeat(auto-fit, minmax(min(180px, 100%), 1fr))", "gap": "10px" }}>
                {TOPICS.map((t) => {
                  const on = t.key === topic;
                  return (
                    <button key={t.key} type="button" className="topic" role="radio" aria-checked={on} onClick={() => setTopic(t.key)} style={{ background: on ? "#F0F6EC" : "#FFFFFF", borderColor: on ? "#2E6B3F" : "#C9D3C3", boxShadow: on ? "inset 0 0 0 1px #2E6B3F" : "none" }}>
                      <b style={{ "fontSize": "15px" }}>{t.label}</b>
                      <span style={{ "fontSize": "13px", "lineHeight": "18px", "color": "#4A5A4E" }}>{t.hint}</span></button>
                  );
                })}</div></fieldset>
            <fieldset className="fs">
              <legend className="lg">You and your organization</legend>
              <div className="grid2">
                <label className="lab">Your name<input className="field" name="name" required maxLength={120} autoComplete="name" /></label>
                <label className="lab">Work email<input className="field" name="email" type="email" required maxLength={254} autoComplete="email" /></label></div>
              <div className="grid2">
                <label className="lab">Organization<input className="field" name="organization" maxLength={160} autoComplete="organization" /></label>
                {topic === "larger_organization" && (
                  <label className="lab">People who would use it
                    <select className="field" name="people" defaultValue="51-100">
                      {BANDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                )}</div></fieldset>
            <label className="lab">Message<textarea className="field" name="message" required rows={5} maxLength={2000} placeholder={current.placeholder} style={{ "height": "auto", "minHeight": "132px", "padding": "12px", "lineHeight": "22px", "resize": "vertical" }} />
              <span className="hint">Up to 2,000 characters. Please do not send chat content or passwords.</span></label>
            {/* Left empty by people; automated senders fill it and are quietly ignored. */}
            <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, opacity: 0 }} />
            <span className="hint" style={{ "display": "flex", "gap": "8px", "alignItems": "flex-start" }}>
              <svg className="i" viewBox="0 0 24 24" style={{ "width": "16px", "height": "16px", "color": "#2E6B3F", "marginTop": "1px" }} aria-hidden="true"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z" /></svg>
              <span>We use what you send only to reply to you. It is never added to usage data, and you can ask us to delete it at any time. <a href="/privacy-policy">Privacy policy</a></span></span>
            {error && <p role="alert" className="hint" style={{ "margin": "0", "color": "#A3352B", "fontWeight": "600" }}>{error}</p>}
            <div style={{ "display": "flex", "flexWrap": "wrap", "gap": "12px", "alignItems": "center" }}>
              <button type="submit" className="btn pri" disabled={busy} style={{ "height": "52px", "padding": "0 24px", "fontSize": "16px" }}>
                <svg className="i" viewBox="0 0 24 24" style={{ "width": "18px", "height": "18px" }} aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></svg>{busy ? "Sending" : "Send message"}</button>
              <span className="hint">We reply to your work email.</span></div>
          </form>
        )}
        <aside style={{ "flex": "1 1 300px", "minWidth": "0", "display": "flex", "flexDirection": "column", "gap": "16px" }}>
          <div className="side" style={{ "borderRadius": "20px", "background": "#0F2A1C", "color": "#F4F5EF" }}>
            <span style={{ "fontSize": "13px", "fontWeight": "700", "letterSpacing": ".08em", "textTransform": "uppercase", "color": "#B9E27C" }}>Up to 50 members</span>
            <b className="dsp" style={{ "fontSize": "32px" }}>Free forever</b>
            <span className="li">
              <svg className="i" viewBox="0 0 24 24" style={{ "color": "#B9E27C", "marginTop": "2px" }} aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>No time limit and no payment details</span>
            <span className="li">
              <svg className="i" viewBox="0 0 24 24" style={{ "color": "#B9E27C", "marginTop": "2px" }} aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>Usage kept until you delete it, or for a shorter period you choose</span>
            <a className="btn" href="/register" style={{ "background": "#B9E27C", "color": "#0F2A1C", "marginTop": "4px" }}>Register your organization</a></div>
          <div className="card side">
            <b className="dsp" style={{ "fontSize": "20px" }}>More than 50 members?</b>
            <p className="p">Tell us how many people would use it. We set up a plan for your organization's size. There is no checkout on this website.</p></div>
          <div className="card side">
            <b className="dsp" style={{ "fontSize": "20px" }}>Looking for something else?</b>
            <p className="p">Requirements and setup: <a href="/self-host">Self-host</a>. Source code and issues: <a href="/open-source">Open source</a>.</p></div></aside></section>
    </>
  );
}
