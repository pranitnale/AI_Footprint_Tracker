import { Inflate } from "fflate";
import { SaxesParser } from "saxes";
import { checkCancelled, FILE_LIMITS, FileFailure, TextBudget } from "./types";

type Entry = {
  name: string;
  flags: number;
  method: number;
  crc: number;
  size: number;
  expanded: number;
  offset: number;
};
const crcTable = new Uint32Array(256).map((_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const decode = (bytes: Uint8Array) => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new FileFailure("invalid_utf8");
  }
};

export function entries(bytes: Uint8Array): Entry[] {
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf)
    throw new FileFailure("unsupported_file");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (
      view.getUint32(i, true) === 0x06054b50 &&
      i + 22 + view.getUint16(i + 20, true) === bytes.length
    ) {
      end = i;
      break;
    }
  if (end < 0) throw new FileFailure("truncated_file");
  const count = view.getUint16(end + 10, true),
    offset = view.getUint32(end + 16, true),
    directorySize = view.getUint32(end + 12, true);
  if (
    count > FILE_LIMITS.zipEntries ||
    count === 0xffff ||
    offset === 0xffffffff ||
    directorySize === 0xffffffff
  )
    throw new FileFailure("zip_limit");
  if (
    view.getUint16(end + 4, true) ||
    view.getUint16(end + 6, true) ||
    view.getUint16(end + 8, true) !== count ||
    offset + directorySize !== end
  )
    throw new FileFailure("unsupported_file");
  const result: Entry[] = [],
    names = new Set<string>();
  let position = offset,
    expandedTotal = 0;
  for (let i = 0; i < count; i++) {
    if (position + 46 > end || view.getUint32(position, true) !== 0x02014b50)
      throw new FileFailure("malformed_file");
    const length = view.getUint16(position + 28, true),
      extra = view.getUint16(position + 30, true),
      comment = view.getUint16(position + 32, true);
    if (position + 46 + length + extra + comment > end)
      throw new FileFailure("truncated_file");
    const entry: Entry = {
      name: decode(bytes.subarray(position + 46, position + 46 + length)),
      flags: view.getUint16(position + 8, true),
      method: view.getUint16(position + 10, true),
      crc: view.getUint32(position + 16, true),
      size: view.getUint32(position + 20, true),
      expanded: view.getUint32(position + 24, true),
      offset: view.getUint32(position + 42, true),
    };
    if (entry.flags & 1) throw new FileFailure("encrypted_file");
    if (![0, 8].includes(entry.method))
      throw new FileFailure("unsupported_file");
    if (
      !entry.name ||
      /[\\\x00-\x1f:]/.test(entry.name) ||
      entry.name.startsWith("/") ||
      entry.name.split("/").includes("..") ||
      names.has(entry.name)
    )
      throw new FileFailure("malformed_file");
    if (/vbaproject|vbaData|activex/i.test(entry.name))
      throw new FileFailure("macros_unsupported");
    names.add(entry.name);
    expandedTotal += entry.expanded;
    if (
      entry.expanded > FILE_LIMITS.zipEntryBytes ||
      expandedTotal > FILE_LIMITS.zipExpandedBytes ||
      entry.expanded > Math.max(1, entry.size) * FILE_LIMITS.zipRatio
    )
      throw new FileFailure("zip_limit");
    if (
      entry.offset + 30 > offset ||
      view.getUint32(entry.offset, true) !== 0x04034b50 ||
      view.getUint16(entry.offset + 6, true) !== entry.flags ||
      view.getUint16(entry.offset + 8, true) !== entry.method
    )
      throw new FileFailure("malformed_file");
    const localName = view.getUint16(entry.offset + 26, true),
      localExtra = view.getUint16(entry.offset + 28, true);
    if (
      decode(
        bytes.subarray(entry.offset + 30, entry.offset + 30 + localName),
      ) !== entry.name
    )
      throw new FileFailure("malformed_file");
    entry.offset += 30 + localName + localExtra;
    if (entry.offset + entry.size > offset)
      throw new FileFailure("truncated_file");
    result.push(entry);
    position += 46 + length + extra + comment;
  }
  if (position !== end) throw new FileFailure("malformed_file");
  return result;
}

export async function xml(
  bytes: Uint8Array,
  entry: Entry,
  signal?: AbortSignal,
): Promise<string> {
  let length = 0,
    crc = 0xffffffff;
  const decoder = new TextDecoder("utf-8", { fatal: true }),
    chunks: string[] = [];
  function consume(chunk: Uint8Array, final: boolean) {
    length += chunk.length;
    if (length > entry.expanded || length > FILE_LIMITS.zipEntryBytes)
      throw new FileFailure("zip_limit");
    for (const value of chunk)
      crc = (crc >>> 8) ^ crcTable[(crc ^ value) & 255];
    try {
      chunks.push(decoder.decode(chunk, { stream: !final }));
    } catch {
      throw new FileFailure("invalid_utf8");
    }
  }
  const compressed = bytes.subarray(entry.offset, entry.offset + entry.size);
  const inflater = entry.method === 8 ? new Inflate(consume) : null;
  for (let i = 0; i < compressed.length || i === 0; i += 1024) {
    checkCancelled(signal);
    const chunk = compressed.subarray(i, i + 1024),
      final = i + 1024 >= compressed.length;
    if (inflater) inflater.push(chunk, final);
    else consume(chunk, final);
    if (i % 32768 === 0)
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (length !== entry.expanded || (crc ^ 0xffffffff) >>> 0 !== entry.crc)
    throw new FileFailure("malformed_file");
  return chunks.join("");
}

export function parser() {
  const value = new SaxesParser({ xmlns: true, position: false });
  value.on("doctype", () => {
    throw new FileFailure("unsafe_xml");
  });
  value.on("error", () => {
    throw new FileFailure("malformed_file");
  });
  return value;
}
export async function extractDocx(
  bytes: Uint8Array,
  output: TextBudget,
  signal?: AbortSignal,
): Promise<number> {
  const inventory = entries(bytes),
    contentTypes = inventory.find(
      (entry) => entry.name === "[Content_Types].xml",
    );
  if (
    !contentTypes ||
    !inventory.some((entry) => entry.name === "word/document.xml")
  )
    throw new FileFailure("unsupported_file");
  let supported = false,
    typeDepth = 0;
  const types = parser();
  types.on("opentag", (node) => {
    if (++typeDepth > FILE_LIMITS.xmlDepth) throw new FileFailure("zip_limit");
    const type = node.attributes.ContentType?.value;
    if (type?.includes("macroEnabled"))
      throw new FileFailure("macros_unsupported");
    if (
      node.attributes.PartName?.value === "/word/document.xml" &&
      type ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
    )
      supported = true;
  });
  types.on("closetag", () => {
    typeDepth--;
  });
  types.write(await xml(bytes, contentTypes, signal)).close();
  if (!supported) throw new FileFailure("unsupported_file");
  const parts = inventory
    .filter((entry) =>
      /^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(
        entry.name,
      ),
    )
    .sort((a, b) =>
      a.name === "word/document.xml"
        ? -1
        : b.name === "word/document.xml"
          ? 1
          : a.name.localeCompare(b.name, "en"),
    );
  for (const entry of parts) {
    checkCancelled(signal);
    const text = await xml(bytes, entry, signal),
      sax = parser();
    let depth = 0,
      textDepth = 0,
      hiddenDepth = 0;
    const runs: Array<{ depth: number; hidden: boolean }> = [];
    sax.on("opentag", (node) => {
      if (++depth > FILE_LIMITS.xmlDepth) throw new FileFailure("zip_limit");
      const word = [
        "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
        "http://purl.oclc.org/ooxml/wordprocessingml/main",
      ].includes(node.uri);
      if (!word) return;
      if (node.local === "r") runs.push({ depth, hidden: false });
      if (node.local === "vanish" && runs.length) {
        const value = Object.values(node.attributes).find(
          (attribute) => attribute.local === "val",
        )?.value;
        if (!["0", "false", "off"].includes(value ?? "true"))
          runs[runs.length - 1].hidden = true;
      }
      if (["del", "moveFrom"].includes(node.local) && !hiddenDepth)
        hiddenDepth = depth;
      if (node.local === "t" && !hiddenDepth) textDepth = depth;
      if (
        ["tab", "br", "cr"].includes(node.local) &&
        !hiddenDepth &&
        !runs.at(-1)?.hidden
      )
        output.append(node.local === "tab" ? "\t" : "\n");
    });
    const captureText = (value: string) => {
      if (textDepth && !hiddenDepth && !runs.at(-1)?.hidden)
        output.append(value);
    };
    sax.on("text", captureText);
    sax.on("cdata", captureText);
    sax.on("closetag", (node) => {
      if (depth === textDepth) textDepth = 0;
      if (depth === hiddenDepth) hiddenDepth = 0;
      if (node.local === "p" && !hiddenDepth) output.append("\n");
      if (runs.at(-1)?.depth === depth) runs.pop();
      depth--;
    });
    for (let i = 0; i < text.length; i += 16384) {
      checkCancelled(signal);
      sax.write(text.slice(i, i + 16384));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    sax.close();
    output.append("\n");
  }
  return parts.length;
}
