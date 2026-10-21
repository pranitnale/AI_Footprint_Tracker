"""Immutable reviewed method bundles and separately persisted calculation lineage."""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "method_bundles",
        sa.Column("method_id", sa.String(128), primary_key=True),
        sa.Column("method_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("bundle", sa.JSON(), nullable=False),
        sa.Column("approval", sa.JSON(), nullable=False),
        sa.Column("installed_at", sa.String(24), nullable=False),
    )
    op.create_table(
        "resource_estimates",
        sa.Column("tenant", sa.String(36), primary_key=True),
        sa.Column("owner", sa.String(36), primary_key=True),
        sa.Column("attempt_id", sa.String(36), primary_key=True),
        sa.Column("revision", sa.Integer(), primary_key=True),
        sa.Column("method_id", sa.String(128), primary_key=True),
        sa.Column("view", sa.String(16), primary_key=True),
        sa.Column("observation_hash", sa.String(64), nullable=False),
        sa.Column("original_method_hash", sa.String(64), nullable=True),
        sa.Column("estimate", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.String(24), nullable=False),
        sa.ForeignKeyConstraint(["tenant", "owner"], ["memberships.tenant", "memberships.id"]),
        sa.CheckConstraint("revision >= 1"),
        sa.CheckConstraint("view IN ('original', 'recalculated')"),
        sa.CheckConstraint("view = 'original' OR original_method_hash IS NOT NULL"),
    )
    op.create_index("ix_resource_estimate_record", "resource_estimates", ["tenant", "owner", "attempt_id"])
    op.create_table(
        "method_recalculation_jobs",
        sa.Column("method_id", sa.String(128), nullable=False),
        sa.Column("actor", sa.String(36), nullable=False),
        sa.Column("id", sa.String(128), primary_key=True),
        sa.Column("tenant", sa.String(36), nullable=False),
        sa.Column("owner", sa.String(36), nullable=True),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["tenant"], ["companies.id"]),
        sa.ForeignKeyConstraint(["tenant", "owner"], ["memberships.tenant", "memberships.id"]),
    )
    for field in ("method_id", "tenant", "owner"):
        op.create_index("ix_method_recalculation_jobs_" + field, "method_recalculation_jobs", [field])
    op.execute("UPDATE transaction_guard SET schema_version = 3 WHERE id = 1")


def downgrade():
    raise RuntimeError(
        "Restore a reviewed compatible backup and replay the protected erasure journal. Destructive downgrade is unsupported."
    )
