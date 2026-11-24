import re
import smtplib
import ssl
from email.message import EmailMessage
from email.policy import SMTP as SMTP_POLICY
from email.utils import formataddr, formatdate, make_msgid

import httpx

from .security import Problem

# Seconds to wait for the mail service, for the connection and for each answer.
MAIL_TIMEOUT = 10

# What each code is for, in the words the email uses: (subject, heading, what to do with the code).
PURPOSES = {
    "login": (
        "Your sign-in code for AI Footprint Tracker",
        "Sign in to your organization",
        "Enter this code to sign in to your organization's administration.",
    ),
    "connect": (
        "Your code to connect AI Footprint Tracker",
        "Connect your browser",
        "Enter this code in the AI Footprint Tracker extension to connect this browser to your organization.",
    ),
    "registration": (
        "Confirm your AI Footprint Tracker registration",
        "Confirm your registration",
        "Enter this code to confirm your work email and finish registering your organization.",
    ),
    "action_reauth": (
        "Confirm your change in AI Footprint Tracker",
        "Confirm your change",
        "Enter this code to confirm the change you started in your organization's administration.",
    ),
    "operator_login": (
        "Your AI Footprint Tracker developer sign-in code",
        "Developer sign-in",
        "Enter this code to sign in to the developer panel.",
    ),
    "operator_reauth": (
        "Confirm your AI Footprint Tracker developer panel change",
        "Confirm your developer panel change",
        "Enter this code to confirm the change you started in the developer panel.",
    ),
}


def code_email(code, purpose):
    """
    Subject, plain text and HTML for an email code (owner, 13 Oct 2026: a designed email with the
    code in large type). It holds only fixed text and the code: no images, links or tracking, so the
    privacy check of the delivered message still holds and nothing loads from another server.
    """
    if not re.fullmatch(r"\d{6}", code):
        raise ValueError("a code is six digits")
    subject, heading, action = PURPOSES.get(purpose, PURPOSES["login"])
    expiry = "The code expires in 5 minutes and works once."
    ignore = "If you did not ask for it, ignore this email. Nothing happens without the code."
    never = "Never share this code. We will never ask you for it."
    text = "\n\n".join([heading, action, f"Your code: {code}", expiry, ignore, never, "AI Footprint Tracker, aifootprinttracker.com"])
    # The code shows as six digits with no space (owner, 13 Oct 2026): a copied "094 475" was cut to
    # "094 47" by six-character code fields. Letter spacing keeps it readable without changing the text.
    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>{subject}</title>
</head>
<body style="margin:0;padding:0;background:#f2f5f0;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">{expiry}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f2f5f0;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background:#ffffff;border:1px solid #dfe6da;border-radius:14px;">
<tr><td style="height:6px;background:#c6ef6c;border-radius:14px 14px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:28px 32px 8px 32px;font-family:Segoe UI,Helvetica,Arial,sans-serif;">
<p style="margin:0;font-size:13px;font-weight:600;letter-spacing:0.4px;color:#3d6b45;">AI Footprint Tracker</p>
<h1 style="margin:10px 0 0 0;font-size:22px;line-height:1.3;font-weight:700;color:#10261a;">{heading}</h1>
<p style="margin:12px 0 0 0;font-size:15px;line-height:1.55;color:#3b4a40;">{action}</p>
</td></tr>
<tr><td align="center" style="padding:20px 32px 6px 32px;">
<div style="display:inline-block;padding:16px 26px;background:#f1f6ec;border:1px solid #d3e3c6;border-radius:12px;font-family:Consolas,Menlo,Courier New,monospace;font-size:36px;line-height:1.1;font-weight:700;letter-spacing:6px;color:#10261a;" aria-label="Your code {' '.join(code)}">{code}</div>
</td></tr>
<tr><td align="center" style="padding:6px 32px 24px 32px;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:13px;color:#5b6b60;">{expiry}</td></tr>
<tr><td style="padding:0 32px 28px 32px;font-family:Segoe UI,Helvetica,Arial,sans-serif;">
<p style="margin:0;padding-top:18px;border-top:1px solid #e6ece2;font-size:13px;line-height:1.55;color:#5b6b60;">{ignore}</p>
<p style="margin:8px 0 0 0;font-size:13px;line-height:1.55;color:#5b6b60;">{never}</p>
</td></tr>
</table>
<p style="margin:16px 0 0 0;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:12px;color:#7d8a80;">AI Footprint Tracker &middot; aifootprinttracker.com</p>
</td></tr>
</table>
</body>
</html>
"""
    return subject, text, html


class FakeMail:
    """Explicit test/development delivery sink. Never mounted as a public API."""

    def __init__(self):
        self.messages = []
        self.fail = False

    def send(self, recipient, code, purpose="login"):
        if self.fail:
            raise Problem("email_service_unavailable", 503, True)
        self.messages.append({"recipient": recipient, "code": code, "purpose": purpose})
        return "accepted"


class BrevoMail:
    def __init__(self, settings):
        self.settings = settings

    def send(self, recipient, code, purpose="login"):
        if (
            not self.settings.mail_privacy_verified
            or not self.settings.brevo_key
            or not self.settings.sender
        ):
            raise Problem("configuration_required", 503)
        subject, text, html = code_email(code, purpose)
        # The consent field alone does not disable tracking. Delivered-message evidence gates this adapter.
        body = {
            "sender": {"name": "AI Footprint Tracker", "email": self.settings.sender},
            "to": [{"email": recipient, "contactPixelTrackingConsent": False}],
            "subject": subject,
            "textContent": text,
        }
        if getattr(self.settings, "mail_html_verified", False):
            body["htmlContent"] = html
        try:
            response = httpx.post(
                "https://api.brevo.com/v3/smtp/email",
                json=body,
                headers={"api-key": self.settings.brevo_key},
                timeout=MAIL_TIMEOUT,
            )
        except (httpx.TimeoutException, httpx.NetworkError):
            return "delivery_unknown"
        if response.status_code == 429 or response.status_code >= 500:
            raise Problem("email_service_unavailable", 503, True)
        if response.status_code not in {200, 201, 202}:
            raise Problem("email_service_unavailable", 503)
        return "accepted"


def refused(smtp_code):
    # A 4xx answer is a temporary refusal: the server kept nothing, so sending again is safe.
    return Problem("email_service_unavailable", 503, 400 <= smtp_code < 500)


class SmtpMail:
    """
    Sends code emails through any standard mail server. The connection is always encrypted and the
    server's certificate and host name are checked; there is no fallback to an unencrypted
    connection. send() answers like BrevoMail: "accepted", "delivery_unknown" only when the
    connection broke after the message data started, or a Problem when nothing was sent.
    """

    def __init__(self, settings):
        self.settings = settings

    def message(self, recipient, code, purpose):
        sender = self.settings.sender
        subject, text, html = code_email(code, purpose)
        message = EmailMessage(policy=SMTP_POLICY)
        message["From"] = formataddr(("AI Footprint Tracker", sender))
        message["To"] = recipient
        message["Subject"] = subject
        message["Date"] = formatdate(usegmt=True)
        # Without a domain, make_msgid uses the machine's host name, which would name the container.
        message["Message-ID"] = make_msgid(domain=sender.rsplit("@", 1)[1])
        # Asks receiving systems not to answer a code email with out-of-office or similar replies.
        message["Auto-Submitted"] = "auto-generated"
        message["X-Auto-Response-Suppress"] = "All"
        message.set_content(text)
        if getattr(self.settings, "mail_html_verified", False):
            message.add_alternative(html, subtype="html")
        return message

    def send(self, recipient, code, purpose="login"):
        settings = self.settings
        if not settings.mail_privacy_verified or not settings.smtp_host or not settings.sender:
            raise Problem("configuration_required", 503)
        outcome = self.transfer(recipient, self.message(recipient, code, purpose).as_bytes())
        # Raised here, outside the handlers in transfer, so the smtplib error (whose text can hold the
        # recipient) is not attached to the Problem as its context.
        if isinstance(outcome, Problem):
            raise outcome
        return outcome

    def transfer(self, recipient, data):
        settings = self.settings
        context = ssl.create_default_context()
        server = None
        data_started = False
        try:
            if settings.smtp_security == "tls":
                server = smtplib.SMTP_SSL(
                    settings.smtp_host, settings.smtp_port, timeout=MAIL_TIMEOUT, context=context
                )
            else:
                server = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=MAIL_TIMEOUT)
                server.starttls(context=context)
            # mail() does not greet by itself (only login() and sendmail() do), and a server may refuse
            # MAIL before EHLO. After STARTTLS the earlier greeting no longer counts.
            server.ehlo()
            if settings.smtp_username:
                server.login(settings.smtp_username, settings.smtp_password)
            reply, _ = server.mail(settings.sender)
            if reply != 250:
                return refused(reply)
            reply, _ = server.rcpt(recipient)
            if reply not in {250, 251}:
                return refused(reply)
            data_started = True
            # data() raises only when the DATA command itself is refused; the server's answer after the
            # message body comes back as its return value. A refusal there means nothing was taken.
            reply, _ = server.data(data)
            if reply != 250:
                return refused(reply)
            try:
                server.quit()
            except OSError:
                pass  # The message is already accepted; a failed goodbye changes nothing.
            return "accepted"
        except smtplib.SMTPResponseException as error:
            return refused(error.smtp_code)
        except smtplib.SMTPServerDisconnected:
            return "delivery_unknown" if data_started else Problem("email_service_unavailable", 503, True)
        except smtplib.SMTPException:
            # STARTTLS or a usable login method is not offered: a setup fault that a retry cannot fix.
            return Problem("email_service_unavailable", 503)
        except OSError:
            # Connection, TLS and certificate failures and timeouts. Before the message data started the
            # server has nothing, so a retry is safe; after that, it may have accepted the message.
            return "delivery_unknown" if data_started else Problem("email_service_unavailable", 503, True)
        finally:
            if server is not None:
                server.close()


def mail_delivery(settings):
    """The delivery adapter that settings.mail_adapter names."""
    if settings.mail_adapter == "fake":
        return FakeMail()
    if settings.mail_adapter == "smtp":
        return SmtpMail(settings)
    return BrevoMail(settings)
