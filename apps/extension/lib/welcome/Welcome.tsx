import { useEffect, useId, useMemo, useRef, useState } from "react";
import { LivingGaugeMark, PUBLIC_WEBSITE } from "@footprint/ui/icons";
import { createDashboardClient, runtimeTransport, type Transport } from "../dashboard/client";
import type { Settings } from "../dashboard/types";
import { ownReadSettings } from "../own-read-settings";
import { browser } from "wxt/browser";
import { consentRequired, TRACKING_STATE_CHANGED, WELCOME_FOCUS_TARGET } from "../tracking-consent";
import { Credit, LocalCard, PRIVACY_POLICY_PAGE } from "../ui/components";
import { closeCurrentTab } from "../ui/navigation";
import { FULL_HISTORY_HELP, FULL_HISTORY_LABEL, HOW_IT_WORKS, LOCAL_BADGES } from "./copy";
import { Tour } from "./Tour";

type Stage = "loading" | "ask" | "saving" | "agreed";

/**
 * Calls `changed` when the agreement may have changed in another page (the background's
 * `TRACKING_STATE_CHANGED`, or this tab shown again), and brings this tab to the front when
 * another page wants to open the welcome page. Returns the clean-up.
 */
function followAgreement(changed: () => void): () => void {
  const listener = (message: unknown) => {
    const target = (message as { target?: unknown } | null)?.target;
    if (target === TRACKING_STATE_CHANGED) {
      changed();
      return undefined;
    }
    if (target !== WELCOME_FOCUS_TARGET) return undefined;
    return browser.tabs
      .getCurrent()
      .then(async (tab) => {
        if (tab?.id == null) return { focused: false };
        await browser.tabs.update(tab.id, { active: true });
        if (tab.windowId != null) await browser.windows?.update(tab.windowId, { focused: true }).catch(() => {});
        return { focused: true };
      })
      .catch(() => ({ focused: false }));
  };
  const visible = () => {
    if (document.visibilityState === "visible") changed();
  };
  document.addEventListener("visibilitychange", visible);
  let listening = false;
  try {
    browser.runtime.onMessage.addListener(listener);
    listening = true;
  } catch {
    // Outside the extension (tests) only the visibility check applies.
  }
  return () => {
    document.removeEventListener("visibilitychange", visible);
    if (listening) browser.runtime.onMessage.removeListener(listener);
  };
}

/**
 * The welcome page (owner decisions of 17 and 18 October 2026). It opens on install, once after an
 * update while the person has not agreed, and from the bar's Set up and the popup. Nothing is
 * counted until the person selects Agree and start; Not now closes the page and keeps the tracker
 * off. "Load full chat history automatically" is the existing own-read setting, on by default.
 * Once the person agreed, here or elsewhere, the page shows the short tour (owner request of 21
 * October 2026), which ends by closing the tab.
 */
export default function Welcome({
  transport = runtimeTransport,
  close = closeCurrentTab,
  follow = followAgreement,
  tourStep = 0,
}: {
  transport?: Transport;
  /** Closes this tab for Not now and at the end of the tour; tests pass their own. */
  close?: () => void;
  /** Tells the page when the agreement may have changed elsewhere; tests pass their own. */
  follow?: (changed: () => void) => () => void;
  /** The tour step shown first, counted from 0; the visual preview uses it. */
  tourStep?: number;
}) {
  const client = useMemo(() => createDashboardClient(transport), [transport]);
  const [stage, setStage] = useState<Stage>("loading");
  const [ownRead, setOwnRead] = useState(true);
  // Pause is separate from the agreement and survives a withdrawal, so agreeing again while
  // paused must not say that tracking is on.
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The Agree button disappears with the agreement, so focus moves to the tour's first heading.
  const [agreedHere, setAgreedHere] = useState(false);
  const helpId = useId();
  const followRef = useRef(follow);
  followRef.current = follow;

  useEffect(() => {
    let live = true;
    const read = (first: boolean) =>
      client
        .viewToken()
        .then((token) => {
          if (!live) return;
          const settings: Settings = token.settings;
          // A later check keeps the person's unsaved choice of the history switch.
          if (first) setOwnRead(ownReadSettings(settings).ownRead);
          setPaused(settings.paused === true);
          // An agreement made in another tab or the popup shows here too (live QA, 19 Oct
          // 2026), and so does Turn off tracking. A save in progress here decides itself.
          setStage((current) => (current === "saving" ? current : consentRequired(settings) ? "ask" : "agreed"));
        })
        // The choice can still be made; saving it says whether the background answers.
        .catch(() => live && first && setStage("ask"));
    void read(true);
    const stop = followRef.current(() => void read(false));
    return () => {
      live = false;
      stop();
    };
  }, [client]);

  const agree = async () => {
    setStage("saving");
    setError(null);
    try {
      await client.consent({ agreed: true, ownRead });
      setAgreedHere(true);
      setStage("agreed");
    } catch {
      setError("Your choice could not be saved. Nothing is counted yet. Try again.");
      setStage("ask");
    }
  };

  return (
    <div className="wl">
      <header className="wl-head">
        <a className="wl-brand" href={PUBLIC_WEBSITE} target="_blank" rel="noopener noreferrer" aria-label="AI Footprint Tracker website">
          <LivingGaugeMark size={30} className="pp-mark" />
          <span>AI Footprint Tracker</span>
        </a>
      </header>
      {stage === "agreed" ? (
        <main className="wl-main wl-main-tour">
          <Tour paused={paused} close={close} start={tourStep} focusFirst={agreedHere} />
        </main>
      ) : (
        <main className="wl-main">
          <div className="wl-intro">
            <h1 className="lg-display wl-title">See the footprint of your AI chats</h1>
            <p className="wl-lead">
              A small bar under the message box shows the tokens, electricity, carbon and water of each chat. Before it starts, here is how it works.
            </p>
            <LocalCard
              id="wl-local"
              title="Everything runs on your computer."
              text="Counting and the estimates are calculated in this browser. Your chats and your figures are not sent to us or to any other server."
              badges={LOCAL_BADGES}
              readCode="link"
            />
          </div>
          <section className="wl-how" aria-labelledby="wl-how-title">
            <h2 id="wl-how-title" className="lg-display">
              How it works
            </h2>
            <ol className="wl-points">
              {HOW_IT_WORKS.map((point, index) => (
                <li key={point.title}>
                  <span className="wl-step lg-num" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className="wl-point">
                    <b>{point.title}</b>
                    <span>{point.text}</span>
                  </span>
                </li>
              ))}
            </ol>
            <label className="wl-check">
              <input
                type="checkbox"
                checked={ownRead}
                disabled={stage !== "ask"}
                onChange={(event) => setOwnRead(event.target.checked)}
                aria-describedby={helpId}
              />
              <span>
                <b>{FULL_HISTORY_LABEL}</b>
                <span id={helpId}>{FULL_HISTORY_HELP}</span>
              </span>
            </label>
            <div className="wl-actions">
              <button type="button" className="lg-btn lg-btn-primary wl-btn" disabled={stage !== "ask"} onClick={() => void agree()}>
                {stage === "saving" ? "Starting" : "Agree and start"}
              </button>
              <button type="button" className="lg-btn lg-btn-secondary wl-btn" disabled={stage === "saving"} onClick={close}>
                Not now
              </button>
              <a href={PRIVACY_POLICY_PAGE} target="_blank" rel="noopener noreferrer">
                Privacy policy
              </a>
            </div>
            {error && (
              <p className="wl-error" role="alert">
                {error}
              </p>
            )}
            <p className="wl-note">Nothing is counted until you agree. "Not now" keeps the tracker off; open the popup to start later.</p>
          </section>
        </main>
      )}
      <Credit />
    </div>
  );
}
