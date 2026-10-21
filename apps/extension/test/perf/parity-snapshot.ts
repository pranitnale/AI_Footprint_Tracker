/**
 * The popup and dashboard answers on fixed synthetic profiles, for the parity test
 * (summary-parity.test.ts). The golden file holds a hash and a few figures of every answer
 * as the code before the speed work of 15 October 2026 gave them; a faster read must give
 * the same answers byte for byte. Regenerate it only when figures change on purpose:
 *   node --import tsx test/perf/parity-snapshot.ts > test/fixtures/summary-parity.json
 */
import "fake-indexeddb/auto";
import { createHash } from "node:crypto";
import { periodWindow, type PopupPeriod } from "../../lib/ui/periods";
import { packagedMethods } from "../../lib/estimation/config";
import { largeProfile, type ProfileSize } from "./large-profile";

/** "Today" for every dataset, so windows and records stay the same on every run. */
export const PARITY_NOW = new Date("2026-10-12T10:30:00.000Z");
/** Windows the snapshot asks for: whole-hour, half-hour and 45-minute offsets, and a DST zone. */
const WINDOWS: Array<[string, PopupPeriod]> = [
  ["UTC", "today"],
  ["UTC", "30d"],
  ["Europe/Berlin", "30d"],
  ["Europe/Berlin", "7d"],
  ["Pacific/Chatham", "7d"],
  ["America/St_Johns", "today"],
  ["Asia/Kolkata", "30d"],
];
const SIZE: ProfileSize = {
  chats: 20,
  requests: 100,
  historyChats: 8,
  historyTurns: 3,
  days: 75,
  erasedRequests: 3,
  erasedDay: true,
};

/** Requests on and next to every window edge the snapshot asks for, in every zone. */
function boundaryTimes() {
  const times = new Set<string>();
  for (const [zone, period] of WINDOWS) {
    const window = periodWindow(period, zone, PARITY_NOW);
    for (const edge of [window.start, window.previous.start])
      for (const offset of [-1, 0, 1]) times.add(new Date(Date.parse(edge) + offset).toISOString());
  }
  // The window end is "now's" next midnight, after PARITY_NOW, so only edges in the past are used.
  return [...times].filter((at) => Date.parse(at) < PARITY_NOW.getTime()).sort();
}

export const PARITY_DATASETS = [
  { name: "personal-ecologits", mode: "personal", seed: 101, preference: "build_default" },
  { name: "company-ecologits", mode: "company", seed: 202, preference: "build_default" },
  { name: "personal-original", mode: "personal", seed: 303, preference: "original" },
] as const;

// Answers carry the time they were made and the session's scope token; neither is a figure.
const VOLATILE = new Set(["generatedAt", "scopeToken"]);
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !VOLATILE.has(key))
        .map(([key, entry]) => [key, stable(entry)]),
    );
  return value;
}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");

export type ParityEntry = { hash: string; figures: Record<string, unknown> };

/** Builds one dataset and returns every answer, keyed by the call that produced it. */
export async function paritySnapshot(dataset: (typeof PARITY_DATASETS)[number]) {
  const profile = await largeProfile({
    size: SIZE,
    mode: dataset.mode,
    seed: dataset.seed,
    now: PARITY_NOW,
    extraTimes: boundaryTimes(),
    preference: dataset.preference,
  });
  const c = profile.coordinator;
  const answers: Record<string, unknown> = {};
  const started = Date.now();
  const log = (label: string) => process.stderr.write(`${dataset.name}: ${label} at ${Date.now() - started} ms
`);
  try {
    log("seeded");
    for (const [zone, period] of WINDOWS) {
      const window = periodWindow(period, zone, PARITY_NOW);
      answers[`breakdown ${zone} ${period}`] = breakdown(
        await c.usageBreakdown({
          start: window.start,
          end: window.end,
          bucket: window.bucket,
          timezone: zone,
        }),
      );
      answers[`breakdown ${zone} ${period} previous`] = breakdown(
        await c.usageBreakdown({
          start: window.previous.start,
          end: window.previous.end,
          bucket: "day",
          timezone: zone,
        }),
      );
      log(`${zone} ${period}`);
    }
    answers["breakdown all time"] = breakdown(await c.usageBreakdown({ bucket: "day", timezone: "UTC" }));
    const dashboard = (value: any) => ({
      summary: withoutImageReferences(value.summary),
      history: value.history,
      calculation: value.calculation,
      mode: value.mode,
      queueCount: value.queueCount,
      refusedCount: value.refusedCount,
    });
    answers["dashboard default"] = dashboard(await c.dashboard({}));
    answers["dashboard original"] = dashboard(await c.dashboard({ calculationView: "original" }));
    if (dataset.preference !== "original")
      answers["dashboard recalculated"] = dashboard(
        await c.dashboard({ calculationView: "recalculated", methodId: packagedMethods.ecologits.method_id }),
      );
    const month = periodWindow("30d", "UTC", PARITY_NOW);
    answers["dashboard 30 d"] = dashboard(await c.dashboard({ start: month.start, end: month.end }));
    answers["dashboard claude"] = dashboard(await c.dashboard({ site: "claude" }));
    log("dashboards");
  } finally {
    profile.close();
  }
  return answers;
}

/**
 * The image benchmark references were removed on 20 October 2026 (ML.ENERGY figures without a
 * licence). They were never part of a figure. The golden answers were made again on the code
 * before the removal (71685720) with them left out, so every other part of each answer is still
 * compared byte for byte with that code.
 */
function withoutImageReferences(summary: any) {
  const { imageReferences: _references, imageReferencesOmitted: _omitted, ...rest } = summary;
  if (rest.estimate) {
    const { image_references: _estimate, ...estimate } = rest.estimate;
    if (estimate.raw?.result && !Array.isArray(estimate.raw.result)) {
      const { image_references: _raw, ...result } = estimate.raw.result;
      estimate.raw = { ...estimate.raw, result };
    }
    // Replaced in place, so the answer's keys keep their order.
    rest.estimate = estimate;
  }
  return rest;
}

/**
 * `siteLastMissed` (19 October 2026, the Tracking page) names a fact about live replies, and each
 * model's `selections` (19 October 2026, the Tools and models page) says how its replies were
 * matched to records. Neither changes a figure and the golden answers predate both, so they are
 * left out of the comparison.
 */
function breakdown(value: Record<string, unknown>) {
  const { siteLastMissed: _missed, ...rest } = value;
  // Replaced in place, so the answer's keys keep the order the golden hashes were made with.
  rest.models = Object.fromEntries(
    Object.entries(rest.models as Record<string, Record<string, unknown>>).map(([id, part]) => {
      const { selections: _selections, ...figures } = part;
      return [id, figures];
    }),
  );
  return rest;
}

export function parityEntries(answers: Record<string, unknown>): Record<string, ParityEntry> {
  return Object.fromEntries(
    Object.entries(answers).map(([key, value]: [string, any]) => [
      key,
      {
        hash: digest(value),
        figures: {
          requests: value.total?.requests ?? value.summary?.requests ?? null,
          attempts: value.total?.attempts ?? value.summary?.attempts ?? null,
          energy: (value.total ?? value.summary)?.metrics?.energy?.value ?? null,
          historyPrompts: value.history?.total?.prompt_count ?? value.history?.local?.prompt_count ?? null,
          chats: Array.isArray(value.chats) ? value.chats.length : null,
        },
      },
    ]),
  );
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("parity-snapshot.ts")) {
  const golden: Record<string, Record<string, ParityEntry>> = {};
  for (const dataset of PARITY_DATASETS) golden[dataset.name] = parityEntries(await paritySnapshot(dataset));
  process.stdout.write(JSON.stringify(golden, null, 2) + "\n");
  process.exit(0);
}
