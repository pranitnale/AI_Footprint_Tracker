# Data processing agreement

This agreement under Article 28 of the General Data Protection Regulation (GDPR) applies to every organization that uses the hosted service of AI Footprint Tracker. Version of 18 October 2026.

## 1. Parties and conclusion

- **Controller:** the organization registered on the hosted service ("the organization").
- **Processor:** Pranit Jagannath Nale, email [pranitnale42@gmail.com](mailto:pranitnale42@gmail.com) ("we").

The agreement is concluded in electronic form (Article 28(9) GDPR) when an administrator registers the organization and accepts it. It applies for as long as the organization uses the hosted service, and afterwards until all data is deleted under section 11.

## 2. Subject, nature and purpose

We provide the hosted service described in the [Terms of use](TERMS.md). We receive the numbers that members' browsers send after they connect, store them, calculate totals, show them on the admin site and in members' extensions, create exports, send sign-in codes and carry out deletions. We process the data only for this purpose.

## 3. Types of personal data

- Work email addresses, roles and membership status of members and administrators
- Browser installation ids, browser family and reporting times
- Usage records per request: site, model, token counts, times, features, image and document counts, estimates, and keyed hashes of conversations and requests
- Records from earlier messages with their source dates
- IP addresses seen when records arrived before 18 October 2026, with keyed comparison tokens. None are recorded since then; the stored ones are not shown to anyone and are kept only until a one-off deletion of all of them
- Sign-in codes and session data
- The organization's audit log of administrator actions

No chat text, file contents, file names or chat titles are accepted by the service.

## 4. Data subjects

Members and administrators of the organization.

## 5. Instructions

These terms, this agreement and the settings and actions on the admin site (policies, retention period, role changes, deletions and exports) are the organization's documented instructions. Administrators can give further instructions by email. We tell the organization without delay if we believe an instruction breaks data protection law.

## 6. Confidentiality

Everyone who can access the data on our side is bound to confidentiality.

## 7. Security

We take the technical and organizational measures in Annex 1 (Article 32 GDPR). We may improve them, provided the level of protection does not drop.

## 8. Sub-processors

The organization gives its general authorization to the sub-processors in Annex 2. We tell administrators at least 30 days before we add or replace one. The organization may object for good reason. If we cannot resolve the objection, either side may end the use of the hosted service. We impose the same data protection obligations on every sub-processor.

## 9. Help with data subject rights

The admin site lets administrators delete a member's records. It shows administrators figures for the whole organization only, never one member's usage; members see their own figures in the extension. We help the organization with requests to access or receive a member's data. If a data subject contacts us directly, we pass the request on to the organization without delay.

## 10. Help with security, breaches and assessments

We help the organization meet its obligations under Articles 32 to 36 GDPR. We tell the organization without undue delay, and within 48 hours at the latest, after we become aware of a personal data breach that affects its data, with the information it needs to report it.

## 11. Deletion at the end

When the organization ends its use, we delete all its personal data within 30 days, unless the law requires us to keep it. Before that, administrators can export the data. Copies in backups expire within 14 days. A deletion journal makes sure that a restored backup does not bring deleted data back.

## 12. Information and audits

We give the organization the information it needs to show that this agreement is kept. The organization may carry out audits, or have them done by an auditor bound to confidentiality, with 30 days' notice, at most once a year unless there is a specific reason, and at its own cost. Current documentation can replace an on-site audit.

## 13. Transfers outside the EU

We process the data in the EU. Transfers to countries outside the EU happen only under Articles 44 to 49 GDPR. At present this concerns only the sub-processors of Brevo listed in Annex 2.

## 14. Liability and precedence

Liability follows Article 82 GDPR and the Terms of use. For data protection, this agreement takes precedence over the Terms of use.

## Annex 1: Technical and organizational measures

| Area | Measures |
| --- | --- |
| Encryption in transit | The service accepts HTTPS only and refuses plain HTTP. Strict security headers: no sniffing, no referrer, a content security policy limited to the service's own address, no caching. The service sends HTTP Strict Transport Security (HSTS) for one year, including subdomains. |
| Encryption of stored data | Work email addresses, registration details and exports are encrypted in the application before storage. IP addresses recorded before 18 October 2026 stay encrypted, with a separate key, until they are deleted. The database disk itself is not encrypted. |
| Pseudonymisation | Members and browsers have random ids. Conversation and request keys are keyed hashes computed in the browser under a key for each member. |
| Secrets | Session and access tokens are stored only as SHA-256 hashes. Sign-in codes are stored as keyed hashes, compared in constant time, expire after 5 minutes and allow at most 5 attempts. |
| Access control | Roles for members and administrators; the last administrator cannot be removed. A role change or suspension ends that member's sessions. Changing a role, suspending or reactivating a member, changing policies, creating exports, acknowledging a plan change, deleting records, removing browsers and deleting the organization need a fresh email code. Only the administrator who created an export can download it. Administrator sessions end at sign-out and after at most 7 days. Our own administration runs on a separate address that only approved email addresses can sign in to. Its sessions end at sign-out, when the email address is removed from the approved list, and after at most 7 days. Changing an organization's service state, plan or exceptions, approving a further organization on a domain and deleting a contact request need a fresh email code. |
| Logging | Audit logs of administrator actions and of our own. A request log without IP addresses, kept 14 days, to find and fix errors. |
| Data minimisation | The service accepts only numbers, set values and hashes; chat text is rejected by the data schema. Sharing organization totals with members is off until an administrator turns it on. Once it is on, members see the totals however few people use AI, so in a small team the totals can reveal one person's usage. Administrators see figures for the whole organization only, never usage next to a member's name, email or browser; the server enforces this, not only the admin site. These figures are also shown for any number of people, so in a very small organization (for example one or two people) they can reveal one person's usage. Connection IP addresses are not collected. |
| Availability and resilience | Rate limits for registration, sign-in emails, connections and uploads. Where a limit applies per connection, the service keeps only a keyed hash of the IP address with the times of recent requests, deleted one day after the last request. Backups: every night, encrypted, on the same server, kept for 14 days. A deletion journal stops restores from reviving deleted data. |
| Separation | Every organization record is stored with the organization's id, and the service looks records up only for the organization that the signed-in account or connected browser belongs to. Sign-in sessions and browser connections belong to one organization. |
| Organization | Only the provider operates the service. Server access is limited to one administrator account with key-based SSH, and keys are kept apart from the source code. A suspected incident is contained first by closing the public entrance, recorded with exact times and reported as described in section 10. The provider reviews these measures at least once a year. |

## Annex 2: Sub-processors

| Sub-processor | Service | Data | Location |
| --- | --- | --- | --- |
| Brevo GmbH, Köpenicker Str. 126, 10179 Berlin, Germany (part of Sendinblue SAS, Paris) | Sends sign-in codes by email | The recipient's email address and the code. Tracking is off; delivery logs are kept 1 month. | EU. Some Brevo sub-processors are outside the EU (for example Cloudflare, USA) under the EU-US Data Privacy Framework or standard contractual clauses. |
| Contabo GmbH, Welfenstraße 22, 81541 Munich, Germany | Servers, database and backups | All data listed in section 3 | European Union |
