#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, open, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  assertNoSymlinkPath,
  assertAllowedOptions,
  containedPath,
  exists,
  fileRecord,
  hashTree,
  jsonBytes,
  parseArgs,
  readJson,
  requireOption,
  sha256Bytes,
  sha256File,
  walkFiles,
  writeJson,
} from "./lib/common.mjs";
import {
  latestCommitted,
  missingTargetDirectories,
  nextCommitSequence,
  readTransactions,
  replaceFrom,
  requireSettled,
  rollback,
} from "./lib/transactions.mjs";

const args = parseArgs(process.argv.slice(2), ["recover"]);
assertAllowedOptions(args, [
  "recover",
  "rollback",
  "target-root",
  "stage",
  "test-interrupt-after",
  "test-fail-after",
  "test-rollback-interrupt-after",
  "test-rollback-fail-after",
  "test-restore-fail-after",
]);
for (const name of [
  "test-interrupt-after",
  "test-fail-after",
  "test-rollback-interrupt-after",
  "test-rollback-fail-after",
  "test-restore-fail-after",
]) {
  if (
    args[name] !== undefined &&
    (!Number.isSafeInteger(Number(args[name])) || Number(args[name]) < 1)
  ) {
    throw new Error(`--${name} must be a positive integer`);
  }
}
if (args.recover && args.rollback)
  throw new Error("Use --recover or --rollback, not both");
if ((args.recover || args.rollback) && args.stage)
  throw new Error("--stage is not used with recovery or rollback");
const targetRoot = resolve(args["target-root"] ?? process.cwd());
const targetInfo = await lstat(targetRoot);
if (!targetInfo.isDirectory() || targetInfo.isSymbolicLink())
  throw new Error(`Target root is unsafe: ${targetRoot}`);
const stateRoot = join(targetRoot, ".ecologits-maintenance");
const transactionRoot = join(stateRoot, "transactions");
const lockPath = join(stateRoot, "lock");
const rollbackOptions = {
  rollbackInterruptAfter: args["test-rollback-interrupt-after"],
  rollbackFailAfter: args["test-rollback-fail-after"],
  restoreFailAfter: args["test-restore-fail-after"],
};

async function syncFile(path) {
  const handle = await open(path, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function acquireLock(recovery = false) {
  await assertNoSymlinkPath(targetRoot, join(lockPath, "owner.json"));
  await assertNoSymlinkPath(targetRoot, join(transactionRoot, "journal.json"));
  await mkdir(stateRoot, { recursive: true });
  await assertNoSymlinkPath(targetRoot, join(stateRoot, "owner.json"));
  try {
    await mkdir(lockPath);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let owner = null;
    try {
      owner = await readJson(join(lockPath, "owner.json"));
    } catch {
      /* A crash may precede owner creation. */
    }
    if (!recovery || processIsAlive(owner?.pid))
      throw new Error(
        `Another adoption holds the lock${owner?.pid ? ` (PID ${owner.pid})` : ""}`,
      );
    await rm(lockPath, { recursive: true, force: true });
    await mkdir(lockPath);
  }
  await writeJson(join(lockPath, "owner.json"), { pid: process.pid });
}

async function releaseLock() {
  if (await exists(lockPath))
    await rm(lockPath, { recursive: true, force: true });
}

async function currentMatches(path, record) {
  await assertNoSymlinkPath(targetRoot, path);
  if (record === null) return !(await exists(path));
  if (!(await exists(path))) return false;
  const actual = await fileRecord(path);
  return actual.sha256 === record.sha256 && actual.bytes === record.bytes;
}

if (args.recover || args.rollback) {
  await acquireLock(true);
  try {
    const transactions = await readTransactions(transactionRoot);
    if (args.recover) {
      const pending = transactions.filter(
        (item) => !["committed", "rolled_back"].includes(item.journal.phase),
      );
      for (const transaction of pending.reverse())
        await rollback(targetRoot, transaction, false, rollbackOptions);
      process.stdout.write(
        `Recovered ${pending.length} interrupted EcoLogits adoption transaction(s).\n`,
      );
    } else {
      requireSettled(transactions);
      const committed = transactions.filter(
        (item) => item.journal.phase === "committed",
      );
      const requested = args.rollback;
      const transaction =
        requested === "latest"
          ? latestCommitted(transactions)
          : committed.find((item) => item.journal.id === requested);
      if (!transaction)
        throw new Error(`Committed transaction not found: ${requested}`);
      await rollback(targetRoot, transaction, true, rollbackOptions);
      process.stdout.write(
        `Rolled back EcoLogits adoption ${transaction.journal.id}.\n`,
      );
    }
  } finally {
    await releaseLock();
  }
  process.exit(0);
}

const stage = resolve(requireOption(args, "stage"));
await walkFiles(stage);
const seal = await readJson(join(stage, "verification/seal.json"));
async function readSealedJson(name, expected) {
  const path = containedPath(stage, name);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error(`Unsafe verification file: ${name}`);
  const bytes = await readFile(path);
  if (sha256Bytes(bytes) !== expected)
    throw new Error(`Verification seal mismatch: ${name}`);
  return JSON.parse(bytes.toString("utf8"));
}
const report = await readSealedJson(
  "verification/report.json",
  seal.report_sha256,
);
const plan = await readSealedJson(
  "verification/adoption-plan.json",
  seal.adoption_plan_sha256,
);
if (
  seal.schema_version !== "1" ||
  report.status !== "passed" ||
  seal.status !== "passed"
)
  throw new Error("Only a passed, sealed candidate can be adopted");
for (const [path, expected] of Object.entries(seal.stage_files)) {
  const actual = await sha256File(containedPath(stage, path));
  if (actual !== expected)
    throw new Error(`Staged content was modified after verification: ${path}`);
}
const stagePaths = await walkFiles(stage);
const unsealed = stagePaths.filter(
  (path) =>
    path !== "verification/seal.json" && !Object.hasOwn(seal.stage_files, path),
);
if (unsealed.length > 0)
  throw new Error(
    `Unsealed files appeared after verification: ${unsealed.join(", ")}`,
  );

if (
  plan.schema_version !== "1" ||
  plan.target_package !== "packages/ecologits-core"
)
  throw new Error("Unsupported adoption plan");
const coreRoot = containedPath(targetRoot, plan.target_package);
const coreInfo = await lstat(coreRoot);
if (!coreInfo.isDirectory() || coreInfo.isSymbolicLink())
  throw new Error(`Target package is unsafe: ${coreRoot}`);
function entryTarget(entry) {
  if (entry.scope === "package") return containedPath(coreRoot, entry.target);
  if (entry.scope === "private") {
    if (!entry.target.startsWith(".git/refinement-artifacts/vendor-source/"))
      throw new Error(
        `Private adoption target is outside the vendor evidence directory: ${entry.target}`,
      );
    return containedPath(targetRoot, entry.target);
  }
  throw new Error(`Unsupported adoption target scope: ${entry.scope}`);
}
async function validateTargets() {
  const snapshotTarget = containedPath(coreRoot, plan.snapshot_target);
  if (plan.snapshot_precondition === null) {
    if (await exists(snapshotTarget))
      throw new Error(
        `Unexpected candidate snapshot directory already exists: ${plan.snapshot_target}`,
      );
  } else {
    if (!(await exists(snapshotTarget)))
      throw new Error(
        `Accepted snapshot directory is missing: ${plan.snapshot_target}`,
      );
    const snapshotActual = await hashTree(snapshotTarget);
    if (
      !jsonBytes(snapshotActual).equals(jsonBytes(plan.snapshot_precondition))
    )
      throw new Error(
        `Accepted snapshot directory is dirty: ${plan.snapshot_target}`,
      );
    const acceptedPaths = Object.keys(plan.snapshot_precondition).sort();
    const candidatePaths = Object.keys(plan.snapshot_candidate_files).sort();
    if (JSON.stringify(acceptedPaths) !== JSON.stringify(candidatePaths)) {
      throw new Error(
        "In-place adoption refuses a candidate snapshot with a different file set; select a new version directory",
      );
    }
  }
  for (const [path, hash] of Object.entries(
    plan.external_preconditions.port_files,
  )) {
    const target = containedPath(coreRoot, path);
    if (!(await exists(target)) || (await sha256File(target)) !== hash)
      throw new Error(
        `Verified TypeScript port changed after candidate verification: ${path}`,
      );
  }
  if (plan.external_preconditions.overlay) {
    const overlay = containedPath(
      targetRoot,
      plan.external_preconditions.overlay.path,
    );
    if (
      !(await exists(overlay)) ||
      (await sha256File(overlay)) !== plan.external_preconditions.overlay.sha256
    )
      throw new Error("Product overlay changed after candidate verification");
  }
  const targetKeys = new Set();
  for (const entry of plan.entries) {
    const source = containedPath(stage, entry.source);
    const target = entryTarget(entry);
    const key = `${entry.scope}:${entry.target}`
      .normalize("NFC")
      .toLocaleLowerCase("en-US");
    if (targetKeys.has(key))
      throw new Error(
        `Duplicate or case-colliding adoption target: ${entry.target}`,
      );
    targetKeys.add(key);
    if (!(await exists(source)))
      throw new Error(`Adoption source is missing: ${entry.source}`);
    if (!(await currentMatches(target, entry.precondition)))
      throw new Error(`Dirty or unexpected adoption target: ${entry.target}`);
  }
}

await acquireLock(false);
let transaction;
try {
  const priorTransactions = await readTransactions(transactionRoot);
  requireSettled(priorTransactions);
  const commitSequence = nextCommitSequence(priorTransactions);
  await validateTargets();
  await mkdir(transactionRoot, { recursive: true });
  const id = `tx-${seal.report_sha256.slice(0, 12)}-${randomUUID().slice(0, 8)}`;
  const directory = containedPath(transactionRoot, id);
  await mkdir(directory);
  const journalPath = join(directory, "journal.json");
  const entries = [];
  for (let index = 0; index < plan.entries.length; index += 1) {
    const planned = plan.entries[index];
    const source = containedPath(stage, planned.source);
    const target = entryTarget(planned);
    const original = (await exists(target)) ? await fileRecord(target) : null;
    const candidate = await fileRecord(source);
    if (candidate.sha256 !== seal.stage_files[planned.source])
      throw new Error(
        `Staged content changed during adoption: ${planned.source}`,
      );
    if (!(await currentMatches(target, planned.precondition)))
      throw new Error(`Dirty or unexpected adoption target: ${planned.target}`);
    const backup = original ? `backup/${index}` : null;
    const pending = `pending/${index}`;
    if (backup) {
      const backupPath = containedPath(directory, backup);
      await mkdir(dirname(backupPath), { recursive: true });
      await copyFile(target, backupPath, constants.COPYFILE_EXCL);
      if (!(await currentMatches(backupPath, planned.precondition)))
        throw new Error(`Backup changed during adoption: ${planned.target}`);
      await syncFile(backupPath);
    }
    const pendingPath = containedPath(directory, pending);
    await mkdir(dirname(pendingPath), { recursive: true });
    await copyFile(source, pendingPath, constants.COPYFILE_EXCL);
    if ((await sha256File(pendingPath)) !== seal.stage_files[planned.source])
      throw new Error(
        `Staged content changed during preparation: ${planned.source}`,
      );
    await syncFile(pendingPath);
    entries.push({
      source: planned.source,
      target_package_relative: planned.target,
      target_root_relative:
        planned.scope === "package"
          ? `packages/ecologits-core/${planned.target}`
          : planned.target,
      scope: planned.scope,
      original,
      candidate,
      backup,
      pending,
      status: "prepared",
    });
  }
  const journal = {
    schema_version: "2",
    id,
    phase: "prepared",
    report_sha256: seal.report_sha256,
    created_directories: await missingTargetDirectories(targetRoot, entries),
    entries,
  };
  await validateTargets();
  await writeJson(journalPath, journal);
  transaction = { directory, journalPath, journal };
  journal.phase = "applying";
  await writeJson(journalPath, journal);
  const interruptAfter = args["test-interrupt-after"]
    ? Number(args["test-interrupt-after"])
    : null;
  const failAfter = args["test-fail-after"]
    ? Number(args["test-fail-after"])
    : null;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    entry.status = "applying";
    await writeJson(journalPath, journal);
    const pending = containedPath(directory, entry.pending);
    const target = containedPath(targetRoot, entry.target_root_relative);
    if (!(await currentMatches(target, entry.original)))
      throw new Error(
        `Dirty or unexpected adoption target: ${entry.target_root_relative}`,
      );
    if (!(await currentMatches(pending, entry.candidate)))
      throw new Error(`Prepared candidate changed: ${entry.pending}`);
    await replaceFrom(
      targetRoot,
      pending,
      target,
      transaction,
      `apply-${index}`,
      entry.candidate,
      entry.original,
    );
    entry.status = "applied";
    await writeJson(journalPath, journal);
    if (interruptAfter === index + 1) process.exit(86);
    if (failAfter === index + 1)
      throw new Error(`Synthetic adoption failure after ${index + 1} files`);
  }
  journal.phase = "committed";
  journal.commit_sequence = commitSequence;
  await writeJson(journalPath, journal);
  await releaseLock();
  process.stdout.write(
    `Adopted EcoLogits ${plan.selection.version} as transaction ${id}.\n`,
  );
} catch (error) {
  let rollbackError = null;
  try {
    if (transaction)
      await rollback(targetRoot, transaction, false, rollbackOptions);
  } catch (failure) {
    rollbackError = failure;
  } finally {
    await releaseLock();
  }
  if (rollbackError)
    throw new AggregateError(
      [error, rollbackError],
      "Adoption failed and automatic rollback also needs recovery",
    );
  throw error;
}
