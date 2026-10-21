# Brevo OTP delivery: privacy-first setup

Decision confirmed by the project owner: **8 September 2026**. Project: **AI Footprint Tracker**, `aifootprinttracker.com`.

Status: approved provider and implementation requirements; **not a completed deployment or legal certification**. This guide uses Brevo documentation and read-only account observations from 7 September 2026. Recheck controls and API behavior during setup and before release. Do not assume a successful save, email delivery or deletion without evidence.

## 1. Decision and boundaries

**Later confirmed product-login decision:** organization users and admins both use email OTP only, without an additional password/authenticator factor. Current tenant role selects the admin dashboard or company onboarding. See [brand, roles and design handoff](BRAND-ROLES-AND-DESIGN-HANDOFF.md). Recommendations below for MFA on the operator's Brevo vendor account do not impose MFA on AI Footprint Tracker users.

- Use Brevo for organization authentication OTP email delivery. Start with the Free plan if its account approval and quotas meet actual demand. No paid upgrade is authorized by this document.
- Personal installations remain local-only: no email account, OTP, Brevo calls or personal-usage upload.
- The organization authentication service handles work email addresses; numerical AI usage records remain associated with internal user/company IDs. An address linked to an ID is still identifiable data, not anonymous data.
- Send Brevo only the recipient address and minimal authentication message required for delivery. Do not send employee names, organization usage, IP analytics, prompts, answers, document data or AI conversation identifiers in messages, tags or metadata.
- Do not create marketing contacts/lists as part of OTP delivery. Do not subscribe employees to marketing or reuse their addresses for another purpose.
- Brevo selection applies to the project's managed service. Self-hosters configure their own Brevo account and secret; never distribute the project's shared key in the MIT repository or force self-hosted mail through the project's account. Additional mail-provider adapters are outside this decision.
- Brevo retention covers its email records, not AI usage history. Hosted free-tier usage is kept until an administrator deletes it (owner decision of 11 October 2026, replacing the earlier six months), or for the shorter period the organization chooses; do not tie it to Brevo's one-month log retention. Since 18 October 2026 the service collects no connection IP addresses, so there is no IP analytics that could reach Brevo.

## 2. What was actually observed

These are values displayed on the account pages on 7 September 2026, not proof of every backend policy or future account state. The assistant did not change settings, click Save, send mail, generate credentials or test persistence after a user edit.

| Control | Displayed value | Target / action |
| --- | --- | --- |
| Daily email allowance | 300 available out of 300 | Verify active plan and transactional approval; budget across all organizations |
| Retention scope | All senders | Keep |
| Transactional-log retention | 1 month | Keep and verify after reopening |
| Email previews | Never store previews selected | Keep and verify after reopening |
| Per-contact tracking consent | No; page says all contacts are tracked when disabled | Administrator must change to Yes and verify unknown-recipient behavior |
| Anonymous transactional tracking | No | Not the control that disables tracking; see Section 5 |
| Brevo support account access | Enabled | Administrator should disable except for a deliberate support session |

The controls were accessible without an upgrade prompt in the inspected account. This does not prove every option can be saved on every future Free account. Record any upgrade restriction explicitly; do not silently upgrade or weaken privacy.

## 3. Before configuring the account

1. Use a project-controlled administrator mailbox and a unique password. Enable the strongest available MFA suitable for the account, preferably an authenticator if offered; store recovery material securely outside this repository and chat. Do not share the administrator login among implementers.
2. Check Usage and plan and transactional sending status. Record the plan, daily limits, renewal/reset behavior and approval state. A visible allowance does not prove production sending is enabled.
3. Keep the account dedicated to authentication mail. Avoid optional marketing, CRM, contact enrichment, AI generation and website-tracking integrations for this workflow.
4. Identify who operates the account and owns privacy/security review. For hosted organizations, document the applicable controller/processor/subprocessor chain and obtain the necessary contractual authorization for Brevo.
5. Retain the applicable terms, DPA, subprocessor list and the review date in an access-controlled compliance record. Do not claim that EU database hosting means exclusively EU processing or access.
6. Before production, obtain a documented answer where needed about backup expiry, security/abuse records, suppression records, international access/transfers and deletion exceptions. These are not resolved by choosing a one-month UI setting.

## 4. Transactional logs and previews

Open **Settings > Automations > Transactional emails > Retention rules**, or the [observed retention page](https://app.brevo.com/transactional/email/settings/retention-rules).

1. Choose **All senders**. This avoids leaving another OTP sender with a different rule.
2. Set **The logs will be deleted after: 1 month**. The account already displayed this value during inspection.
3. Select **Never store previews**. Do not choose to keep previews for the log-retention period.
4. Click **Save** if changes are needed. Read the result; if it fails, report the failure instead of proceeding as configured.
5. Leave the page, reopen it, and verify all three values. Record the verification date, operator and non-sensitive evidence.
6. If older previews exist, this setting does not retroactively erase them. An authorized administrator must separately review and delete those previews/logs under the applicable retention policy. Do not delete unrelated records automatically.

Brevo documents a minimum automatic log-retention period of one month, automatic deletion processing up to 24 hours after expiry, and manual log deletion processing up to 72 hours. These are not promises about immediate deletion of every backup or legally retained record. See [retention rules](https://help.brevo.com/hc/en-us/articles/4415743225746-Configure-a-custom-retention-period-for-your-transactional-logs-and-email-previews) and [managing logs and previews](https://help.brevo.com/hc/en-us/articles/360021533839-Manage-your-transactional-logs-and-email-previews).

Never put the OTP in the subject, tags, custom headers, URL query strings or provider metadata. Disabling previews does not remove subjects or recipient addresses from delivery logs. Use a subject such as **Your AI Footprint Tracker verification code**, without the code or company-specific information.

## 5. Disable OTP open/click tracking

### 5.1 Account configuration by the administrator

Open **Settings > CRM > Contacts > Per-contact pixel tracking consent**, or the [observed consent page](https://app.brevo.com/contact/settings/pixel-tracking-consent).

1. Change **Per-contact tracking consent** to **Yes**. This enables consent enforcement; it does not itself guarantee that every recipient is untracked.
2. If a control for unknown contacts appears, choose **No** for tracking unknown contacts. Re-read the wording carefully: the target is no tracking when consent is absent or unknown.
3. Save, leave and reopen the page. Verify persistence. If the unknown-contact setting is absent, document that gap and use the integration test below to establish behavior; do not invent an equivalent switch.
4. Do not grant tracking consent to OTP recipients. Do not import recipients as CRM contacts merely to configure their consent.

The separate [Transactional emails > Tracking page](https://app.brevo.com/transactional/email/settings/tracking) asks **Anonymous email tracking?** It explicitly says opens and clicks are still tracked when anonymized. **Neither Yes nor No on that page means all tracking is off.** Leave it unchanged while implementing the consent-based no-tracking path. Anonymization is not an acceptable substitute for the release gate below.

### 5.2 Backend enforcement and verification

- Prefer Brevo's transactional HTTP API for this integration so tracking behavior can be explicit per recipient. Selection of Brevo does not require using the SMTP transport.
- Brevo's published guidance documents `contactPixelTrackingConsent: false` on transactional API recipient objects. The implementer must verify the exact request schema and behavior against the pinned API/SDK at integration time; do not silently omit an unsupported field or assume a successful HTTP response means it was honored.
- Enforce no tracking on every authentication-message path, including resend, enrollment and recovery. A recipient's existing marketing-consent status must not cause an OTP to become tracked.
- Do not substitute SMTP unless equivalent per-message no-tracking behavior is documented and passes the same tests.
- Send a controlled test to an approved test mailbox, inspect the delivered raw MIME/HTML, and verify no Brevo open pixel and no Brevo-rewritten tracking links. Include an ordinary test link so the test actually exercises click rewriting. Inspect ordinary production OTP content as well.
- Test unknown recipients and, in an isolated test setup, an existing contact with tracking consent. The per-message false setting must prevent tracking in both cases. Never alter a real employee's consent to create a test fixture.
- If the field is unsupported, settings cannot be saved, or tracking remains present, block production OTP release and raise a visible configuration error. Seek a documented Brevo solution; do not quietly settle for anonymous tracking.

Reference: [Brevo tracking-pixel and consent guidance](https://help.brevo.com/hc/en-us/articles/37113920427922-About-email-tracking-pixels-and-the-CNIL-recommendation-in-Brevo).

## 6. Restrict account access and authenticate the sender

### 6.1 Support and account access

Under [Settings > General](https://app.brevo.com/settings/advanced), uncheck **Do you authorize Brevo to access your account to provide support?**, then Save and reopen to verify. This removes the optional support authorization; it does not eliminate Brevo's necessary service, security or contractual processing. Re-enable only for a specific support need, then disable again.

Review account users and remove unnecessary access through the administrator's normal approved process. Do not disable security alerts or delivery-abuse protections in pursuit of privacy. Do not activate optional Aura AI features or third-party integrations for OTP work.

### 6.2 Sending domain

1. Under **Settings > Senders, domains, IPs**, add the project-controlled sending domain. The operator can use a dedicated sending subdomain, for example `auth.aifootprinttracker.com`, if supported by the selected sender configuration.
2. Copy the exact DNS records supplied by Brevo into the domain's DNS service. Do not guess DKIM selectors, verification values, SPF includes or bounce-domain settings. Do not overwrite unrelated mail records or create duplicate SPF records.
3. Verify authentication in Brevo and with a controlled delivered message's authentication headers. Configure DMARC deliberately, checking all legitimate senders before tightening enforcement. Do not paste OTPs or authentication secrets into this document as evidence.
4. Choose a minimal project-owned sender address and display name. A proposed address is not an existing mailbox; confirm reply handling and ownership before using it.
5. This authenticates **our sending domain**. It does not impose DNS verification on customer organizations, which the project owner rejected. Verifying an administrator's work mailbox does not prove corporate authority or automatically justify granting domain-wide administration.

## 7. Backend requirements

These are implementation requirements, not Brevo dashboard switches or existing application behavior.

### 7.1 Credentials and data separation

- Create a dedicated server credential through an authorized administrator. Use the narrowest access Brevo actually supports; do not claim scope restrictions that the account does not offer. If the key is broad, isolate it and restrict backend access accordingly.
- Store the secret in the deployment's protected secret facility. Never embed it in extension bundles, web frontend code, Git, CI output, screenshots, URLs or logs. Public configuration examples contain placeholders only.
- The extension/web client calls the authentication backend over TLS. Only that backend sends to Brevo. Never collect an organization's mail-provider secret through an ordinary employee install flow.
- Keep auth email mappings separate from usage-event payloads. Apply server-side tenant authorization to every identity lookup; knowing an email or matching its domain is not authentication.
- Verify the mailbox before membership creation or login. Normalize domains deliberately, match approved domains exactly, and define subdomain policy. Do not silently apply Gmail-style dot/plus normalization to work addresses.
- Email possession does not automatically grant organization-admin privileges. Owner/admin provisioning remains a separately authorized action; ordinary employee OTP verification cannot promote roles.

### 7.2 OTP handling

Proposed security defaults for implementation and testing: a cryptographically random six-digit code, five-minute expiry, at most five incorrect attempts per challenge and a 60-second resend cooldown. Enforce additional recipient, session, network, tenant and global abuse limits; final numerical budgets must be documented before launch. The project owner selected email OTP-only organization-admin login despite the risk that mailbox compromise permits dashboard access. Do not add a mandatory password, authenticator or second factor; preserve session, authorization and abuse controls.

- Bind each challenge to recipient, tenant, purpose and a random challenge ID. Never redeem a code issued for another organization or action.
- Store a server-keyed MAC of the code and challenge context, not plaintext or an unkeyed hash of a six-digit value. Protect the MAC key independently. Compare safely and atomically consume a valid code once.
- A resend invalidates older codes. Reuse the existing challenge for a retry of the same dispatch operation; do not generate conflicting valid codes following an ambiguous send response.
- The outbound worker needs the code transiently. Do not store the email body/code in a durable plaintext queue. If reliable queuing requires an encrypted payload, use a short TTL no longer than challenge expiry, tightly restrict decryption, purge after terminal processing, and exclude plaintext from logs, traces and backups. Purge expired/consumed challenge secrets; retain only justified minimal security metadata under a separately documented policy.
- Redact recipient addresses where possible in operational logs; never log codes, authorization headers, provider keys, full bodies or full authentication URLs. Error-monitoring vendors must not receive those payloads.
- Use generic responses to limit account enumeration, while clearly distinguishing service unavailability from a successful send. A Brevo API acceptance means accepted for delivery, not delivered to the inbox.
- Bound retries for throttling/transient failures with backoff and jitter. Treat timeouts as unknown outcomes, not definite non-delivery. Use provider-supported idempotency where verified plus application dispatch deduplication; never invent an idempotency guarantee.
- Ensure late delivery cannot redeem expired/invalidated codes. Do not issue a login session when sending fails or when mailbox verification is incomplete.

### 7.3 Quotas and delivery failures

The observed allowance was 300 emails/day for the account, not per customer organization. Registration, login, resends and recovery all consume capacity. Fifty employees can exceed this with repeated authentication. Reverify Free-plan limits before launch.

- Maintain global and tenant abuse budgets so one organization cannot exhaust the account unchecked.
- Alert the operator before exhaustion, and show users a retryable authentication-service-unavailable message when sending is blocked. Do not claim that a code was sent when Brevo rejected it.
- Do not automatically upgrade, switch provider or send through a personal mailbox. Such changes require an explicit operator decision.
- Use only needed delivery-status events if webhooks are implemented. Verify their authenticity using a documented provider mechanism and reject untrusted events; do not invent signature headers. Do not subscribe to opens/clicks for OTP analytics.
- Keep bounce/complaint safeguards. Do not clear suppression lists merely to improve delivery or claim zero retention; discuss justified retention with the privacy owner.

## 8. Required release checks

All checks are **planned and not yet executed**. They supplement the current acceptance matrix; a historical count of planned tests is not an executed-test result.

| ID | Check | Passing evidence |
| --- | --- | --- |
| BV01 | Plan and approval | Operator records actual quota and transactional approval; no assumed production access |
| BV02 | Retention persistence | Reopened page shows all senders, 1 month and Never store previews |
| BV03 | Tracking settings | Saved per-contact consent enforcement verified; unknown-recipient behavior established |
| BV04 | Delivered privacy | Raw received test email contains no tracking pixel or rewritten tracking links, including unknown and consented-contact cases |
| BV05 | Preview/log minimization | Controlled sent message has no stored preview; subject/tags contain no OTP or extra identifying data |
| BV06 | Sender authentication | Test headers show expected authenticated sender and DMARC alignment; no unrelated DNS records damaged |
| BV07 | Account access | Optional support access disabled; operator verifies MFA and necessary account users |
| BV08 | Secret scan | No provider key/code/body in frontend, extension, repository, logs, errors or test artifacts |
| BV09 | Challenge isolation | Wrong tenant/recipient/purpose, expiry, replay and parallel redemption all rejected appropriately |
| BV10 | Abuse and quota | Attempts, resends, per-tenant/global exhaustion and provider rejection produce correct visible outcomes |
| BV11 | Ambiguous delivery | Lost response, retry and late delivery do not create multiple redeemable challenges or bypass expiry |
| BV12 | Personal isolation | Personal-only installation causes no authentication/Brevo traffic and no personal-usage upload |
| BV13 | Data separation | Usage ingestion rejects email/body fields; Brevo messages contain no AI usage or chat content |
| BV14 | Retention lifecycle | Transient queue/challenge data expire as designed; observed provider deletion is checked when the first record ages out, with anomalies escalated |
| BV15 | Governance | Responsible reviewer records DPA/transfer/retention decisions and unresolved exceptions before production |

For each check record date, environment, operator, result and sanitized evidence. Mark failure or unverified explicitly. Never attach real codes, credentials, employee addresses or message bodies to public issue trackers. BV14's month-end provider observation cannot be pre-certified by a same-day test; record it as pending with an assigned owner and due date, and require an explicit risk decision if launching before that observation. All other applicable gates must pass before production.

## 9. Completion and known limitations

Setup is complete only after the administrator has applied and rechecked settings, the integration has passed its release gates, and governance exceptions are accepted by the responsible owner. The documentation itself does not perform those actions.

No previews is not zero processing: Brevo must handle the message for delivery. Log deletion does not erase the recipient's mailbox. The one-month setting is not a verified expiry for all backups, legal/security records or suppression lists. Do not advertise instant erasure, exclusively EU processing or automatic GDPR compliance on this basis.

Review sources and settings when Brevo changes its controls/API, when upgrading the plan, and before changing sender domains, consent behavior or authentication flows. Re-run BV02-B06 after relevant changes.

## 10. Source and handoff index

- [Brevo terms and DPA](https://www.brevo.com/legal/termsofuse/) — contractual roles, subprocessors and deletion obligations; version inspected 1 October 2025, read on 7 September 2026.
- [Retention rules](https://help.brevo.com/hc/en-us/articles/4415743225746-Configure-a-custom-retention-period-for-your-transactional-logs-and-email-previews) — scope, periods and future-preview behavior.
- [Manage transactional logs/previews](https://help.brevo.com/hc/en-us/articles/360021533839-Manage-your-transactional-logs-and-email-previews) — manual handling and deletion delays.
- [Tracking and consent](https://help.brevo.com/hc/en-us/articles/37113920427922-About-email-tracking-pixels-and-the-CNIL-recommendation-in-Brevo) — per-contact control and transactional recipient flag; validate exact API schema before coding.
- [Anonymous tracking](https://help.brevo.com/hc/en-us/articles/11643306229906-Can-I-anonymize-the-tracking-of-opens-and-clicks-for-my-emails) — anonymization still tracks events.
- [Pricing-plan documentation](https://help.brevo.com/hc/en-us/articles/208589409-About-Brevo-s-pricing-plans) — verify current Free limits and features.
- [Data storage location](https://help.brevo.com/hc/en-us/articles/360001005510-Data-storage-location) — hosting information, not a blanket no-international-access guarantee.

The 9 September [product/enrollment specification](PRODUCT-AND-ENROLLMENT-SPEC.md), revised Contracts and identity/PE acceptance cases replace invitation-only enrollment with verified email and installation-bound connection. This guide remains the mail-provider privacy/delivery contract. Documentation reconciliation does not mean account configuration, authentication or delivery has been implemented or verified.
