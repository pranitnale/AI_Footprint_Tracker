# SMTP mail setup for sign-in codes

Added 24 November 2026. The server can send its one-time sign-in codes through any standard mail server over SMTP (`mail_adapter` `"smtp"`), beside the [Brevo adapter](BREVO-PRIVACY-SETUP.md). The hosted service sends from its own mail server on its servers in Germany and keeps Brevo as a fallback. A self-hoster can use their organization's own mail server, a mail host's submission service, or Brevo.

This page says what to configure and what to check. It is not a completed deployment or a legal certification: the checks below record work an operator does; the documentation does not perform them.

## 1. What the server sends

Each code email holds fixed text and the six-digit code, nothing else. The server writes these headers and no others: From (`AI Footprint Tracker <mail_sender>`), To, Subject, Date, Message-ID (in the sender's domain, so the server's own host name never appears), `Auto-Submitted: auto-generated` and `X-Auto-Response-Suppress: All`, plus the MIME content headers. The plain-text version always goes out; the designed HTML version is added only after `mail_html_verified` is set. Neither has a link, an image or anything that loads from another server.

The mail server receives the recipient's address and the message, and keeps whatever its own delivery log records. Send nothing else through it for this purpose: no names, usage figures or chat content.

## 2. Settings

| Setting | Meaning |
| --- | --- |
| `mail_adapter` | `"smtp"`. Without it the server uses `"brevo"`, so a settings file from an earlier release keeps its meaning. |
| `smtp_host` | The mail server's host name. Its TLS certificate must be valid for this name. |
| `smtp_port` | 587 by default (submission with STARTTLS); 465 is usual for `"tls"`. |
| `smtp_security` | `"starttls"` (default) or `"tls"` (encrypted from the start). There is no unencrypted mode: a server that offers no STARTTLS is not used. |
| `smtp_username`, `smtp_password` | The login, when the server needs one. Without a user name the server does not log in. Keep the password only in the protected settings file. |
| `mail_sender` | The From address. `brevo_sender` is its older name and is still read when `mail_sender` is empty. |

Production startup requires `mail_sender`, `smtp_host` and `mail_privacy_verified`. The connection times out after 10 seconds.

## 3. What the answers mean

A refusal with a 4xx code, or a connection that could not be made or secured, means nothing was sent and the person can ask for a new code. A 5xx refusal, a refused login, or a server that offers no encryption or no usable login method is a setup fault that a retry does not fix. If the connection breaks after the message data started, the server may have accepted the message, so the delivery is reported as unknown and no second code is sent automatically. No answer, error or log line contains the password, the code or the recipient.

## 4. Sender records

Use a sender address on a domain you control, and publish its authentication records with your DNS provider, copying the values your mail host gives you:

- SPF: one TXT record on the sending domain that includes the mail server. Do not create a second SPF record; extend the existing one.
- DKIM: the signing key's TXT record under the selector your mail server signs with.
- DMARC: a `_dmarc` TXT record. Start with a reporting policy and tighten it once every legitimate sender of the domain passes.

Check a delivered code email's `Authentication-Results` header: SPF and DKIM pass and DMARC is aligned with the From domain.

## 5. Check a delivered code email

Before setting `mail_privacy_verified` to true, send a code to a test mailbox you control and open the delivered message's raw source:

1. It holds no link, no image, no remote style and no tracking pixel, and no header beyond the ones in section 1 and those that the mail servers on the way add (Received, authentication results, and similar).
2. Neither your mail server nor a relay rewrote the text or added a footer, a link or tracking.
3. Only then set `mail_privacy_verified`. Repeat the check with the HTML version before setting `mail_html_verified`.

Repeat both checks after you change the mail server, the relay or the sender domain. Do not keep real codes, passwords or other people's addresses as evidence.

## 6. Delivery log and returned mail

The mail server keeps its own delivery log and receives returned mail (bounces) for the sender address. Decide how long both are kept, set that on the mail server, and say it in your privacy notice. The hosted service rotates its delivery log weekly, keeps up to five weeks, and deletes returned messages after at most five weeks.
