# Privacy policy

This policy explains which personal data AI Footprint Tracker processes, why, for how long and what rights you have. It covers the website aifootprinttracker.com, the browser extension and the hosted service for organizations. Version of 18 October 2026.

## Who is responsible

The controller under Article 4(7) of the General Data Protection Regulation (GDPR) is:

Pranit Jagannath Nale, email [pranitnale42@gmail.com](mailto:pranitnale42@gmail.com).

This applies to everything in this policy except the data we process on behalf of an organization (see "The hosted service for organizations"). We have not appointed a data protection officer. You can reach us about privacy at the email address above or with the [contact form](/contact).

## In short

- **Personal use:** the extension counts on your device. We receive nothing.
- **Organizations:** after you connect your browser, numbers go to your organization's server. If your organization uses our hosted service, we store them on its behalf and under its instructions.
- **Never:** we never receive the text of your chats, your files or chat titles.
- **No tracking:** no advertising, no analytics, no tracking cookies and no sale of data.

## The browser extension

### What happens on your device

On supported AI sites (ChatGPT, Claude, Gemini, Perplexity and NotebookLM), the extension reads the site's own traffic in your browser to count tokens and to note the model, the time and the parts of a reply. The text is processed only in memory to count it and is not stored. The extension saves numeric records in your browser's own storage. You can erase them at any time in the extension's Settings.

If a site shows a chat without loading it, loads only part of it, or loads it before the extension is ready, the extension asks that same site once for that chat. It does this from inside the page with your existing sign-in, as the page itself would. The request only reads: it never sends a message or changes anything. This is the setting “Load full chat history automatically”, which is on by default. You can turn it off in the extension's Settings for all sites or for ChatGPT, Claude, Claude Cowork, Gemini, Perplexity or NotebookLM alone; the extension then asks that site for nothing and counts what the site loads on its own, so some older messages may not be counted. It runs at most once each time you open a chat (a long chat in at most 20 pages, a second apart; a long ChatGPT chat that stays open continues in further batches of 20 about a minute apart, up to 200 pages a day), only while the tab is visible, tries again once after a temporary failure and stops for a while when the site refuses, at least as long as the site asks. On ChatGPT the request carries the site's own access token and account id, on Perplexity the site's own account id, and on Gemini and NotebookLM the page's own request token. These values go only to the site they belong to and only for that request; they are never stored or sent anywhere else. The chat text that comes back is processed in memory to count it, like any other history the page loads, and only numbers are kept. When Perplexity Computer created text or code files in a chat, the extension also downloads each of these files once, read-only, from the link the page provides for it and without your cookies, only to count its text. The file is never stored and never sent anywhere else; only its token count is kept in this browser, so that reopening the chat does not download it again. For a long ChatGPT chat the extension also keeps, in this browser only, the id of the oldest message it has read, the time of the newest message in that stretch and how many pages it read that day, so a later opening continues from there instead of reading the same pages again. Erase local records deletes them.

The method data for the estimates is part of the extension. It does not download anything from us or from third parties while you use it.

### Your agreement

The extension tracks nothing before you agree. After installation it opens a welcome page that explains what it reads and what it keeps; an installation from before this page shows it once after an update. Until you select Agree and start there or in the extension's popup, the extension reads, counts and records nothing new and sends nothing anywhere, and the bar under the chat box shows only “Tracking is off”. It keeps your choice, the version of the text you agreed to and the time in your browser only. You can withdraw at any time with Turn off tracking in the extension's Settings: tracking stops at once on every site, and the records already saved stay in your browser until you erase them. Before you agree and after you withdraw, the extension may still recalculate the estimates of records already saved in this browser, for example records from a version before this page; this happens on your computer only and sends nothing. Connecting to an organization asks for a separate agreement in the Connect dialog, which the extension keeps in the same way.

### What leaves your device

- **Not connected (personal mode):** nothing reaches us. The extension contacts no one except the AI site you are using, and that site only to read your own chat as described above (for files Perplexity Computer created, the file link the site gives).
- **Connected to an organization:** from the moment you connect, numeric records go to the server of the organization your work email belongs to: our hosted service, or your organization's own server if it runs one. These are the site, the model, token counts, request times, image and document counts, estimates, and keyed hashes of the conversation and request. The keyed hashes let the same message count once without revealing it. Records from earlier messages are sent only for chats you open after connecting.
- **Never sent to us or your organization:** prompts, answers, thinking text, retrieved passages, source links, documents, file names, chat titles, the site's own chat or message ids, passwords, cookies, sign-in tokens and unrelated browsing history. Your passwords, cookies and sign-in tokens are never sent to us or anyone else; the extension uses the site's own sign-in only to read your chat from that same site.

### Legal basis

Storing records on your device is strictly necessary for the function you installed the extension for (Section 25(2) No. 2 TDDDG). Records that stay on your device never reach us, so we do not process them.

### Chrome Web Store Limited Use

The use of information received from AI sites adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements. It is used only to show you the estimates and, if you connect, to send numbers to your organization. It is never sold, used for advertising or used to decide on creditworthiness or lending.

## The hosted service for organizations

### Your organization is responsible

When your organization uses our hosted service, your organization is the controller for its members' data. We process the data on its behalf under a data processing agreement (Article 28 GDPR, see [Data processing agreement](DATA-PROCESSING-AGREEMENT.md)). Your organization decides why it uses the service and on which legal basis, and it must inform you. Ask your organization's administrators about this. If you contact us, we pass your request on to your organization.

### What we process for your organization

| Data | Details | How long |
| --- | --- | --- |
| Account | Work email (stored encrypted), role and membership status | Until the membership is deleted |
| Browsers | A random installation id, the browser family and the time of the last report | Until the browser is disconnected or deleted |
| Usage records | For each request: site, model, token counts, times, features, image and document counts, estimates and keyed hashes | Until an administrator deletes them, or for the shorter period the organization chooses (24, 12, 6 or 3 months) |
| Records from earlier messages | The same numbers for messages in chats you open after connecting, with their source dates | Until an administrator deletes them |
| Connection addresses recorded before 18 October 2026 | The IP address seen when records arrived (stored encrypted), a keyed token to compare addresses, the time and the number of records. Since 18 October 2026 no addresses are recorded, and the stored ones are not shown to anyone | Until all stored addresses are deleted in a one-off clean-up, or earlier when the member is deleted |
| Sign-in codes | A 6-digit code, stored only as a keyed hash | 5 minutes, deleted after use or expiry |
| Sessions | A session cookie after an administrator signs in on the website | At most 7 days; ends when you sign out or lose administrator access |
| Extension access | Access tokens and refresh tokens, stored as hashes on the server; a copy is kept encrypted for a few minutes (at most one day for a new connection) so a repeated request gets the same answer | Access tokens 10 minutes. A refresh token until the browser is disconnected or removed, then 30 days; each one replaced at use is kept 30 days |
| Exports | CSV files that administrators create | 24 hours |
| Request log | Time, reference number, path (which can contain pseudonymous internal identifiers), result and duration of each request, without IP address | 14 days |
| Organization audit log | Administrator actions such as role changes, deletions and exports | While the organization uses the service, then deleted with its data within 30 days |

### Who can see it

- **Administrators** of your organization see figures for the whole organization only: totals, requests and resources per day, tool and model, how many people used AI, and the typical, average and highest number of requests per person, all without names. They never see usage next to a member's name, email or browser, and the server does not give it to them. To manage access they see each member's work email, role, number of browsers and status, and when each browser was connected. These figures are shown however few people use AI, so in a very small organization (for example one or two people) they can reveal one person's usage.
- **Members** see their own figures. If the organization shares totals, members also see organization totals, however few people use AI. In a small team these totals can reveal one person's usage.
- **We** see the organization's name, domain, plan, member count and status. We do not look at individual members' usage, except where your organization instructs us to, for example to fix a fault.

## Organization registration

When someone registers an organization, we process the organization's name, website, country and work domain, and the registrant's work email, name and role at the organization. We use this data to create the organization, to check that the registrant may register it, and to contact the administrators about the account.

The legal basis is Article 6(1)(b) GDPR for the contract with the organization, and Article 6(1)(f) GDPR for the registrant's own data. Our legitimate interest is knowing who registered an organization and being able to reach that person. We delete unfinished registrations after 30 minutes. We keep the data of completed registrations while the organization uses the service and delete it within 30 days after the organization's account ends.

## Contact form

When you write to us, we process your name, work email, organization, the number of people (if you give it), the topic and your message. We use it only to reply. The legal basis is Article 6(1)(b) GDPR if you ask about a plan for your organization, otherwise Article 6(1)(f) GDPR (our interest in answering questions). Your message is never added to usage data. We delete it 12 months after the last message in the conversation, or earlier if you ask us.

## Visiting the website

To find and fix errors, the server keeps a request log for 14 days. For each request to the service it records the time, a reference number, the address and path called (without query parameters), the result and how long it took, and for a server error the place in the program where it occurred. The log contains no IP address, no names or email addresses, and nothing you type into a form or a chat. A logged path can contain internal identifiers of a member, browser, record or conversation. These identifiers are pseudonymous: on their own they do not show who you are or what you wrote. Your browser's IP address is used only to deliver the page. To stop abuse such as mass sign-in attempts, we keep a keyed hash of the IP address with the times of recent requests for one day after your last request. The legal basis is Article 6(1)(f) GDPR. Our legitimate interest is a secure and available service.

The website sets cookies only when you sign in or register, and only those that are strictly necessary (Section 25(2) No. 2 TDDDG):

| Cookie | Purpose | Lifetime |
| --- | --- | --- |
| __Host-aift | Keeps you signed in to your organization | At most 7 days |
| __Host-aift-registration | Keeps an organization registration in progress | At most 24 hours |
| __Host-aift-bootstrap | Protects the first step of sign-in | 5 minutes |

We do not use analytics, advertising, social media plugins, or fonts and scripts loaded from other servers.

## Service providers

| Provider | What they do | Where |
| --- | --- | --- |
| Brevo GmbH, Köpenicker Str. 126, 10179 Berlin, Germany (part of Sendinblue SAS, Paris) | Sends sign-in codes by email. Brevo receives only the recipient's address and the code, with tracking turned off. Its delivery logs are kept for 1 month. | EU. Some of Brevo's sub-processors are outside the EU, see below. |
| Contabo GmbH, Welfenstraße 22, 81541 Munich, Germany | Runs the servers, the database and the backups | European Union |

Both process data only on our instructions under a data processing agreement. We do not sell personal data or share it for advertising.

## Transfers outside the EU

We host the service in the European Union. Brevo uses some sub-processors outside the EU, for example Cloudflare in the USA. These transfers rely on the EU-US Data Privacy Framework adequacy decision (Article 45 GDPR) or on standard contractual clauses (Article 46 GDPR).

## Security

All connections use HTTPS. Work email addresses, registration details and exports are encrypted in the database. Connection addresses recorded before 18 October 2026 stay encrypted, with a separate key, until they are deleted. Sign-in codes are stored only as hashes. Extension tokens are stored as hashes, with a short-lived encrypted copy as described above. Deleting records and removing browsers need a fresh email code. A deletion journal stops a backup restore from bringing back data that was deleted. Backups are kept for 14 days.

## Your rights

You have the right to:

- access your data (Article 15 GDPR)
- have it corrected (Article 16)
- have it erased (Article 17)
- restrict its processing (Article 18)
- receive it in a portable format (Article 20)
- **object at any time to processing based on Article 6(1)(f) GDPR, on grounds relating to your particular situation (Article 21)**
- complain to a data protection supervisory authority (Article 77), in particular in the EU country where you live or work or where the alleged infringement took place. The authority responsible for us is the data protection authority of the German federal state where the provider lives.

To use these rights, email [pranitnale42@gmail.com](mailto:pranitnale42@gmail.com). For data we process for your organization, contact your organization's administrators. They can delete a member's records on the admin site, and we help them with every request.

## Do you have to give us data?

The extension works without giving any data. To join an organization you need a work email on its domain; without it you cannot connect. To answer the contact form we need an email address.

## Automated decisions

We do not make decisions based solely on automated processing, including profiling (Article 22 GDPR).

## Changes

We update this policy when the service or the law changes. The version date is at the top of this page.
