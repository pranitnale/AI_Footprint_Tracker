// Screenshots of the redesigned extension surfaces rendered with fixture data (apps/extension/test/preview).
//   node tools/harness/preview-shots.mjs [--build] [--only popup] [--out dir]
// Every page also fails the run on uncaught errors or console errors, so a broken state cannot pass silently.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { ROOT } from "./extension.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const ext = path.join(ROOT, "apps/extension");
const dist = path.join(ext, ".test-runtime/preview");
if (args.includes("--build"))
  execFileSync(process.execPath, [path.join(ROOT, "apps/web/node_modules/vite/bin/vite.js"), "build", "--config", "test/preview/vite.config.mjs"], { cwd: ext, stdio: "inherit" });

const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
};
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const file = path.join(dist, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname));
  if (!file.startsWith(dist)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

const POPUP_STATES = ["personal", "first", "paused", "problem", "problem-hook", "connect", "pending", "org", "org-offline", "org-error"];
const only = option("--only", null);
// Every dashboard page and state on the canvas: [name, query].
const DASH = [
  ["overview", "state=personal&route=overview"],
  ["overview-requests", "state=personal&route=overview&metric=requests"],
  ["overview-today", "state=personal&route=overview&period=today"],
  ["overview-all", "state=personal&route=overview&period=all"],
  ["empty", "state=first&route=overview"],
  ["models", "state=personal&route=models"],
  ["recap", "state=personal&route=recap"],
  ["settings", "state=personal&route=settings"],
  ["settings-paused", "state=paused&route=settings"],
  ["settings-company", "state=org&route=settings"],
  ["tracking", "state=problem&route=tracking"],
  ["licences", "state=personal&route=licences"],
  ["connect", "state=personal&route=overview&scope=org"],
  ["connect-pending", "state=pending&route=overview&scope=org"],
  ["org-overview", "state=org&route=overview&scope=org"],
  ["org-offline", "state=org-offline&route=overview&scope=org"],
  ["org-error", "state=org-error&route=overview&scope=org"],
  ["org-models", "state=org&route=models&scope=org"],
  ["org-recap", "state=org&route=recap&scope=org"],
];
const pages = [
  ...POPUP_STATES.map((state) => ({ name: `popup-${state}`, query: `surface=popup&state=${state}${state.startsWith("problem") ? "&tab=claude.ai" : ""}`, viewport: { width: 400, height: 600 } })),
  ...["today", "7d"].map((period) => ({ name: `popup-personal-${period}`, query: `surface=popup&state=personal&period=${period}`, viewport: { width: 400, height: 600 } })),
  ...[
    ["details", ""],
    ["details-open", "&open=compared,counted,estimated"],
    ["details-problem", "&state=problem&open=counted"],
    ["details-notcounted", "&state=notcounted&open=not-counted"],
    ["details-sync", "&state=sync"],
    ["details-perplexity", "&site=perplexity&open=counted"],
  ].map(([name, query]) => ({ name, query: `surface=details${query}`, viewport: { width: 520, height: 900 } })),
  ...[["details-narrow", "&open=counted"]].map(([name, query]) => ({ name, query: `surface=details${query}`, viewport: { width: 360, height: 900 } })),
  // The welcome page before agreeing and each step of its tour (21 October 2026).
  ...[
    ["welcome-consent", "state=consent"],
    ...[0, 1, 2, 3, 4, 5].map((step) => [`welcome-tour-${step + 1}`, `state=agreed&step=${step}`]),
    ["welcome-tour-paused", "state=agreed-paused"],
  ].flatMap(([name, query]) =>
    [1280, 390].map((width) => ({ name: `${name}${width === 390 ? "-narrow" : ""}`, query: `surface=welcome&${query}`, viewport: { width, height: 900 } })),
  ),
  ...DASH.flatMap(([name, query]) =>
    [1440, 390].map((width) => ({ name: `dash-${name}${width === 390 ? "-narrow" : ""}`, query: `surface=dashboard&${query}`, viewport: { width, height: 900 } })),
  ),
].filter((p) => !only || p.name.startsWith(only));

const out = path.resolve(option("--out", path.join(ROOT, "tmp/harness/preview")));
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chromium" });
const problems = [];
for (const colorScheme of ["light", "dark"]) {
  const context = await browser.newContext({ colorScheme, deviceScaleFactor: 1 });
  for (const spec of pages) {
    const page = await context.newPage();
    await page.setViewportSize(spec.viewport);
    page.on("pageerror", (e) => problems.push(`${spec.name} ${colorScheme}: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") problems.push(`${spec.name} ${colorScheme}: console ${m.text()}`);
    });
    await page.goto(base + "?" + spec.query, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflow) problems.push(`${spec.name} ${colorScheme}: horizontal overflow`);
    await page.screenshot({ path: path.join(out, `${spec.name}-${colorScheme}.png`), fullPage: true });
    await page.close();
  }
  await context.close();
}
await browser.close();
server.close();
await writeFile(path.join(out, "problems.json"), JSON.stringify(problems, null, 2));
console.log(`screens ${pages.length * 2}, problems ${problems.length}`);
for (const p of problems) console.log("PROBLEM", p);
process.exitCode = problems.length ? 1 : 0;
