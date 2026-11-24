# Security policy

## Supported versions

The extension is published in the Chrome Web Store, which Chrome and Microsoft Edge both install from. It is not in the Microsoft Edge Add-ons store or in the Firefox store. Corrections go into a later version; older versions are not corrected.

| Version                                                  | Security status                                                                   |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Newest version in the Chrome Web Store (Chrome and Edge) | Published; reviewed reports are accepted, but production support is not claimed   |
| Packages from the website (Chrome, Edge, Firefox)        | Unsigned test packages; reviewed reports are accepted, with no support commitment |
| Older versions                                           | Not corrected; update to the newest version                                       |

The absence of a support commitment does not make a vulnerability report unimportant.

## Report privately

Email the maintainer, Pranit Jagannath Nale, at [pranitnale42@gmail.com](mailto:pranitnale42@gmail.com). Use a subject that identifies an AI Footprint Tracker security report. Do not open a public issue for a vulnerability before coordinated disclosure.

Provide only:

- the affected version, commit or package;
- browser and operating-system versions when relevant;
- the affected supported site or self-host component;
- a synthetic, minimal reproduction;
- the security impact and any safe mitigation already tested.

Do not send credentials, signed links, raw IP addresses, private hostnames, employee prompts or answers, real employee documents, production databases, browser profiles, authenticated HAR files or live access tokens. Redact unrelated content and identifiers. Ask before sending an attachment.

The maintainer will assess the report, coordinate a correction and discuss disclosure timing when contact is possible. No fixed response or release deadline is promised. If a real credential or capability link leaked, revoke or rotate it through its issuer; deleting a file from the latest revision does not remove it from Git history, clones or caches.

## Scope boundaries

Useful reports include authorization or tenant-isolation failures, capture of prohibited content, unsafe extension permissions, cross-origin credential exposure, erasure bypass, archive/source mismatch and dependency vulnerabilities. Numerical-method disagreements without a security impact belong in a methodology or feature discussion. General setup questions belong in [SUPPORT.md](SUPPORT.md).
