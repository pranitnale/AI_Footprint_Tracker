import { constants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rmdir,
  unlink,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  assertNoSymlinkPath,
  containedPath,
  fileRecord,
  readJson,
  writeJson,
} from "./common.mjs";

export async function presentRecord(path) {
  try {
    await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  return fileRecord(path);
}

function same(left, right) {
  return left === null || right === null
    ? left === right
    : left.bytes === right.bytes && left.sha256 === right.sha256;
}

function targetPath(root, entry) {
  const name = entry.target_root_relative;
  if (
    typeof name !== "string" ||
    (!name.startsWith("packages/ecologits-core/") &&
      !name.startsWith(".git/refinement-artifacts/vendor-source/"))
  )
    throw new Error("Transaction target is outside the adopted component");
  return containedPath(root, name);
}

export async function missingTargetDirectories(root, entries) {
  const directories = new Set();
  for (const entry of entries) {
    const parts = entry.target_root_relative.split("/").slice(0, -1);
    while (parts.length > 0) {
      const name = parts.join("/");
      if (
        !name.startsWith("packages/ecologits-core/") &&
        name !== ".git/refinement-artifacts/vendor-source" &&
        !name.startsWith(".git/refinement-artifacts/vendor-source/")
      )
        break;
      const path = containedPath(root, name);
      try {
        await lstat(path);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        directories.add(name);
      }
      parts.pop();
    }
  }
  return [...directories].sort(
    (a, b) => b.split("/").length - a.split("/").length,
  );
}

async function removeCreatedDirectories(root, journal) {
  for (const name of journal.created_directories ?? []) {
    targetPath(root, { target_root_relative: `${name}/cleanup-boundary` });
    const path = containedPath(root, name);
    await assertNoSymlinkPath(root, `${path}/cleanup-boundary`);
    try {
      await rmdir(path);
    } catch (error) {
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) throw error;
    }
  }
}

async function safeRecord(root, path) {
  await assertNoSymlinkPath(root, path);
  return presentRecord(path);
}

export async function replaceFrom(
  root,
  source,
  target,
  transaction,
  suffix,
  expected,
  expectedDestination,
) {
  await assertNoSymlinkPath(root, target);
  await presentRecord(target);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.ecologits-${transaction.journal.id}-${suffix}`;
  try {
    await unlink(temporary);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    await copyFile(source, temporary, constants.COPYFILE_EXCL);
    const handle = await open(temporary, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (!same(await fileRecord(temporary), expected))
      throw new Error(
        `Replacement bytes differ from the verified payload: ${target}`,
      );
    if (!same(await safeRecord(root, target), expectedDestination))
      throw new Error(
        `Replacement target changed during preparation: ${target}`,
      );
    // Keep the destination present until one atomic file replacement succeeds.
    await rename(temporary, target);
  } finally {
    try {
      await unlink(temporary);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

export async function readTransactions(root) {
  try {
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error("Unsafe transaction root");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const result = [];
  for (const id of await readdir(root)) {
    const directory = containedPath(root, id);
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error(`Unsafe transaction directory: ${directory}`);
    const journalPath = join(directory, "journal.json");
    if ((await presentRecord(journalPath)) === null) continue;
    const journal = await readJson(journalPath);
    if (
      !["1", "2"].includes(journal.schema_version) ||
      journal.id !== id ||
      !Array.isArray(journal.entries) ||
      ![
        "prepared",
        "applying",
        "committed",
        "rolling_back",
        "restoring_rollback",
        "rolled_back",
      ].includes(journal.phase)
    )
      throw new Error(`Invalid transaction journal: ${id}`);
    result.push({ directory, journalPath, journal });
  }
  return result;
}

export function requireSettled(transactions) {
  if (
    transactions.some(
      ({ journal }) => !["committed", "rolled_back"].includes(journal.phase),
    )
  )
    throw new Error(
      "An unfinished adoption or rollback requires --recover first",
    );
}

export function nextCommitSequence(transactions) {
  const sequences = transactions
    .map(({ journal }) => journal.commit_sequence)
    .filter((value) => value !== undefined);
  if (
    sequences.some((value) => !Number.isSafeInteger(value) || value < 1) ||
    new Set(sequences).size !== sequences.length
  )
    throw new Error("Invalid or duplicate transaction commit sequence");
  const next = Math.max(0, ...sequences) + 1;
  if (!Number.isSafeInteger(next))
    throw new Error("Transaction sequence exhausted");
  return next;
}

export function latestCommitted(transactions) {
  nextCommitSequence(transactions);
  const committed = transactions.filter(
    ({ journal }) => journal.phase === "committed",
  );
  if (committed.some(({ journal }) => journal.commit_sequence === undefined))
    throw new Error(
      "Legacy transaction order is unknown; specify an explicit rollback transaction ID",
    );
  return committed
    .sort((a, b) => a.journal.commit_sequence - b.journal.commit_sequence)
    .at(-1);
}

async function validatePayload(transaction, path, expected) {
  const source = containedPath(transaction.directory, path);
  if (!same(await safeRecord(transaction.directory, source), expected))
    throw new Error(`Transaction backup or pending file is corrupt: ${path}`);
  return source;
}

async function preflight(root, transaction, committed) {
  const journal = transaction.journal;
  const before = [];
  const targets = new Set();
  for (let index = 0; index < journal.entries.length; index += 1) {
    const entry = journal.entries[index];
    const target = targetPath(root, entry);
    const key = target.normalize("NFC").toLowerCase();
    if (targets.has(key)) throw new Error("Duplicate rollback target");
    targets.add(key);
    if (entry.original !== null)
      await validatePayload(transaction, entry.backup, entry.original);
    await validatePayload(transaction, entry.pending, entry.candidate);
    const current = await safeRecord(root, target);
    const recovering = journal.rollback;
    const allowed = recovering
      ? same(current, recovering.before[index]) || same(current, entry.original)
      : committed
        ? same(current, entry.candidate)
        : same(current, entry.original) ||
          same(current, entry.candidate) ||
          // Version 1 replaced via two renames and could crash in the gap.
          (journal.schema_version === "1" &&
            entry.status === "applying" &&
            current === null);
    if (!allowed)
      throw new Error(
        `Rollback refuses a file changed outside the transaction: ${entry.target_root_relative}`,
      );
    before.push(current);
  }
  return before;
}

async function restoreEntry(root, transaction, index, desired, suffix) {
  const entry = transaction.journal.entries[index];
  const target = targetPath(root, entry);
  const current = await safeRecord(root, target);
  if (same(current, desired)) return;
  const before = transaction.journal.rollback.before[index];
  if (!same(current, before) && !same(current, entry.original))
    throw new Error(
      `Rollback target changed during recovery: ${entry.target_root_relative}`,
    );
  if (desired === null) await unlink(target);
  else {
    const payload = same(desired, entry.original)
      ? entry.backup
      : entry.pending;
    const source = await validatePayload(transaction, payload, desired);
    await replaceFrom(
      root,
      source,
      target,
      transaction,
      suffix,
      desired,
      current,
    );
  }
}

function fault(options, kind, count) {
  if (Number(options[`${kind}InterruptAfter`]) === count) process.exit(86);
  if (Number(options[`${kind}FailAfter`]) === count) {
    const error = new Error(
      `Synthetic ${kind} I/O failure after ${count} files`,
    );
    error.code = "EIO";
    throw error;
  }
}

async function restoreBeforeRollback(root, transaction, options) {
  await preflight(root, transaction, false);
  const journal = transaction.journal;
  for (let index = 0; index < journal.entries.length; index += 1) {
    await restoreEntry(
      root,
      transaction,
      index,
      journal.rollback.before[index],
      `restore-${index}`,
    );
    fault(options, "restore", index + 1);
  }
  const returnPhase = journal.rollback.return_phase;
  const restored = { ...journal, phase: returnPhase };
  delete restored.rollback;
  await writeJson(transaction.journalPath, restored);
  transaction.journal = restored;
}

export async function rollback(
  root,
  transaction,
  committed = false,
  options = {},
) {
  if (transaction.journal.phase === "restoring_rollback") {
    await restoreBeforeRollback(root, transaction, options);
    if (transaction.journal.phase === "committed") return;
  }
  const journal = transaction.journal;
  // Validate every destination and every recovery payload before the first write.
  const before = await preflight(root, transaction, committed);
  if (!journal.rollback) {
    const prepared = {
      ...journal,
      phase: "rolling_back",
      rollback: { before, return_phase: journal.phase },
    };
    await writeJson(transaction.journalPath, prepared);
    transaction.journal = prepared;
  }
  try {
    for (
      let index = transaction.journal.entries.length - 1;
      index >= 0;
      index -= 1
    ) {
      await restoreEntry(
        root,
        transaction,
        index,
        transaction.journal.entries[index].original,
        `rollback-${index}`,
      );
      fault(options, "rollback", transaction.journal.entries.length - index);
    }
    await removeCreatedDirectories(root, transaction.journal);
    const complete = { ...transaction.journal, phase: "rolled_back" };
    await writeJson(transaction.journalPath, complete);
    transaction.journal = complete;
  } catch (error) {
    try {
      const restoring = { ...transaction.journal, phase: "restoring_rollback" };
      await writeJson(transaction.journalPath, restoring);
      transaction.journal = restoring;
      await restoreBeforeRollback(root, transaction, options);
    } catch (failure) {
      throw new AggregateError(
        [error, failure],
        "Rollback failed; durable recovery requires --recover",
      );
    }
    throw error;
  }
}
