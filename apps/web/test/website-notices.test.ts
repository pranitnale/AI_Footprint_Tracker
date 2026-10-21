import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build, type Rolldown } from "vite";
import viteConfig from "../vite.config";
import {
  GENERATED_NOTICES,
  renderNoticesModule,
  shippedPackages,
  websiteComponents,
  websiteNoticesPlugin,
} from "../scripts/website-notices.mjs";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const listed = () => new Set(websiteComponents().map((item) => `${item.name}@${item.version}`));

test("the committed website notices match the website's dependencies", () => {
  const committed = readFileSync(GENERATED_NOTICES, "utf8").replace(/\r\n/g, "\n");
  assert.equal(
    committed,
    renderNoticesModule(websiteComponents()),
    "src/generated/website-notices.ts is stale; run vite build in apps/web and commit it",
  );
});

test("every listed component carries its full licence text", () => {
  const components = websiteComponents();
  for (const name of ["react", "react-dom", "scheduler", "vite", "rolldown"])
    assert.ok(components.some((item) => item.name === name), name);
  for (const item of components) {
    assert.ok(item.notices.length > 0, item.name);
    assert.ok(item.notices.every((notice) => notice.text.length > 200), item.name);
    if (item.license === "MIT")
      assert.ok(item.notices.some((notice) => /Permission is hereby granted/.test(notice.text)), item.name);
    if (item.license === "OFL-1.1")
      assert.ok(
        item.notices.some(
          (notice) => /SIL OPEN FONT LICENSE Version 1\.1/.test(notice.text) && /^Copyright \d{4}/m.test(notice.text),
        ),
        item.name,
      );
  }
  const fonts = components.filter((item) => item.name.startsWith("@fontsource-variable/"));
  assert.equal(fonts.length, 2);
});

test("a bundle with an unlisted package or an unknown virtual module fails the build", () => {
  const plugin = websiteNoticesPlugin() as unknown as {
    generateBundle: (this: { error: (message: string) => never }, options: unknown, bundle: unknown) => void;
  };
  const context = {
    error(message: string): never {
      throw new Error(message);
    },
  };
  // A real folder, because the check reads the package's own package.json.
  const directory = mkdtempSync(join(tmpdir(), "aift-web-notices-"));
  try {
    const packageDirectory = join(directory, "node_modules", "unlisted-package");
    mkdirSync(packageDirectory, { recursive: true });
    writeFileSync(
      join(packageDirectory, "package.json"),
      JSON.stringify({ name: "unlisted-package", version: "1.2.3" }),
    );
    assert.throws(
      () =>
        plugin.generateBundle.call(context, {}, {
          "index.js": { type: "chunk", moduleIds: [join(packageDirectory, "index.js")] },
        }),
      /without licence notices: unlisted-package@1\.2\.3/,
    );
    assert.throws(
      () =>
        plugin.generateBundle.call(context, {}, {
          "index.js": { type: "chunk", moduleIds: ["\0some-new-helper.js"] },
        }),
      /virtual modules of unknown origin: some-new-helper\.js/,
    );
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("the real website build ships no package missing from the notices", { timeout: 240_000 }, async () => {
  const plugins = (viteConfig.plugins ?? []).filter(
    (plugin) => !(plugin && typeof plugin === "object" && "name" in plugin && plugin.name === "verified-browser-downloads"),
  );
  const output = (await build({
    ...viteConfig,
    configFile: false,
    root: webRoot,
    logLevel: "error",
    plugins,
    build: { ...viteConfig.build, write: false, sourcemap: false },
  })) as Rolldown.RolldownOutput;
  const bundle = Object.fromEntries(output.output.map((item) => [item.fileName, item]));
  const { packages, unknownVirtual } = shippedPackages(bundle);
  assert.deepEqual(unknownVirtual, []);
  const names = listed();
  const missing = packages.filter((key) => !names.has(key));
  assert.deepEqual(missing, [], `shipped without notices: ${missing.join(", ")}`);
  // The checks above must see real packages, not an empty bundle.
  for (const expected of ["react-dom", "@fontsource-variable/instrument-sans"])
    assert.ok(packages.some((key) => key.startsWith(`${expected}@`)), expected);
});
