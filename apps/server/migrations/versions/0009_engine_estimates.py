"""Add separately versioned engine/history overlays without rewriting original evidence."""

import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "engine_estimates",
        sa.Column("tenant", sa.String(36), nullable=False),
        sa.Column("owner", sa.String(36), nullable=False),
        sa.Column("family", sa.String(8), nullable=False),
        sa.Column("record_key", sa.String(64), nullable=False),
        sa.Column("observation_hash", sa.String(64), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("method_id", sa.String(128), nullable=False),
        sa.Column("view", sa.String(16), nullable=False),
        sa.Column("estimate", sa.JSON(), nullable=False),
        sa.Column("source_payload", sa.JSON(), nullable=False),
        sa.Column("request_payload", sa.JSON()),
        sa.Column("original_method_hash", sa.String(64)),
        sa.PrimaryKeyConstraint(
            "tenant", "owner", "family", "record_key", "observation_hash", "request_hash", "method_id", "view"
        ),
        sa.ForeignKeyConstraint(["tenant", "owner"], ["memberships.tenant", "memberships.id"]),
        sa.CheckConstraint("family IN ('live', 'history') AND view IN ('original', 'recalculated')"),
        sa.CheckConstraint("view = 'original' OR original_method_hash IS NOT NULL"),
    )
    op.create_index(
        "ix_engine_estimate_record", "engine_estimates", ["tenant", "owner", "family", "record_key"]
    )
    op.execute("UPDATE transaction_guard SET schema_version = 9 WHERE id = 1")


def downgrade():
    raise RuntimeError("Restore a reviewed compatible backup and replay the protected erasure journal.")
