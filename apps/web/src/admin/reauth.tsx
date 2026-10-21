import { useEffect, useState, type FormEvent } from "react";
import { emailCodeDigits } from "@footprint/ui/formatters";
import { ApiClient, idempotencyKey } from "../api";
import { Button, formatDateTime } from "../components";
import type { OtpChallenge } from "../types";

/**
 * The fresh email code that every destructive admin action needs. The server's token is single
 * use and lasts five minutes, so each action owns one of these and asks for a new code after use.
 * With `operator` the developer panel asks for its own code, which goes to the configured address
 * of the signed-in developer.
 */
export function useActionReauth(api: ApiClient, { operator = false }: { operator?: boolean } = {}) {
  const auth = operator ? "/v1/operator/auth" : "/v1/auth";
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null),
    [token, setToken] = useState(""),
    [code, setCode] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [dispatch, setDispatch] = useState(idempotencyKey),
    [verification, setVerification] = useState(idempotencyKey),
    [resendId, setResendId] = useState(idempotencyKey),
    [now, setNow] = useState(Date.now());
  // The resend button unlocks when the server's retry time passes, without polling.
  useEffect(() => {
    if (!challenge) return;
    const delay = Math.max(0, Date.parse(challenge.retry_at) - Date.now());
    const timer = window.setTimeout(() => setNow(Date.now()), delay + 25);
    return () => window.clearTimeout(timer);
  }, [challenge?.retry_at]);

  async function run(step: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await step();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  const request = (email: string) =>
    run(async () => {
      setChallenge(
        await api.post<OtpChallenge>(`${auth}/otp/request`, {
          purpose: operator ? "operator_reauth" : "action_reauth",
          email,
          dispatch_id: dispatch,
          registration_id: null,
        }),
      );
    });
  const verify = () =>
    run(async () => {
      if (!challenge) return;
      const value = await api.post<{ reauth_token: string }>(`${auth}/otp/verify`, {
        challenge_id: challenge.challenge_id,
        code,
        verification_id: verification,
      });
      setToken(value.reauth_token);
    });
  const resend = () =>
    run(async () => {
      if (!challenge) return;
      setChallenge(
        await api.post<OtpChallenge>("/v1/auth/otp/resend", {
          challenge_id: challenge.challenge_id,
          dispatch_id: resendId,
        }),
      );
      setVerification(idempotencyKey());
      setResendId(idempotencyKey());
      setCode("");
      setNow(Date.now());
    });
  /**
   * Back to the email step. `fresh` starts a new code request, for when the last token was used
   * or refused; without it a repeated request replays the same dispatch, as before.
   */
  function reset({ fresh = false }: { fresh?: boolean } = {}) {
    setChallenge(null);
    setToken("");
    setCode("");
    setError(null);
    if (fresh) {
      setDispatch(idempotencyKey());
      setVerification(idempotencyKey());
      setResendId(idempotencyKey());
    }
  }
  return {
    challenge,
    token,
    code,
    setCode,
    busy,
    error,
    canResend: Boolean(challenge) && now >= Date.parse(challenge?.retry_at ?? ""),
    request,
    verify,
    resend,
    reset,
  };
}
export type ActionReauth = ReturnType<typeof useActionReauth>;

/**
 * The email and code steps. Renders nothing once the token arrives, so the caller shows its own
 * final confirmation in its place. `disabled` covers work the caller is doing at the same time.
 */
export function ActionReauthSteps({
  reauth,
  email,
  disabled = false,
}: {
  reauth: ActionReauth;
  email: string | null | undefined;
  disabled?: boolean;
}) {
  const busy = disabled || reauth.busy;
  if (reauth.token) return null;
  if (!reauth.challenge)
    return (
      <form
        className="ad-step-form"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          reauth.request(String(new FormData(event.currentTarget).get("email")));
        }}
      >
        <label>
          Confirm your work email
          <input name="email" type="email" required defaultValue={email ?? ""} />
        </label>
        <Button variant="primary" type="submit" disabled={busy}>
          Email a fresh action code
        </Button>
      </form>
    );
  return (
    <div className="ad-step-form">
      <label>
        Action verification code
        <input
          className="ad-code"
          value={reauth.code}
          // No maxLength: it would cut a pasted "094 475" to "094 47" before the space is dropped.
          onChange={(event) => reauth.setCode(emailCodeDigits(event.target.value))}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
        />
      </label>
      <div className="actions">
        <Button variant="primary" onClick={reauth.verify} disabled={busy || reauth.code.length !== 6}>
          Verify code
        </Button>
        <Button onClick={reauth.resend} disabled={busy || !reauth.canResend}>
          Request another code
        </Button>
      </div>
      <p className="small">
        Code expires {formatDateTime(reauth.challenge.expires_at)}. Delivery state:{" "}
        {reauth.challenge.delivery_state ? reauth.challenge.delivery_state.replaceAll("_", " ") : "Unknown"}.
      </p>
    </div>
  );
}
