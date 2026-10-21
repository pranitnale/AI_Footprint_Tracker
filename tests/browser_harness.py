"""Loopback UI verification with synthetic data and the real API implementation.

This test-only HTTP adapter presents one synthetic HTTPS tenant to FastAPI's
in-process test client. It does not verify production TLS, PostgreSQL or email
delivery. Production distribution must not include this test server.
"""

from __future__ import annotations

import json
import mimetypes
import sys
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
for relative in ("apps/server", "packages/contracts/python", "packages/estimator/python"):
    sys.path.insert(0, str(ROOT / relative))

from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from aift.config import Settings
from aift.db import put
from aift.main import create_app
from aift.security import instant, token

STATIC = ROOT / "apps/web/dist"
HOSTED = "--hosted" in sys.argv
SEED_RETENTION = "--seed-retention-transition" in sys.argv
SEED_FILE_TEXT = "--seed-file-text" in sys.argv
assert sum((HOSTED, SEED_RETENTION, SEED_FILE_TEXT)) <= 1
PORT = 4181 if HOSTED else 4182 if SEED_RETENTION else 4184 if SEED_FILE_TEXT else 4180
LOCAL_ORIGIN = (
    "http://registration.localhost:4181" if HOSTED
    else "http://retention.localhost:4182" if SEED_RETENTION
    else "http://files.localhost:4184" if SEED_FILE_TEXT
    else "http://localhost:4180"
)
TENANT_ORIGIN = (
    "https://retention.organizations.verification.example" if SEED_RETENTION
    else "https://verification.example"
)
REGISTRATION_ORIGIN = (
    "https://registration.verification.example" if HOSTED or SEED_RETENTION
    else TENANT_ORIGIN
)
OPERATOR_ORIGIN = "https://operator.verification.example"
HOSTED_DOMAIN = "organizations.verification.example"
RUN_DIR = ROOT / ".test-runtime" / ("browser-" + str(uuid4()))
RUN_DIR.mkdir(parents=True)

settings = Settings(
    database_url="sqlite:///" + (RUN_DIR / "verification.sqlite").as_posix(),
    environment="test",
    mode="hosted" if HOSTED or SEED_RETENTION else "self_hosted",
    registration_origin=REGISTRATION_ORIGIN,
    self_host_origin=TENANT_ORIGIN,
    operator_origin=OPERATOR_ORIGIN,
    hosted_domain=HOSTED_DOMAIN,
    encryption_key=Fernet.generate_key().decode(),
    lookup_key=token(),
    deletion_signing_key=token(),
    deletion_journal_path=str(RUN_DIR / "journal.jsonl"),
    mail_adapter="fake",
    member_capacity=50,
    domain_policy="one_active",
    routing_verified=True,
    operator_emails=("operator@verification.example",),
)
test_clock = [None]
app = create_app(settings, initialize=True, clock=lambda: test_clock[0] or datetime.now(UTC))
assert app.state.service.settings.environment == "test"
assert app.state.service.settings.mail_adapter == "fake"
if not HOSTED:
    with app.state.db.transaction() as session:
        company = put(session, "company", str(uuid4()), {
            "name": "Verification Company", "slug": "retention" if SEED_RETENTION else "verification", "domain": "verification.example",
            "origin": TENANT_ORIGIN, "status": "active", "timezone": "Europe/Berlin",
            "pause_mode": "user_controlled", "company_sharing": "threshold", "capacity": 50,
            "retention_months": 6 if SEED_RETENTION else None, "policy_version": "1.0.0", "epoch": 0, "version": 1,
            "plan_id": "configured-free" if SEED_RETENTION else "self-hosted", "plan_version": 1,
        })
        app.state.service.member(session, company, "admin@verification.example", True)


def internal_origin(local_origin):
    if not HOSTED:
        if local_origin == f"http://operator.localhost:{PORT}":
            return OPERATOR_ORIGIN
        return TENANT_ORIGIN if local_origin == LOCAL_ORIGIN else None
    parsed = urlsplit(local_origin)
    if parsed.scheme != "http" or parsed.port != PORT or parsed.path or parsed.query or parsed.fragment:
        return None
    hostname = parsed.hostname or ""
    if hostname == "registration.localhost":
        return REGISTRATION_ORIGIN
    if hostname == "operator.localhost":
        return OPERATOR_ORIGIN
    if hostname.endswith(".localhost"):
        slug = hostname.removesuffix(".localhost")
        if slug and all(character in "abcdefghijklmnopqrstuvwxyz0123456789-" for character in slug):
            return "https://" + slug + "." + HOSTED_DOMAIN
    return None


def localize_response(value):
    """Rewrite only synthetic infrastructure URLs for the loopback fixture."""
    if not HOSTED:
        return value
    if isinstance(value, list):
        return [localize_response(item) for item in value]
    if isinstance(value, dict):
        return {key: localize_response(item) for key, item in value.items()}
    if not isinstance(value, str):
        return value
    value = value.replace(REGISTRATION_ORIGIN, "http://registration.localhost:4181")
    value = value.replace(OPERATOR_ORIGIN, "http://operator.localhost:4181")
    import re
    return re.sub(r"https://([a-z0-9-]+)\." + re.escape(HOSTED_DOMAIN), r"http://\1.localhost:4181", value)


def seed_synthetic_usage():
    """Exercise the actual login, connection and ingestion APIs with numeric fixtures."""
    sys.path.insert(0, str(ROOT / "apps/server/tests"))
    from conftest import connect, login
    from test_analytics import observations, upload

    present = datetime.now(UTC) - timedelta(minutes=2)
    for email, count in (("admin@verification.example", 5), ("member@verification.example", 3)):
        for days_ago, period_count in ((35, 1), (0, count - 1)):
            test_clock[0] = present - timedelta(days=days_ago)
            with TestClient(app, base_url=TENANT_ORIGIN) as seed_client:
                seed_client.headers["Origin"] = TENANT_ORIGIN
                login(app, seed_client, email=email)
                credentials, _ = connect(app, seed_client)
                for index in range(period_count):
                    request, attempt = observations(test_clock[0], str(20 + index * 7))
                    if SEED_FILE_TEXT and days_ago == 0:
                        # Synthetic API fixtures only. This does not associate an actual upload.
                        request["schema_version"] = attempt["schema_version"] = "1.2.0"
                        origin = "new_upload" if index == 0 else "retained_context"
                        known = not (email.startswith("member") and index == 1)
                        extracted = [{
                            "component_id": str(uuid4()), "origin": origin,
                            "extraction_profile_id": "local-file-text-utf8-pdfjs6.3.289-opc-v1",
                            "page_count": 1,
                            "tokens": {
                                "value": "7" if known else None,
                                "evidence": "heuristic_estimate" if known else "unknown",
                                "scope": "extracted_file_text",
                                "completeness": "complete_for_scope" if known else "unknown",
                                "profile_id": "o200k-base-4.0.0-reference" if known else None,
                                "reason": "tokenizer_mapping_unverified" if known else "tokenizer_unavailable",
                            },
                            "missing": ["provider_processing", "ocr", "retrieval_selection"],
                        }]
                        if index == 2:
                            extracted = []
                        elif index == 3:
                            extracted = None
                        request["documents"].update({
                            "extracted_text": extracted,
                            "upload_count": "1" if index in (0, 3) else "0",
                            "types": ["text_pdf"], "processing": "opaque",
                        })
                        if "document" not in request["features"]:
                            request["features"].append("document")
                        response = seed_client.post("/v1/usage/batches", headers={
                            "Authorization": "Bearer " + credentials["access_token"],
                        }, json={
                            "schema_version": "1.2.0", "batch_id": str(uuid4()),
                            "sent_at": request["dispatched_at"], "client_version": "0.1.0",
                            "deletion_epoch": 0, "records": [request, attempt],
                        })
                    else:
                        response = upload(seed_client, credentials, [request, attempt])
                    assert response.status_code == 200, response.text
                    assert all(result["status"] == "applied" for result in response.json()["results"])
    test_clock[0] = None


def seed_retention_transition():
    """Prepare a pending policy through real APIs before the browser server starts."""
    with TestClient(app, base_url=OPERATOR_ORIGIN) as operator:
        operator.headers["Origin"] = OPERATOR_ORIGIN
        dispatch = operator.post("/v1/operator/auth/otp/request", json={
            "purpose": "operator_login", "email": "operator@verification.example",
            "dispatch_id": str(uuid4()),
        })
        assert dispatch.status_code == 200, dispatch.text
        verified = operator.post("/v1/operator/auth/otp/verify", json={
            "challenge_id": dispatch.json()["challenge_id"],
            "code": app.state.mail.messages[-1]["code"], "verification_id": str(uuid4()),
        })
        assert verified.status_code == 200, verified.text
        operator.headers["X-CSRF-Token"] = verified.json()["csrf_token"]
        plan = operator.post("/v1/operator/plans", json={
            "plan_id": "synthetic-retention-check", "version": 1,
            "member_capacity": 500, "retention_months": 1,
            "idempotency_key": str(uuid4()),
        })
        assert plan.status_code == 200, plan.text
        organizations = operator.get("/v1/operator/organizations")
        assert organizations.status_code == 200, organizations.text
        selected = organizations.json()["items"][0]
        transition = operator.put(
            f"/v1/operator/organizations/{selected['company_id']}/entitlement",
            json={
                "expected_version": selected["version"],
                "plan_id": "synthetic-retention-check", "plan_version": 1,
                "effective_at": instant(datetime.now(UTC) - timedelta(seconds=1)),
                "reason": "Synthetic browser retention verification",
                "idempotency_key": str(uuid4()),
            },
        )
        assert transition.status_code == 200, transition.text
        assert transition.json()["status"] == "retention_transition_pending"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def send(self, status, body, headers=()):
        self.send_response(status)
        for key, value in headers:
            if key.lower() not in {"content-length", "transfer-encoding", "content-encoding", "connection"}:
                self.send_header(key, value)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def handle_request(self):
        target_origin = internal_origin("http://" + self.headers.get("Host", ""))
        if target_origin is None:
            return self.send(403, b"Unknown local test host")
        parsed = urlsplit(self.path)
        if parsed.scheme or parsed.netloc:
            return self.send(400, b"Invalid local test path")
        path = unquote(parsed.path)
        if path == "/__test__/mailbox" and self.command == "GET":
            messages = app.state.mail.messages
            body = json.dumps({"code": messages[-1]["code"] if messages else None}).encode()
            return self.send(200, body, [("Content-Type", "application/json")])
        if path == "/__test__/advance-retention" and SEED_RETENTION:
            if self.command != "POST" or self.headers.get("Origin") != LOCAL_ORIGIN:
                return self.send(403, b"Synthetic fixture control requires its own origin")
            from aift.db import get
            from aift.maintenance import maintain_tenant
            with app.state.db.transaction(scope=TENANT_ORIGIN) as session:
                current = get(session, "company", company.id)
                maintain_tenant(app.state.service, session, current)
            return self.send(200, b'{"advanced":true}', [("Content-Type", "application/json")])
        if path.startswith(("/v1/", "/health/", "/auth/bootstrap/")):
            incoming_origin = self.headers.get("Origin")
            mapped_origin = internal_origin(incoming_origin) if incoming_origin else None
            if incoming_origin and mapped_origin is None:
                return self.send(403, b"Test origin denied")
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                return self.send(400, b"Invalid length")
            if not 0 <= length <= 524288:
                return self.send(413, b"Test request too large")
            body = self.rfile.read(length) if length else None
            headers = {key: value for key, value in self.headers.items()
                       if key.lower() not in {"host", "origin", "connection", "content-length"}}
            if incoming_origin:
                headers["Origin"] = mapped_origin
            # A separate client per request prevents its cookie jar from masking browser failures.
            with TestClient(app, base_url=target_origin) as client:
                response = client.request(self.command, self.path, headers=headers,
                                          content=body, follow_redirects=False)
            content = response.content
            if HOSTED:
                content_type = response.headers.get("Content-Type", "")
                if content_type.startswith("application/json"):
                    content = json.dumps(localize_response(response.json())).encode()
                elif content_type.startswith("text/html"):
                    content = localize_response(response.text).encode()
            response_headers = [(key, localize_response(value) if key.lower() in {"location", "content-security-policy", "access-control-allow-origin"} else value)
                                for key, value in response.headers.multi_items()]
            return self.send(response.status_code, content, response_headers)
        if self.command not in {"GET", "HEAD"}:
            return self.send(405, b"Method not allowed")
        candidate = (STATIC / path.lstrip("/")).resolve()
        if not candidate.is_relative_to(STATIC.resolve()):
            return self.send(404, b"Not found")
        if not candidate.is_file():
            if candidate.suffix or path.startswith(("/assets/", "/downloads/")):
                return self.send(404, b"Not found")
            candidate = STATIC / "index.html"
        if not candidate.is_file():
            return self.send(503, b"Build the website before starting UI verification")
        mime = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        if candidate.suffix in {".js", ".mjs"}:
            mime = "text/javascript"
        return self.send(200, candidate.read_bytes(), [("Content-Type", mime)])

    do_GET = handle_request
    do_HEAD = handle_request
    do_POST = handle_request
    do_PUT = handle_request
    do_DELETE = handle_request
    do_OPTIONS = handle_request


if __name__ == "__main__":
    if ("--seed-usage" in sys.argv or SEED_RETENTION or SEED_FILE_TEXT) and not HOSTED:
        seed_synthetic_usage()
    if SEED_RETENTION:
        seed_retention_transition()
    print(f"Synthetic UI verification: {LOCAL_ORIGIN}", flush=True)
    print("Synthetic OTP delivery only. No real email is sent.", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
