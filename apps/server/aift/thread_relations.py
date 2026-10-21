"""Observed thread membership of retained canonical requests, without history ingestion."""

from typing import Annotated, Literal

from pydantic import Field, StringConstraints, field_validator
from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.orm import aliased

from .db import DeletionScope, DeletionTombstone, Observation, RequestAttemptLink, ThreadRelation
from .dto import DTO
from .method_history import select_records
from .security import Problem, canonical

OpaqueKey = Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$", min_length=64, max_length=64)]


class RelationBatch(DTO):
    site: Literal["perplexity"]
    key_version: Literal["1"]
    thread_key: OpaqueKey
    provider_request_keys: list[OpaqueKey] = Field(min_length=1, max_length=100)
    deletion_epoch: int = Field(ge=0, le=9007199254740991)
    source: Literal["perplexity-thread-response-v1"]

    @field_validator("provider_request_keys")
    @classmethod
    def unique_keys(cls, values):
        if len(set(values)) != len(values):
            raise ValueError("Duplicate request keys are not permitted")
        return values


def retained_request(row, company, owner, cutoff):
    """Apply request-family retention and durable erasure markers before resolving membership."""
    conditions = [
        row.tenant == company.id,
        row.owner == owner,
        row.kind == "request",
        row.site == "perplexity",
        ~exists(
            select(1).where(
                DeletionTombstone.tenant == row.tenant,
                DeletionTombstone.owner == row.owner,
                DeletionTombstone.kind == "request",
                DeletionTombstone.record_id == row.id,
            )
        ),
        ~exists(
            select(1).where(
                DeletionScope.tenant == row.tenant,
                or_(DeletionScope.deletion_user_id.is_(None), DeletionScope.deletion_user_id == row.owner),
                or_(
                    DeletionScope.scope == "user",
                    and_(
                        DeletionScope.range_start <= row.occurred_at,
                        DeletionScope.range_end > row.occurred_at,
                    ),
                ),
            )
        ),
    ]
    if cutoff:
        conditions.append(row.occurred_at >= cutoff)
    return and_(*conditions)


class ThreadRelations:
    def __init__(self, analytics):
        self.analytics = analytics

    def ready(self, session, company, device):
        if not device:
            raise Problem("installation_required", 403)
        if self.analytics.deletions.in_progress(session, company):
            raise Problem("deletion_in_progress", 409, retryable=True)
        if company.data.get("aggregate_status", "current") != "current":
            raise Problem("aggregate_rebuilding", 409, retryable=True)

    def link(self, session, company, member, device, body, query):
        if query:
            raise Problem("unsupported_filter", 422)
        data = RelationBatch.model_validate_json(canonical(body))
        self.ready(session, company, device)
        epoch = company.data["epoch"]
        if data.deletion_epoch != epoch:
            raise Problem("deletion_epoch_changed", 409, retryable=True)
        cutoff = self.analytics.cutoff(session, company)
        known = set(
            session.scalars(
                select(Observation.stable_key).where(
                    retained_request(Observation, company, member.id, cutoff),
                    Observation.stable_key.in_(data.provider_request_keys),
                )
            )
        )
        existing = {
            row.provider_request_key: row
            for row in session.scalars(
                select(ThreadRelation).where(
                    ThreadRelation.tenant == company.id,
                    ThreadRelation.owner == member.id,
                    ThreadRelation.provider_request_key.in_(data.provider_request_keys),
                )
            )
        }
        # Preflight every conflict before mutating anything. The tenant mutation lock also serializes erasure.
        if any(row.thread_key != data.thread_key for key, row in existing.items() if key in known):
            raise Problem("thread_relation_conflict", 409)
        for key in known - existing.keys():
            session.add(
                ThreadRelation(
                    tenant=company.id,
                    owner=member.id,
                    provider_request_key=key,
                    thread_key=data.thread_key,
                )
            )
        session.flush()
        return {
            "site": data.site,
            "key_version": data.key_version,
            "thread_key": data.thread_key,
            "deletion_epoch": epoch,
            "results": [
                {"provider_request_key": key, "status": "linked" if key in known else "not_recorded"}
                for key in data.provider_request_keys
            ],
        }

    def summary(self, session, company, member, device, thread_key, query):
        if set(query) - {"period", "calculation_view", "method_id"} or query.get("period", "all") != "all":
            raise Problem("unsupported_filter", 422)
        view = self.analytics.methods.prepare_view(session, company, member, query, personal=True)
        # Reuse the same strict opaque-key boundary as the write endpoint.
        import re

        if not re.fullmatch(r"[a-f0-9]{64}", thread_key):
            raise Problem("invalid_payload", 422)
        self.ready(session, company, device)
        cutoff = self.analytics.cutoff(session, company)
        start, end = self.analytics.bounds(company, {"period": "all"})
        linked = aliased(Observation)
        matching = select(linked.id).where(
            retained_request(linked, company, member.id, cutoff),
            linked.occurred_at >= start,
            linked.occurred_at < end,
            exists(
                select(1).where(
                    ThreadRelation.tenant == linked.tenant,
                    ThreadRelation.owner == linked.owner,
                    ThreadRelation.provider_request_key == linked.stable_key,
                    ThreadRelation.thread_key == thread_key,
                )
            ),
        )
        if session.scalar(matching.where(linked.status == "request_identity_ambiguous").limit(1)):
            raise Problem("thread_identity_unresolved", 409, retryable=True)
        matched = session.scalar(select(func.count()).select_from(matching.subquery()))
        result = {
            "status": "matched_recorded_subset" if matched else "unavailable",
            "site": "perplexity",
            "key_version": "1",
            "thread_key": thread_key,
            "deletion_epoch": company.data["epoch"],
            "coverage": {
                "scope": "matched_recorded_requests",
                "provider_history_complete": False,
                "matched_request_count": str(matched),
            },
            "summary": None,
        }
        if not matched:
            return result
        parent = aliased(Observation)
        eligible_parent = exists(
            select(1).where(
                retained_request(parent, company, member.id, cutoff),
                parent.id == Observation.parent,
            )
        )
        shared_attempt = exists(
            select(1).where(
                RequestAttemptLink.tenant == company.id,
                RequestAttemptLink.owner == member.id,
                RequestAttemptLink.attempt_id == Observation.id,
                RequestAttemptLink.request_id.in_(matching),
            )
        )
        statement = select(Observation).where(
            Observation.tenant == company.id,
            Observation.owner == member.id,
            Observation.site == "perplexity",
            Observation.status != "aliased",
            Observation.occurred_at >= start,
            Observation.occurred_at < end,
            or_(
                and_(Observation.kind == "request", Observation.id.in_(matching)),
                and_(
                    Observation.kind == "attempt",
                    eligible_parent,
                    or_(Observation.parent.in_(matching), shared_attempt),
                ),
            ),
        )
        records = session.scalars(statement.execution_options(yield_per=200))
        result["summary"] = self.analytics._canonical_summary(
            session,
            company,
            member,
            {"period": "all"},
            personal=True,
            records_override=select_records(session, records, view.get("method_id")),
        )
        result["summary"].update(view)
        return result


def invalid_restored_relation(session):
    """Restore verification checks relation scope even when the backup predates journal replay."""
    row = aliased(Observation)
    return session.scalar(
        select(ThreadRelation.provider_request_key)
        .outerjoin(
            row,
            and_(
                row.tenant == ThreadRelation.tenant,
                row.owner == ThreadRelation.owner,
                row.kind == "request",
                row.stable_key == ThreadRelation.provider_request_key,
            ),
        )
        .where(or_(row.id.is_(None), row.site != "perplexity"))
        .limit(1)
    )
