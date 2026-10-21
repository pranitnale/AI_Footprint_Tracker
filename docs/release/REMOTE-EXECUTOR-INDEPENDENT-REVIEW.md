# Independent dormant remote-executor review

15 September 2026. **Final bounded verdict: CLEAN.** Review of `packages/estimator/src/engines/remote-admission.ts` and its tests in the shared refinement checkout. Source was read-only for this reviewer; only this report was written. Initial verdict was FINDINGS. The reproduced admission-boundary defect was fixed by its owner and independently verified resolved below.

## Scope and acceptance boundary

Requirements were re-derived from RE01-RE12 in the modular acceptance matrix, particularly RE05/RE06/RE07/RE10. Reviewed capabilities: typed injected transport failures, bounded attempts/deadlines/backoff, Retry-After, same-request idempotency, cancellation/current-state checks, physical capacity two, explicit offline-only exact-method local fallback, strict response/source/profile/lineage admission and absence of endpoint activation.

All executed requests were synthetic Node/TypeScript fixtures with injected transports. Native local estimator results were used as response/fallback fixtures. No provider traffic, credentials, external server, browser installation, PostgreSQL target or real remote estimation endpoint was used. This review does not claim authenticated remote service behavior, remote numerical accuracy, durable server idempotency or the eventual caller's atomic storage/publication correctness.

## REX-01: Response serialization could impersonate an offline transport failure (P2)

Initial locations: `admitExecutionResponse`, around JSON serialization and its exception handler; the surrounding `estimate` retry/fallback catch. Initial helper source SHA256: `ab9bf9b58b0b1d011db8840d368e27c9b155e8ba525553b0066ccbaf56066215`.

The injected transport resolved successfully with this malformed object:

```ts
{ toJSON() { throw new RemoteEstimationFailure("offline"); } }
```

The receiver calls `JSON.stringify` on non-string responses. Its admission catch preserved every `RemoteEstimationFailure`, including one thrown by response serialization rather than a trusted validation branch. The outer retry catch classified that as a transport outage and invoked the configured exact Original fallback.

Independent observed result: one transport call, one local fallback call, and an accepted result with `execution_origin: "local"`. No transport failure had occurred. This violates the required distinction between an explicit offline transport condition and a malformed/executable response. It is an adversarial injected-object case, not a claim that ordinary parsed JSON can contain executable functions or that an external endpoint was exploited.

The owner added a private `ResponseAdmissionFailure` type used only by the helper's own response-validation branches. That type can preserve `response_invalid`/`response_mismatch`; arbitrary serialization/getter exceptions, including public transport/estimation error instances, are converted to `response_invalid`. The retry loop therefore cannot interpret them as offline/retryable transport failures.

The original reproduction was independently repeated after the fix. A six-case extension used both `toJSON` and an enumerable getter throwing each of `offline`, `rate_limited` and `server_unavailable`. All six returned `response_invalid` after one transport call, with zero fallback calls and no retry. This verifies the functional remediation. Final persisted regression and formatting results are recorded below.

## Independent source-derived probes

| Probe | Observed result |
| --- | --- |
| HTTP 503 with Retry-After 15 ms, then 429 with Retry-After zero, then 599, then success | Four bounded attempts; waits were 15, 6 and 12 ms with a 3 ms base and 15 ms cap. Every attempt received the same frozen request object, operation, source and accepted binding. No pending timers remained. |
| Two cancelled local fallbacks that ignore abort | They retained both physical slots. A third estimate returned `busy` without invoking transport or fallback. Resolving both abandoned promises freed capacity; a later exact-local fallback succeeded. |
| Real timer deadlines with two transports that never cooperate with abort | The call ended with typed `timeout` after two attempts. A further call was `busy` while both physical promises remained unsettled. Late malformed responses did not fulfill the timed-out call. |
| Valid response with corrupted output digest | One transport call, terminal `response_mismatch`, no fallback. |
| Ordinary malformed object, invalid JSON string, null and nonfinite response | Each returned `response_invalid` with one transport call and no fallback. |
| REX-01 malicious serialization/getter matrix after fix | All six cases returned `response_invalid`, one transport call, zero fallback/retry. |
| Malicious local fallback result throwing an internal offline/rate-limited error during serialization | Terminal `response_invalid`, one explicit offline transport failure and one fallback call; no recovery recursion. |

These probes were additional to the implementer's tests and ran from PowerShell here-string input to `node --import tsx --input-type=module`, with synthetic frozen-corpus observations and temporary in-memory promises/clocks. No source test fixture was changed by the reviewer.

## Acceptance assessment

| Criterion | Evidence and bounded disposition |
| --- | --- |
| RE01 | PASS in the injected boundary: personal mode rejects before transport, and stale/aborted calls cannot send. This does not replace full personal application/package network inspection. |
| RE02 | Trusted composition supplies company capability/authorization context. The helper does not infer consent or implement authentication. Caller capability-negotiation behavior remains outside this review. |
| RE03/RE04 | Strict response envelope, company/install/operation/generation/revision, source, requested/effective identity, profile selection, auxiliary method hash, input hash, origin, view and original lineage are compared. Existing adversarial tests and real local-result fixtures pass. Hash consistency is not proof of remote arithmetic or authentication. |
| RE05 | PASS for fake transport contract: retries reuse one frozen accepted request and operation; timeout-after-possible-completion fixture computes once and ignores its late alternative. A real service must still implement durable idempotency against the full accepted request. |
| RE06 | PASS for exact fallback contract: only explicit offline state enters fallback. The full declared requested method must match and the executor must declare local origin. The returned source, effective child/profile, input, auxiliary identity, view and lineage are admitted against the original accepted request. Original, EcoLogits and EcoLogits-to-Original policy fallback are covered. |
| RE07 | PASS for helper failure behavior: missing, mismatched or nonlocal fallback returns a typed unavailable outcome without substituting another method. The helper does not persist observations or render pending UI; that remains the caller's responsibility. |
| RE08 | PASS for one returned result and bounded unsettled execution behavior. Late alternatives cannot fulfill the old promise. Durable local-versus-remote contribution deduplication belongs to the future storage caller and is not established by these in-memory tests. |
| RE09 | PASS for supplied current-state/cancellation guards before calls and after awaits/admission, including backoff/fallback races. The caller must make `isCurrent` reflect actual selection/source/scope/erasure state and enforce its final atomic publication guard. |
| RE10 | PASS for inspected typed status matrix and executed retry/deadline controls. 401/403/409/413/422 are terminal; 429 and 5xx retry only within configured bounds. Retry-After above the allowed delay ends the operation instead of retrying early. Unexpected transport exceptions are sanitized. |
| RE11 | Strict bounded response and exact binding checks reject malformed, oversized, nonfinite, substituted-policy and forged-lineage results. REX-01's response/transport confusion was independently reproduced and functionally corrected as above. |
| RE12 | Source inspection finds only an injected transport, no endpoint or authentication activation. Searching application source found no remote-executor construction/call site, only the explicit dormant-boundary documentation. Final packaged/network/permission inspection is a separate release gate. |

## Implementation constraints verified from source

- Retry policy is strictly validated and snapshotted: one to four total attempts, per-attempt timeout at most 60 seconds, positive bounded backoff, and base delay no larger than the cap. Defaults are three attempts, a 10-second per-attempt timeout, 250 ms base delay and 5-second cap.
- Timeout and cancellation signal abort but do not pretend an uncooperative transport stopped. At most two physical transport/fallback promises remain unsettled per executor instance, with no internal waiting queue. A permanently hung promise keeps its slot; this is bounded degraded operation, not a guarantee of resource reclamation.
- Offline fallback is an explicit opt-in. HTTP failure, timeout exhaustion, stale scope, cancellation, capacity failure and invalid response do not silently switch formula or execute a local fallback.
- The fallback executor is still admitted using the accepted requested/effective method and input/profile/lineage bindings. A matching method name, claimed local origin or recomputed result digest alone cannot authorize another method/profile.
- Executor `executionOrigin: "organization"` remains immutable composition metadata, even when its accepted fallback result is labeled local. It does not authorize remote use of local-only archived read grants.
- No persistence, automatic capability activation, endpoint, credential, provider call or real network retry implementation was introduced by this review.

## Executed suites and limitations

The initial independent full `@footprint/estimator` run passed **92/92 tests**, zero skips, and package typecheck passed. These included the owner-reported 33 remote tests plus the existing original/parity/history/selection suites. A post-fix rerun also passed 92 tests/typecheck while the owner was still adding the permanent serialization regression. Formatting correctly reported the then-unformatted new private helper; the reviewer did not fix source formatting.

The retries and fake service behavior are not PostgreSQL, authenticated transport, production deployment, native browser or physical-resource accuracy evidence. No such gate is closed here. Comparison-tool implementation and the broader AR05/layer-gate work are outside this file's independent scope.

## Final independent closure

**REX-01: PASS. No unresolved runtime finding remains in this bounded helper review.** The final source moves received-response admission outside the transport retry catch, uses the private validation sentinel, and sanitizes local-result hash serialization before local admission. This prevents response objects from initiating transport recovery even if they throw public internal-looking errors. Both the original reviewer reproduction and the six-case extension pass with terminal `response_invalid` and no fallback/retry. The local-result extension also passes without recovery recursion.

Final independently executed commands:

| Command | Result |
| --- | --- |
| `node --import tsx --test packages/estimator/test/remote-admission.test.ts` | 39 passed, zero failures/skips, 885.69 ms. |
| `pnpm --filter @footprint/estimator test` | 98 passed, zero failures/skips, 2717.52 ms. Includes the remote tests; these totals are not additive. |
| `pnpm --filter @footprint/estimator typecheck` | PASS, exit 0. |
| `pnpm exec prettier --check packages/estimator/src/engines/remote-admission.ts packages/estimator/test/remote-admission.test.ts` | PASS. The earlier intermediate formatting warning is resolved. |
| Additional reviewer source-derived probes listed above | PASS. |

| Final source boundary | SHA256 |
| --- | --- |
| `packages/estimator/src/engines/remote-admission.ts` | `dc52b22a9d1670702028317964e1ddc17ce4f5b45d43e6654c1a71ee318d897d` |
| `packages/estimator/test/remote-admission.test.ts` | `39f7402ad01b7a643ac2c259d37f100cf30d07e840cd8ce947bbb634eacefc5e` |
| `packages/estimator/README.md` | `bda0c47ff86fdf23bdb4f01b1483b79c0b1782917c378f414f18123f3b1f6e01` |

RE05/RE06/RE07/RE10 pass their requested dormant injected-transport scope. RE08's durable competing-authority storage result, RE02's actual authorization/capability integration and RE12's final packaged network inspection remain separate caller/release gates. The factory has not become an active remote endpoint. This review does not authorize activation, deployment or use of local-only grants for remote work.

A documentation synchronization note was sent to the parent: the canonical package README now describes implemented retry/fallback behavior, but `tools/refinement/README.md` still contained an earlier statement that retries were future work at the final read. That broader tooling document is outside this review's owned files and does not change the runtime verdict. No other source/report was edited here; no commit, push or deployment occurred.
