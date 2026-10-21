/**
 * Times the background work behind the popup, the dashboard pages and a saved-history read
 * on a large synthetic profile (large-profile.ts). Run it with
 *   node --import tsx test/perf/popup-benchmark.ts [personal|company]
 * Optional environment: BENCH_SCALE (default 1) shrinks the profile for a quick check, and
 * BENCH_OUT names a JSON file for the results. BENCH_PROFILE names a directory for a CPU
 * profile of each measurement alone, without the seeding. fake-indexeddb is not Chrome's IndexedDB, so
 * the absolute times differ from a browser; the call and transaction counts and the relative
 * costs are what the numbers are for.
 */
import "fake-indexeddb/auto";
import { mkdirSync, writeFileSync } from "node:fs";
import { Session } from "node:inspector/promises";
import { performance } from "node:perf_hooks";
import { HISTORY_CAPTURE_CHANNEL, type HistoryCaptureMessage } from "../../lib/history-capture";
import { periodWindow } from "../../lib/ui/periods";
import { historyPage } from "../history-fixture";
import { BENCHMARK_PROFILE, largeProfile, settleRecalculation, type ProfileSize } from "./large-profile";

const mode = (process.argv[2] === "company" ? "company" : "personal") as "personal" | "company";
const scale = Number(process.env.BENCH_SCALE ?? "1");
// BENCH_QUICK=1 measures only the popup, the dashboard and the history reads, so the
// code before the speed work can be measured on larger profiles in reasonable time.
const quick = process.env.BENCH_QUICK === "1";
const size: ProfileSize = {
  ...BENCHMARK_PROFILE,
  chats: Math.max(20, Math.round(BENCHMARK_PROFILE.chats * scale)),
  requests: Math.max(50, Math.round(BENCHMARK_PROFILE.requests * scale)),
  historyChats: Math.max(10, Math.round(BENCHMARK_PROFILE.historyChats * scale)),
};

// Every IndexedDB transaction the background opens, by stores and mode.
let transactions = 0;
const prototype = (globalThis as any).IDBDatabase.prototype;
const transaction = prototype.transaction;
prototype.transaction = function (...args: unknown[]) {
  transactions++;
  return transaction.apply(this, args);
};

const results: Record<string, unknown> = { mode, size };
// Calls of the reads whose number grows with the profile, counted per measurement.
const calls = new Map<string, number>();
function countCalls(target: any, names: string[], prefix: string) {
  for (const name of names) {
    const original = target[name];
    if (typeof original !== "function") continue;
    target[name] = function (this: unknown, ...args: unknown[]) {
      calls.set(prefix + name, (calls.get(prefix + name) ?? 0) + 1);
      return original.apply(this, args);
    };
  }
}
const profileDir = process.env.BENCH_PROFILE;
const inspector = profileDir ? new Session() : null;
if (inspector && profileDir) {
  mkdirSync(profileDir, { recursive: true });
  inspector.connect();
  await inspector.post("Profiler.enable");
}
let profiled = 0;
async function timed<T>(label: string, work: () => Promise<T>): Promise<T> {
  const before = transactions;
  calls.clear();
  if (inspector) await inspector.post("Profiler.start");
  const started = performance.now();
  const value = await work();
  const ms = performance.now() - started;
  if (inspector && profileDir) {
    const { profile } = await inspector.post("Profiler.stop");
    const name = `${String(++profiled).padStart(2, "0")}-${label.replace(/[^a-z0-9]+/gi, "-")}.cpuprofile`;
    writeFileSync(`${profileDir}/${name}`, JSON.stringify(profile));
  }
  const counted = Object.fromEntries([...calls].sort((a, b) => b[1] - a[1]));
  results[label] = { ms: Math.round(ms), transactions: transactions - before, calls: counted };
  console.log(`${label}: ${ms.toFixed(0)} ms, ${transactions - before} transactions ${JSON.stringify(counted)}`);
  return value;
}

const profile = await largeProfile({ size, mode, log: (line) => console.log(`seed: ${line}`) });
const c = profile.coordinator;
countCalls(profile.db.estimation, ["localSelectionState", "localSelectionCurrent", "liveInput", "resultFor", "resultsFor", "originalForLive", "state", "page", "commitResult", "promote", "start"], "estimation.");
countCalls(profile.repository, ["getRecord", "currentEstimate", "historyPage", "historyRowFlags", "scanRequests", "scanAttempts", "publicationSnapshot", "commitHistory", "pendingCount", "pending"], "ledger.");
countCalls(c.engines, ["maintainLocal", "view"], "engines.");
results.historyRows = profile.historyRows;
const timezone = "Europe/Berlin";
const popup = async () => {
  const dashboard = await c.dashboard({});
  const window = periodWindow("30d", timezone, new Date());
  const [current, previous] = await Promise.all([
    c.usageBreakdown({ start: window.start, end: window.end, bucket: window.bucket, timezone }),
    c.usageBreakdown({ start: window.previous.start, end: window.previous.end, bucket: "day", timezone }),
  ]);
  return { dashboard, current, previous };
};
const first = await timed("popup cold (dashboard + 30 d + previous 30 d)", popup);
results.figures = {
  requests30d: first.current.total.requests,
  requestsPrevious: first.previous.total.requests,
  historyPrompts30d: (first.current.history as any)?.total?.prompt_count ?? null,
  view: first.current.calculation.view,
  dashboardRequests: (first.dashboard as any).summary.requests,
};
await timed("popup warm", popup);
await timed("dashboard() warm", () => c.dashboard({}));
const window = periodWindow("30d", timezone, new Date());
await timed("usageBreakdown 30 d alone", () =>
  c.usageBreakdown({ start: window.start, end: window.end, bucket: "day", timezone }),
);
const week = periodWindow("7d", timezone, new Date());
if (!quick) {
  await timed("usageBreakdown 7 d", () => c.usageBreakdown({ start: week.start, end: week.end, bucket: "day", timezone }));
  const today = periodWindow("today", timezone, new Date());
  await timed("usageBreakdown today (hours)", () =>
    c.usageBreakdown({ start: today.start, end: today.end, bucket: "hour", timezone }),
  );
  await timed("usageBreakdown all time", () => c.usageBreakdown({ bucket: "day", timezone }));
  await timed("trackingHealth", () => c.trackingHealth());
  await timed("engineStatus", () => c.engineStatus());
  await timed("monthly.read", () => c.monthly.read());
  await timed("chatComparison (Details)", () =>
    c.chatComparison("claude", "00000000-0000-4000-8000-0000000000aa"),
  );
}

// A saved-history read of a newly opened chat: the content script gives each message 30 s.
let readNumber = 0;
async function historyRead() {
  readNumber++;
  const conversationId = `00000000-0000-4000-8000-${String(900000000000 + readNumber)}`;
  const page = { ...historyPage(20), conversationId };
  const binding = { documentNonce: crypto.randomUUID(), navigationNonce: crypto.randomUUID(), captureId: null };
  const sender = { tab: { id: 7 + readNumber }, frameId: 0, documentId: `doc-${readNumber}`, url: `https://claude.ai/chat/${conversationId}` };
  const common: Omit<HistoryCaptureMessage, "event" | "page"> = {
    channel: HISTORY_CAPTURE_CHANNEL,
    id: crypto.randomUUID(),
    site: "claude",
    conversationId,
    observedAt: page.observedAt,
  };
  const start = performance.now();
  const started = await c.history.receive({ ...common, event: "start", page: null }, binding, sender);
  const startMs = performance.now() - start;
  const pageStart = performance.now();
  const accepted = await c.history.receive({ ...common, event: "page", page }, binding, sender);
  return { startMs: Math.round(startMs), pageMs: Math.round(performance.now() - pageStart), started, accepted };
}
results.historyReadAlone = await timed("history read (20 messages) alone", historyRead);
console.log(JSON.stringify(results.historyReadAlone));
// The same read while the popup loads, as when the popup opens on a chat tab.
const busy = await timed("history read while popup loads", async () => {
  const [read] = await Promise.all([historyRead(), popup()]);
  return read;
});
results.historyReadBusy = busy;
console.log(JSON.stringify(busy));
await timed("background recalculation after the reads", () => settleRecalculation(c));
await timed("popup after the history reads", popup);

if (process.env.BENCH_OUT) writeFileSync(process.env.BENCH_OUT, JSON.stringify(results, null, 2));
profile.close();
process.exit(0);
