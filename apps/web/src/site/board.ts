/**
 * Marks a value a canvas board left as sample data. Pages must not ship with one: a test fails
 * while any page still calls it, so a forgotten placeholder cannot reach the public site.
 */
export function todo(hole: string): string {
  return `[${hole}]`;
}

/** Public pages that the site layout routes inside the app instead of reloading. */
export const SITE_ROUTES = new Set([
  "/",
  "/downloads",
  "/download",
  "/teams",
  "/self-host",
  "/methodology",
  "/methodology/ecologits",
  "/methodology/reference",
  "/privacy",
  "/open-source",
  "/contact",
  "/terms",
  "/privacy-policy",
  "/dpa",
  "/imprint",
  "/login",
  "/register",
]);
