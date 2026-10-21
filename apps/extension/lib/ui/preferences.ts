import { browser } from "wxt/browser";

/**
 * View choices that should survive closing the popup or dashboard (period, scope, chart switch).
 * They are conveniences: a missing or unreadable value falls back to the default view.
 */
export async function readPreference(name: string): Promise<Record<string, unknown> | null> {
  try {
    const key = `ui:${name}`;
    const stored = await browser.storage.local.get(key);
    const value = stored[key];
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function writePreference(name: string, value: Record<string, unknown>) {
  try {
    await browser.storage.local.set({ [`ui:${name}`]: value });
  } catch {
    /* the default view is used next time */
  }
}
