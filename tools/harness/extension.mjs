// Starts Chrome for Testing with the built extension in a fresh, short-path profile and watches every target
// for errors. Branded Chrome ignores --load-extension since Chrome 137, so this uses Playwright's Chromium.
// Windows profile paths over about 125 characters break the extension's IndexedDB (see
// docs/release/FRESH-PROFILE-STORAGE-HEALTH-2026-09-27.md), so profiles live under a short temp root.
import { chromium } from "playwright";
import { mkdtempSync, readFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CdpWatch } from "./cdp-watch.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DEFAULT_EXTENSION = path.join(ROOT, "apps/extension/.output/chrome-mv3");

function shortProfileDir() {
  const base = process.platform === "win32" ? path.join(process.env.LOCALAPPDATA ?? tmpdir(), "Temp", "aift-h") : path.join(tmpdir(), "aift-h");
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(path.join(base, "p-"));
  if (dir.length > 110) throw new Error(`Profile path too long for the extension database: ${dir.length} characters`);
  return dir;
}

async function devtoolsUrl(profile) {
  const file = path.join(profile, "DevToolsActivePort");
  for (let i = 0; i < 100; i++) {
    if (existsSync(file)) {
      const [port, wsPath] = readFileSync(file, "utf8").split(/\r?\n/);
      if (port && wsPath) return `ws://127.0.0.1:${port}${wsPath}`;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Chrome did not report a DevTools port");
}

/**
 * Launches the browser. Options: extensionPath, headless (new headless mode supports extensions),
 * colorScheme, viewport, keepProfile.
 */
export async function launchExtension(options = {}) {
  const extensionPath = path.resolve(options.extensionPath ?? DEFAULT_EXTENSION);
  if (!existsSync(path.join(extensionPath, "manifest.json"))) throw new Error(`No built extension at ${extensionPath}`);
  const profile = options.profile ?? shortProfileDir();
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: options.headless ?? true,
    colorScheme: options.colorScheme ?? "light",
    viewport: options.viewport ?? { width: 1440, height: 900 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--remote-debugging-port=0",
      "--no-first-run",
    ],
  });
  const watch = new CdpWatch(await devtoolsUrl(profile));
  await watch.start();
  let [worker] = context.serviceWorkers().filter((w) => w.url().startsWith("chrome-extension://"));
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 30000 });
  const extensionId = new URL(worker.url()).host;
  const origin = `chrome-extension://${extensionId}`;
  watch.setExtensionOrigin(origin);
  // Pages Playwright opens report their own errors too; route them into the same record.
  const trackPage = (page) => {
    page.on("pageerror", (error) => {
      if (page.url().startsWith(origin)) watch.record("exception", { type: "page", url: page.url() }, error.message, page.url());
    });
    page.on("requestfailed", (request) => {
      if (request.url().startsWith(origin) || page.url().startsWith(origin))
        watch.record("request-failed", { type: "page", url: page.url() }, `${request.failure()?.errorText ?? "failed"} ${request.url()}`, request.url());
    });
  };
  context.pages().forEach(trackPage);
  context.on("page", trackPage);
  return {
    context,
    worker,
    extensionId,
    origin,
    watch,
    profile,
    async openExtensionPage(name, viewport) {
      const page = await context.newPage();
      if (viewport) await page.setViewportSize(viewport);
      await page.goto(`${origin}/${name}`, { waitUntil: "load" });
      return page;
    },
    async close() {
      watch.close();
      await context.close().catch(() => {});
      if (!options.keepProfile && !options.profile) rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
    },
  };
}
