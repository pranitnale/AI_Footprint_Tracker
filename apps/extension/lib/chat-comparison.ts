import type { DisplayScenario } from "@footprint/contracts";
import type { UsageBreakdownView } from "./dashboard/types";
import { baseValue, emptyLike, totalFigures } from "./ui/figure-math";
import { usageFigures } from "./ui/usage-figures";
import type { SmallerModel } from "./smaller-model";

/** How one chat compares with the person's other chats, for the Details overlay. Electricity only. */
export type ChatComparison = {
  /** Chats with a known electricity figure in the window, this one included. */
  chats: number;
  /** This chat's electricity in the window, in Wh. Null when it has no record in the window. */
  thisChat: number | null;
  /** Share of the other chats that used less electricity, 0 to 1. Null below MIN_OTHER_CHATS. */
  smallerShare: number | null;
  /** Mean electricity per chat in the window, in Wh. */
  averageWh: number | null;
  /** This chat's share of today's total electricity, 0 to 1. */
  todayShare: number | null;
  /** Chat counts per bin from the smallest to the largest chat, on a logarithmic scale. */
  bins: number[];
  /** Index of the bin that holds this chat. */
  thisBin: number | null;
  /** The change if a smaller model wrote the same output tokens; absent when it cannot be compared. */
  smallerModel?: SmallerModel | null;
};

/** With fewer other chats than this, a percentage would describe noise rather than a pattern. */
export const MIN_OTHER_CHATS = 3;
const BIN_COUNT = 12;

/**
 * Electricity per chat in Wh, live and saved history joined by the conversation key both sides
 * use. Each chat goes through usageFigures, the same function behind the bar and the dashboard,
 * so a chat's figure here equals the figure shown for it elsewhere.
 */
export function chatEnergies(view: UsageBreakdownView, scenario: DisplayScenario): Map<string, number> {
  const live = new Map(view.chats.map((chat) => [chat.key, chat]));
  const saved = view.history?.chats ?? {};
  const out = new Map<string, number>();
  for (const key of new Set([...live.keys(), ...Object.keys(saved)])) {
    const chat = live.get(key);
    const empty = emptyLike(view);
    const summary = chat ? { ...empty, requests: chat.requests, metrics: { ...empty.metrics, ...chat.metrics } } : empty;
    const value = baseValue(usageFigures(summary, saved[key] ?? null, scenario), "energy");
    if (value !== null && Number.isFinite(value) && value > 0) out.set(key, value);
  }
  return out;
}

/**
 * Compares the chat with the given key against every chat in `window` (the last 30 days), and
 * its part of today's total against `today`. Both views come from the same breakdown scan the
 * dashboard uses. A null key (an unsaved chat) still gets the average and the distribution.
 */
export function chatComparison(window: UsageBreakdownView, today: UsageBreakdownView | null, key: string | null, scenario: DisplayScenario): ChatComparison {
  const energies = chatEnergies(window, scenario);
  const thisChat = key === null ? null : (energies.get(key) ?? null);
  const values = [...energies.values()];
  const others = key === null ? values : [...energies].filter(([k]) => k !== key).map(([, v]) => v);
  const smallerShare = thisChat !== null && others.length >= MIN_OTHER_CHATS ? others.filter((v) => v < thisChat).length / others.length : null;
  const averageWh = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  let todayShare: number | null = null;
  if (today && key !== null) {
    const mine = chatEnergies(today, scenario).get(key) ?? null;
    const total = baseValue(totalFigures(today, scenario), "energy");
    if (mine !== null && total !== null && total > 0) todayShare = Math.min(1, mine / total);
  }
  const bins = new Array<number>(BIN_COUNT).fill(0);
  let thisBin: number | null = null;
  if (values.length) {
    const low = Math.log(Math.min(...values));
    const span = Math.log(Math.max(...values)) - low;
    const bin = (v: number) => (span > 0 ? Math.min(BIN_COUNT - 1, Math.floor(((Math.log(v) - low) / span) * BIN_COUNT)) : Math.floor(BIN_COUNT / 2));
    for (const v of values) bins[bin(v)]++;
    if (thisChat !== null) thisBin = bin(thisChat);
  }
  return { chats: values.length, thisChat, smallerShare, averageWh, todayShare, bins, thisBin };
}
