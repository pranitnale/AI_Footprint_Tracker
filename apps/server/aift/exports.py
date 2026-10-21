"""Bounded encrypted exports with explicit provenance and current-role download checks."""

import csv
import hashlib
import io
from uuid import uuid4

from sqlalchemy import and_, delete, or_, select, tuple_
from sqlalchemy.orm import aliased

from .db import TABLES, HistoryObservation, Observation, get, put
from .dto import ExportRequest
from .engine_adapter import history_metrics, projection
from .engine_history import selected_history
from .method_history import select_records
from .security import Problem, canonical, instant, uid

PAGE_SIZE = 100
ENGINE_FIELDS = [
    "requested_engine_id",
    "requested_method_id",
    "requested_method_hash",
    "effective_engine_id",
    "effective_method_id",
    "effective_method_hash",
    "source_version",
    "source_commit",
    "catalog_hash",
    "profile_policy_hash",
    "environment_policy_hash",
    "original_method_hash",
    "selection_kind",
    "selected_profile_provider",
    "selected_profile_model_name",
    "selected_profile_workload",
    "requested_method_json",
    "effective_method_json",
    "selection_json",
    "comparability_json",
]
SUMMARY_FIELDS = [
    "quantity",
    "reference_only",
    "additive",
    "value",
    "unit",
    "scope",
    "time_basis",
    "calculation_view",
    "method_id",
    "method_hash",
    "cohort_id",
    "cohort_hash",
    "eligible_candidate_count",
    "eligible_candidate_signature",
    "environment_scenario_id",
    "selected_profile_id",
    "profile_selection",
    "starting_energy_boundary",
    "result_scope",
    "measurement_group",
    "reason_counts",
    "missing_counts",
    "contributing_component_count",
    "contributing_attempt_count",
    "applicable_count",
    "unknown_count",
    "partial_count",
    "unvalidated_count",
    "range_start",
    "range_end",
    "timezone",
    "generated_at",
    "expires_at",
    "policy_version",
    "deletion_epoch",
    "phase",
    "scenario_low",
    "scenario_high",
    "interval_kind",
    "value_kind",
    "known_message_count",
    "unknown_message_count",
    *ENGINE_FIELDS,
]
RECORD_FIELDS = [
    "user_id",
    "record_kind",
    "record_id",
    "parent_request_id",
    "observation_revision",
    "payload_hash",
    "occurred_at",
    "date_basis",
    "observed_at",
    "time_basis",
    "calculation_view",
    "method_id",
    "method_hash",
    "environment_scenario_id",
    "selected_profile_id",
    "estimate_status",
    "observation_json",
    "estimate_json",
    "original_observation_json",
    "original_estimate_json",
    "range_start",
    "range_end",
    "timezone",
    "generated_at",
    "expires_at",
    "result_schema_version",
    "result_status",
    "execution_origin",
    "metrics_json",
    "image_references_json",
    *ENGINE_FIELDS,
]


def csv_text(fields, rows, include_header=True):
    stream = io.StringIO()
    writer = csv.writer(stream)
    if include_header:
        writer.writerow(fields)
    for row in rows:
        values = []
        for key in fields:
            value = row.get(key)
            value = (
                "" if value is None else canonical(value) if isinstance(value, (dict, list)) else str(value)
            )
            if value.startswith(("=", "+", "-", "@", "\t", "\r")):
                value = "'" + value
            values.append(value)
        writer.writerow(values)
    return stream.getvalue()


def engine_fields(estimate):
    requested, effective = estimate.get("requested_method"), estimate.get("effective_method")
    if requested is None:
        if not estimate.get("method_id"):
            return {}
        # Archived results identify the original engine without inventing source metadata.
        return {
            **{
                f"{side}_{field}": "original" if field == "engine_id" else estimate.get(field)
                for side in ("requested", "effective")
                for field in ("engine_id", "method_id", "method_hash")
            },
            "original_method_hash": estimate.get("original_method_hash"),
        }
    selection = estimate.get("selection") or {}
    profile = selection.get("profile") or {}
    return {
        **{f"requested_{key}": requested[key] for key in ("engine_id", "method_id", "method_hash")},
        **{f"effective_{key}": effective[key] for key in ("engine_id", "method_id", "method_hash")},
        **{
            key: effective.get(key)
            for key in (
                "source_version",
                "source_commit",
                "catalog_hash",
                "profile_policy_hash",
                "environment_policy_hash",
            )
        },
        "original_method_hash": estimate.get("original_method_hash"),
        "selection_kind": selection.get("kind") or estimate.get("profile_selection"),
        "selected_profile_provider": profile.get("provider"),
        "selected_profile_model_name": profile.get("model_name"),
        "selected_profile_workload": profile.get("workload"),
        "requested_method_json": requested,
        "effective_method_json": effective,
        "selection_json": selection or None,
        "comparability_json": estimate.get("comparability"),
    }


def series_fields(series):
    value = {**series.get("method_group", {}), **series}
    if value.get("requested_method") and "phase" not in value:
        value["phase"] = "usage"
    return {**value, **engine_fields(value)}


def estimate_fields(result):
    if not result:
        return {}
    if isinstance(result, list):
        display = result[0]
        metrics = {metric["quantity"]: metric for metric in history_metrics(result)}
    else:
        display = projection(result)
        metrics = display.get("metrics")
    return {
        **{
            key: display[key]
            for key in ("method_id", "method_hash", "environment_scenario_id", "selected_profile_id")
            if key in display
        },
        **engine_fields(display),
        "result_schema_version": display.get("schema_version"),
        "result_status": display.get("status"),
        "execution_origin": display.get("execution_origin"),
        "metrics_json": metrics,
        "image_references_json": display.get("image_references"),
    }


class Exports:
    def __init__(self, analytics):
        self.analytics, self.service = analytics, analytics.service

    def create(self, session, company, actor, body):
        options = ExportRequest.model_validate_json(canonical(body)).model_dump(
            mode="json", exclude_none=True
        )
        per_person = options["report"] == "records" or bool(options.get("user_id"))
        # The record report names a person on every row, and a person filter makes the whole file
        # one person's; both exist only while person analytics is on (owner decision of 18 October
        # 2026). The organization summary is available in both settings.
        if per_person and not self.service.settings.person_analytics_enabled:
            raise Problem("person_analytics_disabled", 400)
        operation, request_hash, prior = self.service.admin_operation(
            session, company, actor, "export", options
        )
        if prior:
            return prior
        filters = {
            key: value
            for key, value in options.items()
            if key in {"period", "start", "end", "site", "model", "user_id"}
        }
        view = self.analytics.methods.prepare_view(
            session,
            company,
            actor,
            {
                **filters,
                "calculation_view": options["calculation_view"],
                **({"method_id": options["method_id"]} if options.get("method_id") else {}),
            },
        )
        start, end = self.analytics.bounds(company, filters)
        if (
            self.analytics.deletions.in_progress(session, company)
            or company.data.get("aggregate_status") == "rebuilding"
        ):
            raise Problem("aggregate_rebuilding", 409, True)
        # Administrator sessions last 7 days, so taking everyone's usage out of the service needs a
        # fresh email code and cannot be done from a session left open on another computer.
        self.service.reauth(session, company, actor, options["reauth_token"])
        self.service.rate(session, "exports:" + actor.id, 10, 3600)
        job_id = uid()
        metadata = {
            **view,
            "report": options["report"],
            "calculation_view": options["calculation_view"],
            "range_start": start,
            "range_end": end,
            "timezone": company.data["timezone"],
            "generated_at": instant(self.service.now()),
            "expires_at": self.service.expires(86400),
            "policy_version": company.data["policy_version"],
            "deletion_epoch": company.data["epoch"],
            "time_basis": {"requests": "dispatch", "attempts": "attempt_start", "network": "upload_receipt"},
            "consistency": "transaction_snapshot"
            if options["report"] == "summary"
            else "incremental_immutable_revision_export",
            "filters": filters,
        }
        if per_person:
            # Usage from before person analytics was switched on never appears by person.
            metadata["person_analytics_since"] = self.analytics.person_floor(session, company)[0]
        job = put(
            session,
            "export",
            job_id,
            {
                "status": "pending",
                "metadata": metadata,
                "expires_at": metadata["expires_at"],
                "deletion_epoch": company.data["epoch"],
                "retention_cutoff": self.analytics.cutoff(session, company),
                "cursor": None,
                "chunk_count": 0,
                "row_count": 0,
                "byte_length": 0,
                "integrity_chain": "00" * 32,
                "history_cursor": None,
                "phase": "live",
            },
            company.id,
            actor.id,
        )
        if options["report"] == "summary":
            snapshot = self.analytics.summary(
                session,
                company,
                actor,
                {
                    **filters,
                    "calculation_view": view["calculation_view"],
                    **({"method_id": view["method_id"]} if view.get("method_id") else {}),
                },
            )
            if snapshot.get("aggregate_status") != "current":
                raise Problem("aggregate_rebuilding", 409, True)
            rows = []
            for quantity in (
                "request_count",
                "attempt_count",
                "unconfirmed_attempt_count",
                "unresolved_request_count",
                "observed_search_operations",
                "search_known_request_count",
                "search_unknown_request_count",
            ):
                rows.append(
                    {
                        **metadata,
                        "quantity": quantity,
                        "value": snapshot[quantity],
                        "unit": "operations"
                        if quantity == "observed_search_operations"
                        else "requests"
                        if "request" in quantity
                        else "attempts",
                        "scope": "explicit_observed_operations"
                        if "search" in quantity
                        else "observed_actions"
                        if "request" in quantity
                        else "observed_generation",
                        "time_basis": "dispatch"
                        if "request" in quantity or "search" in quantity
                        else "attempt_start",
                    }
                )
            for quantity in ("observed_request_count", "unknown_request_count"):
                rows.append(
                    {
                        **metadata,
                        "quantity": "file_text_" + quantity,
                        "value": snapshot["file_text_coverage"][quantity],
                        "unit": "requests",
                        "scope": "extracted_file_text",
                        "additive": False,
                        "time_basis": "dispatch",
                    }
                )
            for series in [
                *snapshot["tokens"],
                *snapshot["file_text"],
                *snapshot["resources"],
                *snapshot.get("media_counts", []),
                *snapshot.get("image_references", []),
            ]:
                rows.append(
                    {
                        **metadata,
                        **series_fields(series),
                        "reference_only": series.get("reference_only", False),
                        "time_basis": "dispatch"
                        if series["scope"] in {"observed_request", "extracted_file_text"}
                        else "attempt_start",
                    }
                )
            history = self.analytics.history.summary(
                session,
                company,
                filters.get("user_id"),
                query={
                    **filters,
                    "calculation_view": view["calculation_view"],
                    **({"method_id": view["method_id"]} if view.get("method_id") else {}),
                },
                since=metadata.get("person_analytics_since"),
            )
            history_metadata = {
                **metadata,
                "method_id": None,
                "method_hash": None,
            }
            if history["status"] == "unavailable":
                rows.append(
                    {
                        **history_metadata,
                        "quantity": "historical_coverage",
                        "value": None,
                        "unit": "messages",
                        "scope": "loaded_history",
                        "additive": False,
                        "time_basis": "source_message_entry_turn",
                    }
                )
            elif history["status"] == "available":
                for key, value in history.items():
                    if key.endswith("_count"):
                        rows.append(
                            {
                                **history_metadata,
                                "quantity": "historical_" + key,
                                "value": value,
                                "unit": "messages",
                                "scope": "loaded_history",
                                "additive": False,
                                "time_basis": "source_message_entry_turn",
                            }
                        )
                for series in history["tokens"]:
                    part = {
                        "total": "",
                        "tool_output": "_tool_output",
                        "image_input_tokens": "_image_input",
                        "other_models": "_other_model",
                    }
                    rows.append(
                        {
                            **history_metadata,
                            **series_fields(series),
                            "quantity": "historical_" + series["role"] + part[series["part"]] + "_tokens",
                            "unit": "tokens",
                            "scope": "historical_visible_text",
                            "additive": False,
                            "time_basis": "source_message_entry_turn",
                            "measurement_group": {
                                "profile_id": series["profile_id"],
                                "evidence": series["evidence"],
                            },
                        }
                    )
                for series in [*history["resources"], *history["file_text"]]:
                    rows.append(
                        {
                            **history_metadata,
                            **series_fields(series),
                            "additive": False,
                            "time_basis": "source_message_entry_turn",
                        }
                    )
            self.append_chunk(session, job, csv_text(SUMMARY_FIELDS, rows), len(rows))
            job.data = {**job.data, "status": "completed", "completed_at": instant(self.service.now())}
        else:
            self.advance(session, company, job)
        self.service.audit(
            session, company.id, actor.id, "usage_export_started", job.id, {"report": options["report"]}
        )
        return self.service.remember_operation(
            session, company, actor, operation, request_hash, self.result(job)
        )

    def result(self, job):
        return {
            "export_id": job.id,
            "status": job.data["status"],
            "expires_at": job.data["expires_at"],
            "generated_at": job.data["metadata"]["generated_at"],
            "completed_at": job.data.get("completed_at"),
            "row_count": job.data["row_count"],
            "metadata": job.data["metadata"],
            "byte_length": job.data["byte_length"],
            "integrity": {
                "algorithm": "sha256-chunk-chain-v1",
                "digest": job.data["integrity_chain"],
                "chunk_count": job.data["chunk_count"],
            },
            "status_path": "/v1/admin/exports/" + job.id,
            "download_path": "/v1/admin/exports/" + job.id + "/download",
        }

    def append_chunk(self, session, job, content, row_count):
        index = job.data["chunk_count"]
        encoded = content.encode("utf-8")
        chunk_digest = hashlib.sha256(encoded).hexdigest()
        chain = hashlib.sha256(
            bytes.fromhex(job.data["integrity_chain"])
            + index.to_bytes(8, "big")
            + len(encoded).to_bytes(8, "big")
            + bytes.fromhex(chunk_digest)
        ).hexdigest()
        put(
            session,
            "export_chunk",
            f"{job.id}:{index:010d}",
            {
                "content": self.service.secrets.encrypt(content),
                "byte_length": len(encoded),
                "sha256": chunk_digest,
            },
            job.tenant,
            job.owner,
        )
        job.data = {
            **job.data,
            "chunk_count": index + 1,
            "row_count": job.data["row_count"] + row_count,
            "byte_length": job.data["byte_length"] + len(encoded),
            "integrity_chain": chain,
        }

    def eligible(self, session, company, job):
        return (
            self.service.alive(job.data["expires_at"])
            and job.data["deletion_epoch"] == company.data["epoch"]
            and job.data["retention_cutoff"] == self.analytics.cutoff(session, company)
            and not self.analytics.deletions.in_progress(session, company)
            and self.person_scope_allowed(session, company, job)
        )

    def person_scope_allowed(self, session, company, job):
        """
        An organization summary may always be read. A per-person export (records, or one person's
        summary) only while person analytics is on and still in the period it was made in, so
        switching person analytics off, or off and on again, withdraws the files made before.
        """
        metadata = job.data["metadata"]
        if metadata["report"] == "summary" and not metadata["filters"].get("user_id"):
            return True
        if not self.service.settings.person_analytics_enabled:
            return False
        return metadata.get("person_analytics_since") == self.analytics.person_floor(session, company)[0]

    def advance(self, session, company, job):
        if job.data["status"] != "pending":
            return
        actor = get(session, "member", job.owner, company.id)
        if (
            not actor
            or actor.data["status"] != "active"
            or actor.data["role"] != "admin"
            or not self.eligible(session, company, job)
        ):
            job.data = {**job.data, "status": "cancelled"}
            return
        metadata = job.data["metadata"]
        filters = metadata["filters"]
        if metadata["calculation_view"] == "recalculated":
            try:
                self.analytics.methods.prepare_view(
                    session,
                    company,
                    actor,
                    {**filters, "calculation_view": "recalculated", "method_id": metadata["method_id"]},
                )
            except Problem as error:
                job.data = {**job.data, "status": "cancelled", "error_code": error.code}
                return
        if job.data.get("phase") == "history":
            self.advance_history(session, company, job)
            return
        parent = aliased(Observation)
        cutoff = self.analytics.cutoff(session, company) or "1970-01-01T00:00:00.000Z"
        conditions = [
            Observation.tenant == company.id,
            Observation.status != "aliased",
            Observation.occurred_at >= max(metadata["range_start"], metadata["person_analytics_since"]),
            Observation.occurred_at < metadata["range_end"],
            or_(
                and_(Observation.kind == "request", Observation.occurred_at >= cutoff),
                and_(Observation.kind == "attempt", parent.occurred_at >= cutoff),
            ),
        ]
        for key, column in (
            ("user_id", Observation.owner),
            ("site", Observation.site),
            ("model", Observation.model),
        ):
            if filters.get(key):
                conditions.append(column == filters[key])
        if job.data["cursor"]:
            at, owner, kind, identifier = job.data["cursor"]
            conditions.append(
                or_(
                    Observation.occurred_at < at,
                    and_(
                        Observation.occurred_at == at,
                        tuple_(Observation.owner, Observation.kind, Observation.id)
                        > (owner, kind, identifier),
                    ),
                )
            )
        statement = select(Observation).outerjoin(
            parent,
            and_(
                parent.tenant == Observation.tenant,
                parent.owner == Observation.owner,
                parent.kind == "request",
                parent.id == Observation.parent,
            ),
        )
        records = session.scalars(
            statement.where(*conditions)
            .order_by(Observation.occurred_at.desc(), Observation.owner, Observation.kind, Observation.id)
            .limit(PAGE_SIZE + 1)
            .execution_options(yield_per=1)
        )
        rows = []
        size = 0
        tail = None
        has_more = False
        for original in records:
            record = next(select_records(session, (original,), metadata.get("method_id")))
            if len(rows) == PAGE_SIZE:
                has_more = True
                break
            estimate = record.estimate.get("result")
            row = {
                **metadata,
                "user_id": record.owner,
                "record_kind": record.kind,
                "record_id": record.id,
                "parent_request_id": record.parent,
                "observation_revision": record.revision,
                "payload_hash": record.payload_hash,
                "occurred_at": record.occurred_at,
                "time_basis": "dispatch" if record.kind == "request" else "attempt_start",
                "method_id": None,
                "method_hash": None,
                **estimate_fields(estimate),
                "estimate_status": record.estimate["status"],
                "observation_json": canonical(record.payload),
                "estimate_json": canonical(record.estimate),
                "original_observation_json": canonical(original.payload),
                "original_estimate_json": canonical(original.estimate),
            }
            row_size = len(canonical(row).encode("utf-8"))
            if rows and size + row_size > 524288:
                has_more = True
                break
            rows.append(row)
            size += row_size
            tail = record
        if rows or not job.data["chunk_count"]:
            self.append_chunk(
                session,
                job,
                csv_text(RECORD_FIELDS, rows, include_header=not job.data["chunk_count"]),
                len(rows),
            )
        job.data = {
            **job.data,
            "cursor": [tail.occurred_at, tail.owner, tail.kind, tail.id] if tail else job.data["cursor"],
            "status": "pending",
            "completed_at": None,
            "phase": "live" if has_more else "history",
        }
        if not has_more:
            self.advance_history(session, company, job, PAGE_SIZE - len(rows))

    def advance_history(self, session, company, job, budget=PAGE_SIZE):
        from .historical_usage import indexed_instant

        metadata = job.data["metadata"]
        filters = metadata["filters"]
        conditions = [HistoryObservation.tenant == company.id, self.analytics.history.visible(company)]
        if filters.get("period", "month") != "all" or filters.get("start") or filters.get("end"):
            conditions.extend(
                [
                    HistoryObservation.occurred_at >= indexed_instant(metadata["range_start"]),
                    HistoryObservation.occurred_at < indexed_instant(metadata["range_end"]),
                ]
            )
        if filters.get("user_id"):
            conditions.append(HistoryObservation.owner == filters["user_id"])
        # Every row names its person; nothing saved from before person analytics was on is listed.
        from .historical_usage import recorded_since

        conditions.append(recorded_since(metadata["person_analytics_since"]))
        if filters.get("site"):
            conditions.append(HistoryObservation.site == filters["site"])
        if filters.get("model"):
            conditions.append(
                HistoryObservation.payload["model_id"].as_string().is_(None)
                if filters["model"] == "unknown"
                else HistoryObservation.payload["model_id"].as_string() == filters["model"]
            )
        if job.data.get("history_cursor"):
            conditions.append(
                tuple_(HistoryObservation.owner, HistoryObservation.message_key)
                > tuple(job.data["history_cursor"])
            )
        records = session.scalars(
            select(HistoryObservation)
            .where(*conditions)
            .order_by(HistoryObservation.owner, HistoryObservation.message_key)
            .limit(budget + 1)
            .execution_options(yield_per=1)
        )
        rows = []
        tail = None
        size = 0
        has_more = False
        for record in records:
            selected = selected_history(session, record, metadata.get("method_id"))
            row = {
                **metadata,
                "user_id": record.owner,
                "record_kind": "history_message",
                "record_id": record.message_key,
                "parent_request_id": record.payload["prompt_key"],
                "payload_hash": record.payload_hash,
                "occurred_at": record.payload["occurred_at"],
                "date_basis": record.payload["date_basis"],
                "observed_at": record.observed_at,
                "time_basis": record.payload["date_basis"],
                "method_id": metadata.get("method_id") or record.payload["proposed_method_id"],
                "method_hash": metadata.get("method_hash") or record.payload["proposed_method_hash"],
                **estimate_fields(selected),
                "estimate_status": selected.get("status", record.status)
                if isinstance(selected, dict)
                else record.status,
                "observation_json": record.payload,
                "estimate_json": selected,
                "original_observation_json": record.original,
                "original_estimate_json": record.original_estimate,
            }
            row_size = len(canonical(row).encode())
            if len(rows) == budget or (rows and size + row_size > 524288):
                has_more = True
                break
            rows.append(row)
            size += row_size
            tail = record
        if rows:
            self.append_chunk(
                session,
                job,
                csv_text(RECORD_FIELDS, rows, include_header=not job.data["chunk_count"]),
                len(rows),
            )
        job.data = {
            **job.data,
            "history_cursor": [tail.owner, tail.message_key] if tail else job.data.get("history_cursor"),
            "status": "pending" if has_more else "completed",
            "completed_at": None if has_more else instant(self.service.now()),
        }

    def delete_page(self, session, job, budget=PAGE_SIZE):
        cls = TABLES["export_chunk"]
        ids = list(
            session.scalars(
                select(cls.id)
                .where(cls.tenant == job.tenant, cls.id >= job.id + ":", cls.id < job.id + ";")
                .order_by(cls.id)
                .limit(budget)
            )
        )
        if ids:
            session.execute(delete(cls).where(cls.tenant == job.tenant, cls.id.in_(ids)))
            return len(ids), False
        session.delete(job)
        return 1, True

    def stream(self, company_id, job_id, actor_id, correlation_id=None):
        index = 0
        length = 0
        chain = "00" * 32
        try:
            while True:
                with self.service.db.transaction(readonly=True) as session:
                    company = get(session, "company", company_id)
                    actor = get(session, "member", actor_id, company_id)
                    job = get(session, "export", job_id, company_id)
                    if (
                        not company
                        or not actor
                        or actor.data["status"] != "active"
                        or actor.data["role"] != "admin"
                        or not job
                        or job.owner != actor_id
                        or job.data["status"] != "completed"
                        or not self.eligible(session, company, job)
                    ):
                        raise RuntimeError("export_unavailable")
                    if index >= job.data["chunk_count"]:
                        if length != job.data["byte_length"] or chain != job.data["integrity_chain"]:
                            raise RuntimeError("export_integrity_failed")
                        return
                    chunk = get(session, "export_chunk", f"{job.id}:{index:010d}", company_id)
                    if not chunk:
                        raise RuntimeError("export_chunk_missing")
                    encoded = self.service.secrets.decrypt(chunk.data["content"]).encode("utf-8")
                    hashed = hashlib.sha256(encoded).hexdigest()
                    if len(encoded) != chunk.data["byte_length"] or hashed != chunk.data["sha256"]:
                        raise RuntimeError("export_integrity_failed")
                    chain = hashlib.sha256(
                        bytes.fromhex(chain)
                        + index.to_bytes(8, "big")
                        + len(encoded).to_bytes(8, "big")
                        + bytes.fromhex(hashed)
                    ).hexdigest()
                length += len(encoded)
                yield encoded
                index += 1
        except Exception as exception:
            from .diagnostics import record

            record(self.service, correlation_id or str(uuid4()), "/v1/admin/exports", exception)
            raise RuntimeError("export_stream_interrupted") from None
