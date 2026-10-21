import { browser } from "wxt/browser";
import {
  EngineSelectionRequestSchema,
  EngineStatusSchema,
  type EngineSelectionRequest,
  type EngineStatus,
} from "@footprint/contracts";
import type { Settings } from "./types";
import type { buildUsageFilters } from "../ui-model";
import {
  validatedMethodStatus,
  validatedRecalculation,
  validatedTrackingHealth,
} from "./response-validators";
import {
  ORGANIZATION_CONSENT_VERSION,
  TRACKING_CONSENT_VERSION,
} from "../tracking-consent";
import {
  validatedDashboard,
  validatedMonthly,
  validatedBreakdown,
  validatedServerSummary,
  object,
} from "./summary-validators";

export type DashboardAction =
  | "dashboard"
  | "view-token"
  | "method-status"
  | "refresh-methods"
  | "tracking-health"
  | "company-summary"
  | "my-summary"
  | "monthly-summary"
  | "usage-breakdown"
  | "start-recalculation"
  | "recalculation-status"
  | "engine-status"
  | "select-engine"
  | "resume-engine"
  | "settings"
  | "expand"
  | "connect"
  | "verify-code"
  | "confirm-connection"
  | "organization-consent"
  | "cancel-connection"
  | "disconnect"
  | "sync"
  | "erase-local"
  | "consent";

// Transport returns untrusted data. Only the named client methods publish parsed results.
export type Transport = (
  action: DashboardAction,
  payload?: Record<string, unknown>,
) => Promise<unknown>;
export type PermissionRequest = (origin: string) => Promise<boolean>;

export async function runtimePermissionRequest(origin: string) {
  const { requestServerOrigin } = await import("../platform");
  return requestServerOrigin(origin);
}

export const runtimeTransport: Transport = async (action, payload = {}) => {
  const result: unknown = await browser.runtime.sendMessage({
    ...payload,
    target: "ui",
    action,
  });
  if (object(result) && result.error) {
    throw Object.assign(
      new Error(
        typeof result.error === "string"
          ? result.error
          : "extension_request_failed",
      ),
      {
        code: typeof result.code === "string" ? result.code : null,
        detail: typeof result.detail === "string" ? result.detail.slice(0, 200) : null,
      },
    );
  }
  return result;
};

function ok(value: unknown): { ok: true } {
  if (!object(value) || value.ok !== true)
    throw new Error("extension_response_invalid");
  return { ok: true };
}

function engineStatus(value: unknown): EngineStatus {
  const status = EngineStatusSchema.parse(value);
  const requested =
    status.preference === "build_default"
      ? status.buildDefault
      : status.preference;
  if (
    (status.preference === null &&
      (status.reason === null ||
        status.effectiveEngine !== null ||
        status.method !== null)) ||
    (status.effectiveEngine !== null && status.effectiveEngine !== requested) ||
    (status.method !== null &&
      status.method.engine_id !== status.effectiveEngine)
  )
    throw new Error("engine_status_invalid");
  return status;
}

function viewToken(value: unknown): {
  scopeToken: string;
  erasing: boolean;
  settings: Settings;
} {
  const settings = object(value) ? value.settings : null;
  if (
    !object(value) ||
    typeof value.scopeToken !== "string" ||
    typeof value.erasing !== "boolean" ||
    !object(settings) ||
    typeof settings.paused !== "boolean" ||
    typeof settings.timezone !== "string" ||
    typeof settings.displayScenario !== "string"
  )
    throw new Error("extension_response_invalid");
  return value as { scopeToken: string; erasing: boolean; settings: Settings };
}

export function createDashboardClient(transport: Transport) {
  return {
    dashboard: async (filters: ReturnType<typeof buildUsageFilters>["local"]) =>
      validatedDashboard(await transport("dashboard", { filters })),
    /** The quick check the popup's saved figures must pass before the dashboard arrives. */
    viewToken: async () => viewToken(await transport("view-token")),
    methodStatus: async () =>
      validatedMethodStatus(await transport("method-status")),
    refreshMethods: async () =>
      validatedMethodStatus(await transport("refresh-methods")),
    trackingHealth: async () =>
      validatedTrackingHealth(await transport("tracking-health")),
    serverSummary: async (view: "my" | "company", query: string) =>
      validatedServerSummary(
        await transport(view === "company" ? "company-summary" : "my-summary", {
          query,
        }),
      ),
    monthlySummary: async () =>
      validatedMonthly(await transport("monthly-summary")),
    usageBreakdown: async (request: {
      start?: string;
      end?: string;
      bucket: "hour" | "day";
      timezone: string;
    }) => validatedBreakdown(await transport("usage-breakdown", request)),
    startRecalculation: async (methodId: string, operationId: string) =>
      validatedRecalculation(
        await transport("start-recalculation", { methodId, operationId }),
      ),
    recalculationStatus: async (jobId: string) =>
      validatedRecalculation(
        await transport("recalculation-status", { jobId }),
      ),
    engineStatus: async () => engineStatus(await transport("engine-status")),
    selectEngine: async (request: EngineSelectionRequest) =>
      engineStatus(
        await transport(
          "select-engine",
          EngineSelectionRequestSchema.parse(request),
        ),
      ),
    resumeEngine: async () => engineStatus(await transport("resume-engine")),
    settings: async (changes: Settings) =>
      ok(await transport("settings", { changes })),
    /** Sends the email code; calling it again for the same origin sends a new code. */
    connect: async (origin: string, email: string) =>
      ok(await transport("connect", { origin, email })),
    verifyCode: async (code: string) =>
      ok(await transport("verify-code", { code })),
    /**
     * Connects after the person ticked "I agree to share this browser's AI use" in the Connect
     * dialog; the background keeps that agreement with the version of the dialog's text.
     */
    confirmConnection: async (agreed: boolean) => {
      if (agreed !== true) throw new Error("Tick the box to agree before connecting.");
      const value = await transport("confirm-connection", {
        agreed: true,
        version: ORGANIZATION_CONSENT_VERSION,
      });
      ok(value);
      // review: the server's operator switches change what the dialog showed, so the person
      // agrees to the updated text before anything is shared (lib/organization-terms.ts).
      return { ok: true as const, review: (value as { review?: unknown }).review === true };
    },
    /** The agreement to the updated text for the server's switches, from the dialog or Settings. */
    agreeOrganization: async (version: string) =>
      ok(await transport("organization-consent", { agreed: true, version })),
    /**
     * Agree and start (with the choice of "Load full chat history automatically" made beside
     * it), or Turn off tracking. Nothing is tracked before the person agrees.
     */
    consent: async (change: { agreed: boolean; ownRead?: boolean }) =>
      ok(
        await transport("consent", {
          agreed: change.agreed,
          ...(change.agreed ? { version: TRACKING_CONSENT_VERSION } : {}),
          ...(typeof change.ownRead === "boolean" ? { ownRead: change.ownRead } : {}),
        }),
      ),
    command: async (
      action: "expand" | "cancel-connection" | "disconnect" | "sync",
    ) => ok(await transport(action)),
    eraseLocal: async () => {
      const value = await transport("erase-local");
      if (
        !object(value) ||
        typeof value.count !== "number" ||
        !Number.isSafeInteger(value.count) ||
        value.count < 0
      )
        throw new Error("erase_response_invalid");
      return { count: value.count };
    },
  };
}
export type DashboardClient = ReturnType<typeof createDashboardClient>;
