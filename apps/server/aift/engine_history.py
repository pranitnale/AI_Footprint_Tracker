"""Immutable overlays bind all source revisions, including a live request's provider context."""

import hashlib
import json
from collections import OrderedDict
from threading import Lock

from footprint_contracts import payload_hash
from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    ForeignKeyConstraint,
    Index,
    String,
    event,
    false,
    select,
)
from sqlalchemy.orm import Mapped, defer, mapped_column

from .db import Base, HistoryObservation, Observation, get, put
from .security import Problem


class EngineEstimate(Base):
    __tablename__ = "engine_estimates"
    tenant: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner: Mapped[str] = mapped_column(String(36), primary_key=True)
    family: Mapped[str] = mapped_column(String(8), primary_key=True)
    record_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    observation_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    request_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    method_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    view: Mapped[str] = mapped_column(String(16), primary_key=True)
    history_hash: Mapped[str] = mapped_column(String(64), primary_key=True, default="", server_default="")
    history_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    estimate: Mapped[dict] = mapped_column(JSON)
    source_payload: Mapped[dict] = mapped_column(JSON)
    request_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    original_method_hash: Mapped[str | None] = mapped_column(String(64))
    original_method_missing: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    __table_args__ = (
        ForeignKeyConstraint(["tenant", "owner"], ["memberships.tenant", "memberships.id"]),
        CheckConstraint("family IN ('live', 'history') AND view IN ('original', 'recalculated')"),
        CheckConstraint(
            "(NOT original_method_missing AND (view = 'original' OR original_method_hash IS NOT NULL)) "
            "OR (original_method_missing AND view = 'recalculated' AND original_method_hash IS NULL AND family = 'live')",
            name="ck_engine_estimates_original_lineage",
        ),
        CheckConstraint(
            "NOT original_method_missing OR coalesce(source_payload ->> 'proposed_method_id' = 'unavailable-admission-v1', false)",
            name="ck_engine_estimates_missing_original_source",
        ),
        Index("ix_engine_estimate_record", "tenant", "owner", "family", "record_key"),
    )


@event.listens_for(EngineEstimate, "before_update")
def immutable_overlay(mapper, connection, target):
    raise ValueError("immutable_estimate_history")


def request_for(session, record):
    return session.get(Observation, (record.tenant, record.owner, "request", record.parent))


def canonical_request_binding(session, tenant, owner, attempt, request):
    from .security import digest

    observed, canonical = attempt["request_id"], request["request_id"]
    if observed == canonical:
        return None
    if not tenant or not owner:
        raise Problem("estimation_input_unavailable", 409, True)
    current, seen = observed, set()
    for _ in range(32):
        if current in seen:
            break
        seen.add(current)
        relation = get(session, "alias", digest(tenant + owner + "request" + current), tenant)
        if relation is None or relation.owner != owner:
            break
        current = relation.data.get("canonical_id")
        if current == canonical:
            value = {"observed_request_id": observed, "canonical_request_id": canonical}
            return {**value, "relation_hash": payload_hash({"kind": "canonical_request_alias", **value})}
    raise Problem("estimation_input_unavailable", 409, True)


def source_key(session, record, method_id, view):
    history = isinstance(record, HistoryObservation)
    request = None if history else request_for(session, record)
    from .history_matching import linked_history

    linked = (
        linked_history(session, record.tenant, record.owner, record.payload, request.payload)
        if not history and request is not None and view == "recalculated"
        else None
    )
    return (
        record.tenant,
        record.owner,
        "history" if history else "live",
        record.message_key if history else record.id,
        record.payload_hash,
        "" if history or request is None else request.payload_hash,
        method_id,
        view,
        linked.payload_hash if linked else "",
    )


def prefetch_estimates(session, records, method_id, view):
    """
    Reads together the stored estimates lookup() would read one by one for records (live attempts
    or saved messages) in one view of one method, and remembers them for the rest of the read
    memo. A recalculated summary looks up every attempt and saved reply of its period; one query
    per record took most of a person's own summary. Outside a read memo this does nothing.
    """
    from .history_matching import chunked, memo_of

    memo = memo_of(session)
    if memo is None or not method_id:
        return
    wanted = {}
    for record in records:
        family, key = _identity(record)
        if ("estimates read", record.tenant, record.owner, family, key, method_id, view) not in memo:
            wanted.setdefault((record.tenant, family), set()).add((record.owner, key))
    e = EngineEstimate
    for (tenant, family), keys in wanted.items():
        # lookup() never reads the linked history payload, and reads a saved message's source only
        # for a missing original (live estimates need theirs); these large values stay undecoded
        # until something reads them.
        unread = [e.history_payload]
        if family == "history":
            unread += [e.source_payload, e.request_payload]
        for owners, chunk in chunked(keys, lambda k: k[1]):
            for row in session.scalars(
                select(e)
                .options(*(defer(column) for column in unread))
                .where(
                    e.tenant == tenant,
                    e.owner.in_(owners),
                    e.family == family,
                    e.record_key.in_(chunk),
                    e.method_id == method_id,
                    e.view == view,
                )
            ):
                # Keyed as session.get is: the primary key in column order, as source_key builds it.
                memo[("estimate row", _primary_key(row))] = row
        for owner, key in keys:
            memo[("estimates read", tenant, owner, family, key, method_id, view)] = True


def _identity(record):
    if isinstance(record, HistoryObservation):
        return "history", record.message_key
    return "live", record.id


def _primary_key(row):
    return (
        row.tenant,
        row.owner,
        row.family,
        row.record_key,
        row.observation_hash,
        row.request_hash,
        row.method_id,
        row.view,
        row.history_hash,
    )


def _stored_estimate(session, key):
    """session.get(EngineEstimate, key), answered from prefetch_estimates when it read the record's
    estimates of that method and view: every row it found is remembered, so a key it did not find
    has no row."""
    from .history_matching import memo_of

    memo = memo_of(session)
    tenant, owner, family, record_key, _, _, method_id, view, _ = key
    if memo is not None and ("estimates read", tenant, owner, family, record_key, method_id, view) in memo:
        return memo.get(("estimate row", key))
    return session.get(EngineEstimate, key)


def lookup(session, record, method_id, view="recalculated"):
    row = _stored_estimate(session, source_key(session, record, method_id, view))
    if row and (
        not isinstance(row.estimate, dict)
        or (row.estimate.get("status") != "pending" and row.estimate.get("schema_version") != "3.0.0")
    ):
        raise Problem("estimate_lineage_conflict", 503)
    if row and isinstance(row.estimate, dict) and row.estimate.get("schema_version") == "3.0.0":
        validate_binding(session, row.estimate, method_id, view, row.original_method_hash)
        # The source is read only for an explicitly missing original; prefetch_estimates leaves a
        # saved message's source undecoded until it is read.
        validate_original_lineage(
            session,
            row.tenant,
            row.owner,
            row.source_payload if row.original_method_missing else None,
            row.estimate,
            row.original_method_missing,
        )
        source = row.estimate["source"]
        if (
            source["family"] != row.family
            or (source.get("attempt_hash") if row.family == "live" else source["observation_hash"])
            != row.observation_hash
            or (source.get("request_hash", "") != row.request_hash)
            or (source.get("history_binding", {}).get("observation_hash", "") != row.history_hash)
            or (source.get("attempt_id") if row.family == "live" else source["message_key"]) != row.record_key
        ):
            raise Problem("estimate_lineage_conflict", 503)
        if row.family == "live" and source.get("canonical_request_binding") != canonical_request_binding(
            session, row.tenant, row.owner, row.source_payload, row.request_payload
        ):
            raise Problem("estimate_lineage_conflict", 503)
    return row.estimate if row else None


class PassedChecks:
    """
    Digests of stored JSON values that passed one pure validation, which then runs once per value
    and process. Summaries and the worker's sweeps validate the same stored records again and
    again, and a schema check costs milliseconds. A value that fails is checked again every time.
    """

    def __init__(self, validate, limit=16384):
        self.validate, self.limit, self.digests, self.lock = validate, limit, OrderedDict(), Lock()

    def __call__(self, value):
        try:
            # JSON text keeps true and 1 apart, so equal text means an equal value.
            key = hashlib.sha256(json.dumps(value, sort_keys=True).encode()).digest()
        except (TypeError, ValueError):
            self.validate(value)
            return
        with self.lock:
            if key in self.digests:
                self.digests.move_to_end(key)
                return
        self.validate(value)
        with self.lock:
            self.digests[key] = None
            while len(self.digests) > self.limit:
                self.digests.popitem(last=False)


def _validate_estimation_envelope(value):
    from estimation_contracts import validate_estimation_envelope

    validate_estimation_envelope(value)


validate_envelope = PassedChecks(_validate_estimation_envelope)


def validate_binding(session, result, method_id, view, original_hash):
    from .engine_adapter import IMAGE_REFERENCE_HASH
    from .method_registry import resolve_identity

    validate_envelope(result)
    requested = resolve_identity(session, method_id)[1]
    effective = resolve_identity(session, result["effective_method"]["method_id"])[1]
    if (
        result["requested_method"] != requested
        or result["effective_method"] != effective
        or result["auxiliary_method_hashes"] != {"image_reference": IMAGE_REFERENCE_HASH}
        or result["view"] != view
        or result["original_method_hash"] != original_hash
    ):
        raise Problem("estimate_lineage_conflict", 503)


def validate_original_lineage(session, tenant, owner, source, result, missing):
    """Only saved non-admission evidence can authorize an explicitly missing original."""
    from .engine_adapter import MISSING_ADMISSION_METHOD_ID
    from .method_history import HistoricalEstimate

    declared = result.get("view") == "recalculated" and result.get("original_method_hash") is None
    if missing != declared:
        raise Problem("estimate_lineage_conflict", 503)
    if not missing:
        return
    if (
        source.get("kind") != "attempt"
        or source.get("proposed_method_id") != MISSING_ADMISSION_METHOD_ID
        or result.get("source", {}).get("family") != "live"
        or payload_hash(source) != result["source"]["attempt_hash"]
        or "original_method_missing" not in result.get("reasons", [])
    ):
        raise Problem("estimate_lineage_conflict", 503)
    record = session.get(Observation, (tenant, owner, "attempt", source["attempt_id"]))
    if not record or (
        record.payload.get("proposed_method_id") != MISSING_ADMISSION_METHOD_ID
        or record.estimate.get("result") is not None
    ):
        raise Problem("estimate_lineage_conflict", 503)
    if (
        session.scalar(
            select(HistoricalEstimate.attempt_id)
            .where(
                HistoricalEstimate.tenant == tenant,
                HistoricalEstimate.owner == owner,
                HistoricalEstimate.attempt_id == source["attempt_id"],
                HistoricalEstimate.view == "original",
            )
            .limit(1)
        )
        is not None
        or session.scalar(
            select(EngineEstimate.record_key)
            .where(
                EngineEstimate.tenant == tenant,
                EngineEstimate.owner == owner,
                EngineEstimate.family == "live",
                EngineEstimate.record_key == source["attempt_id"],
                EngineEstimate.view == "original",
            )
            .limit(1)
        )
        is not None
    ):
        raise Problem("estimate_lineage_conflict", 503)


def verify_overlay(session, overlay):
    from footprint_contracts import validate_history_page, validate_observation

    from .historical_usage import numeric_payload_hash
    from .method_registry import estimate, estimate_history

    source = overlay.source_payload
    options = {
        "methodId": overlay.method_id,
        "view": overlay.view,
        "originalMethodHash": overlay.original_method_hash,
    }
    if overlay.original_method_missing:
        options["originalMethodMissing"] = True
    if overlay.family == "history":
        validate_history_page(
            {
                "schema_version": "3.0.0",
                "site": source["site"],
                "conversation_key": source["conversation_key"],
                "observed_at": source["observed_at"],
                "deletion_epoch": 0,
                "messages": [source],
                "branch_scope": "unknown",
                "selected_leaf_key": None,
                "branch_message_keys": None,
                "root_message_key": None,
                "first_request_verified": False,
                "has_earlier": None,
                "has_later": None,
            }
        )
        if (
            numeric_payload_hash(source) != overlay.observation_hash
            or source["message_key"] != overlay.record_key
            or overlay.request_payload is not None
        ):
            raise Problem("estimate_lineage_conflict", 503)
    else:
        validate_observation(source)
        validate_observation(overlay.request_payload)
        if (
            payload_hash(source) != overlay.observation_hash
            or source["attempt_id"] != overlay.record_key
            or payload_hash(overlay.request_payload) != overlay.request_hash
        ):
            raise Problem("estimate_lineage_conflict", 503)
    if overlay.history_payload is not None:
        from .timing_evidence import assert_linked_history

        if (
            overlay.family != "live"
            or overlay.view != "recalculated"
            or numeric_payload_hash(overlay.history_payload) != overlay.history_hash
            or overlay.estimate.get("source", {}).get("history_binding")
            != {
                "message_key": overlay.history_payload["message_key"],
                "observation_hash": overlay.history_hash,
            }
        ):
            raise Problem("estimate_lineage_conflict", 503)
        assert_linked_history(overlay.request_payload, source, overlay.history_payload)
    elif overlay.history_hash:
        raise Problem("estimate_lineage_conflict", 503)
    if overlay.original_method_missing and (
        not isinstance(overlay.estimate, dict) or overlay.estimate.get("schema_version") != "3.0.0"
    ):
        raise Problem("estimate_lineage_conflict", 503)
    if isinstance(overlay.estimate, dict) and overlay.estimate.get("status") == "pending":
        return
    if isinstance(overlay.estimate, dict) and overlay.estimate.get("schema_version") == "3.0.0":
        validate_binding(
            session, overlay.estimate, overlay.method_id, overlay.view, overlay.original_method_hash
        )
        validate_original_lineage(
            session, overlay.tenant, overlay.owner, source, overlay.estimate, overlay.original_method_missing
        )
    recomputed = (
        estimate_history(session, source, options)
        if overlay.family == "history"
        else estimate(
            session,
            source,
            options,
            request=overlay.request_payload,
            tenant=overlay.tenant,
            owner=overlay.owner,
            history=overlay.history_payload,
        )
    )
    if payload_hash(recomputed) != payload_hash(overlay.estimate):
        raise Problem("estimate_lineage_conflict", 503)


def persist(session, record, method_id, result, view):
    key = source_key(session, record, method_id, view)
    prior = session.get(EngineEstimate, key)
    if prior:
        if payload_hash(prior.estimate) != payload_hash(result):
            raise Problem("estimate_lineage_conflict", 503)
        return
    if view == "original":
        original_hash = None
    elif isinstance(record, HistoryObservation):
        original_hash = record.original["proposed_method_hash"]
    elif isinstance(result, dict) and result.get("schema_version") == "3.0.0":
        original_hash = result["original_method_hash"]
    else:
        original_hash = result["original_method_hash"]
    original_missing = view == "recalculated" and original_hash is None
    if original_missing and (not isinstance(result, dict) or result.get("schema_version") != "3.0.0"):
        raise Problem("estimate_lineage_conflict", 503)
    if not isinstance(result, dict) or result.get("schema_version") != "3.0.0":
        if result.get("status") != "pending":
            raise Problem("estimate_lineage_conflict", 503)
    else:
        validate_binding(session, result, method_id, view, original_hash)
        validate_original_lineage(
            session, record.tenant, record.owner, record.payload, result, original_missing
        )
    session.add(
        EngineEstimate(
            **dict(
                zip(
                    (
                        "tenant",
                        "owner",
                        "family",
                        "record_key",
                        "observation_hash",
                        "request_hash",
                        "method_id",
                        "view",
                        "history_hash",
                    ),
                    key,
                )
            ),
            history_payload=(
                session.get(
                    HistoryObservation,
                    (record.tenant, record.owner, result["source"]["history_binding"]["message_key"]),
                ).payload
                if isinstance(result, dict) and result.get("source", {}).get("history_binding")
                else None
            ),
            estimate=result,
            original_method_hash=original_hash,
            original_method_missing=original_missing,
            source_payload=record.payload,
            request_payload=None
            if isinstance(record, HistoryObservation)
            else request_for(session, record).payload,
        )
    )
    session.flush()


def erase(session, record, budget=100, preserve_current_original=False):
    history = isinstance(record, HistoryObservation)
    if history:
        invalidate_linked_estimates(session, record)
    condition = (
        EngineEstimate.tenant == record.tenant,
        EngineEstimate.owner == record.owner,
        EngineEstimate.family == ("history" if history else "live"),
        EngineEstimate.record_key == (record.message_key if history else record.id),
    )
    query = select(EngineEstimate).where(*condition)
    if preserve_current_original:
        key = source_key(session, record, record.payload["proposed_method_id"], "original")
        query = query.where(
            ~(
                (EngineEstimate.observation_hash == key[4])
                & (EngineEstimate.request_hash == key[5])
                & (EngineEstimate.method_id == key[6])
                & (EngineEstimate.view == "original")
            )
        )
    rows = list(session.scalars(query.limit(budget)))
    for row in rows:
        session.delete(row)
    session.flush()
    return len(rows)


def original_history_snapshot(record):
    return HistoryObservation(
        tenant=record.tenant,
        owner=record.owner,
        message_key=record.message_key,
        payload=record.original,
        payload_hash=payload_hash({k: v for k, v in record.original.items() if k != "observed_at"}),
        original=record.original,
    )


def selected_history(session, record, method_id=None):
    if not method_id:
        if isinstance(record.original_estimate, dict) and record.original_estimate.get("status") == "pending":
            snapshot = original_history_snapshot(record)
            recovered = lookup(session, snapshot, snapshot.payload["proposed_method_id"], "original")
            return record.original_estimate if recovered is None else recovered
        return record.original_estimate
    result = lookup(session, record, method_id)
    if result is None:
        return {"status": "pending", "reason": "recalculation_pending"}
    return result


def recover_history(analytics, session, company, budget=100):
    from .method_registry import estimate_history

    h = HistoryObservation
    from sqlalchemy import tuple_

    from .security import digest

    cursor_key = digest(company.id + ":history-engine-recovery")
    cursor = get(session, "maintenance_cursor", cursor_key, company.id)
    after = tuple(cursor.data["after"]) if cursor else ("", "")
    query = select(h).where(
        h.tenant == company.id,
        h.status == "current",
        analytics.history.visible(company),
        h.estimate["status"].as_string() == "pending",
    )
    records = list(
        session.scalars(
            query.where(tuple_(h.owner, h.message_key) > after).order_by(h.owner, h.message_key).limit(budget)
        )
    )
    if not records and after != ("", ""):
        records = list(session.scalars(query.order_by(h.owner, h.message_key).limit(budget)))
    for stored in records:
        for record in [original_history_snapshot(stored), stored]:
            try:
                if lookup(session, record, record.payload["proposed_method_id"], "original") is not None:
                    continue
            except Problem as error:
                # A stored estimate whose method no longer resolves stays as it is. Raising here
                # stopped every tenant's maintenance, not just this record's recovery.
                if error.code in {"method_unsupported", "engine_unavailable"}:
                    continue
                raise
            try:
                with session.begin_nested():
                    result = estimate_history(session, record.payload)
                    persist(session, record, record.payload["proposed_method_id"], result, "original")
            except (Problem, ValueError, ArithmeticError, RuntimeError) as error:
                if isinstance(error, Problem) and error.code in {"method_unsupported", "engine_unavailable"}:
                    continue
                if isinstance(error, Problem) and error.code == "method_update_invalid":
                    persist(
                        session,
                        record,
                        record.payload["proposed_method_id"],
                        {"status": "pending", "reason": error.code},
                        "original",
                    )
                # A transient calculation failure keeps its pending source and advances the retry cursor.
    put(
        session,
        "maintenance_cursor",
        cursor_key,
        {"after": [records[-1].owner, records[-1].message_key] if records else ["", ""]},
        company.id,
    )


def history_missing(analytics, session, company, method_id, owner=None):
    h = HistoryObservation
    available = (
        select(EngineEstimate.record_key)
        .where(
            EngineEstimate.tenant == h.tenant,
            EngineEstimate.owner == h.owner,
            EngineEstimate.family == "history",
            EngineEstimate.record_key == h.message_key,
            EngineEstimate.observation_hash == h.payload_hash,
            EngineEstimate.request_hash == "",
            EngineEstimate.method_id == method_id,
            EngineEstimate.view == "recalculated",
        )
        .exists()
    )
    query = select(h).where(
        h.tenant == company.id, h.status == "current", analytics.history.visible(company), ~available
    )
    return query.where(h.owner == owner) if owner else query


def invalidate_linked_estimates(session, record):
    """Remove dependent snapshots even after their live copy stops being canonical."""
    from sqlalchemy import and_, delete, false, or_

    message_key = record.payload["message_key"]
    dependency = or_(
        EngineEstimate.history_payload["message_key"].as_string() == message_key,
        EngineEstimate.estimate["source"]["history_binding"]["message_key"].as_string() == message_key,
    )
    key = record.payload.get("provider_attempt_key")
    current = false()
    if key:
        ids = select(Observation.id).where(
            Observation.tenant == record.tenant,
            Observation.owner == record.owner,
            Observation.kind == "attempt",
            Observation.stable_key == key,
        )
        # Previously unlinked current results must also be recalculated when history arrives.
        current = and_(EngineEstimate.view == "recalculated", EngineEstimate.record_key.in_(ids))
    session.execute(
        delete(EngineEstimate).where(
            EngineEstimate.tenant == record.tenant,
            EngineEstimate.owner == record.owner,
            EngineEstimate.family == "live",
            or_(dependency, current),
        )
    )
