"""Resumable bounded deletion jobs. A committed scope marker precedes physical erasure."""

from sqlalchemy import delete, func, or_, select, tuple_

from . import dto
from .db import (
    TABLES,
    DeletionDeviceReceipt,
    DeletionPreviewTarget,
    DeletionScope,
    DeletionTombstone,
    Device,
    HistoryObservation,
    Member,
    NetworkObservation,
    Observation,
    RequestAttemptLink,
    get,
    put,
)
from .security import Problem, canonical, digest, instant, parse_time, token

PAGE_SIZE = 100
# What deleting one person's records removes, shown in place of counts (see preview_result).
PERSON_DELETES = {
    "user": [
        "Their requests and replies, with the estimates made for them",
        "Messages counted from their saved chats",
        "Their browser connections, sign-ins and work email address",
        "Connection addresses stored for them",
        "Organization exports that have not expired yet",
    ],
    "range": [
        "Their requests and replies in the chosen dates, with the estimates made for them",
        "Messages counted from their saved chats in the chosen dates",
        "Connection addresses stored for them",
        "Organization exports that have not expired yet",
    ],
}


class Deletions:
    def __init__(self, analytics):
        self.analytics = analytics
        self.service = analytics.service

    def change_page(self, session, company, owner, epoch):
        if epoch < 0 or epoch > company.data["epoch"]:
            raise Problem("invalid_epoch", 409)
        records = list(
            session.scalars(
                select(DeletionScope)
                .where(DeletionScope.tenant == company.id, DeletionScope.epoch > epoch)
                .order_by(DeletionScope.epoch)
                .limit(PAGE_SIZE + 1)
            )
        )
        page = records[:PAGE_SIZE]
        changes = []
        for row in page:
            if row.data["user_id"] and row.data["user_id"] != owner:
                continue
            change = {key: value for key, value in row.data.items() if key != "record_owners"}
            change["record_ids"] = [
                key
                for key in change.get("record_ids", [])
                if row.data.get("record_owners", {}).get(key) == owner
            ]
            changes.append(change)
        return {
            "changes": changes,
            "deletion_epoch": page[-1].epoch if len(records) > PAGE_SIZE else company.data["epoch"],
            "current_deletion_epoch": company.data["epoch"],
            "has_more": len(records) > PAGE_SIZE,
        }

    def scope_condition(self, company, scope):
        condition = [Observation.tenant == company.id, Observation.kind == "request"]
        if scope.get("user_id"):
            condition.append(Observation.owner == scope["user_id"])
        if scope["scope"] != "user":
            condition += [Observation.occurred_at >= scope["start"], Observation.occurred_at < scope["end"]]
        return condition

    def in_progress(self, session, company):
        from .history_matching import remembered

        cls = TABLES["deletion_job"]
        # A read memo's request reads one snapshot, so its summary and every split share an answer.
        return remembered(
            session,
            ("deletion in progress", company.id),
            lambda: session.scalar(
                select(cls.id)
                .where(cls.tenant == company.id, cls.data["status"].as_string() != "completed")
                .limit(1)
            )
            is not None,
        )

    def schedule_marker(self, session, company, marker):
        from .method_history import invalidate_erasure

        if (
            not marker.get("retention")
            or session.scalar(select(Observation.id).where(*self.scope_condition(company, marker)).limit(1))
            is not None
        ):
            invalidate_erasure(session, company)
        job_id = marker.get("job_id") or digest(canonical([company.id, marker]))
        prior = get(session, "deletion_job", job_id, company.id)
        if prior:
            return prior
        return put(
            session,
            "deletion_job",
            job_id,
            {
                "job_id": job_id,
                "status": "applying",
                "phase": "devices",
                "preview_hash": digest(job_id),
                "marker": marker,
                "deletion_epoch": marker["epoch"],
                "records_erased": 0,
                "cursor": "",
                "current_request": None,
                "active_database_verified": False,
                "protocol_kind": 0,
            },
            company.id,
        )

    def preview(self, session, company, actor, body):
        data = dto.DeleteScope.model_validate_json(canonical(body)).model_dump(mode="json")
        if (
            data["scope"] == "user"
            and not data["user_id"]
            or data["scope"] == "range"
            and (not data["start"] or not data["end"])
        ):
            raise Problem("invalid_deletion_scope", 422)
        start, end = data["start"] or "1970-01-01T00:00:00.000Z", data["end"] or instant(self.service.now())
        if parse_time(start) >= parse_time(end):
            raise Problem("invalid_deletion_scope", 422)
        if data["user_id"] and not get(session, "member", data["user_id"], company.id):
            raise Problem("not_found", 404)
        proof = token()
        row = put(
            session,
            "deletion_preview",
            digest(proof),
            {
                **data,
                "start": start,
                "end": end,
                "used": False,
                "state": "pending",
                "cursor_owner": "",
                "cursor_id": "",
                "epoch": company.data["epoch"],
                "request_count": 0,
                "record_count": 0,
                "contribution_start": None,
                "contribution_end": None,
                "expires": self.service.expires(86400),
                "proof": self.service.secrets.encrypt(proof),
            },
            company.id,
            actor.id,
        )
        self.advance_preview(session, company, row)
        return self.preview_result(row, session, company)

    def preview_result(self, row, session=None, company=None):
        # A preview that names one person says what will be deleted, not how much, unless person
        # analytics is on and everything it counts was recorded after the switch: its record counts
        # and the dates of the first and last records would show that person's usage to an
        # administrator (owner decision of 18 October 2026). The counts are still gathered, so the
        # preview becomes ready exactly as before.
        personal = bool(row.data.get("user_id"))
        shown = not personal or self.person_counts_shown(session, company, row)
        start, end = row.data["contribution_start"], row.data["contribution_end"]
        counts = {
            "request_count": str(row.data["request_count"]),
            "record_count": str(row.data["record_count"]),
            "historical_message_count": str(row.data.get("historical_message_count", 0)),
            "undated_historical_message_count": str(row.data.get("undated_historical_message_count", 0)),
            "contribution_date_range": {"start": start, "end": end},
            "contribution_dates": list(dict.fromkeys(value[:10] for value in (start, end) if value)),
        }
        if not shown:
            counts = {key: None for key in counts} | {
                "contribution_date_range": {"start": None, "end": None},
                "contribution_dates": [],
            }
        return {
            "preview_id": row.id,
            "preview_token": self.service.secrets.decrypt(row.data["proof"]),
            "state": row.data["state"],
            "expires_at": row.data["expires"],
            "scope": row.data["scope"],
            "deletes": None if shown else PERSON_DELETES[row.data["scope"]],
            **counts,
            "counts_complete": row.data["state"] == "ready",
            "counts_shown": shown,
            "range_start": row.data["start"],
            "range_end": row.data["end"],
            "status_path": "/v1/admin/deletions/previews/" + row.id,
            "local_erasure": "Offline installations receive erasure instructions when they reconnect. Downloaded exports cannot be remotely erased.",
        }

    def person_counts_shown(self, session, company, row):
        """
        Whether a preview for one person may show its counts: only while person analytics is on,
        and only when none of the records it counts (live or saved, or saved without a date) was
        recorded before the switch, so the counts reveal nothing from the time it was off.
        """
        if session is None or not self.service.settings.person_analytics_enabled:
            return False
        from .historical_usage import recorded_before, scope_conditions

        floor = self.analytics.person_floor(session, company)[0]
        if row.data["contribution_start"] and row.data["contribution_start"] < floor:
            return False
        earlier = session.scalar(
            select(func.count())
            .select_from(HistoryObservation)
            .where(*scope_conditions(company, row.data), recorded_before(floor))
        )
        return not earlier

    def advance_preview(self, session, company, row):
        if row.data["state"] != "pending":
            return
        if not self.service.alive(row.data["expires"]):
            row.data = {**row.data, "state": "expired"}
            return
        from .historical_usage import scope_conditions

        history_count = session.scalar(
            select(func.count()).select_from(HistoryObservation).where(*scope_conditions(company, row.data))
        )
        undated_count = session.scalar(
            select(func.count())
            .select_from(HistoryObservation)
            .where(*scope_conditions(company, row.data), HistoryObservation.occurred_at.is_(None))
        )
        row.data = {
            **row.data,
            "historical_message_count": history_count,
            "undated_historical_message_count": undated_count,
        }
        targets = list(
            session.scalars(
                select(Observation)
                .where(
                    *self.scope_condition(company, row.data),
                    tuple_(Observation.owner, Observation.id)
                    > (row.data["cursor_owner"], row.data["cursor_id"]),
                )
                .order_by(Observation.owner, Observation.id)
                .limit(PAGE_SIZE)
            )
        )
        pairs = [(record.owner, record.id) for record in targets]
        child_count, child_start, child_end = session.execute(
            select(func.count(), func.min(Observation.occurred_at), func.max(Observation.occurred_at)).where(
                Observation.tenant == company.id,
                Observation.kind == "attempt",
                tuple_(Observation.owner, Observation.parent).in_(pairs),
            )
        ).one()
        for record in targets:
            session.add(
                DeletionPreviewTarget(
                    tenant=company.id, preview_id=row.id, owner=record.owner, request_id=record.id
                )
            )
        dates = [
            value
            for value in [
                row.data["contribution_start"],
                row.data["contribution_end"],
                child_start,
                child_end,
                *(r.occurred_at for r in targets),
            ]
            if value
        ]
        row.data = {
            **row.data,
            "request_count": row.data["request_count"] + len(targets),
            "record_count": row.data["record_count"] + len(targets) + child_count,
            "cursor_owner": targets[-1].owner if targets else row.data["cursor_owner"],
            "cursor_id": targets[-1].id if targets else row.data["cursor_id"],
            "contribution_start": min(dates) if dates else None,
            "contribution_end": max(dates) if dates else None,
            "state": "ready" if len(targets) < PAGE_SIZE else "pending",
            "expires": self.service.expires(300) if len(targets) < PAGE_SIZE else row.data["expires"],
        }

    def execute(self, session, company, actor, body):
        if company.data.get("aggregate_status") == "rebuilding":
            raise Problem("aggregate_rebuilding", 409, True)
        data = dto.DeleteExecute.model_validate_json(canonical(body)).model_dump(mode="json")
        from uuid import NAMESPACE_URL, uuid5

        job_id = str(
            uuid5(NAMESPACE_URL, canonical(["deletion", company.id, actor.id, data["idempotency_key"]]))
        )
        prior = get(session, "deletion_job", job_id, company.id)
        if prior:
            if prior.owner != actor.id or prior.data["preview_hash"] != digest(data["preview_token"]):
                raise Problem("idempotency_conflict", 409)
            return self.job_result(session, company, prior)
        preview = get(session, "deletion_preview", digest(data["preview_token"]), company.id)
        if (
            not preview
            or preview.owner != actor.id
            or preview.data["used"]
            or preview.data["state"] != "ready"
            or not self.service.alive(preview.data["expires"])
            or preview.data["epoch"] != company.data["epoch"]
        ):
            raise Problem(
                "deletion_preview_expired"
                if not preview or preview.data.get("state") != "pending"
                else "deletion_preview_pending",
                409,
            )
        self.service.reauth(session, company, actor, data["reauth_token"])
        target = (
            get(session, "member", preview.data["user_id"], company.id)
            if preview.data["scope"] == "user"
            else None
        )
        admins = session.scalar(
            select(func.count())
            .select_from(Member)
            .where(Member.tenant == company.id, Member.role == "admin", Member.status == "active")
        )
        if target and target.data["role"] == "admin" and admins <= 1:
            raise Problem("last_admin", 409)
        epoch = company.data["epoch"] + 1
        marker = {key: preview.data[key] for key in ("scope", "user_id", "start", "end")}
        marker.update(
            epoch=epoch,
            created_at=instant(self.service.now()),
            record_ids=[],
            record_owners={},
            job_id=job_id,
        )
        self.analytics.journal(company.id, marker)
        put(session, "deletion", job_id, marker, company.id, marker["user_id"])
        company.data = {**company.data, "epoch": epoch}
        if target:
            # This current-status check invalidates every session/token/connection immediately, before cleanup pages.
            target.data = {
                **target.data,
                "status": "deleted",
                "hmac_key": "",
                "version": target.data["version"] + 1,
            }
            identity = session.scalar(
                select(TABLES["email"]).where(
                    TABLES["email"].tenant == company.id, TABLES["email"].owner == target.id
                )
            )
            if identity:
                identity.data = {"email": ""}
        from .method_history import invalidate_erasure

        invalidate_erasure(session, company)
        # Decided before anything is erased, as the preview decided it (preview_result).
        counts_shown = not marker["user_id"] or self.person_counts_shown(session, company, preview)
        preview.data = {**preview.data, "used": True}
        job = put(
            session,
            "deletion_job",
            job_id,
            {
                "job_id": job_id,
                "operation_id": data["idempotency_key"],
                "status": "applying",
                "phase": "devices",
                "preview_hash": preview.id,
                "marker": marker,
                "deletion_epoch": epoch,
                "records_erased": 0,
                "cursor": "",
                "current_request": None,
                "active_database_verified": False,
                "protocol_kind": 0,
                "counts_shown": counts_shown,
            },
            company.id,
            actor.id,
        )
        self.service.audit(session, company.id, actor.id, "usage_erasure_started", job.id, {"epoch": epoch})
        self.advance(session, company, job)
        return self.job_result(session, company, job)

    def _tombstone(self, session, company, record, epoch, retention=False):
        key = (company.id, record.owner, record.kind, record.id)
        if not session.get(DeletionTombstone, key):
            session.add(
                DeletionTombstone(
                    tenant=company.id,
                    owner=record.owner,
                    kind=record.kind,
                    record_id=record.id,
                    epoch=epoch,
                    stable_key=record.payload.get("provider_request_key" if record.kind == "request" else "provider_attempt_key"),
                    reason="retention" if retention else "explicit",
                )
            )

    def _erase_record(self, session, company, record, epoch, budget=PAGE_SIZE, retention=False):
        from .method_history import erase_current_original, erase_record, select_records

        units = erase_record(session, record, budget)
        if units:
            return False, units
        # Historical revisions can outnumber canonical records by orders of magnitude.
        # Drain indexed history pages before removing their canonical contribution.
        for kind in ("revision", "receipt"):
            cls = TABLES[kind]
            ids = list(
                session.scalars(
                    select(cls.id)
                    .where(
                        cls.tenant == company.id,
                        cls.owner == record.owner,
                        cls.record_kind == record.kind,
                        cls.record_id == record.id,
                    )
                    .order_by(cls.id)
                    .limit(budget)
                )
            )
            if ids:
                session.execute(
                    delete(cls).where(cls.tenant == company.id, cls.owner == record.owner, cls.id.in_(ids))
                )
                return False, len(ids)
        condition = [
            RequestAttemptLink.tenant == company.id,
            RequestAttemptLink.owner == record.owner,
            (RequestAttemptLink.attempt_id == record.id)
            if record.kind == "attempt"
            else (RequestAttemptLink.request_id == record.id),
        ]
        links = list(
            session.execute(
                select(RequestAttemptLink.request_id, RequestAttemptLink.attempt_id)
                .where(*condition)
                .order_by(RequestAttemptLink.request_id, RequestAttemptLink.attempt_id)
                .limit(budget)
            )
        )
        if links:
            session.execute(
                delete(RequestAttemptLink).where(
                    *condition,
                    tuple_(RequestAttemptLink.request_id, RequestAttemptLink.attempt_id).in_(links),
                )
            )
            return False, len(links)
        self._tombstone(session, company, record, epoch, retention)
        self.analytics.contribution_delta(
            session,
            company,
            get(session, "member", record.owner, company.id),
            next(select_records(session, [record])),
            -1,
        )
        key = record.company_key
        erase_current_original(session, record)
        session.delete(record)
        session.flush()
        # Another member's copy of an erased prompt or reply counts from now on (W11).
        self.analytics.company.elect(session, company, key)
        return True, 1

    def owners_condition(self, company, job, owner_column):
        marker = job.data["marker"]
        if marker["user_id"]:
            return owner_column == marker["user_id"]
        return or_(
            owner_column.in_(
                select(DeletionDeviceReceipt.owner).where(
                    DeletionDeviceReceipt.tenant == company.id, DeletionDeviceReceipt.job_id == job.id
                )
            ),
            owner_column.in_(
                select(DeletionPreviewTarget.owner).where(
                    DeletionPreviewTarget.tenant == company.id,
                    DeletionPreviewTarget.preview_id == job.data["preview_hash"],
                )
            ),
        )

    def advance(self, session, company, job, budget=PAGE_SIZE):
        if job.data["status"] == "completed":
            return
        processed = 0
        marker = job.data["marker"]
        while processed < budget:
            phase = job.data["phase"]
            if phase == "devices":
                owners = select(Observation.owner).where(*self.scope_condition(company, marker))
                if not marker.get("retention"):
                    from .historical_usage import scope_conditions

                    owners = owners.union(
                        select(HistoryObservation.owner).where(*scope_conditions(company, marker))
                    )
                condition = (
                    Device.owner == marker["user_id"]
                    if marker["scope"] == "user"
                    else Device.owner.in_(owners)
                )
                devices = list(
                    session.scalars(
                        select(Device)
                        .where(Device.tenant == company.id, condition, Device.id > job.data["cursor"])
                        .order_by(Device.id)
                        .limit(budget - processed)
                    )
                )
                for device in devices:
                    key = (company.id, job.id, device.id)
                    if not session.get(DeletionDeviceReceipt, key):
                        session.add(
                            DeletionDeviceReceipt(
                                tenant=company.id,
                                job_id=job.id,
                                device_id=device.id,
                                owner=device.owner,
                                epoch=job.data["deletion_epoch"],
                            )
                        )
                processed += len(devices)
                job.data = {
                    **job.data,
                    "cursor": devices[-1].id if devices else "",
                    "phase": "devices" if devices else "records",
                }
                continue
            if phase == "records":
                current = job.data["current_request"]
                request = (
                    session.get(Observation, (company.id, current[0], "request", current[1]))
                    if current
                    else session.scalar(
                        select(Observation)
                        .where(*self.scope_condition(company, marker))
                        .order_by(Observation.owner, Observation.id)
                        .limit(1)
                    )
                )
                if not request:
                    if current:
                        job.data = {**job.data, "current_request": None}
                        continue
                    job.data = {**job.data, "phase": "history", "cursor": "", "current_request": None}
                    continue
                if not current:
                    job.data = {**job.data, "current_request": [request.owner, request.id]}
                    if not session.get(
                        DeletionPreviewTarget,
                        (company.id, job.data["preview_hash"], request.owner, request.id),
                    ):
                        session.add(
                            DeletionPreviewTarget(
                                tenant=company.id,
                                preview_id=job.data["preview_hash"],
                                owner=request.owner,
                                request_id=request.id,
                            )
                        )
                child = session.scalar(
                    select(Observation)
                    .where(
                        Observation.tenant == company.id,
                        Observation.owner == request.owner,
                        Observation.kind == "attempt",
                        Observation.parent == request.id,
                    )
                    .order_by(Observation.id)
                    .limit(1)
                )
                removed, units = self._erase_record(
                    session,
                    company,
                    child or request,
                    job.data["deletion_epoch"],
                    budget - processed,
                    marker.get("retention", False),
                )
                processed += units
                if removed:
                    job.data = {
                        **job.data,
                        "records_erased": job.data["records_erased"] + 1,
                        "current_request": None if child is None else job.data["current_request"],
                    }
                continue
            if phase == "history":
                count = self.analytics.history.erase_page(session, company, marker, budget - processed)
                processed += count
                job.data = {
                    **job.data,
                    "records_erased": job.data["records_erased"] + count,
                    "historical_records_erased": job.data.get("historical_records_erased", 0) + count,
                }
                if not count:
                    job.data = {**job.data, "phase": "network"}
                continue
            if phase == "network":
                records = list(
                    session.scalars(
                        select(NetworkObservation)
                        .where(
                            NetworkObservation.tenant == company.id,
                            self.owners_condition(company, job, NetworkObservation.owner),
                        )
                        .order_by(NetworkObservation.id)
                        .limit(budget - processed)
                    )
                )
                for record in records:
                    session.delete(record)
                processed += len(records)
                if not records:
                    job.data = {**job.data, "phase": "exports"}
                continue
            if phase == "exports":
                cls = TABLES["export"]
                records = list(
                    session.scalars(
                        select(cls).where(cls.tenant == company.id).order_by(cls.id).limit(budget - processed)
                    )
                )
                for record in records:
                    if processed >= budget:
                        break
                    units, _ = self.analytics.exports.delete_page(session, record, budget - processed)
                    processed += units
                if not records:
                    job.data = {**job.data, "phase": "protocol" if marker["scope"] == "user" else "targets"}
                continue
            if phase == "protocol":
                kinds = (
                    "device",
                    "session",
                    "connection",
                    "bootstrap",
                    "reauth",
                    "policy_receipt",
                    "access",
                    "refresh",
                    "family",
                )
                index = job.data["protocol_kind"]
                if index == len(kinds):
                    job.data = {**job.data, "phase": "targets", "cursor": ""}
                    continue
                kind = kinds[index]
                cls = TABLES[kind]
                records = list(
                    session.scalars(
                        select(cls)
                        .where(
                            cls.tenant == company.id,
                            cls.owner == marker["user_id"],
                            cls.id > job.data["cursor"],
                        )
                        .order_by(cls.id)
                        .limit(budget - processed)
                    )
                )
                for record in records:
                    if kind == "device":
                        record.data = {**record.data, "status": "deleted", "reconnect": ""}
                    elif kind in {"family", "access", "refresh", "policy_receipt"}:
                        if kind == "family":
                            record.data = {**record.data, "revoked": True}
                        # Scope credentials are already unusable through the deleted membership; normal TTL cleanup removes rows safely.
                    else:
                        session.delete(record)
                processed += len(records)
                job.data = {
                    **job.data,
                    "cursor": records[-1].id if records else "",
                    "protocol_kind": index if records else index + 1,
                }
                continue
            if phase == "targets":
                records = list(
                    session.scalars(
                        select(DeletionPreviewTarget)
                        .where(
                            DeletionPreviewTarget.tenant == company.id,
                            DeletionPreviewTarget.preview_id == job.data["preview_hash"],
                        )
                        .order_by(DeletionPreviewTarget.owner, DeletionPreviewTarget.request_id)
                        .limit(budget - processed)
                    )
                )
                for record in records:
                    key = (company.id, record.owner, "request", record.request_id)
                    if not session.get(DeletionTombstone, key):
                        session.add(
                            DeletionTombstone(
                                tenant=company.id,
                                owner=record.owner,
                                kind="request",
                                record_id=record.request_id,
                                epoch=job.data["deletion_epoch"],
                            )
                        )
                    session.delete(record)
                processed += len(records)
                if not records:
                    remaining = session.scalar(
                        select(func.count())
                        .select_from(Observation)
                        .where(*self.scope_condition(company, marker))
                    )
                    if remaining:
                        job.data = {**job.data, "phase": "records", "current_request": None}
                        continue
                    if self.analytics.history.remaining(session, company, marker):
                        job.data = {**job.data, "phase": "history"}
                        continue
                    job.data = {
                        **job.data,
                        "status": "completed",
                        "phase": "completed",
                        "active_database_verified": True,
                    }
                    self.service.audit(
                        session,
                        company.id,
                        job.owner or "system",
                        "usage_erasure_completed",
                        job.id,
                        {"epoch": job.data["deletion_epoch"]},
                    )
                    break
            session.flush()
        session.flush()

    def job_result(self, session, company, job):
        receipt = TABLES["deletion_receipt"]
        conditions = [DeletionDeviceReceipt.tenant == company.id, DeletionDeviceReceipt.job_id == job.id]
        total = session.scalar(select(func.count()).select_from(DeletionDeviceReceipt).where(*conditions))
        acknowledged = session.scalar(
            select(func.count())
            .select_from(DeletionDeviceReceipt)
            .join(
                receipt,
                (receipt.tenant == DeletionDeviceReceipt.tenant)
                & (receipt.id == DeletionDeviceReceipt.device_id),
            )
            .where(*conditions, receipt.data["ack_epoch"].as_integer() >= job.data["deletion_epoch"])
        )
        # Deleting one person's records reports progress without counting them, unless its preview
        # showed the counts (person analytics on and nothing recorded before the switch).
        counted = not job.data["marker"].get("user_id") or (
            job.data.get("counts_shown") is True and self.service.settings.person_analytics_enabled
        )
        return {
            key: job.data[key]
            for key in (
                "job_id",
                "status",
                "phase",
                "deletion_epoch",
                "active_database_verified",
            )
        } | {
            "records_erased": job.data["records_erased"] if counted else None,
            "device_acknowledgement_complete": acknowledged == total,
            "device_receipts": {
                "total": total,
                "acknowledged": acknowledged,
                "pending": total - acknowledged,
            },
            "offline_devices": "Erasure is delivered on reconnection. Completion of database work does not mean offline storage has been physically wiped.",
        }
