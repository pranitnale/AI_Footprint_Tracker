"""Recorded-subset relations are metadata, never observation ingestion or history import."""

import shutil
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import timedelta
from uuid import uuid4

import pytest
from conftest import PERSON_ANALYTICS, connect, login, member_login
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from test_completion import finish_job, reauth
from test_file_text_contract import mixed_upload
from test_perplexity_identity import identity, records_for, statuses

from aift.db import Base, Observation, ThreadRelation, get, put
from aift.main import create_app
from aift.maintenance import run
from tools.verify_restore import RestoreVerificationError, verify_restored


def auth(credentials):
    return {"Authorization": "Bearer " + credentials["access_token"]}


def thread(credentials, identifier=None):
    return identity(credentials["user_hmac_key"], "route", identifier or str(uuid4()))


def body(key, requests, epoch=0):
    return {
        "site": "perplexity",
        "key_version": "1",
        "thread_key": key,
        "provider_request_keys": requests,
        "deletion_epoch": epoch,
        "source": "perplexity-thread-response-v1",
    }


def link(client, credentials, key, requests, epoch=0):
    return client.post("/v1/me/thread-relations", headers=auth(credentials), json=body(key, requests, epoch))


def summary(client, credentials, key):
    response = client.get(f"/v1/me/recorded-threads/{key}/summary?period=all", headers=auth(credentials))
    assert response.status_code == 200, response.text
    return response.json()


def seed(app, client, now, count=1):
    login(app, client)
    credentials, _ = connect(app, client)
    pairs = [records_for(credentials, now[0], str(uuid4()), str(uuid4())) for _ in range(count)]
    for pair in pairs:
        assert statuses(mixed_upload(client, credentials, list(pair))) == ["applied", "applied"]
    return credentials, pairs


def canonical_state(app):
    with app.state.db.transaction(readonly=True) as session:
        return {
            (r.tenant, r.owner, r.kind, r.id): (r.payload_hash, deepcopy(r.payload), deepcopy(r.estimate))
            for r in session.scalars(select(Observation))
        }


def table_counts(app):
    with app.state.db.transaction(readonly=True) as session:
        return {
            table.name: session.scalar(select(func.count()).select_from(table))
            for table in Base.metadata.sorted_tables
        }


def test_two_installations_reopen_only_recorded_subset_without_changing_usage(setup):
    app, client, _, _, now, _ = setup
    credentials, pairs = seed(app, client, now, 2)
    paired, _ = connect(app, client)
    duplicate = deepcopy(pairs[0])
    duplicate[0]["request_id"] = str(uuid4())
    duplicate[1]["request_id"] = duplicate[0]["request_id"]
    duplicate[1]["attempt_id"] = str(uuid4())
    replay = mixed_upload(client, paired, list(duplicate))
    promoted = duplicate[1]["attempt_id"] < pairs[0][1]["attempt_id"]
    assert statuses(replay) == ["aliased", "applied" if promoted else "aliased"]
    assert replay.json()["results"][1]["canonical_id"] == min(
        duplicate[1]["attempt_id"], pairs[0][1]["attempt_id"]
    )
    key = thread(credentials)
    request_keys = [r[0]["provider_request_key"] for r in pairs]
    before = canonical_state(app)
    global_before = client.get("/v1/me/summary?period=all", headers=auth(credentials)).json()
    response = link(client, paired, key, request_keys)
    assert response.status_code == 200, response.text
    assert response.json()["results"] == [
        {"provider_request_key": candidate, "status": "linked"} for candidate in request_keys
    ]
    assert link(client, credentials, key, request_keys).json() == response.json()
    value = summary(client, paired, key)
    assert value["status"] == "matched_recorded_subset"
    assert value["coverage"] == {
        "scope": "matched_recorded_requests",
        "provider_history_complete": False,
        "matched_request_count": "2",
    }
    assert value["summary"]["request_count"] == value["summary"]["attempt_count"] == "2"
    global_after = client.get("/v1/me/summary?period=all", headers=auth(credentials)).json()
    for field in ("request_count", "attempt_count", "tokens", "resources", "file_text", "file_text_coverage"):
        assert global_after[field] == global_before[field]
        assert value["summary"][field] == global_before[field]
    assert canonical_state(app) == before
    # Paired membership metadata does not grant another device revision ownership.
    revision = {**pairs[0][0], "revision": 2}
    assert mixed_upload(client, paired, [revision]).json()["results"][0]["error_code"] == "ownership_conflict"


def test_unknown_candidates_have_no_durable_side_effects_and_recover_after_ingest(setup):
    app, client, _, _, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, attempt = records_for(credentials, now[0], str(uuid4()), str(uuid4()))
    key, candidate = thread(credentials), request["provider_request_key"]
    before = table_counts(app)
    result = link(client, credentials, key, [candidate])
    assert result.status_code == 200, result.text
    assert result.json()["results"] == [{"provider_request_key": candidate, "status": "not_recorded"}]
    value = summary(client, credentials, key)
    assert value["status"] == "unavailable" and value["summary"] is None
    assert value["coverage"]["matched_request_count"] == "0"
    assert table_counts(app) == before
    assert statuses(mixed_upload(client, credentials, [request, attempt])) == ["applied", "applied"]
    assert summary(client, credentials, key)["status"] == "unavailable"
    assert link(client, credentials, key, [candidate]).json()["results"][0]["status"] == "linked"
    assert summary(client, credentials, key)["summary"]["request_count"] == "1"


def test_conflict_rejects_entire_batch_and_serialized_competing_threads(setup):
    app, client, _, _, now, _ = setup
    credentials, pairs = seed(app, client, now, 3)
    keys = [pair[0]["provider_request_key"] for pair in pairs]
    a, b = thread(credentials), thread(credentials)
    assert link(client, credentials, a, [keys[0]]).status_code == 200
    conflict = link(client, credentials, b, [keys[1], keys[0]])
    assert conflict.status_code == 409 and conflict.json()["error"]["code"] == "thread_relation_conflict"
    assert summary(client, credentials, b)["summary"] is None

    def competing(key):
        with TestClient(app, base_url=client.base_url) as other:
            return link(other, credentials, key, [keys[2]]).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(competing, [a, b])) == [200, 409]
    with app.state.db.transaction(readonly=True) as session:
        assert session.scalar(select(func.count()).select_from(ThreadRelation)) == 2


@pytest.mark.parametrize(
    "change",
    [
        {"site": "chatgpt"},
        {"key_version": "2"},
        {"thread_key": "A" * 64},
        {"thread_key": str(uuid4())},
        {"provider_request_keys": []},
        {"provider_request_keys": ["a" * 64] * 2},
        {"provider_request_keys": [f"{n:064x}" for n in range(101)]},
        {"provider_request_keys": ["raw-provider-id"]},
        {"deletion_epoch": True},
        {"source": "generation_frame"},
        {"prompt": "PRIVATE_SYNTHETIC_MARKER"},
        {"has_next_page": False},
        {"user_id": str(uuid4())},
        {"company_id": str(uuid4())},
    ],
)
def test_strict_relation_boundary_rejects_content_identity_and_page_metadata(setup, change):
    app, client, _, _, _, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    before = table_counts(app)
    result = client.post(
        "/v1/me/thread-relations", headers=auth(credentials), json={**body("b" * 64, ["a" * 64]), **change}
    )
    assert result.status_code == 422, result.text
    assert "PRIVATE_SYNTHETIC_MARKER" not in result.text
    assert table_counts(app) == before


def test_installation_origin_epoch_and_self_scope_are_required(setup):
    app, client, company, _, now, _ = setup
    credentials, pairs = seed(app, client, now)
    candidate, key = pairs[0][0]["provider_request_key"], thread(credentials)
    assert client.post("/v1/me/thread-relations", json=body(key, [candidate])).status_code == 403
    assert client.get(f"/v1/me/recorded-threads/{key}/summary").status_code == 403
    assert link(client, credentials, key, [candidate], 1).json()["error"]["code"] == "deletion_epoch_changed"
    response = client.post(
        "/v1/me/thread-relations",
        json=body(key, [candidate]),
        headers={**auth(credentials), "Origin": "https://evil.invalid"},
    )
    assert response.status_code == 403
    employee = TestClient(app, base_url=company.origin)
    employee.headers["Origin"] = company.origin
    member_login(app, employee, "employee@example.org")
    other, _ = connect(app, employee)
    assert link(employee, other, key, [candidate]).json()["results"][0]["status"] == "not_recorded"
    assert summary(employee, other, key)["summary"] is None
    assert link(client, credentials, key, [candidate]).status_code == 200
    for suffix in ("?user_id=" + credentials["user_id"], "?period=month", "?method_id=baseline"):
        assert (
            client.get(
                f"/v1/me/recorded-threads/{key}/summary{suffix}", headers=auth(credentials)
            ).status_code
            == 422
        )
    with app.state.db.transaction() as session:
        device = get(session, "device", credentials["device_id"], company.id)
        device.data = {**device.data, "status": "revoked"}
        device.status = "revoked"
    assert link(client, credentials, key, [candidate]).status_code == 403


def test_shared_canonical_attempt_is_counted_once_for_one_or_both_related_requests(setup):
    app, client, _, _, now, _ = setup
    credentials, pairs = seed(app, client, now)
    second, duplicate_attempt = records_for(credentials, now[0], str(uuid4()), str(uuid4()))
    duplicate_attempt["provider_attempt_key"] = pairs[0][1]["provider_attempt_key"]
    assert statuses(mixed_upload(client, credentials, [second, duplicate_attempt])) == ["applied", "aliased"]
    key = thread(credentials)
    assert link(client, credentials, key, [second["provider_request_key"]]).status_code == 200
    value = summary(client, credentials, key)["summary"]
    assert value["request_count"] == value["attempt_count"] == "1"
    assert link(client, credentials, key, [pairs[0][0]["provider_request_key"]]).status_code == 200
    value = summary(client, credentials, key)["summary"]
    assert value["request_count"] == "2" and value["attempt_count"] == "1"
    answer = next(row for row in value["tokens"] if row["quantity"] == "answer_output")
    assert answer["value"] == pairs[0][1]["tokens"]["answer_output"]["value"]


def test_future_skew_across_berlin_midnight_keeps_relation_until_summary_window_advances(setup):
    app, client, _, _, now, _ = setup
    now[0] = now[0].replace(hour=21, minute=59)
    login(app, client)
    credentials, _ = connect(app, client)
    pair = records_for(credentials, now[0] + timedelta(minutes=2), str(uuid4()), str(uuid4()))
    assert statuses(mixed_upload(client, credentials, list(pair))) == ["applied", "applied"]
    key = thread(credentials)
    assert link(client, credentials, key, [pair[0]["provider_request_key"]]).status_code == 200
    before = canonical_state(app)
    value = summary(client, credentials, key)
    assert value["status"] == "unavailable"
    assert value["coverage"]["matched_request_count"] == "0"
    assert value["summary"] is None
    with app.state.db.transaction(readonly=True) as session:
        assert session.scalar(select(func.count()).select_from(ThreadRelation)) == 1
    now[0] += timedelta(minutes=3)
    value = summary(client, credentials, key)
    assert value["status"] == "matched_recorded_subset"
    assert value["coverage"]["matched_request_count"] == value["summary"]["request_count"] == "1"
    assert value["summary"]["attempt_count"] == "1"
    assert canonical_state(app) == before


def test_midnight_window_counts_shared_attempt_once_as_second_request_becomes_current(setup):
    app, client, _, _, now, _ = setup
    now[0] = now[0].replace(hour=21, minute=59)
    credentials, pairs = seed(app, client, now)
    second, duplicate = records_for(credentials, now[0] + timedelta(minutes=2), str(uuid4()), str(uuid4()))
    duplicate["provider_attempt_key"] = pairs[0][1]["provider_attempt_key"]
    assert statuses(mixed_upload(client, credentials, [second, duplicate])) == ["applied", "aliased"]
    key = thread(credentials)
    candidates = [pairs[0][0]["provider_request_key"], second["provider_request_key"]]
    assert link(client, credentials, key, candidates).status_code == 200
    before = canonical_state(app)
    for expected in ("1", "2"):
        value = summary(client, credentials, key)
        assert value["coverage"]["matched_request_count"] == value["summary"]["request_count"] == expected
        assert value["summary"]["attempt_count"] == "1"
        answer = next(row for row in value["summary"]["tokens"] if row["quantity"] == "answer_output")
        assert answer["value"] == pairs[0][1]["tokens"]["answer_output"]["value"]
        now[0] += timedelta(minutes=3)
    assert canonical_state(app) == before


@pytest.mark.parametrize("include_resolved", [False, True])
def test_ambiguous_request_makes_entire_selected_subset_unavailable_without_mutation(setup, include_resolved):
    app, client, _, _, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    original = records_for(credentials, now[0], str(uuid4()), str(uuid4()))
    original[0]["provider_request_key"] = None
    assert statuses(mixed_upload(client, credentials, list(original))) == ["applied", "applied"]
    ambiguous = records_for(credentials, now[0], str(uuid4()), str(uuid4()))
    ambiguous[1]["provider_attempt_key"] = original[1]["provider_attempt_key"]
    result = mixed_upload(client, credentials, list(ambiguous))
    assert result.json()["results"][1]["error_code"] == "request_identity_ambiguous"
    candidates = [ambiguous[0]["provider_request_key"]]
    if include_resolved:
        resolved = records_for(credentials, now[0], str(uuid4()), str(uuid4()))
        assert statuses(mixed_upload(client, credentials, list(resolved))) == ["applied", "applied"]
        candidates.append(resolved[0]["provider_request_key"])
    key = thread(credentials)
    assert link(client, credentials, key, candidates).status_code == 200
    before = canonical_state(app)
    global_before = client.get("/v1/me/summary?period=all", headers=auth(credentials)).json()
    response = client.get(f"/v1/me/recorded-threads/{key}/summary?period=all", headers=auth(credentials))
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "thread_identity_unresolved"
    assert response.json()["error"]["retryable"] is True
    assert "summary" not in response.json()
    assert canonical_state(app) == before
    with app.state.db.transaction(readonly=True) as session:
        assert session.scalar(select(func.count()).select_from(ThreadRelation)) == len(candidates)
    global_after = client.get("/v1/me/summary?period=all", headers=auth(credentials)).json()
    for field in ("request_count", "attempt_count", "unresolved_request_count", "tokens", "resources"):
        assert global_after[field] == global_before[field]
    # A metadata revision does not prove that the contested execution identity was resolved.
    corrected = {**ambiguous[0], "revision": 2}
    assert statuses(mixed_upload(client, credentials, [corrected])) == ["applied"]
    assert (
        client.get(f"/v1/me/recorded-threads/{key}/summary?period=all", headers=auth(credentials)).json()[
            "error"
        ]["code"]
        == "thread_identity_unresolved"
    )


def test_tenant_scope_is_not_taken_from_opaque_keys_or_another_installation(setup):
    app, client, company, _, now, _ = setup
    first, pairs = seed(app, client, now)
    key, candidate = thread(first), pairs[0][0]["provider_request_key"]
    assert link(client, first, key, [candidate]).status_code == 200
    with app.state.db.transaction() as session:
        second = put(
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
        app.state.service.member(session, second, "admin@second.org", True)
    other = TestClient(app, base_url=second.origin)
    other.headers["Origin"] = second.origin
    login(app, other, "admin@second.org")
    credentials, _ = connect(app, other)
    assert link(other, first, key, [candidate]).status_code in {401, 403}
    assert link(other, credentials, key, [candidate]).json()["results"][0]["status"] == "not_recorded"
    assert summary(other, credentials, key)["summary"] is None
    pair = records_for(credentials, now[0], str(uuid4()), str(uuid4()))
    assert statuses(mixed_upload(other, credentials, list(pair))) == ["applied", "applied"]
    # The same opaque route string in another scope never joins the first tenant's records.
    assert link(other, credentials, key, [pair[0]["provider_request_key"]]).status_code == 200
    assert summary(other, credentials, key)["summary"]["request_count"] == "1"
    assert summary(client, first, key)["summary"]["request_count"] == "1"
    with app.state.db.transaction(readonly=True) as session:
        assert session.scalar(select(func.count()).select_from(ThreadRelation)) == 2


def test_rebuilding_cannot_be_presented_as_a_current_recorded_subset(setup):
    app, client, company, _, now, _ = setup
    credentials, pairs = seed(app, client, now)
    key, candidate = thread(credentials), pairs[0][0]["provider_request_key"]
    assert link(client, credentials, key, [candidate]).status_code == 200
    with app.state.db.transaction() as session:
        current = get(session, "company", company.id)
        current.data = {**current.data, "aggregate_status": "rebuilding"}
    response = client.get(f"/v1/me/recorded-threads/{key}/summary?period=all", headers=auth(credentials))
    assert response.status_code == 409 and response.json()["error"]["code"] == "aggregate_rebuilding"
    assert link(client, credentials, key, [candidate]).status_code == 409


def test_full_user_erasure_removes_relations_and_revokes_future_lookups(setup):
    app, client, company, admin, now, _ = setup
    login(app, client)
    employee = TestClient(app, base_url=company.origin)
    employee.headers["Origin"] = company.origin
    member_login(app, employee, "employee@example.org")
    credentials, _ = connect(app, employee)
    pair = records_for(credentials, now[0], str(uuid4()), str(uuid4()))
    assert statuses(mixed_upload(employee, credentials, list(pair))) == ["applied", "applied"]
    key, candidate = thread(credentials), pair[0]["provider_request_key"]
    assert link(employee, credentials, key, [candidate]).status_code == 200
    preview = client.post(
        "/v1/admin/deletions/preview", json={"scope": "user", "user_id": credentials["user_id"]}
    ).json()
    operation = str(uuid4())
    response = client.post(
        "/v1/admin/deletions",
        json={
            "preview_token": preview["preview_token"],
            "idempotency_key": operation,
            "confirmed": True,
            "reauth_token": reauth(app, company, admin),
        },
    )
    assert response.status_code == 200, response.text
    finish_job(app, company, operation)
    with app.state.db.transaction(readonly=True) as session:
        assert session.scalar(select(func.count()).select_from(ThreadRelation)) == 0
    assert link(employee, credentials, key, [candidate]).status_code in {401, 403}


def test_retention_immediately_hides_relation_then_worker_removes_it(setup):
    app, client, company, _, now, _ = setup
    credentials, pairs = seed(app, client, now)
    key, candidate = thread(credentials), pairs[0][0]["provider_request_key"]
    assert link(client, credentials, key, [candidate]).status_code == 200
    now[0] += timedelta(days=400)
    # Renew only the synthetic credential expiry so this test reaches retention checks.
    with app.state.db.transaction() as session:
        from aift.security import digest

        access = get(session, "access", digest(credentials["access_token"]), company.id)
        access.data = {**access.data, "expires": app.state.service.expires(600)}
    assert summary(client, credentials, key)["status"] == "unavailable"
    assert link(client, credentials, key, [candidate]).json()["results"][0]["status"] == "not_recorded"
    for _ in range(10):
        run(app.state.service)
    with app.state.db.transaction(readonly=True) as session:
        assert session.scalar(select(func.count()).select_from(ThreadRelation)) == 0


def test_old_backup_relation_cannot_survive_protected_range_erasure_replay(setup, tmp_path):
    app, client, company, admin, now, settings = setup
    credentials, pairs = seed(app, client, now)
    key, candidate = thread(credentials), pairs[0][0]["provider_request_key"]
    assert link(client, credentials, key, [candidate]).status_code == 200
    database_path = app.state.db.engine.url.database
    backup = tmp_path / "before-relations-erasure.db"
    with sqlite3.connect(database_path) as source, sqlite3.connect(backup) as destination:
        source.backup(destination)
    preview = client.post(
        "/v1/admin/deletions/preview",
        json={"scope": "range", "start": "2026-09-10T00:00:00.000Z", "end": "2026-09-11T00:00:00.000Z"},
    ).json()
    operation = str(uuid4())
    deleted = client.post(
        "/v1/admin/deletions",
        json={
            "preview_token": preview["preview_token"],
            "idempotency_key": operation,
            "confirmed": True,
            "reauth_token": reauth(app, company, admin),
        },
    )
    assert deleted.status_code == 200, deleted.text
    during = link(client, credentials, key, [candidate])
    assert during.status_code == 409
    finish_job(app, company, operation)
    assert summary(client, credentials, key)["summary"] is None
    with app.state.db.transaction(readonly=True) as session:
        assert session.scalar(select(func.count()).select_from(ThreadRelation)) == 0
    app.state.db.engine.dispose()
    shutil.copyfile(backup, database_path)
    restored = create_app(settings, clock=lambda: now[0])
    result = verify_restored(restored.state.service)
    assert result["status"] == "passed"
    with restored.state.db.transaction(readonly=True) as session:
        assert session.scalar(select(func.count()).select_from(ThreadRelation)) == 0
        assert session.scalar(select(func.count()).select_from(Observation)) == 0
    restored_client = TestClient(restored, base_url=company.origin)
    assert summary(restored_client, credentials, key)["summary"] is None
    assert link(restored_client, credentials, key, [candidate]).status_code == 409
    assert (
        link(restored_client, credentials, key, [candidate], 1).json()["results"][0]["status"]
        == "not_recorded"
    )


def test_restore_rejects_a_relation_to_an_incompatible_canonical_site(setup):
    app, client, company, admin, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    pair = records_for(credentials, now[0], str(uuid4()), str(uuid4()))
    pair[0]["site"] = "chatgpt"
    assert statuses(mixed_upload(client, credentials, list(pair))) == ["applied", "applied"]
    # Normal retention maintenance establishes the authenticated journal and head through production primitives.
    run(app.state.service)
    with app.state.db.transaction() as session:
        # Simulate inconsistent restored metadata independently of the API's scoped resolver.
        session.add(
            ThreadRelation(
                tenant=company.id,
                owner=admin.id,
                provider_request_key=pair[0]["provider_request_key"],
                thread_key=thread(credentials),
            )
        )
    with pytest.raises(RestoreVerificationError, match="restore_thread_relation_invalid"):
        verify_restored(app.state.service)


@pytest.mark.parametrize("conflict", ["conversation", "site", "model"])
def test_shared_execution_does_not_override_conflicting_scope_or_model(setup, conflict):
    from aift.db import RequestAttemptLink

    app, client, company, member, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    first = records_for(credentials, now[0], str(uuid4()), str(uuid4()))
    first[1]["model_id"] = "chatgpt-gpt-5-5"
    if conflict == "conversation":
        first[0].update(conversation_key="d" * 64, coverage_reasons=[])
    assert statuses(mixed_upload(client, credentials, list(first))) == ["applied", "applied"]
    before = canonical_state(app)
    second = records_for(credentials, now[0], str(uuid4()), str(uuid4()))
    second[1].update(provider_attempt_key=first[1]["provider_attempt_key"], model_id=first[1]["model_id"])
    if conflict == "conversation":
        second[0].update(conversation_key="e" * 64, coverage_reasons=[])
    elif conflict == "site":
        second[0]["site"] = "chatgpt"
    else:
        second[1]["model_id"] = "chatgpt-gpt-5-6-sol"
    response = mixed_upload(client, credentials, list(second))
    assert statuses(response) == ["applied", "conflict"]
    assert response.json()["results"][1]["error_code"] == "identity_conflict"
    after = canonical_state(app)
    assert all(after[key] == value for key, value in before.items())
    with app.state.db.transaction(readonly=True) as session:
        assert session.scalar(select(func.count()).select_from(RequestAttemptLink)) == 0
        assert session.get(Observation, (company.id, member.id, "attempt", second[1]["attempt_id"])) is None


@PERSON_ANALYTICS
def test_shared_execution_keeps_originating_attribution_even_when_later_dispatch_has_timer(setup):
    from test_timing_reconciliation import timer

    from aift.db import RequestAttemptLink

    app, client, company, member, now, _ = setup
    credentials, pairs = seed(app, client, now)
    first_request, first_attempt = pairs[0]
    before = canonical_state(app)
    second, copy = records_for(credentials, now[0], str(uuid4()), str(uuid4()))
    copy.update(provider_attempt_key=first_attempt["provider_attempt_key"], timing=timer())
    response = mixed_upload(client, credentials, [second, copy])
    assert statuses(response) == ["applied", "aliased"]
    assert response.json()["results"][1]["canonical_id"] == first_attempt["attempt_id"]
    after = canonical_state(app)
    assert all(after[key] == value for key, value in before.items())
    with app.state.db.transaction(readonly=True) as session:
        origin = session.get(Observation, (company.id, member.id, "attempt", first_attempt["attempt_id"]))
        alias = session.get(Observation, (company.id, member.id, "attempt", copy["attempt_id"]))
        assert origin.status == "current" and origin.parent == first_request["request_id"]
        assert origin.payload["timing"] is None
        assert alias.status == "aliased" and alias.payload == copy
        assert session.get(RequestAttemptLink, (company.id, member.id, second["request_id"], origin.id))
    key = thread(credentials)
    assert (
        link(
            client, credentials, key, [first_request["provider_request_key"], second["provider_request_key"]]
        ).status_code
        == 200
    )
    value = summary(client, credentials, key)["summary"]
    assert value["request_count"] == "2" and value["attempt_count"] == "1"
    for request in (first_request, second):
        detail = client.get(f"/v1/admin/users/{member.id}/requests/{request['request_id']}")
        assert detail.status_code == 200 and detail.json()["attempt_count"] == "1", detail.text


def test_shared_execution_counts_each_request_once_without_person_analytics(setup):
    from test_timing_reconciliation import timer

    from aift.db import RequestAttemptLink

    app, client, company, member, now, _ = setup
    credentials, pairs = seed(app, client, now)
    first_request, first_attempt = pairs[0]
    before = canonical_state(app)
    second, copy = records_for(credentials, now[0], str(uuid4()), str(uuid4()))
    copy.update(provider_attempt_key=first_attempt["provider_attempt_key"], timing=timer())
    response = mixed_upload(client, credentials, [second, copy])
    assert statuses(response) == ["applied", "aliased"]
    assert response.json()["results"][1]["canonical_id"] == first_attempt["attempt_id"]
    after = canonical_state(app)
    assert all(after[key] == value for key, value in before.items())
    with app.state.db.transaction(readonly=True) as session:
        origin = session.get(Observation, (company.id, member.id, "attempt", first_attempt["attempt_id"]))
        alias = session.get(Observation, (company.id, member.id, "attempt", copy["attempt_id"]))
        assert origin.status == "current" and origin.parent == first_request["request_id"]
        assert origin.payload["timing"] is None
        assert alias.status == "aliased" and alias.payload == copy
        assert session.get(RequestAttemptLink, (company.id, member.id, second["request_id"], origin.id))
    key = thread(credentials)
    assert (
        link(
            client, credentials, key, [first_request["provider_request_key"], second["provider_request_key"]]
        ).status_code
        == 200
    )
    value = summary(client, credentials, key)["summary"]
    assert value["request_count"] == "2" and value["attempt_count"] == "1"
    # Each request counts the one attempt: the first as its own, the second through the link.
    with app.state.db.transaction(readonly=True) as session:
        for request in (first_request, second):
            own = session.scalars(
                select(Observation.id).where(
                    Observation.tenant == company.id,
                    Observation.owner == member.id,
                    Observation.kind == "attempt",
                    Observation.status != "aliased",
                    Observation.parent == request["request_id"],
                )
            ).all()
            linked = session.scalars(
                select(RequestAttemptLink.attempt_id).where(
                    RequestAttemptLink.tenant == company.id,
                    RequestAttemptLink.owner == member.id,
                    RequestAttemptLink.request_id == request["request_id"],
                )
            ).all()
            assert len(set(own) | set(linked)) == 1, request["request_id"]
