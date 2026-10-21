"""Rebuild request-presence complements before exposing file extraction aggregates."""

import hashlib

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    metadata = sa.MetaData()
    companies = sa.Table("companies", metadata, autoload_with=connection)
    observations = sa.Table("canonical_observations", metadata, autoload_with=connection)
    rollups = sa.Table("daily_usage_rollups", metadata, autoload_with=connection)
    cursors = sa.Table("maintenance_cursors", metadata, autoload_with=connection)
    exports = sa.Table("export_jobs", metadata, autoload_with=connection)
    after = ""
    while True:
        page = connection.execute(
            sa.select(companies.c.id, companies.c.data)
            .where(
                companies.c.id > after,
                sa.or_(
                    sa.exists(sa.select(1).where(observations.c.tenant == companies.c.id)),
                    sa.exists(sa.select(1).where(rollups.c.tenant == companies.c.id)),
                ),
            )
            .order_by(companies.c.id)
            .limit(100)
        ).all()
        if not page:
            break
        for identifier, data in page:
            connection.execute(
                companies.update()
                .where(companies.c.id == identifier)
                .values(data={**data, "aggregate_status": "rebuilding", "aggregate_format": "4"})
            )
            cursor_id = hashlib.sha256((identifier + ":rebucket").encode()).hexdigest()
            connection.execute(
                cursors.delete().where(cursors.c.id == cursor_id, cursors.c.tenant == identifier)
            )
        after = page[-1].id
    after = ""
    while True:
        page = connection.execute(
            sa.select(exports.c.id, exports.c.data)
            .where(exports.c.id > after)
            .order_by(exports.c.id)
            .limit(100)
        ).all()
        if not page:
            break
        for identifier, data in page:
            connection.execute(
                exports.update()
                .where(exports.c.id == identifier)
                .values(data={**data, "status": "cancelled", "error_code": "summary_format_changed"})
            )
        after = page[-1].id
    op.execute("UPDATE transaction_guard SET schema_version = 6 WHERE id = 1")


def downgrade():
    raise RuntimeError("Restore a reviewed compatible backup and replay the protected erasure journal.")
