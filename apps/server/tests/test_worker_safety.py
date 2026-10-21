"""
Speed work of 15 October 2026: the API runs several worker processes, GET /v1/config no longer
waits for the organization's lock, and each process holds a bounded database pool.
"""

import json
import os
import re
import subprocess
import sys
import textwrap
from contextlib import contextmanager
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest
from conftest import confirmed, connect, login
from fastapi.testclient import TestClient

from aift import db, request_log
from aift.db import Database, WriteNeeded, get, put
from aift.security import instant

SERVER = Path(__file__).resolve().parents[1]
ROOT = SERVER.parents[1]
EXTENSION = "chrome-extension://test-extension"


@contextmanager
def recorded(database):
    """Records each transaction a request opens: True for a read, False for one that takes a lock."""
    calls = []
    transaction, read_attempt = database.transaction, database.read_attempt

    @contextmanager
    def tracked(scope="registration", readonly=False):
        calls.append(("transaction", readonly))
        with transaction(scope=scope, readonly=readonly) as session:
            yield session

    @contextmanager
    def tracked_attempt():
        calls.append(("read_attempt", True))
        with read_attempt() as session:
            yield session

    database.transaction, database.read_attempt = tracked, tracked_attempt
    try:
        yield calls
    finally:
        del database.transaction, database.read_attempt


def installation(app, client):
    credentials, _ = connect(app, client)
    extension = TestClient(app, base_url=str(client.base_url).rstrip("/"))
    extension.headers["Origin"] = EXTENSION
    return extension, {"Authorization": "Bearer " + credentials["access_token"]}


def test_config_reads_take_no_lock_once_the_policy_is_saved(setup):
    app, client, company, *_ = setup
    login(app, client)
    extension, auth = installation(app, client)
    first = extension.get("/v1/config", headers=auth)
    assert first.status_code == 200, first.text
    for path, headers, use in (
        ("/v1/config", auth, extension),
        ("/v1/public/config", auth, extension),
        ("/v1/config", {}, client),
    ):
        with recorded(app.state.db) as calls:
            response = use.get(path, headers=headers)
        assert response.status_code == 200, response.text
        # The administrator's session is touched after the answer, under its own small lock.
        locked = [call for call in calls if call == ("transaction", False)]
        assert locked == ([("transaction", False)] if use is client else []), (path, calls)
        assert ("read_attempt", True) in calls
    assert extension.get("/v1/config", headers=auth).json() == first.json()


def test_a_changed_policy_is_saved_under_the_lock_and_offered_to_the_installation(setup):
    app, client, company, _, now, _ = setup
    login(app, client)
    extension, auth = installation(app, client)
    assert extension.get("/v1/config", headers=auth).json()["policy"]["policy_version"] == "1.0.0"
    now[0] += timedelta(seconds=10)
    changed = client.put(
        "/v1/admin/policy",
        json=confirmed(
            client,
            {
                "expected_version": "1.0.0",
                "timezone": "Europe/Berlin",
                "pause_mode": "disabled_by_company",
                "company_sharing": "threshold",
            },
        ),
    )
    assert changed.status_code == 200, changed.text
    now[0] += timedelta(seconds=10)
    offered_at = now[0]
    with recorded(app.state.db) as calls:
        config = extension.get("/v1/config", headers=auth).json()
    assert config["policy"]["policy_version"] == "1.0.1"
    # The read attempt found the installation had not been offered 1.0.1 yet and ran again locked.
    assert calls[-2:] == [("read_attempt", True), ("transaction", False)], calls
    with app.state.db.transaction(readonly=True) as session:
        device = next(row for row in db.rows(session, "device", company.id) if row.data["status"] == "active")
        assert device.data["offered_policy"] == "1.0.1"
    # Once offered, the next read is lock-free again, and the receipt starts when it was offered.
    now[0] += timedelta(seconds=10)
    with recorded(app.state.db) as calls:
        assert extension.get("/v1/config", headers=auth).json()["policy"]["policy_version"] == "1.0.1"
    assert ("transaction", False) not in calls
    receipt = extension.post("/v1/config/acknowledge", json={"policy_version": "1.0.1"}, headers=auth).json()
    assert receipt["effective_from"] == instant(offered_at)


def test_a_read_attempt_refuses_writes_and_keeps_nothing(setup):
    app, _, company, *_ = setup
    database = app.state.db
    with pytest.raises(WriteNeeded):
        with database.read_attempt() as session:
            put(session, "maintenance_cursor", "read-attempt-probe", {"x": 1})
    with pytest.raises(WriteNeeded):
        with database.read_attempt() as session:
            # Not flushed by any query: the attempt still refuses it at the end.
            get(session, "company", company.id).data = {**company.data, "name": "Changed"}
    with database.read_attempt() as session:
        row = get(session, "company", company.id)
        row.data = dict(row.data)  # the same value again is not a write
    with database.transaction(readonly=True) as session:
        assert get(session, "maintenance_cursor", "read-attempt-probe") is None
        assert get(session, "company", company.id).data["name"] == "Example"


def test_each_process_pool_keeps_every_process_under_the_postgresql_limit(setup):
    settings = replace(setup[-1], database_url="postgresql+psycopg://aift:unused@127.0.0.1:1/aift")
    engine = Database(settings).engine
    assert (engine.pool.size(), engine.pool._max_overflow) == (db.POOL_SIZE, db.POOL_OVERFLOW)
    assert engine.pool._pre_ping is True
    dockerfile = (SERVER / "Dockerfile").read_text()
    workers = int(re.search(r"^ENV WEB_CONCURRENCY=(\d+)$", dockerfile, re.M).group(1))
    command = next(line for line in dockerfile.splitlines() if line.startswith("CMD "))
    # uvicorn reads WEB_CONCURRENCY only when the command names no --workers.
    assert workers > 1 and "--workers" not in command
    # The API processes plus the maintenance worker, against PostgreSQL's default of 100, leaving
    # room for migrations, backups and an administrator's psql session.
    assert (workers + 1) * (db.POOL_SIZE + db.POOL_OVERFLOW) <= 70
    assert "max_connections" not in (ROOT / "compose.yaml").read_text()


WRITER = textwrap.dedent(
    """
    import logging, sys
    from aift import request_log
    request_log.configure(sys.argv[1])
    for n in range(int(sys.argv[3])):
        request_log.write({"id": sys.argv[2] + "-" + str(n), "path": "/v1/x", "status": 200, "pad": "x" * 600})
    """
)


def test_several_processes_share_the_request_log_without_losing_or_mixing_lines(tmp_path):
    path = tmp_path / "requests.log"
    count = 3000
    env = {**os.environ, "PYTHONPATH": os.pathsep.join([str(SERVER), os.environ.get("PYTHONPATH", "")])}
    writers = [
        subprocess.Popen([sys.executable, "-c", WRITER, str(path), name, str(count)], env=env, cwd=SERVER)
        for name in ("a", "b", "c", "d")
    ]
    assert all(writer.wait(timeout=120) == 0 for writer in writers)
    files = sorted(tmp_path.iterdir())
    # One file per UTC day (two if the test ran across midnight), never the undated name.
    assert files and all(re.fullmatch(r"requests\.log\.\d{4}-\d{2}-\d{2}", f.name) for f in files)
    lines = [line for f in files for line in f.read_text().splitlines()]
    ids = [json.loads(line)["id"] for line in lines]
    assert sorted(ids) == sorted(f"{name}-{n}" for name in "abcd" for n in range(count))


def test_log_files_are_one_per_utc_day_and_kept_14_days(tmp_path):
    path = str(tmp_path / "requests.log")
    today = date(2026, 10, 15)
    for days in (12, 13, 14, 40):
        (tmp_path / f"requests.log.{(today - timedelta(days=days)).isoformat()}").write_text("old\n")
    (tmp_path / "requests.log.not-a-date").write_text("kept\n")
    (tmp_path / "other.log.2020-01-01").write_text("not ours\n")
    # The undated file the rotating handler of 13 Oct 2026 wrote: deleted once it is 14 days old.
    legacy = tmp_path / "requests.log"
    legacy.write_text("legacy\n")
    stale = datetime(2026, 9, 30, 12, tzinfo=UTC).timestamp()
    os.utime(legacy, (stale, stale))
    clock = [datetime(2026, 10, 15, 23, 59, 59, tzinfo=UTC)]
    handler = request_log.DailyFiles(path, clock=lambda: clock[0])
    handler.setFormatter(request_log.logging.Formatter("%(message)s"))
    request_log.LOGGER.addHandler(handler)
    def names():
        return sorted(f.name for f in tmp_path.iterdir())

    try:
        request_log.write({"id": "first", "path": "/v1/x", "status": 200})
        # On 15 October the day 13 days back (2 October) is kept, everything older is deleted, so
        # no line is older than the 14 days the privacy policy states.
        assert names() == [
            "other.log.2020-01-01",
            "requests.log.2026-10-02",
            "requests.log.2026-10-03",
            "requests.log.2026-10-15",
            "requests.log.not-a-date",
        ]
        clock[0] += timedelta(seconds=2)
        request_log.write({"id": "second", "path": "/v1/x", "status": 200})
    finally:
        request_log.LOGGER.removeHandler(handler)
        handler.close()
    # Past midnight UTC the line goes to a new file, and 2 October is now 14 days back.
    assert names() == [
        "other.log.2020-01-01",
        "requests.log.2026-10-03",
        "requests.log.2026-10-15",
        "requests.log.2026-10-16",
        "requests.log.not-a-date",
    ]
    assert json.loads((tmp_path / "requests.log.2026-10-15").read_text())["id"] == "first"
    assert json.loads((tmp_path / "requests.log.2026-10-16").read_text())["id"] == "second"
