import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import viteConfig from "../vite.config";

// These checks guard the self-hosting build path: the website is built on the host, where the
// release artifacts exist, and the web image only copies and rechecks that output. A Dockerfile
// that reaches for files outside the build context fails only at `docker compose build`, so
// check its inputs here as well.

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) =>
  readFileSync(`${repository}${path}`, "utf8").replace(/\r\n/g, "\n");
const hostBuiltWebsite = "apps/web/dist";

type IgnoreRule = { negated: boolean; pattern: RegExp };

function globPattern(glob: string) {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character === "*" && glob[index + 1] === "*") {
      // "**/" stands for zero or more folders.
      if (glob[index + 2] === "/") {
        source += "(?:.*/)?";
        index += 2;
      } else {
        source += ".*";
        index += 1;
      }
    } else if (character === "*") source += "[^/]*";
    else if (character === "?") source += "[^/]";
    else source += character.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

function ignoreRules(): IgnoreRule[] {
  return read(".dockerignore")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const negated = line.startsWith("!");
      const glob = (negated ? line.slice(1) : line).replace(/^\/+|\/+$/g, "");
      return { negated, pattern: globPattern(glob) };
    });
}

// Docker applies the last rule that matches the path or one of its parent folders.
function outsideContext(rules: IgnoreRule[], path: string) {
  const parts = path.split("/");
  const candidates = parts.map((_, index) => parts.slice(0, index + 1).join("/"));
  let excluded = false;
  for (const rule of rules)
    if (candidates.some((candidate) => rule.pattern.test(candidate)))
      excluded = !rule.negated;
  return excluded;
}

function copySources(dockerfile: string) {
  const sources: string[] = [];
  for (const line of read(dockerfile).split(/\r?\n/)) {
    const words = line.trim().split(/\s+/);
    if (words[0] !== "COPY") continue;
    const options = words.slice(1).filter((word) => word.startsWith("--"));
    if (options.some((option) => option.startsWith("--from="))) continue;
    const paths = words.slice(1 + options.length);
    sources.push(...paths.slice(0, -1));
  }
  return sources;
}

function tracked(path: string) {
  const result = spawnSync("git", ["ls-files", "--", path], {
    cwd: repository,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().length > 0;
}

test("the Docker build context includes the host-built website and keeps release inputs out", () => {
  const rules = ignoreRules();
  assert.equal(outsideContext(rules, "apps/web/dist/index.html"), false);
  assert.equal(outsideContext(rules, "apps/web/dist/downloads/manifest.json"), false);
  for (const path of [
    "apps/extension/dist/index.js",
    "apps/web/node_modules/vite/package.json",
    "artifacts/browser/manifest.json",
    "design-canvas/screens.js",
    "apps/web/dist/.env",
  ])
    assert.equal(outsideContext(rules, path), true, `${path} is in the context`);
});

test("every image copies only paths that a clean checkout plus the documented host build provide", () => {
  const rules = ignoreRules();
  for (const dockerfile of ["deploy/proxy/Dockerfile", "apps/server/Dockerfile"]) {
    const sources = copySources(dockerfile);
    assert.ok(sources.length > 0, `${dockerfile} has no COPY sources`);
    for (const source of sources) {
      const path = source.replace(/\/+$/, "");
      assert.equal(
        outsideContext(rules, path),
        false,
        `${dockerfile} copies ${path}, which .dockerignore excludes`,
      );
      if (path !== hostBuiltWebsite)
        assert.ok(tracked(path), `${dockerfile} copies ${path}, which a clean checkout lacks`);
    }
  }
  assert.ok(copySources("deploy/proxy/Dockerfile").includes(hostBuiltWebsite));
  assert.equal((viteConfig.build as { outDir?: string } | undefined)?.outDir, "dist");
});

test("the web image rechecks the built site instead of rebuilding it", () => {
  const dockerfile = read("deploy/proxy/Dockerfile");
  const runs = dockerfile
    .split(/\r?\n/)
    .filter((line) => line.startsWith("RUN "))
    .join("\n");
  // The website build needs tools/, registry/, design-canvas/ and artifacts/browser, none of
  // which the context provides.
  assert.doesNotMatch(runs, /pnpm|npm |vite|build-methodology|prepare-downloads/);
  assert.match(runs, /RUN node check-built-downloads\.mjs dist/);
  assert.match(
    dockerfile,
    /COPY apps\/web\/scripts\/check-built-downloads\.mjs check-built-downloads\.mjs/,
  );
  assert.match(dockerfile, /COPY --from=downloads \/opt\/aift\/dist \/usr\/share\/nginx\/html/);
});

function commandOrder(text: string, commands: string[]) {
  const positions = commands.map((command) => text.indexOf(command));
  commands.forEach((command, index) =>
    assert.notEqual(positions[index], -1, `missing ${command}`),
  );
  for (let index = 1; index < positions.length; index += 1)
    assert.ok(
      positions[index - 1] < positions[index],
      `${commands[index - 1]} must come before ${commands[index]}`,
    );
}

test("self-hosting docs and CI build the website on the host before the image", () => {
  commandOrder(read("docs/operations/SELF-HOSTING.md"), [
    "\npnpm package:browsers\n",
    "\npnpm verify:source-archive\n",
    "\npnpm --filter @footprint/web build\n",
    "\ndocker compose build --pull api web\n",
  ]);
  // CI builds the image right after `pnpm check`, which must leave a verified website behind.
  const check = JSON.parse(read("package.json")).scripts.check as string;
  commandOrder(check, [
    "pnpm package:browsers",
    "pnpm verify:source-archive",
    "pnpm --filter @footprint/web build",
  ]);
  assert.ok(check.endsWith("pnpm --filter @footprint/web build"));
  commandOrder(read(".github/workflows/check.yml"), [
    "run: pnpm check",
    "docker compose build --pull --no-cache api web",
  ]);
});
