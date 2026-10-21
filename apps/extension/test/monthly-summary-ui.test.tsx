import assert from "node:assert/strict";
import test, { before, afterEach } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import {
  act,
  cleanup,
  render,
  renderHook,
  waitFor,
} from "@testing-library/react";
import { useMonthlySummary } from "../lib/dashboard/use-monthly-summary";
import type { MonthlySummary } from "../lib/dashboard/types";
import { MonthlySummaryPanel } from "../lib/dashboard/summary-panels";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
before(() => {
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
  });
});
afterEach(cleanup);
const summary = (count: string): MonthlySummary => ({
  month: "2026-08",
  timezone: "UTC",
  generatedAt: 1,
  summary: {
    scopeToken: "a".repeat(64),
    aggregate_status: "current",
    request_count: count,
  },
});

for (const resolveWhileHidden of [false, true])
  test(`same-calculation readiness refresh preserves a monthly claim (in flight ${resolveWhileHidden})`, async () => {
    let calls = 0;
    let release!: (value: MonthlySummary) => void;
    const held = new Promise<MonthlySummary>((resolve) => {
      release = resolve;
    });
    const client = {
      monthlySummary: async () => (++calls === 1 ? held : null),
    };
    const hook = renderHook(
      ({ enabled }) =>
        useMonthlySummary(client, "a".repeat(64), enabled, "same"),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => assert.equal(calls, 1));
    if (resolveWhileHidden) hook.rerender({ enabled: false });
    await act(async () => {
      release(summary("7"));
      await held;
    });
    if (!resolveWhileHidden) hook.rerender({ enabled: false });
    hook.rerender({ enabled: true });
    await waitFor(() => assert.ok(hook.result.current.monthly));
    assert.equal(calls, 1);
    await act(async () => hook.result.current.dismiss());
    hook.rerender({ enabled: false });
    hook.rerender({ enabled: true });
    assert.equal(calls, 1);
    assert.equal(hook.result.current.monthly, null);
  });

test("a null monthly result remains retryable after readiness returns", async () => {
  let calls = 0;
  const client = {
    monthlySummary: async () => (++calls === 1 ? null : summary("9")),
  };
  const hook = renderHook(
    ({ enabled }) => useMonthlySummary(client, "a".repeat(64), enabled, "same"),
    { initialProps: { enabled: true } },
  );
  await waitFor(() => assert.equal(calls, 1));
  await act(async () => {});
  hook.rerender({ enabled: false });
  hook.rerender({ enabled: true });
  await waitFor(() => assert.ok(hook.result.current.monthly));
  assert.equal(calls, 2);
});

test("the monthly panel distinguishes recalculated and originally recorded values", () => {
  const value = {
    ...summary("7"),
    calculation: {
      view: "recalculated" as const,
      methodId: "ecologits-test-v1",
      methodHash: "e".repeat(64),
      pending: false,
    },
  };
  const panel = render(
    <MonthlySummaryPanel value={value} onClose={() => {}} />,
  );
  assert.ok(panel.getByText("Calculation: Recalculated estimates."));
  assert.equal(
    panel.queryByText("Calculation: Original recorded estimates."),
    null,
  );
  panel.rerender(
    <MonthlySummaryPanel value={summary("7")} onClose={() => {}} />,
  );
  assert.ok(panel.getByText("Calculation: Original recorded estimates."));
});

test("monthly presentation waits for readiness and discards a result from an earlier calculation", async () => {
  let calls = 0;
  let release!: (value: MonthlySummary) => void;
  const first = new Promise<MonthlySummary>((resolve) => {
    release = resolve;
  });
  const client = {
    monthlySummary: async () => (++calls === 1 ? first : summary("9")),
  };
  const hook = renderHook(
    ({ enabled, key }) =>
      useMonthlySummary(client, "a".repeat(64), enabled, key),
    { initialProps: { enabled: false, key: "original" } },
  );
  const shownCount = () => {
    const current = hook.result.current.monthly?.summary;
    return current && "request_count" in current ? current.request_count : null;
  };
  assert.equal(calls, 0);
  hook.rerender({ enabled: true, key: "original" });
  await waitFor(() => assert.equal(calls, 1));
  hook.rerender({ enabled: false, key: "ecologits" });
  await act(async () => {
    release(summary("7"));
    await first;
  });
  assert.equal(shownCount(), null);
  hook.rerender({ enabled: true, key: "ecologits" });
  await waitFor(() => assert.equal(shownCount(), "9"));
  hook.rerender({ enabled: true, key: "original-again" });
  assert.notEqual(shownCount(), "7");
});
