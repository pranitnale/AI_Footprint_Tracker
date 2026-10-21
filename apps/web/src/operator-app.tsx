// The developer panel, loaded as its own route group so that website visitors and administrators
// do not download it.
import type { ReactNode } from "react";
import type { ApiClient } from "./api";
import type { Navigate } from "./router";
import { AppLayout } from "./components";
import {
  OperatorContacts,
  OperatorExceptions,
  OperatorHealth,
  OperatorOrganizations,
  OperatorPlans,
  useNewContactCount,
} from "./operator-pages";

export function OperatorApp({
  api,
  path,
  email,
  navigate,
  onLogout,
  logoutError,
  logoutPending,
}: {
  api: ApiClient;
  path: string;
  /** The developer's own address; action codes go to it. */
  email?: string | null;
  navigate: Navigate;
  onLogout: () => void;
  logoutError: unknown;
  logoutPending: boolean;
}) {
  return (
    <OperatorShell
      api={api}
      path={path}
      email={email}
      navigate={navigate}
      onLogout={onLogout}
      logoutError={logoutError}
      logoutPending={logoutPending}
    >
      {operatorPage(path, api, navigate, email)}
    </OperatorShell>
  );
}

/** The developer panel shell, with the count of new contact requests beside its nav item. */
function OperatorShell({
  api,
  children,
  ...layout
}: {
  api: ApiClient;
  path: string;
  email?: string | null;
  navigate: Navigate;
  onLogout: () => void;
  logoutError: unknown;
  logoutPending: boolean;
  children: ReactNode;
}) {
  const contacts = useNewContactCount(api);
  return (
    <AppLayout mode="operator" badges={{ "/operator/contacts": contacts ?? 0 }} {...layout}>
      {children}
    </AppLayout>
  );
}

function operatorPage(
  path: string,
  api: ApiClient,
  navigate: Navigate,
  email: string | null | undefined,
) {
  switch (path) {
    case "/operator":
      return <OperatorOrganizations api={api} navigate={navigate} email={email} />;
    case "/operator/contacts":
      return <OperatorContacts api={api} navigate={navigate} email={email} />;
    case "/operator/plans":
      return <OperatorPlans api={api} />;
    case "/operator/exceptions":
      return <OperatorExceptions api={api} email={email} />;
    case "/operator/health":
      return <OperatorHealth api={api} />;
    default:
      return (
        <section>
          <h1>Operator page not found</h1>
        </section>
      );
  }
}
