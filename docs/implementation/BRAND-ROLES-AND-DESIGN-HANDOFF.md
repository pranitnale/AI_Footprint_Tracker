# Locked brand, organization roles and design handoff

Decision date: **8 September 2026**. Status: confirmed requirements and proposed design-review workflow, not implemented software or approved screen designs.

This document records the locked brand, organization roles and design-review requirements. The 9 September [product/enrollment specification](PRODUCT-AND-ENROLLMENT-SPEC.md) and revised Contracts reconcile hosted identity, connection and retention. Designs remain draft/reference material, not production approval or proof that those services exist.

## 1. Confirmed brand

For all UI copy and implementation comments, follow [writing and code standards](WRITING-AND-CODE-STANDARDS.md). The 9 September copy revision keeps the Fern palette and screen structure while replacing slogans and internal jargon with plain language. Authored interface copy uses no em dashes. Saved reviewer text is not rewritten.

- Product name: **AI Footprint Tracker**.
- Selected logo direction: **Resource Gauge**: two broad circular arcs with top/bottom openings and a central leaf-shaped pointer angled upward to the right.
- Selected palette: **option 2, Fern**. It is no longer an open palette decision.
- Saved [palette comparison reference](../design/references/resource-gauge-nature-palettes-2026-09-08.png); use option 2 only. Other options remain reference material, not alternate approved palettes.
- The image-generated comparison is a visual reference, not a production vector or authoritative color sampler. Construct and review a clean SVG and browser-store raster sizes before release; do not claim trademark clearance or tested small-size legibility yet.

| Token | Exact value | Intended role |
| --- | --- | --- |
| `brand.primary` | `#3D7542` | Fern logo and principal brand actions |
| `brand.ink` | `#203524` | Primary text and deep green surfaces |
| `brand.soft` | `#E1EEDB` | Gentle emphasis and selected surfaces |
| `brand.canvas` | `#F7F9F2` | Main branded light background |

These written values are authoritative. Soft and canvas colors are backgrounds, not default text colors. Define and test semantic success, warning, error, focus, disabled, border and chart tokens separately; the four-color brand palette does not by itself prove accessibility or provide every UI state. Define a dark theme using the same identity, not a second brand palette.

### Placement and host adaptation

- Public website, organization registration, administrator login, personal/organization extension dashboard and admin pages keep AI Footprint Tracker branding. No company logo/palette or white-label skin. The organization name identifies the tenant without replacing the product brand; since 13 October 2026 all hosted organizations share one address, so the address is not the organization's identity.
- Show the logo on the website, onboarding and browser toolbar/extension dashboard. Do not put a logo in the in-chat information bar.
- **Conversation Details:** open a user-triggered, nonmodal overlay above the information bar on the same AI page, not a new tab or route. Keep the conversation/composer visible and usable; no page-wide backdrop or focus trap. Show observable token components, estimated resources, separate water components, provenance and missing-data explanations. Inherit the host theme. Close with a labeled close control, Back to chat, Escape or outside click. Restore focus to Details after explicit close/Escape, but do not steal focus from an outside click on host controls. For constrained viewports, constrain and scroll the overlay; never alter host layout or block essential composer controls.
- The in-chat information bar adopts the current AI host's surface, text, borders, typography and light/dark treatment. Maintain isolated extension styling, contrast and status labels. Do not recolor the AI host or imply provider endorsement.
- Preview all four supported hosts in light and dark modes. Host-theme screenshots/tokens must be verified when making actual screen mockups; illustrative styling must not be labeled an exact current provider UI.

## 2. Exactly two organization roles

| Role | Permissions |
| --- | --- |
| `user` | Connects from the extension, own usage, permitted company aggregates and extension use; no website sign-in, organization administration pages or APIs |
| `admin` | Everything a user can do, plus the organization's admin dashboard, detailed reporting, policies, authorized data management and admin-role assignment/removal |

Multiple members of one organization may hold `admin`. They have the same organization-admin capabilities; there is no hidden owner-only or analyst tier. Retire the earlier `member`, `analyst_admin` and `owner_admin` role design.

The **platform-owner/developer panel** is a separate service-operator authority for hosted plans, overrides and organization operations. It is not a third organization membership role and is not granted by promoting a company user to admin. Its explicit-grant and isolated-session specification is in the product/enrollment contract; production operator identities and the proposed authentication policy still require deployment-owner approval. Organization OTP never silently grants platform access.

### Admin role management

1. Admin opens **Users** in the organization admin panel. Each row shows the member's verified work email, role and relevant status; filter by Admin/User. Detailed user data is not exposed in ordinary company-aggregate responses.
2. For an existing active, verified user in the same organization, show **Make admin**. For an admin, show **Remove admin access**. Removal means demotion to `user`, not deleting the account or its usage history.
3. Show a confirmation naming the target and explaining the access being granted or removed. This is an action confirmation, not a second authentication factor. Do not add an MFA or password prompt to this flow.
4. The server must independently check the acting user's current admin role, tenant scope, target membership, account status and CSRF/session protection. Never trust a role flag from the browser or infer admin status from an email-domain match.
5. Apply the change atomically with an audit entry recording actor/target internal IDs, tenant, old/new role, time and outcome. Avoid copying raw IP or email into audit records when internal IDs suffice.
6. **Last-admin safeguard:** reject demotion, membership deletion or suspension that would leave an active organization with zero active admins. Serialize competing changes at organization scope, so concurrent demotions cannot both pass. Organization deletion is a separate workflow, not an exception hidden inside role removal.
7. Self-demotion is permitted only when another active admin remains. Warn that admin access, including website sign-in, will end; the demoted user keeps ordinary member use through the extension.
8. Recheck permissions on every privileged request. After demotion, invalidate admin authorization in all sessions and stop further admin API, export-download and live-update access without waiting for a long-lived token to expire. Previously delivered information cannot be recalled. Ordinary user sessions/installations and recorded usage remain intact.
9. On stale state, permission loss, network failure or a last-admin conflict, display the actual failure and refresh roles. Do not leave a success-looking row after a failed server mutation. A retry must not create duplicate role changes/audit events.
10. The verified organization registrant becomes its first admin only through successful organization creation. Subsequent self-service employees start as `user`; an authorized admin can promote them. The unresolved question of proving corporate authority is not solved by mailbox verification.

## 3. Confirmed login and identity flow

**Updated 13 October 2026 (owner decision):** the hosted service has one address, `https://aifootprinttracker.com`. The organization is found from the verified work email domain. Only administrators sign in on the website; members connect only in the extension with an email code. There are no per-organization subdomains and no member web pages. The [product/enrollment specification](PRODUCT-AND-ENROLLMENT-SPEC.md) has the full flow.

- Both organization admins and users authenticate with email OTP delivered through Brevo: admins on the website, users in the extension's Connect dialog. **No additional password, authenticator or mandatory second factor for organization login.** This supersedes the earlier product-admin MFA requirement; it does not change security recommendations for the operator's separate Brevo vendor account.
- After valid website OTP verification, the backend checks the role in the organization selected by the email domain. An active admin lands on `/admin`. Anyone else is told that only administrators sign in on the website and that members connect from the extension; no session or member is created.
- Never use a client-selected role, the requested URL or the email domain alone to grant admin access. Restrict redirects to `/admin` and enforce authorization on the destination APIs.
- Store verified work email linked to stable internal user identity and tenant membership. Re-verifying the same account for the same organization in another supported browser connects the new installation to that existing identity. Prevent duplicate membership creation under concurrent enrollment. Do not merge identities across organizations automatically.
- Preserve separate scoped credentials for every browser installation. An admin website session is not a shared extension credential. Changing a verified email must not silently create a new usage identity or transfer another user's account.
- Registration asks for no organization address; the server generates an internal key that is never shown. Tenants stay isolated by their credentials at the shared address. Display provisioning failure/pending explicitly. A self-hosted organization runs at its own domain or subdomain.
- The admin dashboard explains how members install the extension and connect from it. The extension itself has **no administration link**, even for logged-in admins.
- Preserve single-use short-lived OTPs, challenge-purpose/tenant binding, attempt limits, throttling, session expiry, revocation and audit controls. The operator accepts that compromise of an admin mailbox can compromise the organization dashboard. Reauthentication required by destructive-action/session-expiry policy uses email OTP only, not an added authentication method.

## 4. Design review before product implementation

Requested outcome: inspect detailed, realistic screens together on one large navigable board, request visual changes and hand approved references to implementers. The user selected a local editable/commentable canvas. The [prototype](../../design-canvas/README.md) now contains 88 screens/state specimens. C13 adds highest-comparable fallback details; C14 adds a scoped image-generation reference. These are content references for the existing same-page Details overlay, not authorization to open another production tab or website page. P02 contains the full methodology and dated model inventory. Designs remain drafts pending user review; this does not mean product implementation is complete.

Recommended local approach: an HTML/CSS design-review canvas with pan/zoom, screen index, stable screen IDs, selected-screen focus and a separate clickable preview mode. No external design account or plugin required. It uses fixture data only; buttons simulate state transitions and do not send OTPs, mutate organizations, collect chats or deploy the product. It is a prototype, not a functioning backend or extension.

The user can request changes by screen ID, edit text and selected text styling, adjust screen density/rearrange board frames, and add anchored or screen-level comments. Review state saves in browser-local storage and exports/imports as JSON; handoff notes export as Markdown. No live collaboration or automatic source-file writes are implied. This is not a general drag-and-drop vector/layout editor. Keep design source and approved references in the repository.

### Screen inventory for the canvas

| Group | Required screens / meaningful states |
| --- | --- |
| Public site | Home; methodology and uncertainty; privacy/data flow; open source and self-hosting; downloads/browser selection; hosted plans and limits |
| Organization registration | Company details (no address field since 13 October 2026); admin email entry; OTP verification; pending/success/failed provisioning; success lands on `/admin` |
| Administrator entry | Email login at the one hosted address; OTP invalid/expired/rate-limited/send-failed; `/admin` destination; organization not found; non-admin told that members connect from the extension |
| Member connection (in the extension) | Work email entry with the secondary own-server option; email code entry and resend; "Connect to {organization}?" with tracking disclosure; connected state; returning-user/new-browser connection; expired/failed connection; installation links for three browsers on the public site |
| Extension | Personal local-only start; enrolled start; My usage; Company aggregates; provider breakdown; time filters; connection/settings; month summary |
| In-chat surfaces | ChatGPT, Claude, Gemini and Perplexity, each light/dark; normal bar; expanded methodology/details; partial/unknown measurement; advisory context threshold; anchor unavailable/noninterference fallback |
| Organization admin | Overview; users and role management (work email, role, number of browsers and status, no usage per member); member browsers and access actions; organization activity by day, tool and model; people counts without names; measurement/sync health counts; no individual usage, request list or IP observations (owner decision of 17 and 18 October 2026); policy and retention; exports; audit history; deletion preview/progress; install extension entry |
| Role dialogs | Promote; demote; self-demote; blocked last-admin action; role-change conflict; access revoked during active admin session |
| Hosted plan management | Seat/retention limits; upgrade information without invented prices; expired/unavailable entitlement; operator-granted exception |
| Platform operator | Separate operator entry; organization directory/detail; plan/quota/retention configuration; grant/revoke free exceptions; audit and operational health |
| Cross-cutting | Loading; empty; offline/queued sync; partial data; denied access; expired session; failed request/retry; success; destructive confirmation; keyboard focus and accessible feedback |

Desktop is the main review canvas. Include narrow/responsive versions for public/registration/admin web flows, actual browser-popup size constraints and host bars in constrained layouts. A desktop-only extension does not imply its website should be unusable on a narrow screen.

### Implementer handoff and approval

- Each screen has an ID, actor/role, route or surface, state, entry/exit actions and source requirement links.
- Publish Fern design tokens, typography, spacing, borders, radii, icons, chart/number formatting and reusable component/state specifications with the screens.
- Show loading/empty/unknown/zero distinctions, accessibility requirements and error text; never make missing measurements look like precise zero usage.
- Use clearly labeled synthetic emails, users and figures. Do not place real employee data in mockups.
- Keep requested edits and approval status per screen/version. Freeze an approved design version before product implementation, with later changes explicitly tracked.
- Verify implemented behavior, accessibility and screen fidelity against the approved references in the actual target browsers. A screenshot alone does not specify interactions or establish accessibility.

## 5. Additional acceptance checks (planned)

| ID | Required evidence |
| --- | --- |
| BR01 | Fern values match the token definitions; selected gauge shape retained; production icon variants tested at actual sizes |
| BR02 | Product brand shared across tenants; organization identity visible without white labeling; no logo in host information bar |
| BR03 | All four host bars support light/dark contrast and preserve host behavior; no extension admin navigation |
| AR01 | Exactly `user`/`admin` organization roles; multiple admins possible; no tenant admin gains platform-owner permissions |
| AR02 | Admin promotes verified same-tenant user; user cannot promote self/others; cross-tenant target rejected |
| AR03 | Admin demotes another admin without deleting identity/history; all subsequent privileged access denied for target |
| AR04 | Last admin cannot be demoted, suspended or removed; concurrent attempts preserve at least one active admin |
| AR05 | Self-demotion succeeds only with another active admin and exits privileged UI; failure leaves accurate role display |
| AR06 | Role changes confirmed and atomically audited; stale version and lost-response retry handled without duplicate changes |
| AR07 | Brevo OTP-only website login sends current admins to `/admin` and refuses users with `admin_required` (13 October 2026); invalid/expired codes and redirect tampering fail safely |
| AR08 | Same verified tenant account connects Chrome/Edge/Firefox installations to one identity without shared device credentials |
| DS01 | Screen inventory and state coverage reviewed; fixtures labeled; prototype has no live authentication/collection/billing side effects |
| DS02 | Approved screens linked to design tokens, behaviors and requirements; implementation fidelity tested separately |

These supplement earlier test groups. They are not executed tests, approved screens or implemented controls.
