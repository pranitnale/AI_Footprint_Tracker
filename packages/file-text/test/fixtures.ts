import { zipSync, strToU8 } from "fflate";
import type { AccessibleFileJob, FileKind } from "../src/types";

export function job(kind: FileKind, bytes: Uint8Array): AccessibleFileJob {
  return {
    jobId: crypto.randomUUID(),
    revision: 1,
    kind,
    bytes: bytes.slice().buffer as ArrayBuffer,
  };
}
export const text = (value: string) => new TextEncoder().encode(value);
export function docx(
  value: string,
  extra: Record<string, Uint8Array> = {},
  level: 0 | 9 = 0,
) {
  return zipSync(
    {
      "[Content_Types].xml": strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      "word/document.xml": strToU8(
        value.startsWith("<?xml") || value.startsWith("<!DOCTYPE")
          ? value
          : '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>' +
              value +
              "</w:t></w:r></w:p></w:body></w:document>",
      ),
      ...extra,
    },
    { level },
  );
}
export function pdf(
  value: string,
  pages = 1,
  encrypted = false,
  scanned = false,
): Uint8Array {
  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${4 + i} 0 R`).join(" ")}] /Count ${pages} >>`,
  );
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const streamId = 4 + pages;
  for (let i = 0; i < pages; i++)
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> ${scanned ? `/XObject << /Im0 ${streamId + 1} 0 R >>` : ""} >> /Contents ${streamId} 0 R >>`,
    );
  const content = scanned
    ? "q 1 0 0 1 0 0 cm /Im0 Do Q"
    : `BT /F1 12 Tf 72 720 Td (${value.replace(/[()\\]/g, "\\$&")}) Tj ET`;
  objects.push(
    `<< /Length ${text(content).length} >>\nstream\n${content}\nendstream`,
  );
  if (scanned)
    objects.push(
      "<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 1 >>\nstream\n\0\nendstream",
    );
  if (encrypted)
    objects.push(
      "<< /Filter /Standard /V 1 /R 2 /Length 40 /P -4 /O <" +
        "00".repeat(32) +
        "> /U <" +
        "00".repeat(32) +
        "> >>",
    );
  let source = "%PDF-1.7\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(text(source).length);
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = text(source).length;
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    source += `${String(offset).padStart(10, "0")} 00000 n \n`;
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${encrypted ? `/Encrypt ${objects.length} 0 R /ID [<${"00".repeat(16)}><${"00".repeat(16)}>]` : ""} >>\nstartxref\n${xref}\n%%EOF\n`;
  return text(source);
}

export function xlsx(value = "Sheet marker", cached = "42") {
  return zipSync(
    {
      "[Content_Types].xml": text(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
      ),
      "xl/workbook.xml": text(
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>',
      ),
      "xl/sharedStrings.xml": text(
        '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>' +
          value +
          "</t></si></sst>",
      ),
      "xl/worksheets/sheet1.xml": text(
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row><c t="s"><v>0</v></c><c><f>REMOTE_FUNCTION_NOT_EXECUTED()</f>' +
          (cached ? "<v>" + cached + "</v>" : "") +
          "</c></row></sheetData></worksheet>",
      ),
    },
    { level: 0 },
  );
}
export function pptx(value = "Slide marker", slides = 1) {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": text(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>',
    ),
    "ppt/presentation.xml": text(
      '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>',
    ),
  };
  for (let i = 1; i <= slides; i++)
    files[`ppt/slides/slide${i}.xml`] = text(
      '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:r><a:t>' +
        value +
        "</a:t></a:r></a:p></p:sld>",
    );
  return zipSync(files, { level: 0 });
}
