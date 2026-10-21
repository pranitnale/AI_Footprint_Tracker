# Provider adapters

`@footprint/adapters` turns observed provider requests and response frames into transient `Dispatch` and `Snapshot` values. It does not estimate resources, persist observations, contact an organization server or establish provider accuracy.

## Public registry contract

`ProviderAdapter` has five required fields:

| Field                          | Contract                                                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `site`                         | One existing supported site: `claude`, `chatgpt`, `gemini` or `perplexity`. It must match the host selected by the capture runtime. |
| `responseFormat`               | `sse` for SSE frames or `gemini` for the existing length-framed Gemini decoder.                                                     |
| `generationRoute(url, method)` | Recognizes generation requests for that provider. Matching does not grant host access.                                              |
| `parseDispatch(url, body)`     | Returns the canonical `Dispatch` shape, including the matching site. The body is transient observed text.                           |
| `createSession()`              | Creates a fresh mutable `ProtocolSession` for one generation. Never share a session between requests.                               |

A session requires `snapshot()` and `stopped()`. Its parsing capabilities must match the response format: implement `frame()` for SSE or `gemini()` for Gemini frames. `socket()` is optional and is used only by the existing guarded ChatGPT socket path. Snapshots retain the existing text, thinking, identifiers, image operations, limitations and execution-state contract. Upload observation, stop-request matching and historical-read observation retain their existing provider-specific runtime handling; this registry does not add those capabilities to another site.

**Versions:** the current package and persisted observation `adapter_version` are `0.1.0`; the transient capture envelope uses version `1`. The current registry has no per-entry version field or dynamic capability negotiation. A replacement must satisfy the current shapes and semantics. Changing a wire or observation contract requires an explicit coordinated version/schema change, not an invented field on a registry entry.

`createProviderAdapterRegistry(entries)` copies and freezes entries and their function references. Duplicate sites, unsupported sites, invalid response formats and missing functions are rejected. `get(site)` returns the frozen entry or `undefined`. The registry is immutable; request-local session state is mutable. Keep configuration in captured immutable values and mutable stream state inside the session, rather than modifying registration objects after construction.

`PACKAGED_PROVIDER_ADAPTERS` contains the four existing implementations. The public `createSession(site)` compatibility function uses this packaged registry. Existing `generationRoute` and `parseDispatch` compatibility exports retain their packaged behavior.

## Replace one packaged implementation

The extension's MAIN-world entrypoint can pass a locally imported registry to `installCapture`. For example, from `apps/extension/entrypoints/capture.content.ts`:

```ts
import {
  createProviderAdapterRegistry,
  PACKAGED_PROVIDER_ADAPTERS,
  type ProviderAdapter,
} from "@footprint/adapters";
import { installCapture } from "../lib/capture-runtime";
import { reviewedClaudeAdapter } from "../lib/reviewed-claude-adapter";

// reviewedClaudeAdapter is a locally authored ProviderAdapter with site "claude".
const replacement: ProviderAdapter = reviewedClaudeAdapter;
const providers = createProviderAdapterRegistry(
  (["claude", "chatgpt", "gemini", "perplexity"] as const).map((site) =>
    site === replacement.site
      ? replacement
      : PACKAGED_PROVIDER_ADAPTERS.get(site)!,
  ),
);

// Use this callback as the existing content-script definition's main function.
const main = () => installCapture(providers);
```

The replacement module above is illustrative. No estimator, storage or organization implementation needs to change for a compatible adapter replacement. Calling `installCapture()` uses the packaged registry. Injection happens once at construction from local imports; there is no page-message registration, remote module loading or mutable global plugin manager.

## Permission and failure boundaries

The registry does not change manifest matches, explicit host permissions, origin/frame checks or the permission-revocation path. The capture runtime still selects a recognized host and checks same-origin requests before consulting the route matcher. A registry cannot enable capture on an unrelated host. Keep the existing content-script definition and permission checks when replacing its `main` callback.

Capture observes a bounded cloned response branch and returns the host's original fetch promise, response, arguments and body. Session-construction failure reports an unavailable adapter without replacing that native result. Parser failures follow the existing explicit capture-failure path. Canonical validation remains mandatory: an invalid dispatch is reported, its measurement branch is discarded/cancelled, and no later unbound end message is forwarded. Unknown values must remain unknown rather than becoming fabricated identifiers, counts or completion states.

## Focused validation

Run from the repository root:

```sh
pnpm --filter @footprint/adapters test
pnpm --filter @footprint/extension exec tsx --test test/provider-adapter-injection.test.ts test/capture.test.ts test/perplexity-request-identity.test.ts test/history-capture.test.ts test/file-grant-background.test.ts
```

These checks cover fixture substitution through actual `installCapture`, canonical output validation, immutable registration, four-provider parsing fixtures, native forwarding, stream/socket behavior, stop/revocation, historical observation and upload boundaries. They use synthetic fixtures and transport doubles; passing them does not establish native-browser compatibility, new provider coverage or measurement accuracy.
