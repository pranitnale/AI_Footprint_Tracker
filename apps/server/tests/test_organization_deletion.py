"""
Ending an organization (review item L2): the Terms and the DPA promise deletion of its data within
30 days. An administrator requests it, it stops at once, can be cancelled for 7 days, and the worker
then deletes every row of the organization except one pseudonymous deletion record.
"""

import shutil
from dataclasses import replace
from datetime import timedelta
from uuid import uuid4

from conftest import connect, register
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from test_analytics import observations, upload
from test_completion import reauth

import aift.organization_deletion as deletion
from aift.db import TABLES, Base, get, rows
from aift.main import create_app
from aift.maintenance import replay_journal, run

EXTENSION = "chrome-extension://test-extension"


def organization(setup):
    """A hosted organization made by registration, with an administrator and a member who synced."""
    app, _, _, _, now, settings = setup
    web, verified, _ = register(
        app, settings, domain="ending.org", email="admin@ending.org", name="Ending GmbH"
    )
    web.headers["X-CSRF-Token"] = verified.json()["csrf_token"]
    extension = TestClient(app, base_url=settings.registration_origin)
    extension.headers["Origin"] = EXTENSION
    credentials, _ = connect(app, extension, "member@ending.org")
    assert upload(extension, credentials, observations(now[0])).status_code == 200
    with app.state.db.transaction(readonly=True) as session:
        company = get(session, "company", credentials["company_id"])
        admin = next(m for m in rows(session, "member", company.id) if m.data["role"] == "admin")
    return app, web, extension, credentials, company, admin, now, settings


def request_deletion(app, web, company, admin, name="ending gmbh "):
    return web.post(
        "/v1/admin/organization/deletion",
        json={"reauth_token": reauth(app, company, admin), "confirm_name": name},
    )


def tenant_rows(app, company_id):
    """Rows left for the organization in every table that belongs to an organization."""
    left = {}
    with app.state.db.transaction(readonly=True) as session:
        for table in Base.metadata.sorted_tables:
            if "tenant" in table.c:
                count = session.scalar(
                    select(func.count()).select_from(table).where(table.c.tenant == company_id)
                )
                if count:
                    left[table.name] = count
        if session.get(TABLES["company"], company_id):
            left["companies"] = 1
    return left


def test_a_request_needs_the_name_and_a_fresh_code_and_stops_the_organization(setup):
    app, web, extension, credentials, company, admin, now, _ = organization(setup)
    wrong = request_deletion(app, web, company, admin, name="Another name")
    assert wrong.status_code == 422 and wrong.json()["error"]["code"] == "confirmation_mismatch"
    unproven = web.post(
        "/v1/admin/organization/deletion", json={"reauth_token": "z" * 43, "confirm_name": "Ending GmbH"}
    )
    assert unproven.status_code == 403 and unproven.json()["error"]["code"] == "reauthentication_required"
    requested = request_deletion(app, web, company, admin)
    assert requested.status_code == 200, requested.text
    state = requested.json()
    assert state["status"] == "scheduled" and state["grace_days"] == 7
    assert state["delete_after"] == app.state.service.expires(7 * 86400)
    # Members' browsers stop syncing; the dashboard offers only the cancellation.
    synced = upload(extension, credentials, observations(now[0]))
    assert synced.status_code == 403 and synced.json()["error"]["code"] == "service_suspended"
    assert web.get("/v1/admin/users").json()["error"]["code"] == "service_suspended"
    assert web.get("/v1/auth/session").json()["organization_status"] == "deletion_scheduled"
    assert web.get("/v1/admin/organization/deletion").json()["status"] == "scheduled"


def test_administrators_can_sign_in_and_cancel_during_the_grace_period(setup):
    app, web, extension, credentials, company, admin, now, settings = organization(setup)
    assert request_deletion(app, web, company, admin).status_code == 200
    from test_single_address import web_code

    now[0] += timedelta(days=6)
    run(app.state.service)
    fresh = TestClient(app, base_url=settings.registration_origin)
    fresh.headers["Origin"] = settings.registration_origin
    signed_in = web_code(app, fresh, "admin@ending.org")
    assert signed_in.status_code == 200, signed_in.text
    fresh.headers["X-CSRF-Token"] = signed_in.json()["csrf_token"]
    assert fresh.get("/v1/auth/session").json()["organization_status"] == "deletion_scheduled"
    cancelled = fresh.delete("/v1/admin/organization/deletion")
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "none"
    now[0] += timedelta(days=2)
    run(app.state.service)
    assert tenant_rows(app, company.id).get("memberships") == 2
    renewed = extension.post(
        "/v1/auth/refresh", json={"refresh_token": credentials["refresh_token"], "operation_id": str(uuid4())}
    )
    assert renewed.status_code == 200, renewed.text
    assert upload(extension, renewed.json(), observations(now[0])).status_code == 200


def test_after_the_grace_period_nothing_of_the_organization_is_left(setup, monkeypatch):
    app, web, extension, credentials, company, admin, now, settings = organization(setup)
    assert request_deletion(app, web, company, admin).status_code == 200
    before = tenant_rows(app, company.id)
    assert before["canonical_observations"] and before["memberships"] == 2
    backup = settings.database_url.removeprefix("sqlite:///") + ".backup"
    shutil.copyfile(settings.database_url.removeprefix("sqlite:///"), backup)
    now[0] += timedelta(days=6, hours=23)
    run(app.state.service)
    # Not before the grace period ends.
    assert tenant_rows(app, company.id)["memberships"] == 2
    now[0] += timedelta(hours=2)
    # Small pages show the deletion resumes across worker ticks.
    monkeypatch.setattr(deletion, "PURGE_PAGE", 7)
    for _ in range(300):
        run(app.state.service)
        if not tenant_rows(app, company.id):
            break
    assert tenant_rows(app, company.id) == {}
    with app.state.db.transaction(readonly=True) as session:
        drafts = [row for row in rows(session, "registration") if row.data.get("company") == company.id]
        assert drafts == []
        records = [row for row in rows(session, "audit", "") if row.data["target"] == company.id]
        assert [record.data["action"] for record in records] == ["organization_deleted"]
        assert set(records[0].data["details"]) == {"requested_at", "deleted_at"}
        assert "Ending" not in str(records[0].data) and "ending.org" not in str(records[0].data)
    # Every former credential now finds no organization.
    gone = upload(extension, credentials, observations(now[0]))
    assert gone.status_code == 401
    # A backup taken during the grace period does not bring the organization back.
    restored_settings = replace(settings, database_url="sqlite:///" + backup)
    restored = create_app(restored_settings, clock=lambda: now[0])
    restored.state.service.pause = lambda seconds: None
    replay_journal(restored.state.service)
    assert tenant_rows(restored, company.id) == {}
