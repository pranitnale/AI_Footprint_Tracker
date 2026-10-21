import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";
import { gunzipSync } from "node:zlib";

export const TOOL_VERSION = "1";
export const CATALOG_SCHEMA = "1";
export const LIMITS = Object.freeze({
  downloadBytes: 64 * 1024 * 1024,
  expandedBytes: 256 * 1024 * 1024,
  fileBytes: 64 * 1024 * 1024,
  entries: 50_000,
});

export function parseArgs(argv, booleanNames = []) {
  const booleans = new Set(booleanNames);
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--") || token.length === 2)
      throw new Error(`Unexpected argument: ${token}`);
    const name = token.slice(2);
    if (Object.hasOwn(result, name))
      throw new Error(`Duplicate option: --${name}`);
    if (booleans.has(name)) result[name] = true;
    else {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--"))
        throw new Error(`Missing value for --${name}`);
      result[name] = value;
    }
  }
  return result;
}

export function requireOption(args, name) {
  const value = args[name];
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`--${name} is required`);
  return value;
}

export function assertAllowedOptions(args, names) {
  const allowed = new Set(names);
  const unknown = Object.keys(args).filter((name) => !allowed.has(name));
  if (unknown.length)
    throw new Error(
      `Unknown option(s): ${unknown.map((name) => `--${name}`).join(", ")}`,
    );
}

export function assertCommit(value, option = "commit") {
  if (!/^[0-9a-f]{40}$/i.test(value))
    throw new Error(`--${option} must be a full 40-character Git commit`);
  return value.toLowerCase();
}

export function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortValue(value[key])]),
    );
  }
  return value;
}

export function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(sortValue(value), null, 2)}\n`);
}

export async function readJson(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error(`Expected a regular JSON file: ${path}`);
  return JSON.parse(await readFile(path, "utf8"));
}

export async function writeJson(path, value) {
  await atomicWrite(path, jsonBytes(value));
}

export function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function sha256File(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error(`Expected a regular file: ${path}`);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function portablePath(path) {
  return path.split(sep).join("/");
}

const windowsReserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export function validateRelativePath(input) {
  if (typeof input !== "string" || input.length === 0 || input.includes("\0"))
    throw new Error("Empty or NUL path");
  if (input.includes("\\"))
    throw new Error(`Backslashes are not allowed in portable paths: ${input}`);
  if (input.startsWith("/") || input.startsWith("//") || /^[a-z]:/i.test(input))
    throw new Error(`Absolute path rejected: ${input}`);
  const parts = input.split("/");
  for (const part of parts) {
    if (!part || part === "." || part === "..")
      throw new Error(`Unsafe path component in: ${input}`);
    if (part.includes(":") || /[. ]$/.test(part) || windowsReserved.test(part))
      throw new Error(`Non-portable path component in: ${input}`);
  }
  return parts.join("/");
}

export function containedPath(root, input) {
  const portable = validateRelativePath(input);
  const target = resolve(root, ...portable.split("/"));
  const rel = relative(resolve(root), target);
  if (!rel || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel))
    throw new Error(`Path escapes root: ${input}`);
  return target;
}

export async function assertNoSymlinkPath(root, target) {
  const base = resolve(root);
  const destination = resolve(target);
  const rel = relative(base, destination);
  if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel))
    throw new Error(`Target escapes root: ${destination}`);
  let current = base;
  const baseInfo = await lstat(base);
  if (!baseInfo.isDirectory() || baseInfo.isSymbolicLink())
    throw new Error(`Unsafe root directory: ${base}`);
  for (const part of rel.split(sep).filter(Boolean).slice(0, -1)) {
    current = join(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory())
        throw new Error(`Symlink ancestor rejected: ${current}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

export async function atomicWrite(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${randomUUID()}`;
  const handle = await open(temporary, "wx");
  try {
    await handle.writeFile(value);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
}

export async function walkFiles(root) {
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
    throw new Error(`Tree root must be a regular directory: ${root}`);
  const output = [];
  async function visit(directory, prefix = "") {
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = join(directory, entry.name);
      const info = await lstat(full);
      if (info.isSymbolicLink()) throw new Error(`Symlink rejected: ${full}`);
      if (info.isDirectory()) await visit(full, rel);
      else if (info.isFile()) output.push(rel);
      else throw new Error(`Unsupported filesystem entry: ${full}`);
    }
  }
  await visit(root);
  return output;
}

export async function hashTree(root) {
  const result = {};
  for (const rel of await walkFiles(root))
    result[rel] = await sha256File(containedPath(root, rel));
  return result;
}

export async function copyTree(source, destination) {
  if (await exists(destination))
    throw new Error(`Destination already exists: ${destination}`);
  await mkdir(destination, { recursive: false });
  for (const rel of await walkFiles(source)) {
    const target = containedPath(destination, rel);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(containedPath(source, rel), target);
  }
}

function tarString(buffer, start, length) {
  const end = buffer.indexOf(0, start);
  return buffer
    .subarray(
      start,
      end >= start && end < start + length ? end : start + length,
    )
    .toString("utf8");
}

function tarNumber(buffer, start, length) {
  const text = tarString(buffer, start, length).trim().replaceAll("\0", "");
  if (!text) return 0;
  if (!/^[0-7]+$/.test(text)) throw new Error(`Invalid tar number: ${text}`);
  return Number.parseInt(text, 8);
}

function tarChecksum(header) {
  let total = 0;
  for (let index = 0; index < 512; index += 1)
    total += index >= 148 && index < 156 ? 32 : header[index];
  return total;
}

function parsePax(buffer) {
  const values = {};
  let offset = 0;
  while (offset < buffer.length) {
    const space = buffer.indexOf(32, offset);
    if (space < 0) throw new Error("Malformed PAX header");
    const length = Number.parseInt(
      buffer.subarray(offset, space).toString("ascii"),
      10,
    );
    if (
      !Number.isSafeInteger(length) ||
      length <= 0 ||
      offset + length > buffer.length
    )
      throw new Error("Malformed PAX record length");
    const record = buffer
      .subarray(space + 1, offset + length - 1)
      .toString("utf8");
    const equals = record.indexOf("=");
    if (equals < 1) throw new Error("Malformed PAX record");
    values[record.slice(0, equals)] = record.slice(equals + 1);
    offset += length;
  }
  return values;
}

function stripArchiveRoot(name, expectedRoot) {
  const clean = name.replace(/\/$/, "");
  validateRelativePath(clean);
  const parts = clean.split("/");
  if (parts.length < 2)
    return { root: expectedRoot ?? parts[0], relative: null };
  const root = expectedRoot ?? parts[0];
  if (parts[0] !== root)
    throw new Error(`Archive has multiple roots: ${parts[0]} and ${root}`);
  return { root, relative: validateRelativePath(parts.slice(1).join("/")) };
}

export async function extractTarGz(archivePath, destination, limits = LIMITS) {
  const archiveInfo = await lstat(archivePath);
  if (!archiveInfo.isFile() || archiveInfo.isSymbolicLink())
    throw new Error(`Archive must be a regular file: ${archivePath}`);
  if (archiveInfo.size > limits.downloadBytes)
    throw new Error(`Archive exceeds ${limits.downloadBytes} bytes`);
  const compressed = await readFile(archivePath);
  if (compressed[0] !== 0x1f || compressed[1] !== 0x8b)
    throw new Error("Only gzip-compressed tar archives are accepted");
  const tar = gunzipSync(compressed, { maxOutputLength: limits.expandedBytes });
  if (tar.length > limits.expandedBytes)
    throw new Error(`Expanded archive exceeds ${limits.expandedBytes} bytes`);
  if (await exists(destination))
    throw new Error(`Extraction destination already exists: ${destination}`);
  await mkdir(destination, { recursive: false });
  let offset = 0;
  let entries = 0;
  let totalBytes = 0;
  let archiveRoot;
  let nextPax = {};
  let longName;
  const outputs = new Set();
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const expectedChecksum = tarNumber(header, 148, 8);
    if (expectedChecksum !== tarChecksum(header))
      throw new Error("Tar header checksum mismatch");
    const size = tarNumber(header, 124, 12);
    if (!Number.isSafeInteger(size) || size < 0 || size > limits.fileBytes)
      throw new Error(`Tar entry has unsafe size: ${size}`);
    const type = String.fromCharCode(header[156] || 48);
    const prefix = tarString(header, 345, 155);
    let name =
      longName ??
      nextPax.path ??
      [prefix, tarString(header, 0, 100)].filter(Boolean).join("/");
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) throw new Error("Truncated tar entry");
    const data = tar.subarray(dataStart, dataEnd);
    offset = dataStart + Math.ceil(size / 512) * 512;
    entries += 1;
    if (entries > limits.entries)
      throw new Error(`Archive exceeds ${limits.entries} entries`);
    if (type === "x" || type === "g") {
      const pax = parsePax(data);
      if (type === "x") nextPax = pax;
      else if (pax.path || pax.linkpath)
        throw new Error("Global PAX paths are not accepted");
      continue;
    }
    if (type === "L") {
      longName = data.toString("utf8").replace(/\0+$/, "");
      continue;
    }
    if (type !== "0" && type !== "5")
      throw new Error(
        `Archive entry type ${JSON.stringify(type)} is not accepted`,
      );
    if (nextPax.linkpath) throw new Error("Archive links are not accepted");
    nextPax = {};
    longName = undefined;
    const stripped = stripArchiveRoot(name, archiveRoot);
    archiveRoot = stripped.root;
    if (!stripped.relative) continue;
    const collisionKey = stripped.relative
      .normalize("NFC")
      .toLocaleLowerCase("en-US");
    if (outputs.has(collisionKey))
      throw new Error(
        `Duplicate or case-colliding archive path: ${stripped.relative}`,
      );
    outputs.add(collisionKey);
    const target = containedPath(destination, stripped.relative);
    await assertNoSymlinkPath(destination, target);
    if (type === "5") await mkdir(target, { recursive: true });
    else {
      totalBytes += size;
      if (totalBytes > limits.expandedBytes)
        throw new Error(
          `Archive file contents exceed ${limits.expandedBytes} bytes`,
        );
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, data, { flag: "wx" });
    }
  }
  if (!archiveRoot || outputs.size === 0)
    throw new Error("Archive did not contain a rooted file tree");
  return {
    archiveRoot,
    entries,
    files: outputs.size,
    expandedBytes: totalBytes,
  };
}

export async function download(
  url,
  destination,
  allowedHosts,
  limit = LIMITS.downloadBytes,
) {
  const requested = new URL(url);
  if (
    requested.protocol !== "https:" ||
    !allowedHosts.includes(requested.hostname)
  )
    throw new Error(`Download URL is not approved: ${url}`);
  const response = await fetch(requested, {
    redirect: "follow",
    headers: { "user-agent": "ai-footprint-tracker-ecologits-maintenance/1" },
  });
  if (!response.ok || !response.body)
    throw new Error(
      `Download failed (${response.status}) for ${requested.origin}`,
    );
  const final = new URL(response.url);
  if (final.protocol !== "https:" || !allowedHosts.includes(final.hostname))
    throw new Error(
      `Download redirect left the approved hosts: ${final.origin}`,
    );
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit)
    throw new Error(`Download exceeds ${limit} bytes`);
  await mkdir(dirname(destination), { recursive: true });
  const handle = await open(destination, "wx");
  let received = 0;
  try {
    for await (const chunk of response.body) {
      received += chunk.length;
      if (received > limit) throw new Error(`Download exceeds ${limit} bytes`);
      await handle.write(chunk);
    }
    await handle.sync();
  } catch (error) {
    await handle.close();
    throw error;
  }
  await handle.close();
  return {
    requested_url: requested.href,
    resolved_url: final.href,
    bytes: received,
    sha256: await sha256File(destination),
  };
}

export async function copyArtifact(source, destination) {
  const sourceInfo = await lstat(source);
  if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink())
    throw new Error(`Artifact must be a regular file: ${source}`);
  if (sourceInfo.size > LIMITS.downloadBytes)
    throw new Error(`Artifact exceeds ${LIMITS.downloadBytes} bytes`);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination, 0);
  return {
    local_source: resolve(source),
    bytes: sourceInfo.size,
    sha256: await sha256File(destination),
  };
}

export async function ensureNewDirectory(path) {
  const destination = resolve(path);
  if (await exists(destination))
    throw new Error(`Directory already exists: ${destination}`);
  const lexicalParent = dirname(destination);
  const parsed = parse(lexicalParent);
  let current = parsed.root;
  for (const part of lexicalParent
    .slice(parsed.root.length)
    .split(sep)
    .filter(Boolean)) {
    current = join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink())
      throw new Error(`Symlink stage ancestor rejected: ${current}`);
  }
  const parent = await realpath(lexicalParent);
  const parentInfo = await lstat(parent);
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink())
    throw new Error(`Stage parent is unsafe: ${parent}`);
  await mkdir(destination, { recursive: false });
  return destination;
}

export async function fileRecord(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error(`Expected a regular file: ${path}`);
  return { bytes: info.size, sha256: await sha256File(path) };
}
