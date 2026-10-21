import json
import os
import shutil
import sqlite3
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, replace
from datetime import timedelta
from pathlib import Path
from threading import Barrier
from uuid import uuid4

import pytest
from conftest import PERSON_ANALYTICS, connect, login, open_network
from sqlalchemy import func, select
from test_analytics import observations, upload
from test_completion import finish_job, reauth

from aift.db import TABLES, NetworkObservation, get, put
from aift.ip_rotation import (
    REGISTRY_ID,
    advance_tenant,
    check_write_key,
    distinct_coverage,
    job_id,
    plan,
    retirement_check,
    start,
)
from aift.main import create_app
from aift.maintenance import replay_journal, run
from aift.security import Problem, instant, token

# Key rotation applies only while IP collection is on (owner decision of 18 October 2026).
pytestmark = PERSON_ANALYTICS


def seed(setup, count=3):
    app, client, company, member, now, settings = setup
    login(app, client)
    credentials, _ = connect(app, client)
    with app.state.db.transaction(scope=company.data["origin"]) as session:
        for _ in range(count):
            put(
                session,
                "network",
                str(uuid4()),
                {
                    "observed_at": instant(now[0]),
                    "device_id": credentials["device_id"],
                    "address": app.state.service.secrets.encrypt_ip("192.0.2.1"),
                    "equality": app.state.service.secrets.keyed("ip:" + company.id, "192.0.2.1", ip=True),
                    "key_version": "1",
                    "source_quality": "server_observed",
                    "accepted_record_count": 1,
                },
                company.id,
                member.id,
            )
    configured = replace(
        settings,
        ip_keys={"2": token()},
        active_ip_key_version="2",
        ip_restore_required_until={"1": instant(now[0] + timedelta(days=90))},
    )
    rotated = create_app(configured, clock=lambda: now[0])
    return app, rotated, company, member, now, configured, credentials, client


def tick(app, company, budget=100):
    with app.state.db.transaction(scope=company.data["origin"]) as session:
        advance_tenant(app.state.service, session, get(session, "company", company.id), budget)


def coverage(app, company):
    with app.state.db.transaction(readonly=True) as session:
        return distinct_coverage(
            session, app.state.service.secrets, [NetworkObservation.tenant == company.id]
        )


def test_plan_rotation_mixed_versions_and_restart_preserve_distincts(setup):
    old, app, company, member, now, settings, credentials, client = seed(setup)
    with app.state.db.transaction(readonly=True) as session:
        before = [dict(row.data) for row in session.scalars(select(NetworkObservation))]
        assert plan(app.state.service, session, company)["pending_rows"] == 3
        assert get(session, "maintenance_cursor", REGISTRY_ID).data["active_version"] == "1"
    start(app.state.service, company.id)
    tick(app, company, 1)
    assert coverage(app, company) == {
        "distinct_ips": None,
        "distinct_ip_status": "key_rotation_pending",
        "key_versions": ["1", "2"],
    }
    with app.state.db.transaction(readonly=True) as session:
        job = get(session, "maintenance_cursor", job_id(company.id), company.id)
        assert job.data["processed_rows"] == 1 and job.data["status"] == "pending"
    restarted = create_app(settings, clock=lambda: now[0])
    tick(restarted, company)
    assert coverage(restarted, company)["distinct_ips"] == "1"
    with restarted.state.db.transaction(readonly=True) as session:
        rows = list(session.scalars(select(NetworkObservation)))
        assert all(row.data["key_version"] == "2" for row in rows)
        assert all(
            restarted.state.service.secrets.decrypt_ip(row.data["address"], "2") == "192.0.2.1"
            for row in rows
        )
        assert all(row.equality != before[0]["equality"] for row in rows)
        assert all(row.data["address"] not in [entry["address"] for entry in before] for row in rows)
    assert (
        old.state.service.secrets.cipher._signing_key == restarted.state.service.secrets.cipher._signing_key
    )
    assert old.state.service.secrets.lookup == restarted.state.service.secrets.lookup


def test_interrupted_page_rolls_back_ciphertext_equality_and_checkpoint(setup, monkeypatch):
    old, app, company, member, now, settings, credentials, client = seed(setup)
    start(app.state.service, company.id)
    original = app.state.service.secrets.encrypt_ip
    calls = 0

    def fail_second(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("synthetic interruption")
        return original(*args, **kwargs)

    monkeypatch.setattr(app.state.service.secrets, "encrypt_ip", fail_second)
    tick(app, company)
    with app.state.db.transaction(readonly=True) as session:
        assert all(row.data["key_version"] == "1" for row in session.scalars(select(NetworkObservation)))
        job = get(session, "maintenance_cursor", job_id(company.id), company.id)
        assert job.data["processed_rows"] == 0 and job.data["status"] == "failed"
        assert "192.0.2.1" not in json.dumps(job.data)
    restarted = create_app(settings, clock=lambda: now[0])
    tick(restarted, company)
    assert coverage(restarted, company)["distinct_ips"] == "1"


def test_concurrent_insert_and_rotation_and_stale_writer_rejection(setup):
    old, app, company, member, now, settings, credentials, client = seed(setup)
    start(app.state.service, company.id)
    with pytest.raises(Problem) as error, old.state.db.transaction(scope=company.data["origin"]) as session:
        check_write_key(session, old.state.service)
    assert error.value.code == "ip_key_activation_required"
    barrier = Barrier(2)

    def worker():
        barrier.wait()
        tick(app, company)

    def insert():
        barrier.wait()
        with app.state.db.transaction(scope=company.data["origin"]) as session:
            check_write_key(session, app.state.service)
            put(
                session,
                "network",
                str(uuid4()),
                {
                    "observed_at": instant(now[0]),
                    "device_id": credentials["device_id"],
                    "address": app.state.service.secrets.encrypt_ip("192.0.2.1"),
                    "equality": app.state.service.secrets.keyed("ip:" + company.id, "192.0.2.1", ip=True),
                    "key_version": "2",
                    "source_quality": "server_observed",
                    "accepted_record_count": 1,
                },
                company.id,
                member.id,
            )

    with ThreadPoolExecutor(2) as pool:
        one, two = pool.submit(worker), pool.submit(insert)
        one.result()
        two.result()
    assert coverage(app, company)["distinct_ips"] == "1"


@pytest.mark.parametrize("change", ["missing", "wrong"])
def test_missing_or_reused_key_version_fails_closed(setup, change):
    old, app, company, member, now, settings, credentials, client = seed(setup)
    invalid = replace(settings, ip_key="" if change == "missing" else token(), ip_restore_required_until={})
    with pytest.raises(Problem) as error:
        create_app(invalid, clock=lambda: now[0])
    assert error.value.code in {"ip_key_unavailable", "ip_decryption_failed", "ip_key_version_conflict"}


def test_retirement_requires_no_rows_and_expired_restore_policy(setup):
    old, app, company, member, now, settings, credentials, client = seed(setup)
    start(app.state.service, company.id)
    with app.state.db.transaction(readonly=True) as session, pytest.raises(Problem) as error:
        retirement_check(app.state.service, session, "1")
    assert error.value.code == "ip_key_required_for_rows"
    tick(app, company)
    with app.state.db.transaction(readonly=True) as session, pytest.raises(Problem) as error:
        retirement_check(app.state.service, session, "1")
    assert error.value.code == "ip_key_required_for_restore"
    with pytest.raises(Problem) as error:
        create_app(replace(settings, ip_key="", ip_restore_required_until={}), clock=lambda: now[0])
    assert error.value.code == "ip_key_required_for_restore"
    now[0] += timedelta(days=91)
    with app.state.db.transaction(readonly=True) as session:
        assert retirement_check(app.state.service, session, "1")["configuration_changed"] is False
    removed = create_app(replace(settings, ip_key="", ip_restore_required_until={}), clock=lambda: now[0])
    assert removed.state.service.secrets.ip_keys.keys() == {"2"}


def test_rotated_backup_requires_old_keys_and_resumes_rotation(setup, tmp_path):
    old, app, company, member, now, settings, credentials, client = seed(setup)
    run(old.state.service)
    start(app.state.service, company.id)
    tick(app, company, 1)
    database = app.state.db.engine.url.database
    backup = tmp_path / "mixed-version-backup.db"
    with sqlite3.connect(database) as source, sqlite3.connect(backup) as destination:
        source.backup(destination)
    tick(app, company)
    app.state.db.engine.dispose()
    old.state.db.engine.dispose()
    shutil.copyfile(backup, database)
    with pytest.raises(Problem):
        create_app(replace(settings, ip_key="", ip_restore_required_until={}), clock=lambda: now[0])
    restored = create_app(settings, clock=lambda: now[0])
    replay_journal(restored.state.service)
    tick(restored, company)
    assert coverage(restored, company)["distinct_ips"] == "1"


def test_retention_removes_every_version_ciphertext_and_equality(setup):
    old, app, company, member, now, settings, credentials, client = seed(setup)
    start(app.state.service, company.id)
    tick(app, company, 1)
    now[0] += timedelta(days=31)
    run(app.state.service)
    with app.state.db.transaction(readonly=True) as session:
        assert session.scalar(select(func.count()).select_from(NetworkObservation)) == 0
    assert coverage(app, company)["distinct_ips"] == "0"


def test_cli_default_is_readonly_and_does_not_print_keys(setup, tmp_path):
    old, app, company, member, now, settings, credentials, client = seed(setup)
    path = tmp_path / "protected-settings.json"
    path.write_text(json.dumps(asdict(settings)))
    root = Path(__file__).resolve().parents[3]
    environment = {
        **os.environ,
        "AIFT_SETTINGS_FILE": str(path),
        "PYTHONPATH": os.pathsep.join(
            [str(root / "packages/contracts/python"), str(root / "packages/estimator/python")]
        ),
    }
    command = [sys.executable, "-m", "aift.ip_rotation", "--tenant", company.id]
    result = subprocess.run(
        command, cwd=root / "apps/server", env=environment, capture_output=True, text=True
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["mode"] == "plan"
    for secret in [settings.ip_key, *settings.ip_keys.values()]:
        assert secret not in result.stdout + result.stderr
    with app.state.db.transaction(readonly=True) as session:
        assert get(session, "maintenance_cursor", job_id(company.id), company.id) is None
        assert get(session, "maintenance_cursor", REGISTRY_ID).data["active_version"] == "1"


def test_full_family_deletion_during_mixed_key_rotation(setup):
    old, app, company, member, now, settings, credentials, client = seed(setup)
    request, attempt = observations(now[0])
    assert upload(client, credentials, [request, attempt]).status_code == 200
    start(app.state.service, company.id)
    tick(app, company, 1)
    from fastapi.testclient import TestClient

    admin = TestClient(app, base_url=company.data["origin"])
    admin.headers["Origin"] = company.data["origin"]
    login(app, admin)
    preview = admin.post(
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
    result = admin.post("/v1/admin/deletions", json=body)
    assert result.status_code == 200, result.text
    finish_job(app, company, body["idempotency_key"])
    run(app.state.service)
    with app.state.db.transaction(readonly=True) as session:
        assert session.scalar(select(func.count()).select_from(NetworkObservation)) == 0
        for row in session.scalars(select(TABLES["maintenance_cursor"])):
            assert "192.0.2.1" not in json.dumps(row.data)


def test_admin_api_discloses_mixed_coverage_and_new_ingestion_uses_active_key(setup):
    from fastapi.testclient import TestClient

    old, app, company, member, now, settings, credentials, client = seed(setup)
    start(app.state.service, company.id)
    tick(app, company, 1)
    admin = TestClient(app, base_url=company.data["origin"], client=("192.0.2.1", 12345))
    admin.headers["Origin"] = company.data["origin"]
    login(app, admin)
    open_network(admin)
    response = admin.get("/v1/admin/network")
    assert response.status_code == 200, response.text
    assert response.json()["distinct_ips"] is None
    assert response.json()["distinct_ip_status"] == "key_rotation_pending"
    assert all(item["address"] == "192.0.2.1" for item in response.json()["items"])
    result = upload(admin, credentials, observations(now[0]))
    assert result.status_code == 200, result.text
    with app.state.db.transaction(readonly=True) as session:
        assert (
            session.scalar(
                select(func.count())
                .select_from(NetworkObservation)
                .where(NetworkObservation.data["key_version"].as_string() == "2")
            )
            == 2
        )
        for row in session.scalars(select(TABLES["audit"])):
            assert "192.0.2.1" not in json.dumps(row.data)
    tick(app, company)
    final = admin.get("/v1/admin/network")
    assert final.status_code == 200, final.text
    assert final.json()["distinct_ips"] == "1" and final.json()["distinct_ip_status"] == "current"


def test_cli_can_plan_unregistered_key_then_explicitly_execute_without_secret_output(setup, tmp_path):
    app, client, company, member, now, settings = setup
    login(app, client)
    credentials, _ = connect(app, client)
    configured = replace(settings, ip_keys={"2": token()}, active_ip_key_version="2")
    path = tmp_path / "protected-settings.json"
    path.write_text(json.dumps(asdict(configured)))
    root = Path(__file__).resolve().parents[3]
    environment = {
        **os.environ,
        "AIFT_SETTINGS_FILE": str(path),
        "PYTHONPATH": os.pathsep.join(
            [str(root / "packages/contracts/python"), str(root / "packages/estimator/python")]
        ),
    }
    command = [sys.executable, "-m", "aift.ip_rotation", "--tenant", company.id]
    planned = subprocess.run(
        command, cwd=root / "apps/server", env=environment, capture_output=True, text=True
    )
    assert planned.returncode == 0, planned.stderr
    with app.state.db.transaction(readonly=True) as session:
        registry = get(session, "maintenance_cursor", REGISTRY_ID)
        assert registry.data["active_version"] == "1" and "2" not in registry.data["versions"]
    executed = subprocess.run(
        [*command, "--execute"], cwd=root / "apps/server", env=environment, capture_output=True, text=True
    )
    assert executed.returncode == 0, executed.stderr
    assert json.loads(executed.stdout)["mode"] == "execute"
    with app.state.db.transaction(readonly=True) as session:
        assert get(session, "maintenance_cursor", REGISTRY_ID).data["active_version"] == "2"
    for key in [configured.ip_key, *configured.ip_keys.values()]:
        assert key not in executed.stdout + executed.stderr + planned.stdout + planned.stderr
    path.write_text('{"ip_key": "sensitive-invalid-config-marker"')
    failed = subprocess.run(
        command, cwd=root / "apps/server", env=environment, capture_output=True, text=True
    )
    assert failed.returncode == 1
    assert json.loads(failed.stdout)["error_code"] == "ip_rotation_unavailable"
    assert "sensitive-invalid-config-marker" not in failed.stdout + failed.stderr


@pytest.mark.parametrize("damage", ["equality", "ciphertext", "version"])
def test_incomplete_or_corrupt_row_cannot_complete_rotation(setup, damage):
    old, app, company, member, now, settings, credentials, client = seed(setup)
    start(app.state.service, company.id)
    with app.state.db.transaction(scope=company.data["origin"]) as session:
        row = session.scalar(select(NetworkObservation).order_by(NetworkObservation.id).limit(1))
        changes = (
            {"equality": None}
            if damage == "equality"
            else {"address": "invalid-ciphertext"}
            if damage == "ciphertext"
            else {"key_version": "9"}
        )
        row.data = {**row.data, **changes}
    tick(app, company)
    with app.state.db.transaction(readonly=True) as session:
        job = get(session, "maintenance_cursor", job_id(company.id), company.id)
        assert job.data["status"] == "failed" and job.data["processed_rows"] == 0
        assert job.data["error_code"] in {
            "ip_equality_integrity_failed",
            "ip_decryption_failed",
            "ip_key_version_conflict",
        }
