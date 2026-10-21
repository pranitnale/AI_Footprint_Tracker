import { defineConfig } from "wxt";
import { fileURLToPath } from "node:url";
import { writeBrowserNotices } from "./build/notices";
import { keepTestSources, reviewSourcePackage } from "./build/source-package";
import { assertMainThreadTokenizerBoundary } from "./build/tokenizer-boundary";
import {
  resolveBuildVariant,
  variantOutputTemplate,
  writeBuildVariantMetadata,
} from "./build/variant";

const variant = resolveBuildVariant();
const outputTemplate = variantOutputTemplate(variant);

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  ...(outputTemplate ? { outDirTemplate: outputTemplate } : {}),
  vite: () => ({
    worker: { format: "es" },
    plugins: [
      {
        name: "aift-main-thread-tokenizer-boundary",
        generateBundle(_options, output) {
          assertMainThreadTokenizerBoundary(output);
        },
      },
    ],
    define: {
      __AIFT_DEFAULT_ENGINE__: JSON.stringify(variant.defaultEngine),
    },
  }),
  hooks: {
    // The review source ZIP keeps test files, which the embedded EcoLogits source holds too.
    "config:resolved": (wxt) => {
      wxt.config.zip.excludeSources = keepTestSources(
        wxt.config.zip.excludeSources,
      );
    },
    "build:done": (wxt) => {
      writeBrowserNotices(
        fileURLToPath(new URL("../..", import.meta.url)),
        wxt.config.outDir,
      );
      writeBuildVariantMetadata(
        wxt.config.outDir,
        wxt.config.browser,
        wxt.config.manifestVersion,
        variant,
      );
    },
  },
  zip: {
    name: "ai-footprint-tracker",
    sourcesRoot: fileURLToPath(new URL("../..", import.meta.url)),
    // The Firefox review source: the release source archive's inputs (build/source-package.ts).
    ...reviewSourcePackage(),
  },
  manifest: ({ browser }) => ({
    name: "AI Footprint Tracker",
    description:
      "Local, scoped estimates of AI conversation tokens, electricity, carbon and water.",
    version: "0.1.0",
    // The public website; extension stores and the browser's extension page link to it.
    homepage_url: "https://aifootprinttracker.com",
    permissions:
      browser === "firefox"
        ? ["storage", "alarms"]
        : ["storage", "alarms", "offscreen"],
    host_permissions: [
      "https://chatgpt.com/*",
      "https://chat.openai.com/*",
      "https://claude.ai/*",
      "https://gemini.google.com/*",
      "https://www.perplexity.ai/*",
      "https://perplexity.ai/*",
      "https://notebook.google.com/*",
    ],
    web_accessible_resources:
      browser === "firefox"
        ? ["file-relay.html", "methodology-reference.html"]
        : [
            {
              resources: ["file-relay.html", "methodology-reference.html"],
              matches: [
                "https://chatgpt.com/*",
                "https://chat.openai.com/*",
                "https://claude.ai/*",
                "https://gemini.google.com/*",
                "https://www.perplexity.ai/*",
                "https://perplexity.ai/*",
                "https://notebook.google.com/*",
              ],
            },
          ],
    ...(browser === "firefox"
      ? { optional_permissions: ["https://*/*"] }
      : { optional_host_permissions: ["https://*/*"] }),
    ...(browser === "firefox"
      ? {
          browser_specific_settings: {
            gecko: {
              // Permanent once uploaded to AMO: a new ID is a new add-on,
              // so installed copies would stop receiving updates.
              id: "ai-footprint-tracker@extension",
              strict_min_version: "140.0",
              // The optional list must equal COMPANY_DATA_CATEGORIES in lib/platform.ts.
              data_collection_permissions: {
                required: ["none"],
                optional: [
                  "websiteActivity",
                  "authenticationInfo",
                  "personallyIdentifyingInfo",
                  "technicalAndInteraction",
                  "browsingActivity",
                ],
              },
            },
          },
        }
      : { minimum_chrome_version: "137" }),
    content_security_policy:
      browser === "firefox"
        ? "script-src 'self'; object-src 'self'"
        : { extension_pages: "script-src 'self'; object-src 'self'" },
    icons: {
      16: "icon/16.png",
      32: "icon/32.png",
      48: "icon/48.png",
      128: "icon/128.png",
    },
  }),
});
