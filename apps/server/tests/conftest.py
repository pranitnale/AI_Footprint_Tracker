from datetime import UTC, datetime
from uuid import uuid4

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from aift.config import Settings
from aift.db import put
from aift.main import create_app
from aift.security import token


def restore_pre_0007_schema(connection, schema_version):
    for table in (
        "engine_estimates",
        "recorded_thread_relations",
        "historical_observations",
        "historical_coverage",
        "historical_tombstones",
        # The website's contact requests arrive with migration 0013.
        "contact_requests",
    ):
        assert connection.exec_driver_sql(f"SELECT count(*) FROM {table}").scalar_one() == 0
        connection.exec_driver_sql(f"DROP TABLE {table}")
    connection.exec_driver_sql("ALTER TABLE record_deletion_tombstones DROP COLUMN reason")
    # Company deduplication columns arrive with migration 0012 (W11).
    connection.exec_driver_sql("DROP INDEX ix_observation_company_key")
    for column in ("company_shared", "company_key"):
        connection.exec_driver_sql(f"ALTER TABLE canonical_observations DROP COLUMN {column}")
    connection.exec_driver_sql(
        "UPDATE transaction_guard SET schema_version = ? WHERE id = 1", (schema_version,)
    )


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "features(person_analytics=False, ip_collection=False, backdate=True): run the test with these "
        "operator switches on. With person analytics on and backdate left true, the switch counts as "
        "on since 2000, so a test's usage is not hidden as recorded before it.",
    )


# The per-person administrator views and connection address collection as they were before
# 18 October 2026, for the tests that check them with both operator switches on.
PERSON_ANALYTICS = pytest.mark.features(person_analytics=True, ip_collection=True)
BACKDATED_SINCE = "2000-01-01T00:00:00.000Z"


def switch_person_analytics_since(app, since):
    """Pretends person analytics has been on since the given instant (or was never on, for None)."""
    from aift.service import PERSON_ANALYTICS_KEY

    with app.state.db.transaction() as s:
        put(s, "maintenance_cursor", PERSON_ANALYTICS_KEY, {"enabled": since is not None, "since": since})


@pytest.fixture
def setup(tmp_path, request):
    marker = request.node.get_closest_marker("features")
    features = marker.kwargs if marker else {}
    person_analytics = features.get("person_analytics", False)
    ip_collection = features.get("ip_collection", False)
    settings = Settings(
        database_url="sqlite:///" + (tmp_path / "server.db").as_posix(),
        environment="test",
        encryption_key=Fernet.generate_key().decode(),
        lookup_key=token(),
        person_analytics_enabled=person_analytics,
        ip_collection_enabled=ip_collection,
        **({"ip_key": token(), "ip_retention_days": 30} if ip_collection else {}),
        mail_adapter="fake",
        member_capacity=50,
        domain_policy="one_active",
        routing_verified=True,
        operator_emails=("operator@example.org",),
        extension_origins=("chrome-extension://test-extension",),
        deletion_signing_key=token(),
        deletion_journal_path=str(tmp_path / "journal.jsonl"),
    )
    now = [datetime(2026, 9, 10, 12, tzinfo=UTC)]
    app = create_app(settings, initialize=True, clock=lambda: now[0])
    service = app.state.service
    # An unsent code waits about as long as a real send would; tests need not wait.
    service.pause = lambda seconds: None
    if person_analytics and features.get("backdate", True):
        switch_person_analytics_since(app, BACKDATED_SINCE)
    with app.state.db.transaction() as s:
        company = put(
            s,
            "company",
            str(uuid4()),
            {
                "name": "Example",
                "slug": "example",
                "domain": "example.org",
                "origin": "https://example.aifootprinttracker.com",
                "status": "active",
                "timezone": "Europe/Berlin",
                "pause_mode": "user_controlled",
                "company_sharing": "threshold",
                "capacity": 50,
                "retention_months": 6,
                "policy_version": "1.0.0",
                "epoch": 0,
                "version": 1,
                "plan_id": "free",
                "plan_version": 1,
            },
        )
        admin = service.member(s, company, "admin@example.org", True)
    client = TestClient(app, base_url=company.data["origin"])
    client.headers["Origin"] = company.data["origin"]
    return app, client, company, admin, now, settings


@pytest.fixture
def self_hosted(setup, tmp_path):
    """An empty self-hosted server: one organization, registered at its own registration origin."""
    from dataclasses import replace

    settings = replace(
        setup[-1],
        database_url="sqlite:///" + (tmp_path / "self-hosted.db").as_posix(),
        mode="self_hosted",
        registration_origin="https://footprint.example.net",
        operator_origin="https://operator.footprint.example.net",
        hosted_domain="footprint.example.net",
        self_host_origin="https://company.footprint.example.net",
    )
    now = [datetime(2026, 9, 10, 12, tzinfo=UTC)]
    app = create_app(settings, initialize=True, clock=lambda: now[0])
    return app, now, settings


def register(app, settings, domain="fresh.org", email="admin@fresh.org", name="New company"):
    """Registers an organization at the registration origin and verifies the administrator's code."""
    client = TestClient(app, base_url=settings.registration_origin)
    client.headers["Origin"] = settings.registration_origin
    registration = client.post(
        "/v1/organizations/registrations",
        json={
            "company_name": name,
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
    assert registration.status_code == 200, registration.text
    challenge = client.post(
        "/v1/auth/otp/request",
        json={
            "purpose": "registration",
            "email": email,
            "registration_id": registration.json()["registration_id"],
            "dispatch_id": str(uuid4()),
        },
    ).json()
    verification = {
        "challenge_id": challenge["challenge_id"],
        "code": app.state.mail.messages[-1]["code"],
        "verification_id": str(uuid4()),
    }
    verified = client.post("/v1/auth/otp/verify", json=verification)
    assert verified.status_code == 200, verified.text
    return client, verified, verification


def login(app, client, email="admin@example.org", operator=False):
    prefix = "/v1/operator/auth" if operator else "/v1/auth"
    result = client.post(
        prefix + "/otp/request",
        json={
            "purpose": "operator_login" if operator else "login",
            "email": email,
            "dispatch_id": str(uuid4()),
            "registration_id": None,
        },
    )
    assert result.status_code == 200, result.text
    challenge = result.json()["challenge_id"]
    code = app.state.mail.messages[-1]["code"]
    result = client.post(
        prefix + "/otp/verify",
        json={"challenge_id": challenge, "code": code, "verification_id": str(uuid4())},
    )
    assert result.status_code == 200, result.text
    client.headers["X-CSRF-Token"] = result.json()["csrf_token"]
    client.aift_email = email
    return result.json()


def member_login(app, client, email):
    """
    Gives a member a web session directly. Members no longer sign in on the website, but the server
    must still refuse what a member's session may not reach, so tests keep probing with one.
    """
    from urllib.parse import urlsplit

    service = app.state.service
    origin = str(client.base_url).rstrip("/")
    with app.state.db.transaction(scope=origin) as session:
        company = service.tenant(session, origin)
        member = service.member(session, company, email)
        raw, csrf = service.session(session, company, member)
    client.cookies.set("__Host-aift", raw, domain=urlsplit(origin).hostname)
    client.headers["X-CSRF-Token"] = csrf
    client.aift_email = email
    return {"role": member.data["role"], "user_id": member.id, "csrf_token": csrf}


def action_code(client):
    """A fresh single-use action code for the administrator signed in on this client."""
    from aift.security import digest

    app = client.app
    session = client.get("/v1/auth/session").json()
    proof = token()
    with app.state.db.transaction() as s:
        put(
            s,
            "reauth",
            digest(proof),
            {"expires": app.state.service.expires(300), "used": False},
            session["company_id"],
            session["user_id"],
        )
    return proof


def confirmed(client, body=None):
    """
    The body of an action that needs a fresh email code (policy change, export, plan change
    acknowledgement), with a new idempotency key and a code for the signed-in administrator.
    """
    return {**(body or {}), "idempotency_key": str(uuid4()), "reauth_token": action_code(client)}


def operator_code(client):
    """A fresh single-use action code for the developer signed in on this client."""
    from aift.db import get
    from aift.security import digest

    app = client.app
    proof = token()
    with app.state.db.transaction() as s:
        owner = get(s, "session", digest(client.cookies.get("__Host-aift-operator"))).owner
        put(s, "reauth", digest(proof), {"expires": app.state.service.expires(300), "used": False}, "", owner)
    return proof


def operator_confirmed(client, body):
    """
    The body of a developer action that needs a fresh email code (organization status, plan,
    exception, domain approval, contact deletion), with a code for the developer on this client.
    The caller's idempotency key is kept, so a test can repeat the same request.
    """
    return {**body, "reauth_token": operator_code(client)}


def open_network(client):
    """Opens the connection addresses for this client's session with a fresh code."""
    opened = client.post("/v1/admin/network/access", json={"reauth_token": action_code(client)})
    assert opened.status_code == 200, opened.text
    return opened.json()


def request_connection_code(app, client, email, sent=True):
    """
    Requests a connection code. With sent=False no mail goes out (no organization uses the domain);
    the caller then fixes secrets.randbelow and the code is the one it returns.
    """
    before = len(app.state.mail.messages)
    result = client.post("/v1/connections/otp/request", json={"email": email, "dispatch_id": str(uuid4())})
    assert result.status_code == 200, result.text
    if not sent:
        import aift.service

        assert len(app.state.mail.messages) == before
        return result.json()["challenge_id"], f"{aift.service.secrets.randbelow(1000000):06d}"
    # An existing member's code goes to their stored address, which may differ in case or tag.
    from aift.security import email_identity

    assert email_identity(app.state.mail.messages[-1]["recipient"]) == email_identity(email)
    return result.json()["challenge_id"], app.state.mail.messages[-1]["code"]


def create_connection(app, client, email, resume=None, sent=True):
    """Steps 1 and 2 of the extension's connection: email code, then the verified connection."""
    from aift.security import digest

    verifier = token()
    challenge, code = request_connection_code(app, client, email, sent)
    body = {
        "verifier_challenge": digest(verifier),
        "challenge_method": "S256",
        "browser_family": "chrome",
        "protocol_version": "1.0.0",
        "operation_id": str(uuid4()),
        "challenge_id": challenge,
        "code": code,
    }
    if resume:
        body["resume_device_id"] = resume["device_id"]
        body["installation_reconnect_secret"] = resume["installation_reconnect_secret"]
    result = client.post("/v1/connections", json=body)
    return result, verifier


def connect(app, client, email=None, resume=None):
    """
    Connects a browser the way the extension does. The email defaults to the one the client last
    signed in with, so a test reads as "this person connects".
    """
    email = email or getattr(client, "aift_email", "admin@example.org")
    result, verifier = create_connection(app, client, email, resume)
    assert result.status_code == 200, result.text
    created = result.json()
    assert created["state"] == "verified"
    exchange = {
        "connection_id": created["connection_id"],
        "verifier": verifier,
        "exchange_id": str(uuid4()),
        "policy_version": created["policy"]["policy_version"],
        "disclosure_acknowledged": True,
    }
    result = client.post("/v1/connections/exchange", json=exchange)
    assert result.status_code == 200, result.text
    return result.json(), exchange
