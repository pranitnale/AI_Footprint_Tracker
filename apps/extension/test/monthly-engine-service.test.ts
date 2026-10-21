import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  Ledger,
  createMemoryRepository,
  type Scope,
  type StoredCredentials,
  type MonthlyViewClaim,
} from "@footprint/ledger";
import { canonicalJson, type HistoryView } from "@footprint/contracts";
import {
  createMethodRegistry,
  LocalEstimateExecutor,
  emptyHistorySummary,
} from "@footprint/estimator";
import { archivedConfiguration as config } from "./archived-engine-fixture";
import mappings from "../../../config/estimation.mappings.json";
import media from "../../../config/estimation.media.json";
import { records } from "../../../packages/ledger/test/factory";
import { Coordinator } from "../lib/coordinator";
import { CompanyClient } from "../lib/company";
import { createDashboardClient } from "../lib/dashboard/client";
import type { ServerSummary } from "../lib/dashboard/types";
import { usageFigures } from "../lib/ui/usage-figures";
import { unavailableCount } from "./counting-fixture";
import { serverHistory } from "./ui-fixtures";

const now = new Date("2026-09-15T12:00:00.000Z");
const observedAt = "2026-08-15T12:00:00.000Z";
const methods = createMethodRegistry(config, mappings, media);
const local = new LocalEstimateExecutor(methods);
const origin = "https://monthly.example";
type Backend = "indexeddb" | "memory";
type Mode = "personal" | "company";

function credentials(): StoredCredentials {
  const companyId = crypto.randomUUID(),
    userId = crypto.randomUUID();
  return {
    origin,
    namespace: `company:${companyId}:${userId}`,
    company_id: companyId,
    user_id: userId,
    device_id: crypto.randomUUID(),
    access_token: "synthetic-monthly-access",
    refresh_token: "synthetic-monthly-refresh",
    access_expires_at: "2099-01-01T00:00:00.000Z",
    refresh_expires_at: "2099-01-01T00:00:00.000Z",
    installation_reconnect_secret: "synthetic-monthly-reconnect",
    deletion_receipt_credential: "synthetic-monthly-receipt",
    deletion_public_key: "synthetic-monthly-public-key",
    user_hmac_key: "b".repeat(64),
    key_version: "1",
    policy: {
      policy_version: "1.0.0",
      disclosure_version: "1.0.0",
      pause_mode: "user_controlled",
      timezone: "UTC",
      usage_retention_months: null,
      ip_retention_days: 0,
      deletion_epoch: 0,
    },
    enrollment_era: {
      id: crypto.randomUUID(),
      start: "2026-07-01T00:00:00.000Z",
      end: null,
    },
  };
}

async function fixture(
  t: test.TestContext,
  backend: Backend,
  mode: Mode,
  injectSession = false,
) {
  const db =
    backend === "indexeddb"
      ? await Ledger.open(`monthly-engine-${crypto.randomUUID()}`)
      : null;
  const repository = db?.application ?? createMemoryRepository();
  const c = mode === "company" ? credentials() : undefined;
  const personal = {
    namespace: `personal:${crypto.randomUUID()}`,
    secret: "a".repeat(64),
  };
  const scope: Scope = c
    ? { namespace: c.namespace, mode, era: c.enrollment_era.id }
    : { namespace: personal.namespace, mode, era: null };
  await repository.applySessionChanges({
    personal,
    installation: { routingSecret: "c".repeat(64) },
    settings: { paused: false, budget: null, timezone: "UTC" },
    ...(c ? { credentials: c } : {}),
    ownershipHistory: {
      eras: [
        {
          scope,
          secret: c?.user_hmac_key ?? personal.secret,
          policyVersion: "1.0.0",
          start: 0,
          end: null,
        },
      ],
    },
  });
  const pair = records();
  pair[0].dispatched_at = observedAt;
  pair[0].ended_at = observedAt;
  pair[0].state = "completed";
  pair[1].started_at = observedAt;
  pair[1].ended_at = observedAt;
  pair[1].state = "completed";
  pair[1].proposed_method_id = methods.original.method_id;
  const original = await local.estimate({
    family: "live",
    request: pair[0],
    attempt: pair[1],
  });
  await repository.commitCapture({
    scope,
    observations: pair,
    originals: [original],
    currentEstimate: { attemptId: pair[1].attempt_id, estimate: original },
  });
  const controls: {
    failEstimate: boolean;
    serverStatus: "current" | "rebuilding";
    beforeResponse?: () => Promise<void>;
    /** The organization server's answer to /v1/company/summary, for the dashboard's own reads. */
    companySummary?: Record<string, unknown>;
  } = { failEstimate: false, serverStatus: "current" };
  const calls: URL[] = [];
  const transport: typeof fetch = async (input, init) => {
    assert.equal(
      mode,
      "company",
      "Personal monthly summaries must stay offline",
    );
    const url = new URL(String(input));
    assert.equal(url.origin, origin);
    if (controls.companySummary && url.pathname === "/v1/company/summary") {
      calls.push(url);
      return new Response(JSON.stringify(controls.companySummary));
    }
    assert.equal(url.pathname, "/v1/me/summary");
    assert.equal(init?.credentials, "omit");
    calls.push(url);
    const selected = methods.get(url.searchParams.get("method_id") ?? "");
    const response = {
      aggregate_status: controls.serverStatus,
      calculation_view: selected ? "recalculated" : "original",
      ...(selected
        ? {
            method_id: selected.method_id,
            method_hash: selected.method_hash,
            recalculation_job_id: "d".repeat(64),
            recalculated_at: now.toISOString(),
          }
        : {}),
      request_count: selected?.engine_id === "ecologits" ? "13" : "7",
      attempt_count: "1",
      tokens: [],
      resources: [],
      range_start: "2026-08-01T00:00:00.000Z",
      range_end: "2026-09-01T00:00:00.000Z",
    };
    await controls.beforeResponse?.();
    return new Response(JSON.stringify(response));
  };
  const coordinator = new Coordinator(repository, {
    count: unavailableCount,
    hasConsent: async () => true,
    sendDisplay: async () => {},
    transport,
    ...(injectSession
      ? {
          organization: new CompanyClient(
            repository,
            transport,
            async () => true,
          ),
        }
      : {}),
    estimation: {
      methods,
      executor: {
        executionOrigin: "local",
        estimate: (...args) => {
          if (controls.failEstimate && args[1]?.view === "recalculated")
            throw new Error("synthetic selected calculation failure");
          return local.estimate(...args);
        },
      },
    },
  });
  // The monthly path still uses the real selectedServerSummary and authenticated transport.
  // Loaded-chat history is isolated because this fixture contains only recorded live requests.
  coordinator.history.view = async (): Promise<HistoryView> => ({
    local: emptyHistorySummary(),
    pending: null,
    server: null,
    server_status: "unavailable",
    coverage: "partial_loaded_history",
  });
  await coordinator.whenReady();
  await coordinator.engines.maintainLocal();
  t.after(() => {
    coordinator.engines.dispose();
    coordinator.history.invalidate();
    db?.close();
  });
  async function choose(preference: "original" | "ecologits", complete = true) {
    const state = await repository.estimation.readPreferenceState();
    assert.equal(state.status, "valid");
    if (state.status !== "valid") assert.fail("Missing engine preference");
    assert.equal(
      await repository.estimation.compareAndSetPreference(state.revision, {
        schema_version: "1.0.0",
        preference,
        selection_revision: state.revision + 1,
        updated_at: now.toISOString(),
      }),
      true,
    );
    if (complete) await coordinator.engines.maintainLocal();
  }
  async function retained() {
    const page = await repository.estimation.viewPage({
      scope,
      view: "original",
    });
    assert.equal(canonicalJson(page.rows[0]?.result), canonicalJson(original));
    assert.deepEqual(
      (
        await repository.getRecord(
          scope.namespace,
          "attempt",
          pair[1].attempt_id,
        )
      )?.record,
      pair[1],
    );
  }
  return {
    repository,
    coordinator,
    scope,
    pair,
    original,
    controls,
    calls,
    choose,
    retained,
  };
}

for (const backend of ["indexeddb", "memory"] as const) {
  for (const mode of ["personal", "company"] as const) {
    for (const preference of [
      "build_default",
      "original",
      "ecologits",
    ] as const) {
      test(`${backend} ${mode}: monthly ${preference} identifies the calculation and retains originals`, async (t) => {
        const f = await fixture(t, backend, mode, preference === "ecologits");
        if (preference !== "build_default") await f.choose(preference);
        const result = await f.coordinator.monthly.read(now);
        assert.ok(result);
        const method =
          preference === "build_default" ? null : methods[preference];
        assert.deepEqual(result.calculation, {
          view: method ? "recalculated" : "original",
          methodId: method?.method_id ?? null,
          methodHash: method?.method_hash ?? null,
          pending: false,
        });
        assert.deepEqual(result.summary.calculation, result.calculation);
        assert.equal(result.month, "2026-08");
        assert.equal(result.timezone, "UTC");
        if (mode === "company") {
          assert.ok("request_count" in result.summary);
          assert.equal(
            result.summary.request_count,
            preference === "ecologits" ? "13" : "7",
          );
          assert.equal(f.calls.length, 1);
          assert.equal(
            f.calls[0].searchParams.get("method_id"),
            method?.method_id ?? null,
          );
          assert.equal(f.calls[0].searchParams.get("start"), "2026-08-01");
          assert.equal(f.calls[0].searchParams.get("end"), "2026-09-01");
        } else {
          assert.ok("requests" in result.summary);
          assert.equal(result.summary.requests, 1);
          assert.equal(f.calls.length, 0);
          assert.ok("estimate" in result.summary);
          const expected = method
            ? (
                await f.repository.estimation.viewPage({
                  scope: f.scope,
                  view: "selected",
                })
              ).rows[0]?.result
            : f.original;
          assert.equal(
            canonicalJson(result.summary.estimate),
            canonicalJson(expected),
          );
        }
        assert.equal(
          await f.repository.lastClaimedMonth(f.scope.namespace),
          "2026-08",
        );
        assert.equal(await f.coordinator.monthly.read(now), null);
        await f.retained();
      });
    }

    test(`${backend} ${mode}: pending and failed selected work never consumes the monthly claim`, async (t) => {
      const f = await fixture(t, backend, mode);
      f.controls.failEstimate = true;
      await f.choose("ecologits", false);
      assert.equal(await f.coordinator.monthly.read(now), null);
      assert.equal(
        await f.repository.lastClaimedMonth(f.scope.namespace),
        null,
      );
      await f.coordinator.engines.maintainLocal();
      assert.equal((await f.coordinator.engines.view(f.scope)).pending, true);
      assert.equal(await f.coordinator.monthly.read(now), null);
      assert.equal(
        await f.repository.lastClaimedMonth(f.scope.namespace),
        null,
      );
      assert.equal(f.calls.length, 0);
      f.controls.failEstimate = false;
      await f.coordinator.engines.maintainLocal();
      assert.ok(await f.coordinator.monthly.read(now));
      await f.retained();
    });

    test(`${backend} ${mode}: concurrent completed monthly reads claim the month once`, async (t) => {
      const f = await fixture(t, backend, mode);
      await f.choose("ecologits");
      const results = await Promise.all(
        Array.from({ length: 6 }, () => f.coordinator.monthly.read(now)),
      );
      assert.equal(results.filter(Boolean).length, 1);
      assert.equal(
        await f.repository.lastClaimedMonth(f.scope.namespace),
        "2026-08",
      );
    });

    for (const phase of ["query", "claim"] as const) {
      test(`${backend} ${mode}: an engine switch during ${phase} retries with the new numbers`, async (t) => {
        const f = await fixture(t, backend, mode);
        let switched = false;
        const change = async () => {
          if (switched) return;
          switched = true;
          await f.choose("ecologits");
        };
        if (phase === "claim") {
          const claim = f.repository.claimMonthlyView.bind(f.repository);
          f.repository.claimMonthlyView = async (command) => {
            await change();
            return claim(command);
          };
        } else if (mode === "company") f.controls.beforeResponse = change;
        else {
          const scan = f.repository.scanAttempts.bind(f.repository);
          f.repository.scanAttempts = async (...args) => {
            await scan(...args);
            await change();
          };
        }
        const result = await f.coordinator.monthly.read(now);
        assert.equal(switched, true);
        assert.ok(result);
        assert.equal(
          result.calculation.methodHash,
          methods.ecologits.method_hash,
        );
        if (mode === "company") {
          assert.ok("request_count" in result.summary);
          assert.equal(result.summary.request_count, "13");
        } else {
          assert.ok("estimate" in result.summary);
          const selected = (
            await f.repository.estimation.viewPage({
              scope: f.scope,
              view: "selected",
            })
          ).rows[0]?.result;
          assert.equal(
            canonicalJson(result.summary.estimate),
            canonicalJson(selected),
          );
          assert.notEqual(
            canonicalJson(result.summary.estimate),
            canonicalJson(f.original),
          );
        }
        await f.retained();
      });
    }

    test(`${backend} ${mode}: a timezone change rejects the stale claim before retrying`, async (t) => {
      const f = await fixture(t, backend, mode);
      const claim = f.repository.claimMonthlyView.bind(f.repository);
      const attempts: Array<{ timezone: string; result: string }> = [];
      f.repository.claimMonthlyView = async (command) => {
        if (!attempts.length) {
          if (mode === "company") {
            const c = (await f.repository.readCredentials())!;
            await f.repository.applySessionChanges({
              credentials: {
                ...c,
                policy: { ...c.policy, timezone: "Europe/Berlin" },
              },
            });
          } else
            await f.repository.applySessionChanges({
              settings: {
                paused: false,
                budget: null,
                timezone: "Europe/Berlin",
              },
            });
        }
        const result = await claim(command);
        attempts.push({ timezone: command.timezone, result });
        return result;
      };
      const result = await f.coordinator.monthly.read(now);
      assert.ok(result);
      assert.equal(result.timezone, "Europe/Berlin");
      assert.deepEqual(attempts, [
        { timezone: "UTC", result: "stale" },
        { timezone: "Europe/Berlin", result: "claimed" },
      ]);
    });

    test(`${backend} ${mode}: erasure at the claim boundary cannot publish deleted numbers`, async (t) => {
      const f = await fixture(t, backend, mode);
      const claim = f.repository.claimMonthlyView.bind(f.repository);
      let erased = false;
      const outcomes: string[] = [];
      f.repository.claimMonthlyView = async (command: MonthlyViewClaim) => {
        if (!erased) {
          erased = true;
          await f.repository.eraseFamily(
            f.scope.namespace,
            f.pair[0].request_id,
          );
          if (mode === "company") f.controls.serverStatus = "rebuilding";
        }
        const result = await claim(command);
        outcomes.push(result);
        return result;
      };
      const result = await f.coordinator.monthly.read(now);
      assert.equal(outcomes[0], "stale");
      if (mode === "company") {
        assert.equal(result, null);
        assert.equal(
          await f.repository.lastClaimedMonth(f.scope.namespace),
          null,
        );
      } else {
        assert.ok(result);
        assert.ok("requests" in result.summary);
        assert.ok("estimate" in result.summary);
        assert.equal(result.summary.requests, 0);
        assert.equal(result.summary.estimate, null);
      }
    });
  }

  test(`${backend} company: a server calculation still rebuilding does not consume the month`, async (t) => {
    const f = await fixture(t, backend, "company");
    await f.choose("ecologits");
    f.controls.serverStatus = "rebuilding";
    assert.equal(await f.coordinator.monthly.read(now), null);
    assert.equal(await f.repository.lastClaimedMonth(f.scope.namespace), null);
    f.controls.serverStatus = "current";
    assert.ok(await f.coordinator.monthly.read(now));
  });
}

test("organization splits that carry saved history reach the dashboard with that history counted", async (t) => {
  // Live on 21 October 2026: the server sends each day, tool and model split with its own saved
  // history, and the dashboard refused the whole answer ("Organization totals could not load").
  const f = await fixture(t, "memory", "company");
  const part = (requests: string, saved: string) => ({
    aggregate_status: "current",
    calculation_view: "original",
    request_count: requests,
    attempt_count: requests,
    tokens: [],
    resources: [],
    range_start: "2026-10-20T00:00:00.000Z",
    range_end: "2026-10-22T00:00:00.000Z",
    history: serverHistory(saved),
  });
  f.controls.companySummary = {
    ...part("3", "3"),
    active_users: "2",
    days: { "2026-10-20": part("1", "1"), "2026-10-21": part("2", "2") },
    sites: { chatgpt: part("3", "3") },
    models: { "gpt-5-6-sol": { ...part("3", "3"), site: "chatgpt" } },
  };
  const query = "?period=custom&start=2026-10-20&end=2026-10-22";
  // The dashboard's own check of what the background answers, as the Organization pages read it.
  const client = createDashboardClient(async (action, payload) => {
    assert.equal(action, "company-summary");
    return f.coordinator.selectedServerSummary(
      "company",
      String(payload!.query),
    );
  });
  const summary = (await client.serverSummary("company", query)) as ServerSummary & {
    days?: Record<string, ServerSummary>;
    sites?: Record<string, ServerSummary>;
    models?: Record<string, ServerSummary & { site?: string }>;
  };
  assert.equal(f.calls.at(-1)!.pathname, "/v1/company/summary");
  assert.deepEqual(summary.history?.server, serverHistory("3"));
  // Each split's saved history is read the way the whole summary's is (orgFigures in
  // lib/dash/OrgOverview.tsx), so the daily bars, tools and models add the same saved requests.
  const figures = (value: ServerSummary | undefined) =>
    usageFigures(value!, value!.history?.server ?? null, "midpoint").requests;
  assert.equal(figures(summary), 6n);
  assert.deepEqual(summary.days!["2026-10-21"].history?.server, serverHistory("2"));
  assert.equal(figures(summary.days!["2026-10-20"]), 2n);
  assert.equal(figures(summary.days!["2026-10-21"]), 4n);
  assert.equal(figures(summary.sites!.chatgpt), 6n);
  assert.equal(figures(summary.models!["gpt-5-6-sol"]), 6n);
  assert.equal(summary.models!["gpt-5-6-sol"].site, "chatgpt");
});
