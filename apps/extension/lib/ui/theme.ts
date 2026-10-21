import { browser } from "wxt/browser";
import { readPreference, writePreference } from "./preferences";

/**
 * Light, dark or the device's setting for the popup and dashboard (owner, 12 October 2026). The
 * bar and Details on AI sites keep following each site, and the methodology page keeps its own
 * light palette.
 */
export type ThemeChoice = "system" | "light" | "dark";
export const THEME_CHOICES: readonly ThemeChoice[] = ["system", "light", "dark"];

// Extension pages share one origin, so this copy lets a page paint in the saved theme at once
// instead of flashing the device theme while browser storage answers.
const MIRROR = "aift-theme";

const valid = (value: unknown): value is ThemeChoice =>
  THEME_CHOICES.includes(value as ThemeChoice);

/** "system" removes the attribute, so the stylesheet follows prefers-color-scheme. */
export function applyTheme(choice: ThemeChoice, root: HTMLElement = document.documentElement) {
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
}

function mirror(choice: ThemeChoice) {
  try {
    localStorage.setItem(MIRROR, choice);
  } catch {
    /* the stored preference still applies once read */
  }
}

/** The choice this page painted with: the local copy, or the device setting without one. */
export function currentTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(MIRROR);
    return valid(value) ? value : "system";
  } catch {
    return "system";
  }
}

/**
 * Applies the saved theme before the first render, then confirms it from browser storage and
 * follows changes made on another open extension page.
 */
export function startTheme(onChange?: (choice: ThemeChoice) => void) {
  applyTheme(currentTheme());
  void readPreference("theme").then((saved) => {
    const choice = valid(saved?.choice) ? saved.choice : "system";
    applyTheme(choice);
    mirror(choice);
    onChange?.(choice);
  });
  try {
    browser.storage.onChanged.addListener((changes, area) => {
      const next = (changes["ui:theme"]?.newValue as { choice?: unknown } | undefined)?.choice;
      if (area !== "local" || !valid(next)) return;
      applyTheme(next);
      mirror(next);
      onChange?.(next);
    });
  } catch {
    /* pages opened outside the extension keep the theme they started with */
  }
}

export async function saveTheme(choice: ThemeChoice) {
  applyTheme(choice);
  mirror(choice);
  await writePreference("theme", { choice });
}
