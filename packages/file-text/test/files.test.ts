import assert from "node:assert/strict";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import { countText } from "@footprint/tokenizers";
import {
  countAccessibleFile,
  FILE_LIMITS,
  type FileCountResult,
} from "../src/index";
import { FileCountHost, type FileWorkerPort } from "../src/host";
import { docx, job, pdf, text, xlsx, pptx } from "./fixtures";

test("UTF8 and DOCX text produce scoped, unassociated numeric counts without private text", async () => {
  const marker = "PrivateMarker Grüße e\u0301 東京 👨‍👩‍👧‍👦";
  for (const [kind, bytes, expected] of [
    ["text", text(marker), marker],
    ["docx", docx(marker), marker + "\n\n"],
  ] as const) {
    const input = job(kind, bytes),
      result = await countAccessibleFile(input);
    const reference = await countText({
      text: expected,
      modelId: null,
      jobId: input.jobId,
      revision: 1,
    });
    assert.equal(result.status, "counted");
    assert.equal(result.tokens, reference.measurement.value);
    assert.equal(result.scope, "extracted_file_text");
    assert.equal(result.evidence, "heuristic_estimate");
    assert.equal(result.association, "unassociated");
    assert.equal(result.telemetryAllowed, false);
    assert.equal(JSON.stringify(result).includes("PrivateMarker"), false);
  }
});

test("PDF text, page budget, encrypted and truncated PDFs fail or count explicitly", async () => {
  const input = job("pdf", pdf("Local PDF marker"));
  const result = await countAccessibleFile(input);
  assert.equal(result.status, "counted", JSON.stringify(result));
  assert.equal(result.pages, 1);
  assert.ok(result.inputBytes > 0);
  assert.equal(JSON.stringify(result).includes("Local PDF marker"), false);
  assert.equal(
    (await countAccessibleFile(job("pdf", pdf("Page", FILE_LIMITS.pages + 1))))
      .reason,
    "page_limit",
  );
  assert.equal(
    (await countAccessibleFile(job("pdf", pdf("Locked", 1, true)))).reason,
    "encrypted_file",
  );
  assert.equal(
    (await countAccessibleFile(job("pdf", pdf("Cut").slice(0, -12)))).reason,
    "truncated_file",
  );
  assert.equal(
    (await countAccessibleFile(job("pdf", pdf("")))).reason,
    "no_extractable_text",
  );
  const scanned = await countAccessibleFile(
    job("pdf", pdf("", 1, false, true)),
  );
  assert.equal(scanned.reason, "no_extractable_text");
  assert.equal(scanned.tokens, null);
  assert.ok(scanned.missing.includes("ocr"));
});

test("Malformed UTF8, input/text limits, unsupported office and active content stay unavailable", async () => {
  assert.equal(
    (await countAccessibleFile(job("text", new Uint8Array([0xc3, 0x28]))))
      .reason,
    "invalid_utf8",
  );
  await assert.rejects(
    countAccessibleFile(
      job("text", new Uint8Array(FILE_LIMITS.inputBytes + 1)),
    ),
    /input_limit/,
  );
  assert.equal(
    (
      await countAccessibleFile(
        job("text", text("x".repeat(FILE_LIMITS.textBytes + 1))),
      )
    ).reason,
    "text_limit",
  );
  assert.equal(
    (
      await countAccessibleFile(
        job("docx", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])),
      )
    ).reason,
    "unsupported_file",
  );
  assert.equal(
    (
      await countAccessibleFile(
        job("docx", docx("Visible", { "word/vbaProject.bin": text("macro") })),
      )
    ).reason,
    "macros_unsupported",
  );
  const entity =
    '<!DOCTYPE a [<!ENTITY secret SYSTEM "https://invalid.example/private">]><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>&secret;</w:t></w:r></w:p></w:body></w:document>';
  assert.equal(
    (await countAccessibleFile(job("docx", docx(entity)))).reason,
    "unsafe_xml",
  );
});

test("ZIP amplification, false size, CRC corruption and encryption are refused before success", async () => {
  assert.equal(
    (await countAccessibleFile(job("docx", docx("a".repeat(1_000_000), {}, 9))))
      .reason,
    "zip_limit",
  );
  const truncated = docx("text").slice(0, -10);
  assert.equal(
    (await countAccessibleFile(job("docx", truncated))).reason,
    "truncated_file",
  );
  const falseSize = docx("size mismatch"),
    falseView = new DataView(falseSize.buffer);
  const falseCentral = Buffer.from(falseSize).indexOf(
    Buffer.from([0x50, 0x4b, 0x01, 0x02]),
  );
  falseView.setUint32(falseCentral + 24, 1, true);
  assert.equal(
    (await countAccessibleFile(job("docx", falseSize))).reason,
    "zip_limit",
  );
  const corrupted = docx("UniqueMarker");
  const at = Buffer.from(corrupted).indexOf("UniqueMarker");
  corrupted[at] ^= 1;
  assert.equal(
    (await countAccessibleFile(job("docx", corrupted))).reason,
    "malformed_file",
  );
  for (const [kind, encrypted] of [
    ["docx", docx("text")],
    ["xlsx", xlsx("text")],
    ["pptx", pptx("text")],
  ] as const) {
    const view = new DataView(encrypted.buffer);
    const central = Buffer.from(encrypted).indexOf(
      Buffer.from([0x50, 0x4b, 0x01, 0x02]),
    );
    view.setUint16(central + 8, view.getUint16(central + 8, true) | 1, true);
    assert.equal(
      (await countAccessibleFile(job(kind, encrypted))).reason,
      "encrypted_file",
    );
  }
  const deep = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${"<w:p>".repeat(FILE_LIMITS.xmlDepth)}<w:r><w:t>text</w:t></w:r>${"</w:p>".repeat(FILE_LIMITS.xmlDepth)}</w:document>`;
  assert.equal(
    (await countAccessibleFile(job("docx", docx(deep)))).reason,
    "zip_limit",
  );
});

test("Cancellation and unknown input fields cannot silently produce attributed counts", async () => {
  const input = job("text", text("x".repeat(100_000))),
    abort = new AbortController();
  const pending = countAccessibleFile(input, { signal: abort.signal });
  abort.abort();
  const result = await pending;
  assert.equal(result.status, "cancelled");
  assert.equal(result.tokens, null);
  await assert.rejects(
    countAccessibleFile({
      ...job("text", text("private")),
      filename: "private.txt",
    } as any),
    /invalid_job/,
  );
});

test("Actual dedicated worker API counts accessible bytes, blocks network and preserves caller buffer", async () => {
  let usedThread = 0,
    networkCalls = -1;
  let children = 0,
    terminated = 0;
  const host = new FileCountHost(() => {
    const worker = new Worker(new URL("./node-worker.mjs", import.meta.url), {
      workerData: { nestedPDF: true },
    });
    const adapter: FileWorkerPort = {
      onmessage: null,
      onerror: null,
      postMessage: (input, transfer) =>
        worker.postMessage(input, transfer as ArrayBuffer[]),
      terminate: () => {
        void worker.terminate();
      },
    };
    worker.on("message", (payload) => {
      usedThread = payload.threadId;
      networkCalls = payload.networkCalls;
      children = payload.children;
      terminated = payload.terminated;
      adapter.onmessage?.({
        data: payload.result,
      } as MessageEvent<FileCountResult>);
    });
    worker.on("error", () => adapter.onerror?.({} as ErrorEvent));
    return adapter;
  });
  for (const [kind, bytes] of [
    ["text", text("WorkerPrivateMarker")],
    ["pdf", pdf("WorkerPrivateMarker")],
    ["docx", docx("WorkerPrivateMarker")],
    ["xlsx", xlsx("WorkerPrivateMarker")],
    ["pptx", pptx("WorkerPrivateMarker")],
  ] as const) {
    const input = job(kind, bytes),
      length = input.bytes.byteLength;
    const pending = host.count(input);
    assert.equal((await host.count(job("text", text("busy")))).reason, "busy");
    const result = await pending;
    assert.equal(result.status, "counted", JSON.stringify(result));
    assert.ok(usedThread > 0);
    assert.equal(networkCalls, 0);
    assert.equal(children, kind === "pdf" ? 1 : 0);
    assert.equal(terminated, children);
    assert.equal(input.bytes.byteLength, length);
    assert.equal(JSON.stringify(result).includes("WorkerPrivateMarker"), false);
  }
});

test("Terminating the file worker also stops its active PDF subworker", async () => {
  const heartbeat = new SharedArrayBuffer(4),
    counter = new Int32Array(heartbeat);
  const worker = new Worker(new URL("./node-worker.mjs", import.meta.url), {
    workerData: { nestedPDF: true, heartbeat },
  });
  try {
    worker.postMessage(job("pdf", pdf("Child heartbeat", 50)));
    // Starting two workers took over 2.5 s on a busy test host (15 October 2026), so the wait has a
    // deadline instead of a short loop count.
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && Atomics.load(counter, 0) === 0)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.ok(Atomics.load(counter, 0) > 0, "PDF subworker started");
    await worker.terminate();
    const stopped = Atomics.load(counter, 0);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(Atomics.load(counter, 0), stopped);
  } finally {
    // A failed assertion must not leave the workers running: the test run then never ends.
    await worker.terminate();
  }
});

test("XLSX cached text and PPTX slide text remain distinct from formula execution and rendered visibility", async () => {
  for (const [kind, bytes, expected] of [
    ["xlsx", xlsx("Cell text"), "Cell text\t42\t\n\n"],
    ["pptx", pptx("Slide text"), "Slide text\n\n"],
  ] as const) {
    const input = job(kind, bytes),
      result = await countAccessibleFile(input);
    const reference = await countText({
      text: expected,
      modelId: null,
      jobId: input.jobId,
      revision: 1,
    });
    assert.equal(result.status, "counted", JSON.stringify(result));
    assert.equal(result.tokens, reference.measurement.value);
    assert.ok(result.missing.includes("rendered_visibility"));
    if (kind === "xlsx")
      assert.ok(result.missing.includes("formula_recalculation"));
    assert.equal(JSON.stringify(result).includes("REMOTE_FUNCTION"), false);
  }
  assert.equal(
    (
      await countAccessibleFile(
        job("pptx", pptx("Slide", FILE_LIMITS.pages + 1)),
      )
    ).reason,
    "page_limit",
  );
  for (const kind of ["docx", "xlsx", "pptx"] as const)
    assert.equal(
      (
        await countAccessibleFile(
          job(kind, new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])),
        )
      ).reason,
      "unsupported_file",
    );
});

test("DOCX deleted and explicitly hidden runs are excluded without claiming complete rendering", async () => {
  const source =
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>Hidden marker</w:t></w:r><w:del><w:r><w:delText>Deleted marker</w:delText></w:r></w:del><w:r><w:t>Kept</w:t></w:r></w:p></w:body></w:document>';
  const input = job("docx", docx(source)),
    result = await countAccessibleFile(input);
  const reference = await countText({
    text: "Kept\n\n",
    modelId: null,
    jobId: input.jobId,
    revision: 1,
  });
  assert.equal(result.tokens, reference.measurement.value);
  assert.ok(result.missing.includes("rendered_visibility"));
});

test("DOCX hidden runs omit tabs and breaks as well as hidden text", async () => {
  const source =
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:rPr><w:vanish/></w:rPr><w:tab/><w:br/><w:cr/></w:r><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>';
  const input = job("docx", docx(source));
  const result = await countAccessibleFile(input);
  const reference = await countText({
    text: "HelloHello\n\n",
    modelId: null,
    jobId: input.jobId,
    revision: input.revision,
  });
  assert.equal(reference.measurement.value, "3");
  assert.equal(result.tokens, reference.measurement.value);
  assert.equal(
    result.extractedTextBytes,
    new TextEncoder().encode("HelloHello\n\n").byteLength,
  );
  assert.equal(result.status, "counted");
});

test("DOCX, XLSX and PPTX preserve mixed and all-CDATA text through the normal extraction scope", async () => {
  for (const [content, expected] of [
    ["Hello <![CDATA[beautiful]]> world", "Hello beautiful world"],
    ["<![CDATA[beautiful]]>", "beautiful"],
  ]) {
    for (const [kind, bytes, suffix] of [
      ["docx", docx(content), "\n\n"],
      ["xlsx", xlsx(content), "\t42\t\n\n"],
      ["pptx", pptx(content), "\n\n"],
    ] as const) {
      const input = job(kind, bytes);
      const actual = await countAccessibleFile(input);
      const reference = await countText({
        text: expected + suffix,
        modelId: null,
        jobId: input.jobId,
        revision: input.revision,
      });
      assert.equal(actual.status, "counted", `${kind}: ${actual.reason}`);
      assert.equal(actual.tokens, reference.measurement.value, kind);
      assert.equal(
        actual.extractedTextBytes,
        new TextEncoder().encode(expected + suffix).byteLength,
        kind,
      );
      assert.equal(JSON.stringify(actual).includes("beautiful"), false);
    }
  }
  const hidden =
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t><![CDATA[HiddenMarker]]></w:t></w:r><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>';
  const actual = await countAccessibleFile(job("docx", docx(hidden)));
  assert.equal(
    actual.extractedTextBytes,
    new TextEncoder().encode("Hello\n\n").byteLength,
  );
});

test("Host cancellation terminates the dedicated worker and stale/raw responses are rejected", async () => {
  let terminated = false,
    port!: FileWorkerPort;
  const host = new FileCountHost(
    () =>
      (port = {
        onmessage: null,
        onerror: null,
        postMessage() {},
        terminate() {
          terminated = true;
        },
      }),
  );
  const input = job("text", text("not persistent")),
    abort = new AbortController();
  const pending = host.count(input, abort.signal);
  abort.abort();
  assert.equal((await pending).reason, "cancelled");
  assert.equal(terminated, true);
  const next = host.count(input);
  port.onmessage?.({
    data: { jobId: input.jobId, revision: 1, text: "must not escape" },
  } as any);
  assert.equal((await next).reason, "worker_unavailable");
});

test("Host timeout ends work and permits a fresh job", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let terminated = 0;
  const host = new FileCountHost(() => ({
    onmessage: null,
    onerror: null,
    postMessage() {},
    terminate() {
      terminated++;
    },
  }));
  const input = job("text", text("timeout fixture"));
  const first = host.count(input);
  context.mock.timers.tick(FILE_LIMITS.timeoutMs);
  assert.equal((await first).reason, "timeout");
  assert.equal(terminated, 1);
  const second = host.count(input);
  host.cancel(input.jobId);
  assert.equal((await second).reason, "cancelled");
  assert.equal(terminated, 2);
});
