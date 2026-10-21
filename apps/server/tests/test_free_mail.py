"""Free email providers never name an organization (review item S4)."""

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from aift.free_mail import FREE_MAIL_BRANDS, FREE_MAIL_DOMAINS, is_free_mail


@pytest.mark.parametrize(
    "domain",
    [
        "gmail.com",
        "googlemail.com",
        "outlook.com",
        "hotmail.com",
        "live.com",
        "msn.com",
        "yahoo.com",
        "yahoo.de",
        "yahoo.co.uk",
        "icloud.com",
        "me.com",
        "mac.com",
        "aol.com",
        "proton.me",
        "protonmail.com",
        "gmx.de",
        "gmx.net",
        "gmx.at",
        "gmx.ch",
        "web.de",
        "t-online.de",
        "freenet.de",
        "posteo.de",
        "mailbox.org",
        "yandex.ru",
        "yandex.com.tr",
        "mail.ru",
        "zoho.com",
        "fastmail.com",
        "hey.com",
        "tutanota.com",
        "tutanota.de",
        "tuta.io",
        "hotmail.fr",
        "outlook.de",
        "pm.me",
        "GMX.DE",
    ],
)
def test_well_known_free_providers_are_recognised(domain):
    assert is_free_mail(domain)


@pytest.mark.parametrize(
    "domain",
    [
        "example.org",
        "example.com",
        "live.example.com",
        "yahoo-partner.de",
        "mygmail.com",
        "outlook.example.co.uk",
    ],
)
def test_company_domains_are_not_free_mail(domain):
    assert not is_free_mail(domain)


def test_the_list_is_plain_lower_case_data():
    assert all(domain == domain.strip().lower() and "." in domain for domain in FREE_MAIL_DOMAINS)
    assert all(brand.isalpha() and brand == brand.lower() for brand in FREE_MAIL_BRANDS)


def test_free_mail_cannot_register_an_organization(setup):
    app, _, _, _, _, settings = setup
    client = TestClient(app, base_url=settings.registration_origin)
    client.headers["Origin"] = settings.registration_origin
    refused = client.post(
        "/v1/organizations/registrations",
        json={
            "company_name": "Not a company",
            "website": "https://gmx.de",
            "country": "DE",
            "work_domain": "gmx.de",
            "admin_email": "someone@gmx.de",
            "registrant_name": "Someone",
            "registrant_role": "Owner",
            "terms_version": "1.0.0",
            "disclosure_version": "1.0.0",
            "authority_acknowledged": True,
            "idempotency_key": str(uuid4()),
        },
    )
    assert refused.status_code == 422 and refused.json()["error"]["code"] == "domain_review_required"
