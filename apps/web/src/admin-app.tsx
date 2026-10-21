// The signed-in admin dashboard, loaded as its own route group so that website visitors and the
// developer panel do not download it.
import type { ApiClient } from "./api";
import type { Navigate } from "./router";
import type { Session } from "./types";
import {
  AdminAudit,
  AdminDeletion,
  AdminHealth,
  AdminHealthByBrowser,
  AdminNetwork,
  AdminPlan,
  AdminPolicies,
  AdminRequests,
  AdminTools,
} from "./admin-pages";
import { AdminActivity } from "./admin/AdminActivity";
import { AdminOverview } from "./admin/AdminOverview";
import { AdminPeople, AdminPerson } from "./admin/AdminPeople";
import { AdminPeopleNamed, AdminPersonNamed } from "./admin/AdminPeopleNamed";
import { useServerFeatures, type ServerFeatures } from "./admin/features";
import { OrganizationDeletionNotice } from "./admin/AdminOrganization";
import { AppLayout } from "./components";

export function AdminApp({
  path,
  api,
  session,
  navigate,
  onLogout,
  logoutError,
  logoutPending,
  onPrivilegeLost,
  reloadSession,
}: {
  path: string;
  api: ApiClient;
  session: Session;
  navigate: Navigate;
  onLogout: () => void;
  logoutError: unknown;
  logoutPending: boolean;
  /** A role change ends the account's sessions, and only administrators use the website. */
  onPrivilegeLost: () => void;
  reloadSession: () => void;
}) {
  const deleting =
    session.organization_status === "deletion_scheduled" ||
    session.organization_status === "deleting";
  const features = useServerFeatures(api, !deleting);
  return (
    <AppLayout
      mode="admin"
      features={features}
      path={path}
      company={session.company_name}
      email={session.email}
      navigate={navigate}
      onLogout={onLogout}
      logoutError={logoutError}
      logoutPending={logoutPending}
    >
      {deleting ? (
        <OrganizationDeletionNotice
          api={api}
          company={session.company_name}
          onCancelled={() => {
            navigate("/admin", true);
            reloadSession();
          }}
        />
      ) : (
        adminPage(path, api, session, navigate, onPrivilegeLost, reloadSession, features)
      )}
    </AppLayout>
  );
}

function adminPage(
  path: string,
  api: ApiClient,
  session: Session,
  navigate: Navigate,
  onPrivilegeLost: () => void,
  onDeletionScheduled: () => void,
  features: ServerFeatures,
) {
  // Per-person pages only while the server has person analytics switched on (admin/features.ts);
  // otherwise the aggregate pages of 18 October 2026.
  const named = features.person_analytics;
  const person = /^\/admin\/people\/([0-9a-f-]{36})$/.exec(path);
  if (person && named)
    return (
      <AdminPersonNamed key={person[1]} api={api} navigate={navigate} userId={person[1]!} session={session} />
    );
  if (person)
    return (
      <AdminPerson
        key={person[1]}
        api={api}
        navigate={navigate}
        userId={person[1]!}
        session={session}
        onPrivilegeLost={onPrivilegeLost}
      />
    );
  switch (path) {
    case "/admin":
      return <AdminOverview api={api} navigate={navigate} />;
    // Earlier addresses of the pages People and Policies and data replaced.
    case "/admin/people":
    case "/admin/users":
    case "/admin/usage":
      if (named)
        return <AdminPeopleNamed api={api} navigate={navigate} onPrivilegeLost={onPrivilegeLost} session={session} />;
      return (
        <AdminPeople
          api={api}
          navigate={navigate}
          onPrivilegeLost={onPrivilegeLost}
          session={session}
        />
      );
    case "/admin/tools":
      return <AdminTools api={api} features={features} />;
    case "/admin/activity":
      return <AdminActivity api={api} />;
    // Without person analytics the Requests page's address leads to Activity, which replaces it.
    case "/admin/requests":
      return named ? <AdminRequests api={api} /> : <AdminActivity api={api} />;
    case "/admin/network":
      if (named && features.ip_collection) return <AdminNetwork api={api} session={session} />;
      return notFound();
    case "/admin/health":
      return named ? <AdminHealthByBrowser api={api} /> : <AdminHealth api={api} />;
    case "/admin/policies":
    case "/admin/exports":
      return <AdminPolicies api={api} session={session} />;
    case "/admin/audit":
      return <AdminAudit api={api} />;
    case "/admin/deletions":
      return <AdminDeletion api={api} session={session} />;
    case "/admin/plan":
      return <AdminPlan api={api} navigate={navigate} session={session} onDeletionScheduled={onDeletionScheduled} />;
    default:
      return notFound();
  }
}

function notFound() {
  return (
    <section>
      <h1>Admin page not found</h1>
    </section>
  );
}
