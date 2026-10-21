import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { CaptureWatchdog } from "../lib/capture-watchdog";

async function timerHarness() {
  const source = readFileSync(
    new URL("../entrypoints/content.content.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("    const probe = () => {");
  const end = source.indexOf(
    "    browser.runtime.onMessage.addListener",
    start,
  );
  assert.ok(start >= 0 && end > start);
  const compiled = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let now = 0,
    responsive = true,
    tick!: () => void,
    show!: (event: { persisted: boolean }) => void;
  let probes = 0;
  const issues: Array<{ code: string; active: boolean }> = [],
    messages: any[] = [];
  const watchdog = new CaptureWatchdog(0);
  new Function(
    "watchdog",
    "window",
    "sendToBackground",
    "location",
    "probeNonce",
    "Date",
    "setInterval",
    "recordPageHealth",
    "recoverPageHealth",
    "trackingEnabled",
    "siteAccess",
    "signal",
    "extensionStopped",
    compiled,
  )(
    watchdog,
    {
      postMessage: () => {
        probes++;
        if (responsive) queueMicrotask(() => watchdog.ready(now, "unverified"));
      },
      addEventListener: (_name: string, fn: typeof show) => {
        show = fn;
      },
    },
    async (message: any) => {
      messages.push(message);
      return { enabled: true };
    },
    { origin: "https://claude.ai" },
    "a".repeat(36),
    { now: () => now },
    (fn: () => void) => {
      tick = fn;
      return 1;
    },
    (code: string, active: boolean) => {
      issues.push({ code, active });
    },
    () => {},
    true,
    true,
    new AbortController().signal,
    false,
  );
  const run = async (at: number, resume = false) => {
    now = at;
    resume ? show({ persisted: true }) : tick();
    await Promise.resolve();
    await Promise.resolve();
  };
  await Promise.resolve();
  for (let at = 1000; at <= 11000; at += 1000) await run(at);
  return {
    watchdog,
    issues,
    messages,
    run,
    probes: () => probes,
    silent: () => {
      responsive = false;
    },
  };
}
test("actual content timer immediately renews after delayed callback and permits queued readiness", async () => {
  const h = await timerHarness(),
    before = h.probes();
  await h.run(71000);
  assert.equal(h.probes(), before + 1);
  assert.deepEqual(h.issues, []);
  assert.equal(h.watchdog.status(71000).listener, "active");
  assert.equal(h.watchdog.status(71000).interception, "unverified");
  for (const at of [81000, 91000, 101000]) await h.run(at);
  assert.equal(
    h.probes(),
    before + 2,
    "renewal uses30seconds of elapsed time, not30callbacks",
  );
  assert.equal(
    h.messages.filter((m) => m.target === "capture-diagnostic").length,
    0,
  );
});
test("actual content timer reports a silent resumed hook once after bounded grace", async () => {
  for (const delayedAgain of [false, true]) {
    const h = await timerHarness();
    h.silent();
    await h.run(71000);
    assert.deepEqual(h.issues, []);
    if (!delayedAgain)
      for (let at = 72000; at < 81000; at += 1000) await h.run(at);
    await h.run(delayedAgain ? 131000 : 81000);
    assert.deepEqual(h.issues, [
      { code: "capture_hook_missing", active: true },
    ]);
    await h.run(delayedAgain ? 132000 : 82000);
    assert.equal(h.issues.length, 1);
  }
});
test("actual bfcache callback probes immediately and retains a real activity gap during grace", async () => {
  const h = await timerHarness();
  h.watchdog.sent(55000);
  h.watchdog.activity(56000);
  await h.run(71000, true);
  assert.deepEqual(h.issues, [{ code: "capture_hook_missing", active: true }]);
  assert.equal(h.watchdog.status(71000).activityGap, true);
  assert.equal(h.watchdog.status(71000).listener, "active");
  await h.run(72000);
  assert.equal(h.issues.length, 1);
});
