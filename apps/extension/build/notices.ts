import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  mkdirSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

function packageFile(from: string, name: string): string {
  for (let current = from; ; current = dirname(current)) {
    const candidate = join(
      current,
      "node_modules",
      ...name.split("/"),
      "package.json",
    );
    if (existsSync(candidate)) return realpathSync(candidate);
    if (dirname(current) === current)
      throw new Error(`Missing dependency for notices: ${name}`);
  }
}
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

const SOURCE_EXCLUDED_PARTS = new Set([
  ".git",
  ".output",
  ".test-runtime",
  ".venv",
  "__pycache__",
  "artifacts",
  "cassettes",
  "images",
  "node_modules",
  "output",
  "private",
  "screenshots",
]);

function sourceFiles(root: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const fixed = [
    "LICENSE",
    "THIRD-PARTY-INVENTORY.json",
    "THIRD-PARTY-NOTICES.md",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.base.json",
    "config/README.md",
    "config/estimation.build.json",
    "config/estimation.mappings.json",
    "apps/extension/build/notices.ts",
    "apps/extension/build/release-metadata.ts",
    "apps/extension/build/variant.ts",
    "apps/extension/lib/estimation/config.ts",
    "apps/extension/wxt.config.ts",
  ];
  const addFile = (relativePath: string) => {
    const source = resolve(root, relativePath);
    const info = lstatSync(source);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error(`Invalid corresponding source file: ${relativePath}`);
    files.set(relativePath.replaceAll("\\", "/"), readFileSync(source));
  };
  const visit = (relativeDirectory: string) => {
    const directory = resolve(root, relativeDirectory);
    const info = lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error(
        `Invalid corresponding source directory: ${relativeDirectory}`,
      );
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (SOURCE_EXCLUDED_PARTS.has(entry.name)) continue;
      const relativePath = `${relativeDirectory}/${entry.name}`.replaceAll(
        "\\",
        "/",
      );
      const path = join(directory, entry.name);
      const child = lstatSync(path);
      if (child.isSymbolicLink())
        throw new Error(
          `Corresponding source contains a link: ${relativePath}`,
        );
      if (child.isDirectory()) visit(relativePath);
      else if (
        child.isFile() &&
        !entry.name.startsWith(".env") &&
        !/\.(?:db|log|pyc|sqlite3?)$/i.test(entry.name)
      )
        addFile(relativePath);
      else if (!child.isFile())
        throw new Error(
          `Unsupported corresponding source entry: ${relativePath}`,
        );
    }
  };
  for (const path of fixed) addFile(path);
  visit("packages/ecologits-core");
  visit("tools/ecologits");
  const identity = JSON.parse(
    readFileSync(
      join(root, "packages/ecologits-core/data/identity.json"),
      "utf8",
    ),
  );
  files.set(
    "ECOLOGITS-SOURCE-README.md",
    Buffer.from(
      [
        "# Corresponding EcoLogits source",
        "",
        `EcoLogits upstream version: ${identity.upstream_version}`,
        `TypeScript core version: ${identity.core_version}`,
        `TypeScript core SHA256: ${identity.core_sha256}`,
        `Catalog SHA256: ${identity.catalog_sha256}`,
        "",
        "This archive contains the preferred form for modifying the included EcoLogits-derived TypeScript files, the accepted retained upstream source and data, the lock and source map, tests, oracle metadata, maintenance tooling, MPL-2.0 text, notices and citation metadata.",
        "",
        "AI Footprint Tracker files outside the MPL-covered component retain their separately stated terms. This archive and its notices do not imply upstream endorsement or provide legal advice.",
        "",
      ].join("\n"),
    ),
  );
  return files;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1)
    value = (value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1) >>> 0;
  return value;
});

function crc32(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes)
    value = crcTable[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function zipTimestamp(): { date: number; time: number } {
  const epoch = Number(process.env.SOURCE_DATE_EPOCH ?? "1788998400");
  if (!Number.isSafeInteger(epoch))
    throw new Error("Invalid SOURCE_DATE_EPOCH");
  const value = new Date(Math.max(epoch, 315532800) * 1000);
  const year = Math.min(2107, Math.max(1980, value.getUTCFullYear()));
  return {
    date:
      ((year - 1980) << 9) |
      ((value.getUTCMonth() + 1) << 5) |
      value.getUTCDate(),
    time:
      (value.getUTCHours() << 11) |
      (value.getUTCMinutes() << 5) |
      Math.floor(value.getUTCSeconds() / 2),
  };
}

function deterministicZip(entries: Map<string, Buffer>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  const timestamp = zipTimestamp();
  const ordered = [...entries].sort(([left], [right]) =>
    Buffer.compare(Buffer.from(left), Buffer.from(right)),
  );
  for (const [name, bytes] of ordered) {
    if (
      name.includes("\\") ||
      name.startsWith("/") ||
      name.split("/").includes("..")
    )
      throw new Error(`Invalid ZIP source path: ${name}`);
    const encodedName = Buffer.from(name);
    const checksum = crc32(bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(timestamp.time, 10);
    local.writeUInt16LE(timestamp.date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(encodedName.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(timestamp.time, 12);
    central.writeUInt16LE(timestamp.date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(encodedName.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    localParts.push(local, encodedName, bytes);
    centralParts.push(central, encodedName);
    offset += local.length + encodedName.length + bytes.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(ordered.length, 8);
  end.writeUInt16LE(ordered.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function html(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function upstreamNoticeNames(folder: string): string[] {
  return readdirSync(folder).filter(
    (name) =>
      /^(licen[cs]e|copying|notice)([._-].*)?$/i.test(name) &&
      statSync(join(folder, name)).isFile(),
  );
}

/** Build-time files only. The same hook runs in a clean extracted source checkout. */
export function writeBrowserNotices(root: string, output?: string) {
  const files = new Map<string, Buffer>();
  const components: Array<{
    name: string;
    version: string;
    license: string;
    notices: string[];
  }> = [];
  const seen = new Set<string>();
  function add(path: string, source: string) {
    const bytes = readFileSync(source);
    if (files.has(path) && !files.get(path)!.equals(bytes))
      throw new Error("Conflicting notices");
    files.set(path, bytes);
  }
  function visit(manifestPath: string, traverseDependencies = true) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const key = `${manifest.name}@${manifest.version}`;
    if (seen.has(key)) return;
    seen.add(key);
    const base = dirname(manifestPath);
    if (!manifest.name.startsWith("@footprint/")) {
      const notices: string[] = [];
      const destinations = [base];
      if (manifest.name === "pdfjs-dist")
        destinations.push(
          ...["wasm", "cmaps", "standard_fonts", "iccs"].map((name) =>
            join(base, name),
          ),
        );
      for (const folder of destinations) {
        for (const name of upstreamNoticeNames(folder)) {
          const path = `licenses/${key.replaceAll("/", "__")}/${relative(base, join(folder, name)).replaceAll("\\", "/")}`;
          add(path, join(folder, name));
          notices.push(path);
        }
      }
      if (manifest.name === "saxes" && manifest.version === "6.0.0") {
        const path = `licenses/${key}/LICENSE`;
        add(path, join(root, "packages/file-text/LICENSES/saxes-ISC.txt"));
        notices.push(path);
      }
      const runtimeNotices: Record<string, { version: string; file: string }> =
        {
          wxt: { version: "0.21.4", file: "wxt-MIT.txt" },
          "@wxt-dev/browser": {
            version: "0.1.43",
            file: "wxt-browser-MIT.txt",
          },
        };
      const preserved = runtimeNotices[manifest.name];
      if (preserved) {
        if (manifest.version !== preserved.version)
          throw new Error(`Runtime notice provenance needs review: ${key}`);
        const path = `licenses/${key.replaceAll("/", "__")}/LICENSE`;
        add(path, join(root, "apps/extension/LICENSES", preserved.file));
        notices.push(path);
      }
      if (!notices.length)
        throw new Error(`Full upstream notice missing: ${key}`);
      components.push({
        name: manifest.name,
        version: manifest.version,
        license: manifest.license ?? "NOASSERTION",
        notices: notices.sort(),
      });
    }
    // Optional Node canvas binaries are not bundled into the browser's text-only PDF path.
    if (traverseDependencies)
      for (const name of Object.keys(manifest.dependencies ?? {}).sort())
        visit(packageFile(base, name));
  }
  visit(join(root, "apps/extension/package.json"));
  // WXT's injected production context helpers ship despite WXT being a dev dependency.
  // Its build tools and @wxt-dev/browser's type-only dependencies do not ship.
  const wxtManifest = packageFile(join(root, "apps/extension"), "wxt");
  visit(wxtManifest, false);
  visit(packageFile(dirname(wxtManifest), "@wxt-dev/browser"), false);
  // WXT's Vite also writes code into the chunks: its dynamic-import preload helper ("Unable to
  // preload CSS", "vite:preloadError"). Its full LICENSE.md ships with it.
  visit(packageFile(dirname(wxtManifest), "vite"), false);
  components.push({
    name: "core-js",
    version: "3.50.0",
    license: "MIT",
    notices: ["licenses/preserved/file-text/core-js-MIT.txt"],
  });
  const ecologitsIdentity = JSON.parse(
    readFileSync(
      join(root, "packages/ecologits-core/data/identity.json"),
      "utf8",
    ),
  );
  const ecologitsLock = JSON.parse(
    readFileSync(
      join(root, "packages/ecologits-core/upstream/lock.json"),
      "utf8",
    ),
  );
  const ecologitsNotices = [
    ["licenses/ecologits/MPL-2.0.txt", "packages/ecologits-core/LICENSE"],
    ["licenses/ecologits/NOTICE.md", "packages/ecologits-core/NOTICE.md"],
    ["licenses/ecologits/CITATION.cff", "packages/ecologits-core/CITATION.cff"],
    [
      "licenses/ecologits/SOURCE-DISTRIBUTION.md",
      "packages/ecologits-core/SOURCE-DISTRIBUTION.md",
    ],
    [
      "licenses/ecologits/retained-source.json",
      "packages/ecologits-core/upstream/retained-source.json",
    ],
    [
      "licenses/ecologits/source-to-port-map.json",
      "packages/ecologits-core/source-to-port-map.json",
    ],
    [
      "licenses/ecologits/lock.json",
      "packages/ecologits-core/upstream/lock.json",
    ],
  ] as const;
  for (const [destination, source] of ecologitsNotices)
    add(destination, join(root, source));
  components.push({
    name: "EcoLogits independent TypeScript port",
    version: ecologitsIdentity.core_version,
    license: "MPL-2.0",
    notices: ecologitsNotices.map(([path]) => path),
  });
  const correspondingSource = deterministicZip(sourceFiles(root));
  files.set("source/ecologits-source.zip", correspondingSource);
  const sourceHash = hash(correspondingSource);
  const licensePage = Buffer.from(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <title>Licenses and source</title>
  <style>body{font:16px/1.55 system-ui,sans-serif;max-width:760px;margin:0 auto;padding:32px;color:#203524;background:#f7f9f2}a{color:#285f35}code{overflow-wrap:anywhere}.notice{padding:12px 16px;background:#e1eedb;border-left:4px solid #3d7542}</style>
</head>
<body>
  <h1>Licenses and source</h1>
  <p class="notice">This page records the software included in this extension. It is not legal advice. AI Footprint Tracker is not affiliated with or endorsed by OpenAI, Anthropic, Google, Perplexity, EcoLogits or CodeCarbon.</p>
  <h2>EcoLogits port</h2>
  <p>This extension includes an independent TypeScript port of EcoLogits ${html(ecologitsIdentity.upstream_version)}. The port core is ${html(ecologitsIdentity.core_version)} with catalog SHA-256 <code>${html(ecologitsIdentity.catalog_sha256)}</code>.</p>
  <p>EcoLogits is developed by its contributors and is part of CodeCarbon. The EcoLogits-derived files and corresponding modifications are provided under MPL-2.0.</p>
  <ul>
    <li><a href="licenses/ecologits/MPL-2.0.txt">MPL-2.0 license</a></li>
    <li><a href="licenses/ecologits/NOTICE.md">EcoLogits notices and source information</a></li>
    <li><a href="licenses/ecologits/CITATION.cff">Software and scholarly citation metadata</a></li>
    <li><a href="source/ecologits-source.zip" download>Corresponding EcoLogits source</a> (SHA-256 <code>${sourceHash}</code>)</li>
  </ul>
  <p>Requested scholarly citation: Samuel Rincé and Adrien Banse (2025), <cite>EcoLogits: Evaluating the Environmental Impacts of Generative AI</cite>, Journal of Open Source Software 10(111), 7471, DOI 10.21105/joss.07471.</p>
  <p>The EcoLogits methodology documentation is licensed under CC BY-SA 4.0; this extension cites it and does not relicense it. Data bundled through EcoLogits, including Our World in Data electricity figures under CC BY 4.0, is credited in the third-party notices.</p>
  <h2>Other software</h2>
  <p><a href="THIRD-PARTY-NOTICES.md">Third-party notices</a> and the <a href="licenses/inventory.json">machine-readable license inventory</a> list the other included components.</p>
  <p>Source artifact SHA-256: <code>${html(ecologitsLock.source_artifact.sha256)}</code>. Retained-source manifest SHA-256: <code>${html(ecologitsLock.retained_source_manifest_sha256)}</code>.</p>
</body>
</html>
`);
  files.set("licenses.html", licensePage);
  add("LICENSE", join(root, "LICENSE"));
  add("THIRD-PARTY-NOTICES.md", join(root, "THIRD-PARTY-NOTICES.md"));
  add(
    "licenses/runtime-source-provenance.md",
    join(root, "apps/extension/LICENSES/README.md"),
  );
  for (const folder of readdirSync(join(root, "packages"), {
    withFileTypes: true,
  })) {
    const source = join(root, "packages", folder.name, "LICENSES");
    if (!folder.isDirectory() || !existsSync(source)) continue;
    for (const file of readdirSync(source, { withFileTypes: true })) {
      if (file.isFile())
        add(
          `licenses/preserved/${folder.name}/${file.name}`,
          join(source, file.name),
        );
    }
  }
  const inventory = {
    format_version: 1,
    ecologits: {
      upstream_version: ecologitsIdentity.upstream_version,
      core_version: ecologitsIdentity.core_version,
      core_sha256: ecologitsIdentity.core_sha256,
      catalog_sha256: ecologitsIdentity.catalog_sha256,
      source_artifact_sha256: ecologitsIdentity.source_artifact_sha256,
      retained_source_manifest_sha256:
        ecologitsLock.retained_source_manifest_sha256,
      corresponding_source: {
        path: "source/ecologits-source.zip",
        bytes: correspondingSource.length,
        sha256: sourceHash,
      },
      license_page: {
        path: "licenses.html",
        bytes: licensePage.length,
        sha256: hash(licensePage),
      },
    },
    components: components.sort((a, b) =>
      Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)),
    ),
    files: [...files]
      .sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
      .map(([path, bytes]) => ({
        path,
        bytes: bytes.length,
        sha256: hash(bytes),
      })),
    optional_node_dependencies:
      "Not included in this browser notice graph; not bundled for file text extraction",
  };
  files.set(
    "licenses/inventory.json",
    Buffer.from(JSON.stringify(inventory, null, 2) + "\n"),
  );
  if (!output) return inventory;
  for (const [path, bytes] of files) {
    const destination = resolve(output, path);
    if (
      !destination.startsWith(resolve(output) + "/") &&
      !destination.startsWith(resolve(output) + "\\")
    )
      throw new Error("Invalid notice path");
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, bytes);
  }
  return inventory;
}
