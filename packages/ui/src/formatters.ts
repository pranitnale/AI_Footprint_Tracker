export type KnownValue = string | number | bigint | null | undefined;

export function formatInteger(value: KnownValue): string {
  if (value === null || value === undefined || value === "") return "Unknown";
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0))
    return "Unknown";
  try {
    return new Intl.NumberFormat().format(
      typeof value === "bigint" ? value : BigInt(value),
    );
  } catch {
    return "Unknown";
  }
}

export function formatDecimal(
  value: KnownValue,
  maximumFractionDigits = 3,
): string {
  if (value === null || value === undefined || value === "") return "Unknown";
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(
        numeric,
      )
    : "Unknown";
}

export function formatMetric(
  value: KnownValue,
  unit: string,
  maximumSignificantDigits = 3,
): string {
  if (value === null || value === undefined || value === "") return "Unknown";
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return "Unknown";
  const normalized = unit.replace(/\s/g, "").toLowerCase();
  if (numeric === 0) return `0 ${displayUnit(normalized, unit)}`;
  const digits = Math.min(21, Math.max(1, maximumSignificantDigits));
  // Round to the shown digits before choosing the unit: 0.9996 kWh must read "1 kWh", not
  // "1,000 Wh". Scaling by a power of ten keeps the rounded digits, so this rounding is final.
  const rounded = Number(numeric.toPrecision(digits));
  let scaled = rounded;
  let shown = displayUnit(normalized, unit);
  if (normalized === "kwh" && rounded < 1) {
    scaled = rounded * 1_000;
    shown = "Wh";
    if (rounded < 0.0001) {
      scaled *= 1_000;
      shown = "mWh";
    }
  } else if (normalized === "wh" && rounded < 0.1) {
    scaled = rounded * 1_000;
    shown = "mWh";
  } else if (["l", "liter", "litre"].includes(normalized) && rounded < 1) {
    scaled = rounded * 1_000;
    shown = "mL";
  } else if (["gco2e", "gco₂e"].includes(normalized) && rounded >= 1_000) {
    scaled = rounded / 1_000;
    shown = "kg CO₂e";
  } else if (["gco2", "gco₂"].includes(normalized) && rounded >= 1_000) {
    scaled = rounded / 1_000;
    shown = "kg CO₂";
  }
  const formatted = new Intl.NumberFormat(undefined, {
    maximumSignificantDigits: digits,
  }).format(scaled);
  return `≈ ${formatted} ${shown}`;
}

function displayUnit(normalized: string, original: string) {
  if (normalized === "gco2e" || normalized === "gco₂e") return "g CO₂e";
  if (normalized === "gco2" || normalized === "gco₂") return "g CO₂";
  return original;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "Unknown"
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

export function formatRetention(value: KnownValue): string {
  const formatted = formatInteger(value);
  if (formatted === "Unknown") return formatted;
  try {
    return BigInt(value as string | number | bigint) === 1n
      ? "1 month"
      : `${formatted} months`;
  } catch {
    return "Unknown";
  }
}

export type MetricParts = { number: string; unit: string } | null;

/**
 * The number and unit of formatMetric as separate parts, for layouts that set them in different
 * sizes. It scales exactly like formatMetric (a test keeps the two in step) so a figure never reads
 * differently on the bar and in the popup. Returns null when formatMetric would say "Unknown".
 */
export function metricParts(
  value: KnownValue,
  unit: string,
  maximumSignificantDigits = 3,
): MetricParts {
  const text = formatMetric(value, unit, maximumSignificantDigits);
  if (text === "Unknown") return null;
  const body = text.startsWith("≈ ") ? text.slice(2) : text;
  const space = body.indexOf(" ");
  return space < 0
    ? { number: body, unit: "" }
    : { number: body.slice(0, space), unit: body.slice(space + 1) };
}

/**
 * The digits of an email code, at most six. A code copied from an email or typed with a space or a
 * dash ("094 475", "094-475") keeps all six digits, because separators are dropped before the
 * six-digit limit applies. Code fields rely on this rather than maxLength, which cuts the raw
 * paste and loses the last digit.
 */
export function emailCodeDigits(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6);
}
