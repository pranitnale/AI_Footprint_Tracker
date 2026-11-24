"""Saved Claude messages whose text estimate the member's exact rows replace (merged Claude app)."""

import sqlalchemy as sa
from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "historical_replacements",
        sa.Column("tenant", sa.String(36), nullable=False),
        sa.Column("owner", sa.String(36), nullable=False),
        sa.Column("message_key", sa.String(64), nullable=False),
        sa.Column("observed_at", sa.String(24), nullable=False),
        sa.PrimaryKeyConstraint("tenant", "owner", "message_key"),
    )
    op.execute("UPDATE transaction_guard SET schema_version = 15 WHERE id = 1")


def downgrade():
    op.drop_table("historical_replacements")
    op.execute("UPDATE transaction_guard SET schema_version = 14 WHERE id = 1")
