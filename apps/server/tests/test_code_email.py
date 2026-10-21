import re
from types import SimpleNamespace
from uuid import uuid4

import pytest

from aift import mail
from aift.mail import PURPOSES, BrevoMail, code_email


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
    settings = SimpleNamespace(
        mail_privacy_verified=True, mail_html_verified=False, brevo_key="key", brevo_sender="no-reply@example.org"
    )
    # Until a delivered HTML message is checked for tracking, only the plain text goes out.
    BrevoMail(settings).send("member@example.org", "123456", "connect")
    assert "htmlContent" not in sent and "123456" in sent["textContent"]
    sent.clear()
    settings.mail_html_verified = True
    assert BrevoMail(settings).send("member@example.org", "123456", "connect") == "accepted"
    assert sent["subject"] == PURPOSES["connect"][0]
    assert ">123456</div>" in sent["htmlContent"] and "123 456" not in sent["htmlContent"]
    assert "123456" in sent["textContent"]
    assert sent["to"] == [{"email": "member@example.org", "contactPixelTrackingConsent": False}]


def test_the_code_email_names_what_the_code_is_for(setup):
    app, client, _, _, _, _ = setup
    response = client.post(
        "/v1/auth/otp/request",
        json={"purpose": "login", "email": "admin@example.org", "dispatch_id": str(uuid4()), "registration_id": None},
    )
    assert response.status_code == 200, response.text
    assert app.state.mail.messages[-1]["purpose"] == "login"
