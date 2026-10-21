export type Navigate = (path: string, replace?: boolean) => void;

export function normalizePath(path: string): string {
  const value = path.replace(/\/{2,}/g, "/");
  return value.length > 1 ? value.replace(/\/$/, "") : value;
}

/** Only administrators use the website; members connect from the browser extension. */
export function adminDestination(role: string | undefined): "/admin" | "/login" {
  return role === "admin" ? "/admin" : "/login";
}

export function createNavigator(onChange: (path: string) => void): Navigate {
  return (path, replace = false) => {
    const url = new URL(path, window.location.origin);
    replace
      ? window.history.replaceState({}, "", url)
      : window.history.pushState({}, "", url);
    onChange(normalizePath(url.pathname));
  };
}
