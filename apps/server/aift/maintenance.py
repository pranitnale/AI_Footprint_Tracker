"""Bounded, resumable worker ticks and an explicit restore barrier."""

import argparse
import json
import time
from datetime import timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import delete, func, select, tuple_
from sqlalchemy.exc import IntegrityError

from .db import TABLES, DailyRollup, Database, NetworkObservation, Observation, get, put
from .security import Problem, canonical, digest, instant, parse_time

WORK_PAGE = 100


def cursor_page(session, kind, tenant=None, owner=None, name=None, limit=WORK_PAGE, predicate=None):
    cursor_id = digest(canonical([kind, tenant, owner, name or "worker"]))
    checkpoint = get(session, "maintenance_cursor", cursor_id)
    after = checkpoint.data["after"] if checkpoint else ""
    cls = TABLES[kind]

    def fetch(position):
        query = select(cls).where(cls.id > position)
        if tenant is not None:
            query = query.where(cls.tenant == tenant)
        if owner is not None:
            query = query.where(cls.owner == owner)
        if predicate is not None:
            query = query.where(predicate)
        return list(session.scalars(query.order_by(cls.id).limit(limit)))

    records = fetch(after)
    if not records and after:
        records = fetch("")
    put(session, "maintenance_cursor", cursor_id, {"after": records[-1].id if records else ""}, tenant or "")
    return records


def rebucket(service, session, company):
    if company.data.get("aggregate_status") != "rebuilding":
        return True
    key = digest(company.id + ":rebucket")
    row = get(session, "maintenance_cursor", key, company.id)
    if not row or row.data.get("timezone") != company.data["timezone"]:
        row = put(
            session,
            "maintenance_cursor",
            key,
            {
                "timezone": company.data["timezone"],
                "phase": "clearing",
                "owner": "",
                "occurred_at": "",
                "id": "",
                "group": None,
            },
            company.id,
        )
    if row.data["phase"] == "clearing":
        ids = list(
            session.scalars(
                select(DailyRollup.id)
                .where(DailyRollup.tenant == company.id)
                .order_by(DailyRollup.id)
                .limit(WORK_PAGE)
            )
        )
        if ids:
            session.execute(
                delete(DailyRollup).where(DailyRollup.tenant == company.id, DailyRollup.id.in_(ids))
            )
            return False
        row.data = {**row.data, "phase": "rebuilding"}
    records = list(
        session.execute(
            select(Observation.owner, Observation.occurred_at, Observation.id)
            .where(
                Observation.tenant == company.id,
                tuple_(Observation.owner, Observation.occurred_at, Observation.id)
                > (row.data["owner"], row.data["occurred_at"], row.data["id"]),
            )
            .order_by(Observation.owner, Observation.occurred_at, Observation.id)
            .limit(WORK_PAGE)
        )
    )
    previous = row.data["group"]
    for owner, occurred_at, identifier in records:
        group = [
            owner,
            parse_time(occurred_at).astimezone(ZoneInfo(company.data["timezone"])).date().isoformat(),
        ]
        if group != previous:
            service.analytics.rebuild_day(
                session, company, get(session, "member", owner, company.id), group[1], include_expired=True
            )
            previous = group
    row.data = {
        **row.data,
        "owner": records[-1][0] if records else row.data["owner"],
        "occurred_at": records[-1][1] if records else row.data["occurred_at"],
        "id": records[-1][2] if records else row.data["id"],
        "group": previous,
    }
    if len(records) < WORK_PAGE:
        company.data = {**company.data, "aggregate_status": "current"}
        return True
    return False


def maintain_tenant(service, session, company):
    from .organization_deletion import due, purge_step
    from .policies import save_policy

    if company is None:
        return
    if due(service, company):
        # An ended organization only gets deleted, one bounded page per tick.
        purge_step(service, session, company)
        return
    analytics = service.analytics
    for transition in cursor_page(session, "transition", company.id):
        state = service.transition_state(transition)
        if state in {"applied", "cancelled", "superseded"}:
            continue
        valid = service.transition_valid(company, transition)
        if transition.data.get("exception_id"):
            linked = get(session, "exception", transition.data["exception_id"], company.id)
            valid = valid and bool(
                linked
                and linked.data["status"] in {"active", "revocation_scheduled"}
                and linked.data["reversion_transition_id"] == transition.id
            )
        conflict = service.entitlement_conflict(
            session, company, transition_id=transition.id, exception_id=transition.data.get("exception_id")
        )
        if not valid or conflict:
            if state != "review_required":
                transition.data = {
                    **transition.data,
                    "status": "review_required",
                    "acknowledged": False,
                    "version": transition.data["version"] + 1,
                    "error_code": "entitlement_baseline_changed" if not valid else "entitlement_conflict",
                }
                service.audit(
                    session,
                    company.id,
                    "system",
                    "plan_transition_review_required",
                    transition.id,
                    {"error_code": transition.data["error_code"]},
                    actor_kind="system",
                )
            continue
        if (
            state != "pending"
            or (
                transition.data.get("retention_shortened") is not False
                and not transition.data["acknowledged"]
            )
            or parse_time(transition.data["effective_at"]) > service.now()
        ):
            continue
        save_policy(service, session, company)
        plan = get(session, "plan", transition.data["plan"])
        if not plan:
            transition.data = {
                **transition.data,
                "status": "review_required",
                "acknowledged": False,
                "version": transition.data["version"] + 1,
                "error_code": "plan_unavailable",
            }
            continue
        company.data = {
            **company.data,
            "capacity": plan.data["member_capacity"],
            "retention_months": plan.data["retention_months"],
            "plan_id": plan.data["plan_id"],
            "plan_version": plan.data["version"],
        }
        service.advance_entitlement(company)
        save_policy(service, session, company)
        transition.data = {
            **transition.data,
            "applied": True,
            "status": "applied",
            "version": transition.data["version"] + 1,
            "applied_at": instant(service.now()),
            "applied_by": "system",
        }
        if transition.data.get("exception_id"):
            exception = get(session, "exception", transition.data["exception_id"], company.id)
            if exception:
                exception.data = {
                    **exception.data,
                    "status": "revoked" if exception.data["status"] == "revocation_scheduled" else "expired",
                    "version": exception.data["version"] + 1,
                }
        service.audit(
            session,
            company.id,
            "system",
            "plan_transition_applied",
            transition.id,
            {"plan": plan.id, "entitlement_generation": company.data["entitlement_generation"]},
            actor_kind="system",
        )
    cutoff = analytics.cutoff(session, company)
    previous = get(session, "retention", company.id, company.id)
    if cutoff and (not previous or cutoff > previous.data["cutoff"]):
        marker = {
            "scope": "range",
            "user_id": None,
            "start": "1970-01-01T00:00:00.000Z",
            "end": cutoff,
            "record_ids": [],
            "record_owners": {},
            "epoch": company.data["epoch"],
            "created_at": instant(service.now()),
            "retention": True,
        }
        marker["job_id"] = digest(company.id + ":retention:" + cutoff)
        analytics.journal(company.id, marker)
        put(session, "retention", company.id, {"cutoff": cutoff}, company.id)
        analytics.deletions.schedule_marker(session, company, marker)
    preview_cls = TABLES["deletion_preview"]
    for preview in cursor_page(
        session,
        "deletion_preview",
        company.id,
        name="pending",
        limit=5,
        predicate=(preview_cls.data["state"].as_string() == "pending"),
    ):
        analytics.deletions.advance_preview(session, company, preview)
    if not rebucket(service, session, company):
        return
    job_cls = TABLES["deletion_job"]
    for job in cursor_page(
        session,
        "deletion_job",
        company.id,
        name="pending",
        limit=5,
        predicate=(job_cls.data["status"].as_string() != "completed"),
    ):
        try:
            with session.begin_nested():
                job.data = {**job.data, "status": "applying", "error_code": None}
                analytics.deletions.advance(session, company, job)
        except (Problem, ValueError, RuntimeError) as error:
            job.data = {
                **job.data,
                "status": "failed",
                "error_code": error.code if isinstance(error, Problem) else "deletion_worker_failed",
            }
    # With IP collection off there is no retention period to apply: addresses stored earlier stay
    # until an operator runs purge-network-observations, after the owner confirms.
    if service.settings.ip_collection_enabled:
        ip_cutoff = instant(service.now() - timedelta(days=service.settings.ip_retention_days))
        ids = list(
            session.scalars(
                select(NetworkObservation.id)
                .where(NetworkObservation.tenant == company.id, NetworkObservation.observed_at < ip_cutoff)
                .order_by(NetworkObservation.id)
                .limit(WORK_PAGE)
            )
        )
        if ids:
            session.execute(
                delete(NetworkObservation).where(
                    NetworkObservation.tenant == company.id, NetworkObservation.id.in_(ids)
                )
            )
    for export in cursor_page(session, "export", company.id, limit=5):
        if not service.alive(export.data["expires_at"]) or export.data["status"] == "cancelled":
            analytics.exports.delete_page(session, export)
        elif export.data["status"] == "pending":
            analytics.exports.advance(session, company, export)
    if analytics.deletions.in_progress(session, company):
        return
    if service.settings.ip_collection_enabled:
        from .ip_rotation import advance_tenant

        advance_tenant(service, session, company)
    analytics.methods.advance_tenant(session, company)
    for rollup in cursor_page(session, "rollup", company.id, name="reconcile"):
        current = get(session, "rollup", rollup.id, company.id)
        if not current:
            continue
        owner = get(session, "member", current.owner, company.id)
        expected = analytics.day_value(session, company, owner, current.day, current.site, current.model)
        if digest(canonical(expected)) != current.data["checksum"]:
            try:
                with session.begin_nested():
                    analytics.rebuild_day(session, company, owner, current.day)
                    service.audit(session, company.id, "system", "aggregate_rebuilt", current.id)
            except (Problem, ValueError, RuntimeError):
                current.data = {**current.data, "status": "inconsistent"}


def archive_packaged_method(service):
    """
    Stored estimates name the method they were made with, and only archived methods resolve after
    the next release replaces the packaged one. Recalculations by the worker did not archive it, so
    on 14 Oct 2026 the deploy after such a release stopped the worker with method_unsupported.
    """
    from .method_registry import packaged_identity, retain_packaged_definition

    try:
        with service.db.transaction(scope="method-archive") as session:
            retain_packaged_definition(session, packaged_identity()[1]["method_id"], service.now())
    except (Problem, IntegrityError):
        # A full registry or an upload archiving the same release at the same moment must not stop
        # the rest of maintenance; the next tick tries again.
        pass


def run(service):
    archive_packaged_method(service)
    with service.db.transaction(scope="worker-directory") as session:
        tenants = [(row.id, row.data["origin"]) for row in cursor_page(session, "company")]
    for tenant, origin in tenants:
        with service.db.transaction(scope=origin) as session:
            maintain_tenant(service, session, get(session, "company", tenant))
    with service.db.transaction(scope="mail-budgets") as session:
        developers = set(service.operator_emails())
        for kind in (
            "otp",
            "session",
            "reauth",
            "bootstrap",
            "access",
            "refresh",
            "connection",
            "registration",
        ):
            for record in cursor_page(session, kind):
                expired = not service.alive(record.data.get("expires"))
                if kind == "registration":
                    if expired and not record.data.get("company"):
                        record.data = {**record.data, "state": "expired", "email": "", "contact": ""}
                elif kind == "connection":
                    if record.data.get("cache") and not service.alive(record.data.get("cache_expires")):
                        record.data = {**record.data, "cache": ""}
                    if expired and record.data["state"] != "consumed":
                        session.delete(record)
                elif kind == "session" and record.data.get("purpose") == "operator" and (
                    expired or record.owner not in developers
                ):
                    # A developer session lasts 7 days. Once its address is removed from the
                    # settings it is refused at once, and it is deleted here so adding the address
                    # back later does not bring an old session back.
                    session.delete(record)
                elif expired:
                    session.delete(record)
                elif record.data.get("cache") and not service.alive(record.data.get("cache_expires")):
                    record.data = {**record.data, "cache": ""}
        # Abuse buckets hold request times under a keyed hash of the IP address. The longest
        # limit window is one day, so a bucket without a request in the last day is deleted;
        # the privacy policy states this period.
        stale = service.now() - timedelta(days=1)
        for record in cursor_page(session, "rate"):
            times = record.data.get("times") or []
            if not times or max(parse_time(t) for t in times) < stale:
                session.delete(record)
        put(session, "maintenance_cursor", "worker-heartbeat", {"last_tick": instant(service.now())})


def replay_journal(service):
    from .journal import verified_entries
    from .organization_deletion import purge_step
    from .organization_deletion import replay as replay_organization

    for entry in verified_entries(service.settings.deletion_journal_path, service.secrets):
        marker = entry["marker"]
        if marker.get("scope") == "organization":
            done = True
            with service.db.transaction(scope="restore") as session:
                done = not replay_organization(service, session, entry["tenant"], marker)
            while not done:
                with service.db.transaction(scope="restore") as session:
                    done = purge_step(service, session, get(session, "company", entry["tenant"]))
            continue
        with service.db.transaction(scope="restore") as session:
            company = get(session, "company", entry["tenant"])
            if not company:
                continue
            if marker.get("retention"):
                previous = get(session, "retention", company.id, company.id)
                put(
                    session,
                    "retention",
                    company.id,
                    {"cutoff": max(marker["end"], previous.data["cutoff"] if previous else marker["end"])},
                    company.id,
                )
            else:
                marker_id = marker.get("job_id") or digest(canonical(marker))
                if not get(session, "deletion", marker_id, company.id):
                    put(session, "deletion", marker_id, marker, company.id, marker["user_id"])
                company.data = {**company.data, "epoch": max(company.data["epoch"], marker["epoch"])}
            if marker["scope"] == "user":
                member = get(session, "member", marker["user_id"], company.id)
                if member and member.data["status"] != "deleted":
                    member.data = {
                        **member.data,
                        "status": "deleted",
                        "hmac_key": "",
                        "version": member.data["version"] + 1,
                    }
                    email = session.scalar(
                        select(TABLES["email"]).where(
                            TABLES["email"].tenant == company.id, TABLES["email"].owner == member.id
                        )
                    )
                    if email:
                        email.data = {"email": ""}
            job = service.analytics.deletions.schedule_marker(session, company, marker)
            job_id = job.id
        while True:
            with service.db.transaction(scope="restore") as session:
                company = get(session, "company", entry["tenant"])
                job = get(session, "deletion_job", job_id, company.id)
                service.analytics.deletions.advance(session, company, job)
                done = job.data["status"] == "completed"
            if done:
                break
    run(service)


def purge_network_observations(service, confirm=False, page=1000):
    """
    Removes connection addresses stored while IP collection was on, for an operator who switched
    it off (owner decision of 18 October 2026). Nothing deletes them automatically while it is off.
    Without confirm it only counts the rows. With confirm it deletes every row of every
    organization in pages, so each transaction stays small, and reports how many it deleted. The
    table itself stays, so IP collection can be switched on again later.
    """
    with service.db.transaction(readonly=True) as session:
        stored = session.scalar(select(func.count()).select_from(NetworkObservation))
    if not confirm:
        return {"network_observations": stored, "deleted": 0, "mode": "count"}
    deleted = 0
    while True:
        with service.db.transaction(scope="network-observation-purge") as session:
            keys = [
                tuple(key)
                for key in session.execute(
                    select(NetworkObservation.tenant, NetworkObservation.id)
                    .order_by(NetworkObservation.tenant, NetworkObservation.id)
                    .limit(page)
                )
            ]
            if not keys:
                break
            session.execute(
                delete(NetworkObservation).where(
                    tuple_(NetworkObservation.tenant, NetworkObservation.id).in_(keys)
                )
            )
            deleted += len(keys)
    return {"network_observations": stored, "deleted": deleted, "mode": "deleted"}


def main():
    from .analytics import Analytics
    from .config import Settings
    from .mail import BrevoMail
    from .service import Service

    parser = argparse.ArgumentParser()
    parser.add_argument(
        "command", choices=["run", "serve", "health", "replay-journal", "purge-network-observations"]
    )
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="purge-network-observations only: delete the rows instead of counting them",
    )
    arguments = parser.parse_args()
    command = arguments.command
    if arguments.confirm and command != "purge-network-observations":
        parser.error("--confirm applies to purge-network-observations only")
    settings = Settings.from_environment()
    service = Service(settings, Database(settings), BrevoMail(settings))
    service.analytics = Analytics(service)
    if command == "health":
        with service.db.transaction(readonly=True) as session:
            heartbeat = get(session, "maintenance_cursor", "worker-heartbeat")
            if not heartbeat or parse_time(heartbeat.data["last_tick"]) < service.now() - timedelta(
                seconds=settings.worker_max_age_seconds
            ):
                raise SystemExit(1)
        print("ready")
    elif command == "replay-journal":
        replay_journal(service)
    elif command == "purge-network-observations":
        print(json.dumps(purge_network_observations(service, confirm=arguments.confirm)))
    elif command == "serve":
        while True:
            run(service)
            time.sleep(5)
    else:
        run(service)


if __name__ == "__main__":
    main()
