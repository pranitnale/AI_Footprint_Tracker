"""Immutable company policies and installation-specific capture acknowledgements."""

from datetime import timezone
from zoneinfo import ZoneInfo

from dateutil.relativedelta import relativedelta
from sqlalchemy import func, select, tuple_

from .db import TABLES, EnrollmentEra, Observation, get, put
from .security import Problem, canonical, digest, instant


def usage_retention(data):
    """
    The months usage is kept: the plan's limit, or the administrator's shorter choice. None keeps
    usage until an administrator deletes it.
    """
    plan, choice = data.get("retention_months"), data.get("retention_choice")
    if plan is None:
        return choice
    return plan if choice is None else min(plan, choice)


def save_policy(service, session, company):
    policy = service.policy(company)
    policy.pop("deletion_epoch", None)
    key = digest(company.id + ":" + policy["policy_version"])
    existing = get(session, "policy", key, company.id)
    if existing and existing.data["policy"] != policy:
        pieces = company.data["policy_version"].split(".")
        company.data = {**company.data, "policy_version": f"{pieces[0]}.{pieces[1]}.{int(pieces[2]) + 1}"}
        return save_policy(service, session, company)
    if not existing:
        existing = put(
            session,
            "policy",
            key,
            {"policy": policy, "effective_at": instant(service.now()), "hash": digest(canonical(policy))},
            company.id,
        )
    return existing


def current_era(session, company, device):
    return session.scalar(
        select(EnrollmentEra)
        .where(
            EnrollmentEra.tenant == company.id,
            EnrollmentEra.device_id == device.id,
            EnrollmentEra.ended_at.is_(None),
        )
        .order_by(EnrollmentEra.started_at.desc())
        .limit(1)
    )


def acknowledge(service, session, company, device, version, offered_at=None):
    saved = save_policy(service, session, company)
    era = current_era(session, company, device)
    if not era:
        raise Problem("outside_enrollment_era", 403)
    key = digest(company.id + ":" + era.id + ":" + version)
    prior = get(session, "policy_receipt", key, company.id)
    if prior:
        return {key: value for key, value in prior.data.items() if not key.startswith("_")}
    if version != company.data["policy_version"]:
        raise Problem("policy_changed", 409)
    now = instant(service.now())
    receipt_table = TABLES["policy_receipt"]
    sequence = (
        session.scalar(
            select(func.count())
            .select_from(receipt_table)
            .where(
                receipt_table.tenant == company.id,
                receipt_table.data["enrollment_era_id"].as_string() == era.id,
            )
        )
        + 1
    )
    value = {
        "policy_version": version,
        "acknowledged_at": now,
        "effective_from": max(offered_at or now, saved.data["effective_at"], era.data["start"]),
        "enrollment_era_id": era.id,
        "device_id": device.id,
        "_sequence": sequence,
    }
    put(session, "policy_receipt", key, value, company.id, device.owner)
    return {key: item for key, item in value.items() if not key.startswith("_")}


def capture_policy_valid(session, company, device, version, dispatched):
    eras = list(
        session.scalars(
            select(EnrollmentEra).where(
                EnrollmentEra.tenant == company.id,
                EnrollmentEra.device_id == device.id,
                EnrollmentEra.started_at <= dispatched,
                (EnrollmentEra.ended_at.is_(None) | (EnrollmentEra.ended_at > dispatched)),
            )
        )
    )
    cls = TABLES["policy_receipt"]
    for era in eras:
        receipt = get(
            session, "policy_receipt", digest(company.id + ":" + era.id + ":" + version), company.id
        )
        if not receipt or receipt.data["effective_from"] > dispatched:
            continue
        # Acknowledgements are append-only; later activation closes the preceding capture-policy interval.
        later = session.scalar(
            select(cls)
            .where(
                cls.tenant == company.id,
                cls.owner == device.owner,
                cls.data["enrollment_era_id"].as_string() == era.id,
                cls.data["_sequence"].as_integer() > receipt.data.get("_sequence", 1),
                cls.data["acknowledged_at"].as_string() <= dispatched,
            )
            .limit(1)
        )
        if not later:
            return True
    return False


def retention_preview(service, session, company, months, effective_at):
    if months is None:
        return {
            "request_count": "0",
            "attempt_count": "0",
            "cutoff": None,
            "counted_at": instant(service.now()),
            "irreversible": False,
        }
    local = effective_at.astimezone(ZoneInfo(company.data["timezone"])).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    cutoff = instant((local - relativedelta(months=months)).astimezone(timezone.utc))
    parents = select(Observation.owner, Observation.id).where(
        Observation.tenant == company.id, Observation.kind == "request", Observation.occurred_at < cutoff
    )
    requests = session.scalar(
        select(func.count())
        .select_from(Observation)
        .where(
            Observation.tenant == company.id, Observation.kind == "request", Observation.occurred_at < cutoff
        )
    )
    attempts = session.scalar(
        select(func.count())
        .select_from(Observation)
        .where(
            Observation.tenant == company.id,
            Observation.kind == "attempt",
            tuple_(Observation.owner, Observation.parent).in_(parents),
        )
    )
    return {
        "request_count": str(requests),
        "attempt_count": str(attempts),
        "cutoff": cutoff,
        "counted_at": instant(service.now()),
        "irreversible": True,
        "time_basis": "request_dispatch_and_entire_family",
        "coverage": "Counts reflect currently stored data; the acknowledged rolling policy also applies to later captures.",
    }
