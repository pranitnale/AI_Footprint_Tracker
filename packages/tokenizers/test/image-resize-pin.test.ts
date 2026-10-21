import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { anthropicResizedSize } from "../src/metadata";

// Pins the Claude image resize of profile vendor-image-rules-1. The results were recorded
// on 20 October 2026 from the implementation the profile shipped with, before it was
// rewritten from Anthropic's written rules; a change here changes recorded image tokens
// and needs a new profile id.

type Limits = readonly [maxEdge: number, maxTokens: number];
const STANDARD: Limits = [1568, 1568];
const HIGH: Limits = [2576, 4784];
// Not a Claude tier: an edge limit that is not a whole number of patches.
const UNEVEN: Limits = [1000, 700];

// [width, height, standard width, standard height, high width, high height]
const TABLE: readonly (readonly number[])[] = [
  // Tiny
  [1, 1, 1, 1, 1, 1],
  [1, 2, 1, 2, 1, 2],
  [2, 1, 2, 1, 2, 1],
  [27, 28, 27, 28, 27, 28],
  [28, 28, 28, 28, 28, 28],
  [29, 29, 29, 29, 29, 29],
  [1, 5000, 1, 1568, 1, 2576],
  [5000, 1, 1568, 1, 2576, 1],
  [3, 65536, 1, 1568, 1, 2576],
  [65536, 3, 1568, 1, 2576, 1],
  // At and just past the limits
  [1568, 1568, 1092, 1092, 1568, 1568],
  [1569, 1569, 1092, 1092, 1569, 1569],
  [1568, 1, 1568, 1, 1568, 1],
  [1569, 1, 1568, 1, 1569, 1],
  [1, 1569, 1, 1568, 1, 1569],
  [1092, 1092, 1092, 1092, 1092, 1092],
  [1093, 1093, 1092, 1092, 1093, 1093],
  [1092, 1120, 1092, 1120, 1092, 1120],
  [1120, 1092, 1120, 1092, 1120, 1092],
  [1119, 1120, 1092, 1093, 1119, 1120],
  [1176, 1176, 1092, 1092, 1176, 1176],
  [1177, 1177, 1092, 1092, 1177, 1177],
  [1540, 1568, 1092, 1112, 1540, 1568],
  [1568, 1540, 1112, 1092, 1568, 1540],
  [2576, 2576, 1092, 1092, 1932, 1932],
  [2577, 1, 1568, 1, 2576, 1],
  [2576, 1449, 1456, 819, 2576, 1449],
  [2576, 1450, 1456, 820, 2576, 1450],
  // Common photos and screens
  [800, 600, 800, 600, 800, 600],
  [1024, 768, 1024, 768, 1024, 768],
  [1280, 720, 1280, 720, 1280, 720],
  [1366, 768, 1366, 768, 1366, 768],
  [1920, 1080, 1456, 819, 1920, 1080],
  [1080, 1920, 819, 1456, 1080, 1920],
  [2000, 1500, 1270, 952, 2000, 1500],
  [1500, 2000, 952, 1270, 1500, 2000],
  [2048, 2048, 1092, 1092, 1932, 1932],
  [2560, 1440, 1456, 819, 2560, 1440],
  [3000, 2000, 1344, 896, 2352, 1568],
  [3840, 2160, 1456, 819, 2576, 1449],
  [2160, 3840, 819, 1456, 1449, 2576],
  [4032, 3024, 1270, 952, 2212, 1659],
  [3024, 4032, 952, 1270, 1659, 2212],
  [4096, 4096, 1092, 1092, 1932, 1932],
  [1075, 1520, 924, 1307, 1075, 1520],
  [1520, 1075, 1307, 924, 1520, 1075],
  // Odd aspect ratios
  [1999, 1333, 1344, 896, 1999, 1333],
  [1333, 1999, 896, 1344, 1333, 1999],
  [3001, 1777, 1419, 840, 2507, 1484],
  [2999, 2001, 1343, 896, 2350, 1568],
  [1601, 1599, 1093, 1092, 1601, 1599],
  [1599, 1601, 1092, 1093, 1599, 1601],
  // Very wide and very tall
  [1600, 10, 1568, 10, 1600, 10],
  [7000, 1000, 1568, 224, 2576, 368],
  [1000, 7000, 224, 1568, 368, 2576],
  [5000, 200, 1568, 63, 2576, 103],
  [200, 5000, 63, 1568, 103, 2576],
  [10000, 100, 1568, 16, 2576, 26],
  [100, 10000, 16, 1568, 26, 2576],
  [30000, 500, 1568, 26, 2576, 43],
  [500, 30000, 26, 1568, 43, 2576],
  [65536, 1, 1568, 1, 2576, 1],
  [1, 65536, 1, 1568, 1, 2576],
  // Huge
  [8000, 6000, 1270, 952, 2212, 1659],
  [6000, 8000, 952, 1270, 1659, 2212],
  [12000, 9000, 1270, 952, 2212, 1659],
  [20000, 20000, 1092, 1092, 1932, 1932],
  [65535, 65535, 1092, 1092, 1932, 1932],
  [65536, 65536, 1092, 1092, 1932, 1932],
  [50000, 30001, 1400, 840, 2474, 1484],
  [30001, 50000, 840, 1400, 1484, 2474],
  [65536, 65535, 1092, 1092, 1932, 1932],
];

/** Side lengths for the sweep: every small size, a spread, and sizes around each limit. */
function sweepSides(): number[] {
  const sides = new Set<number>();
  for (let side = 1; side <= 64; side++) sides.add(side);
  for (let side = 65; side <= 6000; side += 37) sides.add(side);
  for (const side of [
    979, 980, 981, 1091, 1092, 1093, 1119, 1120, 1121, 1175, 1176, 1177, 1567,
    1568, 1569, 1595, 1596, 1931, 1932, 1933, 2575, 2576, 2577, 2604, 4095,
    4096, 8191, 8192, 10_000, 20_000, 32_768, 65_535, 65_536,
  ])
    sides.add(side);
  return [...sides].sort((a, b) => a - b);
}

const fits = (width: number, height: number, [maxEdge, maxTokens]: Limits) =>
  Math.ceil(width / 28) * 28 <= maxEdge &&
  Math.ceil(height / 28) * 28 <= maxEdge &&
  Math.ceil(width / 28) * Math.ceil(height / 28) <= maxTokens;

/**
 * The whole-pixel short sides that keep the aspect ratio for a long edge: the exact scaled
 * side rounded to the nearest pixel, at least 1. An exact half may round either way,
 * because the profile divides in floating point (45 x 3136 at the standard tier gives
 * 22.500000000000004 and rounds up).
 */
function shortSides(edge: number, short: number, long: number) {
  const twice = 2 * edge * short;
  return {
    least: Math.max(1, Math.ceil((twice - long) / (2 * long))),
    most: Math.max(1, Math.floor((twice + long) / (2 * long))),
  };
}

test("the Claude resize keeps the recorded sizes of profile vendor-image-rules-1", () => {
  for (const [width, height, sw, sh, hw, hh] of TABLE) {
    assert.deepEqual(
      anthropicResizedSize(width!, height!, ...STANDARD),
      { width: sw, height: sh },
      `${width}x${height} standard`,
    );
    assert.deepEqual(
      anthropicResizedSize(width!, height!, ...HIGH),
      { width: hw, height: hh },
      `${width}x${height} high`,
    );
  }
});

test("the Claude resize keeps the recorded results over a sweep of sizes", () => {
  const sides = sweepSides();
  const hash = createHash("sha256");
  let cases = 0;
  for (const limits of [STANDARD, HIGH, UNEVEN])
    for (const width of sides)
      for (const height of sides) {
        const result = anthropicResizedSize(width, height, ...limits);
        hash.update(
          `${width}x${height}@${limits.join("/")}=${result.width}x${result.height}\n`,
        );
        cases++;
      }
  assert.equal(cases, 198_147);
  assert.equal(
    hash.digest("hex"),
    "7c6ce6dd9bfbd8ec7b80fb87c66774d5b9afdd9c3d58416a51d5db3ff559c74e",
  );
});

test("every Claude resize fits, keeps the aspect ratio and is the largest that fits", () => {
  const sides = sweepSides();
  for (const limits of [STANDARD, HIGH, UNEVEN])
    for (const width of sides)
      for (const height of sides) {
        const label = `${width}x${height} at ${limits.join("/")}`;
        const result = anthropicResizedSize(width, height, ...limits);
        if (fits(width, height, limits)) {
          assert.deepEqual(result, { width, height }, label);
          continue;
        }
        const landscape = width >= height;
        const long = landscape ? width : height,
          short = landscape ? height : width;
        const oriented = (edge: number, side: number) =>
          landscape
            ? { width: edge, height: side }
            : { width: side, height: edge };
        const resultLong = landscape ? result.width : result.height,
          resultShort = landscape ? result.height : result.width;
        assert.ok(resultLong >= 1 && resultLong < long, label);
        const allowed = shortSides(resultLong, short, long);
        assert.ok(
          resultShort >= allowed.least && resultShort <= allowed.most,
          label,
        );
        assert.ok(fits(result.width, result.height, limits), label);
        // One more pixel on the long edge no longer fits, even with the smaller rounding.
        // Both sides and the patch count only grow with the edge, so no longer edge fits.
        if (resultLong + 1 < long) {
          const larger = oriented(
            resultLong + 1,
            shortSides(resultLong + 1, short, long).least,
          );
          assert.ok(!fits(larger.width, larger.height, limits), label);
        }
      }
});
