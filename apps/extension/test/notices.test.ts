import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  symlinkSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { writeBrowserNotices, upstreamNoticeNames } from "../build/notices";

const root = fileURLToPath(new URL("../../..", import.meta.url));

test("pnpm content-store symlinked license files retain their full notice text", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "aift-license-link-"));
  try {
    const original = join(directory, "original.txt");
    writeFileSync(original, "Full synthetic permission notice\n");
    try {
      symlinkSync(original, join(directory, "LICENSE"), "file");
    } catch (error) {
      if (
        process.platform === "win32" &&
        (error as NodeJS.ErrnoException).code === "EPERM"
      ) {
        context.skip(
          "Windows denies file-symlink creation; the clean-source build checks real pnpm store links.",
        );
        return;
      }
      throw error;
    }
    mkdirSync(join(directory, "NOTICE-directory"));
    assert.deepEqual(upstreamNoticeNames(directory), ["LICENSE"]);
    assert.equal(
      readFileSync(join(directory, "LICENSE"), "utf8"),
      "Full synthetic permission notice\n",
    );
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("browser notices preserve full upstream text and rebuild to identical bytes", () => {
  const first = mkdtempSync(join(tmpdir(), "aift-notice-a-"));
  const second = mkdtempSync(join(tmpdir(), "aift-notice-b-"));
  try {
    const a = writeBrowserNotices(root, first);
    const b = writeBrowserNotices(root, second);
    assert.deepEqual(a, b);
    for (const file of a.files)
      assert.deepEqual(
        readFileSync(join(first, file.path)),
        readFileSync(join(second, file.path)),
      );
    assert.match(
      readFileSync(join(first, "licenses/saxes@6.0.0/LICENSE"), "utf8"),
      /Permission to use, copy, modify/,
    );
    assert.match(
      readFileSync(join(first, "licenses/react@19.3.0/LICENSE"), "utf8"),
      /Permission is hereby granted/,
    );
    assert.match(
      readFileSync(join(first, "licenses/pdfjs-dist@6.3.289/LICENSE"), "utf8"),
      /Apache License/,
    );
    assert.ok(a.files.some((file) => file.path.endsWith("core-js-MIT.txt")));
    assert.equal(JSON.stringify(a).includes(root), false);
    assert.ok(a.components.some((component) => component.name === "xmlchars"));
    assert.ok(a.components.some((component) => component.name === "wxt"));
    assert.ok(
      a.components.some((component) => component.name === "@wxt-dev/browser"),
    );
    assert.ok(
      a.components.some(
        (component) =>
          component.name === "EcoLogits independent TypeScript port" &&
          component.license === "MPL-2.0",
      ),
    );
    assert.equal(
      a.ecologits.corresponding_source.path,
      "source/ecologits-source.zip",
    );
    assert.equal(
      readFileSync(join(first, "source/ecologits-source.zip"))
        .subarray(0, 4)
        .toString("hex"),
      "504b0304",
    );
    assert.match(
      readFileSync(join(first, "licenses.html"), "utf8"),
      /Corresponding EcoLogits source/,
    );
    assert.match(
      readFileSync(join(first, "licenses/ecologits/MPL-2.0.txt"), "utf8"),
      /Mozilla Public License Version 2\.0/,
    );
    assert.match(
      readFileSync(join(first, "licenses/wxt@0.21.4/LICENSE"), "utf8"),
      /Copyright \(c\) 2023 Aaron/,
    );
    assert.match(
      readFileSync(
        join(first, "licenses/@wxt-dev__browser@0.1.43/LICENSE"),
        "utf8",
      ),
      /Permission is hereby granted/,
    );
    // Vite's preload and CommonJS helpers are written into the shipped chunks.
    assert.ok(
      a.components.some(
        (component) => component.name === "vite" && component.notices.length > 0,
      ),
    );
    for (const buildOnly of [
      "typescript",
      "@types/filesystem",
      "@webext-core/match-patterns",
    ])
      assert.equal(
        a.components.some((component) => component.name === buildOnly),
        false,
      );
  } finally {
    rmSync(first, { recursive: true });
    rmSync(second, { recursive: true });
  }
});

test("the inventory and the shipped notices name exactly the components the build ships", () => {
  const shipped = writeBrowserNotices(root).components.map(
    (component) => `${component.name}@${component.version} ${component.license}`,
  );
  const inventory = JSON.parse(
    readFileSync(join(root, "THIRD-PARTY-INVENTORY.json"), "utf8"),
  ) as {
    components: Array<{
      name: string;
      version: string;
      license: string;
      browser_runtime?: boolean;
    }>;
  };
  const browserRuntime = inventory.components.filter(
    (component) => component.browser_runtime,
  );
  const recorded = browserRuntime.map(
    (component) => `${component.name}@${component.version} ${component.license}`,
  );
  // A stale inventory means `pnpm generate:sbom` was not run after a dependency change.
  assert.deepEqual([...recorded].sort(), [...shipped].sort());
  // THIRD-PARTY-NOTICES.md is rendered from the inventory by tools/third_party.py.
  const notices = readFileSync(join(root, "THIRD-PARTY-NOTICES.md"), "utf8");
  for (const component of browserRuntime)
    assert.ok(
      notices.includes(
        `| ${component.name} | ${component.version} | ${component.license} |`,
      ),
      `${component.name} is missing from THIRD-PARTY-NOTICES.md`,
    );
});
