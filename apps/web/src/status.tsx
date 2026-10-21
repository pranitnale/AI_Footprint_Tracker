import { Button, Notice } from "@footprint/ui";
import type { ApiError } from "./api";

// Loading and ErrorState live apart from components.tsx so that the website entry, which shows them
// while a session or a page loads, does not pull in the admin and developer panel components.
export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  context = "page",
  title,
}: {
  error: unknown;
  onRetry?: () => void;
  context?: "page" | "action";
  title?: string;
}) {
  const api = error as ApiError;
  const expired =
    api?.status === 401 && api?.code === "authentication_required";
  const actionMessages: Record<string, string> = {
    immutable_plan: "This plan version already exists. Create a new version.",
    entitlement_conflict:
      "Another plan transition or exception is active. Review, cancel or replace it before starting a new entitlement change.",
    transition_review_required:
      "This transition no longer matches the current entitlement. Review its updated impact before continuing.",
    exception_reversion_required:
      "This transition belongs to an exception reversion. Replace or revoke the exception through its own control.",
    transition_terminal:
      "This transition has already ended. Reload the current plan changes before continuing.",
    stale_version:
      "The record changed after this page loaded. Reload its current version before trying again.",
  };
  const message =
    (actionMessages[api?.code] ?? api?.message) ||
    (context === "action"
      ? "The action was not completed. Existing records were not changed."
      : "The latest data could not be loaded. Existing records were not changed.");
  return (
    <Notice
      tone="danger"
      title={
        title ??
        (expired
          ? "Your session ended"
          : context === "action"
            ? "Action was not completed"
            : "This page could not be loaded")
      }
    >
      <p>{message}</p>
      {api?.correlation_id && (
        <p className="technical">Reference {api.correlation_id}</p>
      )}
      {expired ? (
        <a href="/login">Sign in again</a>
      ) : (
        onRetry && <Button onClick={onRetry}>Try again</Button>
      )}
    </Notice>
  );
}
