// Runs the repository's test suites on the throwaway test host so long checks do not load the laptop.
//   node tools/harness/vps.mjs sync            mirror committed and uncommitted work to the host
//   node tools/harness/vps.mjs run -- <cmd>    run a shell command in the runner container at the repo root
// The host alias comes from ~/.ssh/config (AIFT_TEST_HOST, default vps_sujit); its address never appears in the repo.
// Everything on the host lives under ~/aift-test and the Docker label com.docker.compose.project=aift-test.
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ROOT } from "./extension.mjs";

const HOST = process.env.AIFT_TEST_HOST ?? "vps_sujit";
const REMOTE = "aift-test";
const IMAGE = "aift-test-runner:1";
// Windows: only the system OpenSSH client talks to the Windows ssh-agent that holds the host key.
const SSH = process.platform === "win32" ? "C:/Windows/System32/OpenSSH/ssh.exe" : "ssh";
const SCP = process.platform === "win32" ? "C:/Windows/System32/OpenSSH/scp.exe" : "scp";

function ssh(command, { input, inherit = false } = {}) {
  const result = spawnSync(SSH, ["-o", "BatchMode=yes", HOST, command], {
    input,
    stdio: inherit ? ["ignore", "inherit", "inherit"] : ["pipe", "pipe", "pipe"],
    maxBuffer: 1 << 28,
  });
  if (result.status !== 0 && !inherit)
    throw new Error(`ssh failed (${result.status}): ${String(result.stderr).slice(0, 2000)}`);
  return inherit ? result.status : String(result.stdout);
}

function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
}

export function sync() {
  const head = git("rev-parse", "HEAD").trim();
  const remoteHead = ssh(`cd ~/${REMOTE}/repo && git rev-parse HEAD`).trim();
  const work = mkdtempSync(path.join(tmpdir(), "aift-sync-"));
  try {
    if (remoteHead !== head) {
      const bundle = path.join(work, "delta.bundle");
      let range = `${remoteHead}..main`;
      try {
        git("merge-base", "--is-ancestor", remoteHead, "HEAD");
      } catch {
        range = "main";
      }
      git("bundle", "create", bundle, range);
      execFileSync(SCP, ["-q", "-o", "BatchMode=yes", bundle, `${HOST}:${REMOTE}/delta.bundle`]);
      ssh(`cd ~/${REMOTE}/repo && git fetch -q ../delta.bundle main:refs/remotes/local/main && git checkout -q -f main && git reset -q --hard local/main`);
    }
    // Uncommitted work: reset the host copy to HEAD, then copy every changed or new file across.
    ssh(`cd ~/${REMOTE}/repo && git checkout -q -f main && git reset -q --hard ${head} && git clean -q -fd -e node_modules -e .venv`);
    // Compare with HEAD, not the index, so staged edits and staged deletions travel too.
    const list = (...args) => git(...args).split("\0").filter(Boolean);
    const changed = [...list("diff", "--name-only", "--diff-filter=d", "-z", "HEAD"), ...list("ls-files", "-o", "--exclude-standard", "-z")];
    const deleted = new Set(list("diff", "--name-only", "--diff-filter=D", "-z", "HEAD"));
    const present = changed.filter((f) => !deleted.has(f));
    if (present.length) {
      // Relative paths under the ignored tmp/ folder: GNU tar reads "C:" in an absolute path as a remote host.
      mkdirSync(path.join(ROOT, "tmp"), { recursive: true });
      writeFileSync(path.join(ROOT, "tmp/vps-files.txt"), present.join("\n"));
      execFileSync("tar", ["-cf", "tmp/vps-work.tar", "-T", "tmp/vps-files.txt"], { cwd: ROOT });
      execFileSync(SCP, ["-q", "-o", "BatchMode=yes", path.join(ROOT, "tmp/vps-work.tar"), `${HOST}:${REMOTE}/work.tar`]);
      ssh(`cd ~/${REMOTE}/repo && tar -xf ../work.tar`);
    }
    if (deleted.size) ssh(`cd ~/${REMOTE}/repo && rm -f -- ${[...deleted].map((f) => `'${f.replace(/'/g, "'\\''")}'`).join(" ")}`);
    return { head, uncommitted: present.length, deleted: deleted.size };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Runs a command in the runner container. node_modules and the Python environment stay in named volumes. */
export function run(command) {
  const docker = [
    "docker run --rm --init",
    "--label com.docker.compose.project=aift-test",
    "--user $(id -u):$(id -g) -e HOME=/tmp/home",
    "--shm-size=2g",
    `-v ~/${REMOTE}/repo:/work`,
    "-v aift-test-home:/tmp/home",
    "-w /work",
    IMAGE,
    "bash -lc",
    `'${command.replace(/'/g, "'\\''")}'`,
  ].join(" ");
  return ssh(docker, { inherit: true });
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("vps.mjs")) {
  const [verb, ...rest] = process.argv.slice(2);
  if (verb === "sync") console.log(JSON.stringify(sync()));
  else if (verb === "run") {
    const command = rest[0] === "--" ? rest.slice(1).join(" ") : rest.join(" ");
    process.exitCode = run(command);
  } else {
    console.error("usage: vps.mjs sync | run -- <command>");
    process.exitCode = 2;
  }
}
