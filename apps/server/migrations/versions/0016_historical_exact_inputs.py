"""Claude's own input count for saved replies, so company totals show it (package EC)."""

import sqlalchemy as sa
from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "historical_exact_inputs",
        sa.Column("tenant", sa.String(36), nullable=False),
        sa.Column("owner", sa.String(36), nullable=False),
        sa.Column("message_key", sa.String(64), nullable=False),
        sa.Column("fresh", sa.BigInteger(), nullable=False),
        sa.Column("cache_write", sa.BigInteger(), nullable=False),
        sa.Column("cache_read", sa.BigInteger(), nullable=False),
        sa.PrimaryKeyConstraint("tenant", "owner", "message_key"),
    )
    op.execute("UPDATE transaction_guard SET schema_version = 16 WHERE id = 1")


def downgrade():
    op.drop_table("historical_exact_inputs")
    op.execute("UPDATE transaction_guard SET schema_version = 15 WHERE id = 1")
