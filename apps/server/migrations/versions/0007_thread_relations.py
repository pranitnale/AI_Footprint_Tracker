"""Add scoped membership of already-recorded requests without rewriting observations."""

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "recorded_thread_relations",
        sa.Column("tenant", sa.String(36), nullable=False),
        sa.Column("owner", sa.String(36), nullable=False),
        sa.Column("provider_request_key", sa.String(64), nullable=False),
        sa.Column("request_kind", sa.String(10), nullable=False),
        sa.Column("site", sa.String(12), nullable=False),
        sa.Column("key_version", sa.String(1), nullable=False),
        sa.Column("thread_key", sa.String(64), nullable=False),
        sa.Column("source", sa.String(40), nullable=False),
        sa.PrimaryKeyConstraint("tenant", "owner", "provider_request_key"),
        sa.ForeignKeyConstraint(
            ["tenant", "owner", "request_kind", "provider_request_key"],
            [
                "canonical_observations.tenant",
                "canonical_observations.owner",
                "canonical_observations.kind",
                "canonical_observations.stable_key",
            ],
            ondelete="CASCADE",
        ),
        sa.CheckConstraint("request_kind = 'request' AND site = 'perplexity' AND key_version = '1'"),
        sa.CheckConstraint("source = 'perplexity-thread-response-v1'"),
        sa.CheckConstraint("length(provider_request_key) = 64 AND length(thread_key) = 64"),
    )
    op.create_index(
        "ix_recorded_thread_lookup", "recorded_thread_relations", ["tenant", "owner", "thread_key"]
    )
    op.execute("UPDATE transaction_guard SET schema_version = 7 WHERE id = 1")


def downgrade():
    raise RuntimeError("Restore a reviewed compatible backup and replay the protected erasure journal.")
