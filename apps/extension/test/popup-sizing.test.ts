// Sizing contract of the toolbar popup. Chrome caps a popup at 800 x 600 px and sizes it to its content,
// so the shell must keep a fixed width, stop at 600 px and scroll only the main area between header and footer.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

const popupHtml = await readFile("entrypoints/popup/index.html", "utf8");
const dashboardHtml = await readFile("entrypoints/dashboard/index.html", "utf8");
const popupCss = await readFile("lib/popup/popup.css", "utf8");
const dashCss = await readFile("lib/dash/dash.css", "utf8");

function surface(html: string, css: string) {
  const dom = new JSDOM(html);
  const style = dom.window.document.createElement("style");
  style.textContent = css;
  dom.window.document.head.append(style);
  const shell = dom.window.document.createElement("div");
  shell.className = "pp";
  shell.innerHTML = `
    <header class="pp-head"><span class="pp-title">AI Footprint Tracker</span></header>
    <main class="pp-main"><p>${"Recorded usage. ".repeat(400)}</p></main>
    <footer class="pp-foot"><span>Figures from 2 min ago</span></footer>
  `;
  dom.window.document.getElementById("root")!.append(shell);
  return { dom, shell };
}

test("the popup keeps a fixed width and stops at Chrome's 600 px popup height", (context) => {
  const { dom, shell } = surface(popupHtml, popupCss);
  context.after(() => dom.window.close());
  const view = dom.window;
  assert.equal(view.document.documentElement.className, "popup-surface");
  for (const element of [view.document.documentElement, view.document.body]) assert.equal(view.getComputedStyle(element).width, "400px");
  const computed = view.getComputedStyle(shell);
  assert.equal(computed.width, "400px");
  assert.equal(computed.maxHeight, "600px");
  assert.equal(computed.display, "flex");
  assert.equal(computed.flexDirection, "column");
});

test("only the main area scrolls, so the header and footer stay visible with long content", (context) => {
  const { dom, shell } = surface(popupHtml, popupCss);
  context.after(() => dom.window.close());
  const view = dom.window;
  const main = view.getComputedStyle(shell.querySelector(".pp-main")!);
  assert.equal(main.minHeight, "0px");
  assert.equal(main.overflowY, "auto");
  assert.equal(main.overscrollBehavior, "contain");
  assert.equal(main.scrollbarGutter, "stable");
  assert.match(popupCss, /\.pp-main\s*\{[^}]*flex:\s*1;/s);
  assert.match(popupCss, /\.pp-foot\s*\{[^}]*flex:\s*none;/s);
  // The footer is a sibling of the scroll area, never inside it.
  assert.equal(shell.querySelector(".pp-main .pp-foot"), null);
});

test("the dashboard page is not sized like the popup", (context) => {
  const { dom } = surface(dashboardHtml, dashCss);
  context.after(() => dom.window.close());
  const view = dom.window;
  assert.equal(view.document.documentElement.classList.contains("popup-surface"), false);
  assert.notEqual(view.getComputedStyle(view.document.body).width, "400px");
  assert.doesNotMatch(dashCss, /max-height:\s*600px/);
});

// Seen on 16 October 2026: a 13 px taller footer made a 30-day view with four tools and a
// comparison line scroll inside the 600 px popup. Footer and credit strip stay at 76 px.
test("the footer and the credit strip together stay at the 76 px the figures leave them", () => {
  const px = (rule: string, property: string) => {
    const block = new RegExp(`(?:^|\\n)${rule.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`).exec(popupCss)?.[1] ?? "";
    return new RegExp(`${property}:\\s*([^;]+);`).exec(block)?.[1]?.trim() ?? "";
  };
  const sum = (value: string, sides: [number, number]) => {
    const parts = value.split(/\s+/).map((part) => Number.parseFloat(part));
    const [top, , bottom = top] = parts.length === 1 ? [parts[0], 0, parts[0]] : parts;
    return sides[0] * top! + sides[1] * bottom!;
  };
  const button = Number.parseFloat(px(".pp-foot .lg-btn", "min-height"));
  const credit = Number.parseFloat(px(".pp-meta .lg-credit", "line-height"));
  // One border line above each part.
  const total = 1 + sum(px(".pp-foot", "padding"), [1, 1]) + button + 1 + sum(px(".pp-meta", "padding"), [1, 1]) + credit;
  assert.equal(total, 76);
});
