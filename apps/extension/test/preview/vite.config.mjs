import { fileURLToPath } from "node:url";

// Plain config object: "vite" itself is not a dependency of the extension package.
const here = (path) => fileURLToPath(new URL(path, import.meta.url));
export default {
  root: here("."),
  // The extension's static files, so the welcome tour's screenshots load as they do in the build.
  publicDir: here("../../public"),
  resolve: { alias: { "wxt/browser": here("./browser-stub.ts") } },
  build: { outDir: here("../../.test-runtime/preview"), emptyOutDir: true, target: "es2022" },
  logLevel: "warn",
};
