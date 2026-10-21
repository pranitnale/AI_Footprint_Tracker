/**
 * Provider drift check (W10). Compares the protocol names the live and history readers know
 * with the names in provider page code that a developer saved locally (for example the
 * site's JavaScript files from the browser's developer tools). It reads only the files it
 * is given and sends nothing anywhere. Run it before a release:
 *
 *   node --import tsx tools/provider-drift.ts --site claude <saved files or folders>
 *
 * For each kind of name it lists the known names the code no longer contains and unknown
 * names that sit next to known ones. Both need review: page code holds many names, and a
 * new one is often harmless. Add `--json` for the report as JSON and `--strict` to exit
 * with 1 when anything needs review.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  PROVIDER_VOCABULARY,
  type ProviderVocabulary,
} from "../packages/adapters/src/vocabulary";

export type DriftKind = {
  known: readonly string[];
  /** The shape a new name of this kind has; null checks only that known names remain. */
  shape: RegExp | null;
};
export type DriftResult = {
  found: string[];
  missing: string[];
  candidates: string[];
};

const SNAKE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;
/** The kinds of name checked per site, with the shape a new one has. */
export function driftKinds(
  vocabulary: ProviderVocabulary,
  site: keyof ProviderVocabulary,
): Record<string, DriftKind> {
  const shapes: Record<string, RegExp | null> = {
    events: SNAKE,
    blocks: SNAKE,
    deltas: /^[a-z][a-z0-9_]*_delta$/,
    stopReasons: SNAKE,
    items: site === "perplexity" ? /^WORKFLOW_ITEM_[A-Z0-9_]+$/ : KEBAB,
    rpcs: null,
    paths: null,
  };
  return Object.fromEntries(
    Object.entries(vocabulary[site]).map(([kind, known]) => [
      kind,
      { known, shape: shapes[kind] ?? null },
    ]),
  );
}

// String literals in minified code; names longer than 80 characters are not protocol names.
const LITERAL =
  /"([A-Za-z_][A-Za-z0-9_.:/-]{0,79})"|'([A-Za-z_][A-Za-z0-9_.:/-]{0,79})'|`([A-Za-z_][A-Za-z0-9_.:/-]{0,79})`/g;
/** Characters on each side of a known name searched for its neighbours. */
const WINDOW = 600;

/**
 * Names of each kind found in the code. A candidate has the kind's shape and sits within
 * the window of two different known names, as the names of one switch or list do.
 */
export function driftReport(
  code: string,
  kinds: Record<string, DriftKind>,
): Record<string, DriftResult> {
  const literals: Array<{ name: string; at: number }> = [];
  for (const match of code.matchAll(LITERAL))
    literals.push({ name: match[1] ?? match[2] ?? match[3]!, at: match.index });
  // A name of another kind the reader knows is not new, such as an event ending in _delta.
  const everyKnown = new Set(
    Object.values(kinds).flatMap(({ known }) => known),
  );
  const report: Record<string, DriftResult> = {};
  for (const [kind, { known, shape }] of Object.entries(kinds)) {
    const knownNames = new Set(known);
    const positions = literals.filter((literal) =>
      knownNames.has(literal.name),
    );
    const present = new Set(positions.map((literal) => literal.name));
    const near = new Map<string, Set<string>>();
    if (shape)
      for (const literal of literals) {
        if (everyKnown.has(literal.name) || !shape.test(literal.name)) continue;
        // Positions are in code order, so the first one inside the window is found by
        // binary search and the rest follow it.
        let low = 0,
          high = positions.length;
        while (low < high) {
          const middle = (low + high) >> 1;
          if (positions[middle]!.at < literal.at - WINDOW) low = middle + 1;
          else high = middle;
        }
        for (
          let index = low;
          index < positions.length &&
          positions[index]!.at <= literal.at + WINDOW;
          index++
        ) {
          const neighbours = near.get(literal.name) ?? new Set<string>();
          neighbours.add(positions[index]!.name);
          near.set(literal.name, neighbours);
        }
      }
    report[kind] = {
      found: [...present].sort(),
      missing: known.filter((name) => !present.has(name)).sort(),
      candidates: [...near]
        .filter(([, neighbours]) => neighbours.size >= 2)
        .map(([name]) => name)
        .sort(),
    };
  }
  return report;
}

/** Saved code files under the given paths: scripts and text, read as UTF-8. */
function codeFiles(paths: readonly string[]): string[] {
  const files: string[] = [];
  for (const path of paths) {
    if (statSync(path).isDirectory())
      files.push(
        ...codeFiles(readdirSync(path).map((name) => join(path, name))),
      );
    else if (/\.(?:js|mjs|cjs|txt)$/i.test(path)) files.push(path);
  }
  return files;
}

function main(args: readonly string[]) {
  const siteIndex = args.indexOf("--site");
  const site = args[siteIndex + 1] as keyof ProviderVocabulary | undefined;
  const paths = args.filter(
    (arg, index) =>
      !arg.startsWith("--") && (siteIndex < 0 || index !== siteIndex + 1),
  );
  if (!site || !Object.hasOwn(PROVIDER_VOCABULARY, site) || !paths.length) {
    console.error(
      `Usage: provider-drift.ts --site ${Object.keys(PROVIDER_VOCABULARY).join("|")} <files or folders> [--json] [--strict]`,
    );
    return 2;
  }
  const files = codeFiles(paths);
  const code = files.map((file) => readFileSync(file, "utf8")).join("\n");
  const report = driftReport(code, driftKinds(PROVIDER_VOCABULARY, site));
  if (args.includes("--json"))
    console.log(JSON.stringify({ site, files: files.length, report }, null, 2));
  else {
    console.log(`${site}: ${files.length} file(s) read`);
    for (const [kind, result] of Object.entries(report)) {
      console.log(
        `${kind}: ${result.found.length} of ${result.found.length + result.missing.length} known names found`,
      );
      if (result.missing.length)
        console.log(
          `  not found (renamed or removed?): ${result.missing.join(", ")}`,
        );
      if (result.candidates.length)
        console.log(
          `  new names next to known ones: ${result.candidates.join(", ")}`,
        );
    }
  }
  const review = Object.values(report).some(
    (result) => result.missing.length || result.candidates.length,
  );
  return args.includes("--strict") && review ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = main(process.argv.slice(2));
