/** Exact decimal sum of bounded decimal strings, so totals never drift by float rounding. */
export function sumFixed(values: string[]): string {
  if (values.length > 10_000) throw new Error("summary_response_invalid");
  const parsed = values.map((value) => {
    if (value.length > 96 || !Number.isFinite(Number(value)))
      throw new Error("summary_response_invalid");
    const match =
      /^([+-]?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]{1,3}))?$/.exec(
        value,
      );
    if (
      !match ||
      (Number(value) === 0 &&
        !/^[-+]?0(?:\.0+)?(?:[eE][+-]?[0-9]{1,3})?$/.test(value))
    )
      throw new Error("summary_response_invalid");
    const fraction = match[3] ?? "";
    return {
      coefficient:
        (match[1] === "-" ? -1n : 1n) * BigInt(`${match[2]}${fraction}`),
      power: Number(match[4] ?? 0) - fraction.length,
    };
  });
  if (!parsed.length) return "0";
  const power = Math.min(...parsed.map((value) => value.power));
  const total = parsed.reduce(
    (sum, value) =>
      sum + value.coefficient * 10n ** BigInt(value.power - power),
    0n,
  );
  if (total === 0n) return "0";
  const sign = total < 0n ? "-" : "";
  const digits = (total < 0n ? -total : total).toString();
  if (power >= 0) return sign + digits + "0".repeat(power);
  const places = -power;
  const padded = digits.padStart(places + 1, "0");
  const whole = padded.slice(0, -places);
  const fraction = padded.slice(-places).replace(/0+$/, "");
  return sign + whole + (fraction ? `.${fraction}` : "");
}

type MethodIdentity = {
  method_hash: string;
  engine_id?: string;
  implementation_version?: string;
  source_version?: string | null;
  source_commit?: string | null;
  catalog_hash?: string | null;
  environment_policy_hash?: string;
  product_scope?: string;
};
type Lineage = {
  requested_method?: MethodIdentity;
  effective_method?: MethodIdentity;
  comparability?: Record<string, unknown>;
  method_hash?: string;
};
/**
 * A resource figure in any of its shapes: a local summary group, a saved-history row or
 * a company series, whose lineage sits in `method_group`.
 */
export type TotalRow = Lineage & {
  value: string | null;
  unit?: string;
  phase?: string;
  value_kind?: string;
  scenario_low?: string | null;
  scenario_high?: string | null;
  method_group?: object;
  /** The releases a local summary group already added (methodReleaseKeys); a single row has none. */
  method_releases?: readonly string[];
};
const lineageOf = (row: TotalRow): Lineage | undefined =>
  row.requested_method || row.effective_method
    ? row
    : (row.method_group as Lineage | undefined);

const stable = (value: Record<string, unknown>) =>
  JSON.stringify(
    Object.keys(value)
      .sort()
      .map((key) => [key, value[key]]),
  );

/**
 * The part of a method identity that decides whether its figures add to another release's.
 * Every extension build whose model mappings, stand-ins or media coefficients changed is a new
 * EcoLogits method with its own hash, so an organization's month mixes several of them. Releases
 * of the same EcoLogits core and catalog under the same environment policy describe the same
 * boundaries; the contract adds such comparable methods and keeps a mixed-method indicator
 * (CONTRACTS.md, "Method groups with incompatible boundaries are separate subtotals"). Another
 * core, catalog or environment policy, the Original method and an identity without these fields
 * stay apart by their hash.
 */
export function methodFamily(method: MethodIdentity): string {
  return method.engine_id === "ecologits" &&
    method.implementation_version &&
    method.source_version &&
    method.catalog_hash &&
    method.environment_policy_hash
    ? JSON.stringify([
        method.engine_id,
        method.implementation_version,
        method.source_version,
        method.source_commit ?? null,
        method.catalog_hash,
        method.environment_policy_hash,
        method.product_scope ?? null,
      ])
    : method.method_hash;
}

/**
 * What makes figures addable (D4): comparable requested and effective methods (methodFamily),
 * the same boundaries and unit. The model, its profile choice and the tokenizer are details of
 * each reply, so they never split a total. Rows that do not name their lineage cannot be added.
 */
export function comparableKey(row: TotalRow): string | null {
  const lineage = lineageOf(row);
  if (lineage?.requested_method || lineage?.effective_method) {
    if (
      !lineage.requested_method ||
      !lineage.effective_method ||
      !lineage.comparability ||
      (row.phase !== undefined && row.phase !== "usage")
    )
      return null;
    const { tokenizer_profile_id: _tokenizer, ...boundaries } =
      lineage.comparability;
    return JSON.stringify([
      methodFamily(lineage.requested_method),
      methodFamily(lineage.effective_method),
      stable(boundaries),
      row.unit ?? null,
    ]);
  }
  const hash = row.method_hash ?? lineage?.method_hash;
  return hash ? JSON.stringify([hash, row.unit ?? null]) : null;
}

/**
 * The method releases behind a row: its requested and effective method hashes, or every release
 * a local summary group already added. Counted across rows, they tell a surface that a total adds
 * estimates from several releases of one method family.
 */
export function methodReleaseKeys(row: TotalRow): readonly string[] {
  if (row.method_releases?.length) return row.method_releases;
  const own = lineageOf(row);
  return [
    `${own?.requested_method?.method_hash ?? own?.method_hash ?? row.method_hash}:${own?.effective_method?.method_hash ?? ""}`,
  ];
}

const isRanged = (row: TotalRow) =>
  row.value_kind === "midpoint" || row.value_kind === "midpoint_sum";

/**
 * The total of rows that add. Rows without a value only count as unknown; they never make
 * a total "multiple". Ranged and point figures add endpoint by endpoint, a point counting
 * as both; one ranged row saved without endpoints leaves the scenario sums unavailable.
 */
export function comparableTotal(rows: readonly TotalRow[]) {
  const known = rows.filter((row) => row.value !== null);
  const keys = new Set(known.map(comparableKey));
  const multiple = known.length > 1 && (keys.size > 1 || keys.has(null));
  if (multiple || !known.length)
    return {
      value: null,
      unit: known[0]?.unit ?? null,
      multiple,
      value_kind: null,
      scenario_low: null,
      scenario_high: null,
      methodReleases: 0,
      lineage: null,
    };
  const ranged = known.some(isRanged);
  const bounded =
    ranged &&
    known.every(
      (row) =>
        !isRanged(row) ||
        (row.scenario_low != null && row.scenario_high != null),
    );
  const first = known[0]!;
  const lineage = lineageOf(first);
  // One row is its own total, kept exactly as received.
  const sum = (values: string[]) =>
    values.length === 1 ? values[0]! : sumFixed(values);
  // Rows of several releases add, but no single method identity describes their total.
  const releases = new Set(known.flatMap(methodReleaseKeys));
  return {
    value: sum(known.map((row) => row.value!)),
    unit: first.unit ?? null,
    multiple: false,
    value_kind: ranged ? ("midpoint_sum" as const) : ("scalar" as const),
    scenario_low: bounded
      ? sum(known.map((row) => row.scenario_low ?? row.value!))
      : null,
    scenario_high: bounded
      ? sum(known.map((row) => row.scenario_high ?? row.value!))
      : null,
    methodReleases: releases.size,
    // The shared lineage of the total; a tokenizer is a detail of each reply.
    lineage:
      releases.size === 1 &&
      lineage?.requested_method &&
      lineage.effective_method &&
      lineage.comparability
        ? {
            requested_method: lineage.requested_method,
            effective_method: lineage.effective_method,
            comparability: {
              ...lineage.comparability,
              tokenizer_profile_id: null,
            },
          }
        : null,
  };
}

/**
 * The rows split into sets that add, each with its comparableTotal and number of rows, largest
 * total first. A row that names no lineage is a set of its own. For a surface that must show one
 * figure when rows cannot all add: it shows one set's total and says so, never a sum of sets.
 */
export function comparableGroups(rows: readonly TotalRow[]) {
  const sets = new Map<string, TotalRow[]>();
  rows
    .filter((row) => row.value !== null)
    .forEach((row, index) => {
      const key = comparableKey(row) ?? `row:${index}`;
      sets.set(key, [...(sets.get(key) ?? []), row]);
    });
  return [...sets.values()]
    .map((set) => ({ ...comparableTotal(set), rows: set.length }))
    .sort((a, b) => Number(b.value) - Number(a.value));
}
