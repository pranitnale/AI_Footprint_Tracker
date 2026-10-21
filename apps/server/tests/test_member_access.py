"""
Administrators remove one browser or suspend a member without erasing data (review item S3).
Refresh tokens last ten years, so this is how a lost or copied browser profile is cut off.
"""

from uuid import uuid4

from conftest import PERSON_ANALYTICS, connect, login
from fastapi.testclient import TestClient
from test_analytics import observations, upload
from test_completion import reauth

from aift.db import Observation, get, rows

EXTENSION = "chrome-extension://test-extension"


def extension_client(app, client):
    extension = TestClient(app, base_url=str(client.base_url).rstrip("/"))
    extension.headers["Origin"] = EXTENSION
    return extension


def config(extension, credentials):
    return extension.get("/v1/config", headers={"Authorization": "Bearer " + credentials["access_token"]})


def refresh(extension, credentials):
    return extension.post(
        "/v1/auth/refresh", json={"refresh_token": credentials["refresh_token"], "operation_id": str(uuid4())}
    )


@PERSON_ANALYTICS
def test_administrators_list_a_members_browsers_without_ip_addresses(setup):
    app, client, company, admin, now, _ = setup
    extension = extension_client(app, client)
    laptop, _ = connect(app, extension, "member@example.org")
    desktop, _ = connect(app, extension, "member@example.org")
    login(app, client)
    listed = client.get(f"/v1/admin/users/{laptop['user_id']}/devices")
    assert listed.status_code == 200, listed.text
    items = listed.json()["items"]
    assert {item["device_id"] for item in items} == {laptop["device_id"], desktop["device_id"]}
    assert all(
        set(item) == {"device_id", "browser_family", "status", "first_seen_at", "last_seen_at"}
        for item in items
    )
    assert "ip" not in listed.text.lower()
    assert client.get(f"/v1/admin/users/{uuid4()}/devices").status_code == 404


def test_removing_a_browser_signs_it_out_at_once_and_keeps_the_others(setup):
    app, client, company, admin, _, _ = setup
    extension = extension_client(app, client)
    laptop, _ = connect(app, extension, "member@example.org")
    desktop, _ = connect(app, extension, "member@example.org")
    login(app, client)
    path = f"/v1/admin/users/{laptop['user_id']}/devices/{laptop['device_id']}/revoke"
    refused = client.post(path, json={"reauth_token": "x" * 43})
    assert refused.status_code == 403 and refused.json()["error"]["code"] == "reauthentication_required"
    assert config(extension, laptop).status_code == 200
    removed = client.post(path, json={"reauth_token": reauth(app, company, admin)})
    assert removed.status_code == 200 and removed.json() == {
        "device_id": laptop["device_id"],
        "status": "revoked",
    }
    # The browser's own tokens now get the answer that makes the extension disconnect cleanly.
    for answer in (config(extension, laptop), refresh(extension, laptop)):
        assert answer.status_code == 403 and answer.json()["error"]["code"] == "enrollment_revoked"
    assert config(extension, desktop).status_code == 200
    with app.state.db.transaction(readonly=True) as session:
        for row in rows(session, "refresh", company.id):
            if row.data["device"] == laptop["device_id"]:
                # Kept no longer than a replaced token, not for ten years.
                assert row.data["expires"] <= app.state.service.expires(30 * 86400)
        assert any(event.data["action"] == "browser_removed" for event in rows(session, "audit", company.id))
    # The person proves themselves again with an email code and connects as a new browser.
    again, _ = connect(app, extension, "member@example.org", resume=laptop)
    assert again["user_id"] == laptop["user_id"] and again["device_id"] != laptop["device_id"]


def test_suspending_a_member_blocks_connecting_and_syncing_and_keeps_data(setup):
    app, client, company, admin, now, _ = setup
    extension = extension_client(app, client)
    credentials, _ = connect(app, extension, "member@example.org")
    assert upload(extension, credentials, observations(now[0])).status_code == 200
    login(app, client)
    users = {item["user_id"]: item for item in client.get("/v1/admin/users").json()["items"]}
    target = users[credentials["user_id"]]
    path = f"/v1/admin/users/{credentials['user_id']}/status"
    stale = client.put(
        path,
        json={
            "status": "suspended",
            "expected_version": target["membership_version"] + 1,
            "reauth_token": reauth(app, company, admin),
        },
    )
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "stale_version"
    suspended = client.put(
        path,
        json={
            "status": "suspended",
            "expected_version": target["membership_version"],
            "reauth_token": reauth(app, company, admin),
        },
    )
    assert suspended.status_code == 200, suspended.text
    assert suspended.json()["status"] == "suspended"
    for answer in (config(extension, credentials), refresh(extension, credentials)):
        assert answer.status_code == 403 and answer.json()["error"]["code"] == "enrollment_revoked"
    from conftest import create_connection

    blocked, _ = create_connection(app, extension, "member@example.org")
    assert blocked.status_code == 403 and blocked.json()["error"]["code"] == "member_unavailable"
    with app.state.db.transaction(readonly=True) as session:
        assert session.query(Observation).filter(Observation.owner == credentials["user_id"]).count() > 0
    listed = client.get("/v1/admin/users", params={"status": "suspended"}).json()["items"]
    assert [item["user_id"] for item in listed] == [credentials["user_id"]]
    reactivated = client.put(
        path,
        json={
            "status": "active",
            "expected_version": suspended.json()["membership_version"],
            "reauth_token": reauth(app, company, admin),
        },
    )
    assert reactivated.status_code == 200 and reactivated.json()["status"] == "active"
    again, _ = connect(app, extension, "member@example.org", resume=credentials)
    assert again["user_id"] == credentials["user_id"] and again["device_id"] == credentials["device_id"]


def test_administrators_cannot_suspend_themselves_and_need_a_fresh_code(setup):
    app, client, company, admin, _, _ = setup
    login(app, client)
    path = f"/v1/admin/users/{admin.id}/status"
    own = client.put(
        path, json={"status": "suspended", "expected_version": 1, "reauth_token": reauth(app, company, admin)}
    )
    assert own.status_code == 409 and own.json()["error"]["code"] == "self_action"
    extension = extension_client(app, client)
    credentials, _ = connect(app, extension, "member@example.org")
    unproven = client.put(
        f"/v1/admin/users/{credentials['user_id']}/status",
        json={"status": "suspended", "expected_version": 1, "reauth_token": "y" * 43},
    )
    assert unproven.status_code == 403 and unproven.json()["error"]["code"] == "reauthentication_required"
    with app.state.db.transaction(readonly=True) as session:
        assert get(session, "member", credentials["user_id"], company.id).data["status"] == "active"


def test_administrators_list_a_members_browsers_without_last_use(setup):
    app, client, company, admin, now, _ = setup
    extension = extension_client(app, client)
    laptop, _ = connect(app, extension, "member@example.org")
    desktop, _ = connect(app, extension, "member@example.org")
    login(app, client)
    listed = client.get(f"/v1/admin/users/{laptop['user_id']}/devices")
    assert listed.status_code == 200, listed.text
    items = listed.json()["items"]
    assert {item["device_id"] for item in items} == {laptop["device_id"], desktop["device_id"]}
    assert all(
        # Connected since, never when the browser was last used (owner decision of 18 October 2026).
        set(item) == {"device_id", "browser_family", "status", "first_seen_at"}
        for item in items
    )
    assert "ip" not in listed.text.lower()
    assert client.get(f"/v1/admin/users/{uuid4()}/devices").status_code == 404
