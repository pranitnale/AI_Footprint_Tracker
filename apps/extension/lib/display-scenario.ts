import {
  DEFAULT_DISPLAY_SCENARIO,
  DisplayScenarioSchema,
  scenarioValue,
  type DisplayScenario,
} from "@footprint/contracts";

export { DEFAULT_DISPLAY_SCENARIO, scenarioValue, type DisplayScenario };

/** Returns the scenario named by an untrusted message field, or null when it is not one. */
export function parseDisplayScenario(value: unknown): DisplayScenario | null {
  const parsed = DisplayScenarioSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * The content script receives the saved choice from the background with each display. A
 * display that predates the setting, or carries an unknown value, shows the default.
 */
export function readDisplayScenario(value: unknown): DisplayScenario {
  return parseDisplayScenario(value) ?? DEFAULT_DISPLAY_SCENARIO;
}
