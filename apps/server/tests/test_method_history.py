import base64
import csv
import io
import json
import os
import shutil
import sqlite3
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import timedelta
from pathlib import Path
from threading import Barrier
from uuid import uuid4

import pytest
from conftest import PERSON_ANALYTICS, confirmed, connect, login, member_login
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from fastapi.testclient import TestClient
from footprint_contracts import canonical_json, payload_hash
from footprint_estimator import BASELINE_METHOD_HASH, BASELINE_METHOD_ID, baseline_bundle
from sqlalchemy import func, select
from test_analytics import observations, recompose, upload
from test_completion import finish_job, reauth

from aift.db import TABLES, Database, Observation, get
from aift.engine_adapter import identity, packaged_definition
from aift.engine_history import EngineEstimate, source_key
from aift.main import create_app
from aift.maintenance import replay_journal, run
from aift.method_history import (
    MethodHistory,
    RecalculationJob,
    erase_record,
    invalidate_erasure,
    resolve_estimate,
)
from aift.method_registry import MethodBundle, install, inventory, resolve
from aift.security import Problem, instant

ROOT = Path(__file__).resolve().parents[3]


def signed(bundle, now):
    key = ec.generate_private_key(ec.SECP256R1())
    public = base64.b64encode(
        key.public_key().public_bytes(
            serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
        )
    ).decode()
    message = {
        "bundle_hash": payload_hash(bundle),
        "issued_at": instant(now),
        "expires_at": instant(now + timedelta(days=1)),
    }
    r, s = decode_dss_signature(key.sign(canonical_json(message).encode(), ec.ECDSA(hashes.SHA256())))
    return {
        **message,
        "bundle": bundle,
        "signature": base64.b64encode(r.to_bytes(32) + s.to_bytes(32)).decode(),
    }, public


def replacement(name="reviewed-coefficient-v2"):
    bundle = baseline_bundle()
    bundle["method_id"] = name
    bundle["coefficients"]["energyAlpha"] = "0.002"
    return bundle


def install_bundle(app, now, bundle=None):
    bundle = bundle or replacement()
    envelope, trust = signed(bundle, now)
    with app.state.db.transaction(scope="method-install") as session:
        install(session, envelope, trust, now, approved_by="release-review-fixture")
    return bundle


def begin(setup, count=1, method_id=None, output_count="500"):
    app, client, company, member, now, settings = setup
    login(app, client)
    credentials, _ = connect(app, client)
    records = []
    for _ in range(count):
        request, attempt = observations(now[0], output_count)
        if method_id:
            attempt["proposed_method_id"] = method_id
        records.extend([request, attempt])
    for offset in range(0, len(records), 100):
        result = upload(client, credentials, records[offset : offset + 100])
        assert result.status_code == 200, result.text
    return app, client, company, member, now, settings, credentials, records


def create_job(app, company, member, method_id):
    history = MethodHistory(app.state.service.analytics)
    with app.state.db.transaction(scope=company.data["origin"]) as session:
        result = history.create(
            session, company, member, {"method_id": method_id, "operation_id": str(uuid4())}
        )
    return history, result["job_id"]


def tick(app, company, history, identifier, budget=100):
    with app.state.db.transaction(scope=company.data["origin"]) as session:
        history.advance(
            session, get(session, "company", company.id), session.get(RecalculationJob, identifier), budget
        )


def test_signed_install_is_immutable_validated_and_durable(setup):
    app, _, _, _, now, settings = setup
    bundle = install_bundle(app, now[0])
    restarted = Database(settings)
    with restarted.transaction(readonly=True) as session:
        assert resolve(session, bundle["method_id"]) == bundle
        assert resolve(session, BASELINE_METHOD_ID) == baseline_bundle()
        assert inventory(session)["methods"][1]["approval"]["trust"] == "deployment_pinned_p256_signature"
    modified = deepcopy(bundle)
    modified["coefficients"]["energyAlpha"] = "0.003"
    envelope, key = signed(modified, now[0])
    with app.state.db.transaction() as session, pytest.raises(Problem) as caught:
        install(session, envelope, key, now[0], approved_by="fixture")
    assert caught.value.code == "method_conflict"
    with pytest.raises(ValueError, match="immutable_method_history"), app.state.db.transaction() as session:
        session.get(MethodBundle, bundle["method_id"]).approval = {}
        session.flush()


@pytest.mark.parametrize(
    "mutation",
    [
        "formula",
        "unknown_equation",
        "test_equation",
        "bad_factor",
        "corrupt_signature",
        "wrong_key",
        "expired",
    ],
)
def test_bundle_refusal(setup, mutation):
    app, _, _, _, now, _ = setup
    bundle = replacement("test-rejected")
    if mutation == "formula":
        bundle["formula"] = "__import__('os').system('never-run')"
    if mutation == "unknown_equation":
        bundle["equation_id"] = "downloaded-function"
    if mutation == "test_equation":
        bundle["equation_id"] = "test-linear-v1"
    if mutation == "bad_factor":
        bundle["scenario"]["pue"] = "NaN"
    envelope, key = signed(bundle, now[0] - timedelta(days=2) if mutation == "expired" else now[0])
    if mutation == "corrupt_signature":
        envelope["signature"] = base64.b64encode(b"x" * 64).decode()
    if mutation == "wrong_key":
        _, key = signed(bundle, now[0])
    with app.state.db.transaction() as session, pytest.raises(Problem) as caught:
        install(session, envelope, key, now[0], approved_by="fixture", environment="production")
    assert caught.value.code == "method_update_invalid"


@pytest.mark.parametrize("output_count", ["0", "1", "500", "999999"])
def test_original_recalculated_original_lineage_and_typescript_parity(setup, output_count):
    app, client, company, member, now, settings, credentials, records = begin(
        setup, output_count=output_count
    )
    bundle = install_bundle(app, now[0])
    with app.state.db.transaction(readonly=True) as session:
        row = session.get(Observation, (company.id, member.id, "attempt", records[1]["attempt_id"]))
        original = deepcopy(row.estimate)
        revision_snapshots = [deepcopy(r.data) for r in session.scalars(select(TABLES["revision"]))]
    history, identifier = create_job(app, company, member, bundle["method_id"])
    tick(app, company, history, identifier)
    with app.state.db.transaction(readonly=True) as session:
        row = session.get(Observation, (company.id, member.id, "attempt", records[1]["attempt_id"]))
        recalculated = resolve_estimate(session, row, bundle["method_id"])["result"]
        if output_count != "0":
            assert (
                recalculated["metrics"]["energy"]["value"] != original["result"]["metrics"]["energy"]["value"]
            )
        assert recalculated["original_method_hash"] == BASELINE_METHOD_HASH
        assert recalculated["source"]["attempt_hash"] == row.payload_hash
        assert resolve_estimate(session, row) == original == row.estimate
        assert [r.data for r in session.scalars(select(TABLES["revision"]))] == revision_snapshots
        assert history.status(session, company, member, identifier)["status"] == "completed"
    script = """import {readFileSync} from 'node:fs';
import {registerMethodBundle,estimateAttempt} from './packages/estimator/src/index.ts';
const x=JSON.parse(readFileSync(0,'utf8'));registerMethodBundle(x.bundle);
process.stdout.write(JSON.stringify({original:estimateAttempt(x.observation),recalculated:estimateAttempt(x.observation,x.options)}));"""
    payload = {
        "bundle": bundle,
        "observation": records[1],
        "options": {
            "methodId": bundle["method_id"],
            "view": "recalculated",
            "originalMethodHash": BASELINE_METHOD_HASH,
        },
    }
    result = subprocess.run(
        ["node", "--import", "tsx", "--input-type=module", "-e", script],
        cwd=ROOT,
        input=json.dumps(payload),
        text=True,
        capture_output=True,
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {
        "original": original["result"]["raw"]["result"],
        "recalculated": recalculated["raw"]["result"],
    }
    restart_script = """import json,sys
from types import SimpleNamespace
from aift.db import Database
from aift.method_registry import estimate
x=json.load(sys.stdin)
with Database(SimpleNamespace(database_url=x['url'])).transaction(readonly=True) as s:
 print(json.dumps(estimate(s,x['observation'],x['options'],request=x['request'])))
"""
    result = subprocess.run(
        [sys.executable, "-c", restart_script],
        cwd=ROOT / "apps/server",
        input=json.dumps({**payload, "url": settings.database_url, "request": records[0]}),
        env={
            **os.environ,
            "PYTHONPATH": os.pathsep.join(
                [str(ROOT / "packages/contracts/python"), str(ROOT / "packages/estimator/python")]
            ),
        },
        text=True,
        capture_output=True,
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == recalculated


def test_bounded_crash_resume_and_correction_cannot_serve_old_revision(setup):
    app, client, company, member, now, settings, credentials, records = begin(setup, 3)
    bundle = install_bundle(app, now[0])
    history, identifier = create_job(app, company, member, bundle["method_id"])
    with pytest.raises(RuntimeError), app.state.db.transaction(scope=company.data["origin"]) as session:
        history.advance(session, company, session.get(RecalculationJob, identifier), 1)
        raise RuntimeError("crash before commit")
    with app.state.db.transaction(readonly=True) as session:
        assert session.scalar(select(func.count()).select_from(EngineEstimate)) == 0
    tick(app, company, history, identifier, 1)
    with app.state.db.transaction(readonly=True) as session:
        assert session.scalar(select(func.count()).select_from(EngineEstimate)) == 1
        assert history.status(session, company, member, identifier)["status"] == "pending"
        with pytest.raises(Problem) as caught:
            history.prepare_view(
                session,
                company,
                member,
                {"calculation_view": "recalculated", "method_id": bundle["method_id"]},
                personal=True,
            )
        assert caught.value.code == "recalculation_pending"
    tick(app, company, history, identifier)
    corrected = deepcopy(records[1])
    corrected["revision"] = 2
    corrected["tokens"]["answer_output"]["value"] = "10"
    recompose(corrected)
    assert upload(client, credentials, [corrected]).json()["results"][0]["status"] == "applied"
    with app.state.db.transaction(readonly=True) as session:
        assert history.status(session, company, member, identifier)["status"] == "pending"
        current = session.get(Observation, (company.id, member.id, "attempt", corrected["attempt_id"]))
        assert resolve_estimate(session, current, bundle["method_id"])["status"] == "pending"
    tick(app, company, history, identifier)
    with app.state.db.transaction(readonly=True) as session:
        assert history.status(session, company, member, identifier)["status"] == "completed"
        assert session.scalar(select(func.count()).select_from(EngineEstimate)) == 4


def test_unknown_original_and_alternative_recover_after_install_without_rewrite(setup):
    bundle = replacement("reviewed-future-v3")
    app, client, company, member, now, settings, credentials, records = begin(
        setup, method_id=bundle["method_id"]
    )
    history, identifier = create_job(app, company, member, bundle["method_id"])
    tick(app, company, history, identifier)
    with app.state.db.transaction(readonly=True) as session:
        record = session.get(Observation, (company.id, member.id, "attempt", records[1]["attempt_id"]))
        pending = deepcopy(record.estimate)
        assert pending["status"] == "pending"
        assert history.status(session, company, member, identifier)["error_code"] == "method_unsupported"
    install_bundle(app, now[0], bundle)
    tick(app, company, history, identifier)
    with app.state.db.transaction(readonly=True) as session:
        record = session.get(Observation, (company.id, member.id, "attempt", records[1]["attempt_id"]))
        assert record.estimate == pending
        assert (
            resolve_estimate(session, record)["result"]["requested_method"]["method_id"]
            == bundle["method_id"]
        )
        assert resolve_estimate(session, record, bundle["method_id"])["result"][
            "original_method_hash"
        ] == payload_hash(bundle)


def test_concurrent_worker_idempotency_and_erasure_cleanup(setup):
    app, client, company, member, now, settings, credentials, records = begin(setup)
    bundle = install_bundle(app, now[0])
    history, identifier = create_job(app, company, member, bundle["method_id"])
    barrier = Barrier(2)

    def concurrent_tick():
        barrier.wait()
        tick(app, company, history, identifier)

    with ThreadPoolExecutor(2) as pool:
        list(pool.map(lambda _: concurrent_tick(), range(2)))
    with app.state.db.transaction() as session:
        assert session.scalar(select(func.count()).select_from(EngineEstimate)) == 1
        record = session.get(Observation, (company.id, member.id, "attempt", records[1]["attempt_id"]))
        assert erase_record(session, record, 1) == 1
        assert erase_record(session, record, 1) == 0
        invalidate_erasure(session, company)
        assert session.get(RecalculationJob, identifier) is None
    other = deepcopy(member)
    other.id = str(uuid4())
    with app.state.db.transaction(readonly=True) as session, pytest.raises(Problem) as caught:
        history.status(session, company, other, identifier)
    assert caught.value.code == "not_found"


@PERSON_ANALYTICS
def test_api_views_exports_and_member_isolation(setup):
    app, client, company, member, now, settings, credentials, records = begin(setup)
    bundle = install_bundle(app, now[0])
    listed = client.get("/v1/methods")
    assert listed.status_code == 200, listed.text
    # The shipped EcoLogits method is the default, never the archived Original baseline.
    shipped = identity(packaged_definition())["method_id"]
    assert listed.json()["default_method_id"] == shipped
    defaults = [record["method_id"] for record in listed.json()["methods"] if record["default"]]
    assert defaults == [shipped]
    assert any(record["method_id"] == BASELINE_METHOD_ID for record in listed.json()["methods"])
    original = client.get("/v1/me/summary").json()
    options = {"calculation_view": "recalculated", "method_id": bundle["method_id"]}
    assert client.get("/v1/me/summary", params=options).status_code == 409
    created = client.post(
        "/v1/admin/recalculations", json={"method_id": bundle["method_id"], "operation_id": str(uuid4())}
    )
    assert created.status_code == 200, created.text
    run(app.state.service)
    result = client.get("/v1/admin/recalculations/" + created.json()["job_id"])
    assert result.json()["status"] == "completed", result.text
    changed = client.get("/v1/me/summary", params=options)
    assert changed.status_code == 200, changed.text
    assert changed.json()["calculation_view"] == "recalculated"
    assert changed.json()["resources"] != original["resources"]
    assert client.get("/v1/me/summary").json()["resources"] == original["resources"]
    for report in ("summary", "records"):
        exported = client.post(
            "/v1/admin/exports", json=confirmed(client, {**options, "report": report, "period": "all"})
        )
        assert exported.status_code == 200, exported.text
        downloaded = client.get(exported.json()["download_path"])
        assert downloaded.status_code == 200, downloaded.text
        rows = list(csv.DictReader(io.StringIO(downloaded.text)))
        assert rows and all(row["calculation_view"] == "recalculated" for row in rows)
        assert any(row["method_id"] == bundle["method_id"] for row in rows)
    employee = TestClient(app, base_url=company.data["origin"])
    employee.headers["Origin"] = company.data["origin"]
    member_login(app, employee, "employee@example.org")
    assert employee.get("/v1/admin/recalculations/" + created.json()["job_id"]).status_code == 403
    assert employee.get("/v1/me/recalculations/" + created.json()["job_id"]).status_code == 404
    shared = employee.get("/v1/company/summary", params=options).json()
    assert shared["suppressed"] is False and shared["calculation_view"] == "recalculated"
    assert employee.get("/v1/me/summary", params={**options, "user_id": member.id}).status_code == 422
    assert (
        employee.post(
            "/v1/me/recalculations",
            json={"method_id": bundle["method_id"], "operation_id": str(uuid4()), "user_id": member.id},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/v1/admin/recalculations",
            json={
                "method_id": bundle["method_id"],
                "operation_id": str(uuid4()),
                "user_id": {"unexpected": True},
            },
        ).status_code
        == 422
    )


def test_erasure_and_restored_backup_remove_all_alternative_lineage(setup, tmp_path):
    app, client, company, member, now, settings, credentials, records = begin(
        setup, method_id="reviewed-future-v3"
    )
    bundle = install_bundle(app, now[0], replacement("reviewed-future-v3"))
    history, identifier = create_job(app, company, member, bundle["method_id"])
    tick(app, company, history, identifier)
    path = app.state.db.engine.url.database
    backup = tmp_path / "before-method-erasure.db"
    with sqlite3.connect(path) as source, sqlite3.connect(backup) as target:
        source.backup(target)
    preview = client.post(
        "/v1/admin/deletions/preview",
        json={
            "scope": "range",
            "start": instant(now[0] - timedelta(seconds=1)),
            "end": instant(now[0] + timedelta(seconds=1)),
        },
    ).json()
    body = {
        "preview_token": preview["preview_token"],
        "idempotency_key": str(uuid4()),
        "confirmed": True,
        "reauth_token": reauth(app, company, member),
    }
    barrier = Barrier(2)

    def worker_during_erasure():
        barrier.wait()
        run(app.state.service)

    def erase_during_worker():
        barrier.wait()
        return client.post("/v1/admin/deletions", json=body)

    with ThreadPoolExecutor(2) as pool:
        worker = pool.submit(worker_during_erasure)
        erased = pool.submit(erase_during_worker).result()
        worker.result()
    assert erased.status_code == 200, erased.text
    finish_job(app, company, body["idempotency_key"])
    with app.state.db.transaction(readonly=True) as session:
        assert session.scalar(select(func.count()).select_from(EngineEstimate)) == 0
        assert session.scalar(select(func.count()).select_from(RecalculationJob)) == 0
    assert client.get("/v1/me/summary").json()["attempt_count"] == "0"
    app.state.db.engine.dispose()
    shutil.copyfile(backup, path)
    restored = create_app(settings, clock=lambda: now[0])
    replay_journal(restored.state.service)
    run(restored.state.service)
    with restored.state.db.transaction(readonly=True) as session:
        assert session.scalar(select(func.count()).select_from(EngineEstimate)) == 0
        assert session.scalar(select(func.count()).select_from(RecalculationJob)) == 0
        assert session.scalar(select(func.count()).select_from(Observation)) == 0
        assert resolve(session, bundle["method_id"]) == bundle


def test_retention_removes_method_results_and_keeps_bundles(setup):
    app, client, company, member, now, settings, credentials, records = begin(setup)
    bundle = install_bundle(app, now[0])
    history, identifier = create_job(app, company, member, bundle["method_id"])
    tick(app, company, history, identifier)
    now[0] += timedelta(days=190)
    for _ in range(5):
        run(app.state.service)
    with app.state.db.transaction(readonly=True) as session:
        assert session.scalar(select(func.count()).select_from(EngineEstimate)) == 0
        assert session.scalar(select(func.count()).select_from(RecalculationJob)) == 0
        assert session.scalar(select(func.count()).select_from(Observation)) == 0
        assert resolve(session, bundle["method_id"]) == bundle


def test_company_recalculated_profile_groups_share_a_one_person_subgroup(setup):
    app, client, company, member, now, settings = setup
    login(app, client)
    employees = []
    for index in range(5):
        employee = TestClient(app, base_url=company.data["origin"])
        employee.headers["Origin"] = company.data["origin"]
        member_login(app, employee, f"employee{index}@example.org")
        credentials, _ = connect(app, employee)
        request, attempt = observations(now[0], "0" if index == 4 else "500")
        assert upload(employee, credentials, [request, attempt]).status_code == 200
        employees.append(employee)
    run(app.state.service)
    bundle = install_bundle(app, now[0])
    response = client.post(
        "/v1/admin/recalculations", json={"method_id": bundle["method_id"], "operation_id": str(uuid4())}
    )
    assert response.status_code == 200, response.text
    run(app.state.service)
    options = {"calculation_view": "recalculated", "method_id": bundle["method_id"]}
    released = employees[0].get("/v1/company/summary", params=options)
    assert released.status_code == 200, released.text
    admin = client.get("/v1/admin/summary", params=options)
    assert admin.status_code == 200, admin.text
    assert admin.json()["attempt_count"] == "5"
    # The one person's zero-token group is shared with members as well (13 October 2026).
    assert released.json()["suppressed"] is False and released.json()["attempt_count"] == "5"
    assert released.json()["resources"] == admin.json()["resources"]


def test_concurrent_correction_then_restart_selects_only_current_revision(setup):
    app, client, company, member, now, settings, credentials, records = begin(setup)
    bundle = install_bundle(app, now[0])
    history, identifier = create_job(app, company, member, bundle["method_id"])
    tick(app, company, history, identifier)
    corrected = deepcopy(records[1])
    corrected["revision"] = 2
    corrected["tokens"]["answer_output"]["value"] = "13"
    recompose(corrected)
    barrier = Barrier(2)

    def worker():
        barrier.wait()
        tick(app, company, history, identifier)

    def correct():
        barrier.wait()
        result = upload(client, credentials, [corrected])
        assert result.json()["results"][0]["status"] == "applied", result.text

    with ThreadPoolExecutor(2) as pool:
        running = pool.submit(worker)
        pool.submit(correct).result()
        running.result()
    restarted = create_app(settings, clock=lambda: now[0])
    history = restarted.state.service.analytics.methods
    with restarted.state.db.transaction(readonly=True) as session:
        state = history.status(session, company, member, identifier)
        if state["status"] == "completed":
            result = session.get(
                source_key(
                    session,
                    session.get(Observation, (company.id, member.id, "attempt", corrected["attempt_id"])),
                    bundle["method_id"],
                    "recalculated",
                ),
            )
            assert result.observation_hash == payload_hash(corrected)
    tick(restarted, company, history, identifier)
    with restarted.state.db.transaction(readonly=True) as session:
        current = session.get(Observation, (company.id, member.id, "attempt", corrected["attempt_id"]))
        result = resolve_estimate(session, current, bundle["method_id"])["result"]
        assert result["source"]["attempt_revision"] == 2 and result["source"]["attempt_hash"] == payload_hash(
            corrected
        )
        assert session.scalar(select(func.count()).select_from(EngineEstimate)) == 2


def test_failed_worker_page_stays_visible_and_can_retry(setup, monkeypatch):
    from aift import method_registry

    app, client, company, member, now, settings, credentials, records = begin(setup)
    bundle = install_bundle(app, now[0])
    history, identifier = create_job(app, company, member, bundle["method_id"])
    original = method_registry.estimate

    def crash(*args, **kwargs):
        raise RuntimeError("synthetic calculator interruption")

    monkeypatch.setattr(method_registry, "estimate", crash)
    run(app.state.service)
    with app.state.db.transaction(readonly=True) as session:
        status = history.status(session, company, member, identifier)
        assert status["status"] == "failed" and status["error_code"] == "calculation_failed"
        assert session.scalar(select(func.count()).select_from(EngineEstimate)) == 0
    monkeypatch.setattr(method_registry, "estimate", original)
    run(app.state.service)
    with app.state.db.transaction(readonly=True) as session:
        assert history.status(session, company, member, identifier)["status"] == "completed"
        assert session.scalar(select(func.count()).select_from(EngineEstimate)) == 1


def test_api_views_and_summary_export_without_person_analytics(setup):
    app, client, company, member, now, settings, credentials, records = begin(setup)
    bundle = install_bundle(app, now[0])
    listed = client.get("/v1/methods")
    assert listed.status_code == 200, listed.text
    assert listed.json()["default_method_id"] == identity(packaged_definition())["method_id"]
    original = client.get("/v1/me/summary").json()
    options = {"calculation_view": "recalculated", "method_id": bundle["method_id"]}
    assert client.get("/v1/me/summary", params=options).status_code == 409
    created = client.post(
        "/v1/admin/recalculations", json={"method_id": bundle["method_id"], "operation_id": str(uuid4())}
    )
    assert created.status_code == 200, created.text
    run(app.state.service)
    result = client.get("/v1/admin/recalculations/" + created.json()["job_id"])
    assert result.json()["status"] == "completed", result.text
    changed = client.get("/v1/me/summary", params=options)
    assert changed.status_code == 200, changed.text
    assert changed.json()["calculation_view"] == "recalculated"
    assert changed.json()["resources"] != original["resources"]
    assert client.get("/v1/me/summary").json()["resources"] == original["resources"]
    exported = client.post("/v1/admin/exports", json=confirmed(client, {**options, "period": "all"}))
    assert exported.status_code == 200, exported.text
    downloaded = client.get(exported.json()["download_path"])
    assert downloaded.status_code == 200, downloaded.text
    rows = list(csv.DictReader(io.StringIO(downloaded.text)))
    assert rows and all(row["calculation_view"] == "recalculated" for row in rows)
    assert any(row["method_id"] == bundle["method_id"] for row in rows)
    employee = TestClient(app, base_url=company.data["origin"])
    employee.headers["Origin"] = company.data["origin"]
    member_login(app, employee, "employee@example.org")
    assert employee.get("/v1/admin/recalculations/" + created.json()["job_id"]).status_code == 403
    assert employee.get("/v1/me/recalculations/" + created.json()["job_id"]).status_code == 404
    shared = employee.get("/v1/company/summary", params=options).json()
    assert shared["suppressed"] is False and shared["calculation_view"] == "recalculated"
    assert employee.get("/v1/me/summary", params={**options, "user_id": member.id}).status_code == 422
    assert (
        employee.post(
            "/v1/me/recalculations",
            json={"method_id": bundle["method_id"], "operation_id": str(uuid4()), "user_id": member.id},
        ).status_code
        == 422
    )
    # Without person analytics administrators recalculate the whole organization only (owner
    # decision of 18 October 2026).
    for user_id in ({"unexpected": True}, member.id):
        refused = client.post(
            "/v1/admin/recalculations",
            json={"method_id": bundle["method_id"], "operation_id": str(uuid4()), "user_id": user_id},
        )
        assert refused.status_code == 400, (user_id, refused.text)
        assert refused.json()["error"]["code"] == "person_analytics_disabled"
