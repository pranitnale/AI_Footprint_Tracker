"""
Ending an organization (Terms and DPA: its data is deleted within 30 days).

An administrator requests deletion with a fresh email code. The organization stops at once: members'
browsers can no longer sync or connect, and administrators can only sign in to see the date or
cancel. After GRACE_DAYS the worker deletes every row of the organization in bounded pages and keeps
one pseudonymous record (the organization's internal id and the two dates) in the developer audit.

Each step is written to the deletion journal first, so a restored backup replays it: a cancelled
request stays cancelled, and an organization deleted after the backup is deleted again.
"""

from datetime import timedelta

from sqlalchemy import delete, select, tuple_

from . import dto
from .db import TABLES, Base
from .security import Problem, canonical, instant, parse_time

GRACE_DAYS = 7
PURGE_PAGE = 2000


def state(company):
    status = {"deletion_scheduled": "scheduled", "deleting": "deleting"}.get(company.data["status"], "none")
    deletion = (company.data.get("deletion") or {}) if status != "none" else {}
    return {
        "status": status,
        "requested_at": deletion.get("requested_at"),
        "delete_after": deletion.get("delete_after"),
        "grace_days": GRACE_DAYS,
    }


def journal(service, company, action, **details):
    service.analytics.journal(
        company.id,
        {"scope": "organization", "action": action, "at": instant(service.now()), **details},
    )


def handle(service, s, ctx, method, body):
    """GET the state, POST to request deletion, DELETE to cancel it during the grace period."""
    if method == "POST":
        company, member, _ = service.principal(s, ctx, admin=True)
        data = dto.OrganizationDeletion.model_validate_json(canonical(body)).model_dump(mode="json")
        if data["confirm_name"].strip().casefold() != company.data["name"].strip().casefold():
            raise Problem("confirmation_mismatch", 422)
        service.reauth(s, company, member, data["reauth_token"])
        deletion = {
            "requested_at": instant(service.now()),
            "delete_after": instant(service.now() + timedelta(days=GRACE_DAYS)),
            "requested_by": member.id,
        }
        journal(service, company, "request", delete_after=deletion["delete_after"])
        company.data = {
            **company.data,
            "status": "deletion_scheduled",
            "deletion": deletion,
            "version": company.data["version"] + 1,
        }
        service.audit(s, company.id, member.id, "organization_deletion_requested", company.id, deletion)
        return state(company)
    if method not in {"GET", "DELETE"}:
        raise Problem("not_found", 404)
    company, member, _ = service.principal(s, ctx, admin=True, grace=True)
    if method == "DELETE" and company.data["status"] == "deletion_scheduled":
        journal(service, company, "cancel")
        company.data = {
            **company.data,
            "status": "active",
            "deletion": None,
            "version": company.data["version"] + 1,
        }
        service.audit(s, company.id, member.id, "organization_deletion_cancelled", company.id)
    return state(company)


def due(service, company):
    if company.data["status"] == "deleting":
        return True
    deletion = company.data.get("deletion") or {}
    return (
        company.data["status"] == "deletion_scheduled"
        and parse_time(deletion["delete_after"]) <= service.now()
    )


def purge_step(service, s, company, budget=PURGE_PAGE):
    """
    Deletes up to `budget` rows of the organization, children before parents. Returns True once
    the organization itself is gone. Safe to repeat after a crash: every page starts afresh.
    """
    if company.data["status"] != "deleting":
        journal(service, company, "delete")
        company.data = {**company.data, "status": "deleting"}
        s.flush()
    remaining = budget
    for table in reversed(Base.metadata.sorted_tables):
        if table.name == "companies" or "tenant" not in table.c:
            continue
        keys = list(table.primary_key.columns)
        # Attempts point at their request in the same table, so attempts go first.
        order = [table.c.kind] if table.name == "canonical_observations" else []
        while remaining > 0:
            page = s.execute(
                select(*keys).where(table.c.tenant == company.id).order_by(*order, *keys).limit(remaining)
            ).all()
            if not page:
                break
            if len(keys) == 1:
                s.execute(delete(table).where(keys[0].in_([row[0] for row in page])))
            else:
                s.execute(delete(table).where(tuple_(*keys).in_([tuple(row) for row in page])))
            remaining -= len(page)
        if remaining <= 0:
            return False
    # The completed registration holds the registrant's contact details under no organization key.
    drafts = TABLES["registration"]
    for draft in s.scalars(select(drafts).where(drafts.data["company"].as_string() == company.id)):
        s.delete(draft)
    deletion = company.data.get("deletion") or {}
    company_id = company.id
    s.flush()
    # Rows deleted above in bulk may still sit in the session; none of them may be written back.
    s.expunge_all()
    s.execute(delete(TABLES["company"].__table__).where(TABLES["company"].__table__.c.id == company_id))
    service.audit(
        s,
        "",
        "system",
        "organization_deleted",
        company_id,
        {"requested_at": deletion.get("requested_at"), "deleted_at": instant(service.now())},
        actor_kind="system",
    )
    return True


def replay(service, session, tenant, marker):
    """Applies one journalled organization step to a restored database. True when a purge is due."""
    company = session.get(TABLES["company"], tenant)
    if not company:
        return False
    if marker["action"] == "request" and company.data["status"] == "active":
        company.data = {
            **company.data,
            "status": "deletion_scheduled",
            "deletion": {"requested_at": marker["at"], "delete_after": marker["delete_after"]},
        }
    elif marker["action"] == "cancel" and company.data["status"] == "deletion_scheduled":
        company.data = {**company.data, "status": "active", "deletion": None}
    elif marker["action"] == "delete":
        company.data = {**company.data, "status": "deleting"}
        return True
    return False
