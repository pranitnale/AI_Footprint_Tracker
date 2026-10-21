// Writes the family and variant stand-ins of `config/estimation.build.json` from the adopted
// EcoLogits catalog: each family's unlisted ids use the highest version of that family in the
// catalog (owner decision of 13 October 2026), and each variant's ids the highest version of the
// same variant, or of the same kind when the catalog has none (owner decision of 14 October
// 2026). Run it after adopting a new EcoLogits release, review the change and give the policy a
// new `policy_version`. `--check` only reports a stale table.
//
//   node --import tsx tools/estimation-family-stand-ins.ts [--check]
import { readFileSync, writeFileSync } from "node:fs";
import {
  standInIds,
  standInOverrides,
} from "../packages/estimator/src/family-stand-ins.ts";

const root = new URL("../", import.meta.url);
const configUrl = new URL("config/estimation.build.json", root);
const catalog = JSON.parse(
  readFileSync(
    new URL("packages/ecologits-core/data/catalog.json", root),
    "utf8",
  ),
) as { models: { provider: string; name: string }[] };

const text = readFileSync(configUrl, "utf8").replace(/\r\n/g, "\n");
const config = JSON.parse(text);
const generated = new Set(standInIds());
const overrides: Record<string, unknown> = {};
for (const [id, rule] of Object.entries(
  config.ecologits_fallback.model_overrides as Record<string, unknown>,
))
  if (!generated.has(id)) overrides[id] = rule;
Object.assign(overrides, standInOverrides(catalog.models));
config.ecologits_fallback.model_overrides = Object.fromEntries(
  Object.keys(overrides)
    .sort()
    .map((id) => [id, overrides[id]]),
);
const next = JSON.stringify(config, null, 2) + "\n";

if (process.argv.includes("--check")) {
  if (next !== text) {
    console.error(
      "The family and variant stand-ins in config/estimation.build.json do not match the EcoLogits catalog. Run `node --import tsx tools/estimation-family-stand-ins.ts`, review the change and update policy_version.",
    );
    process.exit(1);
  }
} else if (next !== text) {
  writeFileSync(configUrl, next);
  console.log(
    "Updated config/estimation.build.json; update policy_version and review_date.",
  );
} else console.log("The family and variant stand-ins are current.");
