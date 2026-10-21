# Google tokenizer reference and T02 evidence gap

Investigated 10 September 2026 through the Codex in-app browser. **T02 remains unverified.** This note records a distinct official legacy reference and a possible implementation path. It does not promote any runtime profile, establish a current Gemini consumer-model mapping, or report executed parity tests.

## Verified public reference

Google's [Go tokenizer API documentation](https://docs.cloud.google.com/go/docs/reference/cloud.google.com/go/vertexai/latest/genai/tokenizer) and [versioned package](https://pkg.go.dev/cloud.google.com/go/vertexai@v0.19.0/genai/tokenizer) identify `cloud.google.com/go/vertexai` v0.19.0. Its [published tokenizer.go](https://github.com/googleapis/google-cloud-go/blob/vertexai/v0.19.0/vertexai/genai/tokenizer/tokenizer.go) explicitly supports only these model names:

- `gemini-1.0-pro`, `gemini-1.0-pro-001`, `gemini-1.0-pro-002`
- `gemini-1.5-pro`, `gemini-1.5-pro-001`, `gemini-1.5-pro-002`
- `gemini-1.5-flash`, `gemini-1.5-flash-001`, `gemini-1.5-flash-002`

These are legacy SDK mappings. They provide no evidence for Gemini 2.x, 3.x, automatic routing, consumer website labels, hidden reasoning, or complete request usage.

The source pins `google/gemma_pytorch` commit `33b652c465537c6158f9a472ea5700e5e770ad3f`, path `tokenizer/tokenizer.model`, and expected raw-byte SHA-256 `61a7b147390c64585d6c3543dd6fc636906c9af3865a5548f27f31aee1d4c8e2`. **The model bytes were not downloaded or independently hashed in this investigation.** The [asset repository LICENSE at that exact revision](https://github.com/google/gemma_pytorch/blob/33b652c465537c6158f9a472ea5700e5e770ad3f/LICENSE) is Apache-2.0. The inspected Google Go source is Apache-2.0, Copyright 2024 Google LLC. Distribution must retain applicable licenses, attribution and modification notices; original project MIT licensing does not replace them.

## Contract visible in the Go source

The [normalizer](https://github.com/googleapis/google-cloud-go/blob/vertexai/v0.19.0/vertexai/internal/sentencepiece/normalize.go) replaces U+0020 spaces with U+2581. It does not compose Unicode, add a dummy prefix, trim, or collapse whitespace. The [processor](https://github.com/googleapis/google-cloud-go/blob/vertexai/v0.19.0/vertexai/internal/sentencepiece/processor.go) requires BPE, rejects unsupported dummy-prefix and extra-whitespace normalization options, recognizes asset-defined `USER_DEFINED` symbols without merging them, and supports UTF-8 byte fallback. Merge priority follows float32 scores with earlier-position tie breaking.

`CountTokens` independently encodes each text part and sums lengths. Nontext parts fail. It inserts no role envelope, BOS, or EOS. The actual asset's piece types determine literal special-string behavior, so the existing OpenAI `encode_ordinary` policy is not an established Google contract. These observations describe the inspected Go reference, not verified Python `LocalTokenizer` semantics.

The [vendored processor README](https://github.com/googleapis/google-cloud-go/blob/vertexai/v0.19.0/vertexai/internal/sentencepiece/README.md) describes a pure-Go implementation compiled to WebAssembly for a browser demo. A packaged worker with bundled code and hash-verified model bytes is therefore a plausible implementation path. A port must preserve the reference algorithm and notices. Browser startup, CSP, memory bounds, performance and numerical parity still need testing. No such implementation or measurement was performed here.

## Explicit source-access boundary

The in-app browser previously rejected `https://raw.githubusercontent.com/googleapis/python-genai/main/google/genai/_local_tokenizer_loader.py` with `ERR_BLOCKED_BY_CLIENT`. That resource must not be revisited or obtained through pip, wheels, a CDN, alternate GitHub views, or another route around the denial. This investigation did not access it. The Go SDK source above is a distinct official implementation, not a copy of the denied Python file.

The inspected [Python SDK documentation](https://googleapis.github.io/python-genai/) rendered empty Local Count/Compute sections. The [official Cloud token-counting guide](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/list-token) confirmed local counting exists but did not expose a sufficient pinned model, asset and normalization contract. Neither observation proves that documentation or mappings do not exist elsewhere.

## Evidence required to close T02

A maintainer must supply independently reviewable evidence through an authorized source, respecting the access boundary above:

1. A pinned official Python `LocalTokenizer` release or immutable revision, exact supported model IDs, dependency versions and artifact hashes, plus the corresponding asset identity, provenance and redistribution notices. A legacy Go mapping cannot substitute for a current Python mapping.
2. The actual tokenizer asset bytes with independently verified SHA-256, and a precise contract for normalization, input serialization, text-part boundaries, Unicode handling, special/control/user-defined tokens, and BOS/EOS or envelope policy.
3. Reproducible **official Python reference results** over the committed synthetic corpus, recording the exact API invocation, environment, model, asset hash and fixture IDs. Include empty strings, NUL, composed/decomposed Unicode, emoji, spaces/tabs/newlines, literal special-token strings, long text and independent text parts. No employee text or provider credential belongs in the fixtures.
4. A separately implemented packaged browser counter that achieves 100% count parity against those frozen reference results, with mismatches retained as failures. Tests must also cover missing/corrupt assets, unsupported mappings, bounded worker operation and actual Chrome, Edge and Firefox execution. Ordinary tests and employee use must remain local, without downloading executable code or sending text to a counting service.

T02's [acceptance criterion](../implementation/ACCEPTANCE-AND-FAILURES.md) is official Google LocalTokenizer parity for mapped models/assets, including normalization, Unicode and special-token policy. Until the above evidence is accepted, retain the current unverified model-mapping status. The existing OpenAI reference BPE tests do not validate Google compatibility, and success against the legacy Go reference alone does not close T02.
