# Local file text counting

This package extracts text from already accessible file bytes in a dedicated extension worker. It returns a private numeric result. It does not capture provider uploads, attach a result to a request, persist file data, or send file data to a server. The current provider capture gates A08, BA20 and IM13 remain open pending approved native fixtures and end-to-end association.

## Extraction profile

`local-file-text-utf8-pdfjs6.3.289-opc-v1` means text selected by the rules below. Its scope is `extracted_file_text`, not rendered visible text, provider OCR, retrieved context, request-total tokens or calibrated usage. Token counts use an explicitly selected packaged tokenizer implementation/profile and declare heuristic evidence and unverified model exactness. Omitting both selection fields preserves the bundled `gpt-tokenizer-4.0.0` and `o200k-base-4.0.0-reference` defaults. The result includes the tokenizer profile and asset hash.

| Kind       | Extracted data                                                                                                                     | Known omissions                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| UTF-8 text | Strict UTF-8 decoded text                                                                                                          | Other encodings are refused                                                                             |
| PDF        | PDF.js text items, in extraction order                                                                                             | Rendering, optional-content visibility, OCR, images and external font mappings                          |
| DOCX       | Main document and header/footer/footnote/endnote XML text parts; explicit hidden runs and deleted/moved-from revisions are omitted | Word style inheritance, layout and whether a header/footer is referenced or displayed                   |
| XLSX       | Worksheet inline/shared strings and cached cell values                                                                             | Formula execution, recalculation, formatting, date rendering, drawings and visible-sheet classification |
| PPTX       | Slide XML DrawingML text, ordered by numeric slide-part name                                                                       | Presentation relationship order, masters, notes, layout, drawings and rendered visibility               |

The result's `complete_for_extraction_profile` coverage only describes these extraction rules. Structured formats declare missing rendered visibility and layout classification. XLSX also declares missing formula recalculation. All formats declare provider processing, OCR, image encoding and retrieval selection as missing. Scanned image-only PDFs return `no_extractable_text` with null tokens. Empty plaintext may count as zero; unavailable extraction never does.

## Bounds and failure behavior

Each host accepts one active job without a queue. Input is limited to 25 MiB; extracted UTF-8 text to 8 MiB; PDF pages and slides to 200; worksheet parts to 64; cells to 50,000; XML depth to 128. ZIP limits are 512 entries, 32 MiB total declared expansion, 8 MiB per expanded entry and a 200:1 ratio. Central-directory bounds, local headers, names, compression methods, actual output lengths and CRCs are checked. ZIP64 and multi-disk archives are unsupported. A 30-second host deadline terminates the worker; cancellation and success also terminate it. PDF cleanup destroys the document and owned PDF subworker.

Limits produce fixed unavailable reason codes, never a successful truncated count. Invalid UTF-8, malformed/truncated input, encrypted ZIP/PDF, macros, DTD/entities and unsupported file formats are explicit failures. OLE compound Office containers are refused as `unsupported_file`: this includes both encrypted modern Office and legacy DOC/XLS/PPT, which this package does not attempt to distinguish or decrypt. No password prompt or password field exists. External document resources are not loaded, formulas/macros are not executed and no runtime parser code is downloaded. PDF.js 6.3.289 no longer exposes the former `isEvalSupported` option; the pinned source has no dynamic JavaScript evaluation path used for this extraction.

Byte/page/output limits and termination are enforced, but they are not a measured browser heap ceiling. A pathological PDF can allocate parser memory before text limits are reached. Native browser memory, responsiveness and transport behavior remain acceptance checks.

## Private worker and extension transport

`FileCountHost.count({jobId, revision, kind, bytes, tokenizerImplementationId?, tokenizerProfileId?}, signal)` creates a dedicated worker, clones the caller's `ArrayBuffer` before transfer and validates the numeric response. The two tokenizer selection fields must be supplied together or omitted together. Filenames, URLs, text and extra response fields are rejected. A stale job/revision/profile response is rejected. The worker has no ledger, database or company API integration. `countAccessibleFile` also accepts an injected `TokenizerImplementation` for focused tests and future packaged implementations; the job selection must match that implementation and one declared profile.

`new FileCountHost(workerFactory, countingRuntime)` snapshots a trusted `CountingRuntime` from `@footprint/tokenizers`. Omitted job selectors use that runtime's explicit selection; supplied selectors are retained and must validate against its manifest. The default constructor keeps the bundled behavior. Both text and file hosts validate the selected profile's actual asset, so the existing cl100k profile is not compared with the o200k asset. A worker factory must provide the matching compiled implementation; the host never adopts a manifest or executable code from its response.

Extension platform and broker construction carry the same immutable runtime. The broker assigns its trusted selection before execution, rejects conflicting selectors from the relay, and includes the selected IDs in its internal numerical receipt metadata. Receipt and uploaded-component validation retain the existing byte accounting, extraction shape, missing-coverage, scope and asset checks. Default values and extraction algorithms are unchanged; this is an implementation/validation boundary, not a tokenizer accuracy upgrade.

The concrete extension SDK is `apps/extension/lib/file-client.ts`:

```ts
const result = await countAccessibleBlob(
  alreadyAccessibleBlob,
  "pdf",
  abortSignal,
);
```

This API is for an extension-owned page holding an already accessible Blob. It accepts no filename or URL. The original Blob and host request remain intact. Chromium uses private service-worker/offscreen `MessageChannel` transfers; Firefox uses internal structured-clone messaging to its background worker host. Both handlers reject provider-page senders and require the extension's own origin. The offscreen receiver checks the service worker's exact script URL. Unavailable transport fails closed. No unrelated file picker was added.

Results have `association: "unassociated"` and `telemetryAllowed: false`. Raw input and extracted text exist only in transient local buffers/workers; they are never added to storage, logs, journal or API requests. JavaScript garbage collection does not guarantee physical memory zeroization.

Future capture integration must use an approved provider fixture to prove which accessible File/Blob belongs to the actual dispatch and how it relates to installation/era/request/revision identity. It must handle upload reuse, retries and overlap with text already counted. Attachment count alone is insufficient. Do not cast this private result into a contract 1.1 `new_input_text` measurement. A numeric schema and explicit scope review is required before any ledger or server transmission.

## Dependencies and verification

Pinned dependencies were checked against official npm metadata: [fflate 0.8.3](https://registry.npmjs.org/fflate/0.8.3), [Mozilla PDF.js 6.3.289](https://registry.npmjs.org/pdfjs-dist/6.3.289), and [saxes 6.0.0](https://registry.npmjs.org/saxes/6.0.0). Lockfile integrity pins the installed archives. Preserved licenses are in `LICENSES/`; saxes' ISC license comes from its npm-declared source commit `211fa0ebec9b628affc09219199639887174bfc3` because its npm archive omits the license file. PDF fonts, CMaps and WASM files are not copied into extension output.

The legacy PDF.js distribution embeds CoreJS 3.50.0 compatibility code. Its full [upstream MIT notice](https://github.com/zloirock/core-js/blob/v3.50.0/LICENSE) is also preserved and included by the deterministic browser notice hook.

Run `pnpm --filter @footprint/file-text typecheck`, `pnpm --filter @footprint/file-text test`, and `pnpm --filter @footprint/extension test`. Synthetic fixtures cover all five formats in actual Node dedicated workers, a real PDF child worker, cancellation, child lifetime, malformed input, encryption, scanned PDFs, ZIP amplification, hidden/deleted runs and numeric-only responses. Extension transport tests execute the actual client/platform/background/offscreen source using browser doubles and real message ports. They do not certify native Chrome, Edge or Firefox, and no provider traffic or uploads were performed for these tests.
