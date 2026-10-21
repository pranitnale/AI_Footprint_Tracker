# Shared contracts are loaded before method metadata during direct Alembic invocation.
# ruff: noqa: E402
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(root / "packages/contracts/python"), str(root / "packages/estimator/python")]

from alembic import context
from sqlalchemy import create_engine

from aift.config import Settings
from aift.db import Base
from aift.method_history import register_models

register_models()

settings = Settings.from_environment()
if context.is_offline_mode():
    context.configure(url=settings.database_url, target_metadata=Base.metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    engine = create_engine(settings.database_url)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=Base.metadata)
        with context.begin_transaction():
            context.run_migrations()
