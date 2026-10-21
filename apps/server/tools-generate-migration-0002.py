"""One-time authoring helper for the completion migration, preserving frozen revision 0001."""
import json
import os
import tempfile
from pathlib import Path
from sqlalchemy import create_engine, DefaultClause, text, String
from alembic import command
from alembic.config import Config
from alembic.autogenerate import produce_migrations, render_python_code
from alembic.migration import MigrationContext
from alembic.operations import ops
from aift.db import Base

with tempfile.TemporaryDirectory() as folder:
    directory = Path(folder)
    url = "sqlite:///" + (directory / "previous.db").as_posix()
    settings = directory / "settings.json"
    settings.write_text(json.dumps({"database_url": url, "environment": "test"}))
    os.environ["AIFT_SETTINGS_FILE"] = str(settings)
    command.upgrade(Config("alembic.ini"), "0001")
    engine = create_engine(url)
    with engine.connect() as connection:
        operations = produce_migrations(MigrationContext.configure(connection), Base.metadata).upgrade_ops
        added = []
        for group in operations.ops:
            if isinstance(group, ops.ModifyTableOps):
                for operation in group.ops:
                    if isinstance(operation, ops.AddColumnOp) and not operation.column.nullable:
                        operation.column.server_default = DefaultClause(text("''" if isinstance(operation.column.type, String) else "0"))
                        added.append((group.table_name, operation.column.name))
        generated = render_python_code(operations)
    engine.dispose()

header = '''"""Resumable erasure, immutable policy receipts, scoped domain approvals and stable sessions.

Existing browser sessions are invalidated because a prior hashed CSRF token cannot be recovered safely.
"""
from alembic import op
import sqlalchemy as sa
import hashlib

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
'''
backfill = '''
    bind = op.get_bind()
    mappings = {
        "web_sessions": {"last_seen_at": "last_seen"},
        "deletion_markers": {"scope": "scope", "deletion_user_id": "user_id", "range_start": "start", "range_end": "end", "epoch": "epoch"},
        "observation_revisions": {"record_id": "record_id", "record_kind": "kind"},
        "ingestion_receipts": {"record_id": "record_id", "record_kind": "kind"},
    }
    for name, fields in mappings.items():
        table = sa.table(name, sa.column("data", sa.JSON), *(sa.column(field, sa.Integer if field == "epoch" else sa.String) for field in fields))
        values = {column: (table.c.data[field].as_integer() if column == "epoch" else table.c.data[field].as_string()) for column, field in fields.items()}
        bind.execute(table.update().values(**values))
    op.execute("DELETE FROM web_sessions")
    eras = sa.table("installation_enrollment_eras", sa.column("id", sa.String), sa.column("tenant", sa.String), sa.column("owner", sa.String), sa.column("data", sa.JSON))
    receipts = sa.table("installation_policy_receipts", sa.column("id", sa.String), sa.column("tenant", sa.String), sa.column("owner", sa.String), sa.column("data", sa.JSON))
    cursor = ""
    while True:
        page = bind.execute(sa.select(eras).where(eras.c.id > cursor).order_by(eras.c.id).limit(100)).mappings().all()
        if not page:
            break
        for era in page:
            value = era["data"]
            key = hashlib.sha256((era["tenant"] + ":" + era["id"] + ":" + value["policy_version"]).encode()).hexdigest()
            bind.execute(receipts.insert().values(id=key, tenant=era["tenant"], owner=era["owner"], data={"policy_version": value["policy_version"],
                "acknowledged_at": value["start"], "effective_from": value["start"], "enrollment_era_id": era["id"], "device_id": value["device"]}))
        cursor = page[-1]["id"]
'''
defaults = ""
for table, column in added:
    defaults += f'    with op.batch_alter_table("{table}") as batch:\n        batch.alter_column("{column}", server_default=None)\n'
footer = '''
    op.execute("UPDATE transaction_guard SET schema_version = 2 WHERE id = 1")


def downgrade():
    raise RuntimeError("Restore a reviewed compatible backup and replay the protected erasure journal. Destructive downgrade is unsupported.")
'''
Path("migrations/versions/0002_completion.py").write_text(header + generated + backfill + defaults + footer)
