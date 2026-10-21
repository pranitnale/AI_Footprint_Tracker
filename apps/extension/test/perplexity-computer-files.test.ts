import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import { Ledger } from "@footprint/ledger";
import { selectPartMeasurement } from "@footprint/contracts";
import type { CountRequest } from "@footprint/tokenizers";
import { Coordinator } from "../lib/coordinator";
import { createHistoryTextObserver } from "../lib/passive-history-text";
import { createThreadHistoryObserver } from "../lib/passive-thread-history";
import { historyRequestConversation } from "../lib/history-route";
import { validComputerFilesAnswer } from "../lib/provider-history-message";
import { ownReadConversation } from "../lib/own-read";
import {
  COMPUTER_FILE_BYTES,
  createOwnReadPage,
  type ComputerFileDownload,
} from "../lib/own-read-page";
import {
  computerFileLines,
  noteComputerFiles,
  savedComputerFiles,
} from "../lib/computer-file-details";
import { parseHistoryText, type ComputerFileRow } from "@footprint/adapters";
import {
  COMPUTER_FILE_LIMIT_BYTES,
  countHistoryPage,
  validHistoryTextPage,
} from "../lib/history-capture";
import { coverageNotes } from "../lib/estimate-details";
import { countByTextLength } from "./counting-fixture";

// Perplexity Computer files (owner decision of 14 Oct 2026): text and code files count with
// the tokenizer on their content, downloaded read-only from the asset's own link once; a file
// that cannot be downloaded counts as its size in bytes divided by 4.
const TASK = "00000000-0000-4000-8000-000000000200";
const REPLY = "00000000-0000-4000-8000-000000000201";
const ORIGIN = "https://www.perplexity.ai";
const PATH = `/computer/tasks/${TASK}`;
const PY = "59efa555-57c3-4dea-872f-dd014dfb7e76";
const NOTES = "84201612-5466-4e58-8cb9-dd2b764e4801";
const PY_LINK = "https://files.example.invalid/footprint_test.py?signature=REDACTED";
const NOTES_LINK = "https://files.example.invalid/notes.txt?signature=REDACTED";
const BODY = readFileSync(
  new URL(
    "../../../fixtures/perplexity-computer-2026-10-14/computer-task-thread.json",
    import.meta.url,
  ),
  "utf8",
);
// File text of exactly the asset's size; the test counter counts characters.
const PY_TEXT = "for n in range(1, 11):\n    print(n, n * n)\n".padEnd(410, "#");
const NOTES_TEXT = "Wind and solar power are renewable.".padEnd(308, " ");

async function setup(t: TestContext) {
  Object.assign(globalThis, {
    location: {
      origin: ORIGIN,
      hostname: "www.perplexity.ai",
      pathname: PATH,
      href: ORIGIN + PATH,
    },
  });
  let counts = 0;
  const db = await Ledger.open(`computer-files-${crypto.randomUUID()}`);
  const coordinator = new Coordinator(db, {
    count: async (job: CountRequest) => {
      counts++;
      return countByTextLength(job);
    },
    hasConsent: async () => true,
    hasSiteConsent: async () => true,
    sendDisplay: async () => {},
    transport: async () => {
      throw new Error("unexpected network");
    },
  });
  t.after(() => {
    coordinator.history.invalidate();
    coordinator.engines.dispose();
    db.close();
  });
  await coordinator.whenReady();
  const binding = {
    documentNonce: crypto.randomUUID(),
    navigationNonce: crypto.randomUUID(),
    captureId: null,
  };
  const sender = {
    tab: { id: 811 },
    frameId: 0,
    documentId: "synthetic-computer-files",
    url: ORIGIN + PATH,
  };
  const downloads: string[] = [];
  /** One read of the task as the page or the tracker's own read makes it. */
  const read = async (
    download: (link: string) => ComputerFileDownload,
    body = BODY,
  ) => {
    let started: Promise<unknown> = Promise.resolve();
    let finish!: (accepted: boolean) => void;
    const finished = new Promise<boolean>((resolve) => (finish = resolve));
    const rows: any[] = [];
    const observer = createHistoryTextObserver(
      (event) => {
        if (event.event === "start")
          started = coordinator.history.receive(event, binding, sender);
      },
      () => {},
      async (event) => {
        await started;
        const result = await coordinator.history.receiveStream(event, binding, sender);
        if (event.event === "batch") rows.push(...event.rows);
        if (event.event === "finish") finish(result.accepted);
        return result.accepted;
      },
      undefined,
      undefined,
      {
        known: async (message) => {
          await started;
          const result: any = await coordinator.history.receiveStream(
            message,
            binding,
            sender,
          );
          return result.accepted && validComputerFilesAnswer(result.known)
            ? new Map(result.known.map((item: any) => [item.id, item.counted]))
            : null;
        },
        download: async (link) => {
          downloads.push(link);
          return download(link);
        },
      },
    );
    const before = counts;
    try {
      observer.observe(
        new URL(`${ORIGIN}/rest/thread/${TASK}`),
        "GET",
        Promise.resolve(new Response(body)),
        Date.now(),
      );
      // A read the history service refuses never finishes; fail instead of waiting forever.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const outcome = await Promise.race([
        finished,
        new Promise<string>((resolve) => {
          timer = setTimeout(() => resolve("not finished"), 20_000);
        }),
      ]);
      clearTimeout(timer);
      assert.equal(outcome, true);
    } finally {
      observer.cancel();
    }
    await coordinator.engines.maintainLocal();
    return { counted: counts - before, rows };
  };
  const reply = async () =>
    (await db.all<any>("history_records")).find(
      (row) => row.record.role === "response",
    );
  return { coordinator, binding, read, reply, downloads };
}

const content = (link: string): ComputerFileDownload =>
  link === PY_LINK
    ? { kind: "text", text: PY_TEXT }
    : link === NOTES_LINK
      ? { kind: "text", text: NOTES_TEXT }
      : { kind: "failed" };

test("Computer files: a task's own read is a Perplexity thread read", () => {
  assert.equal(ownReadConversation("perplexity", PATH), TASK);
});

test("Computer files: the task's side chat is never read or counted as the task", async (t) => {
  // Live finding of 14 Oct 2026: on a full load the page reads the task through GraphQL and
  // its side chat with /rest/thread/computer_side_chats/<other id>, /rest/thread/<other
  // id>/entry-metadata and, at times, /rest/thread/<other id>, whose JSON names the task
  // and its files. None of them is the task's thread read.
  const f = await setup(t);
  const SIDE = "00000000-0000-4000-8000-000000000300";
  for (const path of [
    `/rest/thread/computer_side_chats/${SIDE}`,
    `/rest/thread/${SIDE}/entry-metadata`,
  ])
    assert.equal(
      historyRequestConversation("perplexity", new URL(ORIGIN + path), "GET"),
      null,
      path,
    );
  assert.equal(
    historyRequestConversation(
      "perplexity",
      new URL(`${ORIGIN}/rest/perplexity_ask/graphql`),
      "POST",
      "{}",
    ),
    null,
  );
  const threads: unknown[] = [];
  const thread = createThreadHistoryObserver((message) => threads.push(message));
  assert.equal(
    thread.start(`${ORIGIN}/rest/thread/computer_side_chats/${SIDE}`, { method: "GET" }),
    null,
  );
  thread.cancel();
  // The side chat's own thread read at the task's address imports nothing.
  const events: any[] = [];
  const observer = createHistoryTextObserver(
    (event) => events.push(event),
    () => {},
    async (event) => {
      events.push(event);
      return false;
    },
    undefined,
    undefined,
    {
      known: async () => {
        throw new Error("the side chat asks about no file");
      },
      download: async () => {
        throw new Error("the side chat downloads no file");
      },
    },
  );
  try {
    observer.observe(
      new URL(`${ORIGIN}/rest/thread/${SIDE}`),
      "GET",
      Promise.resolve(new Response(BODY.replaceAll(TASK, SIDE))),
      Date.now(),
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.deepEqual(events, []);
  } finally {
    observer.cancel();
  }
  assert.equal(await f.reply(), undefined);
  assert.deepEqual(f.downloads, []);
});

test("Computer files: both captured files count from their content as the orchestrator's output", async (t) => {
  const f = await setup(t);
  const { rows } = await f.read(content);
  // Only the links the assets gave, each once.
  assert.deepEqual(f.downloads, [PY_LINK, NOTES_LINK]);
  // The rows that left the page world carry the files' text for counting, never a link.
  assert.doesNotMatch(JSON.stringify(rows), /example\.invalid|signature/);
  const row = await f.reply();
  assert.equal(row.record.model_id, "perplexity-claude-opus-5-5");
  // Tool input: no queries (0) plus 410 and 308 counted characters.
  assert.equal(row.record.parts.tool_input.value, "718");
  assert.equal(row.record.parts.tool_input.completeness, "complete_for_scope");
  assert.ok(!row.record.coverage_reasons.includes("file_size_estimated"));
  const files = row.countBasis.computerFiles;
  assert.deepEqual(
    Object.values(files).map((file: any) => [file.tokens, file.basis]).sort(),
    [["308", "content"], ["410", "content"]],
  );
  // Stored only under keyed hashes, without ids, names or text.
  assert.ok(Object.keys(files).every((key) => /^[0-9a-f]{64}$/.test(key)));
  const stored = JSON.stringify(row);
  for (const value of [PY, NOTES, "footprint_test.py", "notes.txt", "Wind and solar"])
    assert.ok(!stored.includes(value), value);
});

test("Computer files: a reread neither downloads nor counts a file again", async (t) => {
  const f = await setup(t);
  await f.read(content);
  const first = await f.reply();
  const again = await f.read(() => {
    throw new Error("a counted file is not downloaded again");
  });
  assert.equal(f.downloads.length, 2);
  assert.equal(again.counted, 0, "the saved count is reused whole");
  assert.deepEqual(
    again.rows[1].message.computerFiles.map((file: any) => [file.state, "text" in file]),
    [["content", false], ["content", false]],
  );
  const second = await f.reply();
  assert.equal(second.record.parts.tool_input.value, "718");
  assert.deepEqual(second.record, first.record, "the same file counts once");
});

test("Computer files: a refused download (403) counts by size and is not tried again", async (t) => {
  const f = await setup(t);
  await f.read((link) => (link === NOTES_LINK ? { kind: "failed" } : content(link)));
  const row = await f.reply();
  // 410 counted plus 308 / 4 = 77 from the size.
  assert.equal(row.record.parts.tool_input.value, "487");
  assert.ok(row.record.coverage_reasons.includes("file_size_estimated"));
  assert.deepEqual(
    Object.values(row.countBasis.computerFiles).map((file: any) => file.basis).sort(),
    ["content", "size"],
  );
  await f.read(() => {
    throw new Error("not downloaded again");
  });
  assert.equal(f.downloads.length, 2);
  const again = await f.reply();
  assert.equal(again.record.parts.tool_input.value, "487");
  assert.ok(again.record.coverage_reasons.includes("file_size_estimated"));
  // A reopened task still says how its files were counted, from the saved count basis.
  const view = await f.coordinator.history.view(
    { namespace: again.namespace, mode: "personal", era: again.era } as any,
    again.record.conversation_key,
  );
  assert.deepEqual(view.computer_files, { content: 1, size: 1 });
});

test("Computer files: a reopened task's Details say how its saved files were counted", async (t) => {
  // Live finding of 14 Oct 2026: after an in-app navigation and reloads, Details never said
  // "Files created", because the names live only in this navigation's reads.
  const f = await setup(t);
  await f.read(content);
  const row = await f.reply();
  const view = await f.coordinator.history.view(
    { namespace: row.namespace, mode: "personal", era: row.era } as any,
    row.record.conversation_key,
  );
  assert.deepEqual(view.computer_files, { content: 2, size: 0 });
  const saved = savedComputerFiles(view.computer_files);
  assert.deepEqual(computerFileLines(new Map(), saved), [
    "Files created: 2 (counted from their content).",
  ]);
  assert.deepEqual(computerFileLines(new Map(), { content: 0, size: 3 }), [
    "Estimated from their size, because they could not be downloaded: 3 files. Each counts as its size in bytes divided by 4.",
  ]);
  // Names from this navigation's reads take precedence over the saved counts.
  const facts = new Map();
  noteComputerFiles(facts, [
    {
      computerFiles: [
        { id: "a", name: "footprint_test.py", bytes: 410, kind: "text", state: "content" },
      ],
    },
  ]);
  assert.deepEqual(computerFileLines(facts, saved), [
    "Files created: 1 (counted from their content): footprint_test.py.",
  ]);
  // A view without files, or a malformed value, adds no line.
  for (const value of [
    undefined,
    null,
    { content: 0, size: 0 },
    { content: -1, size: 0 },
    { content: "2", size: 0 },
  ])
    assert.equal(savedComputerFiles(value), null);
  assert.deepEqual(computerFileLines(new Map(), null), []);
});

test("Computer files: a file too large to carry counts by size without a download", async (t) => {
  const f = await setup(t);
  const page = JSON.parse(BODY);
  const assets = page.entries[0].blocks.find(
    (block: any) => block.intended_usage === "unified_assets",
  ).unified_assets_block.assets;
  // Larger than the room left in the reply's message (HISTORY_LIMITS.textUnits).
  assets[3].code_file.file_size = 5 * 1048576;
  assets[3].download_info[0].size = 5 * 1048576;
  await f.read(content, JSON.stringify(page));
  assert.deepEqual(f.downloads, [PY_LINK]);
  const row = await f.reply();
  assert.equal(row.record.parts.tool_input.value, String(410 + 5 * 262144));
});

test("Computer files: a file held back (hidden tab, a pause) is not counted until a later read", async (t) => {
  const f = await setup(t);
  await f.read(() => ({ kind: "held" }));
  // The first download was held, so the second was not tried.
  assert.deepEqual(f.downloads, [PY_LINK]);
  const held = await f.reply();
  assert.equal(held.record.parts.tool_input.value, "0");
  assert.equal(held.record.parts.tool_input.completeness, "partial");
  assert.equal(held.countBasis?.computerFiles, undefined);
  await f.read(content);
  assert.deepEqual(f.downloads, [PY_LINK, PY_LINK, NOTES_LINK]);
  const row = await f.reply();
  assert.equal(row.record.parts.tool_input.value, "718");
  assert.equal(row.record.parts.tool_input.completeness, "complete_for_scope");
});

test("Computer files: a reply linked to its live copy counts its files once, from the saved copy", async (t) => {
  const f = await setup(t);
  await f.read(content);
  const row = await f.reply();
  // The live reply's tool input held no files (no queries: 0). The saved copy, measured the
  // same way and larger, replaces that part; it is never added beside it.
  const live = { ...row.record.parts.tool_input, value: "0" };
  assert.equal(
    selectPartMeasurement(live, row.record, "tool_input").value,
    "718",
  );
});

test("Computer files: Details names counted, estimated, unread and uncounted files", () => {
  const facts = new Map();
  noteComputerFiles(facts, [
    {
      computerFiles: [
        { id: "a", name: "footprint_test.py", bytes: 410, kind: "text", state: "content" },
        { id: "b", name: "notes.txt", bytes: 308, kind: "text", state: "content" },
        { id: "c", name: "data.csv", bytes: 120, kind: "text", state: "size" },
        { id: "d", name: "chart.png", bytes: 52000, kind: "other", state: "other" },
      ],
    },
  ]);
  assert.deepEqual(computerFileLines(facts), [
    "Files created: 2 (counted from their content): footprint_test.py, notes.txt.",
    "Estimated from their size, because they could not be downloaded: data.csv. Each counts as its size in bytes divided by 4.",
    "1 file not counted, because only text and code files are: chart.png.",
  ]);
  for (const line of computerFileLines(facts)) assert.doesNotMatch(line, /—/);
  // The general note replaces "not counted" (commits aab10c7 and 1ac9fded).
  const notes = coverageNotes("perplexity", {}, ["main"]).join(" ");
  assert.match(notes, /Text and code files Perplexity Computer creates count from their content/);
  assert.doesNotMatch(notes, /so they are not counted\.$|shown only with their size/);
  assert.match(
    coverageNotes("perplexity", { file_size_estimated: 1 }, ["main"]).join(" "),
    /could not be downloaded, so each counts as its size in bytes divided by 4/,
  );
});

// The page world supplies each file's stated size, and page scripts can reach it, so the
// trusted side bounds what a size or a saved count may add (security review, 14 Oct 2026).
const AT = "2026-10-14T12:00:00.000Z";
/** The task's saved reply as the page world hands it over, with its files changed. */
function taskPage(change: (files: ComputerFileRow[]) => void) {
  const page = parseHistoryText("perplexity", JSON.parse(BODY), TASK, AT)!;
  change(page.messages[1]!.computerFiles!);
  return page;
}

test("Computer files: a stated size past the limit is not counted, never clamped", async () => {
  for (const bytes of [2 ** 40, COMPUTER_FILE_LIMIT_BYTES + 1]) {
    const page = taskPage((files) => {
      files[0]!.state = "size";
      files[0]!.bytes = bytes;
      files[1]!.state = "size";
    });
    assert.equal(validHistoryTextPage(page), true);
    const reply = (await countHistoryPage(page, countByTextLength)).messages[1]!;
    // Only notes.txt counts: 308 / 4 = 77. The reply stays partly measured.
    assert.equal(reply.partTokens.tool_input!.value, "77", String(bytes));
    assert.equal(reply.partTokens.tool_input!.completeness, "partial");
    assert.equal(reply.computerFileTokens, undefined, "nothing is saved for reuse");
  }
});

test("Computer files: one reply's files together stay within the limit", async () => {
  const page = taskPage((files) => {
    files[0]!.state = "size";
    files[0]!.bytes = COMPUTER_FILE_LIMIT_BYTES;
    files[1]!.state = "size";
  });
  const reply = (await countHistoryPage(page, countByTextLength)).messages[1]!;
  // A file of exactly the limit counts; the next one would pass it and is left out.
  assert.equal(reply.partTokens.tool_input!.value, String(COMPUTER_FILE_LIMIT_BYTES / 4));
  assert.equal(reply.partTokens.tool_input!.completeness, "partial");
});

test("Computer files: a saved count past the limit is not added again", async () => {
  const page = taskPage((files) => {
    for (const file of files) file.state = "size";
  });
  const saved = new Map([[PY, { tokens: "100000000", basis: "size" as const }]]);
  const reply = (
    await countHistoryPage(page, countByTextLength, { computerFiles: [undefined, saved] })
  ).messages[1]!;
  assert.equal(reply.partTokens.tool_input!.value, "77");
  assert.equal(reply.partTokens.tool_input!.completeness, "partial");
});

test("Computer files: the page world cannot hand over a count, only text to count", async () => {
  const page = taskPage((files) => {
    files[0]!.state = "content";
    files[0]!.text = PY_TEXT;
    (files[0] as any).tokens = "999999999";
  });
  assert.equal(validHistoryTextPage(page), false);
  const counted = taskPage((files) => {
    files[0]!.state = "content";
    files[0]!.text = PY_TEXT;
    files[1]!.state = "size";
  });
  const reply = (await countHistoryPage(counted, countByTextLength)).messages[1]!;
  // Counted here from the text (410), plus 77 by size.
  assert.equal(reply.partTokens.tool_input!.value, "487");
});

test("Computer files: a file with a forged size is named in Details and the reply is partial", async (t) => {
  const f = await setup(t);
  const page = JSON.parse(BODY);
  const assets = page.entries[0].blocks.find(
    (block: any) => block.intended_usage === "unified_assets",
  ).unified_assets_block.assets;
  assets[3].code_file.file_size = 2 ** 40;
  assets[3].download_info[0].size = 2 ** 40;
  const { rows } = await f.read(content, JSON.stringify(page));
  assert.deepEqual(f.downloads, [PY_LINK]);
  const row = await f.reply();
  assert.equal(row.record.parts.tool_input.value, "410");
  assert.equal(row.record.parts.tool_input.completeness, "partial");
  assert.equal(row.countBasis?.computerFiles, undefined);
  const facts = new Map();
  noteComputerFiles(facts, rows.map((item) => item.message));
  assert.deepEqual(computerFileLines(facts), [
    "Files created: 1 (counted from their content): footprint_test.py.",
    "Not counted, because the page states a size past the tracker's limit of 32 MiB per file and per reply: notes.txt. The reply shows as partly measured.",
  ]);
});

/** The page world's download with a stubbed browser fetch. */
function filePage(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let visible = true;
  const page = createOwnReadPage({
    provider: { site: "perplexity", run: async () => ({ kind: "read" }) },
    origin: ORIGIN,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return respond(url, init);
    },
    observe: () => {},
    readConversation: () => null,
    pathname: () => PATH,
    visible: () => visible,
    whenVisible: () => () => {},
    enabled: () => true,
  });
  return {
    page,
    calls,
    hide: () => {
      visible = false;
    },
  };
}

test("Computer files: a download reads the file without cookies and checks its size", async () => {
  const f = filePage(() => new Response(PY_TEXT, { headers: { "content-type": "text/x-python" } }));
  assert.deepEqual(await f.page.fetchFile(PY_LINK, 410), { kind: "text", text: PY_TEXT });
  assert.equal(f.calls[0]!.url, PY_LINK);
  assert.equal(f.calls[0]!.init.credentials, "omit");
  assert.equal(f.calls[0]!.init.method, "GET");
  // Another length is not the file the asset describes.
  assert.deepEqual(await f.page.fetchFile(PY_LINK, 409), { kind: "failed" });
});

test("Computer files: a 403, a network error or text that is not UTF-8 counts by size", async () => {
  const forbidden = filePage(() => new Response("expired", { status: 403 }));
  assert.deepEqual(await forbidden.page.fetchFile(PY_LINK, 410), { kind: "failed" });
  const offline = filePage(() => Promise.reject(new TypeError("Failed to fetch")));
  assert.deepEqual(await offline.page.fetchFile(PY_LINK, 410), { kind: "failed" });
  const binary = filePage(() => new Response(new Uint8Array([0xff, 0xfe, 0xfd])));
  assert.deepEqual(await binary.page.fetchFile(PY_LINK, 3), { kind: "failed" });
});

test("Computer files: an oversized file is refused before or while it downloads", async () => {
  const declared = filePage(() => new Response("x"));
  assert.deepEqual(
    await declared.page.fetchFile(PY_LINK, COMPUTER_FILE_BYTES + 1),
    { kind: "failed" },
  );
  assert.equal(declared.calls.length, 0, "a declared size past the limit is not downloaded");
  // A body longer than the limit stops at the limit, whatever the asset said.
  const body = filePage(() => new Response("y".repeat(COMPUTER_FILE_BYTES + 10)));
  assert.deepEqual(await body.page.fetchFile(PY_LINK, 410), { kind: "failed" });
});

test("Computer files: only an https link is downloaded, never a built or other link", async () => {
  const f = filePage(() => new Response("x"));
  for (const link of [
    "http://files.example.invalid/notes.txt",
    "https://user:secret@files.example.invalid/notes.txt",
    "/rest/files/notes.txt",
    "javascript:alert(1)",
    "file:notes.txt",
  ])
    assert.deepEqual(await f.page.fetchFile(link, 1), { kind: "failed" }, link);
  assert.equal(f.calls.length, 0);
});

test("Computer files: a hidden tab, a 429 or a 5xx holds downloads for a later read", async () => {
  const hidden = filePage(() => new Response(PY_TEXT));
  hidden.hide();
  assert.deepEqual(await hidden.page.fetchFile(PY_LINK, 410), { kind: "held" });
  assert.equal(hidden.calls.length, 0);
  let status = 429;
  const busy = filePage(() => new Response("busy", { status }));
  assert.deepEqual(await busy.page.fetchFile(PY_LINK, 410), { kind: "held" });
  status = 200;
  // The pause after a 429 holds the next file without asking the host.
  assert.deepEqual(await busy.page.fetchFile(NOTES_LINK, 308), { kind: "held" });
  assert.equal(busy.calls.length, 1);
  const failing = filePage(() => new Response("down", { status: 503 }));
  assert.deepEqual(await failing.page.fetchFile(PY_LINK, 410), { kind: "held" });
});
