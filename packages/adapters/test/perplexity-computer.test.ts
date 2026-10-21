import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  keepFirstComputerFiles,
  parseHistoryText,
  perplexityComputerFiles,
  perplexityThreadRoute,
  PerplexitySession,
} from "../src";

// A Perplexity Computer task read with GET /rest/thread/<task id>, from the live capture of
// 14 Oct 2026 (fixtures/perplexity-computer-2026-10-14/README.md).
const TASK = "00000000-0000-4000-8000-000000000200";
const at = "2026-10-14T13:00:00.000Z";
const thread = () =>
  JSON.parse(
    readFileSync(
      new URL(
        "../../../fixtures/perplexity-computer-2026-10-14/computer-task-thread.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
const assetsOf = (page: any) =>
  page.entries[0].blocks.find(
    (block: any) => block.intended_usage === "unified_assets",
  ).unified_assets_block.assets;

test("Computer: a task at /computer/tasks/<id> is a Perplexity thread", () => {
  assert.equal(perplexityThreadRoute(`/computer/tasks/${TASK}`), TASK);
  assert.equal(perplexityThreadRoute(`/search/${TASK}`), TASK);
  for (const path of ["/computer", `/computer/${TASK}`, `/computer/tasks/${TASK}/x`])
    assert.equal(perplexityThreadRoute(path), null, path);
});

test("Computer: the captured task lists two text files, counted from their final assets", () => {
  const page = parseHistoryText("perplexity", thread(), TASK, at);
  assert.equal(page.status, "partial");
  assert.equal(page.firstRequestVerified, true);
  const [prompt, response] = page.messages;
  assert.equal(prompt!.role, "prompt");
  assert.equal(response!.role, "response");
  // The orchestrator the request ran on (B0: display_model).
  assert.equal(response!.modelId, "pplx_asi_opus");
  assert.equal(response!.text, "Synthetic answer: both files are ready to download.");
  assert.equal(response!.complete, true);
  assert.equal(response!.coverageReasons, undefined);
  // Previews (tool call ids, no size) are not files; the final assets are, once each. The
  // file's link never enters the message.
  assert.deepEqual(response!.computerFiles, [
    {
      id: "59efa555-57c3-4dea-872f-dd014dfb7e76",
      name: "footprint_test.py",
      bytes: 410,
      kind: "text",
      state: "unread",
    },
    {
      id: "84201612-5466-4e58-8cb9-dd2b764e4801",
      name: "notes.txt",
      bytes: 308,
      kind: "text",
      state: "unread",
    },
  ]);
  assert.doesNotMatch(JSON.stringify(page), /example\.invalid|signature/);
});

test("Computer: the reader takes each file's own https link and never builds one", () => {
  const page = thread();
  const assets = assetsOf(page);
  const { files, unknown } = perplexityComputerFiles(page.entries[0].blocks);
  assert.equal(unknown, false);
  assert.deepEqual(
    files.map((file) => [file.id, file.text, file.url]),
    [
      [
        "59efa555-57c3-4dea-872f-dd014dfb7e76",
        true,
        "https://files.example.invalid/footprint_test.py?signature=REDACTED",
      ],
      [
        "84201612-5466-4e58-8cb9-dd2b764e4801",
        true,
        "https://files.example.invalid/notes.txt?signature=REDACTED",
      ],
    ],
  );
  // Without the asset's link the download link of the same asset is used; a link that is
  // not https, or carries a user name, is no link at all.
  assets[2].code_file.url = "http://files.example.invalid/footprint_test.py";
  assets[3].code_file.url = "https://user:pass@files.example.invalid/notes.txt";
  assets[3].download_info[0].url = "javascript:alert(1)";
  const next = perplexityComputerFiles(page.entries[0].blocks).files;
  assert.equal(
    next[0]!.url,
    "https://files.example.invalid/footprint_test.py?signature=REDACTED-download",
  );
  assert.equal(next[1]!.url, null);
});

test("Computer: a file that is not text or code is named and not counted", () => {
  const page = thread();
  assetsOf(page).push(
    {
      uuid: "toolu_bdrk_chart",
      asset_type: "CODE_FILE",
      code_file: { name: "chart", filename: "chart.png", final: true },
      preview_info: [{ type: "image", media_type: "image/png", file_handle: "file:chart.png" }],
    },
    {
      uuid: "a1a1a1a1-0000-4000-8000-000000000001",
      root_asset_id: "a1a1a1a1-0000-4000-8000-000000000001",
      asset_type: "CODE_FILE",
      is_primary_asset: true,
      code_file: { name: "chart.png", filename: "chart.png", file_size: 52000, url: "https://files.example.invalid/chart.png" },
    },
    {
      uuid: "a1a1a1a1-0000-4000-8000-000000000002",
      root_asset_id: "a1a1a1a1-0000-4000-8000-000000000002",
      asset_type: "CODE_FILE",
      is_primary_asset: true,
      // No preview: the extension decides.
      code_file: { name: "report.pdf", filename: "report.pdf", file_size: 9000, url: "https://files.example.invalid/report.pdf" },
    },
    {
      uuid: "a1a1a1a1-0000-4000-8000-000000000003",
      root_asset_id: "a1a1a1a1-0000-4000-8000-000000000003",
      asset_type: "CODE_FILE",
      is_primary_asset: true,
      code_file: { name: "data.csv", filename: "data.csv", file_size: 120, url: "https://files.example.invalid/data.csv" },
    },
  );
  const response = parseHistoryText("perplexity", page, TASK, at).messages[1]!;
  assert.deepEqual(
    response.computerFiles!.map((file) => [file.name, file.kind, file.state]),
    [
      ["footprint_test.py", "text", "unread"],
      ["notes.txt", "text", "unread"],
      ["chart.png", "other", "other"],
      ["report.pdf", "other", "other"],
      ["data.csv", "text", "unread"],
    ],
  );
});

test("Computer: a file listed again, in the same reply or a later one, counts once", () => {
  const page = thread();
  const assets = assetsOf(page);
  // The same root asset listed twice in one reply.
  assets.push({ ...assets[3], uuid: "84201612-5466-4e58-8cb9-dd2b764e4899" });
  // A follow-up entry that lists the first reply's files again.
  const follow = structuredClone(page.entries[0]);
  follow.uuid = follow.frontend_uuid = "00000000-0000-4000-8000-000000000211";
  follow.backend_uuid = "00000000-0000-4000-8000-000000000212";
  follow.entry_created_datetime = "2026-10-14T12:58:40.000001+00:00";
  page.entries.push(follow);
  const messages = parseHistoryText("perplexity", page, TASK, at).messages;
  assert.equal(messages[1]!.computerFiles!.length, 2);
  assert.equal(messages[3]!.computerFiles, undefined);
  // The streamed reader reads one entry at a time and applies the same rule.
  const seen = new Set<string>();
  const first = parseHistoryText("perplexity", { status: "success", entries: [page.entries[0]] }, TASK, at).messages[1]!;
  const second = parseHistoryText("perplexity", { status: "success", entries: [follow] }, TASK, at).messages[1]!;
  keepFirstComputerFiles(first, seen);
  keepFirstComputerFiles(second, seen);
  assert.equal(first.computerFiles!.length, 2);
  assert.equal(second.computerFiles, undefined);
});

test("Computer: a finished file without a size makes the reply partial; one being written does not", () => {
  const page = thread();
  delete assetsOf(page)[3].code_file.file_size;
  delete assetsOf(page)[3].download_info;
  const response = parseHistoryText("perplexity", page, TASK, at).messages[1]!;
  assert.deepEqual(response.coverageReasons, ["unknown_event_observed"]);
  assert.equal(response.computerFiles!.length, 1);
  // The live stream reads the same blocks; a reply still running stays unmarked.
  const session = new PerplexitySession();
  const entry = page.entries[0];
  session.frame({
    event: "message",
    data: "",
    value: { ...entry, status: "PENDING", final: false, text_completed: false },
  } as any);
  assert.ok(!session.snapshot().limitations.includes("unknown_event_observed"));
  // Once the live reply finishes, the same file without a size makes it partial too.
  session.frame({
    event: "message",
    data: "",
    value: {
      ...entry,
      status: "COMPLETED",
      final: true,
      final_sse_message: true,
      text_completed: true,
    },
  } as any);
  assert.equal(session.snapshot().state, "completed");
  assert.ok(session.snapshot().limitations.includes("unknown_event_observed"));
});

test("Computer: a finished live task whose files all have a size is not partial", () => {
  const page = thread();
  const entry = page.entries[0];
  const session = new PerplexitySession();
  session.frame({
    event: "message",
    data: "",
    value: {
      ...entry,
      status: "COMPLETED",
      final: true,
      final_sse_message: true,
      text_completed: true,
    },
  } as any);
  const live = session.snapshot();
  assert.equal(live.state, "completed");
  assert.ok(!live.limitations.includes("unknown_event_observed"));
});
