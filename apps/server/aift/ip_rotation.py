"""Scoped IP key rotation. Keys are read only from protected deployment settings."""

import argparse
import hashlib
import hmac
import json
from datetime import UTC, datetime
from types import SimpleNamespace

from sqlalchemy import func, or_, select

from .db import TABLES, NetworkObservation, get, put
from .security import Problem, Secrets, digest, instant, parse_time

PAGE_SIZE = 100
REGISTRY_ID = digest("aift:ip-keyring:v1")


def version_column():
    return func.coalesce(NetworkObservation.data["key_version"].as_string(), "1")


def retained_material():
    return or_(
        NetworkObservation.equality.is_not(None), NetworkObservation.data["address"].as_string().is_not(None)
    )


def fingerprint(secrets, version):
    return hmac.new(secrets.ip_material(version), b"aift-ip-key-identity-v1", hashlib.sha256).hexdigest()


def job_id(tenant):
    return digest("aift:ip-rotation:v1:" + tenant)


def initialize(service):
    """Pin key identities and refuse missing keys needed by live data or the restore policy."""
    with service.db.transaction(scope="ip-keyring") as session:
        registry = get(session, "maintenance_cursor", REGISTRY_ID)
        data = (
            registry.data
            if registry
            else {"active_version": service.secrets.active_ip_key_version, "versions": {}}
        )
        versions = dict(data["versions"])
        present = list(
            session.scalars(select(version_column()).where(retained_material()).distinct().limit(129))
        )
        if len(present) > 128 or len(versions) > 128:
            raise Problem("ip_key_registry_limit", 503)
        for version in present:
            service.secrets.ip_material(version)
            sample = session.scalar(
                select(NetworkObservation).where(version_column() == version, retained_material()).limit(1)
            )
            if sample:
                service.secrets.decrypt_ip(sample.data["address"], version)
        for version, record in versions.items():
            if version not in service.secrets.ip_keys:
                if version == data["active_version"] or version in present:
                    raise Problem("ip_key_unavailable", 503)
                if not record.get("restore_until") or parse_time(record["restore_until"]) > service.now():
                    raise Problem("ip_key_required_for_restore", 503)
        for version in service.secrets.ip_keys:
            identity = fingerprint(service.secrets, version)
            previous = versions.get(version)
            if previous and not hmac.compare_digest(previous["fingerprint"], identity):
                raise Problem("ip_key_version_conflict", 503)
            horizon = service.settings.ip_restore_required_until.get(version)
            if horizon:
                horizon = instant(parse_time(horizon).astimezone(UTC))
            previous_horizon = previous.get("restore_until") if previous else None
            versions[version] = {
                "fingerprint": identity,
                "restore_until": max(filter(None, [previous_horizon, horizon]), default=None),
            }
        put(session, "maintenance_cursor", REGISTRY_ID, {**data, "versions": versions})


def check_known_keys(session, secrets, versions):
    registry = get(session, "maintenance_cursor", REGISTRY_ID)
    if not registry:
        raise Problem("ip_key_registry_missing", 503)
    for version in versions:
        expected = registry.data["versions"].get(version)
        if not expected or not hmac.compare_digest(expected["fingerprint"], fingerprint(secrets, version)):
            raise Problem("ip_key_version_conflict", 503)
    return registry


def check_write_key(session, service):
    # PostgreSQL readers share this lock; activation waits until all old-version writes commit.
    cls = TABLES["maintenance_cursor"]
    session.scalar(
        select(cls)
        .where(cls.id == REGISTRY_ID)
        .with_for_update(read=True)
        .execution_options(populate_existing=True)
    )
    registry = check_known_keys(session, service.secrets, [service.secrets.active_ip_key_version])
    if registry.data["active_version"] != service.secrets.active_ip_key_version:
        raise Problem("ip_key_activation_required", 503)


def distinct_coverage(session, secrets, conditions):
    versions = list(
        session.scalars(
            select(version_column())
            .where(*conditions, NetworkObservation.equality.is_not(None))
            .distinct()
            .limit(129)
        )
    )
    check_known_keys(session, secrets, versions)
    if len(versions) > 1:
        return {
            "distinct_ips": None,
            "distinct_ip_status": "key_rotation_pending",
            "key_versions": sorted(versions),
        }
    count = session.scalar(select(func.count(func.distinct(NetworkObservation.equality))).where(*conditions))
    return {"distinct_ips": str(count), "distinct_ip_status": "current", "key_versions": versions}


def plan(service, session, company):
    target = service.secrets.active_ip_key_version
    registry = get(session, "maintenance_cursor", REGISTRY_ID)
    if registry and target in registry.data["versions"]:
        check_known_keys(session, service.secrets, [target])
    else:
        service.secrets.ip_material(target)
    counts = session.execute(
        select(version_column(), func.count())
        .where(NetworkObservation.tenant == company.id, retained_material())
        .group_by(version_column())
    ).all()
    check_known_keys(session, service.secrets, [version for version, _ in counts])
    row = get(session, "maintenance_cursor", job_id(company.id), company.id)
    return {
        "tenant_id": company.id,
        "target_key_version": target,
        "active_write_version": registry.data["active_version"] if registry else None,
        "write_key_activation_scope": "configured_application",
        "migration_scope": "selected_tenant",
        "pending_rows": sum(count for version, count in counts if version != target),
        "versions": [{"key_version": version, "rows": count} for version, count in counts],
        "page_limit": PAGE_SIZE,
        "job": row.data if row else None,
        "mode": "plan",
        "keys_in_output": False,
    }


def start(service, company_id):
    """Explicit activation serializes with key registration; data pages use tenant locks."""
    with service.db.transaction(scope="ip-keyring") as session:
        company = get(session, "company", company_id)
        if not company:
            raise Problem("not_found", 404)
        target = service.secrets.active_ip_key_version
        registry = check_known_keys(session, service.secrets, [target])
        if int(target) < int(registry.data["active_version"]):
            raise Problem("ip_rotation_rollback_prohibited", 409)
        registry.data = {**registry.data, "active_version": target}
        origin = company.data["origin"]
    with service.db.transaction(scope=origin) as session:
        company = get(session, "company", company_id)
        if service.analytics.deletions.in_progress(session, company):
            raise Problem("deletion_in_progress", 409, True)
        row = get(session, "maintenance_cursor", job_id(company.id), company.id)
        if not row or row.data["target_key_version"] != target:
            row = put(
                session,
                "maintenance_cursor",
                job_id(company.id),
                {
                    "target_key_version": target,
                    "status": "pending",
                    "processed_rows": 0,
                    "started_at": instant(service.now()),
                    "completed_at": None,
                    "error_code": None,
                },
                company.id,
            )
        return plan(service, session, company)


def advance_tenant(service, session, company, budget=PAGE_SIZE):
    if not 1 <= budget <= PAGE_SIZE:
        raise ValueError("invalid_work_budget")
    job = get(session, "maintenance_cursor", job_id(company.id), company.id)
    if not job or service.analytics.deletions.in_progress(session, company):
        return
    try:
        with session.begin_nested():
            target = job.data["target_key_version"]
            check_write_key(session, service)
            if target != service.secrets.active_ip_key_version:
                raise Problem("ip_rotation_target_changed", 409)
            records = list(
                session.scalars(
                    select(NetworkObservation)
                    .where(
                        NetworkObservation.tenant == company.id,
                        retained_material(),
                        version_column() != target,
                    )
                    .order_by(NetworkObservation.id)
                    .limit(budget)
                )
            )
            check_known_keys(
                session, service.secrets, [record.data.get("key_version", "1") for record in records]
            )
            for record in records:
                version = record.data.get("key_version", "1")
                address = service.secrets.decrypt_ip(record.data["address"], version)
                expected = service.secrets.keyed("ip:" + company.id, address, ip=True, key_version=version)
                if not isinstance(record.equality, str) or not hmac.compare_digest(expected, record.equality):
                    raise Problem("ip_equality_integrity_failed", 503)
                record.data = {
                    **record.data,
                    "address": service.secrets.encrypt_ip(address, target),
                    "equality": service.secrets.keyed(
                        "ip:" + company.id, address, ip=True, key_version=target
                    ),
                    "key_version": target,
                }
            session.flush()
            pending = session.scalar(
                select(NetworkObservation.id)
                .where(
                    NetworkObservation.tenant == company.id, retained_material(), version_column() != target
                )
                .limit(1)
            )
            job.data = {
                **job.data,
                "status": "pending" if pending else "completed",
                "processed_rows": job.data["processed_rows"] + len(records),
                "error_code": None,
                "completed_at": None if pending else instant(service.now()),
            }
    except (Problem, ValueError, RuntimeError) as error:
        job.data = {
            **job.data,
            "status": "failed",
            "error_code": error.code if isinstance(error, Problem) else "ip_rotation_failed",
        }


def retirement_check(service, session, version):
    registry = get(session, "maintenance_cursor", REGISTRY_ID)
    if not registry or version not in registry.data["versions"]:
        raise Problem("ip_key_unavailable", 409)
    if registry.data["active_version"] == version:
        raise Problem("ip_key_active", 409)
    if session.scalar(
        select(NetworkObservation.id).where(version_column() == version, retained_material()).limit(1)
    ):
        raise Problem("ip_key_required_for_rows", 409)
    horizon = registry.data["versions"][version].get("restore_until")
    if not horizon or parse_time(horizon) > service.now():
        raise Problem("ip_key_required_for_restore", 409)
    return {
        "key_version": version,
        "retirement_allowed": True,
        "restore_required_until": horizon,
        "configuration_changed": False,
    }


def run_cli():
    from .analytics import Analytics
    from .config import Settings
    from .db import Database

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tenant", required=True, help="Configured application tenant ID")
    parser.add_argument(
        "--execute", action="store_true", help="Explicitly activate the configured key and process one page"
    )
    parser.add_argument("--retirement-check", metavar="KEY_VERSION")
    args = parser.parse_args()
    if args.execute and args.retirement_check:
        parser.error("Retirement checks are read-only; do not combine with --execute")
    settings = Settings.from_environment()
    settings.validate()
    if not settings.ip_collection_enabled:
        # Without IP collection there is no keyring to rotate to; stored rows are removed with
        # python -m aift.maintenance purge-network-observations instead.
        print(json.dumps({"error_code": "ip_collection_disabled", "configuration_changed": False}))
        raise SystemExit(1)
    service = SimpleNamespace(
        settings=settings, db=Database(settings), secrets=Secrets(settings), now=lambda: datetime.now(UTC)
    )
    service.analytics = Analytics(service)
    try:
        if args.execute:
            initialize(service)
            start(service, args.tenant)
        with service.db.transaction(readonly=True) as session:
            company = get(session, "company", args.tenant)
            if not company:
                raise Problem("not_found", 404)
            origin = company.data["origin"]
            result = (
                retirement_check(service, session, args.retirement_check)
                if args.retirement_check
                else plan(service, session, company)
            )
        if args.execute and not args.retirement_check:
            with service.db.transaction(scope=origin) as session:
                company = get(session, "company", args.tenant)
                advance_tenant(service, session, company)
                result = {**plan(service, session, company), "mode": "execute"}
        print(json.dumps(result))
    except Problem as error:
        print(json.dumps({"error_code": error.code, "configuration_changed": False}))
        raise SystemExit(1) from None


def main():
    try:
        run_cli()
    except Exception:
        # Configuration and driver errors may contain secrets. Emit a fixed code, never their text.
        print(json.dumps({"error_code": "ip_rotation_unavailable"}))
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
