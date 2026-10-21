import { useEffect, useRef, useState, type FormEvent } from "react";
import type { DisplayScenario } from "@footprint/contracts";
import { emailCodeDigits, formatInteger } from "@footprint/ui/formatters";
import { Icon } from "@footprint/ui/icons";
import type { DashboardClient, PermissionRequest } from "../dashboard/client";
import type { Dashboard } from "../dashboard/types";
import { PRIVACY_POLICY_PAGE, SCENARIO_NAMES } from "../ui/components";
import { requestsPhrase } from "../ui/figure-math";
import { DialogPoint, LgDialog } from "../ui/dialog";
import { HOSTED_ORIGIN, isHostedOrigin } from "../dashboard/organization";
import { DEFAULT_FEATURES, organizationTerms, type OrganizationTerms } from "../organization-terms";

function message(caught: unknown) {
  const text = caught instanceof Error && caught.message ? caught.message : "The change could not be saved.";
  const detail = (caught as { detail?: unknown } | null)?.detail;
  return typeof detail === "string" && detail ? `${text} Technical detail: ${detail}` : text;
}

export function ScenarioDialog({
  from,
  to,
  fromValue,
  toValue,
  onCancel,
  onConfirm,
}: {
  from: DisplayScenario;
  to: DisplayScenario;
  fromValue: string | null;
  toValue: string | null;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <LgDialog
      title={`Show ${SCENARIO_NAMES[to]} figures everywhere?`}
      icon="sliders"
      tone="ok"
      busy={busy}
      onClose={onCancel}
      actions={
        <>
          <button type="button" className="lg-btn lg-btn-secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="lg-btn lg-btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onConfirm();
              } catch (caught) {
                setError(message(caught));
                setBusy(false);
              }
            }}
          >
            Show {SCENARIO_NAMES[to]}
          </button>
        </>
      }
    >
      {(fromValue || toValue) && (
        <div className="lg-dialog-compare">
          <span>
            <small>{SCENARIO_NAMES[from]}</small>
            <b className="lg-num">{fromValue ?? "Not available"}</b>
          </span>
          <Icon name="arrowRight" size={16} />
          <span className="lg-dialog-compare-to">
            <small>{SCENARIO_NAMES[to]}</small>
            <b className="lg-num">{toValue ?? "Not available"}</b>
          </span>
          <small className="lg-dialog-compare-note">your last 30 days</small>
        </div>
      )}
      <ul className="lg-points">
        <DialogPoint kind="yes">Changes at once in the bar under each chat, the popup, Details and this dashboard. Carbon and water change with it.</DialogPoint>
        <DialogPoint kind="yes">Nothing is recalculated or deleted. Every saved estimate keeps its full range, so you can switch back at any time.</DialogPoint>
        <DialogPoint kind="yes">What a connected organization receives stays the same.</DialogPoint>
      </ul>
      {error && (
        <p className="lg-dialog-error" role="alert">
          {error}
        </p>
      )}
    </LgDialog>
  );
}

export function PauseDialog({ saved, onCancel, onConfirm }: { saved: string; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <LgDialog
      title="Pause tracking?"
      icon="pause"
      tone="warn"
      busy={busy}
      onClose={onCancel}
      actions={
        <>
          <button type="button" className="lg-btn lg-btn-secondary" disabled={busy} onClick={onCancel} data-autofocus>
            Keep tracking
          </button>
          <button
            type="button"
            className="lg-btn lg-btn-warn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onConfirm();
              } catch (caught) {
                setError(message(caught));
                setBusy(false);
              }
            }}
          >
            <Icon name="pause" size={16} />
            Pause tracking
          </button>
        </>
      }
    >
      <ul className="lg-points">
        <DialogPoint kind="no">Nothing is recorded while paused, on all five sites. Your totals stop growing until you resume.</DialogPoint>
        <DialogPoint kind="yes">
          {saved.replace(/^≈ /, "") === "1" ? <>Your <b>{saved} saved request</b> stays as it is.</> : <>Your <b>{saved} saved requests</b> stay as they are.</>}
        </DialogPoint>
        <DialogPoint kind="note">Resume any time, here or from the popup. Resuming needs no confirmation.</DialogPoint>
      </ul>
      {error && (
        <p className="lg-dialog-error" role="alert">
          {error}
        </p>
      )}
    </LgDialog>
  );
}

/** Withdraws the agreement to tracking (owner decision of 18 October 2026). */
export function TurnOffDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <LgDialog
      title="Turn off tracking?"
      icon="pause"
      tone="warn"
      busy={busy}
      onClose={onCancel}
      actions={
        <>
          <button type="button" className="lg-btn lg-btn-secondary" disabled={busy} onClick={onCancel} data-autofocus>
            Keep tracking
          </button>
          <button
            type="button"
            className="lg-btn lg-btn-warn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onConfirm();
              } catch (caught) {
                setError(message(caught));
                setBusy(false);
              }
            }}
          >
            Turn off tracking
          </button>
        </>
      }
    >
      <ul className="lg-points">
        <DialogPoint kind="no">This withdraws your agreement. Nothing is counted, stored or read from the sites until you agree again.</DialogPoint>
        <DialogPoint kind="yes">Your saved records stay in this browser. Erase them in Settings if you want them gone.</DialogPoint>
        <DialogPoint kind="note">The bar under the chat box shows Tracking is off with Set up, which asks for your agreement again.</DialogPoint>
      </ul>
      {error && (
        <p className="lg-dialog-error" role="alert">
          {error}
        </p>
      )}
    </LgDialog>
  );
}

export function EraseDialog({ requests, since, onCancel, onConfirm }: { requests: string; since: string | null; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [ack, setAck] = useState(false);
  const [error, setError] = useState("");
  return (
    <LgDialog
      title="Erase all records in this browser?"
      icon="trash"
      tone="danger"
      busy={busy}
      onClose={onCancel}
      actions={
        <>
          <button type="button" className="lg-btn lg-btn-secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="lg-btn lg-btn-danger-solid"
            disabled={!ack || busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onConfirm();
              } catch (caught) {
                setError(message(caught));
                setBusy(false);
              }
            }}
          >
            {busy ? "Erasing" : "Erase records"}
          </button>
        </>
      }
    >
      <ul className="lg-points">
        <DialogPoint kind="no">
          Removes <b>{requestsPhrase(requests)}</b> and every total{since ? ` since ${since}` : ""}.
        </DialogPoint>
        <DialogPoint kind="no">Cannot be undone.</DialogPoint>
        <DialogPoint kind="note">Chats you open again are read and estimated again, like the first time.</DialogPoint>
      </ul>
      <label className="lg-ack">
        <input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} />I understand this erases everything
      </label>
      {error && (
        <p className="lg-dialog-error" role="alert">
          {error}
        </p>
      )}
    </LgDialog>
  );
}

/**
 * `trackingOff`: the person has not agreed to tracking or turned it off, so a sync sends no
 * record (lib/tracking-consent.ts); Sync first is not offered and personal mode stays off too.
 */
export function DisconnectDialog({ name, waiting, trackingOff = false, onCancel, onSync, onConfirm }: { name: string; waiting: number; trackingOff?: boolean; onCancel: () => void; onSync: () => Promise<void>; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState<"sync" | "disconnect" | null>(null);
  const [error, setError] = useState("");
  const run = (kind: "sync" | "disconnect", action: () => Promise<void>) => async () => {
    setBusy(kind);
    setError("");
    try {
      await action();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(null);
    }
  };
  return (
    <LgDialog
      title={`Disconnect from ${name}?`}
      icon="buildingOff"
      tone="danger"
      busy={!!busy}
      onClose={onCancel}
      actions={
        <>
          <button type="button" className="lg-btn lg-btn-secondary" disabled={!!busy} onClick={onCancel}>
            Cancel
          </button>
          {waiting > 0 && !trackingOff && (
            <button type="button" className="lg-btn lg-btn-secondary" disabled={!!busy} onClick={run("sync", onSync)}>
              <Icon name="refresh" size={16} className={busy === "sync" ? "pp-spin" : undefined} />
              Sync first
            </button>
          )}
          <button type="button" className="lg-btn lg-btn-danger-solid" disabled={!!busy} onClick={run("disconnect", onConfirm)}>
            Disconnect
          </button>
        </>
      }
    >
      {waiting > 0 && (
        <p className="lg-dialog-warn">
          <Icon name="alert" size={16} />
          <span>
            <b>
              {formatInteger(waiting)} {waiting === 1 ? "record has" : "records have"}
            </b>{" "}
            not reached your organization yet. {waiting === 1 ? "It" : "They"} will not be sent after you disconnect.
          </span>
        </p>
      )}
      <ul className="lg-points">
        <DialogPoint kind="yes">Records already sent stay with your organization.</DialogPoint>
        {trackingOff ? (
          <DialogPoint kind="note">Tracking stays off until you agree. Records stay in this browser only.</DialogPoint>
        ) : (
          <DialogPoint kind="yes">Tracking goes on in personal mode, kept in this browser only.</DialogPoint>
        )}
      </ul>
      {error && (
        <p className="lg-dialog-error" role="alert">
          {error}
        </p>
      )}
    </LgDialog>
  );
}

/** A server address must be the exact HTTPS origin, with nothing after it. */
export function parseOrganizationAddress(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter the full server address, starting with https://.");
  }
  if (url.protocol !== "https:") throw new Error("The address must start with https://.");
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash || url.username || url.password)
    throw new Error("Enter only the server address, without a path.");
  return url.origin;
}

/** The same check as the company client, so a typing slip is caught before the browser prompt. */
export function parseWorkEmail(value: string): string {
  const email = value.trim();
  if (email.length > 254 || !/^[^\s@]{1,64}@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("Enter your work email, for example name@your-organization.com.");
  return email;
}

function minutesLeft(at: string | undefined, now: Date) {
  return at ? Math.max(0, Math.ceil((Date.parse(at) - now.getTime()) / 60_000)) : 0;
}

/**
 * What connecting shares (canvas ConnectNew, owner decision of 17 October 2026): what is never
 * shared comes first and stands out, then what is shared, what administrators see and what stays
 * here. The words follow the server's operator switches (lib/organization-terms.ts). `id` keeps
 * the heading ids apart when the dialog opens over Settings, which shows the same sections.
 */
export function OrganizationTermsList({ terms, id }: { terms: OrganizationTerms; id: string }) {
  return (
    <>
      <section className="lg-local dc-never" aria-labelledby={`${id}-never-title`}>
        <h3 id={`${id}-never-title`} className="lg-local-title">
          Never shared
        </h3>
        <p className="lg-local-text">{terms.never}</p>
      </section>
      <dl className="dc-terms">
        <div>
          <dt>Shared with your organization</dt>
          <dd>{terms.shared}</dd>
        </div>
        <div>
          <dt>What your administrators see</dt>
          <dd>{terms.administrators}</dd>
        </div>
        <div>
          <dt>Stays in this browser</dt>
          <dd>{terms.stays}</dd>
        </div>
      </dl>
    </>
  );
}

/**
 * Connect flow (owner, 13 October 2026): the work email (and, only for an organization that runs
 * its own server, that server's address), the browser's own permission prompt, the 6-digit code
 * from the email, then a confirmation that names the organization the server found and what it
 * receives. Nothing is shared before Connect, and earlier personal records stay in this browser.
 */
export function ConnectDialog({
  client,
  requestPermission,
  pending,
  now,
  onClose,
  onDone,
  onStarted,
  onCancelPending,
  company = null,
}: {
  client: DashboardClient;
  requestPermission: PermissionRequest;
  pending: Dashboard["pending"];
  now: Date;
  /** The connection once made, for the review of what the server's switches change. */
  company?: Dashboard["company"];
  onClose: () => void;
  onDone: (message: string | null) => Promise<void>;
  /** Reloads the dashboard after a step, so the stored connection state (or its end) appears. */
  onStarted: () => Promise<void>;
  onCancelPending: () => Promise<void>;
}) {
  const [form, setForm] = useState<"email" | "permission">("email");
  // A person waiting for a code can go back and use another email without cancelling first.
  const [another, setAnother] = useState(false);
  const [email, setEmail] = useState(pending?.email ?? "");
  const [ownServer, setOwnServer] = useState(pending ? !isHostedOrigin(pending.origin) : false);
  const [address, setAddress] = useState(pending && !isHostedOrigin(pending.origin) ? pending.origin : "https://");
  const [origin, setOrigin] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // The organization agreement's checkbox; Connect stays off until it is ticked (17 Oct 2026).
  const [agreed, setAgreed] = useState(false);
  // Connected, but the server's operator switches change what the confirmation described.
  const [review, setReview] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const stage = pending?.state === "verified" ? "confirm" : pending?.state === "code_sent" && !another ? "code" : form;
  const retryAt = pending?.state === "code_sent" && pending.retry_at ? Date.parse(pending.retry_at) : 0;
  const canResend = Date.now() >= retryAt;

  // Re-render once the server allows another code, so "Send a new code" turns on by itself.
  useEffect(() => {
    if (stage !== "code" || canResend) return;
    const timer = window.setTimeout(() => setTick((n) => n + 1), Math.max(0, retryAt - Date.now()) + 50);
    return () => window.clearTimeout(timer);
  }, [stage, canResend, retryAt]);

  const run = async (step: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await step();
    } catch (caught) {
      setError(message(caught));
      // A refused step may have ended the connection in progress; show where it now stands.
      await onStarted().catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const toPermission = (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      const work = parseWorkEmail(email);
      setOrigin(ownServer ? parseOrganizationAddress(address) : HOSTED_ORIGIN);
      setEmail(work);
      setForm("permission");
    } catch (caught) {
      setError(message(caught));
    }
  };
  const sendCode = () =>
    run(async () => {
      if (!origin) return;
      if (!(await requestPermission(origin))) throw new Error("Browser permission was not granted. No organization connection was started.");
      await client.connect(origin, email);
      setCode("");
      await onStarted();
      setAnother(false);
      setForm("email");
    });
  const resend = () =>
    run(async () => {
      if (!pending?.email) return;
      await client.connect(pending.origin, pending.email);
      setCode("");
      await onStarted();
    });
  const verify = (event: FormEvent) => {
    event.preventDefault();
    const digits = code.replace(/\s/g, "");
    if (!/^\d{6}$/.test(digits)) {
      setError("Enter the 6-digit code from the email.");
      return;
    }
    void run(async () => {
      await client.verifyCode(digits);
      await onStarted();
    });
  };
  const cancel = async () => {
    setBusy(true);
    await onCancelPending();
    setBusy(false);
    onClose();
  };

  const position = { email: 1, permission: 2, code: 3, confirm: 4 }[stage];
  const steps = (
    <ol className="lg-steps" aria-label={`Step ${position} of 4`}>
      {[1, 2, 3, 4].map((n) => (
        <li key={n} data-done={n <= position || undefined} />
      ))}
    </ol>
  );
  const errorLine = error && (
    <p className="lg-dialog-error" id="dh-connect-error" role="alert">
      {error}
    </p>
  );

  if (review !== null) {
    const name = review;
    const version = company?.consent_version;
    const later = () => onDone(`Connected to ${name}. Nothing is shared until you agree in Settings.`);
    return (
      <LgDialog
        title={`Review what ${name} can see`}
        icon="building"
        tone="warn"
        wide
        busy={busy}
        onClose={() => void later()}
        actions={
          <>
            <button type="button" className="lg-btn lg-btn-secondary" disabled={busy} onClick={() => void later()}>
              Not now
            </button>
            <button
              type="button"
              className="lg-btn lg-btn-primary"
              disabled={busy || !agreed || !version}
              onClick={() =>
                run(async () => {
                  try {
                    await client.agreeOrganization(version!);
                  } catch (caught) {
                    // The text may have changed, so a new agreement needs a new tick.
                    setAgreed(false);
                    throw caught;
                  }
                  await onDone(`Connected to ${name}. The popup and dashboard now show Organization.`);
                })
              }
            >
              Agree and share
            </button>
          </>
        }
      >
        <p>
          This browser is connected. Your organization's server is set up to collect or show more than the previous step described, so nothing is shared until you agree to this text.
        </p>
        <OrganizationTermsList terms={organizationTerms(company?.features ?? DEFAULT_FEATURES, company?.policy)} id="dc-review" />
        <label className="lg-ack lg-ack-agree">
          <input type="checkbox" checked={agreed} disabled={busy} onChange={(event) => setAgreed(event.target.checked)} />
          I agree to share this browser's AI use with {name} as described.
        </label>
        <p className="lg-dialog-small">
          You can also agree later in Settings, or disconnect there.{" "}
          <a href={PRIVACY_POLICY_PAGE} target="_blank" rel="noopener noreferrer">
            Privacy policy
          </a>
        </p>
        {errorLine}
      </LgDialog>
    );
  }

  if (stage === "confirm" && pending) {
    const name = pending.company_name ?? "your organization";
    const minutes = minutesLeft(pending.expires_at, now);
    return (
      <LgDialog
        title={`Connect to ${name}?`}
        icon="building"
        tone="ok"
        wide
        busy={busy}
        onClose={onClose}
        actions={
          <>
            <button type="button" className="lg-btn lg-btn-secondary" disabled={busy} onClick={cancel}>
              Cancel
            </button>
            <button
              type="button"
              className="lg-btn lg-btn-primary"
              disabled={busy || !agreed}
              onClick={() =>
                run(async () => {
                  const { review: needed } = await client.confirmConnection(agreed);
                  if (needed) {
                    // The next step asks for its own tick, so this one is not carried over.
                    setAgreed(false);
                    setReview(name);
                    await onStarted();
                    return;
                  }
                  await onDone(`Connected to ${name}. The popup and dashboard now show Organization.`);
                })
              }
            >
              {busy ? "Connecting" : "Connect"}
            </button>
          </>
        }
      >
        {steps}
        {/* The organization agreement, separate from the agreement to tracking itself. A server
            tells a browser its operator switches only once it is connected, so this step shows
            the text for both switches off; a switch that is on is reviewed in the next step. */}
        <p>Your organization sees how its people use AI as a whole. Here is exactly what connecting changes.</p>
        <OrganizationTermsList terms={organizationTerms(DEFAULT_FEATURES)} id="dc" />
        <label className="lg-ack lg-ack-agree">
          <input type="checkbox" checked={agreed} disabled={busy} onChange={(event) => setAgreed(event.target.checked)} />
          I agree to share this browser's AI use with {name} as described.
        </label>
        <p className="lg-dialog-small">
          Disconnect any time in Settings.{" "}
          <a href={PRIVACY_POLICY_PAGE} target="_blank" rel="noopener noreferrer">
            Privacy policy
          </a>
        </p>
        <p className="lg-dialog-small">
          {!isHostedOrigin(pending.origin) && <>Server {new URL(pending.origin).host} · </>}
          {minutes > 0 ? `Confirm within ${minutes} minute${minutes === 1 ? "" : "s"}` : "This request has expired. Cancel and start again."}
        </p>
        {errorLine}
      </LgDialog>
    );
  }

  if (stage === "code" && pending) {
    const minutes = minutesLeft(pending.expires_at, now);
    const wait = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
    return (
      <LgDialog
        title="Enter the code from your email"
        busy={busy}
        onClose={onClose}
        actions={
          <>
            <button type="button" className="lg-btn lg-btn-secondary" disabled={busy} onClick={cancel}>
              Cancel
            </button>
            <button type="submit" form="dh-connect-code" className="lg-btn lg-btn-primary" disabled={busy}>
              {busy ? "Checking" : "Continue"}
            </button>
          </>
        }
      >
        {steps}
        <form id="dh-connect-code" onSubmit={verify} noValidate>
          <p>
            If your organization uses AI Footprint Tracker, a 6-digit code is on its way to{" "}
            <b>{pending.email ?? "your work email"}</b>.{" "}
            {minutes > 0 ? `It expires in ${minutes} minute${minutes === 1 ? "" : "s"}.` : "It has expired. Send a new code."}{" "}
            No email after a few minutes? Check the address, or ask your administrator which work email the organization uses.
          </p>
          <label className="lg-field">
            <span>Code</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              spellCheck={false}
              value={code}
              // Keep digits only, then six of them: a pasted "094 475" or "094-475" stays whole.
              onChange={(event) => setCode(emailCodeDigits(event.target.value))}
              aria-invalid={!!error || undefined}
              aria-describedby={error ? "dh-connect-error" : undefined}
              data-autofocus
            />
          </label>
          {errorLine}
        </form>
        <p className="lg-dialog-small">
          <button type="button" className="dh-link-btn" disabled={busy || !canResend || !pending.email} onClick={() => void resend()}>
            Send a new code
          </button>
          {!canResend && ` in ${wait} second${wait === 1 ? "" : "s"}`} ·{" "}
          <button
            type="button"
            className="dh-link-btn"
            disabled={busy}
            onClick={() => {
              setError("");
              setAnother(true);
              setForm("email");
            }}
          >
            Use another email
          </button>
        </p>
      </LgDialog>
    );
  }

  if (stage === "permission" && origin)
    return (
      <LgDialog
        title="Allow the extension to reach the server"
        busy={busy}
        onClose={onClose}
        actions={
          <>
            <button type="button" className="lg-btn lg-btn-secondary" disabled={busy} onClick={() => setForm("email")}>
              Back
            </button>
            <button type="button" className="lg-btn lg-btn-primary" disabled={busy} onClick={() => void sendCode()}>
              {busy ? "Waiting for the browser" : "Continue"}
            </button>
          </>
        }
      >
        {steps}
        <p>Your browser now shows its own permission prompt. Allow it so the extension can send your code request and, after you connect, your totals.</p>
        <div className="lg-prompt-sample" aria-hidden="true">
          <small>What the browser prompt looks like</small>
          <span>"AI Footprint Tracker" wants to read and change data on {new URL(origin).host}</span>
        </div>
        <p className="lg-dialog-small">The extension can only reach this one address, nothing else. A code is then sent to {email}.</p>
        {errorLine}
      </LgDialog>
    );

  return (
    <LgDialog
      title="Connect your organization"
      busy={busy}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="lg-btn lg-btn-secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="dh-connect" className="lg-btn lg-btn-primary" disabled={busy}>
            Continue
          </button>
        </>
      }
    >
      {steps}
      <form id="dh-connect" onSubmit={toPermission} noValidate>
        <p>Use your work email. A 6-digit code is sent to it, and your organization is found from the email's domain.</p>
        <label className="lg-field">
          <span>Work email</span>
          <input
            type="email"
            inputMode="email"
            autoCapitalize="off"
            autoComplete="email"
            spellCheck={false}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={!!error || undefined}
            aria-describedby={error ? "dh-connect-error" : undefined}
            data-autofocus
          />
        </label>
        {ownServer ? (
          <label className="lg-field">
            <span>Server address</span>
            <input
              type="text"
              inputMode="url"
              autoCapitalize="off"
              autoComplete="url"
              spellCheck={false}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
          </label>
        ) : null}
        <p className="lg-dialog-small">
          <button type="button" className="dh-link-btn" aria-expanded={ownServer} onClick={() => setOwnServer(!ownServer)}>
            {ownServer ? "Use the hosted service instead" : "Your organization runs its own server?"}
          </button>
          {ownServer && " Your administrator gives you its address."}
        </p>
        <p className="pp-note">
          <Icon name="shield" size={16} />
          Only numbers from now on are shared. Your earlier records stay in this browser.
        </p>
        {errorLine}
      </form>
    </LgDialog>
  );
}
