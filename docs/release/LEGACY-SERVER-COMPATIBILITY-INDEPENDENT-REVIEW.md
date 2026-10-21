# Independent legacy-server compatibility review

15 September 2026. **Bounded verdict: CLEAN.** Independently reviewed and executed the three ST10 scenarios in `apps/extension/test/legacy-server-compatibility.test.ts`, authored by a separate task. Only this report was written by this reviewer; production and test source stayed unchanged.

## Scope and method

The fixture uses actual Coordinator, default CompanyClient, LocalEstimateExecutor, domain repositories and fake IndexedDB. It performs the real client enrollment sequence against a synthetic transport and verifies a genuinely signed synthetic deletion-status instruction. Saved live/history observations are numerical fixtures, not provider text. The count callback rejects unexpected retokenization. The test compares exact canonical observation and original-envelope bytes across synchronization and IndexedDB close/reopen.

This is compatibility behavior against three controlled protocol responses. It does not test a deployed historical server, PostgreSQL, real browser permissions, actual provider traffic, remote-executor activation or empirical calculation accuracy. It also does not establish a complete capability-negotiation protocol or every historical-server/version combination: absence of advertised fields is exercised together with the specified missing/unsupported endpoint responses.

## Re-derived expectations and results

| Scenario | Actual observed behavior |
| --- | --- |
| Old config omits engine/result/history advertisements; selection and history endpoints return 404; live upload returns 422 `method_unsupported` | Local EcoLogits remains complete. Organization status is pending with `sync_delayed`; historical server view is unavailable while local/pending history remains visible. Numeric data and originals survive unchanged. |
| Strict selection reply declares requested engine unsupported | Organization state becomes unavailable with `method_unsupported`; local selected EcoLogits and its exact hash remain unchanged. Unsupported uploads/history remain queued. |
| Supported advertisement and endpoint control | Organization selection becomes current, compatible historical server projection is accepted, and live/history/coverage queues drain. |

Every scenario preserves the saved EcoLogits preference, effective method/hash, numerical live/history payloads and original result bytes through reopen. The tests assert no Original-view query is made. Selection writes, when supported by the endpoint, retain the exact requested EcoLogits method. Retained legacy-case live rows have recorded retry attempts, no quarantine reason and matching queued-record hashes; history and coverage queues remain present. The supported control is essential evidence that the fixture can acknowledge and drain those queues.

Source inspection agrees with the assertions: CompanyClient preserves numeric outbox rows and schedules retry after the rejected batch; successful responses require receipt/source checks before acknowledgement. EngineService distinguishes a compatible completed organization selection, an explicit unsupported method and a failed/missing endpoint. History reads retain their local/pending projection when the requested server projection is unavailable. No source path inspected here silently changes the selected engine to Original.

## Executed verification

```text
pnpm --filter @footprint/extension exec tsx --test test/legacy-server-compatibility.test.ts
3 passed, 0 failed, 0 skipped (3.36 seconds).
```

The exact test hash matched the owner's frozen handoff. No broad extension suite or build was run for this review. Pending rows are verified as retained and retryable; a later in-place server upgrade followed by successful retry is not a separately executed scenario here.

## Snapshot

Dependencies below were inspected for this bounded protocol behavior, not re-certified in their entirety.

Snapshot timestamp: `2026-09-15T10:56:53+00:00`. SHA-256 over file bytes.

| Path | SHA-256 |
| --- | --- |
| `apps/extension/test/legacy-server-compatibility.test.ts` | `95cb9a21f3b0b7c903e5282a3dfeb6fb9b3a87a5f166a67a86203e159afd8dd9` |
| `apps/extension/lib/coordinator.ts` | `04a47804bcb1f93602cc6598fe678306d696991ad6349ea5cb873f01d75e1b17` |
| `apps/extension/lib/company.ts` | `64f9c6c5c68ee4e1c51cc886ed9ecd59b94e3a408a02be63a4d8b57e4232875d` |
| `apps/extension/lib/estimation/service.ts` | `009f7f6761a46544bde6b4d0bcab5c260788c3fd0c72339d378b2d963acf2173` |
| `apps/extension/lib/history-service.ts` | `2d4e356c8841b9059ad87929856b3805309c1bb471e5323e63ac91b5d6c8db19` |
| `apps/extension/lib/runtime-composition.ts` | `5ef0d840eed9e701f2eaefa73d6ce89e46d9fe32ec4fe6283ba17e02df272d88` |

**Conclusion: CLEAN for the three exercised ST10 integration scenarios.** No actionable finding was reproduced. Broader legacy-version, native-browser, deployment and release gates remain outside this verdict.
