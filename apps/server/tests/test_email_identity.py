"""
One person, one member (review item S2): case and "+tag" variants of a work address name the same
member, seat, code limits and erasure. Codes still go to the address as typed.
"""

import json
import os
import subprocess
import sys
from dataclasses import asdict
from pathlib import Path
from uuid import uuid4

import pytest
from conftest import connect, login
from fastapi.testclient import TestClient

from aift.db import Database, get, put, rows
from aift.security import Problem, Secrets, email_identity, normalize_email

EXTENSION = "chrome-extension://test-extension"


def test_identity_ignores_case_and_tags_but_delivery_keeps_the_typed_address():
    assert email_identity(" Bob.Smith+AI@Example.ORG ") == "bob.smith@example.org"
    assert email_identity("bob@example.org") == email_identity("BOB+x+y@example.org")
    assert normalize_email("Bob+ai@EXAMPLE.org") == "Bob+ai@example.org"
    with pytest.raises(Problem):
        email_identity("+tag@example.org")


def test_case_and_tag_variants_connect_as_one_member_with_one_seat(setup):
    app, client, company, _, _, settings = setup
    extension = TestClient(app, base_url=str(client.base_url).rstrip("/"))
    extension.headers["Origin"] = EXTENSION
    first, _ = connect(app, extension, "bob@example.org")
    second, _ = connect(app, extension, "bob+laptop@example.org")
    third, _ = connect(app, extension, "Bob@example.org")
    assert first["user_id"] == second["user_id"] == third["user_id"]
    # A variant may be a separate mailbox on some mail servers, so the code goes only to the
    # address the member is stored with, never to the variant.
    assert [message["recipient"] for message in app.state.mail.messages[-3:]] == [
        "bob@example.org",
        "bob@example.org",
        "bob@example.org",
    ]
    with app.state.db.transaction(readonly=True) as session:
        assert len([m for m in rows(session, "member", company.id) if m.data["role"] == "user"]) == 1


def test_an_erased_member_cannot_rejoin_with_a_variant(setup):
    app, client, company, _, _, _ = setup
    extension = TestClient(app, base_url=str(client.base_url).rstrip("/"))
    extension.headers["Origin"] = EXTENSION
    credentials, _ = connect(app, extension, "carol@example.org")
    with app.state.db.transaction() as session:
        member = get(session, "member", credentials["user_id"], company.id)
        member.data = {**member.data, "status": "deleted"}
    from conftest import create_connection

    for variant in ("Carol@example.org", "carol+again@example.org"):
        refused, _ = create_connection(app, extension, variant)
        assert refused.status_code == 403 and refused.json()["error"]["code"] == "member_unavailable"


def test_an_erased_member_keyed_before_identities_still_blocks_the_same_address(setup):
    app, client, company, _, _, _ = setup
    service = app.state.service
    member_id = str(uuid4())
    with app.state.db.transaction() as session:
        put(
            session,
            "member",
            member_id,
            {
                "status": "deleted",
                "role": "user",
                "version": 2,
                "created_at": "2026-09-01T00:00:00.000Z",
                "hmac_key": "",
            },
            company.id,
            member_id,
        )
        # An erased row has no address left, so migration 0014 cannot move it off its old key.
        put(
            session,
            "email",
            service.secrets.keyed("email:" + company.id, "Dora@example.org"),
            {"email": ""},
            company.id,
            member_id,
        )
    extension = TestClient(app, base_url=str(client.base_url).rstrip("/"))
    extension.headers["Origin"] = EXTENSION
    from conftest import create_connection

    refused, _ = create_connection(app, extension, "Dora@example.org")
    assert refused.status_code == 403 and refused.json()["error"]["code"] == "member_unavailable"


def test_website_sign_in_and_reauthentication_accept_variants(setup):
    app, client, _, admin, _, _ = setup
    signed_in = login(app, client, "Admin+web@Example.org")
    assert signed_in["role"] == "admin"
    reauth = client.post(
        "/v1/auth/otp/request",
        json={"purpose": "action_reauth", "email": "ADMIN@example.org", "dispatch_id": str(uuid4())},
    )
    assert reauth.status_code == 200, reauth.text


def test_developer_sign_in_ignores_case_only_and_mails_the_configured_address(setup):
    app, _, _, _, _, settings = setup
    operator = TestClient(app, base_url=settings.operator_origin)
    operator.headers["Origin"] = settings.operator_origin
    tagged = operator.post(
        "/v1/operator/auth/otp/request",
        json={
            "purpose": "operator_login",
            "email": "operator+x@example.org",
            "dispatch_id": str(uuid4()),
            "registration_id": None,
        },
    )
    assert tagged.status_code == 403 and tagged.json()["error"]["code"] == "identity_unavailable"
    assert app.state.mail.messages == []
    login(app, operator, "Operator@Example.org", operator=True)
    assert app.state.mail.messages[-1]["recipient"] == "operator@example.org"
    session = operator.get("/v1/operator/auth/session")
    assert session.status_code == 200 and session.json()["email"] == "operator@example.org"


def test_codes_for_an_existing_member_go_to_the_stored_address_in_every_flow(setup):
    app, client, company, _, _, settings = setup
    from test_single_address import second_company

    _, lead = second_company(app, domain="corp.org", name="Corp", admin="bob")
    web = TestClient(app, base_url=settings.registration_origin)
    web.headers["Origin"] = settings.registration_origin
    extension = TestClient(app, base_url=settings.registration_origin)
    extension.headers["Origin"] = EXTENSION
    for variant in ("bob+x@corp.org", "Bob@corp.org", "BOB+other@CORP.org"):
        signed = web.post(
            "/v1/auth/otp/request", json={"purpose": "login", "email": variant, "dispatch_id": str(uuid4())}
        )
        assert signed.status_code == 200
        assert app.state.mail.messages[-1]["recipient"] == "bob@corp.org"
    connected = extension.post(
        "/v1/connections/otp/request", json={"email": "bob+laptop@corp.org", "dispatch_id": str(uuid4())}
    )
    assert connected.status_code == 200
    assert app.state.mail.messages[-1]["recipient"] == "bob@corp.org"
    # Re-authentication for an erasure or another action goes there too.
    login(app, client, "admin+web@example.org")
    assert app.state.mail.messages[-1]["recipient"] == "admin@example.org"
    reauth = client.post(
        "/v1/auth/otp/request",
        json={"purpose": "action_reauth", "email": "Admin+erase@example.org", "dispatch_id": str(uuid4())},
    )
    assert reauth.status_code == 200
    assert app.state.mail.messages[-1]["recipient"] == "admin@example.org"


def test_a_new_member_is_mailed_and_stored_at_the_typed_address(setup):
    app, client, company, _, _, _ = setup
    extension = TestClient(app, base_url=str(client.base_url).rstrip("/"))
    extension.headers["Origin"] = EXTENSION
    credentials, _ = connect(app, extension, "New.Person+ai@example.org")
    assert app.state.mail.messages[-1]["recipient"] == "New.Person+ai@example.org"
    with app.state.db.transaction(readonly=True) as session:
        record = app.state.service.email_record(session, company, "new.person@example.org")
        assert record.owner == credentials["user_id"]
        assert app.state.service.secrets.decrypt(record.data["email"]) == "New.Person+ai@example.org"


def migrate(settings_file, target):
    return subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", target],
        cwd=Path(__file__).resolve().parents[1],
        env={**os.environ, "AIFT_SETTINGS_FILE": str(settings_file)},
        capture_output=True,
        text=True,
    )


def legacy_world(setup, tmp_path, people):
    """A database at revision 0013 whose email rows are keyed by the exact address, as before 0014."""
    from dataclasses import replace

    settings = replace(setup[-1], database_url="sqlite:///" + (tmp_path / "legacy.db").as_posix())
    settings_file = tmp_path / "legacy-settings.json"
    settings_file.write_text(json.dumps(asdict(settings)))
    assert migrate(settings_file, "0013").returncode == 0
    secrets = Secrets(settings)
    database = Database(settings)
    company_id = str(uuid4())
    ids = {}
    with database.transaction() as session:
        put(
            session,
            "company",
            company_id,
            {
                "name": "Legacy",
                "slug": "legacy",
                "domain": "legacy.org",
                "origin": "https://legacy.example",
                "status": "active",
            },
        )
        for index, (address, status) in enumerate(people):
            member_id = str(uuid4())
            ids[address] = member_id
            put(
                session,
                "member",
                member_id,
                {
                    "status": status,
                    "role": "user",
                    "version": 1,
                    "created_at": f"2026-09-0{index + 1}T00:00:00.000Z",
                },
                company_id,
                member_id,
            )
            put(
                session,
                "email",
                secrets.keyed("email:" + company_id, address),
                {"email": secrets.encrypt(address)},
                company_id,
                member_id,
            )
    database.engine.dispose()
    return settings, settings_file, secrets, company_id, ids


def owner_of(settings, secrets, company_id, address):
    database = Database(settings)
    with database.transaction(readonly=True) as session:
        row = get(session, "email", secrets.keyed("email:" + company_id, email_identity(address)), company_id)
        owner = row.owner if row else None
    database.engine.dispose()
    return owner


def test_migration_0014_moves_identities_and_merges_only_safe_duplicates(setup, tmp_path):
    settings, settings_file, secrets, company_id, ids = legacy_world(
        setup,
        tmp_path,
        [
            ("Bob@legacy.org", "active"),
            ("carol+ai@legacy.org", "active"),
            ("Eve@legacy.org", "active"),
            ("eve@legacy.org", "suspended"),
            ("Finn@legacy.org", "suspended"),
            ("finn+old@legacy.org", "suspended"),
        ],
    )
    migrated = migrate(settings_file, "head")
    assert migrated.returncode == 0, migrated.stderr
    assert owner_of(settings, secrets, company_id, "bob@legacy.org") == ids["Bob@legacy.org"]
    assert owner_of(settings, secrets, company_id, "Carol@legacy.org") == ids["carol+ai@legacy.org"]
    # The only active member of a shared identity takes it; the suspended duplicate keeps its data.
    assert owner_of(settings, secrets, company_id, "eve@legacy.org") == ids["Eve@legacy.org"]
    # Without an active one, the earliest member takes it.
    assert owner_of(settings, secrets, company_id, "finn@legacy.org") == ids["Finn@legacy.org"]
    database = Database(settings)
    with database.transaction(readonly=True) as session:
        assert len(rows(session, "email", company_id)) == 6
        assert len(rows(session, "member", company_id)) == 6
    database.engine.dispose()


def test_migration_0014_stops_with_a_report_when_two_active_members_share_an_identity(setup, tmp_path):
    settings, settings_file, secrets, company_id, ids = legacy_world(
        setup, tmp_path, [("Gus@legacy.org", "active"), ("gus+2@legacy.org", "active")]
    )
    migrated = migrate(settings_file, "head")
    assert migrated.returncode != 0
    assert "Migration 0014 stopped without changes" in migrated.stderr
    assert ids["Gus@legacy.org"] in migrated.stderr and ids["gus+2@legacy.org"] in migrated.stderr
    # The report names members by their pseudonymous ids, never by address.
    assert "@legacy.org" not in migrated.stderr
    assert owner_of(settings, secrets, company_id, "Gus@legacy.org") is None
