import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { extractTarGz } from "../lib/common.mjs";
import { archive } from "./helpers.mjs";

async function rejectsEntry(entry, pattern) {
  const root = await mkdtemp(join(tmpdir(), "ecologits-archive-test-"));
  try {
    const source = join(root, "candidate.tar.gz");
    await writeFile(source, archive([entry]));
    await assert.rejects(extractTarGz(source, join(root, "out")), pattern);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("rejects traversal, Windows paths, links and unsupported archive entries", async () => {
  await rejectsEntry(
    { path: "root/../escape.txt", data: "bad" },
    /Unsafe path/,
  );
  await rejectsEntry(
    { path: "root/C:/escape.txt", data: "bad" },
    /Non-portable path/,
  );
  await rejectsEntry({ path: "root/NUL", data: "bad" }, /Non-portable path/);
  await rejectsEntry(
    { path: "root/link", data: "target", type: "2" },
    /not accepted/,
  );
  await rejectsEntry(
    { path: "root/pipe", data: "", type: "6" },
    /not accepted/,
  );
});

test("rejects case-colliding entries and bounded expansion violations", async () => {
  const root = await mkdtemp(join(tmpdir(), "ecologits-archive-test-"));
  try {
    const collision = join(root, "collision.tar.gz");
    await writeFile(
      collision,
      archive([
        { path: "root/File.txt", data: "a" },
        { path: "root/file.txt", data: "b" },
      ]),
    );
    await assert.rejects(
      extractTarGz(collision, join(root, "collision-out")),
      /case-colliding/,
    );
    const oversized = join(root, "oversized.tar.gz");
    await writeFile(
      oversized,
      archive([{ path: "root/file.txt", data: "12345" }]),
    );
    await assert.rejects(
      extractTarGz(oversized, join(root, "oversized-out"), {
        downloadBytes: 1024,
        expandedBytes: 4096,
        fileBytes: 4,
        entries: 10,
      }),
      /unsafe size/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
