# Browser verification log

10 September 2026. Active review; not a production release certificate.

## Environment and scope

The conductor uses the Codex in-app browser. DOM and Network CDP commands were verified in this session. `Schema.getDomains` is not supported through this raw-CDP surface; no extension-management capability is inferred from that result.

`tests/browser_harness.py` serves the production website build on `http://localhost:4180` with a fresh synthetic organization and fake mailbox. It calls the real FastAPI implementation through an in-process HTTPS test client and stores synthetic records in an isolated SQLite file. Browser cookies are passed through, and the internal client does not retain cookies between requests. The adapter deliberately maps the loopback test origin to the synthetic API origin. These checks do not establish production TLS, PostgreSQL, email delivery, or native extension behavior.

The test tenant is Verification Company, with `admin@verification.example`. No real email is sent and no existing company data is used. Raw cookies, codes and session bodies are not saved in this report.

## Completed interactions

| Check | Observed result |
| --- | --- |
| Built homepage | Renders the Fern identity, source/privacy navigation, estimate qualifications and functioning download CTA. |
| Chrome, Edge and Firefox download links | All three links triggered actual browser download events. The page correctly labels the packages unsigned and does not claim store publication or installation. Artifacts will be rebuilt and hashes rechecked after remaining fixes. |
| Organization sign-in | Synthetic mailbox request reached the real API; an incorrect code showed an error without signing in. The correct synthetic code opened the admin overview. |
| Empty admin overview | Shows zero recorded requests separately from unknown resource estimates; no fabricated usage figures. |
| User listing | Displays the actual synthetic admin record from the API. |
| Last-admin action | A traced response returned HTTP 409 `last_admin`; the account retained admin access. Dialog/error presentation defects are listed below. |
| Policy save | Selecting disabled company pause control and saving produced a confirmed server-save state. The test environment was subsequently reseeded for a schema change. |
| Narrow homepage and privacy | At 390 by 844 CSS pixels, the document width was 375 pixels with a vertical scrollbar and no horizontal overflow. |

## Findings requiring correction and repeat checks

- Role confirmation left focus on the background button; Escape did not close it. Its custom dialog did not use the shared focus-managed component.
- The last-admin error appeared behind the modal with a page-loading failure heading. A previous failed action redirected to onboarding while the account still had admin access. Failure codes must not all be treated as privilege loss.
- Session restoration rotated CSRF while concurrent page reads wrote stale session JSON. The backend implementer confirmed and corrected the race with stable session CSRF and an independent activity column. The harness was restarted with a fresh schema. Independent repeat verification is pending.
- Small positive resource values formatted as `0 kWh` and `0 L`. The shared formatter needs appropriate smaller units and positive-value regressions.
- Mobile public navigation hid all links except sign-in without offering a menu.
- Privacy copy incorrectly implied downloaded export copies could be erased after a browser reconnects, and described six-month retention without qualifying the hosted free plan.

Remaining screens, controls, error states, accessibility, real extension installation and the twelve provider/browser combinations remain under review or unverified. A successful download is not an installation test.
# Follow-up verification, 10 September 2026

The conductor rebuilt the test environment with two synthetic verified members, four installations and eight requests ingested through the real login, connection and upload APIs. Six requests occur in September and two in August. The environment remains loopback HTTP, SQLite and FakeMail; it does not prove production TLS, PostgreSQL or mail delivery.

- Revised mobile public navigation exposes all five destinations at 390 px. Privacy copy correctly separates downloaded export copies from offline browser deletion, and free hosted retention from configured extensions.
- The role-change dialog now focuses its Close control, displays `last_admin` rejection inside the dialog, dismisses with Escape and restores focus to the triggering control. The tested session stayed authenticated.
- Current-month overview displays six requests, about 0.131 Wh and 0.0505 g CO2e. Total water is explicitly unknown for six attempts. Previous month displays the expected two requests and about 31.1 mWh. Member filtering displays the expected two current-month requests.
- CSV creation requires dates. A populated export produced an actual authenticated HTTP 200 `text/csv` download. CDP could not retrieve the downloaded response body, so contents are not certified by this browser check alone.
- Every admin navigation destination was exercised. User, individual usage, tool, request, network, health, policy, export and audit views rendered synthetic results or an explicit empty state.

Open findings sent to implementers: applying Last month changes the selected preset to Custom dates; initial list views omit pagination beyond 200 records; request details are missing; tool/model breakdown samples a partial request page; export confirmation omits its expiry; the newly added mobile administrative focus regression test failed. These findings remain open until independently rechecked against the corrected build.

## Synthetic provider evidence

In the authenticated in-app ChatGPT browser, one synthetic image generation and one transformation of that image were executed. The conductor confirmed the actual POST, SSE handoff and WebSocket update shapes, including the response-body capability. The minimized, sanitized fixture is `fixtures/browser-audit-2026-09-10/chatgpt-image-structure.json`.

The same image asset and generation ID appeared in different tool message IDs. The edit request references its original generation; its returned generation links to that parent. Both returned 1254 by 1254 provider-reported dimensions. Image model identity, requested image count and measured physical resource use are not established. Initial event-window truncation is recorded in the fixture. No raw authenticated capture is stored in the repository. This is protocol evidence in the in-app browser, not proof of installed Chrome, Edge or Firefox extension compatibility.
