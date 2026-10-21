import { idempotencyKey } from "./api";
import { zonedMidnight } from "@footprint/ui/dates";

export function buildDeletionExecution(
  previewToken: string,
  reauthToken: string,
  confirmed: boolean,
  operationId = idempotencyKey(),
) {
  if (!confirmed || !previewToken || !reauthToken)
    throw new Error(
      "Deletion requires a current preview, recent verification and explicit confirmation.",
    );
  return {
    preview_token: previewToken,
    idempotency_key: operationId,
    confirmed: true as const,
    reauth_token: reauthToken,
  };
}

export function buildDeletionPreview(
  scope: "range" | "user" | "company",
  values: { start?: string; end?: string; user_id?: string },
  timezone: string,
) {
  const body: {
    scope: typeof scope;
    user_id: string | null;
    start: string | null;
    end: string | null;
  } = { scope, user_id: null, start: null, end: null };
  if (scope === "user") body.user_id = values.user_id || null;
  if (scope === "range") {
    if (!values.start || !values.end || values.start >= values.end)
      throw new Error("Choose a start date before the exclusive end date.");
    body.start = zonedMidnight(values.start, timezone);
    body.end = zonedMidnight(values.end, timezone);
  }
  return body;
}

export type DownloadConfig = Partial<
  Record<"chrome" | "edge" | "firefox", string>
>;
export function resolveDownloads(config?: DownloadConfig) {
  const defaults: Record<keyof DownloadConfig, string> = {
    chrome: "/downloads/ai-footprint-tracker-chrome.zip",
    edge: "/downloads/ai-footprint-tracker-edge.zip",
    firefox: "/downloads/ai-footprint-tracker-firefox.zip",
  };
  return (["chrome", "edge", "firefox"] as const).map((id) => ({
    id,
    href: config ? (config[id] ?? null) : defaults[id],
  }));
}
