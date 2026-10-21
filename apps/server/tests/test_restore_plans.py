import shutil
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

from conftest import confirmed, connect, create_connection, login, member_login, operator_confirmed
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from test_analytics import observations, upload
from test_completion import finish_job, reauth

from aift.db import Member, Observation, get, rows
from aift.main import create_app
from aift.maintenance import replay_journal, run
from aift.security import instant


def operator_client(app, settings):
    client = TestClient(app, base_url=settings.operator_origin)
    client.headers["Origin"] = settings.operator_origin
    login(app, client, "operator@example.org", operator=True)
    return client


def test_full_user_restore_replays_erasure_identity_credentials_and_exports(setup, tmp_path):
    app, admin_client, company, admin, now, settings = setup
    login(app, admin_client)
    employee = TestClient(app, base_url=company.data["origin"])
    employee.headers["Origin"] = company.data["origin"]
    member_login(app, employee, "employee@example.org")
    credentials, _ = connect(app, employee)
    request, attempt = observations(now[0])
    assert upload(employee, credentials, [request, attempt]).status_code == 200
    exported = admin_client.post(
        "/v1/admin/exports", json=confirmed(admin_client, {"period": "all", "format": "csv"})
    ).json()
    database_path = app.state.db.engine.url.database
    backup = tmp_path / "before-user-deletion.db"
    with sqlite3.connect(database_path) as source, sqlite3.connect(backup) as destination:
        source.backup(destination)
    preview = admin_client.post(
        "/v1/admin/deletions/preview", json={"scope": "user", "user_id": credentials["user_id"]}
    ).json()
    body = {
        "preview_token": preview["preview_token"],
        "idempotency_key": str(uuid4()),
        "confirmed": True,
        "reauth_token": reauth(app, company, admin),
    }
    result = admin_client.post("/v1/admin/deletions", json=body)
    assert result.status_code == 200, result.text
    finish_job(app, company, body["idempotency_key"])
    app.state.db.engine.dispose()
    shutil.copyfile(backup, database_path)
    restored = create_app(settings, clock=lambda: now[0])
    replay_journal(restored.state.service)
    with restored.state.db.transaction(readonly=True) as session:
        member = get(session, "member", credentials["user_id"], company.id)
        assert member.data["status"] == "deleted" and member.data["hmac_key"] == ""
        assert (
            session.scalar(
                select(func.count()).select_from(Observation).where(Observation.tenant == company.id)
            )
            == 0
        )
        assert get(session, "export", exported["export_id"], company.id) is None
        identities = rows(session, "email", company.id, credentials["user_id"])
        assert identities and identities[0].data["email"] == ""
        assert all(
            row.data["status"] == "deleted"
            for row in rows(session, "device", company.id, credentials["user_id"])
        )
    test_client = TestClient(restored, base_url=company.data["origin"])
    test_client.headers["Origin"] = company.data["origin"]
    assert (
        test_client.get(
            "/v1/config", headers={"Authorization": "Bearer " + credentials["access_token"]}
        ).status_code
        == 403
    )
    deletion_status = test_client.post(
        "/v1/deletions/status",
        json={
            "device_id": credentials["device_id"],
            "credential": credentials["deletion_receipt_credential"],
            "last_epoch": 0,
        },
    )
    assert (
        deletion_status.status_code == 200
        and deletion_status.json()["instruction"]["changes"][0]["scope"] == "user"
    )
    requested = test_client.post(
        "/v1/auth/otp/request",
        json={"purpose": "login", "email": "employee@example.org", "dispatch_id": str(uuid4())},
    ).json()
    verified = test_client.post(
        "/v1/auth/otp/verify",
        json={
            "challenge_id": requested["challenge_id"],
            "code": restored.state.mail.messages[-1]["code"],
            "verification_id": str(uuid4()),
        },
    )
    assert verified.status_code == 403


def test_plan_shortening_requires_preview_ack_and_longer_plan_never_restores_expired_data(setup):
    app, client, company, _, now, settings = setup
    now[0] = datetime(2026, 3, 10, 12, tzinfo=timezone.utc)
    login(app, client)
    credentials, _ = connect(app, client)
    old_request, old_attempt = observations(now[0])
    assert upload(client, credentials, [old_request, old_attempt]).status_code == 200
    now[0] = datetime(2026, 9, 10, 12, tzinfo=timezone.utc)
    login(app, client)
    operator = operator_client(app, settings)
    for name, months in (("short", 3), ("long", 12)):
        assert (
            operator.post(
                "/v1/operator/plans",
                json={
                    "plan_id": name,
                    "version": 1,
                    "member_capacity": 50,
                    "retention_months": months,
                    "idempotency_key": str(uuid4()),
                },
            ).status_code
            == 200
        )
    assignment = {
        "expected_version": 1,
        "plan_id": "short",
        "plan_version": 1,
        "effective_at": instant(now[0]),
        "reason": "Controlled retention fixture",
        "idempotency_key": str(uuid4()),
    }
    planned = operator.put(
        f"/v1/operator/organizations/{company.id}/entitlement", json=operator_confirmed(operator, assignment)
    )
    assert planned.status_code == 200 and planned.json()["status"] == "retention_transition_pending"
    plan = client.get("/v1/admin/plan").json()
    assert plan["usage_retention_months"] == 6
    transition = next(
        row for row in plan["transitions"] if row["transition_id"] == planned.json()["transition_id"]
    )
    assert (
        transition["retention_preview"]["request_count"] == "1"
        and transition["retention_preview"]["attempt_count"] == "1"
    )
    run(app.state.service)
    assert client.get("/v1/me/summary?period=all").json()["request_count"] == "1"
    ack = client.post(
        "/v1/admin/plan-transition/acknowledge",
        json=confirmed(
            client, {"transition_id": transition["transition_id"], "expected_version": 1, "confirmed": True}
        ),
    )
    assert ack.status_code == 200
    for _ in range(4):
        run(app.state.service)
    assert client.get("/v1/me/summary?period=all").json()["request_count"] == "0"
    plan = client.get("/v1/admin/plan").json()
    extension = operator.put(
        f"/v1/operator/organizations/{company.id}/entitlement",
        json=operator_confirmed(
            operator,
            {
                "expected_version": plan["version"],
                "plan_id": "long",
                "plan_version": 1,
                "effective_at": instant(now[0]),
                "reason": "Controlled longer retention",
                "idempotency_key": str(uuid4()),
            },
        ),
    )
    assert extension.status_code == 200, extension.text
    run(app.state.service)
    assert client.get("/v1/me/summary?period=all").json()["request_count"] == "0"
    renewed, _ = connect(app, client, resume=credentials)
    attempted = upload(client, renewed, [old_request])
    assert attempted.json()["results"][0]["status"] in {"retention_expired", "erased"}


def test_exception_expiry_requires_ack_preserves_existing_members_and_blocks_new_seats(setup):
    app, client, company, _, now, settings = setup
    login(app, client)
    with app.state.db.transaction() as session:
        current = get(session, "company", company.id)
        current.data = {**current.data, "capacity": 2}
    operator = operator_client(app, settings)
    result = operator.post(
        f"/v1/operator/organizations/{company.id}/exceptions",
        json=operator_confirmed(
            operator,
            {
                "expected_version": 1,
                "member_capacity": 5,
                "retention_months": 12,
                "effective_at": instant(now[0]),
                "expires_at": instant(now[0] + timedelta(seconds=20)),
                "reason": "Temporary fixture exception",
                "idempotency_key": str(uuid4()),
            },
        ),
    )
    assert result.status_code == 200, result.text
    with app.state.db.transaction() as session:
        current = get(session, "company", company.id)
        app.state.service.member(session, current, "second@example.org")
        app.state.service.member(session, current, "third@example.org")
    now[0] += timedelta(seconds=21)
    run(app.state.service)
    assert client.get("/v1/admin/plan").json()["member_capacity"] == 5
    assert operator.get("/v1/operator/health").json()["retention_transitions_requiring_action"] == 1
    assert (
        client.post(
            "/v1/admin/plan-transition/acknowledge",
            json=confirmed(
                client,
                {
                    "transition_id": result.json()["reversion_transition_id"],
                    "expected_version": 1,
                    "confirmed": True,
                },
            ),
        ).status_code
        == 200
    )
    run(app.state.service)
    plan = client.get("/v1/admin/plan").json()
    assert plan["member_capacity"] == 2 and plan["usage_retention_months"] == 6
    assert len(client.get("/v1/admin/users").json()["items"]) == 3
    # A new member joins by connecting a browser, and the seat limit applies there.
    refused, _ = create_connection(app, client, "fourth@example.org")
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "capacity_reached"


def test_concurrent_last_admin_demotions_have_one_winner(setup):
    app, first, company, first_admin, _, _ = setup
    login(app, first)
    second = TestClient(app, base_url=company.data["origin"])
    second.headers["Origin"] = company.data["origin"]
    member_login(app, second, "second@example.org")
    second_id = second.get("/v1/auth/session").json()["user_id"]
    promoted = first.put(
        f"/v1/admin/users/{second_id}/role",
        json={
            "role": "admin",
            "expected_version": 1,
            "idempotency_key": str(uuid4()),
            "reauth_token": reauth(app, company, first_admin),
        },
    )
    assert promoted.status_code == 200
    login(app, second, "second@example.org")

    codes = {
        first_admin.id: reauth(app, company, first_admin),
        second_id: reauth(app, company, SimpleNamespace(id=second_id)),
    }

    def demote(client, user, version):
        return client.put(
            f"/v1/admin/users/{user}/role",
            json={
                "role": "user",
                "expected_version": version,
                "idempotency_key": str(uuid4()),
                "reauth_token": codes[user],
            },
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = [
            executor.submit(demote, first, first_admin.id, 1),
            executor.submit(demote, second, second_id, 2),
        ]
        responses = [future.result() for future in results]
    assert sorted(r.status_code for r in responses) == [200, 409]
    assert next(r for r in responses if r.status_code == 409).json()["error"]["code"] == "last_admin"
    with app.state.db.transaction(readonly=True) as session:
        assert (
            session.scalar(
                select(func.count())
                .select_from(Member)
                .where(Member.tenant == company.id, Member.role == "admin", Member.status == "active")
            )
            == 1
        )


def test_domain_exception_admits_one_reviewed_organization_on_the_domain(setup):
    app, _, company, _, now, settings = setup
    operator = operator_client(app, settings)
    public = TestClient(app, base_url=settings.registration_origin)
    public.headers["Origin"] = settings.registration_origin

    def registration():
        return {
            "company_name": "Domain exception fixture",
            "website": "https://example.org",
            "country": "DE",
            "work_domain": "example.org",
            "admin_email": "second-admin@example.org",
            "registrant_name": "Fixture",
            "registrant_role": "Reviewer",
            "terms_version": "1.0.0",
            "disclosure_version": "1.0.0",
            "authority_acknowledged": True,
            "idempotency_key": str(uuid4()),
        }

    assert public.post("/v1/organizations/registrations", json=registration()).status_code == 409
    approval = operator.post(
        "/v1/operator/domain-claims",
        json=operator_confirmed(
            operator,
            {
                "domain": "EXAMPLE.ORG",
                "expected_version": 0,
                "reason": "Separate reviewed legal organization",
                "expires_at": instant(now[0] + timedelta(hours=1)),
                "idempotency_key": str(uuid4()),
            },
        ),
    )
    assert approval.status_code == 200, approval.text
    assert approval.json()["reviewer_id"] and approval.json()["version"] == 1
    assert approval.json()["domain"] == "example.org"
    target = public.post("/v1/organizations/registrations", json=registration())
    assert target.status_code == 200, target.text
    challenge = public.post(
        "/v1/auth/otp/request",
        json={
            "purpose": "registration",
            "email": "second-admin@example.org",
            "registration_id": target.json()["registration_id"],
            "dispatch_id": str(uuid4()),
        },
    ).json()
    verified = public.post(
        "/v1/auth/otp/verify",
        json={
            "challenge_id": challenge["challenge_id"],
            "code": app.state.mail.messages[-1]["code"],
            "verification_id": str(uuid4()),
        },
    )
    assert verified.status_code == 200, verified.text
    claims = operator.get("/v1/operator/domain-claims").json()["items"]
    assert claims[0]["status"] == "consumed" and claims[0]["company_id"] != company.id
    # A consumed exception admits nobody else on the domain.
    assert public.post("/v1/organizations/registrations", json=registration()).status_code == 409
    assert any(
        row["action"] == "domain_exception_approved"
        for row in operator.get("/v1/operator/audit").json()["items"]
    )
