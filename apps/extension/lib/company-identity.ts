import type { Scope, StoredCredentials } from "@footprint/ledger";
import { createIdentityKeyer } from "./ownership";

/**
 * Company keys (W11). Members of one company can see the same prompt or reply, for example
 * on a shared provider account. Each browser names it with an HMAC of the provider's own
 * id under the company's key, so the server counts it once without ever seeing the id.
 * Only ids that saved history shows too are used, so a live capture and a saved copy of
 * the same prompt or reply get the same key. The kinds differ from the per-member ones.
 */
export type CompanyKeyKind =
  | "company-request"
  | "company-attempt"
  | "company-saved-prompt"
  | "company-saved-response";

/** Requests whose prompt the user wrote. Other requests name no prompt. */
export const PROMPT_ACTIONS: ReadonlySet<string> = new Set([
  "send",
  "edit_and_send",
]);
/**
 * Requests that make a new reply. Read aloud and notebook guides make other output from a
 * reply or notebook, and a continued reply extends one already named, so none names one.
 */
export const REPLY_ACTIONS: ReadonlySet<string> = new Set([
  "send",
  "edit_and_send",
  "regenerate",
]);
/** Sites whose request carries the id saved history gives the prompt. */
export const REQUEST_PROMPT_SITES: ReadonlySet<string> = new Set([
  "chatgpt",
  "perplexity",
]);

/** The company's key for a scope, when the server handed one out for that enrolment. */
export function companyKeySecret(
  credentials: StoredCredentials | null | undefined,
  scope: Scope,
): string | null {
  return scope.mode === "company" &&
    credentials?.namespace === scope.namespace &&
    credentials.enrollment_era.id === scope.era
    ? (credentials.company_dedup_key ?? null)
    : null;
}

/** Signs company keys for one secret, importing it once. */
export function companyKeyer(secret: string) {
  const keyer = createIdentityKeyer(secret);
  return (site: string, kind: CompanyKeyKind, id: string) =>
    keyer(site, kind, id);
}

/**
 * The prompt id a reply's stream names, as saved history keys that prompt: Gemini's turn
 * id, and the message a Claude reply answers. ChatGPT and Perplexity send it with the
 * request instead (`REQUEST_PROMPT_SITES`).
 */
export function streamPromptId(
  site: string,
  snapshot: { providerRequestId?: string; parentId: string | null },
): string | null {
  if (site === "gemini") return snapshot.providerRequestId ?? null;
  if (site === "claude") return snapshot.parentId;
  return null;
}

/**
 * The id and kind that name a saved message for the company. Prompts and replies use the
 * ids their live capture uses. Rows no live capture sees, such as NotebookLM Studio items,
 * use their own id with the saved kinds. Cowork results are counted from each browser's
 * own checkpoint, so two members' rows of one result are different measurements and get
 * no key: each copy counts, as before.
 */
export function savedCompanyId(
  site: string,
  cowork: boolean,
  message: {
    role: "prompt" | "response";
    sourceId: string;
    requestId: string | null;
    liveAttemptId: string | null;
  },
): { kind: CompanyKeyKind; id: string } | null {
  if (cowork) return null;
  // A NotebookLM Studio reply names no live attempt; its saved chat replies do.
  if (message.role === "response")
    return message.liveAttemptId
      ? { kind: "company-attempt", id: message.liveAttemptId }
      : { kind: "company-saved-response", id: message.sourceId };
  const prompt =
    site === "notebooklm"
      ? null
      : (message.requestId ?? (site === "claude" ? message.sourceId : null));
  return prompt
    ? { kind: "company-request", id: prompt }
    : { kind: "company-saved-prompt", id: message.sourceId };
}
