import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";
import { methodologyHtml } from "../src/generated/methodology";

test("public methodology includes the complete validated model catalog", async () => {
  const catalog = JSON.parse(
    await readFile(
      new URL(
        "../../../registry/model-catalog-2026-09-09.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(catalog.entries.length, 67);
  assert.equal(methodologyHtml.includes("<!-- MODEL-CATALOG -->"), false);
  const document = new JSDOM(methodologyHtml).window.document;
  for (const anchor of [
    "method-overview",
    "method-models",
    "method-references",
    "method-validation",
    "method-history",
  ])
    assert.ok(
      document.getElementById(anchor),
      `missing stable anchor ${anchor}`,
    );
  const modelSection = document.getElementById("method-models");
  assert.ok(modelSection);
  const rows = [...modelSection.querySelectorAll("tbody tr")];
  assert.equal(rows.length, catalog.entries.length);
  const sources = new Map<string, { url: string }>(
    catalog.sources.map((source: any): [string, { url: string }] => [
      source.id,
      source,
    ]),
  );
  catalog.entries.forEach((entry: any, index: number) => {
    const row = rows[index]!;
    assert.match(row.textContent ?? "", new RegExp(escapeRegExp(entry.name)));
    assert.deepEqual(
      [...row.querySelectorAll("a")].map((link) => link.getAttribute("href")),
      entry.source_ids.map((id: string) => sources.get(id)!.url),
    );
  });
  const wrapper = modelSection.querySelector<HTMLElement>(
    '.methodology-table[role="region"]',
  );
  assert.equal(wrapper?.tabIndex, 0);
  assert.equal(
    wrapper?.getAttribute("aria-label"),
    "Current model and mode inventory table",
  );
  assert.ok(
    modelSection.querySelector("details.methodology-catalog-sources summary"),
  );
  assert.equal(document.querySelectorAll(".methodology-table").length, 9);
});

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
