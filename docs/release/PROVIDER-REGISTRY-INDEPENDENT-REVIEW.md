# Provider registry: independent bounded review

Date: 15 September 2026. Branch: `codex/modular-ecologits-refinement`. Base HEAD: `15515fdb70b196c04d72e48494d8a9bc8090a6eb`. This review covers the working-tree files identified by hashes below, not a committed release.

**Verdict: CLEAN within the reviewed AR04 scope.** No actionable finding was identified in the registry contract, packaged entries, compatibility export, capture injection or accompanying documentation. The reviewer independently inspected the changes, executed 124 focused tests and five additional probes, and ran extension typechecking. No implementation or test source was edited during this review.

## Scope and criteria

The implementation adds a trusted local `ProviderAdapter`/`ProviderAdapterRegistry` boundary for the four existing sites. It supplies generation-route matching, dispatch parsing, fresh session construction and response framing to `installCapture`. Formula, persistence and organization implementations are outside the change. The relevant acceptance criteria are AR04 and the applicable preservation requirements in BC01-04, BC07-09 and BC11; this review does not close the installed-browser requirement in BC10.

| Criterion | Result | Independent evidence |
| --- | --- | --- |
| A fixture adapter can replace provider parsing through actual tracking | PASS | A Claude fixture used a route and body outside the packaged Claude parser and selected Gemini framing. Its canonical messages entered the real `Coordinator` and memory repository, producing one request and one attempt without estimator, storage or organization source edits. Saved observations excluded the supplied input/answer text; the organization transport was never called. |
| The packaged four providers and `createSession` compatibility remain intact | PASS | Inspected all four registry entries against their existing route/parser/session implementations. The 32 adapter tests exercised default dispatch, framing, stop state, fresh sessions, patches, candidate ambiguity, history and attachment fixtures. |
| Registration is immutable and session state is per request | PASS | The factory snapshots and freezes the entry metadata/function identities. Duplicate/unsupported definitions are rejected, later entry mutation does not replace registered callbacks, and default session creation starts with fresh state. |
| Host/origin/permission restrictions remain authoritative | PASS | Host selection still precedes registry lookup; same-origin validation precedes generation-route matching. Unknown hosts and foreign-origin requests do not reach a replacement adapter. Stop-control source/origin checks and revoked-site permission tests passed. No permission or manifest configuration is part of the diff. |
| Native fetch behavior is preserved | PASS | Existing tests and independent probes preserved the native receiver, argument objects, Promise, Response and body. Independent probes preserved the exact synchronous exception and rejected Promise/error. Session-factory failure did not replace native delivery. |
| Response framing comes from the adapter without weakening canonical validation | PASS | A Claude replacement selected Gemini framing and consumed a response split at every UTF-8 byte, including an emoji. The resulting capture passed the canonical validator. The cross-site dispatch test produced only sanitized health output and no later unbound end message. |
| Streaming, stop and cancellation preserve the host branch | PASS | Permission stop cancelled measurement while the original stream still delivered its complete prefix and suffix. A separate packaged-Claude stop request produced cancelled capture state while preserving both native requests and response bodies. Existing bounded-stream, socket-image, bfcache and history cancellation tests passed. |
| Historical and upload constraints remain in force | PASS | Inspected their unchanged site-specific runtime paths. Focused tests covered native XHR history, literal/opaque body handling, upload prerequisites, pending response reads, late/reset work, byte access, local handles, permission loss and noninterference. |
| Public documentation reflects the actual contract | PASS | README correctly describes the five fields, synchronous session capabilities, immutable registrations, mutable request sessions, packaged-only injection and existing site-specific stop/upload/history handling. It distinguishes package/persisted adapter version `0.1.0` from capture-envelope version `1` and does not invent per-entry version negotiation. |

## Executed checks

All commands ran locally without a package build or full workspace test suite.

| Command | Result |
| --- | --- |
| `pnpm --filter @footprint/adapters test` | 32 passed |
| `node --import tsx --test apps/extension/test/provider-adapter-injection.test.ts apps/extension/test/capture.test.ts apps/extension/test/perplexity-request-identity.test.ts apps/extension/test/history-capture.test.ts apps/extension/test/upload-observer.test.ts apps/extension/test/upload-body.test.ts apps/extension/test/upload-correlation.test.ts` | 72 passed |
| `node --import tsx --test apps/extension/test/file-grant-background.test.ts apps/extension/test/history-xhr.test.ts apps/extension/test/permissions.test.ts` | 20 passed |
| `pnpm --filter @footprint/extension typecheck` | Passed |
| `git diff --check` scoped to the seven reviewed files | Passed; only the repository's existing LF/CRLF conversion notices |

### Additional independent probes

These probes ran as in-memory `node --import tsx --input-type=module` scripts, using native Node `Promise`, `Response` and `ReadableStream` objects with a synthetic `EventTarget` window. Capture polling used 1.5-2-second deadlines. Each restored global descriptors and shut down its installed hook; the Coordinator probe disposed its services. They did not modify source or exercise authenticated traffic.

1. **Different framing through actual tracking.** Registered only a Claude fixture adapter whose route was `/independent/run`, whose dispatch body was fixture-only syntax, and whose `responseFormat` was `gemini`. Framed `{"answer":"registry output 🧪"}` with the Gemini guard and its UTF-16 length plus two; supplied one UTF-8 byte per stream chunk. Asserted the exact native Promise/Response/receiver/arguments/body, canonical capture output and the final decoded answer. Passed each message into a real Coordinator with a deterministic typed counter and `createMemoryRepository`. Asserted one saved request and attempt, the expected answer count, no supplied input/answer text in persisted observations and zero organization transport calls.
2. **Synchronous native failure.** The native fetch stub threw a sentinel error. The installed wrapper threw that exact object and created no measurement message.
3. **Rejected native Promise.** The native stub returned a controlled Promise. The wrapper returned the exact same Promise, and its rejection preserved the sentinel error identity.
4. **Measurement cancellation while the host continues.** Held an SSE stream after a first frame, waited for dispatch, then sent the valid same-window/same-origin stop control. Added a suffix and closed the stream. The native response retained the exact full byte sequence; no further capture messages appeared after the stop.
5. **Default Claude stop request.** Used `installCapture()` with the packaged registry, a real Claude content-block frame and its same-origin `/stop_response` request. Observed cancelled progress and final state. Both native Promises, receivers, argument objects and response bodies remained unchanged.

## Reviewed source snapshot

These hashes were calculated independently and match the owner's final handoff, including the later documentation-only addition.

| File | SHA256 |
| --- | --- |
| `packages/adapters/src/types.ts` | `9fa943b6c49c95c189da3fa99106b32b40b3db656f229fe69582c02e7f086617` |
| `packages/adapters/src/index.ts` | `63ac0b408a7df3a84219e000be19bdf8124779c82e056f8dbe9b93008d5c88e5` |
| `packages/adapters/src/registry.ts` | `f7f2377f4b0fa93ad6a4c3f5bc7272423e5187b035baac2f0a051c926b949b11` |
| `apps/extension/lib/capture-runtime.ts` | `07162b34ace09ff2f1dd0af9bbba9e6052edfce5413d0c0c9c7101378096656d` |
| `packages/adapters/test/registry.test.ts` | `85178eae548c9f75475cc8fdfbd315b06f225f713122cfa95b27f989c78f9cf5` |
| `apps/extension/test/provider-adapter-injection.test.ts` | `6b67136ad0d05c432594115c51ec7cc0c6efaf734bc376d696cd8a2bb90ad019` |
| `packages/adapters/README.md` | `931cf347ceab39328a85aaefc60fe774b310ff947e91ced79bf6763b7ae6dff5` |

## Limits of this verdict

This is a source, fixture and local runtime-contract review. It does not establish installed Chrome/Edge/Firefox behavior, all twelve browser/provider combinations, performance targets or current live provider protocol coverage. It does not add provider capabilities, authenticate registry definitions or establish tokenizer/footprint accuracy. Registry entries remain trusted packaged code; no page-message registration or remote loading was introduced. No broad suite, release package build, deployment or publication was performed.
