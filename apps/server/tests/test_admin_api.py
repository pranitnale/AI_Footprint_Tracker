import csv
import io
import json
from datetime import timedelta
from uuid import uuid4

from conftest import (
    PERSON_ANALYTICS,
    confirmed,
    connect,
    create_connection,
    login,
    member_login,
    open_network,
)
from fastapi.testclient import TestClient
from footprint_contracts import payload_hash
from sqlalchemy import select
from test_analytics import observations, upload
from test_restore_plans import operator_client

from aift.db import Observation, get, put
from aift.security import instant


@PERSON_ANALYTICS
def test_same_request_uuid_other_owner_never_mixes_counts_or_details(setup):
    app, admin, company, _, now, _ = setup
    login(app, admin)
    first, _ = connect(app, admin)
    employee = TestClient(app, base_url=company.data["origin"])
    employee.headers["Origin"] = company.data["origin"]
    member_login(app, employee, "employee@example.org")
    second, _ = connect(app, employee)
    request, attempt = observations(now[0])
    assert upload(admin, first, [request, attempt]).status_code == 200
    second_attempt = {**attempt, "attempt_id": str(uuid4())}
    third_attempt = {**attempt, "attempt_id": str(uuid4())}
    assert upload(employee, second, [request, second_attempt, third_attempt]).status_code == 200
    listing = admin.get("/v1/admin/requests").json()
    counts = {row["user_id"]: row["attempt_count"] for row in listing["items"]}
    assert counts == {first["user_id"]: "1", second["user_id"]: "2"}
    detail = admin.get(
        f"/v1/admin/users/{second['user_id']}/requests/{request['request_id']}", params={"limit": 1}
    ).json()
    assert detail["attempt_count"] == "2" and len(detail["attempts"]) == 1 and detail["next_cursor"]
    assert detail["attempts"][0]["estimate"]["result"]["requested_method"]["method_hash"]
    assert detail["attempts"][0]["revision_count"] == 1
    assert payload_hash(detail["attempts"][0]["observation"]) == detail["attempts"][0]["payload_hash"]
    next_page = admin.get(
        f"/v1/admin/users/{second['user_id']}/requests/{request['request_id']}",
        params={"limit": 1, "cursor": detail["next_cursor"]},
    ).json()
    assert next_page["attempts"][0]["attempt_id"] != detail["attempts"][0]["attempt_id"]
    assert (
        employee.get(f"/v1/admin/users/{first['user_id']}/requests/{request['request_id']}").status_code
        == 403
    )
    assert admin.get(f"/v1/admin/users/{uuid4()}/requests/{request['request_id']}").status_code == 404


@PERSON_ANALYTICS
def test_read_aloud_is_not_listed_as_a_request(setup):
    """The Requests list matches the request counts: read aloud is speech, not a request (G1)."""
    app, client, company, _, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    sent = observations(now[0])
    now[0] += timedelta(seconds=1)
    request, attempt = observations(now[0], count="0")
    request["action"] = "read_aloud"
    request["features"] = ["audio"]
    attempt["generation"]["media"] = [
        {"kind": "speech", "length_basis": "audio_frames", "seconds": "12.5", "characters": None}
    ]
    assert upload(client, credentials, [*sent, request, attempt]).status_code == 200
    listing = client.get("/v1/admin/requests").json()
    assert [row["request_id"] for row in listing["items"]] == [sent[0]["request_id"]]
    assert client.get("/v1/me/summary").json()["request_count"] == "1"


@PERSON_ANALYTICS
def test_request_keyset_survives_insert_delete_and_is_filter_bound(setup):
    app, client, company, _, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    requests = []
    for number in range(3):
        now[0] += timedelta(seconds=1)
        request, _ = observations(now[0])
        requests.append(request)
        upload(client, credentials, [request])
    first = client.get("/v1/admin/requests", params={"limit": 1}).json()
    assert first["items"][0]["request_id"] == requests[2]["request_id"]
    with app.state.db.transaction() as session:
        session.delete(
            session.get(
                Observation, (company.id, credentials["user_id"], "request", requests[2]["request_id"])
            )
        )
    now[0] += timedelta(seconds=1)
    new, _ = observations(now[0])
    upload(client, credentials, [new])
    second = client.get("/v1/admin/requests", params={"limit": 1, "cursor": first["next_cursor"]}).json()
    assert second["items"][0]["request_id"] == requests[1]["request_id"]
    rejected = client.get(
        "/v1/admin/requests", params={"limit": 1, "cursor": first["next_cursor"], "site": "claude"}
    )
    assert rejected.status_code == 422 and rejected.json()["error"]["code"] == "invalid_cursor"


@PERSON_ANALYTICS
def test_complete_model_breakdown_uses_all_rows_not_sample(setup):
    app, client, company, admin, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    # Valid fixtures create more than a UI page while preserving the same accepted numerical path.
    records = []
    for index in range(205):
        request, _ = observations(now[0])
        request["site"] = "claude" if index == 204 else "chatgpt"
        records.append(request)
    for offset in range(0, len(records), 100):
        assert upload(client, credentials, records[offset : offset + 100]).status_code == 200
    first = client.get("/v1/admin/breakdown", params={"group_by": "site", "limit": 1}).json()
    assert first["items"][0]["request_count"] == "204" and first["next_cursor"]
    second = client.get(
        "/v1/admin/breakdown", params={"group_by": "site", "limit": 1, "cursor": first["next_cursor"]}
    ).json()
    assert second["items"][0]["site"] == "claude" and second["items"][0]["request_count"] == "1"
    models = client.get("/v1/admin/breakdown", params={"group_by": "model", "user_id": admin.id}).json()
    assert models["items"][0]["model_id"] is None and models["items"][0]["request_count"] == "205"


@PERSON_ANALYTICS
def test_network_keyset_owner_device_filters_and_rejected_site_filter(setup):
    app, client, company, admin, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    for index in range(3):
        with app.state.db.transaction() as session:
            put(
                session,
                "network",
                str(uuid4()),
                {
                    "observed_at": instant(now[0] + timedelta(seconds=index)),
                    "device_id": credentials["device_id"],
                    "address": app.state.service.secrets.encrypt_ip("192.0.2.1"),
                    "equality": "e" * 64,
                    "source_quality": "server_observed",
                    "accepted_record_count": 1,
                },
                company.id,
                admin.id,
            )
    open_network(client)
    first = client.get(
        "/v1/admin/network", params={"limit": 1, "user_id": admin.id, "device_id": credentials["device_id"]}
    ).json()
    assert first["next_cursor"] and first["distinct_ips"] == "1" and first["time_basis"] == "upload_receipt"
    second = client.get(
        "/v1/admin/network",
        params={
            "limit": 1,
            "user_id": admin.id,
            "device_id": credentials["device_id"],
            "cursor": first["next_cursor"],
        },
    ).json()
    assert second["items"][0]["network_observation_id"] != first["items"][0]["network_observation_id"]
    assert client.get("/v1/admin/network", params={"site": "chatgpt"}).status_code == 422
    assert client.get("/v1/admin/network", params={"user_id": str(uuid4())}).json()["items"] == []


def test_connection_details_are_safe_expire_and_need_no_web_approval(setup):
    app, client, company, _, now, _ = setup
    extension = TestClient(app, base_url=company.data["origin"])
    extension.headers["Origin"] = "chrome-extension://test-extension"
    created, verifier = create_connection(app, extension, "admin@example.org")
    assert created.status_code == 200, created.text
    details = created.json()
    assert details["state"] == "verified" and details["company_name"] == "Example"
    assert details["policy"]["policy_version"] == "1.0.0" and details["deletion_public_key"]
    assert "display_phrase" not in details and "verification_path" not in details
    status = extension.post(
        "/v1/connections/status", json={"connection_id": details["connection_id"], "verifier": verifier}
    )
    assert status.status_code == 200 and status.json()["state"] == "verified"
    assert verifier not in status.text and "verifier_challenge" not in status.text
    assert "refresh_token" not in status.text
    # The website approval pages are gone; the email code took their place.
    login(app, client)
    assert client.get(f"/v1/connections/{details['connection_id']}/approval").status_code == 404
    approve = client.post(
        "/v1/connections/approve",
        json={"connection_id": details["connection_id"], "policy_version": "1.0.0", "disclosure_acknowledged": True},
    )
    assert approve.status_code == 404
    now[0] += timedelta(minutes=11)
    expired = extension.post(
        "/v1/connections/status", json={"connection_id": details["connection_id"], "verifier": verifier}
    )
    assert expired.json()["state"] == "expired"
    late = extension.post(
        "/v1/connections/exchange",
        json={
            "connection_id": details["connection_id"],
            "verifier": verifier,
            "exchange_id": str(uuid4()),
            "policy_version": "1.0.0",
            "disclosure_acknowledged": True,
        },
    )
    assert late.status_code == 410 and late.json()["error"]["code"] == "connection_expired"


@PERSON_ANALYTICS
def test_summary_export_has_lineage_coverage_and_expiry_and_async_records_roundtrip(setup):
    app, client, company, _, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    records = []
    for _ in range(55):
        records.extend(observations(now[0]))
    for offset in range(0, len(records), 100):
        upload(client, credentials, records[offset : offset + 100])
    summary = client.post("/v1/admin/exports", json=confirmed(client, {"format": "csv", "period": "all"})).json()
    assert summary["expires_at"] and summary["metadata"]["time_basis"]["attempts"] == "attempt_start"
    output = client.get(summary["download_path"])
    assert int(output.headers["Content-Length"]) == len(output.content) == summary["byte_length"]
    assert output.headers["X-Export-Integrity-SHA256"] == summary["integrity"]["digest"]
    rows = list(csv.DictReader(io.StringIO(output.text)))
    energy = next(row for row in rows if row["quantity"] == "energy")
    assert (
        energy["method_hash"]
        and energy["environment_scenario_id"]
        and energy["selected_profile_id"]
        and energy["calculation_view"] == "original"
    )
    assert (
        energy["applicable_count"] == "55"
        and energy["time_basis"] == "attempt_start"
        and energy["expires_at"] == summary["expires_at"]
    )
    exported = client.post("/v1/admin/exports", json=confirmed(client, {"report": "records", "period": "all"})).json()
    assert exported["status"] == "pending" and exported["row_count"] <= 100
    resumed = client.post(exported["status_path"] + "/advance", json={}).json()
    for _ in range(4):
        if resumed["status"] == "completed":
            break
        resumed = client.post(exported["status_path"] + "/advance", json={}).json()
    assert resumed["status"] == "completed" and resumed["row_count"] == 110
    rows = list(csv.DictReader(io.StringIO(client.get(resumed["download_path"]).text)))
    assert len(rows) == 110
    for row in rows:
        assert payload_hash(json.loads(row["observation_json"])) == row["payload_hash"]


def test_unexpected_error_keeps_same_correlation_without_markers(setup, monkeypatch):
    app, client, _, _, _, settings = setup
    login(app, client)
    original = app.state.service.handle

    def broken(*args, **kwargs):
        raise TypeError("PRIVATE-PROMPT MARKER private@example.org bearer-secret")

    monkeypatch.setattr(app.state.service, "handle", broken)
    response = client.get("/v1/admin/requests", params={"private": "PRIVATE-PATH-MARKER"})
    assert response.status_code == 500 and response.json()["error"]["code"] == "internal_error"
    assert "PRIVATE" not in response.text and "private@example.org" not in response.text
    correlation = response.json()["error"]["correlation_id"]
    monkeypatch.setattr(app.state.service, "handle", original)
    operator = operator_client(app, settings)
    diagnostics = operator.get("/v1/operator/diagnostics", params={"correlation_id": correlation})
    assert diagnostics.json()["items"] == [
        {
            "correlation_id": correlation,
            "category": "administration",
            "exception_class": "TypeError",
            "at": diagnostics.json()["items"][0]["at"],
        }
    ]
    assert "PRIVATE" not in diagnostics.text and "bearer-secret" not in diagnostics.text


@PERSON_ANALYTICS
def test_interrupted_revoked_and_corrupt_export_streams_are_detectable(setup):
    import pytest

    app, client, company, admin, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    records = []
    for _ in range(55):
        records.extend(observations(now[0]))
    for offset in range(0, len(records), 100):
        upload(client, credentials, records[offset : offset + 100])
    created = client.post("/v1/admin/exports", json=confirmed(client, {"report": "records", "period": "all"})).json()
    while created["status"] == "pending":
        created = client.post(created["status_path"] + "/advance", json={}).json()
    correlation = str(uuid4())
    stream = app.state.service.analytics.exports.stream(
        company.id, created["export_id"], admin.id, correlation
    )
    first = next(stream)
    assert len(first) < created["byte_length"]
    with app.state.db.transaction() as session:
        actor = get(session, "member", admin.id, company.id)
        actor.data = {**actor.data, "role": "user"}
    with pytest.raises(RuntimeError, match="^export_stream_interrupted$"):
        next(stream)
    with app.state.db.transaction() as session:
        diagnostic = get(session, "diagnostic", correlation)
        assert diagnostic.data["correlation_id"] == correlation
        actor = get(session, "member", admin.id, company.id)
        actor.data = {**actor.data, "role": "admin"}
    stream = app.state.service.analytics.exports.stream(company.id, created["export_id"], admin.id)
    next(stream)
    with app.state.db.transaction() as session:
        job = get(session, "export", created["export_id"], company.id)
        job.data = {**job.data, "deletion_epoch": -1}
    with pytest.raises(RuntimeError, match="^export_stream_interrupted$"):
        next(stream)
    with app.state.db.transaction() as session:
        job = get(session, "export", created["export_id"], company.id)
        job.data = {**job.data, "deletion_epoch": 0}
        chunk = get(session, "export_chunk", created["export_id"] + ":0000000000", company.id)
        chunk.data = {**chunk.data, "content": "PRIVATE-CORRUPT-MARKER"}
    stream = app.state.service.analytics.exports.stream(company.id, created["export_id"], admin.id)
    with pytest.raises(RuntimeError, match="^export_stream_interrupted$") as failure:
        next(stream)
    assert "PRIVATE" not in str(failure.value) and failure.value.__suppress_context__


def test_operator_plan_keyset_is_complete_and_cursor_is_route_bound(setup):
    app, _, _, _, _, settings = setup
    operator = operator_client(app, settings)
    with app.state.service.db.transaction() as session:
        for index in range(5):
            put(session, "plan", f"pagination-{index}:1", {"plan_id": f"pagination-{index}", "version": 1})
    first = operator.get("/v1/operator/plans?limit=2")
    assert first.status_code == 200 and first.json()["next_cursor"]
    cursor = first.json()["next_cursor"]
    seen = {(item["plan_id"], item["version"]) for item in first.json()["items"]}
    while cursor:
        response = operator.get("/v1/operator/plans", params={"limit": 2, "cursor": cursor})
        assert response.status_code == 200
        for item in response.json()["items"]:
            key = (item["plan_id"], item["version"])
            assert key not in seen
            seen.add(key)
        cursor = response.json()["next_cursor"]
    assert len(seen) >= 5
    rejected = operator.get(
        "/v1/operator/organizations", params={"limit": 2, "cursor": first.json()["next_cursor"]}
    )
    assert rejected.status_code == 422


def test_public_deployment_is_allowlisted_and_registration_origin_scoped(setup):
    app, tenant, _, _, _, settings = setup
    registration = TestClient(app, base_url=settings.registration_origin)
    response = registration.get("/v1/public/deployment")
    assert response.status_code == 200
    assert response.json() == {
        "mode": "hosted",
        "hosted_domain": settings.hosted_domain,
        "registration_origin": settings.registration_origin,
    }
    assert response.headers["cache-control"] == "no-store"
    assert tenant.get("/v1/public/deployment").status_code == 403
    assert (
        registration.get("/v1/public/deployment", headers={"Origin": "https://evil.example"}).status_code
        == 403
    )


@PERSON_ANALYTICS
def test_notebook_guide_is_not_listed_as_a_request(setup):
    """The Requests list matches the request counts: a notebook guide is not a request (W9)."""
    app, client, company, _, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    sent = observations(now[0])
    now[0] += timedelta(seconds=1)
    request, attempt = observations(now[0], count="0")
    request["site"] = "notebooklm"
    request["action"] = "notebook_guide"
    assert upload(client, credentials, [*sent, request, attempt]).status_code == 200
    listing = client.get("/v1/admin/requests").json()
    assert [row["request_id"] for row in listing["items"]] == [sent[0]["request_id"]]
    assert client.get("/v1/me/summary").json()["request_count"] == "1"


def activity(client, **params):
    response = client.get("/v1/admin/activity", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_same_request_uuid_other_owner_never_mixes_counts(setup):
    app, admin, company, _, now, _ = setup
    login(app, admin)
    first, _ = connect(app, admin)
    employee = TestClient(app, base_url=company.data["origin"])
    employee.headers["Origin"] = company.data["origin"]
    member_login(app, employee, "employee@example.org")
    second, _ = connect(app, employee)
    request, attempt = observations(now[0])
    assert upload(admin, first, [request, attempt]).status_code == 200
    second_attempt = {**attempt, "attempt_id": str(uuid4())}
    third_attempt = {**attempt, "attempt_id": str(uuid4())}
    assert upload(employee, second, [request, second_attempt, third_attempt]).status_code == 200
    # Each person's own figures keep their own attempts; the organization adds both people.
    assert admin.get("/v1/me/summary").json()["attempt_count"] == "1"
    assert employee.get("/v1/me/summary").json()["attempt_count"] == "2"
    whole = activity(admin)
    assert whole["request_count"] == "2" and whole["attempt_count"] == "3"
    assert [part["active_users"] for part in whole["days"].values()] == ["2"]
    with app.state.db.transaction(readonly=True) as session:
        for owner, attempts in ((first["user_id"], 1), (second["user_id"], 2)):
            rows = session.scalars(
                select(Observation).where(
                    Observation.tenant == company.id,
                    Observation.owner == owner,
                    Observation.kind == "attempt",
                    Observation.parent == request["request_id"],
                )
            )
            assert len(list(rows)) == attempts
    assert employee.get("/v1/admin/activity").status_code == 403


def test_read_aloud_is_not_counted_as_a_request(setup):
    """Activity matches the request counts: read aloud is speech, not a request (G1)."""
    app, client, company, _, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    sent = observations(now[0])
    now[0] += timedelta(seconds=1)
    request, attempt = observations(now[0], count="0")
    request["action"] = "read_aloud"
    request["features"] = ["audio"]
    attempt["generation"]["media"] = [
        {"kind": "speech", "length_basis": "audio_frames", "seconds": "12.5", "characters": None}
    ]
    assert upload(client, credentials, [*sent, request, attempt]).status_code == 200
    assert activity(client)["request_count"] == "1"
    assert client.get("/v1/me/summary").json()["request_count"] == "1"


def test_per_person_request_lists_and_the_network_page_are_off_by_default(setup):
    """Owner decision of 18 October 2026: with both switches off there is no request list per
    person and no Network page; the endpoints answer as if they did not exist."""
    app, client, company, admin, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, attempt = observations(now[0])
    assert upload(client, credentials, [request, attempt]).status_code == 200
    for path in (
        "/v1/admin/requests",
        f"/v1/admin/users/{admin.id}/requests/{request['request_id']}",
        "/v1/admin/network",
    ):
        response = client.get(path)
        assert response.status_code == 404 and response.json()["error"]["code"] == "not_found", path
    access = client.post("/v1/admin/network/access", json={"reauth_token": "x" * 43})
    assert access.status_code == 404


def test_summary_export_has_lineage_coverage_and_expiry_and_no_records_report(setup):
    app, client, company, _, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    records = []
    for _ in range(55):
        records.extend(observations(now[0]))
    for offset in range(0, len(records), 100):
        upload(client, credentials, records[offset : offset + 100])
    summary = client.post("/v1/admin/exports", json=confirmed(client, {"format": "csv", "period": "all"})).json()
    assert summary["expires_at"] and summary["metadata"]["time_basis"]["attempts"] == "attempt_start"
    output = client.get(summary["download_path"])
    assert int(output.headers["Content-Length"]) == len(output.content) == summary["byte_length"]
    assert output.headers["X-Export-Integrity-SHA256"] == summary["integrity"]["digest"]
    rows = list(csv.DictReader(io.StringIO(output.text)))
    energy = next(row for row in rows if row["quantity"] == "energy")
    assert (
        energy["method_hash"]
        and energy["environment_scenario_id"]
        and energy["selected_profile_id"]
        and energy["calculation_view"] == "original"
    )
    assert (
        energy["applicable_count"] == "55"
        and energy["time_basis"] == "attempt_start"
        and energy["expires_at"] == summary["expires_at"]
    )
    # The summary names no person: no column holds a member id.
    assert credentials["user_id"] not in output.text
    # Without person analytics there is no per-record report and no person filter (owner decision
    # of 18 October 2026).
    for body in ({"report": "records", "period": "all"}, {"period": "all", "user_id": credentials["user_id"]}):
        refused = client.post("/v1/admin/exports", json=confirmed(client, body))
        assert refused.status_code == 400, (body, refused.text)
        assert refused.json()["error"]["code"] == "person_analytics_disabled"


def test_notebook_guide_is_not_counted_as_a_request(setup):
    """Activity matches the request counts: a notebook guide is not a request (W9)."""
    app, client, company, _, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    sent = observations(now[0])
    now[0] += timedelta(seconds=1)
    request, attempt = observations(now[0], count="0")
    request["site"] = "notebooklm"
    request["action"] = "notebook_guide"
    assert upload(client, credentials, [*sent, request, attempt]).status_code == 200
    assert activity(client)["request_count"] == "1"
    assert client.get("/v1/me/summary").json()["request_count"] == "1"


def test_interrupted_summary_export_streams_are_detectable(setup):
    import pytest

    app, client, company, admin, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    records = []
    for _ in range(55):
        records.extend(observations(now[0]))
    for offset in range(0, len(records), 100):
        upload(client, credentials, records[offset : offset + 100])
    created = client.post("/v1/admin/exports", json=confirmed(client, {"period": "all"})).json()
    assert created["status"] == "completed"
    correlation = str(uuid4())
    stream = app.state.service.analytics.exports.stream(
        company.id, created["export_id"], admin.id, correlation
    )
    first = next(stream)
    # A summary is one chunk; the next read checks the administrator's role again.
    assert len(first) == created["byte_length"]
    with app.state.db.transaction() as session:
        actor = get(session, "member", admin.id, company.id)
        actor.data = {**actor.data, "role": "user"}
    with pytest.raises(RuntimeError, match="^export_stream_interrupted$"):
        next(stream)
    with app.state.db.transaction() as session:
        diagnostic = get(session, "diagnostic", correlation)
        assert diagnostic.data["correlation_id"] == correlation
        actor = get(session, "member", admin.id, company.id)
        actor.data = {**actor.data, "role": "admin"}
    stream = app.state.service.analytics.exports.stream(company.id, created["export_id"], admin.id)
    next(stream)
    with app.state.db.transaction() as session:
        job = get(session, "export", created["export_id"], company.id)
        job.data = {**job.data, "deletion_epoch": -1}
    with pytest.raises(RuntimeError, match="^export_stream_interrupted$"):
        next(stream)
    with app.state.db.transaction() as session:
        job = get(session, "export", created["export_id"], company.id)
        job.data = {**job.data, "deletion_epoch": 0}
        chunk = get(session, "export_chunk", created["export_id"] + ":0000000000", company.id)
        chunk.data = {**chunk.data, "content": "PRIVATE-CORRUPT-MARKER"}
    stream = app.state.service.analytics.exports.stream(company.id, created["export_id"], admin.id)
    with pytest.raises(RuntimeError, match="^export_stream_interrupted$") as failure:
        next(stream)
    assert "PRIVATE" not in str(failure.value) and failure.value.__suppress_context__


def test_breakdown_without_person_analytics_refuses_a_person(setup):
    """With person analytics off (the default) the breakdown is the organization's only."""
    app, client, company, admin, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, _ = observations(now[0])
    assert upload(client, credentials, [request]).status_code == 200
    models = client.get("/v1/admin/breakdown", params={"group_by": "model"}).json()
    assert models["items"][0]["request_count"] == "1" and models["items"][0]["active_users"] == "1"
    refused = client.get("/v1/admin/breakdown", params={"group_by": "model", "user_id": admin.id})
    assert refused.status_code == 400 and refused.json()["error"]["code"] == "person_analytics_disabled"
