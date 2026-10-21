// Installs a jsdom document as the global DOM. Import this before @testing-library/react or react-dom:
// react-dom decides at load time whether the browser supports input events, and without a window it
// falls back to an old Internet Explorer path that never reports typed text to React.
import { JSDOM } from "jsdom";

export const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "chrome-extension://aift/" });

Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  location: dom.window.location,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  MutationObserver: dom.window.MutationObserver,
  getComputedStyle: dom.window.getComputedStyle,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
