import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const browsers = ["chrome", "edge", "firefox"] as const;
export const engines = ["ecologits"] as const;
export type Browser = (typeof browsers)[number];
export type Engine = (typeof engines)[number];

const root = fileURLToPath(new URL("../..", import.meta.url));
const outputFolders: Record<Browser, string> = {
  chrome: "chrome-mv3",
  edge: "edge-mv3",
  firefox: "firefox-mv2",
};

export interface VariantPlan {
  browser: Browser;
  engine: Engine;
  output: string;
  status: "intermediate" | "release_candidate";
}

function select<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  name: string,
): readonly T[] {
  if (value === undefined || value === "all") return allowed;
  if (!allowed.includes(value as T))
    throw new Error(`--${name} must be all or one of: ${allowed.join(", ")}`);
  return [value as T];
}

export function planVariants(
  browser: string | undefined,
  engine: string | undefined,
  releaseCandidate = false,
): VariantPlan[] {
  return select(browser, browsers, "browser").flatMap((selectedBrowser) =>
    select(engine, engines, "engine").map((selectedEngine) => ({
      browser: selectedBrowser,
      engine: selectedEngine,
      output: `apps/extension/.output/${outputFolders[selectedBrowser]}`,
      status: releaseCandidate ? "release_candidate" : "intermediate",
    })),
  );
}

export function parseArguments(values: readonly string[]) {
  let browser: string | undefined;
  let engine: string | undefined;
  let releaseCandidate = false;
  let check = false;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--") continue;
    if (value === "--release-candidate") releaseCandidate = true;
    else if (value === "--check") check = true;
    else if (value === "--browser" || value === "--engine") {
      const selection = values[++index];
      if (!selection || selection.startsWith("--"))
        throw new Error(`${value} requires a value`);
      if (value === "--browser") browser = selection;
      else engine = selection;
    } else throw new Error(`Unknown build-variants option: ${value}`);
  }
  return { plans: planVariants(browser, engine, releaseCandidate), check };
}

function runPnpm(arguments_: string[], environment: NodeJS.ProcessEnv): void {
  const result =
    process.platform === "win32"
      ? spawnSync(
          process.env.ComSpec ?? "cmd.exe",
          ["/d", "/c", `pnpm ${arguments_.join(" ")}`],
          { cwd: root, env: environment, stdio: "inherit" },
        )
      : spawnSync("pnpm", arguments_, {
          cwd: root,
          env: environment,
          stdio: "inherit",
        });
  if (result.status !== 0)
    throw new Error(
      `Variant build command failed with status ${result.status ?? "unknown"}`,
    );
}

export function executeVariant(plan: VariantPlan): void {
  const environment = {
    ...process.env,
    AIFT_BUILD_DEFAULT: plan.engine,
    AIFT_BUILD_VARIANT: plan.engine,
    AIFT_BUILD_STATUS: plan.status,
    SOURCE_DATE_EPOCH: process.env.SOURCE_DATE_EPOCH ?? "1788998400",
  };
  runPnpm(
    [
      "--filter",
      "@footprint/extension",
      "exec",
      "wxt",
      "build",
      "-b",
      plan.browser,
    ],
    environment,
  );
  const output = resolve(root, plan.output);
  const metadata = JSON.parse(
    readFileSync(join(output, "build-variant.json"), "utf8"),
  );
  assert.equal(metadata.variant_id, `${plan.browser}-${plan.engine}`);
  assert.equal(metadata.default_engine, plan.engine);
  assert.equal(metadata.build_status, plan.status);
  assert.deepEqual(metadata.available_engines, [...engines]);
  assert.equal(metadata.user_override_enabled, false);
  assert.equal(metadata.bundled_notices.license_path, "licenses.html");
  assert.equal(
    metadata.bundled_notices.source_path,
    "source/ecologits-source.zip",
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { plans, check } = parseArguments(process.argv.slice(2));
  if (!check) for (const plan of plans) executeVariant(plan);
  process.stdout.write(
    `${JSON.stringify({ status: check ? "planned" : plans[0]?.status, variants: plans }, null, 2)}\n`,
  );
}
