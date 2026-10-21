"""Contact requests: the website's Contact page and the developer panel's inbox."""

from uuid import uuid4

from conftest import login, operator_confirmed
from fastapi.testclient import TestClient

from aift.db import rows


def website(app, settings):
    client = TestClient(app, base_url=settings.registration_origin)
    client.headers["Origin"] = settings.registration_origin
    return client


def developer(app, settings):
    client = TestClient(app, base_url=settings.operator_origin)
    client.headers["Origin"] = settings.operator_origin
    login(app, client, "operator@example.org", operator=True)
    return client


def message(**changes):
    return {
        "topic": "larger_organization",
        "name": "Mara Klein",
        "email": "mara.klein@example.org",
        "organization": "Example Consulting",
        "people": "101-250",
        "message": "We are 140 people and would like the larger plan.",
        "website": "",
        "idempotency_key": str(uuid4()),
        **changes,
    }


def test_contact_request_is_stored_encrypted_and_read_in_the_developer_inbox(setup):
    app, _, _, _, now, settings = setup
    body = message()
    sent = website(app, settings).post("/v1/public/contact", json=body)
    assert sent.status_code == 200, sent.text
    assert sent.json() == {"received": True}
    # A lost reply sent again keeps one message.
    assert website(app, settings).post("/v1/public/contact", json=body).json() == {"received": True}
    with app.state.db.transaction() as s:
        stored = rows(s, "contact")
        assert len(stored) == 1
        # Personal details are encrypted at rest; only the topic and states are readable.
        assert "Mara" not in str(stored[0].data) and "example.org" not in str(stored[0].data)
    inbox = developer(app, settings)
    listed = inbox.get("/v1/operator/contacts")
    assert listed.status_code == 200, listed.text
    item = listed.json()["items"][0]
    assert {
        k: item[k] for k in ("topic", "status", "name", "email", "organization", "people", "message")
    } == {
        "topic": "larger_organization",
        "status": "new",
        "name": "Mara Klein",
        "email": "mara.klein@example.org",
        "organization": "Example Consulting",
        "people": "101-250",
        "message": "We are 140 people and would like the larger plan.",
    }
    assert listed.json()["counts"] == {"new": 1, "replied": 0, "closed": 0}
    replied = inbox.post(f"/v1/operator/contacts/{item['id']}", json={"status": "replied"})
    assert replied.status_code == 200 and replied.json()["status"] == "replied"
    assert inbox.get("/v1/operator/contacts", params={"status": "new"}).json()["items"] == []
    assert len(inbox.get("/v1/operator/contacts", params={"status": "replied"}).json()["items"]) == 1
    assert inbox.get("/v1/operator/contacts", params={"status": "spam"}).status_code == 422
    assert inbox.post(f"/v1/operator/contacts/{item['id']}", json={"status": "deleted"}).status_code == 422
    path = f"/v1/operator/contacts/{item['id']}"
    deletion = operator_confirmed(inbox, {"idempotency_key": str(uuid4())})
    deleted = inbox.request("DELETE", path, json=deletion)
    assert deleted.status_code == 200 and deleted.json() == {"deleted": True}
    # A retry of the same deletion replays its answer.
    assert inbox.request("DELETE", path, json=deletion).json() == {"deleted": True}
    assert inbox.get("/v1/operator/contacts").json()["items"] == []
    assert inbox.delete(f"/v1/operator/contacts/{item['id']}").status_code == 404
    with app.state.db.transaction() as s:
        actions = [row.data.get("action") for row in rows(s, "audit")]
        assert "contact_request_status" in actions and "contact_request_deleted" in actions
        # The audit trail names the request, never its sender.
        assert not any("Mara" in str(row.data) for row in rows(s, "audit"))


def test_contact_rejects_other_origins_bots_and_floods(setup):
    app, client, _, _, _, settings = setup
    # An organization site or the developer panel cannot send website messages.
    assert client.post("/v1/public/contact", json=message()).status_code == 403
    # A filled hidden field looks accepted but keeps nothing.
    assert website(app, settings).post(
        "/v1/public/contact", json=message(website="https://spam.example")
    ).json() == {"received": True}
    with app.state.db.transaction() as s:
        assert rows(s, "contact") == []
    assert (
        website(app, settings).post("/v1/public/contact", json=message(email="no-at-sign")).status_code == 400
    )
    assert website(app, settings).post("/v1/public/contact", json=message(message="")).status_code == 422
    assert website(app, settings).post("/v1/public/contact", json=message(topic="sales")).status_code == 422
    sender = website(app, settings)
    for _ in range(5):
        assert sender.post("/v1/public/contact", json=message()).status_code == 200
    assert sender.post("/v1/public/contact", json=message()).status_code == 429


def test_contact_inbox_needs_a_developer_sign_in(setup):
    app, client, _, _, _, settings = setup
    login(app, client)
    # An organization administrator cannot read the inbox.
    assert client.get("/v1/operator/contacts").status_code in {401, 403, 404}
    anonymous = TestClient(app, base_url=settings.operator_origin)
    anonymous.headers["Origin"] = settings.operator_origin
    assert anonymous.get("/v1/operator/contacts").status_code in {401, 403}
