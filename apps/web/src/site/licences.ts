import inventory from "../../../../THIRD-PARTY-INVENTORY.json";

type Component = { name: string; license: string };
const GROUPS: ReadonlyArray<readonly [string, string, string]> = [
  ["MIT", "MIT", "#2E6B3F"],
  ["BSD-3-Clause", "BSD 3-Clause", "#5A9654"],
  ["MPL-2.0", "MPL 2.0", "#8DBB6E"],
  ["Apache-2.0", "Apache 2.0", "#BFD99A"],
  ["Other", "Other licences", "#B8B2A3"],
];

/** Third-party components by licence, from the inventory the release packages ship with. */
export function licenceGroups() {
  const components = (inventory as { components: Component[] }).components;
  const count = (key: string) =>
    components.filter((c) => (GROUPS.slice(0, 4).some(([k]) => k === c.license) ? c.license : "Other") === key).length;
  const circumference = 2 * Math.PI * 48;
  let offset = 0;
  const groups = GROUPS.map(([key, name, color]) => {
    const n = count(key);
    const length = (n / components.length) * circumference;
    const arc = { key, name, n, color, dash: `${Math.max(0, length - 1.5).toFixed(1)} ${(circumference - length + 1.5).toFixed(1)}`, offset: (-offset).toFixed(1) };
    offset += length;
    return arc;
  }).filter((g) => g.n > 0);
  return { total: components.length, groups };
}
