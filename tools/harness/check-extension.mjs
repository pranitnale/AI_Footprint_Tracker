// Smoke check of the built extension: loads it in Chrome for Testing, opens every extension page in both
// colour schemes, saves screenshots and fails when any extension target logged an error.
//   node tools/harness/check-extension.mjs [--ext <dir>] [--out <dir>] [--headed]
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { launchExtension, ROOT } from "./extension.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const out = path.resolve(option("--out", path.join(ROOT, "tmp/harness/extension")));
mkdirSync(out, { recursive: true });

// Each page is opened at the size it is shown at. The popup's real frame is set by the browser from the page's
// own width, so it is opened in a 420 x 700 viewport and the screenshot is cropped to the document.
const PAGES = [
  { name: "popup.html", viewport: { width: 420, height: 700 }, fullPage: true },
  { name: "dashboard.html", viewport: { width: 1440, height: 900 }, fullPage: true },
  { name: "dashboard.html", label: "dashboard-narrow", viewport: { width: 390, height: 844 }, fullPage: true },
  // Every dashboard page, so a page that throws only when opened cannot pass.
  ...["models", "recap", "settings", "tracking", "licences", "connect"].map((route) => ({
    name: `dashboard.html#${route}`,
    label: `dashboard-${route}`,
    viewport: { width: 1440, height: 900 },
    fullPage: true,
  })),
  { name: "welcome.html", viewport: { width: 1280, height: 900 }, fullPage: true },
  { name: "welcome.html", label: "welcome-narrow", viewport: { width: 390, height: 844 }, fullPage: true },
  { name: "methodology.html", viewport: { width: 1440, height: 900 }, fullPage: true },
  { name: "methodology.html?part=2", label: "methodology-part2", viewport: { width: 1440, height: 900 }, fullPage: true },
  { name: "methodology.html", label: "methodology-narrow", viewport: { width: 390, height: 844 }, fullPage: true },
  { name: "methodology-reference.html", viewport: { width: 1280, height: 900 }, fullPage: false },
  { name: "licenses.html", viewport: { width: 1280, height: 900 }, fullPage: false },
];

const report = { pages: [], errors: [], warnings: [] };
for (const colorScheme of ["light", "dark"]) {
  const run = await launchExtension({ extensionPath: option("--ext"), headless: !args.includes("--headed"), colorScheme });
  try {
    // Give the service worker time to finish its first start (database open, method catalogue).
    await new Promise((r) => setTimeout(r, 3000));
    for (const spec of PAGES) {
      const page = await run.openExtensionPage(spec.name, spec.viewport);
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(1500);
      const label = `${spec.label ?? spec.name.replace(".html", "")}-${colorScheme}`;
      const file = path.join(out, `${label}.png`);
      await page.screenshot({ path: file, fullPage: spec.fullPage });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      report.pages.push({ label, file, horizontalOverflow: overflow });
      await page.close();
    }
  } finally {
    report.errors.push(...run.watch.extensionErrors().map((e) => ({ ...e, colorScheme })));
    report.warnings.push(...run.watch.extensionWarnings().map((e) => ({ ...e, colorScheme })));
    await run.close();
  }
}
writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const overflowing = report.pages.filter((p) => p.horizontalOverflow);
console.log(`pages ${report.pages.length}, extension errors ${report.errors.length}, warnings ${report.warnings.length}, horizontal overflow ${overflowing.length}`);
for (const e of report.errors) console.log(`ERROR [${e.colorScheme} ${e.targetType}] ${e.kind}: ${e.text.split("\n")[0]}`);
for (const p of overflowing) console.log(`OVERFLOW ${p.label}`);
process.exitCode = report.errors.length || overflowing.length ? 1 : 0;
