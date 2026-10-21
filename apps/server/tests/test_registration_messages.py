from uuid import uuid4

from fastapi.testclient import TestClient


def registration(**changes):
    body = {
        "company_name": "New company",
        "website": "https://fresh.org",
        "country": "DE",
        "work_domain": "fresh.org",
        "admin_email": "admin@fresh.org",
        "registrant_name": "Registrant",
        "registrant_role": "Director",
        "terms_version": "1.0.0",
        "disclosure_version": "1.0.0",
        "authority_acknowledged": True,
        "idempotency_key": str(uuid4()),
    }
    return {**body, **changes}


def test_registration_refusals_say_what_to_change(setup):
    app, _, _, _, _, settings = setup
    client = TestClient(app, base_url=settings.registration_origin)
    client.headers["Origin"] = settings.registration_origin

    # A domain typed as it appears in an address used to end in the generic message (13 Oct 2026).
    response = client.post("/v1/organizations/registrations", json=registration(work_domain="@fresh.org"))
    assert response.status_code == 400
    error = response.json()["error"]
    assert error["code"] == "invalid_domain"
    assert "without @" in error["safe_message"]

    response = client.post("/v1/organizations/registrations", json=registration(admin_email="admin@gmail.com"))
    assert response.json()["error"]["code"] == "domain_review_required"
    assert "work email domain" in response.json()["error"]["safe_message"]

    # The fixture organization already holds example.org.
    response = client.post(
        "/v1/organizations/registrations",
        json=registration(work_domain="example.org", admin_email="admin@example.org"),
    )
    assert response.json()["error"]["code"] == "organization_review_required"
    assert "already registered" in response.json()["error"]["safe_message"]
