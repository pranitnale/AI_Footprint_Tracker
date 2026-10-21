"""Development helper: generate the initial immutable migration before its first release."""
from pathlib import Path
from sqlalchemy import create_engine
from alembic.autogenerate import produce_migrations, render_python_code
from alembic.migration import MigrationContext
from aift.db import Base

engine = create_engine("sqlite://")
with engine.connect() as connection:
    context = MigrationContext.configure(connection)
    operations = produce_migrations(context, Base.metadata).upgrade_ops
    generated = render_python_code(operations)
header = '''"""Initial scoped protocol, numerical observation and daily rollup schema.

Frozen before first release. Later schema changes require new migrations.
"""
from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
'''
footer = '''
    op.execute("INSERT INTO transaction_guard (id, schema_version) VALUES (1, 1)")


def downgrade():
    raise RuntimeError("Destructive downgrade is unsupported. Restore a reviewed backup and replay the erasure journal.")
'''
Path("migrations/versions/0001_initial.py").write_text(header + generated + footer, encoding="utf-8")
