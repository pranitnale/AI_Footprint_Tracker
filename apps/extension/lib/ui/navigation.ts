import { browser } from "wxt/browser";
import { WELCOME_FOCUS_TARGET, WELCOME_PAGE } from "../tracking-consent";

const PROVIDER_HOSTS: Record<string, string> = {
  "chatgpt.com": "chatgpt",
  "chat.openai.com": "chatgpt",
  "claude.ai": "claude",
  "gemini.google.com": "gemini",
  "www.perplexity.ai": "perplexity",
  "perplexity.ai": "perplexity",
  "notebook.google.com": "notebooklm",
  "notebooklm.google.com": "notebooklm",
};

/**
 * Opens an extension page (a path such as "dashboard.html#settings") or, with `external`, an
 * organization page, in a new tab. Popups close when focus moves, so this never waits on the tab.
 */
export async function openExtensionPage(target: string, external = false) {
  const url = external ? target : browser.runtime.getURL(`/${target.replace(/^\//, "")}` as "/dashboard.html");
  if (external && !/^https:\/\//.test(url)) return;
  await browser.tabs.create({ url });
}

/**
 * Brings an open welcome page to the front, or opens one. Each Set up used to open another
 * welcome tab (live QA, 19 Oct 2026). Without an answer from an open welcome page, for example
 * when none is open, a new tab opens.
 */
export async function openWelcomePage() {
  try {
    const answer = (await browser.runtime.sendMessage({ target: WELCOME_FOCUS_TARGET })) as { focused?: unknown } | undefined;
    if (answer?.focused === true) return;
  } catch {
    // No open extension page answered.
  }
  await openExtensionPage(WELCOME_PAGE);
}

/** The active tab of the current window when it is a supported AI site. Host permissions cover only those sites. */
export async function activeProviderTab(): Promise<{ id: number; site: string } | null> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) return null;
    const site = PROVIDER_HOSTS[new URL(tab.url).hostname];
    return site ? { id: tab.id, site } : null;
  } catch {
    return null;
  }
}

/**
 * What the open AI tab itself says about capture right now. Saved problem records only say
 * what happened earlier and close only after later work succeeds, so the popup asks the tab
 * (owner, 12 October 2026).
 * "silent": the tab has no tracker that answers, for example after the extension was reloaded
 * while the tab stayed open. "unknown": the tab cannot be asked yet (loading, discarded, no
 * site access) or did not answer in time; nothing is shown then.
 */
export type TabCapture =
  | { state: "working" }
  | { state: "problem"; code: "capture_hook_missing" | "protocol_unsupported"; count: number }
  | { state: "silent" }
  | { state: "unknown" };

export const TAB_CAPTURE_TIMEOUT_MS = 2000;
// A tab between two documents (navigation, back-forward cache, prerender) briefly has no
// receiver either, so a silent tab is asked once more after this pause (Codex review, 12 Oct).
export const TAB_CAPTURE_RETRY_MS = 400;

// Only a missing receiver means no tracker; other send errors say nothing about capture.
const missingReceiver = (error: unknown) =>
  /Receiving end does not exist|Could not establish connection/i.test(
    error instanceof Error ? error.message : String(error),
  );

function pageHealthAnswer(value: unknown): TabCapture {
  if (!value || typeof value !== "object") return { state: "unknown" };
  const answer = value as { target?: unknown; problems?: unknown };
  if (answer.target !== "page-health" || !Array.isArray(answer.problems)) return { state: "unknown" };
  for (const problem of answer.problems as { code?: unknown; count?: unknown }[])
    if (
      (problem?.code === "capture_hook_missing" || problem?.code === "protocol_unsupported") &&
      typeof problem.count === "number" &&
      Number.isSafeInteger(problem.count) &&
      problem.count > 0
    )
      return { state: "problem", code: problem.code, count: problem.count };
  return { state: "working" };
}

async function askTab(id: number): Promise<TabCapture> {
  const tab = await browser.tabs.get(id);
  if (!tab.url || tab.status !== "complete" || tab.discarded) return { state: "unknown" };
  const origin = new URL(tab.url).origin;
  // Without site access the tracker is never injected, so silence would not mean a problem.
  if (!(await browser.permissions.contains({ origins: [`${origin}/*`] }))) return { state: "unknown" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<TabCapture>((resolve) => {
    timer = setTimeout(() => resolve({ state: "unknown" }), TAB_CAPTURE_TIMEOUT_MS);
  });
  const asked = browser.tabs.sendMessage(id, { target: "page-health" }, { frameId: 0 }).then(
    pageHealthAnswer,
    (error): TabCapture => (missingReceiver(error) ? { state: "silent" } : { state: "unknown" }),
  );
  try {
    return await Promise.race([asked, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function providerTabCapture(id: number): Promise<TabCapture> {
  try {
    const first = await askTab(id);
    if (first.state !== "silent") return first;
    await new Promise((resolve) => setTimeout(resolve, TAB_CAPTURE_RETRY_MS));
    return await askTab(id);
  } catch {
    return { state: "unknown" };
  }
}

/** Closes the extension page's own tab, as Not now on the welcome page does. */
export function closeCurrentTab() {
  void browser.tabs
    .getCurrent()
    .then((tab) => (tab?.id != null ? browser.tabs.remove(tab.id) : window.close()))
    .catch(() => window.close());
}

export async function reloadActiveProviderTab(id: number) {
  await browser.tabs.reload(id);
}
