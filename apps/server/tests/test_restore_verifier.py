import sqlite3
from dataclasses import replace

import pytest
from conftest import connect, login
from sqlalchemy import delete, select
from test_analytics import observations, upload

from aift import maintenance
from aift.db import TABLES, get
from aift.main import create_app
from aift.security import canonical
from tools.verify_restore import RestoreVerificationError, verify_restored


def restore_current_backup(setup, tmp_path, monkeypatch):
    app, client, company, _, now, settings = setup
    login(app, client)
    credentials, _ = connect(app, client)
    request, attempt = observations(now[0])
    result = upload(client, credentials, [request, attempt])
    assert result.status_code == 200, result.text
    maintenance.run(app.state.service)
    with app.state.db.transaction(readonly=True) as session:
        original = [
            canonical(row.data)
            for row in session.scalars(select(TABLES["revision"]).order_by(TABLES["revision"].id))
        ]
    target = tmp_path / "restored.db"
    source_path = settings.database_url.removeprefix("sqlite:///")
    with sqlite3.connect(source_path) as source, sqlite3.connect(target) as destination:
        source.backup(destination)
        destination.commit()
    restored_settings = replace(settings, database_url="sqlite:///" + target.as_posix())
    restored = create_app(restored_settings, clock=lambda: now[0])
    with restored.state.db.transaction() as session:
        row = get(session, "company", company.id)
        row.data = {**row.data, "aggregate_status": "rebuilding"}
    return restored, company, original


def test_real_backup_upgrade_and_restore_gate_drains_rebuild_before_certification(
    setup, tmp_path, monkeypatch
):
    restored, company, original = restore_current_backup(setup, tmp_path, monkeypatch)
    with restored.state.db.transaction() as session:
        assert get(session, "company", company.id).data["aggregate_status"] == "rebuilding"
    result = verify_restored(restored.state.service)
    assert result["status"] == "passed" and result["canonical_records_covered"] == 2
    assert result["rollups_checked"] >= 1 and result["worker_ticks"] >= 1
    with restored.state.db.transaction(readonly=True) as session:
        assert get(session, "company", company.id).data["aggregate_status"] == "current"
        after = [
            canonical(row.data)
            for row in session.scalars(select(TABLES["revision"]).order_by(TABLES["revision"].id))
        ]
        assert after == original


def test_restore_gate_work_budget_fails_then_resumes_persisted_cursor(setup, tmp_path, monkeypatch):
    restored, company, _ = restore_current_backup(setup, tmp_path, monkeypatch)
    monkeypatch.setattr(maintenance, "WORK_PAGE", 1)
    with pytest.raises(RestoreVerificationError, match="restore_work_incomplete"):
        verify_restored(restored.state.service, max_worker_ticks=1)
    with restored.state.db.transaction(readonly=True) as session:
        assert get(session, "company", company.id).data["aggregate_status"] == "rebuilding"
    completed = verify_restored(restored.state.service, max_worker_ticks=10)
    assert completed["canonical_records_covered"] == 2 and completed["rollups_checked"] > 0


def test_restore_gate_missing_all_rollups_never_vacuously_passes(setup):
    app, client, company, _, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    result = upload(client, credentials, list(observations(now[0])))
    assert result.status_code == 200, result.text
    maintenance.run(app.state.service)
    with app.state.db.transaction() as session:
        session.execute(delete(TABLES["rollup"]).where(TABLES["rollup"].tenant == company.id))
        assert get(session, "company", company.id).data.get("aggregate_status", "current") == "current"
    with pytest.raises(RestoreVerificationError, match="restore_aggregate_missing"):
        verify_restored(app.state.service)


def test_restore_gate_rejects_payload_tamper_even_when_checksum_matches_canonical(setup):
    app, client, _, _, now, _ = setup
    login(app, client)
    credentials, _ = connect(app, client)
    result = upload(client, credentials, list(observations(now[0])))
    assert result.status_code == 200, result.text
    maintenance.run(app.state.service)
    with app.state.db.transaction() as session:
        row = session.scalar(select(TABLES["rollup"]))
        row.data = {**row.data, "value": {**row.data["value"], "request_count": "999"}}
    with pytest.raises(RestoreVerificationError, match="restore_aggregate_mismatch"):
        verify_restored(app.state.service)
