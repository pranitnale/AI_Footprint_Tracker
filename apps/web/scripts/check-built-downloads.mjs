import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The web image runs this file on its own, next to a copy of the host-built website. It has no
// tools/, artifacts/ or node_modules there, so keep it limited to Node built-in imports.

const browsers = ["chrome", "edge", "firefox"];
const defaultDist = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");

export async function fileDigest(path) {
  const data = await readFile(path);
  return {
    bytes: data.byteLength,
    sha256: createHash("sha256").update(data).digest("hex"),
  };
}

export async function assertFileDigest(path, expected, label) {
  const info = await lstat(path).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink())
    throw new Error(`${label} is missing or unsafe.`);
  const actual = await fileDigest(path);
  if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256)
    throw new Error(`${label} does not match the release manifest.`);
}

/**
 * Checks a built website before it is served. The full release validation (artifacts, source
 * fingerprint and reconstruction proof) runs during `vite build`; this repeats the part that
 * can be checked from the website alone: each offered ZIP matches its manifest alias and
 * canonical package, and the downloads folder holds nothing else. Throws on any mismatch and
 * returns the public download path for each browser.
 */
export async function checkBuiltDownloads(dist = defaultDist) {
  const index = await lstat(resolve(dist, "index.html")).catch(() => null);
  if (!index?.isFile() || index.isSymbolicLink())
    throw new Error(
      `The built website is missing at ${dist}. Run pnpm --filter @footprint/web build first.`,
    );
  const folder = resolve(dist, "downloads");
  const manifestPath = resolve(folder, "manifest.json");
  const info = await lstat(manifestPath).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink())
    throw new Error(
      "The built website has no verified browser release manifest. Run pnpm --filter @footprint/web build after packaging and source verification.",
    );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const allowed = new Set(["manifest.json"]);
  const entries = {};
  for (const browser of browsers) {
    const name = `ai-footprint-tracker-${browser}.zip`;
    const alias = manifest?.aliases?.[browser];
    const selected = manifest?.packages?.[alias?.variant_id];
    if (
      alias?.path !== `/downloads/${name}` ||
      selected?.browser !== browser ||
      selected.bytes !== alias.bytes ||
      selected.sha256 !== alias.sha256
    )
      throw new Error(
        `The built ${browser} download is not bound to a release package.`,
      );
    await assertFileDigest(
      resolve(folder, name),
      alias,
      `Built ${browser} download`,
    );
    allowed.add(name);
    entries[browser] = alias.path;
  }
  const extra = (await readdir(folder)).filter((name) => !allowed.has(name));
  if (extra.length > 0)
    throw new Error(
      `The built website offers files outside the release manifest: ${extra.join(", ")}.`,
    );
  return entries;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await checkBuiltDownloads(process.argv[2] ? resolve(process.argv[2]) : defaultDist);
  console.log("Built browser downloads match the release manifest.");
}
