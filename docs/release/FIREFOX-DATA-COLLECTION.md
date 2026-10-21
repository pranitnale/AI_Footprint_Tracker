# Firefox data collection declaration

Reviewed 18 October 2026, updated 20 October 2026. Applies to `browser_specific_settings.gecko.data_collection_permissions` in `apps/extension/wxt.config.ts` and to `COMPANY_DATA_CATEGORIES` in `apps/extension/lib/platform.ts`. The review of 18 October changed no behaviour and no declared category. On 20 October 2026 the owner decided to declare `browsingActivity` as a fifth optional category (see the last section).

## Current declaration

```json
"data_collection_permissions": {
  "required": ["none"],
  "optional": ["websiteActivity", "authenticationInfo", "personallyIdentifyingInfo", "technicalAndInteraction", "browsingActivity"]
}
```

Firefox shows the required list in the install prompt. The optional list is requested at run time: when a person connects to an organization, `requestServerOrigin` asks for the server's host permission together with `data_collection: COMPANY_DATA_CATEGORIES`, and `hasCompanyConsent` treats the connection as allowed only while every one of those categories is granted. The manifest's optional list and `COMPANY_DATA_CATEGORIES` must stay identical; `apps/extension/test/firefox-data-collection.test.ts` checks both lists and the request.

## Mozilla's rules as understood here

From Mozilla's extension workshop and add-on policy documentation as known at this review; the pages were not re-read for this note, so check them before a listing is submitted:

- New extensions listed on addons.mozilla.org must declare `data_collection_permissions` (required from November 2025 for new listings, later for existing ones). Firefox 140 on desktop and 142 on Android show the declaration in the install and permission prompts. The manifest sets `strict_min_version` 140.
- "Data collection" means data the extension transmits off the device, to the developer or a third party. Processing on the device, including reading page content in memory, is not collection.
- `required` lists what the extension cannot work without; `["none"]` declares that it transmits nothing by default. `optional` lists categories requested later with `permissions.request`, which the person may refuse.
- Technical and interaction data is understood to be allowed only as an optional category.

## Why "required: none" is correct

Personal mode, the default, transmits nothing to the developer or anyone else. The extension reads the supported AI sites' own traffic in the page and counts it in memory, and saves only numeric records in the browser's storage. When it asks a site for an older chat (the "Load full chat history automatically" setting), it sends that request to the same site, with the person's own sign-in, as the page itself would; the answer stays on the device. None of this leaves the device for a party other than the site the person is using, so no category is required.

## Why the five optional categories cover organization mode

Organization mode starts only after the person connects and accepts the optional categories. From then on the extension sends to the organization's server:

| Category | What is sent |
| --- | --- |
| `personallyIdentifyingInfo` | The work email, to receive the sign-in code and to identify the member in the organization |
| `authenticationInfo` | The one-time sign-in code, then the access and refresh tokens and the reconnect secret for this browser |
| `websiteActivity` | For each request on a supported AI site: the site, the model, request times, token counts, features, image and document counts, estimates and keyed hashes of the conversation and message ids |
| `technicalAndInteraction` | The browser family, protocol version, installation identifiers and sync state |
| `browsingActivity` | The same usage records read as a history of visits: which of the supported AI sites each request was made on, and when |

Not sent, so not declared: prompts, answers, thinking text, file contents or names, chat titles, the sites' own chat or message ids, URLs, visits to any other site, search terms and passwords or cookies of the AI sites. `websiteContent` and `personalCommunications` therefore do not apply: token counts are derived on the device and no text leaves it.

## Decision of 20 October 2026: `browsingActivity` is declared

`browsingActivity` covers "websites you visit" over time. The usage records name which of the supported AI sites a request was made on, with its time, but no URL and no other site. The review of 18 October counted that as `websiteActivity` (actions taken on a website) and left adding `browsingActivity` as an owner decision, because a reviewer could read the same records as browsing activity.

The owner decided to declare it. Requests listed per site with their times show, over time, when the person used each AI site, which is what Firefox describes as browsing activity. Declaring the category says so in the consent prompt instead of relying on a narrow reading. It changes nothing that is sent: the category is optional and asked for together with the other four when connecting, and Personal mode still sends nothing.

Consequences:

- Connecting to an organization on Firefox asks for all five categories at once. Refusing the prompt leaves the browser in Personal mode.
- A Firefox connection agreed before this change has only the four earlier categories, so `hasCompanyConsent` returns false for it. New records then stay in Personal mode, and every call to the organization's server checks the same function first and stops with `policy_unavailable`, so nothing is sent under the earlier grant. The person has to grant the permission again (connecting asks for all five) before the browser shares anything. There were no Firefox store users when this was decided, so only test installations see the extra prompt.
- Chrome and Edge have no data collection declaration and are unchanged.
