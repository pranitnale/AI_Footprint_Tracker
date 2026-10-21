import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import * as tokenizers from "@footprint/tokenizers";
import * as countingConfig from "../lib/counting-config";
import * as fileTypes from "@footprint/file-text/types";
import {
  resolveBuildVariant,
  variantOutputTemplate,
} from "../build/variant";

const require = createRequire(import.meta.url);

// Owner decision of 20 October 2026: browsingActivity is declared next to the
// four earlier categories, because the usage records name which supported AI
// site a request was made on and when.
const EXPECTED_CATEGORIES = [
  "websiteActivity",
  "authenticationInfo",
  "personallyIdentifyingInfo",
  "technicalAndInteraction",
  "browsingActivity",
];

function compile(source: string) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
}

async function firefoxManifest() {
  const url = new URL("../wxt.config.ts", import.meta.url);
  const source = (await readFile(url, "utf8")).replaceAll(
    "import.meta.url",
    JSON.stringify(url.href),
  );
  const exported: any = {};
  new Function("require", "exports", compile(source))((name: string) => {
    if (name === "wxt") return { defineConfig: (value: any) => value };
    if (name === "node:url") return require("node:url");
    if (name === "./build/notices") return { writeBrowserNotices() {} };
    if (name === "./build/source-package")
      return {
        reviewSourcePackage: () => ({}),
        keepTestSources: (patterns: string[]) => patterns,
      };
    if (name === "./build/tokenizer-boundary")
      return { assertMainThreadTokenizerBoundary() {} };
    if (name === "./build/variant")
      return {
        resolveBuildVariant,
        variantOutputTemplate,
        writeBuildVariantMetadata() {},
      };
    throw new Error(`Unexpected WXT config import: ${name}`);
  }, exported);
  return exported.default.manifest({ browser: "firefox" });
}

async function firefoxPlatform(browser: any) {
  const source = (
    await readFile(new URL("../lib/platform.ts", import.meta.url), "utf8")
  ).replaceAll("import.meta.env.BROWSER", JSON.stringify("firefox"));
  const exported: Record<string, any> = {};
  new Function("require", "exports", "globalThis", compile(source))(
    (name: string) => {
      if (name === "wxt/browser") return { browser };
      if (name === "@footprint/tokenizers/metadata") return tokenizers;
      if (name === "./counting-config") return countingConfig;
      if (name === "@footprint/file-text/types") return fileTypes;
      if (name === "./count-host") return {};
      throw new Error(`unexpected dependency: ${name}`);
    },
    exported,
    {},
  );
  return exported;
}

function permissionsBrowser(granted: { origins: string[]; data: string[] }) {
  const requests: any[] = [];
  return {
    requests,
    browser: {
      permissions: {
        contains: async (query: { origins: string[] }) =>
          query.origins.every((origin) => granted.origins.includes(origin)),
        getAll: async () => ({
          origins: granted.origins,
          data_collection: granted.data,
        }),
        request: async (query: any) => {
          requests.push(query);
          return true;
        },
      },
    },
  };
}

test("Firefox manifest declares browsingActivity and matches the categories the connection asks for", async () => {
  const manifest = await firefoxManifest();
  const declared =
    manifest.browser_specific_settings.gecko.data_collection_permissions;
  assert.deepEqual(declared.required, ["none"]);
  assert.deepEqual(declared.optional, EXPECTED_CATEGORIES);
  const platform = await firefoxPlatform(
    permissionsBrowser({ origins: [], data: [] }).browser,
  );
  assert.deepEqual(platform.COMPANY_DATA_CATEGORIES, declared.optional);
});

test("connecting on Firefox asks for every declared category, browsingActivity included", async () => {
  const fake = permissionsBrowser({ origins: [], data: [] });
  const platform = await firefoxPlatform(fake.browser);
  await platform.requestServerOrigin("https://org.example");
  assert.deepEqual(fake.requests, [
    {
      origins: ["https://org.example/*"],
      data_collection: EXPECTED_CATEGORIES,
    },
  ]);
});

test("a Firefox connection granted before browsingActivity was declared counts as not agreed", async () => {
  // Such a connection must stop sending and ask again, never send under the old grant.
  const before = permissionsBrowser({
    origins: ["https://org.example/*"],
    data: EXPECTED_CATEGORIES.filter((name) => name !== "browsingActivity"),
  });
  const old = await firefoxPlatform(before.browser);
  assert.equal(await old.hasCompanyConsent("https://org.example"), false);
  const after = permissionsBrowser({
    origins: ["https://org.example/*"],
    data: EXPECTED_CATEGORIES,
  });
  const current = await firefoxPlatform(after.browser);
  assert.equal(await current.hasCompanyConsent("https://org.example"), true);
});
