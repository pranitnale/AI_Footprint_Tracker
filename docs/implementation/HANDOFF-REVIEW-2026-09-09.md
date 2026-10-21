# Implementation handoff review

Review date: 9 September 2026. Scope: reconcile the recorded product decisions, research and design requirements into an implementable specification. This review did not implement or deploy the production app.

## Result

The [implementation handoff](../../IMPLEMENTER-HANDOFF.md), [phase plan](../../IMPLEMENTATION-PLAN.md), [product/enrollment specification](PRODUCT-AND-ENROLLMENT-SPEC.md), [contracts](CONTRACTS.md) and [acceptance matrix](ACCEPTANCE-AND-FAILURES.md) form the current implementation starting point. Coding can begin with P0. Public company enrollment/pricing/IP collection still depends on the three explicitly pending owner policy choices and real deployment configuration.

## What was reconciled

| Earlier gap or conflict | Current resolution |
| --- | --- |
| Invitation-only/no-email identity mixed with later OTP decisions | One tenant-bound work-email OTP flow, stable email/user mapping and separate installation credentials; obsolete enrollment/pairing/recovery endpoints removed |
| Public registration expected to authenticate a different tenant origin automatically | One-use nonce/origin/draft/recipient-bound first-admin bootstrap, no wildcard cookie or repeated OTP; exact bounded form-body exception and no-store redirect |
| Reconnect created a new device while promising to resume the original device's queue | Verified same-profile reconnect proof preserves original device identity and capture eras, with new credentials; reinstall and security revocation remain distinct |
| Host-only cookies alone did not address sibling cookie injection | Prefixed secure cookies with no Domain and fixed Path, explicit duplicate-cookie rejection and sibling-origin tests |
| Hosted and self-hosted requirements absent from the core schema/phase plan | Explicit personal/hosted/self-hosted modes, registration/routing, tenant-scoped tables/jobs/caches, operator authority and plan/exception records |
| Universal indefinite retention conflicted with six-month free hosting | Deployment-specific usage policies across request families, derived totals, local queues, exports and restore; IP/mail retention stays separate |
| Older warning placement conflicted with the reviewed design | Above-composer, nonblocking above-50% banner; basis/progress inside same-page nonmodal Details; no automatic host action |
| Unconditional holdout requirement could block a qualified rough baseline | Functional/source/arithmetic/privacy/scope gates remain mandatory; measured validation is required before calibrated claims or candidate promotion, not fabricated when data is unavailable |
| Reference catalogs could be mistaken for approved runtime profiles | Explicit P0/P6 baseline-bundle applicability/assumption review; external research-only data excluded; scoped highest-comparable results distinguished from reference-only figures |
| Old schema header and incomplete requirement map | Observation schema 1.1.0 is explicit; R01-R24 mapped to phase/test owners, including first-release images and hosted/personal flows |

The research coefficients, public methodology article, 67-entry recognition catalog, image cohort and design-canvas structure were not changed by this handoff pass. Design comments/anchors remain intact. Source-backed resource estimates retain the known input/context and closed-provider uncertainty limitations.

## Independent reader review

Two read-only reviewers checked the actual updated documents:

- Measurement/design reviewer: no remaining measurement blockers; verified conversation accounting, history exclusions, image scopes, runtime qualifications, warning/overlay behavior and evidence limits. Its research-precedence wording finding was corrected.
- Identity/hosting reviewer: first-admin bootstrap, reconnect ownership, cookie isolation and form/JSON transport findings were corrected and rechecked. All findings closed **at the specification level**. This is not a penetration test or implementation approval.

The documentation workflow used independent fresh-reader checks to expose assumptions an implementer would otherwise have to guess. The installed engineering-review skill could not load its required review-sections reference, so direct contract review and independent reader checks were used instead. No successful formal run of that unavailable skill is claimed, and no browser package/tool was installed as a workaround.

## Executed local checks

```sh
node tools/build-methodology.cjs --check
node --test tools/context-energy-study.test.cjs tools/offset-audit.test.cjs tools/methodology-reference.test.cjs tools/methodology-checks.test.cjs design-canvas/test.cjs fixtures/browser-audit-2026-09-09/reference.test.mjs tools/handoff-consistency.test.cjs
git diff --check
```

Results: generated methodology check passed with 115,996 article characters and 67 catalog records; **99/99 offline tests passed**; diff whitespace check passed. Git reported the existing Windows line-ending conversion notices, not whitespace-test failures.

The eight new handoff checks verify requirement mapping, 24 unique PE scenarios, retired/replacement auth interfaces, bootstrap/reconnect/cookie requirements, schema/retention consistency, warning/Details placement, local/research isolation, visible pending decisions and local documentation links. The 24 PE scenarios are **planned production tests**, not 24 executed services. The other 91 checks cover the existing prototype, reduced protocol fixtures and reference arithmetic/source consistency.

No production browser package, backend authentication, Brevo delivery/privacy configuration, database migration, tenant isolation, capacity, physical energy accuracy or full acceptance suite is certified by these results. Actual implementation must produce the evidence required in P0-P11.

## Inputs still needed before affected release paths

Owner decisions: IP-history duration; enrolled-membership versus company-workforce interpretation of the free 50-person limit; and whether multiple hosted organizations may share a work-email domain. These questions were requested and remain unanswered in this handoff. Development fixture values are explicitly provisional.

Launch configuration: real source/store links and signing/review status, copyright/rights holder, support/security/privacy contacts, operator identities and authentication-policy approval, hosting/DNS/TLS/secrets, Brevo sender/privacy/delivery evidence, published plan values and any separately chosen billing integration. No production server was selected, no purchase/publication/deployment was performed and no new empirical accuracy claim was made.
