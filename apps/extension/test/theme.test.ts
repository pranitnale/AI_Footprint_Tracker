import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, before, test } from "node:test";
import { dom } from "./dom-env";

// jsdom gives an opaque chrome-extension origin no localStorage; an https origin stands in for it.
dom.reconfigure({ url: "https://aift.test/popup.html" });
const storage: Record<string, unknown> = {};
const listeners: ((changes: Record<string, { newValue?: unknown }>, area: string) => void)[] = [];
let theme: typeof import("../lib/ui/theme");
const root = () => dom.window.document.documentElement;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

before(async () => {
  Object.assign(globalThis, {
    localStorage: dom.window.localStorage,
    chrome: {
      storage: {
        local: {
          get: async (key: string) => (key in storage ? { [key]: storage[key] } : {}),
          set: async (items: Record<string, unknown>) => void Object.assign(storage, items),
        },
        onChanged: { addListener: (listener: (typeof listeners)[number]) => void listeners.push(listener) },
      },
    },
  });
  theme = await import("../lib/ui/theme");
});
afterEach(() => {
  for (const key of Object.keys(storage)) delete storage[key];
  listeners.length = 0;
  dom.window.localStorage.clear();
  delete root().dataset.theme;
});

test("theme: the page paints with the local copy at once, then follows browser storage", async () => {
  dom.window.localStorage.setItem("aift-theme", "dark");
  storage["ui:theme"] = { choice: "light" };
  const seen: string[] = [];
  theme.startTheme((choice) => seen.push(choice));
  assert.equal(root().dataset.theme, "dark", "before storage answers");
  await settle();
  assert.equal(root().dataset.theme, "light");
  assert.equal(dom.window.localStorage.getItem("aift-theme"), "light");
  assert.deepEqual(seen, ["light"]);
});

test("theme: system removes the attribute so the stylesheet follows the device", async () => {
  root().dataset.theme = "dark";
  storage["ui:theme"] = { choice: "system" };
  theme.startTheme();
  await settle();
  assert.equal(root().hasAttribute("data-theme"), false);
  assert.equal(theme.currentTheme(), "system");
});

test("theme: a missing or invalid choice means system", async () => {
  dom.window.localStorage.setItem("aift-theme", "sepia");
  storage["ui:theme"] = { choice: "sepia" };
  theme.startTheme();
  assert.equal(root().hasAttribute("data-theme"), false);
  await settle();
  assert.equal(root().hasAttribute("data-theme"), false);
  assert.equal(theme.currentTheme(), "system");
});

test("theme: saving applies at once and other open pages follow the change", async () => {
  await theme.saveTheme("dark");
  assert.equal(root().dataset.theme, "dark");
  assert.deepEqual(storage["ui:theme"], { choice: "dark" });
  assert.equal(theme.currentTheme(), "dark");
  theme.startTheme();
  await settle();
  listeners[0]!({ "ui:theme": { newValue: { choice: "light" } } }, "local");
  assert.equal(root().dataset.theme, "light");
  listeners[0]!({ "ui:theme": { newValue: { choice: "dark" } } }, "sync");
  assert.equal(root().dataset.theme, "light", "only local storage holds the choice");
});

/** The rules of the device-dark block, written for a dark theme chosen in Settings. */
function darkRules(css: string) {
  const text = css.replace(/\r\n/g, "\n");
  const start = text.indexOf("@media (prefers-color-scheme: dark) {");
  assert.ok(start >= 0);
  let depth = 0,
    end = -1;
  for (let i = text.indexOf("{", start); i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) {
      end = i;
      break;
    }
  }
  const inner = text.slice(text.indexOf("{", start) + 1, end);
  const normal = (value: string) => value.replace(/\s+/g, " ").trim();
  const media = normal(inner.split(':root:not([data-theme="light"])').join(':root[data-theme="dark"]'));
  const forced = normal(text.slice(end + 1));
  return { media, forced };
}

test("theme: the dark theme chosen in Settings uses exactly the device-dark rules", () => {
  for (const file of ["../../../packages/ui/src/living-gauge.css", "../lib/dash/dash.css"]) {
    const { media, forced } = darkRules(readFileSync(new URL(file, import.meta.url), "utf8"));
    assert.ok(forced.includes(media), `${file}: forced dark rules match the media block`);
  }
  const gauge = readFileSync(new URL("../../../packages/ui/src/living-gauge.css", import.meta.url), "utf8");
  assert.match(gauge, /:root\[data-theme="dark"\] \{\s*color-scheme: dark;\s*\}/);
  assert.match(gauge, /:root\[data-theme="light"\] \{\s*color-scheme: light;\s*\}/);
});

/** WCAG relative luminance and contrast ratio of two #rrggbb colours. */
function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

test("theme: in dark mode every tool colour stands out from the cards and from the other tools", () => {
  // Claude's deep green almost disappeared on the dark cards (seen live 19 Oct 2026).
  const { media } = darkRules(readFileSync(new URL("../../../packages/ui/src/living-gauge.css", import.meta.url), "utf8"));
  const token = (name: string) => media.match(new RegExp(`--lg-${name}: (#[0-9a-f]{6});`))?.[1];
  const tools = ["claude", "chatgpt", "perplexity", "notebooklm", "gemini"].map((site) => [site, token(`tool-${site}`)] as const);
  for (const [site, colour] of tools) {
    assert.ok(colour, `${site} has a dark colour`);
    // Cards, the page, the hero panel and the empty track a donut gap shows.
    for (const ground of ["surface", "paper", "hero", "track"]) {
      assert.ok(contrast(colour, token(ground)!) >= 3, `${site} ${colour} on ${ground} is at least 3:1`);
    }
  }
  for (const [i, [one, a]] of tools.entries()) {
    for (const [two, b] of tools.slice(i + 1)) assert.ok(contrast(a!, b!) >= 1.25, `${one} and ${two} differ in lightness`);
  }
});

test("theme: the Appearance control keeps its buttons side by side inside a settings row", () => {
  // A settings row stacks its direct div children; the segmented control is one of them.
  const css = readFileSync(new URL("../lib/dash/dash.css", import.meta.url), "utf8");
  assert.match(css, /\.st-row > \.lg-seg \{\s*display: inline-flex;\s*flex-direction: row;/);
});
