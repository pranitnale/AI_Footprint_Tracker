import { useRef } from "react";
import { Icon } from "@footprint/ui/icons";
import type { DashboardClient } from "../dashboard/client";
import type { Dashboard } from "../dashboard/types";

/** Organization side before connecting (canvas DashConnect). */
export function ConnectPage({
  onConnect,
  pending,
  client,
  reload,
  now,
}: {
  onConnect: () => void;
  pending: Dashboard["pending"];
  client: DashboardClient;
  reload: () => Promise<void>;
  now: Date;
}) {
  const shared = useRef<HTMLDivElement>(null);
  const waiting = pending;
  const minutes = waiting ? Math.max(0, Math.ceil((Date.parse(waiting.expires_at) - now.getTime()) / 60_000)) : 0;
  const expiry = minutes > 0 ? `expires in ${minutes} minute${minutes === 1 ? "" : "s"}` : "expired";
  return (
    <>
      <section className="dh-hero dc-hero" aria-labelledby="dc-title">
        <div className="dc-text">
          <span className="dc-status">{waiting ? (waiting.state === "verified" ? "Waiting for you to confirm" : "Waiting for your code") : "Not connected"}</span>
          <h2 id="dc-title" className="lg-display">
            See your organization's AI footprint together
          </h2>
          <p>Connect this browser to your organization with your work email.</p>
          <div className="dc-actions">
            <button type="button" className="lg-btn lg-btn-lime" onClick={onConnect}>
              <Icon name="building" size={16} />
              {waiting ? "Continue connecting" : "Connect your organization"}
            </button>
            <button type="button" className="lg-btn lg-btn-ghost-dark" onClick={() => shared.current?.focus()}>
              What is shared
            </button>
          </div>
          {waiting && (
            <p className="dc-waiting">
              {waiting.state === "verified" ? (
                <>
                  Confirm the connection to <b>{waiting.company_name}</b> · {expiry} ·{" "}
                </>
              ) : (
                <>
                  Code sent to <b>{waiting.email ?? "your work email"}</b> · {expiry} ·{" "}
                </>
              )}
              <button
                type="button"
                className="dh-link-btn dc-cancel"
                onClick={async () => {
                  await client.command("cancel-connection").catch(() => {});
                  await reload();
                }}
              >
                Cancel
              </button>
            </p>
          )}
        </div>
        <div className="dc-cards" ref={shared} tabIndex={-1} aria-label="What connecting shares">
          <div>
            <b className="dc-yes">Shared</b>
            <p>Token counts, estimates, tools, models and times, from the moment you connect.</p>
          </div>
          <div>
            <b>Never shared</b>
            <p>Your prompts, the AI's answers, files and chat titles.</p>
          </div>
          <div>
            <b>Stays here</b>
            <p>Everything you recorded before connecting.</p>
          </div>
          <div>
            <b>Your choice</b>
            <p>Disconnect any time in Settings.</p>
          </div>
        </div>
      </section>
      <section aria-labelledby="dc-how">
        <h2 id="dc-how" className="lg-display dc-how-title">
          How connecting works
        </h2>
        <ol className="dc-steps">
          <li className="dh-card">
            <span className="dc-step lg-display">1</span>
            <b>Enter your work email</b>
            <p className="dh-soft">Your organization is found from its domain. If it runs its own server, enter that address too.</p>
          </li>
          <li className="dh-card">
            <span className="dc-step lg-display">2</span>
            <b>Allow access</b>
            <p className="dh-soft">Your browser asks once to let the extension reach the server.</p>
          </li>
          <li className="dh-card">
            <span className="dc-step lg-display">3</span>
            <b>Enter the code and confirm</b>
            <p className="dh-soft">Type the 6-digit code from the email, check what your organization receives, then connect.</p>
          </li>
        </ol>
      </section>
    </>
  );
}
