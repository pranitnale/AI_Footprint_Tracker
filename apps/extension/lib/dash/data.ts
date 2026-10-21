import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardClient } from "../dashboard/client";
import type { Dashboard, ServerSummary, TrackingHealthResponse, UsageBreakdownView } from "../dashboard/types";
import { buildUsageFilters } from "../ui-model";

/**
 * Loading rules shared by every dashboard page, carried over from the earlier dashboard:
 * - a reply from another data scope (a connect, disconnect or erase in between) is never shown;
 *   the page reloads once from the current scope instead;
 * - a newer request always wins over a late reply to an older one;
 * - while the background rebuilds its cache or finishes a calculation, the page checks again a
 *   bounded number of times and keeps the last complete figures meanwhile;
 * - a failed check keeps the figures already shown and stops the automatic checks.
 */
export type Load<T> = { data: T | null; error: string | null; loading: boolean };

export class ScopeChanged extends Error {
  constructor() {
    super("scope_changed");
  }
}

const REBUILD_ATTEMPTS = 10;

export function useDashboardState(client: DashboardClient) {
  const [state, setState] = useState<Load<Dashboard>>({ data: null, error: null, loading: true });
  const [revision, setRevision] = useState(0);
  const epoch = useRef(0);
  const rebuild = useRef({ attempts: 0, stopped: false });

  const reload = useCallback(
    async (automatic = false) => {
      const run = ++epoch.current;
      if (!automatic) rebuild.current = { attempts: 0, stopped: false };
      setState((s) => ({ ...s, loading: true, error: automatic ? s.error : null }));
      try {
        const next = await client.dashboard({});
        if (run !== epoch.current) return;
        setState({ data: next, error: null, loading: false });
        setRevision((r) => r + 1);
      } catch (caught) {
        if (run !== epoch.current) return;
        if (automatic) rebuild.current.stopped = true;
        setState((s) => ({ data: s.data, error: caught instanceof Error ? caught.message : "load_failed", loading: false }));
      }
    },
    [client],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  // The background is rebuilding its cache: check again after its hint, a bounded number of times.
  const dashboard = state.data;
  useEffect(() => {
    if (!dashboard || dashboard.aggregate_status !== "rebuilding" || rebuild.current.stopped) return;
    if (rebuild.current.attempts >= REBUILD_ATTEMPTS) return;
    const delay = Math.min(30_000, Math.max(500, dashboard.refreshAfterMs ?? 2_000));
    const timer = window.setTimeout(() => {
      rebuild.current.attempts++;
      void reload(true);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [dashboard, reload]);

  return { dashboard, error: state.error, loading: state.loading, reload, revision };
}

/**
 * Loads one value for the current dashboard scope. `key` identifies the request. A refresh of the same
 * request keeps its result visible until the new one arrives, and late replies to old keys are dropped.
 * When the request changes (another period, tool or scope), `data` is null until its own answer
 * arrives: before 15 October 2026 the previous period's figures stayed on screen under the new
 * period's label. `dataKey` still names the request the held result answered.
 */
export function useScoped<T extends { scopeToken?: string }>(
  key: string | null,
  scopeToken: string | null | undefined,
  revision: number,
  fetcher: () => Promise<T>,
  onScopeChanged: () => void,
  pendingOf?: (value: T) => boolean,
): Load<T> & { dataKey: string | null; retry: () => void } {
  const [state, setState] = useState<Load<T> & { key: string | null }>({ data: null, error: null, loading: !!key, key: null });
  const [attempt, setAttempt] = useState(0);
  const epoch = useRef(0);
  const polls = useRef(0);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  const scopeRef = useRef(onScopeChanged);
  scopeRef.current = onScopeChanged;
  const pendingRef = useRef(pendingOf);
  pendingRef.current = pendingOf;

  useEffect(() => {
    if (!key || !scopeToken) return;
    const run = ++epoch.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    let timer: number | undefined;
    fetchRef
      .current()
      .then((value) => {
        if (run !== epoch.current) return;
        if (value.scopeToken !== undefined && value.scopeToken !== scopeToken) {
          scopeRef.current();
          return;
        }
        setState({ data: value, error: null, loading: false, key });
        // A calculation still running in the background: look again shortly, a few times at most.
        if (pendingRef.current?.(value) && polls.current < REBUILD_ATTEMPTS) {
          polls.current++;
          timer = window.setTimeout(() => setAttempt((a) => a + 1), 2_000);
        }
      })
      .catch((caught: unknown) => {
        if (run !== epoch.current) return;
        setState((s) => ({ ...s, error: caught instanceof Error ? caught.message : "load_failed", loading: false }));
      });
    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [key, scopeToken, revision, attempt]);

  useEffect(() => {
    polls.current = 0;
  }, [key, scopeToken]);

  const answersRequest =
    state.key === key && (state.data?.scopeToken === undefined || state.data.scopeToken === scopeToken);
  return {
    data: answersRequest ? state.data : null,
    dataKey: state.key,
    error: state.error,
    loading: state.loading || (!!key && !answersRequest && !state.error),
    retry: () => setAttempt((a) => a + 1),
  };
}

export function breakdownRequest(window: { start?: string; end?: string; bucket: "hour" | "day" }, timezone: string) {
  return { start: window.start, end: window.end, bucket: window.bucket, timezone };
}
export function breakdownKey(request: ReturnType<typeof breakdownRequest>) {
  return `breakdown:${request.start ?? ""}:${request.end ?? ""}:${request.bucket}:${request.timezone}`;
}
export function breakdownPending(view: UsageBreakdownView) {
  return view.calculation.pending;
}

/** The query string the background forwards to the organization server for a calendar window. */
export function serverQuery(window: { startDate?: string; endDate?: string }, timezone: string, now: Date) {
  return buildUsageFilters(
    window.startDate && window.endDate
      ? { period: "custom", start: window.startDate, end: window.endDate, site: "", model: "", calculationView: "selected", methodId: "" }
      : { period: "all", start: "", end: "", site: "", model: "", calculationView: "selected", methodId: "" },
    timezone,
    now,
    "company",
  ).query;
}

export type { Dashboard, ServerSummary, TrackingHealthResponse, UsageBreakdownView };
