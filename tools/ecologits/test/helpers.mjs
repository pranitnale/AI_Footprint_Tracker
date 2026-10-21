import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdir,
  copyFile,
  readFile,
  writeFile,
  readdir,
} from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  containedPath,
  readJson,
  sha256File,
  validateRelativePath,
  walkFiles,
} from "../lib/common.mjs";

/**
 * The upstream release the repository currently accepts, read from its lock. Staging any
 * other release fails verification before the workflow under test runs: the frozen oracle
 * pins the accepted version and package hash, and changed package metadata needs a review.
 * The source archive must also be the accepted one, because in-place adoption refuses a
 * snapshot with a different file set (a PyPI sdist adds PKG-INFO to a commit archive).
 * Adoption keeps both archives as developer-private evidence inside the Git directory,
 * which a linked worktree reaches only through the common Git directory.
 */
export async function acceptedRelease(workspace) {
  const lock = await readJson(
    join(workspace, "packages/ecologits-core/upstream/lock.json"),
  );
  if (
    lock.release_kind !== "release_candidate" ||
    lock.core_commit !== lock.catalog_commit
  )
    throw new Error(
      "The maintenance tests stage an accepted single-commit release",
    );
  const privateDirectory = validateRelativePath(
    lock.private_artifact_directory,
  );
  if (!privateDirectory.startsWith(".git/"))
    throw new Error(
      `Unexpected private artifact directory: ${privateDirectory}`,
    );
  const git = spawnSync(
    "git",
    [
      "-C",
      workspace,
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ],
    { encoding: "utf8" },
  );
  const directory = containedPath(
    git.status === 0 ? git.stdout.trim() : join(workspace, ".git"),
    privateDirectory.slice(".git/".length),
  );
  const sourceArchive = join(directory, `source-${lock.core_commit}.tar.gz`);
  const packageArchive = join(
    directory,
    `ecologits-${lock.upstream_version}.tar.gz`,
  );
  const available = existsSync(sourceArchive) && existsSync(packageArchive);
  if (available) {
    for (const [path, expected] of [
      [sourceArchive, lock.artifacts.source_core.sha256],
      [packageArchive, lock.artifacts.package.sha256],
    ])
      if ((await sha256File(path)) !== expected)
        throw new Error(
          `Private archive does not match the accepted lock: ${path}`,
        );
  }
  return {
    version: lock.upstream_version,
    commit: lock.core_commit,
    sourceArchive,
    packageArchive,
    available,
  };
}

function octal(value, width) {
  return `${value.toString(8).padStart(width - 1, "0")}\0`;
}

function writeText(header, offset, length, value) {
  Buffer.from(value).copy(header, offset, 0, length);
}

function header(name, size, type = "0") {
  const output = Buffer.alloc(512);
  writeText(output, 0, 100, name);
  writeText(output, 100, 8, octal(type === "5" ? 0o755 : 0o644, 8));
  writeText(output, 108, 8, octal(0, 8));
  writeText(output, 116, 8, octal(0, 8));
  writeText(output, 124, 12, octal(size, 12));
  writeText(output, 136, 12, octal(0, 12));
  output.fill(32, 148, 156);
  output[156] = type.charCodeAt(0);
  writeText(output, 257, 6, "ustar\0");
  writeText(output, 263, 2, "00");
  let checksum = 0;
  for (const byte of output) checksum += byte;
  writeText(output, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return output;
}

function tarEntry(path, data, type = "0") {
  const chunks = [];
  let headerName = path;
  if (Buffer.byteLength(path) > 100) {
    const longName = Buffer.from(`${path}\0`);
    chunks.push(
      header("././@LongLink", longName.length, "L"),
      longName,
      Buffer.alloc((512 - (longName.length % 512)) % 512),
    );
    headerName = path.slice(-100);
  }
  chunks.push(
    header(headerName, data.length, type),
    data,
    Buffer.alloc((512 - (data.length % 512)) % 512),
  );
  return chunks;
}

export function archive(entries) {
  const chunks = [];
  for (const entry of entries)
    chunks.push(
      ...tarEntry(entry.path, Buffer.from(entry.data ?? ""), entry.type ?? "0"),
    );
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks), { mtime: 0 });
}

export async function archiveDirectory(
  source,
  destination,
  rootName = "ecologits-fixture",
) {
  const entries = [];
  for (const path of await walkFiles(source))
    entries.push({
      path: `${rootName}/${path}`,
      data: await readFile(containedPath(source, path)),
    });
  await writeFile(destination, archive(entries));
}

export async function copyCore(source, destination) {
  await mkdir(destination, { recursive: true });
  // Prune installed environments before traversal, not after walking thousands of cache files.
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (
      [
        ".venv",
        "node_modules",
        "__pycache__",
        ".pytest_cache",
        ".test-runtime",
      ].includes(entry.name)
    )
      continue;
    const from = containedPath(source, entry.name);
    const to = containedPath(destination, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`Fixture source link rejected: ${from}`);
    if (entry.isDirectory()) await copyCore(from, to);
    else if (entry.isFile()) await copyFile(from, to);
    else throw new Error(`Unsupported fixture source: ${from}`);
  }
}

export function runNode(workspace, script, args, options = {}) {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", script, ...args],
    {
      cwd: workspace,
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      timeout: 240_000,
      ...options,
    },
  );
  return result;
}
