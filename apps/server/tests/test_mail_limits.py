"""
Code email limits (review item S1). A domain without an organization gets no mail but the same
answer, so one address can no longer spend the day's mail budget or mail third parties, and no
limit or reply tells such a domain from one with an organization.
"""

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

import aift.service
from aift.main import create_app

EXTENSION = "chrome-extension://test-extension"


def hosted(settings, **overrides):
    """A fresh hosted service with one organization (known.org) and its own clock."""
    from test_single_address import second_company

    now = [datetime(2026, 10, 14, 9, tzinfo=UTC)]
    app = create_app(replace(settings, **overrides), initialize=True, clock=lambda: now[0])
    app.state.service.pause = lambda seconds: None
    second_company(app, domain="known.org", name="Known")
    web = TestClient(app, base_url=settings.registration_origin)
    web.headers["Origin"] = settings.registration_origin
    extension = TestClient(app, base_url=settings.registration_origin)
    extension.headers["Origin"] = EXTENSION
    return app, web, extension, now


def sign_in_code(web, email):
    return web.post(
        "/v1/auth/otp/request", json={"purpose": "login", "email": email, "dispatch_id": str(uuid4())}
    )


def connect_code(extension, email):
    return extension.post("/v1/connections/otp/request", json={"email": email, "dispatch_id": str(uuid4())})


def shape(response):
    body = response.json()
    if response.status_code != 200:
        return response.status_code, body["error"]["code"], body["error"]["safe_message"]
    return response.status_code, tuple(sorted(body)), body["delivery_state"], body["error_code"]


def test_one_network_gets_ten_codes_per_quarter_hour_and_thirty_per_day(setup):
    app, web, extension, now = hosted(setup[-1])
    replies = []
    for index in range(10):
        domain = "known.org" if index % 2 else "unknown-domain.org"
        replies.append(connect_code(extension, f"person{index}@{domain}"))
    assert {shape(reply) for reply in replies} == {shape(replies[0])}
    assert replies[0].status_code == 200
    # The eleventh is refused alike for a domain with and without an organization.
    refused = [connect_code(extension, "late@known.org"), sign_in_code(web, "late@unknown-domain.org")]
    assert {shape(reply) for reply in refused} == {(429, "otp_rate_limited", shape(refused[0])[2])}
    now[0] += timedelta(minutes=16)
    assert all(
        connect_code(extension, f"second{index}@unknown-domain.org").status_code == 200 for index in range(10)
    )
    now[0] += timedelta(minutes=16)
    assert all(connect_code(extension, f"third{index}@known.org").status_code == 200 for index in range(10))
    now[0] += timedelta(minutes=16)
    # Thirty in a day: a fresh quarter hour does not help any more.
    assert shape(connect_code(extension, "fourth@known.org"))[:2] == (429, "otp_rate_limited")
    now[0] += timedelta(days=1)
    assert connect_code(extension, "next-day@known.org").status_code == 200


def test_codes_without_an_organization_never_spend_the_shared_budget(setup, monkeypatch):
    monkeypatch.setattr(aift.service, "NETWORK_MAIL_LIMITS", ((1000, 900), (1000, 86400)))
    app, web, extension, _ = hosted(setup[-1], global_mail_daily=5, registration_mail_daily=1)
    for index in range(20):
        assert connect_code(extension, f"probe{index}@unknown-domain.org").status_code == 200
    assert app.state.mail.messages == []
    for index in range(5):
        assert connect_code(extension, f"member{index}@known.org").status_code == 200
    assert len(app.state.mail.messages) == 5
    # Once real mail has used the budget up, every request is refused alike.
    refused = [
        connect_code(extension, "member9@known.org"),
        connect_code(extension, "probe99@unknown-domain.org"),
    ]
    assert {shape(reply) for reply in refused} == {shape(refused[0])}
    assert refused[0].status_code == 429 and refused[0].json()["error"]["code"] == "otp_rate_limited"


def register_draft(app, settings, domain, email):
    client = TestClient(app, base_url=settings.registration_origin)
    client.headers["Origin"] = settings.registration_origin
    draft = client.post(
        "/v1/organizations/registrations",
        json={
            "company_name": "New " + domain,
            "website": "https://" + domain,
            "country": "DE",
            "work_domain": domain,
            "admin_email": email,
            "registrant_name": "Registrant",
            "registrant_role": "Director",
            "terms_version": "1.0.0",
            "disclosure_version": "1.0.0",
            "authority_acknowledged": True,
            "idempotency_key": str(uuid4()),
        },
    )
    assert draft.status_code == 200, draft.text
    return client, draft.json()["registration_id"]


def registration_code(client, email, registration_id):
    return client.post(
        "/v1/auth/otp/request",
        json={
            "purpose": "registration",
            "email": email,
            "registration_id": registration_id,
            "dispatch_id": str(uuid4()),
        },
    )


def test_registration_mail_has_its_own_share_and_existing_organizations_keep_the_rest(setup, monkeypatch):
    monkeypatch.setattr(aift.service, "NETWORK_MAIL_LIMITS", ((1000, 900), (1000, 86400)))
    monkeypatch.setattr(aift.service, "REGISTRATION_NETWORK_MAIL_LIMITS", ((1000, 900), (1000, 86400)))
    settings = setup[-1]
    app, web, extension, _ = hosted(settings, global_mail_daily=6, registration_mail_daily=2)
    for index in range(2):
        client, draft = register_draft(app, settings, f"new{index}.org", f"lead@new{index}.org")
        assert registration_code(client, f"lead@new{index}.org", draft).status_code == 200
    client, draft = register_draft(app, settings, "new9.org", "lead@new9.org")
    refused = registration_code(client, "lead@new9.org", draft)
    assert refused.status_code == 429 and refused.json()["error"]["code"] == "otp_rate_limited"
    # The four codes left in the day stay for people of existing organizations.
    for index in range(4):
        assert connect_code(extension, f"member{index}@known.org").status_code == 200
    assert connect_code(extension, "member9@known.org").status_code == 429


def test_registration_codes_have_tighter_network_and_domain_limits(setup, monkeypatch):
    settings = setup[-1]
    app, _, _, now = hosted(settings)
    for index in range(3):
        client, draft = register_draft(app, settings, f"fresh{index}.org", f"lead@fresh{index}.org")
        assert registration_code(client, f"lead@fresh{index}.org", draft).status_code == 200
    client, draft = register_draft(app, settings, "fresh9.org", "lead@fresh9.org")
    refused = registration_code(client, "lead@fresh9.org", draft)
    assert refused.status_code == 429 and refused.json()["error"]["code"] == "otp_rate_limited"

    monkeypatch.setattr(aift.service, "REGISTRATION_NETWORK_MAIL_LIMITS", ((1000, 900), (1000, 86400)))
    client, draft = register_draft(app, settings, "busy.org", "first@busy.org")
    for _ in range(3):
        assert registration_code(client, "first@busy.org", draft).status_code == 200
    # The draft expires after 30 minutes; a second registrant of the same domain shares its budget.
    now[0] += timedelta(minutes=31)
    client, draft = register_draft(app, settings, "busy.org", "second@busy.org")
    for _ in range(2):
        assert registration_code(client, "second@busy.org", draft).status_code == 200
    refused = registration_code(client, "second@busy.org", draft)
    assert refused.status_code == 429 and refused.json()["error"]["code"] == "otp_rate_limited"


def test_case_and_tag_variants_share_one_recipient_limit(setup, monkeypatch):
    monkeypatch.setattr(aift.service, "NETWORK_MAIL_LIMITS", ((1000, 900), (1000, 86400)))
    app, _, extension, _ = hosted(setup[-1])
    for variant in ("bob@known.org", "Bob@known.org", "bob+ai@known.org", "BOB+x@KNOWN.org", "bob@known.org"):
        assert connect_code(extension, variant).status_code == 200
    refused = connect_code(extension, "Bob+other@known.org")
    assert refused.status_code == 429 and refused.json()["error"]["code"] == "otp_rate_limited"
    # The code still goes to the address as typed.
    assert app.state.mail.messages[1]["recipient"] == "Bob@known.org"


def test_an_unsent_code_takes_as_long_and_reports_alike(setup):
    app, web, extension, _ = hosted(setup[-1])
    waits = []
    app.state.service.pause = waits.append
    for seconds in (0.31, 0.32):
        app.state.service.record_delivery(seconds, "accepted")
    assert connect_code(extension, "someone@unknown-domain.org").status_code == 200
    assert waits and waits[0] in (0.31, 0.32)
    # While real mail is failing, an unsent code reports the same failure.
    app.state.mail.fail = True
    failed = connect_code(extension, "member@known.org")
    unsent = connect_code(extension, "other@unknown-domain.org")
    assert failed.json()["delivery_state"] == "failed"
    assert shape(failed) == shape(unsent)
    assert unsent.json()["error_code"] == "email_service_unavailable"


def test_an_unsent_code_in_another_api_process_reports_the_same_outage(setup):
    # The API runs several processes (15 Oct 2026). A failed send in one must reach an unsent code
    # in any other, so the send times and outcome live in the database, not in one process.
    app, web, extension, _ = hosted(setup[-1])
    other = create_app(setup[-1], clock=app.state.service.clock)
    other.state.service.pause = lambda seconds: None
    app.state.mail.fail = True
    assert connect_code(extension, "member@known.org").json()["delivery_state"] == "failed"
    assert other.state.service.unsent_delivery() == "failed"
    # Ten minutes later an unsent code no longer copies that outage.
    now = app.state.service.clock()
    other.state.service.clock = lambda: now + timedelta(seconds=601)
    assert other.state.service.unsent_delivery() == "accepted"


def test_a_refused_action_code_says_when_the_next_one_can_be_requested(setup):
    # QA of 19 Oct 2026: the sixth action code in 15 minutes ended in the generic error, with a
    # Retry-After of 60 s whatever the limit.
    from conftest import login

    app, client, _, _, now, _ = setup
    login(app, client)

    def action_code():
        return client.post(
            "/v1/auth/otp/request",
            json={"purpose": "action_reauth", "email": "admin@example.org", "dispatch_id": str(uuid4())},
        )

    for _ in range(5):
        assert action_code().status_code == 200
        now[0] += timedelta(minutes=1)
    refused = action_code()
    assert refused.status_code == 429
    error = refused.json()["error"]
    assert error["code"] == "otp_rate_limited"
    assert error["safe_message"] != "The request could not be completed. Review the current status and try again."
    # The first code went 5 minutes ago and leaves the 15-minute window in 10 minutes.
    assert error["retry_after_seconds"] == 600
    assert refused.headers["Retry-After"] == "600"
    now[0] += timedelta(seconds=599)
    assert action_code().json()["error"]["retry_after_seconds"] == 1
    now[0] += timedelta(seconds=1)
    assert action_code().status_code == 200


def test_a_resend_too_soon_says_how_many_seconds_to_wait(setup):
    app, web, extension, now = hosted(setup[-1])
    first = sign_in_code(web, "admin@known.org").json()
    now[0] += timedelta(seconds=20)
    refused = web.post(
        "/v1/auth/otp/resend", json={"challenge_id": first["challenge_id"], "dispatch_id": str(uuid4())}
    )
    assert refused.status_code == 429
    assert refused.json()["error"]["retry_after_seconds"] == 40
    assert refused.headers["Retry-After"] == "40"


@pytest.mark.parametrize("value", [0, 250, 300])
def test_registration_share_must_stay_below_the_global_budget(setup, value):
    with pytest.raises(ValueError, match="registration mail share"):
        replace(setup[-1], registration_mail_daily=value).validate()
