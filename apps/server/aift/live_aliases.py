"""Retain real live copies and promote the strongest proven observation without synthesizing fields."""

from sqlalchemy import select

from .db import TABLES, Observation, RequestAttemptLink, get, put
from .security import digest


def live_evidence_order(record):
    if record["kind"] != "attempt":
        return (0, 0, 0, 0, record["dispatched_at"], record["request_id"])
    timing, tokens = record["timing"], record["tokens"]
    flags = (
        timing is not None
        and timing["source"] == "browser_request"
        and timing["completeness"] == "complete_for_scope",
        tokens["output_total"]["value"] is not None
        and tokens["output_total"]["evidence"] == "provider_reported",
        tokens["answer_output"]["value"] is not None
        and tokens["answer_output"]["completeness"] == "complete_for_scope",
        record["state"] == "completed",
    )
    return (*(-int(flag) for flag in flags), record["started_at"], record["attempt_id"])


def retain_alias(
    analytics,
    session,
    company,
    member,
    device,
    record,
    parent,
    old,
    canonical,
    hashed,
    receipt_key,
    *,
    allow_promotion=True,
):
    kind = record["kind"]
    identifier = record["attempt_id"] if kind == "attempt" else record["request_id"]
    # A later distinct dispatch must not replace the originating execution's timer or attribution.
    promote = (
        allow_promotion
        and kind == "attempt"
        and live_evidence_order(record) < live_evidence_order(canonical.payload)
    )
    estimated = analytics.estimate(
        record, session, parent.payload if parent else None, tenant=company.id, owner=member.id
    )
    if old and old.status != "aliased":
        analytics.contribution_delta(session, company, member, old, -1)
    if promote:
        analytics.contribution_delta(session, company, member, canonical, -1)
        canonical.status, canonical.stable_key = "aliased", None
        session.flush()
    values = dict(
        revision=record["revision"],
        payload_hash=hashed,
        payload=record,
        estimate=estimated,
        stable_key=record["provider_attempt_key"] if promote else None,
        status="current" if promote else "aliased",
        model=record["model_id"],
    )
    if old:
        for name, value in values.items():
            setattr(old, name, value)
        retained = old
    else:
        retained = Observation(
            tenant=company.id,
            owner=member.id,
            kind=kind,
            id=identifier,
            device=device.id,
            parent=parent.id if parent else None,
            parent_kind="request" if parent else None,
            occurred_at=record["started_at"] if parent else record["dispatched_at"],
            site=parent.site if parent else record["site"],
            conversation=parent.conversation if parent else record["conversation_key"],
            **values,
        )
        session.add(retained)
    session.flush()
    target = retained if promote else canonical
    alias_key = digest(company.id + member.id + kind + identifier)
    if promote:
        existing = get(session, "alias", alias_key, company.id)
        if existing:
            session.delete(existing)
        alias_table = TABLES["alias"]
        for alias in session.scalars(
            select(alias_table).where(
                alias_table.tenant == company.id,
                alias_table.owner == member.id,
                alias_table.data["canonical_id"].as_string() == canonical.id,
            )
        ):
            alias.data = {**alias.data, "canonical_id": identifier}
        put(
            session,
            "alias",
            digest(company.id + member.id + kind + canonical.id),
            {"canonical_id": identifier},
            company.id,
            member.id,
        )
        for relation in list(
            session.scalars(
                select(RequestAttemptLink).where(
                    RequestAttemptLink.tenant == company.id,
                    RequestAttemptLink.owner == member.id,
                    RequestAttemptLink.attempt_id == canonical.id,
                )
            )
        ):
            key = (company.id, member.id, relation.request_id, identifier)
            if not session.get(RequestAttemptLink, key):
                session.add(
                    RequestAttemptLink(
                        tenant=company.id,
                        owner=member.id,
                        request_id=relation.request_id,
                        attempt_id=identifier,
                        reason=relation.reason,
                    )
                )
            session.delete(relation)
        analytics.contribution_delta(session, company, member, retained, 1)
    else:
        put(session, "alias", alias_key, {"canonical_id": canonical.id}, company.id, member.id)
    put(
        session,
        "revision",
        receipt_key,
        {
            "record": record,
            "estimate": estimated,
            "payload_hash": hashed,
            "kind": kind,
            "record_id": identifier,
        },
        company.id,
        member.id,
    )
    return target
