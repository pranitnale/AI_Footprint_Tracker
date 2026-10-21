"""Separate numeric history observations, occurrence dates and durable erasure identity."""

import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "record_deletion_tombstones",
        sa.Column("reason", sa.String(16), nullable=False, server_default="legacy_unknown"),
    )
    op.create_table(
        "historical_observations",
        sa.Column("tenant", sa.String(36), nullable=False),
        sa.Column("owner", sa.String(36), nullable=False),
        sa.Column("message_key", sa.String(64), nullable=False),
        sa.Column("device", sa.String(36), nullable=False),
        sa.Column("conversation", sa.String(64), nullable=False),
        sa.Column("role", sa.String(8), nullable=False),
        sa.Column("site", sa.String(12), nullable=False),
        sa.Column("occurred_at", sa.String(27)),
        sa.Column("observed_at", sa.String(24), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("original", sa.JSON(), nullable=False),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        sa.Column("estimate", sa.JSON(), nullable=False),
        sa.Column("original_estimate", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.PrimaryKeyConstraint("tenant", "owner", "message_key"),
        sa.ForeignKeyConstraint(
            ["tenant", "owner", "device"], ["devices.tenant", "devices.owner", "devices.id"]
        ),
        sa.CheckConstraint("role IN ('prompt','response') AND status IN ('current','conflict')"),
    )
    op.create_index(
        "ix_history_conversation",
        "historical_observations",
        ["tenant", "owner", "conversation", "message_key"],
    )
    op.create_index(
        "ix_history_date", "historical_observations", ["tenant", "occurred_at", "owner", "message_key"]
    )
    op.create_table(
        "historical_coverage",
        sa.Column("tenant", sa.String(36), nullable=False),
        sa.Column("owner", sa.String(36), nullable=False),
        sa.Column("conversation", sa.String(64), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.PrimaryKeyConstraint("tenant", "owner", "conversation"),
    )
    op.create_table(
        "historical_tombstones",
        sa.Column("tenant", sa.String(36), nullable=False),
        sa.Column("owner", sa.String(36), nullable=False),
        sa.Column("message_key", sa.String(64), nullable=False),
        sa.Column("epoch", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("tenant", "owner", "message_key"),
    )
    op.execute("UPDATE transaction_guard SET schema_version = 8 WHERE id = 1")


def downgrade():
    raise RuntimeError("Restore a reviewed compatible backup and replay the protected erasure journal.")
