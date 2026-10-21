import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DEFAULT_DISPLAY_SCENARIO, type DisplayScenario } from "@footprint/contracts";
import { readFigures, rememberedFigures } from "../api";
import { decodePeriod, encodePeriod, type DashPeriod } from "./figures";

/** Loads one value, reloads when a dependency changes and ignores a late reply to an older load. */
export function useApi<T>(load: () => Promise<T>, dependencies: unknown[] = []) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState<unknown>(null),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  // refresh() reads again but keeps the current data on screen meanwhile, so a page that reloads
  // after an action does not unmount the confirmation it is showing.
  const keep = useRef(false);
  const retry = () => setRevision((value) => value + 1);
  const refresh = () => {
    keep.current = true;
    setRevision((value) => value + 1);
  };
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    if (!keep.current) setData(null);
    keep.current = false;
    load()
      .then((value) => active && setData(value))
      .catch((value) => active && setError(value))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [revision, ...dependencies]);
  return { data, error, loading, retry, refresh, setData };
}
export type Loaded<T> = ReturnType<typeof useApi<T>>;

type Shown<T> = { key: string | null; data: T | null; error: unknown; loading: boolean; cachedAt: number | null };

function keptOrNothing<T>(api: object, key: string | null): Shown<T> {
  const kept = key === null ? undefined : rememberedFigures<T>(api, key);
  return { key, data: kept?.value ?? null, error: null, loading: key !== null, cachedAt: kept?.at ?? null };
}

/**
 * Loads admin figures for one request, named by `key` (its exact path and query; null while the
 * request is not known yet). Figures already read for the identical request on this signed-in page
 * show at once while the request is sent again; `cachedAt` is when they were read, and null once
 * the shown figures are the latest answer. A failed refresh shows the error without figures.
 */
export function useFigures<T>(api: object, key: string | null, read: () => Promise<T>) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState(() => keptOrNothing<T>(api, key));
  // Another request's answer is never shown, not even for the render before the effect runs.
  const shown = state.key === key ? state : keptOrNothing<T>(api, key);
  useEffect(() => {
    let active = true;
    setState(keptOrNothing<T>(api, key));
    if (key !== null)
      readFigures(api, key, read).then(
        (data) => active && setState({ key, data, error: null, loading: false, cachedAt: null }),
        (error) => active && setState({ key, data: null, error, loading: false, cachedAt: null }),
      );
    return () => {
      active = false;
    };
  }, [api, key, revision]);
  const retry = () => setRevision((value) => value + 1);
  return { data: shown.data, error: shown.error, loading: shown.loading, cachedAt: shown.cachedAt, retry };
}

/** When the oldest of the shown figures still being read again was read, or null when all are current. */
export function cachedSince(...loads: { cachedAt: number | null }[]): number | null {
  const times = loads.map((load) => load.cachedAt).filter((at): at is number => at !== null);
  return times.length ? Math.min(...times) : null;
}

/**
 * The administrator's chosen period, tool and EcoLogits scenario, shared by every admin page so a
 * choice made on Overview stays on People and Tools and models. Kept in this browser only, as a
 * convenience; nothing about it reaches the server.
 */
export type AdminView = { period: DashPeriod; site: string; scenario: DisplayScenario };

const KEY = "aift-admin-view";
// The same default scenario as the extension, so an organization and its members see the same figures.
const DEFAULT_VIEW: AdminView = { period: { kind: "30d" }, site: "", scenario: DEFAULT_DISPLAY_SCENARIO };
let current: AdminView = read();
const listeners = new Set<() => void>();

function read(): AdminView {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? "null");
    if (!saved || typeof saved !== "object") return DEFAULT_VIEW;
    return {
      period: decodePeriod(saved.period) ?? DEFAULT_VIEW.period,
      site: ["chatgpt", "claude", "gemini", "perplexity", "notebooklm"].includes(saved.site) ? saved.site : "",
      scenario: ["minimum", "midpoint", "maximum"].includes(saved.scenario) ? saved.scenario : DEFAULT_VIEW.scenario,
    };
  } catch {
    return DEFAULT_VIEW;
  }
}

export function setAdminView(next: Partial<AdminView>) {
  current = { ...current, ...next };
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify({ ...current, period: encodePeriod(current.period) }));
  } catch {
    // Private windows can refuse storage; the choice still holds until the page reloads.
  }
  listeners.forEach((listener) => listener());
}

export function useAdminView(): AdminView {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => current,
  );
}
