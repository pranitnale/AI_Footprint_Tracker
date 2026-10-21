# Legal texts

Written on 11 October 2026 at the owner's request and published on the website on 13 October 2026: Terms of use, Privacy policy, Data processing agreement (Article 28 GDPR) and Imprint. The owner treats them as verified without a lawyer review (owner decision, 12 October 2026); they are not legal advice. The canvas boards WebTerms, WebPrivacyPolicy, WebDPA and WebImprint are generated from these files (scratchpad script `legal-boards.cjs`), so edit the Markdown and regenerate. The website pages in apps/web/src/site/pages carry the same text.

## What the texts describe

The service as decided on 11 October 2026 (OWNER-DECISIONS.md): hosted usage kept until an administrator deletes it, with a shorter period the administrators can choose; a contact form; the developer panel at developer.aifootprinttracker.com. Re-checked against the code on 14 October 2026, all three exist: hosted organizations start with no retention limit (`retention_months: None` in apps/server/aift/service.py) and administrators choose a shorter period under Policies (`usage_retention` in apps/server/aift/policies.py); the Contact page posts to `/v1/public/contact` (apps/web/src/site/pages/WebContact.tsx); the developer panel's default origin is developer.aifootprinttracker.com (`operator_origin` in apps/server/aift/config.py).

## Facts the texts rely on (from the code, 11 October 2026)

- No chat text reaches the server; the observation schema allows only set values, numbers and hex keys (packages/contracts/schema/observation-3.0.0.schema.json, apps/server/aift/service.py).
- Emails are Fernet-encrypted; connection IP addresses are not collected by default (owner decision of 17 and 18 October 2026; with the operator setting `ip_collection_enabled` on they are Fernet-encrypted and kept for `ip_retention_days`); sign-in codes are kept 5 minutes as an HMAC; an administrator's website session lasts 7 days from sign-in with no shorter idle limit (`ADMIN_SESSION_SECONDS`, owner decision of 14 October 2026; sessions made before then keep their 24 hours), the developer panel's session also 7 days from sign-in (`OPERATOR_SESSION_SECONDS`, ended at once when the address is removed from the approved list; developer changes to an organization's status, plan or exceptions, domain approvals and contact deletions need a fresh email code), and members no longer get website sessions since 13 October 2026; role changes, suspension, policy changes, exports, plan change acknowledgements, showing connection addresses (15 minutes per code, only with that setting and person analytics on), erasure, browser removal and organization deletion need a fresh email code; a browser's refresh token lasts ten years and is replaced at every refresh, and a replaced or revoked one is kept 30 days so a replay is still recognised (`REFRESH_SECONDS` and `REPLACED_REFRESH_SECONDS` in apps/server/aift/service.py, since 13 and 14 October 2026); exports last 24 hours.
- Cookies are only `__Host-aift`, `__Host-aift-operator`, `__Host-aift-registration` and `__Host-aift-bootstrap` (HttpOnly, Secure, SameSite=Lax). Since 13 October 2026 only self-hosted registration sets `__Host-aift-bootstrap`; the Privacy policy still lists it.
- No analytics, error tracking, CDN or external fonts in apps/web; nginx and uvicorn access logs are off.
- Brevo sends sign-in codes with tracking off; its transaction log is set to 1 month (docs/implementation/BREVO-PRIVACY-SETUP.md).
- Members join without admin approval when their email is on the organization's domain, up to the capacity.
- Single address (owner decision, 13 October 2026): the hosted service has one address, aifootprinttracker.com, with no organization subdomains. Members connect only in the extension with their work email and a 6-digit code, and the server assigns the organization registered with that email's domain. Only administrators sign in on the website. Registration no longer asks for an organization address. The Privacy policy, Terms and DPA were updated the same day without changing their version date.
- Own read (owner decisions, 13 and 14 October 2026): when a supported site shows a chat without loading it, loads only part of it, or the extension missed the page's own load, the extension reads that chat once from the same site, inside the page with the user's sign-in (apps/extension/lib/own-read*.ts and lib/*-own-read.ts; docs/implementation/TRACKING-HANDOVER-2026-10-05.md section 4). The ChatGPT access token and account id, the Perplexity account id and the Gemini and NotebookLM request token go only to their own site for that request and are not stored. The Privacy policy describes this from its version of 14 October 2026; personal mode therefore contacts the AI site in use, never us or anyone else. The canvas board WebPrivacyPolicy was not regenerated for this change.
- Provider, contact and copyright holder: docs/decisions/2026-09-10-release-decisions.md.

## Open fields (amber on the canvas)

1. Hosting provider, its address and the country of the servers (hosting is not yet authorized).
2. Retention periods still undecided: contact form messages, completed registration data after an organization ends, audit logs (organization and developer), rate-limit records, backups.
3. Notice periods: ending the hosted service, changes to the terms, new sub-processors, audits; breach notification hours; deletion period after an organization ends.
4. Place of jurisdiction; competent supervisory authority (the data protection authority of the federal state where the provider lives; naming the state does not publish an address).

## Owner decision with legal risk: no address

Decided on 11 October 2026: the provider is Pranit Jagannath Nale as an individual developer, with no VAT identification number. The texts publish no phone number and no postal address, at the owner's explicit choice after being told the address is required.

- No phone number is fine: an email address plus the contact form are the two fast contact routes (CJEU C-298/07).
- No address is not compliant. Section 5(1) DDG and Section 18(1) MStV require an address where legal documents can be served, and a P.O. box is not enough. A missing imprint detail is an administrative offence with a fine of up to 50,000 euros (Section 33(2) No. 1 and (6) No. 3 DDG), and it can draw warning letters. Organizations may also refuse to sign a data processing agreement whose processor gives no address.
- The way to close this without publishing a home address is a business address service (virtual office) that accepts and forwards legal mail. Check with the service and a lawyer that documents can be served there, then add the address to the Imprint, the Privacy policy, the Terms and the Data processing agreement.

## Gaps in the code that the texts assume are closed

Re-audited against the code on 14 October 2026.

Still open:

- No retention period for audit logs; no disk or database encryption; backups are a manual procedure only (docs/operations/SELF-HOSTING.md, Backup).

Closed:

- Retention: hosted usage is kept until an administrator deletes it, and administrators can choose a shorter period under Policies, never longer than the plan allows (`usage_retention` in apps/server/aift/policies.py; `PUT /v1/admin/policy` in apps/server/aift/service.py).
- Organization deletion (14 October 2026): administrators delete their organization on the website (Plan page). It stops at once, can be cancelled for 7 days, and the worker then deletes all its data, including the completed registration's contact data (apps/server/aift/organization_deletion.py). Organizations that ask by email instead still need the developer to act.
- HSTS (14 October 2026): the repository's nginx template sends HSTS for one year including subdomains (deploy/proxy/default.conf.template, guarded by tools/proxy-config.test.cjs); production already sent it from outside the repository.
- Developer panel origin: developer.aifootprinttracker.com (`operator_origin` in apps/server/aift/config.py).
- Contact form: the Contact page (apps/web/src/site/pages/WebContact.tsx) posts to `/v1/public/contact`; the server stores the sender's details encrypted until the sender asks for deletion or the developer deletes them, drops messages that fill a hidden field, limits each network to 5 messages an hour and the service to 200 a day, and lists them in the developer panel under `/v1/operator/contacts` (`contact` in apps/server/aift/service.py).
- Terms checkbox: registration requires a checkbox accepting the Terms of use and the Data processing agreement for the organization and sends `terms_version` (apps/web/src/auth-pages.tsx; `terms_version` in apps/server/aift/dto.py).
- Fonts: Bricolage Grotesque and Instrument Sans are bundled from the @fontsource-variable packages (packages/ui/src/living-gauge.css), not loaded from Google Fonts (LG München I, 20 January 2022, 3 O 17493/20).

## Points for the lawyer

- Whether the liability limit for free services (Sections 521 and 599 BGB by analogy) holds in these standard terms (Section 309 No. 7 BGB keeps liability for injury to life, body or health and for gross negligence; Section 14 ProdHaftG; Directive (EU) 2024/2853 on product liability, transposition due 9 December 2026).
- The role split: provider as processor for members' data, as controller for registration, contact form, security and developer panel data.
- Employee data: Section 26 BDSG after CJEU C-34/21 (30 March 2023); co-determination under Section 87(1) No. 6 BetrVG (BAG 1 ABR 16/23, 16 July 2024).
- Whether consumer contract rules (Sections 312(1a) and 327 BGB) apply to the free extension, given that it sends no personal data in personal mode.
- Imprint duty under Section 5 DDG for a free service; Section 18 MStV; the owner's decision to publish no address (see above).

## Sources

- GDPR (Articles 13, 28, 44 to 49, 77): https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679
- Section 5 DDG: https://www.gesetze-im-internet.de/ddg/__5.html; fines, Section 33 DDG: https://www.gesetze-im-internet.de/ddg/__33.html
- Imprint address must allow service of documents, a P.O. box is not enough (IHK Ostwestfalen fact sheet): https://www.ostwestfalen.ihk.de/fileadmin/Dokumente/Recht/Merkblaetter-Recht/Impressum.pdf; office services and virtual offices as alternatives (secondary source): https://selbststaendigkeit.de/buchhaltung-fuer-gruender/impressum-kleinunternehmer/
- Second fast contact route besides email, a contact form suffices (CJEU C-298/07, 16 October 2008): https://curia.europa.eu/juris/liste.jsf?num=C-298/07
- Section 25 TDDDG: https://www.gesetze-im-internet.de/ttdsg/__25.html and DSK guidance on digital services (v1.2, November 2024): https://datenschutzkonferenz-online.de/media/oh/OH_Digitale_Dienste.pdf
- Sections 521, 599, 307, 309 BGB: https://www.gesetze-im-internet.de/bgb/
- Section 14 ProdHaftG: https://www.gesetze-im-internet.de/prodhaftg/__14.html; Directive (EU) 2024/2853: https://eur-lex.europa.eu/eli/dir/2024/2853/oj/eng
- CJEU C-34/21: https://curia.europa.eu/juris/liste.jsf?language=de&num=C-34/21; Section 87 BetrVG: https://www.gesetze-im-internet.de/betrvg/__87.html
- LG München I, 3 O 17493/20: https://www.gesetze-bayern.de/Content/Document/Y-300-Z-BECKRS-B-2022-N-612
- Chrome Web Store privacy and Limited Use: https://developer.chrome.com/docs/webstore/program-policies/privacy and https://developer.chrome.com/docs/webstore/program-policies/limited-use
- Mozilla add-on policies: https://extensionworkshop.com/documentation/publish/add-on-policies/
- Brevo terms and privacy policy (Brevo GmbH, Berlin, for customers in Germany; DPA in Appendix 3): https://www.brevo.com/legal/termsofuse/ and https://www.brevo.com/legal/privacypolicy/
- German supervisory authorities: https://www.datenschutzkonferenz-online.de/datenschutzaufsichtsbehoerden.html
