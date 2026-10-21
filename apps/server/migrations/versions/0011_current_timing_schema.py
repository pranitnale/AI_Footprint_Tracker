"""Replace preproduction usage with current observations and history-bound estimates."""

import sqlalchemy as sa
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade():
    # This preproduction reset deliberately retains authentication and erasure protection.
    for table in (
        "recorded_thread_relations",
        "request_attempt_links",
        "engine_estimates",
        "resource_estimates",
        "method_recalculation_jobs",
        "historical_coverage",
        "historical_observations",
        "daily_usage_rollups",
        "observation_revisions",
        "ingestion_receipts",
        "observation_aliases",
        "canonical_observations",
    ):
        op.execute(sa.text(f'DELETE FROM "{table}"'))
    op.execute(
        sa.text(
            "DELETE FROM method_bundles WHERE bundle ->> 'engine_id' = 'ecologits' "
            "AND bundle ->> 'latency_policy' <> 'observed-live-then-history-then-modeled-1'"
        )
    )
    connection = op.get_bind()
    primary = sa.inspect(connection).get_pk_constraint("engine_estimates")
    naming = {"pk": "pk_%(table_name)s"}
    with op.batch_alter_table("engine_estimates", naming_convention=naming) as batch:
        batch.add_column(sa.Column("history_hash", sa.String(64), nullable=False, server_default=""))
        batch.add_column(sa.Column("history_payload", sa.JSON(), nullable=True))
        batch.drop_constraint(primary["name"] or "pk_engine_estimates", type_="primary")
        batch.create_primary_key("pk_engine_estimates", [*primary["constrained_columns"], "history_hash"])
    op.execute("UPDATE transaction_guard SET schema_version = 11 WHERE id = 1")


def downgrade():
    raise RuntimeError("The preproduction usage reset cannot reconstruct deleted observations.")
