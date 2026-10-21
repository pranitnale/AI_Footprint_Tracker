import { checkCancelled, FILE_LIMITS, FileFailure, TextBudget } from "./types";

export async function extractPdf(
  bytes: Uint8Array,
  output: TextBudget,
  signal?: AbortSignal,
  workerSrc?: string,
): Promise<{ pages: number; externalFontMapping: boolean }> {
  const header = new TextDecoder("latin1").decode(bytes.subarray(0, 8));
  if (!header.startsWith("%PDF-")) throw new FileFailure("unsupported_file");
  const trailer = new TextDecoder("latin1").decode(
    bytes.subarray(Math.max(0, bytes.length - 1024)),
  );
  if (!/%%EOF\s*$/.test(trailer)) throw new FileFailure("truncated_file");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  checkCancelled(signal);
  const port = workerSrc ? new Worker(workerSrc, { type: "module" }) : null;
  const worker = port
    ? pdfjs.PDFWorker.create({ port, verbosity: 0 })
    : undefined;
  let externalFontMapping = false;
  class DenyExternalData {
    async fetch() {
      externalFontMapping = true;
      throw new Error("external_document_resources_disabled");
    }
  }
  const loading = pdfjs.getDocument({
    data: bytes,
    worker,
    verbosity: 0,
    stopAtErrors: true,
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    useWasm: false,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    maxImageSize: 0,
    disableAutoFetch: true,
    disableStream: true,
    disableRange: true,
    BinaryDataFactory: DenyExternalData,
  });
  const abort = () => {
    void loading.destroy().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const document = await loading.promise;
    checkCancelled(signal);
    if ((await document.getPermissions()) !== null)
      throw new FileFailure("encrypted_file");
    if (document.numPages > FILE_LIMITS.pages)
      throw new FileFailure("page_limit");
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      checkCancelled(signal);
      const page = await document.getPage(pageNumber);
      const reader = page
        .streamTextContent({ disableNormalization: true })
        .getReader();
      try {
        for (;;) {
          checkCancelled(signal);
          const { value, done } = await reader.read();
          if (done) break;
          for (const item of value.items)
            if ("str" in item) {
              output.append(item.str);
              if (item.hasEOL) output.append("\n");
            }
        }
      } finally {
        await reader.cancel().catch(() => {});
        page.cleanup();
      }
      output.append("\n");
    }
    if (!output.finish().trim()) throw new FileFailure("no_extractable_text");
    return { pages: document.numPages, externalFontMapping };
  } catch (error) {
    checkCancelled(signal);
    if (error instanceof FileFailure) throw error;
    if (
      error &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "PasswordException"
    )
      throw new FileFailure("encrypted_file");
    throw new FileFailure("malformed_file");
  } finally {
    signal?.removeEventListener("abort", abort);
    await loading.destroy().catch(() => {});
    worker?.destroy();
    port?.terminate();
  }
}
