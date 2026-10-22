import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const slash = (value) => value.replaceAll("\\", "/");
const packages = {
  contracts: ["zod", "@noble/hashes"],
  "capture-core": [],
  adapters: ["@footprint/capture-core"],
  tokenizers: ["@footprint/contracts", "gpt-tokenizer"],
  "file-text": ["@footprint/tokenizers", "fflate", "pdfjs-dist", "saxes"],
  ledger: ["@footprint/contracts"],
  estimator: [
    "@footprint/contracts",
    "@footprint/ecologits-core",
    "decimal.js",
    "zod",
  ],
  "ecologits-core": [],
  ui: ["react", "react-dom"],
};
const applications = {
  extension: [
    "@footprint/file-text",
    "@footprint/contracts",
    "@footprint/estimator",
    "@footprint/tokenizers",
    "@footprint/ledger",
    "@footprint/capture-core",
    "@footprint/adapters",
    "@footprint/ui",
    "react",
    "react-dom",
    "wxt",
    // Streams large saved conversations without holding the whole body (reviewed 22 Sep 2026).
    "@streamparser/json",
  ],
  // The admin site reads the organization API's contract types and schemas (reviewed 22 Oct 2026).
  web: ["@footprint/ui", "@footprint/contracts", "react", "react-dom"],
};
const browserClients = new Set([
  "entrypoints/background.ts",
  "entrypoints/content.content.ts",
  "entrypoints/capture.content.ts",
  "lib/platform.ts",
  "lib/file-client.ts",
  "lib/file-relay.ts",
  "lib/dashboard/client.ts",
  "lib/offscreen-entry.ts",
  // Reviewed 22 Oct 2026: presentation-only browser calls that touch no ledger or capture state.
  "lib/dash/Settings.tsx", // storage.onChanged, to show settings changed in another view
  "lib/dash/Tracking.tsx", // runtime.getManifest, for the version shown in Settings
  "lib/popup/last-view.ts", // storage.local, the popup's remembered view
  "lib/ui/navigation.ts", // runtime.getURL, links between extension pages
  "lib/ui/preferences.ts", // storage.local, display preferences
  "lib/ui/theme.ts", // storage.onChanged, the Appearance choice
  "lib/welcome/Welcome.tsx", // tabs.update, the tour's close and site links
]);
const estimatorClients = new Set([
  "lib/runtime-composition.ts",
  "lib/estimation/config.ts",
  "lib/estimation/service.ts",
  "lib/coordinator.ts",
  "lib/estimate-presentation.ts",
  "lib/history-service.ts",
  "lib/method-service.ts",
  // This standalone compatibility client uses the injected callback in the production composition.
  "lib/company.ts",
  // Reviewed 22 Oct 2026: pure aggregation of saved figures, no estimation.
  "lib/server-summary.ts", // emptyHistorySummary
  "lib/usage-breakdown.ts", // HistoryAccumulator
]);
// Read-only JSON data an application module may import from outside its folder (reviewed 22 Oct 2026).
const sharedData = (kind, name, local, target) =>
  kind === "apps" &&
  (/^(config\/source-repository\.json|THIRD-PARTY-INVENTORY\.json)$/.test(target) ||
    (name === "extension" &&
      ["lib/claude-token-factor.ts", "lib/estimate-details.ts"].includes(local) &&
      target === "config/estimation.media.json") ||
    (name === "web" &&
      local === "src/site/pages/WebDownloads.tsx" &&
      target === "apps/extension/package.json") ||
    // The admin site reuses the extension's figure modules, which use no extension API.
    (name === "web" &&
      local === "src/admin/figures.ts" &&
      /^apps\/extension\/lib\/(ui\/(usage-figures|components|figure-math|model-names|dash-periods)|dashboard\/types)$/.test(
        target,
      )));
const countingFiles = new Set([
  "lib/count.worker.ts",
  "lib/file.worker.ts",
  "lib/count-host.ts",
  "lib/history-capture.ts",
]);
const tokenizerWorkers = new Set([
  "lib/count.worker.ts",
  "lib/file.worker.ts",
  "lib/counting-worker-config.ts",
]);
const tokenizerMetadata = new Set([
  "src/metadata.ts",
  "src/manifest.ts",
  "src/protocol.ts",
  "src/runtime.ts",
  // Uploaded image token rules (A7): arithmetic on image sizes, no text tokenizer.
  "src/image-input.ts",
]);
const packageName = (specifier) =>
  specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0];

function packageExports(name, root) {
  const directory = join(root, "packages", name);
  const declared = JSON.parse(
    readFileSync(join(directory, "package.json"), "utf8"),
  ).exports;
  const entries =
    typeof declared === "string" ||
    Array.isArray(declared) ||
    (declared && !Object.keys(declared).some((key) => key.startsWith(".")))
      ? { ".": declared }
      : (declared ?? {});
  const issues = [];
  function inspect(value) {
    if (value === null) return;
    if (typeof value === "string") {
      const target = slash(relative(root, resolve(directory, value)));
      if (
        !value.startsWith("./") ||
        value.includes("*") ||
        !target.startsWith(`packages/${name}/`) ||
        /(^|\/)(test|tests|tools|\.test-runtime|upstream)\//.test(target) ||
        /\/export-schema(?:\.[cm]?[jt]s)?$/.test(target)
      )
        issues.push(
          `packages/${name}: export target crosses a runtime boundary: ${value}`,
        );
      return;
    }
    if (value && typeof value === "object") {
      for (const item of Object.values(value)) inspect(item);
    } else issues.push(`packages/${name}: invalid export declaration`);
  }
  for (const [key, value] of Object.entries(entries)) {
    if (key !== "." && (!key.startsWith("./") || key.includes("*")))
      issues.push(`packages/${name}: exports must name explicit public paths`);
    inspect(value);
  }
  return { keys: Object.keys(entries), issues };
}

export function importsOf(source, file = "source.ts") {
  const parsed = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const imports = [];
  const add = (node, typeOnly = false) =>
    imports.push({
      specifier: ts.isStringLiteralLike(node) ? node.text : null,
      typeOnly,
    });
  function visit(node) {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier)
      add(
        node.moduleSpecifier,
        !!node.importClause?.isTypeOnly ||
          (!!node.importClause?.namedBindings &&
            ts.isNamedImports(node.importClause.namedBindings) &&
            !node.importClause.name &&
            node.importClause.namedBindings.elements.length > 0 &&
            node.importClause.namedBindings.elements.every(
              (element) => element.isTypeOnly,
            )),
      );
    else if (ts.isExportDeclaration(node) && node.moduleSpecifier)
      add(
        node.moduleSpecifier,
        node.isTypeOnly ||
          (!!node.exportClause &&
            ts.isNamedExports(node.exportClause) &&
            node.exportClause.elements.length > 0 &&
            node.exportClause.elements.every((element) => element.isTypeOnly)),
      );
    else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression
    )
      add(node.moduleReference.expression, node.isTypeOnly);
    else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    ) {
      if (node.arguments.length === 1) add(node.arguments[0]);
      else imports.push({ specifier: null, typeOnly: false });
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
      add(node.argument.literal, true);
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  return imports;
}

export function checkModule(file, source, root = repositoryRoot) {
  const path = slash(relative(root, resolve(root, file)));
  const match = /^(packages|apps)\/([^/]+)\/(.*)$/.exec(path);
  if (!match) return [`${path}: source is outside an approved module`];
  const [, kind, name, local] = match;
  const allowed = kind === "packages" ? packages[name] : applications[name];
  if (!allowed) return [`${path}: module has no reviewed dependency policy`];
  const issues = [];
  if (kind === "apps" && name === "extension" && local.startsWith("lib/")) {
    const parsed = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    const aliases = new Set(["ledger", "repository"]);
    const unwrap = (node) => {
      while (
        ts.isParenthesizedExpression(node) ||
        ts.isAsExpression(node) ||
        ts.isTypeAssertionExpression(node) ||
        ts.isNonNullExpression(node) ||
        ts.isSatisfiesExpression(node)
      )
        node = node.expression;
      return node;
    };
    const member = (value) => {
      const node = unwrap(value);
      if (ts.isPropertyAccessExpression(node))
        return { receiver: unwrap(node.expression), name: node.name.text };
      if (
        ts.isElementAccessExpression(node) &&
        node.argumentExpression &&
        ts.isStringLiteralLike(node.argumentExpression)
      )
        return {
          receiver: unwrap(node.expression),
          name: node.argumentExpression.text,
        };
      return null;
    };
    const storageReceiver = (value) => {
      const node = unwrap(value),
        property = member(node);
      return (
        (ts.isIdentifier(node) && aliases.has(node.text)) ||
        (property && ["ledger", "repository"].includes(property.name))
      );
    };
    function collectAliases(node) {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        storageReceiver(node.initializer)
      )
        aliases.add(node.name.text);
      ts.forEachChild(node, collectAliases);
    }
    collectAliases(parsed);
    function inspect(node) {
      if (ts.isIdentifier(node) && node.text === "Ledger")
        issues.push(
          `${path}: application service depends on the concrete Ledger class`,
        );
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteralLike(node.moduleSpecifier) &&
        node.moduleSpecifier.text === "@footprint/ledger" &&
        node.importClause?.namedBindings &&
        ts.isNamespaceImport(node.importClause.namedBindings)
      )
        issues.push(
          `${path}: storage namespace imports hide the domain capability boundary`,
        );
      if (ts.isCallExpression(node)) {
        const property = member(node.expression);
        if (property) {
          const { name: method, receiver } = property;
          const rawOperation =
            ["scanIndex", "scanRecords", "policyTransaction"].includes(
              method,
            ) ||
            (storageReceiver(receiver) &&
              ["get", "put", "all", "list", "remove", "commit"].includes(
                method,
              ));
          if (rawOperation)
            issues.push(
              `${path}: application service bypasses its domain repository (${method})`,
            );
        }
      }
      ts.forEachChild(node, inspect);
    }
    inspect(parsed);
  }
  for (const { specifier: raw, typeOnly } of importsOf(source, path)) {
    const fail = (reason) => issues.push(`${path}: ${reason}`);
    if (raw === null) {
      fail("computed module loading is not permitted");
      continue;
    }
    const specifier = raw.split("?")[0];
    if (/^(https?:|data:|file:|node:)/.test(specifier)) {
      fail(`runtime import ${raw} is not permitted`);
      continue;
    }
    let target = null;
    if (specifier.startsWith(".")) {
      target = slash(relative(root, resolve(root, dirname(path), specifier)));
      const own = `${kind}/${name}/`;
      if (!target.startsWith(own)) {
        const buildData =
          kind === "apps" &&
          name === "extension" &&
          local === "lib/estimation/config.ts" &&
          /^config\/estimation\.(build|mappings|media)\.json$/.test(target);
        if (!buildData && !sharedData(kind, name, local, target))
          fail(`relative import escapes its module: ${raw}`);
      }
      if (/(^|\/)(test|tests|tools|\.test-runtime|upstream)\//.test(target))
        fail(`runtime imports developer or upstream source: ${raw}`);
      if (/\/export-schema(?:\.[cm]?[jt]s)?$/.test(target))
        fail(`runtime imports a schema build tool: ${raw}`);
      if (
        kind === "apps" &&
        name === "extension" &&
        local.startsWith("lib/") &&
        target.startsWith("apps/extension/entrypoints/")
      )
        fail(`service imports an entrypoint: ${raw}`);
    } else if (!allowed.includes(packageName(specifier))) {
      fail(`dependency is outside the reviewed layer: ${raw}`);
    }
    if (specifier.startsWith("@footprint/")) {
      const dependency = packageName(specifier).slice("@footprint/".length);
      const exports = packageExports(dependency, root);
      const subpath = "." + specifier.slice(packageName(specifier).length);
      issues.push(...exports.issues);
      if (!exports.keys.includes(subpath))
        fail(`internal package import is outside its declared exports: ${raw}`);
      if (/\/export-schema(?:\.[cm]?[jt]s)?$/.test(specifier))
        fail(`runtime imports a schema build tool: ${raw}`);
    }
    if (
      kind === "packages" &&
      name === "tokenizers" &&
      tokenizerMetadata.has(local) &&
      !typeOnly
    ) {
      const metadataTarget = target?.replace(/^packages\/tokenizers\//, "");
      if (
        packageName(specifier) === "gpt-tokenizer" ||
        (target &&
          metadataTarget !== "src/assets.json" &&
          !tokenizerMetadata.has(
            metadataTarget.endsWith(".ts")
              ? metadataTarget
              : metadataTarget + ".ts",
          ))
      )
        fail(`tokenizer metadata imports executable counting: ${raw}`);
    }
    if (
      kind === "packages" &&
      name === "file-text" &&
      ["src/types.ts", "src/host.ts"].includes(local) &&
      !typeOnly &&
      packageName(specifier) === "@footprint/tokenizers" &&
      specifier !== "@footprint/tokenizers/metadata"
    )
      fail(`file metadata/host imports executable counting: ${raw}`);
    if (kind === "apps" && name === "extension") {
      if (
        !typeOnly &&
        !tokenizerWorkers.has(local) &&
        ((packageName(specifier) === "@footprint/tokenizers" &&
          specifier !== "@footprint/tokenizers/metadata") ||
          (target &&
            /^apps\/extension\/lib\/(?:counting-worker-config|count\.worker|file\.worker)(?:\.ts)?$/.test(
              target,
            ) &&
            !raw.includes("?worker&url")))
      )
        fail(`main-context module imports executable counting: ${raw}`);
      if (packageName(specifier) === "wxt" && !browserClients.has(local))
        fail(`browser API is outside its platform adapter: ${raw}`);
      if (
        packageName(specifier) === "@footprint/estimator" &&
        !estimatorClients.has(local)
      )
        fail(`calculation import is outside its service boundary: ${raw}`);
      if (
        countingFiles.has(local) &&
        [
          "@footprint/ledger",
          "@footprint/estimator",
          "@footprint/ecologits-core",
        ].includes(packageName(specifier))
      )
        fail(`counting depends on storage or calculation: ${raw}`);
      if (
        local.startsWith("lib/estimation/") &&
        target &&
        !target.startsWith("apps/extension/lib/estimation/") &&
        !/^config\/estimation\.(build|mappings|media)\.json$/.test(target)
      )
        fail(
          `estimation depends on browser composition or presentation: ${raw}`,
        );
      if (
        !typeOnly &&
        local.endsWith(".tsx") &&
        (packageName(specifier) === "@footprint/ledger" ||
          (target &&
            /lib\/(coordinator|company|history-service|method-service|runtime-composition|estimation\/service)(\.|\/|$)/.test(
              target,
            )))
      )
        fail(`presentation bypasses its background client: ${raw}`);
    }
  }
  return issues;
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(path)
      : /\.[cm]?tsx?$/.test(entry.name)
        ? [path]
        : [];
  });
}
export function checkRepository(root = repositoryRoot) {
  const modules = readdirSync(join(root, "packages"), {
    withFileTypes: true,
  }).filter((entry) => entry.isDirectory());
  const exportIssues = modules.flatMap(
    (entry) => packageExports(entry.name, root).issues,
  );
  const directories = modules.map((entry) =>
    join(root, "packages", entry.name, "src"),
  );
  directories.push(
    join(root, "apps/extension/lib"),
    join(root, "apps/extension/entrypoints"),
    join(root, "apps/web/src"),
  );
  return [
    ...exportIssues,
    ...directories
      .flatMap((directory) => sourceFiles(directory))
      .flatMap((file) => {
        // The JSON-schema generator is a build tool located beside contracts, never exported by the runtime barrel.
        if (
          /^packages\/(contracts|estimator)\/src\/export-schema\.ts$/.test(
            slash(relative(root, file)),
          )
        )
          return [];
        return checkModule(file, readFileSync(file, "utf8"), root);
      }),
  ];
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const issues = checkRepository();
  if (issues.length) {
    process.stderr.write(issues.join("\n") + "\n");
    process.exitCode = 1;
  } else process.stdout.write("Module dependency boundaries passed.\n");
}
