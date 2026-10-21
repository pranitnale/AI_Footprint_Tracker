"""One line per API request, so an error a person reports can be traced by its reference.

Owner decision, 13 Oct 2026: the log holds what is needed to find and fix an error and nothing that
names a person. No IP address, no query string, no headers, no request or response bodies and
no exception messages, which can quote submitted values. Paths can hold pseudonymous ids (a member,
browser, record or conversation key); the privacy policy says so. A server error adds the exception class and
the code locations it passed through. The privacy policy states the 14 days the files are kept.
"""

import json
import logging
import os
import re
import traceback
from contextvars import ContextVar
from datetime import UTC, datetime, timedelta

LOGGER = logging.getLogger("aift.requests")
RETENTION_DAYS = 14
# The middleware puts a fresh dict here for each request. Handlers run in a copied context, so they
# fill in the same dict (the error code) instead of setting the variable.
CURRENT = ContextVar("aift_request", default=None)
QUIET_PATHS = {"/health/live", "/health/ready"}
DATED = re.compile(r"\.(\d{4}-\d{2}-\d{2})$")


class DailyFiles(logging.Handler):
    """
    Appends each line to "<path>.<UTC date>" and deletes the files of days older than the
    retention period: the current day plus RETENTION_DAYS - 1 earlier days are kept, so no line is
    older than the 14 days the privacy policy states. The rotating handler before 15 October 2026
    kept one day more.

    Several API worker processes write the same files. A rotating handler renames the current
    file at midnight, and with several processes each one renames it again or keeps writing to the
    renamed file, so lines are lost or kept too long. Here nothing is renamed: the date is part of
    the name, every line is one write() to a file opened with O_APPEND, which Linux appends whole,
    and any process may delete an expired day. The dated names are the ones the earlier rotating
    handler gave its old files, so `cat requests.log*` still finds every line in order.
    """

    def __init__(self, path, retention_days=RETENTION_DAYS, clock=None):
        super().__init__()
        self.path, self.retention_days = path, retention_days
        self.clock = clock or (lambda: datetime.now(UTC))
        self.day, self.descriptor = None, None

    def emit(self, record):
        try:
            line = (self.format(record) + "\n").encode("utf-8")
            day = self.clock().astimezone(UTC).date()
            if day != self.day:
                self.open_day(day)
            os.write(self.descriptor, line)
        except Exception:
            self.handleError(record)

    def open_day(self, day):
        if self.descriptor is not None:
            os.close(self.descriptor)
            self.descriptor = None
        self.descriptor = os.open(
            f"{self.path}.{day.isoformat()}", os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600
        )
        self.day = day
        self.expire(day)

    def expire(self, today):
        """Deletes the days before the retention period, whichever process wrote them."""
        oldest = today - timedelta(days=self.retention_days - 1)
        directory, base = os.path.split(os.path.abspath(self.path))
        for name in os.listdir(directory):
            full = os.path.join(directory, name)
            try:
                if name == base:
                    # The undated file the rotating handler wrote before 15 October 2026.
                    expired = datetime.fromtimestamp(os.path.getmtime(full), UTC).date() < oldest
                elif name.startswith(base + ".") and (match := DATED.search(name)):
                    expired = datetime.strptime(match.group(1), "%Y-%m-%d").date() < oldest
                else:
                    continue
                if expired:
                    os.unlink(full)
            except (FileNotFoundError, ValueError):
                # Another process deleted it first, or the suffix is not a date this code wrote.
                continue

    def close(self):
        with self.lock:
            if self.descriptor is not None:
                os.close(self.descriptor)
                self.descriptor = None
        super().close()


def configure(path=None):
    """Writes to the files named by AIFT_REQUEST_LOG, one per UTC day, kept 14 days."""
    path = path or os.environ.get("AIFT_REQUEST_LOG")
    LOGGER.propagate = False
    LOGGER.setLevel(logging.INFO)
    if not path or any(getattr(h, "aift_path", None) == path for h in LOGGER.handlers):
        return
    handler = DailyFiles(path)
    handler.aift_path = path
    handler.setFormatter(logging.Formatter("%(message)s"))
    LOGGER.addHandler(handler)


def origin_kind(origin, exact_origin):
    if not origin:
        return "none"
    if origin == exact_origin:
        return "same_site"
    if origin.startswith(("chrome-extension://", "moz-extension://", "extension://")):
        return "extension"
    return "other"


def frames(exception, limit=20):
    """Where the exception passed through: module path, line and function, innermost last."""
    result = []
    for frame in traceback.extract_tb(exception.__traceback__)[-limit:]:
        name = frame.filename.replace("\\", "/")
        for marker in ("/aift/", "/site-packages/"):
            if marker in name:
                name = name[name.index(marker) + 1 :]
                break
        else:
            name = name.rsplit("/", 1)[-1]
        result.append(f"{name}:{frame.lineno} {frame.name}")
    return result


def failure(exception):
    details = {"exception": type(exception).__name__, "frames": frames(exception)}
    cause = exception.__cause__ or exception.__context__
    if cause is not None:
        details["cause"] = {"exception": type(cause).__name__, "frames": frames(cause, 8)}
    # A missing or unreadable file names a path inside the image, never a submitted value.
    if isinstance(exception, OSError) and exception.filename and str(exception.filename).startswith("/opt/aift/"):
        details["file"] = str(exception.filename)
    return details


def write(entry):
    if entry.get("path") in QUIET_PATHS and entry.get("status", 500) < 400:
        return
    LOGGER.info(json.dumps(entry, separators=(",", ":"), ensure_ascii=True, sort_keys=True))
