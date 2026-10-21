"""Real server ingestion of the request-derived unresolved Perplexity identity contract."""

import base64
import hashlib
import hmac
import re
from copy import deepcopy
from uuid import uuid4

from conftest import connect, login, member_login
from fastapi.testclient import TestClient
from test_analytics import observations
from test_file_text_contract import mixed_upload

from aift.db import Observation, get, put


def identity(secret, kind, value):
    key = (
        bytes.fromhex(secret)
        if re.fullmatch(r"[0-9a-fA-F]{64}", secret)
        else base64.urlsafe_b64decode(secret + "=" * (-len(secret) % 4))
    )
    fields = ["1", "perplexity", kind, value]
    encoded = "".join(str(len(field.encode())) + ":" + field for field in fields).encode()
    return hmac.new(key, encoded, hashlib.sha256).hexdigest()


def records_for(credentials, now, frontend, output):
    request, attempt = observations(now)
    request.update(
        schema_version="3.0.0",
        site="perplexity",
        provider_request_key=identity(credentials["user_hmac_key"], "request", frontend),
        conversation_key=identity(
            credentials["user_hmac_key"], "conversation", "provisional-request:" + frontend
        ),
        coverage_reasons=["conversation_identity_local_only"],
    )
    request["documents"]["extracted_text"] = None
    attempt.update(
        schema_version="3.0.0", provider_attempt_key=identity(credentials["user_hmac_key"], "attempt", output)
    )
    return request, attempt


def statuses(response):
    assert response.status_code == 200, response.text
    return [row["status"] for row in response.json()["results"]]


def test_two_installations_share_only_the_same_perplexity_request_provisional_key_and_keep_conflicts(setup):
    app, client, company, admin, now, _ = setup
    login(app, client)
    first, _ = connect(app, client)
    second, _ = connect(app, client)
    frontend = str(uuid4())
    request, attempt = records_for(first, now[0], frontend, "observed-workflow-output-one")
    # The second installation's copy ties with this attempt in live_evidence_order, which then prefers
    # the lower attempt id. Fixed ids keep the original canonical, so the copy is aliased on every run.
    attempt["attempt_id"] = "00000000-0000-4000-8000-000000000001"
    assert statuses(mixed_upload(client, first, [request, attempt])) == ["applied", "applied"]
    duplicate, duplicate_attempt = records_for(second, now[0], frontend, "observed-workflow-output-one")
    duplicate_attempt["attempt_id"] = "00000000-0000-4000-8000-000000000002"
    assert duplicate["conversation_key"] == request["conversation_key"]
    result = mixed_upload(client, second, [duplicate, duplicate_attempt])
    assert statuses(result) == ["aliased", "aliased"], result.text
    assert result.json()["results"][0]["canonical_id"] == request["request_id"]
    assert statuses(mixed_upload(client, second, [duplicate, duplicate_attempt])) == ["aliased", "aliased"]
    distinct, distinct_attempt = records_for(second, now[0], str(uuid4()), "observed-workflow-output-two")
    assert distinct["conversation_key"] != request["conversation_key"]
    assert statuses(mixed_upload(client, second, [distinct, distinct_attempt])) == ["applied", "applied"]
    summary = client.get("/v1/me/summary").json()
    assert summary["request_count"] == summary["attempt_count"] == "2"
    # Merely claiming local-only status cannot bypass the existing conversation/site identity guard.
    spoof = {**duplicate, "request_id": str(uuid4()), "conversation_key": "f" * 64}
    rejected = mixed_upload(client, second, [spoof])
    assert rejected.json()["results"][0]["error_code"] == "identity_conflict"
    wrong_site = {**duplicate, "request_id": str(uuid4()), "site": "claude"}
    assert (
        mixed_upload(client, second, [wrong_site]).json()["results"][0]["error_code"] == "identity_conflict"
    )
    # An originating-device correction remains possible without rewriting other observation bytes.
    corrected = deepcopy(request)
    corrected.update(
        revision=2,
        conversation_key=identity(first["user_hmac_key"], "conversation", str(uuid4())),
        coverage_reasons=[],
    )
    assert statuses(mixed_upload(client, first, [corrected])) == ["applied"]
    with app.state.db.transaction(readonly=True) as session:
        assert (
            session.get(Observation, (company.id, admin.id, "attempt", attempt["attempt_id"])).conversation
            == corrected["conversation_key"]
        )
    stale_provisional = {**duplicate, "request_id": str(uuid4())}
    assert (
        mixed_upload(client, second, [stale_provisional]).json()["results"][0]["error_code"]
        == "identity_conflict"
    )
    matching = {
        **duplicate,
        "request_id": str(uuid4()),
        "conversation_key": corrected["conversation_key"],
        "coverage_reasons": [],
    }
    assert statuses(mixed_upload(client, second, [matching])) == ["aliased"]
    assert (
        mixed_upload(client, second, [{**corrected, "revision": 3}]).json()["results"][0]["error_code"]
        == "ownership_conflict"
    )
    changed_key = {**corrected, "revision": 3, "provider_request_key": "e" * 64}
    assert (
        mixed_upload(client, first, [changed_key]).json()["results"][0]["error_code"] == "immutable_identity"
    )
    final = client.get("/v1/me/summary").json()
    assert final["request_count"] == final["attempt_count"] == "2"


def test_perplexity_request_keys_and_provisional_conversations_are_user_and_tenant_scoped(setup):
    app, client, company, _, now, _ = setup
    login(app, client)
    first, _ = connect(app, client)
    frontend = str(uuid4())
    first_records = records_for(first, now[0], frontend, "one-output")
    assert statuses(mixed_upload(client, first, list(first_records))) == ["applied", "applied"]
    employee = TestClient(app, base_url=company.origin)
    employee.headers["Origin"] = company.origin
    member_login(app, employee, "employee@example.org")
    second, _ = connect(app, employee)
    second_records = records_for(second, now[0], frontend, "one-output")
    assert second_records[0]["provider_request_key"] != first_records[0]["provider_request_key"]
    assert second_records[0]["conversation_key"] != first_records[0]["conversation_key"]
    assert statuses(mixed_upload(employee, second, list(second_records))) == ["applied", "applied"]
    forged = {**first_records[0], "request_id": str(uuid4())}
    assert mixed_upload(employee, second, [forged]).json()["results"][0]["error_code"] == "ownership_conflict"
    with app.state.db.transaction() as session:
        tenant = put(
            session,
            "company",
            str(uuid4()),
            {
                **company.data,
                "name": "Second",
                "slug": "second",
                "domain": "second.org",
                "origin": "https://second.aifootprinttracker.com",
            },
        )
        app.state.service.member(session, tenant, "admin@second.org", True)
    other = TestClient(app, base_url=tenant.origin)
    other.headers["Origin"] = tenant.origin
    login(app, other, "admin@second.org")
    third, _ = connect(app, other)
    third_records = records_for(third, now[0], frontend, "one-output")
    assert third_records[0]["conversation_key"] not in {
        first_records[0]["conversation_key"],
        second_records[0]["conversation_key"],
    }
    assert statuses(mixed_upload(other, third, list(third_records))) == ["applied", "applied"]
    denied = mixed_upload(other, first, [{**first_records[0], "request_id": str(uuid4())}])
    assert denied.status_code in {401, 403}, denied.text
    extra = {**third_records[0], "request_id": str(uuid4()), "company_id": company.id}
    assert statuses(mixed_upload(other, third, [extra])) == ["rejected"]
    assert employee.get("/v1/me/summary").json()["request_count"] == "1"
    assert other.get("/v1/me/summary").json()["request_count"] == "1"
    with app.state.db.transaction(readonly=True) as session:
        assert get(session, "company", company.id).data["epoch"] == 0
