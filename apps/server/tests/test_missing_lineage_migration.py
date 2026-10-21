"""Frozen 0009 overlays survive the reserved missing-lineage migration unchanged."""

import importlib.util
import io
import json
import os
import shutil
import subprocess
import sys
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from footprint_contracts import payload_hash
from footprint_estimator import BASELINE_METHOD_HASH, BASELINE_METHOD_ID, estimate_observation
from sqlalchemy.exc import IntegrityError
from test_analytics import observations
from test_historical_usage import message

from aift.engine_adapter import estimate, identity, packaged_definition

SERVER = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "migration_0010_review_fixture", SERVER / "migrations/versions/0010_missing_original_lineage.py"
)
MIGRATION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MIGRATION)
COLUMNS = (
    "tenant",
    "owner",
    "family",
    "record_key",
    "observation_hash",
    "request_hash",
    "method_id",
    "view",
    "estimate",
    "source_payload",
    "request_payload",
    "original_method_hash",
)
OMITTED = object()


def migrate(settings, revision):
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", revision],
        cwd=SERVER,
        env={**os.environ, "AIFT_SETTINGS_FILE": str(settings)},
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr


def engine_for(path):
    engine = sa.create_engine("sqlite:///" + path.as_posix())

    @sa.event.listens_for(engine, "connect")
    def foreign_keys(connection, record):
        connection.execute("PRAGMA foreign_keys=ON")

    return engine


def insert_overlay(connection, row, missing=OMITTED):
    values = {name: row[name] for name in COLUMNS}
    if missing is not OMITTED:
        values["original_method_missing"] = missing
    connection.execute(
        sa.text(
            "INSERT INTO engine_estimates ("
            + ", ".join(values)
            + ") VALUES ("
            + ", ".join(":" + name for name in values)
            + ")"
        ),
        values,
    )


def json_bytes(connection):
    return list(
        connection.execute(
            sa.text(
                "SELECT tenant, owner, family, record_key, observation_hash, request_hash, method_id, view, "
                "CAST(estimate AS BLOB), CAST(source_payload AS BLOB), CAST(request_payload AS BLOB), "
                "original_method_hash FROM engine_estimates ORDER BY record_key, view"
            )
        ).tuples()
    )


def schema_identity(engine):
    inspector = sa.inspect(engine)
    return {
        "pk": inspector.get_pk_constraint("engine_estimates"),
        "fks": inspector.get_foreign_keys("engine_estimates"),
        "indexes": inspector.get_indexes("engine_estimates"),
        "unique": inspector.get_unique_constraints("engine_estimates"),
    }


@pytest.fixture(scope="module")
def populated_0009(tmp_path_factory):
    directory = tmp_path_factory.mktemp("missing-lineage-0009")
    database = directory / "source.db"
    settings = directory / "settings.json"
    settings.write_text(
        json.dumps({"database_url": "sqlite:///" + database.as_posix(), "environment": "test"})
    )
    migrate(settings, "0009")
    engine = engine_for(database)
    tenant, owner = str(uuid4()), str(uuid4())
    now = datetime(2026, 9, 10, 12, tzinfo=UTC)
    request, attempt = observations(now)
    original_attempt = deepcopy(attempt)
    definition = packaged_definition()
    method = identity(definition)
    original_attempt["attempt_id"] = str(uuid4())
    original_attempt["proposed_method_id"] = method["method_id"]
    history = message(now, "c" * 64)
    history["site"] = "chatgpt"
    options = {"view": "recalculated", "originalMethodHash": BASELINE_METHOD_HASH}
    cases = [
        (original_attempt, request, "original", estimate(definition, original_attempt, request)),
        (attempt, request, "recalculated", estimate(definition, attempt, request, options)),
        (history, None, "recalculated", estimate(definition, history, options=options)),
    ]

    def encode(value):
        # Whitespace is intentional: batch migration must copy the stored JSON text, not reserialize it.
        return json.dumps(value, ensure_ascii=False, indent=2)

    rows = []
    for source, parent, view, result in cases:
        rows.append(
            {
                "tenant": tenant,
                "owner": owner,
                "family": "live" if parent else "history",
                "record_key": source["attempt_id"] if parent else source["message_key"],
                "observation_hash": payload_hash(
                    source if parent else {k: v for k, v in source.items() if k != "observed_at"}
                ),
                "request_hash": payload_hash(parent) if parent else "",
                "method_id": method["method_id"],
                "view": view,
                "estimate": encode(result),
                "source_payload": encode(source),
                "request_payload": encode(parent) if parent else None,
                "original_method_hash": None if view == "original" else BASELINE_METHOD_HASH,
            }
        )
    metadata = sa.MetaData()
    companies = sa.Table("companies", metadata, autoload_with=engine)
    members = sa.Table("memberships", metadata, autoload_with=engine)
    resources = sa.Table("resource_estimates", metadata, autoload_with=engine)
    try:
        with engine.begin() as connection:
            connection.execute(
                companies.insert().values(
                    id=tenant,
                    tenant="",
                    owner=None,
                    origin="https://migration.example.org",
                    slug="migration",
                    domain="example.org",
                    data={},
                )
            )
            connection.execute(
                members.insert().values(
                    id=owner,
                    tenant=tenant,
                    owner=owner,
                    role="user",
                    status="active",
                    version=1,
                    data={},
                )
            )
            for row in rows:
                insert_overlay(connection, row)
            connection.execute(
                resources.insert().values(
                    tenant=tenant,
                    owner=owner,
                    attempt_id=attempt["attempt_id"],
                    revision=1,
                    method_id=BASELINE_METHOD_ID,
                    view="original",
                    observation_hash=payload_hash(attempt),
                    original_method_hash=None,
                    estimate=estimate_observation(attempt),
                    created_at="2026-09-10T12:00:00.000Z",
                )
            )
            before = json_bytes(connection)
            legacy_sql = connection.exec_driver_sql(
                "SELECT sql FROM sqlite_master WHERE name = 'resource_estimates'"
            ).scalar_one()
            legacy_bytes = connection.exec_driver_sql(
                "SELECT CAST(estimate AS BLOB) FROM resource_estimates"
            ).scalar_one()
        shape = schema_identity(engine)
    finally:
        engine.dispose()
    return {
        "database": database,
        "rows": rows,
        "bytes": before,
        "shape": shape,
        "legacy_sql": legacy_sql,
        "legacy_bytes": legacy_bytes,
    }


@pytest.fixture
def migrated(populated_0009, tmp_path):
    database = tmp_path / "migrated.db"
    shutil.copyfile(populated_0009["database"], database)
    settings = tmp_path / "settings.json"
    settings.write_text(
        json.dumps({"database_url": "sqlite:///" + database.as_posix(), "environment": "test"})
    )
    migrate(settings, "0010")
    engine = engine_for(database)
    try:
        yield engine, populated_0009
    finally:
        engine.dispose()


def candidate(
    seed, *, family="live", view="recalculated", original_hash=None, source="unavailable-admission-v1"
):
    row = dict(seed["rows"][1])
    row.update(record_key=str(uuid4()), family=family, view=view, original_method_hash=original_hash)
    payload = json.loads(row["source_payload"])
    if source is OMITTED:
        del payload["proposed_method_id"]
    else:
        payload["proposed_method_id"] = source
    row["source_payload"] = json.dumps(payload)
    return row


def test_populated_0009_json_bytes_keys_foreign_keys_and_indexes_survive(migrated):
    engine, seed = migrated
    assert schema_identity(engine) == seed["shape"]
    with engine.connect() as connection:
        assert json_bytes(connection) == seed["bytes"]
        assert connection.exec_driver_sql(
            "SELECT DISTINCT original_method_missing FROM engine_estimates"
        ).all() == [(0,)]
        assert connection.exec_driver_sql("SELECT schema_version FROM transaction_guard").scalar_one() == 10
        assert connection.exec_driver_sql("SELECT version_num FROM alembic_version").scalar_one() == "0010"
        assert (
            connection.exec_driver_sql("SELECT CAST(estimate AS BLOB) FROM resource_estimates").scalar_one()
            == seed["legacy_bytes"]
        )
        assert (
            connection.exec_driver_sql(
                "SELECT sql FROM sqlite_master WHERE name = 'resource_estimates'"
            ).scalar_one()
            == seed["legacy_sql"]
        )
        assert connection.exec_driver_sql("PRAGMA foreign_key_check").all() == []
    constraints = {check["name"] for check in sa.inspect(engine).get_check_constraints("engine_estimates")}
    assert {MIGRATION.LINEAGE_NAME, MIGRATION.SOURCE_NAME} <= constraints
    missing = next(
        column
        for column in sa.inspect(engine).get_columns("engine_estimates")
        if column["name"] == "original_method_missing"
    )
    assert not missing["nullable"] and str(missing["default"]) == "0"


def test_reserved_live_null_lineage_is_narrow_and_default_is_false(migrated):
    engine, seed = migrated
    reserved = candidate(seed)
    ordinary = candidate(seed, view="original", source="ordinary-method")
    known = candidate(seed, original_hash=BASELINE_METHOD_HASH, source="ordinary-method")
    with engine.begin() as connection:
        insert_overlay(connection, reserved, True)
        insert_overlay(connection, ordinary)
        insert_overlay(connection, known)
    with engine.connect() as connection:
        flags = {
            key: flag
            for key, flag in connection.execute(
                sa.text("SELECT record_key, original_method_missing FROM engine_estimates")
            )
        }
        assert flags[reserved["record_key"]] == 1
        assert flags[ordinary["record_key"]] == flags[known["record_key"]] == 0
    invalid = [
        (candidate(seed), False),
        (candidate(seed), OMITTED),
        (candidate(seed), None),
        (candidate(seed, view="original"), True),
        (candidate(seed, original_hash=BASELINE_METHOD_HASH), True),
        (candidate(seed, family="history"), True),
        (candidate(seed, source="arbitrary-unknown-method"), True),
        (candidate(seed, source=OMITTED), True),
        (candidate(seed, source=None), True),
        (candidate(seed, family="other", original_hash=BASELINE_METHOD_HASH), False),
        (candidate(seed, view="other", original_hash=BASELINE_METHOD_HASH), False),
    ]
    for row, flag in invalid:
        with pytest.raises(IntegrityError), engine.begin() as connection:
            insert_overlay(connection, row, flag)
    with pytest.raises(IntegrityError), engine.begin() as connection:
        insert_overlay(connection, {**known, "record_key": str(uuid4()), "owner": str(uuid4())})
    with pytest.raises(IntegrityError), engine.begin() as connection:
        insert_overlay(connection, reserved, True)


def test_legacy_recalculation_still_requires_original_hash(migrated):
    engine, seed = migrated
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(
            sa.text(
                "INSERT INTO resource_estimates (tenant, owner, attempt_id, revision, method_id, view, "
                "observation_hash, original_method_hash, estimate, created_at) "
                "VALUES (:tenant, :owner, :id, 1, :method, 'recalculated', :hash, NULL, '{}', :created)"
            ),
            {
                "tenant": seed["rows"][0]["tenant"],
                "owner": seed["rows"][0]["owner"],
                "id": str(uuid4()),
                "method": BASELINE_METHOD_ID,
                "hash": "a" * 64,
                "created": "2026-09-10T12:00:00.000Z",
            },
        )


@pytest.mark.parametrize(
    "sql",
    [
        "view = 'original' OR original_method_hash IS NOT NULL",
        "(((view)::text = 'original'::text) OR (original_method_hash IS NOT NULL))",
        "(\"view\"::character varying::text = 'original'::text OR original_method_hash IS NOT NULL)",
    ],
)
def test_discovers_old_postgresql_check_by_expression_not_assumed_name(monkeypatch, sql):
    class Inspector:
        def get_check_constraints(self, table):
            assert table == "engine_estimates"
            return [
                {"name": "engine_estimates_check", "sqltext": "family IN ('live', 'history')"},
                {"name": "deployment_named_old_lineage", "sqltext": sql},
            ]

    monkeypatch.setattr(MIGRATION.sa, "inspect", lambda connection: Inspector())
    assert MIGRATION._legacy_check(object())["name"] == "deployment_named_old_lineage"


@pytest.mark.parametrize("count", [0, 2])
def test_refuses_missing_or_ambiguous_legacy_check(monkeypatch, count):
    class Inspector:
        def get_check_constraints(self, table):
            return [{"name": str(i), "sqltext": MIGRATION.OLD_LINEAGE} for i in range(count)]

    monkeypatch.setattr(MIGRATION.sa, "inspect", lambda connection: Inspector())
    with pytest.raises(RuntimeError, match="missing_or_ambiguous"):
        MIGRATION._legacy_check(object())


def test_postgresql_upgrade_compiles_discovered_drop_and_narrow_checks(monkeypatch):
    output = io.StringIO()
    context = MigrationContext.configure(
        dialect_name="postgresql", opts={"as_sql": True, "output_buffer": output}
    )
    monkeypatch.setattr(MIGRATION, "op", Operations(context))
    monkeypatch.setattr(
        MIGRATION, "_legacy_check", lambda connection: {"name": "deployment_named_old_lineage"}
    )
    MIGRATION.upgrade()
    sql = output.getvalue()
    assert "ADD COLUMN original_method_missing BOOLEAN DEFAULT false NOT NULL" in sql
    assert "DROP CONSTRAINT deployment_named_old_lineage" in sql
    assert "ADD CONSTRAINT ck_engine_estimates_original_lineage CHECK" in sql
    assert "ADD CONSTRAINT ck_engine_estimates_missing_original_source CHECK" in sql
    assert "coalesce(source_payload ->> 'proposed_method_id' = 'unavailable-admission-v1', false)" in sql
    assert "schema_version = 10" in sql
    assert "resource_estimates" not in sql and "DROP TABLE" not in sql


def test_downgrade_requires_reviewed_restore():
    with pytest.raises(RuntimeError, match="reviewed compatible backup"):
        MIGRATION.downgrade()
