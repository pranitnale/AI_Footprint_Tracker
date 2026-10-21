import { useState } from "react";
import { Dialog } from "@footprint/ui";
import { ApiClient } from "../api";
import { Button, ErrorState, Notice, PageTitle, formatDateTime } from "../components";
import type { Navigate } from "../router";
import type { Session } from "../types";
import { Card, Skeleton } from "./controls";
import { ActionReauthSteps, useActionReauth } from "./reauth";
import { useApi } from "./state";

export type OrganizationDeletionState = {
  status: "none" | "scheduled" | "deleting";
  requested_at: string | null;
  delete_after: string | null;
  grace_days: number;
};

const DELETION_PATH = "/v1/admin/organization/deletion";

/** The server compares the typed name the same way, trimmed and ignoring case. */
export function organizationNameMatches(typed: string, name: string | null | undefined) {
  return Boolean(name) && typed.trim().toLowerCase() === name!.trim().toLowerCase();
}

/** The "Delete organization" section of the Plan page. */
export function OrganizationDeletion({
  api,
  session,
  navigate,
  onScheduled,
}: {
  api: ApiClient;
  session: Session;
  navigate?: Navigate;
  onScheduled: () => void;
}) {
  const state = useApi(() => api.get<OrganizationDeletionState>(DELETION_PATH));
  const [open, setOpen] = useState(false);
  const grace = state.data?.grace_days ?? 7;
  const days = `${grace} ${grace === 1 ? "day" : "days"}`;
  return (
    <Card title="Delete organization">
      <p>
        Deleting the organization removes all of its data from this service {days} after you confirm: every member and their
        role, every connected browser, all usage records and earlier messages read from chats, the totals and the audit log.
      </p>
      <p>
        Members' browsers stop sending usage at once, and the admin pages close until the deletion happens. You can cancel
        during these {days}. Exports that were already downloaded cannot be erased by this service. If you need the records,
        create an export first in{" "}
        <a
          href="/admin/policies"
          onClick={(event) => {
            if (!navigate) return;
            event.preventDefault();
            navigate("/admin/policies");
          }}
        >
          Policies and data
        </a>
        .
      </p>
      {state.error ? (
        <ErrorState error={state.error} onRetry={state.retry} />
      ) : !state.data ? (
        <Skeleton label="Checking the organization's deletion status" />
      ) : state.data.status !== "none" ? (
        <Notice tone="warning" title="Deletion is already requested">
          Reload the page to see the deletion date and to cancel it.
        </Notice>
      ) : (
        <Button variant="danger" onClick={() => setOpen(true)}>
          Delete organization
        </Button>
      )}
      {open && (
        <DeleteOrganizationDialog
          api={api}
          session={session}
          days={days}
          onClose={() => setOpen(false)}
          onScheduled={onScheduled}
        />
      )}
    </Card>
  );
}

function DeleteOrganizationDialog({
  api,
  session,
  days,
  onClose,
  onScheduled,
}: {
  api: ApiClient;
  session: Session;
  days: string;
  onClose: () => void;
  onScheduled: () => void;
}) {
  const reauth = useActionReauth(api);
  const [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const company = session.company_name;
  const matches = organizationNameMatches(name, company);
  async function confirm() {
    if (!matches || !reauth.token) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<OrganizationDeletionState>(DELETION_PATH, {
        reauth_token: reauth.token,
        confirm_name: name.trim(),
      });
      if (result?.status !== "scheduled")
        throw new Error("The server did not confirm the deletion. Nothing is shown as scheduled.");
      onScheduled();
    } catch (caught) {
      setError(caught);
      // A refused or used code cannot be tried again; ask for a new one.
      if ((caught as { code?: string }).code === "reauthentication_required") reauth.reset({ fresh: true });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={`Delete ${company ?? "this organization"}?`}
      onClose={onClose}
      dangerous
      actions={
        <>
          <button type="button" className="ad-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="ad-btn ad-btn-danger" onClick={confirm} disabled={busy || !matches || !reauth.token}>
            {busy ? "Requesting deletion" : "Delete organization"}
          </button>
        </>
      }
    >
      <p>
        All of the organization's data will be deleted for good after {days}. Members' browsers stop syncing at once.
      </p>
      <label>
        Type the organization name, {company ?? "as registered"}, to confirm
        <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />
      </label>
      <ActionReauthSteps reauth={reauth} email={session.email} disabled={busy} />
      {reauth.token && <p className="small">Your code is verified. It is valid for 5 minutes and one action.</p>}
      {Boolean(error ?? reauth.error) && (
        <ErrorState error={error ?? reauth.error} context="action" title="Deletion was not requested" />
      )}
    </Dialog>
  );
}

/**
 * Shown instead of every admin page while deletion is scheduled or running: the server answers
 * the other admin endpoints with 403 service_suspended until it is cancelled.
 */
export function OrganizationDeletionNotice({
  api,
  company,
  onCancelled,
}: {
  api: ApiClient;
  company: string | null;
  onCancelled: () => void;
}) {
  const state = useApi(() => api.get<OrganizationDeletionState>(DELETION_PATH));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.delete<OrganizationDeletionState>(DELETION_PATH);
      if (result?.status !== "none") throw new Error("The server did not confirm the cancellation. The deletion may still be scheduled.");
      onCancelled();
    } catch (caught) {
      setError(caught);
      // Deletion may have started meanwhile; show the current state.
      if ((caught as { code?: string }).code === "deletion_in_progress") state.retry();
    } finally {
      setBusy(false);
    }
  }
  const who = company ?? "This organization";
  const data = state.data;
  return (
    <>
      <PageTitle title={data?.status === "deleting" ? "The organization is being deleted" : "The organization is scheduled for deletion"} />
      {state.error ? (
        <ErrorState error={state.error} onRetry={state.retry} />
      ) : !data ? (
        <Skeleton label="Loading the deletion date" />
      ) : data.status === "deleting" ? (
        <Notice tone="danger" title="Deletion has started">
          <p>{who}'s data is being deleted for good. It can no longer be cancelled.</p>
        </Notice>
      ) : data.status === "none" ? (
        <Notice title="Deletion is not scheduled">
          <p>The deletion was cancelled, possibly by another administrator.</p>
          <Button variant="primary" onClick={onCancelled}>
            Open the dashboard
          </Button>
        </Notice>
      ) : (
        <Notice tone="warning" title={data.delete_after ? `Deletion on ${formatDateTime(data.delete_after)}` : "Deletion is scheduled"}>
          <p>
            {who}'s members, browsers, usage records, history, totals and audit log will be deleted for good
            {data.delete_after ? ` on ${formatDateTime(data.delete_after)}` : ` ${data.grace_days} days after the request`}.
          </p>
          <p>Members' browsers stopped syncing when the deletion was requested. The admin pages stay closed until you cancel.</p>
          <Button variant="primary" onClick={cancel} disabled={busy}>
            {busy ? "Cancelling deletion" : "Cancel deletion"}
          </Button>
        </Notice>
      )}
      {Boolean(error) && <ErrorState error={error} context="action" title="Deletion was not cancelled" />}
    </>
  );
}
