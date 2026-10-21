import { useEffect, useMemo, useRef, useState } from "react";
import { ApiClient, ApiError, companyConfig, forgetSessionReads, setFigureScope } from "./api";
import { createNavigator, normalizePath, type Navigate } from "./router";
import type { Session } from "./types";
import { lazyPage, RouteGroup, routeChunk } from "./lazy-routes";
import { ErrorState, Loading } from "./status";
import type { MethodologyLinks } from "@footprint/ui/methodology";
import { SiteLayout } from "./site/SiteLayout";
import { SITE_ROUTES } from "./site/board";
import { SOURCE_REPOSITORY_URL } from "./site/repository";
import { WebHomePage } from "./site/pages/WebHome";
import { WebNotFoundPage } from "./site/pages/WebNotFound";
import {
  forgetAdminSession,
  hasAdminHint,
  rememberAdminSession,
  staysOnWebsite,
  takeWebsiteMarker,
} from "./admin-hint";

// Each route group is its own download, so a visitor of the landing page loads neither the
// dashboards nor the methodology, and an administrator does not load the developer panel.
const loadAdmin = routeChunk(() => import("./admin-app"));
const loadOperator = routeChunk(() => import("./operator-app"));
const loadAuth = routeChunk(() => import("./auth-pages"));
const loadSite = routeChunk(() => import("./site/site-pages"));
const loadMethodology = routeChunk(() => import("./methodology-pages"));
const AdminApp = lazyPage(loadAdmin, "AdminApp");
const OperatorApp = lazyPage(loadOperator, "OperatorApp");
const LoginPage = lazyPage(loadAuth, "LoginPage");
const RegisterPage = lazyPage(loadAuth, "RegisterPage");
const Methodology = lazyPage(loadMethodology, "Methodology");
const MethodologyPage = lazyPage(loadMethodology, "MethodologyPage");
const WebContactPage = lazyPage(loadSite, "WebContactPage");
const WebDPAPage = lazyPage(loadSite, "WebDPAPage");
const WebDownloadsPage = lazyPage(loadSite, "WebDownloadsPage");
const WebImprintPage = lazyPage(loadSite, "WebImprintPage");
const WebOpenSourcePage = lazyPage(loadSite, "WebOpenSourcePage");
const WebPrivacyPage = lazyPage(loadSite, "WebPrivacyPage");
const WebPrivacyPolicyPage = lazyPage(loadSite, "WebPrivacyPolicyPage");
const WebSelfHostPage = lazyPage(loadSite, "WebSelfHostPage");
const WebTeamsPage = lazyPage(loadSite, "WebTeamsPage");
const WebTermsPage = lazyPage(loadSite, "WebTermsPage");

const publicRoutes = new Set([
  "/",
  "/methodology",
  "/methodology/ecologits",
  "/methodology/reference",
  "/privacy",
  "/open-source",
  "/downloads",
  "/download",
  "/teams",
  "/self-host",
  "/contact",
  "/terms",
  "/privacy-policy",
  "/dpa",
  "/imprint",
  "/register",
  "/login",
  "/operator/login",
]);

/**
 * How long the home page waits for a remembered administrator session before it shows itself.
 * A slow answer then only updates the header button; it never moves a page the person can see.
 */
export const HOME_SESSION_WAIT_MS = 1500;

/** The public pages shown inside the site header, whose button names a signed-in organization. */
function siteHeaderPage(path: string) {
  return SITE_ROUTES.has(path) && path !== "/login" && path !== "/register";
}

export default function App() {
  const [path, setPath] = useState(() => normalizePath(location.pathname));
  const navigate = useMemo(() => createNavigator(setPath), []);
  const api = useMemo(() => new ApiClient(), []);
  const [session, setSession] = useState<Session | null>(null),
    [error, setError] = useState<unknown>(null),
    [loading, setLoading] = useState(false),
    [logoutPending, setLogoutPending] = useState(false),
    [logoutError, setLogoutError] = useState<unknown>(null),
    [sessionRevision, setSessionRevision] = useState(0);
  // Only a home page opened directly waits for the session: a page reached inside the site, after
  // the panel's Main website entry or in a browser without the hint never does. Taking the
  // marker here, before the first render, keeps it out of the address the page shows.
  const [homeWait, setHomeWait] = useState(() => {
    takeWebsiteMarker();
    return normalizePath(location.pathname) === "/" && hasAdminHint() && !staysOnWebsite();
  });
  const homeWaitRef = useRef(homeWait);
  const pathRef = useRef(path);
  pathRef.current = path;
  const logoutFlight = useRef(false);
  const suspendedReload = useRef(false);
  const reloadSession = () => {
    forgetSessionReads(api);
    setSessionRevision((value) => value + 1);
  };
  // A page opened before another administrator scheduled deletion meets 403 service_suspended.
  // Reading the session again shows the deletion notice. Once per address, so a server that
  // still reports an active organization cannot cause a reload loop.
  useEffect(() => {
    suspendedReload.current = false;
  }, [path]);
  useEffect(() => {
    api.setProblemListener((problem) => {
      if (problem.code !== "service_suspended" || suspendedReload.current) return;
      suspendedReload.current = true;
      reloadSession();
    });
    return () => api.setProblemListener(null);
  }, [api]);
  // A new page starts at the top, unless the address names a section on it.
  useEffect(() => {
    if (!location.hash) window.scrollTo?.(0, 0);
  }, [path]);
  useEffect(() => {
    const pop = () => setPath(normalizePath(location.pathname));
    addEventListener("popstate", pop);
    return () => removeEventListener("popstate", pop);
  }, []);
  useEffect(() => {
    // A public page opened in a browser where an administrator signed in asks for the session once,
    // for the header button and the home page's redirect. Without the hint nothing is requested.
    if (!hasAdminHint() || !siteHeaderPage(normalizePath(location.pathname))) return;
    let live = true;
    const showHome = () => {
      if (!live) return;
      homeWaitRef.current = false;
      setHomeWait(false);
    };
    const timer = setTimeout(showHome, HOME_SESSION_WAIT_MS);
    api
      .get<Session>("/v1/auth/session")
      .then((value) => {
        if (value.role !== "admin") {
          forgetAdminSession();
          return;
        }
        // An admin or sign-in page opened meanwhile reads its own session.
        if (!live || !siteHeaderPage(pathRef.current)) return;
        api.setCsrf(value.csrf_token);
        setFigureScope(api, [value.role, value.company_id, value.user_id].join(" "));
        setSession(value);
        if (homeWaitRef.current && pathRef.current === "/") navigate("/admin", true);
      })
      // An expired, refused or unreachable session shows the website as for any visitor.
      .catch(() => forgetAdminSession())
      .finally(() => {
        clearTimeout(timer);
        showHome();
      });
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [api, navigate]);
  useEffect(() => {
    // Only the admin dashboard and the developer panel have signed-in pages. Members connect from
    // the extension, so any other address is a public page or not found.
    const admin = path === "/admin" || path.startsWith("/admin/");
    const operator = path === "/operator" || path.startsWith("/operator/");
    if (!admin && !operator) return;
    // The page's code downloads while the session is checked. A failure shows on the page itself.
    void (operator ? loadOperator : loadAdmin)().catch(() => {});
    let live = true;
    setLoading(true);
    setError(null);
    api
      .get<Session>(operator ? "/v1/operator/auth/session" : "/v1/auth/session")
      .then((value) => {
        if (!live) return;
        // The hint lets the home page send this administrator to the panel next time.
        if (admin && value.role === "admin") rememberAdminSession();
        else if (admin) forgetAdminSession();
        // Every admin page needs the organization's time zone before it asks for figures, so its
        // settings are read as soon as the session is known, not after the page mounts. Not while
        // a deletion is scheduled: the server then refuses everything but the deletion notice.
        if (
          admin &&
          value.role === "admin" &&
          value.organization_status !== "deletion_scheduled" &&
          value.organization_status !== "deleting"
        )
          void companyConfig(api).catch(() => {});
        api.setCsrf(value.csrf_token);
        // Figures kept for one account are never shown to another signed in on this page.
        setFigureScope(api, [value.role, value.company_id, value.user_id].join(" "));
        setSession(value);
        if (operator && value.role !== "operator")
          navigate("/operator/login", true);
        else if (admin && value.role !== "admin") navigate("/login", true);
      })
      .catch((caught) => {
        if (!live) return;
        if (admin) forgetAdminSession();
        setError(caught);
        navigate(operator ? "/operator/login" : "/login", true);
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [path, api, navigate, sessionRevision]);
  async function logout(operator = false) {
    if (logoutFlight.current) return;
    logoutFlight.current = true;
    setLogoutPending(true);
    setLogoutError(null);
    try {
      const result = await api.delete<unknown>(
        operator ? "/v1/operator/auth/session" : "/v1/auth/session",
      );
      if (!confirmedLogout(result))
        throw new ApiError({
          code: "invalid_response",
          retryable: true,
          safe_message:
            "The service did not confirm sign out. Your session may still be open.",
          status: 200,
        });
      api.setCsrf("");
      forgetSessionReads(api);
      if (!operator) forgetAdminSession();
      setSession(null);
      navigate(operator ? "/operator/login" : "/login", true);
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.status === 401 &&
        caught.code === "authentication_required"
      ) {
        api.setCsrf("");
        forgetSessionReads(api);
        if (!operator) forgetAdminSession();
        setSession(null);
        navigate(operator ? "/operator/login" : "/login", true);
      } else {
        setLogoutError(caught);
      }
    } finally {
      logoutFlight.current = false;
      setLogoutPending(false);
    }
  }
  if (loading && !session && !publicRoutes.has(path))
    return <Loading label="Restoring your session" />;
  if (
    error &&
    !publicRoutes.has(path) &&
    path !== "/login" &&
    path !== "/operator/login"
  )
    return <ErrorState error={error} />;
  if (homeWait && path === "/") return <Loading label="Restoring your session" />;
  // The header button opens the panel for an administrator whose session this page knows.
  const adminPanel = session?.role === "admin" ? { company: session.company_name } : null;
  const site = sitePage(path, api, navigate);
  if (site)
    return (
      <SiteLayout navigate={navigate} path={path} adminPanel={adminPanel}>
        {site}
      </SiteLayout>
    );
  if (path === "/register")
    return (
      <RouteGroup key="auth" label="Loading">
        <RegisterPage api={api} />
      </RouteGroup>
    );
  if (path === "/login" || path === "/operator/login")
    return (
      <RouteGroup key="auth" label="Loading">
        <LoginPage api={api} navigate={navigate} operator={path === "/operator/login"} />
      </RouteGroup>
    );
  if (path.startsWith("/admin") && session?.role === "admin")
    return (
      <RouteGroup key="admin" label="Loading the dashboard">
        <AdminApp
          path={path}
          api={api}
          session={session}
          navigate={navigate}
          onLogout={() => logout()}
          logoutError={logoutError}
          logoutPending={logoutPending}
          onPrivilegeLost={() => {
            forgetSessionReads(api);
            forgetAdminSession();
            setSession(null);
            navigate("/login", true);
          }}
          reloadSession={reloadSession}
        />
      </RouteGroup>
    );
  if (path.startsWith("/operator") && session?.role === "operator")
    return (
      <RouteGroup key="operator" label="Loading the developer panel">
        <OperatorApp
          api={api}
          path={path}
          email={session.email}
          navigate={navigate}
          onLogout={() => logout(true)}
          logoutError={logoutError}
          logoutPending={logoutPending}
        />
      </RouteGroup>
    );
  return (
    <SiteLayout navigate={navigate} path={path} adminPanel={adminPanel}>
      <WebNotFoundPage navigate={navigate} />
    </SiteLayout>
  );
}

const METHODOLOGY: MethodologyLinks = {
  part1: "/methodology",
  part2: "/methodology/ecologits",
  reference: "/methodology/reference",
  repository: SOURCE_REPOSITORY_URL,
};

/** The public website pages, each shown inside the site header and footer. */
function sitePage(path: string, api: ApiClient, navigate: Navigate) {
  if (path === "/") return <WebHomePage navigate={navigate} />;
  const methodology = methodologyPage(path);
  if (methodology)
    return (
      <RouteGroup key="methodology" label="Loading the methodology">
        {methodology}
      </RouteGroup>
    );
  const page = publicPage(path, api, navigate);
  return (
    page && (
      <RouteGroup key="site" label="Loading the page">
        {page}
      </RouteGroup>
    )
  );
}

function methodologyPage(path: string) {
  switch (path) {
    case "/methodology":
      return <Methodology part={1} links={METHODOLOGY} />;
    case "/methodology/ecologits":
      return <Methodology part={2} links={METHODOLOGY} />;
    case "/methodology/reference":
      return <MethodologyPage />;
    default:
      return null;
  }
}

function publicPage(path: string, api: ApiClient, navigate: Navigate) {
  switch (path) {
    case "/downloads":
    case "/download":
      return <WebDownloadsPage navigate={navigate} />;
    case "/teams":
      return <WebTeamsPage navigate={navigate} />;
    case "/self-host":
      return <WebSelfHostPage navigate={navigate} />;
    case "/privacy":
      return <WebPrivacyPage navigate={navigate} />;
    case "/open-source":
      return <WebOpenSourcePage navigate={navigate} />;
    case "/contact":
      return <WebContactPage api={api} navigate={navigate} />;
    case "/terms":
      return <WebTermsPage navigate={navigate} />;
    case "/privacy-policy":
      return <WebPrivacyPolicyPage navigate={navigate} />;
    case "/dpa":
      return <WebDPAPage navigate={navigate} />;
    case "/imprint":
      return <WebImprintPage navigate={navigate} />;
    default:
      return null;
  }
}

function confirmedLogout(value: unknown): value is { logged_out: true } {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    (value as { logged_out?: unknown }).logged_out === true
  );
}
