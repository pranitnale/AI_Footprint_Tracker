import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { PUBLIC_WEBSITE } from "@footprint/ui/icons";
import { emailCodeDigits } from "@footprint/ui/formatters";
import { ApiClient, ApiError, idempotencyKey } from "./api";
import type { Navigate } from "./router";
import type { OtpChallenge, Registration } from "./types";

// Layout and copy follow the canvas boards WebLogin, WebLoginCode, WebRegister and WebRegisterVerify.
// Styles live in auth.css under the .au scope. Members have no web pages: they connect from the
// extension with their work email and a code.

const CREDIT_URL = "https://www.linkedin.com/in/pranitnale/";

function Mark({ color = "#2E6B3F" }: { color?: string }) {
  return (
    <svg viewBox="0 0 64 64" style={{ width: 28, height: 28, color }} aria-hidden="true" focusable="false">
      <path d="M27 6 A27 27 0 0 0 21 57 M37 6 A27 27 0 0 1 43 57" fill="none" stroke="currentColor" strokeWidth="10" />
      <path d="M23 42 C18 28 30 20 43 17 C42 29 37 43 25 42 L22 47 Z" fill="currentColor" />
    </svg>
  );
}

function Icon({ d, size = 18, color }: { d: string; size?: number; color?: string }) {
  return (
    <svg className="au-i" viewBox="0 0 24 24" style={{ width: size, height: size, color }} aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}
const ALERT = "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8v5M12 16h.01";

function Credit() {
  return (
    <p className="au-credit">
      Designed and built by{" "}
      <a href={CREDIT_URL} target="_blank" rel="noopener noreferrer">
        Pranit Nale
      </a>
    </p>
  );
}

/** Sign-in and registration: the forest panel with the promise, and the form beside it. */
function AuthShell({ children, width = 420 }: { children: ReactNode; width?: number }) {
  return (
    <div className="au au-split">
      <aside className="au-aside">
        <span className="au-rings" aria-hidden="true" />
        <a href={PUBLIC_WEBSITE} className="au-brand" aria-label="AI Footprint Tracker website">
          <Mark color="#B9E27C" />
          <b className="au-dsp" style={{ fontSize: 18 }}>
            AI Footprint Tracker
          </b>
        </a>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, position: "relative", maxWidth: 460 }}>
          <h1 className="au-dsp" style={{ margin: 0, fontSize: 48, lineHeight: 1.05, fontWeight: 800, letterSpacing: "-.02em" }}>
            Your AI usage, in one place.
          </h1>
          <p style={{ margin: 0, fontSize: 18, lineHeight: "27px", color: "#B9CDBE" }}>
            Open source. Built for clear, honest reporting.
          </p>
        </div>
        <span className="au-aside-foot" style={{ fontSize: 13, color: "#8FA897", position: "relative" }}>
          Figures are estimates, not measurements.
        </span>
      </aside>
      <main className="au-main">
        <div className="au-panel">
          <section className="au-form" style={{ maxWidth: width }}>
            {children}
          </section>
        </div>
        <Credit />
      </main>
    </div>
  );
}

function Steps({ step, total = 2 }: { step: number; total?: number }) {
  return (
    <div className="au-dots" role="img" aria-label={`Step ${step} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className="au-dot" data-on={i < step ? "" : undefined} />
      ))}
      <span style={{ marginLeft: 6 }} aria-hidden="true">
        Step {step} of {total}
      </span>
    </div>
  );
}

function Heading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <h2 className="au-dsp au-title">{title}</h2>
      {children && <p className="au-p">{children}</p>}
    </div>
  );
}

function Field({
  label,
  hint,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode }) {
  const hintId = useId();
  // The hint is linked, not part of the label, so the field is named by its label alone.
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label className="au-lab">
        {label}
        <input className="au-field" aria-describedby={hint ? hintId : undefined} {...props} />
      </label>
      {hint && (
        <span id={hintId} className="au-hint">
          {hint}
        </span>
      )}
    </div>
  );
}

/** One real input under six drawn boxes: paste, one-time-code fill and screen readers see one field. */
function CodeInput({ value, onChange, label = "Verification code" }: { value: string; onChange: (value: string) => void; label?: string }) {
  return (
    <div className="au-code">
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} className="au-box" aria-hidden="true" data-current={i === Math.min(value.length, 5) ? "" : undefined}>
          {value[i] ?? ""}
        </span>
      ))}
      <input
        aria-label={label}
        // The code step opens after the email is sent, so typing or pasting the code works at once.
        autoFocus
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        required
        value={value}
        // No maxLength: it would cut a pasted "094 475" to "094 47" before the space is dropped.
        onChange={(event) => onChange(emailCodeDigits(event.target.value))}
      />
    </div>
  );
}

function Problem({ error }: { error: unknown }) {
  return error ? (
    <div className="au-problem" role="alert">
      <Icon d={ALERT} color="#A3352B" />
      <span>{(error as Error).message}</span>
    </div>
  ) : null;
}

function Note({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "danger" }) {
  return (
    <div className={tone === "danger" ? "au-problem" : "au-note"} role="status">
      <Icon d={ALERT} color={tone === "danger" ? "#A3352B" : "#1D4F80"} />
      <span>{children}</span>
    </div>
  );
}

/** Tells the reader when a code mail may not have arrived; a sent code is the normal case and stays quiet. */
function Delivery({ challenge }: { challenge: OtpChallenge }) {
  if (challenge.delivery_state === "failed")
    return <Note tone="danger">The email with the code could not be sent. Send a new code or check the address.</Note>;
  if (challenge.delivery_state === "delivery_unknown")
    return <Note>We could not confirm that the email arrived. If it does not come, send a new code.</Note>;
  return null;
}

function Spinner() {
  return <span className="au-spin" aria-hidden="true" />;
}

export function LoginPage({
  api,
  operator = false,
}: {
  api: ApiClient;
  navigate: Navigate;
  operator?: boolean;
}) {
  const [email, setEmail] = useState(""),
    [challenge, setChallenge] = useState<OtpChallenge | null>(null),
    [code, setCode] = useState("");
  const [requestOperation, setRequestOperation] = useState(idempotencyKey),
    [verificationOperation, setVerificationOperation] =
      useState(idempotencyKey),
    [resendOperation, setResendOperation] = useState(idempotencyKey),
    [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!challenge) return;
    const delay = Math.max(0, Date.parse(challenge.retry_at) - Date.now());
    const timer = window.setTimeout(() => setNow(Date.now()), delay + 25);
    return () => window.clearTimeout(timer);
  }, [challenge?.retry_at]);
  async function request(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const path = operator
        ? "/v1/operator/auth/otp/request"
        : "/v1/auth/otp/request";
      setChallenge(
        await api.post<OtpChallenge>(path, {
          purpose: operator ? "operator_login" : "login",
          email,
          dispatch_id: requestOperation,
          registration_id: null,
        }),
      );
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      const path = operator
        ? "/v1/operator/auth/otp/verify"
        : "/v1/auth/otp/verify";
      const result = await api.post<{
        destination: string;
        csrf_token: string;
        role?: string;
      }>(path, {
        challenge_id: challenge.challenge_id,
        code,
        verification_id: verificationOperation,
      });
      api.setCsrf(result.csrf_token);
      window.location.assign(safeDestination(result.destination, operator));
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  async function resend() {
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      setChallenge(
        await api.post<OtpChallenge>("/v1/auth/otp/resend", {
          challenge_id: challenge.challenge_id,
          dispatch_id: resendOperation,
        }),
      );
      setVerificationOperation(idempotencyKey());
      setResendOperation(idempotencyKey());
      setCode("");
      setNow(Date.now());
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  if (!challenge)
    return (
      <AuthShell>
        <Steps step={1} />
        <Heading title={operator ? "Developer sign in" : "Administrator sign in"}>
          {operator
            ? "Use an approved developer email. Organization administrator access does not open the developer panel."
            : "Enter the work email of your administrator account. We send you a code; no password needed."}
        </Heading>
        <form onSubmit={request} style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <Field
            label="Work email"
            type="email"
            required
            autoComplete="email"
            value={email}
            style={{ height: 52, fontSize: 16 }}
            onChange={(event) => {
              setEmail(event.target.value);
              setRequestOperation(idempotencyKey());
            }}
          />
          <button type="submit" className="au-btn au-pri" disabled={busy} style={{ height: 52, fontSize: 16 }}>
            {busy && <Spinner />}
            {busy ? "Sending the code" : "Email me a code"}
          </button>
        </form>
        <Problem error={error} />
        <MemberHint error={error} />
        {!operator && (
          <>
            <span style={{ fontSize: 14, lineHeight: "21px", color: "#4A5A4E" }}>
              {MEMBERS_USE_EXTENSION}
            </span>
            <div style={{ height: 1, background: "#DCE2D6" }} />
            <span style={{ fontSize: 15 }}>
              New organization? <a href="/register" style={{ fontWeight: 600 }}>Register it here</a>
            </span>
          </>
        )}
      </AuthShell>
    );
  return (
    <AuthShell width={440}>
      <Steps step={2} />
      <span className="au-badge" style={{ background: "#E3F0E1", color: "#1F5A2E" }}>
        <svg className="au-i" viewBox="0 0 24 24" style={{ width: 26, height: 26 }} aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m3 7 9 6 9-6" />
        </svg>
      </span>
      <Heading title="Check your inbox">
        If an organization uses this work email, a 6-digit code is on its way to{" "}
        <b style={{ color: "#13241A" }}>{email}</b>. It works until{" "}
        {new Date(challenge.expires_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. No email after a
        few minutes? Check the address, or register your organization.
      </Heading>
      <form onSubmit={verify} style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <CodeInput value={code} onChange={setCode} />
        <button type="submit" className="au-btn au-pri" disabled={busy || code.length !== 6} style={{ height: 52, fontSize: 16 }}>
          {busy && <Spinner />}
          {busy ? "Checking the code" : "Verify and continue"}
        </button>
      </form>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 10 }}>
        <button
          type="button"
          className="au-link"
          onClick={() => {
            setChallenge(null);
            setCode("");
            setError(null);
            setRequestOperation(idempotencyKey());
            setVerificationOperation(idempotencyKey());
            setResendOperation(idempotencyKey());
          }}
        >
          Use a different email
        </button>
        {!operator && (
          <button type="button" className="au-link" onClick={resend} disabled={busy || now < Date.parse(challenge.retry_at)}>
            Send a new code
          </button>
        )}
      </div>
      <Delivery challenge={challenge} />
      <Problem error={error} />
      <MemberHint error={error} />
    </AuthShell>
  );
}

const MEMBERS_USE_EXTENSION =
  "Members do not sign in here. They connect from the AI Footprint Tracker browser extension with their work email and a code.";

/**
 * The server refuses web sign-in for anyone who is not an administrator. Its message says so; this
 * adds the way forward for a member, which is the extension.
 */
function MemberHint({ error }: { error: unknown }) {
  if (!(error instanceof ApiError) || error.code !== "admin_required") return null;
  return (
    <a className="au-btn au-sec" href="/downloads" style={{ alignSelf: "flex-start" }}>
      Get the extension
    </a>
  );
}

/** Where a successful sign-in may go: only the dashboard of its own kind, otherwise back to sign in. */
export function safeDestination(
  destination: string,
  operator: boolean,
): string {
  const allowed = operator ? ["/operator"] : ["/admin"];
  return allowed.includes(destination)
    ? destination
    : operator
      ? "/operator/login"
      : "/login";
}

type RegistrationForm = {
  company_name: string;
  website: string;
  country: string;
  admin_email: string;
  registrant_name: string;
  registrant_role: string;
  authority_acknowledged: boolean;
};
/** "Admin@Example.com" gives "example.com": the part after the last @, lower case. */
export function workDomainOf(email: string) {
  const at = email.lastIndexOf("@");
  return at < 0 ? "" : email.slice(at + 1).trim().toLowerCase();
}
const initial: RegistrationForm = {
  company_name: "",
  website: "https://",
  country: "DE",
  admin_email: "",
  registrant_name: "",
  registrant_role: "",
  authority_acknowledged: false,
};

// ISO 3166-1 alpha-2 codes; the names come from the browser in the reader's language setting.
const COUNTRY_CODES =
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" ");

function countryOptions() {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    names = null;
  }
  return COUNTRY_CODES.map((code) => ({ code, label: `${code}, ${names?.of(code) ?? code}` })).sort((a, b) =>
    a.label.slice(4).localeCompare(b.label.slice(4)),
  );
}

/** A full page load: the new session cookie, and for self-hosting another origin, need one. */
function loadPage(url: string) {
  window.location.assign(url);
}

export function RegisterPage({ api, load = loadPage }: { api: ApiClient; load?: (url: string) => void }) {
  const [form, setForm] = useState(initial),
    [termsAccepted, setTermsAccepted] = useState(false),
    [registration, setRegistration] = useState<Registration | null>(null),
    [challenge, setChallenge] = useState<OtpChallenge | null>(null),
    [code, setCode] = useState("");
  const [registrationOperation, setRegistrationOperation] =
      useState(idempotencyKey),
    [registrationDispatch, setRegistrationDispatch] = useState(idempotencyKey),
    [verificationOperation, setVerificationOperation] =
      useState(idempotencyKey),
    [resendOperation, setResendOperation] = useState(idempotencyKey),
    [now, setNow] = useState(Date.now());
  const [deployment, setDeployment] = useState<DeploymentConfig | null>(null),
    [deploymentError, setDeploymentError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const countries = useMemo(countryOptions, []);
  useEffect(() => {
    let current = true;
    api
      .get<DeploymentConfig>("/v1/public/deployment")
      .then((value) => {
        if (current) setDeployment(value);
      })
      .catch((caught) => {
        if (current) setDeploymentError(caught);
      });
    return () => {
      current = false;
    };
  }, [api]);
  useEffect(() => {
    if (!challenge) return;
    const delay = Math.max(0, Date.parse(challenge.retry_at) - Date.now());
    const timer = window.setTimeout(() => setNow(Date.now()), delay + 25);
    return () => window.clearTimeout(timer);
  }, [challenge?.retry_at]);
  const update = (key: keyof RegistrationForm, value: string | boolean) =>
    setForm((current) => ({ ...current, [key]: value }));
  async function register(event: FormEvent) {
    event.preventDefault();
    if (!termsAccepted) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<Registration>(
        "/v1/organizations/registrations",
        {
          ...form,
          // The server requires the admin's email to be on the work domain, so the domain is that email's.
          work_domain: workDomainOf(form.admin_email),
          terms_version: "1.0.0",
          disclosure_version: "1.0.0",
          idempotency_key: registrationOperation,
        },
      );
      setRegistration(result);
      const otp = await api.post<OtpChallenge>("/v1/auth/otp/request", {
        purpose: "registration",
        email: form.admin_email,
        dispatch_id: registrationDispatch,
        registration_id: result.registration_id,
      });
      setChallenge(otp);
      setVerificationOperation(idempotencyKey());
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<Registration>("/v1/auth/otp/verify", {
        challenge_id: challenge.challenge_id,
        code,
        verification_id: verificationOperation,
      });
      setRegistration(result);
      // Hosted: the new administrator is signed in here and goes to /admin. Self-hosted: the server
      // hands the sign-in over to the organization's own address.
      if (result.state === "active" && result.destination)
        load(result.destination);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  async function resendRegistrationCode() {
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.post<OtpChallenge>("/v1/auth/otp/resend", {
        challenge_id: challenge.challenge_id,
        dispatch_id: resendOperation,
      });
      setChallenge(next);
      setVerificationOperation(idempotencyKey());
      setResendOperation(idempotencyKey());
      setCode("");
      setNow(Date.now());
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  if (registration?.state === "provisioning_failed")
    return (
      <AuthShell width={440}>
        <span className="au-badge" style={{ background: "#FBE9E6", color: "#A3352B" }}>
          <svg className="au-i" viewBox="0 0 24 24" style={{ width: 26, height: 26 }} aria-hidden="true">
            <path d="M12 3 2 20h20L12 3z" />
            <path d="M12 10v4M12 17h.01" />
          </svg>
        </span>
        <h2 className="au-dsp au-title" style={{ fontSize: 32, lineHeight: "38px" }}>
          Organization setup needs attention
        </h2>
        <p className="au-p">
          Your email is confirmed, but the organization could not be finished. Contact support and we will help you
          complete it. No second organization was created.
        </p>
        <p className="au-p">
          Registration reference for support: <code>{registration.registration_id}</code>
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a className="au-btn au-pri" href="/contact">
            Contact support
          </a>
          <a className="au-btn au-sec" href="/">
            Back to home
          </a>
        </div>
      </AuthShell>
    );
  if (challenge)
    return (
      <AuthShell width={440}>
        <Steps step={2} />
        <Heading title="Confirm your work email">
          We sent a 6-digit code to <b style={{ color: "#13241A" }}>{form.admin_email}</b>. Entering it creates{" "}
          {form.company_name} with you as administrator. The code proves access to the mailbox, not the authority to
          act for the organization.
        </Heading>
        <form onSubmit={verify} style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <CodeInput value={code} onChange={setCode} />
          <button type="submit" className="au-btn au-pri" disabled={busy || code.length !== 6} style={{ height: 52, fontSize: 16 }}>
            {busy && <Spinner />}
            {busy ? "Creating your organization" : "Verify and create organization"}
          </button>
        </form>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 10 }}>
          <button
            type="button"
            className="au-link"
            onClick={() => {
              setChallenge(null);
              setRegistration(null);
              setCode("");
              setError(null);
              setRegistrationOperation(idempotencyKey());
              setRegistrationDispatch(idempotencyKey());
              setVerificationOperation(idempotencyKey());
              setResendOperation(idempotencyKey());
            }}
          >
            Edit organization details
          </button>
          <button
            type="button"
            className="au-link"
            onClick={resendRegistrationCode}
            disabled={busy || now < Date.parse(challenge.retry_at)}
          >
            Send a new code
          </button>
        </div>
        <Delivery challenge={challenge} />
        <Problem error={error} />
      </AuthShell>
    );
  return (
    <AuthShell width={560}>
      <Steps step={1} />
      <Heading title="Register your organization">
        Free forever for up to 50 members. You become the first administrator. More than 50 members?{" "}
        <a href="/contact">Contact us</a>.
      </Heading>
      {!deployment && !deploymentError && <p role="status" className="au-hint">Loading the registration settings…</p>}
      {Boolean(deploymentError) && (
        <Note tone="danger">
          The service did not provide its registration settings, so registration cannot continue safely. Reload the page
          or try again later.
        </Note>
      )}
      <form onSubmit={register} style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <fieldset className="au-fs">
          <legend className="au-lg">Organization</legend>
          <Field
            label="Organization name"
            required
            maxLength={200}
            autoComplete="organization"
            value={form.company_name}
            onChange={(event) => update("company_name", event.target.value)}
          />
          <div className="au-grid2">
            <Field
              label="Organization website"
              type="url"
              required
              autoComplete="url"
              value={form.website}
              onChange={(event) => update("website", event.target.value)}
            />
            <label className="au-lab">
              Country
              <select className="au-field" required value={form.country} onChange={(event) => update("country", event.target.value)}>
                {countries.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </fieldset>
        <fieldset className="au-fs">
          <legend className="au-lg">You</legend>
          <div className="au-grid2">
            <Field
              label="Your name"
              required
              maxLength={200}
              autoComplete="name"
              value={form.registrant_name}
              onChange={(event) => update("registrant_name", event.target.value)}
            />
            <Field
              label="Your role"
              required
              maxLength={200}
              autoComplete="organization-title"
              value={form.registrant_role}
              onChange={(event) => update("registrant_role", event.target.value)}
            />
          </div>
          <Field
            label="Your work email"
            type="email"
            required
            autoComplete="email"
            value={form.admin_email}
            onChange={(event) => update("admin_email", event.target.value)}
            hint={
              deployment?.mode === "hosted"
                ? "Members connect from the extension with an email address on the same domain as yours; that domain is how the service finds your organization. Each domain can have one hosted organization."
                : "Members connect from the extension with an email address on the same domain as yours."
            }
          />
        </fieldset>
        <label className="au-agree">
          <input
            type="checkbox"
            className="au-check"
            checked={form.authority_acknowledged}
            onChange={(event) => update("authority_acknowledged", event.target.checked)}
            required
          />
          <span>I am authorized to register this organization. Verifying my email alone does not prove this.</span>
        </label>
        <label className="au-agree">
          <input
            type="checkbox"
            className="au-check"
            checked={termsAccepted}
            onChange={(event) => setTermsAccepted(event.target.checked)}
            required
          />
          <span>
            For my organization, I accept the <a href="/terms">Terms of use</a> and the{" "}
            <a href="/dpa">Data processing agreement</a>. The <a href="/privacy-policy">Privacy policy</a> explains how
            my own details are used.
          </span>
        </label>
        <button
          type="submit"
          className="au-btn au-pri"
          disabled={busy || !deployment || !form.authority_acknowledged || !termsAccepted}
          style={{ height: 52, fontSize: 16 }}
        >
          {busy && <Spinner />}
          {busy ? "Sending the code" : "Continue"}
        </button>
      </form>
      <Problem error={error} />
      <span style={{ fontSize: 14, color: "#4A5A4E" }}>
        Already registered? <a href="/login">Sign in</a>
      </span>
    </AuthShell>
  );
}

type DeploymentConfig = {
  mode: "hosted" | "self_hosted";
  registration_origin: string;
};
