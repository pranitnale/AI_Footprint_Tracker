# Sensitive research-link redaction

Recorded 10 September 2026.

One signed Bloomberg article-access/share-link token that appeared twice was removed from one stored research stream while retaining its public source link and surrounding nonsensitive context. The edited file remains valid JSONL. The token was not printed, decoded, redeemed, copied to a backup, or used for an external request during this correction.

Local working-directory, messaging-socket and session identifiers were also replaced with redaction markers in the initialization record of each stored research stream. Other initialization context was preserved; later records were unchanged except for the two token occurrences described above. The tracked local `.context` session file was preserved unchanged. Excluding it from future publication requires a separately reviewed tracking and history decision.

The same values remain in existing Git history. Removing them from the working copy does not revoke the capability or remediate published clones, caches, forks, or prior local copies. History remediation and any issuer-side invalidation require a separately reviewed repository-maintenance decision. This note records the boundary; it does not claim account or API credential compromise.
