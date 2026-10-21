"""Contact requests from the public website, read in the developer panel's inbox."""

import sqlalchemy as sa
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "contact_requests",
        sa.Column("id", sa.String(length=128), nullable=False),
        sa.Column("tenant", sa.String(length=36), nullable=False),
        sa.Column("owner", sa.String(length=36), nullable=True),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_contact_requests_owner"), "contact_requests", ["owner"], unique=False)
    op.create_index(op.f("ix_contact_requests_tenant"), "contact_requests", ["tenant"], unique=False)
    op.execute("UPDATE transaction_guard SET schema_version = 13 WHERE id = 1")


def downgrade():
    op.drop_index(op.f("ix_contact_requests_tenant"), table_name="contact_requests")
    op.drop_index(op.f("ix_contact_requests_owner"), table_name="contact_requests")
    op.drop_table("contact_requests")
    op.execute("UPDATE transaction_guard SET schema_version = 12 WHERE id = 1")
