"""Offline restore release gate. Replays durable erasure before examining restored totals."""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path[:0] = [
    str(ROOT / "apps/server"),
    str(ROOT / "packages/contracts/python"),
    str(ROOT / "packages/estimator/python"),
]


# Company keys checked per query page, as the other scans stream 100 rows at a time.
COMPANY_KEY_PAGE = 100


class RestoreVerificationError(RuntimeError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def verify_restored(service, max_worker_ticks=10000):
    """Shared offline gate: production CLI requires PostgreSQL; portable tests exercise the same gate."""
    from zoneinfo import ZoneInfo

    from footprint_contracts import validate_observation
    from sqlalchemy import exists, select

    from aift.db import SCHEMA_VERSION, TABLES, Guard, HistoryObservation, Observation, get
    from aift.maintenance import maintain_tenant, replay_journal
    from aift.security import canonical, digest, parse_time

    if type(max_worker_ticks) is not int or not 1 <= max_worker_ticks <= 1000000:
        raise RestoreVerificationError("restore_invalid_work_budget")
    database = service.db
    with database.transaction(readonly=True) as session:
        guard = session.get(Guard, 1)
        if not guard or guard.schema_version != SCHEMA_VERSION:
            raise RestoreVerificationError("restore_schema_not_current")
    replay_journal(service)
    ticks = checked = covered = 0
    after = ""
    company_cls, job_cls = TABLES["company"], TABLES["deletion_job"]
    while True:
        with database.transaction(readonly=True) as session:
            companies = list(
                session.execute(
                    select(company_cls.id, company_cls.origin)
                    .where(company_cls.id > after)
                    .order_by(company_cls.id)
                    .limit(100)
                )
            )
        if not companies:
            break
        for identifier, origin in companies:
            while True:
                if ticks >= max_worker_ticks:
                    raise RestoreVerificationError("restore_work_incomplete")
                with database.transaction(scope=origin) as session:
                    company = get(session, "company", identifier)
                    maintain_tenant(service, session, company)
                    ticks += 1
                    unfinished = session.scalar(
                        select(job_cls.id)
                        .where(
                            job_cls.tenant == identifier, job_cls.data["status"].as_string() != "completed"
                        )
                        .limit(1)
                    )
                    incomplete = (
                        company.data.get("aggregate_status") == "rebuilding" or unfinished is not None
                    )
                if not incomplete:
                    break
            with database.transaction(readonly=True) as session:
                company = get(session, "company", identifier)
                if company.data.get("aggregate_status", "current") != "current":
                    raise RestoreVerificationError("restore_aggregate_incomplete")
                for row in session.scalars(
                    select(HistoryObservation)
                    .where(HistoryObservation.tenant == identifier)
                    .execution_options(yield_per=100)
                ):
                    try:
                        service.analytics.history.verify_record(session, company, row)
                    except Exception:
                        raise RestoreVerificationError("restore_history_inconsistent") from None
                for observation in session.scalars(
                    select(Observation).where(Observation.tenant == identifier)
                ):
                    try:
                        validate_observation(observation.payload)
                    except Exception:
                        raise RestoreVerificationError("restore_observation_not_current") from None
                from aift.engine_history import EngineEstimate, request_for
                from aift.method_history import resolve_estimate
                from aift.method_registry import estimate as recompute_live

                for record in session.scalars(
                    select(Observation)
                    .where(Observation.tenant == identifier, Observation.kind == "attempt")
                    .execution_options(yield_per=100)
                ):
                    selected = resolve_estimate(session, record).get("result")
                    if selected and selected.get("schema_version") == "3.0.0":
                        parent = request_for(session, record)
                        recomputed = recompute_live(
                            session,
                            record.payload,
                            {"methodId": selected["requested_method"]["method_id"]},
                            request=parent.payload if parent else None,
                            tenant=record.tenant,
                            owner=record.owner,
                        )
                        if canonical(recomputed) != canonical(selected):
                            raise RestoreVerificationError("restore_engine_estimate_inconsistent")
                for overlay in session.scalars(
                    select(EngineEstimate)
                    .where(EngineEstimate.tenant == identifier)
                    .execution_options(yield_per=100)
                ):
                    source = (
                        session.get(HistoryObservation, (overlay.tenant, overlay.owner, overlay.record_key))
                        if overlay.family == "history"
                        else session.get(
                            Observation, (overlay.tenant, overlay.owner, "attempt", overlay.record_key)
                        )
                    )
                    if source is None:
                        raise RestoreVerificationError("restore_engine_source_missing")
                    from aift.engine_history import verify_overlay

                    try:
                        verify_overlay(session, overlay)
                    except Exception:
                        raise RestoreVerificationError("restore_engine_estimate_inconsistent") from None
                    if (
                        isinstance(overlay.estimate, dict)
                        and overlay.estimate.get("schema_version") == "3.0.0"
                    ):
                        from aift.engine_history import validate_binding

                        validate_binding(
                            session,
                            overlay.estimate,
                            overlay.method_id,
                            overlay.view,
                            overlay.original_method_hash,
                        )
                # Which copy of a shared prompt or reply counts is derived state too: each key
                # must count once, as the election rules choose, or totals count it twice or
                # never (W11). Keys are read a page at a time so memory stays bounded: the keys
                # of live records, then the keys that only saved rows carry.
                live_keys = select(Observation.company_key).where(
                    Observation.tenant == identifier, Observation.company_key.is_not(None)
                )
                saved_only_keys = select(HistoryObservation.company_key).where(
                    HistoryObservation.tenant == identifier,
                    HistoryObservation.company_key.is_not(None),
                    ~exists(
                        select(1).where(
                            Observation.tenant == identifier,
                            Observation.company_key == HistoryObservation.company_key,
                        )
                    ),
                )
                for keys in (live_keys, saved_only_keys):
                    column, last = keys.selected_columns[0], None
                    while True:
                        page = keys.distinct().order_by(column).limit(COMPANY_KEY_PAGE)
                        batch = list(session.scalars(page if last is None else page.where(column > last)))
                        if not batch:
                            break
                        elections = service.analytics.company.expected_many(session, company, batch)
                        for live, saved, expected in elections.values():
                            if any(
                                record.company_shared != expected[id(record)] for record in [*live, *saved]
                            ):
                                raise RestoreVerificationError("restore_company_count_inconsistent")
                        last = batch[-1]
                # Inspect required canonical dimensions too: iterating only existing rows would
                # vacuously approve a restore with every rollup missing.
                previous = None
                group_keys = set()
                # A shared record adds nothing to its owner's rollups (W11), so it needs none.
                query = (
                    select(Observation.owner, Observation.occurred_at, Observation.site, Observation.model)
                    .where(Observation.tenant == identifier, Observation.company_shared.is_(False))
                    .order_by(Observation.owner, Observation.occurred_at)
                    .execution_options(yield_per=100)
                )
                for owner_id, occurred_at, site, model in session.execute(query):
                    day = (
                        parse_time(occurred_at)
                        .astimezone(ZoneInfo(company.data["timezone"]))
                        .date()
                        .isoformat()
                    )
                    group = (owner_id, day)
                    if group != previous:
                        group_keys.clear()
                        previous = group
                    key = digest(canonical([identifier, owner_id, day, site, model]))
                    if key not in group_keys:
                        required = get(session, "rollup", key, identifier)
                        if required is None:
                            raise RestoreVerificationError("restore_aggregate_missing")
                        group_keys.add(key)
                    covered += 1
                for rollup in session.scalars(
                    select(TABLES["rollup"])
                    .where(TABLES["rollup"].tenant == identifier)
                    .execution_options(yield_per=100)
                ):
                    owner = get(session, "member", rollup.owner, identifier)
                    expected = service.analytics.day_value(
                        session, company, owner, rollup.day, rollup.site, rollup.model
                    )
                    if (
                        rollup.status != "current"
                        or rollup.data.get("status") != "current"
                        or rollup.data.get("timezone") != company.data["timezone"]
                        or digest(canonical(expected)) != rollup.data["checksum"]
                        or digest(canonical(rollup.data["value"])) != rollup.data["checksum"]
                    ):
                        raise RestoreVerificationError("restore_aggregate_mismatch")
                    checked += 1
        after = companies[-1].id
    from aift.thread_relations import invalid_restored_relation

    with database.transaction(readonly=True) as session:
        if invalid_restored_relation(session):
            raise RestoreVerificationError("restore_thread_relation_invalid")
    return {
        "status": "passed",
        "journal_replayed": True,
        "worker_ticks": ticks,
        "canonical_records_covered": covered,
        "rollups_checked": checked,
        "limitations": ["Does not measure load throughput or browser offline-device erasure."],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--confirm-offline-restore", action="store_true")
    parser.add_argument("--max-worker-ticks", type=int, default=10000)
    args = parser.parse_args()
    if not args.execute:
        print(
            json.dumps(
                {
                    "status": "unverified",
                    "execution": "not_started",
                    "requirements": [
                        "Restore the database into a separate approved PostgreSQL target, with ingress and workers stopped.",
                        "Restore original encryption keys, approved method trust configuration, deletion journal and authenticated .head checkpoint.",
                        "Set AIFT_SETTINGS_FILE for that offline target, run Alembic upgrade head, then execute this gate.",
                        "Do not expose the target until this gate succeeds; run PostgreSQL restore lifecycle tests separately.",
                    ],
                }
            )
        )
        return
    if not args.confirm_offline_restore:
        parser.error("--confirm-offline-restore is required")
    from aift.analytics import Analytics
    from aift.config import Settings
    from aift.db import Database
    from aift.mail import BrevoMail
    from aift.service import Service

    settings = Settings.from_environment()
    if not settings.database_url.startswith("postgresql"):
        parser.error("An explicitly approved PostgreSQL restore target is required")
    database = Database(settings)
    try:
        service = Service(settings, database, BrevoMail(settings))
        service.analytics = Analytics(service)
        result = verify_restored(service, args.max_worker_ticks)
    finally:
        database.engine.dispose()
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(
            json.dumps(
                {
                    "status": "failed",
                    "reason": error.code
                    if isinstance(error, RestoreVerificationError)
                    else "restore_verification_failed",
                }
            )
        )
        sys.exit(1)
