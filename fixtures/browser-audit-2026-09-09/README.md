# Reduced browser-audit fixtures

These are hand-authored, reduced structural examples derived from the [9 September live audit](../../docs/implementation/LIVE-BROWSER-AUDIT-2026-09-09.md). All IDs, credentials, percentages and text in these examples are synthetic. They are not exported authenticated responses.

Run the dependency-free reference checks from the repository root:

```powershell
node --test fixtures/browser-audit-2026-09-09/reference.test.mjs
```

The files have distinct roles:

- `examples.mjs`: synthetic protocol examples and wire-format builders. Builders recreate only the shapes needed by the tests.
- `reference-decoders.mjs`: small research-only decoders for the observed subset. They do not install browser hooks, count model tokens, persist content or contact any server.
- `reference.test.mjs`: explicit text/state expectations plus malformed-input, fragmentation and duplicate-event checks.

Verification on 9 September 2026: 32 tests passed on Windows using Node v24.12.0. This records the test environment, not the extension's minimum runtime. The tests establish the documented reduced grammar, not complete live-schema coverage. Before shipping, create reviewed, sanitized full-shape fixtures for each declared supported mode and verify the actual production adapter against them. Keep original private captures out of the repository, including local temporary files in a synced workspace.

Important limitations:

- The ChatGPT reducer models observed top-level path/operation inheritance. It does not prove every private `v1` operation, event ordering or `c` semantic. It fails on unsupported operations and conflicting duplicate IDs.
- Perplexity fixtures exercise workflow root replacement, array insertion and field replacement. During streaming, `chunks` supplies provisional text; the final `text` replaces it. It is never added to it. Perplexity user cancellation was not successfully captured live.
- Gemini framing is validated using UTF-16 units, after incremental UTF-8 decoding. Positions are observations for one build, not a published stable API.
- These examples cannot establish API-token parity, a closest tokenizer, hidden reasoning size, physical resource usage, browser compatibility or extension performance.
- No executable code here is downloaded into the employee extension. Production code needs its own packaged implementation, input limits, cancellation/backpressure behavior and security review.
