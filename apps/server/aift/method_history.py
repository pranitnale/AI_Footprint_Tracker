"""Immutable calculation lineage and bounded tenant-locked recalculation work."""

import re
from types import SimpleNamespace
from uuid import UUID

from footprint_contracts import payload_hash
from footprint_estimator import BASELINE_METHOD_ID
from sqlalchemy import (
    JSON,
    CheckConstraint,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    delete,
    event,
    select,
    tuple_,
)
from sqlalchemy.orm import Mapped, aliased, mapped_column

from . import engine_history, method_registry
from .db import Base, Observation, State, get, put
from .security import Problem, canonical, digest, instant, parse_time

PAGE_SIZE = 100


class HistoricalEstimate(Base):
    __tablename__ = "resource_estimates"
    tenant: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner: Mapped[str] = mapped_column(String(36), primary_key=True)
    attempt_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, primary_key=True)
    method_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    view: Mapped[str] = mapped_column(String(16), primary_key=True)
    observation_hash: Mapped[str] = mapped_column(String(64))
    original_method_hash: Mapped[str | None] = mapped_column(String(64))
    estimate: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[str] = mapped_column(String(24))
    __table_args__ = (
        ForeignKeyConstraint(["tenant", "owner"], ["memberships.tenant", "memberships.id"]),
        Index("ix_resource_estimate_record", "tenant", "owner", "attempt_id"),
        CheckConstraint("revision >= 1"),
        CheckConstraint("view IN ('original', 'recalculated')"),
        CheckConstraint("view = 'original' OR original_method_hash IS NOT NULL"),
    )


class RecalculationJob(State, Base):
    __tablename__ = "method_recalculation_jobs"
    method_id: Mapped[str] = mapped_column(String(128), index=True)
    actor: Mapped[str] = mapped_column(String(36))
    __table_args__ = (
        ForeignKeyConstraint(["tenant"], ["companies.id"]),
        ForeignKeyConstraint(["tenant", "owner"], ["memberships.tenant", "memberships.id"]),
    )


@event.listens_for(HistoricalEstimate, "before_update")
def immutable_estimate(mapper, connection, target):
    raise ValueError("immutable_estimate_history")


def register_models():
    """Import before schema creation and Alembic metadata inspection."""
    from .db import TABLES

    TABLES["recalculation"] = RecalculationJob


def resolve_estimate(session, record, method_id=None):
    if record.kind != "attempt":
        return record.estimate
    view = "recalculated" if method_id else "original"
    chosen = method_id or record.payload.get("proposed_method_id") or BASELINE_METHOD_ID
    overlay = engine_history.lookup(session, record, chosen, view)
    if overlay is not None:
        return {"status": "available", "result": overlay}
    if view == "original" and record.estimate.get("result"):
        result = record.estimate["result"]
        if result.get("schema_version") != "3.0.0":
            raise Problem("estimate_lineage_conflict", 503)
        if result.get("schema_version") == "3.0.0":
            engine_history.validate_binding(session, result, chosen, "original", None)
            parent = engine_history.request_for(session, record)
            if not parent or result["source"]["request_hash"] != parent.payload_hash:
                return {"status": "pending", "reason": "estimation_input_changed"}
            binding = engine_history.canonical_request_binding(
                session, record.tenant, record.owner, record.payload, parent.payload
            )
            if result["source"].get("canonical_request_binding") != binding:
                return {"status": "pending", "reason": "estimation_input_changed"}
        return record.estimate
    if view == "original":
        return record.estimate
    return {"status": "pending", "reason": "recalculation_pending"}


def select_records(session, records, method_id=None):
    if method_id:
        records = _with_estimates(session, records, method_id)
    for record in records:
        selected = SimpleNamespace(
            **{column.name: getattr(record, column.name) for column in Observation.__table__.columns}
        )
        if method_id and record.kind == "attempt":
            from .history_matching import linked_history
            from .timing_evidence import project_attempt

            parent = engine_history.request_for(session, record)
            history = (
                linked_history(session, record.tenant, record.owner, record.payload, parent.payload)
                if parent
                else None
            )
            if history:
                selected.payload = project_attempt(record.payload, history.payload)
        selected.estimate = resolve_estimate(session, record, method_id)
        yield selected


def _with_estimates(session, records, method_id, size=200):
    """records unchanged and in order; inside a read memo, each batch's recalculated estimates are
    read in one query before its records are resolved."""
    from .history_matching import remembering

    if not remembering(session):
        yield from records
        return

    def read(batch):
        attempts = [r for r in batch if r.kind == "attempt"]
        engine_history.prefetch_estimates(session, attempts, method_id, "recalculated")
        return batch

    batch = []
    for record in records:
        batch.append(record)
        if len(batch) == size:
            yield from read(batch)
            batch = []
    yield from read(batch)


def erase_record(session, record, budget=PAGE_SIZE):
    """Return removed history rows; caller drains these before deleting the canonical row."""
    if record.kind != "attempt":
        return 0
    removed = engine_history.erase(session, record, budget, preserve_current_original=True)
    if removed:
        return removed
    condition = [
        HistoricalEstimate.tenant == record.tenant,
        HistoricalEstimate.owner == record.owner,
        HistoricalEstimate.attempt_id == record.id,
        ~(
            (HistoricalEstimate.view == "original")
            & (HistoricalEstimate.revision == record.revision)
            & (
                HistoricalEstimate.method_id
                == (record.payload.get("proposed_method_id") or BASELINE_METHOD_ID)
            )
        ),
    ]
    keys = list(
        session.execute(
            select(HistoricalEstimate.revision, HistoricalEstimate.method_id, HistoricalEstimate.view)
            .where(*condition)
            .order_by(HistoricalEstimate.revision, HistoricalEstimate.method_id, HistoricalEstimate.view)
            .limit(budget)
        )
    )
    if keys:
        session.execute(
            delete(HistoricalEstimate).where(
                *condition,
                tuple_(
                    HistoricalEstimate.revision, HistoricalEstimate.method_id, HistoricalEstimate.view
                ).in_(keys),
            )
        )
    return len(keys)


def erase_current_original(session, record):
    """Remove the last overlay only after its rollup contribution was subtracted."""
    if record.kind == "attempt":
        overlay = session.get(
            engine_history.EngineEstimate,
            engine_history.source_key(
                session, record, record.payload.get("proposed_method_id") or BASELINE_METHOD_ID, "original"
            ),
        )
        if overlay:
            session.delete(overlay)
        session.execute(
            delete(HistoricalEstimate).where(
                HistoricalEstimate.tenant == record.tenant,
                HistoricalEstimate.owner == record.owner,
                HistoricalEstimate.attempt_id == record.id,
                HistoricalEstimate.revision == record.revision,
                HistoricalEstimate.method_id
                == (record.payload.get("proposed_method_id") or BASELINE_METHOD_ID),
                HistoricalEstimate.view == "original",
            )
        )


def invalidate_erasure(session, company):
    # Any scope may overlap a company job. Cancel all tenant jobs without retaining erased identifiers.
    session.execute(delete(RecalculationJob).where(RecalculationJob.tenant == company.id))


class MethodHistory:
    def __init__(self, analytics):
        self.analytics, self.service = analytics, analytics.service

    def eligible(self, session, company, owner=None):
        parent = aliased(Observation)
        cutoff = self.analytics.cutoff(session, company)
        query = (
            select(Observation)
            .join(
                parent,
                (
                    (parent.tenant == Observation.tenant)
                    & (parent.owner == Observation.owner)
                    & (parent.kind == "request")
                    & (parent.id == Observation.parent)
                ),
            )
            .where(
                Observation.tenant == company.id,
                Observation.kind == "attempt",
                Observation.status == "current",
                parent.status == "current",
            )
        )
        if owner:
            query = query.where(Observation.owner == owner)
        if cutoff:
            query = query.where(parent.occurred_at >= cutoff)
        return query

    def missing(self, session, company, method_id, owner=None):
        method_registry.resolve(session, method_id)
        parent = aliased(Observation)
        present = (
            select(engine_history.EngineEstimate.record_key)
            .where(
                engine_history.EngineEstimate.tenant == Observation.tenant,
                engine_history.EngineEstimate.owner == Observation.owner,
                engine_history.EngineEstimate.family == "live",
                engine_history.EngineEstimate.record_key == Observation.id,
                engine_history.EngineEstimate.observation_hash == Observation.payload_hash,
                engine_history.EngineEstimate.request_hash
                == select(parent.payload_hash)
                .where(
                    parent.tenant == Observation.tenant,
                    parent.owner == Observation.owner,
                    parent.kind == "request",
                    parent.id == Observation.parent,
                )
                .correlate(Observation)
                .scalar_subquery(),
                engine_history.EngineEstimate.method_id == method_id,
                engine_history.EngineEstimate.view == "recalculated",
            )
            .exists()
        )
        return self.eligible(session, company, owner).where(~present)

    def incomplete(self, session, company, method_id, owner=None):
        """
        Whether a current live or saved record of the owner (or organization) still lacks its
        recalculation with the method. Each check reads every such record, and a person's own
        summary with EcoLogits chosen asked it twice per request (the choice's status, then the
        view); a read memo keeps the answer for the request.
        """
        from .history_matching import remembered

        return remembered(
            session,
            ("recalculation incomplete", company.id, method_id, owner),
            lambda: session.scalar(self.missing(session, company, method_id, owner).limit(1)) is not None
            or session.scalar(
                engine_history.history_missing(self.analytics, session, company, method_id, owner).limit(1)
            )
            is not None,
        )

    def create(self, session, company, member, body, *, personal=True):
        # An administrator recalculates one person's records only while person analytics is on;
        # otherwise the whole organization only (owner decision of 18 October 2026).
        if not personal and isinstance(body, dict) and body.get("user_id") is not None:
            self.service.refuse_person_filter(body)
        if set(body) - (
            {"method_id", "operation_id"} if personal else {"method_id", "operation_id", "user_id"}
        ):
            raise Problem("invalid_payload", 422)
        try:
            if not isinstance(body["operation_id"], str):
                raise ValueError()
            operation = str(UUID(body["operation_id"]))
            method_id = body["method_id"]
            if not isinstance(method_id, str) or not re.fullmatch(r"[a-z0-9.-]{1,128}", method_id):
                raise ValueError()
            if not personal and body.get("user_id") is not None:
                if not isinstance(body["user_id"], str):
                    raise ValueError()
                UUID(body["user_id"])
        except (KeyError, ValueError, TypeError):
            raise Problem("invalid_payload", 422) from None
        owner = member.id if personal else body.get("user_id")
        method_registry.retain_packaged_definition(session, method_id, self.service.now())
        if owner and not get(session, "member", owner, company.id):
            raise Problem("not_found", 404)
        if self.analytics.deletions.in_progress(session, company):
            raise Problem("aggregate_rebuilding", 409, True)
        identifier = digest(canonical([company.id, member.id, operation]))
        existing = session.get(RecalculationJob, identifier)
        if existing:
            if existing.method_id != method_id or existing.owner != owner:
                raise Problem("idempotency_conflict", 409)
            return self.status(session, company, member, identifier, personal=personal)
        self.service.rate(session, "recalculations:" + member.id, 10, 3600)
        row = RecalculationJob(
            id=identifier,
            tenant=company.id,
            owner=owner,
            actor=member.id,
            method_id=method_id,
            data={
                "status": "pending",
                "created_at": instant(self.service.now()),
                "processed": 0,
                "completed_at": None,
                "error_code": None,
                "deletion_epoch": company.data["epoch"],
                # Marks a job an administrator started, the only kind an administrator may read
                # for one person (status).
                "admin_requested": not personal,
            },
        )
        session.add(row)
        session.flush()
        return self.status(session, company, member, identifier, personal=personal)

    def state(self, session, company, row):
        from .engine_selection import selection_is_current

        if (
            self.analytics.deletions.in_progress(session, company)
            or row.data["deletion_epoch"] != company.data["epoch"]
        ):
            return "invalidated", "deletion_changed"
        if not selection_is_current(session, row):
            return "superseded", "selection_changed"
        try:
            definition = method_registry.resolve(session, row.method_id)
            if definition.get("engine_id") == "ecologits":
                from .engine_adapter import require_native

                require_native(definition)
        except Problem as error:
            if error.code in {"method_unsupported", "engine_unavailable"}:
                return "pending", error.code
            raise
        if self.incomplete(session, company, row.method_id, row.owner):
            if row.data.get("status") == "failed":
                return "failed", row.data["error_code"]
            return "pending", "recalculation_pending"
        return "completed", None

    def status(self, session, company, member, identifier, *, personal=True):
        row = session.get(RecalculationJob, identifier)
        if (
            not row
            or row.tenant != company.id
            or (personal and (row.actor != member.id or row.owner != member.id))
            # With person analytics off administrators read organization-wide jobs only: the
            # progress of a job for one person counts that person's estimates.
            or (not personal and row.owner is not None and not self.service.settings.person_analytics_enabled)
        ):
            raise Problem("not_found", 404)
        named = not personal and row.owner is not None
        if named:
            # With person analytics on, an administrator reads a job for one person only if it was
            # started by an administrator after the switch was last seen on, so a job from the time
            # it was off, or one a member started for themselves, stays hidden. Its count covers all
            # of that person's records, including those before the switch, so it is not shown.
            since = self.service.person_analytics_since(session)
            if not row.data.get("admin_requested") or parse_time(row.data["created_at"]) < parse_time(since):
                raise Problem("not_found", 404)
        status, error = self.state(session, company, row)
        return {
            "job_id": row.id,
            "method_id": row.method_id,
            "calculation_view": "recalculated",
            "status": status,
            "processed_estimates": None if named else row.data["processed"],
            "created_at": row.data["created_at"],
            "completed_at": row.data["completed_at"] if status == "completed" else None,
            "error_code": error,
            "requires_advance": False,
            **(
                {
                    "selection_revision": row.data["selection_revision"],
                    "selection_generation": row.data["selection_generation"],
                }
                if "selection_device_id" in row.data
                else {}
            ),
        }

    def persist(self, session, record, result, view):
        engine_history.persist(session, record, result["requested_method"]["method_id"], result, view)

    def recover_original(self, session, company, record):
        current = resolve_estimate(session, record)
        if current.get("result"):
            return current["result"]
        try:
            parent = engine_history.request_for(session, record)
            result = method_registry.estimate(
                session,
                record.payload,
                request=parent.payload if parent else None,
                tenant=record.tenant,
                owner=record.owner,
            )
        except Problem as error:
            if error.code in {"method_unsupported", "engine_unavailable", "estimation_input_unavailable"}:
                return None
            raise
        before = next(select_records(session, [record]))
        before.estimate = current
        owner = get(session, "member", record.owner, company.id)
        self.analytics.contribution_delta(session, company, owner, before, -1)
        self.persist(session, record, result, "original")
        after = next(select_records(session, [record]))
        after.estimate = resolve_estimate(session, record)
        self.analytics.contribution_delta(session, company, owner, after, 1)
        return result

    def advance(self, session, company, row, budget=PAGE_SIZE):
        if not 1 <= budget <= PAGE_SIZE:
            raise ValueError("invalid_work_budget")
        from .engine_selection import selection_is_current

        if not selection_is_current(session, row):
            row.data = {**row.data, "status": "superseded", "error_code": "selection_changed"}
            return
        if (
            self.analytics.deletions.in_progress(session, company)
            or row.data["deletion_epoch"] != company.data["epoch"]
        ):
            return
        try:
            definition = method_registry.resolve(session, row.method_id)
            if definition.get("engine_id") == "ecologits":
                from .engine_adapter import require_native

                require_native(definition)
        except Problem as error:
            if error.code not in {"method_unsupported", "engine_unavailable"}:
                raise
            row.data = {**row.data, "status": "pending", "error_code": error.code}
            return
        query = self.missing(session, company, row.method_id, row.owner)
        after = tuple(row.data.get("after", ["", ""]))
        history_query = engine_history.history_missing(
            self.analytics, session, company, row.method_id, row.owner
        ).order_by(engine_history.HistoryObservation.owner, engine_history.HistoryObservation.message_key)
        # Missing live originals still consume work. Alternate priority so neither family can starve.
        history_first = row.data.get("next_family") == "history"
        history_rows = list(session.scalars(history_query.limit(budget))) if history_first else []
        live_budget = budget - len(history_rows)
        records = []
        if live_budget:
            records = list(
                session.scalars(
                    query.where(tuple_(Observation.owner, Observation.id) > after)
                    .order_by(Observation.owner, Observation.id)
                    .limit(live_budget)
                )
            )
            if not records and after != ("", ""):
                records = list(
                    session.scalars(query.order_by(Observation.owner, Observation.id).limit(live_budget))
                )
        if not history_first:
            history_rows = list(session.scalars(history_query.limit(budget - len(records))))
        processed = 0
        for record in records:
            original = self.recover_original(session, company, record)
            from .engine_adapter import MISSING_ADMISSION_METHOD_ID

            missing_original = (
                original is None and record.payload.get("proposed_method_id") == MISSING_ADMISSION_METHOD_ID
            )
            if original is None and not missing_original:
                continue
            result = method_registry.estimate(
                session,
                record.payload,
                {
                    "methodId": row.method_id,
                    "view": "recalculated",
                    **(
                        {"originalMethodMissing": True}
                        if missing_original
                        else {"originalMethodHash": original["requested_method"]["method_hash"]}
                    ),
                },
                request=engine_history.request_for(session, record).payload,
                tenant=record.tenant,
                owner=record.owner,
            )
            self.persist(session, record, result, "recalculated")
            processed += 1
        for record in history_rows:
            result = method_registry.estimate_history(
                session,
                record.payload,
                {
                    "methodId": row.method_id,
                    "view": "recalculated",
                    "originalMethodHash": record.original["proposed_method_hash"],
                },
            )
            engine_history.persist(session, record, row.method_id, result, "recalculated")
            processed += 1
        status, error = self.state(session, company, row)
        row.data = {
            **row.data,
            "status": status,
            "error_code": error,
            # A history-only tick must not rewind unfinished live work.
            "after": [records[-1].owner, records[-1].id] if records else list(after),
            "next_family": "live" if history_first else "history",
            "processed": row.data["processed"] + processed,
            "completed_at": (row.data.get("completed_at") or instant(self.service.now()))
            if status == "completed"
            else None,
        }

    def advance_tenant(self, session, company):
        from .maintenance import cursor_page

        if self.analytics.deletions.in_progress(session, company):
            return
        engine_history.recover_history(self.analytics, session, company)
        for job in cursor_page(session, "recalculation", company.id, limit=5):
            try:
                with session.begin_nested():
                    job.data = {**job.data, "status": "pending", "error_code": None}
                    self.advance(session, company, job)
            except (Problem, ValueError, ArithmeticError, RuntimeError) as error:
                job.data = {
                    **job.data,
                    "status": "failed",
                    "error_code": error.code if isinstance(error, Problem) else "calculation_failed",
                }
        key = digest(company.id + ":original-method-recovery")
        cursor = get(session, "maintenance_cursor", key, company.id)
        after = tuple(cursor.data["after"]) if cursor else ("", "")
        query = self.eligible(session, company).where(
            (Observation.estimate["status"].as_string() == "pending")
            | (Observation.estimate["result"]["schema_version"].as_string() == "3.0.0")
        )
        records = list(
            session.scalars(
                query.where(tuple_(Observation.owner, Observation.id) > after)
                .order_by(Observation.owner, Observation.id)
                .limit(PAGE_SIZE)
            )
        )
        if not records and after != ("", ""):
            records = list(
                session.scalars(query.order_by(Observation.owner, Observation.id).limit(PAGE_SIZE))
            )
        error_code = None
        for record in records:
            try:
                with session.begin_nested():
                    self.recover_original(session, company, record)
            except (Problem, ValueError, ArithmeticError, RuntimeError):
                error_code = "calculation_failed"
        put(
            session,
            "maintenance_cursor",
            key,
            {"after": [records[-1].owner, records[-1].id] if records else ["", ""], "error_code": error_code},
            company.id,
        )

    def prepare_view(self, session, company, member, query, personal=False, private=False):
        view, method_id = query.get("calculation_view", "original"), query.get("method_id")
        if view not in {"original", "recalculated"} or (view == "original" and "method_id" in query):
            raise Problem("unsupported_filter", 422)
        if view == "original":
            return {"calculation_view": "original"}
        if not method_id:
            raise Problem("method_required", 422)
        method_registry.resolve(session, method_id)
        owner = member.id if personal else query.get("user_id")
        jobs = select(RecalculationJob).where(
            RecalculationJob.tenant == company.id, RecalculationJob.method_id == method_id
        )
        jobs = (
            jobs.where((RecalculationJob.owner.is_(None)) | (RecalculationJob.owner == owner))
            if owner
            else jobs.where(RecalculationJob.owner.is_(None))
        )
        # One completed matching job is enough; missing current revisions are checked independently.
        jobs = (
            jobs.where(
                RecalculationJob.data["status"].as_string() == "completed",
                RecalculationJob.data["deletion_epoch"].as_integer() == company.data["epoch"],
            )
            .order_by(RecalculationJob.id)
            .limit(1)
        )
        job = session.scalar(jobs)
        # Readiness belongs to the requested owner population, not an unrelated larger job's missing rows.
        if not job or self.incomplete(session, company, method_id, owner):
            raise Problem("recalculation_pending", 409, True)
        return {
            "calculation_view": "recalculated",
            "method_id": method_id,
            "method_hash": payload_hash(method_registry.resolve(session, method_id)),
            "recalculation_job_id": job.id,
            "recalculated_at": job.data["completed_at"],
        }


register_models()
