import { useEffect, useState } from "react";
import { companyConfig, type ApiClient } from "../api";

/**
 * The operator switches the server reports in /v1/config (features). Both are off by default and
 * no organization administrator can change them (owner decision of 18 October 2026). Off, the
 * website shows organization figures only. With person_analytics on it also shows the per-person
 * pages (People ranking, a member's usage, Requests and the Health list by browser); with both on,
 * the Network page too. A server that sends no features is treated as off.
 */
export type ServerFeatures = { person_analytics: boolean; ip_collection: boolean };

export const FEATURES_OFF: ServerFeatures = { person_analytics: false, ip_collection: false };

export function featuresOf(config: unknown): ServerFeatures {
  const value = (config as { features?: Partial<ServerFeatures> } | null)?.features;
  return {
    person_analytics: value?.person_analytics === true,
    ip_collection: value?.ip_collection === true,
  };
}

/**
 * The switches, off until /v1/config answers, so no per-person page shows before the server says so.
 * Not read while enabled is false (an organization scheduled for deletion shows no admin page).
 */
export function useServerFeatures(api: Pick<ApiClient, "get">, enabled = true): ServerFeatures {
  const [features, setFeatures] = useState(FEATURES_OFF);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    companyConfig(api).then(
      (config) => {
        if (live) setFeatures(featuresOf(config));
      },
      // The pages that need the settings show their own error; the switches stay off.
      () => {},
    );
    return () => {
      live = false;
    };
  }, [api, enabled]);
  return features;
}
