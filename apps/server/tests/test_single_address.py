"""
One hosted address for every organization (owner decision, 13 Oct 2026). Administrators sign in at
the service address; members connect from the extension with an email code, and the server finds
their organization by the work email domain only after the code is verified.
"""

from uuid import uuid4

from conftest import confirmed, connect, create_connection, login, register
from fastapi.testclient import TestClient
from test_analytics import observations, upload

from aift.db import TABLES, get, put, rows
from aift.security import digest, token

EXTENSION = "chrome-extension://test-extension"


def service_clients(app, settings):
    """The website and the extension, both talking to the one hosted address."""
    web = TestClient(app, base_url=settings.registration_origin)
    web.headers["Origin"] = settings.registration_origin
    extension = TestClient(app, base_url=settings.registration_origin)
    extension.headers["Origin"] = EXTENSION
    return web, extension


def second_company(app, domain="second.org", name="Second", admin="admin"):
    """A hosted organization made as registration makes them: an internal key nobody is served at."""
    company_id = str(uuid4())
    internal = company_id.replace("-", "")
    with app.state.db.transaction() as session:
        company = put(
            session,
            "company",
            company_id,
            {
                "name": name,
                "slug": internal,
                "domain": domain,
                "origin": "https://" + internal + ".aifootprinttracker.com",
                "status": "active",
                "timezone": "UTC",
                "pause_mode": "user_controlled",
                "company_sharing": "threshold",
                "capacity": 50,
                "retention_months": None,
                "policy_version": "1.0.0",
                "epoch": 0,
                "version": 1,
                "plan_id": "free",
                "plan_version": 1,
            },
        )
        admin = app.state.service.member(session, company, admin + "@" + domain, True)
    return company, admin


def web_code(app, client, email):
    """Requests and verifies a website sign-in code; returns the verify response."""
    requested = client.post(
        "/v1/auth/otp/request",
        json={"purpose": "login", "email": email, "dispatch_id": str(uuid4())},
    )
    assert requested.status_code == 200, requested.text
    return client.post(
        "/v1/auth/otp/verify",
        json={
            "challenge_id": requested.json()["challenge_id"],
            "code": app.state.mail.messages[-1]["code"],
            "verification_id": str(uuid4()),
        },
    )


def bearer(credentials):
    return {"Authorization": "Bearer " + credentials["access_token"]}


def members(app, company):
    with app.state.db.transaction(readonly=True) as session:
        return rows(session, "member", company.id)


def test_two_organizations_at_one_address_each_credential_reaches_only_its_own(setup, monkeypatch):
    app, _, company, _, now, settings = setup
    other, _ = second_company(app)
    web, extension = service_clients(app, settings)
    first, first_exchange = connect(app, extension, "member@example.org")
    second, _ = connect(app, extension, "member@second.org")
    assert first["company_id"] == company.id and first["company_name"] == "Example"
    assert second["company_id"] == other.id and second["company_name"] == "Second"
    request, attempt = observations(now[0])
    assert upload(extension, first, [request, attempt]).status_code == 200

    scopes = []
    original = app.state.db.transaction

    def recording(scope="registration", readonly=False):
        scopes.append((scope, readonly))
        return original(scope=scope, readonly=readonly)

    monkeypatch.setattr(app.state.db, "transaction", recording)
    mine = extension.get("/v1/me/summary", params={"period": "all"}, headers=bearer(first))
    theirs = extension.get("/v1/me/summary", params={"period": "all"}, headers=bearer(second))
    assert mine.status_code == 200 and mine.json()["request_count"] == "1"
    assert theirs.status_code == 200 and theirs.json()["request_count"] == "0"
    # Each organization keeps its own lock instead of every tenant sharing the registration one.
    refreshed = extension.post(
        "/v1/auth/refresh", json={"refresh_token": second["refresh_token"], "operation_id": str(uuid4())}
    )
    assert refreshed.status_code == 200, refreshed.text
    assert (other.data["origin"], False) in scopes
    assert ("registration", False) not in scopes
    monkeypatch.undo()

    # A credential from one organization never opens the other's data: the device belongs to it.
    config = extension.get("/v1/config", headers=bearer(refreshed.json()))
    assert config.status_code == 200
    receipt = extension.post(
        "/v1/deletions/status",
        json={
            "device_id": first["device_id"],
            "credential": first["deletion_receipt_credential"],
            "last_epoch": 0,
        },
    )
    assert receipt.status_code == 200 and receipt.json()["instruction"]["company_id"] == company.id
    crossed = extension.post(
        "/v1/deletions/status",
        json={
            "device_id": first["device_id"],
            "credential": second["deletion_receipt_credential"],
            "last_epoch": 0,
        },
    )
    assert crossed.status_code == 403
    replay = extension.post("/v1/connections/exchange", json=first_exchange)
    assert replay.json() == first
    # Without a credential the shared address names no organization.
    assert extension.get("/v1/me/summary").status_code == 401
    assert extension.get("/v1/public/config").status_code == 401
    assert extension.get("/v1/public/config", headers=bearer(second)).json()["company_name"] == "Second"
    unknown = extension.post("/v1/connections/status", json={"connection_id": str(uuid4()), "verifier": token()})
    assert unknown.status_code == 403 and unknown.json()["error"]["code"] == "connection_denied"
    stranger = extension.post("/v1/auth/refresh", json={"refresh_token": token(), "operation_id": str(uuid4())})
    assert stranger.status_code == 401

    # Each administrator lands on their own organization's dashboard at the same address.
    for email, expected in (("admin@example.org", company.id), ("admin@second.org", other.id)):
        web.cookies.clear()
        signed_in = web_code(app, web, email)
        assert signed_in.status_code == 200, signed_in.text
        assert signed_in.json()["destination"] == "/admin"
        web.headers["X-CSRF-Token"] = signed_in.json()["csrf_token"]
        assert web.get("/v1/auth/session").json()["company_id"] == expected
        users = web.get("/v1/admin/users").json()["items"]
        assert {user["email"] for user in users} == {email, "member@" + email.split("@")[1]}


def test_only_administrators_sign_in_on_the_website(setup):
    app, client, company, _, _, settings = setup
    web, extension = service_clients(app, settings)
    connect(app, extension, "member@example.org")
    before = len(members(app, company))
    for host in (web, client):
        for email in ("member@example.org", "newcomer@example.org"):
            host.cookies.clear()
            refused = web_code(app, host, email)
            assert refused.status_code == 403, refused.text
            assert refused.json()["error"]["code"] == "admin_required"
            assert "browser extension" in refused.json()["error"]["safe_message"]
            assert "__Host-aift" not in refused.headers.get("set-cookie", "")
    # A web sign-in never creates a member.
    assert len(members(app, company)) == before
    signed_in = web_code(app, web, "admin@example.org")
    assert signed_in.status_code == 200 and signed_in.json()["role"] == "admin"
    assert "__Host-aift=" in signed_in.headers["set-cookie"]


def test_codes_answer_alike_but_only_organizations_get_mail(setup):
    app, _, _, _, _, settings = setup
    web, extension = service_clients(app, settings)

    def shape(response):
        body = response.json()
        return response.status_code, tuple(sorted(body)), body["delivery_state"], body["error_code"]

    replies = [
        web.post("/v1/auth/otp/request", json={"purpose": "login", "email": email, "dispatch_id": str(uuid4())})
        for email in ("admin@example.org", "admin@nobody-registered.org")
    ] + [
        extension.post("/v1/connections/otp/request", json={"email": email, "dispatch_id": str(uuid4())})
        for email in ("member@example.org", "member@nobody-registered.org")
    ]
    assert len({shape(reply) for reply in replies}) == 1
    assert shape(replies[0])[0] == 200 and shape(replies[0])[2] == "accepted"
    # Mail goes only where an organization uses the domain (S1): a domain without one cannot be
    # used to spend the shared mail budget or to send mail to third parties.
    assert [message["recipient"] for message in app.state.mail.messages] == [
        "admin@example.org",
        "member@example.org",
    ]
    # The stored challenges read alike too: whether a mail went out is inside the encrypted payload.
    with app.state.db.transaction(readonly=True) as session:
        stored = [get(session, "otp", reply.json()["challenge_id"]) for reply in replies]
        assert len({tuple(sorted(row.data)) for row in stored}) == 1
        assert {row.data["delivery"] for row in stored} == {"accepted"}
    # Free email providers never belong to an organization, so they may be refused at once.
    for reply in (
        web.post(
            "/v1/auth/otp/request",
            json={"purpose": "login", "email": "someone@gmail.com", "dispatch_id": str(uuid4())},
        ),
        extension.post("/v1/connections/otp/request", json={"email": "someone@gmail.com", "dispatch_id": str(uuid4())}),
    ):
        assert reply.status_code == 400 and reply.json()["error"]["code"] == "work_email_required"
        assert reply.json()["error"]["safe_message"].startswith("Use your work email.")
    assert len(app.state.mail.messages) == 2


def test_a_missing_organization_is_reported_only_after_the_code(setup, monkeypatch):
    app, _, _, _, _, settings = setup
    web, extension = service_clients(app, settings)
    # No mail goes out, so nobody can know the code; the test fixes it to show what a correct one gets.
    monkeypatch.setattr("aift.service.secrets.randbelow", lambda _: 424242)
    requested = web.post(
        "/v1/auth/otp/request",
        json={"purpose": "login", "email": "admin@nobody-registered.org", "dispatch_id": str(uuid4())},
    ).json()
    assert app.state.mail.messages == []
    wrong = web.post(
        "/v1/auth/otp/verify",
        json={"challenge_id": requested["challenge_id"], "code": "000000", "verification_id": str(uuid4())},
    )
    assert wrong.status_code == 401 and wrong.json()["error"]["code"] == "otp_invalid_or_expired"
    missing = web.post(
        "/v1/auth/otp/verify",
        json={"challenge_id": requested["challenge_id"], "code": "424242", "verification_id": str(uuid4())},
    )
    assert missing.status_code == 404 and missing.json()["error"]["code"] == "organization_not_found"
    assert "aifootprinttracker.com" in missing.json()["error"]["safe_message"]
    assert "__Host-aift" not in missing.headers.get("set-cookie", "")

    created, _ = create_connection(app, extension, "member@nobody-registered.org", sent=False)
    assert created.status_code == 404 and created.json()["error"]["code"] == "organization_not_found"
    with app.state.db.transaction(readonly=True) as session:
        assert rows(session, "connection") == []
    assert app.state.mail.messages == []


def test_connection_codes_keep_their_purpose_attempts_and_expiry(setup):
    app, client, company, _, now, settings = setup
    web, extension = service_clients(app, settings)
    challenge = extension.post(
        "/v1/connections/otp/request", json={"email": "member@example.org", "dispatch_id": str(uuid4())}
    ).json()["challenge_id"]
    code = app.state.mail.messages[-1]["code"]
    # A connection code never opens a website session, and a sign-in code never connects a browser.
    assert web.post(
        "/v1/auth/otp/verify", json={"challenge_id": challenge, "code": code, "verification_id": str(uuid4())}
    ).status_code == 401
    login_challenge = web.post(
        "/v1/auth/otp/request",
        json={"purpose": "login", "email": "admin@example.org", "dispatch_id": str(uuid4())},
    ).json()["challenge_id"]

    def create(challenge_id, value):
        return extension.post(
            "/v1/connections",
            json={
                "verifier_challenge": digest(token()),
                "challenge_method": "S256",
                "browser_family": "chrome",
                "protocol_version": "1.0.0",
                "operation_id": str(uuid4()),
                "challenge_id": challenge_id,
                "code": value,
            },
        )

    assert create(login_challenge, app.state.mail.messages[-1]["code"]).status_code == 401
    bad = "999999" if code != "999999" else "888888"
    for _ in range(5):
        assert create(challenge, bad).status_code == 401
    assert create(challenge, code).status_code == 401
    # Single use and expiry.
    fresh = extension.post(
        "/v1/connections/otp/request", json={"email": "member@example.org", "dispatch_id": str(uuid4())}
    ).json()["challenge_id"]
    fresh_code = app.state.mail.messages[-1]["code"]
    assert create(fresh, fresh_code).status_code == 200
    assert create(fresh, fresh_code).status_code == 401
    late = extension.post(
        "/v1/connections/otp/request", json={"email": "member@example.org", "dispatch_id": str(uuid4())}
    ).json()["challenge_id"]
    late_code = app.state.mail.messages[-1]["code"]
    from datetime import timedelta

    now[0] += timedelta(minutes=6)
    assert create(late, late_code).status_code == 401


def test_connection_retry_is_idempotent_and_the_extension_may_resend(setup):
    app, _, _, _, now, settings = setup
    _, extension = service_clients(app, settings)
    from datetime import timedelta

    requested = extension.post(
        "/v1/connections/otp/request", json={"email": "member@example.org", "dispatch_id": str(uuid4())}
    ).json()
    now[0] += timedelta(seconds=61)
    resent = extension.post(
        "/v1/auth/otp/resend", json={"challenge_id": requested["challenge_id"], "dispatch_id": str(uuid4())}
    )
    assert resent.status_code == 200, resent.text
    assert resent.json()["challenge_id"] != requested["challenge_id"]
    body = {
        "verifier_challenge": digest(token()),
        "challenge_method": "S256",
        "browser_family": "edge",
        "protocol_version": "1.0.0",
        "operation_id": str(uuid4()),
        "challenge_id": resent.json()["challenge_id"],
        "code": app.state.mail.messages[-1]["code"],
    }
    first = extension.post("/v1/connections", json=body)
    assert first.status_code == 200, first.text
    assert extension.post("/v1/connections", json=body).json() == first.json()
    changed = extension.post("/v1/connections", json={**body, "browser_family": "chrome"})
    assert changed.status_code == 409 and changed.json()["error"]["code"] == "idempotency_conflict"


def test_exchange_needs_the_current_policy_and_names_the_organization(setup):
    app, client, _, _, _, settings = setup
    _, extension = service_clients(app, settings)
    created, verifier = create_connection(app, extension, "member@example.org")
    assert created.json()["company_origin"] == settings.registration_origin
    login(app, client)
    changed = client.put(
        "/v1/admin/policy",
        json=confirmed(
            client,
            {
                "expected_version": "1.0.0",
                "timezone": "UTC",
                "pause_mode": "user_controlled",
                "company_sharing": "disabled",
            },
        ),
    )
    assert changed.status_code == 200, changed.text
    exchange = {
        "connection_id": created.json()["connection_id"],
        "verifier": verifier,
        "exchange_id": str(uuid4()),
        "policy_version": "1.0.0",
        "disclosure_acknowledged": True,
    }
    stale = extension.post("/v1/connections/exchange", json=exchange)
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "policy_changed"
    current = extension.post(
        "/v1/connections/exchange", json={**exchange, "policy_version": changed.json()["policy_version"]}
    )
    assert current.status_code == 200, current.text
    assert current.json()["company_name"] == "Example"


def test_resume_from_another_organization_starts_a_fresh_browser(setup):
    app, _, company, _, _, settings = setup
    other, _ = second_company(app)
    _, extension = service_clients(app, settings)
    elsewhere, _ = connect(app, extension, "member@second.org")
    moved, _ = connect(app, extension, "member@example.org", resume=elsewhere)
    assert moved["company_id"] == company.id and moved["device_id"] != elsewhere["device_id"]
    with app.state.db.transaction(readonly=True) as session:
        assert get(session, "device", elsewhere["device_id"], other.id).data["status"] == "active"

    # Inside one organization a resume still has to prove the browser and its owner.
    same, _ = connect(app, extension, "member@example.org", resume=moved)
    assert same["device_id"] == moved["device_id"]
    forged = {**same, "installation_reconnect_secret": token()}
    denied, _ = create_connection(app, extension, "member@example.org", resume=forged)
    assert denied.status_code == 403 and denied.json()["error"]["code"] == "connection_denied"
    colleague, _ = create_connection(app, extension, "colleague@example.org", resume=same)
    assert colleague.status_code == 403 and colleague.json()["error"]["code"] == "connection_denied"


def test_removed_members_cannot_connect_again(setup):
    app, _, company, _, _, settings = setup
    _, extension = service_clients(app, settings)
    credentials, _ = connect(app, extension, "member@example.org")
    with app.state.db.transaction() as session:
        member = get(session, "member", credentials["user_id"], company.id)
        member.data = {**member.data, "status": "deleted"}
    refused, _ = create_connection(app, extension, "member@example.org")
    assert refused.status_code == 403 and refused.json()["error"]["code"] == "member_unavailable"


def test_an_organization_host_answers_another_domain_alike_without_mail(setup):
    app, client, _, _, _, _ = setup
    extension = TestClient(app, base_url=str(client.base_url).rstrip("/"))
    extension.headers["Origin"] = EXTENSION
    replied = extension.post(
        "/v1/connections/otp/request", json={"email": "member@elsewhere.org", "dispatch_id": str(uuid4())}
    )
    # Answered as a match, but no code is mailed to a domain this organization does not use.
    assert replied.status_code == 200 and replied.json()["delivery_state"] == "accepted"
    assert app.state.mail.messages == []


def test_hosted_registration_has_no_address_and_lands_on_the_dashboard(setup):
    app, _, _, _, _, settings = setup
    client, verified, verification = register(app, settings)
    body = verified.json()
    assert body["destination"] == "/admin"
    assert body["company_origin"] == settings.registration_origin
    assert "__Host-aift=" in verified.headers["set-cookie"]
    assert "__Host-aift-registration=" in verified.headers["set-cookie"]
    client.headers["X-CSRF-Token"] = body["csrf_token"]
    session = client.get("/v1/auth/session")
    assert session.status_code == 200 and session.json()["role"] == "admin"
    assert session.json()["company_name"] == "New company"
    assert client.get("/v1/admin/users").status_code == 200
    # The one CSRF token serves the dashboard and the registration page alike.
    assert (
        client.put(
            "/v1/admin/policy",
            json=confirmed(
                client,
                {
                    "expected_version": "1.0.0",
                    "timezone": "UTC",
                    "pause_mode": "user_controlled",
                    "company_sharing": "disabled",
                },
            ),
        ).status_code
        == 200
    )
    status = client.get("/v1/organizations/registration-status")
    assert status.status_code == 200 and status.json()["company_origin"] == settings.registration_origin
    replay = client.post("/v1/auth/otp/verify", json=verification)
    assert replay.status_code == 200 and replay.json() == body
    with app.state.db.transaction(readonly=True) as session:
        company = get(session, "company", session.get(TABLES["session"], digest(client.cookies["__Host-aift"])).tenant)
        assert company.data["domain"] == "fresh.org"
        assert company.data["slug"] == company.id.replace("-", "")
        assert company.data["origin"] == "https://" + company.data["slug"] + ".aifootprinttracker.com"
    # Members of the new organization connect at the same address, found by their domain.
    _, extension = service_clients(app, settings)
    member, _ = connect(app, extension, "member@fresh.org")
    assert member["company_id"] == company.id and member["company_name"] == "New company"
    # The developer sees the domain, not only the internal key.
    operator = TestClient(app, base_url=settings.operator_origin)
    operator.headers["Origin"] = settings.operator_origin
    login(app, operator, "operator@example.org", operator=True)
    listed = operator.get("/v1/operator/organizations").json()["items"]
    assert {item["domain"] for item in listed} == {"example.org", "fresh.org"}


def test_a_shared_domain_keeps_existing_people_in_their_organization(setup):
    app, _, company, _, _, settings = setup
    other, _ = second_company(app, domain="example.org", name="Second on the same domain", admin="lead")
    web, extension = service_clients(app, settings)
    # Existing people stay where they are known.
    signed_in = web_code(app, web, "admin@example.org")
    assert signed_in.status_code == 200
    web.headers["X-CSRF-Token"] = signed_in.json()["csrf_token"]
    assert web.get("/v1/auth/session").json()["company_id"] == company.id
    # A new address on a shared domain cannot be assigned to either organization.
    before = len(app.state.mail.messages)
    unassigned = extension.post(
        "/v1/connections/otp/request", json={"email": "newcomer@example.org", "dispatch_id": str(uuid4())}
    )
    assert unassigned.status_code == 200 and len(app.state.mail.messages) == before
    assert other.id != company.id


def test_self_hosted_server_works_end_to_end_at_its_own_host(self_hosted):
    app, now, settings = self_hosted
    _, verified, _ = register(app, settings)
    assert verified.json()["company_origin"] == settings.self_host_origin
    assert verified.json()["destination"].startswith(settings.self_host_origin + "/auth/bootstrap/start")
    host = TestClient(app, base_url=settings.self_host_origin)
    host.headers["Origin"] = settings.self_host_origin
    signed_in = login(app, host, "admin@fresh.org")
    assert signed_in["destination"] == "/admin"
    extension = TestClient(app, base_url=settings.self_host_origin)
    extension.headers["Origin"] = EXTENSION
    created, verifier = create_connection(app, extension, "member@fresh.org")
    assert created.status_code == 200, created.text
    assert created.json()["company_origin"] == settings.self_host_origin
    member, _ = connect(app, extension, "member@fresh.org")
    request, attempt = observations(now[0])
    assert upload(extension, member, [request, attempt]).status_code == 200
    summary = extension.get("/v1/me/summary", params={"period": "all"}, headers=bearer(member))
    assert summary.json()["request_count"] == "1"
    users = host.get("/v1/admin/users").json()["items"]
    assert {user["email"] for user in users} == {"admin@fresh.org", "member@fresh.org"}
    # The registration origin of a self-hosted server is not a shared tenant address.
    registration = TestClient(app, base_url=settings.registration_origin)
    assert registration.get("/v1/me/summary", headers=bearer(member)).status_code == 404
