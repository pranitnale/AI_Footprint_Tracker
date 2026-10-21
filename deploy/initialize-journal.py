"""Initialize a protected empty journal only for a confirmed new, empty application database."""

import argparse
import json
import os
import sys
from pathlib import Path

if __file__ != "<stdin>":
    root = Path(__file__).resolve().parents[1]
    sys.path[:0] = [
        str(root / "apps/server"),
        str(root / "packages/contracts/python"),
        str(root / "packages/estimator/python"),
    ]


def initialize(settings, *, execute=False, confirmed=False):
    import portalocker
    from sqlalchemy import inspect, select

    from aift.db import TABLES, Database, DeletionTombstone, Guard, Observation
    from aift.journal import verified_entries
    from aift.security import Secrets

    if execute and not confirmed:
        raise ValueError("new_deployment_confirmation_required")
    target = Path(settings.deletion_journal_path).resolve()
    head = Path(str(target) + ".head")
    if not settings.deletion_journal_path or not target.parent.is_dir():
        raise ValueError("protected_journal_directory_required")
    if target.exists() or head.exists():
        raise ValueError("journal_already_exists")
    crypto = Secrets(settings)
    database = Database(settings)
    try:
        with database.transaction(scope="journal-bootstrap", readonly=not execute) as session:
            required_tables = {
                "transaction_guard",
                "record_deletion_tombstones",
                "canonical_observations",
                *(
                    model.__tablename__
                    for kind, model in TABLES.items()
                    if kind in {"company", "deletion", "deletion_job", "retention", "audit"}
                ),
            }
            if not required_tables.issubset(inspect(database.engine).get_table_names()):
                raise ValueError("unknown_database_state")
            guard = session.get(Guard, 1)
            if not guard or guard.schema_version != Guard.__table__.c.schema_version.default.arg:
                raise ValueError("unknown_database_state")
            # Even apparently harmless usage could come from a restored database with lost journal files.
            for model in (
                TABLES["company"],
                TABLES["deletion"],
                TABLES["deletion_job"],
                TABLES["retention"],
                TABLES["audit"],
                Observation,
                DeletionTombstone,
            ):
                if session.execute(select(model).limit(1)).first() is not None:
                    raise ValueError("database_not_new_and_empty")
            if not execute:
                return {"status": "planned", "database": "new_and_empty", "files_created": False}
            created = []
            with portalocker.Lock(str(target) + ".lock", timeout=10):
                if target.exists() or head.exists():
                    raise ValueError("journal_already_exists")
                try:
                    for path, content in (
                        (target, b""),
                        (head, crypto.encrypt({"count": 0, "hash": "", "bytes": 0}).encode("ascii")),
                    ):
                        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                        created.append(path)
                        with os.fdopen(descriptor, "wb") as output:
                            output.write(content)
                            output.flush()
                            os.fsync(output.fileno())
                    # The backend parser is the authority on checkpoint format; drift fails and rolls back.
                    if list(verified_entries(str(target), crypto)):
                        raise ValueError("unexpected_journal_entries")
                except Exception:
                    for path in reversed(created):
                        path.unlink()
                    raise
            return {"status": "initialized", "database": "new_and_empty", "files_created": True}
    finally:
        database.engine.dispose()


def main():
    from aift.config import Settings

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--confirm-new-deployment", action="store_true")
    args = parser.parse_args()
    try:
        result = initialize(
            Settings.from_environment(), execute=args.execute, confirmed=args.confirm_new_deployment
        )
        print(json.dumps(result))
    except Exception:
        print(json.dumps({"status": "refused", "error_code": "journal_initialization_refused"}))
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
