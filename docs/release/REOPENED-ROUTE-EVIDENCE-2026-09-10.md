# Reopened conversation identity evidence

10 September 2026. The conductor reopened the existing synthetic Gemini and Perplexity tests through the in-app browser. No new prompt, generation, upload or provider configuration change was made. Only the selected synthetic conversation responses were inspected. Raw bodies and authentication material stayed out of repository files and were released from the working capture variables after minimization.

The [minimized identity fixture](../../fixtures/provider-identity-2026-09-10.json) replaces every provider ID with synthetic values while preserving equality relationships. The earlier [browser audit](../implementation/LIVE-BROWSER-AUDIT-2026-09-09.md) supplies the generation-protocol context. This check does not establish native extension execution or new generation-field availability.

## Gemini

The selected route had the form `/app/<16 lowercase hexadecimal characters>`. Reopening it issued the `hNvQHb` history RPC through `/_/BardChatUi/data/batchexecute`. Its eight-element argument array began with exactly `c_` followed by the route suffix. That same identifier and the expected synthetic marker occurred in the retrieved response. Loading completion was observed and the event buffer was not truncated.

This supports that strict route-to-conversation transformation. The existing generation adapter already preserves the prefixed conversation ID from request context and response metadata. Implementing route reopening still requires shared validation, correct namespace handling, race checks and proof that no new consumption is recorded. It does not establish Gemini tokenizer mapping or natural completion semantics.

## Perplexity

The selected route `/search/<UUID>` retrieved `/rest/thread/<same UUID>`. The decoded response contained six entries and reported no next page. Each entry's `thread_url_slug` equalled the route UUID; the first array entry's `backend_uuid` also equalled it. Across those six entries:

- `backend_uuid` had six distinct UUIDs.
- `uuid` and `frontend_uuid` matched each other per entry and had six distinct UUIDs.
- `context_uuid` had one shared UUID.
- `frontend_context_uuid` had another shared UUID, different from `context_uuid` and the route.

The event buffer reported truncation, although the selected response body was retrieved and parsed successfully. This is therefore bounded history-response identity evidence, not a complete network recording.

A later read-only reload confirmed that the selected response uses the browser's `Fetch` transport and returns HTTP 200. The parsed envelope again contained six entries, `has_next_page: false`, matching route slugs and matching `uuid`/`frontend_uuid` pairs. Its top-level keys and query parameter names were added to the minimized fixture; values, headers, raw IDs and response content were not retained. The request event was outside that truncated buffer, so this recheck does not independently re-establish its method or initiator. No new prompt, generation or upload was sent, and observation was disabled after the selected response was minimized.

Do not use the route UUID as either context UUID, collapse all six request identifiers into one, or assume every history field appears in generation SSE. Those shortcuts would produce incorrect conversation or request identity. Any production mapping must use the established relationships and positively correlated observations. Perplexity route correlation remains incomplete until its actual producer and lookup path are implemented and independently verified.
