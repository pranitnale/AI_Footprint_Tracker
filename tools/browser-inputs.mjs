import { createHash } from "node:crypto";
import { readFile, readdir, lstat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const contractPath = fileURLToPath(
  new URL("./browser-artifact-inputs.json", import.meta.url),
);

export async function loadBrowserInputContract(path = contractPath) {
  const value = JSON.parse(await readFile(path, "utf8"));
  if (value?.schema_version !== "1.0.0" || value?.path_order !== "utf8_bytes")
    throw new Error("Unsupported browser input contract.");
  return value;
}

function compareUtf8Paths(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export async function browserInputFiles(root, contract) {
  const excludedParts = new Set(contract.excluded_parts);
  const excludedSuffixes = new Set(contract.excluded_suffixes);
  const selected = new Map();
  const addFixed = async (name) => {
    const path = resolve(root, name);
    const info = await lstat(path).catch(() => null);
    if (!info?.isFile() || info.isSymbolicLink())
      throw new Error(`Required browser source file is invalid: ${name}`);
    selected.set(name, path);
  };
  for (const name of contract.fixed_files) await addFixed(name);
  const visit = async (folder) => {
    const entries = await readdir(folder, { withFileTypes: true });
    for (const entry of entries) {
      const path = resolve(folder, entry.name);
      const name = relative(root, path).split(sep).join("/");
      const parts = name.split("/");
      if (parts.some((part) => excludedParts.has(part))) continue;
      const info = await lstat(path);
      if (info.isSymbolicLink())
        throw new Error(`Browser source symlink is not allowed: ${name}`);
      if (info.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!info.isFile()) continue;
      const suffix = entry.name.includes(".")
        ? `.${entry.name.split(".").at(-1).toLowerCase()}`
        : "";
      if (excludedSuffixes.has(suffix) || entry.name.startsWith(".env"))
        continue;
      selected.set(name, path);
    }
  };
  for (const rootName of contract.source_roots) {
    const folder = resolve(root, rootName);
    const info = await lstat(folder).catch(() => null);
    if (!info?.isDirectory() || info.isSymbolicLink())
      throw new Error(`Invalid browser source root: ${rootName}`);
    await visit(folder);
  }
  return [...selected]
    .sort(([left], [right]) => compareUtf8Paths(left, right))
    .map(([path, file]) => ({ path, file }));
}

export async function browserInputFingerprint(root, contract) {
  const records = [];
  for (const item of await browserInputFiles(root, contract)) {
    const data = await readFile(item.file);
    records.push({
      path: item.path,
      bytes: data.byteLength,
      sha256: createHash("sha256").update(data).digest("hex"),
    });
  }
  const encoded = JSON.stringify(records);
  return {
    algorithm: "sha256",
    files: records.length,
    sha256: createHash("sha256").update(encoded).digest("hex"),
  };
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const contract = await loadBrowserInputContract();
  process.stdout.write(
    `${JSON.stringify(await browserInputFingerprint(root, contract))}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
