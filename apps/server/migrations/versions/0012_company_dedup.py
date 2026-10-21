"""Company deduplication: the server key of each prompt or reply and its shared flag (W11)."""

import sqlalchemy as sa
from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None

TABLES = (
    ("canonical_observations", "ix_observation_company_key"),
    ("historical_observations", "ix_history_company_key"),
)


def upgrade():
    # Existing records carry no key and count as before; keys arrive with new uploads.
    for table, index in TABLES:
        with op.batch_alter_table(table) as batch:
            batch.add_column(sa.Column("company_key", sa.String(64), nullable=True))
            batch.add_column(
                sa.Column("company_shared", sa.Boolean(), nullable=False, server_default=sa.false())
            )
        op.create_index(index, table, ["tenant", "company_key"])
    op.execute("UPDATE transaction_guard SET schema_version = 12 WHERE id = 1")


def downgrade():
    for table, index in TABLES:
        op.drop_index(index, table_name=table)
        with op.batch_alter_table(table) as batch:
            batch.drop_column("company_shared")
            batch.drop_column("company_key")
    op.execute("UPDATE transaction_guard SET schema_version = 11 WHERE id = 1")
