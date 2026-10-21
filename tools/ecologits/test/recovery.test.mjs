import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import {
  fileRecord,
  hashTree,
  readJson,
  sha256File,
  writeJson,
} from "../lib/common.mjs";
import { attribution } from "../lib/semantic.mjs";
import { runNode } from "./helpers.mjs";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const adopt = join(workspace, "tools/ecologits/adopt.mjs");
const output = (result) => `${result.stdout ?? ""}${result.stderr ?? ""}`;

async function fixture(context) {
  const root = await mkdtemp(join(tmpdir(), "ecologits-recovery-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "packages/ecologits-core"), { recursive: true });
  return root;
}

async function stage(root, name, values) {
  const directory = join(root, name);
  await mkdir(join(directory, "verification"), { recursive: true });
  const entries = [];
  for (const [target, value] of Object.entries(values)) {
    const source = `candidate/${target}`;
    await mkdir(dirname(join(directory, source)), { recursive: true });
    await writeFile(join(directory, source), value);
    let precondition = null;
    try {
      precondition = await fileRecord(
        join(root, "packages/ecologits-core", target),
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    entries.push({ scope: "package", target, source, precondition });
  }
  await writeJson(join(directory, "verification/report.json"), {
    status: "passed",
    name,
  });
  await writeJson(join(directory, "verification/adoption-plan.json"), {
    schema_version: "1",
    target_package: "packages/ecologits-core",
    snapshot_target: `upstream/${name}`,
    snapshot_precondition: null,
    snapshot_candidate_files: {},
    external_preconditions: { port_files: {}, overlay: null },
    selection: { version: "synthetic" },
    entries,
  });
  await writeJson(join(directory, "verification/seal.json"), {
    schema_version: "1",
    status: "passed",
    report_sha256: await sha256File(
      join(directory, "verification/report.json"),
    ),
    adoption_plan_sha256: await sha256File(
      join(directory, "verification/adoption-plan.json"),
    ),
    stage_files: await hashTree(directory),
  });
  return directory;
}

function command(root, args, expected = 0) {
  const result = runNode(workspace, adopt, ["--target-root", root, ...args]);
  assert.equal(result.status, expected, output(result));
  return result;
}

async function journals(root) {
  const base = join(root, ".ecologits-maintenance/transactions");
  return Promise.all(
    (await readdir(base)).map(async (id) => ({
      directory: join(base, id),
      path: join(base, id, "journal.json"),
      value: await readJson(join(base, id, "journal.json")),
    })),
  );
}

async function adopted(context) {
  const root = await fixture(context);
  await writeFile(join(root, "packages/ecologits-core/a"), "old-a");
  await writeFile(join(root, "packages/ecologits-core/b"), "old-b");
  const before = await hashTree(join(root, "packages/ecologits-core"));
  const candidate = await stage(root, "first", {
    a: "new-a",
    b: "new-b",
    c: "new-c",
  });
  command(root, ["--stage", candidate]);
  return { root, before, candidate, journal: (await journals(root))[0] };
}

test("rollback preflights all targets and backups before changing any bytes", async (context) => {
  for (const corrupt of ["target", "backup", "pending"]) {
    const { root, journal } = await adopted(context);
    const path =
      corrupt === "target"
        ? join(root, "packages/ecologits-core/a")
        : join(journal.directory, `${corrupt}/0`);
    await writeFile(path, "external change");
    const before = await hashTree(join(root, "packages/ecologits-core"));
    const originalJournal = await readFile(journal.path);
    const result = command(root, ["--rollback", "latest"], 1);
    assert.match(output(result), /changed outside|corrupt/);
    assert.deepEqual(
      await hashTree(join(root, "packages/ecologits-core")),
      before,
    );
    assert.deepEqual(await readFile(journal.path), originalJournal);
  }
});

test("latest rollback uses commit sequence even when IDs sort in reverse order", async (context) => {
  const { root } = await adopted(context);
  const first = (await journals(root))[0];
  const candidate = await stage(root, "second", {
    a: "next-a",
    b: "next-b",
    c: "next-c",
  });
  command(root, ["--stage", candidate]);
  const entries = await journals(root);
  const newest = entries.find((entry) => entry.value.id !== first.value.id);
  // Journal IDs are opaque; force lexical order to oppose recorded commit order.
  const { rename } = await import("node:fs/promises");
  for (const [entry, id] of [
    [first, "tx-zzzz-old"],
    [newest, "tx-aaaa-new"],
  ]) {
    entry.value.id = id;
    await writeJson(entry.path, entry.value);
    await rename(entry.directory, join(dirname(entry.directory), id));
  }
  command(root, ["--rollback", "latest"]);
  assert.equal(
    await readFile(join(root, "packages/ecologits-core/a"), "utf8"),
    "new-a",
  );
  command(root, ["--rollback", "latest"]);
  assert.equal(
    await readFile(join(root, "packages/ecologits-core/a"), "utf8"),
    "old-a",
  );
});

test("an interrupted explicit rollback is resumed by recover and blocks new adoption", async (context) => {
  const { root, before } = await adopted(context);
  command(
    root,
    ["--rollback", "latest", "--test-rollback-interrupt-after", "2"],
    86,
  );
  const retryStage = await stage(root, "during-recovery", {
    a: "unapproved-next",
  });
  assert.match(
    output(command(root, ["--stage", retryStage], 1)),
    /--recover|holds the lock/,
  );
  command(root, ["--recover"]);
  assert.deepEqual(
    await hashTree(join(root, "packages/ecologits-core")),
    before,
  );
  assert.equal((await journals(root))[0].value.phase, "rolled_back");
  command(root, ["--recover"]);
});

test("rollback I/O failure restores adopted bytes and permits a clean retry", async (context) => {
  const { root, before } = await adopted(context);
  const adoptedBytes = await hashTree(join(root, "packages/ecologits-core"));
  command(root, ["--rollback", "latest", "--test-rollback-fail-after", "2"], 1);
  assert.deepEqual(
    await hashTree(join(root, "packages/ecologits-core")),
    adoptedBytes,
  );
  assert.equal((await journals(root))[0].value.phase, "committed");
  command(root, ["--rollback", "latest"]);
  assert.deepEqual(
    await hashTree(join(root, "packages/ecologits-core")),
    before,
  );
});

test("failed rollback compensation remains recoverable across another process", async (context) => {
  const { root, before } = await adopted(context);
  const adoptedBytes = await hashTree(join(root, "packages/ecologits-core"));
  command(
    root,
    [
      "--rollback",
      "latest",
      "--test-rollback-fail-after",
      "2",
      "--test-restore-fail-after",
      "2",
    ],
    1,
  );
  assert.equal((await journals(root))[0].value.phase, "restoring_rollback");
  command(root, ["--recover"]);
  assert.deepEqual(
    await hashTree(join(root, "packages/ecologits-core")),
    adoptedBytes,
  );
  command(root, ["--rollback", "latest"]);
  assert.deepEqual(
    await hashTree(join(root, "packages/ecologits-core")),
    before,
  );
});

test("interrupted adoption is recovered and ordinary adoption failure restores all originals", async (context) => {
  for (const option of ["--test-interrupt-after", "--test-fail-after"]) {
    const root = await fixture(context);
    await writeFile(join(root, "packages/ecologits-core/a"), "old-a");
    const before = await hashTree(join(root, "packages/ecologits-core"));
    const candidate = await stage(root, "candidate", {
      a: "new-a",
      b: "new-b",
    });
    command(
      root,
      ["--stage", candidate, option, "1"],
      option.includes("interrupt") ? 86 : 1,
    );
    command(root, ["--recover"]);
    assert.deepEqual(
      await hashTree(join(root, "packages/ecologits-core")),
      before,
    );
  }
});

test("transaction-root junction is rejected without changing outside bytes", async (context) => {
  const root = await fixture(context);
  const outside = await fixture(context);
  const state = join(root, ".ecologits-maintenance");
  await mkdir(state);
  await writeFile(join(outside, "sentinel"), "unchanged");
  await symlink(
    outside,
    join(state, "transactions"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const before = await hashTree(outside);
  assert.match(output(command(root, ["--recover"], 1)), /Symlink|Unsafe/);
  assert.deepEqual(await hashTree(outside), before);
});

test("rollback rejects a linked target parent before removing an original-null entry", async (context) => {
  const root = await fixture(context);
  const outside = await fixture(context);
  const candidate = await stage(root, "nested", { "nested/new": "candidate" });
  command(root, ["--stage", candidate]);
  const nested = join(root, "packages/ecologits-core/nested");
  const { rename } = await import("node:fs/promises");
  await rename(nested, join(root, "saved-nested"));
  await writeFile(join(outside, "new"), "candidate");
  await symlink(
    outside,
    nested,
    process.platform === "win32" ? "junction" : "dir",
  );
  const before = await hashTree(outside);
  assert.match(output(command(root, ["--rollback", "latest"], 1)), /Symlink/);
  assert.deepEqual(await hashTree(outside), before);
});

test("legacy journals require an explicit ID instead of inventing latest order", async (context) => {
  const { root, before, journal } = await adopted(context);
  delete journal.value.commit_sequence;
  journal.value.schema_version = "1";
  await writeJson(journal.path, journal.value);
  assert.match(
    output(command(root, ["--rollback", "latest"], 1)),
    /Legacy transaction order is unknown/,
  );
  command(root, ["--rollback", journal.value.id]);
  assert.deepEqual(
    await hashTree(join(root, "packages/ecologits-core")),
    before,
  );
});

test("rollback removes only transaction-created empty folders so a snapshot can be adopted again", async (context) => {
  const root = await fixture(context);
  const existing = join(root, "packages/ecologits-core/existing-empty");
  await mkdir(existing);
  const candidate = await stage(root, "qualified", {
    "upstream/qualified/model.json": "candidate",
  });
  command(root, ["--stage", candidate]);
  command(root, ["--rollback", "latest"]);
  assert.deepEqual(await readdir(join(root, "packages/ecologits-core")), [
    "existing-empty",
  ]);
  command(root, ["--stage", candidate]);
  assert.equal(
    await readFile(
      join(root, "packages/ecologits-core/upstream/qualified/model.json"),
      "utf8",
    ),
    "candidate",
  );
});

test("candidate notice uses current citation and license metadata without attesting commits", async (context) => {
  const root = await fixture(context);
  await writeFile(join(root, "LICENSE"), "Synthetic license v2");
  await writeFile(
    join(root, "CITATION.cff"),
    "title: Changed citation\nyear: 2030\ndoi: 10.1234/changed\n",
  );
  const options = {
    candidateRoot: root,
    selection: {
      version: "1.2.3",
      core_commit: "a".repeat(40),
      catalog_commit: "b".repeat(40),
      release_kind: "qualified_combination",
    },
    lock: {
      license_sha256: await sha256File(join(root, "LICENSE")),
      citation_sha256: await sha256File(join(root, "CITATION.cff")),
    },
    inventoryChange: { dependencies: [] },
    projectLicense: "Synthetic-2.0",
    complianceApproved: true,
  };
  const result = await attribution(options);
  assert.match(result.notice.toString(), /Changed citation/);
  assert.match(result.notice.toString(), /2030/);
  assert.match(result.notice.toString(), /10.1234\/changed/);
  assert.match(result.notice.toString(), /not independently attested/);
  assert.doesNotMatch(
    result.notice.toString(),
    /2025|07471|distributed under MPL-2.0/,
  );
  assert.equal(result.metadata.project_license, "Synthetic-2.0");
  await writeFile(join(root, "CITATION.cff"), "");
  await assert.rejects(attribution(options), /Attribution bytes differ/);
  await rm(join(root, "CITATION.cff"));
  await assert.rejects(attribution(options), /Attribution bytes differ/);
  options.lock.citation_sha256 = null;
  await writeFile(join(root, "LICENSE"), "");
  await assert.rejects(attribution(options), /Attribution bytes differ/);
});

test("targets are checked after acquiring the lock and copied candidates remain sealed", async (context) => {
  for (const scenario of [
    "lock-target",
    "pending-copy",
    "replacement-copy",
    "replacement-target",
    "plan-read",
  ]) {
    const root = await fixture(context);
    const target = join(root, "packages/ecologits-core/a");
    await writeFile(target, "original");
    const candidate = await stage(root, "sealed", { a: "verified-candidate" });
    const loader = join(root, "race-probe.mjs");
    await writeFile(
      loader,
      `
      import fs from 'node:fs/promises';
      import {syncBuiltinESMExports} from 'node:module';
      const originalMkdir = fs.mkdir;
      const originalCopy = fs.copyFile;
      const originalRead = fs.readFile;
      const scenario = ${JSON.stringify(scenario)};
      const target = ${JSON.stringify(target)};
      fs.mkdir = async (...args) => {
        const result = await originalMkdir(...args);
        if (scenario === 'lock-target' && String(args[0]).replaceAll('\\\\','/').endsWith('/lock'))
          await fs.writeFile(target, 'concurrent-adoption');
        return result;
      };
      fs.copyFile = async (...args) => {
        const result = await originalCopy(...args);
        const destination = String(args[1]).replaceAll('\\\\','/');
        if ((scenario === 'pending-copy' && destination.endsWith('/pending/0')) ||
            (scenario === 'replacement-copy' && destination.endsWith('-apply-0')))
          await fs.writeFile(args[1], 'unverified-candidate');
        if (scenario === 'replacement-target' && destination.endsWith('-apply-0'))
          await fs.writeFile(target, 'concurrent-adoption');
        return result;
      };
      fs.readFile = async (...args) => {
        const result = await originalRead(...args);
        if (scenario === 'plan-read' && String(args[0]).replaceAll('\\\\','/').endsWith('/adoption-plan.json')) {
          const value = JSON.parse(result.toString());
          value.entries = [];
          const text = JSON.stringify(value);
          return typeof result === 'string' ? text : Buffer.from(text);
        }
        return result;
      };
      syncBuiltinESMExports();
      process.argv = ${JSON.stringify([process.execPath, adopt, "--target-root", root, "--stage", candidate])};
      await import(${JSON.stringify(pathToFileURL(adopt).href)});
    `,
    );
    const result = runNode(workspace, loader, []);
    assert.equal(result.status, 1, output(result));
    assert.match(
      output(result),
      /Dirty or unexpected|changed during preparation|Replacement bytes|Verification seal mismatch/,
    );
    assert.equal(
      await readFile(target, "utf8"),
      ["lock-target", "replacement-target"].includes(scenario)
        ? "concurrent-adoption"
        : "original",
    );
  }
});
