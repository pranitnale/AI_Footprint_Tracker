import type { SaxesTagNS } from "saxes";
import { entries, xml, parser } from "./docx";
import { checkCancelled, FILE_LIMITS, FileFailure, TextBudget } from "./types";

async function walk(
  text: string,
  handlers: {
    open?(node: SaxesTagNS): void;
    text?(value: string): void;
    close?(node: SaxesTagNS): void;
  },
  signal?: AbortSignal,
) {
  const sax = parser();
  let depth = 0;
  sax.on("opentag", (node) => {
    if (++depth > FILE_LIMITS.xmlDepth) throw new FileFailure("zip_limit");
    handlers.open?.(node);
  });
  sax.on("text", (value) => handlers.text?.(value));
  sax.on("cdata", (value) => handlers.text?.(value));
  sax.on("closetag", (node) => {
    handlers.close?.(node);
    depth--;
  });
  for (let i = 0; i < text.length; i += 16384) {
    checkCancelled(signal);
    sax.write(text.slice(i, i + 16384));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  sax.close();
}

export async function extractOffice(
  bytes: Uint8Array,
  kind: "xlsx" | "pptx",
  output: TextBudget,
  signal?: AbortSignal,
): Promise<number> {
  const inventory = entries(bytes),
    types = inventory.find((entry) => entry.name === "[Content_Types].xml");
  const root = kind === "xlsx" ? "xl/workbook.xml" : "ppt/presentation.xml";
  if (!types || !inventory.some((entry) => entry.name === root))
    throw new FileFailure("unsupported_file");
  const expected =
    kind === "xlsx"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"
      : "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml";
  let supported = false;
  await walk(
    await xml(bytes, types, signal),
    {
      open(node) {
        const type = node.attributes.ContentType?.value;
        if (type?.includes("macroEnabled"))
          throw new FileFailure("macros_unsupported");
        if (node.attributes.PartName?.value === "/" + root && type === expected)
          supported = true;
      },
    },
    signal,
  );
  if (!supported) throw new FileFailure("unsupported_file");
  if (kind === "pptx") {
    const slides = inventory
      .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
    if (!slides.length) throw new FileFailure("no_extractable_text");
    if (slides.length > FILE_LIMITS.pages) throw new FileFailure("page_limit");
    for (const slide of slides) {
      let isText = false;
      await walk(
        await xml(bytes, slide, signal),
        {
          open(node) {
            isText =
              node.local === "t" &&
              [
                "http://schemas.openxmlformats.org/drawingml/2006/main",
                "http://purl.oclc.org/ooxml/drawingml/main",
              ].includes(node.uri);
          },
          text(value) {
            if (isText) output.append(value);
          },
          close(node) {
            if (node.local === "t") isText = false;
            if (node.local === "p") output.append("\n");
          },
        },
        signal,
      );
      output.append("\n");
    }
    return slides.length;
  }
  const strings: string[] = [],
    shared = inventory.find((entry) => entry.name === "xl/sharedStrings.xml");
  if (shared) {
    let value = "",
      isText = false,
      phonetic = false;
    await walk(
      await xml(bytes, shared, signal),
      {
        open(node) {
          if (node.local === "si") value = "";
          if (node.local === "rPh") phonetic = true;
          if (node.local === "t") isText = true;
        },
        text(text) {
          if (isText && !phonetic) value += text;
        },
        close(node) {
          if (node.local === "t") isText = false;
          if (node.local === "rPh") phonetic = false;
          if (node.local === "si") {
            if (strings.length >= FILE_LIMITS.cells)
              throw new FileFailure("zip_limit");
            strings.push(value);
          }
        },
      },
      signal,
    );
  }
  const sheets = inventory
    .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  if (!sheets.length) throw new FileFailure("no_extractable_text");
  if (sheets.length > FILE_LIMITS.sheets) throw new FileFailure("page_limit");
  let cells = 0;
  for (const sheet of sheets) {
    let inCell = false,
      reading = false,
      type = "",
      value = "";
    await walk(
      await xml(bytes, sheet, signal),
      {
        open(node) {
          if (node.local === "c") {
            if (++cells > FILE_LIMITS.cells) throw new FileFailure("zip_limit");
            inCell = true;
            type = node.attributes.t?.value ?? "n";
            value = "";
          }
          if (
            inCell &&
            (node.local === "v" || (type === "inlineStr" && node.local === "t"))
          )
            reading = true;
        },
        text(text) {
          if (reading) value += text;
        },
        close(node) {
          if (node.local === "v" || node.local === "t") reading = false;
          if (node.local === "c") {
            if (type === "s") {
              if (
                !/^[0-9]{1,6}$/.test(value) ||
                Number(value) >= strings.length
              )
                throw new FileFailure("malformed_file");
              value = strings[Number(value)];
            }
            output.append(value + "\t");
            inCell = false;
          }
          if (node.local === "row") output.append("\n");
        },
      },
      signal,
    );
    output.append("\n");
  }
  return sheets.length;
}
