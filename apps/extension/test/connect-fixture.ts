// Server answers for connecting with an email code (POST /v1/connections/otp/request, then
// POST /v1/connections with the code), shaped as the server contract of 13 October 2026.
import type { CompanySession } from "../lib/company";

export const TEST_WORK_EMAIL = "person@company.example";
export const TEST_CODE = "123456";
export const TEST_COMPANY_NAME = "Example Company";

/** The challenge a code request returns: the code lives five minutes, another may follow after one. */
export function codeSent(now = Date.now()) {
  return {
    challenge_id: "challenge-" + crypto.randomUUID(),
    delivery_state: "sent",
    expires_at: new Date(now + 300_000).toISOString(),
    retry_at: new Date(now + 60_000).toISOString(),
    error_code: null,
  };
}

/** The connection the server holds once the code is accepted, waiting for the person to confirm. */
export function verifiedConnection(
  origin: string,
  deletionPublicKey: string,
  options: { policyVersion?: string; connectionId?: string; companyName?: string } = {},
) {
  return {
    connection_id: options.connectionId ?? crypto.randomUUID(),
    state: "verified",
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    company_name: options.companyName ?? TEST_COMPANY_NAME,
    company_origin: origin,
    policy: { policy_version: options.policyVersion ?? "1.0.0" },
    deletion_public_key: deletionPublicKey,
    poll_interval_seconds: 5,
  };
}

/** The three connection steps a person takes: request the code, enter it, confirm. */
export async function connectCompany(
  client: Pick<CompanySession, "requestCode" | "verifyCode" | "confirm">,
  origin: string,
  family: "chrome" | "edge" | "firefox" = "chrome",
) {
  await client.requestCode(origin, TEST_WORK_EMAIL);
  await client.verifyCode(TEST_CODE, family);
  return client.confirm();
}

/** A JSON error body as the server sends it. */
export function serverError(code: string, status: number) {
  return new Response(
    JSON.stringify({
      error: { code, retryable: false, correlation_id: crypto.randomUUID(), safe_message: "Server words." },
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}
