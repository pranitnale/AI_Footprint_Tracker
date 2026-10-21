import importlib.util
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from pathlib import Path
from threading import Barrier

import pytest
from cryptography.fernet import Fernet

from aift.config import Settings
from aift.db import Database, put
from aift.journal import verified_entries
from aift.security import Secrets, token

SPEC = importlib.util.spec_from_file_location(
    "journal_bootstrap", Path(__file__).with_name("initialize-journal.py")
)
BOOTSTRAP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BOOTSTRAP)


@pytest.fixture
def settings(tmp_path):
    configured = Settings(
        database_url="sqlite:///" + (tmp_path / "empty.db").as_posix(),
        environment="test",
        encryption_key=Fernet.generate_key().decode(),
        lookup_key=token(),
        deletion_journal_path=str(tmp_path / "journal.log"),
    )
    Database(configured, initialize=True).engine.dispose()
    return configured


def test_plan_execute_retry_and_backend_restore_parser(settings):
    assert BOOTSTRAP.initialize(settings)["files_created"] is False
    target = Path(settings.deletion_journal_path)
    assert not target.exists()
    assert BOOTSTRAP.initialize(settings, execute=True, confirmed=True)["status"] == "initialized"
    assert list(verified_entries(str(target), Secrets(settings))) == []
    checkpoint = Path(str(target) + ".head").read_bytes()
    with pytest.raises(ValueError, match="journal_already_exists"):
        BOOTSTRAP.initialize(settings, execute=True, confirmed=True)
    assert Path(str(target) + ".head").read_bytes() == checkpoint


def test_nonempty_database_and_missing_confirmation_refused(settings):
    with pytest.raises(ValueError, match="confirmation_required"):
        BOOTSTRAP.initialize(settings, execute=True)
    database = Database(settings)
    with database.transaction() as session:
        put(session, "retention", "previous-expiry", {"cutoff": "2026-01-01"}, "prior-tenant")
    with pytest.raises(ValueError, match="not_new_and_empty"):
        BOOTSTRAP.initialize(settings, execute=True, confirmed=True)
    assert not Path(settings.deletion_journal_path).exists()
    database.engine.dispose()


def test_two_initializers_do_not_overwrite_or_leave_invalid_checkpoint(settings):
    barrier = Barrier(2)

    def attempt():
        barrier.wait()
        try:
            return BOOTSTRAP.initialize(settings, execute=True, confirmed=True)["status"]
        except ValueError:
            return "refused"

    with ThreadPoolExecutor(2) as pool:
        assert sorted(pool.map(lambda _: attempt(), range(2))) == ["initialized", "refused"]
    assert list(verified_entries(settings.deletion_journal_path, Secrets(settings))) == []


def test_failed_validation_removes_only_newly_created_files(settings, monkeypatch):
    from aift import journal

    def fail(*args):
        raise ValueError("synthetic format mismatch")

    monkeypatch.setattr(journal, "verified_entries", fail)
    with pytest.raises(ValueError, match="format mismatch"):
        BOOTSTRAP.initialize(settings, execute=True, confirmed=True)
    assert not Path(settings.deletion_journal_path).exists()
    assert not Path(settings.deletion_journal_path + ".head").exists()


def test_invalid_key_configuration_cannot_plan_or_create_a_checkpoint(settings):
    invalid = replace(settings, encryption_key="invalid-key-fixture")
    with pytest.raises(ValueError):
        BOOTSTRAP.initialize(invalid)
    assert not Path(settings.deletion_journal_path).exists()
    assert not Path(settings.deletion_journal_path + ".head").exists()
