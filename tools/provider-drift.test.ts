import assert from "node:assert/strict";
import test from "node:test";
import { driftKinds, driftReport } from "./provider-drift";
import { PROVIDER_VOCABULARY } from "../packages/adapters/src/vocabulary";

// Synthetic page code only: no provider code is stored in the repository.

test("W10 drift: a new event next to known ones is listed, and a known one that is gone", () => {
  const known = PROVIDER_VOCABULARY.claude.events;
  assert.ok(known.includes("message_start") && known.includes("message_stop"));
  const code = [
    'switch(e.type){case"message_start":a();break;case"content_block_start":b();break;',
    'case"brand_new_event":c();break;case"message_stop":d();break}',
    // Far from the protocol switch: an ordinary interface name is not a candidate.
    " ".repeat(5000),
    'const label="settings_panel";',
  ].join("");
  const report = driftReport(code, driftKinds(PROVIDER_VOCABULARY, "claude"));
  assert.deepEqual(report.events!.candidates, ["brand_new_event"]);
  assert.ok(report.events!.found.includes("message_start"));
  assert.ok(report.events!.missing.includes("message_delta"));
  assert.ok(!report.events!.candidates.includes("settings_panel"));
});

test("W10 drift: a name next to only one known name, or of another shape, is not a candidate", () => {
  const kinds = {
    deltas: { known: ["text_delta", "thinking_delta"], shape: /_delta$/ },
  };
  const lone = driftReport('x("text_delta","odd_delta")', kinds);
  assert.deepEqual(lone.deltas!.candidates, []);
  const pair = driftReport(
    'x("text_delta","odd_delta","thinking_delta","NotADelta","other")',
    kinds,
  );
  assert.deepEqual(pair.deltas!.candidates, ["odd_delta"]);
  // A name another kind knows is not new, though it has this kind's shape.
  const events = driftReport(
    'x("text_delta","content_block_delta","thinking_delta")',
    {
      ...kinds,
      events: { known: ["content_block_delta"], shape: /^[a-z_]+$/ },
    },
  );
  assert.deepEqual(events.deltas!.candidates, []);
  // Names with no shape are only checked for presence.
  const presence = driftReport('call("gArtLc","zzzzzz","v9rmvd")', {
    rpcs: { known: ["gArtLc", "v9rmvd", "VfAZjd"], shape: null },
  });
  assert.deepEqual(presence.rpcs, {
    found: ["gArtLc", "v9rmvd"],
    missing: ["VfAZjd"],
    candidates: [],
  });
});

test("W10 drift: every site's vocabulary comes from its reader's own lists", () => {
  for (const [site, kinds] of Object.entries(PROVIDER_VOCABULARY))
    for (const [kind, names] of Object.entries(kinds)) {
      assert.ok(names.length > 0, `${site} ${kind}`);
      assert.equal(new Set(names).size, names.length, `${site} ${kind}`);
    }
  assert.ok(
    PROVIDER_VOCABULARY.claude.deltas!.includes("thinking_summary_delta"),
  );
  assert.ok(
    PROVIDER_VOCABULARY.chatgpt.events!.includes("server_ste_metadata"),
  );
  assert.ok(
    PROVIDER_VOCABULARY.perplexity.items!.includes("WORKFLOW_ITEM_TEXT"),
  );
  assert.deepEqual(PROVIDER_VOCABULARY.notebooklm.rpcs, [
    "gArtLc",
    "v9rmvd",
    "VfAZjd",
  ]);
});
