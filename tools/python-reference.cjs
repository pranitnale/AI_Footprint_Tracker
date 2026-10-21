const { existsSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const { resolve, delimiter } = require("node:path");

const root = resolve(__dirname, "..");
const setup =
  "uv sync --project apps/server --frozen --group dev --python 3.13.15";

function pythonExecutable(projectRoot = root) {
  const executable = resolve(
    projectRoot,
    "apps/server/.venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  if (!existsSync(executable))
    throw new Error(`Python reference environment is missing. Run: ${setup}`);
  return executable;
}

function pythonReference(args, options = {}) {
  // Reference tests must not borrow packages from a shell or user-site environment.
  const env = { ...process.env };
  delete env.PYTHONHOME;
  delete env.PYTHONUSERBASE;
  env.PYTHONNOUSERSITE = "1";
  env.PYTHONPATH = [
    "apps/server",
    "packages/contracts/python",
    "packages/estimator/python",
  ]
    .map((path) => resolve(root, path))
    .join(delimiter);
  return spawnSync(pythonExecutable(), ["-X", "utf8", ...args], {
    ...options,
    encoding: "utf8",
    cwd: root,
    env,
  });
}

module.exports = { pythonReference, pythonExecutable };
