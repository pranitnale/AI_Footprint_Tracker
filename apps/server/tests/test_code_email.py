import email
import re
import smtplib
import ssl
import traceback
from dataclasses import replace
from email import policy
from types import SimpleNamespace
from uuid import uuid4

import pytest
from test_admin_privacy import production_settings

from aift import mail
from aift.config import Settings
from aift.mail import PURPOSES, BrevoMail, FakeMail, SmtpMail, code_email, mail_delivery
from aift.security import Problem

RECIPIENT = "member@example.org"
PASSWORD = "smtp-test-password"


def test_every_code_email_is_designed_and_stays_free_of_links_images_and_tracking():
    # Owner, 13 Oct 2026: a designed email with the code in large type instead of one plain line.
    for purpose, (subject, heading, action) in PURPOSES.items():
        sent_subject, text, html = code_email("094475", purpose)
        assert sent_subject == subject
        assert "font-size:36px" in html
        # Six digits with no space, so a copied code fits a six-character code field whole.
        assert ">094475</div>" in html and "094 475" not in html
        assert heading in html and action in html and "5 minutes" in html
        assert "094475" in text and heading in text
        # Nothing loads from another server and nothing can be clicked or tracked.
        assert not re.search(r"<img|<a\b|https?://|url\(|<script|<link", html, re.IGNORECASE)
        assert "094475" not in sent_subject


def test_a_code_must_be_six_digits_so_nothing_else_reaches_the_html():
    with pytest.raises(ValueError):
        code_email("<b>1</b>", "login")


def test_brevo_sends_the_designed_and_the_plain_version(monkeypatch):
    sent = {}

    def post(url, json, headers, timeout):
        sent.update(json)
        return SimpleNamespace(status_code=201)

    monkeypatch.setattr(mail.httpx, "post", post)
    # A settings file from before SMTP support: brevo_sender and no mail_sender.
    settings = Settings(
        database_url="sqlite://",
        mail_privacy_verified=True,
        mail_html_verified=False,
        brevo_key="key",
        brevo_sender="no-reply@example.org",
    )
    assert isinstance(mail_delivery(settings), BrevoMail)
    # Until a delivered HTML message is checked for tracking, only the plain text goes out.
    mail_delivery(settings).send(RECIPIENT, "123456", "connect")
    assert "htmlContent" not in sent and "123456" in sent["textContent"]
    assert sent["sender"] == {"name": "AI Footprint Tracker", "email": "no-reply@example.org"}
    sent.clear()
    settings = replace(settings, mail_html_verified=True, mail_sender="codes@example.org")
    assert BrevoMail(settings).send(RECIPIENT, "123456", "connect") == "accepted"
    assert sent["sender"]["email"] == "codes@example.org"
    assert sent["subject"] == PURPOSES["connect"][0]
    assert ">123456</div>" in sent["htmlContent"] and "123 456" not in sent["htmlContent"]
    assert "123456" in sent["textContent"]
    assert sent["to"] == [{"email": RECIPIENT, "contactPixelTrackingConsent": False}]


def test_the_code_email_names_what_the_code_is_for(setup):
    app, client, _, _, _, _ = setup
    response = client.post(
        "/v1/auth/otp/request",
        json={"purpose": "login", "email": "admin@example.org", "dispatch_id": str(uuid4()), "registration_id": None},
    )
    assert response.status_code == 200, response.text
    assert app.state.mail.messages[-1]["purpose"] == "login"


class StubServer:
    """Stands in for smtplib.SMTP and SMTP_SSL: records each step and fails where the test says."""

    def __init__(self, stub, kind, host, port, timeout, context=None):
        self.stub = stub
        stub.log.append((kind, host, port, timeout, context))
        self.step("connect")

    def step(self, name):
        if name in self.stub.fail:
            raise self.stub.fail[name]

    def starttls(self, context):
        self.stub.log.append(("starttls", context))
        self.step("starttls")

    def ehlo(self):
        self.stub.log.append(("ehlo",))

    def login(self, user, password):
        self.stub.log.append(("login", user, password))
        self.step("login")

    def mail(self, sender):
        self.stub.log.append(("mail", sender))
        self.step("mail")
        return self.stub.replies.get("mail", 250), b"ok"

    def rcpt(self, recipient):
        self.stub.log.append(("rcpt", recipient))
        return self.stub.replies.get("rcpt", 250), b"ok"

    def data(self, data):
        self.stub.log.append(("data", data))
        # Like smtplib: a refused DATA command raises, the answer after the body is returned.
        self.step("data")
        return self.stub.replies.get("data", 250), b"ok"

    def quit(self):
        self.stub.log.append(("quit",))
        self.step("quit")

    def close(self):
        self.stub.log.append(("close",))


@pytest.fixture
def server(monkeypatch):
    stub = SimpleNamespace(log=[], fail={}, replies={})

    def factory(kind):
        return lambda host, port, timeout, context=None: StubServer(stub, kind, host, port, timeout, context)

    # No test opens a network connection.
    monkeypatch.setattr(mail.smtplib, "SMTP", factory("SMTP"))
    monkeypatch.setattr(mail.smtplib, "SMTP_SSL", factory("SMTP_SSL"))
    stub.steps = lambda: [entry[0] for entry in stub.log]
    stub.sent = lambda: email.message_from_bytes(
        next(entry[1] for entry in stub.log if entry[0] == "data"), policy=policy.default
    )
    return stub


def smtp_settings(**changes):
    values = {
        "database_url": "sqlite://",
        "mail_adapter": "smtp",
        "mail_privacy_verified": True,
        "smtp_host": "mail.example.org",
        "mail_sender": "codes@example.org",
        "smtp_username": "codes@example.org",
        "smtp_password": PASSWORD,
    }
    return Settings(**{**values, **changes})


def test_smtp_sends_only_the_plain_text_and_the_expected_headers(server):
    settings = smtp_settings()
    assert isinstance(mail_delivery(settings), SmtpMail)
    assert mail_delivery(settings).send(RECIPIENT, "123456", "connect") == "accepted"
    data = next(entry[1] for entry in server.log if entry[0] == "data")
    assert b"\r\n" in data and b"\n" not in data.replace(b"\r\n", b"")
    sent = server.sent()
    # The email package adds MIME-Version and the content headers; nothing else may be added.
    assert set(sent.keys()) == {
        "From",
        "To",
        "Subject",
        "Date",
        "Message-ID",
        "Auto-Submitted",
        "X-Auto-Response-Suppress",
        "MIME-Version",
        "Content-Type",
        "Content-Transfer-Encoding",
    }
    assert sent["From"] == "AI Footprint Tracker <codes@example.org>"
    assert sent["To"] == RECIPIENT
    assert sent["Subject"] == PURPOSES["connect"][0]
    # The Message-ID names the sender's domain, never the server's own host name.
    assert re.fullmatch(r"<[^@<>]+@example\.org>", sent["Message-ID"])
    assert sent["Auto-Submitted"] == "auto-generated"
    assert sent["X-Auto-Response-Suppress"] == "All"
    assert sent.get_content_type() == "text/plain"
    # The message goes out with CRLF line ends (checked above), and the parsed body keeps them.
    assert sent.get_content().replace("\r\n", "\n").rstrip("\n") == code_email("123456", "connect")[1]


def test_smtp_adds_the_html_version_only_once_it_is_verified(server):
    SmtpMail(smtp_settings(mail_html_verified=True)).send(RECIPIENT, "123456", "connect")
    sent = server.sent()
    assert sent.get_content_type() == "multipart/alternative"
    assert [part.get_content_type() for part in sent.iter_parts()] == ["text/plain", "text/html"]
    html = sent.get_body(("html",)).get_content()
    assert ">123456</div>" in html
    assert not re.search(r"<img|<a\b|https?://|url\(|<script|<link", html, re.IGNORECASE)


def verifies(context):
    return context.verify_mode == ssl.CERT_REQUIRED and context.check_hostname


def test_smtp_upgrades_to_verified_tls_before_it_logs_in(server):
    SmtpMail(smtp_settings()).send(RECIPIENT, "123456")
    assert server.steps() == ["SMTP", "starttls", "ehlo", "login", "mail", "rcpt", "data", "quit", "close"]
    _, host, port, timeout, _ = server.log[0]
    assert (host, port, timeout) == ("mail.example.org", 587, 10)
    assert verifies(server.log[1][1])
    assert server.log[3] == ("login", "codes@example.org", PASSWORD)
    assert server.log[4] == ("mail", "codes@example.org")
    assert server.log[5] == ("rcpt", RECIPIENT)


def test_smtp_with_implicit_tls_verifies_the_certificate_from_the_start(server):
    SmtpMail(smtp_settings(smtp_security="tls", smtp_port=465)).send(RECIPIENT, "123456")
    assert server.steps() == ["SMTP_SSL", "ehlo", "login", "mail", "rcpt", "data", "quit", "close"]
    _, _, port, timeout, context = server.log[0]
    assert (port, timeout) == (465, 10) and verifies(context)


def test_smtp_logs_in_only_with_a_user_name(server):
    SmtpMail(smtp_settings(smtp_username="", smtp_password="")).send(RECIPIENT, "123456")
    assert "login" not in server.steps()


def test_smtp_greets_before_mail_without_a_login_on_implicit_tls(server):
    # Without login() nothing else sends EHLO, and a server may refuse MAIL before it.
    SmtpMail(smtp_settings(smtp_security="tls", smtp_port=465, smtp_username="")).send(RECIPIENT, "123456")
    assert server.steps() == ["SMTP_SSL", "ehlo", "mail", "rcpt", "data", "quit", "close"]


@pytest.mark.parametrize(
    ("fail", "replies", "retryable"),
    [
        ({"connect": ConnectionRefusedError()}, {}, True),
        ({"connect": TimeoutError()}, {}, True),
        ({"connect": smtplib.SMTPConnectError(554, b"no")}, {}, False),
        ({"starttls": ssl.SSLCertVerificationError("certificate verify failed")}, {}, True),
        # A server that offers no encryption is never used without it.
        ({"starttls": smtplib.SMTPNotSupportedError("STARTTLS extension not supported by server.")}, {}, False),
        ({"login": smtplib.SMTPAuthenticationError(535, b"bad credentials")}, {}, False),
        ({"login": smtplib.SMTPException("No suitable authentication method found.")}, {}, False),
        ({"mail": smtplib.SMTPServerDisconnected("Connection unexpectedly closed")}, {}, True),
        ({}, {"mail": 451}, True),
        ({}, {"mail": 550}, False),
        ({}, {"rcpt": 450}, True),
        ({}, {"rcpt": 550}, False),
        ({"data": smtplib.SMTPDataError(452, b"try later")}, {}, True),
        ({"data": smtplib.SMTPDataError(554, b"rejected")}, {}, False),
        # The server's answer after the message body: it refused the message, so nothing was taken.
        ({}, {"data": 451}, True),
        ({}, {"data": 554}, False),
    ],
)
def test_smtp_reports_a_refusal_or_a_failed_connection_as_nothing_sent(server, fail, replies, retryable):
    server.fail.update(fail)
    server.replies.update(replies)
    with pytest.raises(Problem) as raised:
        SmtpMail(smtp_settings()).send(RECIPIENT, "123456")
    problem = raised.value
    assert (problem.code, problem.status, problem.retryable) == ("email_service_unavailable", 503, retryable)
    assert "data" not in server.steps() or "data" in fail or "data" in replies
    # A connection that was opened is always closed; a failed connect leaves nothing open.
    assert server.steps()[-1] == "close" or "connect" in fail


@pytest.mark.parametrize(
    "error", [smtplib.SMTPServerDisconnected("Connection unexpectedly closed"), TimeoutError(), ConnectionResetError()]
)
def test_smtp_delivery_is_unknown_only_when_the_connection_breaks_during_the_message_data(server, error):
    server.fail["data"] = error
    assert SmtpMail(smtp_settings()).send(RECIPIENT, "123456") == "delivery_unknown"
    assert server.steps()[-1] == "close"


def test_smtp_ignores_a_failed_goodbye_after_the_message_was_accepted(server):
    server.fail["quit"] = smtplib.SMTPServerDisconnected("Connection unexpectedly closed")
    assert SmtpMail(smtp_settings()).send(RECIPIENT, "123456") == "accepted"


@pytest.mark.parametrize(
    "changes",
    [{"mail_privacy_verified": False}, {"smtp_host": ""}, {"mail_sender": ""}],
)
def test_smtp_sends_nothing_until_it_is_configured_and_the_privacy_check_passed(server, changes):
    with pytest.raises(Problem) as raised:
        SmtpMail(smtp_settings(**changes)).send(RECIPIENT, "123456")
    assert (raised.value.code, raised.value.status) == ("configuration_required", 503)
    assert server.log == []


def test_smtp_reads_the_older_sender_name(server):
    SmtpMail(smtp_settings(mail_sender="", brevo_sender="old@example.org")).send(RECIPIENT, "123456")
    assert ("mail", "old@example.org") in server.log


def test_smtp_errors_carry_no_password_code_or_recipient(server):
    # Mail servers often repeat the recipient in their answer; smtplib puts it into its exception.
    server.fail["data"] = smtplib.SMTPDataError(550, f"{RECIPIENT} 123456 {PASSWORD} rejected".encode())
    with pytest.raises(Problem) as raised:
        SmtpMail(smtp_settings()).send(RECIPIENT, "123456")
    problem = raised.value
    assert problem.__cause__ is None and problem.__context__ is None
    shown = "".join(traceback.format_exception_only(problem)) + repr(vars(problem))
    for secret in (RECIPIENT, "123456", PASSWORD):
        assert secret not in shown
    assert PASSWORD not in repr(smtp_settings())


def test_fake_mail_is_chosen_by_name():
    assert isinstance(mail_delivery(Settings(database_url="sqlite://", mail_adapter="fake")), FakeMail)


def test_production_needs_what_the_chosen_mail_adapter_needs(setup):
    settings = setup[-1]
    brevo = production_settings(settings)
    brevo.validate()
    smtp = replace(brevo, mail_adapter="smtp", brevo_key="", smtp_host="mail.example.org")
    smtp.validate()
    replace(smtp, brevo_sender="", mail_sender="codes@example.org").validate()
    for broken in (
        replace(smtp, smtp_host=""),
        replace(smtp, brevo_sender="", mail_sender=""),
        replace(brevo, brevo_key=""),
        replace(brevo, brevo_sender=""),
    ):
        with pytest.raises(ValueError, match="production release essentials"):
            broken.validate()
    for broken, message in (
        (replace(smtp, mail_adapter="sendgrid"), "mail_adapter"),
        (replace(smtp, smtp_security="none"), "smtp_security"),
        (replace(smtp, smtp_port=0), "smtp_port"),
    ):
        with pytest.raises(ValueError, match=message):
            broken.validate()
