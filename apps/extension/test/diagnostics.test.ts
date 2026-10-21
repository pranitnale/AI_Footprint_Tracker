import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CaptureWatchdog,
  isPlainSendKey,
  validateCaptureReady,
} from "../lib/capture-watchdog";
import {
  conversationBar,
  detailsPanelPlacement,
  pageHealthMessage,
  pageHealthSummary,
  serverWaterText,
} from "../lib/conversation-bar";
test("A11 absent MAIN hook degrades once even when no capture message can be emitted", () => {
  const watchdog = new CaptureWatchdog(0);
  watchdog.sent(1000);
  watchdog.activity(2000);
  assert.equal(watchdog.check(10001, true), "capture_hook_missing");
  assert.equal(watchdog.check(20000, true), null);
});
test("readiness validates liveness separately from interception and observed dispatch never promotes unverified coverage", () => {
  const nonce = "a".repeat(36),
    message = {
      channel: "ai-footprint-ready-v1",
      nonce,
      interception: "unverified",
    };
  assert.equal(validateCaptureReady(message, nonce), true);
  for (const value of [
    { ...message, interception: "healthy" },
    { ...message, nonce: "b".repeat(36) },
    { ...message, text: "PRIVATE" },
    { channel: message.channel, nonce },
  ])
    assert.equal(validateCaptureReady(value, nonce), false);
  const watchdog = new CaptureWatchdog(0);
  assert.equal(watchdog.status(9999).listener, "starting");
  watchdog.ready(10000, "unverified");
  watchdog.captured(11000);
  assert.deepEqual(watchdog.status(12000), {
    listener: "active",
    interception: "unverified",
    lastCapturedAt: 11000,
    activityGap: false,
  });
  watchdog.ready(40000, "unverified");
  assert.equal(watchdog.status(85000).listener, "active");
  assert.equal(watchdog.status(85001).listener, "missing");
  watchdog.ready(85002, "direct");
  assert.equal(watchdog.status(85002).interception, "direct");
});
test("A11 independent send and response activity diagnose changed endpoint without minting usage", () => {
  const watchdog = new CaptureWatchdog(0);
  watchdog.ready(1);
  watchdog.sent(1000);
  watchdog.activity(2000);
  assert.equal(watchdog.check(16000, true), "protocol_unsupported");
  const normal = new CaptureWatchdog(0);
  normal.ready(1);
  normal.sent(1000);
  normal.activity(2000);
  normal.captured(1100);
  assert.equal(normal.check(16000, true), null);
  const idle = new CaptureWatchdog(0);
  idle.ready(1);
  idle.sent(1000);
  assert.equal(idle.check(16000, true), null);
  const paused = new CaptureWatchdog(0);
  paused.sent(1000);
  paused.activity(2000);
  assert.equal(paused.check(16000, false), null);
});
test("a later direct heartbeat neither erases nor recounts an earlier missed activity gap", () => {
  const watchdog = new CaptureWatchdog(0);
  watchdog.ready(1, "unverified");
  watchdog.sent(1000);
  watchdog.activity(2000);
  assert.equal(watchdog.check(16000, true), "capture_hook_missing");
  watchdog.ready(17000, "direct");
  assert.equal(watchdog.status(17000).activityGap, true);
  assert.equal(watchdog.check(17000, true), null);
});
for (const interception of ["direct", "unverified"] as const)
  test(`recovered ${interception} listener reports a later heartbeat outage once`, () => {
    const watchdog = new CaptureWatchdog(0);
    watchdog.ready(1, interception);
    assert.equal(watchdog.check(45001, true), null);
    assert.equal(watchdog.check(45002, true), "capture_hook_missing");
    assert.equal(watchdog.check(49000, true), null);
    watchdog.ready(50000, interception);
    assert.equal(watchdog.check(50000, true), null);
    assert.equal(watchdog.check(95000, true), null);
    assert.equal(watchdog.check(95001, true), "capture_hook_missing");
    assert.equal(watchdog.check(99000, true), null);
  });
test("heartbeat recovery and repeated updates preserve one activity gap while later outages still report", () => {
  const watchdog = new CaptureWatchdog(0);
  watchdog.ready(1, "direct");
  watchdog.sent(1000);
  watchdog.activity(2000);
  assert.equal(watchdog.check(16000, true), "protocol_unsupported");
  for (const [now, interception] of [
    [17000, "unverified"],
    [18000, "direct"],
    [19000, "unverified"],
  ] as const) {
    watchdog.ready(now, interception);
    assert.equal(watchdog.check(now, true), null);
    assert.equal(watchdog.status(now).activityGap, true);
  }
  assert.equal(watchdog.check(64001, true), "capture_hook_missing");
  watchdog.ready(65000, "direct");
  assert.equal(watchdog.check(65000, true), null);
  assert.equal(watchdog.status(65000).activityGap, true);
  assert.equal(watchdog.check(110001, true), "capture_hook_missing");
  assert.equal(watchdog.check(110002, true), null);
});
test("listener outage covering missed activity is not recounted when readiness returns", () => {
  const watchdog = new CaptureWatchdog(0);
  watchdog.ready(1, "unverified");
  watchdog.sent(40000);
  watchdog.activity(41000);
  assert.equal(watchdog.check(45002, true), "capture_hook_missing");
  assert.equal(watchdog.check(55000, true), null);
  watchdog.ready(56000, "direct");
  assert.equal(watchdog.status(56000).activityGap, true);
  assert.equal(watchdog.check(56000, true), null);
  watchdog.sent(57000);
  watchdog.activity(58000);
  assert.equal(watchdog.check(72000, true), "protocol_unsupported");
  assert.equal(watchdog.check(73000, true), null);
});
test("foreground renewal follows wall clock and keeps normal startup and heartbeat deadlines", () => {
  const watchdog = new CaptureWatchdog(0);
  for (let now = 1000; now <= 9000; now += 1000) {
    assert.equal(watchdog.poll(now).probe, true);
    assert.equal(watchdog.check(now, true), null);
  }
  watchdog.poll(10000);
  assert.equal(watchdog.check(10000, true), "capture_hook_missing");
  watchdog.ready(10001, "direct");
  for (const now of [11000, 20000, 29000])
    assert.equal(watchdog.poll(now).refreshStatus, false);
  assert.equal(watchdog.poll(30000).refreshStatus, true);
  for (const now of [40000, 50000, 55001]) watchdog.poll(now);
  assert.equal(watchdog.check(55001, true), null);
  watchdog.poll(55002);
  assert.equal(watchdog.check(55002, true), "capture_hook_missing");
});
test("delayed timer probes immediately and responsive hook avoids a fabricated outage", () => {
  const watchdog = new CaptureWatchdog(0);
  watchdog.ready(10000, "direct");
  watchdog.poll(11000);
  assert.deepEqual(watchdog.poll(71000), { probe: true, refreshStatus: true });
  assert.equal(watchdog.status(71000).listener, "starting");
  assert.equal(watchdog.check(71000, true), null);
  watchdog.ready(71001, "unverified");
  assert.equal(watchdog.status(71001).listener, "active");
  assert.equal(watchdog.status(71001).interception, "unverified");
  assert.deepEqual(watchdog.poll(72000), {
    probe: false,
    refreshStatus: false,
  });
  assert.equal(watchdog.check(72000, true), null);
  for (const now of [81000, 91000, 100000])
    assert.equal(watchdog.poll(now).refreshStatus, false);
  assert.equal(watchdog.poll(101000).refreshStatus, true);
});
test("silent resumed hook fails after one reply grace even if later ticks are also throttled", () => {
  for (const next of [81000, 131000]) {
    const watchdog = new CaptureWatchdog(0);
    watchdog.ready(10000, "direct");
    watchdog.poll(11000);
    watchdog.poll(71000);
    assert.equal(watchdog.check(71000, true), null);
    if (next === 81000) {
      for (let now = 72000; now < 81000; now += 1000) {
        watchdog.poll(now);
        assert.equal(watchdog.check(now, true), null);
      }
    }
    watchdog.poll(next);
    assert.equal(watchdog.status(next).listener, "missing");
    assert.equal(watchdog.check(next, true), "capture_hook_missing");
    watchdog.poll(next + 1000);
    assert.equal(watchdog.check(next + 1000, true), null);
  }
});
test("delayed initial scheduling and bfcache resume use bounded grace without clearing diagnosed outages", () => {
  const initial = new CaptureWatchdog(0);
  assert.equal(initial.poll(60000).refreshStatus, true);
  assert.equal(initial.check(60000, true), null);
  initial.poll(70000);
  assert.equal(initial.check(70000, true), "capture_hook_missing");
  assert.equal(initial.poll(71000, true).refreshStatus, true);
  assert.equal(initial.status(71000).listener, "missing");
  const restored = new CaptureWatchdog(0);
  restored.ready(1, "direct");
  restored.poll(50000, true);
  assert.equal(restored.check(50000, true), null);
  restored.poll(51000, true);
  restored.poll(60000);
  assert.equal(restored.check(60000, true), "capture_hook_missing");
});
test("scheduler grace leaves real activity gaps detectable and earlier reports intact", () => {
  const watchdog = new CaptureWatchdog(0);
  watchdog.ready(1, "direct");
  watchdog.poll(11000);
  watchdog.sent(55000);
  watchdog.activity(56000);
  watchdog.poll(71000);
  assert.equal(watchdog.status(71000).listener, "starting");
  assert.equal(watchdog.status(71000).activityGap, true);
  assert.equal(watchdog.check(71000, true), "protocol_unsupported");
  watchdog.ready(72000, "unverified");
  assert.equal(watchdog.status(72000).activityGap, true);
  assert.equal(watchdog.check(72000, true), null);
});
test("A11 plain Enter excludes IME and modified multiline/navigation keys", () => {
  const key = {
    key: "Enter",
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    isComposing: false,
  };
  assert.equal(isPlainSendKey(key), true);
  for (const flag of [
    "shiftKey",
    "ctrlKey",
    "altKey",
    "metaKey",
    "isComposing",
  ])
    assert.equal(isPlainSendKey({ ...key, [flag]: true }), false);
});
test("page health distinguishes current causes from earlier unrecovered gaps", () => {
  const earlier = {
    code: "storage_write_failed" as const,
    context: "capture" as const,
    firstAt: 1,
    lastAt: 2,
    count: 2,
    active: false,
  };
  const current = {
    code: "site_access_removed" as const,
    context: "permission" as const,
    firstAt: 3,
    lastAt: 3,
    count: 1,
    active: true,
  };
  assert.deepEqual(pageHealthSummary([earlier]), {
    active: 0,
    occurrences: 2,
    status: "2 earlier tracking problems",
  });
  assert.deepEqual(pageHealthSummary([earlier, current]), {
    active: 1,
    occurrences: 3,
    status: "1 current tracking problem",
  });
  assert.match(
    pageHealthMessage(current.code).effect,
    /permission is missing/i,
  );
  assert.doesNotMatch(
    pageHealthMessage("protocol_unsupported").effect,
    /could not be saved/i,
  );
});

test("narrow viewport keeps the Details header above the visible margin", () => {
  const placement = detailsPanelPlacement(
    { top: 367.825, bottom: 652.025 },
    700,
  );
  assert.equal(placement.placement, "above");
  assert.ok(placement.maxHeight <= 349.825);
  assert.ok(367.825 - 6 - placement.maxHeight >= 12);
  assert.deepEqual(detailsPanelPlacement({ top: 600, bottom: 640 }, 900), {
    placement: "above",
    maxHeight: 460,
  });
});
// claude.ai keeps the composer in a scroll pane below a 48 px header; a panel sized to the
// window lost its heading under the pane's top edge (live, 12 October 2026).
test("Details fits inside the scrolling pane that holds the bar", () => {
  const anchor = { top: 446, bottom: 476 };
  // Provider header bars take the top 64 px of the window.
  assert.equal(detailsPanelPlacement(anchor, 800).maxHeight, 364);
  const pane = detailsPanelPlacement(anchor, 800, { top: 120, bottom: 800 });
  assert.equal(pane.placement, "above");
  assert.equal(pane.maxHeight, 308);
  assert.ok(anchor.top - 6 - pane.maxHeight >= 120 + 12);
  // A pane that ends above the window bottom bounds a panel that opens below.
  assert.deepEqual(detailsPanelPlacement({ top: 100, bottom: 130 }, 900, { top: 90, bottom: 500 }), {
    placement: "below",
    maxHeight: 352,
  });
});
test("bar includes six metrics, exact carbon gas distinction, estimate markers and independent health", () => {
  const summary: any = {
    requests: 1,
    tokens: { input: { value: "4" }, output: { value: "6" } },
    metrics: {
      energy: { value: ".001", unknown: 0 },
      carbon: { value: ".2", unit: "g CO2", unknown: 0 },
      water: { value: ".01", unknown: 0 },
    },
  };
  const result = conversationBar(summary, { failure: false });
  for (const text of [
    "Req 1",
    "In/Out tokens - ≈ 4/6",
    "Electricity",
    "Carbon",
    "Water",
    "≈",
  ])
    assert.ok(result.text.includes(text));
  assert.ok(result.text.includes("g CO₂"));
  assert.ok(!result.text.includes("CO₂e"));
  assert.equal(result.status, "Recorded");
  assert.equal(
    conversationBar(summary, { failure: false, state: "generating" }).status,
    "Processing",
  );
  // Waiting uploads are a Details sync icon, not a bar status (owner, 13 Oct 2026), so the
  // bar takes no upload count at all.
  // Generated images are inside the resource figures (D5), never a separate bar label,
  // and a partial measurement is explained in Details, never a bar status (2 Oct).
  summary.images = { operations: 1, returned: "1" };
  assert.equal(conversationBar(summary, { failure: false }).status, "Recorded");
  assert.doesNotMatch(
    conversationBar(summary, { failure: false }).text,
    /Images|image energy/,
  );
  assert.equal(
    conversationBar(summary, { failure: true }).status,
    "Tracking problem",
  );
});

test("a waiting recalculation reads Updating, below failures and generation", () => {
  const summary: any = {
    requests: 2,
    tokens: { input: { value: "4" }, output: { value: null } },
    metrics: {
      energy: { value: null, unknown: 1 },
      carbon: { value: null, unknown: 1 },
      water: { value: null, unknown: 1 },
    },
  };
  // Missing figures show as Unknown; Details says what was not measured.
  assert.equal(conversationBar(summary, { failure: false }).status, "Recorded");
  assert.equal(
    conversationBar(summary, { failure: false, pending: true }).status,
    "Updating",
  );
  assert.equal(
    conversationBar(summary, { failure: false, pending: true, state: "generating" }).status,
    "Processing",
  );
  assert.equal(
    conversationBar(summary, { failure: true, pending: true }).status,
    "Tracking problem",
  );
  const empty: any = {
    requests: 0,
    tokens: { input: { value: null }, output: { value: null } },
    metrics: {
      energy: { value: null, unknown: 0 },
      carbon: { value: null, unknown: 0 },
      water: { value: null, unknown: 0 },
    },
  };
  assert.equal(conversationBar(empty, { failure: false, pending: true }).status, "");
});

test("capture overload and unshown figures have specific page health messages", () => {
  assert.equal(pageHealthMessage("buffer_overflow").title, "Too many updates at once");
  assert.equal(
    pageHealthMessage("aggregate_inconsistent").title,
    "Figures could not be refreshed",
  );
  for (const code of ["buffer_overflow", "aggregate_inconsistent"] as const)
    assert.doesNotMatch(
      Object.values(pageHealthMessage(code)).join(" "),
      /—/,
    );
});

function waterSummary(water: any, waterDirect?: any, waterUpstream?: any) {
  return {
    requests: 1,
    tokens: { input: { value: "4" }, output: { value: "6" } },
    metrics: {
      energy: { value: ".001", unknown: 0 },
      carbon: { value: ".2", unit: "gCO2e", unknown: 0 },
      water,
      waterDirect,
      waterUpstream,
    },
  };
}

test("bar keeps an available combined water total compact", () => {
  const result = conversationBar(
    waterSummary(
      { value: "3", unit: "L", unknown: 0 },
      { value: "1", unit: "L", unknown: 0 },
      { value: "2", unit: "L", unknown: 0 },
    ),
    { failure: false },
  );
  assert.match(result.text, /Water ≈ 3 L/);
  assert.doesNotMatch(
    result.text,
    /Combined water|Direct water|Electricity-supply/,
  );
});

test("bar keeps an unavailable combined water total compact and leaves its parts to Details", () => {
  const result = conversationBar(
    waterSummary(
      { value: null, unit: "L", unknown: 1 },
      { value: "1", unit: "L", unknown: 0 },
      { value: "2", unit: "L", unknown: 0 },
    ),
    { failure: false },
  );
  assert.match(result.text, /Water Unknown/);
  assert.doesNotMatch(
    result.text,
    /Combined water|Direct water|Electricity-supply/,
  );
  assert.doesNotMatch(result.text, /Water ≈ 3 L/, "parts are never summed");
  assert.equal(result.status, "Recorded");
});

test("bar preserves an unknown water component without converting it to zero", () => {
  const result = conversationBar(
    waterSummary(
      { value: null, unit: "L", unknown: 1 },
      { value: null, unit: "L", unknown: 1 },
      { value: "2", unit: "L", unknown: 0 },
    ),
    { failure: false },
  );
  assert.match(result.text, /Water Unknown/);
  assert.doesNotMatch(result.text, /Water ≈ 2 L/);
  assert.doesNotMatch(result.text, /Water ≈ 0/);
});

test("bar labels incompatible water groups instead of aggregating them", () => {
  const result = conversationBar(
    waterSummary(
      {
        value: null,
        unit: "L",
        unknown: 0,
        reason: "incompatible_scopes",
        groups: [{ value: "1" }, { value: "2" }],
      },
      {
        value: null,
        unit: "L",
        unknown: 0,
        reason: "incompatible_scopes",
        groups: [{ value: "1" }, { value: "2" }],
      },
      { value: "4", unit: "L", unknown: 0, groups: [{ value: "4" }] },
    ),
    { failure: false },
  );
  assert.match(result.text, /Water See Details/);
  assert.doesNotMatch(result.text, /Water ≈ [3457] L/);
});

test("synced water presentation preserves duplicate groups and partial components", () => {
  const result = serverWaterText([
    { quantity: "water_total", value: null, unit: "L", unknown_count: "1" },
    { quantity: "water_direct", value: "1", unit: "L", unknown_count: "0" },
    { quantity: "water_direct", value: "2", unit: "L", unknown_count: "0" },
    {
      quantity: "water_upstream",
      value: "4",
      unit: "L",
      unknown_count: "2",
    },
  ]);
  assert.equal(result, "Water Unknown");
  assert.equal(
    serverWaterText([
      { quantity: "water_total", value: "1", unit: "L", unknown_count: "0" },
      { quantity: "water_total", value: "2", unit: "L", unknown_count: "0" },
    ]),
    "Water See Details",
  );
});

test("bar and water text follow the display scenario for ranged metrics", () => {
  const summary: any = {
    requests: 1,
    tokens: { input: { value: "4" }, output: { value: "6" } },
    metrics: {
      energy: {
        value: ".002",
        unknown: 0,
        value_kind: "midpoint_sum",
        scenario_low: ".001",
        scenario_high: ".003",
      },
      carbon: { value: ".2", unit: "gCO2e", unknown: 0 },
      water: {
        value: ".02",
        unit: "L",
        unknown: 0,
        value_kind: "midpoint_sum",
        scenario_low: ".01",
        scenario_high: ".03",
      },
    },
  };
  // Midpoint is the shipped default.
  assert.match(
    conversationBar(summary, { failure: false }).text,
    /Electricity ≈ 2 Wh/,
  );
  const minimum = conversationBar(summary, { failure: false }, "minimum").text;
  assert.match(minimum, /Electricity ≈ 1 Wh/);
  assert.match(minimum, /Water ≈ 10 mL/);
  assert.match(minimum, /Carbon ≈ 0.2 g CO₂e/);
  assert.match(
    conversationBar(summary, { failure: false }, "maximum").text,
    /Electricity ≈ 3 Wh/,
  );
  assert.match(
    conversationBar(summary, { failure: false }, "midpoint").text,
    /Water ≈ 20 mL/,
  );
  const ranged = {
    quantity: "water_total",
    value: ".02",
    unit: "L",
    value_kind: "midpoint_sum" as const,
    scenario_low: ".01",
    scenario_high: ".03",
  };
  assert.match(serverWaterText([ranged]), /Water ≈ 20 mL/);
  assert.match(serverWaterText([ranged], "minimum"), /Water ≈ 10 mL/);
  assert.match(serverWaterText([ranged], "maximum"), /Water ≈ 30 mL/);
  assert.match(
    serverWaterText([{ ...ranged, scenario_low: null, scenario_high: null }]),
    /Water ≈ 20 mL/,
  );
});
