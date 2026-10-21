import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import make_url
from sqlalchemy.schema import CreateTable

from aift.db import Base, Database, get, put
from aift.mail import FakeMail
from aift.security import Problem
from aift.service import Service


def test_frozen_alembic_migration_creates_relational_schema(tmp_path):
    settings = tmp_path / "settings.json"
    database = tmp_path / "migrated.db"
    settings.write_text(
        json.dumps({"database_url": "sqlite:///" + database.as_posix(), "environment": "test"})
    )
    run = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=Path(__file__).resolve().parents[1],
        env={**os.environ, "AIFT_SETTINGS_FILE": str(settings)},
        capture_output=True,
        text=True,
    )
    assert run.returncode == 0, run.stderr
    engine = create_engine("sqlite:///" + database.as_posix())
    tables = inspect(engine).get_table_names()
    assert "daily_usage_rollups" in tables and "memberships" in tables and "protocol_entities" not in tables
    assert len(inspect(engine).get_foreign_keys("canonical_observations")) >= 2
    assert (
        inspect(engine).get_foreign_keys("recorded_thread_relations")[0]["options"]["ondelete"] == "CASCADE"
    )
    with engine.connect() as connection:
        assert connection.execute(text("SELECT schema_version FROM transaction_guard")).scalar_one() == 14
    engine.dispose()


def test_postgresql_ddl_compiles_scoped_keys():
    ddl = "\n".join(
        str(CreateTable(table).compile(dialect=postgresql.dialect())) for table in Base.metadata.sorted_tables
    )
    assert "FOREIGN KEY(tenant, owner, device)" in ddl
    assert "CREATE TABLE daily_usage_rollups" in ddl
    assert "role IN ('user', 'admin')" in ddl
    assert "CREATE TABLE recorded_thread_relations" in ddl
    assert "FOREIGN KEY(tenant, owner, request_kind, provider_request_key)" in ddl
    assert "CREATE TABLE historical_observations" in ddl
    assert "CREATE TABLE historical_tombstones" in ddl


def test_upgrade_0008_keeps_existing_tombstones_conservative(tmp_path):
    settings = tmp_path / "settings.json"
    url = "sqlite:///" + (tmp_path / "history-upgrade.db").as_posix()
    settings.write_text(json.dumps({"database_url": url, "environment": "test"}))
    command = [sys.executable, "-m", "alembic", "upgrade"]
    environment = {**os.environ, "AIFT_SETTINGS_FILE": str(settings)}
    workspace = Path(__file__).resolve().parents[1]
    before = subprocess.run([*command, "0007"], cwd=workspace, env=environment, capture_output=True)
    assert before.returncode == 0, before.stderr
    engine = create_engine(url)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO record_deletion_tombstones (tenant, owner, kind, record_id, epoch, stable_key) "
                "VALUES (:tenant, :owner, 'request', :record, 1, :stable)"
            ),
            {"tenant": str(uuid4()), "owner": str(uuid4()), "record": str(uuid4()), "stable": "a" * 64},
        )
    engine.dispose()
    migrated = subprocess.run([*command, "head"], cwd=workspace, env=environment, capture_output=True)
    assert migrated.returncode == 0, migrated.stderr
    engine = create_engine(url)
    with engine.connect() as connection:
        assert (
            connection.execute(text("SELECT reason FROM record_deletion_tombstones")).scalar_one()
            == "legacy_unknown"
        )
        assert connection.execute(text("SELECT count(*) FROM historical_observations")).scalar_one() == 0
    engine.dispose()


def test_upgrade_0002_backfills_existing_history_and_invalidates_old_sessions(tmp_path):
    from sqlalchemy import MetaData, Table

    settings = tmp_path / "upgrade-settings.json"
    database = tmp_path / "upgrade.db"
    url = "sqlite:///" + database.as_posix()
    settings.write_text(json.dumps({"database_url": url, "environment": "test"}))
    command = [sys.executable, "-m", "alembic", "upgrade"]
    environment = {**os.environ, "AIFT_SETTINGS_FILE": str(settings)}
    workspace = Path(__file__).resolve().parents[1]
    assert (
        subprocess.run([*command, "0001"], cwd=workspace, env=environment, capture_output=True).returncode
        == 0
    )
    engine = create_engine(url)
    metadata = MetaData()
    tables = {
        name: Table(name, metadata, autoload_with=engine)
        for name in (
            "companies",
            "memberships",
            "devices",
            "installation_enrollment_eras",
            "web_sessions",
            "ingestion_receipts",
        )
    }
    company, user, device, era, record = (str(uuid4()) for _ in range(5))
    at = "2026-09-10T12:00:00.000Z"
    with engine.begin() as connection:
        connection.execute(
            tables["companies"]
            .insert()
            .values(
                id=company,
                tenant="",
                owner=None,
                origin="https://fixture.example.org",
                slug="fixture",
                domain="example.org",
                data={},
            )
        )
        connection.execute(
            tables["memberships"]
            .insert()
            .values(id=user, tenant=company, owner=user, role="admin", status="active", version=1, data={})
        )
        connection.execute(
            tables["devices"]
            .insert()
            .values(id=device, tenant=company, owner=user, status="active", browser_family="chrome", data={})
        )
        connection.execute(
            tables["installation_enrollment_eras"]
            .insert()
            .values(
                id=era,
                tenant=company,
                owner=user,
                device_id=device,
                started_at=at,
                ended_at=None,
                data={"device": device, "start": at, "end": None, "policy_version": "1.0.0"},
            )
        )
        connection.execute(
            tables["web_sessions"]
            .insert()
            .values(
                id="a" * 64,
                tenant=company,
                owner=user,
                purpose="tenant",
                expires_at="2026-09-11T12:00:00.000Z",
                data={"last_seen": at},
            )
        )
        connection.execute(
            tables["ingestion_receipts"]
            .insert()
            .values(id="b" * 64, tenant=company, owner=user, data={"kind": "request", "record_id": record})
        )
    engine.dispose()
    migrated = subprocess.run(
        [*command, "head"], cwd=workspace, env=environment, capture_output=True, text=True
    )
    assert migrated.returncode == 0, migrated.stderr
    engine = create_engine(url)
    with engine.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM web_sessions")).scalar_one() == 0
        assert connection.execute(text("SELECT count(*) FROM ingestion_receipts")).scalar_one() == 0
        receipt = connection.execute(text("SELECT data FROM installation_policy_receipts")).scalar_one()
        assert json.loads(receipt)["effective_from"] == at
    engine.dispose()


@pytest.mark.skipif(
    not os.environ.get("AIFT_POSTGRES_TEST_URL"),
    reason="Requires explicitly supplied isolated PostgreSQL; Windows policy blocked local runtime",
)
def test_postgresql_last_seat_transaction_race(setup):
    settings = setup[-1]
    source_url = os.environ["AIFT_POSTGRES_TEST_URL"]
    schema = "aift_test_" + uuid4().hex
    admin_engine = create_engine(source_url)
    with admin_engine.begin() as connection:
        connection.execute(text('CREATE SCHEMA "' + schema + '"'))
    scoped_url = make_url(source_url).update_query_dict({"options": "-csearch_path=" + schema})
    target = replace(settings, database_url=scoped_url.render_as_string(hide_password=False))
    database = Database(target, initialize=True)
    service = Service(target, database, FakeMail())
    try:
        with database.transaction() as session:
            company = put(session, "company", str(uuid4()), {**setup[2].data, "capacity": 2})
            service.member(session, company, "admin@example.org", True)

        def enter(email):
            try:
                with database.transaction(scope=company.data["origin"]) as session:
                    service.member(session, get(session, "company", company.id), email)
                return "accepted"
            except Problem as problem:
                return problem.code

        with ThreadPoolExecutor(max_workers=2) as executor:
            result = list(executor.map(enter, ["first@example.org", "second@example.org"]))
        assert sorted(result) == ["accepted", "capacity_reached"]
    finally:
        database.engine.dispose()
        with admin_engine.begin() as connection:
            connection.execute(text('DROP SCHEMA "' + schema + '" CASCADE'))
        admin_engine.dispose()


def test_current_timing_reset_preserves_authentication_and_erasure_protection(tmp_path):
    from sqlalchemy import MetaData, Table

    settings = tmp_path / "current-settings.json"
    url = "sqlite:///" + (tmp_path / "current-upgrade.db").as_posix()
    settings.write_text(json.dumps({"database_url": url, "environment": "test"}))
    command = [sys.executable, "-m", "alembic", "upgrade"]
    environment = {**os.environ, "AIFT_SETTINGS_FILE": str(settings)}
    workspace = Path(__file__).resolve().parents[1]
    before = subprocess.run([*command, "0010"], cwd=workspace, env=environment, capture_output=True)
    assert before.returncode == 0, before.stderr
    engine = create_engine(url)
    names = (
        "companies",
        "memberships",
        "devices",
        "web_sessions",
        "ingestion_receipts",
        "historical_tombstones",
    )
    tables = {name: Table(name, MetaData(), autoload_with=engine) for name in names}
    company, owner, device = (str(uuid4()) for _ in range(3))
    with engine.begin() as connection:
        connection.execute(
            tables["companies"]
            .insert()
            .values(
                id=company,
                tenant="",
                owner=None,
                origin="https://reset.example.org",
                slug="reset",
                domain="example.org",
                data={"epoch": 3},
            )
        )
        connection.execute(
            tables["memberships"]
            .insert()
            .values(id=owner, tenant=company, owner=owner, role="admin", status="active", version=1, data={})
        )
        connection.execute(
            tables["devices"]
            .insert()
            .values(
                id=device,
                tenant=company,
                owner=owner,
                status="active",
                browser_family="chrome",
                data={"preference": "original"},
            )
        )
        connection.execute(
            tables["web_sessions"]
            .insert()
            .values(
                id="a" * 64,
                tenant=company,
                owner=owner,
                purpose="tenant",
                expires_at="2026-09-20T00:00:00.000Z",
                last_seen_at="2026-09-15T00:00:00.000Z",
                data={},
            )
        )
        connection.execute(
            tables["ingestion_receipts"]
            .insert()
            .values(
                id="b" * 64,
                tenant=company,
                owner=owner,
                record_id=str(uuid4()),
                record_kind="attempt",
                data={"schema_version": "1.2.0"},
            )
        )
        connection.execute(
            tables["historical_tombstones"]
            .insert()
            .values(tenant=company, owner=owner, message_key="c" * 64, epoch=3)
        )
    engine.dispose()
    after = subprocess.run([*command, "head"], cwd=workspace, env=environment, capture_output=True)
    assert after.returncode == 0, after.stderr
    engine = create_engine(url)
    with engine.connect() as connection:
        for name in ("companies", "memberships", "devices", "web_sessions", "historical_tombstones"):
            assert connection.execute(text(f'SELECT count(*) FROM "{name}"')).scalar_one() == 1
        assert connection.execute(text("SELECT count(*) FROM ingestion_receipts")).scalar_one() == 0
        assert connection.execute(text("SELECT schema_version FROM transaction_guard")).scalar_one() == 14
    assert "history_hash" in inspect(engine).get_pk_constraint("engine_estimates")["constrained_columns"]
    engine.dispose()
