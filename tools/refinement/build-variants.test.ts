import assert from "node:assert/strict";
import test from "node:test";
import { parseArguments, planVariants } from "./build-variants.js";
import {
  resolveBuildVariant,
  validateBuildConfiguration,
  variantOutputTemplate,
} from "../../apps/extension/build/variant.js";
import { packagedBuildConfiguration } from "../../apps/extension/lib/estimation/config.js";

test("direct TSX execution uses EcoLogits and excludes the archived engine", () => {
  assert.equal(packagedBuildConfiguration.default_engine, "ecologits");
  assert.deepEqual(packagedBuildConfiguration.available_engines, ["ecologits"]);
});

test("three EcoLogits browser builds have distinct outputs", () => {
  const plans = planVariants(undefined, undefined, false);
  assert.equal(plans.length, 3);
  assert.equal(new Set(plans.map((plan) => plan.output)).size, 3);
  assert.deepEqual(
    new Set(plans.map((plan) => `${plan.browser}/${plan.engine}`)),
    new Set(["chrome/ecologits", "edge/ecologits", "firefox/ecologits"]),
  );
  assert.ok(plans.every((plan) => plan.status === "intermediate"));
  assert.deepEqual(
    plans.map((plan) => plan.output),
    [
      "apps/extension/.output/chrome-mv3",
      "apps/extension/.output/edge-mv3",
      "apps/extension/.output/firefox-mv2",
    ],
  );
  for (const status of [
    "development",
    "intermediate",
    "release_candidate",
  ] as const)
    assert.equal(
      variantOutputTemplate({
        controlled: status !== "development",
        defaultEngine: "ecologits",
        status,
      }),
      "{{browser}}-mv{{manifestVersion}}",
    );
});

test("release-candidate and focused selectors are explicit", () => {
  const parsed = parseArguments([
    "--",
    "--browser",
    "firefox",
    "--engine",
    "ecologits",
    "--release-candidate",
    "--check",
  ]);
  assert.equal(parsed.check, true);
  assert.deepEqual(parsed.plans, [
    {
      browser: "firefox",
      engine: "ecologits",
      output: "apps/extension/.output/firefox-mv2",
      status: "release_candidate",
    },
  ]);
});

test("invalid or partial selectors fail instead of choosing a default", () => {
  assert.throws(() => planVariants("safari", undefined), /browser/);
  assert.throws(() => planVariants(undefined, "typo"), /engine/);
  assert.throws(() => planVariants(undefined, "original"), /engine/);
  assert.throws(() => parseArguments(["--browser"]), /requires a value/);
  assert.throws(() => parseArguments(["--unknown"]), /Unknown/);
});

test("invalid packaged engine configurations fail closed", () => {
  for (const invalid of [
    null,
    {},
    {
      schema_version: "1.0.0",
      default_engine: "original",
      available_engines: ["original"],
    },
    {
      schema_version: "1.0.0",
      default_engine: "original",
      available_engines: ["ecologits", "original"],
    },
    {
      schema_version: "1.0.0",
      default_engine: "typo",
      available_engines: ["original", "ecologits"],
    },
  ])
    assert.throws(
      () => validateBuildConfiguration(invalid),
      /build configuration/,
    );
  assert.throws(
    () => resolveBuildVariant({ AIFT_BUILD_DEFAULT: "original" }),
    /Original is archived/,
  );
  assert.throws(
    () =>
      resolveBuildVariant({
        AIFT_BUILD_DEFAULT: "ecologits",
        AIFT_BUILD_VARIANT: "ecologits",
        AIFT_BUILD_STATUS: "final",
      }),
    /BUILD_STATUS/,
  );
});
