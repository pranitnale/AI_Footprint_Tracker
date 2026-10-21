import { defineContentScript } from "wxt/utils/define-content-script";
import { installCapture } from "../lib/capture-runtime";
export default defineContentScript({
  matches: [
    "https://chatgpt.com/*",
    "https://chat.openai.com/*",
    "https://claude.ai/*",
    "https://gemini.google.com/*",
    "https://www.perplexity.ai/*",
    "https://perplexity.ai/*",
    "https://notebook.google.com/*",
  ],
  runAt: "document_start",
  world: "MAIN",
  main: installCapture,
});
