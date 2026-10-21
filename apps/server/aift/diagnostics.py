"""Bounded operational diagnostics. Never inspect exception messages or request values."""

import logging

from sqlalchemy import delete, func, select
from sqlalchemy.exc import SQLAlchemyError

from .db import TABLES, get, put
from .security import canonical, digest, instant

MAX_DIAGNOSTICS = 1000


def route_category(path):
    for prefix, category in (
        ("/v1/operator/", "operator"),
        ("/v1/admin/", "administration"),
        ("/v1/auth/", "authentication"),
        ("/v1/connections", "enrollment"),
        ("/v1/usage/", "ingestion"),
        ("/v1/deletions/", "erasure"),
        ("/v1/me/", "personal_summary"),
        ("/v1/company/", "company_summary"),
        ("/health/", "readiness"),
    ):
        if path.startswith(prefix):
            return category
    return "other"


def exception_category(exception):
    for kind, label in (
        (SQLAlchemyError, "DatabaseError"),
        (KeyError, "KeyError"),
        (TypeError, "TypeError"),
        (ValueError, "ValueError"),
        (RuntimeError, "RuntimeError"),
        (AssertionError, "AssertionError"),
        (OSError, "IOError"),
    ):
        if isinstance(exception, kind):
            return label
    return "UnexpectedError"


def record(service, correlation_id, path, exception):
    payload = {
        "correlation_id": correlation_id,
        "category": route_category(path),
        "exception_class": exception_category(exception),
        "at": instant(service.now()),
    }
    try:
        with service.db.transaction(scope="safe-diagnostics") as session:
            put(session, "diagnostic", correlation_id, payload)
            key = digest(canonical([payload["at"][:10], payload["category"], payload["exception_class"]]))
            previous = get(session, "diagnostic_counter", key)
            put(
                session,
                "diagnostic_counter",
                key,
                {
                    "date": payload["at"][:10],
                    "category": payload["category"],
                    "exception_class": payload["exception_class"],
                    "count": min((previous.data["count"] if previous else 0) + 1, 9223372036854775807),
                    "last_correlation_id": correlation_id,
                },
            )
            cls = TABLES["diagnostic"]
            total = session.scalar(select(func.count()).select_from(cls))
            if total > MAX_DIAGNOSTICS:
                ids = list(
                    session.scalars(
                        select(cls.id)
                        .order_by(cls.data["at"].as_string(), cls.id)
                        .limit(total - MAX_DIAGNOSTICS)
                    )
                )
                session.execute(delete(cls).where(cls.id.in_(ids)))
            counters = TABLES["diagnostic_counter"]
            total_counters = session.scalar(select(func.count()).select_from(counters))
            if total_counters > MAX_DIAGNOSTICS:
                ids = list(
                    session.scalars(
                        select(counters.id)
                        .order_by(counters.data["date"].as_string(), counters.id)
                        .limit(total_counters - MAX_DIAGNOSTICS)
                    )
                )
                session.execute(delete(counters).where(counters.id.in_(ids)))
    except Exception:
        # The same allowlisted event remains actionable when the database is the failed component.
        logging.getLogger("aift.safe_diagnostics").error(canonical(payload))
