import csv
import io
import json
from copy import deepcopy
from dataclasses import asdict
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from conftest import PERSON_ANALYTICS, confirmed, connect, login, member_login, restore_pre_0007_schema
from fastapi.testclient import TestClient
from footprint_contracts import payload_hash
from sqlalchemy import select
from test_analytics import observations, upload
from test_completion import reauth
from test_method_history import install_bundle

from aift.db import TABLES, Observation, get
from aift.maintenance import run
from aift.security import canonical, instant


def component(value="123", origin="new_upload", partial=False):
    return {
        "component_id": str(uuid4()),
        "origin": origin,
        "extraction_profile_id": "local-file-text-utf8-pdfjs6.3.289-opc-v1",
        "page_count": 2,
        "tokens": {
            "value": value,
            "evidence": "heuristic_estimate" if value is not None else "unknown",
            "scope": "extracted_file_text",
            "completeness": "partial"
            if partial
            else "complete_for_scope"
            if value is not None
            else "unknown",
            "profile_id": "o200k-base-4.0.0-reference" if value is not None else None,
            "reason": "tokenizer_mapping_unverified" if value is not None else "tokenizer_unavailable",
        },
        "missing": ["provider_processing", "ocr"],
    }


def current(now, extracted):
    request, attempt = observations(now)
    request["schema_version"] = attempt["schema_version"] = "3.0.0"
    request["documents"].update(extracted_text=extracted, types=["text_pdf"], processing="opaque")
    return request, attempt


def mixed_upload(client, credentials, records, epoch=0, version="3.0.0"):
    return client.post(
        "/v1/usage/batches",
        headers={"Authorization": "Bearer " + credentials["access_token"]},
        json={
            "schema_version": version,
            "batch_id": str(uuid4()),
            "sent_at": records[0].get("dispatched_at", records[0].get("started_at")),
            "client_version": "0.1.0",
            "deletion_epoch": epoch,
            "records": records,
        },
    )


def applied(response):
    assert response.status_code == 200, response.text
    assert all(r["status"] == "applied" for r in response.json()["results"]), response.text


def test_current_revisions_exact_hashes_and_nonadditive_file_deltas(setup):
    app, client, company, admin, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    old_request, old_attempt = observations(now[0])
    applied(upload(client, credentials, [old_request, old_attempt]))
    original = client.get("/v1/me/summary").json()
    with app.state.db.transaction(readonly=True) as session:
        old_estimate = deepcopy(
            session.get(Observation, (company.id, admin.id, "attempt", old_attempt["attempt_id"])).estimate
        )
    correction = deepcopy(old_request)
    correction.update(schema_version="3.0.0", revision=2)
    correction["documents"]["extracted_text"] = [
        component("9223372036854775807"),
        component("9223372036854775807"),
        component(None, "retained_context"),
    ]
    first = mixed_upload(client, credentials, [correction, old_attempt])
    assert [r["status"] for r in first.json()["results"]] == ["applied", "duplicate"], first.text
    assert [r["payload_hash"] for r in first.json()["results"]] == [
        payload_hash(correction),
        payload_hash(old_attempt),
    ]
    run(app.state.service)
    summary = client.get("/v1/me/summary").json()
    assert summary["tokens"] == original["tokens"] and summary["resources"] == original["resources"]
    assert summary["file_text_coverage"] == {
        "observed_request_count": "1",
        "unknown_request_count": "0",
        "scope": "extracted_file_text",
        "additive": False,
    }
    known = next(s for s in summary["file_text"] if s["measurement_group"]["origin"] == "new_upload")
    assert known["value"] == "18446744073709551614" and known["contributing_component_count"] == 2
    assert known["applicable_count"] == known["unvalidated_count"] == 2 and known["additive"] is False
    assert "contributing_attempt_count" not in known
    unknown = next(s for s in summary["file_text"] if s["measurement_group"]["origin"] == "retained_context")
    assert unknown["value"] is None and unknown["unknown_count"] == 1
    correction["revision"] = 3
    correction["documents"]["extracted_text"] = [component("7", partial=True)]
    applied(mixed_upload(client, credentials, [correction]))
    decreased = client.get("/v1/me/summary").json()["file_text"]
    assert len(decreased) == 1 and decreased[0]["value"] == "7" and decreased[0]["partial_count"] == 1
    assert decreased[0]["missing_counts"] == {"provider_processing": 1, "ocr": 1}
    assert mixed_upload(client, credentials, [correction]).json()["results"][0]["status"] == "duplicate"
    with app.state.db.transaction(readonly=True) as session:
        saved = session.get(Observation, (company.id, admin.id, "request", correction["request_id"]))
        assert saved.payload == correction and saved.payload_hash == payload_hash(correction)
        assert (
            session.get(Observation, (company.id, admin.id, "attempt", old_attempt["attempt_id"])).estimate
            == old_estimate
        )
        originals = list(
            session.scalars(select(TABLES["revision"]).where(TABLES["revision"].tenant == company.id))
        )
        assert any(row.data.get("record") == old_request for row in originals)
    assert upload(client, credentials, [old_request]).json()["results"][0]["status"] == "stale"


@PERSON_ANALYTICS
def test_file_coverage_null_empty_partial_and_origin_profile_groups_export(setup):
    app, client, company, admin, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    old, _ = observations(now[0])
    null, _ = current(now[0], None)
    empty, _ = current(now[0], [])
    a = component("4", "retained_context", True)
    b = component("8", "retained_context")
    b["tokens"]["profile_id"] = "cl100k-base-4.0.0-reference"
    counted, _ = current(now[0], [a, b, component(None, "unknown_origin")])
    counted["documents"]["upload_count"] = "0"
    applied(mixed_upload(client, credentials, [old, null, empty, counted]))
    summary = client.get("/v1/me/summary").json()
    assert (
        summary["file_text_coverage"]["observed_request_count"]
        == summary["file_text_coverage"]["unknown_request_count"]
        == "2"
    )
    assert len(summary["file_text"]) == 3 and not summary["tokens"] and not summary["resources"]
    detail = client.get(f"/v1/admin/users/{admin.id}/requests/{counted['request_id']}")
    assert detail.status_code == 200, detail.text
    assert "extracted_text" in detail.text
    created = client.post("/v1/admin/exports", json=confirmed(client, {"report": "summary"}))
    assert created.status_code == 200, created.text
    downloaded = client.get(created.json()["download_path"])
    assert downloaded.status_code == 200, downloaded.text
    rows = list(csv.DictReader(io.StringIO(downloaded.text)))
    files = [r for r in rows if r["quantity"] == "extracted_file_text"]
    assert len(files) == 3 and {r["value"] for r in files} == {"4", "8", ""}
    assert all(
        r["time_basis"] == "dispatch" and r["additive"] == "False" and r["contributing_attempt_count"] == ""
        for r in files
    )
    assert all(json.loads(r["missing_counts"])["provider_processing"] == 1 for r in files)
    assert {r["quantity"]: r["value"] for r in rows if r["quantity"].startswith("file_text_")} == {
        "file_text_observed_request_count": "2",
        "file_text_unknown_request_count": "2",
    }
    records_job = client.post("/v1/admin/exports", json=confirmed(client, {"report": "records"}))
    assert records_job.status_code == 200, records_job.text
    records_csv = client.get(records_job.json()["download_path"])
    assert records_csv.status_code == 200, records_csv.text
    exported = next(
        row
        for row in csv.DictReader(io.StringIO(records_csv.text))
        if row["record_id"] == counted["request_id"]
    )
    assert json.loads(exported["observation_json"]) == counted
    assert exported["payload_hash"] == payload_hash(counted)


@pytest.mark.parametrize(
    "category", ["observed", "profile", "origin", "partial", "unknown", "missing", "component_presence"]
)
def test_one_persons_file_category_is_shared_original_and_canonical(setup, category):
    app, admin_client, company, _, now, _ = setup
    login(app, admin_client)
    for index in range(5):
        employee = TestClient(app, base_url=company.origin)
        employee.headers["Origin"] = company.origin
        member_login(app, employee, f"person{index}@example.org")
        credentials, _ = connect(app, employee)
        c = component("123")
        extracted = [c]
        if index == 0:
            if category == "observed":
                extracted = None
            elif category == "profile":
                c["tokens"]["profile_id"] = "cl100k-base-4.0.0-reference"
            elif category == "origin":
                c["origin"] = "retained_context"
            elif category == "partial":
                c["tokens"]["completeness"] = "partial"
            elif category == "unknown":
                extracted = [component(None)]
            elif category == "missing":
                c["missing"].append("retrieval_selection")
            elif category == "component_presence":
                extracted = []
        request, attempt = current(now[0], extracted)
        applied(mixed_upload(employee, credentials, [request, attempt]))
    # Members see the same file groups as administrators, even one person's (13 October 2026).
    administrative = admin_client.get("/v1/admin/summary").json()
    result = employee.get("/v1/company/summary").json()
    assert result["suppressed"] is False and result["file_text"] == administrative["file_text"], result
    assert result["file_text_coverage"] == administrative["file_text_coverage"]
    with app.state.db.transaction(readonly=True) as session:
        tenant = get(session, "company", company.id)
        member = get(session, "member", credentials["user_id"], company.id)
        result = app.state.service.analytics._canonical_summary(session, tenant, member, {}, private=True)
        assert result["suppressed"] is False and result["request_count"] == "5", result
    run(app.state.service)
    bundle = install_bundle(app, now[0])
    created = admin_client.post(
        "/v1/admin/recalculations", json={"method_id": bundle["method_id"], "operation_id": str(uuid4())}
    )
    assert created.status_code == 200, created.text
    for _ in range(3):
        run(app.state.service)
    options = {"calculation_view": "recalculated", "method_id": bundle["method_id"]}
    response = employee.get("/v1/company/summary", params=options)
    assert response.status_code == 200 and response.json()["suppressed"] is False, response.text
    administrative = admin_client.get("/v1/admin/summary", params=options).json()
    assert response.json()["file_text"] == administrative["file_text"]


def test_five_matching_contributors_release_file_groups_in_both_views(setup):
    app, _, company, _, now, _ = setup
    for index in range(5):
        client = TestClient(app, base_url=company.origin)
        client.headers["Origin"] = company.origin
        member_login(app, client, f"person{index}@example.org")
        credentials, _ = connect(app, client)
        request, attempt = current(
            now[0], [component("3", partial=True), component(None, "retained_context")]
        )
        applied(mixed_upload(client, credentials, [request, attempt]))
    result = client.get("/v1/company/summary").json()
    assert result["suppressed"] is False and len(result["file_text"]) == 2, result
    assert next(r for r in result["file_text"] if r["value"] is not None)["value"] == "15"
    with app.state.db.transaction(readonly=True) as session:
        tenant = get(session, "company", company.id)
        member = get(session, "member", credentials["user_id"], company.id)
        result = app.state.service.analytics._canonical_summary(session, tenant, member, {}, private=True)
        assert result["suppressed"] is False and len(result["file_text"]) == 2


def test_identifiable_bad_file_record_keeps_mixed_batch_independent_progress(setup):
    app, client, _, _, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    invalid, _ = current(now[0], [component()])
    invalid["documents"]["extracted_text"][0]["filename"] = "PRIVATE_MARKER.pdf"
    valid, _ = observations(now[0])
    result = mixed_upload(client, credentials, [invalid, valid])
    assert result.status_code == 200 and "PRIVATE_MARKER" not in result.text
    assert [r["status"] for r in result.json()["results"]] == ["rejected", "applied"], result.text
    current_request, _ = current(now[0], None)
    old, _ = observations(now[0])
    result = mixed_upload(client, credentials, [current_request, old], version="1.1.0")
    assert result.status_code == 422


def test_file_deletion_removes_family_and_blocks_new_id_resurrection(setup):
    app, client, company, admin, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, attempt = current(now[0], [component("9")])
    applied(mixed_upload(client, credentials, [request, attempt]))
    body = {
        "scope": "range",
        "start": instant(now[0] - timedelta(seconds=1)),
        "end": instant(now[0] + timedelta(seconds=1)),
    }
    preview = client.post("/v1/admin/deletions/preview", json=body)
    assert preview.status_code == 200, preview.text
    result = client.post(
        "/v1/admin/deletions",
        json={
            "preview_token": preview.json()["preview_token"],
            "confirmed": True,
            "idempotency_key": str(uuid4()),
            "reauth_token": reauth(app, company, admin),
        },
    )
    assert result.status_code == 200, result.text
    for _ in range(4):
        run(app.state.service)
    with app.state.db.transaction(readonly=True) as session:
        assert not list(session.scalars(select(Observation).where(Observation.tenant == company.id)))
    replacement, _ = current(now[0], [component("9")])
    result = mixed_upload(client, credentials, [replacement], epoch=1)
    assert result.json()["results"][0]["status"] == "erased", result.text
    assert client.get("/v1/me/summary").json()["file_text"] == []


def test_file_0005_upgrade_rebuilds_only_projections_and_preserves_receipt_hashes(
    setup, tmp_path, monkeypatch
):
    app, client, company, _, now, settings = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, attempt = observations(now[0])
    applied(upload(client, credentials, [request, attempt]))
    with app.state.db.transaction() as session:
        before = [
            canonical([r.payload, r.payload_hash, r.estimate])
            for r in session.scalars(select(Observation).order_by(Observation.kind))
        ]
        for row in session.scalars(select(TABLES["rollup"])):
            value = {
                k: v for k, v in row.data["value"].items() if k not in {"file_text", "file_text_coverage"}
            }
            row.data = {**row.data, "value": value}
    settings_file = tmp_path / "upgrade.json"
    settings_file.write_text(json.dumps(asdict(settings)))
    monkeypatch.setenv("AIFT_SETTINGS_FILE", str(settings_file))
    server = Path(__file__).resolve().parents[1]
    config = Config(str(server / "alembic.ini"))
    config.set_main_option("script_location", str(server / "migrations"))
    with app.state.db.engine.begin() as connection:
        restore_pre_0007_schema(connection, 4)
    command.stamp(config, "0004")
    command.upgrade(config, "head")
    assert client.get("/v1/me/summary").json()["aggregate_status"] == "rebuilding"
    for _ in range(4):
        run(app.state.service)
    result = client.get("/v1/me/summary").json()
    assert (
        result["aggregate_status"] == "current"
        and result["file_text_coverage"]["unknown_request_count"] == "0"
    ), result
    with app.state.db.transaction(readonly=True) as session:
        after = [
            canonical([r.payload, r.payload_hash, r.estimate])
            for r in session.scalars(select(Observation).order_by(Observation.kind))
        ]
        assert before and after == []
    result = upload(client, credentials, [request, attempt])
    assert [r["status"] for r in result.json()["results"]] == ["applied", "applied"]
    assert [r["payload_hash"] for r in result.json()["results"]] == [
        payload_hash(request),
        payload_hash(attempt),
    ]


@pytest.mark.parametrize("promote", [False, True])
def test_cross_installation_request_alias_never_unions_random_components(setup, promote):
    app, client, company, admin, now, _ = setup
    login(app, client)
    first, _ = connect(app, client)
    second, _ = connect(app, client)
    request, attempt = current(now[0], [component("11")])
    first_id = "00000000-0000-4000-8000-000000000011"
    second_id = "00000000-0000-4000-8000-000000000012"
    attempt["attempt_id"] = second_id if promote else first_id
    request["provider_request_key"] = "b" * 64
    attempt["provider_attempt_key"] = "c" * 64
    applied(mixed_upload(client, first, [request, attempt]))
    duplicate = deepcopy(request)
    duplicate["request_id"] = str(uuid4())
    duplicate["documents"]["extracted_text"][0]["component_id"] = str(uuid4())
    other = {
        **attempt,
        "attempt_id": first_id if promote else second_id,
        "request_id": duplicate["request_id"],
    }
    response = mixed_upload(client, second, [duplicate, other])
    assert [r["status"] for r in response.json()["results"]] == [
        "aliased",
        "applied" if promote else "aliased",
    ], response.text
    assert response.json()["results"][1]["canonical_id"] == first_id
    summary = client.get("/v1/me/summary").json()
    assert summary["request_count"] == summary["attempt_count"] == "1"
    assert len(summary["file_text"]) == 1 and summary["file_text"][0]["value"] == "11"
    assert summary["file_text"][0]["contributing_component_count"] == 1
    assert summary["file_text_coverage"]["observed_request_count"] == "1"
    with app.state.db.transaction(readonly=True) as session:
        saved = session.get(Observation, (company.id, admin.id, "request", request["request_id"]))
        assert saved.payload == request and saved.payload_hash == payload_hash(request)
        alias = session.get(Observation, (company.id, admin.id, "request", duplicate["request_id"]))
        assert alias is not None and alias.status == "aliased" and alias.stable_key is None
        assert alias.payload == duplicate and alias.payload_hash == payload_hash(duplicate)
    # A real distinct dispatch has its own retained component, without a new upload or an extra attempt.
    retained = deepcopy(duplicate)
    retained["request_id"] = str(uuid4())
    retained["provider_request_key"] = "d" * 64
    retained["documents"]["upload_count"] = "0"
    retained["documents"]["extracted_text"][0].update(component_id=str(uuid4()), origin="retained_context")
    shared = {**other, "attempt_id": str(uuid4()), "request_id": retained["request_id"]}
    response = mixed_upload(client, second, [retained, shared])
    assert [r["status"] for r in response.json()["results"]] == ["applied", "aliased"], response.text
    summary = client.get("/v1/me/summary").json()
    assert summary["request_count"] == "2" and summary["attempt_count"] == "1"
    assert {r["measurement_group"]["origin"]: r["value"] for r in summary["file_text"]} == {
        "new_upload": "11",
        "retained_context": "11",
    }
    assert len(summary["resources"]) > 0


def test_file_retention_hides_immediately_then_erases_metadata_and_rejects_reupload(setup):
    app, client, company, admin, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, attempt = current(now[0], [component("31")])
    applied(mixed_upload(client, credentials, [request, attempt]))
    now[0] += timedelta(days=220)
    login(app, client)
    summary = client.get("/v1/me/summary").json()
    assert summary["file_text"] == [] and summary["file_text_coverage"]["observed_request_count"] == "0"
    assert client.get("/v1/usage/records/request/" + request["request_id"]).status_code == 404
    for _ in range(5):
        run(app.state.service)
    with app.state.db.transaction(readonly=True) as session:
        assert session.get(Observation, (company.id, admin.id, "request", request["request_id"])) is None
        assert not list(
            session.scalars(select(TABLES["revision"]).where(TABLES["revision"].tenant == company.id))
        )
    refreshed, _ = connect(app, client)
    result = mixed_upload(client, refreshed, [request])
    assert result.json()["results"][0]["status"] in {"erased", "retention_expired"}, result.text


@pytest.mark.parametrize("category", ["empty", "profile", "origin"])
def test_file_request_population_complements_are_shared_with_one_absent_person(setup, category):
    app, admin, company, _, now, _ = setup
    login(app, admin)
    total = 6
    for index in range(total):
        employee = TestClient(app, base_url=company.origin)
        employee.headers["Origin"] = company.origin
        member_login(app, employee, f"complement{index}@example.org")
        credentials, _ = connect(app, employee)
        components = [component("7")]
        if category == "empty":
            if index >= 5:
                components = []
        elif index < 5:
            extra = component("13")
            if category == "profile":
                extra["tokens"]["profile_id"] = "cl100k-base-4.0.0-reference"
            else:
                extra["origin"] = "retained_context"
            components.append(extra)
        request, attempt = current(now[0], components)
        applied(mixed_upload(employee, credentials, [request, attempt]))
    response = employee.get("/v1/company/summary")
    assert response.status_code == 200 and response.json()["suppressed"] is False, response.text
    assert response.json()["file_text_coverage"]["observed_request_count"] == str(total)
    assert response.json()["file_text"] and "file_text_disclosure" not in response.json()
    with app.state.db.transaction(readonly=True) as session:
        tenant = get(session, "company", company.id)
        member = get(session, "member", credentials["user_id"], company.id)
        result = app.state.service.analytics._canonical_summary(session, tenant, member, {}, private=True)
        assert result["suppressed"] is False and "file_text_disclosure" not in result, result
    run(app.state.service)
    bundle = install_bundle(app, now[0])
    created = admin.post(
        "/v1/admin/recalculations", json={"method_id": bundle["method_id"], "operation_id": str(uuid4())}
    )
    assert created.status_code == 200, created.text
    for _ in range(3):
        run(app.state.service)
    options = {"calculation_view": "recalculated", "method_id": bundle["method_id"]}
    response = employee.get("/v1/company/summary", params=options)
    assert response.status_code == 200 and response.json()["suppressed"] is False, response.text
    assert response.json()["request_count"] == str(total)
    assert admin.get("/v1/admin/summary", params=options).json()["request_count"] == str(total)


def test_file_0006_upgrade_rebuilds_absence_metadata_without_changing_telemetry(setup, tmp_path, monkeypatch):
    app, client, company, _, now, settings = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, attempt = current(now[0], [component("19")])
    applied(mixed_upload(client, credentials, [request, attempt]))
    with app.state.db.transaction() as session:
        before = [
            canonical([r.payload, r.payload_hash, r.estimate])
            for r in session.scalars(select(Observation).order_by(Observation.kind))
        ]
        for row in session.scalars(select(TABLES["rollup"])):
            row.data = {
                **row.data,
                "value": {k: v for k, v in row.data["value"].items() if k != "file_text_disclosure"},
            }
    assert client.get("/v1/me/summary").json()["aggregate_status"] == "rebuilding"
    settings_file = tmp_path / "upgrade-0006.json"
    settings_file.write_text(json.dumps(asdict(settings)))
    monkeypatch.setenv("AIFT_SETTINGS_FILE", str(settings_file))
    server = Path(__file__).resolve().parents[1]
    config = Config(str(server / "alembic.ini"))
    config.set_main_option("script_location", str(server / "migrations"))
    with app.state.db.engine.begin() as connection:
        restore_pre_0007_schema(connection, 5)
    command.stamp(config, "0005")
    command.upgrade(config, "head")
    for _ in range(4):
        run(app.state.service)
    summary = client.get("/v1/me/summary").json()
    assert summary["aggregate_status"] == "current" and summary["file_text"] == []
    with app.state.db.transaction(readonly=True) as session:
        after = [
            canonical([r.payload, r.payload_hash, r.estimate])
            for r in session.scalars(select(Observation).order_by(Observation.kind))
        ]
        assert before and after == []
        assert list(session.scalars(select(TABLES["rollup"]))) == []


def test_file_coverage_export_and_own_record_without_person_analytics(setup):
    app, client, company, admin, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    old, _ = observations(now[0])
    null, _ = current(now[0], None)
    empty, _ = current(now[0], [])
    a = component("4", "retained_context", True)
    b = component("8", "retained_context")
    b["tokens"]["profile_id"] = "cl100k-base-4.0.0-reference"
    counted, _ = current(now[0], [a, b, component(None, "unknown_origin")])
    counted["documents"]["upload_count"] = "0"
    applied(mixed_upload(client, credentials, [old, null, empty, counted]))
    summary = client.get("/v1/me/summary").json()
    assert (
        summary["file_text_coverage"]["observed_request_count"]
        == summary["file_text_coverage"]["unknown_request_count"]
        == "2"
    )
    assert len(summary["file_text"]) == 3 and not summary["tokens"] and not summary["resources"]
    detail = client.get(
        "/v1/usage/records/request/" + counted["request_id"],
        headers={"Authorization": "Bearer " + credentials["access_token"]},
    )
    assert detail.status_code == 200, detail.text
    assert "extracted_text" in detail.text
    assert detail.json()["record"] == counted and detail.json()["payload_hash"] == payload_hash(counted)
    created = client.post("/v1/admin/exports", json=confirmed(client, {"report": "summary"}))
    assert created.status_code == 200, created.text
    downloaded = client.get(created.json()["download_path"])
    assert downloaded.status_code == 200, downloaded.text
    rows = list(csv.DictReader(io.StringIO(downloaded.text)))
    files = [r for r in rows if r["quantity"] == "extracted_file_text"]
    assert len(files) == 3 and {r["value"] for r in files} == {"4", "8", ""}
    assert all(
        r["time_basis"] == "dispatch" and r["additive"] == "False" and r["contributing_attempt_count"] == ""
        for r in files
    )
    assert all(json.loads(r["missing_counts"])["provider_processing"] == 1 for r in files)
    assert {r["quantity"]: r["value"] for r in rows if r["quantity"].startswith("file_text_")} == {
        "file_text_observed_request_count": "2",
        "file_text_unknown_request_count": "2",
    }
