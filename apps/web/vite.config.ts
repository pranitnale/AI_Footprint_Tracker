import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { checkBuiltDownloads } from "./scripts/check-built-downloads.mjs";
import { validateDownloadManifest } from "./scripts/prepare-downloads.mjs";
import { websiteNoticesPlugin } from "./scripts/website-notices.mjs";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  publicDir: false,
  plugins: [
    websiteNoticesPlugin(),
    {
      name: "verified-browser-downloads",
      apply: "build",
      async closeBundle() {
        await validateDownloadManifest();
        const source = resolve(root, "public/downloads");
        const target = resolve(root, "dist/downloads");
        await mkdir(target, { recursive: true });
        for (const name of [
          "ai-footprint-tracker-chrome.zip",
          "ai-footprint-tracker-edge.zip",
          "ai-footprint-tracker-firefox.zip",
          "manifest.json",
        ])
          await copyFile(resolve(source, name), resolve(target, name));
        // Apply the same check as the web image build, so a site that builds here also passes there.
        await checkBuiltDownloads(resolve(root, "dist"));
      },
    },
  ],
  // The admin site shares the extension's figure modules (src/admin/figures.ts). Their package
  // imports resolve from this app, so the website build needs no extension dependencies.
  resolve: { dedupe: ["@footprint/contracts", "@footprint/ui", "react", "react-dom"] },
  build: { outDir: "dist", sourcemap: true, target: "es2022" },
  server: { port: 4173 },
});
