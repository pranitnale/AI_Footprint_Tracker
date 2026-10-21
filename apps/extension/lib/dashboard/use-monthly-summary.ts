import { useEffect, useRef, useState } from "react";
import type { DashboardClient } from "./client";
import type { MonthlySummary } from "./types";

export function useMonthlySummary(
  client: Pick<DashboardClient, "monthlySummary">,
  scopeToken: string | undefined,
  enabled: boolean,
  calculationKey = "",
) {
  const request = useRef<{
    client: Pick<DashboardClient, "monthlySummary">;
    scope: string;
    calculationKey: string;
    inFlight: boolean;
    completed: boolean;
  } | null>(null);
  const [result, setResult] = useState<{
    client: Pick<DashboardClient, "monthlySummary">;
    scope: string;
    calculationKey: string;
    value: MonthlySummary | null;
    error: string;
  } | null>(null);
  // A readiness refresh may hide the panel, but must not discard a request that already claimed its month.
  useEffect(
    () => () => {
      request.current = null;
    },
    [client, scopeToken, calculationKey],
  );
  useEffect(() => {
    if (!enabled || !scopeToken) return;
    if (
      request.current?.client !== client ||
      request.current.scope !== scopeToken ||
      request.current.calculationKey !== calculationKey
    )
      request.current = {
        client,
        scope: scopeToken,
        calculationKey,
        inFlight: false,
        completed: false,
      };
    const active = request.current;
    if (active.inFlight || active.completed) return;
    active.inFlight = true;
    void client
      .monthlySummary()
      .then((value) => {
        if (request.current !== active) return;
        active.inFlight = false;
        if (
          value &&
          "scopeToken" in value.summary &&
          value.summary.scopeToken !== scopeToken
        ) {
          setResult({
            client,
            scope: scopeToken,
            calculationKey,
            value: null,
            error:
              "The monthly summary belongs to an earlier connection. Open the dashboard again to retry.",
          });
          return;
        }
        active.completed = value !== null;
        setResult({
          client,
          scope: scopeToken,
          calculationKey,
          value,
          error: "",
        });
      })
      .catch(() => {
        if (request.current === active) {
          active.inFlight = false;
          setResult({
            client,
            scope: scopeToken,
            calculationKey,
            value: null,
            error:
              "The monthly summary could not be verified. Open the dashboard again to retry.",
          });
        }
      });
  }, [client, scopeToken, enabled, calculationKey]);
  return {
    monthly:
      enabled &&
      result &&
      result.client === client &&
      result.scope === scopeToken &&
      result.calculationKey === calculationKey
        ? result.value
        : null,
    error:
      enabled &&
      result &&
      result.client === client &&
      result.scope === scopeToken &&
      result.calculationKey === calculationKey
        ? result.error
        : "",
    dismiss: () =>
      setResult((previous) =>
        previous ? { ...previous, value: null, error: "" } : previous,
      ),
  };
}
