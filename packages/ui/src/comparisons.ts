/**
 * Everyday comparisons for estimated figures. Presentation only: they translate a figure that is
 * already calculated and never feed back into a stored or estimated value. Sources and scope are in
 * docs/methodology/EVERYDAY-COMPARISONS-2026-10-12.md.
 */

/** An 800 lumen LED, the replacement for a 60 W incandescent bulb (US DOE FEMP range 5.9 to 10.5 W). */
export const LED_BULB_WATTS = 8;
/** One smartphone charge measured at the wall (US EPA equivalencies calculator, 0.019 kWh). */
export const PHONE_CHARGE_WH = 19;
/** German passenger car, all drives, per passenger-km, including fuel and electricity supply (UBA, TREMOD 6.71B, 2024). */
export const CAR_G_CO2E_PER_KM = 164;
/** US FDA labelling definition, 21 CFR 101.9(b)(5)(viii). */
export const TABLESPOON_ML = 15;
export const GLASS_ML = 250;
/** English text, OpenAI tokenizer guidance: one token is about three quarters of a word. */
export const WORDS_PER_TOKEN = 0.75;

const number = (value: number, digits: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(value);
const rounded = (value: number) => (value >= 10 ? number(Math.round(value), 0) : number(value, 1));

/** Converts a value in kWh, Wh or mWh to Wh. Null for other units or unknown values. */
export function toWh(value: string | null | undefined, unit: string | undefined): number | null {
  const v = Number(value);
  if (value == null || !Number.isFinite(v) || v < 0) return null;
  const u = (unit ?? "").toLowerCase();
  return u === "kwh" ? v * 1000 : u === "wh" ? v : u === "mwh" ? v / 1000 : null;
}
export function toGrams(value: string | null | undefined, unit: string | undefined): number | null {
  const v = Number(value);
  if (value == null || !Number.isFinite(v) || v < 0) return null;
  const u = (unit ?? "").replace(/\s/g, "").toLowerCase();
  return u === "gco2e" || u === "gco₂e" ? v : u === "kgco2e" || u === "kgco₂e" ? v * 1000 : null;
}
export function toMillilitres(value: string | null | undefined, unit: string | undefined): number | null {
  const v = Number(value);
  if (value == null || !Number.isFinite(v) || v < 0) return null;
  const u = (unit ?? "").toLowerCase();
  return u === "l" ? v * 1000 : u === "ml" ? v : null;
}

/**
 * Units follow the number as shown, not the exact value: 1.03 charges shows as "1", so it reads
 * "1 phone charge", while 1.4 glasses reads "1.4 glasses".
 */
const one = (value: string) => value === "1";

/** "54 min" or "3.7 hours" of light from the LED bulb. */
export function ledDuration(wh: number): { value: string; unit: string } {
  const minutes = (wh / LED_BULB_WATTS) * 60;
  if (minutes < 1) return { value: "<1", unit: "min" };
  if (minutes < 59.5) return { value: number(Math.round(minutes), 0), unit: "min" };
  const hours = rounded(minutes / 60);
  return { value: hours, unit: one(hours) ? "hour" : "hours" };
}

/** Share of one phone charge, "60%", or charges above one, "3.2 charges". */
export function phoneCharges(wh: number): { value: string; unit: string } {
  const charges = wh / PHONE_CHARGE_WH;
  if (charges < 1) return { value: `${number(Math.max(1, Math.round(charges * 100)), 0)}%`, unit: "phone charge" };
  const shown = rounded(charges);
  return { value: shown, unit: one(shown) ? "phone charge" : "phone charges" };
}

/** Distance one person travels by car for the same greenhouse gases: "20 m" or "1.3 km". */
export function carDistance(grams: number): { value: string; unit: string } {
  const km = grams / CAR_G_CO2E_PER_KM;
  if (km < 1) return { value: number(Math.max(1, Math.round((km * 1000) / 10) * 10), 0), unit: "m" };
  return { value: rounded(km), unit: "km" };
}

/** Water as tablespoons below one glass, then glasses: "2 tbsp", "3 glasses". */
export function waterAmount(ml: number): { value: string; unit: string } {
  if (ml < GLASS_ML) {
    const spoons = ml / TABLESPOON_ML;
    return { value: spoons < 1 ? "<1" : number(Math.round(spoons), 0), unit: "tbsp" };
  }
  const glasses = rounded(ml / GLASS_ML);
  return { value: glasses, unit: one(glasses) ? "glass" : "glasses" };
}

/**
 * The written-out unit for a sentence, singular for a shown "1" or "<1" ("less than a tablespoon").
 * Metric abbreviations such as "m" and "km" have no plural and stay as they are.
 */
export function spelledUnit(d: { value: string; unit: string }) {
  const single = one(d.value) || d.value === "<1";
  if (d.unit === "tbsp") return single ? "tablespoon" : "tablespoons";
  if (d.unit === "min") return single ? "minute" : "minutes";
  return d.unit;
}

/** Plain-sentence equivalents for the large figure on the popup and dashboard. */
export function energyEquivalent(wh: number) {
  const d = ledDuration(wh);
  if (d.value === "<1") return "less than a minute of LED light";
  return `≈ ${d.value} ${spelledUnit(d)} of LED light`;
}
export function carbonEquivalent(grams: number) {
  const d = carDistance(grams);
  return `≈ ${d.value} ${d.unit} by car`;
}
export function waterEquivalent(ml: number) {
  const d = waterAmount(ml);
  if (d.value === "<1") return "less than a tablespoon of water";
  return `≈ ${d.value} ${spelledUnit(d)} of water`;
}

/** Approximate words for a count of output tokens. */
export function wordsForTokens(tokens: number) {
  const words = tokens * WORDS_PER_TOKEN;
  if (words >= 100) return Math.round(words / 50) * 50;
  if (words >= 10) return Math.round(words / 10) * 10;
  // Short replies round to whole words; a reply that wrote something never reads as 0 words.
  return words > 0 ? Math.max(1, Math.round(words)) : 0;
}
