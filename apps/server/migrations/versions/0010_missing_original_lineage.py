"""Admit reserved live recalculations without inventing an original method hash."""

import re

import sqlalchemy as sa
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None

TABLE = "engine_estimates"
OLD_LINEAGE = "view = 'original' OR original_method_hash IS NOT NULL"
LINEAGE_NAME = "ck_engine_estimates_original_lineage"
LINEAGE = (
    "(NOT original_method_missing AND (view = 'original' OR original_method_hash IS NOT NULL)) "
    "OR (original_method_missing AND view = 'recalculated' AND original_method_hash IS NULL "
    "AND family = 'live')"
)
SOURCE_NAME = "ck_engine_estimates_missing_original_source"
SOURCE = (
    "NOT original_method_missing OR "
    "coalesce(source_payload ->> 'proposed_method_id' = 'unavailable-admission-v1', false)"
)


def _normalized_check(expression):
    # PostgreSQL reflection adds casts and parentheses to the frozen 0009 expression.
    uncast = re.sub(r"::(?:character varying|text)", "", expression.lower())
    return re.sub(r'[\s()"]', "", uncast)


def _legacy_check(connection):
    matches = [
        check
        for check in sa.inspect(connection).get_check_constraints(TABLE)
        if _normalized_check(check["sqltext"]) == _normalized_check(OLD_LINEAGE)
    ]
    if len(matches) != 1:
        raise RuntimeError("engine_estimates_lineage_check_missing_or_ambiguous")
    return matches[0]


def upgrade():
    connection = op.get_bind()
    legacy = _legacy_check(connection)
    column = sa.Column("original_method_missing", sa.Boolean(), nullable=False, server_default=sa.false())
    if connection.dialect.name == "sqlite":
        table = sa.Table(TABLE, sa.MetaData(), autoload_with=connection)
        for constraint in list(table.constraints):
            if isinstance(constraint, sa.CheckConstraint) and _normalized_check(
                str(constraint.sqltext)
            ) == _normalized_check(OLD_LINEAGE):
                table.constraints.remove(constraint)
        # Supplying the reflected table retains the other unnamed checks during batch copying.
        with op.batch_alter_table(TABLE, recreate="always", copy_from=table) as batch:
            batch.add_column(column)
            batch.create_check_constraint(LINEAGE_NAME, LINEAGE)
            batch.create_check_constraint(SOURCE_NAME, SOURCE)
    elif connection.dialect.name == "postgresql":
        if not legacy.get("name"):
            raise RuntimeError("engine_estimates_lineage_check_name_missing")
        op.add_column(TABLE, column)
        op.drop_constraint(legacy["name"], TABLE, type_="check")
        op.create_check_constraint(LINEAGE_NAME, TABLE, LINEAGE)
        op.create_check_constraint(SOURCE_NAME, TABLE, SOURCE)
    else:
        raise RuntimeError("unsupported_migration_dialect")
    op.execute("UPDATE transaction_guard SET schema_version = 10 WHERE id = 1")


def downgrade():
    raise RuntimeError("Restore a reviewed compatible backup and replay the protected erasure journal.")
